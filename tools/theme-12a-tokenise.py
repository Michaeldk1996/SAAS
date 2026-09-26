#!/usr/bin/env python3
"""TEN-286 — point hard-coded 12a colour VALUES at their token, where CSS can resolve a token.

A literal is rewritten to `var(--token)` only when ALL hold:
  - it is exactly a 12a token's value (the first :root block of bsp-consult-dashboard.html is the source);
  - it sits in CSS text: after `property:` inside the same string / style attribute, and not directly
    after an opening quote (so a bare JS value like '#6a9af8' — which may feed an SVG attribute or a helper
    that parses hex — is never touched, and neither is an SVG `fill="…"` attribute);
  - it is not inside a comment, the :root token definitions, or a <style> custom-property definition.
Everything else is left as it is and COUNTED (see --report). Running it twice changes nothing.

usage: tools/theme-12a-tokenise.py [--write] [--report out.json] <file> [<file> ...]
Proof of "no visual change" is external: a per-element computed-style snapshot, identical before/after.
"""
import json, re, sys

HERE_PAGE = 'bsp-consult-dashboard.html'
COLOR = re.compile(r'#[0-9a-fA-F]{8}\b|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![-\w])|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+%?\s*)?\)')

def canon(v):
    v = v.lower().replace(' ', '')
    m = re.fullmatch(r'rgba\((\d+),(\d+),(\d+),([\d.]+)\)', v)
    if m: return f'rgba({m[1]},{m[2]},{m[3]},{float(m[4]):g})'
    if re.fullmatch(r'#[0-9a-f]{3}', v): v = '#' + ''.join(c * 2 for c in v[1:])
    return v

def token_map(dashboard_src):
    block = re.search(r':root\{(.*?)\n  \}', dashboard_src, re.S).group(1)
    out = {}
    for name, val in re.findall(r'--([a-z0-9-]+)\s*:\s*([^;]+);', block):
        c = canon(val.strip())
        if c.startswith('#') or c.startswith('rgb'):
            out.setdefault(c, name)            # first name wins where two tokens share a value (hard = periwinkle)
    return out

def mask(s):
    out = list(s)
    for m in re.finditer(r'/\*.*?\*/|<!--.*?-->', s, re.S):
        for i in range(m.start(), m.end()):
            if out[i] != '\n': out[i] = ' '
    for m in re.finditer(r'(?m)^[ \t]*//[^\n]*', s):
        for i in range(m.start(), m.end()): out[i] = ' '
    return ''.join(out)

CSS_BEFORE = re.compile(r'(?:^|[;{\s"\'`(,])[a-z-]+\s*:\s*[^;"\'`{}<>=]*$')

def process(path, tokens, write):
    src = open(path, encoding='utf-8').read(); ms = mask(src)
    root = re.search(r':root\{.*?\n  \}', ms, re.S)
    lo, hi = (root.start(), root.end()) if root else (-1, -1)
    edits, left = [], {'bare-js-value': 0, 'svg-attribute': 0, 'other': 0}
    for m in COLOR.finditer(ms):
        c = canon(m.group(0)); tok = tokens.get(c)
        if not tok: continue
        i = m.start()
        if lo <= i < hi: continue
        line_start = ms.rfind('\n', 0, i) + 1
        if re.match(r'\s*--[\w-]+\s*:', ms[line_start:i]): continue       # a custom-property definition
        before = ms[max(line_start, i - 90):i]
        if before.endswith(("'", '"', '`')): left['bare-js-value'] += 1; continue
        if re.search(r'(fill|stroke|stop-color|flood-color|color)=\\?["\']?$', before): left['svg-attribute'] += 1; continue
        if CSS_BEFORE.search(before): edits.append((i, m.end(), f'var(--{tok})'))
        else: left['other'] += 1
    out = src
    for a, b, rep in reversed(edits): out = out[:a] + rep + out[b:]
    if write and edits: open(path, 'w', encoding='utf-8').write(out)
    return len(edits), left

def main():
    args = [a for a in sys.argv[1:]]
    write = '--write' in args; rep = None
    if '--report' in args: rep = args[args.index('--report') + 1]; args.remove('--report'); args.remove(rep)
    files = [a for a in args if not a.startswith('--')]
    dash = next((f for f in files if f.endswith(HERE_PAGE)), HERE_PAGE)
    tokens = token_map(open(dash, encoding='utf-8').read())
    report = {}
    for f in files:
        n, left = process(f, tokens, write)
        report[f] = {'rewritten': n, 'left': left}
        print(f'{f}: {n} literal(s) -> var(--token); left as literal: {left}')
    if rep: json.dump(report, open(rep, 'w'), indent=1)

if __name__ == '__main__': main()
