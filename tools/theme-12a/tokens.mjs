// TEN-285 — theme 12a "Ink solid" token set. Every value is HANDOFF.md §1
// (or §3 where §1 is silent: nav states, avatar fill), verbatim.
export const TOKENS = {
  // Surfaces
  'page': '#0B0C13',
  'nav-panel': '#0D0F18',
  'surface': '#0E1019',
  'surface-inner': '#0C0E16',
  'input': 'transparent',
  'popup': '#131623',
  'backdrop': 'rgba(11,12,19,0.76)',
  // Lines (0.33px)
  'line': 'rgba(255,255,255,0.045)',
  'line-soft': 'rgba(255,255,255,0.03)',
  'line-panel': 'rgba(255,255,255,0.035)',
  'line-open': 'rgba(255,255,255,0.10)',
  'line-avatar': 'rgba(255,255,255,0.06)',
  // Text
  'text': '#EBF1F2',
  'text-soft': '#D9DBDF',
  'text-sub': '#A3ABBA',
  'label': '#6E7A93',
  'nav-idle': '#9BB0DA',
  'nav-icon-idle': '#7F93BD',
  // Brand and accent
  'blue-ring': '#007AFF',
  'periwinkle': '#6A9AF8',
  'navy': '#07183D',
  'royal': '#0B2878',
  'lime': '#EAF928',
  'bar-track': '#16234A',
  'bar-dog': '#2A3556',
  'seg-active': '#0B1C4E',
  'seg-active-line': '#2E4FA8',
  // Functional
  'hard': '#6A9AF8',
  'clay': '#F2B45F',
  'grass': '#45D6B0',
  'positive': '#3ED68C',
  'negative': '#DA6259',
  // §3 nav item + player-row values (spec-stated, no §1 name)
  'nav-hover': 'rgba(106,154,248,0.08)',
  'nav-active': 'rgba(0,122,255,0.16)',
  'nav-active-line': 'rgba(106,154,248,0.18)',
  'avatar': '#0B0C14',
  // design-file computed values with no HANDOFF name (promo icon tile, Portal 12a — TEN-286)
  'promo-tile': '#172137',
  'promo-glyph': '#5B9CFF',
};

export function rootBlock() {
  const lines = Object.entries(TOKENS).map(([k, v]) => `    --${k}:${v};`);
  return `  /* TEN-285 theme 12a "Ink solid" — HANDOFF.md §1 tokens, verbatim. Every colour
     on the page resolves to one of these (or to the founder-reviewed unmapped list). */
  :root{\n${lines.join('\n')}\n  }\n`;
}
