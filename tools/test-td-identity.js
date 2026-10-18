#!/usr/bin/env node
// Founder ruling 2026-10-18 (the Martín mix-up): a Tennis-Data name ("Martin A.") joins a player only when exactly ONE
// player in our store with that name is active on the row's date, and never before his career began. Fixtures model the
// real case: Alberto Martín (2002–10, Tennis Abstract only), Andrej Martin (key 101792, 2010–21, no profile) and Andrés
// Martín (key 1056, from 2021). Runs the gate itself, then the real closes builder on the fixtures (the store check: no key
// holds a row from before his career), then the same build with the gate removed — it must go red (the mutant).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildIdentityGate, CAREER_SLACK_DAYS } = require('../td-identity.js');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  PASS  ' + m); } else { fail++; console.log('  FAIL  ' + m); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'td-identity-'));
fs.mkdirSync(path.join(tmp, 'career-history')); fs.mkdirSync(path.join(tmp, 'odds-archive'));
const sh = (k, id, rows) => fs.writeFileSync(path.join(tmp, 'career-history', `${k}.json`), JSON.stringify({ v: 1, key: k, id, matches: rows }));
const R = (date, opponent, extra) => Object.assign({ date, opponent, won: true, sets: [{ p: 6, o: 4 }] }, extra || {});
// Andrés Martín: own rows from 2021-02-01
sh('1056', 'M0NP', [R('2022-07-28', 'A. Mannarino', { oppKey: '438' }), R('2024-07-24', 'J. Shang', { oppKey: '2413' }), R('2021-02-01', 'S. Kwon')]);
// Andrej Martin: own rows 2010-10 → 2021-06, Tennis Abstract id MF35, no profile
sh('101792', 'MF35', [R('2010-10-25', 'X. Ex'), R('2016-07-18', 'F. Fognini', { oppId: 'F999' }), R('2021-06-01', 'R. Opelka')]);
// observers: Fognini sees Andrej (MF35) in 2016 and Alberto (tml M590) in 2006; Mannarino sees Andrés (1056) in 2022
sh('1091', 'F999', [R('2016-07-18', 'A. Martin', { oppId: 'MF35' }), R('2006-05-01', 'A. Martin', { oppId: 'M590' })]);
sh('438', 'M438', [R('2022-07-28', 'A. Martin', { oppKey: '1056' })]);
// one person under two api-tennis keys: 1872 and 61071 share the Tennis Abstract id TG77
sh('1872', 'TG77', [R('2020-03-06', 'Y. Why'), R('2025-11-19', 'Z. Zed')]);
sh('61071', 'TG77', [R('2020-03-06', 'Y. Why')]);
// a key seen only as an opponent, on the same matches a shard key's own rows hold (the same match filed twice)
sh('1735', 'GE33', [R('2021-07-26', 'Q. Que', { oppKey: '500' }), R('2023-03-28', 'Q. Que', { oppKey: '500' })]);
sh('500', 'Q500', [R('2021-07-26', 'D. E. Galan', { oppKey: '34000' }), R('2023-03-28', 'D. E. Galan', { oppKey: '34000' })]);
// an api-tennis duplicate key seen only as an opponent, on matches the profiled key's shard lacks: never a rival
sh('2838', 'N0AE', [R('2020-02-17', 'K. Kay'), R('2025-01-01', 'K. Kay')]);
sh('700', 'X700', [R('2023-09-18', 'B. N. Nakashima', { oppKey: '1249' })]);
// two players with one initial, as Zhizhen and Ze Zhang (an invented surname: the real "Zhang Z." is in the hand-checked
// alias table): 590 has his own shard, the other is a Tennis Abstract identity only; Tennis-Data writes "Kowa Ka." for 590
sh('590', 'Z371', [R('2015-09-28', 'G. Soeda'), R('2026-10-07', 'X. Ex')]);
sh('701', 'X701', [R('2016-04-01', 'K. Kowa', { oppId: 'Z272' }), R('2018-04-01', 'K. Kowa', { oppId: 'Z272' })]);
// a Tennis Abstract id a few rows give to another player: "M. Huesler" once under Millman's id
sh('1746', 'H123', [R('2018-01-01', 'Q. Que'), R('2026-01-01', 'Q. Que')]);
sh('702', 'X702', [R('2017-01-01', 'J. Millman', { oppId: 'MH30' }), R('2018-02-01', 'J. Millman', { oppId: 'MH30' }), R('2019-03-01', 'J. Millman', { oppId: 'MH30' }),
  R('2019-06-01', 'J. Millman', { oppId: 'MH30' }), R('2018-07-24', 'M. Huesler', { oppId: 'MH30' })]);
const roster = new Map([['2838', 'B. Nakashima'], ['590', 'K. Kowa'], ['1746', 'M. Huesler'], ['1056', 'A. Martin'], ['1872', 'P. Tsitsipas'], ['1735', 'D. Elahi Galan'], ['1091', 'F. Fognini'], ['438', 'A. Mannarino']]);
fs.writeFileSync(path.join(tmp, 'player-profiles.json'), JSON.stringify({ players: Object.fromEntries([...roster].map(([k, n]) => [k, { name: n }])) }));

