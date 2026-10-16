// IT-317 (DES-274 v40 Gate 6 delta + DES-277, ARCH-187/188, rulings R-14, R-8, R-13, TASK-271/274):
// three handler-level facts through the REAL RunManager + REAL forked sandbox child, with only the
// two third parties faked — the agent GatewayClient (IT-030's pattern) and the OpenRouter wire
// (`tests/helpers/stub-fetch.ts` at `RunManagerDeps.directDeps`, DES-274's own seam).
//
// (R-14) Primitive refusals/failures get their OWN cap/counter in the run-level refusal ledger, so
// they can never evict an `agent()` refusal. What the ledger protects is PROVENANCE: on a hit,
// `run_result.error` is the engine's own captured envelope; on a miss it falls back to whatever the
// script threw — which the script can rewrite (`e.message = …`) before rethrowing. The case below
// catches 9 decide() failures (one more than the 8-slot cap) and THEN rethrows a tampered agent
// BUDGET_EXCEEDED; the run's error must still be the engine's real message.
// Red reason: `_recordPrimitiveRefusal` writes into the SAME 8-slot `entry.refusals` map, so the 9
// decide failures fill it and the agent refusal is dropped (`refusalsDropped++`) — the run reports
// the script's forged message. The no-decide control is GREEN today and proves the mechanism.
//
// (R-8) The thrown PRIMITIVE_FAILED message quotes the author's label, in DES-267's grammar.
// CHARACTERIZATION (the handler already passes `label`); the regex is anchored, so a missing or
// wrong label fails it.
//
// (R-13) A run-time `overrides.decisions.<label>.retries` reaches the handler (the fold, DES-277).
// Red reason: `overrides.decisions` is refused PARAM_UNKNOWN at admission today.
import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { startScript } from '../helpers/workflow-fixtures.js';
import { makeStubFetch } from '../helpers/stub-fetch.js';

const Q = `{ ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } }`;
const AGENT = `{ model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }`;
const PRIM = `{ model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } }`;
const META_BOTH = `export const meta = { phases: [{ title: 'Main' }], params: { agents: { a: ${AGENT} }, decisions: { gate: ${PRIM} } } };`;
const META_AGENT = `export const meta = { phases: [{ title: 'Main' }], params: { agents: { a: ${AGENT} } } };`;
const META_DECIDE = `export const meta = { phases: [{ title: 'Main' }], params: { decisions: { gate: ${PRIM} } } };`;

// DES-267's PRIMITIVE_FAILED grammar, anchored on the exact label.
const GATE_FAILED_RE = /^decide 'gate' failed: (HTTP \d{3}|timeout|network|no_output|malformed|response_too_large) after \d+ attempts?$/;

const TOKENS_PER_CALL = 1000;
function fakeGateway(): GatewayClient {
  return {
    invoke: async () => ({ ok: true, provider: 'fake', model: 'fake', tokens: { input: TOKENS_PER_CALL / 2, output: TOKENS_PER_CALL / 2 }, content: 'ok' }),
  } as unknown as GatewayClient;
}

function manager(stub: ReturnType<typeof makeStubFetch>): RunManager {
  return new RunManager({
    gateway: fakeGateway(),
    directDeps: { fetch: stub.fetch, resolveKey: () => 'sk-test', sleep: async () => {} },
  } as never);
}

