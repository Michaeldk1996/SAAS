#!/usr/bin/env node
// TEN-263 D-12: Elo name keys (surname + first initial, fetch-elo.js eloKey) that more than one feed
// player uses. The Elo report is keyed by name, so for these keys a name join cannot tell whose
// rating it is ("J. D. Silva" and "J. Reis Da Silva" are both silva|j; Zhizhen and Ze Zhang are
// both zhang|z). The Form tab shows "ELO —" for every such key rather than risk the wrong player.
//
// Universe: every player the pipeline holds this run — player-profiles.json (the roster, by key)
// and every form/{key}.json shard's opponents (opponentKey). Written as elo-key-conflicts.json,
// rebuilt every run, deployed; "Assert site completeness" requires it. Run from the repo root.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
// Same as fetch-elo.js eloKey() — keep the two in sync.
export function eloKey(name) {
  const p = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&nbsp;/g, ' ')
    .replace(/['’]/g, '').replace(/[.\-]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  return p.length < 2 ? null : p[p.length - 1] + '|' + p[0][0];
}
export function conflicts(pairs) {
  const own = new Map();
  for (const [name, key] of pairs) {
    const k = eloKey(name);
    if (!k || key == null || key === '') continue;
    if (!own.has(k)) own.set(k, new Set());
    own.get(k).add(String(key));
  }
  const out = {};
  for (const [k, s] of [...own.entries()].sort()) if (s.size > 1) out[k] = [...s].sort();
  return { keys: own.size, conflicts: out };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pairs = [];
  let profiles = 0, shards = 0;
  try {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'player-profiles.json'), 'utf8'));
    const p = d.players || d;
    for (const [key, v] of Object.entries(p)) if (v && v.name) { pairs.push([v.name, key]); profiles++; }
  } catch (e) { console.warn(`elo-key-conflicts: player-profiles.json unreadable (${e.message})`); }
  const dir = path.join(ROOT, 'form');
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (!f.endsWith('.json')) continue;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      for (const r of d.matches || []) pairs.push([r.opponent, r.opponentKey]);
      shards++;
    } catch { /* a bad shard is skipped, and counted below */ }
  }
  const { keys, conflicts: c } = conflicts(pairs);
  if (!profiles) throw new Error('elo-key-conflicts: no roster read — refusing to publish an empty guard');
  fs.writeFileSync(path.join(ROOT, 'elo-key-conflicts.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), sources: { profiles, formShards: shards, keys }, conflicts: c }));
  console.log(`elo-key-conflicts: ${Object.keys(c).length} shared keys of ${keys} (roster ${profiles}, form shards ${shards}): ${Object.keys(c).join(', ')}`);
}