const g = buildIdentityGate(tmp, roster);
ok(!!g, 'the gate builds from the career-history store');
ok(g.careerStart('1056') === '2021-02-01', 'key 1056\'s career begins 2021-02-01 (his first match in the store)');
ok(!g.allow('1056', 'Martin A.', '2006-05-01'), 'Alberto Martín 2006 never joins 1056 (before his career)');
ok(!g.allow('1056', 'Martin A.', '2016-07-24'), 'Andrej Martin 2016 never joins 1056 (before his career)');
ok(!g.allow('1056', 'Martin A.', '2021-05-31'), '2021 with Andrej still active: two players fit → a dash');
ok(g.allow('1056', 'Martin A.', '2024-07-24'), '2024, Andrej long gone: exactly one player active → 1056');
ok(g.allow('1735', 'Galan D.E.', '2021-07-01') && !g.allow('1735', 'Galan D.E.', '2021-06-01'), `the career start has a ${CAREER_SLACK_DAYS}-day slack (an archive row is dated at its event's start)`);
ok(g.allow('1872', 'Tsitsipas P.', '2023-05-01'), 'two keys with one Tennis Abstract id are one person, never a dash');
ok(g.merged['34000'] === '1735', 'an opponent-only key whose every match is a 1735 match is the same person');
ok(g.allow('1735', 'Galan D.E.', '2022-05-01'), 'so D. E. Galan is never a second candidate for Elahi Galan');
ok(g.allow('2838', 'Nakashima B.', '2023-09-20'), 'an api-tennis key seen only as an opponent (no shard, no Tennis Abstract id) is never a rival');
ok(g.allow('590', 'Kowa Ka.', '2017-01-01'), 'a longer abbreviation ("Kowa Ka.", as "Zhang Zh.") never fits a rival known only by the initial');
ok(!g.allow('590', 'Kowa K.', '2017-01-01'), '...but the bare "Kowa K." with the other player active is a dash');
ok(g.allow('1746', 'Huesler M.A.', '2018-07-26'), 'a name a Tennis Abstract id carries in under a quarter of its rows is not that identity\'s name');
ok(g.allow('99999', 'Nobody N.', '2020-01-01'), 'a key the store does not hold passes (nothing to check against)');
ok(g.stats.byKey['1056'] && g.stats.byKey['1056'].beforeCareer === 2 && g.stats.byKey['1056'].otherActive === 1, 'the gate counts each refusal by key and cause');

// --- the closes builder on fixtures: the store check ---------------------------------------------------------------
const H = 'date,tournament,series,court,surface,round,bestof,winner,loser,wrank,lrank,comment,b365w,b365l,psw,psl,maxw,maxl,avgw,avgl,avgsrc';
const L = (d, t, w, l) => [d, t, 'ATP250', 'Outdoor', 'Clay', '1st Round', 3, w, l, 10, 20, 'Completed', 1.5, 2.6, 1.5, 2.6, 1.6, 2.7, 1.5, 2.6, 'file'].join(',');
fs.writeFileSync(path.join(tmp, 'odds-archive', '2016.csv'), [H, L('2016-07-18', 'Croatia Open', 'Fognini F.', 'Martin A.')].join('\n') + '\n');
fs.writeFileSync(path.join(tmp, 'odds-archive', '2006.csv'), [H, L('2006-05-01', 'Estoril Open', 'Martin A.', 'Fognini F.')].join('\n') + '\n');
fs.writeFileSync(path.join(tmp, 'odds-archive', '2022.csv'), [H, L('2022-07-28', 'Atlanta Open', 'Mannarino A.', 'Martin A.')].join('\n') + '\n');
// store check: every row a key holds is dated no earlier than his career start − slack
function beforeCareerRows(outDir, gate) {
  const bad = [];
  for (const f of fs.readdirSync(outDir)) {
    const m = /^(\d+)\.json$/.exec(f); if (!m) continue;
    const start = gate.careerStart(m[1]); if (!start) continue;
    const lim = Date.parse(start) / 864e5 - CAREER_SLACK_DAYS;
    JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8')).rows.forEach((r) => { if (Date.parse(r[0]) / 864e5 < lim) bad.push(`${m[1]} ${r[0]} v ${r[1]}`); });
  }
  return bad;
}
const mc = require('../build-match-closes.js');
const out1 = fs.mkdtempSync(path.join(tmp, 'mc-'));
mc.build(tmp, out1, path.join(out1, 'index.json'));
const bad1 = beforeCareerRows(out1, g);
ok(bad1.length === 0, `no player holds a row from before his career began (got ${bad1.join('; ') || 'none'})`);
const r1056 = JSON.parse(fs.readFileSync(path.join(out1, '1056.json'), 'utf8')).rows;
ok(r1056.length === 1 && r1056[0][0] === '2022-07-28', 'key 1056 keeps only his own Atlanta 2022 match');
const idx = JSON.parse(fs.readFileSync(path.join(out1, 'index.json'), 'utf8'));
ok(idx.identityGate && idx.identityGate.byKey['1056'].beforeCareer === 2, 'the closes index reports the gate\'s refusals');

// --- mutant: the gate removed → the store check goes red ------------------------------------------------------------
const src = fs.readFileSync(path.join(__dirname, '..', 'build-match-closes.js'), 'utf8');
const anchor = 'return k && gate && date && !gate.allow(k, name, date) ? null : k;';
ok(src.split(anchor).length === 2, 'the mutant anchor is found exactly once');
const mp = path.join(__dirname, '..', '.mutant-match-closes.js');
fs.writeFileSync(mp, src.replace(anchor, 'return k;'));
let red = false;
try { const out2 = fs.mkdtempSync(path.join(tmp, 'mc2-')); require(mp).build(tmp, out2, path.join(out2, 'index.json')); red = beforeCareerRows(out2, g).length > 0; }
finally { fs.unlinkSync(mp); }
ok(red, 'MUTANT (the identity gate removed) hands Alberto and Andrej to key 1056 and the store check goes red');

if (process.env.KEEP) console.log(tmp); else fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\ntest-td-identity: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
