#!/usr/bin/env node
// tools/slim-code.mjs — publish-time slimming of the dashboard's inline JavaScript (page speed, 7 Nov 2026).
//
// The dashboard ships ~2.3 MB of inline JavaScript, about a third of it comments and indentation. The published page
// carries the same code without them: every comment and every run of whitespace between two tokens is dropped (a run
// that held a line break becomes one "\n", so automatic semicolon insertion reads the code exactly as before; any other
// run becomes one space). Tokens are copied byte for byte — strings, template literals, regular expressions and names
// are never touched. The source file in the repo stays whole; only the copy publish.yml deploys is slimmed.
//
// Proof, per script, fail-closed: the slimmed text must parse to the SAME syntax tree as the original (positions
// aside). A script that fails to parse, or whose tree differs, ships unchanged — slimming never changes what runs.
// The parser is the acorn copy inside Node itself (`--expose-internals`); without it nothing is slimmed.
//
//   node --expose-internals tools/slim-code.mjs <file.html> ...   (in place; prints bytes before / after)
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

let acorn = null;
try { acorn = createRequire(import.meta.url)('internal/deps/acorn/acorn/dist/acorn'); } catch (e) { acorn = null; }
export const slimAvailable = () => !!acorn;

const OPTS = { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: false };
const LINE_BREAK = /[\n\r\u2028\u2029]/;

function shape(node) {
  // The tree without positions: every other field (types, names, operators, literal raw text) must match.
  return JSON.stringify(node, (k, v) => (k === 'start' || k === 'end' || k === 'loc' || k === 'range') ? undefined : v);
}

// Slim one script's text. Returns the original text whenever the proof does not hold.
export function slimJs(src) {
  if (!acorn) return src;
  let tree;
  const tokens = [];
  try { tree = acorn.parse(src, { ...OPTS, onToken: tokens }); } catch (e) { return src; }
  let out = '';
  let prev = 0;
  for (const t of tokens) {
    if (t.type === acorn.tokTypes.eof) break;
    if (out) {
      const gap = src.slice(prev, t.start);
      out += LINE_BREAK.test(gap) ? '\n' : (gap === '' ? '' : ' ');
    }
    out += src.slice(t.start, t.end);
    prev = t.end;
  }
  // A script never ends inside a token, but keep a trailing line break so the next markup stays on its own line.
  out = '\n' + out + '\n';
  try {
    if (shape(acorn.parse(out, OPTS)) !== shape(tree)) return src;
  } catch (e) { return src; }
  return out.length < src.length ? out : src;
}

// Slim every inline classic script in an HTML page. External scripts, JSON / module / template scripts are left alone.
export function slimHtml(html) {
  let scripts = 0, slimmed = 0;
  const outHtml = html.replace(/(<script\b([^>]*)>)([\s\S]*?)(<\/script>)/gi, (all, open, attrs, body, close) => {
    if (/\bsrc\s*=/i.test(attrs)) return all;
    const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (type && !/^(text|application)\/(javascript|ecmascript)$/i.test(type)) return all;
    if (!body.trim()) return all;
    scripts++;
    const s = slimJs(body);
    if (s !== body) slimmed++;
    return open + s + close;
  });
  return { html: outHtml, scripts, slimmed };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  if (!acorn) { console.error('slim-code: no parser (run node with --expose-internals); nothing slimmed'); process.exit(0); }
  for (const f of process.argv.slice(2)) {
    const before = fs.readFileSync(f, 'utf8');
    const r = slimHtml(before);
    fs.writeFileSync(f + '.slim-tmp', r.html);
    fs.renameSync(f + '.slim-tmp', f);   // atomic: a crash never leaves a half-written page
    console.log(`slim-code: ${f} ${before.length} -> ${r.html.length} bytes, ${r.slimmed} of ${r.scripts} inline scripts slimmed`);
  }
}
