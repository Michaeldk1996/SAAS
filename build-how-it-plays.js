// "How it plays" — per-event serve/tiebreak profile vs the ATP hard-court tour (founder brief round 2, item 2.1)
// =============================================================================
// For every ATP hard-court event (keyed by the api-tennis tournament_key — the match card's `tournamentKey`), five
// figures, each a POOLED ratio over the matches that qualify, each carrying n (matches) and its own denominator:
//
//   hold            service games held % = Σ(SvGms − (bpFaced − bpSaved)) / ΣSvGms
//                   (api-tennis: raw['Games:Service games won'] won / total — the same count, measured directly)
//   firstServeWon   1st-serve points won % = Σ1stWon / Σ1stIn
//   secondServeWon  2nd-serve points won % = Σ2ndWon / Σ(svpt − 1stIn)   (double faults are in the denominator;
//                   api-tennis raw['Service:2nd serve points won'].total is the same definition, 92.4% exact on the
//                   2024 overlap)
//   acesPerMatch    Σaces (both players) / matches
//   tiebreaksPerSet sets that went to a tiebreak / completed sets. Sackmann: a 7-6 / 6-7 set (career-backfill.js
//                   parseSetScores). api-tennis box scores: a set whose point-by-point log reached 6-6 (the feed's
//                   tiebreak rows are unreliable since TEN-318; "reached 6-6" is the reliable test). Progression: a
//                   7-6 / 6-7 set in the feed's own set score. A match with any set side >= 10 is a match tiebreak
//                   (build-series.js super-tiebreak rule) and leaves THIS metric only (counted, `nonStandardSets`).
//
// POPULATION (all three slices: event past, event current, tour baseline)
//   · ATP main draw only. api-tennis: build-event-hold.js isQualifying (the entry's own `q`, else
//     boxscore-qualifying.json, else the name). Sackmann atp_matches files are main draw by construction.
//   · Best-of-three only. Out: Grand Slams, the Tour Finals and Next Gen Finals (anything named "Finals"; Next Gen
//     also by altFormatOf key 2793 / altFormatForTourneyId 7696), the Olympics, and team events (Davis, United,
//     ATP, Laver, Hopman Cup — the market-edge-core.js FMT_NONSTD list). Sackmann: levels A and M only, best_of 3.
//   · Completed matches only — walkovers, retirements and defaults are out. Sackmann: the score string. api-tennis
//     box scores carry no status, so: (1) the Tennis-Data row the match joins to (committed odds-archive/, surname
//     pair within ±2 days, its `comment`), else (2) the set scores rebuilt from the per-set service-game counts
//     (complete = every set ends at a legal score and the sets add up to a two-set win; checked against Tennis-Data:
//     3,668 of 3,693 completed matches pass, 0 of 154 retirements do), else (3) unknown → out, counted.
//     Progression: status 'finished'.
//   · PARTIAL-STATS GUARD (api-tennis only): a match whose box score covers only part of the match is out — its
//     regular games in the point-by-point log (or, for a progression row, in the set score: Σ min(games, 12) per set)
//     exceed its service games on record by PARTIAL_GAP (3) or more. Flagged matches are counted per slice
//     (`excludedPartial`) for the tooltip; nothing is imputed.
//   · A match needs BOTH players' serve counts (and aces) to enter the four serve metrics; the tiebreak metric needs
//     only the set scores.
//
// SEASONS AND SOURCES
//   · Seasons 2016–2024: Sackmann atp_matches, reduced LOCALLY to how-it-plays-history.json by
//     tools/build-how-it-plays-history.js (the pinned copy is not in the repo or CI; input checksums are recorded
//     there). Seasons >= ARCHIVE_FIRST_SEASON (2025): the committed boxscore-archive/, every run. 2024 box scores
//     (Mar–Dec) exist too but are NOT read: one source per season.
//   · Tour baseline = the last BASELINE_SEASONS (10) completed seasons before the current one (2016–2025 in 2026).
//   · Event past = every edition in the same window. Event current = the current season's edition: box scores on
//     file plus tournament-progression.json's main-draw rows (box score wins on the same event key).
//
// INDOOR / OUTDOOR
//   · Event: tournament-surfaces.json `courts[key]` (api-tennis "Hard (Indoor)", bsp-pipeline isIndoorTournament).
//     Key absent → indoor null, baseline null (the UI prints no comparison), listed in `unresolved`.
//   · Baseline rows: api-tennis seasons by the same courts map; Sackmann seasons by the Tennis-Data `court` column
//     of the edition (majority of joined matches; see the history file's `coverage`). Unknown court → in neither.
//
// EVENT LINEAGE — SAME VENUE ONLY (founder ruling round 2)
//   · Box-score seasons: the event's own tournament_key (so the old clay Lyon, key 2752, can never feed the 2026
//     indoor-hard Lyon, key 14763; Astana / Nur-Sultan never had an Almaty key).
//   · Sackmann seasons: an edition belongs to key K when its venue name (tourney_name, " Masters" and a trailing
//     edition digit stripped, letters only) equals a name K carries (archive `tn` or the card's tour, "ATP " stripped),
//     AND its surface is hard, AND its Tennis-Data court agrees with K's courts entry when both are known. A name that
//     two hard keys share is ambiguous → no Sackmann lineage for either (a dash, never a guess). So Almaty takes
//     Sackmann "Almaty" 2024 but not "Nur-Sultan" / "Astana" (same ATP id 9410); Brussels takes nothing from
//     "Antwerp" (ATP id 7485); Lyon 14763 takes nothing (the Sackmann "Lyon" is clay).
//
// OUTPUT how-it-plays.json (published by pipeline.yml, never committed):
//   { v, builtAt, season, floor, partialGap, seasons:{baseline:[from,to]}, metricsDef,
//     baseline: { indoorHard: SLICE, outdoorHard: SLICE },
//     events: { <tournament_key>: { name, surface:'hard', indoor:true|false|null, baseline:'indoorHard'|'outdoorHard'|null,
//                                    past: SLICE|null, current: SLICE|null, excludedPartial } },
//     unresolved: [{ key, name, reason }], counts: {...} }
//   SLICE = { years:[...], n, excludedPartial, statusUnknown, sources:{ sackmann:[years], boxscore:[years], progression:k },
//             metrics: { hold|firstServeWon|secondServeWon|acesPerMatch|tiebreaksPerSet: { value, n, num, den } } }
//   value = num/den (unrounded; null when den is 0). n = matches behind that metric. The floor (SAMPLE_FLOOR) is
//   carried, never applied: every number ships and the UI dashes below it.
// =============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { isQualifying, cleanName } = require('./build-event-hold.js');
const { altFormatOf } = require('./build-series.js');
const { altFormatForTourneyId, _internal: { parseSetScores } } = require('./career-backfill.js');

