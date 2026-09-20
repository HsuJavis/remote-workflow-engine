// IT-172 (v33, REQ-201, TASK-227, DES-222, ARCH-091): `workflow_register`'s SUCCESS envelope gains
// `versions`/`channels` so a cold client sees "same name = stacked version, not overwritten"
// directly in the RESPONSE, without ever reading prose. Written test-first (Gate 5, RED): today
// `McpFacade.workflowRegister` returns `result: { name, version }` only (confirmed at
// src/mcp-facade.ts:350) — no `versions`, no `channels` key exists on the envelope at all.
//
// Mock policy (integration, DES-222's stated real-tier validation path): real MCP HTTP against a
// booted createServer(), real WorkflowCatalog over real SQLite (own dedicated workRoot) — no mock
// of the SUT's own boundary anywhere on the register/publish path.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { FIXTURE_SCRIPT, FIXTURE_MERMAID } from '../../src/tool-specs.js';
import { uniqueWorkflowName } from '../helpers/workflow-fixtures.js';

describe("workflow_register's response carries the version loop (IT-172, DES-222, REQ-201)", () => {
  let server: Server;
  let workRoot: string;

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), 'rwe-it172-'));
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot });
  });

  afterAll(async () => {
    await server?.close();
    rmSync(workRoot, { recursive: true, force: true });
  });

  /** Unwraps the `result.content[0].text` envelope every tool response is carried in — the same
   *  convention tests/integration/workspace-tools.test.ts and guide-examples-register.test.ts use. */
  async function call(name: string, args: Record<string, unknown>): Promise<any> {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const json = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
    const text = json.result?.content?.[0]?.text;
    return text !== undefined ? JSON.parse(text) : json;
  }

  it('a fresh name registers result.versions === ["v1"] and result.channels === {release:null, beta:null}', async () => {
    const name = uniqueWorkflowName('it172-fresh');
    const body = await call('workflow_register', { name, script: FIXTURE_SCRIPT, mermaid: FIXTURE_MERMAID });
    expect(body.result?.versions).toEqual(['v1']);
    expect(body.result?.channels).toEqual({ release: null, beta: null });
  });

  it('registering the SAME name again stacks a version and does NOT move the release pointer (REQ-097)', async () => {
    const name = uniqueWorkflowName('it172-stack');
    await call('workflow_register', { name, script: FIXTURE_SCRIPT, mermaid: FIXTURE_MERMAID });
    const published = await call('workflow_publish', { name, version: 'v1', channel: 'release' });
    expect(published.status).toBe('completed'); // sanity: the publish itself must succeed
    const second = await call('workflow_register', { name, script: FIXTURE_SCRIPT, mermaid: FIXTURE_MERMAID });
    expect(second.result?.versions).toEqual(['v1', 'v2']);
    expect(second.result?.channels?.release).toBe('v1'); // the NEW version did not take over release
  });

  it('a refused registration (MERMAID_REQUIRED) still answers {status:"failed", code}, with NO result key', async () => {
    const name = uniqueWorkflowName('it172-refused');
    const body = await call('workflow_register', { name, script: 'return 1;' }); // no mermaid, same fixture tool-specs.ts declares for this code
    expect(body.status).toBe('failed');
    expect(body.code).toBe('MERMAID_REQUIRED');
    expect(body.result).toBeUndefined();
  });
});
