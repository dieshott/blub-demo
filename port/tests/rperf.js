// CPU time of render() per frame, same cannon-heavy match, for each build given
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const files = process.argv.slice(2);
const ROOT = '/home/user/blub-demo';
(async () => {
  const browser = await chromium.launch({ args: ['--no-proxy-server'] });
  for (const F of files) {
    let html = fs.readFileSync(F, 'utf8')
      .replace('let P = null; // the theater', 'let P = null; window.__sqP = () => P; // the theater')
      .replace('/* ==== end squad arena ==== */', 'window.SquadView = SquadView; window.SquadEngine = SquadEngine;\n/* ==== end squad arena ==== */')
      .replace('  function render(now) {', '  function render(now) { const __r0 = performance.now(); try { return __render(now); } finally { const d = performance.now() - __r0; (window.__rt = window.__rt || []).push(d); } }\n  function __render(now) {');
    if (!html.includes('__render(now)')) throw new Error('hook');
    const srv = http.createServer((req, res) => { let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html'; if (p === '/index.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(html); } const f = path.join(ROOT, p); if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); } res.end(fs.readFileSync(f)); }).listen(0);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(() => { try { localStorage.setItem('blub-weiland-v1', JSON.stringify({ seen: 1, sqview: { spd2: { show: 1, own: 1 } } })); } catch (e) {} });
    await page.goto('http://127.0.0.1:' + srv.address().port + '/');
    await page.waitForFunction(() => window.SquadView);
    await page.evaluate(() => { const SE = window.SquadEngine; const r = SE.rng(12 * 7919); const A = SE.randomSquad(r), B = SE.randomSquad(r); window.SquadView.play({ kind: 'show', title: 'p', teams: [{ squad: A }, { squad: B }], viewer: 0, seed: 12000, bo: 1 }); });
    await page.waitForFunction(() => window.__sqP() && window.__sqP().phase === 'round', null, { timeout: 60000 });
    await page.evaluate(() => { window.__rt = []; });
    await page.waitForTimeout(70000);
    const r = await page.evaluate(() => { const a = window.__rt.slice().sort((x, y) => x - y); const P = window.__sqP(); return { n: a.length, mean: +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(3), p50: +a[Math.floor(a.length / 2)].toFixed(3), p95: +a[Math.floor(a.length * 0.95)].toFixed(3), p99: +a[Math.floor(a.length * 0.99)].toFixed(3), max: +a[a.length - 1].toFixed(2), clock: P && Math.round(P.clock) }; });
    console.log(path.basename(F), JSON.stringify(r));
    await page.close(); srv.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
