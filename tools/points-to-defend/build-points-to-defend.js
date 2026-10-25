'use strict';
/**
 * build-points-to-defend.js — the tournament page's "Points to defend" block (founder brief round 2, item 2.3).
 *
 * For every current / upcoming ATP main-tour event, the players who earned ranking points at LAST YEAR's edition,
 * resolved fresh from api-tennis fixtures through the shared points engine (tools/points-at-risk/points-resolver.js
 * + round-classify.js, fixed here for errors 1–3), with each defender's live rank and his status at THIS year's event.
 * Points at Risk stays retired: this neither reads nor serves points-at-risk.json.
 *
 * OUTPUT points-to-defend.json (schema in SCHEMA below; atomic temp + rename).
 *   events keyed "<name-key>-<season>" of the TARGET (this year's) event, e.g. "almaty-2026", "brussels-2026".
 *   Why not atpId alone: the entry-list source (ticktock) carries no atpId (Stockholm 2026 is known only there), the
 *   tier map has no atpId for Brussels/Stockholm, and the tournament page itself joins events by name. atpId is a field
 *   when any source has it; `index` maps every alias (draw city, entry-list name, tier-map name) to the key.
 *
 * INPUTS
 *   --asof YYYY-MM-DD           default: today (UTC)
 *   --out PATH                  default: <repo>/points-to-defend.json
 *   --player-index PATH         player-index.json (api-tennis get_standings rank + country). Required.
 *   --draws PATH                default <repo>/draws.json        (protennislive sheets; slots carry api-tennis playerKey)
 *   --entry PATH                default <repo>/entry_lists_advance.json (ticktock acceptance lists)
 *   --entry-history DIR         optional: older entry_lists_advance.json versions (*.json) to union (backfill)
 *   --calendar PATH             default <repo>/tools/draws/calendar-2026.json
 *   --prev PATH                 default = --out (the previous output: entry-list memory + frozen statuses)
 *   --fixtures-dir DIR          offline: api-tennis fixtures as <tournament_key>-<season>.json ({result:[...]})
 *   --cache-dir DIR             online: where fetched fixtures are written (default: os.tmpdir())
 *   --only k1,k2                restrict to these event keys
 *   --entry-history may also be ONE file {snapshots:[…]} (the committed test fixture).
 * With no --fixtures-dir, fixtures are fetched from api-tennis get_fixtures (API_TENNIS_KEY), one call per prior
 * edition (tournament_key + its whole season): ~10 calls a run.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PAR = path.join(ROOT, 'tools', 'points-at-risk');
const { resolveEdition, MS_PER_WEEK, NON_ROUND_TIERS, mondayOf } = require(path.join(PAR, 'points-resolver.js'));
const { isPlayed } = require(path.join(PAR, 'round-integrity-qa.js'));
const { classifyRound, ROUND_RANK } = require(path.join(PAR, 'round-classify.js'));

const SCHEMA_VERSION = 1;
const DAY = 86400000;
const SCOPE_BACK_DAYS = 28;                 // a target event is in scope from 28 days before as-of onward
const GS = new Set(['Australian Open', 'French Open', 'Roland Garros', 'Wimbledon', 'US Open']);

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const dms = (d) => new Date(String(d) + 'T00:00:00Z').getTime();
/** name key: lower-case, accents stripped, letters/digits only ("Hüsler" → "husler"). */
const nk = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
/** api-tennis-style short name key from a full or short name: "Kamil Majchrzak" / "K. Majchrzak" → "kmajchrzak". */
function shortKey(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  if (/^[A-Z]\.(?:-[A-Z]\.)?\s/.test(s)) return nk(s[0] + s.replace(/^[A-Z]\.(?:-[A-Z]\.)?\s+/, ''));
  const parts = s.split(/\s+/);
  return parts.length < 2 ? nk(s) : nk(parts[0][0] + parts.slice(1).join(' '));
}

// ---- result labels ---------------------------------------------------------------------------------------------
const RESULT_OF = { W: 'Won', F: 'F', SF: 'SF', QF: 'QF', R16: 'R16', R32: 'R32', R64: 'R64', R128: 'R128' };
function resultOf(key) {
  if (!key) return null;
  if (/^Q_/.test(key)) return 'Q';
  return RESULT_OF[key] || key;
}
const DEPTH = { Won: 9, F: 7, SF: 6, QF: 5, R16: 4, R32: 3, R64: 2, R128: 1, Q: 0 };

