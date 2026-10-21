/* Stennisfy — one Escape handler for the whole dashboard (ESC brief, 2026-10-21).
 *
 * Every surface that Esc can close registers a layer here instead of binding its own keydown listener:
 *
 *   (window.sfEscLayers = window.sfEscLayers || []).push({ id, z, isOpen, close, ownFocus?, always? });
 *
 * Order-independent, the same pattern as window.sfOverlayClosers, so a deferred script can register before or
 * after this file runs. One press closes ONE layer, chosen in this order:
 *
 *   1. tooltip / dropdown / menu            (z >= Z.menu)
 *   2. a focused text field                 clear its text; a second press blurs it. Never navigates.
 *   3. modal / sheet / drawer / overlay     (z <  Z.menu), highest z first
 *   4. detail view                          back to the exact view it was opened from (SfNav below)
 *   5. nothing open                         no-op
 *
 * Step 2 sits above step 3 on purpose: Esc while typing only ever touches the field (brief, change 2). A picker
 * whose search box has focus is a step-1 menu, so it still closes first.
 *
 * Detail views (player profile, the Tournaments page reached from News, the Model page reached from a match) do
 * not push browser history: Back is unchanged and leaves the dashboard as before. SfNav keeps its own origin
 * stack instead, and the on-screen Back link uses the same stack, so Esc and that link always agree.
 */
