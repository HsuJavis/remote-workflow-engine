// Issue #78(c) — `agent('clerk', { allowedTools: ['Bash', 'Read'], bash: 'readonly' })`: a shell
// that can run commands but write nothing. Enforcement is the kernel sandbox, never a prompt or a
// name list, so this file pins the two halves that decide it:
//  1. buildBashConfinement({bashMode:'readonly'}) — allowWrite:[] AND the root on denyWrite. The CLI
//     (2.1.199, its settings→sandbox builder) ALWAYS seeds its write list with "." (the session cwd)
//     plus its own per-uid scratch dir before merging `allowWrite`, so an empty allowWrite alone
//     would still leave the workspace writable; denyWrite is the only field that takes it back.
//  2. the SDK gateway — confined host: that posture reaches `query()`; UNCONFINED host (this one):
//     the call fails closed, typed, and `query()` is never spawned. Never a silent writable shell.
// Mock policy (unit): vi.mock intercepts only the third-party SDK module (bash-confinement-wiring's
// convention).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentOpts, HarnessDescriptor } from '../../src/types.js';
import { buildBashConfinement } from '../../src/gateway/bash-confinement.js';

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: queryMock }));

function okSession(): AsyncGenerator<unknown> {
  return (async function* () {
    yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 } };
  })();
}

const WORKROOT = '/var/lib/rwe-data';
const ROOT = `${WORKROOT}/workflows/wf/runs/run-1`;
const GRANT = '/srv/shared-cache';

describe('#78(c) buildBashConfinement — readonly posture', () => {
  it("bashMode:'readonly' ⇒ allowWrite is [] and denyWrite is EXACTLY the root and every grant; reads are unchanged", () => {
    const rw = buildBashConfinement({ root: ROOT, grantedHostPaths: [GRANT], protectedFiles: [], workRoot: WORKROOT, homeDir: undefined, allowReadPaths: [] });
    const ro = buildBashConfinement({ root: ROOT, grantedHostPaths: [GRANT], protectedFiles: [], workRoot: WORKROOT, homeDir: undefined, allowReadPaths: [], bashMode: 'readonly' });
    expect(ro.enabled).toBe(true);
    expect(ro.failIfUnavailable).toBe(true);
    expect(ro.allowUnsandboxedCommands).toBe(false);
    expect(ro.filesystem?.allowWrite).toEqual([]);
    // Issue #95: no `.claude/settings.json`-style entries alongside the root any more — `root` on
    // its own already denies every one of them (they are inside it), and a real bwrap-argv capture
    // showed the CLI processes `root`'s own `--ro-bind` before it reaches any of those still-missing
    // children, so keeping them here bought no extra safety, only extra "Read-only file system"
    // failure points (bash-confinement.ts's own doc comment on this branch has the measurement).
    expect(ro.filesystem?.denyWrite).toEqual([ROOT, GRANT]);
    expect(ro.filesystem?.allowRead).toEqual(rw.filesystem?.allowRead);
    expect(ro.filesystem?.denyRead).toEqual(rw.filesystem?.denyRead);
  });

  it('no bashMode ⇒ byte-identical to before (the writable posture is untouched)', () => {
    const a = buildBashConfinement({ root: ROOT, grantedHostPaths: [GRANT], protectedFiles: [], workRoot: WORKROOT, homeDir: undefined, allowReadPaths: [] });
    expect(a.filesystem?.allowWrite).toEqual([ROOT, GRANT]);
    // issue #128: `.mcp.json` moved from ENGINE_OWNED_CONFIG_PATHS into PROJECT_CONFIG_PATHS (see
    // bash-confinement.test.ts) — same membership, now ahead of `.claude/skills`.
    expect(a.filesystem?.denyWrite).toEqual(['.claude/settings.json', '.claude/settings.local.json', '.claude/hooks', '.claude/agents', '.claude/commands', '.claude/workflows', '.claude/routines', '.claude/scheduled_tasks.json', '.claude/launch.json', '.mcp.json', '.claude/skills'].map((rel) => join(ROOT, rel)));
  });
});

