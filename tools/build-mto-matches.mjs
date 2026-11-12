#!/usr/bin/env node
// mto-matches.json = every medical timeout on its api-tennis match id (public.mto_export(), the MTO archive), for the
// site's match record: who called it and the score at the call. A match with none is absent — never a "0 MTOs" entry.
// Its own file: matches.json is not touched. Atomic write. A failed or unreadable read exits 1 and writes nothing
// (a failure is never an empty file, which would read as "no medical timeouts"). Rules: .claude/rules/mto.md.
import fs from 'node:fs';
const OUT = process.env.MTO_MATCHES_OUT || 'mto-matches.json';
const KEEP = ['calledAt', 'player', 'opponent', 'p1', 'p2', 'playerSide', 'games', 'points', 'server', 'serverSide',
              'endedAt', 'durationSeconds', 'finalResult', 'retired'];   // never the source: it is private
export function shape(raw, now = new Date()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('export is not an object');
  const matches = {}; let n = 0;
  for (const [ek, rows] of Object.entries(raw)) {
    if (!/^\d+$/.test(ek)) throw new Error('match id is not numeric: ' + ek);
    if (!Array.isArray(rows)) throw new Error('rows of ' + ek + ' are not a list');
    const out = rows.filter(r => r && typeof r === 'object' && r.calledAt)
      .map(r => Object.fromEntries(KEEP.map(k => [k, r[k] === undefined ? null : r[k]])));
    if (out.length) { matches[ek] = out; n += out.length; }
  }
  return { generatedAt: now.toISOString(), count: n, matchCount: Object.keys(matches).length, matches };
}
async function read() {
  if (process.env.MTO_EXPORT_FILE) return JSON.parse(fs.readFileSync(process.env.MTO_EXPORT_FILE, 'utf8'));
  const url = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, ''), key = (process.env.SUPABASE_SECRET_KEY || '').trim();
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY not set');
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url + '/rest/v1/rpc/mto_export', { method: 'POST', body: '{}', signal: AbortSignal.timeout(30000),
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { last = e; await new Promise(z => setTimeout(z, 2000 * (i + 1))); }
  }
  throw last;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const doc = shape(await read());
    fs.writeFileSync(OUT + '.tmp', JSON.stringify(doc)); fs.renameSync(OUT + '.tmp', OUT);
    console.log(`mto-matches: ${doc.count} medical timeout(s) on ${doc.matchCount} match(es) -> ${OUT}`);
  } catch (e) { console.error('mto-matches: NOT written — ' + (e && e.message || e)); process.exit(1); }
}
