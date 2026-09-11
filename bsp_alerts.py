#!/usr/bin/env python3
"""
The ONE outbound alert path for the BSP data workflows — TEN-179 item 4.

Founder ruling, 2026-09-10:

    "We now have three alarms: the T-24h open monitor that measures but doesn't
     notify, the quota warning that fired for nine days unread, and the new
     dropping-odds alert. Two of the three are silent by construction, and every
     silent failure on this pipeline so far ... was invisible for the same reason.
     Route all three through the single outbound Telegram send from the workflow."

Every silent failure this pipeline has had — the 403 batching that reported
success, the nightly that clobbered the backfill, the 404 counted as transport,
the Sep 2-10 quota outage — was invisible because its only channel was a log
line inside a green Actions run. A `::warning::` is not a warning. This module
is the channel.

WHY OUTBOUND-ONLY: the Telegram bot is a launchd long-poll RECEIVER on the
founder's laptop, so CI cannot reach it inbound. The integration is therefore a
plain outbound HTTPS `sendMessage` from the workflow, token in Actions secrets.
Never in the browser: Pages is a static site, so a token shipped to the client
would be public by construction.

CHANNELS. `ops` is the only channel implemented today: quota and missing-open
alerts, which the founder said are "for me alone". The member-facing
dropping-odds channel is deliberately NOT implemented here — the founder asked
to see the proposed operational/member split before it is built. `send()` on any
channel other than 'ops' raises, so no member alert can leak out of an
operational chat by accident.

Stdlib only. Nothing in here may raise into a caller: an alerting path that can
break the job it monitors is worse than no alerting path at all.
"""
import json, os, sys, time, urllib.request, urllib.parse, urllib.error
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(HERE, 'alert-state.json')

# --- Quota runway thresholds (TEN-179 item 2, founder-approved 2026-09-10) ---
# "WARN under 10 days projected runway, CRITICAL under 3, measured against the
#  subscription window. Runway is the right unit; percentage isn't."
#
# Percentage is the wrong unit because the same percentage is a different amount
# of TIME at every cadence: 80% of 5,000 is 15 days of notice at the hourly
# cadence and under 6 at a 15-minute one. Runway self-adjusts when the cadence
# changes, so this threshold never needs re-deriving. It is also why the burn
# rate below is MEASURED from the meter's own history rather than computed from
# the code's call arithmetic — the arithmetic is what was wrong in the first place.
QUOTA_WARN_DAYS = 10.0
QUOTA_CRIT_DAYS = 3.0
QUOTA_HISTORY_FILE = os.path.join(HERE, 'odds-quota-history.json')
QUOTA_HISTORY_KEEP = 60          # samples; at 1/run hourly that is ~2.5 days of detail
MIN_BURN_SPAN_H = 6.0            # a burn rate measured over less than this is noise

BASE = 'https://api.oddspapi.io'


# --------------------------------------------------------------------------
# Telegram
# --------------------------------------------------------------------------

def _now():
    return datetime.now(timezone.utc)


def _iso(dt=None):
    return (dt or _now()).strftime('%Y-%m-%dT%H:%M:%SZ')


def _load_state():
    try:
        s = json.load(open(STATE_FILE))
        return s if isinstance(s, dict) else {}
    except Exception:
        return {}


def _save_state(state):
    try:
        with open(STATE_FILE, 'w') as fh:
            json.dump(state, fh, indent=2, ensure_ascii=False, sort_keys=True)
    except Exception as e:
        print(f'::warning::Could not persist alert state ({e}) — de-duplication '
              f'will not survive this run.')


