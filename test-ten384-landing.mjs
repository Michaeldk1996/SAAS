// TEN-384 step 4 (Players landing + legacy profile clean-up).
// Drives the page's REAL functions (sliced out of bsp-consult-dashboard.html and executed against a tiny DOM shim):
//   · header card on the Today's Matches pattern: caps eyebrow, title, colon sub, Players · Tournaments · Updated
//   · no search helper line
//   · one group per tournament; meta "Hard · 500 · N players", the tier from TOURX_TIER_CODE, omitted when unknown
//   · player card: rank "#N" ("—" when absent), two-letter initials, a lifted odds tile that is NOT a link,
//     "View profile →" a --link only when a profile exists; no outline, no hover lift
//   · ruling Q9: every player in each event's main draw (board rows + tournament-progression.json), kept after
//     a loss, grouped per tournament, ordered by rank; header stats = whole draw + number of events
//   · item 8: the legacy renderer carries no Market performance / Favourite vs underdog reliability / Read on the
//     market, and still lazy-loads the odds shard that the Key insights market card reads
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(process.env.TEN384_HTML || join(HERE, 'bsp-consult-dashboard.html'), 'utf8');
function slice(name) {
  const start = html.indexOf(`\nfunction ${name}(`);
  assert.ok(start > 0, `${name} not found`);
  let d = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) { if (html[i] === '{') d++; else if (html[i] === '}' && --d === 0) break; }
  return html.slice(start, i + 1);
}
function constLine(name) {
  const start = html.indexOf(`\nconst ${name} = `);
  assert.ok(start > 0, `const ${name} not found`);
  return html.slice(start, html.indexOf('\n', start + 1));
}
function cssRule(sel) {
  const re = new RegExp('\\n\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}', 'g');
  const all = [...html.matchAll(re)];
  return all.length ? all[all.length - 1][1] : null;
}

// ---- execute the landing renderer -------------------------------------------------------------
function runLanding(matches, profiles, progression = { tournaments: {} }, indexRows = null) {
  const els = { playerGroups: { innerHTML: '' }, pgHeaderStats: { innerHTML: '' } };
  const src = [
    'pesc', 'pgRankOf', 'pp2LiveRankOf', 'pgTierCode', 'pgInitials', 'pgRenderHeaderStats', 'getPlayersFromMatches', 'renderPlayers',
  ].map(slice).join('\n') + '\n' + constLine('TOURX_TIER_CODE') + '\n' + constLine('PG_EXT_SVG');
  const body = `
    const document = { getElementById: id => els[id] || null };
    const matches = ${JSON.stringify(matches)};
    const playerProfiles = ${JSON.stringify(profiles)};
    const tournamentProgression = ${JSON.stringify(progression)};
    ${indexRows ? 'const playerIndex = ' + JSON.stringify(indexRows) + ';' : ''}
    let pgLookupsLoaded = true;
    const cardStartMs = () => NaN;
    const photoCandidatesFor = () => [];
    const pgArchetypeFor = () => 'All Court Elite';
    const pgEloFor = () => 2141;
    const loadPlayerCardLookups = () => {};
    const mxOddsUpdatedAt = () => null;
    ${src}
    renderPlayers('');
    return els;`;
  return new Function('els', body)(els);
}
const M = (p1, k1, r1, p2, k2, r2, tour, category, extra = {}) => Object.assign({
  p1, p1Key: k1, p1Rank: r1, p2, p2Key: k2, p2Rank: r2, tour, surface: 'hard', live: false, finalScore: null,
  venue: category ? { category } : undefined,
  bestOdds: { p1: { price: 1.11, bookmaker: 'Pncl' }, p2: { price: 6.7, bookmaker: 'bet365' } },
}, extra);

