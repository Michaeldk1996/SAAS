// TEN-443 step 2 · pair Tennis Explorer rows (te-history/<key>.json) with our career-history rows, one match = one row,
// and name every disagreement between a pair. Shared by the pipeline ingest and the reports, so the counts the founder
// sees are the counts the page is built from. No I/O; CommonJS like bsp-pipeline.js.
//
// Pairing (measured TEN-443 step 1: 134/134 cells reconciled for Fils, Zverev, D. Chan with this join):
//   * same opponent — surname compared letters-only, our "B. Van De Zandschulp" vs TE "Van De Zandschulp B.";
//     a 5-letter prefix/suffix or containment counts (TE "Hsu Y." vs "Y. H. Hsu"), and failing that the same event
//     prefix with the same result;
//   * date window: a fixtures row sits on the match day (±3 days for time-zone drift); an archive or 2021 hole-fill
//     row carries its TOURNAMENT-WEEK date, so the TE match date may fall up to 20 days after it;
//   * assigned GLOBALLY by cost (date gap, +100 if the result differs, +50 if only the event matched), so a repeat
//     opponent in one event (round robin and final) pairs with the right match.
// Conflicts on a pair (never resolved here — the row carries them, the drill marks them):
//   result · score (games per set, from the player's side; 0–0 sets ignored) · surface (TE outdoor surface vs ours)
//   · court (TE indoor/outdoor vs our flag) · walkover (one side calls it a walkover).
'use strict';

const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const ourSurname = (n) => { const t = String(n || '').split(/\s+/); const k = t.filter((x) => !/\.$/.test(x)); return norm((k.length ? k : t).join(' ')); };
const teSurname = (n) => { const t = String(n || '').split(/\s+/); if (t.length > 1 && /\.$/.test(t[t.length - 1])) t.pop(); return norm(t.join(' ')); };
const translit = (x) => x.replace(/oe/g, 'o').replace(/ue/g, 'u').replace(/ae/g, 'a');   // "Moeller" = TE "Moller"
const similar0 = (a, b) => a === b || (a.length > 3 && b.length > 3 && (a.slice(-5) === b.slice(-5) || a.slice(0, 5) === b.slice(0, 5) || a.includes(b) || b.includes(a)));
const prefix3 = (a, b) => { const [x, y] = a.length <= b.length ? [a, b] : [b, a]; return x.length >= 3 && y.startsWith(x); };   // "Nam" = "Nam Ji", "Hsu" = "Hsu Yu"
const similar = (a, b) => similar0(a, b) || similar0(translit(a), translit(b)) || prefix3(a, b);
// surname words in either order: our "R. Dutra Silva" vs TE "Silva Dutra R." (same player, words reversed)
const wordsOf = (n, te) => { const t = String(n || '').trim().split(/\s+/).filter((x) => !/\.$/.test(x)); return t.map(norm).filter(Boolean).sort().join('|'); };
const sameWords = (teName, ourNameS) => { const a = wordsOf(teName), b = wordsOf(ourNameS); return !!a && a === b && a.includes('|'); };
// an Asian name written in the other order: TE "Yunchaokete B." vs our "Y. Bu" (Bu Yunchaokete)
const swapped = (teName, ourNameS) => {
  const t = String(teName || '').trim().split(/\s+/), o = String(ourNameS || '').trim().split(/\s+/);
  const ti = (t.find((x) => /\.$/.test(x)) || '')[0], tl = norm(t.filter((x) => !/\.$/.test(x)).join(''));
  const oi = (o.find((x) => /\.$/.test(x)) || '')[0], ol = norm(o.filter((x) => !/\.$/.test(x)).join(''));
  return !!(ti && oi && tl && ol && tl.startsWith(oi.toLowerCase()) && ol.startsWith(ti.toLowerCase()));
};
// event name for comparison only: tier and gender prefixes/suffixes stripped ("ATP Rio de Janeiro", "ITF M25 Esch/Alzette Men")
const evKey = (e) => norm(String(e || '').replace(/\bSt\.?\s/gi, 'Saint ').replace(/^(atp|wta|itf)\s+/i, '').replace(/^[mw]\d{2,3}\+?h?\s+/i, '').replace(/\s+(challenger\s+)?(men|women)$/i, '').replace(/\s+challenger$/i, '').replace(/\s+chall\.$/i, '')).slice(0, 5);
// our event names that TE spells differently (only the cost term reads this; it never decides a pair alone)
const EVENT_ALIAS = { rolandgarros: 'French Open', usopen: 'US Open', canadamasters: 'Montreal', cincinnatimasters: 'Cincinnati',
  indianwellsmasters: 'Indian Wells', miamimasters: 'Miami', madridmasters: 'Madrid', romemasters: 'Rome', montecarlomasters: 'Monte Carlo',
  shanghaimasters: 'Shanghai', parismasters: 'Paris', tourfinals: 'Masters Cup', atpfinals: 'Masters Cup', finals: 'Masters Cup' };
