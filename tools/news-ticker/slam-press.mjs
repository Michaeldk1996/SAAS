// Grand Slam press conferences (founder 2026-11-15: "build this now"). The four Slams are not on Tennis TV, so their
// quotes come from the official press-conference transcripts (ASAP Sports FastScripts, the transcript service of the
// Slams). One day page lists that day's interviews; one interview page is the transcript of one player.
//   - a transcript is used for a match only when its own header names both players of that match ("A. ZVEREV/B. Shelton")
//   - a quote is one ANSWER of the player, word for word; a long answer is cut at the end of a sentence, never inside one
//   - no model call: the answers are ranked by how much they are about the match
// The site has no robots.txt (404, read 2026-11-15). Requests are sequential and at least 2 s apart, with our own name.
import crypto from 'node:crypto';

export const ASAP = 'https://www.asapsports.com', ASAP_UA = 'StennisfyNewsBot/1.0 (press-conference quotes, attributed)';
export const ASAP_GAP_MS = 2000, PRESS_MAX_PER_PLAYER = 4, PRESS_MIN_CHARS = 60, PRESS_MAX_CHARS = 420, PRESS_DAYS = 2;
export const PRESS_SOURCE = 'Press conference (ASAP Sports transcript)';
// our tournament name -> the transcript site's event title
export const slamTitle = (name) => { const n = String(name || '').toLowerCase();
  return /australian open/.test(n) ? 'AUSTRALIAN OPEN' : /french open|roland garros/.test(n) ? 'ROLAND GARROS' : /wimbledon/.test(n) ? 'THE CHAMPIONSHIPS' : /us open/.test(n) ? 'US OPEN' : null; };

const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
const ENT = { nbsp: ' ', amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', mdash: '—', ndash: '–' };
const text = (html) => String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>|<\/p>|<\/h\d>|<\/td>|<\/tr>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&([a-z]+);/gi, (m0, n) => (ENT[n.toLowerCase()] !== undefined ? ENT[n.toLowerCase()] : m0));

