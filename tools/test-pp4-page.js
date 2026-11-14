#!/usr/bin/env node
// Profile v4 (handoff 2026-11-14) — the profile page's own rules: the MTO badge (§1), the named cut-offs in one place,
// the bar rule (§0.1), no internal status text (§0.6), the page chrome (tiles, ribbon, ledger, insights).
// Each check runs the shipped module (player-profile-v2.js) in a sandbox; mutants below prove each check can fail.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function check(name, fn) {
  let ok, why = '';
  try { const r = fn(); ok = r === true; if (!ok) why = typeof r === 'string' ? r : JSON.stringify(r); } catch (e) { ok = false; why = e.message; }
  if (ok) pass++; else fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name + (ok ? '' : '  → ' + why));
}
function load(src, extra) {
  const W = Object.assign({ FEATURE_PP2: true, playerProfiles: { players: [] }, careerHistory: {} }, extra || {});
  const prev = global.window; global.window = W;
  try { new Function('window', src)(W); } finally { if (prev === undefined) delete global.window; else global.window = prev; }
  return W.PlayerProfileV2._internals;
}
const SRC = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
const NOW = Date.parse('2026-11-14T12:00:00Z');
// The real feed rows of 11 Nov 2026 (mto-matches.json), and Ruud's real career-history row for that match.
const FEED = { matches: {
  12178945: [
    { calledAt: '2026-11-11T17:53:51+00:00', player: 'Casper Ruud', opponent: 'Alexander Shevchenko', playerSide: 2, games: [[6], [5]], finalResult: '6–7, 6–4, 6–3' },
    { calledAt: '2026-11-11T18:08:42+00:00', player: 'Casper Ruud', opponent: 'Alexander Shevchenko', playerSide: 2, games: [[6, 0], [7, 0]], finalResult: '6–7, 6–4, 6–3' },
    // a row whose opponent is not this match's: never attributed, even though the caller's surname fits
    { calledAt: '2026-11-11T18:20:00+00:00', player: 'Casper Ruud', opponent: 'Marco Polo', playerSide: 2, games: [[6, 1], [7, 1]] }],
  12178519: [{ calledAt: '2026-11-11T15:33:49+00:00', player: 'Borna Gojo', opponent: 'Ugo Humbert', playerSide: 2, games: [[5], [2]] }],
  99: [{ calledAt: '2025-06-01T10:00:00+00:00', player: 'Casper Ruud', opponent: 'Old Opponent', playerSide: 1, games: [[1], [2]] }]
} };
const RUUD_CH = [
  { date: '2026-11-11', tournament: 'Stockholm', round: '1/8-finals', opponent: 'A. Shevchenko', oppKey: '566', result: '1 - 2', won: false, eventKey: 12178945, sets: [{ p: 7, o: 6 }, { p: 4, o: 6 }, { p: 3, o: 6 }] },
  { date: '2025-06-01', tournament: 'Somewhere', round: '1/16-finals', opponent: 'O. Opponent', won: true, eventKey: 99, sets: [{ p: 6, o: 1 }] }
];
const SHEV_CH = [{ date: '2026-11-11', tournament: 'Stockholm', round: '1/8-finals', opponent: 'C. Ruud', won: true, eventKey: 12178945, sets: [{ p: 6, o: 7 }, { p: 6, o: 4 }, { p: 6, o: 3 }] }];
const RUUD = { key: '430', name: 'C. Ruud' }, SHEV = { key: '566', name: 'A. Shevchenko' };

