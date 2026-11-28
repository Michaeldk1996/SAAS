// Database v2 (handoff design_handoff_database_v2, founder 2026-11-16 "follow the design"). Each rule below is a test
// against the shipped page source, and each has a mutant that must turn it red (CONTROL at the foot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('./bsp-consult-dashboard.html', import.meta.url), 'utf8');
const TOKENS = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

// one-line or brace-matched function source, as the other Database suites slice it
function fnSource(src, name) {
  const i = src.indexOf('  function ' + name + '(');
  if (i < 0) throw new Error('function ' + name + ' is gone');
  const open = src.indexOf('{', i); let d = 0;
  for (let k = open; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } }
  throw new Error('unbalanced ' + name);
}
// a `var NAME = …;` literal, the way build-lines-field.js slices LN_LADDERS (brace-matched object / array, else to ';')
function varSource(src, name) {
  const i = src.indexOf('  var ' + name);
  if (i < 0) throw new Error('var ' + name + ' is gone');
  const eq = src.indexOf('=', i); let k = eq + 1; while (src[k] === ' ') k++;
  const oc = src[k] === '{' ? ['{', '}'] : src[k] === '[' ? ['[', ']'] : null;
  if (!oc) return src.slice(i, src.indexOf(';', i) + 1);
  let d = 0;
  for (let j = k; j < src.length; j++) { if (src[j] === oc[0]) d++; else if (src[j] === oc[1]) { d--; if (!d) return src.slice(i, j + 1) + ';'; } }
  throw new Error('unbalanced ' + name);
}

