// IT-162 (M-2 send-back repair, ADR-046, INV-V26-6, ARCH-111): `capture()`'s FAILED branch dropped
// `GatewayResult.unmapped` — neither the `AgentRecord` nor the failed-branch `usage` transcript
// event ever carried it, while the `done` branch wrote both. `foldUsageFromRecords`
// (run-manager.ts, the fold `run_result.meta.usage` is actually built from for a terminal run —
// `_transition`'s own snapshot write) therefore never counted an unmapped subtype from a
// terminally-failed call, even though that is precisely the call whose unmapped provider chatter
// is worth reading (a call that failed with unrecognized provider chatter along the way).
//
// Mock policy (integration, real adjacent components): real McpFacade + real RunManager + real
// InMemoryRunStore + real AgentExecutor; only the GatewayClient (the third-party network) is faked,
// and it is what produces `GatewayResult.unmapped` on its FAILURE arm — mirrors
// unmapped-column-folds.test.ts (IT-156)'s convention for the success arm.
import { describe, it, expect } from 'vitest';
import { McpFacade } from '../../src/mcp-facade.js';
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { facadeCaller, runScriptVia, AUTH_DISABLED } from '../helpers/workflow-fixtures.js';

const CLOCK = new FixedClock(new Date('2026-01-01T00:00:00Z'));

async function pollUntilSettled(facade: McpFacade, runId: string): Promise<{ status: string }> {
  let s = await facade.runStatus({ runId }, AUTH_DISABLED, false, null);
  for (let i = 0; i < 100 && (s.status === 'running' || s.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 50));
    s = await facade.runStatus({ runId }, AUTH_DISABLED, false, null);
  }
  return s;
}

// A terminally-failed call that ALSO observed provider chatter the engine could not map —
// two occurrences of the same subtype, mirroring IT-156's "count occurrences, not distinct names".
const failingGatewayWithUnmapped: GatewayClient = {
  async invoke() {
    return {
      ok: false, provider: 'anthropic', reason: 'terminal',
      detail: 'simulated terminal failure',
      unmapped: ['weird_subtype', 'weird_subtype'],
    };
  },
};

describe('a terminally-failed call\'s unmapped subtype reaches run_result.meta.unmappedMessages (IT-162, M-2 repair)', () => {
  it('meta.usage.unmappedMessages counts the failed call\'s unmapped subtype', async () => {
    const store = new InMemoryRunStore(CLOCK);
    const runManager = new RunManager({ store, clock: CLOCK, gateway: failingGatewayWithUnmapped });
    const facade = new McpFacade({ clock: CLOCK, store, runManager });

    const run = await runScriptVia(facadeCaller(facade), `const a = await agent('x', {}); return a;`);
    const runId = run.result!.runId;
    const status = await pollUntilSettled(facade, runId);
    expect(status.status).toBe('completed'); // a failed agent() call resolves to null, run continues

    const result = await facade.runResult({ runId }, AUTH_DISABLED, false, null);
    expect(result.meta).toBeDefined();
    expect((result.meta as { usage: { unmappedMessages: Record<string, number> } }).usage.unmappedMessages['weird_subtype']).toBe(2);
  }, 15000);
});
