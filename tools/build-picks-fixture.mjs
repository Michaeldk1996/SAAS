#!/usr/bin/env node
// Builds tools/fixtures/picks-demo.json (the Picks tests' and screenshot harness's fixture — never served; real picks
// live in Firestore since Task 2) from the design package's demo rows,
// design-export/picks-handoff/demo-data.json, in the README "picks.json — one row per pick" shape.
//
// The rows are DEMO (the package says so: "Prices, players, results and times are demo"). The file says so too
// (`fixture: true`), and pins the page's "today" to the demo day (`as_of_day`) so the boards it reproduces
// (1a Today · 1c Sun 26 settled) stay reproducible after that day. Real picks (Task 2) drop both keys.
//
// Conversion, field by field — nothing is added that the demo row does not carry:
//   scheduled_at / posted_at  "HH:MM" on the row's day → ISO instant at Europe/Brussels' offset that day
//   player_a / player_b       { name, init } → { id: null, name, initials }   (the demo carries no player id)
//   frozen_at                 posted_at + 10 min (README: server field, = posted_at + 10 min); edited_at null
//   void_reason               the demo carries none → null
//   clv / pl_pct              computed by picks-core.js (never typed, never copied)
//
// Usage: node tools/build-picks-fixture.mjs [--check]   (--check: exit 1 if picks.json differs from a fresh build)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const core = require(path.join(ROOT, 'picks-core.js'));
const SRC = path.join(ROOT, 'design-export/picks-handoff/demo-data.json');
const OUT = path.join(ROOT, 'tools/fixtures/picks-demo.json');   // test / screenshot fixture only (never served)

// Europe/Brussels' UTC offset in minutes at a civil date-time (two passes: DST edges resolve to the later reading)
function brusselsOffsetMin(day, hm) {
  const guess = new Date(`${day}T${hm}:00Z`);
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', timeZoneName: 'longOffset' });
  const off = d => { const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(f.format(d)); return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +(m[3] || 0)) : 0; };
  const o1 = off(guess);
  return off(new Date(guess.getTime() - o1 * 60e3));
}
function isoAt(day, hm) {
  if (!day || !/^\d{2}:\d{2}$/.test(hm || '')) return null;
  const o = brusselsOffsetMin(day, hm), s = o < 0 ? '-' : '+', a = Math.abs(o);
  return `${day}T${hm}:00${s}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}
function plusMin(iso, n) {
  if (!iso) return null;
  const m = /^(.*T)(\d{2}):(\d{2}):00([+-]\d{2}:\d{2})$/.exec(iso);
  const t = new Date(new Date(iso).getTime() + n * 60e3);
  // keep the row's own offset in the string
  const off = m[4], sign = off[0] === '-' ? -1 : 1, mins = sign * (+off.slice(1, 3) * 60 + +off.slice(4, 6));
  const local = new Date(t.getTime() + mins * 60e3).toISOString().slice(0, 16);
  return `${local}:00${off}`;
}
const player = p => p ? { id: null, name: p.name, initials: p.init } : null;

function convert(r) {
  const posted_at = isoAt(r.date, r.posted_at);
  const row = {
    id: r.id,
    kind: r.kind,
    event: r.event ?? null,
    market_text: r.market_text ?? null,
    settles_at: r.settles_at ?? null,
    date: r.date,
    tournament: r.tournament ?? null,
    round: r.round ?? null,
    scheduled_at: r.kind === 'outright' ? null : isoAt(r.date, r.scheduled_at),
    surface: r.surface ?? null,
    player_a: player(r.player_a),
    player_b: player(r.player_b),
    selection: r.selection,
    market: r.market,
    line: r.line ?? null,
    open_price: r.open_price ?? null,
    posted_price: r.posted_price,
    posted_at,
    now_price: r.now_price ?? null,
    opp_now_price: r.opp_now_price ?? null,
    close_price: r.close_price ?? null,
    opp_close_price: r.opp_close_price ?? null,
    stake: r.stake,
    note: r.note,
    model_pct: r.model_pct ?? null,
    status: r.status,
    void_reason: null,
    result: r.result ? { sets: r.result.sets.map(s => Object.assign({ a: s.a, b: s.b }, s.tb != null ? { tb: s.tb, tb_side: s.tb_side } : {})), retired: !!r.result.retired } : null,
    edited_at: null,
    frozen_at: plusMin(posted_at, 10),
  };
  const r6 = x => x == null ? null : Math.round(x * 1e6) / 1e6;   // stored to 6 dp; the page recomputes on read
  row.clv = r6(core.clvOf(row));
  row.pl_pct = r6(core.plOf(row));
  return row;
}

export function build() {
  const demo = JSON.parse(fs.readFileSync(SRC, 'utf8'));
  const rows = [...demo.today, ...demo.settled_sun_26].map(convert);
  return {
    _note: 'DEMO picks from the Picks design package (design-export/picks-handoff/demo-data.json), converted by tools/build-picks-fixture.mjs. Not real picks: players, prices, results and times are the design\'s demo values. clv and pl_pct are computed (picks-core.js), and the page recomputes them on read.',
    fixture: true,
    as_of_day: demo.today[0].date,
    picks: rows,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = JSON.stringify(build(), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (cur !== text) { console.error('tools/fixtures/picks-demo.json is not the build of demo-data.json — run node tools/build-picks-fixture.mjs'); process.exit(1); }
    console.log('picks-demo.json matches its build');
  } else {
    const tmp = OUT + '.tmp';
    fs.writeFileSync(tmp, text); fs.renameSync(tmp, OUT);
    console.log(`wrote tools/fixtures/picks-demo.json (${build().picks.length} rows)`);
  }
}