const days = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);

function pairRows(teRows, ourRows) {
  const cand = [];
  teRows.forEach((t, i) => {
    const ts = teSurname(t.opp), te = evKey(t.event);
    ourRows.forEach((o, j) => {
      if (!o.date || !t.date) return;
      const nameExact = similar(ts, ourSurname(o.opponent));
      const nameOk = nameExact || swapped(t.opp, o.opponent) || sameWords(t.opp, o.opponent);
      const evOk = te && te === evKey(EVENT_ALIAS[norm(o.tournament)] || o.tournament) && !!t.won === !!o.won;
      if (!nameOk && !evOk) return;
      const dd = days(t.date, o.date);
      const weekDated = o.src === 'archive' || o.holeFill;
      if (weekDated ? (dd < -3 || dd > 20) : Math.abs(dd) > 3) return;
      const evSame = te && te === evKey(EVENT_ALIAS[norm(o.tournament)] || o.tournament);
      cand.push([Math.abs(dd) + (!!t.won !== !!o.won ? 100 : 0) + (nameExact ? 0 : nameOk ? 10 : 50) + (evSame ? 0 : 20), i, j]);
    });
  });
  cand.sort((a, b) => a[0] - b[0]);
  const te2our = new Map(), used = new Set();
  for (const [, i, j] of cand) { if (te2our.has(i) || used.has(j)) continue; te2our.set(i, j); used.add(j); }
  // TEN-449 review: a dated row can sit up to a week from TE's date (a retirement api-tennis dates at the final round,
  // Kursumlijska Banja 2024: 6 days). Second pass over the LEFTOVERS only: same opponent surname exactly, same result,
  // within 10 days — else one match counts twice (TE-only added + ours kept).
  const cand2 = [];
  teRows.forEach((t, i) => {
    if (te2our.has(i) || !t.date) return;
    ourRows.forEach((o, j) => {
      // exact surname only: the loose `similar` lets "martin" sit inside "martinez" (review 2026-10-19)
      if (used.has(j) || !o.date || !!t.won !== !!o.won || teSurname(t.opp) !== ourSurname(o.opponent)) return;
      const dd = Math.abs(days(t.date, o.date)); if (dd <= 10) cand2.push([dd, i, j]);
    });
  });
  cand2.sort((a, b) => a[0] - b[0]);
  for (const [, i, j] of cand2) { if (te2our.has(i) || used.has(j)) continue; te2our.set(i, j); used.add(j); }
  return {
    pairs: [...te2our.entries()].map(([i, j]) => ({ te: teRows[i], ours: ourRows[j], ti: i, oi: j })),
    teOnly: teRows.filter((_, i) => !te2our.has(i)),
    oursOnly: ourRows.filter((_, j) => !used.has(j)),
  };
}

// games per set from the player's side, 0–0 sets dropped (TE prints a retirement's untouched set as 0-0 sometimes)
const teGames = (t) => (t.sets || []).map((s) => (t.won ? [s.w, s.l] : [s.l, s.w])).filter(([a, b]) => a + b > 0);
const ourGames = (o) => (o.sets || []).map((s) => [s.p, s.o]).filter(([a, b]) => a + b > 0);

