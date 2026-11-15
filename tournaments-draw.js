// Tournaments tab rebuild (design_handoff_tournaments_tab, founder 2026-11-15). Owner: the TTDraw builder.
// =================================================================
// TOURNAMENTS → DRAW — the handoff's Draw tab (prototype Tournaments.dc.html, markup L48–531, renderVals L930–1200),
// built to the export's inline values on our own data.
// -----------------------------------------------------------------
// Views: Draw (bracket, From pills, player route card, Compare two routes pick strip, compare card, collapsed bar,
// opponent report) · Statistics (Speed + Favourites and underdogs tiles, past-editions box, match box) · Outright
// chances (title leader card + rows, four quarter cards).
//
// Data (feasibility table, inventory v7-10 §4) — every figure is ours or a dash "—":
//   draws.json (the official sheet: positions, names, seeds, entries, IOC, player keys; quarters = positions only)
//   tournament-progression.json (results + set scores; `drawResults` once an event leaves the board — draw-results
//     branch) · draws-archive.json (finished draws with their final results — draw-results branch; a 404 = none)
//   matches.json + the card book's price (_mcNowPair) for an unplayed pair that is on Today's Matches
//   how-it-plays.json (Speed tiles: this edition + tour average) · favourites-by-round.json (Favourites won)
//   database-yield.json rows + retRows through settlement.js (per-edition favourites won / yields, the match box)
//   tour-baselines.json (tour yields) · career-history shards + H2HCore (opponent report: head to head, last five)
//   playing-styles.json + style-meetings (opponent report: record against his archetype)
// Founder 2026-11-15 ruling 3: every chance, fair-odds range, likely opening price range, "Be careful" / "No warning"
// and the underdog lists read "—" (no source). The boxes are built; a sentence built only on chances is omitted.
// Clicking a player in the bracket selects him (the design), a finished match included.
// Kept from the live tab (they post-date the export, founder 2026-11-15): the W/UE sheet bar (under the progress line)
// and the draw-results branch's Archive row (a third group beside This week / Finished).
// No DrawView / WueSheet code is changed: this module calls DrawView.model / shortName / meetRound and the page's
// tourxWueBarHtml.
// =================================================================
(function () {
'use strict';
const DASH = '—', MINUS = '−', NDASH = '–';
const SCOPE = '.tabpage[data-page="tournaments"] .tt-draw';
const FLOOR = 15;   // TP_SAMPLE_FLOOR (tournaments.md): below 15 matches a % is a dash, its count in the hover

// ── colours: tokens only (founder ruling 2 — the export's exact values through --tt-*) ─────────────────────────────
const C = {
  text: 'var(--tt-text)', white: 'var(--tt-white)', soft: 'var(--tt-soft)', muted: 'var(--tt-muted)', past: 'var(--tt-past)',
  blue: 'var(--tt-blue)', blueFav: 'var(--tt-blue-fav)', red: 'var(--tt-red)', green: 'var(--tt-green)',
  card: 'var(--tt-card)', inset: 'var(--tt-inset)', raised: 'var(--tt-raised)',
  // export values with no token yet, asked of the lead (report-draw.md): the avatar fill, the solid-blue button hover,
  // the two draw scrims (62% / 66%); each falls back to the nearest existing --tt-* token until it lands
  avatar: 'var(--tt-avatar, var(--tt-raised))', blueBtnHov: 'var(--tt-blue-btn-2, var(--tt-blue-btn))',
  scrim62: 'var(--tt-scrim-62, var(--tt-scrim))', scrim66: 'var(--tt-scrim-66, var(--tt-scrim))',
};
const W = n => `color-mix(in srgb, var(--tt-white) ${n}%, transparent)`;
const B = n => `color-mix(in srgb, var(--tt-blue) ${n}%, transparent)`;
const K = n => `color-mix(in srgb, var(--tt-black) ${n}%, transparent)`;
const MONO = "font-family:'IBM Plex Mono',monospace;";
const CAPS = `font-size:10.5px; font-weight:700; letter-spacing:0.10em; text-transform:uppercase; color:${C.muted};`;
const SH_OVERLAY = `0 30px 80px ${K(60)}`, SH_OPP = `0 24px 80px ${K(60)}`;
const CLOSE_SVG = `<svg width="11" height="11" viewBox="0 0 10 10" fill="none" style="stroke:${C.soft}" stroke-width="1.6" stroke-linecap="round"><path d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5"></path></svg>`;
const SEARCH_SVG = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="stroke:${C.muted}" stroke-width="1.6" stroke-linecap="round"><circle cx="6" cy="6" r="4.4"></circle><path d="M9.4 9.4 L12.6 12.6"></path></svg>`;

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f1 = v => Math.abs(v).toFixed(1);
const sg = d => (d >= 0 ? '+' : MINUS) + f1(d);
const LONG = { R128: 'Round of 128', R64: 'Round of 64', R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarter-finals', SF: 'Semi-finals', F: 'Final' };
const longOf = n => LONG[n] || (/^Q(\d+)$/.test(n) ? 'Qualifying round ' + n.slice(1) : n);
const reachWords = n => (n === 'F' ? 'the final' : n === 'SF' ? 'the semi-finals' : n === 'QF' ? 'the quarter-finals' : 'the ' + longOf(n));
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── page globals (classic-script globals of bsp-consult-dashboard.html; every one optional) ─────────────────────────
const DV = () => (typeof window !== 'undefined' ? window.DrawView : null);
const progData = () => (typeof tournamentProgression !== 'undefined' ? tournamentProgression : null);
const boardData = () => (typeof matches !== 'undefined' && Array.isArray(matches) ? matches : []);
const tz = () => { try { return typeof newsTz === 'function' ? newsTz() : undefined; } catch (e) { return undefined; } };

// ── files: one loader (undefined = not asked, null = failed / absent, else the parsed file); a load repaints ────────
const FILES = {}, LOADING = {};
function file(name, cache) {
  if (FILES[name] !== undefined) return FILES[name];
  if (!LOADING[name] && typeof fetch === 'function') {
    LOADING[name] = fetch('./' + name + (cache === 'bust' ? '?_=' + Date.now() : ''), { cache: cache === 'bust' ? 'no-store' : 'no-cache' })
      .then(r => (r.ok ? r.json() : null)).catch(() => null)
      .then(d => { FILES[name] = d || null; LOADING[name] = null; repaint(); return d; });
  }
  return undefined;
}
function drawsData() {
  if (typeof _tourxDraws !== 'undefined' && _tourxDraws) return _tourxDraws;   // the old renderer's copy, when it loaded one
  return file('draws.json', 'bust');
}

// ── state ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const S = { key: null, kind: 'main', view: 'draw', from: null, sel: null, b: null, cmp: false, cmpQ: '', shut: null, opp: null,
  outCmp: false, outA: null, outB: null, outQ: '', outTab: 't', stat: null, ed: null, el: null };
const reset = () => Object.assign(S, { sel: null, b: null, cmp: false, cmpQ: '', shut: null, opp: null, stat: null, ed: null, outCmp: false, outA: null, outB: null, outQ: '' });

// ── events: This week · Finished (the two newest ended draws, the design's cap) · Archive (the rest + draws-archive) ─
const cityOf = t => t.feedCity || t.city;
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function entryFor(city) {
  const p = progData(); if (!p) return { entry: null, name: null };
  for (const map of [p.tournaments, p.drawResults]) {
    if (!map) continue;
    if (map[city]) return { entry: map[city], name: city };
    const k = Object.keys(map).find(x => map[x] && map[x].feedName === city);
    if (k) return { entry: map[k], name: k };
  }
  return { entry: null, name: null };
}
// The Database / favourites-by-round name of a draw. draws.json "Lyon" in October is the new indoor event (api-tennis
// key 14763, "Lyon (France)" — tournaments.md: no lineage to the clay Lyon Open).
function dataName(t) { const c = cityOf(t); return c === 'Lyon' && +String(t.startDate || '').slice(5, 7) >= 9 ? 'Lyon (France)' : c; }
function events() {
  const d = drawsData(), a = file('draws-archive.json');
  const today = isoToday(), out = [];
  for (const [id, t] of Object.entries((d && d.tournaments) || {})) {
    if (!t || !t.main || t.main.status !== 'posted') continue;
    const city = cityOf(t), e = entryFor(city);
    out.push({ key: 'd:' + id, id, city, label: city, draw: t, entry: e.entry, entryName: e.name, start: t.startDate || '', end: t.endDate || '',
      arch: false, ended: !!(t.endDate && t.endDate < today), dname: dataName(t),
      board: boardData().filter(m => String(m.tour || '').replace(/^ATP /, '') === city && !m.finalScore) });
  }
  const have = new Set(out.map(e => e.city + '|' + e.start));
  for (const [id, t] of Object.entries((a && a.tournaments) || {})) {
    if (!t || !t.main || t.main.status !== 'posted' || !t.results) continue;
    const city = cityOf(t); if (have.has(city + '|' + (t.startDate || ''))) continue;
    out.push({ key: 'a:' + id, id, city, label: city, draw: t, entry: t.results, entryName: null, start: t.startDate || '', end: t.endDate || '',
      arch: true, ended: true, archivedAt: t.archivedAt || null, dname: dataName(t), board: [] });
  }
  const now = out.filter(e => !e.arch && !e.ended).sort((x, y) => x.start.localeCompare(y.start) || x.city.localeCompare(y.city));
  const ended = out.filter(e => !e.arch && e.ended).sort((x, y) => y.end.localeCompare(x.end) || x.city.localeCompare(y.city));
  const fin = ended.slice(0, 2);
  const arch = ended.slice(2).concat(out.filter(e => e.arch)).sort((x, y) => y.end.localeCompare(x.end) || x.city.localeCompare(y.city));
  return { all: out, now, fin, arch };
}

// ── draw model (DrawView.model — the live tab's one model) + derived facts ─────────────────────────────────────────
function modelOf(ev, kind) {
  const D = DV(); if (!D || !ev) return null;
  try { return D.model({ draw: ev.draw, entry: ev.entry, upcoming: ev.board, kind: kind === 'qual' ? 'qualifying' : 'main' }); } catch (e) { return null; }
}
const keyOf = s => (s && s.playerKey != null ? String(s.playerKey) : null);
const nameOf = s => (s ? (DV() ? DV().shortName(s.name) : s.name) : '');
const tagOf = s => (s ? (s.seed != null ? `[${s.seed}]` : s.entry && s.entry !== 'SEED' ? s.entry : '') : '');
const surname = n => String(n || '').trim().split(/\s+/).pop();
function facts(M, ev) {
  // per player: the round he lost in, the champion; slots by key
  const slots = ((ev.draw.main && ev.draw.main.slots) || []).filter(s => !s.bye && s.playerKey);
  const byKey = new Map(slots.map(s => [String(s.playerKey), s])), out = {};
  let champ = null;
  if (M) M.rounds.forEach((R, r) => R.cells.forEach(c => {
    if (!c.match) return;
    c.sides.forEach(s => { const k = keyOf(s); if (k && k !== c.match.winnerKey && out[k] == null) out[k] = r; });
    if (r === M.rounds.length - 1) champ = c.match.winnerKey;
  }));
  return { slots, byKey, out, champ };
}
const played = M => (M ? M.rounds.reduce((a, r) => a + r.done, 0) : 0);
const total = M => (M ? M.rounds.reduce((a, r) => a + r.total, 0) : 0);
function stageOf(M, F) {
  if (!M) return DASH;
  if (F.champ) { const s = F.byKey.get(F.champ); return s ? surname(nameOf(s)) : DASH; }
  if (!played(M)) return 'Draw out';
  const r = M.rounds.find(x => x.done < x.total); return r ? r.name : DASH;
}

// the path of one player through the main draw, round by round (no chance figure: founder ruling 3)
function pathOf(M, F, key) {
  const me = F.byKey.get(key); if (!M || !me) return null;
  const pos = me.pos, n = M.rounds.length;
  let outAt = -1, nextSet = false, line = '';
  const cells = M.rounds.map((R, r) => {
    const c = R.cells[(pos - 1) >> (r + 1)], rd = longOf(R.name);
    const base = { rd, code: R.name, r, state: 'gone', opp: DASH, oppKey: null, cands: [], known: false, fig: '', figColor: C.muted, sub: '', op: 1, next: false, score: '' };
    if (outAt >= 0 || (F.out[key] != null && F.out[key] < r)) return Object.assign(base, { op: 0.4 });
    if (r === 0 && c.bye) return Object.assign(base, { state: 'bye', opp: 'No opponent', fig: 'Bye', figColor: C.soft });
    const mine = c.sides.findIndex(s => keyOf(s) === key);
    if (c.match && mine >= 0) {
      const won = c.match.winnerKey === key, o = c.sides[1 - mine];
      const sc = (c.match.score || []).map(p => (mine ? [p[1], p[0]] : p)).map(p => p[0] + '-' + p[1]).join('  ');
      if (!won) outAt = r;
      return Object.assign(base, { state: won ? 'won' : 'lost', opp: o ? 'v ' + nameOf(o) + (tagOf(o) ? ' ' + tagOf(o) : '') : DASH, oppKey: keyOf(o),
        cands: o ? [o] : [], known: true, fig: won ? 'Won' : 'Lost', figColor: won ? C.white : C.muted, sub: sc, score: sc });
    }
    // not played yet: the opponent is known when the other side of his cell is decided; else every player still alive
    // in the opposite half (ordered by seed, then draw position — the draw's own order, never a chance)
    const o = mine >= 0 ? c.sides[1 - mine] : null;
    let cands;
    if (o) cands = [o];
    else {
      const g = 1 << (r + 1), half = g >> 1, gs = ((pos - 1) >> (r + 1)) << (r + 1), oFrom = (pos - 1 - gs) < half ? gs + half : gs;
      cands = F.slots.filter(s => s.pos - 1 >= oFrom && s.pos - 1 < oFrom + half && !(F.out[String(s.playerKey)] != null && F.out[String(s.playerKey)] < r))
        .sort((x, y) => (x.seed == null ? 99 : x.seed) - (y.seed == null ? 99 : y.seed) || x.pos - y.pos);
    }
    if (!cands.length) return Object.assign(base, { state: 'bye', opp: 'No opponent', fig: 'Bye', figColor: C.soft });
    const isNext = !nextSet;
    if (isNext) { nextSet = true; line = 'Next: ' + (o ? 'v ' + nameOf(o) + ' in ' : '') + 'the ' + rd.toLowerCase(); }
    return Object.assign(base, { state: 'open', next: isNext, known: !!o, cands: cands.slice(0, 3), opp: o ? 'v ' + nameOf(o) + (tagOf(o) ? ' ' + tagOf(o) : '') : DASH,
      oppKey: keyOf(o), fig: DASH, figColor: C.white, sub: r === n - 1 ? 'to win the title' : 'to reach ' + reachWords(M.rounds[r + 1].name) });
  });
  const qi = M.rounds.findIndex(x => x.name === 'QF');
  const qWon = qi >= 0 && cells[qi] && cells[qi].state === 'won';
  return { me, key, cells, outAt, line, champion: F.champ === key, qWon };
}

// ── handlers: one registry per render (no string escaping in inline handlers) ──────────────────────────────────────
let H = [];
const on = fn => { H.push(fn); return `TTDraw._h(${H.length - 1},event)`; };

// ── shared bits ─────────────────────────────────────────────────────────────────────────────────────────────────────
const ini = n => String(n || '').replace(/[^A-Za-zÀ-ɏ ]/g, '').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
function avatar(key, name, size, ring, fs, bw) {
  const ph = key && typeof playerPhotoImg === 'function' ? playerPhotoImg(String(key), name) : '';
  return `<span class="tt-draw-av" style="flex:none; position:relative; overflow:hidden; width:${size}px; height:${size}px; border-radius:50%; background:${C.avatar}; border:${bw || 1.5}px solid ${ring}; display:flex; align-items:center; justify-content:center; font-size:${fs}px; font-weight:700; color:${C.text};">${esc(ini(name))}${ph}</span>`;
}
function openProfile(key) { if (key && typeof psOpenProfile === 'function') psOpenProfile(String(key)); }
const hasProfile = key => !!key && (typeof newsHasProfile !== 'function' || newsHasProfile(String(key)));
// Head to Head hand-off (brief ruling 7): the live receiver by api-tennis key, plus the export's sessionStorage pair
function goH2H(ka, kb, ca, cb) {
  if (!ka || !kb) return;
  try { sessionStorage.setItem('stn_h2h_pair', JSON.stringify([String(ka), String(kb), ca || '', cb || ''])); } catch (e) { /* private mode */ }
  if (typeof window.sfGoToH2H === 'function') window.sfGoToH2H(String(ka), String(kb));
}
const pill = (label, isOn, onclick, extra) => `<span class="tt-draw-seg" onclick="${onclick || ''}" style="${isOn ? `color:${C.white}; background:${C.raised}; border:1px solid ${W(16)}; font-weight:700;` : `color:${C.muted}; background:transparent; border:1px solid transparent; font-weight:600;`} font-size:12.5px; border-radius:8px; white-space:nowrap; cursor:pointer; ${extra}">${label}</span>`;
const track = inner => `<div style="display:flex; flex-wrap:wrap; gap:3px; background:${C.inset}; border:1px solid ${W(6)}; border-radius:10px; padding:3px;">${inner}</div>`;
const closeBtn = onclick => `<span class="tt-draw-hw8" onclick="${onclick}" title="Close" style="flex:none; cursor:pointer; display:flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:8px;">${CLOSE_SVG}</span>`;
function fmtWhen(iso) {
  if (!iso) return DASH;
  try { return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz() }); }
  catch (e) { return DASH; }
}
function ago(iso) {
  const t = Date.parse(iso); if (!isFinite(t)) return DASH;
  const min = Math.max(0, Math.round((Date.now() - t) / 60000));
  return min < 1 ? 'just now' : min < 60 ? `${min} min ago` : `${Math.floor(min / 60)} h ${min % 60} min ago`;
}
function weekRange(a, b) {
  const x = new Date(a + 'T00:00:00Z'), y = new Date(b + 'T00:00:00Z'); if (!isFinite(x) || !isFinite(y)) return '';
  return x.getUTCMonth() === y.getUTCMonth() ? `${x.getUTCDate()} ${NDASH} ${y.getUTCDate()} ${MON[y.getUTCMonth()]}` : `${x.getUTCDate()} ${MON[x.getUTCMonth()]} ${NDASH} ${y.getUTCDate()} ${MON[y.getUTCMonth()]}`;
}
// the card book's current price for an unplayed pair that is on Today's Matches (odds.md: one book per card); a pair
// that is not on the board has no price → null (nothing drawn); on the board without a price → a dash
function boardPrice(ev, A, Bs) {
  const ka = keyOf(A), kb = keyOf(Bs); if (!ka || !kb) return null;
  const m = ev.board.find(x => [String(x.p1Key), String(x.p2Key)].sort().join('|') === [ka, kb].sort().join('|'));
  if (!m) return null;
  let p = null; try { p = typeof _mcNowPair === 'function' ? _mcNowPair(m) : null; } catch (e) { p = null; }
  if (!p || p.p1 == null || p.p2 == null) return { a: null, b: null, book: '' };
  const flip = String(m.p1Key) !== ka;
  return { a: flip ? p.p2 : p.p1, b: flip ? p.p1 : p.p2, book: p.book || '' };
}
const odd = v => (typeof v === 'number' && isFinite(v) && v >= 1.01 ? v.toFixed(2) : DASH);

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// STATISTICS — Speed (how-it-plays.json) + Favourites and underdogs (favourites-by-round.json, database-yield.json
// through settlement.js, tour-baselines.json, this edition's progression scores)
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const SPEED = [['Aces per match', 'acesPerMatch', 1, ''], ['Sets with a tiebreak', 'tiebreaksPerSet', 100, '%'], ['1st serve points won', 'firstServeWon', 100, '%'],
  ['2nd serve points won', 'secondServeWon', 100, '%'], ['Service games held', 'hold', 100, '%']];
const ROUND_IX = { '1st Round': 0, '2nd Round': 1, '3rd Round': 2, '4th Round': 3 };
function hipEvent(ev) { const hip = file('how-it-plays.json'); return hip && hip.events ? Object.values(hip.events).find(e => e && e.name === ev.dname) || null : hip === undefined ? undefined : null; }
// this event's Database rows (database-yield.json rows + retRows), name list + archive filter as tournament-market.json
// builds the event (build-tournament-market.js ALIAS / ROW_SPLIT); retirements through settlement.js
function dbRowsOf(ev) {
  const D = file('database-yield.json'), TM = file('tournament-market.json');
  if (D === undefined || TM === undefined) return undefined;
  if (!D) return null;
  const T = (D.meta && D.meta.tournaments) || [];
  const tm = TM && TM.tournaments && TM.tournaments[ev.dname];
  const names = tm && tm.archiveNames ? tm.archiveNames : (T.indexOf(ev.dname) >= 0 ? [ev.dname] : []);
  const filt = (tm && tm.archiveFilter) || {};
  const ix = new Map(names.map(n => [T.indexOf(n), n]).filter(x => x[0] >= 0));
  const ok = r => { const n = ix.get(r[4]); if (n == null) return false; const f = filt[n]; if (!f) return true;
    const y = Math.floor(r[0] / 1e4), mo = Math.floor(r[0] / 100) % 100;
    return (!f.years || f.years.includes(y)) && (!f.surfaces || f.surfaces.includes(r[2])) && (!f.months || f.months.includes(mo)); };
  const Sm = typeof window !== 'undefined' ? window.Settlement : null;
  const out = [];
  (D.rows || []).forEach((r, i) => { if (ok(r)) out.push({ r, i, ret: false, bet: true, win: true }); });
  (D.retRows || []).forEach((r, i) => {
    if (!ok(r)) return;
    const cm = D.retComment && D.retComment[i], fs = D.retFs && D.retFs[i];
    out.push({ r, i, ret: true, bet: !!(Sm && Sm.betCounts({ comment: cm, fs })), win: !!(Sm && Sm.matchWinner({ comment: cm, winnerSide: 1 }) != null) });
  });
  return out;
}
function seasonFigs(rows) {   // season → favourites won % (win population) and flat-1u yields (bet population), floor 15
  const by = {};
  for (const x of rows) {
    const y = Math.floor(x.r[0] / 1e4), o = by[y] || (by[y] = { favW: 0, favN: 0, fp: 0, dp: 0, betN: 0 });
    if (x.win) { o.favN++; if (x.r[7]) o.favW++; }
    if (x.bet) { o.betN++; o.fp += x.r[7] ? x.r[5] - 1 : -1; o.dp += x.r[7] ? -1 : x.r[6] - 1; }
  }
  const res = {};
  for (const y of Object.keys(by)) { const o = by[y];
    res[y] = { fav: o.favN >= FLOOR ? 100 * o.favW / o.favN : null, favN: o.favN, favY: o.betN >= FLOOR ? 100 * o.fp / o.betN : null,
      dogY: o.betN >= FLOOR ? 100 * o.dp / o.betN : null, betN: o.betN, favW: o.favW, fp: o.fp, dp: o.dp }; }
  return res;
}
// deciders and comebacks of this edition, from its own results (progression set scores through the draw model)
function setFacts(M, best) {
  let n = 0, dec = 0, cb = 0;
  if (M) M.rounds.forEach(R => R.cells.forEach(c => {
    const m = c.match; if (!m || m.status !== 'finished' || !Array.isArray(m.score) || !m.score.length) return;
    const wi = c.sides.findIndex(s => keyOf(s) === m.winnerKey); if (wi < 0) return;
    n++; const s0 = m.score[0], down = wi === 0 ? s0[0] < s0[1] : s0[1] < s0[0];
    if (m.score.length === best) dec++; if (down) cb++;
  }));
  return { n, dec, cb };
}
function bestOf(ev) { return /grand slam/i.test(String(ev.draw.category || '')) ? 5 : 3; }
function speedFig(ev, cy) {
  const hip = file('how-it-plays.json'), hev = hipEvent(ev), fl = (hip && hip.floor) || FLOOR;
  const cur = hev && hev.current && Array.isArray(hev.current.years) && hev.current.years.includes(cy) && hev.current.n >= fl ? hev.current : null;
  return cur && cur.metrics.acesPerMatch ? f1(cur.metrics.acesPerMatch.value) : DASH;
}
function statsModel(ev, M) {
  const yr = +String(ev.start).slice(0, 4), live = played(M) > 0, cy = live ? yr : yr - 1;
  const hip = file('how-it-plays.json'), fbr = file('favourites-by-round.json'), tb = file('tour-baselines.json');
  const hev = hipEvent(ev), hfloor = (hip && hip.floor) || FLOOR;
  const cur = hev && hev.current && Array.isArray(hev.current.years) && hev.current.years.includes(cy) && hev.current.n >= hfloor ? hev.current : null;
  const base = hev && hip.baseline ? hip.baseline[hev.baseline] : null;
  const by = base && base.years || [];
  const baseWords = hev ? `ATP ${hev.indoor ? 'indoor' : 'outdoor'} hard, best of three, ${by[0]}${NDASH}${by[by.length - 1]}` : '';
  const speed = SPEED.map(([label, k, mul, unit]) => {
    const mc = cur && cur.metrics[k], mb = base && base.metrics && base.metrics[k];
    return { label, unit, sign: false, v: mc ? mc.value * mul : null, tour: mb ? mb.value * mul : null, series: {},
      vTitle: mc ? `${cur.n} matches, ${ev.city} ${cy} main draw (our box scores)` : (hev ? `No ${cy} figure for ${ev.city} (fewer than ${hfloor} matches with box scores)` : `${ev.city}: no How it plays figures (hard courts only)`),
      tourTitle: mb ? `${baseWords}, ${base.n} matches (Sackmann 2016${NDASH}24 under CC BY-NC-SA, our box scores 2025)` : 'No tour average for this court' };
  });
  // Favourites and underdogs
  const fe = fbr && fbr.events && fbr.events[ev.dname];
  const lastRow = rows => (Array.isArray(rows) && rows.length ? rows[rows.length - 1] : null);
  const fCur = fe && fe.current && fe.current.year === cy ? lastRow(fe.current.rows) : null;
  const fB = fe && fbr.baseline && fbr.baseline[fe.court], fBase = fB ? lastRow(fB.rows) : null;
  const pctOf = row => (row && row.n >= FLOOR ? 100 * row.fav / row.n : null);
  const dbRows = dbRowsOf(ev), sf = dbRows ? seasonFigs(dbRows) : {};
  const cyF = sf[cy] || null, sets = live ? setFacts(M, bestOf(ev)) : { n: 0, dec: 0, cb: 0 };
  const role = k => (tb && tb.roles && tb.roles[k] && tb.roles[k].yield != null ? tb.roles[k] : null);
  const series = k => { const o = {}; Object.keys(sf).forEach(y => { if (+y < cy && sf[y][k] != null) o[y] = sf[y][k]; }); return o; };
  const mkt = [
    { key: 'fav', label: 'Favourites won', unit: '%', sign: false, v: fCur ? pctOf(fCur) : cyF ? cyF.fav : null, tour: pctOf(fBase), series: series('fav'),
      vTitle: fCur ? `${fCur.fav} of ${fCur.n} priced matches won by the shorter Pinnacle close (ties, no close and walkovers out)` : cyF ? `${cyF.favW} of ${cyF.favN} priced matches won by the shorter closing price (Database rows, retirements count)` : `No ${cy} favourites figure`,
      tourTitle: fBase ? `ATP ${String(fe.court).toLowerCase()}, ${(fB.years || []).join(NDASH)}, ${fBase.n} matches` : '' },
    { key: 'favY', label: 'Backing favourites', unit: '%', sign: true, v: cyF ? cyF.favY : null, tour: role('favourite') ? role('favourite').yield * 100 : null, series: series('favY'),
      vTitle: cyF ? `1 unit on every favourite, ${cyF.betN} priced matches (retirements settle on Pinnacle rules)` : `No ${cy} priced matches`,
      tourTitle: role('favourite') ? `Tour yield, ${role('favourite').n} matches, ${(tb.dateRange || []).join(NDASH)}` : '' },
    { key: 'dogY', label: 'Backing underdogs', unit: '%', sign: true, v: cyF ? cyF.dogY : null, tour: role('underdog') ? role('underdog').yield * 100 : null, series: series('dogY'),
      vTitle: cyF ? `1 unit on every underdog, ${cyF.betN} priced matches (retirements settle on Pinnacle rules)` : `No ${cy} priced matches`,
      tourTitle: role('underdog') ? `Tour yield, ${role('underdog').n} matches, ${(tb.dateRange || []).join(NDASH)}` : '' },
    { key: 'dec', label: 'Matches going to a decider', unit: '%', sign: false, v: sets.n >= FLOOR ? 100 * sets.dec / sets.n : null, tour: null, series: {},
      vTitle: sets.n ? `${sets.dec} of ${sets.n} completed matches` : 'No completed match yet', tourTitle: 'No tour figure on file (needs past set scores)' },
    { key: 'cb', label: 'Won from a set down', unit: '%', sign: false, v: sets.n >= FLOOR ? 100 * sets.cb / sets.n : null, tour: null, series: {},
      vTitle: sets.n ? `${sets.cb} of ${sets.n} completed matches` : 'No completed match yet', tourTitle: 'No tour figure on file (needs past set scores)' },
  ];
  [speed, mkt].forEach(g => g.forEach(t => {
    const held = Object.keys(t.series).map(Number).sort((a, b) => a - b);
    const five = held.slice(-5);
    t.gapN = t.v != null && t.tour != null ? sg(t.v - t.tour) : DASH;
    t.gapLL = 'vs ' + (cy - 1);
    t.gapL = t.v != null && t.series[cy - 1] != null ? sg(t.v - t.series[cy - 1]) : DASH;
    // past five = the five editions held before this one (founder 2026-11-15); fewer on file → a dash
    t.avg5 = five.length === 5 ? five.reduce((a, y) => a + t.series[y], 0) / 5 : null;
    t.gapP = t.v != null && t.avg5 != null ? sg(t.v - t.avg5) : DASH;
    // six columns: those five editions (padded with the seasons before them when fewer are on file) + this one
    let ys = five.slice(); let y0 = (ys[0] || cy) - 1; while (ys.length < 5) { ys.unshift(y0); y0--; }
    ys = ys.concat([cy]);
    const vals = ys.map((y, j) => (j === 5 ? t.v : t.series[y] != null ? t.series[y] : null));
    const all = vals.concat([t.tour]).filter(x => x != null), lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    const ch = x => 18 + (hi > lo ? (x - lo) / (hi - lo) : 0.5) * 82;
    t.tourB = t.tour != null ? ch(t.tour) + '%' : null;
    t.cols = ys.map((y, j) => ({ y, now: j === 5, v: vals[j], h: vals[j] != null ? ch(vals[j]) + '%' : '0%' }));
    t.fig = t.v == null ? DASH : (t.sign && t.v > 0 ? '+' : t.v < 0 ? MINUS : '') + f1(t.v) + t.unit;
    t.figColor = t.sign && t.v != null ? (t.v > 0 ? C.green : t.v < 0 ? C.red : C.white) : C.white;
  }));
  const fm = (t, x) => (x == null ? DASH : (t.sign && x > 0 ? '+' : x < 0 ? MINUS : '') + f1(x) + t.unit);
  // group notes: only what the figures say (the design's "vs last year" clause needs per-edition speed: omitted)
  const up = speed.filter(t => t.v != null && t.tour != null && t.v > t.tour).length, have = speed.filter(t => t.v != null && t.tour != null).length;
  const n1 = have === 5 ? (up >= 4 ? `Playing faster than the tour, ${up} of 5 measures above average` : up <= 1 ? `Playing slower than the tour, ${5 - up} of 5 measures below average` : 'Speed close to the tour average') : '';
  const fd = mkt[0].v != null && mkt[0].tour != null ? mkt[0].v - mkt[0].tour : null;
  const n2 = fd == null ? '' : fd >= 4 ? 'Favourites are holding up better than usual' : fd <= -4 ? 'More upsets than usual' : 'Favourites win about as often as usual';
  return { live, cy, speed, mkt, n1, n2, fm, dbRows, sets, hev };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// RENDER
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
function shell(inner) { return `<div class="tt-draw"><div class="tt-draw-pane">${inner}</div></div>`; }
function render(el) {
  if (el) S.el = el;
  const root = S.el; if (!root) return;
  injectCss();
  H = [];
  const D = DV(), dd = drawsData();
  if (!D || dd === undefined) { paint(root, shell(`<div style="font-size:13px; color:${C.muted};">Loading the official draw…</div>`)); return; }
  file('draws-archive.json');   // the draw-results branch's archive (a 404 = none); repaints when it lands
  const E = events();
  if (!E.all.length) { paint(root, shell(`<div style="font-size:13px; color:${C.muted};">${dd === null ? 'The official draw could not be loaded ' + NDASH + ' try again in a minute.' : 'No official draw is posted for this week yet.'}</div>`)); return; }
  if (!S.key || !E.all.some(e => e.key === S.key)) S.key = (E.now[0] || E.fin[0] || E.arch[0]).key;
  const ev = E.all.find(e => e.key === S.key);
  const qualPosted = !!(ev.draw.qualifying && ev.draw.qualifying.status === 'posted');
  if (S.kind === 'qual' && !qualPosted) S.kind = 'main';
  if (S.view === 'out') S.kind = 'main';
  const Mm = modelOf(ev, 'main'), M = S.kind === 'qual' ? modelOf(ev, 'qual') : Mm, F = facts(Mm, ev);
  if (S.sel && !F.byKey.has(S.sel)) Object.assign(S, { sel: null, b: null, cmp: false });
  if (S.b && !F.byKey.has(S.b)) S.b = null;
  const view = S.view === 'stats' ? 'stats' : S.view === 'out' ? 'out' : 'draw';
  if (view === 'stats') { file('how-it-plays.json'); file('favourites-by-round.json'); file('tour-baselines.json'); file('database-yield.json'); file('tournament-market.json'); }
  if (view !== 'stats') { S.ed = null; S.stat = null; }
  const st = view === 'stats' ? statsModel(ev, Mm) : null;
  const yr = +String(ev.start).slice(0, 4);
  const statsFig = speedFig(ev, played(Mm) > 0 ? yr : yr - 1);

  let h = '';
  // ── title row ──
  const cmpTop = S.outCmp;
  h += `<div style="display:flex; align-items:center; justify-content:space-between; gap:16px 28px; flex-wrap:wrap;">
    <div style="display:flex; align-items:baseline; gap:14px; flex-wrap:wrap; min-width:0;"><span style="font-size:24px; font-weight:800; letter-spacing:-0.015em; line-height:1.1;">Draws</span><span style="font-size:13px; color:${C.muted};">${E.now.length} this week · ${E.fin.length} finished</span></div>
    <span class="tt-draw-hi8" onclick="${on(() => { if (S.outCmp) Object.assign(S, { outCmp: false, outA: null, outB: null, outQ: '' }); else { Object.assign(S, { kind: 'main', outCmp: true, outA: null, outB: null, outQ: '', sel: null, b: null, cmp: false, shut: null }); S._focusNext = true; } repaint(); })}" style="flex:none; cursor:pointer; display:inline-flex; align-items:center; height:34px; box-sizing:border-box; padding:0 14px; border-radius:9px; font-size:13px; font-weight:700; white-space:nowrap; color:${cmpTop ? C.text : C.white}; background:${cmpTop ? 'transparent' : C.blue}; border:1px solid ${cmpTop ? W(16) : C.blue};">${cmpTop ? 'Cancel' : 'Compare two routes'}</span></div>`;
  if (S.outCmp) h += pickStrip(ev, F);
  // ── tournament groups ──
  const tourPill = (e, sub, title) => { const o = e.key === S.key;
    return `<span class="tt-draw-seg"${title ? ` title="${esc(title)}"` : ''} onclick="${on(() => { S.key = e.key; S.from = null; S.kind = 'main'; reset(); repaint(); })}" style="display:flex; align-items:baseline; gap:9px; font-size:12.5px; font-weight:${o ? 700 : 600}; color:${o ? C.white : C.muted}; background:${o ? C.raised : 'transparent'}; border:1px solid ${o ? W(16) : 'transparent'}; border-radius:8px; padding:7px 14px; white-space:nowrap; cursor:pointer;"><span>${esc(e.label)}</span><span style="${MONO} font-size:10.5px; font-weight:500; color:${C.muted};">${esc(sub)}</span></span>`; };
  const group = (label, list, fn) => `<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;"><span style="${CAPS}">${label}</span>${list.length ? track(list.map(fn).join('')) : `<span style="font-size:12.5px; color:${C.muted};">${label === 'This week' ? 'No draw in play this week' : DASH}</span>`}</div>`;
  const stageFor = e => { const m = modelOf(e, 'main'); return stageOf(m, facts(m, e)); };
  const finPill = e => { const s = stageFor(e); return tourPill(e, s, weekRange(e.start, e.end) + (s !== DASH && s !== 'Draw out' ? ' · champion ' + s : '')); };
  h += `<div style="display:flex; flex-wrap:wrap; align-items:center; gap:12px 24px; margin-top:18px;">`
    + group('This week', E.now, e => tourPill(e, stageFor(e)))
    + group('Finished', E.fin, finPill)
    // kept beside the design's two groups: the draw-results branch's archive (founder 2026-11-15, post-dates the export)
    + (E.arch.length ? group('Archive', E.arch, finPill) : '')
    + `</div>`;
  h += `<div style="margin:20px -24px 0; border-top:1px solid ${W(6)};"></div>`;
  // ── view pills + kind ──
  const views = [['draw', 'Draw', M ? `${played(M)} of ${total(M)}` : DASH], ['stats', 'Statistics', statsFig], ['out', 'Outright chances', DASH]];
  h += `<div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:14px 24px; margin-top:20px;">
    <div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px;">${views.map(([v, l, fig]) => { const o = v === view;
      return `<span class="tt-draw-vp" onclick="${on(() => { S.view = v; if (v === 'out') S.kind = 'main'; repaint(); })}"${v === 'out' ? ' title="Title chance of the favourite: no source yet"' : ''} style="cursor:pointer; display:inline-flex; align-items:center; gap:8px; height:34px; box-sizing:border-box; padding:0 12px; border-radius:9px; font-size:13px; font-weight:700; white-space:nowrap; color:${o ? C.white : C.soft}; background:${o ? W(8) : 'transparent'}; border:1px solid ${o ? W(55) : W(12)};">${l}<span style="${MONO} font-size:11.5px; font-weight:500; color:${C.muted};">${esc(fig)}</span></span>`; }).join('')}</div>
    <div style="display:flex; flex-wrap:wrap; align-items:center; gap:12px;"><div style="display:flex; gap:3px; background:${C.inset}; border:1px solid ${W(6)}; border-radius:10px; padding:3px;">${
      [['main', 'Main draw'], ['qual', 'Qualifying']].map(([k, l]) => (k === 'qual' && !qualPosted)
        ? `<span title="The qualifying draw is not posted" style="font-size:12.5px; font-weight:600; color:${C.muted}; opacity:0.4; border:1px solid transparent; border-radius:8px; padding:6px 12px; white-space:nowrap; cursor:default;">${l}</span>`
        : pill(l, S.kind === k, on(() => { S.kind = k; S.from = null; if (k === 'qual' && S.view === 'out') S.view = 'draw'; repaint(); }), 'padding:6px 12px;')).join('')}</div></div></div>`;
  // ── progress line + From ──
  const tp = total(M), pl = played(M);
  const results = ev.arch ? `Final results · archived ${fmtWhen(ev.archivedAt)}` : `Results ${progData() && progData().fetchedAt ? ago(progData().fetchedAt) : DASH}`;
  const names = M ? M.rounds.map(r => r.name) : [];
  const fromOpts = names.slice(0, Math.max(1, names.length - 1));
  if (S.kind === 'qual' || !fromOpts.includes(S.from)) S.from = names[0] || null;
  const showFrom = S.kind !== 'qual' && view === 'draw' && !!M;
  h += `<div style="display:flex; flex-wrap:wrap; align-items:center; gap:10px 16px; margin-top:16px;">
    <div title="${pl} of ${tp} matches played" style="flex:1 1 80px; height:4px; border-radius:2px; background:${W(5)}; overflow:hidden;"><div style="height:100%; width:${tp ? Math.round(pl / tp * 100) : 0}%; background:${C.past}; border-radius:2px;"></div></div>
    <span style="flex:none; font-size:12px; color:${C.muted}; white-space:nowrap;">${esc(results)} · draw sheet ${esc(fmtWhen(M ? M.changedAt : ev.draw.contentChangedAt))}</span>
    ${showFrom ? `<div style="flex:none; display:flex; align-items:center; gap:10px;"><span style="${CAPS}">From</span><div style="display:flex; gap:3px; background:${C.inset}; border:1px solid ${W(6)}; border-radius:10px; padding:3px;">${fromOpts.map(n => pill(n, n === S.from, on(() => { S.from = n; repaint(); }), 'padding:6px 16px;')).join('')}</div></div>` : ''}</div>`;
  // kept from the live tab (founder 2026-10-21 round 3; post-dates the export): the W/UE sheet bar, Draw view only
  if (view === 'draw' && ev.entryName && typeof tourxWueBarHtml === 'function') {
    let wue = ''; try { wue = tourxWueBarHtml(ev.entryName) || ''; } catch (e) { wue = ''; }
    if (wue) h += `<div class="tt-draw-wue" style="margin-top:12px;">${wue}</div>`;
  }
  // ── Statistics ──
  if (view === 'stats') h += statsHtml(ev, Mm, st);
  // ── selection / outright ──
  if (S.kind !== 'qual') {
    h += `<div style="margin-top:14px;">`;
    if (view === 'out') h += outrightHtml(ev, Mm, F);
    if (S.sel && view === 'draw') h += selHtml(ev, Mm, F);
    h += `</div>`;
  }
  // ── bracket ──
  if (view === 'draw' && M) h += bracketHtml(ev, M, F);
  if (view === 'draw' && !M) h += `<div style="margin-top:24px; font-size:13px; color:${C.muted};">This draw is not posted yet.</div>`;
  // the design's footnote, without its sentences about title chances, path chances and fair odds (founder ruling 3)
  h += `<p style="margin:16px 0 0; font-size:12px; color:${C.muted};">Grey figures on unplayed matches are the current match-winner prices. The white tick on a statistic is the tour average.</p>`;
  paint(root, shell(h));
}

// keep focus + caret in a re-rendered input (every keystroke repaints)
function paint(root, html) {
  const a = typeof document !== 'undefined' ? document.activeElement : null;
  const fid = a && a.getAttribute && root.contains(a) ? a.getAttribute('data-ttin') : null, pos = fid ? a.selectionStart : null;
  root.innerHTML = html;
  if (fid) { const n = root.querySelector(`[data-ttin="${fid}"]`); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (e) { /* not text */ } } }
  else if (S._focusNext) { const af = root.querySelector('[data-ttin]'); if (af) af.focus(); }
  S._focusNext = false;
}
function repaint() { if (S.el && S.el.isConnected !== false && (!S.el.style || S.el.style.display !== 'none')) render(); }

