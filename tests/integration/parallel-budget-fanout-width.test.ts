// IT-135/IT-136/IT-137/IT-138/IT-139 (v25, REQ-120, issue #61): a `budget` must not cost `parallel()` its third
// branch, and a call the ENGINE refused must be visible to the caller.
//
// Bug (owner-reported, run a88e5d07-5e24-446a-8293-854fbffbc037; root-caused on the issue):
// `src/run-guard.ts` reserved `RESERVATION_FRACTION = 0.5` of the TOTAL budget per about-to-dispatch
// `agent()` call. Two concurrent calls therefore reserved 50% + 50% = 100%, and the THIRD call's
// `assertBudget()` (`_spent + _reserved >= total`) threw `BudgetExceededError` — regardless of how
// much had actually been spent (the reported run had spent almost nothing). That is arithmetic, not
// a race: ANY budgeted `parallel()` wider than 2 lost everything past the second branch. The loss
// was silent because `makeParallel`'s `catch { return null }` (src/sandbox/guards.ts) discarded the
// reason; the only durable evidence was a gap in the journal's callSeq (`0, 1, [2 missing], 3, 4`).
//
// Fix (owner ruling 2026-09-07, REQ-120): the reservation mechanism is REMOVED, not re-tuned —
// concurrency is governed by the per-run concurrency cap (which queues) and budget governs the run's
// total spend, nothing more. These cases pin both halves: an unspent budget never truncates a
// fan-out, and a spent one refuses VISIBLY (named code + a `refused` record) instead of silently
// nulling a branch.
//
// Mock policy (DES-015, integration tier): real RunManager + real RunGuard + real AgentExecutor +
// real sandbox child process + the real `parallel()` VM guard; only the GatewayClient (third-party
// network) is faked, with an artificial resolve delay so concurrent overlap is deterministic rather
// than a timing coin-flip — the same technique IT-030/IT-037 already rely on.
import { describe, it, expect, vi } from 'vitest';
import { RunManager } from '../../src/run-manager.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { startScript } from '../helpers/workflow-fixtures.js';

async function pollUntilSettled(mgr: RunManager, runId: string) {
  let view = await mgr.status(runId);
  for (let i = 0; i < 200 && (view.status === 'running' || view.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 30));
    view = await mgr.status(runId);
  }
  return view;
}

function fanOutScript(calls: number): string {
  return `
    const thunks = [];
    for (let i = 0; i < ${calls}; i++) {
      // v24 (ADR-029): the first positional is a LITERAL label; the prompt travels in the options
      // object. One label, N distinct prompts — the oracles below count dispatches, not labels.
      thunks.push(async () => agent('researcher', { prompt: 'lens-' + i }));
    }
    const results = await parallel(thunks);
    // v26 (owner ruling Q5, ADR-037, DES-182): \`budget.spent()\` is USD; the four TOKEN columns are
    // read through \`budget.tokens()\`. This run's limit is a token limit, so \`.sum\` is the counter
    // the oracle below compares against the server's own accounting — same property as v25, new
    // accessor for the same number.
    return { results, spent: budget.tokens().sum };
  `;
}

function trackedGateway(tokensPerCall: number, delayMs: number) {
  let inFlight = 0;
  let maxInFlight = 0;
  const invoke = vi.fn(
    () =>
      new Promise((resolve) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        setTimeout(() => {
          inFlight -= 1;
          resolve({
            ok: true,
            provider: 'fake',
            model: 'fake',
            tokens: { input: tokensPerCall / 2, output: tokensPerCall / 2 },
            content: 'ok',
          });
        }, delayMs);
      }),
  );
  return { gateway: { invoke } as unknown as GatewayClient, invoke, maxInFlight: () => maxInFlight };
}

