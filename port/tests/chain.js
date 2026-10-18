const fs = require('fs');
const load = (F) => { const src = fs.readFileSync(F, 'utf8'); const a = src.indexOf('const SquadEngine = (() => {'), b = src.indexOf('\n})();', a) + 6; return new Function(src.slice(a, b) + '\nreturn SquadEngine;')(); };
for (const F of process.argv.slice(2)) {
  const SE = load(F);
  const c = { rounds: 0, chain2: 0, chain2Lost: 0, fetchKO: 0, picked: 0, boxes: 0, waitedEnd: 0 };
  for (let n = 1; n <= 1000; n++) {
    const r = SE.rng(n * 7919 + 1); const A = SE.randomSquad(r), B = SE.randomSquad(r);
    for (const rd of [0, 1, 2]) {
      const R = SE.simulateRound(A, B, n * 104729 + 13, rd, false); c.rounds++;
      const walking = {}; const kos = [0, 0];
      for (const e of R.ev) {
        if (e.t === 'box') c.boxes++;
        if ((e.t === 'drop' && e.box) || (e.t === 'perk' && e.src === 'box')) c.picked++;
        if (e.t === 'goal' && e.id === 'box') walking[e.u] = 1;
        if (e.t === 'act') delete walking[e.u];
        if (e.t === 'ko' && walking[e.u]) { kos[Math.floor(e.u / SE.TEAM) % 2]++; c.fetchKO++; delete walking[e.u]; }
      }
      for (const t of [0, 1]) if (kos[t] >= 2) { c.chain2++; if (R.winner !== t) c.chain2Lost++; }
    }
  }
  c.pickRate = +(c.picked / c.boxes).toFixed(3);
  console.log(F.split('/').pop(), JSON.stringify(c));
}
