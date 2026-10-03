// pi harness v1, slice (e) real-tier evidence: REAL srt (bwrap+socat+ripgrep override) bash
// confinement through PiGatewayClient + a REAL local Ollama, replicating VAL-253's own sdk-path
// evidence shape (own workspace read/write, sibling-workspace ENOENT, RWE_SECRET_* canary
// invisible, toolchain still runs) for the pi path specifically — plus the real pi-path confinement
// probe. Gated (it.skipIf) on bwrap/socat/ollama/the ripgrep-override binary all being present, same
// convention as val-253-bash-confinement.test.ts.
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';
import { probePiPath } from '../../src/gateway/pi-confinement-probe.js';
import { resolveRipgrepOverride } from '../../src/gateway/pi-child/ripgrep-override.js';

function hasBinary(cmd: string): boolean {
  try { execSync(`which ${cmd}`, { stdio: 'ignore' }); return true; } catch { return false; }
}
function ollamaReachable(): boolean {
  try {
    return execSync('curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://localhost:11434/api/tags', { encoding: 'utf8' }).trim() === '200';
  } catch {
    return false;
  }
}
const HAS_BWRAP = hasBinary('bwrap');
const HAS_SOCAT = hasBinary('socat');
const HAS_RG_OVERRIDE = resolveRipgrepOverride() !== null;
const HAS_OLLAMA = ollamaReachable();
const HAS_CONFINED_RUNTIME = HAS_BWRAP && HAS_SOCAT && HAS_RG_OVERRIDE && HAS_OLLAMA;
const WHY_NOT = ' [UNVERIFIED here: needs bwrap + socat + a bundled ripgrep-override CLI binary + a reachable local Ollama]';

/** qwen2.5:7b (a 7B model) is observed to occasionally produce NO tool call at all within the
 *  timeout (a zero-usage timeout: `message_end` never even fired once) — a real small-model
 *  characteristic, not a defect in the harness. Retried ONLY for that exact shape. Deliberately
 *  narrow: a timeout that already accrued usage (`partial:true` with nonzero tokens — the model DID
 *  call the tool and something hung downstream, e.g. the apply-seccomp regression this suite exists
 *  to catch) or any `SANDBOX_UNAVAILABLE` detail fails IMMEDIATELY, never retried — masking either
 *  would defeat the point of this real-tier test. */
async function retryReal<T extends { ok: boolean; reason?: string; detail?: string; tokens?: { output: number } }>(
  fn: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let last: T | undefined;
  for (let i = 0; i < attempts; i++) {
    last = await fn();
    if (last.ok) return last;
    const neverCalledTheTool = last.reason === 'timeout' && (last.tokens?.output ?? 0) === 0;
    if (!neverCalledTheTool) return last; // a real failure shape — surface it now, don't retry
  }
  return last!;
}

