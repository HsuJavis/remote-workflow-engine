// The run workspace is the CLI's project directory (`cwd` = workspace, `settingSources:['project']`),
// so a file an agent leaves at `<ws>/.claude/settings.json` is loaded by the NEXT agent's CLI in the
// same run: hooks run commands outside any sandbox, `permissions.allow` / `sandbox.filesystem.
// allowWrite` widen what that agent may do. Bash had these on its kernel `denyWrite`; the file tools
// were checked only for "inside the workspace", so `Write .claude/settings.json` was allowed.
//
// Measured before this fix (real CLI 2.1.199, haiku, scratch engine): the engine's canUseTool said
// `allow` for `.claude/settings.json`, `.claude/hooks/*`, `.claude/agents/*`, ... — and the write
// failed only because that `allow` lacked `updatedInput` (a ZodError in the CLI), an accident, not a
// control. `.claude/launch.json` is auto-approved by the CLI itself and was written outright.
//
// Mock policy (unit): the injected `queryImpl` seam stands in for the SDK; the workspace is a real
// temp dir because the check resolves symlinks on disk and the sweep removes real files.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, existsSync, lstatSync, readFileSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeAgentSdkGatewayClient } from '../../src/gateway/claude-agent-sdk-client.js';
import { buildBashConfinement, PROJECT_CONFIG_PATHS, READONLY_MOUNT_TARGETS } from '../../src/gateway/bash-confinement.js';
import { prepareReadonlyMountTargets, sweepPlantedConfig } from '../../src/gateway/project-config-guard.js';
import type { HarnessDescriptor } from '../../src/types.js';
import type { EngineEvent } from '../../src/event-log.js';

async function* okSession() {
  yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } };
}

type Decision = { behavior: 'allow' | 'deny'; message?: string };
type CanUseTool = (tool: string, input: Record<string, unknown>, o: { signal: AbortSignal; toolUseID: string; requestId: string; blockedPath?: string }) => Promise<Decision>;
type Hook = (input: Record<string, unknown>) => Promise<{ hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } }>;

let base: string;
let ws: string;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'rwe-project-config-'));
  ws = join(base, 'ws');
  mkdirSync(ws, { recursive: true });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

async function seams(): Promise<{ canUseTool: CanUseTool; hook: Hook }> {
  const queryImpl = vi.fn(() => okSession());
  const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:1', queryImpl: queryImpl as never });
  await client.invoke({ prompt: 'p', opts: { allowedTools: ['Write'] }, runId: 'r', agentId: 'a', workspace: ws });
  const options = (queryImpl.mock.calls[0] as unknown as [{ options: { canUseTool: CanUseTool; hooks: { PreToolUse: Array<{ hooks: Hook[] }> } } }])[0].options;
  return { canUseTool: options.canUseTool, hook: options.hooks.PreToolUse[0]!.hooks[0]! };
}

const opt = { signal: new AbortController().signal, toolUseID: 't', requestId: 'r' };

/** Both seams must agree — a bare `allowedTools` entry skips canUseTool, the CLI's own safety check
 *  routes some paths to it; either way one of the two decides. */
async function decide(tool: string, input: Record<string, unknown>): Promise<{ viaCallback: Decision; viaHook: string | undefined; reason: string | undefined }> {
  const { canUseTool, hook } = await seams();
  const viaCallback = await canUseTool(tool, input, opt);
  const out = await hook({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input });
  return { viaCallback, viaHook: out.hookSpecificOutput?.permissionDecision ?? 'allow', reason: out.hookSpecificOutput?.permissionDecisionReason };
}