// a match tie-break in lieu of a final set: TE prints "10-7", our store "1-0" — the same set
const mtb = (g) => g.map(([a, b], k) => (k === g.length - 1 && k >= 2 && Math.max(a, b) >= 10 && Math.abs(a - b) >= 2 ? [a > b ? 1 : 0, a > b ? 0 : 1] : [a, b]));
function conflictsOf(t, o) {
  const out = [];
  const tWo = !!t.wo, oWo = !!o.walkover;
  if (tWo !== oWo) { out.push({ kind: 'walkover', te: tWo, ours: oWo }); return out; }
  if (tWo) return out;
  if (!!t.won !== !!o.won) out.push({ kind: 'result', te: t.won ? 'W' : 'L', ours: o.won ? 'W' : 'L' });
  const tg = mtb(teGames(t)), og = mtb(ourGames(o));
  if (tg.length && og.length && JSON.stringify(tg) !== JSON.stringify(og)) {
    // name the kind of score disagreement so a notation gap is never read as a different result
    const done = (g) => g.filter(([a, b]) => Math.max(a, b) >= 6 && (Math.abs(a - b) >= 2 || Math.max(a, b) >= 7));
    const sub = JSON.stringify(done(tg)) === JSON.stringify(done(og)) ? 'unfinished set only (retirement)'
      : tg.length !== og.length ? 'a set missing on one side' : 'games differ';
    out.push({ kind: 'score', sub, te: tg.map((g) => g.join('-')).join(' '), ours: og.map((g) => g.join('-')).join(' ') });
  }
  if (t.court === 'outdoor' && t.surface && o.surface && t.surface !== o.surface) out.push({ kind: 'surface', te: t.surface, ours: o.surface });
  if (t.court && (o.indoor === true || o.indoor === false) && (t.court === 'indoor') !== o.indoor) out.push({ kind: 'court', te: t.court, ours: o.indoor ? 'indoor' : 'outdoor' });
  return out;
}

// te-history/<key>.json (format te-history/1: one array per row, column names in `cols`) -> row objects, src 'te'
const BOOL = new Set(['won', 'wo', 'ret', 'dateAmbiguous']);
function setsOfScore(score) {
  return String(score || '').split(',').map((x) => x.trim()).filter(Boolean)
    .map((x) => { const m = x.match(/^(\d+)(?:\(\d+\))?-(\d+)(?:\(\d+\))?$/); return m ? { w: +m[1], l: +m[2] } : null; }).filter(Boolean);
}
function teRowsOf(rec) {
  const cols = rec.cols || [];
  return (rec.rows || []).map((a) => {
    if (!Array.isArray(a)) return a;
    const o = { src: 'te' };
    cols.forEach((c, i) => { o[c] = BOOL.has(c) ? !!a[i] : a[i]; });
    o.sets = setsOfScore(o.score);
    return o;
  });
}

// ─── Ingest: merge a player's TE rows into his career-history rows (TEN-443 step 2) ───────────────────────────────
// One match = one row. Founder rulings (TEN-443, 2026-10-17): TE is the reference — counting rules minus exhibitions
// and club matches, TE's court class, TE's edition-year season; pre-2021 figures rise to the row count. Every
// disagreement with our row stays ON the row (`conflicts`), never resolved silently; the cell follows TE.
const SLAM = /Wimbledon|French Open|US Open|Australian Open|Roland Garros/;
const isJuniorRow = (r) => r && r.level === 'chitf' && (SLAM.test(r.tournament || '') || /juniork/i.test(r.tournament || ''));
const levelOfCat = (cat) => (/^(Challenger|ITF)/.test(cat || '') ? 'chitf' : 'atp');
// TE "Van De Zandschulp B." -> our "B. Van De Zandschulp"
const ourName = (te) => { const t = String(te || '').trim().split(/\s+/); if (t.length > 1 && /\.$/.test(t[t.length - 1])) { const i = t.pop(); return `${i} ${t.join(' ')}`; } return t.join(' '); };

function teOnlyRow(t) {
  const sets = (t.sets || []).map((s) => (t.won ? { p: s.w, o: s.l } : { p: s.l, o: s.w })).filter((x) => x.p + x.o > 0);
  const won = sets.filter((x) => x.p > x.o).length, lost = sets.filter((x) => x.p < x.o).length;
  // a counted TE "Other" event (multi-sport games, play-offs) is not tour level: Challenger/ITF tier (TEN-449)
  const r = { year: String(t.season), surface: t.surface || null, level: t.cat === 'Other' ? 'chitf' : levelOfCat(t.cat), date: t.date, tournament: t.event,
    round: t.round || null, opponent: ourName(t.opp), result: `${won} - ${lost}`, won: !!t.won, src: 'te', teCat: t.cat,
    indoor: t.court === 'indoor' ? true : t.court === 'outdoor' ? false : null };
  if (sets.length) r.sets = sets;
  // retired: TE's injury table names HIS retirements (t.ret); an opponent's retirement shows only as an unfinished
  // last set — a set nobody won by the rules (6+ with a 2-game lead, 7-6, or a 10+ match tie-break)
  const last = sets[sets.length - 1];
  const finished = (x) => { const hi = Math.max(x.p, x.o), d = Math.abs(x.p - x.o); return (hi >= 6 && d >= 2) || hi === 7 || (hi >= 10 && d >= 2) || (hi === 1 && d === 1 && sets.length >= 3); };
  if (t.ret || (last && !finished(last))) r.retired = true;
  if (t.teMatchId) r.teMatchId = t.teMatchId;
  if (t.dateAmbiguous) r.dateAmbiguous = true;
  return r;
}

