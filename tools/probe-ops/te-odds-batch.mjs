#!/usr/bin/env node
// Tennis Explorer · Pinnacle odds batches (founder 2026-10-19: approved steps 0-3, no ITF). Read-only on TE; run by hand.
//
// What one batch does, in order:
//   1. reads its targets from te-targets/ (this repo): api-tennis matches with no price (or, for the calibration batch,
//      with OUR verified close), one level, one date range;
//   2. reads TE's results list (type=atp-single) for every day of the range, +-1 day (TE's day is Prague local time);
//   3. joins each target to ONE TE match: TE date within +-1 day of api-tennis's, BOTH players' names (surname + first
//      initial), exactly one candidate both ways. Two candidates = ambiguous, none = not found: no row, counted;
//   4. reads the match page of each joined match only (never an ITF page: no ITF target exists, and an ITF list row is
//      never a candidate) and keeps Pinnacle's last price and opening price with their timestamps (converted from
//      Prague time to UTC), the books listed, the page's sha256 and when it was fetched.
// It never presents a price as a close: every row is labelled "Pinnacle (approx.)" downstream.
//
// Politeness (as te-scrape.mjs): ONE request at a time, 9-12 s apart (TE_DELAY_MS 9000 + up to 3 s); every page cached in
// ~/.stennisfy/te-cache/html and never fetched twice (a list page for today or later is never read). The FIRST
// non-200, challenge page or empty body STOPS the run (exit 3) — never retried — and writes CACHE/BLOCKED, which stops
// te-scrape too; neither tool starts while it exists. A NETWORK failure (no answer at all: DNS,
// reset, timeout) is tried again up to NET_TRIES times, NET_WAIT_MS (60 s) apart, then STOPS (exit 5). Every request is
// logged with its outcome (the failure's own code) in ~/.stennisfy/te-odds/requests.jsonl. Resumable: re-run the same
// command and it continues from the cache (a cached page is never fetched again; rows are rebuilt from the cache).
// Offline re-check: `--offline` reads the cache only (no request at all) and writes <batch>.offline.json; `--explain N`
// also prints N page-check rejections (target vs page) under the old and the new check. A batch stops itself after --hours (default 8) and says PARTIAL: re-run to continue.
//
// Run (Node 18+, on the Mac; `caffeinate -i` keeps it awake):
//   cd ~/stennisfy-ops && git pull && caffeinate -i node tools/te-odds-batch.mjs calib-01     one batch
//   cd ~/stennisfy-ops && git pull && caffeinate -i node tools/te-odds-batch.mjs --queue      every batch in order, around
//        the clock; stops at the first STOP, after the calibration batch if its median gap is not under 0.30pp, or when done
//   cd ~/stennisfy-ops && git pull && caffeinate -i node tools/te-odds-batch.mjs --queue --supervise
//        the same, restarted only after a NETWORK stop (10 / 20 / 40 min back-off); an error page (403 / 429 included)
//        exits for good. Exit codes: 0 done, 3 error page, 4 calibration held, 5 network (given up), 6 partial (a single
//        batch's --hours budget, a --max-requests probe). With --queue a batch that reaches its budget continues from the cache.
//   node tools/te-odds-batch.mjs --queue --max-requests 1   ONE new request (a probe), then PARTIAL; --net-report shows it
//   node tools/te-odds-batch.mjs calib-01 --offline --explain-notfound   why each unmatched target was not found (cache only)
//   node tools/te-odds-batch.mjs --net-report      what the requests log says (causes, statuses, when failures start)
//   node tools/te-odds-batch.mjs --zone-label      the time-zone label TE printed on the cached pages
//   node tools/te-odds-batch.mjs --list                                                       the batches and their state
//   node tools/te-odds-batch.mjs calib-01 --offline --explain 3 [--save-fixtures]            re-check from the cache only:
//        no request; writes ~/.stennisfy/te-odds/calib-01.offline.json, prints 3 rejections (target vs page), and with
//        --save-fixtures copies a few real cached pages into tools/fixtures/te-calib/ for the test (private repo)
// Out: ~/.stennisfy/te-odds/<batch>.json (always), and, once a batch is COMPLETE, the same file committed and pushed into
//      the private store checkout TE_STORE (default ~/stennisfy-te-store) under te-odds/ (plain push, never --force).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OPS = process.env.TE_OPS || path.dirname(HERE);
const CACHE = process.env.TE_CACHE || path.join(os.homedir(), '.stennisfy', 'te-cache');
const OUTDIR = process.env.TE_ODDS_OUT || path.join(os.homedir(), '.stennisfy', 'te-odds');
const STORE = process.env.TE_STORE || path.join(os.homedir(), 'stennisfy-te-store');
const DELAY = Number(process.env.TE_DELAY_MS || 9000);
const JITTER = 3000;
const BASE = 'https://www.tennisexplorer.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const GATE_PP = 0.30, GATE_N = 30;
const SOURCE = 'Tennis Explorer · Pinnacle';
// a flag's value: the next word, unless there is none or it is another flag (then the default) — `--save-fixtures` last
// on the line crashed with an undefined path before (founder 2026-10-20)
export const argOf = (argv, k, d) => { const i = argv.indexOf(k); const v = i > 0 ? argv[i + 1] : undefined; return v === undefined || v.startsWith('--') ? d : v; };
const arg = (k, d) => argOf(process.argv, k, d);
let HOURS = Number(arg('--hours', 8));
export function setHours(h) { HOURS = h; }
let FETCH = (...a) => fetch(...a);
export function setFetch(f) { FETCH = f; }
// `--max-requests N`: stop (PARTIAL) before the (N+1)th NEW request of this process — `--max-requests 1` = a one-page probe
let MAX_REQ = Number(arg('--max-requests', Infinity)) || Infinity;
export function setMaxRequests(n) { MAX_REQ = n; procRequests = 0; maxHit = false; }
export const procStats = () => ({ procRequests });
let procRequests = 0, maxHit = false;
export const NET_TRIES = Number(process.env.TE_NET_TRIES || 3), NET_WAIT_MS = Number(process.env.TE_NET_WAIT_MS ?? 60000);
let OFFLINE = process.argv.includes('--offline');

