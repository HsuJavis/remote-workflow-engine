import http from 'node:http';
import zlib from 'node:zlib';
const full = zlib.gzipSync(Buffer.from(JSON.stringify({ answers: { q: { type: 'noul', noul: 0.5 } }, pad: 'x'.repeat(2000) })));
const MODES = {
  'plain-hold': (res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.flushHeaders(); },
  'gzip-hold': (res) => { res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }); res.flushHeaders(); },
  'gzip-partial-hold': (res) => { res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }); res.write(full.subarray(0, 20)); },
  'gzip-truncated-end': (res) => { res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }); res.end(full.subarray(0, 20)); },
  'gzip-empty-end': (res) => { res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }); res.end(); },
  'gzip-corrupt-end': (res) => { res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }); res.end(Buffer.from('this is not gzip at all')); },
  'gzip-badcrc-end': (res) => { const b = Buffer.from(full); b[b.length - 6] ^= 0xff; res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }); res.end(b); },
  'plain-hdr-then-reset': (res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.flushHeaders(); setTimeout(() => res.socket.destroy(), 50); },
  'gzip-hdr-then-reset': (res) => { res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }); res.flushHeaders(); setTimeout(() => res.socket.destroy(), 50); },
  'gzip-partial-then-reset': (res) => { res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }); res.write(full.subarray(0, 20)); setTimeout(() => res.socket.destroy(), 50); },
  'gzip-ok': (res) => { res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }); res.end(full); },
};
const mode = process.argv[2];
const srv = http.createServer((req, res) => { req.resume(); MODES[mode](res); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${srv.address().port}/`;
async function readAll(res) { const rd = res.body.getReader(); let n = 0; for (;;) { const { done, value } = await rd.read(); if (done) return 'eof(' + n + 'B)'; n += value.byteLength; } }
async function one() {
  const t = new AbortController(); setTimeout(() => t.abort(), 300);
  const signal = AbortSignal.any([t.signal, new AbortController().signal]);
  let res;
  try { res = await fetch(url, { method: 'POST', body: '{}', signal }); } catch (e) { return 'fetchRejected:' + e.name; }
  return Promise.race([readAll(res).catch((e) => 'readRejected:' + e.name + ':' + (e.cause?.code ?? e.message)), new Promise((r) => setTimeout(() => r('HUNG(>3s, signal.aborted=' + signal.aborted + ')'), 3000))]);
}
const out = await Promise.all(Array.from({ length: 3 }, one));
console.log(mode.padEnd(20), out.join(' | '));
srv.closeAllConnections(); srv.close(); process.exit(0);
