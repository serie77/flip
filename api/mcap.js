// Vercel serverless function: $FLIP market cap straight from the chain via Alchemy.
// The Alchemy key lives in the ALCHEMY_KEY env var — it never reaches the browser.
// The tracked contract comes from the admin store (set via /admin), falling back to the CA env var.
// Price = Uniswap pool state (v4: PoolManager.extsload(slot0), v3: pool.slot0(), v2: getReserves()),
// supply = totalSupply - burned. Vercel's edge caches the response (s-maxage) so Alchemy is hit
// at most once per few seconds regardless of how many people are watching.
const { keccak256 } = require('js-sha3');
const { getConfig } = require('./_store.js');

const KEY = process.env.ALCHEMY_KEY;
const NET = process.env.ALCHEMY_NETWORK || 'robinhood-mainnet';
const DEX_CHAIN = process.env.DEX_CHAIN || 'robinhood';          // DexScreener chain id, used once for pool discovery
const CA_DEFAULT = (process.env.CA || '0x83d38b519308fe02158f043952b58a6b16a4a30e').toLowerCase();
const POOL_MANAGERS = { 'robinhood-mainnet': '0x8366a39cc670b4001a1121b8f6a443a643e40951' }; // Uniswap v4 singleton
const STABLES = new Set(['USDC', 'USDT', 'USDG', 'DAI', 'USDE', 'FDUSD', 'PYUSD']);
const DEAD = ['0x000000000000000000000000000000000000dead', '0x0000000000000000000000000000000000000000'];
const ZERO = '0x0000000000000000000000000000000000000000';
const CACHE_SECONDS = Number(process.env.CACHE_SECONDS || 5);

const RPC = `https://${NET}.g.alchemy.com/v2/${KEY}`;
const sel = sig => '0x' + keccak256(sig).slice(0, 8);
const pad = h => String(h).replace(/^0x/, '').padStart(64, '0');
const SEL = {
  decimals: sel('decimals()'), totalSupply: sel('totalSupply()'), balanceOf: sel('balanceOf(address)'),
  symbol: sel('symbol()'), slot0: sel('slot0()'), getReserves: sel('getReserves()'), extsload: sel('extsload(bytes32)'),
};

async function rpc(method, params) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']);
const uint = hex => BigInt(hex);
function str(hex) { // ABI string decode
  const b = Buffer.from(hex.slice(2), 'hex');
  const len = Number(BigInt('0x' + b.slice(32, 64).toString('hex')));
  return b.slice(64, 64 + len).toString('utf8');
}

// ---- memoised state (per warm instance); reset when the tracked contract changes ----
const memo = { cfgAt: 0, cfg: null, ca: null, pool: null, poolAt: 0, meta: null, supply: null, supplyAt: 0, eth: null, ethAt: 0 };
const fresh = (at, ms) => Date.now() - at < ms;

async function config() {
  if (memo.cfg && fresh(memo.cfgAt, 15e3)) return memo.cfg;
  let stored = null;
  try { stored = await getConfig(); } catch (e) { /* store down: keep last/default */ }
  const cfg = stored && 'ca' in stored ? stored : { ca: CA_DEFAULT }; // ca:null = deliberately cleared (not launched)
  if (cfg.ca !== memo.ca) { memo.ca = cfg.ca; memo.pool = null; memo.meta = null; memo.supply = null; }
  memo.cfg = cfg; memo.cfgAt = Date.now();
  return cfg;
}

async function pool(cfg) {
  if (memo.pool && fresh(memo.poolAt, 3600e3)) return memo.pool;
  let p;
  if (cfg.pool) p = { version: cfg.version || 'v4', pool: cfg.pool, quote: cfg.quote || ZERO };
  else if (process.env.POOL && cfg.ca === CA_DEFAULT) p = { version: process.env.POOL_VERSION || 'v4', pool: process.env.POOL, quote: (process.env.QUOTE || ZERO).toLowerCase() };
  else {
    // one-time discovery of the pool id (not the price) — set a pool override in /admin to skip this
    const j = await (await fetch(`https://api.dexscreener.com/latest/dex/tokens/${cfg.ca}`)).json();
    const pairs = (j.pairs || []).filter(x => x.chainId === DEX_CHAIN && x.baseToken.address.toLowerCase() === cfg.ca)
      .sort((a, b) => ((b.liquidity && b.liquidity.usd) || 0) - ((a.liquidity && a.liquidity.usd) || 0));
    if (!pairs.length) return null;
    const best = pairs[0];
    p = { version: (best.labels || ['v3'])[0], pool: best.pairAddress, quote: best.quoteToken.address.toLowerCase() };
  }
  memo.pool = p; memo.poolAt = Date.now();
  return p;
}