// TE "Other" events that count (founder ruling TEN-449, 2026-10-19), by exact TE event name: the multi-sport games and
// the wildcard / pre-qualifying play-offs. Pro series and invitationals, and national championships and tours (an
// exhibition/club class since 2026-10-17), stay out; an "Other" event not named here stays out until it is ruled on.
const OTHER_COUNTED = new Set(['Pan American Games', 'African Games', 'World University Games', 'Mediterranean Games',
  'Commonwealth Games', 'Rome - pre-qualification', 'AO Wildcard Playoff - Australia', 'AO WC Playoff - Asia-Pacific']);

// Players joined to TE without a DOB, by name in the founder's ruling (TEN-449, 2026-10-19): Z. Svajda only, pinned to
// his TE page.
const NO_DOB_EXCEPTION = new Map([['2986', { slug: 'svajda' }]]);

// Players joined to TE on a NEAR-MISS date of birth, by key, in the founder's ruling (TEN-449, 2026-10-19, report
// `bucket-d`): TE's DOB has day and month swapped, is 10 days off, or is the year only (TE prints "1. 1. <year>"; the
// store records the year alone). Each is pinned to ONE TE page and ONE TE DOB, as the store records it; ours is kept for
// the record. Unlike Svajda they are DOB-joined players: the record counts only TE's rows (ruling 2A). Overlap the
// founder ruled on (paired / our rows, 0 result disagreements): 216/217, 172/172, 32/32, 131/131, 7/7, 18/34 (16 junior
// rows), 5/5, 15/15 (report of 19 Oct). Nobody else: any other key with a DOB that is not a valid full yyyymmdd stops the
// run, and the store builder refuses any other key whose TE DOB differs from ours.
const NEAR_MISS_DOB = new Map([
  ['702', { slug: 'tkemaladze', te: '20000604', ours: '20000406', why: 'day and month swapped' }],
  ['12972', { slug: 'rocha-a46b1', te: '19991004', ours: '19990410', why: 'day and month swapped' }],
  ['19461', { slug: 'munoz-1a9fc', te: '2005', ours: '20050122', why: 'TE has the year only' }],
  ['52682', { slug: 'balshaw', te: '20060605', ours: '20060615', why: '10 days apart' }],
  ['54221', { slug: 'bennaton', te: '2005', ours: '20050813', why: 'TE has the year only' }],
  ['70760', { slug: 'ceban', te: '2009', ours: '20090313', why: 'TE has the year only' }],
  ['78231', { slug: 'al-sulaiti-a86c2', te: '2007', ours: '20070730', why: 'TE has the year only' }],
  ['78628', { slug: 'snoussi', te: '2007', ours: '20070707', why: 'TE has the year only' }],
]);
// How a cache players.json entry may have been joined (te-scrape.mjs resolve: 'dob' / 'age±1' — DOB equal by
// construction), plus the two founder-named classes, each only for its own keys.
const JOIN_HOW = { dob: null, 'age±1': null, 'founder-exception': NO_DOB_EXCEPTION, 'near-miss-dob': NEAR_MISS_DOB };

// a real calendar date, yyyymmdd (00000000, month 13, 31 Feb are not DOBs)
const isFullDob = (d) => { if (!/^\d{8}$/.test(d)) return false; const y = +d.slice(0, 4), m = +d.slice(4, 6), dd = +d.slice(6);
  const t = new Date(Date.UTC(y, m - 1, dd)); return y >= 1900 && m >= 1 && m <= 12 && dd >= 1 && dd <= 31 && t.getUTCMonth() === m - 1 && t.getUTCDate() === dd; };

