/* bettracker-import.js — reads a Bet-Analytix "Export formatted" CSV into Bet Tracker bets (Bet Tracker T1b brief,
 * founder 2026-10-28). Pure: text in, { bets, report } out — no DOM, no storage, no fetch. The member's file is private:
 * it is read in the member's own browser and never leaves it; this module ships no rows and the tests run on a
 * synthetic fixture only (tools/test-bettracker-import.mjs).
 *
 * The file: semicolon-separated, quoted, a header row. A row with a Date and a Type is a ticket; rows with neither,
 * directly after a "Combined" ticket, are its legs (a leg row after any other ticket is reported, never attached).
 * Rules (brief items 1–10): Simple → Single; Combined with 2 legs → Combination, 3+ → Parlay; odds = the ticket's own;
 * stake € → % of a 10,000 € bankroll (2 dp; stakeEur kept); W won · L lost · R void · P pending · C void · HW void
 * (+ " (imported: HW)") · CASH void (+ " (imported: cashout)") — no P/L invented for either; Live = Yes or a label
 * starting LIVE → live; the "PRE :" / "LIVE :" prefix is stripped; bookmaker as given (blank = empty); level / surface
 * / market only from the token table below (no fuzzy match, no player-name inference); close null; every row
 * unlocked and tagged source "bet-analytix".
 * Beyond the brief, reported in `report` (never silent): `tilt` (3rd+ bet on a day already down two — the reference's
 * rule, on the file's own times and results; a void leaves the run as it is), the orphan legs, the label tokens the
 * table does not cover (OUTRIGHT tickets get no market rather than "Match winner").
 */
