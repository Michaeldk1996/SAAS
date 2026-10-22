#!/usr/bin/env node
/*
 * tools/started-evidence.js — did a match Tennis-Data does not mark Completed / Retired actually start?
 * Founder ruling 2026-10-17 (odds master close-out, item 1): a match that STARTED counts as played and shows its price —
 * retired, defaulted, or marked "Awarded" / "Disqualified" / any other non-result after play began. Only a match where no
 * ball was played (a true walkover) stays a dash. Where the sources disagree on whether it started, it is flagged and
 * keeps the dash — never picked.
 *
 * Sources per match (no other, nothing guessed):
 *   - Tennis-Data's comment: "Walkover" claims no ball was played; Awarded / Disqualified / Sched / … claim nothing.
 *   - each player's career-history row of the match (the pipeline's store: api-tennis rows 2021 on, Tennis Abstract rows
 *     before): `walkover: true` = no ball played; a set score with a game won = started; neither = no evidence.
 * The Database build adds one more source: our archive's close for the row (td-feed override), which exists only for a
 * match our live poller saw in play (pinarch: a close is cut at a verified live start) — api-tennis showing it started.
 * Verdict: `completed` when every career row that speaks shows the match played out (no retirement or default, the winner
 * reached the sets the format needs) — a normal played match, counted in every Database figure (founder 2026-10-18);
 * `started` when at least one source says started, none says walkover and Tennis-Data does not say Walkover;
 * `walkover` when every source that speaks says no ball was played; `disagree` when they differ; `none` when no career
 * row speaks (and Tennis-Data claims nothing). Only `started` is priced (build-database-yield.js, behind the retired flag).
 *
 * Usage: node tools/started-evidence.js [--root DIR] [--out started-evidence.json]
 * Reads DIR/odds-archive/*.csv, DIR/career-history/{key}.json, DIR/player-profiles.json + DIR/matches.json (the roster
 * the name join reads). No network. A store with no career-history/ writes nothing and exits 0 (no evidence = a dash).
 */
const fs = require('fs');
const path = require('path');
const { readCsv, keyFromArchiveName, ourCandidateKeys } = require('../build-odds-performance.js');
const { makeResolver } = require('../build-match-closes.js');

// Tennis-Data comments that are a result as they stand (build-database-yield.js RESULT_STANDS + RETIRED)
const PLAYED_COMMENTS = new Set(['Completed', 'Retired', 'Rrtired']);
const WALKOVER_COMMENT = 'Walkover';
// a career row of this match: dated [−16, +3] days of Tennis-Data's date (an archive row is dated at its event's start)
const WINDOW = [-16, 3];
// the same match, not a neighbouring meeting (founder 2026-10-18, measured: 4 walkovers had paired a real meeting a week
// apart): a dated feed row (eventKey) within ±1 day; an archive row (dated at its event's start) never after the match and
// with no round that contradicts Tennis-Data's
const TD_ROUND = { 'The Final': 'F', 'Semifinals': 'SF', 'Quarterfinals': 'QF', 'Round Robin': 'RR' };
const roundCode = s => { s = String(s || ''); if (/^(F|Final)$/i.test(s)) return 'F'; if (/^(SF|Semi-finals)$/i.test(s)) return 'SF';
  if (/^(QF|Quarter-finals)$/i.test(s)) return 'QF'; if (/^RR$/.test(s)) return 'RR'; return /^R\d+$|1\/\d+-finals|Round/i.test(s) ? 'early' : null; };
function sameMatch(x, tdRound, dd) {
  if (x.eventKey != null) return Math.abs(dd) <= 1;
  if (dd > 0) return false;
  const a = roundCode(x.round), b = TD_ROUND[tdRound] || (/Round/i.test(String(tdRound || '')) ? 'early' : null);
  return !(a && b && a !== b);
}

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const day = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : null; };
const price = v => { const f = parseFloat(v); return Number.isFinite(f) && f >= 1.01 && f <= 1000 ? f : null; };

