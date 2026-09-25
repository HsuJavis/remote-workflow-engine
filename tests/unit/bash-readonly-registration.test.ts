// Issue #78(c) — the registration half of `bash: 'readonly'`: a declaration that reads as "this agent
// writes nothing" must either be true or be refused where the author can still fix it.
//  - refused (SCAN_VIOLATION) when the same literal tool list also grants Write/Edit/NotebookEdit,
//    names no list at all (the deployment default carries Write/Edit), names no Bash (a dead
//    declaration), or the value is anything but the literal 'readonly';
//  - the intended clerk shape (Bash + Read/Grep/Glob, readonly) trips no BASH_SUBSUMES_FILE_TOOLS;
//  - on a host whose boot probe found no working sandbox, registration still succeeds but warns
//    BASH_READONLY_UNENFORCEABLE (posture is a boot-time host fact; dispatch is the enforcing door);
//  - `meta.params.agents.<label>.bash` is refused rather than silently ignored; `bash` is locked.
// Mock policy (unit): a REAL WorkflowCatalog on a tmp sqlite through a REAL RunManager/McpFacade.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/clock.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade } from '../../src/mcp-facade.js';
import { TOOL_SPECS } from '../../src/tool-specs.js';
import { buildAuthoringGuide } from '../../src/authoring-guide.js';
import { LOCKED_KEYS, DEFAULT_CEILINGS } from '../../src/params/contract.js';
import type { Principal } from '../../src/authz.js';

const CLOCK = new FixedClock(new Date('2026-09-25T10:00:00.000Z'));
const OPEN: Principal = { kind: 'auth-disabled' };

const AGENT_DECL =
  "model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 }";

function script(opts: string, extraDecl = ''): string {
  return (
    `export const meta = { description: 'd', params: { agents: { a: { ${AGENT_DECL}${extraDecl} } } } };\n` +
    "phase('P');\n" +
    `return await agent('a', { prompt: 'p'${opts} });`
  );
}
function mermaid(tools: string[] | null): string {
  const seg = tools === null ? '' : `<br/>tools: ${tools.length === 0 ? 'none' : [...tools].sort().join(', ')}`;
  return `graph LR\nsubgraph "P"\na(["a<br/>default · low · 60000${seg}"])\nend`;
}

type Reply = { status?: string; code?: string; error?: { code?: string; message?: string; detail?: Record<string, unknown> }; result?: { version?: string; warnings?: Array<{ code: string; label: string; message: string }> } };

let workRoot: string;
function facadeWith(posture?: 'confined' | 'unconfined'): McpFacade {
  const catalog = new WorkflowCatalog(workRoot, CLOCK);
  return new McpFacade({ runManager: new RunManager({ catalog, clock: CLOCK }), clock: CLOCK, ...(posture ? { confinementPosture: posture } : {}) });
}
beforeEach(() => { workRoot = mkdtempSync(join(tmpdir(), 'rwe-78c-')); });
afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

async function register(f: McpFacade, name: string, opts: string, tools: string[] | null, extraDecl = ''): Promise<Reply> {
  return (await f.workflowRegister({ name, script: script(opts, extraDecl), mermaid: mermaid(tools) }, OPEN)) as Reply;
}

const CLERK = ['Bash', 'Read', 'Grep', 'Glob'];
const CLERK_OPTS = ", allowedTools: ['Bash', 'Read', 'Grep', 'Glob'], bash: 'readonly'";

