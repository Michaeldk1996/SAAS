#!/usr/bin/env python3
# TEN-330 — TEST-ONLY structural comparison of the Form tab: design vs build text leaves (tools/ten330-form-capture.mjs
# leaves.json). Manual tool, never run in CI. For every state: the two leaf lists are aligned in reading order
# (difflib on the text), then every aligned pair is compared on box (x, y, w, h; tolerance --tol px, default 0.5),
# font size, weight and family. Unmatched leaves on either side are structural differences.
#
#   python3 tools/ten330-form-structure.py <capDir>/leaves.json [--tol 0.5] [--state name]
# Prints a per-state table and writes <capDir>/structure.json. Regenerates nothing else.
import json, sys, os, difflib

def main():
    a = sys.argv[1:]
    if not a: sys.exit('usage: ten330-form-structure.py leaves.json [--tol 0.5] [--state name]')
    src = a[0]; tol = float(a[a.index('--tol') + 1]) if '--tol' in a else 0.5
    only = a[a.index('--state') + 1] if '--state' in a else None
    L = json.load(open(src))
    out = {}
    print('| state | design leaves | build leaves | text-only in design | text-only in build | text changed | box off > %.1fpx | font diff |' % tol)
    print('|---|---|---|---|---|---|---|---|')
    for st in L['design']:
        if only and st != only: continue
        d, b = L['design'][st], L['build'].get(st, [])
        sm = difflib.SequenceMatcher(a=[x['t'] for x in d], b=[x['t'] for x in b], autojunk=False)
        onlyD, onlyB, changed, off, font = [], [], [], [], []
        # the two roots differ by the content column's padding: remove the median offset of the matched pairs
        pairs = [(d[i1 + k], b[j1 + k]) for op, i1, i2, j1, j2 in sm.get_opcodes() if op == 'equal' for k in range(i2 - i1)]
        med = lambda v: sorted(v)[len(v) // 2] if v else 0
        ox, oy = med([y['x'] - x['x'] for x, y in pairs]), med([y['y'] - x['y'] for x, y in pairs])
        for y in b: y['x'] = round(y['x'] - ox, 1); y['y'] = round(y['y'] - oy, 1)
        for op, i1, i2, j1, j2 in sm.get_opcodes():
            if op == 'equal':
                for k in range(i2 - i1):
                    x, y = d[i1 + k], b[j1 + k]
                    dd = {q: round(y[q] - x[q], 1) for q in ('x', 'y', 'w', 'h') if abs(y[q] - x[q]) > tol}
                    if dd: off.append({'t': x['t'], 'd': dd, 'design': [x['x'], x['y']]})
                    if (x['fs'], x['fw'], x['ff']) != (y['fs'], y['fw'], y['ff']): font.append({'t': x['t'], 'design': [x['fs'], x['fw'], x['ff']], 'build': [y['fs'], y['fw'], y['ff']]})
            elif op == 'replace':
                changed.append({'design': [x['t'] for x in d[i1:i2]], 'build': [y['t'] for y in b[j1:j2]]})
            elif op == 'delete':
                onlyD += [x['t'] for x in d[i1:i2]]
            elif op == 'insert':
                onlyB += [y['t'] for y in b[j1:j2]]
        out[st] = {'rootOffset': [ox, oy], 'designLeaves': len(d), 'buildLeaves': len(b), 'onlyDesign': onlyD, 'onlyBuild': onlyB, 'changed': changed, 'boxOff': off, 'fontDiff': font}
        print('| %s | %d | %d | %d | %d | %d | %d | %d |' % (st, len(d), len(b), len(onlyD), len(onlyB), len(changed), len(off), len(font)))
    json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(src)), 'structure.json'), 'w'), indent=1, ensure_ascii=False)

if __name__ == '__main__':
    main()
