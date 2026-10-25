#!/usr/bin/env python3
"""draws.json — official ATP draws from protennislive (founder brief 2026-10-20, item C; terms approved by Michael).

    python3 tools/draws/build-draws.py --roster player-index.json [--board matches.json] [--today YYYY-MM-DD]
                                       [--pdf-dir DIR (offline: <id>-mds.pdf / <id>-qs.pdf)] [--out draws.json]

For every calendar event whose week is active (start − 9 days … end + 1 day) it fetches the main-draw (mds) and
qualifying (qs) sheets, parses them by position (draw_parser.py), resolves each player to our key, and writes
draws.json atomically — ONLY when the content changed (no run stamp in the file, so an unchanged draw never commits).

Fail-closed (exit 1, file untouched for that event): a sheet that parses to fewer slots than its draw size, a seed in
no slot without a withdrawal, a fetch error that is not a clean 404 / not-yet-posted placeholder.
"""
import argparse, datetime, hashlib, json, os, re, sys, tempfile, time, unicodedata, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import draw_parser  # noqa: E402

BASE = "https://www.protennislive.com/posting/{season}/{tid}/{typ}.pdf"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
PLACEHOLDER_BYTES = 2616      # protennislive's byte-identical "not yet posted" PDF (a real draw is >100 KB)
POLITE_S = 2.0

IOC_COUNTRY = {"ARG": "Argentina", "AUS": "Australia", "AUT": "Austria", "BEL": "Belgium", "BIH": "Bosnia and Herzegovina",
  "BRA": "Brazil", "BUL": "Bulgaria", "CAN": "Canada", "CHI": "Chile", "CHN": "China", "COL": "Colombia", "CRO": "Croatia",
  "CZE": "Czech Republic", "DEN": "Denmark", "ESP": "Spain", "FIN": "Finland", "FRA": "France", "GBR": "United Kingdom",
  "GEO": "Georgia", "GER": "Germany", "GRE": "Greece", "HKG": "Hong Kong", "HUN": "Hungary", "IND": "India", "ITA": "Italy",
  "JPN": "Japan", "KAZ": "Kazakhstan", "KOR": "South Korea", "MON": "Monaco", "NED": "Netherlands", "NOR": "Norway",
  "NZL": "New Zealand", "PAR": "Paraguay", "PER": "Peru", "POL": "Poland", "POR": "Portugal", "ROU": "Romania",
  "RSA": "South Africa", "SRB": "Serbia", "SLO": "Slovenia", "SUI": "Switzerland", "SVK": "Slovakia", "SWE": "Sweden",
  "TPE": "Chinese Taipei", "TUN": "Tunisia", "UKR": "Ukraine", "USA": "USA", "UZB": "Uzbekistan", "ECU": "Ecuador",
  "BOL": "Bolivia", "URU": "Uruguay", "MEX": "Mexico", "LTU": "Lithuania", "LAT": "Latvia", "EST": "Estonia", "CYP": "Cyprus",
  "ISR": "Israel", "TUR": "Turkey", "EGY": "Egypt", "MAR": "Morocco", "THA": "Thailand", "PHI": "Philippines", "IRL": "Ireland"}


# ---------------------------------------------------------------- identity
def _tok(s):
    # Split the ellipsis off BEFORE NFKD (which would turn "…" into "...") so a truncated word stays a clean prefix.
    parts = []
    for chunk in s.replace("…", " \x00 ").split():
        if chunk == "\x00":
            parts.append("…")
        else:
            parts.append(unicodedata.normalize("NFKD", chunk).encode("ascii", "ignore").decode().lower())
    return [t for t in parts if t]


def build_roster_index(roster):
    """roster: player-index.json {players:[{key,name,country}]} → list of (key, token-set incl. hyphen parts, country)."""
    out = []
    for p in roster.get("players", []):
        toks = set()
        for t in _tok(p.get("name") or ""):
            toks.add(t)
            toks.update(x for x in t.split("-") if x)
        if toks:
            out.append((str(p["key"]), toks, p.get("country")))
    return out


# Founder-approved aliases (exact sheet name + IOC → our key), each with its evidence. Checked BEFORE the token matcher;
# the matcher itself is never loosened (a spelling variant is not bridged automatically).
ALIASES = {
    # Approved 2026-10-20. Sheet (Almaty 2026 qs, slot 9, seed 3, KAZ, rank 111) "Aleksandr" = our 566 "Alexander
    # Shevchenko" (Kazakhstan): api-tennis 566 born 29.11.2000; Wikidata Q110287122 (both spellings resolve to it)
    # born 2000-11-29, ATP id S0H2; the only Shevchenko among 2,479 roster players.
    ("SHEVCHENKO, Aleksandr", "KAZ"): "566",
}


