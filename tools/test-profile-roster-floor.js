#!/usr/bin/env node
'use strict';
/**
 * TEN-243 — the profile publish floor, founder-ruled 2026-09-21 (shape c).
 *
 * THE TWO CONTROLS THE RULING ASKED FOR, and they are the whole point of this
 * file: one that FIRES when the cache is intact and the count collapses, one
 * that stays SILENT through a legitimate convergence. A floor that only ever
 * passes is decoration, and a floor that blocks a working run is worse than
 * none — the v14 -> v15 bump wrote 560 of 708 (79%) doing exactly what it was
 * told, and a bare ratio would have stopped it.
 *
 * Driven through the REAL exported verdict, not a copy of its logic. A test
 * that reimplements the rule it is checking agrees with itself forever.
 *
 * Also locks two things that are invisible until they break:
 *   - the backstop is DERIVED from MAX_OPPONENT_BUILDS_PER_RUN, so lowering the
 *     cap can never leave a floor that blocks every post-bump run
 *   - `_`-prefixed carriers never reach the published store
 */
const assert = require('assert');
const {
  profileRosterFloorVerdict,
  profilesWithoutTournamentHistory,
  PROFILE_ROSTER_BACKSTOP,
  PROFILE_ROSTER_RATIO,
  MAX_OPPONENT_BUILDS_PER_RUN,
  lastPublishedRosterCount,
} = require('../bsp-pipeline.js');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const path = require('path');

let pass = 0, fail = 0;
const ok = (n, cond, d) => {
  if (cond) { pass++; console.log(`  ok    ${n}${d ? '  — ' + d : ''}`); }
  else { fail++; console.log(`  FAIL  ${n}  — ${d}`); }
};
const v = (written, lastPublished, wrongSchemaRejections) =>
  profileRosterFloorVerdict({ written, lastPublished, wrongSchemaRejections });

console.log('\nTEN-243 · profile publish floor\n');

// ── The coupling. Written as a derivation, asserted as one. ────────────────
ok('the backstop is derived from the build cap, not a literal',
  PROFILE_ROSTER_BACKSTOP === Math.floor(MAX_OPPONENT_BUILDS_PER_RUN * 0.75),
  `${PROFILE_ROSTER_BACKSTOP} = floor(${MAX_OPPONENT_BUILDS_PER_RUN} x 0.75)`);
ok('...and today that is the ruled 300', PROFILE_ROSTER_BACKSTOP === 300, String(PROFILE_ROSTER_BACKSTOP));
ok('the ratio is the ruled 0.9', PROFILE_ROSTER_RATIO === 0.9, String(PROFILE_ROSTER_RATIO));

// ── CONTROL 1 · FIRES. Cache intact, count collapses. ─────────────────────
// The real numbers from the v14->v15 bump, with the ONE difference that makes
// it a truncation instead of a convergence: nothing was rejected as
// wrong-schema, so there is no rebuild in progress to explain the shortfall.
{
  const r = v(560, 708, 0);
  ok('CONTROL 1 · intact cache + 560 of 708 = truncated run, BLOCKED',
    r.ok === false && r.reason === 'ratio', `${r.reason}: ${r.detail}`);
}
ok('...and a near-miss is still blocked (636 < 0.9 x 708 = 637)',
  v(636, 708, 0).ok === false, 'ratio is a real edge, not a gesture');
ok('...while one profile more passes (637 >= 637)',
  v(637, 708, 0).ok === true, 'the boundary is where it is claimed to be');

// ── CONTROL 2 · SILENT. A legitimate convergence. ─────────────────────────
// Run 4057 verbatim: 560 written against 708 published, 660 cache entries
// rejected as wrong-schema. This run was working correctly.
{
  const r = v(560, 708, 660);
  ok('CONTROL 2 · post-bump 560 of 708 with 660 wrong-schema rejections, ALLOWED',
    r.ok === true && r.reason === 'ratio-suspended', `${r.reason}: ${r.detail}`);
}
// Run 4059 verbatim — the repeat. Also legitimate.
ok('...and run two of the same stall is allowed too', v(561, 708, 660).ok === true, '561 of 708');
// The worst legitimate run there can be: thinnest measured slate (2 seed
// players) plus a full cap of rebuilds, with the whole cache invalid.
ok('...and the WORST legitimate run still clears the backstop',
  v(2 + MAX_OPPONENT_BUILDS_PER_RUN, 708, 708).ok === true,
  `seed 2 + cap ${MAX_OPPONENT_BUILDS_PER_RUN} = 402 >= ${PROFILE_ROSTER_BACKSTOP}`);

// ── The exemption relaxes the RATIO ONLY, never the backstop. ─────────────
// This is the corrupted-cache case the ruling accepted: a junk `v` reads as
// entirely wrong-schema and opens the exemption with no bump. The backstop is
// what holds, and it must hold no matter how many rejections are claimed.
{
  const r = v(12, 708, 708);
  ok('a collapse to 12 is BLOCKED even with every entry claiming wrong-schema',
    r.ok === false && r.reason === 'backstop', `${r.reason}: ${r.detail}`);
}
ok('...and zero written is blocked, exemption or not', v(0, 708, 999).ok === false, 'TEN-219 floor');
ok('...at the backstop edge: 299 blocked, 300 allowed',
  v(299, 0, 0).ok === false && v(300, 0, 0).ok === true, 'boundary asserted both sides');

