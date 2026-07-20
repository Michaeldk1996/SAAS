#!/usr/bin/env node
'use strict';
// =============================================================================
// Task 12 — Career Splits + Last 52 Weeks Splits, from Jeff Sackmann's ATP
// match-results data.
//
// The canonical source (github.com/JeffSackmann/tennis_atp) is unreachable from
// this environment (egress allowlist), so we pull the SAME underlying data from
// Sackmann's own site, tennisabstract.com, which IS reachable: each player's
// player-classic.cgi page embeds a `var matchmx` array of every tour match with
// surface, level, round, score, best-of, and — critically for this task —
// opponent HAND (R/L) and opponent RANK at match time. Feasibility confirmed:
// both fields are present, so vs Righties / vs Lefties / vs Top 10 are real.
//
// Output: career-splits.json, keyed by player-profiles.json profile key, with a
// `career` and a `last52` block, each a map of the 14 split categories to
// { M, W, L, winPct, setW, setL, setPct }. Zero-match categories are dropped so
// the dashboard can hide empty rows. NOTHING is approximated — a split absent
// from the data is simply absent.
//
// Usage: node tools/build-career-splits.js [rankMax] [maxPlayers]
//   Re-runnable; pages cached in /tmp/ta-cache and refetched once older than
//   SPLITS_CACHE_TTL_HOURS (default 20). Extend coverage by raising the caps
//   (default rankMax=250, maxPlayers=160 — the current relevant ATP field).
//   Env: SPLITS_CACHE_DIR, SPLITS_CACHE_TTL_HOURS, SPLITS_TODAY (pin fetchedAt).
//   Rebuilt daily by .github/workflows/career-splits.yml, which commits the
//   result; pipeline.yml then copies the committed file to the live site.
// =============================================================================

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const PROFILES = path.join(ROOT, 'player-profiles.json');
const OUT = path.join(ROOT, 'career-splits.json');
const CACHE = process.env.SPLITS_CACHE_DIR || '/tmp/ta-cache';
const RANK_MAX = parseInt(process.argv[2], 10) || 250;
// No cap by default: RANK_MAX is the intended scope, and a second numeric cap
// silently dropped everyone past it (it held coverage at 160 of the 236
// profiles that pass rank<=250). Pass a number to cap deliberately, e.g. when
// smoke-testing against a cold cache.
const MAX_PLAYERS = parseInt(process.argv[3], 10) || Infinity;
// tennisabstract rate-limits bursts (HTTP 429), so we pace: low concurrency, a
// base delay per request, and exponential backoff on 429. Cached pages skip the
// network entirely, so re-runs only pay for players not yet fetched.
const CONCURRENCY = 2;
const BASE_DELAY_MS = 600;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// A cached page older than this is refetched. Without expiry a re-run reads
// yesterday's HTML back and reproduces the stale file exactly, which looks like
// a successful refresh while changing nothing.
const CACHE_TTL_MS = (parseFloat(process.env.SPLITS_CACHE_TTL_HOURS) || 20) * 3600 * 1000;
// Run date, as YYYYMMDD. Only stamps `fetchedAt` and backstops a player with no
// matches — the real last-52 window is anchored per player (see cutoff52).
// SPLITS_TODAY pins it for a reproducible build.
function todayStamp() {
  const pin = (process.env.SPLITS_TODAY || '').trim();
  if (/^\d{8}$/.test(pin)) return pin;
  const dt = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}`;
}
const TODAY = todayStamp();
function daysAgoStamp(stamp, cutoff) { return stamp >= cutoff; }
// 364 days before a YYYYMMDD stamp, as YYYYMMDD.
function minus364(stamp) {
  const y = +stamp.slice(0, 4), m = +stamp.slice(4, 6), d = +stamp.slice(6, 8);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 364);
  const p = n => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}${p(dt.getUTCMonth() + 1)}${p(dt.getUTCDate())}`;
}
// Tennis Abstract anchors "Last 52 Weeks" to the player's OWN most recent match,
// not to today. Verified by solving for the cutoff that reproduces TA's rendered
// table: Rune (last played Oct 2025) only matches with an Oct 2024 cutoff, while
// Alcaraz needs Apr 2025 — no single global date fits both. So for a player who
// is out injured this shows his last 52 active weeks rather than a near-empty
// window, which is also the more useful read of recent form.
function cutoff52(matches) {
  let last = '';
  for (const m of matches) if (m.date > last) last = m.date;
  return last ? minus364(last) : minus364(TODAY);
}