const SAMPLE_FLOOR = 15;
const PARTIAL_GAP = 3;
const BASELINE_SEASONS = 10;
const SACKMANN_LAST_SEASON = 2024;
const ARCHIVE_FIRST_SEASON = 2025;
const METRICS = ['hold', 'firstServeWon', 'secondServeWon', 'acesPerMatch', 'tiebreaksPerSet'];
const METRICS_DEF = {
  hold: { num: 'service games held', den: 'service games' },
  firstServeWon: { num: '1st-serve points won', den: '1st-serve points' },
  secondServeWon: { num: '2nd-serve points won', den: '2nd-serve points (incl. double faults)' },
  acesPerMatch: { num: 'aces (both players)', den: 'matches' },
  tiebreaksPerSet: { num: 'tiebreak sets', den: 'completed sets' },
};

const ROOT = __dirname;
const P = {
  history: path.join(ROOT, 'how-it-plays-history.json'),
  archive: path.join(ROOT, 'boxscore-archive'),
  qflags: path.join(ROOT, 'boxscore-qualifying.json'),
  surfaces: path.join(ROOT, 'tournament-surfaces.json'),
  progression: path.join(ROOT, 'tournament-progression.json'),
  matches: path.join(ROOT, 'matches.json'),
  oddsArchive: path.join(ROOT, 'odds-archive'),
  out: path.join(ROOT, 'how-it-plays.json'),
};

// ── population ───────────────────────────────────────────────────────────────────────────────────────────────────
const SLAM_RE = /\b(australian open|french open|roland[\s-]?garros|wimbledon|us open)\b/i;   // build-series.js SLAM_RE
const NON_BO3_RE = /finals|olympic|davis cup|united cup|atp cup|laver cup|hopman cup|next ?gen|\buts\b/i;
function excludedEventName(name) { return SLAM_RE.test(String(name || '')) || NON_BO3_RE.test(String(name || '')); }
function excludedApiEvent(tk, tn) { return !!altFormatOf({ tournament_key: tk }) || excludedEventName(tn); }
function excludedSackmannRow(r) {
  if (r.tourney_level !== 'A' && r.tourney_level !== 'M') return true;
  if (String(r.best_of) !== '3') return true;
  if (altFormatForTourneyId(r.tourney_id)) return true;
  return excludedEventName(r.tourney_name);
}

