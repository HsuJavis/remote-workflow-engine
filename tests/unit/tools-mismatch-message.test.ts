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

// Issue #89 item 5 (verification finding 7): when `diagramCheck.rule === code` (the four v2 rules
// that self-map in `RULE_CODE`, minus TOOLS_MISMATCH's own dedicated branch above), the message
// used to be exactly `` `${code}:${lineText}` `` — e.g. "LANE_MISMATCH: (line 2)" — a colon
// directly followed by the parenthesised line, no rule text at all. Fixed to interpolate a
// meaningful phrase between the code and the line: the catalog's own `ERROR_CATALOG[code].hint`
// when it is short enough to read well inline, else a generic phrase.
describe('#89 item 5 — rule===code diagram refusals carry meaningful text, not a bare "CODE: (line N)"', () => {
  it('DIAGRAM_DIRECTION names what is wrong (short catalog hint), not just the line', async () => {
    // `register()`'s helper always emits `graph LR` — the header is swapped to TD directly here,
    // since the helper has no direction knob of its own.
    const mermaid = 'graph TD\nsubgraph "P"\nw(["w<br/>default · low · 60000<br/>tools: none"])\nend';
    const bad = (await facade.workflowRegister({ name: 'dd1', script: script('[]'), mermaid }, OPEN)) as Reply;
    expect(bad.error?.code).toBe('DIAGRAM_DIRECTION');
    const msg = bad.error?.message ?? '';
    expect(msg).not.toBe('DIAGRAM_DIRECTION: (line 1)');
    expect(msg).toMatch(/^DIAGRAM_DIRECTION: .+\(line 1\)$/);
  });

  it('LANE_MISMATCH names what is wrong (generic phrase — its own catalog hint is too long to read inline), not just the line', async () => {
    const twoPhaseScript =
      "export const meta = { description: 'd', params: { agents: { w: { model: { type: 'string', default: 'default' }, " +
      "effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } } };\n" +
      "phase('one');\n" +
      "await agent('w', { prompt: 'p' });\n" +
      "phase('two');\n" +
      "return await agent('w', { prompt: 'p' });";
    // Right lane COUNT, wrong ORDER — "two" before "one" — so checkLanes' title-order arm fires
    // LANE_MISMATCH rather than the earlier DIAGRAM_DIRECTION/count checks.
    const mermaid =
      'graph LR\nsubgraph "two"\nw(["w<br/>default · low · 60000<br/>tools: default"])\nend\nsubgraph "one"\nend';
    const bad = (await facade.workflowRegister({ name: 'lm1', script: twoPhaseScript, mermaid }, OPEN)) as Reply;
    expect(bad.error?.code).toBe('LANE_MISMATCH');
    const msg = bad.error?.message ?? '';
    expect(msg).not.toMatch(/^LANE_MISMATCH: \(line \d+\)$/);
    expect(msg).toMatch(/^LANE_MISMATCH: .+\(line \d+\)$/);
  });
});
