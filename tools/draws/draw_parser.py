#!/usr/bin/env python3
"""Official ATP draw-sheet parser (protennislive mds.pdf / qs.pdf) — founder brief 2026-10-20, item C.

Reads the R1 column of the ATP Supervisor's released draw sheet BY POSITION (word coordinates), not by text order,
because text order glues fields together on real sheets:
    "27 BLOCKX, Alexander"           seed + name          (Shanghai 2026)
    "126 Q"                          slot + entry status  (Shanghai 2026)
    "AUGER-ALIASSIME, Felix CAN"     name + country       (Shanghai 2026)
    "VAN DE ZANDSCHULP… NED"         truncated name + IOC (Brussels 2026 slot 17 — the old parser dropped it)
Columns on every sheet seen (Almaty/Brussels 32, Shanghai 128 in two halves, qualifying 16):
    slot x≈19–27 · entry status x≈30–42 · seed x≈40–52 · name x≈52–136 · IOC x≈136–157 · round 2 starts x≥160.

Hard rules (never fabricate, never infer):
  * every slot 1..N must parse, N a power of two, or DrawParseError — no silent 31-of-32.
  * a truncated name ("…") is completed ONLY from the sheet's own Seeded Players table (same seed number);
    otherwise it stays truncated and flagged.
  * nothing is read from later rounds — positions come from the slot column only.
"""
import re

ENTRY_CODES = {"Q", "WC", "LL", "PR", "SE", "ALT", "SR", "ITF", "JR", "UP", "NG"}
# An entry code glued to a seed number: "WC2" = wildcard AND seed 2 (Lyon 2026 slot 32, Fritz).
ENTRY_SEED_RE = re.compile(r"^(" + "|".join(sorted(ENTRY_CODES, key=len, reverse=True)) + r")(\d{1,2})$")
IOC_RE = re.compile(r"^[A-Z]{3}$")
INT_RE = re.compile(r"^\d{1,3}$")
ELLIPSIS = "…"

SLOT_X = (0, 30)        # slot number column
ENTRY_X = (29, 43)      # Q / WC / LL / PR …
SEED_X = (39, 53)       # seed number
NAME_X = (52, 137)      # "SURNAME, First"
IOC_X = (118, 158)      # 3-letter country (x≈132 on Shanghai's bottom-half page, ≈138 elsewhere; absent for
                        # neutral athletes and on qualifying sheets, which print no country column)
R1_RIGHT = 158          # nothing of round 1 sits right of this; round 2 starts at x >= 160
ROW_TOL = 3.2           # same-row tolerance in points


class DrawParseError(Exception):
    pass


def _words(page):
    # (x0, y0, x1, y1, text, block, line, word); pymupdf returns duplicates for some overlaid text — dedupe.
    seen, out = set(), []
    for w in page.get_text("words"):
        k = (round(w[0], 1), round(w[1], 1), w[4])
        if k not in seen:
            seen.add(k)
            out.append(w)
    return out


def _in(x, rng):
    return rng[0] <= x < rng[1]


def _page_title(words):
    """'Main Draw Singles', 'Main Draw Singles (Top Half)', 'Qualifying Singles' … from the top-right title."""
    top = sorted([w for w in words if w[1] < 75 and w[0] > 300], key=lambda w: (round(w[1]), w[0]))
    return " ".join(w[4] for w in top if re.match(r"^[A-Za-z()]+$", w[4]))


def _draw_region(words):
    """y-range of the slot column: below the title block, above the bottom 'Round …' labels."""
    labels = [w for w in words if w[4] in ("Round", "Qualifying") and w[0] < 400 and w[1] > 300]
    bottom = min(w[1] for w in labels) if labels else 1e9
    return 70, bottom - 2


def parse_slots(page):
    """Slots on one page: [{pos, seed, entry, name, nameTruncated, ioc, bye}] in slot order."""
    W = _words(page)
    ylo, yhi = _draw_region(W)
    col = [w for w in W if ylo < w[1] < yhi and w[2] <= R1_RIGHT + 2]
    pos_words = [w for w in col if _in(w[0], SLOT_X) and INT_RE.match(w[4])]
    slots = []
    for pw in sorted(pos_words, key=lambda w: w[1]):
        y = pw[1]
        row = sorted([w for w in col if abs(w[1] - y) <= ROW_TOL and w is not pw and w[0] >= SLOT_X[1] - 1], key=lambda w: w[0])
        entry = seed = ioc = None
        name_parts = []
        for w in row:
            t = w[4]
            if t in ENTRY_CODES and _in(w[0], ENTRY_X):
                entry = t
            elif ENTRY_SEED_RE.match(t) and w[0] < NAME_X[0]:
                m = ENTRY_SEED_RE.match(t)
                entry, seed = m.group(1), int(m.group(2))
            elif INT_RE.match(t) and _in(w[0], SEED_X) and not name_parts:
                seed = int(t)
            elif IOC_RE.match(t) and _in(w[0], IOC_X):
                ioc = t
            elif _in(w[0], NAME_X) or (w[0] >= NAME_X[0] and w[2] <= IOC_X[0] + 2):
                name_parts.append(t)
        name = " ".join(name_parts).strip()
        bye = name == "Bye"
        truncated = (not bye) and (ELLIPSIS in name)
        # "VAN DE ZANDSCHULP…" can carry the ellipsis glued to the last word — keep the text, flag it.
        slots.append({
            "pos": int(pw[4]), "seed": seed, "entry": None if bye else entry,
            "name": None if bye else (name or None), "nameTruncated": truncated,
            "ioc": None if bye else ioc, "bye": bye,
        })
    return slots


SEEDED_LINE = re.compile(r"^(\d{1,2})\s+(.+?)$")


