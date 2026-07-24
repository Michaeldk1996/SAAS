// =================================================================
// @ATP_Entry TIMELINE HARVESTER — incremental X-API fetch layer (Layer #8)
// -----------------------------------------------------------------
// This is the piece that actually CONSUMES `X_BEARER_TOKEN`. It pulls
// @ATP_Entry's timeline and captures the blue "ATP Match Statistics"
// card posts (the FH/BH Winners + Unforced-Errors source for the ~20%
// of ATP-250 matches api-tennis has no W/UE for). It does NOT extract the
// numbers — that is the separate vision step (see tools/build-atp-entry-wue.js,
// whose CARDS[] table this queue feeds). This layer's only job is to fetch
// new cards cheaply and hand them off.
//
// WHY IT IS INCREMENTAL (founder spec, TEN-8 2026-07-24):
//   The run stores the newest post id it has seen in a small state file
//   (atp-entry-harvest-state.json). Every run passes that id back to X as
//   `since_id`, so the API returns ONLY posts newer than the last run —
//   never the whole timeline again. That is what lets the workflow poll
//   6x/day (cards land within hours of a match) while the daily credit
//   spend stays ~identical to a single daily run: total posts read per day
//   ≈ the number of posts @ATP_Entry actually makes that day, regardless of
//   how many times we poll. Extra empty polls read ~0 posts.
//
// COST MODEL (X pay-per-use, the default for new dev accounts since Feb 2026):
//   $0.005 per post (tweet) read, $0.010 per user-object read, no monthly floor.
//   - User-id lookup is done ONCE and cached in the state file (userId), so it
//     is not billed on every run.
//   - Reads/run = posts returned since last run (a handful most runs).
//   - Reads/day ≈ @ATP_Entry's daily post volume (~35-45) → ~$0.18-$0.22/day.
//
// USAGE
//   X_BEARER_TOKEN=... node tools/harvest-atp-entry.js        # live incremental pull
//   node tools/harvest-atp-entry.js --self-test               # offline parse/filter check (no token, no network)
//   X_BEARER_TOKEN=... node tools/harvest-atp-entry.js --full # ignore since_id, back-fill (cold start)
// =================================================================
'use strict';
const fs = require('fs');
const path = require('path');

const HANDLE = 'ATP_Entry';
const X_API = 'https://api.x.com/2';
const READ_USD = 0.005;        // per post read
const USER_READ_USD = 0.010;   // per user-object read
const MAX_PAGES = 20;          // hard stop so a cold start can never runaway-burn credits

const STATE_PATH = path.join(__dirname, '..', 'atp-entry-harvest-state.json');
const QUEUE_PATH = path.join(__dirname, '..', 'atp-entry-harvest-queue.json');

const argv = process.argv.slice(2);
const SELF_TEST = argv.includes('--self-test');
const FULL = argv.includes('--full');

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fallback; }
}
function writeJson(p, obj) { fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); }

function defaultState() {
  return { handle: HANDLE, userId: null, lastSeenId: null, updatedAt: null, runs: [] };
}

// A tweet is a CANDIDATE match-statistics card if it carries a photo AND its
// text reads like a per-match stats post. Blue-vs-white (Infosys) can only be
// told apart by looking at the image, so that final discrimination is left to
// the vision extraction step — here we keep the superset and never drop a real
// card. Kept deliberately loose on text, strict on "has a photo".
const CARD_TEXT = /match stat|winners|unforced|\bdef\.?\b|\bvs\.?\b|\d\-\d/i;
function isCandidateCard(tweet, mediaByKey) {
  const keys = (tweet.attachments && tweet.attachments.media_keys) || [];
  const media = keys.map(k => mediaByKey.get(k)).filter(Boolean);
  const hasPhoto = media.some(m => m.type === 'photo');
  if (!hasPhoto) return null;
  if (!CARD_TEXT.test(tweet.text || '')) return null;
  return media
    .filter(m => m.type === 'photo')
    .map(m => ({ url: m.url || m.preview_image_url || null, type: m.type, altText: m.alt_text || null }));
}

// Parse one /tweets response page into { cards[], newestId, nextToken, postsRead }.
function parsePage(json) {
  const data = Array.isArray(json && json.data) ? json.data : [];
  const mediaByKey = new Map();
  const inc = (json && json.includes && json.includes.media) || [];
  for (const m of inc) mediaByKey.set(m.media_key, m);
  const cards = [];
  for (const t of data) {
    const media = isCandidateCard(t, mediaByKey);
    if (media) cards.push({ id: t.id, createdAt: t.created_at || null, text: t.text || '', media });
  }
  const meta = (json && json.meta) || {};
  return { cards, newestId: meta.newest_id || null, nextToken: meta.next_token || null, postsRead: data.length };
}

