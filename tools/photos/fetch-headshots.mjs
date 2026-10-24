#!/usr/bin/env node
// Self-hosted player headshots (founder 2026-10-24, .claude/rules/player-photos.md). Michael has an agreement with ATP
// covering this. Fetches the ATP headshot for every player ID in player-atp-aliases.json and stores two WebP sizes with
// the site's own files, so no page ever requests atptour.com:
//   player-photos/s/<id>.webp   96 px  — cards, rows, quotes
//   player-photos/l/<id>.webp  256 px  — the player profile header
//   player-photos/index.json    which IDs have a stored photo (+ content hashes the page uses as cache-busters)
//
// WHY A VISIBLE CHROME ON THE MAC: ATP's CDN sits behind a Cloudflare challenge. curl, GitHub runners and headless
// Chrome all get 403 `cf-mitigated: challenge` (measured 2026-10-24); a normal Chrome window clears it in <1 s. The
// WebP files are made in that browser (canvas.toBlob), so the repo needs no image library.
//
// RULES (each tested by tools/test-player-photos.js):
//   - keep the last good photo: a failed fetch never deletes or overwrites a stored file (its index entry is kept);
//   - a new alias gets its photo on the next run; an alias REMOVED from the map loses its stored photo (a curation fix,
//     e.g. a wrong person, must take effect);
//   - a file that is a known placeholder (player-photo-manifest.json `placeholders`, e.g. ATP's grey silhouette) is
//     never stored;
//   - every write is atomic (tmp + rename).
//
// Usage: node tools/photos/fetch-headshots.mjs [--repo <dir>] [--only <id,id>] [--headless]
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextIndex, coverageDropped } from './photo-index.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = path.resolve(arg('repo', path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')));
const DIR = path.join(ROOT, 'player-photos');
const INDEX = path.join(DIR, 'index.json');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SIZES = { s: 96, l: 256 };
const QUALITY = 0.82;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const writeAtomic = (f, buf) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', buf); fs.renameSync(f + '.tmp', f); };
const sha = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

const aliases = JSON.parse(fs.readFileSync(path.join(ROOT, 'player-atp-aliases.json'), 'utf8'));
const manifest = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'player-photo-manifest.json'), 'utf8')); } catch { return {}; } })();
const placeholders = new Set((manifest.placeholders || []).map((p) => p.sha1_16));
const prev = (() => { try { return JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch { return { players: {} }; } })();
const only = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const aliasHash = sha(fs.readFileSync(path.join(ROOT, 'player-atp-aliases.json')));

// ── the browser ─────────────────────────────────────────────────────────────────────────────────────────────────
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'stennisfy-photos-'));
const port = 9500 + Math.floor(Math.random() * 400);
const chromeArgs = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
  '--window-size=420,420', '--window-position=40,40', 'about:blank'];
if (process.argv.includes('--headless')) chromeArgs.unshift('--headless=new');   // kept for diagnosis only: Cloudflare challenges it
const chrome = spawn(CHROME, chromeArgs, { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch {} setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }, 300); };
process.on('exit', cleanup);
let ws;
for (let i = 0; i < 80 && !ws; i++) { try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); ws = (l.find((t) => t.type === 'page') || {}).webSocketDebuggerUrl; } catch {} if (!ws) await sleep(250); }
if (!ws) { console.error('photos: Chrome did not start (CDP)'); process.exit(2); }
const sock = new WebSocket(ws); let mid = 0; const pend = new Map();
await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });
sock.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const id = ++mid; pend.set(id, res); sock.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result && r.result.result && r.result.result.value; };
await send('Page.enable');
// open a headshot as a page so Cloudflare's check runs and clears in this browser. Cloudflare re-challenges after a
// run of requests (measured 2026-10-24: 25 in a row, then 403 for every one after), so this runs again on any 403.
const clear = async (code) => {
  await send('Page.navigate', { url: 'https://www.atptour.com/-/media/alias/player-headshot/' + code });
  for (let i = 0; i < 60; i++) { await sleep(500); const t = await ev('document.title').catch(() => ''); if (t && !/just a moment/i.test(t)) return true; }
  return false;
};
if (!(await clear(Object.values(aliases)[0]))) { console.error('photos: Cloudflare challenge did not clear within 30 s — nothing changed (last good photos kept)'); process.exit(3); }
const PACE_MS = 700;   // between photos: a member's page asks for ~25 at once; this job asks for 182, so it goes slowly
let reclears = 0;

