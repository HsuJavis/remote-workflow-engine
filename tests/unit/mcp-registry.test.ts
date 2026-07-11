// UT-042: MCP Provisioning Registry — CRUD + strict-by-name resolveInjected (DES-024, TASK-028)
// RED: src/mcp-registry.js does not exist yet — all tests fail on module-not-found.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Value import — causes module-not-found at load time when the module is absent.
import { McpRegistry } from '../../src/mcp-registry.js';
import { FakeMcpProbe } from '../../src/mcp-probe.js';

let tmpDir: string;
beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'rwe-mcpreg-')); });
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

function makeRegistry(probeAccepts = true) {
  return new McpRegistry({ dbPath: join(tmpDir, 'mcp-registry.db'), probe: new FakeMcpProbe(probeAccepts) });
}

describe('McpRegistry CRUD (DES-024, unit — InMemory-equivalent fake probe, no network)', () => {
  it('register() with a live probe persists the row healthy:true, retrievable via get()', async () => {
    const reg = makeRegistry(true);
    const outcome = await reg.register({ name: 'search', kind: 'stdio', config: { command: 'npx', args: ['-y', 'x'] } });
    expect(outcome).toEqual({ ok: true });
    const row = reg.get('search');
    expect(row?.healthy).toBe(true);
    expect(row?.kind).toBe('stdio');
  });

  it('register() with a dead probe returns MCP_PROBE_FAILED and persists NOTHING', async () => {
    const reg = makeRegistry(false);
    const outcome = await reg.register({ name: 'dead-mcp', kind: 'http', config: { url: 'https://example.com/mcp' } });
    expect(outcome).toEqual({ ok: false, error: 'MCP_PROBE_FAILED' });
    expect(reg.get('dead-mcp')).toBeUndefined();
    expect(reg.list().some((r) => r.name === 'dead-mcp')).toBe(false);
  });

  it('list() returns every provisioned row', async () => {
    const reg = makeRegistry(true);
    await reg.register({ name: 'a', kind: 'stdio', config: { command: 'npx' } });
    await reg.register({ name: 'b', kind: 'http', config: { url: 'https://example.com' } });
    const names = reg.list().map((r) => r.name).sort();
    expect(names).toEqual(['a', 'b']);
  });

  it('delete() removes a provisioned row', async () => {
    const reg = makeRegistry(true);
    await reg.register({ name: 'to-delete', kind: 'stdio', config: { command: 'npx' } });
    await reg.delete('to-delete');
    expect(reg.get('to-delete')).toBeUndefined();
  });

  it('both stdio and http provisioned kinds are usable', async () => {
    const reg = makeRegistry(true);
    await reg.register({ name: 'stdio-one', kind: 'stdio', config: { command: 'npx' } });
    await reg.register({ name: 'http-one', kind: 'http', config: { url: 'https://example.com/mcp' } });
    expect(reg.get('stdio-one')?.kind).toBe('stdio');
    expect(reg.get('http-one')?.kind).toBe('http');
  });
});

describe('McpRegistry.resolveInjected — strict-by-name, host ambient never inherited (DES-024, REQ-017)', () => {
  it('returns ONLY the explicitly-referenced provisioned configs', async () => {
    const reg = makeRegistry(true);
    await reg.register({ name: 'a', kind: 'stdio', config: { command: 'npx', args: ['pkg-a'] } });
    await reg.register({ name: 'b', kind: 'http', config: { url: 'https://example.com/b' } });
    const resolved = reg.resolveInjected(['a']);
    expect(resolved).toEqual({ configs: { a: { command: 'npx', args: ['pkg-a'] } } });
    // 'b' was provisioned too but not referenced by this run — must NOT be injected (strictMcpConfig).
    expect('b' in (resolved as { configs: Record<string, unknown> }).configs).toBe(false);
  });

  it('an unprovisioned name yields typed MCP_NOT_PROVISIONED, never a silent no-op', async () => {
    const reg = makeRegistry(true);
    await reg.register({ name: 'a', kind: 'stdio', config: { command: 'npx' } });
    const resolved = reg.resolveInjected(['a', 'never-provisioned']);
    expect(resolved).toEqual({ error: 'MCP_NOT_PROVISIONED' });
  });

  it('an empty reference list resolves to an empty config set (no ambient MCP leaks in)', async () => {
    const reg = makeRegistry(true);
    await reg.register({ name: 'a', kind: 'stdio', config: { command: 'npx' } });
    expect(reg.resolveInjected([])).toEqual({ configs: {} });
  });
});