// -> [{ id, name }] the interviews listed on a day page
export function parseDayPage(html) {
  const out = [], seen = new Set();
  for (const m of String(html).matchAll(/show_interview\.php\?id=(\d+)"[^>]*>([^<]+)</g)) { if (!seen.has(m[1])) { seen.add(m[1]); out.push({ id: m[1], name: m[2].trim() }); } }
  return out;
}

// -> { header: string[] (the lines before the first turn: the match and its score), turns: [{ who, text }] } | null
export function parseInterview(html) {
  // the transcript runs from the page's last heading ("Press Conference", "Quick Quotes", ...) to the service's own closing line
  const h = String(html), b = h.indexOf('FastScripts Transcript by ASAP Sports'), a = b < 0 ? -1 : h.lastIndexOf('</h3>', b);
  if (a < 0) return null;
  const lines = text(h.slice(a, b)).split('\n').map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const header = [], turns = [];
  for (const ln of lines) {
    const m = /^(Q\.|THE MODERATOR:|[A-Z][A-Z .'’-]{2,40}:)\s*(.*)$/.exec(ln);
    if (m) turns.push({ who: m[1].replace(/[.:]$/, '').trim(), text: m[2].trim() });
    else if (turns.length) turns[turns.length - 1].text += ' ' + ln;
    else header.push(ln);
  }
  return { header, turns };
}

const MATCH_WORDS = /\b(match|today|tonight|set|sets|serve|served|serving|return|break|broke|tiebreak|tie-break|point|points|game|court|opponent|played|playing|level|win|won|lost|lose|final|title|trophy|crowd|pressure|nervous|nerves|physical|body|tired|fifth|fourth|third|second|first)\b/gi;
const cutAtSentence = (t, max) => { if (t.length <= max) return t; const part = t.slice(0, max), end = Math.max(part.lastIndexOf('. '), part.lastIndexOf('? '), part.lastIndexOf('! ')); return end >= PRESS_MIN_CHARS ? part.slice(0, end + 1) : null; };

// The player's answers about this match, best first. iv = parseInterview(); the transcript must be about this match:
// its header names both surnames. -> [{ text, question }]
export function pressAnswers(iv, fullName, opponentSurname, ownSurname) {
  if (!iv) return [];
  const head = fold(iv.header.join(' '));
  if (!head.includes(fold(ownSurname)) || !head.includes(fold(opponentSurname))) return [];
  const me = fold(fullName), out = [];
  iv.turns.forEach((t, i) => {
    if (fold(t.who) !== me) return;
    const q = i > 0 && iv.turns[i - 1].who === 'Q' ? iv.turns[i - 1].text : '';
    const full = t.text.replace(/\s+/g, ' ').trim(), cut = cutAtSentence(full, PRESS_MAX_CHARS);
    if (!cut || cut.length < PRESS_MIN_CHARS) return;
    const about = (`${q} ${cut}`.match(MATCH_WORDS) || []).length + (fold(`${q} ${cut}`).includes(fold(opponentSurname)) ? 3 : 0);
    if (about < 2) return;
    out.push({ text: cut, question: q, score: about / Math.sqrt(cut.length / 100), order: i });
  });
  return out.sort((x, y) => y.score - x.score || x.order - y.order).slice(0, PRESS_MAX_PER_PLAYER).sort((x, y) => x.order - y.order).map(({ text: tx, question }) => ({ text: tx, question }));
}

const topicOf = (q) => { const s = String(q || '').replace(/\s+/g, ' ').trim().split(/(?<=[.?!])\s/)[0] || ''; return s ? `Asked: ${s}`.slice(0, 60) : 'In his press conference'; };

// The quote candidates of one finished Slam match, in the quotes job's own candidate shape (preVerified: the answer was
// read word for word on the transcript page). match = { id, date, p1, p2, p1Key, p2Key, finalScore }; fullName(key) =
// the player's full name. cache = { [url]: true } of interview pages already read (never read twice).
export async function slamPressCandidates({ tournament, match, fullName, surnameOf, cache = {}, fetchFn = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = () => {} }) {
  const title = slamTitle(tournament), out = [];
  if (!title || !match || !match.date) return out;
  const get = async (url) => { await sleep(ASAP_GAP_MS); const r = await fetchFn(url, { headers: { 'user-agent': ASAP_UA }, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return new TextDecoder('latin1').decode(await r.arrayBuffer()); };
  const sides = ['p1', 'p2'].map((k) => ({ k, key: String(match[k + 'Key']), card: match[k], full: fullName(match[k + 'Key']), sur: surnameOf(match[k]) })).filter((s) => s.full);
  const d0 = Date.parse(match.date + 'T00:00:00Z'), done = new Set();
  for (let i = 0; i < PRESS_DAYS && done.size < sides.length; i++) {
    const d = new Date(d0 + i * 86400000), day = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
    let list;
    try { list = parseDayPage(await get(`${ASAP}/show_event.php?category=7&date=${day}&title=${title.replace(/ /g, '+')}`)); } catch (e) { log(`press: day page ${day} not read (${e.message})`); continue; }
    for (const s of sides) {
      if (done.has(s.k)) continue;
      const o = sides.find((x) => x.k !== s.k) || { card: match[s.k === 'p1' ? 'p2' : 'p1'], sur: surnameOf(match[s.k === 'p1' ? 'p2' : 'p1']) };
      for (const row of list.filter((x) => fold(x.name) === fold(s.full))) {
        const url = `${ASAP}/show_interview.php?id=${row.id}`;
        if (cache[url]) { done.add(s.k); continue; }
        let iv;
        try { iv = parseInterview(await get(url)); } catch (e) { log(`press: ${url} not read (${e.message})`); continue; }
        const answers = pressAnswers(iv, s.full, o.sur, s.sur);
        if (!answers.length) continue;   // another match of his (doubles, an earlier round) or nothing about the match
        cache[url] = { at: new Date().toISOString(), press: true }; done.add(s.k);
        const won = match.finalScore && match.finalScore.winner === s.k;
        for (const a of answers) out.push({ id: 'press-' + crypto.createHash('sha1').update(url + '|' + a.text).digest('hex').slice(0, 12), text: a.text, speakerKey: s.key, speaker: s.card, opponent: o.card, language: 'en', preVerified: true,
          checkedOn: 'the transcript page, word for word', sourceName: PRESS_SOURCE, sourceUrl: url, interview: 'press', topic: topicOf(a.question),
          timestamp: new Date(d.getTime() + 23 * 3600000).toISOString(), timestampKind: 'the day of the press conference (the transcript carries no time)', matchId: match.id, won, context: `${won ? 'after beating' : 'after losing to'} ${o.card}` });
      }
    }
  }
  return out;
}
