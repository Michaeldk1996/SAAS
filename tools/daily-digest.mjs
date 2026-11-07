#!/usr/bin/env node
// Daily health digest (founder 2026-11-01, Task C: "one daily message: each feed, job, recorder and publish with its
// last-success time, red where late"). Run by .github/workflows/daily-digest.yml at 07:00Z to the pipeline-alerts chat.
//
// Sources, read-only: every scheduled GitHub workflow plus the ones pg_cron dispatches and the publish (last successful
// main-branch run); every pg_cron job (its last succeeded run); the feeds themselves — the published data and code
// (build-info.json), the live poller's board (live_snapshot.updated_at), the start recorder's last tick
// (live_flip_stats.last_tick_at) and the Kibl stream heartbeat. A line is RED when its last success is older than its own
// schedule allows: twice the longest gap between two scheduled runs, plus 30 min (a schedule that is read exactly, from
// the cron itself, never a typed number). A source that cannot be read is RED with the reason — never a silent green.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN = 60e3;

// ── cron -> the longest gap between two runs, in minutes (every minute of one week enumerated: exact for any cron) ──
function field(spec, lo, hi) {
  const out = new Set();
  for (const part of String(spec).split(',')) {
    const [range, stepS] = part.split('/');
    const step = stepS ? Number(stepS) : 1;
    let a = lo, b = hi;
    if (range !== '*') { const m = range.split('-').map(Number); a = m[0]; b = m.length > 1 ? m[1] : (stepS ? hi : m[0]); }
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out;
}
export function cronGapMin(crons) {
  const hits = [];
  for (const c of [].concat(crons)) {
    const [mi, h, dom, mon, dow] = String(c).trim().split(/\s+/);
    if (dom !== '*' || mon !== '*') return 31 * 24 * 60;   // day-of-month / month schedules: at most a month apart
    const M = field(mi, 0, 59), H = field(h, 0, 23), D = field(dow, 0, 7);
    for (let d = 0; d < 7; d++) {
      if (!D.has(d) && !(d === 0 && D.has(7))) continue;
      for (const hh of H) for (const mm of M) hits.push(d * 1440 + hh * 60 + mm);
    }
  }
  if (!hits.length) return null;
  const s = [...new Set(hits)].sort((x, y) => x - y);
  let gap = s[0] + 7 * 1440 - s[s.length - 1];
  for (let i = 1; i < s.length; i++) gap = Math.max(gap, s[i] - s[i - 1]);
  return gap;
}
// pg_cron also takes '10 seconds' / '30 seconds'
export function pgGapMin(schedule) {
  const m = /^(\d+)\s+seconds?$/.exec(String(schedule).trim());
  return m ? Math.max(1, Number(m[1]) / 60) : cronGapMin(schedule);
}
export const allowedMin = (gap) => (gap == null ? null : 2 * gap + 30);

export function line(name, lastIso, gapMin, now, note = '') {
  if (!lastIso) return { red: true, text: `🔴 ${name} · no success on record${note ? ' · ' + note : ''}` };
  const age = (now - Date.parse(lastIso)) / MIN, allow = allowedMin(gapMin);
  const red = allow != null && age > allow;
  const ago = age < 90 ? `${Math.round(age)} min` : age < 48 * 60 ? `${Math.floor(age / 60)} h ${Math.round(age % 60)} min` : `${Math.round(age / 1440)} d`;
  const every = gapMin == null ? '' : gapMin < 90 ? ` (runs every ${Math.round(gapMin)} min)` : gapMin < 2880 ? ` (runs every ${Math.round(gapMin / 60)} h)` : ` (runs every ${Math.round(gapMin / 1440)} d)`;
  return { red, text: `${red ? '🔴' : '✅'} ${name} · last success ${ago} ago${every}${note ? ' · ' + note : ''}` };
}

// split into Telegram messages under its 4,096-character cap; red lines first
export function messages(title, lines, cap = 3800) {
  const sorted = [...lines.filter((l) => l.red), ...lines.filter((l) => !l.red)];
  const reds = lines.filter((l) => l.red).length;
  const head = `${title} · ${reds ? `🔴 ${reds} late` : '✅ all on time'} of ${lines.length}`;
  const out = []; let cur = head;
  for (const l of sorted) {
    if (cur.length + 1 + l.text.length > cap) { out.push(cur); cur = `${title} (cont.)`; }
    cur += '\n' + l.text;
  }
  out.push(cur);
  return out;
}

// the watched GitHub workflows: every one with a schedule, plus the dispatch-only ones with their expected cadence
export const DISPATCHED = { 'publish.yml': 30, 'oddspapi-postmatch.yml': 15, 'ten232-kibl-archive.yml': 24 * 60, 'alert-dry-run.yml': null };
export function watchedWorkflows(dir = path.join(ROOT, '.github', 'workflows')) {
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.yml')).sort()) {
    const s = fs.readFileSync(path.join(dir, f), 'utf8');
    const name = ((s.match(/^name:\s*(.+)$/m) || [])[1] || f).trim();
    const crons = [...s.matchAll(/^\s*- cron:\s*'([^']+)'/gm)].map((m) => m[1]);
    if (crons.length) out.push({ file: f, name, gap: cronGapMin(crons) });
    else if (f in DISPATCHED) out.push({ file: f, name, gap: DISPATCHED[f] });
  }
  return out;
}

