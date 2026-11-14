// News ticker — the broadcast's "Match Statistics" card, read automatically (founder 2026-11-13).
// @ATP_Entry posts the ATP broadcast graphic after each match (measured 8–12 Nov 2026: 21 of 22 Stockholm matches,
// median 35 minutes after match point). This job, run by .github/workflows/match-cards.yml:
//   1. reads ONLY the posts newer than the last one seen (X bills per post read; never a back-fill),
//   2. ties a card to the one finished match of those two players on our board,
//   3. has a model read every number on the image,
//   4. keeps the card only when it agrees with OUR score and serve figures for that match,
//   5. writes news-quotes/match-cards.json (by api-tennis match id). The image itself is never stored or republished.
// A walkover post carries its reason ("W.O. (Left Calf)"): kept beside the cards.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { surnameOf } from './humanise.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
export const X_USER = '1549708186885701632';   // @ATP_Entry (the id is cached: a user lookup is billed)
export const MAX_POSTS = 100;                   // one page per run, never more
export const CARD_DAYS = 3;
export const PCT_TOL = 3;                       // card vs our box score, percentage points
export const MAX_TRIES = 3;
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.NEWS_CARD_MODEL || process.env.NEWS_TRANSLATE_MODEL || 'claude-opus-5-5';

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ascii = (s) => String(s || '').replace(/&amp;/g, '&').replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim();
const lastWord = (s) => fold(s).replace(/[^a-z' -]/g, ' ').trim().split(/\s+/).pop();

// "Musetti 76(5) 36 64 Humbert (C. Rask) #StockholmOpen" -> { kind:'match', winner, loser, sets:[[7,6],[3,6],[6,4]] }
// "Tirante W.O. (Left Calf) Etcheverry (J. Welte) #StockholmOpen" -> { kind:'walkover', winner, loser, reason }
export function parsePost(text) {
  const t = ascii(text);
  const wo = /^([A-Za-z.' -]+?)\s+W\.?O\.?\s*(?:\(([^)]{2,40})\))?\s+([A-Za-z.' -]+?)\s+\([^)]*\)\s+#/.exec(t);
  if (wo) return { kind: 'walkover', winner: wo[1].trim(), loser: wo[3].trim(), reason: wo[2] ? wo[2].trim() : null };
  const m = /^([A-Za-z.' -]+?)\s+((?:\d\d(?:\(\d+\))?\s+){2,5})([A-Za-z.' -]+?)\s+\([^)]*\)\s+#/.exec(t);
  if (!m) return null;
  const sets = m[2].trim().split(/\s+/).map((s) => [+s[0], +s[1]]);
  return { kind: 'match', winner: m[1].trim(), loser: m[3].trim(), sets };
}

// The one board card of those two players (winner first in the post), dated within 2 days of the post.
export function findMatch(post, at, cards, { walkover = false } = {}) {
  const ts = Date.parse(at), w = lastWord(post.winner), l = lastWord(post.loser);
  const hits = [];
  for (const c of cards || []) {
    if (!c.finalScore || !c.finalScore.winner || !!c.walkover !== walkover) continue;
    const d = Date.parse(c.date + 'T12:00:00Z');
    if (!Number.isFinite(d) || Math.abs(ts - d) > 2.5 * 86400000) continue;
    const ws = c.finalScore.winner, ls = ws === 'p1' ? 'p2' : 'p1';
    if (lastWord(c[ws]) === w && lastWord(c[ls]) === l) hits.push(c);
  }
  return hits.length === 1 ? hits[0] : null;
}

const NUM = ['performance', 'serveQuality', 'unreturnedPct', 'firstInPct', 'firstWonPct', 'secondWonPct', 'secondSpeed', 'returnQuality',
  'fhWinners', 'bhWinners', 'fhUnforced', 'bhUnforced', 'forcedErrors', 'baselineWon', 'under9Won', 'over9Won'];
const PAIR = ['bpWon', 'netWon'];
const SYSTEM = `You read one image: a two-panel tennis broadcast graphic titled MATCH STATISTICS, with one player on the left and one on the right. Return ONLY a JSON object, no prose:
{"left":{"name":"SURNAME","performance":0.0,"serveQuality":0.0,"unreturnedPct":0,"firstInPct":0,"firstWonPct":0,"secondWonPct":0,"secondSpeed":0,"returnQuality":0.0,"bpWon":[0,0],"fhWinners":0,"bhWinners":0,"fhUnforced":0,"bhUnforced":0,"forcedErrors":0,"netWon":[0,0],"baselineWon":0,"under9Won":0,"over9Won":0},"right":{...same keys...},"sets":[[leftGames,rightGames]]}
Rules: copy each number exactly as printed. "bpWon" and "netWon" are the two numbers of a fraction like 2/4 -> [2,4]. In the score header a small raised digit beside a 6 or 7 is a tiebreak score: ignore it ("6 with a small 5" is 6). A value you cannot read with certainty, or that is not on the image, is null. Never estimate. If the image is not this graphic, return {"notCard":true}.`;

