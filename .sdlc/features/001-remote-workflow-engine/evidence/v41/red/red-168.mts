// RED recipe for #168 (run against an UNMODIFIED src/direct-models/call.ts): runDecide must fail
// with reason 'timeout' within its bound even when the response body never settles and ignores abort.
import http from 'node:http';
import dc from 'node:diagnostics_channel';
import { runDecide, toPiAiModel, defaultDirectDeps } from '/tmp/claude-1000/-home-user-Documents-remote-workflow/6dddf984-3d1b-42de-a5f6-02410d991abd/scratchpad/i168/red/src-pristine/direct-models/call.ts';
const bound = (ms: number, p: Promise<unknown>) => Promise.race([p.then(() => 'resolved', (e) => 'rejected:' + String((e as Error).message)), new Promise((r) => setTimeout(() => r('HUNG past bound'), ms))]);
const model = toPiAiModel({ id: 'typesafe/jev-1.13', modelType: 'decision' }) as never;
const req = { model, state: { x: 1 }, questions: { q: { type: 'bool', instructions: 'i', criteria: { true: 'y', false: 'n' } } } as never, timeoutMs: 100, retries: 0, runSignal: new AbortController().signal, label: 'b' };
const base = { ...defaultDirectDeps({ resolve: () => 'k' } as never), resolveKey: () => 'k' };

// (A) unit-level: a 200 Response whose body never enqueues/closes and ignores the abort signal
//     — the exact live state captured in the hung engine (stream 'readable', 1 pending read).
const neverBody = async () => new Response(new ReadableStream({ type: 'bytes', pull() { /* never */ } }), { status: 200 });
console.log('(A) stub body never settles :', await bound(2000, runDecide(req, { ...base, fetch: neverBody as never })));

// (B) real Node-bundled undici: the attempt timer's abort lands right after undici's onComplete
//     (response fully received) but before the 200KB body reaches the reader.
const srv = http.createServer((q, res) => { q.resume(); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ answers: { q: { type: 'noul', noul: 0.5 } }, pad: 'x'.repeat(200000) })); });
await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
let fire: (() => void) | null = null;
dc.subscribe('undici:request:trailers', () => { const f = fire; fire = null; if (f) queueMicrotask(f); });
const attemptSignal = () => { const c = new AbortController(); let fired = false; fire = () => { fired = true; c.abort(); }; return { signal: c.signal, fired: () => fired }; };
const m2 = { ...model, baseUrl: 'http://127.0.0.1:' + (srv.address() as { port: number }).port } as never;
console.log('(B) real undici abort-after-complete:', await bound(2000, runDecide({ ...req, model: m2 }, { ...base, attemptSignal })));
srv.closeAllConnections(); srv.close(); process.exit(0);