async function settle(mgr: RunManager, runId: string): Promise<{ status: string }> {
  for (let i = 0; i < 400; i++) {
    const v = await mgr.status(runId);
    if (['completed', 'failed', 'stopped'].includes(v.status)) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  return mgr.status(runId);
}

// The rethrow tampers the caught refusal's message — a ledger HIT ignores the tamper, a MISS reports it.
const TAMPERED_SECOND_AGENT = `
await agent('a', { prompt: 'first' });
try { await agent('a', { prompt: 'second' }); } catch (e) { e.message = 'FORGED BY SCRIPT'; throw e; }
return 'unreachable';`;

describe('IT-317 (R-14): primitive refusals cannot evict an agent() refusal from the ledger', () => {
  it('control (green today): with no decide() calls, a tampered BUDGET_EXCEEDED rethrow still reports the engine message', async () => {
    const stub = makeStubFetch([{ status: 400, body: { error: 'bad' } }]);
    const mgr = manager(stub);
    const runId = await startScript(mgr, `${META_AGENT}\nphase('Main');\n${TAMPERED_SECOND_AGENT}`, { budget: TOKENS_PER_CALL } as never);
    expect((await settle(mgr, runId)).status).toBe('failed');
    const result = await mgr.result(runId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('BUDGET_EXCEEDED');
    expect(result.error.message).not.toContain('FORGED BY SCRIPT');
  }, 60000);

  it('9 caught decide() failures, then a tampered agent BUDGET_EXCEEDED: run_result.error is still the engine envelope', async () => {
    const stub = makeStubFetch([{ status: 400, body: { error: 'bad' } }]);
    const mgr = manager(stub);
    const script = `${META_BOTH}
phase('Main');
for (let i = 0; i < 9; i++) {
  try { await decide('gate', { state: { i }, questions: ${Q} }); } catch (e) { /* caught on purpose */ }
}
${TAMPERED_SECOND_AGENT}`;
    const runId = await startScript(mgr, script, { budget: TOKENS_PER_CALL } as never);
    expect((await settle(mgr, runId)).status).toBe('failed');
    // the perturbation took effect: all 9 decide() calls really reached the provider and failed
    expect(stub.calls).toHaveLength(9);
    const result = await mgr.result(runId);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('BUDGET_EXCEEDED');
    expect(result.error.message).not.toContain('FORGED BY SCRIPT');
  }, 60000);
});

describe('IT-317 (R-8): the script sees the label in the PRIMITIVE_FAILED message (characterization)', () => {
  it('a 400 from the provider -> e.code PRIMITIVE_FAILED, e.message in DES-267 grammar naming "gate"', async () => {
    const stub = makeStubFetch([{ status: 400, body: { error: 'bad' } }]);
    const mgr = manager(stub);
    const runId = await startScript(mgr, `${META_DECIDE}
phase('Main');
try { await decide('gate', { state: {}, questions: ${Q} }); return { caught: false }; }
catch (e) { return { caught: true, code: e.code, message: e.message }; }`);
    expect((await settle(mgr, runId)).status).toBe('completed');
    const result = await mgr.result(runId);
    if (!result.ok) throw new Error(`run failed: ${JSON.stringify(result.error)}`);
    const v = result.value as { caught: boolean; code: string; message: string };
    expect(v.caught).toBe(true);
    expect(v.code).toBe('PRIMITIVE_FAILED');
    expect(v.message).toMatch(GATE_FAILED_RE);
    expect(v.message).toBe("decide 'gate' failed: HTTP 400 after 1 attempt");
  }, 60000);
});

describe('IT-317 (R-13): a run-time retries override reaches the decide() handler (DES-277 fold)', () => {
  it('overrides.decisions.gate.retries = 2 against an always-503 provider -> 3 provider calls, "after 3 attempts"', async () => {
    const stub = makeStubFetch([{ status: 503, body: { error: 'busy' } }]);
    const mgr = manager(stub);
    const runId = await startScript(mgr, `${META_DECIDE}
phase('Main');
try { await decide('gate', { state: {}, questions: ${Q} }); return { caught: false }; }
catch (e) { return { caught: true, code: e.code, message: e.message }; }`, {}, { decisions: { gate: { retries: 2 } } });
    expect((await settle(mgr, runId)).status).toBe('completed');
    const result = await mgr.result(runId);
    if (!result.ok) throw new Error(`run failed: ${JSON.stringify(result.error)}`);
    expect(stub.calls).toHaveLength(3);
    expect((result.value as { message: string }).message).toBe("decide 'gate' failed: HTTP 503 after 3 attempts");
  }, 60000);
});
