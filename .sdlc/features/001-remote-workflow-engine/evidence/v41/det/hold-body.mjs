// Deterministic #168 repro: server sends 200 headers, then never sends the body.
import http from 'node:http';
const GC = process.argv.includes('--gc');
const ANY = !process.argv.includes('--plain');
const srv = http.createServer((req, res) => { req.resume(); res.writeHead(200, { 'content-type': 'application/json' }); res.flushHeaders(); /* body never sent */ });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.address().port}/`;
async function readAll(res) { const rd = res.body.getReader(); for (;;) { const { done } = await rd.read(); if (done) return 'eof'; } }
async function one() {
  const t = new AbortController(); setTimeout(() => t.abort(), 300);
  const run = new AbortController();
  const signal = ANY ? AbortSignal.any([t.signal, run.signal]) : t.signal;
  const res = await fetch(url, { method: 'POST', body: '{}', signal });
  if (GC) { await new Promise((r) => setImmediate(r)); globalThis.gc(); globalThis.gc(); }
  return Promise.race([readAll(res).then(() => 'eof', (e) => 'rejected:' + e.name), new Promise((r) => setTimeout(() => r('HUNG(>3s)'), 3000))]);
}
const out = await Promise.all(Array.from({ length: 5 }, one));
console.log(`node ${process.version} any=${ANY} gc=${GC}:`, out.join(' '));
srv.closeAllConnections(); srv.close();
