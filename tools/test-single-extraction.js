// Ruling 3 (founder 2026-10-20): ONE extraction (extractSheetCounts) feeds the Reports metrics AND the W/UE export rows.
// The Reports display must not change: expected-before.json is buildTournamentProgression's output from main BEFORE the
// change (89bce0901), over pinned real api-tennis fixtures (17–23 Oct, Almaty/Brussels/Lyon) + one Estoril fixture that
// takes the @ATP_Entry OCR fallback. Everything the Reports tab reads must still be byte-identical; so must matches[].
// Run: node tools/test-single-extraction.js
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const FX = path.join(__dirname, 'fixtures', 'single-extraction');
let pass = 0, fail = 0;
const check = (l, c, d) => { if (c) { pass++; console.log(`  ok   ${l}`); } else { fail++; console.log(`  FAIL ${l}${d ? `\n       ${d}` : ''}`); } };
console.log('Single extraction — Reports view unchanged, export rows from the same counts');
const now = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'progression-snapshot.js'), ROOT, path.join(FX, 'fixtures.json')],
  { env: { ...process.env, DOTENV_CONFIG_QUIET: 'true' }, encoding: 'utf8' }).split('\n').filter(l => l.startsWith('{')).pop());
const before = JSON.parse(fs.readFileSync(path.join(FX, 'expected-before.json'), 'utf8'));
const view = e => e && JSON.stringify({ feedName: e.feedName, rounds: e.rounds, players: e.players, fieldAverage: e.fieldAverage });
let pr = 0, ocr = 0;
for (const t of Object.keys(before)) {
  pr += before[t] ? before[t].players.reduce((n, p) => n + p.rounds.length, 0) : 0;
  ocr += before[t] ? before[t].players.flatMap(p => p.rounds).filter(r => r.metrics.wueSource === 'ATP_Entry_OCR').length : 0;
  check(`${t}: Reports view (players · rounds · metrics · field average) byte-identical to before`, view(now[t]) === view(before[t]));
  // ruling 6 adds two fields to each export row (roundCode, hasStats); everything else is unchanged
  // + the draw view's set score (item 2) and its per-side box score (ruling 2026-10-21 item 10) — additive fields only
  const side = ({ box, ...s }) => s;
  const strip = ms => ms && ms.map(({ roundCode, hasStats, score, p1, p2, ...rest }) => ({ ...rest, p1: side(p1), p2: side(p2) }));
  check(`${t}: export matches[] byte-identical to before (ruling 6's roundCode / hasStats aside)`, JSON.stringify(strip(now[t] && now[t].matches)) === JSON.stringify(before[t] && before[t].matches));
}
check(`non-vacuous: ${pr} player-rounds compared, ${ocr} through the OCR fallback`, pr >= 40 && ocr >= 2, `${pr} / ${ocr}`);
// The two views now read one function: the export's W/UE/TT and the Reports' per-point values agree for every row.
let agree = 0, rows = 0;
for (const t of Object.keys(now)) {
  const e = now[t]; if (!e) continue;
  for (const pl of e.players) for (const rd of pl.rounds) {
    const m = e.matches.find(x => x.round === rd.round && [x.p1.playerKey, x.p2.playerKey].includes(String(pl.playerKey)));
    const s = m && (m.p1.playerKey === String(pl.playerKey) ? m.p1 : m.p2); rows++;
    const wp = s && s.winners != null && s.unforcedErrors != null && s.totalPoints ? Math.round(s.winners / s.totalPoints * 1000) / 10 : null;
    if (s && wp === rd.metrics.winnersPct && s.wueSource === rd.metrics.wueSource) agree++;
  }
}
check(`export W/TT and source agree with the Reports metric on every player-round (${agree} of ${rows})`, rows > 0 && agree === rows);
const codes = [...new Set(Object.values(now).filter(Boolean).flatMap(e => e.matches.map(m => m.roundCode)))].sort();
check('roundCode read from the feed: this week\'s first round is R32 (1/16-finals), never "ROUND 1"', codes.join() === 'R32', codes.join());
check('hasStats true exactly when the fixture carried a stat sheet', Object.values(now).filter(Boolean).every(e => e.matches.every(m => m.hasStats === (m.p1.totalPoints != null || m.p1.winners != null || m.p1.servicePoints != null))));
const src = fs.readFileSync(path.join(ROOT, 'bsp-pipeline.js'), 'utf8');
check('one extraction: both paths call extractSheetCounts; the export keeps no copy of the W/UE rule',
  /const counts = extractSheetCounts\(matchStats, playerKey, fallbackCtx\)/.test(src) && /\.\.\.extractSheetCounts\(matchStats, key, \{ tour: f\.tournament_name/.test(src)
  && !/const fb = lookupWue\(f\.tournament_name, name, oppName\)/.test(src));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