describe('a budget does not cost parallel() its branches past the second (IT-135, REQ-120, issue #61)', () => {
  it('a 3-wide parallel() under an ample budget dispatches ALL THREE calls', async () => {
    const CALLS = 3;
    const TOKENS_PER_CALL = 100; // the whole fan-out costs 300 against a 1.5M ceiling
    const BUDGET = 1_500_000; // the budget the owner's real run carried

    const { gateway, invoke } = trackedGateway(TOKENS_PER_CALL, 40);
    const mgr = new RunManager({ gateway, concurrency: 8 });

    const runId = await startScript(mgr, fanOutScript(CALLS), { budget: BUDGET });
    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');

    const result = await mgr.result(runId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable: asserted above');
    const { results, spent } = result.value as { results: unknown[]; spent: number };

    // The red this test was written against: the third call's assertBudget() saw 50%+50% reserved
    // and threw, so results[2] was null and the gateway was invoked twice (measured, 2026-09-07:
    // "expected [ 'ok', 'ok' ] to have a length of 3 but got 2").
    expect(results.filter((r) => r !== null)).toHaveLength(CALLS);
    expect(invoke).toHaveBeenCalledTimes(CALLS);
    expect(spent).toBe(CALLS * TOKENS_PER_CALL);

    // …and every branch is observable as a real agent, not a hole in run_status.
    const done = view.agents.filter((a) => a.state === 'done');
    expect(done).toHaveLength(CALLS);
  }, 20000);

  it('a 6-wide parallel() under an ample budget dispatches all six (the ceiling is not "2")', async () => {
    const CALLS = 6;
    const TOKENS_PER_CALL = 100;
    const BUDGET = 1_000_000;

    const { gateway, invoke } = trackedGateway(TOKENS_PER_CALL, 30);
    const mgr = new RunManager({ gateway, concurrency: 8 });

    const runId = await startScript(mgr, fanOutScript(CALLS), { budget: BUDGET });
    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');

    const result = await mgr.result(runId);
    if (!result.ok) throw new Error(`run failed: ${JSON.stringify(result.error)}`);
    const { results } = result.value as { results: unknown[] };
    expect(results.filter((r) => r !== null)).toHaveLength(CALLS);
    expect(invoke).toHaveBeenCalledTimes(CALLS);
  }, 20000);
});

describe('a genuinely exhausted budget refuses VISIBLY (IT-136, REQ-120, issue #61)', () => {
  it('the refused call carries a named code, appears in run_status.agents, and is not conflated with a thrown thunk', async () => {
    const TOKENS_PER_CALL = 1000;
    const BUDGET = 1000; // exactly one call's worth: the seed call below spends all of it

    const { gateway, invoke } = trackedGateway(TOKENS_PER_CALL, 20);
    const mgr = new RunManager({ gateway, concurrency: 8 });

    // The budget is spent by a call that COMPLETES first, so the fan-out that follows meets a
    // genuinely exhausted budget — the only condition under which the engine now refuses (v25
    // ruling: budget = cumulative spend; there is no reservation and no speculative refusal).
    const runId = await startScript(mgr, `
      const seed = await agent('researcher', { prompt: 'seed' });
      const results = await parallel([
        async () => agent('researcher', { prompt: 'lens-0' }),
        async () => agent('researcher', { prompt: 'lens-1' }),
        async () => agent('researcher', { prompt: 'lens-2' }),
      ]);
      return { seed, results };
    `, { budget: BUDGET });
    const view = await pollUntilSettled(mgr, runId);

    // The owner's requirement: 「如果是 budget 問題 應該 fail 時 client 知道」. A refusal to dispatch
    // is NOT an author's thunk throwing, so parallel() must not swallow it to null — the run fails
    // and says why, with the catalog code rather than a class name.
    expect(view.status).toBe('failed');
    const result = await mgr.result(runId);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable: asserted above');
    expect(result.error.code).toBe('BUDGET_EXCEEDED');

    // …and each refused call is a RECORD with a named reason, not a hole (issue #61's real
    // complaint: "a refused dispatch leaves no trace" — the only evidence was a callSeq gap).
    const refused = view.agents.filter((a) => a.state === 'refused');
    expect(refused.length).toBeGreaterThan(0);
    for (const a of refused) {
      expect(a.reasonCode).toBe('BUDGET_EXCEEDED');
      expect(a.label).toBe('researcher');
      // v26 (DES-180/DES-188): tokens widened to four columns — a refused call's cache columns are
      // the SAME known zero as input/output (it never reached a gateway).
      expect(a.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    }

    // Only the seed call was ever dispatched: the budget stopped dispatch, as advertised.
    expect(invoke).toHaveBeenCalledTimes(1);
  }, 20000);

  it('an author-thrown thunk still yields null — the two cases are distinguishable, not merged', async () => {
    // REQ-120: "parallel() 不得把它和「作者自己的 thunk 丟例外」混為一談". The null-for-a-throwing-thunk
    // contract is DOCUMENTED behaviour and must survive the fix — only ENGINE refusals propagate.
    const { gateway, invoke } = trackedGateway(100, 10);
    const mgr = new RunManager({ gateway, concurrency: 8 });

    const runId = await startScript(mgr, `
      const results = await parallel([
        async () => agent('researcher', { prompt: 'ok' }),
        async () => { throw new Error("the author's own code failed"); },
      ]);
      return { results };
    `, { budget: 1_000_000 });
    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');

    const result = await mgr.result(runId);
    if (!result.ok) throw new Error(`run failed: ${JSON.stringify(result.error)}`);
    const { results } = result.value as { results: unknown[] };
    expect(results[0]).toBe('ok');
    expect(results[1]).toBe(null); // swallowed to null, exactly as documented
    expect(invoke).toHaveBeenCalledTimes(1);
  }, 20000);
});

describe('the honest budget contract: a stop signal, not a hard ceiling (IT-137, REQ-120 owner ruling)', () => {
  it('dispatch stops once spend reaches the total; overshoot is bounded by ONE concurrency window', async () => {
    const TOKENS_PER_CALL = 1000;
    const BUDGET = 1000;
    const CONCURRENCY = 2;

    const { gateway, invoke } = trackedGateway(TOKENS_PER_CALL, 20);
    const mgr = new RunManager({ gateway, concurrency: CONCURRENCY });

    // Wave 1 is a full concurrency window arriving while nothing has been spent — every call passes
    // the budget door, so the run overshoots by one window. That is what the engine can actually
    // enforce (a call's cost is unknowable before it finishes), and the authoring guide says so.
    // Wave 2 then meets recorded spend and is refused, which the author can catch.
    const runId = await startScript(mgr, `
      const wave1 = await parallel([
        async () => agent('researcher', { prompt: 'w1-a' }),
        async () => agent('researcher', { prompt: 'w1-b' }),
      ]);
      let refusedCode = null;
      try {
        await parallel([async () => agent('researcher', { prompt: 'w2-a' })]);
      } catch (e) {
        refusedCode = e && (e.code || e.name);
      }
      // v26: token accounting reads through budget.tokens() (budget.spent() is USD) — see fanOutScript.
      return { wave1, refusedCode, spent: budget.tokens().sum };
    `, { budget: BUDGET });
    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');

    const result = await mgr.result(runId);
    if (!result.ok) throw new Error(`run failed: ${JSON.stringify(result.error)}`);
    const { wave1, refusedCode, spent } = result.value as { wave1: unknown[]; refusedCode: string; spent: number };

    expect(wave1.filter((r) => r !== null)).toHaveLength(CONCURRENCY); // the window ran in full
    expect(spent).toBe(CONCURRENCY * TOKENS_PER_CALL);
    expect(spent).toBeLessThanOrEqual(BUDGET + CONCURRENCY * TOKENS_PER_CALL); // the enforceable bound
    expect(refusedCode).toBe('BUDGET_EXCEEDED'); // …and nothing is dispatched after it
    expect(invoke).toHaveBeenCalledTimes(CONCURRENCY);
  }, 20000);
});

describe('the concurrency cap queues, it does not truncate (IT-138, REQ-120 owner ruling)', () => {
  it('a 5-wide parallel() under a concurrency cap of 2 still returns FIVE results, 2 at a time', async () => {
    const CALLS = 5;
    const CONCURRENCY = 2;
    const { gateway, invoke, maxInFlight } = trackedGateway(100, 30);
    const mgr = new RunManager({ gateway, concurrency: CONCURRENCY });

    // The owner's ruling puts the whole fan-out-width question here: concurrency is governed by the
    // concurrency cap, and that cap QUEUES. A wider fan-out than the cap is slower, never smaller —
    // which is why removing the budget reservation costs nothing in protection.
    const runId = await startScript(mgr, fanOutScript(CALLS), { budget: 1_000_000 });
    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');

    const result = await mgr.result(runId);
    if (!result.ok) throw new Error(`run failed: ${JSON.stringify(result.error)}`);
    const { results } = result.value as { results: unknown[] };
    expect(results.filter((r) => r !== null)).toHaveLength(CALLS);
    expect(invoke).toHaveBeenCalledTimes(CALLS);
    expect(maxInFlight()).toBe(CONCURRENCY); // the cap is real…
    expect(view.agents.filter((a) => a.state === 'done')).toHaveLength(CALLS); // …and nothing was lost to it
  }, 20000);
});

describe('an omitted budget means unbounded (IT-139, REQ-120 regression pin)', () => {
  it('a wide fan-out with no budget dispatches every branch and reports budget.total === null', async () => {
    const CALLS = 8;
    const { gateway, invoke } = trackedGateway(1000, 20);
    const mgr = new RunManager({ gateway, concurrency: 8 });

    // `tool-specs.ts` promises "Omitted or null means unbounded"; `RunGuard.assertBudget()` is a
    // no-op for a null total. Pinned here so the fix above can never accidentally make an
    // unbudgeted run budget-managed.
    const runId = await startScript(mgr, `
      const thunks = [];
      for (let i = 0; i < ${CALLS}; i++) thunks.push(async () => agent('researcher', { prompt: 'lens-' + i }));
      const results = await parallel(thunks);
      return { results, total: budget.total, remaining: budget.remaining() };
    `, {});
    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');

    const result = await mgr.result(runId);
    if (!result.ok) throw new Error(`run failed: ${JSON.stringify(result.error)}`);
    const { results, total, remaining } = result.value as { results: unknown[]; total: number | null; remaining: number };
    expect(results.filter((r) => r !== null)).toHaveLength(CALLS);
    expect(invoke).toHaveBeenCalledTimes(CALLS);
    expect(total).toBe(null);
    expect(remaining).toBe(null); // Infinity does not survive JSON — the point is that it is not a number ceiling
  }, 20000);
});
