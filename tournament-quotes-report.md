# Tournament quote import — report

## Shipped quotes: 1206 (last build: 175)

Generated `2026-11-20T06:30:10.822Z` by `tools/quotes/build-tournament-quotes.mjs`.

## Headline

| | |
|---|---:|
| Rows read (excl. header) | 1737 |
| Candidate records (player or text present) | 1400 |
| **Imported** | **1376** |
| Events with at least one quote | 58 |
| Events in our catalog with NO quote (no card) | 17 |
| Dated / undated | 1395 / 3 |
| Years present in the sheet | 2020, 2021, 2022, 2023, 2024, 2025, 2026 |

## Not imported, and why

| reason | rows |
|---|---:|
| No player cell (rule d) | 0 |
| **Player cell is a bare YEAR — never a person** | **0** |
| Group name not in the map — FAILS LOUDLY (rule e) | 0 |
| Group known but deliberately not importable | 2 |
| Text prefix unresolved | 0 |
| **Prefix/group conflict (rule c)** | **0** |

### Unmapped group names — these FAIL LOUDLY
_none_

### Known groups deliberately held out
| group name | rows | source lines |
|---|---:|---|
| `LAVER CUP` | 2 | 38, 39 |

- `LAVER CUP` — A team exhibition. No entry in TOURNAMENT_CATALOG and no court-speed rating, so there is no Overview page for a card to live on.

### Unresolved text prefixes
_none_


### Prefix/group conflicts — for you to resolve, not me

_none_

## Speakers (one rule: that tournament-season's entrants — tools/quotes/quote-speaker.cjs)

- Dated rows resolved to exactly one entrant: **1225** (1 of them with no ID chain: monogram)
- Dated rows NOT resolved (zero or several entrants, or no entrant list): **170** — they do not ship
- Undated rows (never resolved, never shipped): **3**
- Roster used only to name a resolved ID (428 players)

### Dated speakers that did not resolve