// Why a TE store record (te-history/<key>.json) — or, with `how`, a cache players.json entry — may NOT be joined; null
// when it may. Fail-closed: a valid full yyyymmdd DOB, or a key named above with exactly its page (and DOB).
// With `ourDob` in the argument (the store builder, which holds the DOB the scraper joined on), an unnamed key's TE DOB
// must also EQUAL ours, and a near-miss key's ours must be the one the founder ruled on; ourDob null = not on record,
// refused for an unnamed key.
function teIdentityRefusal(rec) {
  const key = String(rec.key), dob = rec.dob == null || rec.dob === '' ? null : String(rec.dob);
  if ('how' in rec) {
    if (!(rec.how in JOIN_HOW)) return `${key}: join "${rec.how}" is not a DOB join or a named exception — refusing`;
    const named = JOIN_HOW[rec.how];
    if (named && !named.has(key)) return `${key}: join "${rec.how}" is not a named exception for this key — refusing a non-DOB join`;
  }
  const nm = NEAR_MISS_DOB.get(key);
  if (nm) {
    if (rec.slug !== nm.slug || dob !== nm.te) return `te-history/${key}.json is a named near-miss DOB join (NEAR_MISS_DOB) to ${nm.slug} with TE DOB ${nm.te}, but holds ${rec.slug} with DOB ${dob} — refusing`;
    if ('ourDob' in rec && rec.ourDob !== nm.ours) return `${key}: our DOB ${rec.ourDob} is not the ${nm.ours} the near-miss ruling (NEAR_MISS_DOB) was made on — refusing`;
    return null;
  }
  const nd = NO_DOB_EXCEPTION.get(key);
  if (nd && rec.slug !== nd.slug) return `te-history/${key}.json is the named no-DOB join (NO_DOB_EXCEPTION) to ${nd.slug}, but holds ${rec.slug} — refusing`;
  if (!dob) return nd ? null : `te-history/${key}.json has no DOB and is not a named exception (NO_DOB_EXCEPTION) — refusing a non-DOB join`;
  if (!isFullDob(dob)) return `te-history/${key}.json has DOB "${dob}", not a valid full yyyymmdd, and is not a named exception (NEAR_MISS_DOB) — refusing a non-DOB join`;
  if ('ourDob' in rec && !nd) {
    if (!rec.ourDob) return `${key}: no DOB of ours on record to check TE's ${dob} against — refusing a non-DOB join`;
    if (rec.ourDob !== dob) return `${key}: TE DOB ${dob} is not our DOB ${rec.ourDob}, and the key is not a named exception (NEAR_MISS_DOB) — refusing a non-DOB join`;
  }
  return null;
}

