// src/whatsapp.js
import qrcode from "qrcode-terminal";
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason,
} from "@whiskeysockets/baileys";
import {
  config,
  MIN_DELAY,
  MAX_DELAY,
  MIN_MSG_CHARS_INT,
  REACTED_MAX_SIZE,
} from "./config.js";
import {
  ensureDir,
  sleep,
  rand,
  getMessageText,
  getParticipantJid,
  extractPhoneFromJid,
  preview,
  normJid,
} from "./utils.js";
import {
  state,
  setSocket,
  setLastQR,
  getReactedSet,
  setAllowedGroupJids,
  setGroupSubjects,
  getAllowedGroupJids,
  getGroupSubjects,
  WANTED_GROUP_SUBS,
  setListeningEnabled,
  isListeningEnabled,
} from "./state.js";
import { rememberSender, passesSenderFilters } from "./filters.js";
import { fold } from "./utils.js";

/**
 * Refrescar la lista de grupos permitidos
 */
export async function refreshAllowedGroups(sock, log) {
  try {
    const gmap = await sock.groupFetchAllParticipating();
    const matchedJids = [];
    const groupSubjects = new Map();
    for (const [jid, meta] of Object.entries(gmap || {})) {
      const subject = meta?.subject || "";
      groupSubjects.set(jid, subject);
      const folded = fold(subject);
      if (
        WANTED_GROUP_SUBS.length &&
        WANTED_GROUP_SUBS.some((s) => folded.includes(s))
      ) {
        matchedJids.push(jid);
      }
    }
    setAllowedGroupJids(new Set(matchedJids));
    setGroupSubjects(groupSubjects);
    log.info(
      "Grupos activos:",
      matchedJids.map((j) => groupSubjects.get(j)).join(" | ") || "(ninguno)"
    );
  } catch (e) {
    log.error("No pude refrescar grupos:", e?.message);
  }
}

/**
 * Limpieza periódica del Set reacted para evitar memory leak
 */
export function cleanReactedSet(log) {
  const reacted = getReactedSet();
  if (reacted.size > REACTED_MAX_SIZE) {
    const toKeep = [...reacted].slice(-5000); // Mantener últimos 5k
    reacted.clear();
    toKeep.forEach((k) => reacted.add(k));
    log.debug(`🧹 Limpieza: reacted reducido a ${reacted.size}`);
  }
}

/**
 * Iniciar la conexión de WhatsApp con Baileys
 */
export async function start(log) {
  ensureDir(config.SESSION_DIR);

  const { state: authState, saveCreds } = await useMultiFileAuthState(
    config.SESSION_DIR
  );
  const { version } = await fetchLatestBaileysVersion();
  log.info("Baileys", version.join("."));

  const sock = makeWASocket({
    version,
    auth: authState,
    browser: Browsers.appropriate("Server"),
    markOnlineOnConnect: false,
  });

  setSocket(sock);

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      qrcode.generate(qr, { small: true });
      log.info("Escanea el QR en WhatsApp > Dispositivos vinculados");
    }

    if (qr) {
      setLastQR(qr);
      log.info(
        "QR listo: abre /qr?token=<API_TOKEN> para escanear desde el navegador"
      );
    }
    if (connection === "open") {
      log.info("Conectado ✅");
      await refreshAllowedGroups(sock, log);

      // Iniciar limpieza periódica del Set reacted
      setInterval(() => cleanReactedSet(log), 60000); // Cada minuto
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      log.warn("Conexión cerrada", code ?? "");
      if (code !== DisconnectReason.loggedOut) {
        start(log).catch((e) => log.error("Reintento falló:", e?.message));
      } else {
        log.error(
          "Sesión cerrada. Borra la carpeta de sesiones y vincula de nuevo."
        );
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ type, messages }) => {
    if (type !== "notify" || !Array.isArray(messages)) return;

    // ✅ PROCESAMIENTO PARALELO: todos los mensajes se procesan simultáneamente
    await Promise.allSettled(
      messages.map(async (msg) => {
        try {
          const { key } = msg;
          const remoteJid = key?.remoteJid;
          const msgId = key?.id;
          const fromMe = key?.fromMe;
          if (!remoteJid || !msgId || fromMe) return;
          if (!isListeningEnabled()) return;
          if (!getAllowedGroupJids().has(remoteJid)) return;

          // Participant (varias rutas)
          const participant = getParticipantJid(msg);
          if (!participant) return;

          const groupName = getGroupSubjects().get(remoteJid) || "(grupo)";
          const text = getMessageText(msg);
          rememberSender(participant, groupName, text);

          // Ignora mensajes demasiado cortos
          if (text.length < MIN_MSG_CHARS_INT) {
            log.info(
              `⛔ Ignorado por longitud (${text.length} < ${MIN_MSG_CHARS_INT})`
            );
            return;
          }

          // Log de entrada minimalista
          const prettyNum = "+" + extractPhoneFromJid(participant);
          log.info(`👤 ${prettyNum}  #${groupName}  →  "${preview(text)}"`);

          // Filtros
          if (!passesSenderFilters(participant)) {
            log.info("⛔ Ignorado por filtros");
            return;
          }

          // Evitar duplicado - marcar ANTES del sleep para evitar race conditions
          const k = `${remoteJid}::${msgId}`;
          const reacted = getReactedSet();
          if (reacted.has(k)) return;
          reacted.add(k); // ✅ Movido ANTES del sleep

          // Delay aleatorio y reacción
          const delay = rand(MIN_DELAY, MAX_DELAY);
          await sleep(delay);
          await sock.sendMessage(remoteJid, {
            react: { text: config.EMOJI, key },
          });

          log.info(`✅ React ${config.EMOJI} en ${delay}ms`);
          log.debug("jid=", normJid(participant));

          // Desactivar bot después de reaccionar
          setListeningEnabled(false);
          log.warn("🛑 Bot desactivado automáticamente después de reaccionar");
        } catch (e) {
          log.error("Error procesando msg:", e?.message);
        }
      })
    );
  });

  return sock;
}