def resolve_key(index, pdf_name, ioc):
    """'SURNAME, Given' (possibly truncated with …) → (key, how) or (None, why). Never a guess: a unique token match only."""
    if not pdf_name:
        return None, "no-name"
    if (pdf_name.strip(), ioc) in ALIASES:
        return ALIASES[(pdf_name.strip(), ioc)], "alias"
    if "," not in pdf_name:
        if "…" not in pdf_name:
            return None, "no-name"
        # The sheet cut the name inside the surname, comma and given name gone ("GUEYMARD WAYENBUR…", Lyon 2026 qs):
        # every whole token must match a surname token, the cut one as a prefix; a UNIQUE roster player only.
        toks = [t for t in _tok(pdf_name) if t != "…"]
        whole, cut = toks[:-1], toks[-1] if toks else None
        cands = [(k, c) for k, rt, c in index if cut and all(t in rt for t in whole) and any(r.startswith(cut) for r in rt)]
        return (cands[0][0], "surname-prefix") if len(cands) == 1 else (None, "ambiguous" if cands else "not-in-roster")
    sur, given = pdf_name.split(",", 1)
    s_toks = [t for t in _tok(sur) if t != "…"]
    g_raw = _tok(given)
    truncated = "…" in given or pdf_name.rstrip().endswith("…")
    g_full = [t for t in g_raw if t != "…"]
    if truncated and g_full:                       # the last given token before … is a prefix ("Man…" → "man")
        g_prefix, g_exact = g_full[-1], g_full[:-1]
    else:
        g_prefix, g_exact = None, g_full

    def ok(toks):
        if not all(t in toks for t in s_toks):
            return False
        rest = toks - set(s_toks)
        if not all(g in rest or any(g in r.split("-") for r in rest) for g in g_exact):
            return False
        if g_prefix and not any(r.startswith(g_prefix) for r in rest):
            return False
        return True
    cands = [(k, c) for k, toks, c in index if ok(toks)]
    how = "surname+given" if g_full else "surname-only"
    if len(cands) == 1:
        return cands[0][0], how
    if len(cands) > 1 and ioc and IOC_COUNTRY.get(ioc):
        f = [k for k, c in cands if c == IOC_COUNTRY[ioc]]
        if len(f) == 1:
            return f[0], how + "+ioc"
    return None, ("ambiguous" if cands else "not-in-roster")


# ---------------------------------------------------------------- fetch
def fetch(season, tid, typ, pdf_dir=None):
    """→ ('posted', bytes, last_modified) | ('not_posted', None, None) | ('no_such_id', None, None). Raises on anything else."""
    if pdf_dir:
        p = os.path.join(pdf_dir, f"{tid}-{typ}.pdf")
        if not os.path.exists(p):
            return "no_such_id", None, None
        b = open(p, "rb").read()
        return ("not_posted", None, None) if len(b) == PLACEHOLDER_BYTES else ("posted", b, None)
    req = urllib.request.Request(BASE.format(season=season, tid=tid, typ=typ), headers={"User-Agent": UA})
    # Every request is logged (founder brief 2026-10-20 item 6: track cloud fetch failures per run). A block (403/429/5xx,
    # or a challenge page instead of a PDF) fails the run — never retried, never worked around.
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            b = r.read()
            lm = r.headers.get("Last-Modified")
            print(f"FETCH {tid}/{typ} {r.status} {len(b)}B last-modified={lm}")
    except urllib.error.HTTPError as e:
        print(f"FETCH {tid}/{typ} {e.code}")
        if e.code == 404:
            return "no_such_id", None, None
        raise RuntimeError(f"{tid}/{typ}: HTTP {e.code} — BLOCK/OUTAGE, run stopped")
    except urllib.error.URLError as e:
        print(f"FETCH {tid}/{typ} network-error {e.reason}")
        raise RuntimeError(f"{tid}/{typ}: network error {e.reason}")
    finally:
        time.sleep(POLITE_S)
    if not b.startswith(b"%PDF"):
        raise RuntimeError(f"{tid}/{typ}: not a PDF ({len(b)} bytes) — a challenge page? BLOCK, run stopped")
    if len(b) == PLACEHOLDER_BYTES:
        return "not_posted", None, None
    return "posted", b, lm


