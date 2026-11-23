// tokens.css structure (2026-11-23): a merge once dropped the closing brace of the Dropping Odds token block, nesting the
// Match analysis :root block inside it (CSS nesting reads it as ":root :root", which matches nothing), and every --ma2-*
// colour went unset on the live site while every other suite stayed green. The check: every rule block in tokens.css sits at
// the top level, and every --ma2-* token match-analysis-v2.css / .js reads is declared in a top-level block.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const root = new URL('../', import.meta.url);
const read = f => readFileSync(new URL(f, root), 'utf8');

function topLevelDecls(css) {
  const s = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0, maxDepth = 0, cur = '';
  const decls = new Set();
  for (const c of s) {
    if (c === '{') { depth++; maxDepth = Math.max(maxDepth, depth); cur = ''; continue; }
    if (c === '}') { if (depth === 1) for (const m of cur.matchAll(/(--[\w-]+)\s*:/g)) decls.add(m[1]); depth--; cur = ''; continue; }
    if (depth === 1) cur += c;
    if (depth === 1 && c === ';') { for (const m of cur.matchAll(/(--[\w-]+)\s*:/g)) decls.add(m[1]); cur = ''; }
  }
  return { depth, maxDepth, decls };
}
function check(css) {
  const t = topLevelDecls(css);
  assert.equal(t.depth, 0, 'tokens.css braces balance');
  assert.equal(t.maxDepth, 1, 'every block in tokens.css is top-level (a nested block is a lost closing brace)');
  const used = new Set();
  for (const f of ['match-analysis-v2.css', 'match-analysis-v2.js']) for (const m of read(f).matchAll(/var\((--ma2-[\w-]+)/g)) used.add(m[1]);
  const missing = [...used].filter(v => !t.decls.has(v));
  assert.deepEqual(missing, [], 'every --ma2-* token the box reads is declared at the top level of tokens.css');
  return used.size;
}
const css = read('tokens.css');
const n = check(css);
console.log(`  ok  tokens.css: all blocks top-level; ${n} --ma2-* tokens used by the box, all declared`);
// control: the 2026-11-23 merge (the closing brace before the Match analysis block removed) must fail
const i = css.indexOf('/* Match analysis rebuild');
const mut = css.slice(0, css.lastIndexOf('}', i)) + css.slice(css.lastIndexOf('}', i) + 1);
let caught = false; try { check(mut); } catch (e) { caught = e instanceof assert.AssertionError; }
assert.ok(caught, 'control: a lost closing brace before the --ma2 block is caught');
console.log('  ok  control: the lost-brace mutant is caught');
