// Playwright: open a bot-vs-bot round and grab the theater canvas at given clock times
// usage: node shot.js <seedA> <seedMatch> <outPrefix> t1 t2 ...   (or 'events' to list)
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs');
const path = require('path');
const http = require('http');
const ROOT = process.env.ROOT || '/home/user/blub-demo';
const [, , sqSeed, mSeed, out, ...times] = process.argv;
(async () => {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    let body = fs.readFileSync(f);
    if (p === '/index.html') {
      let s = body.toString();
      s = s.replace('let P = null; // the theater', 'let P = null; window.__sqP = () => P; // the theater');
      s = s.replace('  function advance(dt) {\n', '  function advance(dt) {\n    if (window.__stopAt != null && P.phase === "round" && P.clock >= window.__stopAt) { P.paused = true; window.__stopAt = null; window.__stopped = P.clock; }\n    if (P.paused) return;\n');
      s = s.replace('/* ==== end squad arena ==== */', 'window.SquadView = SquadView; window.SquadEngine = SquadEngine;\n/* ==== end squad arena ==== */');
      body = s;
    }
    res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html' : p.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream' });
    res.end(body);
  }).listen(0);
  const port = srv.address().port;
  const browser = await chromium.launch({ args: ['--no-proxy-server'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  if (process.env.CALM) await page.addInitScript(() => { window.name = 'calm'; });
  await page.addInitScript(() => { try { localStorage.setItem('blub-weiland-v1', JSON.stringify({ seen: 1, sqview: { chest: true, calm: !!(window.name === 'calm'), spd2: { show: 2 } } })); } catch (e) {} });
  await page.goto('http://127.0.0.1:' + port + '/');
  await page.waitForFunction(() => window.SquadView && window.SquadEngine);
  const info = await page.evaluate(([a, m]) => {
    const SE = window.SquadEngine;
    const r = SE.rng(+a * 7919);
    const A = SE.randomSquad(r), B = SE.randomSquad(r);
    window.__match = { kind: 'show', title: 'test', teams: [{ squad: A, label: 'Blue' }, { squad: B, label: 'Orange' }], viewer: 0, seed: +m, bo: 1 };
    window.SquadView.play(window.__match);
    const R = SE.simulateRound(A, B, +m, 0, false);
    return { chest: R.chest && R.chest.teams, n: R.ev.length };
  }, [sqSeed, mSeed]);
  console.log(JSON.stringify(info));
  await page.waitForFunction(() => window.__sqP() && window.__sqP().phase === 'round', null, { timeout: 60000 });
  if (times[0] === 'events') {
    const beats = await page.evaluate(() => window.__sqP().rd.beats.map((b) => b.t + ' ' + b.kind + ' ' + b.dur + ' c' + b.contact + (b.e ? ' ' + b.e.t + ' u' + b.e.u + ' ' + (b.e.w || b.e.id || '') : '')));
    console.log(beats.join('\n'));
  } else {
    for (const t of times) {
      await page.evaluate((t) => { const P = window.__sqP(); P.paused = false; window.__stopped = null; window.__stopAt = +t; }, t);
      await page.waitForFunction(() => window.__stopped != null, null, { timeout: 120000 });
      await page.waitForTimeout(120);
      const el = await page.$('canvas.sqv-cv');
      await el.screenshot({ path: out + '-' + t + '.png' });
    }
  }
  await browser.close();
  srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
