// The point-by-point store's file format (founder 2026-11-01, Task D: "Invalid string length" — fix at the root, split or
// stream, no cap that drops data). point-by-point-cache.json held 71,035 logs on 1 Nov 2026; written as ONE JSON.stringify
// it passed V8's max string length (~512 MiB) and every run from 31 Oct 04:10Z failed both writers (build-point-by-point.js,
// backfill-history-shards.js), so nothing fetched after that was kept.
//
// Format 'ndjson-1': a header line, then one line per match — JSON [eventKey, entry] — written and read entry by entry, so no
// single string is ever larger than one match. The reader also takes the older single-object file (the tracked seed and the
// last good cache from before the change), so nothing held is lost on the switch. Writes are atomic (tmp + rename).
'use strict';
const fs = require('fs');

const HEADER = '{"pbpCacheFormat":"ndjson-1"}';
const CHUNK = 4 << 20;   // flush every ~4 MB

function writeCache(path, cache) {
  const tmp = `${path}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    let buf = HEADER + '\n';
    for (const ek of Object.keys(cache)) {
      buf += JSON.stringify([ek, cache[ek]]) + '\n';
      if (buf.length >= CHUNK) { fs.writeSync(fd, buf); buf = ''; }
    }
    if (buf) fs.writeSync(fd, buf);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, path);
}

// Returns the store as one object (eventKey -> entry). A missing file is an empty store; a file that cannot be read whole
// throws (never a silently empty store over a real one).
function readCache(path) {
  if (!fs.existsSync(path)) return {};
  const b = fs.readFileSync(path);                 // a Buffer: no string the size of the file is ever made
  const head = b.subarray(0, HEADER.length).toString('utf8');
  if (head !== HEADER) return JSON.parse(b.toString('utf8'));   // the older single-object file (always under the limit)
  const out = {};
  let at = b.indexOf(10) + 1, line = 1;
  while (at < b.length) {
    let nl = b.indexOf(10, at);
    if (nl < 0) nl = b.length;
    line++;
    if (nl > at) {
      let row;
      try { row = JSON.parse(b.toString('utf8', at, nl)); } catch (e) { throw new Error(`${path}: line ${line} is not valid JSON (${e.message})`); }
      if (!Array.isArray(row) || row.length !== 2) throw new Error(`${path}: line ${line} is not an [eventKey, entry] pair`);
      out[row[0]] = row[1];
    }
    at = nl + 1;
  }
  return out;
}

module.exports = { readCache, writeCache, HEADER };
