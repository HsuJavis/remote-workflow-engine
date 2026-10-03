// pi harness v1, slice (c) real-tier evidence: a REAL PiGatewayClient.invoke() dispatch through a
// REAL spawned pi-child/entry.ts process to a REAL local Ollama (qwen2.5:7b) — no fakes anywhere on
// this path.
//
// review B2 (HIGH): gated on the EXPLICIT opt-in RWE_PI_REAL_TESTS=1, in ADDITION to (never instead
// of) the host checks below. The old gate (Ollama reachable alone) is true on the production host too
// (user `rwe` can reach the operator's Ollama on loopback) — this test used to silently run itself,
// against a real 7B model with 60-90s timeouts, INSIDE the self-update's full-suite run.
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';
import { piRealTestsEnabled, ollamaReachable, ollamaModelPulled, isDead } from '../helpers/pi-real-gate.js';

const MODEL_TAG = 'qwen2.5:7b';
const RUN = piRealTestsEnabled() && ollamaReachable() && ollamaModelPulled(MODEL_TAG);
const WHY_NOT = ` [UNVERIFIED here: needs RWE_PI_REAL_TESTS=1, a real local Ollama at localhost:11434, and ${MODEL_TAG} pulled]`;

/** review P6-2: captures the pi child's OWN pid via the `spawnChild` test seam, so the leftover check
 *  below is scoped to the EXACT process this test spawned — never a host-wide `pgrep` pattern that
 *  would also match an unrelated pi dispatch running elsewhere on the same host (e.g. production,
 *  mid self-update). */
function spawnChildCapturingPid(capture: { pid?: number }) {
  return ((cmd: string, args: string[], opts: Record<string, unknown>) => {
    const child = spawn(cmd, args, opts);
    capture.pid = child.pid;
    return child;
  }) as never;
}

describe('pi harness v1 — real ollama dispatch through PiGatewayClient (slice c)', () => {
  it.skipIf(!RUN)('a real, tool-less prompt round-trips through a real spawned pi child' + WHY_NOT, async () => {
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-real-'));
    try {
      const captured: { pid?: number } = {};
      const gw = new PiGatewayClient({ ollamaBaseUrl: 'http://localhost:11434', timeoutMs: 60_000, spawnChild: spawnChildCapturingPid(captured) });
      const harnessCalls: unknown[] = [];
      const usages: unknown[] = [];
      const events: unknown[] = [];
      const result = await gw.invoke({
        prompt: 'Reply with exactly the single word: PONG',
        opts: { model: 'ollama/qwen2.5:7b' },
        runId: 'real-r1',
        agentId: 'real-a1',
        workspace: ws,
        onHarness: async (h) => { harnessCalls.push(h); },
        onUsage: (u) => usages.push({ ...u }),
        onEvent: (ev) => { events.push(ev); },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.provider).toBe('ollama');
        expect(result.model).toBe('qwen2.5:7b');
        expect(result.transport).toBe('pi');
        expect(typeof result.content).toBe('string');
        expect(String(result.content).toUpperCase()).toContain('PONG');
        // A real completion always reports non-zero usage — proves it was not a canned/fake call.
        expect(result.tokens.input).toBeGreaterThan(0);
        expect(result.tokens.output).toBeGreaterThan(0);
      }
      expect(harnessCalls.length).toBe(1);
      expect(usages.length).toBeGreaterThan(0);
      expect(events.length).toBeGreaterThan(0);

      // Scoped liveness check on the EXACT pid this test spawned (review P6-2) — never a host-wide
      // pgrep pattern.
      await new Promise((r) => setTimeout(r, 300));
      expect(captured.pid).toBeDefined();
      expect(isDead(captured.pid!)).toBe(true);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  }, 90_000);

  it.skipIf(!RUN)('run_stop-style abort mid-flight reaps the child and reports a usable result' + WHY_NOT, async () => {
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-real-abort-'));
    try {
      const captured: { pid?: number } = {};
      const gw = new PiGatewayClient({ ollamaBaseUrl: 'http://localhost:11434', timeoutMs: 60_000, spawnChild: spawnChildCapturingPid(captured) });
      const controller = new AbortController();
      const promise = gw.invoke({
        prompt: 'Write a very long, detailed 500-word essay about the history of the number zero.',
        opts: { model: 'ollama/qwen2.5:7b' },
        runId: 'real-r2',
        agentId: 'real-a2',
        workspace: ws,
        signal: controller.signal,
      });
      setTimeout(() => controller.abort(), 800);
      const result = await promise;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(['aborted', 'timeout', 'terminal']).toContain(result.reason);

      await new Promise((r) => setTimeout(r, 500));
      expect(captured.pid).toBeDefined();
      expect(isDead(captured.pid!)).toBe(true);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  }, 90_000);
});
