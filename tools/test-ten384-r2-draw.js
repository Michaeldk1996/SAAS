// tools/test-ten384-r2-draw.js — TEN-384 shard round 2 (founder, 8 Oct): the Draw record modal.
//
//   1 · W–L column  the Results tab's W–L cells never wrap: the cell is white-space:nowrap and its track holds 8
//                   Plex Mono 11.5 characters (a 4-digit career, "1044–199"); the panel's total width is unchanged.
//   2 · Footnote    Level and By round sum short of Format by the matches the builder counts but gives no row
//                   (Davis Cup / Tour Finals: no Level row; round-robin, bronze-medal: no By round row). It states the
//                   two gaps for the scope shown; both 0 → no clause.
//
// Pinned inputs only: the committed player-2840 profile fixture, with a career-splits scope built HERE from
// J. Thompson's (207) real rows (career-splits, 8 Oct 2026). The real renderSplitsModal is executed.
//
// Run: node tools/test-ten384-r2-draw.js
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const L = require('./ten384-figures-lib.js');

const H = L.harness();
const T = L.text;
console.log('TEN-384 shard r2 · Draw record');

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ten384-figures', 'player-2840.json'), 'utf8'));
const row = (W, L_) => ({ W, L: L_, M: W + L_ });
// J. Thompson (207): Format 74 + 259 = 333 · Level 70 + 56 + 197 = 323 · By round 4 + 8 + 27 + 62 + 106 + 57 + 59 = 323.
// The 10 left out are his Davis Cup rubbers (lv D, rd RR), 2017–2025; one of them (Bergs, Sep 2025) is in Last 52.
const THOMPSON = {
  matchesParsed: 333, last52Count: 27,
  career: {
    'Grand Slams': row(28, 42), Masters: row(24, 32), 'Other Tours': row(98, 99),
    'Best of 5': row(30, 44), 'Best of 3': row(125, 134),
    Finals: row(1, 3), 'Semi-finals': row(4, 4), 'Quarter-finals': row(8, 19),
    'Round of 16': row(27, 35), 'Round of 32': row(59, 47), 'Round of 64': row(22, 35), 'Round of 128': row(29, 30),
    'vs. Righties': row(124, 141), 'vs. Lefties': row(31, 37), 'vs. Top 10': row(7, 25)
  },
  last52: {
    'Grand Slams': row(5, 4), Masters: row(5, 6), 'Other Tours': row(1, 5),
    'Best of 5': row(5, 4), 'Best of 3': row(6, 12),
    'Round of 16': row(0, 2), 'Round of 32': row(2, 6), 'Round of 64': row(3, 4), 'Round of 128': row(6, 3),
    'vs. Righties': row(9, 11), 'vs. Lefties': row(2, 5), 'vs. Top 10': row(0, 3)
  }
};
// A complete partition: Level, Format and By round all sum to 40.
const NOGAP = {
  matchesParsed: 40, last52Count: 0,
  career: {
    'Grand Slams': row(5, 5), Masters: row(5, 5), 'Other Tours': row(10, 10),
    'Best of 5': row(5, 5), 'Best of 3': row(15, 15),
    Finals: row(2, 0), 'Semi-finals': row(2, 2), 'Quarter-finals': row(4, 4),
    'Round of 32': row(6, 8), 'Round of 64': row(6, 6),
    'vs. Righties': row(15, 15), 'vs. Lefties': row(5, 5)
  }
};
// Constructed: Level 3 short while By round is complete, to pin the single-clause wording.
const LEVELONLY = JSON.parse(JSON.stringify(NOGAP));
LEVELONLY.career['Other Tours'] = row(8, 9);

function modal(splits, scope, tab) {
  const p = Object.assign({}, FX.profile);
  const m = L.loadPp2({ players: { [FX.key]: p }, now: FX.asOf, extra: { careerSplits: { [FX.key]: splits } } });
  const I = m.I;
  const saved = Object.assign({}, I.state);
  Object.assign(I.state, { key: FX.key, modal: 'splits', splitScope: scope || 'career', splitTab: tab || 'results' });
  try { return I.renderSplitsModal(p); } finally { Object.keys(I.state).forEach(k => delete I.state[k]); Object.assign(I.state, saved); }
}
function note(html) {
  const m = /data-pp2-draw="note"[^>]*>([\s\S]*?)<\/div>/.exec(html);
  assert(m, 'no footnote');
  return T(m[1]).trim();
}

function main() {
  H.check('1 · the W–L cell is nowrap and its track holds 8 Plex Mono 11.5 characters; panel width unchanged', () => {
    const html = modal(THOMPSON);
    const grid = /grid-template-columns:([0-9px ]+);gap:0 8px/.exec(html);
    assert(grid, 'no Draw panel grid');
    const tr = grid[1].trim().split(/\s+/).map(x => parseFloat(x));
    assert.strictEqual(tr.length, 4, 'Results tab tracks ' + grid[1]);
    assert(tr[1] >= 8 * 0.6 * 11.5, 'W–L track ' + tr[1] + 'px < 8ch (55.2px)');
    assert.strictEqual(tr[0] + tr[1], 256, 'name + W–L = ' + (tr[0] + tr[1]) + ', was 208 + 48 = 256');
    const cell = /<span style="([^"]*)">124–141<\/span>/.exec(html);
    assert(cell, 'no 124–141 cell');
    assert(/white-space:nowrap/.test(cell[1]), 'the W–L cell can wrap: ' + cell[1]);
    return 'tracks ' + grid[1].trim() + ' · 124–141 cell nowrap';
  });

  H.check('2a · Thompson-shaped career: the footnote says Level and By round each leave out 10', () => {
    const t = note(modal(THOMPSON, 'career'));
    assert(t.includes('Level leaves out 10 matches, By round 10 (Level has no row for Davis Cup or Tour Finals; By round has none for round-robin or bronze-medal matches)'), t);
    return t.slice(t.indexOf('Level leaves'));
  });
  H.check('2b · the same clause on the Sets and Service tabs (same rows)', () => {
    ['sets', 'service'].forEach(tab => {
      const t = note(modal(THOMPSON, 'career', tab));
      assert(t.includes('Level leaves out 10 matches, By round 10'), tab + ': ' + t);
    });
  });
  H.check('2c · Thompson-shaped Last 52: the scope shown sets the counts (1 and 1, singular)', () => {
    const t = note(modal(THOMPSON, 'last52'));
    assert(t.includes('Level leaves out 1 match, By round 1 ('), t);
    return t.slice(t.indexOf('Level leaves'));
  });
  H.check('2d · a player whose Level and By round sum to Format: no clause', () => {
    const t = note(modal(NOGAP, 'career'));
    assert(!/leaves out|Davis Cup|round-robin/.test(t), t);
    return t;
  });
  H.check('2e · only Level short: one clause, no By round part', () => {
    const t = note(modal(LEVELONLY, 'career'));
    assert(t.includes('Level leaves out 3 matches ('), t);
    assert(!t.includes('By round'), t);
  });
  H.mustFail('2f · control: the 10-clause assertion fails on the no-gap player', () => {
    const t = note(modal(NOGAP, 'career'));
    assert(t.includes('Level leaves out 10 matches'), t);
  });
}

main();
H.done();
