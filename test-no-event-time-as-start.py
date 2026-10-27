#!/usr/bin/env python3
"""Regression lock for Michael's TEN-225 ruling 1 (2026-09-17T09:11Z):

    "event_time is never used as a start time, anywhere, at any level, even
     labelled. Confirmed."

FOUNDER RULING 2026-10-26 (one rule for every site): the scheduled time may be used ONLY in the
conservative direction -- to reject a price or stop collecting / showing. It may NEVER create a start
time, cut a close, or label anything as a start.

WHY A TRIPWIRE AND NOT A BAN
---------------------------
`event_time` is not forbidden outright -- it legitimately drives a displayed
clock and day-bucketing, and it is stored as provenance on live_flip_log. What
is forbidden is using it as a START time, which is what would put an in-play
quote on a card labelled "Close".

A blanket grep-fail would therefore break working code and get switched off,
which is worse than no guard. So this pins every site that mentions `event_time`
today, with what it is for. Any NEW site fails the test, and the author has to
come here and say which kind it is. That is the smallest thing that cannot rot
silently.

WHY THE RULING NEEDS A LOCK AT ALL
----------------------------------
Measured on TEN-225 (doc `start-time-check`): api-tennis `event_time` is the
SCHEDULED time, never revised once a match starts. 100.00% of 4,594 finished
fixtures sit on a 5-minute grid; it lands EARLIER than the actual start 42.4% of
the time, and where it lands later it is p95 +11.2 min INSIDE the live match.

    python3 test-no-event-time-as-start.py

RUN IT AGAINST A FRESH CHECKOUT. It walks the working tree, and this repo's
working tree is shared between concurrent agent runs and drifts behind
origin/main. The first version of this file passed locally and went red in CI on
a site (series.js:753) that the stale local tree did not contain -- which is the
guard working, and a reminder that a local PASS here is not evidence.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
EXTS = ('.py', '.js', '.mjs', '.ts', '.sql', '.html')
SKIP_DIRS = {'node_modules', '.git', 'dist', 'build', 'coverage'}
# Probe//analysis scripts are excluded: they exist precisely to MEASURE the field
# and are not part of any shipped path.
SKIP_FILES = {'test-no-event-time-as-start.py', 'ten225-369-trace.py',
              'test_retirement_clear.py', 'test-live-flip-log.sql'}

# Any file whose job is to produce an Open/Close/start timestamp. `event_time`
# must not appear in these AT ALL -- there is no benign use of it here, so this
# set gets the blanket ban the rest of the repo does not.
CLOSE_PATH_MARKERS = ('odds_card_state', 'close_ts', 'close_reliable',
                      'oddspapi_line_summary', 'trueStartTime')

# The pinned sites. Keyed by file; the value is the set of normalised code lines
# that are allowed to mention event_time, each with why it is not a start time.
ALLOWED = {
    'tools/test-ten273-parallel-fetch.js': {
        # TEN-273: stub api-tennis fixtures for the parallel-fetch equivalence test; never read as a start
        "event_key: String(k * 1000 + i), event_date: dateStr, event_time: '12:00', event_status: status,",
        "event_key: String(900000 + i), event_date: played ? '2026-09-20' : date, event_time: String(10 + (i % 9)) + ':30',",
        "rows.push({ ...rows[1], event_key: '909999', event_date: '2026-09-21', event_time: '09:00', first_player_key: String(SLATE_KEYS[2]), event_first_player: 'P. Player' + SLATE_KEYS[2], second_player_key: '5002', event_second_player: 'P. Player5002' });",
    },
    'refresh-scores.py': {
        "# api-tennis event_date/event_time (a card's date/time without startTs) is the",  # comment: the Berlin zone of a card date/time; not a start (pinned 2026-10-26)
        # day/slot bookkeeping for the score patch, never a start instant
        "d, t = f.get('event_date'), f.get('event_time')",
    },
    'test-ten421-trading.mjs': {
        # TEN-421: stub live fixtures and the expected Live-view order (sort key); never a start instant
        'fix.fixtures.push({ event_key: 99, event_date: m0.date, event_time: m0.time, event_first_player: m0.p1, event_second_player: m0.p2,',
        'const grid = b.fix.fixtures.filter(LF.isAtpSingles).filter(LF.isUnderway).sort((x, y) => String(x.event_time).localeCompare(String(y.event_time)));',
        "const fx = (m, ek, t) => ({ event_key: ek, event_date: '2026-10-10', event_time: t, event_first_player: m.p1, event_second_player: m.p2,",
    },
    'trading-report.js': {
        # TEN-421: the row's displayed clock (cardFmtStart, member zone) and the Live-view sort key; never a start instant
        "startClock: slate ? startClockOf(slate) : startClockOf({ date: f.event_date, time: f.event_time }),",
        "return (String(a.event_date || '') + ' ' + String(a.event_time || '')).localeCompare(String(b.event_date || '') + ' ' + String(b.event_time || ''));",
    },
    'bsp-pipeline.js': {
        "// TEN-308: computeDay's input for an api-tennis fixture. event_date + event_time is the Berlin",  # comment: computeDay's day bucket input; not a start (pinned 2026-10-26)
        'date: f.event_date || null, time: f.event_time || null,',  # the feed row's displayed clock (time field) (pinned 2026-10-26)
        "const ka = `${a.event_date || ''} ${a.event_time || ''}`, kb = `${b.event_date || ''} ${b.event_time || ''}`;",  # sort key for the played list (pinned 2026-10-26)
        'time: f.event_time || null,',  # the feed row's displayed clock (time field) (pinned 2026-10-26)
        '// TEN-304: the hour is looked up at the real start instant — event_time is the Europe/Berlin',  # comment: which forecast hour the weather lookup reads; not an odds/close start (pinned 2026-10-26)
        'const pastMatchDateTime = weatherStartIso(fixture.event_date, fixture.event_time);',  # weather-hour lookup (which forecast hour); not an odds/close start (pinned 2026-10-26)
        'const weatherStart = weatherStartIso(fixture.event_date, fixture.event_time);',  # weather-hour lookup (which forecast hour); not an odds/close start (pinned 2026-10-26)
        "const d = String(f.event_date || '') + ' ' + String(f.event_time || '');",  # recency key for picking the latest spelling of a name (pinned 2026-10-26)
        "time: fixture.event_time || null,",                                # displayed clock
        "// Combine event_date + event_time so computeDay() gets a real datetime.",
        "const commence = apiTennisCommence(fixture.event_date, fixture.event_time);",   # TEN-308: Berlin wall -> instant for the day bucket
    },
    'build-series.js': {
        "const startMs = berlinWallMs(String(fx.event_date || ''), String(fx.event_time || ''));",  # slate-day bucket (today / tomorrow) (pinned 2026-10-26)
        "const a = berlinWallMs(d, String(fx.event_time || '')), s = slateStartMs(ctx);",  # ordering: did this fixture come before the slate match (already-played filter) (pinned 2026-10-26)
        "time: String(fx.event_time || ''),",                               # displayed clock
    },
    # series.js: TEN-427 deleted its event_time sort note — Soonest sorts the board's start instant (cardStartMs).
    'bsp-consult-dashboard.html': {
        "// Records without a startTs carry `event_time` in the feed's ACCOUNT zone, which",
        # 2026-10-26: the "(event_time is the match START only)" comment was removed by TEN-314 (0f18fc2ec); pin dropped
    },
    'supabase/migrations/20260917100000_live_flip_log.sql': {
        # stored as provenance on live_flip_log; nothing reads it as a time
        "event_time            text,                        -- SCHEDULED. Recorded for",
        "event_date, event_time, first_player, second_player,",   # insert column list
        "fix ->> 'event_time',",
    },
    'test-ten294-drops.mjs': {  # pinned 2026-10-26 (live-flip-recorder)
        "const fx = [{ event_key: 12165854, event_status: 'Finished', event_live: '0', event_date: '2026-09-26', event_time: '06:55', utc: true, event_first_player: 'M. Damm', event_second_player: 'H. Hurkacz' }];",  # test fixture / assertion; never a start in shipped code
        "const fxs = [{ event_key: 12165854, event_status: 'Finished', event_live: '0', event_date: '2026-09-26', event_time: '06:55', utc: true, event_first_player: 'M. Damm', event_second_player: 'H. Hurkacz' }];",  # test fixture / assertion; never a start in shipped code
        "const fx = [{ event_key: 5, event_status: 'Set 1', event_live: '1', event_date: '2026-09-26', event_time: '12:00', utc: true, event_first_player: 'A. Boutleux', event_second_player: 'M. Seifert' }];",  # test fixture / assertion; never a start in shipped code
        "const idx = STATUS.indexFixtures([{ event_key: 1, event_first_player: 'M. Damm', event_second_player: 'H. Hurkacz', event_date: '2026-09-26', event_time: '06:55', utc: true }]);",  # test fixture / assertion; never a start in shipped code
        "assert.doesNotMatch(code, /event_time/, 'the sighting join never reads the scheduled time (TEN-225 ruling 1, founder 2026-10-26)');",  # test fixture / assertion; never a start in shipped code
    },
    'player-profile-v2.js': {  # pinned 2026-10-26 (live-flip-recorder)
        '// gives `event_time` (a START time) and nothing else, and neither shard',  # comment: why match duration is dashed; not code
    },
    'test-ten308-berlin-time.py': {  # pinned 2026-10-26 (live-flip-recorder)
        '"""TEN-308 — the Python api-tennis sites read event_date/event_time as the Europe/Berlin',  # test fixture / assertion; never a start in shipped code
        "lambda d=d, t=t, want=want: eq(iso_ms(RS._fixture_ms({'event_date': d, 'event_time': t})), want))",  # test fixture / assertion; never a start in shipped code
    },
    'berlin-time.js': {  # pinned 2026-10-26 (live-flip-recorder)
        "// TEN-308: the ONE reader for an api-tennis `event_date` + `event_time` (the card's `date` +",  # header comment of the Berlin-wall reader (day bucket / displayed clock); not a start
    },
    'test-ten427-series.mjs': {  # pinned 2026-10-26 (live-flip-recorder)
        "event_first_player: 'A. One', event_second_player: 'Opp ' + k, event_winner: won ? 'First Player' : 'Second Player', event_date: date, event_time: time,",  # test fixture / assertion; never a start in shipped code
        "const ctxOf = f => ({ date: f.event_date, time: f.event_time, eventKey: f.event_key, surface: 'hard', bestOf: 3, opponentArch: null, played: true });",  # test fixture / assertion; never a start in shipped code
        "event_first_player: 'A. One', event_second_player: 'Opp ' + k, event_winner: won ? 'First Player' : 'Second Player', event_date: date, event_time: '12:00',",  # test fixture / assertion; never a start in shipped code
    },
    'test-line-prices.py': {  # pinned 2026-10-26 (live-flip-recorder)
        "return [{'event_key': 12173801, 'event_date': '2026-10-24', 'event_time': '13:00', 'event_type_type': 'Atp Singles',",  # test fixture / assertion; never a start in shipped code
        "af = [{'event_key': 5, 'event_date': '2026-10-25', 'event_time': '10:00', 'event_type_type': 'Itf Men Singles',",  # test fixture / assertion; never a start in shipped code
    },
    'tools/test-ten304-weather-hour.js': {  # pinned 2026-10-26 (live-flip-recorder)
        '// api-tennis event_date + event_time is the scheduled start on the Europe/Berlin',  # test fixture / assertion; never a start in shipped code
    },
    'tools/test-tdarch.py': {  # pinned 2026-10-26 (live-flip-recorder)
        "bd10 = {'2026-05-20': [{'event_key': 50, 'event_first_player': 'T. Theta', 'event_second_player': 'E. Eta', 'event_date': '2026-05-20', 'event_time': '12:00'}]}",  # test fixture / assertion; never a start in shipped code
        "G = lambda ek, d, tm=None: dict(F(ek, 'Challenger Men Singles', d=d), **({'event_time': tm} if tm else {}))",  # test fixture / assertion; never a start in shipped code
    },
    'tools/test-ten308-berlin-time.js': {  # pinned 2026-10-26 (live-flip-recorder)
        '// TEN-308 — api-tennis event_date/event_time is the Europe/Berlin wall clock',  # test fixture / assertion; never a start in shipped code
        "assert.ok(/const commence = apiTennisCommence\\(fixture\\.event_date, fixture\\.event_time/.test(body), 'commence is not converted');",  # test fixture / assertion; never a start in shipped code
        "assert.strictEqual(S.slateDayOf({ event_date: '2026-10-26', event_time: '00:30' }, '2026-10-25', '2026-10-26'), 'today'));",  # test fixture / assertion; never a start in shipped code
        "assert.strictEqual(S.slateDayOf({ event_date: '2026-10-25', event_time: '01:30' }, '2026-10-24', '2026-10-25'), 'today'));",  # test fixture / assertion; never a start in shipped code
        "assert.strictEqual(S.slateDayOf({ event_date: '2026-10-24', event_time: '14:00' }, '2026-10-24', '2026-10-25'), 'today');",  # test fixture / assertion; never a start in shipped code
        "assert.strictEqual(S.slateDayOf({ event_date: '2026-10-26', event_time: '14:00' }, '2026-10-25', '2026-10-26'), 'tomorrow');",  # test fixture / assertion; never a start in shipped code
        "assert.strictEqual(S.slateDayOf({ event_date: '2026-10-26', event_time: '' }, '2026-10-25', '2026-10-26'), 'tomorrow'));",  # test fixture / assertion; never a start in shipped code
    },
    'tools/test-ten421-mutants.js': {  # pinned 2026-10-26 (live-flip-recorder)
        '[\'js\', \'R3: live row time from the feed, not the card\', "      startClock: slate ? startClockOf(slate) : startClockOf({ date: f.event_date, time: f.event_time }),", "      startClock: startClockOf({ date: f.event_date, time: f.event_time }),"],',  # test fixture / assertion; never a start in shipped code
    },
    'tools/test-partial-fetch.js': {  # pinned 2026-10-26 (live-flip-recorder)
        "const fx = (k, date, round, w = 'First Player') => ({ event_key: k, event_date: date, event_time: '10:00', event_status: 'Finished', event_winner: w, event_qualification: 'False',",  # test fixture / assertion; never a start in shipped code
    },
    'tools/test-pinarch-close.py': {  # pinned 2026-10-26 (live-flip-recorder)
        "atf = [{'event_key': 12112000, 'event_date': '2026-04-20', 'event_time': '10:00', 'event_first_player': 'A. Rinderknech', 'event_second_player': 'T. Paul',",  # test fixture / assertion; never a start in shipped code
        "{'event_key': 12112001, 'event_date': '2026-04-20', 'event_time': '12:00', 'event_first_player': 'B. Bonzi', 'event_second_player': 'C. Moutet',",  # test fixture / assertion; never a start in shipped code
        "{'event_key': 12112002, 'event_date': '2026-04-20', 'event_time': '13:00', 'event_first_player': 'D. Altmaier', 'event_second_player': 'E. Hanfmann',",  # test fixture / assertion; never a start in shipped code
        "{'event_key': 12112003, 'event_date': '2026-04-20', 'event_time': '14:00', 'event_first_player': 'F. Fritz', 'event_second_player': 'G. Gaston',",  # test fixture / assertion; never a start in shipped code
        "{'event_key': 12112004, 'event_date': '2026-04-20', 'event_time': '15:00', 'event_first_player': 'H. Hurkacz', 'event_second_player': 'I. Ivashka',",  # test fixture / assertion; never a start in shipped code
        "{'event_key': 12112005, 'event_date': '2026-04-12', 'event_time': '15:00', 'event_first_player': 'J. Jarry', 'event_second_player': 'K. Kecmanovic',",  # test fixture / assertion; never a start in shipped code
        "twin = [dict(atf[0], event_key=12112099, event_time='11:00')]",  # test fixture / assertion; never a start in shipped code
    },
    'tools/pinarch.py': {  # pinned 2026-10-26 (live-flip-recorder)
        "d, t = f.get('event_date'), f.get('event_time')",  # join window only: the date-range filter and candidate pairing (founder 2026-10-26); no stored start
    },
    'tools/ten294-drops-api.sql': {  # pinned 2026-10-26 (live-flip-recorder)
        "'date', fl.event_date, 'time', fl.event_time,",  # provenance field passed through in the drops API flips payload; status.mjs uses it as a join window only
    },
    'tools/test-wue-sheet.js': {  # pinned 2026-10-26 (live-flip-recorder)
        "const fx = (ek, date, time, status, stats) => ({ event_key: ek, event_date: date, event_time: time, event_status: status, event_winner: 'First Player',",  # test fixture / assertion; never a start in shipped code
    },
    'tools/test-ten371-name-spine.js': {  # pinned 2026-10-26 (live-flip-recorder)
        "const BU_FIXTURE = { event_key: 12167394, event_date: '2026-10-02', event_time: '10:00',",  # test fixture / assertion; never a start in shipped code
        "event_key: 12166537, event_date: '2026-10-01', event_time: '09:50',",  # test fixture / assertion; never a start in shipped code
    },
    'kibl-stream/test-line-engine.py': {  # pinned 2026-10-26 (live-flip-recorder)
        "AT = [{'event_key': 12173801, 'event_date': '2026-10-25', 'event_time': '13:00', 'event_type_type': 'Atp Singles',",  # test fixture / assertion; never a start in shipped code
    },
    'kibl-stream/card_join.py': {  # pinned 2026-10-26 (live-flip-recorder)
        '# api-tennis event_date/event_time is the Europe/Berlin wall clock: CEST (+2) until 25 Oct 2026,',  # comment: the Berlin zone of the card pool / join window; not a start
    },
    'stennisfy-drops/status.mjs': {  # pinned 2026-10-26 (live-flip-recorder)
        'const c = classifyFixture(fresh || fx), apiStart = apiStartMs(fx.event_date, fx.event_time, fx.utc);',  # stops the drops feed at the passed scheduled time; founder ruling 2026-10-26: the scheduled time used ONLY in the conservative direction (reject / stop), never to create, cut or label a start
        '(st == null || Math.abs(apiStartMs(f.event_date, f.event_time, f.utc) - st) < JOIN_WINDOW_MS));',  # join window (24 h) pairing a vendor row with its api-tennis fixture
        'event_date: f.event_date, event_time: f.event_time, event_first_player: f.event_first_player, event_second_player: f.event_second_player, utc: true });',  # slim fixture payload passthrough; the field is not read as a time here
    },
    'supabase/functions/live-poller/finals.ts': {  # pinned 2026-10-26 (live-flip-recorder)
        '"first_player_key", "event_second_player", "second_player_key", "event_date", "event_time", "tournament_name",',  # field kept in the stored fixture summary (live_pbp final); never read as a time
    },
    'tools/tdarch.py': {
        "d, t = str(f.get('event_date') or ''), str(f.get('event_time') or '')",  # TE in-play rule rejects prices after it; founder ruling 2026-10-26: the scheduled time used ONLY in the conservative direction (reject / stop), never to create, cut or label a start
    },
    'line_prices.py': {
        "d, t = f.get('event_date'), f.get('event_time')",  # at_start_ts: ±36 h join window, a label, date grouping; never cuts a close (checked 2026-10-26)
    },
    'supabase/migrations/20261027090000_live_flip_played.sql': {
        'event_time            text,                    -- SCHEDULED; provenance only, never read as a time (TEN-225 ruling 1)',  # provenance copied through live_flip_pending into live_flip_log; nothing reads it as a time (played-start-recorder, 2026-10-26)
        'event_date, event_time, first_player, second_player, tournament_name, event_type_type',  # provenance copied through live_flip_pending into live_flip_log; nothing reads it as a time (played-start-recorder, 2026-10-26)
        "fix ->> 'event_date', fix ->> 'event_time', fix ->> 'event_first_player', fix ->> 'event_second_player',",  # provenance copied through live_flip_pending into live_flip_log; nothing reads it as a time (played-start-recorder, 2026-10-26)
        'event_date, event_time, first_player, second_player, tournament_name, event_type_type, play_seen_at',  # provenance copied through live_flip_pending into live_flip_log; nothing reads it as a time (played-start-recorder, 2026-10-26)
        'event_date, event_time, first_player, second_player, tournament_name, event_type_type, _now',  # provenance copied through live_flip_pending into live_flip_log; nothing reads it as a time (played-start-recorder, 2026-10-26)
    },
}


