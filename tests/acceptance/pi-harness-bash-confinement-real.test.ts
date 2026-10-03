// pi harness v1, slice (e) real-tier evidence: REAL srt (bwrap+socat+ripgrep override) bash
// confinement through PiGatewayClient + a REAL local Ollama, replicating VAL-253's own sdk-path
// evidence shape (own workspace read/write, sibling-workspace ENOENT, RWE_SECRET_* canary
// invisible, toolchain still runs) for the pi path specifically — plus the real pi-path confinement
// probe.
//
// review B2 (HIGH): gated on the EXPLICIT opt-in RWE_PI_REAL_TESTS=1, in ADDITION to (never instead
// of) bwrap/socat/ollama/the ripgrep-override binary all being present — the host checks alone are
// true on the production host too (same convention as tests/helpers/pi-real-gate.ts's other callers).
import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, chmodSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';
import { probePiPath } from '../../src/gateway/pi-confinement-probe.js';
import { resolveRipgrepOverride } from '../../src/gateway/pi-child/ripgrep-override.js';
import { piRealTestsEnabled, hasBinary, ollamaReachable, ollamaModelPulled } from '../helpers/pi-real-gate.js';

const HAS_BWRAP = hasBinary('bwrap');
const HAS_SOCAT = hasBinary('socat');
const HAS_RG_OVERRIDE = resolveRipgrepOverride() !== null;
const HAS_OLLAMA = ollamaReachable() && ollamaModelPulled('qwen2.5:7b');
const OPT_IN = piRealTestsEnabled();
const HAS_CONFINED_RUNTIME = OPT_IN && HAS_BWRAP && HAS_SOCAT && HAS_RG_OVERRIDE && HAS_OLLAMA;
const HAS_PROBE_DEPS = OPT_IN && HAS_BWRAP && HAS_SOCAT && HAS_RG_OVERRIDE;
const WHY_NOT = ' [UNVERIFIED here: needs RWE_PI_REAL_TESTS=1, bwrap + socat + a bundled ripgrep-override CLI binary + a reachable local Ollama with qwen2.5:7b pulled]';

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
  it.skipIf(!HAS_PROBE_DEPS)('measures confined on a real host with bwrap/socat/ripgrep-override present' + WHY_NOT, async () => {
    const result = await probePiPath();
    expect(result.posture).toBe('confined');
  }, 20_000);

  // review L1: entry.ts's `--probe` mode (run at boot, and by `--check-config`) spawns its own
  // short-lived child that calls SandboxManager.initialize()/wrapWithSandboxArgv() (pi-path-probe.ts)
  // but never SandboxManager.reset() nor process.exit's own exit-handler race gave it a chance to —
  // the same srt-mux-<pid>-<seq>.sock leak class pi-gateway-client.ts's own `sweepSrtMuxSockets`
  // already fixed for a DISPATCH child, left open for the PROBE child. Scoped to the probe's own pid
  // prefix (`srt-mux-<pid>-`, collected from `probePiPath`'s spawned child before it exits — this
  // module exposes no pid, so instead this snapshots the WHOLE srt-mux-* name set before/after and
  // asserts no entry present after is one that was not present before, per probe call, run twice back
  // to back so a single still-settling socket from the first call cannot mask a real per-call leak).
  it.skipIf(!HAS_PROBE_DEPS)('leaves no srt-mux-*.sock file behind after the probe exits (review L1)' + WHY_NOT, async () => {
    const muxSocks = (): Set<string> => new Set(readdirSync(tmpdir()).filter((n) => n.startsWith('srt-mux-') && n.endsWith('.sock')));
    const before = muxSocks();
    await probePiPath();
    await probePiPath();
    const after = muxSocks();
    const leaked = [...after].filter((n) => !before.has(n));
    expect(leaked).toEqual([]);
  }, 30_000);
});

/** review round 3, R3-1: a REAL PiGatewayClient dispatch through REAL srt/bwrap, driven by a
 *  deterministic fake OpenRouter SSE server (one scripted `bash` tool call, then a plain reply) —
 *  no Ollama needed, only the same bwrap/socat/ripgrep-override dependencies `HAS_PROBE_DEPS`
 *  already gates on (hence these live in THIS file's "probe deps" tier, not the Ollama-requiring
 *  `HAS_CONFINED_RUNTIME` tier above). */
function startOneBashCommandServer(command: string): Promise<{ server: HttpServer; port: number; resultText: () => string }> {
  let resultText = '';
  let step = 0;
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const last = body.messages[body.messages.length - 1];
        if (last.role === 'tool') resultText = typeof last.content === 'string' ? last.content : JSON.stringify(last.content);
        const id = 'c' + step, created = 1;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        if (step === 0) {
          step++;
          res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'bash', arguments: JSON.stringify({ command }) } }] }, finish_reason: null }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: 'ALL_DONE' }, finish_reason: null }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 } })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === 'object' && addr !== null ? addr.port : 0, resultText: () => resultText });
    });
  });
}

