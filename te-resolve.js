// te-resolve.js — resolves a Tennis Explorer empty-score row against Sackmann (founder ruling 2026-10-22).
//
// TE marks a walkover only by an EMPTY score (te-build-history.mjs `wo: score === ''`), and an empty score is not a
// walkover: Ultimate Tennis Showdown quarters, and Gasquet d. Verdasco (Buenos Aires 2004, a played match TE lists with
// no score) read the same way. So the career record never takes TE's `wo` on its own: te-join.js keeps our own explicit
// rows (api-tennis 'Walk Over', TML 'W/O') where TE pairs with them, and asks this resolver about every TE-only empty
// score row. The source is the store's pinned Sackmann copy (`sackmann/`: main draw, qual_chall, futures, 2010–2024;
// JeffSackmann/tennis_atp has been 404 since 19 Oct 2026), checked file by file against its SHA256SUMS before use —
// the same rule tools/te-set-repairs-refresh.mjs applies.
//
// A row resolves to:
//   'walkover'   — Sackmann's score for this match reads W/O;
//   'played'     — Sackmann has a score, and its winner is TE's winner (the row counts, with Sackmann's sets);
//   null         — no Sackmann row, or one whose winner disagrees with TE: unconfirmed (listed with score –, counted
//                  nowhere). Never guessed.
// Matching: the player by his full name ("Griekspoor, Tallon" -> "tallongriekspoor"), the opponent by TE's surname as a
// suffix of Sackmann's full name, and the event by date: Sackmann dates every match at its EVENT START, so of the
// meetings starting between 21 days before and 3 days after TE's date only the event that started latest is this
// match (otherwise Sinner v Musetti, Barcelona 2023, also met their Monte Carlo meeting 11 days earlier).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const norm = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const teSurname = (n) => { const t = String(n || '').split(/\s+/); if (t.length > 1 && /\.$/.test(t[t.length - 1])) t.pop(); return norm(t.join(' ')); };
const fullName = (teName) => norm(String(teName || '').split(',').map((x) => x.trim()).reverse().join(' '));
const dayMs = (s) => Date.parse(String(s || '').replace(/^(\d{4})(\d\d)(\d\d)$/, '$1-$2-$3').slice(0, 10) + 'T00:00:00Z');
const MATCH_FILE = /^atp_matches_(?:(?:qual_chall|futures)_)?\d{4}\.csv$/;
const WO = /W\/O|WALKOVER/i;

// Every listed file present and matching; at least one match CSV. Throws (the run stops) otherwise.
function verifySums(dir) {
  const sums = path.join(dir, 'SHA256SUMS');
  if (!fs.existsSync(sums)) throw new Error(`te-resolve: ${sums} missing — refusing to resolve against an unverified Sackmann copy`);
  const listed = [];
  for (const l of fs.readFileSync(sums, 'utf8').split('\n').filter((x) => x.trim())) {
    const m = /^([0-9a-f]{64}) [ *]?(\S+)$/.exec(l.trim());
    if (!m) throw new Error(`te-resolve: SHA256SUMS line "${l}" unreadable`);
    const p = path.join(dir, m[2]);
    if (!fs.existsSync(p)) throw new Error(`te-resolve: Sackmann ${m[2]} listed in SHA256SUMS but missing`);
    const got = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    if (got !== m[1]) throw new Error(`te-resolve: Sackmann ${m[2]} does not match SHA256SUMS`);
    listed.push(m[2]);
  }
  const csvs = listed.filter((f) => MATCH_FILE.test(f));
  if (!csvs.length) throw new Error('te-resolve: SHA256SUMS lists no Sackmann match CSV');
  return csvs;
}

// Map(normalized full name -> [{ start, w, l, score }]) over every verified match CSV in `dir`.
function loadSackmann(dir) {
  const byName = new Map();
  const add = (n, row) => { const a = byName.get(n); if (a) a.push(row); else byName.set(n, [row]); };
  let rows = 0;
  for (const f of verifySums(dir)) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split('\n');
    const h = lines[0].split(','); const I = (k) => h.indexOf(k);
    const [cd, cw, cl, cs] = [I('tourney_date'), I('winner_name'), I('loser_name'), I('score')];
    if ([cd, cw, cl, cs].some((i) => i < 0)) throw new Error(`te-resolve: ${f} lacks a required column`);
    for (const line of lines.slice(1)) {
      if (!line) continue;
      const c = line.split(',');
      const row = { start: dayMs(c[cd]), w: norm(c[cw]), l: norm(c[cl]), score: c[cs] || '' };
      if (!Number.isFinite(row.start)) continue;
      add(row.w, row); add(row.l, row); rows++;
    }
  }
  return { byName, rows };
}

// Sackmann "6-4 3-6 7-6(5)" -> [{w, l}] from the WINNER's side; RET/DEF/W/O tokens dropped.
function setsOfSackmann(score) {
  return String(score || '').split(/\s+/).map((x) => /^(\d+)-(\d+)(?:\(\d+\))?$/.exec(x)).filter(Boolean).map((m) => ({ w: +m[1], l: +m[2] }));
}

// resolver(teRec)(t) -> { verdict: 'walkover' | 'played' | null, sets? } for one TE row of that player.
function makeResolver(index) {
  return function forPlayer(teRec) {
    const me = fullName(teRec && teRec.name);
    const mine = (index && me && index.byName.get(me)) || [];
    return function resolve(t) {
      const opp = teSurname(t.opp);
      const d = dayMs(t.date);
      if (!opp || !Number.isFinite(d) || !mine.length) return { verdict: null };
      const cands = mine.filter((s) => (s.w === me ? s.l : s.w).endsWith(opp) && d - s.start >= -3 * 864e5 && d - s.start <= 21 * 864e5);
      if (!cands.length) return { verdict: null };
      const latest = cands.reduce((m, s) => Math.max(m, s.start), -Infinity);
      const hits = cands.filter((s) => s.start === latest);
      const verdicts = new Set(hits.map((s) => (WO.test(s.score) ? 'walkover' : /\d/.test(s.score) ? 'played' : 'none')));
      verdicts.delete('none');
      if (verdicts.size !== 1) return { verdict: null };
      const v = [...verdicts][0];
      const hit = hits.find((s) => (v === 'walkover' ? WO.test(s.score) : /\d/.test(s.score)));
      // the winner must agree with TE's, or the two sources disagree about the match: unconfirmed
      if ((hit.w === me) !== !!t.won) return { verdict: null };
      return v === 'played' ? { verdict: 'played', sets: setsOfSackmann(hit.score) } : { verdict: 'walkover' };
    };
  };
}

module.exports = { loadSackmann, makeResolver, setsOfSackmann, verifySums };
