// IT-308 (DES-272, ARCH-186, TASK-269): real forked sandbox child — `agent`, `decide`,
// `generateImage` interleaved draw CONSECUTIVE callSeqs from ONE shared counter;
// `onDecideRequest`/`onImageRequest` mirror `onAgentRequest`'s own shape (phase snapshot, deferred
// handler); absent handler -> coded fallback; an uncoded primitive throw -> INTERNAL_ERROR (never
// AGENT_ERROR).
//
// Real fork, no mocks (IT tier — real adjacent component): a genuine `node:child_process.fork`
// sandbox child process.
//
// Red reason: `SandboxHostConfig.onDecideRequest`/`.onImageRequest` do not exist — the host never
// routes a `{t:'decide'}`/`{t:'image'}` child IPC message anywhere (and the child cannot send one,
// since `decide`/`generateImage` are not sandbox globals yet — see UT-350). Every case below either
// times out resolving `undefined` or surfaces the pre-existing `SCRIPT_ERROR`/ReferenceError path.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SandboxHost } from '../../src/sandbox/host.js';

describe('IT-308: real-child callSeq sharing and IPC routing for decide/generateImage (DES-272)', () => {
  it('agent, decide, generateImage interleaved draw consecutive callSeqs from ONE shared counter', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'rwe-primitive-ipc-'));
    const seen: { kind: string; callSeq: number }[] = [];
    try {
      const host = new SandboxHost({
        workspaceRoot,
        onAgentRequest: async (_p: string, _o: unknown, callSeq: number) => { seen.push({ kind: 'agent', callSeq }); return 'ok'; },
        onDecideRequest: async (msg: { callSeq: number }) => { seen.push({ kind: 'decide', callSeq: msg.callSeq }); return { answers: {} }; },
        onImageRequest: async (msg: { callSeq: number }) => { seen.push({ kind: 'image', callSeq: msg.callSeq }); return { files: [] }; },
      } as never);
      const r = await host.run('run-interleaved', `
        const a = await agent('x', {});
        const d = await decide('gate', {state:{}, questions:{}});
        const i = await generateImage('hero', {prompt:'p'});
        return [a, d, i];
      `, undefined, null);
      expect('result' in r).toBe(true);
      const callSeqs = seen.map((s) => s.callSeq);
      expect(callSeqs).toEqual([...callSeqs].sort((a, b) => a - b));
      expect(new Set(callSeqs).size).toBe(3);
      expect(seen.map((s) => s.kind)).toEqual(['agent', 'decide', 'image']);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('absent onDecideRequest handler -> the same coded fallback case "workflow" uses when onWorkflowRequest is absent', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'rwe-primitive-ipc-fallback-'));
    try {
      const host = new SandboxHost({ workspaceRoot } as never);
      const r = await host.run('run-no-handler', `
        try { await decide('gate', {state:{}, questions:{}}); return 'no-throw'; }
        catch (e) { return { code: e.code, message: e.message }; }
      `, undefined, null);
      expect('result' in r).toBe(true);
      expect((r as { result: { code?: string } }).result).toHaveProperty('code');
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('an uncoded throw from onImageRequest surfaces as INTERNAL_ERROR, never AGENT_ERROR', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'rwe-primitive-ipc-uncoded-'));
    try {
      const host = new SandboxHost({
        workspaceRoot,
        onImageRequest: async () => { throw new Error('unexpected host-side crash'); },
      } as never);
      const r = await host.run('run-uncoded', `
        try { await generateImage('hero', {prompt:'p'}); return 'no-throw'; }
        catch (e) { return { code: e.code }; }
      `, undefined, null);
      expect('result' in r).toBe(true);
      expect((r as { result: { code?: string } }).result).toEqual({ code: 'INTERNAL_ERROR' });
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
