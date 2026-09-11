// Shared config store for the serverless functions (files starting with "_" are not exposed as routes).
// Production: Upstash Redis (Vercel Storage → Redis; env vars are added automatically).
// Local dev without Redis: a JSON file in the OS temp dir (not persistent on Vercel — dev only).
const fs = require('fs');
const os = require('os');
const path = require('path');

const KEY = 'flip:config';
const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const FILE = path.join(os.tmpdir(), 'flip-config.json');

async function redis(cmd) {
  const r = await fetch(URL, { method: 'POST', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error('store: ' + j.error);
  return j.result;
}

const persistent = () => Boolean(URL && TOKEN);

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

module.exports = { getConfig, setConfig, persistent, readJson };
