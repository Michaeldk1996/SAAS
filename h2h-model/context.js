'use strict';
/**
 * context.js — the model's own read of a match from our match reports and quotes (founder 2026-11-19: "it should
 * always give his impression and who has the edge based on his knowledge and what he understood from the match reports
 * and context"). Feeds layer #2 (Match context) automatically; a manual-inputs.json row for the match still wins.
 *
 * Input: every report and quote in news-ticker/*.json naming either player (as player or opponent) in the last
 * `windowDays`, newest `perPlayer` each, plus the match card's facts. Output (cached by an input hash, so a call is made
 * only when a new report or quote arrives): { edge, lean (−1..+1, P1 positive), confidence, why }.
 * The prompt is the general sharp-bettor method below, plus Michael's private analyst brief when ANALYST_BRIEF_PATH
 * points at one (it is private and never committed to this public repo).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const ROOT = path.resolve(__dirname, '..');

function tickerItems(root = ROOT) {
  const dir = path.join(root, 'news-ticker');
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch (_) { return []; }
  const out = [];
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      for (const it of (d && d.items) || []) if (it && (it.type === 'report' || it.type === 'quote') && it.text) out.push(it);
    } catch (_) { /* a broken file is skipped, never fatal */ }
  }
  return out;
}

// Reports and quotes about one player, inside the window: his match reports first (a report covers both players), then
// his own quotes, then what opponents said about him; newest first within each, the same text once.
function itemsFor(items, key, nowMs, c) {
  const k = String(key), since = nowMs - c.windowDays * 864e5;
  const rank = it => it.type === 'report' ? 0 : (String(it.playerId) === k ? 1 : 2);
  const seen = new Set();
  return items
    .filter(it => (String(it.playerId) === k || String(it.opponentId) === k) && Date.parse(it.timestamp) >= since
      && Date.parse(it.timestamp) <= nowMs)
    .sort((a, b) => (rank(a) - rank(b)) || (Date.parse(b.timestamp) - Date.parse(a.timestamp)))
    .filter(it => { const t = clean(it.text).slice(0, 120); if (seen.has(it.id) || seen.has(t)) return false; seen.add(it.id); seen.add(t); return true; })
    .slice(0, c.perPlayer);
}
const clean = t => String(t || '').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

// The step-9 style label by the card's short name (the Playing Styles page's label); unknown when two rows share it.
function styleLabels(root = ROOT) {
  try {
    const rows = JSON.parse(fs.readFileSync(path.join(root, 'playing-styles.json'), 'utf8')).players || [];
    const by = new Map();
    for (const r of rows) { if (!r.name || !r.archetype_label) continue; by.set(r.name, by.has(r.name) ? null : r.archetype_label); }
    return by;
  } catch (_) { return new Map(); }
}

const METHOD = `You are a sharp tennis bettor with ten years in the market, writing a one-line read for a model.
Rules:
- Use only the facts and texts given. Never invent a statistic, an injury or a quote.
- Read the match reports and quotes for form, how each player is playing this week, anything physical, time on court,
  confidence, motivation and the conditions; and the matchup and format over reputation.
- The market and the model already price ranking, Elo and long-run form. Only lean when the reports and context give
  a reason the other numbers may not hold. With nothing new, say even (lean 0).
- Sample size first: one match is one match. Keep leans small unless the texts point clearly one way.`;

