// issue #162 (owner-approved): an agent() whose structured-output schema never conformed across
// every re-ask attempt (D-V4's bounded retry loop, agent-executor.ts) resolves `null` to the
// script and the gateway call itself genuinely succeeded, so the record settles `state:'done'` —
// before this fix `summarizeAgentFailures` only ever looked at `failed`/`refused` records, so this
// outcome was invisible in `run_status`/`run_result.agentFailures` even though the script got
// nothing useful back. This pins: a `done` record with `schemaExhausted:true` is now folded into
// `agentFailures` with `reason:'schema-exhausted'` and its `reaskCount` carried through; an
// ordinary `done` record (no schema, or a schema that conformed) is NOT counted as a failure.
import { describe, it, expect } from 'vitest';
import { summarizeAgentFailures } from '../../src/run-manager.js';
import type { AgentRecord } from '../../src/types.js';

const doneRec = (overrides: Partial<AgentRecord> = {}): AgentRecord => ({
  agentId: 'agent-1', label: 'parse', state: 'done', provider: 'anthropic', model: 'claude-sonnet-5',
  ...overrides,
} as AgentRecord);

describe('summarizeAgentFailures — schema-exhausted agents (issue #162)', () => {
  it('a done record with schemaExhausted:true is counted in failedAgentCount and agentFailures, reason "schema-exhausted"', () => {
    const out = summarizeAgentFailures([doneRec({ schemaExhausted: true, reaskCount: 2 })]);
    expect(out.failedAgentCount).toBe(1);
    expect(out.agentFailures).toEqual([
      { label: 'parse', agentId: 'agent-1', reason: 'schema-exhausted', message: expect.any(String), reaskCount: 2 },
    ]);
  });

  it('an ordinary done record (no schemaExhausted) is NOT counted as a failure', () => {
    const out = summarizeAgentFailures([doneRec()]);
    expect(out.failedAgentCount).toBe(0);
    expect(out.agentFailures).toBeUndefined();
  });

  it('a schema-exhausted record mixed with a genuinely failed one both appear, each with its own reason', () => {
    const failed: AgentRecord = { agentId: 'agent-2', label: 'other', state: 'failed', provider: 'anthropic', model: 'm', failReason: 'timeout' } as AgentRecord;
    const out = summarizeAgentFailures([doneRec({ schemaExhausted: true, reaskCount: 2 }), failed]);
    expect(out.failedAgentCount).toBe(2);
    expect(out.agentFailures?.map((f) => f.reason).sort()).toEqual(['schema-exhausted', 'timeout']);
  });

  it('schemaExhausted without a reaskCount (edge case) omits reaskCount rather than inventing one', () => {
    const out = summarizeAgentFailures([doneRec({ schemaExhausted: true })]);
    expect(out.agentFailures?.[0]).not.toHaveProperty('reaskCount');
  });
});