async function dispatchOneBash(port: number, workRoot: string, command: string): Promise<string> {
  const gw = new PiGatewayClient({
    secretSource: { resolve: () => 'fake-key' }, timeoutMs: 60_000, retries: 0,
    openrouterBaseUrl: `http://127.0.0.1:${port}/api/v1`,
    confinementPosture: 'confined',
    confinement: { allowHostPaths: [], protectedFiles: [], workRoot },
    resolveRipgrepOverride,
  });
  const r = await gw.invoke({
    prompt: 'go', opts: { model: 'openrouter/fake/model', allowedTools: ['Bash'] },
    runId: 'r3-1-' + Math.random().toString(36).slice(2), agentId: 'a1', workspace: join(workRoot, 'ws'),
  });
  if (!r.ok) throw new Error(`dispatch refused: ${r.detail}`);
  return String(r.content);
}

describe('pi harness v1 — confined Bash gets its own TMPDIR, never srt\'s shared /tmp/claude (review round 3, R3-1)', () => {
  it.skipIf(!HAS_PROBE_DEPS)('mktemp works inside confined Bash, and two dispatches cannot see each other\'s TMPDIR' + WHY_NOT, async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-pi-r3-1-tmpdir-'));
    mkdirSync(join(workRoot, 'ws'), { recursive: true });
    try {
      const commandA = 't=$(mktemp) && echo "OK:$t"';
      const fakeA = await startOneBashCommandServer(commandA);
      await dispatchOneBash(fakeA.port, workRoot, commandA);
      await new Promise((r) => fakeA.server.close(() => r(undefined)));
      const resultA = fakeA.resultText(); // the REAL bash tool-result text, not the model's final reply
      expect(resultA).toMatch(/^OK:\/.+\/pi-tmp\/d-[^/]+\/tmp\./);
      const dirA = resultA.replace(/^OK:/, '').trim();
      const leafA = dirA.split('/').slice(0, -1).pop()!; // the `d-XXXX` dispatch-scoped directory name

      const commandB = `t=$(mktemp) && echo "OK:$t"; echo SEP; ls "$(dirname "$(dirname "$t")")" 2>&1`;
      const fakeB = await startOneBashCommandServer(commandB);
      await dispatchOneBash(fakeB.port, workRoot, commandB);
      await new Promise((r) => fakeB.server.close(() => r(undefined)));
      const resultB = fakeB.resultText();
      expect(resultB).toMatch(/^OK:\/.+\/pi-tmp\/d-[^/]+\/tmp\./);
      // B's own `ls` of the shared `pi-tmp` parent must list ONLY its own `d-*` directory, never A's.
      expect(resultB).not.toContain(leafA);
    } finally {
      rmSync(workRoot, { recursive: true, force: true });
    }
  }, 60_000);

  // review round 3 owner correction: masking /tmp/claude's CONTENT from inside the sandbox is not
  // achievable through srt's config surface (proved live — see PI_HOST_SHARED_TMPDIR's own doc in
  // pi-gateway-client.ts), and this engine must never delete or empty a shared host path's files, even
  // ones it believes it owns. So the only safe behavior left is a hard refusal, and the correct
  // assertion here is: the dispatch is REFUSED, and the planted file is left on the host completely
  // unchanged — never that it becomes invisible while the dispatch still succeeds.
  it.skipIf(!HAS_PROBE_DEPS)('a pre-existing /tmp/claude with a planted file causes the dispatch to be REFUSED, and the planted file is left on the host untouched' + WHY_NOT, async () => {
    const HOST_SHARED = '/tmp/claude';
    if (existsSync(HOST_SHARED)) return; // never touch a real pre-existing one
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-pi-r3-1-hostshared-'));
    mkdirSync(join(workRoot, 'ws'), { recursive: true });
    try {
      mkdirSync(HOST_SHARED, { recursive: true });
      chmodSync(HOST_SHARED, 0o700);
      writeFileSync(join(HOST_SHARED, 'leak.txt'), 'PLANTED_SECRET_DATA_SHOULD_NOT_BE_VISIBLE');
      const command = 'cat /tmp/claude/leak.txt 2>&1; echo CATEND; ls /tmp/claude 2>&1; echo LSEND; echo w > /tmp/claude/pwn.txt 2>&1';
      const fake = await startOneBashCommandServer(command);
      let caught: unknown;
      try {
        await dispatchOneBash(fake.port, workRoot, command);
      } catch (err) {
        caught = err;
      }
      await new Promise((r) => fake.server.close(() => r(undefined)));
      expect(String(caught)).toMatch(/HOST_SHARED_TMPDIR_UNSAFE/);
      // The fake server was never even reached with a tool-call round trip: the refusal happens before
      // any sandbox (and so any bash command) ever runs.
      expect(fake.resultText()).toBe('');
      // The planted file is byte-for-byte exactly as planted — never emptied, never deleted.
      expect(existsSync(join(HOST_SHARED, 'leak.txt'))).toBe(true);
      expect(readFileSync(join(HOST_SHARED, 'leak.txt'), 'utf8')).toBe('PLANTED_SECRET_DATA_SHOULD_NOT_BE_VISIBLE');
    } finally {
      rmSync(HOST_SHARED, { recursive: true, force: true });
      rmSync(workRoot, { recursive: true, force: true });
    }
  }, 60_000);
});
