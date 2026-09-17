#!/usr/bin/env node
/**
 * TEN-227 — Supabase headroom check, READ ONLY.
 *
 * Phase 3 says: project the betsapi_raw_* tables against our Supabase limits and
 * stop if the total would pass 70%. That needs a real current-size number, not a
 * remembered one, so this measures the live database before any load is planned.
 *
 * It issues SELECTs only, through the Management API's database/query endpoint,
 * and refuses to run anything that is not a SELECT.
 */

const must = (k) => {
  const v = (process.env[k] || '').trim();
  if (!v) { console.error(`FATAL: ${k} is empty`); process.exit(1); }
  return v;
};

const TOKEN = must('SUPABASE_ACCESS_TOKEN');
const SB_URL = must('SUPABASE_URL');
const REF = new URL(SB_URL).hostname.split('.')[0];
const DISK_BYTES = Number(process.env.SUPABASE_DISK_BYTES || 8 * 1024 ** 3);  // Pro plan default disk

async function q(sql) {
  if (!/^\s*select\b/i.test(sql)) throw new Error('refusing a non-SELECT statement');
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const gb = (b) => (b / 1024 ** 3).toFixed(3);

const dbSize = await q('select pg_database_size(current_database()) as bytes');
const used = Number(dbSize[0].bytes);
console.log(`project ref: ${REF}`);
console.log(`database size: ${used} bytes (${gb(used)} GiB)`);
console.log(`disk assumed:  ${DISK_BYTES} bytes (${gb(DISK_BYTES)} GiB)`);
console.log(`used:          ${((100 * used) / DISK_BYTES).toFixed(2)}%`);
console.log(`70% ceiling:   ${Math.round(0.7 * DISK_BYTES)} bytes — headroom to ceiling ${gb(0.7 * DISK_BYTES - used)} GiB`);

const tables = await q(`
  select schemaname, relname,
         pg_total_relation_size(relid) as total_bytes,
         n_live_tup as live_rows
  from pg_catalog.pg_statio_user_tables
  join pg_stat_user_tables using (relid)
  order by pg_total_relation_size(relid) desc
  limit 25`);
console.log('\nlargest tables:');
for (const t of tables) {
  console.log(`  ${String(t.total_bytes).padStart(12)}  ${String(t.live_rows).padStart(10)} rows  ${t.schemaname}.${t.relname}`);
}
