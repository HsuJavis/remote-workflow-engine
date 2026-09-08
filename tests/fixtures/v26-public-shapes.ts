// v26 (DES-189, TASK-194, v26): the LITERAL expected JSON of every public shape v26 changes at
// once — one external oracle, so asserting them field-by-field across nine test files does not
// leave three of them checked nowhere. NOT collected by vitest (`include: ['tests/**/*.test.ts']`).
//
// `EXPECTED_AGENT_RECORD_KEYS` gains `unpriced`/`transport`/`proxyModel`/`detail`/`phaseIndex`/
// `costUSD`; `EXPECTED_RUN_USAGE_KEYS` is new.

export const EXPECTED_AGENT_RECORD_KEYS = [
  'agentId', 'label', 'phase', 'phaseIndex', 'state', 'reasonCode', 'provider', 'model',
  'transport', 'proxyModel', 'tokens', 'costUSD', 'unpriced', 'detail', 'frame',
  'startedAt', 'endedAt', 'lastActivityAt',
] as const;

export const EXPECTED_RUN_USAGE_KEYS = ['tokens', 'costUSD', 'unpricedCalls', 'unmappedMessages'] as const;

/** One run_status.agents[] row — a 'done' call on the openrouter path, resolved provider/model
 *  distinct from the transport name (REQ-125's own drift assertion). */
export const EXPECTED_AGENT_RECORD_DONE = {
  agentId: 'agent-1',
  label: 'summarize',
  phase: 'collect',
  phaseIndex: 0,
  state: 'done',
  provider: 'openrouter',
  model: 'google/gemini-3.8-flash',
  transport: 'claude-agent-sdk',
  proxyModel: 'rwe-proxy-default',
  tokens: { input: 18, output: 282, cacheRead: 19522, cacheWrite: 20762 },
  costUSD: 0.0034,
  unpriced: false,
  frame: '',
  startedAt: '2026-09-08T00:00:00.000Z',
  endedAt: '2026-09-08T00:00:01.000Z',
};

/** The usage transcript event — carries the same four resolved fields as the record. */
export const EXPECTED_USAGE_EVENT = {
  ts: '2026-09-08T00:00:01.000Z',
  kind: 'usage',
  data: {
    tokens: { input: 18, output: 282, cacheRead: 19522, cacheWrite: 20762 },
    provider: 'openrouter',
    model: 'google/gemini-3.8-flash',
    transport: 'claude-agent-sdk',
    costUSD: 0.0034,
    unpriced: false,
  },
};

/** run_result.meta — always present, `unpricedCalls`/`unmappedMessages` from ARCH-111/183. */
export const EXPECTED_RUN_RESULT_META = {
  usage: { tokens: { input: 18, output: 282, cacheRead: 19522, cacheWrite: 20762 }, costUSD: 0.0034, unpricedCalls: 0, unmappedMessages: {} },
  budgetEnforceable: { usd: true, tokens: true, unpricedModels: [] as string[] },
};

/** The INVALID_SEED_SPEC refusal envelope (DES-170) — REQ-121's own named acceptance. */
export const EXPECTED_INVALID_SEED_SPEC_ENVELOPE = {
  code: 'INVALID_SEED_SPEC',
  see: 'workflow_authoring_guide',
  detail: { index: 0, path: 'a.txt' },
};

/** One v2 diagram refusal envelope (DES-184) — DIAGRAM_DIRECTION, the first-checked v2 rule. */
export const EXPECTED_DIAGRAM_DIRECTION_ENVELOPE = {
  code: 'DIAGRAM_MISMATCH',
  see: 'workflow_authoring_guide',
  detail: { rule: 'DIAGRAM_DIRECTION', line: 1 },
};
