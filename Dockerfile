FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium xvfb x11vnc fluxbox novnc websockify \
    fonts-liberation fonts-noto-color-emoji ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js start-browser.sh index.html ./
RUN chmod +x /app/start-browser.sh \
    && mkdir -p /tmp/.X11-unix \
    && chown -R node:node /app

ENV PORT=10000 \
    DISPLAY=:99 \
    SCREEN_WIDTH=1280 \
    SCREEN_HEIGHT=800 \
    SCREEN_DEPTH=24 \
    BROWSER_START_URL=https://example.com \
    NOVNC_WEB=/usr/share/novnc

EXPOSE 10000
CMD ["/app/start-browser.sh"]