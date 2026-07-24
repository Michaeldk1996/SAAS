'use strict';

/**
 * sentiment.js — Layer #2 "Sentiment" scorer for the BSP Consult Tennis Edge model.
 *
 * WHAT THIS IS (per founder spec, TEN-8):
 *   Layer #2 is NOT an automated data feed. It is an AI scorer that reads raw
 *   TEXT the moderator (Michael) feeds in before a match — injury reports, press
 *   conference quotes, practice-court observations, analyst takes — and turns it
 *   into a single numeric signal the model already knows how to consume.
 *
 *   The model's layer #2 ("Subjective input", h2h-model/adjustments.js) reads
 *   `manual-inputs.json:subjective[<matchId>] = { signal }`, where `signal` is in
 *   [-1, +1] from the LEFT player's (p1's) point of view (+ leans to p1, - leans
 *   to p2, 0 = neutral), contributing up to +/-10 probability points
 *   (maxMagnitude 0.10). This tool's ONLY job is to produce that `signal` from
 *   free text, so the moderator no longer hand-guesses the number.
 *
 * WHAT IT IS NOT:
 *   It does not scrape anything, does not run in CI, and does not touch the live
 *   pipeline. Michael invokes it manually, per match, before analysing. The score
 *   only reaches the model once he pastes the emitted row into manual-inputs.json
 *   (or runs this with --write).
 *
 * USAGE
 *   ANTHROPIC_API_KEY=... node sentiment.js \
 *       --p1 "Jannik Sinner" --p2 "Carlos Alcaraz" \
 *       --match upcoming-12147451 \
 *       --file ./notes.txt
 *
 *   # text can come from --text, --file, or stdin:
 *   cat notes.txt | node sentiment.js --p1 "A. Player" --p2 "B. Player" --match <id>
 *   node sentiment.js --p1 A --p2 B --match <id> --text "A tweaked an ankle in practice; B looked sharp."
 *
 *   # merge the result straight into h2h-model/manual-inputs.json:
 *   node sentiment.js ... --write
 *
 *   # offline sanity checks, no API call, no key needed:
 *   node sentiment.js --self-test
 *
 * FLAGS
 *   --p1 <name>        Left player (required unless --self-test)
 *   --p2 <name>        Right player (required unless --self-test)
 *   --match <id>       matches.json entry id, e.g. upcoming-12147451 (required to
 *                      emit/write a keyed row; without it the score still prints)
 *   --file <path>      Read the source text from a file
 *   --text "<...>"     Provide the source text inline
 *   (stdin)            If neither --file nor --text is given, read stdin
 *   --write            Merge the row into h2h-model/manual-inputs.json:subjective
 *   --model <id>       Override the Claude model (default claude-opus-4-8)
 *   --json             Print only the manual-inputs row JSON (for piping)
 *   --self-test        Run offline unit checks and exit
 *
 * Output contract matches the model exactly: signal is clamped to [-1, 1] and is
 * always stated from p1's perspective. If the text carries no usable signal for
 * either side, the tool returns signal 0 (neutral) — which the model treats as
 * "no manual input", so a neutral score is safe and never fabricates an edge.
 */

const fs = require('fs');
const path = require('path');

const MODEL_DEFAULT = 'claude-opus-4-8';
const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const MANUAL_INPUTS_PATH = path.join(__dirname, 'h2h-model', 'manual-inputs.json');

// ---------------------------------------------------------------------------
// small helpers (pure — covered by --self-test)
// ---------------------------------------------------------------------------

function clampSignal(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-1, Math.min(1, n));
}