// ── fetching ───────────────────────────────────────────────────────────────────────────────────────────────────────
let last = 0, requests = 0, cached = 0, netRetries = 0, started = Date.now(), deadline = Infinity;
export class Stop extends Error {}                      // an error / block PAGE (any non-200, 403 / 429 included): stop for good
export class NetStop extends Stop {}                    // no answer at all, NET_TRIES times in a row: safe to retry later
const REQLOG = () => path.join(OUTDIR, 'requests.jsonl');
// one line per request (the cause of a failure, never a page body): time, path, outcome, ms, bytes, requests since this
// process started — enough to tell a connection reset from a timeout from a throttle, and to see when failures cluster
function logReq(o) { try { fs.mkdirSync(OUTDIR, { recursive: true }); fs.appendFileSync(REQLOG(), JSON.stringify({ t: new Date().toISOString(), run: new Date(started).toISOString(), ...o }) + '\n'); } catch { /* the log never stops a run */ } }
// what a fetch failure really was: Node's fetch says only "fetch failed"; the cause carries the code
export function netCause(e) {
  const c = (e && e.cause) || {};
  return { name: e && e.name, message: e && e.message, code: c.code || (e && e.code) || null, errno: c.errno ?? null, syscall: c.syscall || null,
    causeName: c.name || null, causeMessage: c.message || null };
}
export const causeText = (n) => [n.code, n.causeName && n.causeName !== 'Error' ? n.causeName : null, n.causeMessage || n.message].filter(Boolean).join(' · ');
export class Budget extends Error {}
export class Uncached extends Error {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cacheFile = (rel) => path.join(CACHE, 'html', rel.replace(/^\/+/, '').replace(/[^A-Za-z0-9._-]+/g, '_') + '.html');
export function isErrorPage(status, text) {
  return status !== 200 || !text || text.length < 3000 || /cf-mitigated|Attention Required|captcha|Access denied/i.test(text);
}
// ONE stop for both TE tools on this machine (founder 2026-10-20): an error PAGE (any non-200, 403 / 429 included, a
// challenge page, an empty body) writes CACHE/BLOCKED in te-scrape.mjs's format; while it exists neither tool makes a request
// (te-scrape-agent.sh and te-scrape.mjs already refuse). A person removes it after checking the cause. A network stop (no
// answer at all) never writes it. An --offline re-check reads the cache only and ignores it.
export const blockedFile = () => path.join(CACHE, 'BLOCKED');
export function blockedNote() { try { return fs.readFileSync(blockedFile(), 'utf8').trim() || '(empty)'; } catch { return null; } }
const blockedMsg = (b) => `BLOCKED marker present (${b}) — a Tennis Explorer tool met an error page; nothing runs until a person checks the cause and removes ${blockedFile()}`;
async function page(rel, fetchImpl = fetch) {
  const f = cacheFile(rel);
  if (fs.existsSync(f)) { cached++; return { text: fs.readFileSync(f, 'utf8'), fetchedAt: fs.statSync(f).mtime.toISOString() }; }
  if (OFFLINE) throw new Uncached(rel);
  { const b = blockedNote(); if (b) throw new Stop(blockedMsg(b)); }
  if (procRequests >= MAX_REQ) { maxHit = true; throw new Budget(); }
  if (Date.now() >= deadline) throw new Budget();
  let res, text;
  for (let attempt = 1; ; attempt++) {
    const wait = last + DELAY + Math.floor(Math.random() * JITTER) - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now(); requests++; if (attempt === 1) procRequests++;
    const t0 = Date.now();
    try { res = await fetchImpl(BASE + rel, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(60000) }); text = await res.text(); }
    catch (e) {   // no answer at all (DNS, reset, timeout): never an error PAGE, which stops at once below
      netRetries++;
      const n = netCause(e);
      logReq({ rel, ok: false, attempt, ms: Date.now() - t0, n: requests, ...n });
      if (attempt >= NET_TRIES) throw new NetStop(`network error on ${rel}: ${causeText(n)} (${attempt} tries, ${NET_WAIT_MS / 1000} s apart)`);
      console.log(`  network error on ${rel}: ${causeText(n)} after ${Date.now() - t0} ms — try ${attempt + 1} of ${NET_TRIES} in ${NET_WAIT_MS / 1000} s`);
      await sleep(NET_WAIT_MS);
      continue;
    }
    logReq({ rel, ok: true, attempt, ms: Date.now() - t0, n: requests, status: res.status, bytes: text ? text.length : 0,
      retryAfter: res.headers && res.headers.get ? res.headers.get('retry-after') : null });
    break;
  }
  if (isErrorPage(res.status, text)) {
    try { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(blockedFile(), `${new Date().toISOString()} status=${res.status} len=${text ? text.length : 0} ${rel}\n`); } catch { /* the stop below still happens */ }
    throw new Stop(`error page on ${rel}: HTTP ${res.status}, ${text ? text.length : 0} bytes — BLOCKED written`);
  }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + '.tmp', text); fs.renameSync(f + '.tmp', f);
  return { text, fetchedAt: new Date().toISOString() };
}

// ── parsing ────────────────────────────────────────────────────────────────────────────────────────────────────────
const strip = (s) => String(s || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;?/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/\s+/g, ' ').trim();
const ITF_TOUR = /\bitf\b|futures|\bm1[05]\b|\bm2[05]\b|utr|exhibition|bundesliga|interclub|doubles|women|wta|juniors?\b/i;

// a results list: tournament head rows, then pairs of rows rN (time, first player, the match link) + rNb (second player)
export function listMatches(html) {
  const out = []; let tour = null, tslug = null, cur = null;
  for (const tr of html.match(/<tr\b[\s\S]*?<\/tr>/gi) || []) {
    const open = tr.match(/^<tr\b([^>]*)>/i)[1];
    if (/class="[^"]*\bhead\b/.test(open)) {
      const a = tr.match(/<td class="t-name"[^>]*>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      tour = a ? strip(a[2]) : strip(tr).slice(0, 80); tslug = a ? a[1] : null; cur = null; continue;
    }
    const id = (open.match(/\bid="(r\d+b?)"/) || [])[1];
    if (!id) continue;
    const pl = tr.match(/<td class="t-name"[^>]*>\s*<a href="\/player\/([^/"]+)\/"[^>]*>([\s\S]*?)<\/a>/i);
    if (!id.endsWith('b')) {
      const mid = (tr.match(/match-detail\/\?id=(\d+)/) || [])[1];
      const time = strip((tr.match(/<td class="first time"[^>]*>([\s\S]*?)<\/td>/i) || [])[1]);
      cur = mid && pl ? { teId: mid, tour, tourSlug: tslug, time, p1: { slug: pl[1], name: strip(pl[2]) }, p2: null, row: id } : null;
    } else if (cur && id === cur.row + 'b' && pl) {
      cur.p2 = { slug: pl[1], name: strip(pl[2]) }; out.push(cur); cur = null;
    }
  }
  return out;
}

