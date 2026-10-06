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
import type { EngineEvent } from '../../src/event-log.js';
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

  // issue #159 B8 (owner approved): confined Bash under pi must deny-by-default for reads the SAME
  // way the sdk gateway's own buildBashConfinement() policy does (issue #101) — $HOME and workRoot
  // denied, this dispatch's own workspace and the home-resident toolchain re-opened. This claim used
  // to be proved through a real local Ollama (qwen2.5:7b) call and flaked when the model returned an
  // ok:true reply with EMPTY content (retryReal only retries a zero-usage timeout, not an ok-but-
  // empty reply) — see the deterministic version of this same claim below
  // ("issue #159 B8 (deterministic)"), which asserts on the actual bash tool-result text via the
  // fake-OpenRouter harness and needs no Ollama at all, so it cannot flake on a model's reply shape.
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

async function dispatchOneBash(
  port: number,
  workRoot: string,
  command: string,
  opts: { onEvent?: (ev: EngineEvent) => void; homeDir?: string; allowReadPaths?: readonly string[] } = {},
): Promise<string> {
  const gw = new PiGatewayClient({
    secretSource: { resolve: () => 'fake-key' }, timeoutMs: 60_000, retries: 0,
    openrouterBaseUrl: `http://127.0.0.1:${port}/api/v1`,
    confinementPosture: 'confined',
    confinement: {
      allowHostPaths: [], protectedFiles: [], workRoot,
      ...(opts.homeDir !== undefined ? { homeDir: opts.homeDir } : {}),
      ...(opts.allowReadPaths !== undefined ? { allowReadPaths: opts.allowReadPaths } : {}),
    },
    resolveRipgrepOverride,
  });
  if (opts.onEvent) gw.bindEventSink(opts.onEvent);
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

  // review round 4 (R4-2, owner ruling): the round-3 refusal is DROPPED — confined Bash cannot create
  // `/tmp/claude` itself (the host's real /tmp is bind-mounted read-only inside the sandbox, proved
  // live elsewhere this round), and `denyWrite:['/tmp/claude']` already closes the one channel that
  // mattered (writes), even under TOCTOU. So a pre-existing `/tmp/claude` no longer refuses the
  // dispatch: it proceeds, confined Bash can READ it (the same exposure as any other host /tmp path —
  // round 1 parity, not a new hole) but cannot WRITE to it, nothing on the host ever changes, and a
  // `agent.host_shared_tmpdir_present` warning event is emitted so an operator can still see it.
  it.skipIf(!HAS_PROBE_DEPS)('a pre-existing /tmp/claude no longer refuses the dispatch: confined Bash can read it but not write to it, nothing on the host changes, and a warning event fires' + WHY_NOT, async () => {
    const HOST_SHARED = '/tmp/claude';
    if (existsSync(HOST_SHARED)) return; // never touch a real pre-existing one
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-pi-r4-2-hostshared-'));
    mkdirSync(join(workRoot, 'ws'), { recursive: true });
    try {
      mkdirSync(HOST_SHARED, { recursive: true });
      chmodSync(HOST_SHARED, 0o700);
      writeFileSync(join(HOST_SHARED, 'leak.txt'), 'HOST_TMP_CLAUDE_CONTENT\n');
      const command = 'cat /tmp/claude/leak.txt 2>&1; echo CATEND; ls /tmp/claude 2>&1; echo LSEND; echo w > /tmp/claude/pwn.txt 2>&1';
      const fake = await startOneBashCommandServer(command);
      const events: EngineEvent[] = [];
      await dispatchOneBash(fake.port, workRoot, command, { onEvent: (ev) => events.push(ev) });
      await new Promise((r) => fake.server.close(() => r(undefined)));
      const result = fake.resultText();
      const lines = result.split('\n');
      const catOut = lines.slice(0, lines.indexOf('CATEND')).join('\n');
      const lsOut = lines.slice(lines.indexOf('CATEND') + 1, lines.indexOf('LSEND')).join('\n');
      const writeOut = lines.slice(lines.indexOf('LSEND') + 1).join('\n');
      // Read works — the same read exposure as any other host /tmp path.
      expect(catOut).toBe('HOST_TMP_CLAUDE_CONTENT');
      expect(lsOut).toContain('leak.txt');
      // Write fails — denyWrite is the actual control.
      expect(writeOut).toMatch(/read-only file system/i);
      // The warning fired exactly once, naming the path, for an operator watching the event stream.
      const warnings = events.filter((e): e is Extract<EngineEvent, { kind: 'agent.host_shared_tmpdir_present' }> => e.kind === 'agent.host_shared_tmpdir_present');
      expect(warnings.length).toBe(1);
      expect(warnings[0]!.path).toBe('/tmp/claude');
      // Nothing on the host ever changed: the planted file is byte-for-byte as planted, and no write
      // landed.
      expect(existsSync(join(HOST_SHARED, 'leak.txt'))).toBe(true);
      expect(readFileSync(join(HOST_SHARED, 'leak.txt'), 'utf8')).toBe('HOST_TMP_CLAUDE_CONTENT\n');
      expect(existsSync(join(HOST_SHARED, 'pwn.txt'))).toBe(false);
    } finally {
      rmSync(HOST_SHARED, { recursive: true, force: true });
      rmSync(workRoot, { recursive: true, force: true });
    }
  }, 60_000);
});

