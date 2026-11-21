// IT: MCP revision 2026-07-28 (the stateless revision) on /mcp, served side by side with the
// handshake era. Pins: server/discover, per-request version + header validation, resultType,
// the tasks extension on run_start, and subscriptions/listen pushing the finished task.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia, uniqueWorkflowName } from '../helpers/workflow-fixtures.js';

const V = '2026-07-28';
const TASKS = 'io.modelcontextprotocol/tasks';
let server: Server;
let tmpDir: string;

interface Rpc { result?: Record<string, any>; error?: { code: number; message: string; data?: any } }

function modernBody(method: string, params: Record<string, unknown> = {}, opts: { tasks?: boolean; meta?: Record<string, unknown>; id?: unknown } = {}): Record<string, unknown> {
  return {
    jsonrpc: '2.0', id: opts.id ?? 1, method,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': V,
        'io.modelcontextprotocol/clientInfo': { name: 'it', version: '1' },
        'io.modelcontextprotocol/clientCapabilities': opts.tasks ? { extensions: { [TASKS]: {} } } : {},
        ...(opts.meta ?? {}),
      },
    },
  };
}

function modernHeaders(body: Record<string, any>, over: Record<string, string | undefined> = {}): Record<string, string> {
  const p = body['params'] ?? {};
  const name = p.name ?? p.taskId;
  const h: Record<string, string | undefined> = {
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': V, 'Mcp-Method': body['method'],
    ...(typeof name === 'string' ? { 'Mcp-Name': name } : {}),
    ...over,
  };
  return Object.fromEntries(Object.entries(h).filter(([, v]) => v !== undefined)) as Record<string, string>;
}

async function modern(method: string, params: Record<string, unknown> = {}, opts: Parameters<typeof modernBody>[2] & { headers?: Record<string, string | undefined> } = {}): Promise<{ status: number; body: Rpc; res: Response }> {
  const body = modernBody(method, params, opts);
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, { method: 'POST', headers: modernHeaders(body, opts.headers), body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() as Rpc, res };
}

async function legacy(method: string, params: Record<string, unknown> = {}): Promise<{ status: number; body: Rpc }> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return { status: res.status, body: res.status === 202 ? {} : await res.json() as Rpc };
}

async function legacyTool(name: string, args: Record<string, unknown>): Promise<any> {
  const r = await legacy('tools/call', { name, arguments: args });
  return JSON.parse(r.body.result?.['content']?.[0]?.text ?? 'null');
}

/** Reads a text/event-stream response to its end and returns the JSON-RPC messages in order. */
async function sseMessages(res: Response): Promise<any[]> {
  const text = await res.text();
  return text.split('\n\n').map((block) => block.split('\n').find((l) => l.startsWith('data: '))).filter((l): l is string => l !== undefined).map((l) => JSON.parse(l.slice(6)));
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-mcp-modern-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});
afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('MCP 2026-07-28: discovery, versions, headers', () => {
  it('server/discover answers without any handshake and names the revision, capabilities and server', async () => {
    const r = await modern('server/discover');
    expect(r.status).toBe(200);
    expect(r.body.result).toMatchObject({ resultType: 'complete', supportedVersions: [V], capabilities: { tools: {}, extensions: { [TASKS]: {} } }, cacheScope: 'private' });
    expect(r.body.result!['_meta']['io.modelcontextprotocol/serverInfo'].name).toBe('remote-workflow-engine');
    expect(typeof r.body.result!['instructions']).toBe('string');
    expect(typeof r.body.result!['ttlMs']).toBe('number');
  });

  it('tools/list and tools/call work with no initialize and carry resultType', async () => {
    const list = await modern('tools/list');
    expect(list.body.result).toMatchObject({ resultType: 'complete', cacheScope: 'public' });
    expect(list.body.result!['tools'].map((t: { name: string }) => t.name)).toContain('run_start');
    const call = await modern('tools/call', { name: 'workflow_list', arguments: {} });
    expect(call.status).toBe(200);
    expect(call.body.result!['resultType']).toBe('complete');
    expect(JSON.parse(call.body.result!['content'][0].text)).toBeTypeOf('object');
  });

  it('an unsupported version is HTTP 400 with -32022 and the supported list', async () => {
    const body = modernBody('tools/list');
    (body['params'] as any)._meta['io.modelcontextprotocol/protocolVersion'] = '1900-01-01';
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, { method: 'POST', headers: modernHeaders(body, { 'MCP-Protocol-Version': '1900-01-01' }), body: JSON.stringify(body) });
    expect(res.status).toBe(400);
    const j = await res.json() as Rpc;
    expect(j.error).toMatchObject({ code: -32022, data: { requested: '1900-01-01' } });
    expect(j.error!.data.supported).toContain(V);
  });

  it('missing or mismatched headers are HTTP 400 with -32020', async () => {
    for (const over of [{ 'MCP-Protocol-Version': undefined }, { 'MCP-Protocol-Version': '2025-11-25' }, { 'Mcp-Method': undefined }, { 'Mcp-Method': 'tools/list' }, { 'Mcp-Name': undefined }, { 'Mcp-Name': 'run_start' }]) {
      const r = await modern('tools/call', { name: 'workflow_list', arguments: {} }, { headers: over });
      expect([r.status, r.body.error?.code], JSON.stringify(over)).toEqual([400, -32020]);
    }
  });

  it('Mcp-Name may be base64-encoded and is decoded before comparing', async () => {
    const enc = `=?base64?${Buffer.from('workflow_list').toString('base64')}?=`;
    const r = await modern('tools/call', { name: 'workflow_list', arguments: {} }, { headers: { 'Mcp-Name': enc } });
    expect(r.status).toBe(200);
  });

  it('an unknown method and the removed ping are HTTP 404 with -32601; a notification is 202', async () => {
    for (const m of ['resources/list', 'ping']) {
      const r = await modern(m);
      expect([r.status, r.body.error?.code], m).toEqual([404, -32601]);
    }
    const body = modernBody('notifications/cancelled');
    delete body['id'];
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, { method: 'POST', headers: modernHeaders(body), body: JSON.stringify(body) });
    expect(res.status).toBe(202);
  });

  it('GET and DELETE /mcp are 405', async () => {
    for (const method of ['GET', 'DELETE']) {
      const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, { method });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('POST');
    }
  });
});

