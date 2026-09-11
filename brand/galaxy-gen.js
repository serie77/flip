// Generates brand/galaxy.html: every stock + currency as a chip on a spiral galaxy, sized by market cap.
const fs = require('fs');
const path = require('path');
const t = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const img = JSON.parse(t.match(/const IMG=(\{.*?\});\n/s)[1]);
const cls = JSON.parse(t.match(/const CHIPCLASS=(\{.*?\});/s)[1]);
const caps = JSON.parse(t.match(/const CAPS=(\{.*?\});\n/s)[1]);
const T = 1e12, B = 1e9, M = 1e6, K = 1e3;
const items = [];
for (const m of t.matchAll(/\bS\('([^']+)','[^']*',([^)]+)\)/g)) items.push({ id: 's-' + m[1], cap: (caps[m[1]] || {}).c || eval(m[2]), type: 'logo' });
for (const m of t.matchAll(/\bF\('([^']+)','[^']*',([^,]+),/g)) items.push({ id: 'f-' + m[1], cap: eval(m[2]), type: 'flag' });
items.sort((a, b) => b.cap - a.cap);
const N = items.length;

// spiral with turn spacing that tracks the current chip size (tight galaxy, no overlap)
const W = 1600, H = 900, gap = 11, tilt = 0.8, rot = -16 * Math.PI / 180;
const size = i => Math.round(20 + 44 * Math.pow(1 - i / (N - 1), 1.2));
let theta = 0, r = 70, pts = [];
for (let i = 0; i < N; i++) {
  const s = size(i), sNext = size(Math.min(i + 1, N - 1));
  pts.push({ ...items[i], s, x: r * Math.cos(theta), y: r * Math.sin(theta) });
  const d = (s + sNext) / 2 + gap;
  const dTheta = d / r;
  theta += dTheta;
  r += ((s + gap) / (2 * Math.PI)) * dTheta * 1.05;
}
// tilt + rotate, then scale to fit
for (const p of pts) {
  const x = p.x, y = p.y * tilt;
  p.px = x * Math.cos(rot) - y * Math.sin(rot);
  p.py = x * Math.sin(rot) + y * Math.cos(rot);
}
const maxX = Math.max(...pts.map(p => Math.abs(p.px) + p.s / 2)), maxY = Math.max(...pts.map(p => Math.abs(p.py) + p.s / 2));
const scale = Math.min((W * 0.47) / maxX, (H * 0.47) / maxY);
const chipCss = t.slice(t.indexOf('  .chip{'), t.indexOf('  .cell.flipped{'));
const chips = pts.map((p, i) => {
  const s = Math.max(12, Math.round(p.s * scale)), x = W / 2 + p.px * scale, y = H / 2 + p.py * scale;
  const depth = 1 - i / N;
  return `<span class="chip ${p.type} ${cls[p.id] || ''}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;width:${s}px;height:${s}px;font-size:${Math.round(s * .4)}px;opacity:${(0.55 + 0.45 * depth).toFixed(2)};z-index:${N - i}"><img src="${img[p.id]}" alt=""></span>`;
}).join('');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>FLIP galaxy</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500&display=swap">
<style>
  *{box-sizing:border-box; margin:0}
  html,body{height:100%; overflow:hidden}
  body{position:relative; background:
      radial-gradient(38% 60% at 50% 50%, rgba(18,230,149,.16), transparent 70%),
      radial-gradient(60% 55% at 10% 8%, rgba(18,230,149,.10), transparent 62%),
      radial-gradient(55% 60% at 92% 92%, rgba(255,215,94,.10), transparent 62%),
      radial-gradient(45% 45% at 80% 6%, rgba(96,72,200,.16), transparent 60%),
      linear-gradient(180deg,#0b111f,#04060c)}
  canvas{position:absolute; inset:0}
  .core{position:absolute; left:50%; top:50%; width:150px; height:150px; transform:translate(-50%,-50%); border-radius:50%;
    background:radial-gradient(circle, #fff9e6 0%, #ffd75e 18%, rgba(18,230,149,.9) 42%, rgba(18,230,149,.25) 62%, transparent 72%);
    filter:blur(6px); z-index:0}
  .core2{position:absolute; left:50%; top:50%; width:560px; height:340px; transform:translate(-50%,-50%) rotate(-16deg); border-radius:50%;
    background:radial-gradient(ellipse, rgba(18,230,149,.22), rgba(18,230,149,.06) 55%, transparent 72%); filter:blur(22px); z-index:0}
  .field{position:absolute; inset:0}
  ${chipCss}
  .chip{position:absolute; transform:translate(-50%,-50%)}
  .chip.logo{box-shadow:0 4px 14px rgba(0,0,0,.55), 0 0 0 1.5px rgba(255,255,255,.05)}
  .chip.flag{box-shadow:0 4px 14px rgba(0,0,0,.55)}
  .grain{position:absolute; inset:0; opacity:.06; mix-blend-mode:overlay; pointer-events:none; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
  .tag{position:absolute; right:34px; bottom:26px; font-family:'IBM Plex Mono',monospace; font-size:13px; letter-spacing:.32em; text-transform:uppercase; color:rgba(255,215,94,.85)}
  .vig{position:absolute; inset:0; background:radial-gradient(80% 80% at 50% 50%, transparent 55%, rgba(3,5,10,.6)); pointer-events:none}
</style></head>
<body>
<canvas id="stars" width="${W * 2}" height="${H * 2}" style="width:${W}px;height:${H}px"></canvas>
<div class="core2"></div><div class="core"></div>
<div class="field">${chips}</div>
<div class="vig"></div><div class="grain"></div>
<div class="tag">$flip</div>
<script>
  const c=document.getElementById('stars'), x=c.getContext('2d'); x.scale(2,2);
  let seed=6900; const R=()=>{seed=(seed*1664525+1013904223)>>>0; return seed/4294967296};
  for(let i=0;i<900;i++){ const px=R()*${W}, py=R()*${H}, s=R()<.93?.4+R()*.9:1.2+R()*1.3; x.fillStyle='rgba('+(R()<.8?'255,255,255':'170,220,255')+','+(0.15+R()*0.6)+')'; x.beginPath(); x.arc(px,py,s,0,7); x.fill(); }
</script>
</body></html>`;
fs.writeFileSync(path.join(__dirname, 'galaxy.html'), html);
console.log('galaxy.html written:', N, 'chips, scale', scale.toFixed(3));
