// REQ-127 / D9 re-verification — v26 Gate 7.5 round 4 (fixer), on the FIXED tree.
// Round 3's counterfactual proved the alias table was the only variable: with the PRODUCTION table
// (five models, two aliases each) every Anthropic call recorded `costUSD 0 / unpriced:true` and
// `budgetEnforceable.usd:false`; with one alias per model the same workflow recorded 0.0023872.
// This runs the PRODUCTION table verbatim (a scratch copy of `rwe.config.json`, workRoot moved and
// auth off — the aliases untouched) and asks for the priced outcome.
//   arm 1 — the admission-time PIN alone, zero provider spend: the agent call sits inside
//           `if (false)`, so nothing dispatches, but `params.agents.cloudone.model` is still
//           reachable and must be pinned WITH a price.
//   arm 2 — a real Haiku call through the same engine, for the recorded `costUSD`/`unpriced`.
// Usage: node req127-round4-harness.mjs <port> <outJson>
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
async function poll(runId, tries = 90) {
  for (let i = 0; i < tries; i++) {
    const s = await call('run_status', { runId });
    const st = s.status ?? s.result?.status;
    if (['completed', 'failed', 'stopped', 'refused'].includes(st)) return s;
    await sleep(2000);
  }
  return await call('run_status', { runId });
}

const AGENTS = `      cloudone: { model: { type: 'string', default: 'haiku' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 300000 } },`;
const MERMAID = `graph LR
subgraph "cloud"
cloudone(["cloudone<br/>haiku · low · 300000<br/>tools: none"])
end`;
const script = (body) => `export const meta = {
  description: 'Gate 7.5 round 4 D9 probe under the PRODUCTION alias table.',
  params: {
    agents: {
${AGENTS}
    },
  },
};
phase('cloud');
${body}
return 'ok';`;

async function arm(name, body) {
  const reg = await call('workflow_register', { name, script: script(body), mermaid: MERMAID });
  const version = reg.result?.version ?? reg.version ?? 'v1';  // the envelope's own `version` is the TOOL result version (1), not the workflow's ('v1')
  await call('workflow_publish', { name, channel: 'release', version });
  const started = await call('run_start', { name, channel: 'release' });
  const runId = started.result?.runId ?? started.runId;
  const status = await poll(runId);
  const result = await call('run_result', { runId });
  const view = status.result ?? status;
  return {
    register: reg.error ?? { version },
    started: started.error ?? started.status,
    runId,
    status: status.status ?? view.status,
    agents: (view.agents ?? []).map((a) => ({ label: a.label, provider: a.provider, model: a.model, state: a.state, tokens: a.tokens, costUSD: a.costUSD, unpriced: a.unpriced })),
    meta: result.meta,
  };
}

// arm 1 — the pin only. Nothing is dispatched; no provider is contacted.
R.pinOnly = await arm(`d9r4-pin-${Date.now()}`, `if (false) { await agent('cloudone', { prompt: 'never runs', allowedTools: [] }); }`);
// arm 2 — one real, small Haiku call on the SAME engine and the SAME alias table.
R.realCall = await arm(`d9r4-real-${Date.now()}`, `await agent('cloudone', { prompt: 'Reply with exactly: CLOUD_OK', allowedTools: [] });`);
// models_list answers the tool ENVELOPE; the catalog rows are on `.result`.
const ml = await call('models_list', { provider: 'anthropic', limit: 20 });
R.modelsListAnthropic = (ml.result ?? []).map((m) => ({ model: m.model, alias: m.alias, price: m.price, ratesPerM: m.ratesPerM ? 'priced' : m.ratesPerM }));

if (OUT) writeFileSync(OUT, JSON.stringify(R, null, 1));
console.log(JSON.stringify(R, null, 1));
