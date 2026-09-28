#!/usr/bin/env node
// tools/test-ten346-backfill.js — TEN-346: the one-time 3–22 Sep captured-Pinnacle backfill.
//
// Drives the REAL tools/ten346-backfill-captured-pinnacle.js build() — which cuts through the
// REAL build-captured-pinnacle.js — over a cached Oddspapi pinnacle+30 series, and proves:
//   - the in-play check (TEN-316's): an in-play tick is never the close, at the live-flip start
//     and at an Oddspapi trueStart that beats a later card-state start;
//   - the series is oriented to the CARD (Oddspapi participant1 is the card's p2 here);
//   - no start / one side / not fetched / 404 / an unjoined card -> no row, each counted;
//   - the merge never deletes a held row, records the backfill, and a re-run adds nothing;
//   - the per-run builder keeps the backfill record when it rewrites the file.
// Control: the same backfill through the builder with the start cut removed must FAIL the
// in-play check.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const BF = require(path.join(REPO, 'tools', 'ten346-backfill-captured-pinnacle.js'));
const REAL = path.join(REPO, 'build-captured-pinnacle.js');
const { ocsMatchKey, ocsNameKey } = require(path.join(REPO, 'bsp-pipeline.js'));
let failed = 0, passed = 0;
const check = (name, ok, detail) => { if (ok) passed++; else { failed++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); } };
const TMP = [];
process.on('exit', () => { for (const d of TMP) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ten346-')); TMP.push(d); return d; };

const T = Date.parse('2026-09-19T10:31:59.000Z');                  // the actual start
const at = (min) => new Date(T + min * 60e3).toISOString();
const NOW = Date.parse('2026-09-29T06:00:00Z');
const KEY = ocsMatchKey('2026-09-19', 'L. Harris', 'A. Kovacevic');
const card = (ek, extra) => Object.assign({ eventKey: String(ek), date: '2026-09-19', p1: 'L. Harris', p2: 'A. Kovacevic', p1Key: 10, p2Key: 20,
  finished: true, fixtureId: 'id' + ek, orient: 'swap', join: 'fixture-map' }, extra || {});
// Oddspapi orientation: participant1 = Kovacevic (the CARD's p2). In-play ticks sit after the start.
const HARRIS = [[at(-90), 1.60], [at(-22), 1.534], [at(0.25), 1.01], [at(3), 1.02]];
const KOVAC = [[at(-90), 2.40], [at(-22), 2.65], [at(0.25), 26.0], [at(3), 21.0]];

function world({ cards, cache, cardState = {}, fixtures = null, held = null }) {
  const root = tmp(), cacheDir = path.join(root, 'cache');
  fs.mkdirSync(cacheDir);
  for (const [fid, e] of Object.entries(cache)) fs.writeFileSync(path.join(cacheDir, `${fid}.json`), JSON.stringify(Object.assign({ fixtureId: fid, status: 200 }, e)));
  if (fixtures) fs.writeFileSync(path.join(root, '.ten225-fixture-index.json.gz'), zlib.gzipSync(JSON.stringify({ fixtures })));
  const out = path.join(root, 'captured-closes-pinnacle.json');
  if (held) fs.writeFileSync(out, JSON.stringify(held));
  const targets = { window: { from: '2026-09-03', to: '2026-09-22' }, cards, cardState: { byKey: cardState } };
  const run = (builder = REAL) => {
    const r = BF.build({ root, targets, cacheDir, out, nowMs: NOW, builder });
    const doc = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { rows: [] };
    return { r, doc, row: (ek) => doc.rows.find((x) => x.eventKey === ek) };
  };
  return { root, out, run };
}
const flip = (ts) => ({ [KEY]: { startTs: ts, startTsSource: 'api-tennis-live' } });

function inPlayCase(builder) {
  const w = world({ cards: [card(1)], cache: { id1: { series: { p1: KOVAC, p2: HARRIS } } }, cardState: flip(at(0)) });
  return w.run(builder);
}

// ---- the real tool ----------------------------------------------------------------------
{
  const x = inPlayCase(REAL);
  const r = x.row(1);
  check('live-flip start: close = last pre-start tick, oriented to the card', r && r.p1 === 1.534 && r.p2 === 2.65 && r.at === at(-22), JSON.stringify(r));
  check('the in-play 1.01 / 26.0 is in the input and never the close', HARRIS.some((t) => t[1] === 1.01) && r && r.p1 !== 1.01 && r.p2 !== 26.0);
  check('labelled like the chart rows', r && r.book === 'Pinnacle +30s' && r.startSource === 'api-tennis-live' && r.trueStart === at(0) && r.p1Key === 10 && r.p2Key === 20);
  check('the backfill is recorded in the file', x.doc.backfills && x.doc.backfills.length === 1 && x.doc.backfills[0].ticket === 'TEN-346' && x.doc.backfills[0].added === 1);
  check('per-day report: board / finished / held / added', x.r.byDay['2026-09-19'] && x.r.byDay['2026-09-19'].finished === 1 && x.r.byDay['2026-09-19'].added === 1 && x.r.byDay['2026-09-19'].heldFinished === 1, JSON.stringify(x.r.byDay));
}
// Oddspapi trueStart beats a later card-state start: a tick between them is in-play.
{
  const fx = { idX: { cat: 'ATP', trueStart: at(0), trueEnd: at(95), p1: 'Harris, Lloyd', p2: 'Kovacevic, Aleksandar' } };
  const w = world({ cards: [card(2, { orient: 'same' })], fixtures: fx, cardState: flip(at(10)),
    cache: { id2: { series: { p1: [[at(-22), 1.534], [at(4), 1.45]], p2: [[at(-22), 2.65], [at(4), 2.80]] } } } });
  const r = w.run().row(2);
  check('trueStart beats a later card-state start: the +4 min tick is in-play', r && r.p1 === 1.534 && r.p2 === 2.65 && r.startSource === 'oddspapi', JSON.stringify(r));
}
// Drops: no start, one side, not fetched, 404, no Pinnacle block, an unjoined card.
{
  const w = world({
    cards: [card(3, { date: '2026-09-18', p1: 'X. Alpha', p2: 'Y. Beta' }), card(4), card(5, { p1: 'A. Kovacevic', p2: 'L. Harris', orient: 'same' }), card(6), card(7), card(8, { fixtureId: null, orient: null, skip: 'noFixture' })],
    cardState: flip(at(0)),
    cache: { id3: { series: { p1: KOVAC, p2: HARRIS } }, id4: { series: { p1: [[at(3), 2.3]], p2: [[at(-5), 1.7]] } }, id6: { status: 404 }, id7: { series: null } },
  });
  const x = w.run();
  check('no actual start -> dropped', !x.row(3) && x.r.dropped.noStart === 1, JSON.stringify(x.r.dropped));
  check('one side with no pre-start tick -> dropped', !x.row(4) && x.r.dropped.oneSided === 1);
  check('not fetched / 404 / no pinnacle+30 block -> counted, no row', !x.row(5) && !x.row(6) && !x.row(7) && x.r.dropped.notFetched === 1 && x.r.dropped.http404 === 1 && x.r.dropped.noPinnacle === 1, JSON.stringify(x.r.dropped));
  check('an unjoined card is never read', !x.row(8) && x.r.fetched === 2);
  check('nothing kept -> file not written', x.r.wrote === false && !fs.existsSync(w.out));
}
// Merge: held rows survive, a re-run adds nothing and leaves the file untouched.
{
  const keep = { eventKey: 77, date: '2026-09-02', p1Key: 1, p2Key: 2, p1: 1.9, p2: 1.9, at: '2026-09-02T09:00:00.000Z', trueStart: '2026-09-02T10:00:00.000Z' };
  const w = world({ cards: [card(1)], cache: { id1: { series: { p1: KOVAC, p2: HARRIS } } }, cardState: flip(at(0)), held: { generatedAt: 'x', scannedThrough: { commit: 'abc' }, rows: [keep] } });
  const x = w.run();
  check('merge keeps every held row and the doc fields', x.row(77) && x.row(1) && x.doc.scannedThrough.commit === 'abc' && x.doc.rows.length === 2);
  const before = fs.readFileSync(w.out, 'utf8');
  const y = w.run();
  check('a re-run adds nothing and leaves the file untouched', y.r.added === 0 && y.r.wrote === false && fs.readFileSync(w.out, 'utf8') === before);
}
// Orientation helpers.
{
  const c = { p1: 'L. Harris', p2: 'A. Kovacevic' };
  check('map orient re-read against the card (map p1/p2 reversed -> flipped)', BF.orientFromMap({ orient: 'same', p1: 'A. Kovacevic', p2: 'L. Harris' }, c) === 'swap' && BF.orientFromMap({ orient: 'swap', p1: 'L. Harris', p2: 'A. Kovacevic' }, c) === 'swap');
  check('map names that are not the card -> no orient', BF.orientFromMap({ orient: 'same', p1: 'J. Sinner', p2: 'L. Harris' }, c) === null);
  check('name orient by the card-state name key', BF.orientByName(ocsNameKey, c, 'Kovacevic, Aleksandar', 'Harris, Lloyd') === 'swap' && BF.orientByName(ocsNameKey, c, 'Harris, Lloyd', 'Kovacevic, Aleksandar') === 'same' && BF.orientByName(ocsNameKey, c, 'Sinner, Jannik', 'Harris, Lloyd') === null);
}
// The per-run builder keeps the backfill record when it rewrites the file.
{
  const dir = tmp();
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env,
    { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }) });
  g('init', '-q');
  const M = [{ id: 'past-9', date: '2026-09-27', p1: 'L. Harris', p2: 'A. Kovacevic', p1Key: 10, p2Key: 20,
    oddsMovement: { chart: { books: { 'Pinnacle +30s': { p1: [['2026-09-27T09:00:00Z', 1.5]], p2: [['2026-09-27T09:00:00Z', 2.7]] } } } } }];
  fs.writeFileSync(path.join(dir, 'matches.json'), JSON.stringify(M));
  g('add', 'matches.json'); g('commit', '-q', '-m', 't', '--date', '2026-09-27T10:00:00Z');
  fs.writeFileSync(path.join(dir, 'odds-card-state.json'), JSON.stringify({ byKey: { [ocsMatchKey('2026-09-27', 'L. Harris', 'A. Kovacevic')]: { startTs: '2026-09-27T10:00:00Z', startTsSource: 'api-tennis-live' } } }));
  const bf = [{ ticket: 'TEN-346', added: 1 }];
  const out = path.join(dir, 'captured-closes-pinnacle.json');
  fs.writeFileSync(out, JSON.stringify({ backfills: bf, rows: [] }));
  delete require.cache[require.resolve(REAL)];
  const r = require(REAL).build({ root: dir, out, since: '2026-09-01T00:00:00Z', nowMs: NOW });
  const doc = JSON.parse(fs.readFileSync(out, 'utf8'));
  check('build-captured-pinnacle.js rewrites the file and keeps `backfills`', r.wrote && r.added === 1 && JSON.stringify(doc.backfills) === JSON.stringify(bf), JSON.stringify(doc.backfills));
}

// ---- control: the start cut removed must be caught -----------------------------------
{
  const src = fs.readFileSync(REAL, 'utf8');
  const anchor = "if (ms == null || !(p >= 1.01) || ms > cutMs) continue;";
  if (src.split(anchor).length !== 2) { check('mutant anchor found exactly once', false); }
  else {
    const mut = path.join(REPO, '.ten346-mutant-build-captured-pinnacle.js');
    fs.writeFileSync(mut, src.replace(anchor, "if (ms == null || !(p >= 1.01)) continue;"));
    try {
      const r = inPlayCase(mut).row(1);
      check('CONTROL: without the cut the in-play tick becomes the backfilled close (test is not vacuous)', r && r.p1 !== 1.534, JSON.stringify(r));
    } finally { fs.rmSync(mut, { force: true }); }
  }
}

console.log(`test-ten346-backfill: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
