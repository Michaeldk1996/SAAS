// The ATP Finals in tournament-progression.json (founder 2026-11-20: "Why are there no reports for the ATP Finals?").
// api-tennis sends the group matches with no tournament_round, so buildTournamentProgression dropped the event; the
// season finals have no draw sheet, so after its week it never reached drawResults either. Locks:
//   labelRoundRobin  — each round-less finals match = the n-th group match of both players ("Round robin n");
//   labelRounds      — "Round robin n" reads RRn, the knockout rounds still SF / F, and no R-number is minted;
//   seasonFinalsEvent — the finals window joins drawResults from 8 Nov until the year ends, never while on the board.
'use strict';
const assert = require('assert');
const P = require('../bsp-pipeline.js');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('  ✓ ' + m); };

const T = 'ATP Finals - Turin';
const fx = [
  { tournament_name: T, tournament_round: '', first_player_key: 'a', second_player_key: 'b', event_date: '2026-11-15' },
  { tournament_name: T, tournament_round: null, first_player_key: 'c', second_player_key: 'd', event_date: '2026-11-15' },
  { tournament_name: T, tournament_round: '', first_player_key: 'a', second_player_key: 'c', event_date: '2026-11-17' },
  { tournament_name: T, tournament_round: '', first_player_key: 'b', second_player_key: 'd', event_date: '2026-11-17' },
  { tournament_name: T, tournament_round: 'ATP Finals - Turin - Semi-finals', first_player_key: 'a', second_player_key: 'x', event_date: '2026-11-21' },
  { tournament_name: 'Paris', tournament_round: '', first_player_key: 'a', second_player_key: 'b', event_date: '2026-11-03' },
];
const labelled = P.labelRoundRobin(fx, ['Finals - Turin']);
ok(labelled === 4, 'four round-less finals matches labelled (control: the Paris round-less row is not a finals match)');
ok(fx.map(f => f.tournament_round).join('|') === 'Round robin 1|Round robin 1|Round robin 2|Round robin 2|ATP Finals - Turin - Semi-finals|',
  'each group match = the n-th group match of both its players; a knockout round and another event untouched');
ok(JSON.stringify(P.labelRounds(['Round robin 1', 'Round robin 2', 'Round robin 3', 'ATP Finals - Turin - Semi-finals', 'ATP Finals - Turin - Final']))
  === JSON.stringify(['RR1', 'RR2', 'RR3', 'SF', 'F']), 'group rounds read RR1–RR3, then SF and F');
ok(JSON.stringify(P.labelRounds(['1/16-finals', '1/8-finals', 'Quarter-finals', 'Semi-finals', 'Final'])) === JSON.stringify(['R1', 'R2', 'QF', 'SF', 'F']),
  'control: an ordinary draw is labelled as before');

const d = (s) => new Date(s + 'T12:00:00Z');
ok(P.seasonFinalsEvent(['ATP Paris'], d('2026-11-07')) === null, 'before 8 November: no finals window');
const live = P.seasonFinalsEvent(['ATP Finals - Turin', 'ATP Finals'], d('2026-11-20'));
ok(live === null, 'while the finals are on the board, `tournaments` carries them (no drawResults copy)');
const after = P.seasonFinalsEvent([], d('2026-11-26'));
ok(after && after.city === 'Turin' && after.tourName === T && after.from === '2026-11-08' && after.to === '2026-11-26', 'after the week: drawResults.Turin, window 8 Nov to today');
const dec = P.seasonFinalsEvent([], d('2026-12-20'));
ok(dec && dec.to === '2026-11-30', 'in December the window stops at 30 November');
console.log(`\ntest-season-finals-progression: ${n} passed`);
