'use strict';

/**
 * summary.js — Stage 4: optional Claude AI match summary.
 *
 * This layer is deliberately OUTSIDE runModel(): the engine (Stages 1-3) stays
 * pure and synchronous with no network calls. This module takes an already-
 * computed runModel() result and asks Claude to turn the structured numbers
 * into a short, factual analyst note.
 *
 * R&D-safe by design:
 *   - The Anthropic SDK is lazy-required inside try/catch, so the whole engine
 *     still runs if `@anthropic-ai/sdk` is not installed.
 *   - It reads the API key from the environment (config.summary.apiKeyEnv,
 *     default ANTHROPIC_API_KEY) and NEVER hard-codes or logs it.
 *   - If the key or SDK is missing, or config.summary.enabled is false, it
 *     returns a structured { ok:false, gated:true, reason } object rather than
 *     throwing — callers can no-op cleanly.
 *
 * It NEVER fabricates data (CLAUDE.md rule 1): the prompt is built only from
 * numbers the model already produced. Missing inputs are simply omitted.
 */

const config = require('./config');

// ── TEN-418: the Stennisfy Model page's own rules, copied character for character from
// bsp-consult-dashboard.html (test-ten418-model.mjs fails on any drift), so the analysis reads
// exactly the figures the page shows: the price join, best soft, the visible layers, weight and quality.
// >>> page rules (do not edit here — edit the page, then re-copy)
const MX_BOOK_LABELS = {
  sbo: 'SBOBET',
  pncl: 'Pinnacle',
  victorchandler: 'BetVictor',
  // TEN-384 (founder 2026-10-07): ONE house style for every book name a member reads —
  // "William Hill", "Pinnacle", "bet365", "1xBet", "Betano"; never the feed's "WilliamHill" / "Pncl".
  // The rest are the casing / spelling variants measured on matches.json since July (api-tennis keys
  // beside the-odds-api titles: "888Sport" / "888sport", "Marathon Bet" / "Marathon"). Display only:
  // stored rows keep the vendor's string, as above.
  williamhill: 'William Hill',
  pinnacle: 'Pinnacle',
  bet365: 'bet365',
  '1xbet': '1xBet',
  betano: 'Betano',
  '888sport': '888sport',
  marathonbet: 'Marathon',
};
function mxBookLabel(book){
  if (!book) return book;
  // Keyed on a normalised form so casing and spacing are the vendor's business,
  // not ours: "Victor Chandler", "victor chandler" and "VictorChandler" are one
  // book, and a literal-match table would relabel one of them and miss two.
  const k = String(book).toLowerCase().replace(/[^a-z0-9]/g, '');
  return MX_BOOK_LABELS[k] || book;
}
const EDGE_SHARP = [['Pncl', 'Pinnacle'], ['bet365', 'bet365']];
function edgeQuote(src, k){ const q = src && src[k]; return (q && q.p1 >= 1.01 && q.p2 >= 1.01) ? q : null; }
function edgeBookName(k){ return k === 'Pncl' ? 'Pinnacle' : ((typeof mxBookLabel === 'function') ? mxBookLabel(k) : k); }
function edgeSharp(m){
  const at = k => ({ key: k, name: EDGE_SHARP.find(x => x[0] === k)[1], now: edgeQuote(m && m.bookNow, k), open: edgeQuote(m && m.bookOpens, k) });
  const all = EDGE_SHARP.map(x => at(x[0]));
  return all.find(b => b.now) || all.find(b => b.open) || null;   // a current quote first: Pinnacle with no price now falls to bet365
}
function edgeSoftBooks(m){
  const sk = (edgeSharp(m) || {}).key;
  return Object.keys((m && m.bookNow) || {}).filter(k => k !== 'Pncl' && k !== sk && edgeQuote(m.bookNow, k));
}
function edgeBestSoft(m, side){
  let best = null;
  edgeSoftBooks(m).forEach(k => { const q = m.bookNow[k]; if (!best || q[side] > best.price) best = { key: k, name: edgeBookName(k), price: q[side], now: q, open: edgeQuote(m.bookOpens, k) }; });
  return best;
}
function edgeNoVig(q, side){ if (!q) return null; const a = 1 / q.p1, b = 1 / q.p2; return (side === 'p1' ? a : b) / (a + b); }
function edgeWeightTag(mag){
  const m = mag || 0;
  if (m >= 0.06)  return { label: 'HIGHEST',     rank: 0, word: 'Highest' };
  if (m >= 0.035) return { label: 'HIGH',        rank: 1, word: 'High' };
  if (m >= 0.025) return { label: 'MEDIUM-HIGH', rank: 2, word: 'Medium-high' };
  if (m >= 0.016) return { label: 'MEDIUM',      rank: 3, word: 'Medium' };
  return { label: 'LOW', rank: 4, word: 'Low' };
}
function edgeCovState(a){
  if (a.applied) return (a.confidence === 'high' || a.confidence === 'med') ? 'full' : 'partial';
  return a.gated ? 'partial' : 'missing';
}
function edgeQuality(a){ const s = edgeCovState(a); return s === 'full' ? 'Good' : (s === 'partial' ? 'Medium' : 'Poor'); }
const EDGE_SELF_HIDE_KEYS = new Set(['winnerUE']);
function edgeVisibleAdjs(list){
  return (list || []).filter(a => !a.hidden && (a.applied || !EDGE_SELF_HIDE_KEYS.has(a.key)));
}
function edgeWhyText(a){ return String(a.detail || '').replace(/\s*\(TEN-\d+\)/g, '').trim(); }
// <<< page rules

