# Theme 12a "Ink solid" — colours, hairlines, logo (founder brief TEN-285, 2026-09-25)

Source: `HANDOFF.md` §1 (tokens), §2 (logo), §4 (other screens) of the 12a handoff; §3 only for
which token goes on which element — never its sizes. Colours + hairlines + logo only: layout,
data and features are out of scope for this theme.

## Tokens (exact; defined once in the first `:root` of `bsp-consult-dashboard.html` and `account.html`)

Surfaces: `page #0B0C13` · `nav-panel #0D0F18` · `surface #0E1019` · `surface-inner #0C0E16` ·
`input transparent` · `popup #131623` · `backdrop rgba(11,12,19,0.76)`.
Lines (all **0.33px**): `line rgba(255,255,255,0.045)` · `line-soft 0.03` · `line-panel 0.035` ·
`line-open 0.10` · `line-avatar 0.06`.
Text: `text #EBF1F2` · `text-soft #D9DBDF` · `text-sub #A3ABBA` · `label #6E7A93` · `nav-idle #9BB0DA` ·
`nav-icon-idle #7F93BD`.
Accent: `blue-ring #007AFF` · `periwinkle #6A9AF8` · `navy #07183D` · `royal #0B2878` · `lime #EAF928` ·
`bar-track #16234A` · `bar-dog #2A3556` · `seg-active #0B1C4E` / `seg-active-line #2E4FA8`.
Functional: Hard `#6A9AF8` · Clay `#F2B45F` · Grass `#45D6B0` · `positive #3ED68C` · `negative #DA6259`.
§3 nav values: hover `rgba(106,154,248,0.08)`, active fill `rgba(0,122,255,0.16)`, active outline
0.5px `rgba(106,154,248,0.18)`, active dot lime. Player avatar fill `#0B0C14`.

## Tests

- **Every rendered colour is a token.** The computed-style audit (every tab + modal / drawer /
  Market Signal / hover states) reports only tokens, `transparent`, or the unmapped list below.
  Chrome stores alpha in 8 bits, so `0.045` reads back `0.043`: compare `round(a*255)`, not the string.
- **Lime count = 2**: header live dot + active-nav dot (a `::after`).
- **Blue-ring roles**: probability bars, form bars, date underline, Today dot. Nothing else.
- **No chrome gradients / shadows / blur.** Remaining sites must be on the data-viz list below.
- **Logo**: `assets/logo-dark-transparent.png`, first item in the sidebar, rendered 26.0 × 138.8px,
  no box behind it. Icon-only slots use `assets/ring-transparent.png`. `assets/bsp-logo.jpg` is gone;
  both PNGs are copied into `_site/assets/` and asserted by "Assert site completeness".
- **Hairlines** are written `0.33px` (1 device px at 1x; the opacity carries the weight).

## Unmapped (no token home) and data-viz effects — left unchanged, PENDING founder ruling

The list lives on TEN-285 (document `inventory`, sections b and c). Until he rules, those values
are the only permitted non-token colours. When he rules, replace this paragraph with the ruling.
