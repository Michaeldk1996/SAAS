// News ticker — Tennis TV on-court interviews, automatic (founder 2026-11-12: "Publish automatically").
// Two steps around the Fly worker (interviews-worker/), run by .github/workflows/interviews.yml every 5 minutes:
//   list    Tennis TV's own dated clip feed -> the new singles interview clips of players on our board -> clips.json
//   ingest  the worker's transcripts -> the player's answers, each with a topic -> news-quotes/inbox-ttv.json
// RULES (.claude/rules/news-ticker.md): answers only, never the interviewer's questions; every published word is in the
// transcript, in order (the model may choose spans and punctuate, nothing else); a clip whose player is not exactly one
// player on our board is skipped; an answer that fails the check is dropped and counted, never repaired.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
export const HL_FEED = 'https://api.tennistv.com/content/atpmedia/VIDEO/EN?tagNames=video-type:match-highlights&pageSize=30';
export const MAX_HIGHLIGHTS = 2;   // per run: a highlights clip plays for ten minutes
export const FEED = 'https://api.tennistv.com/content/atpmedia/VIDEO/EN?tagNames=video-type:interviews&pageSize=30';
export const CLIP_DAYS = 3;        // a clip older than this is never picked up
export const MAX_CLIPS = 8;        // per run
export const MAX_TRIES = 3;        // a clip that failed this often is left alone
export const INBOX_DAYS = 14;
export const MAX_ANSWERS = 6;
export const MIN_WORDS = 5;
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.NEWS_INTERVIEW_MODEL || process.env.NEWS_TRANSLATE_MODEL || 'claude-opus-5-5';

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = (s) => fold(s).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// "Stockholm 2026 QF Thiago Agustin Tirante Interview" -> { tournament, year, round, player }
export function parseTitle(title) {
  const m = /^(.+?)\s+(20\d\d)\s+(R\d|QF|SF|F|Final|RR)\s+(.+?)\s+interview\s*$/i.exec(String(title || '').trim());
  return m ? { tournament: m[1].trim(), year: m[2], round: m[3].toUpperCase(), player: m[4].trim() } : null;
}

// The clip's player on our board: the cards of the tournament the title names, a player whose surname ends the title's
// name (and whose initial fits when the title carries a first name). Exactly one, else null.
export function resolveClip(clip, cards) {
  const t = parseTitle(clip.title);
  if (!t) return null;
  const tour = fold(t.tournament), field = new Map();
  for (const m of cards || []) {
    if (!fold(m.tour).includes(tour)) continue;
    for (const s of ['p1', 'p2']) if (m[s + 'Key'] != null && m[s]) field.set(String(m[s + 'Key']), m[s]);
  }
  const want = words(t.player).split(' ');
  const hits = [];
  for (const [key, name] of field) {
    const w = words(name).split(' ').filter((x) => x.length > 1);      // "T. A. Tirante" -> ["tirante"]
    const init = words(name)[0];
    if (!w.length || w.join(' ') !== want.slice(-w.length).join(' ')) continue;
    if (want.length > w.length && want[0][0] !== init) continue;       // a first name in the title must fit the initial
    hits.push({ key, name });
  }
  return hits.length === 1 ? { ...t, speakerKey: hits[0].key, speaker: hits[0].name } : null;
}

