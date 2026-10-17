#!/usr/bin/env node
// TEN-443 step 2 · Tennis Explorer (TE) player-history scraper (founder 2026-10-17: TE is licensed via an agreement
// with Livesport; gate 91feaca9). Rules this tool enforces, each a test:
//   * ONE request at a time, >= TE_DELAY_MS (default 8 s) apart plus jitter; any non-200, a challenge page or an empty
//     body stops the run (exit 3) — never retry in a loop, never parallelise.
//   * Licensed source (founder 2026-10-17: agreement with Livesport); rows built from it carry src 'te'.
//   * Every page is cached raw under TE_CACHE (default ~/.stennisfy/te-cache). A past season is never fetched twice;
//     the current season and the profile page are refetched only when older than TE_MAX_AGE_H (default 20 h).
//   * Runs on this Mac, off the pipeline. Nothing in CI or the nightly refresh calls it or waits for it.
//   * A player is joined to a TE page only on a positive identity check: same surname and first name (or initial)
//     AND the page's date of birth equal to Sackmann's (or, with no DOB on record, the same country and the page's age
//     within one year of ours). Anything else is "unmatched" with its reason — never a guess.
//   * Resumable: players.json is written after every player and every page is cached, so a restart (sleep, reboot,
//     lost connection) re-reads the cache and refetches nothing done within TE_MAX_AGE_H. tools/te-scrape-agent.sh
//     (launchd, every 30 min) restarts it; a lock keeps it to one run; DONE / BLOCKED markers stop the restarts.
// Run: node tools/te-scrape.mjs --players <keys.json> [--limit N]
//   keys.json: [{key, name, country, age, first?, last?, dob?}] — first/last/dob from the DOB-checked Sackmann join
//   (career-backfill.js reconcile + a DOB check; TEN-443 step 1); a roster builder lands with the step-2 ingest.
// Out: TE_CACHE/players.json  {key: {slug, how, dob, country}} | {key: {unmatched: reason, candidates}}
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const CACHE = process.env.TE_CACHE || path.join(os.homedir(), '.stennisfy', 'te-cache');
const DELAY = Number(process.env.TE_DELAY_MS || 8000);
const MAX_AGE_MS = Number(process.env.TE_MAX_AGE_H || 20) * 3600e3;
const BASE = 'https://www.tennisexplorer.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const THIS_YEAR = new Date().getUTCFullYear();

fs.mkdirSync(path.join(CACHE, 'html'), { recursive: true });
const LOG = fs.createWriteStream(path.join(CACHE, 'scrape.log'), { flags: 'a' });
const log = (m) => { const l = `${new Date().toISOString()} ${m}`; LOG.write(l + '\n'); console.log(l); };

let last = 0, requests = 0;
export const stats = () => ({ requests });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function cacheFile(rel) { return path.join(CACHE, 'html', rel.replace(/^\/+/, '').replace(/[^A-Za-z0-9._-]+/g, '_') + '.html'); }

