// The moderators' panel (#admin). The page fetches this file for a moderator's wallet
// (S.admin, from /api/me), and the server checks every request again (lib/admin.mjs);
// where there is no moderator (the demo, local mode, a guest) the page opens it behind
// a 4-digit code on the sandbox backend (public/admin-local.js: data in this browser
// only, never the server).
//
// The panel talks to one object, the adapter (ctx.adapter; docs/competitions.md
// §Adapter): serverAdapter(API) here, every method one request to /api/admin/*, or
// localAdapter() from admin-local.js, the same methods and shapes on a store in
// localStorage. Switching a panel to the server is one line in openAdmin.
//
// Tabs: Now (the to-dos, the current competition, the week), Competitions (the list,
// and a stepper per competition: Setup, Entries, Pool & bots, Lock & draw, Live,
// Results, Rewards, Post this), Wallets (find a wallet or the bans; one wallet's screen with
// its competitions, inventory and history; bulk changes), Bots (the deck library),
// Leagues (start and stop, the week's moves and a replay, the league's bots), Log. The
// tab and a competition's step are remembered in this browser (lsPatch admTab, admComp).
// Every change is one request; after it the overview is read again (one command).

// the ranks (lib/league.mjs DIVISIONS): six sea creatures in bronze, silver and gold
const DIVS = ['Shrimp', 'Crab', 'Fish', 'Dolphin', 'Shark', 'Whale'].flatMap(a => ['Bronze', 'Silver', 'Gold'].map(t => t + ' ' + a));
// each rank's grade: bronze, silver, gold
const DIV_COL = DIVS.map((n, i) => ['#C77B30', '#C9D3E0', '#FFD447'][i % 3]);
const BOT_RE = /^bot:[1-9][0-9]{0,5}$/;
const ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LOG_KINDS = ['league', 'player', 'bots', 'comp', 'entry', 'pay', 'inv', 'deck', 'rewards'];
const TABS = [['now', 'Now'], ['comps', 'Competitions'], ['wallets', 'Wallets'], ['bots', 'Bots'], ['leagues', 'Leagues'], ['log', 'Log']];
// tabs of the first panel, remembered under their old names
const OLD_TABS = { players: 'wallets', sim: 'leagues' };
// a competition's stepper, and the step its state opens on
const STEPS = [['setup', 'Setup'], ['entries', 'Entries'], ['pool', 'Pool & bots'], ['lock', 'Lock & draw'], ['live', 'Live'], ['results', 'Results'], ['rewards', 'Rewards'], ['post', 'Post this']];
const STEP_OF = { draft: 'setup', open: 'entries', closed: 'entries', locked: 'lock', live: 'live', paused: 'live', done: 'results', settled: 'results', rewarded: 'rewards', void: 'results' };
const DAY = 86400000;
const WEEK_ID = /^\d{4}w\d{2}$/;
const PIN_RE = /^[a-z0-9]{8}\.(p1|p2|p3|t10|all)$/;
// a competition's own pin before it has a code in it: the server's default rewards (lib/comp.mjs DEFAULT_RW)
const PIN_PH = /^pin\.(p1|p2|p3|t10|all)$/;
// an item id of a reward: a look id (hat:ghost) or a week's pin (<code>.p1)
const ITEM_RE = /^[a-z0-9_.:-]{2,40}$/;
const INT31 = 0x7fffffff;

/* ---- the adapter's error, the same in both backends ---- */
export class AdminError extends Error {
  constructor(status, code, message) {
    super(message || code || 'That did not work.');
    this.status = status || 0;
    this.code = code || '';
  }
}
const asAdminError = (e) => {
  if (e instanceof AdminError) return e;
  const err = new AdminError(e && e.status, e && e.code, e && e.message);
  // what the server says along with a refusal: the field, since when it is locked, the
  // version a stale edit missed, the state and the states an action wants, the wallet
  // a batch decision stopped at, a competition's minimum team age
  for (const k of ['duel', 'field', 'since', 'v', 'st', 'want', 'wallet', 'minAge']) if (e && e[k] !== undefined) err[k] = e[k];
  return err;
};

/* ---- the server adapter: every method one request through the page's API ---- */
export function serverAdapter(API, me) {
  const call = (method, path, body) => API.admin(method, path, body).catch((e) => { throw asAdminError(e); });
  const get = (path) => call('GET', path);
  const post = (path, body) => call('POST', path, body);
  const comp = (code) => 'comp/' + encodeURIComponent(String(code || ''));
  return {
    mode: 'server',
    who: () => ({ addr: typeof me === 'function' ? me() : null, mode: 'server', since: null }),
    close: () => {},
    overview: () => get('overview'),
    league: (what) => post('league', { do: what }),
    player: (id) => get('player/' + encodeURIComponent(id)),
    playerDo: (o) => (o && o.do === 'removeTeam' ? API.remove(o.id).catch((e) => { throw asAdminError(e); }) : post('player', o)),
    bots: (o) => post('bots', o),
    comps: {
      list: async () => ({ comps: (await get('overview')).comps || [] }),
      get: (code) => get(comp(code)),
      create: (o) => post('comp', o),
      edit: (code, o) => post(comp(code), { do: 'edit', ...o }),
      act: (code, o) => post(comp(code), o),
      entries: async (code) => { const c = await get(comp(code)); return { entries: c.entries || [], counts: c.counts }; },
      decide: (code, o) => post(comp(code) + '/entries', o),
      addByHand: (code, o) => post(comp(code) + '/entries', { do: 'add', wallets: [o.wallet], sig: o.sig, free: o.free, why: o.why }).then((r) => ({ ...r, ok: true, entry: r.entry || (r.entries ? r.entries[0] : null) })),
      verify: (code, o) => post(comp(code) + '/verify', o),
      lineup: (code, o) => post(comp(code), { do: 'lineup', ...o }),
      // a played day is public (GET /api/comp/<code>/day/<d>, cached a day): the one path outside admin/
      day: (code, d) => call('GET', '/comp/' + encodeURIComponent(code) + '/day/' + d),
      results: async (code) => { const c = await get(comp(code)); return { ...(c.res || {}), pay: c.pay }; },
      pay: (code, o) => post(comp(code) + '/pay', o),
      rewards: (code, o) => post(comp(code) + '/rewards', o),
    },
    decks: {
      library: () => get('decks'),
      save: (deck) => post('decks', { do: 'save', deck }),
      retire: (id) => post('decks', { do: 'retire', id }),
      promote: (id) => post('decks', { do: 'promote', id }),
      rate: (id, o) => post('decks', { do: 'rate', id, ...o }),
    },
    wallets: {
      find: null, // the page's Meadow docs and the week's groups (renderFind), 0 commands
      get: (id) => get('player/' + encodeURIComponent(id)),
      inventory: (o) => post('inventory', o),
      tokens: (o) => post('inventory', { do: 'tokens', ...o }),
      bulk: bulkWallets,
    },
    chain: () => get('chain'),
    log: (f) => get('log').then((r) => ({ log: filterLog(r.log || [], f) })),
    // there is no undo route: the line (handed in, else read from the log) names the
    // reverse call, sent with `of: n` so the server marks the line done (docs/competitions.md §Adapter 26)
    undo: async (n, line) => {
      const x = line && line.n === n ? line : ((await get('log')).log || []).find((l) => l.n === n);
      const call = x && x.undo ? undoCall(x) : null;
      if (!call) throw new AdminError(409, 'no_undo', 'That cannot be undone.');
      await post(call.path, { ...call.body, of: Number(n) });
      return { ok: true };
    },
  };
}
// the reverse call of an undoable log line (as the server tags it), or null
function undoCall(x) {
  const what = String(x.what || '');
  const ws = Array.isArray(x.wallets) && x.wallets.length ? x.wallets : x.wallet ? [x.wallet] : [];
  const cp = (code) => 'comp/' + encodeURIComponent(code);
  if (x.kind === 'league' && /^Paused the leagues/.test(what)) return { path: 'league', body: { do: 'resume' } };
  if (x.kind === 'player' && /^Banned /.test(what) && x.wallet) return { path: 'player', body: { do: 'unban', id: x.wallet } };
  if (x.kind === 'comp' && x.comp && /^Paused the days/.test(what)) return { path: cp(x.comp), body: { do: 'resume' } };
  if (x.kind === 'comp' && x.comp && /^Closed the sign-ups/.test(what)) return { path: cp(x.comp), body: { do: 'reopen' } };
  if (x.kind === 'entry' && x.comp && ws.length && /^(Approved|Waitlisted|Declined)/.test(what)) return { path: cp(x.comp) + '/entries', body: { do: 'undo', wallets: ws, log: x.n } };
  const rw = /^Gave the rewards of #(\d+)/.exec(what);
  if (x.kind === 'rewards' && x.comp && rw) return { path: cp(x.comp) + '/rewards', body: { do: 'take', confirm: 'TAKE ' + rw[1] } };
  if (x.kind === 'inv' && ws.length) {
    const why = 'Undo of log line ' + x.n;
    if (Number.isInteger(x.tok) && x.tok !== 0) return { path: 'inventory', body: { do: 'tokens', wallets: ws, n: -x.tok, why } };
    if (typeof x.item === 'string' && /^Gave /.test(what)) return { path: 'inventory', body: { do: 'take', wallets: ws, item: x.item, why } };
    if (typeof x.item === 'string' && /^Took /.test(what)) return { path: 'inventory', body: { do: 'give', wallets: ws, item: x.item, why } };
  }
  return null;
}
/* ---- one door for every call: the panel talks to the adapter only through this ---- */
// the writes that carry the record's version (v): a stale one reads the competition again
// and is sent once more with the fresh version (the change itself is the same: a partial
// setup, an action or a decision, which the backend checks again in full)
const VERSIONED = new Set(['comps.edit', 'comps.act', 'comps.decide']);
// the reads the panel tries on purpose and handles itself (a day not played yet)
const QUIET = new Set(['comps.day']);
// the reads (everything else writes): after a change that went through, the change's own
// answer is the truth, so a read refused in the busy minute after it (429) is not told as
// a failure; it is marked `behind` and the page reads again a little later
export const READS = new Set(['overview', 'player', 'comps.list', 'comps.get', 'comps.entries', 'comps.day', 'comps.results', 'decks.library', 'wallets.get', 'chain', 'log']);
const BEHIND_MS = 20000;
// wraps an adapter: a refusal (AdminError) lands in a toast with its sentence; a 401 from the
// server hands over to the page (its session ended: sign in again); stale re-reads and
// re-applies once. Same methods and shapes as the adapter it wraps (mode, who, close as they are).
export function guardAdapter(A0, hooks) {
  const o = hooks || {};
  const now = typeof o.now === 'function' ? o.now : Date.now;
  let wrote = -Infinity;
  const told = (e, path) => {
    // AdminErrors only (the backends' refusals and a lost connection); a slip in the page's own code stays loud in the console
    if (!(e instanceof AdminError) || e.told) return;
    e.told = true;
    if (e.status === 429 && READS.has(path) && now() - wrote < BEHIND_MS) {
      e.behind = true;
      if (typeof o.behind === 'function') { try { o.behind(e, path); } catch { /* the page's own */ } }
      return;
    }
    if (A0.mode === 'server' && e.status === 401 && typeof o.signedOut === 'function') { try { o.signedOut(e); } catch { /* the page's own */ } }
    if (!QUIET.has(path) && typeof o.say === 'function') o.say(e, path);
  };
  const wrap = (fn, path) => (...args) => {
    let r;
    try { r = fn(...args); } catch (e) { told(e, path); throw e; }
    if (!r || typeof r.then !== 'function') return r;
    if (!READS.has(path)) r = r.then((x) => { wrote = now(); return x; });
    return r.catch(async (e) => {
      if (e && e.code === 'stale' && VERSIONED.has(path) && args[1] && typeof args[1] === 'object' && A0.comps && typeof A0.comps.get === 'function') {
        let again;
        try {
          const fresh = await A0.comps.get(args[0]);
          if (typeof o.fresh === 'function') o.fresh(fresh);
          again = await fn(args[0], { ...args[1], v: fresh.v }, ...args.slice(2));
        } catch (e2) { told(e2, path); throw e2; }
        if (typeof o.reapplied === 'function') o.reapplied(path);
        wrote = now();
        return again;
      }
      told(e, path);
      throw e;
    });
  };
  const walk = (obj, pre) => {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'function' && !['who', 'close', 'reset'].includes(k)) out[k] = wrap(v, pre + k);
      else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = walk(v, pre + k + '.');
      else out[k] = v;
    }
    return out;
  };
  return walk(A0, '');
}
// up to 100 wallet addresses pasted one a line (or separated by spaces and commas), no doubles
export function bulkWallets(text) {
  return parseBulk(text).ok;
}
export function filterLog(list, f) {
  const o = f || {};
  let L = list.slice();
  if (o.kind) L = L.filter((x) => (x.kind || 'league') === o.kind);
  if (o.comp) L = L.filter((x) => x.comp === o.comp);
  if (o.by) L = L.filter((x) => x.by === o.by);
  if (o.wallet) L = L.filter((x) => x.wallet === o.wallet || (Array.isArray(x.wallets) && x.wallets.includes(o.wallet)));
  return L.slice(0, Math.min(200, Number(o.limit) || 200));
}
// who gets what when a competition's rewards are given (pure, so a test can import it):
// taking part = in the pool, played at least a day, not disqualified, not a bot; the
// top 10, 3, 2 and 1 by the final table, stacking; one line per item or token grant
export function rewardsPreview(comp) {
  const out = [];
  if (!comp || !comp.res || !Array.isArray(comp.res.table)) return out;
  const rw = (comp.cfg && comp.cfg.rw) || {};
  // a disqualified or banned wallet gets nothing (lib/comp.mjs rewardsOf)
  const dq = new Set((comp.entries || []).filter((e) => e.st === 'dq' || e.banned).map((e) => e.w));
  const give = (id, step) => {
    const s = rw[step];
    if (!s) return;
    if (s.item) out.push({ id, item: s.item });
    if (s.tok > 0) out.push({ id, tok: s.tok });
  };
  for (const row of comp.res.table) {
    if (BOT_RE.test(row.id) || dq.has(row.id) || row.w + row.l < 1) continue;
    give(row.id, 'all');
    if (row.place <= 10) give(row.id, 't10');
    if (row.place <= 3) give(row.id, 'p3');
    if (row.place <= 2) give(row.id, 'p2');
    if (row.place === 1) give(row.id, 'p1');
  }
  return out;
}
// a squad's strength in the page: 48 seeded fights against the league's bot squads,
// both sides; the tier cuts are the hall's (58 strong, 45 medium)
// one of a rating's 48 fights: the squad against a league bot squad, on both sides by turns
export function rateFight(squad, i, rules, E) {
  const foe = E.leagueBotSquad('rate' + (rules && rules.seed ? rules.seed : ''), 'bot:' + (i + 1));
  const r = i % 2 ? E.simulateRound(foe, squad, 1000 + i, 0, true) : E.simulateRound(squad, foe, 1000 + i, 0, true);
  return r.winner === (i % 2 ? 1 : 0);
}
export function rateDeck(sq, rules, E) {
  const squad = E.cleanSquad(sq);
  if (!squad) return null;
  let wins = 0;
  for (let i = 0; i < 48; i++) if (rateFight(squad, i, rules, E)) wins++;
  const pct = Math.round((100 * wins) / 48);
  return { pct, tier: pct >= 58 ? 'A' : pct >= 45 ? 'B' : 'C' };
}


/* ---- a competition's config: read, checked, compared and told (pure, for tests too) ---- */
// Squad rules (`lim`, `objMax`) are not played yet: the daily run has no fitRules until
// task #30, so both backends refuse to open or lock a competition that has them (lib/scripts.mjs
// ADMIN_COMP, admin-local.js act). Setup shows the grid greyed out, with a way to clear it.
const SQUAD_RULES_SAY = 'Squad rules (bans, caps, the trench-kit limit) are not played yet: the daily run plays every squad as it is. A competition with squad rules cannot open or lock: clear them first.';
const squadRulesIn = (r) => !!r && ((!!r.lim && Object.values(r.lim).some((m) => m && Object.keys(m).length > 0)) || (Number.isInteger(r.objMax) && r.objMax < C.E.OBJECTS_MAX));
// the parts of a squad a competition can limit (plan §4 `lim`), with the engine's own lists
export const RULE_PARTS = [['cls', 'Classes', 'PLAYSTYLES'], ['wpn', 'Weapons', 'WEAPONS'], ['gear', 'Gear', 'GEAR'], ['pow', 'Powers', 'POWERS'], ['tac', 'Tactics', 'TACTICS'], ['stn', 'Stances', 'STANCES'], ['obj', 'Trench kit', 'OBJECTS'], ['cmd', 'Captain’s command', 'COMMANDS']];
// a squad needs one of each of these: banning every id of one leaves no squad that can play
const NEEDED = ['cls', 'wpn', 'gear', 'pow', 'tac', 'stn'];
const RW_STEPS = [['all', 'Taking part', true], ['t10', 'Top 10', true], ['p3', '3rd place', false], ['p2', '2nd place', false], ['p1', 'Winner', true]];
const TIME_KEYS = ['opens', 'closes', 'lock', 'start'];
// the fields frozen at open and at lock (lib/scripts.mjs COMP_LOCKED; times.* = every time)
const FROZEN = { open: ['entryBps', 'prizeBps', 'size', 'order', 'times.opens'], lock: ['rules', 'rw', 'terms', 'times', 'minAge', 'autoLock', 'week'] };
const PHASE = { draft: 0, open: 1, closed: 1, locked: 2, live: 2, paused: 2, done: 2, settled: 2, rewarded: 2, void: 2 };
// a refund a competition owes, as the server's ADMIN_PAY takes it and its archive waits for
// it (ADMIN_COMP refunds_due): a paid entry of a void competition (not one withdrawn: its
// player gave the burn up), or one declined, or left out at the lock (waiting, lapsed, never
// decided on) of a locked or later one
export const refundDue = (c, e) => !!(e && e.b && e.b.sig && e.b.ok !== false) && (c.st === 'void' ? e.st !== 'out' : e.st === 'no' || ((PHASE[c.st] || 0) >= 2 && ['wait', 'lapsed', 'req'].includes(e.st)));
// the entries still owed one: due, and no refund recorded (verified or not)
export const refundsOwed = (c) => (c.entries || []).filter((e) => refundDue(c, e) && !((c.pay && c.pay.refunds) || {})[e.w]);
// whether the prize is burned: what was recorded, else as ADMIN_PAY decides it at pay time
// (not as the final table wrote it): a bot first, or the winner disqualified or banned now
export function prizeBurnt(c, bans = new Set()) {
  const pay = (c && c.pay) || {};
  if (pay.burn) return true;
  if (pay.payout) return false;
  const w = c && c.res && c.res.winner;
  if (!w) return !!(c && c.res && c.res.burn);
  if (BOT_RE.test(w)) return true;
  const e = ((c && c.entries) || []).find((x) => x.w === w);
  return !!(e && (e.st === 'dq' || e.banned)) || bans.has(w);
}
// what the Now tab's to-do calls a prize not recorded yet, by the same rule from what the
// overview has (a competition's summary: winner, burn as last written, counts; the bans):
// a bot first or a winner banned now is a burn; a summary that says payout is one (the
// winner was neither disqualified nor banned when it was written, and is not banned now);
// a summary that says burn while the winner is not banned now is a payout when nobody is
// disqualified (a ban lifted since), else it could be either, and Results tells (null)
export function prizeTodo(sum, bans = new Set()) {
  const w = sum && sum.winner;
  if (!w) return null;
  if (BOT_RE.test(w) || bans.has(w)) return 'burn';
  if (!sum.burn) return 'payout';
  return sum.counts && sum.counts.dq === 0 ? 'payout' : null;
}
// a final table without a winner: nobody played, so no prize is due (archive it)
export const nobodyWon = (c) => !!(c && c.st === 'done' && c.res && !c.res.winner);
// a face for a side of Simulate: by the deck's id (a string on the server, a number in the
// sandbox), else the side's; always a bot id the hall draws (BOT_RE: at most 6 digits)
export const simBotId = (d, i) => {
  const n = d && /^[1-9][0-9]{0,5}$/.test(String(d.id)) ? Number(d.id) : i + 1;
  return 'bot:' + (900000 + (n % 100000));
};
// since when a field cannot change any more in a state: 'open', 'lock' or null
export function frozenSince(field, st) {
  const ph = PHASE[st] || 0;
  const hit = (list) => list.some((f) => field === f || field.startsWith(f + '.'));
  if (ph >= 2 && hit(FROZEN.lock)) return 'lock';
  if (ph >= 1 && hit(FROZEN.open)) return 'open';
  return null;
}
const ids = (E, list) => E[list].map((x) => x[0]);
const nameIn = (E, list, id) => (E[list].find((x) => x[0] === id) || [id, id])[1];
// how many of an id a squad can carry anyway: a cap at or above it changes nothing
export function partCap(part, id, E) {
  if (part === 'pow') return E.RULES.powMax[id] || E.TEAM;
  if (part === 'wpn') return E.WEAPON_STATS[id] && E.WEAPON_STATS[id].one ? 1 : E.TEAM;
  if (part === 'obj' || part === 'cmd') return 1; // one of each object, one command
  return E.TEAM;
}
const intOr = (v, d) => (Number.isInteger(v) ? v : d);
const seedOr = (v) => (Number.isInteger(v) && v >= 0 && v <= INT31 ? v : null);
// the rules with every part and switch spelled out (empty = the normal game)
export function normRules(raw, E) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const lim = {};
  for (const [part, , list] of RULE_PARTS) {
    const src = r.lim && r.lim[part] && typeof r.lim[part] === 'object' ? r.lim[part] : {};
    const m = {};
    for (const id of ids(E, list)) if (Number.isInteger(src[id]) && src[id] >= 0 && src[id] < partCap(part, id, E)) m[id] = src[id];
    lim[part] = m;
  }
  const a = arenaIn(r.arena);
  return {
    lim,
    objMax: Number.isInteger(r.objMax) && r.objMax >= 0 && r.objMax < E.OBJECTS_MAX ? r.objMax : E.OBJECTS_MAX,
    // the engine's rule set (RULE_SET, through its cleanRules) and how the matches are seeded
    arena: { play: E.cleanRules(a), seedMode: a.seedMode === 'day' || a.seedMode === 'fixed' ? a.seedMode : 'match', seed: seedOr(a.seed) },
  };
}
/* ---- a competition's arena: the engine's own rule set (RULE_SET, RULE_PRESETS and
   cleanRules of lib/squad.mjs) plus the seeds, stored flat as lib/comp.mjs cleanRules
   keeps it: {...the rules, seedMode?: 'day' | 'fixed', seed?}. The job plays every match
   with it (lib/compday.mjs), and Watch and Simulate here do the same. ---- */
// the first panel's switches, read once more as the server does: ev is the chest's pool,
// weather 'auto' the default; switches no engine has fall out in the engine's cleanRules
function arenaIn(a) {
  const A = a && typeof a === 'object' && !Array.isArray(a) ? { ...a } : {};
  if (A.chestPool === undefined && Array.isArray(A.ev)) A.chestPool = A.ev;
  if (A.weather === 'auto') delete A.weather;
  return A;
}
// the engine's rules of a stored or drafted arena
export const playOf = (a, E) => E.cleanRules(a && a.play ? a.play : arenaIn(a));
// a rule's value as it plays: the set one, else the default
export const ruleVal = (play, r) => (play && Object.hasOwn(play, r.id) ? play[r.id] : r.def);
// the preset a rule set plays as (every rule the same, defaults filled in), else null
export function presetOf(play, E) {
  const f = (rs) => E.RULE_SET.map((r) => JSON.stringify(ruleVal(rs, r))).join('|');
  const key = f(E.cleanRules(play));
  const p = E.RULE_PRESETS.find((x) => f(x.rules) === key);
  return p ? p.id : null;
}
// the field a stored arena is refused on (lib/comp.mjs cleanRules says the same), else null
export function arenaBad(a, E) {
  if (a === undefined || a === null) return null;
  if (typeof a !== 'object' || Array.isArray(a)) return 'rules.arena';
  const A = arenaIn(a);
  for (const r of E.RULE_SET) if (A[r.id] !== undefined && A[r.id] !== null && !Object.hasOwn(E.cleanRules({ [r.id]: A[r.id] }), r.id)) return 'rules.arena.' + r.id;
  if (A.seedMode !== undefined && A.seedMode !== null && !['match', 'day', 'fixed'].includes(A.seedMode)) return 'rules.arena.seedMode';
  if (A.seedMode === 'fixed' && !(Number.isInteger(A.seed) && A.seed >= 0 && A.seed <= INT31)) return 'rules.arena.seed';
  return null;
}
// an arena as it is sent and stored
export function arenaOut(a, E) {
  const A = a && a.play ? a : { play: E.cleanRules(arenaIn(a)), ...arenaIn(a) };
  const out = E.cleanRules(A.play);
  if (A.seedMode === 'day' || A.seedMode === 'fixed') out.seedMode = A.seedMode;
  if (A.seedMode === 'fixed' && Number.isInteger(A.seed)) out.seed = A.seed;
  return out;
}
// the arena in a few chips (lib/comp.mjs chipsOf): a preset by its name, else each change
export function arenaChips(a, E) {
  const play = playOf(a, E);
  const A = a && a.play ? a : arenaIn(a);
  const out = [];
  const pre = presetOf(play, E);
  if (pre && pre !== 'classic') out.push(E.RULE_PRESETS.find((p) => p.id === pre).name);
  else if (!pre) for (const c of E.ruleChanges(play)) out.push(c.value === 'off' ? 'No ' + c.name.replace(/^The /, '').toLowerCase() : c.value === 'on' ? c.name : c.name + ': ' + c.value);
  if (A.seedMode === 'fixed') out.push('One arena all week');
  if (A.seedMode === 'day') out.push('One arena a day');
  return out;
}
// the rules as they are sent and stored: only the parts that limit something
export function rulesOut(r, E) {
  const lim = {};
  for (const [part] of RULE_PARTS) if (r.lim[part] && Object.keys(r.lim[part]).length) lim[part] = { ...r.lim[part] };
  const arena = arenaOut(r.arena, E);
  return { ...(Object.keys(lim).length ? { lim } : {}), ...(r.objMax < E.OBJECTS_MAX ? { objMax: r.objMax } : {}), ...(Object.keys(arena).length ? { arena } : {}) };
}
export function normCfg(cfg, E) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  const t = c.times && typeof c.times === 'object' ? c.times : {};
  const rw = c.rw && typeof c.rw === 'object' ? c.rw : {};
  return {
    name: String(c.name || ''), text: String(c.text || ''), week: String(c.week || ''),
    times: Object.fromEntries(TIME_KEYS.map((k) => [k, typeof t[k] === 'string' ? t[k] : ''])),
    size: intOr(c.size, 35), minAge: intOr(c.minAge, 1), order: c.order === 'ask' ? 'ask' : 'burn',
    entryBps: intOr(c.entryBps, 0), prizeBps: intOr(c.prizeBps, 0), autoLock: c.autoLock !== false,
    rules: normRules(c.rules, E),
    rw: Object.fromEntries(RW_STEPS.map(([k, , tok]) => {
      const v = rw[k] && typeof rw[k] === 'object' ? rw[k] : {};
      return [k, tok ? { item: typeof v.item === 'string' ? v.item : '', tok: intOr(v.tok, 0) } : { item: typeof v.item === 'string' ? v.item : '' }];
    })),
    terms: String(c.terms || ''), e: c.e,
  };
}
const CFG_KEYS = ['name', 'text', 'week', 'times', 'size', 'minAge', 'order', 'entryBps', 'prizeBps', 'autoLock', 'rules', 'rw', 'terms'];
// what an edit sends: the fields that differ from what was read, in the stored shape
export function cfgChanges(draft, base, E) {
  const out = {};
  for (const k of CFG_KEYS) {
    if (JSON.stringify(draft[k]) === JSON.stringify(base[k])) continue;
    if (k === 'rules') out.rules = rulesOut(draft.rules, E);
    else if (k === 'rw') out.rw = Object.fromEntries(Object.entries(draft.rw).map(([s, v]) => [s, { ...v, item: v.item || null }]));
    else out[k] = JSON.parse(JSON.stringify(draft[k]));
  }
  return out;
}
// the Monday a week id starts on (ms, UTC), or null
export function mondayOf(week, E) {
  const m = WEEK_ID.exec(String(week || ''));
  if (!m) return null;
  const ms = E.leagueWeekStart(Date.UTC(+m[0].slice(0, 4), 0, 4)) + (Number(week.slice(5)) - 1) * 7 * DAY;
  return E.leagueWeek(ms) === week ? ms : null;
}
// the default timetable of a week (UTC): Wed 12:00 -> Sun 20:00 -> Mon 00:05 lock -> Mon 00:00 start
export function weekTimes(week, E) {
  const mon = mondayOf(week, E);
  if (mon === null) return null;
  const iso = (ms) => new Date(ms).toISOString();
  return { opens: iso(mon - 5 * DAY + 12 * 3600000), closes: iso(mon - 4 * 3600000), lock: iso(mon + 5 * 60000), start: iso(mon) };
}
// what is wrong with a config, field by field ({} when it can be saved). The limits are
// the ones both backends take (lib/comp.mjs cleanCfg and the sandbox's).
export function cfgProblems(cfg, E) {
  const P = {};
  const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  if (!cfg.name.trim()) P.name = 'Give it a name.';
  else if (cfg.name.length > 40) P.name = 'At most 40 characters.';
  if (cfg.text.length > 600) P.text = 'At most 600 characters.';
  if (!WEEK_ID.test(cfg.week) || mondayOf(cfg.week, E) === null) P.week = 'A week like ' + E.leagueWeek(Date.now()) + '.';
  const t = TIME_KEYS.map((k) => Date.parse(cfg.times[k]));
  TIME_KEYS.forEach((k, i) => { if (!(t[i] > 0)) P['times.' + k] = 'Pick a date and time.'; });
  if (t.every((x) => x > 0)) {
    const [o, c, l, s] = t;
    if (!(o < c)) P['times.closes'] = 'Sign-ups close after they open.';
    else if (!(c <= l)) P['times.lock'] = 'The lock comes after sign-ups close.';
    else if (!(c <= s)) P['times.start'] = 'Day 0 starts after sign-ups close.';
    else if (!(l <= s + DAY)) P['times.lock'] = 'The lock is at most a day after day 0 starts.';
  }
  if (!int(cfg.size, 6, 64)) P.size = 'From 6 to 64 places.';
  if (!int(cfg.minAge, 0, 30)) P.minAge = 'From 0 to 30 days.';
  if (!int(cfg.entryBps, 0, 10000)) P.entryBps = 'Basis points from 0 to 10000 (10 = 0.1%).';
  if (!int(cfg.prizeBps, 0, 10000)) P.prizeBps = 'Basis points from 0 to 10000 (100 = 1%).';
  const R = cfg.rules;
  for (const [part, label, list] of RULE_PARTS) {
    const m = R.lim[part];
    for (const [id, n] of Object.entries(m)) if (!int(n, 0, partCap(part, id, E))) P['rules.lim.' + part] = label + ': a cap is a whole number.';
    if (NEEDED.includes(part) && ids(E, list).every((id) => m[id] === 0)) P['rules.lim.' + part] = 'Every one of the ' + label.toLowerCase() + ' is banned: no squad could play.';
  }
  if (!int(R.objMax, 0, E.OBJECTS_MAX)) P['rules.objMax'] = 'From 0 to ' + E.OBJECTS_MAX + '.';
  const A = R.arena;
  const on = (id) => ruleVal(A.play, E.RULE_SET.find((r) => r.id === id));
  if (on('chest') && !on('chestPool').length) P['rules.arena.chestPool'] = 'Pick at least one event, or switch the chest off.';
  if (on('golds') && !on('goldPool').length) P['rules.arena.goldPool'] = 'Pick at least one golden drop, or switch the golden drops off.';
  if (A.seedMode === 'fixed' && !int(A.seed, 0, INT31)) P['rules.arena.seed'] = 'A fixed arena needs its seed: a whole number from 0 to ' + INT31 + '.';
  for (const [k, label, tok] of RW_STEPS) {
    const v = cfg.rw[k];
    if (v.item && !ITEM_RE.test(v.item)) P['rw.' + k] = label + ': an item id like hat:ghost or a pin.';
    else if (tok && !int(v.tok, 0, 9)) P['rw.' + k] = label + ': from 0 to 9 unlock tokens.';
  }
  if (cfg.terms.length > 2000) P.terms = 'At most 2000 characters.';
  return P;
}