// ── bracket ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function bracketHtml(ev, M, F) {
  const qual = S.kind === 'qual', fromIx = Math.max(0, M.rounds.findIndex(r => r.name === S.from));
  const vis = M.rounds.slice(fromIx), Hpx = vis[0].cells.length * 96;
  const selPos = !qual && S.sel && F.byKey.get(S.sel) ? F.byKey.get(S.sel).pos : null, bPos = !qual && S.b && F.byKey.get(S.b) ? F.byKey.get(S.b).pos : null;
  const cmpMode = !!(S.sel && S.cmp);
  const row = (c, k) => {
    const s = c.sides[k], o = c.sides[1 - k];
    if (!s) {
      if (c.bye) return `<div style="display:flex; align-items:center; gap:8px; height:26px; padding:0 6px; margin:0 -6px; border-radius:6px;"><span style="margin-left:38px; font-size:12.5px; color:${C.muted};">Bye</span></div>`;
      return `<div style="display:flex; align-items:center; gap:8px; height:26px; padding:0 6px; margin:0 -6px; border-radius:6px;"></div>`;
    }
    const key = keyOf(s), m = c.match, dec = !!m, win = dec && m.winnerKey === key;
    const isSel = !qual && key && key === S.sel, isB = !qual && key && key === S.b;
    const mark = isSel || (S.outCmp && key && key === S.outA), white = isB || (S.outCmp && key && key === S.outB);
    const w = win ? 700 : dec ? 500 : 600, color = mark ? C.blue : win || white ? C.white : dec ? C.muted : C.text;
    const bg = mark ? B(13) : white ? W(8) : 'transparent';
    let sets = '', odds = '', title = '';
    if (dec && Array.isArray(m.score)) sets = m.score.map(p => { const mine = k ? p[1] : p[0], th = k ? p[0] : p[1], won = mine > th;
      return `<span style="width:9px; text-align:center; font-weight:${won ? 700 : 400}; color:${won ? C.text : C.muted};">${esc(mine)}</span>`; }).join('');
    else if (!dec && c.when && c.when.live && c.when.liveScore) { sets = c.when.liveScore.map(p => `<span style="width:9px; text-align:center; font-weight:400; color:${C.text};">${esc(k ? p[1] : p[0])}</span>`).join(''); title = 'Live'; }
    else if (!dec && o && !qual) { const p = boardPrice(ev, c.sides[0], c.sides[1]); if (p) { const v = k ? p.b : p.a; odds = odd(v);
      title = v != null ? `Price ${odd(v)}${p.book ? ' · ' + (typeof mxBookLabel === 'function' ? mxBookLabel(p.book) : p.book) : ''}` : 'No current price on Today’s Matches'; } }
    const tag = tagOf(s) + (dec && !win && m.status === 'retired' ? ' ret.' : dec && !win && m.status === 'walkover' ? ' w/o' : '');
    const ioc = s.ioc || (s.neutral ? 'NEU' : DASH);
    return `<div class="tt-draw-prow" data-tt-player="${esc(key || '')}" onclick="${on(() => pickPlayer(key, qual))}"${title ? ` title="${esc(title)}"` : ''} style="cursor:pointer; display:flex; align-items:center; gap:8px; height:26px; padding:0 6px; margin:0 -6px; border-radius:6px; background:${bg};">`
      + `<span style="flex:none; min-width:30px; text-align:center; ${MONO} font-size:9px; font-weight:700; letter-spacing:0.04em; color:${C.muted}; border:1px solid ${W(10)}; border-radius:5px; padding:2px 4px;">${esc(ioc)}</span>`
      + `<span style="flex:1; min-width:0; display:flex; align-items:baseline; gap:6px;"><span style="min-width:0; font-size:13px; font-weight:${w}; color:${color}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(nameOf(s))}</span><span style="flex:none; ${MONO} font-size:10px; color:${C.muted};">${esc(tag)}</span></span>`
      + `<span style="flex:none; display:flex; gap:7px; ${MONO} font-size:12.5px; font-variant-numeric:tabular-nums;">${sets}${odds ? `<span style="font-size:11.5px; color:${C.muted};">${esc(odds)}</span>` : ''}</span></div>`;
  };
  const cols = vis.map((R, ci) => {
    const ri = fromIx + ci;
    const slots = R.cells.map((c, j) => {
      const any = c.sides[0] || c.sides[1] || c.match || c.bye;
      const foc = selPos != null, onA = foc && ((selPos - 1) >> (ri + 1)) === j, onB = foc && bPos != null && ((bPos - 1) >> (ri + 1)) === j;
      const ring = onA ? B(50) : onB ? W(34) : '';
      const op = foc && !cmpMode && !onA ? 0.55 : 1;
      const conn = ci > 0 ? `<span style="position:absolute; left:-28px; width:14px; top:25%; height:50%; border:1px solid ${W(10)}; border-left:0;"></span><span style="position:absolute; left:-14px; width:14px; top:50%; border-top:1px solid ${W(10)};"></span>` : '';
      const body = any
        ? `<div style="flex:1; min-width:0; background:${C.inset}; border:1px solid ${ring || W(7)}; border-radius:10px; padding:7px 11px; display:flex; flex-direction:column; gap:2px;">${row(c, 0)}${row(c, 1)}</div>`
        : `<div style="flex:1; height:64px; border:1px dashed ${ring || W(9)}; border-radius:10px;"></div>`;
      return `<div style="flex:1; min-height:0; position:relative; display:flex; align-items:center; opacity:${op}; transition:opacity .16s ease;">${conn}${body}</div>`;
    }).join('');
    return `<div style="flex:1 0 232px; min-width:232px; max-width:320px;"><div style="display:flex; align-items:baseline; justify-content:space-between; padding:0 2px 12px; border-bottom:1px solid ${W(10)};"><span style="font-size:13px; font-weight:700; color:${R.done === R.total ? C.muted : C.text};">${esc(longOf(R.name))}</span><span style="${MONO} font-size:10.5px; color:${C.muted};">${R.done} of ${R.total}</span></div><div style="display:flex; flex-direction:column; height:${Hpx}px; margin-top:10px;">${slots}</div></div>`;
  }).join('');
  return `<div class="tt-draw-bracket" style="display:flex; gap:28px; margin-top:24px; overflow-x:auto; padding-bottom:6px;">${cols}</div>`;
}
function pickPlayer(key, qual) {
  if (!key) return;
  if (qual) { if (hasProfile(key)) openProfile(key); return; }   // the design: a qualifying row opens his profile
  if (S.outCmp) return pickOut(key);
  if (S.sel && S.cmp) { if (key !== S.sel) Object.assign(S, { b: key, cmpQ: '', shut: null, opp: null }); }
  else Object.assign(S, { sel: key, b: null, cmp: false, shut: null, opp: null });
  repaint();
}
function pickOut(key) {
  if (key === S.outA) return;
  if (!S.outA) Object.assign(S, { outA: key, outQ: '' });
  else Object.assign(S, { view: 'draw', sel: S.outA, b: key, cmp: true, outCmp: false, outA: null, outB: null, outQ: '', cmpQ: '', shut: null, opp: null });
  S._focusNext = !!S.outCmp;
  repaint();
}

