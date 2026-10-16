// v40 Gate 6.5 (verifier, coverage gate): `RunManager._handleWorkflowRequest`'s nested
// `onDecideRequest`/`onImageRequest` closures (DES-272/274, ARCH-186/187, TASK-269/271) were new
// at v40 but had no test driving a `decide()`/`generateImage()` call from INSIDE a nested
// `workflow()` frame — IT-308/IT-311/IT-312 all dispatch at the TOP level only. Coverage audit
// (coverage-final.json, v40 diff files) found this exact gap: 1/4 statements hit at
// run-manager.ts's nested `onDecideRequest`/`onImageRequest` arrows. Mirrors
// `nested-agent-child-params.test.ts`'s own concern (the CHILD's own declared params, never the
// parent's) for the two v40 primitives instead of `agent()`.
//
// Mock policy (integration): real RunManager/InMemoryRunStore/sandbox fork (both frames); the
// OpenRouter wire stubbed at `RunManagerDeps.directDeps` (DES-274's own seam) — same convention as
// primitive-handlers.test.ts/primitive-resume.test.ts.
import { describe, it, expect } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import { registerPublished, startScript } from '../helpers/workflow-fixtures.js';
import { makeStubFetch } from '../helpers/stub-fetch.js';
import { EXAMPLE_IMAGE_MODEL } from '../../src/authoring-guide.js';

async function pollStatus(mgr: RunManager, runId: string, ms = 20, maxIter = 150): Promise<any> {
  for (let i = 0; i < maxIter; i++) {
    const v = await mgr.status(runId);
    if (['completed', 'failed', 'stopped'].includes(v.status)) return v;
    await new Promise((r) => setTimeout(r, ms));
  }
  return mgr.status(runId);
}

const INNER_META = `export const meta = { phases: [], params: {
  decisions: { gate: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } },
  images: { hero: { model: { type: 'string', default: '${EXAMPLE_IMAGE_MODEL}' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } } }
} };`;

const INNER_SCRIPT = `
  ${INNER_META}
  const d = await decide('gate', { state: { s: 1 }, questions: { ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } });
  const img = await generateImage('hero', { prompt: 'a nested red dog' });
  return { d, img };
`;

describe('nested workflow() frame dispatches decide()/generateImage() through its OWN onDecideRequest/onImageRequest (DES-272/274)', () => {
  it('a decide() + generateImage() call from inside a nested workflow() completes, using the CHILD contract', async () => {
    const stub = makeStubFetch([
      { status: 200, body: { answers: { ok: { type: 'noul', noul: 0.8 } } } },
      { status: 200, body: { id: 'g1', choices: [{ message: { content: '', images: [{ image_url: 'data:image/png;base64,iVBORw0KGgo=' }] } }] } },
    ]);
    const store = new InMemoryRunStore(new FixedClock(new Date('2026-10-01T00:00:00Z')));
    const mgr = new RunManager({ store, directDeps: { fetch: stub.fetch, resolveKey: () => 'sk-test' } } as any);
    await registerPublished(mgr.catalog, 'npd-inner', INNER_SCRIPT);
    const runId = await startScript(mgr, `return await workflow('npd-inner', {});`, { name: 'npd-outer' });
    const view = await pollStatus(mgr, runId);
    expect(view.status).toBe('completed');
    // both calls reached the provider exactly once each — the nested handlers actually dispatched,
    // not merely resolved to a cached/skipped no-op.
    expect(stub.calls).toHaveLength(2);

    // the nested AgentRecords carry a non-empty frame (same assertion nested-agent-child-params.ts
    // already makes for agent()) and their own `kind` — proving the record came through the
    // NESTED `_handleDecideRequest`/`_handleImageRequest` path (frameBase + msg.callSeq, framePathKey),
    // not the top-level one.
    const full = await mgr.status(runId);
    const decideRec = full.agents.find((a: any) => a.kind === 'decide');
    const imageRec = full.agents.find((a: any) => a.kind === 'image');
    expect(decideRec).toBeDefined();
    expect(decideRec!.frame).not.toBe('');
    expect(imageRec).toBeDefined();
    expect(imageRec!.frame).not.toBe('');
  });
});

// A second case tried to pin the nested `onDecideRequest`/`onImageRequest` closures' own
// `generation.aborted` guard (the "a superseded generation's primitive call is refused, never
// dispatched" branch, mirroring `onAgentRequest`'s identical guard) by suspend→resume→suspend
// racing a delayed decide() call. Dropped: a positive control (temporarily disabling the guard via
// `if (false) throw ...`) left the test GREEN regardless — the whole nested SandboxHost tears down
// on suspend before the child's `decide()` IPC round-trip resumes, so the guard line itself is never
// the reason `stub.calls` stays 0. That is the "vacuous green trap" this ledger's own CLAUDE.md/
// contract repeatedly flags — not kept. The one `it()` above already exercises the function's other
// statements (the `if` condition itself evaluates false, and the `return this._handleDecideRequest
// (...)`/`_handleImageRequest(...)` call executes); only the single `throw new Error(...)` line
// inside the guard remains unhit — within the coverage gate's own "≤5-line function: miss ≤ 1 line"
// allowance, so no further test is required to clear the bar.
