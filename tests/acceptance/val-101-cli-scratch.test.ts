// VAL-101-CLI-SCRATCH (issue #101 residual): the Claude CLI re-binds its per-uid scratch writable
// after every denyRead, so by default every run's agent shares `/tmp/claude-<uid>/`. The gateway now
// gives each confined dispatch its own scratch under `<workRoot>/cli-tmp/` and denies the shared one
// (docs/evidence/issue-101-cli-scratch.md). Real tier: a real ClaudeAgentSdkGatewayClient spawns the
// real `claude` CLI under the real kernel sandbox (bwrap + socat); the only fake is the MODEL — a
// local SSE stub answering each session's first turn with one fixed Bash tool_use. Two runs are
// dispatched CONCURRENTLY: run A writes into its CLI scratch and keeps its session open while run B
// looks for it. Skipped (with the reason) when this host's boot probe measures unconfined.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, realpathSync, readFileSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ClaudeAgentSdkGatewayClient } from '../../src/gateway/claude-agent-sdk-client.js';
import { toolchainReadCandidates, CLI_SCRATCH_DIR } from '../../src/gateway/bash-confinement.js';
import { probeConfinement } from '../../src/gateway/confinement-probe.js';

const probe = probeConfinement();
const CONFINED = probe.posture === 'confined';
const WHY = CONFINED ? '' : ` [UNVERIFIED here: host measured unconfined — ${probe.reason ?? 'probe failed'}]`;

const HOME = realpathSync(homedir());
const SHARED = join(tmpdir(), `claude-${process.getuid?.() ?? 0}`);
const PROBE_NAME = `rwe-val101-scratch-${randomBytes(4).toString('hex')}.txt`;

let workRoot: string;
let wsA: string;
let wsB: string;
let planted: string;
let server: http.Server;
let nextCommand: { id: string; command: string } | undefined;
const results = new Map<string, string>();

function sse(res: http.ServerResponse, block: Record<string, unknown>, stop: string): void {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const ev = (e: string, d: unknown): void => { res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`); };
  ev('message_start', { type: 'message_start', message: { id: 'msg_stub', type: 'message', role: 'assistant', model: 'stub', content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });
  if (block['type'] === 'text') {
    ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: block['text'] } });
  } else {
    ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { ...block, input: {} } });
    ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block['input']) } });
  }
  ev('content_block_stop', { type: 'content_block_stop', index: 0 });
  ev('message_delta', { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 1 } });
  ev('message_stop', { type: 'message_stop' });
  res.end();
}

beforeAll(async () => {
  workRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rwe-val101s-')));
  wsA = join(workRoot, 'workflows', 'wf', 'runs', 'run-a');
  wsB = join(workRoot, 'workflows', 'wf', 'runs', 'run-b');
  mkdirSync(wsA, { recursive: true });
  mkdirSync(wsB, { recursive: true });
  // Stands in for a third dispatch still in flight: its scratch, exactly where the gateway puts one.
  planted = join(workRoot, CLI_SCRATCH_DIR, 'dOTHER1', `claude-${process.getuid?.() ?? 0}`, 'secret.txt');
  mkdirSync(join(planted, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(planted, 'OTHER-SCRATCH\n');
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      const j = JSON.parse(body || '{}') as { tools?: unknown[]; messages?: { content?: unknown }[] };
      const last = j.messages?.[j.messages.length - 1]?.content;
      const tr = Array.isArray(last) ? (last as { type: string; tool_use_id?: string; content?: unknown }[]).find((c) => c.type === 'tool_result') : undefined;
      if (tr) {
        results.set(tr.tool_use_id ?? '?', typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content));
        sse(res, { type: 'text', text: 'done' }, 'end_turn');
      } else if (!j.tools || j.tools.length === 0 || nextCommand === undefined) {
        sse(res, { type: 'text', text: 'ok' }, 'end_turn');
      } else {
        const { id, command } = nextCommand;
        nextCommand = undefined;
        sse(res, { type: 'tool_use', id, name: 'Bash', input: { command, description: 'val-101-cli-scratch' } }, 'tool_use');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
});

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  rmSync(workRoot, { recursive: true, force: true });
  rmSync(join(SHARED, PROBE_NAME), { force: true });
});

function makeClient(): ClaudeAgentSdkGatewayClient {
  return new ClaudeAgentSdkGatewayClient({
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    timeoutMs: 90000,
    confinementPosture: 'confined',
    confinement: {
      allowHostPaths: [],
      protectedFiles: [join(workRoot, 'auth-tokens.db')],
      workRoot,
      homeDir: HOME,
      allowReadPaths: toolchainReadCandidates(process.env['PATH'], HOME, process.execPath).filter((p) => existsSync(p)),
    },
  });
}

// What every sandboxed dispatch must see of the CLI scratch: never another dispatch's, never the
// host-shared one; its own is writable.
function lookAround(): string {
  return [
    `cat ${planted} 2>/dev/null; echo other_scratch=$?`,
    `echo ls_cli_tmp=$(ls ${join(workRoot, CLI_SCRATCH_DIR)} | tr '\\n' ,)`,
    `echo shared_entries=$(ls -A ${SHARED} 2>/dev/null | wc -l)`,
    `echo x > ${join(SHARED, PROBE_NAME)} 2>/dev/null; echo shared_write=$?`,
    'echo own > "$CLAUDE_CODE_TMPDIR/own.txt" && cat "$CLAUDE_CODE_TMPDIR/own.txt" >/dev/null; echo own_scratch=$?',
    'echo scratch=$CLAUDE_CODE_TMPDIR tmpdir=$TMPDIR',
  ].join('; ');
}

function expectIsolated(out: string): string {
  expect(out).toMatch(/other_scratch=[1-9]/);
  expect(out).not.toContain('OTHER-SCRATCH');
  expect(out).toMatch(/shared_entries=0\b/);
  expect(out).toMatch(/own_scratch=0/);
  // Whatever the sandbox let the write do, nothing reached the host-shared scratch.
  expect(existsSync(join(SHARED, PROBE_NAME))).toBe(false);
  const listed = /ls_cli_tmp=([^\n]*)/.exec(out)?.[1]?.split(',').filter(Boolean) ?? [];
  // Only this dispatch's own scratch is visible under cli-tmp (the planted one is not).
  expect(listed).toHaveLength(1);
  expect(listed[0]).not.toBe('dOTHER1');
  const scratch = /scratch=(\S+) tmpdir=(\S+)/.exec(out);
  // Inside the sandbox the CLI exports its derived `<dir>/claude-<uid>` as CLAUDE_CODE_TMPDIR and the
  // per-dispatch dir itself as TMPDIR.
  expect(scratch?.[1]).toBe(join(scratch?.[2] ?? '', `claude-${process.getuid?.() ?? 0}`));
  expect(scratch?.[2]?.startsWith(join(workRoot, CLI_SCRATCH_DIR) + '/')).toBe(true);
  return listed[0] as string;
}

async function waitFor(path: string, ms: number): Promise<string> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (existsSync(path)) {
      const s = readFileSync(path, 'utf8').trim();
      if (s.length > 0) return s;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for ${path}`);
}

