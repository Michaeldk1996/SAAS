#!/usr/bin/env python3
"""TEN-286 — remove CSS that can never apply, from the <style> blocks of a page.

Two mechanical classes, nothing else:
  1. a declaration overridden by a LATER top-level rule with the IDENTICAL selector list and the
     same property (unless the earlier one is !important and the later one is not);
  2. a custom-property definition (--name) that nothing references (no `var(--name` in the page,
     account.html or any shipped .js/.css), outside the 12a token block (the first :root).

Rules inside @media / @supports are never touched and never count as overriders. An emptied rule is
removed with its selector. Comments are preserved. Run twice: the second run removes nothing.

usage: tools/css-dead-declarations.py <page.html> [--write] [--report out.json]
Proof of "no visual change" is external (a per-element computed-style snapshot, identical before/after).
"""
import json, re, sys, glob, os

def scan_blocks(src):
    for m in re.finditer(r'<style[^>]*>', src):
        start = m.end(); end = src.index('</style>', start)
        yield start, end

def split_decls(body):
    """[(start, end, prop, value, important)] offsets relative to body; splits on ; outside quotes/parens."""
    out, i, n, depth, q, seg = [], 0, len(body), 0, None, 0
    while i <= n:
        c = body[i] if i < n else ';'
        if q:
            if c == '\\': i += 2; continue
            if c == q: q = None
        elif c in '"\'': q = c
        elif c == '(': depth += 1
        elif c == ')': depth -= 1
        elif c == ';' and depth == 0:
            txt = body[seg:i]
            # a declaration: skip leading comments/whitespace
            core = re.sub(r'/\*.*?\*/', lambda mm: ' ' * len(mm.group(0)), txt, flags=re.S)
            k = core.find(':')
            if k > 0 and core[:k].strip():
                prop = core[:k].strip().lower(); val = core[k + 1:].strip()
                imp = bool(re.search(r'!\s*important\s*$', val))
                out.append((seg, min(i + 1, n), prop, val, imp))
            seg = i + 1
        i += 1
    return out

def rules(css, base):
    """top-level rules: (sel_norm, body_start, body_end, rule_start) with absolute offsets"""
    res, i, n, depth, sel_start, body_start, q = [], 0, len(css), 0, 0, None, None
    at_depth = []  # stack of flags: is this brace an @-block?
    while i < n:
        c = css[i]
        if q:
            if c == '\\': i += 2; continue
            if c == q: q = None
        elif css.startswith('/*', i):
            e = css.find('*/', i + 2); i = (e + 2) if e >= 0 else n; continue
        elif c in '"\'': q = c
        elif c == '{':
            head = css[sel_start:i].strip()
            is_at = head.startswith('@')
            if depth == 0 and not is_at: body_start = i + 1; rule_head = (sel_start, head)
            at_depth.append(is_at); depth += 1
            if is_at or depth > 1: sel_start = i + 1
        elif c == '}':
            depth -= 1; was_at = at_depth.pop() if at_depth else False
            if depth == 0 and not was_at and body_start is not None:
                sel = re.sub(r'\s+', ' ', re.sub(r'/\*.*?\*/', '', rule_head[1], flags=re.S)).strip()
                res.append((sel, base + body_start, base + i, base + rule_head[0]))
                body_start = None
            sel_start = i + 1
        i += 1
    return res

def one_pass(src, root):
    """-> (new_src, report lines, dead declarations, emptied rules) for ONE pass"""
    # every place a custom property can be read (the page itself as it stands now)
    corpus = src + ''.join(open(f, encoding='utf-8', errors='ignore').read() for f in
        [os.path.join(root, 'account.html')] + glob.glob(os.path.join(root, '*.js')) + glob.glob(os.path.join(root, '*.css')) if os.path.exists(f))
    first_root = re.search(r':root\{.*?\n  \}', src, re.S)
    keep_lo, keep_hi = (first_root.start(), first_root.end()) if first_root else (-1, -1)
    all_rules = []
    for a, b in scan_blocks(src): all_rules += rules(src[a:b], a)
    decls = []  # (rule_idx, abs_start, abs_end, prop, important, sel, value)
    for ri, (sel, bs, be, rs) in enumerate(all_rules):
        for s, e, prop, val, imp in split_decls(src[bs:be]):
            decls.append((ri, bs + s, bs + e, prop, imp, sel, val))
    kill, why = set(), {}
    # 1. overridden by a later identical-selector rule
    last = {}
    for d in reversed(decls):
        key = (d[5], d[3])
        if key in last:
            later = last[key]
            if later[0] != d[0] and not (d[4] and not later[4]):
                kill.add((d[1], d[2])); why[(d[1], d[2])] = f'overridden later: {d[5]} {{ {d[3]} }}'
                continue
        if key not in last or not (d[4] and not last[key][4]): last[key] = d
    # 2. unreferenced custom properties (outside the 12a token block)
    for d in decls:
        if d[3].startswith('--') and not (keep_lo <= d[1] < keep_hi):
            if not re.search(r'var\(\s*' + re.escape(d[3]) + r'\s*[,)]', corpus.replace(src[d[1]:d[2]], '', 1)):
                kill.add((d[1], d[2])); why[(d[1], d[2])] = f'unreferenced custom property {d[3]} (in {d[5]})'
    # a rule whose every declaration is dead goes with its selector (exact span; nothing else is touched)
    by_rule = {}
    for d in decls: by_rule.setdefault(d[0], []).append((d[1], d[2]))
    spans = set(kill); removed_rules = 0
    for ri, ds in by_rule.items():
        if ds and all(x in kill for x in ds):
            sel, bs, be, rs = all_rules[ri]
            ls = src.rfind('\n', 0, rs) + 1
            if src[ls:rs].strip(): ls = rs                     # another rule shares the line: cut only this one
            le = src.find('\n', be + 1); le = len(src) if le < 0 else le
            end = (le + 1) if not src[be + 1:le].strip() and ls != rs else be + 1
            spans = {x for x in spans if not (rs <= x[0] < be + 1)}
            spans.add((ls, end))
            removed_rules += 1
    out = src
    for s_, e_ in sorted(spans, reverse=True): out = out[:s_] + out[e_:]
    return out, sorted(why.values()), len(kill), removed_rules

def main():
    page = sys.argv[1]; write = '--write' in sys.argv
    rep = sys.argv[sys.argv.index('--report') + 1] if '--report' in sys.argv else None
    src = open(page, encoding='utf-8').read(); root = os.path.dirname(os.path.abspath(page))
    report, nd, nr, passes = [], 0, 0, 0
    while True:                      # iterate to the fixed point: removing a reader can orphan a variable
        out, lines, d, r = one_pass(src, root)
        if not d and not r: break
        passes += 1; report += lines; nd += d; nr += r; src = out
    print(f'{page}: {nd} dead declarations, {nr} emptied rules removed ({passes} pass(es) to the fixed point)')
    if rep: json.dump(report, open(rep, 'w'), indent=1)
    if write: open(page, 'w', encoding='utf-8').write(src)

if __name__ == '__main__': main()
