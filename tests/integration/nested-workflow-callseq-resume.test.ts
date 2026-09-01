// IT-026: nested workflow() journal callSeq namespacing + resume fidelity
// (Gate 8 review D-G8-1, adversarial.md finding V3, HIGH — REQ-006, ARCH-002, ARCH-006).
//
// Bug (review evidence, src/sandbox/child-entry.ts:29,81 + src/run-manager.ts:292-296): a nested
// `workflow()` call spawns a NEW SandboxHost/child process for the nested script, and that child
// has its OWN independent `nextCallSeq` counter starting at 0 again — but its agent() calls are
// journaled into the SAME parent run's journal (`src/run-manager.ts:294` forwards the nested
// child's onAgentRequest to the SAME `this._handleAgentRequest(runId, ...)` as the outer script).
// So the parent script's own callSeq 0 and the nested script's own callSeq 0 collide in one run's
// journal. `ResumeCache.build()` keys entries in a `Map<callSeq, JournalEntry>` (src/resume-cache.ts),
// so a collision silently drops one of the two entries (last-write-wins) and corrupts replay for
// BOTH calls, not just the nested one — once any callSeq's replay() misses, `Plan._missed` stays
// true for the rest of the run (src/resume-cache.ts's own documented "longest-unchanged-prefix"
// contract), forcing every later call (including ones that never changed) to re-run live on resume.
//
// Mock policy (DES-015, integration tier): real RunManager + real WorkflowCatalog (real on-disk
// SQLite) + real sandbox child processes (real IPC, real node:vm) for the namespacing case; the
// resume-fidelity case additionally uses a real AgentExecutor with only the GatewayClient
// (third-party network) faked — same tier/pattern as the already-established IT-019
// (suspend-aborts-gateway-call.test.ts).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { registerPublished, startScript } from '../helpers/workflow-fixtures.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import type { AgentSpawner } from '../../src/agent-executor.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import type { JournalEntry } from '../../src/types.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));

/** Records every JournalEntry appended, in append order — the observable proof of what callSeq
 *  values a real nested-workflow run actually produces. */
class CapturingStore extends InMemoryRunStore {
  readonly captured: JournalEntry[] = [];
  override async appendJournal(runId: string, entry: JournalEntry): Promise<void> {
    this.captured.push(entry);
    return super.appendJournal(runId, entry);
  }
}

function echoSpawner(callCounts: Map<string, number>): AgentSpawner {
  return {
    async run(req) {
      callCounts.set(req.prompt, (callCounts.get(req.prompt) ?? 0) + 1);
      return { kind: 'text', value: req.prompt };
    },
  };
}

async function pollUntilSettled(mgr: RunManager, runId: string) {
  let view = await mgr.status(runId);
  for (let i = 0; i < 200 && (view.status === 'running' || view.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 30));
    view = await mgr.status(runId);
  }
  return view;
}

