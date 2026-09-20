# Tournament quote import — report

Generated `2026-09-20T00:20:36.296Z` by `tools/quotes/build-tournament-quotes.mjs`.

## Headline

| | |
|---|---:|
| Rows read (excl. header) | 509 |
| Candidate records (player or text present) | 450 |
| **Imported** | **424** |
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

## People

- Normalised against our roster (428 players): **365**
- Kept the source spelling (unmatched or ambiguous): **59**

### Player cells that did not resolve — check these are people (rule d)

| player cell | rows | source lines |
|---|---:|---|
| `Aliassime` | 6 | 62, 71, 127, 324, 452, 508 |
| `Tommy` | 5 | 18, 19, 49, 139, 250 |
| `Murray` | 4 | 126, 234, 448, 491 |
| `Kygrios` | 3 | 21, 120, 133 |
| `Federer` | 3 | 134, 156, 416 |
| `Thiem` | 3 | 191, 315, 371 |
| `Mpetshi` | 2 | 6, 88 |
| `Colin` | 1 | 15 |
| `J.Melzer` | 1 | 16 |
| `Khachanov coach` | 1 | 56 |
| `Dimitrov/ Rublev` | 1 | 82 |
| `Raducanu` | 1 | 105 |
| `Harri` | 1 | 111 |
| `Parcell` | 1 | 124 |
| `Svrcine` | 1 | 128 |
| `Borna` | 1 | 136 |
| `Sandgren` | 1 | 141 |
| `Busta` | 1 | 151 |
| `Sean` | 1 | 167 |
| `Karlovic` | 1 | 169 |
| `Prizimic` | 1 | 200 |
| `Nadal` | 1 | 238 |
| `Isner` | 1 | 261 |
| `Tommy paul` | 1 | 395 |
| `Paire` | 1 | 405 |
| `Barrerre` | 1 | 447 |
| `Beana` | 1 | 456 |
| `Drapper` | 1 | 493 |
| `Purcell` | 1 | 504 |

### Ambiguous surnames (more than one roster match) — source spelling kept

| row | cell | roster candidates |
|---:|---|---|
| 116 | `Mcdonald` | M. McDonald · N. McDonald |
| 146 | `Tsitsipas` | Pe. Tsitsipas · S. Tsitsipas |
| 187 | `Mcdonald` | M. McDonald · N. McDonald |
| 194 | `Tsitsipas` | Pe. Tsitsipas · S. Tsitsipas |
| 225 | `Tsitsipas` | Pe. Tsitsipas · S. Tsitsipas |
| 229 | `Tsitsipas` | Pe. Tsitsipas · S. Tsitsipas |
| 271 | `Mcdonald` | M. McDonald · N. McDonald |
| 333 | `Tsitsipas` | Pe. Tsitsipas · S. Tsitsipas |
| 347 | `Tsitsipas` | Pe. Tsitsipas · S. Tsitsipas |
| 505 | `Tsitsipas` | Pe. Tsitsipas · S. Tsitsipas |
| 506 | `Tsitsipas` | Pe. Tsitsipas · S. Tsitsipas |

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

**377 of 424** imported values already contain their own quotation marks — they are narration around reported speech, not clean quotations. Flagged per record as `selfQuoted`. See the report's presentation note.

## Quotes per event

| event | quotes | dated | undated |
|---|---:|---:|---:|
| Indian Wells | 31 | 0 | 31 |
| Rome | 31 | 30 | 1 |
| Madrid | 30 | 29 | 1 |
| Australian Open | 26 | 0 | 26 |
| Miami | 23 | 0 | 23 |
| Munich | 20 | 20 | 0 |
| Dubai | 19 | 0 | 19 |
| Wimbledon | 19 | 18 | 1 |
| Shanghai | 17 | 0 | 17 |
| Los Cabos | 14 | 13 | 1 |
| Roland Garros | 14 | 13 | 1 |
| Washington | 14 | 13 | 1 |
| Mallorca | 10 | 9 | 1 |
| Tokyo | 10 | 0 | 10 |
| Beijing | 9 | 0 | 9 |
| Rotterdam | 9 | 0 | 9 |
| Santiago | 9 | 0 | 9 |
| Houston | 8 | 7 | 1 |
| Monte Carlo | 8 | 8 | 0 |
| Kitzbuhel | 7 | 6 | 1 |
| Rio de Janeiro | 7 | 0 | 7 |
| Adelaide | 6 | 0 | 6 |
| Almaty | 6 | 0 | 6 |
| Basel | 6 | 0 | 6 |
| Bastad | 6 | 5 | 1 |
| Brisbane | 6 | 0 | 6 |
| Delray Beach | 6 | 0 | 6 |
| Barcelona | 5 | 4 | 1 |
| Hamburg | 5 | 4 | 1 |
| Acapulco | 4 | 0 | 4 |
| Chengdu | 4 | 0 | 4 |
| Geneva | 4 | 3 | 1 |
| Marrakech | 4 | 3 | 1 |
| Dallas | 3 | 0 | 3 |
| Doha | 3 | 0 | 3 |
| Hong Kong | 3 | 0 | 3 |
| Stockholm | 3 | 0 | 3 |
| Vienna | 3 | 0 | 3 |
| Auckland | 2 | 0 | 2 |
| Bucharest | 2 | 0 | 2 |
| Eastbourne | 2 | 1 | 1 |
| Halle | 2 | 1 | 1 |
| Montpellier | 2 | 0 | 2 |
| Antwerp | 1 | 0 | 1 |
| Hangzhou | 1 | 0 | 1 |

## Events with no quotes — **28** of 73 get NO card

`French Open` · `US Open` · `Montreal` · `Toronto` · `Cincinnati` · `Paris` · `Turin` · `London` · `Sydney` · `Zhuhai` · `Pune` · `Marseille` · `Cordoba` · `Buenos Aires` · `Estoril` · `Lyon` · `Gstaad` · `Newport` · `Umag` · `Winston-Salem` · `Tel Aviv` · `Astana` · `Metz` · `Belgrade` · `Hertogenbosch` · `Stuttgart` · `Ho Chi Minh City` · `Jeddah`
