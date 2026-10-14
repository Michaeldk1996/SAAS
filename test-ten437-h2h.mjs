// TEN-437 (founder 2026-10-14) — one head-to-head record everywhere on the site, ATP's official population, guarded.
//
//   1. Golden-pair gate: tools/fixtures/ten437/h2h-golden-pairs.json holds 49 pairs with ATP's OFFICIAL W–L (the Record
//      fields of atptour.com's H2H endpoint, checked 2026-10-14) and the live career-history rows each pair's join reads
//      (266 of them keyless TML archive rows — the rows the old eventKey-only join dropped). The PRODUCTION function,
//      h2h-core.js H2HCore.joinMeetings, must reproduce ATP on every pair. Two pairs are known gaps (a default ATP counts
//      that our feed never delivers) and are pinned to their recorded value, so any change turns this red.
//   2. The UI path: the Match analysis H2H tab's own code (the TEN-263 block, sliced out of the page and executed) reads
//      Medvedev–Tsitsipas as 10–5 over 15 from the golden rows; the H2H page calls the same join with the same inputs.
//   3. De-duplication: Shanghai 2019 (archive 07.10, feed 12.10) is one meeting.
//   4. A failed history load is a load error with a Retry, never "no meetings", and never cached (modal and page).
//   5. Single source: no shipped display code reads m.h2h's record or meetings, the only meeting builders are the two
//      callers of H2HCore.joinMeetings, and no other file defines a meeting join. The model (h2h-model/, m.h2h.matches) is
//      the one reader outside — excluded by the founder until he rules on its recency weighting.
// Mutations that turn it red: tools/test-ten437-mutants.js (each applied to a copy of h2h-core.js / the page).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CORE_PATH = process.env.TEN437_CORE || join(HERE, 'h2h-core.js');
const H2HCore = require(CORE_PATH);
const CORE_SRC = readFileSync(CORE_PATH, 'utf8');
const html = readFileSync(process.env.TEN437_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
const G = JSON.parse(readFileSync(join(HERE, 'tools/fixtures/ten437/h2h-golden-pairs.json'), 'utf8'));

function slice(name, src = html) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  let d = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) break; }
  return src.slice(start, i + 1);
}
const rec = p => H2HCore.record(H2HCore.joinMeetings(p.a, p.b, p.chA, p.chB, p.nk, []));
const fmt = r => `${r.a}–${r.b} over ${r.n}`;

// ── 1 · the golden-pair gate ───────────────────────────────────────────────────────────────────────────────────────────
// Mutations: the eventKey-only join back (keyless rows skipped), a 2021 date cut-off, Challengers / qualifying /
// exhibitions back in, walkovers counted, the namesake rule dropped, the dedupe off.
test('golden pairs: the production join reproduces ATP\'s official W–L on every pair (known gaps pinned)', () => {
  const off = [];
  for (const p of G.pairs) {
    const r = rec(p), want = p.knownGap ? p.knownGap.ours : p.atp;
    if (r.a !== want.a || r.b !== want.b || r.n !== want.n)
      off.push(`${p.a.short} – ${p.b.short}: ours ${fmt(r)}, ${p.knownGap ? 'pinned known gap ' : 'ATP '}${fmt(want)}${p.note ? ' (' + p.note + ')' : ''}`);
  }
  assert.equal(off.length, 0, `${off.length} of ${G.pairs.length} pairs diverge:\n  ${off.join('\n  ')}`);
});
test('golden fixture: 18 scale-table pairs + edge cases, each with its ATP source and check date; keyless archive rows in', () => {
  assert.ok(G.pairs.length >= 28, `${G.pairs.length} pairs`);
  for (const p of G.pairs) {
    assert.match(p.checkedOn, /^\d{4}-\d{2}-\d{2}$/, `${p.a.short} – ${p.b.short}: no check date`);
    assert.match(p.source, /^https:\/\/www\.atptour\.com\/en\/-\/www\/h2h\/[a-z0-9]+\/[a-z0-9]+$/, `${p.a.short} – ${p.b.short}: no ATP source`);
    assert.equal(p.atp.n, p.atp.a + p.atp.b);
  }
  const has = (a, b) => G.pairs.some(p => p.a.short === a && p.b.short === b && !p.knownGap);
  for (const [a, b] of [['D. Medvedev', 'S. Tsitsipas'], ['N. Djokovic', 'R. Nadal'], ['A. Zverev', 'D. Medvedev'], ['F. Tiafoe', 'M. Kecmanovic'],
    ['C. Alcaraz', 'J. Sinner'], ['N. Djokovic', 'R. Federer']]) assert.ok(has(a, b), `${a} – ${b} must be an exact golden pair`);
  const edge = G.pairs.filter(p => !p.knownGap && /challenger|walkover|davis cup/i.test(p.note));
  assert.ok(edge.length >= 3, `${edge.length} Challenger / walkover / Davis Cup edge pairs`);
  const keyless = G.pairs.reduce((n, p) => n + p.chA.concat(p.chB).filter(x => x.eventKey == null).length, 0);
  assert.ok(keyless >= 200, `${keyless} keyless archive rows — the gate must exercise the rows the old join dropped`);
  const gaps = G.pairs.filter(p => p.knownGap);
  assert.ok(gaps.length <= 2 && gaps.every(p => /default/.test(p.knownGap.reason)), 'only the two reported default gaps may be pinned');
});
test('the headline pairs read exactly as ATP: Medvedev–Tsitsipas 10–5 / 15, Djokovic–Nadal 31–29 / 60, Zverev–Medvedev 8–14 / 22, Tiafoe–Kecmanovic 5–0 / 5', () => {
  const by = (a, b) => G.pairs.find(p => p.a.short === a && p.b.short === b);
  assert.deepEqual(rec(by('D. Medvedev', 'S. Tsitsipas')), { a: 10, b: 5, n: 15 });
  assert.deepEqual(rec(by('N. Djokovic', 'R. Nadal')), { a: 31, b: 29, n: 60 });
  assert.deepEqual(rec(by('A. Zverev', 'D. Medvedev')), { a: 8, b: 14, n: 22 });
  assert.deepEqual(rec(by('F. Tiafoe', 'M. Kecmanovic')), { a: 5, b: 0, n: 5 });
});

