#!/usr/bin/env node
// [WALKOVER-GATE] (founder 2026-10-23): the captured-Bet365 name join (build-match-closes.js rosterNames +
// capturedBet365) must not move with the day's board. At 00:00Z on 23 Oct the board rolled, the roster lost the names its
// form shards had carried, 120 captures stopped resolving, two Database matches lost their only price and the archive gate
// stopped every run. Asserted on a synthetic store, through the real functions:
//   1 · the same captures resolve, to the same keys, under two different boards (and with no board at all);
//   2 · a name two players share ("Nava, Emilio": E. Nava = 567 or 2920) joins only on evidence — the one candidate pair
//       with a career row against each other within a day — and stays unjoined (a dash) when no pair or two pairs met;
//   3 · CONTROLS: a mutant roster without the career-history names, and a mutant join without the evidence step, go red.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'build-match-closes.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };

const day = (s) => Math.floor(Date.parse(s + 'T12:00:00Z') / 1000);
const cap = (p1, p2, date, cat) => ({ cat, p1, p2, s1: [[day(date) - 3600, 1.6]], s2: [[day(date) - 3600, 2.3]], trueStart: day(date) });
// career rows: 1001 (Faria) met Emilio Nava (567) on 27 Mar; 1002 met Eduardo Nava (2920) on 28 Mar; 1003 met BOTH
// Navas on 29 Mar (two pairs met — no join); 1004 met no Nava (no evidence — no join).
const row = (date, opponent, oppKey) => ({ date, opponent, oppKey, src: 'fixtures', won: true, tournament: 'Challenger X', round: 'R32' });
const SHARDS = {
  1001: [row('2026-03-27', 'E. Nava', '567')],
  1002: [row('2026-03-28', 'E. Nava', '2920')],
  1003: [row('2026-03-29', 'E. Nava', '567'), row('2026-03-29', 'E. Nava', '2920')],
  1004: [row('2026-03-30', 'K. Someone', '9999')],
  567: [row('2026-03-27', 'J. Faria', '1001'), row('2026-03-29', 'Z. Third', '1003')],
  2920: [row('2026-03-28', 'Z. Second', '1002'), row('2026-03-29', 'Z. Third', '1003')],
  // founder 2026-10-24 · a two-key player: api-tennis files Johan Alexander Rodríguez Rodríguez's 11 Jun match under 9221
  // ("J. A. Rodriguez"); his other key 8372 carries the full spelling. Ribeiro (6712) is profiled; his row names 9221.
  6712: [row('2026-06-11', 'J. A. Rodriguez', '9221')],
  1756: [row('2026-06-13', 'J. A. Rodriguez Rodriguez', '8372')],
};
const PROFILES = { 6712: { name: 'E. Ribeiro' }, 1756: { name: 'N. Kicker' }, 1001: { name: 'J. Faria' }, 1002: { name: 'Z. Second' }, 1003: { name: 'Z. Third' }, 1004: { name: 'K. Fourth' } };
const CAPS = {
  a: cap('Faria, Jaime', 'Nava, Emilio', '2026-03-27', 'Challenger'),
  b: cap('Second, Zed', 'Nava, Eduardo', '2026-03-28', 'Challenger'),
  c: cap('Third, Zak', 'Nava, Emilio', '2026-03-29', 'Challenger'),
  d: cap('Fourth, Kai', 'Nava, Emilio', '2026-03-30', 'Challenger'),
  e: cap('Ribeiro, Eduardo', 'Rodriguez Rodriguez, Johan Alexander', '2026-06-11', 'Challenger'),
};
function store(board) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'stable-roster-'));
  fs.mkdirSync(path.join(d, 'bet365-history')); fs.mkdirSync(path.join(d, 'career-history'));
  fs.writeFileSync(path.join(d, 'bet365-history', '2026-03.json'), JSON.stringify({ fixtures: CAPS }));
  for (const [k, m] of Object.entries(SHARDS)) fs.writeFileSync(path.join(d, 'career-history', k + '.json'), JSON.stringify({ key: k, matches: m }));
  fs.writeFileSync(path.join(d, 'player-profiles.json'), JSON.stringify({ players: PROFILES }));
  if (board) {   // a board on which Emilio Nava plays: his name reaches the roster through the board and its form shard
    fs.writeFileSync(path.join(d, 'matches.json'), JSON.stringify([{ p1Key: '1001', p1: 'J. Faria', p2Key: '567', p2: 'E. Nava' }]));
    fs.mkdirSync(path.join(d, 'form'));
    fs.writeFileSync(path.join(d, 'form', '1001.json'), JSON.stringify({ matches: [{ opponentKey: '567', opponent: 'E. Nava' }] }));
  }
  return d;
}
function load(src) {
  const f = path.join(ROOT, '.test-stable-roster-mod.js');
  fs.writeFileSync(f, src);
  try { delete require.cache[require.resolve(f)]; return require(f); } finally { fs.rmSync(f, { force: true }); }
}
function joins(mc, root) {
  const out = {};
  for (const c of mc.capturedBet365(root, mc.makeCommaResolver(mc.rosterNames(root)), {})) out[c.date] = [c.k1, c.k2].join('-');
  return out;
}
function check(mc) {
  const withBoard = joins(mc, store(true)), noBoard = joins(mc, store(false));
  const errs = [];
  if (JSON.stringify(withBoard) !== JSON.stringify(noBoard)) errs.push('the joins move with the board: ' + JSON.stringify({ withBoard, noBoard }));
  if (noBoard['2026-03-27'] !== '1001-567') errs.push('Faria v Emilio Nava (one pair met) did not join to 567: ' + noBoard['2026-03-27']);
  if (noBoard['2026-03-28'] !== '1002-2920') errs.push('Second v Eduardo Nava (one pair met) did not join to 2920: ' + noBoard['2026-03-28']);
  if ('2026-03-29' in noBoard) errs.push('two candidate pairs met, yet the capture joined: ' + noBoard['2026-03-29']);
  if ('2026-03-30' in noBoard) errs.push('no candidate pair met, yet the capture joined: ' + noBoard['2026-03-30']);
  // founder 2026-10-24: the full spelling resolves to 8372, but Ribeiro's own row that day names 9221 — never keep it
  if ('2026-06-11' in noBoard) errs.push('a two-key player kept a wrong-key capture: Ribeiro v ' + noBoard['2026-06-11']);
  return errs;
}

