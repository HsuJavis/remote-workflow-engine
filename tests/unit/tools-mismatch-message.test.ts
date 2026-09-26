// Issue #89 item 5: a TOOLS_MISMATCH refusal read "TOOLS_MISMATCH: TOOLS_MISMATCH (line 3)" — the
// code repeated as the rule name and nothing said what the node must carry. The message must name
// the node, the line and the exact expected segment text (`tools: none` for [], a sorted comma list
// otherwise), and no refusal message may repeat its code as the rule name.
//
// Mock policy (unit): a REAL WorkflowCatalog on a tmp sqlite through a REAL RunManager/McpFacade.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/clock.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade } from '../../src/mcp-facade.js';
import type { Principal } from '../../src/authz.js';

const CLOCK = new FixedClock(new Date('2026-09-26T10:00:00.000Z'));
const OPEN: Principal = { kind: 'auth-disabled' };

function script(allowedTools: string): string {
  return (
    "export const meta = { description: 'd', params: { agents: { w: { model: { type: 'string', default: 'default' }, " +
    "effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } } };\n" +
    "phase('P');\n" +
    `return await agent('w', { prompt: 'p', allowedTools: ${allowedTools} });`
  );
}

type Reply = { error?: { code?: string; message?: string } };

let workRoot: string;
let facade: McpFacade;
beforeEach(() => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-89-5-'));
  const catalog = new WorkflowCatalog(workRoot, CLOCK);
  facade = new McpFacade({ runManager: new RunManager({ catalog, clock: CLOCK }), clock: CLOCK });
});
afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

async function register(name: string, allowedTools: string, node: string): Promise<Reply> {
  const mermaid = `graph LR\nsubgraph "P"\n${node}\nend`;
  return (await facade.workflowRegister({ name, script: script(allowedTools), mermaid }, OPEN)) as Reply;
}

describe('#89 item 5 — TOOLS_MISMATCH names the expected segment text', () => {
  it('allowedTools [] + bare node → message says the node must carry "tools: none", no duplicated code', async () => {
    const r = await register('t1', '[]', 'w(["w"])');
    expect(r.error?.code).toBe('TOOLS_MISMATCH');
    const msg = r.error?.message ?? '';
    expect(msg).not.toMatch(/TOOLS_MISMATCH: TOOLS_MISMATCH/);
    expect(msg).toContain('"tools: none"');
    expect(msg).toContain("'w'");
    expect(msg).toMatch(/line 3/);
  });

  it('a literal list → expected text is the sorted comma list', async () => {
    const r = await register('t2', "['Read', 'Grep']", 'w(["w<br/>default · low · 60000<br/>tools: Read"])');
    expect(r.error?.code).toBe('TOOLS_MISMATCH');
    expect(r.error?.message ?? '').toContain('"tools: Grep, Read"');
  });
});