// ── 2 · the UI path: the Match analysis tab's own code, and the H2H page's call ─────────────────────────────────────────
const HOUSE_RATINGS_SRC = readFileSync(join(HERE, 'house-ratings.js'), 'utf8');
function block() {
  const a = html.indexOf('/* =====================================================================\n   TEN-263 ');
  const b = html.indexOf('/* ---------- TOURNAMENT SUB-TAB ---------- */');
  assert.ok(a > 0 && b > a, 'TEN-263 block not found');
  return html.slice(a, b);
}
const PS_TOUR_META_SRC = /const PS_TOUR_META = \(\(\) => \{[\s\S]*?\n\}\)\(\);/.exec(html)[0];
const HELPERS = ['escapeHtml', 'surnameFirstName', 'psShortName', 'formIni', 'ppCleanTournamentName', 'psNormTour', 'psTourMeta', 'psRoundAbbr', 'h2hRoundLabel', 'maRoundName', 'eventKeyOfMatch'];
const MODAL = new Function('ENV', `
  const document = { addEventListener(){}, getElementById(){ return null; }, querySelector(){ return null; }, querySelectorAll(){ return []; },
    head: { appendChild(){} }, createElement(){ return { set textContent(v){} }; } };
  const console = { warn(){}, log(){}, error(){} };
  const fetch = () => Promise.reject(new Error('no network in the test'));
  const playerProfiles = ENV.profiles;
  function formPanelHtml(){ return ''; } function ensureFormPanelTabs(){} function ensureFormRows(m){ return Promise.resolve(m); }
  function loadCareerHistory(k){ return ENV.loadCareerHistory(k); } function careerHistoryAnswered(k){ return ENV.answered(k); }
  function loadPlayerProfiles(){ return Promise.resolve(); }
  function ensureStyleMeetings(m){ return Promise.resolve(m); } function ensurePsMatrix(){ return Promise.resolve(); }
  function ppStyleFor(){ return null; } function psArchFor(){ return null; } function styleMeetRowsFor(){ return []; }
  function openPlayerProfileFromMatch(){} function aGoTab(){} function aBuilt(){ return false; } function aPaint(){}
  const HouseRatings = (function(){ const window = {}; ${HOUSE_RATINGS_SRC}; return window.HouseRatings; })();
  const H2HCore = (function(){ const window = {}; ${CORE_SRC}; return window.H2HCore; })();
  ${PS_TOUR_META_SRC}
  ${HELPERS.map(n => slice(n)).join('\n')}
  ${block()}
  return { fhMeetings, fhH2hMeetingRows, fhEnsureH2hData, fhBuildH2H, fhStateFor };
`);
const ENV = { profiles: {}, loadCareerHistory: () => Promise.resolve([]), answered: () => true };
const S = MODAL(ENV);
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/&#39;|&#x27;/g, "'").replace(/\s+/g, ' ').trim();

