// index.js
import "dotenv/config";
import express from "express";
import qrcode from "qrcode-terminal";
import fs from "fs";
import path from "path";
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason,
} from "@whiskeysockets/baileys";

import QRCode from "qrcode";

/* =================== Config .env =================== */
const {
  LOG_LEVEL = "info",

  EMOJI = "👾",
  MIN_DELAY_MS = "100",
  MAX_DELAY_MS = "1000",

  // Grupos: substring; insensible a mayúsculas/acentos
  GROUPS = "",

  // Filtrado por JIDs (recomendado)
  USE_ALLOWED_JIDS = "false",
  ALLOWED_JIDS = "",
  USE_BLOCKED_JIDS = "false",
  BLOCKED_JIDS = "",

  // Filtrado por números (respaldo) — se resolverán a JIDs en el arranque
  USE_ALLOWED_NUMBERS = "false",
  ALLOWED_NUMBERS = "",
  USE_BLOCKED_NUMBERS = "false",
  BLOCKED_NUMBERS = "",

  //  min mensajes
  MIN_MSG_CHARS = "0",

  // HTTP
  PORT = "3000",
  API_TOKEN = "",

  // Sesión
  SESSION_DIR = "./sessions",
} = process.env;

/* =================== Logging minimalista =================== */
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const LV = LEVELS[LOG_LEVEL] ?? 2;
const log = {
  error: (...a) =>
    LEVELS.error <= LV && console.error("\x1b[31m✖\x1b[0m", ...a),
  warn: (...a) => LEVELS.warn <= LV && console.warn("\x1b[33m!\x1b[0m", ...a),
  info: (...a) => LEVELS.info <= LV && console.log("\x1b[36m•\x1b[0m", ...a),
  debug: (...a) =>
    LEVELS.debug <= LV && console.debug("\x1b[90m·\x1b[0m", ...a),
};

/* =================== Utils =================== */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const ensureDir = (d) =>
  !fs.existsSync(d) && fs.mkdirSync(d, { recursive: true });

// Normalizar para comparar nombres de grupos (sin acentos, minúsculas)
const fold = (s) =>
  s
    ?.normalize("NFD")
    ?.replace(/\p{Diacritic}/gu, "")
    ?.toLowerCase()
    ?.trim() ?? "";
// Dejar solo dígitos
const digits = (s) => (s ?? "").replace(/[^\d]/g, "");
// Vista breve de texto
const preview = (t, n = 80) =>
  t && t.length > n ? t.slice(0, n - 1) + "…" : t ?? "";

// Normalizar un JID a su forma base (quita :device, homogeneiza dominio)
function normJid(jid) {
  if (!jid) return "";
  const [userRaw, domainRaw] = jid.toLowerCase().split("@");
  const user = (userRaw || "").split(":")[0]; // quita sufijo de dispositivo
  // Mantén @lid si ya es lid; si es "whatsapp.net", homogeneiza a s.whatsapp.net
  const domain = !domainRaw
    ? ""
    : domainRaw === "whatsapp.net"
    ? "s.whatsapp.net"
    : domainRaw;
  return domain ? `${user}@${domain}` : user;
}

// Extraer teléfono base (por si quieres usar fallback por número)
function extractPhoneFromJid(jid) {
  const left = (jid || "").split("@")[0];
  return digits(left.split(":")[0]);
}

// Obtener texto legible del mensaje (varios tipos)
function getMessageText(msg) {
  const m = msg.message || {};
  const text =
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsMessage?.contentText ||
    m.listResponseMessage?.title ||
    m.templateButtonReplyMessage?.selectedId ||
    m.interactiveResponseMessage?.body?.text ||
    "";
  return (text || "").replace(/\s+/g, " ").trim();
}

// Intentar obtener el participant JID desde varias rutas
function getParticipantJid(msg) {
  return (
    msg?.key?.participant ||
    msg?.participant ||
    msg?.message?.extendedTextMessage?.contextInfo?.participant ||
    msg?.message?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo
      ?.participant ||
    ""
  );
}

