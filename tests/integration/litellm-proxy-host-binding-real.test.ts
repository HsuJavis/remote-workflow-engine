// Security fix (LAN exposure): LiteLLMProxyManager spawned `litellm --config <cfg> --port <port>`
// with no `--host`, and LiteLLM's own CLI defaults to binding 0.0.0.0 in that case; the generated
// config carries no master key either, so anyone on the LAN could use the proxy — and every provider
// key in its env (D-V2G8-1(c)) — with no auth. Verified on production before this fix:
// `curl http://<LAN-IP>:<proxyPort>/health/liveliness` answered 200 from another interface. The
// engine itself only ever talks to the proxy over `http://127.0.0.1:<port>` (litellm-proxy.ts's own
// `baseUrl`) — nothing legitimate needs it reachable from anywhere else.
//
// `litellm-proxy-hardening.test.ts` pins the SPAWN ARGS (`--host 127.0.0.1` on the argv, no real
// binary). This file is the real-tier proof the argument actually closes the hole: a genuine
// `litellm` subprocess, reachable on loopback, refused on a real non-loopback interface address.
// Mock policy: none — the SUT's own injectable spawnImpl is left at its default (the real `spawn`),
// only redirecting the bare `litellm` command name to the installed venv binary (this host doesn't
// put it on PATH; production's systemd unit does — see DEPLOY.md).
//
// Skips (both independently, named in the test titles): no `litellm` binary resolvable anywhere, or
// no non-loopback IPv4 interface to dial (a container with only `lo` — the case this repo's existing
// D-BIND real-tier tests already skip the same way, see val-099-bind-fail-closed.test.ts).
import { describe, it, expect, afterEach } from 'vitest';
import { spawn as realSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { LiteLLMProxyManager } from '../../src/gateway/litellm-proxy.js';

// ── resolve a real `litellm` binary (bare "litellm" is not on PATH on every host — measured on this
//    one; production's systemd PATH carries the venv, see DEPLOY.md §6c) ──────────────────────────
function resolveLitellmBin(): string | undefined {
  const envOverride = process.env['RWE_LITELLM_BIN'];
  if (envOverride !== undefined && existsSync(envOverride)) return envOverride;
  try {
    const onPath = execFileSync('which', ['litellm'], { encoding: 'utf8' }).trim();
    if (onPath.length > 0) return onPath;
  } catch { /* not on PATH — fall through to the venv default below */ }
  const venvDefault = join(homedir(), '.rwe-litellm-venv', 'bin', 'litellm');
  return existsSync(venvDefault) ? venvDefault : undefined;
}
const LITELLM_BIN = resolveLitellmBin();

// ── a real, non-internal IPv4 to dial from "outside" loopback ──────────────────────────────────
function getLanIp(): string | undefined {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return undefined;
}
const LAN_IP = getLanIp();

const skipReason =
  LITELLM_BIN === undefined ? ' [SKIPPED: no litellm binary found on PATH or in ~/.rwe-litellm-venv/bin — set RWE_LITELLM_BIN]'
  : LAN_IP === undefined ? ' [SKIPPED: no non-loopback IPv4 interface on this host]'
  : '';
const HAS_EVERYTHING = LITELLM_BIN !== undefined && LAN_IP !== undefined;

describe('LiteLLMProxyManager — real litellm subprocess is loopback-only (security fix, real-tier)', () => {
  let proxy: LiteLLMProxyManager | undefined;

  afterEach(async () => {
    await proxy?.stop();
    proxy = undefined;
  });

  it.skipIf(!HAS_EVERYTHING)(
    'reachable on 127.0.0.1, refused on the real LAN interface address' + skipReason,
    async () => {
      proxy = new LiteLLMProxyManager({
        // no fixed `port` — the dynamic-ephemeral-port path, avoiding the shared 481xx test-port
        // range this file's unit-tier siblings already occupy.
        startupTimeoutMs: 60000, // a cold Python venv boot is measurably slower than the 20s default
        spawnImpl: ((cmd: string, args: readonly string[], opts: unknown) =>
          realSpawn(cmd === 'litellm' ? LITELLM_BIN! : cmd, args as string[], opts as never)) as unknown as typeof import('node:child_process').spawn,
      });

      const { baseUrl } = await proxy.start();

      // Loopback: the engine's own real usage path — must still work.
      const loopback = await fetch(`${baseUrl}/health/liveliness`);
      expect(loopback.ok).toBe(true);

      // Non-loopback: the actual vulnerability this fix closes. Before the `--host 127.0.0.1` fix,
      // this same request answered 200 (reproduced manually against a real subprocess while writing
      // this test — LiteLLM's own CLI binds 0.0.0.0 by default with no `--host`). A refused TCP
      // connection (ECONNREFUSED, surfaced by `fetch` as a rejected promise) is the closed state;
      // it must not merely time out or 4xx, either of which would still mean something answered.
      const port = new URL(baseUrl).port;
      await expect(
        fetch(`http://${LAN_IP}:${port}/health/liveliness`, { signal: AbortSignal.timeout(3000) }),
      ).rejects.toThrow();
    },
    90000,
  );
});
