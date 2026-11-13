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
if (!clips.length && !process.env.FRAME_CLIPS && !process.env.DISCOVER_URL) { console.error('no clips (set CLIP_URLS or CLIP_URL)'); process.exit(2); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ttv-'));

console.log('signing in…');
const tok = await signIn(process.env.TENNISTV_EMAIL, process.env.TENNISTV_PASSWORD);
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

// DISCOVER mode (a test): open the in-player stats panel of one replay and print what it holds and what it loads.
if (process.env.DISCOVER_URL) {
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 70 }); fs.mkdirSync('/tmp/frames', { recursive: true }); if (r.result && r.result.data) fs.writeFileSync('/tmp/frames/' + name + '.jpg', Buffer.from(r.result.data, 'base64')); };
  const clickXY = async (x, y) => { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 }); };
  await send('Network.enable');
  const reqs = [];
  const prev = sock.onmessage;
  sock.onmessage = (e) => { const m = JSON.parse(e.data); if (m.method === 'Network.requestWillBeSent') { const u = m.params.request.url; if (!/\.m4s|google|facebook|bing|taboola|tiktok|onetrust|clarity|doubleclick|exponea|twitter|reddit|litix|\.png|\.jpg|\.woff|\.css|resources\/v/.test(u)) reqs.push(u.slice(0, 200)); } prev(e); };
  await send('Page.navigate', { url: process.env.DISCOVER_URL });
  let dur = 0;
  for (let k = 0; k < 80; k++) { dur = await ev('(document.querySelector("video")||{}).duration || 0').catch(() => 0); if (dur > 1) break; await sleep(500); }
  console.log('discover: duration', Math.round(dur));
  await ev('(() => { const b = [...document.querySelectorAll("button")].find((x) => /reject all/i.test(x.textContent || "")); if (b) b.click(); const v = document.querySelector("video"); if (v) { v.muted = true; v.play(); v.scrollIntoView({ block: "center" }); } return !!b; })()').then((r) => console.log('discover: cookie banner rejected', r));
  await sleep(4000);
  const vr = await ev('(() => { const r = document.querySelector("video").getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: vr[0] + vr[2] / 2, y: vr[1] + vr[3] / 2 });
  await sleep(800); await shot('d0_player');
  const icons = await ev(`(() => { const v = document.querySelector('video').getBoundingClientRect(); return [...document.querySelectorAll('button, [role=button], a, div[class*=button], li')].map((e) => { const r = e.getBoundingClientRect(); return { cls: String(e.className).slice(0, 90), aria: e.getAttribute('aria-label') || e.title || '', x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((o) => o.w > 12 && o.w < 90 && o.h > 12 && o.h < 90 && o.x > v.x + v.width * 0.8 && o.y > v.y && o.y < v.y + v.height); })()`);
  console.log('discover: right-edge controls', JSON.stringify(icons));
  const before = reqs.length;
  const first = (icons || []).find((o) => /stat|chart|insight/i.test(o.cls + ' ' + o.aria)) || (icons || [])[0];
  if (first) { await clickXY(first.x, first.y); console.log('discover: clicked', JSON.stringify(first)); }
  await sleep(5000); await shot('d1_after_first_icon');
  const dump = async (label) => { const t = await ev(`(() => [...document.querySelectorAll('body *')].filter((e) => e.children.length === 0 && /shot quality|balance of power|steal|conversion|insights|live stats|head 2 head/i.test(e.textContent || '')).map((e) => { let p = e; for (let i = 0; i < 6 && p.parentElement; i++) p = p.parentElement; return String(p.className).slice(0, 60) + ' :: ' + (p.innerText || '').replace(/\\s+/g, ' ').slice(0, 900); }).filter((v, i, a) => a.indexOf(v) === i).slice(0, 4))()`); console.log('discover: ' + label, JSON.stringify(t)); };
  await dump('panel text after first icon');
  const ins = await ev(`(() => { const e = [...document.querySelectorAll('body *')].find((x) => x.children.length === 0 && /^insights$/i.test((x.textContent || '').trim()) && x.getBoundingClientRect().width > 0); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  console.log('discover: INSIGHTS tab at', JSON.stringify(ins));
  if (ins) { await clickXY(ins[0], ins[1]); await sleep(5000); await shot('d2_insights'); await dump('panel text on INSIGHTS'); }
  console.log('discover: requests after opening', JSON.stringify([...new Set(reqs.slice(before))].slice(0, 40)));
  spawnSync('tar', ['-czf', '/tmp/frames.tgz', '-C', '/tmp', 'frames']);
  console.log('FRAMES_READY ' + (fs.existsSync('/tmp/frames.tgz') ? fs.statSync('/tmp/frames.tgz').size : 0));
  await sleep(300000);
  process.exit(0);
}

// FRAMES mode (a test, founder 2026-11-13): the end of a full replay carries the broadcast's stats panel. Seek to the
// last TAIL seconds, play, and keep one picture of the player every STEP seconds in /tmp/frames. No audio is recorded.
if (process.env.FRAME_CLIPS) {
  const list = JSON.parse(process.env.FRAME_CLIPS), TAIL = +(process.env.FRAME_TAIL || 420), STEP = +(process.env.FRAME_STEP || 6);
  fs.mkdirSync('/tmp/frames', { recursive: true });
  for (let n = 0; n < list.length; n++) {
    const c = list[n];
    console.log(`[frames ${n + 1}/${list.length}] ${c.slug || c.url}`);
    await send('Page.navigate', { url: c.url });
    let dur = 0;
    for (let k = 0; k < 80; k++) { dur = await ev('(document.querySelector("video")||{}).duration || 0').catch(() => 0); if (dur > 1) break; await sleep(500); }
    if (!dur) { console.log('  FAILED · no playable video'); continue; }
    // Seek the way a viewer does: show the controls, click the player's own seek bar. Setting the video element's time
    // directly leaves the player frozen (it never fetches the new position).
    // the cookie banner covers the lower half of the player (and its seek bar): decline it first
    await ev('(() => { const b = [...document.querySelectorAll("button")].find((x) => /reject all/i.test(x.textContent || "")); if (b) b.click(); const v = document.querySelector("video"); v.muted = true; v.play(); v.scrollIntoView({ block: "center" }); return !!b; })()');
    await sleep(4000);
    const target = Math.max(0, dur - TAIL);
    let ready = false, at = 0;
    for (let attempt = 0; attempt < 4 && !ready; attempt++) {
      const vr = await ev('(() => { const r = document.querySelector("video").getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()');
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: vr[0] + vr[2] / 2, y: vr[1] + vr[3] / 2 });
      await sleep(600);
      const sb = await ev('(() => { const e = document.querySelector(".bmpui-seekbar") || document.querySelector(".bmpui-ui-seekbar"); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()');
      if (!sb || sb[2] < 50) { console.log('  seek bar not found', JSON.stringify(sb)); await sleep(2000); continue; }
      const x = sb[0] + sb[2] * (target / dur), y = sb[1] + sb[3] / 2;
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
      for (let k = 0; k < 45; k++) { await sleep(1000); const st = await ev('(() => { const v = document.querySelector("video"); return [v.currentTime, v.seeking, v.readyState]; })()').catch(() => null); if (st) { at = st[0]; if (Math.abs(st[0] - target) < 240 && !st[1] && st[2] >= 3) { ready = true; break; } } }
      console.log(`  seek attempt ${attempt + 1}: at ${Math.round(at)}s of ${Math.round(dur)}s · ${ready ? 'ok' : 'not yet'}`);
    }
    await ev('(() => { const v = document.querySelector("video"); if (v.paused) v.play(); return true; })()');
    let i = 0;
    for (;;) {
      const st = await ev('(() => { const v = document.querySelector("video"); const r = v.getBoundingClientRect(); return [v.currentTime, v.ended, r.x, r.y, r.width, r.height]; })()').catch(() => null);
      if (!st || st[1] || st[0] >= dur - 1 || i > TAIL / STEP + 10) break;
      const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 60, clip: { x: st[2], y: st[3], width: st[4], height: st[5], scale: 1 } });
      if (shot.result && shot.result.data) fs.writeFileSync(`/tmp/frames/c${n + 1}_${String(i).padStart(3, '0')}_${Math.round(st[0])}s.jpg`, Buffer.from(shot.result.data, 'base64'));
      i++; await sleep(STEP * 1000);
    }
    console.log(`  ${i} frames kept`);
  }
  spawnSync('tar', ['-czf', '/tmp/frames.tgz', '-C', '/tmp', 'frames']);
  console.log('FRAMES_READY ' + (fs.existsSync('/tmp/frames.tgz') ? fs.statSync('/tmp/frames.tgz').size : 0));
  await sleep(+(process.env.FRAME_HOLD || 600) * 1000);   // stay up so the workflow can fetch the file
  process.exit(0);
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
