# TEN-232 — Kibl / Bet105 first tests (a–d)

- commit `18bfa23`
- run started `2026-09-17T23:25:30Z` UTC
- API calls `70`, bytes down `6,904,670`, min interval `1.25s` (conservative — Kibl documents no rate limit)

Report only. Nothing archived, nothing published, no site surface touched.

## a. What this account is actually entitled to

**Cognito custom attributes on our token:** none — entitlement is not expressed in the token

### Which book are we actually receiving?

`/reference/sportsbooks` returns **1** book(s) — that list IS the entitlement, and it is the only book any market call can ask for:

| feed_source_id | name | tag | feed_type_id | metadata |
|---|---|---|---|---|
| 43 | Sports411 | sports411 | 2 | `{"tier": "primary", "offered": true}` |

**No book named Bet105 is visible to this account.** Every figure in this report is therefore a measurement of the book above, not of Bet105 — unless that book IS Bet105's pricing feed under another name, which only Bet105 can confirm. Flagged, not assumed.

**feed_source_id sent on every market call:** `43`  
**Tennis sport_id:** `5`

> **Undocumented hard requirement, measured 2026-09-17.** `/info/markets` *requires* `feed_source_id`. Without it the API returns **HTTP 200** with `"description": "minimum of 1 feed_source_id needed"`, no `result` key and no error status — for every league, every sport and every time window. The swagger marks the parameter `required: false`. This is a fail-open: it reads exactly like an account with no odds entitlement. The client now refuses to issue a market call without it.

### Tennis leagues actually receiving prices (`/info/markets-last-updated`, n=4)

| league_id | betting_type_id | book | last update | minutes ago |
|---|---|---|---|---|
| 19 | 1 | sports411 | 2026-09-17T23:11:27.139Z | 15 |
| 20 | 1 | sports411 | 2026-09-17T23:25:05.741Z | 1 |
| 537 | 1 | sports411 | 2026-09-17T23:18:41.160Z | 8 |
| 643 | 1 | sports411 | 2026-09-17T23:12:22.394Z | 14 |

A men's league absent from this table is a league nobody is pricing to us — not a quiet day.

### Reference tables visible to us

| table | HTTP | n |
|---|---|---|
| sports | 200 | 22 |
| sportsbooks | 200 | 1 |
| leagues | 200 | 359 |
| betting_types | 200 | 4 |
| market_types | 200 | 127 |
| segments | 200 | 68 |
| fixture_types | 200 | 8 |
| feed_types | 200 | 6 |

### Leagues — empirical (fixtures in a −3d/+7d window)

| league_id | league | HTTP | fixtures | in archive scope |
|---|---|---|---|---|
| 19 | ATP | 200 | 3 | yes |
| 537 | Challenger | 200 | 149 | yes |
| 962 | ITF Men | 200 | 272 | yes |
| 20 | WTA | 200 | 75 | NO (reported, not archived) |
| 643 | WTA 125K | 200 | 93 | NO (reported, not archived) |
| 963 | ITF Women | 200 | 217 | NO (reported, not archived) |

### betting_type_id — which ids actually carry tennis rows

| betting_type_id | HTTP | market rows |
|---|---|---|
| 1 (Prematch) | 200 | 180 |
| 2 (Live Stop-N-Go) | 200 | 0 |
| 3 (Live Fluid) | 200 | 0 |

### is_main — do we receive alternates?

| is_main | HTTP | rows | distinct alt_id |
|---|---|---|---|
| omitted | 200 | 108 | [0] |
| true | 200 | 108 | [0] |
| false | 200 | 108 | [0] |

### Books actually received (n=108 market rows, all men's leagues)

| feed_source_id | book | rows |
|---|---|---|
| 43 | Sports411 | 108 |

## b. Does the time window reach BACKWARDS to finished fixtures?

**Furthest back with market rows:** `30 days`  
**Furthest back with fixtures (no prices):** `365 days`

| days back | fixtures | market rows | opener | previous | current | fixtures priced | distinct inserted_on |
|---|---|---|---|---|---|---|---|
| 1 | 133 | 132 | - | - | 132 | 22 | 132 |
| 2 | 117 | 342 | - | - | 342 | 59 | 342 |
| 3 | 62 | 270 | - | - | 270 | 57 | 270 |
| 5 | 50 | 96 | - | - | 96 | 16 | 96 |
| 7 | 147 | 170 | - | - | 170 | 29 | 168 |
| 14 | 175 | 258 | - | - | 258 | 43 | 258 |
| 30 | 161 | 356 | - | - | 356 | 64 | 356 |
| 60 | 95 | 0 | - | - | - | 0 | 0 |
| 90 | 81 | 0 | - | - | - | 0 | 0 |
| 180 | 30 | 0 | - | - | - | 0 | 0 |
| 365 | 49 | 0 | - | - | - | 0 | 0 |

`distinct inserted_on` is the series-depth test: three states per line means at most three distinct stamps per line. A number far above 3× the line count would be the only evidence a real tick series exists.

## c. Pre-match coverage for our entitled book (men's leagues)

Window `2026-09-17T23:25:30Z → 2026-09-20T23:25:30Z`, betting_type_id=1 (Prematch), feed_source_id = `43` — see section a for which book that is.

| league | fixtures (n) | priced | % priced | market rows | lines/fixture mean | max | both sides % |
|---|---|---|---|---|---|---|---|
| ATP (19) | 3 | 2 | 66.7% | 4 | 1.0 | 1 | 100.0% |
| Challenger (537) | 23 | 18 | 78.3% | 104 | 3.8 | 4 | 50.7% |
| ITF Men (962) | 37 | 0 | 0.0% | 0 | - | 0 | - |

### Market presence — fixtures carrying each market_type/segment

**ATP**

| market | segment | fixtures carrying it |
|---|---|---|
| Moneyline | Full Game | 2 |

**Challenger**

| market | segment | fixtures carrying it |
|---|---|---|
| Moneyline | Full Game | 18 |
| Spread | Full Game | 17 |
| Total | Full Game | 17 |

**ITF Men**

- no market rows returned for this league in the window

Set handicap is Spread on the Sets segment; total sets is Total on Sets. Raw `market_type_id/segment_id` keys are in the JSON.

## d. Is the `is_current` default trap handled?

| call | HTTP | rows | states returned |
|---|---|---|---|
| `default_no_flag` | 200 | 108 | `{"current": 78, "opener": 30}` |
| `is_current_true` | 200 | 108 | `{"current": 78, "opener": 30}` |
| `is_current_false` | 200 | 108 | `{"current": 78, "opener": 30}` |
| `is_opener_true` | 200 | 108 | `{"opener": 108}` |
| **two-call merge** | ok | 108 | `{"current": 78, "opener": 30}` |

**Trap confirmed:** `False` — rows the default call would have lost: `0`.

The archive uses `markets_three_state()`, which is the two-call merge, and never a bare `/info/markets` pull.

## Rate-limit evidence

Headers observed across all 70 calls: **none** — no quota header, no 429, no Retry-After.
