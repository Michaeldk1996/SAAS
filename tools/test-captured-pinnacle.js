#!/usr/bin/env node
// tools/test-captured-pinnacle.js — TEN-316: captured Pinnacle closes refreshed every pipeline run.
//
// Drives the REAL build-captured-pinnacle.js build() against a throwaway git repo whose
// matches.json commits carry Oddspapi Pinnacle series (chart 'Pinnacle +30s' and the legacy
// books.Pinnacle), and proves:
//   - an in-play tick is never the close (actual start from Oddspapi trueStart, and from the
//     card state's live-flip lower bound);
//   - a scheduled time is never a start; a rejected (> 6 h) or ambiguous trueStart never is;
//   - one-sided = dropped; ticks only in an older commit still count; merge never deletes or
//     backdates a held row; an idle run leaves the file untouched.
// Control: the same build with the start cut removed must FAIL the in-play check.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
let failed = 0, passed = 0;
const check = (name, ok, detail) => { if (ok) passed++; else { failed++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); } };

const T = Date.parse('2026-09-27T10:31:59.000Z');                  // the actual start
const at = (min) => new Date(T + min * 60e3).toISOString();
const card = (id, p1, p2, k1, k2, om, extra) => Object.assign({ id: 'past-' + id, date: '2026-09-27', time: '12:35', p1, p2, p1Key: k1, p2Key: k2, finalScore: '2-0', oddsMovement: om }, extra || {});
const p30 = (p1, p2) => ({ chart: { books: { 'Pinnacle +30s': { p1, p2 } }, meta: {} } });

function repoWith(commits, { fixtures = null, cardState = null, held = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ten316-'));
  const g = (...a) => execFileSync('git', ['-C', dir, ...a], { stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env,
    { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }) });
  g('init', '-q');
  if (fixtures) fs.writeFileSync(path.join(dir, '.ten225-fixture-index.json.gz'), zlib.gzipSync(JSON.stringify({ fixtures })));
  if (cardState) fs.writeFileSync(path.join(dir, 'odds-card-state.json'), JSON.stringify({ byKey: cardState }));
  if (held) fs.writeFileSync(path.join(dir, 'captured-closes-pinnacle.json'), JSON.stringify(held));
  commits.forEach((M, i) => {
    fs.writeFileSync(path.join(dir, 'matches.json'), JSON.stringify(M));
    g('add', 'matches.json');
    g('commit', '-q', '-m', 'tick ' + i, '--date', '2026-09-27T0' + i + ':00:00Z');
  });
  // The pipeline's working copy has oddsMovement nulled — the builder must read git, not this.
  fs.writeFileSync(path.join(dir, 'matches.json'), JSON.stringify(commits[commits.length - 1].map((m) => Object.assign({}, m, { oddsMovement: null }))));
  return dir;
}

function run(builderPath, dir, since = '2026-09-01T00:00:00Z') {
  delete require.cache[require.resolve(builderPath)];
  const B = require(builderPath);
  const out = path.join(dir, 'captured-closes-pinnacle.json');
  const r = B.build({ root: dir, out, since, nowMs: Date.parse('2026-09-28T06:00:00Z') });
  const doc = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { rows: [] };
  return { r, doc, row: (ek) => doc.rows.find((x) => x.eventKey === ek) };
}

// Card-state key for Harris v Kovacevic on the card date (the ruled key, bsp-pipeline ocsMatchKey).
const { ocsMatchKey } = require(path.join(REPO, 'bsp-pipeline.js'));
const KEY = ocsMatchKey('2026-09-27', 'L. Harris', 'A. Kovacevic');
const flip = (ts, src = 'api-tennis-live') => ({ [KEY]: { startTs: ts, startTsSource: src } });
// In card orientation. The in-play ticks (1.01 / 26.0) sit AFTER the start.
const SERIES = p30([[at(-90), 1.60], [at(-22), 1.534], [at(0.25), 1.01], [at(3), 1.02]],
                   [[at(-90), 2.40], [at(-22), 2.65], [at(0.25), 26.0], [at(3), 21.0]]);