describe('VAL-101-CLI-SCRATCH each dispatch has its own CLI scratch (issue #101 residual)', () => {
  it.skipIf(!CONFINED)(`two concurrent runs: B cannot read what A wrote into its CLI scratch; neither sees the host-shared scratch or a third dispatch's${WHY}`, async () => {
    results.clear();
    const client = makeClient();
    // A: write a marker into its own CLI scratch, publish the path via its own workspace (host-side
    // only — B cannot read A's workspace), then keep the session open while B runs.
    nextCommand = {
      id: 'toolu_run_a',
      command: `${lookAround()}; echo A-MARK > "$CLAUDE_CODE_TMPDIR/a-mark.txt" && echo "$CLAUDE_CODE_TMPDIR/a-mark.txt" > a-path.txt; for i in $(seq 1 100); do test -e b-done.txt && break; test -e $CLAUDE_CODE_TMPDIR/a-mark.txt || break; sleep 0.2; done; echo a_done`,
    };
    const pA = client.invoke({ prompt: 'run the check', runId: 'run-a', agentId: 'agent-a', workspace: wsA, opts: { model: 'ollama/stub', allowedTools: ['Bash'] } as never });
    const aPath = await waitFor(join(wsA, 'a-path.txt'), 60000);
    expect(existsSync(aPath)).toBe(true); // A's scratch is live on the host while B runs
    nextCommand = {
      id: 'toolu_run_b',
      command: `cat ${aPath} 2>/dev/null; echo a_scratch=$?; ls ${join(aPath, '..')} >/dev/null 2>&1; echo a_scratch_ls=$?; ${lookAround()}`,
    };
    const rB = await makeClient().invoke({ prompt: 'run the check', runId: 'run-b', agentId: 'agent-b', workspace: wsB, opts: { model: 'ollama/stub', allowedTools: ['Bash'] } as never });
    writeFileSync(join(wsA, 'b-done.txt'), '1');
    const rA = await pA;
    expect(rA.ok, JSON.stringify(rA)).toBe(true);
    expect(rB.ok, JSON.stringify(rB)).toBe(true);
    const outA = results.get('toolu_run_a') ?? '';
    const outB = results.get('toolu_run_b') ?? '';
    const ownA = expectIsolated(outA);
    const ownB = expectIsolated(outB);
    expect(ownA).not.toBe(ownB);
    expect(aPath.startsWith(join(workRoot, CLI_SCRATCH_DIR, ownA) + '/')).toBe(true);
    expect(outB).toMatch(/a_scratch=[1-9]/);
    expect(outB).toMatch(/a_scratch_ls=[1-9]/);
    expect(outB).not.toContain('A-MARK');
    // Both scratches are gone once their calls returned; only the planted one is left.
    expect(readdirSync(join(workRoot, CLI_SCRATCH_DIR))).toEqual(['dOTHER1']);
  }, 180000);

  it.skipIf(!CONFINED)(`bash:'readonly' keeps working: own scratch writable, workspace not, shared/other scratch unreadable${WHY}`, async () => {
    results.clear();
    nextCommand = { id: 'toolu_ro', command: `${lookAround()}; echo w > wrote.txt 2>/dev/null; echo ws_write=$?` };
    const r = await makeClient().invoke({ prompt: 'run the check', runId: 'run-a', agentId: 'agent-ro', workspace: wsA, opts: { model: 'ollama/stub', allowedTools: ['Bash', 'Read'], bash: 'readonly' } as never });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const out = results.get('toolu_ro') ?? '';
    expectIsolated(out);
    expect(out).toMatch(/ws_write=[1-9]/);
  }, 120000);
});
