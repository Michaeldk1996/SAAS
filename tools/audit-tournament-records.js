#!/usr/bin/env node
// TEN-89 data-QA gate — tournament records (player-profiles.json).
//
// Encodes the founder's validity rules (2026-08-27) as a fail-closed check so
// the two structural bugs fixed in TEN-89 can never silently regress:
//   Bug A — Grand-Slam qualifying merged into the main-draw edition
//   Bug B — pre-2021 (TML) edition scores printed reversed
//
// Runs the six validity rules over every player's every tournament edition and
// prints the violation count per rule plus the worst offenders.
//
//   node tools/audit-tournament-records.js [file] [--project-fix]
//
// Fail-closed policy: exits non-zero only on the SLAM-scoped structural class
// TEN-89 fixed (a two-QF / false-title / best-of-3-win-in-a-Slam edition).
// Pre-existing non-Slam data quirks (e.g. an ATP-250 duplicate round) are
// reported but never block a refresh — they are a separate, future task.
//
// Orientation-robust by design: a completed, non-retirement win always leaves
// the winner with MORE sets than the loser, so the winner's set count is
// max(a,b) whichever way the score string is ordered. Rule 4 uses that, so it
// measures the true "best-of-three win inside a Slam" population (= the Bug A
// tell) without being fooled by a still-reversed Bug B score.
//
// --project-fix applies the Bug A reclassification in memory (Slam win decided
// in <3 sets, not a retirement -> tag 'Q', recompute the finish) and re-audits,
// so this same tool can show the fix drives the Slam class to zero before the
// pipeline regenerates the live file.

const fs = require('fs');
const path = require('path');

const FILE = process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(__dirname, '..', 'player-profiles.json');
const PROJECT_FIX = process.argv.includes('--project-fix');
const GRAND_SLAMS = new Set(['Australian Open', 'French Open', 'Roland Garros', 'Wimbledon', 'US Open']);
// Round-robin / team events: a WIN after a group-stage or bronze-match LOSS is
// legitimate there, so the structural qualifying-merge net must never fire on
// them. Name allowlist (Olympics + year-end Finals carry no RR round, so the
// name test is required) OR any edition carrying an `RR` round code. Team cups
// are matched by SPECIFIC name, never a bare `\bcup\b`, so a single-elim event
// named "… Cup" (e.g. Kremlin Cup) is NOT wrongly exempted. Kept in lockstep
// with bsp-pipeline.js ROUND_ROBIN_NAMES (TEN-89 tour-wide).
const ROUND_ROBIN_TOURNEYS = /davis cup|atp cup|united cup|world team|world cup|billie jean|laver|hopman|tour finals|atp finals|nitto|next ?gen|olympic|\bfinals\b|masters cup/i;
const isRoundRobin = (name, ed) => ROUND_ROBIN_TOURNEYS.test(name)
  || (Array.isArray(ed && ed.matches) && ed.matches.some((m) => m.round === 'RR'));
const RANK = { F: 7, SF: 6, QF: 5, R16: 4, R32: 3, R64: 2, R128: 1, R256: 0 };
const rank = (r) => (RANK[r] != null ? RANK[r] : -1); // 'Q'/'WD'/unknown -> -1

function sets(score) {
  const p = String(score || '').split('-').map((s) => parseInt(s.trim(), 10));
  return (p.length === 2 && !p.some(Number.isNaN)) ? [p[0], p[1]] : null;
}
const isRet = (m) => m.ret === true || m.res === 'WD' || m.walkover === true;

