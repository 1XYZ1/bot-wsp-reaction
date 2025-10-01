# Estructura del Proyecto

Esta carpeta contiene el código del bot organizado en módulos.

## Arquitectura

```
src/
├── logger.js      - Sistema de logging con niveles (error, warn, info, debug)
├── config.js      - Configuración y variables de entorno
├── utils.js       - Funciones utilitarias (normJid, preview, getMessageText, etc.)
├── state.js       - Estado global del bot (socket, grupos, reacciones, etc.)
├── filters.js     - Lógica de filtros para mensajes
├── whatsapp.js    - Lógica de conexión Baileys y manejo de mensajes
├── api.js         - Servidor Express y endpoints HTTP
└── README.md      - Esta documentación
```

## Módulos

### `logger.js`

Sistema de logging minimalista con colores y niveles configurables.

**Exports:**

- `createLogger(logLevel)` - Crea un logger con el nivel especificado

### `config.js`

Carga y valida todas las variables de entorno.

**Exports:**

- `config` - Objeto con todas las variables de configuración
- `MIN_DELAY`, `MAX_DELAY`, `MIN_MSG_CHARS_INT` - Valores parseados
- `QR_TTL_MS`, `REACTED_MAX_SIZE` - Constantes

### `utils.js`

Funciones utilitarias reutilizables.

**Exports:**

- `sleep(ms)` - Promise que resuelve después de ms milisegundos
- `rand(min, max)` - Número aleatorio entre min y max
- `ensureDir(path)` - Crea directorio si no existe
- `fold(string)` - Normaliza texto (sin acentos, minúsculas)
- `digits(string)` - Extrae solo dígitos
- `preview(text, n)` - Vista previa de texto limitada
- `normJid(jid)` - Normaliza JID de WhatsApp
- `extractPhoneFromJid(jid)` - Extrae número de teléfono del JID
- `getMessageText(msg)` - Extrae texto de diferentes tipos de mensajes
- `getParticipantJid(msg)` - Obtiene el JID del participante

### `state.js`

Maneja el estado global del bot de forma centralizada.

**Exports:**

- `state` - Objeto con el estado global
- `WANTED_GROUP_SUBS` - Lista de grupos configurados
- `USE_ALLOW_JIDS` - Flag para usar whitelist
- `ALLOWED_JIDS_SET` - Set de JIDs permitidos
- Funciones getter/setter para acceder al estado de forma segura

### `filters.js`

Lógica de filtrado de mensajes.

**Exports:**

- `rememberSender(jid, group, text)` - Guarda remitente en historial
- `passesSenderFilters(participantJid)` - Verifica si el remitente pasa los filtros

### `whatsapp.js`

Lógica principal de conexión y manejo de mensajes de WhatsApp.

**Exports:**

- `start(log)` - Inicia la conexión con WhatsApp
- `refreshAllowedGroups(sock, log)` - Actualiza lista de grupos permitidos
- `cleanReactedSet(log)` - Limpia el Set de reacciones para evitar memory leaks

### `api.js`

Servidor HTTP con API REST y panel de administración.

**Exports:**

- `createServer(log)` - Crea y configura el servidor Express
- `startServer(app, log)` - Inicia el servidor HTTP

**Endpoints:**

- `GET /status` - Estado del bot
- `GET /qr` - Página HTML para escanear QR
- `GET /qr.png` - Imagen del QR
- `POST /pairing-code` - Genera código de emparejamiento
- `POST /listener` - Activa/desactiva el bot
- `GET /recent-senders` - Últimos remitentes
- `GET /admin` - Panel de administración web

## Flujo de Ejecución

1. **index.js** carga el logger desde `logger.js`
2. **index.js** importa configuración de `config.js`
3. **whatsapp.js** inicia la conexión usando `state.js` y `utils.js`
4. **api.js** crea el servidor HTTP que interactúa con `state.js`
5. Los mensajes entrantes son procesados por `whatsapp.js` usando `filters.js` y `utils.js`

## Beneficios de esta Arquitectura

✅ **Separación de responsabilidades** - Cada módulo tiene un propósito claro
✅ **Testeable** - Cada módulo se puede testear independientemente
✅ **Mantenible** - Más fácil encontrar y modificar código
✅ **Escalable** - Fácil agregar nuevas funcionalidades
✅ **Reutilizable** - Las funciones están bien organizadas
✅ **Sin pérdida de funcionalidad** - Todo el código original está preservado
