'use strict';

/**
 * price.js — Stage 3: fair price + value flags.
 *
 * Given the model's fair probability for each side, produce fair decimal odds,
 * then compare against the market:
 *   - Sharp reference : Pinnacle (vig-removed two-way implied prob)
 *   - Best soft price : the best available soft-book decimal price per side
 *
 * A bet is flagged when the model thinks the true probability is meaningfully
 * higher than what the price implies:
 *   Sharp Value   : fairProb - pinnacleVigFreeProb >= config.value.sharpEdge
 *   Soft Book Value: fairProb - softImpliedProb      >= config.value.softEdge
 *
 * We never recompute closing odds and never fabricate a price — if a book is
 * absent the corresponding flag is simply unavailable.
 */

const config = require('./config');

const dec = (x) => (typeof x === 'number' && isFinite(x) && x > 1 ? x : null);
const impl = (price) => { const p = dec(price); return p ? 1 / p : null; };
const fairOdds = (prob) => (prob > 0 ? Math.round((1 / prob) * 100) / 100 : null);

/**
 * Vig-free two-way probability from a pair of decimal prices.
 * @returns {p1, p2} normalised so p1+p2 = 1, or null if either missing.
 */
function vigFree(price1, price2) {
  const i1 = impl(price1), i2 = impl(price2);
  if (i1 == null || i2 == null) return null;
  const s = i1 + i2;
  return { p1: i1 / s, p2: i2 / s };
}

/**
 * A two-way tick is "sane" (a real pre-match line, not an in-play /
 * settlement / suspension artifact) when both prices are plausible and the
 * implied two-way sum sits in a normal overround band. Settlement ticks show
 * a winner near 1.0 (implied > ~0.93) and a loser ballooning to 20-70+.
 */
function saneTwoWay(price1, price2) {
  const i1 = impl(price1), i2 = impl(price2);
  if (i1 == null || i2 == null) return false;
  const sum = i1 + i2;
  if (sum < 0.98 || sum > 1.20) return false;   // implausible overround
  if (Math.max(i1, i2) > 0.93) return false;    // in-play / settled favourite
  if (price1 < 1.02 || price2 < 1.02) return false;
  return true;
}

function vfP1(p1, p2) {
  const i1 = impl(p1), i2 = impl(p2);
  if (i1 == null || i2 == null) return null;
  return i1 / (i1 + i2);
}

// Scheduled start parsed as UTC, minus the venue-local buffer. Ticks after
// this are treated as potentially in-play and excluded from the pre-match line.
function preMatchCutoffMs(match) {
  if (!match.date || !match.time) return null;
  const t = Date.parse(`${match.date}T${match.time}:00Z`);
  if (isNaN(t)) return null;
  return t - config.marketCutoffBufferHours * 3600 * 1000;
}

/**
 * Extract the clean opening + current PRE-MATCH Pinnacle two-way line.
 * Filters: (a) settlement/suspension ticks (saneTwoWay), (b) in-play ticks
 * after the scheduled-start cutoff, (c) a backstop that rejects a current tick
 * that jumped implausibly far from the opening (in-play leak past the cutoff).
 * @returns { current:{p1,p2}, opening:{p1,p2}, source, closingUsed } | null
 */
function pinnacleSeries(match) {
  const pin = match.oddsMovement && match.oddsMovement.books && match.oddsMovement.books.Pinnacle;
  if (pin && Array.isArray(pin.p1) && Array.isArray(pin.p2)) {
    const len = Math.min(pin.p1.length, pin.p2.length);
    const cutoff = preMatchCutoffMs(match);
    const sane = [];      // all sane ticks
    const sanePre = [];   // sane ticks at/before the pre-match cutoff
    for (let k = 0; k < len; k++) {
      const a = pin.p1[k] && pin.p1[k][1];
      const b = pin.p2[k] && pin.p2[k][1];
      if (!saneTwoWay(a, b)) continue;
      const tick = { p1: a, p2: b };
      sane.push(tick);
      const ts = pin.p1[k] && Date.parse(pin.p1[k][0]);
      if (cutoff == null || (ts && ts <= cutoff)) sanePre.push(tick);
    }
    if (sane.length) {
      const opening = sane[0];
      const openVf = vfP1(opening.p1, opening.p2);
      // prefer the last pre-match tick; else fall back to opening
      let current = sanePre.length ? sanePre[sanePre.length - 1] : opening;
      let closingUsed = sanePre.length > 0;
      // backstop: implausible jump from opening => treat as in-play leak
      const curVf = vfP1(current.p1, current.p2);
      if (openVf != null && curVf != null &&
          Math.abs(curVf - openVf) > config.maxPreMatchMove) {
        current = opening;
        closingUsed = false;
      }
      return {
        opening, current, closingUsed,
        source: closingUsed
          ? 'Pinnacle (pre-match closing line)'
          : 'Pinnacle (opening line; match in play / no clean closing tick)',
      };
    }
  }
  // Fallback: bestOdds only if it is a genuine two-way Pinnacle line
  const bo = match.bestOdds;
  const sharpSet = config.value.sharpBooks;
  if (bo && bo.p1 && bo.p2 &&
      sharpSet.includes(bo.p1.bookmaker) && sharpSet.includes(bo.p2.bookmaker) &&
      saneTwoWay(bo.p1.price, bo.p2.price)) {
    const two = { p1: bo.p1.price, p2: bo.p2.price };
    return { opening: two, current: two, closingUsed: true, source: 'bestOdds (Pinnacle two-way)' };
  }
  return null;
}