describe('MCP 2026-07-28: the handshake era is still served on the same endpoint', () => {
  it('initialize echoes a handshake-era revision and never claims the stateless one', async () => {
    const old = await legacy('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(old.body.result!['protocolVersion']).toBe('2025-06-18');
    const asksNew = await legacy('initialize', { protocolVersion: V, capabilities: {}, clientInfo: { name: 't', version: '1' } });
    expect(asksNew.body.result!['protocolVersion']).toBe('2025-11-25');
    const none = await legacy('initialize', {});
    expect(none.body.result!['protocolVersion']).toBe('2025-06-18');
  });

  it('a handshake-era client sees the old shapes: no resultType, ping answers, unknown method is HTTP 200', async () => {
    const list = await legacy('tools/list');
    expect(list.body.result!['resultType']).toBeUndefined();
    expect((await legacy('ping')).body.result).toEqual({});
    const unknown = await legacy('resources/list');
    expect([unknown.status, unknown.body.error?.code]).toEqual([200, -32601]);
    expect((await legacy('tasks/get', { taskId: 'x' })).body.error?.code).toBe(-32601);
  });
});

describe('MCP 2026-07-28: tasks extension and subscriptions/listen', () => {
  async function registered(script: string): Promise<string> {
    const name = uniqueWorkflowName();
    await registerPublishedVia(legacyTool, name, script);
    return name;
  }
  const AS_TASK = { 'com.remote-workflow-engine/runAsTask': true };
  // The sandbox has no timers; a promise that never settles is how a run stays running until stopped.
  const HANGS = 'await new Promise(() => {}); return 1;';

  it('run_start answers with the plain envelope unless the client declared tasks AND asked for one', async () => {
    const name = await registered('return "a";');
    const plain = await modern('tools/call', { name: 'run_start', arguments: { name } });
    expect(plain.body.result!['resultType']).toBe('complete');
    const declaredOnly = await modern('tools/call', { name: 'run_start', arguments: { name } }, { tasks: true });
    expect(declaredOnly.body.result!['resultType']).toBe('complete');
    const askedOnly = await modern('tools/call', { name: 'run_start', arguments: { name } }, { meta: AS_TASK });
    expect(askedOnly.body.result!['resultType']).toBe('complete');
  });

  it('run_start as a task: CreateTaskResult, then tasks/get reaches completed with the run result', async () => {
    const name = await registered('return { answer: "done" };');
    const created = await modern('tools/call', { name: 'run_start', arguments: { name } }, { tasks: true, meta: AS_TASK });
    expect(created.body.result).toMatchObject({ resultType: 'task', status: 'working', ttlMs: null });
    const taskId = created.body.result!['taskId'] as string;
    expect(taskId).toBeTruthy();
    let task: Record<string, any> = {};
    for (let i = 0; i < 100; i++) {
      task = (await modern('tasks/get', { taskId }, { tasks: true })).body.result!;
      if (task['status'] !== 'working') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(task).toMatchObject({ resultType: 'complete', taskId, status: 'completed' });
    const envelope = JSON.parse(task['result'].content[0].text);
    expect(envelope.result).toEqual({ answer: 'done' });
    expect(task['result']._meta['com.remote-workflow-engine/runStatus'].status).toBe('completed');
  });

  it('a failed run is a completed task whose result says isError', async () => {
    const name = await registered('throw new Error("boom");');
    const created = await modern('tools/call', { name: 'run_start', arguments: { name } }, { tasks: true, meta: AS_TASK });
    const taskId = created.body.result!['taskId'] as string;
    let task: Record<string, any> = {};
    for (let i = 0; i < 100; i++) {
      task = (await modern('tasks/get', { taskId }, { tasks: true })).body.result!;
      if (task['status'] !== 'working') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(task['status']).toBe('completed');
    expect(task['result'].isError).toBe(true);
  });

  it('task methods need the declared capability (-32021) and a real task (-32602)', async () => {
    const undeclared = await modern('tasks/get', { taskId: 'x' });
    expect([undeclared.status, undeclared.body.error?.code]).toEqual([400, -32021]);
    expect(undeclared.body.error!.data.requiredCapabilities.extensions[TASKS]).toEqual({});
    for (const m of ['tasks/get', 'tasks/cancel', 'tasks/update']) {
      const r = await modern(m, { taskId: 'no-such-run' }, { tasks: true });
      expect(r.body.error?.code, m).toBe(-32602);
    }
  });

  it('subscriptions/listen pushes the finished task: acknowledged first, then notifications/tasks, then the response', async () => {
    const name = await registered('return { answer: "pushed" };');
    const created = await modern('tools/call', { name: 'run_start', arguments: { name } }, { tasks: true, meta: AS_TASK });
    const taskId = created.body.result!['taskId'] as string;
    const body = modernBody('subscriptions/listen', { notifications: { taskIds: [taskId, 'no-such-run'], toolsListChanged: true } }, { tasks: true, id: 'sub-1' });
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, { method: 'POST', headers: modernHeaders(body), body: JSON.stringify(body) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const msgs = await sseMessages(res);
    expect(msgs.map((m) => m.method ?? 'response')).toEqual(['notifications/subscriptions/acknowledged', 'notifications/tasks', 'response']);
    // Only what the server agreed to: the real task, not the unknown id and not toolsListChanged.
    expect(msgs[0].params).toEqual({ _meta: { 'io.modelcontextprotocol/subscriptionId': 'sub-1' }, notifications: { taskIds: [taskId] } });
    expect(msgs[1].params).toMatchObject({ taskId, status: 'completed', _meta: { 'io.modelcontextprotocol/subscriptionId': 'sub-1' } });
    expect(JSON.parse(msgs[1].params.result.content[0].text).result, msgs[1].params.result.content[0].text).toEqual({ answer: 'pushed' });
    expect(msgs[2]).toMatchObject({ id: 'sub-1', result: { resultType: 'complete', _meta: { 'io.modelcontextprotocol/subscriptionId': 'sub-1' } } });
  });

  it('subscriptions/listen with nothing it can deliver acknowledges an empty filter and ends', async () => {
    const body = modernBody('subscriptions/listen', { notifications: { toolsListChanged: true } }, { id: 7 });
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, { method: 'POST', headers: modernHeaders(body), body: JSON.stringify(body) });
    const msgs = await sseMessages(res);
    expect(msgs[0].params.notifications).toEqual({});
    expect(msgs[1].id).toBe(7);
  });

  it('an open subscription is told the moment the run ends (here: when it is cancelled)', async () => {
    const name = await registered(HANGS);
    const created = await modern('tools/call', { name: 'run_start', arguments: { name } }, { tasks: true, meta: AS_TASK });
    const taskId = created.body.result!['taskId'] as string;
    const body = modernBody('subscriptions/listen', { notifications: { taskIds: [taskId] } }, { tasks: true, id: 9 });
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, { method: 'POST', headers: modernHeaders(body), body: JSON.stringify(body) });
    const reading = sseMessages(res);
    await new Promise((r) => setTimeout(r, 300));
    const stillOpen = await Promise.race([reading.then(() => false), new Promise<boolean>((r) => setTimeout(() => r(true), 50))]);
    expect(stillOpen).toBe(true);
    await modern('tasks/cancel', { taskId }, { tasks: true });
    const msgs = await reading;
    expect(msgs.map((m) => m.method ?? 'response')).toEqual(['notifications/subscriptions/acknowledged', 'notifications/tasks', 'response']);
    expect(msgs[1].params).toMatchObject({ taskId, status: 'cancelled' });
  });

  it('tasks/cancel stops a running run and the task ends cancelled', async () => {
    const name = await registered(HANGS);
    const created = await modern('tools/call', { name: 'run_start', arguments: { name } }, { tasks: true, meta: AS_TASK });
    const taskId = created.body.result!['taskId'] as string;
    const cancel = await modern('tasks/cancel', { taskId }, { tasks: true });
    expect(cancel.body.result).toMatchObject({ resultType: 'complete' });
    let status = '';
    for (let i = 0; i < 100 && status !== 'cancelled'; i++) {
      status = (await modern('tasks/get', { taskId }, { tasks: true })).body.result!['status'];
      if (status !== 'cancelled') await new Promise((r) => setTimeout(r, 50));
    }
    expect(status).toBe('cancelled');
  });
});
