// TEN-437 (founder 2026-10-14) — one head-to-head record everywhere on the site, ATP's official population, guarded.
//
//   1. Golden-pair gate: tools/fixtures/ten437/h2h-golden-pairs.json holds 57 pairs with ATP's OFFICIAL W–L (the Record
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
  function careerHistoryIdOf(k){ return (ENV.ids && ENV.ids[String(k)]) || null; }   // TEN-437 D3: the shard's own TML/ATP id
  function loadPlayerProfiles(){ return Promise.resolve(); }
  function ensureStyleMeetings(m){ return Promise.resolve(m); } function ensurePsMatrix(){ return Promise.resolve(); }
  function ppStyleFor(){ return null; } function psArchFor(){ return null; } function styleMeetRowsFor(){ return []; }
  function openPlayerProfileFromMatch(){} function aGoTab(){} function aBuilt(){ return false; } function aPaint(){}
  const HouseRatings = (function(){ const window = {}; ${HOUSE_RATINGS_SRC}; return window.HouseRatings; })();
  const H2HCore = (function(){ const window = {}; ${CORE_SRC}; return window.H2HCore; })();
  ${PS_TOUR_META_SRC}
  ${HELPERS.map(n => slice(n)).join('\n')}
  ${block()}
  return { fhMeetings, fhH2hMeetingRows, fhEnsureH2hData, fhBuildH2H, fhStateFor, fhSrcTitle, fhH2hSrcTitle, fhB365Tag, formRule: FH_FORM_NOT_ATP_RECORD };
