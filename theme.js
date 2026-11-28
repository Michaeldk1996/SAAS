/* TEN-376 foundation theme switch (README §5.14, §10 item 2).
   One attribute on <html>: data-theme="night" | "day". Mode (night | day | auto) lives under the one storage key
   `stennisfy-theme` (the key the Match analysis modal already used, so a saved choice carries over).
   Auto follows prefers-color-scheme live: light -> day, dark -> night.
   Loaded synchronously in <head>, before any stylesheet paints, so the first frame is already in the right theme.
   Charts that draw on canvas listen for `sf-themechange` and re-read their --viz-* tokens. */
(function () {
  var KEY = 'stennisfy-theme';
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  // Founder 2026-11-28: the app is night only. The Night / Day / Auto switch is gone from the avatar menu and a saved
  // Day / Auto no longer applies. The Day tokens stay in tokens.css, unused.
  function mode() { return 'night'; }
  function resolved(m) { return m === 'auto' ? (mq && mq.matches ? 'day' : 'night') : m; }
  function apply() {
    var m = mode(), t = resolved(m), root = document.documentElement;
    var changed = root.getAttribute('data-theme') !== t;
    root.setAttribute('data-theme', t);
    root.setAttribute('data-theme-mode', m);
    if (changed) {
      try { window.dispatchEvent(new CustomEvent('sf-themechange', { detail: { mode: m, theme: t } })); } catch (e) {}
    }
    return m;
  }
  function set(m) {
    try { localStorage.setItem(KEY, 'night'); } catch (e) {}
    var r = apply();
    try { window.dispatchEvent(new CustomEvent('sf-thememode', { detail: { mode: r } })); } catch (e) {}
    return r;
  }
  if (mq) {
    var onOs = function () { if (mode() === 'auto') apply(); };
    if (mq.addEventListener) mq.addEventListener('change', onOs); else if (mq.addListener) mq.addListener(onOs);
  }
  window.addEventListener('storage', function (e) { if (e.key === KEY) apply(); });
  window.sfTheme = { mode: mode, resolved: function () { return resolved(mode()); }, set: set, apply: apply,
    osIsLight: function () { return !!(mq && mq.matches); } };
  apply();

  // Big screens (founder 2026-11-26): every page is drawn for a 1512px window (the reference). A wider AND taller
  // window scales every size with it (one CSS zoom on <html>), so a 27" Mac shows the same page bigger instead of a
  // 1360px column and empty space. Never below 1: smaller windows keep their own layout.
  // --sf-z lets viewport units undo the zoom (calc(100vh / var(--sf-z, 1))). getBoundingClientRect / clientX are in
  // zoomed screen px while style.left / scrollTop are CSS px: sfCssRect / sfVW / sfVH / sfZ convert.
  var DESIGN_W = 1512, DESIGN_H = 860, MAX_Z = 2;
  function fit() {
    var z = Math.min(MAX_Z, (window.innerWidth || 0) / DESIGN_W, (window.innerHeight || 0) / DESIGN_H);
    z = z > 1 ? Math.floor(z * 100) / 100 : 1;
    var root = document.documentElement;
    if (!root || !root.style) return;
    root.style.zoom = z === 1 ? '' : String(z);
    root.style.setProperty('--sf-z', String(z));
    window.__sfZ = z;
  }
  window.sfZ = function () { return window.__sfZ || 1; };
  window.sfVW = function () { return window.innerWidth / window.sfZ(); };
  window.sfVH = function () { return window.innerHeight / window.sfZ(); };
  window.sfCssRect = function (el) {
    var r = el.getBoundingClientRect(), z = window.sfZ();
    return { left: r.left / z, top: r.top / z, right: r.right / z, bottom: r.bottom / z, width: r.width / z, height: r.height / z, x: r.x / z, y: r.y / z };
  };
  fit();
  window.addEventListener('resize', fit);
})();

/* First paint (2026-11-12): the dashboard hides <body> until html.sf-css-ready (its <head> rule `sf-first-paint`), because
   its page styles sit at the end of the file. DOMContentLoaded = the parser has passed every style block. Fallback 8 s. */
(function () {
  if (typeof document === 'undefined' || !document.documentElement || !document.documentElement.classList || !document.addEventListener) return;
  function ready() { document.documentElement.classList.add('sf-css-ready'); }
  if (document.readyState && document.readyState !== 'loading') ready();
  else document.addEventListener('DOMContentLoaded', ready);
  setTimeout(ready, 8000);
})();
