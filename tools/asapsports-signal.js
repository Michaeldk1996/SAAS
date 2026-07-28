#!/usr/bin/env node
/**
 * asapsports-signal.js — "Player's own words" readiness signal for the board.
 *
 * TEN-8 / ten8-asapsports. Scope (locked by founder 2026-07-28):
 *   1. Scrape ASAP Sports tennis press-conference transcripts once or twice daily.
 *   2. For each player CURRENTLY ON THE BOARD (matches.json) with a pre-match
 *      transcript in their CURRENT tournament, run an LLM extraction against the
 *      transcript for the 5 betting-relevant readiness categories.
 *   3. Emit asapsports-signal.json keyed by profile key; the dashboard renders
 *      3-5 bullets per player, one short verbatim quote each. No transcript ->
 *      the player entry is simply absent and the card shows nothing.
 *
 * Deliberately simple: no sentiment-layer wiring, no separate pipeline. Just a
 * standalone scrape -> extract -> JSON that pipeline.yml copies into _site.
 *
 * Method notes (proven live, see the feasibility work):
 *   - ASAP Sports interview ids are GLOBAL + SEQUENTIAL across all sports. The
 *     <title> of show_interview.php?id=N carries everything we need:
 *       "ASAP Sports Transcripts - Tennis - 2026 - MUBADALA DC OPEN - July 25 - Taylor Fritz"
 *     so we walk ids and parse the title; event-listing pages are JS-rendered
 *     and useless to a plain fetch.
 *   - Pages are ISO-8859-1; decode as latin1 or accents mojibake.
 *   - Keyword/rule extraction is a dead end — the signal is indirect natural
 *     language. We use an LLM against a locked json_schema with a HARD
 *     no-fabrication rule (omit a category with no signal; never invent an injury).
 *
 * Flags:
 *   --self-test        run pure-function unit tests, exit 0/1 (no network, no key)
 *   --dry-run          scrape + match + build prompts, but DO NOT call the LLM;
 *                      writes bullets:[] with a _dryRun marker. Proves scrape/match.
 *   --max-id=N         override the high-water-mark discovery (debug)
 *   --window-days=N    date window for "current tournament" (default 8)
 *   --limit=N          cap number of transcripts fetched during the walk (debug)
 *   --out=PATH         output path (default ./asapsports-signal.json)
 *
 * Env: ANTHROPIC_API_KEY (required unless --dry-run/--self-test).
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------
const ROOT = path.resolve(__dirname, '..');
const MODEL = process.env.ASAP_MODEL || 'claude-opus-4-8';
const API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const BASE = 'https://www.asapsports.com/show_interview.php?id=';
const UA = 'Mozilla/5.0 (compatible; bsp-consult/1.0)';

// The 5 betting-relevant readiness categories (locked with founder).
const CATEGORIES = [
  'injury_physical',   // knee/back/wrist, treatment, physical state, "body feels good"
  'fatigue_workload',  // schedule, travel, minutes, "long three-setter", tiredness
  'confidence_mental', // momentum, self-belief, pressure, "everything is clicking"
  'form_self',         // how they read their own game/level right now
  'surface_conditions',// court speed, balls, altitude, heat, "the ball is flying"
];

// ---------------------------------------------------------------------------
// pure helpers (covered by --self-test)
// ---------------------------------------------------------------------------

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** Strip accents/punct, lowercase — for name matching. */
function deburr(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Normalize any name to `surname|firstInitial`, matching the frontend styleKey
 * idiom. Handles board form "A. Bublik" / "L. C. Alvarez Valdes" and ASAP title
 * form "Alexander Bublik" / "Luca Van Assche". Returns null if unusable.
 */
function nameKey(name) {
  const cleaned = deburr(name).replace(/[^a-z\s.]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  const toks = cleaned.split(' ').filter(Boolean);
  if (toks.length < 2) return null;
  // first initial = first alphabetic char of the first token
  const firstInitial = (toks[0].match(/[a-z]/) || [''])[0];
  // surname = last token that isn't a bare initial ("a." / "c.")
  let surname = null;
  for (let i = toks.length - 1; i >= 0; i--) {
    const t = toks[i].replace(/\./g, '');
    if (t.length >= 2) { surname = t; break; }
  }
  if (!surname || !firstInitial) return null;
  return `${surname}|${firstInitial}`;
}

/**
 * Parse an ASAP Sports interview <title> into structured fields.
 * "ASAP Sports Transcripts - Tennis - 2026 - MUBADALA DC OPEN - July 25 - Taylor Fritz"
 * Returns null for placeholder/empty titles (just "ASAP Sports Transcripts").
 */
function parseTitle(title) {
  if (!title) return null;
  const parts = title.split(' - ').map(s => s.trim()).filter(Boolean);
  // Need at least: header, sport, year, event, date, player  (>=6, event may
  // itself contain " - " so we anchor from both ends).
  if (parts.length < 6) return null;
  const sport = parts[1];
  const year = parseInt(parts[2], 10);
  const player = parts[parts.length - 1];
  const dateStr = parts[parts.length - 2];
  const event = parts.slice(3, parts.length - 2).join(' - ');
  if (!sport || !year || !player || !dateStr || !event) return null;
  const iso = parseDate(dateStr, year);
  if (!iso) return null;
  return { sport, year, event, dateStr, date: iso, player };
}

/** "July 25" + 2026 -> "2026-07-25". */
function parseDate(dateStr, year) {
  const m = deburr(dateStr).match(/([a-z]+)\s+(\d{1,2})/);
  if (!m) return null;
  const mon = MONTHS[m[1]];
  const day = parseInt(m[2], 10);
  if (!mon || !day || !year) return null;
  return `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Inclusive day difference b - a (ISO date strings). */
function dayDiff(aIso, bIso) {
  const a = Date.parse(aIso + 'T00:00:00Z');
  const b = Date.parse(bIso + 'T00:00:00Z');
  if (isNaN(a) || isNaN(b)) return NaN;
  return Math.round((b - a) / 86400000);
}

/**
 * Extract just the interviewed player's spoken words from the transcript HTML.
 * Format: speaker labels "THE MODERATOR:", "Q.", and "PLAYER NAME:". We keep the
 * player's own answers (their uppercase-name lines) plus the questions for
 * context, and drop nav/boilerplate. Returns plain text.
 */
function extractTranscript(html) {
  // The transcript sits inside the page; strip tags then keep from the first
  // speaker label onward.
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&mdash;/gi, '--')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  // Anchor at first real speaker label (Q. / THE MODERATOR / NAME:)
  let start = lines.findIndex(l => /^(Q\.|THE MODERATOR:|[A-Z][A-Z .'-]{2,}:)/.test(l));
  if (start < 0) start = 0;
  const body = lines.slice(start);
  // Drop trailing site boilerplate once we hit obvious nav footers.
  const stopIdx = body.findIndex(l => /FastScripts|About ASAP|Our Clients|Advertisement/i.test(l));
  const kept = stopIdx > 5 ? body.slice(0, stopIdx) : body;
  return kept.join('\n').trim();
}

/** Stable short hash for token-caching (no crypto dep needed). */
function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

// ---------------------------------------------------------------------------
// board -> players
// ---------------------------------------------------------------------------

/**
 * Read matches.json and return the players currently on the board:
 *   { key, name, nameKey, matchDate, tour }
 * matchDate = the player's EARLIEST upcoming match date (defines the pre-match
 * / current-tournament window).
 */
function boardPlayers(matches) {
  const map = new Map();
  for (const m of matches) {
    const sides = [
      { name: m.p1, key: m.p1Key, date: m.date, tour: m.tour },
      { name: m.p2, key: m.p2Key, date: m.date, tour: m.tour },
    ];
    for (const s of sides) {
      if (!s.key || !s.name) continue;
      const k = String(s.key);
      const nk = nameKey(s.name);
      if (!nk) continue;
      const prev = map.get(k);
      if (!prev) {
        map.set(k, { key: k, name: s.name, nameKey: nk, matchDate: s.date, tour: s.tour });
      } else if (s.date && (!prev.matchDate || s.date < prev.matchDate)) {
        prev.matchDate = s.date; // earliest upcoming
      }
    }
  }
  return Array.from(map.values());
}

// ---------------------------------------------------------------------------
// network
// ---------------------------------------------------------------------------

async function fetchLatin1(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (!res.ok) return { status: res.status, body: '' };
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, body: buf.toString('latin1') };
}

function titleOf(html) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1].trim() : '';
}

/** Walk ids upward from `seed` to find the current high-water mark. */
async function discoverMaxId(seed, log) {
  let maxId = seed;
  let miss = 0;
  let id = seed;
  while (miss < 20 && id < seed + 400) {
    id++;
    const { body } = await fetchLatin1(BASE + id).catch(() => ({ body: '' }));
    const t = parseTitle(titleOf(body));
    if (t) { maxId = id; miss = 0; } else { miss++; }
  }
  log(`  high-water-mark id = ${maxId}`);
  return maxId;
}

// ---------------------------------------------------------------------------
// LLM extraction
// ---------------------------------------------------------------------------

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['bullets'],
  properties: {
    bullets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['category', 'text', 'quote'],
        properties: {
          category: { type: 'string', enum: CATEGORIES },
          text: { type: 'string' },
          quote: { type: 'string' },
        },
      },
    },
  },
};

function buildSystem() {
  return [
    'You are a betting analyst reading a professional tennis player\'s own press-conference',
    'transcript to surface PRE-MATCH READINESS SIGNAL — the player\'s own words about how',
    'ready they are for their upcoming match. You output a short structured list of bullets.',
    '',
    'Extract signal for ONLY these 5 categories (use the exact category id):',
    '- injury_physical  : any injury, niggle, treatment, illness, or explicit physical state',
    '- fatigue_workload : schedule congestion, travel, long matches, tiredness, freshness',
    '- confidence_mental: momentum, self-belief, nerves, pressure, mindset',
    '- form_self        : the player\'s own read on their level/game right now',
    '- surface_conditions: court speed, balls, altitude, heat, wind, "the ball is flying"',
    '',
    'HARD RULES (a wrong bullet is worse than a missing one):',
    '1. NO FABRICATION. Include a bullet ONLY if the transcript genuinely supports it.',
    '   NEVER invent or infer an injury, fatigue, or any fact not stated by the player.',
    '2. Every bullet MUST cite a short VERBATIM quote copied from the transcript (<= ~25',
    '   words). The quote must be the player\'s own words, not the interviewer\'s question.',
    '3. Omit a category entirely if there is no genuine signal for it. Do not pad.',
    '4. Prefer 3-5 bullets, but return FEWER (even 0) rather than stretch weak signal.',
    '5. `text` is your <=1-sentence plain-English read of the signal (not a quote).',
    '6. Focus on what matters for the UPCOMING match; ignore small talk and off-topic banter.',
    'Return only the JSON object per the schema.',
  ].join('\n');
}

function buildUser(player, event, transcript) {
  // Cap transcript size to keep tokens bounded; readiness signal is dense near
  // the player's substantive answers, and we keep the full body up to the cap.
  const capped = transcript.length > 16000 ? transcript.slice(0, 16000) : transcript;
  return [
    `Player: ${player}`,
    `Event: ${event}`,
    '',
    'Transcript (verbatim press conference):',
    '"""',
    capped,
    '"""',
  ].join('\n');
}

async function extract(player, event, transcript, apiKey) {
  const body = {
    model: MODEL,
    max_tokens: 1500,
    thinking: { type: 'adaptive' },
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
    },
    system: buildSystem(),
    messages: [{ role: 'user', content: buildUser(player, event, transcript) }],
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
    const t = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new Error('model refused');
  // structured output is returned as JSON in the first text block
  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('no text block in response');
  let parsed;
  try { parsed = JSON.parse(textBlock.text); }
  catch (e) { throw new Error('bad JSON from model: ' + textBlock.text.slice(0, 200)); }
  const bullets = Array.isArray(parsed.bullets) ? parsed.bullets : [];
  // Defensive: verify each quote actually appears in the transcript (anti-fabrication
  // backstop). Drop any bullet whose quote we can't find verbatim (fuzzy on whitespace).
  const normT = transcript.replace(/\s+/g, ' ').toLowerCase();
  return bullets.filter(b => {
    if (!b || !CATEGORIES.includes(b.category) || !b.quote || !b.text) return false;
    const q = String(b.quote).replace(/\s+/g, ' ').toLowerCase().replace(/^["']|["']$/g, '').trim();
    if (q.length < 8) return false;
    return normT.includes(q.slice(0, Math.min(q.length, 60)));
  }).slice(0, 5);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const a = { flags: {}, };
  for (const x of argv) {
    const m = x.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) a.flags[m[1]] = m[2] === undefined ? true : m[2];
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags['self-test']) return process.exit(selfTest() ? 0 : 1);

  const dryRun = !!args.flags['dry-run'];
  const windowDays = parseInt(args.flags['window-days'], 10) || 8;
  const limit = parseInt(args.flags['limit'], 10) || 0;
  const outPath = args.flags['out'] || path.join(ROOT, 'asapsports-signal.json');
  const log = (...m) => console.log(...m);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey && !dryRun) {
    console.error('ANTHROPIC_API_KEY is not set (required unless --dry-run).');
    process.exit(3);
  }

  // today's date (UTC) — CI provides real time; overridable for tests
  const today = args.flags['today'] || new Date().toISOString().slice(0, 10);

  const matchesPath = args.flags['matches'] || path.join(ROOT, 'matches.json');
  const matches = JSON.parse(fs.readFileSync(matchesPath, 'utf8'));
  const players = boardPlayers(matches);
  const byNameKey = new Map();
  for (const p of players) {
    if (!byNameKey.has(p.nameKey)) byNameKey.set(p.nameKey, []);
    byNameKey.get(p.nameKey).push(p);
  }
  log(`Board: ${players.length} players across ${matches.length} matches.`);

  // Load previous output for token-caching (reuse bullets when transcript unchanged).
  let prev = {};
  try { prev = (JSON.parse(fs.readFileSync(outPath, 'utf8')).players) || {}; } catch (e) {}

  // Discover id range to walk.
  const seed = parseInt(args.flags['max-id'], 10) || await discoverMaxId(
    parseInt(args.flags['seed'], 10) || 220856, log);
  const maxId = seed;

  // Walk ids downward, collecting the LATEST qualifying tennis transcript per board player.
  const chosen = new Map(); // playerKey -> { player, meta, transcript }
  let fetched = 0;
  let tennisSeen = 0; // parseable tennis transcripts encountered (scrape-health signal)
  let oldRun = 0; // consecutive too-old tennis transcripts -> stop
  for (let id = maxId; id > maxId - 600 && oldRun < 25; id--) {
    if (limit && fetched >= limit) break;
    const { body } = await fetchLatin1(BASE + id).catch(() => ({ body: '' }));
    fetched++;
    const meta = parseTitle(titleOf(body));
    if (!meta) continue;
    if (!/tennis/i.test(meta.sport)) continue;
    tennisSeen++;
    // Too old for the whole board? (older than window before today)
    if (dayDiff(meta.date, today) > windowDays + 2) { oldRun++; continue; }
    oldRun = 0;
    const nk = nameKey(meta.player);
    const cands = byNameKey.get(nk);
    if (!cands) continue;
    for (const p of cands) {
      // current-tournament + pre-match: transcript within [matchDate - windowDays, matchDate]
      const d1 = dayDiff(meta.date, p.matchDate); // matchDate - transcriptDate (>=0 => before match)
      if (isNaN(d1) || d1 < -1 || d1 > windowDays) continue; // allow same-day (>=-1)
      if (chosen.has(p.key)) continue; // we walk newest->oldest, keep the first (latest)
      const transcript = extractTranscript(body);
      if (transcript.length < 200) continue; // too thin to be a real transcript
      chosen.set(p.key, {
        player: p,
        meta,
        transcript,
        id,
        url: BASE + id,
      });
    }
  }
  log(`Walked ${fetched} ids (${tennisSeen} tennis); matched ${chosen.size} board players to a transcript.`);

  // Scrape-health guard: if we saw NO parseable tennis transcripts at all, the
  // site is likely unreachable/changed. Do NOT overwrite a previously-good file
  // with an empty result (that would wipe every card). A genuinely empty board
  // (tennis seen, just no board matches) is allowed to clear the cards.
  if (tennisSeen === 0 && Object.keys(prev).length > 0) {
    log('No tennis transcripts seen but a prior signal file exists — keeping it (assuming transient scrape failure). No write.');
    process.exit(0);
  }

  // Extract (or reuse cache / dry-run stub).
  const out = { generatedAt: new Date().toISOString(), source: 'ASAP Sports', players: {} };
  let called = 0, reused = 0;
  for (const [key, c] of chosen) {
    const h = hash(c.transcript);
    const cached = prev[key];
    let bullets;
    if (cached && cached.hash === h && Array.isArray(cached.bullets) && !cached._dryRun) {
      bullets = cached.bullets; reused++;
    } else if (dryRun) {
      bullets = [];
    } else {
      try {
        bullets = await extract(c.meta.player, c.meta.event, c.transcript, apiKey);
        called++;
      } catch (e) {
        log(`  ! extraction failed for ${c.player.name}: ${e.message}`);
        continue; // skip; player just shows nothing
      }
    }
    if (!dryRun && bullets.length === 0) continue; // nothing to show -> omit entry
    out.players[key] = {
      name: c.meta.player,
      tournament: c.meta.event,
      date: c.meta.date,
      interviewId: c.id,
      sourceUrl: c.url,
      hash: h,
      bullets,
      ...(dryRun ? { _dryRun: true } : {}),
    };
  }

  // Atomic write.
  fs.writeFileSync(outPath + '.tmp', JSON.stringify(out, null, 2));
  fs.renameSync(outPath + '.tmp', outPath);
  log(`Wrote ${outPath}: ${Object.keys(out.players).length} players (LLM calls: ${called}, reused: ${reused}).`);
}

// ---------------------------------------------------------------------------
// self-test (pure functions, no network / no key)
// ---------------------------------------------------------------------------

function selfTest() {
  let ok = true;
  const eq = (got, want, msg) => {
    const g = JSON.stringify(got), w = JSON.stringify(want);
    if (g !== w) { ok = false; console.error(`FAIL ${msg}\n  got  ${g}\n  want ${w}`); }
    else console.log(`ok   ${msg}`);
  };

  eq(nameKey('A. Bublik'), 'bublik|a', 'nameKey board initial form');
  eq(nameKey('Alexander Bublik'), 'bublik|a', 'nameKey full form matches board');
  eq(nameKey('L. C. Alvarez Valdes'), 'valdes|l', 'nameKey two-initial board');
  eq(nameKey('Lorenzo Carlos Alvarez Valdes'), 'valdes|l', 'nameKey long full matches');
  eq(nameKey('L. van Assche'), 'assche|l', 'nameKey with lowercase prefix (board)');
  eq(nameKey('Luca Van Assche'), 'assche|l', 'nameKey with prefix (title) matches');
  // Hyphenated surname: what matters is that BOTH forms normalize identically so
  // they still match each other (last token wins on both sides).
  eq(nameKey('Félix Auger-Aliassime'), 'aliassime|f', 'nameKey deburr + hyphen (title form)');
  eq(nameKey('F. Auger-Aliassime'), nameKey('Félix Auger-Aliassime'), 'hyphen board==title consistency');
  eq(nameKey('Solo'), null, 'nameKey single token -> null');

  const t = parseTitle('ASAP Sports Transcripts - Tennis - 2026 - MUBADALA DC OPEN - July 25 - Taylor Fritz');
  eq(t && t.sport, 'Tennis', 'parseTitle sport');
  eq(t && t.event, 'MUBADALA DC OPEN', 'parseTitle event');
  eq(t && t.date, '2026-07-25', 'parseTitle date');
  eq(t && t.player, 'Taylor Fritz', 'parseTitle player');
  eq(parseTitle('ASAP Sports Transcripts'), null, 'parseTitle placeholder -> null');

  eq(parseDate('July 25', 2026), '2026-07-25', 'parseDate');
  eq(dayDiff('2026-07-25', '2026-07-28'), 3, 'dayDiff');

  const html = '<html><body><b>THE MODERATOR:</b> Welcome.<br>' +
    '<b>TAYLOR FRITZ:</b> The knee feels good, I have been serving well.<br>' +
    '<b>Q.</b> How is the surface?<br>' +
    '<b>TAYLOR FRITZ:</b> The ball is flying out here.<br>FastScripts by ASAP</body></html>';
  const tr = extractTranscript(html);
  eq(/knee feels good/.test(tr), true, 'extractTranscript keeps player words');
  eq(/FastScripts/.test(tr), false, 'extractTranscript drops footer');

  const bp = boardPlayers([{ p1: 'A. Bublik', p1Key: 1895, p2: 'Q. Halys', p2Key: 1925, date: '2026-07-25', tour: 'ATP Kitzbuhel' }]);
  eq(bp.length, 2, 'boardPlayers count');
  eq(bp[0].nameKey, 'bublik|a', 'boardPlayers nameKey');

  return ok;
}

if (require.main === module) {
  main().catch(e => { console.error(e && e.stack || e); process.exit(1); });
}

module.exports = { nameKey, parseTitle, parseDate, dayDiff, extractTranscript, boardPlayers, hash };
