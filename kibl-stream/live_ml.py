"""Bet105's IN-PLAY match-winner prices for the live arbitrage (founder 2026-11-10).

Kibl publishes in-play prices (betting type 3, "Live Fluid") ONLY on the push
queue: measured 2026-11-10 12:17Z, /info/markets with betting_type_id=3 returned
no row for any sport while ATP Stockholm was in play, and this worker's own
counter had skipped 1.26 M in-play rows. The arbitrage worker (GitHub Actions)
cannot consume the queue — a second consumer would split the messages — so this
worker keeps the LATEST in-play row per player in `kibl_live_ml` and the
arbitrage worker reads it with the service key.

Kept: Bet105 (our feed), match winner (market type 1), full match (segment 1),
betting type 3, tennis ATP (league 19) or Challenger (537) by the routing key,
not superseded (`is_previous`). A suspended market is KEPT with its price as
sent (0 / null) and its market_status_id, so a reader sees the suspension
instead of the last real price lingering. Newer-only per side, by Kibl's
inserted_on, here and in the database.

Pure: no I/O. `accept()` takes a row, `drain()` returns the rows to upsert.
"""
import collections
from datetime import datetime

TENNIS_SPORT = 5
LEAGUES = (19, 537)          # ATP, Challenger
TABLE = "kibl_live_ml"


def routing_sport_league(key):
    """`get.info.markets.<?>.<sport>.<league>.…` -> (sport, league), or (None, None)."""
    parts = (key or "").split(".")
    if len(parts) < 6 or parts[:3] != ["get", "info", "markets"]:
        return None, None
    try:
        return int(parts[4]), int(parts[5])
    except ValueError:
        return None, None


def _ts(v):
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None


class LiveMl:
    def __init__(self, feed_source_id):
        self.fsid = feed_source_id
        self.latest = {}                         # (fixture, participant) -> inserted_on (datetime)
        self.dirty = {}                          # (fixture, participant) -> row to write
        self.count = collections.Counter()

    def accept(self, row, received_at, routing_key=None):
        if row.get("betting_type_id") != 3:
            return False
        if row.get("market_type_id") != 1 or row.get("segment_id") != 1:
            self.count["skip_not_match_winner"] += 1
            return False
        if row.get("feed_source_id") != self.fsid:
            self.count["skip_other_book"] += 1
            return False
        sport, league = routing_sport_league(row.get("routing_key") or routing_key)
        if sport != TENNIS_SPORT or league not in LEAGUES:
            self.count["skip_not_atp_challenger"] += 1
            return False
        if row.get("is_previous") is True:
            self.count["skip_previous"] += 1
            return False
        fid, fp, ins = row.get("fixture_id"), row.get("fixture_participant_id"), _ts(row.get("inserted_on"))
        if fid is None or fp is None or ins is None:
            self.count["skip_no_key"] += 1
            return False
        k = (int(fid), int(fp))
        held = self.latest.get(k)
        if held is not None and ins <= held:
            self.count["skip_not_newer"] += 1
            return False
        self.latest[k] = ins
        try:
            price = float(row.get("price_decimal"))
        except (TypeError, ValueError):
            price = None
        self.dirty[k] = {"fixture_id": k[0], "fixture_participant_id": k[1], "league_id": league,
                         "price": round(price, 3) if price is not None else None,
                         "market_status_id": row.get("market_status_id"),
                         "kibl_inserted_on": row.get("inserted_on"), "received_at": received_at}
        self.count["accepted"] += 1
        return True

    def drain(self):
        out, self.dirty = list(self.dirty.values()), {}
        return out

    def requeue(self, rows):
        """A failed write: put rows back unless a newer one arrived meanwhile."""
        for r in rows:
            k = (r["fixture_id"], r["fixture_participant_id"])
            self.dirty.setdefault(k, r)

    def summary(self):
        return {"sides": len(self.latest), "counts": dict(self.count)}