// The round as the page's header prints it ("ATP Shanghai - 1/32-finals" → "Round of 64"); the feed's event prefix is dropped.
const ROUND_WORDS = { 'Final': 'Final', 'Semi-finals': 'Semi-final', 'Quarter-finals': 'Quarter-final', '1/4-finals': 'Quarter-final',
  '1/8-finals': 'Round of 16', '1/16-finals': 'Round of 32', '1/32-finals': 'Round of 64', '1/64-finals': 'Round of 128' };
function roundWords(raw) {
  const r = String(raw || '').split(' - ').pop().trim();
  return ROUND_WORDS[r] || r || null;
}

/**
 * Build the facts handed to Claude: ONLY figures the Stennisfy Model page shows for this match
 * (TEN-418 Data 7) — the players and their Elo, the model base and adjusted fair prices, the net
 * adjustment, every visible value layer (weight, quality, favours, shift, its Why sentence), the
 * biggest movers and the Pinnacle / best-soft prices from the match's odds record. Nothing else.
 * @param {object} r  a successful runModel() result (r.ok === true)
 * @param {object} [m] the board match (its bookNow / bookOpens price record); absent = no prices
 */
function buildFacts(r, m) {
  const mm = r.match;
  const p1 = r.players.p1, p2 = r.players.p2;
  const name = s => (s === 'p1' ? mm.p1 : mm.p2);
  const pct = v => (v == null ? null : +(v * 100).toFixed(1));
  const odd = v => (v > 0 ? +(1 / v).toFixed(2) : null);
  const adjs = edgeVisibleAdjs(r.stage2.adjustments);
  const layers = adjs.map(a => {
    const delta = Math.abs(a.deltaP1 || 0) * 100;
    const even = !a.applied || a.direction === 'neutral' || Math.abs(a.signal || 0) < 0.02 || delta < 0.05;
    return {
      layer: a.name, weight: edgeWeightTag(a.maxMagnitude).word, quality: edgeQuality(a), active: !!a.applied,
      favours: !a.applied ? null : (even ? 'even' : name(a.direction)),
      shiftPP: !a.applied ? null : (even ? 0 : +delta.toFixed(1)), why: edgeWhyText(a),
    };
  });
  const movers = adjs.filter(a => a.applied && Math.abs(a.deltaP1 || 0) >= 0.0005)
    .sort((a, b) => Math.abs(b.deltaP1) - Math.abs(a.deltaP1)).slice(0, 3)
    .map(a => ({ layer: a.name, favours: name(a.direction === 'p1' ? 'p1' : 'p2'), shiftPP: +(Math.abs(a.deltaP1) * 100).toFixed(1) }));
  const s3 = r.stage3 || {}, fair = s3.fair || {};
  const net = (r.stage2.totalDeltaP1 || 0) * 100;
  const sharp = m ? edgeSharp(m) : null;
  const fp = s => (fair[s] && fair[s].prob != null ? fair[s].prob : null);
  // The page's Gap: adjusted fair probability minus 1 / the price shown, in pp.
  const gap = (s, price) => (fp(s) == null || !(price > 1) ? null : +((fp(s) - 1 / +price.toFixed(2)) * 100).toFixed(1));
  const soft = s => { const b = m ? edgeBestSoft(m, s) : null; return b ? { book: b.name, price: +b.price.toFixed(2), gapPP: gap(s, b.price) } : null; };
  const two = q => (q ? { [mm.p1]: +q.p1.toFixed(2), [mm.p2]: +q.p2.toFixed(2) } : null);
  const sharpGap = sharp && sharp.now ? { [mm.p1]: gap('p1', sharp.now.p1), [mm.p2]: gap('p2', sharp.now.p2) } : null;
  return {
    match: { players: [mm.p1, mm.p2], round: roundWords(mm.round), surface: mm.surface, bestOf: mm.bestOf },
    elo: { [mm.p1]: p1.eloAll != null ? p1.eloAll : null, [mm.p2]: p2.eloAll != null ? p2.eloAll : null },
    modelBase: { [mm.p1]: { probPct: pct(r.stage1.baseP1), odds: odd(r.stage1.baseP1) }, [mm.p2]: { probPct: pct(r.stage1.baseP2), odds: odd(r.stage1.baseP2) } },
    adjustedFair: { [mm.p1]: { probPct: pct(fair.p1 && fair.p1.prob), odds: fair.p1 ? fair.p1.odds : null },
                    [mm.p2]: { probPct: pct(fair.p2 && fair.p2.prob), odds: fair.p2 ? fair.p2.odds : null } },
    netAdjustment: { pp: +Math.abs(net).toFixed(1), toward: net >= 0 ? mm.p1 : mm.p2 },
    layersActive: adjs.filter(a => a.applied).length, layersShown: adjs.length,
    layers, biggestMovers: movers,
    market: {
      sharpBook: sharp ? sharp.name : null, sharpOpen: sharp ? two(sharp.open) : null, sharpNow: sharp ? two(sharp.now) : null, sharpNowGapPP: sharpGap,
      bestSoft: { [mm.p1]: soft('p1'), [mm.p2]: soft('p2') },
    },
  };
}

