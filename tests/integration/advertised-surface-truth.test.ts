// IT-130 (v24 Gate 7.5 defects D-6, D-7, D-13 — adjudication #5 E-7 "fix this round"): three
// places where what the tool surface ADVERTISES and what the engine DOES disagreed. All three are
// the ledger's most-repeated defect class, so each is asserted as advertisement AND behaviour in
// the same case — an assertion on only one half is what let them ship.
//
// D-6: `workspace_push` advertised `HOOKS_UNSUPPORTED`, which no path can produce — `kind:'hook'`
// is refused earlier as `INVALID_ARGUMENT` (the schema/mode gate). A code a caller can never
// receive teaches a cold model to branch on something that never arrives.
// D-7: `workflow_describe` ACCEPTS `version`/`channel` (a draft resolves with `runnable:false`)
// and advertised only `name`.
// D-13: a global asset listed as `builtin:false`; REQ-113 says global assets are marked
// `builtin:true` in listings.
//
// Mock policy (integration, DES-119): real `createServer()` over real HTTP, real SQLite catalog and
// asset tree; `TOOL_SPECS` is read directly for the advertisement half (it IS the surface).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { TOOL_SPECS } from '../../src/tool-specs.js';

let server: Server;
let tmpDir: string;
const WF = 'it130-wf';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

const specFor = (name: string) => TOOL_SPECS.find((t) => t.name === name)!;
const propsOf = (name: string) => (specFor(name).inputSchema as { properties?: Record<string, unknown> }).properties ?? {};

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it130-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
  const reg = await call('workflow_register', { name: WF, script: "return 'ok';", mermaid: 'graph TD;' });
  expect(reg.error).toBeUndefined();
  const pub = await call('workflow_publish', { name: WF, version: reg.result.version as string, channel: 'release' });
  expect(pub.error).toBeUndefined();
  // A SECOND version, left unpublished — the draft `version:` selection reads it back.
  const reg2 = await call('workflow_register', { name: WF, script: "return 'ok2';", mermaid: 'graph TD;' });
  expect(reg2.error).toBeUndefined();
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

describe('workflow_describe advertises the arguments it accepts (IT-130, D-7, REQ-118)', () => {
  it('the row declares version and channel', () => {
    const props = propsOf('workflow_describe');
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['name', 'version', 'channel']));
  });

  it('…and both really work: `version` selects a version off the release pointer, `channel` selects a pointer', async () => {
    const draft = await call('workflow_describe', { name: WF, version: 'v2' });
    expect(draft.error).toBeUndefined();
    expect(draft.result.version).toBe('v2'); // the release pointer is still v1

    const release = await call('workflow_describe', { name: WF, channel: 'release' });
    expect(release.result.version).toBe('v1');
    expect(release.result.runnable).toBe(true);
  });

  it("`version` is the ONLY way to see a never-published workflow at all — without it the call is refused, which is why advertising it matters", async () => {
    const name = 'it130-never-published';
    const reg = await call('workflow_register', { name, script: "return 'draft';", mermaid: 'graph TD;' });
    expect(reg.error).toBeUndefined();

    const bare = await call('workflow_describe', { name });
    expect(bare.error?.code ?? bare.code).toBe('CHANNEL_UNPUBLISHED');

    const pinned = await call('workflow_describe', { name, version: 'v1' });
    expect(pinned.error).toBeUndefined();
    expect(pinned.result.runnable).toBe(false);
    expect(pinned.result.runnableReason).toBe('CHANNEL_UNPUBLISHED');
  });
});

describe('workspace_push advertises only codes it can answer (IT-130, D-6, REQ-118)', () => {
  it('HOOKS_UNSUPPORTED is not advertised — no path produces it', () => {
    expect(specFor('workspace_push').errors).not.toContain('HOOKS_UNSUPPORTED');
  });

  it("a kind:'hook' push answers the code that IS advertised", async () => {
    const r = await call('workspace_push', { workflow: WF, kind: 'hook', name: 'it130-hook', files: [] });
    const code = r.error?.code ?? r.code;
    expect(code).toBe('INVALID_ARGUMENT');
    expect(specFor('workspace_push').errors).toContain(code);
  });
});

describe('a global asset lists as builtin (IT-130, D-13, REQ-113)', () => {
  it("workspace_list marks the engine-level tree's rows builtin:true, workflow-owned ones false", async () => {
    const g = await call('workspace_push', {
      scope: 'global', kind: 'skill', name: 'it130-global',
      files: [{ path: 'SKILL.md', contentB64: Buffer.from('# global\n').toString('base64') }],
    });
    expect(g.error).toBeUndefined();
    const own = await call('workspace_push', {
      workflow: WF, kind: 'skill', name: 'it130-own',
      files: [{ path: 'SKILL.md', contentB64: Buffer.from('# own\n').toString('base64') }],
    });
    expect(own.error).toBeUndefined();

    const rows = (await call('workspace_list', { workflow: WF, kind: 'skill' })).result as Array<{ name: string; scope: string; builtin: boolean }>;
    expect(rows.find((r) => r.name === 'it130-global')).toMatchObject({ scope: 'global', builtin: true });
    expect(rows.find((r) => r.name === 'it130-own')).toMatchObject({ scope: 'workflow', builtin: false });
  });
});
