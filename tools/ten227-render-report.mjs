#!/usr/bin/env node
/**
 * TEN-227 — render probe.json into the Phase 2 report tables (a-i).
 *
 *   node tools/ten227-render-report.mjs <probe.json>
 *
 * Every figure carries its n. A cell with n < 30 is marked with a dagger, and
 * anything absent prints as an em dash rather than a zero — a zero is a measured
 * result, a dash is the absence of one, and the two must not read alike.
 */

import { readFileSync } from 'node:fs';

const probe = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const LEVELS = ['atp', 'slam', 'challenger'];
const LEVEL_LABEL = { atp: 'ATP main tour', slam: 'Grand Slam', challenger: 'Challenger' };
const years = [...new Set(Object.keys(probe.cells).map((k) => k.split('|')[0]))].sort();

const cell = (y, l) => probe.cells[`${y}|${l}`];
const DAG = '†';
const pctOf = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');
const withN = (n, d) => (d ? `${pctOf(n, d)} (n=${d})${d < 30 ? DAG : ''}` : '—');

function table(title, valueFn) {
  const lines = [`### ${title}`, '', `| level | ${years.join(' | ')} |`, `|---|${years.map(() => '---').join('|')}|`];
  for (const l of LEVELS) {
    lines.push(`| ${LEVEL_LABEL[l]} | ${years.map((y) => { const c = cell(y, l); return c ? valueFn(c) : '—'; }).join(' | ')} |`);
  }
  return lines.join('\n') + '\n';
}

const out = [];
out.push(`_Sample: ${probe.cfg.per_level_per_year} per level per year, stratified across the calendar. ${probe.requests_used} BetsAPI requests. ${DAG} marks n < 30._\n`);

out.push(table('a. Match winner (`13_1`) quoted pre-match', (c) => withN(c.mw_present, c.n_events)));
out.push(table('b. Games/Asian handicap (`13_2`) quoted pre-match', (c) => withN(c.hcap_present, c.n_events)));
out.push(table('c. Total games / over-under (`13_3`) quoted pre-match', (c) => withN(c.ou_present, c.n_events)));
out.push(table('b/c. Median distinct lines quoted per match', (c) => `hcap ${c.median_hcap_lines_per_match ?? '—'} · O/U ${c.median_ou_lines_per_match ?? '—'}`));
out.push(table('e. Price series depth (rows per match, match-winner)', (c) => `${c.median_series_rows_mw ?? '—'} total / ${c.median_pre_rows_mw ?? '—'} pre-match`));
out.push(table('e. Last pre-match price, minutes before start (median)', (c) => (c.median_lead_minutes_mw == null ? '—' : `${c.median_lead_minutes_mw.toFixed(1)} min`)));
out.push(table('e. Lead-time range (min-max minutes)', (c) => (c.lead_minutes_range ? `${c.lead_minutes_range[0].toFixed(0)} to ${c.lead_minutes_range[1].toFixed(0)}` : '—')));
out.push(table('Bo3 / Bo5 split of the sample', (c) => `${c.bo.bo3}/${c.bo.bo5}${c.bo.unknown ? ` (+${c.bo.unknown} unknown)` : ''}`));
out.push(table('Errors (no odds row returned)', (c) => `${c.errors}`));

// d. any market key beyond the documented three
out.push('### d. Set handicap — any market key beyond `13_1`/`13_2`/`13_3`\n');
const extras = {};
for (const [k, c] of Object.entries(probe.cells)) for (const [m, n] of Object.entries(c.extra_markets || {})) extras[m] = (extras[m] || 0) + n;
out.push(Object.keys(extras).length
  ? `Market keys seen beyond the documented three: \`${JSON.stringify(extras)}\`.\n`
  : 'No market key other than `13_1`, `13_2`, `13_3` was returned on any sampled match, with `odds_market` left unrestricted so the endpoint could return anything it had. **There is no set-handicap market on `/v2/event/odds` for tennis.**\n');

