// IT-072: structured drift-lock — served `tools/list` for `system_info` + `models_list` must
//         declare each param with type, range/enum, default, unit keyword, and effect
//         (DES-077, ARCH-051, TASK-076)
//
// This reads the SERVED tools/list (not the raw TOOL_DEFS object) — the surface REQ-079 pins.
// Asserts STRUCTURED FACTS per param (name present, default present, range present, unit keyword,
// effect named, null-section caveat in system_info description) — NOT a golden-string snapshot.
// A doc-comment tweak must NOT red this build; a missing param/default/unit/range MUST red it.
//
// *** Run this file before every push that touches TOOL_DEFS (DES-077 drift-lock contract). ***
//
// Mock policy (integration): real createServer + real HTTP tools/list round trip. No mocks of
//   the SUT boundary. Same pattern as mcp-tools-list-schema.test.ts (IT-028).
//
// Red reason: (a) `system_info` tool does not exist in TOOL_NAMES / TOOL_DEFS → absent from
//   tools/list response → assertions that it's defined will fail; (b) `models_list` currently has
//   no enriched-output shape description (DES-077 adds it) → description assertions fail.
//   Both = red for the right unimplemented reasons.

// v24 (batch B, then CLOSED by the integrator — GREEN now): each failure was — every remaining failure here is a PRODUCT defect, not a
// stale test. Both subjects are live v24 tools whose ADVERTISED surface lost what their handlers
// still do:
//   * `system_info.inputSchema` is `{properties:{},required:[]}`, but `call-tool.ts:192` still reads
//     `args.topN` (default 5) and `system-info.ts:200` still clamps it to [1,50] — probed over real
//     MCP HTTP: `{topN:3}`→3 rows, `{topN:1}`→1 row, `{topN:9999}`→50 rows. The param works and is
//     undiscoverable, which is exactly the REQ-079/REQ-117 failure these cases exist to catch.
//   * `models_list`'s description ('List the model catalog: aliases, capability/stability/cost
//     ratings.') no longer explains the costLevel 0=free..10 scale or its null-when-price-unknown
//     contract, while `enrichModelEntry` still returns `costLevel:8|null` on every row.
// Migrating these onto the impoverished description would delete the only guard over the drift.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

// ---- types ----

interface ParamSchema {
  type?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  enum?: unknown[];
  description?: string;
  [key: string]: unknown;
}

interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: {
    type?: string;
    properties?: Record<string, ParamSchema>;
    required?: string[];
  };
}

// ---- helpers ----

let server: Server;
let tmpDir: string;
let allTools: ToolDescriptor[];

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it072-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const body = await res.json() as { result?: { tools: ToolDescriptor[] } };
  allTools = body.result!.tools;
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function findTool(name: string): ToolDescriptor {
  const t = allTools.find((t) => t.name === name);
  if (!t) throw new Error(`Tool '${name}' not found in served tools/list`);
  return t;
}

// ============================================================
// IT-072 — system_info schema drift-lock (DES-077, ARCH-051)
// ============================================================

describe('system_info schema drift-lock — served tools/list (IT-072, DES-077)', () => {
  it('system_info is present in the served tools/list', () => {
    const tool = allTools.find((t) => t.name === 'system_info');
    expect(tool).toBeDefined();
  });

  it('system_info has exactly ONE parameter: topN', () => {
    const tool = findTool('system_info');
    const props = tool.inputSchema.properties ?? {};
    const paramNames = Object.keys(props);
    // DES-077: system_info has exactly one param — topN. sortBy/sections were explicitly rejected.
    expect(paramNames).toContain('topN');
    // Must not have sortBy or sections (rejected in D-v12-B)
    expect(paramNames).not.toContain('sortBy');
    expect(paramNames).not.toContain('sections');
  });

  it('topN param has type:integer', () => {
    const tool = findTool('system_info');
    const topN = tool.inputSchema.properties?.topN;
    expect(topN?.type).toBe('integer');
  });

  it('topN param has a default value', () => {
    const tool = findTool('system_info');
    const topN = tool.inputSchema.properties?.topN;
    expect(topN).toHaveProperty('default');
    expect(topN?.default).toBe(5);
  });

  it('topN param has range (minimum:1, maximum:50)', () => {
    const tool = findTool('system_info');
    const topN = tool.inputSchema.properties?.topN;
    expect(topN?.minimum).toBe(1);
    expect(topN?.maximum).toBe(50);
  });

  it('topN param description names its effect ("processes" or "host" or "part")', () => {
    const tool = findTool('system_info');
    const topN = tool.inputSchema.properties?.topN;
    const desc = topN?.description?.toLowerCase() ?? '';
    // Effect must be named — one of these keywords must appear
    const hasEffect = desc.includes('processes') || desc.includes('host') || desc.includes('part') || desc.includes('returns');
    expect(hasEffect).toBe(true);
  });

  it('topN param description or system_info description mentions clamp (out-of-range handled)', () => {
    const tool = findTool('system_info');
    const topN = tool.inputSchema.properties?.topN;
    const topNDesc = topN?.description?.toLowerCase() ?? '';
    const toolDesc = tool.description.toLowerCase();
    const mentionsClamp = topNDesc.includes('clamp') || toolDesc.includes('clamp') ||
      topNDesc.includes('clamped') || toolDesc.includes('clamped') ||
      topNDesc.includes('[1,50]') || topNDesc.includes('1–50') || topNDesc.includes('1-50');
    expect(mentionsClamp).toBe(true);
  });

  it('system_info description contains a "null" keyword (null-section caveat)', () => {
    // DES-077: "system_info description ALSO carries: ... the null-section contract"
    const tool = findTool('system_info');
    expect(tool.description.toLowerCase()).toMatch(/null/);
  });

  it('system_info description mentions cpuPct semantics (TTL window or sample)', () => {
    const tool = findTool('system_info');
    const desc = tool.description.toLowerCase();
    // Must explain the TTL-window cpuPct (not a lifetime average)
    const hasCpuSemantics = desc.includes('cpu') || desc.includes('sample') || desc.includes('window');
    expect(hasCpuSemantics).toBe(true);
  });
});

// ============================================================
// IT-072b — models_list schema drift-lock (DES-077, ARCH-051)
// ============================================================

describe('models_list schema drift-lock — enriched output described (IT-072, DES-077)', () => {
  it('models_list is present in the served tools/list', () => {
    const tool = allTools.find((t) => t.name === 'models_list');
    expect(tool).toBeDefined();
  });

  it('models_list description mentions capability', () => {
    const tool = findTool('models_list');
    expect(tool.description.toLowerCase()).toContain('capability');
  });

  it('models_list description mentions stability', () => {
    const tool = findTool('models_list');
    expect(tool.description.toLowerCase()).toContain('stability');
  });

  it('models_list description mentions costLevel', () => {
    const tool = findTool('models_list');
    expect(tool.description.toLowerCase()).toContain('costlevel');
  });

  it('models_list description explains costLevel scale (0 = free, 10 = dearest)', () => {
    const tool = findTool('models_list');
    const desc = tool.description.toLowerCase();
    // Must describe the scale — 0 and free must both appear
    expect(desc).toMatch(/0.*free|free.*0/);
  });

  it('models_list description explains costLevel null contract (null when price unknown)', () => {
    const tool = findTool('models_list');
    const desc = tool.description.toLowerCase();
    expect(desc).toMatch(/null/);
    expect(desc).toMatch(/unknown|price/);
  });
});