// ── Compare two routes · pick strip ────────────────────────────────────────────────────────────────────────────────
const lc = s => String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function pickStrip(ev, F) {
  const q = lc(S.outQ.trim());
  // suggestions: name matches while typing. With nothing typed the design lists the most likely winners — a list
  // ordered by chances (founder ruling 3), so no suggestion row is drawn until a name is typed.
  const hits = q ? F.slots.filter(s => lc(nameOf(s)).indexOf(q) >= 0 || lc(s.name).indexOf(q) >= 0).map(s => String(s.playerKey)).filter(k => k !== S.outA && k !== S.outB).slice(0, 5) : [];
  const slot = (k, i) => {
    const f = !!k, act = !f && (i === 0 || !!S.outA), s = f ? F.byKey.get(k) : null;
    const avBd = f ? (i ? W(40) : B(60)) : act ? B(70) : W(25), avC = act ? C.blueFav : C.muted;
    const av = f ? avatar(k, nameOf(s), 28, avBd, 10.5, 1.5) : `<span style="flex:none; width:28px; height:28px; box-sizing:border-box; border-radius:50%; background:transparent; border:1.5px dashed ${avBd}; display:flex; align-items:center; justify-content:center; font-size:10.5px; font-weight:700; color:${avC};">${i + 1}</span>`;
    const inner = f ? `<span style="flex:1; min-width:0; font-size:14px; font-weight:700; color:${C.white}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(nameOf(s))}</span><span class="tt-draw-chg" onclick="${on(() => { if (i) Object.assign(S, { outB: null, outQ: '' }); else Object.assign(S, { outA: S.outB, outB: null, outQ: '' }); S._focusNext = true; repaint(); })}" style="flex:none; cursor:pointer; font-size:12px; font-weight:700;">Change</span>`
      : act ? `<input data-ttin="outq" value="${esc(S.outQ)}" oninput="${on(e => { S.outQ = e.target.value; repaint(); })}" onkeydown="${on(e => { if (e.key === 'Enter' && hits[0]) pickOut(hits[0]); })}" placeholder="Type a name" style="flex:1; min-width:0; background:transparent; border:0; outline:none; color:${C.text}; font-family:inherit; font-size:14px;">`
      : `<span style="flex:1; font-size:14px; color:${C.muted};">Then the second player</span>`;
    return `<div style="grid-column:${i ? 3 : 1}; grid-row:1; display:flex; flex-direction:column; gap:7px; min-width:0;"><span style="${CAPS}">${i ? 'Player two' : 'Player one'}</span><div style="display:flex; align-items:center; gap:10px; height:44px; box-sizing:border-box; padding:0 12px; border-radius:10px; background:${C.inset}; border:1px solid ${act ? B(55) : W(10)};">${av}${inner}</div></div>`;
  };
  const step = S.outA ? 'Step 2 of 2 · pick the second player, the comparison opens by itself' : 'Step 1 of 2 · type a name, tap a suggestion or click a player in the draw';
  const sug = q ? `<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;"><span style="${CAPS} margin-right:4px;">Matches</span>${hits.map(k => `<span class="tt-draw-sug" onclick="${on(() => pickOut(k))}" style="cursor:pointer; display:inline-flex; align-items:center; height:30px; box-sizing:border-box; padding:0 11px; border-radius:8px; border:1px solid ${W(12)}; font-size:12.5px; font-weight:600; color:${C.text};">${esc(nameOf(F.byKey.get(k)))}</span>`).join('')}<span style="font-size:12.5px; color:${C.muted};">${hits.length ? '' : 'Nobody by that name in this draw'}</span></div>` : '';
  return `<div style="margin-top:14px; background:${C.card}; border:1px solid ${B(38)}; border-radius:14px; padding:16px 18px 18px; display:flex; flex-direction:column; gap:14px;">
    <div style="display:flex; align-items:baseline; justify-content:space-between; gap:6px 16px; flex-wrap:wrap;"><span style="font-size:14px; font-weight:800;">Compare two routes</span><span style="font-size:12.5px; color:${C.blueFav}; font-weight:600;">${step}</span></div>
    <div style="display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:end; gap:12px;">${slot(S.outA, 0)}${slot(S.outB, 1)}<span style="grid-column:2; grid-row:1; height:44px; display:flex; align-items:center; font-size:13px; color:${C.muted};">v</span></div>${sug}</div>`;
}

