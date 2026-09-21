#!/usr/bin/env python3
"""TEN-225 — founder board fixes, 2026-09-21. A REPLAYABLE patch, not hand edits.

1. TRAILING ZERO: "1.020 and 1.090 should read 1.02 and 1.09. The
   3-decimals-below-1.10 rule stands, but only where the third decimal is
   non-zero: 1.012 keeps three, 1.020 drops to two, 1.004 keeps three. Apply at
   the single formatter so every surface agrees."
2. THE "INTERRUPTED" CHIP: "remove it ... Same treatment as the UNDERWAY chip —
   remove the renderer branch and any dead CSS, and add an assertion so it
   cannot come back."

The shared checkout is reset by concurrent runs, so every anchor is exact-match
and the RESULT is tested before the anchor — a replay is a verified no-op.

Usage: python3 ten225-apply-0921-board.py <repo-root>
"""
import os
import sys

EDITS = []
DASH = 'bsp-consult-dashboard.html'


def edit(path, name, old, new):
    EDITS.append((path, name, old, new))


# ── 1. THE FORMATTER — one function, so every surface agrees ─────────────────
edit(DASH, 'mxOddsTxt: drop a trailing zero from the third decimal',
     """const MX_3DP_BELOW = 1.10;
function mxOddsTxt(v){
  if (!(typeof v === 'number' && isFinite(v) && v > 0)) return '';
  return v < MX_3DP_BELOW ? v.toFixed(3) : v.toFixed(2);
}""",
     """const MX_3DP_BELOW = 1.10;
function mxOddsTxt(v){
  if (!(typeof v === 'number' && isFinite(v) && v > 0)) return '';
  if (v >= MX_3DP_BELOW) return v.toFixed(2);
  // FOUNDER 2026-09-21: "1.020 and 1.090 should read 1.02 and 1.09. The
  // 3-decimals-below-1.10 rule stands, but only where the third decimal is
  // non-zero: 1.012 keeps three, 1.020 drops to two, 1.004 keeps three."
  //
  // The third decimal earns its place by carrying information. On 1.012 it is
  // the whole difference from 1.01; on 1.020 it is a zero that says nothing and
  // makes a perfectly ordinary price look like a different KIND of number than
  // the 1.02 on the card beside it.
  //
  // SLICED, not re-rounded. `v.toFixed(2)` would round the ORIGINAL value a
  // second time, independently — so the two-decimal render would no longer be
  // provably the three-decimal render with its last digit removed. They agree
  // on every value either can receive, but "the same digits, minus a trailing
  // zero" is a rule you can check by eye, and a second rounding is not.
  const three = v.toFixed(3);
  return three.endsWith('0') ? three.slice(0, -1) : three;
}""")

# ── 2. THE INTERRUPTED CHIP ──────────────────────────────────────────────────
# Removed at BOTH doors: the renderer branch that prints it, and the label
# function that produces the string. Either alone leaves the other live for the
# next caller — and the UNDERWAY chip came back once already, so the standard
# here is that it cannot return through a door nobody re-checked.
edit(DASH, 'statusLabel: the interrupted branch is gone',
     """function statusLabel(m){
  // Suspended mid-play: the feed's own word for it ("Interrupted"/"Suspended"),
  // in the same label slot as "Match completed" / "Yesterday". Checked before
  // m.live because an interrupted match is explicitly NOT live — nothing is
  // being played while it's suspended.
  if (m.interrupted) return m.liveStatus || 'Interrupted';
  if (m.live) return `LIVE${m.liveStatus ? ' · ' + m.liveStatus : ''}`;""",
     """function statusLabel(m){
  // ⚠️ REMOVED 2026-09-21, founder ruling: the INTERRUPTED branch. It returned
  // `m.liveStatus || 'Interrupted'` into the header's status slot, and the card
  // ALREADY carries the same fact, with more in it, one row down:
  //
  //     Score  4-6, 2-2   at interruption · match suspended
  //
  // The chip repeated the weaker half of that and pushed the header onto two
  // lines — the identical failure as the UNDERWAY chip, which is why it gets
  // the identical treatment. This function now answers only for LIVE and for
  // day buckets; an interrupted fixture never reaches it, because the single
  // call site below is gated on `m.live` alone.
  if (m.live) return `LIVE${m.liveStatus ? ' · ' + m.liveStatus : ''}`;""")

edit(DASH, 'the renderer branch: gate the status slot on m.live alone',
     """    const liveOrInt = m.live || m.interrupted;""",
     """    // ⚠️ `liveOrInt` is GONE, and its removal is the fix. It routed an
    // interrupted fixture into the LIVE header slot, which is what printed the
    // chip. An interrupted match is explicitly NOT live — nothing is being
    // played — so it now takes the ordinary date-time branch like any other
    // card, and its suspension is told by the score line that already says it.""")

edit(DASH, 'the status slot renders for a LIVE match only',
     """      : liveOrInt
        ? `<span class="mc-status live">${statusLabel(m)}</span><span class="mc-time">${cardFmtStart(m, false)}</span>`""",
     """      : m.live
        ? `<span class="mc-status live">${statusLabel(m)}</span><span class="mc-time">${cardFmtStart(m, false)}</span>`""")


# ── 3. THE RULINGS BECOME TESTS, SAME DAY ───────────────────────────────────
FMT = 'test-ten225-price-format-and-filter.mjs'
CHIP = 'test-ten225-no-underway-chip.mjs'