| row | event | year | cell | why | candidates |
|---:|---|---:|---|---|---|
| 16 | Chengdu | 2024 | `S. Doumbia (doubles)` | unmatched |  |
| 17 | Chengdu | 2024 | `Kecmanovic` | unmatched |  |
| 19 | Chengdu | 2023 | `Bolt` | unmatched |  |
| 35 | Hangzhou | 2023 | `Shuai Zhang` | no-entrants |  |
| 110 | Shanghai | 2026 | `Yunchaokete Bu` | unmatched |  |
| 173 | Almaty | 2025 | `Khachanov's coach (Donskoy)` | unmatched |  |
| 202 | Marseille | 2025 | `Bautista-Agut` | unmatched |  |
| 203 | Marseille | 2025 | `Ruusuvuori` | unmatched |  |
| 204 | Marseille | 2025 | `Murray` | unmatched |  |
| 207 | Marseille | 2022 | `Heliovaara` | unmatched |  |
| 208 | Marseille | 2022 | `Ruusuvuori` | unmatched |  |
| 210 | Marseille | 2020 | `Simon` | no-entrants |  |
| 269 | Vienna | 2023 | `Herwig Straka (tournament director)` | unmatched |  |
| 288 | Paris | 2026 | `Merida Aguilar` | unmatched |  |
| 310 | Paris | 2025 | `Tournament director` | unmatched |  |
| 311 | Paris | 2025 | `Cedric Pioline (TD)` | unmatched |  |
| 331 | Paris | 2020 | `Herbert` | no-entrants |  |
| 343 | Metz | 2023 | `Analyst` | unmatched |  |
| 345 | Metz | 2022 | `Rodionov` | unmatched |  |
| 374 | Turin | 2025 | `Zverev` | unmatched |  |
| 376 | Turin | 2025 | `Musetti` | unmatched |  |
| 379 | Turin | 2024 | `Alcaraz` | unmatched |  |
| 380 | Turin | 2024 | `Alcaraz` | unmatched |  |
| 382 | Turin | 2024 | `Rublev` | unmatched |  |
| 383 | Turin | 2024 | `Medvedev` | unmatched |  |
| 384 | Turin | 2024 | `Purcell` | unmatched |  |
| 390 | Turin | 2022 | `Medvedev` | unmatched |  |
| 391 | Turin | 2022 | `Medvedev` | unmatched |  |
| 393 | Turin | 2022 | `Kyrgios` | unmatched |  |
| 397 | Turin | 2021 | `Hurkacz` | unmatched |  |
| 413 | Brisbane | 2025 | `Gasquet` | unmatched |  |
| 429 | Adelaide | 2020 | `P. Cuevas` | no-entrants |  |
| 430 | Adelaide | 2020 | `Bublik` | no-entrants |  |
| 431 | Adelaide | 2020 | `Rublev` | no-entrants |  |
| 459 | Auckland | 2025 | `Mektic` | unmatched |  |
| 468 | Auckland | 2020 | `Millman` | no-entrants |  |
| 469 | Auckland | 2020 | `Millman` | no-entrants |  |
| 470 | Auckland | 2020 | `Millman` | no-entrants |  |
| 492 | Australian Open | 2026 | `Bolelli` | unmatched |  |
| 493 | Australian Open | 2026 | `Cabral` | unmatched |  |
| 494 | Australian Open | 2026 | `Heliovaara` | unmatched |  |
| 495 | Australian Open | 2026 | `Heliovaara` | unmatched |  |
| 518 | Australian Open | 2024 | `Kyrgios` | unmatched |  |
| 534 | Australian Open | 2024 | `Millman` | unmatched |  |
| 539 | Australian Open | 2024 | `Millman` | unmatched |  |
| 568 | Australian Open | 2023 | `Barbara Schett` | unmatched |  |
| 569 | Australian Open | 2023 | `Mats Wilander` | unmatched |  |
| 571 | Australian Open | 2023 | `L. Broady` | unmatched |  |
| 573 | Australian Open | 2021 | `Djokovic` | no-entrants |  |
| 574 | Australian Open | 2021 | `Djokovic` | no-entrants |  |
| 575 | Australian Open | 2021 | `Berrettini` | no-entrants |  |
| 576 | Australian Open | 2021 | `Tsitsipas` | no-entrants |  |
| 577 | Australian Open | 2021 | `Schwartzman` | no-entrants |  |
| 578 | Australian Open | 2021 | `Thiem` | no-entrants |  |
| 579 | Australian Open | 2021 | `Bolt` | no-entrants |  |
| 580 | Australian Open | 2021 | `Bolt` | no-entrants |  |
| 581 | Australian Open | 2021 | `Duckworth` | no-entrants |  |
| 582 | Australian Open | 2021 | `F. Lopez` | no-entrants |  |
| 583 | Australian Open | 2021 | `Carballes Baena` | no-entrants |  |
| 584 | Australian Open | 2021 | `Millman` | no-entrants |  |
| 585 | Australian Open | 2021 | `Millman` | no-entrants |  |
| 586 | Australian Open | 2021 | `Millman` | no-entrants |  |
| 588 | Australian Open | 2020 | `Federer` | no-entrants |  |
| 589 | Australian Open | 2020 | `Federer` | no-entrants |  |
| 590 | Australian Open | 2020 | `Herbert` | no-entrants |  |
| 591 | Australian Open | 2020 | `Herbert` | no-entrants |  |
| 592 | Australian Open | 2020 | `Kyrgios` | no-entrants |  |
| 593 | Australian Open | 2020 | `Ebden` | no-entrants |  |
| 594 | Australian Open | 2020 | `Ebden` | no-entrants |  |
| 595 | Australian Open | 2020 | `Ebden` | no-entrants |  |
| 596 | Australian Open | 2020 | `E. Ymer` | no-entrants |  |
| 597 | Australian Open | 2020 | `Fucsovics` | no-entrants |  |
| 624 | Montpellier | 2021 | `Davidovich Fokina` | no-entrants |  |
| 626 | Montpellier | 2020 | `Monfils` | no-entrants |  |
| 627 | Montpellier | 2020 | `Barrere` | no-entrants |  |
| 645 | Dallas | 2025 | `Venue` | unmatched |  |
| 704 | Buenos Aires | 2021 | `Monteiro` | no-entrants |  |
| 705 | Buenos Aires | 2021 | `Monteiro` | no-entrants |  |
| 716 | Doha | 2025 | `Tennis TV` | unmatched |  |
| 717 | Doha | 2025 | `Ball` | unmatched |  |
| 732 | Doha | 2021 | `Federer` | no-entrants |  |
| 744 | Rio de Janeiro | 2025 | `Ruud` | unmatched |  |
| 770 | Delray Beach | 2025 | `Sean Calvert` | unmatched |  |
| 782 | Delray Beach | 2022 | `Jack Sock` | unmatched |  |
| 785 | Delray Beach | 2021 | `Karlovic` | no-entrants |  |
| 786 | Delray Beach | 2021 | `Garin` | no-entrants |  |
| 787 | Delray Beach | 2021 | `Garin` | no-entrants |  |
| 788 | Delray Beach | 2021 | `Quiroz` | no-entrants |  |
| 790 | Delray Beach | 2020 | `Opelka` | no-entrants |  |
| 791 | Delray Beach | 2020 | `Opelka` | no-entrants |  |
| 792 | Delray Beach | 2020 | `Opelka` | no-entrants |  |
| 818 | Acapulco | 2023 | `Berrettini` | ambiguous | M. Berrettini · J. Berrettini |
| 843 | Dubai | 2023 | `Ball` | unmatched |  |
| 850 | Dubai | 2021 | `Shapovalov` | no-entrants |  |
| 851 | Dubai | 2021 | `Thiem` | no-entrants |  |
| 852 | Dubai | 2021 | `Nishikori` | no-entrants |  |
| 853 | Dubai | 2021 | `Nick Lester` | no-entrants |  |
| 855 | Dubai | 2020 | `Djokovic` | no-entrants |  |
| 856 | Dubai | 2020 | `Djokovic` | no-entrants |  |
| 857 | Dubai | 2020 | `Herbert` | no-entrants |  |
| 858 | Dubai | 2020 | `Herbert` | no-entrants |  |
| 859 | Dubai | 2020 | `Monfils` | no-entrants |  |
| 860 | Dubai | 2020 | `Tsitsipas` | no-entrants |  |
| 886 | Indian Wells | 2026 | `Ball` | unmatched |  |
| 903 | Indian Wells | 2025 | `Sean Calvert` | unmatched |  |
| 908 | Indian Wells | 2024 | `Ball` | unmatched |  |
| 911 | Indian Wells | 2023 | `Magnus Norman` | unmatched |  |
| 927 | Miami | 2024 | `Tournament` | unmatched |  |
| 934 | Miami | 2021 | `Bautista-Agut` | no-entrants |  |
| 935 | Miami | 2021 | `Nishikori` | no-entrants |  |
| 936 | Miami | 2021 | `Karatsev` | no-entrants |  |
| 937 | Miami | 2021 | `Schwartzman` | no-entrants |  |
| 1006 | Monte Carlo | 2026 | `Heliovaara` | unmatched |  |
| 1017 | Monte Carlo | 2024 | `Mpetshi Perricard` | unmatched |  |
| 1059 | Barcelona | 2021 | `Nishikori` | no-entrants |  |
| 1060 | Barcelona | 2021 | `Nishikori` | no-entrants |  |
| 1078 | Munich | 2025 | `Fonseca` | unmatched |  |
| 1082 | Munich | 2022 | `Heliovaara` | unmatched |  |
| 1083 | Munich | 2022 | `Heliovaara` | unmatched |  |
| 1085 | Munich | 2021 | `Ball` | no-entrants |  |
| 1112 | Madrid | 2021 | `Isner` | no-entrants |  |
| 1113 | Madrid | 2021 | `Isner` | no-entrants |  |
| 1147 | Rome | 2020 | `Travaglia` | no-entrants |  |
| 1179 | Hertogenbosch | 2023 | `Nardi` | unmatched |  |
| 1196 | Roland Garros | 2025 | `Ball` | unmatched |  |
| 1220 | Roland Garros | 2020 | `Djokovic` | no-entrants |  |
| 1221 | Roland Garros | 2020 | `Djokovic` | no-entrants |  |
| 1222 | Roland Garros | 2020 | `Nadal` | no-entrants |  |
| 1223 | Roland Garros | 2020 | `Evans` | no-entrants |  |
| 1224 | Roland Garros | 2020 | `Thiem` | no-entrants |  |
| 1225 | Roland Garros | 2020 | `Zverev` | no-entrants |  |
| 1226 | Roland Garros | 2020 | `Sven Groeneveld` | no-entrants |  |
| 1233 | London | 2026 | `Shelton` | unmatched |  |
| 1240 | London | 2025 | `Kokkinakis` | unmatched |  |
| 1244 | London | 2024 | `Ebden` | unmatched |  |
| 1261 | London | 2021 | `Mahut` | unmatched |  |
| 1303 | Halle | 2026 | `Fery` | unmatched |  |
| 1305 | Halle | 2025 | `Player` | unmatched |  |
| 1328 | Eastbourne | 2026 | `Mensik` | unmatched |  |
| 1329 | Eastbourne | 2026 | `Mensik` | unmatched |  |
| 1330 | Eastbourne | 2026 | `Fonseca` | unmatched |  |
| 1331 | Eastbourne | 2026 | `Opelka` | unmatched |  |
| 1350 | Eastbourne | 2023 | `Giron` | unmatched |  |
| 1366 | Umag | 2025 | `Parmar` | unmatched |  |
| 1406 | Wimbledon | 2022 | `Medvedev` | unmatched |  |
| 1448 | Kitzbuhel | 2025 | `Rodionov` | unmatched |  |
| 1465 | Kitzbuhel | 2021 | `Hanfmann` | unmatched |  |
| 1466 | Kitzbuhel | 2021 | `Kecmanovic` | unmatched |  |
| 1468 | Kitzbuhel | 2021 | `Rodionov` | unmatched |  |
| 1469 | Kitzbuhel | 2021 | `Fognini` | unmatched |  |
| 1503 | Estoril | 2021 | `Ramos-Vinolas` | no-entrants |  |
| 1504 | Estoril | 2021 | `Ramos-Vinolas` | no-entrants |  |
| 1505 | Estoril | 2021 | `Cilic` | no-entrants |  |
| 1506 | Estoril | 2021 | `Norrie` | no-entrants |  |
| 1507 | Estoril | 2021 | `Moutet` | no-entrants |  |
| 1508 | Estoril | 2021 | `Humbert` | no-entrants |  |
| 1528 | Gstaad | 2023 | `Ramos-Vinolas` | unmatched |  |
| 1552 | Washington | 2024 | `Fritz` | unmatched |  |
| 1553 | Washington | 2024 | `Fritz` | unmatched |  |
| 1554 | Washington | 2024 | `Fritz` | unmatched |  |
| 1555 | Washington | 2024 | `Murray` | unmatched |  |
| 1600 | Los Cabos | 2021 | `Auger-Aliassime` | unmatched |  |
| 1631 | Montreal | 2024 | `Nishioka` | unmatched |  |
| 1682 | Cincinnati | 2020 | `Djokovic` | no-entrants |  |
| 1683 | Cincinnati | 2020 | `Medvedev` | no-entrants |  |
| 1684 | Cincinnati | 2020 | `Goffin` | no-entrants |  |
| 1692 | Winston-Salem | 2025 | `Stricker` | unmatched |  |
| 1695 | Winston-Salem | 2025 | `Bergs` | unmatched |  |
| 1728 | US Open | 2024 | `Cocciaretto` | unmatched |  |
| 1738 | US Open | 2021 | `Londero` | unmatched |  |