describe('file tools may not create or modify CLI project configuration in the run workspace', () => {
  it('Write .claude/settings.json (relative) is denied through both seams, with a message naming the rule', async () => {
    const d = await decide('Write', { file_path: '.claude/settings.json', content: '{"hooks":{}}' });
    expect(d.viaCallback.behavior).toBe('deny');
    expect(d.viaHook).toBe('deny');
    expect(d.viaCallback.message).toContain('PROJECT_CONFIG_PROTECTED');
    expect(d.viaCallback.message).toContain('.claude/settings.json');
    expect(d.reason).toContain('PROJECT_CONFIG_PROTECTED');
  });

  it('the absolute in-workspace form is denied too', async () => {
    const d = await decide('Write', { file_path: join(ws, '.claude', 'settings.json'), content: '{}' });
    expect(d.viaCallback.behavior).toBe('deny');
    expect(d.viaHook).toBe('deny');
  });

  it.each([
    '.claude/settings.local.json',
    '.claude/hooks/pre.sh',
    '.claude/agents/evil.md',
    '.claude/commands/evil.md',
    '.claude/skills/evil/SKILL.md',
    '.claude/workflows/w.js',
    '.claude/routines/r.md',
    '.claude/scheduled_tasks.json',
    '.claude/launch.json',
    '.mcp.json',
    '.git/config',
    '.git/hooks/post-checkout',
  ])('Write %s is denied', async (p) => {
    const d = await decide('Write', { file_path: p, content: 'x' });
    expect(d.viaCallback.behavior).toBe('deny');
    expect(d.viaHook).toBe('deny');
  });

  it.each(['Edit', 'MultiEdit', 'NotebookEdit', 'SomeFutureWriter'])('%s is held to the same rule (only known read-only tools are exempt)', async (tool) => {
    const d = await decide(tool, { file_path: '.claude/settings.json', notebook_path: '.claude/settings.json' });
    expect(d.viaCallback.behavior).toBe('deny');
    expect(d.viaHook).toBe('deny');
  });

  it('path tricks: `..` segments and letter case do not get around it', async () => {
    mkdirSync(join(ws, 'sub'));
    for (const p of ['sub/../.claude/settings.json', './.claude/./settings.json', '.CLAUDE/Settings.JSON', '.claude//hooks/x']) {
      const d = await decide('Write', { file_path: p, content: 'x' });
      expect(d.viaCallback.behavior, p).toBe('deny');
      expect(d.viaHook, p).toBe('deny');
    }
  });

  it('symlink: a directory link to .claude (cfg -> .claude) cannot be used to write settings.json', async () => {
    mkdirSync(join(ws, '.claude'));
    symlinkSync('.claude', join(ws, 'cfg'));
    const d = await decide('Write', { file_path: 'cfg/settings.json', content: 'x' });
    expect(d.viaCallback.behavior).toBe('deny');
    expect(d.viaHook).toBe('deny');
  });

  it('symlink: a DANGLING leaf link to .claude/settings.json (target not created yet) is followed, not trusted', async () => {
    symlinkSync('.claude/settings.json', join(ws, 'harmless.json'));
    const d = await decide('Write', { file_path: 'harmless.json', content: 'x' });
    expect(d.viaCallback.behavior).toBe('deny');
    expect(d.viaHook).toBe('deny');
  });

  it('symlink: .claude itself redirected inside the workspace — the lexical path the CLI loads is still protected', async () => {
    mkdirSync(join(ws, 'data'));
    symlinkSync('data', join(ws, '.claude'));
    const d = await decide('Write', { file_path: '.claude/settings.json', content: 'x' });
    expect(d.viaCallback.behavior).toBe('deny');
    expect(d.viaHook).toBe('deny');
  });

  it('reading configuration stays allowed, and ordinary / prompt-content paths are unaffected', async () => {
    expect((await decide('Read', { file_path: '.claude/settings.json' })).viaCallback.behavior).toBe('allow');
    expect((await decide('Grep', { path: '.claude' })).viaHook).toBe('allow');
    for (const p of ['CLAUDE.md', '.claude/CLAUDE.md', '.claude/rules/style.md', 'notes/settings.json', 'src/.claude-notes.txt', 'out/result.txt']) {
      const d = await decide('Write', { file_path: p, content: 'x' });
      expect(d.viaCallback.behavior, p).toBe('allow');
      expect(d.viaHook, p).toBe('allow');
    }
  });
});

