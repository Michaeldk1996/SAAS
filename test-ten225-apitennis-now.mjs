// TEN-225 item I(1) — the api-tennis Now: bulk-by-date + change detection.
//
// Founder 2026-09-19: "Poll get_odds bulk-by-date on a fixed cadence, detect
// when a price has actually changed, and publish the change... Only publish on
// an actual change; an unchanged sweep must not advance anything except the
// observation clock."
//
// The two limbs that are easy to get wrong while looking right:
//
//   1. BULK actually engages. A date threaded through the signature but never
//      reaching the cache still returns correct prices — from 84 calls instead
//      of 3. Correct output, none of the benefit, and nothing would notice.
//   2. "UNCHANGED" is decided on the PRICE, not the record. Comparing whole
//      objects makes every sweep a change (seenAt is in them), so the detector
//      reports changes forever and the `since` clock never holds. That failure
//      also looks healthy in the logs — it reports lots of changes.
//
// Functions are SLICED OUT OF bsp-pipeline.js, not copied, so this goes red if
// the pipeline changes and this file does not. Standing rule N: every state
// below is manufactured; none of it waits on a live feed.
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('./bsp-pipeline.js', import.meta.url), 'utf8');

function slice(name, kind = 'function') {
  const pat = kind === 'async' ? `async function ${name}(` : `function ${name}(`;
  const at = SRC.indexOf(pat);
  if (at < 0) throw new Error(`${name} not found in bsp-pipeline.js`);
  let i = SRC.indexOf('{', at), depth = 0;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (!depth) return SRC.slice(at, j + 1); }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const FAILED = [];
