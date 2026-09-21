# TEN-225 item 2 — the Kibl / Bet105 RabbitMQ consumer

**Status: BUILT AND NOT DEPLOYED.** Founder 2026-09-21: *"build it ready, so the
day Bet105 enables it we only add credentials"* and *"Report the design and the
monthly cost before deploying the worker."* Nothing here runs anywhere. `npm
start` with no `KIBL_AMQP_URL` prints what it would do and exits 0.

---

## What it buys, honestly bounded

Kibl serves no history. A price the book posts and replaces between two of our
sweeps is gone permanently. The sweep's floor is now ~90 seconds in the dense
band (item 1); the stream's floor is the message.

The measured size of the gap is a **lower bound**: on 91 bet105 sides carrying
both an open and a close, the price differs on **89 (97.8%)**. That counts *one*
difference across the whole life of a market. Every intermediate price — exactly
what a stream delivers and a poller cannot — is by definition not in that figure.
The true number is **unknown**, and the distance between 97.8% and it is what
this is for.

---

## Monthly cost — quoted from the vendors' current pricing pages, 2026-09-21

| | Fly.io | Railway |
|---|---|---|
| smallest always-on | `shared-cpu-1x` 256 MB — **$2.02/mo** (Amsterdam; region-dependent) | Hobby plan **$5/mo**, includes $5 of usage |
| the worker's usage | — | 0.25 GB RAM × $10/GB-mo + ~0.05 vCPU × $20/vCPU-mo ≈ **$3.50/mo**, inside the $5 credit |
| egress | $0.02/GB NA-EU to public internet | included in usage |
| **effective monthly** | **≈ $2.02 + egress** | **$5.00** (the plan floor, not the usage) |

**Recommendation: Fly.io.** Railway's usage for a worker this size fits inside
its credit, but you still pay the $5 plan floor, so Fly is about **$3/month
cheaper** for one small always-on process and bills the machine directly with no
plan minimum. Region pinning is also explicit on Fly, which matters for (b)
below.

**Egress is not estimated and I am not going to invent it.** It scales with
message volume, which nobody has measured because the stream has never been
enabled for us. At Kibl's REST volumes it would be cents; the honest figure is
**unknown until the first day of real traffic**, and the worker's heartbeat
records rows written per beat so it becomes measurable immediately.

**Total, all in: ≈ $2–3/month.** Supabase is already on Pro and the marginal
storage is one singleton row plus observations we would otherwise have swept.

⚠️ **One region is UNKNOWN from here.** `SUPABASE_URL` is a GitHub Actions
secret and is not readable from a local run, so I cannot state which region the
Supabase project sits in — that is one look at the dashboard, and the Fly region
should be set to match it. Kibl's broker region is unknown too, and is a question
for Bet105 (below).

---

## The design

```
  Bet105 RabbitMQ  ──▶  consumer.mjs  ──▶  kibl_line_observations   (same table,
        │                    │                                        same row_key,
        │                    ├──▶  kibl_stream_heartbeat  (every 60s)  same conflict
        │                    │                                        target)
        └── disconnect ──────┴──▶  REST snapshot + gap log
                                   (dispatches the EXISTING sweep)

  archive-kibl.py sweep  ──▶  same tables          ← keeps running, unchanged
