// News feed generator (TEN-8 / ten8-news-ticker).
//
// Produces `news-feed.json` — the raw output of api-tennis's `get_news`
// endpoint over a rolling multi-day window, stored with NO filtering, NO
// categorisation, and NO tagging. Every article the feed publishes is kept
// verbatim so the dashboard's News page can show the full range of content and
// the founder can decide later what is useful.
//
// Data source: api-tennis get_news?date_start=<YYYY-MM-DD>&date_stop=<YYYY-MM-DD>
// returns a `result` array of article objects. Each object carries (as of
// 2026-07): news_key, title, content (full body), published_at, sources, and a
// set of optional entity/player/tournament/event fields (often null). We store
// these objects exactly as received — the only thing this script adds is a thin
// wrapper (generatedAt + the window it queried) so the page can show freshness
// without touching article content.
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

  // Store everything, untouched. Newest first purely so the page doesn't have to
  // sort a large list on every open — no articles are dropped or altered.
  const sorted = [...articles].sort((a, b) =>
    String(b.published_at || '').localeCompare(String(a.published_at || '')));

  const out = {
    generatedAt: now.toISOString(),
    window: { start: dateStart, stop: dateStop },
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
