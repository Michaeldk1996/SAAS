#!/usr/bin/env node
// Polymarket's own per-match totals (founder 2026-11-01, task "telegram-bot-scope" follow-up): the total traded on each
// ATP match, from Polymarket's public Gamma API (no key), for
//   (1) the Market Signal panel on the Today's Matches cards: polymarket.json, keyed by the board card's api-tennis event
//       key — one line "Polymarket · $X traded", shown only for a confident join;
//   (2) the 🔵 POLYMARKET DROP Telegram alert: every Polymarket ATP match written to poly_bot.volume through
//       public.poly_volume_ingest (tools/poly-drop-bot.sql), which joins it to the alert on the same name rule.
// Join (never a guess): both surnames equal (drops_scope.sk) and the given-name initials agree (drops_scope.same), in
// either order, and the start within 36 h; exactly one Polymarket match for the card AND exactly one card for that
// Polymarket match, else nothing. Volume = the Polymarket event's `volume` (every market on that match, dollars);
// volumeMl = the match-winner market's own volume; liquidity = the match-winner market's whole order book (every price,
// both sides, dollars — Polymarket's `liquidity`; founder 2026-11-01: "just that market").
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY (the DB write; without them only the file is written). Args: board file
// (default matches.json), out file (default polymarket.json). Exit 0 written, 1 failed (the pipeline step checks it).
import fs from 'node:fs';

const GAMMA = 'https://gamma-api.polymarket.com';
export const ATP_SERIES = '10365';           // Polymarket "ATP Tour" series (gamma /sports, measured 1 Nov 2026)

// ── the scope's name keys, ported from tools/drops-scope.sql (the bot joins with the SQL ones) ──
export const deaccent = (n) => String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
export function sk(n) {
  let v = deaccent(n).split(',')[0].replace(/-/g, ' ').trim();
  v = v.replace(/\s+(jr|sr|ii|iii|iv)\.?$/i, '').replace(/^.*\s/, '').replace(/[^A-Za-z]/g, '').toLowerCase();
  return v || null;
}
export function inits(n) {
  const v = deaccent(n).toLowerCase();
  const given = v.includes(',') ? v.slice(v.indexOf(',') + 1) : ((v.trim().match(/^(.*)\s\S+$/) || [])[1] || '');
  return [...new Set((given.match(/[a-z]+/g) || []).map((w) => w[0]))];
}
export function same(x, y) {
  const a = sk(x);
  if (!a || a !== sk(y)) return false;
  const ix = inits(x), iy = inits(y);
  return !ix.length || !iy.length || ix.some((c) => iy.includes(c));
}

// Berlin wall clock → instant (api-tennis card date/time); the board's startTs wins when present.
export function cardStartMs(m, berlinWallMs) {
  if (m && Number.isFinite(Date.parse(m.startTs || ''))) return Date.parse(m.startTs);
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(m.date || '')) return NaN;
  return berlinWallMs(m.date, /^\d{1,2}:\d{2}$/.test(m.time || '') ? m.time : '12:00');
}
export const eventKeyOf = (m) => { const id = String(m && m.id != null ? m.id : ''); const i = id.indexOf('-'); return i >= 0 ? id.slice(i + 1) : id; };

// One Polymarket ATP match per event: the match-winner market (two outcomes = the two players).
export function polyMatches(events) {
  const out = [];
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || !/^atp-/.test(e.slug || '') || !/ vs /.test(e.title || '')) continue;
    const mk = (e.markets || []).find((m) => {
      let o; try { o = JSON.parse(m.outcomes || '[]'); } catch { o = []; }
      return o.length === 2 && String(m.question || '') === String(e.title || '');
    });
    if (!mk) continue;
    const [a, b] = JSON.parse(mk.outcomes);
    if (!a || !b || a === 'Yes' || b === 'Yes') continue;
    const slugDay = ((e.slug || '').match(/(\d{4}-\d{2}-\d{2})$/) || [])[1];
    const start = Date.parse(mk.gameStartTime || '') || (slugDay ? Date.parse(slugDay + 'T12:00:00Z') : NaN);
    const vol = Number(e.volume), volMl = Number(mk.volumeNum != null ? mk.volumeNum : mk.volume), liq = Number(mk.liquidityNum != null ? mk.liquidityNum : mk.liquidity);   // the match-winner market's whole book (founder 2026-11-01)
    out.push({ slug: e.slug, title: e.title, a, b, startMs: start, startExact: !!Date.parse(mk.gameStartTime || ''),
      volume: Number.isFinite(vol) ? vol : null, volumeMl: Number.isFinite(volMl) ? volMl : null,
      liquidity: Number.isFinite(liq) ? liq : null, closed: !!e.closed });
  }
  return out;
}

// card ↔ Polymarket match, one-to-one only. A start known only by its slug day is allowed 36 h either way.
export function joinBoard(board, poly, startOf) {
  const near = (c, p) => Number.isFinite(c) && Number.isFinite(p) && Math.abs(c - p) < 36 * 3600e3;
  const fits = (m, p) => ((same(m.p1, p.a) && same(m.p2, p.b)) || (same(m.p1, p.b) && same(m.p2, p.a))) && near(startOf(m), p.startMs);
  const byCard = new Map(), byPoly = new Map();
  for (const m of board) for (const p of poly) if (fits(m, p)) {
    (byCard.get(m) || byCard.set(m, []).get(m)).push(p);
    (byPoly.get(p.slug) || byPoly.set(p.slug, []).get(p.slug)).push(m);
  }
  const out = {}; let ambiguous = 0;
  for (const [m, ps] of byCard) {
    if (ps.length !== 1 || byPoly.get(ps[0].slug).length !== 1) { ambiguous++; continue; }
    const p = ps[0], ek = eventKeyOf(m);
    if (!ek) continue;
    out[ek] = { slug: p.slug, volume: p.volume, volumeMl: p.volumeMl, liquidity: p.liquidity };
  }
  return { byEvent: out, ambiguous };
}