// ---- one event's rows ------------------------------------------------------------------------------------------
/**
 * Resolve every player at the prior edition. Pure: no I/O.
 * @returns {{nonRound:boolean, rows:object[], zeroRows:object[], dashRows:object[], prior:object, dropDate:?string}}
 */
function resolvePriorEdition({ fixtures, tierEvent, season, pointsTable, people }) {
  const isGS = tierEvent ? tierEvent.tier === 'GrandSlam' : false;
  const fx = fixtures.map((f) => ({ ...f, isGrandSlam: isGS || GS.has(f.tournament_name || '') }));
  let main = 0; let finalDate = '';
  for (const f of fx) {
    if (!isPlayed(f) || !String(f.tournament_round || '').trim()) continue;
    const c = classifyRound({ tournamentRound: f.tournament_round, qualification: f.event_qualification, isGrandSlam: f.isGrandSlam, tournamentName: f.tournament_name, finalScore: f.event_final_result, status: f.event_status });
    if (!c.qualifying && ROUND_RANK[c.code] != null) { main++; if (f.event_date > finalDate) finalDate = f.event_date; }
  }
  const derivedDraw = main > 0 ? main + 1 : null;
  const tierInfo = tierEvent
    ? { tier: tierEvent.tier, confirmed: tierEvent.confirmed, confirmed_seasons: tierEvent.confirmed_seasons, season: String(season), draw_size: derivedDraw || tierEvent.draw_size_most_recent }
    : { tier: null, confirmed: false };
  const names = new Map();
  for (const f of fx) {
    if (f.first_player_key != null) names.set(String(f.first_player_key), f.event_first_player);
    if (f.second_player_key != null) names.set(String(f.second_player_key), f.event_second_player);
  }
  const rows = []; const zeroRows = []; const dashRows = [];
  let nonRoundCount = 0; let awardMs = null;
  for (const [pk, apiName] of names) {
    const r = resolveEdition({ editionFixtures: fx, playerKey: pk, tierInfo, pointsTable });
    if (r.reason === 'player has no fixtures at this edition') continue;
    if (r.flags.includes('non-round-event')) { nonRoundCount++; continue; }
    if (r.awardMs != null) awardMs = r.awardMs;
    const p = people(pk, apiName);
    const ll = r.flags.includes('lucky-loser');
    const qualified = r.flags.includes('qualifier-bonus');
    const result = resultOf(r.key);
    const row = {
      playerKey: pk, name: p.name, apiName: apiName || null, country: p.country, rank: p.rank,
      result,
      resultBadge: result == null ? null : (qualified ? `${result} | Q` : result),
      qualRound: r.qualRound || null,
      qualified, ll,
      mainPoints: r.dash ? null : (r.mainPoints === undefined ? null : r.mainPoints),
      qualifyingPoints: r.dash ? null : (r.qualPoints === undefined ? null : r.qualPoints),
      points: r.dash ? null : r.points,
      pointsComplete: !r.dash && !ll,
      dropDate: r.awardMs != null ? iso(r.awardMs + 52 * MS_PER_WEEK) : null,
      byeCorrected: r.flags.includes('bye-first-round-correction'),
      flags: r.flags,
    };
    if (r.dash) { row.dashReason = r.reason; dashRows.push(row); }
    else if (row.points === 0 && !ll) zeroRows.push(row);
    else rows.push(row);
  }
  const nonRound = nonRoundCount > 0 && !rows.length && !zeroRows.length && !dashRows.length;
  const byPoints = (a, b) => ((b.points == null ? -1 : b.points) - (a.points == null ? -1 : a.points))
    || ((DEPTH[b.result] || 0) - (DEPTH[a.result] || 0))
    || ((a.rank == null ? 1e9 : a.rank) - (b.rank == null ? 1e9 : b.rank))
    || String(a.name).localeCompare(String(b.name));
  rows.sort(byPoints); zeroRows.sort(byPoints); dashRows.sort(byPoints);
  // header drop date = the latest main-draw drop date (every row now carries the edition's own date)
  const mainDrops = rows.concat(zeroRows).filter((r) => r.result !== 'Q' && r.dropDate).map((r) => r.dropDate).sort();
  return {
    nonRound,
    rows, zeroRows, dashRows,
    dropDate: nonRound ? null : (mainDrops.length ? mainDrops[mainDrops.length - 1] : null),
    prior: {
      season: Number(season), apiTennisName: fx[0] ? fx[0].tournament_name : null,
      tournamentKey: fx[0] ? Number(fx[0].tournament_key) : null,
      tier: tierInfo.tier, drawSize: derivedDraw, finalDate: finalDate || null,
      awardDate: awardMs != null ? iso(awardMs) : null, fixtures: fx.length,
    },
  };
}

