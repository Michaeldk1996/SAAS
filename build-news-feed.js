// News feed generator (TEN-8 / ten8-news-ticker; precise ATP-main-tour content
// filter added on ten8-news-updates).
//
// Produces `news-feed.json` — api-tennis's `get_news` output over a rolling
// multi-day window, FILTERED to ATP MAIN TOUR content worth a serious bettor's
// attention (founder brief, 2026-07-27). This replaces the earlier broad
// men's-ATP+Challenger filter with a narrower content filter:
//
//   KEEP  — ATP main-tour (250/500/Masters 1000/Grand Slam) match reports; draw
//           reveals & match previews; withdrawals & injury news; coaching
//           changes; player quotes / press-conference / analyst commentary;
//           rankings & seedings; top-player prep / schedule / entry decisions.
//   DROP  — historical / "On This Day" pieces; anti-doping / medication /
//           governance / tour-politics / legal stories; Challenger & ITF match
//           reports and draws; WTA / women's tennis; administrative & business
//           stories unless directly player-affecting.
//
// Article bodies themselves are never edited — filtering only decides
// keep-vs-drop. See classifyKeep() for the exact decision order.
//
// Data source (feed): api-tennis get_news?date_start=<YYYY-MM-DD>&date_stop=<YYYY-MM-DD>
// returns a `result` array of article objects. Each object carries (as of
// 2026-07): news_key, title, content (full body), published_at, sources, and a
// set of optional entity/player/tournament/event fields — which in practice
// come back EMPTY/null, so the tour/gender of an article can only be inferred
// from its title + body text. The filter below is therefore text-based: it uses
// explicit tour markers (ATP / Challenger / WTA / ITF / …) plus an ATP-player
// surname list (loaded from player-profiles.json) to recognise men's stories
// whose headline names a player without saying "ATP" (e.g. "Sinner skips
// Montreal"). See classifyMens() for the exact decision order.
//
// Decoupled from the main pipeline on purpose and run best-effort (`|| true` in
// the workflow): if this fails, the site still deploys and the previous
// news-feed.json (from the last good run) is kept. get_news uses the SAME
// API_TENNIS_KEY secret the rest of the pipeline already uses.

const fs = require('fs');
try { require('dotenv').config({ quiet: true }); } catch (_) { /* dotenv optional */ }

const API_TENNIS_KEY = process.env.API_TENNIS_KEY;
const API_TENNIS_BASE = 'https://api.api-tennis.com/tennis/';
const OUT_PATH = 'news-feed.json';

// Rolling query window. The News page only shows the last 48-72h, but we pull a
// slightly wider window so that band is always fully covered even if a run is
// delayed or the feed backdates an article by a day.
const WINDOW_DAYS = 5;

function ymd(d) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

/* ---------------------------------------------------------------------------
 * ATP-main-tour content filter (ten8-news-updates, 2026-07-27 rewrite)
 *
 * The api-tennis structured entity fields (player_name, tournament_name, …)
 * arrive null, so tour / topic is inferred from the article text. The decision
 * is TITLE-FIRST — the headline is what an article is "about". Hard DROP rules
 * are applied to the title before any KEEP rule, so a doping or "On This Day"
 * piece that happens to name an ATP player is still dropped (the founder wants
 * those gone regardless of who they mention). A neutral headline falls back to
 * the body. Off-court DROP rules deliberately do NOT include "injury" or
 * "withdraw" — those are KEEP topics.
 * ------------------------------------------------------------------------- */

