#!/usr/bin/env node
// Founder ruling 2026-10-18 (item 5): every data run reports total price coverage per level (tools/price-consistency.mjs
// --coverage-out → _site/price-coverage.json) and alerts on Telegram when coverage DROPS against the last published run, or
// when a dash says "no source found yet" although the master holds a row that fits the match (a join miss). This script
// only writes the alert text (sent after the upload by tools/price-alert-send.mjs, so it never holds a publish back);
// it exits 0 whatever it finds. A missing published baseline (404, the first publish) is said out loud, never an alert.
// Usage: node tools/price-coverage-alert.mjs --cur _site/price-coverage.json [--baseline FILE | --baseline-url URL] --out .coverage-alert.txt
import { readFileSync, existsSync, writeFileSync, renameSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CUR = arg('--cur', '_site/price-coverage.json'), OUT = arg('--out', '.coverage-alert.txt'), LABEL = arg('--run-label', '');

export function compare(cur, base) {
  const lines = [];
  const levels = Object.keys(cur.totals || {}).sort();
  for (const lv of levels) {
    const c = cur.totals[lv], b = base && base.totals && base.totals[lv];
    if (b && c.priced < b.priced) lines.push(`${lv}: priced ${b.priced} → ${c.priced} of ${c.n} (−${b.priced - c.priced})`);
  }
  if (base && base.totals) for (const lv of Object.keys(base.totals)) if (!cur.totals[lv] && base.totals[lv].priced) lines.push(`${lv}: priced ${base.totals[lv].priced} → none (the level is gone from the report)`);
  // a join miss alerts once: only the matches the published report did not already list (the guard runs every ~10 min,
  // so a known, reported case is never re-sent); with no published report every miss is new
  const id = e => [e.key, e.date, e.opp].join('|');
  const known = new Set(((base && base.joinMissEx) || []).map(id));
  const fresh = (cur.joinMissEx || []).filter(e => !known.has(id(e)));
  const grew = base && base.joinMissEx && cur.joinMiss > (base.joinMiss || 0) && !fresh.length;   // past the listed cap
  if (fresh.length || grew) {
    const n = !base || !base.joinMissEx ? cur.joinMiss : fresh.length || cur.joinMiss - (base.joinMiss || 0);
    lines.push(`${n} new match(es) read "No source found yet" although the master holds a row that fits (${cur.joinMiss} in all):`);
    for (const e of fresh.slice(0, 10)) lines.push(`  ${e.player} v ${e.opp}, ${e.event || ''} ${e.date} (${e.level}) — ${e.cause}`);
  }
  return lines;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const write = (t) => { writeFileSync(OUT + '.tmp', t); renameSync(OUT + '.tmp', OUT); };
  if (!existsSync(CUR)) { console.log(`::warning::price-coverage: ${CUR} missing — no coverage report this run`); write(''); process.exit(0); }
  const cur = JSON.parse(readFileSync(CUR, 'utf8'));
  let base = null;
  const bf = arg('--baseline', null), bu = arg('--baseline-url', null);
  if (bf && existsSync(bf)) base = JSON.parse(readFileSync(bf, 'utf8'));
  else if (bu) {
    try { const r = await fetch(bu, { signal: AbortSignal.timeout(20000) });
      if (r.status === 404) console.log('price-coverage: no published report yet (404) — the first publish, nothing to compare');
      else if (r.ok) base = await r.json(); else console.log(`::warning::price-coverage: baseline HTTP ${r.status} — compared with nothing`); }
    catch (e) { console.log(`::warning::price-coverage: baseline unreadable (${e.name}) — compared with nothing`); }
  }
  for (const [lv, t] of Object.entries(cur.totals || {})) console.log(`price-coverage ${lv}: ${t.priced} of ${t.n} priced · walkover ${t.walkover} · one side only ${t.one} · no bookmaker ${t.nobook} · no source found yet ${t.none}`);
  const lines = compare(cur, base);
  write(lines.length ? `Price coverage${LABEL ? ' (' + LABEL + ')' : ''}:\n` + lines.join('\n') : '');
  console.log(lines.length ? lines.join('\n') : 'price-coverage: no drop, no join miss — no alert');
  process.exit(0);
}
