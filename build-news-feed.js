// News feed generator (TEN-8 / ten8-news-ticker, men's-only filter added on
// ten8-news-updates).
//
// Produces `news-feed.json` — api-tennis's `get_news` output over a rolling
// multi-day window, FILTERED to men's ATP tour + men's Challenger content only.
// WTA, ITF, juniors, wheelchair and any clearly women's-tennis articles are
// dropped before the file is written (founder request, 2026-07-27). Article
// bodies themselves are never edited — filtering only decides keep-vs-drop.
//
// Data source: api-tennis get_news?date_start=<YYYY-MM-DD>&date_stop=<YYYY-MM-DD>
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
 * Men's-only filter (ten8-news-updates)
 *
 * The api-tennis structured entity fields (player_name, tournament_name, …)
 * arrive null, so gender/tour is inferred from the article text. The decision
 * is TITLE-FIRST — the headline is what an article is "about", so a men's story
 * that mentions a woman in passing (e.g. "Tommy Paul on facing Alcaraz")
 * survives, while a WTA story that name-drops a man (e.g. "Sabalenka on
 * Djokovic's return") is dropped by its women marker.
 * ------------------------------------------------------------------------- */

// Female / non-men's-tour markers. ITF, juniors and wheelchair are dropped
// wholesale per the founder brief (the product is men's ATP + Challenger only).
const RE_WOMEN  = /\bWTA\b|\bwom[ae]n\b|\bwomen.?s\b|\bfemale\b|\bladies\b|\bgirls\b/i;
const RE_NONMEN = /\bITF\b|\bjuniors?\b|\bwheelchair\b|\bboys\b|\bmixed doubles\b/i;
// Explicit men's-tour markers (Davis Cup is a men's team event).
const RE_MEN    = /\bATP\b|\bchallenger\b|\bmen.?s\b|\bdavis cup\b/i;

// Build a word-boundary regex of current ATP surnames from player-profiles.json
// (names are stored "D. Schwartzman" → surname "Schwartzman"). Best-effort: if
// the file is missing at build time the filter falls back to markers only, which
// keeps every explicitly-ATP/Challenger article but drops player-name-only
// men's headlines — a safe degradation (never keeps women's content).
function loadAtpNameRegex() {
  try {
    const roster = JSON.parse(fs.readFileSync('player-profiles.json', 'utf8')).players || {};
    const surnames = new Set();
    for (const v of Object.values(roster)) {
      const n = (v && v.name ? String(v.name) : '').trim();
      if (!n) continue;
      const surname = n.replace(/^[A-Z]\.\s*/, '').trim(); // strip leading "D. "
      if (surname.length >= 4) surnames.add(surname);
    }
    if (!surnames.size) return null;
    const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('\\b(' + [...surnames].map(esc).join('|') + ')\\b', 'i');
  } catch (_) {
    return null; // marker-only fallback
  }
}

// Returns true if the article is men's ATP/Challenger content worth keeping.
function classifyMens(article, atpNameRe) {
  const title = article && article.title ? String(article.title) : '';
  const body  = article && article.content ? String(article.content) : '';
  const namesAtp = t => !!atpNameRe && atpNameRe.test(t);

  // 1. Title level — the subject of the piece.
  if (namesAtp(title) || RE_MEN.test(title)) return true;          // clearly men's
  if (RE_WOMEN.test(title) || RE_NONMEN.test(title)) return false; // clearly women's / non-men's

  // 2. Neutral headline — fall back to the body. Keep only if the body is
  //    clearly men's AND carries no women/non-men's marker.
  const bodyWomen = RE_WOMEN.test(body) || RE_NONMEN.test(body);
  if ((RE_MEN.test(body) || namesAtp(body)) && !bodyWomen) return true;
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

  // Men's-only filter: keep ATP tour + Challenger men's content, drop WTA / ITF
  // / juniors / wheelchair / women's. Article bodies are never altered.
  const atpNameRe = loadAtpNameRegex();
  const kept = articles.filter(a => classifyMens(a, atpNameRe));
  const total = articles.length;
  const survivalPct = total ? (100 * kept.length / total).toFixed(1) : '0.0';
  console.log(`news-feed: men's filter kept ${kept.length}/${total} articles (${survivalPct}%)` +
    (atpNameRe ? '.' : ' — WARNING: player-profiles.json unavailable, marker-only fallback.'));

  // Newest first purely so the page doesn't have to sort a large list on every
  // open — no kept articles are altered.
  const sorted = kept.sort((a, b) =>
    String(b.published_at || '').localeCompare(String(a.published_at || '')));

  const out = {
    generatedAt: now.toISOString(),
    window: { start: dateStart, stop: dateStop },
    filter: 'mens-atp-challenger',
    countRaw: total,
    count: sorted.length,
    articles: sorted,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(out));
  console.log(`news-feed: wrote ${sorted.length} articles to ${OUT_PATH} (${dateStart}..${dateStop}).`);
}

main().catch(err => {
  // Never let this break the deploy.
  console.error('news-feed: unexpected error —', err && err.message);
});
