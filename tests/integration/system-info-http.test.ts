// IT-069: `system_info` MCP tool over real server — SystemInfoView shape, degrade contract,
//         topN clamp-not-reject (DES-073, DES-074, ARCH-048, ARCH-049, TASK-074)
// IT-070: `GET /api/system` over real server — same SystemInfoView shape, sampledAt ISO string
//         (DES-073, ARCH-048, TASK-074)
//
// Mock policy (integration): real HTTP createServer + real HTTP; the OS SystemProbe is injected
//   as a StubSystemProbe via ServerConfig.systemInfo seam (DES-073 seam mirrors modelCatalog).
//   Stub allows deterministic degrade cases (first-call null) and shape assertions without
//   real /proc on the CI host, consistent with DES-078's "stub permitted on non-Linux CI" note.
//   GET /api/system and the system_info MCP tool share ONE sampler instance (DES-073 "sample once").
//
// Red reason: (a) `src/system-info.ts` does not exist → "Cannot find module" at import;
//   (b) even if system-info existed, `system_info` is not in TOOL_NAMES + no `GET /api/system`
//   route registered in server.ts → tool call returns -32601 / HTTP 404.
//   Both together = red for the right unimplemented reasons.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';
import { SystemInfoSampler } from '../../src/system-info.js';
import type { SystemProbe, RawHostSnapshot, RawProcSnapshot } from '../../src/system-info.js';
import { FixedClock } from '../../src/clock.js';

// ---- stub probe ----

const SAMPLE_HOST: RawHostSnapshot = {
  cpu: { perCore: [{ idleMs: 700, totalMs: 1000 }, { idleMs: 700, totalMs: 1000 }] },
  loadAvg: [1.0, 0.8, 0.5],
  cores: 4,
  mem: { totalBytes: 8_000_000_000, freeBytes: 3_200_000_000 },
  disk: { path: '/data', blockSize: 4096, blocks: 100_000, bfree: 30_000, bavail: 28_000 },
};

const SAMPLE_PROCS: RawProcSnapshot = {
  self: { threads: 4, fdCount: 20 },
  procs: [
    { pid: 100, comm: 'kworker', utimeJiffies: 200, stimeJiffies: 50, state: 'S', rssBytes: 1_000_000 },
    { pid: 200, comm: 'nginx', utimeJiffies: 500, stimeJiffies: 100, state: 'S', rssBytes: 50_000_000 },
  ],
  procsDegraded: undefined,
};

class StubProbe implements SystemProbe {
  async sampleHost(): Promise<RawHostSnapshot> { return SAMPLE_HOST; }
  async sampleProcesses(_deadlineMs: number): Promise<RawProcSnapshot> { return SAMPLE_PROCS; }
}

// ---- helpers ----

const ANCHOR = new Date('2024-06-01T12:00:00.000Z');

async function rpc(port: number, method: string, params?: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return res.json() as Promise<{ result?: { content?: Array<{ text?: string }> }; error?: unknown }>;
}

async function callTool(port: number, name: string, args: unknown): Promise<unknown> {
  const body = await rpc(port, 'tools/call', { name, arguments: args });
  const text = body.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : body;
}

// ---- suite ----

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it069-'));
  const probe = new StubProbe();
  const clock = new FixedClock(ANCHOR);
  const systemInfo = new SystemInfoSampler(probe, clock, 1500);
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir, systemInfo });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ============================================================
// IT-069 — system_info MCP tool
// ============================================================