// one career row → what it says about the start, and whether the match was played out (founder ruling 2026-10-18: a
// completed match Tennis-Data mislabels — "Sched" on the US Open 2019 final — is a normal played match). `completed` =
// no retirement, default or walkover flag, and the match's winner reached the sets the format needs (best-of from
// Tennis-Data's own row: 2 of 3, 3 of 5) on the row's own set scores. `started` = a game was played, not played out.
function rowSays(r, bestOf) {
  if (!r) return null;
  if (r.walkover) return 'walkover';
  const sets = Array.isArray(r.sets) ? r.sets : [];
  const games = sets.reduce((a, s) => a + (+(s && s.p) || 0) + (+(s && s.o) || 0), 0);
  if (!(games > 0)) return null;
  const need = +bestOf === 5 ? 3 : +bestOf === 3 ? 2 : null;
  const winnerSets = sets.filter(s => s && (r.won ? +s.p > +s.o : +s.o > +s.p)).length;
  if (need && !r.retired && !r.defaulted && winnerSets === need) return 'completed';
  return 'started';
}
// `live` = our archive's close (cut only at a verified live start): it says the match started, nothing about its end.
function verdictOf(comment, says) {
  const s = says.filter(Boolean);
  const claims = comment === WALKOVER_COMMENT ? s.concat('walkover') : s;
  if (!claims.length) return 'none';
  if (claims.every(x => x === 'completed' || x === 'live') && claims.includes('completed')) return 'completed';
  if (claims.every(x => x === 'started' || x === 'completed' || x === 'live')) return 'started';
  if (claims.every(x => x === 'walkover')) return 'walkover';
  return 'disagree';
}