// ── player route card / compare card / collapsed bar / opponent report ───────────────────────────────────────────
function selHtml(ev, M, F) {
  const A = pathOf(M, F, S.sel); if (!A) return '';
  const me = A.me, cmpMode = !!S.cmp, picking = cmpMode && !S.b;
  const Bp = S.b ? pathOf(M, F, S.b) : null;
  if (Bp && S.shut === S.sel + '|' + S.b) {
    return `<div style="display:flex; align-items:center; justify-content:space-between; gap:12px 20px; flex-wrap:wrap; background:${C.inset}; border:1px solid ${B(35)}; border-radius:12px; padding:14px 18px;">
      <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; min-width:0;"><span style="flex:none; width:9px; height:9px; border-radius:50%; background:${C.blue};"></span><span style="font-size:15px; font-weight:800;">${esc(nameOf(me))}</span><span style="font-size:13px; color:${C.muted};">v</span><span style="flex:none; width:9px; height:9px; border-radius:50%; background:${C.text};"></span><span style="font-size:15px; font-weight:800;">${esc(nameOf(Bp.me))}</span><span style="font-size:12.5px; color:${C.muted};">Both players are still selected</span></div>
      <div style="display:flex; align-items:center; gap:8px;"><span class="tt-draw-bbtn" onclick="${on(() => { S.shut = null; repaint(); })}" style="cursor:pointer; display:inline-flex; align-items:center; height:32px; box-sizing:border-box; padding:0 13px; border-radius:8px; font-size:12.5px; font-weight:700; white-space:nowrap; color:${C.white}; background:${C.blue};">Open the comparison ›</span><span class="tt-draw-hi4" onclick="${on(() => { Object.assign(S, { sel: null, b: null, cmp: false, shut: null, opp: null }); repaint(); })}" style="cursor:pointer; display:inline-flex; align-items:center; height:32px; box-sizing:border-box; padding:0 13px; border-radius:8px; font-size:12.5px; font-weight:700; white-space:nowrap; color:${C.text}; border:1px solid ${W(16)};">Clear both</span></div></div>`;
  }
  const nm = p => hasProfile(p.key)
    ? `<span class="tt-draw-plink" onclick="${on(() => openProfile(p.key))}" title="Open his profile" style="font-size:19px; cursor:pointer; font-weight:800; letter-spacing:-0.01em;">${esc(nameOf(p.me))}</span>`
    : `<span style="font-size:19px; font-weight:800; letter-spacing:-0.01em; color:${C.text};">${esc(nameOf(p.me))}</span>`;
  // where the two could meet (positions only: DrawView.meetRound)
  let meet = null;
  if (Bp) {
    const pa = A.me.pos, r = DV().meetRound(pa, Bp.me.pos), cell = M.rounds[r] && M.rounds[r].cells[(pa - 1) >> (r + 1)];
    const inA = !!cell && cell.sides.some(s => keyOf(s) === S.sel), inB = !!cell && cell.sides.some(s => keyOf(s) === S.b);
    const dead = (F.out[S.sel] != null && F.out[S.sel] < r) || (F.out[S.b] != null && F.out[S.b] < r);
    const both = inA && inB, metDone = !!(both && cell && cell.match), open = !dead && !metDone;
    const rdL = longOf(M.rounds[r].name).toLowerCase();
    const line = dead ? 'Cannot meet in this draw any more' : (both ? (metDone ? 'Met in the ' : 'Meet in the ') : 'Could meet in the ') + rdL;
    meet = { r, dead, both, metDone, open, line, rdL };
  }
  const lineTxt = picking ? 'Search the second player below, or click him in the draw' : meet ? meet.line : A.champion ? 'Champion' : A.outAt >= 0 ? 'Out in the ' + A.cells[A.outAt].rd.toLowerCase() : A.line;
  const qFig = A.qWon ? 'Won' : DASH, tFig = A.champion ? 'Won' : DASH;
  let h = `<div style="background:${C.inset}; border:1px solid ${B(35)}; border-radius:14px; padding:26px 28px 28px; box-sizing:border-box;">
    <div style="display:flex; align-items:center; justify-content:space-between; gap:16px 28px; flex-wrap:wrap;">
      <div style="display:flex; flex-direction:column; gap:6px; min-width:0;"><div style="display:flex; align-items:baseline; gap:10px; flex-wrap:wrap;"><span style="flex:none; align-self:center; width:9px; height:9px; border-radius:50%; background:${C.blue};"></span>${nm(A)}`
    + (Bp ? `<span style="font-size:14px; color:${C.muted};">v</span><span style="flex:none; align-self:center; width:9px; height:9px; border-radius:50%; background:${C.text};"></span>${nm(Bp)}` : '')
    + `</div><span style="font-size:13px; font-weight:${picking ? 700 : 400}; color:${picking ? C.blue : C.soft};">${esc(lineTxt)}</span></div>
      <div style="display:flex; align-items:center; justify-content:flex-end; gap:14px 28px; flex-wrap:wrap; margin-left:auto;">`
    + (!cmpMode ? [['Win his quarter', qFig, 'Chance to reach the semi-finals: no source yet'], ['Title chance', tFig, 'Chance to win the title: no source yet']].map(([k, v, t]) => `<div style="display:flex; flex-direction:column; gap:5px; align-items:flex-end;"><span style="${CAPS}">${k}</span><span style="display:flex; align-items:baseline; gap:10px;"><span style="font-size:12px; color:${C.muted};"></span><span${v === DASH ? ` title="${t}"` : ''} style="${MONO} font-size:26px; font-weight:700; line-height:1; color:${C.white};">${v}</span></span></div>`).join('') : '')
    + `<div style="display:flex; align-items:center; gap:8px;">`
    + (Bp ? `<span class="tt-draw-bbtn" onclick="${on(() => goH2H(S.sel, S.b, A.me.ioc, Bp.me.ioc))}" style="cursor:pointer; display:inline-flex; align-items:center; height:32px; box-sizing:border-box; padding:0 13px; border-radius:8px; font-size:12.5px; font-weight:700; white-space:nowrap; color:${C.white}; background:${C.blue};">Open head to head ›</span>` : '')
    + `<span class="tt-draw-hi4" onclick="${on(() => { if (cmpMode) Object.assign(S, { cmp: false, b: null, cmpQ: '', opp: null }); else { Object.assign(S, { cmp: true, b: null, cmpQ: '' }); S._focusNext = true; } repaint(); })}" style="cursor:pointer; display:inline-flex; align-items:center; height:32px; box-sizing:border-box; padding:0 13px; border-radius:8px; font-size:12.5px; font-weight:700; white-space:nowrap; color:${cmpMode ? C.text : C.white}; background:${cmpMode ? 'transparent' : C.blue}; border:1px solid ${cmpMode ? W(16) : C.blue};">${cmpMode ? 'Stop comparing' : 'Compare with another player'}</span>`
    + closeBtn(on(() => { if (Bp) Object.assign(S, { shut: S.sel + '|' + S.b, opp: null }); else Object.assign(S, { sel: null, b: null, cmp: false }); repaint(); }))
    + `</div></div></div>`;
  if (cmpMode) {
    const q = lc(S.cmpQ.trim());
    const hits = q ? F.slots.filter(s => String(s.playerKey) !== S.sel && (lc(nameOf(s)).indexOf(q) >= 0 || lc(s.name).indexOf(q) >= 0)).slice(0, 6) : [];
    h += `<div style="display:flex; align-items:center; gap:10px 14px; flex-wrap:wrap; margin-top:18px;">
      <label style="display:flex; align-items:center; gap:10px; box-sizing:border-box; width:320px; max-width:100%; height:40px; padding:0 14px; background:${C.card}; border:1px solid ${B(38)}; border-radius:10px;">${SEARCH_SVG}<input data-ttin="cmpq" value="${esc(S.cmpQ)}" oninput="${on(e => { S.cmpQ = e.target.value; repaint(); })}" placeholder="${Bp ? 'Search another player to compare' : 'Search the second player'}" style="flex:1; min-width:0; background:transparent; border:0; outline:none; color:${C.text}; font-family:inherit; font-size:13.5px;"></label>`
      + hits.map(s => `<span class="tt-draw-sug" onclick="${on(() => { Object.assign(S, { b: String(s.playerKey), cmpQ: '', shut: null, opp: null }); repaint(); })}" style="cursor:pointer; display:inline-flex; align-items:baseline; gap:7px; height:34px; line-height:34px; box-sizing:border-box; padding:0 13px; border-radius:8px; border:1px solid ${W(12)}; font-size:13px; font-weight:600; color:${C.text}; white-space:nowrap;"><span>${esc(nameOf(s))}</span><span style="${MONO} font-size:10.5px; color:${C.muted};">${esc(tagOf(s) || s.ioc || '')}</span></span>`).join('')
      + `<span style="font-size:12.5px; color:${C.muted};">${q && !hits.length ? 'Nobody by that name in this draw' : ''}</span></div>`;
  }
  h += Bp ? compareBody(ev, M, F, A, Bp, meet) : singleRail(A);
  return h + `</div>`;
}
function singleRail(A) {
  const n = A.cells.length;
  return `<div style="display:grid; grid-template-columns:repeat(${n},minmax(0,1fr)); margin-top:20px;">${A.cells.map(c => {
    const dot = c.state === 'won' ? C.white : c.state === 'bye' ? C.soft : c.next ? C.blue : C.inset;
    const dotBd = c.state === 'won' ? C.white : c.state === 'bye' ? C.soft : c.state === 'lost' ? C.muted : c.next ? C.blue : W(25);
    const link = c.state !== 'gone' && c.state !== 'bye' && c.oppKey;
    const opp = link ? `<span class="tt-draw-plink" onclick="${on(() => goH2H(A.key, c.oppKey, A.me.ioc, ''))}" title="Open head to head" style="cursor:pointer; font-size:13.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(c.opp)}</span>`
      : `<span style="font-size:13.5px; font-weight:600; color:${C.text}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(c.opp)}</span>`;
    const meta = c.state === 'open' ? `<span title="Likely opponent and opening price: no source yet" style="${MONO} font-size:10.5px; line-height:1.5; color:${C.muted};">${c.known ? '' : DASH + ' likely · '}opens ${DASH}</span>` : '';
    const bar = c.state === 'open' ? `<div style="height:4px; border-radius:2px; background:${W(5)};"></div>` : '';
    return `<div style="display:flex; flex-direction:column; gap:7px; min-width:0; padding-right:12px; opacity:${c.op};">
      <div style="position:relative; height:11px; margin-bottom:5px;"><span style="position:absolute; left:0; right:-12px; top:5px; border-top:1px solid ${W(12)};"></span><span style="position:absolute; left:0; top:0; width:11px; height:11px; box-sizing:border-box; border-radius:50%; background:${dot}; border:1.5px solid ${dotBd}; box-shadow:0 0 0 4px ${C.inset};"></span></div>
      <span style="${CAPS} color:${c.next ? C.blue : C.muted};">${esc(c.rd)}</span>${opp}${meta}
      <span${c.state === 'open' ? ' title="Chance: no source yet"' : ''} style="${MONO} font-size:19px; font-weight:700; line-height:1.15; color:${c.figColor};">${esc(c.fig)}</span>${bar}
      <span style="font-size:11.5px; color:${C.muted};">${esc(c.sub)}</span></div>`;
  }).join('')}</div>`;
}
function compareBody(ev, M, F, A, Bp, meet) {
  let h = `<div style="margin-top:24px; padding-top:24px; border-top:1px solid ${W(8)};">`;
  // the design's verdict compares the two hardest steps (chances): omitted; what stands is where they meet
  h += `<div style="font-size:15px; font-weight:600; color:${C.text}; text-wrap:pretty;">${esc(meet.dead ? 'They cannot meet in this draw any more.' : meet.line + '.')}</div>`;
  const side = (P, i) => `<div style="grid-column:${i ? 3 : 1}; grid-row:1; display:flex; flex-direction:${i ? 'row-reverse' : 'row'}; align-items:center; gap:14px; min-width:0;">${avatar(P.key, nameOf(P.me), 56, i ? W(30) : B(60), 16, 1.5)}<div style="display:flex; flex-direction:column; align-items:${i ? 'flex-end' : 'flex-start'}; gap:6px; min-width:0;"><div style="display:flex; flex-direction:${i ? 'row-reverse' : 'row'}; align-items:center; flex-wrap:wrap; gap:4px 8px;"><span style="font-size:16px; font-weight:500; color:${C.soft};">${esc(nameOf(P.me))}</span></div><span title="Chance to win this match: no source yet" style="${MONO} font-size:34px; font-weight:700; line-height:1; color:${C.muted};">${DASH}</span></div></div>`;
  const k = meet.dead ? '' : meet.both ? (meet.metDone ? 'Met in' : 'Meet in') : 'Could meet in';
  h += `<div style="background:${C.card}; border:1px solid ${W(7)}; border-radius:12px; padding:26px 28px 24px; display:flex; flex-direction:column; gap:22px; min-width:0; margin-top:18px;">
    <div style="display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:center; gap:16px;">${side(A, 0)}${side(Bp, 1)}
      <div style="grid-column:2; grid-row:1; display:flex; flex-direction:column; align-items:center; gap:5px; padding:0 8px; text-align:center;"><span style="${CAPS} white-space:nowrap;">${k}</span><span style="font-size:15px; font-weight:800; white-space:nowrap;">${meet.dead ? 'Cannot meet' : 'The ' + esc(meet.rdL)}</span><span title="Chance both reach this round: no source yet" style="font-size:12px; color:${C.muted}; white-space:nowrap;">${meet.open && !meet.both ? DASH + ' both get there' : ''}</span></div></div>`;
  if (meet.open) {
    h += `<div><div style="position:relative; height:18px;"><span style="position:absolute; left:0; right:0; top:8px; height:2px; border-radius:1px; background:${W(10)};"></span><span style="position:absolute; left:50%; top:0; width:2px; height:18px; margin-left:-1px; border-radius:1px; background:${C.white};"></span></div>
      <div style="display:grid; grid-template-columns:1fr auto 1fr; margin-top:6px; font-size:11.5px; color:${C.muted};"><span>← ${esc(surname(nameOf(A.me)))}</span><span>50% · even</span><span style="text-align:right;">${esc(surname(nameOf(Bp.me)))} →</span></div></div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px;">${[A, Bp].map(() => `<div style="display:flex; align-items:baseline; justify-content:space-between; flex-wrap:wrap; gap:6px 12px; padding:14px 16px; border-radius:10px; background:${C.inset}; border:1px solid ${W(6)};"><span style="${CAPS}">Likely opening price</span><span title="No source yet" style="${MONO} font-size:15px; font-weight:600; white-space:pre;">${DASH}</span></div>`).join('')}</div>`;
  } else h += `<span style="font-size:12.5px; color:${C.muted}; text-align:center;">${meet.metDone && !meet.dead ? 'Already played' : 'No match possible'}</span>`;
  h += `</div></div>`;
  if (S.opp) h += oppReport(ev, M, F, S.opp.who === 'b' ? Bp : A, S.opp.r);
  h += `<div style="display:flex; align-items:baseline; justify-content:space-between; gap:8px 16px; flex-wrap:wrap; margin-top:30px; padding-top:26px; border-top:1px solid ${W(8)};"><span style="font-size:15px; font-weight:700;">Route, round by round</span><span style="font-size:12.5px; color:${C.muted};">Chance to win each match. Click a round for the likely opponents</span></div>`;
  [A, Bp].forEach((P, pi) => {
    const sub = P.champion ? 'Champion' : P.outAt >= 0 ? 'Out' : 'Title chance ' + DASH;
    const n = P.cells.length;
    h += `<div style="margin-top:${pi ? 12 : 16}px; background:${C.card}; border:1px solid ${W(7)}; border-radius:12px; padding:20px 18px 14px;">
      <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">${avatar(P.key, nameOf(P.me), 40, pi ? W(30) : B(60), 13, 1.5)}${hasProfile(P.key) ? `<span class="tt-draw-plink" onclick="${on(() => openProfile(P.key))}" title="Open his profile" style="cursor:pointer; font-size:15px; font-weight:800;">${esc(nameOf(P.me))}</span>` : `<span style="font-size:15px; font-weight:800; color:${C.text};">${esc(nameOf(P.me))}</span>`}<span style="font-size:12.5px; color:${C.muted};">${esc(sub)}</span></div>
      <div style="overflow-x:auto; margin-top:18px;"><div style="display:grid; grid-template-columns:repeat(${n},minmax(0,1fr)); min-width:${n * 116}px; padding-top:4px;">${P.cells.map((c, ri) => {
        const isMeet = ri === meet.r && !meet.dead, canOpen = c.state === 'open' && c.cands.length > 0;
        const dotBg = c.state === 'won' ? C.white : c.state === 'bye' ? C.soft : c.next ? C.blue : C.card;
        const dotBd = c.state === 'won' ? C.white : c.state === 'bye' ? C.soft : c.state === 'lost' ? C.muted : c.next ? C.blue : W(25);
        const pre = c.state === 'open' ? (c.known ? 'plays' : 'could play') : '';
        const opps = c.state === 'open' ? c.cands.map((o, i) => `<span style="font-size:12.5px; font-weight:${i ? 500 : 600}; line-height:16px; color:${i ? C.soft : C.text};">${esc(nameOf(o))}</span>`).join('')
          : `<span style="font-size:12.5px; font-weight:600; line-height:16px; color:${C.text};">${esc(c.opp)}</span>`;
        return `<div style="display:flex; flex-direction:column; min-width:0; opacity:${c.op};">
          <div style="position:relative; height:12px; margin:0 0 6px 4px;"><span style="position:absolute; left:0; right:0; top:5px; height:2px; background:${ri === n - 1 ? 'transparent' : W(12)};"></span><span style="position:absolute; left:0; top:0; width:12px; height:12px; box-sizing:border-box; border-radius:50%; background:${dotBg}; border:2px solid ${dotBd}; box-shadow:0 0 0 4px ${C.card};"></span></div>
          <div class="${canOpen ? 'tt-draw-step' : ''}"${canOpen ? ` onclick="${on(() => { S.opp = { who: pi ? 'b' : 'a', r: ri }; repaint(); })}" title="Open the opponent report"` : ''} style="cursor:${canOpen ? 'pointer' : 'default'}; flex:1; display:flex; flex-direction:column; gap:7px; min-width:0; margin-right:8px; padding:10px 10px 12px; border-radius:10px; border:1px solid ${canOpen ? W(14) : 'transparent'}; background:${canOpen ? C.inset : 'transparent'};">
            <span style="display:flex; justify-content:space-between; align-items:flex-start; gap:4px; min-height:14px; font-size:10px; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; white-space:nowrap; color:${isMeet ? C.text : C.muted};"><span>${esc(c.rd)}</span><span style="font-size:15px; font-weight:700; line-height:13px; color:${C.blue}; opacity:${canOpen ? 1 : 0};">›</span></span>
            <span style="font-size:11px; font-weight:700; color:${C.blue}; min-height:14px;">${isMeet ? (meet.metDone ? 'Met here' : meet.both ? 'Meet here' : 'Could meet here') : ''}</span>
            <span${c.state === 'open' ? ' title="Chance to win this match: no source yet"' : ''} style="${MONO} font-size:22px; font-weight:700; line-height:1.1; color:${c.figColor};">${esc(c.fig || '')}</span>
            <span style="font-size:11.5px; line-height:14px; min-height:14px; color:${C.muted}; white-space:pre; overflow:hidden; text-overflow:ellipsis;">${esc(c.score || '')}</span>
            <span style="font-size:11px; color:${C.muted}; min-height:13px; margin-top:4px;">${pre}</span>${opps}</div></div>`;
      }).join('')}</div></div></div>`;
  });
  return h;
}

