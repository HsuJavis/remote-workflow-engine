// UT-369 — security pair (owner ruling 2026-10-17, UT-367 fix): an agent() call carrying
// `allowedTools: ['Bash']` plus a quote-bearing comment reaches the SAME registration outcome (status,
// error code, warnings) as the comment-free version. Before the fix the comment hid the call from
// `scanAgentCalls`, so AGENT_UNDECLARED / the diagram's tools contract / tool-surface warnings never saw it.
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

const CLOCK = new FixedClock(new Date('2026-10-17T10:00:00.000Z'));
const OPEN: Principal = { kind: 'auth-disabled' };
const AGENT_DECL =
  "model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 }";

function script(comment: string, tools: string[]): string {
  return (
    `export const meta = { description: 'd', phases: [{ title: 'P' }], params: { agents: { a: { ${AGENT_DECL} } } } };\n` +
    "phase('P');\n" +
    `return await agent('a', {\n  ${comment}\n  prompt: 'p', allowedTools: [${tools.map((t) => `'${t}'`).join(', ')}] });`
  );
}
function mermaid(tools: string): string {
  return `graph LR\nsubgraph "P"\na(["a<br/>anthropic/claude-haiku-4-5-20251001 · low · 60000<br/>tools: ${tools}"])\nend`;
}

type Reply = { status?: string; error?: { code?: string; detail?: unknown }; result?: { warnings?: Array<{ code: string; label: string }> } };
const outcome = (r: Reply): unknown => ({
  status: r.status,
  code: r.error?.code,
  detail: r.error?.detail,
  warnings: (r.result?.warnings ?? []).map((w) => `${w.code}:${w.label}`).sort(),
});

let workRoot: string;
beforeEach(() => { workRoot = mkdtempSync(join(tmpdir(), 'rwe-ut369-')); });
afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

async function register(name: string, comment: string, tools: string[], diagramTools: string, posture: 'confined' | 'unconfined'): Promise<Reply> {
  const catalog = new WorkflowCatalog(workRoot, CLOCK);
  const f = new McpFacade({ runManager: new RunManager({ catalog, clock: CLOCK }), clock: CLOCK, confinementPosture: posture });
  return (await f.workflowRegister({ name, script: script(comment, tools), mermaid: mermaid(diagramTools) }, OPEN)) as Reply;
}

describe("UT-369 — a quote-bearing comment does not change agent('a', { allowedTools: ['Bash'] })'s registration outcome", () => {
  // ['Bash', 'Read'] makes the warnings half of the comparison non-vacuous (BASH_SUBSUMES_FILE_TOOLS).
  for (const tools of [['Bash'], ['Bash', 'Read']])
  for (const comment of ["// don't widen", "/* it's 'quoted' */", '// a `tick` ... here']) {
    for (const posture of ['confined', 'unconfined'] as const) {
      it(`truthful diagram (tools: ${tools.join(', ')}), ${posture}: ${comment}`, async () => {
        const plain = await register('plain', '', tools, tools.join(', '), posture);
        const quoted = await register('quoted', comment, tools, tools.join(', '), posture);
        expect(plain.status).toBe('completed');
        expect(outcome(quoted)).toEqual(outcome(plain));
      });
      it(`lying diagram (tools: none) for ${tools.join(', ')}, ${posture}: ${comment} — both refused alike`, async () => {
        const plain = await register('plain', '', tools, 'none', posture);
        const quoted = await register('quoted', comment, tools, 'none', posture);
        expect(plain.status).toBe('failed');
        expect(plain.error?.code).toBeTruthy();
        expect(outcome(quoted)).toEqual(outcome(plain));
      });
    }
  }
});