describe('#78(c) registration — readonly Bash', () => {
  it('confined host: the clerk shape registers with NO warnings (BASH_SUBSUMES_FILE_TOOLS does not fire for readonly)', async () => {
    const r = await register(facadeWith('confined'), 'clerk', CLERK_OPTS, CLERK);
    expect(r.error, JSON.stringify(r.error)).toBeUndefined();
    expect(r.result?.version).toBe('v1');
    expect(r.result && 'warnings' in r.result).toBe(false);
  });

  it('the same list WITHOUT readonly still warns BASH_SUBSUMES_FILE_TOOLS (#78(b) unchanged)', async () => {
    const r = await register(facadeWith('confined'), 'plain', ", allowedTools: ['Bash', 'Read', 'Grep', 'Glob']", CLERK);
    expect(r.result?.warnings?.map((w) => w.code)).toEqual(['BASH_SUBSUMES_FILE_TOOLS']);
  });

  for (const posture of ['unconfined', undefined] as const) {
    it(`host posture ${String(posture)}: registers, but warns BASH_READONLY_UNENFORCEABLE naming the label`, async () => {
      const r = await register(facadeWith(posture), 'clerk', CLERK_OPTS, CLERK);
      expect(r.result?.version).toBe('v1');
      expect(r.result?.warnings).toHaveLength(1);
      const w = r.result!.warnings![0]!;
      expect(w.code).toBe('BASH_READONLY_UNENFORCEABLE');
      expect(w.label).toBe('a');
      expect(w.message).toContain('fail');
    });
  }

  const refusals: Array<[string, string, string[] | null]> = [
    ['beside Write', ", allowedTools: ['Bash', 'Read', 'Write'], bash: 'readonly'", ['Bash', 'Read', 'Write']],
    ['beside Edit', ", allowedTools: ['Bash', 'Edit'], bash: 'readonly'", ['Bash', 'Edit']],
    ['beside NotebookEdit', ", allowedTools: ['Bash', 'NotebookEdit'], bash: 'readonly'", ['Bash', 'NotebookEdit']],
    ['with no allowedTools (the deployment default writes)', ", bash: 'readonly'", null],
    ['without Bash in the list (a dead declaration)', ", allowedTools: ['Read'], bash: 'readonly'", ['Read']],
  ];
  for (const [what, opts, tools] of refusals) {
    it(`readonly ${what} is REFUSED at registration (SCAN_VIOLATION / BASH_READONLY_CONFLICT)`, async () => {
      const r = await register(facadeWith('confined'), 'x', opts, tools);
      expect(r.result?.version).toBeUndefined();
      expect(r.code).toBe('SCAN_VIOLATION');
      expect(r.error?.detail?.['violation']).toBe('BASH_READONLY_CONFLICT');
    });
  }

  for (const v of ["'read-only'", "'full'", 'mode', 'true']) {
    it(`bash: ${v} (not the literal 'readonly') is refused BASH_MODE_INVALID`, async () => {
      const r = await register(facadeWith('confined'), 'x', `, allowedTools: ['Bash'], bash: ${v}`, ['Bash']);
      expect(r.code).toBe('SCAN_VIOLATION');
      expect(r.error?.detail?.['violation']).toBe('BASH_MODE_INVALID');
    });
  }

  it("meta.params.agents.<label>.bash is refused (PARAM_CONTRACT_INVALID) — never silently ignored", async () => {
    const r = await register(facadeWith('confined'), 'x', ", allowedTools: ['Bash']", ['Bash'], ", bash: 'readonly'");
    expect(r.code).toBe('PARAM_CONTRACT_INVALID');
    expect(r.error?.message).toContain('agent()');
  });

  it('bash is an author-locked key (a run_start override cannot flip it)', () => {
    expect(LOCKED_KEYS).toContain('bash');
  });

  it("workflow_register's description names the new warning", () => {
    expect(TOOL_SPECS.find((s) => s.name === 'workflow_register')!.description).toContain('BASH_READONLY_UNENFORCEABLE');
  });
});

describe('#78(c) authoring guide', () => {
  for (const posture of ['confined', 'unconfined', undefined] as const) {
    it(`documents the mode, its enforcement and the unconfined-host refusal (posture ${String(posture)})`, () => {
      const g = buildAuthoringGuide({ ...DEFAULT_CEILINGS, aliases: ['default'], runConcurrency: 4, ...(posture ? { confinementPosture: posture } : {}) });
      expect(g).toContain("bash: 'readonly'");
      expect(g).toContain('BASH_READONLY_UNENFORCEABLE');
      expect(g).toContain('BASH_READONLY_CONFLICT');
      expect(g).toMatch(/fails closed/);
    });
  }
});