// ── sums ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function emptySums() { return { m: 0, held: 0, sg: 0, fw: 0, fi: 0, sw: 0, sp: 0, ace: 0, tm: 0, tb: 0, sets: 0, nonStd: 0, partial: 0, unknown: 0, incomplete: 0 }; }
function addSums(a, b) { const o = Object.assign({}, a); for (const k of Object.keys(b)) o[k] = (o[k] || 0) + b[k]; return o; }

// rec = { completed: true|false|null, partial: bool, stats: {held,sg,fw,fi,sw,sp,ace}|null, sets: [{tb, nonStd}]|null }
function addRec(S, rec) {
  if (rec.completed === null) { S.unknown++; return S; }
  if (!rec.completed) { S.incomplete++; return S; }
  if (rec.partial) { S.partial++; return S; }
  if (rec.stats) {
    const s = rec.stats;
    S.m++; S.held += s.held; S.sg += s.sg; S.fw += s.fw; S.fi += s.fi; S.sw += s.sw; S.sp += s.sp; S.ace += s.ace;
  }
  if (rec.sets && rec.sets.length) {
    if (rec.sets.some(x => x.nonStd)) S.nonStd++;
    else { S.tm++; S.sets += rec.sets.length; S.tb += rec.sets.filter(x => x.tb).length; }
  }
  return S;
}

function metric(num, den, n) { return { value: den > 0 ? num / den : null, n, num, den }; }
function metricsOf(S) {
  return {
    hold: metric(S.held, S.sg, S.m),
    firstServeWon: metric(S.fw, S.fi, S.m),
    secondServeWon: metric(S.sw, S.sp, S.m),
    acesPerMatch: metric(S.ace, S.m, S.m),
    tiebreaksPerSet: metric(S.tb, S.sets, S.tm),
  };
}

// ── Sackmann row → rec (used by tools/build-how-it-plays-history.js; one derivation) ─────────────────────────────
const num = v => (v === '' || v == null || !Number.isFinite(+v)) ? null : +v;
function sackmannRec(r) {
  const score = String(r.score || '').trim();
  const completed = !!score && !/RET|W\/O|DEF|Def|ABD|unfinished|In Progress|Walkover/i.test(score);
  const side = p => {
    const ace = num(r[p + 'ace']), svpt = num(r[p + 'svpt']), fi = num(r[p + '1stIn']), fw = num(r[p + '1stWon']),
      sw = num(r[p + '2ndWon']), sg = num(r[p + 'SvGms']), bps = num(r[p + 'bpSaved']), bpf = num(r[p + 'bpFaced']);
    if ([ace, svpt, fi, fw, sw, sg, bps, bpf].some(v => v === null)) return null;
    const held = sg - (bpf - bps);
    if (sg <= 0 || bpf < bps || held < 0 || fi > svpt || fw > fi || sw > svpt - fi) return null;
    return { held, sg, fw, fi, sw, sp: svpt - fi, ace };
  };
  const w = side('w_'), l = side('l_');
  const stats = w && l ? { held: w.held + l.held, sg: w.sg + l.sg, fw: w.fw + l.fw, fi: w.fi + l.fi, sw: w.sw + l.sw, sp: w.sp + l.sp, ace: w.ace + l.ace } : null;
  const ss = parseSetScores(score);
  const sets = ss ? ss.map(s => ({ tb: (s.p === 7 && s.o === 6) || (s.p === 6 && s.o === 7), nonStd: Math.max(s.p, s.o) >= 10 })) : null;
  return { completed, partial: false, stats, sets };
}

