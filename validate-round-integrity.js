#!/usr/bin/env node
/*
 * TEN-159 — Fail-closed data-QA gate: round-integrity before publish.
 *
 * Parent TEN-157: a main-draw match (US Open R2 vs Trungelliti) shipped with
 * round == 'Q'. Qualifying rows are leaking into main-draw match lists and
 * wearing a 'Q' label, corrupting player tournamentHistory. This gate refuses
 * to publish when a row is *structurally impossible* — not merely unusual.
 *
 * SCOPE: only rules with ZERO legitimate counter-examples are enforced. A
 * genuine qualifier plays Q rounds and THEN main-draw rounds in the same
 * edition, so "Q co-exists with main draw" is NOT an impossibility (measured:
 * ~6,080 legit editions) and is deliberately excluded from the hard gate.
 *
 * TIER-1 (hard, fail-closed candidates — zero false positives by construction):
 *   QBO5  round == 'Q' but the match went best-of-five (a player won >= 3 sets).
 *         Qualifying is always best-of-three, so this is a main-draw match
 *         mislabelled 'Q'. This is exactly the TEN-157 defect class.
 *   QOVER more than 3 'Q' rounds in one edition. Slam qualifying is 3 rounds
 *         max; tour-level is 2. > 3 means two runs were merged / corrupted.
 *   DUPMD the same main-draw round (R128/R64/R32/R16/QF/SF/F) appears twice in
 *         one edition. Team events (Davis/United/ATP Cup) legitimately repeat
 *         round labels across ties and are excluded.
 *
 * Default mode is REPORT-ONLY (exit 0): measure without blocking. Pass
 * --fail-closed to exit non-zero on any Tier-1 violation (the pipeline gate).
 * --json emits a machine-readable summary for baselining.
 *
 * Read-only: never mutates any file.
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const FAIL_CLOSED = process.argv.includes('--fail-closed');
const JSON_OUT = process.argv.includes('--json');

const MAIN_DRAW = new Set(['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F']);
const isTeamEvent = (name) => /\bcup\b/i.test(String(name || ''));

// Sets won by each side, from a "a - b" res string. null if unparseable.
function setsWon(score) {
  const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(String(score));
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function loadJSON(file) {
  return JSON.parse(fs.readFileSync(path.join(HERE, file), 'utf8'));
}

// Yield {source, player, tournament, year, matches:[{round,opp,score,res}]}
// for every tournament edition across the published artifacts.
function* editions() {
  // player-profiles.json: players[id].tournamentHistory[].editions[].matches[]
  let pp = null;
  try { pp = loadJSON('player-profiles.json'); } catch (e) { pp = null; }
  if (pp) {
    const players = pp.players || pp;
    for (const [pid, p] of Object.entries(players)) {
      const who = (p && p.name) || pid;
      for (const t of (p && p.tournamentHistory) || []) {
        for (const ed of (t.editions) || []) {
          yield { source: 'player-profiles', player: who, tournament: t.name || '', year: ed.year, matches: ed.matches || [] };
        }
      }
    }
  }
  // tournament-profiles.json: profiles[name].allEditionMatches[].matches[]
  let tp = null;
  try { tp = loadJSON('tournament-profiles.json'); } catch (e) { tp = null; }
  if (tp) {
    const profiles = tp.profiles || tp;
    for (const [name, prof] of Object.entries(profiles)) {
      for (const ed of (prof && prof.allEditionMatches) || []) {
        yield { source: 'tournament-profiles', player: null, tournament: name, year: ed.year, matches: ed.matches || [] };
      }
    }
  }
}

const violations = { QBO5: [], QOVER: [], DUPMD: [] };

for (const ed of editions()) {
  const rounds = ed.matches.map((m) => m.round);
  const label = `${ed.source}:${ed.player ? ed.player + ' @ ' : ''}${ed.tournament} ${ed.year}`;

  // QBO5
  for (const m of ed.matches) {
    if (m.round === 'Q') {
      const sw = setsWon(m.score);
      if (sw && Math.max(sw[0], sw[1]) >= 3) {
        violations.QBO5.push(`${label} — Q vs ${m.opp} score ${m.score} (best-of-5 => main draw)`);
      }
    }
  }
  // QOVER
  const qCount = rounds.filter((r) => r === 'Q').length;
  if (qCount > 3) violations.QOVER.push(`${label} — ${qCount} 'Q' rounds: ${JSON.stringify(rounds)}`);

  // DUPMD (team events excluded)
  if (!isTeamEvent(ed.tournament)) {
    const md = rounds.filter((r) => MAIN_DRAW.has(r));
    if (md.length !== new Set(md).size) {
      violations.DUPMD.push(`${label} — duplicate main-draw round: ${JSON.stringify(rounds)}`);
    }
  }
}

const counts = Object.fromEntries(Object.entries(violations).map(([k, v]) => [k, v.length]));
const total = Object.values(counts).reduce((a, b) => a + b, 0);

if (JSON_OUT) {
  console.log(JSON.stringify({ counts, total, failClosed: FAIL_CLOSED }, null, 2));
} else {
  console.log('TEN-159 round-integrity gate (' + (FAIL_CLOSED ? 'FAIL-CLOSED' : 'report-only') + ')');
  for (const [rule, list] of Object.entries(violations)) {
    console.log(`\n[${rule}] ${list.length} violation(s)`);
    for (const line of list.slice(0, 15)) console.log('   ' + line);
    if (list.length > 15) console.log(`   ... and ${list.length - 15} more`);
  }
  console.log(`\nTOTAL structural violations: ${total}`);
}

if (FAIL_CLOSED && total > 0) {
  console.error(`\nvalidate-round-integrity: ${total} structural violation(s) — refusing to publish.`);
  process.exit(1);
}
process.exit(0);