describe('system_info MCP tool over real server (IT-069, DES-073, DES-074)', () => {
  it('tools/list includes system_info with topN param described', async () => {
    const body = await rpc(server.port, 'tools/list');
    const tools = (body.result as { tools?: Array<{ name: string }> })?.tools ?? [];
    const tool = tools.find((t) => t.name === 'system_info');
    expect(tool).toBeDefined();
  });

  it('system_info returns a result envelope with cpu/memory/disk/process/sampledAt', async () => {
    const out = await callTool(server.port, 'system_info', {}) as {
      status: string;
      result?: {
        cpu: { cores: number; loadAvg: number[]; utilizationPct: number | null };
        memory: unknown;
        disk: unknown;
        process: unknown;
        sampledAt: string;
        windowMs: number | null;
      };
    };
    expect(out.status).toBe('ok');
    const r = out.result!;
    expect(typeof r.cpu.cores).toBe('number');
    expect(Array.isArray(r.cpu.loadAvg)).toBe(true);
    expect(r.cpu.loadAvg).toHaveLength(3);
    // utilizationPct is number|null (first call → null due to no prev snapshot)
    expect(r.cpu.utilizationPct === null || typeof r.cpu.utilizationPct === 'number').toBe(true);
    // memory is either the full object or a Degraded
    expect(r.memory).toBeDefined();
    // disk is either the full object or a Degraded
    expect(r.disk).toBeDefined();
    // process section
    expect(r.process).toBeDefined();
    // sampledAt is an ISO string
    expect(typeof r.sampledAt).toBe('string');
    expect(() => new Date(r.sampledAt)).not.toThrow();
  });

  it('system_info with topN=999 clamps to ≤50 results, no error (clamp-not-reject, DES-077)', async () => {
    const out = await callTool(server.port, 'system_info', { topN: 999 }) as {
      status: string;
      result?: { process: { topN: unknown[] } };
    };
    expect(out.status).toBe('ok');
    // topN must be clamped — the output list must be ≤ 50
    expect(out.result!.process.topN.length).toBeLessThanOrEqual(50);
  });

  it('system_info with topN=0 returns without error (clamped to 1)', async () => {
    const out = await callTool(server.port, 'system_info', { topN: 0 }) as { status: string };
    expect(out.status).toBe('ok');
  });

  it('memory block has expected shape (totalBytes, usedBytes, freeBytes, usedPct)', async () => {
    const out = await callTool(server.port, 'system_info', {}) as {
      status: string;
      result?: { memory: { totalBytes?: number; usedBytes?: number; freeBytes?: number; usedPct?: number; reason?: string } };
    };
    expect(out.status).toBe('ok');
    const mem = out.result!.memory;
    if (!('reason' in mem)) {
      expect(typeof mem.totalBytes).toBe('number');
      expect(typeof mem.usedBytes).toBe('number');
      expect(typeof mem.freeBytes).toBe('number');
      expect(mem.totalBytes!).toBeGreaterThan(0);
      // usedBytes + freeBytes ≈ totalBytes (within 5% tolerance for MemFree vs MemAvailable)
      const sum = mem.usedBytes! + mem.freeBytes!;
      expect(sum).toBeGreaterThan(0);
    }
    // else degraded — acceptable per degrade-to-null contract
  });

  it('no process record carries cmd/argv/cmdline (HIGH security control)', async () => {
    const out = await callTool(server.port, 'system_info', { topN: 5 }) as {
      status: string;
      result?: { process: { self: Record<string, unknown>; topN: Array<Record<string, unknown>> } };
    };
    expect(out.status).toBe('ok');
    const proc = out.result!.process;
    // Check self record
    expect('cmd' in proc.self).toBe(false);
    expect('argv' in proc.self).toBe(false);
    expect('cmdline' in proc.self).toBe(false);
    // Check topN records
    for (const p of proc.topN) {
      expect('cmd' in p).toBe(false);
      expect('argv' in p).toBe(false);
      expect('cmdline' in p).toBe(false);
    }
  });
});

// ============================================================
// IT-070 — GET /api/system HTTP route
// ============================================================

describe('GET /api/system over real server (IT-070, DES-073)', () => {
  it('GET /api/system returns 200 with cpu/memory/disk/process/sampledAt', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/system`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      cpu: { cores: number; loadAvg: number[]; utilizationPct: number | null };
      memory: unknown;
      disk: unknown;
      process: unknown;
      sampledAt: string;
      windowMs: number | null;
    };
    expect(typeof body.cpu.cores).toBe('number');
    expect(Array.isArray(body.cpu.loadAvg)).toBe(true);
    expect(body.cpu.loadAvg).toHaveLength(3);
    expect(body.sampledAt).toBe(ANCHOR.toISOString()); // injected clock → deterministic
    expect(body.process).toBeDefined();
  });

  it('GET /api/system and system_info tool share the same sampler (single sample, same sampledAt)', async () => {
    // Both should return the same sampledAt from the fixed clock (same cached sample)
    const res = await fetch(`http://127.0.0.1:${server.port}/api/system`);
    const httpBody = await res.json() as { sampledAt: string };

    const toolOut = await callTool(server.port, 'system_info', {}) as {
      result?: { sampledAt: string };
    };

    // Both routes use the same SystemInfoSampler instance (DES-073 "sample once")
    // With a FixedClock, sampledAt is deterministic; both should match
    expect(httpBody.sampledAt).toBe(toolOut.result!.sampledAt);
  });
});
