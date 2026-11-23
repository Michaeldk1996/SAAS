// TEST-ONLY sandbox for the 2026-11-23 Match analysis rebuild (TEN-314 suites): slices the dashboard declarations the
// rebuilt renderers read (closure of `seeds`, from tools/ten334-overview-vm.mjs) and runs match-analysis-v2.js in the SAME
// function body, so its free identifiers resolve to the real sliced code and its IIFE exports land on the `window` it gets.
// Never loaded by the page.
import { closure } from './ten334-overview-vm.mjs';

// html / v2 = the sources (the mutant runner hands mutated copies); seeds = dashboard declarations to slice (transitively);
// stubs = names NOT sliced but passed in as parameters (values in `params`); win = the window object.
// expose = internal v2 functions handed out as window.__<name> (a test hook added to the copy, never the shipped file).
export function ma2VM(html, v2, { seeds = [], stubs = [], params = {}, win = {}, extra = '', expose = [] } = {}) {
  if (expose.length) { const at = v2.indexOf('\n  root.MA2 = '); if (at < 0) throw new Error('root.MA2 export not found'); v2 = v2.slice(0, at) + expose.map(n => `\n  root.__${n} = ${n};`).join('') + v2.slice(at); }
  const names = [...new Set([...stubs, ...Object.keys(params)])];
  const body = `${seeds.length ? closure(html, seeds, names) : ''}
    ${extra}
    ${v2}
    return window;`;
  return new Function('window', ...names, body)(win, ...names.map(n => params[n]));
}