// distinct line inventory
out.push('### b/c. Every distinct line quoted, with frequency\n');
for (const l of LEVELS) {
  out.push(`**${LEVEL_LABEL[l]}**\n`);
  for (const m of ['hcap_lines', 'ou_lines']) {
    const agg = {};
    let nCell = 0;
    for (const y of years) { const c = cell(y, l); if (!c) continue; nCell += c.n_events; for (const [line, n] of Object.entries(c[m] || {})) agg[line] = (agg[line] || 0) + n; }
    const rows = Object.entries(agg).sort((a, b) => b[1] - a[1]);
    out.push(`- \`${m === 'hcap_lines' ? '13_2' : '13_3'}\` (n=${nCell} matches): ${rows.length ? rows.map(([k, v]) => `\`${k}\`×${v}`).join(', ') : '—'}\n`);
  }
}

// f. target lines
out.push('### f. Target lines — share of matches where that exact line was quoted\n');
const allTargets = new Set();
for (const c of Object.values(probe.cells)) for (const k of Object.keys(c.target_lines || {})) allTargets.add(k);
if (!allTargets.size) {
  out.push('No target line from the line-coverage design was quoted on any sampled match. **—**\n');
} else {
  out.push(`| target | ${LEVELS.map((l) => LEVEL_LABEL[l]).join(' | ')} |`);
  out.push(`|---|${LEVELS.map(() => '---').join('|')}|`);
  for (const t of [...allTargets].sort()) {
    const cells = LEVELS.map((l) => {
      let hit = 0, n = 0;
      for (const y of years) { const c = cell(y, l); if (!c) continue; hit += c.target_lines?.[t] || 0; n += c.n_events; }
      return withN(hit, n);
    });
    out.push(`| \`${t}\` | ${cells.join(' | ')} |`);
  }
  out.push('');
}

// g. pinnacle
out.push('### g. `source=pinnaclesports` on ended ATP matches\n');
const p = probe.pinnacle;
out.push(p
  ? `n=${p.n} requests, ${p.ok} returned \`success=1\`. Odds rows by market: \`${JSON.stringify(p.markets)}\`. Non-success: \`${JSON.stringify(p.errors)}\`.\n`
  : '—\n');

// h. other books
out.push('### h. Other bookmakers — tennis handicap/total history\n');
if (probe.books) {
  out.push('| book | matches probed | match winner | handicap | total | odds rows |');
  out.push('|---|---|---|---|---|---|');
  for (const [b, s] of Object.entries(probe.books).sort((a, b2) => b2[1].rows - a[1].rows)) {
    out.push(`| ${b} | ${s.n} | ${s.mw} | ${s.hcap} | ${s.ou} | ${s.rows} |`);
  }
  out.push('');
} else out.push('—\n');

// i. earliest usable year
out.push('### i. Earliest year where handicap/total data is usable (>50% coverage)\n');
for (const l of LEVELS) {
  const usable = years.filter((y) => { const c = cell(y, l); return c && c.n_events && (100 * c.hcap_present) / c.n_events > 50; });
  const usableOu = years.filter((y) => { const c = cell(y, l); return c && c.n_events && (100 * c.ou_present) / c.n_events > 50; });
  out.push(`- **${LEVEL_LABEL[l]}** — handicap >50% in: ${usable.length ? usable.join(', ') : '**no sampled year**'}; total games >50% in: ${usableOu.length ? usableOu.join(', ') : '**no sampled year**'}`);
}
out.push('\n_Sampled years only (2017, 2020, 2023, 2025). A year not sampled is unknown, not absent._\n');

if (probe.classifier) {
  out.push(`_Classifier: dropped \`${JSON.stringify(probe.classifier.drops)}\`, unclassified ${probe.classifier.unclassified}._\n`);
}

console.log(out.join('\n'));
