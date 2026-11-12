#!/usr/bin/env node
// mto-matches.json builder, run on the three REAL medical timeouts of 11 Nov 2026 (tools/fixtures/mto/export-sample.json).
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url'; import { shape } from './build-mto-matches.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0; const check = (n, ok, d) => { if (ok) pass++; else { fail++; console.log('  FAIL ', n, d === undefined ? '' : JSON.stringify(d).slice(0, 400)); } };
const FX = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures/mto/export-sample.json'), 'utf8')).export;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mtom-')), src = path.join(tmp, 'in.json'), out = path.join(tmp, 'mto-matches.json');
const run = (input) => { fs.writeFileSync(src, typeof input === 'string' ? input : JSON.stringify(input));
  return spawnSync(process.execPath, [path.join(HERE, 'build-mto-matches.mjs')], { env: { ...process.env, MTO_EXPORT_FILE: src, MTO_MATCHES_OUT: out }, encoding: 'utf8' }); };
let r = run(FX); const doc = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;
check('written, exit 0', r.status === 0 && doc, r.stderr);
check('3 medical timeouts on 2 matches', doc && doc.count === 3 && doc.matchCount === 2, doc && [doc.count, doc.matchCount]);
const ruud = doc && doc.matches['12178945'];
check('Shevchenko v Ruud: both timeouts, in order, who called it and the score at the call',
  ruud && ruud.length === 2 && ruud[0].player === 'Casper Ruud' && JSON.stringify(ruud[0].games) === '[[6],[5]]' && ruud[0].server === 'Alexander Shevchenko'
  && JSON.stringify(ruud[1].games) === '[[6,0],[7,0]]' && ruud[1].durationSeconds === 249, ruud);
check('Humbert v Gojo: Gojo at 2-5, Humbert serving', doc && doc.matches['12178519'][0].player === 'Borna Gojo' && doc.matches['12178519'][0].serverSide === 1, doc && doc.matches['12178519']);
check('no source is named anywhere in the public file', doc && !/source|live tennis/i.test(JSON.stringify(doc)));
const withSrc = shape({ 12178519: [{ ...FX['12178519'][0], source: 'Live Tennis API' }] });
check('a source field in the export is dropped', !/source|live tennis/i.test(JSON.stringify(withSrc)), withSrc);
check('a match with no medical timeout is absent, never an empty entry', !('1' in shape({ 1: [], ...FX }).matches) && shape({}).count === 0);
check('a value the archive does not hold is null, never a default', shape({ 5: [{ calledAt: '2026-11-11T10:00:00Z' }] }).matches['5'][0].player === null && shape({ 5: [{ calledAt: 'x' }] }).matches['5'][0].games === null);
fs.rmSync(out, { force: true });
for (const [name, bad] of [['not JSON', '<html>502</html>'], ['an error object as a list', '[{"message":"x"}]'], ['a non-numeric match id', { abc: [] }]]) {
  r = run(bad); check(`a failed read (${name}) exits 1 and writes no file`, r.status === 1 && !fs.existsSync(out), [r.status, fs.existsSync(out)]);
}
fs.writeFileSync(out, 'KEEP'); r = run('nope'); check('…and leaves an existing file as it was', r.status === 1 && fs.readFileSync(out, 'utf8') === 'KEEP');
const wf = fs.readFileSync(path.join(HERE, '..', '.github/workflows/pipeline.yml'), 'utf8');
check('pipeline builds it and copies it into the site', wf.includes('node tools/build-mto-matches.mjs') && /cp mto-matches\.json _site\//.test(wf));
check('matches.json is not written by the builder', !/matches\.json'/.test(fs.readFileSync(path.join(HERE, 'build-mto-matches.mjs'), 'utf8').replace(/mto-matches\.json/g, '')));
// the install's read-back must see every job the install schedules (12 Nov 2026: it listed 2 of 3 and went red)
const bot = fs.readFileSync(path.join(HERE, '..', '.github/workflows/mto-bot.yml'), 'utf8'), sqlSrc = fs.readFileSync(path.join(HERE, 'mto-bot.sql'), 'utf8');
const jobs = [...bot.matchAll(/cron\.schedule\('([a-z-]+)'/g)].map(m => m[1]);
const listed = (sqlSrc.match(/from cron\.job where jobname in \(([^)]*)\)/) || [])[1] || '';
check('the read-back lists every scheduled job, and the install expects that many', jobs.length === 3 && jobs.every(j => listed.includes(`'${j}'`))
  && bot.includes(`!= ${jobs.length}: bad.append`) && jobs.every(j => bot.split("cron.unschedule")[1].includes(`'${j}'`)), [jobs, listed]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\ntest-mto-matches: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
