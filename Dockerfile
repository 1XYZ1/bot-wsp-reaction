FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p sessions

ENV PORT=3000
EXPOSE 3000
CMD ["node", "index.js"]