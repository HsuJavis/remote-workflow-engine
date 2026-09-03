// IT-020: per-agent records survive a real server restart (D-F9b, REQ-007)
//
// D-F9(b) (binding): per-agent records (workflow_status.agents / workflow_agent_log) survive server
// restart — persist agent records in SQLite or rehydrate from the on-disk agent-<id>.jsonl / journal
// at boot.
//
// 08-validation.md round-2/3 VAL-007 confirmed this is a REAL defect: after a genuine server
// restart, workflow_status(runId).agents for a run whose agent completed BEFORE the restart comes
// back [] (RunStore.getRun — both InMemoryRunStore and SqliteRunStore — hard-codes `agents: []`
// always, since AgentRecord is only ever tracked in an in-process AgentExecutor's in-memory Map, D-V6
// notwithstanding), and workflow_agent_log on that same pre-restart agent returns AGENT_NOT_FOUND —
// McpFacade.workflow_agent_log (mcp-facade.ts:135-137) gates access on `view.agents.find(...)`
// BEFORE ever calling RunStore.getTranscript, so the underlying real transcript data (which DOES
// survive on disk as agent-<id>.jsonl, per D-V6/IT-006's own persistence proof) becomes unreachable
// through the documented API after any restart, even though the run's own top-level status
// correctly survives.
//
// Mock policy (DES-015, integration tier): real McpFacade + real RunManager + real SqliteRunStore
// (genuine on-disk index.db + journal/transcript files) + real sandbox child process; only the
// GatewayClient (third-party network) is faked, with a KNOWN fixed token cost, so the "restart" is
// simulated the same way IT-006/IT-012 already do — fresh instances constructed against the SAME
// on-disk data dir, no live in-process state carried over.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/clock.js';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade, NO_TRIGGER_PORTS, NO_GRAPH_ANALYZER } from '../../src/mcp-facade.js';
import { SqliteRunStore } from '../../src/store/sqlite-run-store.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { facadeCaller, runScriptVia } from '../helpers/workflow-fixtures.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));

describe('Per-agent records survive a real server restart (IT-020, D-F9b)', () => {
  it('workflow_status.agents and workflow_agent_log still return the completed agent record after a restart on the same data dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rwe-restart-'));
    try {
      const gateway: GatewayClient = {
        invoke: async () => ({
          ok: true,
          provider: 'fake',
          model: 'fake-model',
          tokens: { input: 7, output: 3 },
          content: 'pong',
        }),
      };

      // --- "before restart" process ---
      const store1 = new SqliteRunStore(join(dir, 'store'), CLOCK);
      const mgr1 = new RunManager({ store: store1, clock: CLOCK, workRoot: dir, gateway });
      const facade1 = new McpFacade({ store: store1, runManager: mgr1, clock: CLOCK, triggerPorts: NO_TRIGGER_PORTS, graphAnalyzer: NO_GRAPH_ANALYZER });

      const submitted = await runScriptVia(facadeCaller(facade1), `return await agent('hi');`);
      const runId = submitted.result!.runId;

      let status = await facade1.workflow_status({ runId });
      for (let i = 0; i < 100 && status.status === 'running'; i++) {
        await new Promise((r) => setTimeout(r, 20));
        status = await facade1.workflow_status({ runId });
      }
      expect(status.status).toBe('completed');
      // Sanity: same-process observability already works today (D-V6 real read-back).
      expect(status.result?.agents?.[0]?.agentId).toBe('agent-1');

      // --- "restart": fresh instances against the SAME on-disk data dir, no live process state ---
      const store2 = new SqliteRunStore(join(dir, 'store'), CLOCK);
      const mgr2 = new RunManager({ store: store2, clock: CLOCK, workRoot: dir, gateway });
      const facade2 = new McpFacade({ store: store2, runManager: mgr2, clock: CLOCK, triggerPorts: NO_TRIGGER_PORTS, graphAnalyzer: NO_GRAPH_ANALYZER });

      const statusAfterRestart = await facade2.workflow_status({ runId });
      expect(statusAfterRestart.status).toBe('completed'); // run status itself already survives (real, Gate 7.5)
      // Forcing red: RunStore.getRun always returns agents:[] and nothing repopulates them from the
      // SqliteRunStore/agent-<id>.jsonl files after a restart.
      expect(statusAfterRestart.result?.agents?.length).toBeGreaterThan(0);

      const logAfterRestart = await facade2.workflow_agent_log({ runId, agentId: 'agent-1' });
      expect(logAfterRestart.error).toBeUndefined();
      expect(logAfterRestart.result?.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
});