edit(FMT, 'the trailing-zero rule, with a control',
     """test('a non-price is still empty, not "0.000"', () => {""",
     """test('a TRAILING ZERO in the third decimal is dropped', () => {
  // FOUNDER 2026-09-21, the examples verbatim: "1.012 keeps three, 1.020 drops
  // to two, 1.004 keeps three."
  assert.equal(mxOddsTxt(1.020), '1.02');
  assert.equal(mxOddsTxt(1.090), '1.09');
  assert.equal(mxOddsTxt(1.012), '1.012');
  assert.equal(mxOddsTxt(1.004), '1.004');
  // The rest of the band a live board actually carried on 2026-09-19.
  for (const [v, want] of [[1.030, '1.03'], [1.050, '1.05'], [1.080, '1.08'],
                           [1.025, '1.025'], [1.052, '1.052'], [1.068, '1.068'],
                           [1.091, '1.091'], [1.001, '1.001'], [1.008, '1.008'],
                           [1.010, '1.01']])
    assert.equal(mxOddsTxt(v), want, `${v}`);
});

test('the two-decimal render is the three-decimal one MINUS the zero', () => {
  // Not a second, independent rounding of the original value. They agree on
  // every input either can receive — but a rule you can check by eye ("same
  // digits, one fewer") is worth more than two roundings that happen to match.
  for (let i = 1010; i < 1100; i++) {
    const v = i / 1000, out = mxOddsTxt(v), three = v.toFixed(3);
    assert.equal(out, three.endsWith('0') ? three.slice(0, -1) : three, `${v}`);
  }
});

test('CONTROL: the PRE-change formatter disagrees on exactly the zero cases', () => {
  // Without this, every assertion above would also pass on a formatter that
  // had never been changed.
  const pre = v => v < 1.10 ? v.toFixed(3) : v.toFixed(2);
  assert.equal(pre(1.020), '1.020');                       // the defect, reproduced
  assert.notEqual(pre(1.020), mxOddsTxt(1.020));
  assert.notEqual(pre(1.090), mxOddsTxt(1.090));
  // ...and agrees everywhere the ruling did not reach, so the change is narrow.
  for (const v of [1.012, 1.004, 1.052, 1.22, 2.5, 17])
    assert.equal(pre(v), mxOddsTxt(v), `${v} should be untouched`);
});

test('a non-price is still empty, not "0.000"', () => {""")

edit(CHIP, 'the interrupted chip joins the same guard',
     """test('the TEN-206 fetch clobbered by the same commit is back', () => {""",
     """// ── THE INTERRUPTED CHIP, 2026-09-21 ────────────────────────────────────────
// Kept in THIS file rather than a new one because it is the same defect class
// and the same lesson: a header state-chip that was removed by ruling, and that
// has to stay removed. One place to look beats two.
//
// FOUNDER: "The card already says 'SCORE 4-6, 2-2 at interruption · match
// suspended', which is clearer and carries the real information. The chip
// duplicates it and breaks the header line."
test('the interrupted chip cannot come back through EITHER door', () => {
  // Door 1 — the label function that produced the string.
  assert.ok(/function statusLabel\\(/.test(code), 'statusLabel is gone entirely');
  const fn = code.slice(code.indexOf('function statusLabel('));
  const body = fn.slice(0, fn.indexOf('\\n}'));
  assert.ok(!/m\\.interrupted/.test(body),
    'statusLabel has an m.interrupted branch again — it will print the chip');
  assert.ok(/m\\.live/.test(body), 'statusLabel lost its LIVE branch, which was NOT the ruling');

  // Door 2 — the renderer branch that put it in the header slot. `liveOrInt`
  // existed only to route an interrupted fixture into the LIVE slot.
  assert.equal((code.match(/liveOrInt/g) || []).length, 0,
    'liveOrInt is back — an interrupted card is being sent to the LIVE header slot again');
  assert.ok(/: m\\.live\\s*\\n?\\s*\\?\\s*`<span class="mc-status live">/.test(code),
    'the status slot is no longer gated on m.live alone');
});

test('what was KEPT: the score line that carries the real information', () => {
  // The chip was removable precisely BECAUSE this row says more. If it ever
  // goes, the removal stops being a simplification and starts being a loss.
  assert.ok(/at interruption · match suspended/.test(code),
    'the suspension score line is gone — removing the chip now costs information');
  assert.ok(/mc-status live/.test(code),
    'the LIVE status chip went with it, which was not the ruling');
});

test('the interrupted chip left no dead CSS behind', () => {
  // Reported rather than assumed: .mc-status and .mc-status.live are STILL used
  // by the LIVE branch, so neither is dead and neither is removed. There was no
  // interrupted-only selector to delete — unlike .mc-underway, which had one.
  assert.ok(/\\.mc-status\\.live\\s*\\{/.test(code), '.mc-status.live is still the LIVE chip and must stay');
  assert.equal((code.match(/mc-interrupted|mc-suspended-chip/g) || []).length, 0,
    'an interrupted-only class appeared — it would be dead the moment the chip is gone');
});

test('the TEN-206 fetch clobbered by the same commit is back', () => {""")


def apply(root):
    changed = 0
    for path, name, old, new in EDITS:
        full = os.path.join(root, path)
        src = open(full, encoding='utf-8').read()
        # RESULT FIRST: an anchor-first test re-applies on replay wherever the
        # edit keeps the text it is anchored on.
        if src.count(new) >= 1:
            print(f'  no-op   {name}')
            continue
        n = src.count(old)
        if n != 1:
            print(f'::error::  {name}: anchor matched {n} times, expected 1')
            return 1
        open(full, 'w', encoding='utf-8').write(src.replace(old, new, 1))
        print(f'  applied {name}')
        changed += 1
    print(f'{changed} edit(s) applied')
    return 0


if __name__ == '__main__':
    raise SystemExit(apply(sys.argv[1] if len(sys.argv) > 1 else '.'))