// Founder 2026-11-08 ("make sure this problem just don't come anymore"): from 4 to 8 Nov every captured Pinnacle close was
// dropped (the card state's new start sources were not accepted) and the pipeline stayed green. This line is RED when the
// newest captured close (captured-closes-pinnacle.json on main) is 2 or more days older than the newest finished ATP card
// on the board (matches.json on main): a whole day of finished matches with no captured close. Off-season both stop, so
// it stays green. Unreadable = red.
export function capturedLine(captured, matches) {
  const name = 'Captured Pinnacle closes · newest row';
  const rows = captured && Array.isArray(captured.rows) ? captured.rows : null;
  const cards = Array.isArray(matches) ? matches : matches && Array.isArray(matches.matches) ? matches.matches : null;
  if (!rows || !cards) return { red: true, text: `🔴 ${name} · could not be read` };
  const maxDate = (xs) => xs.filter(Boolean).sort().pop() || null;
  const cap = maxDate(rows.map((r) => r && r.date));
  const fin = maxDate(cards.filter((m) => m && /^past-/.test(String(m.id)) && m.finalScore && m.tourBadge === 'ATP').map((m) => m.date));
  if (!fin) return { red: false, text: `✅ ${name} · ${cap || '—'} (no finished ATP match on the board)` };
  const lag = cap ? Math.round((Date.parse(fin) - Date.parse(cap)) / 864e5) : Infinity;
  const red = lag >= 2;
  return { red, text: `${red ? '🔴' : '✅'} ${name} · ${cap || 'none'} (newest finished ATP match ${fin}${red ? `: ${lag === Infinity ? 'no' : lag + ' days of'} matches without a captured close` : ''})` };
}

async function gh(p) {
  const r = await fetch(`https://api.github.com${p}`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function sql(q) {
  const ref = new URL(process.env.SUPABASE_URL).host.split('.')[0];
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: 'POST',
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function main() {
  const now = Date.now(), repo = process.env.GITHUB_REPOSITORY, site = process.env.SITE_URL || 'https://michaeldk1996.github.io/SAAS';
  const jobs = [], feeds = [], pg = [];
  for (const w of watchedWorkflows()) {
    try {
      const r = (await gh(`/repos/${repo}/actions/workflows/${w.file}/runs?branch=main&status=success&per_page=1`)).workflow_runs?.[0];
      jobs.push(line(w.name, r ? r.updated_at : null, w.gap, now));
    } catch (e) { jobs.push({ red: true, text: `🔴 ${w.name} · could not read its runs (${e.message})` }); }
  }
  try {
    const rows = await sql(`select j.jobname, j.schedule, j.active, max(d.end_time) filter (where d.status = 'succeeded') as last_ok
      from cron.job j left join cron.job_run_details d on d.jobid = j.jobid group by 1, 2, 3 order by 1`);
    for (const r of rows) pg.push(r.active === false ? { red: true, text: `🔴 pg_cron ${r.jobname} · INACTIVE` } : line(`pg_cron ${r.jobname}`, r.last_ok, pgGapMin(r.schedule), now));
  } catch (e) { pg.push({ red: true, text: `🔴 pg_cron jobs · could not be read (${e.message})` }); }
  try {
    const b = await (await fetch(`${site}/build-info.json?t=${now}`)).json();
    feeds.push(line('Publish · site data', b.data?.builtAt, 15, now));
    feeds.push(line('Publish · site code', b.builtAt, 15, now));
  } catch (e) { feeds.push({ red: true, text: `🔴 Publish · build-info.json unreadable (${e.message})` }); }
  try {
    const [r] = await sql(`select (select updated_at from public.live_snapshot where id = 1) as poller,
      (select last_tick_at from public.live_flip_stats where id = 1) as recorder,
      (select max(written_at) from public.kibl_now_price where card_key = '__stream__') as kibl`);
    feeds.push(line('Live poller · board written', r.poller, 1, now));
    feeds.push(line('Start recorder · last tick', r.recorder, 1, now));
    feeds.push(line('Kibl stream · heartbeat', r.kibl, 5, now));
  } catch (e) { feeds.push({ red: true, text: `🔴 Live poller / recorder / Kibl · could not be read (${e.message})` }); }
  try {
    const rd = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    feeds.push(capturedLine(rd('captured-closes-pinnacle.json'), rd('matches.json')));
  } catch (e) { feeds.push({ red: true, text: `🔴 Captured Pinnacle closes · could not be read (${e.message})` }); }
  const force = (process.env.FORCE_LATE || '').trim();     // the dry run: mark one named line late, as the brief asks
  const all = [...feeds, ...jobs, ...pg].map((l) => (force && l.text.includes(force) && !l.red ? { red: true, text: l.text.replace(/^✅/, '🔴') + ' · FORCED LATE (dry run)' } : l));
  const msgs = messages(`Stennisfy daily health ${new Date(now).toISOString().slice(0, 16)}Z`, all);
  for (const m of msgs) console.log(m + '\n');
  const tok = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!tok || !chat) { console.log('::error::daily digest NOT sent (no Telegram secret)'); return 1; }
  for (const m of msgs) {
    const r = await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: m, disable_web_page_preview: true }) });
    console.log(`Telegram: HTTP ${r.status}`);
    if (!r.ok) { console.log(`::error::daily digest Telegram failed (HTTP ${r.status})`); return 1; }
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().then((c) => process.exit(c), (e) => { console.log(`::error::daily-digest: ${e.message}`); process.exit(1); });