describe('#78(c) SDK gateway — readonly Bash is enforced or refused, never downgraded', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockImplementation(() => okSession());
  });

  async function invoke(cfg: Record<string, unknown>, opts: AgentOpts, workspace: string = ROOT) {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000', ...cfg } as any);
    const descriptors: HarnessDescriptor[] = [];
    const result = await client.invoke({
      prompt: 'ping', opts, runId: 'run-1', agentId: 'agent-1', workspace,
      onHarness: async (h) => { descriptors.push(h); },
    });
    return { result, descriptors };
  }

  // Issue #95: this is the ONE case in this file that actually reaches
  // `prepareReadonlyMountTargets` (every other case is refused before it, by a bad bash value, a
  // write-tool conflict, or an unconfined/unmeasured posture) — it needs a REAL, writable directory
  // to pre-create the CLI's own mount targets under, not the fictional `/var/lib/rwe-data/...` every
  // other case in this file uses (queryMock never touches the filesystem, but this new step does).
  describe('confined + readonly: the one case that pre-creates real mount targets', () => {
    // `findProjectMarkerAboveWorkspace`'s re-walk (v37, ARCH-180) refuses WORKROOT_INSIDE_PROJECT
    // for a workspace outside its own `workRoot` — a real temp dir needs a real `workRoot` ANCESTOR
    // of it, not the fictional `/var/lib/rwe-data` every other case in this file uses.
    let realWorkRoot: string;
    let realRoot: string;
    beforeEach(() => {
      realWorkRoot = mkdtempSync(join(tmpdir(), 'rwe-readonly-gateway-'));
      realRoot = join(realWorkRoot, 'workflows', 'wf', 'runs', 'run-1');
    });
    afterEach(() => rmSync(realWorkRoot, { recursive: true, force: true }));

    it('confined host: the readonly posture (buildBashConfinement with bashMode) is what query() receives', async () => {
      const confinement = { allowHostPaths: [GRANT], protectedFiles: [], workRoot: realWorkRoot };
      const { result, descriptors } = await invoke({ confinementPosture: 'confined', confinement }, { allowedTools: ['Bash', 'Read'], bash: 'readonly' }, realRoot);
      expect(result.ok).toBe(true);
      const [[call]] = queryMock.mock.calls as [[{ options: { sandbox?: unknown; tools?: string[] } }]];
      expect(call.options.sandbox).toEqual(
        buildBashConfinement({ root: realRoot, grantedHostPaths: [GRANT], protectedFiles: [], workRoot: realWorkRoot, homeDir: process.env['HOME'], allowReadPaths: [], bashMode: 'readonly', sharedCliScratch: join(tmpdir(), `claude-${process.getuid!()}`) }),
      );
      expect((call.options.sandbox as { filesystem: { allowWrite: string[] } }).filesystem.allowWrite).toEqual([]);
      expect(call.options.tools).toEqual(['Bash', 'Read']);
      expect(descriptors[0]?.bash).toEqual({ mode: 'readonly', enforced: true });
    });

    it('sandbox mount-target prep failure refuses the dispatch typed, before query() — never a lying harness.bash.enforced:true', async () => {
      // `.claude` surviving as a non-directory file (e.g. a sweep that could not fully clean up,
      // or a host permission problem) means `prepareReadonlyMountTargets` cannot create
      // `.claude/agents`/`.claude/commands` under it — the dispatch must refuse rather than either
      // crash mid-session or emit `harness.bash.enforced:true` for a sandbox that was never set up.
      mkdirSync(realRoot, { recursive: true });
      writeFileSync(join(realRoot, '.claude'), 'not a directory');
      const confinement = { allowHostPaths: [], protectedFiles: [], workRoot: realWorkRoot };
      const { result, descriptors } = await invoke({ confinementPosture: 'confined', confinement }, { allowedTools: ['Bash'], bash: 'readonly' }, realRoot);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('terminal');
      expect(result.retryable).toBe(false);
      expect(result.detail).toMatch(/^BASH_READONLY_SANDBOX_PREP_FAILED: /);
      expect(queryMock).not.toHaveBeenCalled();
      expect(descriptors).toHaveLength(0);
    });
  });

  for (const [name, cfg] of [['unconfined (measured)', { confinementPosture: 'unconfined' }], ['posture never measured (default)', {}]] as const) {
    it(`${name}: readonly Bash fails closed — typed terminal, not retryable, query() never spawned`, async () => {
      const { result, descriptors } = await invoke(cfg, { allowedTools: ['Bash', 'Read', 'Grep', 'Glob'], bash: 'readonly' });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe('terminal');
      expect(result.retryable).toBe(false);
      expect(result.detail).toMatch(/^BASH_READONLY_UNENFORCEABLE: /);
      expect(result.detail).toContain('no working Bash sandbox');
      expect(queryMock).not.toHaveBeenCalled();
      expect(descriptors).toHaveLength(0);
    });
  }

  it('readonly beside Write/Edit/NotebookEdit — or with no allowedTools (the default surface writes) — is refused even when confined', async () => {
    const cases: AgentOpts[] = [
      { allowedTools: ['Bash', 'Write'], bash: 'readonly' },
      { allowedTools: ['Bash', 'Edit'], bash: 'readonly' },
      { allowedTools: ['Bash', 'NotebookEdit'], bash: 'readonly' },
      { bash: 'readonly' },
    ];
    for (const opts of cases) {
      const { result } = await invoke({ confinementPosture: 'confined' }, opts);
      expect(result.ok, JSON.stringify(opts)).toBe(false);
      if (!result.ok) expect(result.detail, JSON.stringify(opts)).toMatch(/^BASH_READONLY_CONFLICT: /);
    }
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("an unknown bash value (a runtime-computed typo) is refused, never read as 'full'", async () => {
    const { result } = await invoke({ confinementPosture: 'confined' }, { allowedTools: ['Bash'], bash: 'read-only' as 'readonly' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toMatch(/^BASH_MODE_INVALID: /);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("normal Bash is unchanged: descriptor records mode 'full', enforced only when the host is confined", async () => {
    const confined = await invoke({ confinementPosture: 'confined' }, { allowedTools: ['Bash'] });
    expect(confined.result.ok).toBe(true);
    expect(confined.descriptors[0]?.bash).toEqual({ mode: 'full', enforced: true });
    const unconfined = await invoke({ confinementPosture: 'unconfined' }, { allowedTools: ['Bash'] });
    expect(unconfined.result.ok).toBe(true);
    expect(unconfined.descriptors[0]?.bash).toEqual({ mode: 'full', enforced: false });
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('no Bash on the wire ⇒ no bash record at all', async () => {
    const { descriptors } = await invoke({ confinementPosture: 'unconfined' }, { allowedTools: ['Read'] });
    expect(descriptors[0] && 'bash' in descriptors[0]).toBe(false);
  });
});
