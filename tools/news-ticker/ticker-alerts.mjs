#!/usr/bin/env node
// News ticker — alert: a day with finished ATP matches and 0 reports written (Telegram, pipeline chat). Runs after the
// feed build in every pipeline run, also when that build crashed. One message per day; state in
// news-ticker/alert-state.json. Never fails the run.
//
// Usage: node tools/news-ticker/ticker-alerts.mjs [--dir .] [--now ISO] [--test]   (--test sends one marked test message)
import fs from 'node:fs';
import path from 'node:path';
import { sendTelegram } from '../price-alert-send.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ek = (m) => String(m.id).split('-').slice(1).join('-');

// -> [{ date, finished, reports }] for every board date up to today with finished ATP singles matches and no report
export function daysWithoutReports(board, reportKeys, todayIso) {
  const by = new Map();
  for (const m of Object.values(board || {})) {
    if (!m || m.tourBadge !== 'ATP' || !m.finalScore || !m.finalScore.winner || m.walkover || /\//.test(String(m.p1) + String(m.p2))) continue;
    if (!m.date || m.date > todayIso) continue;
    const d = by.get(m.date) || { date: m.date, finished: 0, reports: 0 };
    d.finished++; if (reportKeys.has(ek(m))) d.reports++;
    by.set(m.date, d);
  }
  return [...by.values()].filter((d) => d.finished > 0 && d.reports === 0).sort((a, b) => a.date.localeCompare(b.date));
}

export function reportKeysIn(dir) {
  const keys = new Set(), d = path.join(dir, 'news-ticker');
  if (fs.existsSync(d)) for (const f of fs.readdirSync(d).filter((x) => /-\d{4}\.json$/.test(x))) {
    try { for (const x of JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')).items || []) if (x.type === 'report' && x.eventKey) keys.add(String(x.eventKey)); } catch (e) { /* an unreadable file holds no report */ }
  }
  return keys;
}

async function main() {
  const DIR = path.resolve(arg('dir', '.')), nowIso = arg('now', new Date().toISOString());
  if (process.argv.includes('--test')) { const r = await sendTelegram('TEST — News ticker alert 1 of 3: a day with finished ATP matches and 0 reports written. (Triggered by hand; nothing is wrong.)'); console.log('test alert: ' + (r.ok ? 'sent' : 'NOT sent ' + r.why)); return; }
  let board; try { board = JSON.parse(fs.readFileSync(path.join(DIR, 'matches.json'), 'utf8')); } catch (e) { console.log('ticker alerts: no board to check'); return; }
  const sf = path.join(DIR, 'news-ticker', 'alert-state.json');
  let state = {}; try { state = JSON.parse(fs.readFileSync(sf, 'utf8')); } catch (e) { /* first run */ }
  const sent = new Set(state.noReportsAlerted || []);
  const due = daysWithoutReports(board, reportKeysIn(DIR), nowIso.slice(0, 10)).filter((d) => !sent.has(d.date));
  if (!due.length) { console.log('ticker alerts: every day with finished matches has reports'); return; }
  const text = 'News ticker: ' + due.map((d) => `${d.date} has ${d.finished} finished ATP match${d.finished === 1 ? '' : 'es'} and 0 reports written`).join('; ') + '.';
  const r = await sendTelegram(text);
  console.log(`alert: ${r.ok ? 'sent' : 'NOT sent (' + r.why + ')'} — ${text}`);
  if (!r.ok) { console.log('::error title=News ticker alert not sent::' + text); return; }   // unsent: try again next run
  state.noReportsAlerted = [...sent, ...due.map((d) => d.date)].slice(-60);
  fs.mkdirSync(path.dirname(sf), { recursive: true }); fs.writeFileSync(sf + '.tmp', JSON.stringify(state, null, 1) + '\n'); fs.renameSync(sf + '.tmp', sf);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.log('::error::ticker alerts: ' + (e && e.message)); });
