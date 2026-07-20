'use strict';

/**
 * elo.js — Stage 1: base win probability from ELO.
 *
 * Three estimates are blended (weights in config.eloBlend):
 *   1. eloRaw     — overall ELO rating
 *   2. eloSurface — surface-specific ELO rating (falls back to overall if the
 *                   surface rating is missing)
 *   3. elo5050    — 50/50 average of raw+surface (a stabiliser so neither
 *                   pure-overall nor pure-surface dominates)
 *
 * Formula (Sackmann/backtest_elo.py convention):
 *   P(A beats B) = 1 / (1 + 10 ^ ((ratingB - ratingA) / D))
 */

const config = require('./config');
const { eloSurfaceKey } = require('./data');

function eloProb(ratingA, ratingB, divisor = config.eloDivisor) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / divisor));
}

/**
 * @param {object} p1  resolved player bundle (side 1)
 * @param {object} p2  resolved player bundle (side 2)
 * @param {string} surface  match surface (e.g. "clay")
 * @returns {object} { baseP1, ok, components, note }
 */
function baseProbability(p1, p2, surface) {
  const e1 = p1.elo, e2 = p2.elo;

  // Hard requirement: both players need an overall ELO rating. Without it we
  // cannot produce a base probability — flag it rather than fabricate 0.5.
  if (!e1 || !e1.all || !e2 || !e2.all) {
    return {
      baseP1: null,
      ok: false,
      components: null,
      note: `Missing ELO rating (${!e1 || !e1.all ? p1.fullName : ''}${!e2 || !e2.all ? ' ' + p2.fullName : ''}).`.trim(),
    };
  }

  const rawA = e1.all.rating;
  const rawB = e2.all.rating;
  const eloRaw = eloProb(rawA, rawB);

  const sk = eloSurfaceKey(surface);
  const surfA = (sk && e1[sk] && e1[sk].rating) || rawA;
  const surfB = (sk && e2[sk] && e2[sk].rating) || rawB;
  const surfaceAvailable = Boolean(sk && e1[sk] && e2[sk]);
  const eloSurface = eloProb(surfA, surfB);

  const elo5050 = eloProb((rawA + surfA) / 2, (rawB + surfB) / 2);

  const w = config.eloBlend;
  const baseP1 = w.raw * eloRaw + w.surface * eloSurface + w.blend * elo5050;

  return {
    baseP1,
    ok: true,
    components: {
      eloRaw: { p1: round4(eloRaw), ratingP1: rawA, ratingP2: rawB, weight: w.raw },
      eloSurface: {
        p1: round4(eloSurface), ratingP1: surfA, ratingP2: surfB,
        weight: w.surface, surfaceKey: sk, surfaceAvailable,
      },
      elo5050: { p1: round4(elo5050), weight: w.blend },
    },
    note: surfaceAvailable ? null : `No surface ELO for ${sk || 'surface'}; used overall as fallback.`,
  };
}

function round4(x) { return Math.round(x * 1e4) / 1e4; }

module.exports = { eloProb, baseProbability };
