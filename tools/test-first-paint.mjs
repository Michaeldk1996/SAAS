// First paint (2026-11-12): the dashboard keeps <body> hidden until theme.js marks <html> on DOMContentLoaded — i.e.
// after the parser has passed the late layout-12a / theme-12a styles. Executes the shipped theme.js; mutants caught.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html = readFileSync(new URL('../bsp-consult-dashboard.html', import.meta.url), 'utf8');
const theme = readFileSync(new URL('../theme.js', import.meta.url), 'utf8');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const RULE = 'html:not(.sf-css-ready) body{ visibility:hidden; }';
const hideInHead = (s) => { const i = s.indexOf(RULE), b = s.search(/\n<body>/); return i > 0 && i < b; };
const themeInHead = (s) => { const i = s.indexOf('<script src="./theme.js"></script>'), b = s.search(/\n<body>/); return i > 0 && i < b; };
function run(src, state) {
  const cls = new Set(), ls = {}, timers = [];
  const document = { readyState: state, documentElement: { classList: { add: (c) => cls.add(c) }, setAttribute() {}, getAttribute() { return null; } },
    addEventListener: (e, f) => { (ls[e] = ls[e] || []).push(f); }, querySelectorAll: () => [] };
  const window = { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {}, dispatchEvent() {} };
  vm.runInNewContext(src, { document, window, localStorage: { getItem: () => null }, setTimeout: (f, ms) => timers.push([f, ms]), CustomEvent: function () {} });
  return { cls, ls, timers };
}
function behaves(src) {
  const a = run(src, 'loading');
  const hiddenWhileParsing = !a.cls.has('sf-css-ready');
  (a.ls.DOMContentLoaded || []).forEach((f) => f());
  const shownAfterParse = a.cls.has('sf-css-ready');
  const b = run(src, 'loading');
  b.timers.filter(([, ms]) => ms <= 10000).forEach(([f]) => f());
  return [hiddenWhileParsing && shownAfterParse, b.cls.has('sf-css-ready')];
}
ok(hideInHead(html), 'the hide rule is in the dashboard <head>');
ok(themeInHead(html), 'theme.js loads in <head>');
const [p, f] = behaves(theme);
ok(p, 'hidden while parsing, shown on DOMContentLoaded (after the last style block)');
ok(f, 'a ≤ 10 s fallback shows the page whatever happens');
ok(!hideInHead(html.replace(RULE, '')), 'mutant: hide rule removed → caught');
ok(!behaves(theme.replace("document.addEventListener('DOMContentLoaded', ready)", 'ready()'))[0], 'mutant: shown before parsing ends → caught');
ok(!behaves(theme.replace('setTimeout(ready, 8000);', ''))[1], 'mutant: no fallback → caught');
if (fail) { console.error(fail + ' failed'); process.exit(1); }