describe('pi harness v1 — REAL srt bash confinement (slice e)', () => {
  it.skipIf(!HAS_CONFINED_RUNTIME)('a real bash call through a real srt wrap: own workspace OK, sibling ENOENT, canary invisible' + WHY_NOT, async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-pi-confined-'));
    const ws = join(workRoot, 'ws');
    const sibling = join(workRoot, 'sibling');
    mkdirSync(ws, { recursive: true });
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(ws, 'own.txt'), 'own-file-content');
    writeFileSync(join(sibling, 'secret.txt'), 'sibling-secret-should-be-invisible');
    const originalCanary = process.env['RWE_SECRET_CANARY'];
    process.env['RWE_SECRET_CANARY'] = 'CANARY-SHOULD-NOT-LEAK-12345';
    try {
      const gw = new PiGatewayClient({
        ollamaBaseUrl: 'http://localhost:11434',
        timeoutMs: 60_000,
        confinementPosture: 'confined',
        confinement: { allowHostPaths: [], protectedFiles: [], workRoot },
      });
      const result = await retryReal(() => gw.invoke({
        prompt: 'Call the bash tool ONCE with this exact command and then report the raw output verbatim: cat own.txt; echo SEP; cat ../sibling/secret.txt 2>&1; echo SEP; printenv RWE_SECRET_CANARY',
        opts: { model: 'ollama/qwen2.5:7b', allowedTools: ['Bash'] },
        runId: 'confined-r1',
        agentId: 'confined-a1',
        workspace: ws,
      }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        const text = String(result.content);
        expect(text).toContain('own-file-content');
        // ENOENT (tmpfs-over-denied-dir), never the real secret content.
        expect(text).not.toContain('sibling-secret-should-be-invisible');
        // The canary must never appear — proves buildBashEnv's allowlist (not srt's own wide `env`
        // return value) is what actually reaches the sandboxed shell.
        expect(text).not.toContain('CANARY-SHOULD-NOT-LEAK-12345');
      }
    } finally {
      if (originalCanary === undefined) delete process.env['RWE_SECRET_CANARY'];
      else process.env['RWE_SECRET_CANARY'] = originalCanary;
      rmSync(workRoot, { recursive: true, force: true });
      await new Promise((r) => setTimeout(r, 300));
    }
  }, 240_000);

  it.skipIf(!HAS_CONFINED_RUNTIME)('the toolchain (node) still runs inside the confined bash' + WHY_NOT, async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-pi-confined-toolchain-'));
    const ws = join(workRoot, 'ws');
    mkdirSync(ws, { recursive: true });
    try {
      const gw = new PiGatewayClient({
        ollamaBaseUrl: 'http://localhost:11434',
        timeoutMs: 60_000,
        confinementPosture: 'confined',
        confinement: { allowHostPaths: [], protectedFiles: [], workRoot, homeDir: process.env['HOME'], allowReadPaths: [dirname(process.execPath)] },
      });
      const result = await retryReal(() => gw.invoke({
        prompt: 'Call the bash tool ONCE with this exact command and report the raw output verbatim: node --version',
        opts: { model: 'ollama/qwen2.5:7b', allowedTools: ['Bash'] },
        runId: 'confined-r2',
        agentId: 'confined-a2',
        workspace: ws,
      }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(String(result.content)).toMatch(/v\d+\.\d+\.\d+/);
    } finally {
      rmSync(workRoot, { recursive: true, force: true });
    }
  }, 240_000);
});

describe('pi harness v1 — srt-mux socket cleanup (residual fix)', () => {
  it.skipIf(!HAS_CONFINED_RUNTIME)('leaves no srt-mux-*.sock behind after a real confined bash dispatch' + WHY_NOT, async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-pi-confined-sweep-'));
    const ws = join(workRoot, 'ws');
    mkdirSync(ws, { recursive: true });
    const baseline = new Set(readdirSync(tmpdir()).filter((f) => f.startsWith('srt-mux-')));
    try {
      const gw = new PiGatewayClient({
        ollamaBaseUrl: 'http://localhost:11434',
        timeoutMs: 60_000,
        confinementPosture: 'confined',
        confinement: { allowHostPaths: [], protectedFiles: [], workRoot },
      });
      await retryReal(() => gw.invoke({
        prompt: 'Call the bash tool ONCE with this exact command and report the raw output verbatim: echo hello',
        opts: { model: 'ollama/qwen2.5:7b', allowedTools: ['Bash'] },
        runId: 'confined-sweep-r1',
        agentId: 'confined-sweep-a1',
        workspace: ws,
      }));
      await new Promise((r) => setTimeout(r, 300));
      const after = readdirSync(tmpdir()).filter((f) => f.startsWith('srt-mux-') && !baseline.has(f));
      expect(after).toEqual([]);
    } finally {
      rmSync(workRoot, { recursive: true, force: true });
    }
  }, 240_000);
});

describe('pi harness v1 — pi-path confinement probe (slice e)', () => {
  it.skipIf(!HAS_BWRAP || !HAS_SOCAT || !HAS_RG_OVERRIDE)('measures confined on a real host with bwrap/socat/ripgrep-override present' + WHY_NOT, async () => {
    const result = await probePiPath();
    expect(result.posture).toBe('confined');
  }, 20_000);
});
