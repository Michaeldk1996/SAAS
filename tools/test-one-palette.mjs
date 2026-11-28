// One palette (founder ruling 2026-11-28): the app's meaning colours and greys are one set on every page.
//   green #3DD68C · red #E0616F · blue (links) #5B9BFF · soft text #DDE0EA · label grey #A3AABE
// Before that day the foundation tokens and the page-local "export" tokens (--pp-x-*, --tt-*, --h2h-*, --db2-*, --sm-*,
// --news-*, --do2-*, --ma2-*) held two slightly different sets. This check keeps them from drifting apart again:
//   1. the five foundation tokens hold the unified values;
//   2. no token in tokens.css holds one of the five retired values (the court-surface colour --viz-grass excepted).
// Control: the same check run on a copy with one retired value planted must fail (a check that cannot fail is not a check).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'tokens.css'), 'utf8');
const UNIFIED = { '--pos': '#3DD68C', '--neg': '#E0616F', '--link': '#5B9BFF', '--text-soft': '#DDE0EA', '--text-label': '#A3AABE' };
const RETIRED = ['#5CCB84', '#E06266', '#6A9AF8', '#C6CCDB', '#8B96B5'];
const ALLOWED = new Set(['--viz-grass']);   // grass courts keep their own green

function problems(css) {
  const out = [];
  const decls = [...css.matchAll(/^\s*(--[a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\b/gm)].map(m => [m[1], m[2].toUpperCase()]);
  for (const [name, want] of Object.entries(UNIFIED)) {
    const got = decls.filter(d => d[0] === name).map(d => d[1]);
    if (!got.length) out.push(`${name} is not declared`);
    else if (got.some(v => v !== want)) out.push(`${name} is ${got.join(' / ')}, not ${want}`);
  }
  for (const [name, value] of decls) if (RETIRED.includes(value) && !ALLOWED.has(name)) out.push(`${name} still holds the retired ${value}`);
  return out;
}

let failed = 0;
const check = (label, ok, detail) => { console.log(`  ${ok ? 'ok ' : 'FAIL'} ${label}${ok || !detail ? '' : ' :: ' + detail}`); if (!ok) failed++; };

const real = problems(CSS);
check('tokens.css: one palette on every page', real.length === 0, real.join('; '));
const planted = CSS.replace(/(--tt-muted:\s*)#[0-9A-Fa-f]{6}/, '$1#8B96B5');
check('control: the mutant was planted', planted !== CSS);
check('control: a page-local token back on a retired value is caught', problems(planted).some(p => p.startsWith('--tt-muted')));
const drifted = CSS.replace(/(--pos:\s*)#[0-9A-Fa-f]{6}/, '$1#5CCB84');
check('control: a foundation token off the unified value is caught', drifted !== CSS && problems(drifted).some(p => p.startsWith('--pos ')));

console.log(`\ntest-one-palette: ${4 - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