// opponent report: the facts we hold (head to head, his record against the opponent's archetype, the opponent's last
// five); the win chance, the warning flag, "x% likely" and the opening price are dashes (founder ruling 3)
const OPP = {};   // "me|opp" → { h2h, arch, archK, last5 } (loaded once per pair)
const newsName = (key, fb) => { try { return typeof newsPlayerName === 'function' ? newsPlayerName(key, fb) : fb; } catch (e) { return fb; } };
function oppFacts(meKey, meName, o) {
  const ok = String(o.playerKey), id = meKey + '|' + ok;
  if (OPP[id]) return OPP[id];
  const f = OPP[id] = { h2h: null, arch: null, archK: 'Playing style', last5: null };
  if (typeof loadCareerHistory === 'function') {
    Promise.all([loadCareerHistory(meKey), loadCareerHistory(ok)]).then(([a, b]) => {
      try {
        const ansA = typeof careerHistoryAnswered !== 'function' || careerHistoryAnswered(meKey), ansB = typeof careerHistoryAnswered !== 'function' || careerHistoryAnswered(ok);
        if (ansA && ansB && window.H2HCore && typeof sfH2hSide === 'function') {
          const list = window.H2HCore.joinMeetings(sfH2hSide(meKey, meName), sfH2hSide(ok, nameOf(o)), a || [], b || [], typeof sfH2hNkCount === 'function' ? sfH2hNkCount() : undefined, []);
          const rec = window.H2HCore.record(list), lastM = window.H2HCore.played(list).slice().sort((x, y) => String(y.date).localeCompare(String(x.date)))[0];
          f.h2h = { a: rec.a, b: rec.b, n: rec.n, last: lastM ? (lastM.won ? 'won last' : 'lost last') : '' };
        }
        // the opponent's last five played matches, Form's population (walkovers, Laver Cup and exhibitions out)
        const NOT = typeof FH_FORM_NOT_ATP_RECORD !== 'undefined' ? FH_FORM_NOT_ATP_RECORD : null;
        if (ansB) {
          const rows = (b || []).filter(x => x && !x.walkover && !x.unconfirmed && !(NOT && NOT.test(String(x.tournament || ''))))
            .slice().sort((x, y) => String(y.date).localeCompare(String(x.date))).slice(0, 5).reverse();
          f.last5 = rows.map(x => (x.won ? 'W' : 'L'));
        }
      } catch (e) { /* stays a dash */ }
      repaint();
    });
  }
  if (typeof ensureStyleMeetings === 'function' && typeof ps2Record === 'function') {
    const m = { p1: meName, p2: newsName(ok, nameOf(o)), p1Key: meKey, p2Key: ok };
    ensureStyleMeetings(m).then(() => {
      try { const r = ps2Record(m, 0); if (r && r.oppLab) f.archK = r.oppLab; f.arch = r; } catch (e) { /* dash */ }
      repaint();
    }).catch(() => {});
  }
  return f;
}
function oppReport(ev, M, F, P, r) {
  const c = P.cells[r]; if (!c || !c.cands.length) return '';
  const nm = nameOf(P.me);
  const cards = c.cands.map(o => {
    const f = oppFacts(P.key, newsName(P.key, nm), o);
    const h2h = f.h2h ? `${f.h2h.a}${NDASH}${f.h2h.b}${f.h2h.last ? ' · ' + f.h2h.last : ''}` : DASH;
    const A = f.arch && f.arch.state === 'ready' ? f.arch : null;
    const ar = A ? (A.n === 0 ? DASH : A.n < 5 ? `${A.w}${NDASH}${A.l}` : `wins ${Math.round(100 * A.w / A.n)}%`) : DASH;
    const arT = A ? `${nm} v ${A.oppLab}: ${A.w}${NDASH}${A.l} in ${A.n} meetings (classified players, walkovers out)` : '';
    const l5 = f.last5 && f.last5.length ? f.last5.join(' ') : DASH;
    const facts = [['Opening price', DASH, 'No source yet'], ['Head to head', h2h, f.h2h ? `${f.h2h.n} meetings (ATP head-to-head population)` : ''], [f.archK, ar, arT], ['On this court', DASH, 'No source yet'], ['Last five', l5, f.last5 && f.last5.length ? `${nameOf(o)}: last ${f.last5.length} played matches, oldest first` : '']];
    const ok = String(o.playerKey);
    return `<div style="background:${C.inset}; border:1.25px solid ${W(6)}; border-radius:12px; padding:18px 18px 10px; display:flex; flex-direction:column; min-width:0;">
      <div style="display:flex; align-items:center; gap:10px;">${avatar(ok, nameOf(o), 36, W(14), 12, 1)}<div style="display:flex; flex-direction:column; gap:2px; min-width:0;"><span class="tt-draw-plink" onclick="${on(() => goH2H(P.key, ok, P.me.ioc, o.ioc))}" title="Open head to head" style="cursor:pointer; font-size:14.5px; font-weight:700;">${esc(nameOf(o))}</span><span style="font-size:12px; color:${C.muted};">${c.known ? 'Confirmed' : DASH + ' likely'}</span></div></div>
      <div style="display:flex; align-items:baseline; justify-content:space-between; gap:10px; margin-top:20px;"><span title="Chance to win this match: no source yet" style="${MONO} font-size:30px; font-weight:700; line-height:1; color:${C.white};">${DASH}</span><span title="No warning rule of ours yet" style="font-size:12px; font-weight:700; white-space:nowrap; color:${C.muted};">${DASH}</span></div>
      <div style="font-size:12px; color:${C.muted}; margin-top:6px;">to win this match</div>
      <div style="position:relative; height:42px; margin-top:14px;"><span style="position:absolute; left:0; right:0; top:30px; height:6px; border-radius:3px; background:${W(8)};"></span><span style="position:absolute; left:50%; top:26px; width:2px; height:14px; margin-left:-1px; border-radius:1px; background:${W(45)};"></span></div>
      <div style="display:grid; grid-template-columns:1fr auto 1fr; ${MONO} font-size:10.5px; color:${C.muted}; margin-top:6px;"><span>0</span><span>50</span><span style="text-align:right;">100</span></div>
      <div style="margin-top:12px;">${facts.map(([k, v, t]) => `<div style="display:flex; align-items:baseline; justify-content:space-between; gap:12px; padding:11px 0; border-top:1px solid ${W(7)};"><span style="font-size:12.5px; color:${C.muted};">${esc(k)}</span><span${t ? ` title="${esc(t)}"` : ''} style="font-size:13px; font-weight:600; text-align:right; white-space:pre; color:${C.white};">${esc(v)}</span></div>`).join('')}</div></div>`;
  }).join('');
  const close = on(() => { S.opp = null; repaint(); });
  return `<div class="tt-draw-ovl" onclick="${close}" style="position:fixed; inset:0; z-index:70; background:${C.scrim62}; display:flex; align-items:center; justify-content:center; padding:24px;">
    <div onclick="event.stopPropagation()" style="box-sizing:border-box; width:860px; max-width:100%; max-height:100%; overflow-y:auto; background:${C.card}; border:1px solid ${W(12)}; border-radius:14px; padding:26px 28px 28px; box-shadow:${SH_OPP};">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:16px;"><div style="display:flex; align-items:center; gap:12px; min-width:0;">${avatar(P.key, nm, 40, B(50), 13, 1)}<div style="display:flex; flex-direction:column; gap:3px; min-width:0;"><span style="font-size:16px; font-weight:800;">${esc(nm)}</span><span style="font-size:12.5px; color:${C.muted};">${esc(c.rd + (c.cands.length > 1 ? ' · who he could play' : ' · his opponent'))}</span></div></div>${closeBtn(close)}</div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(230px,1fr)); gap:12px; margin-top:22px;">${cards}</div></div></div>`;
}