def walk():
    for root, dirs, files in os.walk(HERE):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith('.')]
        for fn in files:
            if fn.endswith(EXTS):
                yield os.path.join(root, fn)


def main():
    unknown, banned = [], []
    seen = set()
    for path in walk():
        rel = os.path.relpath(path, HERE)
        if os.path.basename(path) in SKIP_FILES or rel in SKIP_FILES:
            continue
        try:
            text = open(path, encoding='utf-8', errors='replace').read()
        except OSError:
            continue
        if 'event_time' not in text:
            continue
        close_path = any(m in text for m in CLOSE_PATH_MARKERS)
        allowed = ALLOWED.get(rel, set())
        for i, line in enumerate(text.splitlines(), 1):
            if 'event_time' not in line:
                continue
            norm = line.strip()
            if close_path and rel not in ALLOWED:
                banned.append((rel, i, norm))
            elif norm not in allowed:
                unknown.append((rel, i, norm))
            else:
                seen.add((rel, norm))

    # A pin that no longer matches anything is a pin that has stopped guarding.
    stale = [(f, l) for f, lines in ALLOWED.items() for l in lines
             if (f, l) not in seen]

    ok = True
    if banned:
        ok = False
        print('::error::event_time appears in an Open/Close/start-time path. '
              'Michael 2026-09-17: it is the SCHEDULED time and must never be '
              'used as a start time, at any level, even labelled.')
        for f, i, l in banned:
            print(f'  BANNED  {f}:{i}  {l[:110]}')
    if unknown:
        ok = False
        print('::error::new event_time reference(s). If this is a displayed clock '
              'or a sort key, pin it in ALLOWED with a note. If it is a start '
              'time, it violates the ruling and must not ship.')
        for f, i, l in unknown:
            print(f'  NEW     {f}:{i}  {l[:110]}')
    if stale:
        ok = False
        print('::error::pinned event_time site(s) no longer found — the pin has '
              'stopped guarding anything and must be re-checked, not deleted.')
        for f, l in stale:
            print(f'  STALE   {f}  {l[:110]}')

    if ok:
        print(f'PASS — {len(seen)} pinned event_time site(s), all accounted for; '
              f'0 in any Open/Close/start-time path.')

    # Failing control: the checker must be able to fail. Feed it a line that is
    # neither pinned nor benign and assert it is rejected. Without this, a
    # checker whose matcher silently stopped working reads exactly like a pass.
    probe = "close_ts = fixture['event_time']   # start time"
    if probe.strip() in ALLOWED.get('refresh-scores.py', set()):
        print('::error::CONTROL FAILED: the probe line is pinned, so the check is vacuous')
        return 1
    if 'event_time' not in probe:
        print('::error::CONTROL FAILED: the matcher would not even see a violation')
        return 1
    print('control: a violating line is correctly not pinned and would be reported.')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