// Parseo de listas del .env
const WANTED_GROUP_SUBS = GROUPS.split(",")
  .map((x) => fold(x.split("#")[0]))
  .filter(Boolean);

const USE_ALLOW_JIDS = USE_ALLOWED_JIDS.toLowerCase() === "true";
const USE_BLOCK_JIDS = USE_BLOCKED_JIDS.toLowerCase() === "true";
const ALLOWED_JIDS_SET = new Set(
  ALLOWED_JIDS.split(",")
    .map((x) => normJid(x))
    .filter(Boolean)
);
const BLOCKED_JIDS_SET = new Set(
  BLOCKED_JIDS.split(",")
    .map((x) => normJid(x))
    .filter(Boolean)
);

const USE_ALLOW_NUMS = USE_ALLOWED_NUMBERS.toLowerCase() === "true";
const USE_BLOCK_NUMS = USE_BLOCKED_NUMBERS.toLowerCase() === "true";
const ALLOWED_NUMS_SET = new Set(
  ALLOWED_NUMBERS.split(",")
    .map((x) => digits(x))
    .filter(Boolean)
);
const BLOCKED_NUMS_SET = new Set(
  BLOCKED_NUMBERS.split(",")
    .map((x) => digits(x))
    .filter(Boolean)
);

const MIN_DELAY = Math.max(0, parseInt(MIN_DELAY_MS, 10) || 0);
const MAX_DELAY = Math.max(MIN_DELAY, parseInt(MAX_DELAY_MS, 10) || MIN_DELAY);

const MIN_MSG_CHARS_INT = Math.max(0, parseInt(MIN_MSG_CHARS, 10) || 0);

let lastQR = null;
let lastQRAt = 0;
const QR_TTL_MS = 120_000;

/* =================== Estado =================== */
let sock; // conexión Baileys
let listeningEnabled = true;
const reacted = new Set(); // remoteJid::msgId (evitar duplicados)
let groupSubjects = new Map(); // remoteJid -> subject
let allowedGroupJids = new Set();

// Resueltos: números -> JIDs (se rellena al abrir conexión)
let RESOLVED_ALLOWED_JIDS = new Set();
let RESOLVED_BLOCKED_JIDS = new Set();

// Registro simple de últimos remitentes (para ayudarte a copiar JIDs correctos)
const lastSenders = []; // { jid, group, text, ts }

/* =================== Baileys bootstrap =================== */
ensureDir(SESSION_DIR);

async function refreshAllowedGroups() {
  try {
    const gmap = await sock.groupFetchAllParticipating();
    const matchedJids = [];
    groupSubjects = new Map();
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
    allowedGroupJids = new Set(matchedJids);
    log.info(
      "Grupos activos:",
      matchedJids.map((j) => groupSubjects.get(j)).join(" | ") || "(ninguno)"
    );
  } catch (e) {
    log.error("No pude refrescar grupos:", e?.message);
  }
}

// Resolver números a JIDs (una vez conectados)
async function resolvePhonesToJids(numbersSet) {
  const output = new Set();
  try {
    if (!numbersSet?.size || typeof sock?.onWhatsApp !== "function")
      return output;
    // Intentamos consultar por "@s.whatsapp.net" (formato típico)
    const queries = [...numbersSet].map((n) => `${n}@s.whatsapp.net`);
    const results = await sock.onWhatsApp(queries); // devuelve array [{ exists, jid }, ...]
    for (const r of Array.isArray(results) ? results : []) {
      if (r?.exists && r?.jid) output.add(normJid(r.jid));
    }
  } catch (e) {
    log.warn("No pude resolver números a JIDs:", e?.message);
  }
  return output;
}

function rememberSender(jid, group, text) {
  lastSenders.unshift({
    jid: normJid(jid),
    group,
    text: preview(text),
    ts: Date.now(),
  });
  if (lastSenders.length > 50) lastSenders.pop();
}