def parse_seeded_table(text):
    """{seed: {'name': 'Surname, First', 'rank': int|None}} from the sheet's 'Seeded Players' block."""
    out = {}
    i = text.find("Seeded Players")
    if i < 0:
        return out
    block = text[i:].split("\n")
    stop = ("Alternates", "Withdrawals", "Retirements", "Lucky", "Last Direct", "ATP Supervisor", "Released")
    lines = []
    for ln in block[1:]:
        s = ln.strip()
        if not s or s in ("Player", "Rank"):
            continue
        if s.startswith(stop):
            break
        lines.append(s)
    k = 0
    while k < len(lines):
        m = SEEDED_LINE.match(lines[k])
        if m and "," in m.group(2):
            rank = None
            if k + 1 < len(lines) and re.match(r"^\d{1,4}$", lines[k + 1]):
                rank = int(lines[k + 1]); k += 1
            out[int(m.group(1))] = {"name": m.group(2).strip(), "rank": rank}
        k += 1
    return out


def _block_after(text, head, stops):
    i = text.find(head)
    if i < 0:
        return []
    out = []
    for ln in text[i + len(head):].split("\n"):
        s = ln.strip()
        if not s:
            continue
        if any(s.startswith(x) for x in stops):
            break
        out.append(s)
    return out


def parse_sheet(pdf_bytes):
    """Parse one draw sheet (all pages). Raises DrawParseError unless slots 1..N are all present, N a power of 2."""
    import fitz  # pymupdf
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages = list(doc)
    if not pages:
        raise DrawParseError("empty PDF")
    full_text = "\n".join(p.get_text() for p in pages)
    titles = [_page_title(_words(p)) for p in pages]
    kind = "qualifying" if any("Qualifying" in t for t in titles) else "main" if any("Main Draw" in t for t in titles) else None
    if kind is None:
        raise DrawParseError(f"not a draw sheet (titles={titles})")
    slots = []
    for p in pages:
        slots.extend(parse_slots(p))
    by_pos = {}
    for s in slots:
        if s["pos"] in by_pos:
            raise DrawParseError(f"slot {s['pos']} parsed twice")
        by_pos[s["pos"]] = s
    n = max(by_pos) if by_pos else 0
    if n == 0 or n & (n - 1):
        raise DrawParseError(f"draw size {n} is not a power of two ({len(by_pos)} slots parsed)")
    missing = [p for p in range(1, n + 1) if p not in by_pos]
    if missing:
        raise DrawParseError(f"parsed {len(by_pos)} of {n} slots; missing {missing}")
    for s in by_pos.values():
        if not s["bye"] and not s["name"]:
            raise DrawParseError(f"slot {s['pos']} has neither a name nor Bye")
    seeded = parse_seeded_table(full_text)
    # Complete a truncated name ONLY from the same seed number on this sheet's own Seeded Players table.
    for s in by_pos.values():
        s["nameSource"] = "sheet"
        if s["nameTruncated"] and s["seed"] is not None and s["seed"] in seeded and ELLIPSIS not in seeded[s["seed"]]["name"]:
            full = seeded[s["seed"]]["name"]
            s["name"] = full.split(",")[0].upper() + "," + full.split(",", 1)[1]
            s["nameTruncated"] = False
            s["nameSource"] = "seeded-table"
    withdrawals = _block_after(full_text, "Withdrawals", ("Retirements", "Round of", "Seeded", "ATP Supervisor"))
    for seed, row in seeded.items():
        hit = [s for s in by_pos.values() if s["seed"] == seed]
        surname = row["name"].split(",")[0].strip().lower()
        withdrawn = any(surname in w.lower() for w in withdrawals)
        row["inDraw"] = len(hit) == 1
        if len(hit) == 1:
            hit[0]["seedRank"] = row["rank"]
        elif not (len(hit) == 0 and withdrawn):
            # A seed listed on the sheet but in no slot is only legitimate when the sheet also lists the withdrawal
            # (Brussels 2026: seed 4 Blockx, "A. Blockx (Ankle)"). Anything else is a parse fault.
            raise DrawParseError(f"seed {seed} ({row['name']}) sits in {len(hit)} slots and is not in Withdrawals")
    released = None
    m = re.search(r"Released\s*\n?\s*(\d{1,2}/\d{1,2}/\d{4}\s+\d{1,2}:\d{2}:\d{2})", full_text)
    if m:
        released = m.group(1)
    lda = _block_after(full_text, "Last Direct Acceptance", ("ATP Supervisor", "Released", "Seeded"))
    alts = _block_after(full_text, "Alternates/Lucky Losers", ("Withdrawals", "Retirements", "Seeded", "ATP Supervisor"))
    return {
        "kind": kind, "titles": titles, "size": n, "halves": len(pages) > 1,
        "slots": [by_pos[p] for p in range(1, n + 1)],
        "seeded": [{"seed": k, **v} for k, v in sorted(seeded.items())],
        "releasedLocal": released,  # as printed on the sheet (tournament-local clock, no zone on the sheet)
        "lastDirectAcceptance": lda[0] if lda else None,
        "withdrawals": withdrawals, "alternatesLuckyLosers": alts,
        "header": header_fields(full_text),
    }


def header_fields(text):
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    out = {"name": None, "city": None, "weekLabel": None, "surface": None}
    for i, l in enumerate(lines):
        m = re.match(r"^(\d{1,2} \w+ — \d{1,2} \w+ \d{4})\s*\|.*\|\s*(\w[\w ()]*)$", l)
        if m:
            out["weekLabel"], out["surface"] = m.group(1), m.group(2).strip()
            if i >= 2:
                out["name"], out["city"] = lines[i - 2], lines[i - 1].split(",")[0].strip()
            break
    return out