// Bug A fix, applied in memory for --project-fix. Mutates an edition's matches:
// a Slam WIN decided in <3 sets that isn't a retirement can only be qualifying.
function applyBugAFix(tourneyName, ed) {
  // (i) set-count: a completed Slam main-draw match is best-of-5, so the winner
  // takes 3 sets. Any completed match here (WIN 2-0/2-1 OR LOSS 0-2/1-2) whose
  // winner took < 3 sets, non-RET, can only be a best-of-3 qualifying match served
  // under the main-draw key. Slam-only — it assumes a best-of-five main draw.
  // (2026-08-28: was WIN-only, which left the qualifying LOSSES leaking — the
  // Bonzi US Open '21 card class. Dropping the res check catches both.)
  if (GRAND_SLAMS.has(tourneyName)) {
    for (const m of (ed.matches || [])) {
      if (m.round === 'Q' || isRet(m)) continue;
      const s = sets(m.score);
      if (s && Math.max(s[0], s[1]) < 3) m.round = 'Q';
    }
  }
  // (ii) structural: a player is eliminated at their first main-draw LOSS, so any
  // WIN at a deeper round belongs to the earlier qualifying ladder (catches a
  // 3-set qualifying final that (i) misses). Result-based, orientation-independent.
  // TEN-89 tour-wide: runs for EVERY single-elimination event; round-robin/team
  // events are exempt (a group/bronze win after a loss is legitimate there).
  if (isRoundRobin(tourneyName, ed)) return;
  const ladder = (ed.matches || []).filter((m) => m.round !== 'Q' && m.res !== 'WD')
    .slice().sort((a, b) => rank(a.round) - rank(b.round));
  let firstLossRank = Infinity;
  for (const m of ladder) { if (m.res === 'L') { firstLossRank = rank(m.round); break; } }
  if (firstLossRank !== Infinity) {
    for (const m of (ed.matches || [])) {
      if (m.res === 'W' && m.round !== 'Q' && rank(m.round) > firstLossRank) m.round = 'Q';
    }
  }
  // Recompute the finish from the deepest non-qualifying round.
  const md = (ed.matches || []).filter((m) => m.round !== 'Q' && m.res !== 'WD');
  if (md.length) {
    const deepest = md.reduce((b, m) => (rank(m.round) > rank(b.round) ? m : b), md[0]);
    ed.finishWon = deepest.res === 'W' && deepest.round === 'F';
    ed.finish = ed.finishWon ? 'Won' : (deepest.round || ed.finish);
  }
}

function auditEdition(tourneyName, ed, viol, ctx) {
  const isSlam = GRAND_SLAMS.has(tourneyName);
  const isRR = isRoundRobin(tourneyName, ed);
  const matches = Array.isArray(ed.matches) ? ed.matches : [];
  const md = matches.filter((m) => m.round !== 'Q' && m.res !== 'WD');
  const bump = (n) => { viol[n]++; if (isSlam) viol[n + 'Slam']++; };

  // Rule 1 — no duplicate main-draw round within one edition (RR events exempt).
  if (!isRR) {
    const seen = new Set();
    for (const m of md) {
      if (seen.has(m.round)) { bump('rule1'); ctx.rule1.push(`${ctx.player} · ${tourneyName} '${ed.year} dup ${m.round}`); break; }
      seen.add(m.round);
    }
  }
  // Rule 2 — no WIN in a round deeper than one the player already LOST.
  if (!isRR) {
    let lostRank = Infinity;
    for (const m of md.slice().sort((a, b) => rank(a.round) - rank(b.round))) {
      if (m.res === 'W' && rank(m.round) > lostRank) { bump('rule2'); ctx.rule2.push(`${ctx.player} · ${tourneyName} '${ed.year}`); break; }
      if (m.res === 'L') lostRank = Math.min(lostRank, rank(m.round));
    }
  }
  // Rule 3 — a "Won" badge requires a final WIN and no main-draw losses.
  // Round-robin titles are exempt: winning a year-end/team event after dropping a
  // group-stage match is legitimate (e.g. Djokovic, Nitto Finals 2015).
  if (!isRR && (ed.finishWon === true || ed.finish === 'Won')) {
    const wonFinal = md.some((m) => m.round === 'F' && m.res === 'W');
    const anyLoss = md.some((m) => m.res === 'L');
    if (!wonFinal || anyLoss) { bump('rule3'); ctx.rule3.push(`${ctx.player} · ${tourneyName} '${ed.year}`); }
  }
  // Rule 4 — best-of-five (Slam main draw): no match, WIN or LOSS, decided in
  // fewer than 3 sets by the winner (non-RET). A completed best-of-5 always ends
  // 3-x, so a <3 winner-set match under the main-draw key is a leaked best-of-3
  // qualifying row (2026-08-28: extended from win-only to catch qualifying LOSSES,
  // the Bonzi US Open '21 class).
  if (isSlam) {
    for (const m of md) {
      if (isRet(m)) continue;
      const s = sets(m.score);
      if (s && Math.max(s[0], s[1]) < 3) { bump('rule4'); ctx.rule4.push(`${ctx.player} · ${tourneyName} '${ed.year} ${m.round} ${m.score} (${m.res})`); }
    }
  }
  // Rule 5 (soft) — best-of-three: no WIN under 2 sets (non-RET).
  if (!isSlam && !isRR) {
    for (const m of md) {
      if (m.res !== 'W' || isRet(m)) continue;
      const s = sets(m.score);
      if (s && Math.max(s[0], s[1]) < 2) { viol.rule5++; ctx.rule5.push(`${ctx.player} · ${tourneyName} '${ed.year} ${m.round} ${m.score}`); }
    }
  }
}

