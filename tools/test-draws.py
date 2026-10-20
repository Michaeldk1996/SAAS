#!/usr/bin/env python3
"""Draw source (founder brief 2026-10-20, C12–C17) — parser, identity, builder, staleness, calendar.

Pinned inputs: six real official sheets (protennislive, fetched 2026-10-20) in tools/fixtures/draws/:
  9410 Almaty mds+qs · 7485 Brussels mds+qs (slot 17 "VAN DE ZANDSCHULP… NED", withdrawn seed 4) ·
  496 Lyon mds ("WC2" = wildcard + seed 2, entry "NG") · 5014 Shanghai mds (128, two halves).
Run: python3 tools/test-draws.py
"""
import copy, importlib.util, json, os, shutil, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
FX = os.path.join(HERE, "fixtures", "draws")
sys.path.insert(0, os.path.join(ROOT, "tools", "draws"))
P = 0
F = 0


def check(label, cond, detail=""):
    global P, F
    if cond:
        P += 1; print(f"  ok   {label}")
    else:
        F += 1; print(f"  FAIL {label}" + (f"\n       {detail}" if detail else ""))


print("Draw source — parser, identity, builder, staleness, calendar")
try:
    import fitz  # noqa: F401
except ImportError:
    print("FAIL: pymupdf is not installed — the draw parser cannot run (gate.yml installs pymupdf==1.26.5)")
    sys.exit(1)
import draw_parser as DP  # noqa: E402

spec = importlib.util.spec_from_file_location("build_draws", os.path.join(ROOT, "tools", "draws", "build-draws.py"))
B = importlib.util.module_from_spec(spec); spec.loader.exec_module(B)
pdf = lambda n: open(os.path.join(FX, n), "rb").read()

# ── C13/C14 · parser ──
al = DP.parse_sheet(pdf("9410-mds.pdf"))
S = al["slots"]
check("Almaty main: 32 of 32 slots, positions 1..32", al["size"] == 32 and [s["pos"] for s in S] == list(range(1, 33)))
check("Almaty: byes at slots 2, 10, 23, 31", [s["pos"] for s in S if s["bye"]] == [2, 10, 23, 31], [s["pos"] for s in S if s["bye"]])
check("Almaty: 8 seeds, Medvedev [1] slot 1, Darderi [2] slot 32", sum(s["seed"] is not None for s in S) == 8
      and S[0]["seed"] == 1 and S[0]["name"].startswith("MEDVEDEV") and S[31]["seed"] == 2 and S[31]["name"].startswith("DARDERI"))
check("Almaty: 4 Q + 3 WC", sum(s["entry"] == "Q" for s in S) == 4 and sum(s["entry"] == "WC" for s in S) == 3)
check("Almaty: truncated seeds completed from the sheet's own Seeded Players table",
      S[7]["name"] == "ETCHEVERRY, Tomas Martin" and S[7]["nameSource"] == "seeded-table" and S[16]["name"] == "TIRANTE, Thiago Agustin")
check("Almaty: no country is invented for neutral athletes (4 blank: Medvedev, Safiullin, Khachanov, Rublev)",
      sorted(s["name"].split(",")[0] for s in S if not s["bye"] and not s["ioc"]) == ["KHACHANOV", "MEDVEDEV", "RUBLEV", "SAFIULLIN"])
br = DP.parse_sheet(pdf("7485-mds.pdf"))
s17 = br["slots"][16]
check("Brussels main: 32 of 32 (the old parser dropped slot 17)", br["size"] == 32 and len(br["slots"]) == 32)
check("Brussels slot 17 = VAN DE ZANDSCHULP, Botic [7] NED", s17["seed"] == 7 and s17["name"] == "VAN DE ZANDSCHULP, Botic" and s17["ioc"] == "NED", s17)
check("Brussels: withdrawn seed 4 (Blockx) is on the seeded table, in no slot, marked inDraw=false",
      [x["seed"] for x in br["seeded"] if not x["inDraw"]] == [4])
check("Brussels: 3 lucky losers", sum(s["entry"] == "LL" for s in br["slots"]) == 3)
check("Brussels: an unseeded truncated name stays truncated + flagged (Cerundolo, slot 26)",
      br["slots"][25]["nameTruncated"] and br["slots"][25]["name"].endswith("…"))
