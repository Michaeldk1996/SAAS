#!/usr/bin/env python3
"""
Enrich player headshots with a fresher/higher-res source.

The pipeline (bsp-pipeline.js) stores API-Tennis logos in matches.json — these
exist for every player but are small/dated. This script resolves each player's
full name via API-Tennis get_players, looks up a current, freely-licensed photo
on Wikipedia, and writes an override map keyed by API-Tennis player_key:

    player-photos.json  ->  { "2072": {"name": "Jannik Sinner", "photo": "https://..."} , ... }

The dashboard prefers this photo, then falls back to the API-Tennis logo, then
to an initials circle — so coverage is never reduced. Run after the pipeline:

    python3 enrich-player-photos.py

Idempotent: existing resolved entries are kept; only unknown player_keys are
fetched, so re-runs are cheap and won't hammer Wikipedia.
"""
import json, os, sys, time, urllib.request, urllib.parse, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
MATCHES = os.path.join(HERE, 'matches.json')
OUT = os.path.join(HERE, 'player-photos.json')

UA = {'User-Agent': 'BSP-Consult-Dashboard/1.0 (tennis analytics dashboard)'}


def read_key():
    env = os.path.join(HERE, '.env')
    if not os.path.exists(env):
        return os.environ.get('API_TENNIS_KEY')
    for line in open(env):
        line = line.strip()
        if line.startswith('API_TENNIS_KEY='):
            return line.split('=', 1)[1].strip().strip('"').strip("'")
    return os.environ.get('API_TENNIS_KEY')


