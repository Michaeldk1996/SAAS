// ATP headshot probe — regenerates player-photo-manifest.json (founder rulings 2026-10-22).
//
// ATP answers 403 to command-line fetches, so this runs IN A BROWSER: open any https://www.atptour.com page, paste this
// file into the devtools console (or run it through a browser automation tool), and save the printed JSON over
// player-photo-manifest.json. Run it whenever player-atp-aliases.json changes; tools/test-player-photos.js fails until
// the manifest covers every mapped code.
//
// It reads, per ATP code: the headshot (/-/media/alias/player-headshot/<code>) -> bytes + sha1, and the player record
// (/en/-/www/players/hero/<code>) -> name, birth date, nationality. A read-only probe, 25 codes at a time; nothing is
// written anywhere but the console.
(async () => {
  const ALIASES_URL = 'https://michaeldk1996.github.io/SAAS/player-atp-aliases.json';
  const PLACEHOLDERS = [{ sha1_16: 'd027bd09f6529734', bytes: 4729, what: "ATP's grey silhouette (served with HTTP 200 for H346 and TA12)" }];
  const aliases = await (await fetch(ALIASES_URL, { cache: 'no-store' })).json();
  const codes = [...new Set(Object.values(aliases))].sort();
  const sha = async (b) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', b))).map((x) => x.toString(16).padStart(2, '0')).join('');
  const within = (p, ms) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error('timeout')), ms))]);
  const photos = {};
  for (let i = 0; i < codes.length; i += 25) {
    await Promise.all(codes.slice(i, i + 25).map(async (c) => {
      const r = await within(fetch('/-/media/alias/player-headshot/' + c, { cache: 'no-store' }), 15000);
      const b = await r.arrayBuffer();
      const h = await within(fetch('/en/-/www/players/hero/' + c + '?v=1').then((x) => x.json()), 15000);
      photos[c] = { status: r.status, bytes: b.byteLength, sha1_16: (await sha(b)).slice(0, 16),
        atpName: ((h.FirstName || '') + ' ' + (h.LastName || '')).trim(), atpBirth: (h.BirthDate || '').slice(0, 10), atpNat: h.NatlId || '' };
    }));
  }
  const sorted = {};
  Object.keys(photos).sort().forEach((k) => { sorted[k] = photos[k]; });
  const manifest = {
    _doc: 'Founder rulings 2026-10-22 (.claude/rules/player-photos.md). One entry per ATP code in player-atp-aliases.json: ' +
      'the headshot\'s bytes + sha1 (first 16 hex) and the ATP player record (hero endpoint) it belongs to. ' +
      'tools/test-player-photos.js rejects a mapped code whose file is a known placeholder or shares its bytes with another ' +
      'code, and a code whose ATP birth year disagrees with the api-tennis profile for that ID.',
    regenerate: 'ATP answers 403 to command-line fetches: run tools/atp-photo-probe.browser.js in a browser tab on ' +
      'https://www.atptour.com, then save its output over this file. Required whenever player-atp-aliases.json changes.',
    capturedAt: new Date().toISOString().slice(0, 10),
    placeholders: PLACEHOLDERS,
    photos: sorted,
  };
  console.log(JSON.stringify(manifest, null, 2));
  return manifest;
})();
