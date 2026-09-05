#!/usr/bin/env node
/**
 * TEN-150 Entry-Lists ADVANCE source  (ticktocktennis.com).
 *
 * Fetches the ATP entry-list page at https://entries.ticktocktennis.com/atp,
 * parses the entry data the page embeds server-side (four `atpData.week1 = {...}`
 * object literals, one per upcoming week), normalises it onto our schema, matches
 * player names onto our internal player keys, and writes entry_lists_advance.json
 * -- but ONLY after the fail-closed QA gate passes.
 *
 * This is the ADVANCE source: acceptance lists for upcoming weeks BEFORE the real
 * draw is posted. Our own protennislive mds/qs parser (build-entry-lists.py)
 * remains the near-event DRAW source; the frontend layers the two into a
 * two-regime view (advance list -> real draw once it lands). This script does
 * not touch that parser or its entry_lists.json shard.
 *
 * Design rules honoured (founder, TEN-150):
 *   - Tournament discovery comes from the source itself (no hand-seeded list).
 *   - One fetch per run (single GET, cached shard). Do NOT hammer the source.
 *   - Never fabricate/approximate. Missing data is null (a dash), never a zero.
 *   - Pending means pending: a tournament with no published list is `pending`
 *     with null counts, never MD 0.
 *   - Fail loudly: if the page changes shape or blocks us, we do NOT overwrite a
 *     good shard with garbage. We carry the last-known shard forward, flag it
 *     `fetchStatus:"stale"` with the reason and the age, and let the page state
 *     that it could not update. With no prior shard we exit non-zero (publish
 *     nothing) so the page shows "unavailable", not a fake empty list.
 *
 * Run:  node tools/entry-lists/build-entry-lists-advance.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const PROFILES_JSON = path.join(REPO_ROOT, "player-profiles.json");
const OUT_JSON = path.join(REPO_ROOT, "entry_lists_advance.json");
const SOURCE_URL = "https://entries.ticktocktennis.com/atp";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/128.0 Safari/537.36";

// ticktock's per-week tier buckets -> our canonical tier label.
const TIER_MAP = {
  gs: "Grand Slam",
  atp1000: "ATP 1000",
  atp500: "ATP 500",
  atp250: "ATP 250",
  atp125: "Challenger",
  itf: "ITF",
};
const TIERS = Object.keys(TIER_MAP);

const MONTHS = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

const IOC_TO_COUNTRY = {
  ARG: "Argentina", AUS: "Australia", AUT: "Austria", BEL: "Belgium",
  BIH: "Bosnia and Herzegovina", BLR: "Belarus", BOL: "Bolivia", BRA: "Brazil",
  BUL: "Bulgaria", CAN: "Canada", CHI: "Chile", CHN: "China", COL: "Colombia",
  CRO: "Croatia", CZE: "Czech Republic", DEN: "Denmark",
  DOM: "Dominican Republic", ECU: "Ecuador", EGY: "Egypt", ESP: "Spain",
  EST: "Estonia", FIN: "Finland", FRA: "France", GBR: "United Kingdom",
  GEO: "Georgia", GER: "Germany", GRE: "Greece", HUN: "Hungary", IND: "India",
  ISR: "Israel", ITA: "Italy", JOR: "Jordan", JPN: "Japan", KAZ: "Kazakhstan",
  KOR: "South Korea", LAT: "Latvia", LTU: "Lithuania", MDA: "Moldova",
  MEX: "Mexico", MON: "Monaco", NED: "Netherlands", NOR: "Norway", PER: "Peru",
  POL: "Poland", POR: "Portugal", ROU: "Romania", RSA: "South Africa",
  RUS: "Russia", SRB: "Serbia", SUI: "Switzerland", SVK: "Slovakia",
  SLO: "Slovenia", SWE: "Sweden", TPE: "Chinese Taipei", TUN: "Tunisia",
  TUR: "Turkey", UKR: "Ukraine", URU: "Uruguay", USA: "USA", UZB: "Uzbekistan",
  VEN: "Venezuela",
};

function log(...a) { console.error(...a); }

function deaccent(s) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function slugify(s) {
  return deaccent(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// --- fetch (single GET; retry only on transient network error, still one URL) -
async function fetchPage() {
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(SOURCE_URL, {
        headers: { "User-Agent": UA, "Accept": "text/html" },
        signal: ctrl.signal,
      });
      clearTimeout(to);
      if (res.status !== 200) {
        lastErr = `HTTP ${res.status}`;
        // a hard status (403/404/451) will not change on retry -> stop early
        if (res.status !== 429 && res.status < 500) break;
      } else {
        const html = await res.text();
        if (html && html.length > 5000) return { html, status: 200 };
        lastErr = `suspiciously small body (${html ? html.length : 0} bytes)`;
      }
    } catch (e) {
      lastErr = String(e && e.message ? e.message : e);
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 4000));
  }
  return { html: null, status: 0, error: lastErr };
}

// The embedded data is pure object/array/string/number literals. Before we
// Function()-eval remote content (this runs in the cron, which holds a git push
// credential), reject anything that could execute code: any call/grouping
// parenthesis, arrow, template expression, statement separator, or a dangerous
// identifier. String contents are blanked first so player names with punctuation
// never trip the check. A failed check throws -> caller carries the prior shard
// forward as stale (fail-loud), never eval'ing a mutated payload.
function assertSafeLiteral(lit) {
  const stripped = lit.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  if (/[()`;]|=>|\$\{|\b(function|import|require|process|globalThis|eval|constructor|new)\b/
      .test(stripped)) {
    throw new Error("unsafe token in embedded literal — refusing to eval");
  }
}

// --- parse the embedded `atpData.weekN = {...}` object literals (one/week) -----
function extractWeekLiterals(src) {
  const objs = [];
  const re = /atpData\.week\d+\s*=\s*/g;
  let m;
  while ((m = re.exec(src))) {
    let i = src.indexOf("{", m.index);
    if (i < 0) continue;
    let depth = 0, inStr = false, q = "", esc = false, end = -1;
    for (let j = i; j < src.length; j++) {
      const c = src[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === q) inStr = false;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { inStr = true; q = c; continue; }
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) throw new Error("unbalanced braces in an atpData literal");
    const lit = src.slice(i, end + 1);
    assertSafeLiteral(lit);
    // eslint-disable-next-line no-new-func
    objs.push(Function('"use strict";return (' + lit + ")")());
  }
  return objs;
}