// names: TE "Davidovich Fokina A." / "Millman John"; api-tennis "A. Davidovich Fokina" / "Wu Tung-Lin"
const fold = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[-'’`.]/g, (c) => c === '.' ? '. ' : ' ');
export function nameParts(s) {
  const toks = fold(s).split(/\s+/).filter(Boolean);
  const init = [], sur = [];
  for (const t of toks) (/^[a-z]\.$/.test(t) || /^[a-z]{1,3}\.$/.test(t) ? init : sur).push(t.replace(/\.$/, ''));
  return { init: init.map((x) => x[0]), sur };
}
// same player: one surname word list starts the other's (compound surnames) and, where both carry an
// initial, they share the first one; TE's full first name ("Millman John") is matched on its first letter
export function samePlayer(te, api) {
  const A = nameParts(te), B = nameParts(api);
  const tryFull = (P) => (P.init.length ? [P] : [P, { init: [P.sur[P.sur.length - 1]?.[0]], sur: P.sur.slice(0, -1) }, { init: [P.sur[0]?.[0]], sur: P.sur.slice(1) }]);
  for (const a of tryFull(A)) for (const b of tryFull(B)) {
    if (!a.sur.length || !b.sur.length) continue;
    const [s, l] = a.sur.length <= b.sur.length ? [a.sur, b.sur] : [b.sur, a.sur];
    const run = s.every((w, j) => l[j] === w);   // the shorter surname STARTS the longer ("Carreno" = "Carreno Busta"; "Martin" is not "Lopez San Martin")
    const joined = a.sur.join('') === b.sur.join('');
    if (!(run || joined)) continue;
    if (a.init.length && b.init.length && a.init[0] && b.init[0] && a.init[0] !== b.init[0]) continue;
    // one side carries an initial, the other none (a full first name read as surname words, "Cerundolo Juan Manuel"):
    // the initial must start one of the longer side's extra words, so "F. Cerundolo" is never "Cerundolo Juan Manuel"
    if (!a.init.length !== !b.init.length) {
      const I = (a.init.length ? a : b).init[0], bare = a.init.length ? b : a, other = a.init.length ? a : b;
      if (!run || bare.sur.length <= other.sur.length || !bare.sur.slice(other.sur.length).some((w) => w[0] === I)) continue;
    }
    return true;
  }
  return false;
}
const pairMatches = (m, t) => (samePlayer(m.p1.name, t.a) && samePlayer(m.p2.name, t.b)) || (samePlayer(m.p1.name, t.b) && samePlayer(m.p2.name, t.a));

// one Pinnacle cell: the shown price, the change rows (newest first: time, price, diff), then "Opening odds" time + price.
// No tooltip = the price never moved since TE first listed it: last = open = shown, no timestamp.
export function oddsCell(td) {
  const shown = parseFloat(strip((td.match(/<div class="odds-in[^"]*">([\d.]+)/i) || [])[1]));
  if (!(shown > 1)) return null;
  const tip = (td.match(/<div class="odds-change-div">([\s\S]*?)<\/table>/i) || [])[1];
  if (!tip) return { last: shown, lastTs: null, open: shown, openTs: null, moves: 0 };
  const rows = [...tip.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)].map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => strip(c[1])));
  const oi = rows.findIndex((r) => /Opening odds/i.test(r.join(' ')));
  const ch = (oi < 0 ? rows : rows.slice(0, oi)).filter((r) => /^\d\d\.\d\d\. \d\d:\d\d$/.test(r[0]) && parseFloat(r[1]) > 1);
  const op = oi >= 0 ? rows.slice(oi + 1).find((r) => /^\d\d\.\d\d\. \d\d:\d\d$/.test(r[0]) && parseFloat(r[1]) > 1) : null;
  return { last: ch.length ? parseFloat(ch[0][1]) : shown, lastTs: ch.length ? ch[0][0] : null,
    open: op ? parseFloat(op[1]) : null, openTs: op ? op[0] : null, moves: ch.length };
}
// The page as calib-01 v1 read it (kept only so `--explain` can show why v1 rejected a page): the head = #center up to its
// first </table>, capped at 4,000 characters and cut to 400; names = the k1 / k2 cells of the first table.result head row.
export function legacyPageCheck(html) {
  const head = strip((html.match(/<div[^>]+id="center"[\s\S]{0,4000}?<\/table>/i) || [''])[0]).slice(0, 400);
  const date = (head.match(/(\d\d)\.(\d\d)\.(\d{4})/) || []);
  const t = (html.match(/<table class="result[^"]*"[^>]*>[\s\S]*?<tr class="head">([\s\S]*?)<\/tr>/i) || []);
  const k1 = strip((t[1] || '').match(/<td class="k1">([\s\S]*?)<\/td>/i)?.[1]), k2 = strip((t[1] || '').match(/<td class="k2">([\s\S]*?)<\/td>/i)?.[1]);
  return { head, date: date[3] ? `${date[3]}-${date[2]}-${date[1]}` : null, k1, k2 };
}

// The match page. Date = the first DD.MM.YYYY of the #center block (the match header: "A - B 02.08.2015 , 00:35, event"),
// read over the whole block, not a fixed window. Players, in the page's order, from TWO places that must not contradict:
// the match header's player links (/player/slug/) and the head row of the match-winner odds table (k1 / k2), whose
// column order is the price order. Either one alone is enough to check the names; the prices are oriented by k1 / k2
// when present, else by the header's order (TE lists the odds columns in the header's order).
export function matchPage(html) {
  const ci = html.search(/<div[^>]+id="center"/i);
  const center = ci >= 0 ? html.slice(ci, ci + 60000) : '';
  const firstTable = center.search(/<\/table>/i);
  const head = strip(firstTable >= 0 ? center.slice(0, firstTable) : center.slice(0, 6000)).slice(0, 600);
  const dm = strip(center).match(/(\d\d)\.(\d\d)\.(\d{4})/) || [];
  const players = [];
  for (const m of center.matchAll(/<a[^>]+href="(?:https?:\/\/www\.tennisexplorer\.com)?\/player\/([^/"]+)\/?"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const name = strip(m[2]); if (!name || players.some((p) => p.slug === m[1])) continue;
    players.push({ slug: m[1], name }); if (players.length === 2) break;
  }
  // the first odds table is the match winner ("Home/Away"); its book rows are <tr class="one|two"> at depth 1
  const start = html.search(/<table class="result[^"]*"[^>]*>\s*(?:<tbody>\s*)?<tr class="head[^"]*">/i);
  let k1 = '', k2 = '';
  const books = [], pin = { found: false };
  if (start >= 0) {
    const hr = html.slice(start).match(/<tr class="head[^"]*">([\s\S]*?)<\/tr>/i);
    if (hr) { k1 = strip(hr[1].match(/<td class="k1\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i)?.[1]); k2 = strip(hr[1].match(/<td class="k2\b[^"]*"[^>]*>([\s\S]*?)<\/td>/i)?.[1]); }
    const re = /<(\/?)(table|tr)\b[^>]*>/gi; re.lastIndex = start; let depth = 0, rowStart = -1, m;
    while ((m = re.exec(html))) {
      if (m[2].toLowerCase() === 'table') { depth += m[1] ? -1 : 1; if (depth === 0) break; continue; }
      if (depth !== 1) continue;
      if (!m[1]) rowStart = m.index;
      else if (rowStart >= 0) {
        const tr = html.slice(rowStart, m.index + m[0].length); rowStart = -1;
        const name = strip((tr.match(/<td class="first tl"[^>]*>[\s\S]*?<span class="t">([\s\S]*?)<\/span>/i) || [])[1]);
        if (!name) continue;
        books.push(name);
        if (/^pinnacle/i.test(name)) {
          // the k1 cell runs to the k2 cell's start, k2 to the row's end (their tooltips nest tables, so no </td> split)
          const i1 = tr.search(/<td class="k1\b/), i2 = tr.search(/<td class="k2\b/);
          const c1 = i1 >= 0 && i2 > i1 ? tr.slice(i1, i2) : null, c2 = i2 >= 0 ? tr.slice(i2) : null;
          Object.assign(pin, { found: true, k1: c1 ? oddsCell(c1) : null, k2: c2 ? oddsCell(c2) : null });
        }
      }
    }
  }
  return { head, date: dm[3] ? `${dm[3]}-${dm[2]}-${dm[1]}` : null, k1, k2, players: players.map((p) => p.name), books, pin };
}

// Does the page agree with the target? Returns the orientation (k1 = a, or k1 = b) and the reasons when it does not.
export function pageCheck(mp, t) {
  const orient = (x, y) => {
    if (!x || !y) return null;
    const ab = samePlayer(x, t.a) && samePlayer(y, t.b), ba = samePlayer(x, t.b) && samePlayer(y, t.a);
    return ab === ba ? (ab ? 'both' : 'no') : (ab ? 'ab' : 'ba');
  };
  const byOdds = orient(mp.k1, mp.k2), byHead = orient(mp.players[0], mp.players[1]);
  const why = [];
  const dateOk = !!mp.date && Math.abs(Date.parse(mp.date) - Date.parse(t.date)) <= 86400000;
  if (!mp.date) why.push('no date on the page'); else if (!dateOk) why.push(`date ${mp.date} is more than 1 day from ${t.date}`);
  const okO = byOdds === 'ab' || byOdds === 'ba', okH = byHead === 'ab' || byHead === 'ba';
  if (!okO && !okH) why.push(`names: odds head "${mp.k1}" / "${mp.k2}", header "${mp.players[0] || ''}" / "${mp.players[1] || ''}"`);
  if (okO && okH && byOdds !== byHead) why.push('the odds head and the match header list the players in different orders');
  const orientation = why.length ? null : (okO ? byOdds : byHead);
  return { ok: !why.length, orientation, orientedBy: why.length ? null : (okO ? 'odds head' : 'match header'), why };
}

// TE shows "DD.MM. HH:MM" in Prague time and no year: the year is the match's, or the one before for a December stamp on a
// January match. Converted to UTC through the tz database (CET / CEST), never a fixed offset.
export function pragueToUtc(stamp, matchDate) {
  const m = String(stamp || '').match(/^(\d\d)\.(\d\d)\. (\d\d):(\d\d)$/); if (!m || !matchDate) return null;
  const my = +matchDate.slice(0, 4), mm = +matchDate.slice(5, 7);
  const y = +m[2] > mm + 1 ? my - 1 : my;
  const want = Date.UTC(y, +m[2] - 1, +m[1], +m[3], +m[4]);
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  let t = want;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    t += want - local;
  }
  return new Date(t).toISOString().replace('.000Z', 'Z');
}

// ── the calibration measure (founder: exact, within 0.05, median no-vig gap, last change -> start) ─────────────────
const novig = (a, b) => (1 / a) / (1 / a + 1 / b);
export function calibration(rows) {
  const r = rows.filter((x) => x.pin && x.pin.p1 && x.pin.p2 && x.close);
  const gaps = [], lead = []; let exact = 0, w05 = 0;
  for (const x of r) {
    const d1 = Math.abs(x.pin.p1 - x.close.p1), d2 = Math.abs(x.pin.p2 - x.close.p2);
    if (Math.max(d1, d2) < 0.005) exact++;
    if (Math.max(d1, d2) <= 0.05 + 1e-9) w05++;
    gaps.push(Math.abs(novig(x.pin.p1, x.pin.p2) - novig(x.close.p1, x.close.p2)) * 100);
    const lt = [x.pin.p1Ts, x.pin.p2Ts].filter(Boolean).sort().pop();
    if (lt && x.close.startTs) lead.push((Date.parse(x.close.startTs) - Date.parse(lt)) / 60000);
  }
  const med = (a) => { if (!a.length) return null; const s = [...a].sort((p, q) => p - q), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
  return { n: r.length, exact, within005: w05, medianGapPp: med(gaps) == null ? null : +med(gaps).toFixed(3),
    p90GapPp: gaps.length ? +[...gaps].sort((p, q) => p - q)[Math.floor(gaps.length * 0.9)].toFixed(3) : null,
    lastChangeToStartMin: { n: lead.length, median: med(lead) == null ? null : Math.round(med(lead)), min: lead.length ? Math.round(Math.min(...lead)) : null, max: lead.length ? Math.round(Math.max(...lead)) : null } };
}

// ── one batch ──────────────────────────────────────────────────────────────────────────────────────────────────────
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const addDays = (d, k) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
function pragueToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(new Date()); }
const outFile = (id) => path.join(OUTDIR, `${id}${OFFLINE ? '.offline' : ''}.json`);
export function setOffline(v) { OFFLINE = !!v; }
export function stateOf(id) { try { const d = readJson(outFile(id)); return d.complete ? 'complete' : 'partial'; } catch { return 'not started'; } }

export async function runBatch(b, { fetchImpl = FETCH, today = pragueToday() } = {}) {
  const all = readJson(path.join(OPS, 'te-targets', b.file)).rows;
  const targets = all.filter((t) => t.date >= b.from && t.date <= b.to);
  const days = []; for (let d = addDays(b.from, -1); d <= addDays(b.to, 1); d = addDays(d, 1)) if (d < today) days.push(d);
  const doc = { batch: b.id, source: SOURCE, label: 'Pinnacle (approx.)', complete: false, startedAt: new Date(started).toISOString(), targets: targets.length,
    rule: 'TE date +-1 day, both names, one candidate both ways; otherwise no row', rows: [], days: { wanted: days.length, read: 0 } };
  let stop = null, budget = false, uncached = null, stopNet = false;
  const byDay = new Map();
  try {
    for (const d of days) {
      const [y, m, dd] = d.split('-');
      const p = await page(`/results/?type=atp-single&year=${y}&month=${m}&day=${dd}`, fetchImpl);
      byDay.set(d, listMatches(p.text).filter((x) => !ITF_TOUR.test(`${x.tour} ${x.tourSlug || ''}`)));
      doc.days.read++;
    }
  } catch (e) { if (e instanceof Stop) { stop = e.message; stopNet = e instanceof NetStop; } else if (e instanceof Uncached) uncached = e.message; else if (e instanceof Budget) budget = true; else throw e; }
  // the join (only once every day's list is read: a candidate on an unread day could make a join ambiguous)
  if (!stop && !budget && !uncached) {
    const cand = new Map(), claim = new Map();
    for (const t of targets) {
      const c = [];
      for (const k of [-1, 0, 1]) for (const m of byDay.get(addDays(t.date, k)) || []) if (pairMatches(m, t)) c.push(m);
      const uniq = [...new Map(c.map((m) => [m.teId, m])).values()];
      cand.set(t.ek, uniq);
      for (const m of uniq) claim.set(m.teId, (claim.get(m.teId) || 0) + 1);
    }
    try {
      for (const t of targets) {
        const c = cand.get(t.ek);
        const row = { ek: t.ek, level: t.level, date: t.date, a: t.a, b: t.b, ka: t.ka, kb: t.kb, close: t.close || undefined };
        if (!c.length) { doc.rows.push({ ...row, status: 'not found' }); continue; }
        if (c.length > 1 || claim.get(c[0].teId) > 1) { doc.rows.push({ ...row, status: 'ambiguous', candidates: c.map((m) => m.teId) }); continue; }
        const m = c[0];
        const p = await page(`/match-detail/?id=${m.teId}`, fetchImpl);
        const mp = matchPage(p.text);
        // the page itself must agree: both names (odds head or match header), date within +-1 day
        const chk = pageCheck(mp, t), k1a = chk.orientation === 'ab';
        const base = { ...row, teId: m.teId, tour: m.tour, books: mp.books, pageSha256: crypto.createHash('sha256').update(p.text).digest('hex'), fetchedAt: p.fetchedAt };
        if (!chk.ok) { doc.rows.push({ ...base, status: 'page disagrees', why: chk.why, page: { date: mp.date, k1: mp.k1, k2: mp.k2, players: mp.players }, pageHead: mp.head.slice(0, 160) }); continue; }
        let pin = null;
        if (mp.pin.found && mp.pin.k1 && mp.pin.k2) {
          const [A, B] = k1a ? [mp.pin.k1, mp.pin.k2] : [mp.pin.k2, mp.pin.k1];   // oriented to api-tennis's a / b
          pin = { p1: A.last, p2: B.last, p1Ts: pragueToUtc(A.lastTs, t.date), p2Ts: pragueToUtc(B.lastTs, t.date),
            open: { p1: A.open, p2: B.open, p1Ts: pragueToUtc(A.openTs, t.date), p2Ts: pragueToUtc(B.openTs, t.date) }, moves: [A.moves, B.moves] };
          if (!(pin.p1 >= 1.01 && pin.p2 >= 1.01)) pin = null;   // a price below 1.01 is no price (a dash)
        }
        doc.rows.push({ ...base, status: 'joined', orientedBy: chk.orientedBy, pin });
      }
      doc.complete = true;
    } catch (e) { if (e instanceof Stop) { stop = e.message; stopNet = e instanceof NetStop; } else if (e instanceof Uncached) uncached = e.message; else if (e instanceof Budget) budget = true; else throw e; }
  }
  const n = (s) => doc.rows.filter((r) => r.status === s).length;
  const joined = n('joined');
  doc.summary = { requests, fromCache: cached, daysRead: `${doc.days.read} of ${doc.days.wanted}`, targets: targets.length,
    found: doc.rows.filter((r) => r.status !== 'not found').length, joined, ambiguous: n('ambiguous'), notFound: n('not found'),
    pageDisagrees: n('page disagrees'), pinnacle: doc.rows.filter((r) => r.pin).length, stop, netStop: !!stopNet, netRetries, partial: !doc.complete,
    joinStarted: doc.days.read === doc.days.wanted,
    offline: OFFLINE ? (uncached ? `stopped at the first page not in the cache: ${uncached}` : 'every page was in the cache') : undefined };
  if (b.id.startsWith('calib') && doc.complete) doc.calibration = calibration(doc.rows);
  doc.finishedAt = new Date().toISOString();
  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.writeFileSync(outFile(b.id) + '.tmp', JSON.stringify(doc)); fs.renameSync(outFile(b.id) + '.tmp', outFile(b.id));
  return doc;
}

export function line(doc) {
  const s = doc.summary;
  // the join runs only once every day's list is read (see runBatch): before that, "found 0" is not a result
  if (s.joinStarted === false) return `${doc.batch}: pages done ${s.requests} new + ${s.fromCache} cached · list pass ${s.daysRead} days read · targets ${s.targets} · join waits for all lists (matches are looked up after the last list)` +
    `${s.netRetries ? ` · network retries ${s.netRetries}` : ''}` + tail(doc, s);
  let l = `${doc.batch}: pages done ${s.requests} new + ${s.fromCache} cached (lists ${s.daysRead}) · targets ${s.targets} · matches found ${s.found} of ${s.targets}` +
    ` · joined ${s.joined} · ambiguous ${s.ambiguous} · not found ${s.notFound}${s.pageDisagrees ? ` · page disagrees ${s.pageDisagrees}` : ''}` +
    ` · Pinnacle found ${s.pinnacle} of ${s.joined} joined${s.netRetries ? ` · network retries ${s.netRetries}` : ''}`;
  if (doc.calibration) { const c = doc.calibration;
    l += `\n  calibration vs our closes: n ${c.n} · exact ${c.exact} of ${c.n} · within 0.05 ${c.within005} of ${c.n} · median no-vig gap ${c.medianGapPp}pp (p90 ${c.p90GapPp}pp)` +
      ` · last change → start median ${c.lastChangeToStartMin.median} min (n ${c.lastChangeToStartMin.n}, ${c.lastChangeToStartMin.min}–${c.lastChangeToStartMin.max})`; }
  return l + tail(doc, s);
}
function tail(doc, s) {
  if (s.offline) return `\n  OFFLINE re-check (no request made): ${s.offline}. Nothing was pushed.`;
  if (s.stop && s.netStop) return `\n  STOP (network, no answer from the server): ${s.stop}. Safe to retry later; --supervise does it with a back-off.`;
  if (s.stop) return `\n  STOP (error page): ${s.stop}. Tell Claude; do not retry.`;
  if (s.partial) return `\n  PARTIAL (the ${HOURS} h budget or --max-requests): with --queue the batch continues from the cache; a single batch exits 6 — re-run it to continue.`;
  return '';
}

// `--explain N`: for every row that has a cached match page, what the v1 check (legacyPageCheck) saw and what the
// current check sees, and the first N rows v1 rejected, target beside page. Reads the cache only.
export function explain(doc, n = 3) {
  const out = []; let v1Rej = 0, v1Names = 0, v1Date = 0, now = { joined: 0, disagrees: 0 };
  const shown = [];
  for (const r of doc.rows) {
    if (!r.teId) continue;
    const f = cacheFile(`/match-detail/?id=${r.teId}`); if (!fs.existsSync(f)) continue;
    const html = fs.readFileSync(f, 'utf8'), L = legacyPageCheck(html);
    const lNames = (samePlayer(L.k1, r.a) && samePlayer(L.k2, r.b)) !== (samePlayer(L.k1, r.b) && samePlayer(L.k2, r.a));
    const lDate = !!L.date && Math.abs(Date.parse(L.date) - Date.parse(r.date)) <= 86400000;
    if (r.status === 'joined') now.joined++; else if (r.status === 'page disagrees') now.disagrees++;
    if (lNames && lDate) continue;
    v1Rej++; if (!lNames) v1Names++; if (!lDate) v1Date++;
    if (shown.length < n) shown.push(`  TE ${r.teId} · ${r.level} · target "${r.a}" v "${r.b}" on ${r.date}\n` +
      `     v1 read:  date ${L.date || '—'} · odds head "${L.k1}" / "${L.k2}" · head "${L.head.slice(0, 120)}"\n` +
      `     now:      ${r.status}${r.why ? ` (${r.why.join('; ')})` : ''}${r.page ? ` · date ${r.page.date || '—'} · odds head "${r.page.k1}" / "${r.page.k2}" · header "${(r.page.players || []).join('" / "')}"` : ''}`);
  }
  out.push(`explain: ${v1Rej} cached match pages the v1 check rejected (names ${v1Names}, date ${v1Date}); now joined ${now.joined}, page disagrees ${now.disagrees}`);
  return out.concat(shown).join('\n');
}

// `--explain-notfound` (with --offline): for every target the join did not find, what the CACHED list pages of its day
// -1..+1 show — no row naming either player, one player only (a spelling / initial mismatch), or both players in a row
// the ITF / exhibition filter removed. Reads the cache only.
export function explainNotFound(doc) {
  const out = [], why = {};
  for (const r of doc.rows.filter((x) => x.status === 'not found')) {
    const near = [];
    for (const k of [-1, 0, 1]) {
      const day = addDays(r.date, k), [y, m, dd] = day.split('-');
      const f = cacheFile(`/results/?type=atp-single&year=${y}&month=${m}&day=${dd}`); if (!fs.existsSync(f)) continue;
      for (const x of listMatches(fs.readFileSync(f, 'utf8'))) {
        const hitA = [x.p1, x.p2].some((p) => p && samePlayer(p.name, r.a)), hitB = [x.p1, x.p2].some((p) => p && samePlayer(p.name, r.b));
        if (hitA || hitB) near.push({ day, hitA, hitB, filtered: ITF_TOUR.test(`${x.tour} ${x.tourSlug || ''}`), tour: x.tour, p1: x.p1.name, p2: x.p2 && x.p2.name });
      }
    }
    const both = near.filter((n) => n.hitA && n.hitB);
    const reason = both.some((n) => n.filtered) ? 'both players listed, row removed by the ITF / exhibition filter'
      : both.length ? 'both players listed (check the pair rule)' : near.length ? 'one player listed only (name spelling or a different opponent)' : 'neither player on the lists of day -1..+1';
    why[reason] = (why[reason] || 0) + 1;
    out.push(`  ${r.date} ${r.level} ${r.a} v ${r.b}: ${reason}${near.length ? ' · e.g. ' + near.slice(0, 2).map((n) => `${n.day} ${n.tour}: ${n.p1} v ${n.p2}`).join(' | ') : ''}`);
  }
  return [`not found ${out.length} of ${doc.rows.length} targets: ${JSON.stringify(why)}`, ...out].join('\n');
}

// `--save-fixtures DIR` (offline re-check only): copies up to 3 cached match pages per status (joined / page disagrees)
// with their targets into DIR, for tools/te-odds-batch.test.mjs. DIR is in this PRIVATE repo; never the public one.
export function saveFixtures(doc, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const keep = [], per = {};
  for (const r of doc.rows) {
    if (!r.teId || !['joined', 'page disagrees'].includes(r.status) || (per[r.status] = (per[r.status] || 0) + 1) > 3) continue;
    const f = cacheFile(`/match-detail/?id=${r.teId}`); if (!fs.existsSync(f)) continue;
    fs.copyFileSync(f, path.join(dir, `match-${r.teId}.html`));
    keep.push({ teId: r.teId, level: r.level, date: r.date, a: r.a, b: r.b, statusAtSave: r.status,
      expect: r.status === 'joined' ? { orientation: r.pin ? (r.orientedBy || null) : null, pin: r.pin } : { why: r.why } });
  }
  fs.writeFileSync(path.join(dir, 'pages.json'), JSON.stringify({ batch: doc.batch, savedAt: new Date().toISOString(), pages: keep }, null, 1));
  return `saved ${keep.length} cached match pages into ${dir} (commit them in stennisfy-ops: private)`;
}

function pushToStore(doc) {
  if (!fs.existsSync(path.join(STORE, '.git'))) return `not pushed: no git checkout at ${STORE} (set TE_STORE); the file is ${outFile(doc.batch)}`;
  const rel = path.join('te-odds', `${doc.batch}.json`), dst = path.join(STORE, rel);
  const g = (...a) => execFileSync('git', ['-C', STORE, ...a], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  try {
    g('pull', '-q', '--rebase');
    if (fs.existsSync(dst) && fs.readFileSync(dst, 'utf8') !== fs.readFileSync(outFile(doc.batch), 'utf8')) {
      const old = readJson(dst); if (old.complete) return `not pushed: ${rel} already holds a complete batch with other bytes (never replaced)`;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(outFile(doc.batch), dst);
    g('add', rel);
    try { g('diff', '--cached', '--quiet'); return `already in the store: ${rel}`; } catch { /* staged changes */ }
    g('commit', '-q', '-m', `te-odds: ${doc.batch} (${doc.summary.joined} joined, ${doc.summary.pinnacle} with Pinnacle)`);
    g('push', '-q');
    return `pushed ${rel} at ${g('rev-parse', '--short', 'HEAD')}`;
  } catch (e) { return `not pushed (${String(e.stderr || e.message).trim().split('\n')[0]}); the file is ${outFile(doc.batch)}`; }
}

// ── reports that read local files only (no request) ────────────────────────────────────────────────────────────
// `--net-report`: every request this tool logged (requests.jsonl): outcomes, failure causes, HTTP statuses, and how many
// requests each run made before its first failure — enough to tell a throttle (failures after a fixed count or time)
// from a flaky connection (failures at random), and a block (403 / 429, which stop the run) from no answer at all.
export function netReport(lines) {
  const recs = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const ok = recs.filter((r) => r.ok), bad = recs.filter((r) => !r.ok);
  const by = (a, f) => a.reduce((m, r) => { const k = f(r); m[k] = (m[k] || 0) + 1; return m; }, {});
  // a run = the log lines between two restarts of the process (the per-process counter n goes back to 1)
  // a run = one batch start (a restart, or the supervisor's next try, is a new run)
  const runs = [...recs.reduce((m, r) => { const k = r.run || 'unknown'; if (!m.has(k)) m.set(k, []); m.get(k).push(r); return m; }, new Map())].map(([start, rs]) => {
    const f = rs.findIndex((r) => !r.ok);
    return { start, recs: rs.length, okBeforeFail: f < 0 ? null : rs.slice(0, f).filter((r) => r.ok).length,
      minutesToFail: f < 0 ? null : Math.round((Date.parse(rs[f].t) - Date.parse(rs[0].t)) / 60000), firstCause: f < 0 ? null : [rs[f].code, rs[f].causeName !== 'Error' ? rs[f].causeName : null].filter(Boolean).join(' / ') || rs[f].message };
  });
  const out = [`requests logged ${recs.length}: answered ${ok.length} (HTTP ${JSON.stringify(by(ok, (r) => r.status))}), no answer ${bad.length}`,
    `no-answer causes: ${JSON.stringify(by(bad, (r) => [r.code, r.causeName && r.causeName !== 'Error' ? r.causeName : null].filter(Boolean).join(' / ') || r.message || 'unknown'))}`,
    `slowest answered: ${ok.length ? Math.max(...ok.map((r) => r.ms)) : '—'} ms · median answered ${ok.length ? [...ok.map((r) => r.ms)].sort((a, b) => a - b)[ok.length >> 1] : '—'} ms` +
      ` · failures that took ≥ 59 s (our 60 s timeout) ${bad.filter((r) => r.ms >= 59000).length} of ${bad.length}`,
    `Retry-After headers seen: ${ok.filter((r) => r.retryAfter).length}`,
    `runs ${runs.length}:`];
  for (const r of runs) out.push(`  ${r.start} · ${r.recs} requests · ${r.okBeforeFail == null ? 'no failure' : `first failure after ${r.okBeforeFail} answered requests, ${r.minutesToFail} min in (${r.firstCause})`}`);
  return out.join('\n');
}
// `--zone-label`: the time-zone label TE printed on the cached pages (TE's header shows e.g. "20.10. 13:18, GMT+1"), counted
export function zoneLabels(dir) {
  const c = {}, ex = {}; let files = 0;
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!f.endsWith('.html')) continue; files++;
    const h = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of h.matchAll(/GMT\s?[+-−]\s?\d{1,2}(?::\d\d)?|\bUTC\s?[+-−]\s?\d{1,2}\b/g)) { const k = m[0].replace(/\s/g, ''); c[k] = (c[k] || 0) + 1;
      if (!ex[k]) ex[k] = `${f}: …${strip(h.slice(Math.max(0, m.index - 120), m.index + 20)).slice(-90)}`; }
  }
  return [`cached pages read ${files}; zone labels found: ${JSON.stringify(c)}`, ...Object.values(ex).map((x) => '  ' + x)].join('\n');
}

