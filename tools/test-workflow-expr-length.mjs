// TEN-449 (2026-10-19 incident): GitHub parses a `run:` block that holds any ${{ }} expression as ONE expression, and
// refuses the whole workflow file when that exceeds 21,000 characters ("Exceeded max expression length 21000"). The
// workflow then can't load: no dispatch starts a run, and the data pipeline stalls with nothing red in CI.
// Test: in every workflow file, a run block that contains an expression stays under the limit (with headroom).
// Pass values into long blocks through `env:` instead.
import fs from 'node:fs';
import path from 'node:path';

const LIMIT = 21000, HEADROOM = 18000;
const dir = '.github/workflows';
let fails = 0, checked = 0;
for (const f of fs.readdirSync(dir).filter((x) => /\.ya?ml$/.test(x))) {
  const L = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(/^(\s*)(?:-\s+)?run:\s*[|>]/);
    if (!m) continue;
    const ind = m[1].length;
    let j = i + 1;
    while (j < L.length && (L[j].trim() === '' || L[j].length - L[j].trimStart().length > ind)) j++;
    const blk = L.slice(i + 1, j).join('\n');
    if (blk.includes('${{')) {
      checked++;
      if (blk.length > HEADROOM) { fails++; console.error(`FAIL ${f}:${i + 1}: run block with an inline expression is ${blk.length} chars (GitHub limit ${LIMIT}; keep under ${HEADROOM}) — pass it through env:`); }
    }
    i = j - 1;
  }
}
console.log(`workflow expression length: ${checked} run block(s) with expressions checked, ${fails} over ${HEADROOM} chars`);
process.exit(fails ? 1 : 0);