// ── Outright chances ────────────────────────────────────────────────────────────────────────────────────────────────
function outrightHtml(ev, M, F) {
  const tab = S.outTab === 'q' ? 'q' : 't';
  const hint = S.outCmp ? 'Click a player in these lists to add him to the comparison' : (tab === 'q' ? 'The quarter winner is the player who reaches the semi-finals. ' : '') + 'Click a player to follow his route through the draw';
  let h = `<div style="border:1px solid ${W(8)}; border-radius:12px;"><div style="padding:12px 18px 18px;">
    <div style="display:flex; align-items:center; justify-content:space-between; gap:12px 16px; flex-wrap:wrap; margin-top:6px;"><div style="display:flex; gap:4px; padding:4px; border-radius:10px; background:${C.inset}; border:1px solid ${W(7)};">${[['t', 'To win the title'], ['q', 'To win his quarter']].map(([k, l]) => `<span onclick="${on(() => { S.outTab = k; repaint(); })}" style="cursor:pointer; display:inline-flex; align-items:center; height:30px; box-sizing:border-box; padding:0 14px; border-radius:7px; font-size:12.5px; font-weight:700; white-space:nowrap; color:${tab === k ? C.white : C.muted}; background:${tab === k ? W(9) : 'transparent'};">${l}</span>`).join('')}</div></div>
    <div style="font-size:12.5px; margin-top:14px; font-weight:${S.outCmp ? 700 : 400}; color:${S.outCmp ? C.blue : C.muted};">${esc(hint)}</div>`;
  const hl = k => (k && k === S.outA ? B(16) : k && k === S.outB ? W(9) : 'transparent');
  const pick = k => (k ? on(() => { if (S.outCmp) pickOut(k); else { Object.assign(S, { sel: k, b: null, cmp: false, view: 'draw', shut: null, opp: null }); repaint(); } }) : '');
  if (tab === 't') {
    // the leader is the most likely winner (a chance: dash) — or, once the final is played, the champion (a result)
    const ck = F.champ, cs = ck ? F.byKey.get(ck) : null;
    const lead = `<div class="${ck ? 'tt-draw-lead' : ''}" onclick="${pick(ck)}" style="cursor:${ck ? 'pointer' : 'default'}; flex:1 1 260px; max-width:340px; box-sizing:border-box; background:${C.inset}; border:1px solid ${ck && ck === S.outA ? C.blue : ck && ck === S.outB ? W(40) : W(7)}; border-radius:12px; padding:20px 22px; display:flex; flex-direction:column; gap:14px; min-width:0;">
      <span style="${CAPS}">${ck ? 'Champion' : 'Most likely winner'}</span>
      <div style="display:flex; align-items:center; gap:14px; min-width:0;">${cs ? avatar(ck, nameOf(cs), 56, W(40), 17, 1.5) : `<span style="flex:none; width:56px; height:56px; box-sizing:border-box; border-radius:50%; background:${C.avatar}; border:1.5px solid ${W(40)};"></span>`}<div style="display:flex; flex-direction:column; gap:5px; min-width:0;"><span style="font-size:18px; font-weight:800; color:${C.white}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${cs ? esc(nameOf(cs)) : DASH}</span></div></div>
      <span${ck ? '' : ' title="Title chance: no source yet"'} style="${MONO} font-size:44px; font-weight:700; line-height:1; color:${C.white};">${ck ? '100%' : DASH}</span>
      <div style="display:flex; flex-direction:column; gap:8px; padding-top:14px; border-top:1px solid ${W(10)}; font-size:13px;"><div style="display:flex; justify-content:space-between; gap:12px;"><span style="color:${C.muted};">Fair odds</span><span title="No source yet" style="${MONO} color:${C.text}; white-space:pre;">${DASH}</span></div><div style="display:flex; justify-content:space-between; gap:12px;"><span style="color:${C.muted};">Ahead of the next</span><span title="No source yet" style="${MONO} color:${C.text};">${DASH}</span></div></div></div>`;
    const rowD = () => `<div style="border-top:1px solid ${W(6)};"><div style="display:flex; align-items:center; gap:12px; padding:9px 8px; margin:2px -8px; border-radius:8px;"><span style="flex:none; width:28px; height:28px; box-sizing:border-box; border-radius:50%; background:${C.avatar}; border:1px solid ${W(18)};"></span><span style="flex:1; min-width:0; display:flex; align-items:baseline; gap:7px;"><span style="min-width:0; font-size:13.5px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${DASH}</span></span><span style="width:48px; text-align:right; ${MONO} font-size:13px; font-weight:700; color:${C.white};">${DASH}</span><span style="width:104px; text-align:right; ${MONO} font-size:12px; color:${C.soft}; white-space:pre;">${DASH}</span></div></div>`;
    const grp = (name, n) => `<div style="display:flex; align-items:baseline; gap:12px; padding:8px 0; ${CAPS}"><span style="flex:1; color:${C.text};">${name}</span><span style="width:48px; text-align:right;">Chance</span><span style="width:104px; text-align:right; white-space:nowrap;">Fair odds</span></div>${Array.from({ length: n }, rowD).join('')}`;
    h += `<div style="display:flex; flex-wrap:wrap; gap:12px; margin-top:14px;">${lead}<div title="Title chances: no source yet" style="flex:2 1 360px; background:${C.inset}; border:1px solid ${W(7)}; border-radius:12px; padding:14px 18px 8px; min-width:0;">${grp('Also favoured', 2)}${grp('Three underdogs', 3)}</div></div>`;
  } else {
    // quarters from the draw's own positions (founder 2026-11-15): pos → ceil(pos / (size / 4)); the quarter winner
    // (won his quarter-final) first, then the players still in it by seed and position — never a chance order
    const size = (ev.draw.main && ev.draw.main.size) || 32, per = size / 4;
    const qi = M ? M.rounds.findIndex(r => r.name === 'QF') : -1;
    const qWin = q => { if (qi < 0) return null; const c = M.rounds[qi].cells[q]; return c && c.match ? c.match.winnerKey : null; };
    const cards = [0, 1, 2, 3].map(q => {
      const w = qWin(q);
      const inQ = F.slots.filter(s => Math.ceil(s.pos / per) === q + 1);
      const list = (w && F.byKey.get(w) ? [F.byKey.get(w)] : []).concat(w ? [] : inQ.filter(s => F.out[String(s.playerKey)] == null)
        .sort((x, y) => (x.seed == null ? 99 : x.seed) - (y.seed == null ? 99 : y.seed) || x.pos - y.pos)).slice(0, 4);
      const rows = list.map((s, j) => { const k = String(s.playerKey);
        return `<div class="tt-draw-orow" onclick="${pick(k)}" title="${esc(nameOf(s))}" style="cursor:pointer; display:grid; grid-template-columns:minmax(0,1fr) 38px 80px; gap:8px; align-items:center; padding:9px 6px; margin:2px -6px; border-radius:8px; background:${hl(k)};"><div style="display:flex; align-items:center; gap:8px; min-width:0;">${avatar(k, nameOf(s), 26, j ? W(18) : W(40), 9.5, 1.5)}<span style="min-width:0; font-size:13px; font-weight:${j ? 600 : 800}; color:${j ? C.text : C.white}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(nameOf(s))}</span></div><span${k === w ? '' : ' title="Chance: no source yet"'} style="text-align:right; ${MONO} font-size:12.5px; font-weight:700; color:${C.white};">${k === w ? 'Won' : DASH}</span><span title="No source yet" style="text-align:right; ${MONO} font-size:11.5px; color:${C.soft}; white-space:pre;">${DASH}</span></div>`; }).join('');
      return `<div style="background:${C.inset}; border:1px solid ${W(7)}; border-radius:12px; padding:16px 12px 8px; min-width:0;"><div style="display:grid; grid-template-columns:minmax(0,1fr) 38px 80px; gap:8px; align-items:baseline; padding-bottom:10px; border-bottom:1px solid ${W(10)}; font-size:10.5px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:${C.muted}; white-space:nowrap;"><span style="color:${C.text};">Quarter ${q + 1}</span><span style="display:flex; justify-content:flex-end;">Chance</span><span style="text-align:right;">Fair odds</span></div>${rows}</div>`;
    }).join('');
    h += `<div style="display:grid; grid-template-columns:repeat(4,minmax(256px,1fr)); gap:10px; margin-top:14px; overflow-x:auto;">${cards}</div>`;
  }
  return h + `</div></div>`;
}

