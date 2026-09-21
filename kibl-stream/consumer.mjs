// TEN-225 item 2 — the Kibl/Bet105 RabbitMQ consumer.
//
// FOUNDER 2026-09-21: "build it ready, so the day Bet105 enables it we only add
// credentials." Nothing here is deployed. `npm start` with no KIBL_AMQP_URL
// exits 0 after printing what it would have done, so a misfire cannot become a
// half-connected worker nobody notices.
//
// WHAT IT IS FOR. Kibl serves no history: a price the book posts and replaces
// between two of our sweeps is gone permanently. The sweep's floor is ~90
// seconds in the dense band; the stream's floor is the message. The measured
// size of that gap is a LOWER bound of 97.8% of bet105 sides changing at least
// once between open and close (n=91) — every intermediate price is by definition
// not in that figure, and closing it is what this buys.
//
// THE FOUR RULES IT IS BUILT TO (2(a)-(d)), each with the reason it exists:
//
//   (b) SAME TABLES, NEW WRITER. It writes kibl_line_observations and
//       kibl_fixtures exactly as archive-kibl.py does, on the same row_key and
//       the same ignore-duplicates conflict target. See py_str.mjs for the one
//       thing that can silently break that.
//
//   (d) THE SWEEP IS THE BACKSTOP. This supplements it. There is deliberately
//       no code here that disables, throttles or signals the sweep — a stream
//       that can stand the poller down turns one outage into two.
//
//   (a) RECONNECT WITH BACKOFF, AND A REST SNAPSHOT ON RECONNECT. Anything
//       posted while we were disconnected is unrecoverable from the broker
//       unless the queue is durable (an open question for Bet105 — see README),
//       so on every reconnect we take a REST snapshot and LOG THE GAP with its
//       start, end and duration. The gap is recorded whether or not the
//       snapshot finds anything: "we were blind for 4 minutes" is the finding,
//       not "we found 3 rows".
//
//   (c) A HEARTBEAT EVERY 60s. The founder named the failure exactly: "A
//       connected worker receiving nothing looks exactly like a quiet market,
//       and that is the failure that gets missed." So the heartbeat is NOT
//       "am I running" — a process can be up and its channel dead. It records
//       connection state, messages seen since the last beat, and the age of the
//       last message, so a silent channel is distinguishable from a silent
//       market by reading one row.
import { observationKey, parseWithLexemes, assertSourceAccess } from './py_str.mjs';

export const TABLE_OBS = 'kibl_line_observations';
export const TABLE_HEARTBEAT = 'kibl_stream_heartbeat';
export const HEARTBEAT_EVERY_MS = 60_000;

// Reconnect backoff. Capped at 60s: this is a favour-basis feed and a worker
// that retries a refusing broker every second is how the favour ends. Jittered
// because a fleet of one still shares a broker with everyone else's fleet, and
// a deterministic ladder synchronises reconnect storms after a broker restart.
export const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];

export function backoffFor(attempt, rnd = Math.random) {
  const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  // +/-20% jitter, never below 250ms and never above the cap.
  const j = base * 0.2 * (rnd() * 2 - 1);
  return Math.max(250, Math.min(BACKOFF_MS[BACKOFF_MS.length - 1], Math.round(base + j)));
}

/**
 * One AMQP message -> the rows the sweep would have written for it.
 *
 * Returns [] rather than throwing on a shape we do not recognise. A stream is
 * not a request/response: an exception here kills the consumer and stops every
 * OTHER message too, so an unreadable message is counted and dropped, and the
 * count is on the heartbeat where it can be seen. `unreadable` climbing while
 * `rows` stays flat is a schema change, and it looks nothing like a quiet
 * market.
 */
export function rowsFromMessage(bodyText, observedAt, stats = {}) {
  let payload;
  // parseWithLexemes, not JSON.parse: the row key needs the SOURCE TEXT of every
  // number, because 2 and 2.0 are the same double after an ordinary parse and
  // the sweep keys them differently. See py_str.mjs.
  try { payload = parseWithLexemes(bodyText); } catch (e) {
    stats.unreadable = (stats.unreadable || 0) + 1;
    return [];
  }
  // Kibl's REST envelope is {code, description, result: [...]}; the stream's
  // envelope is NOT documented for us and may be a bare row or a bare array.
  // All three are accepted, and anything else is counted rather than guessed.
  const rows = Array.isArray(payload) ? payload
    : Array.isArray(payload?.result) ? payload.result
    : Array.isArray(payload?.market_participants) ? payload.market_participants
    : (payload && typeof payload === 'object' && payload.fixture_id != null) ? [payload]
    : null;
  if (rows === null) {
    stats.unreadable = (stats.unreadable || 0) + 1;
    return [];
  }
  return rows.filter(r => r && typeof r === 'object').map(r => ({
    row_key: observationKey(r),
    observed_at: observedAt,
    // `stream` rather than a sweep id, so a row's provenance is readable in the
    // table forever. The sweep writes a timestamped sweep_id; a stream row has
    // no sweep, and borrowing the last one would attribute it to a pull that
    // never saw it.
    sweep_id: 'stream',
    ...r,
  }));
}