def send(text, channel='ops', dedupe_key=None, cooldown_h=None):
    """Send one alert. Returns True if Telegram accepted it.

    `dedupe_key` + `cooldown_h` suppress a repeat of the SAME alert inside the
    cooldown. Suppression is recorded in alert-state.json, which the workflow
    commits — the runner is ephemeral, so without persisting it every run would
    start with an empty memory and re-send every standing alert every time. That
    is the exact failure mode (an alarm that cries every hour is an alarm you
    mute) this exists to avoid.

    Never raises. A failure to notify is reported to the log AND, because the
    log is precisely the channel the founder said does not work, the caller's
    own `::error::` reporting is left intact rather than replaced by this.
    """
    if channel != 'ops':
        raise ValueError(
            f'channel {channel!r} is not implemented. Only the operational channel '
            f'exists today; the member-facing split is pending a founder ruling '
            f'(TEN-179 item 4).')

    token = os.environ.get('TELEGRAM_BOT_TOKEN', '').strip()
    chat = os.environ.get('TELEGRAM_OPS_CHAT_ID', '').strip()
    if not token or not chat:
        print(f'::warning::ALERT HAD NOWHERE TO GO — TELEGRAM_BOT_TOKEN / '
              f'TELEGRAM_OPS_CHAT_ID are not set, so this alert only reached this '
              f'log. Add both as Actions secrets. Alert text: {text.splitlines()[0]}')
        return False

    state = _load_state()
    if dedupe_key and cooldown_h:
        prev = (state.get(dedupe_key) or {}).get('lastSentAt')
        if prev:
            try:
                age_h = (_now() - datetime.fromisoformat(
                    prev.replace('Z', '+00:00'))).total_seconds() / 3600.0
                if age_h < cooldown_h:
                    print(f'Alert {dedupe_key} suppressed: last sent {age_h:.1f}h ago, '
                          f'inside the {cooldown_h:.1f}h cooldown.')
                    return False
            except ValueError:
                pass

    payload = urllib.parse.urlencode({
        'chat_id': chat, 'text': text,
        'parse_mode': 'HTML', 'disable_web_page_preview': 'true',
    }).encode()
    req = urllib.request.Request(
        f'https://api.telegram.org/bot{token}/sendMessage', data=payload,
        headers={'User-Agent': 'BSP-Consult-Dashboard/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            ok = json.load(r).get('ok') is True
    except Exception as e:
        # Telegram is down / token wrong / chat wrong. Say so loudly: a notifier
        # that fails quietly is the very defect being fixed.
        print(f'::error::Telegram send FAILED ({e}). The alert below did not reach '
              f'anyone: {text.splitlines()[0]}', file=sys.stderr)
        return False

    if not ok:
        print(f'::error::Telegram rejected the alert (ok=false). It did not reach '
              f'anyone: {text.splitlines()[0]}', file=sys.stderr)
        return False

    if dedupe_key:
        state[dedupe_key] = {'lastSentAt': _iso(), 'channel': channel}
        _save_state(state)
    print(f'Telegram alert sent to the {channel} channel'
          + (f' (key {dedupe_key})' if dedupe_key else '') + '.')
    return True


# --------------------------------------------------------------------------
# Quota runway
# --------------------------------------------------------------------------

def _api_get(path, params, key):
    params = dict(params)
    params['apiKey'] = key
    url = BASE + path + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'User-Agent': 'BSP-Consult-Dashboard/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r), None
    except urllib.error.HTTPError as e:
        return None, e.code
    except Exception as e:
        return None, str(e)


def active_subscription(key):
    """The live /v4/account active subscription block, or None. FREE — /v4/account
    does not move the meter (measured repeatedly: 10 consecutive reads, delta 0)."""
    data, err = _api_get('/v4/account', {}, key)
    if data is None:
        print(f'::warning::Could not read the oddspapi account ({err}).', file=sys.stderr)
        return None
    subs = [s for s in (data.get('subscriptions') or []) if s.get('is_active')]
    return subs[0] if subs else None


def _parse(ts):
    if not isinstance(ts, str) or not ts:
        return None
    try:
        d = datetime.fromisoformat(ts.replace('Z', '+00:00'))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _record_sample(used, now, by=None):
    """Append this run's meter reading and return the retained history.

    A meter reading that went DOWN means the subscription window rolled over, so
    every earlier sample belongs to a different window and would make the burn
    rate meaningless. Drop them rather than average across the seam.
    """
    try:
        hist = json.load(open(QUOTA_HISTORY_FILE))
        samples = hist.get('samples') if isinstance(hist, dict) else None
        if not isinstance(samples, list):
            samples = []
    except Exception:
        samples = []

    if samples and isinstance(samples[-1].get('used'), int) and used < samples[-1]['used']:
        print(f'oddspapi meter fell {samples[-1]["used"]} -> {used}: the subscription '
              f'window rolled over. Dropping {len(samples)} pre-rollover sample(s) so '
              f'the burn rate is not averaged across the seam.')
        samples = []

    # `by` names WHICH job took this reading. The spend guard (TEN-179 item 3) uses the
    # last 'metered-now' sample as its repo-side floor for a fresh runner with no
    # untracked marker; refresh-odds-history.py's 3-hourly main() also bills and also
    # records here, so an untagged read would suppress an hourly NOW leg that never ran.
    # Older, untagged samples carry no `by` and are ignored by the guard — which fails
    # OPEN (allows the spend), never toward a silently-skipped refresh.
    sample = {'at': _iso(now), 'used': used}
    if by:
        sample['by'] = by
    samples.append(sample)
    samples = samples[-QUOTA_HISTORY_KEEP:]
    try:
        with open(QUOTA_HISTORY_FILE, 'w') as fh:
            json.dump({'schema': 'odds-quota-history/1', 'updatedAt': _iso(now),
                       'samples': samples}, fh, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f'::warning::Could not persist the quota history ({e}) — the burn rate '
              f'will fall back to the window average next run.')
    return samples


def quota_status(key, cadence_note='', by=None):
    """Read the meter, measure the burn rate, and return the runway verdict.

    Returns a dict, or None when the meter could not be read. Keys:
      used, limit, validUntil, daysLeft, burnPerDay, burnSource,
      runwayDays, tier ('OK' | 'WARN' | 'CRITICAL'), text.

    RUNWAY, not percentage — the founder's ruling. The alert fires only when we
    project to exhaust the quota BEFORE the window resets: a 4-day runway with 2
    days left in the window is not a problem, and firing on it would train the
    channel to be ignored, which is how the 80% warning died.
    """
    sub = active_subscription(key)
    if not sub:
        print('::error::oddspapi reports NO active subscription — every metered '
              'call will fail until it is renewed.', file=sys.stderr)
        return None

    used, limit = sub.get('request_count'), sub.get('request_limit')
    if not isinstance(used, int) or not isinstance(limit, int) or limit <= 0:
        print(f'::warning::oddspapi meter is unreadable (used={used!r}, '
              f'limit={limit!r}).')
        return None

    now = _now()
    valid_until = _parse(sub.get('valid_until'))
    valid_from = _parse(sub.get('valid_from'))
    days_left = ((valid_until - now).total_seconds() / 86400.0) if valid_until else None

    samples = _record_sample(used, now, by=by)

    # Burn rate, measured. Prefer the oldest retained sample that is far enough
    # back to be signal rather than noise; fall back to the window average.
    burn, source = None, 'unavailable'
    for s in samples:
        at = _parse(s.get('at'))
        if at is None or not isinstance(s.get('used'), int):
            continue
        span_h = (now - at).total_seconds() / 3600.0
        if span_h >= MIN_BURN_SPAN_H:
            delta = used - s['used']
            if delta >= 0:
                burn = delta / (span_h / 24.0)
                source = f'measured over the last {span_h:.1f}h ({delta} unit(s))'
            break
    if burn is None and valid_from:
        elapsed_d = max((now - valid_from).total_seconds() / 86400.0, 0.25)
        burn = used / elapsed_d
        source = f'window average over {elapsed_d:.1f}d (no {MIN_BURN_SPAN_H:.0f}h+ sample yet)'

    remaining = limit - used
    runway = (remaining / burn) if (burn and burn > 0) else float('inf')

    tier = 'OK'
    if days_left is not None and runway < days_left:
        if runway < QUOTA_CRIT_DAYS:
            tier = 'CRITICAL'
        elif runway < QUOTA_WARN_DAYS:
            tier = 'WARN'
    elif days_left is None and runway < QUOTA_CRIT_DAYS:
        tier = 'CRITICAL'

    runway_txt = 'no measurable burn' if runway == float('inf') else f'{runway:.1f} days'
    left_txt = f'{days_left:.1f} days' if days_left is not None else 'unknown'
    line = (f'oddspapi quota: {used}/{limit} used, {remaining} left. '
            f'Burn {burn:.0f}/day ({source}). Runway {runway_txt} against '
            f'{left_txt} remaining in the window (resets '
            f'{str(sub.get("valid_until"))[:10]}). Tier {tier}.')
    print(line)

    text = None
    if tier != 'OK':
        text = (f'⚠️ oddspapi quota {tier}\n\n'
                f'{used}/{limit} units used, {remaining} left.\n'
                f'Burn {burn:.0f}/day ({source}).\n'
                f'Projected to run out in {runway_txt} — '
                f'{left_txt} before the window resets on '
                f'{str(sub.get("valid_until"))[:10]}.\n'
                f'{cadence_note}\n\n'
                f'When it runs out the odds capture stops and open/close are lost '
                f'for every match that finishes meanwhile.')
        print(f'::error::{line}', file=sys.stderr)

    return {'used': used, 'limit': limit, 'validUntil': sub.get('valid_until'),
            'daysLeft': days_left, 'burnPerDay': burn, 'burnSource': source,
            'runwayDays': runway, 'tier': tier, 'text': text,
            'bookmakers': sorted((sub.get('bookmakers') or {}).keys())}


def alert_quota(key, cadence_note='', by=None):
    """quota_status() + the outbound send, with a cooldown so a standing WARN does
    not fire every run. CRITICAL repeats more often than WARN on purpose."""
    st = quota_status(key, cadence_note, by=by)
    if not st or not st.get('text'):
        return st
    cooldown = 6.0 if st['tier'] == 'CRITICAL' else 24.0
    send(st['text'], channel='ops',
         dedupe_key=f'quota:{st["tier"]}', cooldown_h=cooldown)
    return st
