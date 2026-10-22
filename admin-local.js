// The admin panel's sandbox backend (owner, 19 Oct 2026): the panel on data in this
// browser only, behind the 4-digit code where there is no moderator wallet (the demo,
// local mode, a guest). It answers every method of the admin adapter
// (docs/competitions.md §Adapter) with the same shapes and the same error codes as
// the server, from a store in localStorage (`blubAdminLocal`, seeded with example
// data the first time; "Reset example data" seeds it again). Nothing here reaches
// the server, and the code never gives server rights.
//
// The example weeks are played with the page's own engine (C.E: roundPairs,
// leagueSeed, simulateRound), lazily and in slices, so Watch and replays are real
// matches; a day keeps only its results and bot plans, the squads come back from
// the store when the day is read.
import { AdminError, bulkWallets, rewardsPreview, botChance, compSeed, compArena, arenaBad, arenaOut, arenaChips } from './admin.js';

const KEY = 'blubAdminLocal';
const SEED = '2026-10-19';
// the seed's revision: a store from an older seed is seeded again (F3: the entries of #6
// and #7; F4: the bots' tiers in #5 and #6, the refund signature of #6, the job's seeds;
// 6: no squad rules in the seeded cups, since those are not played yet; 7: a lock keeps
// each entry it changes, lockWas, so an unlock gives back exactly that, as the server's;
// 8: the project wallet a real base58 address, so a prize burn checks green)
const REV = 8;
const STATES = ['draft', 'open', 'closed', 'locked', 'live', 'paused', 'done', 'settled', 'rewarded', 'void'];
const AFTER_OPEN = STATES.slice(1); // states in which the open-time fields are frozen
const AFTER_LOCK = ['locked', 'live', 'paused', 'done', 'settled', 'rewarded', 'void'];
const BOT_RE = /^bot:[1-9][0-9]{0,5}$/;
const ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{86,88}$/;
const CODE_RE = /^[a-z0-9]{8}$/;
const PIN_RE = /^[a-z0-9]{8}\.(p1|p2|p3|t10|all)$/;
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const DIVS = ['Shrimp', 'Crab', 'Fish', 'Dolphin', 'Shark', 'Whale'].flatMap((a) => ['Bronze', 'Silver', 'Gold'].map((t) => t + ' ' + a));
const DAY = 86400000;
const GROUP = 35;
const WIN_PTS = 3;
const LOSS_PTS = 1;
const LOG_KINDS = ['league', 'player', 'bots', 'comp', 'entry', 'pay', 'inv', 'deck', 'rewards'];
// the example exclusives (lib/catalog.mjs EXCL, once it lands): id -> class
const EXCL = { 'hat:ghost': 'comp', 'acc:cape': 'community', 'eyes:laser': 'unlock', 'hat:party': 'unlock', 'acc:medal': 'community' };
// the fake chain the sandbox checks signatures against
const MINT = '5HpB4gU9M7xtHC2fLK1FXP7UuDQUvJTRD6guwPKPJUGi';
const PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
// a valid base58 address (no 0, O, I or l), as the panel checks one before it asks
const PROJECT = 'B1ubProjectWa11etSandbox11111111111111111111';
const BURN_CODES = ['not_final', 'not_burn', 'not_transfer', 'too_small', 'not_yours', 'sig_used', 'too_early', 'too_late', 'wrong_program', 'wrong_mint', 'rpc_busy', 'bad_sig'];

const fail = (status, code, message, extra) => Object.assign(new AdminError(status, code, message), extra || {});
const iso = (ms) => new Date(ms).toISOString();
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const short = (id) => (BOT_RE.test(id) ? id : String(id).slice(0, 4) + '…' + String(id).slice(-4));
const isBot = (id) => BOT_RE.test(id);
// squad rules (`lim`, `objMax`) are not played yet (no fitRules until task #30): as the
// server's ADMIN_COMP, open and lock refuse a config that has them, and so does an edit
// that writes them from open on
const squadRulesOf = (rules) => (rules && rules.lim && Object.keys(rules.lim).length ? 'rules.lim' : rules && rules.objMax !== undefined && rules.objMax !== null ? 'rules.objMax' : null);
const SQUAD_RULES_SAY = 'Squad rules (bans, caps, the trench-kit limit) are not played yet: the daily run plays every squad as it is. Clear them before opening or locking.';
const cleanText = (s, n = 80) => String(s ?? '').normalize('NFC').replace(/\p{C}/gu, '').replace(/\s+/g, ' ').trim().slice(0, n);
// a small string hash (FNV-1a) as hex: the sandbox's HMAC
function hashHex(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  let g = 0x9e3779b1 ^ h;
  for (const ch of String(s)) g = Math.imul(g ^ (ch.charCodeAt(0) + 7), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0') + (g >>> 0).toString(16).padStart(8, '0');
}
const hashInt = (s) => parseInt(hashHex(s).slice(0, 8), 16);
// competition codes: 6 characters plus 2 check characters (lib/comp.mjs does it with an HMAC)
const codeCheck = (six) => hashHex('cmp:' + six).slice(0, 2).replace(/[^a-z0-9]/g, 'x');
export const compCodeOk = (code) => CODE_RE.test(code) && codeCheck(code.slice(0, 6)) === code.slice(6);
const newCode = (r) => {
  const six = Array.from({ length: 6 }, () => '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(r() * 36)]).join('');
  return six + codeCheck(six);
};
const fakeAddr = (r) => Array.from({ length: 44 }, () => B58[Math.floor(r() * 58)]).join('');
const fakeSig = (r) => Array.from({ length: 88 }, () => B58[Math.floor(r() * 58)]).join('');
// raw amounts: decimal strings; ui: grouped with a thin space
const uiOf = (raw, dec) => {
  const s = String(raw).padStart(dec + 1, '0');
  const whole = s.slice(0, s.length - dec).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const frac = s.slice(s.length - dec).replace(/0+$/, '').slice(0, 2);
  return whole + (frac ? '.' + frac : '');
};
const money = (raw, dec) => (raw == null ? null : { raw: String(raw), dec, ui: uiOf(raw, dec) });
const bpsOf = (supply, bps) => ((BigInt(supply) * BigInt(bps)) / 10000n).toString();
// the week id of a moment (lib/league.mjs weekOf, through the engine)
const weekStart = (E, ms) => E.leagueWeekStart(ms);
const nextMonday = (E, ms) => weekStart(E, ms) + 7 * DAY;
// the default timetable of a week that starts on Monday `mon` (UTC): Wed 12:00 -> Sun 20:00 -> Mon 00:05 lock -> Mon 00:00 start
const timesFor = (mon) => ({ opens: iso(mon - 5 * DAY + 12 * 3600000), closes: iso(mon - DAY + 20 * 3600000), lock: iso(mon + 5 * 60000), start: iso(mon) });
const winOf = (times) => ({ opens: times.opens, closes: times.closes, lock: times.lock, start: times.start });
const perDayOf = (n) => Math.ceil(((n % 2 ? n : n - 1)) / 7);
const roundsOf = (n) => (n % 2 ? n : n - 1);
const dayRounds = (n, d) => {
  const per = perDayOf(n);
  const all = roundsOf(n);
  const out = [];
  for (let k = d * per; k < Math.min(all, (d + 1) * per); k++) out.push(k);
  return out;
};

// a refund the server's ADMIN_PAY takes: a paid entry (a burn that checked out) of a void
// competition, but not a withdrawn one (its player gave the burn up), or one declined, or
// left out at the lock (waiting, lapsed, never decided on) of a locked or later one; the
// panel's refundDue says the same
const PHASE = { draft: 0, open: 1, closed: 1, locked: 2, live: 2, paused: 2, done: 2, settled: 2, rewarded: 2, void: 2 };
export const refundable = (c, e) => !!(e && e.b && e.b.ok && e.b.sig) && ((c.st === 'void' && e.st !== 'out') || e.st === 'no' || ((PHASE[c.st] || 0) >= 2 && ['wait', 'lapsed', 'req'].includes(e.st)));

/* ---- the store ---- */
let mem = null;
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : null;
    if (v && v.v === 1 && v.seed === SEED && v.rev === REV && v.comps) return v;
  } catch { /* no storage here, or something else in it */ }
  return null;
}
function save(S) {
  mem = S;
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
  } catch { /* in memory only */ }
}