// ── Statistics view + its two boxes ─────────────────────────────────────────────────────────────────────────────────
function statsHtml(ev, M, st) {
  const tile = (t, gi, i) => {
    const isOpen = gi === 0 ? S.ed === i : S.stat === t.key;
    const click = gi === 0 ? !!st.hev : st.live && !!t.key;
    const onc = click ? on(() => { if (gi === 0) S.ed = S.ed === i ? null : i; else S.stat = S.stat === t.key ? null : t.key; repaint(); }) : '';
    const cols = t.cols.map(c => `<div title="${esc(c.y + (c.now && st.live ? ' so far' : '') + ' · ' + st.fm(t, c.v))}" style="height:${c.h}; border-radius:3px 3px 0 0; background:${c.v == null ? 'transparent' : c.now ? (isOpen ? C.blue : C.text) : C.past};"></div>`).join('');
    const yrs = t.cols.map(c => `<span style="display:flex; justify-content:center; white-space:nowrap; color:${c.now ? C.text : C.muted}; font-weight:${c.now ? 700 : 400};">${String(c.y).slice(2)}</span>`).join('');
    return `<div class="tt-draw-tile" onclick="${onc}" style="position:relative; cursor:${click ? 'pointer' : 'default'}; background:${C.inset}; border:1px solid ${isOpen ? B(60) : W(6)}; border-radius:12px; padding:14px 14px 12px; display:flex; flex-direction:column; gap:10px; min-width:0;">
      ${click ? `<span class="tt-draw-tilehov" style="position:absolute; inset:0; border-radius:12px;"></span>` : ''}
      <span style="display:flex; justify-content:space-between; gap:8px; font-size:12.5px; font-weight:600; line-height:16px; min-height:32px; color:${C.soft};"><span style="text-wrap:balance;">${esc(t.label)}</span><span style="flex:none; color:${C.blue}; font-weight:700;">${click ? '›' : ''}</span></span>
      <div style="display:flex; align-items:baseline; justify-content:space-between; gap:5px 10px; flex-wrap:wrap;"><span title="${esc(t.vTitle)}" style="${MONO} font-size:21px; font-weight:700; line-height:1; color:${t.figColor};">${esc(t.fig)}</span>
        <span style="flex:0 0 100%; display:flex; flex-direction:column; gap:5px; margin-top:5px; font-size:11.5px; color:${C.muted};"><span title="Against the tour average${t.tourTitle ? ' · ' + esc(t.tourTitle) : ''}" style="display:flex; align-items:baseline; justify-content:space-between; gap:6px; white-space:nowrap;"><span>vs tour</span><span style="${MONO} color:${C.text};">${t.gapN}</span></span><span title="Against the past edition" style="display:flex; align-items:baseline; justify-content:space-between; gap:6px; white-space:nowrap;"><span>${t.gapLL}</span><span style="${MONO} color:${C.text};">${t.gapL}</span></span><span title="Against the average of the five editions before" style="display:flex; align-items:baseline; justify-content:space-between; gap:6px; white-space:nowrap;"><span>vs past five</span><span style="${MONO} color:${C.text};">${t.gapP}</span></span></span></div>
      <div style="position:relative; height:56px; margin-top:4px;"><div style="position:absolute; inset:0; display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:5px; align-items:end;">${cols}</div>${t.tourB ? `<div title="${esc(t.tourTitle)}" style="position:absolute; left:-4px; right:-4px; bottom:${t.tourB}; border-top:1.5px dashed ${W(75)};"></div>` : ''}</div>
      <div style="display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:5px; ${MONO} font-size:10px;">${yrs}</div></div>`;
  };
  const g = (name, note, mt, tiles, gi) => `<div style="display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin-top:${mt};"><span style="font-size:15px; font-weight:700; color:${C.text};">${name}</span><span style="font-size:12.5px; color:${C.muted};">${esc(note)}</span></div>
    <div style="display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:10px; margin-top:12px;">${tiles.map((t, i) => tile(t, gi, i)).join('')}</div>`;
  const n1 = [st.n1, st.hev ? 'click a box for its past editions' : ''].filter(Boolean).join(' · ');
  const n2 = [st.n2, st.live ? 'click a box for the matches behind it' : ''].filter(Boolean).join(' · ');
  let h = `<div style="display:block; margin-top:22px; border:1px solid ${W(8)}; border-radius:12px;"><div style="padding:14px 18px 18px;">`
    + g('Speed', n1, '4px', st.speed, 0)
    + g('Favourites and underdogs', n2, '22px', st.mkt, 1)
    + `<div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px 18px; padding-top:14px; font-size:11.5px; color:${C.muted};"><span style="display:flex; align-items:center; gap:7px;"><span style="width:10px; height:10px; border-radius:2px; background:${C.text};"></span>This edition</span><span style="display:flex; align-items:center; gap:7px;"><span style="width:10px; height:10px; border-radius:2px; background:${C.past};"></span>Past editions</span><span style="display:flex; align-items:center; gap:7px;"><span style="width:18px; border-top:1.5px dashed ${W(75)};"></span>Tour average</span></div>`;
  // "All statistics ›" is dropped (founder 2026-11-15: it pointed at the removed Stats tab)
  h += `</div></div>`;
  if (S.ed != null && st.speed[S.ed]) h += edBox(st, st.speed[S.ed]);
  if (S.stat && st.live) h += matchBox(ev, M, st);
  return h;
}
const sheet = (title, sub, onClose, body) => `<div class="tt-draw-ovl" onclick="${onClose}" style="position:fixed; inset:0; z-index:70; background:${C.scrim66}; display:flex; align-items:center; justify-content:center; padding:24px;">
  <div onclick="event.stopPropagation()" style="width:860px; max-width:100%; max-height:86vh; overflow:auto; box-sizing:border-box; background:${C.card}; border:1px solid ${W(12)}; border-radius:14px; box-shadow:${SH_OVERLAY}; padding:20px 22px 22px;">
    <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;"><div style="display:flex; flex-direction:column; gap:5px; min-width:0;"><span style="font-size:16px; font-weight:800;">${esc(title)}</span><span style="font-size:12.5px; color:${C.muted};">${esc(sub)}</span></div>${closeBtn(onClose)}</div>${body}</div></div>`;
