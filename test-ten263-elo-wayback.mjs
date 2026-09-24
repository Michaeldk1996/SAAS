// TEN-263 (founder ruling 2026-09-24): the Wayback Elo backfill. Drives tools/backfill-elo-wayback.mjs's exports.
// MUT=label-asof node --test test-ten263-elo-wayback.mjs  -> mutation control: a copy of the tool whose asOf is
// taken from TA's label instead of the capture day; the asOf test must go red.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL = path.join(path.dirname(fileURLToPath(import.meta.url)), 'tools/backfill-elo-wayback.mjs');
let modPath = TOOL;
if (process.env.MUT === 'label-asof') {
  const src = fs.readFileSync(TOOL, 'utf8');
  const mutated = src.replace("asOf: tsDay(c.captureTimestamp),", "asOf: c.taLastUpdate || tsDay(c.captureTimestamp),");
  if (mutated === src) throw new Error('mutation did not apply');
  modPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'eloWb-')), 'mut.mjs');
  fs.writeFileSync(modPath, mutated);
}
const { parseReport, dedupeCaptures, mergeArchived, labelLiveSnapshots } = await import(modPath);

// A current-layout row, verbatim shape from Wayback 20260629075120 (Sinner), and a legacy-layout row
// from Wayback 20160226012703 (Djokovic).
const TH_CUR = '<thead><tr><th align="right">Elo&nbsp;Rank</th><th align="left">Player</th><th align="right">Age</th><th align="right">Elo</th><th align="left">&nbsp;&nbsp;&nbsp;&nbsp;</th></tr></thead>';
const rowCur = (id, name, elo, age = '24.7') => `<tr><td align="right">1</td><td align="left"><a href="https://www.tennisabstract.com/cgi-bin/player.cgi?p=${id}">${name}</a></td><td align="right">${age}</td><td align="right">${elo}</td><td></td><td align="right">1</td><td align="right">2263.2</td><td align="right">1</td><td align="right">2215.7</td><td align="right">1</td><td align="right">2088.3</td><td></td><td align="right">2339.8</td><td align="right">2026-05</td><td></td><td align="right">1</td><td align="right">0</td></tr>`;
const page = (label, rows) => `<html><body><p>Last update: ${label}</p><table>${TH_CUR}<tbody>${rows.join('')}</tbody></table></body></html>`;
const TH_OLD = '<tr><th align="right">Rank</th><th align="left">Player</th><th align="right">Age</th><th align="right">Elo</th><th align="right">&nbsp;&nbsp;&nbsp;&nbsp;</th><th align="left">Peak Match</th><th align="right">Peak Age</th><th align="right">Peak Elo</th></tr>';
const OLD = `<p>Last update: 2016-02-22</p><table>${TH_OLD}<tr><td align="right">1</td><td align="left"><a href="http://www.tennisabstract.com/cgi-bin/player.cgi?p=NovakDjokovic">Novak&nbsp;Djokovic</a></td><td align="right">28.7</td><td align="right">2556.2</td><td align="right"></td><td align="left">2016 Australian Open F</td><td align="right">28.7</td><td align="right">2556.2</td></tr></table>`;

const cap = (ts, html) => ({ captureTimestamp: ts, captureUrl: `https://web.archive.org/web/${ts}id_/https://tennisabstract.com/reports/atp_elo_ratings.html`, ...parseReport(html) });

test('parses a current-layout fixture row: overall Elo (4th cell), key, label, player count', () => {
  const p = parseReport(page('2026-06-22', [rowCur('JannikSinner', 'Jannik&nbsp;Sinner', '2319.8')]));
  assert.deepEqual(p.ratings, { 'sinner|j': 2320 });
  assert.equal(p.taLastUpdate, '2026-06-22');
  assert.equal(p.players, 1);
  assert.equal(p.layout, 'current');
});

test('parses a legacy (2016) row by its verified header map, never a peak column', () => {
  const p = parseReport(OLD);
  assert.deepEqual(p.ratings, { 'djokovic|n': 2556 });
  assert.equal(p.layout, 'legacy');
  // Same row under an unverified header is refused (no guessing a column map).
  const bad = parseReport(OLD.replace('<th align="right">Elo</th>', '<th align="right">Peak Elo</th>'));
  assert.equal(bad.players, 0);
});