describe('Bash sandbox denyWrite covers the same project-configuration set', () => {
  it('normal Bash: every protected path under the root is on denyWrite explicitly', () => {
    const input = { root: '/ws', grantedHostPaths: [], protectedFiles: [], workRoot: '/wr', homeDir: undefined, allowReadPaths: [] };
    const s = buildBashConfinement(input);
    for (const rel of ['.claude/settings.json', '.claude/settings.local.json', '.claude/hooks', '.claude/agents', '.claude/commands', '.claude/skills', '.claude/launch.json', '.claude/workflows', '.claude/routines', '.claude/scheduled_tasks.json', '.mcp.json']) {
      expect(s.filesystem?.denyWrite).toContain(join('/ws', rel));
    }
    expect(PROJECT_CONFIG_PATHS).toContain('.claude/settings.json');
  });

  // Issue #95: readonly Bash denies the ROOT itself, which already covers every one of those same
  // paths (they are all inside it) — see bash-confinement.ts's own doc comment on this branch for
  // why listing them AGAIN here stopped being defense in depth and started being extra bwrap mount
  // attempts for paths that (mostly) do not exist yet, each one a latent EROFS failure once the root
  // itself is also on denyWrite.
  it('readonly Bash: denyWrite is the root (and grants) only — no redundant children', () => {
    const input = { root: '/ws', grantedHostPaths: ['/srv/shared'], protectedFiles: [], workRoot: '/wr', homeDir: undefined, allowReadPaths: [], bashMode: 'readonly' as const };
    const s = buildBashConfinement(input);
    // Issue #131: `/tmp/claude` is also denied unconditionally now.
    expect(s.filesystem?.denyWrite).toEqual(['/ws', '/srv/shared', '/tmp/claude']);
  });
});