/* ---- the seed: example data for every screen ---- */
function seed(C) {
  const E = C.E;
  const now = Date.now();
  const r = E.rng(20261019);
  const docs = typeof C.docs === 'function' ? C.docs() : null;
  const STY = ['fierce', 'sleepy', 'playful', 'sweet', 'cheeky'];
  const TINT = ['blauw', 'roze', 'mint', 'lavendel', 'nacht', 'goud', 'diamant'];
  const EYES = ['rond', 'blij', 'slaperig', 'boos', 'sterren', 'hart', 'rood'];
  const EARS = ['kort', 'lang', 'puntig', 'antenne'];
  const PAT = ['geen', 'vlekjes', 'strepen', 'sterretjes'];
  const HAT = ['geen', 'pet', 'bloem', 'muts', 'kroon', 'helm', 'loopgraaf'];
  const ACC = ['geen', 'snor', 'sjaal', 'bril', 'koptelefoon'];
  const pick = (a) => a[Math.floor(r() * a.length)];
  const look = () => ({ tint: pick(TINT), eyes: pick(EYES), ears: pick(EARS), pattern: pick(PAT), hat: pick(HAT), acc: pick(ACC) });
  const HANDLES = ['moonblub', 'DipBuyer', 'sift_sam', 'blubmaxi', 'pinkmist', 'TrenchKid', 'gm_blub', 'wagmi_wes', 'bubbles', 'holdr', 'nightfish', 'crabwalk', 'dolph', 'sharkie', 'whale_w', 'frens', 'reefrider', 'kelp_kai', 'shelljo', 'rivet'];
  const names = E.RECRUIT_NAMES;
  const squadOf = () => E.randomSquad(E.rng(1 + Math.floor(r() * 1e9)));
  // 40 wallets with a team of 5, three strategies, a profile name now and then
  const wallets = {};
  const ids = [];
  const fromPage = docs && docs.size ? [...docs.values()].slice(0, 40) : [];
  for (let i = 0; i < 40; i++) {
    const d = fromPage[i];
    const id = d && ADDR_RE.test(d.id) ? d.id : fakeAddr(r);
    const created = iso(now - (3 + Math.floor(r() * 120)) * DAY);
    const style = d ? d.style : pick(STY);
    wallets[id] = {
      name: d ? d.name : pick(names), player: d ? d.player || '' : r() < 0.6 ? HANDLES[i % HANDLES.length] + (i >= HANDLES.length ? i : '') : '',
      look: d ? d.look : look(), style,
      squad: [0, 1, 2, 3].map(() => ({ name: pick(names), look: look(), style: pick(STY) })),
      created, updated: iso(Date.parse(created) + Math.floor(r() * 3) * DAY),
      strats: { a: Math.floor(r() * 3), s: [0, 1, 2].map((k) => ({ n: ['Plan A', 'Plan B', 'Plan C'][k], q: squadOf() })) },
    };
    ids.push(id);
  }
  // a wallet saved yesterday: the "new team" signal
  wallets[ids[39]].created = iso(now - DAY);
  wallets[ids[39]].updated = wallets[ids[39]].created;
  // this week's league: 30 wallets and 5 bots in Bronze Shrimp group 1, 10 wallets and 25 bots in Bronze Crab group 1
  const week = E.leagueWeek(now);
  const lg = {};
  const member = (d, g, j, bot) => {
    const w = Math.floor(r() * 12);
    const l = Math.floor(r() * 10);
    return { d, g, p: w * WIN_PTS + l * LOSS_PTS, w, l, j, bot: !!bot };
  };
  ids.slice(0, 30).forEach((id, i) => { lg[id] = member(1, 0, i + 1); });
  for (let i = 30; i < 35; i++) lg['bot:' + (10000 + i + 1)] = member(1, 0, i + 1, true);
  ids.slice(30, 40).forEach((id, i) => { lg[id] = member(2, 0, i + 1); });
  for (let i = 10; i < 35; i++) lg['bot:' + (20000 + i + 1)] = member(2, 0, i + 1, true);
  const ldiv = {};
  ids.forEach((id, i) => { if (i % 3) ldiv[id] = { d: i < 30 ? 1 : 2, week: E.leagueWeek(now - 7 * DAY) }; });
  const drat = {};
  ids.forEach((id, i) => { if (i % 2) drat[id] = { r: 900 + Math.floor(r() * 300), w: Math.floor(r() * 9), l: Math.floor(r() * 9) }; });
  // bans, inventories, histories
  const by = 'sandbox';
  const bans = {};
  bans[ids[12]] = { t: iso(now - 4 * DAY), by, reason: 'two wallets, one person' };
  bans[ids[27]] = { t: iso(now - 9 * DAY), by, reason: 'spam in the duel taunts' };
  bans[ids[38]] = { t: iso(now - DAY), by, reason: '' };
  // competitions: #5 rewarded, #6 done, #7 open
  const rc = E.rng(55);
  const code5 = newCode(rc);
  const code6 = newCode(rc);
  const code7 = newCode(rc);
  const sup = { supply: '812345678901234', dec: 6, slot: 312345678, program: PROGRAM };
  const mon5 = weekStart(E, now) - 14 * DAY;
  const mon6 = weekStart(E, now) - 7 * DAY;
  const rw = { all: { item: null, tok: 1 }, t10: { item: null, tok: 0 }, p3: { item: null }, p2: { item: null }, p1: { item: 'hat:ghost', tok: 2 } };
  // the arena is the engine's rule set (RULE_SET) as the server stores it: here no chest
  // (no squad rules: those are not played yet, so nothing with them opens)
  const rules = { arena: { chest: false } };
  const cfgOf = (name, text, mon, size, o) => ({ name, text, week: E.leagueWeek(mon), times: timesFor(mon), size, minAge: 1, order: 'burn', entryBps: 10, prizeBps: 100, autoLock: true, rules: clone(rules), rw: clone(rw), terms: '18+, one entry a person, burns are final; a declined paid entry is refunded by hand from the project wallet. Payout within 72 h. Tie-break: points, head-to-head, margin, a salted coin.', e: E.SQUAD_ENGINE, ...o });
  const comp = (code, n, cfg, st, o) => ({
    code, n, st, v: 1, cfg, win: winOf(cfg.times), sup: st === 'draft' ? null : clone(sup), pool: [], pub: [], com: null, res: null, pay: { refunds: {} }, aw: null,
    prv: { salt: st === 'draft' || st === 'open' || st === 'closed' ? null : 'salt-' + code, lineup: [], notes: '' }, played: [false, false, false, false, false, false, false], archived: false, ...o,
  });
  const comps = {};
  const entries = {};
  const chain = { sigs: {} };
  // a paid, verified burn of a wallet
  const burn = (w, bt, o, fixed) => {
    const sig = fixed || fakeSig(r);
    chain.sigs[sig] = { kind: 'burn', raw: bpsOf(sup.supply, 10), slot: sup.slot + 1000 + Math.floor(r() * 5000), bt, fp: w, signer: w, ok: true, ...(o || {}) };
    return { sig, raw: chain.sigs[sig].raw, slot: chain.sigs[sig].slot, bt, fp: chain.sigs[sig].fp === w, ok: chain.sigs[sig].ok, ...(chain.sigs[sig].code ? { code: chain.sigs[sig].code } : {}) };
  };
  const entry = (w, t, st, o) => ({ w, t, m: '', x: '', tg: '', dc: '', st, ps: null, at: null, by: null, why: '', note: '', b: null, free: false, hand: false, signals: { ip: 1, fp: false, newTeam: false, sameSquad: 0 }, legal: [true, true, true], ...o });
  // #5 and #6: small cups of 14 places (a first dry run and the first paid one), 8 wallets and 6 bots each
  for (const [code, n, mon, st] of [[code5, 5, mon5, 'rewarded'], [code6, 6, mon6, 'done']]) {
    const c = comp(code, n, cfgOf(n === 5 ? 'October Cup I' : 'October Cup II', n === 5 ? 'The first cup: a dry run with 14 places.' : 'The second cup, the first one with a prize.', mon, 14, n === 5 ? { entryBps: 0, prizeBps: 0 } : {}), st);
    c.sup.slot -= (7 - n) * 100000;
    const players = n === 5 ? ids.slice(0, 8) : ids.slice(4, 12);
    const decks = [1, 5, 9, 2, 6, 10];
    const places = [...players, ...decks.map((d, i) => 'bot:' + (900000 + i + 1))];
    const rr = E.rng(hashInt('draw' + code));
    for (let i = places.length - 1; i > 0; i--) { const j = Math.floor(rr() * (i + 1)); [places[i], places[j]] = [places[j], places[i]]; }
    c.pool = places;
    // the library's decks 1-12: four a tier (A, B, C), #6 and #12 experiments
    const tierOfDeck = (k) => 'ABC'[Math.floor((k - 1) / 4)];
    c.prv.lineup = places.map((id, place) => { if (!isBot(id)) return null; const k = decks[Number(id.slice(4)) - 900001]; return { place, deck: k, tier: tierOfDeck(k), x: k === 6 || k === 12 }; }).filter(Boolean);
    c.pub = places.map((id, place) => ({ id, bot: isBot(id), tier: isBot(id) ? c.prv.lineup.find((x) => x.place === place).tier : null }));
    c.com = [0, 1, 2, 3, 4, 5, 6].map((d) => hashHex(hashHex(c.prv.salt + '|' + code + '|' + d)));
    c.played = [true, true, true, true, true, true, true];
    entries[code] = {};
    players.forEach((w, i) => {
      const t = Date.parse(c.cfg.times.opens) + (i + 1) * 3600000 * 7;
      entries[code][w] = entry(w, iso(t), 'ok', { m: ['Let me in, I main Trickster.', 'gm. Ready for the trench.', '', 'Won two friend leagues this month.', '', 'Blub to the moon', '', 'First cup for me!'][i], x: i % 3 ? HANDLES[i] : '', tg: i % 2 ? '' : HANDLES[i], ps: c.cfg.entryBps ? 1 : null, at: iso(t + 3600000), by, b: c.cfg.entryBps ? burn(w, Math.floor(t / 1000)) : null, free: !c.cfg.entryBps });
    });
    if (n === 6) {
      const t = Date.parse(c.cfg.times.opens) + 30 * 3600000;
      entries[code][ids[13]] = entry(ids[13], iso(t), 'no', { m: 'my second wallet, same squad', ps: 0, at: iso(t + 3 * 3600000), by, why: 'Two wallets, one person.', note: 'Same connection as ' + short(ids[12]) + '.', b: burn(ids[13], Math.floor(t / 1000), null, 'demo-used-1'), signals: { ip: 2, fp: false, newTeam: false, sameSquad: 1 } });
      c.pay.refunds[ids[13]] = null;
      // the refund the sandbox's chain knows: back from the project wallet to that wallet
      chain.sigs['demo-refund-6'] = { kind: 'transfer', raw: bpsOf(sup.supply, 10), slot: sup.slot + 8888, bt: Math.floor((now - 2 * 3600000) / 1000), fp: PROJECT, signer: PROJECT, to: ids[13], ok: true };
    }
    comps[code] = c;
  }
  // a good burn the sandbox knows, for "Add by hand": signed by whichever wallet is named
  chain.sigs['demo-hand-1'] = { kind: 'burn', raw: bpsOf(sup.supply, 10), slot: sup.slot + 7777, bt: Math.floor((now - 3600000) / 1000), fp: '*', signer: '*', ok: true };
  // #7: open, 35 places, 14 entries
  {
    const mon7 = nextMonday(E, now);
    const cfg = cfgOf('Halloween Cup', 'Spooky season: no Boom Pack, one Scope Rifle a squad.', mon7, 35, {});
    cfg.times = { opens: iso(now - 3 * DAY), closes: iso(now + 5 * 3600000), lock: iso(now + 9 * 3600000), start: iso(mon7) };
    cfg.rw.t10.item = code7 + '.t10';
    cfg.rw.p3.item = code7 + '.p3';
    cfg.rw.p2.item = code7 + '.p2';
    cfg.rw.p1.item = code7 + '.p1';
    cfg.rw.all.item = code7 + '.all';
    const c = comp(code7, 7, cfg, 'open', {});
    c.v = 3;
    entries[code7] = {};
    // 14 entries: 10 requests (9 burns verified, 1 a transfer: red), 3 entered by hand (one
    // burn recorded while the RPC was busy: amber; two free giveaways) and 1 lapsed
    const list = [...ids.slice(14, 27), ids[39]];
    const MSGS = ['', 'Been here since the first wave.', 'My Guardian build is nasty.', '', 'gm', 'Let me cook', '', 'Streaming every match on X', '', 'Three strategies, all legal', '', 'blub blub', 'For the culture', 'new here, wanna play'];
    list.forEach((w, i) => {
      const t = i === 13 ? now - 26 * 3600000 : Date.parse(cfg.times.opens) + (i + 1) * 4 * 3600000;
      const bt = Math.floor(t / 1000);
      const o = { m: MSGS[i], x: i % 2 ? HANDLES[(i * 3) % HANDLES.length] : '', tg: i % 3 === 1 ? HANDLES[(i * 5) % HANDLES.length] : '', dc: i % 4 === 0 ? HANDLES[i % HANDLES.length] + '#' + (1000 + i) : '', ps: null };
      let b = i < 9 || i === 10 ? burn(w, bt, i === 10 ? { ok: false, kind: 'transfer', to: 'inc1nerator11111111111111111111111111111111', code: 'not_burn', message: 'That is a transfer, not a burn: a burn is an SPL burn instruction of the mint.' } : i === 5 ? { fp: ids[3] } : null) : null;
      let st = 'req';
      if (i === 2 || i === 3) o.signals = { ip: 2, fp: false, newTeam: false, sameSquad: 1 };
      if (i === 5) o.signals = { ip: 1, fp: true, newTeam: false, sameSquad: 0 };
      if (i === 7) o.legal = [true, false, true];
      if (i === 9) {
        // entered by hand while the chain could not be read: recorded unverified (amber)
        b = burn(w, bt);
        b.ok = false;
        Object.assign(o, { hand: true, at: iso(t + 600000), by, note: 'Burn seen in their wallet; the RPC was busy: check again.' });
        st = 'ok';
      }
      if (i === 11 || i === 12) { Object.assign(o, { hand: true, free: true, at: iso(t), by, note: 'Community giveaway: fan art contest winner.' }); st = 'ok'; }
      if (i === 13) { Object.assign(o, { signals: { ip: 1, fp: false, newTeam: true, sameSquad: 0 }, legal: [true, true, false], at: iso(t + 3600000), by, note: 'Approved on Discord before paying; no burn came in time.' }); st = 'lapsed'; }
      entries[code7][w] = entry(w, iso(t), st, { ...o, b });
    });
    comps[code7] = c;
  }
  // #5: paid out and rewarded (the records are written once its week is played)
  // 12 decks: 4 a tier, 2 experiments; two rated on the engine before this one
  const decks = [];
  const DECK_NAMES = ['Wall of Guardians', 'Scope Line', 'Medic Pair', 'Trickster Rush', 'Dig and Hold', 'Flank Twins', 'Bubble Turtle', 'Storm Front', 'Potion Brawlers', 'Cheeky Pokes', 'Slow Burn', 'Nap Time'];
  for (let i = 0; i < 12; i++) {
    const tier = 'ABC'[Math.floor(i / 4)];
    const base = tier === 'A' ? 58 : tier === 'B' ? 45 : 30;
    const pct = [0, 1, 2].map(() => base + Math.floor(r() * 12));
    decks.push({ id: i + 1, n: DECK_NAMES[i], plan: [squadOf(), squadOf(), squadOf()], pct, e: i === 3 || i === 7 ? E.SQUAD_ENGINE - 1 : E.SQUAD_ENGINE, tier, x: i === 5 || i === 11, src: i < 6 ? 'lab: archetypes-oct' : i < 10 ? 'hand' : 'variant of #' + (i - 9), note: i === 5 ? 'experiment: one Scope swapped for a Bow' : '', rec: { hw: Math.floor(r() * 9), hl: Math.floor(r() * 9), bw: Math.floor(r() * 9), bl: Math.floor(r() * 9) }, retired: i === 10 });
  }
  // inventories: pins from #5, a few exclusives, tokens
  const inv = {};
  const invh = {};
  const give = (w, item, tok, why, t) => {
    inv[w] = inv[w] || { tok: 0, items: [] };
    if (item && !inv[w].items.includes(item)) inv[w].items.push(item);
    inv[w].tok += tok || 0;
    (invh[w] = invh[w] || []).unshift({ t, by, what: (item ? 'Given ' + item : '') + (tok ? (item ? ' and ' : 'Given ') + tok + ' unlock token' + (tok === 1 ? '' : 's') : ''), why });
  };
  ids.slice(0, 8).forEach((w, i) => give(w, code5 + '.all', 1, 'Rewards of Cup #5', iso(now - 6 * DAY)));
  give(ids[2], 'acc:cape', 0, 'community: the first fan video', iso(now - 5 * DAY));
  give(ids[7], 'acc:medal', 2, 'community: bug report on the mist', iso(now - 2 * DAY));
  give(ids[15], 'hat:party', 0, 'bought with an unlock token', iso(now - 3 * DAY));
  // the log: 60 lines across every kind
  const log = [];
  const L = (what, kind, o, daysAgo) => log.push({ n: log.length + 1, t: iso(now - daysAgo * DAY - log.length * 977000), by, what, kind, ...(o || {}), undo: false });
  L('Made competition #5 (draft)', 'comp', { comp: code5 }, 20);
  L('Opened competition #5: supply ' + uiOf(sup.supply, 6) + ', entry 0, prize 0', 'comp', { comp: code5 }, 19);
  ids.slice(0, 8).forEach((w, i) => L('Approved ' + short(w) + ' for #5', 'entry', { comp: code5, wallet: w }, 18 - i * 0.2));
  L('Locked and drew #5: 8 wallets, 6 bots', 'comp', { comp: code5 }, 15);
  L('Recorded the burn of the prize of #5 (a dry run, 0 $BLUB)', 'pay', { comp: code5 }, 8);
  L('Gave the rewards of #5 to 8 wallets', 'rewards', { comp: code5 }, 6);
  L('Made competition #6 (duplicate of #5)', 'comp', { comp: code6 }, 13);
  L('Opened competition #6: entry ' + uiOf(bpsOf(sup.supply, 10), 6) + ', prize ' + uiOf(bpsOf(sup.supply, 100), 6), 'comp', { comp: code6 }, 12);
  ids.slice(4, 12).forEach((w, i) => L('Approved ' + short(w) + ' for #6', 'entry', { comp: code6, wallet: w }, 11 - i * 0.2));
  L('Declined ' + short(ids[13]) + ' for #6: two wallets, one person', 'entry', { comp: code6, wallet: ids[13] }, 10);
  L('Locked and drew #6: 8 wallets, 6 bots', 'comp', { comp: code6 }, 8);
  L('Paused #6 (engine check)', 'comp', { comp: code6 }, 5);
  L('Resumed #6', 'comp', { comp: code6 }, 4.9);
  L('Made competition #7 (duplicate of #6)', 'comp', { comp: code7 }, 4);
  L('Edited #7: name, rules (no Boom Pack, one Scope Rifle)', 'comp', { comp: code7 }, 3.5);
  L('Opened competition #7: entry ' + uiOf(bpsOf(sup.supply, 10), 6) + ', prize ' + uiOf(bpsOf(sup.supply, 100), 6), 'comp', { comp: code7 }, 3);
  L('Entered ' + short(ids[23]) + ' by hand for #7 with a signature (unverified): Burn seen in their wallet; the RPC was busy', 'entry', { comp: code7, wallet: ids[23] }, 1.6);
  [ids[25], ids[26]].forEach((w, i) => L('Entered ' + short(w) + ' by hand for #7 (free): Community giveaway: fan art contest winner', 'entry', { comp: code7, wallet: w }, 1.4 - i * 0.1));
  L('Approved ' + short(ids[39]) + ' for #7 before the burn', 'entry', { comp: code7, wallet: ids[39] }, 1.1);
  L('Banned ' + short(ids[12]) + ': two wallets, one person', 'player', { wallet: ids[12] }, 4);
  L('Banned ' + short(ids[27]) + ': spam in the duel taunts', 'player', { wallet: ids[27] }, 9);
  L('Banned ' + short(ids[38]), 'player', { wallet: ids[38] }, 1);
  L('Let ' + short(ids[5]) + ' back in', 'player', { wallet: ids[5] }, 7);
  L('Moved ' + short(ids[31]) + ' to Bronze Crab from next week', 'player', { wallet: ids[31] }, 6);
  L('Set ' + short(ids[2]) + ' to 21 points (6–3)', 'player', { wallet: ids[2] }, 2);
  L('Wiped the profile name of ' + short(ids[19]), 'player', { wallet: ids[19] }, 5);
  L('Paused the leagues', 'league', null, 9.5);
  L('Resumed the leagues', 'league', null, 9.4);
  L('Started this week over (' + E.leagueWeek(now - 14 * DAY) + ')', 'league', null, 14);
  L('Put 5 bots in Bronze Shrimp', 'bots', null, 6.5);
  L('Put 25 bots in Bronze Crab', 'bots', null, 6.4);
  L('Took every bot out of this week’s league', 'bots', null, 13);
  ids.slice(0, 8).forEach((w, i) => L('Gave ' + code5 + '.all and 1 unlock token to ' + short(w) + ': rewards of Cup #5', 'inv', { wallet: w, comp: code5 }, 6 - i * 0.1));
  L('Gave acc:cape to ' + short(ids[2]) + ': community: the first fan video', 'inv', { wallet: ids[2] }, 5);
  L('Gave acc:medal and 2 unlock tokens to ' + short(ids[7]) + ': bug report on the mist', 'inv', { wallet: ids[7] }, 2);
  L('Took hat:ghost from ' + short(ids[9]) + ': given by mistake', 'inv', { wallet: ids[9] }, 3);
  DECK_NAMES.slice(0, 6).forEach((n, i) => L('Saved deck #' + (i + 1) + ' ' + n + ' (lab import)', 'deck', null, 16 - i * 0.1));
  L('Rated deck #3 Medic Pair: 61 / 55 / 49', 'deck', null, 10);
  L('Retired deck #11 Slow Burn', 'deck', null, 2.5);
  L('Promoted deck #6 Flank Twins out of the experiments', 'deck', null, 1.5);
  L('Verified the burn of ' + short(ids[16]) + ' again for #7: ok', 'entry', { comp: code7, wallet: ids[16] }, 0.5);
  L('Edited #7: closes ' + cfg7Closes(comps[code7]), 'comp', { comp: code7 }, 0.2);
  log.sort((a, b) => Date.parse(a.t) - Date.parse(b.t)).forEach((x, i) => { x.n = i + 1; });
  const dstat = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ day: iso(now - i * DAY).slice(0, 10), duels: 6 + Math.floor(r() * 30), rated: Math.floor(r() * 12) }));
  return {
    v: 1, seed: SEED, rev: REV, since: iso(now), week, paused: false, fresh: false, botseq: 0, seq: 7, deckSeq: 12, logSeq: log.length,
    wallets, lg, ldiv, drat, bans, comps, entries, days: {}, decks, inv, invh, cmw: {}, log, chain, dstat,
    budget: { writes: 1320, reads: 4110, maxWrites: 9000, maxReads: 12000 },
    supply: sup,
    want: { [code6]: { botPlace: 2 } },
  };
}
const cfg7Closes = (c) => c.cfg.times.closes.slice(11, 16) + ' UTC';

