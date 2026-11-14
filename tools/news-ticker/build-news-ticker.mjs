#!/usr/bin/env node
/**
 * News ticker — the live feed, built inside every pipeline run from the files that run has just written.
 *
 *   in   matches.json (the board: every ATP singles card, main draw and qualifying), pbp/<ek>.json,
 *        career-history/<key>.json, tournament-progression.json, player-index.json — all local, this run's;
 *        live_match_end + live_flip_log_current (Supabase, read-only) for the observed start and end;
 *        news-quotes/<key>-<season>.json (written by the quote collector on its own schedule).
 *   out  news-ticker/<tournamentKey>-<season>.json (permanent, one per tournament edition) + news-ticker.json (index).
 *
 * A file is rewritten only when one of its items was added or its source data changed (ticker-core.mjs). The report
 * text is the fixed template (news-core.mjs); nothing here words anything.
 *
 * Usage: node tools/news-ticker/build-news-ticker.mjs [--dir .] [--now ISO] [--no-times]
 * Exit 0 always writes what it could; exit 1 only when the board itself cannot be read.
 */
import { humaniseReport, VOICE_VERSION, plainNames } from './humanise.mjs';
import { baselineFor } from './standouts.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { reportText, statusItems, h2hAfter, roundWords, breakPoints, mtoSentences, ratingLines } from './news-core.mjs';
import { shotSentences } from './match-cards.mjs';
import { pbpFacts, scoreFacts } from './pbp-facts.mjs';
import { mergeItems, buildIndex, fileOf, observedTimes, tourKeep } from './ticker-core.mjs';
import { factSheet, composeReport, assemble, pathLines, physicalParagraph, matchQuotes, roundCode, COMPOSE_VERSION, MAX_COMPOSE_RUNS, COMPOSE_FRESH_HOURS } from './compose.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes('--' + k);
const DIR = path.resolve(arg('dir', '.'));
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, p), 'utf8')); } catch (e) { return null; } };
const writeAtomic = (p, obj) => { const f = path.join(DIR, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(obj, null, 1) + '\n'); fs.renameSync(f + '.tmp', f); };

const PAGE_ROUND = { R1: 'first round', R2: 'second round', R3: 'third round', R4: 'fourth round', QF: 'quarter-finals', SF: 'semi-finals', F: 'final' };
const ek = (m) => String(m.id).split('-').slice(1).join('-');
export const tournamentName = (m) => String(m.tour || '').replace(/^ATP\s+/i, '').trim();

async function supabaseRows(table, select, keys) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || !keys.length) return null;
  const out = [];
  for (let i = 0; i < keys.length; i += 80) {
    const q = `${url.replace(/\/$/, '')}/rest/v1/${table}?select=${select}&event_key=in.(${keys.slice(i, i + 80).map((k) => `"${k}"`).join(',')})`;
    // three tries: a slow database must not cost a report its observed times (the read is small and idempotent)
    let rows = null, err = null;
    for (let t = 0; t < 3 && !rows; t++) {
      try {
        const r = await fetch(q, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(45000) });
        if (!r.ok) throw new Error(`${table}: HTTP ${r.status}`);
        rows = await r.json();
      } catch (e) { err = e; }
    }
    if (!rows) throw err;
    out.push(...rows);
  }
  return out;
}

