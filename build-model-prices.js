#!/usr/bin/env node
'use strict';

/**
 * build-model-prices.js — Tennis Edge Model vs market.
 *
 * Runs the h2h-model over every upcoming match in matches.json and persists the
 * result, so the dashboard can show a model fair price next to the market's.
 * Until this existed, computeModelProbability() in bsp-pipeline.js was a stub
 * returning null and `value` was null on every match ever built.
 *
 *     node build-model-prices.js [--dry]
 *
 * Board decisions this implements (TEN-8, interaction 9e184a00, 2026-07-20):
 *   - baseline  = MEDIAN of the available books, not Pinnacle. Pinnacle covers
 *                 16/24 of a typical board; the median covers 23/24.
 *   - threshold = 2pp. The specced 8pp fired on 0 of 16 matches.
 *   - scope     = model-vs-market only. The four-row bookmaker strip is not
 *                 built, so no new bookmakers and no new request quota.
 *
 * Reads matches.json, patches `model` (and the legacy `value`) on upcoming
 * matches, writes it back. No network. Idempotent, safe to re-run.
 */

const fs = require('fs');
const path = require('path');
const { runModel } = require('./h2h-model/model');

const ROOT = __dirname;
const MATCHES = path.join(ROOT, 'matches.json');

// Board decision: fire at 2pp, not the specced 8pp.
const EDGE_THRESHOLD_PP = 2.0;

/** Strip the bookmaker's overround from one book's two-way price pair. */
function devig(p1Price, p2Price) {
  if (!(p1Price > 1) || !(p2Price > 1)) return null;
  const r1 = 1 / p1Price;
  const r2 = 1 / p2Price;
  const total = r1 + r2;
  if (!(total > 0)) return null;
  return r1 / total;
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Market baseline for one match: de-vig each book independently, then take the
 * median of those fair probabilities.
 *
 * De-vigging per book BEFORE the median matters — books carry different
 * overrounds (1xBet's is roughly double Pinnacle's), so a median taken over raw
 * implied probabilities is a median over margins as much as over opinions.
 *
 * Prefers m.books (every book that quoted the match, written by refresh-odds.py)
 * and falls back to the single headline m.odds pair so this still produces a
 * baseline on data written before m.books existed.
 */
function marketBaseline(m) {
  const books = m.books && typeof m.books === 'object' ? m.books : null;
  if (books) {
    const probs = [];
    const used = [];
    for (const [label, line] of Object.entries(books)) {
      const p = devig(line && line.p1, line && line.p2);
      if (p !== null) { probs.push(p); used.push(label); }
    }
    if (probs.length) {
      return { p1: median(probs), bookCount: probs.length, books: used.sort(), source: 'median' };
    }
  }
  const head = m.odds || {};
  const p = devig(head.p1, head.p2);
  if (p !== null) {
    return { p1: p, bookCount: 1, books: [head.bookmaker || 'unknown'], source: 'headline' };
  }
  return null;
}

const round1 = n => Math.round(n * 10) / 10;
const round3 = n => Math.round(n * 1000) / 1000;
const fairOdds = p => (p > 0 ? Math.round((1 / p) * 100) / 100 : null);

function main() {
  const dry = process.argv.includes('--dry');
  const matches = JSON.parse(fs.readFileSync(MATCHES, 'utf8'));

  const upcoming = matches.filter(m => String(m.id || '').startsWith('upcoming-'));
  const generatedAt = new Date().toISOString();

  let priced = 0, flagged = 0;
  const skipped = { model: [], market: [] };

  for (const m of upcoming) {
    let res = null;
    try {
      res = runModel(m);
    } catch (err) {
      skipped.model.push(`${m.p1} vs ${m.p2}: ${err.message}`);
      continue;
    }
    if (!res || !res.ok || !res.stage2 || typeof res.stage2.adjustedP1 !== 'number') {
      skipped.model.push(`${m.p1} vs ${m.p2}: model returned no probability`);
      continue;
    }

    const modelP1 = res.stage2.adjustedP1;
    const base = marketBaseline(m);
    if (!base) {
      // Priced by the model but nothing to compare it against. Record the fair
      // price anyway — it is still the honest model output — but no edge.
      m.model = {
        p1Prob: round3(modelP1),
        p2Prob: round3(1 - modelP1),
        fairP1: fairOdds(modelP1),
        fairP2: fairOdds(1 - modelP1),
        marketP1: null, marketP2: null,
        edgeP1: null, edgeP2: null,
        bookCount: 0, books: [], baseline: null,
        flag: null, threshold: EDGE_THRESHOLD_PP,
        generatedAt,
      };
      m.value = null;
      skipped.market.push(`${m.p1} vs ${m.p2}`);
      priced++;
      continue;
    }

    const edgeP1pp = round1((modelP1 - base.p1) * 100);
    const flag = Math.abs(edgeP1pp) >= EDGE_THRESHOLD_PP
      ? (edgeP1pp > 0 ? 'p1' : 'p2')
      : null;

    m.model = {
      p1Prob: round3(modelP1),
      p2Prob: round3(1 - modelP1),
      fairP1: fairOdds(modelP1),
      fairP2: fairOdds(1 - modelP1),
      marketP1: round3(base.p1),
      marketP2: round3(1 - base.p1),
      edgeP1: edgeP1pp,
      edgeP2: round1(-edgeP1pp),
      bookCount: base.bookCount,
      books: base.books,
      baseline: base.source,
      flag,
      threshold: EDGE_THRESHOLD_PP,
      generatedAt,
    };
    // Legacy field the pipeline has always written as null. Same definition:
    // p1 model probability minus p1 vig-free market probability, in points.
    m.value = edgeP1pp;

    priced++;
    if (flag) flagged++;
  }

  if (!dry) fs.writeFileSync(MATCHES, JSON.stringify(matches, null, 2) + '\n');

  console.log(
    `model prices: ${priced}/${upcoming.length} upcoming match(es) priced, ` +
    `${flagged} over the ${EDGE_THRESHOLD_PP}pp edge threshold${dry ? ' (dry run)' : ''}.`
  );
  if (skipped.market.length) {
    console.log(`  no market baseline (fair price only): ${skipped.market.length}`);
  }
  if (skipped.model.length) {
    console.log(`  model could not price: ${skipped.model.length}`);
    for (const s of skipped.model.slice(0, 10)) console.log(`    - ${s}`);
  }
}

if (require.main === module) main();
module.exports = { devig, median, marketBaseline };
