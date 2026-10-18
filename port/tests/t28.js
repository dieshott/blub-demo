// engine 28 sanity: crashes, determinism, chance drops, golden drops, the Gambler
const fs = require('fs');
const FILE = process.argv[2], NR = +(process.argv[3] || 1500);
const src = fs.readFileSync(FILE, 'utf8');
const a = src.indexOf('const SquadEngine = (() => {'), b = src.indexOf('\n})();', a) + 6;
const SE = new Function(src.slice(a, b) + '\nreturn SquadEngine;')();
console.log('engine', SE.SQUAD_ENGINE);
let rounds = 0, crash = 0, nondet = 0, boxes = 0, picked = 0, gone = 0, gold = 0, goldPick = 0, red = 0, green = 0, gamblers = 0, spins = 0, wins = 0, allIn = 0, allInWin = 0, rain = 0, boxRain = 0, perkKinds = {}, slow = 0, firstTurn = [];
const t0 = Date.now();
for (let n = 1; n <= NR; n++) {
  const r = SE.rng(n * 7919 + 3);
  const A = SE.randomSquad(r), B = SE.randomSquad(r);
  if (n % 3 === 0) A.units[n % 5].pow = 'gambler';
  for (const rd of [0, 1]) {
    const seed = n * 31 + rd;
    let R;
    const s0 = Date.now();
    try { R = SE.simulateRound(A, B, seed, rd, false); } catch (e) { crash++; if (crash < 4) console.log('CRASH', n, rd, e.stack.split('\n').slice(0, 3).join(' | ')); continue; }
    if (Date.now() - s0 > 300) slow++;
    rounds++;
    if (n % 25 === 0) { const R2 = SE.simulateRound(A, B, seed, rd, false); if (JSON.stringify(R2.ev) !== JSON.stringify(R.ev)) nondet++; }
    const isRain = R.ev.some((e) => e.t === 'round' && e.weather === 'rain'); if (isRain) rain++;
    for (const e of R.ev) {
      if (e.t === 'box') { boxes++; if (isRain) boxRain++; if (e.gold) gold++; else if (e.good) green++; else red++; firstTurn.push(e.n); }
      if (e.t === 'drop' && e.box) { picked++; perkKinds[e.k] = (perkKinds[e.k] || 0) + 1; }
      if (e.t === 'perk' && e.kind === 'gold' && e.src === 'box') goldPick++;
      if (e.t === 'boxgone') gone++;
      if (e.t === 'gamble') { spins++; if (e.gold) wins++; if (e.allIn) { allIn++; if (e.gold) allInWin++; } }
    }
    gamblers += R.start.filter((s) => s.pow === 'gambler').length;
  }
}
firstTurn.sort((x, y) => x - y);
console.log({ rounds, crash, nondet, slow, secs: Math.round((Date.now() - t0) / 1000) });
console.log({ boxesPerTeamRound: +(boxes / rounds / 2).toFixed(3), green, red, gold, picked, goldPick, gone, unresolved: boxes - picked - goldPick - gone, medianTurn: firstTurn[firstTurn.length >> 1], rainRounds: rain, boxRainPerTeam: rain ? +(boxRain / rain / 2).toFixed(2) : 0 });
console.log({ gamblers, spins, wins, winRate: +(wins / Math.max(1, gamblers)).toFixed(3), allIn, allInWin });
console.log(perkKinds);