function suite(src, label) {
  const I = load(src, { pp2MtoMatches: FEED, careerHistory: { 430: RUUD_CH, 566: SHEV_CH } });
  console.log(label);
  check('MTO: both of Ruud\'s time-outs, newest first, read from HIS side of the score', () => {
    const r = I.mtoRowsFor(RUUD, NOW);
    if (r.length !== 2) return 'rows ' + r.length;
    return r[0].taken === 'Taken in set 2 at 0–0' && r[1].taken === 'Taken in set 1 at 5–6' && r[0].date === '11 Nov 2026' ||
      JSON.stringify(r.map(x => [x.taken, x.date]));
  });
  check('MTO: result square and score are his (lost, 7-6 4-6 3-6)', () => {
    const r = I.mtoRowsFor(RUUD, NOW)[0];
    return r.won === false && r.score === '7-6 4-6 3-6' && r.event === 'Stockholm R16' || JSON.stringify(r);
  });
  check('MTO: identity by event key + this match\'s two players — the opponent of the same match gets none', () =>
    I.mtoRowsFor(SHEV, NOW).length === 0 || 'Shevchenko got ' + I.mtoRowsFor(SHEV, NOW).length);
  check('MTO: a time-out outside the 12-month window is left out', () =>
    I.mtoRowsFor(RUUD, NOW).every(x => x.date !== '1 Jun 2025') || 'window not applied');
  check('MTO: a time-out in a match not in his history is never his (Gojo\'s, for Ruud)', () =>
    I.mtoRowsFor(RUUD, NOW).every(x => x.vs === 'A. Shevchenko') || 'foreign row');
  check('MTO: no badge without a time-out; badge closed by default; popover after toggle', () => {
    const none = I.renderMto({ key: '1', name: 'X. Nobody' });
    I.state.mtoOpen = false;
    const closed = I.renderMto(RUUD);
    I.state.mtoOpen = true;
    const open = I.renderMto(RUUD);
    I.state.mtoOpen = false;
    return none === '' && /data-pp2="mto-toggle"/.test(closed) && !/Medical time-outs<\/span>/.test(closed) &&
      /Medical time-outs<\/span>/.test(open) && /2 in the last 12 months/.test(open) || 'states wrong';
  });
  check('MTO: never a body part or reason, and no source named', () => {
    I.state.mtoOpen = true; const h = I.renderMto(RUUD); I.state.mtoOpen = false;
    return !/injur|knee|back|shoulder|ankle|wrist|hip|reason|physio|source|Live Tennis/i.test(h.replace(/<[^>]+>/g, ' ')) || 'leaks detail';
  });
  check('MTO: badge geometry = the reference (top -2, right -14, 7px dot, mono 10.5/700, 55% red ring)', () => {
    const h = I.renderMto(RUUD);
    return /top:-2px;right:-14px/.test(h) && /width:7px;height:7px/.test(h) && /font-size:10\.5px;font-weight:700/.test(h) &&
      /color-mix\(in srgb, var\(--neg\) 55%, transparent\)/.test(h) || 'geometry';
  });
  check('PP4: every v4 cut-off in one block, at the handoff\'s placeholder values', () => {
    const P = I.PP4;
    const want = { STK_MINP: 30, STK_EDGE: 1, CAL_MIN: 5, CAL_THIN: 10, SPEED_FLOOR: 5, ALT_CUT_M: 500, SPL_MINB: 15, HB_MIN: 10, MTO_WINDOW_MONTHS: 12, LC_FIELD_DOT_PP: 1 };
    const bad = Object.keys(want).filter(k => P[k] !== want[k]);
    return !bad.length || bad.join(',');
  });
  check('§0.1: a bar is neutral unless its item is clicked, then blue', () =>
    I.pp4Bar(false) === 'var(--pp-x-bar-neutral)' && I.pp4Bar(true) === 'var(--pp-x-link)' || 'bar colours');
}
suite(SRC, 'shipped module');

console.log('source rules');
check('§0.6: the profile prints no "Data paused" / feed status (code, comments aside)', () =>
  !/splitsPaused|sfFeedPaused|Data paused/.test(SRC.replace(/\/\/[^\n]*/g, '')) || 'paused text present');
check('page: tiles on a 6% ring, ring-only hover, headline line-height 1.1', () =>
  /var TILE_EDGE = 'var\(--edge-6\)'/.test(SRC) && /'\.pp2-box:hover\{border-color:var\(--edge-16\)!important;\}'/.test(SRC) &&
  /';line-height:1\.1;white-space:nowrap;'/.test(SRC) || 'tile chrome');
