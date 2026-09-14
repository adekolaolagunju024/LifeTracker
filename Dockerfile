# Debian-based (not alpine) so better-sqlite3's native build and Chromium's
# shared-library dependencies both work without extra fuss. Node 22, not 20
# — puppeteer-core 25.x and the googleapis family both require >=22.
FROM node:22-slim

# Chromium for the PDF/image report exports and the Gantt chart's image
# export (both drive puppeteer-core against a real browser rather than
# bundling Chromium in the npm package). build-essential + python3 cover
# better-sqlite3's native compile if a prebuilt binary isn't available for
# this exact platform.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    build-essential \
    python3 \
    fonts-liberation \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# SQLite lives on a mounted volume so it survives redeploys — see DB_PATH
# in .env.example. Railway: attach a volume at /data.
RUN mkdir -p /data

EXPOSE 3000
CMD ["node", "backend/server.js"]