// ── one pass over the batches: 0 complete (or offline / list), 0 partial (budget), 3 error page, 4 held, 5 network ────
// a stop that is not completion never exits 0 (founder 2026-10-20): 6 = PARTIAL (a single batch's budget, a --max-requests
// probe, an offline re-check that met a page not in the cache)
export const EXIT = { DONE: 0, PAGE_STOP: 3, HELD: 4, NET_STOP: 5, PARTIAL: 6 };
let totalNew = 0;
export async function runOnce(plan, queue, single) {
  if (!OFFLINE) { const b = blockedNote(); if (b) { console.log(blockedMsg(b)); return { code: EXIT.PAGE_STOP }; } }
  const ids = queue ? plan.filter((b) => stateOf(b.id) !== 'complete').map((b) => b.id) : [single];
  if (queue && !ids.length) { console.log('queue: every batch complete'); return { code: 0, complete: true }; }
  for (const id of ids) {
    const b = plan.find((x) => x.id === id); if (!b) { console.log(`no batch ${id} in te-targets/batches.json`); return { code: 2 }; }
    if (!b.id.startsWith('calib') && !OFFLINE) {
      for (const c of plan.filter((x) => x.id.startsWith('calib'))) {
        let d; try { d = readJson(outFile(c.id)); } catch { d = null; }
        if (!d || !d.complete) { console.log(`${id}: waits for ${c.id} (the calibration batch) to complete`); return { code: EXIT.HELD }; }
        const g = d.calibration || {};
        if (!(g.n >= GATE_N && g.medianGapPp != null && g.medianGapPp < GATE_PP)) { console.log(`${id}: held — calibration median gap ${g.medianGapPp}pp on n ${g.n} is not under ${GATE_PP}pp on n >= ${GATE_N}. Tell Claude.`); return { code: EXIT.HELD }; }
      }
    }
    let doc;
    // --queue: a batch that reaches its budget continues from the cache at once (founder 2026-10-20: the queue never ends
    // on a budget); the budget stays for a single-batch run. A --max-requests probe always stops.
    for (let pass = 1; ; pass++) {
      requests = 0; cached = 0; netRetries = 0; started = Date.now(); deadline = started + HOURS * 3600e3;
      console.log(`${id}: ${b.from} → ${b.to}, ${b.targets} targets, at most ~${b.estRequests} requests (${DELAY / 1000}–${(DELAY + JITTER) / 1000} s apart, budget ${HOURS} h)${pass > 1 ? ` · continuing from the cache, pass ${pass}` : ''}`);
      doc = await runBatch(b);
      totalNew += doc.summary.requests;
      console.log(line(doc));
      if (queue && !OFFLINE && !doc.complete && !doc.summary.stop && !maxHit) {
        if (doc.summary.requests === 0) { console.log(`${id}: a pass within the budget made no new request — stopping (exit 6), never a loop`); return { code: EXIT.PARTIAL, partial: true }; }
        continue;
      }
      break;
    }
    if (process.argv.includes('--explain')) console.log(explain(doc, Number(arg('--explain', 3)) || 3));
    if (process.argv.includes('--explain-notfound')) console.log(explainNotFound(doc));
    if (process.argv.includes('--save-fixtures')) console.log(saveFixtures(doc, arg('--save-fixtures', path.join(OPS, 'tools', 'fixtures', 'te-calib'))));
    if (OFFLINE) return { code: doc.summary.offline && /not in the cache/.test(doc.summary.offline) ? EXIT.PARTIAL : 0 };
    if (doc.complete) console.log('  ' + pushToStore(doc));
    if (doc.summary.stop) return { code: doc.summary.netStop ? EXIT.NET_STOP : EXIT.PAGE_STOP };
    if (!doc.complete) return { code: EXIT.PARTIAL, partial: true };
  }
  if (queue) { console.log('queue: every batch complete'); return { code: 0, complete: true }; }
  return { code: 0, complete: true };
}

