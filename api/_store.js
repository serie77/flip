// Shared config store for the serverless functions (files starting with "_" are not exposed as routes).
// Production: Upstash Redis attached via Vercel Storage. Vercel injects the REST credentials with a
// prefix you choose in the connect dialog (KV_, STORAGE_, …) — any prefix is detected automatically.
// Local dev without Redis: a JSON file in the OS temp dir (not persistent on Vercel — dev only).
const fs = require('fs');
const os = require('os');
const path = require('path');

const KEY = 'flip:config';
const FILE = path.join(os.tmpdir(), 'flip-config.json');

function creds() {
  const e = process.env;
  if (e.UPSTASH_REDIS_REST_URL && e.UPSTASH_REDIS_REST_TOKEN) return { url: e.UPSTASH_REDIS_REST_URL, token: e.UPSTASH_REDIS_REST_TOKEN, via: 'UPSTASH_REDIS_REST_*' };
  for (const k of Object.keys(e)) {
    const m = k.match(/^(.*)REST_API_URL$/);
    if (m && e[k] && e[m[1] + 'REST_API_TOKEN']) return { url: e[k], token: e[m[1] + 'REST_API_TOKEN'], via: m[1] + 'REST_API_*' };
  }
  return null;
}

async function redis(cmd) {
  const c = creds();
  const r = await fetch(c.url, { method: 'POST', headers: { authorization: 'Bearer ' + c.token, 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error('store: ' + j.error);
  return j.result;
}

const persistent = () => Boolean(creds());
const storeName = () => (creds() || {}).via || 'temp file (dev only)';

async function ping() {
  if (!persistent()) return false;
  return (await redis(['PING'])) === 'PONG';
}

async function getConfig() {
  if (persistent()) {
    const v = await redis(['GET', KEY]);
    return v ? JSON.parse(v) : null;
  }
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return null; }
}

async function setConfig(cfg) {
  const v = JSON.stringify(cfg);
  if (persistent()) { await redis(['SET', KEY, v]); return; }
  fs.writeFileSync(FILE, v);
}

// body parsing that works on Vercel (req.body pre-parsed) and on a bare http server
async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = typeof req.body === 'string' ? req.body : '';
  if (!raw) raw = await new Promise(resolve => { let s = ''; req.on('data', c => s += c); req.on('end', () => resolve(s)); });
  try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; }
}

module.exports = { getConfig, setConfig, persistent, storeName, ping, readJson };
