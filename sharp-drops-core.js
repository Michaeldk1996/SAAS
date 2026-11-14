// Sharp drop alerts — ONE definition of a member's settings, read by the page (sharp-drops-page.js), the member sync
// (tools/sharp-members-sync.mjs) and the tests. The engine's SQL filter (sharp_bot.passes) mirrors passes() below;
// tools/test-sharp-drops-core.mjs holds them to the same answers. Rules: .claude/rules/sharp-drops.md.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SharpDropsCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // level codes = sharp_bot.level_of(); labels as the site prints them
  var LEVELS = [
    { code: 'ATP', label: 'ATP main draw' }, { code: 'ATP Q', label: 'ATP qualifying' },
    { code: 'CH', label: 'Challenger' }, { code: 'CH Q', label: 'Challenger qualifying' },
    { code: 'ITF', label: 'ITF' }, { code: 'ITF Q', label: 'ITF qualifying' }
  ];
  // books the engine can quote at an alert today; the rest are listed as coming (no feed yet)
  var BOOKS = [
    { name: 'Bet105', live: true }, { name: 'Kalshi', live: true, note: 'ATP only' },
    { name: 'Polymarket', live: false }, { name: 'Betfair Exchange', live: false }, { name: 'Matchbook', live: false },
    { name: 'Superbet', live: false }, { name: 'bet365', live: false }
  ];
  // founder 2026-11-14: the default rule = favourite under 1.80, drop 2–3% within 5 minutes, ATP + Challenger incl. qualifying
  var DEFAULTS = {
    enabled: true, levels: ['ATP', 'ATP Q', 'CH', 'CH Q'], dropMin: 2, dropMax: 3, priceMin: 1.01, priceMax: 1.8,
    windowMin: 180, stepsOnly: false, books: ['Bet105', 'Kalshi'], dailyCap: 0, quietFrom: '', quietTo: ''
  };
  var DROP_BANDS = [ { id: '2-3', min: 2, max: 3, label: '2–3%' }, { id: '3-6', min: 3, max: 6, label: '3–6%' },
                     { id: '2-6', min: 2, max: 6, label: '2–6%' }, { id: '2+', min: 2, max: null, label: '2% or more' } ];
  var PRICE_BANDS = [ { id: 'u180', min: 1.01, max: 1.8, label: 'Under 1.80' }, { id: 'u2', min: 1.01, max: 2.0, label: 'Under 2.00' },
                      { id: '2-3', min: 2.0, max: 3.0, label: '2.00–3.00' }, { id: 'u3', min: 1.01, max: 3.0, label: 'Under 3.00' },
                      { id: 'any', min: 1.01, max: null, label: 'Any price' } ];
  var WINDOWS = [30, 60, 120, 180];

  function num(v, d, lo, hi) { var n = Number(v); if (!isFinite(n)) return d; return Math.min(hi, Math.max(lo, n)); }
  function hhmm(v) { return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : ''; }
  function uniq(list, allowed) {
    var out = []; (Array.isArray(list) ? list : []).forEach(function (x) { if (allowed.indexOf(x) >= 0 && out.indexOf(x) < 0) out.push(x); });
    return out;
  }
  // A member's stored settings, cleaned: anything missing or invalid takes the default; never throws.
  function normalize(doc) {
    var d = doc && typeof doc === 'object' ? doc : {};
    var levels = uniq(d.levels, LEVELS.map(function (l) { return l.code; }));
    var books = uniq(d.books, BOOKS.map(function (b) { return b.name; }));
    var dropMax = d.dropMax == null ? (d.hasOwnProperty('dropMax') ? null : DEFAULTS.dropMax) : num(d.dropMax, DEFAULTS.dropMax, 2, 50);
    var priceMax = d.priceMax == null ? (d.hasOwnProperty('priceMax') ? null : DEFAULTS.priceMax) : num(d.priceMax, DEFAULTS.priceMax, 1.01, 100);
    var s = {
      enabled: d.enabled !== false,
      levels: levels.length ? levels : DEFAULTS.levels.slice(),
      dropMin: num(d.dropMin, DEFAULTS.dropMin, 2, 50), dropMax: dropMax,
      priceMin: num(d.priceMin, DEFAULTS.priceMin, 1.01, 100), priceMax: priceMax,
      windowMin: WINDOWS.indexOf(Number(d.windowMin)) >= 0 ? Number(d.windowMin) : DEFAULTS.windowMin,
      stepsOnly: d.stepsOnly === true,
      books: books.length ? books : DEFAULTS.books.slice(),
      dailyCap: Math.round(num(d.dailyCap, 0, 0, 100)),
      quietFrom: hhmm(d.quietFrom), quietTo: hhmm(d.quietTo)
    };
    if (s.dropMax != null && s.dropMax <= s.dropMin) s.dropMax = null;
    if (s.priceMax != null && s.priceMax <= s.priceMin) s.priceMax = null;
    return s;
  }
  // The engine's filter (sharp_bot.passes): level, drop band, price band, window, move shape.
  function passes(a, s) {
    return s.levels.indexOf(a.level) >= 0
      && a.drop >= s.dropMin && (s.dropMax == null || a.drop < s.dropMax)
      && a.price >= s.priceMin && (s.priceMax == null || a.price < s.priceMax)
      && a.mins <= s.windowMin
      && (!s.stepsOnly || a.steps >= 2);
  }
  // A link code the member sends to the bot: SFY- + 6 letters/digits without look-alikes (no 0/O, 1/I).
  function newCode(rand) {
    var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', r = rand || Math.random, c = 'SFY-';
    for (var i = 0; i < 6; i++) c += A.charAt(Math.floor(r() * A.length));
    return c;
  }
  return { LEVELS: LEVELS, BOOKS: BOOKS, DEFAULTS: DEFAULTS, DROP_BANDS: DROP_BANDS, PRICE_BANDS: PRICE_BANDS, WINDOWS: WINDOWS,
           normalize: normalize, passes: passes, newCode: newCode };
});
