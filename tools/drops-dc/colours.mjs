// Every colour the locked design file uses -> a tokens.css token. Existing --do2-* where the value is equal;
// --do3-* added for the rest (values read off the design file, final 2026-11-27).
export const NEW_TOKENS = {
  '--do3-page': '#090B12',
  '--do3-bar': '#0A0D13',
  '--do3-chip-strong': '#2C3349',
  '--do3-indigo': '#3A5BD0',
  '--do3-green': '#3DD68C',
  '--do3-sky': '#4DB8FF',
  '--do3-icon': '#7A8494',
  '--do3-amber': '#E8A84E',
  '--do3-white': '#FFFFFF',
  '--do3-edge-4': 'rgba(255, 255, 255, 0.04)',
  '--do3-edge-5': 'rgba(255, 255, 255, 0.05)',
  '--do3-edge-16': 'rgba(255, 255, 255, 0.16)',
  '--do3-shadow-a50': 'rgba(0, 0, 0, 0.5)',
  '--do3-shadow-a55': 'rgba(0, 0, 0, 0.55)',
  '--do3-glow-0': 'rgba(52, 70, 170, 0)',
  '--do3-glow-30': 'rgba(52, 70, 170, 0.30)',
  '--do3-steel-85': 'rgba(87, 133, 173, 0.85)',
  '--do3-blue-10': 'rgba(91, 155, 255, 0.10)',
  '--do3-blue-13': 'rgba(91, 155, 255, 0.13)',
  '--do3-blue-34': 'rgba(91, 155, 255, 0.34)',
  '--do3-blue-40': 'rgba(91, 155, 255, 0.40)',
  '--do3-blue-55': 'rgba(91, 155, 255, 0.55)',
  '--do3-blue-70': 'rgba(91, 155, 255, 0.70)',
};
const OLD = {
  '#0e1019': 'do2-card', '#0c0e16': 'do2-inner', '#121521': 'do2-lift', '#0a0c13': 'do2-track', '#171b28': 'do2-hover',
  '#e7e9ee': 'do2-text', '#c6ccdb': 'do2-text2', '#8b96b5': 'do2-grey', '#5b6880': 'do2-dim', '#4b5672': 'do2-dim2',
  '#e06266': 'do2-red', '#e0616f': 'do2-meter', '#5b9bff': 'do2-blue', '#82b4ff': 'do2-blue-ink', '#0a0d14': 'do2-m-fill',
  'rgba(255,255,255,0.06)': 'do2-hair', 'rgba(255,255,255,0.08)': 'do2-edge-8', 'rgba(255,255,255,0.1)': 'do2-edge-10',
  'rgba(255,255,255,0.14)': 'do2-edge-14', 'rgba(255,255,255,0.22)': 'do2-edge-22', 'rgba(255,255,255,0.4)': 'do2-edge-40',
  'rgba(255,255,255,0.07)': 'do2-edge-7', 'rgba(255,255,255,0.09)': 'do2-edge-9', 'rgba(255,255,255,0.12)': 'do2-edge-12',
  'rgba(255,255,255,0.045)': 'do2-sk-45', 'rgba(224,97,111,0.16)': 'do2-meter-trk', 'rgba(224,97,111,0.7)': 'do2-strike',
  'rgba(224,97,111,0.35)': 'do2-red-35', 'rgba(224,97,111,0.14)': 'do2-meter-trk-14', 'rgba(3,4,7,0.62)': 'do2-scrim',
  'rgba(3,4,7,0.66)': 'do2-scrim-66', 'rgba(91,155,255,0.16)': 'do2-blue-16', 'rgba(91,155,255,0.3)': 'do2-blue-30',
  'rgba(91,155,255,0.35)': 'do2-blue-35',
};
const norm = (c) => {
  c = c.toLowerCase().replace(/\s+/g, '');
  if (/^#[0-9a-f]{3}$/.test(c)) c = '#' + c.slice(1).split('').map((x) => x + x).join('');
  const m = /^rgba?\(([\d.]+),([\d.]+),([\d.]+)(?:,([\d.]+))?\)$/.exec(c);
  if (m) return `rgba(${+m[1]},${+m[2]},${+m[3]},${m[4] == null ? 1 : +m[4]})`;
  return c;
};
export const COLOURS = {};
for (const [k, v] of Object.entries(OLD)) COLOURS[norm(k)] = `var(--${v})`;
for (const [k, v] of Object.entries(NEW_TOKENS)) COLOURS[norm(v)] = `var(${k})`;
export function mapColours(s) {
  return s.replace(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b|rgba?\([^)]*\)/g, (c) => {
    const t = COLOURS[norm(c)];
    if (!t) throw new Error('unmapped colour ' + c);
    return t;
  });
}
