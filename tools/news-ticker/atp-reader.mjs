#!/usr/bin/env node
// News ticker — the ATP reader (founder 2026-11-12: "we have an agreement" with ATP, and "we do work around technical
// blocks, find a solution"). atptour.com answers 403 (a Cloudflare challenge) to curl, GitHub runners and headless
// Chrome; a normal Chrome window on the Mac clears it — the route the headshot job already uses (tools/photos/). So this
// runs on the Mac, drives a small visible Chrome, and hands the quotes it finds to the collector.
//
// What it stores: news-quotes/inbox-atp.json — per quote the quoted words, the speaker's player key, the article URL,
// its publication time and the tournaments the article names. NEVER article text. The verbatim check runs here, on the
// fetched page, because the page text does not leave this machine; the collector takes these candidates as checked.
// news-quotes/atp-fetched.json remembers the article URLs already read (an article is read once).
//
// Usage: node tools/news-ticker/atp-reader.mjs [--repo <dir>] [--base <site url>] [--max <articles>]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readOutlet, surnameOf, initialOf } from './outlet-reader.mjs';
import { verbatimIn } from './news-core.mjs';
import { activeTournaments, tourPlayers } from './collect-quotes.mjs';

export const ATP = { outlet: 'ATP Tour', country: 'INT', language: 'en', status: 'allowed', enabled: true, sectionUrl: 'https://www.atptour.com/en/news' };
export const INBOX_DAYS = 14;

