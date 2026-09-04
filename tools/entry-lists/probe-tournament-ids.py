#!/usr/bin/env python3
"""
TEN-150: protennislive tournament-ID probe for the current week.

Scans a range of IDs (default 1–5000) in parallel to find which ones have
a valid mds.pdf or qs.pdf for the current calendar week, then prints the
findings so you can update tournaments.json.

Usage:
    python3 tools/entry-lists/probe-tournament-ids.py [--year 2026] [--lo 1] [--hi 5000] [--workers 30]

The current week is determined by checking the week_label field in each PDF
header against today's date — a tournament is "current" if its week_label
date range contains today or is within the next 7 days.

This is a probe/helper, not part of the daily cron. Run it once per week
to discover new tournament IDs, then commit the updated tournaments.json.
"""

import sys, re, os, json, datetime, argparse, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
BASE = "https://www.protennislive.com/posting/{year}/{tid}/{typ}.pdf"

MONTH_RE = re.compile(r'(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})')
MONTHS = {m: i+1 for i, m in enumerate([
    'January','February','March','April','May','June',
    'July','August','September','October','November','December'])}


def probe_pdf(year, tid, typ):
    url = BASE.format(year=year, tid=tid, typ=typ)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            if r.status != 200:
                return None
            data = r.read(8192)  # just enough for the header
            if not data.startswith(b'%PDF'):
                return None
            return data
    except Exception:
        return None


def extract_week_label(pdf_bytes):
    """Return the pipe-delimited header line from first 8KB or None."""
    try:
        import fitz
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        text = doc[0].get_text() if doc.page_count else ''
        doc.close()
        for ln in text.split('\n'):
            if '|' in ln and re.search(r'\d{4}', ln) and ('—' in ln or '-' in ln):
                return ln.strip()
    except Exception:
        pass
    return None


def parse_week_range(label):
    """Return (start_date, end_date) or None."""
    if not label:
        return None
    # "17 August — 22 August 2026 | ..."
    part = label.split('|')[0].strip()
    parts = re.split(r'[—–-]', part)
    if len(parts) < 2:
        return None
    try:
        end_str = parts[-1].strip()
        start_str = parts[0].strip()
        em = MONTH_RE.search(end_str)
        if not em:
            return None
        year = int(em.group(3))
        end_month = MONTHS[em.group(2)]
        end_day = int(em.group(1))
        sm = MONTH_RE.search(start_str)
        if sm:
            start_day = int(sm.group(1))
            start_month = MONTHS.get(sm.group(2), end_month)
            start_year = int(sm.group(3)) if sm.group(3) else year
        else:
            dm = re.search(r'(\d{1,2})\s*$', start_str)
            start_day = int(dm.group(1)) if dm else end_day
            start_month = end_month
            start_year = year
        return datetime.date(start_year, start_month, start_day), \
               datetime.date(year, end_month, end_day)
    except Exception:
        return None


def is_current_week(label, today, window_days=14):
    rng = parse_week_range(label)
    if not rng:
        return False
    start, end = rng
    # current if end >= today - window_days AND start <= today + window_days
    return end >= (today - datetime.timedelta(days=window_days)) and \
           start <= (today + datetime.timedelta(days=window_days))


def probe_id(year, tid, today):
    """Return dict or None."""
    for typ in ('mds', 'qs'):
        data = probe_pdf(year, tid, typ)
        if data:
            label = extract_week_label(data)
            current = is_current_week(label, today)
            return {'id': str(tid), 'typ': typ, 'week_label': label, 'current': current}
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--year', type=int, default=datetime.date.today().year)
    ap.add_argument('--lo', type=int, default=1)
    ap.add_argument('--hi', type=int, default=5000)
    ap.add_argument('--workers', type=int, default=30)
    ap.add_argument('--current-only', action='store_true', help='only print IDs for the current week')
    args = ap.parse_args()

    today = datetime.date.today()
    ids = range(args.lo, args.hi + 1)
    hits = []
    total = len(ids)
    done = 0

    print(f"Probing {total} IDs ({args.lo}–{args.hi}) for year {args.year}, "
          f"today={today}, workers={args.workers}", file=sys.stderr)

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(probe_id, args.year, tid, today): tid for tid in ids}
        for fut in as_completed(futs):
            done += 1
            if done % 500 == 0:
                print(f"  {done}/{total}…", file=sys.stderr)
            r = fut.result()
            if r:
                hits.append(r)
                flag = " *** CURRENT WEEK ***" if r['current'] else ""
                print(f"  HIT  id={r['id']:>5}  typ={r['typ']}  label={r['week_label']}{flag}")

    hits.sort(key=lambda h: int(h['id']))
    current = [h for h in hits if h['current']]
    print(f"\nTotal hits: {len(hits)}  |  Current-week: {len(current)}", file=sys.stderr)

    if current:
        print("\n--- tournaments.json snippet for current-week IDs ---")
        for h in current:
            lbl = (h['week_label'] or '').split('|')[0].strip()
            print(f'  {{ "tour": "ATP", "id": "{h["id"]}", "tier": "?", "note": "{lbl}" }},')

    out_path = os.path.join(HERE, 'probe-results.json')
    with open(out_path, 'w') as f:
        json.dump({'year': args.year, 'today': str(today), 'hits': hits}, f, indent=2)
    print(f"\nFull results -> {out_path}", file=sys.stderr)


if __name__ == '__main__':
    main()