// ---- status at this year's event -------------------------------------------------------------------------------
/**
 * Status of one defender at THIS year's edition.
 *   Playing      — keyed into the official draw sheet (main or qualifying)             statusBasis 'draw-sheet'
 *   Withdrew     — named in the sheet's withdrawals list                                'draw-sheet-withdrawal'
 *   Withdrew     — was on the Main Draw / Qualifying acceptance list in some snapshot, is not in the draw
 *                  (INFERRED: neither source records a withdrawal as such)          'entry-list-not-in-draw'
 *   Not entered  — only ever on the alternates list                                   'alternate-list-only'
 *   Not entered  — on no list we hold                                                 'not-on-entry-list'
 *   Entered      — on an acceptance list, draw not released yet                      'entry-list-draw-not-released'
 *   null         — the event has started but we hold no draw sheet for it             'draw-not-held'
 *   null         — no draw and no entry list for this event                           'no-source'
 */
function statusOf({ playerKey, apiName, fullName, draw, entrySeen, hasEntryList, started = false }) {
  const pk = String(playerKey);
  if (draw) {
    for (const sec of ['main', 'qualifying']) {
      const slot = ((draw[sec] && draw[sec].slots) || []).find((s) => s && !s.bye && String(s.playerKey) === pk);
      if (slot) return { status: 'Playing', statusBasis: 'draw-sheet', statusInferred: false, drawSection: sec, drawEntry: slot.entry || null };
    }
    const keys = new Set([shortKey(apiName), shortKey(fullName)].filter(Boolean));
    for (const sec of ['main', 'qualifying']) {
      for (const w of ((draw[sec] && draw[sec].withdrawals) || [])) {
        const m = String(w).match(/^(.*?)\s*(?:\((.*)\))?$/);
        if (m && keys.has(shortKey(m[1]))) return { status: 'Withdrew', statusBasis: 'draw-sheet-withdrawal', statusInferred: false, drawSection: sec, withdrawalReason: m[2] || null };
      }
    }
  }
  const seen = entrySeen && entrySeen[pk];
  const onAcceptance = seen && seen.sections.some((t) => /main|qualif/i.test(t));
  if (draw) {
    if (onAcceptance) return { status: 'Withdrew', statusBasis: 'entry-list-not-in-draw', statusInferred: true, listSections: seen.sections, listLastSeen: seen.lastSeen };
    if (seen) return { status: 'Not entered', statusBasis: 'alternate-list-only', statusInferred: true, listSections: seen.sections };
    return { status: 'Not entered', statusBasis: hasEntryList ? 'not-on-entry-list' : 'not-in-draw', statusInferred: false };
  }
  if (started) return { status: null, statusBasis: 'draw-not-held', statusInferred: false };
  if (onAcceptance) return { status: 'Entered', statusBasis: 'entry-list-draw-not-released', statusInferred: false, listSections: seen.sections };
  if (hasEntryList) return { status: 'Not entered', statusBasis: seen ? 'alternate-list-only' : 'not-on-entry-list', statusInferred: !!seen };
  return { status: null, statusBasis: 'no-source', statusInferred: false };
}

