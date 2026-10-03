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

  // README §5.14 — the sidebar Night · Day · Auto switch (darker track). Markup: <div data-sf-theme-switch></div>.
  // Under it, only while Auto is on, a 10.5px --text-label note "Auto · following the OS (light|dark)".
  var LABELS = [['night', 'Night'], ['day', 'Day'], ['auto', 'Auto']];
  function renderSwitch(host) {
    var m = mode();
    host.innerHTML = '<div class="sf-theme-seg" role="radiogroup" aria-label="Theme">' + LABELS.map(function (o) {
      var on = o[0] === m;
      return '<button type="button" role="radio" aria-checked="' + on + '" data-mode="' + o[0] + '" class="sf-theme-opt' + (on ? ' on' : '') + '">' + o[1] + '</button>';
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
