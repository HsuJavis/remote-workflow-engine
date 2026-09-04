// IT-129 (v24 Gate 7.5 defects D-3 and D-5, REQ-116 / REQ-112 / REQ-118): what a refused caller
// actually receives on the wire — the catalog's `see` pointer, and the ADVERTISED code.
//
// D-3: `errors.ts:132 toErrEnvelope` builds `see` from `ERROR_CATALOG`, but `mcp-facade.ts` had a
// SECOND `toErrEnvelope` of its own whose envelope type has no `see` — and that was the one every
// `workflow_*` handler called, so the pointer never reached the wire. Live, four authoring
// refusals in a row (MERMAID_REQUIRED, DIAGRAM_MISMATCH, PARSE_ERROR, MERMAID_INVALID) arrived
// with nothing pointing at `workflow_authoring_guide` — for a cold model whose only documentation
// is the tool surface, that pointer IS the documentation link.
//
// D-5: `asset-sync.ts` threw a bare `AssetPathEscapeError` — a raw JS class name, not a member of
// the closed `ErrorCode` union and not in `ERROR_CATALOG` — while the `workspace_push` row
// advertises `WORKSPACE_ESCAPE`/`RESERVED_PREFIX`. The write was correctly refused; only the code
// a caller can branch on was wrong.
//
// Mock policy (integration, DES-119): a real `createServer()` over real HTTP, real SQLite catalog
// and real asset tree. Nothing at the SUT boundary is faked.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;
const WF = 'it129-wf';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

const b64 = (s: string) => Buffer.from(s).toString('base64');

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it129-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
  const reg = await call('workflow_register', { name: WF, script: "return 'ok';", mermaid: 'graph TD;' });
  expect(reg.error).toBeUndefined();
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

describe('every authoring refusal carries the guide pointer on the wire (IT-129, D-3, REQ-116)', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['MERMAID_REQUIRED', { name: 'it129-no-mermaid', script: 'return 1;' }, 'MERMAID_REQUIRED'],
    ['DIAGRAM_MISMATCH', { name: 'it129-mismatch', script: 'return 1;', mermaid: 'graph TD;\nghost(["ghost"])' }, 'DIAGRAM_MISMATCH'],
    ['PARSE_ERROR', { name: 'it129-parse', script: 'this is not { valid javascript (((', mermaid: 'graph TD;' }, 'PARSE_ERROR'],
    ['MERMAID_INVALID', { name: 'it129-collapsed', script: 'return 1;', mermaid: 'graph TD;\na["a"]\nb["b"]\nc["c"]\na-->b & c' }, 'MERMAID_INVALID'],
  ];

  for (const [label, args, code] of cases) {
    it(`${label} answers see:'workflow_authoring_guide'`, async () => {
      const r = await call('workflow_register', args);
      expect(r.error?.code ?? r.code).toBe(code);
      expect(r.error?.see, `${label} reached the wire with no pointer to the guide`).toBe('workflow_authoring_guide');
    });
  }

  it("a refusal the catalog marks see:null does NOT invent a pointer (the field is read from the catalog, never hand-typed)", async () => {
    const r = await call('workflow_describe', { name: 'it129-definitely-absent' });
    expect(r.error?.code ?? r.code).toBe('WORKFLOW_NOT_FOUND');
    expect(r.error?.see ?? null).toBeNull();
  });
});

describe('a refused asset write answers the ADVERTISED code, not a JS class name (IT-129, D-5, REQ-118)', () => {
  it("a files[].path escaping the asset dir ⇒ WORKSPACE_ESCAPE, and nothing is written", async () => {
    const r = await call('workspace_push', {
      workflow: WF, kind: 'skill', name: 'it129-escape',
      files: [{ path: '../escape.md', contentB64: b64('nope') }],
    });
    expect(r.error?.code ?? r.code).toBe('WORKSPACE_ESCAPE');
    expect(existsSync(join(tmpDir, 'assets', WF, 'skill', 'it129-escape'))).toBe(false);
    expect(existsSync(join(tmpDir, 'assets', WF, 'escape.md'))).toBe(false);
  });

  it('an ABSOLUTE files[].path ⇒ WORKSPACE_ESCAPE', async () => {
    const r = await call('workspace_push', {
      workflow: WF, kind: 'skill', name: 'it129-abs',
      files: [{ path: '/etc/passwd-ish', contentB64: b64('nope') }],
    });
    expect(r.error?.code ?? r.code).toBe('WORKSPACE_ESCAPE');
  });

  it("a files[].path under the engine's reserved prefix ⇒ RESERVED_PREFIX", async () => {
    const r = await call('workspace_push', {
      workflow: WF, kind: 'skill', name: 'it129-reserved',
      files: [{ path: 'rwe-internal/x.md', contentB64: b64('nope') }],
    });
    expect(r.error?.code ?? r.code).toBe('RESERVED_PREFIX');
    expect(existsSync(join(tmpDir, 'assets', WF, 'skill', 'it129-reserved'))).toBe(false);
  });

  it('GREEN PIN: a well-formed skill still stores', async () => {
    const r = await call('workspace_push', {
      workflow: WF, kind: 'skill', name: 'it129-ok',
      files: [{ path: 'SKILL.md', contentB64: b64('# fine\n') }],
    });
    expect(r.error).toBeUndefined();
    expect(existsSync(join(tmpDir, 'assets', WF, 'skill', 'it129-ok', 'SKILL.md'))).toBe(true);
  });
});
