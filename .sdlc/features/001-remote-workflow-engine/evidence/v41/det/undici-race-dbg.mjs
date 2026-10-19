// Deterministic #168 repro of the Node-bundled undici race: an abort that lands AFTER undici has
// received the complete HTTP response (onComplete) but BEFORE the gunzip'd bytes reach the
// reader leaves `reader.read()` pending forever. Mode 'spin' blocks the event loop for 400ms at
// onComplete (what claude-agent-sdk's sync process.report.getReport() does in the engine) so the
// 200ms attempt timer fires before the threadpool gunzip result is delivered.
import http from 'node:http';
import zlib from 'node:zlib';
import dc from 'node:diagnostics_channel';
const mode = process.argv[2] ?? 'spin';           // spin | none
const gzip = process.argv[3] !== 'plain';
const body = Buffer.from(JSON.stringify({ answers: { q: { type: 'noul', noul: 0.5 } } }));
const srv = http.createServer((req, res) => { req.resume();
  setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json', ...(gzip ? { 'content-encoding': 'gzip' } : {}) }); res.end(gzip ? zlib.gzipSync(body) : body); }, 50); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
let armed = true;
dc.subscribe('undici:request:trailers', () => { console.log('T trailers', Date.now()-T0); if (mode === 'spin' && armed) { armed = false; const t = Date.now(); while (Date.now() - t < 400) {} } });
const T0=Date.now(); const tCtl = new AbortController(); setTimeout(() => { console.log('T abort', Date.now()-T0); tCtl.abort(); }, 200);       // attemptSignal(200)
const signal = AbortSignal.any([tCtl.signal, new AbortController().signal]);   // + runSignal
const res = await fetch(`http://127.0.0.1:${srv.address().port}/`, { method: 'POST', body: '{}', signal });
console.log('T fetch resolved', Date.now()-T0); const rd = res.body.getReader();
const read = (async () => { let n = 0; for (;;) { const { done, value } = await rd.read(); if (done) return 'eof ' + n + 'B'; n += value.byteLength; } })();
const out = await Promise.race([read.then((x) => x, (e) => 'rejected ' + e.name + ' ' + e.stack), new Promise((r) => setTimeout(() => r('HUNG >3s (signal.aborted=' + signal.aborted + ')'), 3000))]);
console.log(`node ${process.version} mode=${mode} gzip=${gzip}: ${out}`);
srv.closeAllConnections(); srv.close(); process.exit(0);