// --- Hard DROP markers (checked on the TITLE first) -------------------------
// Historical / "On This Day" — founder listed these terms explicitly ("in the
// title"). Decade patterns cover "1970s/80s/90s/2000s" written either way.
const RE_HISTORICAL = /\bon this day\b|\bhistory\b|\byears ago\b|\banniversary\b|\bclassic\b|\b(?:19[6-9]0s|20[0-2]0s)\b|\b[6-9]0s\b|\bthrowback\b|\bretro\b|\blegend[s]?\b/i;
// WTA / women's tennis (already filtered before this rewrite).
const RE_WOMEN  = /\bWTA\b|\bwom[ae]n\b|\bwomen.?s\b|\bfemale\b|\bladies\b|\bgirls\b/i;
// Lower tiers — Challenger & ITF match reports/draws are now DROPPED, plus
// juniors / wheelchair / mixed doubles / exhibition.
const RE_LOWERTIER = /\bITF\b|\bchallenger\b|\bjuniors?\b|\bwheelchair\b|\bboys\b|\bexhibition\b|\bmixed doubles\b/i;
// Off-court: anti-doping / medication / governance / tour-politics / legal.
// Intentionally NARROW so injury & withdrawal (KEEP topics) are never caught.
const RE_OFFCOURT = /\banti-?doping\b|\bdoping\b|\bPEDs?\b|\bbanned substance\b|\bfailed (?:a )?(?:drug|doping) test\b|\bITIA\b|\bwada\b|\btribunal\b|\bgovernance\b|\btour politics\b|\bpolitic(?:s|al)\b|\blawsuit\b|\bantitrust\b|\bcourt case\b|\bPTPA\b|\ballegation[s]?\b|\bboycott\b|\bprize[- ]money (?:dispute|row|fight)\b/i;
// Administrative / business — DROP unless the headline also names an ATP player
// (a rough "directly player-affecting" proxy).
const RE_BUSINESS = /\bsponsor(?:ship)?\b|\bbroadcast\b|\bTV deal\b|\brights deal\b|\brevenue\b|\bprize[- ]money pool\b|\bATP board\b|\bboard of\b|\bmerger\b|\backquisition\b|\bearnings\b/i;

// --- KEEP markers -----------------------------------------------------------
// Explicit ATP-main-tour markers: the tour label, Grand Slams, Masters 1000 and
// tour-team events. Challenger is deliberately NOT here (it's a DROP now).
const RE_ATP = /\bATP\b|\bgrand slam\b|\bmasters 1000\b|\bmasters\b|\bATP ?(?:250|500)\b|\bwimbledon\b|\bus open\b|\bfrench open\b|\broland[- ]garros\b|\baustralian open\b|\bdavis cup\b|\batp finals\b|\blaver cup\b|\bmen.?s\b/i;

// Build a word-boundary regex of current ATP surnames from player-profiles.json
// (names are stored "D. Schwartzman" → surname "Schwartzman"). Best-effort: if
// the file is missing at build time the filter falls back to markers only, which
// keeps every explicitly-ATP/Challenger article but drops player-name-only
// men's headlines — a safe degradation (never keeps women's content).
function loadAtpNameRegex() {
  return loadRoster().re;
}

// Load player-profiles.json once and build the three lookups the feed needs:
//   re            — word-boundary surname regex (used by the ATP-tour keep filter)
//   surnameToKeys — lowercase surname -> Set(playerKey); a surname shared by two
//                   roster players maps to >1 key and is therefore unresolvable
//   keyToName     — playerKey -> stored display name ("D. Schwartzman")
// Names are stored "D. Schwartzman", so the surname is the name minus a leading
// initial. Best-effort: a missing file yields empty maps (marker-only degrade).
function loadRoster() {
  try {
    const players = JSON.parse(fs.readFileSync('player-profiles.json', 'utf8')).players || {};
    const surnames = new Set();
    const surnameToKeys = new Map();
    const keyToName = new Map();
    for (const [key, v] of Object.entries(players)) {
      const n = (v && v.name ? String(v.name) : '').trim();
      if (!n) continue;
      keyToName.set(String(key), n);
      const surname = n.replace(/^[A-Z]\.\s*/, '').trim(); // strip leading "D. "
      if (surname.length < 4) continue;
      surnames.add(surname);
      const sl = surname.toLowerCase();
      if (!surnameToKeys.has(sl)) surnameToKeys.set(sl, new Set());
      surnameToKeys.get(sl).add(String(key));
    }
    let re = null;
    if (surnames.size) {
      const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      re = new RegExp('\\b(' + [...surnames].map(esc).join('|') + ')\\b', 'i');
    }
    return { re, surnameToKeys, keyToName };
  } catch (_) {
    return { re: null, surnameToKeys: new Map(), keyToName: new Map() };
  }
}

