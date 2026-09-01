// IT-009: McpFacade.workflow_agent_log returns the actual persisted transcript events of a
// completed agent, never a hard-coded empty array (ARCH-004 / DES-001 / DES-008, D-V6).
// Integration tier (DES-015): real McpFacade + real RunManager + real InMemoryRunStore + real
// AgentExecutor/AgentTranscriptSink + real sandbox child process; only the GatewayClient
// (third-party network) is faked.
//
// Red reason (2026-07-03, before Gate 6 rework): `src/mcp-facade.ts` workflow_agent_log
// self-documents as a stub — `return { ..., result: [] }` unconditionally — so this assertion
// fails even though AgentExecutor's AgentTranscriptSink genuinely calls
// `store.appendTranscript(...)` (proven green by IT-004's "transcript is appended to RunStore"
// case). The gap is purely on the read-back path.
import { describe, it, expect, vi } from 'vitest';
import { McpFacade } from '../../src/mcp-facade.js';
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { facadeCaller, runScriptVia } from '../helpers/workflow-fixtures.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));

async function pollUntilSettled(facade: McpFacade, runId: string) {
  let s = await facade.workflow_status({ runId });
  for (let i = 0; i < 60 && (s.status === 'running' || s.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 50));
    s = await facade.workflow_status({ runId });
  }
  return s;
}

describe('workflow_agent_log real transcript read-back (IT-009, D-V6)', () => {
  it('returns the persisted transcript events of a completed agent, not []', async () => {
    const gateway: GatewayClient = {
      invoke: vi.fn().mockResolvedValue({
        ok: true, provider: 'anthropic', model: 'claude-3', tokens: { input: 7, output: 3 }, content: 'PONG',
      }),
    };
    const store = new InMemoryRunStore(CLOCK);
    const runManager = new RunManager({ store, clock: CLOCK, gateway });
    const facade = new McpFacade({ clock: CLOCK, store, runManager });

    const run = await runScriptVia(facadeCaller(facade), `return agent('ping');`);
    const runId = run.result!.runId;
    const status = await pollUntilSettled(facade, runId);
    expect(status.status).toBe('completed');

    const agents = status.result!.agents as Array<{ agentId: string }>;
    expect(agents.length).toBeGreaterThan(0);
    const agentId = agents[0].agentId;

    const log = await facade.workflow_agent_log({ runId, agentId });
    expect(log.error).toBeUndefined();
    expect(Array.isArray(log.result)).toBe(true);
    expect((log.result ?? []).length).toBeGreaterThan(0);
  }, 15000);
});
