// Builds index.html from template.html by embedding every logo/flag as a data URI.
// PNG logos are pixel-analyzed: blank/near-empty images are rejected (next source is
// tried), white-on-transparent logos are flagged so the page renders them on a dark chip.
// Usage: node build.js
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const tpl = fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8');
const stocks = [...tpl.matchAll(/\bS\('([^']+)'/g)].map(m => m[1]);
const fx = [...tpl.matchAll(/\bF\('([^']+)'/g)].map(m => m[1]);

const FLAG_OVERRIDES = { XOF: null, XAF: null, XCD: 'kn', XCG: 'cw', XPF: 'pf' };
const fav = d => `https://www.google.com/s2/favicons?domain=${d}&sz=128`;
// hand-verified sources for names the logo CDNs don't cover (company favicons, Wikimedia logos)
const LOGO_OVERRIDES = {
  NKLAQ: ['https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f2/Nikola_Motor_Company_logo.svg/330px-Nikola_Motor_Company_logo.svg.png?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail'],
  AABB: [fav('asiabroadbandinc.com')],
  FFAI: ['https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/Faraday_Future_logo.svg/330px-Faraday_Future_logo.svg.png', fav('ff.com')],
};
// currency unions with no flag: central-bank logos (rendered "contain" on a white chip)
const FX_LOGO_OVERRIDES = {
  XOF: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/Central_Bank_of_West_African_States_wordmark.svg/330px-Central_Bank_of_West_African_States_wordmark.svg.png',
  XAF: 'https://upload.wikimedia.org/wikipedia/en/thumb/6/63/Bank_of_Central_African_States_logo.svg/330px-Bank_of_Central_African_States_logo.svg.png',
};

// hand-made SVG chips for entries that have no real-world image
const svgChip = (label, fg) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#131a2c"/><rect width="64" height="64" fill="none" stroke="#26304a" stroke-width="2"/><text x="32" y="39" font-family="Consolas,Menlo,monospace" font-size="${label.length > 3 ? 15 : 19}" font-weight="700" letter-spacing="1" fill="${fg}" text-anchor="middle">${label}</text></svg>`
);

// returns 'ok' | 'dark' (white logo, needs dark chip) | 'reject'
function analyzePng(buf) {
  let png;
  try { png = PNG.sync.read(buf); } catch (e) { return 'ok'; }
  const d = png.data;
  let opaque = 0, white = 0;
  const total = png.width * png.height;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 40) {
      opaque++;
      const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      if (lum > 235) white++;
    }
  }
  const opaqueFrac = opaque / total;
  if (opaqueFrac < 0.02) return 'reject';               // effectively empty
  const whiteFrac = white / opaque;
  if (whiteFrac > 0.85) return opaqueFrac > 0.9 ? 'reject' : 'dark'; // white slab vs white logo
  return 'ok';
}

async function fetchImg(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': 'FlipSite/1.0 (build script)' } });
    if (!r.ok) return null;
    const type = (r.headers.get('content-type') || '').split(';')[0].trim();
    if (!type.startsWith('image/')) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 40) return null;
    return { uri: `data:${type};base64,${buf.toString('base64')}`, buf, png: type === 'image/png' };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function stockLogo(sym) {
  if (sym.includes('·')) return { uri: svgChip('OTC', '#8fa2c9'), cls: 'full' };
  const variants = [...new Set([sym, sym.replace('.', '-'), sym.split('.')[0]])];
  const urls = [
    ...(LOGO_OVERRIDES[sym] || []),
    ...variants.map(v => `https://cdn.jsdelivr.net/gh/nvstly/icons@main/ticker_icons/${v}.png`),
    `https://financialmodelingprep.com/image-stock/${sym}.png`,
  ];
  let best = null;
  for (const url of urls) {
    const got = await fetchImg(url);
    if (!got) continue;
    const verdict = got.png ? analyzePng(got.buf) : 'ok';
    if (verdict === 'ok') return { uri: got.uri };
    if (verdict === 'dark' && !best) best = { uri: got.uri, cls: 'dark' };
  }
  // white logo on dark chip, else a crafted ticker chip — never a bare monogram
  return best || { uri: svgChip(sym.slice(0, 4), '#8fa2c9'), cls: 'full' };
}

/* ---- live market-cap verification via stockanalysis.com ---- */
function parseCap(s) {
  if (typeof s === 'number') return s;
  if (typeof s !== 'string') return null;
  const m = s.trim().match(/^\$?([\d.,]+)\s*([KMBT])?$/i);
  if (!m) return null;
  return parseFloat(m[1].replace(/,/g, '')) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[(m[2] || '').toUpperCase()] || 1);
}
async function fetchJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; } finally { clearTimeout(t); }
}
async function liveCap(sym) {
  const paths = [
    [`stocks/${sym.toLowerCase()}`, `https://stockanalysis.com/stocks/${sym.toLowerCase()}/__data.json`],
    [`quote/otc/${sym.toUpperCase()}`, `https://stockanalysis.com/quote/otc/${sym.toUpperCase()}/__data.json`],
  ];
  for (const [src, url] of paths) {
    const j = await fetchJson(url);
    if (!j) continue;
    for (const node of j.nodes || []) {
      const d = node && node.data;
      if (d && d[0] && typeof d[0] === 'object' && typeof d[0].marketCap === 'number') {
        const c = parseCap(d[d[0].marketCap]);
        if (c) return { c, u: src };
      }
    }
  }
  return null;
}