async function meta(ca, p) {
  if (memo.meta) return memo.meta;
  const dec = Number(uint(await call(ca, SEL.decimals)));
  const sym = str(await call(ca, SEL.symbol));
  let qDec = 18, qSym = 'ETH';
  if (p.quote !== ZERO) {
    qDec = Number(uint(await call(p.quote, SEL.decimals)));
    qSym = str(await call(p.quote, SEL.symbol)).toUpperCase();
  }
  memo.meta = { dec, sym, qDec, qSym, tokenIs0: BigInt(ca) < BigInt(p.quote) };
  return memo.meta;
}

async function supply(ca, dec) {
  if (memo.supply != null && fresh(memo.supplyAt, 600e3)) return memo.supply;
  let s = uint(await call(ca, SEL.totalSupply));
  for (const a of DEAD) s -= uint(await call(ca, SEL.balanceOf + pad(a)));
  memo.supply = Number(s) / 10 ** dec; memo.supplyAt = Date.now();
  return memo.supply;
}

async function ethUsd() {
  if (memo.eth && fresh(memo.ethAt, 60e3)) return memo.eth;
  const j = await (await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot')).json();
  memo.eth = Number(j.data.amount); memo.ethAt = Date.now();
  return memo.eth;
}

// price of 1 whole token in whole quote units
async function priceInQuote(p, m) {
  if (p.version === 'v2') {
    const raw = await call(p.pool, SEL.getReserves);
    const r0 = Number(uint('0x' + raw.slice(2, 66))), r1 = Number(uint('0x' + raw.slice(66, 130)));
    const [rt, rq] = m.tokenIs0 ? [r0, r1] : [r1, r0];
    return (rq / 10 ** m.qDec) / (rt / 10 ** m.dec);
  }
  let sqrtP;
  if (p.version === 'v4') {
    const pm = process.env.POOL_MANAGER || POOL_MANAGERS[NET];
    if (!pm) throw new Error('POOL_MANAGER unknown for ' + NET);
    const slot = '0x' + keccak256(Buffer.from(pad(p.pool) + pad('6'), 'hex')); // _pools[poolId] lives at mapping slot 6
    sqrtP = uint(await call(pm, SEL.extsload + slot.slice(2))) & ((1n << 160n) - 1n);
  } else { // v3
    sqrtP = uint('0x' + (await call(p.pool, SEL.slot0)).slice(2, 66));
  }
  const raw = (Number(sqrtP) / 2 ** 96) ** 2;               // token1 per token0, raw units
  const t1per0 = raw * 10 ** (m.tokenIs0 ? m.dec : m.qDec) / 10 ** (m.tokenIs0 ? m.qDec : m.dec);
  return m.tokenIs0 ? t1per0 : 1 / t1per0;
}

module.exports = async (req, res) => {
  const send = (code, body, cache) => {
    res.statusCode = code;
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', cache ? `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 3}` : 'no-store');
    res.end(JSON.stringify(body));
  };
  try {
    if (!KEY) return send(500, { error: 'server not configured' });
    const cfg = await config();
    if (!cfg.ca) return send(200, { mc: 0, ca: null, status: 'not launched', ts: Date.now() }, true);
    const p = await pool(cfg);
    if (!p) return send(200, { mc: 0, ca: cfg.ca, status: 'waiting for pool', ts: Date.now() }, true);
    const m = await meta(cfg.ca, p);
    const [pq, sup] = await Promise.all([priceInQuote(p, m), supply(cfg.ca, m.dec)]);
    let usdPerQuote;
    if (m.qSym === 'ETH' || m.qSym === 'WETH') usdPerQuote = await ethUsd();
    else if (STABLES.has(m.qSym)) usdPerQuote = 1;
    else return send(503, { error: 'unsupported quote token ' + m.qSym, ca: cfg.ca });
    const price = pq * usdPerQuote;
    send(200, { mc: price * sup, ca: cfg.ca, price, priceQuote: pq, quote: m.qSym, usdPerQuote, supply: sup, symbol: m.sym, pool: p.pool, version: p.version, source: 'alchemy:' + NET, ts: Date.now() }, true);
  } catch (e) {
    send(503, { error: 'feed unavailable', detail: e.message.slice(0, 120) });
  }
};