function main() {
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const players = raw.players || raw;
  const viol = { rule1: 0, rule2: 0, rule3: 0, rule4: 0, rule5: 0, rule1Slam: 0, rule2Slam: 0, rule3Slam: 0, rule4Slam: 0 };
  const ctx = { rule1: [], rule2: [], rule3: [], rule4: [], rule5: [] };
  const offenders = {};
  let editions = 0, slamEditions = 0;

  for (const key of Object.keys(players)) {
    const p = players[key];
    if (!p || !Array.isArray(p.tournamentHistory)) continue;
    for (const t of p.tournamentHistory) {
      for (const ed of (t.editions || [])) {
        editions++;
        if (GRAND_SLAMS.has(t.name)) slamEditions++;
        if (PROJECT_FIX) applyBugAFix(t.name, ed);
        const before = viol.rule1 + viol.rule2 + viol.rule3 + viol.rule4 + viol.rule5;
        ctx.player = p.name || key;
        auditEdition(t.name, ed, viol, ctx);
        const after = viol.rule1 + viol.rule2 + viol.rule3 + viol.rule4 + viol.rule5;
        if (after > before) offenders[p.name || key] = (offenders[p.name || key] || 0) + 1;
      }
    }
  }

  const slamStructural = viol.rule1Slam + viol.rule2Slam + viol.rule3Slam + viol.rule4Slam;
  // TEN-89 tour-wide (interaction 358dd5c0): the qualifying-merge fix now runs
  // across every single-elimination event, so the "impossible" classes — a win
  // after an elimination (rule 2), a false "Won" badge (rule 3), a best-of-five
  // win in under three sets (rule 4) — must read ZERO tour-wide, not just for
  // Slams. Rule 1 (a duplicate round with no win-after-loss, e.g. a qualifying
  // R32 win alongside a main-draw R32 loss) is a separate, lower-severity display
  // class the merge fix does not target; it is reported but never blocks.
  const tourWideStructural = viol.rule2 + viol.rule3 + viol.rule4 + viol.rule1Slam;
  console.log(`\nTEN-89 tournament-record audit — ${path.basename(FILE)}${PROJECT_FIX ? '  [--project-fix]' : ''}`);
  console.log(`Players: ${Object.keys(players).length} · editions: ${editions} (${slamEditions} Grand-Slam)\n`);
  const row = (n, label, v, vs) => console.log(`  Rule ${n}  ${label.padEnd(50)} ${String(v).padStart(6)}   (Slam ${vs})`);
  row(1, 'No duplicate round within an edition', viol.rule1, viol.rule1Slam);
  row(2, 'Round sequence monotonic (no win after loss)', viol.rule2, viol.rule2Slam);
  row(3, '"Won" badge => final win + no losses', viol.rule3, viol.rule3Slam);
  row(4, 'Best-of-5 Slam: win under 3 sets (non-RET)', viol.rule4, viol.rule4Slam);
  console.log(`  Rule 5  ${'Best-of-3: win under 2 sets (non-RET) [soft]'.padEnd(50)} ${String(viol.rule5).padStart(6)}`);
  console.log(`\n  SLAM structural (TEN-89 class, rules 1-4 · fail-closed): ${slamStructural}`);
  console.log(`  Global structural (rules 1-4, incl. non-Slam quirks):    ${viol.rule1 + viol.rule2 + viol.rule3 + viol.rule4}`);

  const worst = Object.entries(offenders).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (worst.length) {
    console.log('\n  Worst offenders (failing editions):');
    for (const [name, n] of worst) console.log(`    ${String(n).padStart(3)}  ${name}`);
  }
  for (const rn of ['rule1', 'rule2', 'rule3', 'rule4']) {
    if (ctx[rn].length) console.log(`\n  ${rn} examples: ${ctx[rn].slice(0, 4).join(' | ')}`);
  }

  console.log(`  Tour-wide structural (rules 2-4 + Slam rule 1 · fail-closed):  ${tourWideStructural}`);
  console.log(`  Rule 1 non-Slam duplicate-round (reported, non-blocking):     ${viol.rule1 - viol.rule1Slam}`);

  // TEN-89 Part 2 invariants (fail-closed). The Grand-Slam profile boxes are
  // derived (profile.gsCareer, profile.gsOver35, t.over35, t.mainDraw); these are
  // impossibilities, never a legitimate data quirk, so any hit blocks the refresh:
  //   - over35.count must be within [0, sample]
  //   - over35 / mainDraw must exist ONLY on a Grand-Slam tournament
  //   - gsCareer / gsOver35 counts must be non-negative; gsOver35.count <= sample
  //   - DENOMINATOR RECONCILIATION (founder 2026-08-28): the over-3.5 sample is a
  //     subset of the main-draw matches, so t.over35.sample must never exceed
  //     mainDraw.won+mainDraw.lost. This is the exact class the founder caught on
  //     the Bonzi card (W-L said 12, over-3.5 said 9) — encode it so it can't
  //     silently return.
  const p2 = [];
  for (const key of Object.keys(players)) {
    const p = players[key];
    if (!p || !Array.isArray(p.tournamentHistory)) continue;
    for (const t of p.tournamentHistory) {
      if (t.over35) {
        if (!GRAND_SLAMS.has(t.name)) p2.push(`${p.name || key} · over35 on non-Slam "${t.name}"`);
        const { count, sample } = t.over35;
        if (!(Number.isInteger(count) && Number.isInteger(sample) && count >= 0 && sample >= 0 && count <= sample)) {
          p2.push(`${p.name || key} · ${t.name} over35 impossible ${count}/${sample}`);
        }
      }
      if (t.mainDraw) {
        if (!GRAND_SLAMS.has(t.name)) p2.push(`${p.name || key} · mainDraw on non-Slam "${t.name}"`);
        const { won, lost } = t.mainDraw;
        if (!(won >= 0 && lost >= 0)) p2.push(`${p.name || key} · ${t.name} mainDraw negative ${won}-${lost}`);
        // over-3.5 sample ⊆ main draw: it can never exceed the main-draw match count.
        if (t.over35 && t.over35.sample > (won + lost)) {
          p2.push(`${p.name || key} · ${t.name} over35 sample ${t.over35.sample} > main-draw ${won + lost} (denominators disagree)`);
        }
      }
    }
    if (p.gsCareer && (!(p.gsCareer.won >= 0) || !(p.gsCareer.lost >= 0))) {
      p2.push(`${p.name || key} · gsCareer negative ${p.gsCareer.won}-${p.gsCareer.lost}`);
    }
    if (p.gsOver35) {
      const { count, sample } = p.gsOver35;
      if (!(Number.isInteger(count) && Number.isInteger(sample) && count >= 0 && sample >= 0 && count <= sample)) {
        p2.push(`${p.name || key} · gsOver35 impossible ${count}/${sample}`);
      }
    }
  }
  console.log(`  Part-2 Grand-Slam box invariants (fail-closed):               ${p2.length}`);
  if (p2.length) console.log(`    e.g. ${p2.slice(0, 4).join(' | ')}`);

  if (tourWideStructural > 0 || p2.length > 0) {
    console.error(`\nFAIL — ${tourWideStructural} structural violation(s) (Slam: ${slamStructural})`
      + `${p2.length ? ` + ${p2.length} Part-2 box invariant violation(s)` : ''}. Tournament records are not valid.`);
    process.exit(1);
  }
  console.log('\nPASS — no structural violations (win-after-loss / false title / best-of-5 sub-3-set) and Part-2 boxes valid.');
}

main();
