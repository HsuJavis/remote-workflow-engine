// Issue #78 (b): `allowedTools` restricts tool NAMES, and Bash can read/write/search anything
// Read/Write/Edit/Grep/Glob can (reproduced: `allowedTools:['Bash']` wrote a file). A list naming
// Bash together with any of those five therefore LOOKS narrower than it is. `workflow_register`
// now answers such a registration with a non-fatal `result.warnings` entry — it still registers.
// No prompt-text heuristic ("read-only" in the prompt): the literal tool list is the whole signal.
//
// Mock policy (unit): a REAL WorkflowCatalog on a tmp sqlite through a REAL RunManager/McpFacade
// (facade-refusal-arms.test.ts's convention).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/clock.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade } from '../../src/mcp-facade.js';
import { TOOL_SPECS } from '../../src/tool-specs.js';
import { GUIDE_EXAMPLES } from '../../src/authoring-guide.js';
import type { Principal } from '../../src/authz.js';

const CLOCK = new FixedClock(new Date('2026-09-25T10:00:00.000Z'));
const OPEN: Principal = { kind: 'auth-disabled' };

function script(allowedTools: string | null): string {
  const opt = allowedTools === null ? '' : `, allowedTools: ${allowedTools}`;
  return (
    "export const meta = { description: 'd', params: { agents: { a: { model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, " +
    "effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } } };\n" +
    "phase('P');\n" +
    `return await agent('a', { prompt: 'p'${opt} });`
  );
}
// The diagram's `tools:` segment is compared whenever the call declares allowedTools (TOOLS_MISMATCH).
function mermaid(allowedTools: string | null): string {
  const names = allowedTools === null ? null : (JSON.parse(allowedTools.replace(/'/g, '"')) as string[]).sort();
  const tools = names === null ? '' : `<br/>tools: ${names.length === 0 ? 'none' : names.join(', ')}`;
  return `graph LR\nsubgraph "P"\na(["a<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000${tools}"])\nend`;
}

type Reply = { status?: string; error?: unknown; result?: { version?: string; warnings?: Array<{ code: string; label: string; message: string }> } };

let workRoot: string;
let facade: McpFacade;
beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-78b-'));
  const catalog = new WorkflowCatalog(workRoot, CLOCK);
  facade = new McpFacade({ runManager: new RunManager({ catalog, clock: CLOCK }), clock: CLOCK });
});
afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

async function register(name: string, allowedTools: string | null): Promise<Reply> {
  return (await facade.workflowRegister({ name, script: script(allowedTools), mermaid: mermaid(allowedTools) }, OPEN)) as Reply;
}

describe('#78(b) — workflow_register warns when Bash sits beside the file tools it subsumes', () => {
  it("['Bash','Read'] registers (not a refusal) AND carries one warning naming the label, Bash and Read", async () => {
    const r = await register('w1', "['Bash', 'Read']");
    expect(r.error, JSON.stringify(r.error)).toBeUndefined();
    expect(r.result?.version).toBe('v1');
    expect(r.result?.warnings).toHaveLength(1);
    const w = r.result!.warnings![0]!;
    expect(w.code).toBe('BASH_SUBSUMES_FILE_TOOLS');
    expect(w.label).toBe('a');
    expect(w.message).toContain('Bash');
    expect(w.message).toContain('Read');
    expect(w.message).toContain("['Read', 'Grep', 'Glob']");
  });

  it('each of Grep/Glob/Write/Edit beside Bash warns too', async () => {
    for (const [i, t] of ['Grep', 'Glob', 'Write', 'Edit'].entries()) {
      const r = await register(`w2-${i}`, `['${t}', 'Bash']`);
      expect(r.result?.warnings?.[0]?.message, t).toContain(t);
    }
  });

  it("no warning for ['Read','Grep','Glob'], for ['Bash'] alone, for [] or for no allowedTools at all — the key is absent", async () => {
    for (const [i, list] of ["['Read', 'Grep', 'Glob']", "['Bash']", '[]', null].entries()) {
      const r = await register(`w3-${i}`, list);
      expect(r.result?.version, String(list)).toBe('v1');
      expect(r.result && 'warnings' in r.result, String(list)).toBe(false);
    }
  });

  it("the authoring guide's own examples trip no warning", async () => {
    for (const [i, ex] of (GUIDE_EXAMPLES as Array<{ title: string; script: string; mermaid: string }>).entries()) {
      const r = (await facade.workflowRegister({ name: `guide-${i}`, script: ex.script, mermaid: ex.mermaid }, OPEN)) as Reply;
      expect(r.result?.version, `${ex.title}: ${JSON.stringify(r.error)}`).toBeDefined();
      expect(r.result?.warnings, ex.title).toBeUndefined();
    }
  });

  it("workflow_register's advertised description names the warnings array", () => {
    const spec = TOOL_SPECS.find((s) => s.name === 'workflow_register')!;
    expect(spec.description).toContain('warnings');
  });
});