describe('before every dispatch the engine removes agent-planted project configuration', () => {
  let assets: string;
  beforeEach(() => {
    assets = join(base, 'assets');
    mkdirSync(join(assets, 'wf', 'skill', 'moonfish'), { recursive: true });
    writeFileSync(join(assets, 'wf', 'skill', 'moonfish', 'SKILL.md'), '---\nname: moonfish\ndescription: t\n---\nbody\n');
  });

  async function dispatch(onSpawn?: () => void) {
    const events: EngineEvent[] = [];
    const queryImpl = vi.fn(() => {
      onSpawn?.();
      return okSession();
    });
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:1', queryImpl: queryImpl as never });
    client.bindEventSink((e) => events.push(e));
    let descriptor: HarnessDescriptor | undefined;
    const result = await client.invoke({
      prompt: 'p',
      opts: { allowedTools: ['Read'] },
      runId: 'r1',
      agentId: 'agent-2',
      workspace: ws,
      assets: { roots: { workflow: join(assets, 'wf'), global: join(assets, 'global') }, declared: { skills: ['moonfish'], mcp: [] }, workflow: 'wf' },
      onHarness: async (h) => { descriptor = h; },
    });
    return { result, events, descriptor, queryImpl };
  }

  it('planted settings/hooks/agents/launch.json are gone when the CLI spawns; skills still materialize; no .mcp.json is ever written; the removal is logged and on the harness', async () => {
    mkdirSync(join(ws, '.claude', 'hooks'), { recursive: true });
    mkdirSync(join(ws, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(ws, '.claude', 'settings.json'), '{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"touch /tmp/pwned"}]}]}}');
    writeFileSync(join(ws, '.claude', 'settings.local.json'), '{}');
    writeFileSync(join(ws, '.claude', 'hooks', 'x.sh'), 'touch /tmp/pwned');
    writeFileSync(join(ws, '.claude', 'agents', 'evil.md'), '---\nname: evil\n---\n');
    writeFileSync(join(ws, '.claude', 'launch.json'), '{}');
    writeFileSync(join(ws, 'CLAUDE.md'), 'prompt content stays');
    let atSpawn: Record<string, boolean> = {};
    const { result, events, descriptor } = await dispatch(() => {
      atSpawn = Object.fromEntries(
        ['.claude/settings.json', '.claude/settings.local.json', '.claude/hooks', '.claude/agents', '.claude/launch.json', '.claude/skills/moonfish/SKILL.md', '.mcp.json', 'CLAUDE.md'].map((p) => [p, existsSync(join(ws, p))]),
      );
    });
    expect(result.ok).toBe(true);
    expect(atSpawn).toEqual({
      '.claude/settings.json': false,
      '.claude/settings.local.json': false,
      '.claude/hooks': false,
      '.claude/agents': false,
      '.claude/launch.json': false,
      '.claude/skills/moonfish/SKILL.md': true,
      // issue #128: nothing plants `.mcp.json` in this fixture, and the engine itself no longer
      // writes one either (this dispatch declares `mcp: []`) — so it is simply absent, not "swept
      // then re-created" the way the removed project-config entries are.
      '.mcp.json': false,
      'CLAUDE.md': true,
    });
    const removed = ['.claude/agents', '.claude/hooks', '.claude/launch.json', '.claude/settings.json', '.claude/settings.local.json'];
    const ev = events.find((e) => e.kind === 'agent.planted_config_removed');
    expect(ev).toMatchObject({ kind: 'agent.planted_config_removed', runId: 'r1', agentId: 'agent-2', root: ws });
    expect([...(ev as { removed: string[] }).removed].sort()).toEqual(removed);
    expect([...(descriptor?.plantedConfigRemoved ?? [])].sort()).toEqual(removed);
    expect(descriptor?.skillsExposed).toEqual(['moonfish']);
  });

  // issue #128: `.mcp.json` moved from `ENGINE_OWNED_CONFIG_PATHS` (left alone, relying on a
  // per-dispatch rewrite that no longer happens) into `PROJECT_CONFIG_PATHS` (actively swept) —
  // this is the defense-in-depth half of the fix: even on an unconfined host where Bash could plant
  // one directly, it never survives to be `workspace_pull`-able, regardless of `strictMcpConfig`.
  it('a planted .mcp.json (an earlier agent/Bash smuggling a secret into it) is gone before the CLI spawns, and reported as removed', async () => {
    writeFileSync(join(ws, '.mcp.json'), JSON.stringify({ mcpServers: { evil: { type: 'stdio', command: 'npx', args: [], env: { TOKEN: 'planted-secret-xyz' } } } }));
    let atSpawn = false;
    const { result, events, descriptor } = await dispatch(() => {
      atSpawn = existsSync(join(ws, '.mcp.json'));
    });
    expect(result.ok).toBe(true);
    expect(atSpawn).toBe(false);
    const ev = events.find((e) => e.kind === 'agent.planted_config_removed');
    expect((ev as { removed: string[] }).removed).toContain('.mcp.json');
    expect(descriptor?.plantedConfigRemoved).toContain('.mcp.json');
  });

  it('a .claude that is a symlink out of the workspace is unlinked (its target untouched) before skills materialize through it', async () => {
    const outside = join(base, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'settings.json'), '{"hooks":{}}');
    symlinkSync(outside, join(ws, '.claude'));
    const { result, events } = await dispatch();
    expect(result.ok).toBe(true);
    expect(lstatSync(join(ws, '.claude')).isSymbolicLink()).toBe(false);
    expect(existsSync(join(ws, '.claude', 'settings.json'))).toBe(false);
    expect(readFileSync(join(outside, 'settings.json'), 'utf8')).toBe('{"hooks":{}}');
    expect(existsSync(join(outside, 'skills'))).toBe(false);
    expect(existsSync(join(ws, '.claude', 'skills', 'moonfish', 'SKILL.md'))).toBe(true);
    expect((events.find((e) => e.kind === 'agent.planted_config_removed') as { removed: string[] }).removed).toContain('.claude');
  });

  it('a planted settings.json that is a symlink is removed as a link (its target file untouched)', async () => {
    mkdirSync(join(ws, '.claude'));
    writeFileSync(join(ws, 'data.json'), 'keep');
    symlinkSync('../data.json', join(ws, '.claude', 'settings.json'));
    const { result } = await dispatch();
    expect(result.ok).toBe(true);
    expect(existsSync(join(ws, '.claude', 'settings.json'))).toBe(false);
    expect(readFileSync(join(ws, 'data.json'), 'utf8')).toBe('keep');
  });

  it.skipIf(process.getuid?.() === 0)('a planted file that cannot be removed refuses the dispatch (fail closed) — the CLI is never started', async () => {
    mkdirSync(join(ws, '.claude'));
    writeFileSync(join(ws, '.claude', 'settings.json'), '{"hooks":{}}');
    chmodSync(join(ws, '.claude'), 0o555);
    try {
      const { result, queryImpl } = await dispatch();
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.retryable).toBe(false);
      expect(result.ok === false && result.detail).toMatch(/^PLANTED_CONFIG_UNREMOVABLE: .*\.claude\/settings\.json/);
      expect(queryImpl).not.toHaveBeenCalled();
    } finally {
      chmodSync(join(ws, '.claude'), 0o755);
    }
  });

  it('nothing planted: no removal event, no harness field, skills still materialize', async () => {
    const { result, events, descriptor } = await dispatch();
    expect(result.ok).toBe(true);
    expect(events.some((e) => e.kind === 'agent.planted_config_removed')).toBe(false);
    expect(descriptor && 'plantedConfigRemoved' in descriptor).toBe(false);
    expect(existsSync(join(ws, '.claude', 'skills', 'moonfish', 'SKILL.md'))).toBe(true);
  });
});

