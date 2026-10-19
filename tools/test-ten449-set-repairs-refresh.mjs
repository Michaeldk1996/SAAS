#!/usr/bin/env node
// TEN-449 · the weekly refresh's set-repair step (tools/te-set-repairs-refresh.mjs, plan §4a). Fixture sources shaped
// like J. Sels's case (key 586, joined after the 17 Oct scrape; his short rows are new to set-repairs.json):
//   * his short rows end REPAIRED — two from his own TE page, one from the opponent's page (L. Nardi), each with
//     Sackmann agreeing; his Sackmann id comes from the identity builder (DOB + surname), not from a hand-built file;
//   * control: before he is in the store, his own-page rows flag "Sackmann only" (the 19 Oct measurement), so the
//     repaired result above is not vacuous;
//   * FROZEN (the 17 Oct entries, no `by`): byte-identical; a MUTANT build that rebuilds the committed rows (the fixture
//     sources would now repair the committed flag) is refused — ok:false, set-repairs.json byte-identical, no log;
//   * REFRESH entries (`by: 'refresh'`): a "no Tennis Explorer row" flag upgrades to a repair once the player joins the
//     store; a repair — refresh-written or frozen — never changes (mutants refused);
//   * fail closed: every input removed in turn (store index, te-history/, set-repairs.json, Sackmann players / matches /
//     SHA256SUMS, a CSV not matching or not listed in SHA256SUMS, the site's career-history index, a listed shard,
//     player-index.json, a shard answering 404) -> throws, nothing written; a transient 503 is retried;
//   * the week gate: the step runs only when every weekly part of one week has completed.
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as R from './te-set-repairs-refresh.mjs';
import { build } from './build-set-repairs.mjs';

let pass = 0, fail = 0;
const check = async (n, fn) => { try { await fn(); pass++; console.log('  ok   ' + n); } catch (e) { fail++; console.log('  FAIL ' + n + ' :: ' + e.message); } };
const g = (sets) => (sets || []).map((s) => `${s.p}-${s.o}`).join(' ');

