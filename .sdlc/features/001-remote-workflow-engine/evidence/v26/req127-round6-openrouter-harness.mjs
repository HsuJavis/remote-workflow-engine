// REQ-127 — the OpenRouter pricing arm, v26 Gate 7.5 round 6 (validator).
// Rounds 1/3/4/5 only ever priced anthropic + ollama calls. REQ-127's own clause says openrouter
// prices come from `/models` (`pricing.prompt / completion / input_cache_read / input_cache_write`),
// and that lookup goes through the same ModelBook index D9/D11 rewired — so it needs its own real
// call. This makes ONE small real OpenRouter call through the engine and then cross-checks the
// recorded costUSD against OpenRouter's own published price for the same model id.
// Usage: node req127-round6-openrouter-harness.mjs <port> <outJson>
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
    const v = s.result ?? s;
    if (['completed', 'failed', 'stopped', 'refused'].includes(v.status)) return v;
    await sleep(2000);
  }
  return (await call('run_status', { runId })).result;
}

const SCRIPT = `export const meta = {
  description: 'Gate 7.5 round 6 REQ-127 probe: one real OpenRouter call, for its price.',
  params: { agents: {
    orone: { model: { type: 'string', default: 'gpt41nano' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 300000 } },
  } },
};
phase('cloud');
const a = await agent('orone', { prompt: 'Reply with exactly: OR_OK', allowedTools: [] });
return a;`;
const MERMAID = `graph LR
subgraph "cloud"
orone(["orone<br/>gpt41nano · low · 300000<br/>tools: none"])
end`;

const name = `val127r6or-${Date.now()}`;
const reg = await call('workflow_register', { name, script: SCRIPT, mermaid: MERMAID });
R.register = reg.error ?? { version: reg.result?.version ?? reg.version };
await call('workflow_publish', { name, channel: 'release', version: reg.result?.version ?? 'v1' });
const started = await call('run_start', { name, channel: 'release' });
R.runId = started.runId ?? started.result?.runId;
const st = await poll(R.runId);
R.status = st.status;
R.agents = (st.agents ?? []).map((a) => ({
  label: a.label, provider: a.provider, model: a.model, state: a.state,
  tokens: a.tokens, costUSD: a.costUSD, unpriced: a.unpriced,
}));
const rr = await call('run_result', { runId: R.runId });
R.meta = rr.meta;
R.result = rr.result;

// the catalog row the engine serves for this model (its own price source)
const ml = await call('models_list', { provider: 'openrouter', limit: 500 }); // 431 openrouter rows on this box — 200 truncates before the gpt-4.1 family
R.engineRow = (ml.result ?? []).filter((m) => m.model === 'openai/gpt-4.1-nano')
  .map((m) => ({ model: m.model, aliases: m.aliases, price: m.price, ratesPerM: m.ratesPerM }));

// OpenRouter's own published price, read straight from their public API (the SoT the clause names)
try {
  const or = await fetch('https://openrouter.ai/api/v1/models').then((r) => r.json());
  const row = (or.data ?? []).find((m) => m.id === 'openai/gpt-4.1-nano');
  R.openrouterPublished = row ? { id: row.id, pricing: row.pricing } : null;
} catch (e) { R.openrouterPublished = { error: String(e) }; }

// hand recomputation from the published per-token prices
const a0 = R.agents[0];
if (a0 && R.openrouterPublished?.pricing) {
  const p = R.openrouterPublished.pricing;
  R.handCheck = {
    formula: 'input*prompt + output*completion + cacheRead*input_cache_read + cacheWrite*input_cache_write',
    expected: a0.tokens.input * Number(p.prompt)
      + a0.tokens.output * Number(p.completion)
      + (a0.tokens.cacheRead ?? 0) * Number(p.input_cache_read ?? 0)
      + (a0.tokens.cacheWrite ?? 0) * Number(p.input_cache_write ?? 0),
    recorded: a0.costUSD,
  };
  R.handCheck.deltaAbs = Math.abs(R.handCheck.expected - R.handCheck.recorded);
}

if (OUT) writeFileSync(OUT, JSON.stringify(R, null, 1));
console.log(JSON.stringify({ runId: R.runId, status: R.status, agents: R.agents, meta: R.meta, engineRow: R.engineRow, published: R.openrouterPublished, handCheck: R.handCheck }, null, 1));
