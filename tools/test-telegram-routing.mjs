#!/usr/bin/env node
// telegram-bot-scope (founder 2026-10-30): every pipeline / health alert goes to the pipeline chat
// (repo secret TELEGRAM_PIPELINE_CHAT_ID; Vault pipeline_telegram_chat_id for the pg_cron senders) and, until that
// secret exists, keeps its current chat — never dropped. "Stennisfy Data Alerts" carries drops only.
// Also: the drop bots' fixture-list writer keeps singles and drops doubles; its window is yesterday .. +4 days, UTC.
import fs from 'node:fs';
import path from 'node:path';
import { rowsOf, windowDays, countByType } from './drops-scope-fixtures.mjs';
let pass = 0, fail = 0;
const check = (name, ok, d = '') => { if (ok) { pass++; console.log('  ok  ', name); } else { fail++; console.log('  FAIL', name, d); } };
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const files = [...fs.readdirSync(path.join(ROOT, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f)).map((f) => '.github/workflows/' + f),
  ...fs.readdirSync(path.join(ROOT, 'tools/te-store-repo')).filter((f) => /\.ya?ml$/.test(f)).map((f) => 'tools/te-store-repo/' + f)];
// every env line that hands a chat id to a sender
export function badRoutes(text) {
  const bad = [];
  for (const m of text.matchAll(/^\s*(TELEGRAM_(?:OPS_)?CHAT_ID):\s*(.+)$/gm)) {
    const want = '${{ secrets.TELEGRAM_PIPELINE_CHAT_ID || secrets.' + m[1] + ' }}';
    if (m[2].trim() !== want) bad.push(m[1] + ': ' + m[2].trim());
  }
  return bad;
}
let routes = 0;
for (const f of files) {
  const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
  routes += (t.match(/^\s*TELEGRAM_(?:OPS_)?CHAT_ID:/gm) || []).length;
  const b = badRoutes(t);
  check(`${f}: every alert chat = the pipeline chat, else its current chat`, !b.length, b.join('; '));
}
check('there are alert senders to check (not a vacuous pass)', routes >= 15, String(routes));
check('CONTROL: a sender reading the old chat alone is caught', badRoutes('    TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}\n').length === 1);
check('CONTROL: a sender reading the pipeline chat with no fallback is caught (it would drop alerts)',
  badRoutes('    TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_PIPELINE_CHAT_ID }}\n').length === 1);
const ten270 = fs.readFileSync(path.join(ROOT, '.github/workflows/ten270-stream-now.yml'), 'utf8');
check('the schema action copies the repo secret into Vault pipeline_telegram_chat_id only when it exists',
  /TELEGRAM_PIPELINE_CHAT_ID: \$\{\{ secrets\.TELEGRAM_PIPELINE_CHAT_ID \}\}/.test(ten270) && /if pc:[\s\S]{0,400}'pipeline_telegram_chat_id'/.test(ten270));
for (const f of ['oddspapi-postmatch-pinger.sql', 'ten216-collector-watchdog.sql']) {
  const t = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/--[^\n]*/g, '');
  const i = t.indexOf("'ten287_telegram_chat_id'"), j = t.indexOf("'pipeline_telegram_chat_id'");
  check(`${f}: pipeline chat first once stored, the drop-bot chat kept as the fallback`, i > 0 && j > i, `${i} ${j}`);
}
// the fixture-list writer
const rows = rowsOf([
  { event_key: 1, event_first_player: 'C. Alcaraz', event_second_player: 'J. Sinner', event_type_type: 'Atp Singles', event_qualification: 'False', event_date: '2026-10-30', event_time: '12:00' },
  { event_key: 2, event_first_player: 'P. Bar Biryukov', event_second_player: 'S. Sakellaridis', event_type_type: 'Atp Singles', event_qualification: 'True' },
  { event_key: 3, event_first_player: 'A. B / C. D', event_second_player: 'E. F / G. H', event_type_type: 'Atp Doubles' },
  { event_key: null, event_first_player: 'X', event_second_player: 'Y' },
]);
check('writer: singles kept, doubles and keyless rows dropped', rows.length === 2 && rows.map((r) => r.event_key).join() === '1,2');
check('writer: the qualifying flag is carried as api-tennis sends it', rows[1].qual === 'True' && rows[1].type === 'Atp Singles');
check('writer: counts by type and qualification', JSON.stringify(countByType(rows)) === '{"Atp Singles · qualification False":1,"Atp Singles · qualification True":1}');
const [a, b] = windowDays(Date.parse('2026-10-30T15:00:00Z'));
check('writer: window = yesterday .. +4 days, UTC', a === '2026-10-29' && b === '2026-11-03', `${a} ${b}`);
const pl = fs.readFileSync(path.join(ROOT, '.github/workflows/pipeline.yml'), 'utf8');
check('pipeline writes the fixture list every run, best-effort and checked', /node tools\/drops-scope-fixtures\.mjs \|\| rc=\$\?\n\s+node tools\/step-check\.mjs --step "Drop bots' api-tennis fixture list/.test(pl));
console.log(`test-telegram-routing: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