// fetch one TE page through the cache. `stable` = a past season: cached copy is final.
export async function page(rel, { stable = false, finalAfter = 0 } = {}) {
  const f = cacheFile(rel);
  if (fs.existsSync(f)) {
    const m = fs.statSync(f).mtimeMs;
    if ((stable && m >= finalAfter) || Date.now() - m < MAX_AGE_MS) return fs.readFileSync(f, 'utf8');
  }
  const wait = last + DELAY + Math.floor(Math.random() * 2000) - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now(); requests++;
  let res, text;
  // A lost connection or a sleeping Mac is retried on the same page with backoff (1, 2, 4, 8, 16 min), then the run
  // exits and the launchd job resumes it later from the cache. A non-200 or a challenge page is a BLOCK: never
  // retried — BLOCKED is written and every later start refuses to run until a person removes it.
  for (let attempt = 0; ; attempt++) {
    const t0 = Date.now();
    // a hung request is bounded (60 s, then the normal retry): one read hung 32 min on 2026-10-17 with no timeout.
    // Pace and retries are unchanged — this only stops a stalled socket from holding the run.
    try { res = await fetch(BASE + rel, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' }, signal: AbortSignal.timeout(60000) }); text = await res.text(); break; }
    catch (e) {
      // the cause, not just "fetch failed": a connect timeout, a reset and a closed socket point at different ends of
      // the link (founder 2026-10-17, cd899856 item 1) — logged with how long the attempt took
      const c = e.cause || {}; e.message = `${e.message} [${c.code || c.name || 'no-code'}${c.message ? ': ' + String(c.message).slice(0, 80) : ''} · ${Date.now() - t0} ms]`;
      if (attempt >= 5) { log(`PAUSE network ${rel}: ${e.message} — exiting, the job resumes from cache`); process.exit(4); }
      const ms = 60e3 * 2 ** attempt; log(`retry ${attempt + 1}/5 in ${ms / 60e3} min: ${rel}: ${e.message}`); await sleep(ms);
    }
  }
  if (res.status !== 200 || !text || text.length < 5000 || /cf-mitigated|Attention Required|captcha/i.test(text)) {
    const why = `status=${res.status} len=${text ? text.length : 0} ${rel}`;
    fs.writeFileSync(path.join(CACHE, 'BLOCKED'), `${new Date().toISOString()} ${why}\n`);
    log(`STOP ${why} — BLOCKED written; no automatic restart`); process.exit(3);
  }
  fs.writeFileSync(f, text);
  return text;
}

const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

// men's column of the search page: [{slug, last, first, country}]
export function searchRows(html) {
  const out = [];
  for (const tr of html.split(/<tr class="(?:one|two)"/).slice(1)) {
    const tds = tr.split('<td').slice(1);
    const men = tds[1] || '';
    const m = men.match(/title="([^"]*)"[\s\S]*?href="\/player\/([^/"]+)\/">([^<]+)<\/a>/);
    if (!m) continue;
    const [lastN, firstN] = m[3].split(',').map((x) => x.trim());
    out.push({ slug: m[2], last: lastN, first: firstN || '', country: m[1] });
  }
  return out;
}
export function profileFacts(html) {
  const d = strip((html.match(/class="plDetail"[\s\S]*?<\/table>/) || [''])[0]);
  const dob = d.match(/Age:\s*(\d+)\s*\((\d+)\.\s*(\d+)\.\s*(\d{4})\)/);
  const country = (d.match(/Country:\s*([A-Za-z .'-]+?)\s+(?:Height|Age|Current)/) || [])[1] || null;
  const years = [...new Set([...html.matchAll(/annual=(\d{4})/g)].map((x) => +x[1]))].sort();
  return { age: dob ? +dob[1] : null, dob: dob ? `${dob[4]}${dob[3].padStart(2, '0')}${dob[2].padStart(2, '0')}` : null, country, years };
}
const COUNTRY_ALIAS = { 'czechia': 'czechrepublic', 'unitedstates': 'usa', 'chinesetaipei': 'taipei', 'korearepublic': 'southkorea' };
const cnorm = (c) => { const n = norm(c); return COUNTRY_ALIAS[n] || n; };

let _links = null;
function cacheLinks() {
  if (_links) return _links;
  _links = new Map();
  for (const f of fs.readdirSync(path.join(CACHE, 'html'))) {
    const h = fs.readFileSync(path.join(CACHE, 'html', f), 'utf8');
    for (const m of h.matchAll(/href="\/player\/([^/"]+)\/"[^>]*>(?:<strong>)?([^<]+)</g)) if (!_links.has(m[1])) _links.set(m[1], m[2].trim());
  }
  return _links;
}
function fromCache(last, first, initial) {
  const sur = norm(last), toks = String(first || '').split(/[\s-]+/).map(norm).filter(Boolean);
  const out = [];
  for (const [slug, name] of cacheLinks()) {
    const parts = name.split(/\s+/); const ini = /\.$/.test(parts[parts.length - 1]) ? norm(parts.pop()) : ''; const rest = norm(parts.join(''));
    const direct = rest === sur && ini && ini[0] === initial;                                   // "Te R."
    const flipped = ini && ini === sur.slice(0, ini.length) && toks.length && rest === toks.join('');   // "Yunchaokete B." / "Tunglin W."
    const flippedNoFirst = !toks.length && ini && ini[0] === sur[0] && rest.length > 3 && rest[0] === initial;   // Y. Bu -> "Yunchaokete B."
    if (direct || flipped || flippedNoFirst) out.push({ slug, last: rest, first: ini, country: null, fromCache: true });
  }
  return out;
}
export async function resolve(p) {
  const last = p.last || p.name.split(' ').filter((t) => !/\.$/.test(t)).join(' ');
  const initial = norm(p.first || p.name)[0];
  // search on the longest plain-letter token of the surname: "O'Connell" -> "Connell", "Barrios Vera" -> "Barrios"
  const term = last.split(/[\s'’-]+/).filter(Boolean).sort((a, b) => b.length - a.length)[0];
  // TE's search returns nothing for a term under 3 letters ("Te"): search the longest first-name token instead
  const firstTok = String(p.first || '').split(/[\s'’-]+/).filter(Boolean).sort((a, b) => b.length - a.length)[0];
  const q = term.length >= 3 || !firstTok ? term : firstTok;
  const html = await page(`/list-players/?search-text-pl=${encodeURIComponent(q)}`);
  const cands = searchRows(html).filter((r) => norm(r.last) === norm(last) || (norm(term).length >= 3 && norm(r.last).includes(norm(term))));
  const toks = (x) => String(x || '').split(/[\s-]+/).map(norm).filter(Boolean);
  // first names: equal, a prefix either way, or one shared token ("Tomas" vs "Marcelo Tomas") — the DOB still decides
  const named = cands.filter((r) => p.first ? norm(r.first) === norm(p.first) || norm(r.first).startsWith(norm(p.first)) || norm(p.first).startsWith(norm(r.first)) || toks(r.first).some((t) => toks(p.first).includes(t)) : norm(r.first)[0] === initial);
  // Country is a tie-break only: TE writes some countries in Czech ("Moldavsko") and ours differ (Taiwan / Chinese
  // Taipei, neutral flags). The identity test is the date of birth; without one, the same country AND age ± 1.
  let pool = named.length ? named : cands.filter((r) => norm(r.first)[0] === initial);
  // short surnames ("Te", "Bu", "Wu") return nothing from TE's search: look the player up among the opponent links
  // already in the cache, where TE prints him "Surname I." — in either name order ("Yunchaokete B." for Bu Yunchaokete)
  if (!pool.length) pool = fromCache(last, p.first, initial);
  if (!p.dob) pool = pool.filter((r) => r.fromCache || !p.country || cnorm(r.country) === cnorm(p.country));   // cache rows: country checked on the profile
  const checked = [];
  for (const c of pool.slice(0, 6)) {
    const f = profileFacts(await page(`/player/${c.slug}/`));
    // identity: the DOB when we hold one; else age ± 1 AND the profile's country (TE may print it in Czech — a missing
    // or unreadable country fails closed, the player stays unmatched)
    const ok = p.dob ? f.dob === p.dob
      : (f.age != null && p.age != null && Math.abs(f.age - p.age) <= 1 && (!c.fromCache || (!!f.country && !!p.country && cnorm(f.country) === cnorm(p.country))));
    checked.push({ slug: c.slug, name: `${c.last}, ${c.first}`, dob: f.dob, age: f.age, ok });
  }
  const pass = checked.filter((c) => c.ok);
  if (pass.length === 1) return { slug: pass[0].slug, how: p.dob ? 'dob' : 'age±1', dob: pass[0].dob, name: pass[0].name };
  return { unmatched: pass.length > 1 ? 'more than one page passes the identity check' : (pool.length ? 'no candidate passes the identity check' : 'no candidate with this name and country'), candidates: checked.length ? checked : cands.slice(0, 6) };
}

async function main() {
  if (fs.existsSync(path.join(CACHE, 'BLOCKED'))) { log('BLOCKED marker present — not running (remove it after checking the cause)'); process.exit(3); }
  const lock = path.join(CACHE, 'run.lock');
  // the holder must be alive AND be this scraper: after a reboot a pid can belong to anything else
  try {
    const pid = +fs.readFileSync(lock, 'utf8');
    process.kill(pid, 0);
    const cmd = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    if (/te-scrape/.test(cmd)) { log(`another run (pid ${pid}) is active — exiting`); process.exit(0); }
  } catch (e) { /* no live holder */ }
  fs.writeFileSync(lock, String(process.pid));
  // `--evidence slug,slug`: fetch a TE page's profile and every season into the cache only — no join, nothing written
  // to players.json. For a player the identity test cannot join (founder 2026-10-17: Svajda's TE page has no DOB), so
  // career overlap can be measured as evidence for the founder's ruling. Same stream, same pace.
  if (arg('--evidence')) {
    for (const slug of arg('--evidence').split(',').filter(Boolean)) {
      const f = profileFacts(await page(`/player/${slug}/`));
      for (const y of f.years) await page(`/player/${slug}/?annual=${y}`, { stable: y < THIS_YEAR, finalAfter: Date.UTC(y + 1, 0, 15) });
      log(`evidence ${slug}: profile + ${f.years.length} seasons cached · requests this run ${requests}`);
    }
    fs.writeFileSync(path.join(CACHE, arg('--done', 'DONE-evidence')), new Date().toISOString() + '\n');
    return;
  }
  const roster = JSON.parse(fs.readFileSync(arg('--players'), 'utf8'));
  const limit = Number(arg('--limit', roster.length));
  // `--seasons 2021-2023`: only these seasons' pages (founder ruling 549b93d3 item 1: the players outside the roster
  // whose short set lists are on screen); `--done NAME`: this roster's own finished marker, so a queued roster never
  // reads the main roster's DONE as its own
  const [sLo, sHi] = String(arg('--seasons', '0-9999')).split('-').map(Number);
  const DONE_F = path.join(CACHE, arg('--done', 'DONE'));
  const outF = path.join(CACHE, 'players.json');
  const out = fs.existsSync(outF) ? JSON.parse(fs.readFileSync(outF, 'utf8')) : {};
  let n = 0;
  for (const p of roster.slice(0, limit)) {
    n++;
    if (!out[p.key] || out[p.key].unmatched) out[p.key] = await resolve(p);
    const r = out[p.key];
    if (r.slug) {
      const f = profileFacts(await page(`/player/${r.slug}/`));
      // a past season is final once fetched after 15 Jan of the next year (late-December ties and corrections are in)
      for (const y of f.years.filter((y) => y >= sLo && y <= sHi)) await page(`/player/${r.slug}/?annual=${y}`, { stable: y < THIS_YEAR, finalAfter: Date.UTC(y + 1, 0, 15) });
      r.years = f.years;
    }
    fs.writeFileSync(outF, JSON.stringify(out, null, 1));
    const pages = fs.readdirSync(path.join(CACHE, 'html')).length;
    log(`${n}/${roster.length} ${p.key} ${p.name}: ${r.slug ? `${r.slug} (${r.how}) ${r.years.length} seasons` : 'UNMATCHED ' + r.unmatched} · requests this run ${requests} · pages cached ${pages}`);
  }
  const vals = Object.values(out);
  fs.writeFileSync(DONE_F, new Date().toISOString() + '\n');
  log(`DONE players ${vals.length} · matched ${vals.filter((v) => v.slug).length} · unmatched ${vals.filter((v) => v.unmatched).length} · requests ${requests}`);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
