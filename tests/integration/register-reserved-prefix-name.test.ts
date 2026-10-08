// Issue #91 (owner decision, 2026-09-26): `workflow_register` accepted a name starting with the
// engine-reserved 'rwe-' prefix — only asset names/paths (`path-verdict.ts`'s asset-tree check,
// `ARCH-093`) were ever checked; a workflow's own `name` never was. The engine registers no
// `rwe-*` workflows, for EVERY principal including admin, so the refusal has to fire BEFORE any
// other registration work (a script/mermaid full of unrelated errors must still come back
// RESERVED_PREFIX, not something else a cold client would learn to branch on instead). Reuses
// `path-verdict.ts`'s own `RESERVED_PREFIX` constant — no second literal to drift out of sync.
//
// Mock policy (integration, DES-119): the facade-level cases (non-admin/admin/accepted names) use
// a real `WorkflowCatalog` + real SQLite under a tmp workRoot, real `RunManager`/`McpFacade` — the
// same construction `facade-refusal-arms.test.ts` uses. `facadeCaller` gives them the SAME
// `ToolCaller` shape an HTTP `callTool` does, but it calls `McpFacade` directly and so skips
// `call-tool.ts`'s own ajv-schema + `authorize()` layer. The 'through real tools/call HTTP' block
// below is the genuine MCP-level check the contract asks for: real `createServer()`, real JSON-RPC
// `tools/call` over HTTP, the full dispatch path — the val-109/registration-enforcement pattern.
//
// Red reason: `WorkflowCatalog.validateRegistration` never inspects `name` against
// RESERVED_PREFIX today — every row below that expects a refusal registers successfully instead.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../src/clock.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { RunManager } from '../../src/run-manager.js';
import { McpFacade } from '../../src/mcp-facade.js';
import { RESERVED_PREFIX } from '../../src/path-verdict.js';
import { facadeCaller, registerPublishedVia } from '../helpers/workflow-fixtures.js';
import type { Principal } from '../../src/authz.js';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

const CLOCK = new FixedClock(new Date('2026-09-26T00:00:00.000Z'));
const AUTHOR: Principal = { kind: 'author', id: 'author@rwe91.example' };
const ADMIN: Principal = { kind: 'admin', id: 'admin@rwe91.example' };

function withTmpFacade<T>(fn: (facade: McpFacade) => Promise<T>): Promise<T> {
  const workRoot = mkdtempSync(join(tmpdir(), 'rwe-issue91-'));
  const catalog = new WorkflowCatalog(workRoot, CLOCK);
  const facade = new McpFacade({ runManager: new RunManager({ catalog, clock: CLOCK }), clock: CLOCK });
  return fn(facade).finally(() => rmSync(workRoot, { recursive: true, force: true }));
}

