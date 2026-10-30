/* picks-shell.js — the Picks pieces that live outside the Picks page (LOCK 2026-10-30):
 *   - the Picks count badge on the rail (bets posted today, the Live count chip; hidden at 0);
 *   (no "+ Pick" on match cards or the analysis header: picks are posted only from the Picks page, founder 2026-10-30)
 *   - the admin badge on the rail avatar (the founder's account, isBspAdmin).
 * The shared sf-menu / rail markup is identical on account.html and stays untouched: these are painted onto it here.
 */
(function () {
  'use strict';
  function admin() { return typeof window.isBspAdmin === 'function' && !!window.isBspAdmin(); }

  // the admin badge on the rail avatar
  var SHIELD = '<svg width="9" height="9" viewBox="0 0 20 20" fill="none"><path d="M10 3l6 2.5v4.5c0 3.5-2.6 6.2-6 7-3.4-.8-6-3.5-6-7V5.5z" stroke-width="2.2" stroke-linejoin="round"></path></svg>';
  function paintBadge() {
    var av = document.getElementById('acctAvatar'); if (!av) return;
    var b = av.querySelector('.pk-admin');
    if (admin()) { if (!b) av.insertAdjacentHTML('beforeend', '<span class="pk-admin" title="Admin">' + SHIELD + '</span>'); }
    else if (b) b.remove();
  }

  // the Picks count badge (SIDEBAR_NAV, founder 2026-10-30; replaces the new-pick dot): the number of bets posted today
  // (status posted · live, today's Brussels day), on the Live count chip (.sf-count); no badge at 0. Every member counts
  // the same rows: the admin / a Pro member read the picks, any other member the teasers (picks-store.js loadDay).
  function setCount(n) {
    var ico = document.querySelector('#mainNav button[data-tab="picks"] .sf-ico'); if (!ico) return;
    var b = ico.querySelector('.pk-count');
    if (!(n > 0)) { if (b) b.remove(); return; }
    if (!b) { ico.insertAdjacentHTML('beforeend', '<span class="sf-count pk-count"></span>'); b = ico.querySelector('.pk-count'); }
    b.textContent = String(n);
    var btn = ico.closest('button'); if (btn) btn.title = 'Picks · ' + n + (n === 1 ? ' bet today' : ' bets today');
  }
  // today = the member-zone day (founder 2026-10-30, override 2), a pick's day = PicksCore.pickDay (its start, member
  // zone); the store is keyed by the Brussels `date`, so the stored days either side are read too
  function todayOpen(rows, day) {
    var seen = {};
    return (rows || []).filter(function (p) {
      if (!p || seen[p.id] || PicksCore.pickDay(p) !== day || !(p.status === 'posted' || p.status === 'live')) return false;
      seen[p.id] = 1; return true;
    }).sort(function (a, b) { return String(a.posted_at || '') < String(b.posted_at || '') ? -1 : 1; });   // posting order
  }
  function todayCount(rows, day) { return todayOpen(rows, day).length; }
  // ONE read of today's open picks, shared by the rail badge and the Bets today tile (the same count on both)
  function loadToday() {
    if (!window.PicksStore || !window.PicksCore) return Promise.reject(new Error('no store'));
    var day = PicksCore.viewDay(new Date().toISOString());
    return Promise.all(PicksCore.storedDaysAround(day).map(function (d) { return PicksStore.loadDay(d); }))
      .then(function (rs) { return todayOpen([].concat.apply([], rs.map(function (r) { return r.rows; })), day); });
  }
  function checkCount() {
    if (!window.PicksStore || !window.PicksCore) return;
    loadToday().then(function (rows) { setCount(rows.length); }).catch(function () { setCount(0); });
  }

  function onAuth() { paintBadge(); checkCount(); if (typeof window.mxBetsRefresh === 'function') window.mxBetsRefresh(); }
  if (window.BSP && BSP.onAuthChange) BSP.onAuthChange(function () { onAuth(); });
  if (window.BSP && BSP.whenAuthReady) BSP.whenAuthReady().then(onAuth);
  setInterval(function () { if (!document.hidden) checkCount(); }, 5 * 60000);
  window.PicksShell = { checkCount: checkCount, todayCount: todayCount, todayOpen: todayOpen, loadToday: loadToday, setCount: setCount, paintBadge: paintBadge };
})();
