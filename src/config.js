// src/config.js
import "dotenv/config";

/* =================== Config .env =================== */
export const config = {
  // Logging
  LOG_LEVEL: process.env.LOG_LEVEL || "info",

  // Reacciones
  EMOJI: process.env.EMOJI || "👾",
  MIN_DELAY_MS: process.env.MIN_DELAY_MS || "100",
  MAX_DELAY_MS: process.env.MAX_DELAY_MS || "1000",

  // Grupos: substring; insensible a mayúsculas/acentos
  GROUPS: process.env.GROUPS || "",

  // Filtrado por JIDs (solo whitelist)
  USE_ALLOWED_JIDS: process.env.USE_ALLOWED_JIDS || "false",
  ALLOWED_JIDS: process.env.ALLOWED_JIDS || "",

  // Min mensajes
  MIN_MSG_CHARS: process.env.MIN_MSG_CHARS || "0",

  // HTTP
  PORT: process.env.PORT || "3000",
  API_TOKEN: process.env.API_TOKEN || "",

  // Sesión
  SESSION_DIR: process.env.SESSION_DIR || "./sessions",
};

/* =================== Configuración parseada =================== */
export const MIN_DELAY = Math.max(0, parseInt(config.MIN_DELAY_MS, 10) || 0);
export const MAX_DELAY = Math.max(
  MIN_DELAY,
  parseInt(config.MAX_DELAY_MS, 10) || MIN_DELAY
);
export const MIN_MSG_CHARS_INT = Math.max(
  0,
  parseInt(config.MIN_MSG_CHARS, 10) || 0
);
export const QR_TTL_MS = 120_000;
export const REACTED_MAX_SIZE = 10000;