/* ---- money: raw amounts are decimal strings, BigInt only ---- */
export const shareOf = (supply, bps) => ((BigInt(supply) * BigInt(bps)) / 10000n).toString();
export function uiAmount(raw, dec) {
  const s = String(raw).padStart(dec + 1, '0');
  const whole = s.slice(0, s.length - dec).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const frac = s.slice(s.length - dec).replace(/0+$/, '').slice(0, 2);
  return whole + (frac ? '.' + frac : '');
}
// a raw amount rounded down to two significant whole digits, for posts and announcements
export function roundDown(raw, dec) {
  const whole = BigInt(raw) / 10n ** BigInt(dec);
  const s = whole.toString();
  if (s.length <= 2) return (whole * 10n ** BigInt(dec)).toString();
  const keep = BigInt(s.slice(0, 2)) * 10n ** BigInt(s.length - 2);
  return (keep * 10n ** BigInt(dec)).toString();
}
const pctOf = (bps) => (bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';

/* ---- the player's rules sheet (the panel's preview until SquadHall.compSheet exists) ---- */
// how many rounds a pool of n plays (every pair once) and how many a day over 7 days
const roundsOf = (n) => (n % 2 ? n : n - 1);
const perDay = (n) => Math.ceil(roundsOf(n) / 7);
const PIN_NAMES = { p1: 'gold pin', p2: 'silver pin', p3: 'bronze pin', t10: 'top-10 pin', all: 'taking-part pin' };
const itemText = (item, n) => (PIN_RE.test(item) || PIN_PH.test(item) ? 'the ' + (n ? '#' + n + ' ' : '') + PIN_NAMES[item.split('.')[1]] : item);
// 'Wed 21 Oct 12:00' (UTC)
const day = (iso) => { const d = new Date(iso); return Date.parse(iso) > 0 ? DAY_NAMES[(d.getUTCDay() + 6) % 7] + ' ' + d.getUTCDate() + ' ' + d.toUTCString().slice(8, 11) + ' ' + d.toISOString().slice(11, 16) : '?'; };
// {sections: [{id, h, rows: [[{t, ban?, cap?}]]}]}: each row a list of bits of text; a
// ban is struck through, a cap carries ×n. Built from the catalog names only.
export function rulesSheet(cfg, E, o = {}) {
  const c = cfg.rules ? cfg : normCfg(cfg, E);
  const R = c.rules && c.rules.lim && c.rules.arena ? c.rules : normRules(c.rules, E);
  const S = [];
  const add = (id, h, rows) => S.push({ id, h, rows: rows.filter(Boolean).map((r) => (Array.isArray(r) ? r : [{ t: r }])) });
  add('format', 'Format', [
    c.size + ' places, every one against every other once: ' + roundsOf(c.size) + ' rounds, ' + perDay(c.size) + ' a day from Monday to Sunday.',
    '3 points for a win, 1 for a loss. Bots fill the places nobody took, and play like everyone else.',
    'Sign-ups ' + day(c.times.opens) + ' to ' + day(c.times.closes) + ' UTC; the places are drawn at ' + day(c.times.lock) + '.',
    'Plays week ' + (c.week ? Number(c.week.slice(5)) : '?') + ' on engine ' + (c.e || E.SQUAD_ENGINE) + ', with the strategy you pick for it.',
  ]);
  const squad = [];
  for (const [part, label, list] of RULE_PARTS) {
    const m = R.lim[part];
    const all = ids(E, list);
    const banned = all.filter((id) => m[id] === 0);
    const capped = all.filter((id) => m[id] > 0);
    if (!banned.length && !capped.length) continue;
    const allowed = all.filter((id) => m[id] !== 0);
    const bits = [{ t: label + ': ' }];
    if (banned.length > allowed.length) {
      bits.push({ t: 'only ' });
      allowed.forEach((id, i) => bits.push({ t: nameIn(E, list, id) + (m[id] > 0 ? ' ×' + m[id] : '') + (i < allowed.length - 1 ? ', ' : ''), cap: m[id] > 0 }));
    } else {
      banned.forEach((id) => bits.push({ t: nameIn(E, list, id), ban: true }, { t: ' ' }));
      capped.forEach((id) => bits.push({ t: nameIn(E, list, id) + ' ×' + m[id], cap: true }, { t: ' ' }));
    }
    squad.push(bits);
  }
  if (R.objMax < E.OBJECTS_MAX) squad.push(R.objMax ? 'At most ' + R.objMax + ' object' + (R.objMax === 1 ? '' : 's') + ' of the trench kit.' : 'No trench kit.');
  // squad rules are not played yet (SQUAD_RULES_SAY): the sheet says so instead of promising
  // a referee that fits a strategy to them
  if (!squad.length) squad.push('As in the normal game.');
  else squad.push('Not played yet: every strategy plays as it is saved, and a competition with squad rules cannot open until they are.');
  add('squad', 'Squad rules', squad);
  const A = R.arena;
  const arena = [];
  // the engine's rule set: the preset by its name and text, each change in the engine's words
  const pre = presetOf(A.play, E);
  const P = pre ? E.RULE_PRESETS.find((x) => x.id === pre) : null;
  arena.push(P ? (pre === 'classic' ? 'The arena as in the normal game: every surprise in, at its usual odds.' : P.name + ': ' + P.text) : 'Custom rules:');
  if (pre !== 'classic') for (const ch of E.ruleChanges(A.play)) arena.push(ch.name + ': ' + ch.value + '.');
  arena.push(A.seedMode === 'fixed' ? 'The same arena all week (seed ' + (A.seed ?? '?') + '): its map, sky and power-up. Each fight still has a seed of its own, from a salt drawn at the lock (its hashes are published then), so nobody can play a match ahead of its day.' : A.seedMode === 'day' ? 'One arena seed for everyone each day.' : 'A fresh seed every match, from a salt drawn at the lock (its hashes are published then).');
  add('arena', 'Arena', arena);
  const amount = (bps) => {
    if (o.sup && o.sup.supply) return uiAmount(shareOf(o.sup.supply, bps), o.sup.dec) + ' $BLUB';
    if (o.chain && o.chain.supply) return 'about ' + uiAmount(shareOf(o.chain.supply, bps), o.chain.dec) + ' $BLUB today';
    return null;
  };
  const ea = amount(c.entryBps), pa = amount(c.prizeBps);
  add('entry', 'Entry', [
    c.entryBps ? 'Burn ' + (ea ? ea + ' (' : '') + pctOf(c.entryBps) + ' of the supply at opening' + (ea ? ')' : '') + ' from the wallet you sign in with.' : 'Free: no burn.',
    c.entryBps ? (c.order === 'ask' ? 'Ask first; burn once you are approved.' : 'Burn first, then the team reviews your entry. A declined paid entry is refunded by hand.') : 'Ask to enter; the team reviews every entry.',
    'Your team must be saved at least ' + c.minAge + ' day' + (c.minAge === 1 ? '' : 's') + ' before. One entry a wallet. Moderators cannot enter.',
  ]);
  add('prize', 'Prize', [c.prizeBps ? 'The winner takes ' + (pa ? pa + ' (' : '') + pctOf(c.prizeBps) + ' of the supply at opening' + (pa ? ')' : '') + '. If a bot wins, the prize is burned.' : 'No $BLUB prize: cosmetic rewards only.']);
  const rw = [];
  for (const [k, label] of RW_STEPS) {
    const v = c.rw[k] || {};
    const bits = [v.item ? itemText(v.item, o.n) : null, v.tok > 0 ? v.tok + ' unlock token' + (v.tok === 1 ? '' : 's') + ' (in-game)' : null].filter(Boolean);
    if (bits.length) rw.push(label + ': ' + bits.join(' and ') + '.');
  }
  rw.push(rw.length ? 'The steps stack. Taking part means in the pool, played a day, not disqualified. Bots get nothing. Rewards are cosmetic.' : 'No rewards.');
  add('rewards', 'Rewards', rw);
  add('ties', 'Tie-breaks', ['Points, then head-to-head among the tied, then the margin, then a salted coin.']);
  add('terms', 'Terms', c.terms.trim() ? c.terms.trim().split(/\n+/) : ['No terms written yet.']);
  return { title: c.name || 'Competition', sections: S };
}
// what a squad breaks under a competition's rules: [{part, id, n, max}] (the page's stand-in
// for compProblems until task #30 brings it to lib/squad.mjs)
export function squadProblems(sq, rules, E) {
  const R = rules && rules.lim && rules.arena ? rules : normRules(rules, E);
  const out = [];
  if (!sq || !Array.isArray(sq.units)) return out;
  const count = (part) => {
    const n = {};
    if (part === 'obj') for (const ob of sq.objs || []) n[ob.k] = (n[ob.k] || 0) + 1;
    else if (part === 'cmd') { if (sq.cmd) n[sq.cmd] = 1; }
    else for (const u of sq.units) { const id = part === 'stn' ? u.stn || 'attack' : u[part]; n[id] = (n[id] || 0) + 1; }
    return n;
  };
  for (const [part] of RULE_PARTS) {
    const n = count(part);
    for (const [id, max] of Object.entries(R.lim[part])) if ((n[id] || 0) > max) out.push({ part, id, n: n[id], max });
  }
  if ((sq.objs || []).length > R.objMax) out.push({ part: 'obj', id: '*', n: sq.objs.length, max: R.objMax });
  return out;
}

let C = null; // the page's helpers: API, E (the engine), View, Hall, lookCanvas, cleanLook, cleanName, memberOf, mates, me, docs, ls, lock
let A = null; // the adapter
let root = null;
const R = {};
const st = {
  ov: null, loaded: 0, busy: false, player: null, q: '', pick: [null, null], bo: 1, tab: 'now',
  // the competition open in the stepper: its code, step, record, and the setup being edited
  comp: null, step: null, compFull: null, base: null, draft: null, only: {},
  day: 0, dayRec: null, chain: undefined, decks: null, simN: 0,
  // Entries: the filter, the selection, the focused card, the open small form, the wallets'
  // screens read for History, and the burns checked again (by signature)
  ef: 'all', esel: new Set(), efocus: null, eform: null, pcache: new Map(), verdicts: {},
  // F4: the bots' mix, the played days read (code:day), payment checks, the deck editor
  mix: { A: 30, B: 40, C: 30 }, xMax: 20, dayCache: new Map(), payV: {}, edit: null, variants: null, rating: false,
  // F5: the Wallets filter (search or bans), the bulk form, the log's filters and the whole log once read
  wf: 'find', bulk: { text: '', kind: 'give', item: '', n: 1, why: '' },
  lf: { kind: '', comp: '', by: '', wallet: '' }, logAll: null, logFull: false, logNo: false, logBusy: false,
};
// the panel's corner of the page's own browser storage (lsGet/lsPatch): the tab, the step
const lsRead = () => { try { return (C && C.ls && C.ls.get()) || {}; } catch { return {}; } };
const lsWrite = (p) => { try { if (C && C.ls) C.ls.patch(p); } catch { /* no storage here */ } };

export function open(el, ctx) {
  C = ctx;
  if (!ctx.adapter) { el.textContent = 'The admin panel has no backend.'; return; }
  // every call through one door: refusals in a toast, a 401 to the page, stale re-applied once
  A = guardAdapter(ctx.adapter, {
    say: (e) => toast(errSay(e), false),
    // a read refused in the busy minute after a change: the change stands; read again later
    behind: (e) => catchUp(e),
    signedOut: typeof C.apiFail === 'function' ? C.apiFail : null,
    reapplied: () => { st.reapplied = Date.now(); },
  });
  if (root !== el || !R.grid || !el.contains(R.grid) || R.mode !== A.mode) {
    // another backend (the sandbox, then a moderator's wallet): nothing of the other one stays
    if (R.mode && R.mode !== A.mode) Object.assign(st, { ov: null, player: null, q: '', pick: [null, null], comp: null, step: null, compFull: null, base: null, draft: null, only: {}, day: 0, dayRec: null, chain: undefined, decks: null, ef: 'all', esel: new Set(), efocus: null, eform: null, pcache: new Map(), verdicts: {}, dayCache: new Map(), payV: {}, edit: null, variants: null });
    const d = lsRead();
    const tab = OLD_TABS[d.admTab] || d.admTab;
    if (TABS.some((t) => t[0] === tab)) st.tab = tab;
    if (!st.comp && d.admComp && typeof d.admComp.code === 'string') {
      st.comp = d.admComp.code;
      st.step = STEPS.some((s) => s[0] === d.admComp.step) ? d.admComp.step : null;
    }
    root = el;
    R.mode = A.mode;
    build();
  }
  refresh();
}

/* ---- little helpers ---- */
function h(tag, a, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(a || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e[k] = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : String(k));
  return e;
}
// the DOM's own append prints a null child as "null": append the children h() would keep
function addKids(el, ...kids) {
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : String(k));
  return el;
}
const short = (id) => (BOT_RE.test(id) ? id : String(id).slice(0, 4) + '…' + String(id).slice(-4));
function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (!(s >= 0)) return '';
  return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : Math.floor(s / 86400) + ' d ago';
}
function until(iso) {
  const s = (Date.parse(iso) - Date.now()) / 1000;
  if (!(s > 0)) return 'now';
  return s < 3600 ? 'in ' + Math.ceil(s / 60) + ' min' : s < 86400 ? 'in ' + Math.floor(s / 3600) + ' h' : 'in ' + Math.floor(s / 86400) + ' d ' + Math.floor((s % 86400) / 3600) + ' h';
}
function face(look, style, big) {
  const c = C.lookCanvas(C.cleanLook(look), { style });
  c.classList.add('adm-face');
  if (big) c.classList.add('big');
  c.setAttribute('aria-hidden', 'true');
  return c;
}
// what the panel knows of an id: a bot from its number, a wallet from the Meadow list (or the sandbox's)
function who(id) {
  // a competition's bots (bot:9xxxxx, by place) take the face of their place's number, so
  // the names stay short (Tinker, not Tinker 45001)
  if (BOT_RE.test(id)) { const n = Number(id.slice(4)); return C.Hall.botFace(n > 900000 ? 'bot:' + (n - 900000) : id); }
  const d = C.docs().get(id) || (st.ov && st.ov.who && st.ov.who[id]);
  const sb = st.ov && st.ov.who && st.ov.who[id];
  return d ? { name: d.name, player: d.player || '', look: d.look, style: d.style, created: d.created || (sb && sb.created) || '' } : null;
}
const nameOf = (id, w = who(id)) => (w ? (w.bot ? w.name : w.player || w.name) : short(id));
// the focus back where a small form was opened from, else on a heading near it
function back(el, alt) {
  let t = el && el.isConnected && !el.disabled ? el : null;
  if (!t && alt) {
    t = typeof alt === 'string' ? document.querySelector(alt) : alt;
    if (t && !t.hasAttribute('tabindex') && !/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) t.setAttribute('tabindex', '-1');
  }
  if (t && t.isConnected) t.focus({ preventScroll: false });
}
// Escape closes the small form a key went to
const escTo = (close) => (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
// smooth scrolling unless the system asks for less motion
const smooth = () => (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
function say(el, text, ok) {
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('ok', ok === true);
  el.classList.toggle('bad', ok === false);
}
function card(title, id, cls, ...kids) {
  return h('article', { class: 'sq-panel adm-card ' + (cls || ''), 'aria-labelledby': id }, h('h3', { id }, title), ...kids);
}
function btn(label, cls, fn, a) {
  return h('button', { type: 'button', class: 'btn small ' + (cls || ''), onclick: fn, ...(a || {}) }, label);
}
// a button that asks once more before it does something that cannot be taken back
function sureBtn(label, cls, fn, ask) {
  const b = btn(label, cls, null);
  let armed = 0;
  const reset = () => {
    clearTimeout(armed);
    armed = 0;
    b.textContent = label;
    b.classList.remove('adm-armed');
  };
  b.onclick = () => {
    if (!armed) {
      armed = setTimeout(reset, 4000);
      b.textContent = ask || 'Sure? Click again';
      b.classList.add('adm-armed');
      return;
    }
    reset();
    fn();
  };
  // Escape takes the question back
  b.onkeydown = (e) => { if (armed && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); reset(); } };
  return b;
}
function copyBtn(text, label) {
  const b = h('button', { type: 'button', class: 'lg-copy', title: label || 'Copy wallet address', 'aria-label': label || 'Copy wallet address' });
  b.onclick = () => {
    try {
      navigator.clipboard.writeText(text).then(() => {
        b.classList.add('ok');
        setTimeout(() => b.classList.remove('ok'), 1400);
      }, () => {});
    } catch { /* no clipboard here */ }
  };
  return b;
}
const pill = (text, cls) => h('span', { class: 'adm-pill ' + (cls || '') }, text);
const stPill = (s) => pill(s, 'adm-st-' + s);
// a read refused right after a change that went through (the moderator's minute was busy):
// the screen keeps what the change answered and reads the overview again once the minute
// allows (Retry-After, else a few seconds); never told as a failure
const BEHIND_SAY = 'Done. The screen catches up in a few seconds.';
function catchUp(e) {
  if (st.catchT) return;
  const wait = Math.min(60, Math.max(3, Number(e && e.retry) || 5)) * 1000;
  st.catchT = setTimeout(() => { st.catchT = 0; if (st.busy) catchUp(e); else refresh(); }, wait);
}
// runs a change, says how it went, and reads the overview (and the open player) again
async function act(el, fn, done) {
  if (st.busy) return;
  st.busy = true;
  say(el, 'Working…');
  try {
    const r = await fn();
    say(el, typeof done === 'function' ? done(r) : done, true);
    // the change's own answer first: the leagues pane follows it even if the read after it waits
    if (r && typeof r.paused === 'boolean' && st.ov) { st.ov.paused = r.paused; renderLeague(); renderTodo(); }
    await refresh();
    if (st.player && !BOT_RE.test(st.player.id)) await loadPlayer(st.player.id, true);
  } catch (e) {
    say(el, (e && e.message) || 'That did not work.', false);
  } finally {
    st.busy = false;
  }
}

// a write that met another moderator's change went through on the second try: say so
const reapplied = (text) => (st.reapplied && Date.now() - st.reapplied < 5000 ? text + ' (Another moderator changed it meanwhile: it was read again and yours applied on top.)' : text);
// a short note at the bottom of the screen for a small change that went through
function toast(text, ok) {
  if (!R.toast) return;
  R.toast.textContent = ok === true ? reapplied(text) : text;
  st.reapplied = 0;
  R.toast.className = 'adm-toast show' + (ok === false ? ' bad' : '') + (R.toastLift ? ' lift' : '');
  clearTimeout(R.toastT);
  R.toastT = setTimeout(() => R.toast.classList.remove('show'), 4200);
}
// the mode line: where the panel's data lives
function modeLine() {
  const w = A.who();
  return A.mode === 'server'
    ? h('span', { class: 'adm-mode' }, pill('Server', 'server'), 'Server · ' + short(w.addr || C.me() || ''))
    : h('span', { class: 'adm-mode' }, pill('Sandbox', 'local'), 'Sandbox · local data in this browser, nothing reaches the server');
}

/* ---- the page ---- */
function build() {
  css();
  root.textContent = '';
  R.who = h('p', { class: 'adm-who' });
  R.status = h('p', { class: 'adm-status', 'aria-live': 'polite' });
  root.append(h('div', { class: 'sec-head sq-head' },
    h('div', null, h('span', { class: 'eyebrow' }, A.mode === 'server' ? 'Moderators only' : 'Sandbox'), h('h2', { id: 'adminTitle' }, 'Admin')),
    R.who,
    h('div', { class: 'sq-heada' }, btn('Refresh', '', () => refreshAll(), { title: 'Read the overview again, and what is open: the competition, the deck library, the wallet, the whole log' }), h('a', { class: 'btn small gold', href: '#rankings' }, 'Rankings'))));
  root.append(R.status);
  // the tabs
  R.tabs = h('div', { class: 'adm-tabs', role: 'tablist', 'aria-label': 'Admin panel' });
  R.tabBtn = {};
  for (const [id, label] of TABS) {
    const b = h('button', { type: 'button', class: 'adm-tab', role: 'tab', id: 'admTab-' + id, 'aria-selected': String(id === st.tab), 'aria-controls': 'admPane-' + id, tabindex: id === st.tab ? '0' : '-1', onclick: () => showTab(id) }, label);
    b.onkeydown = (e) => {
      const i = TABS.findIndex((t) => t[0] === id);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const n = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length][0]; showTab(n); R.tabBtn[n].focus(); }
    };
    R.tabBtn[id] = b;
    R.tabs.append(b);
  }
  root.append(R.tabs);

  // Now: the to-dos, the competition of the moment, the week at a glance
  R.todo = h('ol', { class: 'adm-todo' });
  R.nowComp = h('div', { class: 'adm-strip' });
  R.ovBody = h('div', { class: 'adm-tiles' });
  R.nowPane = pane('now', '', card('To do', 'admTodo', 'wide', R.todo), card('Competition', 'admNowComp', 'wide', R.nowComp), card('This week', 'admOv', 'wide', R.ovBody));

  // Competitions: the list (folds away above the stepper on a phone) and one competition
  R.compList = h('ol', { class: 'adm-clist-ol' });
  R.compMsg = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
  R.dupBtn = btn('Duplicate as next week', '', () => {
    if (!st.comp || !st.compFull) return say(R.compMsg, 'Pick a competition to copy first.', false);
    const from = st.compFull;
    act(R.compMsg, () => A.comps.create({ do: 'duplicate', from: from.code }), (r) => { openComp(r.code, 'setup'); return 'Draft #' + r.comp.n + ' made from #' + from.n + ', set for next week.'; });
  });
  R.clistSum = h('summary', { class: 'adm-clist-sum' }, 'Competitions');
  R.clist = h('details', { class: 'adm-clist sq-panel', open: true }, R.clistSum,
    h('div', { class: 'adm-row' }, btn('New draft', 'gold', () => act(R.compMsg, () => A.comps.create({ do: 'draft' }), (r) => { openComp(r.code, 'setup'); return 'Draft #' + r.comp.n + ' made.'; })), R.dupBtn),
    R.compMsg, R.compList);
  R.cdetail = h('article', { class: 'sq-panel adm-card adm-cdetail', 'aria-labelledby': 'admCompTitle' });
  R.compsPane = pane('comps', 'adm-cgrid', R.clist, R.cdetail);

  // Wallets: find one (or the bans, a filter here), its screen, bulk changes
  R.q = h('input', { class: 'sq-pfin', type: 'search', placeholder: 'Wallet address, profile or Blub name', 'aria-label': 'Find a wallet', spellcheck: 'false', autocomplete: 'off' });
  R.q.oninput = () => { st.q = R.q.value; renderFind(); };
  R.wChips = h('div', { class: 'adm-efilters', role: 'group', 'aria-label': 'Show' });
  R.found = h('ol', { class: 'adm-list adm-found' });
  R.pBody = h('div', { class: 'adm-player' });
  R.pMsg = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
  R.players = card('Find a wallet', 'admPl', 'adm-wfind', R.q, R.wChips, R.found);
  R.wCard = card('Wallet', 'admWal', 'adm-wcard', R.pMsg, R.pBody);
  R.bulkBody = h('div', { class: 'adm-bulk' });
  R.bulkDrawn = false;
  R.bulkCard = card('Bulk', 'admBulk', 'wide', R.bulkBody);
  R.walletsPane = pane('wallets', 'adm-wgrid', R.players, R.wCard, R.bulkCard);

  // Bots: the deck library the competitions draw their bots from
  R.decks = h('ol', { class: 'adm-list' });
  R.deckMsg = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
  R.deckSum = h('p', { class: 'adm-state' });
  R.deckImp = h('div', { class: 'adm-deckimp', hidden: true });
  R.deckEd = h('article', { class: 'sq-panel adm-card wide adm-decked', 'aria-labelledby': 'admDeckEdT', hidden: true, onkeydown: escTo(() => closeEditor()) });
  const labIn = h('input', { type: 'file', accept: '.json,application/json', multiple: true, class: 'adm-file', id: 'admLabIn', 'aria-label': 'Lab JSON files' });
  labIn.onchange = () => importLab(labIn);
  R.botsPane = pane('bots', '', card('Deck library', 'admDecks', 'wide',
    h('p', { class: 'sq-desc' }, 'The decks competition bots play: three plans each (A on day 0, the next one after a day it lost more than it won), a tier from a strength rating in this browser (Strong 58+, Medium 45-57, Weak under 45; 0 commands), and their record against players and bots.'),
    R.deckSum,
    h('div', { class: 'adm-row' }, btn('New deck', 'gold', () => editDeck(null)), h('label', { class: 'btn small adm-filebtn', for: 'admLabIn' }, 'Import lab JSON'), labIn),
    R.deckImp, R.deckMsg, R.decks), R.deckEd);

  // Leagues: start and stop, the week's moves and a replay, the league's bots
  R.lgState = h('p', { class: 'adm-state' });
  R.lgBtns = h('div', { class: 'adm-row' });
  R.lgMsg = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
  R.lgGroups = h('div', { class: 'adm-groups' });
  R.league = card('Start and stop', 'admLg', '', R.lgState, R.lgBtns, R.lgMsg, h('h4', null, 'Groups this week'), R.lgGroups);
  R.botD = h('select', { class: 'adm-sel', 'aria-label': 'Rank for the bots' }, ...DIVS.map((n, i) => h('option', { value: String(i + 1) }, n)));
  R.botN = h('input', { class: 'sq-pfin adm-num', type: 'number', min: '1', max: '35', value: '10', 'aria-label': 'How many bots' });
  R.botCount = h('p', { class: 'adm-state' });
  R.botMsg = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
  R.bots = card('Bots', 'admBot', '', R.botCount,
    h('div', { class: 'adm-row' }, R.botN, R.botD, btn('Add bots', 'gold', () => {
      const n = Math.floor(+R.botN.value), d = Number(R.botD.value);
      act(R.botMsg, () => A.bots({ do: 'fill', d, n }), (r) => r.bots + ' bot' + (r.bots === 1 ? '' : 's') + ' joined ' + DIVS[d - 1] + '.');
    })),
    h('div', { class: 'adm-row' },
      sureBtn('Remove all bots', 'pink', () => act(R.botMsg, () => A.bots({ do: 'clear' }), (r) => r.bots + ' bot' + (r.bots === 1 ? '' : 's') + ' left the league.'), 'Remove them all?')),
    R.botMsg,
    h('p', { class: 'sq-desc' }, 'The daily run fills every group up to 35 with bots. Bots you add here take the free places a ban or a removal left in that rank’s groups first. Everyone sees them with a BOT tag; they play every day like the rest and are gone when the week ends.'));
  R.moves = h('div', { class: 'adm-moves' });
  R.simPick = h('div', { class: 'adm-pick' });
  R.simMsg = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
  R.sim = card('Simulate', 'admSim', '', h('h4', null, 'When the week ends'), R.moves, h('h4', null, 'Replay a duel'),
    h('p', { class: 'sq-desc' }, 'Two saved teams with their active strategies, in the arena view. Nothing is stored and nobody’s rating moves.'), R.simPick, R.simMsg);
  R.leaguesPane = pane('leagues', '', R.league, R.sim, R.bots);

  // Log: filters by kind, competition, moderator and wallet; Undo where a change can go back
  R.logF = h('div', { class: 'adm-logf' });
  R.logSrc = h('p', { class: 'adm-state adm-logsrc' });
  R.logList = h('ol', { class: 'adm-log adm-logl' });
  R.logMsg = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
  R.logWB = null;
  R.log = card('Log', 'admLog', 'wide', R.logF, R.logSrc, R.logMsg, R.logList);
  R.logPane = pane('log', '', R.log);

  R.grid = h('div', null, R.nowPane, R.compsPane, R.walletsPane, R.botsPane, R.leaguesPane, R.logPane);
  root.append(R.grid);
  // the footer: where the data lives, and the sandbox's own buttons
  R.footMsg = h('span', { class: 'sq-msg', 'aria-live': 'polite' });
  const acts = h('div', { class: 'adm-row' });
  if (A.mode === 'local') {
    acts.append(
      sureBtn('Reset example data', '', () => {
        try { A.reset(); } catch { /* seeded again on the next open */ }
        Object.assign(st, { player: null, comp: null, step: null, compFull: null, base: null, draft: null, only: {}, decks: null });
        lsWrite({ admComp: null });
        refresh();
        say(R.footMsg, 'The example data is fresh again.', true);
      }, 'Start the sandbox over?'),
      btn('Lock', 'pink', () => { try { A.close(); } catch { /* nothing to flush */ } if (typeof C.lock === 'function') C.lock(); }, { title: 'Back to the 4-digit code' }));
  }
  root.append(h('div', { class: 'adm-foot' }, h('span', { class: 'adm-footl' }, modeLine(),
    h('span', { class: 'adm-fine' }, A.mode === 'server' ? 'Every request is checked again by the server.' : 'The 4-digit code opens this sandbox only: it never gives rights on the server.')), acts, R.footMsg));
  R.toast = h('p', { class: 'adm-toast', role: 'status', 'aria-live': 'polite' });
  root.append(R.toast);
  // Escape closes the fold-out a key went to (Add by hand, a round of matches, the list on a
  // phone) and puts the focus on its summary; the small forms close themselves first
  root.onkeydown = (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const d = e.target && e.target.closest && e.target.closest('details[open]');
    if (!d || !root.contains(d)) return;
    const sum = d.querySelector(':scope > summary');
    e.preventDefault();
    d.open = false;
    if (sum) sum.focus();
  };
  showTab(st.tab);
}
function pane(id, cls, ...cards) {
  return h('div', { class: (cls || 'adm-grid') + ' adm-pane', id: 'admPane-' + id, role: 'tabpanel', 'aria-labelledby': 'admTab-' + id, hidden: id !== st.tab }, ...cards);
}
function showTab(id) {
  st.tab = TABS.some((t) => t[0] === id) ? id : 'now';
  lsWrite({ admTab: st.tab });
  for (const [k] of TABS) {
    R.tabBtn[k].setAttribute('aria-selected', String(k === st.tab));
    R.tabBtn[k].tabIndex = k === st.tab ? 0 : -1;
    const p = document.getElementById('admPane-' + k);
    if (p) p.hidden = k !== st.tab;
  }
  if (st.tab === 'comps' && st.ov && !st.compFull) {
    const list = st.ov.comps || [];
    const code = st.comp && list.some((c) => c.code === st.comp) ? st.comp : list.length ? currentComp(list).code : null;
    if (code) openComp(code, st.comp === code ? st.step : null);
    else renderComp();
  }
  if (st.tab === 'bots') loadDecks();
  if (st.tab === 'log' && st.logFull && !st.logAll && st.ov) loadFullLog(true);
}

// the Refresh button: the overview, then what is open (docs/admin-panel.md): the competition
// on screen, the deck library and the whole log once they were read, the wallet on screen;
// on the server 1 command each, nothing for a part never opened
async function refreshAll() {
  if (!(await refresh())) return;
  const more = [];
  if (st.comp && st.compFull) more.push(reread());
  if (st.decks) more.push(loadDecks(true));
  if (st.player && st.player.id && !BOT_RE.test(st.player.id)) more.push(loadPlayer(st.player.id, true));
  if (st.logFull && st.logAll) more.push(loadFullLog(true).then(() => renderLog()));
  await Promise.all(more);
}
async function refresh() {
  const w = A.who();
  R.who.textContent = '';
  R.who.append(modeLine(), h('span', null, A.mode === 'server' ? ' Signed in as ' + short(w.addr || C.me() || '') + '. Every change here goes into the log.' : ' Example data: three competitions, a league week, wallets, decks and a log. Every change is kept in this browser until you reset it.'));
  say(R.status, st.ov ? '' : A.mode === 'local' ? 'Loading… the example weeks play out in your browser the first time.' : 'Loading…');
  try {
    st.ov = await A.overview();
    st.loaded = Date.now();
    if (st.ov.chain !== undefined) st.chain = st.ov.chain;
    say(R.status, '');
  } catch (e) {
    if (e && e.behind && st.ov) { say(R.status, BEHIND_SAY); return false; }
    say(R.status, e && e.status === 403 ? 'This wallet is not a moderator.' : (e && e.message) || 'The overview did not load.', false);
    return false;
  }
  renderTodo();
  renderNowComp();
  renderOverview();
  renderComps();
  renderLeague();
  renderFind();
  renderPlayer();
  renderSim();
  renderBots();
  if (!R.bulkDrawn) { R.bulkDrawn = true; renderBulk(); }
  renderLog();
  if (st.tab === 'comps' && !st.compFull) showTab('comps');
  if (st.tab === 'bots' && !st.decks) loadDecks();
  return true;
}

/* ---- Now: the to-dos ---- */
// the competition of the moment: the one taking sign-ups, else the one playing, else the newest
function currentComp(list) {
  for (const s of ['open', 'closed', 'locked', 'live', 'paused', 'done', 'settled', 'draft']) {
    const c = list.find((x) => x.st === s);
    if (c) return c;
  }
  return list[0];
}
// where a competition stands in time, in a few words
function whenOf(c) {
  const win = c.win || {};
  if (c.st === 'draft') return win.opens ? 'opens ' + until(win.opens) : 'no times yet';
  if (c.st === 'open') return 'sign-ups close ' + until(win.closes);
  if (c.st === 'closed') return 'locks ' + until(win.lock);
  if (c.st === 'locked') return 'day 0 starts ' + until(win.start);
  if (c.st === 'live' || c.st === 'paused') return 'day ' + Math.min(7, Math.max(1, Math.floor((Date.now() - Date.parse(win.start)) / DAY) + 1)) + ' of 7' + (c.st === 'paused' ? ', paused' : '');
  return 'week ' + (c.week ? Number(String(c.week).slice(5)) : '?');
}
const countsLine = (c) => { const n = c.counts || {}; return (n.req || 0) + ' requests · ' + (n.ok || 0) + ' approved · ' + (n.in || 0) + ' entered / ' + c.size; };
// opens a competition on a step (from a to-do or the strip)
const goComp = (code, step, anchor) => () => { showTab('comps'); openComp(code, step, anchor); };
function renderTodo() {
  const o = st.ov, t = o.todo || {};
  const list = o.comps || [];
  R.todo.textContent = '';
  const byCode = (code) => list.find((x) => x.code === code);
  const num = (code) => { const c = byCode(code); return c ? '#' + c.n : code; };
  const open = list.find((c) => c.st === 'open');
  const review = list.find((c) => (c.st === 'open' || c.st === 'closed') && c.counts && c.counts.req > 0) || open;
  const items = [];
  const add = (text, go, calm) => items.push({ text, go, calm });
  const s = (n, one, more) => n + ' ' + (n === 1 ? one : more);
  if (t.requests && review) add(s(t.requests, 'request', 'requests') + ' to review', goComp(review.code, 'entries'));
  if (open && t.closingH != null) add('Sign-ups close in ' + (t.closingH < 1 ? 'under an hour' : Math.floor(t.closingH) + ' h') + ', ' + ((open.counts && open.counts.ok) || 0) + '/' + open.size, goComp(open.code, 'entries'), true);
  if (t.illegal && open) add(s(t.illegal, 'entrant has', 'entrants have') + ' no legal strategy for tonight', goComp(open.code, 'entries'));
  // named as Results will show it (prizeTodo): a burn, a payout, or either when only Results can tell
  for (const code of t.payoutDue || []) {
    const k = prizeTodo(byCode(code), banned());
    add((k === 'burn' ? 'Prize burn for ' : k === 'payout' ? 'Payout for ' : 'Prize (payout or burn) for ') + num(code) + ' not recorded', goComp(code, 'results'));
  }
  for (const code of t.rewardsDue || []) add('Rewards for ' + num(code) + ' not given', goComp(code, 'rewards'));
  if (t.lowBalance && open) add('Project wallet holds less than the prize of ' + num(open.code), goComp(open.code, 'setup', 'admSetEntry'));
  if (t.rerate) add('Engine changed: ' + s(t.rerate, 'deck needs', 'decks need') + ' re-rating', () => showTab('bots'));
  if (o.paused) add('The leagues are paused', () => showTab('leagues'));
  if (!items.length) add('Nothing waits for you.', null, true);
  for (const it of items) {
    const body = [h('i', { 'aria-hidden': 'true' }), h('span', null, it.text)];
    R.todo.append(h('li', { class: it.calm ? 'calm' : '' }, it.go ? h('button', { type: 'button', class: 'adm-todo-go', onclick: it.go }, ...body, h('b', { 'aria-hidden': 'true' }, '›')) : h('span', { class: 'adm-todo-go' }, ...body)));
  }
}
// the competition of the moment: its state, its counts, how long until the next step
function renderNowComp() {
  const list = st.ov.comps || [];
  R.nowComp.textContent = '';
  if (!list.length) { R.nowComp.append(h('p', { class: 'sq-desc' }, 'No competitions yet.'), btn('Make a draft', 'gold', () => showTab('comps'))); return; }
  const c = currentComp(list);
  addKids(R.nowComp,
    h('div', { class: 'adm-ch' }, h('b', null, '#' + c.n + ' ' + c.name), stPill(c.st), h('span', { class: 'adm-count' }, whenOf(c))),
    h('span', { class: 'lg-sub' }, countsLine(c) + (c.entry ? ' · entry ' + c.entry.ui + ' · prize ' + (c.prize ? c.prize.ui : '0') + ' $BLUB' : '')),
    c.chips && c.chips.length ? h('div', { class: 'adm-chips' }, ...c.chips.map((x) => h('span', { class: 'adm-chip' }, x))) : null,
    h('div', { class: 'adm-row' }, btn('Open #' + c.n, 'gold', goComp(c.code, STEP_OF[c.st])), list.length > 1 ? btn('All competitions', '', () => showTab('comps')) : null));
}

/* ---- the week at a glance ---- */
function tile(label, big, ...rest) {
  return h('div', { class: 'adm-tile' }, h('span', { class: 'adm-tl' }, label), h('b', { class: 'adm-big' }, big), ...rest);
}
function bar(n, max, cls) {
  const pct = max > 0 ? Math.min(100, Math.round((100 * n) / max)) : 0;
  return h('div', { class: 'adm-bar ' + (cls || '') + (pct >= 80 ? ' hot' : ''), title: n + ' of ' + max }, h('i', { style: 'width:' + pct + '%' }));
}
function renderOverview() {
  const o = st.ov;
  const left = Math.max(0, Date.parse(o.ends) - Date.now());
  const days = Math.floor(left / 86400000), hrs = Math.floor((left % 86400000) / 3600000);
  const members = o.groups.flatMap((g) => g.m.map((m) => ({ id: m[0], d: g.d })));
  const bots = members.filter((m) => BOT_RE.test(m.id)).length;
  const per = DIVS.map((_, i) => members.filter((m) => m.d === i + 1 && !BOT_RE.test(m.id)).length);
  const today = o.days[0] || { duels: 0, rated: 0 };
  const top = Math.max(1, ...o.days.map((d) => d.duels));
  R.ovBody.textContent = '';
  R.ovBody.append(
    tile('Week', String(Number(o.week.slice(5))), h('span', null, 'ends in ' + (days ? days + 'd ' : '') + hrs + 'h'), pill(o.paused ? 'Paused' : 'Running', o.paused ? 'bad' : 'ok')),
    tile('Players this week', String(members.length - bots), h('span', null, '+ ' + bots + ' bot' + (bots === 1 ? '' : 's')),
      h('div', { class: 'adm-divs' }, ...DIVS.map((n, i) => h('span', { title: n }, h('i', { style: 'background:' + DIV_COL[i] }), per[i])))),
    tile('Duels today', String(today.duels), h('span', null, today.rated + ' rated'),
      h('div', { class: 'adm-spark', title: 'The last 7 days, today on the right' }, ...o.days.slice().reverse().map((d) => h('i', { style: 'height:' + Math.max(6, Math.round((100 * d.duels) / top)) + '%', title: d.day + ': ' + d.duels + ' duels, ' + d.rated + ' rated' })))),
    tile('Database today', Math.round((100 * o.budget.writes) / Math.max(1, o.budget.maxWrites)) + '%',
      h('span', null, o.budget.writes + ' / ' + o.budget.maxWrites + ' writes'), bar(o.budget.writes, o.budget.maxWrites),
      h('span', null, o.budget.reads + ' / ' + o.budget.maxReads + ' reads'), bar(o.budget.reads, o.budget.maxReads, 'reads')),
    tile('Teams', String(o.teams), h('span', null, 'saved in the Meadow')),
  );
  if (o.chain) R.ovBody.append(tile('$BLUB on chain', o.chain.supply ? fmtRaw(o.chain.supply, o.chain.dec) : '—', h('span', null, 'supply · slot ' + o.chain.slot), h('span', null, 'project wallet: ' + (o.chain.projectBalance ? fmtRaw(o.chain.projectBalance, o.chain.dec) : '—'))));
}
const fmtRaw = (raw, dec) => {
  const s = String(raw).padStart(dec + 1, '0');
  const whole = s.slice(0, s.length - dec);
  const n = Number(whole);
  return n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : whole;
};


/* ---- competitions: the list ---- */
const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 900px)').matches;
function renderComps() {
  R.compList.textContent = '';
  // before the first overview (a draft made while it loads): the list follows with it
  const list = (st.ov && st.ov.comps) || [];
  const cur = list.find((c) => c.code === st.comp);
  R.clistSum.textContent = 'Competitions · ' + list.length + (cur ? ' · #' + cur.n + ' ' + cur.st : '');
  R.dupBtn.textContent = st.compFull ? 'Duplicate #' + st.compFull.n + ' as next week' : 'Duplicate as next week';
  if (!st.ov) { R.compList.append(h('li', { class: 'sq-empty' }, 'Loading the list…')); return; }
  if (!list.length) { R.compList.append(h('li', { class: 'sq-empty' }, 'No competitions yet. Make a draft.')); return; }
  for (const c of list) {
    const on = c.code === st.comp;
    R.compList.append(h('li', null, h('button', { type: 'button', class: 'adm-citem' + (on ? ' on' : ''), 'aria-current': on ? 'true' : null, onclick: () => openComp(c.code) },
      h('span', { class: 'adm-ch' }, h('b', null, '#' + c.n + ' ' + c.name), stPill(c.st)),
      h('span', { class: 'lg-sub' }, countsLine(c)),
      h('span', { class: 'lg-sub' }, whenOf(c)))));
  }
}
// reads a competition and shows it on a step (its state's step when none is given)
async function openComp(code, step, anchor) {
  if (!code) return;
  const other = code !== st.comp;
  st.comp = code;
  if (other) Object.assign(st, { compFull: null, base: null, draft: null, only: {}, day: null, dayRec: null, esel: new Set(), efocus: null, eform: null, payV: {} });
  if (step) st.step = step;
  if (R.cdetail && (other || !st.compFull)) { R.cdetail.textContent = ''; R.cdetail.append(h('p', { class: 'sq-desc' }, 'Loading…')); }
  let c;
  try {
    c = await A.comps.get(code);
  } catch (e) {
    if (st.comp !== code) return;
    st.comp = null;
    lsWrite({ admComp: null });
    if (R.cdetail) { R.cdetail.textContent = ''; R.cdetail.append(h('p', { class: 'sq-msg bad' }, (e && e.message) || 'That competition did not load.')); }
    return;
  }
  if (st.comp !== code) return;
  if (!step && (other || !st.step)) st.step = STEP_OF[c.st] || 'setup';
  setComp(c, true);
  // on a phone the list folds away once a competition is picked
  if (narrow()) R.clist.open = false;
  if (anchor) requestAnimationFrame(() => { const a = document.getElementById(anchor); if (a) a.scrollIntoView({ block: 'start' }); });
}
// a fresh record of the open competition: the setup follows it, unless it has changes
// of its own, which then go on top of what was read (another moderator's edit included)
function setComp(c, render) {
  const E = C.E;
  const base = normCfg(c.cfg, E);
  if (st.draft && st.base && st.compFull && st.compFull.code === c.code && dirty()) {
    const mine = {};
    for (const k of Object.keys(st.draft)) if (JSON.stringify(st.draft[k]) !== JSON.stringify(st.base[k])) mine[k] = st.draft[k];
    st.draft = { ...JSON.parse(JSON.stringify(base)), ...JSON.parse(JSON.stringify(mine)) };
  } else st.draft = JSON.parse(JSON.stringify(base));
  st.base = base;
  st.compFull = c;
  // a part shows "Only these" when more of it is banned than allowed
  st.only = {};
  for (const [part, , list] of RULE_PARTS) {
    const m = st.draft.rules.lim[part];
    const zeros = E[list].filter((x) => m[x[0]] === 0).length;
    st.only[part] = zeros > E[list].length / 2;
  }
  lsWrite({ admComp: { code: c.code, step: st.step } });
  if (render) { renderComps(); renderComp(); }
}
const dirty = () => !!(st.draft && st.base && JSON.stringify(st.draft) !== JSON.stringify(st.base));
async function reread() {
  try { setComp(await A.comps.get(st.comp), true); } catch { /* the message already says what happened */ }
}
function setStep(step) {
  st.step = step;
  lsWrite({ admComp: { code: st.comp, step } });
  renderComp();
  const s = document.getElementById('admStep-' + step);
  if (s) s.focus();
}