function cases(builderPath) {
  const res = {};
  // 1. Live-flip lower bound (card state) as the start.
  let d = repoWith([[card(1, 'L. Harris', 'A. Kovacevic', 10, 20, SERIES)]], { cardState: flip(at(0)) });
  let x = run(builderPath, d);
  res.flip = x.row(1);
  // 2. Oddspapi trueStart wins over a later card-state start; a tick between them is in-play.
  const S2 = p30([[at(-22), 1.534], [at(4), 1.45]], [[at(-22), 2.65], [at(4), 2.80]]);
  d = repoWith([[card(2, 'L. Harris', 'A. Kovacevic', 10, 20, S2)]],
    { fixtures: { id9: { cat: 'ATP', trueStart: at(0), trueEnd: at(95), p1: 'Harris, Lloyd', p2: 'Kovacevic, Aleksandar' } }, cardState: flip(at(10)) });
  x = run(builderPath, d);
  res.trueStart = x.row(2);
  return res;
}

// ---- the real builder ------------------------------------------------------------------
const REAL = path.join(REPO, 'build-captured-pinnacle.js');
const c = cases(REAL);
check('live-flip start: close = last pre-start tick', c.flip && c.flip.p1 === 1.534 && c.flip.p2 === 2.65 && c.flip.at === at(-22), JSON.stringify(c.flip));
check('live-flip start: the in-play 1.01 / 26.0 is present in the input and never the close', SERIES.chart.books['Pinnacle +30s'].p1.some((t) => t[1] === 1.01) && c.flip && c.flip.p1 !== 1.01 && c.flip.p2 !== 26.0);
check('live-flip start: labelled', c.flip && c.flip.startSource === 'api-tennis-live' && c.flip.book === 'Pinnacle +30s' && c.flip.trueStart === at(0));
check('trueStart beats a later card-state start: the +4 min tick is in-play', c.trueStart && c.trueStart.p1 === 1.534 && c.trueStart.p2 === 2.65 && c.trueStart.startSource === 'oddspapi', JSON.stringify(c.trueStart));

