// TEN-225 item 2 — the consumer's row key, and the one thing that can silently
// destroy the archive if it is wrong.
//
// THE PROBLEM, STATED PLAINLY. kibl_client.observation_key() is
//
//     "|".join(str(row.get(f)) for f in (... 18 fields ...))
//
// and that key is the conflict target of an IGNORE-DUPLICATES insert. The sweep
// and the stream will both see the same observation — that is the point of
// keeping the sweep as a backstop — so dedupe depends on the two writers
// agreeing on the key BYTE FOR BYTE.
//
// Python's str() and JavaScript's String() disagree on exactly the value types
// that dominate this row:
//
//     value      Python str()   JS String()
//     None       "None"         "null"        <- all 17 fields are nullable
//     True       "True"         "true"        <- is_opener/is_previous/is_current
//     False      "False"        "false"
//     2.0        "2.0"          "2"           <- price_decimal on a book quoting evens
//
// A naive port therefore produces a different key on essentially every row, and
// the failure is NOT an error: every streamed observation looks new, the archive
// stores a second copy of rows it already holds, and "first sighting wins
// forever" — which the Open depends on — quietly stops holding. `rows_new` would
// read as a busy market.
//
// THE INTEGRAL-FLOAT CASE CANNOT BE SOLVED AFTER A PARSE. Once JSON.parse has
// run, 2 and 2.0 are the same double and no amount of formatting recovers which
// one the sender wrote. So the key is built from the SOURCE LEXEME, captured
// during the parse via JSON.parse's source-text access, which is exact, handles
// nesting, and works per row in a multi-row message.
//
// ⚠️ A PYTHON WORKER WOULD NOT NEED ANY OF THIS. It would import the same
// function the sweep uses and this whole failure class would not exist. Node was
// the founder's stated choice, this is buildable and tested, and the trade is
// written up in the README rather than hidden here.

/** Python's str() for the value types that occur on a Kibl participant row. */
export function pyStr(v) {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'nan';
    if (v === Infinity) return 'inf';
    if (v === -Infinity) return '-inf';
    // Reached only when no lexeme was captured. An integral float is
    // INDISTINGUISHABLE from an int here, so this branch can be wrong and the
    // capability check below exists to make sure it is never the main path.
    return `${v}`;
  }
  return String(v);
}

export const KEY_FIELDS = [
  'uuid', 'market_id', 'fixture_id', 'fixture_participant_id',
  'market_type_id', 'segment_id', 'side_id', 'point', 'alt_id',
  'feed_source_id', 'betting_type_id',
  'is_opener', 'is_previous', 'is_current',
  'price_american', 'price_decimal', 'inserted_on',
];

const LEX = Symbol('json-source-lexemes');

/** Is JSON.parse source-text access available on this runtime? */
export function hasSourceAccess() {
  let seen = false;
  try {
    JSON.parse('{"a":1.0}', function (_k, v, ctx) {
      if (ctx && typeof ctx.source === 'string') seen = true;
      return v;
    });
  } catch (e) { return false; }
  return seen;
}

/**
 * Refuse to start on a runtime that cannot capture lexemes.
 *
 * FAIL LOUD, NEVER FALL BACK. A silent fallback to pyStr() for numbers is the
 * archive-doubling failure at the top of this file, and it would present as a
 * healthy worker writing lots of "new" rows — the most convincing possible
 * disguise for the thing going wrong.
 */
export function assertSourceAccess() {
  if (!hasSourceAccess()) {
    throw new Error(
      'JSON.parse source-text access is unavailable on this runtime (needs Node >= 21). '
      + 'Refusing to start: without it an integral float (2.0) keys as "2" where the '
      + 'sweep keys it "2.0", every streamed row looks new, and the archive doubles '
      + 'while reporting a busy market.');
  }
}

/** JSON.parse that remembers the source text of every numeric leaf. */
export function parseWithLexemes(text) {
  return JSON.parse(text, function (k, v, ctx) {
    if (ctx && typeof ctx.source === 'string' && typeof v === 'number') {
      if (!Object.prototype.hasOwnProperty.call(this, LEX)) {
        Object.defineProperty(this, LEX, { value: Object.create(null), enumerable: false });
      }
      this[LEX][k] = ctx.source;
    }
    return v;
  });
}

/**
 * observation_key(), byte-compatible with kibl_client.observation_key().
 *
 * Reads the captured lexeme where one exists, so a number contributes exactly
 * the characters the sender wrote; otherwise pyStr(), which knows Python's
 * spelling of None and the booleans.
 */
export function observationKey(row) {
  const lex = row ? row[LEX] : null;
  return KEY_FIELDS.map(f => {
    if (lex && Object.prototype.hasOwnProperty.call(lex, f)) return lex[f];
    return pyStr(row ? row[f] : undefined);
  }).join('|');
}