function buildPrompt(match, facts, p1Items, p2Items) {
  const fmt = (arr) => arr.length ? arr.map(it => `- [${String(it.timestamp).slice(0, 10)} ${it.type === 'report' ? 'match report' : 'quote by ' + it.player}, ${it.player} v ${it.opponent || '?'}${it.round ? ', ' + it.round : ''}] ${clean(it.text).slice(0, 900)}`).join('\n') : '- none';
  return `Match: ${facts.p1} (P1) v ${facts.p2} (P2), ${facts.event}${facts.round ? ', ' + facts.round : ''}, ${facts.surface}` +
    `${facts.speed ? ', ' + facts.speed + ' court' : ''}, best of ${facts.bestOf}.
Styles: P1 ${facts.style1 || 'unknown'}; P2 ${facts.style2 || 'unknown'}.

Recent reports and quotes about P1:
${fmt(p1Items)}

Recent reports and quotes about P2:
${fmt(p2Items)}

Answer with JSON only: {"edge":"p1"|"p2"|"even","lean":<number from -1 (P2 clearly) to 1 (P1 clearly)>,` +
    `"confidence":"low"|"med"|"high","why":"<one sentence, at most 30 words, surnames only, from the texts above>"}`;
}

function parseRead(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const lean = Number(j.lean);
    if (!Number.isFinite(lean)) return null;
    return { edge: ['p1', 'p2', 'even'].includes(j.edge) ? j.edge : (lean > 0 ? 'p1' : lean < 0 ? 'p2' : 'even'),
      lean: Math.max(-1, Math.min(1, lean)), confidence: ['low', 'med', 'high'].includes(j.confidence) ? j.confidence : 'low',
      why: String(j.why || '').slice(0, 300) };
  } catch (_) { return null; }
}

// The inputs and their hash, without any call (the pipeline reuses a cached read when the hash is unchanged).
function contextInputs(match, opts = {}) {
  const c = config.adjustments.subjective.context;
  const nowMs = opts.nowMs || Date.now();
  const items = opts.items || tickerItems(opts.root);
  if (match.p1Key == null || match.p2Key == null) return null;
  const p1Items = itemsFor(items, match.p1Key, nowMs, c), p2Items = itemsFor(items, match.p2Key, nowMs, c);
  const facts = { p1: match.p1, p2: match.p2, event: match.tour || '', round: match.tournamentRound || '',
    surface: match.surface || '', speed: match.courtSpeed && match.courtSpeed.category, bestOf: match.bestOf || 3,
    style1: null, style2: null };
  const st = opts.styles || styleLabels(opts.root);
  facts.style1 = st.get(match.p1) || null; facts.style2 = st.get(match.p2) || null;
  const prompt = buildPrompt(match, facts, p1Items, p2Items);
  const hash = crypto.createHash('sha256').update(c.model + '\n' + prompt).digest('hex').slice(0, 16);
  return { prompt, hash, n: { p1: p1Items.length, p2: p2Items.length } };
}

async function readContext(inputs, opts = {}) {
  const c = config.adjustments.subjective.context;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, reason: 'no ANTHROPIC_API_KEY' };
  if (!inputs.n.p1 && !inputs.n.p2) return { ok: true, read: { edge: 'even', lean: 0, confidence: 'low', why: '' }, hash: inputs.hash, noItems: true };
  let brief = '';
  try { if (process.env.ANALYST_BRIEF_PATH) brief = fs.readFileSync(process.env.ANALYST_BRIEF_PATH, 'utf8').slice(0, c.briefMaxChars); } catch (_) { /* optional */ }
  const Anthropic = opts.Anthropic || require('@anthropic-ai/sdk');
  try {
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({ model: c.model, max_tokens: 300,
      system: METHOD + (brief ? `\n\nThe bettor's own method and reads (follow where it applies):\n${brief}` : ''),
      messages: [{ role: 'user', content: inputs.prompt }] });
    const text = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const read = parseRead(text);
    if (!read) return { ok: false, reason: 'unreadable answer', hash: inputs.hash };
    return { ok: true, read, hash: inputs.hash, model: c.model, usage: msg.usage || null, brief: !!brief };
  } catch (e) {
    return { ok: false, reason: `${e && e.constructor ? e.constructor.name : 'Error'}: ${String(e && e.message || '').slice(0, 160)}`, hash: inputs.hash };
  }
}

module.exports = { contextInputs, readContext, parseRead, itemsFor, tickerItems, styleLabels };
