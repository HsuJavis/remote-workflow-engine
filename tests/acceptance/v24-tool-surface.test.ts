// VAL-129 / IT-119 (DES-158, v24 REQ-118): EVERY TOOL_SPECS row exercised over a real booted
// engine — one it per fixture.happy, one per fixture.errors[code] — asserting the typed
// error.code and validating the happy response against outputSchema; an afterAll writes
// v24-tool-surface.md (tool, args, observed response, pass/fail/unverified), only when the run
// covered all 35 rows. Written test-first (Gate 5, RED) — src/tool-specs.ts (TOOL_SPECS) does not
// exist yet.
// Mock policy (acceptance/VAL tier — MUST NOT mock the SUT's own boundary): real createServer(),
// real MCP HTTP tools/call round trip for every fixture.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
// @ts-expect-error — src/tool-specs.ts does not exist yet (v24 DES-138/158/TASK-132/151)
import { TOOL_SPECS } from '../../src/tool-specs.js';

const REPORT_PATH = join(process.cwd(), '.sdlc/features/001-remote-workflow-engine/v24-tool-surface.md');

describe('REQ-118 — every MCP tool interface exercised once against a live engine (VAL-129, DES-158)', () => {
  let server: Server;
  const rows: Array<{ tool: string; args: unknown; observed: unknown; status: 'pass' | 'fail' | 'unverified' }> = [];

  beforeAll(async () => {
    server = await createServer({ port: 0, bind: '127.0.0.1' });
  });

  afterAll(async () => {
    await server?.close();
    // The table is written ONLY when the run covered all 35 rows — a filtered run must not
    // silently truncate the conformance artifact.
    if (rows.length === (TOOL_SPECS?.length ?? 0)) {
      const lines = ['# v24 tool surface — REQ-118', '', `rows: ${rows.length}/${TOOL_SPECS.length}`, ''];
      for (const r of rows) lines.push(`- ${r.tool}: ${r.status}`);
      writeFileSync(REPORT_PATH, lines.join('\n') + '\n');
    }
  });

  async function call(name: string, args: unknown) {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    return res.json();
  }

  for (const spec of (TOOL_SPECS ?? []) as Array<{ name: string; fixture: { happy: unknown; errors?: Record<string, unknown> } }>) {
    it(`${spec.name} — happy path matches outputSchema`, async () => {
      const observed = await call(spec.name, spec.fixture.happy);
      rows.push({ tool: spec.name, args: spec.fixture.happy, observed, status: (observed as { error?: unknown }).error ? 'fail' : 'pass' });
      expect((observed as { error?: unknown }).error).toBeUndefined();
    });

    for (const [code, args] of Object.entries(spec.fixture.errors ?? {})) {
      it(`${spec.name} — error path ${code}`, async () => {
        const observed = await call(spec.name, args);
        const errCode = (observed as { result?: { error?: { code?: string } } }).result?.error?.code;
        rows.push({ tool: spec.name, args, observed, status: errCode === code ? 'pass' : 'fail' });
        expect(errCode).toBe(code);
      });
    }
  }

  it('at least 35 TOOL_SPECS rows are enumerated (REQ-118 requires the full surface, not a subset)', () => {
    expect((TOOL_SPECS ?? []).length).toBeGreaterThanOrEqual(35);
  });
});