(function (root) {
  'use strict';

  var SOURCE = 'bet-analytix', BANKROLL_EUR = 10000;
  var COLS = ['Date', 'Type', 'Sport', 'Label', 'Odds', 'Stake', 'State', 'Bookmaker', 'Tipster', 'Category', 'Competition', 'BetType', 'Closing',
    'EstimatedProbability', 'Commission', 'Bonus', 'Live', 'Freebet', 'Cashout', 'Eachway', 'Comment'];
  var USED = { Date: 1, Type: 1, Sport: 1, Label: 1, Odds: 1, Stake: 1, State: 1, Bookmaker: 1, Live: 1 };
  var STATES = { W: ['won', ''], L: ['lost', ''], R: ['void', ''], P: [null, ''], C: ['void', ''], HW: ['void', ' (imported: HW)'], CASH: ['void', ' (imported: cashout)'] };

  // The brief's token table (item 7), case-insensitive, whole words. One distinct value per field, or the field stays blank.
  var LEVEL_TOKENS = [[/\bgrand slam\b/i, 'Slam'], [/\bmasters 1000\b/i, '1000'], [/\batp ?500\b/i, '500'], [/\batp ?250\b/i, '250'], [/\bdavis cup\b/i, 'Cup'], [/\bchallenger\b/i, 'Chall']];
  var MARKET_TOKENS = [
    [/\b(over|under) \d+\.5 sets?\b/i, 'Total sets'], [/\b(over|under) \d+\.5 games?\b/i, 'Total games'], [/\bset handicap\b/i, 'Sets handicap'],
    [/\bgames handicap\b/i, 'Games handicap'], [/(^|\s)[+\-±−]\d+\.5 games?\b/i, 'Games handicap'], [/\bto win set \d\b/i, 'Player to win a set'],
    [/\bto take a set\b/i, 'Player to win a set'], [/\btiebreak\b/i, 'Tiebreak in match'],
    [/\bto win\b(?! set \d)/i, 'Match winner']
  ];
  function surfaceOf(t) {
    var s = {};
    if (/\bid hard\b|\bindoor\b/i.test(t)) s['Indoor hard'] = 1;
    else if (/\bod hard\b|\bhard\b/i.test(t)) s.Hard = 1;
    if (/\bclay\b/i.test(t)) s.Clay = 1;
    if (/\bgrass\b/i.test(t)) s.Grass = 1;
    return one(Object.keys(s));
  }
  function one(found) { return found.length === 1 ? { v: found[0] } : found.length ? { v: '', conflict: true } : { v: '' }; }
  function tokens(table, t) { var f = []; table.forEach(function (x) { if (x[0].test(t) && f.indexOf(x[1]) < 0) f.push(x[1]); }); return one(f); }
  function marketOf(t) {
    if (/\boutright\b/i.test(t)) return { v: '', outright: true };   // "to win" on an outright is not a match winner
    // "to win" counts only alone: another market token on the label wins, two others are a conflict
    var f = []; MARKET_TOKENS.forEach(function (x) { if (x[0].test(t) && f.indexOf(x[1]) < 0) f.push(x[1]); });
    if (f.length > 1) f = f.filter(function (m) { return m !== 'Match winner'; });
    return one(f);
  }

  // RFC-4180-style split with ';' — quotes, doubled quotes, newlines inside quotes.
  function parseCsv(text) {
    var rows = [], row = [], cell = '', q = false, i = 0, s = String(text).replace(/^﻿/, '');
    for (; i < s.length; i++) {
      var ch = s[i];
      if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ';') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (c) { return c !== ''; }); });
  }
  function dec(v) { var x = parseFloat(String(v).trim().replace(',', '.')); return isFinite(x) ? x : null; }
  function pad(n) { return String(n).padStart(2, '0'); }

  function parse(text, opts) {
    opts = opts || {};
    var bankId = opts.bankId || 'bet-analytix', bankroll = opts.bankrollEur || BANKROLL_EUR, idBase = opts.idBase == null ? 7e12 : opts.idBase;
    var rows = parseCsv(text), head = rows[0] || [], I = {};
    head.forEach(function (h, i) { I[h.trim()] = i; });
    var missing = COLS.filter(function (c) { return !(c in I); });
    var report = { ok: false, rows: rows.length - 1, missingColumns: missing, unknownColumns: head.filter(function (h) { return COLS.indexOf(h.trim()) < 0; }) };
    if (missing.length) { report.error = 'missing columns: ' + missing.join(', '); return { bets: [], report: report }; }
    var get = function (r, c) { return (r[I[c]] == null ? '' : String(r[I[c]])).trim(); };

    // 1 · tickets and their legs
    var tickets = [], orphans = [], legRows = 0, odd = [];
    rows.slice(1).forEach(function (r, i) {
      var line = i + 2, hasDate = !!get(r, 'Date'), hasType = !!get(r, 'Type');
      if (hasDate && hasType) tickets.push({ r: r, line: line, legs: [] });
      else if (!hasDate && !hasType) {
        legRows++; var t = tickets[tickets.length - 1];
        if (t && get(t.r, 'Type') === 'Combined') t.legs.push({ r: r, line: line }); else orphans.push({ line: line, after: t ? t.line : null });
      } else odd.push(line);
    });
    var rep = report;
    rep.tickets = tickets.length; rep.combined = tickets.filter(function (t) { return get(t.r, 'Type') === 'Combined'; }).length; rep.legRows = legRows;
    rep.legsAttached = legRows - orphans.length; rep.orphanLegs = orphans; rep.halfRows = odd;
    rep.types = {}; rep.states = {}; rep.legStates = {}; rep.unknownStates = {}; rep.unknownTypes = {}; rep.over10 = 0; rep.oddsMismatch = []; rep.badRows = [];
    rep.live = 0; rep.prefixStripped = 0; rep.unstrippedPrefix = 0; rep.bookBlank = 0; rep.tilt = 0;
    rep.hits = { level: 0, surface: 0, market: 0, tournament: 0, bookmaker: 0 }; rep.conflicts = { level: 0, surface: 0, market: 0 }; rep.outrightNoMarket = 0;
    rep.unusedColumnsFilled = {};
    COLS.filter(function (c) { return !USED[c]; }).forEach(function (c) {
      var n = rows.slice(1).filter(function (r) { return get(r, c) !== ''; }).length; if (n) rep.unusedColumnsFilled[c] = n;
    });
    rep.sports = {}; rows.slice(1).forEach(function (r) { var s = get(r, 'Sport') || '(blank)'; rep.sports[s] = (rep.sports[s] || 0) + 1; });

    // 2 · a ticket → a bet
    var bets = [];
    tickets.forEach(function (t, k) {
      var r = t.r, type0 = get(r, 'Type'), state = get(r, 'State').toUpperCase(), m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(get(r, 'Date'));
      var odds = dec(get(r, 'Odds')), eur = dec(get(r, 'Stake'));
      t.legs.forEach(function (lg) { var s = get(lg.r, 'State').toUpperCase() || '(blank)'; rep.legStates[s] = (rep.legStates[s] || 0) + 1; });
      if (!m || odds === null || odds < 1.01 || eur === null || eur <= 0 || !STATES[state]) {
        rep.badRows.push({ line: t.line, why: !m ? 'date' : odds === null || odds < 1.01 ? 'odds' : eur === null || eur <= 0 ? 'stake' : 'state ' + state });
        if (!STATES[state]) rep.unknownStates[state] = (rep.unknownStates[state] || 0) + 1;
        return;
      }
      var type = type0 === 'Simple' ? 'Single' : type0 === 'Combined' ? (t.legs.length >= 3 ? 'Parlay' : 'Combination') : null;
      if (!type) { rep.unknownTypes[type0] = (rep.unknownTypes[type0] || 0) + 1; rep.badRows.push({ line: t.line, why: 'type ' + type0 }); return; }
      if (type0 === 'Combined' && t.legs.length < 2) rep.badRows.push({ line: t.line, why: 'combined with ' + t.legs.length + ' leg(s) — kept as Combination' });
      rep.types[type] = (rep.types[type] || 0) + 1; rep.states[state] = (rep.states[state] || 0) + 1;
      if (t.legs.length) {
        var prod = t.legs.reduce(function (a, lg) { var o = dec(get(lg.r, 'Odds')); return o ? a * o : NaN; }, 1);
        if (!isFinite(prod) || Math.abs(prod / odds - 1) > 0.01) rep.oddsMismatch.push({ line: t.line, odds: odds, legProduct: isFinite(prod) ? +prod.toFixed(3) : null });
      }
      var label = get(r, 'Label'), pre = /^(PRE|LIVE)\s*:\s*/i.exec(label);
      if (pre) rep.prefixStripped++; else if (/^[A-Z]{3,}\s*:/.test(label)) rep.unstrippedPrefix++;
      var live = /^yes$/i.test(get(r, 'Live')) || /^LIVE\b/i.test(label);
      if (live) rep.live++;
      var text = (pre ? label.slice(pre[0].length) : label).trim();
      var scan = [label].concat(t.legs.map(function (lg) { return get(lg.r, 'Label'); })).join(' \n ');
      // a combined ticket's market is its legs' one market (legs of two markets = none); level / surface read the whole ticket
      var mk = t.legs.length ? (function () {
        if (/\boutright\b/i.test(scan)) return { v: '', outright: true };
        var ms = t.legs.map(function (lg) { return marketOf(get(lg.r, 'Label')).v; });
        return ms.every(function (x) { return x && x === ms[0]; }) ? { v: ms[0] } : ms.some(Boolean) ? { v: '', conflict: true } : { v: '' };
      })() : marketOf(label);
      var lv = tokens(LEVEL_TOKENS, scan), sf = surfaceOf(scan);
      if (lv.v) rep.hits.level++; if (sf.v) rep.hits.surface++; if (mk.v) rep.hits.market++;
      if (lv.conflict) rep.conflicts.level++; if (sf.conflict) rep.conflicts.surface++; if (mk.conflict) rep.conflicts.market++; if (mk.outright) rep.outrightNoMarket++;
      var book = get(r, 'Bookmaker'); if (book) rep.hits.bookmaker++; else rep.bookBlank++;
      var stake = Math.round(eur * 10000 / bankroll) / 100;   // 112.50 € → 1.13% (half up: 1.125 → 1.13)
      if (stake > 10) rep.over10++;
      var res = STATES[state];
      var h = m[4] == null ? 0 : +m[4], mi = m[5] == null ? 0 : +m[5];
      bets.push({ id: idBase + k + 1, date: m[1] + '-' + m[2] + '-' + m[3], createdAt: new Date(+m[1], +m[2] - 1, +m[3], h, mi).toISOString(),
        tour: '', level: lv.v, surface: sf.v, market: mk.v, line: null, book: book, odds: odds, close: null, stake: stake, stakeEur: eur,
        res: res[0], timing: live ? 'live' : 'pre', type: type, legs: type === 'Single' ? 1 : t.legs.length,
        legList: t.legs.map(function (lg) { return { text: get(lg.r, 'Label'), odds: dec(get(lg.r, 'Odds')) }; }),
        text: text + res[1], bank: bankId, tilt: false, pending: !res[0], lockedAt: null, source: SOURCE, importLine: t.line });
    });

    // 3 · tilt: the third-or-later bet on a day already down two in a row (file times; ties keep file order)
    var byDay = {};
    bets.forEach(function (b) { (byDay[b.date] = byDay[b.date] || []).push(b); });
    Object.keys(byDay).forEach(function (d) {
      var run = 0;
      byDay[d].slice().sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : b.importLine - a.importLine; })
        .forEach(function (b, i) { b.tilt = i >= 2 && run >= 2; if (b.tilt) rep.tilt++; if (b.res === 'won') run = 0; else if (b.res === 'lost') run++; });
    });
    rep.bets = bets.length; rep.pending = bets.filter(function (b) { return !b.res; }).length; rep.settled = bets.length - rep.pending;
    rep.firstDate = bets.reduce(function (a, b) { return !a || b.date < a ? b.date : a; }, null);
    rep.lastDate = bets.reduce(function (a, b) { return !a || b.date > a ? b.date : a; }, null);
    rep.ok = !rep.badRows.some(function (x) { return !/kept as/.test(x.why); }) && !odd.length;
    return { bets: bets, report: report };
  }

  // The browser path: into the store under one bankroll (created if absent). Refuses a second import of the same
  // source into the same bankroll — store.removeImport(bankId, source) wipes it first.
  function run(text, store, opts) {
    opts = opts || {};
    var bankId = opts.bankId || 'bet-analytix', name = opts.bankName || 'BSP Consult Bet-Analytix';
    var out = parse(text, { bankId: bankId });
    if (!out.report.ok) return { ok: false, reason: 'file', report: out.report };
    if (!store.listBanks().some(function (b) { return b.id === bankId; })) store.saveBank({ id: bankId, name: name, archived: false });
    var w = store.importBets(bankId, out.bets, SOURCE);
    return { ok: !!w.ok, reason: w.reason, stored: w.n, bankId: bankId, report: out.report };
  }

  var api = { SOURCE: SOURCE, BANKROLL_EUR: BANKROLL_EUR, COLS: COLS, parseCsv: parseCsv, parse: parse, run: run, _tokens: { level: function (t) { return tokens(LEVEL_TOKENS, t).v; }, surface: function (t) { return surfaceOf(t).v; }, market: function (t) { return marketOf(t).v; } } };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BetTrackerImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
