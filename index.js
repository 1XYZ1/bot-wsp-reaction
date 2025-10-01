// index.js - Punto de entrada principal
import { createLogger } from "./src/logger.js";
import { config } from "./src/config.js";
import { start } from "./src/whatsapp.js";
import { createServer, startServer } from "./src/api.js";

// Inicializar logger
const log = createLogger(config.LOG_LEVEL);

// Iniciar el bot de WhatsApp
start(log).catch((e) => {
  log.error("Fatal init:", e);
  process.exit(1);
});

// Iniciar el servidor HTTP API
const app = createServer(log);
startServer(app, log);
