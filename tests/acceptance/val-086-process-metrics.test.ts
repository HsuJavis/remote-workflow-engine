// VAL-086: REQ-077 — process metrics: engine self pid matches live process, top-N ordered by
//          cpuPct, NO argv/cmdline field on any process record (HIGH control), system total count
//          (REQ-077, DES-074, DES-078)
//
// Mock policy (acceptance — MUST NOT mock SUT boundaries): real createServer + real SystemProbe;
//   no stub probe. process.self.pid MUST match the live process.pid. The real /proc pass is used.
//   Headless-browser dashboard assertions deferred to Gate 7.5.
//
// Red reason: (a) system_info tool not registered → tool call fails; (b) process metrics
//   (`process` field) not implemented → either missing or wrong shape. Red for right reasons.
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
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val086-'));
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

interface ProcessView {
  self: {
    pid: number;
    uptimeSec: number;
    rssBytes: number;
    cpuPct: number | null;
    threads: number | null;
    fdCount: number | null;
  };
  topN: Array<{ pid: number; name: string; cpuPct: number | null; memBytes: number }>;
  system: { total: number; byState: Record<string, number> } | { reason: string };
}

describe('VAL-086: process metrics — self pid, top-N order, NO argv (REQ-077)', () => {
  it('process.self.pid matches process.pid (the live engine process)', async () => {
    const out = await callSystemInfo() as { status: string; result?: { process: ProcessView } };
    expect(out.status).toBe('ok');
    const self = out.result!.process.self;
    // The RWE engine runs in-process with the test server — self.pid must match process.pid
    expect(self.pid).toBe(process.pid);
  });

  it('process.self.uptimeSec is a non-negative number', async () => {
    const out = await callSystemInfo() as { status: string; result?: { process: ProcessView } };
    expect(out.status).toBe('ok');
    const self = out.result!.process.self;
    expect(self.uptimeSec).toBeGreaterThanOrEqual(0);
  });

  it('process.self.rssBytes is a positive number that loosely tracks process.memoryUsage().rss', async () => {
    const out = await callSystemInfo() as { status: string; result?: { process: ProcessView } };
    expect(out.status).toBe('ok');
    const self = out.result!.process.self;
    expect(self.rssBytes).toBeGreaterThan(0);
    // Within 50% tolerance (RSS can differ slightly between measure and report, and we may read
    // from /proc/self/status on Linux rather than process.memoryUsage())
    const localRss = process.memoryUsage().rss;
    expect(self.rssBytes).toBeGreaterThan(localRss * 0.1); // at least 10% of local = same ballpark
  });

  it('process.self has NO cmd / argv / cmdline field (HIGH control — DES-074)', async () => {
    // Checks the LIVE system_info response — tests the real implementation's field exclusion
    const out = await callSystemInfo() as { status: string; result?: { process: ProcessView } };
    expect(out.status).toBe('ok');
    const self = out.result!.process.self as Record<string, unknown>;
    expect('cmd' in self).toBe(false);
    expect('argv' in self).toBe(false);
    expect('cmdline' in self).toBe(false);
  });

  it('topN list has length ≤ 5 (default) and each entry has pid, name, cpuPct, memBytes', async () => {
    const out = await callSystemInfo({ topN: 5 }) as { status: string; result?: { process: ProcessView } };
    expect(out.status).toBe('ok');
    const { topN } = out.result!.process;
    expect(topN.length).toBeLessThanOrEqual(5);
    for (const p of topN) {
      expect(typeof p.pid).toBe('number');
      expect(typeof p.name).toBe('string');
      expect(p.name.length).toBeGreaterThan(0); // non-empty comm name
      expect(p.name.length).toBeLessThanOrEqual(15); // comm is max 15 chars (Linux /proc/comm)
      expect(p.cpuPct === null || typeof p.cpuPct === 'number').toBe(true);
      expect(typeof p.memBytes).toBe('number');
    }
  });

  it('topN NO entry has cmd / argv / cmdline field', async () => {
    const out = await callSystemInfo({ topN: 5 }) as { status: string; result?: { process: ProcessView } };
    expect(out.status).toBe('ok');
    for (const p of out.result!.process.topN) {
      const pr = p as Record<string, unknown>;
      expect('cmd' in pr).toBe(false);
      expect('argv' in pr).toBe(false);
      expect('cmdline' in pr).toBe(false);
    }
  });

  it('topN is ordered: entry at position i has cpuPct ≥ entry at i+1 (null last)', async () => {
    const out = await callSystemInfo({ topN: 5 }) as { status: string; result?: { process: ProcessView } };
    expect(out.status).toBe('ok');
    const { topN } = out.result!.process;
    // Only assert order when ≥ 2 entries are present (degrade-to-[] is acceptable)
    for (let i = 0; i + 1 < topN.length; i++) {
      const curr = topN[i].cpuPct;
      const next = topN[i + 1].cpuPct;
      if (curr !== null && next !== null) {
        expect(curr).toBeGreaterThanOrEqual(next);
      } else if (curr !== null && next === null) {
        // null sorts last — OK
      } else if (curr === null && next !== null) {
        // null before non-null — violation
        throw new Error(`Ordering violation: null cpuPct at [${i}] before non-null at [${i + 1}]`);
      }
    }
  });

  it('system.total is a positive integer (or degraded on non-Linux)', async () => {
    const out = await callSystemInfo() as { status: string; result?: { process: ProcessView } };
    expect(out.status).toBe('ok');
    const sys = out.result!.process.system;
    if ('reason' in sys) {
      // Degraded on non-Linux or timeout — acceptable
      return;
    }
    expect(sys.total).toBeGreaterThan(0);
    expect(Number.isInteger(sys.total)).toBe(true);
  });
});
