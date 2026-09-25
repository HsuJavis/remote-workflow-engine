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
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  it("bashMode:'readonly' ⇒ allowWrite is [] and denyWrite covers the root and every grant; reads are unchanged", () => {
    const rw = buildBashConfinement({ root: ROOT, grantedHostPaths: [GRANT], protectedFiles: [], workRoot: WORKROOT, denyReadMode: 'enumerated' });
    const ro = buildBashConfinement({ root: ROOT, grantedHostPaths: [GRANT], protectedFiles: [], workRoot: WORKROOT, denyReadMode: 'enumerated', bashMode: 'readonly' });
    expect(ro.enabled).toBe(true);
    expect(ro.failIfUnavailable).toBe(true);
    expect(ro.allowUnsandboxedCommands).toBe(false);
    expect(ro.filesystem?.allowWrite).toEqual([]);
    expect(ro.filesystem?.denyWrite).toEqual(expect.arrayContaining([ROOT, GRANT]));
    // the two settings files stay named explicitly — the root covers them, but the posture must
    // never be LESS explicit than the writable one it replaces
    expect(ro.filesystem?.denyWrite).toEqual(expect.arrayContaining([join(ROOT, '.claude', 'settings.json'), join(ROOT, '.claude', 'settings.local.json')]));
    expect(ro.filesystem?.allowRead).toEqual(rw.filesystem?.allowRead);
    expect(ro.filesystem?.denyRead).toEqual(rw.filesystem?.denyRead);
  });

  it('no bashMode ⇒ byte-identical to before (the writable posture is untouched)', () => {
    const a = buildBashConfinement({ root: ROOT, grantedHostPaths: [GRANT], protectedFiles: [], workRoot: WORKROOT, denyReadMode: 'enumerated' });
    expect(a.filesystem?.allowWrite).toEqual([ROOT, GRANT]);
    expect(a.filesystem?.denyWrite).toEqual(['.claude/settings.json', '.claude/settings.local.json', '.claude/hooks', '.claude/agents', '.claude/commands', '.claude/workflows', '.claude/routines', '.claude/scheduled_tasks.json', '.claude/launch.json', '.claude/skills', '.mcp.json'].map((rel) => join(ROOT, rel)));
  });
});

describe('#78(c) SDK gateway — readonly Bash is enforced or refused, never downgraded', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockImplementation(() => okSession());
  });

  async function invoke(cfg: Record<string, unknown>, opts: AgentOpts) {
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000', ...cfg } as any);
    const descriptors: HarnessDescriptor[] = [];
    const result = await client.invoke({
      prompt: 'ping', opts, runId: 'run-1', agentId: 'agent-1', workspace: ROOT,
      onHarness: async (h) => { descriptors.push(h); },
    });
    return { result, descriptors };
  }

  it('confined host: the readonly posture (buildBashConfinement with bashMode) is what query() receives', async () => {
    const confinement = { allowHostPaths: [GRANT], protectedFiles: [], workRoot: WORKROOT };
    const { result, descriptors } = await invoke({ confinementPosture: 'confined', confinement }, { allowedTools: ['Bash', 'Read'], bash: 'readonly' });
    expect(result.ok).toBe(true);
    const [[call]] = queryMock.mock.calls as [[{ options: { sandbox?: unknown; tools?: string[] } }]];
    expect(call.options.sandbox).toEqual(
      buildBashConfinement({ root: ROOT, grantedHostPaths: [GRANT], protectedFiles: [], workRoot: WORKROOT, denyReadMode: 'enumerated', bashMode: 'readonly' }),
    );
    expect((call.options.sandbox as { filesystem: { allowWrite: string[] } }).filesystem.allowWrite).toEqual([]);
    expect(call.options.tools).toEqual(['Bash', 'Read']);
    expect(descriptors[0]?.bash).toEqual({ mode: 'readonly', enforced: true });
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