// Current sane Pinnacle two-way prices (for the fair-value comparison)
function pinnaclePrices(match) {
  const s = pinnacleSeries(match);
  if (!s) return null;
  return { p1: s.current.p1, p2: s.current.p2, source: s.source };
}

// Best available price per side (from bestOdds; that's the max across books)
function bestPrices(match) {
  const bo = match.bestOdds;
  if (!bo || !bo.p1 || !bo.p2) return null;
  return {
    p1: bo.p1.price, p2: bo.p2.price,
    p1Book: bo.p1.bookmaker, p2Book: bo.p2.bookmaker,
  };
}

/**
 * @param {number} fairP1  model fair probability for p1 (0..1)
 * @param {object} match   the match record
 */
function priceAndValue(fairP1, match) {
  const fairP2 = 1 - fairP1;
  const out = {
    fair: {
      p1: { prob: round4(fairP1), odds: fairOdds(fairP1) },
      p2: { prob: round4(fairP2), odds: fairOdds(fairP2) },
    },
    sharp: null,   // Pinnacle vig-free comparison
    soft: null,    // best soft-book comparison
    flags: [],     // array of value flags
  };

  // ---- Sharp (Pinnacle) reference ----
  const pin = pinnaclePrices(match);
  if (pin) {
    const vf = vigFree(pin.p1, pin.p2);
    if (vf) {
      const edgeP1 = fairP1 - vf.p1;
      const edgeP2 = fairP2 - vf.p2;
      out.sharp = {
        source: pin.source,
        price: { p1: pin.p1, p2: pin.p2 },
        vigFreeProb: { p1: round4(vf.p1), p2: round4(vf.p2) },
        edge: { p1: round4(edgeP1), p2: round4(edgeP2) },
      };
      if (edgeP1 >= config.value.sharpEdge) {
        out.flags.push(valueFlag('Sharp Value', 'p1', match.p1, pin.p1, edgeP1, pin.source));
      }
      if (edgeP2 >= config.value.sharpEdge) {
        out.flags.push(valueFlag('Sharp Value', 'p2', match.p2, pin.p2, edgeP2, pin.source));
      }
    }
  }

  // ---- Soft-book reference (best available price) ----
  const best = bestPrices(match);
  if (best) {
    const sImplP1 = impl(best.p1), sImplP2 = impl(best.p2);
    const edgeP1 = sImplP1 != null ? fairP1 - sImplP1 : null;
    const edgeP2 = sImplP2 != null ? fairP2 - sImplP2 : null;
    out.soft = {
      price: { p1: best.p1, p2: best.p2 },
      book: { p1: best.p1Book, p2: best.p2Book },
      impliedProb: { p1: round4OrNull(sImplP1), p2: round4OrNull(sImplP2) },
      edge: { p1: round4OrNull(edgeP1), p2: round4OrNull(edgeP2) },
    };
    if (edgeP1 != null && edgeP1 >= config.value.softEdge) {
      out.flags.push(valueFlag('Soft Book Value', 'p1', match.p1, best.p1, edgeP1, best.p1Book));
    }
    if (edgeP2 != null && edgeP2 >= config.value.softEdge) {
      out.flags.push(valueFlag('Soft Book Value', 'p2', match.p2, best.p2, edgeP2, best.p2Book));
    }
  }

  return out;
}

function valueFlag(type, side, player, price, edge, book) {
  return {
    type, side, player, price, book,
    edge: round4(edge),
    edgePct: Math.round(edge * 1000) / 10, // e.g. 4.2 (%)
  };
}

function round4(x) { return Math.round(x * 1e4) / 1e4; }
function round4OrNull(x) { return x == null ? null : round4(x); }

module.exports = { priceAndValue, vigFree, fairOdds, pinnacleSeries, saneTwoWay };