// ── api-tennis box-score entry → rec ─────────────────────────────────────────────────────────────────────────────
const SG = 'Games:Service games won', F1 = 'Service:1st serve points won', F2 = 'Service:2nd serve points won';
function rawOf(side, k) { const r = side && side.raw && side.raw[k]; return r && Number.isFinite(r.won) && Number.isFinite(r.total) && r.total >= 0 && r.won >= 0 && r.won <= r.total ? r : null; }
function boxSide(side) {
  const sg = rawOf(side, SG), f1 = rawOf(side, F1), f2 = rawOf(side, F2), ace = side && side['Service:Aces'];
  if (!sg || sg.total <= 0 || !f1 || !f2 || !Number.isInteger(ace) || ace < 0) return null;
  return { held: sg.won, sg: sg.total, fw: f1.won, fi: f1.total, sw: f2.won, sp: f2.total, ace };
}
const GAME_RE = /^\s*(\d+)\s*-\s*(\d+)\s*$/;
// Regular games in the point-by-point log: per set, the distinct cumulative game totals 1..12 (a tiebreak row that
// reads as a game score collapses onto a total already seen). Research guard2.js, unchanged.
function pbpRegularGames(e) {
  let n = 0;
  for (const s of (e && e.sets) || []) {
    const totals = new Set();
    for (const g of s.games || []) { const m = GAME_RE.exec(g.score || ''); if (!m) continue; const t = +m[1] + +m[2]; if (t >= 1 && t <= 12) totals.add(t); }
    n += totals.size;
  }
  return n;
}
function pbpSets(e) {
  const out = [];
  for (const s of (e && e.sets) || []) {
    const gs = (s.games || []).filter(g => g && GAME_RE.test(g.score || ''));
    if (!gs.length) continue;
    out.push({ tb: gs.some(g => { const m = GAME_RE.exec(g.score); return +m[1] === 6 && +m[2] === 6; }), nonStd: false });
  }
  return out.length ? out : null;
}
// Set scores rebuilt from per-set service-game counts: p1 games = p1 holds + p2 breaks-of-serve suffered.
function perSetScores(e) {
  const st = (e && e.stats) || {};
  const ks = Object.keys(st).filter(k => /^\d+$/.test(k)).sort((a, b) => a - b);
  if (!ks.length) return null;
  const out = [];
  for (const k of ks) {
    const a = rawOf(st[k] && st[k].p1, SG), b = rawOf(st[k] && st[k].p2, SG);
    if (!a || !b) return null;
    out.push([a.won + (b.total - b.won), b.won + (a.total - a.won)]);
  }
  return out;
}
const legalSet = ([x, y]) => { const hi = Math.max(x, y), lo = Math.min(x, y); return (hi === 6 && lo <= 4) || (hi === 7 && (lo === 5 || lo === 6)) || (hi === 6 && lo === 6); };
const tbSet = ([x, y]) => Math.min(x, y) === 6 && Math.max(x, y) <= 7;
function completedFromSets(ss) {
  if (!ss || ss.length < 2 || ss.length > 3 || !ss.every(legalSet)) return null;
  const w = ss.map(s => tbSet(s) ? 0 : (s[0] > s[1] ? 1 : 2));
  if (ss.length === 2) return !(w[0] && w[1] && w[0] !== w[1]) ? true : null;
  return !(w[0] && w[1] && w[0] === w[1]) ? true : null;
}
// status: 'Completed' | other Tennis-Data comment | null (no row)
function boxRec(e, tdComment) {
  const ms = e.matchStats || {};
  const a = boxSide(ms.p1), b = boxSide(ms.p2);
  const stats = a && b ? { held: a.held + b.held, sg: a.sg + b.sg, fw: a.fw + b.fw, fi: a.fi + b.fi, sw: a.sw + b.sw, sp: a.sp + b.sp, ace: a.ace + b.ace } : null;
  let completed;
  if (tdComment != null) completed = tdComment === 'Completed';
  else completed = completedFromSets(perSetScores(e));   // true or null — never a guessed false
  const sgTot = rawOf(ms.p1, SG) && rawOf(ms.p2, SG) ? rawOf(ms.p1, SG).total + rawOf(ms.p2, SG).total : null;
  const partial = stats != null && sgTot != null && pbpRegularGames(e) - sgTot >= PARTIAL_GAP;
  return { completed, partial, stats, sets: pbpSets(e) };
}

