#!/usr/bin/env python3
# TEN-336 — TEST-ONLY per-card pixel diff for the Market edge harness (tools/ten336-me-capture.mjs). Manual tool, never
# run in CI. For every tab screen, the i-th card (radius 14) of the design is compared with the i-th card of the build,
# each cropped at its own box, over their common size — so a card is judged on itself, not on a ruled shift above it.
#
#   python3 tools/ten336-card-diff.py <capDir> [--threshold 0]
# Prints a table and writes <capDir>/cards/<screen>--card<i>.diff.png. Regenerates nothing else.
import json, os, sys
from PIL import Image, ImageChops

def main():
    cap = sys.argv[1]; t = int(sys.argv[sys.argv.index('--threshold') + 1]) if '--threshold' in sys.argv else 0
    D = {s['name']: s for s in json.load(open(os.path.join(cap, 'design', 'manifest.json')))['screens']}
    B = {s['name']: s for s in json.load(open(os.path.join(cap, 'build', 'manifest.json')))['screens']}
    out = os.path.join(cap, 'cards'); os.makedirs(out, exist_ok=True)
    print('| screen | card | design box | build box | common | differing px | % |')
    print('|---|---|---|---|---|---|---|')
    for n, d in D.items():
        b = B.get(n)
        if not b or 'cards' not in d or 'cards' not in b: continue
        di = Image.open(os.path.join(cap, 'design', n + '.png')).convert('RGBA'); bi = Image.open(os.path.join(cap, 'build', n + '.png')).convert('RGBA')
        for i, (dc, bc) in enumerate(zip(d['cards'], b['cards'])):
            a = di.crop(tuple(dc)); c = bi.crop(tuple(bc)); w, h = min(a.width, c.width), min(a.height, c.height)
            a = a.crop((0, 0, w, h)); c = c.crop((0, 0, w, h))
            md = ImageChops.difference(a, c); md = ImageChops.lighter(ImageChops.lighter(md.getchannel(0), md.getchannel(1)), ImageChops.lighter(md.getchannel(2), md.getchannel(3)))
            px = sum(1 for v in md.getdata() if v > t)
            base = Image.alpha_composite(Image.new('RGBA', a.size, (0, 0, 0, 255)), a).convert('L').point(lambda v: v // 3).convert('RGB')
            red = Image.new('RGB', a.size, (255, 40, 40)); mask = md.point(lambda v: 255 if v > t else 0)
            Image.composite(red, base, mask).save(os.path.join(out, '%s--card%d.diff.png' % (n, i)))
            print('| %s | %d | %s | %s | %dx%d | %d | %.3f |' % (n, i, dc, bc, w, h, px, px * 100.0 / (w * h)))

main()
