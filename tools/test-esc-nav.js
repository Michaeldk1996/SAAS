// tools/test-esc-nav.js — one Escape handler, one step back per press (ESC brief, 2026-10-21).
//
// What this locks:
//   A · priority        tooltip > dropdown/menu > focused field > modal/sheet/drawer (highest z) > detail view > nothing
//   B · one per press   two layers open: one press closes only the top one; the event is stopped only when acted on
//   C · typing          a focused text field is cleared (and fires `input`), then blurred; it never navigates or
//                       closes a modal; a select / contenteditable only blurs; a checkbox is not a field
//   D · origin stack    a detail view returns to the exact view it was opened from: tab (+ hash via the hook), the
//                       sub-view, the modal, scroll; a return never records a new origin; a reader's sidebar click
//                       clears the trail; a trail for a tab the reader has left is dropped, never replayed
//   E · focus           the element that opened a layer gets focus back when Esc closes it
//   F · the fold        no surface binds its own Escape listener any more; every layer is registered; the handler
//                       loads in <head> before every other script; both Back links go through sfDetailBack; no
//                       pushState anywhere (browser Back unchanged)
//
// Run: node tools/test-esc-nav.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);
console.log('ESC navigation (brief 2026-10-21)');

// ── a small fake DOM, enough for esc-nav.js ─────────────────────────────────────────────────────────────────────
function world() {
  const listeners = {};
  const log = [];
  const body = { nodeType: 1, tagName: 'BODY' };
  const document = {
    body, activeElement: body,
    addEventListener(type, fn, cap) { (listeners[type] = listeners[type] || []).push(fn); },
    querySelector() { return null; }
  };
  const win = {
    document, console, Event, Promise, setTimeout, clearTimeout, queueMicrotask,
    scrollX: 0, scrollY: 0, location: { hash: '' },
    scrollTo(x, y) { win.scrollX = x; win.scrollY = y; log.push(`scroll:${y}`); }
  };
  win.window = win;
  win.requestAnimationFrame = fn => setTimeout(fn, 0);
  vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'esc-nav.js'), 'utf8'), win, { filename: 'esc-nav.js' });
  const el = (tag, extra = {}) => Object.assign({
    nodeType: 1, tagName: tag, isConnected: true, isContentEditable: false,
    getClientRects: () => [1], focus() { document.activeElement = this; },
    blur() { if (document.activeElement === this) document.activeElement = body; log.push(`blur:${tag}`); },
    dispatchEvent(ev) { log.push(`event:${ev.type}`); }, closest: () => null, getAttribute: () => null
  }, extra);
  const layer = (id, z, extra = {}) => {
    const L = Object.assign({ id, z, open: true }, extra);
    L.isOpen = L.isOpen || (() => L.open);
    L.close = L.close || (() => { L.open = false; log.push(`close:${id}`); });
    (win.sfEscLayers = win.sfEscLayers || []).push(L);
    return L;
  };
  const press = () => {
    const ev = { key: 'Escape', stopped: false, prevented: false,
      preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    return { act: win.SfEsc.handle(ev), ev };
  };
  return { win, document, listeners, log, el, layer, press };
}
const tick = () => new Promise(r => setTimeout(r, 5));

// ── A · priority ────────────────────────────────────────────────────────────────────────────────────────────────
t('A1 tooltip, then menu, then modal — one per press', () => {
  const W = world();
  W.layer('modal', 74); W.layer('menu', 90); W.layer('tip', 100);
  assert.strictEqual(W.press().act, 'menu:tip');
  assert.strictEqual(W.press().act, 'menu:menu');
  assert.strictEqual(W.press().act, 'layer:modal');
  assert.strictEqual(W.press().act, 'none');
});
t('A2 a field with text beats an open modal: clear, blur, THEN the modal', () => {
  const W = world();
  W.layer('modal', 74);
  const input = W.el('INPUT', { type: 'search', value: 'sinner' });
  W.document.activeElement = input;
  assert.strictEqual(W.press().act, 'clear');
  assert.strictEqual(input.value, '');
  assert.ok(W.log.includes('event:input'), 'clearing fires input so the search re-renders');
  assert.strictEqual(W.press().act, 'blur');
  assert.strictEqual(W.press().act, 'layer:modal');
});
t('A3 an open picker beats its own focused search box', () => {
  const W = world();
  W.layer('picker', 90);
  W.document.activeElement = W.el('INPUT', { type: 'text', value: 'alc' });
  assert.strictEqual(W.press().act, 'menu:picker');
});
t('A4 modal stack: highest z first (sheet 80 over pop 78 over modal 74)', () => {
  const W = world();
  W.layer('modal', 74); W.layer('sheet', 80); W.layer('pop', 78);
  assert.deepStrictEqual([W.press().act, W.press().act, W.press().act], ['layer:sheet', 'layer:pop', 'layer:modal']);
});

