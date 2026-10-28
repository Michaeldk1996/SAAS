/* bettracker-store.js — the Bet Tracker's storage adapter: the ONLY code on the page that touches storage.
 *
 * T1 backs it with the browser's localStorage (one schema-versioned document, `v: 1`); the API is the seam a server
 * table replaces later without touching the page:
 *   listBanks() · saveBank(bank) · deleteBank(id) · listBets(bankId) · saveBet(bet) · lockBet(id) · importBets · removeImport · nextId()
 * Bankroll = { id, name, archived, createdAt, plan }. Bet = the README data contract (design_handoff_bet_tracker §Data
 * contract) + createdAt, lockedAt; `date` is the local day 'YYYY-MM-DD'.
 *
 * Lock is irreversible here, not in the page: lockBet stamps lockedAt; saveBet refuses any record whose stored copy
 * carries lockedAt (and never takes lockedAt from its caller); deleteBank refuses a bankroll holding a locked result.
 * Historical results load as locked (README "a bet is locked when it has a result and is either historical (not posted
 * this session) or explicitly locked"): listBets stamps lockedAt on every settled record this browser session did not
 * write. "This session" = the tab session (sessionStorage), so a reload keeps an unlocked result undoable; a new tab
 * does not. An imported record (`source` set — the Bet-Analytix import, T1b) is never auto-locked: imported rows stay
 * unlocked until the admin locks them one by one (founder ruling 2026-10-28, R&D: the admin reviews first).
 * importBets(bankId, bets, source) writes a whole import in one write; removeImport(bankId, source) wipes it in one
 * call so it can be redone — refused while any of its rows is locked (a locked result is frozen).
 *
 * window.BetTrackerStore = the default instance; BetTrackerStore.create({ local, session, now }) builds one on any
 * Storage-shaped pair (tests: tools/test-bettracker-store.mjs). An unavailable / throwing storage falls back to memory.
 */