ly = DP.parse_sheet(pdf("496-mds.pdf"))
check("Lyon: 'WC2' = wildcard AND seed 2 (Fritz, slot 32)", ly["slots"][31]["entry"] == "WC" and ly["slots"][31]["seed"] == 2 and ly["slots"][31]["name"].startswith("FRITZ"))
check("Lyon: entry code NG (Balshaw, slot 20)", ly["slots"][19]["entry"] == "NG")
sh = DP.parse_sheet(pdf("5014-mds.pdf"))
check("Shanghai: two-half 1000 sheet → 128 of 128 slots, 32 byes, 32 seeds",
      sh["size"] == 128 and sh["halves"] and sum(s["bye"] for s in sh["slots"]) == 32 and sum(s["seed"] is not None for s in sh["slots"]) == 32)
check("Shanghai: glued '27 BLOCKX' → seed 27; '126 Q' → slot 126 qualifier", sh["slots"][7]["seed"] == 27 and sh["slots"][125]["entry"] == "Q")
q = DP.parse_sheet(pdf("9410-qs.pdf"))
check("Almaty qualifying: 16 of 16, kind=qualifying", q["kind"] == "qualifying" and q["size"] == 16 and len(q["slots"]) == 16)

# C14 · a short sheet must fail, never publish 31 of 32
orig = DP.parse_slots
def drop17(page):
    return [s for s in orig(page) if s["pos"] != 17]
DP.parse_slots = drop17
try:
    DP.parse_sheet(pdf("7485-mds.pdf")); short = None
except DP.DrawParseError as e:
    short = str(e)
DP.parse_slots = orig
check("C14: 31 of 32 parsed → DrawParseError naming the missing slot", short is not None and "31 of 32" in short and "[17]" in short, short)
def noseed(page):
    out = orig(page)
    for s in out:
        if s["seed"] == 3: s["seed"] = None
    return out
DP.parse_slots = noseed
try:
    DP.parse_sheet(pdf("9410-mds.pdf")); err = None
except DP.DrawParseError as e:
    err = str(e)
DP.parse_slots = orig
check("a seed in no slot and not withdrawn → DrawParseError", err is not None and "seed 3" in err, err)

# ── identity ──
roster = {"players": [
    {"key": "2831", "name": "Jan-Lennard Struff", "country": "Germany"},
    {"key": "388", "name": "Manuel Cerundolo Juan", "country": "Argentina"},
    {"key": "1104", "name": "Francisco Cerundolo", "country": "Argentina"},
    {"key": "2972", "name": "Botic Van De Zandschulp", "country": "Netherlands"},
    {"key": "566", "name": "Alexander Shevchenko", "country": "Kazakhstan"},
    {"key": "9001", "name": "Alex Smith", "country": "USA"}, {"key": "9002", "name": "Alex Smith", "country": "United Kingdom"}]}
ix = B.build_roster_index(roster)
check("hyphenated given name: STRUFF, Jan-Lennard → 2831", B.resolve_key(ix, "STRUFF, Jan-Lennard", "GER") == ("2831", "surname+given"))
check("truncated given name as a prefix: CERUNDOLO, Juan Ma… → 388 (not Francisco)", B.resolve_key(ix, "CERUNDOLO, Juan Ma…", "ARG")[0] == "388")
check("fully truncated given name: a UNIQUE surname only", B.resolve_key(ix, "VAN DE ZANDSCHULP, …", "NED") == ("2972", "surname-only"))
check("a spelling variant is not bridged (Aleksandr ≠ Alexander) → None", B.resolve_key(ix, "SHEVCHENKO, Aleksandr", "KAZ")[0] is None)
check("comma-less cut surname: 'GUEYMARD WAYENBUR…' → the unique Gueymard Wayenburg", B.resolve_key(B.build_roster_index({"players": [
    {"key": "77", "name": "Sascha Gueymard Wayenburg", "country": "France"}, {"key": "78", "name": "Ugo Gueymard", "country": "France"}]}),
    "GUEYMARD WAYENBUR…", None) == ("77", "surname-prefix"))
check("two same-name players: country breaks the tie, else None",
      B.resolve_key(ix, "SMITH, Alex", "GBR")[0] == "9002" and B.resolve_key(ix, "SMITH, Alex", None)[0] is None)

