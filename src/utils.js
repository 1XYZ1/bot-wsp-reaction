// src/utils.js
import fs from "fs";

/* =================== Utils =================== */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const rand = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;
export const ensureDir = (d) =>
  !fs.existsSync(d) && fs.mkdirSync(d, { recursive: true });

/**
 * Normalizar para comparar nombres de grupos (sin acentos, minúsculas)
 */
export const fold = (s) =>
  s
    ?.normalize("NFD")
    ?.replace(/\p{Diacritic}/gu, "")
    ?.toLowerCase()
    ?.trim() ?? "";

/**
 * Dejar solo dígitos
 */
export const digits = (s) => (s ?? "").replace(/[^\d]/g, "");

/**
 * Vista breve de texto
 */
export const preview = (t, n = 80) =>
  t && t.length > n ? t.slice(0, n - 1) + "…" : t ?? "";

/**
 * Normalizar un JID a su forma base (quita :device, homogeneiza dominio)
 */
export function normJid(jid) {
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

/**
 * Extraer teléfono base (por si quieres usar fallback por número)
 */
export function extractPhoneFromJid(jid) {
  const left = (jid || "").split("@")[0];
  return digits(left.split(":")[0]);
}

/**
 * Obtener texto legible del mensaje (varios tipos)
 */
export function getMessageText(msg) {
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

/**
 * Intentar obtener el participant JID desde varias rutas
 */
export function getParticipantJid(msg) {
  return (
    msg?.key?.participant ||
    msg?.participant ||
    msg?.message?.extendedTextMessage?.contextInfo?.participant ||
    msg?.message?.ephemeralMessage?.message?.extendedTextMessage?.contextInfo
      ?.participant ||
    ""
  );
}
