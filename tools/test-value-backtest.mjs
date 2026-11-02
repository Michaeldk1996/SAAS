#!/usr/bin/env node
// Historical model backtest (tools/value-backtest.mjs): the pure rules on manufactured records, worked by hand.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const B = await import(pathToFileURL(path.join(ROOT, 'tools/value-backtest.mjs')).href);
const MODEL = (await import(pathToFileURL(path.join(ROOT, 'h2h-model/config.js')).href)).default;
let pass = 0, fail = 0;
const check = (n, ok, d) => { if (ok) { pass++; console.log('  PASS ', n); } else { fail++; console.log('  FAIL ', n, d === undefined ? '' : JSON.stringify(d)); } };
const near = (a, b) => a != null && b != null && Math.abs(a - b) < 1e-6;

check('Sharp Value = the Model page\'s threshold (h2h-model/config.js value.sharpEdge)', B.SHARP_VALUE_MIN === MODEL.value.sharpEdge);
check('card key = the dashboard\'s ocsMatchKey (surnames sorted, accents and hyphens folded)', B.cardKey('2026-10-16', 'C. Ruud', 'R. Jódar') === '2026-10-16|jodar|ruud'
  && B.cardKey('2026-10-16', 'A. Zverev', 'M. Zverev') === null);
check('score text → winner (p1 first); a level or empty score → none', B.winnerFromText('6-3, 4-6, 6-2') === 'p1' && B.winnerFromText('0-6, 1-6') === 'p2' && B.winnerFromText('') === null);

const pay = { fixtures: [{ fixture_id: 1, player1: 'Ruud, Casper', player2: 'Jodar, Rafael' }],
  poller: [{ at: '2026-10-15T20:00:00Z', side: '1', price: 1.8, fixture_id: 1 }, { at: '2026-10-15T20:00:00Z', side: '2', price: 2.05, fixture_id: 1 }],
  stream: [{ at: '2026-10-16T06:00:00Z', side: 'ruud', price: 1.7 }] };
check('bet105 at the entry: the last price at or before it, never a later one', B.b105At(pay, 'ruud', Date.parse('2026-10-16T01:00:00Z')).price === 1.8
  && B.b105At(pay, 'ruud', Date.parse('2026-10-16T07:00:00Z')).price === 1.7 && B.b105At(pay, 'ruud', Date.parse('2026-10-15T19:00:00Z')) === null);

const log = { flags: {
  '100': { key: '100', date: '2026-10-16', p1: 'C. Ruud', p2: 'R. Jodar', tour: 'ATP X', status: 'finished', finalScore: '6-3, 6-4',
    valueSnapshot: { fairP1: 0.6, fairP2: 0.4, edgeVsPinnacleP1: 0.05, edgeVsPinnacleP2: -0.05, ts: '2026-10-16T01:00:00Z' } },
  '200': { key: '200', date: '2026-08-10', p1: 'A. One', p2: 'B. Two', status: 'live', finalScore: null,
    valueSnapshot: { fairP1: 0.5, fairP2: 0.5, edgeVsPinnacleP1: -0.02, edgeVsPinnacleP2: 0.02, ts: '2026-08-09T10:00:00Z' } },
  '300': { key: '300', date: '2026-08-11', p1: 'C. Three', p2: 'D. Four', status: 'finished', finalScore: '6-4, 2-1',
    valueSnapshot: { fairP1: 0.7, fairP2: 0.3, edgeVsPinnacleP1: 0.04, edgeVsPinnacleP2: -0.04, ts: '2026-08-10T10:00:00Z' } },
} };
const board = new Map([
  ['200', { finalScore: { winner: 'p2', sets: [{ p1: 2, p2: 6 }, { p1: 3, p2: 6 }] } }],
  ['300', { finalScore: { winner: 'p1', sets: [{ p1: 3, p2: 2 }] }, retired: true }],
  ['100', { finalScore: { winner: 'p1', sets: [{ p1: 6, p2: 3 }, { p1: 6, p2: 4 }] }, pinClose: { p1: 1.75, p2: 2.15, source: 'Pinnacle close (archive)' } }],
]);
const rows = B.buildRows({ log, board, b105: new Map([['2026-10-16|jodar|ruud', pay]]) });
const r1 = rows.find(r => r.event === '100' && r.side === 'p1');
const nv = 1 / ((1 / 1.8) / (1 / 1.8 + 1 / 2.05));
check('bet105 pair at the entry → source bet105, edge on the no-vig price, profit at the price as quoted', r1.source === 'bet105' && near(r1.entry_novig_price, nv)
  && near(r1.edge, 0.6 * nv - 1) && r1.bet_price === 1.8 && near(r1.profit, 0.8) && r1.result === 'won');
check('Sharp Value read from the frozen edge vs Pinnacle (5 pts ≥ 3)', r1.sharp_value === true && rows.find(r => r.event === '100' && r.side === 'p2').sharp_value === false);
check('CLV vs a verified close = bet price × no-vig close − 1', near(r1.clv, 1.8 * ((1 / 1.75) / (1 / 1.75 + 1 / 2.15)) - 1));
const r2 = rows.find(r => r.event === '200' && r.side === 'p2');
check('no bet105 → Pinnacle no-vig from the snapshot (fair − edge), profit at that no-vig price (labelled, summarised apart)',
  r2.source === 'pinnacle-novig' && near(r2.entry_novig_price, 1 / 0.48) && near(r2.edge, 0.5 / 0.48 - 1) && near(r2.profit, 1 / 0.48 - 1));
check('a log row left "live" is settled from the board\'s result', r2.result === 'won' && r2.result_source === 'board');
const r3 = rows.find(r => r.event === '300' && r.side === 'p1');
check('retired before the first set was completed → void, profit 0', r3.result === 'void' && r3.profit === 0);
check('no verified close → CLV a dash', r3.clv === null && rows.find(r => r.event === '200').clv === null);
check('a captured close cut at the schedule is not a verified close', B.closeFor({ pinClose: { p1: 2, p2: 1.8, source: 'Pinnacle +30s (Oddspapi)', startBasis: 'scheduled' } }, 'p1') === null
  && B.closeFor({ pinClose: { p1: 2, p2: 1.8, source: 'Pinnacle +30s (Oddspapi)', startBasis: 'actual' } }, 'p2').price === 1.8);

const many = Array.from({ length: 31 }, (_, i) => ({ source: 'bet105', tier: 'Value', result: i < 16 ? 'won' : 'lost', profit: i < 16 ? 1 : -1, model_prob: 0.5, clv: 0.01 }));
const S = B.summary(many, r => r.tier)[0], T = B.summary(many.slice(0, 29), r => r.tier)[0];
check('31 bets → rates with counts; 29 → counts only, rates a dash', near(S.win_rate, 16 / 31) && near(S.roi, 1 / 31) && S.clv_n === 31 && T.win_rate === null && T.roi === null && T.avg_clv === null && T.bets === 29);
const csv = B.toCsv(rows, undefined, '2026-11-02T00:00:00Z');
check('the CSV says what it is, keeps the two price sources apart and lists every row', /RECONSTRUCTED FROM RECORDS/.test(csv.split('\n')[0])
  && csv.includes('By value tier · bet105 (as quoted)') && csv.includes('By value tier · Pinnacle no-vig (no margin, not bettable)') && (csv.match(/\n100,/g) || []).length === 2);

console.log(`\ntest-value-backtest: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
