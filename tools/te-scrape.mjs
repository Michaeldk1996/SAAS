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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function cacheFile(rel) { return path.join(CACHE, 'html', rel.replace(/^\/+/, '').replace(/[^A-Za-z0-9._-]+/g, '_') + '.html'); }

// fetch one TE page through the cache. `stable` = a past season: cached copy is final.
async function page(rel, { stable = false } = {}) {
  const f = cacheFile(rel);
  if (fs.existsSync(f)) {
    const age = Date.now() - fs.statSync(f).mtimeMs;
    if (stable || age < MAX_AGE_MS) return fs.readFileSync(f, 'utf8');
  }
  const wait = last + DELAY + Math.floor(Math.random() * 2000) - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now(); requests++;
  let res, text;
  // A lost connection or a sleeping Mac is retried on the same page with backoff (1, 2, 4, 8, 16 min), then the run
  // exits and the launchd job resumes it later from the cache. A non-200 or a challenge page is a BLOCK: never
  // retried — BLOCKED is written and every later start refuses to run until a person removes it.
  for (let attempt = 0; ; attempt++) {
    try { res = await fetch(BASE + rel, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } }); text = await res.text(); break; }
    catch (e) {
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
function searchRows(html) {
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
function profileFacts(html) {
  const d = strip((html.match(/class="plDetail"[\s\S]*?<\/table>/) || [''])[0]);
  const dob = d.match(/Age:\s*(\d+)\s*\((\d+)\.\s*(\d+)\.\s*(\d{4})\)/);
  const country = (d.match(/Country:\s*([A-Za-z .'-]+?)\s+(?:Height|Age|Current)/) || [])[1] || null;
  const years = [...new Set([...html.matchAll(/annual=(\d{4})/g)].map((x) => +x[1]))].sort();
  return { age: dob ? +dob[1] : null, dob: dob ? `${dob[4]}${dob[3].padStart(2, '0')}${dob[2].padStart(2, '0')}` : null, country, years };
}
const COUNTRY_ALIAS = { 'czechia': 'czechrepublic', 'unitedstates': 'usa', 'chinesetaipei': 'taipei', 'korearepublic': 'southkorea' };
const cnorm = (c) => { const n = norm(c); return COUNTRY_ALIAS[n] || n; };

async function resolve(p) {
  const last = p.last || p.name.split(' ').filter((t) => !/\.$/.test(t)).join(' ');
  const initial = norm(p.first || p.name)[0];
  // search on the longest plain-letter token of the surname: "O'Connell" -> "Connell", "Barrios Vera" -> "Barrios"
  const term = last.split(/[\s'’-]+/).filter(Boolean).sort((a, b) => b.length - a.length)[0];
  const html = await page(`/list-players/?search-text-pl=${encodeURIComponent(term)}`);
  const cands = searchRows(html).filter((r) => norm(r.last) === norm(last) || norm(r.last).includes(norm(term)));
  const toks = (x) => String(x || '').split(/[\s-]+/).map(norm).filter(Boolean);
  // first names: equal, a prefix either way, or one shared token ("Tomas" vs "Marcelo Tomas") — the DOB still decides
  const named = cands.filter((r) => p.first ? norm(r.first) === norm(p.first) || norm(r.first).startsWith(norm(p.first)) || norm(p.first).startsWith(norm(r.first)) || toks(r.first).some((t) => toks(p.first).includes(t)) : norm(r.first)[0] === initial);
  // Country is a tie-break only: TE writes some countries in Czech ("Moldavsko") and ours differ (Taiwan / Chinese
  // Taipei, neutral flags). The identity test is the date of birth; without one, the same country AND age ± 1.
  let pool = named.length ? named : cands.filter((r) => norm(r.first)[0] === initial);
  if (!p.dob) pool = pool.filter((r) => !p.country || cnorm(r.country) === cnorm(p.country));
  const checked = [];
  for (const c of pool.slice(0, 6)) {
    const f = profileFacts(await page(`/player/${c.slug}/`));
    const ok = p.dob ? f.dob === p.dob : (f.age != null && p.age != null && Math.abs(f.age - p.age) <= 1);
    checked.push({ slug: c.slug, name: `${c.last}, ${c.first}`, dob: f.dob, age: f.age, ok });
  }
  const pass = checked.filter((c) => c.ok);
  if (pass.length === 1) return { slug: pass[0].slug, how: p.dob ? 'dob' : 'age±1', dob: pass[0].dob, name: pass[0].name };
  return { unmatched: pass.length > 1 ? 'more than one page passes the identity check' : (pool.length ? 'no candidate passes the identity check' : 'no candidate with this name and country'), candidates: checked.length ? checked : cands.slice(0, 6) };
}

async function main() {
  if (fs.existsSync(path.join(CACHE, 'BLOCKED'))) { log('BLOCKED marker present — not running (remove it after checking the cause)'); process.exit(3); }
  const lock = path.join(CACHE, 'run.lock');
  try { const pid = +fs.readFileSync(lock, 'utf8'); process.kill(pid, 0); log(`another run (pid ${pid}) is active — exiting`); process.exit(0); } catch (e) { /* no live holder */ }
  fs.writeFileSync(lock, String(process.pid));
  const roster = JSON.parse(fs.readFileSync(arg('--players'), 'utf8'));
  const limit = Number(arg('--limit', roster.length));
  const outF = path.join(CACHE, 'players.json');
  const out = fs.existsSync(outF) ? JSON.parse(fs.readFileSync(outF, 'utf8')) : {};
  let n = 0;
  for (const p of roster.slice(0, limit)) {
    n++;
    if (!out[p.key] || out[p.key].unmatched) out[p.key] = await resolve(p);
    const r = out[p.key];
    if (r.slug) {
      const f = profileFacts(await page(`/player/${r.slug}/`));
      for (const y of f.years) await page(`/player/${r.slug}/?annual=${y}`, { stable: y < THIS_YEAR - (new Date().getUTCMonth() === 0 ? 1 : 0) });
      r.years = f.years;
    }
    fs.writeFileSync(outF, JSON.stringify(out, null, 1));
    const pages = fs.readdirSync(path.join(CACHE, 'html')).length;
    log(`${n}/${roster.length} ${p.key} ${p.name}: ${r.slug ? `${r.slug} (${r.how}) ${r.years.length} seasons` : 'UNMATCHED ' + r.unmatched} · requests this run ${requests} · pages cached ${pages}`);
  }
  const vals = Object.values(out);
  fs.writeFileSync(path.join(CACHE, 'DONE'), new Date().toISOString() + '\n');
  log(`DONE players ${vals.length} · matched ${vals.filter((v) => v.slug).length} · unmatched ${vals.filter((v) => v.unmatched).length} · requests ${requests}`);
}
main();
