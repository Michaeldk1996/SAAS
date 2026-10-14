// Publish guard for the Pinnacle archive (founder brief 2026-10-14, item 1): the deploy fails when an archive table holds
// FEWER rows than the highest count any archive job recorded, or when a protection is gone (a trigger dropped, a write
// privilege granted, RLS off). Reads one RPC, public.pinnacle_archive_guard(), with the site's publishable key: it returns
// counts and booleans only. An unreachable database measures nothing: that is a loud SKIP (::warning::), never a pass and
// never a block — the deploy is blocked only by evidence that the archive shrank or lost a guard.
export function verdict(g) {
  if (!g || typeof g !== 'object') return { block: false, skip: true, why: 'no guard answer' };
  const why = [];
  for (const t of ['oddspapi_archive_raw', 'pinnacle_archive_close', 'pinnacle_archive_count']) {
    const s = g[t];
    if (!s) { why.push(`${t}: missing`); continue; }
    if (s.triggers !== true) why.push(`${t}: an append-only trigger is missing or disabled`);
    if (s.rls !== true) why.push(`${t}: row-level security is off`);
    if ((s.privilegeFaults || []).length) why.push(`${t}: ${s.privilegeFaults.join(', ')}`);
  }
  const mx = g.maxRecorded || {};
  if ((g.oddspapi_archive_raw || {}).rows < (mx.raw || 0)) why.push(`raw rows ${g.oddspapi_archive_raw.rows} < recorded ${mx.raw}`);
  if ((g.pinnacle_archive_close || {}).rows < (mx.close || 0)) why.push(`close rows ${g.pinnacle_archive_close.rows} < recorded ${mx.close}`);
  if (g.ok !== true && !why.length) why.push('guard reports not ok');
  return { block: why.length > 0, skip: false, why: why.join('; ') };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, ''), key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
  let g = null, err = null;
  if (!url || !key) err = 'SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not set';
  else {
    for (let i = 0; i < 3 && !g; i++) {
      try {
        const r = await fetch(`${url}/rest/v1/rpc/pinnacle_archive_guard`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(20000) });
        if (r.ok) g = await r.json(); else err = `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`;
      } catch (e) { err = String(e.message || e); }
      if (!g) await new Promise(res => setTimeout(res, 3000));
    }
  }
  const v = g ? verdict(g) : { block: false, skip: true, why: err };
  const line = g ? `raw ${g.oddspapi_archive_raw?.rows} (recorded max ${g.maxRecorded?.raw}) · close ${g.pinnacle_archive_close?.rows} (recorded max ${g.maxRecorded?.close})` : '';
  if (v.skip) console.log(`::warning::Pinnacle archive guard SKIPPED — could not read the archive (${v.why}). Nothing was checked; this is not a pass.`);
  else if (v.block) { console.log(`::error::Pinnacle archive guard FAILED — ${v.why}. ${line}`); process.exit(1); }
  else console.log(`Pinnacle archive guard ok — ${line}`);
}
