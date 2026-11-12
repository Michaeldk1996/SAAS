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
import { collectQuotes, addContext } from './quote-sources.mjs';
import { readOutlet, surnameOf, initialOf } from './outlet-reader.mjs';
import { translateQuote } from './translate.mjs';
import { mergeItems, dedupeQuotes, sameQuote, tourKeep } from './ticker-core.mjs';
import { sendTelegram } from '../price-alert-send.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes('--' + k);
export const SILENT_HOURS = 24;
export const RETRY_MAX = 6;   // re-reads of one article while the translation call is failing
export const MIN_GAP_MIN = 25;
export const tooSoon = (lastMs, nowIso) => Number.isFinite(lastMs) && Date.parse(nowIso) - lastMs >= 0 && Date.parse(nowIso) - lastMs < MIN_GAP_MIN * 60000;

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

// Registry -> the tournament's own site (ATP daily reports are read there; ATP itself stays on the permission route).
export function siteConfig(registry, t) {
  const ts = (registry.tournamentSites || []).find((x) => String(x.tournamentKey) === t.key && x.status === 'allowed' && x.enabled !== false);
  return ts ? { name: ts.name, ownName: ts.ownName, origin: ts.origin, list: ts.list, feed: ts.feed, article: new RegExp(ts.articlePattern, 'g'), hostCountry: ts.hostCountry, press: [] } : null;
}
// The outlets to read for a tournament: allowed and switched on, for the host country, the home countries of the
// players in the draw, and the international group.
export function outletsFor(registry, countries, hostCountry) {
  const want = new Set([...(countries || []), hostCountry, 'INT'].filter(Boolean).map(canonCountry));
  return (registry.outlets || []).filter((o) => o.status === 'allowed' && o.enabled !== false && (want.has(canonCountry(o.country)) || o.iso2 === 'INT'));
}
// Outlets switched off in the registry: their items are hidden on the next run (collector and feed build).
export const switchedOff = (registry) => new Set([...(registry.outlets || []), ...(registry.tournamentSites || []).flatMap((x) => [{ ...x, outlet: x.name }, { ...x, outlet: x.ownName }])].filter((o) => o.enabled === false).map((o) => o.outlet));

const quoteId = (playerId, originalText) => 'quote-' + crypto.createHash('sha1').update(String(playerId) + '|' + foldText(originalText).toLowerCase()).digest('hex').slice(0, 14);

// Tags (founder 2026-11-12): a quote about an injury is "Injuries"; one tied to a finished match stays "Quotes"; any
// other is "Interviews". Read on the published English text and the original-language text.
const INJURY = /\b(injur\w*|surgery|operat(?:ion|ed)|knee|wrist|shoulder|ankle|elbow|abdominal|muscle|torn|rehab\w*|pain|physio\w*|mri|fracture\w*|sprain\w*|strain\w*|skad\w*|lesi[oó]n\w*|lesionad\w*|bless(?:ure|é)\w*|infortun\w*|verletz\w*|les[aã]o|kontuzj\w*|zran\w*)\b/i;
export const quoteCategory = (item) => INJURY.test(`${item.text || ''} ${item.originalText || ''}`) ? 'Injuries' : (item.eventKey ? 'Quotes' : 'Interviews');
// The tour-wide field: every ranked ATP player down to TOUR_MAX_RANK (player-index.json = this week's standings).
export const TOUR_MAX_RANK = 200, TOUR_KEY = 'tour', TOUR_NAME = 'ATP Tour', TOUR_DAYS = 3;
export function tourPlayers(index) {
  return ((index && index.players) || []).filter((p) => p && p.key != null && p.name && Number.isFinite(+p.rank) && +p.rank >= 1 && +p.rank <= TOUR_MAX_RANK)
    .map((p) => {   // "I. Surname" from the standings' full name: the last word, with a particle before it kept ("A. De Minaur").
      // A double surname the press writes in full ("Carreno Busta") is then missed, never misattributed; a player on a
      // tournament board is matched on his card's own name instead.
      const w = String(p.name).trim().split(/\s+/);
      const sur = w.length > 2 && /^(de|del|della|di|da|van|von|der|la|le|mc|st)$/i.test(w[w.length - 2]) ? w.slice(-2).join(' ') : w[w.length - 1];
      return { key: String(p.key), name: w.length > 1 ? `${w[0][0]}. ${sur}` : p.name };
    });
}
// Where a tour-wide candidate belongs: a tournament whose field holds the speaker AND whose name the article mentions
// (published inside that edition), else the tour-wide file (published in the last TOUR_DAYS days), else nowhere.
export function routeCandidate(c, tournaments, tourKeys, nowIso) {
  const ts = Date.parse(c.timestamp);
  for (const t of tournaments) if (t.fieldKeys.has(String(c.speakerKey)) && (c.mentions || []).includes(t.folded) && !(Number.isFinite(ts) && ts < t.since)) return t.key;
  if (tourKeys.has(String(c.speakerKey)) && /^observed/.test(String(c.timestampKind || '')) && !(Number.isFinite(ts) && ts < Date.parse(nowIso) - TOUR_DAYS * 86400000)) return TOUR_KEY;
  return null;
}

