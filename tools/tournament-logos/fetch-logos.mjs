#!/usr/bin/env node
// Self-hosted ATP tournament logos (founder 2026-11-16 "link the tournament logo, find a way to do it"; 2026-11-17: the
// ATP agreement covers tournament logos as well as player photos). Rules: .claude/rules/tournament-logos.md.
//
// Reads the curated map tools/tournament-logos/logo-map.json — one entry per Database tournament label (the label the
// Database's Tournament search prints: TOURN_SPLIT / TOURN_COMMON over database-yield.json meta.tournaments) naming the
// ONE atptour.com tournament page whose logo is that event's, or null with the reason none is used — and writes:
//   tournament-logos/<slug>-<atpId>.webp   the logo fitted inside 128 x 96 px, transparent, aspect kept
//   tournament-logos/index.json            { logos: { "<label>": "<file>?v=<hash>" }, sources, missing, generatedAt }
// The page reads index.json (db2TLogosLoad in bsp-consult-dashboard.html); a label with no entry is the initials tile.
//
// WHY A VISIBLE CHROME ON THE MAC: atptour.com sits behind a Cloudflare challenge for every non-browser client (curl,
// GitHub runners, headless Chrome: 403). A normal Chrome window clears it — the player-photo route
// (tools/photos/fetch-headshots.mjs). The WebP files are made in that browser (canvas), so the repo needs no image library.
//
// GUARDS (each tested by tools/test-tournament-logos.js):
//   - the logo is the page's own `img.tournament_logo`; its alt or file name must name the event (logo-map `match`
//     words), otherwise it is refused and listed — never another event's logo;
//   - two labels never get the same image bytes (a shared generic placeholder would show up that way): refused;
//   - a failed fetch keeps the last good file and its index entry; every write is atomic (tmp + rename).
//
// Usage: node tools/tournament-logos/fetch-logos.mjs [--repo <dir>] [--only "<label>,<label>"]
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(arg('repo', path.join(HERE, '..', '..')));
const DIR = path.join(ROOT, 'tournament-logos');
const INDEX = path.join(DIR, 'index.json');
const MAP = JSON.parse(fs.readFileSync(path.join(HERE, 'logo-map.json'), 'utf8'));
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BOX = { w: 128, h: 96 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const writeAtomic = (f, buf) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', buf); fs.renameSync(f + '.tmp', f); };
const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
// The logo names the event when its alt or file name holds one of the entry's match words.
export const namesEvent = (entry, src, alt) => (entry.match || []).some((w) => norm(alt).includes(norm(w)) || norm(path.basename(String(src).split('?')[0])).includes(norm(w)));

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const prev = (() => { try { return JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch { return { logos: {}, sources: {} }; } })();
  const only = arg('only', '') ? new Set(arg('only', '').split(',')) : null;

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'stennisfy-tlogos-'));
  const port = 9500 + Math.floor(Math.random() * 400);
  const chrome = spawn(CHROME, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--window-size=900,700', '--window-position=40,40', 'about:blank'], { stdio: 'ignore' });
  process.on('exit', () => { try { chrome.kill(); } catch {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} });
  let ws;
  for (let i = 0; i < 80 && !ws; i++) { try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); ws = (l.find((t) => t.type === 'page') || {}).webSocketDebuggerUrl; } catch {} if (!ws) await sleep(250); }
  if (!ws) { console.error('logos: Chrome did not start (CDP)'); process.exit(2); }
  const sock = new WebSocket(ws); let mid = 0; const pend = new Map();
  await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });
  sock.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}) => new Promise((res) => { const id = ++mid; pend.set(id, res); sock.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result && r.result.result && r.result.result.value; };
  await send('Page.enable');
  const go = async (url) => {
    await send('Page.navigate', { url });
    // ready = the page's logo element is there (full load waits on ads, ~40 s a page) or the page has none at all
    for (let i = 0; i < 80; i++) { await sleep(400); const t = await ev('(document.querySelector("img.tournament_logo")?"logo":document.readyState)+"|"+document.title').catch(() => '');
      if (t && !/just a moment/i.test(t) && (t.startsWith('logo') || t.startsWith('complete'))) return true; }
    return false;
  };

  const grab = async (pg) => {
    const url = `https://www.atptour.com/en/tournaments/${pg.slug}/${pg.atpId}/overview`;
    if (!(await go(url))) return { err: 'page did not load (challenge not cleared)' };
    await sleep(300);
    return ev(`(async () => {
      const im = document.querySelector('img.tournament_logo'); if (!im) return { err: 'no tournament logo on the page' };
      const src = im.getAttribute('src'), alt = im.alt || '';
      const r = await fetch(src, { cache: 'reload' }); if (!r.ok) return { err: 'logo HTTP ' + r.status, src, alt };
      const buf = await r.arrayBuffer(); const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', buf))).map(b => b.toString(16).padStart(2,'0')).join('');
      const bmp = await createImageBitmap(new Blob([buf]));
      const k = Math.min(${BOX.w} / bmp.width, ${BOX.h} / bmp.height, 1), w = Math.max(1, Math.round(bmp.width * k)), hh = Math.max(1, Math.round(bmp.height * k));
      const c = document.createElement('canvas'); c.width = w; c.height = hh; const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, w, hh);
      const px = g.getImageData(0, 0, w, hh).data; let ink = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 16) ink++;
      const blob = await new Promise(res => c.toBlob(res, 'image/webp', 0.92));
      const u8 = new Uint8Array(await blob.arrayBuffer()); let bin = ''; for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
      return { src, alt, srcSha1: h, w, h: hh, srcW: bmp.width, srcH: bmp.height, ink: ink / (w * hh), b64: btoa(bin) };
    })()`).catch((e) => ({ err: String(e).slice(0, 200) }));
  };
  const logos = {}, sources = {}, missing = {}, bySha = {};
  let fetched = 0, kept = 0;
  for (const [label, entry] of Object.entries(MAP.events)) {
    if (entry.sameAs) continue;
    if (only && !only.has(label)) { if (prev.logos[label]) { logos[label] = prev.logos[label]; sources[label] = prev.sources[label]; if (sources[label]) bySha[sources[label].srcSha1] = label; } continue; }
    const why = [];
    let done = false;
    for (const pg of entry.pages || []) {
      const got = await grab(pg);
      if (!got || got.err) { why.push(`ATP ${pg.atpId}: ${got ? got.err : 'no answer'}`); continue; }
      if (!namesEvent(entry, got.src, got.alt)) { why.push(`ATP ${pg.atpId} shows "${got.alt}" (${path.basename(got.src)}), not this event`); continue; }
      if (got.ink < 0.02) { why.push(`ATP ${pg.atpId}: logo is (nearly) blank`); continue; }
      if (bySha[got.srcSha1]) { why.push(`ATP ${pg.atpId}: same image as ${bySha[got.srcSha1]}, refused`); continue; }
      bySha[got.srcSha1] = label;
      const buf = Buffer.from(got.b64, 'base64'), file = `${pg.slug}-${pg.atpId}.webp`;
      writeAtomic(path.join(DIR, file), buf);
      logos[label] = `${file}?v=${sha(buf).slice(0, 10)}`;
      sources[label] = { atpId: pg.atpId, slug: pg.slug, src: got.src, alt: got.alt, srcSha1: got.srcSha1, size: [got.w, got.h], srcSize: [got.srcW, got.srcH] };
      fetched++; done = true; console.log(`  ok   ${label} <- ATP ${pg.atpId} "${got.alt}" ${path.basename(got.src)} (${got.srcW}x${got.srcH})`);
      break;
    }
    if (!done) {
      const fatal = why.length && why.every((w) => /did not load|no answer|HTTP/.test(w));
      if (fatal && prev.logos[label] && fs.existsSync(path.join(DIR, prev.logos[label].split('?')[0]))) { logos[label] = prev.logos[label]; sources[label] = prev.sources[label]; kept++; console.log(`  keep ${label}: ${why.join('; ')}`); }
      else { missing[label] = why.join('; ') || 'no ATP tournament page for this event'; console.log(`  miss ${label}: ${missing[label]}`); }
    }
    await sleep(500);
  }
  // sameAs: the same ATP tournament under two Database labels shares its file (the one sharing the index allows).
  for (const [label, entry] of Object.entries(MAP.events)) if (entry.sameAs) {
    if (logos[entry.sameAs]) { logos[label] = logos[entry.sameAs]; sources[label] = { ...sources[entry.sameAs], sameAs: entry.sameAs }; }
    else missing[label] = `same event as ${entry.sameAs}, which has no logo`;
  }
  // A file no index entry names any more is removed (a curation fix must take effect).
  const named = new Set(Object.values(logos).map((v) => v.split('?')[0]));
  for (const f of fs.existsSync(DIR) ? fs.readdirSync(DIR) : []) if (f.endsWith('.webp') && !named.has(f)) fs.rmSync(path.join(DIR, f));
  const total = Object.keys(MAP.events).length, have = Object.keys(logos).length;
  writeAtomic(INDEX, Buffer.from(JSON.stringify({ generatedAt: new Date().toISOString(), note: 'Self-hosted ATP tournament logos, .claude/rules/tournament-logos.md', count: have, of: total,
    logos: Object.fromEntries(Object.entries(logos).sort()), sources: Object.fromEntries(Object.entries(sources).sort()), missing: Object.fromEntries(Object.entries(missing).sort()) }, null, 1) + '\n'));
  console.log(`logos: ${have} of ${total} events have a stored logo (${fetched} fetched, ${kept} kept); ${Object.keys(missing).length} without`);
  process.exit(0);
}
