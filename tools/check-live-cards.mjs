#!/usr/bin/env node
// tools/check-live-cards.mjs — ruling 4 (founder 2026-10-20). Reads live-check.json, which bsp-pipeline.js writes from
// the SAME api-tennis fetch the cards were built from. Exit 1 (a red run) when api-tennis shows ≥1 ATP main-draw match in
// play and matches.json carries 0 live cards — the B8 failure (an in-play match vanishing from the board) must never
// return silently. A missing live-check.json is itself a failure: the pipeline ran and did not report.
import fs from 'node:fs';
const f = process.argv[2] || 'live-check.json';
if (!fs.existsSync(f)) { console.log(`::error title=Live-card check::${f} missing — the pipeline did not report its live-card count`); process.exit(1); }
const c = JSON.parse(fs.readFileSync(f, 'utf8'));
console.log(`api-tennis main-draw matches in play: ${c.apiLiveCount} · live cards in matches.json: ${c.cardsLive} (checked ${c.checkedAt})`);
for (const m of c.apiLive || []) console.log(`  in play: ${m.players} · ${m.tournament} · ${m.status} · event ${m.eventKey}`);
if (c.apiLiveCount > 0 && c.cardsLive === 0) {
  console.log(`::error title=Live-card check::api-tennis shows ${c.apiLiveCount} main-draw match(es) in play but matches.json has 0 live cards`);
  process.exit(1);
}
console.log(c.apiLiveCount ? 'ok: in-play matches are carded' : 'SKIP: nothing in play right now — nothing to compare');