const CHECKS = {
  // Fixed price bands, half-open (the profile's MK_BANDS edges): every price lands in exactly one band per side.
  bands(src) {
    const code = varSource(src, 'DB2_BANDS') + '\n' + fnSource(src, 'db2InBand') + '\nreturn {DB2_BANDS, db2InBand};';
    const { DB2_BANDS, db2InBand } = new Function(code)();
    const want = { fav: ['Heavy favourite', 'Clear favourite', 'Favourite', 'Slight favourite', 'Near coin-flip'],
      dog: ['Slight underdog', 'Underdog', 'Big underdog', 'Long underdog', 'Longshot'] };   // founder 2026-11-26: the sides meet at 1.95
    for (const sd of ['fav', 'dog']) {
      const names = DB2_BANDS[sd].map(b => b[0]);
      if (names.join('|') !== want[sd].join('|')) return sd + ' bands are ' + names.join(', ');
    }
    for (const p of [1.01, 1.2, 1.205, 1.21, 1.357, 1.5, 1.509, 1.7, 1.71, 1.949]) {
      const n = DB2_BANDS.fav.filter(b => db2InBand(b, p)).length;
      if (n !== 1) return `favourite price ${p} lands in ${n} bands`;
    }
    for (const p of [1.95, 1.999, 2, 2.49, 2.5, 2.999, 3, 3.99, 4, 5.99, 6, 26]) {
      const n = DB2_BANDS.dog.filter(b => db2InBand(b, p)).length;
      if (n !== 1) return `underdog price ${p} lands in ${n} bands`;
    }
    // founder 2026-11-26: the two sides meet at 1.95, no gap and no overlap: a price under 1.95 is in no underdog band,
    // 1.95 or longer in no favourite band (near-even prices count in the side's total only)
    for (const p of [1.71, 1.949]) if (DB2_BANDS.dog.some(b => db2InBand(b, p))) return `underdog price ${p} lands in an underdog band`;
    for (const p of [1.95, 1.99]) if (DB2_BANDS.fav.some(b => db2InBand(b, p))) return `favourite price ${p} lands in a favourite band`;
    if (DB2_BANDS.fav[4][4] !== DB2_BANDS.dog[0][3] || DB2_BANDS.dog[0][3] !== 1.95) return 'the sides do not meet at 1.95';
    if (!db2InBand(DB2_BANDS.fav[1], 1.357) && !db2InBand(DB2_BANDS.fav[2], 1.357)) return '1.357 is in no band';
    if (!db2InBand(DB2_BANDS.fav[1], 1.21)) return '1.21 is not a Clear favourite';
    return null;
  },
  // The cumulative charts run on real match dates; season ticks sit on 1 January.
  dates(src) {
    const { db2Ms, db2SeasonTicks } = new Function(fnSource(src, 'db2Ms') + '\n' + fnSource(src, 'db2SeasonTicks') + '\nreturn {db2Ms, db2SeasonTicks};')();
    if (db2Ms(20240101) !== Date.UTC(2024, 0, 1)) return 'db2Ms does not read yyyymmdd as UTC';
    const t0 = Date.UTC(2010, 0, 1), t1 = Date.UTC(2026, 10, 14);
    const ticks = db2SeasonTicks(2010, 2026, 4, t0, t1);
    if (ticks.map(t => t.label).join(',') !== '2010,2014,2018,2022,2026') return 'ticks ' + ticks.map(t => t.label);
    const x22 = ticks.find(t => t.label === '2022').x, want = (Date.UTC(2022, 0, 1) - t0) / (t1 - t0);
    if (Math.abs(x22 - want) > 1e-12) return '2022 tick is not at 1 Jan 2022';
    // Database v3 (export 2026-11-18, CHANGES §4, LOCKED): x = the match number, never the date; seasons are a segment bar
    // placed at each season's first match (db3Seasons over the date-ordered matches).
    const rc = fnSource(src, 'renderCurveCard');
    if (/db2DateX|db2Ms/.test(rc)) return 'the Tour chart x is the match date again';
    if (!/db3Seasons\(ordered\.map/.test(rc)) return 'the season bar is not built from the ordered matches';
    const db3Seasons = new Function(fnSource(src, 'db3Seasons') + '\nreturn db3Seasons;')();
    const ss = db3Seasons([20240105, 20240601, 20250110, 20250120, 20260101]);
    if (JSON.stringify(ss) !== JSON.stringify([{ y: 2024, i0: 0, i1: 2 }, { y: 2025, i0: 2, i1: 4 }, { y: 2026, i0: 4, i1: 5 }])) return 'season segments ' + JSON.stringify(ss);
    return null;
  },
  // Founder review 2026-11-18: a shown yield is green / red at every sample size; founder 2026-11-19: from 1 match (no dash).
  yieldColour(src) {
    const bc = fnSource(src, 'bandCard2'), yl = fnSource(src, 'db3YieldLine');
    if (/SOFT_GATE/.test(bc) || /SOFT_GATE/.test(yl)) return 'the band card still mutes a yield under the soft gate';
    if (!/hard=!g \|\| !g\.n,/.test(yl)) return 'a yield under 30 matches is dashed';
    if (!/ok=n>0, small=/.test(fnSource(src, 'db3BandBox'))) return 'the band box dashes a small sample';
    return null;
  },
  // Founder review 2026-11-18: the Tour column is recomputed under the same round / years / level / surface filters.
  tourUnderFilters(src) {
    if (!/function tbKey\(\)\{ return \[tbSet\(state\.rounds\), state\.yearMin, state\.yearMax, tbSet\(state\.levels\), tbSet\(state\.surfaces\)/.test(src)) return 'the tour index is not keyed on the filters';
    if (!/if\(tbFiltered\(\)\) rows=rows\.filter/.test(fnSource(src, 'tourBaseIndex'))) return 'the tour index does not filter its rows';
    if (!/var baseKnown = isPl \? \(opts\.baseKnown!==false\) : true;/.test(fnSource(src, 'bandCard2'))) return 'the Tournament Tour column is withheld under a filter';
    return null;
  },
  // Founder review 2026-11-18: the Lines field exists under the side / band / archetype / level filters (lines-field-cuts.json).
  fieldCuts(src) {
    if (!/db2LnFieldOK\(\) \? lnFieldStats\(state\.lnFmt, spec\[0\], Math\.round\(rate\*1000\)\/1000, name\) : db2LnCutStats\(spec\[0\]\)/.test(fnSource(src, 'db2LnMetric'))) return 'Field under a filter does not read the cuts';
    const k = new Function('state', 'DB2_LN_ARCH', 'DB2_LN_LEVELS', fnSource(src, 'db2LnCutKey') + '\nreturn db2LnCutKey();');
    const st = { lnFmt: 'bo3', lnSurf: 'All', lnScope: 'l52', lnSide: 'fav', lnBand: null, lnArch: null, lnLevel: null };
    if (k(st, ['A'], ['L']) !== 'bo3|All|l52|fav|-') return 'side cut key ' + k(st, ['A'], ['L']);
    if (k(Object.assign({}, st, { lnBand: 'dog|2', lnArch: 'A' }), ['A'], ['L']) !== 'bo3|All|l52|dog:2|a:0') return 'band + archetype cut key';
    // founder 2026-11-27 ("Build it!"): archetype + level together have their own cut
    if (k(Object.assign({}, st, { lnArch: 'A', lnLevel: 'L' }), ['A'], ['L']) !== 'bo3|All|l52|fav|a:0+l:0') return 'no archetype + level cut key';
    if (!/if\(ai>=0 && li>=0\) Xs\.push\('a:'\+ai\+'\+l:'\+li\);/.test(fnSource(src, 'db2LnCutTally'))) return 'the tally writes no archetype + level cut';
    return null;
  },
  // LN_LADDERS stays a literal (build-lines-field.js slices it) and carries the design's ladders.
  ladders(src) {
    const L = new Function(varSource(src, 'LN_LADDERS') + '\n' + varSource(src, 'LN_GROUPS') + '\nreturn {LN_LADDERS, LN_GROUPS};')();
    if (L.LN_GROUPS.join('|') !== 'Games handicap|Set handicap|Total games') return 'families ' + L.LN_GROUPS;
    const n = f => Object.fromEntries(Object.entries(L.LN_LADDERS[f]).map(([k, v]) => [k, v.length]));
    if (JSON.stringify(n('bo3')) !== JSON.stringify({ 'Games handicap': 20, 'Set handicap': 2, 'Total games': 20 })) return 'bo3 ladder ' + JSON.stringify(n('bo3'));
    if (JSON.stringify(n('bo5')) !== JSON.stringify({ 'Games handicap': 12, 'Set handicap': 2, 'Total games': 6 })) return 'bo5 ladder ' + JSON.stringify(n('bo5'));
    const lab = L.LN_LADDERS.bo3['Games handicap'].map(x => x[0]);
    if (lab[0] !== '−1 games' || lab[10] !== '+1 games') return 'bo3 game handicap labels ' + lab.slice(0, 2);
    return null;
  },
  // Cover is worked out from the score; a push (margin exactly 0 on a whole line) is VOID (founder 2026-11-16): neither
  // covered nor missed, out of the rate.
  push(src) {
    const { lnHit, lnLine } = new Function(fnSource(src, 'lnHit') + '\n' + fnSource(src, 'lnLine') + '\nreturn {lnHit, lnLine};')();
    const r = { sets: [{ p: 6, o: 4 }, { p: 4, o: 6 }, { p: 6, o: 3 }] };   // won by 3 games, 29 games
    if (lnHit(r, 'gm', -3).hit !== null) return 'a push on -3 is not void';
    if (lnHit(r, 'gm', -2.5).hit !== true) return '-2.5 is not covered by a 3-game win';
    if (lnHit(r, 'ov', 29).hit !== null) return 'a push on over 29 is not void';
    const lost = { sets: [{ p: 3, o: 6 }, { p: 4, o: 6 }] };
    const L = lnLine([r, lost], 'gm', -3);
    if (L.n !== 1 || L.hit !== 0 || L.voids !== 1) return 'a void counts in the rate: ' + JSON.stringify(L);
    return null;
  },
  // Best price band needs DB2_BEST_MIN = 20 matches; Vs pk is red below DB2_VSPK_RED = -60 (founder 2026-11-16).
  constants(src) {
    if (!/var DB2_BEST_MIN=20;/.test(src)) return 'Best price band floor is not 20';
    if (!/b\.agg\.n>=DB2_BEST_MIN/.test(src)) return 'Best price band does not read DB2_BEST_MIN';
    if (!/var DB2_VSPK_RED=-60;/.test(src)) return 'Vs pk threshold is not -60';
    if (!/Math\.round\(v\)>=DB2_VSPK_RED \? ' vspk' : ' vspk red'/.test(src)) return 'Vs pk does not take the red below the threshold';
    if (!/\.db2-rv\.vspk\.red, \[data-db-root\] \.db2-rv\.vspk\.red\.on\{ color:var\(--db2-red\); \}/.test(src)) return 'red Vs pk is not --db2-red';
    return null;
  },
  // "How this is built" lives in the "?" hover: no footnote painted under the Tour / Tournament / Player views.
  footnote(src) {
    const a = src.indexOf('  function renderBandView(body){'), b = src.indexOf('  // Database v2 (founder 2026-11-16): "How this is built"');
    if (/renderFootnote\(body\)/.test(src.slice(a, b))) return 'a view still paints the footnote under the page';
    if (!/qs\[i\]\.title=/.test(fnSource(src, 'db2FootIntoQ'))) return 'the footnote is not put in the "?"';
    return null;
  },
  // Field = the field file's median at the format · surface · period slice only; any other filter is a dash.
  field(src) {
    const f = new Function('state', fnSource(src, 'db2LnFieldOK') + '\nreturn db2LnFieldOK;');
    const ok = s => f(Object.assign({ lnSide: 'all', lnBand: null, lnArch: null, lnLevel: null }, s))();
    if (!ok({})) return 'no field on the base slice';
    for (const s of [{ lnSide: 'fav' }, { lnBand: 'fav|0' }, { lnArch: 'Big Server' }, { lnLevel: 'ATP 500' }]) if (ok(s)) return 'a field under ' + JSON.stringify(s);
    if (!/var fm = fs \? fs\.median : null;/.test(fnSource(src, 'db2LnMetric'))) return 'Field is not the field file median';
    return null;
  },
  // Ratings: one period, Last 52 weeks first and the default; no Mental Edge board.
  ratings(src) {
    if (!/ratSurf:'All', ratScope:'last52', ratBoard:'overview'/.test(src)) return 'Ratings does not open on Last 52 weeks';
    const B = new Function(varSource(src, 'DB2_RBOARDS') + '\nreturn DB2_RBOARDS;')();
    if (B.map(b => b[1]).join('|') !== 'Overview|Elo|Serve|Return|Under pressure') return 'boards ' + B.map(b => b[1]);
    if (!/pillGroup\(\[\['last52','Last 52 weeks'\],\['career','Career'\]\]/.test(src)) return 'the period control is not Last 52 weeks · Career';
    return null;
  },
  // The compare page's "All matches" counts each match once: (favourite + underdog) / 2.
  compareOnce(src) {
    const tcProfit = new Function(fnSource(src, 'tcProfit') + '\nreturn tcProfit;')();
    const r = [0, 0, 0, 0, 0, 1.5, 3, 1];   // favourite at 1.50 won
    if (Math.abs(tcProfit(r, 'all') - (0.5 + -1) / 2) > 1e-12) return 'All matches is not (fav + dog) / 2';
    return null;
  },
  // The view switch (Database v3, CHANGES §1): Tour · Tournament · Player · Fade finder · Lines · Ratings.
  tabs(src) {
    const m = [...src.matchAll(/<button(?: class="active")? data-dbview="(\w+)">([^<]+)<\/button>/g)].slice(0, 6).map(x => x[2]);
    if (m.join('|') !== 'Tour|Tournament|Player|Fade finder|Lines|Ratings') return 'tabs ' + m.join(', ');
    return null;
  },
  // founder 2026-11-20: the Fade finder lists a player from FADE_MIN (5) matches and ranks every listed player.
  fadeFloor(src) {
    if (!/var FADE_MIN=5;/.test(src)) return 'FADE_MIN is not 5';
    const f = fnSource(src, 'db3FadeModel');
    if (!/\.filter\(function\(k\)\{ return P\[k\]\.n>=FADE_MIN; \}\)/.test(f)) return 'players under 5 matches are listed';
    if (!/list\.forEach\(function\(x,i\)\{ x\.rank=i\+1; \}\);/.test(f)) return 'a listed player is left unranked';
    return null;
  },
  // founder design 2026-11-20: Players reads the shared Years range, or the last 52 weeks; the label names it.
  playerPeriod(src) {
    const state = { period: 'all', yearMin: null, yearMax: null };
    const code = 'var state=arguments[0]; function dnum(di){ var s=""+di; return Date.UTC(+s.slice(0,4), (+s.slice(4,6))-1, +s.slice(6,8))/86400000; }\n' +
      'function presentYears(){ return [2010,2011,2024,2025,2026]; }\n' + fnSource(src, 'inPeriod') + '\n' + fnSource(src, 'db2PeriodLabel') + '\nreturn {inPeriod, db2PeriodLabel};';
    const { inPeriod, db2PeriodLabel } = new Function(code)(state);
    const anchor = Date.UTC(2026, 10, 14) / 86400000;
    if (!inPeriod(20110301, anchor) || db2PeriodLabel() !== 'Career') return 'Career is not every year';
    state.yearMin = 2024; state.yearMax = 2024;
    if (inPeriod(20230301, anchor) || !inPeriod(20240301, anchor) || db2PeriodLabel() !== 'Season 2024') return 'one season does not read "Season 2024"';
    state.yearMin = 2019; state.yearMax = 2023;
    if (db2PeriodLabel() !== '2019\u20132023') return 'a range does not read 2019–2023';
    state.period = 'w52';
    if (inPeriod(20251101, anchor) || !inPeriod(20251201, anchor) || db2PeriodLabel() !== 'Last 52 weeks') return 'Last 52 weeks is not the year to the archive end';
    if (!/\[\['w52','Last 52 weeks'\],\['all','Career'\]\]/.test(src)) return 'no Last 52 weeks · Career switch';
    if (/trigger\('Period'/.test(src)) return 'the Period menu is back';
    return null;
  },
  // founder 2026-11-20: the swing reads the event's country (catalog, else its city) and Tennis-Data's indoor seasons.
  swing(src) {
    if (!/\['naw','North American winter'\]/.test(src)) return 'no North American winter swing';
    const f = fnSource(src, 'db3SwingOf');
    if (!/db3CatEntry\(nm\)/.test(f) || !/M\.indoor/.test(f)) return 'the swing does not read country + indoor';
    if (/catalogEntryForNames/.test(f)) return 'the swing reads the Database name list (no country there)';
    return null;
  },
  // founder 2026-11-26: the box's Score = the backed side's set scores from the career-history row the sheet click joins
  // (one join, db3CareerRow); tiebreak = the loser's points, " ret." on a retirement; no row / no sets = a dash.
  boxScore(src) {
    const f = new Function(fnSource(src, 'db3ScoreTxt') + '\n' + fnSource(src, 'db3BestRow') + '\nfunction db3CarSur(n){ return String(n).replace(/^[A-Z]\\. /,"").toLowerCase(); }\nreturn {db3ScoreTxt, db3BestRow};');
    const { db3ScoreTxt, db3BestRow } = f();
    const c = { sets: [{ p: 5, o: 7 }, { p: 6, o: 3 }, { p: 6, o: 7, pTb: 11, oTb: 13 }] };
    if (db3ScoreTxt(c, false) !== '5-7 6-3 6-7(11)') return 'his side reads ' + db3ScoreTxt(c, false);
    if (db3ScoreTxt(c, true) !== '7-5 3-6 7-6(11)') return 'the backed opponent side reads ' + db3ScoreTxt(c, true);
    if (db3ScoreTxt({ sets: [{ p: 6, o: 1 }, { p: 1, o: 1 }], retired: true }, false) !== '6-1 1-1 ret.') return 'a retirement is not marked';
    if (db3ScoreTxt({ sets: [] }, false) !== null || db3ScoreTxt(null) !== null) return 'no sets is not a dash';
    const t = Date.parse('2026-10-27');
    const feed = { date: '2026-10-24', eventKey: 1, won: true, opponent: 'A. Zverev' }, arch = { date: '2026-10-17', won: true, opponent: 'A. Zverev' };
    if (db3BestRow([feed], true, t, 'zverev') !== null) return 'a feed row 3 days off joins';
    if (db3BestRow([arch], true, t, 'zverev') !== arch) return 'an archive row 10 days before does not join';
    if (db3BestRow([arch], false, t, 'zverev') !== null) return 'a row with the other result joins';
    if (!/db3CareerRow\(m\)/.test(fnSource(src, 'db3OpenMatch')) || !/db3CareerRow\(m\)/.test(fnSource(src, 'db3FillScore'))) return 'the sheet and the Score column do not share one join';
    if (/No set score in the Database archive/.test(src)) return 'the Score column is still a fixed dash';
    return null;
  },
  // founder 2026-11-26: every box match row sits on one line (Match and Score never wrap; the tracks fit the widest cell)
  oneLine(src) {
    if (!/\.db3-lr \.m\{ min-width:0; white-space:nowrap; \}/.test(src)) return 'the Match cell wraps';
    if (!/\.db3-lr \.sc\{[^}]*white-space:nowrap;/.test(src)) return 'the Score cell wraps';
    if (!/db3FitCols\(bx\);/.test(fnSource(src, 'db3OpenBox'))) return 'the box does not fit its tracks';
    return null;
  },
  // Locked design 2026-11-26, Fade finder: Rank in the page bar (Fade finder only), typed Min. matches, sortable heads with
  // sort marks, the design's grid, an empty state; no 12 months column, no Plays today / tomorrow switch.
  fadeLocked(src) {
    const m = fnSource(src, 'db3FadeModel'), r = fnSource(src, 'renderFade');
    if (!/if\(state\.view==='fade'\) zR\.appendChild\(trigger\('Rank'/.test(src)) return 'no Rank trigger in the Fade finder bar';
    if (/All ranks'\]/.test(r) || /Plays today/.test(r) || /\['l12'/.test(r)) return 'the old rank / plays switches or the 12 months column are back';
    if (!/return P\[nm\]\.n>=minN;/.test(m) || !/parseInt\(state\.fadeMin,10\)/.test(m)) return 'Min. matches does not remove players';
    if (!/placeholder='Any'/.test(r) || !/replace\(\/\\D\/g,''\)\.slice\(0,4\)/.test(r)) return 'Min. matches is not a typed number field';
    if (!/var sortK=SK\[state\.fadeSort\]\?state\.fadeSort:'y';/.test(m)) return 'the heads do not sort';
    if (!/on\?'(?:↓|\\u2193)':'(?:↕|\\u2195)'/.test(r)) return 'no sort mark';
    if (!/grid-template-columns:26px minmax\(128px,1\.1fr\) minmax\(94px,1\.3fr\) 88px 126px 78px 78px 14px; gap:0 8px;/.test(src)) return 'not the locked grid';
    if (!/No players match these filters/.test(r)) return 'no empty state';
    if (!/--db2-dim:\s*#5D6680;/.test(TOKENS)) return 'no --db2-dim token';
    return null;
  },
  // founder 2026-11-27: the Fade finder lists current players only: a match in the 12 months to the archive's end and
  // not on retired-players.json (surname + first initial: "Huesler M.A." meets "M. Huesler").
  fadeCurrent(src) {
    if (!/if\(DB3_RETIRED && DB3_RETIRED\[db3NameKey\(nm, true\)\]\) return false;/.test(src)) return 'retired players are listed';
    if (!/for\(var i=rs\.length-1;i>=0;i--\) if\(rs\[i\]\.d>cut12\) return true;/.test(fnSource(src, 'db3FadeModel'))) return 'the window is not 12 months';
    const f = new Function(fnSource(src, 'db3Fold') + fnSource(src, 'db3TdSur') + fnSource(src, 'db3CarSur') + fnSource(src, 'db3NameKey') + '\nreturn db3NameKey;')();
    if (f('Huesler M.A.', true) !== f('M. Huesler', false)) return 'Huesler M.A. does not meet M. Huesler';
    if (f('Bautista Agut R.', true) !== f('R. Bautista-Agut', false)) return 'a hyphenated surname does not meet';
    if (f('Zverev M.', true) === f('A. Zverev', false)) return 'two brothers share a key';
    if (!/Retired players could not be excluded just now/.test(fnSource(src, 'renderFade'))) return 'a failed retired list is silent';
    const R = JSON.parse(readFileSync(new URL('./retired-players.json', import.meta.url), 'utf8')).retired.map(r => r.name);
    if (!R.includes('M. Huesler')) return 'Huesler is not on retired-players.json';
    return null;
  },
  // Locked design 2026-11-26, Ratings: sort marks, a median chip under every head (no median row), no bold column, centred.
  ratingsLocked(src) {
    const h = fnSource(src, 'db2SortHead');
    if (!/'\\u2195'/.test(h) || !/db2MedChip\(med\)/.test(h)) return 'a head has no sort mark or median chip';
    if (/db2-rmed/.test(src)) return 'the Field median row is back';
    if (/\.db2-rv\.on\{/.test(src) || /db2-rv'\+\(key===c\[0\]\?' on'/.test(src)) return 'the sorted column is bold again';
    if (!/\.db2-rv\{ text-align:center; font-family:var\(--db-mono\); font-size:13px; font-weight:500;/.test(src)) return 'figures are not centred mono 13/500';
    if (!/var tpl='28px 28px minmax\(160px,2\.4fr\) 40px repeat\(3,minmax\(80px,1fr\)\) minmax\(112px,1\.2fr\)';/.test(fnSource(src, 'db2RatOverview'))) return 'not the locked overview grid';
    return null;
  },
  // The design's own colours, read through tokens.css (identical colours).
  tokens(src) {
    const want = { card: '#0E1019', inset: '#0C0E16', raised: '#131623', ink: '#E7E9EE', 'ink-2': '#DDE0EA', muted: '#A3AABE', blue: '#5B9BFF', green: '#3DD68C', red: '#E0616F' };
    for (const [k, v] of Object.entries(want)) if (!new RegExp('--db2-' + k + ':\\s*' + v + ';').test(TOKENS)) return '--db2-' + k + ' is not ' + v;
    if (!/\[data-db-root\]\{ --card:var\(--db2-card\);/.test(src)) return 'the Database does not read the --db2 palette';
    return null;
  },
};

const MUTANTS = [
  ['fade floor gone', 'fadeFloor', s => s.replace(".filter(function(k){ return P[k].n>=FADE_MIN; })", "")],
  ['period ignores years', 'playerPeriod', s => s.replace("return !(state.yearMin!=null && y<state.yearMin) && !(state.yearMax!=null && y>state.yearMax);", "return true;")],
  ['swing back on the name list', 'swing', s => s.replace("var nm=M.tournaments[r[4]], e=db3CatEntry(nm),", "var nm=M.tournaments[r[4]], e=catalogEntryForNames([nm])||{},")],
  ['band edges inclusive', 'bands', s => s.replace("function db2InBand(B, p){ return p>=B[3]-1e-9 && p<B[4]-1e-9; }", "function db2InBand(B, p){ return p>=B[3]-1e-9 && p<=B[4]+1e-9; }")],
  ['coin-flip back at 2.00', 'bands', s => s.replace("['Near coin-flip','1.71','1.94',1.71,1.95]", "['Near coin-flip','1.71','1.99',1.71,2.00]").replace("['Slight underdog','1.95','2.49',1.95,2.50]", "['Slight underdog','2.00','2.49',2.00,2.50]")],
  ['tiebreak shows the winner', 'boxScore', s => s.replace("'('+Math.min(x.pTb,x.oTb)+')'", "'('+Math.max(x.pTb,x.oTb)+')'")],
  ['score not flipped', 'boxScore', s => s.replace("db3ScoreTxt(c, !J.mine)", "db3ScoreTxt(c, false)").replace("var a=flip?x.o:x.p, b=flip?x.p:x.o;", "var a=x.p, b=x.o;")],
  ['score a fixed dash', 'boxScore', s => s.replace('<span class="sc"></span>', '<span class="sc" title="No set score in the Database archive">\u2014</span>')],
  ['match cell wraps', 'oneLine', s => s.replace('.db3-lr .m{ min-width:0; white-space:nowrap; }', '.db3-lr .m{ min-width:0; text-wrap:pretty; }')],
  ['tracks not fitted', 'oneLine', s => s.replace('    db3FitCols(bx);\n    if(spec.wire)', '    if(spec.wire)')],
  ['rank back in the control row', 'fadeLocked', s => s.replace("if(state.view==='fade') zR.appendChild(trigger('Rank'", "if(false) zR.appendChild(trigger('Rank'")],
  ['min matches ignored', 'fadeLocked', s => s.replace("return P[nm].n>=minN;", "return true;")],
  ['heads do not sort', 'fadeLocked', s => s.replace("var sortK=SK[state.fadeSort]?state.fadeSort:'y';", "var sortK='y';")],
  ['no fade empty state', 'fadeLocked', s => s.replace("'<b>No players match these filters</b>", "'<b>Nothing</b>")],
  ['median row back', 'ratingsLocked', s => s.replace("    t.appendChild(hd);\n    rows.forEach", "    t.appendChild(hd); t.appendChild(el('div','db2-rmed'));\n    rows.forEach")],
  ['bold sorted column', 'ratingsLocked', s => s.replace("var v=db2RatOverVal(p,c[0]), s=el('span','db2-rv'+(v==null?' dash':'')", "var v=db2RatOverVal(p,c[0]), s=el('span','db2-rv'+(key===c[0]?' on':'')+(v==null?' dash':'')")],
  ['no sort mark', 'ratingsLocked', s => s.replace("(sorted?(dir==='asc'?'\\u2191':'\\u2193'):'\\u2195')", "(sorted?(dir==='asc'?'\\u2191':'\\u2193'):'')")],
  ['fade window back at 24 months', 'fadeCurrent', s => s.replace("if(rs[i].d>cut12) return true;", "if(rs[i].d>cut24) return true;")],
  ['retired players listed', 'fadeCurrent', s => s.replace("if(DB3_RETIRED && DB3_RETIRED[db3NameKey(nm, true)]) return false;", "")],
  ['terciles back', 'bands', s => s.replace("['Clear favourite','1.21','1.35',1.21,1.36]", "['Firm favourite','1.21','1.35',1.21,1.36]")],
  ['dates back', 'dates', s => s.replace("{ N:n, seasons:db3Seasons(ordered.map(function(r){ return r[0]; }))", "{ N:n, xs:ordered.map(function(r){ return db2Ms(r[0]); }), seasons:db3Seasons(ordered.map(function(r){ return r[0]; }))")],
  ['hard gate dashes again', 'yieldColour', s => s.replace("var hard=!g || !g.n,", "var hard=!g || g.n<HARD_GATE,")],
  ['soft gate mutes', 'yieldColour', s => s.replace("var c=hard ? 'var(--db2-muted)' : y>0", "var c=hard||g.n<SOFT_GATE ? 'var(--db2-muted)' : y>0")],
  ['tour column withheld', 'tourUnderFilters', s => s.replace("var baseKnown = isPl ? (opts.baseKnown!==false) : true;", "var baseKnown = isPl ? (opts.baseKnown!==false) : baselineAllowed();")],
  ['tour index unfiltered', 'tourUnderFilters', s => s.replace("if(tbFiltered()) rows=rows.filter", "if(false) rows=rows.filter")],
  ['no field under a cut', 'fieldCuts', s => s.replace(" : db2LnCutStats(spec[0]);", " : null;")],
  ['no archetype + level key', 'fieldCuts', s => s.replace("var X = ak && lk ? ak+'+'+lk : ak || lk || '-';", "var X = ak && lk ? null : ak || lk || '-'; if(X===null) return null;")],
  ['no archetype + level tally', 'fieldCuts', s => s.replace(" if(ai>=0 && li>=0) Xs.push('a:'+ai+'+l:'+li);", "")],
  ['ticks off 1 January', 'dates', s => s.replace("var x=(Date.UTC(y,0,1)-t0)/(t1-t0);", "var x=(Date.UTC(y,6,1)-t0)/(t1-t0);")],
  ['ladder computed', 'ladders', s => s.replace("  var LN_LADDERS = {", "  var LN_LADDERS = (function(){ return {").replace("  var LN_GROUPS = ['Games", "  var LN_GROUPS_X = 1; var LN_GROUPS = ['Games")],
  ['match shape back', 'ladders', s => s.replace("var LN_GROUPS = ['Games handicap','Set handicap','Total games'];", "var LN_GROUPS = ['Games handicap','Set handicap','Total games','Match shape'];")],
  ['push covered', 'push', s => s.replace("if(kind==='gm'){ var gm=(pg-og)+arg; return { hit: gm>0 ? true : gm<0 ? false : null, margin: gm }; }", "if(kind==='gm'){ var gm=(pg-og)+arg; return { hit: gm>0, margin: gm }; }")],
  ['void in the rate', 'push', s => s.replace("      if(h.hit===null){ voids++; return; }   // a push: void, in no rate\n", "")],
  ['best band floor 30', 'constants', s => s.replace('var DB2_BEST_MIN=20;', 'var DB2_BEST_MIN=30;')],
  ['vs pk uncoloured', 'constants', s => s.replace("(Math.round(v)>=DB2_VSPK_RED ? ' vspk' : ' vspk red')", "' vspk'")],
  ['footnote under the page', 'footnote', s => s.replace("    body.appendChild(renderCurveCard(rows, isTourn));\n    db2FootIntoQ(body);", "    body.appendChild(renderCurveCard(rows, isTourn));\n    renderFootnote(body);")],
  ['field under a filter', 'field', s => s.replace("function db2LnFieldOK(){ return state.lnSide==='all' && state.lnBand==null && !state.lnArch && !state.lnLevel; }", "function db2LnFieldOK(){ return true; }")],
  ['ratings open on Career', 'ratings', s => s.replace("ratSurf:'All', ratScope:'last52', ratBoard:'overview'", "ratSurf:'All', ratScope:'career', ratBoard:'overview'")],
  ['mental edge back', 'ratings', s => s.replace("['up','Under pressure']];", "['up','Under pressure'],['mental','Mental Edge']];")],
  ['all matches counted twice', 'compareOnce', s => s.replace("return side==='fav' ? f : side==='dog' ? d : (f+d)/2;", "return side==='fav' ? f : side==='dog' ? d : f+d;")],
  ['tab order', 'tabs', s => s.replace('          <button data-dbview="lines">Lines</button>\n          <button data-dbview="ratings">Ratings</button>', '          <button data-dbview="ratings">Ratings</button>\n          <button data-dbview="lines">Lines</button>')],
  ['palette not mapped', 'tokens', s => s.replace("[data-db-root]{ --card:var(--db2-card);", "[data-db-root]{ --cardx:var(--db2-card);")],
];

for (const [name, fn] of Object.entries(CHECKS)) test('Database v2 · ' + name, () => { const e = fn(SRC); assert.equal(e, null, e); });
test('CONTROL: every Database v2 mutant is caught', () => {
  const survived = [];
  for (const [name, which, mut] of MUTANTS) {
    const m = mut(SRC);
    if (m === SRC) { survived.push(name + ' (did not apply)'); continue; }
    let r; try { r = CHECKS[which](m); } catch (e) { r = 'threw: ' + e.message; }
    if (r === null) survived.push(name);
  }
  assert.deepEqual(survived, []);
  console.log(`  mutants: ${MUTANTS.length} caught, 0 survived`);
});
