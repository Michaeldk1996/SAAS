# Speed-panel surface tint — the three variants (TEN-242, 2026-09-20)

Report-first, per the founder: *"RULING NEEDED BEFORE YOU BUILD … Screenshot
each before committing."* **Nothing here is wired into the product.**

`build-variants.py` writes `variant-{a,b,c}.html` beside the dashboard from the
live source, so the variants track the real file rather than a stale copy.
`screenshot-variants.mjs` opens the speed panel in headless Chrome and captures
each, plus the computed colours and the WCAG contrast of every token.

| | colour carries | Indoor vs Outdoor told apart by |
|---|---|---|
| a | surface | nothing — two identical blue columns |
| b | surface | opacity: Indoor heading, chip AND BAR at lower alpha |
| c | surface | chip FILL (Indoor solid, others outlined); no bar is dimmed |

Measured 2026-09-20: Indoor 12/12 hard, Outdoor 23/23 hard, Clay 21/21 clay,
Grass 8/8 grass — so the columns are surface-pure today and a literal mapping
does paint two of four the same blue.

The tint is derived from **the row's own `t.surface`**, never from the column.
`bucketOf` is `indoor ? 'Indoor' : …`, so an indoor CLAY event would land in the
Indoor column; deriving from the column would then paint it blue. None exists
today — this is a guard against a future row, not a live defect.
