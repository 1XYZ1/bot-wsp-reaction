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

  // Filtrado por JIDs (solo whitelist)
  USE_ALLOWED_JIDS = "false",
  ALLOWED_JIDS = "",

  // Min mensajes
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

/* =================== Configuración =================== */
// Parseo de listas del .env
const WANTED_GROUP_SUBS = GROUPS.split(",")
  .map((x) => fold(x.split("#")[0]))
  .filter(Boolean);

const USE_ALLOW_JIDS = USE_ALLOWED_JIDS.toLowerCase() === "true";
const ALLOWED_JIDS_SET = new Set(
  ALLOWED_JIDS.split(",")
    .map((x) => normJid(x))
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
const REACTED_MAX_SIZE = 10000;
let groupSubjects = new Map(); // remoteJid -> subject
let allowedGroupJids = new Set();

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

// Limpieza periódica del Set reacted para evitar memory leak
function cleanReactedSet() {
  if (reacted.size > REACTED_MAX_SIZE) {
    const toKeep = [...reacted].slice(-5000); // Mantener últimos 5k
    reacted.clear();
    toKeep.forEach((k) => reacted.add(k));
    log.debug(`🧹 Limpieza: reacted reducido a ${reacted.size}`);
  }
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

// Lógica de filtros simplificada - solo whitelist de JIDs
function passesSenderFilters(participantJid) {
  if (!USE_ALLOW_JIDS) return true; // Si no está activo, permite todos
  const jid = normJid(participantJid);
  return ALLOWED_JIDS_SET.has(jid);
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
      qrcode.generate(qr, { small: true });
      log.info("Escanea el QR en WhatsApp > Dispositivos vinculados");
    }

    if (qr) {
      lastQR = qr;
      lastQRAt = Date.now();
      // Opcional: sigue imprimiéndolo en consola si quieres
      // console.log(await QRCode.toString(qr, { type: 'terminal' }))
      log.info(
        "QR listo: abre /qr?token=<API_TOKEN> para escanear desde el navegador"
      );
    }
    if (connection === "open") {
      log.info("Conectado ✅");
      await refreshAllowedGroups();

      // Iniciar limpieza periódica del Set reacted
      setInterval(cleanReactedSet, 60000); // Cada minuto
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

    // ✅ PROCESAMIENTO PARALELO: todos los mensajes se procesan simultáneamente
    await Promise.allSettled(
      messages.map(async (msg) => {
        try {
          const { key } = msg;
          const remoteJid = key?.remoteJid;
          const msgId = key?.id;
          const fromMe = key?.fromMe;
          if (!remoteJid || !msgId || fromMe) return;
          if (!listeningEnabled) return;
          if (!allowedGroupJids.has(remoteJid)) return;

          // Participant (varias rutas)
          const participant = getParticipantJid(msg);
          if (!participant) return;

          const groupName = groupSubjects.get(remoteJid) || "(grupo)";
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
          if (reacted.has(k)) return;
          reacted.add(k); // ✅ Movido ANTES del sleep

          // Delay aleatorio y reacción
          const delay = rand(MIN_DELAY, MAX_DELAY);
          await sleep(delay);
          await sock.sendMessage(remoteJid, { react: { text: EMOJI, key } });

          log.info(`✅ React ${EMOJI} en ${delay}ms`);
          log.debug("jid=", normJid(participant));
        } catch (e) {
          log.error("Error procesando msg:", e?.message);
        }
      })
    );
  });
}

start().catch((e) => {
  log.error("Fatal init:", e);
  process.exit(1);
});

/* =================== HTTP API =================== */
const app = express();
app.use(express.json());