/* ---- one competition: its head, its actions, the stepper ---- */
const ACT_DONE = {
  open: (c) => 'Sign-ups of #' + c.n + ' are open.', close: (c) => 'Sign-ups of #' + c.n + ' are closed.', reopen: (c) => 'Sign-ups of #' + c.n + ' are open again.',
  unpublish: (c) => '#' + c.n + ' is a draft again.', salt: (c) => 'A new salt for #' + c.n + '.', void: (c) => '#' + c.n + ' is void: paid entries are on the refund list.',
  lock: (c) => '#' + c.n + ' is locked and drawn.', unlock: (c) => '#' + c.n + ' is unlocked.', pause: (c) => '#' + c.n + ' is paused.', resume: (c) => '#' + c.n + ' plays again.',
  engine: (c) => '#' + c.n + ' plays on engine ' + c.cfg.e + '.', archive: (c) => '#' + c.n + ' is archived: it is frozen now (no more payments, refunds or reward changes).',
};
async function doAct(what, confirm) {
  const c = st.compFull;
  if (!c || st.busy) return;
  if (dirty() && (what === 'open' || what === 'lock')) { say(R.cmsg, 'Save or discard the changes in Setup first.', false); return; }
  st.busy = true;
  say(R.cmsg, 'Working…');
  try {
    const r = await A.comps.act(c.code, { do: what, v: c.v, ...(confirm ? { confirm } : {}) });
    st.busy = false;
    if (what === 'archive') { Object.assign(st, { comp: null, compFull: null, draft: null, base: null }); lsWrite({ admComp: null }); }
    else setComp(r.comp, true);
    toast(ACT_DONE[what](r.comp), true);
    await refresh();
  } catch (e) {
    st.busy = false;
    if (e && e.code === 'stale') { await reread(); say(R.cmsg, 'Another moderator changed #' + c.n + ' again while yours was sent a second time: it was read again. Check it and try once more.', false); }
    else say(R.cmsg, (e && e.message) || 'That did not work.', false);
  }
}
// a money or no-way-back action: it waits for the exact words typed in, e.g. OPEN 8
function typedAct(label, word, what, detail, cls) {
  return btn(label + '…', cls || '', (ev) => {
    const c = st.compFull;
    const want = word + ' ' + c.n;
    const from = ev && ev.currentTarget;
    const close = () => { R.typed.textContent = ''; back(from, '#admCompTitle'); };
    R.typed.textContent = '';
    const inp = h('input', { class: 'sq-pfin adm-typed-in', id: 'admTyped', autocomplete: 'off', spellcheck: 'false', placeholder: want });
    const m = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
    const go = () => {
      if (inp.value.trim() !== want) { say(m, 'Refused: type ' + want + ' exactly to go on.', false); inp.select(); return; }
      R.typed.textContent = '';
      doAct(what, want);
    };
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
    R.typed.append(h('div', { class: 'adm-typed', role: 'group', 'aria-label': label, onkeydown: escTo(close) },
      h('p', { class: 'adm-state' }, detail),
      h('label', { class: 'adm-field', for: 'admTyped' }, h('span', { class: 'adm-fl' }, 'Type ' + want + ' to confirm'), inp),
      h('div', { class: 'adm-row' }, btn(label, cls === 'pink' ? 'pink' : 'gold', go), btn('Cancel', '', close), h('span', { class: 'adm-fine' }, 'Enter confirms, Esc cancels')), m));
    inp.focus();
  });
}
// the amounts as they stand: fixed at open, else what the live supply gives today
function amountsOf(c, cfg) {
  const sup = c.sup || st.chain;
  if (!sup || !sup.supply) return null;
  const dec = sup.dec || 0;
  return { entry: shareOf(sup.supply, cfg.entryBps), prize: shareOf(sup.supply, cfg.prizeBps), dec, fixed: !!c.sup };
}
function compActions(c) {
  const row = h('div', { class: 'adm-row adm-acts' });
  const small = (label, what, cls, a) => btn(label, cls || '', () => doAct(what), a);
  const am = amountsOf(c, st.base);
  const money = am ? 'Entry ' + uiAmount(am.entry, am.dec) + ' $BLUB (' + pctOf(st.base.entryBps) + '), prize ' + uiAmount(am.prize, am.dec) + ' $BLUB (' + pctOf(st.base.prizeBps) + ')' : 'Entry ' + pctOf(st.base.entryBps) + ' and prize ' + pctOf(st.base.prizeBps) + ' of the supply';
  if (c.st === 'draft') {
    const ob = typedAct('Open sign-ups', 'OPEN', 'open', 'Opening reads the supply now and fixes the amounts: ' + money + '. Entry amount, prize, size, order and the opening time cannot change after this.');
    if (squadRulesIn(st.base.rules)) Object.assign(ob, { disabled: true, title: 'Clear the squad rules in Setup first: they are not played yet' });
    row.append(ob);
  }
  if (c.st === 'open') {
    row.append(small('Close sign-ups', 'close'));
    const has = (c.entries || []).length > 0;
    row.append(small('Unpublish', 'unpublish', '', has ? { disabled: true, title: 'Not with entries in: close or void it instead' } : { title: 'Back to a draft (no entries yet)' }));
  }
  if (c.st === 'closed') row.append(small('Reopen', 'reopen'));
  if ((PHASE[c.st] || 0) < 2) row.append(small('Re-roll salt', 'salt', '', { title: 'Draw a new secret salt for the day seeds (before the lock only)' }));
  if (['open', 'closed', 'locked', 'live', 'paused'].includes(c.st)) row.append(typedAct('Void', 'VOID', 'void', 'Voiding stops #' + c.n + ' for good. Every paid entry goes on the refund list, to pay back by hand from the project wallet.', 'pink'));
  if ((c.st === 'rewarded' || c.st === 'void' || nobodyWon(c)) && !c.arch && !c.archived) {
    // archive freezes the refunds too: it waits for the ones still owed (as the server's archive refuses)
    const owed = refundsOwed(c);
    row.append(owed.length ? btn('Archive', '', () => archiveWaits(c, owed), { title: owed.length + ' refund' + (owed.length === 1 ? '' : 's') + ' still owed' })
      : sureBtn('Archive', '', () => doAct('archive'), 'Freeze #' + c.n + ' for good?'));
  }
  return row;
}
// the archive's confirmation while refunds are owed: who, and the way to Results
function archiveWaits(c, owed) {
  R.typed.textContent = '';
  const close = () => { R.typed.textContent = ''; };
  R.typed.append(h('div', { class: 'adm-typed', role: 'group', 'aria-label': 'Archive #' + c.n, onkeydown: escTo(close) },
    h('p', { class: 'adm-state' }, 'Archiving freezes #' + c.n + ' for good, its refunds too. ' + (owed.length === 1 ? '1 refund is' : owed.length + ' refunds are') + ' still owed: record ' + (owed.length === 1 ? 'it' : 'them') + ' first.'),
    h('ul', { class: 'adm-owed' }, ...owed.map((e) => h('li', null, nameOf(e.w) + ' · ' + short(e.w) + ' · ' + (c.st === 'void' ? 'voided' : e.st === 'no' ? 'declined' : e.st === 'wait' ? 'waiting at the lock' : e.st === 'lapsed' ? 'lapsed at the lock' : 'not decided on at the lock')))),
    h('div', { class: 'adm-row' }, btn('Go to the refunds', 'gold', () => { close(); setStep('results'); }), btn('Cancel', '', close))));
  const first = R.typed.querySelector('button');
  if (first) first.focus();
}
// the facts under a competition's head: code, week, engine, counts, salt
const sumOf = (c) => (st.ov && (st.ov.comps || []).find((x) => x.code === c.code)) || { ...c, name: c.cfg.name, size: c.cfg.size, week: c.cfg.week };
function factsOf(c, sum) {
  return 'Code ' + c.code + ' · week ' + (c.cfg.week ? Number(c.cfg.week.slice(5)) : '?') + ' · engine ' + c.cfg.e + (c.cfg.e !== C.E.SQUAD_ENGINE ? ' (the page runs ' + C.E.SQUAD_ENGINE + ')' : '') + ' · ' + countsLine({ ...sum, counts: c.counts || sum.counts }) + ' · salt ' + (c.prv && c.prv.salt === 'set' ? 'set' : 'not drawn yet');
}
function drawFacts() {
  const c = st.compFull;
  if (c && R.cfacts && R.cfacts.isConnected) R.cfacts.textContent = factsOf(c, sumOf(c));
}
function renderComp() {
  if (!R.cdetail) return;
  const c = st.compFull;
  R.cdetail.textContent = '';
  if (!c) { R.cdetail.append(h('h3', { id: 'admCompTitle' }, 'Competition'), h('p', { class: 'sq-desc' }, 'Pick a competition in the list, or make a draft.')); return; }
  const sum = sumOf(c);
  R.cmsg = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
  R.typed = h('div', { class: 'adm-typedbox' });
  R.cdetail.append(
    h('div', { class: 'adm-chead' },
      h('h3', { id: 'admCompTitle' }, '#' + c.n + ' ' + c.cfg.name), stPill(c.st),
      h('span', { class: 'adm-count' }, whenOf({ ...sum, st: c.st, win: c.win }))),
    R.cfacts = h('p', { class: 'lg-sub adm-cfacts' }, factsOf(c, sum)),
    compActions(c), R.typed, R.cmsg);
  // the stepper: every step a place of its own (remembered), the state's step marked
  const here = STEP_OF[c.st];
  const nav = h('ol', { class: 'adm-steps', 'aria-label': 'Steps of #' + c.n });
  STEPS.forEach(([id, label], i) => {
    nav.append(h('li', null, h('button', { type: 'button', id: 'admStep-' + id, class: 'adm-step' + (id === st.step ? ' on' : '') + (id === here ? ' here' : ''), 'aria-current': id === st.step ? 'step' : null, onclick: () => setStep(id), title: id === here ? 'Where #' + c.n + ' stands now' : null },
      h('span', { class: 'adm-stepn' }, String(i + 1)), label)));
  });
  R.stepBody = h('div', { class: 'adm-stepbody', role: 'region', 'aria-label': (STEPS.find((s) => s[0] === st.step) || STEPS[0])[1] });
  R.cdetail.append(h('nav', { class: 'adm-stepnav' }, nav), R.stepBody);
  // on a phone the steps scroll sideways: the open one in view
  requestAnimationFrame(() => {
    const on = nav.querySelector('.adm-step.on');
    if (on && nav.scrollWidth > nav.clientWidth + 1) nav.scrollLeft += on.getBoundingClientRect().left - nav.getBoundingClientRect().left - 16;
  });
  const draw = { setup: renderSetup, entries: renderEntries, pool: renderPool, lock: renderLock, live: renderLive, results: renderResults, rewards: renderRewards, post: renderPost }[st.step] || renderSetup;
  draw(R.stepBody, c);
}

/* ---- the other steps (their full screens come in later steps of the build) ---- */
/* ---- Entries: review the requests (burn, signals, legality), decide, undo, add by hand ---- */
// what each refusal means, in a sentence a moderator can act on
const ERR_SAYS = {
  bad_wallet: 'That is not a wallet address (base58, 32 to 44 characters).',
  no_blub: 'That wallet has no saved team, so it cannot play.',
  banned: 'That wallet is banned. Lift the ban under Wallets first.',
  is_moderator: 'Moderators cannot enter a competition.',
  already: 'That wallet has entered this competition already.',
  full: 'No places left: every place is approved.',
  too_new: 'That team is younger than the minimum team age of this competition.',
  closed: 'Wallets are added while the sign-ups are open or closed, not now.',
  bad_sig: 'That is not a transaction signature (base58, 64 bytes).',
  not_final: 'That transaction is not final yet. Try again in half a minute.',
  rpc_busy: 'The chain could not be read just now. Nothing was written: try again in a moment.',
  not_burn: 'That transaction is not a burn of $BLUB. A transfer is not a burn, not even to an incinerator.',
  not_transfer: 'That transaction is not a transfer of $BLUB from the project wallet.',
  bad_item: 'That is not an exclusive item or a pin.',
  not_played: 'That day is not played yet.',
  bad_cfg: 'Check what you typed: something is missing or out of range.',
  too_small: 'That burn is less than the entry amount.',
  not_yours: 'That burn was not signed by this wallet.',
  sig_used: 'That signature was used already, here or in another competition.',
  too_early: 'That burn was made before the sign-ups opened.',
  too_late: 'That burn came after the sign-ups closed.',
  wrong_mint: 'That burn is of another token, not $BLUB.',
  wrong_program: 'That burn ran on another token program than the one fixed at opening.',
  bad_decimals: 'That burn names other decimals than the mint has.',
  comps_off: 'Competitions are switched off on this server.',
  not_entered: 'That wallet has no entry in this competition.',
  no_undo: 'That cannot be undone any more: the entry moved on since.',
  too_many: 'Pick from 1 to 50 wallets at a time.',
  rate_limited: 'Too many requests in a row. Wait a minute and try again.',
  stale: 'Another moderator changed this competition again while yours was sent a second time. It was read again: check it and try once more.',
  signed_out: 'Your session ended. Connect your wallet again.',
  not_admin: 'This wallet is not a moderator.',
};
// a chain verdict in words: the server's not_final is a wait (the RPC has not finalised it
// yet), the sandbox's is a signature its example chain does not know, which no retry
// changes, so there the backend's own sentence stands
const SANDBOX_UNKNOWN = 'Not on the sandbox’s chain: it knows only its own example signatures.';
export function chainSay(code, message, mode = A && A.mode) {
  if (code === 'not_final' && mode === 'local') return message || SANDBOX_UNKNOWN;
  return ERR_SAYS[code] || message || '';
}
const ACT_VERB = { approve: 'approved', wait: 'waitlisted', decline: 'declined', dq: 'disqualified', restore: 'restored' };
function errSay(e, act) {
  if (!e) return 'That did not work.';
  if (e.code === 'bad_state') {
    if (e.want && e.want.includes('req')) return 'Refused: ' + (e.wallet ? nameOf(e.wallet) + ' is ' : 'that entry is ') + (e.st || 'in another state') + '. Only requests, waitlisted and approved entries can be ' + (ACT_VERB[act] || 'decided') + '.';
    if (e.want && e.want.includes('dq')) return 'Refused: only approved entries can be disqualified, and only disqualified ones restored' + (e.st ? ' (this one is ' + e.st + ')' : '') + '.';
    return 'Refused: not while #' + (st.compFull ? st.compFull.n : '') + ' is ' + (e.st || 'in this state') + (e.message ? '. ' + e.message : '.');
  }
  if (e.code === 'bad_cfg' && e.field === 'sig') return 'Paste the signature of the burn, or tick Free giveaway.';
  // the backend's own sentence says what is missing (the deck library empty, the typed word…)
  if (e.code === 'bad_cfg' && e.message && e.message !== e.code) return e.message;
  if (e.code === 'too_new' && e.minAge) return 'That team is younger than ' + e.minAge + ' day' + (e.minAge === 1 ? '' : 's') + ', the minimum team age of this competition.';
  return chainSay(e.code, e.message) || 'That did not work.';
}
const ENTRY_FILTERS = [
  ['all', 'All', () => true], ['req', 'Requests', (e) => e.st === 'req'], ['ok', 'Approved', (e) => e.st === 'ok'], ['wait', 'Waitlist', (e) => e.st === 'wait'],
  ['no', 'Declined', (e) => e.st === 'no'], ['lapsed', 'Lapsed', (e) => e.st === 'lapsed'], ['dq', 'Disqualified', (e) => e.st === 'dq'],
  // paid: a verified burn, or one entered by hand and not checked yet (amber)
  ['paid', 'Paid', (e) => !!(e.b && !e.free && (e.b.ok || (e.hand && !e.b.code)))], ['sig', 'Signals', (e) => signalsOf(e).length > 0],
];
const EST = { req: 'Request', ok: 'Approved', wait: 'Waitlist', no: 'Declined', lapsed: 'Lapsed', dq: 'Disqualified', out: 'Withdrawn' };
const EST_CLS = { req: 'warn', ok: 'ok', wait: 'dim', no: 'bad', lapsed: 'dim', dq: 'bad', out: 'dim' };
// the review signals of an entry, as short pills
function signalsOf(e) {
  const s = e.signals || {};
  const out = [];
  if (s.ip > 1) out.push(['Same connection ×' + s.ip, 'warn', 'This entry shares its connection with ' + (s.ip - 1) + ' other' + (s.ip > 2 ? 's' : '')]);
  if (s.fp) out.push(['Fee payer ≠ wallet', 'warn', 'Another wallet paid the fee of the burn']);
  if (s.newTeam) out.push(['New team', 'dim', 'The team was saved less than a week ago']);
  if (s.sameSquad > 0) out.push(['Same squad as ' + s.sameSquad + ' other' + (s.sameSquad > 1 ? 's' : ''), 'warn', 'Another entrant saved the same squad']);
  if (e.legal && !e.legal.every(Boolean)) out.push(['Breaks the rules', 'bad', 'A strategy breaks this competition’s rules']);
  return out;
}
// social links only from handles that pass the checks; Discord stays text
const X_RE = /^[A-Za-z0-9_]{1,15}$/;
const TG_RE = /^[A-Za-z0-9_]{5,32}$/;
const SIG_LINK = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
function socials(e) {
  const out = [];
  const link = (href, text, label) => h('a', { class: 'adm-soc', href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': label }, text);
  const x = String(e.x || '').replace(/^@/, '');
  const tg = String(e.tg || '').replace(/^@/, '');
  if (x) out.push(X_RE.test(x) ? link('https://x.com/' + x, 'X @' + x, 'X profile @' + x + ' (opens a new tab)') : h('span', { class: 'adm-soc bad', title: 'Not a valid X handle: no link' }, 'X: ' + x.slice(0, 40)));
  if (tg) out.push(TG_RE.test(tg) ? link('https://t.me/' + tg, 'Telegram @' + tg, 'Telegram @' + tg + ' (opens a new tab)') : h('span', { class: 'adm-soc bad', title: 'Not a valid Telegram handle: no link' }, 'Telegram: ' + tg.slice(0, 40)));
  if (e.dc) out.push(h('span', { class: 'adm-soc' }, 'Discord ' + String(e.dc).slice(0, 40)));
  return out;
}
const btTxt = (bt) => (bt > 0 ? day(new Date(bt * 1000).toISOString()) + ' UTC' : '?');
// the burn block: verified (green), recorded unverified by hand (amber), failed (red), free or none
function burnBlock(c, e) {
  const dec = c.sup ? c.sup.dec : 6;
  const b = e.b;
  const box = h('div', { class: 'adm-burn' });
  const v = b && st.verdicts[b.sig];
  if (e.free && !b) {
    box.classList.add('free');
    box.append(h('b', null, 'Free entry'), h('span', null, e.hand ? 'Given by hand (a giveaway): no burn.' : 'No burn needed.'));
    return box;
  }
  if (!b) {
    box.classList.add('none');
    box.append(h('b', null, 'No burn'), h('span', null, c.cfg.order === 'ask' ? 'Not burned yet: this competition approves first.' : 'No burn recorded for this entry.'));
    return box;
  }
  const kind = b.ok ? 'ok' : e.hand && !b.code ? 'amber' : 'bad';
  box.classList.add(kind);
  const sig = h('span', { class: 'adm-sig', title: b.sig }, b.sig.length > 16 ? b.sig.slice(0, 8) + '…' + b.sig.slice(-6) : b.sig);
  const ex = SIG_LINK.test(b.sig) ? h('a', { class: 'adm-soc', href: 'https://solscan.io/tx/' + encodeURIComponent(b.sig), target: '_blank', rel: 'noopener noreferrer' }, 'Solscan ↗') : null;
  const recheck = btn('Re-check', '', () => recheckBurn(c, e, recheck), { title: 'Read the transaction on the chain again (0 database commands)' });
  if (kind === 'ok') box.append(h('b', null, '✓ Burn verified'), h('span', null, uiAmount(b.raw, dec) + ' $BLUB · raw ' + b.raw + ' · slot ' + b.slot + ' · ' + btTxt(b.bt)));
  else if (kind === 'amber') box.append(h('b', null, '! Not verified'), h('span', null, 'Entered by hand and recorded without a check' + (b.raw ? ' · ' + uiAmount(b.raw, dec) + ' $BLUB claimed' : '') + '. Check it again.'));
  else box.append(h('b', null, '✗ Burn failed'), h('span', null, chainSay(b.code) || 'This burn did not pass the check.'));
  box.append(h('span', { class: 'adm-row adm-burnr' }, sig, copyBtn(b.sig, 'Copy signature'), ex, recheck));
  if (v) box.append(h('span', { class: 'adm-verdict ' + (v.ok ? 'ok' : 'bad'), role: 'status' }, (v.ok ? '✓ Checked again: ' + (v.message || 'a final burn') : '✗ Checked again: ' + (chainSay(v.code, v.message) || 'it did not pass')) + (v.t ? ' (' + ago(v.t) + ')' : '')));
  return box;
}
async function recheckBurn(c, e, b) {
  b.disabled = true;
  b.textContent = 'Checking…';
  try {
    const v = await A.comps.verify(c.code, { sig: e.b.sig, wallet: e.w });
    st.verdicts[e.b.sig] = { ...v, t: new Date().toISOString() };
  } catch (err) {
    st.verdicts[e.b.sig] = { ok: false, code: err && err.code, message: errSay(err), t: new Date().toISOString() };
  }
  drawEntries();
}
// a wallet's rank this week, from the overview's groups (0 commands)
function rankOf(id) {
  for (const g of (st.ov && st.ov.groups) || []) if (g.m.some((m) => m[0] === id)) return DIVS[g.d - 1];
  return null;
}
const daysOld = (iso) => (Date.parse(iso) > 0 ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / DAY)) : null);
function entryCard(c, e, i) {
  const w = who(e.w);
  const sel = st.esel.has(e.w);
  const P = st.pcache.get(e.w);
  const ban = (st.ov && (st.ov.bans || []).find((b) => b.id === e.w)) || (P && P.ban) || (e.banned ? {} : null);
  const created = (P && P.blub && P.blub.created) || (w && w.created);
  const age = daysOld(created);
  const rank = rankOf(e.w);
  const li = h('li', { class: 'adm-ecard' + (sel ? ' sel' : '') + (st.efocus === e.w ? ' focus' : ''), tabindex: st.efocus === e.w || (!st.efocus && i === 0) ? '0' : '-1', 'data-w': e.w, 'aria-label': nameOf(e.w, w) + ', ' + EST[e.st] });
  li.onfocus = (ev) => { if (ev.target === li) st.efocus = e.w; };
  li.onclick = (ev) => { if (!ev.target.closest('button,a,input,textarea,label,select')) { st.efocus = e.w; li.focus(); } };
  const cb = h('input', { type: 'checkbox', class: 'adm-esel', 'aria-label': 'Select ' + nameOf(e.w, w) });
  cb.checked = sel;
  cb.onchange = () => { st.efocus = e.w; selectW([e.w], cb.checked); };
  const head = h('div', { class: 'adm-ehead' }, h('label', { class: 'adm-eselw' }, cb), w ? face(w.look, w.style) : h('span', { class: 'adm-face adm-noface', 'aria-hidden': 'true' }),
    h('span', { class: 'adm-ename' },
      h('b', null, w ? w.name : short(e.w)),
      w && w.player ? h('span', { class: 'adm-eplayer' }, w.player) : null),
    h('span', { class: 'adm-epills' }, pill(EST[e.st] || e.st, EST_CLS[e.st]), e.hand ? pill('by hand', 'dim') : null, e.free ? pill('free', 'dim') : null, ban ? pill('banned', 'bad') : null));
  const facts = h('div', { class: 'adm-efacts' },
    h('span', { class: 'adm-ewal' }, h('span', { class: 'lg-addr', title: e.w }, short(e.w)), copyBtn(e.w)),
    h('span', null, age === null ? 'team age ?' : 'team ' + age + ' d old'),
    h('span', null, rank || 'not in the league'),
    h('span', null, 'asked ' + (ago(e.t) || '?')),
    P ? h('span', null, P.cmw && P.cmw.filter((x) => x.code !== c.code).length ? 'before: ' + P.cmw.filter((x) => x.code !== c.code).slice(0, 4).map((x) => '#' + x.n + ' ' + (x.place ? x.place + nth(x.place) : EST[x.st] || x.st)).join(', ') : 'no competitions before')
      : btn('History', 'adm-mini', () => loadHistory(e.w), { title: 'Past competitions, team and strategies (1 database command)' }));
  const kids = [head, facts];
  if (ban && ban.reason) kids.push(h('p', { class: 'adm-eline bad' }, 'Banned: ' + ban.reason));
  if (e.m) { const q = h('blockquote', { class: 'adm-emsg' }); q.textContent = e.m; kids.push(q); }
  const soc = socials(e);
  if (soc.length) kids.push(h('div', { class: 'adm-row adm-socs' }, ...soc));
  const sg = signalsOf(e);
  if (sg.length) kids.push(h('div', { class: 'adm-chips adm-sigs' }, ...sg.map(([t, k, tip]) => h('span', { class: 'adm-pill ' + k, title: tip }, t))));
  kids.push(burnBlock(c, e));
  kids.push(legalRow(c, e, P));
  if (e.why) { const p = h('p', { class: 'adm-eline' }, h('b', null, 'Reply the player sees: ')); p.append(e.why); kids.push(p); }
  if (e.note) { const p = h('p', { class: 'adm-eline dim' }, h('b', null, 'Note (moderators only): ')); p.append(e.note); kids.push(p); }
  if (e.at) kids.push(h('p', { class: 'adm-eline dim' }, (EST[e.st] || e.st) + ' ' + ago(e.at) + (e.by ? ' by ' + (e.by === 'sandbox' ? 'the sandbox' : short(e.by)) : '')));
  kids.push(entryActs(c, e));
  if (st.eform && st.eform.w === e.w) kids.push(decideForm(c, [e.w], st.eform.kind));
  li.append(...kids);
  return li;
}
const nth = (n) => (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
// ✓ or the problems per strategy: counted from the saved strategies once History is read,
// else the entry's own flags
function legalRow(c, e, P) {
  const row = h('div', { class: 'adm-legal' }, h('span', { class: 'adm-fl' }, 'Strategies'));
  const strats = P && P.strats && Array.isArray(P.strats.s) ? P.strats.s : null;
  for (let k = 0; k < 3; k++) {
    let ok = e.legal ? e.legal[k] !== false : true;
    let n = null;
    if (strats && strats[k] && strats[k].q) { n = squadProblems(strats[k].q, c.cfg.rules, C.E).length; ok = n === 0; }
    const known = !!e.legal || n !== null;
    row.append(h('span', { class: 'adm-lg ' + (!known ? 'dim' : ok ? 'ok' : 'bad'), title: !known ? 'Not checked' : ok ? 'Legal under these rules' : 'Breaks the rules' }, 'ABC'[k] + ' ' + (!known ? '?' : ok ? '✓' : n ? n + ' problem' + (n === 1 ? '' : 's') : '✗')));
  }
  return row;
}
async function loadHistory(id) {
  try {
    st.pcache.set(id, await A.player(id));
  } catch (err) {
    say(R.emsg, errSay(err), false);
    return;
  }
  drawEntries();
}
// the actions of one entry, as its state and the competition's allow
function entryActs(c, e) {
  const row = h('div', { class: 'adm-row adm-eacts' });
  const review = ['open', 'closed'].includes(c.st);
  const playing = ['live', 'paused', 'done'].includes(c.st);
  if (review && ['req', 'wait', 'ok'].includes(e.st)) {
    if (e.st !== 'ok') row.append(btn('Approve', 'gold', () => decide([e.w], 'approve'), { title: 'Approve (a)' }));
    if (e.st !== 'wait') row.append(btn('Waitlist', '', () => decide([e.w], 'wait'), { title: 'Waitlist (w)' }));
    row.append(btn('Decline…', 'pink', () => openForm(e.w, 'decline'), { title: 'Decline with a reason (d)' }));
  }
  if (playing && e.st === 'ok') row.append(btn('Disqualify…', 'pink', () => openForm(e.w, 'dq')));
  if (playing && e.st === 'dq') row.append(btn('Restore', '', () => decide([e.w], 'restore')));
  row.append(btn(e.why ? 'Edit reply' : 'Reply', '', () => openForm(e.w, 'reply')), btn(e.note ? 'Edit note' : 'Note', '', () => openForm(e.w, 'note')));
  return row;
}
function openForm(w, kind) {
  st.eform = { w, kind };
  st.efocus = w || st.efocus;
  drawEntries();
  const f = document.getElementById(w ? 'admEF-' + kind : 'admBF-' + kind);
  if (f) f.focus();
}
// the small form of a decline (or a disqualify, a reply, a note): the reason the player
// sees (≤140) and a private note (≤200)
function decideForm(c, wallets, kind) {
  const one = wallets.length === 1;
  const id = (one && st.eform && st.eform.w ? 'admEF-' : 'admBF-') + kind;
  const e = one ? (c.entries || []).find((x) => x.w === wallets[0]) : null;
  const TITLE = { decline: 'Decline ' + (one ? nameOf(wallets[0]) : wallets.length + ' wallets'), dq: 'Disqualify ' + (one ? nameOf(wallets[0]) : wallets.length + ' wallets'), reply: 'Reply to ' + (one ? nameOf(wallets[0]) : wallets.length + ' wallets'), note: 'Note on ' + (one ? nameOf(wallets[0]) : wallets.length + ' wallets') };
  const withWhy = kind !== 'note';
  const why = h('textarea', { class: 'sq-pfin adm-area', id: withWhy ? id : null, maxlength: '140', rows: '2', placeholder: kind === 'dq' ? 'Why (the player sees this)' : 'The reason the player sees' });
  const note = h('textarea', { class: 'sq-pfin adm-area', id: withWhy ? null : id, maxlength: '200', rows: '2', placeholder: 'Only moderators see this' });
  if (e && kind === 'reply') why.value = e.why || '';
  if (e && kind === 'note') note.value = e.note || '';
  const left = h('span', { class: 'adm-fl' });
  const count = () => { left.textContent = why.value.length + '/140'; };
  why.oninput = count;
  count();
  const m = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
  const dc = kind === 'dq' ? dqConfirm(c) : null;
  const go = () => {
    if (kind === 'reply' && !why.value.trim()) { say(m, 'Write the reply first.', false); why.focus(); return; }
    if (kind === 'note' && !note.value.trim()) { say(m, 'Write the note first.', false); note.focus(); return; }
    if (dc && !dc.ok()) { say(m, 'Refused: type ' + dc.want + ' exactly to go on.', false); dc.inp.select(); dc.inp.focus(); return; }
    decide(wallets, kind, { why: withWhy ? why.value.trim() : undefined, note: note.value.trim() || undefined, ...(dc ? { confirm: dc.want } : {}) }, m);
  };
  const keys = (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeForm(); }
    else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); go(); }
  };
  why.onkeydown = keys;
  note.onkeydown = keys;
  if (dc) dc.inp.onkeydown = keys;
  const LABEL = { decline: 'Decline', dq: 'Disqualify', reply: 'Save reply', note: 'Save note' };
  return h('div', { class: 'adm-eform', role: 'group', 'aria-label': TITLE[kind] },
    h('b', { class: 'adm-eft' }, TITLE[kind]),
    withWhy ? h('label', { class: 'adm-field' }, h('span', { class: 'adm-fl' }, kind === 'reply' ? 'Reply the player sees' : 'Reason the player sees', left), why) : null,
    kind === 'reply' ? null : h('label', { class: 'adm-field' }, h('span', { class: 'adm-fl' }, 'Private note (optional)'), note),
    dc ? h('p', { class: 'adm-fine' }, 'The final table is in: a disqualified winner is treated like a bot win, so the prize is burned, not paid.') : null,
    dc ? dc.el : null,
    h('div', { class: 'adm-row' }, btn(LABEL[kind], kind === 'decline' || kind === 'dq' ? 'pink' : 'gold', go), btn('Cancel', '', closeForm), h('span', { class: 'adm-fine' }, 'Ctrl+Enter sends, Esc cancels')), m);
}
// a disqualify after the final changes who gets the prize (a disqualified winner's prize is
// burned): both backends want 'DQ <n>' typed (lib/scripts.mjs ADMIN_ENTRY)
function dqConfirm(c) {
  if (c.st !== 'done') return null;
  const want = 'DQ ' + c.n;
  const inp = h('input', { class: 'sq-pfin adm-typed-in', autocomplete: 'off', spellcheck: 'false', placeholder: want, 'aria-label': 'Type ' + want + ' to confirm' });
  return { want, inp, el: h('label', { class: 'adm-field' }, h('span', { class: 'adm-fl' }, 'After the final: type ' + want + ' to confirm'), inp), ok: () => inp.value.trim() === want };
}
function closeForm() {
  const w = st.eform && st.eform.w;
  st.eform = null;
  drawEntries();
  if (w) focusCard(w);
}
// one decision on one or more wallets: the backend checks every wallet before it changes
// any (one refusal changes nothing); then the record and the overview are read again
// (1 + 1 commands), and a toast offers Undo for 10 s (the log keeps its own Undo)
const DONE = { approve: 'Approved ', wait: 'Waitlisted ', decline: 'Declined ', dq: 'Disqualified ', restore: 'Restored ', reply: 'Reply saved for ', note: 'Note saved for ', undo: 'Undone: ' };
async function decide(wallets, act, extra, msgEl) {
  const c = st.compFull;
  if (!c || st.busy || !wallets.length) return;
  const m = msgEl || R.emsg;
  const es = c.entries || [];
  const before = new Map(es.map((x) => [x.w, x.st]));
  if (act === 'approve') {
    const okN = es.filter((x) => x.st === 'ok').length;
    const adds = wallets.filter((w) => before.has(w) && before.get(w) !== 'ok').length;
    if (okN + adds > c.cfg.size) { say(m, 'Only ' + Math.max(0, c.cfg.size - okN) + ' place' + (c.cfg.size - okN === 1 ? '' : 's') + ' left: approve fewer, or waitlist the rest.', false); return; }
  }
  st.busy = true;
  say(m, 'Working…');
  let r;
  try {
    r = await A.comps.decide(c.code, { do: act, wallets, v: c.v, ...(extra && extra.why !== undefined ? { why: extra.why } : {}), ...(extra && extra.note ? { note: extra.note } : {}), ...(extra && extra.confirm ? { confirm: extra.confirm } : {}) });
  } catch (err) {
    st.busy = false;
    if (err && err.code === 'stale') { await rereadEntries(); say(R.emsg, errSay(err), false); return; }
    say(m, errSay(err, act), false);
    return;
  }
  st.busy = false;
  st.eform = null;
  if (['approve', 'wait', 'decline', 'dq', 'restore'].includes(act)) st.esel.clear();
  // the wallets this decision moved: the ones an Undo puts back
  const moved = (r.entries || []).filter((x) => before.get(x.w) !== x.st).map((x) => x.w);
  await Promise.all([rereadEntries(), refresh()]);
  const who1 = wallets.length === 1 ? nameOf(wallets[0]) : wallets.length + ' wallets';
  const text = (r.changed === 0 ? 'Nothing changed: ' + who1 + (wallets.length === 1 ? ' was' : ' were') + ' that already.' : DONE[act] + who1 + '.') + burnSay(r);
  say(R.emsg, '');
  if (r.changed && moved.length && ['approve', 'wait', 'decline'].includes(act)) toastUndo(text, () => undoDecide(moved, r.log));
  // a dq after the final wants its typed confirmation, so a restore's toast offers no Undo then
  else if (r.changed && moved.length && act === 'dq') toastUndo(text, () => decide(moved, 'restore'));
  else if (r.changed && moved.length && act === 'restore' && c.st !== 'done') toastUndo(text, () => decide(moved, 'dq'));
  else toast(text, true);
}
// the winner disqualified or restored after the final: what happens to the prize now
const burnSay = (r) => (r && r.burn === true ? ' The winner is disqualified: the prize is to be burned.' : r && r.burn === false ? ' The winner is back: the prize is to be paid out.' : '');
async function undoDecide(wallets, log) {
  const c = st.compFull;
  if (!c || st.busy) return;
  st.busy = true;
  const body = () => ({ do: 'undo', wallets, v: st.compFull.v, ...(Number.isInteger(log) ? { log } : {}) });
  try {
    try {
      await A.comps.decide(c.code, body());
    } catch (err) {
      // another change came in between: read again and try the undo once more
      if (!(err && err.code === 'stale')) throw err;
      await rereadEntries();
      await A.comps.decide(c.code, body());
    }
    toast(DONE.undo + (wallets.length === 1 ? nameOf(wallets[0]) : wallets.length + ' wallets') + ' as before.', true);
  } catch (err) {
    toast(errSay(err, 'undo'), false);
  } finally {
    st.busy = false;
  }
  await Promise.all([rereadEntries(), refresh()]);
}
async function rereadEntries() {
  if (!st.comp) return;
  try { setComp(await A.comps.get(st.comp), false); } catch { /* the message says what happened */ }
  drawFacts();
  if (st.step === 'entries') drawEntries();
}
// a toast with an Undo button that stays 10 s
function toastUndo(text, undo) {
  if (!R.toast) return;
  R.toast.textContent = '';
  const b = h('button', { type: 'button', class: 'btn small adm-undo' }, 'Undo');
  b.onclick = () => { R.toast.classList.remove('show'); clearTimeout(R.toastT); undo(); };
  R.toast.append(h('span', null, reapplied(text)), b);
  st.reapplied = 0;
  R.toast.className = 'adm-toast show' + (R.toastLift ? ' lift' : '');
  clearTimeout(R.toastT);
  R.toastT = setTimeout(() => R.toast.classList.remove('show'), 10000);
}
function focusCard(w) {
  const li = R.elist && [...R.elist.children].find((x) => x.dataset.w === w);
  if (li) { li.focus(); li.scrollIntoView({ block: 'nearest' }); }
}
function shownEntries(c) {
  const f = ENTRY_FILTERS.find((x) => x[0] === st.ef) || ENTRY_FILTERS[0];
  return (c.entries || []).filter(f[2]);
}
function renderEntries(box, c) {
  R.ehead = h('div', { class: 'adm-ehd' });
  R.emsg = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
  R.eadd = h('div', { class: 'adm-eadd' });
  R.elist = h('ol', { class: 'adm-elist', 'aria-label': 'Entries of #' + c.n });
  R.ebar = h('div', { class: 'adm-ebar', role: 'region', 'aria-label': 'Selected entries' });
  R.ebox = h('div', { class: 'adm-entries' }, R.ehead, R.eadd, R.emsg, R.elist, R.ebar);
  R.ebox.onkeydown = entryKeys;
  box.append(R.ebox);
  drawEntries();
}
function drawEntries() {
  const c = st.compFull;
  if (!c || !R.ebox || !R.ebox.isConnected) return;
  const es = c.entries || [];
  const had = document.activeElement && R.elist.contains(document.activeElement) && document.activeElement.classList.contains('adm-ecard');
  // the filters with their counts, and the places left
  R.ehead.textContent = '';
  const chips = h('div', { class: 'adm-efilters', role: 'group', 'aria-label': 'Show entries' });
  for (const [k, label, fn] of ENTRY_FILTERS) {
    const n = es.filter(fn).length;
    chips.append(h('button', { type: 'button', class: 'adm-ef' + (st.ef === k ? ' on' : ''), 'aria-pressed': String(st.ef === k), 'data-f': k, onclick: () => { st.ef = k; drawEntries(); } }, label, h('b', null, String(n))));
  }
  const okN = es.filter((e) => e.st === 'ok').length;
  const size = c.cfg.size;
  R.ehead.append(chips, h('div', { class: 'adm-meter', title: okN + ' of ' + size + ' places approved' },
    h('span', { class: 'adm-fl' }, 'Places left'), h('b', { class: 'adm-meterb' }, String(Math.max(0, size - okN))), h('span', { class: 'adm-meters' }, okN + ' / ' + size + ' approved'), bar(okN, size)));
  drawAdd(c);
  // the cards
  const list = shownEntries(c);
  for (const w of [...st.esel]) if (!es.some((e) => e.w === w)) st.esel.delete(w);
  if (st.efocus && !list.some((e) => e.w === st.efocus)) st.efocus = null;
  R.elist.textContent = '';
  if (!es.length) R.elist.append(h('li', { class: 'sq-empty' }, c.st === 'draft' ? 'Entries come in once sign-ups open.' : 'No entries yet.'));
  else if (!list.length) R.elist.append(h('li', { class: 'sq-empty' }, 'No entries under this filter.'));
  list.forEach((e, i) => R.elist.append(entryCard(c, e, i)));
  drawBar(c, list);
  if (had && st.efocus && !(st.eform && st.eform.w)) focusCard(st.efocus);
}
// selects or clears wallets in place: the cards keep their focus, only the bar is drawn again
function selectW(wallets, on) {
  for (const w of wallets) { if (on) st.esel.add(w); else st.esel.delete(w); }
  if (!on && st.eform && !st.eform.w && !st.esel.size) st.eform = null;
  for (const li of R.elist.querySelectorAll('.adm-ecard')) {
    const sel = st.esel.has(li.dataset.w);
    li.classList.toggle('sel', sel);
    const cb = li.querySelector('.adm-esel');
    if (cb) cb.checked = sel;
  }
  if (st.compFull) drawBar(st.compFull, shownEntries(st.compFull));
}
// the batch bar: N selected, the decisions the state allows, and the keys
function drawBar(c, list) {
  R.ebar.textContent = '';
  const n = st.esel.size;
  const all = h('input', { type: 'checkbox', class: 'adm-esel', 'aria-label': 'Select every entry shown' });
  all.checked = list.length > 0 && list.every((e) => st.esel.has(e.w));
  all.indeterminate = !all.checked && list.some((e) => st.esel.has(e.w));
  all.onchange = () => selectW(list.map((e) => e.w), all.checked);
  const wallets = [...st.esel];
  const review = ['open', 'closed'].includes(c.st);
  const playing = ['live', 'paused', 'done'].includes(c.st);
  const acts = h('div', { class: 'adm-row' });
  if (n && review) acts.append(
    btn('Approve ' + n, 'gold', () => decide(wallets, 'approve')),
    btn('Waitlist ' + n, '', () => decide(wallets, 'wait')),
    btn('Decline ' + n + '…', 'pink', () => openForm(null, 'decline')));
  if (n && playing) acts.append(btn('Disqualify ' + n + '…', 'pink', () => openForm(null, 'dq')), btn('Restore ' + n, '', () => decide(wallets, 'restore')));
  if (n && !review && !playing) acts.append(h('span', { class: 'adm-fine' }, 'No decisions while #' + c.n + ' is ' + c.st + '.'));
  if (n) acts.append(btn('Clear', '', () => { st.esel.clear(); st.eform = null; drawEntries(); }, { title: 'Clear the selection (Esc)' }));
  R.ebar.append(h('label', { class: 'adm-check adm-ball' }, all, h('span', { class: 'adm-ecount', 'aria-live': 'polite' }, n ? n + ' selected' : 'Select all shown')), acts,
    h('span', { class: 'adm-keys' }, 'Keys: j/k move · a approve · w waitlist · d decline · x select · Esc clear'));
  if (st.eform && !st.eform.w && n) R.ebar.append(decideForm(c, wallets, st.eform.kind));
  R.ebar.classList.toggle('on', n > 0);
  R.toastLift = n > 0;
  if (R.toast) {
    R.toast.classList.toggle('lift', n > 0);
    // the toast stands clear of the batch bar stuck to the bottom
    requestAnimationFrame(() => { if (R.ebar.isConnected) R.toast.style.setProperty('--adm-lift', (R.ebar.offsetHeight + 24) + 'px'); });
  }
}
// j/k move, a/w/d act on the focused card, x selects, Escape clears
function entryKeys(ev) {
  const t = ev.target;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (t && (t.matches('input:not([type=checkbox]),textarea,select') || t.isContentEditable || (R.eadd && R.eadd.contains(t)))) return;
  const c = st.compFull;
  if (!c) return;
  const cards = [...R.elist.querySelectorAll('.adm-ecard')];
  const i = cards.findIndex((x) => x.dataset.w === st.efocus);
  const k = ev.key;
  if (k === 'Escape') {
    if (st.eform || st.esel.size) { ev.preventDefault(); st.esel.clear(); st.eform = null; drawEntries(); if (st.efocus) focusCard(st.efocus); }
    return;
  }
  if (k === 'j' || k === 'k' || k === 'ArrowDown' && t.classList.contains('adm-ecard') || k === 'ArrowUp' && t.classList.contains('adm-ecard')) {
    if (!cards.length) return;
    ev.preventDefault();
    const n = i < 0 ? 0 : Math.max(0, Math.min(cards.length - 1, i + (k === 'j' || k === 'ArrowDown' ? 1 : -1)));
    for (const x of cards) x.tabIndex = -1;
    cards[n].tabIndex = 0;
    st.efocus = cards[n].dataset.w;
    cards[n].focus();
    cards[n].scrollIntoView({ block: 'nearest' });
    return;
  }
  if (!st.efocus || i < 0) return;
  if (k === 'x') { ev.preventDefault(); selectW([st.efocus], !st.esel.has(st.efocus)); }
  else if (k === 'a') { ev.preventDefault(); decide([st.efocus], 'approve'); }
  else if (k === 'w') { ev.preventDefault(); decide([st.efocus], 'wait'); }
  else if (k === 'd') { ev.preventDefault(); openForm(st.efocus, 'decline'); }
}
// Add by hand: the safety net for a burn the player could not send through, and giveaways
function drawAdd(c) {
  const can = ['open', 'closed'].includes(c.st);
  const keep = R.eaddD;
  if (keep && keep.isConnected && R.eadd.contains(keep) && R.eaddFor === c.code + c.st) return;
  R.eadd.textContent = '';
  R.eaddFor = c.code + c.st;
  if (!can) return;
  const wal = h('input', { class: 'sq-pfin', id: 'admAddW', autocomplete: 'off', spellcheck: 'false', placeholder: 'Wallet address' });
  const sig = h('input', { class: 'sq-pfin', id: 'admAddS', autocomplete: 'off', spellcheck: 'false', placeholder: 'Signature of the burn' });
  const free = h('input', { type: 'checkbox', id: 'admAddF' });
  const why = h('input', { class: 'sq-pfin', id: 'admAddR', maxlength: '200', autocomplete: 'off', placeholder: 'Why (in the log and the note)' });
  const out = h('div', { class: 'adm-verdictbox', 'aria-live': 'polite' });
  free.onchange = () => { sig.disabled = free.checked; if (free.checked) sig.value = ''; };
  const show = (ok, text) => { out.textContent = ''; out.append(h('p', { class: 'adm-verdict ' + (ok ? 'ok' : 'bad') }, text)); };
  // the competition as it stands now (the form outlives a decision or two)
  const cur = () => (st.compFull && st.compFull.code === c.code ? st.compFull : c);
  const check = async () => {
    const c = cur();
    const s = sig.value.trim();
    if (!s) { show(false, 'Paste a signature to check.'); return; }
    try {
      const v = await A.comps.verify(c.code, { sig: s, ...(ADDR_RE.test(wal.value.trim()) ? { wallet: wal.value.trim() } : {}) });
      show(v.ok, v.ok ? '✓ ' + (v.message || 'A final burn.') + (v.raw ? ' ' + uiAmount(v.raw, c.sup ? c.sup.dec : 6) + ' $BLUB' : '') : '✗ ' + (chainSay(v.code, v.message) || 'It did not pass.'));
    } catch (err) { show(false, '✗ ' + errSay(err)); }
  };
  const add = async () => {
    const c = cur();
    const w = wal.value.trim();
    if (!ADDR_RE.test(w)) { show(false, '✗ ' + ERR_SAYS.bad_wallet); wal.focus(); return; }
    if (!free.checked && !sig.value.trim()) { show(false, '✗ Paste the signature of the burn, or tick Free giveaway.'); sig.focus(); return; }
    if (!why.value.trim()) { show(false, '✗ Write why, for the log.'); why.focus(); return; }
    if (st.busy) return;
    st.busy = true;
    out.textContent = 'Working…';
    try {
      const r = await A.comps.addByHand(c.code, { wallet: w, ...(free.checked ? { free: true } : { sig: sig.value.trim() }), why: why.value.trim() });
      st.busy = false;
      const e = r.entry || {};
      show(true, '✓ Entered ' + nameOf(w) + ' by hand' + (e.b && e.b.ok ? ': burn verified, ' + uiAmount(e.b.raw, c.sup ? c.sup.dec : 6) + ' $BLUB at slot ' + e.b.slot + ', ' + btTxt(e.b.bt) + '.' : e.b ? ': the burn is recorded, not verified yet.' : ' as a free giveaway.'));
      wal.value = ''; sig.value = ''; why.value = ''; free.checked = false; sig.disabled = false;
      st.ef = 'all';
      st.efocus = w;
      await Promise.all([rereadEntries(), refresh()]);
      focusCard(w);
    } catch (err) {
      st.busy = false;
      show(false, '✗ ' + errSay(err));
    }
  };
  const fill = A.mode === 'local' ? btn('Use an example wallet', '', () => {
    const c = cur();
    const taken = new Set((c.entries || []).map((e) => e.w));
    const bans = new Set(((st.ov && st.ov.bans) || []).map((b) => b.id));
    const pool = Object.entries((st.ov && st.ov.who) || {}).filter(([id, x]) => !taken.has(id) && !bans.has(id) && daysOld(x.created) >= (c.cfg.minAge || 0));
    if (pool.length) { wal.value = pool[0][0]; wal.focus(); } else show(false, 'Every example wallet has entered already.');
  }) : null;
  R.eaddD = h('details', { class: 'adm-addhand' }, h('summary', null, 'Add by hand'),
    h('p', { class: 'sq-desc' }, 'For a player whose burn did not come through, or a giveaway. A signature gets the same check as a player’s entry; the wallet is entered approved and marked “by hand”.'),
    h('div', { class: 'adm-two' },
      h('label', { class: 'adm-field', for: 'admAddW' }, h('span', { class: 'adm-fl' }, 'Wallet'), wal),
      h('label', { class: 'adm-field', for: 'admAddS' }, h('span', { class: 'adm-fl' }, 'Signature (optional with Free giveaway)'), sig)),
    h('label', { class: 'adm-check', for: 'admAddF' }, free, 'Free giveaway (no burn)'),
    h('label', { class: 'adm-field', for: 'admAddR' }, h('span', { class: 'adm-fl' }, 'Reason'), why),
    h('div', { class: 'adm-row' }, btn('Add', 'gold', add), btn('Check signature', '', check, { title: 'Read it on the chain without entering anyone (0 database commands)' }), fill),
    A.mode === 'local' ? h('p', { class: 'adm-fine' }, 'Sandbox: the example signature demo-hand-1 is a good burn for any wallet; demo-used-1 was used already.') : null,
    out);
  R.eadd.append(R.eaddD);
}
/* ---- F4: Pool & bots, Lock & draw, Live, Results, Rewards, Post this ---- */
const TIER_NAME = { A: 'Strong', B: 'Medium', C: 'Weak' };
const TIER_PIPS = { A: 3, B: 2, C: 1 };
const DEF_MIX = { A: 30, B: 40, C: 30 };
// experiments take at most this share of the bot places (plan §9)
const X_MAX = 20;
const NEVER = 'We never DM links and never ask you to sign anything.';
// a strength rating's tier (the hall's cuts: 58 strong, 45 to 57 medium, under 45 weak)
export const tierOf = (pct) => (Number.isFinite(pct) ? (pct >= 58 ? 'A' : pct >= 45 ? 'B' : 'C') : null);
// the chance a bot finishes first, as an estimate: the bot places weighted 3/2/1 by tier
// (Strong, Medium, Weak) against the humans, who count as Medium (2) each
export function botChance(lineup, humans) {
  const W = { A: 3, B: 2, C: 1 };
  const bots = (lineup || []).reduce((s, L) => s + (L && L.deck !== null && L.deck !== undefined ? W[L.tier] || 2 : 0), 0);
  const all = bots + 2 * Math.max(0, humans | 0);
  return all > 0 ? Math.round((100 * bots) / all) : 0;
}
// the tiers of a mix over n bot places (each tier rounded, the rest to Weak)
export function mixCounts(mix, n) {
  const A_ = Math.round((n * (mix.A || 0)) / 100);
  const B_ = Math.min(n - A_, Math.round((n * (mix.B || 0)) / 100));
  return { A: A_, B: B_, C: Math.max(0, n - A_ - B_) };
}
// the table after some played days: 3 points a win, 1 a loss (none for a walkover lost),
// then the margin; the final table (with head-to-head and the coin) is the job's
export function tableFrom(ids, days) {
  const T = (ids || []).map((id, place) => ({ id, place, pts: 0, w: 0, l: 0, margin: 0 }));
  for (const D of days || []) {
    if (!D || !Array.isArray(D.r)) continue;
    for (const [, a, b, win, margin, wo] of D.r) {
      const W = T[win ? b : a];
      const L = T[win ? a : b];
      if (!W || !L) continue;
      W.pts += 3;
      W.w++;
      W.margin += margin | 0;
      L.l++;
      if (!wo) { L.pts += 1; L.margin -= margin | 0; }
    }
  }
  return T.filter((x) => x.id).sort((x, y) => y.pts - x.pts || y.margin - x.margin || y.w - x.w || x.place - y.place);
}
// what one day says: the leader after it, the upset (a win over the side that stood the
// most places higher before the day) and the closest match (the smallest margin)
export function dayStory(ids, days, d) {
  const before = d > 0 ? tableFrom(ids, days.slice(0, d)) : null;
  const after = tableFrom(ids, days.slice(0, d + 1));
  const D = days[d];
  if (!D) return null;
  const rank = new Map((before || []).map((x, i) => [x.place, i]));
  let upset = null;
  let closest = null;
  for (const [k, a, b, win, margin, wo] of D.r) {
    if (wo) continue;
    const wp = win ? b : a;
    const lp = win ? a : b;
    if (before) {
      const gap = (rank.get(wp) ?? 0) - (rank.get(lp) ?? 0);
      if (gap > 0 && (!upset || gap > upset.gap)) upset = { k, a, b, w: wp, l: lp, gap, margin };
    }
    if (!closest || margin < closest.margin) closest = { k, a, b, w: wp, l: lp, margin };
  }
  return { leader: after[0] || null, upset, closest };
}
// the Simulate line: the rule set, and the decks that break a squad rule, which play as
// they are (the squad rules are not played yet, as the rules sheet and SQUAD_RULES_SAY say)
export function simLine(rulesName, breaks) {
  return 'Two decks under these rules, in the arena view (0 commands): ' + rulesName + '. ' + (breaks.length ? breaks.join('; ') + ': squad rules are not played yet, so these decks play as they are, here and in a competition (which cannot open with squad rules). ' : '');
}
// a payment checked against what the record needs: the chain's facts (verify) and the
// amount, the kind and the wallet the competition asks for
export function payCheck(v, want) {
  if (!v) return { ok: false, code: 'not_final', message: 'Not checked yet.' };
  if (!v.ok) return { ok: false, code: v.code || 'not_final', message: v.message || '' };
  const need = BigInt(want.raw || '0');
  const raw = BigInt(v.raw || '0');
  if (want.kind === 'burn') {
    if (v.kind !== 'burn') return { ok: false, code: 'not_burn', message: 'That is not a burn: a bot won, so the prize is burned from the project wallet.' };
    if (want.project && v.signer && v.signer !== want.project) return { ok: false, code: 'not_yours', message: 'That burn was not made by the project wallet.' };
  } else {
    if (v.kind !== 'transfer') return { ok: false, code: 'not_transfer', message: 'That is not a transfer of $BLUB from the project wallet.' };
    if (want.to && v.to && v.to !== want.to) return { ok: false, code: 'not_yours', message: 'That transfer went to another wallet.' };
  }
  if (raw < need) return { ok: false, code: 'too_small', message: 'That moved less than the ' + (want.kind === 'refund' ? 'entry amount' : 'prize') + '.' };
  return { ok: true, code: null, message: v.message || '' };
}
// the bots' week, deck by deck: wins and losses and the margin against humans and
// against bots, from the played day records (walkovers are no fight and do not count)
export function botReport(c, days) {
  const L = (c && c.prv && c.prv.lineup) || [];
  const at = new Map(L.map((x) => [x.place, x]));
  const rows = new Map();
  for (const D of days || []) {
    if (!D || !Array.isArray(D.r)) continue;
    for (const [, a, b, win, margin, wo] of D.r) {
      if (wo) continue;
      for (const [me, foe, won] of [[a, b, win === 0], [b, a, win === 1]]) {
        if (!BOT_RE.test(D.ids[me] || '')) continue;
        const x = at.get(me);
        if (!x || x.deck === null || x.deck === undefined) continue;
        const key = String(x.deck);
        const R = rows.get(key) || { deck: key, tier: x.tier || null, x: !!x.x, places: [], plans: {}, hw: 0, hl: 0, bw: 0, bl: 0, hm: 0, bm: 0 };
        if (!R.places.includes(me)) R.places.push(me);
        const plan = (D.dk && D.dk[me]) || 'A';
        R.plans[plan] = (R.plans[plan] || 0) + 1;
        const m = (won ? 1 : -1) * (margin | 0);
        if (BOT_RE.test(D.ids[foe] || '')) { if (won) R.bw++; else R.bl++; R.bm += m; } else { if (won) R.hw++; else R.hl++; R.hm += m; }
        rows.set(key, R);
      }
    }
  }
  return [...rows.values()].sort((x, y) => Number(x.deck) - Number(y.deck) || (x.deck < y.deck ? -1 : 1));
}