// Lógica de filtros priorizando JIDs (estable aun con @lid)
function passesSenderFilters(participantJid) {
  const jid = normJid(participantJid);
  const num = extractPhoneFromJid(participantJid);

  // 1) JIDs primero (env + resueltos)
  if (
    USE_ALLOW_JIDS &&
    !ALLOWED_JIDS_SET.has(jid) &&
    !RESOLVED_ALLOWED_JIDS.has(jid)
  )
    return false;
  if (
    USE_BLOCK_JIDS &&
    (BLOCKED_JIDS_SET.has(jid) || RESOLVED_BLOCKED_JIDS.has(jid))
  )
    return false;

  // 2) Números como respaldo (si están activos)
  if (USE_ALLOW_NUMS && !ALLOWED_NUMS_SET.has(num)) return false;
  if (USE_BLOCK_NUMS && BLOCKED_NUMS_SET.has(num)) return false;

  return true;
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();
  log.info("Baileys", version.join("."));

  sock = makeWASocket({
    version,
    auth: state,
    browser: Browsers.appropriate("Server"),
    markOnlineOnConnect: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      lastQR = qr;
      lastQRAt = Date.now();
      // Opcional: sigue imprimiéndolo en consola si quieres
      // console.log(await QRCode.toString(qr, { type: 'terminal' }))
      log.info(
        "QR listo: abre /qr?token=<API_TOKEN> para escanear desde el navegador"
      );
    }

    if (qr) {
      qrcode.generate(qr, { small: true });
      log.info("Escanea el QR en WhatsApp > Dispositivos vinculados");
    }
    if (connection === "open") {
      log.info("Conectado ✅");
      await refreshAllowedGroups();

      // Resolver listas por número -> JIDs (si están activas)
      if (USE_ALLOW_NUMS && ALLOWED_NUMS_SET.size) {
        RESOLVED_ALLOWED_JIDS = await resolvePhonesToJids(ALLOWED_NUMS_SET);
        if (RESOLVED_ALLOWED_JIDS.size) {
          log.info("ALLOW (nums→JIDs):", [...RESOLVED_ALLOWED_JIDS].join(", "));
        }
      }
      if (USE_BLOCK_NUMS && BLOCKED_NUMS_SET.size) {
        RESOLVED_BLOCKED_JIDS = await resolvePhonesToJids(BLOCKED_NUMS_SET);
        if (RESOLVED_BLOCKED_JIDS.size) {
          log.info("BLOCK (nums→JIDs):", [...RESOLVED_BLOCKED_JIDS].join(", "));
        }
      }
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      log.warn("Conexión cerrada", code ?? "");
      if (code !== DisconnectReason.loggedOut) {
        start().catch((e) => log.error("Reintento falló:", e?.message));
      } else {
        log.error(
          "Sesión cerrada. Borra la carpeta de sesiones y vincula de nuevo."
        );
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ type, messages }) => {
    if (type !== "notify" || !Array.isArray(messages)) return;
    for (const msg of messages) {
      try {
        const { key } = msg;
        const remoteJid = key?.remoteJid;
        const msgId = key?.id;
        const fromMe = key?.fromMe;
        if (!remoteJid || !msgId || fromMe) continue;
        if (!listeningEnabled) continue;
        if (!allowedGroupJids.has(remoteJid)) continue;

        // Participant (varias rutas)
        const participant = getParticipantJid(msg);
        if (!participant) continue;

        const groupName = groupSubjects.get(remoteJid) || "(grupo)";
        const text = getMessageText(msg);
        rememberSender(participant, groupName, text);

        // ⬇️ NUEVO: ignora mensajes demasiado cortos
        if (text.length < MIN_MSG_CHARS_INT) {
          log.info(
            `⛔ Ignorado por longitud (${text.length} < ${MIN_MSG_CHARS_INT})`
          );
          continue;
        }

        // Log de entrada minimalista
        const prettyNum = "+" + extractPhoneFromJid(participant);
        log.info(`👤 ${prettyNum}  #${groupName}  →  "${preview(text)}"`);

        // Filtros
        if (!passesSenderFilters(participant)) {
          log.info("⛔ Ignorado por filtros");
          continue;
        }

        // Evitar duplicado
        const k = `${remoteJid}::${msgId}`;
        if (reacted.has(k)) continue;

        // Delay aleatorio y reacción
        const delay = rand(MIN_DELAY, MAX_DELAY);
        await sleep(delay);
        await sock.sendMessage(remoteJid, { react: { text: EMOJI, key } });
        reacted.add(k);

        log.info(`✅ React ${EMOJI} en ${delay}ms`);
        log.debug("jid=", normJid(participant));
      } catch (e) {
        log.error("Error procesando msg:", e?.message);
      }
    }
  });
}