describe("issue #91: workflow_register refuses the engine-reserved 'rwe-' prefix", () => {
  it('path-verdict.ts exports the ONE literal — no duplicated `rwe-` string for the name check to drift against', () => {
    expect(RESERVED_PREFIX).toBe('rwe-');
  });

  it('WorkflowCatalog.register() refuses RESERVED_PREFIX BEFORE any script/mermaid content check runs (garbage script/mermaid, still RESERVED_PREFIX)', async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-issue91-'));
    try {
      const catalog = new WorkflowCatalog(workRoot, CLOCK);
      await expect(
        catalog.register({ name: 'rwe-impostor', script: 'not { valid javascript (((', mermaid: '' }),
      ).rejects.toMatchObject({ code: 'RESERVED_PREFIX' });
    } finally {
      rmSync(workRoot, { recursive: true, force: true });
    }
  });

  it('a non-admin author is refused RESERVED_PREFIX through the real MCP tool handler, naming the prefix', () =>
    withTmpFacade(async (facade) => {
      const call = facadeCaller(facade, AUTHOR);
      const res = (await call('workflow_register', { name: 'rwe-not-mine', script: "return 'ok';", mermaid: 'graph LR' })) as {
        code?: string;
        error?: { code?: string; message?: string };
      };
      expect(res.code ?? res.error?.code).toBe('RESERVED_PREFIX');
      expect(res.error?.message ?? '').toContain(RESERVED_PREFIX);
    }));

  it('an admin principal is ALSO refused RESERVED_PREFIX — the engine registers no rwe-* workflows for anyone (owner decision)', () =>
    withTmpFacade(async (facade) => {
      const call = facadeCaller(facade, ADMIN);
      const res = (await call('workflow_register', { name: 'rwe-admin-attempt', script: "return 'ok';", mermaid: 'graph LR' })) as {
        code?: string;
        error?: { code?: string };
      };
      expect(res.code ?? res.error?.code).toBe('RESERVED_PREFIX');
    }));

  it("'rwe' with no trailing dash is a plain name — accepted (the check is a PREFIX match, not a substring ban)", () =>
    withTmpFacade(async (facade) => {
      const call = facadeCaller(facade);
      const { version } = await registerPublishedVia(call, 'rwe', "return 'ok';");
      expect(version).toBe('v1');
    }));

  it("'xrwe-…' is accepted — the reserved prefix only matches the START of the name", () =>
    withTmpFacade(async (facade) => {
      const call = facadeCaller(facade);
      const { version } = await registerPublishedVia(call, 'xrwe-not-reserved', "return 'ok';");
      expect(version).toBe('v1');
    }));

  // issue #154 B4 follow-up (2026-10-09 re-verification): `RWE-ver01`/`RWE-x` registered and ran —
  // the reserved segment is a naming convention the engine owns, not a filesystem-identity check,
  // so varying case must not let a caller claim it back. Flipped from the prior (deliberately
  // case-sensitive) expectation to match `isReservedPrefixed`'s case-insensitive comparison.
  it("an uppercase 'RWE-…' name is now ALSO refused RESERVED_PREFIX — case-insensitive (issue #154 B4 follow-up)", () =>
    withTmpFacade(async (facade) => {
      const call = facadeCaller(facade, AUTHOR);
      const res = (await call('workflow_register', { name: 'RWE-uppercase', script: "return 'ok';", mermaid: 'graph LR' })) as {
        code?: string;
        error?: { code?: string };
      };
      expect(res.code ?? res.error?.code).toBe('RESERVED_PREFIX');
    }));

  it("a mixed-case 'rWe-…' name is likewise refused RESERVED_PREFIX", () =>
    withTmpFacade(async (facade) => {
      const call = facadeCaller(facade, AUTHOR);
      const res = (await call('workflow_register', { name: 'rWe-mixedcase', script: "return 'ok';", mermaid: 'graph LR' })) as {
        code?: string;
        error?: { code?: string };
      };
      expect(res.code ?? res.error?.code).toBe('RESERVED_PREFIX');
    }));
});

// The genuine MCP-level check: real `createServer()`, real `tools/call` JSON-RPC over HTTP — the
// SAME entrypoint a real client hits, ajv schema + `authorize()` included. The default (no
// `principals` configured) boot is auth-disabled, which `mcp-facade.ts` treats as admin
// (`isAdmin = kind==='admin' || kind==='auth-disabled'`), so this doubles as the admin-equivalent
// case at the full HTTP surface — the facade-level block above additionally proves an explicit
// `{kind:'admin', id}` Principal is refused the same way.
describe("issue #91: RESERVED_PREFIX through real tools/call HTTP (createServer, val-109 pattern)", () => {
  let server: Server;
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'rwe-issue91-http-'));
    server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
  });
  afterAll(async () => {
    await server?.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function toolCall(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
    return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
  }

  it('workflow_register over real tools/call HTTP refuses a reserved name RESERVED_PREFIX, naming the prefix, and stores nothing', async () => {
    const r = await toolCall('workflow_register', { name: 'rwe-http-attempt', script: "return 'ok';", mermaid: 'graph LR' });
    const err = r['error'] as { code?: string; message?: string } | undefined;
    expect(r['code'] ?? err?.code).toBe('RESERVED_PREFIX');
    expect(err?.message ?? '').toContain(RESERVED_PREFIX);

    // Same "nothing stored" assertion val-109-registration-checks.test.ts uses for PARSE_ERROR.
    const got = await toolCall('workflow_source', { name: 'rwe-http-attempt' });
    expect(got['code']).toBe('WORKFLOW_NOT_FOUND');
  });
});
