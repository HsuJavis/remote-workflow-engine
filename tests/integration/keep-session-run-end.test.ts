// `keepSession`'s engine side: a script may write it (registration accepts the key and it reaches
// the gateway), and the run manager tells the gateway when the run ends or is suspended, so a
// gateway holding a conversation for the run (the pi gateway) can close it.
//
// Mock policy (integration tier): real RunManager, real AgentExecutor, real sandbox child, real
// registration. Only `GatewayClient` (third-party network) is faked.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import type { AgentOpts } from '../../src/types.js';
import { startScript } from '../helpers/workflow-fixtures.js';

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'rwe-keep-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function waitStatus(mgr: RunManager, runId: string, done: (s: string) => boolean): Promise<string> {
  let view = await mgr.status(runId);
  for (let i = 0; i < 200 && !done(view.status); i++) {
    await new Promise((r) => setTimeout(r, 25));
    view = await mgr.status(runId);
  }
  return view.status;
}

describe('keepSession: the script option reaches the gateway, and the run end reaches endRun', () => {
  it('a completed run calls endRun once with its run id, after the agent saw keepSession:true', async () => {
    const seen: AgentOpts[] = [];
    const ended: string[] = [];
    const gateway: GatewayClient = {
      invoke: async (req) => {
        seen.push(req.opts);
        return { ok: true, provider: 'fake', model: 'm', tokens: { input: 1, output: 1 }, content: 'ok' };
      },
      endRun: (runId) => { ended.push(runId); },
    };
    const mgr = new RunManager({ gateway, workRoot: tempDir() });
    const runId = await startScript(mgr, `await agent('talk', { prompt: 'one', keepSession: true }); return await agent('talk', { prompt: 'two', keepSession: true });`);
    expect(await waitStatus(mgr, runId, (s) => s !== 'running' && s !== 'queued')).toBe('completed');
    expect(seen.map((o) => [o.label, o.keepSession])).toEqual([['talk', true], ['talk', true]]);
    expect(ended).toEqual([runId]);
  });

  it('stopping a run calls endRun too', async () => {
    const ended: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const gateway: GatewayClient = {
      invoke: async () => {
        await held;
        return { ok: true, provider: 'fake', model: 'm', tokens: { input: 1, output: 1 }, content: 'late' };
      },
      endRun: (runId) => { ended.push(runId); },
    };
    const mgr = new RunManager({ gateway, workRoot: tempDir() });
    const runId = await startScript(mgr, `return await agent('talk', { prompt: 'hold', keepSession: true });`);
    await waitStatus(mgr, runId, (s) => s === 'running');
    await mgr.stop(runId);
    expect(ended).toEqual([runId]);
    release();
  });
});