start().catch((e) => {
  log.error("Fatal init:", e);
  process.exit(1);
});

/* =================== HTTP API =================== */
const app = express();
app.use(express.json());

// Auth básica Bearer (opcional si API_TOKEN vacío)
app.use((req, res, next) => {
  if (!API_TOKEN) return next();
  const hdr = req.get("authorization") || "";
  const urlToken = (req.query?.token || "").toString();
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : urlToken;
  if (token !== API_TOKEN)
    return res.status(401).json({ ok: false, error: "unauthorized" });
  next();
});

app.get("/status", (_req, res) => {
  res.json({
    ok: true,
    listeningEnabled,
    groupsConfigured: WANTED_GROUP_SUBS,
    groupsActiveCount: allowedGroupJids.size,
    allowJids: USE_ALLOW_JIDS,
    blockJids: USE_BLOCK_JIDS,
    allowNums: USE_ALLOW_NUMS,
    blockNums: USE_BLOCK_NUMS,
    minMsgChars: MIN_MSG_CHARS_INT,
  });
});

app.get("/qr.png", async (_req, res) => {
  if (!lastQR || Date.now() - lastQRAt > QR_TTL_MS) {
    return res.status(404).send("QR no disponible (aún o expirado)");
  }
  try {
    const png = await QRCode.toBuffer(lastQR, {
      type: "png",
      margin: 1,
      width: 320,
    });
    res.setHeader("Content-Type", "image/png");
    res.send(png);
  } catch (e) {
    res.status(500).send("Error generando QR");
  }
});

app.get("/qr", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const hasQR = lastQR && Date.now() - lastQRAt <= QR_TTL_MS;
  res.end(`<!doctype html><html><head>
  <meta http-equiv="refresh" content="8">
  <title>QR WhatsApp</title>
  <style>
    body{display:grid;place-items:center;height:100vh;background:#0b0b0b;color:#fff;font:16px system-ui;margin:0}
    img{image-rendering:pixelated;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.6)}
    p,small{opacity:.8}
  </style>
  </head><body>
    <h1>Escanea el QR</h1>
    ${
      hasQR
        ? `<img src="/qr.png?ts=${Date.now()}" alt="QR">`
        : `<p>QR no disponible aún. Mantén esta página abierta, se actualiza cada 8s.</p>`
    }
    <small>TTL aprox: ${Math.floor(QR_TTL_MS / 1000)}s</small>
  </body></html>`);
});

app.post("/pairing-code", async (req, res) => {
  try {
    if (!sock || typeof sock.requestPairingCode !== "function") {
      return res.status(503).json({ ok: false, error: "socket no listo" });
    }
    const { phone } = req.body || {};
    const num = (phone || "").toString().replace(/[^\d]/g, "");
    if (!num)
      return res
        .status(400)
        .json({ ok: false, error: "body.phone requerido en E.164 sin +" });
    // Debe invocarse durante "connecting" o cuando haya evento de QR, ver docs
    const code = await sock.requestPairingCode(num);
    res.json({ ok: true, code });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message });
  }
});

app.post("/listener", (req, res) => {
  const { enabled } = req.body ?? {};
  if (typeof enabled !== "boolean") {
    return res
      .status(400)
      .json({ ok: false, error: "body.enabled debe ser boolean" });
  }
  listeningEnabled = enabled;
  res.json({ ok: true, listeningEnabled });
});

app.post("/reload-groups", async (_req, res) => {
  await refreshAllowedGroups();
  res.json({ ok: true, groupsActiveCount: allowedGroupJids.size });
});

app.get("/recent-senders", (_req, res) => {
  res.json({ ok: true, items: lastSenders });
});

app.listen(parseInt(PORT, 10), () => log.info(`HTTP :${PORT}`));
