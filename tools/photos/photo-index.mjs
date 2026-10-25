// The self-hosted photo index's update rule (founder 2026-10-24), pure so CI can test it without a browser.
// tools/photos/fetch-headshots.mjs calls it once per run.
//
//   nextIndex({ aliases, prev, results, only }) -> { players, removed, kept, failed }
//     aliases  player-atp-aliases.json: { id: atpCode }
//     prev     the last index's players: { id: entry }
//     results  this run, per fetched id: { ok: true, entry } | { ok: false, why }
//     only     a Set of ids this run fetched (a partial run), or null (every alias)
//
//   - a fetched photo replaces the entry;
//   - a failed fetch KEEPS the last good entry (and its files) for the same ATP code, with lastError — never a deletion;
//   - an id not fetched this run (partial run) carries over;
//   - an id whose alias was REMOVED from the map is dropped (its files are deleted by the caller): a curation fix
//     (a wrong person, a silhouette) must take effect;
//   - an id whose alias CHANGED code keeps nothing from the old code: an old photo is a different person.
export function nextIndex({ aliases, prev = {}, results = {}, only = null, now = new Date().toISOString() }) {
  const players = {}; const kept = []; const failed = [];
  for (const [id, code] of Object.entries(aliases)) {
    const r = results[id];
    const old = prev[id] && prev[id].code === code ? prev[id] : null;
    if (r && r.ok) { players[id] = r.entry; continue; }
    if (r && !r.ok) {
      failed.push({ id, code, why: r.why });
      if (old) { players[id] = { ...old, lastError: String(r.why), lastErrorAt: now }; kept.push(id); }
      continue;
    }
    if (only && old) players[id] = old;   // not fetched this run
  }
  const removed = Object.keys(prev).filter((id) => !(id in aliases) || (prev[id] && prev[id].code !== aliases[id] && !(id in players)));
  const sorted = {};
  Object.keys(players).sort((a, b) => Number(a) - Number(b)).forEach((k) => { sorted[k] = players[k]; });
  return { players: sorted, removed, kept, failed };
}

// "Did coverage drop?" — the share of aliased players with a stored photo, this index versus the previous one.
export function coverageDropped(prev, next) {
  if (!prev || !prev.aliases || !next || !next.aliases) return false;
  return next.stored / next.aliases < prev.stored / prev.aliases;
}
