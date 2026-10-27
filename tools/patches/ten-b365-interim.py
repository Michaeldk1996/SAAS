#!/usr/bin/env python3
# Founder brief 2026-10-26 ("finish and close", item 2): the 200 Bet365 rows outside Jan-Apr 2026 show the real Bet365
# close with the "B" marker again (interim), until a Pinnacle close is found; the 710 start-10 rows stay dashed.
# Replayable: each step checks the RESULT.
import sys, pathlib
def step(path, name, old, new, done):
    p = pathlib.Path(path); s = p.read_text()
    if done in s: print('skip:', name); return
    n = s.count(old)
    if n != 1: sys.exit(f'FAIL {name}: anchor x{n}')
    p.write_text(s.replace(old, new)); print('applied:', name)

B = 'build-database-yield.js'
step(B, 'interim flag',
  "const B365_FROM = '2026-01-01', B365_TO = '2026-04-30';",
  "const B365_FROM = '2026-01-01', B365_TO = '2026-04-30';\n"
  "// Founder 2026-10-26 (\"finish and close\" item 2, interim): until a Pinnacle close is found, a Bet365-only row shows the real\n"
  "// Bet365 close, marked \"B\", at every date — the Jan–Apr 2026 window is off. A Pinnacle pair (Tennis-Data's or our archive's)\n"
  "// still wins per row, so a close that arrives replaces the B on the next build. false = the Jan–Apr-only window again.\n"
  "const B365_INTERIM = true;",
  "const B365_INTERIM = true;")
step(B, 'interim rule',
  "    const b365Ok = (validPrice(B365[0]) && validPrice(B365[1])) && (season < WINDOW_START || (dB >= B365_FROM && dB <= B365_TO));",
  "    const b365Ok = (validPrice(B365[0]) && validPrice(B365[1])) && (B365_INTERIM || season < WINDOW_START || (dB >= B365_FROM && dB <= B365_TO));",
  "(B365_INTERIM || season < WINDOW_START")
step(B, 'interim meta',
  "  bet365Window: { from: B365_FROM, to: B365_TO, droppedOutside: b365Dropped },",
  "  bet365Window: { from: B365_FROM, to: B365_TO, interim: B365_INTERIM, droppedOutside: b365Dropped },",
  "interim: B365_INTERIM, droppedOutside")
