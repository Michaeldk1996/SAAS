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

// --- rule 4 (founder 2026-10-22, containment): an AMBIGUOUS name takes a row only on the key's own match --------------
// ambiguous-archive-names.json.gz: Tennis Abstract players per surname|first-initial, and their matches [yyyymmdd, i, opp]
const zlib = require('zlib');
const ambDoc = (matches) => ({ v: 2, names: { 'martin|a': ['Alberto Martin', 'Andrej Martin', 'Andres Martin'], 'hernandez|a': ['Alejandro Hernandez', 'Alex Hernandez'] },
  players: ['Alberto Martin', 'Andrej Martin', 'Andres Martin', 'Alex Hernandez'], matches });
const writeAmb = (m) => fs.writeFileSync(path.join(tmp, 'ambiguous-archive-names.json.gz'), zlib.gzipSync(JSON.stringify(ambDoc(m))));
fs.writeFileSync(path.join(tmp, 'player-index.json'), JSON.stringify({ players: [{ key: '1056', name: 'Andres Martin' }, { key: '1307', name: 'A. Hernandez' }] }));
sh('1307', 'HX01', [R('2022-02-23', 'P. Andujar', { oppKey: '33998' })]);
roster.set('1307', 'A. Hernandez');
writeAmb({ 'martin|a': [], 'hernandez|a': [] });
let g4 = buildIdentityGate(tmp, roster);
ok(g4.allow('1056', 'Martin A.', '2024-07-24', 'Shang J.'), 'ambiguous name, his OWN match that day against that opponent → kept');
ok(!g4.allow('1056', 'Martin A.', '2024-07-30', 'Shang J.'), 'no own match within ±3 days → a dash ("identity unverified")');
ok(!g4.allow('1056', 'Martin A.', '2024-07-24', 'Fritz T.'), 'an own match that day, but against another opponent → a dash');
ok(g4.allow('1056', 'Martin A.', '2024-07-30'), 'no opponent passed (a caller outside the Tennis-Data builders): rule 4 does not apply');
g4.allow('1056', 'Martin A.', '2024-07-30', 'Shang J.');
ok(g4.hidden('1056') === 2 && g4.stats.byKey['1056'].unverified === 3, 'hidden() counts each dashed ROW once (a builder may ask twice); the stats count every refusal');
ok(g4.allow('438', 'Mannarino A.', '2022-07-28', 'Martin A.'), 'a name nobody else fits is not ambiguous → no own-match check');
// the Tennis Abstract veto: our own store holds a match that TML gives to a namesake with a different first name
writeAmb({ 'martin|a': [[20220725, 1, 'adrianmannarino']], 'hernandez|a': [[20220221, 3, 'pabloandujar']] });
g4 = buildIdentityGate(tmp, roster);
ok(!g4.allow('1056', 'Martin A.', '2022-07-28', 'Mannarino A.'), 'TML says Andrej played that week\'s match against Mannarino → vetoed, even though our store files it under 1056');
writeAmb({ 'martin|a': [[20220725, 1, 'adrianmannarino'], [20220725, 2, 'adrianmannarino']], 'hernandez|a': [[20220221, 3, 'pabloandujar']] });
g4 = buildIdentityGate(tmp, roster);
ok(g4.allow('1056', 'Martin A.', '2022-07-28', 'Mannarino A.'), '...but when TML also has Andres against him that week (Vesely beat both Zhangs in Shenzhen 2015), no veto');
ok(g4.allow('1307', 'Hernandez A.', '2022-02-23', 'Andujar P.'), 'an abbreviated name ("A. Hernandez") is never vetoed on a first name it cannot compare; his own match keeps the row');
// mutant: rule 4 switched off → the unverified row comes back (the check above is not vacuous)
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'td-identity.js'), 'utf8');
  const anchor = '    if (opp) {\n      const ambiguous';
  ok(src.split(anchor).length === 2, 'mutant anchor found once');
  const mf = path.join(__dirname, '..', '.td-identity-mutant.js');
  fs.writeFileSync(mf, src.replace(anchor, '    if (false) {\n      const ambiguous'));
  try { const gm = require(mf).buildIdentityGate(tmp, roster); ok(gm.allow('1056', 'Martin A.', '2024-07-30', 'Shang J.'), 'mutant (rule 4 off) keeps the unverified row — the real gate dashes it'); }
  finally { fs.rmSync(mf, { force: true }); }
}
fs.rmSync(path.join(tmp, 'ambiguous-archive-names.json.gz')); fs.rmSync(path.join(tmp, 'player-index.json'));
fs.rmSync(path.join(tmp, 'career-history', '1307.json')); roster.delete('1307');

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
const anchor = 'return k && gate && date && !gate.allow(k, name, date, opp) ? null : k;';
ok(src.split(anchor).length === 2, 'the mutant anchor is found exactly once');
const mp = path.join(__dirname, '..', '.mutant-match-closes.js');
fs.writeFileSync(mp, src.replace(anchor, 'return k;'));
let red = false;
try { const out2 = fs.mkdtempSync(path.join(tmp, 'mc2-')); require(mp).build(tmp, out2, path.join(out2, 'index.json')); red = beforeCareerRows(out2, g).length > 0; }
finally { fs.unlinkSync(mp); }
ok(red, 'MUTANT (the identity gate removed) hands Alberto and Andrej to key 1056 and the store check goes red');

