// VAL-101 (issue #101): an agent's Bash cannot READ outside its own run workspace — not another
// run's workspace under workRoot, not workRoot's engine state (auth-tokens.db), not the engine
// home's credential files — while its own workspace and the home-resident toolchain (node) still
// work. Real tier: a real ClaudeAgentSdkGatewayClient spawns the real `claude` CLI under the real
// kernel sandbox (bwrap + socat) with the posture composeConfig() would build. The only fake is the
// MODEL: a local SSE stub speaking the Anthropic Messages protocol answers the first turn with one
// fixed Bash tool_use and records the tool_result — deterministic, free, no credential needed.
// Skipped (with the reason) when this host's boot probe measures unconfined.
// Never prints a credential: every out-of-workspace read is `cat … >/dev/null 2>&1; echo $?`.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeAgentSdkGatewayClient } from '../../src/gateway/claude-agent-sdk-client.js';
import { toolchainReadCandidates } from '../../src/gateway/bash-confinement.js';
import { probeConfinement } from '../../src/gateway/confinement-probe.js';

const probe = probeConfinement();
const CONFINED = probe.posture === 'confined';
const WHY = CONFINED ? '' : ` [UNVERIFIED here: host measured unconfined — ${probe.reason ?? 'probe failed'}]`;

const HOME = realpathSync(homedir());
const CREDS = join(HOME, '.claude', '.credentials.json');

let workRoot: string;
let wsA: string;
let wsB: string;
let server: http.Server;
let toolResult: string | undefined;

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

function command(): string {
  return [
    'cat own.txt; echo own=$?',
    `cat ${join(wsB, 'secret.txt')} >/dev/null 2>&1; echo other_run=$?`,
    `ls ${join(workRoot, 'workflows', 'wf', 'runs')}; echo ls_runs=$?`,
    `cat ${join(workRoot, 'auth-tokens.db')} >/dev/null 2>&1; echo authdb=$?`,
    `test -e ${CREDS} && { cat ${CREDS} >/dev/null 2>&1; echo creds=$?; } || echo creds=absent`,
    'node --version >/dev/null 2>&1; echo node=$?',
    'echo w > wrote.txt && cat wrote.txt >/dev/null; echo write=$?',
  ].join('; ');
}

beforeAll(async () => {
  workRoot = realpathSync(mkdtempSync(join(tmpdir(), 'rwe-val101-')));
  wsA = join(workRoot, 'workflows', 'wf', 'runs', 'run-a');
  wsB = join(workRoot, 'workflows', 'wf', 'runs', 'run-b');
  mkdirSync(wsA, { recursive: true });
  mkdirSync(wsB, { recursive: true });
  writeFileSync(join(wsA, 'own.txt'), 'OWN-OK\n');
  writeFileSync(join(wsB, 'secret.txt'), 'OTHER-RUN\n');
  writeFileSync(join(workRoot, 'auth-tokens.db'), 'x');
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString(); });
    req.on('end', () => {
      const j = JSON.parse(body || '{}') as { tools?: unknown[]; messages?: { content?: unknown }[] };
      const last = j.messages?.[j.messages.length - 1]?.content;
      const tr = Array.isArray(last) ? (last as { type: string; content?: unknown }[]).find((c) => c.type === 'tool_result') : undefined;
      if (tr) {
        toolResult = typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content);
        sse(res, { type: 'text', text: 'done' }, 'end_turn');
      } else if (!j.tools || j.tools.length === 0) {
        sse(res, { type: 'text', text: 'ok' }, 'end_turn');
      } else {
        sse(res, { type: 'tool_use', id: 'toolu_val101', name: 'Bash', input: { command: command(), description: 'val-101' } }, 'tool_use');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
});

afterAll(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  rmSync(workRoot, { recursive: true, force: true });
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
      // The same derivation composeConfig() runs at boot (existence-filtered).
      allowReadPaths: toolchainReadCandidates(process.env['PATH'], HOME, process.execPath).filter((p) => existsSync(p)),
    },
  });
}

function expectReadConfined(out: string): void {
  expect(out).toContain('OWN-OK');
  expect(out).toMatch(/own=0/);
  expect(out).toMatch(/other_run=[1-9]/);
  expect(out).not.toContain('OTHER-RUN');
  // Enumeration of sibling runs is closed too: the runs dir shows only this run's own path.
  expect(out).not.toContain('run-b');
  expect(out).toMatch(/authdb=[1-9]/);
  expect(out).toMatch(/creds=([1-9]|absent)/);
  expect(out).toMatch(/node=0/);
}

describe('VAL-101 agent Bash reads are confined to its own workspace (issue #101)', () => {
  it.skipIf(!CONFINED)(`another run's workspace, auth-tokens.db and the home credential file are unreadable; own workspace + node work${WHY}`, async () => {
    toolResult = undefined;
    const r = await makeClient().invoke({
      prompt: 'run the check', runId: 'run-a', agentId: 'agent-1', workspace: wsA,
      opts: { model: 'ollama/stub', allowedTools: ['Bash'] } as never,
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expectReadConfined(toolResult ?? '');
    expect(toolResult).toMatch(/write=0/);
  }, 120000);

  // Issue #95 regression under the new posture: readonly Bash still starts (its mount targets are
  // bound inside a tmpfs'd tree now), reads the same things, and writes nothing.
  it.skipIf(!CONFINED)(`bash:'readonly' keeps working under the home/workRoot deny: same reads, no write${WHY}`, async () => {
    toolResult = undefined;
    const r = await makeClient().invoke({
      prompt: 'run the check', runId: 'run-a', agentId: 'agent-2', workspace: wsA,
      opts: { model: 'ollama/stub', allowedTools: ['Bash', 'Read'], bash: 'readonly' } as never,
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expectReadConfined(toolResult ?? '');
    expect(toolResult).toMatch(/write=[1-9]/);
  }, 120000);
});
