// Serves worktree HTML + the staged Career-record files, and proxies everything
// else to the live site — so the browser runs THIS code against real data.
// Per the house rule, the resolved roots are logged on boot: a server quietly
// rooted somewhere else returns 200s that look like a passing verify.
const http = require('http');
const fs = require('fs');
const path = require('path');

const WORKTREE = path.resolve(__dirname);
const STAGED = path.resolve(process.argv[2] || '/tmp/ten8-site');
const LIVE = 'https://michaeldk1996.github.io/SAAS/';
const PORT = Number(process.argv[3] || 8791);

const TYPES = { '.html': 'text/html', '.json': 'application/json', '.js': 'text/javascript', '.css': 'text/css' };

http.createServer(async (req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const send = (body, type) => { res.writeHead(200, { 'content-type': type, 'access-control-allow-origin': '*' }); res.end(body); };

  // 1. The page itself always comes from the worktree — that is what is under test.
  if (rel === 'index.html' || rel.endsWith('.html')) {
    const f = path.join(WORKTREE, rel === 'index.html' ? 'bsp-consult-dashboard.html' : rel);
    if (fs.existsSync(f)) return send(fs.readFileSync(f), 'text/html');
  }
  // 2. Staged Career-record data (shards, index, patched profiles) — these do
  //    not exist live yet, which is the point of the change.
  const st = path.join(STAGED, rel);
  if (st.startsWith(STAGED) && fs.existsSync(st) && fs.statSync(st).isFile()) {
    return send(fs.readFileSync(st), TYPES[path.extname(st)] || 'application/octet-stream');
  }
  // 3. Everything else: live.
  try {
    const up = await fetch(LIVE + rel);
    const buf = Buffer.from(await up.arrayBuffer());
    res.writeHead(up.status, { 'content-type': up.headers.get('content-type') || 'application/octet-stream', 'access-control-allow-origin': '*' });
    res.end(buf);
  } catch (e) { res.writeHead(502).end(String(e.message)); }
}).listen(PORT, () => {
  console.log(`verify server on :${PORT}`);
  console.log(`  html    <- ${WORKTREE}`);
  console.log(`  staged  <- ${STAGED}  (${fs.existsSync(STAGED) ? fs.readdirSync(STAGED).join(', ') : 'MISSING'})`);
  console.log(`  rest    -> ${LIVE}`);
});
