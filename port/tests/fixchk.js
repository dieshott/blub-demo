// engine 27 review fixes: mist hits, ghost wins, double Rage, stretchers that can't return
const fs = require('fs');
const load = (F) => { const src = fs.readFileSync(F, 'utf8'); const a = src.indexOf('const SquadEngine = (() => {'), b = src.indexOf('\n})();', a) + 6; return new Function(src.slice(a, b) + '\nreturn SquadEngine;')(); };
const NR = +(process.argv[4] || 1500);
for (const F of [process.argv[2], process.argv[3]]) {
  const SE = load(F);
  const c = { rounds: 0, crash: 0, fog: 0, fogKo: 0, fogRepeat: 0, ghostWin: 0, rage2: 0, lateStretch: 0, flee: 0, aWins: 0, time: 0, turns: 0 };
  for (let n = 1; n <= NR; n++) {
    const r = SE.rng(n * 7919 + 11);
    const A = SE.randomSquad(r), B = SE.randomSquad(r);
    for (const rd of [0, 1]) {
      let R;
      try { R = SE.simulateRound(A, B, n * 37 + rd, rd, false); } catch (e) { c.crash++; if (c.crash < 3) console.log(e.stack.split('\n').slice(0, 3).join(' | ')); continue; }
      c.rounds++;
      const on = new Map(); R.start.forEach((s, i) => on.set(i, !s.bench));
      const rages = {}; const lastFog = {}; let turn = 0;
      for (const e of R.ev) {
        if (e.t === 'turn') turn = e.n;
        if (e.t === 'fog') { c.fog++; if (!e.hp) c.fogKo++; if (lastFog[e.d] === turn - 1) c.fogRepeat++; lastFog[e.d] = turn; }
        if (e.t === 'flee') c.flee++;
        if (e.t === 'ko' || e.t === 'rug') on.set(e.u, false);
        if (e.t === 'revive' || e.t === 'unrug' || e.t === 'mended') on.set(e.u, true);
        if (e.t === 'power' && e.p === 'rage') { rages[e.u] = (rages[e.u] || 0) + 1; if (rages[e.u] === 2) c.rage2++; }
        if (e.t === 'stretcher' && e.back > SE.TURNS) c.lateStretch++;
        if (e.t === 'end') {
          c.turns += turn; if (e.reason === 'time') c.time++; if (e.winner === 0) c.aWins++;
          const cnt = [...on].filter(([u, v]) => v && Math.floor(u / SE.TEAM) === e.winner).length;
          if (!cnt) c.ghostWin++;
        }
      }
    }
  }
  console.log(F.split('/').pop(), JSON.stringify(c));
}
