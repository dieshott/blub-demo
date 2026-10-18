// play whole bo3 matches fast (and calm), report page errors and how far each got
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const ROOT = '/home/user/blub-demo';
const calm = process.argv[2] === 'calm'; const mode = process.argv[2];
const seeds = process.argv.slice(3).map(Number);
(async () => {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    let body = fs.readFileSync(f);
    if (p === '/index.html') body = body.toString().replace('let P = null; // the theater', 'let P = null; window.__sqP = () => P; // the theater').replace('/* ==== end squad arena ==== */', 'window.SquadView = SquadView; window.SquadEngine = SquadEngine;\n/* ==== end squad arena ==== */');
    res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); res.end(body);
  }).listen(0);
  const browser = await chromium.launch({ args: ['--no-proxy-server'] });
  let errors = 0;
  for (const s of seeds) {
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    page.on('pageerror', (e) => { errors++; console.log('PAGEERROR seed', s, e.message); }); page.on('console', (m) => { if (m.type() === 'error' && /arena/.test(m.text())) { errors++; console.log('FAULT seed', s, m.text().slice(0, 200)); } });
    await page.addInitScript((m) => { window.__mode = m; }, mode);
    await page.addInitScript((c) => { try { localStorage.setItem('blub-weiland-v1', JSON.stringify({ seen: 1, sqview: { chest: false, calm: c, spd2: { show: 4, own: 4 } } })); } catch (e) {} }, calm);
    await page.goto('http://127.0.0.1:' + srv.address().port + '/');
    await page.waitForFunction(() => window.SquadView);
    const info = await page.evaluate((a) => { const SE = window.SquadEngine; const r = SE.rng(a * 7919); const A = SE.randomSquad(r), B = SE.randomSquad(r); const m = SE.matchRounds(A, B, a * 31, 3); window.__done = false; window.SquadView.play({ kind: 'show', title: 't', teams: [{ squad: A }, { squad: B }], viewer: a % 2, seed: a * 31, bo: 3 }).then(() => (window.__done = true)); return m.rounds.length; }, s);
    // drive the clock hard: 4x and skip ahead in big steps
    const t0 = Date.now();
    let last = '';
    while (Date.now() - t0 < 400000) {
      const st = await page.evaluate(() => { const P = window.__sqP(); if (!P) return 'closed'; if (P.phase === 'intro') { P.ic = 1e9; } else if (P.phase === 'round') { if (window.__mode === 'normal') { P.speed = 1; P.clock += 150; } else { P.speed = 4; P.clock += 900; } } return P.phase + ':' + P.ri; });
      last = st;
      if (st.startsWith('closed') || st.startsWith('outro') || st.startsWith('end') || st.startsWith('done')) break;
      await page.waitForTimeout(mode === 'normal' ? 25 : 60);
    }
    console.log('seed', s, 'rounds', info, 'reached', last, Math.round((Date.now() - t0) / 1000) + 's');
    await page.close();
  }
  console.log('errors', errors);
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