// ── B · the event ──────────────────────────────────────────────────────────────────────────────────────────────
t('B1 acted → stopped and prevented; nothing to do → untouched', () => {
  const W = world();
  W.layer('modal', 74);
  const a = W.press();
  assert.ok(a.ev.stopped && a.ev.prevented);
  const b = W.press();
  assert.strictEqual(b.act, 'none');
  assert.ok(!b.ev.stopped && !b.ev.prevented, 'a top-level tab with nothing open does nothing');
});
t('B2 a throwing isOpen cannot break the press; `always` tidies without taking it', () => {
  const W = world();
  const err = console.error; console.error = () => {};
  try {
    W.layer('broken', 95, { isOpen: () => { throw new Error('x'); } });
    let tidied = 0;
    W.layer('pending-tip', 100, { open: false, always: () => { tidied++; } });
    W.layer('modal', 74);
    assert.strictEqual(W.press().act, 'layer:modal');
    assert.strictEqual(tidied, 1);
  } finally { console.error = err; }
});

// ── C · typing ─────────────────────────────────────────────────────────────────────────────────────────────────
t('C1 select and contenteditable only blur; a checkbox is not a field', () => {
  const W = world();
  W.document.activeElement = W.el('SELECT', { value: 'Clay' });
  assert.strictEqual(W.press().act, 'blur');
  W.document.activeElement = W.el('DIV', { isContentEditable: true, value: undefined });
  assert.strictEqual(W.press().act, 'blur');
  W.document.activeElement = W.el('INPUT', { type: 'checkbox', value: 'on' });
  assert.strictEqual(W.press().act, 'none');
});
t('C2 Esc in a field never navigates, even with a detail trail', () => {
  const W = world();
  const H = hooks(W, { tab: 'matches' });
  W.win.SfNav.push('players'); H.state.tab = 'players';
  W.document.activeElement = W.el('INPUT', { type: 'search', value: 'x' });
  assert.strictEqual(W.press().act, 'clear');
  assert.strictEqual(W.press().act, 'blur');
  assert.strictEqual(H.calls.length, 0, 'no navigation hook ran');
  assert.strictEqual(W.press().act, 'back');
});

// ── D · origin stack ───────────────────────────────────────────────────────────────────────────────────────────
function hooks(W, s) {
  const state = Object.assign({ tab: 'matches', sub: null, modal: null }, s);
  const calls = [];
  W.win.sfNavHooks = {
    activeTab: () => state.tab, subView: () => state.sub, modalState: () => state.modal,
    leave: d => calls.push(`leave:${d}`),
    activateTab: (tab, hash) => { calls.push(`tab:${tab}:${hash}`); state.tab = tab; },
    showSub: sub => { calls.push(`sub:${sub.key}`); W.win.SfNav.push('players'); },   // a return must not record
    reopenModal: m => calls.push(`modal:${m.id}:${m.tab}`)
  };
  return { state, calls };
}
t('D1 profile from a match modal: Esc returns to the tab, hash, modal and scroll', async () => {
  const W = world();
  const H = hooks(W, { tab: 'matches' });
  W.win.scrollY = 812; W.win.location.hash = '#Results';
  H.state.modal = null;
  W.win.SfNav.noteModalClosed({ id: 42, tab: 'h2h' });   // openPlayerProfileFromMatch closes the modal first
  W.win.SfNav.preNav();                                   // then the programmatic sidebar click
  H.state.tab = 'players'; W.win.scrollY = 0; W.win.location.hash = '';
  W.win.SfNav.push('players');                            // showPlayerProfile
  assert.strictEqual(W.press().act, 'back');
  assert.deepStrictEqual(H.calls, ['leave:players', 'tab:matches:#Results', 'modal:42:h2h']);
  await tick(); await tick();
  assert.strictEqual(W.win.scrollY, 812);
  assert.strictEqual(W.win.SfNav.depth(), 0);
});
t('D2 profile → profile: Esc re-opens the first profile, and the return records nothing', () => {
  const W = world();
  const H = hooks(W, { tab: 'players' });
  W.win.SfNav.push('players');                                       // list → A
  H.state.sub = { kind: 'player', key: 'A' };
  W.win.SfNav.push('players');                                       // A → B
  assert.strictEqual(W.win.SfNav.depth(), 2);
  W.press();
  assert.deepStrictEqual(H.calls, ['leave:players', 'sub:A']);
  assert.strictEqual(W.win.SfNav.depth(), 1, 'showSub during the return did not push');
});
t('D3 the snapshot is taken BEFORE the jump and only lives for that task', async () => {
  const W = world();
  const H = hooks(W, { tab: 'news' });
  W.win.SfNav.preNav();
  H.state.tab = 'players';
  await tick();                                      // the snapshot expired: a later push sees the view as it is now
  W.win.SfNav.push('players');
  W.press();
  assert.ok(!H.calls.some(c => c.startsWith('tab:')), 'a stale pre-nav snapshot must not be replayed');
});
t('D4 a sidebar click clears the trail; a trail for a tab the reader left is dropped', () => {
  const W = world();
  const H = hooks(W, { tab: 'matches' });
  W.win.SfNav.push('players'); H.state.tab = 'players';
  W.win.SfNav.clear();
  assert.strictEqual(W.press().act, 'none');
  W.win.SfNav.push('players');
  H.state.tab = 'styles';                            // left by some other route
  assert.strictEqual(W.press().act, 'none');
  assert.strictEqual(W.win.SfNav.depth(), 0);
});