const tiles4 = list => `<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin-top:16px;">${list.map(t => `<div style="background:${C.inset}; border:1.25px solid ${W(6)}; border-radius:12px; padding:14px 12px; display:flex; flex-direction:column; align-items:center; gap:8px; text-align:center; min-width:0;"><span style="${CAPS}">${esc(t.label)}</span><span${t.title ? ` title="${esc(t.title)}"` : ''} style="${MONO} font-size:21px; font-weight:700; line-height:1; color:${t.color || C.white};">${esc(t.fig)}</span><span style="font-size:12px; color:${C.soft}; text-wrap:balance;">${esc(t.sub)}</span></div>`).join('')}</div>`;
function edBox(st, t) {
  const fm = x => st.fm(t, x);
  const nowL = st.cy + (st.live ? ' so far' : '');
  const past = t.cols.slice(0, 5).map(c => ({ y: c.y, v: t.series[c.y] != null ? t.series[c.y] : null })).reverse();
  const known = past.filter(p => p.v != null).concat(t.v != null ? [{ y: nowL, v: t.v }] : []);
  const hi = known.slice().sort((a, b) => b.v - a.v)[0], lo = known.slice().sort((a, b) => a.v - b.v)[0];
  const tiles = [{ label: 'This edition', fig: fm(t.v), sub: nowL, title: t.vTitle },
    { label: 'Tour average', fig: fm(t.tour), sub: 'this edition ' + (t.v != null && t.tour != null ? sg(t.v - t.tour) : DASH), title: t.tourTitle },
    { label: 'Past five editions', fig: fm(t.avg5), sub: 'average · this edition ' + (t.v != null && t.avg5 != null ? sg(t.v - t.avg5) : DASH), title: t.avg5 == null ? 'Needs five past editions on file' : '' },
    { label: 'Highest', fig: known.length >= 2 ? fm(hi.v) : DASH, sub: known.length >= 2 ? `in ${hi.y} · lowest ${fm(lo.v)} in ${lo.y}` : 'needs past editions on file' }];
  const rowsAll = [{ y: nowL, v: t.v, now: true }].concat(past);
  const sp = (Math.max.apply(null, rowsAll.filter(r => r.v != null && t.v != null).map(r => Math.abs(r.v - t.v)).concat([0])) * 1.1) || 1;
  const GRID = 'grid-template-columns:120px 84px 84px 120px minmax(120px,1fr); gap:0 20px;';
  const rows = rowsAll.map(r => { const d = r.v != null && t.v != null ? r.v - t.v : null, bw = d == null ? 0 : Math.abs(d) / sp * 50;
    return `<div style="display:grid; ${GRID} align-items:center; padding:11px 0; border-bottom:1px solid ${W(5)};">
      <span style="font-size:13.5px; font-weight:${r.now ? 700 : 500}; color:${r.now ? C.white : C.soft}; white-space:nowrap;">${esc(r.y)}</span>
      <span style="text-align:right; ${MONO} font-size:14.5px; font-weight:700; color:${r.now ? C.white : C.soft};">${fm(r.v)}</span>
      <span style="text-align:right; ${MONO} font-size:13px; color:${C.soft};">${r.v != null && t.tour != null ? sg(r.v - t.tour) : DASH}</span>
      <span style="text-align:right; ${MONO} font-size:13px; color:${C.muted};">${r.now || d == null ? DASH : sg(d)}</span>
      <div style="position:relative; height:12px;"><div style="position:absolute; left:0; right:0; top:4px; height:4px; border-radius:2px; background:${W(5)};"></div>${d != null && !r.now ? `<div style="position:absolute; left:${d >= 0 ? 50 : 50 - bw}%; top:3px; height:6px; border-radius:3px; width:${bw}%; background:${C.past};"></div>` : ''}<div title="This edition" style="position:absolute; top:0; left:50%; width:2px; height:12px; margin-left:-1px; border-radius:1px; background:${C.white};"></div></div></div>`; }).join('');
  const body = tiles4(tiles) + `<div style="overflow-x:auto; margin-top:18px;"><div style="min-width:560px;"><div style="display:grid; ${GRID} padding-bottom:10px; border-bottom:1px solid ${W(12)}; ${CAPS}"><span>Edition</span><span style="text-align:right;">Figure</span><span style="text-align:right;">Vs tour</span><span style="text-align:right;">Vs this edition</span><span style="display:flex; justify-content:space-between;"><span>Lower</span><span>Higher</span></span></div>${rows}</div></div>`;
  return sheet(t.label, 'This edition and the five before', on(() => { S.ed = null; repaint(); }), body);
}
// the matches behind a Favourites and underdogs tile: this edition's priced Database rows (names from
// database-yield-players.json); set scores from the draw's own results, joined by both surnames, exactly one match
function matchBox(ev, M, st) {
  const t = st.mkt.find(x => x.key === S.stat); if (!t) return '';
  const NM = file('database-yield-players.json'), D = file('database-yield.json');
  const close = on(() => { S.stat = null; repaint(); });
  if (NM === undefined || D === undefined || st.dbRows === undefined) return sheet(t.label, 'Loading the matches…', close, '');
  const RN = (D && D.meta && D.meta.rounds) || [];
  const plain = s => lc(s).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  const tdSur = n => plain(String(n).replace(/\s+[A-Z][A-Za-z.\-]*\.?$/, ''));                 // "Ymer E." → "ymer"
  const drSur = n => plain(String(n).replace(/^(?:[A-Z][a-z]?\.(?:-[A-Z]\.)?\s+)+/, ''));       // "J. M. Cerundolo" → "cerundolo"
  const draws = [];
  M.rounds.forEach(R => R.cells.forEach(c => { if (c.match && c.sides[0] && c.sides[1]) draws.push({ c, a: drSur(nameOf(c.sides[0])), b: drSur(nameOf(c.sides[1])) }); }));
  const cy = st.cy;
  const L = (st.dbRows || []).filter(x => Math.floor(x.r[0] / 1e4) === cy).map(x => {
    const nm = NM ? (x.ret ? NM.retNames : NM.names)[x.i] : null; if (!nm) return null;
    const w = nm[0], l = nm[1], ws = tdSur(w), ls = tdSur(l), fw = !!x.r[7];
    const hit = draws.filter(d => (d.a === ws && d.b === ls) || (d.a === ls && d.b === ws));
    const rl = RN[x.r[3]], rd = rl === 'Quarterfinals' ? 'QF' : rl === 'Semifinals' ? 'SF' : rl === 'The Final' ? 'F' : ROUND_IX[rl] != null && M.rounds[ROUND_IX[rl]] ? M.rounds[ROUND_IX[rl]].name : DASH;
    let score = null, three = null, down = null;
    if (hit.length === 1) { const c = hit[0].c, wi = c.sides.findIndex(s => keyOf(s) === c.match.winnerKey); const sc = (c.match.score || []).map(p => (wi ? [p[1], p[0]] : p));
      score = sc.map(p => p[0] + '-' + p[1]).join('  '); three = sc.length === bestOf(ev); down = sc.length ? sc[0][0] < sc[0][1] : null; }
    return { rd, fav: fw ? w : l, dog: fw ? l : w, favP: x.r[5], dogP: x.r[6], favWon: fw, bet: x.bet, win: x.win, score, three, down, fr: x.r[5] - 1, dr: x.r[6] - 1 };
  }).filter(Boolean);
  const wins = L.filter(x => x.win), N = wins.length, ups = wins.filter(x => !x.favWon), bets = L.filter(x => x.bet);
  const big = ups.slice().sort((a, b) => b.dogP - a.dogP)[0], shortBeat = ups.slice().sort((a, b) => a.favP - b.favP)[0];
  const fy = bets.reduce((a, x) => a + (x.favWon ? x.fr : -1), 0), dy = bets.reduce((a, x) => a + (x.favWon ? -1 : x.dr), 0);
  const u = v => (v >= 0 ? '+' : MINUS) + Math.abs(v).toFixed(2), sc2 = v => (v >= 0 ? C.green : C.red), of = (a, b) => a + ' of ' + b;
  const decs = wins.filter(x => x.three === true), downs = wins.filter(x => x.down === true), nf = a => a.filter(x => x.favWon).length;
  const gapT = tt => ({ label: 'Against the tour', fig: tt.gapN === DASH ? DASH : tt.gapN + ' pts', sub: tt.tour != null ? 'tour ' + st.fm(tt, tt.tour) : 'no tour figure on file', title: tt.tourTitle });
  const none = lab => ({ label: lab, fig: DASH, sub: 'no upset yet' });
  const TL = {
    fav: [{ label: 'Favourites won', fig: of(N - ups.length, N), sub: t.fig + ' of matches' }, { label: 'Upsets', fig: String(ups.length), sub: 'underdog winners' }, big ? { label: 'Biggest upset', fig: big.dogP.toFixed(2), sub: big.dog + ' beat ' + big.fav } : none('Biggest upset'), gapT(st.mkt[0])],
    favY: [{ label: 'Yield', fig: t.fig, sub: t.tour != null ? 'tour ' + st.fm(t, t.tour) : '', color: t.figColor }, { label: 'Profit', fig: bets.length ? u(fy) : DASH, sub: 'units over ' + bets.length + ' bets', color: bets.length ? sc2(fy) : C.white }, { label: 'Favourites won', fig: of(N - ups.length, N), sub: st.mkt[0].fig + ' of matches' }, shortBeat ? { label: 'Shortest price beaten', fig: shortBeat.favP.toFixed(2), sub: shortBeat.fav + ' lost to ' + shortBeat.dog } : none('Shortest price beaten')],
    dogY: [{ label: 'Yield', fig: t.fig, sub: t.tour != null ? 'tour ' + st.fm(t, t.tour) : '', color: t.figColor }, { label: 'Profit', fig: bets.length ? u(dy) : DASH, sub: 'units over ' + bets.length + ' bets', color: bets.length ? sc2(dy) : C.white }, { label: 'Underdogs won', fig: of(ups.length, N), sub: 'upsets' }, big ? { label: 'Best winner', fig: '+' + big.dr.toFixed(2), sub: big.dog + ' at ' + big.dogP.toFixed(2), color: C.green } : none('Best winner')],
    dec: [{ label: 'Went to a decider', fig: of(st.sets.dec, st.sets.n), sub: t.fig + ' of matches' }, { label: 'Favourite took it', fig: of(nf(decs), decs.length), sub: 'of the priced deciders' }, { label: 'Underdog took it', fig: of(decs.length - nf(decs), decs.length), sub: 'of the priced deciders' }, gapT(t)],
    cb: [{ label: 'Won from a set down', fig: of(st.sets.cb, st.sets.n), sub: t.fig + ' of matches' }, { label: 'Favourites', fig: of(nf(downs), downs.length), sub: 'of the priced comebacks' }, { label: 'Underdogs', fig: of(downs.length - nf(downs), downs.length), sub: 'of the priced comebacks' }, gapT(t)],
  };
  const yl = S.stat === 'favY' || S.stat === 'dogY';
  const rowsL = S.stat === 'dec' ? decs : S.stat === 'cb' ? downs : yl ? bets : wins;
  const sub = S.stat === 'fav' ? `${N - ups.length} of ${N} matches` : S.stat === 'favY' ? `1 unit on every favourite · ${u(fy)} units over ${bets.length} matches` : S.stat === 'dogY' ? `1 unit on every underdog · ${u(dy)} units over ${bets.length} matches` : `${rowsL.length} of ${N} matches`;
  const GRID = 'grid-template-columns:44px minmax(0,1fr) minmax(0,1fr) 96px 108px; gap:0 14px;';
  const head = `<div style="display:grid; ${GRID} padding:0 0 8px; border-bottom:1px solid ${W(12)};">${['Round', 'Favourite', 'Underdog', 'Score'].map(x => `<span style="${CAPS}">${x}</span>`).join('')}<span style="${CAPS} text-align:right;">${yl ? '1 unit staked' : 'Result'}</span></div>`;
  const rows = rowsL.map(x => { const r = S.stat === 'favY' ? (x.favWon ? x.fr : -1) : (x.favWon ? -1 : x.dr);
    return `<div style="display:grid; ${GRID} align-items:baseline; padding:8px 0; border-bottom:1px solid ${W(5)}; font-size:13px;">
      <span style="${MONO} font-size:11px; color:${C.muted};">${esc(x.rd)}</span>
      <span style="display:flex; align-items:baseline; gap:8px; min-width:0;"><span style="min-width:0; font-weight:${x.favWon ? 700 : 500}; color:${x.favWon ? C.white : C.muted}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(x.fav)}</span><span style="flex:none; ${MONO} font-size:11.5px; color:${C.muted};">${x.favP.toFixed(2)}</span></span>
      <span style="display:flex; align-items:baseline; gap:8px; min-width:0;"><span style="min-width:0; font-weight:${x.favWon ? 500 : 700}; color:${x.favWon ? C.muted : C.white}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${esc(x.dog)}</span><span style="flex:none; ${MONO} font-size:11.5px; color:${C.muted};">${x.dogP.toFixed(2)}</span></span>
      <span style="${MONO} font-size:12px; color:${C.soft}; white-space:pre;">${esc(x.score || DASH)}</span>
      <span style="text-align:right; font-weight:700; font-size:12.5px; color:${yl ? sc2(r) : x.favWon ? C.soft : C.white}; white-space:nowrap;">${yl ? u(r) : x.favWon ? 'Favourite won' : 'Upset'}</span></div>`; }).join('');
  const body = tiles4(TL[S.stat]) + `<div style="overflow-x:auto; margin-top:18px;"><div style="min-width:560px;">${head}${rows}</div></div>`;
  return sheet(t.label, sub, close, body);
}

// ── CSS: the hover states inline styles cannot carry; every selector under the Tournaments page ─────────────────────
function injectCss() {
  if (typeof document === 'undefined' || document.getElementById('tt-draw-css')) return;
  const s = document.createElement('style'); s.id = 'tt-draw-css';
  s.textContent = `
/* the shared .tourx-shell is the design's card (the card tone, a 1.25px white-6% edge, r12 — tournaments-overview.js); the old
   renderer's #tourxDraw padding is cancelled while this module renders, so the pane is the design's 22/24/28 box */
.tabpage[data-page="tournaments"] #tourxDraw{ padding:0; }
${SCOPE}{ font-family:'Hanken Grotesk',sans-serif; font-size:16px; line-height:normal; color:${C.text}; -webkit-font-smoothing:antialiased; }
${SCOPE} *{ box-sizing:border-box; }
${SCOPE} .tt-draw-pane{ padding:22px 24px 28px; }
${SCOPE} .tt-draw-seg{ transition:background .14s ease, color .14s ease, border-color .14s ease; }
${SCOPE} .tt-draw-hi8:hover{ box-shadow:inset 0 0 0 999px ${W(8)}; }
${SCOPE} .tt-draw-hi4:hover{ box-shadow:inset 0 0 0 999px ${W(4)}; }
${SCOPE} .tt-draw-hw8:hover{ background:${W(8)}; }
${SCOPE} .tt-draw-bbtn:hover{ background:${C.blueBtnHov} !important; }
${SCOPE} .tt-draw-vp:hover{ border-color:${W(40)} !important; }
${SCOPE} .tt-draw-prow:hover{ box-shadow:inset 0 0 0 999px ${W(4.5)}; }
${SCOPE} .tt-draw-sug:hover{ border-color:${C.blue} !important; color:${C.blueFav} !important; }
${SCOPE} .tt-draw-chg{ color:${C.muted}; } ${SCOPE} .tt-draw-chg:hover{ color:${C.text}; }
${SCOPE} .tt-draw-plink{ color:${C.text}; } ${SCOPE} .tt-draw-plink:hover{ color:${C.blueFav}; text-decoration:underline; text-underline-offset:3px; }
${SCOPE} .tt-draw-step:hover{ border-color:${C.blue} !important; box-shadow:inset 0 0 0 999px ${B(7)}; }
${SCOPE} .tt-draw-tilehov:hover{ background:${W(3.5)}; }
${SCOPE} .tt-draw-lead:hover{ border-color:${W(22)} !important; }
${SCOPE} .tt-draw-orow:hover{ background:${W(5)} !important; }
${SCOPE} input::placeholder{ color:${C.muted}; }
${SCOPE} ::-webkit-scrollbar{ width:10px; height:10px; } ${SCOPE} ::-webkit-scrollbar-thumb{ background:${W(8)}; border-radius:6px; }
${SCOPE} .tt-draw-av .sf-ph.sf-on{ background:${C.avatar}; }
`;
  document.head.appendChild(s);
}

const TTDraw = {
  render(el) { render(el); },
  _h(i, ev) { const f = H[i]; if (typeof f !== 'function') return; if (ev && ev.type === 'click' && ev.stopPropagation) ev.stopPropagation(); f(ev); },
  // test hooks (Node): the pure parts and the state
  _test: { S, events, modelOf, facts, pathOf, statsModel, seasonFigs, dbRowsOf, setFacts, stageOf, render, FILES, reset, boardPrice },
};
if (typeof module !== 'undefined' && module.exports) module.exports = TTDraw;
if (typeof window !== 'undefined') window.TTDraw = TTDraw;
}());