// Mutation: the tab back on m.h2h / the eventKey-only join.
test('UI: the Match analysis H2H tab\'s own code reads Medvedev–Tsitsipas 10–5 over 15 from the golden rows (m.h2h ignored)', () => {
  const p = G.pairs.find(x => x.a.short === 'D. Medvedev' && x.b.short === 'S. Tsitsipas');
  const m = { id: 'upcoming-12170285', p1: 'D. Medvedev', p2: 'S. Tsitsipas', p1Key: 1093, p2Key: 1906, surface: 'hard', date: '2026-10-14',
    h2h: { matches: [{ date: '2024-10-09', p1Won: true, eventKey: 11989262, level: 'ATP' }] },   // the old 8-row api-tennis list: never read
    _fhH2hData: true, _fhCh: [p.chA, p.chB], _fhCloses: [null, null], _fhElo: null, p1RecentFormMatches: [], p2RecentFormMatches: [] };
  const E = S.fhMeetings(m).filter(r => !r.wo);
  assert.equal(E.length, 15); assert.equal(E.filter(r => r.won).length, 10);
  S.fhStateFor(m);
  const t = text(S.fhBuildH2H(m));
  assert.match(t, /D\. Medvedev 10 – 5 S\. Tsitsipas/);
  assert.match(t, /Medvedev leads · 15 meetings/);
  assert.match(t, /0 of 15 meetings priced/, 'the price coverage line counts the full population (Y = 15)');
});
test('UI: the H2H page builds its meetings with the same join and the same inputs as the tab', () => {
  assert.equal((html.match(/H2HCore\.joinMeetings\(/g) || []).length, 2, 'exactly two callers: the tab (fhH2hMeetingRows) and the page (h2hPairFor)');
  assert.match(slice('fhH2hMeetingRows'), /H2HCore\.joinMeetings\(sfH2hSide\(m\.p1Key, m\.p1\), sfH2hSide\(m\.p2Key, m\.p2\), ch\[0\], ch\[1\], sfH2hNkCount\(\), own\)/);
  const page = slice('h2hPairFor');
  assert.match(page, /const ownF = fn\('sfH2hOwnEks'\), nkF = fn\('sfH2hNkCount'\);/);
  assert.match(page, /H2HCore\.joinMeetings\(a, b, S\.chA, S\.chB, nkF \? nkF\(\) : NK_COUNT, own\)/);
  assert.match(slice('fhMeetings'), /const list = fhH2hMeetingRows\(m\);/, 'Key factors and the tab read fhMeetings');
  assert.match(slice('kfH2HCard'), /fhMeetings\(m\)/, 'Key factors\' H2H box reads the tab\'s rows');
});

// Mutation: the namesake rule dropped. A row only one side records counts only when the name it carries is unique on the
// roster (TEN-263): "Z. Zhang" is Zhizhen (590) AND Ze — Machac's one-sided rows naming "Z. Zhang" are never credited
// to a pair whose other side has no history to confirm them.
test('namesakes: a one-sided row naming a shared surname + initial is never credited (TEN-263); a unique name is', () => {
  const p = G.pairs.find(x => x.a.short === 'T. Machac' && x.b.short === 'Z. Zhang');
  const oneSided = Object.assign({}, p, { chB: [] });
  assert.deepEqual(H2HCore.record(H2HCore.joinMeetings(oneSided.a, oneSided.b, oneSided.chA, [], { 'machac|t': 1, 'zhang|z': 2 }, [])), { a: 0, b: 0, n: 0 },
    'two roster players are "Z. Zhang": Machac\'s own rows cannot say which one he met');
  assert.deepEqual(H2HCore.record(H2HCore.joinMeetings(oneSided.a, oneSided.b, oneSided.chA, [], { 'machac|t': 1, 'zhang|z': 1 }, [])), { a: 2, b: 0, n: 2 },
    'control: a unique name is credited');
  assert.deepEqual(rec(p), { a: 2, b: 0, n: 2 }, 'both histories loaded: the eventKey pairs them whatever the roster says');
});

// Mutations: the windowed pairing off (archive meetings unpriced again), a close shared by two meetings, a team tie
// priced off a tour match. (TEN-437 review finding 1: Dimitrov–Goffin, ATP Finals 2017 RR + F, both archive rows dated
// 2017-11-12, same winner.)
test('prices attach to meetings: archive meetings take their own close; a shared or missing close is a dash, never a neighbour\'s', () => {
  const sh = rows => ({ rows, cap: [] });
  const arc = (date, t, rd, won, o) => Object.assign({ date, tournament: t, round: rd, won, opponent: 'D. Goffin', level: 'atp', result: won ? '2 - 0' : '0 - 2' }, o || {});
  const mk = (chA, cl) => ({ id: 'upcoming-77', p1: 'G. Dimitrov', p2: 'D. Goffin', p1Key: 11, p2Key: 22, surface: 'hard', date: '2026-10-14',
    _fhH2hData: true, _fhCh: [chA, []], _fhCloses: [sh(cl), null], _fhElo: null, p1RecentFormMatches: [], p2RecentFormMatches: [] });
  const close = (date, won, P) => ({ date, opp: 'Goffin D.', won, P, B: null, ret: false, oppKey: '22' });
  const two = [arc('2017-11-12', 'Tour Finals', 'RR', true), arc('2017-11-12', 'Tour Finals', 'F', true)];
  const px = m => S.fhMeetings(m).map(r => [r.round, r.price]);
  assert.deepEqual(px(mk(two, [close('2017-11-13', true, [1.5, 2.6]), close('2017-11-19', true, [1.37, 3.48])])), [['RR', 1.5], ['F', 1.37]], 'round order pairs each meeting with its own close');
  assert.deepEqual(px(mk(two, [close('2017-11-19', true, [1.37, 3.48])])), [['RR', null], ['F', null]], 'one close for two meetings: both dash, never the final\'s price on the RR');
  assert.deepEqual(px(mk([arc('2019-02-01', 'Davis Cup QLS R1: BEL vs BUL', 'RR', true), arc('2019-02-10', 'Sofia', 'SF', true)], [close('2019-02-15', true, [1.6, 2.3])])),
    [['RR', null], ['SF', 1.6]], 'a team tie takes no Tennis-Data close; the tour match keeps its own');
  assert.deepEqual(px(mk([arc('2021-02-08', 'Australian Open', 'SF', true)], [close('2021-02-19', true, [1.46, 2.93])])), [['SF', 1.46]], 'a Slam SF 11 days after the event start is priced');
});

// ── 3 · de-duplication ─────────────────────────────────────────────────────────────────────────────────────────────────
// Mutation: dedupe off (Shanghai 2019 counted twice), or the window too short for an archive date.
test('dedupe: Shanghai 2019 SF is ONE meeting — archive row 07.10 (event start, no eventKey) and feed row 12.10 (match day)', () => {
  const A = { full: 'Daniil Medvedev', short: 'D. Medvedev' }, B = { full: 'Stefanos Tsitsipas', short: 'S. Tsitsipas' };
  const arc = { date: '2019-10-07', tournament: 'Shanghai Masters', round: 'SF', opponent: 'S. Tsitsipas', won: true, result: '2 - 0', level: 'atp', src: 'archive' };
  const feed = { date: '2019-10-12', tournament: 'ATP Shanghai', round: 'Semi-finals', opponent: 'D. Medvedev', won: false, result: '0 - 2', level: 'atp', eventKey: 11702704, src: 'fixtures' };
  const out = H2HCore.joinMeetings(A, B, [arc], [feed], {}, []);
  assert.equal(out.length, 1, `Shanghai 2019 counted ${out.length} times`);
  assert.equal(out[0].eventKey, 11702704, 'the keyed row is kept (it reaches the match-stats shards)');
  // controls: a different event, a contradicting round, or the other winner in the window are separate meetings
  assert.equal(H2HCore.joinMeetings(A, B, [arc], [Object.assign({}, feed, { tournament: 'ATP Vienna' })], {}, []).length, 2);
  assert.equal(H2HCore.joinMeetings(A, B, [arc], [Object.assign({}, feed, { round: 'Final' })], {}, []).length, 2);
  assert.equal(H2HCore.joinMeetings(A, B, [arc], [Object.assign({}, feed, { won: true, result: '2 - 0' })], {}, []).length, 2);
  // the golden Medvedev–Tsitsipas pair with Tsitsipas's copy of Shanghai 2019 coming from the feed instead of the archive
  // (the shape the pipeline's per-player hole fill produces: one side archive, the other side feed) still reads 10–5 / 15
  const p = G.pairs.find(x => x.a.short === 'D. Medvedev' && x.b.short === 'S. Tsitsipas');
  const chB = p.chB.filter(y => !(y.date === '2019-10-07' && /Shanghai/.test(y.tournament))).concat([feed]);
  assert.equal(chB.length, p.chB.length, 'one copy swapped for the other');
  assert.deepEqual(H2HCore.record(H2HCore.joinMeetings(p.a, p.b, p.chA, chB, p.nk, [])), { a: 10, b: 5, n: 15 });
  // a meeting BOTH histories already hold is never merged with another row of its event (no false merge of a real one)
  const bothArc = [Object.assign({}, arc, { round: 'RR' })], bothArcB = [{ date: '2019-10-07', tournament: 'Shanghai Masters', round: 'RR', opponent: 'D. Medvedev', won: false, result: '0 - 2', level: 'atp' }];
  assert.equal(H2HCore.joinMeetings(A, B, bothArc, bothArcB.concat([Object.assign({}, feed, { round: '' })]), {}, []).length, 2);
});

// ── 4 · a failed history load ──────────────────────────────────────────────────────────────────────────────────────────
// Mutation: the failed load cached as "answered" (back to "no meetings on record"), or the Retry gone.
test('failed load (Match analysis): a history that did not load reads "could not load" + Retry, is not cached, and retries', async () => {
  ENV.loadCareerHistory = () => Promise.resolve([]); ENV.answered = k => String(k) !== '1906';
  const m = { id: 'upcoming-1', p1: 'D. Medvedev', p2: 'S. Tsitsipas', p1Key: 1093, p2Key: 1906, surface: 'hard', date: '2026-10-14', p1RecentFormMatches: [], p2RecentFormMatches: [] };
  await S.fhEnsureH2hData(m);
  assert.equal(m._fhH2hData, undefined, 'a failed load is never the answer');
  assert.deepEqual(m._fhH2hFailed, ['S. Tsitsipas']);
  assert.equal(m._fhH2hP, null, 'the promise memo is released');
  S.fhStateFor(m);
  const t = text(S.fhBuildH2H(m));
  assert.match(t, /Head-to-head could not load Match history for S\. Tsitsipas did not load/);
  assert.match(t, /Retry/);
  assert.doesNotMatch(t, /no meeting on record|No previous meetings/i);
  ENV.answered = () => true; m._fhH2hFailed = null;
  await S.fhEnsureH2hData(m);
  assert.equal(m._fhH2hData, true, 'control: an answered load is used');
});
test('failed load (H2H page): the pair is "failed", never "ready" with no meetings; Retry and a new visit fetch again', async () => {
  const P = new Function('ENV', `
    const _h2hPairs = {}; let _h2hDbSt = 'idle'; let NK_COUNT = {}; const H2HCore = ENV.core;
    function render(){ ENV.renders++; } function h2hEnsureDb(){}
    const fn = n => ENV.fns[n] || null;
    ${slice('h2hRetryPair')}
    ${slice('h2hPairFor')}
    return { h2hPairFor, h2hRetryPair, pairs: _h2hPairs };`)
  ;
  let loads = 0;
  const env = { core: H2HCore, renders: 0, fns: { loadCareerHistory: () => { loads++; return Promise.resolve([]); }, careerHistoryAnswered: k => k !== '1906' } };
  const X = P(env);
  const a = { key: '1093', short: 'D. Medvedev', full: 'Daniil Medvedev' }, b = { key: '1906', short: 'S. Tsitsipas', full: 'Stefanos Tsitsipas' };
  assert.equal(X.h2hPairFor(a, b).st, 'loading');
  await new Promise(r => setTimeout(r, 0));
  const S1 = X.pairs['1093|1906'];
  assert.equal(S1.st, 'failed'); assert.deepEqual(S1.failedNames, ['S. Tsitsipas']); assert.equal(S1.rows, null, 'no meeting list built off a failed load');
  X.h2hRetryPair();
  assert.equal(X.pairs['1093|1906'], undefined, 'Retry drops the failed pair');
  env.fns.careerHistoryAnswered = () => true;
  X.h2hPairFor(a, b); await new Promise(r => setTimeout(r, 0));
  assert.equal(X.pairs['1093|1906'].st, 'ready'); assert.equal(loads, 4, 'both histories fetched again');
  assert.match(slice('h2hCard'), /if \(h\.failed\) return card\([\s\S]*Head-to-head could not load[\s\S]*H2HPage\._h2hRetry\(\)/);
  assert.match(slice('ensureInit'), /if \(visit && typeof _h2hPairs !== 'undefined'\) Object\.keys\(_h2hPairs\)\.forEach\(k => \{ if \(_h2hPairs\[k\] && _h2hPairs\[k\]\.st === 'failed'\) delete _h2hPairs\[k\]; \}\);/);
});

// ── 5 · single source ──────────────────────────────────────────────────────────────────────────────────────────────────
// Every code file the site ships (tools/publish-site.mjs CODE_REQUIRED) is display code. The model lives in h2h-model/
// and the pipeline (not shipped): its m.h2h.matches input is the one reader outside h2h-core.js, by ruling.
test('single source: no shipped display code reads m.h2h\'s record or meetings; the only meeting builders call H2HCore.joinMeetings', async () => {
  const { CODE_REQUIRED } = await import(join(HERE, 'tools/publish-site.mjs'));
  const shipped = [...readFileSync(join(HERE, 'tools/site-code.sh'), 'utf8').matchAll(/^cp ([^"$\n]+?) "\$SITE\/"/gm)].flatMap(m => m[1].trim().split(/\s+/));
  const files = [...new Set(CODE_REQUIRED.concat(shipped))].filter(f => /\.(html|js)$/.test(f) && !/[*]/.test(f));
  assert.ok(files.includes('trading-report.js') && files.includes('admin.html'), 'every file the site ships is scanned');
  assert.ok(files.includes('h2h-core.js') && files.includes('bsp-consult-dashboard.html'), 'h2h-core.js is published with the page');
  const READ = /\.h2h\s*(?:\?\.|\.)\s*(?:record|matches|p1Wins|p2Wins)\b|\b(?:m|match|mm|x|row|card|fx)\s*(?:\?\.|\.)\s*h2h\b(?![-\w])|\[\s*['"]h2h['"]\s*\]|\{\s*(?:[\w$]+\s*,\s*)*h2h\s*(?:,|\})/;
  const hits = [];
  for (const f of files) {
    const fp = join(HERE, f); if (f !== 'bsp-consult-dashboard.html' && !existsSync(fp)) continue;
    const src = f === 'bsp-consult-dashboard.html' ? html : readFileSync(fp, 'utf8');
    // code only: a // comment, a /* … */ block line or a ` * ` doc line names m.h2h in prose, it reads nothing
    src.split('\n').forEach((l, i) => { if (/^\s*(\*|\/\*)/.test(l)) return; if (READ.test(l.replace(/\/\/.*$/, ''))) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 120)}`); });
    if (f !== 'h2h-core.js') assert.doesNotMatch(src, /function\s+\w*(?:joinMeetings|JoinMeetings|AllMeetingRows|MeetingList)\s*\(/, `${f} defines its own meeting join`);
  }
  assert.equal(hits.length, 0, `display code reads m.h2h:\n  ${hits.join('\n  ')}`);
  // Every meeting-named function in the page, named: a new one must be added here on purpose (and must not build a
  // pair's meetings outside H2HCore). Style meetings are a player against an archetype, not a pair.
  const named = [...new Set((html.match(/function [A-Za-z0-9_]*[Mm]eet[A-Za-z0-9_]*\(/g) || []).map(s => s.slice(9, -1)))].sort();
  assert.deepEqual(named, ['_styleMeetSlug', 'ensureStyleMeetings', 'fhH2hMeetingRows', 'fhMeetings', 'fhNoMeetingCards', 'h2hOpenMeeting',
    'loadStyleMeetIndex', 'loadStyleMeetShard', 'ps2MeetCard', 'ps2Meeting', 'psFmtMeetDate', 'psGroupMeetings', 'styleMeetRowsFor']);
  // the model (founder ruling 2026-10-14, card edd72529): its H2H input is the SAME list — the pipeline hands
  // modelH2hMatches (H2HCore over career-history) to runModel as h2h.matches; executed in "model" below
  const pipe = readFileSync(join(HERE, 'bsp-pipeline.js'), 'utf8');
  assert.match(pipe, /h2h: Object\.assign\(\{\}, m\.h2h \|\| \{\}, \{ matches: modelH2hMatches\(m, h2hIn\) \}\) \}\) : m;\n\s*result = runModel\(mm\);/,
    'the model runs on the screens\' H2H list');
});
test('population constants are ATP\'s (report B, 2026-10-14) and the excluded-event list is the pipeline\'s', () => {
  assert.deepEqual(H2HCore.H2H_LEVELS, ['atp']);
  const P = require(join(HERE, 'bsp-pipeline.js'));
  assert.equal(H2HCore.H2H_NOT_COUNTED.source, P.H2H_NOT_ATP_RECORD.source);
  for (const t of ['ATP Laver Cup', 'ATP Davis Cup', 'Olympic Games', 'ATP United Cup', 'ATP Cup', 'Next Gen Finals']) assert.ok(H2HCore.inPopulation({ level: 'atp', tournament: t }), t);
  for (const t of ['ATP Hopman Cup', 'Six Kings Slam', 'UTS London']) assert.ok(!H2HCore.inPopulation({ level: 'atp', tournament: t }), t);
  assert.ok(!H2HCore.inPopulation({ level: 'chitf', tournament: 'Bergamo' }), 'Challenger');
  assert.ok(!H2HCore.inPopulation({ level: 'atp', tournament: 'Wimbledon', round: 'Qualifying' }), 'qualifying');
  assert.deepEqual(H2HCore.record([{ won: true, walkover: true }, { won: true, result: '0 - 0' }, { won: false, retired: true, result: '1 - 0', sets: [{ p: 6, o: 4 }, { p: 1, o: 0 }] }]),
    { a: 0, b: 1, n: 1 }, 'walkovers (flag or no set played) listed, never counted; a retirement counts');
});

// ── 6 · the pipeline reconciliation (tools/h2h-reconcile.mjs, run on the store each pipeline run builds) ─────────────────
// Mutations: the drop check off, the ATP floor off.
test('reconcile: a total below the previous run fails; an exact pair below ATP fails with no previous run; an equal run passes', async () => {
  const { reconcile, goldenHash } = await import(join(HERE, 'tools/h2h-reconcile.mjs'));
  const golden = { checkedOn: G.checkedOn, pairs: G.pairs.filter(p => ['D. Medvedev|S. Tsitsipas', 'A. Zverev|S. Wawrinka'].includes(p.a.short + '|' + p.b.short)) };
  const store = {}; golden.pairs.forEach(p => { store[p.a.key] = (store[p.a.key] || []).concat(p.chA); store[p.b.key] = (store[p.b.key] || []).concat(p.chB); });
  const names = ['D. Medvedev', 'S. Tsitsipas', 'A. Zverev', 'S. Wawrinka'];
  const h = goldenHash(golden);
  const ok = reconcile({ golden, shard: k => store[k] || null, names, previous: { total: 20, golden: h } });
  assert.equal(ok.total, 20); assert.equal(ok.ok, true, ok.errors.join('; '));
  const drop = reconcile({ golden, shard: k => store[k] || null, names, previous: { total: 21, golden: h } });
  assert.equal(drop.ok, false); assert.match(drop.errors.join(), /fell from 21 \(previous run\) to 20/);
  const rebuilt = reconcile({ golden, shard: k => store[k] || null, names, previous: { total: 21, golden: 'another fixture' } });
  assert.equal(rebuilt.ok, true, 'a rebuilt golden fixture resets the baseline (a reviewed code change), never a silent pass');
  assert.equal(rebuilt.fixtureChanged, true);
  // the 2018-2021 archive rows gone from both shards (the TEN-437 failure): below ATP's 15 even with no previous file
  const cut = k => (store[k] || []).filter(x => x.eventKey != null);
  const floor = reconcile({ golden, shard: cut, names, previous: null });
  assert.equal(floor.ok, false); assert.match(floor.errors.join(), /D\. Medvedev – S\. Tsitsipas: 7 meetings, below ATP's 15/);
});

// ── 7 · the model reads the screens' list (founder ruling 2026-10-14, card edd72529) ─────────────────────────────────────
// Mutation: the model back on the api-tennis list. Age bands and tiers unchanged (config.js untouched by this ruling).
test('model: its H2H layer runs on the ATP-rule list — Medvedev–Tsitsipas 10–5 over 15, the age bands and tiers unchanged', () => {
  process.env.DOTENV_CONFIG_QUIET = 'true';
  const P = require(join(HERE, 'bsp-pipeline.js'));
  const p = G.pairs.find(x => x.a.short === 'D. Medvedev' && x.b.short === 'S. Tsitsipas');
  const store = { [p.a.key]: p.chA, [p.b.key]: p.chB };
  const m = { id: 'upcoming-12170285', p1: 'D. Medvedev', p2: 'S. Tsitsipas', p1Key: p.a.key, p2Key: p.b.key, surface: 'hard', date: '2026-10-14' };
  const rows = P.modelH2hMatches(m, { readShard: k => store[k] || null, names: ['D. Medvedev', 'S. Tsitsipas'], finishedBoard: [] });
  assert.equal(rows.length, 15); assert.equal(rows.filter(r => r.p1Won).length, 10);
  assert.ok(rows.every(r => r.level === 'ATP' && typeof r.p1Won === 'boolean' && /^\d+ - \d+$/.test(r.result)), 'the row shape buildH2HMatchList writes');
  const { h2h } = require(join(HERE, 'h2h-model/adjustments.js'));
  const out = h2h({ match: Object.assign({}, m, { h2h: { matches: rows } }), surface: 'hard' });
  assert.match(out.detail, /^H2H 10-5 \(15 meetings; 12 on Hard/);
  const cfg = require(join(HERE, 'h2h-model/config.js')).adjustments.h2h;
  assert.deepEqual([cfg.recencyYears, cfg.recencyWeight, cfg.tier1MinN, cfg.tier2MinN, cfg.tierMult],
    [{ recent: 2, mid: 4 }, { recent: 1.0, mid: 0.6, old: 0.2 }, 8, 3, { t1: 1.0, t2: 0.45, t3: 0.10 }], 'age bands and tiers as ruled: unchanged');
});

// ── 8 · defaults count, as ATP counts them (founder ruling 2026-10-14, card edd72529) ────────────────────────────────────
// api-tennis marks a default "Awarded" (Fils v M. Ymer, Lyon 2023 R16: "0 - 0", First Player). Mutations: "Awarded" out
// of RECORD_STATUSES again; a 0 - 0 default read as a walkover.
test('defaults: an "Awarded" fixture is a flagged history row, counted in the year tally, and never a walkover', () => {
  process.env.DOTENV_CONFIG_QUIET = 'true';
  const P = require(join(HERE, 'bsp-pipeline.js'));
  const f = { event_key: 11865152, event_date: '2023-05-24', event_status: 'Awarded', event_type_type: 'Atp Singles', tournament_key: 1, tournament_name: 'ATP Lyon',
    tournament_round: 'ATP Lyon - 1/8-finals', event_first_player: 'A. Fils', first_player_key: 1759, event_second_player: 'M. Ymer', second_player_key: 1976,
    event_final_result: '0 - 0', event_winner: 'First Player', event_qualification: 'False', scores: [] };
  const surf = new Map([['1', 'clay']]);
  const rows = P.playerMatchHistory([f], 1759, 2026, surf, new Map());
  assert.equal(rows.length, 1, 'the default is a history row');
  assert.equal(rows[0].won, true); assert.equal(rows[0].defaulted, true);
  const loser = P.playerMatchHistory([f], 1976, 2026, surf, new Map());
  assert.equal(loser.length, 1); assert.equal(loser[0].won, false);
  const y = P.buildAllTierYearly([f], 1759, {}, 2026, surf, new Map());
  const t = (y.find(r => r.year === '2023') || {}).atp || {};
  assert.deepEqual(t.total, { won: 1, lost: 0 }, 'the year tally counts it (lockstep with the row list)');
  // recent form (TEN-437 review): the default is a flagged form row; an "Awarded" fixture with no winner is no row at all
  const form = P.recentFormFromFixtures([f, Object.assign({}, f, { event_key: 2, event_date: '2023-05-20', event_winner: null })], 1759, surf);
  const fm = form.matches;
  assert.equal(fm.length, 1, 'the no-winner fixture is not a form row (Bacaloni–Tepmahc, Monastir 2022)');
  assert.equal(fm[0].defaulted, true);
  assert.equal(H2HCore.isWalkover({ result: '0 - 0', defaulted: true }), false, 'a 0 - 0 default is a meeting');
  assert.equal(H2HCore.isWalkover({ result: '0 - 0' }), true, 'control: a 0 - 0 row with no flag is still a walkover');
  const fr = { date: '2023-05-24', tournament: 'ATP Lyon', round: '1/8-finals', opponent: 'M. Ymer', won: true, result: '0 - 0', level: 'atp', eventKey: 11865152, defaulted: true };
  assert.deepEqual(H2HCore.record(H2HCore.joinMeetings({ full: 'A. Fils', short: 'A. Fils' }, { full: 'M. Ymer', short: 'M. Ymer' }, [fr],
    [Object.assign({}, fr, { opponent: 'A. Fils', won: false })], {}, [])), { a: 1, b: 0, n: 1 }, 'Fils–M. Ymer = ATP 1–0');
  const m = { id: 'upcoming-1', p1: 'A. Fils', p2: 'M. Ymer', p1Key: 1759, p2Key: 1976, surface: 'clay', date: '2026-10-14',
    _fhH2hData: true, _fhCh: [[fr], [Object.assign({}, fr, { opponent: 'A. Fils', won: false })]], _fhCloses: [null, null], _fhElo: null, p1RecentFormMatches: [], p2RecentFormMatches: [] };
  const E = S.fhMeetings(m);
  assert.equal(E.length, 1); assert.equal(E[0].wo, false, 'the tab counts it (fhFinishRow: a default is not "no set played")');
});

// ── 9 · the board: a default is decided (founder 2026-10-14, card e8999545: "treat Awarded as a finished match on the
// board too") — never live, never upcoming, carded with its "Defaulted" chip; a career row reads "def.", not "ret." ──────
// Mutations: "Awarded" out of any of the three board status checks; careerRowEnding's def. line removed.
test('board: "Awarded" is a decided match everywhere the board sorts live / upcoming / completed; career rows say "def."', () => {
  const pipe = readFileSync(join(HERE, 'bsp-pipeline.js'), 'utf8');
  assert.match(pipe, /match\.live = fixture\.event_live === '1'\n\s*&& !RECORD_STATUSES\.includes\(fixture\.event_status\);/, 'never rendered live');
  assert.match(pipe, /if \(RECORD_STATUSES\.includes\(f\.event_status\)\) return false;   \/\/ TEN-437: "Awarded" is decided, never upcoming/, 'never an upcoming card');
  assert.match(pipe, /\(RECORD_STATUSES\.includes\(f\.event_status\) \|\| isInterruptedFixture\(f\)\)/, 'carded as a completed match');
  assert.match(pipe, /\.\.\.\(isAwarded\(fixture\) \? \{ defaulted: true \} : \{\}\),\n\s*matchStats:/, 'the card is told it was a default');
  assert.match(html, /const termChip = isCompleted && \(m\.retired \|\| m\.walkover \|\| m\.defaulted\)\n\s*\? `<span class="mc-termchip">\$\{m\.defaulted \? 'Defaulted'/, 'the card header chip');
  const ending = new Function(`${slice('careerRowEnding')}; return careerRowEnding;`)();
  assert.equal(ending({ defaulted: true, won: true, result: '0 - 0' }), 'def.', 'Fils v M. Ymer, Lyon 2023: a default, not a retirement or a walkover');
  assert.equal(ending({ won: true, result: '0 - 0' }), 'ret.', 'control: an unflagged 0 - 0 win still reads by its score');
});