// the deck library, read once for the steps that name decks (1 command)
const deckById = (id) => (st.decks || []).find((d) => String(d.id) === String(id)) || null;
async function ensureDecks() {
  if (st.decks || !A.decks || typeof A.decks.library !== 'function') return st.decks;
  try { st.decks = (await A.decks.library()).decks || []; } catch { st.decks = st.decks || null; }
  return st.decks;
}
const banned = () => new Set(((st.ov && st.ov.bans) || []).map((b) => b.id));
const paidOrFree = (e) => !!((e.b && e.b.ok) || e.free);
// the wallets the lock draws (approved, a verified burn or a free entry, not banned) and
// the approved ones that lapse there
const drawnOf = (c) => { const B = banned(); return (c.entries || []).filter((e) => e.st === 'ok' && paidOrFree(e) && !B.has(e.w)); };
const lapseOf = (c) => { const B = banned(); return (c.entries || []).filter((e) => e.st === 'ok' && (!paidOrFree(e) || B.has(e.w))); };
function pips(tier) {
  const n = TIER_PIPS[tier] || 0;
  return h('span', { class: 'adm-pips', role: 'img', 'aria-label': tier ? TIER_NAME[tier] : 'not rated', title: tier ? TIER_NAME[tier] : 'Not rated' }, ...[1, 2, 3].map((k) => h('i', { class: n >= k ? 'on t' + tier : '' })));
}
// a bot's tier in a competition: from the public places, else the lineup
const tierIn = (c, id) => { const p = (c.pub || []).find((x) => x.id === id); if (p && p.tier) return p.tier; const L = ((c.prv && c.prv.lineup) || []).find((x) => x.place === (c.pool || []).indexOf(id)); return (L && L.tier) || null; };
const botTag = (tier) => h('span', { class: 'lg-tag bot', title: 'A bot, not a player' }, 'Bot' + (tier ? ' · ' + TIER_NAME[tier] : ''), tier ? pips(tier) : null);
const s_ = (n, one, more) => n + ' ' + (n === 1 ? one : more || one + 's');
const decKey = (c) => (c.sup ? c.sup.dec : st.chain ? st.chain.dec : 6);
// a small action that changes the competition: one request, then the record and the
// overview read again; a refusal is said where the action was
async function compDo(msgEl, fn, done) {
  if (st.busy) return null;
  st.busy = true;
  say(msgEl, 'Working…');
  let r;
  try {
    r = await fn();
  } catch (e) {
    st.busy = false;
    if (e && e.code === 'stale') { await reread(); say(R.cmsg, ERR_SAYS.stale, false); }
    else say(msgEl && msgEl.isConnected ? msgEl : R.cmsg, errSay(e), false);
    return null;
  }
  st.busy = false;
  const text = typeof done === 'function' ? done(r) : done;
  await reread();
  if (text) toast(text, true);
  refresh();
  return r;
}
// a typed confirmation in its own place: the words, then the action
function typedBox(holder, label, want, detail, cls, go) {
  const from = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  const close = () => { holder.textContent = ''; back(from, '#admCompTitle'); };
  holder.textContent = '';
  const inp = h('input', { class: 'sq-pfin adm-typed-in', autocomplete: 'off', spellcheck: 'false', placeholder: want, 'aria-label': 'Type ' + want + ' to confirm' });
  const m = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
  const run = () => {
    if (inp.value.trim() !== want) { say(m, 'Refused: type ' + want + ' exactly to go on.', false); inp.select(); return; }
    holder.textContent = '';
    go(want);
  };
  inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } };
  holder.append(h('div', { class: 'adm-typed', role: 'group', 'aria-label': label, onkeydown: escTo(close) },
    detail ? h('p', { class: 'adm-state' }, detail) : null,
    h('label', { class: 'adm-field' }, h('span', { class: 'adm-fl' }, 'Type ' + want + ' to confirm'), inp),
    h('div', { class: 'adm-row' }, btn(label, cls === 'pink' ? 'pink' : 'gold', run), btn('Cancel', '', close), h('span', { class: 'adm-fine' }, 'Enter confirms, Esc cancels')), m));
  inp.focus();
}

/* ---- Pool & bots: the places, the bots' mix, swapping a bot's deck ---- */
function setMix(t, v) {
  const m = st.mix;
  const [o1, o2] = ['A', 'B', 'C'].filter((k) => k !== t);
  m[t] = Math.max(0, Math.min(100, v));
  const rest = 100 - m[t];
  const prev = m[o1] + m[o2];
  m[o1] = prev > 0 ? Math.round((rest * m[o1]) / prev / 5) * 5 : Math.round(rest / 10) * 5;
  m[o1] = Math.min(rest, m[o1]);
  m[o2] = rest - m[o1];
}
function placeCard(place, kind, ...kids) {
  return h('li', { class: 'adm-place ' + kind }, h('span', { class: 'adm-placen' }, String(place + 1)), ...kids);
}
function placeWallet(place, id, note) {
  const w = who(id);
  return placeCard(place, 'wallet', w ? face(w.look, w.style) : h('span', { class: 'adm-noface adm-face', 'aria-hidden': 'true' }),
    h('span', { class: 'adm-placeb' }, h('b', null, nameOf(id, w)), h('span', { class: 'lg-sub' }, h('span', { class: 'lg-addr', title: id }, short(id)), note ? h('span', null, note) : null)));
}
function placeBot(c, place, L, slot, id) {
  const d = L && L.deck !== null && L.deck !== undefined ? deckById(L.deck) : null;
  const tier = (L && L.tier) || (d && d.tier) || null;
  const bf = id ? who(id) : null;
  const kids = [bf ? face(bf.look, bf.style) : h('span', { class: 'adm-noface adm-face adm-botface', 'aria-hidden': 'true' }, 'BOT'),
    h('span', { class: 'adm-placeb' }, h('b', null, bf ? bf.name : L && L.deck ? 'Deck #' + L.deck : 'No deck yet'),
      h('span', { class: 'adm-placet' }, botTag(tier), L && L.x ? pill('Experiment', 'dim') : null),
      h('span', { class: 'lg-sub' }, d ? '#' + d.id + ' ' + d.n : L && L.deck ? 'Deck #' + L.deck : 'Fill with mix to give it a deck'))];
  if (slot !== null && slot !== undefined) {
    const sel = h('select', { class: 'adm-sel adm-swap', 'aria-label': 'Deck of bot place ' + (place + 1) });
    sel.append(h('option', { value: '' }, L && L.deck ? 'Swap deck…' : 'Pick a deck…'));
    for (const x of (st.decks || []).filter((q) => !q.retired && q.tier)) sel.append(h('option', { value: String(x.id) }, '#' + x.id + ' ' + x.n + ' · ' + TIER_NAME[x.tier] + (x.x ? ' · exp.' : '')));
    sel.onchange = () => {
      const x = deckById(sel.value);
      if (!x) return;
      compDo(R.poolMsg, () => A.comps.lineup(c.code, { do: 'swap', place: slot, deck: x.id, tier: x.tier, x: !!x.x }), 'Bot place ' + (place + 1) + ' plays deck #' + x.id + ' ' + x.n + '.');
    };
    kids.push(sel);
  }
  return placeCard(place, 'bot' + (L && L.x ? ' exp' : ''), ...kids);
}
function chanceLine(lineup, humans) {
  const pct = botChance(lineup, humans);
  return h('p', { class: 'adm-chance' }, h('b', null, pct + '%'), h('span', null, ' chance a bot finishes first (an estimate: bot places weighted 3/2/1 for Strong/Medium/Weak against ' + s_(humans, 'player') + ' counted as Medium). A bot that wins means the prize is burned.'));
}
function mixCard(c, need) {
  const outs = {};
  const sl = {};
  const plan = h('p', { class: 'lg-sub adm-mixplan' });
  const drawPlan = () => {
    const n = mixCounts(st.mix, need);
    const xs = Math.floor((need * st.xMax) / 100);
    plan.textContent = 'For ' + s_(need, 'bot place') + ': ' + n.A + ' Strong, ' + n.B + ' Medium, ' + n.C + ' Weak; at most ' + s_(xs, 'experiment') + '.';
  };
  const rows = ['A', 'B', 'C'].map((t) => {
    sl[t] = h('input', { type: 'range', class: 'adm-range', min: '0', max: '100', step: '5', value: String(st.mix[t]), 'aria-label': TIER_NAME[t] + ' bots, percent of the bot places' });
    outs[t] = h('b', { class: 'adm-mixv' }, st.mix[t] + '%');
    sl[t].oninput = () => {
      setMix(t, Number(sl[t].value));
      for (const k of ['A', 'B', 'C']) { sl[k].value = String(st.mix[k]); outs[k].textContent = st.mix[k] + '%'; }
      drawPlan();
    };
    return h('label', { class: 'adm-mixl' }, h('span', { class: 'adm-fl' }, pips(t), TIER_NAME[t]), sl[t], outs[t]);
  });
  const xs = h('input', { type: 'range', class: 'adm-range', min: '0', max: String(X_MAX), step: '5', value: String(st.xMax), 'aria-label': 'Experiments, at most this percent of the bot places' });
  const xo = h('b', { class: 'adm-mixv' }, st.xMax + '%');
  xs.oninput = () => { st.xMax = Number(xs.value); xo.textContent = st.xMax + '%'; drawPlan(); };
  drawPlan();
  const fill = btn('Fill with mix', 'gold', () => {
    if (!need) { say(R.poolMsg, 'Every place is a player: no bots needed.', true); return; }
    compDo(R.poolMsg, () => A.comps.lineup(c.code, { do: 'mix', mix: { ...st.mix }, xMax: st.xMax }), (r) => 'Lineup filled: ' + s_((r.lineup || []).length, 'bot') + '.');
  });
  return h('div', { class: 'adm-mix', role: 'group', 'aria-label': 'Bot mix' },
    h('div', { class: 'adm-mixs' }, ...rows, h('label', { class: 'adm-mixl' }, h('span', { class: 'adm-fl' }, 'Experiments, max'), xs, xo)),
    plan, h('div', { class: 'adm-row' }, fill, btn('Default mix', '', () => { st.mix = { ...DEF_MIX }; st.xMax = X_MAX; renderComp(); })));
}
function renderPool(box, c) {
  if (!st.decks) ensureDecks().then(() => { if (st.step === 'pool' && st.compFull && st.compFull.code === c.code) renderComp(); });
  const pre = (PHASE[c.st] || 0) < 2;
  const L = (c.prv && c.prv.lineup) || [];
  R.poolMsg = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
  const grid = h('ol', { class: 'adm-places', 'aria-label': 'Places of #' + c.n });
  if (pre) {
    const drawn = drawnOf(c);
    const lapse = lapseOf(c);
    const need = Math.max(0, c.cfg.size - drawn.length);
    const bots = L.slice(0, need);
    const xN = bots.filter((b) => b.x).length;
    addKids(box, h('p', { class: 'adm-state' }, c.cfg.size + ' places: ' + s_(drawn.length, 'wallet') + ' with a verified burn or a free entry, then ' + s_(need, 'bot place') + '.'),
      lapse.length ? h('p', { class: 'sq-desc' }, s_(lapse.length, 'approved entry', 'approved entries') + ' without a verified burn: ' + (lapse.length === 1 ? 'it lapses' : 'they lapse') + ' at the lock unless the burn checks out first (Entries).') : null,
      h('h4', null, 'Bot mix'), mixCard(c, need), chanceLine(bots, drawn.length), R.poolMsg);
    if (need && xN * 100 > need * X_MAX) box.append(h('p', { class: 'adm-state bad' }, s_(xN, 'experiment') + ' in ' + s_(need, 'bot place') + ': more than ' + X_MAX + '%. Fill with mix again or swap some.'));
    if (bots.length < need) box.append(h('p', { class: 'adm-state warn' }, (need - bots.length) + ' bot place' + (need - bots.length === 1 ? ' has' : 's have') + ' no deck yet: the lock fills ' + (need - bots.length === 1 ? 'it' : 'them') + ' from the default mix.'));
    drawn.forEach((e, i) => grid.append(placeWallet(i, e.w, e.free ? 'free entry' : 'burn verified')));
    for (let i = 0; i < need; i++) grid.append(placeBot(c, drawn.length + i, bots[i], i, null));
    box.append(h('h4', null, 'Places · players first, then bots (the lock shuffles them)'), grid);
    return;
  }
  // after the lock: the pool as it was drawn
  const at = new Map(L.map((x) => [x.place, x]));
  const tierOfId = Object.fromEntries((c.pub || []).map((p) => [p.id, p.tier]));
  const humans = (c.pool || []).filter((id) => id && !BOT_RE.test(id)).length;
  const drawnBots = (c.pool || []).map((id, p) => (BOT_RE.test(id || '') ? at.get(p) || { place: p, deck: null, tier: tierOfId[id] || null } : null)).filter(Boolean);
  box.append(h('p', { class: 'adm-state' }, 'Drawn at the lock: ' + s_(humans, 'player') + ' and ' + s_(drawnBots.length, 'bot') + ' in ' + c.pool.length + ' places.'), chanceLine(drawnBots, humans), R.poolMsg);
  c.pool.forEach((id, place) => {
    if (!id) grid.append(placeCard(place, 'empty', h('span', { class: 'adm-noface adm-face', 'aria-hidden': 'true' }), h('span', { class: 'adm-placeb' }, h('b', null, 'Empty'), h('span', { class: 'lg-sub' }, 'its matches are walkovers'))));
    else if (BOT_RE.test(id)) grid.append(placeBot(c, place, at.get(place) || { deck: null, tier: tierOfId[id] || null }, null, id));
    else grid.append(placeWallet(place, id));
  });
  box.append(h('h4', null, 'Places'), grid);
}

/* ---- Lock & draw ---- */
function renderLock(box, c) {
  const pre = (PHASE[c.st] || 0) < 2;
  const L = (c.prv && c.prv.lineup) || [];
  const drawn = pre ? drawnOf(c) : [];
  const need = pre ? Math.max(0, c.cfg.size - drawn.length) : 0;
  const salt = c.prv && c.prv.salt === 'set';
  const pool = c.pool || [];
  box.append(h('div', { class: 'adm-tiles adm-lsum' },
    tile('Entrants', String(pre ? drawn.length : pool.filter((id) => id && !BOT_RE.test(id)).length), h('span', null, pre ? 'approved, burn verified or free' : 'in the pool')),
    tile('Lapse', String(pre ? lapseOf(c).length : (c.counts && c.counts.lapsed) || 0), h('span', null, pre ? 'approved, no verified burn' : 'lapsed at the lock')),
    tile('Bots', String(pre ? need : pool.filter((id) => BOT_RE.test(id || '')).length), h('span', null, pre ? (L.length >= need ? 'decks from the lineup' : Math.min(need, L.length) + ' from the lineup, ' + (need - Math.min(need, L.length)) + ' from the default mix') : 'drawn')),
    tile('Salt', salt ? 'Set' : 'Not yet', h('span', null, pre ? (salt ? 'kept for the lock (re-roll before it)' : 'drawn at the lock') : 'secret; each day reveals its own')),
    tile('Hashes', String((c.com || []).length), h('span', null, (c.com || []).length ? 'day-salt hashes published' : 'the 7 are published at the lock'))));
  R.lockTyped = h('div', { class: 'adm-typedbox' });
  R.lockMsg = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
  const row = h('div', { class: 'adm-row' });
  if (c.st === 'open' || c.st === 'closed') {
    box.append(h('p', { class: 'sq-desc' }, 'Lock & draw takes the entrants above, fills the other places with bots from the lineup, shuffles the places with a secret salt and publishes the hashes of the seven day salts. Each day’s record reveals its salt, so anyone can check that nothing was rolled again.'));
    row.append(btn('Lock and draw…', 'gold', () => {
      if (dirty()) { say(R.lockMsg, 'Save or discard the changes in Setup first.', false); return; }
      if (squadRulesIn(st.base.rules)) { say(R.lockMsg, SQUAD_RULES_SAY, false); return; }
      typedBox(R.lockTyped, 'Lock and draw', 'LOCK ' + c.n, 'Locking #' + c.n + ' freezes the rules, the rewards, the terms and the times: ' + s_(drawn.length, 'player') + ' and ' + s_(need, 'bot') + ' are drawn, ' + s_(lapseOf(c).length, 'approved entry', 'approved entries') + ' lapse.', 'gold', (w) => doAct('lock', w));
    }));
  } else if (c.st === 'locked') {
    const early = Date.now() < Date.parse(c.win.start);
    box.append(h('p', { class: 'adm-state' }, 'Locked and drawn. Day 0 starts ' + until(c.win.start) + '.'));
    row.append(sureBtn('Unlock', '', () => doAct('unlock'), 'Back to closed?'));
    if (!early) row.lastChild.disabled = true;
    row.append(h('span', { class: 'adm-fine' }, early ? 'Unlock puts #' + c.n + ' back to closed (before day 0 only): the places and hashes go, the lapsed entries are approved again.' : 'Day 0 has started: no unlock.'));
  } else box.append(h('p', { class: 'adm-state' }, (PHASE[c.st] || 0) >= 2 ? 'Locked and drawn.' : 'The lock comes after sign-ups (#' + c.n + ' is a ' + c.st + ').'));
  box.append(row, R.lockTyped, R.lockMsg);
  if (c.com && c.com.length) {
    box.append(h('h4', null, 'Day-salt hashes (published at the lock)'),
      h('ol', { class: 'adm-hashes' }, ...c.com.map((x, d) => h('li', null, h('b', null, DAY_NAMES[d] + ' · day ' + d), h('code', { title: x }, x.length > 20 ? x.slice(0, 12) + '…' + x.slice(-8) : x), copyBtn(x, 'Copy the hash of day ' + d)))),
      h('div', { class: 'adm-row' }, btn('Copy all 7', '', () => copyText(c.com.map((x, d) => DAY_NAMES[d] + ' ' + x).join('\n'), 'The seven hashes are copied.'))));
  }
}
function copyText(text, done) {
  try { navigator.clipboard.writeText(text).then(() => toast(done || 'Copied.', true), () => toast('The clipboard is blocked here: select the text and copy it.', false)); } catch { toast('The clipboard is blocked here.', false); }
}