function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function taId(fullName) {
  // "Carlos Alcaraz" -> "CarlosAlcaraz"; "Alex de Minaur" -> "AlexdeMinaur"
  return stripAccents(fullName).replace(/[^A-Za-z]/g, '');
}
function normKey(s) {
  return stripAccents(String(s || '')).toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 25000, headers: { 'User-Agent': 'Mozilla/5.0 bsp-splits' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume(); return get(res.headers.location).then(resolve, reject);
      }
      let data = ''; res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// ---- parse one matchmx into normalized match objects ------------------------
// matchmx is a JSON array literal, so we brace-match it and JSON.parse it.
// Scanning row-by-row with /\[[^\[\]]*\]/ looks equivalent but is NOT: a super
// tiebreak score ("6-7 [10-7]") contains its own brackets, so that regex tears
// the row in half and silently drops a real match from every total.
// One player's serve counters for a match, read from `cells` starting at `base`.
// Returns null unless the block is complete and internally consistent — a match
// with no stats recorded carries empty strings here, and a serve column built
// over those would report a real 0% instead of "not measured".
function serveCounters(cells, base) {
  const n = k => {
    const v = cells[base + k];
    if (v === '' || v == null) return null;
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? x : null;
  };
  const o = {
    aces: n(0), dfs: n(1), pts: n(2), firstIn: n(3), firstWon: n(4),
    secondWon: n(5), svGames: n(6), bpSaved: n(7), bpFaced: n(8),
  };
  if (Object.values(o).some(v => v === null)) return null;
  // A serve block with no points played is a placeholder, not a real 0.
  if (!o.pts || !o.svGames) return null;
  if (o.firstIn > o.pts || o.firstWon > o.firstIn) return null;
  if (o.bpSaved > o.bpFaced) return null;
  return o;
}

function parseMatches(html) {
  const i = html.indexOf('var matchmx');
  if (i < 0) return [];
  const s = html.indexOf('[', i);
  let depth = 0, end = -1;
  for (let k = s; k < html.length; k++) {
    const c = html[k];
    if (c === '[') depth++;
    else if (c === ']') { depth--; if (!depth) { end = k + 1; break; } }
  }
  if (end < 0) return [];
  let rows;
  try { rows = JSON.parse(html.slice(s, end)); } catch (e) { return []; }
  const out = [];
  for (const cells of rows) {
    if (!Array.isArray(cells) || cells.length < 16) continue;
    const date = cells[0], surface = cells[2], level = cells[3], wl = cells[4],
      round = cells[8], score = cells[9], bestofRaw = cells[10],
      oppRank = cells[12], oppHand = cells[15];
    if (wl !== 'W' && wl !== 'L') continue;
    out.push({
      date, surface, level, wl, round, score,
      // Cells 21-38 are the per-match serve counters for both players, in
      // Sackmann's atp_matches order. Older matches carry none — serve() returns
      // null for those and they are excluded from MS and every serve column,
      // rather than being averaged in as zeros.
      srv: serveCounters(cells, 21),
      opp: serveCounters(cells, 30),
      // Strictly the source's own best-of field. Inferring 5 from a Grand Slam
      // over-counts: a walkover carries no best-of, which is why TA shows one
      // more Grand Slam match than Best of 5.
      bestof: bestofRaw === '5' ? 5 : bestofRaw === '3' ? 3 : null,
      oppRank: /^\d+$/.test(oppRank) ? +oppRank : null,
      oppHand: (oppHand === 'R' || oppHand === 'L') ? oppHand : null,
    });
  }
  return out;
}

// A set counts only once it is complete: 6+ with a 2-game margin, or 7-5 / 7-6.
function completedSet(a, b) {
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi >= 6 && hi - lo >= 2) || (hi === 7 && lo >= 5);
}

