// issues #81/#83: a declared skill was materialized as `.claude/skills/<name>/SKILL.md` but never
// reached the model — the gateway put no `Skill` tool on the wire (`tools: curatedTools`) and never
// passed `Options.skills`, while the harness descriptor's `materialized.skills` read as if it had.
//
// Measured against the real SDK/CLI before this fix (claude-agent-sdk `query()`, haiku):
//   - `tools:[]` + `Options.skills:['moonfish']` -> no Skill tool exposed, answered UNKNOWN. The SDK
//     only appends `Skill(<name>)` to `allowedTools`; an explicit `tools` list still narrows it out.
//   - `tools:['Skill']` + `allowedTools:[]` + `Options.skills:['moonfish']` -> first call
//     `Skill {"skill":"moonfish"}`, correct answer. That is the wiring pinned here.
//   - bare `Skill` WITHOUT `Options.skills` -> every discovered skill (incl. the CLI's bundled ones)
//     is listed and activatable, so `Options.skills` is ALWAYS passed (`[]` when nothing declared).
//   - a skill's inline `!`cmd`` runs through the CLI's shell path at activation; the engine turns it
//     off (`disableSkillShellExecution`) — skill text is instructions, execution goes through tools.
//
// Mock policy (unit): the injected `queryImpl` seam stands in for the SDK; asset roots/workspace
// are real temp dirs because `_invokeOnce` materializes through the real fs facade.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeAgentSdkGatewayClient } from '../../src/gateway/claude-agent-sdk-client.js';
import type { HarnessDescriptor } from '../../src/types.js';

async function* okSession() {
  yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } };
}

describe('declared skills reach the model through the SDK skill mechanism (#81/#83)', () => {
  let root: string;
  let workflowRoot: string;
  let workspace: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rwe-skill-exposure-'));
    workflowRoot = join(root, 'assets', 'wf');
    workspace = join(root, 'ws');
    mkdirSync(workspace, { recursive: true });
    for (const name of ['moonfish', 'decoy']) {
      mkdirSync(join(workflowRoot, 'skill', name), { recursive: true });
      writeFileSync(join(workflowRoot, 'skill', name, 'SKILL.md'), `---\nname: ${name}\ndescription: test\n---\n\nbody\n`);
    }
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  async function dispatch(skills: string[], allowedTools: string[] | undefined) {
    const queryImpl = vi.fn(() => okSession());
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:1', queryImpl: queryImpl as never });
    let descriptor: HarnessDescriptor | undefined;
    const result = await client.invoke({
      prompt: 'hi',
      opts: allowedTools !== undefined ? { allowedTools } : {},
      runId: 'r1',
      agentId: 'a1',
      workspace,
      assets: { roots: { workflow: workflowRoot, global: join(root, 'assets', 'global') }, declared: { skills, mcp: [] }, workflow: 'wf' },
      onHarness: async (h) => { descriptor = h; },
    });
    expect(result.ok).toBe(true);
    const options = (queryImpl.mock.calls[0] as unknown as [{ options: Record<string, unknown> }])[0].options;
    return { options, descriptor: descriptor! };
  }

  it('a skill-only agent (allowedTools: []) gets the Skill tool and exactly its declared skill — and no file tools', async () => {
    const { options } = await dispatch(['moonfish'], []);
    expect(options['tools']).toEqual(['Skill']);
    expect(options['skills']).toEqual(['moonfish']);
    // Declaring a skill must not grant Read/Edit/...; the SDK itself auto-approves `Skill(moonfish)`
    // from `Options.skills`, so the deprecated bare `Skill` never goes into allowedTools.
    expect(options['allowedTools']).toEqual([]);
  });

  it('an agent with file tools keeps them verbatim and gains only the Skill tool', async () => {
    const { options } = await dispatch(['moonfish'], ['Read']);
    expect(options['tools']).toEqual(['Read', 'Skill']);
    expect(options['allowedTools']).toEqual(['Read']);
    expect(options['skills']).toEqual(['moonfish']);
  });

  it('an undeclared skill on disk (and every CLI-bundled skill) is filtered out by Options.skills', async () => {
    const { options } = await dispatch(['moonfish'], []);
    // Unset `Options.skills` means "every discovered skill" to the CLI, so it must be an explicit list.
    expect(Array.isArray(options['skills']), 'Options.skills unset -> every discovered skill is activatable').toBe(true);
    expect(options['skills']).not.toContain('decoy');
  });

  it('no declared skills -> no Skill tool, and Options.skills is [] (a hand-added Skill tool activates nothing)', async () => {
    const plain = await dispatch([], ['Read']);
    expect(plain.options['tools']).toEqual(['Read']);
    expect(plain.options['skills']).toEqual([]);
    const handAdded = await dispatch([], ['Read', 'Skill']);
    expect(handAdded.options['skills']).toEqual([]);
  });

  it('a declared-but-absent skill is not exposed (only what was materialized can be activated)', async () => {
    const { options, descriptor } = await dispatch(['ghost'], []);
    expect(options['tools']).toEqual([]);
    expect(options['skills']).toEqual([]);
    expect(descriptor.skillsExposed).toEqual([]);
  });

  it("a skill's inline shell (!`cmd`) is disabled — activation never runs a command outside the tool surface", async () => {
    const { options } = await dispatch(['moonfish'], []);
    expect(options['settings']).toEqual({ disableSkillShellExecution: true });
  });

  it('the descriptor separates on-disk (materialized) from reachable-by-the-model (skillsExposed)', async () => {
    const { descriptor } = await dispatch(['moonfish', 'ghost'], []);
    expect(descriptor.materialized).toEqual({ skills: ['moonfish'], mcp: [], missing: ['ghost'] });
    expect(descriptor.skillsExposed).toEqual(['moonfish']);
    // The descriptor's tool list is what went on the wire.
    expect(descriptor.tools).toEqual(['Skill']);
  });
});
