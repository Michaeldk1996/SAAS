#!/usr/bin/env python3
# TEN-312 / TEN-314 — TEST-ONLY pixel diff for the Match analysis harness. Manual tool, never run in CI,
# never loaded by the live page. PIL only (no numpy).
#
#   python3 tools/ten312-pixel-diff.py <refDir> <candDir> <outDir> [--threshold N] [--also 8] [--regions <candDir>/manifest.json]
#
# --regions: also diff the named crop boxes each screen carries in a build-capture manifest (tools/ten312-build-capture.mjs:
# `header`, `menu` = [x0, y0, x1, y1], modal-relative), reported as `<name>--<region>` rows. The frame (TEN-314 step 1)
# is judged on these rows; the whole-screen rows are the baseline for tabs not rebuilt yet.
#
# For every <name>.png present in BOTH dirs: compare RGBA per pixel; a pixel "differs" when any channel's
# |delta| > threshold (default 0). If the two sizes differ, both sizes are reported and only the overlapping
# top-left region is compared (flagged `sizeMatch:false` / "overlap only" in the table); the non-overlapping
# area is reported separately as `extraPx` and is NOT counted in the % (which is over the overlap).
# A second threshold (default 8) is always reported alongside.
# Writes <outDir>/<name>.diff.png (differing pixels red over a dimmed greyscale of the reference),
# <outDir>/report.json and <outDir>/report.md.
import json, os, sys
from PIL import Image, ImageChops

def parse(argv):
    pos, opt = [], {'threshold': 0, 'also': 8, 'regions': None}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ('--threshold', '--also'):
            opt[a[2:]] = int(argv[i + 1]); i += 2
        elif a == '--regions':
            opt['regions'] = argv[i + 1]; i += 2
        else:
            pos.append(a); i += 1
    if len(pos) != 3:
        sys.exit('usage: ten312-pixel-diff.py <refDir> <candDir> <outDir> [--threshold N] [--also N] [--regions manifest.json]')
    return pos, opt

def maxdelta_mask(a, b):
    """L-mode image: per pixel max over RGBA channels of |a-b|."""
    d = ImageChops.difference(a, b)
    r, g, bl, al = d.split()
    return ImageChops.lighter(ImageChops.lighter(r, g), ImageChops.lighter(bl, al))

def count_over(md, t):
    hist = md.histogram()          # 256 bins
    return sum(hist[t + 1:])

def main():
    (ref_dir, cand_dir, out_dir), opt = parse(sys.argv[1:])
    t0, t1 = opt['threshold'], opt['also']
    os.makedirs(out_dir, exist_ok=True)
    names = sorted(set(f for f in os.listdir(ref_dir) if f.endswith('.png')) &
                   set(f for f in os.listdir(cand_dir) if f.endswith('.png')))
    only_ref = sorted(set(f for f in os.listdir(ref_dir) if f.endswith('.png')) - set(names))
    rows = []
    jobs = [(n, None) for n in names]
    if opt['regions']:
        man = json.load(open(opt['regions']))
        for sc in man['screens']:
            n = sc['ref'] + '.png'
            if n in names:
                jobs += [(n, (k, sc[k])) for k in ('header', 'menu') if k in sc]
    for n, region in jobs:
        ref = Image.open(os.path.join(ref_dir, n)).convert('RGBA')
        cand = Image.open(os.path.join(cand_dir, n)).convert('RGBA')
        if region:
            box = tuple(region[1]); ref = ref.crop(box); cand = cand.crop(box); n = n[:-4] + '--' + region[0] + '.png'
        w, h = min(ref.width, cand.width), min(ref.height, cand.height)
        same = ref.size == cand.size
        r = ref.crop((0, 0, w, h)); c = cand.crop((0, 0, w, h))
        md = maxdelta_mask(r, c)
        n0, n1 = count_over(md, t0), count_over(md, t1)
        total = w * h
        extra = ref.width * ref.height + cand.width * cand.height - 2 * total
        # diff image: dimmed greyscale reference (composited on black), red where |d| > t0
        base = Image.alpha_composite(Image.new('RGBA', ref.size, (0, 0, 0, 255)), ref).convert('L')
        base = base.point(lambda v: v * 0.35).convert('RGB')
        mask = md.point(lambda v: 255 if v > t0 else 0)
        red = Image.new('RGB', (w, h), (255, 0, 0))
        base.paste(red, (0, 0), mask)
        base.save(os.path.join(out_dir, n[:-4] + '.diff.png'))
        rows.append({'name': n[:-4], 'refSize': list(ref.size), 'candSize': list(cand.size), 'sizeMatch': same,
                     'compared': [w, h], 'overlapOnly': not same, 'extraPx': extra,
                     'diffPx': n0, 'pct': round(100 * n0 / total, 3), 'threshold': t0,
                     'diffPxAlso': n1, 'pctAlso': round(100 * n1 / total, 3), 'thresholdAlso': t1})
    with open(os.path.join(out_dir, 'report.json'), 'w') as f:
        json.dump({'refDir': os.path.abspath(ref_dir), 'candDir': os.path.abspath(cand_dir),
                   'onlyInRef': only_ref, 'rows': rows}, f, indent=1)
    md_lines = ['| screen | ref size | cand size | size match | differing px (t=%d) | %% (t=%d) | differing px (t=%d) | %% (t=%d) |' % (t0, t0, t1, t1),
                '|---|---|---|---|---|---|---|---|']
    for r in rows:
        md_lines.append('| %s | %dx%d | %dx%d | %s | %d | %.3f | %d | %.3f |' % (
            r['name'], *r['refSize'], *r['candSize'], 'yes' if r['sizeMatch'] else 'NO (overlap %dx%d only)' % tuple(r['compared']),
            r['diffPx'], r['pct'], r['diffPxAlso'], r['pctAlso']))
    if only_ref:
        md_lines.append('\nIn ref only (not captured): ' + ', '.join(only_ref))
    open(os.path.join(out_dir, 'report.md'), 'w').write('\n'.join(md_lines) + '\n')
    print('\n'.join(md_lines))

if __name__ == '__main__':
    main()