## Text alterations

Only two alterations are ever made, and every one is listed. The WORDS are never touched.

| row | what changed |
|---:|---|
| 4 | unwrapped outer “” |
| 5 | unwrapped outer “” |
| 8 | unwrapped outer “” |
| 10 | unwrapped outer “” |
| 11 | unwrapped outer “” |
| 12 | unwrapped outer “” |
| 14 | unwrapped outer “” |
| 15 | unwrapped outer “” |
| 16 | unwrapped outer “” |
| 17 | unwrapped outer “” |
| 22 | unwrapped outer “” |
| 23 | unwrapped outer “” |
| 24 | unwrapped outer “” |
| 26 | unwrapped outer “” |
| 30 | unwrapped outer “” |
| 31 | unwrapped outer “” |
| 33 | unwrapped outer “” |
| 43 | unwrapped outer “” |
| 45 | unwrapped outer “” |
| 53 | unwrapped outer “” |
| 54 | unwrapped outer “” |
| 55 | unwrapped outer “” |
| 60 | unwrapped outer “” |
| 61 | unwrapped outer “” |
| 64 | unwrapped outer “” |
| 71 | unwrapped outer “” |
| 72 | unwrapped outer “” |
| 73 | unwrapped outer “” |
| 74 | unwrapped outer “” |
| 76 | unwrapped outer “” |
| 81 | unwrapped outer “” |
| 82 | unwrapped outer “” |
| 84 | unwrapped outer “” |
| 85 | unwrapped outer “” |
| 88 | unwrapped outer “” |
| 89 | unwrapped outer “” |
| 90 | unwrapped outer “” |
| 95 | unwrapped outer “” |
| 96 | unwrapped outer “” |
| 97 | unwrapped outer “” |
| 98 | unwrapped outer “” |
| 99 | unwrapped outer “” |
| 100 | unwrapped outer “” |
| 101 | unwrapped outer “” |
| 102 | unwrapped outer “” |
| 105 | unwrapped outer “” |
| 106 | unwrapped outer “” |
| 107 | unwrapped outer “” |
| 108 | unwrapped outer “” |
| 109 | unwrapped outer “” |
| 110 | unwrapped outer “” |
| 111 | unwrapped outer “” |
| 112 | unwrapped outer “” |
| 113 | unwrapped outer “” |
| 114 | unwrapped outer “” |
| 115 | unwrapped outer “” |
| 118 | unwrapped outer “” |
| 119 | unwrapped outer “” |
| 120 | unwrapped outer “” |
| 121 | unwrapped outer “” |