/* ---- Live: day tabs, the table, the matches with Watch, pause, disqualify ---- */
// the played days of a competition (each 1 command on the server, cached a day; kept here)
async function loadDays(c) {
  const out = [];
  for (let d = 0; d < 7; d++) {
    const key = c.code + ':' + d;
    if (!st.dayCache.has(key) && c.played && c.played[d]) {
      try { st.dayCache.set(key, await A.comps.day(c.code, d)); } catch { /* not there yet */ }
    }
    out.push(st.dayCache.get(key) || null);
  }
  return out;
}
const dayDate = (c, d) => { const t = Date.parse(c.win.start) + d * DAY; return t > 0 ? new Date(t).getUTCDate() + ' ' + new Date(t).toUTCString().slice(8, 11) : ''; };
const lastPlayed = (c) => (c.played || []).lastIndexOf(true);
function renderLive(box, c) {
  if (c.cfg.e !== C.E.SQUAD_ENGINE && ['locked', 'live', 'paused'].includes(c.st)) {
    box.append(h('div', { class: 'adm-banner' }, h('span', null, 'Engine changed: #' + c.n + ' was pinned to engine ' + c.cfg.e + ', the page runs ' + C.E.SQUAD_ENGINE + '. The daily run waits until you accept it.'), btn('Accept engine ' + C.E.SQUAD_ENGINE + ' for the remaining days', 'gold', () => doAct('engine'))));
  }
  R.liveMsg = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
  const row = h('div', { class: 'adm-row' });
  if (c.st === 'live') row.append(btn('Pause', '', () => doAct('pause'), { title: 'The daily run plays no day while paused' }));
  if (c.st === 'paused') row.append(btn('Resume', 'gold', () => doAct('resume')));
  const next = (c.played || []).indexOf(false);
  if (A.sandbox && typeof A.sandbox.playDay === 'function' && ['locked', 'live'].includes(c.st) && next >= 0) {
    row.append(btn('Play day ' + next + ' now', '', () => compDo(R.liveMsg, () => A.sandbox.playDay(c.code), (r) => { st.day = r.day; return 'Day ' + r.day + ' of #' + c.n + ' is played' + (r.day === 6 ? ': the final table is in.' : '.'); }), { title: 'Sandbox: plays the next day as the daily run would' }),
      h('span', { class: 'adm-fine' }, 'Sandbox clock: the daily run plays day ' + next + ' at once.'));
  }
  box.append(row, R.liveMsg);
  if (!(c.pool && c.pool.some(Boolean))) { box.append(h('p', { class: 'sq-desc' }, 'Nothing is drawn yet: Lock & draw first. The daily run then plays ' + perDay(c.cfg.size) + ' rounds a day from day 0.')); return; }
  if (st.day === null || st.day === undefined || st.day < 0 || st.day > 6) st.day = Math.max(0, lastPlayed(c));
  const tabs = h('div', { class: 'adm-days', role: 'tablist', 'aria-label': 'Days of #' + c.n });
  for (let d = 0; d < 7; d++) {
    const p = !!(c.played && c.played[d]);
    const b = h('button', { type: 'button', role: 'tab', class: 'adm-day' + (p ? ' played' : '') + (d === st.day ? ' on' : ''), 'aria-selected': String(d === st.day), id: 'admDay-' + d, title: p ? 'Played' : 'Not played yet' },
      h('b', null, DAY_NAMES[d]), h('span', null, 'Day ' + d + (dayDate(c, d) ? ' · ' + dayDate(c, d) : '')), h('i', { 'aria-hidden': 'true' }));
    b.onclick = () => { st.day = d; renderComp(); const t = document.getElementById('admDay-' + d); if (t) t.focus(); };
    tabs.append(b);
  }
  R.liveBanner = h('div');
  R.liveTable = h('ol', { class: 'sq-top sq-league adm-table', 'aria-label': 'Table of #' + c.n });
  R.dayBox = h('div', { class: 'adm-matches' });
  R.dqForm = h('div', { class: 'adm-typedbox' });
  box.append(h('div', { class: 'adm-daysw' }, tabs), R.liveBanner, h('div', { class: 'adm-live' }, h('section', { class: 'adm-livet', 'aria-labelledby': 'admLiveT' }, h('h4', { id: 'admLiveT' }, 'Table'), R.dqForm, R.liveTable), h('section', { class: 'adm-livem', 'aria-labelledby': 'admLiveM' }, h('h4', { id: 'admLiveM' }, DAY_NAMES[st.day] + ' · day ' + st.day), R.dayBox)));
  R.liveTable.append(h('li', { class: 'sq-empty' }, 'Loading the days…'));
  loadLive(c);
}
async function loadLive(c) {
  const days = await loadDays(c);
  if (st.compFull !== c || st.step !== 'live' || !R.liveTable || !R.liveTable.isConnected) return;
  const upTo = c.played && c.played[st.day] ? st.day : lastPlayed(c);
  const rows = upTo >= 0 ? tableFrom(c.pool, days.slice(0, upTo + 1)) : c.pool.map((id, place) => ({ id, place, pts: 0, w: 0, l: 0, margin: 0 })).filter((x) => x.id);
  R.liveBanner.textContent = '';
  if (rows[0] && BOT_RE.test(rows[0].id) && upTo >= 0) R.liveBanner.append(h('p', { class: 'adm-banner bot' }, 'A bot leads. If it finishes first, the prize is burned.'));
  const dq = new Set((c.entries || []).filter((e) => e.st === 'dq').map((e) => e.w));
  drawTable(R.liveTable, c, rows, { live: ['live', 'paused', 'done'].includes(c.st), dq, after: upTo });
  drawDay(c, days, st.day);
}
// the table: rank chips (gold, silver, bronze), the Blub, who it is (BOT · tier, YOU),
// points and W–L; a divider under the top 10
function drawTable(ol, c, rows, o) {
  ol.textContent = '';
  const tierOfId = Object.fromEntries((c.pub || []).map((p) => [p.id, p.tier]));
  const at = new Map(((c.prv && c.prv.lineup) || []).map((x) => [x.place, x]));
  ol.append(h('li', { class: 'lg-head', 'aria-hidden': 'true' }, h('span', null, '#'), h('span'), h('span', null, o.final ? 'Final' : o.after >= 0 ? 'After ' + DAY_NAMES[o.after] : 'Before day 0'), h('span', null, 'Points')));
  rows.forEach((r, i) => {
    const rank = o.final ? r.place : i + 1;
    const bot = BOT_RE.test(r.id);
    const w = who(r.id);
    const isDq = o.dq && o.dq.has(r.id);
    const place = c.pool ? c.pool.indexOf(r.id) : -1;
    const L = at.get(place);
    const d = L ? deckById(L.deck) : null;
    const top = h('span', { class: 'lg-name' }, h('b', { class: !bot && !(w && w.player) ? 'lg-addr' : '', title: r.id }, nameOf(r.id, w)));
    if (bot) top.append(botTag(tierOfId[r.id] || (L && L.tier) || null));
    if (r.id === C.me()) top.append(h('span', { class: 'lg-tag you' }, 'You'));
    if (isDq) top.append(pill('Disqualified', 'bad'));
    const sub = bot ? [h('span', null, d ? 'deck #' + d.id + ' ' + d.n : L && L.deck ? 'deck #' + L.deck : 'a bot')] : [h('span', { class: 'lg-addr', title: r.id }, short(r.id)), copyBtn(r.id), w ? h('span', { class: 'lg-cap' }, 'Blub ' + w.name) : null];
    if (r.tie) sub.push(h('span', { class: 'adm-tie' }, 'tie: ' + TIE_SAYS[r.tie]));
    const li = h('li', { class: 'lg-row' + (r.id === C.me() ? ' me' : '') + (isDq ? ' dq' : '') },
      h('span', { class: 'rk' + (rank <= 3 ? ' r' + rank : '') }, String(rank)),
      w ? face(w.look, w.style) : h('span', { class: 'sq-noface', 'aria-hidden': 'true' }),
      h('span', { class: 'lg-who' }, top, h('span', { class: 'lg-sub' }, ...sub)),
      h('span', { class: 'lg-pts', title: r.w + ' won, ' + r.l + ' lost, margin ' + r.margin }, h('b', null, String(r.pts)), h('small', null, r.w + '–' + r.l + (o.final ? ' · ' + (r.margin > 0 ? '+' : '') + r.margin : ''))));
    if (o.live && !bot) li.append(isDq ? sureBtn('Restore', 'adm-mini', () => dqDo(c, r.id, 'restore'), 'Restore?') : btn('Disqualify', 'adm-mini pink', () => dqOpen(c, r.id)));
    ol.append(li);
    if (rank === 10 && rows.length > 10) ol.append(h('li', { class: 'lg-zone up', 'aria-hidden': 'true' }, 'Top 10 · the top-10 reward'));
  });
}
const TIE_SAYS = { h2h: 'head-to-head', margin: 'total margin', coin: 'the salted coin' };
function dqOpen(c, w) {
  const holder = R.dqForm;
  holder.textContent = '';
  const why = h('textarea', { class: 'sq-pfin adm-area', maxlength: '140', rows: '2', placeholder: 'Why (the player sees this)', 'aria-label': 'Why (the player sees this)' });
  const m = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
  const after = c.st === 'done';
  const dc = dqConfirm(c);
  const go = () => {
    if (dc && !dc.ok()) { say(m, 'Refused: type ' + dc.want + ' exactly to go on.', false); dc.inp.select(); dc.inp.focus(); return; }
    dqDo(c, w, 'dq', why.value.trim(), m, dc ? dc.want : '');
  };
  if (dc) dc.inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
  holder.append(h('div', { class: 'adm-eform', role: 'group', 'aria-label': 'Disqualify ' + nameOf(w) },
    h('b', { class: 'adm-eft' }, 'Disqualify ' + nameOf(w)),
    h('p', { class: 'adm-fine' }, after ? 'After the final: the places stay as they are, they get no rewards, and a disqualified winner is treated like a bot win (the prize is burned, not paid).' : 'From the next day on, every match of theirs is a walkover for the other side.'),
    h('label', { class: 'adm-field' }, h('span', { class: 'adm-fl' }, 'Reason the player sees'), why),
    dc ? dc.el : null,
    h('div', { class: 'adm-row' }, btn('Disqualify', 'pink', go), btn('Cancel', '', () => { holder.textContent = ''; })), m));
  why.focus();
}
async function dqDo(c, w, act, why, m, confirm) {
  const r = await compDo(m || R.liveMsg, () => A.comps.decide(c.code, { do: act, wallets: [w], v: st.compFull.v, ...(why ? { why } : {}), ...(confirm ? { confirm } : {}) }), (x) => (x && x.changed === 0 ? 'Nothing changed.' : (act === 'dq' ? 'Disqualified ' : 'Restored ') + nameOf(w) + '.' + burnSay(x)));
  if (r && R.dqForm) R.dqForm.textContent = '';
}
// a day's matches, round by round: who won and by how much, walkovers and auto-fixes, Watch
function drawDay(c, days, d) {
  const box = R.dayBox;
  box.textContent = '';
  const D = days[d];
  if (!D) {
    const t = Date.parse(c.win.start) + d * DAY;
    box.append(h('p', { class: 'sq-desc' }, c.st === 'paused' ? 'Paused: day ' + d + ' waits until #' + c.n + ' is resumed.' : 'Day ' + d + ' is not played yet. The daily run plays it just after midnight UTC' + (t > 0 ? ' on ' + day(new Date(t).toISOString()).slice(0, -6) : '') + ': ' + perDay(c.cfg.size) + ' rounds.'));
    return;
  }
  const fx = D.fx || {};
  const rounds = [...new Set(D.r.map((x) => x[0]))];
  const can = D.e === C.E.SQUAD_ENGINE;
  if (!can) box.append(h('p', { class: 'adm-state warn' }, 'Played on engine ' + D.e + ': the page runs ' + C.E.SQUAD_ENGINE + ', so a replay may end differently.'));
  box.append(h('p', { class: 'lg-sub adm-dsalt' }, 'Day salt ' + (D.s ? String(D.s).slice(0, 12) + '…' : '?') + ' · ' + s_(rounds.length, 'round') + ' · ' + s_(D.r.length, 'match', 'matches')));
  for (const k of rounds) {
    const ul = h('ul', { class: 'adm-mlist' });
    for (const [kk, a, b, win, margin, wo] of D.r) {
      if (kk !== k) continue;
      const A_ = D.ids[a];
      const B_ = D.ids[b];
      const side = (p, id) => {
        const won = (win ? b : a) === p;
        const w = who(id);
        return h('span', { class: 'adm-mside' + (won ? ' won' : '') }, w ? face(w.look, w.style) : h('span', { class: 'sq-noface', 'aria-hidden': 'true' }), h('b', null, id ? nameOf(id, w) : 'Empty'),
          BOT_RE.test(id || '') ? pips(tierIn(c, id)) : null, fx[p] && fx[p].length ? pill('auto-fixed', 'warn') : null);
      };
      const li = h('li', { class: 'adm-match' + (wo ? ' wo' : '') }, side(a, A_), h('span', { class: 'adm-mvs' }, wo ? 'w/o' : 'vs'), side(b, B_),
        h('span', { class: 'adm-mres' }, wo ? 'walkover for ' + nameOf(win ? B_ : A_) : nameOf(win ? B_ : A_) + ' by ' + margin + ' HP'),
        wo ? null : btn('Watch', 'adm-mini', () => watchMatch(c, D, k, a, b), can ? { title: 'The match again in the arena: the same squads and seed' } : { title: 'Played on another engine: the replay may end differently' }));
      if (fx[a] || fx[b]) li.title = 'Auto-fixed to the rules: ' + [...(fx[a] || []), ...(fx[b] || [])].map((f) => (typeof f === 'string' ? f : f.id || f.part || '')).join(', ');
      ul.append(li);
    }
    // the rounds fold (the first one open), so a day of 85 matches stays short on a phone
    box.append(h('details', { class: 'adm-mround', open: k === rounds[0] }, h('summary', null, 'Round ' + (k + 1) + ' · ' + s_(ul.children.length, 'match', 'matches') + ' · ' + s_([...ul.children].filter((x) => x.classList.contains('wo')).length, 'walkover')), ul));
  }
}
// one match's seed, as the daily run works it out (lib/compday.mjs matchSeed): the day's
// salt, the competition's group (friendGroup of 'comp|<code>'), the round and the two
// places; one seed a day when the arena's seed mode says so. The owner's fixed seed is
// the arena's only (compArena): the fight draws from the match's own seed.
export function compSeed(E, s, code, arena, k, a, b) {
  const g = E.friendGroup('comp|' + code);
  const mode = arena && arena.seedMode;
  if (mode === 'day') return E.leagueSeed(s, g, 0, 0, 1);
  return E.leagueSeed(s, g, k, a, b);
}
// the arena a match plays (lib/compday.mjs matchArena): the stored one, plus mapSeed (the
// map, the sky and the power-up) from the owner's seed in the fixed seed mode
export function compArena(arena) {
  if (!arena || typeof arena !== 'object') return arena || null;
  return arena.seedMode === 'fixed' && Number.isInteger(arena.seed) ? { ...arena, mapSeed: arena.seed >>> 0 } : arena;
}
// one match of a day again in the arena: the day's squads and faces, the seed of the match
// (leagueSeed of the day salt, the competition's group, the round and the two places), the
// same way the hall replays a league day
function matchOf(c, D, k, a, b) {
  const team = (place) => {
    const id = D.ids[place];
    const bot = BOT_RE.test(id || '') ? who(id) : null;
    const faces = (D.t && D.t[place]) || (bot ? [bot, bot, bot, bot, bot] : null) || [0, 1, 2, 3, 4].map(() => ({ name: 'Blub', look: null }));
    return { label: id ? nameOf(id) : 'Empty', names: faces.map((f) => f.name), looks: faces.map((f) => f.look), squad: D.sq[place] || null };
  };
  const day_ = D.d !== undefined ? D.d : st.day;
  // the day's arena (o) carries the engine's rules the job played it with
  const rules = C.E.cleanRules(compArena(D.o) || {});
  return { kind: 'league', title: '#' + c.n + ' · ' + DAY_NAMES[day_] + ' · round ' + (k + 1) + ' · ' + nameOf(D.ids[a]) + ' vs ' + nameOf(D.ids[b]), teams: [team(a), team(b)], viewer: -1, seed: compSeed(C.E, D.s, c.code, D.o, k, a, b), bo: 1, ...(Object.keys(rules).length ? { rules } : {}) };
}
function watchMatch(c, D, k, a, b) {
  const m = matchOf(c, D, k, a, b);
  if (!m.teams[0].squad || !m.teams[1].squad) { toast('That day record has no squads to replay.', false); return; }
  m.share = () => watchShare(m);
  C.View.play(m);
}
// a match as a #watch link (the hall's own format: SquadHall packMatch, WATCH_V 1), where
// the page has links; else the code alone
const b64u = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
async function packWatch(m) {
  const clean = (q) => C.E.cleanSquad(q) || q;
  const side = (t) => ({ l: t.label, n: t.names, k: t.looks, q: clean(t.squad) });
  // (the hall's format: r, the match's rules, only when it has any)
  const rules = C.E.cleanRules(m.rules);
  const raw = new TextEncoder().encode(JSON.stringify({ v: 1, e: C.E.SQUAD_ENGINE, t: m.title, bo: 1, s: m.seed, a: side(m.teams[0]), b: side(m.teams[1]), ...(Object.keys(rules).length ? { r: rules } : {}) }));
  try {
    if (typeof CompressionStream === 'function') return 'z' + b64u(new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()));
  } catch { /* plain then */ }
  return 'j' + b64u(raw);
}
async function watchShare(m) {
  const code = await packWatch(m);
  return { code, url: typeof C.watchLink === 'function' ? C.watchLink(code) : null, title: m.title };
}

/* ---- Results: the final table, the payout or the prize burn, the refunds ---- */
const SIG_OK = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
// what the record of a payment needs: the kind, the amount, the wallet
function payWant(c, kind, wallet) {
  const am = amountsOf(c, c.cfg);
  const proj = st.chain && st.chain.projectWallet;
  if (kind === 'refund') {
    const e = (c.entries || []).find((x) => x.w === wallet);
    return { kind, raw: (e && e.b && e.b.raw) || (am ? am.entry : '0'), to: wallet, project: proj };
  }
  return { kind, raw: am ? am.prize : '0', to: kind === 'payout' ? c.res.winner : null, project: proj };
}
function recLine(rec, dec) {
  const ok = rec.ok !== false && rec.verified !== false;
  return h('span', { class: 'adm-verdict ' + (ok ? 'ok' : 'warn') }, (ok ? '✓ Recorded and verified: ' : '! Recorded unverified: ') + (rec.raw ? uiAmount(rec.raw, dec) + ' $BLUB' : 'amount not read') + (rec.to ? ' to ' + short(rec.to) : '') + ' · ' + (rec.sig.length > 16 ? rec.sig.slice(0, 8) + '…' + rec.sig.slice(-6) : rec.sig) + (rec.t ? ' · ' + ago(rec.t) : '') + (!ok && rec.why ? ' · ' + (chainSay(rec.why) || rec.why) : ''));
}
// the money form: a signature, Check (0 commands, 1 RPC), Record (green) or Record
// unverified (amber), each after the typed PAY <n>; an amber record has Verify again
function payForm(c, kind, wallet, rec) {
  const key = kind + ':' + (wallet || '');
  const want = payWant(c, kind, wallet);
  const dec = decKey(c);
  const box = h('div', { class: 'adm-payf' });
  const sig = h('input', { class: 'sq-pfin adm-sigin', autocomplete: 'off', spellcheck: 'false', placeholder: 'Transaction signature', 'aria-label': (kind === 'refund' ? 'Signature of the refund to ' + short(wallet) : kind === 'burn' ? 'Signature of the prize burn' : 'Signature of the payout') });
  if (rec && rec.ok === false) sig.value = rec.sig;
  const out = h('p', { class: 'adm-verdict', 'aria-live': 'polite' });
  const typed = h('div', { class: 'adm-typedbox' });
  const show = (pc) => {
    out.className = 'adm-verdict ' + (pc.ok ? 'ok' : 'bad');
    out.textContent = pc.ok ? '✓ It checks out: ' + (pc.raw ? uiAmount(pc.raw, dec) + ' $BLUB' : '') + (pc.to ? ' to ' + short(pc.to) : '') + (pc.bt ? ' · ' + btTxt(pc.bt) : '') + '. Record it.' : '✗ ' + (chainSay(pc.code, pc.message) || 'It does not check out.') + ' You can still record it unverified (amber) and verify it again later.';
  };
  const check = async () => {
    const s = sig.value.trim();
    if (!s) { say(out, 'Paste the signature first.', false); sig.focus(); return null; }
    if (A.mode === 'server' && !SIG_OK.test(s)) { say(out, ERR_SAYS.bad_sig, false); return null; }
    say(out, 'Checking on the chain…');
    let v;
    try { v = await A.comps.verify(c.code, { sig: s, wallet: kind === 'burn' ? want.project || undefined : want.to || undefined }); } catch (e) { v = { ok: false, code: e && e.code, message: errSay(e) }; }
    const pc = { ...payCheck(v, want), raw: v.raw, to: v.to, bt: v.bt };
    st.payV[key] = { sig: s, ...pc };
    show(pc);
    return pc;
  };
  const record = (unverified) => {
    const s = sig.value.trim();
    if (!s) { say(out, 'Paste the signature first.', false); sig.focus(); return; }
    const v = st.payV[key];
    if (!unverified && !(v && v.sig === s && v.ok)) { say(out, 'Check it first: only a signature that checks out is recorded green.', false); return; }
    typedBox(typed, unverified ? 'Record unverified' : 'Record', 'PAY ' + c.n, (unverified ? 'Recorded amber: the chain did not confirm it. ' : '') + (kind === 'refund' ? 'The refund to ' + nameOf(wallet) : kind === 'burn' ? 'The prize burn of #' + c.n : 'The payout of #' + c.n + ' to ' + nameOf(want.to)) + ', signature ' + (s.length > 16 ? s.slice(0, 8) + '…' + s.slice(-6) : s) + '.', unverified ? 'pink' : 'gold',
      (confirm) => compDo(out, () => A.comps.pay(c.code, { kind, sig: s, ...(wallet ? { wallet } : {}), ...(unverified ? { unverified: true } : {}), confirm }), (r) => {
        const ok = r && (r.verified !== undefined ? r.verified : r.pay && r.pay.ok);
        return (kind === 'refund' ? 'Refund to ' + nameOf(wallet) : kind === 'burn' ? 'Prize burn' : 'Payout') + ' recorded' + (ok ? ' and verified.' : ' unverified (amber).');
      }));
  };
  sig.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); check(); } };
  const again = rec && rec.ok === false ? btn('Verify again', 'gold', async () => {
    sig.value = rec.sig;
    const pc = await check();
    if (pc && pc.ok) record(false);
  }) : null;
  box.append(h('div', { class: 'adm-row adm-sigrow' }, sig, btn('Check', '', check, { title: 'Read it on the chain (0 database commands)' })),
    h('div', { class: 'adm-row' }, again, btn('Record', 'gold', () => record(false)), btn('Record unverified', 'adm-amber', () => record(true), { title: 'When the chain cannot confirm it now: kept amber, with Verify again' })),
    out, typed);
  const v = st.payV[key];
  if (v && v.sig === sig.value.trim()) show(v);
  return box;
}
function moneyRow(label, text, copy, copyLabel) {
  return h('div', { class: 'adm-mrow' }, h('span', { class: 'adm-fl' }, label), h('span', { class: 'adm-mval', title: copy || text }, text), copy ? copyBtn(copy, copyLabel) : null);
}
// why the prize is burned: a bot first, or a winner disqualified (in the final or after it)
const burnWhy = (c) => (c.res && c.res.winner && !BOT_RE.test(c.res.winner) ? (banned().has(c.res.winner) ? 'The winner is banned' : 'The winner is disqualified') : 'A bot finished first');
function payCard(c) {
  const dec = decKey(c);
  const burn = prizeBurnt(c, banned());
  const kind = burn ? 'burn' : 'payout';
  const want = payWant(c, kind);
  const rec = c.pay && c.pay[kind];
  const amt = want.raw ? uiAmount(want.raw, dec) : '?';
  const mint = (st.chain && st.chain.mint) || C.mint || '';
  const proj = want.project || '';
  const card_ = h('div', { class: 'adm-paycard ' + (rec ? (rec.ok === false ? 'amber' : 'ok') : 'due') });
  addKids(card_, h('b', { class: 'adm-payh' }, burn ? 'Burn ' + amt + ' $BLUB' : 'Send ' + amt + ' $BLUB from the project wallet to ' + nameOf(want.to)),
    h('p', { class: 'sq-desc' }, burn ? burnWhy(c) + ', so the whole prize is burned from the project wallet, by hand in your own wallet app. Then paste the signature here.' : 'Send it by hand from the project wallet in your own wallet app (the panel never sends anything), then paste the signature here.'),
    moneyRow('Amount', amt + ' $BLUB', want.raw ? uiAmount(want.raw, dec).replace(/\s/g, '') : '', 'Copy the amount'),
    want.raw ? moneyRow('Raw', want.raw, want.raw, 'Copy the raw amount') : null,
    mint ? moneyRow('Mint', short(mint), mint, 'Copy the mint address') : null,
    !burn ? moneyRow('To', nameOf(want.to) + ' · ' + short(want.to), want.to, 'Copy the winner’s wallet') : null,
    proj ? moneyRow('From', 'project wallet · ' + short(proj), proj, 'Copy the project wallet') : null);
  if (rec) addKids(card_, recLine(rec, dec), SIG_OK.test(rec.sig) ? h('a', { class: 'adm-soc', href: 'https://solscan.io/tx/' + encodeURIComponent(rec.sig), target: '_blank', rel: 'noopener noreferrer' }, 'Solscan ↗') : null);
  if (!rec || rec.ok === false) card_.append(c.st === 'done' || (rec && rec.ok === false) ? payForm(c, kind, null, rec) : h('p', { class: 'adm-state' }, 'Recorded once #' + c.n + ' is done.'));
  if (A.mode === 'local') card_.append(h('p', { class: 'adm-fine' }, 'Sandbox: demo-' + (burn ? 'burn' : 'pay') + '-' + c.n + ' is the ' + (burn ? 'prize burn' : 'payout') + ' of #' + c.n + ' on its example chain; any other text reads as not on the chain.'));
  return card_;
}
function renderResults(box, c) {
  if (!(c.res && c.res.table)) {
    box.append(h('p', { class: 'sq-desc' }, c.st === 'void' ? '#' + c.n + ' was voided: no table. Paid entries are on the refund list.' : 'The final table comes after day 6 is played.'));
    refundList(box, c);
    return;
  }
  if (!st.decks) ensureDecks();
  if (nobodyWon(c)) {
    box.append(h('p', { class: 'sq-desc' }, 'Nobody played #' + c.n + ': the final table has no winner, so no prize is paid out or burned. Record the refunds owed below, then archive it.'));
    refundList(box, c);
    return;
  }
  const dq = new Set((c.entries || []).filter((e) => e.st === 'dq').map((e) => e.w));
  const burnt = prizeBurnt(c, banned());
  box.append(h('h4', null, 'Final table' + (burnt ? ' · ' + (burnWhy(c) === 'A bot finished first' ? 'a bot won' : burnWhy(c).replace('The winner', 'the winner')) + ': the prize is burned' : '')));
  if (burnt) box.append(h('p', { class: 'adm-banner bot' }, burnWhy(c) + ': the whole prize is burned, and nobody gets the winner’s reward.'));
  const ol = h('ol', { class: 'sq-top sq-league adm-table final', 'aria-label': 'Final table of #' + c.n });
  drawTable(ol, c, c.res.table, { final: true, dq, live: false });
  box.append(ol);
  const ties = c.res.ties || [];
  if (ties.length) box.append(h('ul', { class: 'adm-ties' }, ...ties.map((t) => h('li', null, t.ids.map((id) => nameOf(id)).join(', ') + ' tied on points: ' + TIE_SAYS[t.by] + ' decided.'))));
  box.append(h('p', { class: 'adm-fine' }, 'Tie-breaks, as in the terms: points, then head-to-head among the tied, then the total margin, then a salted coin.'));
  box.append(h('h4', null, burnt ? 'Prize burn' : 'Payout'), payCard(c));
  refundList(box, c);
}
// the refund list: declined or voided entries that paid, each due back from the project
// wallet by hand, each with its own signature field
// (the server keeps only the records in pay.refunds; who is owed one follows from the entries,
// as ADMIN_PAY checks it: refundDue)
function refundList(box, c) {
  const recs = (c.pay && c.pay.refunds) || {};
  const owed = (c.entries || []).filter((e) => refundDue(c, e)).map((e) => e.w);
  const due = [...new Set([...Object.keys(recs), ...owed])].map((w) => [w, recs[w] || null]);
  if (!due.length) return;
  const dec = decKey(c);
  const ol = h('ol', { class: 'adm-list adm-refunds' });
  for (const [w, rec] of due) {
    const e = (c.entries || []).find((x) => x.w === w);
    const raw = (rec && rec.raw) || (e && e.b && e.b.raw) || (c.sup ? shareOf(c.sup.supply, c.cfg.entryBps) : null);
    const li = h('li', { class: 'adm-refund' + (rec ? (rec.ok === false ? ' amber' : ' ok') : ' due'), 'data-w': w }, h('span', { class: 'lg-who' },
      h('span', { class: 'lg-name' }, h('b', null, nameOf(w)), rec ? pill(rec.ok === false ? 'unverified' : 'refunded', rec.ok === false ? 'warn' : 'ok') : pill('due', 'bad'), e ? pill(e.st === 'no' ? 'declined' : e.st, 'dim') : null),
      h('span', { class: 'lg-sub' }, h('span', { class: 'lg-addr', title: w }, short(w)), copyBtn(w), h('span', null, (raw ? uiAmount(raw, dec) + ' $BLUB' : 'the entry amount') + (rec ? '' : ' · send it back from the project wallet'))),
      e && e.why ? h('span', { class: 'lg-sub adm-quote' }, e.why) : null));
    if (rec) li.append(recLine(rec, dec));
    if (!rec || rec.ok === false) li.append(payForm(c, 'refund', w, rec));
    ol.append(li);
  }
  box.append(h('h4', null, 'Refunds · ' + due.filter(([, r]) => !r).length + ' due'), ol);
  if (A.mode === 'local') box.append(h('p', { class: 'adm-fine' }, 'Sandbox: demo-refund-' + c.n + ' is a refund to whichever wallet it is recorded for.'));
}

/* ---- Rewards: who gets what, give and take back, the bots' report ---- */
const itemSay = (x, n) => (x.item ? itemText(x.item, n) : x.tok + ' unlock token' + (x.tok === 1 ? '' : 's') + ' (in-game)');
function rewardsTable(list, c) {
  const per = new Map();
  for (const x of list) { const a = per.get(x.id) || []; a.push(x); per.set(x.id, a); }
  const place = new Map(((c.res && c.res.table) || []).map((r) => [r.id, r.place]));
  const ol = h('ol', { class: 'adm-list adm-rwlist' });
  for (const [id, xs] of per) {
    const w = who(id);
    const p = place.get(id);
    ol.append(h('li', { class: 'adm-ban' }, h('span', { class: 'adm-rwp rk' + (p <= 3 ? ' r' + p : '') }, p ? '#' + p : ''), w ? face(w.look, w.style) : null,
      h('span', { class: 'lg-who' }, h('span', { class: 'lg-name' }, h('b', null, nameOf(id, w))), h('span', { class: 'lg-sub adm-rwwhat' }, xs.map((x) => itemSay(x, c.n)).join(' · ')))));
  }
  return { ol, n: per.size };
}
// the same grants? Compared as the server does (lib/comp.mjs sameAsPreview): a wallet's items
// once each (a competition's pin.<tier> read as <code>.<tier>), its tokens summed, any order
function sameList(a, b, code) {
  const norm = (list) => {
    const m = new Map();
    for (const x of list || []) {
      if (!x || typeof x.id !== 'string') continue;
      if (x.item) m.set(x.id + ' ' + (PIN_PH.test(x.item) ? code + x.item.slice(3) : x.item), 1);
      if (x.tok > 0) m.set(x.id + ' #tok', (m.get(x.id + ' #tok') || 0) + x.tok);
    }
    return m;
  };
  const A_ = norm(a), B_ = norm(b);
  return A_.size === B_.size && [...A_].every(([k, v]) => B_.get(k) === v);
}
function renderRewards(box, c) {
  const list = rewardsPreview(c);
  R.rwMsg = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
  R.rwTyped = h('div', { class: 'adm-typedbox' });
  if (!c.res) { box.append(h('p', { class: 'sq-desc' }, 'Rewards follow the final table: they are given after day 6 and the recorded payout.')); return; }
  if (nobodyWon(c)) { box.append(h('p', { class: 'sq-desc' }, 'Nobody played #' + c.n + ': there are no rewards to give. Archive it from the head once its refunds are recorded.')); return; }
  const bots = (c.res.table || []).filter((r) => BOT_RE.test(r.id) && r.place <= 10);
  if (c.aw) {
    const t = rewardsTable(c.aw.list, c);
    const same = sameList(c.aw.list, list, c.code);
    box.append(h('p', { class: 'adm-state ok' }, 'Given ' + ago(c.aw.t) + ': ' + s_(c.aw.list.length, 'grant') + ' to ' + s_(t.n, 'wallet') + '.'),
      h('p', { class: 'adm-state ' + (same ? 'ok' : 'warn') }, same ? '✓ What was given matches the preview.' : '! What was given differs from the preview now (a disqualify or restore since?): take back and give again to match.'),
      h('h4', null, 'Given · ' + s_(t.n, 'wallet')), t.ol,
      h('div', { class: 'adm-row' }, sureBtn('Take back', 'pink', () => compDo(R.rwMsg, () => A.comps.rewards(c.code, { do: 'take', confirm: 'TAKE ' + c.n }), (r) => 'Took back ' + s_((r.given || []).length, 'grant') + ': #' + c.n + ' is settled again.'), 'Take back all ' + c.aw.list.length + '?')), R.rwMsg);
  } else {
    const t = rewardsTable(list, c);
    const can = c.st === 'settled';
    addKids(box, h('p', { class: 'adm-state' }, can ? 'Ready: the payout is recorded.' : c.st === 'done' ? 'Record the payout or the prize burn first (Results).' : 'Rewards are given once #' + c.n + ' is settled.'),
      h('h4', null, 'Who gets what · ' + s_(t.n, 'wallet')), list.length ? t.ol : h('p', { class: 'sq-desc' }, 'Nobody gets a reward under these steps.'),
      bots.length ? h('p', { class: 'adm-fine' }, s_(bots.length, 'bot') + ' in the top 10 (' + bots.map((b) => '#' + b.place).join(', ') + '): bots get nothing, and their places’ rewards are not passed on.') : null,
      h('div', { class: 'adm-row' }, btn('Give rewards…', 'gold', () => {
        if (!can) { say(R.rwMsg, 'Not yet: #' + c.n + ' is ' + c.st + '.', false); return; }
        typedBox(R.rwTyped, 'Give rewards', 'GIVE ' + c.n, s_(list.length, 'grant') + ' to ' + s_(t.n, 'wallet') + ': pins, items and unlock tokens (in-game), plus the podium tags. Take back removes exactly these.', 'gold',
          (confirm) => compDo(R.rwMsg, () => A.comps.rewards(c.code, { do: 'give', confirm }), (r) => 'Gave ' + s_((r.given || []).length, 'grant') + ' of #' + c.n + '.'));
      }, can ? {} : { 'aria-disabled': 'true' })), R.rwTyped, R.rwMsg);
  }
  // the bots' report: per deck, against humans and against bots
  R.botRep = h('div', { class: 'adm-botrep' });
  box.append(h('h4', null, 'Bot report'), R.botRep);
  R.botRep.append(h('p', { class: 'sq-desc' }, 'Loading the seven days…'));
  (async () => {
    await ensureDecks();
    const days = await loadDays(c);
    if (st.compFull !== c || !R.botRep.isConnected) return;
    drawBotReport(c, botReport(c, days));
  })();
}
function drawBotReport(c, rows) {
  R.botRep.textContent = '';
  if (!rows.length) { R.botRep.append(h('p', { class: 'sq-desc' }, 'No bot played a match.')); return; }
  const pct = (w, l) => (w + l ? Math.round((100 * w) / (w + l)) + '%' : '–');
  const tb = h('table', { class: 'adm-rep' }, h('thead', null, h('tr', null, ...['Deck', 'Tier', 'Plans', 'vs players', 'margin', 'vs bots', 'margin'].map((t) => h('th', { scope: 'col' }, t)))));
  const body = h('tbody');
  for (const r of rows) {
    const d = deckById(r.deck);
    body.append(h('tr', null, h('th', { scope: 'row' }, '#' + r.deck + ' ' + (d ? d.n : '') + (r.x ? ' · exp.' : '')), h('td', null, r.tier ? pips(r.tier) : '–'),
      h('td', null, Object.entries(r.plans).map(([k, n]) => k + '×' + n).join(' ')),
      h('td', null, r.hw + '–' + r.hl + ' (' + pct(r.hw, r.hl) + ')'), h('td', null, (r.hm > 0 ? '+' : '') + r.hm), h('td', null, r.bw + '–' + r.bl + ' (' + pct(r.bw, r.bl) + ')'), h('td', null, (r.bm > 0 ? '+' : '') + r.bm)));
  }
  tb.append(body);
  const saved = (lsRead().admRec || []).includes(c.code);
  const msg = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
  R.botRep.append(h('div', { class: 'adm-repw' }, tb),
    h('div', { class: 'adm-row' },
      sureBtn(saved ? 'Save record again' : 'Save record', saved ? '' : 'gold', () => saveRecord(c, rows, msg), saved ? 'Saved before: add it twice?' : 'Add to ' + rows.length + ' decks?'),
      btn('Export JSON', '', () => download('bots-' + c.code + '.json', JSON.stringify({ comp: c.code, n: c.n, name: c.cfg.name, week: c.cfg.week, engine: c.cfg.e, decks: rows.map((r) => ({ ...r, plan: (deckById(r.deck) || {}).plan || null })) }, null, 2), 'application/json'))),
    h('p', { class: 'adm-fine' }, 'Save record adds this week’s W–L of each deck to its total in the library (' + rows.length + ' commands). Export gives the lab the same, with the decks’ plans.'), msg);
}
async function saveRecord(c, rows, msg) {
  if (st.busy) return;
  st.busy = true;
  say(msg, 'Saving…');
  let n = 0;
  try {
    for (const r of rows) {
      const d = deckById(r.deck);
      if (!d) continue;
      const old = d.rec || { hw: 0, hl: 0, bw: 0, bl: 0 };
      const res = await A.decks.save({ ...d, rec: { hw: (old.hw | 0) + r.hw, hl: (old.hl | 0) + r.hl, bw: (old.bw | 0) + r.bw, bl: (old.bl | 0) + r.bl } });
      if (res && res.deck) Object.assign(d, res.deck);
      n++;
    }
    lsWrite({ admRec: [...new Set([...(lsRead().admRec || []), c.code])].slice(-40) });
    say(msg, 'Saved the record of ' + s_(n, 'deck') + '.', true);
  } catch (e) {
    say(msg, errSay(e) + (n ? ' (' + s_(n, 'deck') + ' saved before that)' : ''), false);
  } finally {
    st.busy = false;
  }
}
function download(name, text, type) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch { toast('The download did not start here.', false); }
}