const SELS = '586', NARDI = '900', SCHW = '67';
const row = (ek, date, tour, opp, result, won, sets) => ({ year: date.slice(0, 4), surface: 'clay', level: 'chitf', date, tournament: tour, round: 'R32', opponent: opp, result, won, src: 'fixtures', eventKey: ek, sets });
const selsRows = [
  row(11792084, '2022-09-04', 'Tulln', 'E. Kirkin', '2 - 1', true, [{ p: 6, o: 3 }, { p: 4, o: 6 }]),
  row(11767792, '2022-04-20', 'Split', 'L. Nardi', '0 - 2', false, [{ p: 4, o: 6 }]),
  row(11399125, '2022-04-12', 'Barletta', 'C. Lestienne', '2 - 1', true, [{ p: 5, o: 7 }, { p: 6, o: 4 }]),
];
// Nardi's side of Split is already repaired (as the site serves it: whole) and committed
const nardiRows = [{ ...row(11767792, '2022-04-20', 'Split', 'J. Sels', '2 - 0', true, [{ p: 6, o: 4 }, { p: 6, o: 0 }]), setsFrom: 'te+sackmann' }];
// Schwartzman: one committed repair (whole as served) and one committed flag (still short)
const schwRows = [
  { ...row(1001, '2022-05-02', 'Estoril', 'A. Able', '2 - 1', true, [{ p: 6, o: 4 }, { p: 3, o: 6 }, { p: 6, o: 0 }]), setsFrom: 'te+sackmann' },
  row(1002, '2022-06-06', 'Halle', 'B. Baker', '2 - 1', true, [{ p: 6, o: 2 }, { p: 4, o: 6 }]),
];
const COLS = ['season', 'date', 'event', 'cat', 'round', 'surface', 'court', 'opp', 'oppSlug', 'won', 'score', 'wo', 'ret', 'teMatchId', 'dateAmbiguous'];
const T = (date, ev, opp, won, score) => [2022, date, ev, 'Challenger', 'R32', 'clay', 'outdoor', opp, opp.split(' ')[0].toLowerCase(), won ? 1 : 0, score, 0, 0, null, 0];
const teSels = [T('2022-09-04', 'Tulln', 'Kirkin E.', true, '6-3, 4-6, 6-0'), T('2022-04-12', 'Barletta', 'Lestienne C.', true, '5-7, 6-4, 6-0')];
const teNardi = [T('2022-04-20', 'Split', 'Sels J.', true, '6-4, 6-0')];
const teSchw = [T('2022-05-02', 'Estoril', 'Able A.', true, '6-4, 3-6, 6-0'), T('2022-06-06', 'Halle', 'Baker B.', true, '6-2, 4-6, 6-0')];
const CSV = 'tourney_id,tourney_name,surface,draw_size,tourney_level,tourney_date,match_num,winner_id,winner_seed,winner_entry,winner_name,winner_hand,winner_ht,winner_ioc,winner_age,loser_id,loser_seed,loser_entry,loser_name,loser_hand,loser_ht,loser_ioc,loser_age,score,best_of,round';
const S = (d, tname, wid, wn, lid, ln, score) => `t,${tname},Clay,32,C,${d},1,${wid},,,${wn},R,,,,${lid},,,${ln},R,,,,${score},3,R32`;
const matches = [CSV,
  S('20220829', 'Tulln CH', '125847', 'Jelle Sels', '9001', 'Eren Kirkin', '6-3 4-6 6-0'),
  S('20220418', 'Split CH', '9002', 'Luca Nardi', '125847', 'Jelle Sels', '6-4 6-0'),
  S('20220411', 'Barletta CH', '125847', 'Jelle Sels', '9003', 'Clement Lestienne', '5-7 6-4 6-0'),
  S('20220502', 'Estoril', '9100', 'Diego Schwartzman', '9004', 'Al Able', '6-4 3-6 6-0'),
  S('20220606', 'Halle', '9100', 'Diego Schwartzman', '9005', 'Bo Baker', '6-2 4-6 6-0'),
].join('\n') + '\n';
const PLAYERS = 'player_id,name_first,name_last,hand,dob,ioc,height,wikidata_id\n124683,Davy,Sels,U,19710718,BEL,,\n125847,Jelle,Sels,R,19950810,NED,188,\n';
const REPAIR_1001 = { short: [{ p: 6, o: 4 }, { p: 3, o: 6 }], date: '2022-05-02', opp: 'A. Able', tour: 'Estoril', result: '2 - 1', sets: [{ p: 6, o: 4 }, { p: 3, o: 6 }, { p: 6, o: 0 }], te: 'own', sackmann: 'x' };
const FLAG_1002 = { short: [{ p: 6, o: 2 }, { p: 4, o: 6 }], date: '2022-06-06', opp: 'B. Baker', tour: 'Halle', result: '2 - 1', why: 'Sackmann only (no Tennis Explorer row)', te: null, sackmann: 'y' };
const REPAIR_NARDI = { short: [{ p: 6, o: 4 }], date: '2022-04-20', opp: 'J. Sels', tour: 'Split', result: '2 - 0', sets: [{ p: 6, o: 4 }, { p: 6, o: 0 }], te: 'own', sackmann: 'z' };

