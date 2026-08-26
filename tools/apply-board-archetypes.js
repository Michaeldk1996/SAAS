#!/usr/bin/env node
// =============================================================================
// Apply board-finalized archetype labels over the classify-styles.js output.
//
// WHY THIS EXISTS: playing-styles.json is regenerated every day by
// classify-styles.js (see tools/refresh-playing-styles.sh). That generator emits
// the OLD free-string taxonomy ("Counter Puncher / All-Court Player") plus a
// per-player `primary` machine key and `archetype_scores` radar — none of which
// match the board-finalized v5.1 labels. Hand-editing playing-styles.json does
// NOT survive: the next daily refresh overwrites it. So the board taxonomy has
// to be re-applied AFTER every regeneration. This script is that step; the daily
// refresh calls it right after classify-styles.js.
//
// WHAT IT DOES (board decision, TEN-12, 2026-08-26):
//   - Labelled set: writes the board `archetype_label` (compound serve labels kept
//     as single strings) and a `variety: true` boolean (rendered as a
//     "+ Variety Player" chip). Matched on surname + first initial with accent
//     folding, so the corrected file's name form (e.g. "A. Shelbayh", "Jodar")
//     resolves against the site's form ("Abedallah Shelbayh", "R. Jodar").
//   - EVERY player (labelled and not): the old-taxonomy `primary` and
//     `archetype_scores` are DELETED. That retires the old radar/grid/badge
//     taxonomy across all four surfaces (profile card, header style line, edge
//     badges, archetype-vs-archetype grid). The radar/matrix are redesigned
//     separately later — this script deliberately does not regenerate them.
//   - Unlabelled players: `archetype_label` is also deleted -> the dashboard
//     shows "Not yet classified", no radar.
//
// Board players not present in the roster (e.g. sub-floor debutants below the
// classify-styles 20-match / 400-serve-point reliability gate) simply don't match
// this run. Nothing is lost: the moment classify-styles.js admits them, their
// held label auto-applies on the next daily run. Reported at the end.
//
// Idempotent. Safe to run any number of times.
// =============================================================================
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STYLES = path.join(ROOT, 'playing-styles.json');
const BOARD = path.join(__dirname, 'board-archetypes.json');

function fold(s) {
  return String(s == null ? '' : s)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}
// split glued initials: "D.Medvedev" -> "D. Medvedev"
function norm(name) { return String(name || '').trim().replace(/\.(?=\S)/g, '. '); }
function parts(name) {
  const toks = norm(name).split(/\s+/).filter(Boolean);
  if (toks.length <= 1) return [null, toks];
  return [toks[0], toks.slice(1)];
}
const initialOf = ft => { const f = fold(ft); return f ? f[0] : null; };
const skey = st => fold(st.join(''));                 // full surname (all tokens after the first)
const lastkey = st => (st.length ? fold(st[st.length - 1]) : '');

function buildIndexes(players) {
  const surnInit = new Map(), lastInit = new Map(), surn = new Map();
  const push = (m, k, p) => { const a = m.get(k) || []; a.push(p); m.set(k, a); };
  for (const p of players) {
    const [ft, st] = parts(p.name); const i = initialOf(ft);
    push(surnInit, skey(st) + '|' + i, p);
    push(lastInit, lastkey(st) + '|' + i, p);
    push(surn, skey(st), p);
  }
  return { surnInit, lastInit, surn };
}

function main() {
  const doc = JSON.parse(fs.readFileSync(STYLES, 'utf8'));
  const players = doc.players || [];
  const board = JSON.parse(fs.readFileSync(BOARD, 'utf8')).players || [];
  const idx = buildIndexes(players);

  const match = (name) => {
    const [ft, st] = parts(name); const i = initialOf(ft);
    let h = idx.surnInit.get(skey(st) + '|' + i) || [];
    if (h.length === 1) return h[0];
    if (h.length > 1) return null;                    // ambiguous surname+initial
    h = idx.lastInit.get(lastkey(st) + '|' + i) || [];
    if (h.length === 1) return h[0];
    if (h.length > 1) return null;
    h = idx.surn.get(skey(st)) || [];
    if (h.length === 1) return h[0];
    return null;                                      // absent or collision
  };

  // 1) retire the old taxonomy on EVERY player
  for (const p of players) { delete p.primary; delete p.archetype_scores; delete p.archetype_label; }

  // 2) write board labels onto the matched set
  const matched = new Set(); const absent = [];
  for (const b of board) {
    const p = match(b.name);
    if (!p || matched.has(p)) { if (!p) absent.push(b.name); continue; }
    matched.add(p);
    p.archetype_label = b.label;
    if (b.variety) p.variety = true; else delete p.variety;
  }
  // any pre-existing variety flag on a now-unlabelled player is stale
  for (const p of players) { if (!matched.has(p)) delete p.variety; }

  fs.writeFileSync(STYLES, JSON.stringify(doc, null, 2) + '\n');

  const varN = players.filter(p => p.variety).length;
  console.log(`apply-board-archetypes: roster=${players.length} labelled=${matched.size} unlabelled=${players.length - matched.size} variety=${varN}`);
  console.log(`board rows=${board.length} matched=${matched.size} unmatched(held)=${absent.length}`);
  if (absent.length) console.log('  held (not in roster this run): ' + absent.join(', '));
}

main();