/* ---- Post this: a text per step for X, Telegram and Discord, and a card ---- */
const POST_STEPS = [['announce', 'Announce'], ['open', 'Sign-ups open'], ['review', 'Review progress'], ['lock', 'Locked, with the day-salt hashes'], ['daily', 'Daily'], ['result', 'Result with proof'], ['rewards', 'Rewards']];
const PLATFORMS = [['x', 'X'], ['tg', 'Telegram'], ['dc', 'Discord']];
// up to five short chips from the rules (what the list and the posts show)
function sheetChips(cfg, E) {
  const out = [];
  const R2 = cfg.rules;
  for (const [part, , list] of RULE_PARTS) for (const [id, n] of Object.entries(R2.lim[part])) out.push((n === 0 ? 'No ' : 'Max ' + n + ' ') + nameIn(E, list, id));
  out.push(...arenaChips(R2.arena, E));
  return out.slice(0, 5);
}
// the facts every post draws from (0 commands: the record, the overview, the days read)
function postFacts(c, days) {
  const cfg = normCfg(c.cfg, C.E);
  const am = amountsOf(c, cfg);
  const dec = am ? am.dec : 6;
  const n = c.counts || {};
  const L = (c.prv && c.prv.lineup) || [];
  const tiers = { A: 0, B: 0, C: 0 };
  for (const p of c.pub || []) if (p.bot && p.tier) tiers[p.tier]++;
  const played = (c.played || []).lastIndexOf(true);
  return {
    n: c.n, name: cfg.name, size: cfg.size, rounds: perDay(cfg.size), opens: day(cfg.times.opens), closes: day(cfg.times.closes), start: day(cfg.times.start),
    entry: cfg.entryBps ? (am ? uiAmount(roundDown(am.entry, dec), dec) + ' $BLUB (' + pctOf(cfg.entryBps) + ' of supply at opening)' : pctOf(cfg.entryBps) + ' of supply') : null,
    prize: cfg.prizeBps ? (am ? uiAmount(roundDown(am.prize, dec), dec) + ' $BLUB (' + pctOf(cfg.prizeBps) + ')' : pctOf(cfg.prizeBps) + ' of supply') : null,
    chips: sheetChips(cfg, C.E), req: (n.req || 0) + (n.ok || 0) + (n.wait || 0) + (n.no || 0), ok: n.ok || 0, left: Math.max(0, cfg.size - (n.ok || 0)),
    humans: (c.pool || []).filter((id) => id && !BOT_RE.test(id)).length, bots: (c.pool || []).filter((id) => BOT_RE.test(id || '')).length, tiers, lineup: L.length,
    com: c.com || [], played, days, res: c.res, pay: c.pay, aw: c.aw, rw: cfg.rw, dec,
  };
}
const bold = (p, s) => (p === 'dc' ? '**' + s + '**' : s);
const solscan = (sig) => (SIG_OK.test(sig || '') ? 'https://solscan.io/tx/' + sig : sig);
// one post: its lines for the platform, ending with the safety line (pure on its facts)
export function postText(step, p, F, extra) {
  const x = p === 'x';
  const head = bold(p, '$BLUB Squad Arena · ' + F.name + ' (#' + F.n + ')');
  const L = [];
  const rules = F.chips && F.chips.length ? 'Rules: ' + F.chips.join(', ') + '.' : 'Rules: the normal game.';
  if (step === 'announce') {
    L.push(head, 'Sign-ups open ' + F.opens + ' UTC. ' + F.size + ' places, 7 days of 5v5 squad fights, ' + F.rounds + ' rounds a day.');
    L.push(F.entry ? 'Entry: burn ' + F.entry + ' from your own wallet.' : 'Free entry.');
    if (F.prize) L.push('Winner takes ' + F.prize + '. If a bot wins, the prize is burned.');
    if (!x) L.push(rules);
  } else if (step === 'open') {
    L.push(head, 'Sign-ups are open until ' + F.closes + ' UTC: ' + F.size + ' places.');
    L.push(F.entry ? 'Burn ' + F.entry + ' in your own wallet app, then paste the signature on the site (Rankings, Competitions). Burns are final.' : 'Enter on the site: Rankings, Competitions.');
    L.push(rules);
  } else if (step === 'review') {
    L.push(head, F.req + ' requests in, ' + F.ok + ' approved, ' + F.left + ' places left. Sign-ups close ' + F.closes + ' UTC.');
    if (!x) L.push('We read every request: a short "why you" and your socials help.');
  } else if (step === 'lock') {
    L.push(head, 'Locked and drawn: ' + F.humans + ' players and ' + F.bots + ' bots (' + F.tiers.A + ' Strong, ' + F.tiers.B + ' Medium, ' + F.tiers.C + ' Weak). Day 0 starts ' + F.start + ' UTC.');
    if (F.com.length) {
      L.push(x ? 'Day-salt hashes, published before play: ' + F.com.slice(0, 2).map((hh, d) => DAY_NAMES[d] + ' ' + hh.slice(0, 16)).join(', ') + '… all 7 on the site.' : 'Day-salt hashes, published before any match is played (each day’s record reveals its salt):');
      if (!x) for (const [d, hh] of F.com.entries()) L.push(DAY_NAMES[d] + ' ' + (p === 'dc' ? '`' + hh + '`' : hh));
    }
  } else if (step === 'daily') {
    const d = extra && Number.isInteger(extra.day) ? extra.day : F.played;
    const S = d >= 0 && F.days && F.days[d] ? dayStory(extra.ids, F.days, d) : null;
    if (!S) L.push(head, 'No day played yet.');
    else {
      const nm = extra.name;
      L.push(head, 'Day ' + d + ' (' + DAY_NAMES[d] + ') is played.');
      if (S.leader) L.push('Leader: ' + nm(S.leader.id) + ' with ' + S.leader.pts + ' points (' + S.leader.w + '–' + S.leader.l + ').');
      if (S.upset) L.push('Upset of the day: ' + nm(extra.ids[S.upset.w]) + ' beat ' + nm(extra.ids[S.upset.l]) + '.');
      if (S.closest) L.push('Closest match: ' + nm(extra.ids[S.closest.a]) + ' vs ' + nm(extra.ids[S.closest.b]) + ', decided by ' + S.closest.margin + ' HP.' + (extra.watch ? ' Replay: ' + extra.watch : ''));
    }
  } else if (step === 'result') {
    const r = F.res;
    if (!r || !r.table || !r.table.length) L.push(head, 'The final table comes after day 6.');
    else {
      const nm = extra.name;
      const top = r.table[0];
      L.push(head, 'Final: ' + nm(top.id) + ' wins with ' + top.pts + ' points (' + top.w + '–' + top.l + ').');
      if (!x) L.push('Podium: ' + r.table.slice(0, 3).map((t) => '#' + t.place + ' ' + nm(t.id)).join(', ') + '.');
      const burnt = prizeBurnt(F, banned());
      const pr = F.pay && (burnt ? F.pay.burn : F.pay.payout);
      if (burnt) L.push((BOT_RE.test(r.winner || '') ? 'A bot finished first' : 'The winner is out of the prize') + ', so the prize is burned' + (pr ? ': ' + solscan(pr.sig) : ' (the proof follows).'));
      else L.push(pr ? 'Prize sent to ' + short(r.winner) + ': ' + solscan(pr.sig) : 'The prize is sent within 72 h; the proof follows.');
    }
  } else if (step === 'rewards') {
    const list = (F.aw && F.aw.list) || extra.preview || [];
    const ppl = new Set(list.map((g) => g.id)).size;
    const tok = list.reduce((s, g) => s + (g.tok || 0), 0);
    L.push(head, (F.aw ? 'Rewards are out: ' : 'Rewards coming: ') + ppl + ' players get their pins' + (tok ? ' and ' + tok + ' unlock tokens (in-game, cosmetic only)' : '') + '.');
    if (!x) L.push('Gold, silver and bronze pins for the podium, a top-10 pin, and a pin for everyone who played. Wear them on your Blubs.');
  }
  L.push(NEVER);
  return L.join('\n');
}
function renderPost(box, c) {
  const p = PLATFORMS.some((x) => x[0] === lsRead().admPost) ? lsRead().admPost : 'x';
  const chips = h('div', { class: 'adm-efilters', role: 'group', 'aria-label': 'Platform' }, ...PLATFORMS.map(([id, label]) => {
    const b = h('button', { type: 'button', class: 'adm-ef' + (id === p ? ' on' : ''), 'aria-pressed': String(id === p) }, label);
    b.onclick = () => { lsWrite({ admPost: id }); renderComp(); };
    return b;
  }));
  R.postBox = h('div', { class: 'adm-posts' });
  box.append(h('div', { class: 'adm-row adm-posthd' }, chips, btn('Download card', '', () => downloadCard(c), { title: 'A picture of the competition: the top 3 once played' })),
    h('p', { class: 'sq-desc' }, 'A text for each step, from the record as it stands. Copy it, check it, post it. Every text ends with the line about links and signing.'), R.postBox);
  R.postBox.append(h('p', { class: 'sq-desc' }, 'Loading…'));
  (async () => {
    const days = c.played && c.played.some(Boolean) ? await loadDays(c) : [];
    if (st.compFull !== c || !R.postBox.isConnected) return;
    const F = postFacts(c, days);
    const extra = { ids: c.pool || [], name: (id) => nameOf(id), preview: rewardsPreview(c), day: F.played };
    if (F.played >= 0 && days[F.played]) {
      const S = dayStory(c.pool, days, F.played);
      if (S && S.closest) {
        const m = matchOf(c, { ...days[F.played], d: F.played }, S.closest.k, S.closest.a, S.closest.b);
        if (m.teams[0].squad && m.teams[1].squad && typeof C.watchLink === 'function') { try { extra.watch = (await watchShare(m)).url; } catch { /* no link then */ } }
      }
    }
    if (!R.postBox.isConnected) return;
    R.postBox.textContent = '';
    for (const [id, label] of POST_STEPS) {
      const area = h('textarea', { class: 'sq-pfin adm-post', rows: id === 'lock' && p !== 'x' ? '12' : '6', 'aria-label': label + ' (' + PLATFORMS.find((x) => x[0] === p)[1] + ')', id: 'admPost-' + id });
      area.value = postText(id, p, F, extra);
      const count = h('span', { class: 'adm-fine' });
      const recount = () => { count.textContent = area.value.length + (p === 'x' ? ' / 280' : '') + ' characters'; count.classList.toggle('bad', p === 'x' && area.value.length > 280); };
      area.oninput = recount;
      recount();
      R.postBox.append(h('section', { class: 'adm-postc', 'aria-labelledby': 'admPostH-' + id }, h('h5', { id: 'admPostH-' + id }, label), area,
        h('div', { class: 'adm-row' }, btn('Copy', 'gold', () => copyText(area.value, label + ': copied.')), count)));
    }
  })();
}
// the competition as a picture (600x315): its name, state and the top 3 once played
// (the page's own result card is for duels; this one draws in the same style)
async function downloadCard(c) {
  try { await document.fonts.load('16px "Press Start 2P"'); await document.fonts.load('20px VT323'); } catch { /* the fallback fonts then */ }
  const W = 600;
  const H = 315;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const x = cv.getContext('2d');
  x.imageSmoothingEnabled = false;
  ['#0C2125', '#10292E', '#133137', '#173A40', '#1B434A'].forEach((col, i) => { x.fillStyle = col; x.fillRect(0, i * 40, W, 40); });
  x.fillStyle = '#122D33';
  x.fillRect(0, 200, W, H - 200);
  for (let j = 0; j < 7; j++) for (let i = 0; i < 38; i++) { x.fillStyle = (i + j) % 2 ? '#EBB5C3' : '#F2C4CF'; x.fillRect(i * 16, 236 + j * 16, 16, 16); }
  x.fillStyle = '#46797B';
  x.fillRect(0, 230, W, 6);
  const P2 = (n) => n + 'px "Press Start 2P", monospace';
  const VT = (n) => n + 'px VT323, monospace';
  const txt = (s, px, py, font, col, align) => { x.font = font; x.textAlign = align || 'center'; x.fillStyle = '#000'; x.fillText(s, px + 2, py + 2); x.fillStyle = col; x.fillText(s, px, py); };
  txt('5V5 SQUAD ARENA', W / 2, 34, P2(16), '#FFD447');
  txt(c.cfg.name + ' · #' + c.n, W / 2, 62, VT(30), '#FFFFFF');
  const table = c.res && c.res.table ? c.res.table : null;
  if (table) {
    const spots = [[W / 2, 92, 4, 1], [W / 2 - 170, 120, 3, 2], [W / 2 + 170, 120, 3, 3]];
    for (const [cx, cy, s, place] of spots) {
      const r = table.find((t) => t.place === place);
      if (!r) continue;
      const w = who(r.id);
      if (w) {
        const f = C.lookCanvas(C.cleanLook(w.look), { style: w.style });
        x.drawImage(f, cx - (f.width * s) / 2, cy, f.width * s, f.height * s);
      }
      x.fillStyle = ['#FFD447', '#D9E3E3', '#E8A87C'][place - 1];
      x.fillRect(cx - 18, cy + 92, 36, 22);
      txt('#' + place, cx, cy + 109, P2(9), '#1A1030');
      const nm = nameOf(r.id);
      txt(nm.length > 14 ? nm.slice(0, 13) + '…' : nm, cx, cy + 136, VT(24), '#FFFFFF');
      txt(r.pts + ' pts · ' + r.w + '–' + r.l + (BOT_RE.test(r.id) ? ' · bot' : ''), cx, cy + 158, VT(20), '#BDE7FF');
    }
  } else {
    const n = c.counts || {};
    txt(c.st === 'open' ? 'SIGN-UPS OPEN' : c.st.toUpperCase(), W / 2, 130, P2(14), '#FFD447');
    txt(c.cfg.size + ' places · ' + (n.ok || 0) + ' approved', W / 2, 168, VT(28), '#FFFFFF');
    txt('closes ' + day(c.cfg.times.closes) + ' UTC', W / 2, 198, VT(24), '#BDE7FF');
  }
  txt('$BLUB', 12, 22, P2(9), '#86CBF3', 'left');
  txt('week ' + (c.cfg.week ? Number(String(c.cfg.week).slice(5)) : '?'), W - 12, 22, VT(20), '#9CC9C4', 'right');
  try {
    const a = h('a', { href: cv.toDataURL('image/png'), download: 'blub-cup-' + c.n + '.png' });
    document.body.append(a);
    a.click();
    a.remove();
    toast('The card is downloading.', true);
  } catch { toast('The card could not be made here.', false); }
}

/* ---- Setup: four groups, checked as you type, beside the player's rules sheet ---- */
function renderSetup(box, c) {
  const D = st.draft;
  R.errs = {};
  R.ctl = {};
  R.sheet = h('div', { class: 'adm-sheet' });
  R.simMsg2 = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
  const form = h('div', { class: 'adm-form' });
  const side = h('aside', { class: 'adm-side', 'aria-labelledby': 'admSheetTitle' },
    h('h4', { id: 'admSheetTitle' }, 'What players see'), R.sheet,
    h('div', { class: 'adm-row' }, btn('Simulate', '', simulate, { title: 'Two decks under these rules in the arena view (0 commands)' })), R.simMsg2);
  box.append(h('div', { class: 'adm-setup' }, form, side));
  form.append(groupBasics(c, D), groupMoney(c, D), groupRules(c), groupRewards(c, D), saveBar());
  changed();
}
function group(title, id, ...kids) {
  return h('fieldset', { class: 'adm-group', id }, h('legend', null, title), ...kids);
}
// a field: its label, the control, a note, and room for what is wrong with it. A field the
// competition's state froze is greyed and says since when (open or lock).
function field(label, key, ctl, note, asGroup) {
  const since = frozenSince(key, st.compFull.st);
  const err = h('span', { class: 'adm-err', id: 'admErr-' + key.replace(/[^a-zA-Z0-9]/g, '-') });
  R.errs[key] = err;
  if (ctl.matches && ctl.matches('input,select,textarea')) {
    R.ctl[key] = ctl;
    ctl.setAttribute('aria-describedby', err.id);
  }
  if (since) for (const x of [ctl, ...ctl.querySelectorAll('input,select,textarea,button')]) if ('disabled' in x) x.disabled = true;
  const head = h('span', { class: 'adm-fl' }, label, since ? h('em', null, 'locked since ' + since) : null);
  return asGroup
    ? h('div', { class: 'adm-field' + (since ? ' frozen' : ''), role: 'group', 'aria-label': label + (since ? ', locked since ' + since : '') }, head, ctl, note || null, err)
    : h('label', { class: 'adm-field' + (since ? ' frozen' : '') }, head, ctl, note || null, err);
}
function txt(key, get, set, a) {
  const el = h('input', { class: 'sq-pfin', type: 'text', 'data-k': key, ...a });
  el.value = get() ?? '';
  el.oninput = () => { set(el.value); changed(); };
  return el;
}
function area(key, get, set, a) {
  const el = h('textarea', { class: 'sq-pfin adm-area', 'data-k': key, ...a });
  el.value = get() ?? '';
  el.oninput = () => { set(el.value); changed(); };
  return el;
}
// a whole number; empty is NaN (a problem), or null where empty means "none"
function num(key, get, set, a, emptyNull) {
  const el = h('input', { class: 'sq-pfin adm-num', type: 'number', inputmode: 'numeric', step: '1', 'data-k': key, ...a });
  const v = get();
  el.value = v === null || v === undefined || Number.isNaN(v) ? '' : String(v);
  el.oninput = () => { set(el.value === '' ? (emptyNull ? null : NaN) : Number(el.value)); changed(); };
  return el;
}
function sel(key, opts, get, set, a) {
  const el = h('select', { class: 'adm-sel', 'data-k': key, ...a }, ...opts.map(([v, l]) => h('option', { value: String(v) }, l)));
  el.value = String(get());
  el.onchange = () => { set(el.value); changed(); };
  return el;
}
function check(key, label, get, set) {
  const el = h('input', { type: 'checkbox', 'data-k': key });
  el.checked = !!get();
  el.onchange = () => { set(el.checked); changed(); };
  return h('label', { class: 'adm-check' }, el, h('span', null, label));
}
function radios(key, opts, get, set) {
  const box = h('div', { class: 'adm-radios' });
  for (const [v, l] of opts) {
    const el = h('input', { type: 'radio', name: 'adm-' + key, value: v, 'data-k': key + '.' + v });
    el.checked = get() === v;
    el.onchange = () => { if (el.checked) { set(v); changed(); } };
    box.append(h('label', { class: 'adm-check' }, el, h('span', null, l)));
  }
  return box;
}

function groupBasics(c, D) {
  const g = group('Basics', 'admSetBasics');
  const times = h('div', { class: 'adm-times' });
  for (const [k, label] of [['opens', 'Sign-ups open'], ['closes', 'Sign-ups close'], ['lock', 'Lock & draw'], ['start', 'Day 0 starts']]) {
    const el = h('input', { class: 'sq-pfin', type: 'datetime-local', step: '60', 'data-k': 'times.' + k });
    el.value = D.times[k] ? D.times[k].slice(0, 16) : '';
    el.oninput = () => { D.times[k] = el.value ? new Date(el.value + ':00Z').toISOString() : ''; changed(); };
    times.append(field(label + ' (UTC)', 'times.' + k, el));
  }
  const defBtn = btn('Wed 12:00 → Sun 20:00 → Mon 00:05 → Mon 00:00', 'adm-defbtn', () => {
    const t = weekTimes(D.week, C.E);
    if (!t) { R.errs.week.textContent = 'Set the week first: the times follow it.'; return; }
    for (const k of TIME_KEYS) if (!frozenSince('times.' + k, c.st)) { D.times[k] = t[k]; R.ctl['times.' + k].value = t[k].slice(0, 16); }
    changed();
  }, { title: 'The default timetable of the week, in UTC' });
  if (frozenSince('times.closes', c.st)) defBtn.disabled = true;
  g.append(
    field('Name', 'name', txt('name', () => D.name, (v) => { D.name = v; }, { maxlength: '40', autocomplete: 'off' })),
    field('Text for players', 'text', area('text', () => D.text, (v) => { D.text = v; }, { maxlength: '600', rows: '3' })),
    h('div', { class: 'adm-three' },
      field('Week', 'week', txt('week', () => D.week, (v) => { D.week = v.trim(); }, { maxlength: '7', placeholder: C.E.leagueWeek(Date.now() + 7 * DAY), autocomplete: 'off', spellcheck: 'false' })),
      field('Places', 'size', num('size', () => D.size, (v) => { D.size = v; }, { min: '6', max: '64' })),
      field('Team age, days', 'minAge', num('minAge', () => D.minAge, (v) => { D.minAge = v; }, { min: '0', max: '30' }))),
    times, h('div', { class: 'adm-row' }, defBtn),
    field('Entry order', 'order', radios('order', [['burn', 'Burn first, then review'], ['ask', 'Ask first, burn after approval']], () => D.order, (v) => { D.order = v; }), null, true),
    field('Lock', 'autoLock', check('autoLock', 'Lock and draw by itself at the lock time', () => D.autoLock, (v) => { D.autoLock = v; }), null, true));
  return g;
}

function groupMoney(c, D) {
  const g = group('Entry and prize', 'admSetEntry');
  R.supLine = h('p', { class: 'adm-state' });
  R.amtEntry = h('span', { class: 'adm-fn' });
  R.amtPrize = h('span', { class: 'adm-fn' });
  R.roundBox = h('div', { class: 'adm-row adm-round' });
  R.walletLine = h('p', { class: 'adm-state' });
  g.append(R.supLine,
    h('div', { class: 'adm-two' },
      field('Entry, basis points of supply', 'entryBps', num('entryBps', () => D.entryBps, (v) => { D.entryBps = v; }, { min: '0', max: '10000' }), R.amtEntry),
      field('Prize, basis points of supply', 'prizeBps', num('prizeBps', () => D.prizeBps, (v) => { D.prizeBps = v; }, { min: '0', max: '10000' }), R.amtPrize)),
    h('p', { class: 'sq-desc' }, '10 basis points = 0.1%, 100 = 1%. The amounts are fixed from the supply when sign-ups open (a burn makes the supply smaller, so they are worked out once).'),
    R.roundBox, R.walletLine);
  if (st.chain === undefined && typeof A.chain === 'function') {
    st.chain = null;
    A.chain().then((ch) => { st.chain = ch || null; renderAmounts(); renderSheet(); }, () => {});
  }
  return g;
}
function renderAmounts() {
  if (!R.supLine || !R.supLine.isConnected) return;
  const c = st.compFull, D = st.draft;
  const sup = c.sup || st.chain;
  R.roundBox.textContent = '';
  R.walletLine.textContent = '';
  R.walletLine.className = 'adm-state';
  const okBps = (v) => Number.isInteger(v) && v >= 0 && v <= 10000;
  if (!sup || !sup.supply) {
    R.supLine.textContent = 'No live supply here (no BLUB_MINT): the amounts are worked out when sign-ups open.';
    R.amtEntry.textContent = okBps(D.entryBps) ? '= ' + pctOf(D.entryBps) + ' of the supply' : '';
    R.amtPrize.textContent = okBps(D.prizeBps) ? '= ' + pctOf(D.prizeBps) + ' of the supply' : '';
    return;
  }
  const dec = sup.dec || 0;
  R.supLine.textContent = c.sup
    ? 'Fixed at open: a supply of ' + uiAmount(sup.supply, dec) + ' $BLUB (slot ' + sup.slot + ').'
    : 'Live supply: ' + uiAmount(sup.supply, dec) + ' $BLUB (slot ' + sup.slot + ').';
  const e = okBps(D.entryBps) ? shareOf(sup.supply, D.entryBps) : null;
  const p = okBps(D.prizeBps) ? shareOf(sup.supply, D.prizeBps) : null;
  R.amtEntry.textContent = e === null ? '' : '= ' + uiAmount(e, dec) + ' $BLUB (' + pctOf(D.entryBps) + ')';
  R.amtPrize.textContent = p === null ? '' : '= ' + uiAmount(p, dec) + ' $BLUB (' + pctOf(D.prizeBps) + ')';
  // the round-down helper: the same amounts in round numbers, for the posts
  if (e !== null && p !== null && (D.entryBps || D.prizeBps)) {
    const line = 'Entry ' + uiAmount(roundDown(e, dec), dec) + ' $BLUB · prize ' + uiAmount(roundDown(p, dec), dec) + ' $BLUB';
    R.roundBox.append(h('span', { class: 'adm-fn' }, 'Rounded down for posts: ' + line), btn('Copy', '', () => { try { navigator.clipboard.writeText(line).then(() => toast('Copied: ' + line, true), () => {}); } catch { /* no clipboard */ } }));
  }
  // the project wallet must hold the prize (it pays it, or burns it when a bot wins)
  const bal = st.chain && st.chain.projectBalance;
  if (bal != null && p !== null && D.prizeBps) {
    const enough = BigInt(bal) >= BigInt(p);
    R.walletLine.textContent = 'Project wallet holds ' + uiAmount(bal, dec) + ' $BLUB: ' + (enough ? 'enough for the prize.' : 'less than the prize of ' + uiAmount(p, dec) + ' $BLUB.');
    R.walletLine.className = 'adm-state ' + (enough ? 'ok' : 'bad');
  }
}

function groupRules(c) {
  const g = group('Rules and arena', 'admSetRules');
  const frozen = frozenSince('rules', c.st);
  if (frozen) g.append(h('p', { class: 'adm-frozen' }, 'Locked since ' + frozen + ': these are the rules the players signed up for.'));
  // the squad side is not played yet: greyed out (a draft that has some can clear them)
  const off = frozen || 'squad';
  const sq = h('div', { class: 'adm-squadrules off', role: 'group', 'aria-label': 'Squad rules, not played yet' });
  sq.append(h('p', { class: 'adm-state warn', id: 'admSquadOff' }, SQUAD_RULES_SAY));
  const R_ = st.draft.rules;
  if (!frozen && squadRulesIn(R_)) {
    sq.append(h('div', { class: 'adm-row' }, btn('Clear squad rules', 'gold', () => {
      for (const [part] of RULE_PARTS) R_.lim[part] = {};
      R_.objMax = C.E.OBJECTS_MAX;
      st.only = {};
      const fresh = groupRules(st.compFull);
      g.replaceWith(fresh);
      changed();
      const f = fresh.querySelector('#admSquadOff');
      if (f) { f.setAttribute('tabindex', '-1'); f.focus(); }
    }, { 'data-k': 'clearSquad' }), h('span', { class: 'adm-fine' }, 'Then save, and the competition can open.')));
  }
  R.parts = {};
  for (const [part, label, list] of RULE_PARTS) {
    R.parts[part] = partRow(part, label, list, off);
    sq.append(R.parts[part]);
  }
  const objSel = sel('rules.objMax', Array.from({ length: C.E.OBJECTS_MAX + 1 }, (_, i) => [i, i === C.E.OBJECTS_MAX ? i + ' (as normal)' : String(i)]), () => R_.objMax, (v) => { R_.objMax = Number(v); }, { disabled: true });
  sq.append(h('div', { class: 'adm-two' }, field('Trench kit objects a squad', 'rules.objMax', objSel)));
  g.append(sq);
  R.arenaBox = h('div', { class: 'adm-arena' });
  g.append(h('h4', null, 'Arena'), R.arenaBox);
  renderArena();
  return g;
}
function partRow(part, label, list, frozen) {
  const E = C.E;
  const m = st.draft.rules.lim[part];
  const only = !!st.only[part];
  const err = h('span', { class: 'adm-err' });
  R.errs['rules.lim.' + part] = err;
  const chips = h('div', { class: 'adm-rchips' });
  for (const [id, name] of E[list]) {
    const off = part === 'obj' && (E.OBJECTS_OFF || []).includes(id);
    const n = m[id];
    const cap = partCap(part, id, E);
    const state = n === 0 ? 'ban' : n > 0 ? 'cap' : 'ok';
    const how = state === 'ban' ? 'banned' : state === 'cap' ? 'at most ' + n + ' a squad' : 'allowed';
    const b = h('button', { type: 'button', class: 'adm-rchip ' + state + (off ? ' off' : ''), 'data-k': 'lim.' + part + '.' + id, 'data-st': state, disabled: !!frozen,
      'aria-label': name + ': ' + how + (off ? ', out of the kit in this engine' : ''), title: name + ': ' + how + (cap > 1 ? ' (allowed → max → banned)' : ' (allowed → banned)') },
    h('span', null, name), state === 'cap' ? h('b', null, '×' + n) : state === 'ban' ? h('b', { 'aria-hidden': 'true' }, '✕') : null);
    b.onclick = () => cycleLim(part, id);
    b.onkeydown = (e) => { if (state === 'cap' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); bumpLim(part, id, e.key === 'ArrowUp' ? 1 : -1); } };
    chips.append(b);
    if (state === 'cap' && cap > 2 && !frozen) chips.append(h('button', { type: 'button', class: 'adm-rplus', 'data-k': 'plus.' + part + '.' + id, 'aria-label': 'Allow one more ' + name + ' a squad', title: 'One more a squad (up to ' + (cap - 1) + ')', onclick: () => bumpLim(part, id, 1) }, '+'));
  }
  return h('div', { class: 'adm-part', role: 'group', 'aria-label': label, 'data-part': part },
    h('div', { class: 'adm-parth' }, h('b', null, label),
      h('button', { type: 'button', class: 'adm-only', 'aria-pressed': String(only), 'data-k': 'only.' + part, disabled: !!frozen, onclick: () => toggleOnly(part), title: 'Ban every ' + label.toLowerCase().replace(/s$/, '') + ' that is not marked' }, 'Only these')),
    chips, err);
}
// redraws a part of the grid and keeps the focus where it was
function keepFocus(fn) {
  const a = document.activeElement;
  const k = a && a.dataset ? a.dataset.k : null;
  fn();
  if (k) { const el = R.cdetail.querySelector('[data-k="' + k + '"]'); if (el && !el.disabled) el.focus(); }
}
function redrawPart(part) {
  const [, label, list] = RULE_PARTS.find((p) => p[0] === part);
  keepFocus(() => {
    const row = partRow(part, label, list, frozenSince('rules', st.compFull.st) || 'squad');
    R.parts[part].replaceWith(row);
    R.parts[part] = row;
  });
  changed();
}
function cycleLim(part, id) {
  const m = st.draft.rules.lim[part];
  const cap = partCap(part, id, C.E);
  if (m[id] === undefined) m[id] = cap > 1 ? 1 : 0;
  else if (m[id] > 0) m[id] = 0;
  else delete m[id];
  redrawPart(part);
}
function bumpLim(part, id, d) {
  const m = st.draft.rules.lim[part];
  const cap = partCap(part, id, C.E);
  let n = (m[id] || 1) + d;
  if (n >= cap) n = 1;
  if (n < 1) n = cap - 1;
  m[id] = n;
  redrawPart(part);
}
// "Only these": every pick not marked (allowed with no cap) becomes banned; off again, the bans go
function toggleOnly(part) {
  const [, , list] = RULE_PARTS.find((p) => p[0] === part);
  const m = st.draft.rules.lim[part];
  if (!st.only[part]) {
    for (const [id] of C.E[list]) if (m[id] === undefined) m[id] = 0;
    st.only[part] = true;
  } else {
    for (const id of Object.keys(m)) if (m[id] === 0) delete m[id];
    st.only[part] = false;
  }
  redrawPart(part);
}
// the arena: the engine's rule set (a preset, or each rule of RULE_SET by hand) and the seeds
function ruleOpt(E, r, v) {
  if (r.id === 'weather') return v === 'random' ? 'As it comes' : 'Always ' + nameIn(E, 'WEATHER', v);
  if (r.id === 'mistTurn') return 'From turn ' + v + (v === r.def ? ' (as normal)' : '');
  return v + '%' + (v === r.def ? ' (as normal)' : '');
}
// what a rule waits on: its chips and odds mean nothing while the switch above is off
const RULE_NEEDS = { chestPool: 'chest', chancePct: 'chance', fetch: 'chance', goldPct: 'golds', goldPool: 'golds' };
function renderArena() {
  const E = C.E;
  const Aa = st.draft.rules.arena;
  const frozen = frozenSince('rules', st.compFull.st);
  const redraw = () => { keepFocus(renderArena); changed(); };
  R.arenaBox.textContent = '';
  const val = (r) => ruleVal(Aa.play, r);
  // a rule set back to its default is left out, so a preset keeps its name
  const put = (r, v) => {
    const next = { ...Aa.play };
    if (JSON.stringify(v) === JSON.stringify(r.def)) delete next[r.id];
    else next[r.id] = v;
    Aa.play = E.cleanRules(next);
  };
  const box = (...kids) => { const d = h('div', null, ...kids); if (frozen) for (const x of d.querySelectorAll('input,select,button')) x.disabled = true; return d; };
  const pre = presetOf(Aa.play, E);
  const P = pre ? E.RULE_PRESETS.find((x) => x.id === pre) : null;
  const preset = sel('rules.arena.preset', [...E.RULE_PRESETS.map((x) => [x.id, x.name]), ['custom', 'Custom']], () => pre || 'custom', (v) => {
    const x = E.RULE_PRESETS.find((y) => y.id === v);
    if (x) Aa.play = E.cleanRules(JSON.parse(JSON.stringify(x.rules)));
    redraw();
  });
  const changes = E.ruleChanges(Aa.play);
  const what = h('p', { class: 'adm-fn', 'data-k': 'rules.arena.changes' }, (P ? P.text : 'Your own mix of the rules below.') + (pre !== 'classic' && changes.length ? ' Differs from the normal game in: ' + changes.map((c) => c.name + ' ' + c.value).join(' · ') + '.' : ''));
  R.arenaBox.append(box(field('Rule set', 'rules.arena.preset', preset, what)));
  const setChips = (r, off) => {
    const cur = val(r);
    const chips = h('div', { class: 'adm-rchips' });
    for (const id of r.options) {
      const yes = cur.includes(id);
      const name = nameIn(E, r.id === 'goldPool' ? 'GOLDS' : 'EVENTS', id);
      const b = h('button', { type: 'button', class: 'adm-rchip ' + (yes ? 'ok' : 'ban'), 'data-k': 'arena.' + r.id + '.' + id, 'aria-pressed': String(yes), disabled: !!(frozen || off),
        title: name + (yes ? ': in' : ': out'), 'aria-label': name + (yes ? ', in' : ', out') }, h('span', null, name), yes ? null : h('b', { 'aria-hidden': 'true' }, '✕'));
      b.onclick = () => { put(r, r.options.filter((x) => (x === id ? !yes : cur.includes(x)))); redraw(); };
      chips.append(b);
    }
    const err = h('span', { class: 'adm-err' });
    R.errs['rules.arena.' + r.id] = err;
    return h('div', { class: 'adm-part', role: 'group', 'aria-label': r.name, 'data-rule': r.id },
      h('div', { class: 'adm-parth' }, h('b', null, r.name), h('span', { class: 'adm-row' },
        btn('All', '', () => { put(r, r.options.slice()); redraw(); }, { 'data-k': 'all.' + r.id, disabled: !!(frozen || off) }),
        btn('None', '', () => { put(r, []); redraw(); }, { 'data-k': 'none.' + r.id, disabled: !!(frozen || off) }))),
      h('p', { class: 'adm-fn' }, r.text), chips, err);
  };
  const rows = [];
  for (const r of E.RULE_SET) {
    const need = RULE_NEEDS[r.id];
    const off = !!need && !val(E.RULE_SET.find((x) => x.id === need));
    const key = 'rules.arena.' + r.id;
    let el;
    if (r.kind === 'on') el = field(r.name, key, check(key, r.text, () => val(r), (v) => { put(r, v); redraw(); }), null, true);
    else if (r.kind === 'list') el = field(r.name, key, sel(key, r.options.map((v) => [v, ruleOpt(E, r, v)]), () => val(r), (v) => { put(r, r.options.find((x) => String(x) === v)); redraw(); }), h('span', { class: 'adm-fn' }, r.text));
    else el = setChips(r, off);
    // a rule that waits on a switch that is off
    if (off && r.kind !== 'set') for (const x of el.querySelectorAll('input,select')) x.disabled = true;
    rows.push(el);
  }
  const seedMode = sel('rules.arena.seedMode', [['match', 'A fresh seed every match'], ['day', 'One seed for everyone each day'], ['fixed', 'One fixed arena all week']], () => Aa.seedMode, (v) => { Aa.seedMode = v; seed.disabled = !!frozen || v !== 'fixed'; });
  const seed = num('rules.arena.seed', () => Aa.seed, (v) => { Aa.seed = v; }, { min: '0', max: String(INT31), placeholder: 'none' }, true);
  seed.disabled = !!frozen || Aa.seedMode !== 'fixed';
  // the rules one under the other with room between them, then the seeds
  const list = box(...rows);
  list.className = 'adm-arena adm-rules';
  R.arenaBox.append(list, box(h('div', { class: 'adm-two' }, field('Seeds', 'rules.arena.seedMode', seedMode), field('Arena seed', 'rules.arena.seed', seed))));
}

