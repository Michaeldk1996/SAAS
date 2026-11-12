// Interviews worker (Fly). Milestone 1: sign in, play ONE clip in a real Chrome under Xvfb, record the audio it plays
// through a PulseAudio null sink, transcribe it with whisper. Prints the transcript. The browser plays the legitimate
// signed-in stream; the audio is recorded from the system's own output — the stream's key is never touched.
//
// env: TENNISTV_EMAIL, TENNISTV_PASSWORD, CLIP_URL, [WHISPER_MODEL=base.en]
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { signIn } from './ttv-auth.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CLIP = process.env.CLIP_URL;
if (!CLIP) { console.error('CLIP_URL not set'); process.exit(2); }
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ttv-'));
const wav = path.join(work, 'audio.wav');

console.log('1) signing in…');
const tok = await signIn(process.env.TENNISTV_EMAIL, process.env.TENNISTV_PASSWORD);
console.log('   signed in, access token len', tok.access_token.length);

// Chrome under the Xvfb display already started by entrypoint; audio goes to the default pulse sink.
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

console.log('2) injecting the session and opening the clip…');
await send('Page.navigate', { url: 'https://www.tennistv.com/' });
for (let i = 0; i < 40; i++) { const t = await ev('document.readyState').catch(() => ''); if (t === 'complete') break; await sleep(500); }
await ev(`localStorage.setItem('kc_auth_token', ${JSON.stringify(tok.access_token)}); localStorage.setItem('kc_refresh_token', ${JSON.stringify(tok.refresh_token)}); 'ok'`);
await send('Page.navigate', { url: CLIP });
let dur = 0;
for (let i = 0; i < 60; i++) { dur = await ev('(document.querySelector("video")||{}).duration || 0').catch(() => 0); if (dur > 1) break; await sleep(500); }
console.log('   video duration', dur, 's');
if (!dur) { console.error('no playable video (sign-in or playback failed)'); process.exit(4); }

console.log('3) recording the audio while it plays…');
const rec = spawn('ffmpeg', ['-y', '-f', 'pulse', '-i', 'rec.monitor', '-t', String(Math.ceil(dur + 2)), '-ac', '1', '-ar', '16000', wav], { stdio: 'ignore' });
await ev('(() => { const v = document.querySelector("video"); if (v) { v.muted = false; v.currentTime = 0; v.play(); } return true; })()');
await new Promise((res) => rec.on('exit', res));
const bytes = fs.existsSync(wav) ? fs.statSync(wav).size : 0;
console.log('   recorded', bytes, 'bytes');
if (bytes < 2000) { console.error('no audio captured'); process.exit(5); }

console.log('4) transcribing…');
const py = spawnSync('python3', [path.join(path.dirname(new URL(import.meta.url).pathname), 'transcribe.py'), wav, process.env.WHISPER_MODEL || 'base.en'], { encoding: 'utf8', maxBuffer: 1 << 24 });
if (py.status !== 0) { console.error('transcribe failed:', (py.stderr || '').slice(-400)); process.exit(6); }
console.log('--- TRANSCRIPT ---');
console.log(py.stdout.trim());
process.exit(0);
