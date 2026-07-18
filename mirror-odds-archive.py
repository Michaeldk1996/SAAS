#!/usr/bin/env python3
"""Mirror the tennis-data.co.uk season files into our own repo as a normalized archive.

tennis-data.co.uk is a *refresh source*, not a runtime dependency: this script pulls the
season workbooks, trims them to the columns the odds features need, and writes plain CSV
into odds-archive/. Everything downstream (build-odds-performance.js, CI) reads only those
CSVs, so a build never depends on the origin being up -- it was TCP-refused on 2026-07-18,
which is exactly the failure this indirection exists to absorb.

Sources, in order of preference:
  1. http://www.tennis-data.co.uk/{yyyy}/{yyyy}.zip   -- the origin
  2. raw.githubusercontent.com/nickdatak/Tennis-Match-Predictions/main/data/{yyyy}.{xls,xlsx}

Usage:
  python3 mirror-odds-archive.py              # refresh current + previous season
  python3 mirror-odds-archive.py --all        # rebuild the whole archive (2004-present)
  python3 mirror-odds-archive.py --years 2019 2020

Needs xlrd only for the pre-2013 .xls files (pip3 install --user xlrd). The .xlsx path is
parsed with the stdlib, so a current-season refresh needs no third-party module at all.
"""
import argparse
import csv
import io
import os
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import date, timedelta

ARCHIVE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'odds-archive')
FIRST_SEASON = 2004
ORIGIN = 'http://www.tennis-data.co.uk/{y}/{y}.zip'
MIRROR = 'https://raw.githubusercontent.com/nickdatak/Tennis-Match-Predictions/main/data/{y}.{ext}'

# Bookmaker columns seen across the eras. The set is not stable -- 2004 has CB/EX/IW,
# 2009 swaps in LB/SJ/UB, Max/Avg only start in 2012, Betfair Exchange only in 2025 -- so
# every lookup is by header name and a missing column is normal, not an error.
BOOKS = ['B365', 'PS', 'Max', 'Avg', 'EX', 'LB', 'SJ', 'UB', 'CB', 'IW', 'BFE']
PRICE_BOOKS = ['B365', 'PS', 'EX', 'LB', 'SJ', 'UB', 'CB', 'IW', 'BFE']  # real books, not aggregates

OUT_COLS = ['date', 'tournament', 'series', 'court', 'surface', 'round', 'bestof',
            'winner', 'loser', 'wrank', 'lrank', 'comment',
            'b365w', 'b365l', 'psw', 'psl', 'maxw', 'maxl', 'avgw', 'avgl', 'avgsrc']

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'


