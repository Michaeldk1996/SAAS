// Interviews worker (Fly). Signs in once, then for EACH clip plays it in a real Chrome under Xvfb, records the audio it
// plays through a PulseAudio null sink, and transcribes it with whisper. One sign-in, N clips, one machine.
// The browser plays the legitimate signed-in stream; the audio is recorded from the system's own output.
//
// env: TENNISTV_EMAIL, TENNISTV_PASSWORD, [WHISPER_MODEL=small.en],
//      CLIP_URLS = JSON array of {url, slug?, round?}  (preferred)  OR  CLIP_URL = one url
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { signIn } from './ttv-auth.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HERE = path.dirname(new URL(import.meta.url).pathname);
const MODEL = process.env.WHISPER_MODEL || 'small.en';

// clip list: CLIP_URLS (json) wins, else a single CLIP_URL
let clips = [];
if (process.env.CLIP_URLS) { try { clips = JSON.parse(process.env.CLIP_URLS); } catch (e) { console.error('CLIP_URLS not JSON'); process.exit(2); } }
else if (process.env.CLIP_URL) clips = [{ url: process.env.CLIP_URL }];
clips = clips.map((c) => (typeof c === 'string' ? { url: c } : c)).filter((c) => c && c.url);
if (!clips.length) { console.error('no clips (set CLIP_URLS or CLIP_URL)'); process.exit(2); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ttv-'));

console.log('signing in…');
// the sign-in page occasionally comes back without its form: try a few times before giving up
let tok;
for (let i = 1; i <= 4 && !tok; i++) {
  try { tok = await signIn(process.env.TENNISTV_EMAIL, process.env.TENNISTV_PASSWORD); }
  catch (e) { console.log(`sign-in attempt ${i} failed: ${String(e.message || e).slice(0, 120)}`); if (i === 4) { console.error('sign-in failed'); process.exit(4); } await sleep(8000 * i); }
}
console.log('signed in, access token len', tok.access_token.length, '· model', MODEL, '·', clips.length, 'clips');

// one Chrome under the Xvfb display; audio goes to the default pulse sink
const port = 9222;
const chromeArgs = ['--remote-debugging-port=' + port, '--user-data-dir=' + path.join(work, 'profile'),
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--no-sandbox', '--autoplay-policy=no-user-gesture-required',
  '--window-size=1280,720', '--alsa-output-device=default', 'about:blank'];
const chrome = spawn(process.env.CHROME_BIN || 'chromium', chromeArgs, { stdio: 'ignore', env: process.env });
process.on('exit', () => { try { chrome.kill(); } catch (e) {} });

let ws;
for (let i = 0; i < 80 && !ws; i++) { try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); ws = (l.find((t) => t.type === 'page') || {}).webSocketDebuggerUrl; } catch (e) {} if (!ws) await sleep(250); }
if (!ws) { console.error('Chrome did not start (CDP)'); process.exit(3); }
const sock = new WebSocket(ws); let mid = 0; const pend = new Map();
await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });
sock.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const id = ++mid; pend.set(id, res); sock.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result && r.result.result && r.result.result.value; };
await send('Page.enable');

// prime the session once: open tennistv.com and write the tokens into localStorage
await send('Page.navigate', { url: 'https://www.tennistv.com/' });
for (let i = 0; i < 40; i++) { const t = await ev('document.readyState').catch(() => ''); if (t === 'complete') break; await sleep(500); }
await ev(`localStorage.setItem('kc_auth_token', ${JSON.stringify(tok.access_token)}); localStorage.setItem('kc_refresh_token', ${JSON.stringify(tok.refresh_token)}); 'ok'`);

async function oneClip(c, i) {
  const wav = path.join(work, `a${i}.wav`);
  await send('Page.navigate', { url: c.url });
  let dur = 0;
  for (let k = 0; k < 60; k++) { dur = await ev('(document.querySelector("video")||{}).duration || 0').catch(() => 0); if (dur > 1) break; await sleep(500); }
  if (!dur) return { ...c, ok: false, error: 'no playable video' };
  // record until the clip has really finished playing (a stalled or buffering player must not cut the recording short)
  const rec = spawn('ffmpeg', ['-y', '-f', 'pulse', '-i', 'rec.monitor', '-ac', '1', '-ar', '16000', wav], { stdio: 'ignore' });
  const recDone = new Promise((res) => rec.on('exit', res));
  await sleep(400);
  await ev('(() => { const v = document.querySelector("video"); if (v) { v.muted = false; v.currentTime = 0; v.play(); } return true; })()');
  const t0 = Date.now(); let pos = 0, ended = false;
  while (Date.now() - t0 < (dur * 4 + 30) * 1000) {
    await sleep(1000);
    const st = await ev('(() => { const v = document.querySelector("video"); return v ? [v.currentTime, v.ended, v.paused] : null; })()').catch(() => null);
    if (!st) continue;
    pos = st[0]; ended = !!st[1] || pos >= dur - 0.4;
    if (ended) break;
    if (st[2]) await ev('(() => { const v = document.querySelector("video"); if (v) v.play(); return true; })()').catch(() => {});
  }
  await sleep(1200);
  rec.kill('SIGINT'); await recDone;
  const wall = Math.round((Date.now() - t0) / 1000);
  if (!ended) return { ...c, ok: false, error: `playback did not finish (reached ${Math.round(pos)}s of ${Math.round(dur)}s in ${wall}s)` };
  const bytes = fs.existsSync(wav) ? fs.statSync(wav).size : 0;
  if (bytes < 2000) return { ...c, ok: false, error: 'no audio captured' };
  const py = spawnSync('python3', [path.join(HERE, 'transcribe.py'), wav, MODEL], { encoding: 'utf8', maxBuffer: 1 << 24 });
  try { fs.unlinkSync(wav); } catch (e) {}
  if (py.status !== 0) return { ...c, ok: false, error: 'transcribe: ' + (py.stderr || '').slice(-200) };
  return { ...c, ok: true, duration: Math.round(dur), playedIn: wall, transcript: py.stdout.trim() };
}

const results = [];
for (let i = 0; i < clips.length; i++) {
  const c = clips[i];
  console.log(`\n[${i + 1}/${clips.length}] ${c.slug || c.url}`);
  let r;
  try { r = await oneClip(c, i); } catch (e) { r = { ...c, ok: false, error: String(e).slice(0, 200) }; }
  results.push(r);
  console.log('  ' + (r.ok ? `ok · ${r.duration}s (played in ${r.playedIn}s) · ${r.transcript.length} chars` : 'FAILED · ' + r.error));
  if (r.ok) { console.log('  --- TRANSCRIPT ---'); console.log('  ' + r.transcript); }
}

console.log('\n===RESULTS_JSON_START===');
console.log(JSON.stringify({ model: MODEL, count: results.length, ok: results.filter((r) => r.ok).length, results }));
console.log('===RESULTS_JSON_END===');
await sleep(25000);   // let the log stream flush before the machine stops
process.exit(0);
