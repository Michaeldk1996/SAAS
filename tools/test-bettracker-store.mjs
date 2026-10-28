#!/usr/bin/env node
// Bet Tracker T1 — bettracker-store.js, the page's only storage seam (localStorage, schema v1).
// Proves: the default bankroll for a new member, persistence across a reload (a fresh store instance on the same
// storage), lock irreversibility AT THE STORE (saveBet refuses a locked record; lockedAt never comes from the caller),
// historical results load as locked while this tab session's own results stay undoable, a newer schema is never
// overwritten, delete-only-once-archived. Then mutants: each bends one rule and must turn the suite red.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'bettracker-store.js'), 'utf8');

function load(src) {
  const sandbox = { module: { exports: {} }, JSON, Date, Math, String, Number, Object, Array, isFinite };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(src, sandbox, { filename: 'bettracker-store.js' });
  return sandbox.module.exports;
}
function storage() { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; }

function run(api) {
  const fails = [];
  const eq = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
  const ok = (name, c) => { if (!c) fails.push(name); };
  let t = Date.UTC(2026, 9, 28, 9, 0, 0);
  const now = () => new Date(t);
  const local = storage(), tab = storage();
  const s = api.create({ local, session: tab, now });

  // a new member: one default bankroll, no bets
  const banks = s.listBanks();
  eq('default bankroll', banks.map(b => [b.id, b.name, b.archived]), [['b1', 'Bankroll 1', false]]);
  eq('no bets', s.listBets('b1'), []);
  eq('schema-versioned document', JSON.parse(local.getItem(api.KEY)).v, 1);
  eq('default bankroll created once', s.listBanks().length, 1);

  const bet = (id, extra) => Object.assign({ id, date: '2026-10-28', tour: 'Vienna', level: '500', surface: 'Indoor hard', market: 'Match winner', line: null, book: 'bet105',
    odds: 2.1, close: null, stake: 1, res: null, timing: 'pre', type: 'Single', legs: 1, text: 'A. de Minaur to win', bank: 'b1', tilt: false }, extra);
  ok('post a single', s.saveBet(bet(1)).ok);
  ok('post a combination', s.saveBet(bet(2, { type: 'Combination', legs: 2, odds: 1.56 })).ok);
  ok('post a parlay', s.saveBet(bet(3, { type: 'Parlay', legs: 3, odds: 2.73 })).ok);
  ok('post a fourth', s.saveBet(bet(4)).ok);
  const one = s.listBets('b1').find(b => b.id === 1);
  ok('createdAt stamped, lockedAt null, pending true', one.createdAt === new Date(t).toISOString() && one.lockedAt === null && one.pending === true);
  eq('invalid record refused', s.saveBet(bet(9, { odds: 1.0 })).reason, 'invalid');
  eq('unknown bankroll refused', s.saveBet(bet(9, { bank: 'nope' })).reason, 'no-bankroll');
  eq('lock needs a result', s.lockBet(1).reason, 'pending');

  // settle won / lost / void, lock one
  ok('settle WON', s.saveBet(bet(1, { res: 'won' })).ok);
  ok('settle LOST', s.saveBet(bet(2, { type: 'Combination', legs: 2, odds: 1.56, res: 'lost' })).ok);
  ok('settle VOID', s.saveBet(bet(3, { type: 'Parlay', legs: 3, odds: 2.73, res: 'void' })).ok);
  t += 60000;
  ok('lock the WON bet', s.lockBet(1).ok);
  eq('lockedAt stamped', s.listBets('b1').find(b => b.id === 1).lockedAt, new Date(t).toISOString());
  eq('saveBet refuses a locked record (undo)', s.saveBet(bet(1, { res: null })).reason, 'locked');
  eq('saveBet refuses a locked record (close edit)', s.saveBet(bet(1, { res: 'won', close: 2.0 })).reason, 'locked');
  ok('a caller cannot set lockedAt through saveBet', s.saveBet(bet(4, { lockedAt: '2020-01-01T00:00:00Z' })).ok && s.listBets('b1').find(b => b.id === 4).lockedAt === null);
  ok('an unlocked settled result takes a close', s.saveBet(bet(2, { type: 'Combination', legs: 2, odds: 1.56, res: 'lost', close: 1.5 })).ok);
  ok('undo an unlocked result', s.saveBet(bet(3, { type: 'Parlay', legs: 3, odds: 2.73, res: null })).ok && s.listBets('b1').find(b => b.id === 3).res === null);
  s.saveBet(bet(3, { type: 'Parlay', legs: 3, odds: 2.73, res: 'void' }));

  // reload in the same tab: a fresh instance on the same storage pair
  const r = api.create({ local, session: tab, now }), after = r.listBets('b1');
  eq('reload: every bet is still there', after.map(b => [b.id, b.type, b.res]), [[1, 'Single', 'won'], [2, 'Combination', 'lost'], [3, 'Parlay', 'void'], [4, 'Single', null]]);
  eq('reload: only the locked one is locked', after.map(b => !!b.lockedAt), [true, false, false, false]);
  eq('reload: the close survives', after.find(b => b.id === 2).close, 1.5);

  // a new tab session: results written in an earlier session are historical → load as locked
  const fresh = api.create({ local, session: storage(), now }), hist = fresh.listBets('b1');
  eq('new session: settled results load as locked, pending stays open', hist.map(b => !!b.lockedAt), [true, true, true, false]);
  eq('…and the store now refuses them', fresh.saveBet(bet(2, { type: 'Combination', legs: 2, odds: 1.56, res: null })).reason, 'locked');
  ok('a pending bet from an earlier session can still be settled', fresh.saveBet(bet(4, { res: 'lost' })).ok);
  ok('…and stays undoable in this session', fresh.listBets('b1').find(b => b.id === 4).lockedAt === null);

  // bankrolls
  ok('add a bankroll', fresh.saveBank({ id: 'b2', name: 'Challenger lab', archived: false }).ok);
  eq('delete refused until archived', fresh.deleteBank('b2').reason, 'not-archived');
  fresh.saveBank({ id: 'b2', name: 'Challenger lab', archived: true });
  ok('delete an archived bankroll', fresh.deleteBank('b2').ok && !fresh.listBanks().some(b => b.id === 'b2'));
  fresh.saveBank({ id: 'b1', name: 'Bankroll 1', archived: true });
  eq('a bankroll holding a locked result is never deleted', fresh.deleteBank('b1').reason, 'locked');
  eq('bankroll createdAt is kept on save', fresh.listBanks()[0].createdAt, banks[0].createdAt);
  ok('nextId is unique and rising', fresh.nextId() > 4);

  // a newer schema is never overwritten
  const nl = storage(); nl.setItem(api.KEY, JSON.stringify({ v: 2, banks: [], bets: [], other: 1 }));
  const ns = api.create({ local: nl, session: storage(), now });
  ns.listBanks(); ns.saveBank({ id: 'x', name: 'x' });
  eq('v2 document untouched', JSON.parse(nl.getItem(api.KEY)), { v: 2, banks: [], bets: [], other: 1 });
  return fails;
}

