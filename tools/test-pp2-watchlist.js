// tools/test-pp2-watchlist.js — the Player Profile watchlist (founder 2026-11-09: "Fix it").
//
// The star in the profile header writes ONE store (signed in: users/{uid}.watchPlayers; signed out: this browser's
// localStorage `stennisfy.watchPlayers`), and the Players page lists it as a "Watchlist · N" strip — the export draws
// no list, so it takes the nearest existing pattern, Today's Matches' Favourites strip. Runs the dashboard's OWN
// functions (sliced from bsp-consult-dashboard.html) over stubbed storage, account and DOM:
//   A · the store       toggle adds / removes / persists locally when signed out, to the account when signed in;
//                       sign-in merges the browser's list into the account (account order first) and empties it
//   B · the strip       one card per watched player in starred order; empty → no strip; ✕ removes; a card opens the profile
// Run: node tools/test-pp2-watchlist.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'bsp-consult-dashboard.html'), 'utf8');
function sliceFn(name) {
  const at = HTML.indexOf('function ' + name + '(');
  assert(at >= 0, name + ' not found');
  let d = 0, i = HTML.indexOf('{', at);
  for (; i < HTML.length; i++) { if (HTML[i] === '{') d++; else if (HTML[i] === '}' && --d === 0) break; }
  return HTML.slice(at, i + 1);
}
function sliceAssign(prefix) {
  const at = HTML.indexOf(prefix);
  assert(at >= 0, prefix + ' not found');
  let d = 0, i = HTML.indexOf('{', at);
  for (; i < HTML.length; i++) { if (HTML[i] === '{') d++; else if (HTML[i] === '}' && --d === 0) break; }
  return HTML.slice(at, i + 2);
}

let pass = 0, fail = 0;
const queue = [];
function check(name, fn) { queue.push([name, fn]); }   // run in order, each awaited (A2 / A3 are async)

function load(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.local || {});
  const writes = [];
  const opened = [];
  const strip = { innerHTML: '', _wired: false, listeners: {}, addEventListener(t, f) { this.listeners[t] = f; } };
  const src = `
    const localStorage = { getItem: k => (k in STORE ? STORE[k] : null), setItem: (k, v) => { STORE[k] = String(v); }, removeItem: k => { delete STORE[k]; } };
    const document = { getElementById: id => (id === 'pgWatchStrip' ? STRIP : null) };
    const playerIndex = [{ key: 1980, name: 'Alexander Zverev', rank: 1 }, { key: 2382, name: 'Carlos Alcaraz', rank: 3 }];
    function newsPlayerName(k, fb) { return ({ 1980: 'A. Zverev', 2382: 'C. Alcaraz' })[k] || fb || ''; }
    function pp2LiveRankOf(k) { return ({ 1980: 1, 2382: 3 })[k] || null; }
    function pgEloFor(n) { return n === 'A. Zverev' ? 2102 : null; }
    function pgInitials(n) { return n.split(/[ .]+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase(); }
    function playerPhotoImg(k) { return '<img data-k="' + k + '">'; }
    function mxFavStarSvg() { return '<svg></svg>'; }
    function showPlayerProfile(k) { OPENED.push(String(k)); }
    ${sliceFn('psEsc')}
    ${sliceFn('mxFavClean')}
    ${sliceFn('mxFavMerge')}
    const PP_WATCH_LS = 'stennisfy.watchPlayers';
    ${sliceFn('ppWatchReadLocal')}
    ${sliceFn('ppWatchWriteLocal')}
    const ppWatch = { keys: ppWatchReadLocal(), uid: null };
    ${sliceFn('ppWatchPersist')}
    ${sliceAssign('window.pp2IsWatched = function')}
    ${sliceAssign('window.pp2WatchKeys = function')}
    ${sliceAssign('window.pp2ToggleWatch = function')}
    ${sliceFn('pgWatchStripHtml')}
    ${sliceFn('pgRenderWatchStrip')}
    ${sliceFn('ppWatchOnAuth')}
    return { ppWatch, ppWatchOnAuth, pgWatchStripHtml, pgRenderWatchStrip };`;
  const window = { BSP: { updateProfile: p => { writes.push(p); return Promise.resolve(); } } };
  // eslint-disable-next-line no-new-func
  const api = new Function('window', 'STORE', 'STRIP', 'OPENED', src)(window, store, strip, opened);
  return { api, window, store, writes, strip, opened };
}

