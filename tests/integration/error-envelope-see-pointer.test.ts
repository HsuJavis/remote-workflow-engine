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
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { TokenStore } from '../../src/auth/token-store.js';
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
  const reg = await call('workflow_register', { name: WF, script: "return 'ok';", mermaid: 'graph LR' });
  expect(reg.error).toBeUndefined();
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

describe('every authoring refusal carries the guide pointer on the wire (IT-129, D-3, REQ-116)', () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['MERMAID_REQUIRED', { name: 'it129-no-mermaid', script: 'return 1;' }, 'MERMAID_REQUIRED'],
    ['DIAGRAM_MISMATCH', { name: 'it129-mismatch', script: 'return 1;', mermaid: 'graph TD;\nghost(["ghost"])' }, 'DIAGRAM_MISMATCH'],
    ['PARSE_ERROR', { name: 'it129-parse', script: 'this is not { valid javascript (((', mermaid: 'graph LR' }, 'PARSE_ERROR'],
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

// ------------------------------------------------------------------------------------------------
// IT-129b (v24 adjudication #6 F-3, defect D-14, REQ-116): the TRIGGER arm of the same clause.
//
// REQ-116's wording is "a registration that fails on parse, contract, diagram OR TRIGGER must point
// at `workflow_authoring_guide`" — ownership is not carved out of "trigger", and the guide is the
// document that explains the create-then-claim lifecycle a cold model gets wrong. All three codes
// are thrown from the registration path (`mcp-facade.ts:308/313/322`), so all three must arrive with
// the pointer.
//
// This needs its OWN auth-ENABLED boot: with auth disabled every principal is `auth-disabled`, which
// `workflowRegister` treats as admin, so the `NOT_TRIGGER_OWNER` arm is unreachable — exactly why a
// catalog-table unit test would have "passed" while the wire stayed silent.
describe('the trigger arm of a registration refusal carries the guide pointer too (IT-129b, D-14, REQ-116)', () => {
  let authServer: Server;
  let authDir: string;
  let aliceToken: string;
  let bobToken: string;
  const ALICE = 'alice@example.com';
  const BOB = 'bob@example.com';

  function mintBearer(workRoot: string, email: string): string {
    const db = new Database(join(workRoot, 'auth-tokens.db'));
    try {
      return new TokenStore(db, { clock: () => Date.now(), csprng: (n: number) => randomBytes(n) })
        .issue(email, 7 * 24 * 3600_000).token;
    } finally {
      db.close();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function callAs(name: string, args: Record<string, unknown>, bearer: string): Promise<any> {
    const res = await fetch(`http://127.0.0.1:${authServer.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
    return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
  }

  const register = (name: string, triggers: string[], bearer: string) =>
    callAs('workflow_register', { name, script: "return 'ok';", mermaid: 'graph LR', triggers }, bearer);

  let residentId: string;

  beforeAll(async () => {
    authDir = mkdtempSync(join(tmpdir(), 'rwe-it129b-'));
    authServer = await createServer({
      port: 0,
      bind: '127.0.0.1', // loopback ⇒ no D-BIND exemption, the bearer is really validated
      workRoot: authDir,
      auth: { enabled: true, issuer: 'http://127.0.0.1:0', googleClientId: 'it129b-cid', googleClientSecret: 'it129b-cs' },
      principals: { [ALICE]: { role: 'author' }, [BOB]: { role: 'author' } },
    } as never);
    aliceToken = mintBearer(authDir, ALICE);
    bobToken = mintBearer(authDir, BOB);
    // `resident` — a trigger that never fires on a clock, so the claim arms under test are the only
    // thing this fixture exercises.
    const created = await callAs('schedule_create', { kind: 'resident' }, aliceToken);
    residentId = ((created.result ?? created) as { id?: string }).id!;
    expect(typeof residentId).toBe('string');
  });
  afterAll(async () => { await authServer?.close(); rmSync(authDir, { recursive: true, force: true }); });

  it("TRIGGER_NOT_FOUND answers see:'workflow_authoring_guide'", async () => {
    const r = await register('it129b-absent', ['00000000-0000-0000-0000-000000000000'], aliceToken);
    expect(r.error?.code ?? r.code).toBe('TRIGGER_NOT_FOUND');
    expect(r.error?.see, 'TRIGGER_NOT_FOUND reached the wire with no pointer to the guide').toBe('workflow_authoring_guide');
  });

  it("NOT_TRIGGER_OWNER answers see:'workflow_authoring_guide' (claiming another author's trigger)", async () => {
    const r = await register('it129b-bobs', [residentId], bobToken);
    expect(r.error?.code ?? r.code).toBe('NOT_TRIGGER_OWNER');
    expect(r.error?.see, 'NOT_TRIGGER_OWNER reached the wire with no pointer to the guide').toBe('workflow_authoring_guide');
  });

  it("TRIGGER_ALREADY_CLAIMED answers see:'workflow_authoring_guide'", async () => {
    const first = await register('it129b-first', [residentId], aliceToken);
    expect(first.error).toBeUndefined();
    const r = await register('it129b-second', [residentId], aliceToken);
    expect(r.error?.code ?? r.code).toBe('TRIGGER_ALREADY_CLAIMED');
    expect(r.error?.see, 'TRIGGER_ALREADY_CLAIMED reached the wire with no pointer to the guide').toBe('workflow_authoring_guide');
  });
});