// A tick exactly at the start is pre-start ("at or before"); 1 ms after is in-play.
{
  const S = p30([[at(-5), 1.70], [at(0), 1.65], [new Date(T + 1).toISOString(), 1.30]], [[at(-5), 2.20], [at(0), 2.30], [new Date(T + 1).toISOString(), 3.60]]);
  const x = run(REAL, repoWith([[card(3, 'L. Harris', 'A. Kovacevic', 10, 20, S)]], { cardState: flip(at(0)) }));
  check('a tick AT the start is kept, 1 ms later is not', x.row(3) && x.row(3).p1 === 1.65 && x.row(3).p2 === 2.30, JSON.stringify(x.row(3)));
}
// Scheduled time only (m.time, m.startTs, a card-state row with no start) -> dropped.
{
  const x = run(REAL, repoWith([[card(4, 'L. Harris', 'A. Kovacevic', 10, 20, SERIES, { startTs: at(4) })]], { cardState: flip(null, 'none') }));
  check('no actual start (scheduled only) -> dropped', !x.row(4) && x.r.stats.dropped.noStart === 1, JSON.stringify(x.r.stats));
}
// trueStart with a 7-hour match is rejected; falls through to the card state, else dropped.
{
  const fx = { id9: { cat: 'ATP', trueStart: at(-120), trueEnd: at(300), p1: 'Harris, Lloyd', p2: 'Kovacevic, Aleksandar' } };
  let x = run(REAL, repoWith([[card(5, 'L. Harris', 'A. Kovacevic', 10, 20, SERIES)]], { fixtures: fx }));
  check('rejected trueStart (> 6 h), no card state -> dropped', !x.row(5) && x.r.stats.dropped.rejectedStart === 1, JSON.stringify(x.r.stats));
  x = run(REAL, repoWith([[card(5, 'L. Harris', 'A. Kovacevic', 10, 20, SERIES)]], { fixtures: fx, cardState: flip(at(0)) }));
  check('rejected trueStart falls through to the live-flip start', x.row(5) && x.row(5).startSource === 'api-tennis-live' && x.row(5).p1 === 1.534);
  const neg = { id9: { cat: 'ATP', trueStart: at(0), trueEnd: at(-30), p1: 'Harris, Lloyd', p2: 'Kovacevic, Aleksandar' } };
  x = run(REAL, repoWith([[card(5, 'L. Harris', 'A. Kovacevic', 10, 20, SERIES)]], { fixtures: neg }));
  check('trueEnd before trueStart is rejected', !x.row(5) && x.r.stats.dropped.rejectedStart === 1);
}
// Two different trueStarts for one card -> no unique start -> dropped (the one-time extract's rule).
{
  const fx = { a: { cat: 'ATP', trueStart: at(0), p1: 'Harris, Lloyd', p2: 'Kovacevic, Aleksandar' }, b: { cat: 'ATP', trueStart: at(60), p1: 'Lloyd Harris', p2: 'Aleksandar Kovacevic' } };
  const x = run(REAL, repoWith([[card(6, 'L. Harris', 'A. Kovacevic', 10, 20, SERIES)]], { fixtures: fx, cardState: flip(at(0)) }));
  check('ambiguous trueStart -> dropped', !x.row(6) && x.r.stats.dropped.ambiguousStart === 1, JSON.stringify(x.r.stats));
}
// One-sided -> dropped.
{
  const x = run(REAL, repoWith([[card(7, 'L. Harris', 'A. Kovacevic', 10, 20, p30([[at(-5), 1.7]], [[at(3), 2.3]]))]], { cardState: flip(at(0)) }));
  check('one side with no pre-start tick -> dropped', !x.row(7) && x.r.stats.dropped.oneSided === 1);
}
// Legacy books.Pinnacle; a pre-start tick seen only in an OLDER commit still counts.
{
  const older = [card(8, 'L. Harris', 'A. Kovacevic', 10, 20, { books: { Pinnacle: { p1: [[at(-40), 1.50], [at(-2), 1.48]], p2: [[at(-40), 2.70], [at(-2), 2.75]] } } })];
  const head = [card(8, 'L. Harris', 'A. Kovacevic', 10, 20, { books: { Pinnacle: { p1: [[at(-40), 1.50], [at(5), 1.20]], p2: [[at(-40), 2.70], [at(5), 4.2]] } } })];
  const x = run(REAL, repoWith([older, head], { cardState: flip(at(0)) }));
  check('books.Pinnacle series; a tick only in an older commit is used', x.row(8) && x.row(8).p1 === 1.48 && x.row(8).p2 === 2.75 && x.row(8).book === 'Pinnacle', JSON.stringify(x.row(8)));
}
// Merge: a held row out of view is kept; a held row with a LATER close is never backdated; idle = untouched.
{
  const keep = { eventKey: 77, date: '2026-07-20', p1Key: 1, p2Key: 2, p1: 1.9, p2: 1.9, at: '2026-07-20T09:00:00.000Z' };
  const later = { eventKey: 1, date: '2026-09-27', p1Key: 10, p2Key: 20, p1: 1.52, p2: 2.68, at: at(-1) };
  const dir = repoWith([[card(1, 'L. Harris', 'A. Kovacevic', 10, 20, SERIES)]], { cardState: flip(at(0)), held: { rows: [keep, later] } });
  const x = run(REAL, dir);
  check('merge keeps a held row the scan cannot see', !!x.row(77));
  check('merge never replaces a held row with an earlier close', x.row(1) && x.row(1).p1 === 1.52 && x.r.added === 0 && x.r.replaced === 0);
  const before = fs.readFileSync(path.join(dir, 'captured-closes-pinnacle.json'), 'utf8');
  const y = run(REAL, dir);
  check('idle run leaves the file untouched', y.r.wrote === false && fs.readFileSync(path.join(dir, 'captured-closes-pinnacle.json'), 'utf8') === before);
}
// The committed file's existing rows survive a real run over it (the extract's 2026-07..09 set).
{
  const held = JSON.parse(fs.readFileSync(path.join(REPO, 'captured-closes-pinnacle.json'), 'utf8'));
  const B = require(REAL);
  const merged = B.mergeRows(held.rows, []);
  check('committed rows are all kept by a merge', merged.rows.length === held.rows.length && held.rows.length >= 408);
  check('every committed row is two-sided and >= 1.01', held.rows.every((r) => r.p1 >= 1.01 && r.p2 >= 1.01 && r.p1Key && r.p2Key));
}

// ---- control: the start cut removed must be caught -----------------------------------
{
  const src = fs.readFileSync(REAL, 'utf8');
  const anchor = "if (ms == null || !(p >= 1.01) || ms > cutMs) continue;";
  if (src.split(anchor).length !== 2) { check('mutant anchor found exactly once', false); }
  else {
    const mut = path.join(REPO, '.ten316-mutant-build-captured-pinnacle.js');
    fs.writeFileSync(mut, src.replace(anchor, "if (ms == null || !(p >= 1.01)) continue;"));
    try {
      const m = cases(mut);
      check('CONTROL: without the cut the in-play tick becomes the close (test is not vacuous)', m.flip && m.flip.p1 !== 1.534);
    } finally { fs.rmSync(mut, { force: true }); }
  }
}

console.log(`test-captured-pinnacle: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
