"""Read-only access, for the line-summary loader, to the Pinnacle +30 payloads the post-start pull already holds.

Founder brief 2026-10-28 (line-summary capture): the line summary read only the oddspapi-raw bucket, which the daily
archive fills 24 h after a match at the earliest (its settle window), so the store ran 1.5–2 days behind the board.
The post-start pull (tools/pinarch.py `pull`, oddspapi-postmatch.yml) fetches the same /v4/historical-odds payload
for Pinnacle +30 within minutes of each ATP / Challenger start and stores it byte for byte in the Pinnacle archive's
raw table. This module only READS those rows (GET): same book, same feed, same payload — zero Oddspapi calls, and no
write path to the archive (tools/test-pinnacle-archive-guard.mjs scans this file for one).

`get(path)` is the loader's `sb_json` bound to its credentials: (list|None, err).
"""
import gzip
import json
import urllib.parse

TABLE = 'oddspapi_archive_raw'
SOURCE = 'oddspapi /v4/historical-odds'      # the post-start / backlog pull's rows (never the bucket imports)
BOOK = 'pinnacle+30'
PATH_PREFIX = 'archive-raw/'                 # object_path in the loader's object state: archive-raw/<raw row id>
# The pulls made after a start (post-start, backlog, a false-start re-cut). Never the back-fill (May-Sep fixtures pulled
# weeks later: the loader's 21-day rule would null every close, and the bucket already carries those fixtures).
TRIGGERS = ('post-start', 'backlog', 'false-start-recut')


def list_payloads(get, since_iso, page=1000):
    """The newest Pinnacle +30 post-start row per fixture pulled at or after `since_iso`, without payloads.
    Returns ({fixture_id: row}, err). Paged at PostgREST's 1,000-row cap and ordered, so no page repeats or skips."""
    out, offset = {}, 0
    while True:
        q = urllib.parse.urlencode({'select': 'id,fixture_id,pulled_at,books,meta', 'source': f'eq.{SOURCE}',
                                    'pulled_at': f'gte.{since_iso}', 'meta->>trigger': 'in.(' + ','.join(TRIGGERS) + ')',
                                    'order': 'id.asc', 'limit': page, 'offset': offset},
                                   quote_via=urllib.parse.quote)
        rows, err = get(f'/rest/v1/{TABLE}?{q}')
        if rows is None:
            return None, err
        for r in rows:
            if BOOK in (r.get('books') or []):
                out[r['fixture_id']] = r          # ordered by id: the last one seen is the newest pull
        if len(rows) < page:
            return out, None
        offset += page


def unhex(s):
    """PostgREST serves bytea as '\\x<hex>'."""
    return bytes.fromhex(s[2:]) if isinstance(s, str) and s.startswith('\\x') else bytes(s or b'')


def fetch_payload(get, row_id):
    """One stored payload, decoded to JSON. Returns (payload|None, err)."""
    rows, err = get(f'/rest/v1/{TABLE}?select=id,payload_gz&id=eq.{int(row_id)}')
    if rows is None:
        return None, err
    if len(rows) != 1:
        return None, (0, f'raw row {row_id}: {len(rows)} rows returned')
    try:
        blob = unhex(rows[0].get('payload_gz'))
        body = gzip.decompress(blob) if blob[:2] == b'\x1f\x8b' else blob
        return json.loads(body.decode('utf-8')), None
    except Exception as e:                      # noqa: BLE001 — reported by the caller
        return None, (0, f'unreadable: {type(e).__name__}')