def sheet_entry(parsed, index, last_modified):
    slots = []
    for s in parsed["slots"]:
        key, how = (None, None)
        if not s["bye"]:
            key, how = resolve_key(index, s["name"], s["ioc"])
        slots.append({"pos": s["pos"], "seed": s["seed"], "seedRank": s.get("seedRank"), "entry": s["entry"],
                      "bye": s["bye"], "name": s["name"], "nameTruncated": s["nameTruncated"], "nameSource": s["nameSource"],
                      "ioc": s["ioc"], "playerKey": key, "keyMatch": how})
    return {"size": parsed["size"], "halves": parsed["halves"], "releasedLocal": parsed["releasedLocal"],
            "lastDirectAcceptance": parsed["lastDirectAcceptance"],
            "withdrawals": parsed["withdrawals"], "alternatesLuckyLosers": parsed["alternatesLuckyLosers"],
            "seeded": parsed["seeded"], "slots": slots}


def content_hash(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


def active(t, today):
    if not t.get("startDate") or not t.get("endDate"):
        return False
    s = datetime.date.fromisoformat(t["startDate"]) - datetime.timedelta(days=9)
    e = datetime.date.fromisoformat(t["endDate"]) + datetime.timedelta(days=1)
    return s <= today <= e


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--calendar", default=os.path.join(HERE, "calendar-2026.json"))
    ap.add_argument("--roster", required=True)
    ap.add_argument("--out", default=os.path.join(REPO, "draws.json"))
    ap.add_argument("--today")
    ap.add_argument("--pdf-dir")
    ap.add_argument("--only", help="comma-separated ATP ids (tests / probes)")
    a = ap.parse_args()
    today = datetime.date.fromisoformat(a.today) if a.today else datetime.datetime.now(datetime.timezone.utc).date()
    cal = json.load(open(a.calendar))
    index = build_roster_index(json.load(open(a.roster)))
    prev = json.load(open(a.out)) if os.path.exists(a.out) else {"tournaments": {}}
    now = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    only = set(a.only.split(",")) if a.only else None
    events = [t for t in cal["tournaments"] if (str(t["atpId"]) in only if only else active(t, today))]
    out = {"season": cal["season"], "source": "protennislive.com official ATP draw sheets (mds = main draw, qs = qualifying)",
           "tournaments": {}}
    # keep previous entries for events still in their window (a later, failed run never erases a good draw)
    for k, v in prev.get("tournaments", {}).items():
        out["tournaments"][k] = v
    errors = []
    for t in events:
        tid = str(t["atpId"])
        entry = {"atpId": t["atpId"], "article": t.get("article"), "city": t.get("city"), "category": t.get("category"),
                 "startDate": t.get("startDate"), "endDate": t.get("endDate"), "idVerified": t.get("verified", False)}
        try:
            for typ, field in (("mds", "main"), ("qs", "qualifying")):
                status, b, lm = fetch(cal["season"], tid, typ, a.pdf_dir)
                if status != "posted":
                    entry[field] = {"status": status}
                    continue
                parsed = draw_parser.parse_sheet(b)
                want = "main" if typ == "mds" else "qualifying"
                if parsed["kind"] != want:
                    raise draw_parser.DrawParseError(f"{typ}.pdf is a {parsed['kind']} sheet")
                entry["sheetHeader"] = entry.get("sheetHeader") or parsed["header"]
                entry[field] = {"status": "posted", **sheet_entry(parsed, index, lm)}
        except (draw_parser.DrawParseError, RuntimeError) as e:
            errors.append(f"{tid} {t.get('article')}: {e}")
            continue                                  # previous entry (if any) stays; this run fails below
        h = content_hash({k: v for k, v in entry.items() if k not in ("contentHash", "contentChangedAt")})
        old = prev.get("tournaments", {}).get(tid)
        entry["contentHash"] = h
        entry["contentChangedAt"] = old["contentChangedAt"] if old and old.get("contentHash") == h else now
        out["tournaments"][tid] = entry
    # drop events whose window closed more than 14 days ago (the file stays a working set, not an archive)
    for k in list(out["tournaments"]):
        e = out["tournaments"][k]
        if e.get("endDate") and datetime.date.fromisoformat(e["endDate"]) < today - datetime.timedelta(days=14):
            del out["tournaments"][k]
    changed = content_hash(out) != content_hash({k: v for k, v in prev.items()}) if prev.get("tournaments") is not None else True
    if changed:
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(a.out)), suffix=".tmp")
        with os.fdopen(fd, "w") as f:
            json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)
            f.write("\n")
        os.replace(tmp, a.out)
    posted = sum(1 for e in out["tournaments"].values() if (e.get("main") or {}).get("status") == "posted")
    print(f"draws: {len(events)} event(s) in window, {posted} main draw(s) posted, "
          f"{'written' if changed else 'unchanged (not written)'}, {len(errors)} error(s)")
    for e in errors:
        print("ERROR", e)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
