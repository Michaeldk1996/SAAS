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
// founder 2026-11-09: Oddspapi's own close carries the flag and its Open, oriented like the close (archive lists Atmane first)
check("Oddspapi's own close: flag + Open on the card, oriented by player keys; a later run with the flag is not 'unchanged'", () => {
  const ms = [card('past-12173548', 1110, 2030, [1.159, 6.03])];
  applyArchiveCloses(ms, [row(12173548, 2030, 1110, 6.02, 1.16)]);
  assert.strictEqual(ms[0].pinClose.oddspapiClose, undefined);
  const od = Object.assign(row(12173548, 2030, 1110, 6.02, 1.16), { oddspapiClose: true, open: { p1: 5.1, p2: 1.2, ts: 'o' } });
  const st = applyArchiveCloses(ms, [od]);
  assert.strictEqual(st.replaced, 1); assert.strictEqual(ms[0].pinClose.oddspapiClose, true);
  assert.deepStrictEqual(ms[0].pinClose.open, { p1: 1.2, p2: 5.1, ts: 'o' });
  assert.strictEqual(applyArchiveCloses(ms, [od]).unchanged, 1);
});
// page: mcOddspapiCloseOcs (bsp-consult-dashboard.html) — the Completed card switches whole to Pinnacle
{
  const html = readFileSync(new URL('../bsp-consult-dashboard.html', import.meta.url), 'utf8');
  const i = html.indexOf('function mcOddspapiCloseOcs(m){'), j = html.indexOf('\n}\n', i);
  const fn = new Function(html.slice(i, j + 2) + '; return mcOddspapiCloseOcs;')();
  const m = { finalScore: { sets: [] }, pinClose: { p1: 1.16, p2: 6.02, p1At: '2026-10-23T09:58:00Z', p2At: '2026-10-23T09:58:00Z',
              startTs: '2026-10-23T10:02:00Z', startBasis: 'x', oddspapiClose: true, open: { p1: 1.2, p2: 5.1, ts: '2026-10-23T01:00:00Z' } } };
  check('card: an Oddspapi close makes the Completed card Pinnacle — Open = first pair, Close = Oddspapi close, one book', () => {
    const o = fn(m);
    assert.strictEqual(o.book, 'pinnacle+30');
    assert.deepStrictEqual([o.p1.open, o.p1.close, o.p2.open, o.p2.close, o.p1.closeW60], [1.2, 1.16, 5.1, 6.02, true]);
  });
  check('card: no switch before the match is finished, without the flag, or without an Open (Bet105 stays)', () => {
    assert.strictEqual(fn(Object.assign({}, m, { finalScore: null })), null);
    assert.strictEqual(fn({ finalScore: {}, pinClose: Object.assign({}, m.pinClose, { oddspapiClose: undefined }) }), null);
    assert.strictEqual(fn({ finalScore: {}, pinClose: Object.assign({}, m.pinClose, { open: undefined }) }), null);
    assert.strictEqual(fn({ finalScore: {}, pinClose: Object.assign({}, m.pinClose, { p1: 1.0 }) }), null);
  });
  check('card: the switch is wired into _ocsOf (every card reader goes through it)', () => {
    const k = html.indexOf('function _ocsOf(m){'), e = html.indexOf('function mcOddspapiCloseOcs', k);
    assert.ok(/const pin = typeof mcOddspapiCloseOcs === 'function' \? mcOddspapiCloseOcs\(m\) : null;\s*if \(pin\) out = pin;/.test(html.slice(k, e)));
  });
}
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