export async function readCard(imageUrl, apiKey = process.env.ANTHROPIC_API_KEY, fetchFn = fetch) {
  if (!apiKey) return { status: 'no-key' };
  let b64, type;
  try {
    const r = await fetchFn(imageUrl);
    if (!r.ok) return { status: 'image-error', detail: `HTTP ${r.status}` };
    type = (r.headers && r.headers.get && r.headers.get('content-type')) || 'image/jpeg';
    b64 = Buffer.from(await r.arrayBuffer()).toString('base64');
  } catch (e) { return { status: 'image-error', detail: String(e).slice(0, 120) }; }
  const body = { model: MODEL, max_tokens: 1500, output_config: { effort: 'low' }, system: SYSTEM,
    messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: type.split(';')[0], data: b64 } }, { type: 'text', text: 'Read the graphic.' }] }] };
  let res;
  try { res = await fetchFn(API_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) }); }
  catch (e) { return { status: 'api-error', detail: String(e).slice(0, 120) }; }
  if (!res.ok) return { status: 'api-error', detail: `HTTP ${res.status}` };
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === 'text');
  let j;
  try { j = JSON.parse(String(block ? block.text : '').replace(/^```(?:json)?|```$/gm, '').trim()); } catch (e) { return { status: 'bad-json' }; }
  if (j && j.notCard) return { status: 'not-card' };
  return { status: 'ok', card: j, usage: data.usage ? { input: data.usage.input_tokens || 0, output: data.usage.output_tokens || 0 } : null };
}

// One side of the model's reading -> clean numbers (anything that is not a plain number is null).
function side(x) {
  const o = {};
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  for (const k of NUM) o[k] = n(x && x[k]);
  for (const k of PAIR) { const v = x && x[k]; o[k] = Array.isArray(v) && v.length === 2 && n(v[0]) != null && n(v[1]) != null && v[0] <= v[1] ? [v[0], v[1]] : null; }
  return o;
}

// The reading against OUR record of the match: left/right mapped to p1/p2 by surname; the set scores must be ours
// exactly; the three serve percentages and the break points must agree. -> { ok, why, byPlayer:{p1,p2} }
export function verifyCard(card, m) {
  if (!card || !card.left || !card.right) return { ok: false, why: 'no two players on the card' };
  const L = lastWord(card.left.name), R = lastWord(card.right.name);
  let map = null;
  if (L === lastWord(m.p1) && R === lastWord(m.p2)) map = { left: 'p1', right: 'p2' };
  else if (L === lastWord(m.p2) && R === lastWord(m.p1)) map = { left: 'p2', right: 'p1' };
  if (!map) return { ok: false, why: `names on the card (${card.left.name} / ${card.right.name}) are not this match` };
  const ours = (m.finalScore.sets || []).map((s) => [s[map.left], s[map.right]]);
  const theirs = Array.isArray(card.sets) ? card.sets.map((s) => [s[0], s[1]]) : [];
  if (JSON.stringify(ours) !== JSON.stringify(theirs)) return { ok: false, why: `set scores differ (card ${JSON.stringify(theirs)}, ours ${JSON.stringify(ours)})` };
  const by = { [map.left]: side(card.left), [map.right]: side(card.right) };
  let checked = 0, close = 0;
  for (const k of ['p1', 'p2']) {
    const st = (m.matchStats || {})[k] || {}, raw = st.raw || {};
    for (const [ck, ok] of [['firstInPct', 'Service:1st serve percentage'], ['firstWonPct', 'Service:1st serve points won'], ['secondWonPct', 'Service:2nd serve points won']]) {
      const a = by[k][ck], b = typeof st[ok] === 'number' ? st[ok] : null;
      if (a == null || b == null) continue;
      checked++;
      if (Math.abs(a - b) > 2 * PCT_TOL) return { ok: false, why: `${ck} differs too much for ${m[k]} (card ${a}, ours ${Math.round(b)})` };
      if (Math.abs(a - b) <= PCT_TOL) close++;
    }
    const bp = by[k].bpWon, rb = raw['Return:Break Points Converted'];
    if (bp && rb && (bp[0] !== rb.won || bp[1] !== rb.total)) return { ok: false, why: `break points differ for ${m[k]} (card ${bp.join('/')}, ours ${rb.won}/${rb.total})` };
  }
  if (checked < 4 || close < checked - 1) return { ok: false, why: `only ${close} of ${checked} serve figures agree with ours` };
  // winners / unforced errors: the card splits them by wing, ours are totals (founder 2026-11-13). They reconcile as
  // W = aces + forehand + backhand winners, UE = forehand + backhand unforced + double faults. Recorded, never a reason
  // to drop a card: the report prints OUR totals, not the card's wings.
  const wue = { compared: 0, maxDiff: null };
  for (const k of ['p1', 'p2']) {
    const st = (m.matchStats || {})[k] || {}, c = by[k], n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const pairs = [[n(st['Points:Winners']), [n(st['Service:Aces']), c.fhWinners, c.bhWinners]], [n(st['Points:Unforced errors']), [n(st['Service:Double Faults']), c.fhUnforced, c.bhUnforced]]];
    for (const [ours2, parts] of pairs) { if (ours2 == null || parts.some((v) => v == null)) continue; const d = Math.abs(ours2 - parts.reduce((t, v) => t + v, 0)); wue.compared++; wue.maxDiff = Math.max(wue.maxDiff == null ? 0 : wue.maxDiff, d); }
  }
  return { ok: true, why: null, byPlayer: by, checked, close, wue };
}