async function xGet(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 402) throw new Error('X API 402 — credits depleted. Top up the app balance, then re-run.');
  if (res.status === 429) throw new Error('X API 429 — rate limited. The 6x/day cadence is well under any limit; a 429 means another job is sharing this token.');
  if (res.status === 401) throw new Error('X API 401 — X_BEARER_TOKEN invalid or missing the required read scope.');
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`X API ${res.status} — ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

async function resolveUserId(token, counter) {
  const url = `${X_API}/users/by/username/${HANDLE}`;
  const json = await xGet(url, token);
  counter.userReads += 1;
  const id = json && json.data && json.data.id;
  if (!id) throw new Error(`could not resolve @${HANDLE} to a user id: ${JSON.stringify(json).slice(0, 200)}`);
  return id;
}

async function fetchTimeline(userId, sinceId, token, counter) {
  const cards = [];
  let newestId = null;
  let nextToken = null;
  let pages = 0;
  do {
    const p = new URLSearchParams({
      max_results: '100',
      'tweet.fields': 'created_at,attachments',
      expansions: 'attachments.media_keys',
      'media.fields': 'url,type,preview_image_url,alt_text',
    });
    if (sinceId && !FULL) p.set('since_id', sinceId);
    if (nextToken) p.set('pagination_token', nextToken);
    const json = await xGet(`${X_API}/users/${userId}/tweets?${p}`, token);
    const page = parsePage(json);
    counter.postReads += page.postsRead;         // every returned post is one billed read
    if (page.newestId && !newestId) newestId = page.newestId; // first page carries the true newest
    cards.push(...page.cards);
    nextToken = page.nextToken;
    pages += 1;
    // since_id + a full page means there is a long backlog: keep paging.
    // No since_id (cold/full) is capped by MAX_PAGES so a mistake cannot burn the balance.
  } while (nextToken && pages < MAX_PAGES);
  return { cards, newestId, pages, truncated: !!nextToken };
}

function estimateUsd(counter) {
  return counter.postReads * READ_USD + counter.userReads * USER_READ_USD;
}

// ---- offline self-test: proves the parse/filter/dedup logic without a token ----
function selfTest() {
  const mock = {
    data: [
      { id: '105', created_at: '2026-07-24T15:00:00Z', text: 'Estoril | Martinez def. Darderi 6-4 6-2 — Match Statistics', attachments: { media_keys: ['m1'] } },
      { id: '104', created_at: '2026-07-24T14:00:00Z', text: 'Good morning tennis fans! Order of play below.', attachments: { media_keys: ['m2'] } },
      { id: '103', created_at: '2026-07-24T13:00:00Z', text: 'Rublev vs Skatov — Winners & Unforced Errors', attachments: { media_keys: ['m3'] } },
      { id: '102', created_at: '2026-07-24T12:00:00Z', text: 'Career milestone thread, no image.' },
    ],
    includes: { media: [
      { media_key: 'm1', type: 'photo', url: 'https://pbs.twimg.com/m1.jpg' },
      { media_key: 'm2', type: 'photo', url: 'https://pbs.twimg.com/m2.jpg' }, // photo but not a card (text fails)
      { media_key: 'm3', type: 'photo', url: 'https://pbs.twimg.com/m3.jpg' },
    ] },
    meta: { newest_id: '105', oldest_id: '102', result_count: 4 },
  };
  const page = parsePage(mock);
  const ids = page.cards.map(c => c.id);
  const pass =
    page.postsRead === 4 &&                 // 4 posts billed
    ids.length === 2 &&                     // only the two stat cards kept
    ids.includes('105') && ids.includes('103') &&
    !ids.includes('104') && !ids.includes('102') &&
    page.newestId === '105';
  console.log('[self-test] postsRead=%d cards=%j newestId=%s', page.postsRead, ids, page.newestId);
  console.log(pass ? '[self-test] PASS' : '[self-test] FAIL');
  if (!pass) process.exit(1);
}

async function main() {
  if (SELF_TEST) return selfTest();

  const token = process.env.X_BEARER_TOKEN;
  if (!token) {
    console.error('::error::X_BEARER_TOKEN is not set. Add it under Settings -> Secrets and variables -> Actions (or export it locally). Use --self-test to check parsing offline.');
    process.exit(1);
  }

  const state = readJson(STATE_PATH, defaultState());
  const counter = { postReads: 0, userReads: 0 };

  // Resolve + cache the user id once — never billed again after the first run.
  if (!state.userId) {
    state.userId = await resolveUserId(token, counter);
    console.log(`resolved @${HANDLE} -> user id ${state.userId} (one-time lookup)`);
  }

  const sinceId = state.lastSeenId;
  console.log(sinceId && !FULL
    ? `incremental pull: since_id=${sinceId} (only posts newer than the last run)`
    : `FULL back-fill pull (no since_id) — capped at ${MAX_PAGES} pages`);

  const { cards, newestId, pages, truncated } = await fetchTimeline(state.userId, sinceId, token, counter);

  // Merge new candidate cards into the pending queue, dedup by post id.
  const queue = readJson(QUEUE_PATH, { pending: [] });
  const seen = new Set((queue.pending || []).map(c => c.id));
  const fresh = cards.filter(c => !seen.has(c.id));
  queue.pending = [...(queue.pending || []), ...fresh];
  queue.generatedAt = new Date().toISOString();
  queue.note = 'Candidate @ATP_Entry match-statistics cards awaiting FH/BH Winners/UE extraction (vision step, tools/build-atp-entry-wue.js). Blue-vs-white discrimination happens at extraction.';

  // Advance the cursor to the newest post seen. If this run returned nothing
  // (newestId null), keep the old cursor so the next run still resumes there.
  if (newestId) state.lastSeenId = newestId;
  state.updatedAt = new Date().toISOString();
  const est = estimateUsd(counter);
  state.runs = [...(state.runs || []), {
    at: state.updatedAt, pages, postsRead: counter.postReads, userReads: counter.userReads,
    newCards: fresh.length, estUsd: Math.round(est * 1000) / 1000, truncated,
  }].slice(-40); // keep a short rolling history

  writeJson(STATE_PATH, state);
  writeJson(QUEUE_PATH, queue);

  console.log(`\npages=${pages} posts read=${counter.postReads} user reads=${counter.userReads}`);
  console.log(`new candidate cards this run: ${fresh.length} (queue now ${queue.pending.length} pending)`);
  console.log(`estimated credit spend this run: $${est.toFixed(3)}`);
  if (truncated) console.log(`::warning::back-fill hit the ${MAX_PAGES}-page cap — run again to continue from the new cursor.`);
}

main().catch(err => { console.error(`::error::${err.message}`); process.exit(1); });
