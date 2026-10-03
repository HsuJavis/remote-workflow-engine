// pi harness v1, slice (c) real-tier evidence: a REAL PiGatewayClient.invoke() dispatch through a
// REAL spawned pi-child/entry.ts process to a REAL local Ollama (qwen2.5:7b) — no fakes anywhere on
// this path. Gated (it.skipIf) on Ollama actually being reachable, same convention as
// val-253-bash-confinement.test.ts's HAS_SANDBOX_RUNTIME, so a bare `npm test` on a host with no
// Ollama stays fast/hermetic instead of failing.
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';

function ollamaReachable(): boolean {
  try {
    const code = execSync('curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://localhost:11434/api/tags', { encoding: 'utf8' }).trim();
    return code === '200';
  } catch {
    return false;
  }
}
const HAS_OLLAMA = ollamaReachable();
const NO_OLLAMA = ' [UNVERIFIED here: needs a real local Ollama at localhost:11434 with qwen2.5:7b pulled]';

describe('pi harness v1 — real ollama dispatch through PiGatewayClient (slice c)', () => {
  it.skipIf(!HAS_OLLAMA)('a real, tool-less prompt round-trips through a real spawned pi child' + NO_OLLAMA, async () => {
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-real-'));
    try {
      const gw = new PiGatewayClient({ ollamaBaseUrl: 'http://localhost:11434', timeoutMs: 60_000 });
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

      // Process baseline: no leftover pi-child process once invoke() has resolved.
      await new Promise((r) => setTimeout(r, 300));
      const leftover = execSync('pgrep -af "pi-child/entr[y]" || true', { encoding: 'utf8' }).trim();
      expect(leftover).toBe('');
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  }, 90_000);

  it.skipIf(!HAS_OLLAMA)('run_stop-style abort mid-flight reaps the child and reports a usable result' + NO_OLLAMA, async () => {
    const ws = mkdtempSync(join(tmpdir(), 'rwe-pi-real-abort-'));
    try {
      const gw = new PiGatewayClient({ ollamaBaseUrl: 'http://localhost:11434', timeoutMs: 60_000 });
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
      const leftover = execSync('pgrep -af "pi-child/entr[y]" || true', { encoding: 'utf8' }).trim();
      expect(leftover).toBe('');
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  }, 90_000);
});