// Report sentences from a verified card (founder 2026-11-13: "serve quality, unreturned serves, return quality,
// performance rating, and … high difference of over 9 shots won, and also from the baseline"). The performance rating
// goes on the closing line (news-core ratingLines). Written as our own observation: the card is never named.
// A number is printed only when it says something; the loser gets one sentence at most.
export const SQ_HIGH = 8.5, UNRET_HIGH = 35, RQ_HIGH = 8, RQ_LOW = 6, BASELINE_GAP = 10, LONG_GAP = 6;
const q1 = (v) => v.toFixed(1), art = (v) => (/^(8|11|18)/.test(q1(v)) ? 'an' : 'a');
export function shotSentences(m, w, l, entry) {
  if (!entry || !entry.p1 || !entry.p2) return [];
  const out = [], c = { [w]: entry[w], [l]: entry[l] };
  for (const k of [w, l]) {
    const x = c[k], name = surnameOf(m[k]), mine = [];
    const sq = x.serveQuality, un = x.unreturnedPct, rq = x.returnQuality;
    if ((sq != null && sq >= SQ_HIGH) || (un != null && un >= UNRET_HIGH)) {
      const bits = [];
      if (sq != null) bits.push(`${art(sq)} ${q1(sq)} serve quality`);
      if (un != null) bits.push(`${un}% unreturned serves`);
      mine.push(`${name} ended with ${bits.join(' and ')}.`);
    }
    if (rq != null && rq >= RQ_HIGH) mine.push(mine.length ? `He also returned very well, with ${art(rq)} ${q1(rq)} return quality.` : `${name} returned very well, with ${art(rq)} ${q1(rq)} return quality.`);
    else if (rq != null && rq < RQ_LOW) {   // a strong serve day and a weak return day are one sentence: that contrast is the story
      if (mine.length) mine[0] = `${mine[0].slice(0, -1)} but it was not his best return performance, with a return quality of ${q1(rq)}.`;
      else mine.push(`It was not the best return performance of ${name}, with a return quality of ${q1(rq)}.`);
    }
    out.push(...(k === l ? mine.slice(0, 1) : mine));
  }
  const gap = (key, min) => { const a = c[w][key], b = c[l][key]; return a != null && b != null && Math.abs(a - b) >= min ? { k: a > b ? w : l, hi: Math.max(a, b), lo: Math.min(a, b) } : null; };
  const base = gap('baselineWon', BASELINE_GAP), long = gap('over9Won', LONG_GAP);
  if (base) out.push(`${surnameOf(m[base.k])} was clearly the better player from the baseline (${base.hi}–${base.lo}).`);
  if (long) out.push(`${surnameOf(m[long.k])} won the long rallies ${long.hi}–${long.lo}.`);
  return out;
}

