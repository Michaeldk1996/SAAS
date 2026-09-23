# The Kibl / Bet105 RabbitMQ consumer

**Status: BUILT, TESTED OFFLINE, NOT DEPLOYED.** Founder 2026-09-23 (TEN-253):
*"Do not deploy the always-on worker. Launch waits for Michael's go after he
reads the report."* Nothing here runs anywhere. `python3 kibl-stream/consumer.py`
with no `KIBL_RMQ_*` in the environment prints what it would have done and exits 0.

Ported from Node to **Python** on the founder's ruling of 2026-09-23.

---

## ⚠️ What the port found

The Node worker had a latent defect that the whole `py_str.mjs` apparatus was
built to prevent, one layer above the layer it was guarding.

| | key written |
|---|---|
| the sweep, `archive-kibl.py` | `row_key_of(row)` = `"nk_" + sha1(observation_key(row))` |
| the Node consumer | `observationKey(r)` = the raw `"a\|b\|c\|…"` string |

Those two key spaces **cannot collide** — one is pipe-joined text, the other is
a three-character prefix and forty hex digits. `on_conflict=row_key` with
`resolution=ignore-duplicates` would therefore have deduped **nothing** between
the two writers: every streamed observation would have landed as a brand-new row
beside the swept copy of the same price, *first sighting wins forever* would have
quietly stopped holding, and `rows_new` would have read as a busy market.

`py_str.mjs` spent ~120 lines making JavaScript's `String()` agree with Python's
`str()` byte for byte — and then fed that byte-identical string to a hash the
Node side never applied. **It never ran against the database, so no data was
harmed.** It is gone now, along with the failure class: the Python worker calls
`row_key_of` itself, through `sweep_bridge.py`.

The residual risk is smaller and is **characterised rather than assumed away**:
Python keys an integer lexeme `2` and a float lexeme `2.0` differently, because
`str(2) != str(2.0)`. If Kibl's REST serialiser and its AMQP serialiser disagree
on that, the two writers still disagree — a **vendor-shape** question, not a
language one. Part B measures it by comparing captured stream messages against
captured REST rows. Pinned by a test so nobody "fixes" it silently.

---

## The design

```
  Kibl RabbitMQ  ──▶  consumer.py  ──▶  kibl_line_observations   (same table,
        │                  │                                       same row_key,
        │                  ├──▶  kibl_stream_heartbeat  (60s)       same conflict
        │                  │                                        target)
        └── disconnect ────┴──▶  gap log + dispatch the EXISTING sweep

  archive-kibl.py sweep  ──▶  same tables       ← keeps running, unchanged
```

### (a) Reconnect, backoff, snapshot, gap

Jittered ladder `1s → 2s → 5s → 10s → 30s → 60s`, hard-capped. Jittered because
a deterministic ladder synchronises reconnect storms across every consumer on
the broker after a restart, and this is a favour-basis feed.

Every reconnect records the gap — **start, end, duration** — and dispatches the
**existing sweep** rather than implementing a second puller, because a second
implementation of the pull is a second thing to keep in step with the first.
The gap is logged whether or not the snapshot finds anything: *"we were blind
for four minutes"* is the finding; *"we found three rows"* is not.

### (b) Same tables, same writer functions

Rows go through the sweep's own `to_summary()` and `row_key_of()` — imported,
not matched. `sweep_bridge.py` loads `archive-kibl.py` by path (a hyphenated
filename is not importable by name) and re-exports them. The sweep is not
modified at all; a test asserts it has no module-level side effects, so loading
it cannot start it.

### (c) Liveness — the failure the founder named

> *"A connected worker receiving nothing looks exactly like a quiet market, and
> that is the failure that gets missed."*

A heartbeat row every 60 s, counts **since the last beat** rather than
cumulative — a cumulative counter keeps climbing for as long as the process has
*ever* worked, so it cannot answer "is the channel delivering right now".

Three states, and the third is the one that matters:

1. **No heartbeat** > 180 s → the worker is not running.
2. **Beating but not connected** → obvious, and reported.
3. **Connected, beating, delivering nothing** → raised **only when a fixture is
   inside the dense band**, i.e. exactly when silence is not a plausible market
   state. A worker that has *never* received a message hits the same branch —
   the first deploy of a mis-bound queue looks exactly like a quiet Sunday.

⚠️ **THERE IS STILL NOWHERE FOR THAT ALERT TO GO.** Founder 2026-09-23: *"Alert
channel (Telegram): not now."* The on-page "live feed paused" state is the only
failure signal. What that does and does not catch is in the launch-readiness
report on the issue — it is a decision, not a task, and it is not built here.

### (d) The sweep keeps running

The stream supplements the poller; it does not replace it. There is deliberately
**no code path here that can disable, unschedule or throttle the sweep** — a
stream that can stand the poller down turns one outage into two. Asserted by a
test that strips comments first, because the file's own sentence promising not
to disable the sweep contains the word *disable*.

### Acks and the 20,000 cap

**Manual ack, and every message is acked — tennis or not.** Tennis is filtered on
our side *after* the ack. An unacked message still counts against Kibl's
20,000-message backlog cap, so "only ack what we keep" is exactly how a pre-match
tennis feed gets dropped by a basketball flood we declined to acknowledge.

### Credentials

Six secrets, read individually, passed as **six separate `pika` parameters**.
**No AMQP URL is built anywhere** — the password contains `%` and `!`, and `%`
is the percent-encoding introducer, so a URL-shaped credential is mangled by the
parser and surfaces as an authentication error that looks like a wrong password.
`redact()` scrubs the password, username and vhost from every line this module
can emit, **including exception text**, longest secret first.

---

## Files

| file | what it is |
|---|---|
| `consumer.py` | the worker. Pure functions on top, thin runtime below |
| `sweep_bridge.py` | loads the sweep by path and re-exports its row-key functions. **Read its header before touching it** |
| `access-test.py` | TEN-253 part B — the live test against the real queue. Read-only; writes nothing to Supabase |
| `test-consumer.py` | offline suite. No broker, no database, no network |
| `test-access-test.py` | drives the part-B analysis against synthetic captures, so a crash surfaces here and not at minute 91 |
| `gen-key-corpus.py` | generates `key-corpus.json` from the REAL Python key function |
| `schema.sql` | the heartbeat table. **Not applied** |
| `Dockerfile`, `fly.toml` | deployment config. **Not deployed**, and `primary_region` is **still blank** — see below |

Both test files are named `test-*.py` with a **hyphen**, because
`tools/test-every-suite-is-wired.js` matches `^test-.*\.(mjs|js|py)$` — an
underscore would make them invisible to the guard, which is the same
directory-shaped hole that guard exists to close.

## ⚠️ `primary_region` is still blank

The TEN-253 brief reads *"Supabase region: **[REGION]**"* — the literal
placeholder. The substitution never happened, so the ruling arrived without its
value, and a missing value is reported as missing rather than guessed. The
access-test workflow resolves the Supabase host and writes the region it
actually lands in to `ten253-access-test/supabase-region.json`, so this gets
filled from evidence and then confirmed.

Nothing in `fly.toml` has been through `fly deploy` or even `fly config
validate` — there is no Fly CLI in this environment. Treat it as a reviewed
draft; validating it is step 1 of launch.

## Cost

The design and cost table from TEN-225 stand (Fly.io `shared-cpu-1x` 256 MB,
≈ **$2.02/mo** plus egress; ≈ $3/mo cheaper than Railway's plan floor for one
small always-on process). **Egress was explicitly not estimated** there, because
it scales with message volume and nobody had measured any. Part B measures it —
the updated figure goes in the launch-readiness report, not here.
