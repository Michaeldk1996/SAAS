// TEN-295 (TEN-287 Wave 1, founder 2026-09-26 card 89e3671d) — the multi-source Odds-tab
// chart, EXECUTED. The renderer functions are SLICED out of the shipped HTML and run; a
// regex over the source would pass on code that never runs.
//
// Rules under test (.claude/rules/odds.md "The odds-movement chart"):
//   * books shown = m.oddsMovement.chart ∪ legacy m.oddsMovement.books; legacy bet365 is
//     "bet365 (Oddspapi, capture ended 26 Sep)", Soft, checkedAt = capturedAt;
//   * Sharp / Soft grouping in the chips and the table (group header rows);
//   * default line on = Pinnacle +30s, else the first Sharp book with data;
//   * a line is stepped only up to its own checkedAt — never to the grid's right edge;
//   * an upcoming book last checked > 60 min ago reads "no recent data" in its row and
//     chip, has no Now (dash) and never wins the best-price highlight;
//   * meta without points = a "no data" row of dashes, never a line or a chip;
//   * the footnote lists every shown source with its clock (no hard-coded vendor);
//   * the Key Factors mini-chart still draws from the new shape.
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

export function build(src = html) {
  const s = n => slice(n, src), c = n => constSrc(n, src);
  return new Function(`
    ${c('AODDS_DASH')} ${c('AODDS_DASHCYCLE')} ${c('AODDS_CHECK')} ${c('AODDS_MARKETS')}
    ${c('AODDS_STALE_MS')} ${c('AODDS_LEGACY_BET365')} ${c('AODDS_ORDER')} ${c('AODDS_CONFIG')}
    let _aOdds = { m:null, snapshot:'now', off:null, mktOpen:false };
    const buildOddsReduced = () => 'REDUCED';
    const psEsc = x => String(x);
    ${s('escapeHtml')} ${s('aOddsDash')} ${s('aOddsClock')} ${s('aOddsDay')} ${s('aOddsAxis')}
    ${s('aOddsStep')} ${s('aOddsBooksOf')} ${s('aOddsHasSeries')} ${s('aOddsSortBooks')}
    ${s('aOddsSourceText')} ${s('aOddsShort')} ${s('aOddsStepTo')} ${s('aOddsSpark')}
    ${s('aOddsChartSvg')} ${s('aOddsNoPriceRow')} ${s('aOddsUnpricedTable')} ${s('buildOddsSection')} ${s('akOddsMoveSvg')}
    return { buildOddsSection, akOddsMoveSvg, aOddsBooksOf, aOddsStepTo,
             reset: () => { _aOdds = { m:null, snapshot:'now', off:null, mktOpen:false }; },
             state: () => _aOdds };
  `)();
}

const H = 3600e3;
const iso = ms => new Date(ms).toISOString();

// An upcoming card 6 h out; every source real-shaped, p1/p2 in card orientation.
function fixture({ now = Date.now(), superbetChecked = now - 5 * 60e3, withPin = true, legacyOnly = false,
                   bet105MetaOnly = false } = {}) {
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
  m.oddsMovement = legacyOnly
    ? { market: 'Match Winner', capturedAt: iso(now - 26 * H), books: legacy }
    : { market: 'Match Winner', capturedAt: iso(now - 26 * H), books: legacy, chart };
  return m;
}

const attrs = (h, cls, attr) => [...h.matchAll(new RegExp(`class="${cls}"[^>]*?data-${attr}="([^"]*)"`, 'g'))].map(x => x[1]);
const rowOf = (h, book) => {
  const i = h.indexOf(`data-book="${book}"`, h.indexOf('class="aodds-row'));
  const j = h.indexOf('class="aodds-row', i + 10);
  return h.slice(i, j < 0 ? h.indexOf('class="aodds-foot', i) : j);
};

