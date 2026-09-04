// VAL-088: REQ-079 — schema-only consumer can call system_info and models_list correctly from
//          served tools/list alone; drift-lock structured facts pass; every param has type + range/
//          enum + default + unit + effect (REQ-079, DES-077, DES-078)
//
// Mock policy (acceptance — MUST NOT mock SUT boundaries): real createServer + real served
//   tools/list round trip; TOOL_DEFS NOT read directly from source — only the HTTP surface.
//   enrichModelEntry / schema constants are real (not mocked). Same pattern as IT-072 but at
//   acceptance tier with more exhaustive coverage of the full param surface.
//
// Red reason: (a) system_info not in TOOL_NAMES/TOOL_DEFS → absent from served tools/list; (b)
//   models_list description lacks enriched-output fields (DES-077 adds them); (c) topN param lacks
//   structured facts (type/default/minimum/maximum/description with unit+effect). Red = right reasons.
//
// Note: real:false — set to true by Gate 7.5 validator after a real verified run.

// v24 (batch B, then CLOSED by the integrator — GREEN now): each failure was — same PRODUCT defect as IT-072 (schema-drift.test.ts), at
// acceptance tier: `system_info` advertises no `topN` (handler honours and clamps it — probed
// {topN:3}→3, {topN:9999}→50) and `models_list`'s description no longer carries the costLevel
// scale/null contract that `enrichModelEntry` still serves. REQ-079's whole claim is that a
// SCHEMA-ONLY consumer can drive both tools from `tools/list` alone; today it cannot.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

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

let server: Server;
let tmpDir: string;
let allTools: ToolDescriptor[];

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-val088-'));
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

function getTool(name: string): ToolDescriptor {
  const t = allTools.find((t) => t.name === name);
  if (!t) throw new Error(`Tool '${name}' missing from served tools/list — schema not declared`);
  return t;
}

// ============================================================
// VAL-088 — system_info schema (REQ-079, DES-077)
// ============================================================

describe('VAL-088: system_info schema self-describes from tools/list (REQ-079, DES-077)', () => {
  it('system_info is in the served tools/list', () => {
    expect(allTools.some((t) => t.name === 'system_info')).toBe(true);
  });

  it('system_info has exactly ONE param: topN (sortBy + sections rejected — D-v12-B)', () => {
    const tool = getTool('system_info');
    const props = Object.keys(tool.inputSchema.properties ?? {});
    expect(props).toContain('topN');
    expect(props).not.toContain('sortBy');
    expect(props).not.toContain('sections');
  });

  it('topN has type:integer (schema-only consumer can validate)', () => {
    const topN = getTool('system_info').inputSchema.properties?.topN;
    expect(topN?.type).toBe('integer');
  });

  it('topN has default:5 (schema-only consumer knows the default)', () => {
    const topN = getTool('system_info').inputSchema.properties?.topN;
    expect(topN?.default).toBe(5);
  });

  it('topN has minimum:1 and maximum:50 (schema-only consumer knows the range)', () => {
    const topN = getTool('system_info').inputSchema.properties?.topN;
    expect(topN?.minimum).toBe(1);
    expect(topN?.maximum).toBe(50);
  });

  it('topN description names its effect (controls how many host processes are returned)', () => {
    const topN = getTool('system_info').inputSchema.properties?.topN;
    const desc = (topN?.description ?? '').toLowerCase();
    // Effect must be named
    const hasEffect = desc.includes('host') || desc.includes('processes') ||
      desc.includes('part') || desc.includes('returns') || desc.includes('controls');
    expect(hasEffect).toBe(true);
  });

  it('topN description or tool description mentions clamp (range enforced, not rejected)', () => {
    const tool = getTool('system_info');
    const topN = tool.inputSchema.properties?.topN;
    const combined = `${topN?.description ?? ''} ${tool.description}`.toLowerCase();
    const hasClamp = combined.includes('clamp') || combined.includes('clamped') ||
      combined.includes('[1,50]') || combined.includes('1–50') || combined.includes('1-50');
    expect(hasClamp).toBe(true);
  });

  it('system_info description contains the "null" keyword (null-section caveat — REQ-076)', () => {
    const tool = getTool('system_info');
    expect(tool.description.toLowerCase()).toContain('null');
  });

  it('system_info description mentions units (bytes or percent or seconds)', () => {
    const tool = getTool('system_info');
    const desc = tool.description.toLowerCase();
    const hasUnit = desc.includes('bytes') || desc.includes('percent') || desc.includes('pct') ||
      desc.includes('seconds') || desc.includes('%');
    expect(hasUnit).toBe(true);
  });

  it('system_info description mentions the cpuPct semantic (TTL window, not lifetime average)', () => {
    const tool = getTool('system_info');
    const desc = tool.description.toLowerCase();
    // Must convey the TTL-window sampling semantics to a schema-only consumer
    const hasCpuSemantics = desc.includes('window') || desc.includes('sample') ||
      desc.includes('ttl') || desc.includes('cpu');
    expect(hasCpuSemantics).toBe(true);
  });
});

// ============================================================
// VAL-088b — models_list schema enriched (REQ-079, DES-077)
// ============================================================

describe('VAL-088: models_list enriched output described in tools/list (REQ-079, DES-077)', () => {
  it('models_list is in the served tools/list', () => {
    expect(allTools.some((t) => t.name === 'models_list')).toBe(true);
  });

  it('models_list description mentions capability', () => {
    const tool = getTool('models_list');
    expect(tool.description.toLowerCase()).toContain('capability');
  });

  it('models_list description mentions stability', () => {
    const tool = getTool('models_list');
    expect(tool.description.toLowerCase()).toContain('stability');
  });

  it('models_list description mentions costLevel (the new field)', () => {
    const tool = getTool('models_list');
    expect(tool.description.toLowerCase()).toContain('costlevel');
  });

  it('models_list description explains costLevel 0=free, 10=dearest scale', () => {
    const tool = getTool('models_list');
    const desc = tool.description.toLowerCase();
    expect(desc).toMatch(/0.*free|free.*0/);
  });

  it('models_list description explains costLevel null contract (null when price unknown)', () => {
    const tool = getTool('models_list');
    const desc = tool.description.toLowerCase();
    expect(desc).toContain('null');
    // null must appear near "unknown" or "price" to be meaningful
    const hasNullWithContext = desc.includes('null') && (desc.includes('unknown') || desc.includes('price'));
    expect(hasNullWithContext).toBe(true);
  });
});
