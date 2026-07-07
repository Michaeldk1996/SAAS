import pandas as pd
import numpy as np

K_FACTOR = 32
SURFACE_WEIGHT = 0.5

df = pd.read_csv("demo_matches.csv").sort_values("tourney_date")

class EloTracker:
    def __init__(self, k=K_FACTOR, base=1500):
        self.k = k; self.base = base
        self.overall = {}; self.surface = {}
    def get_overall(self, p): return self.overall.get(p, self.base)
    def get_surface(self, p, s): return self.surface.get((p, s), self.base)
    def expected(self, ra, rb): return 1 / (1 + 10 ** ((rb - ra) / 400))
    def update(self, w, l, surface):
        rw, rl = self.get_overall(w), self.get_overall(l)
        e = self.expected(rw, rl)
        self.overall[w] = rw + self.k*(1-e)
        self.overall[l] = rl + self.k*(0-(1-e))
        rsw, rsl = self.get_surface(w, surface), self.get_surface(l, surface)
        es = self.expected(rsw, rsl)
        self.surface[(w,surface)] = rsw + self.k*(1-es)
        self.surface[(l,surface)] = rsl + self.k*(0-(1-es))

elo = EloTracker()
correct, total = 0, 0
print(f"{'Date':<10} {'Surface':<7} {'Match':<40} {'Pre-match P(winner wins)':<25} {'Correct?'}")
print("-"*100)

for _, row in df.iterrows():
    w, l, surface = row['winner_name'], row['loser_name'], row['surface']
    ow, ol = elo.get_overall(w), elo.get_overall(l)
    sw, sl = elo.get_surface(w, surface), elo.get_surface(l, surface)
    bw = (1-SURFACE_WEIGHT)*ow + SURFACE_WEIGHT*sw
    bl = (1-SURFACE_WEIGHT)*ol + SURFACE_WEIGHT*sl
    prob = elo.expected(bw, bl)
    was_correct = prob > 0.5
    correct += was_correct; total += 1
    match_str = f"{w} d. {l}"
    print(f"{row['tourney_date']:<10} {surface:<7} {match_str:<40} {prob:.1%}{'':<20} {'YES' if was_correct else 'no'}")
    elo.update(w, l, surface)

print("-"*100)
print(f"\nAccuracy on this demo set: {correct}/{total} = {correct/total*100:.1f}%")
print("\nFinal overall Elo ratings:")
for p, r in sorted(elo.overall.items(), key=lambda x: -x[1]):
    print(f"  {p}: {r:.0f}")

print("\nFinal surface-specific Elo (grass):")
grass = {p: r for (p,s), r in elo.surface.items() if s == 'Grass'}
for p, r in sorted(grass.items(), key=lambda x: -x[1]):
    print(f"  {p}: {r:.0f}")
