// Minimal static file server for local preview (no dependencies).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 5500;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json',
  '.css': 'text/css', '.csv': 'text/csv', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};

http.createServer((req, res) => {
  let filePath = decodeURIComponent(req.url.split('?')[0]);
  if (filePath === '/') filePath = '/bsp-consult-dashboard.html';
  const full = path.join(ROOT, filePath);
  if (!full.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  // LIVE_DATA=https://app.stennisfy.com : data (.json) and files missing here come from the live app (the pipeline builds them, not this checkout).
  const LIVE = process.env.LIVE_DATA;
  fs.readFile(full, async (err, data) => {
    if (LIVE && (err || filePath.endsWith('.json'))) {
      try {
        const r = await fetch(LIVE + req.url);
        if (r.ok) { res.writeHead(200, { 'Content-Type': r.headers.get('content-type') || 'application/octet-stream' }); res.end(Buffer.from(await r.arrayBuffer())); return; }
      } catch (e) { /* offline: fall back to the local file */ }
    }
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    // PREVIEW_INJECT=<file> : design-preview markup appended to the dashboard for this local server only.
    if (process.env.PREVIEW_INJECT && filePath === '/bsp-consult-dashboard.html') data = data.toString().replace('</body>', fs.readFileSync(path.join(ROOT, process.env.PREVIEW_INJECT), 'utf8') + '</body>');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`Serving ${ROOT} on http://localhost:${PORT}`));