function world({ selsInStore = true } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ten449-sr-'));
  const store = path.join(d, 'store'), site = path.join(d, 'site'), sack = path.join(d, 'sack');
  for (const x of [path.join(store, 'te-history'), path.join(site, 'career-history'), sack]) fs.mkdirSync(x, { recursive: true });
  const te = { [NARDI]: teNardi, [SCHW]: teSchw, ...(selsInStore ? { [SELS]: teSels } : {}) };
  const dob = { [SELS]: '19950810', [NARDI]: '20030821', [SCHW]: '19920816' };
  for (const [k, rows] of Object.entries(te)) fs.writeFileSync(path.join(store, 'te-history', `${k}.json`), JSON.stringify({ key: k, src: 'te', cols: COLS, rows }));
  fs.writeFileSync(path.join(store, 'te-history-index.json'), JSON.stringify({ players: Object.fromEntries(Object.keys(te).map((k) => [k, { dob: dob[k], rows: te[k].length }])) }));
  fs.writeFileSync(path.join(store, 'te-atp-events.json'), JSON.stringify({ names: [] }));
  fs.writeFileSync(path.join(store, 'set-repairs.json'), JSON.stringify({ v: 1, builtAt: '2026-10-18T22:52:37.017Z', counts: { 'repaired (TE own page + Sackmann)': 2, 'Sackmann only': 1 }, shortRows: 3,
    repairs: { [SCHW]: { 1001: REPAIR_1001 }, [NARDI]: { 11767792: REPAIR_NARDI } }, flags: { [SCHW]: { 1002: FLAG_1002 } } }));
  const shards = { [SELS]: selsRows, [NARDI]: nardiRows, [SCHW]: schwRows };
  for (const [k, m] of Object.entries(shards)) fs.writeFileSync(path.join(site, 'career-history', `${k}.json`), JSON.stringify({ v: 1, key: k, matches: m }));
  fs.writeFileSync(path.join(site, 'career-history-index.json'), JSON.stringify({ v: 1, players: Object.fromEntries(Object.entries(shards).map(([k, m]) => [k, m.length])) }));
  fs.writeFileSync(path.join(site, 'player-index.json'), JSON.stringify({ players: [{ key: SELS, name: 'Jelle Sels', hasProfile: true }, { key: NARDI, name: 'Luca Nardi', hasProfile: true }, { key: SCHW, name: 'Diego Schwartzman', hasProfile: true }] }));
  fs.writeFileSync(path.join(sack, 'atp_players.csv'), PLAYERS);
  fs.writeFileSync(path.join(sack, 'atp_matches_qual_chall_2022.csv'), matches);
  sums(sack);
  return { d, store, site, sack };
}
// SHA256SUMS over the Sackmann files, as committed in the store repo's sackmann/
function sums(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.csv')).sort();
  fs.writeFileSync(path.join(dir, 'SHA256SUMS'), files.map((f) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, f))).digest('hex')}  ${f}`).join('\n') + '\n');
}
// put Sels into the store (as the weekly run does once he is joined on his DOB)
function joinSels(w) {
  fs.writeFileSync(path.join(w.store, 'te-history', `${SELS}.json`), JSON.stringify({ key: SELS, src: 'te', cols: COLS, rows: teSels }));
  const f = path.join(w.store, 'te-history-index.json'); const idx = JSON.parse(fs.readFileSync(f, 'utf8'));
  idx.players[SELS] = { dob: '19950810', rows: teSels.length }; fs.writeFileSync(f, JSON.stringify(idx));
}
const read = (w, f) => fs.readFileSync(path.join(w.store, f), 'utf8');
const quiet = () => {};

await check('identity builder: Sackmann id = the one atp_players row with his DOB and surname (not the other Sels); no DOB, no id', () => {
  const id = R.buildIdentity({ roster: [{ key: SELS, name: 'Jelle Sels' }, { key: '1', name: 'Davy Sels' }], storeIndex: { players: { [SELS]: { dob: '19950810' } } }, playersCsv: PLAYERS });
  assert.deepStrictEqual(id.sids, { [SELS]: '125847' }); assert.deepStrictEqual(id.names[SELS], { name: 'Jelle Sels' });
});

{
  const w = world(); const before = JSON.parse(read(w, 'set-repairs.json'));
  const r = await R.refresh({ store: w.store, sackmann: w.sack, site: w.site, now: '2026-10-26T11:00:00Z', log: quiet });
  const after = JSON.parse(read(w, 'set-repairs.json'));
  await check('Sels-like rows: all 3 new short rows end REPAIRED (2 from his own TE page, 1 from Nardi\'s, Sackmann agreeing)', () => {
    assert.strictEqual(r.ok, true, r.why.join('; ')); assert.strictEqual(r.summary.rowsChecked, 3, JSON.stringify(r.summary)); assert.strictEqual(r.summary.repaired, 3);
    const s = after.repairs[SELS] || {};
    assert.deepStrictEqual([g(s[11792084]?.sets), g(s[11767792]?.sets), g(s[11399125]?.sets)], ['6-3 4-6 6-0', '4-6 0-6', '5-7 6-4 6-0'], JSON.stringify(after.flags[SELS]));
    assert.deepStrictEqual([s[11792084].te, s[11767792].te, s[11399125].te], ['own', 'opponent', 'own']);
    assert.ok(!after.flags[SELS]);
  });
  await check('frozen: every committed repair and flag is byte-identical; the committed flag (1002) was not rebuilt', () => {
    assert.deepStrictEqual(after.repairs[SCHW], before.repairs[SCHW]); assert.deepStrictEqual(after.flags[SCHW], before.flags[SCHW]);
    assert.deepStrictEqual(after.repairs[NARDI], before.repairs[NARDI]); assert.deepStrictEqual(R.checkFrozen(before, after), []);
    assert.strictEqual(after.shortRows, 6); assert.strictEqual(after.builtAt, before.builtAt);
  });
  await check('a log line per new row, old -> new', () => {
    const l = read(w, 'set-repairs-log.jsonl').trim().split('\n').map((x) => JSON.parse(x));
    assert.strictEqual(l.length, 3); assert.ok(l.every((x) => x.kind === 'repaired' && x.key === SELS && x.old && x.new));
  });
  const snap = read(w, 'set-repairs.json');
  const r2 = await R.refresh({ store: w.store, sackmann: w.sack, site: w.site, now: '2026-11-02T11:00:00Z', log: quiet });
  await check('a second run with no new short row writes nothing', () => { assert.strictEqual(r2.ok, true); assert.strictEqual(r2.wrote, false); assert.strictEqual(read(w, 'set-repairs.json'), snap); });
}

{
  // a REFRESH-written flag ("no Tennis Explorer row": he was not in the store yet) upgrades once he joins; the frozen
  // entries and the refresh-written repair stay byte-identical across both runs
  const w = world({ selsInStore: false }); const frozen0 = JSON.parse(read(w, 'set-repairs.json'));
  const r1 = await R.refresh({ store: w.store, sackmann: w.sack, site: w.site, now: '2026-10-26T11:00:00Z', log: quiet });
  const a1 = JSON.parse(read(w, 'set-repairs.json'));
  await check('control: before he is in the store, his own-page rows flag "Sackmann only (no Tennis Explorer row)", marked by: refresh; the opponent-page row repairs', () => {
    assert.strictEqual(r1.ok, true, r1.why.join('; '));
    for (const ek of [11792084, 11399125]) { assert.match(a1.flags[SELS][ek].why, /^Sackmann only \(no Tennis Explorer row\)/); assert.strictEqual(a1.flags[SELS][ek].by, 'refresh'); }
    assert.deepStrictEqual(Object.keys(a1.repairs[SELS]), ['11767792']); assert.strictEqual(a1.repairs[SELS][11767792].by, 'refresh');
    assert.ok(!a1.repairs[SCHW][1001].by && !a1.flags[SCHW][1002].by, 'frozen entries carry no refresh mark');
  });
  joinSels(w);
  const r2 = await R.refresh({ store: w.store, sackmann: w.sack, site: w.site, now: '2026-11-02T11:00:00Z', log: quiet });
  const a2 = JSON.parse(read(w, 'set-repairs.json'));
  await check('refresh-written flags UPGRADE to repairs once he joins the store (upgradedFrom kept; logged "upgraded")', () => {
    assert.strictEqual(r2.ok, true, r2.why.join('; ')); assert.strictEqual(r2.summary.upgraded, 2, JSON.stringify(r2.summary));
    for (const ek of [11792084, 11399125]) { const e = a2.repairs[SELS][ek]; assert.ok(e && e.by === 'refresh' && /^Sackmann only/.test(e.upgradedFrom) && e.te === 'own', JSON.stringify(e)); }
    assert.ok(!a2.flags[SELS], JSON.stringify(a2.flags[SELS]));
    assert.strictEqual(a2.shortRows, a1.shortRows, 'an upgrade is not a new short row');
    const log = read(w, 'set-repairs-log.jsonl').trim().split('\n').map((x) => JSON.parse(x)).filter((x) => x.kind === 'upgraded');
    assert.strictEqual(log.length, 2);
  });
  await check('across both runs: frozen entries and the earlier refresh repair are byte-identical', () => {
    assert.deepStrictEqual(a2.repairs[SCHW], frozen0.repairs[SCHW]); assert.deepStrictEqual(a2.flags[SCHW], frozen0.flags[SCHW]);
    assert.deepStrictEqual(a2.repairs[NARDI], frozen0.repairs[NARDI]); assert.deepStrictEqual(a2.repairs[SELS][11767792], a1.repairs[SELS][11767792]);
  });
  // a repair never changes, whoever wrote it: mutants that rewrite a refresh repair / a frozen repair are refused
  const snap = read(w, 'set-repairs.json');
  const tamper = (key, ek) => (opts) => { const o = build({ ...opts, only: null }); const e = (o.repairs[key] = o.repairs[key] || {})[ek] = { ...((o.repairs[key] || {})[ek] || {}), sets: [{ p: 6, o: 0 }, { p: 6, o: 0 }] }; return o; };
  const m1 = await R.refresh({ store: w.store, sackmann: w.sack, site: w.site, buildFn: tamper(SELS, '11767792'), log: quiet });
  const m2 = await R.refresh({ store: w.store, sackmann: w.sack, site: w.site, buildFn: tamper(SCHW, '1001'), log: quiet });
  await check('MUTANT: a refresh-written repair rewritten -> refused, file byte-identical', () => {
    assert.strictEqual(m1.ok, false); assert.ok(m1.why.some((x) => /refresh repairs 586\/11767792 changed/.test(x)), m1.why.join('; ')); assert.strictEqual(read(w, 'set-repairs.json'), snap);
  });
  await check('MUTANT: a frozen repair rewritten -> refused, file byte-identical', () => {
    assert.strictEqual(m2.ok, false); assert.ok(m2.why.some((x) => /frozen repairs 67\/1001 changed/.test(x)), m2.why.join('; ')); assert.strictEqual(read(w, 'set-repairs.json'), snap);
  });
}

await check('checkFrozen: only a refresh flag whose reason is "no Tennis Explorer row" may become a repair', () => {
  const tFlag = (why, by = 'refresh') => ({ flags: { 1: { 9: { short: [], why, ...(by ? { by } : {}) } } }, repairs: {} });
  const up = (prev) => ({ flags: {}, repairs: { 1: { 9: { sets: [], by: 'refresh', upgradedFrom: prev.flags[1][9].why } } } });
  const ok = tFlag('Sackmann only (no Tennis Explorer row)'); assert.deepStrictEqual(R.checkFrozen(ok, up(ok)), []);
  const frozenFlag = tFlag('Sackmann only (no Tennis Explorer row)', null); assert.ok(R.checkFrozen(frozenFlag, up(frozenFlag)).length, 'a frozen flag upgraded');
  const teOnly = tFlag('Tennis Explorer only (no Sackmann match)'); assert.ok(R.checkFrozen(teOnly, up(teOnly)).length, 'a non-upgradable refresh flag upgraded');
  const changed = tFlag('Sackmann only (no Tennis Explorer row)'); assert.ok(R.checkFrozen(changed, tFlag('neither (no Tennis Explorer row; no Sackmann match)')).length, 'a refresh flag rewritten as another flag');
});

{
  // MUTANT: a rebuild that ignores "new rows only" — the fixture sources now agree on the committed flag 1002, so a full
  // rebuild would turn it into a repair. Refused; nothing written.
  const w = world(); const before = read(w, 'set-repairs.json');
  const mutant = (opts) => build({ ...opts, only: null });
  const r = await R.refresh({ store: w.store, sackmann: w.sack, site: w.site, buildFn: mutant, log: quiet });
  await check('MUTANT rebuild of committed rows: refused (flag 1002 would change), set-repairs.json byte-identical, no log', () => {
    assert.strictEqual(r.ok, false); assert.ok(r.why.some((x) => /1002/.test(x)), r.why.join('; '));
    assert.strictEqual(read(w, 'set-repairs.json'), before); assert.ok(!fs.existsSync(path.join(w.store, 'set-repairs-log.jsonl')));
  });
  await check('checkFrozen names a changed, a dropped and a moved entry', () => {
    const p = JSON.parse(before);
    const changed = JSON.parse(before); changed.repairs[SCHW][1001].sets = [{ p: 6, o: 4 }];
    const dropped = JSON.parse(before); delete dropped.flags[SCHW][1002];
    const moved = JSON.parse(before); moved.repairs[SCHW][1002] = { sets: [] };
    assert.ok(/repairs 67\/1001 changed/.test(R.checkFrozen(p, changed).join()));
    assert.ok(/flags 67\/1002 dropped/.test(R.checkFrozen(p, dropped).join()));
    assert.ok(/flags 67\/1002 also in repairs/.test(R.checkFrozen(p, moved).join()));
  });
}

// fail closed: each input removed in turn
for (const [name, edit] of [
  ['the store index missing', (w) => fs.rmSync(path.join(w.store, 'te-history-index.json'))],
  ['te-history/ missing', (w) => fs.rmSync(path.join(w.store, 'te-history'), { recursive: true })],
  ['set-repairs.json missing', (w) => fs.rmSync(path.join(w.store, 'set-repairs.json'))],
  ['set-repairs.json without repairs/flags', (w) => fs.writeFileSync(path.join(w.store, 'set-repairs.json'), '{"v":1}')],
  ['Sackmann atp_players.csv missing', (w) => fs.rmSync(path.join(w.sack, 'atp_players.csv'))],
  ['Sackmann match CSVs missing', (w) => fs.rmSync(path.join(w.sack, 'atp_matches_qual_chall_2022.csv'))],
  ['Sackmann SHA256SUMS missing', (w) => fs.rmSync(path.join(w.sack, 'SHA256SUMS'))],
  ['a Sackmann file not matching SHA256SUMS (one byte changed)', (w) => fs.appendFileSync(path.join(w.sack, 'atp_matches_qual_chall_2022.csv'), ' ')],
  ['an extra Sackmann CSV not in SHA256SUMS', (w) => fs.writeFileSync(path.join(w.sack, 'atp_matches_2023.csv'), CSV + '\n')],
  ['SHA256SUMS not listing atp_players.csv', (w) => { const f = path.join(w.sack, 'SHA256SUMS'); fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split('\n').filter((l) => !/atp_players/.test(l)).join('\n')); }],
  ['the --sackmann dir itself missing', (w) => fs.rmSync(w.sack, { recursive: true })],
  ['the site\'s career-history-index.json missing', (w) => fs.rmSync(path.join(w.site, 'career-history-index.json'))],
  ['a shard the index lists missing', (w) => fs.rmSync(path.join(w.site, 'career-history', `${SELS}.json`))],
  ['player-index.json missing', (w) => fs.rmSync(path.join(w.site, 'player-index.json'))],
]) {
  const w = world(); edit(w);
  const before = fs.existsSync(path.join(w.store, 'set-repairs.json')) ? read(w, 'set-repairs.json') : null;
  let err = null; try { await R.refresh({ store: w.store, sackmann: w.sack, site: w.site, log: quiet }); } catch (e) { err = e; }
  await check(`fail closed: ${name} -> stops, nothing written`, () => {
    assert.ok(err && err.closed, String(err && err.message));
    assert.strictEqual(fs.existsSync(path.join(w.store, 'set-repairs.json')) ? read(w, 'set-repairs.json') : null, before);
    assert.ok(!fs.existsSync(path.join(w.store, 'set-repairs-log.jsonl')));
  });
}

{
  // the deployed site over HTTP: a shard answering 404 stops the run; a transient 503 is retried
  process.env.SET_REPAIRS_RETRY_MS = '1';
  const realFetch = globalThis.fetch;
  const serve = (w, status) => { let n = 0; globalThis.fetch = async (u) => {
    const rel = new URL(String(u)).pathname.replace(/^\/SAAS\//, '');
    if (status[rel] && (status[rel].times === undefined || n++ < status[rel].times)) return { status: status[rel].code, json: async () => ({}) };
    const f = path.join(w.site, rel); if (!fs.existsSync(f)) return { status: 404, json: async () => ({}) };
    return { status: 200, json: async () => JSON.parse(fs.readFileSync(f, 'utf8')) };
  }; };
  const w = world(); const before = read(w, 'set-repairs.json'); serve(w, { [`career-history/${SELS}.json`]: { code: 404 } });
  let err = null; try { await R.refresh({ store: w.store, sackmann: w.sack, site: R.SITE, log: quiet }); } catch (e) { err = e; }
  await check('HTTP: a shard answering 404 -> stops, nothing written', () => { assert.ok(err && /HTTP 404/.test(err.message), String(err)); assert.strictEqual(read(w, 'set-repairs.json'), before); });
  const w2 = world(); serve(w2, { [`career-history/${SELS}.json`]: { code: 503, times: 1 } });
  let r = null; try { r = await R.refresh({ store: w2.store, sackmann: w2.sack, site: R.SITE, log: quiet }); } catch (e) { r = { ok: false, why: [e.message] }; }
  await check('HTTP: one transient 503 is retried and the run completes', () => assert.strictEqual(r.ok, true, r.why.join('; ')));
  globalThis.fetch = realFetch;
}

await check('week gate: runs only when every weekly part of one week has completed', () => {
  const wk = (of, done, refreshedAt, week = '2026-10-26') => R.weekComplete({ weeklyParts: { week, of, done }, refreshedAt });
  assert.strictEqual(wk(2, [0, 1], '2026-10-26T11:00:00Z'), true);
  assert.strictEqual(wk(2, [0], null), false, 'one part alone');
  assert.strictEqual(wk(28, [0], null), false, 'the smoke part 0/28');
  assert.strictEqual(wk(2, [0, 1], '2026-10-19T11:00:00Z'), false, 'refreshedAt from an earlier week');
  assert.strictEqual(R.weekComplete({}), false);
});

console.log(`\nTEN-449 set-repairs refresh: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
