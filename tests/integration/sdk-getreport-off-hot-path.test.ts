// IT-325 (DES-280, REQ-232, TASK-278): the real @anthropic-ai/claude-agent-sdk `query()` consults
// `process.report.getReport()` (a synchronous, measured-slow call — the whole reason REQ-232
// exists) as part of ITS OWN internal CLI-path/musl-detection fallback — ONLY when it was not
// handed `pathToClaudeCodeExecutable` up front. Wiring `cliExecutable` (DES-280) through every
// `query()` call must therefore make that internal detection, and its `getReport()` call,
// disappear entirely for a normal agent() launch — REQ-232's deterministic, non-timing clause-2
// proof (the p99/max event-loop-stall measurement itself is Gate 7.5 real-tier only, per DES-280's
// own "mock policy").
//
// Mock policy (integration): the REAL `sdkQuery` export and the REAL `ClaudeAgentSdkGatewayClient`
// — only the CLI CHILD PROCESS is stubbed (a `SpawnedProcess` that exits at once, never a real
// subprocess), via a thin `queryImpl` that forwards to the real `sdkQuery` with just that one
// option swapped. The `process.report.getReport` spy is installed AFTER this module (and the SDK)
// are imported, so neither's own import-time work is counted.
//
// Red reason: `ClaudeAgentSdkGatewayConfig` has no `cliExecutable` field and
// `claude-agent-sdk-client.ts` never sets `options.pathToClaudeCodeExecutable` — every `invoke()`
// below leaves the SDK to its own internal detection regardless of config, so the "0 calls with the
// path set" side of the assertion is false today.
import { describe, it, expect, beforeAll } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { AgentOpts } from '../../src/types.js';

function fakeExitedProcess(): {
  stdin: PassThrough; stdout: PassThrough; killed: boolean; exitCode: number | null;
  kill(): boolean; on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void; off(event: string, listener: (...args: unknown[]) => void): void;
} {
  const emitter = new EventEmitter();
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const proc = {
    stdin, stdout, killed: false, exitCode: null as number | null,
    kill: () => true,
    on: (event: string, listener: (...args: unknown[]) => void) => { emitter.on(event, listener); },
    once: (event: string, listener: (...args: unknown[]) => void) => { emitter.once(event, listener); },
    off: (event: string, listener: (...args: unknown[]) => void) => { emitter.off(event, listener); },
  };
  // "exits at once" — next tick, so a listener attached synchronously after construction still
  // catches it (the real SDK attaches its exit listener immediately after spawning).
  queueMicrotask(() => {
    proc.exitCode = 0;
    stdout.end();
    emitter.emit('exit', 0, null);
  });
  return proc;
}

function req(opts: AgentOpts = {}) {
  return { prompt: 'ping', opts, runId: 'run-1', agentId: 'agent-1' };
}

describe('IT-325: the SDK\'s own getReport() fallback is skipped once pathToClaudeCodeExecutable is wired (DES-280)', () => {
  let ClaudeAgentSdkGatewayClient: typeof import('../../src/gateway/claude-agent-sdk-client.js').ClaudeAgentSdkGatewayClient;
  let sdkQuery: typeof import('@anthropic-ai/claude-agent-sdk').query;
  let getReportSpy: ReturnType<typeof import('vitest').vi.spyOn>;

  beforeAll(async () => {
    ({ ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js'));
    ({ query: sdkQuery } = await import('@anthropic-ai/claude-agent-sdk'));
    const { vi } = await import('vitest');
    // Installed AFTER both modules are imported — their own import-time work (e.g. this gateway's
    // module-level `detectMusl()`/`resolveCliExecutable()` call) is deliberately NOT counted here;
    // only what happens PER invoke() is.
    getReportSpy = vi.spyOn(process.report, 'getReport');
  });

  async function invokeOnceWithStubbedSpawn(cliExecutable: string | null | undefined): Promise<void> {
    const queryImpl = ((params: Parameters<typeof sdkQuery>[0]) =>
      sdkQuery({ ...params, options: { ...params.options, spawnClaudeCodeProcess: () => fakeExitedProcess() as never } })) as typeof sdkQuery;
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:1', queryImpl, ...(cliExecutable !== undefined ? { cliExecutable } : {}) } as never);
    await client.invoke(req()); // the stubbed child exits immediately; a non-ok GatewayResult is expected and fine.
  }

  it('10 invoke()s with the resolved CLI path set -> ZERO process.report.getReport() calls', async () => {
    getReportSpy.mockClear();
    for (let i = 0; i < 10; i++) await invokeOnceWithStubbedSpawn('/opt/claude/claude');
    expect(getReportSpy).not.toHaveBeenCalled();
  }, 20000);

  it('cliExecutable:null -> the SDK falls back to its own detection, calling getReport() at least once', async () => {
    getReportSpy.mockClear();
    await invokeOnceWithStubbedSpawn(null);
    expect(getReportSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  }, 10000);
});
