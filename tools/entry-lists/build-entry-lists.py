#!/usr/bin/env python3
"""
TEN-150 Entry-Lists scraper v1  (protennislive PDF source).

Fetches per-tournament acceptance-list PDFs from protennislive.com, parses the
main-draw (mds.pdf) and qualifying (qs.pdf) singles lists into a clean, stable
JSON schema, normalises player names onto our internal player keys, and writes
entry_lists.json to the repo root -- but ONLY after the fail-closed QA gate
passes (build writes a temp file, runs qa_gate.validate, then atomically
os.replace()s the committed file; a bad scrape can never publish).

Source mechanics (confirmed):
    https://www.protennislive.com/posting/<YEAR>/<ID>/<TYPE>.pdf
      mds.pdf = Main Draw Singles      (acceptance list)
      qs.pdf  = Qualifying Singles      (acceptance list)
      ds.pdf  = tournament INFO sheet   (not parsed here)
    PDFs return HTTP 200 application/pdf to a browser User-Agent
    (Cloudflare only blocks the HTML pages, not the PDF assets).

Run:
    python3 tools/entry-lists/build-entry-lists.py
"""

import os
import sys
import re
import json
import tempfile
import datetime
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
TOURNAMENTS_JSON = os.path.join(HERE, "tournaments.json")
PROFILES_JSON = os.path.join(REPO_ROOT, "player-profiles.json")
OUT_JSON = os.path.join(REPO_ROOT, "entry_lists.json")

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
BASE = "https://www.protennislive.com/posting/{year}/{tid}/{typ}.pdf"

KNOWN_SURFACES = {"Hard", "Clay", "Grass", "Carpet"}

# IOC 3-letter -> full country name, spelled to match player-profiles.json.
# Covers the ~50 most common tennis nations; unmapped codes just fall back to
# a surname+initial-only match (country becomes a soft confirm).
IOC_TO_COUNTRY = {
    "ARG": "Argentina", "AUS": "Australia", "AUT": "Austria", "BEL": "Belgium",
    "BIH": "Bosnia and Herzegovina", "BOL": "Bolivia", "BRA": "Brazil",
    "BUL": "Bulgaria", "CAN": "Canada", "CHI": "Chile", "CHN": "China",
    "COL": "Colombia", "CRO": "Croatia", "CZE": "Czech Republic",
    "DEN": "Denmark", "DOM": "Dominican Republic", "ECU": "Ecuador",
    "EGY": "Egypt", "ESP": "Spain", "EST": "Estonia", "FIN": "Finland",
    "FRA": "France", "GBR": "United Kingdom", "GEO": "Georgia",
    "GER": "Germany", "GRE": "Greece", "HUN": "Hungary", "IND": "India",
    "ISR": "Israel", "ITA": "Italy", "JOR": "Jordan", "JPN": "Japan",
    "KAZ": "Kazakhstan", "KOR": "South Korea", "LAT": "Latvia",
    "LTU": "Lithuania", "MDA": "Moldova", "MEX": "Mexico", "MON": "Monaco",
    "NED": "Netherlands", "NOR": "Norway", "PER": "Peru", "POL": "Poland",
    "POR": "Portugal", "ROU": "Romania", "RSA": "South Africa",
    "RUS": "Russia", "SRB": "Serbia", "SUI": "Switzerland", "SVK": "Slovakia",
    "SLO": "Slovenia", "SWE": "Sweden", "TPE": "Chinese Taipei",
    "TUN": "Tunisia", "TUR": "Turkey", "UKR": "Ukraine", "URU": "Uruguay",
    "USA": "USA", "UZB": "Uzbekistan", "VEN": "Venezuela",
}

# Status entry-method tokens as they appear in the PDFs (may carry a trailing
# seed/alt number, e.g. "WC32", "Alt 2", "PR 29").
STATUS_TOKEN = re.compile(r"^(WC|Alt|LL|PR|SE|NG|Q)\s?(\d*)$")
# Same, but glued to the start of a name line, e.g. "WC32 RICE, Keegan".
STATUS_PREFIX = re.compile(r"^(WC|Alt|LL|PR|SE|NG|Q)\s?(\d*)$")
STATUS_MAP = {"WC": "WC", "Alt": "ALT", "LL": "LL", "PR": "PR",
              "SE": "SE", "NG": "NG", "Q": "Q"}
