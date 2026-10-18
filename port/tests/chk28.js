// engine 28 review fixes: one counter per finding, for two builds side by side
const fs = require('fs');
const load = (F) => { const src = fs.readFileSync(F, 'utf8'); const a = src.indexOf('const SquadEngine = (() => {'), b = src.indexOf('\n})();', a) + 6; return new Function(src.slice(a, b) + '\nreturn SquadEngine;')(); };
const NP = +(process.argv[4] || 1000);
for (const F of [process.argv[2], process.argv[3]]) {
  const SE = load(F);
  const c = { rounds: 0, crash: 0, nanHit: 0, nanEnd: 0, heads: 0, dblWin: 0, dblRounds: 0, teamPerkEv: 0, dblSpin: 0, bpLate: 0, bpLateBuilt: 0, handWalks: 0, handKO: 0, firstWalks: 0, firstKO: 0, nameMismatch: 0, noAllIn: 0, gamblersDone: 0, onCrateNoPick: 0, goneWhy: {}, sideA: 0 };
  for (let n = 0; n < NP; n++) {
    const r = SE.rng(n * 7919);
    const A = SE.randomSquad(r), B = SE.randomSquad(r);
    if (n % 2 === 0) A.units[n % 5].pow = 'gambler';
    if (n % 3 === 0) B.units[(n + 2) % 5].pow = 'gambler';
    for (const rd of [0, 1, 2]) {
      let R;
      try { R = SE.simulateRound(A, B, n * 31 + 7, rd, false); } catch (e) { c.crash++; if (c.crash < 3) console.log(e.stack.split('\n').slice(0, 3).join(' | ')); continue; }
      c.rounds++; if (R.winner === 0) c.sideA++;
      const ev = R.ev; let turn = 0; let dbl = -1;
      const pos = {}; R.start.forEach((s) => (pos[s.u] = [s.x, s.y]));
      let box = [null, null]; const fetchFirst = [null, null]; const fetchers = {};
      const pendingWalk = {}; // u -> 'first'|'hand'
      const spunAllIn = {}; const gamblerU = R.start.filter((s) => s.pow === 'gambler' && !s.bench).map((s) => s.u);
      for (let i = 0; i < ev.length; i++) {
        const e = ev[i];
        if (e.t === 'turn') turn = e.n;
        if ((e.t === 'attack' || e.t === 'hit') && e.dmg !== undefined && (e.dmg === null || Number.isNaN(e.dmg))) c.nanHit++;
        if (e.t === 'coin' && e.heads) c.heads++;
        if (e.t === 'devwallet' || e.t === 'airdrop' || (e.t === 'snipe' && e.u == null) || (e.t === 'perk' && e.kind !== 'gold')) c.teamPerkEv++;
        if (e.t === 'gamble' && e.u >= 2 * SE.TEAM) c.dblSpin++;
        if (e.t === 'gamble') { if (e.allIn) spunAllIn[e.u] = 1; if (e.gold) { const p = ev.slice(i + 1, i + 4).find((x) => x.t === 'perk'); if (p && p.id !== e.gold) c.nameMismatch++; spunAllIn[e.u] = 1; } }
        if (e.t === 'box') { box[e.team] = { at: e.at, gold: e.gold }; fetchFirst[e.team] = e.by; }
        if (e.t === 'perk' && e.src === 'box' && box[e.team] && box[e.team].gold && e.id !== box[e.team].gold) c.nameMismatch++;
        if (e.t === 'perk' && e.kind === 'gold' && e.id === 'blueprint' && e.n > 2) { c.bpLate++; const team = e.team; if (ev.slice(i).some((x) => x.t === 'craft' && Math.floor(x.u / SE.TEAM) === team || (x.t === 'build' && Math.floor(x.u / SE.TEAM) === team))) c.bpLateBuilt++; }
        if (e.t === 'goal' && e.id === 'box') { const team = Math.floor(e.u / SE.TEAM) % 2; const first = e.u === fetchFirst[team]; if (first) c.firstWalks++; else c.handWalks++; pendingWalk[e.u] = first ? 'first' : 'hand'; }
        if (e.t === 'act' && pendingWalk[e.u]) delete pendingWalk[e.u];
        if (e.t === 'ko' && pendingWalk[e.u]) { if (pendingWalk[e.u] === 'first') c.firstKO++; else c.handKO++; delete pendingWalk[e.u]; }
        if (e.t === 'boxgone') c.goneWhy[e.why || 'none'] = (c.goneWhy[e.why || 'none'] || 0) + 1;
        if (e.t === 'burrow' || e.t === 'mended' || e.t === 'unrug') { const to = e.to || e.at; for (const t of [0, 1]) { const b = box[t]; if (b && to && to[0] === b.at[0] && to[1] === b.at[1]) { const nx = ev[i + 1]; if (!(nx && (nx.t === 'drop' || nx.t === 'perk'))) c.onCrateNoPick++; } } }
        if (e.t === 'drop' && e.box) box[e.team] = null;
        if (e.t === 'perk' && e.src === 'box') box[e.team] = null;
        if (e.t === 'boxgone') box[e.team] = null;
        if (e.t === 'coin' && e.heads) dbl = Math.floor((e.v != null ? e.v : -1));
      }
      if (R.hp.some((h) => Number.isNaN(h))) c.nanEnd++;
      const heads = ev.find((e) => e.t === 'coin' && e.heads);
      if (heads) { c.dblRounds++; const team = heads.team != null ? heads.team : Math.floor(heads.u / SE.TEAM); if (R.winner === team) c.dblWin++; }
      const lastTurn = turn;
      for (const g of gamblerU) {
        const s = R.start.find((x) => x.u === g); const spins = SE.RULES.gambleSpins[s.stn] || 3; const late = SE.RULES.gambleLate || 0;
        const ko = ev.find((e) => (e.t === 'ko' || e.t === 'rug' || e.t === 'rocket' && e.u === g) && e.u === g); const koTurn = ko ? ev.slice(0, ev.indexOf(ko)).filter((e) => e.t === 'turn').length : 99;
        if (lastTurn >= spins + late && koTurn > spins + late) { c.gamblersDone++; if (!spunAllIn[g]) c.noAllIn++; }
      }
    }
  }
  c.dblWinPct = +(c.dblWin / Math.max(1, c.dblRounds)).toFixed(3); c.handKOpct = +(c.handKO / Math.max(1, c.handWalks)).toFixed(3); c.firstKOpct = +(c.firstKO / Math.max(1, c.firstWalks)).toFixed(3);
  console.log(F.split('/').pop(), JSON.stringify(c));
}