// New clips to record: singles interviews of the last CLIP_DAYS days, not done, not out of tries, resolvable.
export function pickClips(feed, state, cards, nowIso) {
  const out = [], skipped = { old: 0, done: 0, doubles: 0, noPlayer: 0, tries: 0 };
  const now = Date.parse(nowIso);
  for (const c of (feed && feed.content) || []) {
    const tags = (c.tags || []).map((x) => x.label);
    if (!tags.includes('video-type:interviews')) continue;
    if (!tags.includes('match-type:singles')) { skipped.doubles++; continue; }
    const ts = Date.parse(c.date);
    if (!Number.isFinite(ts) || now - ts > CLIP_DAYS * 86400000) { skipped.old++; continue; }
    const st = (state.clips || {})[String(c.id)];
    if (st && st.status === 'done') { skipped.done++; continue; }
    if (st && (st.tries || 0) >= MAX_TRIES) { skipped.tries++; continue; }
    const who = resolveClip(c, cards);
    if (!who) { skipped.noPlayer++; continue; }
    out.push({ id: String(c.id), url: `https://www.tennistv.com/videos/${c.id}/${c.titleUrlSegment}`, slug: who.speaker, round: who.round,
      title: c.title, date: new Date(ts).toISOString(), speakerKey: who.speakerKey, tournament: who.tournament });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return { clips: out.slice(0, MAX_CLIPS), skipped };
}

// "Stockholm 2026 QF Musetti Humbert Highlights" -> the finished match of those two players on our board (exactly one).
export function resolveHighlights(clip, cards) {
  const m = /^(.+?)\s+(20\d\d)\s+(R\d|QF|SF|F|Final|RR)\s+(.+?)\s+highlights\s*$/i.exec(String(clip.title || '').trim());
  if (!m) return null;
  const tour = fold(m[1]), names = words(m[4]);
  const hits = (cards || []).filter((c) => fold(c.tour).includes(tour) && c.finalScore && c.finalScore.winner && !c.walkover
    && ['p1', 'p2'].every((k) => { const sur = words(c[k]).split(' ').filter((x) => x.length > 1).join(' '); return sur && (' ' + names + ' ').includes(' ' + sur + ' '); }));
  if (hits.length !== 1) return null;
  const c = hits[0];
  return { eventKey: String(c.id).split('-').slice(1).join('-'), p1: c.p1, p2: c.p2, tournament: m[1].trim(), round: m[3].toUpperCase() };
}
export function pickHighlights(feed, state, cards, nowIso) {
  const out = [], now = Date.parse(nowIso);
  for (const c of (feed && feed.content) || []) {
    const tags = (c.tags || []).map((x) => x.label);
    if (!tags.includes('video-type:match-highlights') || !tags.includes('match-type:singles')) continue;
    const ts = Date.parse(c.date);
    if (!Number.isFinite(ts) || now - ts > CLIP_DAYS * 86400000) continue;
    const st = (state.clips || {})['hl' + c.id];
    if (st && (st.status === 'done' || (st.tries || 0) >= MAX_TRIES)) continue;
    const who = resolveHighlights(c, cards);
    if (!who) continue;
    out.push({ id: 'hl' + c.id, kind: 'highlights', url: `https://www.tennistv.com/videos/${c.id}/${c.titleUrlSegment}`, slug: `${who.p1} v ${who.p2} highlights`, round: who.round,
      title: c.title, date: new Date(ts).toISOString(), eventKey: who.eventKey, p1: who.p1, p2: who.p2, tournament: who.tournament });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out.slice(0, MAX_HIGHLIGHTS);
}

// What the commentators said, in two or three plain sentences. OURS, a summary, never a quotation. The check: every
// number in it is in the transcript, and every capitalised name is in the transcript or is one of the two players.
export function commentaryOk(text, transcript, players) {
  const t = String(text || '').trim();
  if (t.length < 40 || t.length > 420 || /["“”]/.test(t)) return false;
  if (/commentat|commentary|broadcast|\b(I|we|me|my|our)\b/i.test(t)) return false;   // our own observation: no source named, no first person (founder 2026-11-13)
  const hay = fold(transcript), allowed = fold((players || []).join(' '));
  for (const n of t.match(/\d+(?:[.,]\d+)?/g) || []) if (!hay.includes(n)) return false;
  const re = /(^|[.!?]\s+)?(\p{Lu}[\p{L}'’-]+)/gu;
  let m;
  while ((m = re.exec(t))) {
    if (m[1] !== undefined || m.index === 0) continue;                 // a sentence opener is not a name
    const w = fold(m[2]);
    if (!hay.includes(w) && !allowed.includes(w)) return false;
  }
  return true;
}
const HL_SYSTEM = `You are given a rough transcript of TV commentary over the highlights of one tennis match (it jumps between points and has mis-heard words). Write what happened in the match in two or three plain sentences for a match report, as plain observations of the match.
Rules:
- Only what the commentators actually said: how each player played, turning points, physical problems, reasons they gave. Nothing from your own knowledge.
- Simple words everybody understands, no idioms, no quotation marks, no hype. Refer to the players by surname only.
- Never mention the commentators, the commentary, the broadcast or the highlights, and never write "I" or "we": state each point as a fact of the match ("Ruud struggled behind his second serve.").
- Use a number or a name only if it is clearly in the transcript. If a word looks mis-heard, leave that part out.
- If the transcript carries nothing worth reporting, reply with exactly: NONE`;
export async function summariseCommentary(transcript, players, apiKey = process.env.ANTHROPIC_API_KEY, fetchFn = fetch) {
  if (!apiKey) return { status: 'no-key', text: null };
  const body = { model: MODEL, max_tokens: 600, output_config: { effort: 'low' }, system: HL_SYSTEM,
    messages: [{ role: 'user', content: `Players: ${players.join(' v ')}\n\nCommentary transcript:\n${String(transcript).slice(0, 12000)}` }] };
  let res;
  try { res = await fetchFn(API_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) }); }
  catch (e) { return { status: 'api-error', text: null, detail: String(e).slice(0, 200) }; }
  if (!res.ok) return { status: 'api-error', text: null, detail: `HTTP ${res.status}` };
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === 'text');
  const out = block ? String(block.text).trim() : '';
  if (out === 'NONE') return { status: 'nothing', text: null };
  return commentaryOk(out, transcript, players.flatMap((p) => String(p).split(/\s+/))) ? { status: 'ok', text: out, model: MODEL } : { status: 'failed-check', text: null };
}

// Mis-hearings the transcriber makes on tennis words. Applied to the transcript before anything reads it; listed here
// and nowhere else. A word that is not on this list is never changed.
export const CORRECTIONS = [[/\btoo many arrows\b/gi, 'too many errors'], [/\bmaking arrows\b/gi, 'making errors'], [/\btie ?wreck\b/gi, 'tiebreak'],
  [/\bcent(?:er|re) good\b/gi, 'centre court'], [/\bDavid'?s Cup\b/g, 'Davis Cup'], [/\bbrake point/gi, 'break point']];
export const correct = (t) => CORRECTIONS.reduce((s, [re, to]) => s.replace(re, to), String(t || ''));

// One answer from the model -> the published text, or null. Every span's words are in the transcript, in order; no
// question; long enough; a topic of the form "On …".
export function checkAnswer(a, transcript) {
  if (!a || typeof a.topic !== 'string' || !Array.isArray(a.spans) || !a.spans.length || a.spans.length > 3) return null;
  const topic = a.topic.trim().replace(/[:.]+$/, '');
  if (!/^On [A-Za-z0-9' ,-]{2,58}$/.test(topic)) return null;
  const hay = ' ' + words(transcript) + ' ';
  let at = 0, n = 0;
  for (const sp of a.spans) {
    if (typeof sp !== 'string' || /\?/.test(sp)) return null;
    const w = words(sp);
    const i = hay.indexOf(' ' + w + ' ', at);
    if (!w || i < 0) return null;
    at = i + w.length; n += w.split(' ').length;
  }
  if (n < MIN_WORDS) return null;
  return { topic, text: a.spans.map((s) => s.trim()).join(' … ') };
}

const SYSTEM = `You are given the transcript of a short on-court TV interview with a tennis player after his match. It has no speaker labels: an interviewer asks questions and the player answers.
Return ONLY a JSON array (no prose) of the player's answers worth quoting, at most ${MAX_ANSWERS}, in the order spoken:
[{"topic":"On the first set","spans":["..."]}]
Rules:
- "spans" are stretches of the PLAYER's words copied from the transcript word for word, in order. You may add punctuation and capital letters. You may not add, remove, replace or reorder any word. Use two or three spans in one answer only to skip words in between.
- Never include the interviewer's words. Never include a question.
- Skip anything that is unclear, garbled or looks mis-heard (a name that makes no sense, a sentence that does not parse). When unsure, leave it out.
- Skip greetings, thanks and small talk with no content.
- "topic" starts with "On " and says what the answer is about in a few plain words ("On the first set", "On his serve", "On his physical condition", "On playing Fritz next").
If nothing is worth quoting, return [].`;

export async function splitInterview(transcript, player, apiKey = process.env.ANTHROPIC_API_KEY, fetchFn = fetch) {
  if (!apiKey) return { status: 'no-key', answers: [] };
  const body = { model: MODEL, max_tokens: 3000, output_config: { effort: 'low' }, system: SYSTEM,
    messages: [{ role: 'user', content: `Player: ${player}\n\nTranscript:\n${transcript}` }] };
  let res;
  try { res = await fetchFn(API_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) }); }
  catch (e) { return { status: 'api-error', answers: [], detail: String(e).slice(0, 200) }; }
  if (!res.ok) { const t = res.text ? await res.text().catch(() => '') : ''; return { status: 'api-error', answers: [], detail: `HTTP ${res.status} ${String(t).slice(0, 200)}` }; }
  const data = await res.json();
  const block = (data.content || []).find((b) => b.type === 'text');
  let arr;
  try { arr = JSON.parse(String(block ? block.text : '').replace(/^```(?:json)?|```$/gm, '').trim()); } catch (e) { return { status: 'bad-json', answers: [] }; }
  if (!Array.isArray(arr)) return { status: 'bad-json', answers: [] };
  const answers = [], seen = new Set();
  let dropped = 0;
  for (const a of arr.slice(0, MAX_ANSWERS)) {
    const ok = checkAnswer(a, transcript);
    if (!ok || seen.has(ok.text)) { dropped++; continue; }
    seen.add(ok.text); answers.push(ok);
  }
  return { status: 'ok', answers, dropped, model: MODEL };
}

export function rowsFor(clip, answers, nowIso) {
  return answers.map((a, i) => ({ id: `ttv|${clip.id}|${i + 1}`, speakerKey: String(clip.speakerKey), text: a.text, topic: a.topic, sourceUrl: clip.url,
    timestamp: clip.date, timestampKind: 'observed (Tennis TV published the clip then)', day: clip.date.slice(0, 10), mentions: [fold(clip.tournament)],
    verbatim: "transcribed from the clip's audio by the interviews worker; the player's answers only, every word checked against the transcript", readAt: nowIso }));
}
export function mergeInbox(prev, rows, nowIso) {
  const by = new Map(((prev && prev.candidates) || []).map((x) => [x.id, x]));
  for (const r of rows) if (!by.has(r.id)) by.set(r.id, r);
  const cut = Date.parse(nowIso) - INBOX_DAYS * 86400000;
  return { updatedAt: nowIso, candidates: [...by.values()].filter((x) => !(Date.parse(x.readAt) < cut)) };
}

// The worker prints one JSON line between two markers; the Fly log stream puts a prefix in front of every line.
export function parseWorkerLog(log) {
  const lines = String(log || '').replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/);
  const a = lines.findIndex((l) => l.includes('===RESULTS_JSON_START===')), b = lines.findIndex((l) => l.includes('===RESULTS_JSON_END==='));
  if (a < 0 || b <= a) return null;
  for (const l of lines.slice(a + 1, b)) { const i = l.indexOf('{"model"'); if (i >= 0) { try { return JSON.parse(l.slice(i)); } catch (e) { return null; } } }
  return null;
}

const rd = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const wr = (f, o) => { const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 1) + '\n'); fs.renameSync(t, f); };

async function main() {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
  const mode = process.argv[2], nowIso = arg('now', new Date().toISOString());
  const DIR = path.resolve(arg('dir', ROOT)), BASE = arg('base', 'https://michaeldk1996.github.io/SAAS').replace(/\/$/, '');
  const stateFile = path.join(DIR, 'news-quotes/ttv-state.json'), inboxFile = path.join(DIR, 'news-quotes/inbox-ttv.json');
  const state = rd(stateFile, { clips: {} });
  if (mode === 'list') {
    const feed = await (await fetch(FEED, { headers: { 'user-agent': 'Mozilla/5.0 (stennisfy news ticker)' } })).json();
    let cards = await (await fetch(BASE + '/matches.json')).json(); cards = Array.isArray(cards) ? cards : cards.matches || [];
    const r = pickClips(feed, state, cards, nowIso);
    let hl = [];
    try { hl = pickHighlights(await (await fetch(HL_FEED, { headers: { 'user-agent': 'Mozilla/5.0 (stennisfy news ticker)' } })).json(), state, cards, nowIso); }
    catch (e) { console.log('ttv highlights: the feed could not be read (' + String(e.message || e).slice(0, 80) + ')'); }
    fs.writeFileSync(arg('out', '/tmp/clips.json'), JSON.stringify(r.clips.concat(hl)));
    console.log(`ttv interviews: ${r.clips.length} new clip(s) · skipped ${JSON.stringify(r.skipped)} · ${hl.length} highlights clip(s) for commentary`);
    r.clips.forEach((c) => console.log(`  ${c.id} ${c.title} -> ${c.slug} (${c.speakerKey})`));
    hl.forEach((c) => console.log(`  ${c.id} ${c.title} -> match ${c.eventKey}`));
    return;
  }
  if (mode === 'ingest') {
    const clips = rd(arg('clips', '/tmp/clips.json'), []);
    const res = parseWorkerLog(fs.readFileSync(arg('log', '/tmp/logs.txt'), 'utf8'));
    const byUrl = new Map(((res && res.results) || []).map((x) => [x.url, x]));
    let rows = [], done = 0, failed = 0, dropped = 0, commented = 0;
    const commentaryFile = path.join(DIR, 'news-quotes/commentary.json');
    const commentary = rd(commentaryFile, { byMatch: {} });
    for (const c of clips) {
      const st = state.clips[c.id] || (state.clips[c.id] = { tries: 0 });
      st.tries = (st.tries || 0) + 1; st.at = nowIso; st.title = c.title;
      const r = byUrl.get(c.url);
      if (!r || !r.ok || !r.transcript) { st.status = 'failed'; st.error = r ? r.error : 'no result from the worker'; failed++; continue; }
      if (c.kind === 'highlights') {
        const cm = await summariseCommentary(correct(r.transcript), [c.p1, c.p2]);
        if (cm.status === 'no-key' || cm.status === 'api-error') { st.status = 'failed'; st.error = 'commentary: ' + cm.status + (cm.detail ? ' ' + cm.detail : ''); failed++; continue; }
        if (cm.status === 'ok') { commentary.byMatch[c.eventKey] = { text: cm.text, sourceUrl: c.url, sourceName: 'Tennis TV highlights commentary', clipPublishedAt: c.date, at: nowIso }; commented++; }
        st.status = 'done'; st.commentary = cm.status; delete st.error; done++;
        continue;
      }
      const sp = await splitInterview(correct(r.transcript), c.slug);
      if (sp.status !== 'ok') { st.status = 'failed'; st.error = 'split: ' + sp.status + (sp.detail ? ' ' + sp.detail : ''); failed++; continue; }
      rows = rows.concat(rowsFor(c, sp.answers, nowIso)); dropped += sp.dropped || 0;
      st.status = 'done'; st.answers = sp.answers.length; delete st.error; done++;
    }
    const cut = Date.parse(nowIso) - 30 * 86400000;
    for (const k of Object.keys(state.clips)) if (Date.parse(state.clips[k].at) < cut) delete state.clips[k];
    for (const k of Object.keys(commentary.byMatch)) if (Date.parse(commentary.byMatch[k].at) < cut) delete commentary.byMatch[k];
    if (commented) { commentary.updatedAt = nowIso; wr(commentaryFile, commentary); }
    wr(inboxFile, mergeInbox(rd(inboxFile, null), rows, nowIso)); wr(stateFile, state);
    console.log(`ttv interviews: ${done} clip(s) done, ${failed} failed, ${rows.length} answer(s) added, ${dropped} answer(s) dropped by the word check, ${commented} commentary summar${commented === 1 ? 'y' : 'ies'}`);
    if (failed) for (const c of clips) if (state.clips[c.id].status === 'failed') console.log(`  FAILED ${c.id} ${c.title}: ${state.clips[c.id].error} (try ${state.clips[c.id].tries} of ${MAX_TRIES})`);
    return;
  }
  console.error('usage: ttv-interviews.mjs list|ingest'); process.exit(2);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
