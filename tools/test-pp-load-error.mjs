// The legacy full-page player view is retired (2026-10-21). A profile that cannot paint — the module never loaded,
// its mount refused, or its mount threw — shows "Couldn't load this profile" and a Retry: no figure, and no legacy page
// behind it. The real showPlayerProfile / pp2MountNow / ppShowLoadError / ppRetryProfile / ppRepaint are sliced out of
// bsp-consult-dashboard.html and run against a stub page; the last check applies each mutation below and fails if any
// survives.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../bsp-consult-dashboard.html', import.meta.url), 'utf8');
const FNS = ['showPlayerProfile', 'pp2MountNow', 'ppShowLoadError', 'ppRetryProfile', 'ppRepaint', 'pp2RepaintIfOpen'];
const fnSrc = (html, name) => {
  const i = html.indexOf(`\nfunction ${name}(`); assert.ok(i > -1, `${name} not found`);
  const j = html.indexOf('\n}\n', i); return html.slice(i, j + 3);
};

function page(html, { module = 'ok' } = {}) {
  const el = (id) => ({ id, style: { display: '' }, innerHTML: '', querySelector(sel) { return sel === '.pp2-main' && this.innerHTML.includes('pp2-main') ? {} : null; } });
  const view = el('playerProfileView'), list = el('playerListView'), appended = [];
  const w = { scrollTo() {} };
  if (module) w.PlayerProfileV2 = {
    mount(v, key) { if (module === 'throws') throw new Error('boom'); if (module === 'refuses') return false; v.innerHTML = `<div class="pp2-main">${key}</div>`; return true; },
    repaint() { view.innerHTML = '<div class="pp2-main">repainted</div>'; },
  };
  const env = {
    window: w, ppState: { key: null }, playerProfiles: { 1099: { key: '1099', name: 'D. Altmaier' } },
    document: { getElementById: (id) => (id === 'playerProfileView' ? view : id === 'playerListView' ? list : null),
      createElement: () => ({}), head: { appendChild: (t) => appended.push(t) } },
    SfNav: null, opened: [], pp2CancelPendingMount() {}, closePpSplitDrawer() {}, pp2Bridge() {}, pp2DbJoinAfterPaint() {}, console: { warn() {} },
  };
  // showPlayerProfileV2 is the host's real gate (profile + module present → mount); pp2MountNow is the real one
  const body = FNS.map(n => fnSrc(html, n)).join('\n') + `
    function showPlayerProfileV2(key){ opened.push(key); if (!window.PlayerProfileV2 || !window.PlayerProfileV2.mount) return false; ppState.key = String(key); return pp2MountNow(key); }
    return { showPlayerProfile, pp2MountNow, ppRetryProfile, ppRepaint, pp2RepaintIfOpen };`;
  const api = new Function(...Object.keys(env), body.replace(/\bwindow\.scrollTo\b/g, 'window.scrollTo'))(...Object.values(env));
  return { api, view, list, env, appended };
}
const text = (h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const isError = (v) => /Couldn't load this profile/.test(v.innerHTML) && /onclick="ppRetryProfile\(\)"[^>]*>Retry</.test(v.innerHTML);

const CHECKS = [
  ['module never loaded → the error state, a Retry, no figure', (html) => {
    const P = page(html, { module: null }); P.api.showPlayerProfile('1099');
    assert.ok(isError(P.view), 'no error state'); assert.equal(P.list.style.display, 'none');
    assert.equal(text(P.view.innerHTML), "Couldn't load this profile Retry", 'the error state carries nothing but its message and Retry');
    assert.ok(!/\d/.test(text(P.view.innerHTML)), 'a digit on the error state');
  }],
  ['mount refused → the error state', (html) => { const P = page(html, { module: 'refuses' }); P.api.showPlayerProfile('1099'); assert.ok(isError(P.view)); }],
  ['mount threw → the error state, not an exception', (html) => { const P = page(html, { module: 'throws' }); P.api.showPlayerProfile('1099'); assert.ok(isError(P.view)); }],
  ['the async first paint that fails lands on the error state too', (html) => { const P = page(html, { module: 'refuses' }); assert.equal(P.api.pp2MountNow('1099'), false); assert.ok(isError(P.view)); }],
  ['a profile that mounts shows the profile, no error', (html) => {
    const P = page(html); P.api.showPlayerProfile('1099');
    assert.ok(P.view.innerHTML.includes('pp2-main') && !isError(P.view));
  }],
  ['a lazy loader repainting over the error state leaves it (no legacy page behind it)', (html) => {
    const P = page(html, { module: 'refuses' }); P.api.showPlayerProfile('1099'); const before = P.view.innerHTML;
    P.api.ppRepaint(); assert.equal(P.view.innerHTML, before);
  }],
  ["a shard landing over the error state does not paint the module's previous player there", (html) => {
    const P = page(html, { module: 'refuses' }); P.api.showPlayerProfile('1099'); const before = P.view.innerHTML;
    P.api.pp2RepaintIfOpen('1099'); assert.equal(P.view.innerHTML, before);
  }],
  ['Retry with the module present opens the profile again', (html) => {
    const P = page(html, { module: 'refuses' }); P.api.showPlayerProfile('1099'); P.env.window.PlayerProfileV2.mount = (v, k) => { v.innerHTML = `<div class="pp2-main">${k}</div>`; return true; };
    P.api.ppRetryProfile(); assert.ok(P.view.innerHTML.includes('pp2-main'), 'Retry did not reopen');
  }],
  ['Retry with the module absent fetches it again, then reopens', (html) => {
    const P = page(html, { module: null }); P.api.showPlayerProfile('1099');
    P.api.ppRetryProfile(); assert.equal(P.appended.length, 1); assert.match(P.appended[0].src, /^player-profile-v2\.js\?retry=\d+$/);
    const n = P.env.opened.length; P.appended[0].onload(); assert.equal(P.env.opened.length, n + 1, 'the reload did not reopen the profile');
  }],
  ['the legacy view is gone from the page source', (html) => {
    const code = html.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    for (const n of ['buildPlayerProfileHtml', 'ppCareerYears', 'pp2FlagOn']) assert.ok(!new RegExp(`\\b${n}\\b`).test(code), `${n} still in the page`);
    assert.match(html, /window\.FEATURE_PP2 = true;/, 'v2 is not unconditionally on');
  }],
];

const MUTANTS = [
  ['no error state when v2 does not open', '  if (showPlayerProfileV2(key)) return;\n  ppShowLoadError(key);', '  if (showPlayerProfileV2(key)) return;'],
  ['a mount that throws escapes', 'try { ok = !!window.PlayerProfileV2.mount(view, key); } catch (e) {', 'try { ok = !!window.PlayerProfileV2.mount(view, key); } finally {'],
  ['a refused async mount leaves a blank page', "if (!ok) { ppShowLoadError(key); return false; }", 'if (!ok) { return false; }'],
  ['the error state prints the player key', "Couldn't load this profile</span>", "Couldn't load this profile ${key}</span>"],
  ['Retry is not wired', 'onclick="ppRetryProfile()"', 'onclick=""'],
  ['ppRepaint paints over the error state', '  // nothing else paints here: the legacy page is retired', "  view.innerHTML = '<div>legacy</div>';\n  // nothing else paints here: the legacy page is retired"],
  ['a lazy v2 repaint lands on any page', "view.style.display !== 'none' && view.querySelector('.pp2-main') && window.PlayerProfileV2", "view.style.display !== 'none' && window.PlayerProfileV2"],
  ['Retry never refetches a missing module', "tag.onload = tag.onerror = () => { if (ppState.key === key) showPlayerProfile(key); };\n  document.head.appendChild(tag);", 'showPlayerProfile(key);'],
];

let failed = 0;
const ok = (name, fn) => { try { fn(); console.log(`  ✓ ${name}`); } catch (e) { failed++; console.log(`  ✗ ${name}\n      ${e.message}`); } };
console.log('test-pp-load-error');
for (const [name, fn] of CHECKS) ok(name, () => fn(SRC));
ok(`mutants: ${MUTANTS.length} applied, every one caught`, () => {
  for (const [label, from, to] of MUTANTS) {
    assert.equal(SRC.split(from).length, 2, `mutant anchor not unique: ${label}`);
    const m = SRC.replace(from, () => to);
    let caught = false;
    for (const [, fn] of CHECKS) { try { fn(m); } catch { caught = true; break; } }
    assert.ok(caught, `mutant survived: ${label}`);
  }
});
if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('all passed');
