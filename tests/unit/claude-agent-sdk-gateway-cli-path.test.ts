// UT-373 (DES-280, REQ-232, TASK-278): `resolveCliExecutable`'s pure candidate-resolution table
// (the SDK 0.3.199 `lI` order), and `ClaudeAgentSdkGatewayClient`'s `cliExecutable` config wiring —
// an explicit string ALWAYS wins and is passed as `options.pathToClaudeCodeExecutable` on every
// `query()`; `null` leaves the key absent entirely (the SDK's own per-call lookup, unchanged
// legacy behavior). The "undefined -> the real module-level resolution" default case is IT-325's
// job (it needs the real host `process.platform`/`arch`/`detectMusl`, which this pure table fakes
// away on purpose).
//
// Mock policy (unit): `resolveCliExecutable` is pure (fake `resolve`/`exists`, no real fs/require);
// the gateway client's `queryImpl` is a fake generator (D-F1's own established unit-tier seam, same
// as UT-018) — nothing of the SUT's own logic is mocked.
//
// Red reason: `src/gateway/claude-agent-sdk-client.ts` exports no `resolveCliExecutable` today, and
// `ClaudeAgentSdkGatewayConfig` has no `cliExecutable` field — the resolver import fails outright,
// and the options-capture cases never see `pathToClaudeCodeExecutable` on any call.
import { describe, it, expect, vi } from 'vitest';
import type { AgentOpts } from '../../src/types.js';

function fakeSession(resultText: string) {
  return (async function* () {
    yield { type: 'result', subtype: 'success', result: resultText, usage: { input_tokens: 1, output_tokens: 1 } };
  })();
}
function req(opts: AgentOpts = {}) {
  return { prompt: 'ping', opts, runId: 'run-1', agentId: 'agent-1' };
}

describe('UT-373: resolveCliExecutable candidate table (DES-280)', () => {
  it('android -> the android-arch package only, first match wins', async () => {
    const { resolveCliExecutable } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const seen: string[] = [];
    const v = resolveCliExecutable({
      platform: 'android' as NodeJS.Platform, arch: 'arm64', musl: false,
      resolve: (spec: string) => { seen.push(spec); return `/pkg/${spec}`; },
      exists: () => true,
    });
    expect(seen).toEqual(['@anthropic-ai/claude-agent-sdk-linux-arm64-android/claude']);
    expect(v).toBe('/pkg/@anthropic-ai/claude-agent-sdk-linux-arm64-android/claude');
  });

  it('linux & musl: tries musl package FIRST, falls back to glibc', async () => {
    const { resolveCliExecutable } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const seen: string[] = [];
    const v = resolveCliExecutable({
      platform: 'linux', arch: 'x64', musl: true,
      resolve: (spec: string) => { seen.push(spec); return `/pkg/${spec}`; },
      exists: (p: string) => p.includes('musl'),
    });
    expect(seen[0]).toBe('@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude');
    expect(v).toBe('/pkg/@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude');
  });

  it('linux & !musl: tries glibc FIRST, falls back to musl', async () => {
    const { resolveCliExecutable } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const seen: string[] = [];
    const v = resolveCliExecutable({
      platform: 'linux', arch: 'x64', musl: false,
      resolve: (spec: string) => { seen.push(spec); return `/pkg/${spec}`; },
      exists: () => true,
    });
    expect(seen[0]).toBe('@anthropic-ai/claude-agent-sdk-linux-x64/claude');
    expect(v).toBe('/pkg/@anthropic-ai/claude-agent-sdk-linux-x64/claude');
  });

  it('first candidate throws in resolve() -> falls through to the second', async () => {
    const { resolveCliExecutable } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const v = resolveCliExecutable({
      platform: 'linux', arch: 'x64', musl: false,
      resolve: (spec: string) => { if (spec.endsWith('-x64/claude')) throw new Error('not found'); return `/pkg/${spec}`; },
      exists: () => true,
    });
    expect(v).toBe('/pkg/@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude');
  });

  it('every candidate throws or fails exists() -> undefined (fail-open)', async () => {
    const { resolveCliExecutable } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const v = resolveCliExecutable({
      platform: 'linux', arch: 'x64', musl: false,
      resolve: () => { throw new Error('nope'); },
      exists: () => false,
    });
    expect(v).toBeUndefined();
  });

  it('darwin/win32: platform-arch package name, .exe suffix only on win32', async () => {
    const { resolveCliExecutable } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const seen: string[] = [];
    const vDarwin = resolveCliExecutable({ platform: 'darwin', arch: 'arm64', musl: false, resolve: (s) => { seen.push(s); return `/pkg/${s}`; }, exists: () => true });
    expect(vDarwin).toBe('/pkg/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude');
    const vWin = resolveCliExecutable({ platform: 'win32', arch: 'x64', musl: false, resolve: (s) => `/pkg/${s}`, exists: () => true });
    expect(vWin).toBe('/pkg/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe');
  });
});

