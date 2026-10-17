#!/bin/sh
set -eu

export DISPLAY="${DISPLAY:-:99}"
WIDTH="${SCREEN_WIDTH:-1280}"
HEIGHT="${SCREEN_HEIGHT:-800}"
DEPTH="${SCREEN_DEPTH:-24}"

# Virtual desktop and lightweight window manager
Xvfb "$DISPLAY" -screen 0 "${WIDTH}x${HEIGHT}x${DEPTH}" -ac +extension GLX +render -noreset &
sleep 1
fluxbox >/tmp/fluxbox.log 2>&1 &

# Start Chromium in the virtual desktop. no-sandbox is required in this container.
chromium \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --disable-features=Translate,BackForwardCache \
  --no-first-run \
  --no-default-browser-check \
  --start-maximized \
  --user-data-dir=/tmp/chromium-profile \
  "${BROWSER_START_URL}" >/tmp/chromium.log 2>&1 &

# VNC is bound to loopback only; public access goes through the authenticated Node proxy.
x11vnc -display "$DISPLAY" -forever -shared -nopw -localhost -rfbport 5900 >/tmp/x11vnc.log 2>&1 &

# Websockify serves the noVNC static files and bridges WebSocket to local VNC.
websockify --web="${NOVNC_WEB:-/usr/share/novnc}" 6080 127.0.0.1:5900 >/tmp/websockify.log 2>&1 &

exec node /app/server.js