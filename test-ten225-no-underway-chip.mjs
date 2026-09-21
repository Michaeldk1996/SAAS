// TEN-225 item 1 — THE UNDERWAY CHIP MUST NOT COME BACK.
//
// Founder 2026-09-19: "Remove it, and report WHY it came back ... Add an
// assertion that fails any future build that renders it."
//
// WHY IT CAME BACK, since that is what this file is guarding against repeating.
// It was NOT reverted by anyone and there is NO second render path. Commit
// 1d6c042f (the header-clock change) wrote a whole-file blob for
// bsp-consult-dashboard.html taken from a shared checkout that had drifted
// behind main, so it silently reverted 2ed98d15 — and TEN-206's 46f44a15
// event-coverage fetch with it. `git diff 76db7b36 1d6c042f` shows the removal
// comment being deleted and the CSS rule + render branch being re-added, which
// is the signature of a clobber rather than an edit.
//
// WHY A TEXT ASSERTION AND NOT A DOM PROBE. A DOM probe is the right check for
// "does it render", and there is one — but it needs a board carrying a
// started-but-scoreless fixture, and on most boards there is none, so it passes
// on an empty set (standing rule E). This file cannot: the chip's markup is a
// literal in the source, so its ABSENCE from the source is decidable at any
// hour, on any board, with no data at all. That is exactly the property the
// clobber defeated.
//
// Run: node --test test-ten225-no-underway-chip.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, 'bsp-consult-dashboard.html');
const html = readFileSync(FILE, 'utf8');

// Comments are stripped before the search. A previous assertion on this file
// passed against its own explanatory comment while the code it described was
// missing; the mention of "Underway" in the removal note must not be able to
// satisfy — or to break — a check about what renders.
const code = html
  .replace(/\/\*[\s\S]*?\*\//g, ' ')       // CSS + JS block comments
  .replace(/^[ \t]*\/\/.*$/gm, ' ');       // whole-line JS comments

test('the chip is not in the source, so it cannot be in the build', () => {
  // The control for this assertion is history, not a fixture: `git show
  // 76db7b36:bsp-consult-dashboard.html | grep -c mc-underway` is 1 (the
  // removal comment only) and `git show 1d6c042f:...` is 3. This test run
  // against 1d6c042f fails on all three counts below.
  assert.equal((code.match(/mc-underway/g) || []).length, 0,
    'the .mc-underway class is back in bsp-consult-dashboard.html — see git log -S"mc-underway"');
  assert.equal((code.match(/>Underway</g) || []).length, 0,
    'a node whose text is "Underway" is back in the card renderer');
  assert.ok(!/class="mc-scoreline underway"><span class="mc-underway"/.test(code),
    'the started-but-scoreless score-line branch is back');
});

test('the CSS rule went with it, rather than being left dead', () => {
  assert.ok(!/\.mc-underway\s*\{/.test(code),
    'a dead .mc-underway rule is back in the stylesheet');
});

test('the checks above can actually fail — a mutated copy is caught', () => {
  // Without this, all four assertions above would also pass on a file that had
  // simply stopped containing the renderer at all.
  const mutated = code.replace(
    '<div class="mc-scoreline"><span class="lbl">Score</span>',
    '<div class="mc-scoreline underway"><span class="mc-underway">Underway</span></div><div class="mc-scoreline"><span class="lbl">Score</span>');
  assert.notEqual(mutated, code, 'the anchor the mutation needs is gone — this test is now vacuous');
  assert.ok((mutated.match(/mc-underway/g) || []).length > 0);
  assert.ok((mutated.match(/>Underway</g) || []).length > 0);
});

test('what was KEPT: the terminal chip and the started-ness test', () => {
  // The removal must not take the Retired/Walkover chip's centred row with it —
  // that row carries something the feed actually said.
  assert.ok(/\.mc-scoreline\.underway\s*\{/.test(code),
    '.mc-scoreline.underway is still the terminal chip’s row and must stay');
  assert.ok(/mc-termchip/.test(code), 'the Retired/Walkover chip is gone too');
  // And the started-ness test itself survives: the drift column reads it.
  assert.ok(/const mcStarted = !finalScore && isFinite\(cardStartMs\(m\)\)/.test(html),
    'mcStarted is gone — the card can no longer tell an underway fixture from an upcoming one');
});

// ── THE INTERRUPTED CHIP, 2026-09-21 ────────────────────────────────────────
// Kept in THIS file rather than a new one because it is the same defect class
// and the same lesson: a header state-chip that was removed by ruling, and that
// has to stay removed. One place to look beats two.
//
// FOUNDER: "The card already says 'SCORE 4-6, 2-2 at interruption · match
// suspended', which is clearer and carries the real information. The chip
// duplicates it and breaks the header line."
test('the interrupted chip cannot come back through EITHER door', () => {
  // Door 1 — the label function that produced the string.
  assert.ok(/function statusLabel\(/.test(code), 'statusLabel is gone entirely');
  const fn = code.slice(code.indexOf('function statusLabel('));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.ok(!/m\.interrupted/.test(body),
    'statusLabel has an m.interrupted branch again — it will print the chip');
  assert.ok(/m\.live/.test(body), 'statusLabel lost its LIVE branch, which was NOT the ruling');

  // Door 2 — the renderer branch that put it in the header slot. `liveOrInt`
  // existed only to route an interrupted fixture into the LIVE slot.
  assert.equal((code.match(/liveOrInt/g) || []).length, 0,
    'liveOrInt is back — an interrupted card is being sent to the LIVE header slot again');
  assert.ok(/: m\.live\s*\n?\s*\?\s*`<span class="mc-status live">/.test(code),
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
  assert.ok(/\.mc-status\.live\s*\{/.test(code), '.mc-status.live is still the LIVE chip and must stay');
  assert.equal((code.match(/mc-interrupted|mc-suspended-chip/g) || []).length, 0,
    'an interrupted-only class appeared — it would be dead the moment the chip is gone');
});

test('the TEN-206 fetch clobbered by the same commit is back', () => {
  // Same mistake, same commit, same fix: 1d6c042f reverted this too and nobody
  // noticed for a day. Asserting it here means the NEXT stale-blob clobber of
  // this file is caught by the file it damaged.
  assert.ok(/match-stat-event-coverage\.json/.test(code),
    'the per-event coverage fetch is missing — the match sheet’s whole-event note can never appear');
  assert.ok(/matchStatEventCoverage/.test(code),
    'window.matchStatEventCoverage is not declared');
});
