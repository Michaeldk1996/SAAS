// Stage 3 (2026-11-03): the page reads card prices from public.card_state_doc and falls back to odds-card-state.json,
// always showing the NEWER of the two. Slices the shipped functions and runs them; mutants must turn it red.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const html = readFileSync(new URL('../bsp-consult-dashboard.html', import.meta.url), 'utf8');
const slice = (n, src = html) => { const i = src.indexOf(`function ${n}(`); assert.ok(i > 0, n); let d = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; } return src.slice(i, j + 1); };
let pass = 0, fail = 0;
const check = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + ' :: ' + e.message); } };
const build = (src = html) => new Function(`${slice('ocsPickNewer', src)} return ocsPickNewer;`)();
function suite(pick) {
  const db = { generatedAt: '2026-11-03T10:00:00Z' }, old = { generatedAt: '2026-11-03T09:00:00Z' }, newer = { generatedAt: '2026-11-03T10:30:00Z' };
  assert.equal(pick(db, old).source, 'db', 'db newer → db');
  assert.equal(pick(db, newer).source, 'file', 'file newer → file');
  assert.equal(pick(db, null).source, 'db', 'db only');
  assert.equal(pick(null, old).source, 'file', 'file only');
  assert.equal(pick(null, null), null, 'neither → null');
  assert.equal(pick(db, { generatedAt: db.generatedAt }).source, 'db', 'a tie → db');
}
check('the page shows the newer of card_state_doc and the file (db on a tie; null when neither)', () => suite(build()));
check('loadOddsCardState reads the database first and the file only when the db is missing or stale', () => {
  const f = slice('loadOddsCardState');
  assert.ok(/await ocsFetchDb\(\)/.test(f) && /OCS_DB_STALE_MS/.test(f) && /ocsPickNewer\(db, file\)/.test(f) && /OCS\.source = pick\.source/.test(f));
  assert.ok(/card_state_doc\?id=eq\.1&select=doc/.test(slice('ocsFetchDb')), 'reads card_state_doc');
  assert.ok(/__SUPABASE/.test(slice('ocsFetchDb')), 'a page without the injected config skips the database');
});
check('MUTANT caught: always the database, never the newer file', () => {
  const mut = html.replace("if (db && !(t(file) > t(db))) return { doc: db, source: 'db' };", "if (db) return { doc: db, source: 'db' };");
  assert.notEqual(mut, html); assert.throws(() => suite(build(mut)));
});
console.log(`\ntest-ocs-db: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
