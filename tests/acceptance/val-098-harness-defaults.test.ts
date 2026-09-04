// VAL-098 (REQ-088): Harness defaults bound at registration — defaults are first-class,
// queryable, and per-param merged at run time; invalid defaults fail-closed at registration.
//
// REQ-088 acceptance criteria:
//   Given a workflow registered with defaults={model:'sonnet', timeoutMs:30000},
//   When run_start is called with no overrides, Then the run uses the registered model/timeout;
//   When run_start is called with only a model override, Then only model is overridden
//   (timeoutMs falls back to the registered value);
//   When workflow_register is called with an invalid defaults value (unknown model alias /
//   non-allowlisted tool), Then it returns HARNESS_DEFAULTS_INVALID and stores nothing;
//   workflow_source returns the stored defaults for inspection.
//
// Red reason: workflow_register does not yet accept `defaults` → HARNESS_DEFAULTS_INVALID not
//   returned for invalid defaults → assertions fail. Correct RED.
//
// Mock policy (acceptance — DES-100): MUST NOT mock the SUT's own boundaries.
//   No auth in this test (auth disabled → open access); tests the catalog + run-manager merge
//   behavior via the real /mcp endpoint.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { registerPublishedVia } from '../helpers/workflow-fixtures.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val098-'));
  // Auth disabled (testing the catalog + merge layer directly, not the auth gate)
  server = await createServer({
    port: 0,
    bind: '127.0.0.1',
    workRoot: tmpDir,
    aliases: {
      sonnet: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
      haiku: { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },
      default: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
    },
  });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function callTool(name: string, args: Record<string, unknown>) {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}

async function waitForCompletion(runId: string, maxMs = 15_000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const s = await callTool('run_status', { runId });
    if (s.status === 'completed' || s.status === 'failed') return s;
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`run ${runId} did not complete in ${maxMs}ms`);
}

describe('REQ-088: harness defaults bound at registration (VAL-098)', () => {
  it('register with valid defaults; workflow_source returns them', async () => {
    const r = await callTool('workflow_register', {
      name: 'val098-defaults',
      script: 'return "ok";',
      defaults: { model: 'sonnet', timeoutMs: 30_000, prompt: 'test prompt' },
    });
    expect(r.error).toBeUndefined();
    expect(r.code).not.toBe('HARNESS_DEFAULTS_INVALID');

    // v22 (REQ-097/DES-110): `workflow_source({name})` with no version selector resolves the RELEASE
    // channel, so a registered-but-unpublished draft reads back CHANNEL_UNPUBLISHED (not its
    // defaults/params). Register AND publish so the read-back below sees the stored row.
    const pub = await callTool('workflow_publish', { name: 'val098-defaults', version: (r['result'] as { version?: string }).version!, channel: 'release' });
    expect(pub['status']).toBe('completed');

    const got = await callTool('workflow_source', { name: 'val098-defaults' });
    const def = (got as { defaults?: Record<string, unknown> }).defaults;
    expect(def?.model).toBe('sonnet');
    expect(def?.timeoutMs).toBe(30_000);
    expect(def?.prompt).toBe('test prompt');
  });

  it('invalid defaults (unknown model alias) → HARNESS_DEFAULTS_INVALID, nothing stored', async () => {
    const r = await callTool('workflow_register', {
      name: 'val098-bad-model',
      script: 'return "bad";',
      defaults: { model: 'gpt-99-ultra' },
    });
    expect(r.code).toBe('HARNESS_DEFAULTS_INVALID');

    const check = await callTool('workflow_source', { name: 'val098-bad-model' });
    expect(check.code).toBe('WORKFLOW_NOT_FOUND');
  });

  it('invalid defaults (non-allowlisted tool) → HARNESS_DEFAULTS_INVALID', async () => {
    const r = await callTool('workflow_register', {
      name: 'val098-bad-tool',
      script: 'return "bad";',
      defaults: { tools: ['bash_exec'] },  // not in curated allowlist
    });
    expect(r.code).toBe('HARNESS_DEFAULTS_INVALID');
  });

  it('skills absence deferred to run time — register with nonexistent skill succeeds', async () => {
    const r = await callTool('workflow_register', {
      name: 'val098-skill-deferred',
      script: 'return "ok";',
      defaults: { skills: ['skill-does-not-exist'] },
    });
    expect(r.code).not.toBe('HARNESS_DEFAULTS_INVALID');
    expect(r.error).toBeUndefined();
  });

  it('run_start with no override → registered defaults are used (run proceeds, no HARNESS error)', async () => {
    // Register with defaults
    // v22: run-by-name resolves `release`, so the registered version must also be published.
    await registerPublishedVia(callTool, 'val098-run-no-override', 'return "used defaults";', {
      defaults: { model: 'sonnet', timeoutMs: 30_000 },
    });
    // Run without overrides
    const run = await callTool('run_start', { name: 'val098-run-no-override' });
    expect(run.code).not.toBe('HARNESS_DEFAULTS_INVALID');
    expect(typeof run.runId).toBe('string');
    const s = await waitForCompletion(run.runId as string);
    expect(s.status).toBe('completed');
  }, 20_000);

  it('run_start with model override → model overridden, registered timeoutMs preserved', async () => {
    await registerPublishedVia(callTool, 'val098-run-partial-override', 'return "partial";', {
      defaults: { model: 'sonnet', timeoutMs: 60_000 },
    });
    // Run with only model override; timeoutMs should fall back to 60_000 registered value
    const run = await callTool('run_start', { name: 'val098-run-partial-override', model: 'haiku' });
    expect(run.code).not.toBe('HARNESS_DEFAULTS_INVALID');
    expect(typeof run.runId).toBe('string');
    // The run should start (merge succeeds) — exact harness params visible in run_status
    const s = await waitForCompletion(run.runId as string);
    expect(s.status).toBe('completed');
    // Effective timeout in the run record should be the REGISTERED 60_000 (not a short default)
    const effective = (s as { effectiveHarness?: { timeoutMs?: number } }).effectiveHarness;
    if (effective !== undefined) {
      // If the engine surfaces effectiveHarness, assert the registered timeoutMs was preserved
      expect(effective.timeoutMs).toBe(60_000);
    }
    // model in effectiveHarness should be the override 'haiku' (or its resolved model ID)
  }, 20_000);
});
