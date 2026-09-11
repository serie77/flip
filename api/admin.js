// Owner-only endpoint to point the site at a contract. Auth = ADMIN_SECRET env var (Bearer token).
//   GET  /api/admin            -> current config + readiness checks
//   POST /api/admin {ca, pool?, version?, quote?}  -> save; /api/mcap switches within its cache window
const crypto = require('crypto');
const { getConfig, setConfig, persistent, storeName, ping, readJson } = require('./_store.js');

function authorized(req) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(secret).digest();
  return crypto.timingSafeEqual(a, b);
}

async function checks() {
  const out = { adminSecret: Boolean(process.env.ADMIN_SECRET), alchemyKey: Boolean(process.env.ALCHEMY_KEY), store: { configured: persistent(), via: storeName(), ok: false }, rpc: { ok: false } };
  try { out.store.ok = persistent() ? await ping() : false; } catch (e) { out.store.error = e.message.slice(0, 80); }
  if (out.alchemyKey) {
    try {
      const net = process.env.ALCHEMY_NETWORK || 'robinhood-mainnet';
      const r = await fetch(`https://${net}.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
      const j = await r.json();
      out.rpc = j.result ? { ok: true, network: net, chainId: parseInt(j.result, 16) } : { ok: false, error: (j.error && j.error.message) || 'no result' };
    } catch (e) { out.rpc = { ok: false, error: e.message.slice(0, 80) }; }
  }
  return out;
}

module.exports = async (req, res) => {
  const send = (code, body) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store'); res.end(JSON.stringify(body)); };
  if (!process.env.ADMIN_SECRET) return send(500, { error: 'ADMIN_SECRET is not set' });
  if (!authorized(req)) return send(401, { error: 'unauthorized' });
  try {
    if (req.method === 'GET') {
      let config = null, storeError = null;
      try { config = await getConfig(); } catch (e) { storeError = e.message.slice(0, 80); }
      return send(200, { config, persistent: persistent(), storeError, checks: await checks() });
    }
    if (req.method !== 'POST') return send(405, { error: 'method not allowed' });
    const b = await readJson(req);
    if (b.clear) { const cfg = { ca: null, updatedAt: new Date().toISOString() }; await setConfig(cfg); return send(200, { ok: true, config: cfg, persistent: persistent() }); }
    const ca = String(b.ca || '').trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(ca)) return send(400, { error: 'ca must be a 0x-prefixed 40-hex address' });
    const cfg = { ca, updatedAt: new Date().toISOString() };
    if (b.pool) {
      if (!/^0x[0-9a-f]{40}$|^0x[0-9a-f]{64}$/i.test(String(b.pool))) return send(400, { error: 'pool must be an address (v2/v3) or 32-byte pool id (v4)' });
      cfg.pool = String(b.pool).toLowerCase();
      cfg.version = ['v2', 'v3', 'v4'].includes(b.version) ? b.version : 'v4';
      cfg.quote = /^0x[0-9a-f]{40}$/i.test(String(b.quote || '')) ? String(b.quote).toLowerCase() : '0x0000000000000000000000000000000000000000';
    }
    await setConfig(cfg);
    send(200, { ok: true, config: cfg, persistent: persistent() });
  } catch (e) {
    send(503, { error: 'store unavailable', detail: e.message.slice(0, 120) });
  }
};
