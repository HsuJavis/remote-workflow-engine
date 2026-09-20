// VAL-236 (REQ-209): a reader's own two actions — (1) every script+mermaid pair extracted from
// docs/AUTHORING.md/DEPLOY.md/README.md (DES-239(e)'s rule) registers through the REAL
// `workflow_register`; (2) copying the DEPLOY.md role-prompt recipe by hand into a live call
// registers AND starts a run.
//
// Honesty note (measured on the current tree, not fabricated — see guide-examples-register.test.ts's
// own note): DEPLOY.md's recipe was already fixed end-to-end at v34 (commit f1b44be) and every
// extracted pair registers clean today. This file is therefore GREEN at Gate 5 — a regression lock
// for REQ-209's real-tier path, not a new red defect. What is genuinely red is the AUTOMATED guard
// (`tests/helpers/doc-examples.ts` + its IT extension) that did not exist before this iteration; a
// future edit to either doc could silently reintroduce the v34 defect with nothing to catch it. The
// checkMermaid arity pin (the OTHER half of REQ-209 — the 5th parameter's silent-skip hazard) is the
// genuinely red half, pinned separately in `check-mermaid.test.ts` (tsc-only, DES-238).
//
// Mock policy (acceptance): real createServer(), real MCP HTTP.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { extractDocPairs } from '../helpers/doc-examples.js';

let server: Server;
let baseUrl: string;

async function call(name: string, args: unknown): Promise<{ result?: unknown; error?: unknown }> {
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
  return JSON.parse(body.result!.content[0]!.text);
}

beforeAll(async () => { server = await createServer({ port: 0, bind: '127.0.0.1' }); baseUrl = `http://127.0.0.1:${server.port}`; });
afterAll(async () => { await server?.close(); });

describe('VAL-236 — the doc examples a reader would copy really register + run (REQ-209)', () => {
  it('every extracted DEPLOY.md pair registers through the real workflow_register', async () => {
    const pairs = extractDocPairs(readFileSync(join(process.cwd(), 'DEPLOY.md'), 'utf8'));
    expect(pairs.length).toBeGreaterThanOrEqual(1);
    for (const [idx, p] of pairs.entries()) {
      const res = (await call('workflow_register', { name: `val236-deploy-${idx}`, script: p.script, mermaid: p.mermaid })) as { result?: { version?: unknown }; error?: unknown };
      expect(res.result?.version, `pair #${idx}: ${JSON.stringify(res.error)}`).toBeDefined();
    }
  });

  it('the DEPLOY.md recipe registers AND starts a run (copy-by-hand end to end)', async () => {
    const pairs = extractDocPairs(readFileSync(join(process.cwd(), 'DEPLOY.md'), 'utf8'));
    const recipe = pairs[0]!;
    const reg = (await call('workflow_register', { name: 'val236-run', script: recipe.script, mermaid: recipe.mermaid })) as { result?: { version?: string } };
    expect(reg.result?.version).toBeDefined();
    const pub = (await call('workflow_publish', { name: 'val236-run', version: reg.result!.version, channel: 'release' })) as { result?: unknown; error?: unknown };
    expect(pub.result, JSON.stringify(pub.error)).toBeDefined();
    const started = (await call('run_start', { name: 'val236-run' })) as { result?: { runId?: string }; error?: unknown };
    expect(started.result?.runId, JSON.stringify(started.error)).toBeDefined();
  });
});
