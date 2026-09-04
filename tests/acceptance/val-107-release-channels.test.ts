// VAL-107 (REQ-097): `beta` and `release` channels; a run resolves a channel to a version,
// defaulting to release. Real entrypoint: `createServer`, real MCP HTTP.
//
// Mock policy (acceptance, DES-119): no mocking of the SUT's own boundaries. No LLM dispatch
// needed — marker scripts distinguish which version ran.
//
// Red reason: `workflow_publish` does not exist and `run_start`/`workflow_source` accept no
// `version`/`channel` selector today — every assertion below fails against the current engine.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val107-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});
afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

async function toolCall(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}
async function pollUntilSettled(runId: string) {
  let s = await toolCall('run_status', { runId });
  for (let i = 0; i < 100 && (s['status'] === 'running' || s['status'] === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 30));
    s = await toolCall('run_status', { runId });
  }
  return s;
}
async function scriptVersionOf(runId: string): Promise<string | undefined> {
  const s = await toolCall('run_status', { runId });
  return (s['result'] as { scriptVersion?: string } | undefined)?.scriptVersion;
}

describe('REQ-097: release/beta channel resolution (VAL-107)', () => {
  it('a freshly registered version is on NO channel; publish moves the named pointer', async () => {
    const reg = await toolCall('workflow_register', { name: 'val107-flow', script: `return 'r';`, principal: 'val107-owner@example.com' });
    const v1 = (reg['result'] as { version?: string } | undefined)?.version as string;

    // v22 send-back ROUND 2 (07-review.md §4.2/§8, B1/B2): the previous pass's assertion here
    // ("anyonePublish succeeds") was itself the B2 regression — round 1's fix dropped
    // `args.principal` for `workflow_publish` UNCONDITIONALLY, which also broke no-auth
    // attribution (wrinkle 1, §4.2). The corrected fix gates the drop on `authEnabled`: on this
    // NO-AUTH server, `args.principal` remains legitimate identity for ALL THREE catalog writes
    // (register/deregister/publish alike), so ownership IS enforced here via the self-asserted
    // string, same as it was before round 1 ever touched this file. The authenticated-non-owner
    // shape (a REAL bearer, auth enabled) is separately pinned by
    // `val-097-workflow-ownership.test.ts` (bob-tries-to-publish-alice's-workflow); the
    // fully-anonymous-write-refusal-under-auth path is IT-091/IT-095.
    const anyonePublish = await toolCall('workflow_publish', { name: 'val107-flow', version: v1, channel: 'release', principal: 'not-the-owner@example.com' });
    expect(anyonePublish['code']).toBe('NOT_WORKFLOW_OWNER');

    const ownerPublish = await toolCall('workflow_publish', { name: 'val107-flow', version: v1, channel: 'beta', principal: 'val107-owner@example.com' });
    expect(ownerPublish['error']).toBeUndefined();
  });

  it('run_start({name}) with no selector runs the release version; {channel:"beta"} runs beta; explicit version wins', async () => {
    const regA = await toolCall('workflow_register', { name: 'val107-multi', script: `return 'release-marker';`, principal: 'val107-owner2@example.com' });
    const vRelease = (regA['result'] as { version?: string } | undefined)?.version as string;
    await toolCall('workflow_publish', { name: 'val107-multi', version: vRelease, channel: 'release', principal: 'val107-owner2@example.com' });

    const regB = await toolCall('workflow_register', { name: 'val107-multi', script: `return 'beta-marker';`, principal: 'val107-owner2@example.com' });
    const vBeta = (regB['result'] as { version?: string } | undefined)?.version as string;
    await toolCall('workflow_publish', { name: 'val107-multi', version: vBeta, channel: 'beta', principal: 'val107-owner2@example.com' });

    const runDefault = await toolCall('run_start', { name: 'val107-multi' });
    const runDefaultId = (runDefault['result'] as { runId?: string } | undefined)?.runId as string;
    await pollUntilSettled(runDefaultId);
    expect(await scriptVersionOf(runDefaultId)).toBe(vRelease);

    const runBeta = await toolCall('run_start', { name: 'val107-multi', channel: 'beta' });
    const runBetaId = (runBeta['result'] as { runId?: string } | undefined)?.runId as string;
    await pollUntilSettled(runBetaId);
    expect(await scriptVersionOf(runBetaId)).toBe(vBeta);

    const runExplicit = await toolCall('run_start', { name: 'val107-multi', version: vRelease, channel: 'beta' });
    const runExplicitId = (runExplicit['result'] as { runId?: string } | undefined)?.runId as string;
    await pollUntilSettled(runExplicitId);
    expect(await scriptVersionOf(runExplicitId)).toBe(vRelease); // version wins over channel, REQ-097
  });

  it('an unpublished channel is refused, naming the channel — never a silent fallback to newest', async () => {
    await toolCall('workflow_register', { name: 'val107-unpub', script: `return 1;` });
    const run = await toolCall('run_start', { name: 'val107-unpub', channel: 'beta' });
    const error = run['error'] as { code?: string; message?: string } | undefined;
    expect(error?.code).toBe('CHANNEL_UNPUBLISHED');
    expect(error?.message).toMatch(/beta/);
  });
});
