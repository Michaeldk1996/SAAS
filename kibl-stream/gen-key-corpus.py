#!/usr/bin/env python3
"""Generate the cross-language key corpus from the REAL kibl_client function.

The Node consumer has to produce a row_key byte-identical to the sweep's, or the
ignore-duplicates insert stops deduping and the archive doubles. The only way to
test that honestly is to drive the ACTUAL Python function — not a description of
it in a comment, and not a fixture I typed out by hand and then matched the Node
side to, which tests nothing but my consistency.

Writes key-corpus.json next to this file. Re-run it whenever
kibl_client.observation_key() changes; test-consumer.mjs fails loudly if the
corpus is missing, so it cannot quietly stop testing the thing it is for.

Usage: python3 kibl-stream/gen-key-corpus.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from kibl_client import observation_key  # noqa: E402

# Every case is a value type that ACTUALLY occurs on a Kibl participant row, and
# each one is a place Python's str() and JS's String() disagree.
ROWS = [
    # A real row, shape taken from a live sweep.
    {"uuid": None, "market_id": 118291, "fixture_id": 728343,
     "fixture_participant_id": 1097925, "market_type_id": 1, "segment_id": 1,
     "side_id": 2, "point": None, "alt_id": 0, "feed_source_id": 171,
     "betting_type_id": 1, "is_opener": True, "is_previous": False,
     "is_current": True, "price_american": -145, "price_decimal": 1.69,
     "inserted_on": "2026-09-19T14:24:14.000Z"},
    # None everywhere -> "None", the single biggest divergence (JS says "null").
    {f: None for f in (
        "uuid", "market_id", "fixture_id", "fixture_participant_id",
        "market_type_id", "segment_id", "side_id", "point", "alt_id",
        "feed_source_id", "betting_type_id", "is_opener", "is_previous",
        "is_current", "price_american", "price_decimal", "inserted_on")},
    # Booleans both ways -> "True"/"False" (JS: "true"/"false").
    {"is_opener": False, "is_previous": True, "is_current": False,
     "fixture_id": 1, "price_decimal": 2.0},
    # An INTEGRAL float -> Python "2.0", JS "2". The case that bites on a book
    # quoting evens, and the reason the key reads the raw JSON lexeme.
    {"fixture_id": 2, "price_decimal": 2.0, "point": -1.5, "alt_id": 0},
    # A genuinely absent field (not present at all) must key the same as None.
    {"fixture_id": 3},
    # The suspension marker, which this whole thread is about.
    {"fixture_id": 4, "price_decimal": 0.0, "is_current": True},
    # Three decimals, which the archive really carries.
    {"fixture_id": 5, "price_decimal": 1.012, "price_american": -8300},
    # A large id, to prove the key survives the 2^53 question.
    {"fixture_id": 1200390774640370, "market_id": 1200390774640371},
    # A string where a number might be expected — PostgREST and some feeds do
    # this, and str() of a str is the str.
    {"fixture_id": "728343", "price_decimal": "1.69"},
]

# ⚠️ THE ROW IS STORED AS RAW JSON TEXT, NOT AS AN OBJECT, AND THAT IS THE
# WHOLE POINT. If the corpus stored a parsed object, reading it back in JS would
# turn 2.0 into 2 before the consumer ever saw it — the corpus would destroy the
# exact lexeme it exists to test, and the key test would fail against correct
# code. Caught by the test failing on case 3 with want "2.0" / got "2".
#
# json.dumps preserves Python's float repr ("2.0"), so the text handed to the
# consumer is byte-for-byte what a broker would send.
out = [{"row_json": json.dumps(r), "key": observation_key(r)} for r in ROWS]
path = os.path.join(HERE, "key-corpus.json")
with open(path, "w", encoding="utf-8") as fh:
    json.dump(out, fh, indent=1)
print(f"wrote {len(out)} case(s) -> {path}")
for c in out:
    print("  " + c["key"])
