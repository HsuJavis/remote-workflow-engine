// REQ-127: does a USD ceiling actually stop the next dispatch once a PRICED call has spent?
import { writeFileSync } from 'node:fs';
const [, , PORT, OUT] = process.argv;
const ENGINE = `http://127.0.0.1:${PORT}/mcp`;
async function call(name, args) {
  const res = await fetch(ENGINE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }) });
  const j = await res.json(); const t = j.result?.content?.[0]?.text;
  try { return JSON.parse(t); } catch { return j; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(runId) {
  for (let i = 0; i < 90; i++) {
    const s = await call('run_status', { runId });
    const v = s.result ?? s;
    if (['completed', 'failed', 'stopped'].includes(v.status)) return v;
    await sleep(2000);
  }
  return (await call('run_status', { runId })).result;
}
const SCRIPT = `export const meta = {
  description: 'Gate 7.5 round 3: two PRICED calls under a USD ceiling.',
  params: { agents: {
    first:  { model: { type: 'string', default: 'haiku' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 300000 } },
    second: { model: { type: 'string', default: 'haiku' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 300000 } },
  } },
};
phase('one');
const a = await agent('first', { prompt: 'Reply with exactly: ONE_OK', allowedTools: [] });
phase('two');
const b = await agent('second', { prompt: 'Reply with exactly: TWO_OK', allowedTools: [] });
return a + '|' + b;`;
const MERMAID = `graph LR
subgraph "one"
first(["first<br/>haiku · low · 300000<br/>tools: none"])
end
subgraph "two"
second(["second<br/>haiku · low · 300000<br/>tools: none"])
end
first-->second`;
const R = {};
R.register = await call('workflow_register', { name: 'val127usd', script: SCRIPT, mermaid: MERMAID });
R.publish = await call('workflow_publish', { name: 'val127usd', channel: 'release', version: R.register.result?.version ?? 'v1' });
const s1 = await call('run_start', { name: 'val127usd', channel: 'release', budget: { usd: 0.000001 } });
R.capped = { start: s1, status: await poll(s1.runId), result: await call('run_result', { runId: s1.runId }) };
const s2 = await call('run_start', { name: 'val127usd', channel: 'release', budget: { usd: 10 } });
R.roomy = { start: s2, status: await poll(s2.runId), result: await call('run_result', { runId: s2.runId }) };
writeFileSync(OUT, JSON.stringify(R, null, 1));
console.log('capped', s1.runId, R.capped.status?.status, '| roomy', s2.runId, R.roomy.status?.status);