// The career record is its OWN population (founder TEN-449): H2H, Lines, the model and every other reader of
// career-history keep the feed rows exactly as built. So the merge never touches `rows`: it works on copies and returns
//   rows   — the record's rows (copies of ours, TE-corrected, plus TE-only rows), which careerByYearFromRows counts;
//   copyOf — Map(our row -> its record copy), for every row of ours that counts in the record;
//   out    — Map(our row -> why it is not in the record): 'junior' · 'walkover' · 'exhibition' · 'duplicate' ·
//            'not-in-te' (a DOB-joined player's row TE does not list: shown in the drill, marked, never counted);
//   added  — the TE-only rows.
// recordLayer() turns these into the shard's `record` block once the feed rows are final.
function applyTeHistory(rows, teRec) {
  const diag = { paired: 0, added: 0, addedByCat: {}, juniorsDropped: 0, stuttgartFixed: 0, oursOnly: 0, seasonMoves: 0,
    indoorOverrides: 0, indoorSet: 0, surfaceFromTe: 0, resultFromTe: 0, conflicts: {}, exhibitionsSkipped: 0, walkoversSkipped: 0 };
  const out = new Map(), orig = new Map();
  // TEN-444 / TEN-445 back-corrections, so a cached profile (14-day TTL) gets them on this run, not its rebuild
  let ours = rows.filter((r) => { if (isJuniorRow(r)) { diag.juniorsDropped++; out.set(r, 'junior'); return false; } return true; })
    .map((r) => { const c = { ...r }; orig.set(c, r); return c; });
  for (const r of ours) {
    if (/Stuttgart/.test(r.tournament || '') && String(r.date || '').slice(5, 7) === '06' && r.level === 'atp' && r.surface === 'clay') { r.surface = 'grass'; diag.stuttgartFixed++; }
  }
  const te = teRowsOf(teRec);
  const { pairs, teOnly, oursOnly } = pairRows(te, ours);
  for (const { te: t, ours: r } of pairs) {
    diag.paired++;
    const cs = conflictsOf(t, r);
    for (const c of cs) { const k = c.kind + (c.sub ? ' · ' + c.sub : ''); diag.conflicts[k] = (diag.conflicts[k] || 0) + 1; }
    if (cs.length) r.conflicts = cs.map((c) => ({ ...c, src: r.src === 'fixtures' ? 'api-tennis' : r.src }));
    r.te = { season: t.season, court: t.court, surface: t.surface, event: t.event, cat: t.cat, teMatchId: t.teMatchId || null };
    if (String(t.season) !== String(r.year)) { r.year = String(t.season); diag.seasonMoves++; }
    if (t.court) {
      const ind = t.court === 'indoor';
      if (r.indoor === true || r.indoor === false) { if (r.indoor !== ind) diag.indoorOverrides++; } else diag.indoorSet++;
      r.indoor = ind;
    }
    if (t.court === 'outdoor' && t.surface && t.surface !== r.surface) { r.surface = t.surface; diag.surfaceFromTe++; }
    if (!t.wo && !!t.won !== !!r.won) { r.won = !!t.won; diag.resultFromTe++; }
    if (t.wo && !r.walkover) r.teWalkover = true;     // TE calls it a walkover: flagged, counted out below
    if (t.cat === 'Exhibition') r.teExhibition = true;
    // an 'Other' TE event that pairs with an api-tennis or archive row: the official source proves the event; kept,
    // counted and flagged (`teOther`) so the classification gap is visible
    if (t.cat === 'Other') { r.teOther = t.event; diag.otherKeptByPair = (diag.otherKeptByPair || 0) + 1; }
  }
  const added = [];
  for (const t of teOnly) {
    if (t.wo) { diag.walkoversSkipped++; continue; }
    if (t.cat === 'Exhibition') { diag.exhibitionsSkipped++; continue; }
    // 'Other': counted only for a class the founder ruled in (OTHER_COUNTED); every other one is listed, not counted
    if (t.cat === 'Other' && OTHER_COUNTED.has(t.event)) diag.otherCounted = (diag.otherCounted || 0) + 1;
    else if (t.cat === 'Other') { diag.otherSkipped = (diag.otherSkipped || 0) + 1; (diag.otherEvents = diag.otherEvents || {})[t.event] = ((diag.otherEvents || {})[t.event] || 0) + 1; continue; }
    added.push(teOnlyRow(t)); diag.added++; diag.addedByCat[t.cat] = (diag.addedByCat[t.cat] || 0) + 1;
  }
  // one match = one row: an unpaired row of ours that repeats a paired row (same day, opponent, result) is a duplicate
  // in our source (TML lists some Davis Cup rubbers twice) — dropped and counted, not counted twice
  const pairedKey = new Set(pairs.map(({ ours: r }) => `${r.date}|${ourSurname(r.opponent)}|${!!r.won}`));
  // founder ruling TEN-449 (2026-10-19): for a player joined on his date of birth, the record counts only what TE lists;
  // our rows TE lacks stay visible in the drill, marked "not in Tennis Explorer, not counted". A player joined without a
  // DOB (the named exception, Svajda) keeps counting them. A near-miss DOB join (NEAR_MISS_DOB) is a DOB-joined player.
  // The exceptions are by player key, never "any record without a DOB": a store record with no DOB, or a DOB short of
  // yyyymmdd, for anyone else is a join the DOB rule forbids, and the run stops rather than count on it.
  const refusal = teIdentityRefusal(teRec);
  if (refusal) throw new Error(refusal);
  const teOnlyCounts = !!teRec.dob;
  for (const r of oursOnly) {
    if (pairedKey.has(`${r.date}|${ourSurname(r.opponent)}|${!!r.won}`)) { out.set(orig.get(r), 'duplicate'); diag.duplicatesDropped = (diag.duplicatesDropped || 0) + 1; continue; }
    diag.oursOnly++;
    if (/\bwomen\b|\bW\d{2,3}\b/i.test(r.tournament || '')) diag.womensEventRows = (diag.womensEventRows || 0) + 1;
    if (teOnlyCounts) { out.set(orig.get(r), 'not-in-te'); diag.notInTeNotCounted = (diag.notInTeNotCounted || 0) + 1; }
  }
  for (const r of ours) {
    if (r.teWalkover) out.set(orig.get(r), 'walkover');
    else if (r.teExhibition) out.set(orig.get(r), 'exhibition');
  }
  const kept = ours.filter((r) => !out.has(orig.get(r)));
  const copyOf = new Map(kept.map((c) => [orig.get(c), c]));
  const merged = kept.concat(added).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return { rows: merged, copyOf, out, added, diag };
}