export async function build({ nowIso, times, rewrite = null, writer = null, apiKey = process.env.ANTHROPIC_API_KEY }) {
  const composeOn = !!(writer || apiKey) && process.env.NEWS_REPORT_COMPOSE !== '0';
  const voiceOn = !!(rewrite || apiKey), VOICE_MAX_CALLS = Number(process.env.NEWS_REPORT_MAX_CALLS || 40);
  let voiceCalls = 0, composeCalls = 0;
  // a full report takes about 20 seconds to write: a run writes at most this many, and keeps 2 of them for matches that
  // have just finished (older reports on file are brought up to date over the next runs)
  const COMPOSE_MAX = Number(process.env.NEWS_COMPOSE_MAX_CALLS || 6);
  const { berlinWallMs } = require(path.join(ROOT, 'berlin-time.js'));
  const H2HCore = require(path.join(ROOT, 'h2h-core.js'));
  const board = readJson('matches.json');
  if (!board) throw new Error('matches.json could not be read');
  const cards = Object.values(board).filter((m) => m && m.tourBadge === 'ATP' && m.tournamentKey != null && m.p1Key != null && m.p2Key != null
    && !/\//.test(String(m.p1) + String(m.p2)));                       // singles only (a doubles pair is "A / B")
  const index = readJson('player-index.json');
  const ratings = readJson('surface-ratings.json');   // each player's own baseline (Database → Ratings store); absent = no comparison
  const names = ((index && index.players) || []).map((p) => p && p.name).filter(Boolean);
  // every ranked player's surname words: a report may name only the players on its own fact sheet (compose.mjs)
  const surnames = new Set(names.flatMap((n) => String(n).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[\s-]+/).slice(1)).filter((x) => x.length >= 4));
  const styleRows = ((readJson('playing-styles.json') || {}).players) || [];
  const styleOf = (card) => { const r = styleRows.filter((p) => p && p.name === card && p.archetype_label); return r.length === 1 ? String(r[0].archetype_label).toLowerCase() : null; };
  const prog = readJson('tournament-progression.json');
  const progs = prog ? (Array.isArray(prog.tournaments) ? prog.tournaments : Object.values(prog.tournaments || {})) : [];
  const startIso = (m) => { const t = berlinWallMs(m.date, m.time); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
  const shards = {};
  const shard = (k) => { const s = String(k); if (!(s in shards)) shards[s] = readJson(`career-history/${s}.json`); return shards[s]; };

  // group the board by tournament edition
  const groups = new Map();
  for (const m of cards) {
    const season = String(m.date || '').slice(0, 4); if (!/^\d{4}$/.test(season)) continue;
    const id = `${m.tournamentKey}|${season}`;
    if (!groups.has(id)) groups.set(id, { key: String(m.tournamentKey), season, name: tournamentName(m), cards: [] });
    groups.get(id).cards.push(m);
  }
  // A report already published keeps following the current rules while its match data is on file (founder 2026-11-13:
  // "Yes, rewrite them"): a finished main-draw match that left the board is rebuilt from the draw store's frozen copy
  // of its board row (draw-matches.json, 16 days). Only a match whose report is already in that tournament's file —
  // the store never adds a report, a status item or a tournament.
  const onBoard = new Set(cards.map(ek));
  for (const r of Object.values((readJson('draw-matches.json') || {}).matches || {})) {
    const m = r && r.match;
    if (!m || m.tourBadge !== 'ATP' || m.tournamentKey == null || m.p1Key == null || m.p2Key == null || /\//.test(String(m.p1) + String(m.p2)) || !m.finalScore || !m.finalScore.winner || onBoard.has(ek(m))) continue;
    const season = String(m.date || '').slice(0, 4); if (!/^\d{4}$/.test(season)) continue;
    const id = `${m.tournamentKey}|${season}`, file = readJson(fileOf(String(m.tournamentKey), season));
    if (!file || !(file.items || []).some((x) => x.id === `report-${ek(m)}`)) continue;
    if (!groups.has(id)) groups.set(id, { key: String(m.tournamentKey), season, name: file.tournament || tournamentName(m), cards: [] });
    (groups.get(id).offBoard = groups.get(id).offBoard || []).push(m); onBoard.add(ek(m));
  }

  // an outlet switched off in the registry ("enabled": false) has its quotes hidden from this run on — the one case an item leaves the feed
  const reg = readJson('data/news-outlets.json') || {};
  const off = new Set([...(reg.outlets || []), ...(reg.tournamentSites || []).flatMap((x) => [{ ...x, outlet: x.name }, { ...x, outlet: x.ownName }])].filter((o) => o.enabled === false).map((o) => o.outlet));
  const hidden = (x) => x.type === 'quote' && off.has(x.sourceName);
  const summary = { voice: { rewritten: 0, reused: 0, notRewritten: 0, errors: 0, lastError: null, tokens: { input: 0, output: 0 }, reportsFullyInVoice: 0, reportsTotal: 0, sentencesPassed: 0, sentencesTotal: 0 }, tournaments: 0, finished: 0, reports: 0, reportErrors: [], status: 0, quotes: 0, added: 0, revised: 0, unchanged: 0, filesWritten: [], withObservedEnd: 0, withDuration: 0, hiddenByOffSwitch: 0 };
  const touched = [];
  const commentaryByMatch = ((readJson('news-quotes/commentary.json') || {}).byMatch) || {};   // what the TV commentators said (ttv-interviews.mjs)
  const walkoverReasons = ((readJson('news-quotes/match-cards.json') || {}).walkovers) || {};   // "W.O. (Left Calf)" on the official result post
  const cardsByMatch = ((readJson('news-quotes/match-cards.json') || {}).byMatch) || {};   // the broadcast's shot-level numbers (match-cards.mjs)
  const mtoByMatch = ((readJson('mto-matches.json') || {}).matches) || {};   // absent file = no timeout sentence (never a guess)
  for (const g of groups.values()) {
    const file = fileOf(g.key, g.season);
    const existing = readJson(file);
    const old = new Map(((existing && existing.items) || []).map((x) => [x.id, x]));
    const quoteItems = ((readJson(`news-quotes/${g.key}-${g.season}.json`) || {}).items) || [];
    const progT = progs.find((t) => new RegExp(`^${g.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i').test(t.feedName || ''));
    const pageRound = (m, side) => {
      const p = progT && (progT.players || []).find((x) => String(x.playerKey) === String(m[side + 'Key']));
      const o = side === 'p1' ? 'p2' : 'p1';
      const r = p && (p.rounds || []).filter((x) => x.opponent === m[o]);
      return r && r.length === 1 && PAGE_ROUND[r[0].round] ? PAGE_ROUND[r[0].round] : null;
    };
    // a card the draw page cannot place (a walkover has no row there) takes the page round of the other cards of its own feed round
    const feedRound = new Map();
    for (const c of g.cards.concat(g.offBoard || [])) { if (c.qualifying) continue; const pr = pageRound(c, 'p1') || pageRound(c, 'p2'); if (pr) feedRound.set(String(c.tournamentRound), pr); }
    const rwOf = (m) => (m.qualifying ? `${roundWords(m.tournamentRound) === 'final' ? 'final round' : roundWords(m.tournamentRound)} of qualifying` : (pageRound(m, m.finalScore && m.finalScore.winner ? m.finalScore.winner : 'p1') || pageRound(m, 'p2') || pageRound(m, 'p1') || feedRound.get(String(m.tournamentRound)) || roundWords(m.tournamentRound)));
    const allCards = g.cards.concat(g.offBoard || []);
    const fresh = [];
    const done = g.cards.filter((m) => m.finalScore && m.finalScore.winner).concat(g.offBoard || []);
    for (const m of done) {
      if (m.walkover) continue;
      summary.finished++;
      try {
        const w = m.finalScore.winner, l = w === 'p1' ? 'p2' : 'p1', id = `report-${ek(m)}`;
        const sp = readJson(`pbp/${ek(m)}.json`);
        const pbp = sp ? pbpFacts(sp, m.finalScore, 3) : null;
        const h2h = m.qualifying ? null : h2hAfter(H2HCore, m, w, l, shard(m[w + 'Key']), shard(m[l + 'Key']), names, ek(m));   // qualifying is not in the H2H population
        // observed times: this run's read, else what the stored item already holds (a failed read never downgrades it)
        const prev = old.get(id);
        const obs = (times && times.get(ek(m))) || (prev && prev.observed) || null;
        const stage = m.qualifying ? 'qualifying' : null;
        const rw = m.qualifying ? `${roundWords(m.tournamentRound) === 'final' ? 'final round' : roundWords(m.tournamentRound)} of qualifying` : (pageRound(m, w) || pageRound(m, l) || roundWords(m.tournamentRound));
        const baselines = { [w]: baselineFor(ratings, m[w + 'Key'], m.surface), [l]: baselineFor(ratings, m[l + 'Key'], m.surface) };
        const rep = reportText(m, w, l, { baselines, h2h, pbp, score: scoreFacts(m.finalScore, w), round: rw, duration: obs && obs.minutes != null ? obs.minutes : null });
        // Michael's voice: the template sentences rewritten one for one, each checked against its own facts; a sentence
        // that fails keeps the template wording. Done once per report: a stored rewrite of the same template is reused.
        // surnames only, also when the voice step did not run (founder 2026-11-13); the template keeps the card names
        let text = plainNames(rep.text, [{ card: m[w] }, { card: m[l] }]), voice = null;
        // the sentence-by-sentence voice step is the fallback of the full report below: it runs only for a report the
        // full writer did not produce (no call is spent on a text nobody reads)
        const voiceStep = async () => {
          if (prev && prev.voice && prev.voice.version === VOICE_VERSION && prev.templateText === rep.text) { text = prev.voiceText || prev.baseText || prev.text; voice = prev.voice; summary.voice.reused++; }
          else if (voiceOn && voiceCalls < VOICE_MAX_CALLS) {
            voiceCalls++;
            const h = await humaniseReport({ sentences: rep.sentences, tones: rep.tones, kinds: rep.kinds, winner: { card: m[w], full: null }, loser: { card: m[l], full: null } }, { rewrite, apiKey });
            if (h.usage) { summary.voice.tokens.input += h.usage.input; summary.voice.tokens.output += h.usage.output; }
            if (h.status === 'ok') { text = h.text; voice = h.voice; summary.voice.rewritten++; }
            else { summary.voice.errors++; summary.voice.lastError = `${h.status}${h.detail ? ': ' + h.detail : ''}`; }
          } else summary.voice.notRewritten++;
        };
        if (!composeOn) await voiceStep();
        // After the voice step, never rewritten by it (founder 2026-11-13): the card's serve and return numbers join the
        // main paragraph; then what was seen in the match, the physical paragraph, and one closing line per player.
        // Nothing here names a source, and nothing is from after the match.
        let baseText = null;
        const shot = shotSentences(m, w, l, cardsByMatch[ek(m)]);
        if (shot.length) summary.withShotStats = (summary.withShotStats || 0) + 1;
        const mto = mtoSentences(m, mtoByMatch[ek(m)], quoteItems, { winner: w, final: rw === 'final' });
        if (mto.length) summary.withMto = (summary.withMto || 0) + 1;
        const cm = commentaryByMatch[ek(m)];
        if (cm && cm.text) summary.withCommentary = (summary.withCommentary || 0) + 1;
        const rating = ratingLines(m, w, l, cardsByMatch[ek(m)]);
        if (rating.length) summary.withRatingLine = (summary.withRatingLine || 0) + 1;
        // The full report (founder 2026-11-14: "the goal is to make it automatic"): written from the fact sheet and
        // published only when every number, name and quotation in it is on that sheet (compose.mjs). Written once per
        // sheet; a sheet that failed is not tried again until its facts change. No key, a failed check or the call
        // cap = the report above (template + voice), exactly as before.
        let composed = null, phys = { sentences: [], facts: [] };
        if (composeOn) {
          // the same player's earlier matches here, in order, with their medical timeouts ("his second in two matches")
          const sk = (c) => `${c.date || ''} ${c.time || '99:99'}`, earlier = {};
          for (const k of [w, l]) earlier[k] = allCards.filter((c) => c.id !== m.id && [c.p1Key, c.p2Key].map(String).includes(String(m[k + 'Key'])) && sk(c) < sk(m) && c.finalScore && !c.walkover).sort((a, b) => sk(a).localeCompare(sk(b))).map((c) => ({ rows: mtoByMatch[ek(c)] || [] }));
          phys = physicalParagraph(m, mtoByMatch[ek(m)], { winner: w, final: rw === 'final', quotes: quoteItems, earlier, seen: cm && cm.text ? cm.text : null });
          const sheet = factSheet({ m, w, l, rep, shard: sp, round: rw, duration: obs && obs.minutes != null ? obs.minutes : null, card: cardsByMatch[ek(m)] || null,
            commentary: cm && cm.text ? cm.text : null, quotes: matchQuotes(m, ek(m), quoteItems, phys.sentences.join(' ')), physical: phys.facts,
            path: pathLines(m, w, allCards, (c) => roundCode(rwOf(c)), rw === 'final'), styles: { [w]: styleOf(m[w]), [l]: styleOf(m[l]) } });
          const pc = prev && prev.composed && prev.composed.version === COMPOSE_VERSION ? prev.composed : null;
          const ageH = (Date.parse(nowIso) - Date.parse(obs && obs.endedAt ? obs.endedAt : startIso(m))) / 3600000;
          const frozen = pc && (pc.sheetHash === sheet.hash || (pc.runs || 0) >= MAX_COMPOSE_RUNS || !(ageH <= COMPOSE_FRESH_HOURS));
          if (frozen) composed = pc;
          else if (composeCalls < (ageH <= COMPOSE_FRESH_HOURS ? COMPOSE_MAX : COMPOSE_MAX - 2)) {
            composeCalls++;
            const c = await composeReport(sheet, { writer, apiKey, surnames });
            if (c.usage) { summary.voice.tokens.input += c.usage.input; summary.voice.tokens.output += c.usage.output; }
            if (c.status === 'ok') { composed = { version: COMPOSE_VERSION, sheetHash: sheet.hash, status: 'ok', model: c.model, tries: c.tries, runs: ((pc && pc.runs) || 0) + 1, body: c.text }; summary.composed = (summary.composed || 0) + 1; }
            else if (c.status === 'failed-check') { composed = { version: COMPOSE_VERSION, sheetHash: sheet.hash, status: 'failed-check', tries: c.tries, runs: ((pc && pc.runs) || 0) + 1, failures: c.failures.slice(0, 8), ...(pc && pc.body ? { body: pc.body, status: 'ok', keptAfterFailedRewrite: true } : {}) }; summary.composeFailed = (summary.composeFailed || 0) + 1; summary.composeFailures = (summary.composeFailures || []).concat(`${ek(m)}: ${c.failures.slice(0, 3).join(' | ')}`).slice(0, 10); }
            else { composed = pc; summary.voice.errors++; summary.voice.lastError = `compose ${c.status}${c.detail ? ': ' + c.detail : ''}`; }
          } else composed = pc;
        }
        if (composed && composed.body) { baseText = composed.body; text = assemble(composed.body, phys.sentences, rating); summary.reportsComposed = (summary.reportsComposed || 0) + 1; }
        else {
          if (composeOn) await voiceStep();
          baseText = text;
          text = [[text, ...shot].join(' '), cm && cm.text ? cm.text : null, mto.length ? mto.join(' ') : null, ...rating].filter(Boolean).join('\n\n');
        }
        if (obs && obs.endedAt) summary.withObservedEnd++;
        if (rep.used.duration) summary.withDuration++;
        fresh.push({ id, type: 'report', playerId: String(m[w + 'Key']), opponentId: String(m[l + 'Key']), player: m[w], opponent: m[l],
          tournament: g.name, tournamentKey: g.key, season: g.season, stage: stage || 'main draw', round: rep.fields.round, eventKey: ek(m),
          timestamp: obs && obs.endedAt ? obs.endedAt : startIso(m), timestampKind: obs && obs.endedAt ? 'observed' : 'scheduled',
          observed: obs || null, category: 'Statistics', text, ...(text !== baseText ? { baseText } : {}), ...(rating.length ? { rating } : {}), ...(cardsByMatch[ek(m)] ? { shotStats: cardsByMatch[ek(m)] } : {}), ...(mto.length ? { mto } : {}), ...(cm && cm.text ? { commentary: { text: cm.text, sourceName: cm.sourceName, sourceUrl: cm.sourceUrl } } : {}), ...(voice ? { templateText: rep.text, voice, voiceText: composed && composed.body ? (prev && prev.voiceText) || null : baseText } : {}), ...(composed ? { composed } : {}), fields: rep.fields,
          sourceName: 'Stennisfy match data (api-tennis box score and point-by-point)', sourceUrl: `pbp/${ek(m)}.json`, language: 'en', translated: false });
        summary.reports++;
      } catch (e) { summary.reportErrors.push(`${m.id}: ${e && e.message}`); }
    }
    // a stored report whose match data is gone (off the board, not in the draw store) cannot be rebuilt: only its
    // names follow the surname rule; every fact and word stays as published
    { const built = new Set(fresh.map((x) => x.id));
      for (const x of (existing && existing.items) || []) {
        if (x.type !== 'report' || built.has(x.id) || !x.player || !x.opponent) continue;
        const t = plainNames(String(x.text), [{ card: x.player }, { card: x.opponent }]);
        if (t === x.text) continue;
        const { sourceHash, publishedAt, revisedAt, revision, ...rest } = x;
        fresh.push({ ...rest, text: t }); summary.namesOnly = (summary.namesOnly || 0) + 1;
      } }
    for (const s of statusItems(g.cards, { ek, startIso, tournament: g.name, base: '' })) {
      // a walkover's reason, when the official result post gave one (never guessed)
      const wr = /^status-wo-(.+)$/.exec(String(s.id)), why = wr && walkoverReasons[wr[1]];
      const st = why && why.reason ? { ...s, text: `${s.text} Reason given: ${String(why.reason).toLowerCase()}.`, reason: why.reason } : s;
      fresh.push({ ...st, tournamentKey: g.key, season: g.season, sourceUrl: 'matches.json' }); summary.status++;
    }
    const qf = readJson(`news-quotes/${g.key}-${g.season}.json`);
    for (const q of (qf && qf.items) || []) { if (hidden(q)) continue; fresh.push(q); summary.quotes++; }

    const kept = ((existing && existing.items) || []).filter((x) => !hidden(x)), dropped = ((existing && existing.items) || []).length - kept.length;
    summary.hiddenByOffSwitch += dropped;
    const merged = mergeItems(kept, fresh, nowIso);
    summary.added += merged.added; summary.revised += merged.revised; summary.unchanged += merged.unchanged; summary.tournaments++;
    touched.push({ key: g.key, season: g.season, name: g.name, items: merged.items });
    for (const x of merged.items) if (x.type === 'report') {
      summary.voice.reportsTotal++;
      if (x.voice) { summary.voice.sentencesPassed += x.voice.passed; summary.voice.sentencesTotal += x.voice.total; if (x.voice.passed === x.voice.total) summary.voice.reportsFullyInVoice++; }
    }
    if (merged.added || merged.revised || dropped || !existing) {
      writeAtomic(file, { tournament: g.name, tournamentKey: g.key, season: g.season, updatedAt: nowIso, items: merged.items });
      summary.filesWritten.push(file);
    }
  }

  // the tour-wide quotes (press interviews and injury quotes for every ranked ATP player, tied to no tournament field):
  // news-quotes/tour-<season>.json -> news-ticker/tour-<season>.json, same merge, same off switch
  for (const f of (fs.existsSync(path.join(DIR, 'news-quotes')) ? fs.readdirSync(path.join(DIR, 'news-quotes')) : []).filter((x) => /^tour-\d{4}\.json$/.test(x))) {
    const qf = readJson(`news-quotes/${f}`), season = f.slice(5, 9), file = fileOf('tour', season), existing = readJson(file);
    const fresh = tourKeep(((qf && qf.items) || []).filter((q) => !hidden(q)));
    // an item the tour rule no longer admits (undated article, more than 2 from one article) leaves the feed
    const kept = ((existing && existing.items) || []).filter((x) => !hidden(x) && fresh.some((f) => f.id === x.id)), dropped = ((existing && existing.items) || []).length - kept.length;
    if (!fresh.length && !kept.length) continue;
    summary.quotes += fresh.length; summary.hiddenByOffSwitch += dropped;
    const merged = mergeItems(kept, fresh, nowIso);
    summary.added += merged.added; summary.revised += merged.revised; summary.unchanged += merged.unchanged;
    touched.push({ key: 'tour', season, name: 'ATP Tour', items: merged.items });
    if (merged.added || merged.revised || dropped || !existing) { writeAtomic(file, { tournament: 'ATP Tour', tournamentKey: 'tour', season, updatedAt: nowIso, items: merged.items }); summary.filesWritten.push(file); }
  }

  // the index covers every tournament file on disk (older editions included), not only this run's board
  const dir = path.join(DIR, 'news-ticker');
  const all = new Map(touched.map((t) => [fileOf(t.key, t.season), t]));
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir).filter((x) => /^[A-Za-z0-9_-]+-\d{4}\.json$/.test(x))) {
    const rel = `news-ticker/${f}`; if (all.has(rel)) continue;
    const d = readJson(rel); if (d && Array.isArray(d.items)) all.set(rel, { key: d.tournamentKey, season: d.season, name: d.tournament, items: d.items });
  }
  const idx = buildIndex([...all.values()]);
  const prevIdx = readJson('news-ticker.json');
  if (JSON.stringify(prevIdx) !== JSON.stringify(idx)) { writeAtomic('news-ticker.json', idx); summary.filesWritten.push('news-ticker.json'); }
  return summary;
}

async function main() {
  const nowIso = arg('now', new Date().toISOString());
  let times = null, timesNote = 'not read';
  if (!flag('no-times')) {
    try {
      const board = readJson('matches.json') || {};
      const keys = Object.values(board).filter((m) => m && m.finalScore && m.finalScore.winner && m.tourBadge === 'ATP').map(ek);
      const [ends, flips] = [await supabaseRows('live_match_end', 'event_key,last_undecided_seen_at,decided_seen_at,event_status', keys),
        await supabaseRows('live_flip_log_current', 'event_key,first_live_seen_at,play_seen_at', keys)];
      if (ends && flips) {
        const fl = new Map(flips.map((x) => [String(x.event_key), x]));
        times = new Map();
        for (const e of ends) { const o = observedTimes(fl.get(String(e.event_key)), e); if (o) times.set(String(e.event_key), o); }
        timesNote = `${ends.length} end rows, ${flips.length} start rows, ${times.size} usable`;
      } else timesNote = 'no Supabase key in this run';
    } catch (e) { timesNote = `read failed (${e && e.message}) — stored times kept, new items use the scheduled start`; console.log(`::warning::news ticker: ${timesNote}`); }
  }
  const s = await build({ nowIso, times });
  console.log(`news ticker: ${s.tournaments} tournament(s) on the board, ${s.finished} finished match(es) → ${s.reports} report(s) (${s.withObservedEnd} with an observed end, ${s.withDuration} with a duration), ${s.status} status, ${s.quotes} quote(s); ${s.added} added, ${s.revised} revised, ${s.unchanged} unchanged; observed times: ${timesNote}`);
  if (s.filesWritten.length) console.log('  wrote ' + s.filesWritten.join(', '));
  if (s.reportErrors.length) console.log('::error::news ticker: ' + s.reportErrors.length + ' report(s) failed: ' + s.reportErrors.slice(0, 5).join(' | '));
  writeAtomic('news-ticker-run.json', { at: nowIso, ...s, timesNote });
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error('news ticker: ' + (e && e.stack || e)); process.exit(1); });
