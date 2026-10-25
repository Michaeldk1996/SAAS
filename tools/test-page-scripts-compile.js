'use strict';
// Every classic inline <script> of the shipped pages must COMPILE as a whole. The function-slicing suites never parse
// the page as one script, so a duplicate top-level `let` / `const` (f255dca34: `const _tpLoad` beside TEN-339's
// `let _tpLoad`) passed them all while the dashboard's main script died on load ("Identifier '_tpLoad' has already
// been declared") and every page global went missing. Here each block is compiled with vm.Script — the same parse a
// browser does — and a SyntaxError fails the suite with its block and line.
//
// Mutation: declare a top-level name twice in one block (the control below does exactly that) → red.
// Run: node tools/test-page-scripts-compile.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PAGES = ['bsp-consult-dashboard.html', 'auth.html', 'account.html', 'funnel.html', 'verify.html'].filter(f => fs.existsSync(path.join(ROOT, f)));
let pass = 0, fail = 0;
const ok = (n, c, got) => { if (c) { pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (got ? ' :: ' + got : '')); } };

// classic scripts only: no src, no type, or a JavaScript type (module / json / templates are not classic scripts)
function inlineScripts(html) {
  const out = [], re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    if (/\bsrc\s*=/.test(attrs)) continue;
    const t = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (t && !/^(text|application)\/(javascript|ecmascript)$/i.test(t)) continue;
    out.push({ code: m[2], line: html.slice(0, m.index).split('\n').length });
  }
  return out;
}
const compileErr = code => { try { new vm.Script(code); return null; } catch (e) { return e; } };

for (const f of PAGES) {
  const blocks = inlineScripts(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  ok(`${f}: has inline scripts to check (${blocks.length})`, f !== 'bsp-consult-dashboard.html' || blocks.length > 0);
  const bad = blocks.map(b => ({ b, e: compileErr(b.code) })).filter(x => x.e);
  ok(`${f}: every inline script compiles`, bad.length === 0,
    bad.map(x => `script at line ${x.b.line}: ${x.e.name}: ${x.e.message}`).join(' | '));
  // Classic scripts share one global lexical scope: a name declared with let / const in two DIFFERENT blocks throws when
  // the second runs. Compiled together (each block closed with a newline + ';'), the same redeclaration is a SyntaxError.
  const joined = blocks.map(b => b.code).join('\n;\n');
  const je = bad.length ? null : compileErr(joined);
  ok(`${f}: no top-level let / const name is declared in two script blocks`, !je, je && `${je.name}: ${je.message}`);
}
// Control: the exact f255dca34 shape — a second top-level declaration of one name in one script — does not compile.
ok('control: a top-level `let x` and `const x` in one script is caught', !!compileErr('let _tpLoad = null;\nconst _tpData = {}, _tpLoad = {};'));
ok('control: the same name across two blocks is caught when the blocks are joined', !!compileErr(['let _tpLoad = null;', 'const _tpLoad = {};'].join('\n;\n')));
ok('control: a clean script compiles', !compileErr('let a = 1;\nconst b = {};\nfunction c(){ return a; }'));

console.log(`\npage-scripts-compile: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