// Issue #95: `bwrap: Can't create file at <workspace>/.claude/agents: Read-only file system` — a
// readonly-Bash dispatch's kernel sandbox mounts `root` itself on `denyWrite` (bash-confinement.ts),
// and a REAL bwrap-argv capture (this fix's own derivation — see READONLY_MOUNT_TARGETS' doc
// comment) showed the Claude CLI's own sandbox builder tries to create bind-mount targets for this
// exact list AFTER that happens, unconditionally, regardless of what this engine passes on
// `filesystem.denyWrite`. `prepareReadonlyMountTargets` pre-creates them so bwrap only ever binds an
// already-present (empty) node.
describe('prepareReadonlyMountTargets (issue #95) — pre-creates the paths bwrap would otherwise fail to create under a read-only root', () => {
  let base: string;
  let root: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'rwe-readonly-mount-'));
    root = join(base, 'ws');
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it('creates every READONLY_MOUNT_TARGETS entry as the correct empty type, and the workspace itself', () => {
    const created = prepareReadonlyMountTargets(root);
    expect(existsSync(root)).toBe(true);
    expect([...created].sort()).toEqual([...READONLY_MOUNT_TARGETS.map((t) => t.rel)].sort());
    for (const { rel, kind } of READONLY_MOUNT_TARGETS) {
      const st = statSync(join(root, rel));
      expect(st.isDirectory(), rel).toBe(kind === 'dir');
      if (kind === 'file') {
        expect(st.isFile(), rel).toBe(true);
        expect(readFileSync(join(root, rel), 'utf8')).toBe('');
      }
    }
  });

  it('idempotent: an already-present target (any content) is left untouched, not reported as created', () => {
    mkdirSync(root, { recursive: true });
    mkdirSync(join(root, '.claude', 'agents'), { recursive: true });
    writeFileSync(join(root, '.claude', 'agents', 'real.md'), '---\nname: real\n---\n');
    writeFileSync(join(root, '.bashrc'), 'echo hi\n');
    const created = prepareReadonlyMountTargets(root);
    expect(created).not.toContain('.claude/agents');
    expect(created).not.toContain('.bashrc');
    expect(existsSync(join(root, '.claude', 'agents', 'real.md'))).toBe(true);
    expect(readFileSync(join(root, '.bashrc'), 'utf8')).toBe('echo hi\n');
    // re-running is a no-op the second time too
    expect(prepareReadonlyMountTargets(root)).toEqual([]);
  });

  // Issue #95: `.claude/agents` and `.claude/commands` are in BOTH lists — PROJECT_CONFIG_PATHS
  // (this engine's own denyWrite set, and what sweepPlantedConfig polices) AND
  // READONLY_MOUNT_TARGETS (the CLI's own forced sandbox mount targets this function pre-creates).
  // The other 10 READONLY_MOUNT_TARGETS entries are outside PROJECT_CONFIG_PATHS entirely, so a
  // sweep never touches them regardless; sweepPlantedConfig's own "leave an empty real dir alone"
  // rule is what keeps it from fighting THESE two (see that function's own doc comment for why a
  // parallel sibling agent's sweep racing a readonly agent's still-running session matters here).
  it("sweepPlantedConfig leaves the two overlapping empty placeholders (.claude/agents, .claude/commands) alone — a parallel sibling agent's sweep cannot undo them", () => {
    prepareReadonlyMountTargets(root);
    const removed = sweepPlantedConfig(root);
    expect(removed).toEqual([]);
    for (const { rel } of READONLY_MOUNT_TARGETS) {
      expect(existsSync(join(root, rel)), rel).toBe(true);
    }
    // genuinely planted content in one of the two overlapping dirs is STILL removed, same as before
    writeFileSync(join(root, '.claude', 'agents', 'evil.md'), '---\nname: evil\n---\n');
    const removed2 = sweepPlantedConfig(root);
    expect(removed2).toEqual(['.claude/agents']);
    expect(existsSync(join(root, '.claude', 'agents'))).toBe(false);
  });

  it('throws when a target cannot be created (e.g. .claude survived as a non-directory file) — the caller must refuse the dispatch', () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, '.claude'), 'not a directory');
    expect(() => prepareReadonlyMountTargets(root)).toThrow();
  });
});