function build(root) {
  const chDir = path.join(root, 'career-history');
  if (!fs.existsSync(chDir)) return null;
  const roster = new Map();
  const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } };
  const p = readJson(path.join(root, 'player-profiles.json'), {}).players || {};
  Object.entries(p).forEach(([k, v]) => { if (v && v.name) roster.set(String(k), String(v.name)); });
  const m = readJson(path.join(root, 'matches.json'), []);
  (Array.isArray(m) ? m : (m.matches || [])).forEach(x => { if (x.p1Key != null && x.p1 && !roster.has(String(x.p1Key))) roster.set(String(x.p1Key), x.p1);
    if (x.p2Key != null && x.p2 && !roster.has(String(x.p2Key))) roster.set(String(x.p2Key), x.p2); });
  const idx = readJson(path.join(root, 'career-history-index.json'), {}).players || {};
  Object.entries(idx).forEach(([k, v]) => { const n = v && (v.name || v.n); if (n && !roster.has(String(k))) roster.set(String(k), String(n)); });
  const res = makeResolver(roster, require('../td-identity.js').buildIdentityGate(root, roster));   // the identity gate (founder 2026-10-18)
  const shardCache = new Map();
  const shard = k => { if (!shardCache.has(k)) { const d = readJson(path.join(chDir, `${k}.json`), null); shardCache.set(k, d ? (d.matches || []) : null); } return shardCache.get(k); };
  const surnameOf = n => { const c = ourCandidateKeys(n); return c.length ? c.map(x => x.surname) : []; };

  const files = fs.readdirSync(path.join(root, 'odds-archive')).filter(f => /^\d{4}\.csv$/.test(f)).sort();
  const out = [], retired = [];
  // ruling 4 (founder 2026-10-22): a retired row's first set, from the career rows that speak; they must agree
  const { firstSetState } = require('../market-edge-core.js');
  const fsOf = (...looks) => {
    const st = looks.filter((x) => x && x.row).map((x) => firstSetState(x.row.sets)).filter((s) => s !== 'missing');
    if (!st.length || st.some((s) => s !== st[0])) return 'm';
    return st[0] === 'complete' ? 'c' : 'i';
  };
  for (const f of files) for (const r of readCsv(path.join(root, 'odds-archive', f))) {
    const comment = String(r.comment || '').trim();
    const isRet = comment === 'Retired' || comment === 'Rrtired';
    if (PLAYED_COMMENTS.has(comment) && !isRet) continue;
    const priced = (price(r.psw) && price(r.psl)) || (price(r.b365w) && price(r.b365l));
    if (!priced) continue;                     // nothing to price either way
    const d = day(r.date);
    const keyW = res.archive(r.winner, r.date), keyL = res.archive(r.loser, r.date);
    const look = (key, won, oppArchive) => {
      if (!key) return { key: null, says: null, why: 'name not joined' };
      const rows = shard(key);
      if (!rows) return { key, says: null, why: 'no career-history shard' };
      const oppK = keyFromArchiveName(oppArchive);
      const hits = rows.filter(x => {
        // HOLD (2026-10-22): career-history now carries every flagged walkover as a row (founder ruling 2026-10-22). Read as
        // evidence, they move Database rows from "started" (priced) to a dash — correct by the 2026-10-17 rule, but a drop
        // the archive gate refuses until it is measured and approved (tools/archive-gate.mjs accept). Until then the
        // evidence is what it was before those rows existed: a walkover row is not read.
        if (x.walkover) return false;
        const dx = day(x.date); if (d == null || dx == null) return false;
        const dd = dx - d; if (dd < WINDOW[0] || dd > WINDOW[1]) return false;
        if (!!x.won !== won) return false;
        if (!sameMatch(x, r.round, dd)) return false;
        return oppK && surnameOf(x.opponent).includes(oppK.surname);
      });
      if (hits.length !== 1) return { key, says: null, why: hits.length ? `${hits.length} candidate rows` : 'no career row' };
      const h = hits[0];
      return { key, says: rowSays(h, r.bestof), why: null, row: { date: h.date, tournament: h.tournament, round: h.round || null, sets: h.sets || null,
        walkover: !!h.walkover, retired: !!h.retired, defaulted: !!h.defaulted, src: h.src || (h.eventKey != null ? 'fixtures' : 'archive') } };
    };
    const w = look(keyW, true, r.loser), l = look(keyL, false, r.winner);
    if (isRet) { retired.push({ date: r.date, tournament: r.tournament, winner: r.winner, loser: r.loser, fs: fsOf(w, l) }); continue; }
    out.push({ date: r.date, tournament: r.tournament, round: r.round, winner: r.winner, loser: r.loser, comment,
      says: [w.says, l.says], verdict: verdictOf(comment, [w.says, l.says]), winnerRow: w, loserRow: l });
  }
  const counts = {};
  out.forEach(x => { const k = `${x.comment}|${x.verdict}`; counts[k] = (counts[k] || 0) + 1; });
  return { rule: 'started = a career row shows a game played, none shows a walkover, and Tennis-Data does not say Walkover (founder 2026-10-17); completed = every career row that speaks shows it played out (founder 2026-10-18)',
    builtAt: new Date().toISOString(), rows: out.length, counts, matches: out,
    // ruling 4: every priced retired Tennis-Data row, fs = its first set from the career rows ('c' complete, 'i' not, 'm' none)
    retired, retiredFirstSet: { c: retired.filter((x) => x.fs === 'c').length, i: retired.filter((x) => x.fs === 'i').length, m: retired.filter((x) => x.fs === 'm').length } };
}

module.exports = { sameMatch, build, rowSays, verdictOf, PLAYED_COMMENTS };

if (require.main === module) {
  const root = path.resolve(arg('--root', '.')), outPath = arg('--out', path.join(root, 'started-evidence.json'));
  const r = build(root);
  if (!r) { console.log('started-evidence: no career-history/ in ' + root + ' — no evidence written (every non-result row keeps its dash)'); process.exit(0); }
  const tmp = outPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(r, null, 1)); fs.renameSync(tmp, outPath);
  console.log(`started-evidence: ${r.rows} non-result priced Tennis-Data rows · ${JSON.stringify(r.counts)} · retired first set ${JSON.stringify(r.retiredFirstSet)}`);
}