`);
const ENV = { profiles: {}, loadCareerHistory: () => Promise.resolve([]), answered: () => true,
  ids: Object.fromEntries(G.pairs.flatMap(p => [[p.a.key, p.a.id], [p.b.key, p.b.id]]).filter(e => e[1])) };
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
  assert.match(page, /const nkF = fn\('sfH2hNkCount'\);\n\s*const own = \[\];/, 'the page excludes no board match (ruling 2026-10-16)');
  assert.match(page, /H2HCore\.joinMeetings\(withId\(a\), withId\(b\), S\.chA, S\.chB, nkF \? nkF\(\) : NK_COUNT, own\)/);
  assert.match(page, /const withId = p => Object\.assign\(\{\}, p, \{ id: idF \? idF\(p\.key\) : null \}\);/, 'the page passes each side\'s TML/ATP id (D3)');
  assert.match(slice('sfH2hSide'), /id: key != null \? careerHistoryIdOf\(key\) : null/, 'the tab passes each side\'s TML/ATP id (D3)');
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
  const A = { full: 'Daniil Medvedev', short: 'D. Medvedev', key: '1093', id: 'MM58' }, B = { full: 'Stefanos Tsitsipas', short: 'S. Tsitsipas', key: '1906', id: 'TE51' };
  // as the shards carry them (TEN-437 D1/D3): the archive row names its opponent's TML/ATP id, and Tsitsipas's file holds
  // his earlier main-draw round at the event (what dates the feed's "Semi-finals" as main draw)
  const arc = { date: '2019-10-07', tournament: 'Shanghai Masters', round: 'SF', opponent: 'S. Tsitsipas', oppId: 'TE51', won: true, result: '2 - 0', level: 'atp', src: 'archive' };
  const feed = { date: '2019-10-12', tournament: 'ATP Shanghai', round: 'Semi-finals', opponent: 'D. Medvedev', won: false, result: '0 - 2', level: 'atp', eventKey: 11702704, src: 'fixtures' };
  const r16 = { date: '2019-10-09', tournament: 'ATP Shanghai', round: '1/8-finals', opponent: 'G. Monfils', won: true, result: '2 - 1', level: 'atp', eventKey: 11702001, src: 'fixtures' };
  const join = (a, b) => H2HCore.joinMeetings(A, B, a, b.concat([r16]), {}, []);
  const out = join([arc], [feed]);
  assert.equal(out.length, 1, `Shanghai 2019 counted ${out.length} times`);
  assert.equal(out[0].eventKey, 11702704, 'the keyed row is kept (it reaches the match-stats shards)');
  // controls: a different event, a contradicting round, or the other winner in the window are separate meetings
  assert.equal(join([arc], [Object.assign({}, feed, { tournament: 'ATP Vienna' })]).length, 1, 'another event: the Vienna row has no main-draw round in that file, so it is not a meeting by itself — and the archive Shanghai stays');
  assert.equal(join([arc], [Object.assign({}, feed, { round: 'Final' })]).length, 2);
  assert.equal(join([arc], [Object.assign({}, feed, { won: true, result: '2 - 0' })]).length, 2);
  // the golden Medvedev–Tsitsipas pair with Tsitsipas's copy of Shanghai 2019 coming from the feed instead of the archive
  // (the shape the pipeline's per-player hole fill produces: one side archive, the other side feed) still reads 10–5 / 15
  const p = G.pairs.find(x => x.a.short === 'D. Medvedev' && x.b.short === 'S. Tsitsipas');
  const chB = p.chB.filter(y => !(y.date === '2019-10-07' && /Shanghai/.test(y.tournament))).concat([feed, r16]);
  assert.equal(chB.length, p.chB.length + 1, 'one copy swapped for the other (plus his R16 at that event)');
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
  for (const t of ['ATP Hopman Cup', 'Six Kings Slam', 'UTS London', 'Asian Games', 'ATP Davis Cup - Group III', 'Davis Cup G4 R1: X vs Y']) assert.ok(!H2HCore.inPopulation({ level: 'atp', tournament: t }), t);
  for (const t of ['ATP Davis Cup - World Group I', 'ATP Davis Cup - World Group II', 'Davis Cup G1 R2: SVK vs HUN', 'Davis Cup G2 R1: GEO vs FIN']) assert.ok(H2HCore.inPopulation({ level: 'atp', tournament: t }), t);
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
  // the two writers outside the pipeline (review 2026-10-15): the 10-min score refresher must not flip a default back to
  // LIVE, and the live overlay freezes it like any decided match
  const rs = readFileSync(join(HERE, 'refresh-scores.py'), 'utf8');
  assert.match(rs, /^FINISHED = \('Finished', 'Retired', 'Walk Over', 'Awarded'\)$/m, 'refresh-scores.py: Awarded is finished');
  assert.match(rs, /if status == 'Awarded':\n\s*m\['defaulted'\] = True/, 'refresh-scores.py stamps defaulted like the pipeline');
  assert.match(readFileSync(join(HERE, 'live-overlay.js'), 'utf8'), /status\.includes\('awarded'\)/, 'live-overlay.js freezes a default');
  // a default nobody won and no game was played in is not a result (the production guard, run)
  const { isUnplayedFinishedFixture } = require(join(HERE, 'bsp-pipeline.js'));
  const z = [{ score_set: '1', score_first: '0', score_second: '0' }];
  assert.equal(isUnplayedFinishedFixture({ event_status: 'Awarded', event_winner: null, scores: z }), true, 'no winner, 0-0: never a card');
  assert.equal(isUnplayedFinishedFixture({ event_status: 'Awarded', event_winner: 'First Player', scores: z }), false, 'Fils v M. Ymer: a 0-0 default with a winner is a result');
});


// ── 11 · the 2026-10-16 reconciliation fixes (founder: "fix all defects in one pass") — one guard per fix ────────────────
// Every pair the reconciliation of every roster pair against ATP found wrong for a reason below is a golden pair now
// (tools/fixtures/ten437/h2h-golden-pairs.json, notes "D1".."S2"); these tests pin the rule itself, so a revert of any
// one fix turns CI red (tools/test-ten437-mutants.js names the mutation for each).
const BACKFILL_PATH = process.env.TEN437_BACKFILL || join(HERE, 'career-backfill.js');
const PIPELINE_PATH = process.env.TEN437_PIPELINE || join(HERE, 'bsp-pipeline.js');
const golden = note => G.pairs.find(p => String(p.note || '').startsWith(note));
const goldenRecord = p => H2HCore.record(H2HCore.joinMeetings(p.a, p.b, p.chA, p.chB, p.nk, []));

// D1 — qualifying is read from BOTH rows and dated against the event's main draw. Mutation: the first row's label alone.
test('D1: a qualifier both rows call "Semi-finals" is no meeting; a lucky loser\'s main-draw final one row calls "Qualifying" is one', () => {
  assert.deepEqual(goldenRecord(golden('D1: ')), { a: 0, b: 0, n: 0 }, 'Basilashvili–Hanfmann, Halle 2021 Q2 (ATP 0–0)');
  assert.deepEqual(goldenRecord(golden('D1 reverse')), { a: 1, b: 0, n: 1 }, 'Kwon–Bautista-Agut, Adelaide 2 2023 F (ATP 1–0)');
  const A = { full: 'A. Aaa', short: 'A. Aaa', key: '1', id: 'AA01' }, B = { full: 'B. Bbb', short: 'B. Bbb', key: '2', id: 'BB02' };
  const row = (who, opp, date, round, won, ek) => ({ date, tournament: 'ATP Somewhere', round, opponent: opp, won, result: won ? '2 - 0' : '0 - 2', level: 'atp', eventKey: ek, src: 'fixtures' });
  const r1 = row('A', 'C. Ccc', '2024-05-06', '1/16-finals', true, 9001);
  // dated after A's R1 at the event = main draw, even though one row says Qualifying
  const qf = [row('A', 'B. Bbb', '2024-05-09', 'Qualifying', true, 9002)], qfB = [row('B', 'A. Aaa', '2024-05-09', 'Quarter-finals', false, 9002)];
  assert.equal(H2HCore.joinMeetings(A, B, qf.concat([r1]), qfB, {}, []).length, 1, 'main draw by date');
  // on or before the first main-draw round = qualifying, whatever word the rows use
  const q = [row('A', 'B. Bbb', '2024-05-05', 'Final', true, 9003)], qB = [row('B', 'A. Aaa', '2024-05-05', 'Final', false, 9003)];
  assert.equal(H2HCore.joinMeetings(A, B, q.concat([r1]), qB, {}, []).length, 0, 'qualifying by date');
  // a round-robin event (the Finals: group matches carry no round) has no qualifying draw
  const rr = Object.assign(row('A', 'D. Ddd', '2024-11-11', '', true, 9010), { tournament: 'ATP Finals - Turin' });
  const f = [Object.assign(row('A', 'B. Bbb', '2024-11-17', 'Final', true, 9011), { tournament: 'ATP Finals - Turin' })];
  const fB = [Object.assign(row('B', 'A. Aaa', '2024-11-17', 'Final', false, 9011), { tournament: 'ATP Finals - Turin' })];
  assert.equal(H2HCore.joinMeetings(A, B, f.concat([rr]), fB, {}, []).length, 1, 'the Finals final counts');
  // a rain-delayed double after a bye (review 2026-10-16): R2 and the QF the same day — the QF is main draw
  const r2 = row('A', 'E. Eee', '2024-05-09', '1/8-finals', true, 9020);
  const qfd = [row('A', 'B. Bbb', '2024-05-09', 'Quarter-finals', true, 9021)], qfdB = [row('B', 'A. Aaa', '2024-05-09', 'Quarter-finals', false, 9021)];
  assert.equal(H2HCore.joinMeetings(A, B, qfd.concat([r2]), qfdB, {}, []).length, 1, 'a same-day double is main draw');
});

// D2 — Mutation: "asian games" (or the Group III/IV entry) out of H2H_NOT_COUNTED.
test('D2: the Asian Games and Davis Cup Group III/IV are not in the H2H population (as ATP)', () => {
  assert.deepEqual(goldenRecord(golden('D2: ')), { a: 0, b: 0, n: 0 }, 'Z. Zhang–Watanuki, Hangzhou 2023 final (ATP 0–0)');
  assert.ok(!H2HCore.inPopulation({ level: 'atp', tournament: 'Asian Games' }));
  assert.ok(!H2HCore.inPopulation({ level: 'atp', tournament: 'ATP Davis Cup - Group III' }));
});

// D3 — Mutation: a one-sided archive row credited on its name again.
test('D3: a one-sided archive row is credited only on the opponent\'s TML/ATP id, never on a name', () => {
  assert.deepEqual(goldenRecord(golden('D3: ')), { a: 0, b: 0, n: 0 }, 'Carreno-Busta–Z. Zhang: the Shanghai 2019 row is Ze Zhang (ATP 0–0)');
  const A = { full: 'P. Carreno-Busta', short: 'P. Carreno-Busta', key: '434', id: 'CD85' }, B = { full: 'Z. Zhang', short: 'Z. Zhang', key: '590', id: 'Z371' };
  const arc = oppId => ({ date: '2019-10-07', tournament: 'Shanghai Masters', round: 'R64', opponent: 'Z. Zhang', won: true, result: '2 - 1', level: 'atp', src: 'archive', ...(oppId ? { oppId } : {}) });
  assert.equal(H2HCore.joinMeetings(A, B, [arc('Z272')], [], {}, []).length, 0, 'another Zhang: never');
  assert.equal(H2HCore.joinMeetings(A, B, [arc(null)], [], {}, []).length, 0, 'no id: left out (never on a name)');
  assert.equal(H2HCore.joinMeetings(A, B, [arc('Z371')], [], {}, []).length, 1, 'his id: credited');
  // a feed row with the opponent's api key: the key decides (his key credited, another's not)
  const feed = k => ({ date: '2024-03-08', tournament: 'ATP Indian Wells', round: '1/64-finals', opponent: 'Z. Zhang', oppKey: k, won: true, result: '2 - 0', level: 'atp', eventKey: 1, src: 'fixtures' });
  assert.equal(H2HCore.joinMeetings(A, B, [feed('590')], [], {}, []).length, 1);
  assert.equal(H2HCore.joinMeetings(A, B, [feed('99999')], [], {}, []).length, 0);
  // the shard carries the player's own id and every archive row its opponent's (pipeline + archive builder)
  const pipe = readFileSync(PIPELINE_PATH, 'utf8');
  assert.match(pipe, /\.\.\.\(tmlIds\.get\(String\(key\)\) \? \{ id: tmlIds\.get\(String\(key\)\) \} : \{\}\),/, 'the shard writes its own id');
  assert.match(readFileSync(BACKFILL_PATH, 'utf8'), /\.\.\.\(m\.oppId \? \{ oppId: String\(m\.oppId\) \} : \{\}\),/, 'archive rows carry oppId');
});

// D4 — Mutation: the archive builder skips a row with no hard/clay/grass surface again.
const TML_HEADER = 'tourney_id,tourney_name,surface,draw_size,tourney_level,indoor,tourney_date,match_num,winner_id,winner_seed,winner_entry,winner_name,winner_hand,winner_ht,winner_ioc,winner_age,winner_rank,winner_rank_points,loser_id,loser_seed,loser_entry,loser_name,loser_hand,loser_ht,loser_ioc,loser_age,loser_rank,loser_rank_points,score,best_of,round,minutes';
test('D4: a carpet or blank-surface archive match ships (surface "carpet" / none) and is a meeting', async () => {
  assert.deepEqual(goldenRecord(golden('D4: ')), { a: 3, b: 3, n: 6 }, 'Gasquet–Wawrinka with Paris 2006 R32 on carpet (ATP 3–3)');
  const CB = require(BACKFILL_PATH);
  const line = (id, name, surf, date, score) => [id, name, surf, 32, 'A', '', date, 1, 'G628', '', '', 'Richard Gasquet', 'R', '', 'FRA', 20, 10, 0,
    'W367', '', '', 'Stan Wawrinka', 'R', '', 'SUI', 21, 30, 0, score, 3, 'R32', 90].join(',');
  const csv = [TML_HEADER, line('2006-352', 'Paris Masters', 'Carpet', '20061030', '7-5 6-1'), line('2017-D1', 'Davis Cup G1 R1: POL vs BIH', '', '20170203', '6-4 6-4 6-4')].join('\n');
  const index = await CB._internal.buildTmlIndex(() => {}, { csvByYear: { 2006: csv.split('\n').slice(0, 2).join('\n'), 2017: [TML_HEADER, csv.split('\n')[2]].join('\n') } });
  const out = await CB.buildArchiveHistories({ 1094: { name: 'R. Gasquet' } }, 2000, 2020, { index, idsOut: new Map() });
  const rows = out['1094'] || [];
  assert.equal(rows.length, 2, 'both the carpet and the blank-surface match ship');
  assert.equal(rows.find(r => /Paris/.test(r.tournament)).surface, 'carpet');
  assert.equal(rows.find(r => /Davis/.test(r.tournament)).surface, null, 'blank stays blank (a dash in surface stats)');
  assert.ok(rows.every(r => r.oppId === 'W367'), 'each row names its opponent\'s id');
});

// D5 — Mutation: isWalkover reads a 0 - 0 retirement as a walkover again (core), or fhFinishRow does (page).
test('D5: a retirement before the first set finished (0 - 0, no set scores) is a meeting, not a walkover', () => {
  assert.deepEqual(goldenRecord(golden('D5: ')), { a: 1, b: 3, n: 4 }, 'Lajovic–Fritz with Cincinnati 2023 ret. 0-5 (ATP 1–3)');
  assert.equal(H2HCore.isWalkover({ result: '0 - 0', retired: true }), false);
  assert.equal(H2HCore.isWalkover({ result: '0 - 0' }), true, 'control: an unflagged 0 - 0 is still a walkover');
  const r = new Function(`${slice('fhSetDone')}; ${slice('fhBestOf')}; const FH_SLAMS = new Set(); const psNormTour = s => s; ${slice('fhFinishRow')}; return fhFinishRow;`)()({ result: '0 - 0', ret: true, wo: false, def: false, won: false, sets: null, tourn: 'Cincinnati' });
  assert.equal(r.wo, false, 'the page does not read it as a walkover');
});

// S1 — Mutation: the 4-game sets read with the 6-game set test again (a retirement), or games counted.
test('S1: Next Gen Finals sets (to 4 games) are finished sets, not a retirement, and carry no games figure', () => {
  const fin = new Function(`${slice('fhSetDone')}; ${slice('fhBestOf')}; const FH_SLAMS = new Set(); const psNormTour = s => s; ${slice('fhFinishRow')}; return fhFinishRow;`)();
  // Rublev v Tsitsipas, Milan 2018 SF: 3-4(3) 4-3(5) 0-4 4-2 3-4(2), Tsitsipas won (Rublev's side)
  const r = fin({ result: '2 - 3', won: false, ret: false, wo: false, def: false, tourn: 'Next Gen ATP Finals', tournRaw: 'Next Gen ATP Finals', sets: [[3, 4, 3], [4, 3, 5], [0, 4, null], [4, 2, null], [3, 4, 2]] });
  assert.equal(r.ret, false, 'not a retirement');
  assert.deepEqual([r.pS, r.oS], [2, 3], 'five finished sets, 2–3');
  assert.equal(r.decider, true, 'went the distance (best of five)');
  assert.equal(r.tot, null, 'no games total from a 4-game-set match');
  assert.equal(r.diff, null, 'no games margin');
  assert.equal(r.tbN, 3, 'its 4-3 sets are tiebreaks');
  // ...but no games-based hot line reads it (review 2026-10-16: "Tiebreak in match" is a games line)
  const elig = new Function(`${slice('fhEligible')}; return fhEligible;`)();
  assert.equal(elig(r, { need: 'games' }), false, 'no games line');
  assert.equal(elig(r, { need: 'sets' }), true, 'a sets line reads it');
  assert.deepEqual(goldenRecord(golden('S1: ')), { a: 2, b: 3, n: 5 }, 'Tien–Michelsen with the Next Gen 2024 meetings (ATP 2–3)');
});

// S2 — Mutation: an Olympic year dropped from the map, or the shard writer's pass removed.
test('S2: an Olympic match carries its edition\'s surface — Tokyo 2021 hard, Paris 2024 clay — on every row', () => {
  const P = require(PIPELINE_PATH);
  assert.equal(P.olympicSurface('Olympic Games', '2021-07-29'), 'hard');
  assert.equal(P.olympicSurface('Olympic Games', '2024-08-02'), 'clay');
  assert.equal(P.olympicSurface('London Olympics', '2012-08-01'), 'grass');
  assert.equal(P.olympicSurface('Rio Olympics', '2016-08-10'), 'hard');
  assert.equal(P.olympicSurface('Beijing Olympics', '2008-08-12'), 'hard');
  assert.equal(P.olympicSurface('Wimbledon', '2021-07-01'), null, 'only Olympic events');
  assert.equal(P.fixtureSurface({ tournament_name: 'Olympic Games', event_date: '2021-07-29', tournament_key: 'x' }, new Map([['x', 'grass']])), 'hard', 'the per-key grass is overridden');
  assert.equal(P.fixtureSurface({ tournament_name: 'ATP Doha', event_date: '2026-02-18', tournament_key: 'y' }, new Map([['y', 'hard']])), 'hard');
  assert.match(readFileSync(PIPELINE_PATH, 'utf8'), /for \(const r of rows\) \{ const os = olympicSurface\(r\.tournament, r\.date\); if \(os\) r\.surface = os; \}/, 'the shard writer corrects cached rows');
  assert.deepEqual(goldenRecord(golden('S2: ')), { a: 10, b: 5, n: 15 }, 'Djokovic–Zverev (ATP 10–5)');
});

// ── 12 · board-match exclusion (founder ruling 2026-10-16, replacing 2026-09-24's) ─────────────────────────────────────
// "Apply it only to the match's own analysis (match analysis tab + model). The H2H page and every other surface show the
// full ATP count, including this week's match." Mutations: the tab counting its own match; the page or the model excluding.
test('board-match exclusion: only the match\'s own analysis leaves it out — Medvedev–Tsitsipas 11–5 / 16 elsewhere', () => {
  const p = G.pairs.find(x => x.a.short === 'D. Medvedev' && x.b.short === 'S. Tsitsipas');
  // Shanghai 2026 R16, 14 Oct: Medvedev d. Tsitsipas 6-4 7-5 (eventKey 12170285; ATP counts it: 11–5 / 16 on 16 Oct)
  const sh = (won, opp) => ({ date: '2026-10-14', tournament: 'Shanghai', round: '1/8-finals', opponent: opp, won, result: won ? '2 - 0' : '0 - 2', level: 'atp', eventKey: 12170285, src: 'fixtures' });
  const chA = p.chA.concat([sh(true, 'S. Tsitsipas')]), chB = p.chB.concat([sh(false, 'D. Medvedev')]);
  // the H2H page's call: no exclusion
  assert.deepEqual(H2HCore.record(H2HCore.joinMeetings(p.a, p.b, chA, chB, p.nk, [])), { a: 11, b: 5, n: 16 }, 'H2H page');
  // the match's own analysis: the tab's own code, opened on that match
  const m = { id: 'past-12170285', p1: 'D. Medvedev', p2: 'S. Tsitsipas', p1Key: 1093, p2Key: 1906, surface: 'hard', date: '2026-10-14',
    _fhH2hData: true, _fhCh: [chA, chB], _fhCloses: [null, null], _fhElo: null, p1RecentFormMatches: [], p2RecentFormMatches: [] };
  const E = S.fhMeetings(m).filter(r => !r.wo);
  assert.deepEqual([E.length, E.filter(r => r.won).length], [15, 10], 'its own Match analysis: 10–5 / 15');
  // another board match of the pair (a future meeting) counts Shanghai like every other surface
  const m2 = Object.assign({}, m, { id: 'upcoming-99999999', _fhH2hData: true });
  assert.equal(S.fhMeetings(m2).filter(r => !r.wo).length, 16, 'any other analysis: 16');
  // the model: its own match out, nothing else
  const P = require(PIPELINE_PATH);
  const rd = k => (String(k) === '1093' ? chA : String(k) === '1906' ? chB : []);
  const inp = { readShard: rd, readId: k => (String(k) === '1093' ? p.a.id : p.b.id), names: [p.a.full, p.b.full], nameByKey: {} };
  assert.equal(P.modelH2hMatches({ id: 'past-12170285', p1: 'D. Medvedev', p2: 'S. Tsitsipas', p1Key: 1093, p2Key: 1906 }, inp).length, 15, 'model, its own match');
  assert.equal(P.modelH2hMatches({ id: 'upcoming-99999999', p1: 'D. Medvedev', p2: 'S. Tsitsipas', p1Key: 1093, p2Key: 1906 }, inp).length, 16, 'model, another match');
});

// ── 13 · tab price pairing (founder ruling 2026-10-16: "the tab prices the same 34 meetings the page does") ─────────────
// A keyless (archive) meeting takes a Tennis-Data close inside its window; meetings whose windows overlap form a group.
// Different events pair in EVENT-DATE order and only one event's meetings in round order. Ordering the whole group by
// round gave Roland Garros 2020 QF (start 28.09) Hamburg 2020 F's close (27.09): the result check failed and both dashed.
// Mutations: the group ordered by round alone again; ATP / United Cup back in the window pairing.
test('tab price pairing: Rublev–Tsitsipas Hamburg 2020 F 1.84 and Roland Garros 2020 QF 2.77, as the page prices them', () => {
  const p = G.pairs.find(x => x.a.short === 'A. Rublev' && x.b.short === 'S. Tsitsipas');
  // Rublev's Tennis-Data closes v Tsitsipas, as the live closes store reads them (fhParseCloses, 2026-10-16)
  const closes = { rows: [
    { date: '2020-09-27', opp: 'Tsitsipas S.', won: true, P: [1.84, 2.1], B: [1.7, 2.05], ret: false, oppKey: '1906' },
    { date: '2020-10-07', opp: 'Tsitsipas S.', won: false, P: [2.77, 1.52], B: [2.5, 1.53], ret: false, oppKey: '1906' }], cap: [] };
  const m = { id: 'upcoming-77', p1: 'A. Rublev', p2: 'S. Tsitsipas', p1Key: 2847, p2Key: 1906, surface: 'hard', date: '2026-10-14',
    _fhH2hData: true, _fhCh: [p.chA, p.chB], _fhCloses: [closes, null], _fhElo: null, p1RecentFormMatches: [], p2RecentFormMatches: [] };
  const E = S.fhMeetings(m).filter(r => /^2020-(09|10)/.test(r.date)).map(r => [r.date, r.round, r.price, r.oppPrice, r.book]);
  assert.deepEqual(E, [['2020-09-21', 'F', 1.84, 2.1, 'P'], ['2020-09-28', 'QF', 2.77, 1.52, 'P']]);
});
test('tab price pairing: a team cup takes no window close; two events, one close, one winner stays a dash', () => {
  const sh = rows => ({ rows, cap: [] });
  const arc = (date, t, rd, won) => ({ date, tournament: t, round: rd, won, opponent: 'A. Zverev', level: 'atp', result: won ? '3 - 0' : '0 - 3' });
  const mk = (chA, cl) => ({ id: 'upcoming-77', p1: 'N. Djokovic', p2: 'A. Zverev', p1Key: 11, p2Key: 22, surface: 'hard', date: '2026-10-14',
    _fhH2hData: true, _fhCh: [chA, []], _fhCloses: [sh(cl), null], _fhElo: null, p1RecentFormMatches: [], p2RecentFormMatches: [] });
  const px = m => S.fhMeetings(m).map(r => [r.date, r.price]);
  const ao = close => ({ date: '2021-02-16', opp: 'Zverev A.', won: true, P: [1.68, 2.33], B: null, ret: false, oppKey: '22' });
  // Djokovic–Zverev, ATP Cup 2021 (02.02) + Australian Open 2021 QF (08.02, played 16.02): the AO close is the AO meeting's
  assert.deepEqual(px(mk([arc('2021-02-08', 'Australian Open', 'QF', true), arc('2021-02-02', 'ATP Cup', 'RR', true)], [ao()])),
    [['2021-02-02', null], ['2021-02-08', 1.68]], 'ATP Cup dash, Australian Open priced');
  // Cilic–Dimitrov shape: an Olympics meeting a week before a Masters SF, one close, the same winner — dates cannot say whose
  assert.deepEqual(px(mk([arc('2021-02-08', 'Australian Open', 'QF', true), arc('2021-02-01', 'Melbourne Summer Set', 'R16', true)], [ao()])),
    [['2021-02-01', null], ['2021-02-08', null]], 'both dash, never a guess');
});

// ── 14 · ATP's rules apply to H2H only; Form keeps its own list (founder 2026-10-16, correction of the same day) ──────
// "ATP's rules apply to H2H only … ATP_RECORD_NOT_COUNTED is read by H2H only. Form keeps its current rules, unchanged …
// pin Form to its own list, so the two can't silently merge." Golden rows from the live shards (2026-10-16): Fritz's Laver
// Cup 2025 (ATP counts it: H2H in, Form out), Zhang's Asian Games 2023 and Vacherot's Davis Cup Group III 2021 (ATP leaves
// them out: H2H out, Form in). Mutations: Form wired to the H2H list; the H2H list losing the Asian Games; the H2H join
// reading a list of its own in the pipeline.
const FRITZ_LC = ['2025-09-22', '2025-09-21'].map(date => ({ date, tournament: 'ATP Laver Cup', round: '', level: 'atp', won: true }));
const ZHANG_AG = ['2023-09-30', '2023-09-28', '2023-09-27', '2023-09-26', '2023-09-25'].map(date => ({ date, tournament: 'Asian Games', level: 'atp', won: true }));
const VACH_DC3 = ['2021-06-19', '2021-06-18', '2021-06-17', '2021-06-16'].map(date => ({ date, tournament: 'ATP Davis Cup - Group III', round: '', level: 'atp', won: true }));
test('H2H counts Fritz\'s Laver Cup and not Zhang\'s Asian Games or Vacherot\'s Group III; Form counts the reverse', () => {
  const P = require(PIPELINE_PATH);
  const n = (L, rows) => rows.filter(r => !L.test(r.tournament)).length;
  assert.deepEqual([FRITZ_LC, ZHANG_AG, VACH_DC3].map(r => n(H2HCore.ATP_RECORD_NOT_COUNTED, r)), [2, 0, 0], 'H2H: ATP\'s list');
  assert.deepEqual([FRITZ_LC, ZHANG_AG, VACH_DC3].map(r => n(P.H2H_NOT_ATP_RECORD, r)), [2, 0, 0], 'pipeline H2H (h2hCountsInAtpRecord)');
  assert.deepEqual([FRITZ_LC, ZHANG_AG, VACH_DC3].map(r => n(S.formRule, r)), [0, 5, 4], 'Form tab: its own list');
  assert.deepEqual([FRITZ_LC, ZHANG_AG, VACH_DC3].map(r => n(P.FORM_NOT_ATP_RECORD, r)), [0, 5, 4], 'card / profile cap: its own list');
  // the card's Recent form %: two losses + Fritz's Laver Cup wins = 0% (Laver Cup out); + Zhang's Asian Games wins = 71.4%
  const loss = ['2025-10-01', '2025-09-30'].map(date => ({ date, tournament: 'Shanghai', level: 'atp', won: false }));
  assert.equal(P.recentFormPct(loss.concat(FRITZ_LC)), 0);
  assert.equal(P.recentFormPct(loss.concat(ZHANG_AG)), 71.4);
});
// The map (founder: "report the final map of which surface reads which list"):
//   H2H — the meeting list on every screen (H2HCore.joinMeetings → inPopulation), the pipeline's h2hCountsInAtpRecord /
//         H2H_NOT_ATP_RECORD, the model (modelH2hMatches → joinMeetings): h2h-core ATP_RECORD_NOT_COUNTED.
//   Form — the Form tab + Key factors' Recent form (FH_FORM_NOT_ATP_RECORD), the card's Recent form % and the profile cap
//         (FORM_NOT_ATP_RECORD), the profile ribbon / ledger (player-profile-v2.js), the matchup matrix
//         (tools/build-matchup-matrix.js): one Form list, Laver Cup + exhibitions + Hopman Cup out.
test('the list map: every H2H reader is h2h-core\'s ATP list; every Form reader is the one Form list, never the ATP one', () => {
  const P = require(PIPELINE_PATH);
  const PIPE = readFileSync(PIPELINE_PATH, 'utf8');
  const atp = H2HCore.ATP_RECORD_NOT_COUNTED.source;
  // H2H
  assert.equal(H2HCore.H2H_NOT_COUNTED, H2HCore.ATP_RECORD_NOT_COUNTED, 'the join\'s list is the ATP list');
  assert.equal(P.H2H_NOT_ATP_RECORD.source, atp, 'pipeline H2H');
  assert.match(PIPE, /\nconst H2H_NOT_ATP_RECORD = require\('\.\/h2h-core\.js'\)\.ATP_RECORD_NOT_COUNTED;\n/, 'the pipeline reads it, holds no copy');
  assert.ok(!/^(?!\s*\/\/).*asian games/im.test(html), 'the dashboard holds no H2H list of its own (H2HCore.joinMeetings applies it)');
  // Form: one list, four readers, not the ATP one
  const form = P.FORM_NOT_ATP_RECORD.source;
  const lit = (f, re) => { const m = re.exec(readFileSync(join(HERE, f), 'utf8')); assert.ok(m, f + ': Form list not found'); return new RegExp(m[1], 'i').source; };
  assert.equal(S.formRule.source, form, 'Form tab = card');
  assert.equal(lit('player-profile-v2.js', /\n\s*var FORM_NOT_ATP_RECORD = \/(.*)\/i;\n/), form, 'profile = card');
  assert.equal(lit('tools/build-matchup-matrix.js', /\nconst FORM_NOT_ATP_RECORD = \/(.*)\/i;\n/), form, 'matrix = card');
  assert.notEqual(form, atp, 'Form is not the H2H list');
  assert.ok(/laver cup/.test(form) && !/asian games|group \(iii/.test(form), 'Form: Laver Cup out (4 Oct), Asian Games / Group III in');
  for (const f of ['player-profile-v2.js', 'tools/build-matchup-matrix.js'])
    assert.ok(!/ATP_RECORD_NOT_COUNTED|H2HCore/.test(readFileSync(join(HERE, f), 'utf8')), f + ' reads the H2H list');
  assert.match(PIPE, /\nconst FORM_NOT_ATP_RECORD = new RegExp\('laver cup\|' \+ FORM_EVENTS_NOT_COUNTED\.source, 'i'\);\n/, 'pipeline Form = its own base list');
  assert.match(html, /\nconst FH_FORM_NOT_ATP_RECORD = new RegExp\('laver cup\|' \+ FH_FORM_EVENTS_NOT_COUNTED\.source, 'i'\);\n/, 'dashboard Form = its own base list');
});
// ── 15 · the Bet365 fallback's hover (founder ruling 2026-10-16, item 4) ─────────────────────────────────────────────────
// "Keep the Bet365 closes for now, with the 'B' marker visible and the hover saying 'Bet365 closing odds, Pinnacle not
// available'." Mutation: the old source-label hover back.
test('a Bet365-priced meeting: "B" marker kept, hover "Bet365 closing odds, Pinnacle not available" (tab and page)', () => {
  const HOVER = 'Bet365 closing odds, Pinnacle not available';
  assert.equal(S.fhH2hSrcTitle({ book: 'B', src: 'td' }), HOVER, 'the H2H tab\'s price cells');
  assert.match(S.fhB365Tag({ book: 'B', src: 'td' }, true), new RegExp(`title="${HOVER}"[^>]*>B365<`), 'the H2H tab\'s B365 tag');
  assert.equal(S.fhH2hSrcTitle({ book: 'P', src: 'td' }), 'Pinnacle close · Tennis-Data', 'control: a Pinnacle close keeps its label');
  // H2H only: Form and every other surface keep the source label
  assert.equal(S.fhSrcTitle({ book: 'B', src: 'td' }), 'Bet365 close · Tennis-Data', 'Form keeps its hover');
  assert.match(S.fhB365Tag({ book: 'B', src: 'td' }), /title="Bet365 close · Tennis-Data \(no Pinnacle close for this match\)"/, 'a non-H2H tag keeps its hover');
  assert.match(slice('fhH2hRowData'), /hTitle: fhH2hSrcTitle\(r\), aTitle: fhH2hSrcTitle\(r\)/, 'the tab\'s H2H rows read the H2H hover');
  assert.match(slice('h2hPriceTitle'), /if \(r\.price != null\) return r\.book === 'B' \? \(typeof fhB365Approx === 'function' && fhB365Approx\(r\) \? \(r\.src === 'atb' \? FH_B365_AT_HOVER : FH_B365_APPROX_HOVER\) : FH_B365_HOVER\) : /, 'the H2H page reads the same hover (our captured Bet365: the approx. line, founder 2026-10-18; api-tennis Bet365 its own, 2026-10-19)');
  assert.match(slice('fhH2hRowData'), /hMark: r\.price != null && r\.book === 'B' \? 'B' : ''/, 'the tab\'s B marker in the H cell');
  // item 4 (founder 2026-10-16): "show it on the H2H page meeting rows too, same as the tab"
  assert.match(html, /hTitle: h2hPriceTitle\(r\), aTitle: h2hPriceTitle\(r\), hMark: r\.price != null && r\.book === 'B' \? 'B' : '',\n\s*oppTitle: r\.tourn/, 'the H2H page meeting row carries the B marker');
});

// ── 16 · nothing overrides the join on the H2H page (founder ruling 2026-10-17, ruling 5; REPLACES 2026-10-16 item 5) ──
// The page's captured-Pinnacle step (h2hCapPinnacle) is removed: those prices are not closes (odds.md "held back": our
// captured closes of 12 Jul – 16 Sep are never shown). Struff v Tabilo, Cincinnati 2026 R64 reads the master's join.
// Control: the step's call is gone from the pair builder and its function from the page.
test('H2H page: no captured step — every meeting reads the master\'s join only (ruling 5)', () => {
  assert.equal(html.indexOf('function h2hCapPinnacle('), -1, 'the captured step is removed from the page');
  const page = slice('h2hPairFor');
  assert.match(page, /if \(_h2hDbSt === 'ready'\) h2hPriceJoin\(S\.rows, a, b, _h2hDb, null, S\.chA\);\n\s*S\.priced = /, 'the join is the last price step');
  assert.doesNotMatch(page, /fhCloseFor|\.cap\b/, 'no closes-shard price on this page');
  // our archive's closes ('cap' captured, 'hist' from Pinnacle history) still name their source on the join's rows
  assert.match(slice('h2hPriceTitle'), /r\.src === 'cap' \|\| r\.src === 'hist' \? 'Pinnacle closing price · ' \+ \(r\.srcLabel \|\| FH_SRC\[r\.src\]\)/);
});