test('Sharp then Soft: group heads, row order and chip groups', () => {
  const A = build(); A.reset();
  const h = A.buildOddsSection(fixture());
  assert.deepEqual(attrs(h, 'aodds-grouphead', 'group'), ['sharp', 'soft']);
  const rows = [...h.matchAll(/class="aodds-row[^"]*" data-book="([^"]*)" data-group="([^"]*)"/g)].map(x => [x[1], x[2]]);
  assert.deepEqual(rows, [
    ['Pinnacle +30s', 'sharp'], ['Bet105', 'sharp'],
    ['Superbet', 'soft'], ['Betfair Exchange (recorded by us)', 'soft'],
    ['bet365 (Oddspapi, capture ended 26 Sep)', 'soft']]);
  // every Sharp row sits between the Sharp head and the Soft head
  const iSharp = h.indexOf('aodds-grouphead" data-group="sharp"'), iSoft = h.indexOf('aodds-grouphead" data-group="soft"');
  assert.ok(iSharp < h.indexOf('data-book="Bet105" data-group="sharp"', h.indexOf('aodds-row')) && h.indexOf('data-book="Bet105" data-group="sharp"', h.indexOf('aodds-row')) < iSoft);
  const chipGroups = [...h.matchAll(/class="aodds-chipgroup" data-group="([^"]*)"/g)].map(x => x[1]);
  assert.deepEqual(chipGroups, ['sharp', 'soft']);
  const chips = [...h.matchAll(/class="aodds-chip" data-book="([^"]*)" data-group="([^"]*)"/g)].map(x => x[1]);
  assert.deepEqual(chips, ['Pinnacle +30s', 'Bet105', 'Superbet', 'Betfair Exchange (recorded by us)', 'bet365 (Oddspapi, capture ended 26 Sep)']);
});

test('labels: legacy bet365 renamed, per-source footnote, no hard-coded vendor line', () => {
  const A = build(); A.reset();
  const h = A.buildOddsSection(fixture());
  assert.ok(!/data-book="bet365"/.test(h), 'the legacy key is never shown bare');
  const foot = h.slice(h.indexOf('class="aodds-foot'));
  for (const want of ['<b>Pinnacle +30s</b> — Oddspapi (book ticks)', '<b>Bet105</b> — Kibl feed (our Bet105 source) · time = when Kibl stored the price',
                      '<b>Superbet</b> — odds-api.io (vendor update time)',
                      '<b>Betfair Exchange (recorded by us)</b> — odds-api.io, recorded by us (polled every 30 s)',
                      '<b>bet365 (Oddspapi, capture ended 26 Sep)</b> — Oddspapi (book ticks; capture ended 26 Sep)'])
    assert.ok(foot.includes(want), `footnote lacks: ${want}`);
  assert.ok(!h.includes('oddspapi.io</b> historical odds'), 'the old single-vendor footnote is gone');
  assert.ok(rowOf(h, 'Bet105').includes('Kibl feed (our Bet105 source) · time = when Kibl stored the price'),
            'row carries its real source description, not the placeholder "Kibl (Kibl insert time)"');
  assert.ok(!h.includes('Kibl (Kibl insert time)'));
});

test('default line on: Pinnacle +30s, else the first Sharp book with data', () => {
  let A = build(); A.reset();
  A.buildOddsSection(fixture());
  let off = A.state().off;
  assert.equal(off['Pinnacle +30s'], undefined);
  for (const b of ['Bet105', 'Superbet', 'Betfair Exchange (recorded by us)', 'bet365 (Oddspapi, capture ended 26 Sep)'])
    assert.equal(off[b], true, `${b} starts off`);
  A = build(); A.reset();
  A.buildOddsSection(fixture({ withPin: false }));
  off = A.state().off;
  assert.equal(off['Bet105'], undefined, 'no Pinnacle +30s -> the first Sharp book');
  assert.equal(off['Superbet'], true);
});

test('no recent data: stale upcoming book tagged in row + chip, no Now, never best', () => {
  const now = Date.now();
  const A = build(); A.reset();
  const h = A.buildOddsSection(fixture({ now, superbetChecked: now - 2 * H }));
  const row = rowOf(h, 'Superbet');
  assert.ok(row.includes('no recent data'), 'stale row tagged');
  assert.ok(!rowOf(h, 'Betfair Exchange (recorded by us)').includes('no recent data'), 'fresh row untagged');
  const chip = h.slice(h.indexOf('class="aodds-chip" data-book="Superbet"'), h.indexOf('</span></span>', h.indexOf('class="aodds-chip" data-book="Superbet"')) + 14);
  assert.ok(chip.includes('no recent data'), 'stale chip tagged');
  assert.ok(/font-size:15px;[^>]*>—</.test(row) && !/font-size:15px;[^>]*>2\.60</.test(row),
            'a stale last price is not shown as Now (its Open 2.60 still is)');
  // best-price highlight (#3ed68c on the Now number) must not land on the stale 2.60
  assert.ok(!/color:#3ed68c[^>]*>2\.60</.test(h), 'stale price never wins best');
  // The summary chip shows the best FRESH p1 now: 2.46 (BF Exch) beats 2.40 / 2.35
  const fav = h.slice(h.indexOf('>Odds movement<'));
  assert.ok(/font-size:22px; font-weight:800;">2\.46</.test(fav), 'summary best = 2.46');
  // the same staleness at checkedAt 30 min is fresh
  const A2 = build(); A2.reset();
  assert.ok(!rowOf(A2.buildOddsSection(fixture({ now, superbetChecked: now - 30 * 60e3 })), 'Superbet').includes('no recent data'));
});

test('a completed match never reads "no recent data"', () => {
  const A = build(); A.reset();
  const m = fixture({ superbetChecked: Date.now() - 5 * H });
  m.finalScore = { winner: 'p1' };
  assert.ok(!A.buildOddsSection(m).includes('class="aodds-stale"'));
});

test('no carry-forward past checkedAt: the stale line stops short of the right edge', () => {
  const now = Date.now();
  const A = build(); A.reset();
  const m = fixture({ now, superbetChecked: now - 2 * H });
  A.buildOddsSection(m);                          // sets the default toggles
  A.state().off = { 'Pinnacle +30s': true, 'Bet105': true, 'Betfair Exchange (recorded by us)': true,
                    'bet365 (Oddspapi, capture ended 26 Sep)': true };   // Superbet only
  const h = A.buildOddsSection(m);
  const lines = [...h.matchAll(/<polyline points="([^"]+)" fill="none" stroke="[^"]+" stroke-width="2" stroke-dasharray="15 6"/g)];
  assert.equal(lines.length, 2, 'Superbet drawn on both panels');
  const W = 884, padR = 54;
  for (const l of lines) {
    const xs = l[1].split(' ').map(p => Number(p.split(',')[0]));
    assert.ok(Math.max(...xs) < W - padR - 1, `line ends at ${Math.max(...xs)} — before the right edge ${W - padR}`);
  }
  // and the step itself: nothing after endMs
  const v = A.aOddsStepTo([[10, 2.0]], [5, 10, 20, 30], 20);
  assert.deepEqual(v, [null, 2.0, 2.0, null]);
});

test('meta without points: a dash row "not priced for this match", in its fixed slot, no chip, no line', () => {
  const A = build(); A.reset();
  const h = A.buildOddsSection(fixture({ bet105MetaOnly: true }));
  const row = rowOf(h, 'Bet105');
  assert.ok(/class="aodds-row aodds-nodata" data-book="Bet105"/.test(h));
  assert.ok(row.includes('not priced for this match') && (row.match(/—/g) || []).length >= 2);
  assert.ok(!/>0\.00</.test(row), 'never a zero');
  assert.ok(!h.includes('class="aodds-chip" data-book="Bet105"'));
  // fixed order: Bet105 keeps its slot after Pinnacle +30s even with no line
  const rows = [...h.matchAll(/class="aodds-row[^"]*" data-book="([^"]*)"/g)].map(x => x[1]);
  assert.deepEqual(rows.slice(0, 4), ['Pinnacle +30s', 'Bet105', 'Superbet', 'Betfair Exchange (recorded by us)']);
});

test('every configured book gets a row on every card; subheading "X of Y books priced"', () => {
  const A = build(); A.reset();
  const m = fixture({ withPin: false });
  delete m.oddsMovement.chart.books['Superbet'];
  m.oddsMovement.chart.meta['Superbet'].note = 'not recorded — our recording began 26 Sep';
  const h = A.buildOddsSection(m);
  const rows = [...h.matchAll(/class="aodds-row[^"]*" data-book="([^"]*)" data-group="([^"]*)"/g)].map(x => [x[1], x[2]]);
  assert.deepEqual(rows.slice(0, 4), [['Pinnacle +30s', 'sharp'], ['Bet105', 'sharp'], ['Superbet', 'soft'],
                                      ['Betfair Exchange (recorded by us)', 'soft']]);
  assert.ok(rowOf(h, 'Pinnacle +30s').includes('not checked yet'), 'no meta at all = not checked, never "not priced"');
  const m2 = fixture({ withPin: false });
  m2.oddsMovement.chart.meta['Pinnacle +30s'] = { source: 'Oddspapi', group: 'sharp', clock: 'book tick', checkedAt: null };
  A.reset();
  assert.ok(rowOf(A.buildOddsSection(m2), 'Pinnacle +30s').includes('not checked yet'),
            'a verdict with no check time is "not checked yet", never "not priced"');
  assert.ok(rowOf(h, 'Superbet').includes('not recorded — our recording began 26 Sep'), 'the writer\'s note wins');
  assert.ok(/class="aodds-priced">2 of 4 books priced</.test(h), 'Bet105 + Betfair Exchange priced, of 4 configured');
});

test('Bet105 is Sharp by the locked spec, whatever a writer stored', () => {
  const A = build(); A.reset();
  const m = fixture();
  m.oddsMovement.chart.meta['Bet105'].group = 'soft';
  const h = A.buildOddsSection(m);
  assert.ok(/class="aodds-row" data-book="Bet105" data-group="sharp"/.test(h));
});

test('legacy fallback: a shard with only the frozen bet365 books still renders', () => {
  const A = build(); A.reset();
  const h = A.buildOddsSection(fixture({ legacyOnly: true }));
  assert.notEqual(h, 'REDUCED');
  assert.deepEqual(attrs(h, 'aodds-grouphead', 'group'), ['sharp', 'soft'], 'configured books keep their rows');
  assert.ok(/class="aodds-priced">0 of 4 books priced</.test(h), 'legacy bet365 is not a configured book');
  assert.ok(h.includes('data-book="bet365 (Oddspapi, capture ended 26 Sep)"'));
  assert.equal(A.state().off['bet365 (Oddspapi, capture ended 26 Sep)'], undefined, 'the only book is on');
  // capturedAt 26 h ago on an upcoming card -> no recent data
  assert.ok(rowOf(h, 'bet365 (Oddspapi, capture ended 26 Sep)').includes('no recent data'));
});

test('nothing at all -> the reduced view + every configured book as a dash row, never an invented line', () => {
  const A = build(); A.reset();
  const h0 = A.buildOddsSection({ id: 'x', p1: 'A. B', p2: 'C. D', date: '2026-10-01', time: '10:00', oddsMovement: null });
  assert.ok(h0.startsWith('REDUCED'));
  assert.equal((h0.match(/class="aodds-row aodds-nodata"/g) || []).length, 4);
  assert.ok(/0 of 4 books priced/.test(h0) && !h0.includes('<polyline'));
  const h1 = A.buildOddsSection({ id: 'x', p1: 'A. B', p2: 'C. D', date: '2026-10-01', time: '10:00',
    oddsMovement: { books: {}, chart: { books: {}, meta: { Bet105: { group: 'sharp', checkedAt: iso(Date.now()) },
      Superbet: { group: 'soft', checkedAt: iso(Date.now()), note: 'not recorded — our recording began 26 Sep' } } } } });
  assert.ok(h1.startsWith('REDUCED'));
  assert.ok(rowOf(h1, 'Bet105').includes('not priced for this match'));
  assert.ok(rowOf(h1, 'Superbet').includes('not recorded — our recording began 26 Sep'));
  assert.ok(rowOf(h1, 'Pinnacle +30s').includes('not checked yet'));
});

test('Key Factors mini-chart draws from the chart-only shape', () => {
  const A = build();
  const m = fixture();
  delete m.oddsMovement.books;                     // chart only
  const svg = A.akOddsMoveSvg(m);
  assert.ok(svg.includes('<polyline'), 'draws a line');
});

test('an old six-book shard: legacy "Pinnacle" never outranks Pinnacle +30s as the default line', () => {
  const A = build(); A.reset();
  const m = fixture();
  m.oddsMovement.books.Pinnacle = { p1: [[iso(Date.now() - 40 * H), 2.2]], p2: [[iso(Date.now() - 40 * H), 1.7]] };
  const h = A.buildOddsSection(m);
  assert.equal(A.state().off['Pinnacle +30s'], undefined, 'Pinnacle +30s is on');
  assert.equal(A.state().off['Pinnacle'], true, 'the legacy anchor-key book starts off');
  // the legacy Pinnacle is Sharp, listed after the chart's own Sharp books
  const rows = [...h.matchAll(/class="aodds-row[^"]*" data-book="([^"]*)" data-group="sharp"/g)].map(x => x[1]);
  assert.deepEqual(rows, ['Pinnacle +30s', 'Bet105', 'Pinnacle']);
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
      { id: 'upcoming-2', oddsMovement: { chart } },                       // chart only
      { id: 'upcoming-3', oddsMovement: { chart: { books: {}, meta: chart.meta } } },   // verdicts only: shipped too
    ];
    run(ms);
    const s1 = JSON.parse(rf('odds/1.json', 'utf8')), s2 = JSON.parse(rf('odds/2.json', 'utf8'));
    assert.deepEqual(Object.keys(s1.books), ['bet365'], 'legacy books unchanged in the shard');
    assert.deepEqual(s1.chart, { books: chart.books, meta: chart.meta }, 'chart rides beside books');
    assert.deepEqual(s2.books, {}, 'a chart-only shard has empty legacy books');
    assert.ok(s2.chart.books['Pinnacle +30s']);
    assert.deepEqual(JSON.parse(rf('odds-index.json', 'utf8')), ['1', '2', '3']);
    assert.deepEqual(JSON.parse(rf('odds/3.json', 'utf8')).chart, { books: {}, meta: chart.meta }, 'verdicts reach the page');
    assert.ok(ms.every(m => m.oddsMovement === null), 'stripped from the board as before');
  } finally { process.chdir(cwd); }
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