# ── C12/C16 · builder: atomic, content-only writes, contentChangedAt carried ──
tmp = tempfile.mkdtemp()
pdfs = os.path.join(tmp, "pdfs"); os.makedirs(pdfs)
for n in ("9410-mds.pdf", "9410-qs.pdf", "7485-mds.pdf", "7485-qs.pdf", "496-mds.pdf"):
    shutil.copy(os.path.join(FX, n), pdfs)
cal = os.path.join(ROOT, "tools", "draws", "calendar-2026.json")
rost = os.path.join(tmp, "roster.json")
json.dump({"players": [{"key": "1093", "name": "Daniil Medvedev", "country": None}]}, open(rost, "w"))
out = os.path.join(tmp, "draws.json")
run = lambda *extra: subprocess.run([sys.executable, os.path.join(ROOT, "tools", "draws", "build-draws.py"), "--roster", rost,
                                     "--calendar", cal, "--pdf-dir", pdfs, "--today", "2026-10-20", "--out", out, *extra],
                                    capture_output=True, text=True)
r1 = run()
d1 = json.load(open(out)) if os.path.exists(out) else {}
check("builder: Almaty/Brussels/Lyon in window, 3 main draws posted, exit 0", r1.returncode == 0 and "3 main draw(s) posted" in r1.stdout, r1.stdout + r1.stderr)
check("draws.json carries no run timestamp (an unchanged draw can never make a commit)", "generatedAt" not in d1 and "builtAt" not in d1)
a1 = open(out, "rb").read(); m1 = os.stat(out).st_mtime_ns
r2 = run()
check("second run, same sheets → 'unchanged (not written)', bytes + mtime identical",
      "unchanged (not written)" in r2.stdout and open(out, "rb").read() == a1 and os.stat(out).st_mtime_ns == m1, r2.stdout)
check("Lyon qualifying sheet absent → status no_such_id, not an empty draw", d1["tournaments"]["496"]["qualifying"] == {"status": "no_such_id"})
check("player key resolved only where the roster has the player (Medvedev 1093; others null)",
      d1["tournaments"]["9410"]["main"]["slots"][0]["playerKey"] == "1093"
      and all(s["playerKey"] is None for s in d1["tournaments"]["9410"]["main"]["slots"][1:] if not s["bye"]))
changed_at = d1["tournaments"]["9410"]["contentChangedAt"]
shutil.copy(os.path.join(FX, "7485-mds.pdf"), os.path.join(pdfs, "9410-mds.pdf"))    # a different draw under Almaty's id
r3 = run()
d3 = json.load(open(out))
check("a content change rewrites + moves contentChangedAt for THAT event only",
      d3["tournaments"]["9410"]["contentHash"] != d1["tournaments"]["9410"]["contentHash"]
      and d3["tournaments"]["7485"]["contentChangedAt"] == d1["tournaments"]["7485"]["contentChangedAt"], r3.stdout)
open(os.path.join(pdfs, "7485-mds.pdf"), "wb").write(pdf("7485-mds.pdf")[:60000])      # a corrupt sheet
r4 = run()
d4 = json.load(open(out))
check("a sheet that will not parse → exit 1, and the previous good Brussels draw is kept",
      r4.returncode == 1 and d4["tournaments"]["7485"]["contentHash"] == d3["tournaments"]["7485"]["contentHash"], r4.stdout + r4.stderr)

# ── C16/C17 · staleness ──
spec2 = importlib.util.spec_from_file_location("check_draws", os.path.join(ROOT, "tools", "draws", "check-draws.py"))
C = importlib.util.module_from_spec(spec2); spec2.loader.exec_module(C)
calj = json.load(open(cal))
now = C.iso("2026-10-20T14:00:00Z")
board = [{"id": "past-1", "tour": "ATP Almaty", "date": "2026-10-20", "finalScore": {"display": "6-4 6-4"}, "finishedAt": "2026-10-20T10:00:00Z"},
         {"id": "upcoming-2", "tour": "ATP Lyon", "date": "2026-10-21"}]
