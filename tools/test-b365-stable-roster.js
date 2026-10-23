#!/usr/bin/env node
// Founder brief 2026-10-23 (the archive gate's 2 lost matches): our captured Bet365 (book 6) is matched to its players on a
// STABLE roster — the ATP standings (player-index.json), the career-history index and every opponent spelling the
// career-history store holds for a key we know — never on today's board alone. Runs the real build-database-yield.js on
// fixtures: a player off the board still joins, the board turning over moves nothing, two known players sharing a name
// join no one (a dash, never a guess), an opponent-only twin key never makes a name ambiguous, and the name a row prints
// is the capture's own (never a standings spelling). MUTANT: the board-only roster → the off-board player's match is lost.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b365-roster-'));
const arch = path.join(tmp, 'odds-archive'); fs.mkdirSync(arch);
const H = 'date,tournament,series,court,surface,round,bestof,winner,loser,wrank,lrank,comment,b365w,b365l,psw,psl,maxw,maxl,avgw,avgl,avgsrc';
fs.writeFileSync(path.join(arch, '2026.csv'), H + '\n' + ['2026-05-20', 'Geneva Open', 'ATP250', 'Outdoor', 'Clay', '1st Round', 3, 'Ace A.', 'Bee B.', 10, 20,
  'Completed', 1.5, 2.6, 1.5, 2.6, 1.6, 2.7, 1.5, 2.6, 'file'].join(',') + '\n');
const t = (iso) => Math.floor(Date.parse(iso) / 1000);
function root(board) {
  const d = fs.mkdtempSync(path.join(tmp, 'root-'));
  fs.mkdirSync(path.join(d, 'bet365-history')); fs.mkdirSync(path.join(d, 'career-history'));
  fs.writeFileSync(path.join(d, 'bet365-history', '2026-04.json'), JSON.stringify({ fixtures: {
    // Caniato (on the board, his own file) beat Gombos (NOT on the board: the standings know him)
    f1: { cat: 'Challenger', p1: 'Caniato, Carlo Alberto', p2: 'Gombos, Norbert', s1: [[t('2026-04-06T09:00:00Z'), 2.1]], s2: [[t('2026-04-06T09:00:00Z'), 1.66]], trueStart: '2026-04-06T10:00:00Z' },
    // Caniato beat a "T. Daniel" — two players we know by key carry that name: no join
    f2: { cat: 'Challenger', p1: 'Caniato, Carlo Alberto', p2: 'Daniel, Taro', s1: [[t('2026-04-08T09:00:00Z'), 2.3]], s2: [[t('2026-04-08T09:00:00Z'), 1.55]], trueStart: '2026-04-08T10:00:00Z' } } }));
  fs.writeFileSync(path.join(d, 'career-history', '22.json'), JSON.stringify({ matches: [
    { date: '2026-04-06', opponent: 'N. Gombos', oppKey: '21', won: true, tournament: 'Challenger Monza', eventKey: 701 },
    { date: '2026-04-08', opponent: 'T. Daniel', oppKey: '31', won: true, tournament: 'Challenger Monza', eventKey: 702 }] }));
  // an opponent-only twin key: another player's file names "N. Gombos" under key 99 (no file, not ranked)
  fs.writeFileSync(path.join(d, 'career-history', '23.json'), JSON.stringify({ matches: [
    { date: '2025-01-01', opponent: 'N. Gombos', oppKey: '99', won: false, tournament: 'Challenger X', eventKey: 703 }] }));
  fs.writeFileSync(path.join(d, 'career-history-index.json'), JSON.stringify({ players: { 22: { name: 'C. A. Caniato' }, 23: { name: 'Z. Zed' }, 32: { name: 'T. Daniel' } } }));
  fs.writeFileSync(path.join(d, 'player-index.json'), JSON.stringify({ players: [{ key: 21, name: 'Norbert Gombos' }, { key: 31, name: 'Taro Daniel' }] }));
  fs.writeFileSync(path.join(d, 'player-profiles.json'), JSON.stringify({ players: board }));
  return d;
}
function build(b3, script) {
  const out = fs.mkdtempSync(path.join(tmp, 'out-'));
  execFileSync('node', [script || path.join(ROOT, 'build-database-yield.js')], { stdio: 'pipe', env: Object.assign({}, process.env, {
    DB_YIELD_ARCHIVE_DIR: arch, DB_YIELD_OUT_DIR: out, DB_YIELD_FEED: path.join(tmp, 'none.csv'), DB_YIELD_APPROX: path.join(tmp, 'none.csv'),
    DB_YIELD_STARTED: path.join(tmp, 'none.json'), DB_YIELD_LOWER_CLOSES: path.join(tmp, 'none.csv'), DB_YIELD_LOWER_APPROX: path.join(tmp, 'none.csv'),
    DB_YIELD_LOWER_UNPRICED: path.join(tmp, 'none.json'), DB_YIELD_B365_ROOT: b3 }) });
  const x = JSON.parse(fs.readFileSync(path.join(out, 'database-yield-x.json'), 'utf8'));
  return x.xRows.map((r, i) => ({ r, n: x.xNames[i] })).filter(o => String(o.r[9]).includes('l'));
}
const full = { 22: { name: 'C. A. Caniato' } };
const A = build(root(full));
const g = A.find(o => o.n.includes('Gombos N.'));
ok(g && g.r[8] === 6 && g.n[0] === 'Caniato C.A.', 'a player off the board (Gombos: the standings know him) still joins: book 6, Caniato the winner');
ok(!A.some(o => o.n.join(' ').includes('Norbert')), 'the name a row prints is the capture\'s own ("Gombos N."), never the standings spelling');
ok(!A.some(o => o.n.join(' ').includes('Daniel')), 'two players we know by key share "T. Daniel": no join (a dash, never a guess)');
ok(A.length === 1, `the opponent-only twin (key 99) never made "N. Gombos" ambiguous: exactly one row (got ${A.length})`);
const B = build(root({}));
ok(JSON.stringify(B) === JSON.stringify(A), 'the board turning over (no profile on it) moves nothing: the same rows, books and prices');
// MUTANT: the board-only roster (the code before 23 Oct) loses Gombos's match
const src = fs.readFileSync(path.join(ROOT, 'build-database-yield.js'), 'utf8');
const anchor = 'const caps = mc.capturedBet365(LOWER_B365_ROOT, mc.makeCommaResolver(stable), st);';
ok(src.split(anchor).length === 2, 'the mutant anchor is found exactly once');
const mp = path.join(ROOT, '.mutant-b365-roster.js');
fs.writeFileSync(mp, src.replace(anchor, 'const caps = mc.capturedBet365(LOWER_B365_ROOT, mc.makeCommaResolver(mc.rosterNames(LOWER_B365_ROOT)), st);'));
let red = false;
try { red = !build(root(full), mp).some(o => o.n.includes('Gombos N.')); } finally { fs.unlinkSync(mp); }
ok(red, 'MUTANT (today\'s board only) loses the off-board player\'s match');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\ntest-b365-stable-roster: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
