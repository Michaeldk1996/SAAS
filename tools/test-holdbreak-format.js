#!/usr/bin/env node
// build-holdbreak.js best-of split (founder 2026-11-26): sets 1–3 pool both formats in the main grid; `fmt[3|5]` keeps
// them apart for the Live page. Runs the SHIPPED builder (and live-moments.js, whose bestOf it reads) in a throwaway
// directory on two synthetic finished matches: a Grand Slam main-draw match (best of five) and an ATP 250 (best of
// three), the same player serving in both. The main grid is unchanged; the split never mixes; a mutant that files every
// match under best-of-three goes red.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) { pass++; console.log('  ok  ' + what); } else { fail++; console.log('  FAIL ' + what); } };

// one service game for each side per set; first player holds his serve, second player is broken every time
function match(ek, tournament, key) {
  const pbp = [];
  for (let set = 1; set <= 3; set++) {
    for (let g = 1; g <= 2; g++) {
      const server = g === 1 ? 'First Player' : 'Second Player';
      pbp.push({ set_number: 'Set ' + set, number_game: String(g), player_served: server, serve_winner: 'First Player',
        points: [{ score: '15 - 0' }, { score: '30 - 0' }, { score: '40 - 0' }] });
    }
  }
  return { event_key: ek, event_date: '2026-10-01', event_first_player: 'A. Alpha', first_player_key: 101,
    event_second_player: 'B. Beta', second_player_key: 202, event_status: 'Finished', event_type_type: 'Atp Singles',
    event_qualification: 'False', tournament_name: tournament, tournament_key: key, pointbypoint: pbp };
}

function run(builderSrc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hbfmt-'));
  try {
    fs.writeFileSync(path.join(dir, 'build-holdbreak.js'), builderSrc);
    fs.copyFileSync(path.join(ROOT, 'live-moments.js'), path.join(dir, 'live-moments.js'));
    fs.writeFileSync(path.join(dir, 'tournament-surfaces.json'), JSON.stringify({ surfaces: { '1': 'hard', '2': 'hard' } }));
    fs.writeFileSync(path.join(dir, 'player-profiles.json'), JSON.stringify({ players: { '101': { rank: 10 }, '202': { rank: 20 } } }));   // roster: ranked
    fs.mkdirSync(path.join(dir, 'apitennis-holdbreak-cache'));
    fs.writeFileSync(path.join(dir, 'apitennis-holdbreak-cache', '101.json'),
      JSON.stringify([match(1, 'US Open', 1), match(2, 'ATP Chengdu', 2)]));
    execFileSync(process.execPath, [path.join(dir, 'build-holdbreak.js')], { cwd: dir, stdio: 'pipe' });
    return JSON.parse(fs.readFileSync(path.join(dir, 'holdbreak.json'), 'utf8'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function verify(out) {
  const a = out.players['101'], b = out.players['202'];
  if (!a || !b) return 'players missing (roster rule)';
  if (a.serve.all['1']['1'].n !== 2) return 'main grid: set 1 bucket 1 should pool both matches (n 2), got ' + a.serve.all['1']['1'].n;
  const f5 = a.fmt && a.fmt['5'], f3 = a.fmt && a.fmt['3'];
  if (!f5 || !f3) return 'fmt lacks a best-of key: ' + JSON.stringify(Object.keys(a.fmt || {}));
  if (JSON.stringify(f5.serve.all['1']['1']) !== '[1,1]' || JSON.stringify(f3.serve.all['1']['1']) !== '[1,1]') return 'each format holds its own one game';
  if (JSON.stringify(b.fmt['5'].return.all['2']['1']) !== '[0,1]') return 'return grid: B never broke in the best-of-5 match';
  if (f5.serve.all['4'] || f3.serve.all['4']) return 'sets 4–5 are not in fmt (best-of-5 only already)';
  if (!f5.serve.hard || !f5.serve.hard['1']) return 'fmt carries the surface';
  return null;
}

const SRC = fs.readFileSync(path.join(ROOT, 'build-holdbreak.js'), 'utf8');
const err = verify(run(SRC));
check(err == null, 'sets 1–3 split by best-of, main grid unchanged' + (err ? ' — ' + err : ''));
const MUT = SRC.replace('const bo = String(bestOf(r));', "const bo = '3';");
check(MUT !== SRC, 'mutant applies');
check(verify(run(MUT)) != null, 'MUTANT caught: every match filed as best-of-three');

console.log(`\nholdbreak format split: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
