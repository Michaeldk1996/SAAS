// TEN-225 Part 3 — the cross-language matcher assertion.
//
// `ten225_names.py` keys names for the PUBLISHER; `ocsNameKey` in
// bsp-consult-dashboard.html keys them for the RENDERER. If the two ever
// disagree about one name, the publisher writes a key no card looks up and the
// surface dashes a price we are holding — silently, and only for the names
// where they differ, which is exactly the population a spot-check misses.
//
// So the two are driven over ONE corpus and compared name by name. The corpus
// is every name shape these feeds have actually produced on this issue:
// surname-first with a comma, initial-first, multi-part surnames that
// api-tennis reorders, accents, hyphens, the Kibl rotation-number prefix.
//
// The JS is not copy-pasted here — it is sliced out of the live HTML and
// evaluated, so this test goes red if the shipped function changes and this
// file does not.
//
// Run: node --test test-ten225-ocs-key.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, 'bsp-consult-dashboard.html'), 'utf8');

// Slice the three shipped functions out of the page.
function slice(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} not found in bsp-consult-dashboard.html`);
  let depth = 0, i = html.indexOf('{', start);
  const open = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  assert.ok(i > open, `${name} braces did not balance`);
  return html.slice(start, i + 1);
}
const js = ['ocsNfd', 'ocsNameKey', 'ocsMatchKey'].map(slice).join('\n');
const { ocsNameKey, ocsMatchKey } = new Function(
  `${js}; return { ocsNameKey, ocsMatchKey };`)();

const CORPUS = [
  // oddspapi: surname first, comma.
  'Zverev, Alexander', 'Van de Zandschulp, Botic', 'Sinner, Jannik',
  'Auger-Aliassime, Felix', 'Davidovich Fokina, Alejandro',
  // api-tennis: initial first, and the full-name form of the same players.
  'A. Zverev', 'B. Van De Zandschulp', 'J. Sinner', 'F. Auger-Aliassime',
  'Alejandro Davidovich Fokina', 'Carlos Alcaraz',
  // Accents — the NFD strip has to make these equal to their plain forms.
  'Ramos-Vinolas, Albert', 'A. Ramos-Viñolas', 'Mpetshi Perricard, Giovanni',
  'Müller, Alexandre', 'A. Muller', 'Štruff, Jan-Lennard', 'J. Struff',
  // Kibl: the fixture string's halves, rotation number already stripped.
  'Dhakshineswar Suresh', 'Soonwoo Kwon',
  // Shapes that must key to NOTHING rather than to something plausible.
  '', '   ', 'X', 'A. B.', '6112', null, undefined,
  // A single token, which is all some ITF feeds give.
  'Nadal', 'Rune',
];

function pythonKeys(names) {
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(HERE)})
from ten225_names import name_key, match_key
names = json.load(sys.stdin)
print(json.dumps({
  'keys':  [name_key(n) for n in names],
  'pairs': [match_key('2026-09-17', a, b)
            for a in names for b in names],
}))`;
  return JSON.parse(execFileSync('python3', ['-B', '-c', script], {
    input: JSON.stringify(CORPUS), encoding: 'utf8',
  }));
}

test('name_key agrees across Python and the shipped JS, name by name', () => {
  const py = pythonKeys(CORPUS);
  const disagreements = [];
  CORPUS.forEach((n, i) => {
    const a = py.keys[i], b = ocsNameKey(n);
    if ((a ?? null) !== (b ?? null)) disagreements.push({ name: n, python: a, js: b });
  });
  assert.deepEqual(disagreements, [], JSON.stringify(disagreements, null, 2));
});

test('match_key agrees over every ordered pair in the corpus', () => {
  const py = pythonKeys(CORPUS);
  const disagreements = [];
  let n = 0;
  for (const a of CORPUS) for (const b of CORPUS) {
    const p = py.pairs[n++], j = ocsMatchKey('2026-09-17', a, b);
    if ((p ?? null) !== (j ?? null)) disagreements.push({ a, b, python: p, js: j });
  }
  assert.equal(n, CORPUS.length ** 2, 'corpus and python output fell out of step');
  assert.deepEqual(disagreements, [], JSON.stringify(disagreements.slice(0, 20), null, 2));
});

// The control. Without it, both tests above pass on a pair of functions that
// return null for everything — "they agree" is not the same claim as "they
// work", and an all-null matcher agrees perfectly.
test('CONTROL: the corpus really does produce keys, and the traps really do not', () => {
  assert.equal(ocsNameKey('Zverev, Alexander'), 'zverev');
  assert.equal(ocsNameKey('A. Zverev'), 'zverev');
  assert.equal(ocsNameKey('B. Van De Zandschulp'), 'zandschulp');
  // TEN-225 ruling D (founder 2026-09-18). These two lines asserted the BUG:
  // a hyphen is not `isalpha`, so a hyphenated surname produced no token and the
  // key came back null. Both spellings now fold the hyphen to a space and reduce
  // to the same last token, which is the whole point — it is what makes the
  // accented and unaccented, comma-first and initial-first forms of one player
  // land on ONE key instead of three different answers.
  assert.equal(ocsNameKey('A. Ramos-Viñolas'), 'vinolas');
  assert.equal(ocsNameKey('Ramos-Vinolas, Albert'), 'vinolas');
  assert.equal(ocsNameKey('F. Auger-Aliassime'), 'aliassime');
  assert.equal(ocsNameKey('Auger-Aliassime, Felix'), 'aliassime');
  assert.equal(ocsNameKey('Felix Auger-Aliassime'), 'aliassime',
    'the full-name form used to key on the GIVEN name (felix) — that is the ' +
    'defect the fold actually removes, and it is the one that could mis-pair');
  // The apostrophe class, which the ruling names only by implication and which
  // no assertion covered before: "O'Connell" failed for exactly the same reason.
  assert.equal(ocsNameKey("C. O'Connell"), 'connell');
  assert.equal(ocsNameKey("O'Connell, Christopher"), 'connell');
  // A curly apostrophe and a unicode dash must not behave differently from
  // their ASCII spellings — a matcher that handles one and not the other is the
  // same bug at a different code point.
  assert.equal(ocsNameKey("C. O’Connell"), 'connell');
  assert.equal(ocsNameKey('F. Auger‑Aliassime'), 'aliassime');
  assert.equal(ocsNameKey('Alejandro Davidovich Fokina'), 'fokina');
  assert.equal(ocsNameKey('6112'), null);
  assert.equal(ocsNameKey('A. B.'), null, 'no token longer than one letter');
  const keyed = CORPUS.filter(n => ocsNameKey(n)).length;
  assert.ok(keyed >= 15, `only ${keyed} of ${CORPUS.length} corpus names keyed`);
});

test('orientation cannot leak into identity', () => {
  const a = ocsMatchKey('2026-09-17', 'Sinner, Jannik', 'C. Alcaraz');
  const b = ocsMatchKey('2026-09-17', 'C. Alcaraz', 'Sinner, Jannik');
  assert.equal(a, b);
  assert.equal(a, '2026-09-17|alcaraz|sinner');
});

test('two players who reduce to one surname are dropped, never guessed', () => {
  assert.equal(ocsMatchKey('2026-09-17', 'Zverev, Alexander', 'M. Zverev'), null);
});

test('the day is truncated to a date, so a timestamp keys the same as a date', () => {
  assert.equal(ocsMatchKey('2026-09-17T18:30:00Z', 'J. Sinner', 'C. Alcaraz'),
               ocsMatchKey('2026-09-17', 'J. Sinner', 'C. Alcaraz'));
});