// one photo -> { status, srcSha1, s: base64, l: base64 }, made in the browser
const grab = (code) => ev(`(async () => {
  const r = await fetch('/-/media/alias/player-headshot/${code}', { cache: 'reload' });
  const ct = r.headers.get('content-type') || '';
  if (!r.ok || !/^image\\//.test(ct)) return { status: r.status, ct };
  const buf = await r.arrayBuffer();
  const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', buf))).map((x) => x.toString(16).padStart(2, '0')).join('');
  const bm = await createImageBitmap(new Blob([buf]));
  const out = { status: r.status, srcSha1: h, srcBytes: buf.byteLength, srcW: bm.width, srcH: bm.height };
  for (const [k, px] of ${JSON.stringify(Object.entries(SIZES))}) {
    const c = new OffscreenCanvas(px, px); const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high'; x.drawImage(bm, 0, 0, px, px);
    const b = await c.convertToBlob({ type: 'image/webp', quality: ${QUALITY} });
    if (b.type !== 'image/webp') return { status: 'no-webp', ct: b.type };
    const a = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
    out[k] = btoa(s);
  }
  return out;
})()`);

// ── run ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const results = {}, skippedPlaceholder = [];
let fetched = 0, changed = 0;
const entries = Object.entries(aliases).filter(([k]) => !only || only.has(k));
for (const [key, code] of entries) {
  let r = null;
  for (let attempt = 0; attempt < 3 && !(r && r.s); attempt++) {
    try { r = await grab(code); } catch (e) { r = { status: 'error ' + String(e.message || e).slice(0, 80) }; }
    if (r && r.s) break;
    if (r && r.status === 403) { reclears++; await clear(code); } else await sleep(800);   // challenged again: pass it, then retry
  }
  await sleep(PACE_MS);
  if (!r || !r.s) { results[key] = { ok: false, why: r && r.status }; continue; }
  // a known placeholder (ATP's grey silhouette) is never stored; the last good photo, if any, is kept
  if (placeholders.has(r.srcSha1.slice(0, 16))) { skippedPlaceholder.push(key); results[key] = { ok: false, why: 'placeholder ' + r.srcSha1.slice(0, 16) }; continue; }
  const files = {};
  for (const k of Object.keys(SIZES)) {
    const buf = Buffer.from(r[k], 'base64');
    if (buf.slice(0, 4).toString() !== 'RIFF' || buf.slice(8, 12).toString() !== 'WEBP') throw new Error(`photos: ${key} ${k} is not a WebP file`);
    writeAtomic(path.join(DIR, k, key + '.webp'), buf);
    files[k] = sha(buf).slice(0, 10); files[k + 'Bytes'] = buf.length;
  }
  const old = prev.players && prev.players[key];
  if (!old || old.s !== files.s || old.l !== files.l) changed++;
  // the page reads this file on every load: an entry carries only what it or the next run needs (sizes: in the files)
  results[key] = { ok: true, entry: { code, s: files.s, l: files.l, src: r.srcSha1.slice(0, 16) } };
  fetched++;
}
const next = nextIndex({ aliases, prev: prev.players || {}, results, only });
for (const k of next.removed) for (const s of Object.keys(SIZES)) { try { fs.unlinkSync(path.join(DIR, s, k + '.webp')); } catch {} }
const index = {
  _doc: 'Self-hosted ATP headshots by player ID (tools/photos/fetch-headshots.mjs; founder 2026-10-24). The page shows ' +
    'player-photos/<s|l>/<id>.webp only for an ID listed here; anything else is the monogram.',
  generatedAt: new Date().toISOString(),
  aliasHash, sizes: SIZES, quality: QUALITY,
  coverage: { aliases: Object.keys(aliases).length, stored: Object.keys(next.players).length },
  players: next.players,
};
// one player per line: small for the page, readable as a diff for a refresh commit
const lines = Object.entries(index.players).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
const head = JSON.stringify({ ...index, players: '__P__' }, null, 1).replace('"__P__"', '{\n' + lines.join(',\n') + '\n }');
writeAtomic(INDEX, head + '\n');
console.log(`photos: ${index.coverage.stored} of ${index.coverage.aliases} aliases have a stored photo (fetched ${fetched}, kept last good ${next.kept.length}, failed ${next.failed.length}, placeholder ${skippedPlaceholder.length}, changed ${changed}, removed ${next.removed.length}, re-cleared the check ${reclears}x)`);
if (next.failed.length) console.log('photos: failed: ' + next.failed.map((f) => `${f.id}/${f.code} (${f.why})`).join(', '));
if (coverageDropped(prev.coverage, index.coverage))
  console.log(`WARNING photos: stored-photo coverage dropped ${prev.coverage.stored}/${prev.coverage.aliases} -> ${index.coverage.stored}/${index.coverage.aliases}`);
process.exit(0);