// tab labels ("Sep 7", ...) -> ISO Monday weekStart. The i-th literal pairs with
// the i-th tab (verified: assign -> render -> tab order all agree).
function extractTabWeekStarts(src) {
  const tabs = [...src.matchAll(
    /week-tab[^"]*"\s*onclick="showWeek\('week\d+'[^>]*>([^<]+)</g
  )].map((m) => m[1].trim());
  const updM = src.match(/updated\s+([A-Za-z]{3})\s+\d{1,2},\s+(\d{4})/i);
  const year = updM ? parseInt(updM[2], 10) : new Date().getUTCFullYear();
  const updMon = updM && (updM[1] in MONTHS) ? MONTHS[updM[1]] : null;
  return tabs.map((label) => {
    const mm = label.match(/([A-Za-z]{3})\s+(\d{1,2})/);
    if (!mm || !(mm[1] in MONTHS)) return { label, weekStart: null };
    // Tabs run forward from the "updated" date. Across a Dec->Jan boundary a
    // January tab belongs to the next year, so bump the year when the tab month
    // is earlier than the update month.
    const monIdx = MONTHS[mm[1]];
    const ty = (updMon != null && monIdx < updMon) ? year + 1 : year;
    // tab shows the Monday date already; snap to ISO Monday defensively.
    const d = new Date(Date.UTC(ty, monIdx, parseInt(mm[2], 10)));
    const back = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - back);
    return { label, weekStart: d.toISOString().slice(0, 10) };
  });
}

