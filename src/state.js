// src/state.js
import { config } from "./config.js";
import { fold, normJid } from "./utils.js";

/* =================== Configuración de listas =================== */
export const WANTED_GROUP_SUBS = config.GROUPS.split(",")
  .map((x) => fold(x.split("#")[0]))
  .filter(Boolean);

export const USE_ALLOW_JIDS = config.USE_ALLOWED_JIDS.toLowerCase() === "true";

export const ALLOWED_JIDS_SET = new Set(
  config.ALLOWED_JIDS.split(",")
    .map((x) => normJid(x))
    .filter(Boolean)
);

/* =================== Estado global =================== */
export const state = {
  sock: null, // conexión Baileys
  listeningEnabled: true,
  reacted: new Set(), // remoteJid::msgId (evitar duplicados)
  groupSubjects: new Map(), // remoteJid -> subject
  allowedGroupJids: new Set(),
  lastSenders: [], // { jid, group, text, ts }
  lastQR: null,
  lastQRAt: 0,
};

/**
 * Obtener el socket de WhatsApp
 */
export function getSocket() {
  return state.sock;
}

/**
 * Establecer el socket de WhatsApp
 */
export function setSocket(sock) {
  state.sock = sock;
}

/**
 * Obtener si el listening está habilitado
 */
export function isListeningEnabled() {
  return state.listeningEnabled;
}

/**
 * Establecer el estado de listening
 */
export function setListeningEnabled(enabled) {
  state.listeningEnabled = enabled;
}

/**
 * Obtener el último QR generado
 */
export function getLastQR() {
  return { qr: state.lastQR, timestamp: state.lastQRAt };
}

/**
 * Establecer el último QR
 */
export function setLastQR(qr) {
  state.lastQR = qr;
  state.lastQRAt = Date.now();
}

/**
 * Obtener el Set de reacciones
 */
export function getReactedSet() {
  return state.reacted;
}

/**
 * Obtener los grupos permitidos
 */
export function getAllowedGroupJids() {
  return state.allowedGroupJids;
}

/**
 * Establecer los grupos permitidos
 */
export function setAllowedGroupJids(jids) {
  state.allowedGroupJids = jids;
}

/**
 * Obtener los subjects de los grupos
 */
export function getGroupSubjects() {
  return state.groupSubjects;
}

/**
 * Establecer los subjects de los grupos
 */
export function setGroupSubjects(subjects) {
  state.groupSubjects = subjects;
}

/**
 * Obtener los últimos remitentes
 */
export function getLastSenders() {
  return state.lastSenders;
}

/**
 * Obtener información de estado para la API
 */
export function getStatusInfo() {
  return {
    listeningEnabled: state.listeningEnabled,
    groupsConfigured: WANTED_GROUP_SUBS,
    groupsActiveCount: state.allowedGroupJids.size,
    allowJids: USE_ALLOW_JIDS,
    allowedJidsCount: ALLOWED_JIDS_SET.size,
    reactedCacheSize: state.reacted.size,
  };
}