// ── No reference roster is not a licence. ─────────────────────────────────
{
  const r = v(400, 0, 0);
  ok('no prior roster -> backstop only, and it says so rather than inventing a denominator',
    r.ok === true && r.reason === 'backstop-only', r.detail);
}
ok('...but the backstop still binds with no prior roster', v(50, 0, 0).ok === false, '50 < 300');

// ── The published audit trail. ────────────────────────────────────────────
// The ruling: "an unpublished exemption is a silent bypass". The verdict has to
// carry enough for a reader of the store to tell WHY a run was let through.
{
  const r = v(560, 708, 660);
  ok('the verdict names its reason and its exemption state',
    r.reason === 'ratio-suspended' && r.exempt === true && /660/.test(r.detail),
    'reason + exempt + the count in the detail');
  const clean = v(700, 708, 0);
  ok('...and a clean pass is not marked exempt', clean.exempt === false, `${clean.reason}`);
}

// ── `_` carriers never reach the published store. ─────────────────────────
{
  const out = profilesWithoutTournamentHistory({
    fetchedAt: 'x', tourAverage: 1,
    players: { '1': { name: 'A', tournamentHistory: [1, 2, 3] } },
    _allProfiles: { lots: 'of data' },
    _wrongSchemaRejections: 660,
  });
  ok('carriers are stripped from the published store',
    !('_allProfiles' in out) && !('_wrongSchemaRejections' in out),
    'top-level keys: ' + Object.keys(out).join(', '));
  ok('...and the real fields survive',
    out.fetchedAt === 'x' && out.tourAverage === 1 && out.players['1'].name === 'A');
  ok('...and tournamentHistory is still stripped per player',
    !('tournamentHistory' in out.players['1']));
}

// ── The reference roster is the WIDE one, and that is the part that goes wrong ──
// First cut of this read `player-profiles.json`. That is the EAGER subset, so
// the ratio was measured against a population ~25% smaller than the one it was
// gating — permissive, silent, and invisible in the output. These controls fix
// the STORE, not just the number.
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'floorref-'));
  const wide = { fetchedAt: 'x', players: Object.fromEntries(
    Array.from({ length: 660 }, (_, i) => [`p${i}`, { v: 15, profile: {} }])) };
  fs.writeFileSync(path.join(root, 'player-profiles-cache.json.gz'),
    zlib.gzipSync(Buffer.from(JSON.stringify(wide), 'utf8')));
  // The eager store, deliberately a DIFFERENT size and deliberately present: if
  // the reference ever slips back to it, this number is what would show up.
  fs.writeFileSync(path.join(root, 'player-profiles.json'),
    JSON.stringify({ players: Object.fromEntries(Array.from({ length: 428 }, (_, i) => [`e${i}`, {}])) }));

  const got = lastPublishedRosterCount(root);
  ok('the ratio reference is the WIDE committed floor, not the eager store',
    got === 660, `read ${got} (wide 660 / eager 428 both present)`);
  ok('...and it is not silently reading the eager store', got !== 428, `${got} !== 428`);
  ok('a missing floor yields 0 -> backstop only, never a guessed default',
    lastPublishedRosterCount(path.join(root, 'nope')) === 0);
}

// ── The test-only opt-out must stay test-only ─────────────────────────────
// `enforceFloor: false` exists so the index-shape suite can drive 2-profile
// fixtures. That is exactly the shape of thing the founder ruled against when
// he rejected an exemption "someone leaves on", so the production call site is
// asserted to carry no override. Source-level on purpose: the risk is not that
// the function misbehaves, it is that a future edit quietly passes the flag.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'bsp-pipeline.js'), 'utf8');
  // CODE lines only. The first cut of this matched raw lines and went red on a
  // COMMENT mentioning the function and on this file's own doc comment - the
  // probe reporting its own assumption as a defect, which is the failure mode
  // this repo keeps paying for. Comments are not call sites.
  const code = src.split('\n').filter((l) => {
    const t = l.trim();
    return t && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  });
  const callSites = code.filter(l => /writePlayerShardsAndIndex\(/.test(l) && !/^function /.test(l.trim()));
  ok('there is exactly one production call site', callSites.length === 1, callSites.join(' | ').trim());
  ok('...and it does not disable the floor',
    callSites.length === 1 && !/enforceFloor/.test(callSites[0]), callSites[0] && callSites[0].trim());
  const disabled = code.filter(l => /enforceFloor\s*:\s*false/.test(l));
  ok('...and nothing in the pipeline sets enforceFloor:false at all',
    disabled.length === 0, disabled.join(' | ') || 'no occurrences');
}

console.log(`\ntest-profile-roster-floor: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