(function (root) {
  'use strict';

  var Z = { tip: 100, menu: 90, sheet: 80, pop: 78, overlay: 76, modal: 74, drawer: 72 };

  function layers() { return (root.sfEscLayers = root.sfEscLayers || []); }

  function openOf(L) {
    try { return !!L.isOpen(); } catch (err) { console.error('sfEsc isOpen', L && L.id, err); return false; }
  }
  function topLayer(minZ, maxZ) {
    var best = null;
    layers().forEach(function (L) {
      if (L.z < minZ || L.z >= maxZ || !openOf(L)) return;
      if (!best || L.z > best.z) best = L;
    });
    return best;
  }

  var TEXTISH = /^(text|search|email|url|tel|number|password|date|datetime-local|month|time|week)$/i;
  function fieldOf(el) {
    if (!el || el.nodeType !== 1) return null;
    var tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return el;
    if (tag === 'INPUT') return TEXTISH.test(el.type || 'text') ? el : null;
    return el.isContentEditable ? el : null;
  }

  // ---- focus return ------------------------------------------------------------------------------------------
  // The element that opened a layer is whatever the reader last pressed before that layer appeared. A pointerdown
  // or Enter/Space snapshots which layers are open; a tick later, any layer that is now open gets that element.
  var openers = {};
  var lastTrigger = null;
  function onTrigger(e) {
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    var t = e.target && e.target.nodeType === 1 ? e.target : null;
    if (!t) return;
    lastTrigger = t;
    var before = {};
    layers().forEach(function (L) { before[L.id] = openOf(L); });
    var assign = function () {
      layers().forEach(function (L) { if (!before[L.id] && openOf(L) && !openers[L.id]) openers[L.id] = t; });
    };
    setTimeout(assign, 0);
    setTimeout(assign, 400);   // a layer that waits on a fetch
  }
  function visible(el) { return !!(el && el.isConnected && el.getClientRects && el.getClientRects().length); }
  function refocus(el, sel) {
    if (!visible(el) && sel) { try { el = document.querySelector(sel); } catch (_) { el = null; } }
    // an opener that cannot take focus (a link with no href, a plain div) hands it to its nearest focusable ancestor
    var host = el && el.closest && el.closest('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])');
    if (host) el = host;
    if (!visible(el)) return false;
    try { el.focus({ preventScroll: true }); } catch (_) { return false; }
    return document.activeElement === el;
  }
  // A stable selector for an opener that a re-render may replace.
  function selectorFor(el) {
    if (!el || el.nodeType !== 1 || typeof CSS === 'undefined' || !CSS.escape) return null;
    if (el.id) return '#' + CSS.escape(el.id);
    var host = el.closest && el.closest('[data-id],[data-key],[data-card-idx],[data-match-id]');
    if (!host) return null;
    var attrs = ['data-id', 'data-key', 'data-card-idx', 'data-match-id'];
    for (var i = 0; i < attrs.length; i++) {
      var v = host.getAttribute(attrs[i]);
      if (v != null) return '[' + attrs[i] + '="' + CSS.escape(v) + '"]';
    }
    return null;
  }

  // ---- the one handler ---------------------------------------------------------------------------------------
  // Returns what it did, for the test harness: 'menu:<id>', 'clear', 'blur', 'layer:<id>', 'back', or 'none'.
  function handle(e) {
    if (!e || e.key !== 'Escape' || e.isComposing) return 'none';
    var act = 'none';
    var top = topLayer(Z.menu, Infinity);
    var field = top ? null : fieldOf(document.activeElement);
    if (!top && !field) top = topLayer(-Infinity, Z.menu);
    // "always" hooks tidy state that is pending but not on screen (a tooltip waiting on its delay); they never take
    // the press. Run after `top` is chosen so a tidy-up cannot hide the layer this press is meant for.
    layers().forEach(function (L) {
      if (L !== top && typeof L.always === 'function') { try { L.always(); } catch (err) { console.error('sfEsc always', L.id, err); } }
    });
    if (top) {
      var opener = openers[top.id];
      delete openers[top.id];
      try { top.close(); } catch (err) { console.error('sfEsc close', top.id, err); }
      if (!top.ownFocus && opener && !openOf(top)) refocus(opener);
      act = (top.z >= Z.menu ? 'menu:' : 'layer:') + top.id;
    } else if (field) {
      var clearable = field.tagName !== 'SELECT' && !field.isContentEditable && field.value !== '';
      if (clearable) {
        field.value = '';
        field.dispatchEvent(new Event('input', { bubbles: true }));   // each search re-renders off its own input listener
        act = 'clear';
      } else {
        field.blur();
        act = 'blur';
      }
    } else if (SfNav.canBack()) {
      SfNav.back();
      act = 'back';
    }
    if (act !== 'none') { e.preventDefault(); e.stopImmediatePropagation(); }
    return act;
  }

  // ---- detail-view origin stack ------------------------------------------------------------------------------
  // The dashboard supplies the hooks (window.sfNavHooks) because only it knows its tabs:
  //   activeTab() → tab id        subView() → {kind,key} | null      modalState() → {id,tab} | null
  //   leave(dest)                 activateTab(tab, hash)             showSub(sub)      reopenModal(state)
  var stack = [];
  var pending = null;        // snapshot taken just before a programmatic tab switch
  var closedModal = null;    // the analysis modal state if it closed in this same task
  var restoring = false;
  function hooks() { return root.sfNavHooks || null; }
  function soon(fn) { (typeof queueMicrotask === 'function' ? queueMicrotask : function (f) { Promise.resolve().then(f); })(fn); }

  function capture() {
    var H = hooks();
    var el = (lastTrigger && lastTrigger.isConnected) ? lastTrigger : document.activeElement;
    return {
      tab: H.activeTab(), sub: H.subView(), modal: H.modalState() || closedModal,
      x: root.scrollX || 0, y: root.scrollY || 0, hash: root.location ? root.location.hash : '',
      opener: el && el !== document.body ? el : null, openerSel: selectorFor(el)
    };
  }

  var SfNav = {
    // The dashboard calls this for a programmatic sidebar click, BEFORE the tab changes.
    preNav: function () {
      if (restoring || !hooks()) return;
      pending = capture();
      soon(function () { pending = null; });
    },
    noteModalClosed: function (state) {
      if (!state) return;
      closedModal = state;
      soon(function () { closedModal = null; });
    },
    // A detail view is opening, landing on tab `dest`. Takes the pre-navigation snapshot if this same task took
    // one, else the view as it is now.
    push: function (dest) {
      if (restoring || !hooks()) return;
      var s = pending || capture();
      pending = null;
      s.dest = dest;
      stack.push(s);
      if (stack.length > 24) stack.shift();
    },
    // A sidebar click by the reader starts a fresh trail.
    clear: function () { stack.length = 0; pending = null; },
    canBack: function () {
      var H = hooks();
      if (!H || !stack.length) return false;
      var top = stack[stack.length - 1];
      if (H.activeTab() === top.dest) return true;
      stack.length = 0;            // the reader is somewhere this trail no longer describes
      return false;
    },
    back: function () {
      var H = hooks();
      if (!H || !stack.length) return false;
      var s = stack.pop();
      restoring = true;
      try {
        H.leave(s.dest);
        if (H.activeTab() !== s.tab) H.activateTab(s.tab, s.hash);
        if (s.sub) H.showSub(s.sub);
        if (s.modal) H.reopenModal(s.modal);
      } finally { restoring = false; }
      // A profile render scrolls to the top and a lazy page may still be growing: re-apply until it sticks.
      var tries = 0;
      var settle = function () {
        root.scrollTo(s.x, s.y);
        if (Math.abs((root.scrollY || 0) - s.y) > 1 && ++tries < 8) setTimeout(settle, 60);
        else refocus(s.opener, s.openerSel);
      };
      root.scrollTo(s.x, s.y);
      (root.requestAnimationFrame || setTimeout)(settle);
      return true;
    },
    depth: function () { return stack.length; }
  };

  var SfEsc = { Z: Z, handle: handle, topLayer: topLayer, fieldOf: fieldOf, selectorFor: selectorFor };
  root.SfEsc = SfEsc;
  root.SfNav = SfNav;

  if (root.document && root.document.addEventListener && !root.__sfEscBound) {
    root.__sfEscBound = true;
    // Capture phase on the document, bound in <head> before any other script: this runs first and, when it acts,
    // stops the event, so no surface can close a second layer on the same press.
    root.document.addEventListener('keydown', handle, true);
    root.document.addEventListener('pointerdown', onTrigger, true);
    root.document.addEventListener('keydown', onTrigger, true);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { SfEsc: SfEsc, SfNav: SfNav };
})(typeof globalThis !== 'undefined' ? globalThis : window);   // the page registers on globalThis (=== window in a browser)
