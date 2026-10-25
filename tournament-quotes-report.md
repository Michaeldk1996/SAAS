# Tournament quote import — report

## Shipped quotes: 175 (last build: 161)

Generated `2026-10-24T01:02:10.048Z` by `tools/quotes/build-tournament-quotes.mjs`.

## Headline

| | |
|---|---:|
| Rows read (excl. header) | 509 |
| Candidate records (player or text present) | 450 |
| **Imported** | **409** |
| Events with at least one quote | 45 |
| Events in our catalog with NO quote (no card) | 28 |
| Dated / undated | 187 / 237 |
| Years present in the sheet | 2020, 2021, 2022, 2023, 2024, 2025, 2026 |

## Not imported, and why

| reason | rows |
|---|---:|
| No player cell (rule d) | 8 |
| **Player cell is a bare YEAR — never a person** | **1** |
| Group name not in the map — FAILS LOUDLY (rule e) | 0 |
| Group known but deliberately not importable | 8 |
| Text prefix unresolved | 3 |
| **Prefix/group conflict (rule c)** | **6** |

### Unmapped group names — these FAIL LOUDLY
_none_

### Known groups deliberately held out
| group name | rows | source lines |
|---|---:|---|
| `LIBEMA OPEN               2025` | 4 | 409, 410, 411, 412 |
| `MILLENNIUM ESTORIL OPEN2026` | 4 | 475, 476, 477, 478 |

- `LIBEMA OPEN               2025` — The name cell has a YEAR glued onto it, so it is not a clean group name and not a clean year cell either. The event is 's-Hertogenbosch, which we carry as `Hertogenbosch`. Left unmapped deliberately: mapping the malformed literal would hide a sheet defect that will recur.
- `MILLENNIUM ESTORIL OPEN2026` — Same defect as LIBEMA, with no separating space. The event is `Estoril`, which we do carry.

### Unresolved text prefixes
| prefix | rows | source lines |
|---|---:|---|
| `BRUSSELS` | 1 | 61 |
| `AUCKLAND M` | 1 | 107 |
| `MIAMI M` | 1 | 262 |

- `BRUSSELS` — NOT a parse artefact and NOT a filing error. The BNP Paribas Fortis European Open moved from Antwerp to Brussels; our catalog still carries only `Antwerp`, and has no Brussels row. So the group resolves to Antwerp and the text names a city we do not model. Founder decision: is our `Antwerp` the same event, in which case these rows are fine, or does the venue move need a catalog change?
- `AUCKLAND M` — A defect in the source text: the marker reads `AUCKLAND M:`. The intent is plainly Auckland, but stripping the stray ` M` would be me editing the source. Held out and reported instead.
- `MIAMI M` — Same defect, reading `MIAMI M:`. Note this row's player cell says `Khachanov` while its text says `said Karatsev` — a separate attribution defect flagged in the report.

### Prefix/group conflicts — for you to resolve, not me

| row | filed under | text says | player | opening text |
|---:|---|---|---|---|
| 5 | Chengdu (`CHENGDU`) | **Shanghai** | Balls | SHANGHAI: Yonex has been selected as the official ball supplier for the ATP Tour Rolex Shanghai Masters 1000, … |
| 460 | Bastad (`NORDEA OPEN`) | **Umag** | Van Asche | UMAG: “At the beginning, the court was very fast," said Van Assche. "I was just trying to hit the ball but he … |
| 461 | Bastad (`NORDEA OPEN`) | **Umag** | Dzumhur | UMAG: "I love the [court] changes," said Dzumhur. "There are two extra metres on each side and it definitely h… |
| 462 | Bastad (`NORDEA OPEN`) | **Umag** | De Jong | UMAG: "The courts are so terrible this year, it's almost dangerous," said De Jong: "It's quite shocking. We al… |
| 464 | Bastad (`NORDEA OPEN`) | **Umag** | Gasquet | UMAG: "It's always tough to play with this heat and humidity, it's a battle for everybody," said Gasquet.… |
| 465 | Bastad (`NORDEA OPEN`) | **Umag** | Alcaraz | UMAG: "It's not easy to play here, because the humidity is so high," said Alcaraz.… |

## Speakers (one rule: that tournament-season's entrants — tools/quotes/quote-speaker.cjs)

- Dated rows resolved to exactly one entrant: **182** (1 of them with no ID chain: monogram)
- Dated rows NOT resolved (zero or several entrants, or no entrant list): **5** — they do not ship
- Undated rows (never resolved, never shipped): **237**
- Roster used only to name a resolved ID (492 players)

### Dated speakers that did not resolve

