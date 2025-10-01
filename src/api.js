// src/api.js
import express from "express";
import QRCode from "qrcode";
import { config, MIN_MSG_CHARS_INT, QR_TTL_MS } from "./config.js";
import {
  setListeningEnabled,
  getLastSenders,
  getStatusInfo,
  getLastQR,
  getSocket,
} from "./state.js";

/**
 * Crear y configurar el servidor Express
 */
export function createServer(log) {
  const app = express();
  app.use(express.json());

  // Middleware de autenticación (excluye /admin y /qr para permitir acceso con localStorage)
  function authMiddleware(req, res, next) {
    // Si no hay API_TOKEN configurado, permite todo
    if (!config.API_TOKEN) return next();

    // Permite acceso directo a páginas HTML (se autenticarán desde el cliente)
    if (req.path === "/admin" || req.path === "/qr" || req.path === "/qr.png") {
      // Para estas rutas, verificar token solo si viene en la URL (primera vez)
      const urlToken = (req.query?.token || "").toString();
      if (!urlToken) return next(); // Sin token en URL = viene de localStorage
      if (urlToken === config.API_TOKEN) return next(); // Token válido en URL
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    // Para APIs REST, verificar token en header o query
    const hdr = req.get("authorization") || "";
    const urlToken = (req.query?.token || "").toString();
    const token = hdr.startsWith("Bearer ") ? hdr.slice(7) : urlToken;
    if (token !== config.API_TOKEN)
      return res.status(401).json({ ok: false, error: "unauthorized" });
    next();
  }

  app.use(authMiddleware);

  app.get("/status", (_req, res) => {
    const statusInfo = getStatusInfo();
    res.json({
      ok: true,
      ...statusInfo,
      minMsgChars: MIN_MSG_CHARS_INT,
    });
  });

  app.get("/qr.png", async (_req, res) => {
    const { qr, timestamp } = getLastQR();
    if (!qr || Date.now() - timestamp > QR_TTL_MS) {
      return res.status(404).send("QR no disponible (aún o expirado)");
    }
    try {
      const png = await QRCode.toBuffer(qr, {
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
    const { qr, timestamp } = getLastQR();
    const hasQR = qr && Date.now() - timestamp <= QR_TTL_MS;
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
      const sock = getSocket();
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
    setListeningEnabled(enabled);
    res.json({ ok: true, listeningEnabled: enabled });
  });

  app.get("/recent-senders", (_req, res) => {
    res.json({ ok: true, items: getLastSenders() });
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
      <div class="card-title">💬 Últimos 10 Mensajes</div>
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
      { label: 'Min. caracteres', value: data.minMsgChars || 0 }
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
    senders.innerHTML = items.slice(0, 10).map(s => {
      const date = new Date(s.ts)
      const time = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      return \`
      <div class="sender-item">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <div class="sender-jid">\${s.jid}</div>
          <div style="font-size:12px;color:#9ca3af">\${time}</div>
        </div>
        <div class="sender-text">\${s.text || '(sin texto)'}</div>
        <div style="font-size:11px;color:#6b7280;margin-top:4px">
          Grupo: \${s.group || 'N/A'}
        </div>
      </div>
      \`
    }).join('')
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

  return app;
}

/**
 * Iniciar el servidor HTTP
 */
export function startServer(app, log) {
  const port = parseInt(config.PORT, 10);
  app.listen(port, () => log.info(`HTTP :${port}`));
}
