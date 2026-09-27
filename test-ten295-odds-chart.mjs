// TEN-295 (TEN-287 Wave 1, founder 2026-09-26 card 89e3671d) — the multi-source Odds-tab
// chart, EXECUTED. The renderer functions are SLICED out of the shipped HTML and run; a
// regex over the source would pass on code that never runs.
//
// Rules under test (.claude/rules/odds.md "The odds-movement chart"): the Key Factors mini-chart draws
// from the chart-only shape and never across a gap; the page's start (aOddsStartMs) cuts every line;
// the TEN-216 collector and the pipeline's shard / close rules. The Odds TAB itself (rows, stale books,
// no-vig, tiles, pop-up) is test-ten303-odds-tab.mjs since TEN-303.
//
// Run: node --test test-ten295-odds-chart.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');

function slice(name, src = html) {
  const start = src.indexOf(`\nfunction ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let depth = 0, i = src.indexOf('{', start);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(start, i + 1);
}
function constSrc(name, src = html) {
  const start = src.indexOf(`\nconst ${name} = `);
  assert.ok(start > 0, `const ${name} not found`);
  return src.slice(start, src.indexOf(';\n', start) + 1);
}

// TEN-303 rebuilt the Odds tab (test-ten303-odds-tab.mjs owns its markup); this file keeps the TEN-295
// data rules that outlive it: the Key Factors mini-chart and the page's start cut.
export function build(src = html) {
  const s = n => slice(n, src), c = n => constSrc(n, src);
  return new Function(`
    ${['AODDS_STALE_MS', 'AODDS_LEGACY_BET365', 'AODDS_ORDER', 'AODDS_ALIAS', 'AODDS_AT_CLOCK', 'AODDS_CONFIG', 'AODDS_BOOKS',
       'AODDS_MARKET_TILES', 'AODDS_STEAM', 'AODDS_LINE_SHAPE', 'AODDS_DASH', 'AODDS_C', 'AODDS_RECV', 'AODDS_CHECKED'].map(c).join(' ')}
    let _aOdds = { m:null, novig:false, market:'Match Winner', mv:null };
    const newsTz = () => 'Europe/Brussels';
    const buildOddsReduced = () => 'REDUCED';
    const psEsc = x => String(x);
    const _ocsOf = m => (m && m.__testOcs) || null;   // the page's card-state reader, stubbed
    ${['acctTzOffsetMin', 'cardStartMs', 'aOddsStartMs', 'escapeHtml', 'aOddsStep', 'aOddsBooksOf', 'aOddsHasSeries', 'aOddsPulledAt',
       'aOddsHM', 'aOddsDM', 'aOddsStamp', 'aOddsWhen', 'aOddsFmt', 'aOddsSrcTitle', 'aOddsGapsMs', 'aOddsInGap', 'aOddsPairTicks',
       'aOddsNoVig', 'aOddsRowsOf', 'aOddsMonotone', 'aOddsDispSeries', 'aOddsLinePaths', 'aOddsSparkSvg', 'aOddsMvChart', 'aOddsTipHtml', 'aOddsStatusOf',
       'aOddsBookTip', 'buildOddsSection', 'aOddsMvHtml', 'akOddsMoveSvg'].map(s).join(' ')}
    return { buildOddsSection, akOddsMoveSvg, aOddsBooksOf, cardStartMs, aOddsStartMs,
             reset: () => { _aOdds = { m:null, novig:false, market:'Match Winner', mv:null }; },
             state: () => _aOdds };
  `)();
}

const H = 3600e3;
const iso = ms => new Date(ms).toISOString();

// An upcoming card 6 h out; every source real-shaped, p1/p2 in card orientation.
function fixture({ now = Date.now(), superbetChecked = now - 5 * 60e3, withPin = true, legacyOnly = false,
                   bet105MetaOnly = false, withAt = false } = {}) {
  const start = new Date(now + 6 * H);
  const pad = n => String(n).padStart(2, '0');
  const m = {
    id: 'upcoming-1', p1: 'J. M. Cerundolo', p2: 'A. Davidovich Fokina',
    date: `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}-${pad(start.getUTCDate())}`,
    time: `${pad(start.getUTCHours())}:${pad(start.getUTCMinutes())}`,
    odds: { p1: 2.3, p2: 1.6 },
  };
  const legacy = { bet365: { p1: [[iso(now - 30 * H), 2.37]], p2: [[iso(now - 30 * H), 1.54]] } };
  const chart = { books: {}, meta: {} };
  if (withPin) {
    chart.books['Pinnacle +30s'] = { p1: [[iso(now - 20 * H), 2.5], [iso(now - 2 * H), 2.35]],
                                     p2: [[iso(now - 20 * H), 1.578], [iso(now - 2 * H), 1.657]] };
    chart.meta['Pinnacle +30s'] = { source: 'Oddspapi', group: 'sharp', clock: 'book tick', checkedAt: iso(now - 4 * 60e3) };
  }
  if (bet105MetaOnly) {
    chart.meta['Bet105'] = { source: 'Kibl', group: 'sharp', clock: 'Kibl insert', checkedAt: iso(now - 3 * 60e3) };
  } else {
    chart.books['Bet105'] = { p1: [[iso(now - 10 * H), 2.4]], p2: [[iso(now - 10 * H), 1.62]] };
    chart.meta['Bet105'] = { source: 'Kibl', group: 'sharp', clock: 'Kibl insert', checkedAt: iso(now - 3 * 60e3) };
  }
  // Superbet holds the HIGHEST p1 price — it would win "best" if its staleness were ignored.
  chart.books['Superbet'] = { p1: [[iso(now - 8 * H), 2.6]], p2: [[iso(now - 8 * H), 1.5]] };
  chart.meta['Superbet'] = { source: 'odds-api.io', group: 'soft', clock: 'vendor updatedAt', checkedAt: iso(superbetChecked) };
  chart.books['Betfair Exchange (recorded by us)'] = { p1: [[iso(now - 1 * H), 2.46]], p2: [[iso(now - 1 * H), 1.67]] };
  chart.meta['Betfair Exchange (recorded by us)'] = { source: 'odds-api.io', group: 'soft', clock: 'recorded by us', checkedAt: iso(now - 60e3) };
  if (withAt) {
    // Wave 2: api-tennis Pinnacle (Sharp) + Betano (Soft), our 5-min clock.
    const at = (p1, p2) => ({ p1: [[iso(now - 5 * H), p1]], p2: [[iso(now - 5 * H), p2]] });
    chart.books['Pinnacle (api-tennis)'] = at(2.45, 1.6);
    chart.meta['Pinnacle (api-tennis)'] = { source: 'api-tennis', group: 'sharp', clock: 'seen by us every 5 min',
                               checkedAt: iso(now - 2 * 60e3), firstSeen: iso(now - 5 * H) };
    chart.books['Betano'] = at(2.5, 1.55);
    chart.meta['Betano'] = { source: 'api-tennis', group: 'soft', clock: 'seen by us every 5 min',
                             checkedAt: iso(now - 2 * 60e3), firstSeen: iso(now - 5 * H) };
  }
  m.oddsMovement = legacyOnly
    ? { market: 'Match Winner', capturedAt: iso(now - 26 * H), books: legacy }
    : { market: 'Match Winner', capturedAt: iso(now - 26 * H), books: legacy, chart };
  return m;
}


test('Key Factors mini-chart draws from the chart-only shape', () => {
  const A = build();
  const m = fixture();
  delete m.oddsMovement.books;                     // chart only
  const svg = A.akOddsMoveSvg(m);
  assert.ok(svg.includes('<polyline'), 'draws a line');
});

test('wave 2: the Key Factors mini-chart never picks a book with a gap', () => {
  const now = Date.now();
  const A = build();
  const m = fixture({ now, withAt: true, withPin: false });
  delete m.oddsMovement.books;
  for (const k of Object.keys(m.oddsMovement.chart.books)) if (k !== 'Betano') delete m.oddsMovement.chart.books[k];
  m.oddsMovement.chart.books['Betano'] = { p1: [[iso(now - 9 * H), 2.5], [iso(now - 2 * H), 2.1]], p2: [[iso(now - 9 * H), 1.55], [iso(now - 2 * H), 1.8]] };
  assert.ok(A.akOddsMoveSvg(m).includes('<polyline'), 'drawn without a gap');
  m.oddsMovement.chart.meta['Betano'].gaps = [[iso(now - 6 * H), iso(now - 4 * H)]];
  assert.ok(!A.akOddsMoveSvg(m).includes('<polyline'), 'left out with one');
});

// ── founder 2026-09-26 (comment 5dafce2b): real start time + source in every shared label ──
test('start time: the card time is the account zone (Europe/Berlin), not UTC — in-play points never draw', () => {
  const A = build(); A.reset();
  // Card 2026-09-24 14:00 (CEST) = 12:00Z. A bet365 tick at 13:00Z is IN-PLAY: under the old UTC read
  // (14:00Z) it drew as pre-match.
  const m = { id: 'past-1', p1: 'A. B', p2: 'C. D', date: '2026-09-24', time: '14:00', finalScore: '6-4 6-4',
    oddsMovement: { capturedAt: '2026-09-24T13:30:00.000Z', books: { bet365: {
      p1: [['2026-09-24T09:00:00.000Z', 2.0], ['2026-09-24T13:00:00.000Z', 9.5]],
      p2: [['2026-09-24T09:00:00.000Z', 1.8], ['2026-09-24T13:00:00.000Z', 1.05]] } } } };
  const h = A.buildOddsSection(m);
  assert.ok(!/>9\.50</.test(h) && !/>1\.05</.test(h), 'the 13:00Z in-play tick is not shown');
  assert.equal(A.cardStartMs(m), Date.parse('2026-09-24T12:00:00Z'));
  const mini = A.akOddsMoveSvg(JSON.parse(JSON.stringify(m)));
  assert.ok(mini.includes('<polyline') || mini === '', 'mini-chart renders');
  assert.ok(!/9\.50|1\.05/.test(mini), 'the Key Factors mini-chart also ends at the real start');
  assert.equal(A.cardStartMs({ date: '2026-10-26', time: '14:00' }), Date.parse('2026-10-26T13:00:00Z'), 'CET after 25 Oct');
  assert.equal(A.cardStartMs({ date: '2026-09-24', time: '14:00', startTs: '2026-09-24T12:07:00Z' }),
               Date.parse('2026-09-24T12:07:00Z'), 'a real startTs wins');
  // the card state's ACTUAL start beats the schedule: a match that began 2 h early draws nothing after it
  const early = JSON.parse(JSON.stringify(m)); early.__testOcs = { startTs: '2026-09-24T10:00:00Z' };
  early.oddsMovement.books.bet365.p1.splice(1, 0, ['2026-09-24T11:00:00.000Z', 7.7]);
  early.oddsMovement.books.bet365.p2.splice(1, 0, ['2026-09-24T11:00:00.000Z', 1.1]);
  A.reset();
  assert.equal(A.aOddsStartMs(early), Date.parse('2026-09-24T10:00:00Z'));
  assert.ok(!/>7\.70</.test(A.buildOddsSection(early)), 'a tick after the actual (card-state) start is not drawn');
  assert.ok(!/7\.70/.test(A.akOddsMoveSvg(early)), 'nor in the mini-chart');
  const withFixture = JSON.parse(JSON.stringify(m)); withFixture.oddsMovement.startTime = '2026-09-24T10:30:00.000Z';
  assert.equal(A.aOddsStartMs(withFixture), Date.parse('2026-09-24T10:30:00Z'), 'no card-state start -> the Oddspapi fixture start');
  withFixture.__testOcs = { startTs: '2026-09-24T10:00:00Z' };
  assert.equal(A.aOddsStartMs(withFixture), Date.parse('2026-09-24T10:00:00Z'), 'the card-state start wins over it');
  // an unfinished card past its real start is no longer "upcoming": a stale book is not tagged
  const now = Date.now(), st = new Date(now - 60 * 60e3);           // started 1 h ago (real time)
  const loc = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
                                                 hour: '2-digit', minute: '2-digit', hour12: false }).format(st);
  const u = fixture({ now, superbetChecked: now - 3 * H });
  u.date = loc.slice(0, 10); u.time = loc.slice(11, 16);
  A.reset();
  assert.ok(!A.buildOddsSection(u).includes('aox-stale'), 'started -> never "no recent data"');
});

// ── the TEN-216 collector's tick(), EXECUTED with stubbed I/O (review 2026-09-26) ───────
const coll = readFileSync(join(HERE, 'tools/ten216-supabase-collector.mjs'), 'utf8');
test('collector: a failed insert is re-sent by the next poll; an ok heartbeat only after rows land', async () => {
  const sliceFn = (sig) => { const st = coll.indexOf(sig); assert.ok(st >= 0, sig); let d = 0, i = coll.indexOf('{', st);
    for (; i < coll.length; i++) { if (coll[i] === '{') d++; else if (coll[i] === '}') { d--; if (d === 0) break; } } return coll.slice(st, i + 1); };
  const constLine = (name) => { const st = coll.indexOf(`const ${name}`); return coll.slice(st, coll.indexOf(';\n', st) + 1); };
  const inserts = [], polls = [];
  let failNext = true, odds = { m1: { 'Home/Away': { Home: { Pncl: '2.00' }, Away: { Pncl: '1.80' } } } };
  const make = new Function('env', `
    const INTERVAL_MIN = 5, MAX_ROWS = 1e9, SEP = String.fromCharCode(1);
    const iso = d => new Date(d).toISOString(), ymd = d => new Date(d).toISOString().slice(0, 10);
    ${constLine('keyOf')} ${sliceFn('const normPrice')};
    const windowDates = () => ({ start: 'a', stop: 'b' });
    const apiTennis = async (m) => m === 'get_odds' ? { text: '{}', json: { success: 1, result: env.odds() } } : { json: { result: [] } };
    const insertRows = async (rows) => { if (env.fail()) throw new Error('insert HTTP 500'); env.inserts.push(...rows); return rows.length; };
    const rowCount = async () => 0, uploadRaw = async () => {}, gzipSync = () => Buffer.from('');
    const writePoll = async (r) => { env.polls.push(r); };
    const console = { log() {}, error() {} };
    ${sliceFn('function flattenOdds')} ${sliceFn('async function tick')}
    return tick;`);
  const tick = make({ odds: () => odds, fail: () => { const f = failNext; failNext = false; return f; }, inserts, polls });
  const state = new Map(), t0 = new Date();
  await assert.rejects(tick(state, t0), /insert HTTP 500/);          // poll 1: the insert fails
  assert.equal(polls.length, 0, 'no heartbeat for a poll whose rows did not land');
  assert.equal(state.size, 0, 'the state did not move');
  await tick(state, t0);                                              // poll 2: re-sent
  assert.deepEqual(inserts.map(r => [r.selection, r.price, r.change_kind]).sort(),
                   [['Away', '1.80', 'first_seen'], ['Home', '2.00', 'first_seen']]);
  assert.equal(polls.length, 1); assert.equal(polls[0].ok, true);
  odds = { m1: { 'Home/Away': { Home: { Pncl: '2.00' } } } };        // Away pulled
  await tick(state, t0);
  assert.deepEqual(inserts.slice(2).map(r => [r.selection, r.change_kind]), [['Away', 'removed']], 'the removal is recorded');
});

test('collector: a run whose polls all fail exits RED (4) instead of finishing green', async () => {
  const main = coll.slice(coll.indexOf('let n = 0, okTicks = 0'));
  let code = null;
  const run = new Function('tick', 'process', 'console', 'sleep', 'LOOP_MIN', 'INTERVAL_MIN', 't0', 'state', 'startedAt',
    `return (async () => { ${main} })();`);
  const fakeProc = { exit: c => { code = c; throw new Error('exit'); } };
  const quiet = { log() {}, error() {} };
  let clock = 0; const realNow = Date.now; Date.now = () => clock;
  try {
    await run(async () => { throw new Error('insert HTTP 500'); }, fakeProc, quiet, async () => { clock += 5 * 60000; }, 16, 5, 0, new Map(), new Date())
      .catch(e => { if (e.message !== 'exit') throw e; });
    assert.equal(code, 4, 'all polls failed -> exit 4');
    code = null; clock = 0;
    await run(async () => false, fakeProc, quiet, async () => { clock += 5 * 60000; }, 16, 5, 0, new Map(), new Date())
      .catch(e => { if (e.message !== 'exit') throw e; });
    assert.equal(code, 4, 'every poll rejected by api-tennis (success != 1, HTTP 200) -> exit 4, never green');
    code = null; clock = 0;
    await run(async () => true, fakeProc, quiet, async () => { clock += 5 * 60000; }, 16, 5, 0, new Map(), new Date());
    assert.equal(code, null, 'healthy run exits normally');
  } finally { Date.now = realNow; }
});

// ── the pipeline carries `chart` into the shard (bsp-pipeline.js, EXECUTED) ──────────
import { mkdtempSync, readFileSync as rf } from 'node:fs';
import * as fsMod from 'node:fs';
import { tmpdir } from 'node:os';
const pipe = readFileSync(join(HERE, 'bsp-pipeline.js'), 'utf8');

test('pipeline: extractOddsShards writes chart beside books, indexes a chart-only match', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ten295-'));
  const cwd = process.cwd(); process.chdir(dir);
  try {
    const run = new Function('fs', 'console', `
      const writeJsonAtomic = (f, o) => fs.writeFileSync(f, JSON.stringify(o));
      ${constSrc('ODDS_SHARD_DIR', pipe)} ${constSrc('ODDS_INDEX_PATH', pipe)}
      ${slice('eventKeyOf', pipe)} ${slice('extractOddsShards', pipe)}
      return extractOddsShards;`)(fsMod, { log() {} });
    const chart = { books: { 'Pinnacle +30s': { p1: [['2026-09-25T08:21:00.000Z', 2.5]], p2: [] } },
                    meta: { 'Pinnacle +30s': { source: 'Oddspapi', group: 'sharp', clock: 'book tick', checkedAt: '2026-09-26T04:00:00.000Z' } } };
    const ms = [
      { id: 'upcoming-1', oddsMovement: { market: 'Match Winner', capturedAt: 'c', books: { bet365: { p1: [['t', 2]], p2: [] } }, chart } },
      { id: 'upcoming-2', oddsMovement: { chart, startTime: '2026-09-26T05:00:00.000Z' } },   // chart only
      { id: 'upcoming-3', oddsMovement: { chart: { books: {}, meta: chart.meta } } },   // verdicts only: shipped too
    ];
    run(ms);
    const s1 = JSON.parse(rf('odds/1.json', 'utf8')), s2 = JSON.parse(rf('odds/2.json', 'utf8'));
    assert.deepEqual(Object.keys(s1.books), ['bet365'], 'legacy books unchanged in the shard');
    assert.deepEqual(s1.chart, { books: chart.books, meta: chart.meta }, 'chart rides beside books');
    assert.deepEqual(s2.books, {}, 'a chart-only shard has empty legacy books');
    assert.ok(s2.chart.books['Pinnacle +30s']);
    assert.equal(s2.startTime, '2026-09-26T05:00:00.000Z', 'the Oddspapi fixture start rides in the shard');
    assert.deepEqual(JSON.parse(rf('odds-index.json', 'utf8')), ['1', '2', '3']);
    assert.deepEqual(JSON.parse(rf('odds/3.json', 'utf8')).chart, { books: {}, meta: chart.meta }, 'verdicts reach the page');
    assert.equal(s1.startTime, undefined, 'no fixture start -> no field (additive only)');
    assert.ok(ms.every(m => m.oddsMovement === null), 'stripped from the board as before');
  } finally { process.chdir(cwd); }
});

test('model display gate (founder card f8b311c9): "Match in play." flips at the REAL start, not the UTC-read card time', () => {
  const gate = slice('renderEdgeModel');
  assert.ok(gate.includes('const startMsGate = m ? aOddsStartMs(m) : NaN;'), 'the gate reads aOddsStartMs');
  assert.ok(!/\$\{m\.date\}T\$\{m\.time\}:00Z/.test(gate), 'no date+time read as UTC left in the gate');
  // and aOddsStartMs itself (executed): card state > startTs > fixture > account zone
  const A = build();
  assert.equal(A.aOddsStartMs({ date: '2026-09-24', time: '14:00', __testOcs: { startTs: '2026-09-24T11:50:00Z' } }), Date.parse('2026-09-24T11:50:00Z'));
  assert.equal(A.aOddsStartMs({ date: '2026-09-24', time: '14:00' }), Date.parse('2026-09-24T12:00:00Z'));
});

test('pipeline close (founder card f8b311c9): the card state\'s ACTUAL start is cut first; the key helpers match the page', () => {
  for (const n of ['ocsNfd', 'ocsNameKey', 'ocsMatchKey'])
    assert.equal(slice(n, pipe), slice(n), `${n}: the pipeline's copy must be the dashboard's, character for character`);
  const cut = new Function(`${slice('closeCutMs', pipe)} return closeCutMs;`)();
  const T = s => Date.parse(s);
  const m = { startTs: '2026-09-24T10:40:00Z', oddsMovement: { startTime: '2026-09-24T10:35:00.000Z' } };
  assert.equal(cut(m, T('2026-09-24T10:31:59Z'), () => 0), T('2026-09-24T10:31:59Z'), 'card-state actual start first (Harris v Kovacevic)');
  assert.equal(cut(m, NaN, () => 0), T('2026-09-24T10:40:00Z'), 'then m.startTs');
  assert.equal(cut({ oddsMovement: m.oddsMovement }, undefined, () => 0), T('2026-09-24T10:35:00Z'), 'then the Oddspapi fixture start');
  let called = 0;
  assert.equal(cut({}, NaN, () => { called++; return 5000; }), 4999, 'then the in-play onset - 1 ms');
  cut(m, T('2026-09-24T10:31:59Z'), () => { called++; return 0; });
  assert.equal(called, 1, 'the onset proxy is only computed when nothing proven exists');
  assert.ok(Number.isNaN(cut({}, NaN, () => NaN)), 'nothing -> NaN (the close dashes)');
  // the close block uses it, keyed by the card-state key
  assert.ok(pipe.includes('const ocsStartMs = ocsStartByKey.get(ocsMatchKey(m.date, m.p1, m.p2));\n      const startMs = closeCutMs(m, ocsStartMs, () => inPlayOnset(s));'));
});

test('pipeline: a carried close derived under an earlier cut is re-derived (TEN-295 item 2)', () => {
  const keep = new Function(`${slice('keepCarriedClose', pipe)} return keepCarriedClose;`)();
  const T = s => Date.parse(s);
  // Shang v Mannarino, real series: carried 1.37/3.00 @08:17:46Z; bet365 1.44/2.75 @08:45:19Z; actual start 08:47:59Z.
  const shangPrior = { p1: 1.37, p2: 3, bookmaker: 'bet365', at: '2026-09-24T08:17:46.756Z' };
  const shangNow = { p1: 1.44, p2: 2.75, bookmaker: 'bet365', at: '2026-09-24T08:45:19.063Z' };
  assert.equal(keep(shangPrior, shangNow, T('2026-09-24T08:47:59Z'), 'bet365', true), false, 'Shang heals to 1.44/2.75');
  // Sun v Safiullin: carried 4.50/1.17 @23 Sep 22:26Z; 4.50/1.20 @10:05:33Z; actual start 10:06:06Z.
  assert.equal(keep({ p1: 4.5, p2: 1.17, bookmaker: 'bet365', at: '2026-09-23T22:26:02.218Z' },
                    { p1: 4.5, p2: 1.2, bookmaker: 'bet365', at: '2026-09-24T10:05:33.952Z' },
                    T('2026-09-24T10:06:06Z'), 'bet365', true), false, 'Sun heals (one leg moved)');
  assert.equal(keep(shangNow, { ...shangNow }, T('2026-09-24T08:47:59Z'), 'bet365', true), true, 'unchanged close is kept');
  assert.equal(keep(shangPrior, null, T('2026-09-24T08:47:59Z'), 'bet365', true), true, 'a re-read with no close never erases a proven one');
  assert.equal(keep({ ...shangNow, at: '2026-09-24T08:48:10Z' }, null, T('2026-09-24T08:47:59Z'), 'bet365', true), false, 'in-play carried close is not kept');
  assert.equal(keep({ ...shangNow, bookmaker: 'Pinnacle' }, null, T('2026-09-24T08:47:59Z'), 'bet365', true), false, 'cross-book carried close is not kept');
  assert.equal(keep(shangNow, null, NaN, 'bet365', true), false, 'no proven cut -> not kept');
  assert.equal(keep(null, shangNow, T('2026-09-24T08:47:59Z'), 'bet365', true), false);
  // Review 2026-09-27: on a FALLBACK cut (no card-state start this run) a later pre-cut tick can be
  // in-play — Harris v Kovacevic cut at its 10:35Z schedule re-reads the 10:32:14Z in-play 1.50.
  const harrisPrior = { p1: 1.47, p2: 2.62, bookmaker: 'bet365', at: '2026-09-24T07:30:25.489Z' };
  const harrisInPlay = { p1: 1.5, p2: 2.62, bookmaker: 'bet365', at: '2026-09-24T10:32:14.239Z' };
  assert.equal(keep(harrisPrior, harrisInPlay, T('2026-09-24T10:35:00Z'), 'bet365', false), true,
               'fallback cut: the proven pre-start close is kept, never the in-play re-read');
  assert.equal(keep(shangPrior, shangNow, T('2026-09-24T08:45:00Z'), 'bet365', false), true, 'fallback cut: old rule');
  // the close block decides with it, against the series re-read at the same cut, flagging the actual start
  assert.ok(pipe.includes('if (keepCarriedClose(prior, derivedClose, startMs, ref, Number.isFinite(ocsStartMs))) {'));
  assert.ok(!/priorOk/.test(pipe), 'the old before-the-cut-only test is gone');
});

test('pipeline: the board close is PINNACLE (founder 2026-09-27 item 1) — source ladder, actual start, dash', () => {
  // TEN-308: berlinWallMs moved to berlin-time.js (one reader for every site); the pipeline requires it.
  const bt = readFileSync(join(HERE, 'berlin-time.js'), 'utf8');
  assert.ok(pipe.includes("const { berlinWallMs } = require('./berlin-time');"));
  const F = new Function(`${constSrc('PIN_CLOSE_SOURCES', pipe)} ${slice('pinnacleCloseOf', pipe)} ${constSrc('BERLIN_FMT', bt)} ${slice('berlinOffsetMs', bt)} ${slice('berlinWallMs', bt)}
    ${slice('pinCloseStart', pipe)} return { pinnacleCloseOf, pinCloseStart, berlinWallMs };`)();
  const T = s => Date.parse(s);
  // Harris v Kovacevic, real Pinnacle +30s ticks around the 10:31:59Z actual start.
  const m = { date: '2026-09-24', time: '12:35', oddsMovement: { startTime: '2026-09-24T10:35:00.000Z', chart: { books: {
    'Pinnacle +30s': { p1: [['2026-09-24T09:40:00.000Z', 1.55], ['2026-09-24T10:10:08.224Z', 1.534], ['2026-09-24T10:32:14.000Z', 1.6]],
                       p2: [['2026-09-24T09:40:00.000Z', 2.6], ['2026-09-24T10:10:08.224Z', 2.65], ['2026-09-24T10:32:14.000Z', 2.4]] },
    'Pinnacle (api-tennis)': { p1: [['2026-09-24T10:20:00.000Z', 1.5]], p2: [['2026-09-24T10:20:00.000Z', 2.7]] },
    'Bet105': { p1: [['2026-09-24T10:31:00.000Z', 1.526]], p2: [['2026-09-24T10:31:00.000Z', 2.64]] } } } } };
  const st = F.pinCloseStart(m, T('2026-09-24T10:31:59Z'));
  assert.deepEqual(st, { ms: T('2026-09-24T10:31:59Z'), basis: 'actual', ageRefMs: T('2026-09-24T10:31:59Z') });
  assert.deepEqual(F.pinnacleCloseOf(m, st.ms, st.basis, st.ageRefMs), { p1: 1.534, p2: 2.65, p1At: '2026-09-24T10:10:08.224Z',
    p2At: '2026-09-24T10:10:08.224Z', source: 'Pinnacle +30s (Oddspapi)', startTs: '2026-09-24T10:31:59.000Z', startBasis: 'actual',
    ageRefTs: '2026-09-24T10:31:59.000Z' },
    'the last Pinnacle +30s tick BEFORE the actual start — never the 10:32:14 in-play tick, never Bet105');
  // Oddspapi missing a leg -> the api-tennis Pinnacle, both legs from ONE source
  const oneLeg = structuredClone(m); oneLeg.oddsMovement.chart.books['Pinnacle +30s'].p2 = [];
  assert.equal(F.pinnacleCloseOf(oneLeg, st.ms, 'actual').source, 'Pinnacle (api-tennis)');
  assert.equal(F.pinnacleCloseOf(oneLeg, st.ms, 'actual').p1, 1.5, 'never a p1 from one source beside a p2 from another');
  // neither Pinnacle source with a pre-start pair -> null (dash), never another book
  const none = structuredClone(oneLeg); delete none.oddsMovement.chart.books['Pinnacle (api-tennis)'];
  assert.equal(F.pinnacleCloseOf(none, st.ms, 'actual'), null);
  assert.equal(F.pinnacleCloseOf(m, NaN, null), null, 'no start -> dash');
  const floor = structuredClone(m); floor.oddsMovement.chart.books['Pinnacle +30s'].p1[1][1] = 1.0;
  assert.equal(F.pinnacleCloseOf(floor, st.ms, 'actual').p1, 1.55, 'a price below 1.01 is not a price');
  // no actual start -> the EARLIEST scheduled start (a later one can sit after the real off)
  assert.deepEqual(F.pinCloseStart(m, undefined), { ms: T('2026-09-24T10:35:00Z'), basis: 'scheduled', ageRefMs: T('2026-09-24T10:35:00Z') });
  const moved = { ...m, time: '14:45', oddsMovement: { ...m.oddsMovement, startTime: '2026-09-24T08:30:00.000Z' } };
  assert.equal(F.pinCloseStart(moved, NaN).ms, T('2026-09-24T08:30:00Z'), 'Cerundolo v Zhou: Oddspapi 08:30Z beats the card 12:45Z');
  assert.equal(F.pinCloseStart(moved, NaN).ageRefMs, T('2026-09-24T12:45:00Z'), '...but its AGE runs to the latest schedule');
  assert.equal(F.pinnacleCloseOf(m, T('2026-09-24T10:31:59Z'), 'scheduled', T('2026-09-24T12:45:00Z')).ageRefTs,
               '2026-09-24T12:45:00.000Z', 'ageRefTs = the latest schedule');
  assert.equal(F.pinnacleCloseOf(moved, T('2026-09-24T08:30:00Z'), 'scheduled', T('2026-09-24T12:45:00Z')), null,
               'no Pinnacle tick before the earliest schedule -> dash, never a later tick');
  assert.equal(F.pinCloseStart({ date: '2026-09-24', time: '12:35' }, NaN).ms, T('2026-09-24T10:35:00Z'), 'card clock is Berlin (CEST)');
  assert.equal(F.berlinWallMs('2026-12-10', '12:25'), T('2026-12-10T11:25:00Z'), 'Berlin winter time (CET)');
  assert.ok(Number.isNaN(F.pinCloseStart({}, NaN).ms));
  // the pipeline derives it on finished cards only, and the model never sees it
  assert.ok(pipe.includes('let pc = hasChart ? pinnacleCloseOf(m, st.ms, st.basis, st.ageRefMs) : null;'));
  // a proven prior pin is carried (no chart / no pair this run) only while it is still pre-start
  const still = new Function(`${slice('pinCloseStillPreStart', pipe)} return pinCloseStillPreStart;`)();
  const prior = { p1At: '2026-09-24T10:10:08.224Z', p2At: '2026-09-24T10:10:08.224Z' };
  assert.equal(still(prior, T('2026-09-24T10:31:59Z')), true);
  assert.equal(still(prior, T('2026-09-24T10:05:00Z')), false, 'an earlier start learned later makes it in-play -> dropped');
  assert.equal(still(null, T('2026-09-24T10:31:59Z')), false);
  assert.ok(pipe.includes('if (!pc && pinCloseStillPreStart(prior, st.ms)) { pc = prior; pcCarried++; }'));
  assert.ok(pipe.includes("if (!m.finalScore) { if ('pinClose' in m) delete m.pinClose; continue; }"));
});

test('pipeline: the carry-forward counts a chart-only match as having movement', () => {
  const i = pipe.indexOf('  const hasMovement = m => m && m.oddsMovement && (');
  assert.ok(i > 0, 'hasMovement found');
  const src = pipe.slice(i, pipe.indexOf(';\n', i) + 1);
  const hasMovement = new Function(`${src} return hasMovement;`)();
  assert.equal(!!hasMovement({ oddsMovement: { chart: { books: { Bet105: { p1: [['t', 2]] } } } } }), true);
  assert.equal(!!hasMovement({ oddsMovement: { books: { bet365: {} } } }), true);
  assert.equal(!!hasMovement({ oddsMovement: { chart: { books: {} } } }), false);
  assert.equal(!!hasMovement({ oddsMovement: { chart: { books: {}, meta: { Bet105: {} } } } }), true, 'verdicts survive a rebuild');
});