// ── tournament-progression.json match → rec ──────────────────────────────────────────────────────────────────────
// Each match's per-player metrics live in players[].rounds[] (by round label + playerKey). A player's 1st-serve
// counts are his opponent's ret1 inverted (won = total − opponent's won): exact counts, not rebuilt from a %.
function progressionRecs(ev) {
  const byPR = new Map();
  for (const p of (ev && ev.players) || []) for (const r of p.rounds || []) byPR.set(r.round + '|' + p.playerKey, r.metrics || null);
  const out = [];
  for (const m of (ev && ev.matches) || []) {
    const A = byPR.get(m.round + '|' + (m.p1 && m.p1.playerKey)), B = byPR.get(m.round + '|' + (m.p2 && m.p2.playerKey));
    const ok = x => x && x.total > 0 && Number.isFinite(x.won) && x.won >= 0 && x.won <= x.total;
    const inv = x => ({ won: x.total - x.won, total: x.total });
    let stats = null;
    if (A && B && ok(A.svHold) && ok(B.svHold) && ok(A.ret1) && ok(B.ret1) && ok(A.ret2) && ok(B.ret2) && Number.isInteger(A.aces) && Number.isInteger(B.aces)) {
      const fa = inv(B.ret1), fb = inv(A.ret1), sa = inv(B.ret2), sb = inv(A.ret2);
      stats = { held: A.svHold.won + B.svHold.won, sg: A.svHold.total + B.svHold.total, fw: fa.won + fb.won, fi: fa.total + fb.total,
        sw: sa.won + sb.won, sp: sa.total + sb.total, ace: A.aces + B.aces };
    }
    const sc = Array.isArray(m.score) ? m.score.filter(s => Array.isArray(s) && s.length === 2 && s.every(Number.isFinite)) : [];
    const sets = sc.length ? sc.map(([x, y]) => ({ tb: (x === 7 && y === 6) || (x === 6 && y === 7), nonStd: Math.max(x, y) >= 10 })) : null;
    const regular = sc.reduce((t, [x, y]) => t + Math.min(x + y, 12), 0);
    const partial = stats != null && sc.length > 0 && regular - stats.sg >= PARTIAL_GAP;
    out.push({ ek: m.eventKey != null ? String(m.eventKey) : null, date: m.date || null, rec: { completed: m.status === 'finished', partial, stats, sets } });
  }
  return out;
}

// ── Tennis-Data status join (odds-archive/<season>.csv) ──────────────────────────────────────────────────────────
const letters = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
// api-tennis "B. Van De Zandschulp" / "J. A. Rodriguez" → surname letters
function surnameApi(n) { const t = String(n || '').trim().split(/\s+/); while (t.length > 1 && /^[A-Za-z]{1,2}([.-][A-Za-z]{1,2})*\.$/.test(t[0])) t.shift(); return letters(t.join('')); }
// Tennis-Data "Davidovich Fokina A." → surname letters
function surnameTD(n) { const t = String(n || '').trim().split(/\s+/); while (t.length > 1 && /\.$/.test(t[t.length - 1])) t.pop(); return letters(t.join('')); }
const dayN = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : null; };
function readCsv(file) {
  const L = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const h = L[0].split(',');
  return L.slice(1).map(l => { const c = l.split(','); const o = {}; h.forEach((k, i) => { o[k] = c[i]; }); return o; });
}
function tdIndex(rows) {
  const idx = new Map();
  for (const r of rows) {
    const a = surnameTD(r.winner), b = surnameTD(r.loser), d = dayN(r.date);
    if (!a || !b || d == null) continue;
    const k = [a, b].sort().join('|');
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push({ d, comment: r.comment, court: r.court, surface: r.surface, tournament: r.tournament });
  }
  return idx;
}
// The single Tennis-Data row for this pair within ±2 days, or null (none, or two — never a guess).
function tdLookup(idx, n1, n2, date) {
  const a = surnameApi(n1), b = surnameApi(n2), d = dayN(date);
  if (!a || !b || d == null) return null;
  const c = (idx.get([a, b].sort().join('|')) || []).filter(r => Math.abs(r.d - d) <= 2);
  return c.length === 1 ? c[0] : null;
}

// ── lineage ──────────────────────────────────────────────────────────────────────────────────────────────────────
function venueName(n) { return letters(String(n || '').replace(/^ATP\s+/i, '').replace(/\s+Masters$/i, '').replace(/\s+\d$/, '')); }

// keys: { [key]: { names:Set<string>, indoor:true|false|null } } (hard keys only). editions: history editions.
// Returns { [key]: edition[] }, plus the ambiguous names.
function sackmannLineage(keys, editions) {
  const byName = new Map();
  for (const [k, o] of Object.entries(keys)) for (const n of o.names) { const v = venueName(n); if (!v) continue; if (!byName.has(v)) byName.set(v, new Set()); byName.get(v).add(k); }
  const out = {}, ambiguous = new Set(), courtMismatch = [];
  for (const ed of editions) {
    if (ed.surface !== 'Hard') continue;
    const ks = byName.get(venueName(ed.name));
    if (!ks) continue;
    if (ks.size > 1) { ambiguous.add(venueName(ed.name)); continue; }
    const k = [...ks][0];
    const ki = keys[k].indoor;
    if (ki != null && ed.indoor != null && ki !== ed.indoor) { courtMismatch.push({ key: k, edition: ed.id, name: ed.name }); continue; }
    (out[k] || (out[k] = [])).push(ed);
  }
  return { byKey: out, ambiguous: [...ambiguous].sort(), courtMismatch };
}

