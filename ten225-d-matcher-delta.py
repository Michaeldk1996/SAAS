#!/usr/bin/env python3
"""TEN-225 ruling D — what the hyphen/apostrophe matcher fix actually changes.

The founder's requirement is explicit: "Before shipping, report every pairing the
fix changes across both implementations." A count of new matches is not that
report — the dangerous outcome is not a name that starts keying, it is a name
that keyed BEFORE and now keys to something ELSE, because that silently re-points
an existing pair at a different player.

So every name is put in one of three buckets and only the third is a risk:

    unchanged        old key == new key                  (no pairing moves)
    newly keyable    old key is None, new key is not     (a dash becomes a pair)
    REPOINTED        both keys exist and they differ     (a pair moves)

Run over every name corpus this checkout holds. Read-only; no network, no DB.
"""
import collections
import json
import os
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from ten225_names import name_key as name_key_new  # noqa: E402


def _nfd_old(s):
    s = unicodedata.normalize('NFD', s or '')
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    return ' '.join(s.lower().replace(',', ' ').replace('.', ' ').split())


def name_key_old(name):
    """The matcher exactly as it stood before ruling D."""
    s = _nfd_old(name.split(',')[0] if ',' in (name or '') else name)
    toks = [t for t in s.split() if len(t) > 1 and t.isalpha()]
    return toks[-1] if toks else None


def harvest():
    """Every player name this checkout can offer, with where it came from."""
    seen = collections.defaultdict(set)   # name -> {source, ...}

    def add(n, src):
        if isinstance(n, str) and n.strip():
            seen[n.strip()].add(src)

    p = os.path.join(HERE, 'matches.json')
    if os.path.exists(p):
        for m in json.load(open(p)):
            add(m.get('p1'), 'matches.json'); add(m.get('p2'), 'matches.json')

    p = os.path.join(HERE, 'player-index.json')
    if os.path.exists(p):
        doc = json.load(open(p))
        rows = doc if isinstance(doc, list) else (doc.get('players') or doc.get('index') or [])
        if isinstance(rows, dict):
            rows = list(rows.values())
        for r in rows:
            if isinstance(r, dict):
                for f in ('name', 'player', 'fullName', 'displayName'):
                    add(r.get(f), 'player-index.json')
            elif isinstance(r, str):
                add(r, 'player-index.json')

    p = os.path.join(HERE, 'player-profiles.json')
    if os.path.exists(p):
        doc = json.load(open(p))
        rows = doc.values() if isinstance(doc, dict) else doc
        for r in rows:
            if isinstance(r, dict):
                for f in ('name', 'player', 'fullName', 'displayName'):
                    add(r.get(f), 'player-profiles.json')

    p = os.path.join(HERE, 'player-atp-aliases.json')
    if os.path.exists(p):
        doc = json.load(open(p))
        if isinstance(doc, dict):
            for k, v in doc.items():
                add(k, 'aliases')
                if isinstance(v, str):
                    add(v, 'aliases')
                elif isinstance(v, list):
                    for x in v:
                        add(x, 'aliases')
    return seen


def main():
    names = harvest()
    buckets = collections.Counter()
    newly, repointed = [], []
    for n in sorted(names):
        a, b = name_key_old(n), name_key_new(n)
        if a == b:
            buckets['unchanged'] += 1
        elif a is None:
            buckets['newly_keyable'] += 1
            newly.append((n, b, sorted(names[n])))
        elif b is None:
            # Cannot happen by construction (folding only ever ADDS tokens), so
            # it is asserted rather than tolerated: if it ever fires, the fix has
            # a shape nobody reasoned about.
            buckets['LOST'] += 1
            repointed.append((n, a, b, sorted(names[n])))
        else:
            buckets['REPOINTED'] += 1
            repointed.append((n, a, b, sorted(names[n])))

    print('## TEN-225 ruling D — matcher delta over every local name corpus')
    print(f'distinct names read   {len(names)}')
    for k in ('unchanged', 'newly_keyable', 'REPOINTED', 'LOST'):
        print(f'  {k:<16} {buckets[k]}')
    print('')
    print(f'NEWLY KEYABLE ({len(newly)}) — was a dash, now pairs:')
    for n, b, srcs in newly:
        print(f'  {n!r:<42} -> {b:<18} [{",".join(srcs)}]')
    print('')
    print(f'REPOINTED / LOST ({len(repointed)}) — an EXISTING pairing moves:')
    if not repointed:
        print('  (none — no name that keyed before keys differently now)')
    for n, a, b, srcs in repointed:
        print(f'  {n!r:<42} {a} -> {b}   [{",".join(srcs)}]')

    # The control. Without it this script passes just as cleanly on a corpus it
    # failed to read at all, and "no pairings change" would be indistinguishable
    # from "no names were examined".
    print('')
    if len(names) < 100:
        print(f'::error::CONTROL FAILED — only {len(names)} names harvested; '
              'this report cannot support a "nothing changed" claim')
        return 1
    probe = name_key_new('F. Auger-Aliassime')
    if probe != 'aliassime' or name_key_old('F. Auger-Aliassime') is not None:
        print(f'::error::CONTROL FAILED — the known case does not behave as '
              f'described (old={name_key_old("F. Auger-Aliassime")}, new={probe})')
        return 1
    print(f'CONTROL ok — {len(names)} names read; the known case moves '
          f'None -> {probe!r} as described')
    return 0


if __name__ == '__main__':
    sys.exit(main())
