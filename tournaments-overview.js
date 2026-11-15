// Tournaments tab rebuild (design_handoff_tournaments_tab, founder 2026-11-15 "Design wins"). Owner: the TTOverview builder.
// Built here: the page shell (header card, top tabs, content shell — styled inside the page scope only), the Overview
// (rail · court speed · speed by year · Conditions read · What players say · Betting market + From / To · three tiles ·
// report button) and its three overlays (Court speed box · What players say box · Betting market detail).
// Spec: prototype/Tournaments.dc.html L9–56, L542–613, L646–725 (inline styles); colours through the page palette
// (tournaments-tab.css) and the --tt-* tokens; no raw colour.
//
// DATA (feasibility table, inventory v1-4 §4; founder rulings 2026-11-15):
//   rail / title         TOURNAMENT_CATALOG + COURT_CONDITIONS (tourxOverviewEvents), "This week" = tourxActiveWeekNames()
//   court speed          TT_SPEED_SOURCE: 'own' (default) = every speed figure is a dash — we hold no court-speed figure of
//                        our own (ruling 4). 'ta' = the Tennis Abstract readings in COURT_CONDITIONS, credited on hover.
//   Altitude             COURT_CONDITIONS.altitude (a fact)
//   1st serve points won how-it-plays.json past.metrics.firstServeWon (num / den, n matches) — hard courts only
//   Service hold         event-hold.json held / games (our box scores, main draw, every edition on file)
//   Betting market       tournament-market.json (all years); a From / To window recomputes every figure — event, tour
//                        baseline and rank — from database-yield.json rows through settlement.js, exactly as
//                        build-tournament-market.js aggRows does (never an offset).
//   What players say     tournament-quotes.json through tourxQuotesFor (traceable notes only) + tourxQuoteClean
(function (root) {
'use strict';

// ONE switch (founder ruling 4, 2026-11-15): 'own' = our data only (dashes); 'ta' = the live Tennis Abstract figures.
const TT_SPEED_SOURCE = (root && root.TT_SPEED_SOURCE) || 'own';
const YEARS = [2020, 2021, 2022, 2023, 2024, 2025, 2026];   // the design's From / To options
const MIN_MATCHES = 30;                                        // tournament-market.json minMatches (build-tournament-market.js)
const DASH = '—', MINUS = '−';
const H = "'Hanken Grotesk',sans-serif", M = "'IBM Plex Mono',monospace";
const W = n => `color-mix(in srgb, var(--tt-white) ${n}%, transparent)`;
const B = n => `color-mix(in srgb, var(--tt-blue) ${n}%, transparent)`;
const S = '.tabpage[data-page="tournaments"]';

// ---------------------------------------------------------------- state
const st = { el: null, yF: 2020, yT: 2026, quoteYear: 'all', hip: undefined, hipP: null, db: undefined, dbP: null, _model: null };

// ---------------------------------------------------------------- tiny helpers
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const jsq = s => esc(String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
const ord = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const median = a => { if (!a.length) return null; const s = a.slice().sort((p, q) => p - q); return (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2; };
const signed = (v, dp) => { const r = Number(Math.abs(v).toFixed(dp)); return (r === 0 ? '' : v > 0 ? '+' : MINUS) + r.toFixed(dp); };
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '');
const fmtN = n => Number(n).toLocaleString('en-US');
const chev = () => '<svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 2 L6.5 5 L3.5 8"></path></svg>';

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
function speedOf(name){
  if (TT_SPEED_SOURCE !== 'ta') return null;
  const c = conds()[name];
  return c && c.abstractSpeed != null ? c.abstractSpeed : null;
}
function speedYearOf(name, y){
  if (TT_SPEED_SOURCE !== 'ta') return null;
  const c = conds()[name], v = c ? c['as' + y] : null;
  return v == null ? null : v;
}
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
// 1st serve points won at this event, every past edition on file (how-it-plays.json; hard courts only).
function firstServeOf(c){
  const e = hipEventOf(c), m = e && e.past && e.past.metrics && e.past.metrics.firstServeWon;
  if (!m || !(m.den > 0)) return null;
  return { pct: 100 * m.num / m.den, num: m.num, den: m.den, n: m.n, span: span(e.past.years) };
}
function loadHold(){ if (holdData() === undefined && typeof trHoldLoad === 'function') trHoldLoad().then(rerender); }
// Service hold at this event: our box scores, every edition on file (event-hold.json), n = service games.
function holdOf(c){
  const d = holdData();
  if (!d || !d.events || !c) return null;
  let e = null;
  for (const k of (c.tournamentKeys || [])) if (d.events[k]) { e = d.events[k]; break; }
  if (!e && d.byName) { const k = d.byName[String(c.name).toLowerCase()]; if (k != null) e = d.events[k]; }
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
const CSS = [
  // ---- page shell: header card (.sfh markup stays), top tabs, content shell
  `${P}.tourx-head.sfh{ background:var(--card); box-shadow:none; border:1.25px solid ${W(6)}; }`,
  `${P}.tourx-head .sfh__sub{ color:var(--text-label); }`,
  `${P}.tourx-head .sfh__stats{ align-items:flex-start; }`,
  `${P}.tourx-head .sfh__stat{ display:block; text-align:right; }`,
  `${P}.tourx-head .sfh__l{ display:block; }`,
  `${P}.tourx-head .sfh__v{ display:block; margin-top:6px; color:var(--text); }`,
  `@media (max-width:899px){ ${P}.tourx-head.sfh{ flex-wrap:nowrap; } ${P}.tourx-head .sfh__stats{ flex:none; flex-wrap:nowrap; gap:30px; } ${P}.tourx-head .sfh__stat{ align-items:flex-end; } }`,
  `${P}.sf-seg.tt-tabs{ display:inline-flex; align-self:flex-start; width:fit-content; gap:3px; background:var(--inner); border:1px solid ${W(6)}; border-radius:10px; padding:3px; }`,
  `${P}.sf-seg.tt-tabs .sf-seg__opt{ font-family:${H}; font-size:12.5px; font-weight:600; line-height:normal; color:var(--text-label); background:transparent; border:1px solid transparent; border-radius:8px; padding:6px 16px; white-space:nowrap; display:inline-block; transition:background .14s ease, color .14s ease, border-color .14s ease; }`,
  `${P}.sf-seg.tt-tabs .sf-seg__opt.on{ background:var(--selected); border-color:${W(16)}; color:var(--tt-white); font-weight:700; }`,
  `${P}.tourx-head.sfh, ${P}.sf-seg.tt-tabs, ${P}.tourx-shell{ font-size:16px; line-height:normal; }`,
  `${P}.tourx-shell{ border:1.25px solid ${W(6)}; border-radius:12px; background:var(--card); overflow:hidden; }`,
  `${P}#tourListView #tourxOverview, ${P}#tourListView #tourxEntry{ border:0; box-shadow:none; border-radius:0; background:transparent; overflow:visible; }`,
  // ---- Overview root
  `${P}.tt-ov{ font-family:${H}; font-size:16px; line-height:normal; color:var(--text); padding:22px 24px; -webkit-font-smoothing:antialiased; }`,
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
  // detail column
  `${P}.tt-ov-detail{ display:flex; flex-direction:column; gap:16px; min-width:0; padding-left:24px; padding-right:0; }`,
  `${P}.tt-ov-stack{ display:flex; flex-direction:column; gap:16px; }`,
  `${P}.tt-ov-ttl{ display:flex; align-items:center; gap:11px; }`,
  `${P}.tt-ov-name{ font-size:29px; font-weight:800; letter-spacing:-0.015em; }`,
  `${P}.tt-ov-badge{ font-family:${H}; font-size:10.5px; font-weight:700; letter-spacing:0.10em; text-transform:uppercase; color:var(--text-label); background:var(--selected); border:1px solid ${W(16)}; border-radius:6px; padding:3px 10px; }`,
  `${P}.tt-ov-sub{ font-size:13px; color:var(--text-label); margin-top:6px; }`,
  `${P}.tt-ov-card{ background:var(--inner); border:1.25px solid ${W(6)}; border-radius:14px; }`,
  `${P}.tt-ov-cap{ font-size:10.5px; font-weight:700; letter-spacing:0.10em; text-transform:uppercase; color:var(--text-label); }`,
  `${P}.tt-ov-lnk{ display:inline-flex; align-items:center; gap:6px; font-size:11.5px; font-weight:700; color:var(--link); white-space:nowrap; }`,
  `${P}.tt-ov .tt-ov-dash.tt-ov-dash, ${P}.tt-ov-scrim .tt-ov-dash.tt-ov-dash{ color:var(--text-label); }`,
  // court speed card
  `${P}.tt-ov-speed{ display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:0 40px; padding:22px 24px; }`,
  `${P}.tt-ov-sl{ min-width:0; padding:2px 0 4px; }`,
  `${P}.tt-ov-hd{ display:flex; align-items:center; justify-content:space-between; gap:12px; }`,
  `${P}.tt-ov-fig{ display:flex; align-items:baseline; gap:14px; margin-top:16px; }`,
  `${P}.tt-ov-fig48{ font-family:${M}; font-size:48px; font-weight:700; line-height:0.9; letter-spacing:-0.02em; font-variant-numeric:tabular-nums; }`,
  `${P}.tt-ov-band{ font-size:15px; font-weight:700; color:var(--text); }`,
  `${P}.tt-ov-track{ position:relative; height:6px; border-radius:4px; background:${W(7)}; margin-top:26px; cursor:pointer; }`,
  `${P}.tt-ov-track .fill{ position:absolute; left:0; top:0; bottom:0; border-radius:4px; background:var(--tt-past); }`,
  `${P}.tt-ov-track .med{ position:absolute; top:-5px; bottom:-5px; width:2px; background:var(--text-soft); transform:translateX(-50%); }`,
  `${P}.tt-ov-track .knob{ position:absolute; top:50%; width:14px; height:14px; border-radius:50%; background:var(--tt-blue); border:3px solid var(--inner); box-shadow:0 0 0 1px ${B(50)}; transform:translate(-50%,-50%); }`,
  `${P}.tt-ov-scale{ display:flex; justify-content:space-between; margin-top:11px; font-size:10.5px; font-weight:700; letter-spacing:0.10em; text-transform:uppercase; color:var(--text-label); }`,
  `${P}.tt-ov-rank{ margin-top:14px; font-size:12.5px; color:var(--text-label); }`,
  `${P}.tt-ov-rank .m{ font-family:${M}; color:var(--text-soft); }`,
  `${P}.tt-ov-sr{ min-width:0; display:flex; flex-direction:column; justify-content:center; }`,
  `${P}.tt-ov-kv{ display:flex; align-items:baseline; justify-content:space-between; gap:16px; padding:15px 0; }`,
  `${P}.tt-ov-kv + .tt-ov-kv{ border-top:1px solid ${W(6)}; }`,
  `${P}.tt-ov-kv .k{ font-size:13px; color:var(--text-soft); }`,
  `${P}.tt-ov-kv .v{ display:inline-flex; align-items:baseline; gap:5px; }`,
  `${P}.tt-ov-kv .n{ font-family:${M}; font-size:20px; font-weight:700; line-height:1; font-variant-numeric:tabular-nums; }`,
  `${P}.tt-ov-kv .u{ width:15px; font-size:12.5px; font-weight:600; color:var(--text-label); }`,
  // speed by year
  `${P}.tt-ov-yr{ padding:20px 24px 20px; }`,
  `${P}.tt-ov-yrhd{ display:flex; align-items:baseline; justify-content:space-between; gap:12px; flex-wrap:wrap; }`,
  `${P}.tt-ov-trend{ display:inline-flex; align-items:baseline; gap:10px; }`,
  `${P}.tt-ov-trend .w{ font-size:15px; font-weight:700; }`,
  `${P}.tt-ov-trend .d{ font-family:${M}; font-size:12.5px; color:var(--text-label); }`,
  `${P}.tt-ov-plot{ position:relative; height:112px; margin-top:26px; }`,
  `${P}.tt-ov-plot svg{ position:absolute; inset:0; display:block; }`,
  `${P}.tt-ov-dot{ position:absolute; width:9px; height:9px; border-radius:50%; background:var(--inner); border:2px solid var(--tt-white); transform:translate(-50%,-50%); }`,
  `${P}.tt-ov-pv{ position:absolute; transform:translate(-50%,calc(-100% - 11px)); font-family:${M}; font-size:12.5px; font-weight:700; color:var(--text); white-space:nowrap; }`,
  `${P}.tt-ov-py{ position:absolute; bottom:0; transform:translateX(-50%); font-family:${M}; font-size:11px; letter-spacing:0.06em; color:var(--text-label); }`,
  // conditions + quotes
  `${P}.tt-ov-two{ display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:16px; }`,
  `${P}.tt-ov-cond{ padding:20px 24px 22px; }`,
  `${P}.tt-ov-ctext{ font-size:13.5px; line-height:1.7; color:var(--text); text-wrap:pretty; margin-top:12px; }`,
  `${P}.tt-ov-qcard{ padding:20px 24px 22px; display:flex; flex-direction:column; }`,
  `${P}.tt-ov-qcard.open{ cursor:pointer; }`,
  `${P}.tt-ov-qcard.open:hover{ border-color:${W(16)}; }`,
  `${P}.tt-ov-qlead{ margin-top:12px; font-size:13.5px; line-height:1.7; color:var(--text-soft); text-wrap:pretty; }`,
  `${P}.tt-ov-qfoot{ margin-top:auto; padding-top:12px; display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }`,
  `${P}.tt-ov-qby{ font-size:12.5px; font-weight:700; color:var(--text); }`,
  `${P}.tt-ov-qmeta{ font-size:12px; color:var(--text-label); }`,
  // betting market line
  `${P}.tt-ov-bm{ display:flex; align-items:center; justify-content:space-between; gap:12px 20px; flex-wrap:wrap; padding-top:8px; }`,
  `${P}.tt-ov-bmt{ display:flex; align-items:baseline; gap:12px; }`,
  `${P}.tt-ov-bmt .t{ font-size:17px; font-weight:700; }`,
  `${P}.tt-ov-bmt .l{ font-size:12.5px; color:var(--text-label); }`,
  `${P}.tt-ov-yrs{ display:flex; align-items:center; gap:10px 16px; flex-wrap:wrap; }`,
  `${P}.tt-ov-yrs label{ display:inline-flex; align-items:center; gap:9px; margin:0; }`,
  `${P}.tt-ov-sel{ position:relative; display:inline-flex; }`,
  `${P}.tt-ov-sel select{ appearance:none; -webkit-appearance:none; background:var(--inner); border:1px solid ${W(14)}; border-radius:8px; padding:7px 30px 7px 12px; font-family:${M}; font-size:12.5px; font-weight:700; color:var(--text); cursor:pointer; outline:none; margin:0; line-height:normal; height:auto; }`,
  `${P}.tt-ov-sel svg{ position:absolute; right:11px; top:50%; transform:translateY(-50%); pointer-events:none; }`,
  `${P}.tt-ov-reset{ font-size:11.5px; font-weight:700; color:var(--link); cursor:pointer; }`,
  // tiles
  `${P}.tt-ov-tiles{ display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:16px; }`,
  `${P}.tt-ov-tile{ padding:18px 20px; }`,
  `${P}.tt-ov-tile.open{ cursor:pointer; }`,
  `${P}.tt-ov-tile.open:hover{ border-color:${W(16)}; }`,
  `${P}.tt-ov-tf{ font-family:${M}; font-size:26px; font-weight:700; line-height:1; margin-top:14px; font-variant-numeric:tabular-nums; }`,
  `${P}.tt-ov-tl{ font-size:12px; color:var(--text-label); margin-top:9px; }`,
  `${P}.tt-ov-verdict{ font-size:11.5px; font-weight:700; color:var(--text-soft); white-space:nowrap; }`,
  `${P}.tt-ov-rel{ display:flex; align-items:baseline; gap:10px; margin-top:14px; }`,
  `${P}.tt-ov-rel .f{ font-family:${M}; font-size:26px; font-weight:700; line-height:1; font-variant-numeric:tabular-nums; }`,
  `${P}.tt-ov-rel .gp{ font-family:${M}; font-size:13px; font-weight:700; }`,
  `${P}.tt-ov-rel .vs{ font-size:12px; color:var(--text-label); }`,
  `${P}.tt-ov-rbar{ position:relative; height:4px; border-radius:4px; background:${W(6)}; margin-top:14px; }`,
  `${P}.tt-ov-rbar .fill{ position:absolute; left:0; top:0; bottom:0; background:var(--tt-past); border-radius:4px; }`,
  `${P}.tt-ov-rbar .tick{ position:absolute; top:-4px; bottom:-4px; width:2px; background:var(--text); transform:translateX(-50%); }`,
  `${P}.tt-ov-rfoot{ display:flex; justify-content:space-between; gap:10px; margin-top:11px; font-size:12px; color:var(--text-label); }`,
  `${P}.tt-ov-cta{ display:inline-flex; align-items:center; gap:8px; font-size:13px; font-weight:700; color:var(--text); padding:9px 15px; border:1px solid ${W(16)}; border-radius:9px; cursor:pointer; }`,
  `${P}.tt-ov-cta:hover{ background:${W(5)}; }`,
  // ---- overlays (the design's scrim covers the rail: inset 0)
  `${P}.tt-ov-scrim{ position:fixed; inset:0; z-index:90; background:var(--tt-scrim); display:flex; align-items:center; justify-content:center; padding:32px 22px; font-family:${H}; font-size:16px; line-height:normal; color:var(--text); -webkit-font-smoothing:antialiased; }`,
  `${P}.tt-ov-scrim.top{ z-index:85; align-items:flex-start; overflow:auto; padding:34px 22px 60px; }`,
  `${P}.tt-ov-sheet{ width:100%; max-height:100%; display:flex; flex-direction:column; background:var(--card); border:1px solid ${W(12)}; border-radius:16px; box-shadow:var(--tt-shadow-overlay); overflow:hidden; }`,
  `${P}.tt-ov-shd{ flex:none; padding:22px 24px 20px; border-bottom:1px solid ${W(10)}; }`,
  `${P}.tt-ov-shd.q{ padding:22px 24px 18px; border-bottom-color:${W(8)}; }`,
  `${P}.tt-ov-shrow{ display:flex; align-items:flex-start; gap:16px; }`,
  `${P}.tt-ov-sht{ font-size:18px; font-weight:800; letter-spacing:-0.01em; }`,
  `${P}.tt-ov-shs{ font-size:12.5px; color:var(--text-label); margin-top:5px; }`,
  `${P}.tt-ov-x{ flex:none; width:32px; height:32px; border-radius:9px; border:1px solid ${W(12)}; display:flex; align-items:center; justify-content:center; cursor:pointer; }`,
  `${P}.tt-ov-x:hover{ background:${W(6)}; }`,
  `${P}.tt-ov-strip{ display:flex; align-items:baseline; gap:8px 18px; flex-wrap:wrap; margin-top:18px; padding:14px 18px; background:var(--inner); border:1.25px solid ${W(6)}; border-radius:12px; }`,
  `${P}.tt-ov-strip .nm{ font-size:14.5px; font-weight:700; }`,
  `${P}.tt-ov-strip .sp{ font-family:${M}; font-size:21px; font-weight:700; line-height:1; color:var(--tt-blue); font-variant-numeric:tabular-nums; }`,
  `${P}.tt-ov-strip .rk{ font-size:12.5px; color:var(--text-soft); }`,
  `${P}.tt-ov-strip .gp{ margin-left:auto; font-size:12.5px; color:var(--text-label); white-space:nowrap; }`,
  `${P}.tt-ov-strip .gp .m{ font-family:${M}; font-weight:700; color:var(--text-soft); }`,
  `${P}.tt-ov-sbody{ flex:1; min-height:0; overflow-y:auto; }`,
  `${P}.tt-ov-speedgrid{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); align-items:start; }`,
  `${P}.tt-ov-spcol{ min-width:0; border-left:1px solid ${W(7)}; padding-bottom:14px; }`,
  `${P}.tt-ov-spcol:first-child{ border-left-color:transparent; }`,
  `${P}.tt-ov-spch{ position:sticky; top:0; z-index:1; background:var(--card); padding:18px 16px 12px; border-bottom:1px solid ${W(8)}; }`,
  `${P}.tt-ov-spch .l{ font-size:14.5px; font-weight:700; }`,
  `${P}.tt-ov-spch .m{ font-size:12px; color:var(--text-label); margin-top:4px; }`,
  `${P}.tt-ov-sprow{ display:grid; grid-template-columns:20px minmax(0,1fr) 28px 34px; gap:0 8px; align-items:center; min-height:36px; padding:0 16px; background:transparent; }`,
  `${P}.tt-ov-sprow:hover{ box-shadow:inset 0 0 0 999px ${W(3)}; }`,
  `${P}.tt-ov-sprow.on{ background:${B(10)}; }`,
  `${P}.tt-ov-sprow .rk{ font-family:${M}; font-size:10.5px; color:var(--text-label); text-align:right; font-variant-numeric:tabular-nums; }`,
  `${P}.tt-ov-sprow .nm{ font-size:13px; font-weight:600; color:var(--text-soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }`,
  `${P}.tt-ov-sprow.on .nm{ font-weight:700; color:var(--tt-white); }`,
  `${P}.tt-ov-sprow .bar{ position:relative; height:4px; border-radius:4px; background:${W(6)}; }`,
  `${P}.tt-ov-sprow .bar span{ position:absolute; left:0; top:0; bottom:0; background:var(--tt-past); border-radius:4px; }`,
  `${P}.tt-ov-sprow.on .bar span{ background:var(--tt-blue); }`,
  `${P}.tt-ov-sprow .v{ font-family:${M}; font-size:12.5px; font-weight:700; color:var(--text); text-align:right; font-variant-numeric:tabular-nums; }`,
  `${P}.tt-ov-sprow.on .v{ color:var(--tt-blue); }`,
  `@media (max-width:1180px){ ${P}.tt-ov-sprow .bar{ display:none !important; } ${P}.tt-ov-sprow{ grid-template-columns:20px minmax(0,1fr) 34px !important; gap:0 6px !important; padding:0 12px !important; } }`,
  `@media (max-width:860px){ ${P}.tt-ov-speedgrid{ grid-template-columns:repeat(2,minmax(0,1fr)) !important; } ${P}.tt-ov-speedgrid > div:nth-child(odd){ border-left-color:transparent !important; } ${P}.tt-ov-speedgrid > div:nth-child(n+3){ border-top:1px solid ${W(7)}; } }`,
  // quotes box
  `${P}.tt-ov-pills{ display:flex; gap:6px; flex-wrap:wrap; margin-top:16px; }`,
  `${P}.tt-ov-pill{ font-size:11.5px; font-weight:700; color:var(--text-label); background:transparent; border:1px solid ${W(8)}; border-radius:8px; padding:6px 13px; white-space:nowrap; }`,
  `${P}.tt-ov-pill.on{ color:var(--tt-white); background:var(--selected); border-color:${W(16)}; }`,
  `${P}.tt-ov-qbody{ flex:1; min-height:0; overflow-y:auto; padding:0 24px 4px; }`,
  `${P}.tt-ov-qrow{ display:grid; grid-template-columns:236px minmax(0,1fr); gap:0 28px; align-items:start; margin:0 -24px; padding:20px 24px; border-bottom:1px solid ${W(6)}; }`,
  `${P}.tt-ov-qrow:hover{ box-shadow:inset 0 0 0 999px ${W(1.8)}; }`,
  `${P}.tt-ov-qwho{ display:flex; align-items:center; gap:12px; min-width:0; }`,
  `${P}.tt-ov-av{ position:relative; overflow:hidden; flex:none; width:36px; height:36px; border-radius:50%; background:var(--inner); border:1px solid ${W(14)}; display:flex; align-items:center; justify-content:center; font-family:${M}; font-size:11px; font-weight:700; color:var(--text-soft); }`,
  `${P}.tt-ov-av .sf-ph{ position:absolute; inset:0; width:100%; height:100%; object-fit:cover; object-position:center; border-radius:50%; }`,
  `${P}.tt-ov-qn{ min-width:0; display:flex; flex-direction:column; gap:4px; }`,
  `${P}.tt-ov-qn .p{ font-size:13.5px; font-weight:700; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }`,
  `${P}.tt-ov-qn .w{ font-size:12px; color:var(--text-label); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }`,
  `${P}.tt-ov-qn .w .y{ font-family:${M}; color:var(--text-soft); }`,
  `${P}.tt-ov-qt{ font-size:14.5px; line-height:1.65; color:var(--text); text-wrap:pretty; padding-top:1px; }`,
  `${P}.tt-ov-sheet.roi{ max-height:none; border-color:${W(10)}; box-shadow:none; display:block; }`,
  `${P}.tt-ov-roihd{ display:flex; align-items:baseline; gap:14px; padding:18px 22px; border-bottom:1px solid ${W(8)}; }`,
  `${P}.tt-ov-roihd .s{ font-family:${M}; font-size:11.5px; color:var(--text-label); }`,
  `${P}.tt-ov-close{ margin-left:auto; font-size:12.5px; font-weight:700; color:var(--text-label); background:${W(6)}; border:1px solid ${W(12)}; border-radius:8px; padding:8px 14px; cursor:pointer; }`,
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

// ---------------------------------------------------------------- render: court speed card
function speedCardHtml(c){
  const sp = speedOf(c.name), S2 = speedStats();
  const pos = v => Math.max(3, Math.min(97, (v - 0.5) * 100)) + '%';
  const yr = (conds()[c.name] || {}).abstractSpeedYear;
  const credit = ` title="${esc(sp != null ? SPEED_CREDIT + (yr ? ', ' + yr + ' reading' : '') : 'No court-speed figure of our own.')}"`;
  const rank = sp != null ? ord(1 + S2.rated.filter(v => v > sp).length) : DASH;
  const alt = c.altitude != null ? c.altitude : null;
  const fs = firstServeOf(c), hd = holdOf(c);
  const kv = (k, v, unit, tip) => `<div class="tt-ov-kv"><span class="k">${k}</span><span class="v" title="${esc(tip)}"><span class="n${v == null ? ' tt-ov-dash' : ''}">${v == null ? DASH : v}</span><span class="u">${unit}</span></span></div>`;
  const fsTip = fs ? `1st serve points won at ${c.name}: ${fmtN(fs.num)} of ${fmtN(fs.den)} (n = ${fmtN(fs.n)} matches, ${fs.span}), both players, main draw. how-it-plays.json.`
    : (st.hip === undefined ? 'Loading' : `No 1st-serve figure on file for ${c.name} (built for hard-court events only).`);
  const hdTip = hd ? `Service hold at ${c.name}: ${fmtN(hd.held)} of ${fmtN(hd.games)} service games held (n = ${fmtN(hd.games)}, ${fmtN(hd.matches)} matches, ${hd.span}), both players, main draw. Our own box scores.`
    : (holdData() === undefined ? 'Loading' : `No box score on file for ${c.name}, so no hold rate.`);
  return `<div class="tt-ov-card tt-ov-speed">
      <div class="tt-ov-sl">
        <div class="tt-ov-hd"><span class="tt-ov-cap">Court speed</span><span class="tt-ov-lnk tt-ov-seg" onclick="TTOverview.openSpeeds()">Compare all ${chev()}</span></div>
        <div class="tt-ov-fig"><span class="tt-ov-fig48${sp == null ? ' tt-ov-dash' : ''}"${credit}>${sp == null ? DASH : sp.toFixed(2)}</span><span class="tt-ov-band${sp == null ? ' tt-ov-dash' : ''}">${sp == null ? DASH : speedLabel(sp)}</span></div>
        <div class="tt-ov-track tt-ov-seg" onclick="TTOverview.openSpeeds()" title="Abstract court speed. The tick marks the tour median.">${sp != null ? `<span class="fill" style="width:${pos(sp)};"></span>` : ''}${S2.med != null ? `<span class="med" style="left:${pos(S2.med)};"></span>` : ''}${sp != null ? `<span class="knob" style="left:${pos(sp)};"></span>` : ''}</div>
        <div class="tt-ov-scale"><span>Slow</span><span>Medium</span><span>Fast</span></div>
        <div class="tt-ov-rank"><span class="m">${rank}</span> fastest of <span class="m">${S2.n || DASH}</span> · tour median <span class="m">${S2.med != null ? S2.med.toFixed(2) : DASH}</span></div>
      </div>
      <div class="tt-ov-sr">
        ${kv('Altitude', alt, 'm', alt != null ? `Venue altitude, ${alt} m.` : 'No altitude on file.')}
        ${kv('1st serve points won', fs ? Math.round(fs.pct) : null, '%', fsTip)}
        ${kv('Service hold', hd ? Math.round(hd.pct) : null, '%', hdTip)}
      </div>
    </div>`;
}

// ---------------------------------------------------------------- render: speed by year (2020–2026)
function speedYearsHtml(c){
  const vals = YEARS.map(y => speedYearOf(c.name, y));
  const have = vals.map((v, i) => ({ v, i })).filter(p => p.v != null);
  const chTop = 40, chBot = 66;
  const mn = have.length ? Math.min(...have.map(p => p.v)) : 0, mx = have.length ? Math.max(...have.map(p => p.v)) : 0, sp = (mx - mn) || 1;
  const X = i => Math.round((26 + i * (308 / 6)) * 10) / 10, Y = v => chBot - (v - mn) / sp * (chBot - chTop);
  // runs of consecutive years with a value: a missing year breaks the line (never interpolated)
  const runs = []; let cur = [];
  vals.forEach((v, i) => { if (v == null) { if (cur.length) runs.push(cur); cur = []; } else cur.push({ x: X(i), y: Y(v) }); });
  if (cur.length) runs.push(cur);
  const multi = runs.filter(r => r.length > 1);
  const area = multi.map(r => 'M' + r.map(p => p.x + ' ' + p.y).join(' L') + ' L' + r[r.length - 1].x + ' 90 L' + r[0].x + ' 90 Z').join(' ');
  const lines = multi.map(r => `<polyline points="${r.map(p => p.x + ',' + p.y).join(' ')}" fill="none" stroke="var(--tt-white)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline>`).join('');
  let word = DASH, delta = '';
  if (have.length > 1) { const d = +(have[have.length - 1].v - have[0].v).toFixed(2); word = Math.abs(d) < 0.03 ? 'Holding steady' : (d > 0 ? 'Trending faster' : 'Trending slower'); delta = (d >= 0 ? '+' : MINUS) + Math.abs(d).toFixed(2); }
  const pts = YEARS.map((y, i) => {
    const v = vals[i], left = (X(i) / 360 * 100).toFixed(2) + '%';
    const top = (v == null ? (chTop + chBot) / 2 : Y(v)).toFixed(1) + 'px';
    return (v == null ? `<span class="tt-ov-pv tt-ov-dash" style="left:${left};top:${top};transform:translate(-50%,-50%);">${DASH}</span>`
      : `<span class="tt-ov-dot" style="left:${left};top:${top};"></span><span class="tt-ov-pv" style="left:${left};top:${top};">${v.toFixed(2)}</span>`)
      + `<span class="tt-ov-py" style="left:${left};">${y}</span>`;
  }).join('');
  const tip = TT_SPEED_SOURCE === 'ta' ? `${SPEED_CREDIT}; a year with no reading is a dash.` : 'No court-speed figure of our own.';
  return `<div class="tt-ov-card tt-ov-yr" title="${esc(tip)}">
      <div class="tt-ov-yrhd"><span class="tt-ov-cap">Court speed · 2020–2026</span><span class="tt-ov-trend"><span class="w${have.length > 1 ? '' : ' tt-ov-dash'}">${word}</span>${delta ? `<span class="d">${delta}</span>` : ''}</span></div>
      <div class="tt-ov-plot"><svg viewBox="0 0 360 104" preserveAspectRatio="none" width="100%" height="100%" fill="none"><defs><linearGradient id="ttTrFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--tt-white);" stop-opacity="0.14"></stop><stop offset="1" style="stop-color:var(--tt-white);" stop-opacity="0"></stop></linearGradient></defs>${area ? `<path d="${area}" fill="url(#ttTrFill)"></path>` : ''}${lines}</svg>${pts}</div>
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
function quotesCardHtml(c){
  const list = quotesOf(c);
  // No traceable quote: the card keeps its place with a dash — no link, no click, no invented line.
  if (!list.length) return `<div class="tt-ov-card tt-ov-qcard" data-tt-quotes="0"><div class="tt-ov-hd"><span class="tt-ov-cap">What players say</span></div><div class="tt-ov-qlead tt-ov-dash">${DASH}</div></div>`;
  const lead = list[0];
  return `<div class="tt-ov-card tt-ov-qcard open tt-ov-seg" data-tt-quotes="${list.length}" onclick="TTOverview.openQuotes()">
      <div class="tt-ov-hd"><span class="tt-ov-cap">What players say</span><span class="tt-ov-lnk">Read all ${list.length} ${chev()}</span></div>
      <div class="tt-ov-qlead">${qText(lead)}</div>
      <div class="tt-ov-qfoot"><span class="tt-ov-qby">${esc(lead.player)}</span><span class="tt-ov-qmeta">${esc(qMeta(lead))}</span></div>
    </div>`;
}

// ---------------------------------------------------------------- betting market line + tiles
function yearSelect(which, val){
  return `<span class="tt-ov-sel"><select aria-label="${which}" onchange="TTOverview.setYear('${which}', this.value)">${YEARS.map(y => `<option value="${y}"${y === val ? ' selected' : ''}>${y}</option>`).join('')}</select><svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="var(--text-label)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.5 L5 6.5 L8 3.5"></path></svg></span>`;
}
function marketHtml(c){
  const mk = market();
  const label = mk.state === 'ok' ? mk.label : (allYears() ? 'every edition on record' : (st.yF === st.yT ? st.yF + ' edition' : st.yF + ' to ' + st.yT));
  const line = `<div class="tt-ov-bm"><span class="tt-ov-bmt"><span class="t">Betting market</span><span class="l">${esc(label)}</span></span>
      <div class="tt-ov-yrs"><label><span class="tt-ov-cap">From</span>${yearSelect('from', st.yF)}</label><label><span class="tt-ov-cap">To</span>${yearSelect('to', st.yT)}</label>${allYears() ? '' : `<span class="tt-ov-reset tt-ov-seg" onclick="TTOverview.resetYears()">All years</span>`}</div></div>`;
  const a = mk.state === 'ok' ? mk.tours[c.name] : null, base = mk.state === 'ok' ? mk.baseline : null;
  const ok = !!(a && a.n >= MIN_MATCHES && base);
  const mktJ = marketData(), mt = mktJ && mktJ.tournaments && mktJ.tournaments[c.name];
  const openable = !!(mt && mt.archiveNames && mt.archiveNames.length);
  const pop = mk.state === 'ok' ? `${mk.span}; Database rows, Pinnacle closing else Bet365 per match; retirements settle on Pinnacle rules` : '';
  const why = mk.state === 'loading' ? 'Loading.' : mk.state === 'failed' ? 'The market figures did not load.'
    : !a ? `No closing prices joined to ${c.name} in our archive${allYears() ? '' : ' for these years'}.` : `Fewer than ${MIN_MATCHES} priced matches at ${c.name} in these years (n = ${fmtN(a.n)}).`;
  const roiTile = (label, side, v, avg) => {
    const d = ok ? v - avg : 0;
    const col = !ok ? '' : Math.abs(d) < 1 ? 'color:var(--text);' : d > 0 ? 'color:var(--pos);' : 'color:var(--neg);';
    const fig = ok ? signed(v, 1) + '%' : DASH;
    const cmp = ok ? (Math.abs(d) < 1 ? 'in line with tour average' : signed(d, 1) + 'pp vs tour avg') : DASH;
    const tip = 'Flat-stake yield. Click for the graphics by price band.' + (ok ? ` n = ${fmtN(a.n)} matches at ${c.name}, ${pop}. Tour ${signed(avg, 1)}% over ${fmtN(base.n)} matches.` : ' ' + why);
    return `<div class="tt-ov-card tt-ov-tile${openable ? ' open tt-ov-seg' : ''}" data-tt-tile="${side}"${openable ? ` onclick="TTOverview.openRoi('${side}')"` : ''} title="${esc(tip)}"><div class="tt-ov-hd"><span class="tt-ov-cap">${label}</span>${openable ? `<span class="tt-ov-lnk">Graphics ${chev()}</span>` : ''}</div><div class="tt-ov-tf${ok ? '' : ' tt-ov-dash'}" style="${col}">${fig}</div><div class="tt-ov-tl">${cmp}</div></div>`;
  };
  // Favourite reliability: printed figure; gap = printed − printed tour (adds up on screen); verdict at ±3pp.
  const rel = ok && a.favRel != null && base.favRel != null;
  const fr = rel ? a.favRel : null, tr = rel ? base.favRel : null, d = rel ? fr - tr : 0;
  const rk = rel ? relRank(mk, c.name) : null;
  const gapCol = !rel ? '' : Math.abs(d) < 1 ? 'color:var(--text-soft);' : d > 0 ? 'color:var(--pos);' : 'color:var(--neg);';
  const relTip = rel ? `Share of matches won by the favourite (shorter closing price): ${fr}% over n = ${fmtN(a.nRel)} matches at ${c.name}, ${mk.span}; tour ${tr}% over ${fmtN(base.nRel)}. Retirements count on the official result; walkovers and exact price ties never. Ranked among the ${rk ? rk.of : DASH} events with ${MIN_MATCHES}+ priced matches in the same years.` : why;
  const relTile = `<div class="tt-ov-card tt-ov-tile" data-tt-tile="rel" title="${esc(relTip)}">
      <div class="tt-ov-hd"><span class="tt-ov-cap">Favourite reliability</span><span class="tt-ov-verdict">${rel ? (d >= 3 ? 'Reliable' : d <= -3 ? 'Upset-prone' : 'Moderate') : ''}</span></div>
      <div class="tt-ov-rel"><span class="f${rel ? '' : ' tt-ov-dash'}">${rel ? fr + '%' : DASH}</span>${rel ? `<span class="gp" style="${gapCol}">${(d >= 0 ? '+' : MINUS) + Math.abs(d).toFixed(1)}pp</span><span class="vs">vs tour</span>` : ''}</div>
      <div class="tt-ov-rbar" title="Share of matches won by the favourite. The tick marks the tour average.">${rel ? `<span class="fill" style="width:${Math.max(2, Math.min(100, (fr - 50) / 40 * 100)).toFixed(1)}%;"></span><span class="tick" style="left:${Math.max(2, Math.min(98, (tr - 50) / 40 * 100)).toFixed(1)}%;"></span>` : ''}</div>
      <div class="tt-ov-rfoot"><span>${rk ? ord(rk.rank) + ' of ' + rk.of + ' tournaments' : DASH}</span><span>${rel ? 'tour ' + tr + '%' : ''}</span></div>
    </div>`;
  return line + `<div class="tt-ov-tiles">${roiTile('Backing favourites', 'fav', a && a.roiFav, base && base.roiFav)}${roiTile('Backing underdogs', 'dog', a && a.roiDog, base && base.roiDog)}${relTile}</div>`;
}

// ---------------------------------------------------------------- render: detail
function detailHtml(c){
  if (!c) return `<div class="tt-ov-detail"><div class="tt-ov-sub">${DASH}</div></div>`;
  const completed = c.status === 'Completed';
  return `<div class="tt-ov-detail">
      <div><div class="tt-ov-ttl"><span class="tt-ov-name">${esc(c.name)}</span>${completed ? '<span class="tt-ov-badge">Completed</span>' : ''}</div><div class="tt-ov-sub">${esc(c.category || DASH)} · ${esc(cap(c.surface || ''))} court</div></div>
      <div class="tt-ov-stack">
        ${speedCardHtml(c)}
        ${speedYearsHtml(c)}
        <div class="tt-ov-two"><div class="tt-ov-card tt-ov-cond"><div class="tt-ov-cap">Conditions read</div><div class="tt-ov-ctext">${esc(conditionsText(c))}</div></div>${quotesCardHtml(c)}</div>
        ${marketHtml(c)}
        <div>${c.hasReport ? `<span class="tt-ov-cta tt-ov-seg" onclick="tourxOpenReport('${jsq(c.name)}')">View tournament report ${chev()}</span>` : ''}</div>
      </div>
    </div>`;
}

function render(el){
  injectCss();
  if (el) st.el = el;
  if (!st.el) return;
  loadHip(); loadHold();
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

// ---------------------------------------------------------------- overlays
function overlayRoot(){ return typeof document !== 'undefined' && document.getElementById ? document.getElementById('tourxOverlayRoot') : null; }
const closeBtn = () => '<span class="tt-ov-x tt-ov-seg" title="Close" onclick="tourxCloseOverlays()"><svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="var(--text-soft)" stroke-width="1.6" stroke-linecap="round"><path d="M1.5 1.5 L8.5 8.5 M8.5 1.5 L1.5 8.5"></path></svg></span>';
function speedBoxHtml(){
  const ts = tstate(), S2 = speedStats();
  const court = t => (t.indoor ? 'Indoor' : t.surface === 'hard' ? 'Outdoor hard' : t.surface === 'clay' ? 'Clay' : t.surface === 'grass' ? 'Grass' : null);
  const flat = events().map(t => ({ name: t.name, sp: speedOf(t.name), court: court(t), on: t.name === ts.tsSel })).filter(r => r.court);
  const ranked = flat.filter(r => r.sp != null).sort((a, b) => b.sp - a.sp);
  ranked.forEach((r, i) => { r.rank = i + 1; });
  const pct = v => (v == null || S2.lo == null ? '0%' : Math.max(3, (v - S2.lo) / ((S2.hi - S2.lo) || 1) * 100).toFixed(1) + '%');
  const cols = ['Indoor', 'Outdoor hard', 'Clay', 'Grass'].map(cn => {
    const rs = flat.filter(r => r.court === cn).sort((a, b) => (b.sp == null ? -1 : b.sp) - (a.sp == null ? -1 : a.sp));
    const med = median(rs.filter(r => r.sp != null).map(r => r.sp));
    const rows = rs.map(r => `<div class="tt-ov-sprow${r.on ? ' on' : ''}" title="${esc(r.name + ' · ' + (r.rank ? ord(r.rank) + ' fastest of ' + ranked.length : 'no court-speed figure of our own'))}"><span class="rk">${r.rank || DASH}</span><span class="nm">${esc(r.name)}</span><span class="bar"><span style="width:${pct(r.sp)};"></span></span><span class="v${r.sp == null ? ' tt-ov-dash' : ''}">${r.sp == null ? DASH : r.sp.toFixed(2)}</span></div>`).join('');
    return `<div class="tt-ov-spcol"><div class="tt-ov-spch"><div class="l">${cn}</div><div class="m">${rs.length} events · median ${med == null ? DASH : med.toFixed(2)}</div></div>${rows}</div>`;
  }).join('');
  const sel = flat.find(r => r.on);
  const strip = sel ? `<div class="tt-ov-strip"><span class="nm">${esc(sel.name)}</span><span class="sp${sel.sp == null ? ' tt-ov-dash' : ''}">${sel.sp == null ? DASH : sel.sp.toFixed(2)}</span><span class="rk">${sel.rank ? ord(sel.rank) : DASH} fastest of ${ranked.length || DASH} · ${sel.court}</span><span class="gp"><span class="m">${sel.sp != null && S2.med != null ? (sel.sp - S2.med >= 0 ? '+' : MINUS) + Math.abs(sel.sp - S2.med).toFixed(2) : DASH}</span> vs tour median</span></div>` : '';
  const credit = TT_SPEED_SOURCE === 'ta' ? ` title="${esc(SPEED_CREDIT)}"` : '';
  return `<div class="tt-ov-scrim" data-tourx-scrim="1"><div class="tt-ov-sheet" role="dialog" aria-modal="true" aria-label="Court speed" style="max-width:1240px;"${credit}>
      <div class="tt-ov-shd"><div class="tt-ov-shrow"><div style="flex:1;min-width:0;"><div class="tt-ov-sht">Court speed</div><div class="tt-ov-shs">${flat.length} events · tour median ${S2.med != null ? S2.med.toFixed(2) : DASH}</div></div>${closeBtn()}</div>${strip}</div>
      <div class="tt-ov-sbody"><div class="tt-ov-speedgrid">${cols}</div></div>
    </div></div>`;
}
function quotesBoxHtml(){
  const c = resolve(tstate().tsSel), all = quotesOf(c);
  if (!c || !all.length) return '';
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
      <div class="tt-ov-shd q"><div class="tt-ov-shrow"><div style="flex:1;min-width:0;"><div class="tt-ov-sht">What players say</div><div class="tt-ov-shs">${esc(c.name)} · ${shown.length} ${shown.length === 1 ? 'quote' : 'quotes'} about the courts and conditions</div></div>${closeBtn()}</div>
        <div class="tt-ov-pills">${pill('all', 'All years')}${years.map(y => pill(y, `${y} · AS ${as(y)}`)).join('')}</div></div>
      <div class="tt-ov-qbody">${rows}</div>
    </div></div>`;
}
function roiBoxHtml(){
  const c = resolve(tstate().tsSel);
  if (!c) return '';
  // data-page="database" is load-bearing: the Database page's --db-* properties are declared on it (as the live embed).
  const body = `<div data-db-root="roi" data-page="database" class="pagewrap" style="max-width:none;padding:30px 40px 70px;">
      <div class="sfh db-headcard" data-db="head"><div class="sfh__text"><h1 class="sfh__title">Database</h1><p class="sfh__sub" data-db="subtitle"></p></div><div class="sfh__stats" data-db="fresh"></div></div>
      <div class="db-ctl" data-db="ctl"><div class="db-ctltop"><div class="db-seg" data-db="viewtabs"><button data-dbview="tour">Tour</button><button class="active" data-dbview="tournaments">Tournaments</button><button data-dbview="players">Players</button></div></div><div class="db-ctlbot" data-db="filters"></div></div>
      <div data-db="body"><div class="db-loading">Loading archive…</div></div>
    </div>`;
  return `<div class="tt-ov-scrim top" data-tourx-scrim="1"><div class="tt-ov-sheet roi" role="dialog" aria-modal="true" aria-label="${esc(c.name)} · favourites and underdogs" style="max-width:1180px;">
      <div class="tt-ov-roihd"><span class="tt-ov-sht">${esc(c.name)} · favourites and underdogs</span><span class="s">flat 1% stake · yields by price band</span><span class="tt-ov-close tt-ov-seg" onclick="tourxCloseOverlays()">Close</span></div>
      ${body}
    </div></div>`;
}
function renderOverlays(){
  const rootEl = overlayRoot();
  if (!rootEl) return;
  const ts = tstate();
  const now = ts.speedPanel ? 'speed' : ts.quotesPanel ? 'quotes' : ts.roiPanel ? 'roi:' + ts.roiPanel + ':' + ts.tsSel : '';
  // the Database panel is a MOUNTED page: built when it opens (or its event changes), never rebuilt on a repaint
  if (now.startsWith('roi') && rootEl.getAttribute('data-tt-ov') === now && rootEl.querySelector('[data-db-root="roi"]')) return;
  rootEl.innerHTML = ts.speedPanel ? speedBoxHtml() : ts.quotesPanel ? quotesBoxHtml() : ts.roiPanel ? roiBoxHtml() : '';
  rootEl.setAttribute('data-tt-ov', now);
  if (ts.roiPanel && root.DatabaseTab && root.DatabaseTab.mount) {
    const host = rootEl.querySelector('[data-db-root="roi"]');
    const c = resolve(ts.tsSel), mkt = c && typeof tourxMarketFor === 'function' ? tourxMarketFor(c.name) : null;
    const names = mkt && mkt.archiveNames;
    // no archive names = no honest panel (never the catalog name as a guess)
    if (host && c && names && names.length) root.DatabaseTab.mount(host, { hideHeader: true, lockSubject: true, initialTournamentNames: names,
      initialTournamentFilter: mkt.archiveFilter || null, initialTournamentLabel: c.name, side: ts.roiPanel });
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
  quoteYear(y){ st.quoteYear = y; renderOverlays(); },
  openSpeeds(){ const ts = tstate(); ts.speedPanel = true; ts.quotesPanel = false; ts.roiPanel = null; renderOverlays(); },
  openQuotes(){ const ts = tstate(); st.quoteYear = 'all'; ts.quotesPanel = true; ts.speedPanel = false; ts.roiPanel = null; renderOverlays(); },
  openRoi(side){ const ts = tstate(); ts.roiPanel = side; ts.speedPanel = false; ts.quotesPanel = false; renderOverlays(); },
  _internals: { aggRows, taggedRows, marketModel, relRank, speedLabel, speedOf, speedStats, conditionsText, holdOf, firstServeOf, tierCode, events, market, state: st,
    railHtml, speedCardHtml, speedYearsHtml, quotesCardHtml, marketHtml, detailHtml, speedBoxHtml, quotesBoxHtml, roiBoxHtml, CSS, TT_SPEED_SOURCE },
};
root.TTOverview = api;
}(typeof window !== 'undefined' ? window : globalThis));
