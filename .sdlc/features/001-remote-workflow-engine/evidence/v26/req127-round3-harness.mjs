// REQ-127 real-run re-validation (v26 Gate 7.5 round 3): four token columns on every path,
// per-model costUSD off the CORRECTED static price table (D3/D4), and a budget that binds.
// Usage: node req127-round3.mjs <port> <outJson>
import { writeFileSync } from 'node:fs';
const [, , PORT, OUT] = process.argv;
const ENGINE = `http://127.0.0.1:${PORT}/mcp`;
const R = { port: PORT, at: new Date().toISOString() };

async function call(name, args) {
  const res = await fetch(ENGINE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const j = await res.json();
  const t = j.result?.content?.[0]?.text;
  try { return JSON.parse(t); } catch { return j; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(runId, tries = 120) {
  for (let i = 0; i < tries; i++) {
    const s = await call('run_status', { runId });
    if (s.state && !['running', 'queued', 'pending'].includes(s.state)) return s;
    if (s.status && ['completed', 'failed', 'stopped', 'refused'].includes(s.status) && s.state === undefined) return s;
    await sleep(2000);
  }
  return await call('run_status', { runId });
}

// A prompt big enough to cross Anthropic's minimum cacheable prefix, so the cacheWrite column can
// be non-zero on a REAL call (round 1 only ever saw zeros there).
const BIG = ('The remote workflow engine dispatches agents through a LiteLLM proxy. '
  + 'Each agent call records four token columns: input, output, cacheRead and cacheWrite. ').repeat(420);

const SCRIPT = `export const meta = {
  description: 'Gate 7.5 round 3 REQ-127 probe: one local agent, one cloud agent.',
  params: {
    agents: {
      localone: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 300000 } },
      cloudone: { model: { type: 'string', default: 'haiku' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 300000 } },
    },
  },
};
phase('local');
const a = await agent('localone', { prompt: 'Reply with exactly: LOCAL_OK', allowedTools: [] });
phase('cloud');
const b = await agent('cloudone', { prompt: ${JSON.stringify(BIG)} + '\\n\\nReply with exactly: CLOUD_OK', allowedTools: [] });
return a + '|' + b;`;

const MERMAID = `graph LR
subgraph "local"
localone(["localone<br/>default · low · 300000<br/>tools: none"])
end
subgraph "cloud"
cloudone(["cloudone<br/>haiku · low · 300000<br/>tools: none"])
end
localone-->cloudone`;

R.register = await call('workflow_register', { name: 'val127r3', script: SCRIPT, mermaid: MERMAID });
R.publish = await call('workflow_publish', { name: 'val127r3', channel: 'release', version: R.register.result?.version ?? 'v1' });
R.priceBookProbe = await call('models_list', {});
const started = await call('run_start', { name: 'val127r3', channel: 'release' });
R.runStart = started;
const runId = started.runId ?? started.result?.runId;
R.runId = runId;
const st0 = await poll(runId);
R.runStatus = st0;
const st = st0.result ?? st0;
R.runResult = await call('run_result', { runId });
R.agentLogs = [];
for (const a of st.agents ?? []) {
  R.agentLogs.push(await call('run_agent_log', { runId, agentId: a.agentId ?? a.id }));
}

// --- the budget clause: a TOKEN ceiling binds where a USD one cannot (free local model) ---
const b1 = await call('run_start', { name: 'val127r3', channel: 'release', budget: { tokens: 100 } });
R.budgetTokensRun = { start: b1 };
const bId = b1.runId ?? b1.result?.runId;
if (bId) {
  R.budgetTokensRun.status = await poll(bId);
  R.budgetTokensRun.result = await call('run_result', { runId: bId });
}
// --- and a USD ceiling that the priced cloud call must break ---
const u1 = await call('run_start', { name: 'val127r3', channel: 'release', budget: { usd: 0.0000001 } });
R.budgetUsdRun = { start: u1 };
const uId = u1.runId ?? u1.result?.runId;
if (uId) {
  R.budgetUsdRun.status = await poll(uId);
  R.budgetUsdRun.result = await call('run_result', { runId: uId });
}
writeFileSync(OUT, JSON.stringify(R, null, 1));
console.log('runId', runId, 'budgetTokens', bId, 'budgetUsd', uId);