/** Union entry-list snapshots for one target week + city aliases into {playerKey: {sections, firstSeen, lastSeen}}. */
function mergeEntrySeen(base, snapshots, weekStart, aliases, nameToKey) {
  const out = JSON.parse(JSON.stringify(base || {}));
  let lists = 0;
  for (const snap of snapshots) {
    const at = snap.generatedAt || snap.fetchedAt || null;
    for (const t of (snap.tournaments || [])) {
      if (t.weekStart !== weekStart || !(aliases.has(nk(t.city)) || aliases.has(nk(t.name)))) continue;
      lists++;
      for (const s of (t.sections || [])) {
        for (const p of (s.players || [])) {
          const k = p.playerKey != null ? String(p.playerKey) : nameToKey(p.name);
          if (!k) continue;
          const e = out[k] || (out[k] = { sections: [], firstSeen: at, lastSeen: at });
          if (!e.sections.includes(s.title)) e.sections.push(s.title);
          if (at && (!e.firstSeen || at < e.firstSeen)) e.firstSeen = at;
          if (at && (!e.lastSeen || at > e.lastSeen)) e.lastSeen = at;
        }
      }
    }
  }
  return { seen: out, lists };
}

// ---- targets ---------------------------------------------------------------------------------------------------
function tierIndex(tierMap) {
  const byAtp = new Map(); const byName = new Map();
  for (const [name, e] of Object.entries(tierMap.events || {})) {
    const ev = { name, ...e };
    const m = String(e.source_url || '').match(/\/tournaments\/[^/]+\/(\d+)\//);
    if (m && !byAtp.has(m[1])) byAtp.set(m[1], ev);
    byName.set(nk(name), ev);
  }
  return { byAtp, byName };
}

const NON_CHALLENGER = /^ATP (250|500|1000)|Grand Slam|ATP Finals/i;
function collectTargets({ draws, calendar, entrySnapshots, asOf, overrides, tiers }) {
  const raw = [];
  for (const t of Object.values((draws && draws.tournaments) || {})) raw.push({ atpId: t.atpId, city: t.city, startDate: t.startDate, endDate: t.endDate, category: t.category, src: 'draws' });
  for (const t of ((calendar && calendar.tournaments) || [])) if (t.startDate) raw.push({ atpId: t.atpId, city: t.city, startDate: t.startDate, endDate: t.endDate, category: t.category, src: 'calendar' });
  for (const snap of entrySnapshots) for (const t of (snap.tournaments || [])) {
    if (t.tour !== 'ATP' || !NON_CHALLENGER.test(String(t.tier || ''))) continue;
    raw.push({ atpId: null, city: t.city || t.name, name: t.name, startDate: t.startDate || t.weekStart, weekStart: t.weekStart, category: t.tier, src: 'entry' });
  }
  const cutoff = iso(dms(asOf) - SCOPE_BACK_DAYS * DAY);
  const out = new Map();
  for (const r of raw) {
    if (!r.startDate || r.startDate < cutoff || !r.city) continue;
    const ov = (overrides.byName || {})[nk(r.city)] || (r.name && (overrides.byName || {})[nk(r.name)]) || null;
    const atpId = r.atpId != null ? String(r.atpId) : (ov && ov.atpId != null ? String(ov.atpId) : null);
    const tierEvent = (ov && ov.tierEvent && tiers.byName.get(nk(ov.tierEvent)))
      || (atpId && tiers.byAtp.get(atpId)) || tiers.byName.get(nk(r.city)) || (r.name && tiers.byName.get(nk(r.name))) || null;
    const name = (ov && ov.name) || (tierEvent && tierEvent.name) || r.city;
    const season = Number(r.startDate.slice(0, 4));
    const key = `${nk(name)}-${season}`;
    const weekStart = r.weekStart || iso(mondayOf(r.startDate));
    const cur = out.get(key) || { key, name, season, atpId: null, city: null, startDate: null, endDate: null, weekStart, category: null, tierEvent, override: ov, aliases: new Set(), sources: new Set() };
    if (atpId && !cur.atpId) cur.atpId = atpId;
    // start date: the draw sheet wins, then the calendar, then the entry list's week
    if (!cur.startDate || r.src === 'draws' || (r.src === 'calendar' && !cur.sources.has('draws'))) cur.startDate = r.startDate;
    if (r.endDate && (!cur.endDate || r.src === 'draws')) cur.endDate = r.endDate;
    if (r.src === 'draws' || !cur.city) cur.city = r.city;
    if (r.category && (!cur.category || r.src === 'draws')) cur.category = r.category;
    cur.weekStart = iso(mondayOf(cur.startDate));
    for (const a of [r.city, r.name, name, tierEvent && tierEvent.name]) if (a) cur.aliases.add(nk(a));
    cur.sources.add(r.src);
    out.set(key, cur);
  }
  return [...out.values()].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.key.localeCompare(b.key));
}