console.log('\n[WALKOVER-GATE] · the captured-Bet365 name join does not move with the board\n');
const real = check(load(SRC));
ok(real.length === 0, 'same joins with and without the board; namesakes join on evidence only' + (real.length ? ' — ' + real.join('; ') : ''));

// CONTROL 1 · the roster without the career-history names (the pre-fix roster): the joins move with the board
const noCh = SRC.replace("((d && d.matches) || []).forEach(r => { if (r && r.src === 'fixtures') add(r.oppKey, r.opponent); });", '');
ok(noCh !== SRC, 'control 1 mutation applies');
ok(check(load(noCh)).length > 0, 'CONTROL 1 · a roster without career-history names is caught');
// CONTROL 2 · no evidence step: a shared name never joins
const noSettle = SRC.replace('if (!k1 || !k2) [k1, k2] = settle(v.p1, v.p2, k1, k2, Math.floor(trueStart / 86400));', '');
ok(noSettle !== SRC, 'control 2 mutation applies');
ok(check(load(noSettle)).length > 0, 'CONTROL 2 · a join without the evidence step is caught');
// CONTROL 3 · settling on ANY met pair (not exactly one): the two-pair capture would join
const anyPair = SRC.replace('if (pairs.length === 1) {', 'if (pairs.length >= 1) {');
ok(anyPair !== SRC, 'control 3 mutation applies');
ok(check(load(anyPair)).length > 0, 'CONTROL 3 · settling an ambiguous capture on one of two met pairs is caught');

// CONTROL 4 · founder 2026-10-24: without the career confirmation the two-key capture is kept on the wrong key (8372)
const noConfirm = SRC.replace('if (!confirmedByCareer(k1, k2, Math.floor(trueStart / 86400))) {', 'if (false) {');
ok(noConfirm !== SRC, 'control 4 mutation applies');
ok(check(load(noConfirm)).some((e) => /two-key player kept a wrong-key capture/.test(e)), 'CONTROL 4 · keeping an unconfirmed capture for a profiled player is caught (Rodríguez Rodríguez on 8372)');

console.log(`\ntest-stable-roster: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
