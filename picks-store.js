/* picks-store.js — the Picks page's data: Firestore `picks` (full rows) and `picks_public` (teasers), read and written
 * through the site's Firebase session (auth.js). Access is enforced by firestore.rules, not here:
 *   - the admin (the founder's uid, isAdmin) reads everything and is the only writer;
 *   - a Pro member (users/{uid}.plan === 'pro', set by the Whop webhook only) reads posted / live / settled picks;
 *   - any other signed-in member reads settled picks and the teasers of today's posted / live ones — the teaser holds
 *     only what a blurred card shows, so a real pick never reaches a non-Pro browser.
 * The client writes only what the founder types (the pick, the stake, the note) plus the match identity and the price the
 * drawer read; Open / Now / Close / result / CLV / P/L are filled by tools/picks-updater.mjs with the Admin SDK.
 *
 * Every row leaves here in the picks.json shape picks-core.js reads (ISO strings for times). window.PicksStore.
 */
(function () {
  'use strict';
  var SETTLED = ['won', 'lost', 'void'], OPEN = ['posted', 'live'];

  function db() { return window.firebase && firebase.firestore ? firebase.firestore() : null; }
  function user() { return window.BSP && BSP.currentUser ? BSP.currentUser() : null; }
  function isAdmin() { return typeof window.isBspAdmin === 'function' ? !!window.isBspAdmin() : false; }
  function isPro() { return window.sfPlan === 'pro'; }
  function ready() {
    if (!window.BSP || !BSP.whenAuthReady) return Promise.resolve(null);
    return BSP.whenAuthReady().then(function () { return db() && user() ? { db: db(), user: user(), admin: isAdmin(), pro: isPro() } : null; });
  }

  function iso(v) {
    if (v == null) return null;
    if (typeof v === 'string') return v;
    if (v && typeof v.toDate === 'function') return v.toDate().toISOString();
    if (v instanceof Date) return v.toISOString();
    return null;
  }
  // a Firestore pick → the picks.json row shape
  function row(doc, teaser) {
    var d = doc.data() || {};
    var r = {
      id: doc.id, kind: d.kind || 'match', event: d.event || null, market_text: d.market_text || null, settles_at: d.settles_at || null,
      date: d.date, tournament: d.tournament || null, round: d.round || null, scheduled_at: iso(d.scheduled_at), surface: d.surface || null,
      match_id: d.match_id == null ? null : d.match_id,
      player_a: d.player_a || null, player_b: d.player_b || null, selection: d.selection || 'a', market: d.market || null, line: d.line || null,
      book: d.book || 'bet105', price_source: d.price_source || 'feed',
      open_price: num(d.open_price), posted_price: num(d.posted_price), posted_at: iso(d.posted_at),
      now_price: num(d.now_price), opp_now_price: num(d.opp_now_price), close_price: num(d.close_price), opp_close_price: num(d.opp_close_price),
      stake: num(d.stake), note: d.note || '', model_pct: num(d.model_pct), status: d.status, void_reason: d.void_reason || null,
      result: d.result || null, edited_at: iso(d.edited_at), frozen_at: iso(d.frozen_at)
    };
    if (teaser) { r._teaser = true; r.player_a = null; r.player_b = null; r.posted_price = null; r.note = ''; }
    return r;
  }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  // One day as the signed-in member may see it. -> { rows, role }
  function loadDay(day) {
    return ready().then(function (s) {
      if (!s) return { rows: [], role: 'signed-out' };
      var P = s.db.collection('picks'), T = s.db.collection('picks_public');
      if (s.admin) return P.where('date', '==', day).get().then(function (q) { return { rows: q.docs.map(function (x) { return row(x); }), role: 'admin' }; });
      // one query per rule branch: Firestore only runs a query whose every possible result the rules allow
      if (s.pro) return Promise.all([
        P.where('date', '==', day).where('status', 'in', OPEN).get(),
        P.where('date', '==', day).where('status', 'in', SETTLED).get()
      ]).then(function (g) { return { rows: g[0].docs.concat(g[1].docs).map(function (x) { return row(x); }), role: 'pro' }; });
      return Promise.all([
        P.where('date', '==', day).where('status', 'in', SETTLED).get(),
        T.where('date', '==', day).where('status', 'in', OPEN).get()
      ]).then(function (g) {
        return { rows: g[0].docs.map(function (x) { return row(x); }).concat(g[1].docs.map(function (x) { return row(x, true); })), role: 'member' };
      });
    });
  }
  // Settled picks since `fromDay` (the Record strip and the ledger).
  function loadSettled(fromDay) {
    return ready().then(function (s) {
      if (!s) return [];
      // status only (no range on date: that would need a composite index); the window is cut here
      return s.db.collection('picks').where('status', 'in', SETTLED).get()
        .then(function (q) { return q.docs.map(function (x) { return row(x); }).filter(function (r) { return !fromDay || r.date >= fromDay; }); });
    });
  }
  // The newest posted_at of any pick a member can see (the nav dot): teasers carry it for everyone.
  function latestPostedAt() {
    return ready().then(function (s) {
      if (!s) return null;
      return s.db.collection('picks_public').orderBy('posted_at', 'desc').limit(1).get()
        .then(function (q) { return q.docs[0] ? iso(q.docs[0].data().posted_at) : null; });
    }).catch(function () { return null; });
  }

  // ── writes (admin only; firestore.rules refuses anyone else) ──
  var CLIENT = ['kind', 'event', 'market_text', 'settles_at', 'date', 'tournament', 'round', 'scheduled_at', 'surface', 'match_id',
    'player_a', 'player_b', 'selection', 'market', 'line', 'book', 'price_source', 'posted_price', 'stake', 'note', 'model_pct'];
  var TEASER = ['kind', 'event', 'date', 'tournament', 'round', 'scheduled_at', 'surface', 'market', 'stake'];
  function pickOut(src, keys) { var o = {}; keys.forEach(function (k) { if (src[k] !== undefined) o[k] = src[k]; }); return o; }
  function stamp() { return firebase.firestore.FieldValue.serverTimestamp(); }

  // draft: true saves a draft (never shown, never counted); otherwise posts now.
  function post(pick, opts) {
    opts = opts || {};
    return ready().then(function (s) {
      if (!s || !s.admin) throw new Error('Only the admin can post a pick.');
      var ref = s.db.collection('picks').doc();
      var d = pickOut(pick, CLIENT);
      d.status = opts.draft ? 'draft' : 'posted'; d.created_by = s.user.uid;
      if (!opts.draft) d.posted_at = stamp();
      var b = s.db.batch();
      b.set(ref, d);
      if (!opts.draft) {
        var t = pickOut(pick, TEASER); t.status = 'posted'; t.posted_at = stamp();
        b.set(s.db.collection('picks_public').doc(ref.id), t);
      }
      return b.commit().then(function () { return ref.id; });
    });
  }
  // within 10 minutes of posting: note and stake only
  function edit(id, patch) {
    return ready().then(function (s) {
      if (!s || !s.admin) throw new Error('Only the admin can edit a pick.');
      var d = pickOut(patch, ['note', 'stake']); d.edited_at = stamp();
      var b = s.db.batch();
      b.update(s.db.collection('picks').doc(id), d);
      if (patch.stake != null) b.update(s.db.collection('picks_public').doc(id), { stake: patch.stake });
      return b.commit();
    });
  }
  function voidPick(id, reason) {
    return ready().then(function (s) {
      if (!s || !s.admin) throw new Error('Only the admin can void a pick.');
      if (!String(reason || '').trim()) throw new Error('Voiding needs a reason.');
      var b = s.db.batch();
      b.update(s.db.collection('picks').doc(id), { status: 'void', void_reason: String(reason).trim(), edited_at: stamp() });
      b.update(s.db.collection('picks_public').doc(id), { status: 'void' });
      return b.commit();
    });
  }

  window.PicksStore = { ready: ready, loadDay: loadDay, loadSettled: loadSettled, latestPostedAt: latestPostedAt,
    post: post, edit: edit, voidPick: voidPick, isAdmin: isAdmin, _row: row };
})();