// "updated Sep 4, 2026 at 10:35 AM EST" -> {raw, iso}. Eastern in September is
// EDT (UTC-4); ticktock writes "EST" but we convert with the real seasonal
// offset rather than trusting the literal abbreviation.
function extractSourcePublished(src) {
  const m = src.match(
    /updated\s+([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i
  );
  if (!m) return { raw: null, iso: null };
  const raw = m[0].replace(/\s+/g, " ").replace(/^updated\s+/i, "");
  const [, mon, day, year, hhStr, mmStr, ap] = m;
  if (!(mon in MONTHS)) return { raw, iso: null };
  let hh = parseInt(hhStr, 10) % 12;
  if (/pm/i.test(ap)) hh += 12;
  const monIdx = MONTHS[mon];
  // Eastern DST runs Mar->Nov; Sep is always EDT (UTC-4).
  const offset = monIdx >= 2 && monIdx <= 10 ? 4 : 5;
  const utc = new Date(Date.UTC(
    parseInt(year, 10), monIdx, parseInt(day, 10),
    hh + offset, parseInt(mmStr, 10)
  ));
  return { raw, iso: utc.toISOString().replace(/\.\d{3}Z$/, "Z") };
}

// --- player-key normalisation -------------------------------------------------
function buildProfileIndex(profiles) {
  const players = profiles.players || profiles;
  const idx = new Map();
  for (const key of Object.keys(players)) {
    const nm = (players[key].name || "").trim();
    if (!nm.includes(".")) continue;
    const initial = nm.split(".", 1)[0].trim().toUpperCase();
    const surname = deaccent(nm.slice(nm.indexOf(".") + 1).trim()).toLowerCase();
    if (!surname) continue;
    const k = surname + "|" + initial;
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push({ key, country: (players[key].country || "").trim() });
  }
  return idx;
}

// ticktock name is "First Last(s)": initial from first token, surname from rest.
function normaliseKey(idx, fullName, ioc) {
  if (!fullName) return null;
  const toks = deaccent(fullName).trim().split(/\s+/);
  if (toks.length < 2) return null;
  const initial = toks[0][0].toUpperCase();
  const surname = toks.slice(1).join(" ").toLowerCase();
  const cands = idx.get(surname + "|" + initial);
  if (!cands || !cands.length) return null;
  if (cands.length === 1) return cands[0].key;
  const want = ioc ? IOC_TO_COUNTRY[ioc] : null;
  if (want) {
    const filt = cands.filter((c) => c.country === want);
    if (filt.length === 1) return filt[0].key;
  }
  return null;
}

// --- tournament + player shaping ---------------------------------------------
function splitNameSurface(rawName) {
  // "Genoa (CH 125) - Claycourt" -> {display:"Genoa (CH 125)", surface:"Clay"}
  let display = rawName || "";
  let surface = null;
  const dash = display.lastIndexOf(" - ");
  if (dash > -1) {
    const tail = display.slice(dash + 3).trim();
    const s = tail.toLowerCase();
    if (s.startsWith("clay")) surface = "Clay";
    else if (s.startsWith("hard")) surface = "Hard";
    else if (s.startsWith("grass")) surface = "Grass";
    else if (s.startsWith("carpet")) surface = "Carpet";
    if (surface) display = display.slice(0, dash).trim();
  }
  return { display, surface };
}

function cityFromName(display) {
  // clean location: drop a trailing tier parenthetical "(CH 125)"/"(250)" and a
  // leading ITF prize prefix "M25 "/"W15 ". Keeps a genuine location paren like
  // "China Open (Beijing)". Falls back to the display if nothing is left.
  let c = display.replace(/\s*\((?:CH|M|W)?\s*\d{2,4}\)\s*$/i, "").trim();
  c = c.replace(/^(?:M15|M25|W15|W25|W35|W50|W75|W100|ITF)\s+/i, "").trim();
  return c || display.trim();
}

function shapePlayer(row, section, idx) {
  // row = [rank|null, name, ioc, optionalFlag]
  const rank = row[0];
  const name = row[1];
  const ioc = row[2] || null;
  const flag = row.length > 3 ? row[3] : null;
  let status;
  if (section === "wc" || section === "qualWc") status = "WC";
  else if (section === "alt" || section === "qualAlt" || section === "qnext") status = "ALT";
  else if (section === "qual") status = "Q";
  else status = "DA";
  // an eligibility flag (PR/NG/JR/protected) overrides the plain DA/Q label.
  if (flag && ["PR", "NG", "JR", "SE", "LL", "CO"].includes(flag)) status = flag;
  return {
    name,
    rank: Number.isInteger(rank) ? rank : (typeof rank === "number" ? rank : null),
    country: ioc,
    status,
    seed: null,
    playerKey: normaliseKey(idx, name, ioc),
  };
}

function shapeTournament(t, tier, weekStart, weekLabel, published, idx) {
  const { display, surface } = splitNameSurface(t.name || "");
  const city = cityFromName(display);
  const canonicalTier =
    tier === "atp125" && /\bCH\b|\bch\s*125|\(125\)/i.test(t.name || "")
      ? "Challenger" : TIER_MAP[tier];

  const base = {
    regime: "advance",
    tour: "ATP",
    tournamentId: "ttt:" + weekStart + ":" + (slugify(city) || slugify(display) || "t"),
    name: display || null,
    city: city || null,
    country: null, // ticktock does not expose a country field distinct from city
    tier: canonicalTier,
    surface: surface,
    weekStart,
    week_label: weekLabel,
    startDate: weekStart,
    sourcePublished: published,
    status: "active",
    counts: { MD: null, Q: null, ALT: 0 },
    sections: [],
  };

  if (t.cancelled) {
    base.status = "cancelled";
    return base;
  }

  const md = [
    ...(t.main || []).map((r) => shapePlayer(r, "main", idx)),
    ...(t.wc || []).map((r) => shapePlayer(r, "wc", idx)),
  ];
  const q = [
    ...(t.qual || []).map((r) => shapePlayer(r, "qual", idx)),
    ...(t.qualWc || []).map((r) => shapePlayer(r, "qualWc", idx)),
  ];
  const reserves = [
    ...(t.alt || []).map((r) => shapePlayer(r, "alt", idx)),
    ...(t.qualAlt || []).map((r) => shapePlayer(r, "qualAlt", idx)),
    ...(t.qnext || []).map((r) => shapePlayer(r, "qnext", idx)),
  ];

  // A tournament ticktock lists but with no players anywhere is genuinely
  // not-yet-published -> pending, null counts (a dash), never MD 0.
  if (!md.length && !q.length && !reserves.length) {
    base.status = "pending";
    return base;
  }

  base.counts.MD = md.length || null;
  base.counts.Q = q.length || null;
  base.counts.ALT = reserves.length;
  if (md.length) base.sections.push({ title: "Main Draw", players: md });
  if (q.length) base.sections.push({ title: "Qualifying", players: q });
  if (reserves.length) base.sections.push({ title: "Alternates & Reserves", players: reserves });
  return base;
}

// --- fail-closed QA gate ------------------------------------------------------
function validate(shard) {
  const errs = [];
  if (shard.source !== "ticktocktennis") errs.push("source tag wrong");
  const ts = shard.tournaments;
  if (!Array.isArray(ts)) return ["tournaments is not an array"];
  if (shard.fetchStatus === "ok" && ts.length === 0)
    errs.push("fresh fetch produced 0 tournaments (source shape likely changed)");
  const weeks = new Set();
  let playerTotal = 0;
  for (const t of ts) {
    if (!t.weekStart) errs.push(`tournament ${t.name} missing weekStart`);
    else weeks.add(t.weekStart);
    if (!["active", "pending", "cancelled"].includes(t.status))
      errs.push(`tournament ${t.name} bad status ${t.status}`);
    const c = t.counts || {};
    // no fabricated zeros: an active tournament must have a positive MD or Q,
    // never 0. Absent draw -> null (dash). 0 is illegal.
    if (t.status === "active") {
      if (c.MD === 0) errs.push(`${t.name}: active with MD 0 (must be null or >0)`);
      if (c.Q === 0) errs.push(`${t.name}: active with Q 0 (must be null or >0)`);
      if (!(t.sections && t.sections.length))
        errs.push(`${t.name}: active with no sections`);
    }
    if (t.status === "pending") {
      if (c.MD !== null || c.Q !== null)
        errs.push(`${t.name}: pending must have null MD/Q`);
    }
    for (const s of t.sections || []) {
      for (const p of s.players || []) {
        playerTotal++;
        if (!p.name) errs.push(`${t.name}: player with no name`);
        if (p.rank === 0) errs.push(`${t.name}: player rank 0 (must be null or >0)`);
      }
    }
  }
  if (shard.fetchStatus === "ok" && playerTotal === 0)
    errs.push("fresh fetch produced 0 players");
  return errs;
}

function readPrior() {
  try {
    return JSON.parse(fs.readFileSync(OUT_JSON, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const profiles = JSON.parse(fs.readFileSync(PROFILES_JSON, "utf8"));
  const idx = buildProfileIndex(profiles);
  log(`loaded ${Object.keys(profiles.players || profiles).length} profiles -> ${idx.size} (surname|initial) keys`);

  const { html, status, error } = await fetchPage();

  // ---- fetch failure: carry the last-known shard forward, flagged stale ----
  if (!html) {
    const reason = `fetch failed (${error || "status " + status})`;
    log("FETCH FAILED:", reason);
    const prior = readPrior();
    if (!prior) {
      log("no prior shard to carry forward -> publishing nothing (exit 1)");
      process.exit(1);
    }
    prior.fetchStatus = "stale";
    prior.fetchedAt = nowIso;
    prior.fetchError = reason;
    fs.writeFileSync(OUT_JSON, JSON.stringify(prior, null, 2));
    log(`carried prior shard forward as STALE (data from ${prior.generatedAt}); page will show it could not update.`);
    // stale-but-carried is a controlled state, not a crash: exit 0 so the
    // wrapper still commits the advanced age. The page reads fetchStatus.
    return;
  }

  // ---- parse ----
  let weeks, tabs, pub;
  try {
    weeks = extractWeekLiterals(html);
    tabs = extractTabWeekStarts(html);
    pub = extractSourcePublished(html);
  } catch (e) {
    log("PARSE FAILED:", String(e));
    const prior = readPrior();
    if (!prior) process.exit(1);
    prior.fetchStatus = "stale";
    prior.fetchedAt = nowIso;
    prior.fetchError = "parse failed: " + String(e && e.message ? e.message : e);
    fs.writeFileSync(OUT_JSON, JSON.stringify(prior, null, 2));
    log("carried prior shard forward as STALE after parse failure.");
    return;
  }

  if (!weeks.length || weeks.length !== tabs.length) {
    const reason = `structure changed: ${weeks.length} data blocks vs ${tabs.length} week tabs`;
    log("SHAPE MISMATCH:", reason);
    const prior = readPrior();
    if (!prior) process.exit(1);
    prior.fetchStatus = "stale";
    prior.fetchedAt = nowIso;
    prior.fetchError = reason;
    fs.writeFileSync(OUT_JSON, JSON.stringify(prior, null, 2));
    return;
  }

  const tournaments = [];
  weeks.forEach((wk, wi) => {
    const { weekStart, label } = tabs[wi];
    if (!weekStart) return;
    for (const tier of TIERS) {
      for (const t of wk[tier] || []) {
        tournaments.push(
          shapeTournament(t, tier, weekStart, label, pub.iso, idx)
        );
      }
    }
  });

  const shard = {
    schemaVersion: 2,
    source: "ticktocktennis",
    sourceUrl: SOURCE_URL,
    generatedAt: nowIso,
    fetchedAt: nowIso,
    fetchStatus: "ok",
    fetchError: null,
    sourcePublished: pub.iso,
    sourcePublishedRaw: pub.raw,
    upstream: null, // no vendor/API attribution found in the page payload
    tournaments,
  };

  const errs = validate(shard);
  if (errs.length) {
    log("QA GATE FAILED — committed shard left untouched:");
    for (const e of errs) log("  - " + e);
    process.exit(1);
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify(shard, null, 2));
  const players = tournaments.reduce(
    (n, t) => n + (t.sections || []).reduce((m, s) => m + s.players.length, 0), 0);
  const byTier = {};
  tournaments.forEach((t) => { byTier[t.tier] = (byTier[t.tier] || 0) + 1; });
  log(`\nPublished ${OUT_JSON}`);
  log(`  weeks: ${[...new Set(tournaments.map((t) => t.weekStart))].sort().join(", ")}`);
  log(`  tournaments: ${tournaments.length}  players: ${players}`);
  log(`  by tier: ${JSON.stringify(byTier)}`);
  log(`  sourcePublished: ${pub.raw} (${pub.iso})`);
}

main().catch((e) => { log("FATAL", e); process.exit(1); });
