// src/filters.js
import { normJid, preview } from "./utils.js";
import { USE_ALLOW_JIDS, ALLOWED_JIDS_SET } from "./state.js";
import { state } from "./state.js";

/**
 * Recordar remitente para mostrar en la interfaz de admin
 */
export function rememberSender(jid, group, text) {
  state.lastSenders.unshift({
    jid: normJid(jid),
    group,
    text: preview(text),
    ts: Date.now(),
  });
  if (state.lastSenders.length > 50) state.lastSenders.pop();
}

/**
 * Lógica de filtros simplificada - solo whitelist de JIDs
 */
export function passesSenderFilters(participantJid) {
  if (!USE_ALLOW_JIDS) return true; // Si no está activo, permite todos
  const jid = normJid(participantJid);
  return ALLOWED_JIDS_SET.has(jid);
}
