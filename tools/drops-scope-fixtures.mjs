#!/usr/bin/env node
// Feeds the Telegram drop bots' ATP-only posting scope (tools/drops-scope.sql): api-tennis get_fixtures, UTC,
// yesterday .. +4 days, every singles fixture (doubles carry a "/" and are left out), written through
// public.drops_scope_ingest with the pipeline's service key. One api-tennis call (Ultra, no request cap).
// The bots decide on event_type_type = 'Atp Singles' (ATP main draw; ATP qualifying = the same type with
// event_qualification 'True'). Read-only towards everything else; prints counts only, never the key.
// Env: API_TENNIS_KEY, SUPABASE_URL, SUPABASE_SECRET_KEY. Exit 0 written, 1 failed (the pipeline step checks it).

export function windowDays(now = Date.now()) {
  const d = (k) => new Date(now + k * 86400e3).toISOString().slice(0, 10);
  return [d(-1), d(4)];
}

export function rowsOf(list) {
  const out = [];
  for (const f of Array.isArray(list) ? list : []) {
    if (!f || f.event_key == null) continue;
    const a = String(f.event_first_player || ''), b = String(f.event_second_player || '');
    if (!a || !b || a.includes('/') || b.includes('/')) continue;
    out.push({ event_key: String(f.event_key), event_date: f.event_date || null, event_time: f.event_time || null,
      first: a, second: b, type: f.event_type_type || null, qual: f.event_qualification == null ? null : String(f.event_qualification),
      tournament: f.tournament_name || null, round: f.tournament_round || null });
  }
  return out;
}

export function countByType(rows) {
  const c = {};
  for (const r of rows) { const k = `${r.type || '—'} · qualification ${r.qual || '—'}`; c[k] = (c[k] || 0) + 1; }
  return c;
}

async function main() {
  const { API_TENNIS_KEY: key, SUPABASE_URL: url, SUPABASE_SECRET_KEY: sk } = process.env;
  if (!key || !url || !sk) { console.log('::error::drops-scope fixtures: API_TENNIS_KEY / SUPABASE_URL / SUPABASE_SECRET_KEY missing — not written'); process.exit(1); }
  const [ds, de] = windowDays();
  const qs = new URLSearchParams({ method: 'get_fixtures', APIkey: key, date_start: ds, date_stop: de, timezone: 'UTC' });
  let body;
  try {
    const r = await fetch('https://api.api-tennis.com/tennis/?' + qs, { signal: AbortSignal.timeout(90e3) });
    body = await r.json();
  } catch (e) { console.log(`::error::drops-scope fixtures: api-tennis get_fixtures failed (${e.name}) — not written`); process.exit(1); }
  if (!body || String(body.success) !== '1' || !Array.isArray(body.result) || !body.result.length) {
    console.log(`::error::drops-scope fixtures: api-tennis answered success=${body && body.success}, ${Array.isArray(body && body.result) ? body.result.length : 'no'} fixtures — not written`);
    process.exit(1);
  }
  const rows = rowsOf(body.result);
  const r = await fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/drops_scope_ingest', {
    method: 'POST', signal: AbortSignal.timeout(60e3),
    headers: { apikey: sk, Authorization: 'Bearer ' + sk, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_rows: rows, p_window: `${ds}..${de}` }),
  }).catch((e) => ({ ok: false, status: e.name, text: async () => '' }));
  if (!r.ok) { console.log(`::error::drops-scope fixtures: ingest failed (HTTP ${r.status}) — the bots hold what they cannot match`); process.exit(1); }
  console.log(`drops-scope fixtures ${ds}..${de}: ${rows.length} singles of ${body.result.length} fixtures written`);
  console.log(JSON.stringify(countByType(rows)));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
