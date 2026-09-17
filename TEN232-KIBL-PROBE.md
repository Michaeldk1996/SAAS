# TEN-232 — Kibl / Bet105 first tests (a–d)

- commit `8db73c7`
- run started `2026-09-17T23:13:15Z` UTC
- API calls `69`, bytes down `3,779,329`, min interval `1.25s` (conservative — Kibl documents no rate limit)

Report only. Nothing archived, nothing published, no site surface touched.

## a. What this account is actually entitled to

**Cognito custom attributes on our token:** none — entitlement is not expressed in the token

**Bet105 feed_source_id:** `-` (candidates matched: 0)
**Tennis sport_id:** `5`

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
| 1 (Prematch) | 200 | 0 |
| 2 (Live Stop-N-Go) | 200 | 0 |
| 3 (Live Fluid) | 200 | 0 |

### is_main — do we receive alternates?

| is_main | HTTP | rows | distinct alt_id |
|---|---|---|---|
| omitted | 200 | 0 | [] |
| true | 200 | 0 | [] |
| false | 200 | 0 | [] |

### Books actually received (n=0 market rows, all men's leagues)

no market rows returned

### Restrictions found

- no markets returned for ANY betting_type_id

## b. Does the time window reach BACKWARDS to finished fixtures?

**Furthest back with Bet105 market rows:** `-`  
**Furthest back with fixtures (no prices):** `365 days`

| days back | fixtures | market rows | opener | previous | current | fixtures priced | distinct inserted_on |
|---|---|---|---|---|---|---|---|
| 1 | 134 | 0 | - | - | - | 0 | 0 |
| 2 | 116 | 0 | - | - | - | 0 | 0 |
| 3 | 62 | 0 | - | - | - | 0 | 0 |
| 5 | 50 | 0 | - | - | - | 0 | 0 |
| 7 | 148 | 0 | - | - | - | 0 | 0 |
| 14 | 175 | 0 | - | - | - | 0 | 0 |
| 30 | 161 | 0 | - | - | - | 0 | 0 |
| 60 | 94 | 0 | - | - | - | 0 | 0 |
| 90 | 81 | 0 | - | - | - | 0 | 0 |
| 180 | 31 | 0 | - | - | - | 0 | 0 |
| 365 | 49 | 0 | - | - | - | 0 | 0 |

`distinct inserted_on` is the series-depth test: three states per line means at most three distinct stamps per line. A number far above 3× the line count would be the only evidence a real tick series exists.

## c. Bet105-specific pre-match coverage (men's leagues)

Window `2026-09-17T23:13:15Z → 2026-09-20T23:13:15Z`, betting_type_id=1 (Prematch), feed_source_id = Bet105 only.

| league | fixtures (n) | priced | % priced | market rows | lines/fixture mean | max | both sides % |
|---|---|---|---|---|---|---|---|
| ATP (19) | 3 | 0 | 0.0% | 0 | - | 0 | - |
| Challenger (537) | 24 | 0 | 0.0% | 0 | - | 0 | - |
| ITF Men (962) | 38 | 0 | 0.0% | 0 | - | 0 | - |

### Market presence — fixtures carrying each market_type/segment

**ATP**

- no market rows returned for this league in the window

**Challenger**

- no market rows returned for this league in the window

**ITF Men**

- no market rows returned for this league in the window

Set handicap is Spread on the Sets segment; total sets is Total on Sets. Raw `market_type_id/segment_id` keys are in the JSON.

## d. Is the `is_current` default trap handled?

| call | HTTP | rows | states returned |
|---|---|---|---|
| `default_no_flag` | 200 | 0 | `{}` |
| `is_current_true` | 200 | 0 | `{}` |
| `is_current_false` | 200 | 0 | `{}` |
| `is_opener_true` | 200 | 0 | `{}` |
| **two-call merge** | ok | 0 | `{}` |

**Trap confirmed:** `False` — rows the default call would have lost: `0`.

The archive uses `markets_three_state()`, which is the two-call merge, and never a bare `/info/markets` pull.

## Errors

- Bet105 feed_source_id could not be resolved from /reference/sportsbooks; tests b/c/d ran WITHOUT a feed-source filter and therefore measure every book we receive, not Bet105 specifically.
- 41 call(s) returned 200 with an envelope this parser does not recognise — every zero below them is unmeasured, not empty.

## Rate-limit evidence

Headers observed across all 69 calls: **none** — no quota header, no 429, no Retry-After.