/* ---------------------------------------------------------------------------
 * Player attribution AT SOURCE (TEN-8, founder directive 2026-07-30).
 *
 * The feed's structured `player_key` / `player_name` fields ship NULL on every
 * article (measured: 91/91), so the render layer used to derive a chip from the
 * headline at paint time. The founder's ruling: populate player_key in the
 * pipeline so the chip is DATA, not render-time NLP — and gate it fail-closed.
 *
 * Fail-closed rule (an absent chip costs nothing; a wrong one misattributes a
 * result to a player who wasn't in the match):
 *   1. The title contains EXACTLY ONE distinct in-roster surname.
 *   2. That surname leads the headline — it is the first named entity, proxied
 *      as first-word or second-word position (allowing an optional first-name /
 *      initial token before it, e.g. "Jannik Sinner …").
 *   3. The surname resolves to EXACTLY ONE roster key (a surname shared by two
 *      roster players is ambiguous and gets no chip).
 * Anything else → { player_key:null, player_name:null }. Derivation stays
 * title-only, so a player merely mentioned mid-body is never credited.
 * ------------------------------------------------------------------------- */
function derivePlayer(title, roster) {
  const NONE = { player_key: null, player_name: null };
  if (!roster || !roster.surnameToKeys || !roster.surnameToKeys.size) return NONE;
  const tokens = (String(title || '').match(/[A-Za-zÀ-ÿ'’-]+/g) || []).map(t => t.toLowerCase());
  const matched = new Map(); // surnameLower -> first word index
  tokens.forEach((w, i) => {
    if (roster.surnameToKeys.has(w) && !matched.has(w)) matched.set(w, i);
  });
  if (matched.size !== 1) return NONE;            // exactly one in-roster surname
  const [sl, idx] = [...matched.entries()][0];
  if (idx > 1) return NONE;                        // must lead the headline
  const keys = roster.surnameToKeys.get(sl);
  if (!keys || keys.size !== 1) return NONE;       // unambiguous key only
  const key = [...keys][0];
  return { player_key: key, player_name: roster.keyToName.get(key) || null };
}

// Returns true if the article is ATP-main-tour content worth keeping.
function classifyKeep(article, atpNameRe) {
  const title = article && article.title ? String(article.title) : '';
  const body  = article && article.content ? String(article.content) : '';
  const namesAtp = t => !!atpNameRe && atpNameRe.test(t);

  // 1. Hard DROP rules on the TITLE — the subject of the piece. These win over
  //    any KEEP rule, so a doping / historical / lower-tier story that names an
  //    ATP player is still dropped (founder brief).
  if (RE_HISTORICAL.test(title)) return false; // On This Day / anniversary / classic
  // A concrete PAST year in the headline (e.g. "the 2009 US Open") marks a
  // retrospective, not current news. This year and later (a 2026 preview, the
  // 2028 Olympics) are legitimate, so only years <= currentYear-2 are dropped.
  const yr = title.match(/\b(?:19\d\d|20[0-3]\d)\b/);
  if (yr && Number(yr[0]) <= new Date().getFullYear() - 2) return false;
  if (RE_WOMEN.test(title))      return false; // WTA / women's
  if (RE_LOWERTIER.test(title))  return false; // Challenger / ITF / juniors / …
  if (RE_OFFCOURT.test(title))   return false; // doping / governance / politics / legal
  if (RE_BUSINESS.test(title) && !namesAtp(title)) return false; // business, not player-affecting

  // 2. KEEP if the headline is clearly ATP main tour — either it names a current
  //    ATP player or carries an explicit ATP / Grand Slam / Masters marker.
  if (namesAtp(title) || RE_ATP.test(title)) return true;

  // 3. Neutral headline — fall back to the body, FAIL-CLOSED (TEN-8, men's-pill
  //    correctness fix 2026-07-30). The page banners "ATP MEN'S", but the feed
  //    ships no populated tour/gender field to enforce that, so a WTA article
  //    with a neutral headline that merely mentioned "ATP" once in its body used
  //    to leak in under the men's banner. A neutral headline gives us no subject
  //    to anchor on, so we now require BOTH an explicit ATP marker AND a named
  //    ATP-roster player in the body (was: either), plus no women's / lower-tier
  //    / off-court / historical marker anywhere. Better to drop a genuinely-ATP
  //    neutral-title piece than to file a women's result under a men's banner.
  const bodyBlocked = RE_WOMEN.test(body) || RE_LOWERTIER.test(body) ||
    RE_OFFCOURT.test(body) || RE_HISTORICAL.test(body);
  if (RE_ATP.test(body) && namesAtp(body) && !bodyBlocked) return true;
  return false;
}

async function main() {
  if (!API_TENNIS_KEY) {
    console.error('news-feed: API_TENNIS_KEY not set — skipping (site deploy unaffected).');
    return;
  }

  const now = new Date();
  const start = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const dateStart = ymd(start);
  const dateStop = ymd(now);

  const url = `${API_TENNIS_BASE}?method=get_news&APIkey=${API_TENNIS_KEY}` +
    `&date_start=${dateStart}&date_stop=${dateStop}`;

  let payload;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = JSON.parse(await res.text()); // manual parse: catch mid-write / partial reads
  } catch (err) {
    console.error(`news-feed: fetch failed (${err.message}) — keeping previous ${OUT_PATH}.`);
    return;
  }

  // get_news signals a param/quota problem via { error: "1", result: [ ...msgs ] }.
  // Anything without a plain article array is treated as a failure so we never
  // overwrite a good file with an error envelope.
  const articles = payload && Array.isArray(payload.result) ? payload.result : null;
  if (!articles) {
    console.error('news-feed: unexpected response shape — keeping previous file. Body:',
      JSON.stringify(payload).slice(0, 300));
    return;
  }

  // ATP-main-tour content filter: keep ATP 250/500/Masters/Slam content worth a
  // bettor's attention; drop historical, doping/governance/legal, Challenger/ITF,
  // WTA and non-player-affecting business stories. Article bodies are never altered.
  const roster = loadRoster();
  const kept = articles.filter(a => classifyKeep(a, roster.re));
  const total = articles.length;
  const survivalPct = total ? (100 * kept.length / total).toFixed(1) : '0.0';
  console.log(`news-feed: ATP-main-tour filter kept ${kept.length}/${total} articles (${survivalPct}%)` +
    (roster.re ? '.' : ' — WARNING: player-profiles.json unavailable, marker-only fallback.'));

  // Populate player_key / player_name AT SOURCE (the feed ships them null). The
  // render layer reads these as data instead of re-deriving from the headline.
  let chipCount = 0;
  for (const a of kept) {
    const d = derivePlayer(a.title, roster);
    a.player_key = d.player_key;
    a.player_name = d.player_name;
    if (d.player_key != null) chipCount++;
  }
  console.log(`news-feed: player_key derived (fail-closed) for ${chipCount}/${kept.length} kept articles.`);

  // Newest first purely so the page doesn't have to sort a large list on every
  // open — no kept articles are altered.
  const sorted = kept.sort((a, b) =>
    String(b.published_at || '').localeCompare(String(a.published_at || '')));

  const out = {
    generatedAt: now.toISOString(),
    window: { start: dateStart, stop: dateStop },
    filter: 'atp-main-tour',
    countRaw: total,
    count: sorted.length,
    articles: sorted,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(out));
  console.log(`news-feed: wrote ${sorted.length} articles to ${OUT_PATH} (${dateStart}..${dateStop}).`);
}

// Run only when invoked directly (`node build-news-feed.js`); when required as a
// module (tests) just expose the classifier so its behaviour can be checked
// without a live fetch.
if (require.main === module) {
  main().catch(err => {
    // Never let this break the deploy.
    console.error('news-feed: unexpected error —', err && err.message);
  });
}

module.exports = { classifyKeep, loadAtpNameRegex, loadRoster, derivePlayer };
