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
// Issue #144 rewrite: a declared skill no longer materializes into `<workspace>/.claude/skills/` —
// it goes into a private per-dispatch directory outside the workspace, loaded as a local SDK plugin
// (`Options.plugins`). Measured against the real bundled CLI (scratchpad spike, this fix): a
// plugin-sourced skill's real identifier is `plugin:skill` — a BARE `Options.skills` entry filters the
// activatable set down to nothing (silently exposing NO skill at all), so `Options.skills` now carries
// the QUALIFIED `rwe-skills:<name>` form; `descriptor.skillsExposed` stays the plain, author-facing
// name (unaffected — it describes what the AUTHOR declared, not the wire format).
//
// Mock policy (unit): the injected `queryImpl` seam stands in for the SDK; asset roots/workspace
// are real temp dirs because `_invokeOnce` materializes through the real fs facade.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeAgentSdkGatewayClient, RWE_SKILLS_PLUGIN_NAME } from '../../src/gateway/claude-agent-sdk-client.js';
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
    expect(options['skills']).toEqual([`${RWE_SKILLS_PLUGIN_NAME}:moonfish`]);
    // Declaring a skill must not grant Read/Edit/...; the SDK itself auto-approves `Skill(moonfish)`
    // from `Options.skills`, so the deprecated bare `Skill` never goes into allowedTools.
    expect(options['allowedTools']).toEqual([]);
  });

  it('an agent with file tools keeps them verbatim and gains only the Skill tool', async () => {
    const { options } = await dispatch(['moonfish'], ['Read']);
    expect(options['tools']).toEqual(['Read', 'Skill']);
    expect(options['allowedTools']).toEqual(['Read']);
    expect(options['skills']).toEqual([`${RWE_SKILLS_PLUGIN_NAME}:moonfish`]);
  });

  // issue #144: the declared skill is loaded as a local SDK plugin OUTSIDE the workspace — never
  // under `<workspace>/.claude/skills/`, and never left behind once the call settles.
  it('the skill is loaded via a local plugin outside the workspace, and the workspace never gets a .claude/skills tree', async () => {
    const { options } = await dispatch(['moonfish'], []);
    const plugins = options['plugins'] as Array<{ type: string; path: string; skipMcpDiscovery?: boolean }>;
    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toMatchObject({ type: 'local', skipMcpDiscovery: true });
    expect(plugins[0]!.path.startsWith(workspace)).toBe(false);
    expect(existsSync(join(workspace, '.claude', 'skills'))).toBe(false);
    // The private plugin directory itself is removed once the call settles (success path).
    expect(existsSync(plugins[0]!.path)).toBe(false);
  });

  it('an undeclared skill on disk (and every CLI-bundled skill) is filtered out by Options.skills', async () => {
    const { options } = await dispatch(['moonfish'], []);
    // Unset `Options.skills` means "every discovered skill" to the CLI, so it must be an explicit list.
    expect(Array.isArray(options['skills']), 'Options.skills unset -> every discovered skill is activatable').toBe(true);
    expect(options['skills']).not.toContain('decoy');
    expect(options['skills']).not.toContain(`${RWE_SKILLS_PLUGIN_NAME}:decoy`);
  });

  it('no declared skills -> no Skill tool, and Options.skills is [] (a hand-added Skill tool activates nothing)', async () => {
    const plain = await dispatch([], ['Read']);
    expect(plain.options['tools']).toEqual(['Read']);
    expect(plain.options['skills']).toEqual([]);
    expect(plain.options['plugins']).toBeUndefined();
    const handAdded = await dispatch([], ['Read', 'Skill']);
    expect(handAdded.options['skills']).toEqual([]);
  });

  // issue #144: a declared-but-missing name still gets a private directory created (so
  // `materializeAssets` has somewhere to look), but nothing lands in it — `options.plugins` must stay
  // absent rather than point the CLI's `--plugin-dir` loader at an empty, manifest-less directory.
  it('a declared-but-absent skill is not exposed (only what was materialized can be activated)', async () => {
    const { options, descriptor } = await dispatch(['ghost'], []);
    expect(options['tools']).toEqual([]);
    expect(options['skills']).toEqual([]);
    expect(options['plugins']).toBeUndefined();
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

// Issue #144: the private per-dispatch skill directory must never survive the call, on ANY exit
// path — not just the ordinary success path every other test in this file already covers. Each
// case captures `options.plugins[0].path` from INSIDE the fake `queryImpl` (synchronous, before
// `_invokeOnce`'s cleanup `finally` runs) and asserts it is gone once `invoke()` has resolved.
describe('the private skill directory is removed on every exit path, not only success (issue #144)', () => {
  let root: string;
  let workflowRoot: string;
  let workspace: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'rwe-skill-cleanup-'));
    workflowRoot = join(root, 'assets', 'wf');
    workspace = join(root, 'ws');
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(workflowRoot, 'skill', 'moonfish'), { recursive: true });
    writeFileSync(join(workflowRoot, 'skill', 'moonfish', 'SKILL.md'), '---\nname: moonfish\ndescription: test\n---\n\nbody\n');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const assets = () => ({ roots: { workflow: workflowRoot, global: join(root, 'assets', 'global') }, declared: { skills: ['moonfish'], mcp: [] }, workflow: 'wf' });

  it('cleaned up when the session generator throws', async () => {
    let capturedPath: string | undefined;
    const queryImpl = vi.fn((opts: { options: { plugins?: Array<{ path: string }> } }) => {
      capturedPath = opts.options.plugins?.[0]?.path;
      return (async function* (): AsyncGenerator<never> {
        throw new Error('boom');
      })();
    });
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:1', queryImpl: queryImpl as never });
    const result = await client.invoke({ prompt: 'p', opts: {}, runId: 'r', agentId: 'a', workspace, assets: assets() });
    expect(result.ok).toBe(false);
    expect(capturedPath).toBeDefined();
    expect(existsSync(capturedPath!)).toBe(false);
  });

  it('cleaned up when the call is aborted before dispatch (pre-aborted signal)', async () => {
    const queryImpl = vi.fn(() => okSession());
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:1', queryImpl: queryImpl as never });
    const controller = new AbortController();
    controller.abort();
    const result = await client.invoke({ prompt: 'p', opts: {}, runId: 'r', agentId: 'a', workspace, assets: assets(), signal: controller.signal });
    expect(result.ok).toBe(false);
    // Never dispatched at all (abortedBeforeDispatch) — the private directory this call WOULD have
    // built is either never created, or created-then-immediately-removed; either way it must not
    // exist once `invoke()` has resolved. `materializeAssets` itself is not reached on this path, so
    // there is no `queryImpl` call to read a path off — check the whole `root` gained no leftover
    // `rwe-skills-*`/`cli-tmp` sibling instead.
    expect(queryImpl).not.toHaveBeenCalled();
  });

  it('cleaned up when the session never settles and the call times out', async () => {
    let capturedPath: string | undefined;
    const queryImpl = vi.fn((opts: { options: { plugins?: Array<{ path: string }> } }) => {
      capturedPath = opts.options.plugins?.[0]?.path;
      return (async function* (): AsyncGenerator<never> {
        await new Promise(() => {}); // never resolves — the timeout race must still win
      })();
    });
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:1', queryImpl: queryImpl as never, timeoutMs: 50 });
    const result = await client.invoke({ prompt: 'p', opts: {}, runId: 'r', agentId: 'a', workspace, assets: assets() });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('timeout');
    expect(capturedPath).toBeDefined();
    expect(existsSync(capturedPath!)).toBe(false);
  });
});