// rule 4 through the real closes builder: an ambiguous name's unverified row is dropped and its shard says how many
{
  writeAmb({ 'martin|a': [] });
  fs.writeFileSync(path.join(tmp, 'player-index.json'), JSON.stringify({ players: [{ key: '1056', name: 'Andres Martin' }] }));
  fs.writeFileSync(path.join(tmp, 'odds-archive', '2024.csv'), [H, L('2024-07-24', 'Atlanta Open', 'Martin A.', 'Shang J.'), L('2024-08-12', 'Cincinnati', 'Martin A.', 'Fritz T.')].join('\n') + '\n');
  const out4 = fs.mkdtempSync(path.join(tmp, 'mc4-'));
  require('../build-match-closes.js').build(tmp, out4, path.join(out4, 'index.json'));
  const s1056 = JSON.parse(fs.readFileSync(path.join(out4, '1056.json'), 'utf8'));
  const dates = s1056.rows.map((r) => r[0]);
  ok(dates.includes('2024-07-24') && !dates.includes('2024-08-12'), 'closes builder: the verified 2024-07-24 row stays, the unverified 2024-08-12 row is dropped');
  ok(s1056.identityHidden === 1, `closes shard says 1 row hidden: identity unverified (got ${s1056.identityHidden})`);
  fs.rmSync(path.join(tmp, 'odds-archive', '2024.csv'));
}

// wiring: every Tennis-Data builder passes the row's opponent and publishes identityHidden; the pages say the count
{
  const rd = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  ok(/resolveAt\(b\.name, row\.date, b\.opp\)/.test(rd('build-market-edge.js')) && /out\.identityHidden = idGate && idGate\.hidden/.test(rd('build-market-edge.js')), 'market edge: passes the opponent, publishes identityHidden');
  ok(/td\.archive\(r\.winner, r\.date, r\.loser\), kl = td\.archive\(r\.loser, r\.date, r\.winner\)/.test(rd('build-match-closes.js')) && /identityHidden: idGate && idGate\.hidden/.test(rd('build-match-closes.js')), 'match closes: passes the opponent, publishes identityHidden');
  ok(/idGate\.allow\(hit0\.key, side\.name, row\.date, side\.name === row\.winner \? row\.loser : row\.winner\)/.test(rd('build-odds-performance.js')) && /shard\.identityHidden = idGate && idGate\.hidden/.test(rd('build-odds-performance.js')), 'odds performance: passes the opponent, publishes identityHidden');
  ok(/' hidden: identity unverified'/.test(rd('player-profile-v2.js')) && /mk\.identityHidden > 0/.test(rd('player-profile-v2.js')), 'profile Market edge line says "N rows hidden: identity unverified"');
  const h = rd('bsp-consult-dashboard.html');
  ok(/rows\.idHidden = \(ms && ms\.identityHidden\) \|\| 0;/.test(h) && /class="me-id-hidden"/.test(h) && /hidden: identity unverified` : ''\]\.filter\(Boolean\)\.join\(' · '\)/.test(h), 'Market edge tab: the section line and the band pop-up say the count');
  ok(fs.existsSync(path.join(__dirname, '..', 'ambiguous-archive-names.json.gz')), 'the ambiguous-names evidence is committed (the gate reads it with no TML at run time)');
}

if (process.env.KEEP) console.log(tmp); else fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\ntest-td-identity: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