// Middleware de autenticación (excluye /admin y /qr para permitir acceso con localStorage)
function authMiddleware(req, res, next) {
  // Si no hay API_TOKEN configurado, permite todo
  if (!API_TOKEN) return next();

  // Permite acceso directo a páginas HTML (se autenticarán desde el cliente)
  if (req.path === "/admin" || req.path === "/qr" || req.path === "/qr.png") {
    // Para estas rutas, verificar token solo si viene en la URL (primera vez)
    const urlToken = (req.query?.token || "").toString();
    if (!urlToken) return next(); // Sin token en URL = viene de localStorage
    if (urlToken === API_TOKEN) return next(); // Token válido en URL
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  // Para APIs REST, verificar token en header o query
  const hdr = req.get("authorization") || "";
  const urlToken = (req.query?.token || "").toString();
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : urlToken;
  if (token !== API_TOKEN)
    return res.status(401).json({ ok: false, error: "unauthorized" });
  next();
}

app.use(authMiddleware);

app.get("/status", (_req, res) => {
  res.json({
    ok: true,
    listeningEnabled,
    groupsConfigured: WANTED_GROUP_SUBS,
    groupsActiveCount: allowedGroupJids.size,
    allowJids: USE_ALLOW_JIDS,
    allowedJidsCount: ALLOWED_JIDS_SET.size,
    minMsgChars: MIN_MSG_CHARS_INT,
    reactedCacheSize: reacted.size,
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

app.get("/qr", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const hasQR = lastQR && Date.now() - lastQRAt <= QR_TTL_MS;
  const hdr = req.get("authorization") || "";
  const urlToken = (req.query?.token || "").toString();
  const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : urlToken;
  const tokenQs = token ? `token=${encodeURIComponent(token)}&` : "";
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
        ? `<img src="/qr.png?${tokenQs}ts=${Date.now()}" alt="QR">`
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

app.get("/recent-senders", (_req, res) => {
  res.json({ ok: true, items: lastSenders });
});

// === ADMIN UI (Panel de control simplificado) ===
// Abre: http://HOST:3000/admin?token=<API_TOKEN>
app.get("/admin", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Panel Bot WhatsApp</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 16px system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
    color: #eaeaea;
    min-height: 100vh;
  }
  .wrap {
    max-width: 900px;
    margin: 0 auto;
    padding: 24px 16px;
  }
  h1 {
    font-size: 28px;
    font-weight: 700;
    margin: 0 0 8px;
    background: linear-gradient(135deg, #60a5fa 0%, #34d399 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .subtitle {
    color: #9ca3af;
    font-size: 14px;
    margin-bottom: 32px;
  }
  .card {
    background: rgba(17, 24, 39, 0.8);
    border: 1px solid rgba(75, 85, 99, 0.3);
    border-radius: 16px;
    padding: 24px;
    margin: 16px 0;
    backdrop-filter: blur(10px);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  }
  .card-title {
    font-weight: 700;
    font-size: 18px;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 20px;
    border-radius: 12px;
    font-weight: 600;
    font-size: 15px;
    margin: 16px 0;
    transition: all 0.3s ease;
  }
  .status-badge.active {
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    color: white;
    box-shadow: 0 4px 20px rgba(16, 185, 129, 0.4);
  }
  .status-badge.inactive {
    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    color: white;
    box-shadow: 0 4px 20px rgba(239, 68, 68, 0.4);
  }
  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: white;
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  .btn-group {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 16px;
  }
  button, .btn {
    cursor: pointer;
    border: 0;
    border-radius: 12px;
    padding: 12px 24px;
    font-weight: 600;
    font-size: 15px;
    transition: all 0.2s ease;
    text-decoration: none;
    display: inline-block;
  }
  button:hover, .btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
  }
  button:active, .btn:active {
    transform: translateY(0);
  }
  .btn-success {
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    color: white;
  }
  .btn-danger {
    background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
    color: white;
  }
  .btn-info {
    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
    color: white;
  }
  pre {
    background: #0a0a0a;
    border: 1px solid rgba(75, 85, 99, 0.3);
    border-radius: 12px;
    padding: 16px;
    overflow: auto;
    font-size: 13px;
    line-height: 1.6;
    max-height: 300px;
  }
  .info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
    margin-top: 16px;
  }
  .info-item {
    background: rgba(30, 41, 59, 0.6);
    padding: 12px;
    border-radius: 10px;
    border-left: 3px solid #3b82f6;
  }
  .info-label {
    font-size: 12px;
    color: #9ca3af;
    margin-bottom: 4px;
  }
  .info-value {
    font-size: 16px;
    font-weight: 700;
    color: #60a5fa;
  }
  .sender-item {
    background: rgba(30, 41, 59, 0.4);
    padding: 12px;
    border-radius: 8px;
    margin-bottom: 8px;
    border-left: 3px solid #34d399;
  }
  .sender-jid {
    font-weight: 600;
    color: #34d399;
    font-size: 14px;
  }
  .sender-text {
    color: #d1d5db;
    font-size: 13px;
    margin-top: 4px;
  }
  .footer {
    margin-top: 32px;
    text-align: center;
    font-size: 13px;
    color: #6b7280;
  }
  @media (max-width: 700px) {
    .info-grid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <h1>🤖 Panel de Control WhatsApp Bot</h1>
    <div class="subtitle">Gestiona tu bot de reacciones automáticas</div>

    <div class="card">
      <div class="card-title">⚡ Control del Bot</div>
      <div id="badge" class="status-badge active">
        <span class="status-dot"></span>
        <span id="statusText">Cargando...</span>
      </div>
      <div class="btn-group">
        <button id="btnOn" class="btn-success">▶ Activar Bot</button>
        <button id="btnOff" class="btn-danger">⏸ Desactivar Bot</button>
        <a href="/qr" id="lnkQr" class="btn btn-info" target="_blank" rel="noopener">📱 Ver QR</a>
      </div>
    </div>

    <div class="card">
      <div class="card-title">📊 Información del Sistema</div>
      <div class="info-grid" id="infoGrid">
        <div class="info-item">
          <div class="info-label">Estado</div>
          <div class="info-value">...</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">👥 Últimos Remitentes</div>
      <div id="senders">Cargando...</div>
    </div>

    <div class="footer">
      💡 Tip: Usa <strong>?token=TU_API_TOKEN</strong> en la URL la primera vez
    </div>
  </div>

<script>
(function(){
  const qs = new URLSearchParams(location.search)
  const qTok = qs.get('token')
  if (qTok) {
    localStorage.setItem('apiToken', qTok)
    history.replaceState(null, '', location.pathname)
  }
  const TOKEN = localStorage.getItem('apiToken') || ''

  const $ = (s) => document.querySelector(s)
  const badge = $('#badge')
  const statusText = $('#statusText')
  const infoGrid = $('#infoGrid')
  const senders = $('#senders')
  const btnOn = $('#btnOn')
  const btnOff = $('#btnOff')
  const lnkQr = $('#lnkQr')

  async function api(path, opts={}){
    const headers = {
      'Content-Type': 'application/json',
      ...(TOKEN ? { 'Authorization': 'Bearer ' + TOKEN } : {})
    }
    const r = await fetch(path, { ...opts, headers })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    return r.json()
  }

  function setStatus(enabled){
    if (enabled) {
      badge.className = 'status-badge active'
      statusText.textContent = '✓ Bot Activo - Escuchando mensajes'
    } else {
      badge.className = 'status-badge inactive'
      statusText.textContent = '✗ Bot Inactivo - Pausado'
    }
  }

  function renderInfo(data){
    const items = [
      { label: 'Estado', value: data.listeningEnabled ? '✓ Activo' : '✗ Inactivo' },
      { label: 'Grupos activos', value: data.groupsActiveCount || 0 },
      { label: 'Whitelist JIDs', value: data.allowedJidsCount || 0 },
      { label: 'Min. caracteres', value: data.minMsgChars || 0 },
      { label: 'Caché reacciones', value: data.reactedCacheSize || 0 }
    ]
    infoGrid.innerHTML = items.map(i => \`
      <div class="info-item">
        <div class="info-label">\${i.label}</div>
        <div class="info-value">\${i.value}</div>
      </div>
    \`).join('')
  }

  function renderSenders(items){
    if (!items || !items.length) {
      senders.innerHTML = '<div style="color:#6b7280">No hay remitentes recientes</div>'
      return
    }
    senders.innerHTML = items.slice(0, 10).map(s => \`
      <div class="sender-item">
        <div class="sender-jid">\${s.jid}</div>
        <div class="sender-text">\${s.text || '(sin texto)'}</div>
        <div style="font-size:11px;color:#6b7280;margin-top:4px">
          Grupo: \${s.group || 'N/A'}
        </div>
      </div>
    \`).join('')
  }

  async function load(){
    try {
      const s = await api('/status')
      setStatus(s.listeningEnabled)
      renderInfo(s)

      try {
        const rr = await api('/recent-senders')
        renderSenders(rr.items)
      } catch {
        senders.innerHTML = '<div style="color:#ef4444">Error cargando remitentes</div>'
      }

      const u = new URL('/qr', location.origin)
      if (TOKEN) u.searchParams.set('token', TOKEN)
      lnkQr.href = u.toString()
    } catch(e) {
      setStatus(false)
      if (e.message.includes('401')) {
        infoGrid.innerHTML = '<div style="color:#ef4444">⚠️ Token inválido o faltante<br><br>Añade <strong>?token=TU_API_TOKEN</strong> a la URL y recarga la página.</div>'
      } else {
        infoGrid.innerHTML = '<div style="color:#ef4444">Error: ' + e.message + '<br><br>Verifica que el bot esté corriendo.</div>'
      }
    }
  }

  async function setEnabled(v){
    try {
      await api('/listener', {
        method: 'POST',
        body: JSON.stringify({ enabled: !!v })
      })
      await load()
    } catch(e) {
      alert('Error: ' + e.message)
    }
  }

  btnOn.addEventListener('click', () => setEnabled(true))
  btnOff.addEventListener('click', () => setEnabled(false))

  // Mostrar aviso si no hay token guardado
  if (!TOKEN) {
    statusText.textContent = '⚠️ Token no configurado'
    badge.className = 'status-badge inactive'
    infoGrid.innerHTML = '<div style="color:#f59e0b; padding: 12px; background: rgba(245, 158, 11, 0.1); border-radius: 8px;"><strong>⚠️ Primer acceso detectado</strong><br><br>Añade <strong>?token=TU_API_TOKEN</strong> a la URL y recarga la página para guardar el token en tu navegador.</div>'
  }

  load()
  setInterval(load, 5000) // Auto-refresh cada 5 segundos
})();
</script>
</body>
</html>`);
});

app.listen(parseInt(PORT, 10), () => log.info(`HTTP :${PORT}`));