**189 of 1376** imported values already contain their own quotation marks — they are narration around reported speech, not clean quotations. Flagged per record as `selfQuoted`. See the report's presentation note.

## Quotes per event

| event | quotes | dated | undated |
|---|---:|---:|---:|
| Australian Open | 120 | 120 | 0 |
| Shanghai | 65 | 65 | 0 |
| Paris | 54 | 54 | 0 |
| Indian Wells | 47 | 47 | 0 |
| Cincinnati | 40 | 40 | 0 |
| Roland Garros | 40 | 40 | 0 |
| Dubai | 34 | 34 | 0 |
| Wimbledon | 34 | 34 | 0 |
| Delray Beach | 32 | 32 | 0 |
| Barcelona | 29 | 29 | 0 |
| Beijing | 29 | 28 | 1 |
| Estoril | 29 | 29 | 0 |
| Los Cabos | 29 | 29 | 0 |
| Montreal | 29 | 29 | 0 |
| Rome | 29 | 29 | 0 |
| Basel | 28 | 28 | 0 |
| London | 28 | 28 | 0 |
| Turin | 28 | 28 | 0 |
| Washington | 28 | 28 | 0 |
| Kitzbuhel | 27 | 27 | 0 |
| Mallorca | 27 | 27 | 0 |
| Eastbourne | 26 | 26 | 0 |
| US Open | 26 | 26 | 0 |
| Buenos Aires | 22 | 22 | 0 |
| Madrid | 22 | 22 | 0 |
| Acapulco | 21 | 21 | 0 |
| Dallas | 21 | 21 | 0 |
| Halle | 21 | 21 | 0 |
| Houston | 21 | 21 | 0 |
| Bastad | 20 | 20 | 0 |
| Doha | 20 | 20 | 0 |
| Montpellier | 20 | 20 | 0 |
| Munich | 19 | 19 | 0 |
| Vienna | 19 | 19 | 0 |
| Adelaide | 18 | 18 | 0 |
| Monte Carlo | 18 | 18 | 0 |
| Gstaad | 17 | 17 | 0 |
| Miami | 17 | 17 | 0 |
| Almaty | 16 | 15 | 1 |
| Marrakech | 16 | 16 | 0 |
| Brisbane | 14 | 14 | 0 |
| Hertogenbosch | 14 | 14 | 0 |
| Rio de Janeiro | 14 | 14 | 0 |
| Winston-Salem | 14 | 14 | 0 |
| Auckland | 13 | 13 | 0 |
| Rotterdam | 13 | 13 | 0 |
| Chengdu | 12 | 12 | 0 |
| Bucharest | 11 | 11 | 0 |
| Stockholm | 11 | 11 | 0 |
| Tokyo | 11 | 10 | 1 |
| Metz | 10 | 10 | 0 |
| Umag | 10 | 10 | 0 |
| Geneva | 9 | 9 | 0 |
| Hangzhou | 9 | 9 | 0 |
| Marseille | 9 | 9 | 0 |
| Brussels | 7 | 7 | 0 |
| Hong Kong | 7 | 7 | 0 |
| Lyon (France) | 2 | 2 | 0 |

