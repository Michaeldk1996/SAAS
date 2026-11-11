#!/usr/bin/env node
/**
 * News ticker — the quote collector. Runs on its own schedule (.github/workflows/news-quotes.yml, every 30 minutes) and
 * does work only while an ATP tournament has a match in play or finished today (UTC).
 *
 *   reads   the deployed board (matches.json, player-index.json), data/news-outlets.json (only status "allowed" is ever
 *           fetched), each allowed source's pages (robots.txt honoured, one request per page);
 *   writes  news-quotes/<tournamentKey>-<season>.json (permanent, merged by item id), news-quotes/state.json,
 *           news-quotes/run-log.json (the last 400 runs: counts per check, sources, translation tokens).
 * The pipeline's build-news-ticker.mjs folds those items into the feed on its next run.
 *
 * Per quote: verbatim check on the ORIGINAL-language text -> exactly one player of that tournament's field ->
 * translation (pipeline key) with its checks -> English-first -> same quote from two outlets is one item.
 * Failing items are dropped and counted, never repaired.
 *
 * Alerts (Telegram, pipeline chat): a model call failing on credit or key (first failure of a streak); no item for
 * 24 hours while a tournament is on. The workflow itself alerts when this script fails.
 *
 * Usage: node tools/news-ticker/collect-quotes.mjs [--base <site url>] [--dir .] [--now ISO] [--force]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verbatimIn, resolvePlayer, foldText } from './news-core.mjs';
import { collectQuotes } from './quote-sources.mjs';
import { translateQuote } from './translate.mjs';
import { mergeItems, dedupeQuotes, sameQuote } from './ticker-core.mjs';
import { sendTelegram } from '../price-alert-send.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes('--' + k);
export const SILENT_HOURS = 24;

const COUNTRY_ALIAS = { 'United States': 'USA', US: 'USA', 'Great Britain': 'United Kingdom', UK: 'United Kingdom', Czechia: 'Czech Republic' };
const canonCountry = (c) => COUNTRY_ALIAS[c] || c;

// The tournaments worth a run: an ATP singles card dated today (UTC: scheduled, in play or finished), or one that
// finished yesterday (late finishes are written up the next morning).
export function activeTournaments(board, nowIso) {
  const today = nowIso.slice(0, 10), yesterday = new Date(Date.parse(today + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10), out = new Map();
  for (const m of Object.values(board || {})) {
    if (!m || m.tourBadge !== 'ATP' || m.tournamentKey == null || /\//.test(String(m.p1) + String(m.p2))) continue;
    const season = String(m.date || '').slice(0, 4), id = `${m.tournamentKey}|${season}`;
    if (!out.has(id)) out.set(id, { key: String(m.tournamentKey), season, name: String(m.tour || '').replace(/^ATP\s+/i, '').trim(), cards: [], active: false });
    const t = out.get(id); t.cards.push(m);
    // the published board leaves a match out while it is in play, so "in play" = it has a card dated today
    if (m.live || m.liveStatus || m.date === today || (m.finalScore && m.finalScore.winner && m.date === yesterday)) t.active = true;
  }
  return [...out.values()];
}

// Registry -> the source config quote-sources.mjs reads. Only "allowed" entries, for the host country and the home
// countries of the players in the draw.
export function siteConfig(registry, t, countries) {
  const ts = (registry.tournamentSites || []).find((x) => String(x.tournamentKey) === t.key && x.status === 'allowed');
  const want = new Set([...(countries || []), ts && ts.hostCountry].filter(Boolean).map(canonCountry));
  const press = (registry.outlets || []).filter((o) => o.status === 'allowed' && o.adapter && want.has(canonCountry(o.country)))
    .map((o) => ({ name: o.outlet, origin: o.adapter.origin, list: o.adapter.list, article: new RegExp(o.adapter.articlePattern, 'g'),
      mention: new RegExp(`\\b${t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'), language: o.language, style: o.adapter.style }));
  if (!ts && !press.length) return null;
  return { ...(ts ? { name: ts.name, ownName: ts.ownName, origin: ts.origin, list: ts.list, feed: ts.feed, article: new RegExp(ts.articlePattern, 'g') } : {}), press };
}

const quoteId = (playerId, originalText) => 'quote-' + crypto.createHash('sha1').update(String(playerId) + '|' + foldText(originalText).toLowerCase()).digest('hex').slice(0, 14);

// One tournament: candidates -> checked, translated, de-duplicated items. translate is injectable for the tests.
export async function processTournament({ t, got, translate = translateQuote, known = [] }) {
  const entrants = new Map();
  t.cards.forEach((m) => { if (m.p1Key != null) entrants.set(String(m.p1Key), m.p1); if (m.p2Key != null) entrants.set(String(m.p2Key), m.p2); });
  const c = { candidates: 0, droppedNotVerbatim: 0, droppedNoPlayer: 0, droppedAmbiguous: 0, notTranslatedNoKey: 0, notTranslatedApiError: 0,
    droppedTranslationCheck: 0, droppedEnglishExists: 0, mergedSameQuote: 0, alreadyHeld: 0, items: 0, tokens: { input: 0, output: 0 }, modelError: null };
  const ok = [];
  for (const q of got.candidates) {
    c.candidates++;
    if (!(q.spans || [q.text]).every((sp) => verbatimIn(sp, q.sourceText))) { c.droppedNotVerbatim++; continue; }
    const who = resolvePlayer(q.speaker, entrants);
    if (who.status !== 'one') { c[who.status === 'several' ? 'droppedAmbiguous' : 'droppedNoPlayer']++; continue; }
    const opp = q.opponent ? resolvePlayer(q.opponent, entrants) : null;
    ok.push({ q, key: who.key, opp: opp && opp.status === 'one' ? opp.key : null });
  }
  ok.sort((a, b) => (a.q.language === 'en' ? 0 : 1) - (b.q.language === 'en' ? 0 : 1) || String(a.q.timestamp || '').localeCompare(String(b.q.timestamp || '')));
  const heldById = new Map(known.map((x) => [x.id, x]));
  const out = [];
  for (const { q, key, opp } of ok) {
    const id = quoteId(key, q.text);
    let text = q.text, original = null, translated = false, model = null;
    if (q.language !== 'en') {
      const held = heldById.get(id);
      if (held) { c.alreadyHeld++; text = held.text; original = held.originalText; translated = true; model = held.translationModel; }   // never translate the same quote twice
      else {
        const tr = await translate(q.text, q.language);
        if (tr.usage) { c.tokens.input += tr.usage.input; c.tokens.output += tr.usage.output; }
        if (tr.status === 'no-key') { c.notTranslatedNoKey++; continue; }
        if (tr.status === 'api-error') { c.notTranslatedApiError++; c.modelError = c.modelError || { http: tr.http || null, detail: String(tr.detail || '').slice(0, 200) }; continue; }
        if (tr.status !== 'ok') { c.droppedTranslationCheck++; continue; }
        original = q.text; text = tr.text; translated = true; model = tr.model;
      }
      if (out.some((e) => e.language === 'en' && sameQuote(e, { playerId: key, text }))) { c.droppedEnglishExists++; continue; }
    }
    out.push({ id, type: 'quote', playerId: key, opponentId: opp, player: entrants.get(key), opponent: opp ? entrants.get(opp) : null,
      tournament: t.name, tournamentKey: t.key, season: t.season, round: null, timestamp: q.timestamp, timestampKind: q.timestampKind,
      category: 'Quotes', context: q.context || null, eventKey: q.matchId ? String(q.matchId).split('-').slice(1).join('-') : null, won: q.matchId ? !!q.won : null,
      text, originalText: original, language: q.language, translated, translationModel: model,
      sourceName: q.sourceName, sourceUrl: q.sourceUrl, verbatimCheck: 'passed', verbatimCheckedOn: 'the original-language text of the fetched page' });
  }
  const deduped = dedupeQuotes(out);
  c.mergedSameQuote = out.length - deduped.length; c.items = deduped.length;
  return { items: deduped, counts: c };
}

// -> the alert texts due now (and the state they leave). Pure.
export function dueAlerts(state, { nowIso, anyActive, itemsHeldOrNew, modelError }) {
  const s = { ...state }, alerts = [], now = Date.parse(nowIso);
  if (modelError) {
    if (!s.modelFailingSince) { s.modelFailingSince = nowIso; alerts.push(`News ticker: the translation model call failed (${modelError.http ? 'HTTP ' + modelError.http + ' ' : ''}${modelError.detail}). Non-English quotes are held back until it works again.`); }
  } else if (s.modelFailingSince && itemsHeldOrNew.translatedOk) { delete s.modelFailingSince; }
  if (itemsHeldOrNew.newItems > 0) s.lastItemAt = nowIso;
  if (anyActive) {
    if (!s.activeSince) s.activeSince = nowIso;
    const ref = Date.parse(s.lastItemAt || s.activeSince);
    const quiet = (now - Math.max(ref, Date.parse(s.activeSince))) / 3600000;
    const last = s.silentAlertAt ? (now - Date.parse(s.silentAlertAt)) / 3600000 : Infinity;
    if (quiet >= SILENT_HOURS && last >= SILENT_HOURS) { s.silentAlertAt = nowIso; alerts.push(`News ticker: the quote collector has found no new quote for ${Math.floor(quiet)} hours while an ATP tournament is on.`); }
  } else { delete s.activeSince; delete s.silentAlertAt; }
  return { state: s, alerts };
}

async function main() {
  if (flag('test-alerts')) {
    for (const text of ['TEST — News ticker alert 2 of 3: the quote job failing, or no new quote for 24 hours during a tournament week. (Triggered by hand; nothing is wrong.)',
      'TEST — News ticker alert 3 of 3: a model call failing on credit or key. (Triggered by hand; nothing is wrong.)']) { const r = await sendTelegram(text); console.log('test alert: ' + (r.ok ? 'sent' : 'NOT sent ' + r.why)); }
    return;
  }
  const BASE = arg('base', 'https://michaeldk1996.github.io/SAAS').replace(/\/$/, '');
  const DIR = path.resolve(arg('dir', ROOT)), nowIso = arg('now', new Date().toISOString());
  const rd = (p) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, p), 'utf8')); } catch (e) { return null; } };
  const wr = (p, o) => { const f = path.join(DIR, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(o, null, 1) + '\n'); fs.renameSync(f + '.tmp', f); };
  const getJson = async (p) => { for (let i = 0; i < 3; i++) { try { const r = await fetch(`${BASE}/${p}`, { signal: AbortSignal.timeout(60000) }); if (r.ok) return await r.json(); } catch (e) { /* retry */ } await new Promise((r) => setTimeout(r, 2000)); } throw new Error(`${p} could not be read from the site`); };

  const registry = rd('data/news-outlets.json');
  if (!registry) throw new Error('data/news-outlets.json is missing');
  const board = await getJson('matches.json');
  const index = await getJson('player-index.json');
  const countryOf = new Map(((index && index.players) || []).map((p) => [String(p.key), p.country]));
  const all = activeTournaments(board, nowIso), active = all.filter((t) => t.active || flag('force'));
  const run = { at: nowIso, activeTournaments: active.map((t) => t.name), tournaments: [], newItems: 0, tokens: { input: 0, output: 0 } };
  let modelError = null, translatedOk = false;
  for (const t of active) {
    const countries = [...new Set(t.cards.flatMap((m) => [countryOf.get(String(m.p1Key)), countryOf.get(String(m.p2Key))]).filter(Boolean))];
    const site = siteConfig(registry, t, countries);
    if (!site) { run.tournaments.push({ name: t.name, key: t.key, sources: 0, note: 'no allowed source in the registry for this tournament' }); continue; }
    const first = Math.min(...t.cards.map((m) => Date.parse(m.date + 'T00:00:00Z')).filter(Number.isFinite));
    const main = t.cards.filter((m) => m.finalScore && m.finalScore.winner);
    const got = await collectQuotes({ tournament: t.name, main, since: first - 3 * 86400000, site });
    const file = `news-quotes/${t.key}-${t.season}.json`, held = rd(file);
    const res = await processTournament({ t, got, known: (held && held.items) || [] });
    if (res.counts.modelError) modelError = res.counts.modelError;
    if (res.items.some((x) => x.translated)) translatedOk = true;
    const merged = mergeItems(held && held.items, res.items, nowIso);
    if (merged.added || merged.revised || !held) wr(file, { tournament: t.name, tournamentKey: t.key, season: t.season, updatedAt: nowIso, items: merged.items });
    run.newItems += merged.added; run.tokens.input += res.counts.tokens.input; run.tokens.output += res.counts.tokens.output;
    const finished = main.filter((m) => !m.walkover), quoted = new Set(merged.items.filter((x) => x.won && x.eventKey).map((x) => x.eventKey));
    run.tournaments.push({ name: t.name, key: t.key, sources: got.sources.map((s) => ({ name: s.name, articles: s.articles, candidates: s.candidates, robotsStatus: s.robotsStatus, skippedByRobots: s.skippedByRobots, unnamed: s.unnamedSpeakerParagraphs })),
      counts: res.counts, added: merged.added, held: merged.items.length, finishedMatches: finished.length, matchesWithWinnerQuote: finished.filter((m) => quoted.has(String(m.id).split('-').slice(1).join('-'))).length });
  }
  const { state, alerts } = dueAlerts(rd('news-quotes/state.json') || {}, { nowIso, anyActive: all.some((t) => t.active), itemsHeldOrNew: { newItems: run.newItems, translatedOk }, modelError });
  for (const text of alerts) { const r = await sendTelegram(text); console.log(`alert: ${r.ok ? 'sent' : 'NOT sent (' + r.why + ')'} — ${text}`); if (!r.ok) console.log('::error title=News ticker alert not sent::' + text); }
  run.alerts = alerts;
  if (JSON.stringify(state) !== JSON.stringify(rd('news-quotes/state.json') || {})) wr('news-quotes/state.json', state);
  const log = rd('news-quotes/run-log.json') || { runs: [] };
  if (active.length) { log.runs.push(run); log.runs = log.runs.slice(-400); wr('news-quotes/run-log.json', log); }
  console.log(JSON.stringify(run, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error('quote collector: ' + (e && e.stack || e)); process.exit(1); });