check('page: ribbon, ledger and insight cards carry no top-light inset', () => {
  const grab = re => (re.exec(SRC) || [''])[0];
  const parts = [grab(/class="pp2-ribbon" style="[^\n]*/), grab(/class="pp2-ledger" style="[^\n]*\n[^\n]*/), grab(/data-insight="[\s\S]{0,400}/)].map(x => x.replace(/\/\/[^\n]*/g, ''));
  return parts.every(x => x && !/top-light/.test(x)) || 'top-light still on ' + parts.map(x => /top-light/.test(x)).join(',');
});
check('drawer: stops clipping while a (?) popover is open, so a long definition list is never cut off', () =>
  /'\.pp2-card:has\(\[data-pp2-infopop\]\)\{overflow:visible!important;\}'/.test(SRC) && /data-pp2="card" data-pp2-infopop="1"/.test(SRC) || 'popover clipping rule');
check('Filters menus: Market edge, Derived lines and Calendar draw the export\'s menu (o.x), Market edge chips v4 with the count', () =>
  /filtersTriggerHtml\('mk', [^\n]*\{ x: true, noEllipsis: true \}\)/.test(SRC) && /filtersTriggerHtml\('lc', [^\n]*\{ x: true, noEllipsis: true \}\)/.test(SRC) &&
  /filtersTriggerHtml\('cal', [^\n]*\{ x: true, gap: '18px 18px', gutter: true \}\)/.test(SRC) &&
  /filtersAppliedHtml\('mk', [^\n]*\{ v4: true, count: true \}\)/.test(SRC) && /var\(--pp-x-shadow-pop6\)/.test(SRC) || 'menu variant');
check('Court speed: the row that opened the match box is raised while the box is open; the host clears it on close', () =>
  /state\.sheetRow = v;/.test(SRC) && /'\.pp2-spdrow\.pp2-rowopen>\*\{background:var\(--selected\)!important;\}'/.test(SRC) &&
  /state\.sheetRow === \(m\.sheetId \|\| \(m\.date \+ '\|' \+ m\.opp\)\) && sheetOnScreen\(\)/.test(SRC) &&
  /function fhMarkRow\(mid\)\{ if \(!mid\) document\.querySelectorAll\('\.pp2-rowopen'\)/.test(fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8')) || 'row mark');
check('Market edge band box: the foot names the tour figure\'s real population (whole tour since 2010), never "same window"', () =>
  /tour at this band = every priced ATP main-tour match since 2010 with a closing price in ' \+ B\[1\]/.test(SRC) && !/same window and surface as the drawer/.test(SRC) &&
  /data-pp2-fbfoot="1"/.test(SRC) || 'band foot');
check('Calendar Country: the export\'s search field, filtering in place, with "No country matches"', () =>
  /search: true, searchPh: 'Type a country…', noHits: 'No country matches'/.test(SRC) && /data-pp4-search/.test(SRC) && /oninput="\(function\(i\)/.test(SRC) || 'country search');
const tok = fs.readFileSync(path.join(ROOT, 'tokens.css'), 'utf8');
check('tokens: the v4 profile colours are named once in tokens.css', () =>
  /--pp-x-bar-neutral:\s*#4A5470/i.test(tok) && /--pp-x-faint:\s*#5B6480/i.test(tok) && /--pp-x-shadow-pop:\s*0 18px 48px rgba\(0, 0, 0, 0\.55\)/.test(tok) || 'tokens');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
check('host: the profile loads mto-matches.json once per session, a failed read is "no file"', () =>
  /function loadPp2Mto\(key\)/.test(html) && /fetch\('\.\/mto-matches\.json'/.test(html) && /loadPp2Mto\(key\);\n\}/.test(html) || 'loader');

// ── founder 2026-11-14 rulings ──────────────────────────────────────────────
{
  const E = { sfEventKey: n => ({ Cincinnati: 'Cincinnati', 'US Open': 'US Open' })[n] || null,
    sfEventName: n => ({ Cincinnati: 'Cincinnati Open' })[n] || n,
    sfSponsorCity: n => ({ 'Western & Southern Financial Group Masters': 'Cincinnati', 'Astana Open': 'Almaty' })[n] || null };
  const I = load(SRC, E);
  const W = global.window; global.window = Object.assign({}, E);
  let names;
  try { names = ['Western & Southern Financial Group Masters', 'US Open', 'Astana Open', 'Some Unknown Cup'].map(n => I.tournDisplayName(n, null)); }
  finally { if (W === undefined) delete global.window; else global.window = W; }
  check('event names: a Tennis-Data sponsor name prints its event ("Cincinnati Open"); Astana stays Astana; an unknown name stays as written', () =>
    JSON.stringify(names) === JSON.stringify(['Cincinnati Open', 'US Open', 'Astana Open', 'Some Unknown Cup']) || JSON.stringify(names));
}
check('Match-up: a thin dot sits at its own rate (hollow, no label), as the reference', () =>
  /var yv = d\.pct;/.test(SRC) && /var vals = pts\.map\(function \(d\) \{ return d\.pct; \}\);/.test(SRC) || 'thin dot');
check('Record per tournament: a search that matches nothing leaves the list card empty (the reference); no sentence', () =>
  /\(q \|\| lvl !== 'all' \|\| sf !== 'all' \? '<div data-pp2-tourn-empty="1"><\/div>'/.test(SRC) && !/No tournament matches that search/.test(SRC) || 'tourn empty');
check('Money in units (founder 2026-11-14): no match-list P&L or drawer headline prints a %', () =>
  !/signed\(m\.pl \|\| 0, 2, '%'\)/.test(SRC) && !/fig: signed\(b\.u, 1, '%'\)/.test(SRC) && /\(has \? signed\(s\.u, 2, 'u'\) : DASH\)/.test(SRC) || 'units');

// ── mutants: each must turn a check red ─────────────────────────────────────
const MUT = [
  ['window ignored', s => s.replace('if (!isFinite(at) || at < cut.getTime() || at > now) return;', 'if (!isFinite(at)) return;')],
  ['opponent check dropped', s => s.replace(" || !mtoIsHim(m.opponent, row.opponent)) return;", ') return;')],
  ['score read from side 1', s => s.replace('var g = m.games, me = m.playerSide === 1 ? 0 : m.playerSide === 2 ? 1 : -1', 'var g = m.games, me = 0')],
  ['bar tinted by value', s => s.replace("function pp4Bar(selected) { return selected ? 'var(--pp-x-link)' : 'var(--pp-x-bar-neutral)'; }", "function pp4Bar(selected) { return 'var(--pp-x-link)'; }")],
  ['window 24 months', s => s.replace('MTO_WINDOW_MONTHS: 12,', 'MTO_WINDOW_MONTHS: 24,')]
];
let caught = 0;
for (const [name, f] of MUT) {
  const m = f(SRC);
  if (m === SRC) { console.log('  MUTANT DID NOT APPLY: ' + name); fail++; continue; }
  const before = fail, bp = pass; const log = console.log; console.log = () => {};
  try { suite(m, ''); } finally { console.log = log; }
  const red = fail > before; fail = before; pass = bp;
  if (red) caught++; else { console.log('  FAIL mutant survived: ' + name); fail++; }
}
console.log(`  mutants caught ${caught} of ${MUT.length}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
