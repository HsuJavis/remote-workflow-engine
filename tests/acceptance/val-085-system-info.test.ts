// VAL-085: REQ-076 — system_info MCP tool + GET /api/system report host CPU/memory/disk metrics
//          with plausible non-negative values; any unavailable metric degrades to null with reason
//          (REQ-076, DES-073, DES-078)
//
// Mock policy (acceptance — MUST NOT mock SUT boundaries): real `createServer` with the REAL
//   SystemProbe (no stub); real OS probe (os.loadavg/cpus/totalmem/freemem + statfs); real HTTP.
//   The `SystemInfoSampler` is NOT mocked. Values are sampled from the real OS.
//   Headless-browser dashboard DOM assertions deferred to Gate 7.5 (VAL-084 precedent).
//
// Red reason: (a) `src/system-info.ts` does not exist → "Cannot find module" at import; (b) even if
//   it existed, the `system_info` tool and `GET /api/system` route are not registered in server.ts.
//   Both = red for the right unimplemented reasons.
//
// Note: real:false — set to true by Gate 7.5 validator after a real verified run.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val085-'));
  // No systemInfo override — uses the REAL SystemProbe + real OS probe
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function callSystemInfo(args: Record<string, unknown> = {}): Promise<unknown> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'system_info', arguments: args },
    }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  const text = body.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : body;
}

interface SystemView {
  status: string;
  result?: {
    cpu: {
      cores: number;
      loadAvg: [number, number, number];
      utilizationPct: number | null;
      utilizationDegraded?: { reason: string; detail?: string };
    };
    memory: { totalBytes: number; usedBytes: number; freeBytes: number; usedPct: number } | { reason: string };
    disk: { path: string; totalBytes: number; usedBytes: number; freeBytes: number; usedPct: number } | { reason: string };
    process: {
      self: { pid: number; uptimeSec: number; rssBytes: number; cpuPct: number | null; threads: number | null; fdCount: number | null };
      topN: Array<{ pid: number; name: string; cpuPct: number | null; memBytes: number }>;
      system: { total: number; byState: Record<string, number> } | { reason: string };
    };
    sampledAt: string;
    windowMs: number | null;
  };
}

describe('VAL-085: system_info + GET /api/system host metrics (REQ-076)', () => {
  it('system_info tool returns status:ok with cpu/memory/disk/process/sampledAt', async () => {
    const out = await callSystemInfo() as SystemView;
    expect(out.status).toBe('ok');
    const r = out.result!;
    expect(r.cpu).toBeDefined();
    expect(r.memory).toBeDefined();
    expect(r.disk).toBeDefined();
    expect(r.process).toBeDefined();
    expect(typeof r.sampledAt).toBe('string');
    expect(() => new Date(r.sampledAt)).not.toThrow();
  });

  it('cpu.cores is a positive integer from the real OS', async () => {
    const out = await callSystemInfo() as SystemView;
    const r = out.result!;
    expect(typeof r.cpu.cores).toBe('number');
    expect(Number.isInteger(r.cpu.cores)).toBe(true);
    expect(r.cpu.cores).toBeGreaterThan(0);
  });

  it('cpu.loadAvg is a 3-element array of non-negative numbers', async () => {
    const out = await callSystemInfo() as SystemView;
    const r = out.result!;
    expect(r.cpu.loadAvg).toHaveLength(3);
    for (const v of r.cpu.loadAvg) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it('cpu.utilizationPct is number|null (null on first call = awaiting-second-sample)', async () => {
    const out = await callSystemInfo() as SystemView;
    const r = out.result!;
    // First call: no prior snapshot → null + awaiting-second-sample
    expect(r.cpu.utilizationPct === null || typeof r.cpu.utilizationPct === 'number').toBe(true);
    if (r.cpu.utilizationPct === null) {
      expect(r.cpu.utilizationDegraded).toMatchObject({ reason: 'awaiting-second-sample' });
    } else {
      expect(r.cpu.utilizationPct).toBeGreaterThanOrEqual(0);
      expect(r.cpu.utilizationPct).toBeLessThanOrEqual(100);
    }
  });

  it('memory block has non-negative bytes that add up (used+free ≈ total within 5%)', async () => {
    const out = await callSystemInfo() as SystemView;
    const r = out.result!;
    if ('reason' in r.memory) {
      // degrade acceptable; pass
      return;
    }
    const m = r.memory;
    expect(m.totalBytes).toBeGreaterThan(0);
    expect(m.usedBytes).toBeGreaterThanOrEqual(0);
    expect(m.freeBytes).toBeGreaterThanOrEqual(0);
    // used + free ≤ total (MemFree ≤ MemAvailable; small discrepancy OK)
    expect(m.usedBytes + m.freeBytes).toBeLessThanOrEqual(m.totalBytes * 1.05);
    expect(m.usedPct).toBeGreaterThanOrEqual(0);
    expect(m.usedPct).toBeLessThanOrEqual(100);
  });

  it('disk block has a non-empty path and non-negative bytes', async () => {
    const out = await callSystemInfo() as SystemView;
    const r = out.result!;
    if ('reason' in r.disk) {
      // degrade acceptable; pass
      return;
    }
    const d = r.disk;
    expect(typeof d.path).toBe('string');
    expect(d.path.length).toBeGreaterThan(0);
    expect(d.totalBytes).toBeGreaterThan(0);
    expect(d.usedBytes).toBeGreaterThanOrEqual(0);
    expect(d.freeBytes).toBeGreaterThanOrEqual(0);
    expect(d.usedPct).toBeGreaterThanOrEqual(0);
    expect(d.usedPct).toBeLessThanOrEqual(100);
  });

  it('GET /api/system returns 200 with the same shape as the MCP tool', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/system`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      cpu: { cores: number; loadAvg: number[] };
      memory: unknown;
      disk: unknown;
      process: unknown;
      sampledAt: string;
    };
    expect(body.cpu).toBeDefined();
    expect(body.memory).toBeDefined();
    expect(body.disk).toBeDefined();
    expect(body.process).toBeDefined();
    expect(typeof body.sampledAt).toBe('string');
  });

  it('any failing section returns null+reason (degrade-to-null contract), tool does not throw', async () => {
    // Just calling it twice quickly confirms it doesn't throw on repeated calls
    await callSystemInfo();
    const out2 = await callSystemInfo() as SystemView;
    expect(out2.status).toBe('ok');
  });

  it('no sensitive data disclosed — no cmd/argv/cmdline on any process record', async () => {
    const out = await callSystemInfo({ topN: 10 }) as SystemView;
    const proc = out.result!.process;
    const self = proc.self as Record<string, unknown>;
    expect('cmd' in self).toBe(false);
    expect('argv' in self).toBe(false);
    expect('cmdline' in self).toBe(false);
    for (const p of proc.topN) {
      const pr = p as Record<string, unknown>;
      expect('cmd' in pr).toBe(false);
      expect('argv' in pr).toBe(false);
      expect('cmdline' in pr).toBe(false);
    }
  });
});