function groupRewards(c, D) {
  const g = group('Rewards and terms', 'admSetRewards');
  g.append(h('p', { class: 'sq-desc' }, 'Per step: a look (an exclusive id such as hat:ghost, or this week’s pin) and unlock tokens (in-game, 0-9). The steps stack; bots get nothing.'));
  for (const [k, label, tok] of RW_STEPS) {
    const v = D.rw[k];
    const it = txt('rw.' + k + '.item', () => v.item, (x) => { v.item = x.trim(); }, { maxlength: '40', placeholder: 'item id', autocomplete: 'off', spellcheck: 'false', 'aria-label': label + ': item' });
    const pinB = btn('Pin', '', () => { v.item = c.code + '.' + k; it.value = v.item; changed(); }, { title: 'This week’s ' + PIN_NAMES[k], 'data-k': 'pin.' + k });
    const tk = tok ? num('rw.' + k + '.tok', () => v.tok, (x) => { v.tok = x; }, { min: '0', max: '9', 'aria-label': label + ': unlock tokens' }) : null;
    g.append(field(label, 'rw.' + k, h('div', { class: 'adm-rw' }, it, pinB, tk ? h('span', { class: 'adm-tokl' }, tk, h('span', null, 'tokens')) : null), null, true));
  }
  g.append(field('Terms', 'terms', area('terms', () => D.terms, (v) => { D.terms = v; }, { maxlength: '2000', rows: '5' })));
  return g;
}

function saveBar() {
  R.saveBtn = btn('Save', 'gold', save);
  R.discardBtn = btn('Discard changes', '', () => { st.draft = JSON.parse(JSON.stringify(st.base)); renderComp(); toast('Changes discarded.', true); });
  R.saveNote = h('span', { class: 'adm-savenote', 'aria-live': 'polite' });
  R.saveMsg = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
  return h('div', { class: 'adm-savebar' }, h('div', { class: 'adm-row' }, R.saveBtn, R.discardBtn, R.saveNote), R.saveMsg);
}
// live: what is wrong under each field, the save button, the amounts and the sheet
function changed() {
  if (!st.draft || !R.saveBtn || !R.saveBtn.isConnected) return;
  const P = cfgProblems(st.draft, C.E);
  for (const [f, el] of Object.entries(R.errs)) {
    el.textContent = P[f] || '';
    if (R.ctl[f]) R.ctl[f].setAttribute('aria-invalid', P[f] ? 'true' : 'false');
  }
  const n = Object.keys(P).length;
  const d = dirty();
  R.saveBtn.disabled = !d || n > 0;
  R.discardBtn.disabled = !d;
  R.saveNote.textContent = n ? n + (n === 1 ? ' thing' : ' things') + ' to fix' : d ? 'Unsaved changes' : 'Saved';
  R.saveNote.className = 'adm-savenote ' + (n ? 'bad' : d ? 'warn' : 'ok');
  renderAmounts();
  renderSheet();
}
async function save() {
  const c = st.compFull;
  const E = C.E;
  const P = cfgProblems(st.draft, E);
  if (Object.keys(P).length) { say(R.saveMsg, 'Fix what is marked first.', false); return; }
  const cfg = cfgChanges(st.draft, st.base, E);
  if (!Object.keys(cfg).length) { say(R.saveMsg, 'Nothing changed.'); return; }
  if (st.busy) return;
  st.busy = true;
  say(R.saveMsg, 'Saving…');
  try {
    const r = await A.comps.edit(c.code, { cfg, v: c.v });
    st.busy = false;
    st.draft = null;
    setComp(r.comp, true);
    toast('Saved #' + r.comp.n + '.', true);
    refresh();
  } catch (e) {
    st.busy = false;
    const mark = (f) => { if (f && R.errs[f]) R.errs[f].textContent = e.message; };
    if (e && e.code === 'stale') {
      await reread();
      say(R.saveMsg, 'Another moderator changed #' + c.n + ' again while your changes were sent a second time: it was read again, with your changes on top. Check them and save again.', false);
    } else if (e && e.code === 'locked_field') {
      say(R.saveMsg, 'Refused: ' + (e.field || 'that setting') + ' is locked since ' + (e.since || 'open') + '.', false);
      mark(e.field);
    } else if (e && e.code === 'bad_cfg') {
      say(R.saveMsg, 'Refused: check ' + (e.field || 'the setup') + '. ' + e.message, false);
      mark(e.field);
    } else say(R.saveMsg, (e && e.message) || 'Saving did not work.', false);
  }
}
// the rules sheet as players will see it (from the setup as it is being edited)
function renderSheet() {
  if (!R.sheet || !R.sheet.isConnected) return;
  const c = st.compFull;
  // once the hall has the player's component, one line: R.sheet.replaceChildren(C.Hall.compSheet(st.draft));
  R.sheet.replaceChildren(sheetNode(rulesSheet(st.draft, C.E, { n: c.n, sup: c.sup, chain: st.chain })));
}
function sheetNode(S) {
  const box = h('div', { class: 'adm-sheetin' }, h('b', { class: 'adm-sheett' }, S.title));
  for (const sec of S.sections) {
    const ul = h('ul', null);
    for (const row of sec.rows) ul.append(h('li', null, ...row.map((b) => (b.ban ? h('s', { title: 'Banned' }, b.t) : b.cap ? h('span', { class: 'adm-capt' }, b.t) : b.t))));
    box.append(h('h5', { 'data-sec': sec.id }, sec.h), ul);
  }
  return box;
}
// two decks under the setup's rules in the arena view: 0 commands, nothing stored
async function simulate() {
  const E = C.E;
  const c = st.compFull;
  const rules = st.draft.rules;
  const n = ++st.simN;
  let decks = [];
  try {
    if (A.decks && typeof A.decks.library === 'function') decks = ((await A.decks.library()).decks || []).filter((d) => !d.retired && Array.isArray(d.plan) && E.cleanSquad(d.plan[0]));
  } catch { /* no deck library on this backend yet: the league's bot squads stand in */ }
  const r = E.rng(7000 + n);
  const legal = decks.filter((d) => !squadProblems(d.plan[0], rules, E).length);
  const pool = legal.length >= 2 ? legal : decks.slice();
  const sides = [0, 1].map((i) => {
    const d = pool.length ? pool.splice(Math.floor(r() * pool.length), 1)[0] : null;
    const id = simBotId(d, i);
    const face = (C.Hall.botFace && C.Hall.botFace(id)) || { name: 'Bot ' + (i + 1), look: {}, style: 'fierce', bot: true };
    const squad = d ? E.cleanSquad(d.plan[0]) : E.leagueBotSquad('sim' + n, id);
    return { label: d ? d.n || 'Deck #' + d.id : face.name, face, squad };
  });
  const broke = sides.map((s) => ({ s, p: squadProblems(s.squad, rules, E) })).filter((x) => x.p.length);
  const partName = (p) => { const L = RULE_PARTS.find((x) => x[0] === p.part); return (p.id === '*' ? 'the kit' : nameIn(E, L[2], p.id)) + ' (' + p.n + ', at most ' + p.max + ')'; };
  const play = playOf(rules.arena, E);
  const pre = presetOf(play, E);
  say(R.simMsg2, simLine(pre ? E.RULE_PRESETS.find((x) => x.id === pre).name : 'Custom rules', broke.map((x) => x.s.label + ' breaks ' + x.p.map(partName).join(', '))));
  const five = (x) => [0, 1, 2, 3, 4].map(() => x);
  // a fresh fight every time; a fixed seed fixes the arena (mapSeed), as the daily run plays it
  const seed = 1 + Math.floor(r() * 2147483000);
  const fixed = rules.arena.seedMode === 'fixed' && Number.isInteger(rules.arena.seed) ? { mapSeed: rules.arena.seed >>> 0 } : {};
  const sim = { ...play, ...fixed };
  C.View.play({ kind: 'show', title: 'Simulate · ' + c.cfg.name + ' · ' + sides[0].label + ' vs ' + sides[1].label, teams: sides.map((s) => ({ label: s.label, names: five(s.face.name), looks: five(s.face.look), squad: s.squad })), viewer: -1, seed, bo: 1, ...(Object.keys(sim).length ? { rules: sim } : {}) });
}

/* ---- starting and stopping ---- */
function renderLeague() {
  const o = st.ov;
  R.lgState.textContent = o.paused
    ? 'The leagues are paused: the daily matches wait, and players see “Paused”. The first daily run after you resume plays the days missed.'
    : 'The leagues are running: every day just after midnight UTC each group and friend league plays 5 rounds, 3 points for a win and 1 for a loss.';
  R.lgBtns.textContent = '';
  R.lgBtns.append(
    o.paused
      ? btn('Resume the leagues', 'gold', () => act(R.lgMsg, () => A.league('resume'), 'The leagues run again.'))
      : btn('Pause the leagues', '', () => act(R.lgMsg, () => A.league('pause'), 'The leagues are paused.')),
    sureBtn('Start this week over', 'pink', () => act(R.lgMsg, () => A.league('week'), 'This week starts over: the next daily run draws the groups again and plays the days so far.'), 'Clear this week?'),
    sureBtn('Start every league over', 'pink', () => act(R.lgMsg, () => A.league('all'), 'Every league starts over: the next daily run puts everyone in Bronze Shrimp.'), 'Everyone to Bronze?'),
  );
  R.lgGroups.textContent = '';
  if (!o.groups.length) {
    R.lgGroups.append(h('p', { class: 'sq-desc' }, 'This week’s groups are drawn by the next daily run (just after midnight UTC).'));
    return;
  }
  for (const [i, name] of DIVS.entries()) {
    const gs = o.groups.filter((g) => g.d === i + 1);
    if (!gs.length) continue;
    R.lgGroups.append(h('div', { class: 'adm-grow' }, h('b', null, h('i', { style: 'background:' + DIV_COL[i] }), name),
      ...gs.map((g) => h('span', { title: g.m.filter((m) => BOT_RE.test(m[0])).length + ' bots' }, 'group ' + (g.g + 1) + ' · ' + g.m.length))));
  }
}

