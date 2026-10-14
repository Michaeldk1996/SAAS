// F5 (founder ruling 2026-10-14): every best-effort pipeline step (`|| true`) is followed by a check that reports the
// swallowed exit code and a missing / stale output. Locks the checker and the wiring on pipeline.yml.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkStep } from './step-check.mjs';
let pass = 0; const ok = (c, m) => { assert.ok(c, m); pass++; };
const st = (map) => (f) => { if (!(f in map)) throw new Error('ENOENT'); return { isFile: () => true, size: map[f].size ?? 10, mtimeMs: map[f].t * 1000 }; };
ok(checkStep({ step: 's', rc: '0', since: 100, fresh: ['a.json'] }, st({ 'a.json': { t: 105 } })).ok, 'clean run passes');
ok(!checkStep({ step: 's', rc: '1', since: 100, fresh: ['a.json'] }, st({ 'a.json': { t: 105 } })).ok, 'a swallowed non-zero exit is reported');
ok(!checkStep({ step: 's', rc: '0', since: 100, fresh: ['a.json'] }, st({ 'a.json': { t: 50 } })).ok, 'an output not rewritten by the step is reported');
ok(!checkStep({ step: 's', rc: '0', since: 100, exists: ['b.json'] }, st({})).ok, 'a missing output is reported');
ok(!checkStep({ step: 's', rc: '0', since: 100, exists: ['b.json'] }, st({ 'b.json': { t: 105, size: 0 } })).ok, 'an empty output is reported');
ok(checkStep({ step: 's', rc: '0', since: 100, exists: ['b.json'] }, st({ 'b.json': { t: 50 } })).ok, 'an exists-only output may be older (the step may legitimately not rewrite it)');
const yml = readFileSync(new URL('../.github/workflows/pipeline.yml', import.meta.url), 'utf8');
ok(!/^\s*run: node [^\n]*\|\| true\s*$/m.test(yml), 'no best-effort node step left without its check');
const checks = (yml.match(/node tools\/step-check\.mjs --step "/g) || []).length;
ok(checks >= 14, `every best-effort step is checked (${checks})`);
ok(/node build-match-closes\.js \|\| rc=\$\?\n\s*node tools\/step-check\.mjs --step "[^"]+" --rc "\$rc" --since "\$t0" --fresh match-closes-index\.json/.test(yml), 'match-closes is checked for a fresh index');
ok(/node build-captured-pinnacle\.js \|\| rc=\$\?\n\s*node tools\/step-check\.mjs[^\n]*--exists captured-closes-pinnacle\.json/.test(yml), "captured Pinnacle is checked (exists: the builder skips an unchanged write)");
console.log(`test-f5-step-check: ${pass} checks passed`);
