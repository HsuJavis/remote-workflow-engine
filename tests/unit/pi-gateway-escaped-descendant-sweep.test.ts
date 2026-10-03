// pi harness v1, residual fix: a REAL confirmed defect (found via the real-tier MCP abort test,
// tests/acceptance/pi-harness-mcp-real.test.ts) — `npm exec`/`npx` (what every stdio MCP server
// config in this engine uses to launch, e.g. `npx -y @modelcontextprotocol/server-everything`)
// calls `setpgid`/`setsid` on itself immediately on start, becoming its OWN process group leader —
// confirmed empirically via `ps -eo pid,pgid,sid`: the npm-exec process's pgid equals its OWN pid,
// not the pi child's. The existing `killGroup(-childPid)` (#129 semantics) can therefore NEVER reach
// it or its own children on abort/timeout: a real, reproducible leak, not a hypothetical. This test
// reproduces the EXACT escape mechanism with a real `setsid` grandchild (no real npx/MCP needed) and
// proves the fix: capturing the full descendant PID tree via /proc BEFORE any kill signal is sent,
// then killing every captured pid directly — reaches a process regardless of which group it is in.
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';
import type { AgentOpts } from '../../src/types.js';

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

describe('PiGatewayClient — kills a process-group-escaped grandchild on abort (residual fix)', () => {
  it('a setsid-escaped grandchild (same shape npm exec/npx uses) is dead after abort, even though it is NOT in the pi child\'s process group', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'rwe-pi-escape-'));
    const pidFile = join(scratch, 'grandchild.pid');
    try {
      // Stands in for `entry.ts`: a real detached process (same spawn shape pi-gateway-client.ts
      // itself uses) that immediately forks a setsid'd grandchild (the exact escape mechanism npm
      // exec uses) and then idles, so it stays alive until the gateway's own abort sequence kills it.
      const spawnChild = (() => spawn('bash', ['-c', `setsid sleep 60 & echo -n $! > '${pidFile}'; sleep 60`], {
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })) as never;
      const gw = new PiGatewayClient({ spawnChild, entryPath: '/unused' });
      const controller = new AbortController();
      const promise = gw.invoke({
        prompt: 'hi', opts: { model: 'ollama/qwen2.5:7b' } as AgentOpts,
        runId: 'escape-r1', agentId: 'escape-a1', workspace: scratch, signal: controller.signal,
      });
      // Give the shell time to actually write the grandchild pid file before aborting.
      await new Promise((r) => setTimeout(r, 400));
      expect(existsSync(pidFile)).toBe(true);
      const grandchildPid = Number(readFileSync(pidFile, 'utf8').trim());
      expect(grandchildPid).toBeGreaterThan(0);
      expect(pidAlive(grandchildPid)).toBe(true);

      controller.abort();
      await promise;
      await new Promise((r) => setTimeout(r, 500));
      expect(pidAlive(grandchildPid)).toBe(false);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }, 20_000);
});