/* ---- Wallets: find one (or the bans), its screen, the inventory, bulk changes ---- */
// a change the server does not know yet (an older server: S5 brings the inventory and the log)
const notYet = (e) => !!(e && e.status === 404 && (e.code === 'not_found' || !e.code));
const NOT_YET = 'Not on this server yet: this comes with the server’s next update.';
function walletErr(e) {
  if (notYet(e)) return NOT_YET;
  if (e && e.code === 'too_many') return 'From 1 to 100 wallets at a time.';
  return (e && e.message) || 'That did not work.';
}
// a reason the log keeps: required, at most 80 characters
const REASON_MAX = 80;
const reasonOf = (el) => String((el && el.value) || '').replace(/\s+/g, ' ').trim().slice(0, REASON_MAX);
// a change on the Wallets tab: the message, a toast, the overview and the screen read again
function walletDo(msgEl, fn, done) {
  return act(msgEl, () => fn().catch((e) => { throw Object.assign(new AdminError(e && e.status, e && e.code, walletErr(e)), { wallet: e && e.wallet }); }), (r) => {
    const text = typeof done === 'function' ? done(r) : done;
    toast(text, true);
    return text;
  });
}
// the exclusives the page knows (the catalog's EXCL once it lands; the sandbox's own list until then)
function exclMap() {
  if (C && C.excl && typeof C.excl === 'object') return C.excl;
  try { if (A && A.sandbox && typeof A.sandbox.excl === 'function') return A.sandbox.excl() || {}; } catch { /* none */ }
  return {};
}
const PIN_TIERS = ['p1', 'p2', 'p3', 't10', 'all'];
// what an item is: its class (pin, comp, unlock, community, exclusive) and a readable name
function itemInfo(item) {
  if (PIN_RE.test(item) || PIN_PH.test(item)) {
    const [c0, t] = item.split('.');
    const code = c0 === 'pin' ? (st.compFull ? st.compFull.code : null) : c0;
    const c = ((st.ov && st.ov.comps) || []).find((x) => x.code === code);
    return { cls: 'pin', label: (c ? '#' + c.n + ' ' : '') + PIN_NAMES[t], code };
  }
  return { cls: exclMap()[item] || 'exclusive', label: item, code: null };
}
// a select of the item ids the page knows, and a free id for the rest
function itemPicker(label, value) {
  const sel = h('select', { class: 'adm-sel', 'aria-label': label });
  const ex = Object.entries(exclMap());
  if (ex.length) sel.append(h('optgroup', { label: 'Exclusives' }, ...ex.map(([id, cls]) => h('option', { value: id }, id + ' · ' + cls))));
  for (const c of (st.ov && st.ov.comps) || []) sel.append(h('optgroup', { label: 'Pins of #' + c.n + ' ' + c.name }, ...PIN_TIERS.map((t) => h('option', { value: c.code + '.' + t }, '#' + c.n + ' ' + PIN_NAMES[t]))));
  sel.append(h('option', { value: '' }, 'Another id…'));
  const free = h('input', { class: 'sq-pfin adm-itemid', placeholder: 'Item id (hat:ghost, <code>.p1)', maxlength: '40', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Item id', hidden: true });
  const known = [...sel.querySelectorAll('option')].map((o) => o.value).filter(Boolean);
  const set = (v) => {
    if (v && known.includes(v)) { sel.value = v; free.hidden = true; }
    else if (v) { sel.value = ''; free.hidden = false; free.value = v; }
    else { sel.value = known[0] || ''; free.hidden = !!known.length; }
  };
  sel.onchange = () => { free.hidden = sel.value !== ''; if (!free.hidden) free.focus(); };
  free.oninput = () => free.removeAttribute('aria-invalid');
  set(value);
  return {
    el: h('span', { class: 'adm-itempick' }, sel, free), set,
    value: () => (sel.value || free.value.trim()),
    check(msgEl) {
      const v = sel.value || free.value.trim();
      if (ITEM_RE.test(v)) return v;
      free.setAttribute('aria-invalid', 'true');
      if (!free.hidden) free.focus();
      say(msgEl, 'An item id is 2 to 40 characters: a-z, 0-9 and _ . : -', false);
      return null;
    },
  };
}
const reasonBox = (label) => h('input', { class: 'sq-pfin adm-reason', placeholder: 'Reason (required, kept in the log)', maxlength: String(REASON_MAX), 'aria-label': label || 'Reason' });
function needReason(el, msgEl) {
  const r = reasonOf(el);
  if (r) return r;
  el.setAttribute('aria-invalid', 'true');
  el.oninput = () => el.removeAttribute('aria-invalid');
  el.focus();
  say(msgEl, 'Write a reason first: the log and the wallet’s history keep it.', false);
  return null;
}

let findSeq = 0;
async function renderFind() {
  const raw = st.q.trim(), q = raw.toLowerCase();
  const bans = (st.ov && st.ov.bans) || [];
  // the two filters: search results and the bans (with their count)
  R.wChips.textContent = '';
  for (const [k, label, n] of [['find', 'Search', null], ['bans', 'Bans', bans.length]]) {
    R.wChips.append(h('button', { type: 'button', class: 'adm-ef' + (st.wf === k ? ' on' : ''), 'aria-pressed': String(st.wf === k), 'data-wf': k, onclick: () => { st.wf = k; renderFind(); } }, label, n === null ? null : h('b', null, String(n))));
  }
  R.found.textContent = '';
  const inLeague = new Map();
  for (const g of st.ov ? st.ov.groups : []) for (const m of g.m) inLeague.set(m[0], g);
  if (st.wf === 'bans') {
    const list = bans.filter((b) => q.length < 2 || b.id.toLowerCase().includes(q) || nameOf(b.id).toLowerCase().includes(q) || (b.reason || '').toLowerCase().includes(q));
    if (!list.length) { R.found.append(h('li', { class: 'sq-empty' }, bans.length ? 'No ban matches the search.' : 'Nobody is banned.')); return; }
    for (const b of list) {
      const msg = h('span', { class: 'sq-msg', 'aria-live': 'polite' });
      const w = who(b.id);
      R.found.append(h('li', { class: 'adm-ban', 'data-id': b.id }, h('span', { class: 'adm-banw' }, w ? face(w.look, w.style) : h('span', { class: 'sq-noface' }), h('span', { class: 'lg-who' }, h('span', { class: 'lg-name' }, h('b', null, nameOf(b.id, w)), pill('Banned', 'bad')),
        h('span', { class: 'lg-sub' }, h('span', { class: 'lg-addr', title: b.id }, short(b.id)), copyBtn(b.id), h('span', null, (b.reason || 'no reason given') + (b.t ? ' · ' + ago(b.t) : '') + (b.by ? ' · by ' + (ADDR_RE.test(b.by) ? short(b.by) : b.by) : ''))))),
      h('span', { class: 'adm-row' }, btn('Open', '', () => loadPlayer(b.id)), btn('Unban', 'gold', () => walletDo(msg, () => A.playerDo({ do: 'unban', id: b.id }), nameOf(b.id) + ' is let back in.'))), msg));
    }
    return;
  }
  if (q.length < 2) { R.found.append(h('li', { class: 'sq-empty adm-hint' }, 'Type 2 or more characters: an address, a profile name or a Blub’s name.')); return; }
  let hits;
  if (A.wallets && typeof A.wallets.find === 'function') {
    // the sandbox knows its own wallets
    const seq = ++findSeq;
    try { hits = (await A.wallets.find(q)).hits.map((x) => x.id); } catch { hits = []; }
    if (seq !== findSeq) return;
    for (const id of inLeague.keys()) if (hits.length < 12 && !hits.includes(id) && id.toLowerCase().includes(q)) hits.push(id);
  } else {
    const ids = new Set([...C.docs().keys(), ...inLeague.keys()]);
    hits = [...ids].filter((id) => {
      const w = who(id);
      return id.toLowerCase().includes(q) || (w && ((w.name || '').toLowerCase().includes(q) || (w.player || '').toLowerCase().includes(q)));
    }).slice(0, 12);
  }
  // a whole wallet address can always be opened, even one with no team in the Meadow list
  if (ADDR_RE.test(raw) && !hits.includes(raw)) hits.unshift(raw);
  R.found.textContent = '';
  if (!hits.length) { R.found.append(h('li', { class: 'sq-empty' }, 'Nobody found.')); return; }
  const B = banned();
  for (const id of hits) {
    const w = who(id), g = inLeague.get(id);
    R.found.append(h('li', null, h('button', { type: 'button', class: 'adm-hit' + (st.player && st.player.id === id ? ' on' : ''), 'aria-current': st.player && st.player.id === id ? 'true' : null, onclick: () => loadPlayer(id) },
      w ? face(w.look, w.style) : h('span', { class: 'sq-noface' }),
      h('span', { class: 'lg-who' }, h('span', { class: 'lg-name' }, h('b', null, nameOf(id, w)), w && w.bot ? h('span', { class: 'lg-tag bot' }, 'Bot') : null, B.has(id) ? pill('Banned', 'bad') : null),
        h('span', { class: 'lg-sub' }, h('span', { class: 'lg-addr' }, short(id)), g ? h('span', null, DIVS[g.d - 1] + ' · group ' + (g.g + 1)) : h('span', null, 'not in this week’s league'))))));
  }
}
async function loadPlayer(id, quiet) {
  if (!quiet) say(R.pMsg, 'Loading…');
  if (BOT_RE.test(id)) {
    st.player = { id, bot: true };
    say(R.pMsg, '');
    renderPlayer();
    return;
  }
  try {
    st.player = await A.player(id);
    if (!quiet) say(R.pMsg, '');
  } catch (e) {
    if (e && e.behind && st.player && st.player.id === id) say(R.pMsg, BEHIND_SAY);
    else say(R.pMsg, (e && e.message) || 'That wallet did not load.', false);
  }
  renderPlayer();
  if (!quiet) {
    for (const b of R.found.querySelectorAll('.adm-hit')) b.classList.remove('on');
    // on a phone the screen is below the list: bring it up
    if (narrow() && R.wCard && R.wCard.scrollIntoView) R.wCard.scrollIntoView({ block: 'start', behavior: smooth() });
  }
}
// this week's league record of an id, from the overview
function weekOf(id) {
  for (const g of st.ov ? st.ov.groups : []) {
    const k = g.m.findIndex((m) => m[0] === id);
    if (k >= 0) return { d: g.d, g: g.g, rank: k + 1, n: g.m.length, p: g.m[k][1], w: g.m[k][2], l: g.m[k][3] };
  }
  return null;
}
const sec = (title, id, ...kids) => h('section', { class: 'adm-wsec', 'aria-labelledby': id }, h('h4', { id }, title), ...kids);
function renderPlayer() {
  const P = st.player;
  R.pBody.textContent = '';
  if (!P) { R.pBody.append(h('p', { class: 'sq-empty adm-hint' }, 'Pick a wallet from the search or the bans: its rank, team, competitions, inventory and history show here.')); return; }
  const id = P.id, lg = weekOf(id), edit = (o, done) => walletDo(R.pMsg, () => A.playerDo({ id, ...o }), done);
  const blub = P.blub, w = who(id) || (blub ? { name: blub.name, player: blub.player, look: blub.look, style: blub.style } : null);
  const title = P.bot ? w.name : blub ? blub.player || blub.name : short(id);
  R.pBody.append(h('div', { class: 'adm-phead' }, w ? face(w.look, w.style, true) : h('span', { class: 'sq-noface' }),
    h('div', { class: 'lg-who' }, h('span', { class: 'lg-name' }, h('b', { id: 'admWalT' }, title), P.bot ? h('span', { class: 'lg-tag bot' }, 'Bot') : null, P.ban ? pill('Banned', 'bad') : null),
      P.bot ? h('span', { class: 'lg-sub' }, 'A bot this week, not a player') : h('span', { class: 'lg-sub' }, h('span', { class: 'lg-addr', title: id }, short(id)), copyBtn(id), blub ? h('span', null, 'Blub ' + blub.name) : h('span', null, 'no team saved')))));
  const facts = h('dl', { class: 'adm-facts' });
  const fact = (k, v) => facts.append(h('dt', null, k), h('dd', null, v));
  fact('This week', lg ? DIVS[lg.d - 1] + ' · group ' + (lg.g + 1) + ' · #' + lg.rank + ' of ' + lg.n + ' · ' + lg.p + ' points (' + lg.w + '–' + lg.l + ')' : 'not in the league');
  if (!P.bot) {
    fact('Rank', P.last ? DIVS[P.last.d - 1] + ' (last played in week ' + Number(P.last.week.slice(5)) + ')' : 'never played: Bronze Shrimp');
    fact('Season', P.rating ? P.rating.r + ' rating · ' + P.rating.w + '–' + P.rating.l : 'no rated duel this month');
    fact('Team', blub ? 'saved ' + (ago(blub.updated) || '') + (blub.created ? ' · made ' + (ago(blub.created) || '') : '') : 'none');
    if (P.ban) fact('Banned', (P.ban.reason || 'no reason given') + (P.ban.t ? ' · ' + ago(P.ban.t) : ''));
    if (P.troph && P.troph.length) fact('Trophies', P.troph.join(', '));
  }
  R.pBody.append(facts);
  // points this week
  const num = (v, label) => h('input', { class: 'sq-pfin adm-num', type: 'number', min: '0', max: '9999', value: String(v), 'aria-label': label });
  if (lg) {
    const p = num(lg.p, 'Points'), wn = num(lg.w, 'Wins'), ls = num(lg.l, 'Losses');
    R.pBody.append(h('h4', null, 'Points this week'), h('div', { class: 'adm-row' }, h('label', null, 'Points', p), h('label', null, 'Won', wn), h('label', null, 'Lost', ls),
      btn('Save', 'gold', () => edit({ do: 'points', p: +p.value, w: +wn.value, l: +ls.value }, 'Points saved.'))));
  }
  // rank
  const sel = h('select', { class: 'adm-sel', 'aria-label': 'Rank' }, ...DIVS.map((n, i) => h('option', { value: String(i + 1) }, n)));
  sel.value = String(lg ? lg.d : P.last ? P.last.d : 1);
  R.pBody.append(h('h4', null, P.bot ? 'This week' : 'Rank from next week'), h('div', { class: 'adm-row' },
    P.bot ? null : sel, P.bot ? null : btn('Move', '', () => edit({ do: 'division', d: +sel.value }, 'Plays in ' + DIVS[+sel.value - 1] + ' from next week.')),
    lg ? sureBtn('Take out of this week', 'pink', () => edit({ do: 'remove' }, 'Out of this week’s league.'), 'Take out?') : null));
  if (P.bot) return;
  // the profile name, a ban, the team itself
  const why = h('input', { class: 'sq-pfin', placeholder: 'Reason (shown in the log)', maxlength: '80', 'aria-label': 'Reason for the ban' });
  R.pBody.append(h('h4', null, 'Moderation'), h('div', { class: 'adm-row' },
    blub && blub.player ? sureBtn('Wipe profile name', '', () => edit({ do: 'clearname' }, 'Profile name wiped: the address shows.'), 'Wipe it?') : null,
    P.ban ? btn('Unban', 'gold', () => edit({ do: 'unban' }, 'Let back in.')) : null,
    blub ? sureBtn('Remove team', 'pink', () => edit({ do: 'removeTeam' }, 'Team removed from the Meadow.'), 'Remove for good?') : null));
  if (!P.ban) R.pBody.append(h('div', { class: 'adm-row' }, why, sureBtn('Ban', 'pink', () => edit({ do: 'ban', reason: why.value }, 'Banned: no duels, out of this week’s league.'), 'Ban this wallet?')));
  // into the simulation
  if (blub) R.pBody.append(h('div', { class: 'adm-row' },
    btn('Use as side A', '', () => { st.pick[0] = P; renderSim(); showTab('leagues'); }, { title: 'Replay a duel on the Leagues tab' }), btn('Use as side B', '', () => { st.pick[1] = P; renderSim(); showTab('leagues'); }, { title: 'Replay a duel on the Leagues tab' })));
  R.pBody.append(walletComps(P), walletInv(P), walletHist(P));
}
// the competitions this wallet took part in (cmw): state and place, a link to each
function walletComps(P) {
  const box = sec('Competitions', 'admWalC');
  if (!Array.isArray(P.cmw)) { box.append(h('p', { class: 'sq-desc' }, NOT_YET)); return box; }
  if (!P.cmw.length) { box.append(h('p', { class: 'sq-desc' }, 'No competitions yet.')); return box; }
  const ol = h('ol', { class: 'adm-wcomps' });
  for (const x of P.cmw) {
    const known = ((st.ov && st.ov.comps) || []).find((c) => c.code === x.code);
    ol.append(h('li', null, h('button', { type: 'button', class: 'adm-wcomp', onclick: goComp(x.code, STEP_OF[(known || x).st] || 'setup'), title: 'Open #' + x.n + ' on the Competitions tab' },
      h('b', null, '#' + x.n), h('span', null, known ? known.name : ''), stPill(x.st), x.place ? h('span', { class: 'adm-wplace' }, nth1(x.place) + ' place') : h('span', { class: 'adm-wplace dim' }, placeless(x.st)), h('i', { 'aria-hidden': 'true' }, '›'))));
  }
  box.append(ol);
  return box;
}
// a place is known for the winner, and for 2nd and 3rd once the rewards are given (their
// podium tags, lib/admin.mjs adminPlayer); without one the line says what is known
export const placeless = (st) => (st === 'rewarded' ? 'off the podium' : st === 'done' || st === 'settled' ? 'not the winner' : st === 'void' ? 'no places' : 'playing');
const nth1 = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th');
// where an item came from: the newest "Given" line of the history that names it
function itemSource(P, item) {
  const x = histOf(P).find((r) => /^Given\b/.test(r.what || '') && (r.what || '').split(/\s+/).includes(item));
  return x ? (x.why || 'by hand') + (x.t ? ' · ' + ago(x.t) : '') : 'no history line';
}
const histOf = (P) => (Array.isArray(P.invh) ? P.invh.slice().sort((a, b) => Date.parse(b.t) - Date.parse(a.t)) : []);
// the inventory: the items with their class and source, the tokens, give, take and ±tokens
function walletInv(P) {
  const box = sec('Inventory', 'admWalI');
  if (!P.inv) { box.append(h('p', { class: 'sq-desc' }, NOT_YET)); return box; }
  const id = P.id, inv = P.inv, items = inv.items || [];
  const can = !!(A.wallets && typeof A.wallets.inventory === 'function');
  const msg = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
  const why = reasonBox('Reason for the change');
  const pick = itemPicker('Item to give or take');
  const take = (item) => { const r = needReason(why, msg); if (r) walletDo(msg, () => A.wallets.inventory({ do: 'take', wallets: [id], item, why: r }), 'Took ' + itemInfo(item).label + ' from ' + nameOf(id) + '.'); };
  const ul = h('ul', { class: 'adm-items', 'aria-label': 'Items' });
  if (!items.length) ul.append(h('li', { class: 'sq-empty' }, 'No exclusive items or pins.'));
  for (const item of items) {
    const I = itemInfo(item);
    ul.append(h('li', { class: 'adm-item', 'data-item': item }, h('span', { class: 'adm-itemn' }, h('b', null, I.label), pill(I.cls, 'adm-cls-' + I.cls)),
      h('span', { class: 'lg-sub' }, h('span', { class: 'lg-addr' }, item), h('span', null, itemSource(P, item))),
      can ? sureBtn('Take', 'pink adm-mini', () => take(item), 'Take it?') : null));
  }
  box.append(h('div', { class: 'adm-tokrow' }, h('b', { class: 'adm-big', 'data-tok': String(inv.tok) }, String(inv.tok)), h('span', null, 'unlock token' + (inv.tok === 1 ? '' : 's'), h('br'), h('span', { class: 'adm-fine' }, 'in-game only: a token buys one unlock-class look'))), ul);
  if (!can) { box.append(h('p', { class: 'sq-desc' }, NOT_YET)); return box; }
  const tok = h('input', { class: 'sq-pfin adm-num', type: 'number', min: '-99', max: '99', step: '1', value: '1', 'aria-label': 'Tokens to give (or take, below 0)' });
  const tokGo = btn('Give 1 token', '', null);
  const tokN = () => Math.trunc(Number(tok.value));
  tok.oninput = () => { const n = tokN(); tokGo.textContent = !n || !Number.isFinite(n) ? 'Tokens' : (n > 0 ? 'Give ' + n : 'Take ' + -n) + ' token' + (Math.abs(n) === 1 ? '' : 's'); };
  tokGo.onclick = () => {
    const n = tokN();
    if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 99) { tok.setAttribute('aria-invalid', 'true'); return say(msg, 'A whole number of tokens from -99 to 99, not 0.', false); }
    tok.removeAttribute('aria-invalid');
    const r = needReason(why, msg);
    if (r) walletDo(msg, () => A.wallets.tokens({ wallets: [id], n, why: r }), (x) => (x && x.n === 0 ? 'Nothing changed: the count stays at ' + inv.tok + '.' : (n > 0 ? 'Gave ' + n : 'Took ' + -n) + ' token' + (Math.abs(n) === 1 ? '' : 's') + (n > 0 ? ' to ' : ' from ') + nameOf(id) + (x && x.inv ? ': ' + x.inv.tok + ' now.' : '.')));
  };
  box.append(h('div', { class: 'adm-invform' },
    h('label', { class: 'adm-field' }, h('span', { class: 'adm-fl' }, 'Reason'), why),
    h('div', { class: 'adm-row' }, pick.el,
      btn('Give item', 'gold', () => { const item = pick.check(msg); const r = item && needReason(why, msg); if (r) walletDo(msg, () => A.wallets.inventory({ do: 'give', wallets: [id], item, why: r }), (x) => (x && x.n === 0 ? nameOf(id) + ' owns ' + itemInfo(item).label + ' already.' : 'Gave ' + itemInfo(item).label + ' to ' + nameOf(id) + '.')); }),
      sureBtn('Take item', 'pink', () => { const item = pick.check(msg); if (item) take(item); }, 'Take it?')),
    h('div', { class: 'adm-row' }, h('label', null, 'Tokens ±', tok), tokGo),
    msg));
  return box;
}
// the inventory's history, newest first
function walletHist(P) {
  const box = sec('History', 'admWalH');
  if (!Array.isArray(P.invh)) { box.append(h('p', { class: 'sq-desc' }, NOT_YET)); return box; }
  const list = histOf(P);
  if (!list.length) { box.append(h('p', { class: 'sq-desc' }, 'Nothing given or taken yet.')); return box; }
  const ol = h('ol', { class: 'adm-log adm-hist' });
  for (const x of list) ol.append(h('li', null, h('span', { class: 'adm-when', title: x.t || '' }, ago(x.t)), h('span', { class: 'lg-addr', title: x.by || '' }, x.by ? (ADDR_RE.test(x.by) ? short(x.by) : x.by) : ''), h('span', null, x.what || '', x.why ? h('span', { class: 'adm-why' }, ' · ' + x.why) : null)));
  box.append(ol);
  return box;
}

// a bulk paste: addresses one a line (or between spaces and commas), each once, at most
// 100; whatever is not an address is listed and skipped
export function parseBulk(text, max = 100) {
  const ok = [], bad = [];
  let dup = 0, over = 0;
  for (const w of String(text || '').split(/[\s,;]+/)) {
    if (!w) continue;
    if (!ADDR_RE.test(w)) { const b = w.slice(0, 60); if (!bad.includes(b)) bad.push(b); continue; }
    if (ok.includes(w)) { dup++; continue; }
    if (ok.length >= max) { over++; continue; }
    ok.push(w);
  }
  return { ok, bad, dup, over };
}
function renderBulk() {
  const box = R.bulkBody;
  if (!box) return;
  box.textContent = '';
  const can = !!(A.wallets && typeof A.wallets.inventory === 'function');
  const ta = h('textarea', { class: 'sq-pfin adm-bulkta', rows: '6', placeholder: 'One wallet address a line, up to 100', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Wallet addresses, one a line' });
  ta.value = st.bulk.text;
  const parsed = h('p', { class: 'adm-state', 'aria-live': 'polite' });
  const kind = h('select', { class: 'adm-sel', 'aria-label': 'What to change' }, h('option', { value: 'give' }, 'Give an item'), h('option', { value: 'take' }, 'Take an item'), h('option', { value: 'tokens' }, 'Tokens ±'));
  kind.value = st.bulk.kind;
  const pick = itemPicker('Item for every wallet', st.bulk.item);
  const tok = h('input', { class: 'sq-pfin adm-num', type: 'number', min: '-99', max: '99', step: '1', value: String(st.bulk.n), 'aria-label': 'Tokens for every wallet (below 0 takes)' });
  const why = reasonBox('Reason for the bulk change');
  why.value = st.bulk.why;
  const msg = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
  const out = h('div', { class: 'adm-bulkout' });
  const goBox = h('span', { class: 'adm-bulkgo' });
  const draw = () => {
    st.bulk.text = ta.value; st.bulk.kind = kind.value; st.bulk.n = Math.trunc(Number(tok.value)) || 0; st.bulk.why = why.value; st.bulk.item = pick.value();
    const p = parseBulk(ta.value);
    parsed.textContent = s_(p.ok.length, 'address', 'addresses') + (p.bad.length ? ' · ' + p.bad.length + ' not an address (skipped)' : '') + (p.dup ? ' · ' + s_(p.dup, 'double') + ' left out' : '') + (p.over ? ' · ' + p.over + ' over 100 left out' : '');
    parsed.classList.toggle('bad', !!p.bad.length);
    pick.el.hidden = kind.value === 'tokens';
    tok.parentNode && (tok.parentNode.hidden = kind.value !== 'tokens');
    const n = p.ok.length, t = st.bulk.n;
    const verb = kind.value === 'give' ? 'Give to ' : kind.value === 'take' ? 'Take from ' : (t < 0 ? 'Take ' + -t : 'Give ' + t) + ' token' + (Math.abs(t) === 1 ? '' : 's') + (t < 0 ? ' from ' : ' to ');
    goBox.textContent = '';
    const go = sureBtn(verb + s_(n, 'wallet'), kind.value === 'take' || (kind.value === 'tokens' && t < 0) ? 'pink' : 'gold', () => run(p), 'Sure? ' + s_(n, 'wallet') + ', one request');
    if (!n || !can) go.setAttribute('aria-disabled', 'true');
    goBox.append(go);
  };
  const run = (p) => {
    if (!can) return say(msg, NOT_YET, false);
    if (!p.ok.length) return say(msg, 'Paste one or more wallet addresses first.', false);
    let call;
    if (kind.value === 'tokens') {
      const n = Math.trunc(Number(tok.value));
      if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 99) { tok.setAttribute('aria-invalid', 'true'); return say(msg, 'A whole number of tokens from -99 to 99, not 0.', false); }
      tok.removeAttribute('aria-invalid');
      const r = needReason(why, msg); if (!r) return;
      call = () => A.wallets.tokens({ wallets: p.ok, n, why: r });
    } else {
      const item = pick.check(msg); if (!item) return;
      const r = needReason(why, msg); if (!r) return;
      call = () => A.wallets.inventory({ do: kind.value, wallets: p.ok, item, why: r });
    }
    out.textContent = '';
    walletDo(msg, call, (r) => {
      const n = (r && r.n) || 0;
      out.append(h('p', { class: 'adm-bulkres' }, h('b', null, s_(n, 'wallet') + ' changed'), n < p.ok.length ? ' · ' + (p.ok.length - n) + ' had nothing to change' : ''));
      if (p.bad.length) out.append(h('p', { class: 'adm-fine' }, 'Skipped, not wallet addresses:'), h('ul', { class: 'adm-badlist' }, ...p.bad.map((b) => h('li', null, b))));
      return s_(n, 'wallet') + ' changed.';
    }).then(() => { if (out.childNodes.length) say(msg, ''); });
  };
  for (const el of [ta, kind, tok, why]) el.addEventListener('input', draw);
  kind.onchange = draw;
  pick.el.addEventListener('change', draw);
  pick.el.addEventListener('input', draw);
  box.append(h('p', { class: 'sq-desc' }, 'The same item or token change for many wallets at once: one request for up to 100. Whatever is not a wallet address is listed and skipped.'),
    ta, parsed,
    h('div', { class: 'adm-row' }, kind, pick.el, h('label', null, 'Tokens ±', tok)),
    h('label', { class: 'adm-field' }, h('span', { class: 'adm-fl' }, 'Reason'), why),
    h('div', { class: 'adm-row' }, goBox),
    msg, out);
  if (!can) box.append(h('p', { class: 'sq-desc' }, NOT_YET));
  draw();
}

/* ---- the simulation ---- */
function renderSim() {
  const o = st.ov;
  R.moves.textContent = '';
  const any = o.groups.some((g) => Math.floor(g.m.length / 5) > 0);
  if (!any) R.moves.append(h('p', { class: 'sq-desc' }, 'Nobody moves yet: a group needs 5 or more to send its top and bottom fifth up and down.'));
  for (const g of o.groups) {
    const mv = Math.floor(g.m.length / 5);
    if (!mv) continue;
    const up = g.d < DIVS.length ? g.m.slice(0, mv) : [], down = g.d > 1 ? g.m.slice(-mv) : [];
    const names = (list) => list.map((m) => nameOf(m[0])).join(', ') || 'nobody';
    R.moves.append(h('div', { class: 'adm-move' }, h('b', null, h('i', { style: 'background:' + DIV_COL[g.d - 1] }), DIVS[g.d - 1] + ' · group ' + (g.g + 1)),
      // the winner moves up two steps, the rest of the top fifth one
      h('span', { class: 'up' }, '▲ ' + (g.d < DIVS.length ? nameOf(up[0][0]) + ' to ' + DIVS[Math.min(DIVS.length, g.d + 2) - 1] + (up.length > 1 ? '; to ' + DIVS[g.d] + ': ' + names(up.slice(1)) : '') : 'top rank')),
      h('span', { class: 'down' }, '▼ ' + (g.d > 1 ? 'to ' + DIVS[g.d - 2] + ': ' + names(down) : 'nobody goes below Bronze Shrimp'))));
  }
  R.simPick.textContent = '';
  const slot = (P, side) => h('div', { class: 'adm-slot' }, h('span', { class: 'adm-tl' }, 'Side ' + side),
    P ? h('b', null, P.blub.player || P.blub.name) : h('span', { class: 'sq-desc' }, 'Pick a wallet on the Wallets tab'),
    P ? h('span', { class: 'lg-sub' }, P.strats && P.strats.s ? 'its active strategy' : 'no saved strategy: a bot squad stands in') : null);
  const bo = h('select', { class: 'adm-sel', 'aria-label': 'Format' }, h('option', { value: '1' }, 'Best of 1'), h('option', { value: '3' }, 'Best of 3'));
  bo.value = String(st.bo);
  bo.onchange = () => { st.bo = Number(bo.value); };
  R.simPick.append(slot(st.pick[0], 'A'), h('span', { class: 'adm-vs' }, 'vs'), slot(st.pick[1], 'B'),
    h('div', { class: 'adm-row' }, bo, btn('Play', 'gold', playDuel, st.pick[0] && st.pick[1] ? {} : { 'aria-disabled': 'true' })));
}
// a saved team as the arena view takes it: names and looks of the five, and the squads
function teamOf(P) {
  const rec = P.blub, five = [C.memberOf(rec), ...C.mates(rec.squad, P.id, rec.style)];
  const list = P.strats && Array.isArray(P.strats.s) ? P.strats.s : [];
  const active = list[P.strats ? P.strats.a : 0];
  const squad = (active && C.E.cleanSquad(active.q)) || C.E.randomSquad(C.E.rng(1 + Math.floor(Math.random() * 1e6)));
  const rest = list.filter((s, i) => s && i !== (P.strats ? P.strats.a : 0)).map((s) => C.E.cleanSquad(s.q)).filter(Boolean);
  return { label: rec.player || rec.name, names: five.map((m) => m.name), looks: five.map((m) => m.look), squad, plan: [squad, ...rest] };
}
function playDuel() {
  const [a, b] = st.pick;
  if (!a || !b) return say(R.simMsg, 'Pick two players first: open a wallet on the Wallets tab and use them as side A and B.', false);
  const seed = 1 + Math.floor(Math.random() * 2147483000);
  const A_ = teamOf(a), B_ = teamOf(b);
  say(R.simMsg, '');
  C.View.play({ kind: 'show', title: 'Replay · ' + A_.label + ' vs ' + B_.label, teams: [A_, B_], viewer: -1, seed, bo: st.bo });
}

/* ---- the league's bots ---- */
function renderBots() {
  const per = DIVS.map((_, i) => st.ov.groups.filter((g) => g.d === i + 1).reduce((s, g) => s + g.m.filter((m) => BOT_RE.test(m[0])).length, 0));
  const all = per.reduce((s, n) => s + n, 0);
  R.botCount.textContent = all ? 'This week: ' + DIVS.map((n, i) => (per[i] ? per[i] + ' in ' + n : '')).filter(Boolean).join(', ') + '.' : 'No bots in this week’s league.';
}
/* ---- the log: filters by kind, competition, moderator and wallet; Undo ---- */
const KIND_NAME = { league: 'Leagues', player: 'Players', bots: 'Bots', comp: 'Competitions', entry: 'Entries', pay: 'Money', inv: 'Inventory', deck: 'Decks', rewards: 'Rewards' };
const kindOf = (x) => (LOG_KINDS.includes(x.kind) ? x.kind : 'league');
const byName = (by) => (by ? (ADDR_RE.test(by) ? short(by) : by) : '?');
// the lines a log filter shows (page-side): a whole address matches exactly, a part of one anywhere
export function logView(list, f) {
  const o = f || {};
  const w = String(o.wallet || '').trim();
  const ws = (x) => [x.wallet, ...(Array.isArray(x.wallets) ? x.wallets : [])].filter(Boolean);
  return (list || []).filter((x) => (!o.kind || kindOf(x) === o.kind) && (!o.comp || x.comp === o.comp) && (!o.by || x.by === o.by)
    && (!w || (ADDR_RE.test(w) ? ws(x).includes(w) : w.length >= 2 && ws(x).some((v) => v.includes(w)))));
}
// the lines the panel holds: the whole log when it was read (200), else the overview's 60
const logBase = () => (st.logAll || (st.ov && st.ov.log) || []).slice().sort((a, b) => (b.n || 0) - (a.n || 0));
async function loadFullLog(quiet) {
  if (st.logBusy) return;
  st.logBusy = true;
  if (!quiet) say(R.logMsg, 'Reading the whole log (1 database command)…');
  try {
    st.logAll = (await A.log({ limit: 200 })).log || [];
    st.logFull = true;
    st.logNo = false;
    if (!quiet) say(R.logMsg, '');
  } catch (e) {
    st.logAll = null;
    st.logNo = notYet(e);
    say(R.logMsg, st.logNo ? 'The whole log is ' + NOT_YET.charAt(0).toLowerCase() + NOT_YET.slice(1) + ' The overview’s last 60 lines show.' : (e && e.message) || 'The log did not load.', false);
  } finally {
    st.logBusy = false;
  }
  drawLog();
}
function renderLog() {
  // after a change the whole log is read again only while the Log tab is open
  if (st.logFull && st.tab === 'log') { st.logAll = null; loadFullLog(true); return; }
  if (st.logFull) st.logAll = null;
  drawLog();
}
function logFilters(base) {
  const f = st.lf;
  const chips = h('div', { class: 'adm-efilters', role: 'group', 'aria-label': 'Kind of change' });
  for (const k of ['', ...LOG_KINDS]) {
    const n = k ? base.filter((x) => kindOf(x) === k).length : base.length;
    if (k && !n && f.kind !== k) continue;
    chips.append(h('button', { type: 'button', class: 'adm-ef' + (f.kind === k ? ' on' : ''), 'aria-pressed': String(f.kind === k), 'data-k': k || 'all', onclick: () => { f.kind = k; drawLog(); } },
      k ? h('i', { class: 'adm-kdot adm-k-' + k, 'aria-hidden': 'true' }) : null, k ? KIND_NAME[k] : 'All', h('b', null, String(n))));
  }
  // the competitions: the ones the panel knows, and any code the log names
  const comps = (st.ov && st.ov.comps) || [];
  const codes = [...new Set([...comps.map((c) => c.code), ...base.map((x) => x.comp).filter(Boolean)])];
  const cs = h('select', { class: 'adm-sel', 'aria-label': 'Competition' }, h('option', { value: '' }, 'Every competition'),
    ...codes.map((code) => { const c = comps.find((x) => x.code === code); return h('option', { value: code }, c ? '#' + c.n + ' ' + c.name : code); }));
  cs.value = f.comp;
  cs.onchange = () => { f.comp = cs.value; drawLog(); };
  const bys = [...new Set(base.map((x) => x.by).filter(Boolean))];
  if (f.by && !bys.includes(f.by)) bys.push(f.by);
  const ms = h('select', { class: 'adm-sel', 'aria-label': 'Moderator' }, h('option', { value: '' }, 'Every moderator'), ...bys.map((b) => h('option', { value: b }, byName(b))));
  ms.value = f.by;
  ms.onchange = () => { f.by = ms.value; drawLog(); };
  if (!R.logWB) {
    // the wallet box stays in place while it is typed in; the rest of the bar is drawn again
    R.logWB = h('input', { class: 'sq-pfin adm-logw', type: 'search', placeholder: 'Wallet (address or a part of one)', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Wallet' });
    R.logWB.oninput = () => { st.lf.wallet = R.logWB.value.trim(); clearTimeout(R.logWT); R.logWT = setTimeout(drawLog, 200); };
    R.logCs = h('span', { class: 'adm-logslot' });
    R.logMs = h('span', { class: 'adm-logslot' });
    R.logClr = h('span', { class: 'adm-logslot' });
    R.logChips = h('div');
    R.logF.append(R.logChips, h('div', { class: 'adm-row adm-logsel' }, R.logCs, R.logMs, R.logWB, R.logClr));
  }
  if (R.logWB.value.trim() !== f.wallet) R.logWB.value = f.wallet;
  const any = f.kind || f.comp || f.by || f.wallet;
  R.logChips.replaceChildren(chips);
  R.logCs.replaceChildren(cs);
  R.logMs.replaceChildren(ms);
  R.logClr.replaceChildren(any ? btn('Clear filters', '', () => { Object.assign(f, { kind: '', comp: '', by: '', wallet: '' }); drawLog(); }) : '');
}
function drawLog() {
  if (!R.logList || !st.ov) return;
  const base = logBase();
  logFilters(base);
  const list = logView(base, st.lf);
  const any = st.lf.kind || st.lf.comp || st.lf.by || st.lf.wallet;
  // the source: the last 60 lines, or the whole log
  R.logSrc.replaceChildren(...[h('span', null, st.logAll ? 'The whole log: ' + s_(st.logAll.length, 'line') + ' (the store keeps 200).' : 'The last ' + s_(base.length, 'line') + ', from the overview.'),
    st.logAll ? btn('Read again', '', () => loadFullLog()) : st.logNo ? null : btn('Load the full log', '', () => loadFullLog(), { title: 'All 200 lines the store keeps (1 database command)' })].filter(Boolean));
  R.logList.textContent = '';
  if (!list.length) {
    R.logList.append(h('li', { class: 'sq-empty' }, any ? 'No line under these filters' + (st.logAll || st.logNo ? '.' : ' in the last 60: load the full log for more.') : 'Nothing changed yet.'));
    return;
  }
  const comps = st.ov.comps || [];
  for (const x of list) {
    const k = kindOf(x);
    const c = x.comp ? comps.find((y) => y.code === x.comp) : null;
    const body = h('span', { class: 'adm-logw2' }, h('span', { class: 'adm-kpill adm-k-' + k }, KIND_NAME[k]), h('span', { class: 'adm-what' }, x.what || ''));
    const links = h('span', { class: 'adm-loglinks' });
    if (c) links.append(h('button', { type: 'button', class: 'adm-loglink', onclick: goComp(c.code, STEP_OF[c.st]), title: 'Open #' + c.n }, '#' + c.n));
    if (x.wallet && ADDR_RE.test(x.wallet)) links.append(h('button', { type: 'button', class: 'adm-loglink', onclick: () => { showTab('wallets'); loadPlayer(x.wallet); }, title: 'Open the wallet ' + x.wallet }, short(x.wallet)));
    if (x.undo && typeof A.undo === 'function') links.append(btn('Undo', 'adm-mini adm-logundo', () => undoLine(x), { title: 'Put this change back (one request)', 'data-n': String(x.n) }));
    if (links.childNodes.length) body.append(links);
    R.logList.append(h('li', { 'data-n': String(x.n), 'data-kind': k }, h('span', { class: 'adm-when', title: x.t || '' }, ago(x.t) || '?'), h('span', { class: 'lg-addr', title: x.by || '' }, byName(x.by)), body));
  }
}
async function undoLine(x) {
  if (st.busy) return;
  st.busy = true;
  say(R.logMsg, 'Working…');
  try {
    await A.undo(x.n, x);
    say(R.logMsg, '');
    toast('Undone: ' + (x.what || 'line ' + x.n), true);
    await refresh();
    if (x.comp && x.comp === st.comp && st.compFull) await rereadEntries();
    if (st.player && !BOT_RE.test(st.player.id)) await loadPlayer(st.player.id, true);
  } catch (e) {
    const t = notYet(e) ? 'Undo is ' + NOT_YET.charAt(0).toLowerCase() + NOT_YET.slice(1) : e && e.code === 'no_undo' ? (e.message || 'That cannot be undone any more.') : (e && e.message) || 'That did not work.';
    say(R.logMsg, t, false);
    toast(t, false);
  } finally {
    st.busy = false;
  }
}


/* ---- Bots: the deck library (rate, edit, import from the lab, variants) ---- */
const TIER = { A: ['Strong', 'ok'], B: ['Medium', 'warn'], C: ['Weak', 'bad'] };
const UNIT_PARTS = [['cls', 'Class', 'PLAYSTYLES'], ['wpn', 'Weapon', 'WEAPONS'], ['gear', 'Gear', 'GEAR'], ['pow', 'Power', 'POWERS'], ['tac', 'Tactic', 'TACTICS'], ['stn', 'Stance', 'STANCES']];
async function loadDecks(force) {
  if (!R.decks) return;
  if (!A.decks || typeof A.decks.library !== 'function') { say(R.deckMsg, 'No deck library on this backend yet.'); return; }
  if (!st.decks || force) { if (!st.decks) { R.decks.textContent = ''; R.decks.append(h('li', { class: 'sq-empty' }, 'Loading…')); } }
  try {
    if (!st.decks || force) st.decks = (await A.decks.library()).decks || [];
    say(R.deckMsg, '');
  } catch (e) {
    R.decks.textContent = '';
    say(R.deckMsg, e && e.status === 404 ? 'The deck library is not on this server yet.' : (e && e.message) || 'The decks did not load.', false);
    return;
  }
  renderDecks();
}
// a squad as the editor keeps it: capPowers then cleanSquad (null when it cannot play)
function fixSquad(sq) {
  const E = C.E;
  if (!sq || !Array.isArray(sq.units)) return { sq: null, notes: ['not a squad'] };
  const units = sq.units.map((u) => ({ ...u, trn: { ...(u.trn || {}) } }));
  const before = units.map((u) => u.pow);
  E.capPowers(units);
  const notes = [];
  units.forEach((u, i) => { if (u.pow !== before[i]) notes.push('Blub ' + (i + 1) + ': ' + nameIn(E, 'POWERS', before[i]) + ' swapped for ' + nameIn(E, 'POWERS', u.pow) + ' (' + (E.RULES.powMax[before[i]] === 1 ? 'one' : 'at most ' + E.RULES.powMax[before[i]]) + ' a squad)'); });
  const out = E.cleanSquad({ ...sq, units });
  if (!out) {
    const W = E.WEAPON_STATS;
    units.forEach((u, i) => { if (u.gear === 'shield' && W[u.wpn] && W[u.wpn].hands !== 1) notes.push('Blub ' + (i + 1) + ': a Shell Shield needs a one-handed weapon'); });
    if (units.filter((u) => W[u.wpn] && W[u.wpn].one).length > 1) notes.push('one Boom Pack a squad');
    if (!notes.length) notes.push('the squad does not pass the engine’s check');
  }
  return { sq: out, notes };
}
const planTier = (d, k) => (d.pct && Number.isFinite(d.pct[k]) ? tierOf(d.pct[k]) : null);
function renderDecks() {
  R.decks.textContent = '';
  const list = st.decks || [];
  const live = list.filter((d) => !d.retired);
  R.deckSum.textContent = live.length + ' decks in play: ' + ['A', 'B', 'C'].map((t) => live.filter((d) => d.tier === t).length + ' ' + TIER[t][0]).join(', ') + ', ' + live.filter((d) => d.x).length + ' experiments' + (list.length > live.length ? ' · ' + (list.length - live.length) + ' retired' : '') + '.';
  if (!list.length) { R.decks.append(h('li', { class: 'sq-empty' }, 'No decks yet: make one or import the lab’s champions.')); return; }
  for (const d of list) {
    const t = TIER[d.tier];
    const old = d.e !== C.E.SQUAD_ENGINE;
    const rec = d.rec || { hw: 0, hl: 0, bw: 0, bl: 0 };
    const prog = h('span', { class: 'adm-prog', hidden: true }, h('i'));
    const msg = h('span', { class: 'sq-msg', 'aria-live': 'polite' });
    const acts = h('div', { class: 'adm-row adm-dacts' },
      btn('Edit', 'adm-mini', () => editDeck(d)),
      btn(old || !d.pct ? 'Rate' : 'Rate again', 'adm-mini' + (old || !d.pct ? ' gold' : ''), (ev) => rateOne(d, ev.currentTarget, prog, msg)),
      btn('Make variants', 'adm-mini', () => variantsOf(d)),
      d.retired || d.x ? btn('Promote', 'adm-mini', () => deckAct('promote', d, msg), { title: d.retired ? 'Back in play' : 'Out of the experiments' }) : null,
      d.retired ? null : sureBtn('Retire', 'adm-mini', () => deckAct('retire', d, msg), 'Retire it?'));
    R.decks.append(h('li', { class: 'adm-deck' + (d.retired ? ' dim' : '') },
      h('span', { class: 'lg-who' },
        h('span', { class: 'lg-name' }, h('b', null, '#' + d.id + ' ' + (d.n || 'Deck')), d.tier ? pips(d.tier) : null, t ? pill(t[0], t[1]) : pill('Not rated', 'dim'), d.x ? pill('Experiment', 'dim') : null, d.retired ? pill('Retired', 'dim') : null, old && !d.retired ? pill('Re-rate', 'warn') : null),
        h('span', { class: 'adm-dplans' }, ...['A', 'B', 'C'].map((k, i) => h('span', { class: 'adm-dplan' }, h('b', null, k), pips(planTier(d, i)), d.pct ? d.pct[i] + '%' : '–'))),
        h('span', { class: 'lg-sub' }, 'engine ' + (d.e ?? '?') + ' · vs players ' + rec.hw + '–' + rec.hl + ' · vs bots ' + rec.bw + '–' + rec.bl + (d.src ? ' · ' + d.src : '')),
        d.note ? h('span', { class: 'lg-sub adm-quote' }, d.note) : null),
      acts, prog, msg));
  }
}
async function deckAct(what, d, msg) {
  try {
    const r = await A.decks[what](d.id);
    Object.assign(d, r.deck);
    renderDecks();
    toast((what === 'retire' ? 'Retired #' : 'Promoted #') + d.id + ' ' + d.n + '.', true);
  } catch (e) { say(msg, errSay(e), false); }
}
// the strength of a deck's three plans in this browser (0 commands): 48 seeded fights each
// against the league's bot squads, a progress bar, then the backend keeps the numbers
async function rateOne(d, b, prog, msg) {
  if (st.rating) { say(msg, 'One rating at a time.', false); return; }
  st.rating = true;
  b.disabled = true;
  prog.hidden = false;
  const bar = prog.firstChild;
  const pct = [];
  try {
    for (let k = 0; k < 3; k++) {
      const sq = C.E.cleanSquad(d.plan[k]);
      if (!sq) throw new AdminError(400, 'bad_cfg', 'Plan ' + 'ABC'[k] + ' cannot play: edit the deck first.');
      let wins = 0;
      for (let i = 0; i < 48; i++) {
        if (rateFight(sq, i, null, C.E)) wins++;
        bar.style.width = Math.round((100 * (k * 48 + i + 1)) / 144) + '%';
        if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
      }
      pct.push(Math.round((100 * wins) / 48));
    }
    const r = await A.decks.rate(d.id, { pct, e: C.E.SQUAD_ENGINE });
    Object.assign(d, r.deck);
    renderDecks();
    toast('#' + d.id + ' ' + d.n + ': ' + pct.join(' / ') + '% · ' + (TIER[d.tier] ? TIER[d.tier][0] : 'rated') + '.', true);
  } catch (e) {
    say(msg, errSay(e), false);
    b.disabled = false;
    prog.hidden = true;
  } finally {
    st.rating = false;
  }
}
// the editor: a name, a note, the experiment mark and the three plans, each Blub's picks
// as selects; every change goes through capPowers and cleanSquad
function editDeck(d) {
  const E = C.E;
  const r0 = E.rng(1 + Math.floor(Math.random() * 1e9));
  st.editFrom = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  st.edit = d ? { id: d.id, n: d.n || '', note: d.note || '', x: !!d.x, src: d.src || '', plan: d.plan.map((q) => JSON.parse(JSON.stringify(q))), rec: d.rec } : { id: null, n: '', note: '', x: false, src: 'hand', plan: [0, 1, 2].map(() => E.randomSquad(r0)) };
  drawEditor();
  R.deckEd.hidden = false;
  R.deckEd.scrollIntoView({ block: 'start', behavior: smooth() });
  const first = R.deckEd.querySelector('input');
  if (first) first.focus({ preventScroll: true });
}
// closes the deck editor and puts the focus back on the button that opened it
function closeEditor() {
  if (!st.edit) return;
  st.edit = null;
  drawEditor();
  back(st.editFrom, '#admDecks');
  st.editFrom = null;
}
function drawEditor() {
  const E = C.E;
  const ed = st.edit;
  const box = R.deckEd;
  box.textContent = '';
  if (!ed) { box.hidden = true; return; }
  const name = h('input', { class: 'sq-pfin', maxlength: '40', value: ed.n, placeholder: 'Deck name', 'aria-label': 'Deck name' });
  name.oninput = () => { ed.n = name.value; };
  const note = h('input', { class: 'sq-pfin', maxlength: '200', value: ed.note, placeholder: 'A note (what it tests, where it came from)', 'aria-label': 'Note' });
  note.oninput = () => { ed.note = note.value; };
  const x = h('input', { type: 'checkbox' });
  x.checked = ed.x;
  x.onchange = () => { ed.x = x.checked; };
  const msg = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
  box.append(h('h3', { id: 'admDeckEdT' }, ed.id ? 'Edit deck #' + ed.id : 'New deck'),
    h('div', { class: 'adm-two' }, h('label', { class: 'adm-field' }, h('span', { class: 'adm-fl' }, 'Name'), name), h('label', { class: 'adm-field' }, h('span', { class: 'adm-fl' }, 'Note'), note)),
    h('label', { class: 'adm-check' }, x, 'Experiment (at most ' + X_MAX + '% of a competition’s bot places)'));
  const legal = [];
  ed.plan.forEach((sq, k) => {
    const f = fixSquad(sq);
    legal.push(!!f.sq);
    const head = h('div', { class: 'adm-parth' }, h('b', null, 'Plan ' + 'ABC'[k] + (k ? ' · after a day it lost more than it won' : ' · day 0')),
      h('div', { class: 'adm-row' },
        btn('Random', 'adm-mini', () => { ed.plan[k] = E.randomSquad(E.rng(1 + Math.floor(Math.random() * 1e9))); drawEditor(); }),
        btn('Copy JSON', 'adm-mini', () => copyText(JSON.stringify(f.sq || sq), 'Plan ' + 'ABC'[k] + ' copied.')),
        btn('Paste JSON', 'adm-mini', () => {
          const t = prompt('A squad as JSON (units, objs, cmd)');
          if (!t) return;
          try { ed.plan[k] = JSON.parse(t); drawEditor(); } catch { say(msg, 'That is not JSON.', false); }
        })));
    const grid = h('div', { class: 'adm-units' });
    (sq.units || []).forEach((u, i) => {
      const row = h('div', { class: 'adm-unit' }, h('span', { class: 'adm-unitn' }, i ? String(i + 1) : 'C'));
      for (const [part, label, list] of UNIT_PARTS) {
        const s = h('select', { class: 'adm-sel adm-usel', 'aria-label': 'Plan ' + 'ABC'[k] + ', Blub ' + (i + 1) + ': ' + label });
        for (const [id, nm] of E[list]) s.append(h('option', { value: id }, nm));
        s.value = part === 'stn' ? u.stn || 'attack' : u[part];
        s.onchange = () => { if (part === 'stn' && s.value === 'attack') delete u.stn; else u[part] = s.value; const g = fixSquad(sq); if (g.sq) ed.plan[k] = g.sq; drawEditor(); };
        row.append(s);
      }
      grid.append(row);
    });
    const cmd = h('select', { class: 'adm-sel', 'aria-label': 'Plan ' + 'ABC'[k] + ': captain’s command' }, h('option', { value: '' }, 'No command'), ...E.COMMANDS.map(([id, nm]) => h('option', { value: id }, nm)));
    cmd.value = sq.cmd || '';
    cmd.onchange = () => { if (cmd.value) sq.cmd = cmd.value; else delete sq.cmd; drawEditor(); };
    const objs = (sq.objs || []).map((o) => nameIn(E, 'OBJECTS', o.k)).join(', ') || 'no trench kit';
    box.append(h('section', { class: 'adm-group adm-plan' + (f.sq ? '' : ' bad') }, head, grid,
      h('div', { class: 'adm-row' }, h('label', { class: 'adm-field' }, h('span', { class: 'adm-fl' }, 'Command'), cmd), h('span', { class: 'adm-fine' }, 'Kit: ' + objs + ' · positions as saved')),
      f.notes.length ? h('p', { class: 'adm-state ' + (f.sq ? 'warn' : 'bad') }, (f.sq ? '' : 'Not legal: ') + f.notes.join('; ') + '.') : h('p', { class: 'adm-state ok' }, '✓ Legal')));
  });
  const save = btn(ed.id ? 'Save deck #' + ed.id : 'Save new deck', 'gold', async () => {
    const fixed = ed.plan.map((q) => fixSquad(q).sq);
    if (!fixed.every(Boolean)) { say(msg, 'Every plan must be legal first.', false); return; }
    try {
      const r = await A.decks.save({ ...(ed.id ? { id: ed.id } : {}), n: ed.n.trim() || 'Deck', plan: fixed, note: ed.note.trim(), x: ed.x, src: ed.src, ...(ed.rec ? { rec: ed.rec } : {}) });
      const i = (st.decks || []).findIndex((q) => String(q.id) === String(r.deck.id));
      if (i >= 0) st.decks[i] = r.deck; else (st.decks = st.decks || []).push(r.deck);
      closeEditor();
      renderDecks();
      toast('Saved deck #' + r.deck.id + ' ' + r.deck.n + (r.deck.pct ? '.' : ': rate it next.'), true);
    } catch (e) { say(msg, errSay(e), false); }
  }, legal.every(Boolean) ? {} : { 'aria-disabled': 'true' });
  box.append(h('div', { class: 'adm-row adm-savebar' }, save, btn('Cancel', '', () => closeEditor()), h('span', { class: 'adm-fine' }, 'Esc cancels')), msg);
}
// variants of a deck: one or two parts changed in each plan, marked as an experiment
function variantsOf(d, count = 2) {
  const E = C.E;
  const r = E.rng(1 + Math.floor(Math.random() * 1e9));
  const pick = (list) => list[Math.floor(r() * list.length)][0];
  const out = [];
  for (let v = 0; v < count; v++) {
    const changes = [];
    const plan = d.plan.map((q, k) => {
      for (let tries = 0; tries < 40; tries++) {
        const sq = JSON.parse(JSON.stringify(q));
        const n = 1 + Math.floor(r() * 2);
        const did = [];
        for (let j = 0; j < n; j++) {
          const i = Math.floor(r() * sq.units.length);
          const [part, , list] = UNIT_PARTS[Math.floor(r() * UNIT_PARTS.length)];
          const was = part === 'stn' ? sq.units[i].stn || 'attack' : sq.units[i][part];
          const now = pick(E[list]);
          if (now === was) continue;
          if (part === 'stn' && now === 'attack') delete sq.units[i].stn; else sq.units[i][part] = now;
          did.push('ABC'[k] + (i + 1) + ' ' + nameIn(E, list, was) + '→' + nameIn(E, list, now));
        }
        const f = fixSquad(sq);
        if (did.length && f.sq && JSON.stringify(f.sq) !== JSON.stringify(E.cleanSquad(q))) { changes.push(...did); return f.sq; }
      }
      return E.cleanSquad(q);
    });
    out.push({ n: (d.n || 'Deck') + ' · v' + (v + 1), plan, x: true, src: 'variant of #' + d.id, note: changes.join(', ').slice(0, 200) });
  }
  st.variants = { from: d.id, list: out };
  drawImport();
}
// what the lab's files hold: champions with squads (archetypes-<tag>.json) and a matchup
// table (quick-*.json: names and M[i][j], i's win rate against j)
export function labDecks(files, E) {
  const champs = [];
  let table = null;
  for (const f of files) {
    if (f && Array.isArray(f.champions)) for (const ch of f.champions) if (ch && ch.squad && !champs.some((x) => x.name === ch.name)) champs.push({ name: String(ch.name || 'champion').slice(0, 30), squad: ch.squad, tag: f.tag || '' });
    if (f && Array.isArray(f.names) && Array.isArray(f.M)) table = { names: f.names, M: f.M };
  }
  const idx = (nm) => (table ? table.names.indexOf(nm) : -1);
  const rate = (i, j) => (table && table.M[i] && Number.isFinite(table.M[i][j]) ? table.M[i][j] : null);
  // the champion that beats `who`'s worst matchup best, of those not taken yet
  const answer = (who, taken) => {
    const i = idx(who.name);
    if (i < 0) return null;
    let worst = -1;
    let low = Infinity;
    table.names.forEach((_, j) => { const v = rate(i, j); if (j !== i && v !== null && v < low) [low, worst] = [v, j]; });
    if (worst < 0) return null;
    let best = null;
    let hi = -Infinity;
    for (const ch of champs) {
      if (taken.includes(ch.name)) continue;
      const k = idx(ch.name);
      const v = k >= 0 ? rate(k, worst) : null;
      if (v !== null && v > hi) [hi, best] = [v, ch];
    }
    return best ? { ch: best, vs: table.names[worst] } : null;
  };
  const legal = (q) => { if (!q || !Array.isArray(q.units)) return null; const units = q.units.map((u) => ({ ...u })); E.capPowers(units); return E.cleanSquad({ ...q, units }); };
  return champs.map((a, n) => {
    const taken = [a.name];
    const b = answer(a, taken) || { ch: champs[(n + 1) % champs.length], vs: null };
    taken.push(b.ch.name);
    const c = answer(b.ch, taken) || { ch: champs[(n + 2) % champs.length], vs: null };
    const plan = [a.squad, b.ch.squad, c.ch.squad].map(legal);
    return { n: a.name, plan, ok: plan.every(Boolean), src: 'lab: archetypes' + (a.tag ? '-' + a.tag : ''), note: 'B ' + b.ch.name + (b.vs ? ' (beats ' + b.vs + ', A’s worst)' : ' (next champion)') + ', C ' + c.ch.name + (c.vs ? ' (beats ' + c.vs + ')' : ' (next champion)') };
  });
}
async function importLab(input) {
  const files = [];
  for (const f of input.files || []) {
    try { files.push(JSON.parse(await f.text())); } catch { say(R.deckMsg, f.name + ' is not JSON.', false); return; }
  }
  input.value = '';
  const list = labDecks(files, C.E);
  if (!list.length) { say(R.deckMsg, 'No champions with squads in those files (an archetypes-<tag>.json has them; a quick-*.json adds the matchup table).', false); return; }
  st.variants = { from: null, list: list.map((x) => ({ ...x, x: false })), table: files.some((f) => f && Array.isArray(f.M)) };
  drawImport();
}
// the proposals of an import or of variants: each to save (1 command each) or drop
function drawImport() {
  const box = R.deckImp;
  box.textContent = '';
  const V = st.variants;
  if (!V || !V.list.length) { box.hidden = true; return; }
  box.hidden = false;
  const msg = h('p', { class: 'sq-msg', 'aria-live': 'polite' });
  const ol = h('ol', { class: 'adm-list' });
  V.list.forEach((p, i) => {
    const okp = p.plan.every(Boolean);
    ol.append(h('li', { class: 'adm-ban' + (okp ? '' : ' dim') }, h('span', { class: 'lg-who' }, h('span', { class: 'lg-name' }, h('b', null, p.n), p.x ? pill('Experiment', 'dim') : null, okp ? null : pill('Not legal', 'bad')), h('span', { class: 'lg-sub adm-quote' }, p.note || p.src)),
      okp ? btn('Save', 'adm-mini gold', async (ev) => {
        ev.currentTarget.disabled = true;
        try {
          const r = await A.decks.save({ n: p.n, plan: p.plan, note: p.note, x: !!p.x, src: p.src });
          (st.decks = st.decks || []).push(r.deck);
          V.list.splice(i, 1);
          drawImport();
          renderDecks();
          toast('Saved #' + r.deck.id + ' ' + r.deck.n + ': rate it next.', true);
        } catch (e) { say(msg, errSay(e), false); ev.currentTarget.disabled = false; }
      }) : null));
  });
  box.append(h('h4', null, V.from ? 'Variants of #' + V.from + ' (experiments)' : 'From the lab · ' + V.list.length + ' decks' + (V.table ? ' · B and C picked from the matchup table' : ' · B and C are the next champions (add a quick-*.json for the matchup table)')), ol,
    h('div', { class: 'adm-row' }, V.list.filter((p) => p.plan.every(Boolean)).length > 1 ? sureBtn('Save all ' + V.list.filter((p) => p.plan.every(Boolean)).length, 'gold', async () => {
      let n = 0;
      try {
        for (const p of V.list.filter((q) => q.plan.every(Boolean))) { const r = await A.decks.save({ n: p.n, plan: p.plan, note: p.note, x: !!p.x, src: p.src }); (st.decks = st.decks || []).push(r.deck); n++; }
        st.variants = null;
        drawImport();
        renderDecks();
        toast('Saved ' + s_(n, 'deck') + ': rate them next.', true);
      } catch (e) { say(msg, errSay(e) + ' (' + n + ' saved)', false); }
    }, 'Save them all (' + V.list.length + ' commands)?') : null, btn('Drop', '', () => { st.variants = null; drawImport(); })), msg);
}

/* ---- the panel's own look: public/admin.css, linked once ---- */
function css() {
  if (document.getElementById('adminCss')) return;
  document.head.append(h('link', { id: 'adminCss', rel: 'stylesheet', href: new URL('admin.css', import.meta.url).href }));
}
