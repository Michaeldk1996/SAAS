// Event hold rate (founder Q9, TEN-312 card 380abd18, 2026-09-30; TEN-368)
// =============================================================================
// Per ATP event: service games held ÷ service games played, from OUR OWN box
// scores over ALL editions on file, with n = service games. The Match analysis
// Tournament tab prints it and Key factors' Tournament card prints the same
// figure (it replaced the court-conditions sheet's count-less %, MA_HOLD_NO_N).
//
// SOURCE: the committed tier-page box-score archive (boxscore-archive/, TEN-323,
// swept by tools/tier-page-sweep.js). Each entry carries the api-tennis
// tournament name + key (`tn` / `tk`) and the whole-match raw counts
// `matchStats.p?.raw['Games:Service games won'] = { won, total }`. The point-by-
// point cache carries no tournament, so it cannot be grouped by event and is not
// read.
//
// RULES
//   · ATP tier only (`t === 'atp'`, event_type 265): the board is ATP only.
//   · A match counts only when BOTH players' service-game counts are on file, so
//     every match in the population is whole. Walkovers have no box score.
//   · One event key per match: a match listed on two weekly pages counts once.
//   · Grouped by the api-tennis tournament key. The page joins on the cleaned
//     name ("ATP Tokyo" → "tokyo"); a cleaned name two keys share is ambiguous
//     and is left out of `byName` (a dash, never a guess).
//   · No gate (modal-analysis.md: the hold rate is not gated), but n always
//     travels with the figure.
//
// Output: event-hold.json (published by pipeline.yml, never committed).
// Regenerated every pipeline run from the committed archive; a failure leaves
// the page's hold cells dashed with the reason.
// =============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ARCHIVE_DIR = path.join(__dirname, 'boxscore-archive');
const OUT_PATH = path.join(__dirname, 'event-hold.json');
const SG = 'Games:Service games won';

function cleanName(tn) { return String(tn || '').replace(/^ATP\s+/i, '').trim(); }

function sgOf(side) {
  const r = side && side.raw && side.raw[SG];
  if (!r || !Number.isFinite(r.won) || !Number.isFinite(r.total) || r.total <= 0 || r.won < 0 || r.won > r.total) return null;
  return r;
}

// weeks: an iterable of { [eventKey]: archiveEntry } objects, oldest file first.
function buildEventHold(weeks) {
  const seen = new Set();
  const ev = {};
  for (const week of weeks) {
    for (const ek of Object.keys(week || {})) {
      if (seen.has(ek)) continue;
      seen.add(ek);
      const e = week[ek];
      if (!e || e.t !== 'atp' || e.tk == null || !e.tn) continue;
      const ms = e.matchStats || {};
      const a = sgOf(ms.p1), b = sgOf(ms.p2);
      if (!a || !b) continue;
      const k = String(e.tk);
      const x = ev[k] || (ev[k] = { name: cleanName(e.tn), names: [], held: 0, games: 0, matches: 0, years: [], from: null, to: null });
      const nm = cleanName(e.tn);
      if (!x.names.includes(nm)) x.names.push(nm);
      x.held += a.won + b.won;
      x.games += a.total + b.total;
      x.matches++;
      const d = e.d ? String(e.d).slice(0, 10) : null;
      if (d) {
        const y = d.slice(0, 4);
        if (!x.years.includes(y)) x.years.push(y);
        if (!x.from || d < x.from) x.from = d;
        if (!x.to || d > x.to) { x.to = d; x.name = nm; }   // the latest edition's spelling names the event
      }
    }
  }
  const byName = {}, clash = new Set();
  for (const k of Object.keys(ev)) {
    ev[k].years.sort();
    for (const nm of ev[k].names) {
      const lk = nm.toLowerCase();
      if (byName[lk] != null && byName[lk] !== k) clash.add(lk);
      byName[lk] = k;
    }
  }
  clash.forEach(lk => { delete byName[lk]; });
  return { v: 1, source: 'boxscore-archive (api-tennis tier pages, TEN-323)', events: ev, byName, ambiguous: [...clash].sort() };
}

function readWeeks(dir) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^\d+-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(f)).sort() : [];
  let bad = 0;
  const weeks = [];
  for (const f of files) {
    try { weeks.push(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString('utf8'))); }
    catch (err) { bad++; console.error(`event-hold: unreadable ${f} — skipped: ${err.message}`); }
  }
  return { weeks, files: files.length, bad };
}

function main() {
  const { weeks, files, bad } = readWeeks(ARCHIVE_DIR);
  if (!files) { console.error('event-hold: no box-score archive — nothing written'); process.exit(1); }
  const out = Object.assign({ builtAt: new Date().toISOString(), files, unreadable: bad }, buildEventHold(weeks));
  const tmp = OUT_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out));
  fs.renameSync(tmp, OUT_PATH);
  const evs = Object.values(out.events);
  console.log(`event-hold: ${evs.length} ATP events, ${evs.reduce((s, x) => s + x.matches, 0)} matches, ` +
    `${evs.reduce((s, x) => s + x.games, 0)} service games from ${files} archive files (${bad} unreadable)`);
}

module.exports = { buildEventHold, cleanName };
if (require.main === module) main();
