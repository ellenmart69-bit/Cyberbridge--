# Remote Cloud Browser

A single-session live remote Chromium desktop. Chromium runs inside Docker under Xvfb; x11vnc exposes the virtual desktop only on loopback; noVNC/websockify streams the screen; Node.js serves the UI and authenticates the WebSocket before proxying it.

## Important security notes

- This is a **single shared browser session**, not a multi-user browser farm.
- The public service URL is public, but browser access requires `BROWSER_PASSWORD`.
- Set a strong password (at least 12 characters) and keep the repository private if you don't want deployment secrets exposed.
- Do not browse banking, email, password managers, or other sensitive accounts. Anyone with legitimate access to the remote session may see its contents.
- Chromium uses `--no-sandbox` because of container constraints. Run this only as a disposable browser for ordinary browsing; do not use it for sensitive sessions or untrusted multi-tenant workloads.
- No proxy is included. A free public proxy is not reliable or safe for credentials.

## Run locally

Requirements: Docker Desktop or Docker Engine.

```sh
docker build -t remote-cloud-browser .
docker run --rm -p 10000:10000 \
  -e BROWSER_PASSWORD='replace-with-a-long-password' \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e COOKIE_SECURE=false \
  remote-cloud-browser
```

Open http://localhost:10000. Sign in with `BROWSER_PASSWORD`.

## Deploy to Render (free for testing)

1. Create a GitHub repository and upload all project files.
2. In Render, choose **New + → Web Service**, connect the repository, and select the **Free** plan.
3. Runtime should be Docker (Render detects the Dockerfile).
4. Add environment variables:
   - `BROWSER_PASSWORD`: a unique password of at least 12 characters.
   - `SESSION_SECRET`: a random secret of at least 32 characters. Generate locally with `openssl rand -hex 32`.
   - `COOKIE_SECURE`: `true`.
   - `SCREEN_WIDTH`: `1280`.
   - `SCREEN_HEIGHT`: `800`.
   - `BROWSER_START_URL`: `https://example.com`.
5. Deploy and wait for the build to finish. Open the assigned `https://<service-name>.onrender.com` URL and log in.
6. If deploying via Blueprint, review the environment variables and fill in `BROWSER_PASSWORD` before relying on the service.

## Free-plan limits

Render free web services have 750 free instance hours per workspace per calendar month, spin down after 15 minutes without inbound HTTP traffic or WebSocket messages, and can take about a minute to wake. Free instances have limited CPU/RAM, ephemeral storage, and may restart. Browser memory use can exceed the available resources, especially on complex websites. Free resources are not unlimited or suitable for a production service. See https://render.com/docs/free.

## Controls

- Use the browser canvas to click, type, scroll, and use keyboard shortcuts.
- Use the URL field to navigate. The URL field sends ordinary ASCII URLs through the remote keyboard; for complex URLs, click inside the remote browser and use Ctrl+L to enter the address directly.
- Reconnect restarts the noVNC connection, not the browser process.
- Fullscreen expands the remote display.

## Troubleshooting

- **502 / connection failed:** the browser processes may still be starting or the service may have run out of memory. Check deployment logs.
- **Login loop on localhost:** set `COOKIE_SECURE=false` only for local HTTP. Keep it `true` on HTTPS hosting.
- **White or disconnected screen:** refresh the page, click Reconnect, and inspect container logs.
- **Container exits immediately:** check that both required secrets are set.
- **Build failure:** confirm Dockerfile, `server.js`, `start-browser.sh`, `index.html`, and `package.json` are all at the repository root.

## Project layout

- `Dockerfile` — browser + virtual desktop dependencies
- `start-browser.sh` — starts Xvfb, Fluxbox, Chromium, x11vnc, and websockify
- `server.js` — login/session protection, HTTP UI, WebSocket proxy
- `index.html` — noVNC interface and controls
- `render.yaml` — optional Render Blueprint
