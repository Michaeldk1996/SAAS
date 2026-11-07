#!/usr/bin/env node
// tools/test-analytics-after-load.js — analytics.js requests gtag.js only after the page's load event (page speed,
// 7 Nov 2026), and nothing is lost meanwhile: config and every teTrack event queue in dataLayer for gtag.js to replay.
// Control: the pre-change loader (tag appended at once) fails the "nothing before load" check.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'analytics.js'), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, detail) => { if (ok) { pass++; console.log('  ok  ' + name); } else { fail++; console.log('  FAIL ' + name + (detail ? '  ' + detail : '')); } };

function run(src, readyState) {
  const appended = [], listeners = {};
  const doc = { readyState, head: { appendChild: (el) => appended.push(el) }, createElement: () => ({}) };
  const win = { document: doc, addEventListener: (t, f, o) => { (listeners[t] = listeners[t] || []).push({ f, once: !!(o && o.once) }); } };
  win.window = win;
  vm.runInNewContext(src, { window: win, document: doc });
  return { win, appended, fire: (t) => { const l = listeners[t] || []; listeners[t] = l.filter((x) => !x.once); l.forEach((x) => x.f()); } };
}

const TAG = /^https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-L2RZQB615T$/;
{
  const r = run(SRC, 'loading');
  check('no tag requested while the page is still loading', r.appended.length === 0, `${r.appended.length} appended`);
  r.win.teTrack('board_open', { day: 'today' });
  const cfg = r.win.dataLayer.find((a) => a[0] === 'config');
  check('config is queued for the measurement id before the tag loads', !!cfg && cfg[1] === 'G-L2RZQB615T');
  check('a teTrack event before the tag loads is queued, not lost', r.win.dataLayer.some((a) => a[0] === 'event' && a[1] === 'board_open'));
  r.fire('load');
  check('after the load event exactly one tag is requested, async', r.appended.length === 1 && TAG.test(r.appended[0].src) && r.appended[0].async === true);
  r.fire('load');
  check('a second load event requests nothing more', r.appended.length === 1);
}
{
  const r = run(SRC, 'complete');
  check('a page already loaded requests the tag at once', r.appended.length === 1 && TAG.test(r.appended[0].src));
}
{
  // CONTROL: the loader before this change appended the tag at once.
  const old = SRC.replace(/function loadTag\(\) \{([\s\S]*?)\n  \}\n  if \(doc\.readyState === 'complete'\) loadTag\(\);\n  else global\.addEventListener\('load', loadTag, \{ once: true \}\);/, '$1');
  check('CONTROL: the mutant was planted', old !== SRC);
  const r = run(old, 'loading');
  check('CONTROL: the pre-change loader requests the tag before load (the check above would catch it)', r.appended.length === 1);
}
console.log(`\ntest-analytics-after-load: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