const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const wr = (f, o) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 1) + '\n'); fs.renameSync(t, f); };

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const nowIso = arg('now', new Date().toISOString()), DIR = path.resolve(arg('dir', ROOT)), BASE = arg('base', 'https://michaeldk1996.github.io/SAAS').replace(/\/$/, '');
  const stateFile = path.join(DIR, 'news-quotes/match-cards-state.json'), outFile = path.join(DIR, 'news-quotes/match-cards.json');
  const state = rd(stateFile, null), tok = process.env.X_BEARER_TOKEN;
  if (!state || !state.lastSeenId) { console.error('match cards: no lastSeenId in the state file — refusing to read the whole timeline'); process.exit(1); }
  if (!tok) { console.error('match cards: X_BEARER_TOKEN is not set'); process.exit(1); }
  const p = new URLSearchParams({ max_results: String(MAX_POSTS), since_id: state.lastSeenId, 'tweet.fields': 'created_at,attachments', expansions: 'attachments.media_keys', 'media.fields': 'url,type', exclude: 'retweets,replies' });
  const r = await fetch(`https://api.x.com/2/users/${X_USER}/tweets?${p}`, { headers: { authorization: `Bearer ${tok}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error(`match cards: X API ${r.status} ${JSON.stringify(j).slice(0, 200)}`); process.exit(1); }
  const media = new Map(((j.includes && j.includes.media) || []).map((x) => [x.media_key, x]));
  const posts = (j.data || []).map((t) => ({ id: t.id, at: t.created_at, text: t.text, image: ((t.attachments && t.attachments.media_keys) || []).map((k) => (media.get(k) || {}).url).filter(Boolean)[0] || null }));
  state.postsRead = (state.postsRead || 0) + posts.length;
  if (posts.length) state.lastSeenId = posts.map((x) => x.id).sort((a, b) => (BigInt(a) > BigInt(b) ? -1 : 1))[0];
  let cards = await (await fetch(BASE + '/matches.json')).json(); cards = Array.isArray(cards) ? cards : cards.matches || [];
  const store = rd(outFile, { byMatch: {}, walkovers: {} });
  store.byMatch = store.byMatch || {}; store.walkovers = store.walkovers || {};
  // a card whose match was not on the board yet (or whose reading failed for a passing reason) is tried again
  const queue = (state.pending || []).concat(posts.map((x) => ({ ...x, tries: 0 }))).filter((x) => Date.parse(nowIso) - Date.parse(x.at) < CARD_DAYS * 86400000);
  const pending = [], sum = { posts: posts.length, cards: 0, kept: 0, rejected: 0, walkovers: 0, waiting: 0 };
  for (const x of queue) {
    const pp = parsePost(x.text);
    if (!pp) continue;
    if (pp.kind === 'walkover') {
      const m = findMatch(pp, x.at, cards, { walkover: true });
      if (m && pp.reason) { store.walkovers[String(m.id).split('-').slice(1).join('-')] = { reason: pp.reason, withdrew: pp.loser, sourceUrl: `https://x.com/ATP_Entry/status/${x.id}`, at: x.at }; sum.walkovers++; }
      else if (pp.reason && x.tries < MAX_TRIES) pending.push({ ...x, tries: x.tries + 1 });
      continue;
    }
    if (!x.image) continue;
    sum.cards++;
    const m = findMatch(pp, x.at, cards);
    if (!m) { if (x.tries < MAX_TRIES * 4) { pending.push({ ...x, tries: x.tries + 1 }); sum.waiting++; } continue; }
    const ek = String(m.id).split('-').slice(1).join('-');
    if (store.byMatch[ek]) continue;
    const rc = await readCard(x.image);
    if (rc.status === 'no-key' || rc.status === 'api-error' || rc.status === 'image-error') { if (x.tries < MAX_TRIES) pending.push({ ...x, tries: x.tries + 1 }); console.log(`  ${pp.winner} v ${pp.loser}: ${rc.status} ${rc.detail || ''}`); continue; }
    const v = rc.status === 'ok' ? verifyCard(rc.card, m) : { ok: false, why: rc.status };
    if (!v.ok) { sum.rejected++; console.log(`  REJECTED ${pp.winner} v ${pp.loser}: ${v.why}`); (state.rejected = state.rejected || []).push({ id: x.id, at: x.at, why: v.why }); state.rejected = state.rejected.slice(-50); continue; }
    store.byMatch[ek] = { p1: v.byPlayer.p1, p2: v.byPlayer.p2, postedAt: x.at, readAt: nowIso, sourceName: 'ATP broadcast match statistics (via @ATP_Entry)', sourceUrl: `https://x.com/ATP_Entry/status/${x.id}`, agreed: `${v.close} of ${v.checked} serve figures within ${PCT_TOL} points of ours; set scores and break points equal`, ...(v.wue && v.wue.compared ? { wue: v.wue } : {}) };
    sum.kept++;
  }
  const cut = Date.parse(nowIso) - 60 * 86400000;
  for (const k of Object.keys(store.byMatch)) if (Date.parse(store.byMatch[k].readAt) < cut) delete store.byMatch[k];
  for (const k of Object.keys(store.walkovers)) if (Date.parse(store.walkovers[k].at) < cut) delete store.walkovers[k];
  state.pending = pending; state.updatedAt = nowIso;
  if (sum.kept || sum.walkovers) { store.updatedAt = nowIso; wr(outFile, store); }
  wr(stateFile, state);
  console.log(`match cards: ${JSON.stringify(sum)} · ${pending.length} waiting for a later run`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
