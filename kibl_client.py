#!/usr/bin/env python3
"""TEN-232 — shared KIBL (Bet105) API client.

Auth is AWS Cognito USER_PASSWORD_AUTH, not an API key: POST to the Cognito
IDP endpoint with USERNAME/PASSWORD/ClientId, get back a 60-minute Bearer
AccessToken. There is one Production environment and no sandbox, so every call
this module makes is a real call against the live feed.

Three things this module exists to get right, because each of them fails
SILENTLY (HTTP 200, plausible-looking but wrong data):

  1. `is_current` defaults to TRUE on /info/markets. A naive pull therefore
     returns the current price only and silently drops the opener and the
     previous state — the exact two rows an archive exists to preserve.
     `markets_three_state()` is the only sanctioned way to read markets.

  2. Entitlement is a Cognito user attribute, not an endpoint. A restricted
     account returns 200 with fewer rows, never a 403. Anything measured here
     is therefore a measurement of OUR ENTITLEMENT, not of Kibl's coverage.

  3. Credentials arrive as GitHub Actions secrets and a trailing newline on a
     secret has already broken one integration on this repo (BetsAPI). Every
     credential read goes through .strip().

Nothing in here ever prints a credential or a token.
"""

import base64
import json
import os
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request

COGNITO_URL = "https://cognito-idp.us-west-2.amazonaws.com/"
BASE_URL = "https://api.kibl.io/sports/get"

# Published in Kibl's own tutorial in plaintext, so it is not a secret. Read
# from the environment when present so it can be rotated without a code change.
DEFAULT_CLIENT_ID = "3udv7qsqgju8c4riqvk72bqcl"

# Conservative by ruling: Kibl documents NO rate limit, quota or 429 anywhere,
# and "no documented limit" is not the same as "no limit". Until Bet105 answers,
# we pace ourselves rather than discover the ceiling by hitting it.
MIN_INTERVAL_S = 1.25

# Documented hard caps (exceeding these is a 413, not a truncation).
MAX_LEAGUE_IDS = 15
MAX_FEED_SOURCE_IDS = 10

# Men's leagues only (founder ruling 2026-09-17). WTA 20, WTA-125K 643 and
# ITF-W 963 are deliberately out of the archive even if we are entitled to them.
TENNIS_LEAGUES_MEN = {19: "ATP", 537: "Challenger", 962: "ITF Men"}
TENNIS_LEAGUES_WOMEN = {20: "WTA", 643: "WTA 125K", 963: "ITF Women"}


class KiblError(RuntimeError):
    def __init__(self, status, body, url):
        self.status = status
        self.body = body
        self.url = url
        super().__init__(f"HTTP {status} on {url}: {body[:300]}")


def _secret(name, default=None):
    """Read a credential, tolerating the trailing newline Actions secrets carry."""
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        if default is not None:
            return default
        raise SystemExit(f"::error::missing secret {name}")
    return raw.strip()


def decode_jwt_claims(token):
    """Decode a JWT payload without verifying it.

    We are not authenticating anyone — we are reading the claims Cognito put in
    our own token to find out what this account is entitled to. Signature
    verification would not change a single claim value.
    """
    parts = token.split(".")
    if len(parts) != 3:
        return {}
    payload = parts[1]
    payload += "=" * (-len(payload) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(payload))
    except Exception:
        return {}


# Claims that identify the human or the session rather than the entitlement.
# Redacted so a probe report can be committed to a public repo verbatim.
_PII_CLAIMS = {
    "sub", "email", "phone_number", "cognito:username", "username",
    "jti", "origin_jti", "event_id", "device_key", "at_hash", "nonce",
}


def redact_claims(claims):
    out = {}
    for k, v in sorted(claims.items()):
        if k in _PII_CLAIMS:
            out[k] = "<redacted>"
        elif isinstance(v, str) and len(v) > 200:
            out[k] = f"<{len(v)} chars, redacted>"
        else:
            out[k] = v
    return out