// ── E · focus ──────────────────────────────────────────────────────────────────────────────────────────────────
t('E1 the element that opened a layer gets focus back', async () => {
  const W = world();
  const L = W.layer('modal', 74, { open: false });
  const card = W.el('DIV');
  W.listeners.pointerdown.forEach(fn => fn({ type: 'pointerdown', target: card }));
  L.open = true;                                     // the click opened it
  await tick();
  W.document.activeElement = W.el('BUTTON');         // focus moved into the modal
  W.press();
  assert.strictEqual(W.document.activeElement, card);
});
t('E2 a layer that returns focus itself (ownFocus) is left alone', async () => {
  const W = world();
  const L = W.layer('series', 76, { open: false, ownFocus: true });
  const card = W.el('DIV');
  W.listeners.pointerdown.forEach(fn => fn({ type: 'pointerdown', target: card }));
  L.open = true; await tick();
  const inner = W.el('BUTTON'); W.document.activeElement = inner;
  W.press();
  assert.strictEqual(W.document.activeElement, inner);
});

// ── F · the fold, on the shipped files ─────────────────────────────────────────────────────────────────────────
const HTML_FILE = 'bsp-consult-dashboard.html';
const HTML = fs.readFileSync(path.join(ROOT, HTML_FILE), 'utf8');
const scripts = [...HTML.matchAll(/<script src="\.?\/?([^"]+\.js)"/g)].map(m => m[1]);
t('F1 no surface binds its own Escape listener', () => {
  const hits = [];
  for (const f of [HTML_FILE, ...new Set(scripts)].filter(f => f !== 'esc-nav.js')) {
    fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').forEach((line, i) => {
      if (/(key|keyCode|which)\s*[!=]==?\s*(['"]Escape['"]|27\b)/.test(line)
        && !/function onKey\(e\) \{ if \(e && e\.key === 'Escape'\) escStep\(\); \}/.test(line)) hits.push(`${f}:${i + 1}`);
    });
  }
  assert.deepStrictEqual(hits, [], 'Escape is handled only in esc-nav.js');
});
t('F2 every layer is registered', () => {
  const all = [HTML_FILE, ...new Set(scripts)].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const want = ['ao-tip', 'acct-menu', 'sf-dd', 'trading-menu', 'h2h-picker', 'db-tour-picker', 'db-filter-menu',
    'fh-sheet', 'ma-pop', 'series-overlay', 'live-modal', 'live-sheet', 'drops-drawer', 'tourx-ms', 'tourx-overlay',
    'analysis-modal', 'fav-modal', 'pp-split-drawer', 'pp2-layers'];
  const missing = want.filter(id => !all.includes(`id: '${id}'`));
  assert.deepStrictEqual(missing, []);
});
t('F3 esc-nav.js loads in <head>, before every other script that registers a key listener', () => {
  assert.ok(scripts.includes('esc-nav.js'), 'esc-nav.js is loaded');
  const at = HTML.indexOf('<script src="./esc-nav.js">');
  assert.ok(at > 0 && at < HTML.indexOf('</head>'), 'in <head>');
  assert.ok(at < HTML.indexOf('document.addEventListener(\'keydown\''), 'before the first inline keydown listener');
});
t('F4 both Back links go through sfDetailBack; no pushState (browser Back unchanged)', () => {
  assert.ok(/<span onclick="sfDetailBack\(\)"[^>]*>[\s\S]{0,200}Back to Players/.test(HTML), 'legacy Back link');
  const v2 = fs.readFileSync(path.join(ROOT, 'player-profile-v2.js'), 'utf8');
  assert.ok(/kind === 'back'\) \{[\s\S]{0,300}window\.sfDetailBack\(\)/.test(v2), 'v2 Back link');
  for (const f of [HTML_FILE, ...new Set(scripts)]) {
    assert.ok(!/history\.pushState/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), `${f} has no pushState`);
  }
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); pass++; console.log('  PASS  ' + name); }
    catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + (e && e.message)); }
  }
  console.log(`\n  ${pass} passed, ${fail} failed, 0 skipped (a skip is never a pass)`);
  process.exit(fail ? 1 : 0);
})();