const fails = run(load(SRC));
for (const f of fails) console.log('  FAIL ', f);
console.log(fails.length ? `bettracker-store: ${fails.length} failure(s)` : 'bettracker-store: all checks pass');

const MUTANTS = [
  ['saveBet ignores lockedAt', "if (i >= 0 && doc.bets[i].lockedAt) return { ok: false, reason: 'locked' };", ''],
  ['saveBet keeps the caller lockedAt', 'rec.lockedAt = null;', 'rec.lockedAt = rec.lockedAt || null;'],
  ['history never auto-locks', 'if (b.res && !b.lockedAt && mine.indexOf(b.id) < 0)', 'if (false)'],
  ['session not remembered', 'touch(rec.id);', ''],
  ['delete without archive', "if (!bank.archived) return { ok: false, reason: 'not-archived' };", ''],
  ['delete with locked results', "if (doc.bets.some(function (b) { return b.bank === id && b.lockedAt; })) return { ok: false, reason: 'locked' };", ''],
  ['no default bankroll', "doc.banks.push({ id: 'b1', name: DEFAULT_BANK, archived: false, createdAt: stamp() }); write(doc);", ''],
  ['newer schema overwritten', 'if (foreign) return false;', '']
];
let survived = 0;
for (const [name, from, to] of MUTANTS) {
  if (!SRC.includes(from)) { console.log('  FAIL  mutant anchor missing:', name); survived++; continue; }
  let red; try { red = run(load(SRC.replace(from, to))).length > 0; } catch (e) { red = true; }
  if (!red) { console.log('  FAIL  mutant survived:', name); survived++; }
}
console.log(`mutants: ${MUTANTS.length - survived} of ${MUTANTS.length} killed`);
process.exit(fails.length || survived ? 1 : 0);