COUNTRY_RE = re.compile(r"^[A-Z]{3}$")
TRAIL_COUNTRY_RE = re.compile(r"\s([A-Z]{3})$")
INT_RE = re.compile(r"^\d+$")

# Lines that mark the end of the player-acceptance region.
STOP_PREFIXES = (
    "Qualifying Round", "Round of", "Quarterfinals", "Semifinals",
    "Final", "Winner", "Qualifier", "Last Direct Acceptance",
)

# --- week-date parsing (week_label -> start/end/weekStart) -------------------
MONTHS = {m: i + 1 for i, m in enumerate([
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"])}
_MONTH_RE = re.compile(
    r"(\d{1,2})\s+(January|February|March|April|May|June|July|August|"
    r"September|October|November|December)\s*(\d{4})?")


def parse_week_range(label):
    """'17 August — 22 August 2026 | ...' -> (start_date, end_date) or None."""
    if not label:
        return None
    part = label.split("|")[0].strip()
    parts = re.split(r"[—–-]", part)
    if len(parts) < 2:
        return None
    try:
        end_m = _MONTH_RE.search(parts[-1].strip())
        if not end_m:
            return None
        year = int(end_m.group(3)) if end_m.group(3) else datetime.date.today().year
        end = datetime.date(year, MONTHS[end_m.group(2)], int(end_m.group(1)))
        start_m = _MONTH_RE.search(parts[0].strip())
        if start_m:
            s_year = int(start_m.group(3)) if start_m.group(3) else year
            start = datetime.date(s_year, MONTHS[start_m.group(2)], int(start_m.group(1)))
        else:
            dm = re.search(r"(\d{1,2})", parts[0])
            start = datetime.date(year, end.month, int(dm.group(1))) if dm else end
        return start, end
    except Exception:
        return None


def week_monday(d):
    """Monday of the ISO week containing date d, as YYYY-MM-DD."""
    return (d - datetime.timedelta(days=d.weekday())).isoformat()


def pdf_published_at(data):
    """Best-effort source-publication timestamp from the PDF's own metadata.

    protennislive stamps each acceptance-list PDF with a modification date when
    it is (re)posted, so this is 'when the source last published', distinct from
    when our job ran. Returns an ISO-8601 string (UTC) or None.
    """
    try:
        import fitz
        doc = fitz.open(stream=data, filetype="pdf")
        meta = doc.metadata or {}
        doc.close()
        raw = meta.get("modDate") or meta.get("creationDate") or ""
        m = re.match(r"D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?", raw)
        if not m:
            return None
        y, mo, da = m.group(1), m.group(2), m.group(3)
        hh = m.group(4) or "00"
        mm = m.group(5) or "00"
        ss = m.group(6) or "00"
        return f"{y}-{mo}-{da}T{hh}:{mm}:{ss}Z"
    except Exception:
        return None


def log(*a):
    print(*a, file=sys.stderr)


def fetch_pdf(year, tid, typ):
    """Return (bytes, http_status). bytes is None on non-200."""
    url = BASE.format(year=year, tid=tid, typ=typ)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            if r.status != 200:
                return None, r.status
            return r.read(), 200
    except urllib.error.HTTPError as e:
        return None, e.code
    except Exception as e:  # network / timeout
        log("  fetch error", url, repr(e))
        return None, -1


def pdf_lines(data):
    import fitz
    doc = fitz.open(stream=data, filetype="pdf")
    lines = []
    for page in doc:
        for ln in page.get_text().split("\n"):
            ln = ln.replace("\xa0", " ").strip()
            if ln:
                lines.append(ln)
    doc.close()
    return lines


# protennislive serves a byte-identical 2616-byte placeholder PDF for a
# tournament whose acceptance list is not posted yet -- HTTP 200,
# Content-Type application/pdf, single line "-Tournament Information Not Yet
# Available-". It is NOT a real (empty) list; it must render as PENDING, never
# as MD 0. Detect it by its sentinel text (robust to minor byte changes).
PLACEHOLDER_SENTINEL = "information not yet available"


def is_placeholder_pdf(data):
    """True if the PDF is protennislive's 'not yet posted' placeholder."""
    if data is None:
        return False
    try:
        lines = pdf_lines(data)
    except Exception:
        return False
    if not lines:
        return True  # a contentless PDF is not a real acceptance list
    joined = " ".join(lines).lower()
    return PLACEHOLDER_SENTINEL in joined


# ---------------------------------------------------------------------------
# Header parsing
# ---------------------------------------------------------------------------
def parse_header(lines, seed_tier):
    """Return dict(name, city, country, week_label, surface, tier)."""
    name = city = country = week_label = surface = None
    tier = seed_tier
    pipe_idx = None
    for i, ln in enumerate(lines):
        # the week/prize/surface header line: contains an em-dash date range
        # and at least one pipe separator.
        if "|" in ln and ("—" in ln or "-" in ln) and re.search(r"\d", ln):
            parts = [p.strip() for p in ln.split("|")]
            if len(parts) >= 3 and any(m in parts[0] for m in
                                       ("January", "February", "March", "April",
                                        "May", "June", "July", "August",
                                        "September", "October", "November",
                                        "December")):
                pipe_idx = i
                week_label = parts[0]
                if len(parts) >= 3:
                    cand = parts[2]
                    if cand in KNOWN_SURFACES:
                        surface = cand
                if len(parts) >= 4 and parts[3]:
                    tier = parts[3]
                break
    if pipe_idx is not None:
        if pipe_idx - 2 >= 0:
            name = lines[pipe_idx - 2]
        if pipe_idx - 1 >= 0:
            city_line = lines[pipe_idx - 1]
            if "," in city_line:
                c, co = city_line.rsplit(",", 1)
                city, country = c.strip(), co.strip()
            else:
                city = city_line
    return {"name": name, "city": city, "country": country,
            "week_label": week_label, "surface": surface, "tier": tier}


# ---------------------------------------------------------------------------
# Name-line parsing
# ---------------------------------------------------------------------------
def parse_name_line(line):
    """
    Parse a player name-bearing line into (name, country, status, seed).
    Handles leading glued status/seed prefixes ("WC32 RICE, Keegan",
    "16 CERUNDOLO, Francisco", "Alt 26 DELLIEN, Hugo") and a trailing glued
    3-letter country code ("MELIGENI ALVES, Felipe BRA").
    """
    status = None
    seed = None
    country = None

    m = TRAIL_COUNTRY_RE.search(line)
    if m:
        country = m.group(1)
        line = line[:m.start()].rstrip()

    tokens = line.split(" ")
    i = 0
    while i < len(tokens) - 1:  # never consume the final token as a prefix
        t = tokens[i]
        if "," in t:
            break
        ms = STATUS_PREFIX.match(t)
        if ms:
            status = STATUS_MAP.get(ms.group(1), ms.group(1))
            if ms.group(2):
                seed = int(ms.group(2))
            i += 1
            # a status word can be followed by a standalone seed number
            if i < len(tokens) - 1 and INT_RE.match(tokens[i]) and \
                    "," not in tokens[i]:
                seed = int(tokens[i])
                i += 1
            continue
        if INT_RE.match(t):
            seed = int(t)
            i += 1
            continue
        break
    name = " ".join(tokens[i:]).strip()
    return name, country, status, seed


# ---------------------------------------------------------------------------
# Acceptance-region parsing (state machine)
# ---------------------------------------------------------------------------
def parse_players(lines, section_label_prefix):
    """
    Extract player rows from the acceptance region of a single PDF.
    Rows are position-anchored; between positions we may see a standalone seed,
    standalone status token, the name line, and an optional country line.
    """
    # find section start
    start = None
    for i, ln in enumerate(lines):
        if ln.startswith(section_label_prefix):
            start = i + 1
            break
    if start is None:
        return []

    players = []
    cur = None
    expected_pos = 1

    def finalize():
        nonlocal cur
        if cur is not None and (cur.get("name") or cur.get("status") == "BYE"):
            players.append(cur)
        cur = None

    i = start
    n = len(lines)
    while i < n:
        ln = lines[i]
        i += 1
        if any(ln.startswith(p) for p in STOP_PREFIXES):
            break

        # New position: a standalone integer, only when the current player
        # already has a name (or there is no current player).
        if INT_RE.match(ln):
            if cur is None or cur.get("name") is not None:
                finalize()
                cur = {"pos": int(ln), "seed": None, "status": None,
                       "name": None, "country": None}
                expected_pos = int(ln) + 1
                continue
            # standalone seed for the current (nameless) player
            if cur.get("seed") is None:
                cur["seed"] = int(ln)
                continue
            # fallback: treat as a new position
            finalize()
            cur = {"pos": int(ln), "seed": None, "status": None,
                   "name": None, "country": None}
            expected_pos = int(ln) + 1
            continue

        if cur is None:
            continue

        # Bye row
        if ln == "Bye":
            cur["name"] = "Bye"
            cur["status"] = "BYE"
            continue

        # standalone status token
        mt = STATUS_TOKEN.match(ln)
        if mt and cur.get("name") is None:
            cur["status"] = STATUS_MAP.get(mt.group(1), mt.group(1))
            if mt.group(2):
                cur["seed"] = int(mt.group(2))
            continue

        # standalone country code (follows a name)
        if COUNTRY_RE.match(ln):
            if cur.get("name") is not None and cur.get("country") is None:
                cur["country"] = ln
                continue
            # a 3-cap line with no name yet -> unusual; skip
            continue

        # name line (must carry a comma)
        if "," in ln and cur.get("name") is None:
            name, country, status, seed = parse_name_line(ln)
            cur["name"] = name
            if country and not cur.get("country"):
                cur["country"] = country
            if status and not cur.get("status"):
                cur["status"] = status
            if seed is not None and cur.get("seed") is None:
                cur["seed"] = seed
            continue
        # otherwise ignore stray line
    finalize()
    return players


def parse_seeded_section(lines):
    """
    Map seed# -> {'name','rank'} and surname_lc -> rank from Seeded Players.
    Handles both the glued single-line form ("1 Papoe, Radu Mihai 300", rank
    optionally on the next line) and the two-column split form where the seed
    number, name and rank each land on their own line ("9" / "Barranco Cosano,
    Javier" / "466").
    """
    by_num = {}
    by_surname = {}
    start = None
    for i, ln in enumerate(lines):
        if ln == "Seeded Players":
            start = i + 1
            break
    if start is None:
        return by_num, by_surname

    def flush(num, name, rank):
        if num is None or name is None:
            return
        by_num[num] = {"name": name, "rank": rank}
        surname = name.split(",")[0].strip().lower()
        if rank:
            by_surname[surname] = rank

    i = start
    pending_num = None
    pending_name = None
    while i < len(lines):
        ln = lines[i]
        i += 1
        if ln in ("Alternates", "Alternates/Lucky Losers", "Withdrawals",
                  "Retirements/W.O."):
            break
        if ln in ("Player", "Rank") or not ln:
            continue
        # glued form: "N Name..." optionally with trailing rank
        m = re.match(r"^(\d+)\s+(.+?)(?:\s+(\d{2,4}))?$", ln)
        if m and "," in m.group(2):
            num = int(m.group(1))
            nm = m.group(2).strip()
            rank = m.group(3)
            if rank is None and i < len(lines) and INT_RE.match(lines[i]):
                rank = lines[i]
                i += 1
            flush(num, nm, rank)
            pending_num = pending_name = None
            continue
        # split form: a bare seed number
        if INT_RE.match(ln):
            pending_num = int(ln)
            pending_name = None
            continue
        # split form: the name line following a bare seed number
        if "," in ln and pending_num is not None and pending_name is None:
            pending_name = ln.strip()
            rank = None
            if i < len(lines) and INT_RE.match(lines[i]):
                rank = lines[i]
                i += 1
            flush(pending_num, pending_name, rank)
            pending_num = pending_name = None
            continue
    return by_num, by_surname


def count_alternates(lines):
    """Count entries in the Alternates / Alternates-Lucky-Losers block."""
    start = None
    for i, ln in enumerate(lines):
        if ln in ("Alternates", "Alternates/Lucky Losers"):
            start = i + 1
            break
    if start is None:
        return 0
    cnt = 0
    for ln in lines[start:]:
        if ln in ("Withdrawals", "Retirements/W.O.", "Seeded Players"):
            break
        if "(" in ln and ")" in ln:  # "L. Ambrogi (Alt)"
            cnt += 1
    return cnt


# ---------------------------------------------------------------------------
# Player-key normalisation
# ---------------------------------------------------------------------------
def build_profile_index(profiles):
    """(surname_lc, first_initial) -> list of (key, country_full)."""
    idx = {}
    for key, p in profiles.get("players", {}).items():
        nm = (p.get("name") or "").strip()
        if not nm or "." not in nm:
            continue
        initial = nm.split(".", 1)[0].strip().upper()
        surname = nm.split(".", 1)[1].strip().lower()
        if not surname:
            continue
        idx.setdefault((surname, initial), []).append(
            (key, (p.get("country") or "").strip()))
    return idx


def normalise_key(profile_idx, pdf_name, ioc):
    """Match 'SURNAME, First' + IOC code onto our player key, or None."""
    if not pdf_name or "," not in pdf_name:
        return None
    surname = pdf_name.split(",")[0].strip().lower()
    first = pdf_name.split(",", 1)[1].strip()
    first = first.replace("…", "").strip()
    if not first:
        return None
    initial = first[0].upper()
    cands = profile_idx.get((surname, initial))
    if not cands:
        return None
    if len(cands) == 1:
        return cands[0][0]
    # disambiguate by country when the IOC code is known
    want = IOC_TO_COUNTRY.get(ioc) if ioc else None
    if want:
        filt = [c for c in cands if c[1] == want]
        if len(filt) == 1:
            return filt[0][0]
    return None


# ---------------------------------------------------------------------------
# Per-tournament build
# ---------------------------------------------------------------------------
def build_players(raw, seeded_by_num, seeded_by_surname, profile_idx):
    """Turn raw parsed rows into schema player dicts + enrich rank/name."""
    out = []
    for r in raw:
        name = r.get("name")
        seed = r.get("seed")
        status = r.get("status")
        country = r.get("country")

        if status == "BYE":
            out.append({"name": "Bye", "rank": None, "country": None,
                        "status": "BYE", "playerKey": None})
            continue
        if not name:
            continue

        # de-truncate + rank from the Seeded Players section
        rank = None
        if seed is not None and seed in seeded_by_num:
            se = seeded_by_num[seed]
            rank = se.get("rank")
            if "…" in name and se.get("name") and "," in se["name"]:
                name = se["name"]
        if rank is None:
            surname = name.split(",")[0].strip().lower()
            rank = seeded_by_surname.get(surname)

        # status resolution: entry method dominates; else SEED if seeded; else DA
        if not status:
            status = "SEED" if seed is not None else "DA"

        pk = normalise_key(profile_idx, name, country)
        out.append({
            "name": name,
            "rank": int(rank) if (rank and str(rank).isdigit()) else None,
            "country": country,
            "status": status,
            "playerKey": pk,
        })
    return out


def _week_fields(week_label, curated_week_start):
    """Return (startDate, endDate, weekStart) from a parsed label, falling back
    to the curated weekStart when the PDF carries no parseable date range."""
    rng = parse_week_range(week_label)
    if rng:
        start, end = rng
        return start.isoformat(), end.isoformat(), week_monday(start)
    if curated_week_start:
        return curated_week_start, None, curated_week_start
    return None, None, None


def _pending_record(t, reason):
    """A tournament we expect (from the curated map) but whose acceptance list
    protennislive has not posted yet: shown as PENDING, never as MD 0.

    reason records WHY it is pending, so the QA gate can distinguish a genuine
    not-yet-posted list (safe to publish as pending) from a parser regression:
      'placeholder' - HTTP 200 'not yet available' placeholder PDF (verified)
      'not_posted'  - both PDFs 404 (verified absent)
      'parse_empty' - a real PDF parsed to 0 players (SUSPICIOUS -> fail closed)
    """
    ws = t.get("weekStart")
    return {
        "tour": t.get("tour", "ATP"),
        "tournamentId": t["id"],
        "name": t.get("name"),
        "city": t.get("city"),
        "country": t.get("country"),
        "week_label": t.get("weekLabel"),
        "startDate": ws,
        "endDate": None,
        "weekStart": ws,
        "tier": t.get("tier"),
        "surface": t.get("surface"),
        "status": "pending",
        "pendingReason": reason,
        "sourcePublished": None,
        "counts": {"MD": 0, "Q": 0, "ALT": 0},
        "sections": [],
    }


def scrape_tournament(t, year, profile_idx):
    tid = t["id"]
    tour = t.get("tour", "ATP")
    seed_tier = t.get("tier")
    log(f"[{tour} {tid}] {t.get('note', t.get('name', ''))}")

    md_bytes, md_code = fetch_pdf(year, tid, "mds")
    qs_bytes, qs_code = fetch_pdf(year, tid, "qs")
    log(f"    mds={md_code} qs={qs_code}")

    # HTTP 200 but not-yet-posted placeholder -> treat as absent so the
    # pending path below fires (never a misleading active/MD 0 record).
    was_placeholder = False
    if is_placeholder_pdf(md_bytes):
        md_bytes = None
        was_placeholder = True
        log("    mds is not-yet-posted placeholder -> pending")
    if is_placeholder_pdf(qs_bytes):
        qs_bytes = None
        was_placeholder = True
        log("    qs is not-yet-posted placeholder -> pending")

    # 429 / transient fetch error: do NOT invent a pending row and do NOT drop
    # silently in a way the gate reads as a real absence -- surface as skipped
    # so a rate-limited run never publishes a misleading state.
    if md_bytes is None and qs_bytes is None:
        if 429 in (md_code, qs_code) or -1 in (md_code, qs_code):
            return None, {"id": tid, "reason": f"transient fetch fail (mds={md_code}, qs={qs_code}) -- SKIPPED, not pending"}
        # genuine 404 (or verified placeholder): the tournament is on our
        # curated map but protennislive has not posted its list yet -> render as
        # pending (dash, not zero).
        if t.get("name"):
            reason = "placeholder" if was_placeholder else "not_posted"
            return _pending_record(t, reason), None
        return None, {"id": tid, "reason": f"both PDFs 404 and no curated name (mds={md_code}, qs={qs_code})"}

    header = None
    sections = []
    md_lines = qs_lines = None
    counts = {"MD": 0, "Q": 0, "ALT": 0}
    alt_count = 0
    published = None

    if md_bytes is not None:
        md_lines = pdf_lines(md_bytes)
        header = parse_header(md_lines, seed_tier)
        published = pdf_published_at(md_bytes)
        sn, ss = parse_seeded_section(md_lines)
        raw = parse_players(md_lines, "Main Draw Singles")
        players = build_players(raw, sn, ss, profile_idx)
        counts["MD"] = len(players)
        alt_count = max(alt_count, count_alternates(md_lines))
        sections.append({"title": "Main Draw", "players": players})

    if qs_bytes is not None:
        qs_lines = pdf_lines(qs_bytes)
        if header is None:
            header = parse_header(qs_lines, seed_tier)
        if published is None:
            published = pdf_published_at(qs_bytes)
        sn, ss = parse_seeded_section(qs_lines)
        raw = parse_players(qs_lines, "Qualifying Singles")
        players = build_players(raw, sn, ss, profile_idx)
        counts["Q"] = len(players)
        alt_count = max(alt_count, count_alternates(qs_lines))
        sections.append({"title": "Qualifying", "players": players})

    counts["ALT"] = alt_count
    header = header or {"name": None, "city": None, "country": None,
                        "week_label": None, "surface": None, "tier": seed_tier}

    # curated map is the fallback for anything the PDF header didn't yield
    name = header["name"] or t.get("name")
    city = header["city"] or t.get("city")
    country = header["country"] or t.get("country")
    week_label = header["week_label"] or t.get("weekLabel")
    tier = header["tier"] or t.get("tier")
    surface = header["surface"] or t.get("surface")
    start_date, end_date, week_start = _week_fields(week_label, t.get("weekStart"))

    # Backstop: an "active" record with no players in either draw is exactly the
    # forbidden MD 0 state. If both PDFs parsed to zero players, the list is not
    # really posted -> emit PENDING, not active/0.
    if counts["MD"] == 0 and counts["Q"] == 0:
        log("    parsed 0 MD + 0 Q -> pending (no real list)")
        rec = _pending_record(t, "parse_empty")
        rec["name"] = name or rec["name"]
        rec["city"] = city or rec["city"]
        rec["country"] = country or rec["country"]
        rec["tier"] = tier or rec["tier"]
        rec["surface"] = surface or rec["surface"]
        rec["weekStart"] = week_start or rec["weekStart"]
        rec["startDate"] = start_date or rec["startDate"]
        return rec, None

    return {
        "tour": tour,
        "tournamentId": tid,
        "name": name,
        "city": city,
        "country": country,
        "week_label": week_label,
        "startDate": start_date,
        "endDate": end_date,
        "weekStart": week_start,
        "tier": tier,
        "surface": surface,
        "status": "active",
        "sourcePublished": published,
        "counts": counts,
        "sections": sections,
    }, None


def main():
    with open(TOURNAMENTS_JSON) as f:
        seed = json.load(f)
    year = seed.get("year", 2026)
    with open(PROFILES_JSON) as f:
        profiles = json.load(f)
    profile_idx = build_profile_index(profiles)
    log(f"loaded {len(profiles.get('players', {}))} player profiles "
        f"-> {len(profile_idx)} (surname,initial) keys")

    tournaments = []
    skipped = []
    for t in seed.get("tournaments", []):
        rec, skip = scrape_tournament(t, year, profile_idx)
        if rec is not None:
            tournaments.append(rec)
        if skip is not None:
            skipped.append(skip)

    published = [t.get("sourcePublished") for t in tournaments
                 if t.get("sourcePublished")]
    out = {
        "generatedAt": datetime.datetime.now(datetime.timezone.utc)
        .isoformat().replace("+00:00", "Z"),
        "source": "protennislive",
        "sourcePublished": max(published) if published else None,
        "tournaments": tournaments,
    }

    # ---- fail-closed publish: write temp, gate it, then atomically replace ----
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "qa_gate", os.path.join(HERE, "qa-gate.py"))
    qa_gate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(qa_gate)
    fd, tmp = tempfile.mkstemp(prefix="entry_lists.", suffix=".tmp",
                               dir=REPO_ROOT)
    with os.fdopen(fd, "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)

    ok, msg = qa_gate.validate(tmp)
    print(msg)
    if skipped:
        print("\nSKIPPED tournaments:")
        for s in skipped:
            print(f"  - {s['id']}: {s['reason']}")

    if not ok:
        os.remove(tmp)
        print("\nBUILD ABORTED: QA gate FAILED -> committed entry_lists.json "
              "left untouched.", file=sys.stderr)
        sys.exit(1)

    os.replace(tmp, OUT_JSON)
    print(f"\nPublished {OUT_JSON}")


if __name__ == "__main__":
    main()
