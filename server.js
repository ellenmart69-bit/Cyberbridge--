
'use strict';

const express = require('express');
const http = require('http');
const httpProxy = require('http-proxy');
const crypto = require('crypto');
const path = require('path');

const app = express();
const server = http.createServer(app);
const proxy = httpProxy.createProxyServer({
  ws: true,
  changeOrigin: true
});

const PORT = Number(process.env.PORT || 10000);
const PASSWORD = process.env.BROWSER_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const COOKIE_NAME = 'rcb_session';
const COOKIE_SECURE = process.env.COOKIE_SECURE !== 'false';

if (!PASSWORD || PASSWORD.length < 12) {
  console.error('FATAL: Set BROWSER_PASSWORD to a password of at least 12 characters.');
  process.exit(1);
}

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('FATAL: Set SESSION_SECRET to a random secret of at least 32 characters.');
  process.exit(1);
}

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(express.json({ limit: '10kb' }));

function sign(value) {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(value)
    .digest('base64url');
}

function sessionToken() {
  const payload =
    `${Date.now() + 12 * 60 * 60 * 1000}.` +
    crypto.randomBytes(24).toString('base64url');

  return `${payload}.${sign(payload)}`;
}

function validToken(token) {
  if (!token || token.length > 500) return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;

  const payload = `${parts[0]}.${parts[1]}`;
  const expected = sign(payload);
  const actual = parts[2];

  const a = Buffer.from(expected);
  const b = Buffer.from(actual);

  if (a.length !== b.length) return false;
  if (!crypto.timingSafeEqual(a, b)) return false;

  return Number(parts[0]) > Date.now();
}

function parseCookies(header = '') {
  const out = {};

  for (const item of header.split(';')) {
    const i = item.indexOf('=');
    if (i <= 0) continue;

    const key = item.slice(0, i).trim();
    const value = item.slice(i + 1).trim();

    try {
      out[key] = decodeURIComponent(value);
    } catch {
      // Ignore malformed cookie values.
    }
  }

  return out;
}

function authenticated(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return validToken(cookies[COOKIE_NAME]);
}

function setSession(res) {
  const token = sessionToken();

  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; ` +
    `HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` +
    (COOKIE_SECURE ? '; Secure' : '')
  );
}

function loginPage(error = '') {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Remote Browser Login</title>
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;
background:#0b1020;color:#eef3ff;font:16px system-ui}
main{width:min(92vw,420px);padding:28px;border:1px solid #29334d;
border-radius:18px;background:#111a2d}
h1{margin-top:0}
p{color:#b9c5dc}
input,button{width:100%;padding:13px;border-radius:10px;font:inherit}
input{background:#080d18;color:white;border:1px solid #46516b;margin:12px 0}
button{border:0;background:#20d8ee;color:#06131a;font-weight:700;cursor:pointer}
.error{color:#ff8989}
</style>
</head>
<body>
<main>
<h1>Remote Browser</h1>
<p>Enter the browser access password to start a private remote session.</p>
${error ? '<p class="error">Incorrect password. Try again.</p>' : ''}
<form method="post" action="/login">
<input type="password" name="password" placeholder="Access password"
autocomplete="current-password" required autofocus>
<button type="submit">Open browser</button>
</form>
</main>
</body>
</html>`;
}

app.get('/healthz', (_req, res) => {
  res.status(200).send('ok');
});

app.get('/login', (req, res) => {
  if (authenticated(req)) return res.redirect('/');
  res.type('html').send(loginPage());
});

app.post('/login', (req, res) => {
  const supplied = String(req.body.password || '');
  const a = Buffer.from(supplied);
  const b = Buffer.from(PASSWORD);

  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!ok) {
    return res.status(401).type('html').send(loginPage('Incorrect password'));
  }

  setSession(res);
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` +
    (COOKIE_SECURE ? '; Secure' : '')
  );

  res.redirect('/login');
});

// Protect all routes except health checking and login.
app.use((req, res, next) => {
  if (req.path === '/healthz' || req.path === '/login') {
    return next();
  }

  if (!authenticated(req)) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Login required' });
    }

    return res.redirect('/login');
  }

  next();
});

app.use(
  '/novnc',
  express.static(
    process.env.NOVNC_WEB || '/usr/share/novnc',
    { fallthrough: false, index: false }
  )
);

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    browser: 'Chromium',
    display:
      `${process.env.SCREEN_WIDTH || 1280}x` +
      `${process.env.SCREEN_HEIGHT || 800}`
  });
});

// Register this handler once, outside the upgrade callback.
proxy.on('error', (err, _req, socket) => {
  console.error('WebSocket proxy error:', err.message);

  if (socket && !socket.destroyed) {
    socket.destroy();
  }
});

// Authenticate WebSocket upgrades before forwarding to websockify.
server.on('upgrade', (req, socket, head) => {
  let pathname;

  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    socket.destroy();
    return;
  }

  if (pathname !== '/websockify' || !authenticated(req)) {
    socket.write(
      'HTTP/1.1 401 Unauthorized\r\n' +
      'Connection: close\r\n\r\n'
    );
    socket.destroy();
    return;
  }

  proxy.ws(req, socket, head, {
    target: 'ws://127.0.0.1:6080'
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Remote browser listening on ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received; closing HTTP server.');

  server.close(() => {
    process.exit(0);
  });

  setTimeout(() => process.exit(1), 10000).unref();
});