// player-perspective set W/L from a winner-first score string.
// A walkover has no score at all: it counts as a match and a win, but no sets.
// A match ending RET/DEF was abandoned mid-set — Tennis Abstract drops that
// trailing incomplete set rather than awarding it to either player.
function setRecord(m) {
  const sc = (m.score || '').trim();
  if (!sc || !/\d-\d/.test(sc)) return { w: 0, l: 0 };
  let toks = sc.split(/\s+/).filter(t => /^\d+-\d+(\(\d+\))?$/.test(t));
  if (/RET|DEF/i.test(sc) && toks.length) {
    const last = toks[toks.length - 1].match(/^(\d+)-(\d+)/);
    if (last && !completedSet(+last[1], +last[2])) toks.pop();
  }
  let winnerSets = 0, loserSets = 0;
  for (const tok of toks) {
    const mm = tok.replace(/\(.*?\)/g, '').match(/^(\d+)-(\d+)$/);
    if (!mm) continue;
    const a = +mm[1], b = +mm[2];
    if (a > b) winnerSets++; else if (b > a) loserSets++;
  }
  // score is written winner-first; flip to the player's perspective
  return m.wl === 'W' ? { w: winnerSets, l: loserSets } : { w: loserSets, l: winnerSets };
}

// The scored sets of a match, winner-oriented, after dropping the trailing
// incomplete set of a RET/DEF. Shared by the set, game and tiebreak columns so
// all three agree on what actually counts as played.
function scoredSets(m) {
  const sc = (m.score || '').trim();
  if (!sc || !/\d-\d/.test(sc)) return [];
  const toks = sc.split(/\s+/).filter(t => /^\d+-\d+(\(\d+\))?$/.test(t));
  if (/RET|DEF/i.test(sc) && toks.length) {
    const last = toks[toks.length - 1].match(/^(\d+)-(\d+)/);
    if (last && !completedSet(+last[1], +last[2])) toks.pop();
  }
  return toks.map(t => {
    const mm = t.match(/^(\d+)-(\d+)(?:\((\d+)\))?$/);
    return { a: +mm[1], b: +mm[2], tb: mm[3] !== undefined };
  });
}

// Games won/lost from the player's perspective. Unlike sets, every game of an
// abandoned set is still a game that was played, but TA drops the whole
// incomplete set, so scoredSets is the shared source of truth.
function gameRecord(m) {
  let w = 0, l = 0;
  for (const s of scoredSets(m)) { w += s.a; l += s.b; }
  return m.wl === 'W' ? { w, l } : { w: l, l: w };
}

// Tiebreaks won/lost. A tiebreak set is won by whoever won the set, so the
// tiebreak follows the set's winner.
function tbRecord(m) {
  let w = 0, l = 0;
  for (const s of scoredSets(m)) {
    if (!s.tb) continue;
    if (s.a > s.b) w++; else if (s.b > s.a) l++;
  }
  return m.wl === 'W' ? { w, l } : { w: l, l: w };
}

// Tour level: Grand Slams, Masters, ATP tour ("A"), Tour Finals, Davis Cup.
// Challengers and ITF futures are NOT tour level and must be excluded, or every
// row inflates. F and D count toward the surface rows but get no level row of
// their own, which is why the three level rows do not re-add to the total.
const TOUR_LEVELS = new Set(['G', 'M', 'A', 'F', 'D']);
// Real qualifying is Q1/Q2/Q3 only. Matching /^Q/ would also swallow QF.
const QUALIFYING = /^Q[123]$/;
function isTourLevel(m) {
  return TOUR_LEVELS.has(m.level) && !QUALIFYING.test(m.round);
}