// Round to 2dp so the persisted number is stable and human-readable.
function round2(x) {
  return Math.round(clampSignal(x) * 100) / 100;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true; // boolean flag
      } else {
        out[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

// Build the moderator row exactly as the model expects it.
function buildSubjectiveRow(matchId, signal, note, asOf) {
  return {
    [String(matchId)]: {
      signal: round2(signal),
      note: note || '',
      asOf: asOf || null,
      source: 'sentiment.js',
    },
  };
}

// Merge a row into manual-inputs.json:subjective without disturbing other keys
// or the wue block. Returns the updated object (does not write).
function mergeSubjective(existing, matchId, row) {
  const doc = existing && typeof existing === 'object' ? existing : {};
  if (!doc.subjective || typeof doc.subjective !== 'object') doc.subjective = {};
  doc.subjective[String(matchId)] = row[String(matchId)];
  return doc;
}

// ---------------------------------------------------------------------------
// prompt construction
// ---------------------------------------------------------------------------

function buildPrompt(p1, p2, text) {
  const system =
    'You are a tennis match-preview sentiment analyst for a betting-analytics model. ' +
    'You read raw pre-match text (injury reports, press-conference quotes, practice ' +
    'observations, analyst takes) and distil it into ONE signed sentiment signal for ' +
    'a single match. You never invent facts not present in the text. You judge only ' +
    'match-relevant sentiment: fitness/injury, form, confidence, motivation, off-court ' +
    'disruption, court/conditions fit. Ignore generic hype and betting-market noise.';

  const user =
    `MATCH: ${p1} (LEFT / p1) vs ${p2} (RIGHT / p2)\n\n` +
    'Score the NET pre-match sentiment as a single number `signal` in [-1, +1] from ' +
    `${p1}'s (the LEFT / p1) point of view:\n` +
    `  +1.0  overwhelmingly favourable to ${p1} (or badly unfavourable to ${p2})\n` +
    `  +0.5  clearly leans to ${p1}\n` +
    '   0.0  neutral, mixed, or no usable signal in the text\n' +
    `  -0.5  clearly leans to ${p2}\n` +
    `  -1.0  overwhelmingly favourable to ${p2} (or badly unfavourable to ${p1})\n\n` +
    'Rules:\n' +
    '- Base the score ONLY on the text below. If the text says nothing match-relevant ' +
    'about either player, return 0.\n' +
    '- A negative for one player is a positive for the other; net them into one number.\n' +
    '- Weight concrete, recent, physical facts (an injury, a walkover, a coaching split) ' +
    'above vague opinion.\n' +
    '- Keep the magnitude honest: most real previews land between -0.5 and +0.5. Reserve ' +
    '|signal| > 0.7 for a decisive, specific edge (e.g. a confirmed injury).\n\n' +
    '=== SOURCE TEXT ===\n' +
    text.trim() +
    '\n=== END SOURCE TEXT ===';

  return { system, user };
}

// JSON schema for the structured response (Opus 4.8 structured outputs).
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    signal: { type: 'number' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    p1_factors: { type: 'array', items: { type: 'string' } },
    p2_factors: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
  },
  required: ['signal', 'confidence', 'p1_factors', 'p2_factors', 'rationale'],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

async function scoreSentiment({ p1, p2, text, model, apiKey }) {
  const { system, user } = buildPrompt(p1, p2, text);
  const body = {
    model: model || MODEL_DEFAULT,
    max_tokens: 1024,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
    },
    system,
    messages: [{ role: 'user', content: user }],
  };

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${errText.slice(0, 400)}`);
  }

  const data = await res.json();
  if (data.stop_reason === 'refusal') {
    throw new Error('Model refused to score this text (stop_reason=refusal).');
  }
  // With output_config.format the first text block is guaranteed valid JSON.
  const block = (data.content || []).find((b) => b.type === 'text');
  if (!block) throw new Error('No text block in the model response.');
  let parsed;
  try {
    parsed = JSON.parse(block.text);
  } catch (e) {
    throw new Error('Model response was not valid JSON: ' + block.text.slice(0, 200));
  }
  parsed.signal = round2(parsed.signal);
  return parsed;
}

// ---------------------------------------------------------------------------
// offline self-test
// ---------------------------------------------------------------------------

function selfTest() {
  const checks = [];
  const eq = (name, got, want) =>
    checks.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });

  // clampSignal
  eq('clamp +2 -> 1', clampSignal(2), 1);
  eq('clamp -2 -> -1', clampSignal(-2), -1);
  eq('clamp NaN -> 0', clampSignal('nope'), 0);
  eq('clamp 0.4 -> 0.4', clampSignal(0.4), 0.4);

  // round2
  eq('round 0.376 -> 0.38', round2(0.376), 0.38);
  eq('round 1.9 -> 1 (clamped)', round2(1.9), 1);

  // buildSubjectiveRow shape matches the model contract
  const row = buildSubjectiveRow('upcoming-123', 1.5, 'ankle', '2026-07-24');
  eq('row clamps signal', row['upcoming-123'].signal, 1);
  eq('row keeps note', row['upcoming-123'].note, 'ankle');
  eq('row source tag', row['upcoming-123'].source, 'sentiment.js');

  // mergeSubjective preserves wue + other keys
  const existing = { subjective: { 'old-1': { signal: 0.2 } }, wue: { keep: true } };
  const merged = mergeSubjective(existing, 'new-2', buildSubjectiveRow('new-2', -0.5, '', null));
  eq('merge keeps old subjective', merged.subjective['old-1'].signal, 0.2);
  eq('merge adds new subjective', merged.subjective['new-2'].signal, -0.5);
  eq('merge preserves wue block', merged.wue.keep, true);

  // prompt is stateful about p1 perspective
  const { user } = buildPrompt('Left Player', 'Right Player', 'some notes');
  checks.push({
    name: 'prompt names p1 as LEFT',
    ok: user.includes('Left Player') && user.includes('LEFT / p1'),
  });

  const passed = checks.filter((c) => c.ok).length;
  for (const c of checks) {
    if (c.ok) console.log(`  ok   ${c.name}`);
    else console.log(`  FAIL ${c.name}  got=${JSON.stringify(c.got)} want=${JSON.stringify(c.want)}`);
  }
  console.log(`\n${passed}/${checks.length} checks passed`);
  return passed === checks.length;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function readSourceText(args) {
  if (args.text && typeof args.text === 'string') return args.text;
  if (args.file && typeof args.file === 'string') return fs.readFileSync(args.file, 'utf8');
  // fall back to stdin
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (e) {
    return '';
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args['self-test']) {
    process.exit(selfTest() ? 0 : 1);
  }

  if (!args.p1 || !args.p2) {
    console.error('Error: --p1 and --p2 are required (or use --self-test).');
    process.exit(2);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      'Error: ANTHROPIC_API_KEY is not set. sentiment.js needs it to score text.\n' +
        '  export ANTHROPIC_API_KEY=sk-ant-...   then re-run.'
    );
    process.exit(3);
  }

  const text = readSourceText(args);
  if (!text || !text.trim()) {
    console.error('Error: no source text (use --text, --file, or pipe via stdin).');
    process.exit(2);
  }

  let result;
  try {
    result = await scoreSentiment({
      p1: args.p1,
      p2: args.p2,
      text,
      model: typeof args.model === 'string' ? args.model : MODEL_DEFAULT,
      apiKey,
    });
  } catch (e) {
    console.error('Scoring failed: ' + e.message);
    process.exit(1);
  }

  const asOf = new Date().toISOString().slice(0, 10);
  const note = `sentiment.js: ${result.rationale}`.slice(0, 400);
  const matchId = typeof args.match === 'string' ? args.match : null;
  const row = matchId ? buildSubjectiveRow(matchId, result.signal, note, asOf) : null;

  if (args.json && row) {
    console.log(JSON.stringify(row, null, 2));
    return;
  }

  // Human-readable summary
  console.log('');
  console.log(`  ${args.p1}  vs  ${args.p2}`);
  console.log(`  signal:      ${result.signal >= 0 ? '+' : ''}${result.signal}   (from ${args.p1}'s POV; + = leans ${args.p1})`);
  console.log(`  confidence:  ${result.confidence}`);
  if (result.p1_factors.length) console.log(`  ${args.p1}: ${result.p1_factors.join('; ')}`);
  if (result.p2_factors.length) console.log(`  ${args.p2}: ${result.p2_factors.join('; ')}`);
  console.log(`  rationale:   ${result.rationale}`);
  console.log('');

  if (!matchId) {
    console.log('  (no --match id given — nothing to write. Add --match <id> to emit a manual-inputs row.)');
    return;
  }

  if (args.write) {
    let existing = {};
    if (fs.existsSync(MANUAL_INPUTS_PATH)) {
      existing = JSON.parse(fs.readFileSync(MANUAL_INPUTS_PATH, 'utf8'));
    }
    const merged = mergeSubjective(existing, matchId, row);
    fs.writeFileSync(MANUAL_INPUTS_PATH, JSON.stringify(merged, null, 2) + '\n');
    console.log(`  wrote subjective["${matchId}"] to ${path.relative(process.cwd(), MANUAL_INPUTS_PATH)}`);
  } else {
    console.log('  paste this into h2h-model/manual-inputs.json under "subjective" (or re-run with --write):');
    console.log('');
    console.log(JSON.stringify(row, null, 2));
  }
}

// Export pure helpers for testing / reuse.
module.exports = {
  clampSignal,
  round2,
  parseArgs,
  buildSubjectiveRow,
  mergeSubjective,
  buildPrompt,
  scoreSentiment,
  OUTPUT_SCHEMA,
};

if (require.main === module) {
  main().catch((e) => {
    console.error(e && e.stack ? e.stack : String(e));
    process.exit(1);
  });
}
