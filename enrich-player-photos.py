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


def wiki_photo(title):
    """Return a hotlink-safe Wikimedia photo URL for `title`, or None.

    Uses the Special:FilePath endpoint (proper image headers, allowed for
    hotlinking) instead of upload.wikimedia.org/thumb URLs, which Chrome's
    Opaque Response Blocking (ORB) rejects when embedded cross-origin.
    """
    t = urllib.parse.quote(title.replace(' ', '_'))
    url = f'https://en.wikipedia.org/api/rest_v1/page/summary/{t}'
    for attempt in range(4):
        try:
            j = get_json(url)
            if j.get('type') == 'disambiguation':
                return None, 'disambig'
            src = (j.get('originalimage') or {}).get('source') or (j.get('thumbnail') or {}).get('source')
            fname = commons_filename(src)
            photo = None
            if fname:
                photo = f'https://commons.wikimedia.org/wiki/Special:FilePath/{fname}?width=400'
            return photo, (j.get('description') or '')
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None, '404'
            if e.code == 429:
                time.sleep(2 + attempt * 2)
                continue
            return None, f'ERR{e.code}'
        except Exception:
            return None, 'ERR'
    return None, '429'


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
    resolved = skipped = missing = 0
    for k, abbr in keys.items():
        if k in existing and existing[k].get('photo'):
            skipped += 1
            continue
        try:
            j = get_json(f'https://api.api-tennis.com/tennis/?method=get_players&APIkey={key}&player_key={k}')
            res = j.get('result') or []
            full = res[0].get('player_full_name') if res else None
        except Exception:
            full = None
        photo, desc = (None, 'no-name')
        if full:
            photo, desc = wiki_photo(full)
            if not photo and desc in ('disambig', '404'):
                photo, desc = wiki_photo(full + ' (tennis)')
        if photo:
            out[k] = {'name': full, 'photo': photo}
            resolved += 1
            print(f'OK  {abbr:22s} {full}')
        else:
            missing += 1
            print(f'..  {abbr:22s} {full}  ({desc})')
        time.sleep(1.1)  # polite to Wikipedia

    with open(OUT, 'w') as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f'\nWrote {OUT}: {len(out)} photos total '
          f'(+{resolved} new, {skipped} cached, {missing} without a Wikipedia photo).')


if __name__ == '__main__':
    main()