const CATEGORIES = [
  ['Hard', m => m.surface === 'Hard'],
  ['Clay', m => m.surface === 'Clay'],
  ['Grass', m => m.surface === 'Grass'],
  // Carpet died out around 2009, so only long-career players (Djokovic) have a
  // Carpet row at all. Zero-match categories are dropped, so it self-hides.
  ['Carpet', m => m.surface === 'Carpet'],
  ['Grand Slams', m => m.level === 'G'],
  ['Masters', m => m.level === 'M'],
  ['Other Tours', m => m.level === 'A'],
  ['Best of 5', m => m.bestof === 5],
  ['Best of 3', m => m.bestof === 3],
  ['Finals', m => m.round === 'F'],
  ['Semi-finals', m => m.round === 'SF'],
  ['Quarter-finals', m => m.round === 'QF'],
  // Early rounds. Sackmann codes: R16=1/8-final, R32=1/16, R64=1/32, R128=1/64.
  // Zero-match rows are dropped, so short-career players simply won't have the
  // deeper (R128/R64) rows. RR (round-robin, Tour Finals) is deliberately not a
  // bucket — it has no knockout stage to compare against.
  ['Round of 16', m => m.round === 'R16'],
  ['Round of 32', m => m.round === 'R32'],
  ['Round of 64', m => m.round === 'R64'],
  ['Round of 128', m => m.round === 'R128'],
  ['vs. Righties', m => m.oppHand === 'R'],
  ['vs. Lefties', m => m.oppHand === 'L'],
  ['vs. Top 10', m => m.oppRank != null && m.oppRank <= 10],
];

function splits(matches) {
  const rows = {};
  for (const [label, pred] of CATEGORIES) {
    const sub = matches.filter(pred);
    if (!sub.length) continue; // zero-match categories dropped (dashboard hides)
    let W = 0, setW = 0, setL = 0, gameW = 0, gameL = 0, tbW = 0, tbL = 0;
    // Serve totals accumulate ONLY over matches that carry stats, so the
    // denominator of every serve column is MS, not M.
    let MS = 0;
    const t = {
      aces: 0, dfs: 0, pts: 0, firstIn: 0, firstWon: 0, secondWon: 0,
      svGames: 0, bpSaved: 0, bpFaced: 0,
      opts: 0, ofirstWon: 0, osecondWon: 0, osvGames: 0, obpSaved: 0, obpFaced: 0,
    };
    for (const m of sub) {
      if (m.wl === 'W') W++;
      const sr = setRecord(m); setW += sr.w; setL += sr.l;
      const gr = gameRecord(m); gameW += gr.w; gameL += gr.l;
      const tr = tbRecord(m); tbW += tr.w; tbL += tr.l;
      // Both blocks are required: RPW and DR are computed off the opponent's
      // serve, so a match with only one side recorded cannot be counted.
      if (!m.srv || !m.opp) continue;
      MS++;
      t.aces += m.srv.aces; t.dfs += m.srv.dfs; t.pts += m.srv.pts;
      t.firstIn += m.srv.firstIn; t.firstWon += m.srv.firstWon;
      t.secondWon += m.srv.secondWon; t.svGames += m.srv.svGames;
      t.bpSaved += m.srv.bpSaved; t.bpFaced += m.srv.bpFaced;
      t.opts += m.opp.pts; t.ofirstWon += m.opp.firstWon;
      t.osecondWon += m.opp.secondWon; t.osvGames += m.opp.svGames;
      t.obpSaved += m.opp.bpSaved; t.obpFaced += m.opp.bpFaced;
    }
    const M = sub.length, L = M - W;
    const setTot = setW + setL, gameTot = gameW + gameL, tbTot = tbW + tbL;
    const pct = (num, den) => den ? Math.round(num / den * 1000) / 10 : null;

    // Tennis Abstract publishes these formulas in makeSplitStatRow() on the same
    // page as the data — they are lifted from there, not derived, so the columns
    // agree with TA's own tables cell for cell.
    const secondPts = t.pts - t.firstIn;                 // 2nd serve points = every point where the 1st missed
    const svWon = t.firstWon + t.secondWon;
    const oSvWon = t.ofirstWon + t.osecondWon;
    const spw = t.pts ? svWon / t.pts : null;            // serve points won
    const rpw = t.opts ? 1 - oSvWon / t.opts : null;     // return points won = the rest of the opponent's serve
    const r1 = v => v == null ? null : Math.round(v * 1000) / 10;
    const serve = !MS ? null : {
      MS,
      // Hold% = service games minus the ones broken. Break% is the mirror,
      // computed off the opponent's service games.
      hldPct: pct(t.svGames - (t.bpFaced - t.bpSaved), t.svGames),
      brkPct: pct(t.obpFaced - t.obpSaved, t.osvGames),
      aPct: r1(t.pts ? t.aces / t.pts : null),
      dfPct: r1(t.pts ? t.dfs / t.pts : null),
      firstInPct: r1(t.pts ? t.firstIn / t.pts : null),
      firstWonPct: r1(t.firstIn ? t.firstWon / t.firstIn : null),
      secondWonPct: r1(secondPts > 0 ? t.secondWon / secondPts : null),
      spwPct: r1(spw),
      rpwPct: r1(rpw),
      tpwPct: r1((t.pts + t.opts) ? (svWon + (t.opts - oSvWon)) / (t.pts + t.opts) : null),
      // Dominance Ratio: return points won per serve point lost. Above 1.0 means
      // he does more damage on return than he concedes on serve.
      dr: (rpw != null && spw != null && spw < 1) ? Math.round(rpw / (1 - spw) * 100) / 100 : null,
    };
    rows[label] = {
      M, W, L,
      winPct: pct(W, M),
      setW, setL, setPct: pct(setW, setTot),
      gameW, gameL, gamePct: pct(gameW, gameTot),
      tbW, tbL, tbPct: pct(tbW, tbTot),
      ...(serve || { MS: 0 }),
    };
  }
  return rows;
}

