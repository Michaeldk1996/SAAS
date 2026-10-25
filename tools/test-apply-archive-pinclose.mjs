// Round 2 item 1.2 — tools/apply-archive-pinclose.mjs: a finished board card shows the archive's Pinnacle close when one
// exists, else keeps the captured close. Runs the REAL function on fixtures shaped like the live Almaty cards
// (Medvedev v Atmane QF: captured 1.159 / 6.03, archive 1.16 / 6.02) and the pipeline.yml wiring. Each check names the
// mutation that turns it red.
// Run: node tools/test-apply-archive-pinclose.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { applyArchiveCloses, ARCHIVE_SOURCE } from './apply-archive-pinclose.mjs';

let pass = 0, fail = 0;
const check = (n, f) => { try { f(); pass++; console.log('  ok   ' + n); } catch (e) { fail++; console.log('  FAIL ' + n + ' :: ' + e.message); } };
const card = (id, p1Key, p2Key, pc, finished = true) => ({ id, p1Key, p2Key, finalScore: finished ? { sets: [] } : null,
  pinClose: pc ? { p1: pc[0], p2: pc[1], source: 'Pinnacle +30s (Oddspapi)', p1At: 'c', p2At: 'c', startTs: 's', startBasis: 'actual' } : undefined });
const row = (eventKey, p1Key, p2Key, p1, p2, label = 'from Pinnacle history') => ({ eventKey, p1Key, p2Key, p1, p2, label,
  closeTs: '2026-10-23T09:58:00Z', startTs: '2026-10-23T10:02:00Z', startSource: 'trueStartTime', archiveId: 77 });

// Mutation: drop the archive replacement (or read the captured row) → Medvedev keeps 1.159 → red.
check('an archive close replaces the captured close, oriented by player keys (Medvedev v Atmane: 1.16 / 6.02)', () => {
  const ms = [card('past-12173548', 1110, 2030, [1.159, 6.03])];
  const st = applyArchiveCloses(ms, [row(12173548, 2030, 1110, 6.02, 1.16)]);      // the archive lists Atmane first
  assert.deepStrictEqual([ms[0].pinClose.p1, ms[0].pinClose.p2, ms[0].pinClose.source], [1.16, 6.02, ARCHIVE_SOURCE]);
  assert.deepStrictEqual(ms[0].pinClose.captured, { p1: 1.159, p2: 6.03, source: 'Pinnacle +30s (Oddspapi)' }, 'the captured pair is kept for audit');
  assert.strictEqual(ms[0].pinClose.p1At, '2026-10-23T09:58:00Z'); assert.strictEqual(ms[0].pinClose.ageRefTs, '2026-10-23T10:02:00Z');
  assert.strictEqual(st.replaced, 1);
});
// Mutation: replace from a 'captured' row, or blank the card when no archive close exists → red.
check('no archive close (or only a captured row) → the captured close stays exactly as it was', () => {
  const ms = [card('past-1', 1, 2, [1.5, 2.6]), card('past-2', 3, 4, [1.8, 2.0])];
  const st = applyArchiveCloses(ms, [row(2, 3, 4, 1.7, 2.2, 'captured')]);
  assert.deepStrictEqual([ms[0].pinClose.p1, ms[1].pinClose.p1, ms[1].pinClose.source], [1.5, 1.8, 'Pinnacle +30s (Oddspapi)']);
  assert.strictEqual(st.captured, 2); assert.strictEqual(st.replaced, 0);
});
// Mutation: join on the event key alone (no player-key check) → a row for another pair lands on the card → red.
check('a row whose player keys are not the card\'s two players is not applied (counted)', () => {
  const ms = [card('past-5', 1, 2, [1.5, 2.6])];
  const st = applyArchiveCloses(ms, [row(5, 1, 9, 1.4, 3.0)]);
  assert.strictEqual(ms[0].pinClose.p1, 1.5); assert.strictEqual(st.keyMismatch, 1);
});
// Mutation: drop the 1.01 floor → a 1.00 placeholder becomes the close → red.
check('a price below 1.01 is never applied', () => {
  const ms = [card('past-6', 1, 2, [1.5, 2.6])];
  assert.strictEqual(applyArchiveCloses(ms, [row(6, 1, 2, 1.0, 15)]).belowFloor, 1); assert.strictEqual(ms[0].pinClose.p1, 1.5);
});
// Mutation: apply to unfinished cards → an upcoming card gains a "close" → red.
check('only finished cards: an upcoming card is never given a close', () => {
  const ms = [card('upcoming-7', 1, 2, null, false)];
  applyArchiveCloses(ms, [row(7, 1, 2, 1.5, 2.6)]); assert.strictEqual(ms[0].pinClose, undefined);
});
check('re-running is a no-op (the run re-applies every time; the captured pair survives a second pass)', () => {
  const ms = [card('past-12173548', 1110, 2030, [1.159, 6.03])], rows = [row(12173548, 1110, 2030, 1.16, 6.02)];
  applyArchiveCloses(ms, rows); const st = applyArchiveCloses(ms, rows);
  assert.strictEqual(st.unchanged, 1); assert.strictEqual(ms[0].pinClose.captured.p1, 1.159);
});
// Mutation: the step placed before the export (or writing anything but matches.json) → red.
check('pipeline.yml: the step runs after the archive export + Database feed, reads pinnacle-closes.json, writes matches.json', () => {
  const y = readFileSync(new URL('../.github/workflows/pipeline.yml', import.meta.url), 'utf8');
  const ex = y.indexOf('python3 tools/pinarch.py export pinnacle-closes.json'), feed = y.indexOf('python3 tools/pinarch.py td-feed');
  const step = y.indexOf('node tools/apply-archive-pinclose.mjs --closes pinnacle-closes.json --matches matches.json');
  const site = y.indexOf('cp bsp-consult-dashboard.html _site/index.html');
  assert.ok(ex > 0 && feed > ex && step > feed && site > step, [ex, feed, step, site].join(','));
  const src = readFileSync(new URL('./apply-archive-pinclose.mjs', import.meta.url), 'utf8');
  assert.ok(!/pinarch|supabase|INSERT|UPDATE/i.test(src.replace(/^\/\/.*$/mg, '')), 'the script touches no archive');
});

console.log(`\napply-archive-pinclose: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
