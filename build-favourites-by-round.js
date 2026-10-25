// =============================================================================
// Favourites vs underdogs by round, cumulative (founder brief round 2, item 2.2, 2026-10-25)
// =============================================================================
// Per tournament page event: R1 / R1–R2 / … / F, each row = matches, favourites won, underdogs won (counts; the page
// prints % with the denominator, dashed below SAMPLE_FLOOR). Three columns: this event's current season · this event's
// past editions (same venue only) · the ATP tour baseline (best-of-three, Slams out, hard, the event's own indoor/outdoor,
// last 10 seasons).
//
// RULES
//   · Prices: database-yield-master.json — the ONE master every page prices from (single-price rule). Favourite = the
//     shorter Pinnacle CLOSE (books 0 Tennis-Data Pinnacle, 3 from Pinnacle history, 4 captured — the captured close
//     stands until the archive supersedes it). Book 1 (Tennis-Data Bet365 close, Jan–Apr 2026) is used and marked "B".
//     A snapshot (books 2, 5–8, "Pinnacle (approx.)") is not a close: that match counts as "no Pinnacle close" (a dash).
//   · Exact closing tie → the shorter first-captured Pinnacle price; no first-captured price is held for these rows, so
//     every tie is a dash, counted (`ties`).
//   · Winner = Settlement.matchWinner: the official result — a retirement counts, a walkover is not a match. Walkovers
//     never reach the master; they are counted from the source rows (odds-archive/*.csv, tournament-progression.json).
//   · Lineage = build-tournament-market.js ALIAS + ROW_SPLIT (the tournament cards' own name join): Almaty = "Almaty
//     Open" (2024–25, not Astana), Brussels = "European Open" October 2025+ (never Antwerp), Lyon (France) = no past.
//   · Matches the master does not price at all are counted per scope as `noClose` with `played` (never dropped).
// Output: favourites-by-round.json (pipeline.yml, after build-database-yield.js; never committed).
// =============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const { matchWinner } = require('./settlement.js');
const { ALIAS, ROW_SPLIT } = require('./build-tournament-market.js');

const SAMPLE_FLOOR = 15;                                    // founder default 2026-10-25: below it the % is a dash
const BASELINE_YEARS = [2016, 2025];                        // the last 10 completed seasons
const ROUND_ORDER = ['1st Round', '2nd Round', '3rd Round', '4th Round', 'Quarterfinals', 'Semifinals', 'The Final'];
const ROUND_SHORT = { 'Quarterfinals': 'QF', 'Semifinals': 'SF', 'The Final': 'F' };
const PIN_CLOSE = new Set([0, 3, 4]), B365_CLOSE = 1;
// tournament-progression.json keys the current week by CITY: its 'Lyon' is the October event (Lyon (France)), never the
// clay Lyon, which therefore reads no progression row.
const PROGRESSION_KEY = { 'Lyon (France)': 'Lyon', 'Lyon': null };
const EVENTS = Object.keys(ALIAS);                          // every tournament-page event the name join knows (catalog names)

const yearOf = d => Number(String(d).slice(0, 4)), monthOf = d => Number(String(d).slice(5, 7));

// The rows a lineage key pools, exactly as build-tournament-market.js pools them (ALIAS names, ROW_SPLIT filters).
function lineageFilter(key) {
  const names = new Set(ALIAS[key] || []), split = ROW_SPLIT[key] || {};
  return r => {
    if (!names.has(r.tournament)) return false;
    const rule = split[r.tournament];
    if (!rule) return true;
    return (!rule.year || rule.year(yearOf(r.date))) && (!rule.month || rule.month(monthOf(r.date))) && (!rule.surface || r.surface === rule.surface);
  };
}

function masterObjects(master) {
  const c = master.meta.cols, ix = Object.fromEntries(c.map((k, i) => [k, i]));
  return master.rows.map(a => Object.fromEntries(c.map(k => [k, a[ix[k]]])));
}

// One match → its scope outcome: { kind: 'fav'|'dog'|'tie'|'noClose'|'walkover', b365 }.
function outcomeOf(r) {
  const book = Number(r.book);
  if (!PIN_CLOSE.has(book) && book !== B365_CLOSE) return { kind: 'noClose' };
  const pw = Number(r.pw), pl = Number(r.pl);
  if (!(pw >= 1.01) || !(pl >= 1.01)) return { kind: 'noClose' };
  if (pw === pl) return { kind: 'tie', b365: book === B365_CLOSE };
  const w = matchWinner({ comment: r.comment, winnerSide: pw < pl ? 'fav' : 'dog' });
  if (w == null) return { kind: 'walkover' };
  return { kind: w, b365: book === B365_CLOSE, retired: String(r.comment).trim() !== 'Completed' };
}

// Cumulative rows over the round ladder present in `rounds` (Tennis-Data round names, draw order).
function cumulative(matches, ladder) {
  const out = [];
  const acc = { n: 0, fav: 0, dog: 0, ties: 0, noClose: 0, b365: 0, retirements: 0 };
  ladder.forEach((rnd, i) => {
    for (const m of matches.filter(x => x.round === rnd)) {
      const o = outcomeOf(m);
      if (o.kind === 'fav' || o.kind === 'dog') { acc.n++; acc[o.kind]++; if (o.b365) acc.b365++; if (o.retired) acc.retirements++; }
      else if (o.kind === 'tie') acc.ties++;
      else if (o.kind === 'noClose') acc.noClose++;
    }
    const first = ladder[0], sh = ROUND_SHORT[rnd] || `R${i + 1}`;
    out.push(Object.assign({ through: rnd, label: i === 0 ? (ROUND_SHORT[first] || 'R1') : `${ROUND_SHORT[first] || 'R1'}–${sh}` }, acc));
  });
  return out.map(r => Object.assign({}, r));
}

