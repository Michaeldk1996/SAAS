#!/usr/bin/env python3
"""TEN-253 A(2) — the bridge that makes "import it, don't reimplement it" literal.

FOUNDER 2026-09-23: "Import the existing observation_key function from the
sweep. Don't reimplement it. This removes the Python-vs-JS key-mismatch failure
class entirely."

WHY A BRIDGE AND NOT A PLAIN IMPORT. The sweep lives in `archive-kibl.py`, with
a HYPHEN. `import archive-kibl` is a syntax error, so a hyphenated script is not
importable by name however much you want it to be. The three ways out are:

  1. rename the sweep                  -> touches the polling pipeline, which
                                          this task is explicitly told not to;
  2. copy the functions across          -> the exact reimplementation the ruling
                                          forbids, and the failure class the
                                          Python port exists to delete;
  3. load it by PATH.                   <- this file.

So the bridge is not a nicety. It is the only option that leaves the sweep
byte-for-byte untouched AND keeps one definition of a row key in the repo.

SAFE TO IMPORT. Both modules were checked for module-level side effects before
this was written: `archive-kibl.py` and `kibl_client.py` execute nothing at
import but constant assignments and function/class definitions — no env reads,
no network, no `die()`. Loading the sweep therefore cannot start a sweep, which
matters because rule (d) is that nothing here may disturb the poller.

⚠️ IF YOU ADD MODULE-LEVEL WORK TO archive-kibl.py, THIS IMPORT WILL RUN IT.
`test-consumer.py` asserts the no-side-effects property so that change fails
here rather than in production.
"""
import importlib.util
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
SWEEP_PATH = os.path.join(_ROOT, "archive-kibl.py")

# kibl_client is imported BY the sweep under its ordinary name, so the repo root
# has to be on the path before the sweep is loaded or the load fails on its own
# first import line.
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


def load_sweep():
    """The sweep module object, loaded from its file rather than by name."""
    if not os.path.exists(SWEEP_PATH):
        raise RuntimeError(
            f"the sweep is missing at {SWEEP_PATH}. The stream keys rows with the "
            "sweep's own function; without it there is no key to agree with, and "
            "guessing one is the archive-doubling failure this design exists to "
            "prevent. Refusing to continue."
        )
    spec = importlib.util.spec_from_file_location("kibl_sweep", SWEEP_PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["kibl_sweep"] = mod
    spec.loader.exec_module(mod)
    return mod


sweep = load_sweep()

# ── The names the stream borrows, and why each one ──────────────────────────
#
# row_key_of, NOT observation_key. ⚠️ THIS IS THE CORRECTION THAT MOTIVATES THE
# WHOLE PORT. The retired Node consumer wrote
#
#     row_key: observationKey(r)            // the raw "a|b|c|..." string
#
# while the sweep writes
#
#     "row_key": row_key_of(row)            # "nk_" + sha1(observation_key(row))
#
# Those two key spaces cannot collide — one is pipe-joined text, the other is a
# 3-char prefix plus 40 hex chars. `on_conflict=row_key,resolution=ignore-
# duplicates` would therefore have deduped NOTHING between the two writers: every
# streamed observation would have landed as a brand-new row beside the swept copy
# of the same price, first-sighting-wins would have quietly stopped holding, and
# `rows_new` would have read as a busy market. That is precisely the failure
# `py_str.mjs` was built to prevent — and it sat one layer ABOVE the layer that
# was guarded, where the byte-identical input was fed to a hash the Node side
# never applied. It never ran against the database, so no data was harmed.
row_key_of = sweep.row_key_of
to_summary = sweep.to_summary
state_of = sweep.state_of
num = sweep.num
observation_key = sweep.observation_key   # re-exported; the identity behind the hash


def _key_fields():
    """The field list observation_key() actually joins — DERIVED, never retyped.

    Read out of the function's own source with `ast`, because a hand-copied list
    is a second definition of the row identity, and the entire point of this
    bridge is that there is only one. If the sweep's key gains or loses a field,
    this follows it on the next import rather than disagreeing silently.

    Verified behaviourally by test-consumer.py: a row built from these names,
    with a unique value per name, must reproduce those values in that order in
    the real key. An AST read that drifted would fail that check.
    """
    import ast
    import inspect
    tree = ast.parse(inspect.getsource(observation_key).lstrip())
    for node in ast.walk(tree):
        if isinstance(node, (ast.Tuple, ast.List)):
            names = [e.value for e in node.elts if isinstance(e, ast.Constant)
                     and isinstance(e.value, str)]
            if len(names) == len(node.elts) and len(names) > 5:
                return tuple(names)
    raise RuntimeError(
        "could not read the key field list out of observation_key(). The stream "
        "will not guess it — a wrong field list is the archive-doubling failure "
        "this module exists to prevent."
    )


KEY_FIELDS = _key_fields()

TABLE_OBS = sweep.TABLE_OBS
# The refresh columns and the chunk size are the sweep's too — pass 2 must send
# exactly the columns the sweep sends, or a merge-duplicates pass would rewrite
# a column the archive is supposed to hold first-write-wins.
OBS_REFRESH_COLS = sweep.OBS_REFRESH_COLS
INSERT_CHUNK = sweep.INSERT_CHUNK
DENSE_WINDOW_MIN = sweep.DENSE_WINDOW_MIN
DENSE_POST_START_MIN = sweep.DENSE_POST_START_MIN
dense_fixture_count = sweep.dense_fixture_count

# Tennis, as the client already defines it. Re-derived here would be a second
# list to keep in step, which is the same mistake in a smaller font.
#
# ⚠️ KiblClient IS RE-EXPORTED FOR ITS ROW EXTRACTION, AND THAT IS NOT OPTIONAL.
# The first cut of the consumer imported the row KEY from the sweep and then
# hand-rolled the ENVELOPE UNWRAP beside it — the same reimplementation the
# ruling forbids, one layer over. MEASURED: on the nested shape
# `{result:[{fixture_id, participants:[...]}]}`, `market_participants()` yields
# 2 real price rows and the hand-rolled version yielded 1 row summarising the
# WRAPPER, with market_id/side_id/price_decimal all None — a row_key the sweep
# can never produce — and counted it a success. Both prices silently lost. An
# envelope keyed `markets` (one of the seven ENVELOPE_KEYS) yielded 0 rows and
# was counted `unreadable`. Import the extraction, not just the key.
from kibl_client import (  # noqa: E402
    TENNIS_LEAGUES_MEN, TENNIS_LEAGUES_WOMEN, KiblClient,
)

market_participants = KiblClient.market_participants
unrecognised_envelope = KiblClient.unrecognised_envelope
envelope_keys = KiblClient.ENVELOPE_KEYS

__all__ = [
    "sweep", "SWEEP_PATH", "row_key_of", "to_summary", "state_of", "num",
    "observation_key", "KEY_FIELDS", "TABLE_OBS", "OBS_REFRESH_COLS",
    "INSERT_CHUNK", "market_participants", "unrecognised_envelope",
    "KiblClient", "DENSE_WINDOW_MIN",
    "DENSE_POST_START_MIN", "dense_fixture_count", "TENNIS_LEAGUES_MEN",
    "TENNIS_LEAGUES_WOMEN",
]
