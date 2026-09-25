// Issue #82 (option B), wire tier: the production composition (`createServer`) end to end — blobs
// and manifest uploaded over the real CAS routes, `workflow_register({seedManifestRef})` over
// `/mcp`, then the two trigger-fired start paths as production drives them: the 500 ms schedule
// ticker (`server.ts`'s `resolveScheduleTarget` → `runManager.start`) and `POST /hooks/:id`. Each
// fired run's workspace must hold the seeded `data/input.txt` — the exact reproduction the issue
// reports (a fired run got an EMPTY workspace). Also pins the advertised surface: `tools/list`
// declares `seedManifestRef` on workflow_register and lists the codes register can now answer.
//
// Mock policy (integration): nothing mocked — real server, real HTTP, real CasStore, real sandbox.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, createHmac } from 'node:crypto';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const INPUT = Buffer.from('seeded for a triggered run\n');

let server: Server;
let workRoot: string;
const base = () => `http://127.0.0.1:${server.port}`;

async function mcpCall(name: string, args: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const res = await fetch(`${base()}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

async function uploadSeed(): Promise<string> {
  const put = await fetch(`${base()}/assets/blob/${sha256(INPUT)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: INPUT });
  expect(put.status).toBe(200);
  const m = await fetch(`${base()}/assets/manifest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ path: 'data/input.txt', sha256: sha256(INPUT) }]) });
  const ref = (await m.json() as { seedManifestRef?: string }).seedManifestRef;
  expect(ref).toMatch(/^[0-9a-f]{64}$/);
  return ref!;
}

/** registerPublishedVia, with `seedManifestRef` spliced into the register call only. */
async function registerSeeded(name: string, seedManifestRef: string, triggers: string[] = []): Promise<void> {
  const withRef = async (tool: string, args: Record<string, unknown>) =>
    mcpCall(tool, tool === 'workflow_register' ? { ...args, seedManifestRef } : args);
  await registerPublishedVia(withRef, name, 'return 1', triggers.length > 0 ? { triggers } : {});
}

async function waitTerminal(runId: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const st = await mcpCall('run_status', { runId });
    if (['completed', 'failed', 'stopped'].includes(st['status'])) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`run ${runId} did not settle`);
}

async function seededSha(runId: string): Promise<string | undefined> {
  await waitTerminal(runId);
  const listed = await mcpCall('workspace_list', { runId });
  return (listed['result'] as Array<{ path: string; sha256: string }> | undefined)?.find((e) => e.path === 'data/input.txt')?.sha256;
}

beforeAll(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-issue82-http-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot });
});
afterAll(async () => {
  await server?.close();
  rmSync(workRoot, { recursive: true, force: true });
});

describe('#82 wire tier — version default seed reaches trigger-fired runs', () => {
  it('tools/list: workflow_register declares seedManifestRef and advertises the seed refusals', async () => {
    const res = await fetch(`${base()}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    const tools = (await res.json() as { result: { tools: Array<{ name: string; inputSchema: { properties: Record<string, { pattern?: string }> }; description: string }> } }).result.tools;
    const reg = tools.find((t) => t.name === 'workflow_register')!;
    expect(reg.inputSchema.properties['seedManifestRef']?.pattern).toBe('^[0-9a-f]{64}$');
    for (const code of ['MISSING_BLOBS', 'INVALID_SEED_SPEC', 'CAS_UNAVAILABLE']) expect(reg.description).toContain(code);
  });

  it('run_start({name}) with no seed gets the version default; workflow_describe shows the ref', async () => {
    const ref = await uploadSeed();
    await registerSeeded('wire-manual', ref);
    const d = await mcpCall('workflow_describe', { name: 'wire-manual' });
    expect(d['result']?.seedManifestRef).toBe(ref);
    const r = await mcpCall('run_start', { name: 'wire-manual' });
    expect(r['error'], JSON.stringify(r)).toBeUndefined();
    expect(await seededSha(r['runId'])).toBe(sha256(INPUT));
  }, 20_000);

  it('a one-shot schedule fired by the production ticker gets the seed', async () => {
    const ref = await uploadSeed();
    const c = await mcpCall('schedule_create', { kind: 'once', at: new Date(Date.now() - 1000).toISOString(), enabled: false });
    const id = c['result']?.id as string;
    expect(typeof id).toBe('string');
    await registerSeeded('wire-sched', ref, [id]);
    expect((await mcpCall('schedule_setEnabled', { id, enabled: true }))['error']).toBeUndefined();
    let runId: string | undefined;
    for (let i = 0; i < 60 && !runId; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const row = ((await mcpCall('schedule_list'))['result'] as Array<Record<string, unknown>>).find((x) => x['id'] === id);
      runId = row?.['lastRunId'] as string | undefined;
      if (row?.['lastError']) throw new Error(`schedule failed: ${String(row['lastError'])}`);
    }
    expect(runId, 'schedule never fired').toBeDefined();
    expect(await seededSha(runId!)).toBe(sha256(INPUT));
  }, 30_000);

  it('a signed POST /hooks/:id delivery gets the seed', async () => {
    const ref = await uploadSeed();
    const w = await mcpCall('webhook_create', {});
    const webhookId = (w['result']?.webhookId ?? w['webhookId']) as string;
    const secret = (w['result']?.secret ?? w['secret']) as string;
    expect(typeof webhookId).toBe('string');
    await registerSeeded('wire-hook', ref, [webhookId]);
    const body = '{"hello":"hook"}';
    const res = await fetch(`${base()}/hooks/${webhookId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-rwe-signature': 'sha256=' + createHmac('sha256', secret).update(body).digest('hex'),
        'x-rwe-timestamp': new Date().toISOString(),
        'x-rwe-delivery': 'issue82-d1',
      },
      body,
    });
    const out = await res.json() as { runId?: string; error?: string };
    expect(res.status, JSON.stringify(out)).toBe(202);
    expect(await seededSha(out.runId!)).toBe(sha256(INPUT));
  }, 20_000);

  it('workflow_register with a ref that was never uploaded is refused MISSING_BLOBS over the wire', async () => {
    const r = await mcpCall('workflow_register', { name: 'wire-bad', script: 'return 1', mermaid: 'graph LR', seedManifestRef: 'c'.repeat(64) });
    expect(r['status']).toBe('failed');
    expect(r['code']).toBe('MISSING_BLOBS');
  });

  it('the trigger-create seed refusal now points at workflow_register({seedManifestRef})', async () => {
    const r = await mcpCall('schedule_create', { kind: 'once', at: new Date(Date.now() + 60_000).toISOString(), seed: [{ path: 'a', contentB64: 'AAAA' }] });
    expect(r['code']).toBe('INVALID_ARGUMENT');
    expect(r['error']?.message).toContain('workflow_register({name, script, mermaid, seedManifestRef})');
  });
});