def _fetch(url, timeout=45):
    req = urllib.request.Request(url, headers={'User-Agent': 'bsp-consult-odds-mirror/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def download_season(year):
    """Return (bytes, ext, source) for a season workbook, trying origin then mirror."""
    try:
        blob = _fetch(ORIGIN.format(y=year))
        z = zipfile.ZipFile(io.BytesIO(blob))
        name = z.namelist()[0]
        return z.read(name), name.rsplit('.', 1)[-1].lower(), 'origin'
    except Exception as exc:
        print('  origin unavailable (%s) -- falling back to mirror' % type(exc).__name__)
    for ext in ('xlsx', 'xls'):
        try:
            return _fetch(MIRROR.format(y=year, ext=ext)), ext, 'mirror'
        except Exception:
            continue
    raise RuntimeError('no source produced a workbook for %s' % year)


def _col_letters(ref):
    return re.match(r'[A-Z]+', ref).group()


def _col_index(letters):
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def read_xlsx(blob):
    """Parse the first worksheet into (header, rows-as-lists) using only the stdlib."""
    z = zipfile.ZipFile(io.BytesIO(blob))
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        root = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in root.findall(NS + 'si'):
            shared.append(''.join(t.text or '' for t in si.iter(NS + 't')))
    sheet = sorted(n for n in z.namelist() if re.match(r'xl/worksheets/sheet\d+\.xml$', n))[0]
    root = ET.fromstring(z.read(sheet))
    out = []
    for row in root.iter(NS + 'row'):
        cells = {}
        for c in row.findall(NS + 'c'):
            t, v, istr = c.get('t'), c.find(NS + 'v'), c.find(NS + 'is')
            if t == 's' and v is not None:
                val = shared[int(v.text)]
            elif t == 'inlineStr' and istr is not None:
                val = ''.join(x.text or '' for x in istr.iter(NS + 't'))
            else:
                val = v.text if v is not None else None
            cells[_col_index(_col_letters(c.get('r')))] = val
        if cells:
            width = max(cells) + 1
            out.append([cells.get(i) for i in range(width)])
    return out[0], out[1:]


def read_xls(blob):
    """Pre-2013 seasons are BIFF8. xlrd is only imported on this path."""
    try:
        import xlrd
    except ImportError:
        raise SystemExit('pre-2013 seasons are .xls and need xlrd: pip3 install --user xlrd')
    book = xlrd.open_workbook(file_contents=blob)
    sheet = book.sheet_by_index(0)
    rows = [[sheet.cell_value(r, c) for c in range(sheet.ncols)] for r in range(sheet.nrows)]
    # Excel serial dates come back as floats; the Date column is resolved in normalize().
    return rows[0], rows[1:]


EXCEL_EPOCH = date(1899, 12, 30)  # Excel's off-by-two epoch, both .xls and .xlsx


def to_iso_date(val):
    if val is None or val == '':
        return ''
    s = str(val).strip()
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', s)
    if m:
        return m.group(0)
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{4})$', s)  # dd/mm/yyyy
    if m:
        return '%s-%02d-%02d' % (m.group(3), int(m.group(2)), int(m.group(1)))
    try:
        serial = float(s)
    except ValueError:
        return ''
    if serial <= 0:
        return ''
    return (EXCEL_EPOCH + timedelta(days=int(serial))).isoformat()


def clean_price(val):
    """Return a decimal price as a string, or '' -- odds below 1.01 are data errors."""
    if val is None or val == '':
        return ''
    try:
        f = float(str(val).strip())
    except ValueError:
        return ''
    if f < 1.01 or f > 1000:
        return ''
    return ('%.4f' % f).rstrip('0').rstrip('.')


def clean_text(val):
    if val is None:
        return ''
    s = str(val).strip()
    if re.match(r'^\d+\.0$', s):  # xlrd hands back numeric-looking cells as floats
        s = s[:-2]
    return re.sub(r'\s+', ' ', s)


def normalize(header, rows):
    idx = {}
    for i, name in enumerate(header):
        key = clean_text(name).lower()
        if key and key not in idx:
            idx[key] = i

    def cell(row, key):
        i = idx.get(key)
        if i is None or i >= len(row):
            return None
        return row[i]

    out, skipped = [], 0
    for row in rows:
        winner, loser = clean_text(cell(row, 'winner')), clean_text(cell(row, 'loser'))
        iso = to_iso_date(cell(row, 'date'))
        if not winner or not loser or not iso:
            skipped += 1
            continue

        prices = {b: (clean_price(cell(row, b.lower() + 'w')),
                      clean_price(cell(row, b.lower() + 'l'))) for b in BOOKS}

        # Max/Avg only exist from 2012 on. For earlier seasons derive them from the books
        # that season actually carried, and record which so the builder can tell them apart.
        avgw, avgl = prices['Avg']
        avgsrc = 'file'
        if not (avgw and avgl):
            pairs = [prices[b] for b in PRICE_BOOKS if prices[b][0] and prices[b][1]]
            if pairs:
                avgw = '%.4f' % (sum(float(w) for w, _ in pairs) / len(pairs))
                avgl = '%.4f' % (sum(float(l) for _, l in pairs) / len(pairs))
                avgw, avgl, avgsrc = avgw.rstrip('0').rstrip('.'), avgl.rstrip('0').rstrip('.'), 'computed'
            else:
                avgsrc = ''

        maxw, maxl = prices['Max']
        if not (maxw and maxl):
            pairs = [prices[b] for b in PRICE_BOOKS if prices[b][0] and prices[b][1]]
            if pairs:
                maxw = ('%.4f' % max(float(w) for w, _ in pairs)).rstrip('0').rstrip('.')
                maxl = ('%.4f' % max(float(l) for _, l in pairs)).rstrip('0').rstrip('.')

        out.append({
            'date': iso,
            'tournament': clean_text(cell(row, 'tournament')),
            'series': clean_text(cell(row, 'series')),
            'court': clean_text(cell(row, 'court')),
            'surface': clean_text(cell(row, 'surface')),
            'round': clean_text(cell(row, 'round')),
            'bestof': clean_text(cell(row, 'best of')),
            'winner': winner,
            'loser': loser,
            'wrank': clean_text(cell(row, 'wrank')),
            'lrank': clean_text(cell(row, 'lrank')),
            'comment': clean_text(cell(row, 'comment')),
            'b365w': prices['B365'][0], 'b365l': prices['B365'][1],
            'psw': prices['PS'][0], 'psl': prices['PS'][1],
            'maxw': maxw, 'maxl': maxl,
            'avgw': avgw, 'avgl': avgl, 'avgsrc': avgsrc,
        })
    out.sort(key=lambda r: (r['date'], r['tournament'], r['winner']))
    return out, skipped


def write_season(year, rows):
    os.makedirs(ARCHIVE_DIR, exist_ok=True)
    path = os.path.join(ARCHIVE_DIR, '%s.csv' % year)
    with open(path, 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=OUT_COLS, lineterminator='\n')
        w.writeheader()
        w.writerows(rows)
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--all', action='store_true', help='rebuild every season from %s' % FIRST_SEASON)
    ap.add_argument('--years', nargs='+', type=int)
    ap.add_argument('--today', help='ISO date to treat as today (defaults to the system clock)')
    args = ap.parse_args()

    today = date.fromisoformat(args.today) if args.today else date.today()
    if args.years:
        years = args.years
    elif args.all:
        years = list(range(FIRST_SEASON, today.year + 1))
    else:
        years = [today.year - 1, today.year]

    manifest, total = [], 0
    for year in years:
        print('%s ...' % year)
        blob, ext, source = download_season(year)
        header, rows = (read_xlsx if ext == 'xlsx' else read_xls)(blob)
        norm, skipped = normalize(header, rows)
        write_season(year, norm)
        priced = sum(1 for r in norm if r['avgw'] and r['avgl'])
        total += len(norm)
        manifest.append({'season': year, 'matches': len(norm), 'priced': priced,
                         'source': source, 'format': ext})
        print('  %5d matches, %5d priced (%.1f%%), %d skipped, via %s' %
              (len(norm), priced, 100.0 * priced / max(len(norm), 1), skipped, source))

    print('\n%d matches across %d season(s) -> %s' % (total, len(years), ARCHIVE_DIR))
    return 0


if __name__ == '__main__':
    sys.exit(main())