// ---- assemble one event ----------------------------------------------------------------------------------------
function buildEvent({ target, fixturesFor, pointsTable, people, draw, entrySeen, hasEntryList, prevEvent, otherDraws, asOf = null }) {
  const started = !!(asOf && target.startDate && target.startDate <= asOf);
  const ov = target.override || {};
  const base = {
    key: target.key, name: target.name, season: target.season, atpId: target.atpId != null ? Number(target.atpId) : null,
    city: target.city, startDate: target.startDate, endDate: target.endDate, category: target.category,
    tier: target.tierEvent ? target.tierEvent.tier : null,
  };
  if ((ov.firstEditionSeasons || []).includes(target.season)) {
    return { ...base, state: 'first-edition', firstEdition: true, nonRound: false, prior: null, dropDate: null, rowCount: 0, rows: [], zeroRows: [], dashRows: [], note: ov.note || null };
  }
  const te = target.tierEvent;
  if (te && NON_ROUND_TIERS.has(te.tier)) {
    return { ...base, state: 'non-round', firstEdition: false, nonRound: true, prior: null, dropDate: null, rowCount: 0, rows: [], zeroRows: [], dashRows: [], note: 'points are not a function of round reached — dash' };
  }
  if (!te || !(te.tournament_keys || []).length) {
    return { ...base, state: 'no-lineage', firstEdition: false, nonRound: false, prior: null, dropDate: null, rowCount: 0, rows: [], zeroRows: [], dashRows: [], note: 'no api-tennis tournament key for this event in the tier map — dash' };
  }
  const priorSeason = target.season - 1;
  let fixtures = fixturesFor(te.tournament_keys, priorSeason);
  if (fixtures === null) {
    return { ...base, state: 'fetch-failed', firstEdition: false, nonRound: false, prior: null, dropDate: null, rowCount: 0, rows: [], zeroRows: [], dashRows: [], note: 'api-tennis fixtures could not be read — dash, never a guess' };
  }
  fixtures = fixtures.filter((f) => String(f.tournament_season) === String(priorSeason));
  if (ov.priorNameRe) { const re = new RegExp(ov.priorNameRe); fixtures = fixtures.filter((f) => re.test(String(f.tournament_name || ''))); }
  if (!fixtures.length) {
    return { ...base, state: 'no-prior-edition', firstEdition: false, nonRound: false, prior: { season: priorSeason }, dropDate: null, rowCount: 0, rows: [], zeroRows: [], dashRows: [], note: `no ${priorSeason} edition fixtures in api-tennis — dash` };
  }
  const res = resolvePriorEdition({ fixtures, tierEvent: te, season: priorSeason, pointsTable, people });
  if (res.nonRound) {
    return { ...base, state: 'non-round', firstEdition: false, nonRound: true, prior: res.prior, dropDate: null, rowCount: 0, rows: [], zeroRows: [], dashRows: [], note: 'no round-labelled match at the prior edition — dash' };
  }
  // status at this year's event
  const prevStatus = new Map();
  if (prevEvent && prevEvent.statusSource === 'draw-sheet' && !draw) {
    for (const r of [].concat(prevEvent.rows || [], prevEvent.zeroRows || [], prevEvent.dashRows || [])) prevStatus.set(String(r.playerKey), r);
  }
  const STATUS_FIELDS = ['status', 'statusBasis', 'statusInferred', 'drawSection', 'drawEntry', 'withdrawalReason', 'listSections', 'listLastSeen', 'playingElsewhere'];
  const withStatus = (row) => {
    const prev = prevStatus.get(String(row.playerKey));
    let st;
    if (prev) { st = {}; for (const f of STATUS_FIELDS) if (prev[f] !== undefined) st[f] = prev[f]; st.statusFrozen = true; }
    else {
      st = statusOf({ playerKey: row.playerKey, apiName: row.apiName, fullName: row.name, draw, entrySeen, hasEntryList, started });
      if (st.status !== 'Playing' && otherDraws) {
        const els = otherDraws.filter((d) => ['main', 'qualifying'].some((sec) => ((d.draw[sec] && d.draw[sec].slots) || []).some((s) => String(s.playerKey) === String(row.playerKey)))).map((d) => d.name);
        if (els.length) st.playingElsewhere = els;
      }
    }
    return { ...row, ...st };
  };
  const rows = res.rows.map(withStatus).map((r, i) => ({ order: i + 1, ...r }));
  return {
    ...base, state: 'ok', firstEdition: false, nonRound: false,
    statusSource: draw || prevStatus.size ? 'draw-sheet' : (started ? null : (hasEntryList ? 'entry-list' : null)),
    prior: res.prior, dropDate: res.dropDate,
    rowCount: rows.length, zeroPointCount: res.zeroRows.length, dashCount: res.dashRows.length,
    rows, zeroRows: res.zeroRows.map(withStatus), dashRows: res.dashRows.map(withStatus),
  };
}