// The shard's `record` block, from the FINAL feed rows (call after every later pass has run on them):
//   over  [[i, {year?, surface?, indoor?, won?, conflicts?}]]  — matches[i] in the record, with what TE changed on it;
//         a row of matches in neither `over` nor `out` counts in the record exactly as it is
//   out   [[i, reason]]  — matches[i] is not in the record (reasons above)
//   add   [row]          — TE-only rows, in the career-history row shape (src 'te')
// The page's season drill applies it (player-profile-v2.js recordRowsOf); nothing else reads it.
const RECORD_FIELDS = ['year', 'surface', 'indoor', 'won', 'conflicts'];
function recordLayer(matches, m) {
  const over = [], outL = [];
  matches.forEach((r, i) => {
    const why = m.out.get(r);
    if (why) { outL.push([i, why]); return; }
    const c = m.copyOf.get(r);
    if (!c) return;
    const d = {};
    for (const f of RECORD_FIELDS) {
      const a = c[f], b = r[f];
      if (f === 'indoor' ? (a === true) !== (b === true) : JSON.stringify(a) !== JSON.stringify(b)) d[f] = f === 'indoor' ? a === true : a;
    }
    if (Object.keys(d).length) over.push([i, d]);
  });
  return { v: 1, over, out: outL, add: m.added };
}

// The season table rebuilt from the merged rows — cells and lists from ONE set of rows (TEN-442). Every season row
// carries the tier split and the indoor split (TE's court class), pre-2021 included; a cell with no matches is null
// (the page prints a dash), never 0–0. Walkovers and alternate formats were already kept out of the row set's counts
// by the caller's rules; here every row counts.
function careerByYearFromRows(rows) {
  const blank = () => ({ won: 0, lost: 0 });
  const split = () => ({ total: blank(), clay: blank(), hard: blank(), grass: blank(), indoor: { total: blank(), clay: blank(), hard: blank(), grass: blank() } });
  const by = {};
  for (const r of rows) {
    const y = String(r.year || ''); if (!/^\d{4}$/.test(y)) continue;
    const b = by[y] || (by[y] = { all: split(), atp: split(), chitf: split(), rows: 0, atpOnly: true });
    const wl = r.won ? 'won' : 'lost';
    b.rows++; if (r.src !== 'archive') b.atpOnly = false;
    for (const sp of [b.all, b[r.level === 'atp' ? 'atp' : 'chitf']]) {
      sp.total[wl]++;
      if (sp[r.surface]) sp[r.surface][wl]++;
      if (r.indoor === true) { sp.indoor.total[wl]++; if (sp.indoor[r.surface]) sp.indoor[r.surface][wl]++; }
    }
  }
  const cell = (c) => (c.won + c.lost ? { won: c.won, lost: c.lost } : null);
  const out = (sp) => {
    const ind = { total: cell(sp.indoor.total), clay: cell(sp.indoor.clay), hard: cell(sp.indoor.hard), grass: cell(sp.indoor.grass) };
    const o = { total: cell(sp.total), clay: cell(sp.clay), hard: cell(sp.hard), grass: cell(sp.grass), indoor: ind.total ? ind : null };
    return o.total ? o : null;
  };
  return Object.keys(by).sort((a, b) => b.localeCompare(a)).map((y) => {
    const b = by[y], all = out(b.all);
    return { year: y, allTier: true, ...all, atp: out(b.atp), chitf: out(b.chitf), rows: b.rows, atpOnly: b.atpOnly, te: true };
  });
}

module.exports = { pairRows, conflictsOf, teRowsOf, applyTeHistory, recordLayer, careerByYearFromRows, teOnlyRow, isJuniorRow, ourSurname, teSurname, similar, OTHER_COUNTED, NO_DOB_EXCEPTION, NEAR_MISS_DOB, teIdentityRefusal };
