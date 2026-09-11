// Local runner mirroring Vercel: serves index.html and routes /api/mcap to the serverless handler.
// Usage: node dev.js   (reads ALCHEMY_KEY etc. from .env)
const fs = require('fs');
const http = require('http');
const path = require('path');
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch (e) {}
const mcap = require('./api/mcap.js');
const admin = require('./api/admin.js');
const port = Number(process.env.PORT || 3000);
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/mcap') return mcap(req, res);
  if (url.pathname === '/api/admin') return admin(req, res);
  if (url.pathname === '/admin' || url.pathname === '/admin.html') { res.setHeader('content-type', 'text/html; charset=utf-8'); return fs.createReadStream(path.join(__dirname, 'admin.html')).pipe(res); }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
  }
  res.statusCode = 404; res.end('not found');
}).listen(port, () => console.log(`dev server on http://localhost:${port}`));
