// TEN-449 (2026-10-19 incident): GitHub parses a `run:` block that holds any ${{ }} expression as ONE expression, and
// refuses the whole workflow file when that exceeds 21,000 characters ("Exceeded max expression length 21000"). The
// workflow then can't load: no dispatch starts a run, and the data pipeline stalls with nothing red in CI.
// Test: in every workflow file (.github/workflows/*.yml|yaml and tools/te-store-repo/te-refresh.yml), every `run:` value
// and every `with: script:` value (actions/github-script) that contains an expression stays under the limit (with
// headroom). Every scalar form counts (TEN-449 review): block (`|`, `>`, with chomping/indent indicators), single-line
// plain, single- or double-quoted, and plain or quoted values continued over several lines. A form it can't measure
// (flow mapping, quoted key, space before ':', a YAML alias `run: *big` as the whole value) fails closed.
// Pass values into long blocks through `env:` instead. actionlint (tools/actionlint.mjs) has no rule for this limit.
// Mutants for each form: tools/test-workflow-expr-length-mutants.mjs.
// Usage: node tools/test-workflow-expr-length.mjs [file ...]   (no files = every workflow file in the repo)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LIMIT = 21000, HEADROOM = 18000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const indentOf = (s) => s.length - s.trimStart().length;
const isBlankOrComment = (s) => s.trim() === '' || s.trim().startsWith('#');

// Every run: / with.script: scalar in a workflow's text → [{ key, line (1-based), len, expr }].
// The value is the rest of the key's line plus every following line that is blank or indented past the KEY's column
// (for `- run:` that is the column of `run`, so a sibling key of the step is never swallowed). Block scalars are
// measured on their content lines only.
export function scanText(text) {
  const L = text.split('\n');
  const out = [];
  for (let i = 0; i < L.length; i++) {
    const m = L[i].match(/^(\s*)(-\s+)?(run|script):(?:\s+(.*?))?\s*$/);
    if (!m) {
      // A run/script key in a form this scanner doesn't measure (flow mapping `{ run: … }`, quoted key `"run":`, or a
      // space before the colon) is valid YAML GitHub accepts — so fail closed rather than let it pass unmeasured.
      if (/^\s*(-\s+)?(["'](run|script)["']\s*:|(run|script)\s+:(\s|$))|[{,]\s*["']?(run|script)["']?\s*:/.test(L[i])) {
        out.push({ key: 'unmeasured', line: i + 1, len: 0, expr: true, unmeasured: true });
      }
      continue;
    }
    const keyCol = m[1].length + (m[2] ? m[2].length : 0);
    const key = m[3];
    if (key === 'script') {
      // Only `with: script:`. The parent is the nearest line above that is indented less than the key.
      let p = i - 1;
      while (p >= 0 && (isBlankOrComment(L[p]) || indentOf(L[p]) >= keyCol)) p--;
      if (m[2] || p < 0 || !/^\s*(-\s+)?with:\s*(#.*)?$/.test(L[p])) continue;
    }
    let j = i + 1;
    while (j < L.length && (L[j].trim() === '' || indentOf(L[j]) > keyCol)) j++;
    let end = j;
    while (end > i + 1 && L[end - 1].trim() === '') end--;
    const rest = m[4] || '';
    // A YAML alias as the whole value (`run: *big`) is the anchored scalar from elsewhere in the file, of any length and
    // with any expression in it; measuring the 4 characters `*big` would pass it unseen (TEN-449 review). Fail closed.
    if (/^\*/.test(rest)) {
      out.push({ key: key === 'script' ? 'with.script' : 'run', line: i + 1, len: 0, expr: true, unmeasured: true });
      continue;
    }
    const block = /^[|>][-+0-9]*\s*(#.*)?$/.test(rest);
    const value = block ? L.slice(i + 1, end).join('\n') : [rest, ...L.slice(i + 1, end)].join('\n');
    // An empty `run:` with a mapping under it (`defaults: run: shell:`, or a JOB named `run`) is not a scalar: scan into it.
    const next = L.slice(i + 1, end).find((s) => !isBlankOrComment(s));
    if (!rest && next !== undefined && /^\s*(-\s|[\w-]+:(\s|$))/.test(next)) continue;
    out.push({ key: key === 'script' ? 'with.script' : 'run', line: i + 1, len: value.length, expr: value.includes('${{') });
    i = j - 1; // never look for keys inside a value
  }
  return out;
}

export function defaultFiles(root = ROOT) {
  const dir = path.join(root, '.github', 'workflows');
  return [...fs.readdirSync(dir).filter((x) => /\.ya?ml$/.test(x)).sort().map((f) => path.join(dir, f)),
    path.join(root, 'tools', 'te-store-repo', 'te-refresh.yml')];
}

// → { checked, fails: [message] }
export function checkFiles(files) {
  let checked = 0;
  const fails = [];
  for (const f of files) {
    for (const v of scanText(fs.readFileSync(f, 'utf8'))) {
      if (!v.expr) continue;
      checked++;
      if (v.unmeasured) fails.push(`FAIL ${path.relative(process.cwd(), f)}:${v.line}: run/script key in a form this guard can't measure (flow mapping, quoted key, space before ':' or a YAML alias as the value) — write it as a block-style \`run:\` / \`script:\` key with its own value`);
      else if (v.len > HEADROOM) fails.push(`FAIL ${path.relative(process.cwd(), f)}:${v.line}: ${v.key} value with an inline expression is ${v.len} chars (GitHub limit ${LIMIT}; keep under ${HEADROOM}) — pass it through env:`);
    }
  }
  return { checked, fails };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2).length ? process.argv.slice(2) : defaultFiles();
  const { checked, fails } = checkFiles(files);
  for (const f of fails) console.error(f);
  console.log(`workflow expression length: ${checked} run/with.script value(s) with expressions checked in ${files.length} file(s), ${fails.length} over ${HEADROOM} chars`);
  process.exit(fails.length ? 1 : 0);
}
