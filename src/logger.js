// src/logger.js
/* =================== Logging minimalista =================== */
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

/**
 * Crea un logger basado en el nivel de log configurado
 * @param {string} logLevel - Nivel de log: error, warn, info, debug
 * @returns {object} Logger con métodos error, warn, info, debug
 */
export function createLogger(logLevel = "info") {
  const LV = LEVELS[logLevel] ?? 2;

  return {
    error: (...a) =>
      LEVELS.error <= LV && console.error("\x1b[31m✖\x1b[0m", ...a),
    warn: (...a) => LEVELS.warn <= LV && console.warn("\x1b[33m!\x1b[0m", ...a),
    info: (...a) => LEVELS.info <= LV && console.log("\x1b[36m•\x1b[0m", ...a),
    debug: (...a) =>
      LEVELS.debug <= LV && console.debug("\x1b[90m·\x1b[0m", ...a),
  };
}
