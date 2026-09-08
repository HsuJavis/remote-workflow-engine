// IT-118 (DES-157, v24): every GUIDE_EXAMPLES[] entry is registered against a REAL booted engine
// over MCP HTTP and asserted accepted (the oracle for "a guide that teaches an invalid example is
// worse than no guide" — v23's AUTHORING.md defect, found only because Gate 7.5 ran it). Written
// test-first (Gate 5, RED) — GUIDE_EXAMPLES does not exist yet.
// Mock policy: real HTTP MCP server, real workflow_register round trip — no mock of the SUT boundary.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { GUIDE_EXAMPLES } from '../../src/authoring-guide.js';

describe('every GUIDE_EXAMPLES entry registers over real MCP HTTP (IT-118, DES-157)', () => {
  let server: Server;

  beforeAll(async () => {
    server = await createServer({ port: 0, bind: '127.0.0.1' });
  });

  afterAll(async () => {
    await server?.close();
  });

  it.each((GUIDE_EXAMPLES ?? []) as Array<{ title: string; script: string; mermaid: string }>)(
    'registers "%s" and asserts {version}',
    async (ex) => {
      const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'tools/call',
          params: { name: 'workflow_register', arguments: { name: `guide-${ex.title}`, script: ex.script, mermaid: ex.mermaid } },
        }),
      });
      const body = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
      const parsed = JSON.parse(body.result?.content?.[0]?.text ?? '{}') as { version?: unknown; result?: { version?: unknown } };
      expect(parsed.version ?? parsed.result?.version).toBeDefined();
    },
  );

  it('at least one example is exercised (the it.each above is not silently empty)', () => {
    expect(GUIDE_EXAMPLES.length).toBeGreaterThan(0);
  });
});

// v26 (DES-185, ARCH-119/107, ADR-039, TASK-190, REQ-128/116/117): the guide examples ARE the v2
// conformance corpus — every v2 construct (phase lane, parallel slot, alt slot, tools:none,
// tools:default, dynamic title, nested workflow() rectangle) plus the five ADR-039 narrowings in
// their LEGAL rewritten form must register GREEN, and NO NEGATIVE fixture belongs in the guide (an
// example a model might copy is worse than none). Written test-first (Gate 5, RED): today's
// GUIDE_EXAMPLES are `graph TD` diagrams (pre-v26), not LR swimlanes, so this coverage claim is not
// yet true, and no v2 rule codes exist to check the guide text against.
describe('the guide examples are the v2 conformance corpus (DES-185, v26)', () => {
  it('every example is an LR swimlane (graph LR / flowchart LR), not graph TD', () => {
    for (const ex of GUIDE_EXAMPLES as Array<{ title: string; mermaid: string }>) {
      expect(ex.mermaid.trim()).toMatch(/^(graph|flowchart)\s+LR\b/);
    }
  });

  it('none of the four v2 negative rule codes appear as literal text anywhere in the guide corpus', () => {
    const text = (GUIDE_EXAMPLES as Array<{ script: string; mermaid: string }>).map((e) => e.script + e.mermaid).join('\n');
    for (const code of ['DIAGRAM_DIRECTION', 'LANE_MISMATCH', 'TOOLS_MISMATCH', 'EDGE_MISMATCH']) {
      expect(text).not.toContain(code);
    }
  });
});
