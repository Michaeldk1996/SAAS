// News ticker — the feed's storage rules (pure; tested by tools/test-news-ticker-live.mjs).
//
//   news-ticker/<tournamentKey>-<season>.json   every item of one tournament edition, kept permanently
//   news-ticker.json                            a small index: the tournaments and the newest items
//
// An item, once published, is never rewritten by a later run unless its source data changed: each item carries a
// `sourceHash` over its content; a fresh build with the same hash leaves the stored object byte for byte as it was. A
// changed hash replaces the content, keeps `publishedAt`, and stamps `revisedAt` + `revision`. An item the run did not
// rebuild (its match left the board) is kept as it is. Nothing is ever removed.
import crypto from 'node:crypto';

const VOLATILE = new Set(['publishedAt', 'revisedAt', 'revision', 'sourceHash']);
export function hashItem(item) {
  const o = {};
  for (const k of Object.keys(item).sort()) if (!VOLATILE.has(k)) o[k] = item[k];
  return crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 16);
}

// -> { items, added, revised, unchanged }
export function mergeItems(existing, fresh, nowIso) {
  const byId = new Map((existing || []).map((x) => [x.id, x]));
  let added = 0, revised = 0, unchanged = 0;
  for (const f of fresh || []) {
    const h = hashItem(f), old = byId.get(f.id);
    if (!old) { byId.set(f.id, { ...f, sourceHash: h, publishedAt: nowIso }); added++; continue; }
    if (old.sourceHash === h) { unchanged++; continue; }
    byId.set(f.id, { ...f, sourceHash: h, publishedAt: old.publishedAt, revisedAt: nowIso, revision: (old.revision || 0) + 1 });
    revised++;
  }
  const items = [...byId.values()].sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')) || String(a.id).localeCompare(String(b.id)));
  return { items, added, revised, unchanged };
}

export const fileOf = (key, season) => `news-ticker/${String(key).replace(/[^A-Za-z0-9_-]/g, '')}-${season}.json`;

// The index never loads history: per tournament one line, plus the newest `latest` items across all of them.
// generatedAt = the newest publish / revise time it lists, so an unchanged feed gives a byte-identical index.
export function buildIndex(tournaments, latest = 40) {
  const rows = tournaments.map((t) => {
    const stamps = t.items.flatMap((x) => [x.publishedAt, x.revisedAt]).filter(Boolean).sort();
    const c = t.items.reduce((a, x) => (a[x.type] = (a[x.type] || 0) + 1, a), {});
    return { key: t.key, season: t.season, name: t.name, file: fileOf(t.key, t.season), items: t.items.length, byType: c,
      latestTimestamp: t.items.map((x) => x.timestamp).filter(Boolean).sort().pop() || null, updatedAt: stamps.pop() || null };
  }).sort((a, b) => String(b.latestTimestamp || '').localeCompare(String(a.latestTimestamp || '')) || String(a.file).localeCompare(String(b.file)));
  const all = tournaments.flatMap((t) => t.items.map((x) => ({ ...x, file: fileOf(t.key, t.season) })));
  all.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')) || String(a.id).localeCompare(String(b.id)));
  const generatedAt = rows.map((r) => r.updatedAt).filter(Boolean).sort().pop() || null;
  return { generatedAt, tournaments: rows, latest: all.slice(0, latest) };
}

// Duration: only when both ends were OBSERVED by the live poller.
//   start  play_seen_at, and the match was flagged live on an earlier tick (so play began between two of our ticks);
//   end    decided_seen_at with a last_undecided_seen_at at most MAX_BRACKET_S before it.
// -> { startedAt, endedAt, minutes } | { endedAt } (end only) | null
export const MAX_BRACKET_S = 120;
export function observedTimes(flip, end) {
  const t = (s) => { const n = Date.parse(s); return Number.isFinite(n) ? n : null; };
  const dec = end && t(end.decided_seen_at), und = end && t(end.last_undecided_seen_at);
  const endOk = dec != null && und != null && dec > und && dec - und <= MAX_BRACKET_S * 1000;
  if (!endOk) return null;
  const out = { endedAt: new Date(dec).toISOString() };
  const play = flip && t(flip.play_seen_at), first = flip && t(flip.first_live_seen_at);
  if (play != null && first != null && play > first && dec > play) {
    const min = Math.round((dec - play) / 60000);
    if (min >= 1 && min <= 720) { out.startedAt = new Date(play).toISOString(); out.minutes = min; }
  }
  return out;
}

// Same quote from two outlets = one item. Same player, and the English texts share most of their words.
const words = (t) => new Set(String(t).toLowerCase().match(/[a-z'’]{3,}/g) || []);
export function sameQuote(a, b) {
  if (String(a.playerId) !== String(b.playerId)) return false;
  const A = words(a.text), B = words(b.text);
  if (!A.size || !B.size) return false;
  let n = 0; A.forEach((w) => { if (B.has(w)) n++; });
  return n / Math.min(A.size, B.size) >= 0.8 && Math.min(A.size, B.size) / Math.max(A.size, B.size) >= 0.6;
}
// Keeps the first of each group (callers order: English original first, then earliest) and lists the others on it.
export function dedupeQuotes(quotes) {
  const out = [];
  for (const q of quotes) {
    const hit = out.find((o) => sameQuote(o, q));
    if (!hit) { out.push({ ...q }); continue; }
    if (hit.sourceUrl !== q.sourceUrl) (hit.alsoReportedBy = hit.alsoReportedBy || []).push({ sourceName: q.sourceName, sourceUrl: q.sourceUrl, language: q.language });
  }
  return out;
}