(function (root) {
  'use strict';

  var KEY = 'stennisfy.bettracker', SESSION_KEY = 'stennisfy.bettracker.session', V = 1;
  var RESULTS = { won: 1, lost: 1, void: 1 };
  var DEFAULT_BANK = 'Bankroll 1';

  function memory() { var m = {}; return { getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; }
  function safe(get) { try { var s = get(); var t = '__bt_probe'; s.setItem(t, t); s.removeItem(t); return s; } catch (e) { return memory(); } }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  function create(opts) {
    opts = opts || {};
    var local = opts.local || memory(), session = opts.session || memory();
    var now = opts.now || function () { return new Date(); };

    // A document written by a newer schema is never overwritten by this one: it reads as empty and writes refuse.
    var foreign = false;
    function read() {
      var raw = null; try { raw = local.getItem(KEY); } catch (e) { raw = null; }
      if (!raw) return { v: V, banks: [], bets: [] };
      var doc; try { doc = JSON.parse(raw); } catch (e) { foreign = true; return { v: V, banks: [], bets: [] }; }
      if (!doc || doc.v !== V || !Array.isArray(doc.banks) || !Array.isArray(doc.bets)) { foreign = true; return { v: V, banks: [], bets: [] }; }
      return doc;
    }
    function write(doc) {
      if (foreign) return false;
      try { local.setItem(KEY, JSON.stringify(doc)); return true; } catch (e) { return false; }
    }
    function touched() { try { return JSON.parse(session.getItem(SESSION_KEY) || '[]'); } catch (e) { return []; } }
    function touch(id) { var t = touched(); if (t.indexOf(id) < 0) { t.push(id); try { session.setItem(SESSION_KEY, JSON.stringify(t)); } catch (e) { /* memory only */ } } }
    function stamp() { return now().toISOString(); }

    function listBanks() {
      var doc = read();
      if (!doc.banks.length && !foreign) { doc.banks.push({ id: 'b1', name: DEFAULT_BANK, archived: false, createdAt: stamp() }); write(doc); }
      return copy(doc.banks);
    }
    function saveBank(bank) {
      if (!bank || !bank.id || typeof bank.name !== 'string' || !bank.name.trim()) return { ok: false, reason: 'invalid' };
      var doc = read(), i = doc.banks.findIndex(function (b) { return b.id === bank.id; });
      // plan = the staking plan applied to this bankroll (T5), a plan name or null
      var rec = { id: String(bank.id), name: bank.name.trim(), archived: !!bank.archived, createdAt: i >= 0 ? doc.banks[i].createdAt : stamp(),
        plan: typeof bank.plan === 'string' && bank.plan.length && bank.plan.length <= 40 ? bank.plan : null };
      if (i >= 0) doc.banks[i] = rec; else doc.banks.push(rec);
      return write(doc) ? { ok: true, bank: copy(rec) } : { ok: false, reason: 'storage' };
    }
    // Delete only once archived (README §1), and never a bankroll holding a locked result (a locked result is frozen).
    function deleteBank(id) {
      var doc = read(), bank = doc.banks.find(function (b) { return b.id === id; });
      if (!bank) return { ok: false, reason: 'missing' };
      if (!bank.archived) return { ok: false, reason: 'not-archived' };
      if (doc.bets.some(function (b) { return b.bank === id && b.lockedAt; })) return { ok: false, reason: 'locked' };
      doc.banks = doc.banks.filter(function (b) { return b.id !== id; });
      doc.bets = doc.bets.filter(function (b) { return b.bank !== id; });
      return write(doc) ? { ok: true } : { ok: false, reason: 'storage' };
    }

    function listBets(bankId) {
      var doc = read(), mine = touched(), at = null, changed = false;
      doc.bets.forEach(function (b) {
        if (b.res && !b.lockedAt && !b.source && mine.indexOf(b.id) < 0) { b.lockedAt = at || (at = stamp()); changed = true; }
      });
      if (changed) write(doc);
      return copy(doc.bets.filter(function (b) { return bankId == null || b.bank === bankId; })
        .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id; }));
    }
    function valid(b) {
      return b && typeof b.id === 'number' && isFinite(b.id) && typeof b.bank === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(String(b.date))
        && typeof b.odds === 'number' && b.odds >= 1.01 && typeof b.stake === 'number' && b.stake > 0
        && (b.res === null || RESULTS[b.res] === 1) && (b.close === null || (typeof b.close === 'number' && b.close > 1));
    }
    function saveBet(bet) {
      if (!valid(bet)) return { ok: false, reason: 'invalid' };
      var doc = read(), i = doc.bets.findIndex(function (b) { return b.id === bet.id; });
      if (i >= 0 && doc.bets[i].lockedAt) return { ok: false, reason: 'locked' };
      if (!doc.banks.some(function (b) { return b.id === bet.bank; })) return { ok: false, reason: 'no-bankroll' };
      var rec = copy(bet); rec.createdAt = i >= 0 ? doc.bets[i].createdAt : stamp(); rec.lockedAt = null; rec.pending = !rec.res;
      // `source` is the store's, never the caller's: only importBets sets it, and a save keeps the stored one
      if (i >= 0 && doc.bets[i].source) rec.source = doc.bets[i].source; else delete rec.source;
      if (i >= 0) doc.bets[i] = rec; else doc.bets.push(rec);
      if (!write(doc)) return { ok: false, reason: 'storage' };
      touch(rec.id);
      return { ok: true, bet: copy(rec) };
    }
    function lockBet(id) {
      var doc = read(), b = doc.bets.find(function (x) { return x.id === id; });
      if (!b) return { ok: false, reason: 'missing' };
      if (b.lockedAt) return { ok: true, bet: copy(b) };
      if (!b.res) return { ok: false, reason: 'pending' };
      b.lockedAt = stamp();
      return write(doc) ? { ok: true, bet: copy(b) } : { ok: false, reason: 'storage' };
    }
    // A whole import in one write. Every row must be valid, carry this source and be new; nothing is written otherwise.
    function importBets(bankId, bets, source) {
      if (!source || !Array.isArray(bets) || !bets.length) return { ok: false, reason: 'invalid' };
      var doc = read();
      if (!doc.banks.some(function (b) { return b.id === bankId; })) return { ok: false, reason: 'no-bankroll' };
      if (doc.bets.some(function (b) { return b.bank === bankId && b.source === source; })) return { ok: false, reason: 'already-imported' };
      var ids = {}; doc.bets.forEach(function (b) { ids[b.id] = 1; });
      for (var i = 0; i < bets.length; i++) {
        var b = bets[i];
        if (!valid(b) || b.bank !== bankId || b.source !== source || ids[b.id]) return { ok: false, reason: 'invalid', at: i };
        ids[b.id] = 1;
      }
      var at = stamp();
      bets.forEach(function (b) { var rec = copy(b); rec.createdAt = rec.createdAt || at; rec.lockedAt = null; rec.pending = !rec.res; doc.bets.push(rec); });
      return write(doc) ? { ok: true, n: bets.length } : { ok: false, reason: 'storage' };
    }
    function removeImport(bankId, source) {
      if (!source) return { ok: false, reason: 'invalid' };
      var doc = read(), mine = doc.bets.filter(function (b) { return b.bank === bankId && b.source === source; });
      if (mine.some(function (b) { return b.lockedAt; })) return { ok: false, reason: 'locked', locked: mine.filter(function (b) { return b.lockedAt; }).length };
      doc.bets = doc.bets.filter(function (b) { return !(b.bank === bankId && b.source === source); });
      return write(doc) ? { ok: true, removed: mine.length } : { ok: false, reason: 'storage' };
    }
    function nextId() {
      var doc = read(), max = doc.bets.reduce(function (m, b) { return Math.max(m, b.id); }, 0);
      return Math.max(max + 1, now().getTime());
    }
    return { V: V, listBanks: listBanks, saveBank: saveBank, deleteBank: deleteBank, listBets: listBets, saveBet: saveBet, lockBet: lockBet, importBets: importBets, removeImport: removeImport, nextId: nextId };
  }

  var api = { create: create, KEY: KEY, SESSION_KEY: SESSION_KEY, V: V };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    var inst = create({ local: safe(function () { return root.localStorage; }), session: safe(function () { return root.sessionStorage; }) });
    inst.create = create;
    root.BetTrackerStore = inst;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