```

### (a) Reconnect, backoff, snapshot, gap

Jittered ladder `1s → 2s → 5s → 10s → 30s → 60s`, capped. Jittered because a
deterministic ladder synchronises reconnect storms after a broker restart, and
this is a favour-basis feed.

On every reconnect the worker records the gap — **start, end, duration** — and
takes a REST snapshot. The snapshot **dispatches the existing sweep** rather than
implementing a second puller, because a second implementation of the pull is a
second thing to keep in step with the first.

The gap is logged **whether or not the snapshot finds anything**. "We were blind
for four minutes" is the finding; "we found three rows" is not.

### (b) Same tables, new writer — and the one thing that can break it silently

The worker writes `kibl_line_observations` on the **same `row_key`** and the same
`on_conflict=row_key` / `resolution=ignore-duplicates` the sweep uses, so an
observation seen by both writers is stored once and *first sighting wins forever*
holds across them.

That depends entirely on the two writers computing the key **byte for byte** the
same, and `kibl_client.observation_key()` is

```python
"|".join(str(row.get(f)) for f in (... 18 fields ...))
```

**Python's `str()` and JavaScript's `String()` disagree on exactly the types that
dominate this row:**

| value | Python `str()` | JS `String()` |
|---|---|---|
| `None` | `"None"` | `"null"` |
| `True` / `False` | `"True"` / `"False"` | `"true"` / `"false"` |
| `2.0` | `"2.0"` | `"2"` |

A naive port produces a different key on essentially every row. **The failure is
not an error**: every streamed observation looks new, the archive stores a second
copy of rows it already holds, first-sighting-wins quietly stops holding, and
`rows_new` reads as a busy market. It is the most convincing possible disguise
for the thing going wrong.

`py_str.mjs` is the compatibility layer, and the integral-float case
(`2.0` vs `2`) **cannot be fixed after a parse** — once `JSON.parse` has run they
are the same double. So the key is built from the **source lexeme**, captured
during the parse via `JSON.parse` source-text access (Node ≥ 21). If the runtime
lacks it the worker **refuses to start** rather than degrading, because a silent
fallback is the archive-doubling failure above.

`test-consumer.mjs` drives this against a corpus generated by the **real Python
function** (`gen-key-corpus.py`), not against a fixture written by hand and then
matched. It carries a control: a naive `String()` key must disagree on the
corpus, or the corpus is not exercising the cases it exists for. Currently 9/9
byte-identical, 9/9 naive disagreements.

⚠️ **A Python worker would remove this entire failure class.** It would import
the same function the sweep uses. Node was the stated choice, this is buildable
and tested, and the trade is stated here rather than buried. **Say the word and
it is a straight port.**

### (c) Liveness — the failure the founder named

> *"A connected worker receiving nothing looks exactly like a quiet market, and
> that is the failure that gets missed."*

A heartbeat row every 60 s, and the counts are **since the last beat**, not
cumulative — a cumulative counter keeps climbing for as long as the process has
*ever* worked, so it cannot answer "is the channel delivering right now".

Three alert states, and the third is the one that matters:

1. **No heartbeat** for > 180 s → the worker is not running.
2. **Beating but not connected** → obvious, and reported.
3. **Connected, beating, delivering nothing** → raised **only when a fixture is
   inside the dense band**, i.e. exactly when silence is not a plausible market
   state. Without that qualifier the alert either cries wolf every night or says
   nothing ever. A worker that has *never* received a message is caught by the
   same branch — the first deploy of a mis-bound queue looks exactly like a quiet
   Sunday.

⚠️ **THE ALERT HAS NOWHERE TO GO, AND THAT IS NOT A DETAIL.** The natural home is
a step in the 5-minute sweep workflow raising `::error::`. But an `::error::`
annotation on a job that still concludes *success* reaches a **log, not a
person** — that is precisely why the Kibl entitlement watch fired correctly on
2026-09-19T14:07Z and the founder still had to ask me 33 hours later whether
Bet105 had appeared. Telegram is configured but its secrets are unset and he said
to skip it. **Deploying this worker without choosing a notification channel would
rebuild the same silent watch.** That is a decision, not a task.

### (d) The sweep keeps running

The stream supplements the poller; it does not replace it. There is deliberately
**no code path here that can disable, unschedule or throttle the sweep** — a
stream that can stand the poller down turns one outage into two. Asserted by a
test (which had to strip comments before scanning, because the file's own
sentence promising not to disable the sweep contains the word "disable").

---

## What I need from Bet105's answer

Ordered by how much each one changes the design. The first two are the ones that
decide whether this works at all.

1. **Is the queue DURABLE, and are messages PERSISTENT?**
   A non-durable queue silently discards everything posted while we are
   disconnected — which is the exact loss the stream exists to remove. If it is
   non-durable, every reconnect is a permanent hole and the REST snapshot is not
   a backstop but the only recovery. **This is the single most important
   question.**

2. **Does the push carry PRE-MATCH as well as LIVE?**
   The docs describe it as covering the `/info/*` family. Whether it can be
   scoped to one and not the other is unknown. Our entire product is pre-match;
   a live-only stream is interesting but does not serve Open/Now/Close.

3. **Exact connection parameters** — host, port, vhost, username, TLS or not,
   exchange name and type, routing key(s) or binding pattern, and whether the
   queue is pre-created for us or we declare it.

4. **Is stream entitlement the same Cognito attribute set as REST?**
   It matters because of how this vendor fails: a restricted attribute returns
   **HTTP 200 with rows silently missing**. A stream will behave the same way —
   a quiet queue and a healthy connection are indistinguishable. Please enable
   **`betting_type_id` 1 AND 3** explicitly.

5. **Which region is the broker in?** Decides where to put the worker, and it is
   the one number in the cost table that could move.

6. **Expected message rate and shape** — messages/second at peak, and one real
   sample message. The consumer accepts a bare row, a bare array and the REST
   `{code, description, result:[...]}` envelope, and **counts** anything else as
   unreadable rather than guessing. One sample turns that from tolerance into
   certainty.

7. **Is there a rate or connection limit, and does the broker send
   `Retry-After`-equivalent backpressure?** The REST client now honours
   `Retry-After` (item 1); the AMQP side has prefetch instead, and the right
   value depends on their answer to 6.

8. **Retention / replay** — can a reconnecting consumer ask for anything it
   missed, or is the queue strictly live-from-now? This is question 1 from the
   other direction and determines whether gaps are recoverable at all.

---

## Files

| file | what it is |
|---|---|
| `consumer.mjs` | the worker. Pure functions on top, thin runtime below |
| `py_str.mjs` | the row-key compatibility layer. Read the header before touching it |
| `gen-key-corpus.py` | generates `key-corpus.json` from the REAL Python key function |
| `test-consumer.mjs` | offline tests — no broker, no database, no network |
| `schema.sql` | the heartbeat table. **Not applied** |
| `Dockerfile`, `fly.toml` | deployment config. **Not deployed** |
