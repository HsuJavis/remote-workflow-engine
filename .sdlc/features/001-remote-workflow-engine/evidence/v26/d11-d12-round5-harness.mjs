// D11 + D12 verification — v26 Gate 7.5 round 5 (fixer), on the FIXED tree, against a scratch
// engine booted over a COPY of this box's own `rwe.config.json` (only workRoot/bind/port moved and
// auth off — the alias table byte-identical: five models, TWO aliases each, one of them `fable`).
//
// D11 (VAL-195(d)): `models_list {provider:'anthropic'}` / `GET /api/models` served EIGHT rows for
//   four models; the four second rows said `price:"unknown", ratesPerM:null` for models the first
//   rows price. Asked here: one row per model, every alias still discoverable on it, no "unknown".
// D12: `claude-fable-5` had no row in the static price table, so a run through this deployment's
//   own `fable` alias reported `unpriced:true` / `budgetEnforceable.usd:false`. Arm 2 asks for the
//   admission-time PIN at zero provider spend (the `agent()` call sits inside `if (false)` — nothing
//   dispatches, no provider is contacted, but the model is reachable and must be pinned WITH a
//   price), which is exactly REQ-127's clause.
// Usage: node d11-d12-round5-harness.mjs <port> <outJson>
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
async function poll(runId, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const s = await call('run_status', { runId });
    const st = s.status ?? s.result?.status;
    if (['completed', 'failed', 'stopped', 'refused'].includes(st)) return s;
    await sleep(2000);
  }
  return await call('run_status', { runId });
}

// ── arm 1 — D11: the two SERVED catalog surfaces, verbatim rows ──────────────────────────────────
const ml = await call('models_list', { provider: 'anthropic', limit: 20 });
R.modelsListAnthropic = (ml.result ?? []).map((m) => ({
  model: m.model, aliases: m.aliases, price: m.price, ratesPerM: m.ratesPerM, ref: m.ref, costLevel: m.costLevel,
}));
R.modelsListRowCount = R.modelsListAnthropic.length;
R.modelsListDistinctModels = new Set(R.modelsListAnthropic.map((m) => m.model)).size;
R.modelsListUnknownPriced = R.modelsListAnthropic.filter((m) => m.price === 'unknown').map((m) => m.model);
const api = await fetch(`http://127.0.0.1:${PORT}/api/models`).then((r) => r.json());
R.apiModelsAnthropic = api.filter((m) => m.provider === 'anthropic').map((m) => ({ model: m.model, aliases: m.aliases, price: m.price }));

// ── arm 2 — D12: the admission-time price pin for the `fable` alias, at ZERO provider spend ──────
const AGENTS = `      fableone: { model: { type: 'string', default: 'fable' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 300000 } },`;
const MERMAID = `graph LR
subgraph "cloud"
fableone(["fableone<br/>fable · low · 300000<br/>tools: none"])
end`;
const script = (body) => `export const meta = {
  description: 'Gate 7.5 round 5 D12 pin probe under the PRODUCTION alias table.',
  params: {
    agents: {
${AGENTS}
    },
  },
};
phase('cloud');
${body}
return 'ok';`;

const name = `d12r5-pin-${Date.now()}`;
const reg = await call('workflow_register', { name, script: script(`if (false) { await agent('fableone', { prompt: 'never runs', allowedTools: [] }); }`), mermaid: MERMAID });
const version = reg.result?.version ?? reg.version ?? 'v1';
await call('workflow_publish', { name, channel: 'release', version });
const started = await call('run_start', { name, channel: 'release' });
const runId = started.result?.runId ?? started.runId;
const status = await poll(runId);
const result = await call('run_result', { runId });
R.fablePin = {
  register: reg.error ?? { version },
  runId,
  status: status.status ?? status.result?.status,
  budgetEnforceable: result.meta?.budgetEnforceable,
  priceBook: result.meta?.priceBook ?? result.meta?.price_book,
};

if (OUT) writeFileSync(OUT, JSON.stringify(R, null, 1));
console.log(JSON.stringify(R, null, 1));