// One tournament: candidates -> checked, translated, de-duplicated items. translate is injectable for the tests.
export async function processTournament({ t, got, translate = translateQuote, known = [] }) {
  const entrants = new Map();
  t.cards.forEach((m) => { if (m.p1Key != null) entrants.set(String(m.p1Key), m.p1); if (m.p2Key != null) entrants.set(String(m.p2Key), m.p2); });
  const c = { candidates: 0, droppedNotVerbatim: 0, droppedNoPlayer: 0, droppedAmbiguous: 0, notTranslatedNoKey: 0, notTranslatedApiError: 0,
    droppedTranslationCheck: 0, droppedEnglishExists: 0, mergedSameQuote: 0, alreadyHeld: 0, items: 0, tokens: { input: 0, output: 0 }, modelError: null, retryUrls: [] };
  const ok = [];
  for (const q of got.candidates) {
    c.candidates++;
    if (!(q.spans || [q.text]).every((sp) => verbatimIn(sp, q.sourceText))) { c.droppedNotVerbatim++; continue; }
    const who = q.speakerKey && entrants.has(String(q.speakerKey)) ? { status: 'one', key: String(q.speakerKey) } : resolvePlayer(q.speaker, entrants);
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
        if (tr.status === 'no-key') { c.notTranslatedNoKey++; c.retryUrls.push(q.sourceUrl); continue; }
        if (tr.status === 'api-error') { c.notTranslatedApiError++; c.retryUrls.push(q.sourceUrl); c.modelError = c.modelError || { http: tr.http || null, detail: String(tr.detail || '').slice(0, 200) }; continue; }
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
  deduped.forEach((x) => { x.category = quoteCategory(x); });
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
  // Polite rate (ruling limit c): never two collections inside 25 minutes, whatever started this run.
  const lastRun = Date.parse(((rd('news-quotes/state.json') || {}).lastRunAt) || '');
  if (!flag('force') && tooSoon(lastRun, nowIso)) { console.log(`quote collector: skipped — the last collection was ${Math.round((Date.parse(nowIso) - lastRun) / 60000)} min ago (minimum ${MIN_GAP_MIN})`); return; }
  const board = await getJson('matches.json');
  const index = await getJson('player-index.json');
  const countryOf = new Map(((index && index.players) || []).map((p) => [String(p.key), p.country]));
  const all = activeTournaments(board, nowIso), active = all.filter((t) => t.active || flag('force'));
  const run = { at: nowIso, activeTournaments: active.map((t) => t.name), tournaments: [], newItems: 0, tokens: { input: 0, output: 0 } };
  let modelError = null, translatedOk = false;
  // article pages are fetched once: the URLs already read (kept 45 days)
  const fetched = rd('news-quotes/fetched.json') || {}, sectionMemo = new Map(), fetchedBefore = JSON.stringify(fetched);
  // ---- one pass over every allowed outlet, for every tournament field and the tour-wide field ----
  const foldName = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const tour = tourPlayers(index), tourKeys = new Set(tour.map((p) => p.key));
  const mk = (pairs) => [...new Map(pairs).entries()].map(([key, name]) => ({ key, name, surname: surnameOf(name), initial: initialOf(name) })).filter((p) => p.surname.length >= 3);
  const prep = active.map((t) => {
    const first = Math.min(...t.cards.map((m) => Date.parse(m.date + 'T00:00:00Z')).filter(Number.isFinite));
    return { t, key: t.key, folded: foldName(t.name), since: first - 3 * 86400000, fieldKeys: new Set(t.cards.flatMap((m) => [String(m.p1Key), String(m.p2Key)])),
      main: t.cards.filter((m) => m.finalScore && m.finalScore.winner), site: siteConfig(registry, t), extra: [] };
  });
  const everyone = mk([...tour.map((p) => [p.key, p.name]), ...active.flatMap((t) => t.cards.flatMap((m) => [[String(m.p1Key), m.p1], [String(m.p2Key), m.p2]]))]);
  const outlets = (registry.outlets || []).filter((o) => o.status === 'allowed' && o.enabled !== false);
  const tourCandidates = [], outletStats = [];
  let oi = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (oi < outlets.length) {
      const o = outlets[oi++];
      const r = await readOutlet({ outlet: o, players: everyone, tournamentNames: prep.map((x) => x.t.name), cache: fetched, nowIso, since: Date.parse(nowIso) - 21 * 86400000, sectionMemo });
      for (const c of r.candidates) {
        c.speaker = (everyone.find((p) => p.key === c.speakerKey) || {}).name;
        const to = routeCandidate(c, prep, tourKeys, nowIso), hit = prep.find((x) => x.key === to);
        if (hit) { addContext(c, hit.main); hit.extra.push(c); } else if (to === TOUR_KEY) tourCandidates.push(c);
      }
      outletStats.push(r.stats);
    }
  }));
  const off = switchedOff(registry);
  run.outlets = { read: outletStats.length, withCandidates: outletStats.filter((x) => x.candidates).length, blocked: outletStats.filter((x) => x.blocked).map((x) => `${x.outlet}: ${x.blocked}`), articlesFetched: outletStats.reduce((n, x) => n + x.fetched, 0), paywalled: outletStats.reduce((n, x) => n + x.paywalled, 0), unnamed: outletStats.reduce((n, x) => n + x.unnamed, 0), byOutlet: outletStats.filter((x) => x.candidates || x.fetched).map((x) => ({ outlet: x.outlet, country: x.country, language: x.language, fetched: x.fetched, candidates: x.candidates })) };
  const season = nowIso.slice(0, 4);
  const jobs = prep.map((x) => ({ t: x.t, main: x.main, site: x.site, extra: x.extra }));
  jobs.push({ t: { key: TOUR_KEY, season, name: TOUR_NAME, cards: tour.map((p) => ({ p1Key: p.key, p1: p.name })) }, main: [], site: null, extra: tourCandidates });
  for (const { t, main, site, extra } of jobs) {
    const got = site ? await collectQuotes({ tournament: t.name, main, since: prep.find((x) => x.t === t).since, site }) : { sources: [], candidates: [] };
    got.candidates.push(...extra);
    const file = `news-quotes/${t.key}-${t.season}.json`, held = rd(file);
    const heldItems = ((held && held.items) || []).filter((x) => !off.has(x.sourceName));
    const res = await processTournament({ t, got, known: heldItems });
    if (res.counts.modelError) modelError = res.counts.modelError;
    // a quote the model could not translate is not lost: its article is read again on a later run (at most RETRY_MAX times)
    for (const u of new Set(res.counts.retryUrls)) { const e = fetched[u]; if (e) { e.tries = (e.tries || 0) + 1; if (e.tries <= RETRY_MAX) e.retranslate = true; } }
    res.counts.retryUrls = res.counts.retryUrls.length;
    if (res.items.some((x) => x.translated)) translatedOk = true;
    // tour-wide: dated articles only, at most two quotes a player per article (ticker-core tourKeep), counted over what is held too
    const tourWide = t.key === TOUR_KEY, baseItems = tourWide ? tourKeep(heldItems) : heldItems;
    const keepIds = tourWide ? new Set(tourKeep([...baseItems, ...res.items.filter((r) => !baseItems.some((h) => h.id === r.id))]).map((x) => x.id)) : null;
    const merged = mergeItems(baseItems, tourWide ? res.items.filter((r) => keepIds.has(r.id)) : res.items, nowIso);
    if (merged.added || merged.revised || (tourWide && merged.items.length !== heldItems.length) || (held && heldItems.length !== (held.items || []).length) || (!held && merged.items.length)) wr(file, { tournament: t.name, tournamentKey: t.key, season: t.season, updatedAt: nowIso, items: merged.items });
    run.newItems += merged.added; run.tokens.input += res.counts.tokens.input; run.tokens.output += res.counts.tokens.output;
    const finished = main.filter((m) => !m.walkover), quoted = new Set(merged.items.filter((x) => x.won && x.eventKey).map((x) => x.eventKey));
    run.tournaments.push({ name: t.name, key: t.key, sources: got.sources.map((s) => ({ name: s.name, articles: s.articles, candidates: s.candidates, robotsStatus: s.robotsStatus, skippedByRobots: s.skippedByRobots, unnamed: s.unnamedSpeakerParagraphs })),
      fromOutlets: extra.length, counts: res.counts, added: merged.added, held: merged.items.length, byCategory: merged.items.reduce((a, x) => (a[x.category] = (a[x.category] || 0) + 1, a), {}),
      finishedMatches: finished.length, matchesWithWinnerQuote: finished.filter((m) => quoted.has(String(m.id).split('-').slice(1).join('-'))).length });
  }
  for (const [u, v] of Object.entries(fetched)) if (Date.parse(nowIso) - Date.parse(v.at) > 45 * 86400000) delete fetched[u];
  if (JSON.stringify(fetched) !== fetchedBefore) wr('news-quotes/fetched.json', fetched);
  const { state, alerts } = dueAlerts(rd('news-quotes/state.json') || {}, { nowIso, anyActive: all.some((t) => t.active), itemsHeldOrNew: { newItems: run.newItems, translatedOk }, modelError });
  for (const text of alerts) { const r = await sendTelegram(text); console.log(`alert: ${r.ok ? 'sent' : 'NOT sent (' + r.why + ')'} — ${text}`); if (!r.ok) console.log('::error title=News ticker alert not sent::' + text); }
  run.alerts = alerts;
  state.lastRunAt = nowIso;   // the tour-wide pass reads outlets on every run
  if (JSON.stringify(state) !== JSON.stringify(rd('news-quotes/state.json') || {})) wr('news-quotes/state.json', state);
  const log = rd('news-quotes/run-log.json') || { runs: [] };
  { log.runs.push(run); log.runs = log.runs.slice(-400); wr('news-quotes/run-log.json', log); }
  console.log(JSON.stringify(run, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error('quote collector: ' + (e && e.stack || e)); process.exit(1); });