const check = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '   ' + detail : ''}`);
  if (!cond) FAILED.push(name);
};

// A get_odds day payload, in the vendor's real shape (measured 2026-09-19:
// result is keyed by event key, each carrying Home/Away -> side -> book -> price
// as a STRING).
const day = (fixtures) => ({ success: 1, result: fixtures });
const fx = (books) => ({
  'Home/Away': {
    Home: Object.fromEntries(Object.entries(books).map(([b, v]) => [b, String(v[0])])),
    Away: Object.fromEntries(Object.entries(books).map(([b, v]) => [b, String(v[1])])),
  },
});

function build({ payloads = {}, failDates = [] } = {}) {
  const calls = [];
  const code = `
    const API_TENNIS_BASE = 'https://x/';
    const API_TENNIS_KEY  = 'k';
    const CALLS = [];
    const PAYLOADS = ${JSON.stringify(payloads)};
    const FAILDATES = ${JSON.stringify(failDates)};
    const console = { error: () => {} };
    const fetch = async (url) => {
      CALLS.push(url);
      const d = /date_start=([0-9-]+)/.exec(url);
      if (d) {
        if (FAILDATES.includes(d[1])) throw new Error('boom');
        return { json: async () => PAYLOADS[d[1]] || { result: null } };
      }
      const mk = /match_key=([^&]+)/.exec(url);
      // The per-match shape the fallback expects: result keyed by event key.
      for (const p of Object.values(PAYLOADS)) {
        if (p && p.result && p.result[mk[1]]) {
          return { json: async () => ({ result: { [mk[1]]: p.result[mk[1]] } }) };
        }
      }
      return { json: async () => ({ result: null }) };
    };
    ${slice('fetchApiTennisOddsForDate', 'async')}
    ${slice('_shapeApiTennisOdds')}
    ${slice('fetchApiTennisMatchOdds', 'async')}
    return { fetchApiTennisMatchOdds, fetchApiTennisOddsForDate, CALLS,
             _atOddsByDate };
  `;
  // eslint-disable-next-line no-new-func
  return new Function(`const _atOddsByDate = new Map();\n${code}`)();
}

console.log('TEN-225 item I(1) — api-tennis Now: bulk-by-date + change detection');

console.log('\n  — LIMB 1: one call per DATE, not one per match');
{
  const P = { '2026-09-19': day({
    '111': fx({ bet365: [2.1, 1.8], Sbo: [2.0, 1.85] }),
    '222': fx({ bet365: [1.5, 2.6] }),
    '333': fx({ Betano: [3.0, 1.4] }),
  }) };
  const api = build({ payloads: P });
  const r = [];
  for (const ek of ['111', '222', '333']) {
    r.push(await api.fetchApiTennisMatchOdds(ek, '2026-09-19'));
  }
  check('three fixtures on one date cost ONE http call, not three',
        api.CALLS.length === 1, `${api.CALLS.length} call(s)`);
  check('...and that call is the bulk date form, not a match_key form',
        /date_start=2026-09-19&date_stop=2026-09-19/.test(api.CALLS[0])
        && !/match_key/.test(api.CALLS[0]));
  check('every fixture still got its own correct pair — fewer calls, same data',
        r[0].odds.p1 === 2.1 && r[1].odds.p1 === 1.5 && r[2].odds.p1 === 3.0,
        r.map(x => `${x.odds.bookmaker} ${x.odds.p1}/${x.odds.p2}`).join(' | '));
  check('the per-book map survives the bulk path, so takeover Opens still accrue',
        Object.keys(r[0].allBooks).sort().join(',') === 'Sbo,bet365',
        JSON.stringify(r[0].allBooks));
  check('a date is fetched ONCE and cached for the whole run',
        api._atOddsByDate.size === 1);

  // CONTROL: two DIFFERENT dates must cost two calls. Without this, a build that
  // cached one payload and served it for everything would pass everything above.
  const api2 = build({ payloads: {
    '2026-09-19': day({ '111': fx({ bet365: [2.1, 1.8] }) }),
    '2026-09-20': day({ '999': fx({ bet365: [4.0, 1.2] }) }),
  } });
  const a = await api2.fetchApiTennisMatchOdds('111', '2026-09-19');
  const b = await api2.fetchApiTennisMatchOdds('999', '2026-09-20');
  check('CONTROL: two dates cost two calls and return DIFFERENT prices, so the '
      + 'single call above is caching and not a stub returning one answer',
        api2.CALLS.length === 2 && a.odds.p1 === 2.1 && b.odds.p1 === 4.0,
        `${api2.CALLS.length} calls, ${a.odds.p1} vs ${b.odds.p1}`);
}

console.log('\n  — a date that returns but omits the fixture is a real "no odds"');
{
  const api = build({ payloads: { '2026-09-19': day({ '111': fx({ bet365: [2.1, 1.8] }) }) } });
  const r = await api.fetchApiTennisMatchOdds('404', '2026-09-19');
  check('missing fixture on a GOOD date returns null without a second call',
        r === null && api.CALLS.length === 1, `${api.CALLS.length} call(s)`);
}

console.log('\n  — a FAILED date falls back to per-match, it does not dash the day');
{
  const api = build({
    payloads: { '2026-09-19': day({ '111': fx({ bet365: [2.1, 1.8] }) }) },
    failDates: ['2026-09-19'],
  });
  const r = await api.fetchApiTennisMatchOdds('111', '2026-09-19');
  check('the price still arrives, via the per-match fallback',
        r && r.odds.p1 === 2.1, r ? `${r.odds.p1}/${r.odds.p2}` : 'NULL');
  check('...and the fallback really was a match_key call',
        api.CALLS.some(u => /match_key=111/.test(u)));
  check('a failed bulk day costs CALLS, never PRICES — which is the trade a '
      + 'bulk optimisation must never get backwards',
        r !== null);
}

console.log('\n  — no date supplied: the per-match path still works');
{
  const api = build({ payloads: { '2026-09-19': day({ '111': fx({ bet365: [2.1, 1.8] }) }) } });
  const r = await api.fetchApiTennisMatchOdds('111');
  check('a caller with no date is served rather than dashed',
        r && r.odds.p1 === 2.1);
  check('...by a match_key call, since there is no date to bulk on',
        api.CALLS.every(u => /match_key/.test(u)));
}

console.log('\n  — the shaping rule is shared, so the two paths cannot drift');
{
  // Both paths must reject a one-sided book identically. A bulk path that
  // quietly accepted one would publish a pair no book ever quoted.
  const P = { '2026-09-19': { success: 1, result: { '111': {
    'Home/Away': { Home: { bet365: '2.1', Sbo: '2.0' }, Away: { bet365: '1.8' } },
  } } } };
  const api = build({ payloads: P });
  const viaBulk = await api.fetchApiTennisMatchOdds('111', '2026-09-19');
  const api2 = build({ payloads: P });
  const viaMatch = await api2.fetchApiTennisMatchOdds('111');
  check('a book quoting only ONE side is excluded on the bulk path',
        !('Sbo' in viaBulk.allBooks), JSON.stringify(viaBulk.allBooks));
  check('...and the two paths return the SAME shape for the same input',
        JSON.stringify(Object.keys(viaBulk.allBooks))
          === JSON.stringify(Object.keys(viaMatch.allBooks)));
}

console.log('\n  — LIMB 2: change detection holds `since` and advances `seenAt`');
{
  // trackBookNow is a closure inside the build, so its RULE is reproduced here
  // and pinned to the shipped source by the assertions below. The rule is two
  // lines; what matters is which fields each clock follows.
  const rule = (prev, raw, seenAt) => {
    const out = {};
    for (const bk of Object.keys(raw)) {
      const v = raw[bk], was = prev[bk];
      const unchanged = was && was.p1 === v.p1 && was.p2 === v.p2;
      out[bk] = { p1: v.p1, p2: v.p2, seenAt, since: unchanged ? was.since : seenAt };
    }
    return out;
  };
  check('the shipped detector compares the PRICE PAIR, not the whole record — '
      + 'comparing records makes every sweep a change, because seenAt is in them',
        SRC.includes('was.p1 === v.p1 && was.p2 === v.p2'));
  check('the shipped detector holds `since` on an unchanged price',
        SRC.includes('since: unchanged ? was.since : seenAt'));
  check('...and advances seenAt unconditionally, which is the founder\'s "except"',
        /seenAt,\s*\/\/ advances always/.test(SRC));

  const t1 = '2026-09-19T00:00:00Z', t2 = '2026-09-19T00:15:00Z', t3 = '2026-09-19T00:30:00Z';
  let st = rule({}, { bet365: { p1: 2.1, p2: 1.8 } }, t1);
  check('first sighting: since == seenAt', st.bet365.since === t1 && st.bet365.seenAt === t1);

  st = rule(st, { bet365: { p1: 2.1, p2: 1.8 } }, t2);
  check('UNCHANGED sweep advances the observation clock', st.bet365.seenAt === t2);
  check('...and does NOT advance `since` — the price has stood since t1',
        st.bet365.since === t1, st.bet365.since);

  st = rule(st, { bet365: { p1: 2.2, p2: 1.75 } }, t3);
  check('a REAL change moves `since` to the sweep that first saw it',
        st.bet365.since === t3 && st.bet365.p1 === 2.2);

  // The asymmetry that makes this worth having: one book moves, another holds.
  let m = rule({}, { bet365: { p1: 2.1, p2: 1.8 }, Sbo: { p1: 2.0, p2: 1.9 } }, t1);
  m = rule(m, { bet365: { p1: 2.1, p2: 1.8 }, Sbo: { p1: 2.05, p2: 1.87 } }, t2);
  check('books are tracked INDEPENDENTLY — a mover must not reset a holder',
        m.bet365.since === t1 && m.Sbo.since === t2,
        `bet365 since ${m.bet365.since}, Sbo since ${m.Sbo.since}`);
  check('a book that vanishes from the payload is simply absent, never carried '
      + 'forward as a current price',
        !('Sbo' in rule(m, { bet365: { p1: 2.1, p2: 1.8 } }, t3)));
}

console.log('\n  — the carry-forward, without which the detector is a no-op');
{
  check('bookNow is in the prior-odds filter, so a fixture whose ONLY odds fact '
      + 'is a current price is still carried (else every sweep reads as a change)',
        SRC.includes('&& !pm.bookNow) continue;'));
  check('...and is actually copied onto the carried record',
        SRC.includes('bookNow: pm.bookNow || null,'));
  check('trackBookNow is handed `carried`, not m.bookNow (unwritten this run)',
        SRC.includes('trackBookNow(m, carried);'));
  check('a settled fixture is excluded — a post-match quote is not a Now',
        /trackBookNow[\s\S]{0,700}if \(m\.finalScore\) return;/.test(SRC));
}

console.log('');
if (FAILED.length) {
  console.log(`${FAILED.length} FAILED: ${JSON.stringify(FAILED)}`);
  process.exit(1);
}
console.log('all checks passed');
