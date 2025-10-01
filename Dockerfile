# Dockerfile optimizado para Railway
FROM node:20-alpine

# Instalar dependencias del sistema necesarias para Baileys
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev

WORKDIR /app

# Copiar package files
COPY package*.json ./

# Instalar dependencias (usar cache de npm)
RUN npm ci --only=production --ignore-scripts && \
    npm rebuild && \
    npm cache clean --force

# Copiar el resto del código
COPY . .

# Crear directorio de sesiones
RUN mkdir -p sessions

# Puerto por defecto de Railway
ENV PORT=3000
EXPOSE 3000

# Comando de inicio
CMD ["node", "index.js"]