// Founder 2026-11-01: a finished match keeps the LAST liquidity read before its start (Kalshi's book is empty once a market
// is finalized — measured on KXATPMATCH-26OCT29SHEKYM; Polymarket's closed markets carry none either). Per card:
//   before the start, a fresh read → that read, stamped now; at / after the start, never a new read (an in-play book is
//   not the pre-match market) → the previous published file's figure if it was read before the start, else none.
// An unknown start takes the fresh read (it cannot be shown to be in play).
export function carryPreStart(byEvent, prev, board, startOf, nowMs = Date.now()) {
  const startByEk = new Map(board.map((m) => [eventKeyOf(m), startOf(m)]));
  const old = (prev && prev.byEvent) || {};
  const out = {};
  for (const [ek, rec] of Object.entries(byEvent)) {
    const st = startByEk.get(ek), p = old[ek];
    const fresh = rec.liquidity != null && (!Number.isFinite(st) || nowMs < st);
    const prevOk = p && p.liquidity != null && Number.isFinite(Date.parse(p.liquidityAt || '')) && (!Number.isFinite(st) || Date.parse(p.liquidityAt) < st);
    out[ek] = fresh ? { ...rec, liquidityAt: new Date(nowMs).toISOString() }
      : prevOk ? { ...rec, liquidity: p.liquidity, liquidityAt: p.liquidityAt }
      : { ...rec, liquidity: null, liquidityAt: null };
  }
  return out;
}
export async function fetchPublished(file) {
  try { const r = await fetch(`https://michaeldk1996.github.io/SAAS/${file}?cb=${Date.now()}`, { signal: AbortSignal.timeout(60e3) }); return r.ok ? await r.json() : null; }
  catch { return null; }
}

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30e3), headers: { 'User-Agent': 'stennisfy-pipeline' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url.replace(GAMMA, '')}`);
  return r.json();
}
// Open ATP events (paged) + the most recent closed ones (finished matches still on the board).
export async function fetchEvents(get = getJson) {
  const all = [];
  for (let off = 0; off < 2000; off += 500) {
    const page = await get(`${GAMMA}/events?series_id=${ATP_SERIES}&closed=false&limit=500&offset=${off}`);
    if (!Array.isArray(page)) throw new Error('open events: not a list');
    all.push(...page);
    if (page.length < 500) break;
  }
  const closed = await get(`${GAMMA}/events?series_id=${ATP_SERIES}&closed=true&limit=300&order=startDate&ascending=false`);
  if (!Array.isArray(closed)) throw new Error('closed events: not a list');
  return all.concat(closed);
}

function writeAtomic(path, obj) {
  const tmp = path + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, path);
}

async function main() {
  const [boardPath = 'matches.json', outPath = 'polymarket.json'] = process.argv.slice(2);
  const { berlinWallMs } = await import(new URL('../berlin-time.js', import.meta.url)).then((m) => m.default || m);
  let board;
  try { const j = JSON.parse(fs.readFileSync(boardPath, 'utf8')); board = Array.isArray(j) ? j : (j.matches || []); }
  catch (e) { console.log(`::error::polymarket: cannot read ${boardPath} (${e.message}) — nothing written`); process.exit(1); }
  let events;
  try { events = await fetchEvents(); }
  catch (e) { console.log(`::error::polymarket: Gamma API failed (${e.message}) — nothing written; the cards and alerts show no volume`); process.exit(1); }
  const poly = polyMatches(events);
  const startOf = (m) => cardStartMs(m, berlinWallMs);
  const joined = joinBoard(board, poly, startOf);
  const prev = await fetchPublished('polymarket.json');
  const byEvent = carryPreStart(joined.byEvent, prev, board, startOf), ambiguous = joined.ambiguous;
  const out = { generatedAt: new Date().toISOString(), source: 'Polymarket Gamma API (public), ATP Tour series ' + ATP_SERIES,
    counts: { polymarketMatches: poly.length, boardCards: board.length, joined: Object.keys(byEvent).length, ambiguous,
      withLiquidity: Object.values(byEvent).filter((r) => r.liquidity != null).length, previousFile: !!prev }, byEvent };
  writeAtomic(outPath, out);
  console.log(`polymarket: ${poly.length} Polymarket ATP matches; ${Object.keys(byEvent).length} of ${board.length} board cards joined, ${ambiguous} ambiguous (left out)`);

  const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: key } = process.env;
  if (!url || !key) { console.log('polymarket: no SUPABASE_URL / SUPABASE_SECRET_KEY — the alert volumes were not written'); return; }
  const rows = poly.map((p) => ({ slug: p.slug, a: p.a, b: p.b, start: Number.isFinite(p.startMs) ? new Date(p.startMs).toISOString() : null,
    volume: p.volume, volume_ml: p.volumeMl, liquidity: p.liquidity }));
  const r = await fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/poly_volume_ingest', {
    method: 'POST', signal: AbortSignal.timeout(60e3),
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_rows: rows }),
  }).catch((e) => ({ ok: false, status: e.name, text: async () => '' }));
  if (!r.ok) {
    const why = String(await r.text().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ');
    console.log(`::error::polymarket: volume ingest failed (HTTP ${r.status}) ${why} — the alerts show "—" for traded`); process.exit(1);
  }
  console.log(`polymarket: ${rows.length} match volumes written for the drop alerts`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
