// =================================================================
// api-tennis per-pull READ COUNTER
// -----------------------------------------------------------------
// A thin wrapper around fetch() that tallies every api-tennis read a
// harvest run performs, so the founder can watch quota burn per run.
//
// api-tennis meters by request, and the pipeline is deliberate about
// minimising calls (one windowed get_fixtures returns a whole draw's
// fixtures WITH inline statistics, so a full tournament harvest costs
// one read, not one-per-match). This counter makes that cost visible:
// every call is logged with its method + a coarse target, and a
// summary is printed at the end of the run.
//
// It is intentionally dependency-free and side-effect-free beyond the
// in-memory tally + optional console log, so it can wrap any api-tennis
// fetch without changing behaviour.
// =================================================================

class ReadCounter {
  constructor({ label = 'api-tennis', log = true } = {}) {
    this.label = label;
    this.log = log;
    this.reads = 0;
    this.byMethod = new Map();   // method -> count
    this.calls = [];             // { n, method, target, ms, ok, rows }
  }

  // Extract the api-tennis `method=` and a coarse target (date window or
  // match_key) from a request URL, for readable per-call logging.
  static describe(url) {
    try {
      const u = new URL(url);
      const method = u.searchParams.get('method') || 'unknown';
      const start = u.searchParams.get('date_start');
      const stop = u.searchParams.get('date_stop');
      const matchKey = u.searchParams.get('match_key');
      const player = u.searchParams.get('player_key');
      const target = matchKey ? `match_key=${matchKey}`
        : player ? `player_key=${player}`
        : (start || stop) ? `${start || '?'}..${stop || '?'}`
        : '';
      return { method, target };
    } catch (_) {
      return { method: 'unknown', target: '' };
    }
  }

  // Wrap a single api-tennis GET. Returns the parsed JSON (or throws like
  // fetch would), incrementing the tally exactly once per attempted read.
  async get(url, { fetchImpl = fetch } = {}) {
    const { method, target } = ReadCounter.describe(url);
    this.reads += 1;
    this.byMethod.set(method, (this.byMethod.get(method) || 0) + 1);
    const started = typeof performance !== 'undefined' && performance.now ? performance.now() : null;
    let ok = false, rows = null, json = null;
    try {
      const res = await fetchImpl(url);
      json = await res.json();
      ok = res.ok;
      rows = Array.isArray(json && json.result) ? json.result.length : null;
      return json;
    } finally {
      const ms = started != null ? Math.round((performance.now() - started)) : null;
      this.calls.push({ n: this.reads, method, target, ms, ok, rows });
      if (this.log) {
        const parts = [`[${this.label} read #${this.reads}]`, method, target].filter(Boolean);
        if (rows != null) parts.push(`-> ${rows} rows`);
        if (ms != null) parts.push(`(${ms}ms)`);
        console.log(parts.join(' '));
      }
    }
  }

  summary() {
    const byMethod = Object.fromEntries([...this.byMethod.entries()]);
    return { label: this.label, totalReads: this.reads, byMethod, calls: this.calls };
  }

  printSummary() {
    const parts = [...this.byMethod.entries()].map(([m, n]) => `${m}=${n}`).join(', ');
    console.log(`\n[${this.label}] TOTAL READS THIS RUN: ${this.reads}${parts ? `  (${parts})` : ''}`);
  }
}

module.exports = { ReadCounter };