## Events with no quotes — **17** of 75 get NO card

`French Open` · `Toronto` · `Hamburg` · `Sydney` · `Zhuhai` · `Pune` · `Cordoba` · `Santiago` · `Lyon` · `Newport` · `Tel Aviv` · `Astana` · `Antwerp` · `Belgrade` · `Stuttgart` · `Ho Chi Minh City` · `Jeddah`


## Not about conditions (founder 2026-11-20: only quotes that tell a member how the event plays) — 22
- row 19 · Chengdu · Bolt: On Saville soaking through his shoes in qualies: “I don't quite sweat …
- row 31 · Hangzhou · A. Cazaux: Yes, I feel comfortable here. The Chinese fans are very nice, they bri…
- row 35 · Hangzhou · Shuai Zhang: After the Asian Games: “In terms of climate, Shanghai is cooler than H…
- row 262 · Vienna · J. Sinner: On the atmosphere: “The crowd was fantastic from the first round — ind…
- row 308 · Paris · T. Atmane: The ones used in this tournament get quite big right from the start. I…
- row 363 · Stockholm · C. Ruud: After beating Sonego: “I tried to return deep considering we're playin…
- row 610 · Montpellier · F. Auger-Aliassime: Tough first set. There were a lot of breaks on the serve which is unus…
- row 612 · Montpellier · A. Bublik: Playing Felix is a tough challenge, especially indoors. I left it all …
- row 634 · Dallas · D. Shapovalov: He plays really well, especially indoors and serves big. It was kind o…
- row 649 · Dallas · B. Shelton: Anytime you can come back and get a win after losing the first set, it…
- row 652 · Dallas · JS Gomez: It was a really tough match, especially after failing to serve it out …
- row 658 · Dallas · T. Fritz: “I always like coming indoors though “I feel like I play well.”…
- row 675 · Rotterdam · A. Rublev: “There are a lot of exchanges due…
- row 696 · Buenos Aires · C. Norrie: It was so difficult compared to the other day when it was boiling, tod…
- row 744 · Rio de Janeiro · Ruud: “Put some respect to the names of all players competing at the Rio Ope…
- row 1048 · Barcelona · C. Ruud: It was a tricky match for sure. I didn’t have too much time to recover…
- row 1055 · Barcelona · C. Alcaraz: I came from Miami with some physical discomfort, which prevented me fr…
- row 1071 · Munich · B. Shelton: It was a warmer day, so there were shorter rallies and a different kin…
- row 1288 · Mallorca · C. Eubanks: Serving well is always the key to me playing well, and so far, since I…
- row 1467 · Kitzbuhel · Novak: Maxi feels very comfortable here at high altitudes and has played well…
- row 1527 · Gstaad · D. Altmaier: I enjoy playing in these circumstances. With my experience playing in …
- row 1557 · Washington · J. Thompson: It's extremely muggy, I was sweating cannons today.…