test('header card: caps eyebrow, title, colon sub and the three stats; no helper line', () => {
  assert.match(html, /<div class="pgh-eyebrow">ATP tour · this week's draws<\/div>/);
  assert.match(html, /<h1 class="pgh-title">Players<\/h1>/);
  assert.match(html, /<p class="pgh-sub">Full profiles, ratings and form: the context behind every price\.<\/p>/);
  assert.ok(!/pgsearch-helper/.test(html), 'the search helper line is gone (markup and CSS)');
  assert.match(cssRule('.pgh-eyebrow'), /font-size:10\.5px; font-weight:700; letter-spacing:0\.10em; text-transform:uppercase; color:var\(--text-label\)/);
  assert.match(cssRule('.pgh-title'), /font-size:29px; font-weight:800/);
  assert.match(cssRule('.pgh-card'), /background:var\(--card\); border:1px solid transparent; box-shadow:var\(--top-light\)/);
  assert.match(cssRule('.pgh-stat-v'), /font-family:var\(--font-nums\); font-size:17px; font-weight:700; color:var\(--text\)/);
  const { pgHeaderStats } = runLanding([
    M('C. Alcaraz', 2382, 3, 'J. Munar', 1, 64, 'ATP Tokyo', 'ATP 500'),
    M('A. De Minaur', 1106, 10, 'H. Hurkacz', 2, 41, 'ATP Beijing', 'ATP 500'),
  ], {});
  const stats = [...pgHeaderStats.innerHTML.matchAll(/pgh-stat-l">([^<]*)<\/span><span class="pgh-stat-v">([^<]*)</g)].map(x => x[1] + '=' + x[2]);
  assert.deepEqual(stats, ['Players=4', 'Tournaments=2', 'Updated=—'], 'no odds clock reads "—", never a made-up time');
});

test('groups: one per tournament, meta "Hard · 500 · N players", the tier omitted when the category is unknown', () => {
  const { playerGroups } = runLanding([
    M('C. Alcaraz', 2382, 3, 'J. Munar', 1, 64, 'ATP Tokyo', 'ATP 500'),
    M('X. One', 5, 100, 'Y. Two', 6, 101, 'ATP Somewhere', null),
    M('Z. Odd', 7, 102, 'W. Even', 8, null, 'ATP Elsewhere', 'Exhibition'),
  ], {});
  const metas = [...playerGroups.innerHTML.matchAll(/class="pgroup-meta">([^<]*)</g)].map(x => x[1]);
  assert.deepEqual(metas, ['Hard · 500 · 2 players', 'Hard · 2 players', 'Hard · 2 players']);
});

test('player card: rank, two initials, a lifted odds tile that is not a link, View profile a link only with a profile', () => {
  const { playerGroups: g } = runLanding([M('Carlos Alcaraz', 2382, 3, 'Alex de Minaur', 1106, null, 'ATP Tokyo', 'ATP 500')],
    { 2382: { name: 'Carlos Alcaraz', rank: 3 } });
  const cards = g.innerHTML.split('class="playercard"').slice(1);
  assert.equal(cards.length, 2);
  assert.match(cards[0], /class="pc-avatar-init">CA</);
  assert.match(cards[1], /class="pc-avatar-init">AM</, 'surname initial is the LAST token ("de Minaur" → M)');
  assert.match(cards[0], /class="pc-rank">#3</);
  assert.match(cards[1], /class="pc-rank">—</, 'no rank on the row or the profile → "—", never a guess');
  assert.match(cards[0], /<span class="pc-odds"[^>]*>\s*<span class="pc-price">1\.11<\/span><span class="pc-book">Pncl<\/span><span class="pc-ext">/);
  assert.ok(!/<a\b|href=/.test(g.innerHTML), 'the odds tile is not a link: we hold no per-book URL');
  assert.ok(!/Best odds to win<\/span>/.test(g.innerHTML), 'no label text above the tile');
  assert.match(cards[0], /class="pc-view" role="link">View profile →/);
  assert.match(cards[1], /class="pc-view">View profile →/, 'no profile → no link role');
  assert.match(cards[0], /data-clickable="1" onclick="showPlayerProfile\('2382'\)"/);
});

test('card surfaces: no outline, no hover lift, avatar + odds tile --selected (ruling Q3), View profile --link', () => {
  assert.match(cssRule('.playercard'), /background:var\(--card\); border:1px solid transparent; box-shadow:var\(--top-light\)/);
  assert.ok(!/\.playercard[^{]*:hover\{/.test(html), 'no hover rule on the player card (no lift, no edge)');
  assert.ok(!/translateY\(-2px\)/.test(cssRule('.playercard[data-clickable="1"]') || ''));
  assert.match(cssRule('.playercard .pc-odds'), /border:1px solid var\(--line\); border-radius:9px; background:var\(--selected\)/);
  assert.match(cssRule('.playercard .pc-avatar-init'), /background:var\(--selected\); border:1px solid var\(--line\)/);
  assert.match(cssRule('.playercard .pc-view'), /color:var\(--link\)/);
  assert.match(cssRule('.playercard .pc-arch-dot'), /background:var\(--text\)/);
  assert.ok(!/border-bottom:1px dotted/.test(cssRule('.playercard .pc-elo-lab')), 'ELO has no dotted underline');
});

test('item 8: the legacy renderer carries no Market performance, Favourite vs underdog reliability or Read on the market', () => {
  const src = slice('buildPlayerProfileHtml');
  for (const re of [/Market performance</, /Favourite vs underdog reliability</, /Read on the market</, /ppMarketPanel/, /\$\{oddsHtml\}/])
    assert.ok(!re.test(src), `legacy profile still renders ${re}`);
  for (const fn of ['setPpMktPeriod', 'setPpMktSurface', 'setPpMktSide', 'setPpMktRole', 'setPpMktWindow', 'ppMktSliderInput', 'ppMktBaseCount', 'surname0'])
    assert.ok(!html.includes(`function ${fn}(`), `${fn} only served the removed panel`);
  // Kept intent: Key insights' market card reads the odds shard, so the legacy renderer must still request it.
  assert.match(src, /if \(oddsPerfIndex\[String\(p\.key\)\] && _oddsPerfShards\[String\(p\.key\)\] === undefined\) loadOddsPerfShardThenRerender\(p\.key\);/);
  assert.match(src, /_oddsPerfShards\[String\(p\.key\)\] \|\| null,/, 'ppDynamicInsights still gets the shard');
});

test('ruling Q9: whole draw per event, losers kept, ordered by rank, header = whole draw + events', () => {
  const done = { finalScore: '6-3 6-4', bestOdds: { p1: { price: 1.5, bookmaker: 'Pncl' }, p2: { price: 2.6, bookmaker: 'Pncl' } } };
  const rows = [
    M('C. Alcaraz', 2382, 3, 'T. Fritz', 50, 5, 'ATP Tokyo', 'ATP 500'),                // pending
    M('T. Fritz', 50, 5, 'L. Darderi', 51, 30, 'ATP Tokyo', 'ATP 500', done),         // finished: Darderi lost today
    M('N. Djokovic', 9, 4, 'A. Zverev', 10, 2, 'ATP Beijing', 'ATP 500', { live: true }),
  ];
  const progression = { tournaments: {
    Tokyo: { players: [{ name: 'C. Ruud', playerKey: '430', eliminated: true }, { name: 'L. Darderi', playerKey: '51', eliminated: true }] },
    // brand-aliased: no bare-name match, joined by shared player keys
    'Some City': { players: [{ name: 'N. Borges', playerKey: '358', eliminated: true }, { name: 'N. Djokovic', playerKey: '9', eliminated: false }] },
    // not on this week's board: skipped
    Estoril: { players: [{ name: 'X. Old', playerKey: '999', eliminated: true }] },
  } };
  const profiles = { 430: { name: 'Casper Ruud', rank: 12 } };
  const { playerGroups: g, pgHeaderStats: h } = runLanding(rows, profiles, progression);
  const groups = g.innerHTML.split('class="pgroup"').slice(1).map(x => ({
    name: x.match(/pgroup-name">([^<]*)</)[1],
    meta: x.match(/pgroup-meta">([^<]*)</)[1],
    players: [...x.matchAll(/class="name">([^<]*)</g)].map(m => m[1]),
  }));
  assert.deepEqual(groups.map(x => x.name), ['ATP Tokyo', 'ATP Beijing']);
  assert.deepEqual(groups[0].players, ['C. Alcaraz', 'T. Fritz', 'Casper Ruud', 'L. Darderi'], 'losers stay; by rank, profile rank fills the progression-only player');
  assert.equal(groups[0].meta, 'Hard · 500 · 4 players');
  assert.deepEqual(groups[1].players, ['A. Zverev', 'N. Djokovic', 'N. Borges'], 'unranked last');
  assert.ok(!/X\. Old/.test(g.innerHTML), 'an event no longer on the board is not this week');
  const stats = [...h.innerHTML.matchAll(/pgh-stat-l">([^<]*)<\/span><span class="pgh-stat-v">([^<]*)</g)].map(x => x[1] + '=' + x[2]);
  assert.deepEqual(stats.slice(0, 2), ['Players=7', 'Tournaments=2']);
  // Best odds = the pending pre-match price only; finished, live and out players read "—" with no book and no arrow.
  const card = n => g.innerHTML.split('class="playercard"').find(c => c.includes(`class="name">${n}<`));
  assert.match(card('C. Alcaraz'), /pc-price">1\.11</);
  assert.match(card('T. Fritz'), /pc-price">6\.70</, 'Fritz still has the pending Alcaraz match priced');
  for (const n of ['L. Darderi', 'Casper Ruud', 'N. Djokovic', 'A. Zverev']) {
    assert.match(card(n), /pc-price">—<\/span><span class="pc-book">no price<\/span>\s*<\/span>/, `${n}: no pre-match price → "—" + note`);
    assert.ok(!/pc-ext/.test(card(n)), `${n}: no arrow`);
  }
});

test('rank "#N" reads live standings (player-index.json) before the frozen profile rank: no stale duplicates', () => {
  // Darderi / Paul both carried a frozen profile rank of 19 (TEN-384 review). Live standings: 21 / 17.
  const ms = [M('L. Darderi', 9001, null, 'T. Paul', 9002, null, 'ATP Tokyo', 'ATP 500')];
  const prof = { 9001: { name: 'L. Darderi', rank: 19 }, 9002: { name: 'T. Paul', rank: 19 } };
  const live = runLanding(ms, prof, { tournaments: {} }, [{ key: '9001', rank: 21 }, { key: '9002', rank: 17 }]).playerGroups.innerHTML;
  assert.match(live, /class="pc-rank">#21</);
  assert.match(live, /class="pc-rank">#17</);
  assert.ok(!/class="pc-rank">#19</.test(live), 'the frozen profile rank must not win over live standings');
  // Control: with no live standings loaded, the old fallback is all there is (and shows the duplicate).
  const stale = runLanding(ms, prof).playerGroups.innerHTML;
  assert.equal((stale.match(/class="pc-rank">#19</g) || []).length, 2);
});