test('asOf is the capture day (UTC), not the TA label', () => {
  const [s] = dedupeCaptures([cap('20250909001433', page('2025-09-08', [rowCur('A', 'Ann&nbsp;Aa', '2000.0')]))]);
  assert.equal(s.asOf, '2025-09-09');
  assert.equal(s.taLastUpdate, '2025-09-08');
  assert.equal(s.source, 'wayback');
  assert.equal(s.captureTimestamp, '20250909001433');
  assert.equal(s.generatedAt, null);
});

test('the same report captured twice keeps the EARLIEST capture', () => {
  const html = page('2025-01-13', [rowCur('A', 'Ann&nbsp;Aa', '2000.0')]);
  const out = dedupeCaptures([cap('20250125013345', html), cap('20250114143201', html), cap('20250116075945', html)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].captureTimestamp, '20250114143201');
  assert.equal(out[0].asOf, '2025-01-14');
});

test('a capture whose ratings equal the previous kept snapshot is not a new snapshot', () => {
  const r = [rowCur('A', 'Ann&nbsp;Aa', '2000.0')];
  const out = dedupeCaptures([cap('20250101000000', page('2024-12-30', r)), cap('20250108000000', page('2025-01-06', r))]);
  assert.equal(out.length, 1);
  assert.equal(out[0].asOf, '2025-01-01');
});

test('a key two players share in ONE report is in that report\'s ambiguous list', () => {
  const p = parseReport(page('2025-08-25', [rowCur('DarwinBlanch', 'Darwin&nbsp;Blanch', '1700.0'), rowCur('DaliBlanch', 'Dali&nbsp;Blanch', '1650.0'), rowCur('X', 'Xa&nbsp;Yb', '1600.0')]));
  assert.deepEqual(p.ambiguous, ['blanch|d']);
  const p2 = parseReport(page('2025-08-18', [rowCur('DarwinBlanch', 'Darwin&nbsp;Blanch', '1700.0')]));
  assert.deepEqual(p2.ambiguous, []);                                   // per report, not global
});

test('merge prepends archived snapshots, is idempotent, and never modifies existing asOf/ratings', () => {
  const git = [
    { asOf: '2026-07-18', generatedAt: '2026-07-18T02:56:42.709Z', ratings: { 'aa|a': 2000 }, ambiguous: ['blanch|d'] },
    { asOf: '2026-07-20', generatedAt: '2026-07-20T21:14:39.242Z', ratings: { 'aa|a': 2010 }, ambiguous: ['blanch|d'] },
  ];
  const hist = { schema: 'elo-history/1', snapshots: structuredClone(git) };
  const arch = dedupeCaptures([cap('20260716084544', page('2026-07-13', [rowCur('A', 'Ann&nbsp;Aa', '1990.0')])),
                               cap('20260721035449', page('2026-07-20', [rowCur('A', 'Ann&nbsp;Aa', '2005.0')]))]);
  const once = mergeArchived(hist, arch);
  assert.deepEqual(once.snapshots.map(s => s.asOf), ['2026-07-16', '2026-07-18', '2026-07-20']);   // 07-21 capture is not before the first git snapshot
  const twice = mergeArchived(once, arch);
  assert.deepEqual(twice, once);
  for (const g of git) {
    const s = once.snapshots.find(x => x.generatedAt === g.generatedAt);
    assert.equal(s.asOf, g.asOf); assert.deepEqual(s.ratings, g.ratings); assert.deepEqual(s.ambiguous, g.ambiguous);
    assert.equal(s.source, 'git');
  }
  assert.deepEqual(hist.snapshots, git);                                 // input not mutated
  // labelLiveSnapshots: identical ratings -> label + provenance; otherwise null; idempotent.
  const lab = labelLiveSnapshots(once, [cap('20260721035449', page('2026-07-20', [rowCur('A', 'Ann&nbsp;Aa', '2010.0')]))]);
  const g2 = lab.snapshots.find(s => s.asOf === '2026-07-20');
  assert.equal(g2.taLastUpdate, '2026-07-20');
  assert.equal(g2.taLastUpdateFrom, 'wayback 20260721035449 (identical ratings)');
  assert.equal(lab.snapshots.find(s => s.asOf === '2026-07-18').taLastUpdate, null);
  assert.deepEqual(labelLiveSnapshots(lab, []), lab);
});
