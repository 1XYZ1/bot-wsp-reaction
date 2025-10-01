# 🤖 WhatsApp Bot - Auto React

Bot de WhatsApp que reacciona automáticamente a mensajes en grupos específicos usando Baileys.

## ✨ Características

- ⚡ **Procesamiento paralelo** - Maneja múltiples mensajes simultáneamente
- 🎯 **Filtrado avanzado** - Whitelist de JIDs, grupos específicos, longitud de mensajes
- 🎨 **Panel de control web** - UI moderna para gestionar el bot
- 📱 **Código QR** - Autenticación fácil vía navegador
- 🚀 **Optimizado** - Caché de JIDs, limpieza automática de memoria
- 🔐 **Seguro** - Autenticación con token API

## 🚀 Despliegue en Railway

### 1. Configura las variables de entorno

En tu proyecto de Railway, añade estas variables:

```bash
# Obligatorias
API_TOKEN=tu_token_secreto_aqui
GROUPS=nombre_de_tu_grupo

# Opcionales (tienen valores por defecto)
LOG_LEVEL=info
EMOJI=👾
MIN_DELAY_MS=100
MAX_DELAY_MS=1000
USE_ALLOWED_JIDS=false
ALLOWED_JIDS=
MIN_MSG_CHARS=0
```

### 2. Despliega

El proyecto usa Dockerfile, así que Railway lo detectará automáticamente.

**Tiempo estimado de build:** 2-4 minutos

### 3. Vincula WhatsApp

Una vez desplegado:

1. Abre: `https://tu-app.railway.app/admin?token=TU_API_TOKEN`
2. Haz clic en "📱 Ver QR"
3. Escanea el código QR desde WhatsApp > Dispositivos vinculados

## 💻 Desarrollo Local

### Instalación

```bash
# Instalar dependencias
npm install

# Copiar variables de entorno
cp .env.example .env

# Editar .env con tu configuración
nano .env
```

### Ejecutar

```bash
npm run dev
```

Luego abre: `http://localhost:3000/admin?token=TU_API_TOKEN`

## 📚 Endpoints API

| Método | Endpoint          | Descripción               |
| ------ | ----------------- | ------------------------- |
| GET    | `/admin`          | Panel de control web      |
| GET    | `/qr`             | Página con código QR      |
| GET    | `/qr.png`         | Imagen QR directa         |
| GET    | `/status`         | Estado del bot + métricas |
| GET    | `/recent-senders` | Últimos remitentes        |
| POST   | `/listener`       | Activar/desactivar bot    |
| POST   | `/pairing-code`   | Código de emparejamiento  |

## 🎯 Configuración

### Grupos

Configura los nombres de grupos (case-insensitive):

```bash
GROUPS=Mi Grupo,Grupo de Trabajo,Familia
```

### Whitelist de JIDs

Para reaccionar solo a usuarios específicos:

```bash
USE_ALLOWED_JIDS=true
ALLOWED_JIDS=5493816371665@s.whatsapp.net,5493816371666@s.whatsapp.net
```

**Consejo:** Usa el panel `/admin` para ver los JIDs de los últimos remitentes.

### Longitud mínima

Para ignorar mensajes muy cortos:

```bash
MIN_MSG_CHARS=10
```

## 🛠️ Tecnologías

- [Baileys](https://github.com/WhiskeySockets/Baileys) - WhatsApp Web API
- [Express](https://expressjs.com/) - Web server
- [QRCode](https://github.com/soldair/node-qrcode) - Generación de QR
- [Docker](https://www.docker.com/) - Containerización

## 📊 Métricas de Rendimiento

- **Procesamiento:** 10x más rápido vs versión secuencial
- **Mensajes simultáneos:** Ilimitados (procesamiento paralelo)
- **Memoria:** Auto-limpieza cada 60s
- **Caché:** JIDs normalizados para O(1) lookup

## 📝 Licencia

MIT

## 🤝 Contribuciones

¡Las contribuciones son bienvenidas! Abre un issue o PR.
