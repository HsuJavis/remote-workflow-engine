// verify-i LOW-5 (2026-09-30): `agentFailures[].message` (run_status / run_result / dashboard) is a
// SUMMARY — no stray result-subtype prefix ("success: "), and never the raw CLI stderr tail (which
// can name the auth env var in use). The full detail stays on the agent record (run_agent_log).
import { describe, it, expect } from 'vitest';
import { summarizeAgentFailures } from '../../src/run-manager.js';
import type { AgentRecord } from '../../src/types.js';

const rec = (detail: string): AgentRecord => ({ agentId: 'agent-2', label: 'bad', state: 'failed', failReason: 'terminal', detail } as unknown as AgentRecord);

describe('agentFailures message summary', () => {
  it('drops the "success: " prefix and everything from the CLI stderr tail on', () => {
    const out = summarizeAgentFailures([rec('success: API Error: 400 stub: deliberate failure — CLI stderr tail: ⚠ claude.ai connectors are disabled because ANTHROPIC_API_KEY is set')]);
    expect(out.agentFailures?.[0]?.message).toBe('API Error: 400 stub: deliberate failure');
  });
  it('a detail that is ONLY a stderr tail says so without quoting it', () => {
    const out = summarizeAgentFailures([rec('CLI stderr tail: ANTHROPIC_API_KEY something')]);
    expect(out.agentFailures?.[0]?.message).toBe('agent failed; see run_agent_log for the CLI diagnostics');
  });
  it('an ordinary detail is kept (bounded) as before', () => {
    const out = summarizeAgentFailures([rec('no response from model "m" (provider "anthropic") — timeout')]);
    expect(out.agentFailures?.[0]?.message).toBe('no response from model "m" (provider "anthropic") — timeout');
  });
});