// ---- resolve current-ATP full names ----------------------------------------
async function loadCurrRank() {
  const { body } = await get('https://www.tennisabstract.com/jsplayers/curr_rank_atp.js');
  const m = body.match(/currRank\s*=\s*(\{[\s\S]*?\});/);
  return JSON.parse(m[1]); // { "Full Name": "rank" }
}

async function main() {
  if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true });
  const profiles = JSON.parse(fs.readFileSync(PROFILES, 'utf8')).players;
  const currRank = await loadCurrRank();

  // index currRank by (initial, surname)
  const idx = new Map();
  // Secondary index on EVERY given-name initial, not just the first. The tour
  // abbreviates some players by a middle name -- Adolfo Daniel Vallejo (rank 71)
  // plays as "D. Vallejo" -- so a first-initial-only join misses them entirely.
  const altIdx = new Map();
  for (const [full, rk] of Object.entries(currRank)) {
    const t = normKey(full).split(' ');
    if (t.length < 2) continue;
    const surname = t[t.length - 1];
    const key = t[0][0] + '|' + surname;
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push({ full, rank: +rk });
    for (const given of t.slice(0, -1)) {
      const aKey = given[0] + '|' + surname;
      if (!altIdx.has(aKey)) altIdx.set(aKey, []);
      altIdx.get(aKey).push({ full, rank: +rk });
    }
  }

  // build the work list: profile -> matched full name + rank, filtered/sorted
  const work = [];
  for (const [pkey, p] of Object.entries(profiles)) {
    const t = normKey(String(p.name).replace(/\./g, ' ')).split(' ').filter(Boolean);
    if (t.length < 2) continue;
    const lookup = t[0][0] + '|' + t[t.length - 1];
    let cands = idx.get(lookup);
    if (!cands || !cands.length) {
      // Fall back to the middle-name index, but only when it names exactly one
      // player. Two same-surname candidates (A. Zverev / M. Zverev) would be a
      // guess, and a wrong join silently shows another man's career.
      const alt = altIdx.get(lookup) || [];
      const uniq = [...new Map(alt.map(c => [c.full, c])).values()];
      if (uniq.length !== 1) continue;
      cands = uniq;
    }
    cands.sort((a, b) => a.rank - b.rank);
    const hit = cands[0];
    if (hit.rank > RANK_MAX) continue;
    work.push({ pkey, name: p.name, full: hit.full, rank: hit.rank, id: taId(hit.full) });
  }
  work.sort((a, b) => a.rank - b.rank);
  const targets = work.slice(0, MAX_PLAYERS);
  console.log(`Resolved ${work.length} profiles to current ATP; ingesting ${targets.length} (rank<=${RANK_MAX}).`);

  const players = {};
  let ok = 0, miss = 0, empty = 0, cached = 0, fetched = 0, staleFallback = 0;
  // Why fetches failed, tallied by reason. Without this a total failure just
  // reports "ingested 0" and gives no way to tell a TA block (403) from a
  // rate-limit (429) from a network fault — they need opposite fixes.
  const why = new Map();
  const note = r => why.set(r, (why.get(r) || 0) + 1);
  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const t = targets[cursor++];
      const cacheFile = path.join(CACHE, t.id + '.html');
      let html = null;
      try {
        const st = fs.existsSync(cacheFile) ? fs.statSync(cacheFile) : null;
        const usable = st && st.size > 5000;
        if (usable && Date.now() - st.mtimeMs < CACHE_TTL_MS) {
          html = fs.readFileSync(cacheFile, 'utf8');
          cached++;
        } else {
          const url = `https://www.tennisabstract.com/cgi-bin/player-classic.cgi?p=${t.id}`;
          for (let attempt = 0; attempt < 4 && !html; attempt++) {
            await sleep(BASE_DELAY_MS + attempt * 1200);
            let status, body;
            try { ({ status, body } = await get(url)); } catch (e) { note(`net:${e.code || e.message}`); continue; }
            if (status === 200 && body.includes('var matchmx')) { html = body; fs.writeFileSync(cacheFile, body); fetched++; }
            else if (status === 429) { note('429'); await sleep(2500 * (attempt + 1)); }
            else { note(status === 200 ? '200-no-matchmx' : `http:${status}`); break; } // real 404 (name mismatch) — don't hammer
          }
          // TA throttles sustained fetching, so a refetch can fail for a player
          // we already have a page for. Serving that stale page keeps his splits
          // one day old; dropping him removes his table from the site entirely.
          // Stale beats missing.
          if (!html && usable) { html = fs.readFileSync(cacheFile, 'utf8'); staleFallback++; }
        }
      } catch (e) { /* network */ }
      if (!html) { miss++; continue; }
      const matches = parseMatches(html).filter(isTourLevel);
      if (!matches.length) { empty++; continue; }
      const cut52 = cutoff52(matches);
      const last52 = matches.filter(m => daysAgoStamp(m.date, cut52));
      players[t.pkey] = {
        taId: t.id, fullName: t.full, rank: t.rank,
        matchesParsed: matches.length, last52Count: last52.length, cutoff52: cut52,
        career: splits(matches),
        last52: splits(last52),
      };
      ok++;
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const out = {
    fetchedAt: TODAY,
    source: 'Jeff Sackmann ATP match data via tennisabstract.com player-classic (matchmx)',
    window52Rule: 'per player: 364 days before that player\'s most recent tour match (matches tennisabstract)',
    categories: CATEGORIES.map(c => c[0]),
    columns: [
      'M', 'W', 'L', 'winPct', 'setW', 'setL', 'setPct', 'gameW', 'gameL', 'gamePct',
      'tbW', 'tbL', 'tbPct', 'MS', 'hldPct', 'brkPct', 'aPct', 'dfPct', 'firstInPct',
      'firstWonPct', 'secondWonPct', 'spwPct', 'rpwPct', 'tpwPct', 'dr',
    ],
    // Serve columns are measured over MS, not M: they exist only for matches
    // where the source recorded serve counters (~98% since 2025, ~74% career).
    // A row with MS=0 carries no serve keys at all and must render as dashes.
    statsRule: 'serve/return columns are averaged over MS (matches with recorded stats), never over M; absent = no stats recorded, not zero',
    coverage: { ingested: ok, noPage: miss, noMatches: empty, attempted: targets.length, fetched, fromCache: cached, staleFallback },
    players,
  };
  // A run where every fetch failed (egress blocked, TA down) must not overwrite
  // a good file with an empty one.
  const whyStr = [...why.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} x${n}`).join(', ') || 'none';
  if (!ok) {
    console.error(`ERROR: ingested 0 of ${targets.length} players — leaving ${path.basename(OUT)} untouched.`);
    console.error(`Fetch failures: ${whyStr}`);
    process.exit(1);
  }
  if (why.size) console.log(`Fetch failures: ${whyStr}`);
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`career-splits.json: ${ok} ingested / ${miss} no-page / ${empty} empty (${fetched} fetched, ${cached} cached, ${staleFallback} served stale after failed refetch). 52wk window is per-player.`);
  // A build that fetched nothing is a replay of the cache, not a refresh.
  if (ok && !fetched) console.warn('WARNING: every page came from cache — no fresh data. Check SPLITS_CACHE_TTL_HOURS.');
}

main().catch(e => { console.error(e); process.exit(1); });
