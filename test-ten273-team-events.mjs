// TEN-273 ruling 2026-09-25 ("do as the ATP"): team events count in H2H exactly as
// in the ATP's official win-loss record. Drives the pipeline's real filter and the
// dashboard's real constant (read from the shipped HTML, executed, not pattern-matched).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

process.env.DOTENV_CONFIG_QUIET = 'true';
const require = createRequire(import.meta.url);
const P = require('./bsp-pipeline.js');
const html = fs.readFileSync(new URL('./bsp-consult-dashboard.html', import.meta.url), 'utf8');
const line = html.split('\n').find((l) => l.startsWith('const FH_H2H_NOT_ATP_RECORD'));
const FH = new Function(`${line}; return FH_H2H_NOT_ATP_RECORD;`)();

const COUNT = ['ATP Davis Cup - World Group', 'ATP Cup', 'ATP United Cup', 'ATP Laver Cup', 'Olympic Games', 'Next Gen Finals - Jeddah'];
const EXCLUDE = ['ATP Hopman Cup', ' Hopman Cup (World), Clay', 'UTS Guadalajara', 'Ultimate Tennis Showdown', 'Six Kings Slam', 'Kooyong Classic', 'Mubadala World Tennis Championship', 'Exhibition Riyadh'];

test('pipeline: events the ATP counts stay in; Hopman Cup and exhibitions go', () => {
  for (const t of COUNT) assert.equal(P.h2hCountsInAtpRecord({ tournament_name: t }), true, t);
  for (const t of EXCLUDE) assert.equal(P.h2hCountsInAtpRecord({ tournament_name: t }), false, t);
});

test('ordinary tournaments are untouched (no false exclusions)', () => {
  for (const t of ['ATP Miami', 'Challenger Houston', 'M15 Kingston', 'ATP Utsunomiya', 'ATP Stuttgart', 'Wimbledon']) {
    assert.equal(P.h2hCountsInAtpRecord({ tournament_name: t }), true, t);
    assert.equal(FH.test(t), false, t);
  }
});

test('dashboard join uses the identical list', () => {
  assert.equal(FH.source, P.H2H_NOT_ATP_RECORD.source);
  assert.equal(FH.flags, P.H2H_NOT_ATP_RECORD.flags);
  for (const t of EXCLUDE) assert.equal(FH.test(t), true, t);
});

// ── The call sites, driven for real (review 2026-09-25: the checks above pass even
//    with every call site removed) ────────────────────────────────────────────
const fx = (key, name, type, winner = 'First Player') => ({ event_key: key, tournament_name: name, event_type_type: type,
  first_player_key: 1, second_player_key: 2, event_winner: winner, event_date: '2025-01-01', event_final_result: '2 - 0', scores: [] });

test('fetchH2H: a Hopman Cup meeting from get_H2H or from the fixtures top-up never enters the list', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async (u) => {
    const url = String(u);
    const body = /get_H2H/.test(url)
      ? { success: 1, result: { H2H: [fx(11, 'ATP Hopman Cup', 'Atp Singles'), fx(12, 'ATP Laver Cup', 'Atp Singles'), fx(13, 'Six Kings Slam', 'Exhibition Men')] } }
      : { success: 1, result: [fx(21, ' Hopman Cup (World), Clay', 'Atp Singles'), fx(22, 'ATP United Cup', 'Atp Singles')] };
    return { ok: true, json: async () => body };
  };
  try {
    const out = await P.fetchH2H(1, 2);
    const keys = (out.headToHead || []).map((m) => m.event_key).sort((a, b) => a - b);
    assert.deepEqual(keys, [12, 22], `kept ${JSON.stringify(keys)}`);
  } finally { globalThis.fetch = saved; }
});

test('dashboard career-history join: a shared Hopman Cup eventKey is not a meeting; a Laver Cup one is', () => {
  const grab = (name) => {
    const i = html.indexOf(`function ${name}(`);
    assert.ok(i >= 0, `${name} not found in the dashboard`);
    let depth = 0, j = html.indexOf('{', i);
    for (; j < html.length; j++) { if (html[j] === '{') depth++; else if (html[j] === '}' && --depth === 0) break; }
    return html.slice(i, j + 1);
  };
  const consts = html.split('\n').filter((l) => /^const (FH_H2H_LEVELS|FH_H2H_NOT_ATP_RECORD) =/.test(l)).join('\n');
  const run = new Function('fhMeetingList', 'eventKeyOfMatch', `${consts}\n${grab('fhLevelOf')}\n${grab('fhAllMeetingRows')}\nreturn fhAllMeetingRows;`)(() => [], () => '999');
  const row = (ek, t, won) => ({ eventKey: ek, date: '2025-01-03', won, tournament: t, level: 'atp' });
  const m = { _fhCh: [[row(31, 'ATP Hopman Cup', true), row(32, 'ATP Laver Cup', true)], [row(31, 'ATP Hopman Cup', false), row(32, 'ATP Laver Cup', false)]] };
  const out = run(m);
  assert.deepEqual(out.map((x) => x.eventKey), [32]);
});
