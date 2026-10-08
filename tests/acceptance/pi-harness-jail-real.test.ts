// pi harness v1, independent review B3/B4/M5: a REAL PiGatewayClient dispatch, through a REAL
// spawned pi child, driven by a deterministic SCRIPTED fake OpenRouter SSE server (no Ollama, no
// npm registry, no bwrap/socat needed — this exercises the file-tool jail directly, independent of
// bash confinement) — ported from the reviewer's own scratch driver (piv/jail-drive.mts) into a
// committed, always-on (never host-gated) test, per the coordinator's "reuse them" instruction.
// Each tool call is scripted by the fake server rather than hoping a real model cooperates, so this
// is fully deterministic and needs no RWE_PI_REAL_TESTS opt-in.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PiGatewayClient } from '../../src/gateway/pi-gateway-client.js';

interface ToolCall { name: string; args: Record<string, unknown> }

/** Drives a scripted sequence of tool calls through a real PiGatewayClient dispatch via a recording/
 *  responding fake SSE server — each request gets the NEXT tool call in `script`, and the final
 *  request gets a plain text reply. Returns the tool_result payload for each step (by result event
 *  order) plus the raw gateway result. */
async function driveScript(gw: PiGatewayClient, workspace: string, allowedTools: string[]): Promise<{ results: Array<{ result: unknown; isError: boolean }>; ok: boolean }> {
  const results: Array<{ result: unknown; isError: boolean }> = [];
  const r = await gw.invoke({
    prompt: 'go',
    opts: { model: 'openrouter/fake/model', allowedTools },
    runId: 'jail-real-' + Math.random().toString(36).slice(2),
    agentId: 'a1',
    workspace,
    onEvent: (ev) => {
      // issue #139(a) / v0374 review L-4: the engine-canonical tool_result shape
      // (pi-gateway-client.ts's own fix) is `{type:'tool_result', tool_use_id, content, is_error}` —
      // this used to read pi's old raw `{toolCallId, toolName, result, isError}` shape, so every
      // field here read `undefined` after that fix landed. `tool_use_id`/no tool name on this event
      // kind matches the real Anthropic content-block shape (the name lives on the matching
      // `tool_call` event instead) — this driver never needed the name, only `result`/`isError`.
      if (ev.kind === 'tool_result') {
        const d = ev.data as { content: unknown; is_error: boolean };
        results.push({ result: d.content, isError: d.is_error });
      }
    },
  });
  return { results, ok: r.ok };
}

function startScriptedServer(script: ToolCall[]): Promise<{ server: HttpServer; port: number }> {
  let step = 0;
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const id = 'c' + step;
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        if (step < script.length) {
          const s = script[step++]!;
          res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + step, type: 'function', function: { name: s.name, arguments: JSON.stringify(s.args) } }] }, finish_reason: null }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 50, completion_tokens: 5, total_tokens: 55 } })}\n\n`);
        } else {
          step++;
          res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: { role: 'assistant', content: 'ALL_DONE' }, finish_reason: null }] })}\n\n`);
          res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 2, total_tokens: 52 } })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === 'object' && addr !== null ? addr.port : 0 });
    });
  });
}