// ---- main --------------------------------------------------------------------------------------------------------
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const readJson = (p, def) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { if (def !== undefined) return def; throw e; } };

function fetchFixturesSync(keys, season, cacheDir) {
  const cp = require('child_process');
  const all = [];
  for (const k of keys) {
    const file = path.join(cacheDir, `${k}-${season}.json`);
    if (!fs.existsSync(file)) {
      const r = cp.spawnSync(process.execPath, [path.join(__dirname, 'fetch-edition.js'), String(k), String(season), file], { stdio: ['ignore', 'inherit', 'inherit'], env: process.env });
      if (r.status !== 0) return null;
    }
    const j = readJson(file, null);
    if (!j || !Array.isArray(j.result)) return null;
    all.push(...j.result);
  }
  return all;
}

function main() {
  const asOf = arg('asof', new Date().toISOString().slice(0, 10));
  const out = path.resolve(arg('out', path.join(ROOT, 'points-to-defend.json')));
  const piPath = arg('player-index', null);
  if (!piPath || piPath === true) { console.error('--player-index is required (ranks and countries come from it)'); process.exit(2); }
  const pi = readJson(piPath);
  const draws = readJson(arg('draws', path.join(ROOT, 'draws.json')), null);
  const entry = readJson(arg('entry', path.join(ROOT, 'entry_lists_advance.json')), null);
  const calendar = readJson(arg('calendar', path.join(ROOT, 'tools', 'draws', 'calendar-2026.json')), null);
  const prev = readJson(arg('prev', out), null);
  const tierMap = readJson(path.join(PAR, 'atp-tier-map-v1.json'));
  const pointsTable = readJson(path.join(PAR, 'atp-points-table-v1.json'));
  const overrides = readJson(path.join(__dirname, 'lineage-overrides.json'));
  const histDir = arg('entry-history', null);
  const snapshots = [];
  if (entry) snapshots.push(entry);
  if (histDir && histDir !== true) {
    // a directory of entry_lists_advance.json versions, or one file {snapshots:[…]}
    const files = fs.statSync(histDir).isDirectory() ? fs.readdirSync(histDir).filter((x) => x.endsWith('.json')).sort().map((f) => path.join(histDir, f)) : [histDir];
    for (const f of files) {
      const j = readJson(f, null);
      if (j && j.tournaments) snapshots.push(j);
      if (j && Array.isArray(j.snapshots)) for (const x of j.snapshots) if (x && x.tournaments) snapshots.push(x);
    }
  }
  const fxDir = arg('fixtures-dir', null);
  const cacheDir = arg('cache-dir', fs.mkdtempSync(path.join(os.tmpdir(), 'ptd-')));
  const fixturesFor = (keys, season) => {
    if (fxDir && fxDir !== true) {
      const all = [];
      for (const k of keys) { const j = readJson(path.join(fxDir, `${k}-${season}.json`), null); if (!j) return null; all.push(...(j.result || [])); }
      return all;
    }
    return fetchFixturesSync(keys, season, cacheDir);
  };

  const piRows = Array.isArray(pi.players) ? pi.players : [];
  const byKey = new Map(piRows.map((p) => [String(p.key), p]));
  const byFull = new Map(piRows.map((p) => [nk(p.name), String(p.key)]));
  const people = (pk, apiName) => { const p = byKey.get(String(pk)); return { name: (p && p.name) || apiName || null, country: (p && p.country) || null, rank: p && Number.isFinite(p.rank) ? p.rank : null }; };
  const nameToKey = (name) => byFull.get(nk(name)) || null;

  const tiers = tierIndex(tierMap);
  let targets = collectTargets({ draws, calendar, entrySnapshots: snapshots, asOf, overrides, tiers });
  const only = arg('only', null);
  if (only && only !== true) { const want = new Set(String(only).split(',')); targets = targets.filter((t) => want.has(t.key)); }

  const drawList = Object.values((draws && draws.tournaments) || {});
  const drawFor = (t) => drawList.find((d) => (t.atpId && String(d.atpId) === String(t.atpId)) || (t.aliases.has(nk(d.city)) && iso(mondayOf(d.startDate)) === t.weekStart)) || null;
  const events = {}; const index = {}; const entryMemory = {};
  for (const t of targets) {
    const d = drawFor(t);
    const prevMem = (prev && prev._entrySeen && prev._entrySeen[t.key]) || {};
    const { seen, lists } = mergeEntrySeen(prevMem, snapshots, t.weekStart, t.aliases, nameToKey);
    entryMemory[t.key] = seen;
    const otherDraws = drawList.filter((x) => x !== d && x.startDate && iso(mondayOf(x.startDate)) === t.weekStart).map((x) => ({ name: x.city, draw: x }));
    const ev = buildEvent({
      target: t, fixturesFor, pointsTable, people,
      draw: d ? { main: d.main, qualifying: d.qualifying } : null,
      entrySeen: seen, hasEntryList: lists > 0 || Object.keys(prevMem).length > 0,
      prevEvent: prev && prev.events ? prev.events[t.key] : null, otherDraws, asOf,
    });
    ev.aliases = [...t.aliases].sort();
    ev.sources = [...t.sources].sort();
    events[t.key] = ev;
    for (const a of t.aliases) { const k = `${a}-${t.season}`; if (!index[k]) index[k] = t.key; }
  }
  const doc = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    asOf,
    sources: {
      fixtures: fxDir && fxDir !== true ? `offline:${path.basename(fxDir)}` : 'api-tennis get_fixtures (event_type_key 265), per prior edition',
      playerIndex: { fetchedAt: pi.fetchedAt || null, source: pi.source || null },
      draws: draws ? { source: draws.source || null } : null,
      entryLists: { snapshots: snapshots.length, latestGeneratedAt: entry ? entry.generatedAt || null : null },
      pointsTable: (pointsTable._meta && pointsTable._meta.source) || null,
    },
    rules: {
      dropDate: 'Every row of an event drops on the event\'s award Monday + 52 weeks (award Monday = the Monday after the last main-draw match). Qualifying-only rows drop with the main draw (ATP Rulebook §9.01 E: each tournament stays in the system 52 weeks).',
      luckyLoser: 'A lucky loser shows main-draw points only; qualifyingPoints null (dash), ll true, pointsComplete false — the ATP rule for an LL\'s qualifying points is not confirmed from an official source.',
      qualifying: 'Qualifying round from the api-tennis qualifying-bracket label (Final = last round). Last-round loss = Q_final_round_loss; the round before = Q_earlier_round_loss (null → 0); earlier = 0.',
      zeroRows: 'Players whose result is worth 0 points are in zeroRows, not rows.',
      status: 'Playing = in the official draw sheet; Withdrew = named in the sheet\'s withdrawals (statusInferred false) or on an acceptance list but not in the draw (statusInferred true); Not entered otherwise.',
    },
    index,
    events,
    _entrySeen: entryMemory,
  };
  const tmp = out + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 1));
  fs.renameSync(tmp, out);
  const summary = Object.values(events).map((e) => `${e.key}:${e.state}${e.state === 'ok' ? `(${e.rowCount}+${e.zeroPointCount}z)` : ''}`).join(' ');
  console.error(`WROTE ${out}  events=${Object.keys(events).length}  ${summary}`);
}

module.exports = { resolvePriorEdition, statusOf, mergeEntrySeen, collectTargets, buildEvent, tierIndex, shortKey, nk, resultOf, SCHEMA_VERSION };
if (require.main === module) main();
