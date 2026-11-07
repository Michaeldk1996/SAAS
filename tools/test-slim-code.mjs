#!/usr/bin/env node
// tools/test-slim-code.mjs — the publish-time slimming of index.html's inline JavaScript (tools/slim-code.mjs).
// What must hold: every inline script of the real dashboard is slimmed AND parses to the same syntax tree; the page
// shrinks; tokens (strings, templates, regexes) are byte-identical; line breaks that automatic semicolon insertion
// reads survive; a slimming that would change the tree ships the original (control: a slimmer that drops every
// line break is caught by the proof); publish-site.mjs slims index.html and leaves bsp-consult-dashboard.html whole.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
if (!process.execArgv.includes('--expose-internals')) {
  // The parser is Node's own acorn; re-run with access to it.
  const r = spawnSync(process.execPath, ['--expose-internals', fileURLToPath(import.meta.url)], { stdio: 'inherit' });
  process.exit(r.status == null ? 1 : r.status);
}
const S = await import(path.join(HERE, 'slim-code.mjs'));
const acorn = createRequire(import.meta.url)('internal/deps/acorn/acorn/dist/acorn');

let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? '\n       ' + detail : '')); } };
const tree = (t) => JSON.stringify(acorn.parse(t, { ecmaVersion: 'latest', sourceType: 'script' }), (k, v) => (k === 'start' || k === 'end' || k === 'loc') ? undefined : v);

check('the parser is available (publish.yml runs Node 24 with --expose-internals)', S.slimAvailable());

// 1. Samples: comments go, tokens stay byte for byte, ASI-relevant line breaks stay.
const sample = [
  '// a line comment',
  'var a = 1   /* block */ + 2',
  '/* multi',
  '   line */',
  'var b = a',
  '(function(){ return 3 })()',       // no ASI here: must stay a call on a
  'let c = `tpl  ${ a  /* in */ +  b }   two  spaces`;',
  'const re = /a  b\\/ /g, d = 4 / 2 / 1;',
  'function f(){ return',
  '  a }',                              // ASI after return: f() returns undefined
  'x = "keep // this /* too */"; y = \'  spaced  \'',
  'i++',
  '++j',
].join('\n');
const slim = S.slimJs(sample);
check('sample: slimmed text parses to the same tree', tree(slim) === tree(sample));
check('sample: comments are gone', !/a line comment|block \*\/|multi/.test(slim), slim);
check('sample: string, template and regex text kept byte for byte',
  slim.includes('"keep // this /* too */"') && slim.includes("'  spaced  '") && slim.includes('`tpl  ${') && slim.includes('}   two  spaces`') && slim.includes('/a  b\\/ /g'), slim);
check('sample: the line break after `return` survives (ASI)', /return\na/.test(slim), slim);
check('sample: shorter', slim.length < sample.length);

// 2. Control: a slimmer that drops line breaks changes the tree — the proof catches it and the original ships.
const bad = sample.replace(/\n/g, ' ');
let threw = false; try { tree(bad); } catch (e) { threw = true; }
check('CONTROL: dropping line breaks changes the code (fails to parse or a different tree)', threw || tree(bad) !== tree(sample));
{
  // Mutants of the tool itself: a slimmer that turns line breaks into spaces must be stopped by its own proof (the
  // original ships); the same slimmer with the proof removed ships a different program (so the proof is what stops it).
  const src = fs.readFileSync(path.join(HERE, 'slim-code.mjs'), 'utf8');
  const noBreaks = src.replace("LINE_BREAK.test(gap) ? '\\n' :", "LINE_BREAK.test(gap) ? ' ' :");
  const noProof = noBreaks.replace('if (shape(acorn.parse(out, OPTS)) !== shape(tree)) return src;', '');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slim-mut-'));
  fs.writeFileSync(path.join(tmp, 'm1.mjs'), noBreaks); fs.writeFileSync(path.join(tmp, 'm2.mjs'), noProof);
  const m1 = await import(path.join(tmp, 'm1.mjs')), m2 = await import(path.join(tmp, 'm2.mjs'));
  check('CONTROL: mutants were planted', noBreaks !== src && noProof !== noBreaks);
  check('CONTROL: a line-break-dropping slimmer is stopped by the proof (original ships)', m1.slimJs(sample) === sample);
  const out2 = m2.slimJs(sample); let differs = true; try { differs = tree(out2) !== tree(sample); } catch (e) { differs = true; }
  check('CONTROL: without the proof that slimmer would ship a different program', differs);
  fs.rmSync(tmp, { recursive: true, force: true });
}
check('a script that does not parse ships unchanged', S.slimJs('var = ;  // broken') === 'var = ;  // broken');

// 3. The real dashboard: every inline classic script slimmed, each proven, the page much smaller gzipped.
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const r = S.slimHtml(html);
check(`dashboard: every inline script slimmed (${r.slimmed} of ${r.scripts})`, r.scripts >= 10 && r.slimmed === r.scripts, `${r.slimmed}/${r.scripts}`);
const scripts = (h) => [...h.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter((m) => !/\bsrc\s*=/i.test(m[1]) && m[2].trim());
const a = scripts(html), b = scripts(r.html);
let same = a.length === b.length;
for (let i = 0; same && i < a.length; i++) { const t = (m) => m[1].match(/\btype\s*=\s*["']?([^"'\s>]+)/i); if (t(a[i]) && !/javascript/i.test(t(a[i])[1])) continue; if (tree(a[i][2]) !== tree(b[i][2])) same = false; }
check('dashboard: every slimmed script parses to the same tree as the source', same);
const outside = (h) => h.replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, '$1$2');
check('dashboard: nothing outside the inline scripts changes', outside(html) === outside(r.html));
const gz = (t) => zlib.gzipSync(t, { level: 6 }).length;
check(`dashboard: at least 30% smaller gzipped (${Math.round(gz(html) / 1024)} KB -> ${Math.round(gz(r.html) / 1024)} KB)`, gz(r.html) < 0.7 * gz(html));

// 4. publish-site.mjs slims index.html only.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slim-pub-'));
  const site = path.join(dir, '_site'); fs.mkdirSync(site);
  fs.writeFileSync(path.join(site, 'matches.json'), '[]');
  const M = await import(path.join(ROOT, 'tools', 'publish-site.mjs'));
  M.publish({ code: ROOT, site, env: { CODE_SHA: 'a'.repeat(40) } });
  const idx = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  const full = fs.readFileSync(path.join(site, 'bsp-consult-dashboard.html'), 'utf8');
  check('publish: index.html is slimmed', idx.length < 0.8 * full.length, `${idx.length} vs ${full.length}`);
  check('publish: bsp-consult-dashboard.html is the full source (+ the build-sha tag)', full.replace(/\n<meta name="build-sha" content="[0-9a-f]{40}">/, '') === html);
  check('publish: index.html carries the build-sha tag once', (idx.match(/<meta name="build-sha" content="a{40}">/g) || []).length === 1);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\ntest-slim-code: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
