// Founder 2026-10-14 (Pinnacle archive item 6): the Record per tournament join's name test (trSameEvent, the shipped page's
// own function) meets one event's names through tournament-identity.js — Canada Masters = Montreal / Toronto, Queen's
// Club = London — and still keeps different events apart. The pre-fix function is the control.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bsp-consult-dashboard.html'), 'utf8');
const i = html.indexOf('function trSameEvent('); let d = 0, j = html.indexOf('{', i);
for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}' && --d === 0) break; }
const window = { TournamentIdentity: require(path.join(ROOT, 'tournament-identity.js')) };
const trSameEvent = new Function('window', html.slice(i, j + 1) + '\nreturn trSameEvent;')(window);
const old = (t, names) => { const a = String(t || '').toLowerCase(); if (!a) return true; return names.some(n => { const b = String(n || '').toLowerCase(); return !!b && (a.includes(b) || b.includes(a)); }); };
let pass = 0, fail = 0;
const check = (n, ok, det) => { if (ok) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (det ? ' ' + det : '')); } };
const cases = [
  ['Montreal', ['Canada Masters'], true], ['Toronto', ['Canada Masters'], true], ['ATP Toronto', ['Canada Masters'], true],
  ['London', ["Queen's Club"], true], ['ATP London', ["Queen's Club"], true],
  ['London Olympics', ["Queen's Club"], false], ['Montreal', ['Cincinnati'], false], ['Toronto', ['Shanghai'], false],
  ['Monte Carlo', ['Monte Carlo'], true], ['Rome', ['Rome'], true],
];
for (const [t, n, want] of cases) check(`${t} v ${n[0]} → ${want}`, trSameEvent(t, n) === want, String(trSameEvent(t, n)));
check('control: the pre-fix substring test missed Canada Masters v Montreal and Queen\'s Club v London', !old('Montreal', ['Canada Masters']) && !old('London', ["Queen's Club"]));
check('no identity table → the substring test alone (never throws)', new Function('window', html.slice(i, j + 1) + '\nreturn trSameEvent;')({})('Rome', ['Rome']) === true);
console.log(`\ntest-trsameevent-identity: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