describe('nested workflow() journal callSeq namespacing + resume fidelity (D-G8-1, REQ-006)', () => {
  let workRoot: string;

  beforeEach(() => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-nested-callseq-'));
  });

  afterEach(() => {
    rmSync(workRoot, { recursive: true, force: true });
  });

  it("a nested workflow()'s own agent() call gets a journal callSeq that never collides with the parent script's own callSeq values in the same run", async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'inner', `const c = await agent('C'); return c;`);
    const store = new CapturingStore(CLOCK);
    const callCounts = new Map<string, number>();
    const mgr = new RunManager({ store, clock: CLOCK, catalog, spawner: echoSpawner(callCounts) });

    const runId = await startScript(mgr, `const a = await agent('A'); const w = await workflow('inner', {}); return {a, w};`);
    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');
    const result = await mgr.result(runId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable: asserted above');
    expect(result.value).toEqual({ a: 'A', w: 'C' });

    // Both A (outer, callSeq 0 in its own child) and C (nested, callSeq 0 in ITS OWN separate
    // child process) get journaled into the SAME run — the namespacing fix must make these two
    // journal entries carry distinct callSeq values.
    expect(store.captured.length).toBe(2);
    const callSeqs = store.captured.map((e) => e.callSeq);
    expect(new Set(callSeqs).size).toBe(callSeqs.length);

    // Corrupted-map proof: a naive Map<callSeq, JournalEntry> silently drops one of two colliding
    // entries (last-write-wins) — both calls must remain independently addressable by their own
    // (now-distinct) callSeq, not just present in the raw append log.
    const byPrompt = new Map(store.captured.map((e) => [e.key.prompt, e]));
    expect(byPrompt.get('A')).toBeDefined();
    expect(byPrompt.get('C')).toBeDefined();
    expect(byPrompt.get('A')!.callSeq).not.toBe(byPrompt.get('C')!.callSeq);
  });

  it('resuming a run containing a nested workflow() replays the already-journaled, unmodified parent-level call from cache instead of re-invoking the gateway live', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'inner', `const c = await agent('C'); return c;`);
    const store = new InMemoryRunStore(CLOCK);

    const gatewayCallCounts = new Map<string, number>();
    let cInvokeCalled!: () => void;
    const cInvokeCalledPromise = new Promise<void>((resolve) => { cInvokeCalled = resolve; });
    let cBlockedOnce = false;
    // Same seam/tier as the already-established IT-019 (suspend-aborts-gateway-call.test.ts):
    // fake GatewayClient, real AgentExecutor/RunManager/sandbox. The nested call for 'C' blocks on
    // the run's own AbortSignal (real D-F9a wiring) the FIRST time only, so suspend() can interrupt
    // it deterministically; every other call (A, and C on resume) resolves immediately.
    const gateway: GatewayClient = {
      async invoke(req) {
        gatewayCallCounts.set(req.prompt, (gatewayCallCounts.get(req.prompt) ?? 0) + 1);
        if (req.prompt === 'C' && !cBlockedOnce) {
          cBlockedOnce = true;
          cInvokeCalled();
          await new Promise<void>((resolve) => {
            if (req.signal) req.signal.addEventListener('abort', () => resolve(), { once: true });
            else setTimeout(resolve, 5000);
          });
          return { ok: false, provider: 'fake', reason: 'timeout' };
        }
        return { ok: true, provider: 'fake', model: 'fake', tokens: { input: 1, output: 1 }, content: req.prompt };
      },
    };
    const mgr = new RunManager({ store, clock: CLOCK, catalog, gateway });

    const runId = await startScript(mgr, `const a = await agent('A'); const w = await workflow('inner', {}); return {a, w};`);

    // Deterministic: wait until the nested workflow's own agent('C') call has genuinely reached
    // the gateway — proves 'A' already completed (and its journal entry committed) first, since
    // the outer script awaits agent('A') before ever calling workflow('inner').
    await cInvokeCalledPromise;
    expect(gatewayCallCounts.get('A')).toBe(1);

    await mgr.suspend(runId);
    await new Promise((r) => setTimeout(r, 300)); // let the abort settle (same margin as IT-019)

    const suspended = await mgr.status(runId);
    expect(suspended.status).toBe('suspended');

    // Resume with the SAME (unmodified) script.
    await mgr.resume(runId);
    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');
    const result = await mgr.result(runId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable: asserted above');
    expect(result.value).toEqual({ a: 'A', w: 'C' });

    // 'A' must replay from the journal, not be re-invoked live a second time. The callSeq
    // collision (review V3) corrupts ResumeCache's callSeq->entry map for the WHOLE run (once any
    // callSeq misses, every later callSeq misses too — src/resume-cache.ts's own documented
    // longest-unchanged-prefix contract), forcing 'A' to also miss and re-run live even though it
    // was never touched by the suspend/resume.
    expect(gatewayCallCounts.get('A')).toBe(1);
  }, 20000);
});