describe('UT-373: ClaudeAgentSdkGatewayConfig.cliExecutable wiring (DES-280)', () => {
  it("an explicit string ALWAYS wins -> every query() call carries options.pathToClaudeCodeExecutable", async () => {
    const queryMock = vi.fn().mockReturnValue(fakeSession('pong'));
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const client = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000', queryImpl: queryMock, cliExecutable: '/opt/claude/claude' });
    await client.invoke(req());
    expect(queryMock).toHaveBeenCalledTimes(1);
    const call = queryMock.mock.calls[0]![0] as { options?: { pathToClaudeCodeExecutable?: string } };
    expect(call.options?.pathToClaudeCodeExecutable).toBe('/opt/claude/claude');
  });

  it("cliExecutable:null -> the key is ABSENT (the SDK's own per-call lookup, nothing else in options changes)", async () => {
    const queryMock = vi.fn().mockReturnValue(fakeSession('pong'));
    const { ClaudeAgentSdkGatewayClient } = await import('../../src/gateway/claude-agent-sdk-client.js');
    const withPath = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000', queryImpl: queryMock, cliExecutable: '/opt/claude/claude' });
    await withPath.invoke(req());
    const optsWithPath = queryMock.mock.calls[0]![0].options as Record<string, unknown>;

    queryMock.mockClear();
    const withoutPath = new ClaudeAgentSdkGatewayClient({ baseUrl: 'http://127.0.0.1:4000', queryImpl: queryMock, cliExecutable: null });
    await withoutPath.invoke(req());
    const optsWithoutPath = queryMock.mock.calls[0]![0].options as Record<string, unknown>;

    expect(Object.prototype.hasOwnProperty.call(optsWithoutPath, 'pathToClaudeCodeExecutable')).toBe(false);
    // Nothing ELSE in the options literal changes between the two configs (REQ-232 clause 3) —
    // compared over a few known SIMPLE (non-callback) fields; `spawnClaudeCodeProcess`/`stderr`/
    // `canUseTool`/`hooks` are fresh closures per `invoke()` call by construction and have no stable
    // identity to compare structurally.
    for (const k of ['cwd', 'model', 'thinking', 'permissionMode', 'allowedTools', 'sandbox'] as const) {
      expect((optsWithoutPath as Record<string, unknown>)[k], `options.${k}`).toEqual((optsWithPath as Record<string, unknown>)[k]);
    }
  });
});

// R-v41-1: the platform packages declare no `main`/`exports`, so only the `<pkg>/claude` subpath
// resolves — a fake resolver cannot catch a wrong spec form. No fake here: the module-scope
// constant, resolved against this repo's REAL node_modules, must name an existing file.
describe('UT-373: CLI_EXECUTABLE resolves for real on this host (DES-280, R-v41-1)', () => {
  it('module-scope CLI_EXECUTABLE is an existing file under this repo\'s node_modules', async () => {
    const { existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const { CLI_EXECUTABLE } = await import('../../src/gateway/claude-agent-sdk-client.js');
    expect(CLI_EXECUTABLE).toBeDefined();
    expect(CLI_EXECUTABLE!.startsWith(resolve(__dirname, '../../node_modules/@anthropic-ai/claude-agent-sdk-'))).toBe(true);
    expect(existsSync(CLI_EXECUTABLE!)).toBe(true);
  });
});
