
#!/bin/sh
set -eu

export DISPLAY="${DISPLAY:-:99}"
WIDTH="${SCREEN_WIDTH:-1280}"
HEIGHT="${SCREEN_HEIGHT:-800}"
DEPTH="${SCREEN_DEPTH:-24}"
NOVNC_WEB="${NOVNC_WEB:-/usr/share/novnc}"

DISPLAY_NUM="$(printf '%s' "$DISPLAY" | sed 's/^://' | cut -d. -f1)"
LOCK="/tmp/.X${DISPLAY_NUM}-lock"
SOCKET="/tmp/.X11-unix/X${DISPLAY_NUM}"

mkdir -p /tmp/.X11-unix

# Remove only a stale X lock. Never delete a lock owned by a live Xvfb.
if [ -f "$LOCK" ]; then
  OLD_PID="$(cat "$LOCK" 2>/dev/null || true)"

  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    OLD_NAME="$(cat "/proc/$OLD_PID/comm" 2>/dev/null || true)"

    if [ "$OLD_NAME" = "Xvfb" ]; then
      echo "FATAL: Xvfb is already running on display $DISPLAY (PID $OLD_PID)."
      echo "Check for duplicate startup commands in your Render configuration."
      exit 1
    fi
  fi

  echo "Removing stale X lock: $LOCK"
  rm -f "$LOCK"

  # The lock was stale, so its corresponding socket may be stale too.
  rm -f "$SOCKET"
fi

if [ -S "$SOCKET" ]; then
  echo "FATAL: X socket $SOCKET exists without a usable lock."
  echo "Refusing to delete a possibly active display socket."
  exit 1
fi

echo "Starting Xvfb on $DISPLAY at ${WIDTH}x${HEIGHT}x${DEPTH}..."
Xvfb "$DISPLAY" \
  -screen 0 "${WIDTH}x${HEIGHT}x${DEPTH}" \
  -ac +extension GLX +render -noreset \
  >/tmp/xvfb.log 2>&1 &

XVFB_PID=$!

# Wait up to 10 seconds for Xvfb to create its socket.
READY=0
i=0
while [ "$i" -lt 20 ]; do
  if ! kill -0 "$XVFB_PID" 2>/dev/null; then
    echo "FATAL: Xvfb exited during startup."
    cat /tmp/xvfb.log || true
    exit 1
  fi

  if [ -S "$SOCKET" ]; then
    READY=1
    break
  fi

  sleep 0.5
  i=$((i + 1))
done

if [ "$READY" -ne 1 ]; then
  echo "FATAL: Xvfb did not become ready on $DISPLAY."
  cat /tmp/xvfb.log || true
  exit 1
fi

echo "Starting Fluxbox..."
fluxbox >/tmp/fluxbox.log 2>&1 &

echo "Starting Chromium..."
chromium \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --disable-features=Translate,BackForwardCache \
  --no-first-run \
  --no-default-browser-check \
  --start-maximized \
  --user-data-dir=/tmp/chromium-profile \
  "${BROWSER_START_URL:-https://example.com}" \
  >/tmp/chromium.log 2>&1 &

echo "Starting loopback-only VNC..."
x11vnc \
  -display "$DISPLAY" \
  -forever -shared -nopw -localhost -rfbport 5900 \
  >/tmp/x11vnc.log 2>&1 &

echo "Starting WebSocket bridge..."
websockify \
  --web="$NOVNC_WEB" \
  6080 127.0.0.1:5900 \
  >/tmp/websockify.log 2>&1 &

# Give the services a moment to initialize and catch immediate failures.
sleep 2

if ! kill -0 "$XVFB_PID" 2>/dev/null; then
  echo "FATAL: Xvfb stopped."
  cat /tmp/xvfb.log || true
  exit 1
fi

if ! kill -0 "$(pgrep -n -x x11vnc || echo 0)" 2>/dev/null; then
  echo "WARNING: Check /tmp/x11vnc.log if the browser cannot connect."
fi

echo "Desktop startup complete. Starting Node server..."
exec node /app/server.js
