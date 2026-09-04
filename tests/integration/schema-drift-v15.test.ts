// IT-082 (DES-099, DES-100, ARCH-062, TASK-089): schema drift-lock for v15 new fields on
// `workflow_register` and `workflow_deregister` tools, and `workflow_source` output shape.
//
// Cases (drift-lock per DES-100 per-tier mock policy):
//   1. tools/list: `workflow_register` schema declares `defaults` (optional) in its input schema
//   2. tools/list: `workflow_register` schema declares `principal` (optional string) — v15 attribution
//   3. tools/list: `workflow_deregister` schema declares `principal` (optional string)
//   4. `workflow_source` output: field `owner` present in description (observable via workflow_source response)
//   5. `workflow_source` output: field `defaults` present in description
//
// Red reason: `workflow_register` tool schema does not yet have `defaults` or `principal` fields →
//   the tool description assertions fail. Correct RED for unimplemented schema changes.
//
// Mock policy (integration): real server, real tools/list response; no LLM.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;
let toolsMap: Record<string, { description?: string; inputSchema?: { properties?: Record<string, unknown> } }>;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it082-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });

  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const body = await res.json() as { result?: { tools?: Array<{ name: string; description?: string; inputSchema?: unknown }> } };
  toolsMap = Object.fromEntries(
    (body.result?.tools ?? []).map(t => [t.name, { description: t.description, inputSchema: t.inputSchema as { properties?: Record<string, unknown> } }]),
  );
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('v15 schema drift-lock — workflow_register (DES-099, IT-082)', () => {
  it('workflow_register exists in tools/list', () => {
    expect(toolsMap['workflow_register']).toBeDefined();
  });

  it('workflow_register inputSchema has optional `defaults` property (HarnessDefaults)', () => {
    const schema = toolsMap['workflow_register']?.inputSchema;
    expect(schema?.properties?.['defaults']).toBeDefined();
  });

  it('workflow_register inputSchema has optional `principal` property (attribution)', () => {
    const schema = toolsMap['workflow_register']?.inputSchema;
    expect(schema?.properties?.['principal']).toBeDefined();
  });

  it('workflow_register description mentions harness defaults or model binding', () => {
    const desc = toolsMap['workflow_register']?.description ?? '';
    // The description should reference defaults/harness binding per DES-099
    expect(desc.toLowerCase()).toMatch(/default|harness/);
  });

  // v21 Gate 8 RE-REVIEW #5 (C-3): the schema advertised only 5 of the 7 keys the engine actually
  // accepts/applies (`effort`/`appendPrompt` widened by adjudication #6's F-1) — a docs/behaviour
  // split ARCH-067's own note forbids. Pin the full property list so it cannot silently lag again.
  it('workflow_register inputSchema `defaults` advertises all 7 HarnessDefaults keys (v21 F-1 widening, C-3)', () => {
    const schema = toolsMap['workflow_register']?.inputSchema;
    const props = (schema?.properties?.['defaults'] as { properties?: Record<string, unknown> } | undefined)?.properties;
    expect(Object.keys(props ?? {}).sort()).toEqual(
      ['appendPrompt', 'effort', 'model', 'prompt', 'skills', 'timeoutMs', 'tools'].sort(),
    );
  });
});

describe('v15 schema drift-lock — workflow_deregister (DES-099, IT-082)', () => {
  it('workflow_deregister inputSchema has optional `principal` property', () => {
    const schema = toolsMap['workflow_deregister']?.inputSchema;
    expect(schema?.properties?.['principal']).toBeDefined();
  });
});

describe('v15 schema drift-lock — workflow_source output (DES-098, DES-099, IT-082)', () => {
  it('workflow_source description mentions owner', () => {
    const desc = toolsMap['workflow_source']?.description ?? '';
    expect(desc.toLowerCase()).toMatch(/owner/);
  });

  it('workflow_source description mentions defaults', () => {
    const desc = toolsMap['workflow_source']?.description ?? '';
    expect(desc.toLowerCase()).toMatch(/default/);
  });
});
