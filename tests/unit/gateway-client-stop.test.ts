// UT-036: GatewayClient gains an optional stop()/dispose() lifecycle hook (D-V2I-6, ORCH binding).
//
// Real defect (v1 DEPLOY known-open orphan-subprocess item, re-confirmed multiple Gate 7.5 rounds):
// `src/server.ts`'s `createServer()` builds its DEFAULT gateway as
// `new LiteLLMGatewayClient({ ..., useLiteLLMProxy: config?.useLiteLLMProxy ?? true, ... })` — when
// no `config.proxyManager` is injected (the real, non-test path), `LiteLLMGatewayClient`'s own
// constructor internally builds its own private `LiteLLMProxyManager` (`this._proxy`). Today
// NEITHER `GatewayClient` (the interface) NOR `Server.close()` (`src/server.ts`) has any way to
// reach/stop that internally-constructed instance — `main.ts`'s own shutdown handler explicitly
// documents this exact gap in its own comment ("No-op when gateway:'direct-fetch' (no proxy was
// created by composeConfig() in that branch)" — `composeConfig()` only ever tracks a `proxyManager`
// on the 'sdk' branch; the 'direct-fetch' branch's proxy is a private detail of the
// `LiteLLMGatewayClient` instance `createServer()` builds, invisible to `main.ts`). So a real
// `litellm` subprocess spawned by the direct-fetch/legacy gateway path outlives a graceful
// SIGTERM/SIGINT shutdown today — the exact orphan-subprocess hazard repeatedly reproduced live at
// Gate 7.5 (round 5/6's "litellm port-4000 collision" finding), just for a different root cause
// than the already-fixed 'sdk' branch (D-F10/TASK-027 fixed that one via `config.proxyManager`).
//
// Fix direction (not implemented here — Gate 6's job): `GatewayClient` gains an optional
// `stop?(): Promise<void>` method; `LiteLLMGatewayClient.stop()` delegates to its own `this._proxy`
// (whichever `LiteLLMProxyManager` it holds — injected OR internally-constructed, same field
// either way); `src/server.ts`'s `Server.close()` calls `gateway.stop?.()` alongside `http.close()`
// so shutdown reaps the proxy regardless of which gateway-selection branch built it.
//
// Mock policy (DES-015, unit tier): mocks freely — `LiteLLMProxyManager.prototype.stop` is spied
// (never a real `litellm` binary spawned; the "internally-constructed, no injected proxyManager"
// case is the whole point of this test, so a fake `proxyManager` seam can't be used here without
// defeating the point).
import { describe, it, expect, vi } from 'vitest';
import { LiteLLMGatewayClient } from '../../src/gateway/client.js';
import { LiteLLMProxyManager } from '../../src/gateway/litellm-proxy.js';

type MaybeStoppable = { stop?: () => Promise<void> };

describe('LiteLLMGatewayClient: optional stop()/dispose() (D-V2I-6)', () => {
  it('stop() cascades to an internally-constructed LiteLLMProxyManager (no proxyManager injected)', async () => {
    const stopSpy = vi.spyOn(LiteLLMProxyManager.prototype, 'stop').mockResolvedValue(undefined);
    try {
      const gateway = new LiteLLMGatewayClient({
        timeoutMs: 1000,
        retries: 0,
        useLiteLLMProxy: true, // no proxyManager injected -> LiteLLMGatewayClient builds its own
      });

      await (gateway as unknown as MaybeStoppable).stop?.();

      expect(stopSpy).toHaveBeenCalledTimes(1);
    } finally {
      stopSpy.mockRestore();
    }
  });

  it('stop() cascades to an explicitly-injected proxyManager the same way', async () => {
    const fakeProxy = { start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined), baseUrl: undefined } as unknown as LiteLLMProxyManager;
    const gateway = new LiteLLMGatewayClient({
      timeoutMs: 1000,
      retries: 0,
      useLiteLLMProxy: true,
      proxyManager: fakeProxy,
    });

    await (gateway as unknown as MaybeStoppable).stop?.();

    expect(fakeProxy.stop).toHaveBeenCalledTimes(1);
  });

  it('stop() is a safe no-op on the plain direct-fetch path (useLiteLLMProxy unset, no proxy ever built)', async () => {
    // Non-forcing regression guard (documented transparently, same precedent as UT-020's
    // Anthropic-alias case / IT-016's "unknown agentType still fails fast" case): passes trivially
    // today via `stop?.()` optional-chaining to `undefined` (no method exists at all yet), and must
    // keep passing (no throw) once `stop()` is genuinely implemented for this no-proxy case too.
    const gateway = new LiteLLMGatewayClient({
      timeoutMs: 1000,
      retries: 0,
    });

    await (gateway as unknown as MaybeStoppable).stop?.();
  });
});