// ── slices ───────────────────────────────────────────────────────────────────────────────────────────────────────
function slice(parts) {
  // parts: [{ season, source:'sackmann'|'boxscore'|'progression', sums }]
  let S = emptySums();
  const src = { sackmann: new Set(), boxscore: new Set(), progression: 0 };
  const years = new Set();
  for (const p of parts) {
    S = addSums(S, p.sums);
    if (p.sums.m + p.sums.tm > 0) {
      years.add(p.season);
      if (p.source === 'progression') src.progression += p.count || 0; else src[p.source].add(p.season);
    }
  }
  if (!years.size && !(S.partial + S.unknown + S.incomplete)) return null;   // nothing seen at all
  return {
    years: [...years].sort((a, b) => a - b), n: S.m, excludedPartial: S.partial, statusUnknown: S.unknown,
    incompleteExcluded: S.incomplete, nonStandardSets: S.nonStd,
    sources: { sackmann: [...src.sackmann].sort(), boxscore: [...src.boxscore].sort(), progression: src.progression },
    metrics: metricsOf(S),
  };
}

// ── the build ────────────────────────────────────────────────────────────────────────────────────────────────────
// inp = { season, history, weeks:[{ek:entry}], qFlags, surfaces:{surfaces,courts}, progression, matches, tdRows:{[season]:rows} }
function buildHowItPlays(inp) {
  const season = inp.season;
  const from = season - BASELINE_SEASONS, to = season - 1;
  const surf = (inp.surfaces && inp.surfaces.surfaces) || {}, courts = (inp.surfaces && inp.surfaces.courts) || {};
  const indoorOf = k => courts[k] === 'indoor' ? true : courts[k] === 'outdoor' ? false : null;
  const counts = { boxscoreEntries: 0, qualifying: 0, otherTier: 0, excludedEvent: 0, notHard: 0, outOfWindow: 0, tdStatus: 0, perSetStatus: 0, statusUnknown: 0 };

  // Tennis-Data indexes, one per season read
  const tdIdx = {};
  for (const [y, rows] of Object.entries(inp.tdRows || {})) tdIdx[y] = tdIndex(rows);

  // 1 · box scores → per key per season sums (seasons >= ARCHIVE_FIRST_SEASON, window or current)
  const box = {};   // key -> season -> sums
  const keyNames = {};   // key -> Set(names)
  const boxEks = new Set();
  const seen = new Set();
  for (const week of inp.weeks || []) {
    for (const ek of Object.keys(week || {})) {
      if (seen.has(ek)) continue;
      seen.add(ek);
      const e = week[ek];
      if (!e || e.tk == null || !e.tn) continue;
      counts.boxscoreEntries++;
      if (e.t !== 'atp') { counts.otherTier++; continue; }
      if (isQualifying(ek, e, inp.qFlags)) { counts.qualifying++; continue; }
      const k = String(e.tk);
      if (excludedApiEvent(k, e.tn)) { counts.excludedEvent++; continue; }
      if (surf[k] !== 'hard') { counts.notHard++; continue; }
      const y = +String(e.d || '').slice(0, 4);
      if (!(y >= ARCHIVE_FIRST_SEASON && y >= from && y <= season)) { counts.outOfWindow++; continue; }
      (keyNames[k] || (keyNames[k] = new Set())).add(cleanName(e.tn));
      const td = tdIdx[y] ? tdLookup(tdIdx[y], e.p1, e.p2, e.d) : null;
      const rec = boxRec(e, td ? td.comment : null);
      if (td) counts.tdStatus++; else if (rec.completed) counts.perSetStatus++; else counts.statusUnknown++;
      const bk = box[k] || (box[k] = {});
      bk[y] = addRec(bk[y] || emptySums(), rec);
      boxEks.add(ek);
    }
  }

  // 2 · progression (current season only) → keyed through the match cards' tournamentKey
  const cardKeys = new Map();   // bare tour name -> Set(key)
  for (const m of inp.matches || []) {
    if (!m || m.tournamentKey == null || !m.tour) continue;
    const bare = String(m.tour).replace(/^ATP\s+/i, '').trim();
    if (!cardKeys.has(bare)) cardKeys.set(bare, new Set());
    cardKeys.get(bare).add(String(m.tournamentKey));
  }
  const cardName = {};
  for (const [bare, ks] of cardKeys) if (ks.size === 1) cardName[[...ks][0]] = bare;
  const prog = {};   // key -> { sums, count }
  const unresolved = [];
  for (const [pname, ev] of Object.entries((inp.progression && inp.progression.tournaments) || {})) {
    const ks = cardKeys.get(pname) || (ev && ev.feedName && cardKeys.get(String(ev.feedName).replace(/^ATP\s+/i, '').trim()));
    if (!ks || ks.size !== 1) { unresolved.push({ key: null, name: pname, reason: ks ? 'progression name maps to several tournament keys' : 'no match card carries this progression event\'s tournamentKey' }); continue; }
    const k = [...ks][0];
    if (excludedApiEvent(k, pname)) continue;
    if (surf[k] !== 'hard') { if (surf[k] == null) unresolved.push({ key: k, name: pname, reason: 'tournament key not in tournament-surfaces.json' }); continue; }
    (keyNames[k] || (keyNames[k] = new Set())).add(pname);
    let S = emptySums(), count = 0;
    for (const { ek, date, rec } of progressionRecs(ev)) {
      if (ek && boxEks.has(ek)) continue;   // the box score already counted it
      if (date && +String(date).slice(0, 4) !== season) continue;
      S = addRec(S, rec); count++;
    }
    prog[k] = { sums: S, count };
  }
  // every hard event on the board gets an entry, even before its first match is in (a new event reads "no past edition")
  for (const [k, n] of Object.entries(cardName)) {
    if (excludedApiEvent(k, n)) continue;
    if (surf[k] === 'hard') (keyNames[k] || (keyNames[k] = new Set())).add(n);
    else if (surf[k] == null && !unresolved.some(u => u.key === k)) unresolved.push({ key: k, name: n, reason: 'tournament key not in tournament-surfaces.json' });
  }

  // 3 · Sackmann editions (history file) → keys, same venue only
  const hist = inp.history || { seasons: {}, editions: [] };
  const hardKeys = {};
  for (const k of Object.keys(keyNames)) hardKeys[k] = { names: keyNames[k], indoor: indoorOf(k) };
  const lin = sackmannLineage(hardKeys, (hist.editions || []).filter(ed => ed.season >= from && ed.season <= to && ed.season <= SACKMANN_LAST_SEASON));

  // 4 · baseline
  const baseParts = { indoorHard: [], outdoorHard: [] };
  for (let y = from; y <= to; y++) {
    if (y <= SACKMANN_LAST_SEASON) {
      const s = hist.seasons && hist.seasons[y];
      if (s) { if (s.indoorHard) baseParts.indoorHard.push({ season: y, source: 'sackmann', sums: s.indoorHard }); if (s.outdoorHard) baseParts.outdoorHard.push({ season: y, source: 'sackmann', sums: s.outdoorHard }); }
    } else {
      const acc = { indoorHard: emptySums(), outdoorHard: emptySums() };
      let unknownCourt = 0;
      for (const [k, bySeason] of Object.entries(box)) {
        if (!bySeason[y]) continue;
        const ind = indoorOf(k);
        if (ind === null) { unknownCourt += bySeason[y].m; continue; }
        const b = ind ? 'indoorHard' : 'outdoorHard';
        acc[b] = addSums(acc[b], bySeason[y]);
      }
      counts['baselineUnknownCourt' + y] = unknownCourt;
      baseParts.indoorHard.push({ season: y, source: 'boxscore', sums: acc.indoorHard });
      baseParts.outdoorHard.push({ season: y, source: 'boxscore', sums: acc.outdoorHard });
    }
  }
  const baseline = { indoorHard: slice(baseParts.indoorHard), outdoorHard: slice(baseParts.outdoorHard) };

  // 5 · events
  const events = {};
  for (const k of Object.keys(keyNames).sort((a, b) => a - b)) {
    const ind = indoorOf(k);
    const pastParts = [];
    for (const ed of lin.byKey[k] || []) pastParts.push({ season: ed.season, source: 'sackmann', sums: ed.sums });
    for (const [y, S] of Object.entries(box[k] || {})) if (+y >= from && +y <= to) pastParts.push({ season: +y, source: 'boxscore', sums: S });
    const curParts = [];
    if (box[k] && box[k][season]) curParts.push({ season, source: 'boxscore', sums: box[k][season] });
    if (prog[k]) curParts.push({ season, source: 'progression', sums: prog[k].sums, count: prog[k].count });
    const past = slice(pastParts), current = slice(curParts);
    if (ind === null) unresolved.push({ key: k, name: cardName[k] || [...keyNames[k]][0], reason: 'no indoor/outdoor entry in tournament-surfaces.json courts — no baseline' });
    events[k] = {
      name: cardName[k] || latestName(keyNames[k]),
      surface: 'hard', indoor: ind, courtSource: ind === null ? null : 'tournament-surfaces.json courts',
      baseline: ind === null ? null : ind ? 'indoorHard' : 'outdoorHard',
      past, current,
      excludedPartial: (past ? past.excludedPartial : 0) + (current ? current.excludedPartial : 0),
    };
  }

  return {
    v: 1, season, floor: SAMPLE_FLOOR, partialGap: PARTIAL_GAP,
    seasons: { baseline: [from, to], sackmannThrough: SACKMANN_LAST_SEASON, boxscoreFrom: ARCHIVE_FIRST_SEASON },
    population: 'ATP main draw, best-of-three (no Slams, Finals, Next Gen, Olympics or team events), completed matches, hard courts',
    metricsDef: METRICS_DEF,
    baseline, events,
    lineage: { ambiguousNames: lin.ambiguous, courtMismatch: lin.courtMismatch },
    unresolved, counts,
  };
}
function latestName(set) { const a = [...(set || [])]; return a.length ? a[a.length - 1] : null; }

