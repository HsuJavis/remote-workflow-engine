// UT-025: AgentExecutor threads a resolved agentType's `tools` frontmatter field into
// `opts.allowedTools` before dispatching to the gateway (D-F11).
//
// D-F11 (binding): "agent definitions frontmatter tools field is authoritative" for the curated
// options.allowedTools UT-024 proves ClaudeAgentSdkGatewayClient applies. `src/agent-definitions.ts`
// already PARSES a `tools:` frontmatter attribute (compat-spec §5: "frontmatter single-sources
// model/tools/prompt") but its own file header says it is "parsed but not yet applied anywhere ...
// intentionally not stored" — no seam anywhere threads it from a resolved AgentTypeDef into the
// outbound gateway request. This test pins the missing half at the AgentExecutor layer (DES-007):
// a known agentType whose definition declares `tools` must have that list applied to the outbound
// `opts.allowedTools`, the same way its `systemPrompt`/`model` are already applied (UT-017/D-V5).
//
// Verifier-authored design extension (same precedent as UT-024/D-V5/D-F2 — not yet in
// 04-design.md, flagged for Gate 6 to finalize): `AgentTypeDef` grows `tools?: string[]`; when a
// resolved definition declares `tools`, `AgentExecutor.run()` must apply it to the outbound
// `opts.allowedTools` the same way it already applies `model` (only when the caller didn't already
// set one of their own — an explicit per-call `opts.allowedTools` from the caller wins).
//
// Mock policy (DES-015, unit tier): a fake GatewayClient captures the exact `req.opts` it receives
// — no real network, no real SDK.
//
// Red reason: confirmed by reading `src/agent-executor.ts`'s `run()` — the agentType-resolution
// block only ever reads `def.systemPrompt`/`def.model`; it has no `tools` field to read at all
// (AgentTypeDef itself has none), so a resolved definition's tools can never reach `effectiveOpts`,
// let alone the gateway. `receivedOpts.allowedTools` is `undefined` in every case below.
import { describe, it, expect } from 'vitest';
import { AgentExecutor, type AgentTypeDef } from '../../src/agent-executor.js';
import type { GatewayClient, GatewayResult } from '../../src/gateway/client.js';
import type { AgentOpts } from '../../src/types.js';
import { defaultRunParams } from '../../src/params/resolve.js';

function okResult(): GatewayResult {
  return { ok: true, provider: 'fake', model: 'm', tokens: { input: 1, output: 1 }, content: 'ok' };
}

describe('AgentExecutor threads a resolved agentType\'s tools into opts.allowedTools (UT-025, D-F11)', () => {
  it("a known agentType's frontmatter-derived tools list is applied to the outbound opts.allowedTools", async () => {
    let receivedOpts: AgentOpts | undefined;
    const gateway: GatewayClient = {
      invoke: async (req) => {
        receivedOpts = req.opts;
        return okResult();
      },
    };
    const agentTypes: Record<string, AgentTypeDef> = {
      // Verifier-authored extension: AgentTypeDef.tools (see file header) — not yet in the real
      // interface, so this literal is typed via a cast rather than the bare AgentTypeDef shape.
      researcher: { systemPrompt: 'You are a researcher.', tools: ['Read', 'Grep'] } as AgentTypeDef & { tools: string[] },
    };
    const executor = new AgentExecutor({ gateway, agentTypes });

    await executor.run({
      runId: 'r1',
      agentId: 'a1',
      prompt: 'find the answer',
      opts: { agentType: 'researcher' },
      workspace: '/tmp/ut-025-ws',
      signal: new AbortController().signal,
      runParams: defaultRunParams(undefined),
    });

    // Forcing red: today's src never applies a resolved definition's tools to opts.allowedTools.
    expect((receivedOpts as (AgentOpts & { allowedTools?: string[] }) | undefined)?.allowedTools).toEqual(['Read', 'Grep']);
  });

  it("an explicit caller-supplied opts.allowedTools wins over the agentType definition's own tools", async () => {
    let receivedOpts: AgentOpts | undefined;
    const gateway: GatewayClient = {
      invoke: async (req) => {
        receivedOpts = req.opts;
        return okResult();
      },
    };
    const agentTypes: Record<string, AgentTypeDef> = {
      researcher: { systemPrompt: 'You are a researcher.', tools: ['Read', 'Grep'] } as AgentTypeDef & { tools: string[] },
    };
    const executor = new AgentExecutor({ gateway, agentTypes });

    await executor.run({
      runId: 'r1',
      agentId: 'a2',
      prompt: 'find the answer',
      // Caller already specified its own restriction — the definition's own tools must not
      // override an explicit caller choice (same precedence rule model already follows).
      opts: { agentType: 'researcher', allowedTools: ['Bash'] } as AgentOpts & { allowedTools: string[] },
      workspace: '/tmp/ut-025-ws',
      signal: new AbortController().signal,
      runParams: defaultRunParams(undefined),
    });

    // NOT a forcing red, confirmed by running this case in isolation — documented transparently
    // rather than mislabelled (same precedent as IT-016's "unknown agentType still fails fast"):
    // since no code path strips or overwrites a caller-supplied opts.allowedTools today (nothing
    // reads a `tools` field on AgentTypeDef at all yet), the caller's own value simply survives
    // unmodified by omission. This is a real regression guard, not a driver of new work — once
    // case (1)'s threading logic is built, it must not regress this precedence rule.
    expect((receivedOpts as (AgentOpts & { allowedTools?: string[] }) | undefined)?.allowedTools).toEqual(['Bash']);
  });

  it('an agentType definition with no declared tools leaves opts.allowedTools untouched (no forced override)', async () => {
    let receivedOpts: AgentOpts | undefined;
    const gateway: GatewayClient = {
      invoke: async (req) => {
        receivedOpts = req.opts;
        return okResult();
      },
    };
    const agentTypes: Record<string, AgentTypeDef> = {
      plain: { systemPrompt: 'You are plain.' }, // no tools declared
    };
    const executor = new AgentExecutor({ gateway, agentTypes });

    await executor.run({
      runId: 'r1',
      agentId: 'a3',
      prompt: 'hello',
      opts: { agentType: 'plain' },
      workspace: '/tmp/ut-025-ws',
      signal: new AbortController().signal,
      runParams: defaultRunParams(undefined),
    });

    // Sanity: this one is NOT expected to be red for the tools-threading reason — a definition
    // that declares no tools has nothing to apply, so allowedTools legitimately stays undefined
    // (ClaudeAgentSdkGatewayClient's own default-core-set fallback, UT-024, is what applies from
    // here on). Documented transparently as a passing regression guard, not a forcing case.
    expect((receivedOpts as (AgentOpts & { allowedTools?: string[] }) | undefined)?.allowedTools).toBeUndefined();
  });
});
