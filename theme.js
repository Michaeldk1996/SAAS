/* TEN-376 foundation theme switch (README §5.14, §10 item 2).
   One attribute on <html>: data-theme="night" | "day". Mode (night | day | auto) lives under the one storage key
   `stennisfy-theme` (the key the Match analysis modal already used, so a saved choice carries over).
   Auto follows prefers-color-scheme live: light -> day, dark -> night.
   Loaded synchronously in <head>, before any stylesheet paints, so the first frame is already in the right theme.
   Charts that draw on canvas listen for `sf-themechange` and re-read their --viz-* tokens. */
(function () {
  var KEY = 'stennisfy-theme';
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  function mode() {
    try { var v = localStorage.getItem(KEY); return v === 'day' || v === 'auto' ? v : 'night'; } catch (e) { return 'night'; }
  }
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
    try { localStorage.setItem(KEY, m === 'day' || m === 'auto' ? m : 'night'); } catch (e) {}
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

  // README §5.14 — the Night · Day · Auto switch (darker track), in the rail's avatar menu (TEN-403). Markup: <div data-sf-theme-switch></div>.
  // Under it, only while Auto is on, a 10.5px --text-label note "Auto · following the OS (light|dark)".
  // Each option = 14px glyph + word (TEN-403 avatar menu, the shell package's reference: moon / sun / half disc).
  var LABELS = [['night', 'Night', 'M16.2 12.3A6.5 6.5 0 017.7 3.8a6.5 6.5 0 108.5 8.5z'],
    ['day', 'Day', 'M10 6.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7M10 2.5v1.6M10 15.9v1.6M2.5 10h1.6M15.9 10h1.6M4.7 4.7l1.1 1.1M14.2 14.2l1.1 1.1M4.7 15.3l1.1-1.1M14.2 5.8l1.1-1.1'],
    ['auto', 'Auto', 'M10 3a7 7 0 100 14 7 7 0 000-14zM10 3v14']];
  function renderSwitch(host) {
    var m = mode();
    host.innerHTML = '<div class="sf-theme-seg" role="radiogroup" aria-label="Theme">' + LABELS.map(function (o) {
      var on = o[0] === m;
      return '<button type="button" role="radio" aria-checked="' + on + '" data-mode="' + o[0] + '" class="sf-theme-opt' + (on ? ' on' : '') + '"><svg viewBox="0 0 20 20" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + o[2] + '"/></svg>' + o[1] + '</button>';
    }).join('') + '</div>' + (m === 'auto' ? '<div class="sf-theme-note">Auto · following the OS (' + (mq && mq.matches ? 'light' : 'dark') + ')</div>' : '');
  }
  function mountAll() {
    var hosts = document.querySelectorAll('[data-sf-theme-switch]');
    for (var i = 0; i < hosts.length; i++) {
      var h = hosts[i];
      renderSwitch(h);
      if (!h.__sfBound) {
        h.__sfBound = true;
        h.addEventListener('click', function (e) {
          var b = e.target.closest && e.target.closest('[data-mode]');
          if (b) set(b.getAttribute('data-mode'));
        });
      }
    }
  }
  window.addEventListener('sf-thememode', mountAll);
  window.addEventListener('sf-themechange', mountAll);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll); else mountAll();
  window.sfTheme.mountSwitch = mountAll;
})();
