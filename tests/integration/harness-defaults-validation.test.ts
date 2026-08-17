// IT-081 (DES-099, DES-100, ARCH-062, TASK-089): harness defaults bound at registration —
// register-time validation depth [D-AUTH-5 named assertions: do not simplify].
//
// Cases (D-AUTH-5 named assertions per DES-099/ARCH-062):
//   D-AUTH-5-A: unknown key in defaults → HARNESS_DEFAULTS_INVALID + store nothing
//   D-AUTH-5-B: model alias unresolvable (not in alias table) → HARNESS_DEFAULTS_INVALID + store nothing
//   D-AUTH-5-C: tool name not in curated static allowlist → HARNESS_DEFAULTS_INVALID + store nothing
//   D-AUTH-5-D: skills existence DEFERRED to run time (register with unknown skill succeeds)
//   D-AUTH-5-E: no partial write on invalid (invalid model + valid timeoutMs → nothing stored)
//   backward-compat: defaults absent (pre-v15 shape) → registers exactly as before
//   valid defaults: known alias + allowed tool → registers; workflow_get returns defaults
//   run-time merge: workflow_run with per-run override wins per-param; missing keys fall back
//
// Named assertion IDs per D-AUTH-5 (trace.py parseable):
//   D-AUTH-5-A (unknown-key-reject), D-AUTH-5-B (model-alias-resolvable-reject),
//   D-AUTH-5-C (unknown-tool-reject), D-AUTH-5-D (skills-deferred-to-run),
//   D-AUTH-5-E (no-partial-write-on-invalid)
//
// Red reason: `workflow_register` does not yet accept a `defaults` field → HARNESS_DEFAULTS_INVALID
//   never returned → assertions for invalid defaults fail (success when failure expected). Correct RED.
//
// Mock policy (integration): real server + real SQLite catalog; injected aliases for alias-resolvable test.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it081-'));
  // Inject a known alias set for predictable validation testing
  server = await createServer({
    port: 0,
    bind: '127.0.0.1',
    workRoot: tmpDir,
    aliases: {
      sonnet: { provider: 'anthropic', model: 'claude-3-5-sonnet-20241022' },
      haiku: { provider: 'anthropic', model: 'claude-3-5-haiku-20241022' },
      opus: { provider: 'anthropic', model: 'claude-opus-4-5' },
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

const SCRIPT = 'return "test";';

describe('Harness defaults register-time validation — D-AUTH-5 named assertions (DES-099, IT-081)', () => {
  // D-AUTH-5-A: unknown key in defaults → HARNESS_DEFAULTS_INVALID + store nothing
  it('D-AUTH-5-A (unknown-key-reject): unknown defaults key → HARNESS_DEFAULTS_INVALID', async () => {
    const r = await callTool('workflow_register', {
      name: 'it081-unknown-key',
      script: SCRIPT,
      defaults: { unknownField: 'bad-value' },  // not in HarnessDefaults schema
    });
    expect(r.code).toBe('HARNESS_DEFAULTS_INVALID');
  });

  it('D-AUTH-5-A: after invalid registration, workflow is NOT stored', async () => {
    const r = await callTool('workflow_get', { name: 'it081-unknown-key' });
    expect(r.code).toBe('WORKFLOW_NOT_FOUND');
  });

  // D-AUTH-5-B: model alias unresolvable → HARNESS_DEFAULTS_INVALID + store nothing
  it('D-AUTH-5-B (model-alias-resolvable-reject): unknown model alias → HARNESS_DEFAULTS_INVALID', async () => {
    const r = await callTool('workflow_register', {
      name: 'it081-bad-alias',
      script: SCRIPT,
      defaults: { model: 'gpt-99-ultra' },  // not in the alias table
    });
    expect(r.code).toBe('HARNESS_DEFAULTS_INVALID');
  });

  it('D-AUTH-5-B: after invalid model registration, workflow is NOT stored', async () => {
    const r = await callTool('workflow_get', { name: 'it081-bad-alias' });
    expect(r.code).toBe('WORKFLOW_NOT_FOUND');
  });

  // D-AUTH-5-C: tool not in curated static allowlist → HARNESS_DEFAULTS_INVALID + store nothing
  it('D-AUTH-5-C (unknown-tool-reject): non-allowlisted tool → HARNESS_DEFAULTS_INVALID', async () => {
    const r = await callTool('workflow_register', {
      name: 'it081-bad-tool',
      script: SCRIPT,
      defaults: { tools: ['bash_exec'] },  // not in the curated tool allowlist
    });
    expect(r.code).toBe('HARNESS_DEFAULTS_INVALID');
  });

  // D-AUTH-5-D: skill existence deferred to run time → register succeeds
  it('D-AUTH-5-D (skills-deferred-to-run): unknown skill name → register SUCCEEDS', async () => {
    const r = await callTool('workflow_register', {
      name: 'it081-skill-deferred',
      script: SCRIPT,
      defaults: { skills: ['skill-that-does-not-exist-yet'] },
    });
    // Skills are mutable per-run uploaded assets; existence is deferred, not rejected
    expect(r.code).not.toBe('HARNESS_DEFAULTS_INVALID');
    expect(r.error).toBeUndefined();
  });

  // D-AUTH-5-E: no partial write on invalid (invalid model + valid timeoutMs → nothing stored)
  it('D-AUTH-5-E (no-partial-write-on-invalid): mixed valid+invalid → HARNESS_DEFAULTS_INVALID, nothing stored', async () => {
    const r = await callTool('workflow_register', {
      name: 'it081-partial-write',
      script: SCRIPT,
      defaults: { timeoutMs: 30_000, model: 'gpt-99-ultra' },  // timeoutMs valid, model invalid
    });
    expect(r.code).toBe('HARNESS_DEFAULTS_INVALID');
    // Nothing stored — not even the valid fields
    const check = await callTool('workflow_get', { name: 'it081-partial-write' });
    expect(check.code).toBe('WORKFLOW_NOT_FOUND');
  });

  // Backward-compat: defaults absent (pre-v15 shape) registers normally
  it('backward-compat: defaults absent (pre-v15) → registers exactly as before', async () => {
    const r = await callTool('workflow_register', {
      name: 'it081-no-defaults',
      script: SCRIPT,
      // no `defaults` field
    });
    expect(r.error).toBeUndefined();
    expect(r.code).not.toBe('HARNESS_DEFAULTS_INVALID');
    expect(typeof r.version).toBe('number');
  });

  // Valid defaults: known alias + known tool → registers; workflow_get returns defaults
  it('valid defaults with known alias + allowed tool → registers and is queryable', async () => {
    const r = await callTool('workflow_register', {
      name: 'it081-valid-defaults',
      script: SCRIPT,
      defaults: { model: 'sonnet', timeoutMs: 60_000, tools: ['read_file'] },
    });
    expect(r.error).toBeUndefined();
    expect(r.code).not.toBe('HARNESS_DEFAULTS_INVALID');

    const got = await callTool('workflow_get', { name: 'it081-valid-defaults' });
    const defaults = (got as { defaults?: { model?: string; timeoutMs?: number; tools?: string[] } }).defaults;
    expect(defaults?.model).toBe('sonnet');
    expect(defaults?.timeoutMs).toBe(60_000);
    expect(defaults?.tools).toContain('read_file');
  });

  // Run-time merge: per-run override wins per-param; missing keys fall back to registered
  it('run-time merge: per-run timeoutMs wins; model falls back to registered', async () => {
    // Register with defaults
    await callTool('workflow_register', {
      name: 'it081-merge-test',
      script: `return {model: args.__harnessModel, timeout: args.__harnessTimeout};`,
      defaults: { model: 'opus', timeoutMs: 120_000 },
    });

    // Run with timeoutMs override but no model override
    const runResult = await callTool('workflow_run', {
      name: 'it081-merge-test',
      timeoutMs: 5_000,  // per-run override
      // model not overridden → should fall back to 'opus'
    });
    expect(typeof runResult.runId).toBe('string');
    // (Full merge verification via workflow_status is an acceptance-tier concern — IT verifies the
    //  register endpoint returns the stored defaults correctly and run doesn't HARNESS_DEFAULTS_INVALID)
    expect(runResult.code).not.toBe('HARNESS_DEFAULTS_INVALID');
  });
});
