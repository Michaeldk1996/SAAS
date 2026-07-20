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

/**
 * Build the compact, factual context handed to Claude. Only real, model-derived
 * values go in here — nothing is invented or approximated.
 * @param {object} r  a successful runModel() result (r.ok === true)
 */
function buildFacts(r) {
  const cfg = config.summary;
  const m = r.match;
  const p1 = r.players.p1, p2 = r.players.p2;

  // Strongest applied adjustments, largest probability impact first.
  const applied = r.stage2.adjustments
    .filter(a => a.applied && Math.abs(a.deltaP1) > 0)
    .sort((a, b) => Math.abs(b.deltaP1) - Math.abs(a.deltaP1))
    .slice(0, cfg.topAdjustments)
    .map(a => ({
      layer: a.name,
      favours: a.direction === 'p1' ? m.p1 : a.direction === 'p2' ? m.p2 : 'neither',
      deltaP1Pct: +(a.deltaP1 * 100).toFixed(2),
      detail: a.detail,
    }));

  const s3 = r.stage3;
  const facts = {
    match: {
      p1: m.p1, p2: m.p2, tour: m.tour, round: m.round,
      surface: m.surface, bestOf: m.bestOf,
    },
    players: {
      p1: { name: p1.name, elo: p1.eloAll, archetype: p1.archetype || 'unclassified' },
      p2: { name: p2.name, elo: p2.eloAll, archetype: p2.archetype || 'unclassified' },
    },
    baseProb: { p1: r.stage1.baseP1, p2: r.stage1.baseP2 },
    adjustedProb: { p1: r.stage2.adjustedP1, p2: r.stage2.adjustedP2 },
    topAdjustments: applied,
    fair: s3 && s3.fair ? { p1: s3.fair.p1, p2: s3.fair.p2 } : null,
    sharp: s3 && s3.sharp ? {
      source: s3.sharp.source,
      vigFreeProb: s3.sharp.vigFreeProb,
      edge: s3.sharp.edge,
    } : null,
    valueFlags: (s3 && s3.flags ? s3.flags : []).map(f => ({
      type: f.type,
      side: f.side === 'p1' ? m.p1 : m.p2,
      price: f.price, book: f.book, edgePct: f.edgePct,
    })),
  };
  return facts;
}

// Bump PROMPT_VERSION whenever SYSTEM_PROMPT changes shape. bsp-pipeline.js
// folds it into the summary cache key, so a prompt edit invalidates every
// cached summary. Without it the cache is keyed on the model FACTS alone and a
// reworded prompt silently never reaches the site — the old text is reused
// until a match's numbers happen to move.
const PROMPT_VERSION = 2;

// The dashboard's Tennis Edge Analysis card labels exactly five paragraphs
// (Players / Matchup / Tournament / Keys / Verdict) and only applies those
// labels when it receives exactly five. Anything else renders as unlabelled
// prose. So this prompt asks for five paragraphs, in that order, blank-line
// separated — the labels are the dashboard's, they are NOT written here.
const SYSTEM_PROMPT = [
  'You are a tennis betting analyst writing an internal note for a sharp ATP',
  'bettor. You are given the structured output of a quantitative H2H model.',
  '',
  'Rules:',
  '- Use ONLY the numbers provided. Never invent stats, prices, or history.',
  '- Sentence case throughout. No hype, no exclamation marks, no emojis.',
  '- Probabilities are the model\'s, not certainties.',
  '- Do not give financial advice or stake sizing.',
  '',
  'Format — exactly five paragraphs, in this order, separated by a blank line.',
  'Write no headings, labels or numbering: the note is rendered under fixed',
  'headings that are added downstream, so any heading you write is a duplicate.',
  'Two to three sentences per paragraph.',
  '',
  '1. The two players: Elo ratings, archetypes, and the base probability the',
  '   ratings alone imply.',
  '2. The matchup: the adjustments that move the base probability most, named,',
  '   with their direction and size, and who they favour.',
  '3. The tournament context: surface, event, round and best-of, and what that',
  '   setting does to the read.',
  '4. The keys: the one or two factors this match actually turns on.',
  '5. The verdict: adjusted probability, fair price, and the value picture',
  '   against the market. If a value flag exists, name the player, price, book',
  '   and edge. If there is no flag, say the price looks fair.',
  '',
  'If a paragraph\'s inputs are missing from the JSON, still write that',
  'paragraph and say plainly in one sentence what is not available. Never pad a',
  'paragraph with invented detail to fill the structure — an honest "no sharp',
  'line is quoted for this match" is correct and expected.',
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
 * @param {object} [opts] { apiKey?, model?, maxTokens? } — overrides for tests;
 *                        apiKey is only for callers that manage their own key,
 *                        it is passed straight to the SDK and never logged.
 * @returns {Promise<object>} one of:
 *   { ok:true,  summary, model, usage }
 *   { ok:false, gated:true,  reason }   (config off / no key / no SDK / model not run)
 *   { ok:false, gated:false, reason }   (API/runtime error)
 */
async function generateSummary(modelResult, opts = {}) {
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
  const facts = buildFacts(modelResult);

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

module.exports = { generateSummary, buildFacts, PROMPT_VERSION };
