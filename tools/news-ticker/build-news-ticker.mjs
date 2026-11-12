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
import { humaniseReport, VOICE_VERSION } from './humanise.mjs';
import { baselineFor } from './standouts.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { reportText, statusItems, h2hAfter, roundWords, breakPoints } from './news-core.mjs';
import { pbpFacts, scoreFacts } from './pbp-facts.mjs';
import { mergeItems, buildIndex, fileOf, observedTimes } from './ticker-core.mjs';

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

export async function build({ nowIso, times, rewrite = null, apiKey = process.env.ANTHROPIC_API_KEY }) {
  const voiceOn = !!(rewrite || apiKey), VOICE_MAX_CALLS = Number(process.env.NEWS_REPORT_MAX_CALLS || 40);
  let voiceCalls = 0;
  const { berlinWallMs } = require(path.join(ROOT, 'berlin-time.js'));
  const H2HCore = require(path.join(ROOT, 'h2h-core.js'));
  const board = readJson('matches.json');
  if (!board) throw new Error('matches.json could not be read');
  const cards = Object.values(board).filter((m) => m && m.tourBadge === 'ATP' && m.tournamentKey != null && m.p1Key != null && m.p2Key != null
    && !/\//.test(String(m.p1) + String(m.p2)));                       // singles only (a doubles pair is "A / B")
  const index = readJson('player-index.json');
  const ratings = readJson('surface-ratings.json');   // each player's own baseline (Database → Ratings store); absent = no comparison
  const names = ((index && index.players) || []).map((p) => p && p.name).filter(Boolean);
  // A player's full name for a report's first mention: the standings name, used only when it reads "Given … Surname"
  // with the card's own surname last and the card's initial first (api-tennis scrambles some multi-part names).
  const fullByKey = new Map(((index && index.players) || []).filter((p) => p && p.key != null && p.name).map((p) => [String(p.key), String(p.name).trim()]));
  const fullName = (key, card) => {
    const f = fullByKey.get(String(key)); if (!f) return null;
    const lc = (x) => String(x).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const c = lc(card).replace(/\./g, ' ').split(/\s+/).filter(Boolean); let i = 0; while (i < c.length - 1 && c[i].length <= 2) i++;
    const sur = c.slice(i).join(' ');
    return sur && lc(f).endsWith(' ' + sur) && lc(f)[0] === c[0][0] && lc(f).split(/\s+/).length === sur.split(' ').length + 1 ? f : null;
  };
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

  // an outlet switched off in the registry ("enabled": false) has its quotes hidden from this run on — the one case an item leaves the feed
  const reg = readJson('data/news-outlets.json') || {};
  const off = new Set([...(reg.outlets || []), ...(reg.tournamentSites || []).flatMap((x) => [{ ...x, outlet: x.name }, { ...x, outlet: x.ownName }])].filter((o) => o.enabled === false).map((o) => o.outlet));
  const hidden = (x) => x.type === 'quote' && off.has(x.sourceName);
  const summary = { voice: { rewritten: 0, reused: 0, notRewritten: 0, errors: 0, lastError: null, tokens: { input: 0, output: 0 }, reportsFullyInVoice: 0, reportsTotal: 0, sentencesPassed: 0, sentencesTotal: 0 }, tournaments: 0, finished: 0, reports: 0, reportErrors: [], status: 0, quotes: 0, added: 0, revised: 0, unchanged: 0, filesWritten: [], withObservedEnd: 0, withDuration: 0, hiddenByOffSwitch: 0 };
  const touched = [];
  for (const g of groups.values()) {
    const file = fileOf(g.key, g.season);
    const existing = readJson(file);
    const old = new Map(((existing && existing.items) || []).map((x) => [x.id, x]));
    const progT = progs.find((t) => new RegExp(`^${g.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i').test(t.feedName || ''));
    const pageRound = (m, side) => {
      const p = progT && (progT.players || []).find((x) => String(x.playerKey) === String(m[side + 'Key']));
      const o = side === 'p1' ? 'p2' : 'p1';
      const r = p && (p.rounds || []).filter((x) => x.opponent === m[o]);
      return r && r.length === 1 && PAGE_ROUND[r[0].round] ? PAGE_ROUND[r[0].round] : null;
    };
    const fresh = [];
    const done = g.cards.filter((m) => m.finalScore && m.finalScore.winner);
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
        let text = rep.text, voice = null;
        if (prev && prev.voice && prev.voice.version === VOICE_VERSION && prev.templateText === rep.text) { text = prev.text; voice = prev.voice; summary.voice.reused++; }
        else if (voiceOn && voiceCalls < VOICE_MAX_CALLS) {
          voiceCalls++;
          const h = await humaniseReport({ sentences: rep.sentences, tones: rep.tones, kinds: rep.kinds, winner: { card: m[w], full: fullName(m[w + 'Key'], m[w]) }, loser: { card: m[l], full: fullName(m[l + 'Key'], m[l]) } }, { rewrite, apiKey });
          if (h.usage) { summary.voice.tokens.input += h.usage.input; summary.voice.tokens.output += h.usage.output; }
          if (h.status === 'ok') { text = h.text; voice = h.voice; summary.voice.rewritten++; }
          else { summary.voice.errors++; summary.voice.lastError = `${h.status}${h.detail ? ': ' + h.detail : ''}`; }
        } else summary.voice.notRewritten++;
        if (obs && obs.endedAt) summary.withObservedEnd++;
        if (rep.used.duration) summary.withDuration++;
        fresh.push({ id, type: 'report', playerId: String(m[w + 'Key']), opponentId: String(m[l + 'Key']), player: m[w], opponent: m[l],
          tournament: g.name, tournamentKey: g.key, season: g.season, stage: stage || 'main draw', round: rep.fields.round, eventKey: ek(m),
          timestamp: obs && obs.endedAt ? obs.endedAt : startIso(m), timestampKind: obs && obs.endedAt ? 'observed' : 'scheduled',
          observed: obs || null, category: 'Statistics', text, ...(voice ? { templateText: rep.text, voice } : {}), fields: rep.fields,
          sourceName: 'Stennisfy match data (api-tennis box score and point-by-point)', sourceUrl: `pbp/${ek(m)}.json`, language: 'en', translated: false });
        summary.reports++;
      } catch (e) { summary.reportErrors.push(`${m.id}: ${e && e.message}`); }
    }
    for (const s of statusItems(g.cards, { ek, startIso, tournament: g.name, base: '' })) {
      fresh.push({ ...s, tournamentKey: g.key, season: g.season, sourceUrl: 'matches.json' }); summary.status++;
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
    const fresh = ((qf && qf.items) || []).filter((q) => !hidden(q));
    const kept = ((existing && existing.items) || []).filter((x) => !hidden(x)), dropped = ((existing && existing.items) || []).length - kept.length;
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