function ladderOf(matches) {
  const present = new Set(matches.map(m => m.round));
  return ROUND_ORDER.filter(r => present.has(r));
}

// Walkovers per scope from the Tennis-Data CSVs (comment 'Walkover'); 2026 current editions also read progression.
function walkoverCounter(csvRows) {
  return pred => csvRows.filter(r => r.comment === 'Walkover' && pred(r)).length;
}
function readCsvRows(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir).filter(f => /^\d{4}\.csv$/.test(f))) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).filter(Boolean);
    const head = lines[0].split(','), I = n => head.indexOf(n);
    const iDate = I('Date'), iT = I('Tournament'), iC = I('Comment'), iS = I('Surface'), iR = I('Round');
    for (const l of lines.slice(1)) { const c = l.split(','); out.push({ date: c[iDate], tournament: c[iT], comment: (c[iC] || '').trim(), surface: c[iS], round: c[iR] }); }
  }
  return out;
}

function buildFavouritesByRound({ master, csvRows, progression, now }) {
  const all = masterObjects(master).filter(r => r.set === 'db' || r.set === 'ret' || r.set === 'tie');
  const year = Number(String(now || new Date().toISOString()).slice(0, 4));
  const wo = walkoverCounter(csvRows || []);
  const events = {};
  for (const key of EVENTS) {
    const inLine = lineageFilter(key);
    const mine = all.filter(inLine);
    const cur = mine.filter(r => yearOf(r.date) === year), past = mine.filter(r => yearOf(r.date) < year);
    const court = (cur[0] || past[past.length - 1] || {}).court || null;
    const pk = PROGRESSION_KEY.hasOwnProperty(key) ? PROGRESSION_KEY[key] : key;
    const prog = pk && progression && progression.tournaments ? progression.tournaments[pk] : null;
    const progWo = prog && Array.isArray(prog.matches) ? prog.matches.filter(m => m.status === 'walkover').length : null;
    const pastYears = [...new Set(past.map(r => yearOf(r.date)))].sort();
    events[key] = {
      court,
      current: cur.length ? { year, rows: cumulative(cur, ladderOf(cur)), walkovers: progWo } : null,
      past: past.length ? { years: pastYears, rows: cumulative(past, ladderOf(past)), walkovers: wo(r => inLine(r) && yearOf(r.date) < year) } : null,
    };
  }
  // Tour baseline: best-of-three (Slams out, team events and the Finals out — the x set and 'Masters Cup'), hard, per court.
  const base = court => {
    const pool = all.filter(r => r.surface === 'Hard' && r.court === court && String(r.bestof) === '3' && r.series !== 'Grand Slam'
      && r.series !== 'Masters Cup' && yearOf(r.date) >= BASELINE_YEARS[0] && yearOf(r.date) <= BASELINE_YEARS[1]);
    return { court, years: BASELINE_YEARS, rows: cumulative(pool, ROUND_ORDER.filter(r => pool.some(m => m.round === r))),
      walkovers: wo(r => r.surface === 'Hard' && yearOf(r.date) >= BASELINE_YEARS[0] && yearOf(r.date) <= BASELINE_YEARS[1]) };
  };
  return { v: 1, floor: SAMPLE_FLOOR, priceBasis: 'database-yield-master.json: Pinnacle close (books 0/3/4), Bet365 close "B" (book 1)',
    winnerRule: 'Settlement.matchWinner — official result, retirements count, walkovers excluded', events,
    baseline: { Indoor: base('Indoor'), Outdoor: base('Outdoor') } };
}

function main() {
  const master = JSON.parse(fs.readFileSync(path.join(__dirname, 'database-yield-master.json'), 'utf8'));
  let progression = null;
  try { progression = JSON.parse(fs.readFileSync(path.join(__dirname, 'tournament-progression.json'), 'utf8')); } catch (_) { /* optional */ }
  const out = Object.assign({ builtAt: new Date().toISOString() },
    buildFavouritesByRound({ master, csvRows: readCsvRows(path.join(__dirname, 'odds-archive')), progression, now: new Date().toISOString() }));
  const file = path.join(__dirname, 'favourites-by-round.json'), tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out));
  fs.renameSync(tmp, file);
  for (const [k, e] of Object.entries(out.events)) {
    const last = rs => (rs && rs.length ? rs[rs.length - 1] : null);
    const c = last(e.current && e.current.rows), p = last(e.past && e.past.rows);
    console.log(`favourites-by-round ${k}: current ${c ? `${c.fav}/${c.n} fav (noClose ${c.noClose}, ties ${c.ties})` : '—'}; past ${p ? `${p.fav}/${p.n} (${e.past.years.join(',')})` : '—'}; court ${e.court || '—'}`);
  }
}

module.exports = { buildFavouritesByRound, outcomeOf, cumulative, lineageFilter, SAMPLE_FLOOR };
if (require.main === module) main();
