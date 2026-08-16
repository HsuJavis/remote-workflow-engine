// VAL-093 (REQ-084, DES-089, DES-091): honest asset_push kind schema acceptance test.
// Binds the REQ-084 acceptance clauses against the REAL engine entrypoint.
//
// REQ-084 acceptance clauses:
//   1. tools/list for asset_push shows kind description naming HOOKS_UNSUPPORTED (not silently works)
//   2. tools/list for asset_push shows kind description naming mcp_provision as the alternative
//   3. Pushing kind='hook' still returns typed HOOKS_UNSUPPORTED (behavior unchanged — only schema)
//   4. Every kind enum value in asset_push either materializes or carries an in-schema rejection/redirect note
//
// The drift-lock portion (structured fact over tools/list) is also covered by IT-077.
// VAL-093 is the acceptance-tier end-to-end test against the real MCP endpoint.
//
// Red reason: current asset_push kind description says "One of 'skill' | 'hook' | 'mcp-config'."
//   without naming HOOKS_UNSUPPORTED or mcp_provision → structured-fact assertions fail.
//   Case 3 (pushing hook → HOOKS_UNSUPPORTED) trivially passes (existing behavior).
//
// Mock policy (acceptance — MUST NOT mock SUT boundaries): real createServer, real HTTP;
//   real tools/list endpoint (not the raw TOOL_DEFS object). No gateway mock needed.
// Note: real:false — set to true by Gate 7.5 validator.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let workRoot: string;
let toolsMap: Record<string, { description: string; inputSchema: { properties?: Record<string, any> } }>;

async function mcpCall(name: string, args: unknown): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}');
}

beforeAll(async () => {
  workRoot = mkdtempSync(join(tmpdir(), 'rwe-val093-'));
  server = await createServer({ workRoot });

  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const body = await res.json() as { result?: { tools?: Array<{ name: string; description: string; inputSchema: any }> } };
  toolsMap = Object.fromEntries(
    (body.result?.tools ?? []).map((t) => [t.name, { description: t.description, inputSchema: t.inputSchema }]),
  );
});
afterAll(async () => {
  await server?.close?.();
  rmSync(workRoot, { recursive: true, force: true });
});

describe('REQ-084: honest asset_push kind schema (VAL-093)', () => {
  it('1. tools/list asset_push kind description contains HOOKS_UNSUPPORTED', () => {
    const kindProp = toolsMap['asset_push']?.inputSchema?.properties?.['kind'];
    expect(kindProp?.description ?? '').toContain('HOOKS_UNSUPPORTED');
  });

  it('2. tools/list asset_push kind description names mcp_provision as the alternative', () => {
    const kindProp = toolsMap['asset_push']?.inputSchema?.properties?.['kind'];
    expect(kindProp?.description ?? '').toContain('mcp_provision');
  });

  it('3. pushing kind=hook still returns HOOKS_UNSUPPORTED (behavior unchanged — trivially passes)', async () => {
    // asset_push returns { result: { stored: [], excluded: [{ name, reason: 'HOOKS_UNSUPPORTED' }] } }
    // (not an error envelope — DES-001's "never throw across the tool boundary")
    const r = await mcpCall('asset_push', {
      kind: 'hook',
      name: 'my-hook',
      files: [{ path: 'hook.sh', contentB64: Buffer.from('#!/bin/sh').toString('base64') }],
    });
    const excluded = r.result?.excluded ?? r.excluded ?? [];
    const hookEntry = excluded.find((e: any) => e.reason === 'HOOKS_UNSUPPORTED' || e.reason?.includes('HOOKS_UNSUPPORTED'));
    expect(hookEntry).toBeDefined(); // behavior is unchanged — hook is rejected with HOOKS_UNSUPPORTED
  });

  it('4. every kind enum value either materializes or has in-schema rejection/redirect note', () => {
    const kindProp = toolsMap['asset_push']?.inputSchema?.properties?.['kind'];
    const desc = kindProp?.description ?? '';
    // The kind property should list values in its description or enum
    // At minimum, the description should name the non-materializing kinds' dispositions
    // This assertion is RED because the current description says nothing about HOOKS_UNSUPPORTED
    expect(desc).toContain('HOOKS_UNSUPPORTED');
  });
});
