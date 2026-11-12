#!/usr/bin/env node
// Read-only measurement: build the standout report for every finished ATP match on the live board, have it worded in the
// founder's voice and print how many sentences / reports pass the fact check. Writes nothing. Head-to-head, round and
// duration come from the live feed.
import { humaniseReport } from './humanise.mjs';
import { reportText } from './news-core.mjs';
import { scoreFacts, pbpFacts } from './pbp-facts.mjs';
import { baselineFor } from './standouts.mjs';
const i = process.argv.indexOf('--base'), BASE = (i > 0 ? process.argv[i + 1] : 'https://michaeldk1996.github.io/SAAS').replace(/\/$/, '');
const get = async (p) => (await fetch(`${BASE}/${p}`, { signal: AbortSignal.timeout(90000) })).json();
const lc = (x) => String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const [board, ratings, pi, ix] = await Promise.all([get('matches.json'), get('surface-ratings.json'), get('player-index.json'), get('news-ticker.json')]);
const feed = new Map();
for (const t of ix.tournaments || []) for (const x of ((await get(t.file)).items || [])) if (x.type === 'report') feed.set(String(x.eventKey), x);
const fullByKey = new Map((pi.players || []).map((p) => [String(p.key), String(p.name).trim()]));
const fullName = (key, card) => { const f = fullByKey.get(String(key)); if (!f) return null;
  const c = lc(card).replace(/\./g, ' ').split(/\s+/).filter(Boolean); let k = 0; while (k < c.length - 1 && c[k].length <= 2) k++;
  const sur = c.slice(k).join(' ');
  return sur && lc(f).endsWith(' ' + sur) && lc(f)[0] === c[0][0] && lc(f).split(/\s+/).length === sur.split(' ').length + 1 ? f : null; };
const out = { reports: 0, fully: 0, sentencesPassed: 0, sentencesTotal: 0, withStandouts: 0, withBaseline: 0, players: 0, errors: [], tokens: { input: 0, output: 0 }, why: {}, items: [] };
const dry = process.argv.includes('--dry');
for (const m of Object.values(board)) {
  if (!m || m.tourBadge !== 'ATP' || !m.finalScore || !m.finalScore.winner || m.walkover || /\//.test(String(m.p1) + String(m.p2))) continue;
  const w = m.finalScore.winner, l = w === 'p1' ? 'p2' : 'p1', ek = String(m.id).split('-').slice(1).join('-'), it = feed.get(ek) || {};
  const baselines = { [w]: baselineFor(ratings, m[w + 'Key'], m.surface), [l]: baselineFor(ratings, m[l + 'Key'], m.surface) };
  out.players += 2; out.withBaseline += (baselines[w] ? 1 : 0) + (baselines[l] ? 1 : 0);
  let pbp = null; try { pbp = pbpFacts(await get(`pbp/${ek}.json`), m.finalScore, 3); } catch (e) { /* no point log */ }
  const rep = reportText(m, w, l, { baselines, pbp, h2h: (it.fields && it.fields.h2h) || null, score: scoreFacts(m.finalScore, w), round: (it.fields && it.fields.round) || undefined, duration: it.observed && it.observed.minutes != null ? it.observed.minutes : null });
  if (rep.fields.standouts) out.withStandouts++;
  if (dry) { out.reports++; out.items.push({ id: ek, text: rep.text }); continue; }
  const h = await humaniseReport({ sentences: rep.sentences, tones: rep.tones, kinds: rep.kinds, winner: { card: m[w], full: fullName(m[w + 'Key'], m[w]) }, loser: { card: m[l], full: fullName(m[l + 'Key'], m[l]) } });
  if (h.usage) { out.tokens.input += h.usage.input; out.tokens.output += h.usage.output; }
  if (h.status !== 'ok') { out.errors.push(`${ek}: ${h.status} ${h.detail || ''}`); if (h.status === 'no-key' || /credit|401|403/.test(String(h.detail))) break; continue; }
  out.reports++; out.sentencesPassed += h.voice.passed; out.sentencesTotal += h.voice.total; if (h.voice.passed === h.voice.total) out.fully++;
  for (const f of h.voice.failures) out.why[f.why] = (out.why[f.why] || 0) + 1;
  out.items.push({ id: ek, passed: `${h.voice.passed}/${h.voice.total}`, failures: h.voice.failures.map((f) => `${f.i}: ${f.why}`), template: rep.text, text: h.text });
}
console.log('VOICE-PROBE ' + JSON.stringify(out));