| row | event | year | cell | why | candidates |
|---:|---|---:|---|---|---|
| 371 | Rome | 2026 | `Thiem` | unmatched |  |
| 395 | Roland Garros | 2026 | `Tommy paul` | unmatched |  |
| 447 | Wimbledon | 2023 | `Barrerre` | unmatched |  |
| 456 | Bastad | 2024 | `Beana` | unmatched |  |
| 493 | Washington | 2022 | `Drapper` | unmatched |  |

## Text alterations

Only two alterations are ever made, and every one is listed. The WORDS are never touched.

| row | what changed |
|---:|---|
| 40 | unwrapped outer “” |
| 45 | unwrapped outer "" |
| 47 | unwrapped outer "" |
| 48 | unwrapped outer "" |
| 49 | unwrapped outer “” |
| 55 | unwrapped outer "" |
| 58 | unwrapped outer “” |
| 59 | unwrapped outer "" |
| 117 | unwrapped outer "" |
| 125 | unwrapped outer "" |
| 201 | unwrapped outer “” |
| 208 | unwrapped outer "" |
| 213 | unwrapped outer “” |
| 245 | unwrapped outer "" |
| 304 | unwrapped outer "" |
| 331 | unwrapped outer "" |
| 335 | unwrapped outer “” |
| 336 | unwrapped outer "" |
| 353 | unwrapped outer "" |
| 359 | unwrapped outer "" |
| 370 | unwrapped outer "" |
| 373 | unwrapped outer "" |
| 375 | unwrapped outer “” |

**377 of 409** imported values already contain their own quotation marks — they are narration around reported speech, not clean quotations. Flagged per record as `selfQuoted`. See the report's presentation note.

## Quotes per event

| event | quotes | dated | undated |
|---|---:|---:|---:|
| Indian Wells | 31 | 0 | 31 |
| Rome | 29 | 28 | 1 |
| Madrid | 28 | 27 | 1 |
| Australian Open | 24 | 0 | 24 |
| Miami | 23 | 0 | 23 |
| Dubai | 19 | 0 | 19 |
| Munich | 19 | 19 | 0 |
| Wimbledon | 19 | 18 | 1 |
| Shanghai | 15 | 0 | 15 |
| Roland Garros | 14 | 13 | 1 |
| Washington | 14 | 13 | 1 |
| Los Cabos | 13 | 12 | 1 |
| Mallorca | 10 | 9 | 1 |
| Tokyo | 10 | 0 | 10 |
| Beijing | 9 | 0 | 9 |
| Rotterdam | 9 | 0 | 9 |
| Santiago | 9 | 0 | 9 |
| Houston | 8 | 7 | 1 |
| Monte Carlo | 8 | 8 | 0 |
| Kitzbuhel | 7 | 6 | 1 |
| Adelaide | 6 | 0 | 6 |
| Almaty | 6 | 0 | 6 |
| Basel | 6 | 0 | 6 |
| Bastad | 6 | 5 | 1 |
| Delray Beach | 6 | 0 | 6 |
| Rio de Janeiro | 6 | 0 | 6 |
| Barcelona | 5 | 4 | 1 |
| Hamburg | 5 | 4 | 1 |
| Acapulco | 4 | 0 | 4 |
| Brisbane | 4 | 0 | 4 |
| Chengdu | 4 | 0 | 4 |
| Geneva | 4 | 3 | 1 |
| Marrakech | 4 | 3 | 1 |
| Dallas | 3 | 0 | 3 |
| Doha | 3 | 0 | 3 |
| Hong Kong | 3 | 0 | 3 |
| Stockholm | 3 | 0 | 3 |
| Auckland | 2 | 0 | 2 |
| Bucharest | 2 | 0 | 2 |
| Halle | 2 | 1 | 1 |
| Montpellier | 2 | 0 | 2 |
| Vienna | 2 | 0 | 2 |
| Antwerp | 1 | 0 | 1 |
| Eastbourne | 1 | 0 | 1 |
| Hangzhou | 1 | 0 | 1 |

## Events with no quotes — **28** of 73 get NO card

`French Open` · `US Open` · `Montreal` · `Toronto` · `Cincinnati` · `Paris` · `Turin` · `London` · `Sydney` · `Zhuhai` · `Pune` · `Marseille` · `Cordoba` · `Buenos Aires` · `Estoril` · `Lyon` · `Gstaad` · `Newport` · `Umag` · `Winston-Salem` · `Tel Aviv` · `Astana` · `Metz` · `Belgrade` · `Hertogenbosch` · `Stuttgart` · `Ho Chi Minh City` · `Jeddah`
