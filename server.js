const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data', 'users.json');

function ensureData() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
}
function readUsers() {
  ensureData();
  try {
    const list = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (e) { return []; }
}
function writeUsers(users) {
  ensureData();
  fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2), 'utf8');
}

/** Merge incoming users into existing by email — never drop other members */
function mergeUsers(existing, incoming) {
  const map = {};
  (existing || []).forEach(u => {
    if (u && u.email) map[String(u.email).toLowerCase()] = u;
  });
  (incoming || []).forEach(u => {
    if (!u || !u.email) return;
    const key = String(u.email).toLowerCase();
    const prev = map[key];
    if (!prev) {
      map[key] = u;
    } else {
      // merge fields; prefer longer bookings list / newer data
      const bookings = (u.bookings && u.bookings.length >= (prev.bookings || []).length)
        ? u.bookings
        : (prev.bookings || []);
      map[key] = Object.assign({}, prev, u, { bookings: bookings });
    }
  });
  return Object.values(map);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};
function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') { send(res, 204, ''); return; }

  if (urlPath === '/api/users') {
    if (method === 'GET') {
      send(res, 200, JSON.stringify(readUsers()), 'application/json; charset=utf-8');
      return;
    }
    if (method === 'POST' || method === 'PUT') {
      let buf = '';
      req.on('data', c => { buf += c; if (buf.length > 8e6) req.destroy(); });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(buf || '[]');
          if (!Array.isArray(parsed)) {
            send(res, 400, JSON.stringify({ error: 'Expected array' }), 'application/json');
            return;
          }
          const merged = mergeUsers(readUsers(), parsed);
          writeUsers(merged);
          send(res, 200, JSON.stringify({ ok: true, count: merged.length }), 'application/json; charset=utf-8');
        } catch (e) {
          send(res, 400, JSON.stringify({ error: 'Invalid JSON' }), 'application/json');
        }
      });
      return;
    }
    send(res, 405, 'Method not allowed');
    return;
  }

  // Upsert single user — safest for register/book
  if (urlPath === '/api/user' && method === 'POST') {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 5e6) req.destroy(); });
    req.on('end', () => {
      try {
        const user = JSON.parse(buf || '{}');
        if (!user.email) {
          send(res, 400, JSON.stringify({ error: 'email required' }), 'application/json');
          return;
        }
        const merged = mergeUsers(readUsers(), [user]);
        writeUsers(merged);
        send(res, 200, JSON.stringify({ ok: true, count: merged.length }), 'application/json');
      } catch (e) {
        send(res, 400, JSON.stringify({ error: 'Invalid JSON' }), 'application/json');
      }
    });
    return;
  }

  let filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  if (!filePath.startsWith(ROOT)) { send(res, 403, 'Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      fs.readFile(path.join(ROOT, 'public', 'index.html'), (e2, d2) => {
        if (e2) { send(res, 404, 'Not found'); return; }
        send(res, 200, d2, 'text/html; charset=utf-8');
      });
      return;
    }
    send(res, 200, data, TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
  });
});

ensureData();
server.listen(PORT, () => console.log('HairInk on ' + PORT + ' (merge-safe API)'));
