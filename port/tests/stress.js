// Real-time stress test of the arena like a player uses it: many matches in one page,
// speed changes, scrubbing, pausing, phone and desktop sizes; an in-page checker flags
// canvas state leaks, stuck close-ups / slow motion / hit-stops, errors, and the tempo.
// usage: node stress.js <index.html> <desktop|phone> <matches> [speed=1]
const { chromium, devices } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const [, , FILE, VIEW = 'desktop', NM = '6', SPD = '1'] = process.argv;
const ROOT = '/home/user/blub-demo';
(async () => {
  const html = fs.readFileSync(FILE, 'utf8')
    .replace('let P = null; // the theater', 'let P = null; window.__sqP = () => P; // the theater')
    .replace('/* ==== end squad arena ==== */', 'window.SquadView = SquadView; window.SquadEngine = SquadEngine;\n/* ==== end squad arena ==== */')
    // at the start of every render: was the canvas left dirty by the frame before?
    .replace(/(  function render\(now\) \{\n    const t = P\.clock;\n    const shot = shotAt\(t\);\n    if \(shot && !P\.buf\) P\.buf = canvas\(CW, CH\);\n    const x = shot \? P\.buf\.getContext\('2d'\) : P\.ctx;\n)/,
      "$1    { const W = window.__chk; W.frames++; for (const c of [P.ctx, P.buf && P.buf.getContext('2d')]) { if (!c) continue; if (c.globalAlpha !== 1) { W.alpha++; W.lastAlpha = c.globalAlpha; } if (c.globalCompositeOperation !== 'source-over') W.comp++; if ((c.__d || 0) > 0) { W.depth++; W.maxDepth = Math.max(W.maxDepth, c.__d); } } }\n");
  if (!html.includes('window.__chk; W.frames++')) throw new Error('render hook missing');
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    if (p === '/index.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(html); }
    const f = path.join(ROOT, p); if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200); res.end(fs.readFileSync(f));
  }).listen(0);
  const browser = await chromium.launch({ args: ['--no-proxy-server'] });
  const ctx = VIEW === 'phone' ? await browser.newContext({ ...devices['iPhone 13'], defaultBrowserType: undefined }) : await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|Failed to load resource/.test(m.text())) errs.push('CONSOLE ' + m.text().slice(0, 200)); });
  await page.addInitScript((spd) => {
    try { localStorage.setItem('blub-weiland-v1', JSON.stringify({ seen: 1, sqview: { spd2: { show: spd, own: spd } } })); } catch (e) {}
    window.__chk = { frames: 0, alpha: 0, comp: 0, depth: 0, maxDepth: 0, lastAlpha: 1, shotLong: 0, slowLong: 0, holdLong: 0, fxMax: 0, samples: [] };
    const S = CanvasRenderingContext2D.prototype;
    const sv = S.save, rs = S.restore, rt = S.reset;
    S.save = function () { this.__d = (this.__d || 0) + 1; return sv.call(this); };
    S.restore = function () { if (this.__d > 0) this.__d--; return rs.call(this); };
    if (rt) S.reset = function () { this.__d = 0; return rt.call(this); };
    // every 250 ms: stuck close-ups, slow motion, hit-stops, too many effects; and the tempo
    let last = null;
    setInterval(() => {
      const P = window.__sqP && window.__sqP();
      const W = window.__chk;
      if (!P || P.phase !== 'round') { last = null; return; }
      for (const v of P.shots || []) if (v.t1 - v.t0 > 6000) W.shotLong++;
      for (const v of P.slows || []) if (v.t1 - v.t0 > 4000) W.slowLong++;
      if (P.holdT > 1500) W.holdLong++;
      W.fxMax = Math.max(W.fxMax, (P.fx || []).length);
      const now = performance.now();
      if (last && !P.paused && last.ri === P.ri && P.clock > last.clock) W.samples.push([(P.clock - last.clock) / (now - last.now), P.speed]);
      last = { clock: P.clock, now, ri: P.ri };
    }, 250);
  }, +SPD);
  await page.goto('http://127.0.0.1:' + srv.address().port + '/');
  await page.waitForFunction(() => window.SquadView && window.SquadEngine);
  const report = [];
  for (let m = 1; m <= +NM; m++) {
    const t0 = Date.now();
    const info = await page.evaluate((a) => {
      const SE = window.SquadEngine; const r = SE.rng(a * 104729 + 7);
      const A = SE.randomSquad(r), B = SE.randomSquad(r);
      window.__done = false;
      window.SquadView.play({ kind: 'show', title: 'stress ' + a, teams: [{ squad: A }, { squad: B }], viewer: a % 2, seed: a * 31 + 5, bo: 3 }).then(() => (window.__done = true));
      return true;
    }, m);
    // play it like a person: mostly let it run, now and then poke at it
    let k = 0;
    while (Date.now() - t0 < 240000) {
      const st = await page.evaluate(() => { const P = window.__sqP(); return P ? P.phase + ':' + P.ri : 'closed'; });
      if (st === 'closed' || st.startsWith('outro') || st.startsWith('end')) break;
      await page.waitForTimeout(1500);
      k++;
      const roll = (m * 7 + k * 13) % 23;
      try {
        if (roll === 3) await page.evaluate(() => { const P = window.__sqP(); if (P && P.phase === 'round') { P.paused = true; } });
        if (roll === 4) await page.evaluate(() => { const P = window.__sqP(); if (P) P.paused = false; });
        if (roll === 7) { const b = await page.$$('.sqv-spd button, .sqv-speeds button, [data-speed]'); if (b.length) await b[(m + k) % b.length].click({ timeout: 1000 }).catch(() => {}); }
        if (roll === 11) { const p = await page.$('.sqv-prog'); if (p) { const bb = await p.boundingBox(); if (bb) await page.mouse.click(bb.x + bb.width * (((m * k) % 9) / 10 + 0.05), bb.y + bb.height / 2); } }
        if (roll === 15) await page.setViewportSize(VIEW === 'phone' ? { width: 844, height: 390 } : { width: 1024, height: 700 });
        if (roll === 16) await page.setViewportSize(VIEW === 'phone' ? { width: 390, height: 844 } : { width: 1440, height: 900 });
        if (roll === 19 || roll === 5) await page.emulateMedia({ reducedMotion: 'reduce' });
        if (roll === 20 || roll === 8) await page.emulateMedia({ reducedMotion: 'no-preference' });
        if (roll === 21 || roll === 12) await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); setTimeout(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, 700); });
      } catch (e) { errs.push('HARNESS ' + e.message.slice(0, 120)); }
      await page.evaluate(() => { const P = window.__sqP(); if (P) P.paused = false; });
    }
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const chk = await page.evaluate(() => { const W = window.__chk; const s = W.samples.filter((x) => x[1] === 1); const r = s.map((x) => x[0]).sort((a, b) => a - b); const med = r.length ? r[Math.floor(r.length / 2)] : null; const out = { ...W, tempo1x: med && +med.toFixed(2), n1x: r.length }; delete out.samples; W.samples = []; return out; });
    report.push({ m, secs: Math.round((Date.now() - t0) / 1000), ...chk });
    console.log(JSON.stringify(report[report.length - 1]));
    await page.evaluate(() => { const P = window.__sqP(); if (P) document.querySelector('.sqv-x') && document.querySelector('.sqv-x').click(); });
    await page.waitForTimeout(300);
  }
  console.log('ERRORS', errs.length, JSON.stringify([...new Set(errs)].slice(0, 15)));
  await browser.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
