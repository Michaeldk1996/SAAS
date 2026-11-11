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
 *        [--no-quotes] [--hold-quotes  run and verify the quotes but leave their text out of the file]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { reportText, statusItems, h2hAfter, verbatimIn, resolvePlayer, winnerScore, roundWords } from './news-core.mjs';

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
  const counts = { tournament, mainDrawCompleted: main.length, walkovers: 0, played: 0, withBoxScore: 0, withWinnersUE: 0,
    withBreakPointCounts: 0, withH2H: 0, reports: 0, status: 0, quotes: 0 };

  // ---- reports -------------------------------------------------------------------------------------------------
  for (const m of main) {
    if (m.walkover) { counts.walkovers++; continue; }
    counts.played++;
    const w = m.finalScore.winner, l = w === 'p1' ? 'p2' : 'p1';
    const ms = m.matchStats || {};
    const hasBox = !!(ms.p1 && ms.p2 && Object.keys(ms.p1).length > 3);
    if (hasBox) counts.withBoxScore++;
    const [sa, sb] = [await shard(m[w + 'Key']), await shard(m[l + 'Key'])];
    const h2h = h2hAfter(H2HCore, m, w, l, sa, sb, names, ek(m));
    if (h2h) counts.withH2H++;
    const rep = reportText(m, w, l, h2h);
    if (rep.used.wue) counts.withWinnersUE++;
    if (rep.used.bp) counts.withBreakPointCounts++;
    items.push({
      id: `report-${ek(m)}`, type: 'report', playerId: String(m[w + 'Key']), opponentId: String(m[l + 'Key']),
      player: m[w], opponent: m[l], tournament, round: roundWords(m.tournamentRound), timestamp: startIso(m),
      timestampKind: 'scheduled start (no store holds the match end time)', category: 'Statistics',
      text: rep.text, fields: rep.fields, sourceName: 'Stennisfy match data (api-tennis box score)',
      sourceUrl: `${BASE}/#match=${ek(m)}`, language: 'en', translated: false,
    });
    counts.reports++;
  }

  // ---- status --------------------------------------------------------------------------------------------------
  for (const s of statusItems(cards, { ek, startIso, tournament, base: BASE })) { items.push(s); counts.status++; }

  // ---- quotes --------------------------------------------------------------------------------------------------
  const quoteRun = { sources: [], candidates: 0, published: 0, droppedNotVerbatim: 0, droppedNoPlayer: 0, droppedAmbiguous: 0, held: [] };
  const HOLD = flag('hold-quotes'), winnersQuoted = { won: new Set(), lost: new Set() };
  if (!flag('no-quotes')) {
    const { collectQuotes } = await import('./quote-sources.mjs');
    const entrants = new Map();
    cards.forEach((m) => { if (m.p1Key != null) entrants.set(String(m.p1Key), m.p1); if (m.p2Key != null) entrants.set(String(m.p2Key), m.p2); });
    const got = await collectQuotes({ tournament, cards, main });
    quoteRun.sources = got.sources;
    for (const q of got.candidates) {
      quoteRun.candidates++;
      if (!(q.spans || [q.text]).every((sp) => verbatimIn(sp, q.sourceText))) { quoteRun.droppedNotVerbatim++; continue; }
      const who = resolvePlayer(q.speaker, entrants);
      if (who.status !== 'one') { quoteRun[who.status === 'several' ? 'droppedAmbiguous' : 'droppedNoPlayer']++; continue; }
      const opp = q.opponent ? resolvePlayer(q.opponent, entrants) : null;
      if (q.matchId) winnersQuoted[q.won ? 'won' : 'lost'].add(q.matchId);
      if (HOLD) { quoteRun.held.push({ id: `quote-${q.id}`, playerId: who.key, context: q.context || null, characters: q.text.length, sourceUrl: q.sourceUrl, verbatimCheck: 'passed' }); quoteRun.published++; continue; }
      items.push({
        id: `quote-${q.id}`, type: 'quote', playerId: who.key, opponentId: opp && opp.status === 'one' ? opp.key : null,
        player: entrants.get(who.key), opponent: opp && opp.status === 'one' ? entrants.get(opp.key) : null,
        tournament, round: q.round || null, timestamp: q.timestamp, timestampKind: q.timestampKind, category: q.category || 'Quotes',
        context: q.context || null, text: q.text, sourceName: q.sourceName, sourceUrl: q.sourceUrl,
        language: q.language || 'en', translated: false, verbatimCheck: 'passed',
      });
      quoteRun.published++; counts.quotes++;
    }
  }

  quoteRun.textHeld = HOLD;
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
