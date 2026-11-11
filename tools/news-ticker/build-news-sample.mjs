#!/usr/bin/env node
/**
 * News ticker — feasibility SAMPLE builder (founder brief 2026-11-11). Writes news-sample.json: real items for one
 * current ATP tournament, three types.
 *
 *   report  template fill from stores we already publish (matches.json card: score, box score; career-history: H2H).
 *           Every number is a stored field. A missing stat is left OUT of the sentence — never 0, never a guess.
 *           No duration (no store holds a match end time), no rating, no commentary.
 *   status  walkover / retirement = the card's own api-tennis flags; qualifier / lucky loser = derived from the board's
 *           qualifying-final results (basis stated on the item). Nothing from an outside source.
 *   quote   verbatim only. A quote is published only when its exact text is found again in the fetched source text
 *           (verbatimIn); a failing item is dropped and counted, never repaired. See quote-sources.mjs.
 *
 * It is a sample: no pipeline step runs it, no page reads it. Inputs come from the deployed site (default) so it runs
 * in a clone with the gitignored stores absent.
 *
 * Usage: node tools/news-ticker/build-news-sample.mjs [--tournament Stockholm] [--base <site url>] [--out news-sample.json]
 *        [--no-quotes]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { reportText, statusItems, h2hAfter, verbatimIn, resolvePlayer, roundWords, breakPoints } from './news-core.mjs';
import { pbpFacts, scoreFacts } from './pbp-facts.mjs';
import { translateQuote } from './translate.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes('--' + k);

const BASE = arg('base', 'https://michaeldk1996.github.io/SAAS').replace(/\/$/, '');
const TOUR = arg('tournament', 'Stockholm');
const OUT = arg('out', path.join(ROOT, 'news-sample.json'));

const getJson = async (p) => {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`${BASE}/${p}`, { signal: AbortSignal.timeout(60000) });
      if (r.status === 404) return null;
      if (r.ok) return await r.json();
      last = new Error(`${p}: HTTP ${r.status}`);
    } catch (e) { last = new Error(`${p}: ${e && (e.cause && e.cause.code || e.message)}`); }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw last;
};

async function main() {
  const { berlinWallMs } = require(path.join(ROOT, 'berlin-time.js'));
  const H2HCore = require(path.join(ROOT, 'h2h-core.js'));
  const board = await getJson('matches.json');
  if (!board) throw new Error('matches.json could not be read from ' + BASE);
  const index = await getJson('player-index.json');
  const names = ((index && index.players) || []).map((p) => p && p.name).filter(Boolean);
  const cards = Object.values(board).filter((m) => m && new RegExp(`\\b${TOUR}\\b`, 'i').test(m.tour || ''));
  if (!cards.length) throw new Error(`no ${TOUR} card on the board`);
  const done = cards.filter((m) => m.finalScore && m.finalScore.winner);
  const main = done.filter((m) => !m.qualifying);
  const ek = (m) => String(m.id).split('-').slice(1).join('-');
  const startIso = (m) => { const t = berlinWallMs(m.date, m.time); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
  const tournament = TOUR;
  const tournamentKey = cards[0].tournamentKey != null ? String(cards[0].tournamentKey) : null;

  const shards = {};
  const shard = async (k) => { const s = String(k); if (!(s in shards)) shards[s] = await getJson(`career-history/${s}.json`); return shards[s]; };

  const items = [];
  // Round names = the tournament page's own (tournament-progression.json: R1, R2 … QF, SF, F for this draw)
  const prog = await getJson('tournament-progression.json');
  const progT = prog && (Array.isArray(prog.tournaments) ? prog.tournaments : Object.values(prog.tournaments || {})).find((t) => new RegExp(`\\b${TOUR}\\b`, 'i').test(t.feedName || ''));
  const PAGE_ROUND = { R1: 'first round', R2: 'second round', R3: 'third round', R4: 'fourth round', QF: 'quarter-finals', SF: 'semi-finals', F: 'final' };
  const pageRound = (m, side) => {
    const p = progT && (progT.players || []).find((x) => String(x.playerKey) === String(m[side + 'Key']));
    const o = side === 'p1' ? 'p2' : 'p1';
    const r = p && (p.rounds || []).filter((x) => x.opponent === m[o]);
    return r && r.length === 1 && PAGE_ROUND[r[0].round] ? { code: r[0].round, words: PAGE_ROUND[r[0].round] } : null;
  };
  const counts = { tournament, mainDrawCompleted: main.length, walkovers: 0, played: 0, withBoxScore: 0, withWinnersUE: 0, withPointByPoint: 0,
    pbpFactsUsable: 0, roundFromTournamentPage: 0, withH2H: 0, withDuration: 0, reports: 0, status: 0, quotes: 0, commentary: 0,
    breakPoints: { sides: 0, fromBoxScore: 0, fromPointByPoint: 0, none: 0, bothSources: 0, mismatches: 0, mismatchList: [] },
    facts: { fromSetDown: 0, tiebreakSets: 0, brokenForSetOrMatch: 0, brokenFrom400: 0, openingGameSaves: 0, longestRunPrinted: 0 } };

  // ---- reports -------------------------------------------------------------------------------------------------
  for (const m of main) {
    if (m.walkover) { counts.walkovers++; continue; }
    counts.played++;
    const w = m.finalScore.winner, l = w === 'p1' ? 'p2' : 'p1';
    const ms = m.matchStats || {};
    if (ms.p1 && ms.p2 && Object.keys(ms.p1).length > 3) counts.withBoxScore++;
    const shardPbp = await getJson(`pbp/${ek(m)}.json`);
    if (shardPbp) counts.withPointByPoint++;
    const pbp = shardPbp ? pbpFacts(shardPbp, m.finalScore, 3) : null;
    if (pbp) counts.pbpFactsUsable++;
    for (const k of ['p1', 'p2']) {
      const B = counts.breakPoints; B.sides++;
      const box = ms[k] && ms[k].raw && ms[k].raw['Service:Break Points Saved'], pp = pbp && pbp.bp[k];
      const used = breakPoints(ms, k, pbp);
      if (!used) B.none++; else if (used.source === 'box score') B.fromBoxScore++; else B.fromPointByPoint++;
      if (box && box.total > 0 && pp) { B.bothSources++; if (box.total !== pp.faced || box.won !== pp.saved) { B.mismatches++; B.mismatchList.push(`${m[k]} (${m.p1} v ${m.p2}): box score ${box.won}/${box.total}, point-by-point ${pp.saved}/${pp.faced}`); } }
    }
    const [sa, sb] = [await shard(m[w + 'Key']), await shard(m[l + 'Key'])];
    const h2h = h2hAfter(H2HCore, m, w, l, sa, sb, names, ek(m));
    if (h2h) counts.withH2H++;
    const pr = pageRound(m, w) || pageRound(m, l);
    if (pr) counts.roundFromTournamentPage++;
    const rep = reportText(m, w, l, { h2h, pbp, score: scoreFacts(m.finalScore, w), round: pr ? pr.words : roundWords(m.tournamentRound), duration: null });
    if (rep.used.wue) counts.withWinnersUE++;
    const f = rep.fields.facts || {};
    if (f.fromSetDown) counts.facts.fromSetDown++;
    if (f.tiebreakSets) counts.facts.tiebreakSets += f.tiebreakSets.length;
    if (f.brokenForSet || f.brokenForMatch) counts.facts.brokenForSetOrMatch++;
    if (f.brokenFrom400) counts.facts.brokenFrom400++;
    if (f.openingGame) counts.facts.openingGameSaves++;
    if (f.longestRun) counts.facts.longestRunPrinted++;
    items.push({
      id: `report-${ek(m)}`, type: 'report', playerId: String(m[w + 'Key']), opponentId: String(m[l + 'Key']),
      player: m[w], opponent: m[l], tournament, round: rep.fields.round, timestamp: startIso(m),
      timestampKind: 'scheduled', category: 'Statistics',
      text: rep.text, fields: rep.fields, sourceName: 'Stennisfy match data (api-tennis box score and point-by-point)',
      sourceUrl: `${BASE}/pbp/${ek(m)}.json`, language: 'en', translated: false,
    });
    counts.reports++;
  }

  // ---- status --------------------------------------------------------------------------------------------------
  for (const s of statusItems(cards, { ek, startIso, tournament, base: BASE })) { items.push(s); counts.status++; }

  // ---- quotes --------------------------------------------------------------------------------------------------
  const quoteRun = { sources: [], candidates: 0, published: 0, droppedNotVerbatim: 0, droppedNoPlayer: 0, droppedAmbiguous: 0, notTranslatedNoKey: 0, notTranslatedApiError: 0, droppedTranslationCheck: 0, translationFailures: [], droppedEnglishExists: 0, bySourceLanguage: {} };
  const winnersQuoted = { won: new Set(), lost: new Set() };
  if (!flag('no-quotes')) {
    const { collectQuotes } = await import('./quote-sources.mjs');
    const entrants = new Map();
    cards.forEach((m) => { if (m.p1Key != null) entrants.set(String(m.p1Key), m.p1); if (m.p2Key != null) entrants.set(String(m.p2Key), m.p2); });
    // the tournament window opens 3 days before the first card we hold (qualifying weekend, pre-event media day)
    const first = Math.min(...cards.map((m) => Date.parse(m.date + 'T00:00:00Z')).filter(Number.isFinite));
    const got = await collectQuotes({ tournament, cards, main, since: first - 3 * 86400000 });
    quoteRun.sources = got.sources;
    const pending = [];
    for (const q of got.candidates) {
      quoteRun.candidates++;
      if (!(q.spans || [q.text]).every((sp) => verbatimIn(sp, q.sourceText))) { quoteRun.droppedNotVerbatim++; continue; }   // on the ORIGINAL-language text
      const who = resolvePlayer(q.speaker, entrants);
      if (who.status !== 'one') { quoteRun[who.status === 'several' ? 'droppedAmbiguous' : 'droppedNoPlayer']++; continue; }
      const opp = q.opponent ? resolvePlayer(q.opponent, entrants) : null;
      pending.push({ q, who, opp });
    }
    // English first; a translated quote that says the same as an English one by the same player is dropped (the English wins)
    const words = (t) => new Set(String(t).toLowerCase().match(/[a-z']{3,}/g) || []);
    const overlap = (a, b) => { const A = words(a), B = words(b); let n = 0; A.forEach((w) => { if (B.has(w)) n++; }); return A.size && B.size ? n / Math.min(A.size, B.size) : 0; };
    const english = [];
    for (const { q, who, opp } of pending.sort((x, y) => (x.q.language === 'en' ? 0 : 1) - (y.q.language === 'en' ? 0 : 1))) {
      let text = q.text, original = null, translated = false, model = null;
      if (q.language !== 'en') {
        const tr = await translateQuote(q.text, q.language);
        if (tr.status === 'no-key') { quoteRun.notTranslatedNoKey++; continue; }
        if (tr.status === 'api-error') { quoteRun.notTranslatedApiError++; quoteRun.translationFailures.push(`${q.speaker} (${q.sourceName}): ${String(tr.detail).slice(0, 160)}`); continue; }
        if (tr.status !== 'ok') { quoteRun.droppedTranslationCheck++; quoteRun.translationFailures.push(`${q.speaker} (${q.sourceName}): ${tr.detail || tr.status}`); continue; }
        if (english.some((e) => e.key === who.key && overlap(e.text, tr.text) >= 0.6)) { quoteRun.droppedEnglishExists++; continue; }
        original = q.text; text = tr.text; translated = true; model = tr.model;
      } else english.push({ key: who.key, text });
      if (q.matchId) winnersQuoted[q.won ? 'won' : 'lost'].add(q.matchId);
      const bySrc = (quoteRun.bySourceLanguage[`${q.sourceName} (${q.language})`] = quoteRun.bySourceLanguage[`${q.sourceName} (${q.language})`] || { quotes: 0, winnerMatches: [] });
      bySrc.quotes++; if (q.matchId && q.won && !bySrc.winnerMatches.includes(q.matchId)) bySrc.winnerMatches.push(q.matchId);
      items.push({
        id: `quote-${q.id}`, type: 'quote', playerId: who.key, opponentId: opp && opp.status === 'one' ? opp.key : null,
        player: entrants.get(who.key), opponent: opp && opp.status === 'one' ? entrants.get(opp.key) : null,
        tournament, round: null, timestamp: q.timestamp, timestampKind: q.timestampKind, category: 'Quotes',
        context: q.context || null, text, originalText: original, language: q.language, translated, translationModel: model,
        sourceName: q.sourceName, sourceUrl: q.sourceUrl, verbatimCheck: 'passed', verbatimCheckedOn: 'the original-language text of the fetched page',
      });
      quoteRun.published++; counts.quotes++;
    }
  }

  quoteRun.playedMatchesWithWinnerQuote = `${winnersQuoted.won.size} of ${counts.played}`;
  items.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')) || a.id.localeCompare(b.id));
  const out = { generatedAt: new Date().toISOString(), sample: true, note: 'Feasibility sample (news ticker). No page reads this file.',
    tournament, tournamentKey, dataFrom: BASE, counts, quoteRun, items };
  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 1) + '\n');
  fs.renameSync(tmp, OUT);
  console.log(JSON.stringify({ out: OUT, counts, quoteRun }, null, 1));
}

main().catch((e) => { console.error('news-sample: ' + (e && e.stack || e)); process.exit(1); });
