#!/usr/bin/env node
// picks-delete.mjs guard: a pick is deleted only when one of its players carries the named surname. Mutants must fail.
import { readFileSync } from 'node:fs';
import { matches, parseTargets, surnameOf } from './picks-delete.mjs';

let fail = 0;
const ok = (name, c) => { if (!c) { fail++; console.log('  FAIL', name); } else console.log('  PASS', name); };
const doc = { player_a: { name: 'B. Vacherot' }, player_b: { name: 'A. Michelsen' } };
ok('matches the picked or the other player by surname', matches(doc, 'Michelsen') && matches(doc, 'vacherot'));
ok('refuses another surname (Hanfmann is never taken by a wrong id)', !matches(doc, 'Hanfmann'));
ok('refuses an empty surname or a missing doc', !matches(doc, '') && !matches(null, 'Michelsen'));
ok('a compound surname is the whole tail', surnameOf('A. Davidovich Fokina') === 'Davidovich Fokina');
ok('an outright (no player b) still matches its player', matches({ player_a: { name: 'J. Sinner' }, player_b: null }, 'Sinner'));
ok('targets parse id:Surname and skip flags', JSON.stringify(parseTargets(['abc:Fils', '--apply'])) === JSON.stringify([{ id: 'abc', surname: 'Fils' }]));
// mutant: a guard that ignores the surname would delete any id
const src = readFileSync(new URL('./picks-delete.mjs', import.meta.url), 'utf8');
const mut = src.replace("surnameOf(p.name).toLowerCase() === want", 'true');
ok('MUTANT differs from the source', mut !== src);
const guard = mut.slice(mut.indexOf('export function surnameOf'), mut.indexOf('export function parseTargets')).replace(/export /g, '');
const M = new Function(guard + '; return matches;')();
ok('MUTANT caught: the surname-blind guard would take Hanfmann', M(doc, 'Hanfmann') === true);
console.log(`picks-delete: ${fail ? 'FAIL' : 'all pass'}`);
console.log(`EXIT=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