/** issue #159 B8, deterministic replacement for the flaky real-Ollama version above: a REAL
 *  PiGatewayClient dispatch through REAL srt/bwrap, driven by the same fake-OpenRouter SSE server as
 *  the R3-1/R4-2 suites above — no Ollama, so there is no model-reply-shape flakiness to retry
 *  around. Asserts on `fake.resultText()`, the raw bash tool-result text, never a model's own final
 *  reply. */
describe('pi harness v1 — $HOME denied under confined Bash (issue #159 B8, deterministic)', () => {
  it.skipIf(!HAS_PROBE_DEPS)("confined bash denies reads under $HOME; own workspace and the toolchain (node+git) still work" + WHY_NOT, async () => {
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-pi-confined-home-det-'));
    const ws = join(workRoot, 'ws');
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, 'own.txt'), 'own-file-content');
    const homeDir = process.env['HOME'];
    if (homeDir === undefined) throw new Error('HOME must be set for this test');
    const probe = join(homeDir, `rwe-pi-b8-home-probe-${Date.now()}.txt`);
    writeFileSync(probe, 'HOME_SHOULD_BE_UNREADABLE');
    try {
      const command = `cat own.txt; echo SEP; cat ${probe} 2>&1; echo SEP; node --version; echo SEP; git --version`;
      const fake = await startOneBashCommandServer(command);
      await dispatchOneBash(fake.port, workRoot, command, { homeDir, allowReadPaths: [dirname(process.execPath)] });
      await new Promise((r) => fake.server.close(() => r(undefined)));
      const text = fake.resultText();
      expect(text).toContain('own-file-content');
      // ENOENT (tmpfs-over-denied-$HOME), never the real planted content.
      expect(text).not.toContain('HOME_SHOULD_BE_UNREADABLE');
      expect(text).toMatch(/v\d+\.\d+\.\d+/); // node --version
      expect(text).toMatch(/git version \d+\.\d+/); // git --version
    } finally {
      rmSync(probe, { force: true });
      rmSync(workRoot, { recursive: true, force: true });
    }
  }, 60_000);
});

/** issue #159 B8 follow-up (review minor): the sdk gateway's own buildBashConfinement call passes
 *  `sharedCliScratch` so the host-shared `/tmp/claude-<uid>` CLI scratch is denied for reads; pi's
 *  call site did not. `/tmp/claude-<uid>` is a real, often-populated directory on a dev host (the
 *  operator's own Claude Code session scratch) — this test only ever plants and removes its OWN
 *  uniquely-named file inside it, and only removes the directory itself if it did not already exist. */
describe('pi harness v1 — the host-shared CLI scratch (/tmp/claude-<uid>) is denied too (issue #159 B8 follow-up)', () => {
  it.skipIf(!HAS_PROBE_DEPS)('a file planted in /tmp/claude-<uid> cannot be read from confined pi Bash' + WHY_NOT, async () => {
    const uid = process.getuid!();
    const sharedScratch = join(tmpdir(), `claude-${uid}`);
    const sharedScratchPreexisted = existsSync(sharedScratch);
    if (!sharedScratchPreexisted) mkdirSync(sharedScratch, { recursive: true });
    const probe = join(sharedScratch, `rwe-pi-shared-scratch-probe-${Date.now()}.txt`);
    writeFileSync(probe, 'SHARED_SCRATCH_SHOULD_BE_UNREADABLE');
    const workRoot = mkdtempSync(join(tmpdir(), 'rwe-pi-shared-scratch-'));
    const ws = join(workRoot, 'ws');
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, 'own.txt'), 'own-file-content');
    try {
      const command = `cat own.txt; echo SEP; cat ${probe} 2>&1`;
      const fake = await startOneBashCommandServer(command);
      await dispatchOneBash(fake.port, workRoot, command);
      await new Promise((r) => fake.server.close(() => r(undefined)));
      const text = fake.resultText();
      expect(text).toContain('own-file-content');
      // ENOENT (tmpfs-over-denied-shared-scratch), never the real planted content.
      expect(text).not.toContain('SHARED_SCRATCH_SHOULD_BE_UNREADABLE');
      expect(text).toMatch(/No such file or directory/);
    } finally {
      rmSync(probe, { force: true });
      if (!sharedScratchPreexisted) rmSync(sharedScratch, { recursive: true, force: true });
      rmSync(workRoot, { recursive: true, force: true });
    }
  }, 60_000);
});