async function flagImg(sym) {
  if (FX_LOGO_OVERRIDES[sym]) {
    const got = await fetchImg(FX_LOGO_OVERRIDES[sym]);
    if (got) return { uri: got.uri, cls: 'contain' };
    return { uri: svgChip('CFA', '#ffd75e') };
  }
  const cc = sym in FLAG_OVERRIDES ? FLAG_OVERRIDES[sym] : sym.slice(0, 2).toLowerCase();
  if (!cc) return null;
  const got = await fetchImg(`https://flagcdn.com/w40/${cc}.png`);
  return got && { uri: got.uri };
}

async function run() {
  const jobs = [
    ...stocks.map(s => ({ id: 's-' + s, fn: () => stockLogo(s) })),
    ...fx.map(s => ({ id: 'f-' + s, fn: () => flagImg(s) })),
  ];
  const img = {}, cls = {};
  let done = 0, missing = [], dark = [];
  const queue = [...jobs];
  await Promise.all(Array.from({ length: 10 }, async () => {
    while (queue.length) {
      const job = queue.shift();
      const got = await job.fn();
      if (got) {
        img[job.id] = got.uri;
        if (got.cls) { cls[job.id] = got.cls; if (got.cls === 'dark') dark.push(job.id); }
      } else missing.push(job.id);
      if (++done % 40 === 0) console.log(`${done}/${jobs.length}`);
    }
  }));

  // sequential retry for transient failures (flagcdn rate-limits bursts)
  for (const id of [...missing]) {
    const job = jobs.find(j => j.id === id);
    await new Promise(r => setTimeout(r, 250));
    const got = await job.fn();
    if (got) {
      img[id] = got.uri;
      if (got.cls) cls[id] = got.cls;
      missing = missing.filter(m => m !== id);
    }
  }

  // verify every stock's market cap live
  const baseline = {};
  for (const m of tpl.matchAll(/\bS\('([^']+)','[^']*',([^)]+)\)/g)) {
    try { baseline[m[1]] = eval(m[2].replace(/T/g, '*1e12').replace(/B/g, '*1e9').replace(/M/g, '*1e6').replace(/K/g, '*1e3').replace(/^\*/, '1*')); } catch (e) {}
  }
  const caps = {};
  let unverified = [];
  const capQueue = [...stocks];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (capQueue.length) {
      const sym = capQueue.shift();
      const v = await liveCap(sym);
      if (v) caps[sym] = v; else unverified.push(sym);
    }
  }));
  for (const sym of [...unverified]) {
    await new Promise(r => setTimeout(r, 300));
    const v = await liveCap(sym);
    if (v) { caps[sym] = v; unverified = unverified.filter(x => x !== sym); }
  }
  // cache: a blocked/failed verifier falls back to the last verified caps, never to template baselines
  const cachePath = path.join(__dirname, 'caps-cache.json');
  let cache = { verified: null, caps: {} };
  try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')); } catch (e) {}
  let fromCache = [];
  for (const sym of unverified) if (cache.caps[sym]) { caps[sym] = cache.caps[sym]; fromCache.push(sym); }
  unverified = unverified.filter(s => !cache.caps[s]);
  const today = new Date().toISOString().slice(0, 10);
  const allLive = fromCache.length === 0 && unverified.length === 0;
  const built = allLive ? today : (cache.verified || today);
  if (allLive) fs.writeFileSync(cachePath, JSON.stringify({ verified: today, caps }, null, 1));
  if (fromCache.length) console.log(`live verification unavailable for ${fromCache.length} symbols — using cached caps verified ${cache.verified}`);
  const out = tpl
    .replace('__IMGDATA__', JSON.stringify(img))
    .replace('__CHIPCLASS__', JSON.stringify(cls))
    .replace('__CAPDATA__', JSON.stringify(caps))
    .replaceAll('__BUILT__', built);
  fs.writeFileSync(path.join(__dirname, 'index.html'), out);
  console.log(`done: ${Object.keys(img).length}/${jobs.length} images, ${Object.keys(caps).length}/${stocks.length} caps verified, ${(out.length / 1024).toFixed(0)} KB, built ${built}`);
  if (dark.length) console.log('white logos on dark chips:', dark.join(' '));
  if (missing.length) console.log('no image:', missing.join(' '));
  if (unverified.length) console.log('CAP NOT VERIFIED (template baseline used):', unverified.join(' '));
  const drifted = Object.entries(caps)
    .filter(([s, v]) => baseline[s] && Math.abs(v.c - baseline[s]) / baseline[s] > 0.5)
    .map(([s, v]) => `${s} ${(baseline[s] / 1e6).toFixed(1)}M->${(v.c / 1e6).toFixed(1)}M`);
  if (drifted.length) console.log('large drift vs template baseline:', drifted.join('  '));
}
run();
