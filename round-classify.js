'use strict';
/**
 * round-classify.js — the single source of truth for how a fixture's round /
 * qualifying label is decided. Extracted from bsp-pipeline.js (TEN-160) so the
 * ruling is (a) in one place instead of triplicated inline, and (b) unit-testable
 * without loading the whole pipeline (no dotenv, no network, no cache files).
 *
 * THE RULING it encodes — "authoritative fields beat heuristics"
 * (founder ruling TEN-157 / TEN-161, 2026-09-06; see CLAUDE.md rulings ledger):
 *
 *   A match's round / qualifying label is derived by a STRICT SIGNAL HIERARCHY,
 *   highest wins:
 *     (1) event_qualification — the feed's 'True'/'False'/null string. 'True'
 *         is an authoritative qualifying signal.
 *     (2) the round label itself — the `1/N-finals` fraction form is the feed's
 *         unambiguous main-draw certifier.
 *     (3) the Slam best-of-three SET-COUNT NET — a LAST-RESORT tertiary signal.
 *         A completed Grand-Slam MAIN draw is best-of-five, so a decided winner
 *         who took <3 sets (and it isn't a retirement/walkover) is a
 *         best-of-three qualifying match mislabelled with a main-draw round.
 *         It may only FILL a label when the authoritative signals are absent —
 *         it may NEVER override a `1/N-finals` main-draw round (TEN-157) and
 *         never fires on a row already flagged qualifying.
 *
 *   TEN-157 was the set-count net firing on a real US Open R64 (`1/32-finals`,
 *   event_qualification 'False') cached mid-match while event_final_result still
 *   lagged at a transient "2 - 1" — stamping a main-draw win 'Q' and freezing it
 *   in the 7-day history cache. The `1/N-finals` guard makes that impossible.
 *
 * SLAM-SPECIFIC NOTE (why the certifier is the FRACTION form only, not word
 * forms): at a Slam the leaked qualifying rows are exactly the ones wearing
 * main-draw WORD labels ("Semi-finals"/"Final"/"Quarter-finals") with
 * event_qualification null — that mislabel is the whole reason the set-count net
 * exists (TEN-89). So only the `1/N-finals` fraction label can be trusted as a
 * Slam main-draw certifier; treating word forms as authoritative here would
 * re-open the TEN-89 qualifying leak. `roundShort()` still MAPS word forms to
 * round codes for display, but they do not certify a Slam row against the net.
 *
 * Scope: this module is the PER-ROW decision (primary flag + fraction certifier
 * + Slam set-count net). The edition-grouped structural first-loss net in the
 * pipeline is inherently multi-row (it needs a player's whole draw at one event)
 * and stays there; it shares this module's `roundShort`/`isFracRound` helpers.
 */

// Grand-Slam canonical display names (best-of-five main draws). Compared against
// the canonicalTournament() display string, so "Roland Garros" folds to
// "French Open" upstream; the alias is kept as defence in depth.
const GRAND_SLAM_NAMES = new Set([
  'Australian Open', 'French Open', 'Roland Garros', 'Wimbledon', 'US Open',
]);

// Round depth ranking (higher = deeper run). Covers the word forms and the
// fraction forms the API returns across seasons.
const ROUND_RANK = { F: 7, SF: 6, QF: 5, R16: 4, R32: 3, R64: 2, R128: 1, R256: 0 };

// The feed's unambiguous main-draw certifier: a `1/N-finals` fraction label
// (`1/32-finals`, `1/16-finals`, …). Leaked Slam qualifying rows never carry it.
const FRAC_ROUND_RE = /1\/\d+\s*-?\s*finals?/i;

/** True if `round` carries a `1/N-finals` fraction label (certified main draw). */
function isFracRound(round) {
  return FRAC_ROUND_RE.test(String(round || ''));
}

/**
 * Map a raw feed round string to a short round code (F/SF/QF/R16/R32/R64/…).
 * Verbatim behaviour of the pipeline's careerRoundShort(): handles the
 * fraction forms (1/32-finals → R64) and the word forms (Round of 64 → R64).
 * Returns the trimmed input unchanged when it recognises nothing.
 */