// ── I/O ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function readJson(p, dflt) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return dflt; } }
function readWeeks(dir) {
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => /^265-\d{4}-\d{2}-\d{2}\.json\.gz$/.test(f)).sort() : [];
  return files.map(f => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString('utf8')));
}
function main() {
  const season = process.env.HOWPLAYS_SEASON ? +process.env.HOWPLAYS_SEASON : new Date().getUTCFullYear();
  const history = readJson(P.history, null);
  if (!history) { console.error('how-it-plays: how-it-plays-history.json missing/unreadable — nothing written'); process.exit(1); }
  const weeks = readWeeks(P.archive);
  if (!weeks.length) { console.error('how-it-plays: no box-score archive — nothing written'); process.exit(1); }
  const qf = readJson(P.qflags, null);
  const tdRows = {};
  for (let y = ARCHIVE_FIRST_SEASON; y <= season; y++) { const f = path.join(P.oddsArchive, y + '.csv'); if (fs.existsSync(f)) tdRows[y] = readCsv(f); }
  const out = Object.assign({ builtAt: new Date().toISOString() }, buildHowItPlays({
    season, history, weeks, qFlags: qf ? qf.q : null,
    surfaces: readJson(process.env.HOWPLAYS_SURFACES || P.surfaces, {}),
    progression: readJson(process.env.HOWPLAYS_PROGRESSION || P.progression, null),
    matches: readJson(process.env.HOWPLAYS_MATCHES || P.matches, []),
    tdRows,
  }), { historyInputs: history.inputs || null });
  const tmp = P.out + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out));
  fs.renameSync(tmp, P.out);
  const ev = Object.values(out.events);
  const b = out.baseline;
  console.log(`how-it-plays: ${ev.length} hard events (${ev.filter(e => e.current).length} with a ${season} edition), baseline ${out.seasons.baseline.join('–')} ` +
    `indoor n=${b.indoorHard ? b.indoorHard.n : 0} outdoor n=${b.outdoorHard ? b.outdoorHard.n : 0}, ${out.unresolved.length} unresolved`);
}

module.exports = {
  buildHowItPlays, sackmannRec, boxRec, progressionRecs, pbpRegularGames, pbpSets, perSetScores, completedFromSets,
  addRec, emptySums, addSums, metricsOf, sackmannLineage, venueName, excludedSackmannRow, excludedApiEvent, excludedEventName,
  tdIndex, tdLookup, surnameTD, readCsv, slice,
  SAMPLE_FLOOR, PARTIAL_GAP, BASELINE_SEASONS, SACKMANN_LAST_SEASON, ARCHIVE_FIRST_SEASON, METRICS,
};
if (require.main === module) main();