/**
 * The heartbeat row. Built as a pure function so the liveness rule can be
 * tested without a broker or a database.
 */
export function heartbeatRow(state, now) {
  const lastMsgAgeS = state.lastMessageAt == null ? null
    : Math.round((now - state.lastMessageAt) / 1000);
  return {
    id: 1,                       // singleton: the question is "is it alive NOW"
    beat_at: new Date(now).toISOString(),
    connected: !!state.connected,
    // Since the LAST beat, not since boot. A cumulative counter cannot answer
    // "is the channel delivering right now", which is the whole question.
    messages_since_last_beat: state.sinceLastBeat | 0,
    rows_written_since_last_beat: state.rowsSinceLastBeat | 0,
    unreadable_since_last_beat: state.unreadableSinceLastBeat | 0,
    last_message_age_s: lastMsgAgeS,
    reconnects_total: state.reconnects | 0,
    // The gap this worker was last blind for, so an alert can say how much was
    // missed rather than only that something was.
    last_gap_seconds: state.lastGapSeconds ?? null,
    worker_version: state.version || 'dev',
  };
}

/**
 * Is the worker in a state a human should be told about? -> null, or a reason.
 *
 * THE POINT OF THIS FUNCTION IS THE THIRD BRANCH. A disconnected worker is
 * obvious. A connected worker delivering nothing is the one that gets missed,
 * and it is indistinguishable from a quiet market UNLESS you compare against a
 * market that should not be quiet. `expectNearStart` is that comparison: it is
 * true when a fixture is inside the dense band, i.e. exactly when silence is
 * not a plausible market state.
 */
export function livenessAlert(hb, { staleBeatS = 180, silentS = 600, expectNearStart = false } = {}, now = Date.now()) {
  const beatAge = (now - Date.parse(hb.beat_at)) / 1000;
  if (beatAge > staleBeatS) {
    return `no heartbeat for ${Math.round(beatAge)}s (threshold ${staleBeatS}s) — the worker is not running`;
  }
  if (!hb.connected) return 'the worker is running but NOT connected to the broker';
  if (expectNearStart && hb.last_message_age_s != null && hb.last_message_age_s > silentS) {
    return `connected but silent for ${hb.last_message_age_s}s while a fixture is inside the dense band `
         + '— a live channel delivering nothing looks exactly like a quiet market';
  }
  if (expectNearStart && hb.last_message_age_s == null) {
    return 'connected but has NEVER received a message, with a fixture inside the dense band';
  }
  return null;
}