const SYSTEM_PROMPT = [
  'You are a tennis trading analyst at Stennisfy writing the match read on the Stennisfy Model page for a',
  'sharp ATP bettor. You are given, as JSON, the figures that page shows for one match.',
  '',
  'Rules:',
  '- Use ONLY the figures provided. Never invent stats, prices, history, rankings or playing styles.',
  '- Do not name the tournament or the city; say "this event" if you need to.',
  '- Write exactly five paragraphs, in this order: (1) the players and the base numbers (Elo, model base),',
  '  (2) the matchup, read from the value layers, (3) the event context: surface, round, best of and the',
  '  layers tied to them, (4) the key statistical edges and the value: quote the gaps given (gapPP =',
  '  adjusted fair probability minus the price\'s implied probability), never compute your own, (5) the',
  '  model\'s verdict and lean.',
  '- Continuous prose, British English, sentence case, no headings, no bullet points, no emojis, no hype,',
  '  about 45-70 words each. Separate paragraphs with one blank line.',
  '- Odds with two decimals, probabilities with one decimal and a % sign, gaps in pp, a true minus sign.',
  '- Probabilities are the model\'s, not certainties. Do not give financial advice or stake sizing.',
].join('\n');

function buildUserPrompt(facts) {
  return [
    'Here is the model output as JSON. Write the analyst note.',
    '',
    '```json',
    JSON.stringify(facts, null, 2),
    '```',
  ].join('\n');
}

function extractText(message) {
  if (!message || !Array.isArray(message.content)) return '';
  return message.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();
}

/**
 * Generate an AI match summary for a runModel() result.
 * @param {object} modelResult  the object returned by runModel()
 * @param {object} [opts] { apiKey?, model?, maxTokens?, match? } — overrides for tests;
 *                        apiKey is only for callers that manage their own key,
 *                        it is passed straight to the SDK and never logged.
 * @returns {Promise<object>} one of:
 *   { ok:true,  summary, model, usage }
 *   { ok:false, gated:true,  reason }   (config off / no key / no SDK / model not run)
 *   { ok:false, gated:false, reason }   (API/runtime error)
 */
async function generateSummary(modelResult, opts = {}) {
  // opts.match = the board match (its odds record), so the facts carry the page's prices (TEN-418).
  const cfg = config.summary;

  if (!cfg.enabled) {
    return { ok: false, gated: true, reason: 'summary disabled in config.summary.enabled' };
  }
  if (!modelResult || !modelResult.ok) {
    return { ok: false, gated: true, reason: 'model did not run for this match (nothing to summarise)' };
  }

  const apiKey = opts.apiKey || process.env[cfg.apiKeyEnv];
  if (!apiKey) {
    return { ok: false, gated: true,
      reason: `no API key: set ${cfg.apiKeyEnv} to enable Stage 4 (engine still runs without it)` };
  }

  // Lazy-require so the engine works even if the SDK is not installed.
  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch (e) {
    return { ok: false, gated: true,
      reason: 'Anthropic SDK not installed (run: npm install @anthropic-ai/sdk)' };
  }

  const model = opts.model || cfg.model;
  const maxTokens = opts.maxTokens || cfg.maxTokens;
  const facts = buildFacts(modelResult, opts.match || null);

  const params = {
    model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(facts) }],
  };
  if (cfg.thinking === 'adaptive') {
    params.thinking = { type: 'adaptive' };
  }

  try {
    const client = new Anthropic({ apiKey });
    // Stream then collect the final message — protects against request timeouts
    // on longer/thinking responses (per platform guidance).
    const stream = client.messages.stream(params);
    const message = await stream.finalMessage();
    const summary = extractText(message);
    if (!summary) {
      return { ok: false, gated: false, reason: `empty summary (stop_reason: ${message && message.stop_reason})` };
    }
    return {
      ok: true,
      summary,
      model,
      usage: message.usage || null,
    };
  } catch (e) {
    // Surface the class of error without leaking the key or a full stack.
    const name = e && e.constructor ? e.constructor.name : 'Error';
    const msg = e && e.message ? String(e.message).slice(0, 200) : 'unknown';
    return { ok: false, gated: false, reason: `${name}: ${msg}` };
  }
}

module.exports = { generateSummary, buildFacts };