function roundShort(round) {
  if (!round) return '';
  let r = String(round);
  if (r.includes(' - ')) r = r.split(' - ').pop();
  r = r.trim();
  const frac = r.match(/1\/(\d+)/);
  if (frac) {
    const map = { '2': 'SF', '4': 'QF', '8': 'R16', '16': 'R32', '32': 'R64', '64': 'R128', '128': 'R256' };
    return map[frac[1]] || r;
  }
  if (/semi[-\s]?final/i.test(r)) return 'SF';
  if (/quarter[-\s]?final/i.test(r)) return 'QF';
  const ro = r.match(/round of (\d+)/i);
  if (ro) {
    const m = { '16': 'R16', '32': 'R32', '64': 'R64', '128': 'R128', '256': 'R256' };
    return m[ro[1]] || ('R' + ro[1]);
  }
  if (/final/i.test(r)) return 'F';
  return r;
}

/**
 * Winner's set count from an event_final_result string ("2 - 1" → 2). The score
 * is raw fixture order, so the winner is the MAX of the two — orientation-safe.
 * Returns NaN unless the string parses to exactly two finite set counts.
 */
function winnerSets(finalScore) {
  const sc = String(finalScore || '').split('-').map((s) => parseInt(s.trim(), 10));
  return (sc.length === 2 && sc.every(Number.isFinite)) ? Math.max(sc[0], sc[1]) : NaN;
}

/**
 * The Slam best-of-three set-count net — the tertiary, last-resort signal.
 * Returns true iff this row should be reclassified qualifying by set count.
 * Mirrors the pipeline's isSlamQualifyingLeak() exactly:
 *   - only Grand Slams (best-of-five main draws),
 *   - NEVER overrides a `1/N-finals` certified main-draw round (TEN-157),
 *   - never fires on a retirement / walkover (a main-draw match that stopped
 *     early can legitimately show <3 winner sets),
 *   - fires only when the winner took fewer than 3 sets.
 *
 * @param {{isGrandSlam:boolean, tournamentRound:string, finalScore:string, status:string}} x
 */
function isSlamSetCountQualifier({ isGrandSlam, tournamentRound, finalScore, status } = {}) {
  if (!isGrandSlam) return false;
  if (isFracRound(tournamentRound)) return false;            // authoritative main-draw signal
  if (status === 'Retired' || status === 'Walk Over') return false;
  const ws = winnerSets(finalScore);
  return Number.isFinite(ws) && ws < 3;
}

/**
 * Full per-row round classification. Applies the signal hierarchy and returns
 * the round code plus whether the row is qualifying and which signal decided it.
 *
 * @param {object} fx
 * @param {string}  fx.tournamentRound  raw feed round string (e.g. "1/32-finals")
 * @param {string=} fx.qualification    event_qualification: 'True' | 'False' | null
 * @param {string=} fx.tournamentName   canonical display name (used only if isGrandSlam omitted)
 * @param {boolean=} fx.isGrandSlam     pass the resolved flag when known (preferred)
 * @param {string=} fx.finalScore       event_final_result, e.g. "2 - 1"
 * @param {string=} fx.status           event_status: 'Finished' | 'Retired' | 'Walk Over' | …
 * @returns {{code:string, qualifying:boolean, reason:string}}
 */
function classifyRound(fx = {}) {
  const {
    tournamentRound = '', qualification = null, tournamentName = '',
    finalScore = '', status = 'Finished',
  } = fx;
  const isGrandSlam = (typeof fx.isGrandSlam === 'boolean')
    ? fx.isGrandSlam
    : GRAND_SLAM_NAMES.has(tournamentName);

  // (1) PRIMARY — the explicit qualifying flag is authoritative.
  if (qualification === 'True') return { code: 'Q', qualifying: true, reason: 'flag' };

  const base = roundShort(tournamentRound);
  if (base === 'Q') return { code: 'Q', qualifying: true, reason: 'flag' };

  // (2)/(3) A `1/N-finals` fraction label is an authoritative main-draw signal
  // that the set-count net may not override; otherwise the tertiary net decides.
  if (isSlamSetCountQualifier({ isGrandSlam, tournamentRound, finalScore, status })) {
    return { code: 'Q', qualifying: true, reason: 'slam-set-count' };
  }

  return { code: base, qualifying: false, reason: 'main-draw' };
}

module.exports = {
  GRAND_SLAM_NAMES,
  ROUND_RANK,
  FRAC_ROUND_RE,
  isFracRound,
  roundShort,
  winnerSets,
  isSlamSetCountQualifier,
  classifyRound,
};