// The checked candidates of one read -> inbox rows (no article text). Pure; tested.
export function inboxRows(candidates, nowIso) {
  const out = [];
  for (const c of candidates || []) {
    if (!(c.spans || [c.text]).every((sp) => verbatimIn(sp, c.sourceText))) continue;   // word for word on the page, or not kept
    out.push({ id: `atp|${c.sourceUrl}|${c.id}`, speakerKey: String(c.speakerKey), spans: c.spans, text: c.text, sourceName: c.sourceName, sourceUrl: c.sourceUrl,
      timestamp: c.timestamp, timestampKind: c.timestampKind, day: c.day, language: c.language, mentions: c.mentions || [],
      verbatim: 'checked on the fetched page by the ATP reader', readAt: nowIso });
  }
  return out;
}
// inbox + new rows, one per id, rows older than INBOX_DAYS dropped
export function mergeInbox(prev, rows, nowIso) {
  const by = new Map(((prev && prev.candidates) || []).map((x) => [x.id, x]));
  for (const r of rows) if (!by.has(r.id)) by.set(r.id, r);
  const cut = Date.parse(nowIso) - INBOX_DAYS * 86400000;
  return { updatedAt: nowIso, candidates: [...by.values()].filter((x) => !(Date.parse(x.readAt) < cut)) };
}

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const ROOT = path.resolve(arg('repo', path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')));
  const BASE = arg('base', 'https://michaeldk1996.github.io/SAAS').replace(/\/$/, ''), nowIso = new Date().toISOString();
  const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rd = (p) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); } catch (e) { return null; } };
  const wr = (p, o) => { const f = path.join(ROOT, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(o, null, 1) + '\n'); fs.renameSync(f + '.tmp', f); };
  const reg = rd('data/news-outlets.json') || {};
  const entry = (reg.outlets || []).find((o) => /atptour\.com/.test(String(o.sectionUrl)));
  if (entry && entry.enabled === false) { console.log('atp reader: ATP is switched off in the registry — nothing read'); return; }
  const getJson = async (p) => (await fetch(`${BASE}/${p}`, { signal: AbortSignal.timeout(60000) })).json();
  const [board, index] = await Promise.all([getJson('matches.json'), getJson('player-index.json')]);
  const active = activeTournaments(board, nowIso).filter((t) => t.active);
  const pairs = [...tourPlayers(index).map((p) => [p.key, p.name]), ...active.flatMap((t) => t.cards.flatMap((m) => [[String(m.p1Key), m.p1], [String(m.p2Key), m.p2]]))];
  const players = [...new Map(pairs).entries()].map(([key, name]) => ({ key, name, surname: surnameOf(name), initial: initialOf(name) })).filter((p) => p.surname.length >= 3);

  // ── the browser (the headshot job's method) ──
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'stennisfy-atpnews-')), port = 9500 + Math.floor(Math.random() * 400);
  const chrome = spawn(CHROME, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=420,420', '--window-position=40,40', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => { try { chrome.kill(); } catch (e) { /* gone */ } setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* tmp */ } }, 300); };
  process.on('exit', cleanup);
  let ws; for (let i = 0; i < 80 && !ws; i++) { try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); ws = (l.find((t) => t.type === 'page') || {}).webSocketDebuggerUrl; } catch (e) { /* not up yet */ } if (!ws) await sleep(250); }
  if (!ws) { console.error('atp reader: Chrome did not start'); process.exit(2); }
  const sock = new WebSocket(ws); let mid = 0; const pend = new Map();
  await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });
  sock.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const id = ++mid; pend.set(id, res); sock.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.result && r.result.result.value; };
  await send('Page.enable');
  await send('Page.navigate', { url: ATP.sectionUrl });
  let clear = false; for (let i = 0; i < 60 && !clear; i++) { await sleep(500); const t = await ev('document.title').catch(() => ''); clear = !!t && !/just a moment/i.test(t); }
  if (!clear) { console.error('atp reader: the page did not open within 30 s — nothing changed'); process.exit(3); }
  // the list of articles is filled in after the page opens: wait until it is there (up to 20 s)
  for (let i = 0; i < 40; i++) { const n = await ev(`document.querySelectorAll('a[href*="/en/news/"]').length`).catch(() => 0); if (n >= 8) break; await sleep(500); }
  // a Response-like fetch through the open page (same origin), so readOutlet runs unchanged
  const fetchFn = async (url) => {
    // the section is the page this window has open (its own request for it is challenged again; the rendered page is not)
    if (url === ATP.sectionUrl) { const body = await ev('document.documentElement.outerHTML'); return { status: body ? 200 : 0, url, text: async () => body || '' }; }
    const r = JSON.parse(await ev(`(async () => { try { const r = await fetch(${JSON.stringify(url)}, { cache: 'reload' }); return JSON.stringify({ status: r.status, url: r.url, body: await r.text() }); } catch (e) { return JSON.stringify({ status: 0, url: ${JSON.stringify(url)}, body: '' }); } })()`) || '{"status":0,"body":""}');
    return { status: r.status, url: r.url || url, text: async () => r.body };
  };
  const cache = rd('news-quotes/atp-fetched.json') || {};
  const r = await readOutlet({ outlet: ATP, players, tournamentNames: active.map((t) => t.name), cache, nowIso, since: Date.parse(nowIso) - 21 * 86400000, fetchFn });
  for (const c of r.candidates) c.sourceName = 'ATP Tour';
  const rows = inboxRows(r.candidates, nowIso), inbox = mergeInbox(rd('news-quotes/inbox-atp.json'), rows, nowIso), before = ((rd('news-quotes/inbox-atp.json') || {}).candidates || []).length;
  for (const [u, v] of Object.entries(cache)) if (Date.parse(nowIso) - Date.parse(v.at) > 45 * 86400000) delete cache[u];
  wr('news-quotes/atp-fetched.json', cache);
  if (inbox.candidates.length !== before) wr('news-quotes/inbox-atp.json', inbox);
  console.log(`atp reader: section ${r.stats.section}, ${r.stats.links} links, ${r.stats.relevant} about our players, ${r.stats.fetched} read now (${r.stats.alreadyFetched} read before), ${r.candidates.length} quotes found, ${rows.length} word for word, inbox ${before} -> ${inbox.candidates.length}${r.stats.blocked ? ' — BLOCKED: ' + r.stats.blocked : ''}`);
  process.exit(0);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error('atp reader: ' + (e && e.stack || e)); process.exit(1); });
