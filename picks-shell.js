/* picks-shell.js — the Picks pieces that live outside the Picks page (board 1k, Task 3; founder 2026-10-27):
 *   - "+ Pick" (admin) in the analysis modal header of an upcoming match → the Post-a-pick drawer, pre-filled;
 *     (the match-card footer "+ Pick" is drawn by the card template itself: pkPlusHtml below);
 *   - the new-pick dot on the rail's Picks icon: a pick posted since this member last opened Picks
 *     (users/{uid}.picksSeenAt, the member's own document); cleared on opening Picks;
 *   - the admin badge on the rail avatar (the founder's account, isBspAdmin).
 * The shared sf-menu / rail markup is identical on account.html and stays untouched: these are painted onto it here.
 */
(function () {
  'use strict';
  function admin() { return typeof window.isBspAdmin === 'function' && !!window.isBspAdmin(); }
  function boardMatch(id) { return typeof matchById === 'function' ? matchById(id) : null; }   // eslint-disable-line no-undef

  // the card footer's "+ Pick" (admin, upcoming only) — called from the card template
  window.pkPlusHtml = function (m) {
    if (!admin() || !m || m.finalScore != null || m.live) return '';
    return '<button type="button" class="pk-plus" data-pkplus="' + String(m.id).replace(/"/g, '&quot;') + '" title="Post a pick on this match"'
      + ' onclick="event.stopPropagation(); window.PicksDrawer && PicksDrawer.openNew(matchById(this.dataset.pkplus));"><span class="pk-plus__p">+</span>Pick</button>';
  };

  // the analysis modal header's "+ Pick"
  function modalPlus(id) {
    var cell = document.querySelector('#analysisModal .aclosecell'); if (!cell) return;
    var old = cell.querySelector('.pk-plus'); if (old) old.remove();
    var m = boardMatch(id), html = window.pkPlusHtml(m);
    if (!html) return;
    cell.insertAdjacentHTML('afterbegin', html);
    cell.classList.add('pk-plus-cell');
  }
  if (typeof window.openAnalysisModal === 'function' && !window.openAnalysisModal._picks) {
    var openA = window.openAnalysisModal;
    window.openAnalysisModal = function (id) { var r = openA.apply(this, arguments); try { modalPlus(id); } catch (e) { /* the modal stands without it */ } return r; };
    window.openAnalysisModal._picks = true;
  }

  // the admin badge on the rail avatar
  var SHIELD = '<svg width="9" height="9" viewBox="0 0 20 20" fill="none"><path d="M10 3l6 2.5v4.5c0 3.5-2.6 6.2-6 7-3.4-.8-6-3.5-6-7V5.5z" stroke-width="2.2" stroke-linejoin="round"></path></svg>';
  function paintBadge() {
    var av = document.getElementById('acctAvatar'); if (!av) return;
    var b = av.querySelector('.pk-admin');
    if (admin()) { if (!b) av.insertAdjacentHTML('beforeend', '<span class="pk-admin" title="Admin">' + SHIELD + '</span>'); }
    else if (b) b.remove();
  }

  // the new-pick dot
  function userDoc() {
    var u = window.BSP && BSP.currentUser ? BSP.currentUser() : null;
    return u && window.firebase && firebase.firestore ? firebase.firestore().collection('users').doc(u.uid) : null;
  }
  function onPicks() { var b = document.querySelector('#mainNav button[data-tab="picks"]'); return !!(b && b.classList.contains('active')); }
  function setDot(on) {
    var ico = document.querySelector('#mainNav button[data-tab="picks"] .sf-ico'); if (!ico) return;
    var d = ico.querySelector('.pk-dot');
    if (on && !d) ico.insertAdjacentHTML('beforeend', '<span class="pk-dot" title="New pick since your last visit"></span>');
    if (!on && d) d.remove();
  }
  function seen() {
    var ref = userDoc(); setDot(false);
    if (ref) ref.set({ picksSeenAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }).catch(function () { /* the dot just returns */ });
  }
  function checkDot() {
    if (!window.PicksStore) return;
    if (onPicks()) { seen(); return; }
    var ref = userDoc(); if (!ref) { setDot(false); return; }
    Promise.all([PicksStore.latestPostedAt(), ref.get().then(function (s) { var v = s.data() && s.data().picksSeenAt; return v && v.toDate ? v.toDate().toISOString() : null; })])
      .then(function (g) { setDot(!!g[0] && (!g[1] || g[0] > g[1])); }).catch(function () { setDot(false); });
  }
  var navBtn = document.querySelector('#mainNav button[data-tab="picks"]');
  if (navBtn) navBtn.addEventListener('click', function () { setTimeout(seen, 0); });
  window.addEventListener('hashchange', function () { if (location.hash === '#picks') seen(); });

  function onAuth() { paintBadge(); checkDot(); if (typeof window.mxBetsRefresh === 'function') window.mxBetsRefresh(); }
  if (window.BSP && BSP.onAuthChange) BSP.onAuthChange(function () { onAuth(); });
  if (window.BSP && BSP.whenAuthReady) BSP.whenAuthReady().then(onAuth);
  setInterval(function () { if (!document.hidden) checkDot(); }, 5 * 60000);
  window.PicksShell = { checkDot: checkDot, paintBadge: paintBadge };
})();
