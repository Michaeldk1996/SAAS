"""
BSP Consult — Internal R&D: Elo + Serve-Stats Backtesting
-----------------------------------------------------------------
INTERNAL USE ONLY. Do not deploy this data or its direct outputs to
the customer-facing dashboard or app.

Jeff Sackmann's tennis_atp dataset (github.com/JeffSackmann/tennis_atp)
is licensed CC BY-NC-SA 4.0 — non-commercial use only. Using it to
build and validate your OWN scoring methodology internally (research,
backtesting, model calibration) is a defensible use. Serving this data,
or a model trained directly on it, to paying BSP Consult members would
not be — that requires either Sackmann's permission or a licensed
commercial data source (e.g. API-Tennis.com, Sportradar) for the
production pipeline instead.

Practical takeaway: use this script to figure out what actually
predicts match outcomes (which surface-form weighting works, how much
recent form should matter, etc.), then apply what you learn using
licensed live data sources in bsp-pipeline.js — not this dataset itself.

SETUP (run locally, not in a restricted sandbox)
-------------------------------------------------
1. git clone https://github.com/JeffSackmann/tennis_atp.git
2. cd tennis_atp
3. pip install pandas numpy
4. Copy this script into that folder and run: python backtest_elo.py

WHAT THIS DOES
--------------
1. Loads several years of match data
2. Builds a standard Elo rating system (updated after every match)
3. Also builds SURFACE-SPECIFIC Elo (separate rating per surface —
   this is the "surface form" piece of your methodology)
4. Computes serve-based stats available in this dataset: ace rate,
   first-serve win %, break points saved % (NOT the same as W/UE —
   this dataset has no winners/unforced-errors columns, only serve
   stats. If W/UE specifically matters to your model, that needs a
   different source, e.g. the Match Charting Project, which has its
   OWN separate, stricter licensing to check.)
5. Backtests: for every match, predicts the winner using Elo before
   the match happened, then checks accuracy against the real result.
   This tells you how good Elo alone is as a baseline before you add
   your own weighting on top.
"""

import pandas as pd
import numpy as np
from pathlib import Path

DATA_DIR = Path(".")  # run from inside the cloned tennis_atp folder
YEARS = range(2018, 2025)  # adjust range as needed
K_FACTOR = 32  # standard Elo K-factor; tune this during backtesting

def load_matches(years):
    frames = []
    for year in years:
        path = DATA_DIR / f"atp_matches_{year}.csv"
        if path.exists():
            df = pd.read_csv(path)
            frames.append(df)
        else:
            print(f"Missing file: {path} (skipping)")
    return pd.concat(frames, ignore_index=True).sort_values("tourney_date")

def surface_key(surface):
    # Normalize surface names as they appear in the dataset
    return (surface or "Hard").strip()

class EloTracker:
    """Tracks both overall and surface-specific Elo per player."""
    def __init__(self, k=K_FACTOR, base=1500):
        self.k = k
        self.base = base
        self.overall = {}
        self.surface = {}  # (player, surface) -> rating

    def get_overall(self, player):
        return self.overall.get(player, self.base)

    def get_surface(self, player, surface):
        return self.surface.get((player, surface), self.base)

    def expected_score(self, rating_a, rating_b):
        return 1 / (1 + 10 ** ((rating_b - rating_a) / 400))

    def update(self, winner, loser, surface):
        # Overall Elo
        r_w, r_l = self.get_overall(winner), self.get_overall(loser)
        exp_w = self.expected_score(r_w, r_l)
        self.overall[winner] = r_w + self.k * (1 - exp_w)
        self.overall[loser] = r_l + self.k * (0 - (1 - exp_w))

        # Surface-specific Elo
        sk = surface_key(surface)
        rs_w, rs_l = self.get_surface(winner, sk), self.get_surface(loser, sk)
        exp_sw = self.expected_score(rs_w, rs_l)
        self.surface[(winner, sk)] = rs_w + self.k * (1 - exp_sw)
        self.surface[(loser, sk)] = rs_l + self.k * (0 - (1 - exp_sw))

def serve_stats(row, prefix):
    """Derive rate stats from the raw serve columns for one player in a match."""
    svpt = row.get(f"{prefix}_svpt", np.nan)
    first_in = row.get(f"{prefix}_1stIn", np.nan)
    first_won = row.get(f"{prefix}_1stWon", np.nan)
    bp_saved = row.get(f"{prefix}_bpSaved", np.nan)
    bp_faced = row.get(f"{prefix}_bpFaced", np.nan)
    ace = row.get(f"{prefix}_ace", np.nan)

    return {
        "ace_rate": ace / svpt if svpt else np.nan,
        "first_serve_win_pct": first_won / first_in if first_in else np.nan,
        "bp_saved_pct": bp_saved / bp_faced if bp_faced else np.nan,
    }

def run_backtest():
    print("Loading match data...")
    matches = load_matches(YEARS)
    print(f"Loaded {len(matches)} matches from {YEARS.start}-{YEARS.stop - 1}")

    elo = EloTracker()
    correct = 0
    total = 0

    # Blend weight between overall Elo and surface-specific Elo —
    # this is exactly the kind of parameter you'd tune to match your
    # own methodology's surface-form weighting.
    SURFACE_WEIGHT = 0.5

    for _, row in matches.iterrows():
        winner, loser = row["winner_name"], row["loser_name"]
        surface = row["surface"]
        if pd.isna(winner) or pd.isna(loser):
            continue

        # Predict BEFORE updating ratings with this match's result
        overall_w, overall_l = elo.get_overall(winner), elo.get_overall(loser)
        surf_w, surf_l = elo.get_surface(winner, surface_key(surface)), elo.get_surface(loser, surface_key(surface))

        blended_w = (1 - SURFACE_WEIGHT) * overall_w + SURFACE_WEIGHT * surf_w
        blended_l = (1 - SURFACE_WEIGHT) * overall_l + SURFACE_WEIGHT * surf_l

        predicted_prob_winner_wins = elo.expected_score(blended_w, blended_l)
        predicted_correctly = predicted_prob_winner_wins > 0.5

        if predicted_correctly:
            correct += 1
        total += 1

        # Now update ratings with the real result
        elo.update(winner, loser, surface)

    accuracy = correct / total if total else 0
    print(f"\nBacktest complete.")
    print(f"Matches evaluated: {total}")
    print(f"Prediction accuracy (Elo + surface blend, before your own weighting): {accuracy*100:.2f}%")
    print(f"\nFor reference: a coin flip is 50%. Published tennis Elo models")
    print(f"typically land in the 65-70% range on ATP tour-level matches.")
    print(f"If you're below that, try tuning K_FACTOR or SURFACE_WEIGHT above.")

if __name__ == "__main__":
    run_backtest()