// `--supervise` (with --queue): restarts ONLY after a network stop (no answer from the server), waiting 10, then 20, then
// 40 min (and 40 after that); the wait goes back to 10 min after a run that fetched at least SUPERVISE_RESET_PAGES (20) new
// pages. It gives up (exit 5) after SUPERVISE_MAX_IDLE network stops in a row with no new page at all. An error page
// (any non-200, 403 and 429 included, a challenge page, an empty body) exits for good (3), never retried; so does a held
// calibration (4). A budget PARTIAL continues at once (same pace). Exit 0 when every batch is complete.
// The pace between requests is unchanged (9–12 s); the supervisor only decides whether to start again.
export const BACKOFF_MIN = [10, 20, 40];
export const SUPERVISE_RESET_PAGES = Number(process.env.TE_SUPERVISE_RESET_PAGES || 20), SUPERVISE_MAX_IDLE = Number(process.env.TE_SUPERVISE_MAX_IDLE || 5);
export async function supervise(once, { wait = sleep, log = console.log, newPages = () => totalNew } = {}) {
  let step = 0, idle = 0;
  for (;;) {
    const before = newPages();
    const r = await once();
    const fetched = newPages() - before;
    if (r.code === EXIT.NET_STOP) {
      if (fetched >= SUPERVISE_RESET_PAGES) step = 0;
      idle = fetched === 0 ? idle + 1 : 0;
      if (idle >= SUPERVISE_MAX_IDLE) { log(`supervise: ${idle} network stops in a row with no new page — giving up (exit 5). Tell Claude.`); return EXIT.NET_STOP; }
      const m = BACKOFF_MIN[Math.min(step, BACKOFF_MIN.length - 1)]; step++;
      log(`supervise: network stop after ${fetched} new pages — waiting ${m} min, then continuing from the cache (${new Date(Date.now() + m * 60e3).toISOString()})`);
      await wait(m * 60e3); continue;
    }
    if (r.code === EXIT.PARTIAL) { log('supervise: PARTIAL (exit 6) — not a completion, stopping'); return EXIT.PARTIAL; }
    if (r.code === 0) { log('supervise: done'); return 0; }
    log(`supervise: exit ${r.code} (${r.code === EXIT.PAGE_STOP ? 'error page: not retried' : r.code === EXIT.HELD ? 'held' : 'usage'}) — stopping for good`);
    return r.code;
  }
}