/* ---- the adapter ---- */
export function localAdapter(C) {
  const E = C.E;
  let S = mem || load();
  if (!S) { S = seed(C); save(S); }
  const now = () => Date.now();
  const touch = () => save(S);
  const wallet = (id) => S.wallets[id] || null;
  const BY = 'sandbox';
  // one log line; returns its number (for Undo)
  function logLine(what, kind, o) {
    const n = ++S.logSeq;
    S.log.push({ n, t: iso(now()), by: BY, what: cleanText(what, 200), kind, ...(o || {}), undo: !!(o && o.undo) });
    if (S.log.length > 200) S.log.splice(0, S.log.length - 200);
    return n;
  }
  const cmw = (w, code, st, place) => {
    const list = (S.cmw[w] = (S.cmw[w] || []).filter((x) => x.code !== code));
    list.unshift({ code, n: S.comps[code].n, st, ...(place ? { place } : {}) });
    S.cmw[w] = list.slice(0, 20);
  };
  // a wallet's competitions as the server's adminPlayer reads them: the state as it is now,
  // and a place only for the winner (the final table's res.winner) or a podium tag (troph
  // c<n>:2 or :3, written when the rewards are given)
  const cmwOf = (id, w) => (S.cmw[id] || []).slice(0, 20).map((x) => {
    const c = S.comps[x.code];
    const tag = ((w && w.troph) || []).map((t) => /^c(\d+):([1-3])$/.exec(t)).find((m) => m && Number(m[1]) === x.n);
    const place = c && c.res && c.res.winner === id ? 1 : tag ? Number(tag[2]) : 0;
    return { code: x.code, n: x.n, st: c ? c.st : x.st, ...(place ? { place } : {}) };
  });
  const lgSorted = () => {
    const by = new Map();
    for (const [id, m] of Object.entries(S.lg)) {
      const k = m.d * 1000 + m.g;
      if (!by.has(k)) by.set(k, { d: m.d, g: m.g, all: [] });
      by.get(k).all.push({ id, ...m });
    }
    return [...by.values()].sort((a, b) => a.d - b.d || a.g - b.g).map(({ d, g, all }) => ({ d, g, m: all.sort((a, b) => b.p - a.p || b.w - a.w || a.j - b.j).map((x) => [x.id, x.p, x.w, x.l]) }));
  };
  const compOrFail = (code) => {
    if (!compCodeOk(String(code || '')) || !S.comps[code]) throw fail(404, 'no_comp', 'No such competition.');
    return S.comps[code];
  };
  const checkV = (c, v) => {
    if (v !== undefined && v !== null && Number(v) !== c.v) throw fail(409, 'stale', 'Another moderator changed this competition: it is read again.', { v: c.v });
  };
  // an archived competition is frozen, as the server's scripts refuse it (lib/scripts.mjs)
  const notArchived = (c) => {
    if (c.archived) throw fail(409, 'archived', 'This competition is archived: it does not change any more.');
  };
  const deckOf = (id) => S.decks.find((d) => d.id === id) || null;
  const entriesOf = (code) => Object.values(S.entries[code] || {}).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  // the ones an archive waits for, as the server's ADMIN_COMP (refunds_due): refundable, and
  // no refund recorded yet (verified or not)
  const owedOf = (c) => entriesOf(c.code).filter((e) => refundable(c, e) && !c.pay.refunds[e.w]);
  const countsOf = (code) => {
    const c = { req: 0, ok: 0, wait: 0, no: 0, in: 0, lapsed: 0, dq: 0 };
    for (const e of entriesOf(code)) {
      if (Object.hasOwn(c, e.st)) c[e.st]++;
      if ((e.b && e.b.ok) || e.free) c.in++;
    }
    return c;
  };
  const chipsOf = (rules) => {
    const out = [];
    const lim = (rules && rules.lim) || {};
    const NAMES = { wpn: { boom: 'Boom Pack', scope: 'Scope Rifle', bow: 'Bow' }, pow: {}, cls: {}, gear: {}, tac: {}, stn: {}, obj: {}, cmd: {} };
    for (const [part, ids] of Object.entries(lim)) for (const [id, n] of Object.entries(ids || {})) out.push((n === 0 ? 'No ' : 'Max ' + n + ' ') + ((NAMES[part] && NAMES[part][id]) || id));
    out.push(...arenaChips(rules && rules.arena, E));
    return out.slice(0, 5);
  };
  const summary = (c) => ({
    code: c.code, n: c.n, name: c.cfg.name, week: c.cfg.week, st: c.st, win: c.win,
    entry: c.sup ? money(bpsOf(c.sup.supply, c.cfg.entryBps), c.sup.dec) : null, prize: c.sup ? money(bpsOf(c.sup.supply, c.cfg.prizeBps), c.sup.dec) : null,
    size: c.cfg.size, counts: countsOf(c.code), chips: chipsOf(c.cfg.rules), rw: clone(c.cfg.rw), e: c.cfg.e, winner: c.res ? c.res.winner : null, burn: !!(c.res && c.res.burn),
    paySig: c.pay.payout ? c.pay.payout.sig : c.pay.burn ? c.pay.burn.sig : null, v: c.v, archived: !!c.archived,
  });
  const full = (c) => {
    const o = { ...clone(c), prv: { salt: c.prv.salt ? 'set' : 'none', lineup: clone(c.prv.lineup), notes: c.prv.notes }, entries: clone(entriesOf(c.code)), counts: countsOf(c.code), days: null };
    // the lock's own bookkeeping stays inside, as the server's '#lw:<wallet>' and lockAt
    delete o.lockWas;
    delete o.lockAt;
    return o;
  };

  /* ---- playing a competition's days with the engine ---- */
  const yieldNow = () => new Promise((res) => setTimeout(res, 0));
  const daySalt = (c, d) => hashHex(c.prv.salt + '|' + c.code + '|' + d);
  // a place's squad on day d: a wallet's pick or active strategy, a bot's plan of that day
  function squadAt(c, place, dk) {
    const id = c.pool[place];
    if (!id) return null;
    if (isBot(id)) {
      const L = c.prv.lineup.find((x) => x.place === place);
      const deck = L && deckOf(L.deck);
      const plan = deck ? deck.plan : [];
      return E.cleanSquad(plan['ABC'.indexOf(dk[place] || 'A')] || plan[0]) || E.leagueBotSquad(c.cfg.week, id);
    }
    const w = wallet(id);
    const list = w && w.strats && Array.isArray(w.strats.s) ? w.strats.s : [];
    const k = w && w.strats && w.strats.c && Number.isInteger(w.strats.c[c.code]) ? w.strats.c[c.code] : w && w.strats ? w.strats.a : 0;
    return (list[k] && E.cleanSquad(list[k].q)) || E.leagueBotSquad(c.cfg.week, id);
  }
  function tableOf(c, upTo) {
    const T = c.pool.map((id, place) => ({ id, place, pts: 0, w: 0, l: 0, margin: 0, h2h: {} }));
    const D = S.days[c.code] || {};
    for (let d = 0; d < 7 && d <= upTo; d++) {
      const rec = D[d];
      if (!rec) continue;
      for (const [, a, b, win, margin, wo] of rec.r) {
        const W = T[win ? b : a];
        const Lo = T[win ? a : b];
        if (!W || !Lo) continue;
        W.pts += WIN_PTS; W.w++; W.margin += margin;
        if (!wo) { Lo.pts += LOSS_PTS; Lo.margin -= margin; }
        Lo.l++;
        W.h2h[Lo.id] = (W.h2h[Lo.id] || 0) + 1;
      }
    }
    return T;
  }
  function finalTable(c) {
    const T = tableOf(c, 6).filter((x) => x.id);
    const ties = [];
    // points, then head-to-head among the tied, then margin, then a salted coin
    const groups = new Map();
    for (const x of T) (groups.get(x.pts) || groups.set(x.pts, []).get(x.pts)).push(x);
    const out = [];
    for (const pts of [...groups.keys()].sort((a, b) => b - a)) {
      const g = groups.get(pts);
      if (g.length > 1) {
        const h2h = (x) => g.reduce((s, y) => s + (x.h2h[y.id] || 0), 0);
        g.sort((x, y) => h2h(y) - h2h(x) || y.margin - x.margin || hashInt(c.prv.salt + x.id) - hashInt(c.prv.salt + y.id));
        const by = g.some((x, i) => i && h2h(x) !== h2h(g[0])) ? 'h2h' : g.some((x, i) => i && x.margin !== g[0].margin) ? 'margin' : 'coin';
        ties.push({ ids: g.map((x) => x.id), by });
        g.forEach((x) => { x.tie = by; });
      } else g[0].tie = null;
      out.push(...g);
    }
    return { table: out.map((x, i) => ({ id: x.id, pts: x.pts, w: x.w, l: x.l, margin: x.margin, place: i + 1, tie: x.tie })), ties };
  }
  async function playDay(c, d) {
    const D = (S.days[c.code] = S.days[c.code] || {});
    if (D[d]) return D[d];
    const N = c.cfg.size;
    // a bot's plan today: the next of A, B, C after a day it lost more than it won
    const dk = {};
    const prev = d ? D[d - 1] : null;
    const T = prev ? tableOf(c, d - 1) : null;
    const dayT = prev ? tableOf(c, d - 2) : null;
    c.pool.forEach((id, place) => {
      if (!isBot(id)) return;
      let k = prev ? 'ABC'.indexOf(prev.dk[place] || 'A') : 0;
      if (prev) {
        const w = T[place].w - (dayT ? dayT[place].w : 0);
        const l = T[place].l - (dayT ? dayT[place].l : 0);
        if (l > w) k = (k + 1) % 3;
      }
      dk[place] = 'ABC'[k];
    });
    const sq = c.pool.map((id, place) => squadAt(c, place, dk));
    const dq = new Set(entriesOf(c.code).filter((e) => e.st === 'dq').map((e) => e.w));
    const out = (id) => !id || dq.has(id) || !!S.bans[id];
    const r = [];
    let t0 = performance.now();
    const salt = daySalt(c, d);
    for (const k of dayRounds(N, d)) {
      for (const [a, b] of E.roundPairs(N, k)) {
        const A = c.pool[a];
        const B = c.pool[b];
        if (!A && !B) continue;
        if (out(A) || out(B)) {
          if (out(A) && out(B)) continue;
          r.push([k, a, b, out(A) ? 1 : 0, 0, 1]);
          continue;
        }
        const arena = c.cfg.rules && c.cfg.rules.arena;
        // the competition's engine rules in every match, as the job plays them (lib/compday.mjs)
        const res = E.simulateRound(sq[a], sq[b], compSeed(E, salt, c.code, arena, k, a, b), 0, true, undefined, true, E.cleanRules(compArena(arena) || {}));
        const hp = Array.isArray(res.hp) ? res.hp : [0, 0];
        r.push([k, a, b, res.winner, Math.abs((hp[0] | 0) - (hp[1] | 0)), 0]);
        if (performance.now() - t0 > 12) { await yieldNow(); t0 = performance.now(); }
      }
    }
    D[d] = { s: salt, dk, r };
    c.played[d] = true;
    return D[d];
  }
  let playing = null;
  // the example weeks: played the first time they are needed (the two finished cups),
  // the live ones up to today
  async function ensurePlayed(code) {
    const c = S.comps[code];
    if (!c || !['live', 'paused', 'done', 'settled', 'rewarded'].includes(c.st) || !c.pool.length) return;
    const upTo = c.st === 'live' || c.st === 'paused' ? Math.min(6, Math.floor((now() - Date.parse(c.win.start)) / DAY)) : 6;
    if (c.played.slice(0, upTo + 1).every(Boolean) && (upTo < 6 || c.res)) return;
    if (playing) await playing;
    playing = (async () => {
      const want = S.want && S.want[code];
      for (let tries = 0; tries < (want ? 6 : 1); tries++) {
        for (let d = 0; d <= upTo; d++) await playDay(c, d);
        if (upTo === 6) {
          const f = finalTable(c);
          const winner = f.table[0] ? f.table[0].id : null;
          c.res = { table: f.table, ties: f.ties, burn: !!winner && isBot(winner), winner };
          // the seeded second cup wants a bot in that place. First try: the bot takes the
          // place (and so the seeds) of the wallet there, and that wallet's squad as all
          // three of its deck's plans, and the week is played again; then other salts
          const at = want && want.botPlace && f.table[want.botPlace - 1];
          if (at && !isBot(at.id) && tries < 5) {
            if (tries === 0) {
              const pH = c.pool.indexOf(at.id);
              const best = f.table.find((x) => isBot(x.id));
              const pB = best ? c.pool.indexOf(best.id) : -1;
              const L = c.prv.lineup.find((x) => x.place === pB);
              const deck = L && deckOf(L.deck);
              const sq = squadAt(c, pH, {});
              if (deck && sq) {
                deck.plan = [clone(sq), clone(sq), clone(sq)];
                [c.pool[pH], c.pool[pB]] = [c.pool[pB], c.pool[pH]];
                L.place = pH;
                c.pub = c.pool.map((id, place) => ({ id, bot: isBot(id), tier: isBot(id) ? (c.prv.lineup.find((x) => x.place === place) || {}).tier || null : null }));
              }
            } else c.prv.salt = 'salt-' + code + '-' + tries;
            c.com = [0, 1, 2, 3, 4, 5, 6].map((d) => hashHex(daySalt(c, d)));
            delete S.days[code];
            c.played = c.played.map(() => false);
            continue;
          }
        }
        break;
      }
      if (S.want) delete S.want[code];
      if (c.res) {
        for (const row of c.res.table) if (!isBot(row.id)) cmw(row.id, code, c.st, row.place);
        // the seeded finished cups carry their records: a payout or burn, and the rewards of #5
        if (c.st === 'rewarded' || c.st === 'settled') {
          const r = E.rng(hashInt('pay' + code));
          const prize = bpsOf(c.sup.supply, c.cfg.prizeBps);
          const sig = fakeSig(r);
          const bt = Math.floor((Date.parse(c.win.start) + 7 * DAY + 3600000 * 20) / 1000);
          if (c.res.burn) {
            S.chain.sigs[sig] = { kind: 'burn', raw: prize, slot: c.sup.slot + 900000, bt, fp: PROJECT, signer: PROJECT, ok: true };
            c.pay.burn = { sig, raw: prize, bt, ok: true, by: BY, t: iso(bt * 1000 + 600000) };
          } else {
            S.chain.sigs[sig] = { kind: 'transfer', raw: prize, slot: c.sup.slot + 900000, bt, fp: PROJECT, signer: PROJECT, to: c.res.winner, ok: true };
            c.pay.payout = { sig, raw: prize, to: c.res.winner, bt, ok: true, by: BY, t: iso(bt * 1000 + 600000) };
          }
          if (c.st === 'rewarded' && !c.aw) {
            const list = rewardsPreview(full(c));
            c.aw = { t: iso(bt * 1000 + 7200000), by: BY, list };
            for (const x of list) {
              if (isBot(x.id)) continue;
              const inv = (S.inv[x.id] = S.inv[x.id] || { tok: 0, items: [] });
              if (x.item && !inv.items.includes(x.item)) inv.items.push(x.item);
              if (x.tok) inv.tok += x.tok;
            }
            const row = (place) => c.res.table.find((x) => x.place === place);
            for (const p of [1, 2, 3]) { const x = row(p); if (x && !isBot(x.id)) { const w = wallet(x.id); if (w) w.troph = [...(w.troph || []), 'c' + c.n + ':' + p]; } }
          }
        }
      }
      touch();
    })();
    try { await playing; } finally { playing = null; }
  }
  async function ensureAll() {
    for (const code of Object.keys(S.comps)) await ensurePlayed(code);
  }
  function dayRecord(c, d) {
    const rec = (S.days[c.code] || {})[d];
    if (!rec) throw fail(404, 'not_played', 'That day is not played yet.');
    const sq = {};
    const t = {};
    c.pool.forEach((id, place) => {
      if (!id) return;
      const s = squadAt(c, place, rec.dk);
      if (s) sq[place] = s;
      const w = wallet(id);
      if (w) t[place] = [{ name: w.name, look: w.look, style: w.style }, ...w.squad.map((m) => ({ name: m.name, look: m.look, style: m.style || w.style }))];
    });
    return { e: c.cfg.e, o: clone(c.cfg.rules.arena || null), s: rec.s, ids: c.pool.slice(), sq, t, fx: null, dk: clone(rec.dk), r: clone(rec.r) };
  }

  /* ---- the chain, as the sandbox knows it ---- */
  // a signature's facts: the seeded ones, and the sandbox's own demo-pay-<n> (the payout
  // of competition #n to its winner), demo-burn-<n> (its prize burned by the project
  // wallet) and demo-refund-<n> (an entry amount back to the wallet it is recorded for)
  function factsOf(sig, w) {
    const m = /^demo-(pay|burn|refund)-(\d{1,4})$/.exec(String(sig || ''));
    if (m) {
      const c = Object.values(S.comps).find((x) => x.n === Number(m[2]));
      if (!c || !c.sup) return null;
      const bt = Math.floor(now() / 1000) - 600;
      const base = { slot: S.supply.slot + 990000 + c.n, bt, fp: PROJECT, signer: PROJECT, ok: true };
      if (m[1] === 'pay') return c.res && c.res.winner ? { ...base, kind: 'transfer', raw: bpsOf(c.sup.supply, c.cfg.prizeBps), to: c.res.winner } : null;
      if (m[1] === 'burn') return { ...base, kind: 'burn', raw: bpsOf(c.sup.supply, c.cfg.prizeBps) };
      return { ...base, kind: 'transfer', raw: bpsOf(c.sup.supply, c.cfg.entryBps), to: w || null };
    }
    const k = S.chain.sigs[sig];
    if (!k) return null;
    return k.signer === '*' ? { ...k, signer: w || null, fp: w || null } : k;
  }
  // the sandbox takes any short word as a signature it simply does not find (so a money
  // record can be tried amber); the server takes base58 signatures only
  const SANDBOX_SIG = /^[A-Za-z0-9_-]{3,90}$/;
  function verdictOf(c, sig, w, kind) {
    const known = S.chain.sigs[sig];
    // the sandbox's own example signatures (demo-hand-1) are known facts; a '*' signer is the wallet named
    const f = known && known.signer === '*' ? { ...known, signer: w || null, fp: w || null } : known;
    if (!known && !SIG_RE.test(String(sig || ''))) return { ok: false, kind: null, raw: null, slot: null, bt: null, fp: null, signer: null, code: 'bad_sig', message: 'That is not a transaction signature (base58, 64 bytes).' };
    if (!f) return { ok: false, kind: null, raw: null, slot: null, bt: null, fp: null, signer: null, code: 'not_final', message: 'Not on the sandbox’s chain: it knows only its own example signatures.' };
    const base = { ok: false, kind: f.kind, raw: f.raw, slot: f.slot, bt: f.bt, fp: f.fp, signer: f.signer, ...(f.to ? { to: f.to } : {}) };
    if (f.code) return { ...base, code: f.code, message: f.message || f.code };
    const used = Object.values(S.entries).some((es) => Object.values(es).some((e) => e.b && e.b.sig === sig && e.w !== w)) || Object.values(S.comps).some((x) => x !== c && ((x.pay.payout && x.pay.payout.sig === sig) || (x.pay.burn && x.pay.burn.sig === sig)));
    if (used) return { ...base, code: 'sig_used', message: 'That signature was used before.' };
    if (kind === 'entry') {
      if (f.kind !== 'burn') return { ...base, code: 'not_burn', message: 'That is a transfer, not a burn.' };
      if (w && f.signer !== w) return { ...base, code: 'not_yours', message: 'The signer is not that wallet.' };
      if (c.sup && BigInt(f.raw) < BigInt(bpsOf(c.sup.supply, c.cfg.entryBps))) return { ...base, code: 'too_small', message: 'Less than the entry amount was burned.' };
      if (f.bt * 1000 < Date.parse(c.win.opens)) return { ...base, code: 'too_early', message: 'Burned before sign-ups opened.' };
      if (f.bt * 1000 > Date.parse(c.win.closes)) return { ...base, code: 'too_late', message: 'Burned after sign-ups closed.' };
    } else if (kind === 'payout' && f.kind !== 'transfer') return { ...base, code: 'not_transfer', message: 'The payout must be a transfer from the project wallet.' };
    else if (kind === 'burn' && f.kind !== 'burn') return { ...base, code: 'not_burn', message: 'A prize burn must be a burn by the project wallet.' };
    else if (kind === 'refund' && f.kind !== 'transfer') return { ...base, code: 'not_transfer', message: 'A refund must be a transfer from the project wallet.' };
    return { ...base, ok: true, message: f.kind === 'burn' ? 'A burn of ' + uiOf(f.raw, 6) + ' $BLUB, final.' : 'A transfer of ' + uiOf(f.raw, 6) + ' $BLUB' + (f.to ? ' to ' + short(f.to) : '') + ', final.' };
  }
  const chainNow = () => ({ supply: S.supply.supply, dec: S.supply.dec, slot: S.supply.slot + Math.floor((now() - Date.parse(S.since)) / 400), program: S.supply.program, projectBalance: bpsOf(S.supply.supply, 60), projectWallet: PROJECT });

  /* ---- the methods ---- */
  const api = {
    mode: 'local',
    who: () => ({ addr: 'local', mode: 'local', since: S.since }),
    close: () => touch(),
    reset() {
      S = seed(C);
      save(S);
      return { ok: true };
    },
    // the sandbox's stand-in for the daily run (the server's job plays at 00:00 UTC): the
    // next day of a locked or live competition, now; after day 6 the final table (done).
    // Like the job, it plays nothing while paused and pauses on an engine that changed.
    sandbox: {
      // the exclusives the sandbox knows (lib/catalog.mjs EXCL once it lands): id -> class
      excl: () => ({ ...EXCL }),
      async playDay(code) {
        const c = compOrFail(code);
        if (!['locked', 'live'].includes(c.st)) throw fail(409, 'bad_state', c.st === 'paused' ? 'Paused: resume it first.' : 'Only a locked or live competition plays its days.', { st: c.st, want: ['locked', 'live'] });
        if (c.cfg.e !== E.SQUAD_ENGINE) {
          c.st = 'paused';
          c.v++;
          logLine('Paused #' + c.n + ': it was pinned to engine ' + c.cfg.e + ', the page runs ' + E.SQUAD_ENGINE, 'comp', { comp: code });
          touch();
          throw fail(409, 'bad_state', 'The engine changed since #' + c.n + ' opened: it is paused until you accept engine ' + E.SQUAD_ENGINE + '.', { st: 'paused', want: ['live'] });
        }
        const d = c.played.indexOf(false);
        if (d < 0) throw fail(409, 'bad_state', 'Every day is played.', { st: c.st, want: ['live'] });
        await playDay(c, d);
        c.st = 'live';
        if (d === 6) {
          const f = finalTable(c);
          const winner = f.table[0] ? f.table[0].id : null;
          // a disqualified winner counts as a bot win (plan §15 question 2): the prize is burned
          const dq = new Set(entriesOf(code).filter((e) => e.st === 'dq').map((e) => e.w));
          c.res = { table: f.table, ties: f.ties, burn: !!winner && (isBot(winner) || dq.has(winner)), winner };
          c.st = 'done';
          for (const row of c.res.table) if (!isBot(row.id)) cmw(row.id, code, 'done', row.place);
        }
        c.v++;
        logLine('Played day ' + d + ' of #' + c.n + ' (sandbox clock)' + (d === 6 ? ': the final table is in' : ''), 'comp', { comp: code });
        touch();
        return { ok: true, day: d, comp: full(c) };
      },
    },
    async overview() {
      await ensureAll();
      const t = now();
      const comps = Object.values(S.comps).filter((c) => !c.archived).sort((a, b) => b.n - a.n).map(summary);
      const open = comps.find((c) => c.st === 'open');
      const prizeRaw = (c) => (c.prize ? BigInt(c.prize.raw) : 0n);
      const chain = chainNow();
      const todo = {
        requests: comps.reduce((s, c) => s + (['open', 'closed'].includes(c.st) ? c.counts.req : 0), 0),
        closingH: open ? Math.max(0, Math.round((Date.parse(open.win.closes) - t) / 360000) / 10) : null,
        illegal: open ? entriesOf(open.code).filter((e) => ['req', 'ok', 'wait'].includes(e.st) && e.legal && !e.legal.every(Boolean)).length : 0,
        // a final table without a winner (nobody played) owes no prize: it is archived instead
        payoutDue: comps.filter((c) => c.st === 'done' && c.winner).map((c) => c.code),
        rewardsDue: comps.filter((c) => c.st === 'settled').map((c) => c.code),
        lowBalance: open ? BigInt(chain.projectBalance) < prizeRaw(open) : null,
        rerate: S.decks.filter((d) => !d.retired && d.e !== E.SQUAD_ENGINE).length,
      };
      const week = E.leagueWeek(t);
      return {
        week, ends: iso(E.leagueWeekStart(t) + 7 * DAY), prev: E.leagueWeek(t - 7 * DAY), paused: S.paused,
        rules: { group: GROUP, win: WIN_PTS, loss: LOSS_PTS, divisions: DIVS }, groups: lgSorted(),
        bans: Object.entries(S.bans).map(([id, b]) => ({ id, ...b })),
        log: S.log.slice().sort((a, b) => b.n - a.n).slice(0, 60).map(clone), teams: Object.keys(S.wallets).length,
        days: S.dstat.map((d, i) => ({ ...d, day: iso(t - i * DAY).slice(0, 10) })),
        budget: { ...S.budget }, comps, todo, chain,
        // sandbox only: the faces of its wallets (the site's page has them in its Meadow list)
        who: Object.fromEntries(Object.entries(S.wallets).map(([id, w]) => [id, { name: w.name, player: w.player || '', look: w.look, style: w.style, created: w.created }])),
      };
    },
    async league(what) {
      const ACTS = { pause: 'Paused the leagues', resume: 'Resumed the leagues', week: 'Started this week over', all: 'Started every league over (everyone back in Bronze)' };
      if (!Object.hasOwn(ACTS, what)) throw fail(400, 'bad_action', 'Unknown league action.');
      if (what === 'pause') S.paused = true;
      if (what === 'resume') S.paused = false;
      if (what === 'week' || what === 'all') { for (const m of Object.values(S.lg)) { m.p = 0; m.w = 0; m.l = 0; } }
      if (what === 'all') { for (const m of Object.values(S.lg)) m.d = 1; S.ldiv = {}; S.fresh = true; }
      logLine(ACTS[what] + (what === 'week' ? ' (' + E.leagueWeek(now()) + ')' : ''), 'league', what === 'pause' ? { undo: true } : null);
      touch();
      return { ok: true, ...(what === 'pause' || what === 'resume' ? { paused: what === 'pause' } : {}) };
    },
    async player(id) {
      if (!ADDR_RE.test(String(id || ''))) throw fail(400, 'bad_wallet', 'That is not a wallet address.');
      await ensureAll();
      const w = wallet(id);
      const m = S.lg[id];
      return {
        id, week: E.leagueWeek(now()),
        blub: w ? { name: w.name, player: w.player || '', look: w.look, style: w.style, squad: w.squad, created: w.created, updated: w.updated } : null,
        strats: w ? clone(w.strats) : null,
        league: m ? { d: m.d, g: m.g, p: m.p, w: m.w, l: m.l, j: m.j } : null,
        last: S.ldiv[id] ? { ...S.ldiv[id] } : null, rating: S.drat[id] ? { ...S.drat[id] } : null, ban: S.bans[id] ? { ...S.bans[id] } : null,
        inv: S.inv[id] ? clone(S.inv[id]) : { tok: 0, items: [] }, invh: clone((S.invh[id] || []).slice(0, 50)), cmw: cmwOf(id, w),
        troph: w && w.troph ? w.troph.slice() : [],
      };
    },
    async playerDo(body) {
      const act = body && body.do;
      const id = body && typeof body.id === 'string' ? body.id : '';
      const botOk = act === 'points' || act === 'remove';
      if (!ADDR_RE.test(id) && !(botOk && isBot(id))) throw fail(400, 'bad_wallet', 'That is not a wallet address.');
      const num = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0 && n <= 9999 ? n : null; };
      const m = S.lg[id];
      let what = '';
      if (act === 'points') {
        const [p, w, l] = [num(body.p), num(body.w), num(body.l)];
        if (p === null || w === null || l === null) throw fail(400, 'bad_points', 'Points, wins and losses are whole numbers from 0 to 9999.');
        if (!m) throw fail(404, 'not_in_league', 'That one is not in this week’s league.');
        Object.assign(m, { p, w, l });
        what = 'Set ' + short(id) + ' to ' + p + ' points (' + w + '–' + l + ')';
      } else if (act === 'division') {
        const d = Number(body.d);
        if (!(Number.isInteger(d) && d >= 1 && d <= DIVS.length)) throw fail(400, 'bad_division', 'Pick one of the ' + DIVS.length + ' ranks.');
        if (!wallet(id)) throw fail(404, 'no_blub', 'That wallet has no team.');
        S.ldiv[id] = { d, week: E.leagueWeek(now() + 7 * DAY) };
        what = 'Moved ' + short(id) + ' to ' + DIVS[d - 1] + ' from next week';
      } else if (act === 'remove') {
        if (!m) throw fail(404, 'not_in_league', 'That one is not in this week’s league.');
        delete S.lg[id];
        what = 'Took ' + short(id) + ' out of this week’s league';
      } else if (act === 'clearname') {
        const w = wallet(id);
        if (!w) throw fail(404, 'no_blub', 'That wallet has no team.');
        w.player = '';
        what = 'Wiped the profile name of ' + short(id);
      } else if (act === 'ban') {
        const reason = cleanText(body.reason);
        S.bans[id] = { t: iso(now()), by: BY, reason };
        delete S.lg[id];
        what = 'Banned ' + short(id) + (reason ? ': ' + reason : '');
      } else if (act === 'unban') {
        delete S.bans[id];
        what = 'Let ' + short(id) + ' back in';
      } else if (act === 'removeTeam') {
        if (!wallet(id)) throw fail(404, 'no_blub', 'That wallet has no team.');
        delete S.wallets[id];
        delete S.lg[id];
        what = 'Removed the team of ' + short(id);
      } else throw fail(400, 'bad_action', 'Unknown player action.');
      logLine(what, 'player', { wallet: id, undo: act === 'ban' });
      touch();
      return { ok: true };
    },
    async bots(body) {
      const act = body && body.do;
      if (act === 'fill') {
        const d = Number(body.d);
        const n = Number(body.n);
        if (!(Number.isInteger(d) && d >= 1 && d <= DIVS.length)) throw fail(400, 'bad_division', 'Pick one of the ' + DIVS.length + ' ranks.');
        if (!(Number.isInteger(n) && n >= 1 && n <= GROUP)) throw fail(400, 'bad_count', 'From 1 to ' + GROUP + ' bots at a time.');
        const taken = new Set(Object.values(S.lg).filter((m) => m.d === d).map((m) => m.g * 100 + m.j));
        const r = E.rng(now() % 1e9);
        let added = 0;
        for (let i = 0; i < n; i++) {
          let g = 0;
          let j = 1;
          while (taken.has(g * 100 + j)) { if (++j > GROUP) { j = 1; g++; } }
          taken.add(g * 100 + j);
          const w = Math.floor(r() * 5);
          const l = Math.floor(r() * 4);
          S.lg['bot:' + ++S.botseq] = { d, g, p: w * WIN_PTS + l * LOSS_PTS, w, l, j, bot: true };
          added++;
        }
        logLine('Put ' + n + ' bot' + (n === 1 ? '' : 's') + ' in ' + DIVS[d - 1], 'bots');
        touch();
        return { ok: true, bots: added };
      }
      if (act === 'clear') {
        let n = 0;
        for (const id of Object.keys(S.lg)) if (isBot(id)) { delete S.lg[id]; n++; }
        logLine('Took every bot out of this week’s league', 'bots');
        touch();
        return { ok: true, bots: n };
      }
      throw fail(400, 'bad_action', 'Unknown bot action.');
    },
    comps: {
      async list() {
        await ensureAll();
        return { comps: Object.values(S.comps).filter((c) => !c.archived).sort((a, b) => b.n - a.n).map(summary) };
      },
      async get(code) {
        const c = compOrFail(code);
        await ensurePlayed(code);
        return full(c);
      },
      async create(body) {
        const act = body && body.do;
        let cfg;
        if (act === 'draft') {
          const mon = nextMonday(E, now());
          cfg = { name: 'Cup #' + (S.seq + 1), text: '', week: E.leagueWeek(mon), times: timesFor(mon), size: 35, minAge: 1, order: 'burn', entryBps: 10, prizeBps: 100, autoLock: true, rules: {}, rw: { all: { item: null, tok: 1 }, t10: { item: null, tok: 0 }, p3: { item: null }, p2: { item: null }, p1: { item: null, tok: 0 } }, terms: '', e: E.SQUAD_ENGINE };
        } else if (act === 'duplicate') {
          const from = compOrFail(body.from);
          const mon = nextMonday(E, now());
          cfg = { ...clone(from.cfg), week: E.leagueWeek(mon), times: timesFor(mon), e: E.SQUAD_ENGINE };
        } else throw fail(400, 'bad_action', 'Unknown competition action.');
        const code = newCode(E.rng(now() % 1e9));
        const n = ++S.seq;
        const c = { code, n, st: 'draft', v: 1, cfg, win: winOf(cfg.times), sup: null, pool: [], pub: [], com: null, res: null, pay: { refunds: {} }, aw: null, prv: { salt: null, lineup: [], notes: '' }, played: [false, false, false, false, false, false, false], archived: false };
        for (const k of ['all', 't10', 'p3', 'p2', 'p1']) if (cfg.rw[k] && PIN_RE.test(cfg.rw[k].item || '')) cfg.rw[k].item = code + '.' + k;
        S.comps[code] = c;
        S.entries[code] = {};
        logLine('Made competition #' + n + (act === 'duplicate' ? ' (duplicate of #' + S.comps[body.from].n + ')' : ' (draft)'), 'comp', { comp: code });
        touch();
        return { ok: true, code, comp: full(c) };
      },
      async edit(code, body) {
        const c = compOrFail(code);
        checkV(c, body && body.v);
        notArchived(c);
        const p = (body && body.cfg) || {};
        const locked = (field, since) => { throw fail(400, 'locked_field', field + ' is locked since ' + since + '.', { field, since }); };
        const openLocked = AFTER_OPEN.includes(c.st);
        const lockLocked = AFTER_LOCK.includes(c.st);
        for (const f of ['entryBps', 'prizeBps', 'size', 'order']) if (openLocked && p[f] !== undefined && p[f] !== c.cfg[f]) locked(f, 'open');
        if (openLocked && p.times && p.times.opens !== undefined && p.times.opens !== c.cfg.times.opens) locked('times.opens', 'open');
        for (const f of ['rules', 'rw', 'terms', 'minAge', 'autoLock']) if (lockLocked && p[f] !== undefined && JSON.stringify(p[f]) !== JSON.stringify(c.cfg[f])) locked(f, 'lock');
        if (lockLocked && p.times && JSON.stringify({ ...c.cfg.times, ...p.times }) !== JSON.stringify(c.cfg.times)) locked('times', 'lock');
        const bad = (field) => { throw fail(400, 'bad_cfg', 'Check ' + field + '.', { field }); };
        const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
        if (p.name !== undefined && !cleanText(p.name, 40)) bad('name');
        if (p.size !== undefined && !int(p.size, 6, 64)) bad('size');
        if (p.minAge !== undefined && !int(p.minAge, 0, 60)) bad('minAge');
        if (p.entryBps !== undefined && !int(p.entryBps, 0, 10000)) bad('entryBps');
        if (p.prizeBps !== undefined && !int(p.prizeBps, 0, 10000)) bad('prizeBps');
        if (p.order !== undefined && !['burn', 'ask'].includes(p.order)) bad('order');
        if (p.week !== undefined && !/^\d{4}w\d{2}$/.test(p.week)) bad('week');
        if (p.times) for (const k of ['opens', 'closes', 'lock', 'start']) if (p.times[k] !== undefined && !(Date.parse(p.times[k]) > 0)) bad('times.' + k);
        // the arena as lib/comp.mjs cleanRules checks and stores it: the engine's rule set and the seeds
        if (p.rules && typeof p.rules === 'object') {
          const f = arenaBad(p.rules.arena, E);
          if (f) bad(f);
          const { arena, ...rest } = p.rules;
          const ar = arena === undefined || arena === null ? {} : arenaOut(arena, E);
          p.rules = { ...rest, ...(Object.keys(ar).length ? { arena: ar } : {}) };
          const sr = openLocked && squadRulesOf(p.rules);
          if (sr && JSON.stringify(p.rules) !== JSON.stringify(c.cfg.rules)) throw fail(400, 'bad_cfg', SQUAD_RULES_SAY, { field: sr });
        }
        const changed = [];
        for (const [k, v] of Object.entries(p)) {
          if (v === undefined) continue;
          if (k === 'times') { c.cfg.times = { ...c.cfg.times, ...v }; c.win = winOf(c.cfg.times); }
          else if (k === 'name') c.cfg[k] = cleanText(v, 40);
          // text and terms keep their lines, as the server does (lib/comp.mjs cleanCfg)
          else if (k === 'text' || k === 'terms') c.cfg[k] = String(v ?? '').normalize('NFC').replace(/[^\P{C}\n]/gu, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, k === 'text' ? 600 : 2000);
          else if (['size', 'minAge', 'entryBps', 'prizeBps', 'order', 'week', 'autoLock', 'rules', 'rw'].includes(k)) c.cfg[k] = clone(v);
          else continue;
          changed.push(k);
        }
        if (changed.length) { c.v++; logLine('Edited #' + c.n + ': ' + changed.join(', '), 'comp', { comp: code }); touch(); }
        return { ok: true, comp: full(c) };
      },
      async act(code, body) {
        const c = compOrFail(code);
        const act = body && body.do;
        checkV(c, body && body.v);
        notArchived(c);
        const TR = { open: ['draft'], close: ['open'], reopen: ['closed'], unpublish: ['open'], lock: ['closed', 'open'], unlock: ['locked'], pause: ['live'], resume: ['paused'], void: ['open', 'closed', 'locked', 'live', 'paused'], engine: ['locked', 'live', 'paused'], salt: ['draft', 'open', 'closed'], archive: ['done', 'rewarded', 'void'] };
        if (!TR[act]) throw fail(400, 'bad_action', 'Unknown competition action.');
        if (!TR[act].includes(c.st)) throw fail(409, 'bad_state', 'Not from ' + c.st + '.', { st: c.st, want: TR[act] });
        const needConfirm = (word) => { if ((body && body.confirm) !== word + ' ' + c.n) throw fail(400, 'bad_cfg', 'Type ' + word + ' ' + c.n + ' to confirm.', { field: 'confirm' }); };
        if (act === 'open' && squadRulesOf(c.cfg.rules)) throw fail(400, 'bad_cfg', SQUAD_RULES_SAY, { field: squadRulesOf(c.cfg.rules) });
        let what = '';
        if (act === 'open') {
          const ch = chainNow();
          c.sup = { supply: ch.supply, dec: ch.dec, slot: ch.slot, program: ch.program };
          c.st = 'open';
          what = 'Opened competition #' + c.n + ': entry ' + uiOf(bpsOf(ch.supply, c.cfg.entryBps), ch.dec) + ', prize ' + uiOf(bpsOf(ch.supply, c.cfg.prizeBps), ch.dec);
        } else if (act === 'close') { c.st = 'closed'; what = 'Closed sign-ups of #' + c.n; }
        else if (act === 'reopen') {
          if (now() >= Date.parse(c.win.lock)) throw fail(409, 'bad_state', 'The lock time has passed.', { st: c.st, want: ['closed'] });
          c.st = 'open'; what = 'Reopened sign-ups of #' + c.n;
        } else if (act === 'unpublish') {
          if (entriesOf(code).length) throw fail(409, 'bad_state', 'There are entries already.', { st: c.st, want: ['open'] });
          c.st = 'draft'; c.sup = null; what = 'Unpublished #' + c.n;
        } else if (act === 'lock') {
          needConfirm('LOCK');
          if (squadRulesOf(c.cfg.rules)) throw fail(400, 'bad_cfg', SQUAD_RULES_SAY, { field: squadRulesOf(c.cfg.rules) });
          c.prv.salt = c.prv.salt || 'salt-' + code + '-' + hashHex(String(now())).slice(0, 6);
          c.com = [0, 1, 2, 3, 4, 5, 6].map((d) => hashHex(daySalt(c, d)));
          // as the server's lock (lib/comp.mjs drawLock, lockPlan): the approved who paid (not
          // banned) are drawn, those past the size wait; the approved who never paid lapse;
          // each entry it changes is kept as it was, for an unlock
          const paid = (e) => (e.b && e.b.ok) || e.free;
          const ok = entriesOf(code).filter((e) => e.st === 'ok' && paid(e) && !S.bans[e.w]);
          c.lockWas = {};
          const moved = (e, to) => { c.lockWas[e.w] = clone(e); Object.assign(e, { st: to, at: iso(now()), by: BY }); };
          for (const e of entriesOf(code)) if (e.st === 'ok' && !paid(e) && !S.bans[e.w]) moved(e, 'lapsed');
          const r = E.rng(hashInt(c.prv.salt));
          const ids = ok.map((e) => e.w);
          for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
          const pool = ids.slice(0, c.cfg.size);
          for (const w of ids.slice(c.cfg.size)) moved(S.entries[code][w], 'wait');
          // a refund to a wallet the lock left out is due from now (ADMIN_PAY)
          c.lockAt = now();
          // the lineup's decks for the free places; places it has no deck for come from the default mix
          const need = c.cfg.size - pool.length;
          let bots = c.prv.lineup.slice(0, need);
          if (bots.length < need) bots = bots.concat(mixLineup(c, { A: 30, B: 40, C: 30 }, 20, need - bots.length));
          const places = [...pool, ...bots.map((x, i) => 'bot:' + (900000 + i + 1))];
          for (let i = places.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [places[i], places[j]] = [places[j], places[i]]; }
          while (places.length < c.cfg.size) places.push('');
          c.pool = places;
          const botOf = (id) => bots[Number(id.slice(4)) - 900001];
          c.prv.lineup = places.map((id, place) => (isBot(id) ? { deck: botOf(id).deck, tier: botOf(id).tier, x: !!botOf(id).x, place } : null)).filter(Boolean);
          c.pub = places.filter(Boolean).map((id) => ({ id, bot: isBot(id), tier: isBot(id) ? botOf(id).tier || null : null }));
          for (const id of pool) cmw(id, code, 'locked');
          c.st = 'locked';
          what = 'Locked and drew #' + c.n + ': ' + pool.length + ' wallets, ' + bots.length + ' bots';
        } else if (act === 'unlock') {
          if (now() >= Date.parse(c.win.start)) throw fail(409, 'bad_state', 'Day 0 has started.', { st: c.st, want: ['locked'] });
          c.st = 'closed'; c.pool = []; c.pub = []; c.com = [];
          c.prv.lineup = c.prv.lineup.map((x, i) => ({ ...x, place: i }));
          // as the server's unlock: what the lock changed goes back (the state, when and by
          // whom), the reply and the note written since stay; one refunded since stays out
          for (const [w, was] of Object.entries(c.lockWas || {})) {
            const e = (S.entries[code] || {})[w];
            if (e && (e.st === 'lapsed' || e.st === 'wait') && !c.pay.refunds[w]) Object.assign(e, { st: was.st, at: was.at, by: was.by });
          }
          delete c.lockWas;
          delete c.lockAt;
          what = 'Unlocked #' + c.n;
        } else if (act === 'pause') { c.st = 'paused'; what = 'Paused #' + c.n; }
        else if (act === 'resume') { c.st = 'live'; what = 'Resumed #' + c.n; }
        else if (act === 'void') {
          needConfirm('VOID');
          c.st = 'void';
          for (const e of entriesOf(code)) if (e.b && e.b.ok && e.st !== 'no' && e.st !== 'out') c.pay.refunds[e.w] = c.pay.refunds[e.w] || null;
          what = 'Voided #' + c.n;
        } else if (act === 'engine') { c.cfg.e = E.SQUAD_ENGINE; if (c.st === 'paused') c.st = 'live'; what = 'Accepted engine ' + E.SQUAD_ENGINE + ' for #' + c.n; }
        else if (act === 'salt') { c.prv.salt = 'salt-' + code + '-' + hashHex(String(now())).slice(0, 6); what = 'Re-rolled the salt of #' + c.n; }
        else if (act === 'archive') {
          // from done only when nobody won (no prize is due), as the server's ADMIN_COMP
          if (c.st === 'done' && !(c.res && !c.res.winner)) throw fail(409, 'bad_state', 'Somebody won: record the prize on Results first, then give the rewards; then it can be archived.', { st: c.st, want: ['settled'], why: 'winner' });
          // archive freezes the refunds too: it waits for the ones still owed (ADMIN_COMP refunds_due)
          const owed = owedOf(c).length;
          if (owed) throw fail(409, 'refunds_due', (owed === 1 ? '1 refund is' : owed + ' refunds are') + ' still owed: record ' + (owed === 1 ? 'it' : 'them') + ' on Results first, then archive.', { owed });
          c.archived = true; what = 'Archived #' + c.n;
        }
        c.v++;
        logLine(what, 'comp', { comp: code, undo: act === 'pause' || act === 'close' });
        touch();
        return { ok: true, comp: full(c) };
      },
      async entries(code) {
        compOrFail(code);
        return { entries: clone(entriesOf(code)), counts: countsOf(code) };
      },
      async decide(code, body) {
        // as the server's ADMIN_ENTRY: every wallet is checked before any changes, and a
        // decision that changes nothing writes no log line; an archived competition is frozen
        const c = compOrFail(code);
        notArchived(c);
        const act = body && body.do;
        const WHAT = { approve: 'Approved', wait: 'Waitlisted', decline: 'Declined', undo: 'Undid the decision on', reply: 'Replied to', note: 'Noted on', dq: 'Disqualified', restore: 'Restored' };
        if (!Object.hasOwn(WHAT, act)) throw fail(400, 'bad_action', 'Unknown entry action.');
        const wallets = Array.isArray(body && body.wallets) ? [...new Set(body.wallets)] : [];
        if (!wallets.length || wallets.length > 50) throw fail(400, 'too_many', 'From 1 to 50 wallets at a time.');
        if (wallets.some((w) => !ADDR_RE.test(String(w)))) throw fail(400, 'bad_wallet', 'That is not a wallet address.');
        const why = cleanText(body.why, 140);
        const note = cleanText(body.note, 200);
        if (act === 'reply' && !why) throw fail(400, 'bad_cfg', 'Write the reply first.', { field: 'why' });
        if (act === 'note' && !note) throw fail(400, 'bad_cfg', 'Write the note first.', { field: 'note' });
        const undoN = act === 'undo' && Number.isInteger(body.log) ? body.log : null;
        checkV(c, body && body.v);
        const NEXT = { approve: 'ok', wait: 'wait', decline: 'no' };
        const PS = ['req', 'ok', 'wait'];
        if ((NEXT[act] || act === 'undo') && !['open', 'closed'].includes(c.st)) throw fail(409, 'bad_state', 'Decisions on requests are made while the sign-ups are open or closed.', { st: c.st, want: ['open', 'closed'] });
        if ((act === 'dq' || act === 'restore') && !['live', 'paused', 'done'].includes(c.st)) throw fail(409, 'bad_state', 'Disqualify and restore only while the competition plays or is done (before it is settled).', { st: c.st, want: ['live', 'paused', 'done'] });
        // after the final a disqualify changes who gets the prize: typed, as the server's ADMIN_ENTRY
        if (act === 'dq' && c.st === 'done' && String((body && body.confirm) || '').trim() !== 'DQ ' + c.n) throw fail(400, 'bad_cfg', 'The final table is in: type DQ and this competition’s number to disqualify after the final.', { field: 'confirm' });
        const es = S.entries[code] || {};
        for (const w of wallets) {
          const e = es[w];
          if (!e) throw fail(404, 'not_entered', 'That wallet has no entry in this competition.', { wallet: w });
          if (NEXT[act] && !PS.includes(e.st)) throw fail(409, 'bad_state', 'Not from ' + e.st + '.', { wallet: w, st: e.st, want: PS });
          if (act === 'undo' && (e.ps === null || e.ps === undefined || !['req', 'ok', 'wait', 'no'].includes(e.st) || (undoN !== null && e.pn !== undoN))) throw fail(409, 'no_undo', 'That decision cannot be undone any more: the entry moved on.', { wallet: w });
          if ((act === 'dq' || act === 'restore') && !['ok', 'dq'].includes(e.st)) throw fail(409, 'bad_state', 'Not from ' + e.st + '.', { wallet: w, st: e.st, want: ['ok', 'dq'] });
          // a refunded entry stays as it is, as the server's ADMIN_ENTRY: no undo or approve
          // brings it in, no decline moves the time its refund was due from
          if ((act === 'undo' || NEXT[act]) && c.pay.refunds[w]) throw fail(409, 'refunded', act === 'decline' ? 'That entry was refunded: its burn went back, so it stays as it is (out of the competition).' : 'That entry was refunded: its burn went back, so it stays out.', { wallet: w });
        }
        const n = S.logSeq + 1;
        let changed = 0;
        const out = [];
        for (const w of wallets) {
          const e = es[w];
          const before = JSON.stringify([e.st, e.why, e.note]);
          if (NEXT[act]) {
            if (e.st !== NEXT[act]) { e.ps = PS.indexOf(e.st); e.pn = n; e.pw = e.why || ''; e.st = NEXT[act]; }
            if (act === 'decline' && why) e.why = why;
          } else if (act === 'undo') {
            const was = e.st;
            e.st = PS[e.ps]; e.why = e.pw || ''; e.ps = null; e.pn = null; e.pw = '';
            // a refund that was only due because of the decline is due no more
            if (was === 'no' && c.pay.refunds[w] === null && c.st !== 'void') delete c.pay.refunds[w];
          } else if (act === 'reply') e.why = why;
          else if (act === 'dq') { if (e.st === 'ok') { e.st = 'dq'; if (why) e.why = why; } }
          else if (act === 'restore') { if (e.st === 'dq') e.st = 'ok'; }
          if (note && act !== 'note') e.note = note;
          if (act === 'note') e.note = note;
          if (act === 'decline' && e.st === 'no' && e.b && e.b.ok && !e.free) c.pay.refunds[w] = c.pay.refunds[w] || null;
          // when and by whom: the entry's change of state (a decision, an undo), never the
          // words alone, as the server's (a refund is due from the decline's time)
          if (act === 'undo' || JSON.stringify([e.st, e.why, e.note]) !== before) {
            changed++;
            if (act === 'undo' || e.st !== JSON.parse(before)[0]) { e.at = iso(now()); e.by = BY; }
          }
          out.push(clone(e));
        }
        if (!changed) return { ok: true, changed: 0, entries: out, log: null, v: c.v };
        // the winner disqualified or restored after the final: the prize is burned, or paid again
        let burn;
        if (c.st === 'done' && (act === 'dq' || act === 'restore') && c.res && c.res.winner && wallets.includes(c.res.winner)) {
          burn = isBot(c.res.winner) || (es[c.res.winner] && es[c.res.winner].st === 'dq') || !!S.bans[c.res.winner];
          c.res.burn = burn;
        }
        const line = logLine(WHAT[act] + ' ' + (wallets.length === 1 ? short(wallets[0]) : wallets.length + ' wallets') + ' for #' + c.n + (why && (act === 'decline' || act === 'dq') ? ': ' + why : ''), 'entry', { comp: code, ...(wallets.length === 1 ? { wallet: wallets[0] } : { wallets: wallets.slice() }), undo: !!NEXT[act] });
        // which wallets an Undo of this line puts back (kept beside the log, whose lines keep the server's shape)
        if (NEXT[act]) { S.undoW = S.undoW || {}; S.undoW[line] = wallets.slice(); }
        // an undo from the toast closes the Undo of the line it undid
        if (act === 'undo' && undoN !== null) { const x = S.log.find((l) => l.n === undoN); if (x) x.undo = false; }
        c.v++;
        touch();
        return { ok: true, changed, entries: out, log: line, v: c.v, ...(burn !== undefined ? { burn } : {}) };
      },
      async addByHand(code, body) {
        const c = compOrFail(code);
        notArchived(c);
        const w = body && body.wallet;
        if (!ADDR_RE.test(String(w || ''))) throw fail(400, 'bad_wallet', 'That is not a wallet address.');
        if (!['open', 'closed'].includes(c.st)) throw fail(409, 'closed', 'Sign-ups are not open.');
        if (!wallet(w)) throw fail(404, 'no_blub', 'That wallet has no team.');
        if (Date.parse(wallet(w).created) > now() - (c.cfg.minAge || 0) * DAY) throw fail(409, 'too_new', 'That team is younger than ' + c.cfg.minAge + ' day' + (c.cfg.minAge === 1 ? '' : 's') + '.', { minAge: c.cfg.minAge });
        if (S.bans[w]) throw fail(403, 'banned', 'That wallet is banned.');
        if (w === PROJECT) throw fail(403, 'is_moderator', 'Moderators cannot enter.');
        if (S.entries[code] && S.entries[code][w] && S.entries[code][w].st !== 'out') throw fail(409, 'already', 'That wallet entered already.', { st: S.entries[code][w].st });
        // a wallet refunded here is out for good, as the server's ADMIN_ENTRY
        if (c.pay.refunds[w]) throw fail(409, 'refunded', 'That wallet was refunded in this competition: it cannot be entered again.', { wallet: w });
        if (countsOf(code).ok >= c.cfg.size) throw fail(409, 'full', 'No places left.');
        let b = null;
        if (!body.free && !body.sig) throw fail(400, 'bad_cfg', 'Paste the signature of the burn, or enter it free.', { field: 'sig' });
        if (body.sig) {
          const v = verdictOf(c, body.sig, w, 'entry');
          if (!v.ok) throw fail(v.code === 'rpc_busy' ? 503 : 400, v.code, v.message);
          b = { sig: body.sig, raw: v.raw, slot: v.slot, bt: v.bt, fp: v.fp === w, ok: true };
        }
        const e = { w, t: iso(now()), m: '', x: '', tg: '', dc: '', st: 'ok', ps: null, at: iso(now()), by: BY, why: '', note: cleanText(body.why, 200), b, free: !b, hand: true, signals: { ip: 1, fp: !!(b && !b.fp), newTeam: now() - Date.parse(wallet(w).created) < DAY, sameSquad: 0 }, legal: [true, true, true] };
        (S.entries[code] = S.entries[code] || {})[w] = e;
        c.v++;
        const line = logLine('Entered ' + short(w) + ' by hand for #' + c.n + (b ? ' with a signature' : ' (free)') + (e.note ? ': ' + e.note : ''), 'entry', { comp: code, wallet: w });
        touch();
        return { ok: true, entry: clone(e), log: line, v: c.v };
      },
      // the chain's facts, as the server's verify gives them (lib/solana.mjs verdictOf): a
      // burn (by the wallet named, or anyone) or a transfer from the project wallet (to the
      // wallet named); the amounts and the window are the panel's to compare
      async verify(code, body) {
        compOrFail(code);
        const sig = String((body && body.sig) || '').trim();
        const w = body && body.wallet ? String(body.wallet) : '';
        if (w && !ADDR_RE.test(w)) throw fail(400, 'bad_wallet', 'That is not a wallet address.');
        if (!SANDBOX_SIG.test(sig)) throw fail(400, 'bad_sig', 'That is not a transaction signature (base58, 64 bytes).');
        const f = factsOf(sig, w);
        const none = { ok: false, kind: null, raw: null, slot: null, bt: null, fp: false, signer: w || null };
        if (!f) return { ...none, code: 'not_final', message: 'Not on the sandbox’s chain: it knows only its own example signatures.' };
        const base = { kind: f.kind, raw: f.raw, slot: f.slot, bt: f.bt, fp: !!w && f.fp === w, signer: f.signer, ...(f.to ? { to: f.to } : {}) };
        if (f.code) return { ...none, ...base, ok: false, kind: null, code: f.code, message: f.message || f.code };
        if (f.kind === 'burn') {
          if (w && f.signer !== w) return { ...none, slot: f.slot, bt: f.bt, code: 'not_yours', message: 'That burn was not signed by that wallet.' };
          return { ok: true, ...base, message: 'A burn of $BLUB.' };
        }
        if (f.signer !== PROJECT) return { ...none, slot: f.slot, bt: f.bt, code: 'not_burn', message: 'A transfer, not from the project wallet and not a burn.' };
        if (w && f.to !== w) return { ...none, slot: f.slot, bt: f.bt, code: 'not_yours', message: 'That transfer went to another wallet.' };
        return { ok: true, ...base, message: 'A transfer of $BLUB from the project wallet.' };
      },
      async lineup(code, body) {
        const c = compOrFail(code);
        if (!['draft', 'open', 'closed'].includes(c.st)) throw fail(409, 'bad_state', 'The lineup is drawn already.', { st: c.st, want: ['draft', 'open', 'closed'] });
        const act = body && body.do;
        if (act === 'mix') c.prv.lineup = mixLineup(c, body.mix || { A: 30, B: 40, C: 30 }, body.xMax === undefined ? 20 : body.xMax);
        else if (act === 'set') c.prv.lineup = (body.places || []).map((p) => { const d = deckOf(p.deck); if (!d) throw fail(400, 'bad_cfg', 'No deck #' + p.deck + '.', { field: 'deck' }); return { place: p.place, deck: d.id, tier: d.tier, x: d.x }; });
        else if (act === 'swap') { const d = deckOf(body.deck); if (!d) throw fail(400, 'bad_cfg', 'No deck #' + body.deck + '.', { field: 'deck' }); const L = c.prv.lineup.find((x) => x.place === body.place); if (L) Object.assign(L, { deck: d.id, tier: d.tier, x: d.x }); else c.prv.lineup.push({ place: body.place, deck: d.id, tier: d.tier, x: d.x }); }
        else throw fail(400, 'bad_action', 'Unknown lineup action.');
        c.v++;
        logLine('Set the bot lineup of #' + c.n + ' (' + act + ')', 'comp', { comp: code });
        touch();
        return { ok: true, lineup: clone(c.prv.lineup), botWinPct: botWinPct(c) };
      },
      async day(code, d) {
        const c = compOrFail(code);
        if (!Number.isInteger(d) || d < 0 || d > 6) throw fail(400, 'bad_cfg', 'A day is 0 to 6.', { field: 'day' });
        await ensurePlayed(code);
        return dayRecord(c, d);
      },
      async results(code) {
        const c = compOrFail(code);
        await ensurePlayed(code);
        if (!c.res) throw fail(409, 'bad_state', 'Not played out yet.', { st: c.st, want: ['done', 'settled', 'rewarded'] });
        return { ...clone(c.res), pay: clone(c.pay) };
      },
      async pay(code, body) {
        const c = compOrFail(code);
        notArchived(c);
        const kind = body && body.kind;
        if (!['payout', 'burn', 'refund'].includes(kind)) throw fail(400, 'bad_cfg', 'Pick payout, burn or refund.', { field: 'kind' });
        const sig = String((body && body.sig) || '').trim();
        if (!SANDBOX_SIG.test(sig)) throw fail(400, 'bad_sig', 'That is not a transaction signature (base58, 64 bytes).');
        const wallet = body.wallet ? String(body.wallet) : '';
        if (wallet && !ADDR_RE.test(wallet)) throw fail(400, 'bad_wallet', 'That is not a wallet address.');
        if ((body && body.confirm) !== 'PAY ' + c.n) throw fail(400, 'bad_cfg', 'Type PAY ' + c.n + ' to confirm.', { field: 'confirm' });
        if (kind === 'refund') {
          if (!wallet) throw fail(400, 'bad_wallet', 'Name the wallet the refund went to.');
          const e = (S.entries[code] || {})[wallet];
          if (!e) throw fail(404, 'not_entered', 'That wallet has no entry in this competition.');
          // as ADMIN_PAY: an unverified refund recorded again with its own signature, whatever
          // the entry's state says now (it was due when it was recorded); a refund recorded for
          // a withdrawn entry of a void competition before (an older build) too
          const rr = c.pay.refunds[wallet];
          const same = !!(rr && rr.ok === false && rr.sig === sig);
          if (!refundable(c, e) && !((same || (c.st === 'void' && rr)) && e.b && e.b.sig)) throw fail(409, 'bad_state', 'Only a paid entry that did not play gets a refund: declined, left out at the lock (waiting, lapsed or never decided on) or voided.', { st: c.st, want: [] });
          if (rr && rr.ok) throw fail(409, 'already', 'That refund is recorded already.');
        } else {
          // in the server's ADMIN_PAY order: a winner, the kind, then the state
          if (!c.res || !c.res.winner) throw fail(409, 'bad_state', c.st === 'done' ? 'Nobody won: the final table has no winner, so no prize is paid out or burned. Archive it once its refunds are recorded.' : 'The prize is recorded once the competition is done; it is ' + c.st + ' now.', { st: c.st, want: [] });
          // as ADMIN_PAY: a payout or burn that stands verified decides, the money moved; an
          // unverified one recorded again with its own signature keeps its kind; any other
          // signature is a new transfer, so the prize at pay time, not as the final table
          // wrote it: a bot winner, or a winner whose entry is disqualified now or who is
          // banned now; its record replaces an unverified one of the other kind
          const we = (S.entries[code] || {})[c.res.winner];
          const wasKind = c.pay.burn ? 'burn' : c.pay.payout ? 'payout' : '';
          const was = wasKind ? c.pay[wasKind] : null;
          const wasOk = !!was && was.ok !== false;
          let rec = '';
          let burnt;
          if (wasOk) [burnt, rec] = [wasKind === 'burn', 'recorded'];
          else if (was && wasKind === kind && was.sig === sig) burnt = kind === 'burn';
          else {
            burnt = isBot(c.res.winner) || !!(we && we.st === 'dq') || !!S.bans[c.res.winner];
            if (was && wasKind === kind) rec = 'amber';
          }
          const want = burnt ? 'burn' : 'payout';
          if (kind !== want) {
            const msg = rec === 'recorded' ? (burnt ? 'The prize burn is recorded and verified: the prize is burned, not paid out.' : 'The payout is recorded and verified: the prize is paid out, not burned.')
              : rec === 'amber' ? (burnt ? 'The winner is disqualified or banned now: the prize is burned, not paid out. The unverified payout can be recorded again with its own signature only; a prize burn recorded now replaces it.' : 'The winner is in good standing now: the prize is paid out, not burned. The unverified prize burn can be recorded again with its own signature only; a payout recorded now replaces it.')
              : burnt ? 'A bot won, or the winner is disqualified or banned: the prize is burned, not paid out.' : 'A player won: the prize is paid out, not burned.';
            throw fail(400, 'bad_cfg', msg, { field: 'kind', want });
          }
          if (!(c.st === 'done' || (was && !wasOk && ['settled', 'rewarded'].includes(c.st)))) throw fail(409, 'bad_state', 'The prize is recorded once the competition is done; it is ' + c.st + ' now.', { st: c.st, want: ['done'] });
        }
        // a signature counts once: entries' burns, payouts, burns and refunds, every competition
        const recs = (x) => [x.pay.payout, x.pay.burn, ...Object.values(x.pay.refunds)].filter(Boolean);
        const mine = kind === 'refund' ? c.pay.refunds[wallet] : c.pay[kind];
        const used = Object.values(S.comps).some((x) => recs(x).some((r) => r.sig === sig && r !== mine)) || Object.values(S.entries).some((es) => Object.values(es).some((e) => e.b && e.b.sig === sig));
        if (used) throw fail(409, 'sig_used', 'That signature was used before.');
        const f = factsOf(sig, kind === 'refund' ? wallet : '');
        const need = bpsOf(c.sup ? c.sup.supply : '0', kind === 'refund' ? c.cfg.entryBps : c.cfg.prizeBps);
        const to = kind === 'payout' ? c.res.winner : kind === 'refund' ? wallet : PROJECT;
        let why = '';
        if (!f) why = 'not_final';
        else if (f.code) why = f.code;
        else if (kind === 'burn' ? f.kind !== 'burn' : f.kind !== 'transfer') why = kind === 'burn' ? 'not_burn' : 'not_transfer';
        else if (f.signer !== PROJECT) why = 'not_yours';
        else if (kind !== 'burn' && f.to !== to) why = 'not_yours';
        else if (BigInt(f.raw) < BigInt(need)) why = 'too_small';
        if (why && !body.unverified) throw fail(why === 'not_final' ? 409 : 400, why, ({ not_final: 'Not on the sandbox’s chain: it knows only its own example signatures.', not_burn: 'That is not a burn by the project wallet.', not_transfer: 'That is not a transfer from the project wallet.', not_yours: kind === 'burn' ? 'The project wallet did not make that burn.' : 'That transfer went to another wallet.', too_small: 'That moved less than is due.' })[why] || why);
        const ok = !why;
        const rec = { kind, sig, raw: f && !f.code ? f.raw : null, ...(to ? { to } : {}), bt: f ? f.bt : null, ok, by: BY, t: iso(now()), ...(ok ? {} : { why }) };
        const other = kind === 'refund' ? '' : kind === 'burn' ? 'payout' : 'burn';
        const replaces = !!(other && c.pay[other]);
        if (kind === 'refund') c.pay.refunds[wallet] = rec;
        else {
          c.pay[kind] = rec;
          // never both: a new payout or burn replaces an unverified record of the other kind
          if (replaces) delete c.pay[other];
          if (c.st === 'done') c.st = 'settled';
          // the final table says what was done with the prize
          c.res.burn = kind === 'burn';
        }
        c.v++;
        logLine({ payout: 'Recorded the payout', burn: 'Recorded the prize burn', refund: 'Recorded a refund' }[kind] + ' of #' + c.n + (kind === 'burn' ? '' : ' to ' + short(to)) + ' (' + sig.slice(0, 6) + '…)' + (ok ? '' : ' unverified: ' + why) + (replaces ? ' (replaces the unverified ' + (other === 'burn' ? 'prize burn' : 'payout') + ')' : ''), 'pay', { comp: code, ...(kind === 'burn' ? {} : { wallet: to }) });
        touch();
        return { ok: true, verified: ok, why: ok ? null : why, pay: clone(rec), comp: full(c) };
      },
      async rewards(code, body) {
        const c = compOrFail(code);
        notArchived(c);
        const act = body && body.do;
        if (act === 'give') {
          if ((body && body.confirm) !== 'GIVE ' + c.n) throw fail(400, 'bad_cfg', 'Type GIVE ' + c.n + ' to confirm.', { field: 'confirm' });
          if (c.st !== 'settled') throw fail(409, 'bad_state', 'Record the payout first.', { st: c.st, want: ['settled'] });
          if (c.aw) throw fail(409, 'already', 'The rewards were given.');
          const list = rewardsPreview(full(c));
          for (const x of list) {
            const inv = (S.inv[x.id] = S.inv[x.id] || { tok: 0, items: [] });
            if (x.item && !inv.items.includes(x.item)) inv.items.push(x.item);
            if (x.tok) inv.tok += x.tok;
            (S.invh[x.id] = S.invh[x.id] || []).unshift({ t: iso(now()), by: BY, what: x.item ? 'Given ' + x.item : 'Given ' + x.tok + ' unlock token' + (x.tok === 1 ? '' : 's'), why: 'Rewards of #' + c.n });
          }
          for (const p of [1, 2, 3]) { const row = c.res.table.find((x) => x.place === p); if (row && !isBot(row.id) && wallet(row.id)) wallet(row.id).troph = [...(wallet(row.id).troph || []), 'c' + c.n + ':' + p]; }
          c.aw = { t: iso(now()), by: BY, list };
          c.st = 'rewarded';
          c.v++;
          logLine('Gave the rewards of #' + c.n + ' to ' + new Set(list.map((x) => x.id)).size + ' wallets', 'rewards', { comp: code, undo: true });
          touch();
          return { ok: true, aw: clone(c.aw), given: clone(list) };
        }
        if (act === 'take') {
          if (c.st !== 'rewarded' || !c.aw) throw fail(409, 'bad_state', 'No rewards were given.', { st: c.st, want: ['rewarded'] });
          // tokens spent since cannot come back: the log line says the shortfall (as ADMIN_REWARDS)
          let short = 0;
          const shortW = new Set();
          for (const x of c.aw.list) {
            const inv = S.inv[x.id];
            if (!inv) continue;
            if (x.item) inv.items = inv.items.filter((i) => i !== x.item);
            if (x.tok && inv.tok < x.tok) { short += x.tok - inv.tok; shortW.add(x.id); }
            if (x.tok) inv.tok = Math.max(0, inv.tok - x.tok);
            (S.invh[x.id] = S.invh[x.id] || []).unshift({ t: iso(now()), by: BY, what: x.item ? 'Taken ' + x.item : 'Taken ' + x.tok + ' unlock token' + (x.tok === 1 ? '' : 's'), why: 'Rewards of #' + c.n + ' taken back' });
          }
          for (const w of Object.values(S.wallets)) if (w.troph) w.troph = w.troph.filter((t) => !t.startsWith('c' + c.n + ':'));
          const list = c.aw.list;
          c.aw = null;
          c.st = 'settled';
          c.v++;
          logLine('Took back the rewards of #' + c.n + (short ? ' (short ' + short + ' unlock token' + (short === 1 ? '' : 's') + ' from ' + shortW.size + ' wallet' + (shortW.size === 1 ? '' : 's') + ': spent already)' : ''), 'rewards', { comp: code });
          touch();
          return { ok: true, aw: null, given: clone(list) };
        }
        throw fail(400, 'bad_action', 'Unknown rewards action.');
      },
    },
    decks: {
      async library() { return { decks: clone(S.decks) }; },
      async save(deck) {
        const d = deck && typeof deck === 'object' ? deck : {};
        const plan = Array.isArray(d.plan) ? d.plan.map((s) => E.cleanSquad(s)) : [];
        if (plan.length !== 3 || !plan.every(Boolean)) throw fail(400, 'bad_cfg', 'A deck is three legal squads (A, B, C).', { field: 'plan' });
        let rec = d.id ? deckOf(d.id) : null;
        if (d.id && !rec) throw fail(404, 'not_found', 'No deck #' + d.id + '.');
        if (!rec) { rec = { id: ++S.deckSeq, n: '', plan, pct: null, e: null, tier: null, x: false, src: '', note: '', rec: { hw: 0, hl: 0, bw: 0, bl: 0 }, retired: false }; S.decks.push(rec); }
        // a changed plan needs a new rating
        if (JSON.stringify(plan) !== JSON.stringify(rec.plan.map((q) => E.cleanSquad(q)))) { rec.pct = null; rec.tier = null; rec.e = null; }
        Object.assign(rec, { n: cleanText(d.n, 40) || 'Deck #' + rec.id, plan, x: !!d.x, src: cleanText(d.src, 60), note: cleanText(d.note, 200) });
        // the bots' record (the Bot report's Save record): whole numbers only
        if (d.rec && typeof d.rec === 'object') {
          const k = ['hw', 'hl', 'bw', 'bl'];
          if (!k.every((x) => Number.isInteger(d.rec[x]) && d.rec[x] >= 0 && d.rec[x] < 1e6)) throw fail(400, 'bad_cfg', 'A record is four whole numbers.', { field: 'rec' });
          rec.rec = Object.fromEntries(k.map((x) => [x, d.rec[x]]));
        }
        logLine('Saved deck #' + rec.id + ' ' + rec.n, 'deck');
        touch();
        return { ok: true, deck: clone(rec) };
      },
      async retire(id) {
        const d = deckOf(id);
        if (!d) throw fail(404, 'not_found', 'No deck #' + id + '.');
        d.retired = true;
        logLine('Retired deck #' + d.id + ' ' + d.n, 'deck');
        touch();
        return { ok: true, deck: clone(d) };
      },
      async promote(id) {
        const d = deckOf(id);
        if (!d) throw fail(404, 'not_found', 'No deck #' + id + '.');
        d.x = false; d.retired = false;
        logLine('Promoted deck #' + d.id + ' ' + d.n, 'deck');
        touch();
        return { ok: true, deck: clone(d) };
      },
      async rate(id, body) {
        const d = deckOf(id);
        if (!d) throw fail(404, 'not_found', 'No deck #' + id + '.');
        const pct = Array.isArray(body && body.pct) ? body.pct.map(Number) : [];
        if (pct.length !== 3 || !pct.every((p) => p >= 0 && p <= 100)) throw fail(400, 'bad_cfg', 'Three percentages.', { field: 'pct' });
        d.pct = pct.map(Math.round);
        d.e = Number(body.e) || E.SQUAD_ENGINE;
        d.tier = d.pct[0] >= 58 ? 'A' : d.pct[0] >= 45 ? 'B' : 'C';
        logLine('Rated deck #' + d.id + ' ' + d.n + ': ' + d.pct.join(' / '), 'deck');
        touch();
        return { ok: true, deck: clone(d) };
      },
    },
    wallets: {
      async find(q) {
        const s = String(q || '').trim().toLowerCase();
        if (s.length < 2) return { hits: [] };
        const hits = [];
        for (const [id, w] of Object.entries(S.wallets)) {
          if (id.toLowerCase().includes(s) || w.name.toLowerCase().includes(s) || (w.player || '').toLowerCase().includes(s)) {
            const m = S.lg[id];
            hits.push({ id, name: w.name, player: w.player || '', look: w.look, style: w.style, ...(m ? { league: { d: m.d, g: m.g } } : {}) });
          }
          if (hits.length >= 12) break;
        }
        return { hits };
      },
      get: (id) => api.player(id),
      async inventory(body) {
        const act = body && body.do;
        const list = Array.isArray(body && body.wallets) ? [...new Set(body.wallets)] : [];
        if (!list.length || list.length > 100) throw fail(400, 'too_many', 'From 1 to 100 wallets at a time.');
        const item = String(body.item || '');
        if (!EXCL[item] && !PIN_RE.test(item)) throw fail(400, 'bad_item', 'That is not an exclusive item or a pin.');
        if (act !== 'give' && act !== 'take') throw fail(400, 'bad_action', 'Unknown inventory action.');
        const why = cleanText(body.why, 140);
        if (list.some((w) => !ADDR_RE.test(w))) throw fail(400, 'bad_wallet', short(list.find((w) => !ADDR_RE.test(w))) + ' is not a wallet address.');
        const changed = [];
        for (const w of list) {
          const inv = (S.inv[w] = S.inv[w] || { tok: 0, items: [] });
          if (act === 'give') { if (inv.items.includes(item)) continue; inv.items.push(item); }
          else { if (!inv.items.includes(item)) { if (list.length === 1) throw fail(409, 'not_owned', short(w) + ' does not own ' + item + '.'); continue; } stripItem(w, item); }
          (S.invh[w] = S.invh[w] || []).unshift({ t: iso(now()), by: BY, what: (act === 'give' ? 'Given ' : 'Taken ') + item, why });
          changed.push(w);
        }
        const n = changed.length;
        if (n) {
          const line = logLine((act === 'give' ? 'Gave ' : 'Took ') + item + (act === 'give' ? ' to ' : ' from ') + (list.length === 1 ? short(list[0]) : n + ' wallets') + (why ? ': ' + why : ''), 'inv', { ...(list.length === 1 ? { wallet: list[0] } : { wallets: changed.slice() }), undo: true });
          // what an Undo of this line puts back (kept beside the log, whose lines keep the server's shape)
          S.undoInv = S.undoInv || {};
          S.undoInv[line] = { do: act, item, wallets: changed };
        }
        touch();
        return { ok: true, n, ...(list.length === 1 ? { inv: clone(S.inv[list[0]]) } : {}) };
      },
      async tokens(body) {
        const list = Array.isArray(body && body.wallets) ? [...new Set(body.wallets)] : [];
        if (!list.length || list.length > 100) throw fail(400, 'too_many', 'From 1 to 100 wallets at a time.');
        const n = Number(body.n);
        if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 99) throw fail(400, 'bad_count', 'A whole number of tokens, from -99 to 99.');
        const why = cleanText(body.why, 140);
        if (list.some((w) => !ADDR_RE.test(w))) throw fail(400, 'bad_wallet', short(list.find((w) => !ADDR_RE.test(w))) + ' is not a wallet address.');
        // what each wallet's count really moved (a count never goes below 0), for Undo
        const moved = {};
        for (const w of list) {
          const inv = (S.inv[w] = S.inv[w] || { tok: 0, items: [] });
          const was = inv.tok;
          inv.tok = Math.max(0, inv.tok + n);
          if (inv.tok === was) continue;
          moved[w] = inv.tok - was;
          (S.invh[w] = S.invh[w] || []).unshift({ t: iso(now()), by: BY, what: (n > 0 ? 'Given ' + n : 'Taken ' + -n) + ' unlock token' + (Math.abs(n) === 1 ? '' : 's'), why });
        }
        const k = Object.keys(moved).length;
        if (k) {
          const line = logLine((n > 0 ? 'Gave ' + n : 'Took ' + -n) + ' unlock token' + (Math.abs(n) === 1 ? '' : 's') + (n > 0 ? ' to ' : ' from ') + (list.length === 1 ? short(list[0]) : k + ' wallets') + (why ? ': ' + why : ''), 'inv', { ...(list.length === 1 ? { wallet: list[0] } : { wallets: Object.keys(moved) }), undo: true });
          S.undoInv = S.undoInv || {};
          S.undoInv[line] = { tok: moved };
        }
        touch();
        return { ok: true, n: k, ...(list.length === 1 ? { inv: clone(S.inv[list[0]]) } : {}) };
      },
      bulk: bulkWallets,
    },
    async chain() { return chainNow(); },
    async log(f) {
      const o = f || {};
      let list = S.log.slice().sort((a, b) => b.n - a.n);
      if (o.kind) list = list.filter((x) => (x.kind || 'league') === o.kind);
      if (o.comp) list = list.filter((x) => x.comp === o.comp);
      if (o.by) list = list.filter((x) => x.by === o.by);
      if (o.wallet) list = list.filter((x) => x.wallet === o.wallet || (Array.isArray(x.wallets) && x.wallets.includes(o.wallet)));
      return { log: clone(list.slice(0, Math.min(200, Number(o.limit) || 200))) };
    },
    async undo(n) {
      const x = S.log.find((l) => l.n === Number(n));
      if (!x || !x.undo) throw fail(409, 'no_undo', 'That cannot be undone.');
      if (x.kind === 'league' && /^Paused/.test(x.what)) await api.league('resume');
      else if (x.kind === 'player' && /^Banned/.test(x.what) && x.wallet) await api.playerDo({ do: 'unban', id: x.wallet });
      else if (x.kind === 'rewards' && x.comp) await api.comps.rewards(x.comp, { do: 'take', confirm: 'TAKE ' + S.comps[x.comp].n });
      else if (x.kind === 'comp' && x.comp && /^Paused/.test(x.what)) await api.comps.act(x.comp, { do: 'resume' });
      else if (x.kind === 'comp' && x.comp && /^Closed/.test(x.what)) await api.comps.act(x.comp, { do: 'reopen' });
      else if (x.kind === 'entry' && x.comp && ((S.undoW && S.undoW[x.n]) || x.wallets || x.wallet)) await api.comps.decide(x.comp, { do: 'undo', wallets: (S.undoW && S.undoW[x.n]) || (x.wallets || [x.wallet]), log: x.n });
      else if (x.kind === 'inv' && S.undoInv && S.undoInv[x.n]) undoInv(x, S.undoInv[x.n]);
      else if (x.kind === 'inv' && x.wallet) {
        const m = /^Gave (\S+) to/.exec(x.what);
        const t = /^Gave (\d+) unlock/.exec(x.what);
        if (t) await api.wallets.tokens({ wallets: [x.wallet], n: -Number(t[1]), why: 'undo' });
        else if (m) await api.wallets.inventory({ do: 'take', wallets: [x.wallet], item: m[1], why: 'undo' });
        else throw fail(409, 'no_undo', 'That cannot be undone.');
      } else throw fail(409, 'no_undo', 'That cannot be undone.');
      x.undo = false;
      touch();
      return { ok: true };
    },
  };
  // a taken item leaves the wallet's inventory and the five looks it was worn in
  function stripItem(w, item) {
    const inv = S.inv[w];
    if (inv) inv.items = inv.items.filter((i) => i !== item);
    const rec = wallet(w);
    if (!rec) return;
    const [k, v] = item.split(':');
    if (rec.look && rec.look[k] === v) rec.look[k] = 'geen';
    for (const m of rec.squad || []) if (m.look && m.look[k] === v) m.look[k] = 'geen';
  }
  // puts an inventory line back: a given item taken again, a taken one given back, tokens
  // moved back by what they really moved; no_undo when nothing of it is left to undo
  function undoInv(x, u) {
    const t = iso(now());
    const hist = (w, what) => (S.invh[w] = S.invh[w] || []).unshift({ t, by: BY, what, why: 'Undo of log line ' + x.n });
    let k = 0;
    if (u.tok) {
      for (const [w, d] of Object.entries(u.tok)) {
        const inv = (S.inv[w] = S.inv[w] || { tok: 0, items: [] });
        const was = inv.tok;
        inv.tok = Math.max(0, inv.tok - d);
        if (inv.tok === was) continue;
        hist(w, (d > 0 ? 'Taken ' + (was - inv.tok) : 'Given ' + (inv.tok - was)) + ' unlock token' + (Math.abs(was - inv.tok) === 1 ? '' : 's'));
        k++;
      }
    } else {
      for (const w of u.wallets) {
        const inv = (S.inv[w] = S.inv[w] || { tok: 0, items: [] });
        if (u.do === 'give') { if (!inv.items.includes(u.item)) continue; stripItem(w, u.item); hist(w, 'Taken ' + u.item); }
        else { if (inv.items.includes(u.item)) continue; inv.items.push(u.item); hist(w, 'Given ' + u.item + ' back'); }
        k++;
      }
    }
    if (!k) throw fail(409, 'no_undo', 'That cannot be undone any more: the inventory moved on.');
    const ws = u.tok ? Object.keys(u.tok) : u.wallets;
    logLine('Undid: ' + x.what, 'inv', { ...(ws.length === 1 ? { wallet: ws[0] } : { wallets: ws.slice() }), undo: false });
    delete S.undoInv[x.n];
  }
  // a bot lineup from the library by tier mix (experiments at most xMax % of the places)
  // the wallets the lock draws: approved, a verified burn or a free entry, not banned
  const drawnN = (code) => entriesOf(code).filter((e) => e.st === 'ok' && ((e.b && e.b.ok) || e.free) && !S.bans[e.w]).length;
  function mixLineup(c, mix, xMax, count) {
    const free = count !== undefined ? count : Math.max(0, c.cfg.size - drawnN(c.code));
    const live = S.decks.filter((d) => !d.retired && d.tier);
    const want = { A: Math.round((free * (mix.A || 0)) / 100), B: Math.round((free * (mix.B || 0)) / 100) };
    want.C = Math.max(0, free - want.A - want.B);
    const out = [];
    let xs = 0;
    const r = E.rng(hashInt('mix' + c.code + free));
    for (const tier of ['A', 'B', 'C']) {
      const pool = live.filter((d) => d.tier === tier);
      for (let i = 0; i < want[tier] && pool.length; i++) {
        let d = pool[(i + Math.floor(r() * pool.length)) % pool.length];
        if (d.x && (xs + 1) * 100 > free * xMax) d = pool.find((q) => !q.x) || d;
        if (d.x) xs++;
        out.push({ place: out.length, deck: d.id, tier: d.tier, x: !!d.x });
      }
    }
    return out;
  }
  // the panel's estimate (admin.js botChance): bot places weighted 3/2/1 by tier
  const botWinPct = (c) => botChance(c.prv.lineup.slice(0, Math.max(0, c.cfg.size - drawnN(c.code))), drawnN(c.code));
  return api;
}
