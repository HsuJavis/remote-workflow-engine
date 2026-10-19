import http from 'node:http';
import zlib from 'node:zlib';
import dc from 'node:diagnostics_channel';
const gzip = process.argv[2] !== 'plain';
const size = Number(process.argv[3] ?? 44);
const body = Buffer.from(JSON.stringify({ answers: { q: { type: 'noul', noul: 0.5 } }, pad: 'x'.repeat(Math.max(0, size - 44)) }));
const gz = zlib.gzipSync(body);
const srv = http.createServer((req, res) => { req.resume(); res.writeHead(200, { 'content-type': 'application/json', ...(gzip ? { 'content-encoding': 'gzip' } : {}) }); res.end(gzip ? gz : body); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
let onTrailers = null;
dc.subscribe('undici:request:trailers', () => { const f = onTrailers; onTrailers = null; f?.(); });
const tally = {};
for (const how of ['sync', 'microtask', 'nextTick', 'immediate', 'timeout0', 'timeout2', 'timeout5']) {
  for (let i = 0; i < 30; i++) {
    const t = new AbortController();
    const signal = AbortSignal.any([t.signal, new AbortController().signal]);
    onTrailers = () => { const a = () => t.abort(); ({ sync: a, microtask: () => queueMicrotask(a), nextTick: () => process.nextTick(a), immediate: () => setImmediate(a), timeout0: () => setTimeout(a, 0), timeout2: () => setTimeout(a, 2), timeout5: () => setTimeout(a, 5) })[how](); };
    let r;
    try {
      const res = await fetch(`http://127.0.0.1:${srv.address().port}/`, { method: 'POST', body: '{}', signal });
      const rd = res.body.getReader();
      r = await Promise.race([(async () => { for (;;) { const { done } = await rd.read(); if (done) return 'eof'; } })().catch(() => 'rejected'), new Promise((x) => setTimeout(() => x('HUNG'), 1000))]);
    } catch { r = 'fetchRejected'; }
    const k = how + ':' + r; tally[k] = (tally[k] ?? 0) + 1;
  }
}
console.log(`node ${process.version} gzip=${gzip} size=${size}`, JSON.stringify(tally));
srv.closeAllConnections(); srv.close(); process.exit(0);