async function main() {
  if (process.argv.includes('--net-report')) { const f = REQLOG(); console.log(fs.existsSync(f) ? netReport(fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) : `no request log yet at ${f}`); return 0; }
  if (process.argv.includes('--zone-label')) { console.log(zoneLabels(path.join(CACHE, 'html'))); return 0; }
  const plan = readJson(path.join(OPS, 'te-targets', 'batches.json')).batches;
  if (process.argv.includes('--list')) {
    for (const b of plan) console.log(`${b.id.padEnd(10)} ${b.from} → ${b.to}  ${String(b.targets).padStart(5)} targets  ≤${b.estRequests} requests  ${stateOf(b.id)}`);
    return 0;
  }
  const queue = process.argv.includes('--queue');
  if (!queue && (!process.argv[2] || process.argv[2].startsWith('--'))) { console.log('usage: te-odds-batch.mjs <batch id> | --queue [--supervise] | --list | --net-report | --zone-label'); return 2; }
  if (queue && process.argv.includes('--supervise') && MAX_REQ !== Infinity) { console.log('--max-requests is a one-off probe: run it without --supervise'); return 2; }
  if (queue && process.argv.includes('--supervise')) return supervise(async () => runOnce(plan, true));
  return (await runOnce(plan, queue, process.argv[2])).code;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().then((c) => process.exit(c));
