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
    ${c('AODDS_STALE_MS')} ${c('AODDS_LEGACY_BET365')} ${c('AODDS_ORDER')} ${c('AODDS_DEFAULT_ON')} ${c('AODDS_AT_CLOCK')} ${c('AODDS_CONFIG')}
    let _aOdds = { m:null, snapshot:'now', off:null, mktOpen:false };
    const buildOddsReduced = () => 'REDUCED';
    const psEsc = x => String(x);
    ${s('escapeHtml')} ${s('aOddsDash')} ${s('aOddsClock')} ${s('aOddsDay')} ${s('aOddsAxis')}
    ${s('aOddsStep')} ${s('aOddsBooksOf')} ${s('aOddsHasSeries')} ${s('aOddsSortBooks')}
    ${s('aOddsSourceText')} ${s('aOddsShort')} ${s('aOddsStepTo')} ${s('aOddsPulledAt')} ${s('aOddsSpark')}
    ${s('aOddsChartSvg')} ${s('aOddsNoPriceRow')} ${s('aOddsUnpricedTable')} ${s('buildOddsSection')} ${s('akOddsMoveSvg')}
    return { buildOddsSection, akOddsMoveSvg, aOddsBooksOf, aOddsStepTo, aOddsSourceText,
             reset: () => { _aOdds = { m:null, snapshot:'now', off:null, mktOpen:false }; },
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
    chart.books['Pinnacle'] = at(2.45, 1.6);
    chart.meta['Pinnacle'] = { source: 'api-tennis', group: 'sharp', clock: 'seen by us every 5 min',
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

// Wave 2: the 8 api-tennis Soft books, in the fixed order (founder comment d5bf3dda).
const AT_SOFT = ['Betano', '1xBet', 'BetVictor', 'Betfair Sportsbook', 'Marathon', 'bet365 (api-tennis)', 'Sbobet', 'William Hill'];
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
    ['Pinnacle +30s', 'sharp'], ['Pinnacle', 'sharp'], ['Bet105', 'sharp'],
    ...AT_SOFT.map(b => [b, 'soft']),
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

test('default lines on (founder card 78ec4dd2 "sharp_both"): Pinnacle +30s + Bet105, all else off', () => {
  let A = build(); A.reset();
  A.buildOddsSection(fixture({ withAt: true }));
  let off = A.state().off;
  assert.equal(off['Pinnacle +30s'], undefined);
  assert.equal(off['Bet105'], undefined);
  for (const b of ['Pinnacle', 'Betano', 'Superbet', 'Betfair Exchange (recorded by us)', 'bet365 (Oddspapi, capture ended 26 Sep)'])
    assert.equal(off[b], true, `${b} starts off`);
  A = build(); A.reset();
  A.buildOddsSection(fixture({ withPin: false, withAt: true }));
  off = A.state().off;
  assert.equal(off['Bet105'], undefined, 'no Pinnacle +30s -> Bet105 alone');
  assert.equal(off['Pinnacle'], true, 'the api-tennis Pinnacle stays off');
  assert.equal(off['Superbet'], true);
  // neither default line has data -> the first Sharp line with data (the api-tennis Pinnacle)
  A = build(); A.reset();
  A.buildOddsSection(fixture({ withPin: false, bet105MetaOnly: true, withAt: true }));
  off = A.state().off;
  assert.equal(off['Pinnacle'], undefined, 'fallback: first Sharp line with data');
  assert.equal(off['Betano'], true);
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
  assert.deepEqual(rows.slice(0, 3), ['Pinnacle +30s', 'Pinnacle', 'Bet105']);
});

test('every configured book gets a row on every card; subheading "X of Y books priced"', () => {
  const A = build(); A.reset();
  const m = fixture({ withPin: false });
  delete m.oddsMovement.chart.books['Superbet'];
  m.oddsMovement.chart.meta['Superbet'].note = 'not recorded — our recording began 26 Sep';
  const h = A.buildOddsSection(m);
  const rows = [...h.matchAll(/class="aodds-row[^"]*" data-book="([^"]*)" data-group="([^"]*)"/g)].map(x => [x[1], x[2]]);
  assert.deepEqual(rows.slice(0, 13), [['Pinnacle +30s', 'sharp'], ['Pinnacle', 'sharp'], ['Bet105', 'sharp'],
                                       ...AT_SOFT.map(b => [b, 'soft']), ['Superbet', 'soft'],
                                       ['Betfair Exchange (recorded by us)', 'soft']]);
  assert.ok(rowOf(h, 'Pinnacle +30s').includes('not checked yet'), 'no meta at all = not checked, never "not priced"');
  const m2 = fixture({ withPin: false });
  m2.oddsMovement.chart.meta['Pinnacle +30s'] = { source: 'Oddspapi', group: 'sharp', clock: 'book tick', checkedAt: null };
  A.reset();
  assert.ok(rowOf(A.buildOddsSection(m2), 'Pinnacle +30s').includes('not checked yet'),
            'a verdict with no check time is "not checked yet", never "not priced"');
  assert.ok(rowOf(h, 'Superbet').includes('not recorded — our recording began 26 Sep'), 'the writer\'s note wins');
  assert.ok(/class="aodds-priced">2 of 13 books priced</.test(h), 'Bet105 + Betfair Exchange priced, of 13 configured');
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
  assert.ok(/class="aodds-priced">0 of 13 books priced</.test(h), 'legacy bet365 is not a configured book');
  assert.ok(h.includes('data-book="bet365 (Oddspapi, capture ended 26 Sep)"'));
  assert.equal(A.state().off['bet365 (Oddspapi, capture ended 26 Sep)'], undefined, 'the only book is on');
  // capturedAt 26 h ago on an upcoming card -> no recent data
  assert.ok(rowOf(h, 'bet365 (Oddspapi, capture ended 26 Sep)').includes('no recent data'));
});

test('nothing at all -> the reduced view + every configured book as a dash row, never an invented line', () => {
  const A = build(); A.reset();
  const h0 = A.buildOddsSection({ id: 'x', p1: 'A. B', p2: 'C. D', date: '2026-10-01', time: '10:00', oddsMovement: null });
  assert.ok(h0.startsWith('REDUCED'));
  assert.equal((h0.match(/class="aodds-row aodds-nodata"/g) || []).length, 13);
  assert.ok(/0 of 13 books priced/.test(h0) && !h0.includes('<polyline'));
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

test('an old six-book shard: legacy "Pinnacle" never takes the api-tennis label or a default slot', () => {
  const A = build(); A.reset();
  const m = fixture({ withAt: true });
  m.oddsMovement.books.Pinnacle = { p1: [[iso(Date.now() - 40 * H), 2.2]], p2: [[iso(Date.now() - 40 * H), 1.7]] };
  const h = A.buildOddsSection(m);
  assert.equal(A.state().off['Pinnacle +30s'], undefined, 'Pinnacle +30s is on');
  assert.equal(A.state().off['Pinnacle (Oddspapi)'], true, 'the legacy anchor-key book starts off');
  assert.ok(rowOf(h, 'Pinnacle').includes('api-tennis · seen by us every 5 min'), '"Pinnacle" stays the api-tennis line');
  // the legacy Pinnacle is Sharp, listed after the configured Sharp books
  const rows = [...h.matchAll(/class="aodds-row[^"]*" data-book="([^"]*)" data-group="sharp"/g)].map(x => x[1]);
  assert.deepEqual(rows, ['Pinnacle +30s', 'Pinnacle', 'Bet105', 'Pinnacle (Oddspapi)']);
});

// ── Wave 2 (founder 2026-09-26: comment d5bf3dda, cards 78ec4dd2 + 31e4beef) ─────────
test('wave 2: 13 configured books, Sharp = Pinnacle +30s / Pinnacle / Bet105, labels by source', () => {
  const A = build(); A.reset();
  const h = A.buildOddsSection(fixture({ withAt: true }));
  const rows = [...h.matchAll(/class="aodds-row[^"]*" data-book="([^"]*)" data-group="([^"]*)"/g)].map(x => [x[1], x[2]]);
  assert.deepEqual(rows.filter(r => r[1] === 'sharp').map(r => r[0]), ['Pinnacle +30s', 'Pinnacle', 'Bet105']);
  assert.deepEqual(rows.filter(r => r[1] === 'soft').map(r => r[0]),
    [...AT_SOFT, 'Superbet', 'Betfair Exchange (recorded by us)', 'bet365 (Oddspapi, capture ended 26 Sep)']);
  assert.ok(/class="aodds-priced">6 of 13 books priced</.test(h), 'Pin +30s, Pinnacle, Bet105, Betano, Superbet, BF Exch');
  // two Betfairs, two bet365s: never merged
  assert.ok(h.includes('data-book="Betfair Sportsbook"') && h.includes('data-book="Betfair Exchange (recorded by us)"'));
  assert.ok(h.includes('data-book="bet365 (api-tennis)"') && h.includes('data-book="bet365 (Oddspapi, capture ended 26 Sep)"'));
  // api-tennis provenance: our clock + first seen
  const src = rowOf(h, 'Betano');
  assert.ok(/api-tennis · seen by us every 5 min · first seen [A-Z][a-z]{2} \d+ \d\d:\d\d/.test(src), src.slice(0, 400));
  // a Sharp api-tennis book never displaces the default Sharp lines, and a group is fixed by config
  const m = fixture({ withAt: true }); m.oddsMovement.chart.meta['Betano'].group = 'sharp';
  A.reset(); assert.ok(/data-book="Betano" data-group="soft"/.test(A.buildOddsSection(m)), 'Betano is Soft whatever the writer stored');
});

test('wave 2: a gap is never drawn across — step nulls it, the chart splits the line', () => {
  const A = build();
  // the step: [from, to) nulled; an open gap (to = null) nulls to the end
  assert.deepEqual(A.aOddsStepTo([[10, 2.0], [40, 2.2]], [10, 20, 30, 40, 50], null, [[iso(15).replace(/.*/, '')]]),
                   [2.0, 2.0, 2.0, 2.2, 2.2], 'an unparseable gap changes nothing');
  const g = [[new Date(20).toISOString(), new Date(40).toISOString()]];
  assert.deepEqual(A.aOddsStepTo([[10, 2.0], [40, 2.2]], [10, 20, 30, 40, 50], null, g), [2.0, null, null, 2.2, 2.2]);
  assert.deepEqual(A.aOddsStepTo([[10, 2.0]], [10, 20, 30], null, [[new Date(20).toISOString(), null]]), [2.0, null, null]);
  // rendered: Betano only, with a 2 h hole in the middle -> two polylines per panel
  const now = Date.now();
  const m = fixture({ now, withAt: true });
  m.oddsMovement.chart.books['Betano'] = { p1: [[iso(now - 10 * H), 2.5], [iso(now - 3 * H), 2.4]],
                                           p2: [[iso(now - 10 * H), 1.55], [iso(now - 3 * H), 1.6]] };
  m.oddsMovement.chart.meta['Betano'].gaps = [[iso(now - 7 * H), iso(now - 5 * H)]];
  A.reset(); A.buildOddsSection(m);
  A.state().off = Object.fromEntries(Object.keys(A.aOddsBooksOf(m).books).filter(b => b !== 'Betano').map(b => [b, true]));
  const h = A.buildOddsSection(m);
  const dash = h.match(/data-book="Betano"/) && [...h.matchAll(/<polyline points="([^"]+)" fill="none" stroke="([^"]+)" stroke-width="2" stroke-dasharray="([^"]*)"/g)];
  assert.equal(dash.length, 4, `two runs on each of the two panels, got ${dash.length}`);
  // the runs do not touch: the first ends before the gap's start column, the next starts at its end
  const xs = dash.map(d => d[1].split(' ').map(p => Number(p.split(',')[0])));
  assert.ok(Math.max(...xs[0]) < Math.min(...xs[1]), 'a visible break between the runs');
});

test('wave 2: gap edges survive the 30-column downsample', () => {
  const now = Date.now();
  const A = build(); A.reset();
  const m = fixture({ now, withAt: true });
  // 80 real Pinnacle +30s points -> the grid is downsampled to <= 30 columns
  const pts = side => Array.from({ length: 80 }, (_, i) => [iso(now - 40 * H + i * 30 * 60e3), side === 'p1' ? 2 + i / 1000 : 1.7 - i / 1000]);
  m.oddsMovement.chart.books['Pinnacle +30s'] = { p1: pts('p1'), p2: pts('p2') };
  // a 20-min Betano hole that would fall between two sampled columns
  m.oddsMovement.chart.books['Betano'] = { p1: [[iso(now - 30 * H), 2.5]], p2: [[iso(now - 30 * H), 1.55]] };
  m.oddsMovement.chart.meta['Betano'].gaps = [[iso(now - 20 * H - 7 * 60e3), iso(now - 20 * H + 13 * 60e3)]];
  A.buildOddsSection(m);
  A.state().off = Object.fromEntries(Object.keys(A.aOddsBooksOf(m).books).filter(b => b !== 'Betano').map(b => [b, true]));
  const h = A.buildOddsSection(m);
  const runs = [...h.matchAll(/<polyline points="([^"]+)" fill="none" stroke="[^"]+" stroke-width="2"/g)];   // chart lines, not sparklines
  assert.equal(runs.length, 4, 'the short hole still splits the line on both panels');
});

test('wave 2: a book gone from the feed reads "not in feed since", no Now, never best', () => {
  const now = Date.now();
  const A = build(); A.reset();
  const m = fixture({ now, withAt: true });
  m.oddsMovement.chart.books['Betano'] = { p1: [[iso(now - 5 * H), 9.9]], p2: [[iso(now - 5 * H), 9.9]] };
  m.oddsMovement.chart.meta['Betano'].gaps = [[iso(now - 2 * H), null]];
  const h = A.buildOddsSection(m);
  const row = rowOf(h, 'Betano');
  assert.ok(/not in feed since \d\d:\d\d/.test(row), 'tagged');
  assert.ok(!/font-size:15px;[^>]*>9\.90</.test(row), 'no Now');
  assert.ok(!/color:#3ed68c[^>]*>9\.90</.test(h), 'never the best price');
  assert.ok(!/font-size:22px; font-weight:800;">9\.90</.test(h), 'never in the summary');
});

test('wave 2: a one-column run beside a gap is a dot; a book out of its feed is not "priced"', () => {
  const now = Date.now();
  const A = build(); A.reset();
  const m = fixture({ now, withAt: true });
  m.oddsMovement.chart.books['Betano'] = { p1: [[iso(now - 5 * H), 2.5], [iso(now - 2 * H), 2.4]], p2: [[iso(now - 5 * H), 1.55], [iso(now - 2 * H), 1.6]] };
  m.oddsMovement.chart.meta['Betano'].gaps = [[iso(now - 5 * H + 60e3), iso(now - 2 * H)]];
  A.buildOddsSection(m);
  A.state().off = Object.fromEntries(Object.keys(A.aOddsBooksOf(m).books).filter(b => b !== 'Betano').map(b => [b, true]));
  const h = A.buildOddsSection(m);
  assert.ok((h.match(/class="aodds-run1"/g) || []).length >= 2, 'the 1-min price before the gap is a dot on both panels');
  const A2 = build(); A2.reset();
  const h2 = A2.buildOddsSection(fixture({ now, withAt: true }));   // 6 priced
  const m3 = fixture({ now, withAt: true }); m3.oddsMovement.chart.meta['Betano'].gaps = [[iso(now - H), null]];
  A2.reset();
  assert.ok(/6 of 13 books priced/.test(h2) && /5 of 13 books priced/.test(A2.buildOddsSection(m3)), 'Betano out of the feed -> 5 of 13');
  // Wave 1 books (no gaps) never get dots
  A2.reset();
  assert.ok(!A2.buildOddsSection(fixture({ now })).includes('aodds-run1'));
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
