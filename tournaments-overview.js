// Tournaments tab, Overview (TTOverview). Rebuilt to the 2026-11-20 handoff (design_handoff_tournaments_2026-11-20:
// README §1 Overview, the Compare all box, the Backing favourites / underdogs box; CHANGELOG "OVERVIEW + ITS BOXES +
// ENTRY LIST LOCKED" and the entries below it). Spec = design/Tournaments.dc.html inline styles; colours through the
// --tt-* tokens only. Also owns the page shell styles (header card, top tabs, content shell), page-scoped.
//
// DATA (every figure real, else a grey em dash with its reason on hover):
//   rail / title         TOURNAMENT_CATALOG + COURT_CONDITIONS (tourxOverviewEvents), "This week" = tourxActiveWeekNames()
//   logo tile            tournament-logos/index.json (the Database's map); no file = the three-letter mono code
//   court speed          COURT_CONDITIONS.abstractSpeed (Tennis Abstract, TT_SPEED_SOURCE 'ta'; 'own' = dashes)
//   speed by year        court-speed-history.json ta[event][year], 2020–2026 (only years with a reading are plotted)
//   Court Pace Index     court-speed-history.json cpi[event][year] (courtspeed.com), Masters 1000 only; Canadian Open =
//                        Montreal + Toronto merged by year (they never share one)
//   Altitude             COURT_CONDITIONS.altitude
//   1st serve points won event-hold.json fsWon / fsPlayed (our box scores, main draw, every surface), else how-it-plays.json
//   Service hold         event-hold.json held / games
//   Betting market       tournament-market.json (all years); a From / To window recomputes every figure from
//                        database-yield.json rows through settlement.js (build-tournament-market.js aggRows)
//   What players say     tournament-quotes.json through tourxQuotesFor + tourxQuoteClean, a year switch per edition
(function (root) {
'use strict';

// ONE switch (founder 2026-11-16, replacing ruling 4's dashes): 'ta' = the Tennis Abstract figures we hold; 'own' = dashes.
const TT_SPEED_SOURCE = (root && root.TT_SPEED_SOURCE) || 'ta';
const YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026];   // the design's From / To options
const MIN_MATCHES = 30;                                        // tournament-market.json minMatches (build-tournament-market.js)
const DASH = '—', MINUS = '−';
const H = "'Hanken Grotesk',sans-serif", M = "'IBM Plex Mono',monospace";
const W = n => `color-mix(in srgb, var(--tt-white) ${n}%, transparent)`;
const B = n => `color-mix(in srgb, var(--tt-blue) ${n}%, transparent)`;
const S = '.tabpage[data-page="tournaments"]';

// ---------------------------------------------------------------- state
const st = { el: null, yF: 2020, yT: 2026, quoteYear: 'all', hip: undefined, hipP: null, db: undefined, dbP: null, _model: null,
  csh: undefined, cshP: null, logos: undefined, logosP: null, ovMetric: 'speed', spMetric: 'speed', spF: 2020, spT: 2026 };

// ---------------------------------------------------------------- tiny helpers
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const jsq = s => esc(String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
const ord = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const median = a => { if (!a.length) return null; const s = a.slice().sort((p, q) => p - q); return (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2; };
const signed = (v, dp) => { const r = Number(Math.abs(v).toFixed(dp)); return (r === 0 ? '' : v > 0 ? '+' : MINUS) + r.toFixed(dp); };
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const fmtN = n => Number(n).toLocaleString('en-US');
const chev = (c = 'currentColor') => '<svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="' + c + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 2 L6.5 5 L3.5 8"></path></svg>';

// Globals of the dashboard's main script (classic-script lexical bindings are not on window): read through try / typeof.
function catalog(){ try { return TOURNAMENT_CATALOG; } catch (e) { return []; } }
function conds(){ try { return COURT_CONDITIONS; } catch (e) { return {}; } }
function tstate(){ try { return tourxState; } catch (e) { return st._fallback || (st._fallback = { section: 'overview', tsSel: 'Wimbledon', tsQ: '' }); } }
function marketData(){ try { return tourxMarketData; } catch (e) { return null; } }
function marketFailed(){ try { return !!tourxMarketFailed; } catch (e) { return false; } }
function holdData(){ try { return _trHoldData; } catch (e) { return undefined; } }

// ---------------------------------------------------------------- the events (rail population)
// tourxOverviewEvents() = the 64 court-conditions events + the listUnrated catalog rows, in CATALOG order (the design's
// rail order — never sorted by speed).
function events(){
  const cat = catalog();
  const list = typeof tourxOverviewEvents === 'function' ? tourxOverviewEvents() : cat;
  const ix = new Map(cat.map((t, i) => [t.name, i]));
  return list.slice().sort((a, b) => (ix.has(a.name) ? ix.get(a.name) : 1e9) - (ix.has(b.name) ? ix.get(b.name) : 1e9));
}
// The headline speed = the LATEST season reading of court-speed-history.json (the trend card's last point), so the figure,
// its rank, the rail and Compare all never disagree with the trend (Paris: 1.44 in 2026, not the stored 2025 0.97).
// While the history loads: no figure (a dash); if it failed: the stored COURT_CONDITIONS reading.
function speedLatest(name){
  if (TT_SPEED_SOURCE !== 'ta' || st.csh === undefined) return null;
  if (st.csh) {
    const s = st.csh.ta[name] || {}, ys = Object.keys(s).filter(y => s[y] != null).sort();
    if (ys.length) return { v: s[ys[ys.length - 1]], year: +ys[ys.length - 1] };
  }
  const c = conds()[name];
  return c && c.abstractSpeed != null ? { v: c.abstractSpeed, year: c.abstractSpeedYear || null } : null;
}
function speedOf(name){ const r = speedLatest(name); return r ? r.v : null; }
// court-speed-history.json (tools/build-court-speed-history.mjs): ta[event][year] + cpi[event][year]. Lazy; a failed load
// = null = every per-year figure a dash, never a guess.
function loadCsh(){
  if (st.csh !== undefined || st.cshP || typeof fetch !== 'function') return;
  st.cshP = fetch('./court-speed-history.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null)
    .then(d => { st.csh = d && d.ta ? d : null; st.cshP = null; rerender(); });
}
function speedYearOf(name, y){
  if (TT_SPEED_SOURCE !== 'ta' || !st.csh) return null;
  const v = (st.csh.ta[name] || {})[y];
  return v == null ? null : v;
}
// Court Pace Index — Masters 1000 only (founder 2026-11-20). The Canadian Open is ONE event: Montreal + Toronto by year.
const CPI_EVENTS = [['Indian Wells', 'Hard'], ['Miami', 'Hard'], ['Monte Carlo', 'Clay'], ['Madrid', 'Clay'], ['Rome', 'Clay'],
  ['Canadian Open', 'Hard'], ['Cincinnati', 'Hard'], ['Shanghai', 'Hard'], ['Paris', 'Indoor hard']];
const CPI_KEY = n => (n === 'Montreal' || n === 'Toronto' ? 'Canadian Open' : n);
const CPI_CREDIT = 'Court Pace Index, courtspeed.com (an on-court measurement of surface friction and bounce; higher is faster)';
const cpiBand = v => (v < 30 ? 'Slow' : v < 35 ? 'Medium-slow' : v < 40 ? 'Medium' : v < 45 ? 'Medium-fast' : 'Fast');
const isM1000 = c => !!c && /^ATP (Masters )?1000$/.test(String(c.category || ''));
// { year: reading } for one CPI event, or null
function cpiSeries(key){
  const d = st.csh && st.csh.cpi; if (!d) return null;
  const parts = key === 'Canadian Open' ? [d.Montreal, d.Toronto] : [d[key]];
  const out = {}; parts.forEach(o => Object.entries(o || {}).forEach(([y, v]) => { if (v != null) out[y] = v; }));
  return Object.keys(out).length ? out : null;
}
function cpiOf(c){
  if (!isM1000(c)) return null;
  const k = CPI_KEY(c.name);
  return CPI_EVENTS.some(e => e[0] === k) ? cpiSeries(k) : null;
}
// Tournament logos: the Database's own map (tournament-logos/index.json, keyed by Database label).
// shortcut: a hand alias for the catalog names the Database labels differently; extend when a catalog name misses.
const LOGO_ALIAS = { 'Monte Carlo': 'Monte-Carlo', Montreal: 'Canada', Toronto: 'Canada', Turin: 'ATP Finals', London: "Queen's Club", "'s-Hertogenbosch": 's-Hertogenbosch', 'French Open': 'Roland Garros' };
function loadLogos(){
  if (st.logos !== undefined || st.logosP || typeof fetch !== 'function') return;
  st.logosP = fetch('./tournament-logos/index.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null)
    .then(d => { st.logos = (d && d.logos) || {}; st.logosP = null; rerender(); });
}
function logoFileOf(name){
  const L = st.logos; if (!L) return null;
  const tn = typeof tourxEventName === 'function' ? tourxEventName(name) : null;
  return L[name] || L[LOGO_ALIAS[name]] || (tn && L[tn]) || null;
}
const logoCode = n => String(n || '').normalize('NFD').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || DASH;
const SPEED_CREDIT = "Tennis Abstract's court-speed rating (tennisabstract.com)";
// The design's 4-band label (founder ruling 1, 2026-11-15: "the 4-band speed label").
const speedLabel = s => (s >= 1.1 ? 'Fast' : s >= 0.95 ? 'Medium' : s >= 0.82 ? 'Medium-slow' : 'Slow');
function speedStats(){
  const rated = events().map(t => speedOf(t.name)).filter(v => v != null);
  return { n: rated.length, med: median(rated), lo: rated.length ? Math.min(...rated) : null, hi: rated.length ? Math.max(...rated) : null, rated };
}
const TIER = { 'Grand Slam': 'GS', 'ATP Finals': 'FNL', 'ATP Masters 1000': '1000', 'ATP 1000': '1000', 'ATP 500': '500', 'ATP 250': '250' };
const tierCode = c => TIER[c] || String(c || DASH).replace('ATP Masters ', '').replace('ATP ', '');
function resolve(name){
  if (typeof tourxResolveCondition === 'function') { const r = tourxResolveCondition(name); if (r) return r; }
  return events().find(t => t.name === name) || null;
}

// ---------------------------------------------------------------- our own conditions (hold, 1st serve won)
function loadHip(){
  if (st.hip !== undefined || st.hipP || typeof fetch !== 'function') return;
  st.hipP = fetch('./how-it-plays.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null)
    .then(d => { st.hip = d && d.events ? d : null; st.hipP = null; rerender(); });
}
function hipEventOf(c){
  const d = st.hip;
  if (!d || !d.events || !c) return null;
  for (const k of (c.tournamentKeys || [])) if (d.events[k]) return d.events[k];
  const clean = n => String(n || '').replace(/^ATP\s+/i, '').replace(/\s*-\s*Qualification$/i, '').trim().toLowerCase();
  const hits = Object.values(d.events).filter(e => clean(e.name) === String(c.name).toLowerCase());
  return hits.length === 1 ? hits[0] : null;
}
const span = y => (y && y.length ? (y.length > 1 ? y[0] + '–' + y[y.length - 1] : String(y[0])) : '');
// 1st serve points won at this event: event-hold.json fsWon / fsPlayed (our box scores, main draw, every surface);
// how-it-plays.json (hard courts only) only where the hold file has no 1st-serve count for the event.
function holdEventOf(c){
  const d = holdData();
  if (!d || !d.events || !c) return null;
  for (const k of (c.tournamentKeys || [])) if (d.events[k]) return d.events[k];
  if (d.byName) { const k = d.byName[String(c.name).toLowerCase()]; if (k != null) return d.events[k] || null; }
  return null;
}
function firstServeOf(c){
  const h = holdEventOf(c);
  if (h && h.fsPlayed > 0) return { pct: 100 * h.fsWon / h.fsPlayed, num: h.fsWon, den: h.fsPlayed, n: h.fsMatches != null ? h.fsMatches : h.matches, span: span(h.years), src: 'our box scores (event-hold.json)' };
  const e = hipEventOf(c), m = e && e.past && e.past.metrics && e.past.metrics.firstServeWon;
  if (!m || !(m.den > 0)) return null;
  return { pct: 100 * m.num / m.den, num: m.num, den: m.den, n: m.n, span: span(e.past.years), src: 'how-it-plays.json' };
}
function loadHold(){ if (holdData() === undefined && typeof trHoldLoad === 'function') trHoldLoad().then(rerender); }
// Service hold at this event: our box scores, every edition on file (event-hold.json), n = service games.
function holdOf(c){
  const e = holdEventOf(c);
  if (!e || !(e.games > 0)) return null;
  return { pct: 100 * e.held / e.games, held: e.held, games: e.games, matches: e.matches, span: span(e.years) };
}

// ---------------------------------------------------------------- the betting market (one definition: aggRows)
// build-tournament-market.js aggRows over database-yield.json rows tagged by settlement.js (bet = in the ROI figures,
// win = in favRel). tools/test-tt-overview.mjs proves every all-years event equals the published tournament-market.json.
function aggRows(rs){
  let n = 0, nRel = 0, sf = 0, sd = 0, fw = 0;
  for (const { r, bet, win } of rs) {
    const won = !!r[7];
    if (bet) { n += 1; sf += (won ? r[5] : 0) - 1; sd += (won ? 0 : r[6]) - 1; }
    if (win) { nRel += 1; if (won) fw += 1; }
  }
  if (!n) return null;
  return { n, roiFav: +(sf / n * 100).toFixed(1), roiDog: +(sd / n * 100).toFixed(1), favRel: nRel ? Math.round(fw / nRel * 100) : null, nRel };
}
function taggedRows(Y, Settle){
  const ret = Y.retRows || [], retC = Y.retComment || [], retF = Y.retFs || [];
  return Y.rows.map(r => ({ r, bet: true, win: true })).concat(ret.map((r, i) => ({ r,
    bet: Settle.betCounts({ comment: retC[i], fs: retF[i] }),
    win: Settle.matchWinner({ comment: retC[i], winnerSide: r[7] ? 'fav' : 'dog' }) != null })))
    .filter(x => x.bet || x.win);
}
// Every event of tournament-market.json (its archiveNames + archiveFilter = the rows the builder pooled) and the tour
// baseline, recomputed over the rows whose season is in [yF, yT]; yF == null = every season.
function marketModel(Y, mkt, Settle, yF, yT){
  const meta = Y.meta || {}, idx = new Map((meta.tournaments || []).map((n, i) => [n, i]));
  const inWin = r => { const y = Math.floor(r[0] / 10000); return yF == null || (y >= yF && y <= yT); };
  const rows = taggedRows(Y, Settle).filter(x => inWin(x.r));
  const by = new Map();
  rows.forEach(x => { const t = x.r[4]; if (!by.has(t)) by.set(t, []); by.get(t).push(x); });
  const tours = {};
  Object.entries(mkt.tournaments || {}).forEach(([name, t]) => {
    let pool = [];
    (t.archiveNames || []).forEach(a => {
      const ix = idx.get(a); if (ix == null) return;
      const f = t.archiveFilter && t.archiveFilter[a], rs = by.get(ix) || [];
      pool = pool.concat(f ? rs.filter(({ r }) => (!f.years || f.years.includes(Math.floor(r[0] / 10000)))
        && (!f.months || f.months.includes(Math.floor(r[0] / 100) % 100)) && (!f.surfaces || f.surfaces.includes(r[2]))) : rs);
    });
    const a = aggRows(pool);
    if (a) tours[name] = a;
  });
  return { baseline: aggRows(rows), tours };
}
const allYears = () => st.yF === 2020 && st.yT === 2026;   // the design: From 2020 · To 2026 = every edition on record
function loadDb(){
  if (st.db !== undefined || st.dbP || typeof fetch !== 'function') return;
  st.dbP = fetch('./database-yield.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null)).catch(() => null)
    .then(d => { st.db = d && Array.isArray(d.rows) ? d : null; st.dbP = null; st._model = null; rerender(); });
}
// { state: 'ok' | 'loading' | 'failed', tours, baseline, label, span } — all years = tournament-market.json as published.
function market(){
  const mkt = marketData();
  if (!mkt) return { state: marketFailed() ? 'failed' : 'loading' };
  if (allYears()) return { state: 'ok', tours: mkt.tournaments || {}, baseline: mkt.baseline, label: 'every edition on record',
    span: (mkt.windowStart || '') + '–' + String((mkt.dateRange || [])[1] || '').slice(0, 4) };
  loadDb();
  if (st.db === undefined) return { state: 'loading' };
  const Settle = root.Settlement;
  if (!st.db || !Settle) return { state: 'failed' };
  const key = st.yF + '-' + st.yT;
  if (!st._model || st._model.key !== key) st._model = Object.assign({ key }, marketModel(st.db, mkt, Settle, st.yF, st.yT));
  return { state: 'ok', tours: st._model.tours, baseline: st._model.baseline,
    label: st.yF === st.yT ? st.yF + ' edition' : st.yF + ' to ' + st.yT, span: st.yF === st.yT ? String(st.yF) : st.yF + '–' + st.yT };
}
// Rank of this event's favourite reliability among every event that clears the 30-match floor in the same window,
// judged on the printed (whole-percent) figure: 1 + the events printing a higher one (ties share a rank).
function relRank(mk, name){
  const ok = Object.values(mk.tours).filter(a => a && a.n >= MIN_MATCHES && a.favRel != null);
  const me = mk.tours[name];
  if (!me || me.n < MIN_MATCHES || me.favRel == null) return null;
  return { rank: 1 + ok.filter(a => a.favRel > me.favRel).length, of: ok.length };
}

// ---------------------------------------------------------------- the CSS (every selector page-scoped)
const P = S + ' ';
const MONO = `font-family:${M}; font-variant-numeric:tabular-nums;`;
const CSS = [
  // ---- page shell: header card (.sfh markup stays), top tabs (the design's track + lifted pick), content shell
  `${P}.tourx-head.sfh{ background:var(--tt-card); box-shadow:none; border:1.25px solid ${W(6)}; }`,
  `${P}.tourx-head .sfh__sub{ color:var(--tt-muted); }`,
  `${P}.tourx-head .sfh__stats{ align-items:flex-start; }`,
  `${P}.tourx-head .sfh__stat{ display:block; text-align:right; }`,
  `${P}.tourx-head .sfh__l{ display:block; }`,
  `${P}.tourx-head .sfh__v{ display:block; margin-top:6px; color:var(--tt-text); }`,
  `@media (max-width:899px){ ${P}.tourx-head.sfh{ flex-wrap:nowrap; } ${P}.tourx-head .sfh__stats{ flex:none; flex-wrap:nowrap; gap:30px; } ${P}.tourx-head .sfh__stat{ align-items:flex-end; } }`,
  `${P}.sf-seg.tt-tabs{ display:inline-flex; align-self:flex-start; width:fit-content; gap:3px; background:var(--tt-inset); border:1px solid ${W(6)}; border-radius:10px; padding:3px; }`,
  `${P}.sf-seg.tt-tabs .sf-seg__opt{ font-family:${H}; font-size:12.5px; font-weight:600; line-height:normal; color:var(--tt-muted); background:transparent; border:1px solid transparent; border-radius:8px; padding:6px 16px; white-space:nowrap; display:inline-block; transition:background .14s ease, color .14s ease, border-color .14s ease; }`,
  `${P}.sf-seg.tt-tabs .sf-seg__opt.on{ background:var(--tt-lifted); border-color:${W(14)}; color:var(--tt-white); font-weight:700; }`,
  `${P}.tourx-head.sfh, ${P}.sf-seg.tt-tabs, ${P}.tourx-shell{ font-size:16px; line-height:normal; }`,
  `${P}.tourx-shell{ border:1.25px solid ${W(6)}; border-radius:12px; background:var(--tt-card); overflow:hidden; }`,
  `${P}#tourListView #tourxOverview, ${P}#tourListView #tourxEntry{ border:0; box-shadow:none; border-radius:0; background:transparent; overflow:visible; }`,
  // ---- Overview root
  `${P}.tt-ov{ font-family:${H}; font-size:16px; line-height:normal; color:var(--tt-text); padding:22px 24px; -webkit-font-smoothing:antialiased; }`,
  `${P}.tt-ov *, ${P}.tt-ov-scrim *{ box-sizing:border-box; }`,
  `${P}.tt-ov-seg{ cursor:pointer; transition:background .14s ease, color .14s ease, border-color .14s ease; }`,
  `${P}.tt-ov-grid{ display:grid; grid-template-columns:minmax(190px,270px) minmax(0,1fr); gap:22px; align-items:stretch; }`,
  `@media (max-width:1100px){ ${P}.tt-ov-grid{ grid-template-columns:minmax(0,1fr); } }`,
  // rail
  `${P}.tt-ov-rail{ position:relative; background:var(--card); border:1px solid ${W(6)}; border-radius:16px; overflow:hidden; min-height:480px; }`,
  `${P}.tt-ov-railin{ position:absolute; inset:0; padding:14px; display:flex; flex-direction:column; gap:14px; }`,
  `${P}.tt-ov-search{ display:flex; align-items:center; gap:10px; background:var(--inner); border:1px solid transparent; border-radius:10px; padding:10px 12px; margin:0; }`,
  `${P}.tt-ov-search input{ flex:1; min-width:0; background:transparent; border:0; outline:none; font-family:${H}; font-size:13px; color:var(--text); padding:1px 2px; margin:0; line-height:normal; }`,
  `${P}.tt-ov-search input::placeholder{ color:var(--text-label); }`,
  `${P}.tt-ov-list{ display:flex; flex-direction:column; gap:6px; flex:1; min-height:0; overflow-y:auto; scrollbar-width:none; }`,
  `${P}.tt-ov-list::-webkit-scrollbar{ display:none; }`,
  `${P}.tt-ov-gh{ font-family:${H}; font-size:10.5px; font-weight:700; letter-spacing:0.10em; text-transform:uppercase; color:var(--text-label); padding:4px 6px; }`,
  `${P}.tt-ov-gh.season{ padding:12px 6px 4px; border-top:1px solid ${W(5)}; margin-top:4px; }`,
  `${P}.tt-ov-row{ display:flex; align-items:center; gap:11px; padding:11px 14px; border-radius:11px; background:transparent; box-shadow:none; }`,
  `${P}.tt-ov-row.on{ background:var(--selected); box-shadow:inset 0 0 0 1px ${W(16)}; }`,
  `${P}.tt-ov-chip{ flex:none; display:inline-flex; align-items:center; justify-content:center; min-width:42px; height:22px; padding:0 7px; border-radius:6px; background:${W(5)}; border:1px solid ${W(14)}; font-family:${M}; font-size:10px; font-weight:700; letter-spacing:0.04em; color:var(--text-soft); }`,
  `${P}.tt-ov-row.on .tt-ov-chip{ background:${W(10)}; border-color:${W(20)}; color:var(--text); }`,
  `${P}.tt-ov-rname{ flex:1; min-width:0; font-size:13.5px; font-weight:700; color:var(--text); }`,
  `${P}.tt-ov-row.on .tt-ov-rname{ font-weight:600; }`,
  `${P}.tt-ov-rspd{ font-family:${M}; font-size:13px; font-weight:700; letter-spacing:-0.01em; font-variant-numeric:tabular-nums; color:var(--text); }`,
  // shared pieces
  `${P}.tt-ov .tt-ov-dash.tt-ov-dash, ${P}.tt-ov-scrim .tt-ov-dash.tt-ov-dash{ color:var(--tt-muted); }`,
  `${P}.tt-ov-card{ background:var(--tt-inset); border:1px solid ${W(6)}; border-radius:16px; }`,
  `${P}.tt-ov-t16{ font-size:16px; font-weight:800; letter-spacing:-0.01em; color:var(--tt-white); }`,
  `${P}.tt-ov-hd{ display:flex; align-items:center; justify-content:space-between; gap:12px; }`,
  `${P}.tt-ov-btn{ display:inline-flex; align-items:center; gap:8px; height:30px; padding:0 11px; border-radius:9px; background:var(--tt-lifted); border:1px solid ${W(14)}; font-size:12.5px; font-weight:700; color:var(--tt-white); white-space:nowrap; }`,
  `${P}.tt-ov-btn:hover, ${P}.tt-ov-x:hover{ background:var(--tt-hover); }`,
  `${P}.tt-ov-pchip{ font-size:11px; font-weight:600; color:var(--tt-soft); background:var(--tt-lifted); box-shadow:inset 0 0 0 1px ${W(14)}; border-radius:7px; padding:4px 9px 5px; white-space:nowrap; }`,
  `${P}.tt-ov-lnk{ display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:700; color:var(--tt-blue); white-space:nowrap; }`,
  `${P}.tt-ov-sw{ display:inline-flex; gap:3px; background:var(--tt-inset); border:1px solid ${W(6)}; border-radius:10px; padding:3px; }`,
  `${P}.tt-ov-sw > span{ font-size:12.5px; font-weight:600; color:var(--tt-muted); background:transparent; border:1px solid transparent; border-radius:8px; padding:6px 12px; white-space:nowrap; }`,
  `${P}.tt-ov-sw > span.on{ font-weight:700; color:var(--tt-white); background:var(--tt-lifted); border-color:${W(14)}; }`,
  `${P}.tt-ov-lab{ font-size:11.5px; font-weight:600; color:var(--tt-muted); }`,
  // detail column + head
  `${P}.tt-ov-detail{ display:flex; flex-direction:column; gap:16px; min-width:0; padding-left:24px; padding-right:0; }`,
  `${P}.tt-ov-stack{ display:flex; flex-direction:column; gap:16px; }`,
  `${P}.tt-ov-head{ display:flex; align-items:center; gap:16px; }`,
  `${P}.tt-ov-logo{ flex:none; width:60px; height:60px; border-radius:14px; background:var(--tt-lifted); box-shadow:inset 0 0 0 1px ${W(14)}; display:flex; align-items:center; justify-content:center; overflow:hidden; position:relative; }`,
  `${P}.tt-ov-logo .code{ ${MONO} font-size:16px; font-weight:700; letter-spacing:0.02em; color:var(--tt-soft); }`,
  `${P}.tt-ov-logo img{ position:absolute; left:10px; top:10px; width:40px; height:40px; object-fit:contain; }`,
  `${P}.tt-ov-logo.has .code{ visibility:hidden; }`,
  `${P}.tt-ov-ttl{ display:flex; align-items:center; gap:11px; flex-wrap:wrap; }`,
  `${P}.tt-ov-name{ font-size:29px; font-weight:800; letter-spacing:-0.015em; line-height:1.1; }`,
  `${P}.tt-ov-sub{ font-size:13px; color:var(--tt-muted); margin-top:6px; }`,
  // court speed card
  `${P}.tt-ov-speed{ display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:8px 48px; padding:24px; }`,
  `${P}.tt-ov-sl{ min-width:0; }`,
  `${P}.tt-ov-fig{ display:flex; align-items:baseline; gap:14px; margin-top:20px; }`,
  `${P}.tt-ov-fig48{ ${MONO} font-size:48px; font-weight:700; line-height:0.9; letter-spacing:-0.02em; }`,
  `${P}.tt-ov-band{ font-size:15px; font-weight:700; color:var(--tt-white); }`,
  `${P}.tt-ov-track{ position:relative; height:4px; border-radius:4px; background:${W(7)}; margin-top:26px; cursor:pointer; }`,
  `${P}.tt-ov-track .fill{ position:absolute; left:0; top:0; bottom:0; border-radius:4px; background:${B(55)}; }`,
  `${P}.tt-ov-track .med{ position:absolute; top:-5px; bottom:-5px; width:2px; background:var(--tt-white); transform:translateX(-50%); }`,
  `${P}.tt-ov-track .knob{ position:absolute; top:50%; width:14px; height:14px; border-radius:50%; background:var(--tt-blue); border:3px solid var(--tt-inset); box-shadow:0 0 0 1px ${B(50)}; transform:translate(-50%,-50%); }`,
  `${P}.tt-ov-scale{ display:flex; justify-content:space-between; margin-top:12px; font-size:11.5px; font-weight:600; color:var(--tt-muted); }`,
  `${P}.tt-ov-rank{ margin-top:16px; font-size:13px; color:var(--tt-muted); }`,
  `${P}.tt-ov-rank .m{ ${MONO} font-weight:700; color:var(--tt-white); }`,
  `${P}.tt-ov-sr{ min-width:0; display:flex; flex-direction:column; justify-content:center; }`,
  `${P}.tt-ov-kv{ display:flex; align-items:baseline; justify-content:space-between; gap:16px; padding:16px 0; }`,
  `${P}.tt-ov-kv + .tt-ov-kv{ border-top:1px solid ${W(6)}; }`,
  `${P}.tt-ov-kv.cpi{ border-bottom:1px solid ${W(6)}; }`,
  `${P}.tt-ov-kv.cpi + .tt-ov-kv{ border-top:0; }`,
  `${P}.tt-ov-kv.cpi:hover{ box-shadow:inset 0 0 0 999px ${W(3)}; }`,
  `${P}.tt-ov-kv .k{ display:inline-flex; align-items:baseline; gap:6px 10px; flex-wrap:wrap; font-size:13.5px; font-weight:600; color:var(--tt-soft); }`,
  `${P}.tt-ov-kv .v{ display:inline-flex; align-items:baseline; gap:5px; }`,
  `${P}.tt-ov-kv .n{ ${MONO} font-size:20px; font-weight:700; line-height:1; }`,
  `${P}.tt-ov-kv .u{ width:15px; font-size:12.5px; font-weight:600; color:var(--tt-muted); }`,
  `${P}.tt-ov-kv .u.go{ font-size:15px; font-weight:700; color:var(--tt-blue); }`,
  // trend card
  `${P}.tt-ov-yr{ padding:22px 24px 20px; }`,
  `${P}.tt-ov-yrhd{ display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; min-height:34px; }`,
  `${P}.tt-ov-yrhd > .l{ display:inline-flex; align-items:center; gap:10px 14px; flex-wrap:wrap; }`,
  `${P}.tt-ov-trend{ display:inline-flex; align-items:baseline; gap:10px; }`,
  `${P}.tt-ov-trend .w{ font-size:13px; font-weight:600; color:var(--tt-soft); }`,
  `${P}.tt-ov-trend .d{ ${MONO} font-size:13px; font-weight:700; }`,
  `${P}.tt-ov-plot{ position:relative; height:112px; margin-top:26px; }`,
  `${P}.tt-ov-plot .ax{ position:absolute; left:0; right:0; bottom:24px; height:1px; background:${W(6)}; }`,
  `${P}.tt-ov-plot svg{ position:absolute; inset:0; display:block; }`,
  `${P}.tt-ov-dot{ position:absolute; width:9px; height:9px; border-radius:50%; background:var(--tt-inset); border:2px solid var(--tt-white); transform:translate(-50%,-50%); }`,
  `${P}.tt-ov-pv{ position:absolute; transform:translate(-50%,calc(-100% - 11px)); ${MONO} font-size:12.5px; font-weight:700; color:var(--tt-white); white-space:nowrap; }`,
  `${P}.tt-ov-py{ position:absolute; bottom:0; transform:translateX(-50%); ${MONO} font-size:11px; color:var(--tt-muted); }`,
  `${P}.tt-ov-none{ position:absolute; left:0; right:0; top:36px; text-align:center; font-size:13px; color:var(--tt-muted); }`,
  // conditions + quotes
  `${P}.tt-ov-two{ display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:16px; }`,
  `${P}.tt-ov-cond, ${P}.tt-ov-qcard{ padding:22px 24px; }`,
  `${P}.tt-ov-ctext{ font-size:13.5px; line-height:1.65; color:var(--tt-soft); text-wrap:pretty; margin-top:12px; }`,
  `${P}.tt-ov-qcard{ display:flex; flex-direction:column; }`,
  `${P}.tt-ov-qcard.open{ cursor:pointer; }`,
  `${P}.tt-ov-qcard.open:hover{ border-color:${W(22)}; }`,
  `${P}.tt-ov-qfoot{ margin-top:auto; padding-top:12px; display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }`,
  `${P}.tt-ov-qby{ font-size:13px; font-weight:700; color:var(--tt-white); }`,
  `${P}.tt-ov-qmeta{ font-size:12px; color:var(--tt-muted); }`,
  // betting market head + tiles
  `${P}.tt-ov-bm{ display:flex; align-items:center; justify-content:space-between; gap:12px 20px; flex-wrap:wrap; padding-top:12px; }`,
  `${P}.tt-ov-bmt{ display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; }`,
  `${P}.tt-ov-bmt .t{ font-size:18px; font-weight:800; letter-spacing:-0.01em; }`,
  `${P}.tt-ov-bmt .l{ font-size:13px; color:var(--tt-muted); }`,
  `${P}.tt-ov-yrs{ display:flex; align-items:center; gap:10px 16px; flex-wrap:wrap; }`,
  `${P}.tt-ov-yrs label{ display:inline-flex; align-items:center; gap:9px; margin:0; }`,
  `${P}.tt-ov-sel{ position:relative; display:inline-flex; }`,
  `${P}.tt-ov-sel select{ appearance:none; -webkit-appearance:none; background:var(--tt-inset); border:1px solid ${W(14)}; border-radius:8px; padding:7px 30px 7px 12px; font-family:${M}; font-size:12.5px; font-weight:700; color:var(--tt-text); cursor:pointer; outline:none; margin:0; line-height:normal; height:auto; }`,
  `${P}.tt-ov-sel svg{ position:absolute; right:11px; top:50%; transform:translateY(-50%); pointer-events:none; }`,
  `${P}.tt-ov-reset{ font-size:12.5px; font-weight:700; color:var(--tt-blue); cursor:pointer; }`,
  `${P}.tt-ov-tiles{ display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:8px; }`,
  `${P}.tt-ov-tile{ background:var(--tt-inset); border:1px solid ${W(9)}; border-radius:11px; padding:16px 18px 14px; }`,
  `${P}.tt-ov-tile.open{ cursor:pointer; }`,
  `${P}.tt-ov-tile.open:hover{ background:var(--tt-hover); border-color:${W(22)}; }`,
  `${P}.tt-ov-tile .go{ font-size:11.5px; font-weight:700; color:var(--tt-blue); display:inline-flex; }`,
  `${P}.tt-ov-tf{ ${MONO} font-size:26px; font-weight:700; line-height:1; margin-top:14px; }`,
  `${P}.tt-ov-tl{ font-size:12px; color:var(--tt-muted); margin-top:10px; }`,
  `${P}.tt-ov-tl .m{ ${MONO} font-weight:700; }`,
  `${P}.tt-ov-verdict{ font-size:11.5px; font-weight:600; color:var(--tt-soft); white-space:nowrap; }`,
  `${P}.tt-ov-rel{ display:flex; align-items:baseline; gap:10px; margin-top:14px; }`,
  `${P}.tt-ov-rel .f{ ${MONO} font-size:26px; font-weight:700; line-height:1; }`,
  `${P}.tt-ov-rel .gp{ ${MONO} font-size:13px; font-weight:700; }`,
  `${P}.tt-ov-rel .vs{ font-size:12px; color:var(--tt-muted); }`,
  `${P}.tt-ov-rbar{ position:relative; height:4px; border-radius:4px; background:${W(7)}; margin-top:14px; }`,
  `${P}.tt-ov-rbar .fill{ position:absolute; left:0; top:0; bottom:0; background:${B(55)}; border-radius:4px; }`,
  `${P}.tt-ov-rbar .tick{ position:absolute; top:-4px; bottom:-4px; width:2px; background:var(--tt-white); transform:translateX(-50%); }`,
  `${P}.tt-ov-rfoot{ display:flex; justify-content:space-between; gap:10px; margin-top:12px; font-size:12px; color:var(--tt-muted); }`,
  `${P}.tt-ov-cta{ display:inline-flex; align-items:center; gap:8px; font-size:13px; font-weight:700; color:var(--tt-white); height:38px; padding:0 15px; background:var(--tt-lifted); border:1px solid ${W(14)}; border-radius:10px; cursor:pointer; }`,
  `${P}.tt-ov-cta:hover{ background:var(--tt-hover); }`,
  // ---- boxes (fixed layer over the page)
  `${P}.tt-ov-scrim{ position:fixed; inset:0; z-index:90; background:var(--tt-scrim); display:flex; align-items:center; justify-content:center; padding:32px 22px; font-family:${H}; font-size:16px; line-height:normal; color:var(--tt-text); -webkit-font-smoothing:antialiased; }`,
  `${P}.tt-ov-scrim.top{ z-index:85; align-items:flex-start; overflow:auto; padding:34px 22px 60px; }`,
  `${P}.tt-ov-sheet{ width:100%; max-height:100%; display:flex; flex-direction:column; background:var(--tt-card); border:1px solid ${W(12)}; border-radius:16px; box-shadow:var(--tt-shadow-overlay); overflow:hidden; }`,
  `${P}.tt-ov-shd{ flex:none; padding:24px 24px 20px; border-bottom:1px solid ${W(6)}; }`,
  `${P}.tt-ov-shd.q{ padding:22px 24px 18px; border-bottom-color:${W(8)}; }`,
  `${P}.tt-ov-shrow{ display:flex; align-items:center; gap:12px 16px; flex-wrap:wrap; }`,
  `${P}.tt-ov-shd.q .tt-ov-shrow{ align-items:flex-start; flex-wrap:nowrap; }`,
  `${P}.tt-ov-sht{ font-size:18px; font-weight:800; letter-spacing:-0.01em; color:var(--tt-white); }`,
  `${P}.tt-ov-shs{ font-size:13px; color:var(--tt-muted); margin-top:5px; }`,
  `${P}.tt-ov-shd.q .tt-ov-shs{ font-size:12.5px; }`,
  `${P}.tt-ov-x{ flex:none; width:34px; height:34px; border-radius:9px; background:var(--tt-lifted); border:1px solid ${W(14)}; display:flex; align-items:center; justify-content:center; cursor:pointer; }`,
  `${P}.tt-ov-x.q{ width:32px; height:32px; background:transparent; border-color:${W(12)}; }`,
  `${P}.tt-ov-x.q:hover{ background:${W(6)}; }`,
  `${P}.tt-ov-cpyrs{ display:flex; align-items:center; gap:10px 16px; flex-wrap:wrap; margin-top:18px; }`,
  `${P}.tt-ov-strip{ display:flex; align-items:baseline; gap:8px 18px; flex-wrap:wrap; margin-top:18px; padding:14px 18px; background:var(--tt-lifted); box-shadow:inset 0 0 0 1px ${W(14)}; border-radius:11px; }`,
  `${P}.tt-ov-strip .nm{ font-size:15px; font-weight:700; color:var(--tt-white); }`,
  `${P}.tt-ov-strip .sp{ ${MONO} font-size:26px; font-weight:700; line-height:1; color:var(--tt-white); }`,
  `${P}.tt-ov-strip .rk{ font-size:13px; color:var(--tt-muted); }`,
  `${P}.tt-ov-strip .gp{ margin-left:auto; font-size:13px; color:var(--tt-muted); white-space:nowrap; }`,
  `${P}.tt-ov-strip .gp .m{ ${MONO} font-weight:700; }`,
  `${P}.tt-ov-sbody{ flex:1; min-height:0; overflow-y:auto; }`,
  `${P}.tt-ov-speedgrid{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); align-items:start; }`,
  `${P}.tt-ov-spcol{ min-width:0; border-left:1px solid ${W(6)}; padding-bottom:14px; }`,
  `${P}.tt-ov-spcol:first-child{ border-left-color:transparent; }`,
  `${P}.tt-ov-spch{ position:sticky; top:0; z-index:1; background:var(--tt-card); padding:18px 16px 12px; border-bottom:1px solid ${W(6)}; }`,
  `${P}.tt-ov-spch .l{ font-size:14px; font-weight:700; color:var(--tt-white); }`,
  `${P}.tt-ov-spch .m{ font-size:12px; color:var(--tt-muted); margin-top:4px; }`,
  `${P}.tt-ov-sprow{ display:grid; grid-template-columns:20px minmax(0,1fr) 28px 34px; gap:0 8px; align-items:center; min-height:40px; margin:0 6px; padding:0 10px; border-radius:8px; background:transparent; }`,
  `${P}.tt-ov-sprow:hover{ background:var(--tt-hover); }`,
  `${P}.tt-ov-sprow.on{ background:var(--tt-hover); box-shadow:inset 0 0 0 1px ${W(14)}; }`,
  `${P}.tt-ov-sprow .rk{ ${MONO} font-size:11px; color:var(--tt-muted); text-align:right; }`,
  `${P}.tt-ov-sprow .nm{ font-size:13px; font-weight:600; color:var(--tt-soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }`,
  `${P}.tt-ov-sprow.on .nm{ font-weight:700; color:var(--tt-white); }`,
  `${P}.tt-ov-bar{ position:relative; height:4px; border-radius:4px; background:${W(7)}; }`,
  `${P}.tt-ov-bar span{ position:absolute; left:0; top:0; bottom:0; background:${B(55)}; border-radius:4px; }`,
  `${P}.on > .tt-ov-bar span{ background:var(--tt-blue); }`,
  `${P}.tt-ov-sprow .v{ ${MONO} font-size:13px; font-weight:700; color:var(--tt-white); text-align:right; }`,
  `@media (max-width:1180px){ ${P}.tt-ov-sprow .tt-ov-bar{ display:none !important; } ${P}.tt-ov-sprow{ grid-template-columns:20px minmax(0,1fr) 34px !important; gap:0 6px !important; padding:0 8px !important; } }`,
  `@media (max-width:860px){ ${P}.tt-ov-speedgrid{ grid-template-columns:repeat(2,minmax(0,1fr)) !important; } ${P}.tt-ov-speedgrid > div:nth-child(odd){ border-left-color:transparent !important; } ${P}.tt-ov-speedgrid > div:nth-child(n+3){ border-top:1px solid ${W(7)}; } }`,
  // CPI table
  `${P}.tt-ov-cpbody{ flex:1; min-height:0; overflow:auto; padding:8px 24px 18px; }`,
  `${P}.tt-ov-cph, ${P}.tt-ov-cpr{ display:grid; gap:0 14px; align-items:center; padding:0 10px; }`,
  `${P}.tt-ov-cph{ height:38px; font-size:11.5px; font-weight:600; color:var(--tt-muted); }`,
  `${P}.tt-ov-cph .y{ text-align:right; ${MONO} }`,
  `${P}.tt-ov-cpr{ height:54px; border-top:1px solid ${W(6)}; border-radius:10px; }`,
  `${P}.tt-ov-cpr:hover{ background:var(--tt-hover); }`,
  `${P}.tt-ov-cpr.on{ border-top-color:transparent; background:var(--tt-hover); box-shadow:inset 0 0 0 1px ${W(14)}; }`,
  `${P}.tt-ov-cpr .rk{ ${MONO} font-size:11px; color:var(--tt-muted); text-align:right; }`,
  `${P}.tt-ov-cpr .nm{ min-width:0; display:flex; flex-direction:column; gap:2px; }`,
  `${P}.tt-ov-cpr .nm b{ font-size:14px; font-weight:700; color:var(--tt-white); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }`,
  `${P}.tt-ov-cpr .nm i{ font-style:normal; font-size:12px; color:var(--tt-muted); }`,
  `${P}.tt-ov-cpr .c{ text-align:right; ${MONO} font-size:13px; font-weight:500; color:var(--tt-muted); }`,
  `${P}.tt-ov-cpr .c.last{ font-weight:700; color:var(--tt-white); }`,
  `${P}.tt-ov-cpr .tt-ov-pchip{ justify-self:end; }`,
  // quotes box
  `${P}.tt-ov-pills{ display:flex; gap:6px; flex-wrap:wrap; margin-top:16px; }`,
  `${P}.tt-ov-pill{ font-size:11.5px; font-weight:700; color:var(--tt-muted); background:transparent; border:1px solid ${W(8)}; border-radius:8px; padding:6px 13px; white-space:nowrap; }`,
  `${P}.tt-ov-pill.on{ color:var(--tt-white); background:var(--tt-raised); border-color:${W(16)}; }`,
  `${P}.tt-ov-qbody{ flex:1; min-height:0; overflow-y:auto; padding:0 24px 4px; }`,
  `${P}.tt-ov-qrow{ display:grid; grid-template-columns:236px minmax(0,1fr); gap:0 28px; align-items:start; margin:0 -24px; padding:20px 24px; border-bottom:1px solid ${W(6)}; }`,
  `${P}.tt-ov-qrow:hover{ box-shadow:inset 0 0 0 999px ${W(1.8)}; }`,
  `@media (max-width:700px){ ${P}.tt-ov-qrow{ grid-template-columns:minmax(0,1fr); gap:12px; } }`,
  `${P}.tt-ov-qwho{ display:flex; align-items:center; gap:12px; min-width:0; }`,
  `${P}.tt-ov-av{ position:relative; overflow:hidden; flex:none; width:36px; height:36px; border-radius:50%; background:var(--tt-inset); border:1px solid ${W(14)}; display:flex; align-items:center; justify-content:center; ${MONO} font-size:11px; font-weight:700; color:var(--tt-soft); }`,
  `${P}.tt-ov-av .sf-ph{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:center; border-radius:50%; }`,
  `${P}.tt-ov-qn{ min-width:0; display:flex; flex-direction:column; gap:4px; }`,
  `${P}.tt-ov-qn .p{ font-size:13.5px; font-weight:700; color:var(--tt-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }`,
  `${P}.tt-ov-qn .w{ font-size:12px; color:var(--tt-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }`,
  `${P}.tt-ov-qn .w .y{ font-family:${M}; color:var(--tt-soft); }`,
  `${P}.tt-ov-qt{ font-size:14.5px; line-height:1.65; color:var(--tt-text); text-wrap:pretty; padding-top:1px; }`,
  // backing box: the Database page mounted boxed (transparent on the box colour, no View row, Filters row kept)
  `${P}.tt-ov-sheet.roi{ max-height:none; max-width:1180px; display:block; }`,
  `${P}[data-db-root="roi"]{ background:transparent; min-height:0; max-width:none; padding:20px 24px 28px; }`,
  `${P}[data-db-root="roi"] .db-ctltop{ display:none; }`,
  `${P}[data-db-root="roi"] .db-ctlbot{ border-top:0; }`,
].join('\n');
function injectCss(){
  if (typeof document === 'undefined' || !document.createElement || document.getElementById('tt-overview-css')) return;
  const s = document.createElement('style'); s.id = 'tt-overview-css'; s.textContent = CSS;
  (document.head || document.documentElement).appendChild(s);
}

// ---------------------------------------------------------------- render: rail
function railHtml(){
  const ts = tstate(), q = String(ts.tsQ || '').trim().toLowerCase();
  const match = t => !q || (typeof tourxEventSearchText === 'function' ? tourxEventSearchText(t.name) : String(t.name).toLowerCase()).includes(q);
  let week = new Set();
  try { week = tourxActiveWeekNames(); } catch (e) { /* no feed: nothing is this week */ }
  const ev = events();
  const row = t => {
    const on = t.name === ts.tsSel, sp = speedOf(t.name);
    return `<div class="tt-ov-row tt-ov-seg${on ? ' on' : ''}" data-tt-ev="${esc(t.name)}" onclick="TTOverview.select('${jsq(t.name)}')"><span class="tt-ov-chip">${esc(tierCode(t.category))}</span><span class="tt-ov-rname">${esc(t.name)}</span><span class="tt-ov-rspd${sp == null ? ' tt-ov-dash' : ''}"${sp != null ? ` title="${esc(SPEED_CREDIT)}"` : ''}>${sp == null ? DASH : sp.toFixed(2)}</span></div>`;
  };
  const wk = ev.filter(t => week.has(t.name) && match(t)), se = ev.filter(t => !week.has(t.name) && match(t));
  return `<div class="tt-ov-rail"><div class="tt-ov-railin">
      <label class="tt-ov-search"><svg width="15" height="15" viewBox="0 0 20 20" fill="none" style="flex:none;"><circle cx="9" cy="9" r="6" stroke="var(--text-label)" stroke-width="1.7"></circle><path d="m14 14 3 3" stroke="var(--text-label)" stroke-width="1.7" stroke-linecap="round"></path></svg><input id="ttOvSearch" value="${esc(ts.tsQ || '')}" oninput="TTOverview.search(this.value)" placeholder="Search tournaments..."></label>
      <div class="tt-ov-list"><div class="tt-ov-gh">This week</div>${wk.map(row).join('')}<div class="tt-ov-gh season">Season</div>${se.map(row).join('')}</div>
    </div></div>`;
}

// ---------------------------------------------------------------- render: head (logo tile + name + chip + tier line)
function headHtml(c){
  const lf = logoFileOf(c.name);
  const img = lf ? `<img src="./tournament-logos/${esc(lf)}" alt="${esc(c.name)} logo" loading="lazy" onerror="this.parentNode.classList.remove('has');this.remove();">` : '';
  return `<div class="tt-ov-head"><span class="tt-ov-logo${lf ? ' has' : ''}" title="${esc(c.name)}"><span class="code">${esc(logoCode(c.name))}</span>${img}</span>
      <div style="min-width:0;"><div class="tt-ov-ttl"><span class="tt-ov-name">${esc(c.name)}</span>${c.status === 'Completed' ? '<span class="tt-ov-pchip">Completed</span>' : ''}</div><div class="tt-ov-sub">${esc(c.category || DASH)} · ${esc(cap(c.surface || ''))} court</div></div></div>`;
}

// ---------------------------------------------------------------- render: court speed card
function speedCardHtml(c){
  const sp = speedOf(c.name), S2 = speedStats();
  const pos = v => Math.max(3, Math.min(97, (v - 0.5) * 100)) + '%';
  const yr = (speedLatest(c.name) || {}).year;
  const credit = ` title="${esc(sp != null ? SPEED_CREDIT + (yr ? ', ' + yr + ' reading' : '') : 'No court-speed figure of our own.')}"`;
  const rank = sp != null ? ord(1 + S2.rated.filter(v => v > sp).length) : DASH;
  const alt = c.altitude != null ? c.altitude : null;
  const fs = firstServeOf(c), hd = holdOf(c), cpi = cpiOf(c);
  const kv = (k, v, unit, tip) => `<div class="tt-ov-kv"><span class="k">${k}</span><span class="v" title="${esc(tip)}"><span class="n${v == null ? ' tt-ov-dash' : ''}">${v == null ? DASH : v}</span><span class="u">${unit}</span></span></div>`;
  const fsTip = fs ? `1st serve points won at ${c.name}: ${fmtN(fs.num)} of ${fmtN(fs.den)} points (n = ${fmtN(fs.den)} points, ${fmtN(fs.n)} matches, ${fs.span}), both players, main draw. ${cap(fs.src)}.`
    : (holdData() === undefined || st.hip === undefined ? 'Loading' : `No 1st-serve count on file for ${c.name}.`);
  const hdTip = hd ? `Service hold at ${c.name}: ${fmtN(hd.held)} of ${fmtN(hd.games)} service games held (n = ${fmtN(hd.games)}, ${fmtN(hd.matches)} matches, ${hd.span}), both players, main draw. Our own box scores.`
    : (holdData() === undefined ? 'Loading' : `No box score on file for ${c.name}, so no hold rate.`);
  let cpiRow = '';
  if (cpi) {
    const ys = Object.keys(cpi).map(Number).sort((a, b) => a - b), ly = ys[ys.length - 1], lv = cpi[ly];
    cpiRow = `<div class="tt-ov-kv cpi tt-ov-seg" data-tt-cpi="1" onclick="TTOverview.metric('cpi')" title="${esc(CPI_CREDIT + '. Click to see it year by year.')}"><span class="k">Court Pace Index<span class="tt-ov-lab">${cpiBand(lv)} · ${ly}</span></span><span class="v"><span class="n">${lv.toFixed(1)}</span><span class="u go">›</span></span></div>`;
  }
  return `<div class="tt-ov-card tt-ov-speed">
      <div class="tt-ov-sl">
        <div class="tt-ov-hd"><span class="tt-ov-t16">Court speed</span><span class="tt-ov-btn tt-ov-seg" onclick="TTOverview.openSpeeds()">Compare all ${chev('var(--tt-blue)')}</span></div>
        <div class="tt-ov-fig"><span class="tt-ov-fig48${sp == null ? ' tt-ov-dash' : ''}"${credit}>${sp == null ? DASH : sp.toFixed(2)}</span><span class="tt-ov-band${sp == null ? ' tt-ov-dash' : ''}">${sp == null ? DASH : speedLabel(sp)}</span></div>
        <div class="tt-ov-track tt-ov-seg" onclick="TTOverview.openSpeeds()" title="Abstract court speed. The tick marks the tour median.">${sp != null ? `<span class="fill" style="width:${pos(sp)};"></span>` : ''}${S2.med != null ? `<span class="med" style="left:${pos(S2.med)};"></span>` : ''}${sp != null ? `<span class="knob" style="left:${pos(sp)};"></span>` : ''}</div>
        <div class="tt-ov-scale"><span>Slow</span><span>Medium</span><span>Fast</span></div>
        <div class="tt-ov-rank"><span class="m">${rank}</span> fastest of <span class="m">${S2.n || DASH}</span> · tour median <span class="m">${S2.med != null ? S2.med.toFixed(2) : DASH}</span></div>
      </div>
      <div class="tt-ov-sr">
        ${cpiRow}
        ${kv('Altitude', alt, 'm', alt != null ? `Venue altitude, ${alt} m.` : 'No altitude on file.')}
        ${kv('1st serve points won', fs ? Math.round(fs.pct) : null, '%', fsTip)}
        ${kv('Service hold', hd ? Math.round(hd.pct) : null, '%', hdTip)}
      </div>
    </div>`;
}

// ---------------------------------------------------------------- render: trend card (Speed index · CPI)
// The design: only the years with a reading are plotted, evenly spread (2020–2026); the title range follows them.
function speedYearsHtml(c){
  const cpi = cpiOf(c), on = !!cpi && st.ovMetric === 'cpi';
  const dp = on ? 1 : 2, th = on ? 0.5 : 0.03;
  const pts = YEARS.map(y => ({ y, v: on ? (cpi[y] != null ? cpi[y] : null) : speedYearOf(c.name, y) })).filter(p => p.v != null);
  const chTop = 40, chBot = 66;
  const mn = pts.length ? Math.min(...pts.map(p => p.v)) : 0, sp = pts.length ? (Math.max(...pts.map(p => p.v)) - mn) || 1 : 1;
  pts.forEach((p, j) => { p.x = Math.round((pts.length > 1 ? 26 + j * (308 / (pts.length - 1)) : 180) * 10) / 10; p.yy = chBot - (p.v - mn) / sp * (chBot - chTop); });
  let word = DASH, delta = '', dcol = '';
  if (pts.length > 1) {
    const d = pts[pts.length - 1].v - pts[0].v;
    word = Math.abs(d) < th ? 'Holding steady' : (d > 0 ? 'Trending faster' : 'Trending slower');
    delta = (d >= 0 ? '+' : MINUS) + Math.abs(d).toFixed(dp);
    dcol = Math.abs(d) < 0.005 ? 'var(--tt-muted)' : d > 0 ? 'var(--tt-green)' : 'var(--tt-red)';
  }
  const range = pts.length ? pts[0].y + (pts.length > 1 ? '–' + pts[pts.length - 1].y : '') : DASH;
  const L = p => (p.x / 360 * 100).toFixed(2) + '%';
  const svg = pts.length ? `<svg viewBox="0 0 360 104" preserveAspectRatio="none" width="100%" height="100%" fill="none"><defs><linearGradient id="ttTrFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--tt-white);" stop-opacity="0.14"></stop><stop offset="1" style="stop-color:var(--tt-white);" stop-opacity="0"></stop></linearGradient></defs><path d="M${pts.map(p => p.x + ' ' + p.yy).join(' L')} L${pts[pts.length - 1].x} 90 L${pts[0].x} 90 Z" fill="url(#ttTrFill)"></path><polyline points="${pts.map(p => p.x + ',' + p.yy).join(' ')}" fill="none" stroke="var(--tt-white)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline></svg>` : '';
  const marks = pts.map(p => `<span class="tt-ov-dot" style="left:${L(p)};top:${p.yy.toFixed(1)}px;"></span><span class="tt-ov-pv" style="left:${L(p)};top:${p.yy.toFixed(1)}px;">${p.v.toFixed(dp)}</span><span class="tt-ov-py" style="left:${L(p)};">${p.y}</span>`).join('');
  const loading = !on && st.csh === undefined && TT_SPEED_SOURCE === 'ta';
  const empty = pts.length ? '' : `<span class="tt-ov-none${loading ? '' : ' tt-ov-dash'}">${loading ? '&nbsp;' : DASH}</span>`;
  const tip = on ? CPI_CREDIT + '; only the years with a reading are plotted.'
    : TT_SPEED_SOURCE === 'ta' ? (st.csh === null ? 'The court-speed history did not load.' : `${SPEED_CREDIT}, season by season; only the years with a reading are plotted.`) : 'No court-speed figure of our own.';
  const sw = cpi ? `<span class="tt-ov-sw">${[['speed', 'Speed index'], ['cpi', 'CPI']].map(m => `<span class="tt-ov-seg${(m[0] === 'cpi') === on ? ' on' : ''}" onclick="TTOverview.metric('${m[0]}')">${m[1]}</span>`).join('')}</span>` : '';
  return `<div class="tt-ov-card tt-ov-yr" title="${esc(tip)}">
      <div class="tt-ov-yrhd"><span class="l"><span class="tt-ov-t16">${on ? 'Court Pace Index' : 'Court speed'} · ${range}</span>${sw}</span><span class="tt-ov-trend"><span class="w${pts.length > 1 ? '' : ' tt-ov-dash'}">${word}</span>${delta ? `<span class="d" style="color:${dcol};">${delta}</span>` : ''}</span></div>
      <div class="tt-ov-plot"><span class="ax"></span>${svg}${marks}${empty}</div>
    </div>`;
}

// ---------------------------------------------------------------- render: Conditions read (plain sentences, our data)
// The design's hand-written per-event prose has no source; these sentences are built only from figures on the card.
function conditionsText(c){
  const surf = String(c.surface || '').toLowerCase(), io = c.indoor === true ? 'Indoor' : c.indoor === false ? 'Outdoor' : '';
  const parts = [`${io ? io + ' ' + surf : cap(surf)} court${c.altitude != null ? ` at ${c.altitude} m above sea level` : ''}.`];
  const hd = holdOf(c);
  if (hd) parts.push(`Servers held ${Math.round(hd.pct)}% of their service games here in the main draw (${hd.span}).`);
  const fs = firstServeOf(c);
  if (fs) parts.push(`They won ${Math.round(fs.pct)}% of their first-serve points (${fs.span}).`);
  const sp = speedOf(c.name);
  if (sp != null) parts.push(`Tennis Abstract rates the court ${speedLabel(sp).toLowerCase()} at ${sp.toFixed(2)}.`);
  return parts.join(' ');
}

// ---------------------------------------------------------------- quotes
function quotesOf(c){ return (typeof tourxQuotesFor === 'function' && c) ? (tourxQuotesFor(c.name) || []) : []; }
function qClean(q){ return typeof tourxQuoteClean === 'function' ? tourxQuoteClean(q) : { text: q.quote || q.text || '', context: '' }; }
function qMeta(q){ if (typeof tourxQuoteAttrib === 'function') return tourxQuoteAttrib(q); const ctx = qClean(q).context; return [q.year ? String(q.year) : '', ctx || ''].filter(Boolean).join(' · '); }
// the words through the dashboard's cleaner, curly-quoted and escaped (tourxQuoteText); escaped here when it is absent
function qText(q){ return typeof tourxQuoteText === 'function' ? tourxQuoteText(q) : '“' + esc(qClean(q).text) + '”'; }
function initialsOf(n){ return String(n || '').replace(/[^A-Za-z. \-]/g, '').split(/[ .\-]+/).filter(Boolean).map(p => p[0]).join('').slice(0, 2).toUpperCase() || DASH; }
// newest edition first (the lead quote is the latest year's first), never re-ranked by us
const byYear = list => list.map((q, i) => ({ q, i })).sort((a, b) => (+b.q.year || 0) - (+a.q.year || 0) || a.i - b.i).map(x => x.q);
function quotesCardHtml(c){
  const list = byYear(quotesOf(c));
  // No traceable quote: the card keeps its place with a dash — no link, no click, no invented line.
  if (!list.length) return `<div class="tt-ov-card tt-ov-qcard" data-tt-quotes="0"><div class="tt-ov-hd"><span class="tt-ov-t16">What players say</span></div><div class="tt-ov-ctext tt-ov-dash">${DASH}</div></div>`;
  const lead = list[0];
  return `<div class="tt-ov-card tt-ov-qcard open tt-ov-seg" data-tt-quotes="${list.length}" onclick="TTOverview.openQuotes()">
      <div class="tt-ov-hd"><span class="tt-ov-t16">What players say</span><span class="tt-ov-lnk">Read all ${list.length} ${chev()}</span></div>
      <div class="tt-ov-ctext">${qText(lead)}</div>
      <div class="tt-ov-qfoot"><span class="tt-ov-qby">${esc(lead.player)}</span><span class="tt-ov-qmeta">${esc(qMeta(lead))}</span></div>
    </div>`;
}

// ---------------------------------------------------------------- betting market head + tiles
function yearSelect(which, val, years, fn){
  return `<span class="tt-ov-sel"><select aria-label="${which}" onchange="TTOverview.${fn || 'setYear'}('${which}', this.value)">${(years || YEARS).map(y => `<option value="${y}"${y === val ? ' selected' : ''}>${y}</option>`).join('')}</select><svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="var(--tt-muted)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.5 L5 6.5 L8 3.5"></path></svg></span>`;
}
const signCol = v => { const r = Math.round(v * 10) / 10; return r > 0 ? 'var(--tt-green)' : r < 0 ? 'var(--tt-red)' : 'var(--tt-muted)'; };
function marketHtml(c){
  const mk = market();
  const label = mk.state === 'ok' ? mk.label : (allYears() ? 'every edition on record' : (st.yF === st.yT ? st.yF + ' edition' : st.yF + ' to ' + st.yT));
  const line = `<div class="tt-ov-bm"><span class="tt-ov-bmt"><span class="t">Betting market</span><span class="l">${esc(label)}</span></span>
      <div class="tt-ov-yrs"><label><span class="tt-ov-lab">From</span>${yearSelect('from', st.yF)}</label><label><span class="tt-ov-lab">To</span>${yearSelect('to', st.yT)}</label>${allYears() ? '' : `<span class="tt-ov-reset tt-ov-seg" onclick="TTOverview.resetYears()">All years</span>`}</div></div>`;
  const a = mk.state === 'ok' ? mk.tours[c.name] : null, base = mk.state === 'ok' ? mk.baseline : null;
  const ok = !!(a && a.n >= MIN_MATCHES && base);
  const mktJ = marketData(), mt = mktJ && mktJ.tournaments && mktJ.tournaments[c.name];
  const openable = !!(mt && mt.archiveNames && mt.archiveNames.length);
  const pop = mk.state === 'ok' ? `${mk.span}; Database rows, Pinnacle closing else Bet365 per match; retirements settle on Pinnacle rules` : '';
  const why = mk.state === 'loading' ? 'Loading.' : mk.state === 'failed' ? 'The market figures did not load.'
    : !a ? `No closing prices joined to ${c.name} in our archive${allYears() ? '' : ' for these years'}.` : `Fewer than ${MIN_MATCHES} priced matches at ${c.name} in these years (n = ${fmtN(a.n)}).`;
  const pend = mk.state === 'loading';   // still loading = a blank pending figure, never the em dash that means "no data"
  // The design (ALWAYS GREEN / RED): the yield by its OWN sign, grey only at 0; the gap line by its own sign.
  const roiTile = (label, side, v, avg) => {
    const d = ok ? v - avg : 0;
    const fig = ok ? signed(v, 1) + '%' : pend ? '&nbsp;' : DASH;
    const cmp = ok ? `<span class="m" style="color:${signCol(d)};">${signed(d, 1)}pp</span> vs tour average` : pend ? '&nbsp;' : DASH;
    const tip = 'Flat-stake yield. Click for the graphics by price band.' + (ok ? ` n = ${fmtN(a.n)} matches at ${c.name}, ${pop}. Tour ${signed(avg, 1)}% over ${fmtN(base.n)} matches.` : ' ' + why);
    return `<div class="tt-ov-tile${openable ? ' open tt-ov-seg' : ''}" data-tt-tile="${side}"${openable ? ` onclick="TTOverview.openRoi('${side}')"` : ''} title="${esc(tip)}"><div class="tt-ov-hd"><span class="tt-ov-lab">${label}</span>${openable ? `<span class="go">${chev()}</span>` : ''}</div><div class="tt-ov-tf${ok || pend ? '' : ' tt-ov-dash'}"${pend && !ok ? ' data-tt-pending="1"' : ''}${ok ? ` style="color:${signCol(v)};"` : ''}>${fig}</div><div class="tt-ov-tl">${cmp}</div></div>`;
  };
  // Favourite reliability: printed figure; gap = printed − printed tour (adds up on screen); verdict at ±3pp.
  const rel = ok && a.favRel != null && base.favRel != null;
  const fr = rel ? a.favRel : null, tr = rel ? base.favRel : null, d = rel ? fr - tr : 0;
  const rk = rel ? relRank(mk, c.name) : null;
  const gapCol = !rel ? '' : Math.abs(d) < 1 ? 'color:var(--tt-soft);' : d > 0 ? 'color:var(--tt-green);' : 'color:var(--tt-red);';
  const relTip = rel ? `Share of matches won by the favourite (shorter closing price): ${fr}% over n = ${fmtN(a.nRel)} matches at ${c.name}, ${mk.span}; tour ${tr}% over ${fmtN(base.nRel)}. Retirements count on the official result; walkovers and exact price ties never. Ranked among the ${rk ? rk.of : DASH} events with ${MIN_MATCHES}+ priced matches in the same years.` : why;
  const relTile = `<div class="tt-ov-tile" data-tt-tile="rel" title="${esc(relTip)}">
      <div class="tt-ov-hd"><span class="tt-ov-lab">Favourite reliability</span><span class="tt-ov-verdict">${rel ? (d >= 3 ? 'Reliable' : d <= -3 ? 'Upset-prone' : 'Moderate') : ''}</span></div>
      <div class="tt-ov-rel"><span class="f${rel || pend ? '' : ' tt-ov-dash'}"${pend && !rel ? ' data-tt-pending="1"' : ''}>${rel ? fr + '%' : pend ? '&nbsp;' : DASH}</span>${rel ? `<span class="gp" style="${gapCol}">${(d >= 0 ? '+' : MINUS) + Math.abs(d).toFixed(1)}pp</span><span class="vs">vs tour</span>` : ''}</div>
      <div class="tt-ov-rbar" title="Share of matches won by the favourite. The tick marks the tour average.">${rel ? `<span class="fill" style="width:${Math.max(2, Math.min(100, (fr - 50) / 40 * 100)).toFixed(1)}%;"></span><span class="tick" style="left:${Math.max(2, Math.min(98, (tr - 50) / 40 * 100)).toFixed(1)}%;"></span>` : ''}</div>
      <div class="tt-ov-rfoot"><span>${rk ? ord(rk.rank) + ' of ' + rk.of + ' tournaments' : pend ? '&nbsp;' : DASH}</span><span>${rel ? 'tour ' + tr + '%' : ''}</span></div>
    </div>`;
  return line + `<div class="tt-ov-tiles">${roiTile('Backing favourites', 'fav', a && a.roiFav, base && base.roiFav)}${roiTile('Backing underdogs', 'dog', a && a.roiDog, base && base.roiDog)}${relTile}</div>`;
}

// ---------------------------------------------------------------- render: detail
function detailHtml(c){
  if (!c) return `<div class="tt-ov-detail"><div class="tt-ov-sub">${DASH}</div></div>`;
  return `<div class="tt-ov-detail">
      ${headHtml(c)}
      <div class="tt-ov-stack">
        ${speedCardHtml(c)}
        ${speedYearsHtml(c)}
        <div class="tt-ov-two"><div class="tt-ov-card tt-ov-cond"><div class="tt-ov-t16">Conditions read</div><div class="tt-ov-ctext">${esc(conditionsText(c))}</div></div>${quotesCardHtml(c)}</div>
        ${marketHtml(c)}
        ${c.hasReport ? `<div><span class="tt-ov-cta tt-ov-seg" onclick="tourxOpenReport('${jsq(c.name)}')">View tournament report ${chev()}</span></div>` : ''}
      </div>
    </div>`;
}

function render(el){
  injectCss();
  if (el) st.el = el;
  if (!st.el) return;
  loadHip(); loadHold(); loadCsh(); loadLogos();
  const ts = tstate();
  if (!events().some(t => t.name === ts.tsSel)) ts.tsSel = 'Wimbledon';
  const prevList = st.el.querySelector && st.el.querySelector('.tt-ov-list');
  const keepTop = prevList ? prevList.scrollTop : 0;
  const focused = typeof document !== 'undefined' && document.activeElement && document.activeElement.id === 'ttOvSearch';
  st.el.innerHTML = `<div class="tt-ov"><div class="tt-ov-grid">${railHtml()}${detailHtml(resolve(ts.tsSel))}</div></div>`;
  const list = st.el.querySelector && st.el.querySelector('.tt-ov-list');
  if (list) list.scrollTop = keepTop;
  if (focused) { const inp = document.getElementById('ttOvSearch'); if (inp) { inp.focus({ preventScroll: true }); const v = inp.value; inp.setSelectionRange(v.length, v.length); } }
  renderOverlays();
}
function rerender(){
  if (!st.el) return;
  const ts = tstate();
  if (ts.section && ts.section !== 'overview' && ts.section !== 'stats') { renderOverlays(); return; }
  render();
}

// ---------------------------------------------------------------- boxes
function overlayRoot(){ return typeof document !== 'undefined' && document.getElementById ? document.getElementById('tourxOverlayRoot') : null; }
const closeBtn = q => `<span class="tt-ov-x${q ? ' q' : ''} tt-ov-seg" title="Close" onclick="tourxCloseOverlays()"><svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="var(--tt-soft)" stroke-width="1.6" stroke-linecap="round"><path d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5"></path></svg></span>`;
// Compare all, CPI view: the nine Masters 1000, one column per year IN RANGE that has a reading (a missing reading is an
// empty cell), ranked by the latest reading in range; From / To span every year the file holds.
function cpiModel(){
  const series = CPI_EVENTS.map(([name, surface]) => ({ name, surface, s: cpiSeries(name) })).filter(r => r.s);
  const allY = [...new Set([].concat(...series.map(r => Object.keys(r.s).map(Number))))].sort((a, b) => a - b);
  let f = st.spF, t = st.spT; if (f > t) { const x = f; f = t; t = x; }
  const ys = allY.filter(y => y >= f && y <= t);
  const selKey = CPI_KEY(tstate().tsSel);
  const rows = series.map(r => {
    let ly = null; ys.forEach(y => { if (r.s[y] != null) ly = y; });
    return ly == null ? null : { name: r.name, surface: r.surface, s: r.s, ly, last: r.s[ly], on: r.name === selKey };
  }).filter(Boolean).sort((a, b) => b.last - a.last);
  return { allY, ys, rows, f, t };
}
function cpiTableHtml(){
  const m = cpiModel();
  const cols = '22px minmax(130px,1.2fr) minmax(70px,1fr) ' + (m.ys.length ? 'repeat(' + m.ys.length + ',52px) ' : '') + '104px';
  const head = `<div class="tt-ov-cph" style="grid-template-columns:${cols};"><span></span><span>Tournament</span><span>Latest reading</span>${m.ys.map(y => `<span class="y">${y}</span>`).join('')}<span style="text-align:right;">Band</span></div>`;
  const rows = m.rows.map((r, i) => `<div class="tt-ov-cpr${r.on ? ' on' : ''}" style="grid-template-columns:${cols};" title="${esc(r.name + ' · ' + CPI_CREDIT)}"><span class="rk">${i + 1}</span><span class="nm"><b>${esc(r.name)}</b><i>${esc(r.surface)}</i></span><span class="tt-ov-bar"><span style="width:${Math.max(4, Math.min(100, (r.last - 20) / 30 * 100)).toFixed(1)}%;"></span></span>${m.ys.map(y => `<span class="c${y === r.ly ? ' last' : ''}">${r.s[y] != null ? r.s[y].toFixed(1) : ''}</span>`).join('')}<span class="tt-ov-pchip">${cpiBand(r.last)}</span></div>`).join('');
  return `<div class="tt-ov-cpbody"><div style="min-width:640px;">${head}${rows}${m.rows.length ? '' : '<div style="padding:28px 10px;font-size:13px;color:var(--tt-muted);">No reading in these years.</div>'}</div></div>`;
}
function speedBoxHtml(){
  const ts = tstate(), S2 = speedStats();
  const cpiOn = st.spMetric === 'cpi' && !!(st.csh && st.csh.cpi);
  const court = t => (t.indoor ? 'Indoor' : t.surface === 'hard' ? 'Outdoor hard' : t.surface === 'clay' ? 'Clay' : t.surface === 'grass' ? 'Grass' : null);
  const flat = events().map(t => ({ name: t.name, sp: speedOf(t.name), court: court(t), on: t.name === ts.tsSel })).filter(r => r.court);
  const ranked = flat.filter(r => r.sp != null).sort((a, b) => b.sp - a.sp);
  ranked.forEach((r, i) => { r.rank = i + 1; });
  const pct = v => (v == null || S2.lo == null ? '0%' : Math.max(3, (v - S2.lo) / ((S2.hi - S2.lo) || 1) * 100).toFixed(1) + '%');
  const cols = ['Indoor', 'Outdoor hard', 'Clay', 'Grass'].map(cn => {
    const rs = flat.filter(r => r.court === cn).sort((a, b) => (b.sp == null ? -1 : b.sp) - (a.sp == null ? -1 : a.sp));
    const med = median(rs.filter(r => r.sp != null).map(r => r.sp));
    const rows = rs.map(r => `<div class="tt-ov-sprow${r.on ? ' on' : ''}" title="${esc(r.name + ' · ' + (r.rank ? ord(r.rank) + ' fastest of ' + ranked.length : 'no court-speed figure of our own'))}"><span class="rk">${r.rank || DASH}</span><span class="nm">${esc(r.name)}</span><span class="tt-ov-bar"><span style="width:${pct(r.sp)};"></span></span><span class="v${r.sp == null ? ' tt-ov-dash' : ''}">${r.sp == null ? DASH : r.sp.toFixed(2)}</span></div>`).join('');
    return `<div class="tt-ov-spcol"><div class="tt-ov-spch"><div class="l">${cn}</div><div class="m">${rs.length} events · median ${med == null ? DASH : med.toFixed(2)}</div></div>${rows}</div>`;
  }).join('');
  const sel = flat.find(r => r.on);
  const gap = sel && sel.sp != null && S2.med != null ? sel.sp - S2.med : null;
  const strip = sel ? `<div class="tt-ov-strip"><span class="nm">${esc(sel.name)}</span><span class="sp${sel.sp == null ? ' tt-ov-dash' : ''}">${sel.sp == null ? DASH : sel.sp.toFixed(2)}</span><span class="rk">${sel.rank ? ord(sel.rank) : DASH} fastest of ${ranked.length || DASH} · ${sel.court}</span><span class="gp"><span class="m" style="color:${gap == null || Math.abs(gap) < 0.005 ? 'var(--tt-muted)' : gap > 0 ? 'var(--tt-green)' : 'var(--tt-red)'};">${gap != null ? (gap >= 0 ? '+' : MINUS) + Math.abs(gap).toFixed(2) : DASH}</span> vs tour median</span></div>` : '';
  const m = cpiOn ? cpiModel() : null;
  const sub = cpiOn ? `${m.rows.length} Masters 1000 events · ranked by the latest reading in ${m.f === m.t ? m.f : m.f + '–' + m.t} · higher is faster` : `${flat.length} events · tour median ${S2.med != null ? S2.med.toFixed(2) : DASH}`;
  const sw = st.csh && st.csh.cpi ? `<span class="tt-ov-sw" style="flex:none;">${[['speed', 'Speed index'], ['cpi', 'CPI']].map(x => `<span class="tt-ov-seg${(x[0] === 'cpi') === cpiOn ? ' on' : ''}" style="padding:6px 14px;" onclick="TTOverview.spMetric('${x[0]}')">${x[1]}</span>`).join('')}</span>` : '';
  const yrs = cpiOn ? `<div class="tt-ov-cpyrs tt-ov-yrs"><label><span class="tt-ov-lab">From</span>${yearSelect('from', st.spF, m.allY, 'spYear')}</label><label><span class="tt-ov-lab">To</span>${yearSelect('to', st.spT, m.allY, 'spYear')}</label></div>` : '';
  const credit = cpiOn ? CPI_CREDIT : TT_SPEED_SOURCE === 'ta' ? SPEED_CREDIT : '';
  return `<div class="tt-ov-scrim" data-tourx-scrim="1"><div class="tt-ov-sheet" role="dialog" aria-modal="true" aria-label="Court speed" style="max-width:1240px;"${credit ? ` title="${esc(credit)}"` : ''}>
      <div class="tt-ov-shd"><div class="tt-ov-shrow"><div style="flex:1 1 220px;min-width:0;"><div class="tt-ov-sht">Court speed</div><div class="tt-ov-shs">${esc(sub)}</div></div>${sw}${closeBtn()}</div>${cpiOn ? yrs : strip}</div>
      ${cpiOn ? cpiTableHtml() : `<div class="tt-ov-sbody"><div class="tt-ov-speedgrid">${cols}</div></div>`}
    </div></div>`;
}
function quotesBoxHtml(){
  const c = resolve(tstate().tsSel), all = byYear(quotesOf(c));
  if (!c || !all.length) return '';
  // one pill per edition that has a quote (a year with none is not offered)
  const years = [...new Set(all.map(q => q.year).filter(Boolean).map(String))].sort((a, b) => b - a);
  if (st.quoteYear !== 'all' && !years.includes(st.quoteYear)) st.quoteYear = 'all';
  const shown = st.quoteYear === 'all' ? all : all.filter(q => String(q.year) === st.quoteYear);
  const as = y => { const v = speedYearOf(c.name, +y); return v == null ? DASH : v.toFixed(2); };
  const pill = (k, label) => `<span class="tt-ov-pill tt-ov-seg${st.quoteYear === k ? ' on' : ''}" onclick="TTOverview.quoteYear('${k}')">${label}</span>`;
  const rows = shown.map(q => {
    const ctx = qClean(q).context;
    const photo = q.playerKey != null && typeof playerPhotoImg === 'function' ? playerPhotoImg(String(q.playerKey), q.player) : '';
    return `<div class="tt-ov-qrow"><div class="tt-ov-qwho"><span class="tt-ov-av">${esc(initialsOf(q.player))}${photo}</span><span class="tt-ov-qn"><span class="p">${esc(q.player)}</span><span class="w"><span class="y">${esc(q.year || '')}</span>${ctx ? ' · ' + esc(cap(ctx)) : ''}</span></span></div><div class="tt-ov-qt">${qText(q)}</div></div>`;
  }).join('');
  return `<div class="tt-ov-scrim" data-tourx-scrim="1"><div class="tt-ov-sheet" role="dialog" aria-modal="true" aria-label="What players say" style="max-width:860px;">
      <div class="tt-ov-shd q"><div class="tt-ov-shrow"><div style="flex:1;min-width:0;"><div class="tt-ov-sht">What players say</div><div class="tt-ov-shs">${esc(c.name)} · ${shown.length} ${shown.length === 1 ? 'quote' : 'quotes'} about the courts and conditions</div></div>${closeBtn(true)}</div>
        <div class="tt-ov-pills" title="${esc('AS = ' + SPEED_CREDIT + ' that season')}">${pill('all', 'All years')}${years.map(y => pill(y, `${y} · AS ${as(y)}`)).join('')}</div></div>
      <div class="tt-ov-qbody">${rows}</div>
    </div></div>`;
}
function roiBoxHtml(){
  const ts = tstate(), c = resolve(ts.tsSel);
  if (!c) return '';
  const dog = ts.roiPanel === 'dog';
  // data-page="database" is load-bearing: the Database page's --db-* properties are declared on it (as the live embed).
  const body = `<div data-db-root="roi" data-page="database" class="pagewrap">
      <div class="sfh db-headcard" data-db="head"><div class="sfh__text"><h1 class="sfh__title">Database</h1><p class="sfh__sub" data-db="subtitle"></p></div><div class="sfh__stats" data-db="fresh"></div></div>
      <div class="db-ctl" data-db="ctl"><div class="db-ctltop"><div class="db-seg" data-db="viewtabs"><button data-dbview="tour">Tour</button><button class="active" data-dbview="tournaments">Tournaments</button><button data-dbview="players">Players</button></div></div><div class="db-ctlbot" data-db="filters"></div></div>
      <div data-db="body"><div class="db-loading">Loading archive…</div></div>
    </div>`;
  return `<div class="tt-ov-scrim top" data-tourx-scrim="1"><div class="tt-ov-sheet roi" role="dialog" aria-modal="true" aria-label="${esc(c.name)} · ${dog ? 'Backing underdogs' : 'Backing favourites'}">
      <div class="tt-ov-shd"><div class="tt-ov-shrow"><div style="flex:1 1 260px;min-width:0;"><div class="tt-ov-sht">${esc(c.name)} · ${dog ? 'Backing underdogs' : 'Backing favourites'}</div><div class="tt-ov-shs">Flat 1% stake on every ${dog ? 'underdog' : 'favourite'} · yields by price band below</div></div>${closeBtn()}</div></div>
      ${body}
    </div></div>`;
}
function renderOverlays(){
  const rootEl = overlayRoot();
  if (!rootEl) return;
  const ts = tstate();
  const now = ts.speedPanel ? 'speed' : ts.quotesPanel ? 'quotes' : ts.roiPanel ? 'roi:' + ts.roiPanel + ':' + ts.tsSel + ':' + st.yF + '-' + st.yT : '';
  // the Database panel is a MOUNTED page: built when it opens (or its event / window changes), never rebuilt on a repaint
  if (now.startsWith('roi') && rootEl.getAttribute('data-tt-ov') === now && rootEl.querySelector('[data-db-root="roi"]')) return;
  rootEl.innerHTML = ts.speedPanel ? speedBoxHtml() : ts.quotesPanel ? quotesBoxHtml() : ts.roiPanel ? roiBoxHtml() : '';
  rootEl.setAttribute('data-tt-ov', now);
  if (ts.roiPanel && root.DatabaseTab && root.DatabaseTab.mount) {
    const host = rootEl.querySelector('[data-db-root="roi"]');
    const c = resolve(ts.tsSel), mkt = c && typeof tourxMarketFor === 'function' ? tourxMarketFor(c.name) : null;
    const names = mkt && mkt.archiveNames;
    // no archive names = no honest panel (never the catalog name as a guess). The body reads the SAME rows and window as
    // the tiles: database-yield.json, and the From / To window (all years = no year filter, as tournament-market.json).
    if (host && c && names && names.length) root.DatabaseTab.mount(host, { hideHeader: true, lockSubject: true, initialTournamentNames: names,
      initialTournamentFilter: mkt.archiveFilter || null, initialTournamentLabel: c.name, side: ts.roiPanel,
      initialYearMin: allYears() ? null : st.yF, initialYearMax: allYears() ? null : st.yT });
  }
}

// ---------------------------------------------------------------- actions
const api = {
  render,
  renderOverlays,
  select(name){ tstate().tsSel = name; render(); },
  search(v){ const ts = tstate(); ts.tsQ = v; ts.tsOpen = true; render(); },
  setYear(which, v){
    v = +v;
    if (which === 'from') { st.yF = v; st.yT = Math.max(v, st.yT); } else { st.yT = v; st.yF = Math.min(v, st.yF); }
    render();
  },
  resetYears(){ st.yF = 2020; st.yT = 2026; render(); },
  metric(m){ st.ovMetric = m; render(); },
  spMetric(m){ st.spMetric = m; renderOverlays(); },
  spYear(which, v){ v = +v; if (which === 'from') { st.spF = v; st.spT = Math.max(v, st.spT); } else { st.spT = v; st.spF = Math.min(v, st.spF); } renderOverlays(); },
  quoteYear(y){ st.quoteYear = y; renderOverlays(); },
  // the box opens on CPI when the overview chart is on CPI (design onOpenSpeeds)
  openSpeeds(){ const ts = tstate(); st.spMetric = st.ovMetric === 'cpi' && cpiOf(resolve(ts.tsSel)) ? 'cpi' : 'speed'; ts.speedPanel = true; ts.quotesPanel = false; ts.roiPanel = null; renderOverlays(); },
  openQuotes(){ const ts = tstate(); st.quoteYear = 'all'; ts.quotesPanel = true; ts.speedPanel = false; ts.roiPanel = null; renderOverlays(); },
  openRoi(side){ const ts = tstate(); ts.roiPanel = side; ts.speedPanel = false; ts.quotesPanel = false; renderOverlays(); },
  _internals: { aggRows, taggedRows, marketModel, relRank, speedLabel, speedOf, speedYearOf, speedStats, conditionsText, holdOf, firstServeOf, cpiOf, cpiSeries, cpiModel, logoFileOf, tierCode, events, market, state: st,
    railHtml, headHtml, speedCardHtml, speedYearsHtml, quotesCardHtml, marketHtml, detailHtml, speedBoxHtml, quotesBoxHtml, roiBoxHtml, CSS, TT_SPEED_SOURCE },
};
root.TTOverview = api;
}(typeof window !== 'undefined' ? window : globalThis));