class KiblClient:
    def __init__(self, username=None, password=None, client_id=None, verbose=True):
        self.username = username or _secret("KIBL_USERNAME")
        self.password = password or _secret("KIBL_PASSWORD")
        self.client_id = client_id or _secret("KIBL_CLIENT_ID", DEFAULT_CLIENT_ID)
        self.verbose = verbose
        self._token = None
        self._token_exp = 0.0
        self._last_call = 0.0
        self.calls = 0
        self.bytes_down = 0
        self.id_claims = {}
        self.access_claims = {}
        self.call_log = []
        self._ctx = ssl.create_default_context()

    # ---------------------------------------------------------------- auth

    def authenticate(self):
        body = json.dumps({
            "AuthParameters": {"USERNAME": self.username, "PASSWORD": self.password},
            "AuthFlow": "USER_PASSWORD_AUTH",
            "ClientId": self.client_id,
        }).encode()
        req = urllib.request.Request(
            COGNITO_URL, data=body, method="POST",
            headers={
                "Content-Type": "application/x-amz-json-1.1",
                "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=45, context=self._ctx) as r:
                payload = json.loads(r.read())
        except urllib.error.HTTPError as e:
            raise KiblError(e.code, e.read().decode("utf-8", "replace"), "cognito") from None

        auth = payload.get("AuthenticationResult") or {}
        token = auth.get("AccessToken")
        if not token:
            # Cognito answers a challenge (NEW_PASSWORD_REQUIRED, MFA) with 200
            # and no token at all — report the challenge name, never the body.
            raise SystemExit(
                f"::error::Cognito returned no AccessToken; challenge="
                f"{payload.get('ChallengeName', 'none')}"
            )
        self._token = token
        self._token_exp = time.time() + int(auth.get("ExpiresIn", 3600)) - 120
        self.access_claims = decode_jwt_claims(token)
        if auth.get("IdToken"):
            self.id_claims = decode_jwt_claims(auth["IdToken"])
        if self.verbose:
            print(f"[auth] ok, token valid {int(auth.get('ExpiresIn', 0))}s")
        return True

    def _bearer(self):
        if not self._token or time.time() >= self._token_exp:
            self.authenticate()
        return self._token

    # ---------------------------------------------------------------- http

    def get(self, path, params=None, retries=3):
        """GET an endpoint. Returns (payload, meta)."""
        params = {k: v for k, v in (params or {}).items() if v is not None}
        # Booleans must go over the wire as the lowercase JSON spelling; Python's
        # str(True) == "True" is not what the API parses.
        for k, v in list(params.items()):
            if isinstance(v, bool):
                params[k] = "true" if v else "false"
            elif isinstance(v, (list, tuple)):
                params[k] = ",".join(str(x) for x in v)
        url = f"{BASE_URL}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)

        last_err = None
        for attempt in range(retries):
            wait = MIN_INTERVAL_S - (time.time() - self._last_call)
            if wait > 0:
                time.sleep(wait)
            started = time.time()
            req = urllib.request.Request(
                url, headers={"Authorization": f"Bearer {self._bearer()}",
                              "Accept": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=120, context=self._ctx) as r:
                    raw = r.read()
                    hdrs = {k.lower(): v for k, v in r.headers.items()}
                    status = r.status
            except urllib.error.HTTPError as e:
                raw = e.read()
                hdrs = {k.lower(): v for k, v in (e.headers or {}).items()}
                status = e.code
            except Exception as e:  # transport-level
                last_err = e
                self._last_call = time.time()
                time.sleep(2 ** attempt)
                continue
            finally:
                self._last_call = time.time()

            elapsed = time.time() - started
            self.calls += 1
            self.bytes_down += len(raw)
            meta = {
                "path": path, "params": dict(params), "status": status,
                "bytes": len(raw), "seconds": round(elapsed, 2),
                # Any of these appearing is the first real evidence of a quota.
                "rate_headers": {k: v for k, v in hdrs.items()
                                 if "ratelimit" in k or "retry-after" in k
                                 or "x-quota" in k},
            }
            self.call_log.append(meta)
            if self.verbose:
                print(f"[get] {status} {path} {json.dumps(params, sort_keys=True)} "
                      f"{len(raw)}B {elapsed:.1f}s")

            if status == 401 and attempt < retries - 1:
                self._token = None  # token aged out mid-run; re-auth and retry
                continue
            if status == 429 or (500 <= status < 600):
                last_err = KiblError(status, raw.decode("utf-8", "replace"), url)
                if attempt < retries - 1:
                    time.sleep(5 * (attempt + 1))
                    continue
            if status != 200:
                return None, meta
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                return None, {**meta, "status": "bad-json"}
            # A 200 whose envelope we cannot read is a parser failure, and it
            # looks identical to an empty account unless it is named as one.
            if self.unrecognised_envelope(payload):
                meta["unrecognised_envelope"] = (
                    sorted(payload.keys())[:12] if isinstance(payload, dict) else str(type(payload)))
                print(f"::warning::unrecognised envelope on {path}: "
                      f"{meta['unrecognised_envelope']}")
            meta["rows"] = len(self.rows(payload))
            return payload, meta

        if last_err:
            meta = {"path": path, "params": dict(params), "status": "transport",
                    "error": str(last_err)[:200], "bytes": 0, "seconds": 0,
                    "rate_headers": {}}
            self.call_log.append(meta)
            return None, meta
        return None, {"path": path, "params": dict(params), "status": "exhausted",
                      "bytes": 0, "seconds": 0, "rate_headers": {}}

    # ------------------------------------------------------------- helpers

    # Kibl's real envelope, confirmed against a live 200 on 2026-09-17:
    #   {api_key, code, description, request_uuid, result: [...], timestamp}
    # The swagger declares an EMPTY response schema for every /info path, so this
    # is taken from the payload, not from the spec.
    ENVELOPE_KEYS = ("result", "data", "results", "items", "records",
                     "markets", "fixtures")

    @staticmethod
    def rows(payload):
        """Normalise the envelope to a flat list of records.

        Returns [] for an envelope we do not recognise rather than [payload].
        Wrapping the envelope itself as a single row is how this read "n=1" for
        every reference table on the first live run — a wrong parser that looks
        exactly like an empty account. Callers use `unrecognised_envelope()` to
        tell "nothing there" from "we cannot read this".
        """
        if payload is None:
            return []
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict):
            for key in KiblClient.ENVELOPE_KEYS:
                if isinstance(payload.get(key), list):
                    return payload[key]
            return []
        return []

    @staticmethod
    def unrecognised_envelope(payload):
        """True when a 200 payload carries no list under any known key."""
        if payload is None or isinstance(payload, list):
            return False
        if not isinstance(payload, dict):
            return True
        return not any(isinstance(payload.get(k), list)
                       for k in KiblClient.ENVELOPE_KEYS)

    @classmethod
    def market_participants(cls, payload):
        """Flatten /info/markets into InfoMarketParticipant rows.

        The documented shape is [{participants:[...]}, ...], but the live
        envelope wraps that under `result` and a fixture-level nesting is also
        possible. Descends one level through `markets`/`participants` and passes
        already-flat rows through, so a shape we did not anticipate reads as an
        unrecognised shape rather than as "zero markets".
        """
        out = []

        def take(rec):
            if not isinstance(rec, dict):
                return
            if "market_type_id" in rec and "side_id" in rec:
                out.append(rec)
                return
            for key in ("participants", "markets"):
                if isinstance(rec.get(key), list):
                    for sub in rec[key]:
                        take(sub)

        for rec in cls.rows(payload):
            take(rec)
        return out

    def markets(self, **params):
        """GET /info/markets with the undocumented required filter enforced.

        MEASURED 2026-09-17: /info/markets REQUIRES feed_source_id. Without it
        the API answers **HTTP 200** with `{"code":..,"description":"minimum of
        1 feed_source_id needed",..}` — no `result` key, no error status. Every
        league, every sport, every time window. That is a fail-open: it reads as
        "this account has no odds" and it is not. The swagger marks the
        parameter `required: false`, so the spec cannot be trusted here.
        """
        if not params.get("feed_source_id"):
            raise ValueError(
                "/info/markets requires feed_source_id — without it the API "
                "returns HTTP 200 with no result and it reads as zero coverage")
        return self.get("/info/markets", params)

    def markets_three_state(self, **params):
        """Return opener + previous + current, defeating the is_current default.

        `is_previous` is NOT a query parameter and `is_current` defaults true,
        so the three states cannot be had in one call. Two calls, then dedupe:
        is_current=true gives the live price, is_current=false gives everything
        that is not the live price (opener and previous).

        Returns (rows, per_call_meta).
        """
        seen = {}
        metas = []
        for flag in (True, False):
            payload, meta = self.markets(**{**params, "is_current": flag})
            metas.append(meta)
            for row in self.market_participants(payload):
                # uuid is per-row; fall back to the natural key when absent so a
                # missing uuid cannot collapse distinct states into one.
                key = row.get("uuid") or (
                    row.get("market_id"), row.get("fixture_participant_id"),
                    row.get("market_type_id"), row.get("segment_id"),
                    row.get("side_id"), row.get("point"), row.get("alt_id"),
                    row.get("is_opener"), row.get("is_previous"), row.get("is_current"),
                    row.get("inserted_on"),
                )
                seen[key] = row
        return list(seen.values()), metas


def state_of(row):
    """Label a participant row by its three-state flags."""
    if row.get("is_opener"):
        return "opener"
    if row.get("is_previous"):
        return "previous"
    if row.get("is_current"):
        return "current"
    return "unflagged"
