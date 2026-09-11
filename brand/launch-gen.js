// Generates brand/launch.html (the launch graphic) from the built site's embedded logos.
const fs = require('fs');
const path = require('path');
const t = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const img = JSON.parse(t.match(/const IMG=(\{.*?\});\n/s)[1]);
const cls = JSON.parse(t.match(/const CHIPCLASS=(\{.*?\});/s)[1]);
const caps = JSON.parse(t.match(/const CAPS=(\{.*?\});\n/s)[1]);
const fxCount = (t.match(/\bF\('/g) || []).length;
const stocks = [...t.matchAll(/\bS\('([^']+)'/g)].map(m => m[1])
  .sort((a, b) => ((caps[b] || {}).c || 0) - ((caps[a] || {}).c || 0));
const chipCss = t.slice(t.indexOf('  .chip{'), t.indexOf('  .cell.flipped{'));

const chips = stocks.map(s => `<span class="chip logo ${cls['s-' + s] || ''}" title="${s}"><img src="${img['s-' + s]}" alt="${s}"></span>`).join('');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>FLIP launch</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@900&family=IBM+Plex+Mono:wght@500;700&display=swap">
<style>
  *{box-sizing:border-box; margin:0}
  html,body{height:100%; overflow:hidden; font-family:'Archivo',sans-serif; color:#f4f7fc}
  body{background:
      radial-gradient(60% 55% at 12% 10%, rgba(18,230,149,.20), transparent 62%),
      radial-gradient(55% 60% at 90% 92%, rgba(255,215,94,.14), transparent 62%),
      radial-gradient(45% 45% at 78% 8%, rgba(96,72,200,.18), transparent 60%),
      linear-gradient(180deg,#0c1322,#05070d); position:relative}
  .grid-bg{position:absolute; inset:0; background:radial-gradient(rgba(255,255,255,.07) 1px, transparent 1.2px) 0 0/28px 28px; mask-image:radial-gradient(75% 75% at 50% 50%, #000 30%, transparent 100%); -webkit-mask-image:radial-gradient(75% 75% at 50% 50%, #000 30%, transparent 100%)}
  .grain{position:absolute; inset:0; opacity:.06; mix-blend-mode:overlay; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
  .panel{position:absolute; left:44px; top:44px; right:44px; bottom:44px; border-radius:34px; padding:40px 64px 56px;
    background:linear-gradient(165deg, rgba(17,24,39,.92), rgba(11,16,29,.92)); border:1px solid rgba(38,48,74,.9);
    box-shadow:0 40px 120px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.05); display:flex; flex-direction:column}
  .head{display:flex; align-items:center; justify-content:space-between; gap:40px; margin-bottom:24px}
  .wm{position:relative; font-weight:900; font-size:90px; line-height:.9; letter-spacing:-.04em; white-space:nowrap; display:inline-block}
  .wm .fill{position:relative; z-index:2; color:transparent; background:linear-gradient(180deg,#ffffff 0%,#f4f7fc 38%,#aebbdc 50%,#f7f9fe 56%,#c3cfea 100%); -webkit-background-clip:text; background-clip:text}
  .wm .fill em{font-style:normal; color:transparent; background:linear-gradient(180deg,#b6fbe0 0%,#12e695 48%,#0fbd7b 54%,#7cf0c4 62%,#0a9c66 100%); -webkit-background-clip:text; background-clip:text}
  .wm .ghost{position:absolute; inset:0; z-index:1; color:transparent; -webkit-text-stroke:2px rgba(255,255,255,.2); transform:translate(.06em,.06em)}
  .wm .ghost em{font-style:normal; -webkit-text-stroke-color:rgba(18,230,149,.3)}
  .wm .glow{position:absolute; inset:0; z-index:0; color:rgba(18,230,149,.35); filter:blur(30px)}
  .wm .glow em{font-style:normal}
  .sub{font-family:'IBM Plex Mono',monospace; font-size:14px; letter-spacing:.2em; text-transform:uppercase; color:#ffd75e; text-align:right; line-height:1.9; white-space:nowrap; padding:10px 18px; border:1px solid rgba(255,215,94,.25); border-radius:12px; background:rgba(255,215,94,.05)}
  .sub b{color:#f4f7fc; font-weight:700}
  .grid{margin-top:auto; display:grid; grid-template-columns:repeat(16, 1fr); gap:20px 0; justify-items:center}
  ${chipCss}
  .chip{width:64px; height:64px; font-size:22px}
  .chip.logo{box-shadow:0 6px 18px rgba(0,0,0,.45), 0 0 0 2px rgba(255,255,255,.04)}
  .coin{width:64px; height:64px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:900; font-size:40px; line-height:1; color:#05301f;
    background:linear-gradient(180deg,#b6fbe0,#12e695 55%,#0a9c66); box-shadow:0 0 0 3px #070a12, 0 0 34px rgba(18,230,149,.75), 0 0 80px rgba(18,230,149,.35)}
</style></head>
<body>
<div class="grid-bg"></div>
<div class="panel">
  <div class="head">
    <div class="wm"><span class="glow">FLIP THE <em>UNIVERSE.</em></span><span class="ghost">FLIP THE <em>UNIVERSE.</em></span><span class="fill">FLIP THE <em>UNIVERSE.</em></span></div>
    <div class="sub"><b>${stocks.length} companies</b> · <b>${fxCount} currencies</b><br>one coin · $flip</div>
  </div>
  <div class="grid">${chips}</div>
</div>
<div class="grain"></div>
</body></html>`;
fs.writeFileSync(path.join(__dirname, 'launch.html'), html);
console.log('launch.html written:', stocks.length, 'stocks');
