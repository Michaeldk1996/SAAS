# TEN-206 design handoff — WHICH FOLDER IS THE SPEC

Two exports live here. **`design_handoff_player_profile_LOCKED_v7/` wins.**

| folder | export | dated | status |
|---|---|---|---|
| `design_handoff_player_profile/` | "Stennisfy dashboard rebuild (6).zip" | 2026-09-16 | **SUPERSEDED — do not spec from this** |
| `design_handoff_player_profile_LOCKED_v7/` | "Stennisfy dashboard rebuild (7).zip" | 2026-09-18 | **LOCKED.** Layout 9e, box set re-locked 2026-09-17. Copies of `Player Profile LOCKED.dc.html` / `Player Stat Boxes LOCKED.dc.html`. |

v7 is not a cosmetic bump. It renames four boxes, rewrites eight modal subtitles,
removes the Surface group from Draw record, and **adds three in-modal tab rows with
new bodies that do not exist in v6 at all**:

- Career record — `Record` · `Ratings`
- Market edge — `Match winner` · `Derived lines`
- Live trading — `Ratings` · `Live trading` · `Lines`

Plus a `Career | Last 52` grain control in the Career record and Draw record modal headers,
and an 8-band price ladder (`1.01 – 1.20` … `6.00 +`) in Market edge where v6 and the v7
README both still print the 4-band ladder. **The `.dc.html` file wins over the README.**

Spec order (unchanged): `Player Profile.dc.html` + `Player Stat Boxes.dc.html` → `README.md`
→ `STENNISFY-DESIGN-INSTRUCTIONS.md` → screenshots.