console.log('Profile v2 · watchlist store + Players strip');

check('A1 · signed out: the star toggles one key, persisted to this browser', () => {
  const { window, store } = load();
  window.pp2ToggleWatch(1980);
  assert.deepStrictEqual(JSON.parse(store['stennisfy.watchPlayers']), ['1980']);
  assert.strictEqual(window.pp2IsWatched('1980'), true);
  window.pp2ToggleWatch('2382');
  window.pp2ToggleWatch('1980');
  assert.deepStrictEqual(window.pp2WatchKeys(), ['2382'], 'the second toggle removes');
  window.pp2ToggleWatch('2382');
  assert(!('stennisfy.watchPlayers' in store), 'an empty list is removed, not stored as []');
});
check('A2 · signed in: the list writes to the account (users/{uid}.watchPlayers), not the browser', () => {
  const { api, window, store, writes } = load();
  return api.ppWatchOnAuth({ uid: 'u1', watchPlayers: ['2382'] }).then(() => {
    window.pp2ToggleWatch(1980);
    assert.deepStrictEqual(writes[writes.length - 1], { watchPlayers: ['2382', '1980'] });
    assert(!('stennisfy.watchPlayers' in store), 'a signed-in toggle wrote to the browser');
  });
});
check('A3 · sign-in merges the browser\'s list into the account (account first) and empties the browser', () => {
  const { api, store, writes } = load({ local: { 'stennisfy.watchPlayers': JSON.stringify(['1980', '2382']) } });
  return api.ppWatchOnAuth({ uid: 'u1', watchPlayers: ['2382'] }).then((keys) => {
    assert.deepStrictEqual(keys, ['2382', '1980']);
    assert.deepStrictEqual(writes[0], { watchPlayers: ['2382', '1980'] });
    assert(!('stennisfy.watchPlayers' in store), 'the browser copy survived the merge');
  });
});
check('B1 · the strip: one card per watched player, starred order, name · rank · Elo; empty → no strip', () => {
  const { api, window } = load();
  assert.strictEqual(api.pgWatchStripHtml(), '', 'an empty watchlist drew a strip');
  window.pp2ToggleWatch('2382'); window.pp2ToggleWatch('1980');
  const h = api.pgWatchStripHtml();
  assert(/>Watchlist · 2</.test(h), 'the caps label is not "Watchlist · 2"');
  const names = [...h.matchAll(/pg-watchcard__name">([^<]+)</g)].map(m => m[1]);
  assert.deepStrictEqual(names, ['C. Alcaraz', 'A. Zverev'], 'starred order');
  assert(/#1 · Elo 2102/.test(h) && />#3</.test(h), 'rank · Elo meta (no Elo → rank alone)');
  return names.join(' · ');
});
check('B2 · ✕ removes the player (and repaints); a card opens his profile', () => {
  const { api, window, strip, opened } = load();
  window.pp2ToggleWatch('1980'); window.pp2ToggleWatch('2382');
  api.pgRenderWatchStrip();
  const ev = attr => ({ target: { closest: sel => (sel === '[data-watch-off]' && attr.off ? { getAttribute: () => attr.off } : sel === '[data-watch-open]' && attr.open ? { getAttribute: () => attr.open } : null) }, stopPropagation() {} });
  strip.listeners.click(ev({ off: '1980' }));
  assert.deepStrictEqual(window.pp2WatchKeys(), ['2382'], 'the ✕ did not remove him');
  assert(/>Watchlist · 1</.test(strip.innerHTML), 'the strip did not repaint');
  strip.listeners.click(ev({ open: '2382' }));
  assert.deepStrictEqual(opened, ['2382'], 'the card did not open his profile');
});

(async () => {
  for (const [name, fn] of queue) {
    try { const r = await fn(); pass++; console.log('  PASS  ' + name + (typeof r === 'string' ? '\n        ' + r : '')); }
    catch (e) { fail++; console.log('  FAIL  ' + name + ' :: ' + e.message); }
  }
  console.log(`\nPASS ${pass}   FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
