#!/usr/bin/env node
// Founder brief "round 2" item 1.5 (2026-10-25): Telegram when the PUBLISHED site data is more than 60 minutes old.
//
// WHAT IS MEASURED: the live build-info.json's `data.builtAt` — the build time of the data run whose output is on the
// site. Not the top-level `builtAt`, which is the PUBLISH time: a code-only publish re-deploys the last data and makes
// `builtAt` fresh while the data stays old (tools/pipeline-stall-guard.mjs already alerts on `builtAt` > 40 min; this is
// the data-age alarm it cannot be).
//
// WHEN IT SENDS (the decision is `decide`, tested by tools/test-data-staleness-alert.mjs with a fake clock):
//   - data.builtAt more than STALE_AFTER_MIN (60) old → ONE message when a stale episode is first seen, then at most one
//     every REPEAT_MIN (60) while the SAME episode lasts. An episode is the stale data.builtAt itself (stale data does
//     not move), so a recovery followed by a new stale build is a new episode and alerts at once.
//   - build-info.json unreadable (network error, non-200, not JSON, no valid data.builtAt) after FETCH_TRIES (3) tries
//     FETCH_GAP_MS (30 s) apart → the same, as the episode "unread", and the message says the file could not be read.
//     A single transient blip never alerts: it has to fail three times across about a minute inside one pass. That is
//     stateless; confirming across passes would need a state write on every 15-min pass instead of only on an alert.
//   - fresh → nothing, and nothing is written.
// STATE: the last alert ({ episode, at }) in STATE_FILE, carried between passes by actions/cache in
// .github/workflows/data-staleness-alert.yml (restored by prefix = the newest entry; saved only after a message was
// DELIVERED, so an undelivered alert is retried next pass). No state (first run, evicted cache) = no prior alert:
// the worst case is one extra message, never a missed one.
// Never fails the job for an unsent alert: an ::error:: in the log and the step summary instead (as
// tools/pipeline-fail-alert.mjs).
// Env: SITE_URL, STATE_FILE, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GITHUB_OUTPUT, GITHUB_STEP_SUMMARY;
// TELEGRAM_API_URL / FETCH_GAP_MS point the test at a fake server and a short retry gap.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { sendTelegram } from './price-alert-send.mjs';

export const STALE_AFTER_MIN = 60;
export const REPEAT_MIN = 60;
export const FETCH_TRIES = 3;
export const FETCH_GAP_MS = 30000;
const MIN = 60000;
const utc = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + 'Z';

// { ok: true, info } | { ok: false, why } — tries `tries` times, `gapMs` apart; the last failure's reason is kept.
export async function readBuildInfo(siteUrl, { now = Date.now(), tries = FETCH_TRIES, gapMs = FETCH_GAP_MS,
  fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const url = `${String(siteUrl).replace(/\/$/, '')}/build-info.json?cb=${now}`;
  let why = 'not tried';
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetchImpl(url, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
      if (r.status !== 200) why = `HTTP ${r.status}`;
      else {
        let info = null;
        try { info = JSON.parse(await r.text()); } catch { why = 'not valid JSON'; }
        if (info) {
          if (Number.isFinite(Date.parse(info?.data?.builtAt))) return { ok: true, info, tries: i };
          why = 'no valid data.builtAt';
        }
      }
    } catch (e) { why = e.name === 'TimeoutError' ? 'timed out' : `network error (${e.name})`; }
    if (i < tries) await sleep(gapMs);
  }
  return { ok: false, why, tries };
}

// prev: the last DELIVERED alert { episode, at } or null. Returns { alert, why, text?, state? }.
export function decide({ now, read, prev }) {
  let episode, text;
  if (read.ok) {
    const built = Date.parse(read.info.data.builtAt);
    const mins = (now - built) / MIN;
    if (!(mins > STALE_AFTER_MIN)) return { alert: false, why: `fresh: data built ${utc(built)} (${Math.max(0, Math.round(mins))} min ago)` };
    episode = `stale:${built}`;
    const pub = Date.parse(read.info.builtAt);
    text = [`Stennisfy site data is stale: the published data was built ${utc(built)}, ${Math.round(mins)} min ago (alert after ${STALE_AFTER_MIN} min).`,
      Number.isFinite(pub) ? `Last publish: ${utc(pub)}.` : '',
      read.info.data.runId ? `Data run: ${read.info.data.runId}.` : ''].filter(Boolean).join(' ');
  } else {
    episode = 'unread';
    text = `Stennisfy site data age unknown: build-info.json could not be read (${read.why}, ${read.tries} tries about ${Math.round(FETCH_GAP_MS / 1000)} s apart). The site may be down or the file broken.`;
  }
  if (prev && prev.episode === episode && now - prev.at < REPEAT_MIN * MIN)
    return { alert: false, why: `already alerted for this at ${utc(prev.at)} (next at most ${REPEAT_MIN} min after it)` };
  const repeat = prev && prev.episode === episode;
  return { alert: true, text: `${repeat ? 'Still: ' : ''}${text}\n${utc(now)}`, state: { episode, at: now } };
}

export function readState(file) {
  try { const s = JSON.parse(readFileSync(file, 'utf8')); return s && typeof s.episode === 'string' && Number.isFinite(s.at) ? s : null; }
  catch { return null; }
}
function writeState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state) + '\n');
  renameSync(tmp, file);
}

// One pass. Returns { sent, save, d }. `save` is true only when a message was delivered and the state written.
export async function run(env, { now = Date.now(), fetchImpl, sleep, log = console.log } = {}) {
  const stateFile = env.STATE_FILE || '.data-staleness-alert/state.json';
  const gapMs = env.FETCH_GAP_MS !== undefined ? Number(env.FETCH_GAP_MS) : FETCH_GAP_MS;
  const read = await readBuildInfo(env.SITE_URL || 'https://michaeldk1996.github.io/SAAS', { now, gapMs, ...(fetchImpl && { fetchImpl }), ...(sleep && { sleep }) });
  const d = decide({ now, read, prev: readState(stateFile) });
  if (!d.alert) { log(`data-staleness: no message (${d.why})`); return { sent: false, save: false, d }; }
  const r = await sendTelegram(d.text, env);
  let save = false;
  if (r.ok) {
    writeState(stateFile, d.state); save = true;
    log(`data-staleness: Telegram sent (${r.why})`);
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, 'save=true\n');
  } else {
    log(`::error title=Data-staleness alert not sent::Telegram ${r.why} — retried next pass`);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### Data-staleness alert NOT sent (${r.why})\n\n${d.text}\n`);
  }
  log(d.text);
  return { sent: r.ok, save, d };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { await run(process.env); }
  catch (e) { console.log(`::error title=Data-staleness alert::${e.message} — no message sent`); }
  process.exit(0);
}