good = copy.deepcopy(d3)
good["tournaments"]["496"]["contentChangedAt"] = good["tournaments"]["9410"]["contentChangedAt"] = "2026-10-20T11:00:00Z"
act, fails, _ = C.run(board, good, calj, now)
check("clean state: Almaty + Lyon active, 0 failures", sorted(act) == ["Almaty", "Lyon"] and fails == [], fails)
act, fails, _ = C.run(board, {"tournaments": {}}, calj, now)
check("F2 + F4: a started board tournament with no posted draw, and zero draws", any(f.startswith("F2 Almaty") for f in fails) and any(f.startswith("F4") for f in fails), fails)
stale = copy.deepcopy(good); stale["tournaments"]["9410"]["contentChangedAt"] = "2026-10-18T00:00:00Z"
check("F3: unchanged > 24 h while a match completed after the change", any(f.startswith("F3 Almaty") for f in C.run(board, stale, calj, now)[1]))
stale_quiet = copy.deepcopy(stale)
check("…but NOT when no match completed after it (a quiet draw is not stale)",
      not any(f.startswith("F3") for f in C.run([b for b in board if b["id"] != "past-1"], stale_quiet, calj, now)[1]))
check("F5: fetcher silent > 6 h in an active week (host asleep / job disabled)",
      any(f.startswith("F5") for f in C.run(board, good, calj, now, C.iso("2026-10-18T09:00:00Z"))[1]))
nolyon = copy.deepcopy(calj); nolyon["tournaments"] = [t for t in nolyon["tournaments"] if t["atpId"] != 496]
check("F1: a board tournament this week with no ATP id", any(f.startswith("F1 Lyon") for f in C.run(board, good, nolyon, now)[1]))
paris = [{"id": "past-9", "tour": "ATP Paris", "date": "2026-11-03", "finalScore": {"display": "6-4 6-4"}, "finishedAt": "2026-11-03T12:00:00Z"}]
pf = C.run(paris, {"tournaments": {}}, calj, C.iso("2026-11-03T14:00:00Z"))
check("board 'ATP Paris' finds the calendar's 2026 Rolex Paris Masters (city Nanterre) — F2, not a false F1",
      pf[0] == ["Paris"] and any(f.startswith("F2 Paris (352)") for f in pf[1]) and not any(f.startswith("F1") for f in pf[1]), pf)
act, fails, _ = C.run([], good, calj, now)
check("quiet week: nothing active → no failures (the CLI prints SKIP)", act == [] and fails == [])

# ── C15 · calendar ──
ids = {t["atpId"]: t for t in calj["tournaments"]}
check("calendar: Lyon = 496 (header-verified), Almaty 9410, Brussels 7485, Shanghai 5014 verified",
      all(ids.get(i, {}).get("verified") for i in (496, 9410, 7485, 5014)) and ids[496]["city"] == "Lyon", {i: ids.get(i) for i in (496,)})
check("calendar: Vienna 337 + Basel 328 from Wikidata P3456, unverified until a sheet prints the header",
      ids.get(337, {}).get("idSource", "").startswith("wikidata-P3456") and ids.get(328, {}).get("idSource", "").startswith("wikidata-P3456")
      and not ids[337]["verified"] and not ids[328]["verified"] and ids[337]["city"] == "Vienna" and ids[328]["city"] == "Basel")
check("calendar: no id is ever guessed — events without one are listed, not filled",
      "2026 Stockholm Open" in calj["articlesWithoutId"] and not any("Stockholm" in (t["article"] or "") for t in calj["tournaments"]))
check("calendar: non-empty (>= 40 events with an id)", len(calj["tournaments"]) >= 40, len(calj["tournaments"]))

# ── founder rulings 2026-10-20: draws.json published as data only, then the W/UE quarters + BYE rows APPROVED (ruling
#    7). So exactly ONE shipped reader: wue-sheet.js. The draw view is not approved yet — any other reader is a failure.
shipped = [f for f in subprocess.run(["git", "ls-files", "-z", "*.html", "*.js"], cwd=ROOT, capture_output=True, text=True).stdout.split("\0") if f]
readers = [f for f in shipped if not f.startswith(("tools/", "test", ".github/", ".")) and os.path.isfile(os.path.join(ROOT, f))
           and "draws.json" in open(os.path.join(ROOT, f), encoding="utf-8", errors="ignore").read()]
check("draws.json has exactly one shipped reader, wue-sheet.js (W/UE quarters, ruling 7); no draw view yet", readers == ["wue-sheet.js"], readers)

print(f"\n{P} passed, {F} failed")
sys.exit(1 if F else 0)
