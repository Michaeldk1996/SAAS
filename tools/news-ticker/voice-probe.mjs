#!/usr/bin/env node
// Read-only measurement: rewrite the live feed's match reports in the founder's voice and print how many sentences and
// reports pass the fact check. Writes nothing. Usage: node tools/news-ticker/voice-probe.mjs [--base <site url>]
import { humaniseReport } from './humanise.mjs';
const i = process.argv.indexOf('--base'), BASE = (i > 0 ? process.argv[i + 1] : 'https://michaeldk1996.github.io/SAAS').replace(/\/$/, '');
const get = async (p) => (await fetch(`${BASE}/${p}`, { signal: AbortSignal.timeout(60000) })).json();
const lc = (x) => String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ix = await get('news-ticker.json'), pi = await get('player-index.json');
const fullByKey = new Map((pi.players || []).map((p) => [String(p.key), String(p.name).trim()]));
const fullName = (key, card) => { const f = fullByKey.get(String(key)); if (!f) return null;
  const c = lc(card).replace(/\./g, ' ').split(/\s+/).filter(Boolean); let k = 0; while (k < c.length - 1 && c[k].length <= 2) k++;
  const sur = c.slice(k).join(' ');
  return sur && lc(f).endsWith(' ' + sur) && lc(f)[0] === c[0][0] && lc(f).split(/\s+/).length === sur.split(' ').length + 1 ? f : null; };
const out = { reports: 0, fully: 0, sentencesPassed: 0, sentencesTotal: 0, errors: [], tokens: { input: 0, output: 0 }, why: {}, items: [] };
for (const t of ix.tournaments || []) {
  const d = await get(t.file);
  for (const x of (d.items || []).filter((y) => y.type === 'report')) {
    const template = x.templateText || x.text;
    const sentences = template.split(/(?<=[a-z0-9)]\.)\s+(?=[A-Z])/);
    const h = await humaniseReport({ sentences, winner: { card: x.player, full: fullName(x.playerId, x.player) }, loser: { card: x.opponent, full: fullName(x.opponentId, x.opponent) } });
    if (h.usage) { out.tokens.input += h.usage.input; out.tokens.output += h.usage.output; }
    if (h.status !== 'ok') { out.errors.push(`${x.id}: ${h.status} ${h.detail || ''}`); if (h.status === 'no-key' || /credit|401|403/.test(String(h.detail))) break; continue; }
    out.reports++; out.sentencesPassed += h.voice.passed; out.sentencesTotal += h.voice.total; if (h.voice.passed === h.voice.total) out.fully++;
    for (const f of h.voice.failures) out.why[f.why] = (out.why[f.why] || 0) + 1;
    out.items.push({ id: x.id, passed: `${h.voice.passed}/${h.voice.total}`, failures: h.voice.failures.map((f) => `${f.i}: ${f.why}`), text: h.text });
  }
}
console.log('VOICE-PROBE ' + JSON.stringify(out));