def get_json(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.load(r)


def commons_filename(source_url):
    """Extract the Commons file name from a upload.wikimedia.org URL.

    thumb form: .../commons/thumb/a/ab/File_name.jpg/330px-File_name.jpg
    orig  form: .../commons/a/ab/File_name.jpg
    We want 'File_name.jpg' (the segment right after the /a/ab/ hash dirs).
    """
    if not source_url:
        return None
    path = urllib.parse.urlparse(source_url).path
    parts = path.split('/')
    if 'thumb' in parts:
        i = parts.index('thumb')
        # thumb / a / ab / File.jpg / 330px-File.jpg  -> File.jpg is i+3
        if len(parts) > i + 3:
            return parts[i + 3]
    return parts[-1] if parts else None


def _get_json_retry(url, tries=4):
    """GET url as JSON with backoff on 429/transient errors. Returns (json, err)."""
    for attempt in range(tries):
        try:
            return get_json(url), None
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None, '404'
            if e.code == 429:
                time.sleep(2 + attempt * 2)
                continue
            return None, f'ERR{e.code}'
        except Exception:
            time.sleep(1 + attempt)
    return None, '429'


def qid_for(name):
    """Resolve a player name to a Wikidata QID.

    Primary: the English Wikipedia page summary's `wikibase_item` — this reuses
    Wikipedia's redirect/typo resolution so we land on the right person. Fallback
    (for disambiguation pages like "Tommy Paul"): wbsearchentities constrained to
    a hit whose description mentions tennis. Returns (qid, via) or (None, reason).
    """
    t = urllib.parse.quote(name.replace(' ', '_'))
    j, err = _get_json_retry(f'https://en.wikipedia.org/api/rest_v1/page/summary/{t}')
    if j and j.get('type') != 'disambiguation' and j.get('wikibase_item'):
        return j['wikibase_item'], 'summary'
    # Disambiguation or no page → search Wikidata, keep the tennis human.
    time.sleep(0.2)
    q = urllib.parse.quote(name)
    js, err2 = _get_json_retry(
        f'https://www.wikidata.org/w/api.php?action=wbsearchentities&search={q}'
        f'&language=en&type=item&limit=6&format=json')
    if js:
        for hit in (js.get('search') or []):
            desc = (hit.get('description') or '').lower()
            if 'tennis' in desc:
                return hit.get('id'), 'wbsearch'
    return None, (err or 'no-qid')


def p18_filename(qid):
    """Return the Commons file name from the Wikidata P18 (image) claim, or None."""
    j, err = _get_json_retry(
        f'https://www.wikidata.org/w/api.php?action=wbgetentities&ids={qid}'
        f'&props=claims&format=json')
    if not j:
        return None, err or 'no-entity'
    claims = (((j.get('entities') or {}).get(qid) or {}).get('claims') or {})
    p18 = claims.get('P18') or []
    if not p18:
        return None, 'no-P18'
    val = ((p18[0].get('mainsnak') or {}).get('datavalue') or {}).get('value')
    return (val, 'P18') if val else (None, 'no-P18-val')


def commons_verify(fname):
    """Check the Commons file via imageinfo. Returns 'ok' | 'missing' | 'unknown'.

    Advisory only — the embedded <img> src is always built as a Special:FilePath
    URL (the upload.wikimedia thumburl imageinfo returns is rejected by Chrome ORB
    when hotlinked cross-origin). Crucially, a transient imageinfo error / 429
    returns 'unknown', NOT 'missing', so it never downgrades a valid Wikidata P18
    file to a monogram — only a definitive page-level "missing" does that. The
    render's onerror still swaps to the monogram for a genuinely dead file.
    """
    f = urllib.parse.quote('File:' + fname)
    j, err = _get_json_retry(
        f'https://commons.wikimedia.org/w/api.php?action=query&titles={f}'
        f'&prop=imageinfo&iiprop=url&format=json')
    if not j:
        return 'unknown'
    pages = (j.get('query') or {}).get('pages') or {}
    for pg in pages.values():
        if pg.get('imageinfo'):
            return 'ok'
        if 'missing' in pg:            # MediaWiki stamps `missing:""` for a nonexistent file
            return 'missing'
    return 'unknown'


def wiki_photo(name):
    """Resolve `name` to a hotlink-safe Commons photo URL via Wikidata P18.

    Stages: name → QID (Wikipedia summary / tennis-constrained wbsearch) →
    P18 Commons filename → imageinfo existence check → Special:FilePath URL.
    Returns (photo_url_or_None, stage_note).
    """
    qid, via = qid_for(name)
    if not qid:
        return None, via  # 'disambig' resolves here as 'no-qid' unless wbsearch caught it
    time.sleep(0.2)
    fname, note = p18_filename(qid)
    if not fname:
        return None, f'{qid}:{note}'
    time.sleep(0.2)
    verdict = commons_verify(fname)      # 'ok' | 'missing' | 'unknown'
    if verdict == 'missing':
        return None, f'{qid}:file-missing'
    quoted = urllib.parse.quote(fname.replace(' ', '_'))
    note = f'{via}/P18' + ('' if verdict == 'ok' else '/unverified')
    return f'https://commons.wikimedia.org/wiki/Special:FilePath/{quoted}?width=400', note


def main():
    key = read_key()
    if not key:
        print('ERROR: API_TENNIS_KEY not found (.env or environment).', file=sys.stderr)
        sys.exit(1)

    matches = json.load(open(MATCHES))
    keys = {}
    for m in matches:
        if m.get('p1Key') is not None:
            keys[str(m['p1Key'])] = m.get('p1')
        if m.get('p2Key') is not None:
            keys[str(m['p2Key'])] = m.get('p2')

    existing = {}
    if os.path.exists(OUT):
        try:
            existing = json.load(open(OUT))
        except Exception:
            existing = {}

    out = dict(existing)

    # Persist after every newly-resolved player, not once at the very end. A
    # killed run (rate-limit backoff, setsid/waiter death on macOS) otherwise
    # loses everything it resolved — the file is only written after the whole
    # loop finishes. Atomic temp+replace so a crash mid-write can't corrupt it.
    def flush():
        tmp = OUT + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(out, f, indent=2, ensure_ascii=False)
        os.replace(tmp, OUT)

    resolved = skipped = missing = 0
    for k, abbr in keys.items():
        if k in existing and existing[k].get('photo'):
            skipped += 1
            continue
        # Canonical full name: prefer API-Tennis get_players, fall back to the
        # name already in matches.json so a get_players hiccup never drops a
        # player. Name resolution only — the photo itself is Wikidata P18.
        try:
            j = get_json(f'https://api.api-tennis.com/tennis/?method=get_players&APIkey={key}&player_key={k}')
            res = j.get('result') or []
            full = (res[0].get('player_full_name') if res else None) or abbr
        except Exception:
            full = abbr
        photo, desc = (None, 'no-name')
        if full:
            photo, desc = wiki_photo(full)
        if photo:
            out[k] = {'name': full, 'photo': photo}
            resolved += 1
            flush()   # incremental persist — a kill here keeps everything resolved so far
            print(f'OK  {abbr:22s} {full}  [{desc}]')
        else:
            missing += 1
            print(f'..  {abbr:22s} {full}  ({desc})')
        time.sleep(0.6)  # space out Wikimedia calls to stay under the anon 429 limit

    flush()   # final write (also covers a run that resolved nothing new)
    print(f'\nWrote {OUT}: {len(out)} photos total '
          f'(+{resolved} new, {skipped} cached, {missing} without a Wikipedia photo).')


if __name__ == '__main__':
    main()