describe('pi harness v1 — file-tool jail, driven deterministically (review B3/B4/M5, ported from piv/jail-drive.mts)', () => {
  let base: string, ws: string, out: string, outdir: string;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'rwe-pi-jail-real-'));
    ws = join(base, 'ws'); mkdirSync(ws);
    out = join(base, 'out'); mkdirSync(out);
    outdir = join(base, 'outdir'); mkdirSync(outdir);
    writeFileSync(join(outdir, 'secret.txt'), 'OUTSIDE_SECRET\n');
    writeFileSync(join(ws, 'inside.txt'), 'INSIDE_TEXT\n');
    symlinkSync(join(out, 'created.txt'), join(ws, 'dangle')); // dangling, target outside
    symlinkSync(outdir, join(ws, 'linkdir')); // existing dir, outside
  });
  afterAll(() => { rmSync(base, { recursive: true, force: true }); });

  it('B3: write through a dangling symlink is refused, and the outside target is never created', async () => {
    const fake = await startScriptedServer([{ name: 'write', args: { path: 'dangle', content: 'PWNED_VIA_DANGLING' } }]);
    try {
      const gw = new PiGatewayClient({ secretSource: { resolve: () => 'fake-key' }, timeoutMs: 30_000, retries: 0, openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1` });
      const { results } = await driveScript(gw, ws, ['Write']);
      expect(results[0]?.isError).toBe(true);
      expect(JSON.stringify(results[0]?.result)).toMatch(/PATH_ESCAPES_WORKSPACE/);
      expect(existsSync(join(out, 'created.txt'))).toBe(false);
    } finally {
      await new Promise((r) => fake.server.close(() => r(undefined)));
    }
  }, 30_000);

  it('B3: write through a nested dangling symlink (link -> link -> outside) is also refused', async () => {
    const mid = join(ws, 'mid2'); symlinkSync(join(out, 'final2.txt'), mid);
    const dangle2 = join(ws, 'dangle2'); symlinkSync(mid, dangle2);
    const fake = await startScriptedServer([{ name: 'write', args: { path: 'dangle2', content: 'PWNED2' } }]);
    try {
      const gw = new PiGatewayClient({ secretSource: { resolve: () => 'fake-key' }, timeoutMs: 30_000, retries: 0, openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1` });
      const { results } = await driveScript(gw, ws, ['Write']);
      expect(results[0]?.isError).toBe(true);
      expect(existsSync(join(out, 'final2.txt'))).toBe(false);
    } finally {
      await new Promise((r) => fake.server.close(() => r(undefined)));
    }
  }, 30_000);

  it('B4: grep actually works over the workspace (the rg shim resolves)', async () => {
    const fake = await startScriptedServer([{ name: 'grep', args: { pattern: 'INSIDE', path: '.' } }]);
    try {
      const gw = new PiGatewayClient({ secretSource: { resolve: () => 'fake-key' }, timeoutMs: 30_000, retries: 0, openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1` });
      const { results } = await driveScript(gw, ws, ['Grep']);
      expect(results[0]?.isError).toBe(false);
      expect(JSON.stringify(results[0]?.result)).not.toMatch(/ripgrep .rg. is not available/);
      expect(JSON.stringify(results[0]?.result)).toMatch(/inside\.txt/);
    } finally {
      await new Promise((r) => fake.server.close(() => r(undefined)));
    }
  }, 30_000);

  it('B4/jail: grep of an outside path (/etc) is refused, never reaches rg', async () => {
    const fake = await startScriptedServer([{ name: 'grep', args: { pattern: 'root', path: '/etc' } }]);
    try {
      const gw = new PiGatewayClient({ secretSource: { resolve: () => 'fake-key' }, timeoutMs: 30_000, retries: 0, openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1` });
      const { results } = await driveScript(gw, ws, ['Grep']);
      expect(results[0]?.isError).toBe(true);
      // grep.js's own try/catch around `ops.isDirectory` collapses any thrown error (including our
      // PATH_ESCAPES_WORKSPACE) into a generic "Path not found" message — the SECURITY property this
      // test actually cares about is that /etc's real contents are never reached (no root/passwd-
      // shaped match text ever appears), which the refusal-before-rg-runs guarantees regardless of
      // which exact string surfaces.
      const text = JSON.stringify(results[0]?.result);
      expect(text).toMatch(/not found|escapes|outside/i);
      expect(text).not.toMatch(/root:/); // would appear only if grep actually searched real /etc files
    } finally {
      await new Promise((r) => fake.server.close(() => r(undefined)));
    }
  }, 30_000);

  it('M5: find never lists names behind a symlinked directory that points outside the workspace', async () => {
    const fake = await startScriptedServer([{ name: 'find', args: { pattern: '**', path: '.' } }]);
    try {
      const gw = new PiGatewayClient({ secretSource: { resolve: () => 'fake-key' }, timeoutMs: 30_000, retries: 0, openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1` });
      const { results } = await driveScript(gw, ws, ['Glob']);
      expect(results[0]?.isError).toBe(false);
      const text = JSON.stringify(results[0]?.result);
      expect(text).not.toMatch(/linkdir\//);
      expect(text).not.toMatch(/secret\.txt/);
    } finally {
      await new Promise((r) => fake.server.close(() => r(undefined)));
    }
  }, 30_000);

  it('B11: a Read escape refusal names the workspace root, never the resolved host-absolute path it escaped to', async () => {
    // issue #159 (B11): assertJailed() used to interpolate the fully-resolved absolute path into
    // the refusal — on a real deployment that leaks the engine's internal data-directory layout
    // (e.g. /home/rwe/.local/share/rwe-data/workflows/<wf>/runs/...) instead of naming the
    // workspace root as docs/AUTHORING.md promises. `outdir` here stands in for that "internal
    // layout the model has no business seeing" directory — a real spawned pi child, real file jail.
    const fake = await startScriptedServer([{ name: 'read', args: { path: '../outdir/secret.txt' } }]);
    try {
      const gw = new PiGatewayClient({ secretSource: { resolve: () => 'fake-key' }, timeoutMs: 30_000, retries: 0, openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1` });
      const { results } = await driveScript(gw, ws, ['Read']);
      expect(results[0]?.isError).toBe(true);
      const text = JSON.stringify(results[0]?.result);
      expect(text).toMatch(/PATH_ESCAPES_WORKSPACE/);
      // #159 B11 follow-up (2026-10-07 re-verification): the FIRST fix made the escaping TARGET
      // relative but still appended the host-absolute `ws` itself at the end of the message — fixed
      // again to name the root only by the stable logical phrase "this run's workspace root".
      expect(text).not.toContain(ws); // never the host-absolute workspace root path either
      expect(text).toContain('workspace root'); // still names the root, by a stable logical label
      expect(text).not.toContain(outdir); // never the resolved host-absolute directory it escaped to
    } finally {
      await new Promise((r) => fake.server.close(() => r(undefined)));
    }
  }, 30_000);

  it('jail/M5-parity: ls of a symlinked outside directory is refused', async () => {
    const fake = await startScriptedServer([{ name: 'ls', args: { path: 'linkdir' } }]);
    try {
      const gw = new PiGatewayClient({ secretSource: { resolve: () => 'fake-key' }, timeoutMs: 30_000, retries: 0, openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1` });
      const { results } = await driveScript(gw, ws, ['LS']);
      expect(results[0]?.isError).toBe(true);
      expect(JSON.stringify(results[0]?.result)).toMatch(/PATH_ESCAPES_WORKSPACE/);
    } finally {
      await new Promise((r) => fake.server.close(() => r(undefined)));
    }
  }, 30_000);

  it('R2-2 (M6 corrected): under the UNCONFINED posture, a nohup\'d background process (stays in bash\'s own process GROUP) is group-killed on normal completion; a setsid\'d one (escapes the group into its own session) is a documented survivor, never masked by padding the command with a trailing sleep', async () => {
    // Deliberately UNCONFINED (confinementPosture omitted — the gateway's own default) and a REAL
    // bash spawn (no confined-bash sandbox involved at all). No trailing `sleep` padding in the
    // command — review R2-2's own finding: a padded command only proves the race is won WHEN bash
    // outlives one poll tick, which is not what a real dispatch guarantees. `nohup cmd &` under a
    // non-interactive `bash -c` script (no job control) stays in bash's OWN process group — group-
    // killing bash's pgid reaches it. `setsid cmd &` explicitly creates a NEW session and process
    // group — unreachable by a group kill, by construction; the review's own ruling is to document
    // this as the unconfined posture's limitation, not to chase it with a poll.
    const m6ws = mkdtempSync(join(tmpdir(), 'rwe-pi-jail-m6-'));
    // review R2-2 debugging notes, both earned empirically against the real dispatch path:
    // (1) `setsid sleep N &` captured via the backgrounding job's own `$!` is NOT a reliable way to
    //     name the real long-running process — util-linux's `setsid` (absent `-f`/`--fork`) calls
    //     setsid(2) IN PLACE via exec only when it is not already a process group leader, and falls
    //     back to an internal fork+exit-the-original-wrapper otherwise; which path runs is a genuine
    //     host/timing-dependent race, so `$!` sometimes names a wrapper pid that exits in
    //     milliseconds, unrelated to this fix, rather than the process that keeps running. `setsid
    //     bash -c 'echo -n $$ > setsid.pid; exec sleep N'` sidesteps the ambiguity: `$$` is read from
    //     WHICHEVER process ends up running it, and `exec sleep N` replaces that exact process (same
    //     pid, no further fork).
    // (2) That inner bash needs a moment to fork/exec/setsid(2) before it can write its own pid —
    //     genuinely asynchronous relative to the outer script, which otherwise finishes (and this
    //     fix's OWN group-kill fires) in under a millisecond. A bare retry-with-delay read raced
    //     reapBashGroup's own SIGTERM, which — while the backgrounded job is still transitioning out
    //     of bash's group — can still reach and kill it before it escapes, intermittently. Fixed with
    //     a real synchronization primitive, a FIFO: the outer script blocks on `cat setsid.ready`
    //     until the inner process has ACTUALLY reached its own `echo > setsid.ready` line, which can
    //     only happen after setsid(2) + the pid file write already landed — a deterministic barrier,
    //     not a sleep-shaped hope.
    const command =
      "nohup sleep 3017 >/dev/null 2>&1 & echo -n $! > nohup.pid; mkfifo setsid.ready; " +
      "setsid bash -c 'echo -n $$ > setsid.pid; echo go > setsid.ready; exec sleep 3018' >/dev/null 2>&1 & " +
      'cat setsid.ready > /dev/null';
    const fake = await startScriptedServer([{ name: 'bash', args: { command } }]);
    let setsidPid: number | undefined;
    try {
      const gw = new PiGatewayClient({ secretSource: { resolve: () => 'fake-key' }, timeoutMs: 30_000, retries: 0, openrouterBaseUrl: `http://127.0.0.1:${fake.port}/api/v1` });
      const { results } = await driveScript(gw, m6ws, ['Bash']);
      expect(results[0]?.isError).toBe(false);
      const nohupPid = Number(readFileSync(join(m6ws, 'nohup.pid'), 'utf8').trim());
      // By the time driveScript() resolves, the outer script's own `cat setsid.ready` has already
      // unblocked — which can only happen AFTER setsid.pid was written (see the command comment
      // above) — so this read is never racing an in-flight write.
      // `Number('')` is `0`, not `NaN` — a falsy-looking but NOT-undefined pid. Guarded here (not
      // just `!== undefined` later) so `setsidPid` is only ever `undefined` (nothing to clean up) or
      // a real, positive pid, never 0 — `process.kill(0, …)` sends to THIS PROCESS'S OWN group (the
      // vitest worker running this very test), not a harmless no-op, and that is exactly what a
      // bare `Number(...)` of an unexpectedly-empty read would produce.
      const parsedSetsidPid = existsSync(join(m6ws, 'setsid.pid')) ? Number(readFileSync(join(m6ws, 'setsid.pid'), 'utf8').trim()) : NaN;
      setsidPid = Number.isInteger(parsedSetsidPid) && parsedSetsidPid > 0 ? parsedSetsidPid : undefined;
      expect(nohupPid).toBeGreaterThan(0);
      expect(setsidPid).toBeGreaterThan(0);
      // The group kill runs synchronously inside the exec() call's own 'close' handler (SIGTERM, a
      // short grace, SIGKILL) — driveScript() has already resolved by the time we get here, so no
      // arbitrary sleep is needed to "give cleanup a moment" the way the pre-fix test did.
      let nohupAlive = true;
      try { process.kill(nohupPid, 0); } catch { nohupAlive = false; }
      expect(nohupAlive).toBe(false);
      // The documented survivor — asserted explicitly so a future regression that ALSO kills setsid
      // (impossible without a confined posture or a subreaper) doesn't silently fix this test.
      let setsidAlive = true;
      try { process.kill(setsidPid!, 0); } catch { setsidAlive = false; } // non-null: asserted > 0 just above
      expect(setsidAlive).toBe(true);
    } finally {
      // The documented survivor is a REAL leaked process — clean it up ourselves, same discipline
      // the review flagged ("leaked sleep processes") against the implementer's own throwaway runs.
      // `> 0` (not just `!== undefined`) is deliberate defense-in-depth: a pid of 0 would send
      // `process.kill(0, …)` to THIS PROCESS'S OWN group (the vitest worker running this very
      // test), not a harmless no-op — the assignment above already only ever produces `undefined`
      // or a real positive pid, but this guard is cheap insurance against that invariant ever
      // drifting.
      if (setsidPid !== undefined && setsidPid > 0) { try { process.kill(setsidPid, 'SIGKILL'); } catch { /* already gone */ } }
      await new Promise((r) => fake.server.close(() => r(undefined)));
      rmSync(m6ws, { recursive: true, force: true });
    }
  }, 30_000);

  // review round 2 owner ruling's "planted .pi not loaded" regression test used to live here —
  // moved to its own ungated file, tests/acceptance/pi-harness-planted-config-not-loaded.test.ts
  // (review round 3, LOW-2), to remove any ambiguity about this file's own gating status for a
  // reader who only looks at filenames (this file was never actually behind RWE_PI_REAL_TESTS, see
  // this file's own header comment, but the "-real" in its name read as a signal otherwise).
});
