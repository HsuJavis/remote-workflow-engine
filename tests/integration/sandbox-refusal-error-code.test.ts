// IT-140 (v25, DES-169, REQ-120, issue #63): the error a SCRIPT catches carries `.code`.
//
// #61 made an engine refusal visible to the MCP *client* (`run_result.error.code`, a `refused` row
// in `run_status.agents`). It did not make it usable by the *script*, which is the party that has
// to decide whether to recover. The authoring guide teaches
//
//     } catch (e) { if (e.code !== 'BUDGET_EXCEEDED') throw e; ... }
//
// and that condition was ALWAYS true inside the sandbox: `child-entry.ts` reconstructed the IPC
// rejection as `Object.assign(new Error(msg.error.message), { name: msg.error.code })`, writing the
// catalog code to `name` and nothing to `code`. A script following the documentation rethrew in
// exactly the case it was told it could handle.
//
// Mock policy (DES-015): the real SandboxHost forks the real child process and runs the real VM
// guards — nothing about the sandbox is faked. Only the agent()/workflow() handler is stubbed,
// which is this seam's documented dry-run mode (DES-006) and is the same door RunManager wires the
// real AgentExecutor into. No model call is needed to observe the shape of a refusal.
import { describe, it, expect } from 'vitest';
import { SandboxHost } from '../../src/sandbox/host.js';
import { BudgetExceededError, codedError } from '../../src/errors.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WORK_DIR = join(tmpdir(), 'rwe-it140-refusal-code');

/** Returns the caught value's observable shape from INSIDE the VM — the same dump the owner ran
 *  against a live deployment in #63, so the assertions below compare against a real script's view
 *  and not against a host-side object the script never sees. */
const DUMP = (thrower: string) => `
  try {
    ${thrower}
    return { caught: false };
  } catch (e) {
    return {
      caught: true,
      code: e.code,
      name: e.name,
      message: e.message,
      hasOwnCode: Object.prototype.hasOwnProperty.call(e, 'code'),
      str: String(e),
      isError: e instanceof Error,
      argsIsObject: args instanceof Object,
    };
  }
`;

/** The owner's probe shape: wave 1 spends past the budget, wave 2 is refused. Reproduced here as
 *  "every dispatch meets an already-exhausted budget", which is the same refusal on the same path. */
function refusingHost(): SandboxHost {
  return new SandboxHost({
    workspaceRoot: WORK_DIR,
    onAgentRequest: () => { throw new BudgetExceededError(938, 500); },
  });
}

type Dump = {
  caught: boolean;
  code?: string;
  name?: string;
  message?: string;
  hasOwnCode?: boolean;
  str?: string;
  isError?: boolean;
  argsIsObject?: boolean;
};

function resultOf(r: unknown): Dump {
  if (!(r && typeof r === 'object' && 'result' in r)) {
    throw new Error(`script did not complete: ${JSON.stringify(r)}`);
  }
  return (r as { result: Dump }).result;
}

describe('IT-140: an engine refusal reaches the script as `.code` (REQ-120, issue #63)', () => {
  it('a sequential await agent() refusal carries code AND name', async () => {
    const r = await refusingHost().run('it140-seq', DUMP('await agent("researcher", { prompt: "lens A" });'), { k: 1 }, 500);
    const dump = resultOf(r);

    expect(dump.caught).toBe(true);
    // The defect: `code` was `undefined`, `ownKeys` were ["stack","message","name"].
    expect(dump.code).toBe('BUDGET_EXCEEDED');
    expect(dump.hasOwnCode).toBe(true);
    // `name` must KEEP working — it is the only handle scripts have had until now, so something in
    // the wild may rely on it (and `String(e)` renders from it).
    expect(dump.name).toBe('BUDGET_EXCEEDED');
    expect(dump.message).toBe('Budget exceeded: spent 938 >= total 500');
  }, 30000);

  it('a parallel() refusal — the shape the owner actually hit — carries code AND name', async () => {
    const script = DUMP(`await parallel([
      () => agent("researcher", { prompt: "lens A" }),
      () => agent("researcher", { prompt: "lens B" }),
      () => agent("researcher", { prompt: "lens C" }),
    ]);`);
    const dump = resultOf(await refusingHost().run('it140-parallel', script, { k: 1 }, 500));

    expect(dump.caught).toBe(true);
    expect(dump.code).toBe('BUDGET_EXCEEDED');
    expect(dump.name).toBe('BUDGET_EXCEEDED');
  }, 30000);

  it("the authoring guide's own catch condition does not rethrow", async () => {
    // The literal predicate from the guide, run for real. Before the fix this rethrew and the run
    // ended `error`, which is the whole of #63 in one assertion.
    const script = `
      let findings = [];
      try {
        findings = await parallel([() => agent('researcher', { prompt: 'lens A' })]);
      } catch (e) {
        if (e.code !== 'BUDGET_EXCEEDED') throw e;
        return { recovered: true, findings: findings.length };
      }
      return { recovered: false };
    `;
    const r = await refusingHost().run('it140-guide', script, undefined, 500);
    expect(r).toHaveProperty('result');
    expect((r as { result: unknown }).result).toEqual({ recovered: true, findings: 0 });
  }, 30000);

  it('a workflow() nesting refusal carries its code too (regression pin — already true via GuardError)', async () => {
    // This path was NOT broken: `makeWorkflow` re-wraps a delegate throw in a `GuardError`, whose
    // TS parameter property survives type-stripping as an own `code`. Pinned so the two refusal
    // sources cannot drift apart again — the asymmetry (workflow() wraps, agent() did not) is
    // precisely what let #63 hide.
    const host = new SandboxHost({
      workspaceRoot: WORK_DIR,
      onWorkflowRequest: () => { throw codedError('NESTING_DEPTH_EXCEEDED', 'workflow() nesting depth 3 exceeds maxWorkflowDepth=2'); },
    });
    const dump = resultOf(await host.run('it140-nest', DUMP('await workflow("child", {});'), { k: 1 }, null));

    expect(dump.caught).toBe(true);
    expect(dump.code).toBe('NESTING_DEPTH_EXCEEDED');
    expect(dump.name).toBe('NESTING_DEPTH_EXCEEDED');
  }, 30000);

  it('DOCUMENTED LIMIT: cross-realm `instanceof` is false for everything the engine hands the script', async () => {
    // Not a bug being tolerated silently — a boundary the guide now states (DES-169). The script
    // runs in a `node:vm` context whose intrinsics are a different realm from the child process
    // that constructs these values, so `instanceof` fails for engine-raised ERRORS *and* for `args`
    // alike. Fixing it only for errors would teach a half-truth: an author who learned "instanceof
    // works" would still be wrong about `args`. `Array.isArray` and `.code` are realm-safe and are
    // what the guide tells authors to use.
    //
    // IF a future iteration makes the boundary realm-correct, REWRITE this case to assert `true`
    // (and update the guide sentence it pins) — do not delete it.
    const dump = resultOf(await refusingHost().run('it140-realm', DUMP('await agent("researcher", { prompt: "lens A" });'), { k: 1 }, 500));
    expect(dump.isError).toBe(false);
    expect(dump.argsIsObject).toBe(false);
    // …which is exactly why `.code` (a plain own property, not a prototype identity) is the handle.
    expect(dump.code).toBe('BUDGET_EXCEEDED');
  }, 30000);
});
