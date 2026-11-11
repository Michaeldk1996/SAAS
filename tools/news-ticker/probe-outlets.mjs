#!/usr/bin/env node
// News ticker — registry probe (run by hand after a registry change): asks each outlet's section URL once with the
// collector's own plain client and records what came back. It applies Michael's ruling of 11 Nov 2026: an outlet whose
// section is served publicly to a plain request is readable, whatever its robots.txt or terms say; an outlet that
// answers 401/403/429, a challenge page, a login or nothing stays out as a TECHNICAL block. Nothing is bypassed.
//
// Usage: node tools/news-ticker/probe-outlets.mjs [--write]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UA, sectionLinks, technicalBlock } from './outlet-reader.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = path.join(ROOT, 'data', 'news-outlets.json');
export const RULING = "allowed by Michael's ruling, 11 Nov 2026";

async function probe(o) {
  try {
    const r = await fetch(o.sectionUrl, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    const body = r.ok ? await r.text() : '';
    const block = technicalBlock(r.status, body);
    const links = block ? [] : sectionLinks(body, r.url || o.sectionUrl);
    return { status: r.status, block: block || (links.length < 3 ? 'the section page carries no article links in its HTML (built by script)' : null), links: links.length, finalUrl: r.url };
  } catch (e) { return { status: 0, block: `no answer (${e && (e.cause && e.cause.code || e.name)})`, links: 0 }; }
}

const reg = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const todo = reg.outlets.filter((o) => !/atptour\.com/.test(o.sectionUrl || ''));
let i = 0;
await Promise.all(Array.from({ length: 10 }, async () => { while (i < todo.length) { const o = todo[i++]; o._p = await probe(o); } }));
for (const o of reg.outlets) {
  if (!('statusBeforeRuling' in o)) { o.statusBeforeRuling = o.status; o.reasonBeforeRuling = o.reason; }
  if (!('enabled' in o)) o.enabled = true;
  if (/atptour\.com/.test(o.sectionUrl || '')) { o.status = 'permission'; o.reason = 'ATP stays on the permission route (read only through the tournament sites listed under tournamentSites).'; continue; }
  const p = o._p; delete o._p;
  o.probe = { at: new Date().toISOString().slice(0, 10), http: p.status, articleLinks: p.links };
  if (p.block) { o.status = 'blocked'; o.blockKind = 'technical'; o.reason = `Technical block: ${p.block}${p.status ? ' (HTTP ' + p.status + ')' : ''}. Not bypassed.`; delete o.allowedBy; }
  else { o.status = 'allowed'; delete o.blockKind; o.allowedBy = RULING; o.reason = `Served publicly to a plain request (HTTP ${p.status}, ${p.links} article links). ${RULING}; its robots.txt / terms record is kept below.`; }
}
const c = {}; for (const o of reg.outlets) c[o.status] = (c[o.status] || 0) + 1;
reg.counts = c; reg.ruling = `${RULING}: the collector may read any outlet page served publicly to a plain request, regardless of robots.txt or terms wording. Limits: no bypassing technical blocks (403, CAPTCHA, login, paywall; no proxies, no disguised user agent, no headless browser); only the quoted words, speaker and labelling context are kept, never article text; at most one section request per outlet every 30 minutes, article pages fetched once; \"enabled\": false switches an outlet off and hides its items; ATP stays on the permission route; YouTube audio, the Tennis TV stream and tennisformterminal.com stay out.`;
console.log(JSON.stringify(c));
if (process.argv.includes('--write')) { fs.writeFileSync(FILE + '.tmp', JSON.stringify(reg, null, 1) + '\n'); fs.renameSync(FILE + '.tmp', FILE); console.log('written'); }