/** start/end/duration for a blind window, so a gap is reportable not merely felt. */
export function gapRecord(downAt, upAt) {
  return {
    start: new Date(downAt).toISOString(),
    end: new Date(upAt).toISOString(),
    duration_seconds: Math.round((upAt - downAt) / 1000),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The runtime. Everything above is pure and tested; everything below needs a
// broker, and is deliberately the thin part.
// ─────────────────────────────────────────────────────────────────────────────
export async function main({ env = process.env, log = console.log } = {}) {
  // Checked BEFORE anything else, including before the no-credentials exit, so
  // a runtime that cannot key rows correctly can never reach the point of
  // writing one.
  assertSourceAccess();
  const url = env.KIBL_AMQP_URL;
  if (!url) {
    // NOT an error. The founder's instruction is "build it ready... the day
    // Bet105 enables it we only add credentials", so no credentials is the
    // expected state today and it must exit clean rather than crash-loop a host.
    log('KIBL_AMQP_URL is not set — nothing to connect to.');
    log('This worker is BUILT AND NOT DEPLOYED, by instruction. When Bet105');
    log('provisions the stream, set KIBL_AMQP_URL / KIBL_AMQP_QUEUE and');
    log('SUPABASE_URL / SUPABASE_SECRET_KEY. Nothing else changes.');
    return 0;
  }
  const { connect } = await import('amqplib');
  const state = {
    connected: false, sinceLastBeat: 0, rowsSinceLastBeat: 0,
    unreadableSinceLastBeat: 0, lastMessageAt: null, reconnects: 0,
    lastGapSeconds: null, version: env.WORKER_VERSION || 'dev',
  };
  let attempt = 0, downAt = null;

  const beat = setInterval(async () => {
    const hb = heartbeatRow(state, Date.now());
    state.sinceLastBeat = 0; state.rowsSinceLastBeat = 0; state.unreadableSinceLastBeat = 0;
    await writeHeartbeat(env, hb, log);
  }, HEARTBEAT_EVERY_MS);
  beat.unref?.();

  for (;;) {
    try {
      const conn = await connect(url);
      const ch = await conn.createChannel();
      const q = env.KIBL_AMQP_QUEUE || 'kibl';
      await ch.checkQueue(q);
      if (downAt != null) {
        // (a) REST SNAPSHOT ON RECONNECT, and the gap logged either way.
        const gap = gapRecord(downAt, Date.now());
        state.lastGapSeconds = gap.duration_seconds;
        state.reconnects += 1;
        log(`::warning::stream gap ${JSON.stringify(gap)} — taking a REST snapshot`);
        await snapshotViaRest(env, log);
        downAt = null;
      }
      state.connected = true; attempt = 0;
      log(`connected; consuming ${q}`);
      await ch.consume(q, async msg => {
        if (!msg) return;
        const stats = {};
        const rows = rowsFromMessage(msg.content.toString('utf8'),
                                     new Date().toISOString(), stats);
        state.sinceLastBeat += 1;
        state.lastMessageAt = Date.now();
        state.unreadableSinceLastBeat += stats.unreadable || 0;
        if (rows.length) {
          const wrote = await insertRows(env, rows, log);
          state.rowsSinceLastBeat += wrote;
        }
        ch.ack(msg);
      });
      await new Promise((_res, rej) => { conn.on('close', rej); conn.on('error', rej); });
    } catch (e) {
      state.connected = false;
      if (downAt == null) downAt = Date.now();
      const wait = backoffFor(attempt++);
      log(`::warning::broker connection lost (${String(e).slice(0, 200)}); retrying in ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

async function sb(env, path, init) {
  const r = await fetch(`${env.SUPABASE_URL}${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  return r;
}

async function insertRows(env, rows, log) {
  // ignore-duplicates on row_key: the SAME conflict target the sweep uses, so a
  // row seen by both writers is stored once and first-sighting-wins holds
  // across them. See py_str.mjs for why that is load-bearing.
  const r = await sb(env, `/rest/v1/${TABLE_OBS}?on_conflict=row_key`, {
    method: 'POST',
    body: JSON.stringify(rows),
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
  });
  if (!r.ok) { log(`::warning::stream insert failed: ${r.status} ${(await r.text()).slice(0, 300)}`); return 0; }
  return rows.length;
}

async function writeHeartbeat(env, hb, log) {
  if (!env.SUPABASE_URL) return;
  const r = await sb(env, `/rest/v1/${TABLE_HEARTBEAT}?on_conflict=id`, {
    method: 'POST',
    body: JSON.stringify([hb]),
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  });
  if (!r.ok) log(`::warning::heartbeat write failed: ${r.status}`);
}

async function snapshotViaRest(env, log) {
  // Deliberately calls the SAME REST endpoint the sweep uses rather than a
  // stream-specific one, so a gap is filled with rows identical in shape and
  // key to everything around them. Left as an explicit hook: it dispatches the
  // existing sweep rather than reimplementing it, because a second
  // implementation of the pull is a second thing to keep in step.
  log('snapshot: dispatching the existing sweep (mode=sweep) rather than a second puller');
  if (!env.GH_DISPATCH_TOKEN) { log('::warning::no GH_DISPATCH_TOKEN; gap NOT backfilled'); return; }
  const r = await fetch('https://api.github.com/repos/Michaeldk1996/SAAS/actions/workflows/ten232-kibl-archive.yml/dispatches', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`, Accept: 'application/vnd.github+json' },
    body: JSON.stringify({ ref: 'main', inputs: { mode: 'sweep' } }),
  });
  log(`snapshot dispatch: HTTP ${r.status}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await main());
}
