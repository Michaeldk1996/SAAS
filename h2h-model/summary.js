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
const EDGE_SHARP = [['Pncl', 'Pinnacle'], ['bet365', 'Bet365']];
function edgeQuote(src, k){ const q = src && src[k]; return (q && q.p1 >= 1.01 && q.p2 >= 1.01) ? q : null; }
function edgeBookName(k){
  const l = String(k || '').toLowerCase();
  if (l === 'pncl' || l === 'pinnacle') return 'Pinnacle';
  if (l === 'bet365') return 'Bet365';
  return (typeof mxBookLabel === 'function') ? mxBookLabel(k) : k;
}
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
function edgeGapOf(prob, odd){ return (prob == null || odd == null) ? null : Math.round(prob * 1000) / 10 - 100 / odd; }
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
  if (edgeEven(a)) return 'full';
  return (a.gated || edgeNotThisFormat(a)) ? 'partial' : 'missing';
}
function edgeEven(a){ return !!(a && !a.applied && !a.gated && edgeFigures(a)); }
function edgeNotThisFormat(a){ return !!(a && a.key === 'formatSplit' && a.hidden && /^Bo3\b/.test(String(a.detail || ''))); }
function edgeQuality(a){ const s = edgeCovState(a); return s === 'full' ? 'Good' : (s === 'partial' ? 'Medium' : 'Poor'); }
function edgeVisibleAdjs(list){ return (list || []).slice(); }
const EDGE_LAYER_NAMES = { subjective: 'Manual context' };
function edgeLayerName(a){ return EDGE_LAYER_NAMES[a.key] || a.name; }
function edgeSigned(v){ const n = Number(String(v).replace('−', '-')); return isFinite(n) ? (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(1) : String(v); }
function edgeCourt(surf){ const s = String(surf || '').toLowerCase(); return s ? s + ' courts' : 'this surface'; }
function edgeEventPart(t1, t2, A, B){
  const w = t => { const m = /(\d+)r ([+-]?[\d.]+)/.exec(t || ''); return m ? edgeSigned(m[2]) + ' after ' + m[1] + ' round' + (m[1] === '1' ? '' : 's') : 'no match yet'; };
  return ` At this event: ${A} ${w(t1)}, ${B} ${w(t2)}.`;
}
function edgeWhyText(a, nm){
  const d = String(a.detail || '').replace(/\s*\(TEN-\d+\)/g, '').trim();
  const A = (nm && nm.p1) || 'Player A', B = (nm && nm.p2) || 'Player B';
  let x;
  switch (a.key){
    case 'styleMatchup':
      if (/^Neither player/.test(d)) return 'Neither player has a playing-style label the model reads.';
      if ((x = /^(.+?) has no classified/.exec(d))) return `${x[1]} has no playing-style label the model reads.`;
      if ((x = /^Mirror matchup — both play as (.+?),/.exec(d))) return `Both play as ${x[1]}: a mirror matchup with no style edge.`;
      if ((x = /^(.+?) vs (.+?): n=(\d+) < floor (\d+)/.exec(d))) return `${x[1]} v ${x[2]}: ${x[3]} matches, under ${x[4]}.`;
      break;
    case 'subjective':
      if (!a.applied) return 'No analyst note is attached to this match, so the layer stays neutral.';
      break;
    case 'h2h':
      if (/^No prior meetings/.test(d)) return `${A} and ${B} have never met.`;
      if ((x = /^H2H (\d+)-(\d+) \((\d+) meetings?(?:, incl\. ([^;]+))?; (\d+) on (\w+), (\d+) in last (\d+)y/.exec(d)))
        return `Head-to-head ${A} ${x[1]}–${x[2]} ${B} in ${x[3]} meeting${x[3] === '1' ? '' : 's'}${x[4] ? ' (' + x[4] + ')' : ''}: ${x[5]} on ${edgeCourt(x[6])}, ${x[7]} in the last ${x[8]} years.`;
      break;
    case 'surface':
      if ((x = /^(\w+) record (\d+)% vs (\d+)%/.exec(d))) return `${x[1]}-court record ${x[2]}% vs ${x[3]}% over career and the last 52 weeks, each against their own career baseline.`;
      break;
    case 'recentForm':
      if ((x = /^Form (\d+)% vs (\d+)%/.exec(d))) return `Recent form ${x[1]}% vs ${x[2]}%: the last five matches weighted to the latest and by opponent quality, adjusted for surface.${/flagged/.test(d) ? ' A large form gap is flagged.' : ''}`;
      break;
    case 'qualityForm':
      if ((x = /Career top(\d+) dev ([+-]?[\d.]+)pp\((\d+)m\) vs ([+-]?[\d.]+)pp\((\d+)m\); (\w+) top\d+ dev ([+-]?[\d.]+)pp\((\d+)m\) vs ([+-]?[\d.]+)pp\((\d+)m\)/.exec(d)))
        return `Win rate against the top ${x[1]}, each against their own baseline: career ${edgeSigned(x[2])}pp (${x[3]} match${x[3] === '1' ? '' : 'es'}) vs ${edgeSigned(x[4])}pp (${x[5]}); on ${edgeCourt(x[6])} ${edgeSigned(x[7])}pp (${x[8]}) vs ${edgeSigned(x[9])}pp (${x[10]}).${/Thin/.test(d) ? ' The top-' + x[1] + ' sample is thin.' : ''}`;
      break;
    case 'winnerUE':
      if ((x = /^W\/UE ([\d.]+) vs ([\d.]+) — rel-to-archetype ([\d.]+) vs ([\d.]+) \([^,]+, (\d+)\/(\d+) matches\)/.exec(d)))
        return `Winners per unforced error ${x[1]} vs ${x[2]} (${x[3]} vs ${x[4]} against their playing style’s average), over each player’s last ${x[5]} and ${x[6]} match${x[6] === '1' ? '' : 'es'}.`;
      break;
    case 'serve':
      if ((x = /^Serve rating ([\d.]+) vs ([\d.]+) \((\w+);(?:.*in-tourn (.+?) \/ (.+?)\))?/.exec(d))) return `Serve rating ${x[1]} vs ${x[2]} on ${edgeCourt(x[3])}.` + (x[4] ? edgeEventPart(x[4], x[5], A, B) : '');
      break;
    case 'returnPressure':
      if ((x = /^Return rating ([\d.]+) vs ([\d.]+) \((\w+), career\+52wk;(?:.*in-tourn (.+?) \/ (.+?)\))?/.exec(d))) return `Return rating ${x[1]} vs ${x[2]} on ${edgeCourt(x[3])}, over career and the last 52 weeks.` + (x[4] ? edgeEventPart(x[4], x[5], A, B) : '');
      break;
    case 'fatigue':
      if (/^No matches in last/.test(d)) return 'Neither player has a match in the window the layer reads.';
      if ((x = /^(\d+)d load[^:]*: (\d+)s\/(\d+)m=([\d.]+)u(?: \[[^\]]*\])? vs (\d+)s\/(\d+)m=([\d.]+)u/.exec(d))) {
        const ev = /gap [-\d.]+u </.test(d);   // the engine's printed cut-off is not its real band (config unitBands), so no number here
        return `Match load over the last ${x[1]} days: ${A} ${x[2]} set${x[2] === '1' ? '' : 's'} in ${x[3]} match${x[3] === '1' ? '' : 'es'} (${x[4]} units), ${B} ${x[5]} set${x[5] === '1' ? '' : 's'} in ${x[6]} match${x[6] === '1' ? '' : 'es'} (${x[7]} units).${ev ? ' The loads are too close for the layer to move the price.' : ''}`;
      }
      break;
    case 'weather':
      if (a.gated) return 'Switched off for every match until the match-time fix and an indoor check are both in.';
      break;
    case 'formatSplit':
      if (edgeNotThisFormat(a)) return 'Best of 3: this layer applies to best-of-five only.';
      if ((x = /need (\d+)\+ Bo5/.exec(d))) return `Not enough best-of-five matches: the layer needs ${x[1]}+ for both players.`;
      break;
    case 'clutch':
      if (d === 'No data.') return 'No under-pressure index for at least one player.';
      if ((x = /index(?: on (\w+))? (\d+) vs (\d+)/.exec(d))) return `Under-pressure index ${x[2]} vs ${x[3]}${x[1] ? ' on ' + edgeCourt(x[1]) : ''} (break points and tiebreaks).`;
      break;
    case 'oddsMovement':
      if (/no-line/.test(d)) return 'The model’s own Pinnacle series holds no pre-match line for this match, so there is no market move to read.';
      if ((x = /Pinnacle move (\S+) < (\S+) threshold/.exec(d))) return `Pinnacle moved ${x[1]}, under the ${x[2]} the layer needs, so it reads as noise.`;
      break;
  }
  return d;
}
function edgeFigures(a){
  const d = String(a.detail || ''); let x;
  switch (a.key){
    case 'h2h': x = /^H2H (\d+)-(\d+)/.exec(d); return x ? [x[1], x[2]] : null;
    case 'surface': x = /record (\d+)% vs (\d+)%/.exec(d); return x ? [x[1] + '%', x[2] + '%'] : null;
    case 'recentForm': x = /^Form (\d+)% vs (\d+)%/.exec(d); return x ? [x[1] + '%', x[2] + '%'] : null;
    case 'qualityForm': x = /Career top\d+ dev ([+-]?[\d.]+)pp\(\d+m\) vs ([+-]?[\d.]+)pp/.exec(d); return x ? [edgeSigned(x[1]), edgeSigned(x[2])] : null;
    case 'winnerUE': x = /^W\/UE ([\d.]+) vs ([\d.]+)/.exec(d); return x ? [x[1], x[2]] : null;
    case 'serve': x = /^Serve rating ([\d.]+) vs ([\d.]+)/.exec(d); return x ? [x[1], x[2]] : null;
    case 'returnPressure': x = /^Return rating ([\d.]+) vs ([\d.]+)/.exec(d); return x ? [x[1], x[2]] : null;
    case 'fatigue': x = /=([\d.]+)u(?: \[[^\]]*\])? vs [^=]*=([\d.]+)u/.exec(d); return x ? [x[1], x[2]] : null;
    case 'clutch': x = /index(?: on \w+)? (\d+) vs (\d+)/.exec(d); return x ? [x[1], x[2]] : null;
  }
  return null;
}
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
      layer: edgeLayerName(a), weight: edgeWeightTag(a.maxMagnitude).word, quality: edgeQuality(a), active: !!a.applied,
      favours: !a.applied ? null : (even ? 'even' : name(a.direction)),
      shiftPP: !a.applied ? null : (even ? 0 : +delta.toFixed(1)),
      // The page reads styles from the Playing Styles grid, which the pipeline doesn't hold: the analysis says only that
      // the model does not read styles yet (TEN-419), never "no label".
      why: a.key === 'styleMatchup' && !a.applied ? 'The model does not read playing styles yet, so this layer is off.' : edgeWhyText(a, { p1: mm.p1, p2: mm.p2 }),
    };
  });
  const movers = adjs.filter(a => a.applied && Math.abs(a.deltaP1 || 0) >= 0.0005)
    .sort((a, b) => Math.abs(b.deltaP1) - Math.abs(a.deltaP1)).slice(0, 3)
    .map(a => ({ layer: edgeLayerName(a), favours: name(a.direction === 'p1' ? 'p1' : 'p2'), shiftPP: +(Math.abs(a.deltaP1) * 100).toFixed(1) }));
  const s3 = r.stage3 || {}, fair = s3.fair || {};
  const net = (r.stage2.totalDeltaP1 || 0) * 100;
  const sharp = m ? edgeSharp(m) : null;
  const fp = s => (fair[s] && fair[s].prob != null ? fair[s].prob : null);
  // The page's Gap: adjusted fair probability minus 1 / the price shown, in pp.
  const gap = (s, price) => (fp(s) == null || !(price > 1) ? null : +edgeGapOf(fp(s), +price.toFixed(2)).toFixed(1));
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
  '- Odds with two decimals, probabilities with one decimal and a % sign, gaps in pp, a true minus sign. Write "Elo".',
  '- A positive gapPP means the price is longer than fair ("1.44 at Betano, 0.4pp longer than fair"); a negative one,',
  '  shorter than fair. Say "N of M layers are active" with no "shown".',
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
