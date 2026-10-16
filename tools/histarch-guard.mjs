// Publish guard for the historical odds archive (founder brief 2026-10-16, items 1-2): the deploy fails when one of its
// tables holds FEWER rows than the highest count any archive job recorded, or a protection is gone (a trigger dropped,
// a write privilege granted, RLS off). One read-only RPC, public.historical_archive_guard(), with the site's publishable
// key: counts and booleans only. An unreachable database (or the migration not installed yet) measures nothing: a loud
// SKIP, never a pass and never a block. Same contract as tools/pinarch-guard.mjs.
export const TABLES = ['historical_odds_file', 'historical_close', 'historical_odds_export', 'historical_archive_count'];
export function verdict(g) {
  if (!g || typeof g !== 'object') return { block: false, skip: true, why: 'no guard answer' };
  const why = [];
  for (const t of TABLES) {
    const s = g[t];
    if (!s) { why.push(`${t}: missing`); continue; }
    if (s.triggers !== true) why.push(`${t}: an append-only trigger is missing or disabled`);
    if (s.rls !== true) why.push(`${t}: row-level security is off`);
    if ((s.privilegeFaults || []).length) why.push(`${t}: ${s.privilegeFaults.join(', ')}`);
  }
  const mx = g.maxRecorded || {};
  for (const [t, k] of [['historical_odds_file', 'file'], ['historical_close', 'close'], ['historical_odds_export', 'export']]) {
    if ((g[t] || {}).rows < (mx[k] || 0)) why.push(`${t} rows ${g[t].rows} < recorded ${mx[k]}`);
  }
  if (g.ok !== true && !why.length) why.push('guard reports not ok');
  return { block: why.length > 0, skip: false, why: why.join('; ') };
}

// Pinnacle (approx.) snapshots (founder ruling 2026-10-16): their own two tables, same rules, their own RPC.
export const SNAP_TABLES = ['historical_snapshot', 'historical_snapshot_count'];
export function snapVerdict(g) {
  if (!g || typeof g !== 'object') return { block: false, skip: true, why: 'no snapshot guard answer' };
  const why = [];
  for (const t of SNAP_TABLES) {
    const s = g[t];
    if (!s) { why.push(`${t}: missing`); continue; }
    if (s.triggers !== true) why.push(`${t}: an append-only trigger is missing or disabled`);
    if (s.rls !== true) why.push(`${t}: row-level security is off`);
    if ((s.privilegeFaults || []).length) why.push(`${t}: ${s.privilegeFaults.join(', ')}`);
  }
  if (((g.historical_snapshot || {}).rows ?? 0) < ((g.maxRecorded || {}).snapshot || 0)) why.push(`historical_snapshot rows ${g.historical_snapshot.rows} < recorded ${g.maxRecorded.snapshot}`);
  if (g.ok !== true && !why.length) why.push('snapshot guard reports not ok');
  return { block: why.length > 0, skip: false, why: why.join('; ') };
}

async function rpc(url, key, name) {
  let g = null, err = null;
  for (let i = 0; i < 3 && !g; i++) {
    try {
      const r = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(20000) });
      if (r.ok) g = await r.json(); else { err = `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`; if (r.status === 404) break; }
    } catch (e) { err = String(e.message || e); }
    if (!g) await new Promise(res => setTimeout(res, 3000));
  }
  return { g, err };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  {
    const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, ''), key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
    const { g, err } = url && key ? await rpc(url, key, 'historical_snapshot_guard') : { g: null, err: 'SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not set' };
    const v = g ? snapVerdict(g) : { block: false, skip: true, why: err };
    if (v.skip) console.log(`::warning::Historical snapshot guard SKIPPED — could not read the snapshot tables (${v.why}). Nothing was checked; this is not a pass.`);
    else if (v.block) { console.log(`::error::Historical snapshot guard FAILED — ${v.why}.`); process.exit(1); }
    else console.log(`Historical snapshot guard ok — snapshots ${g.historical_snapshot.rows} (recorded max ${g.maxRecorded.snapshot})`);
  }
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, ''), key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  let g = null, err = null;
  if (!url || !key) err = 'SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not set';
  else {
    for (let i = 0; i < 3 && !g; i++) {
      try {
        const r = await fetch(`${url}/rest/v1/rpc/historical_archive_guard`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(20000) });
        if (r.ok) g = await r.json(); else { err = `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`; if (r.status === 404) break; }
      } catch (e) { err = String(e.message || e); }
      if (!g) await new Promise(res => setTimeout(res, 3000));
    }
  }
  const v = g ? verdict(g) : { block: false, skip: true, why: err };
  const line = g ? TABLES.map(t => `${t} ${g[t]?.rows}`).join(' · ') + ` (recorded max ${JSON.stringify(g.maxRecorded)})` : '';
  if (v.skip) console.log(`::warning::Historical odds archive guard SKIPPED — could not read the archive (${v.why}). Nothing was checked; this is not a pass.`);
  else if (v.block) { console.log(`::error::Historical odds archive guard FAILED — ${v.why}. ${line}`); process.exit(1); }
  else console.log(`Historical odds archive guard ok — ${line}`);
}
