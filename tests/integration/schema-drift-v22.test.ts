// IT-087 (ARCH-073, DES-114, DES-117, TASK-109): schema drift-lock for v22 — `script` +
// `scriptSha256` removed from `workflow_run`/`workflow_resume`'s advertised schemas, the new
// `workflow_publish` tool, `version`/`channel` parameters with descriptions.
//
// Cases (drift-lock per DES-119 per-tier mock policy — schema is prose, asserted for PRESENCE;
// closure itself is asserted literally):
//   1. workflow_run: neither `script` nor `scriptSha256` in inputSchema.properties
//   2. workflow_run: `version` (string) and `channel` (enum beta|release) ARE present, each with a
//      non-empty description
//   3. workflow_resume: no `script` property
//   4. workflow_publish: a NEW tool, `{name, version, channel}` required, channel enum beta|release
//
// Red reason: today `workflow_run`/`workflow_resume` still advertise `script` (and `workflow_run`
// advertises `scriptSha256`); neither advertises `version`/`channel`; `workflow_publish` does not
// exist in tools/list at all. Every assertion below fails against the current schema.
//
// Mock policy (integration): real server, real tools/list response; no LLM.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

type Schema = { type?: string; enum?: string[]; description?: string; properties?: Record<string, Schema> };

let server: Server;
let tmpDir: string;
let toolsMap: Record<string, { description?: string; inputSchema?: Schema; required?: string[] }>;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it087-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const body = await res.json() as { result?: { tools?: Array<{ name: string; description?: string; inputSchema?: Schema & { required?: string[] } }> } };
  toolsMap = Object.fromEntries((body.result?.tools ?? []).map((t) => [t.name, { description: t.description, inputSchema: t.inputSchema, required: t.inputSchema?.required }]));
});

afterAll(async () => { await server?.close(); rmSync(tmpDir, { recursive: true, force: true }); });

describe('v22 schema drift-lock — workflow_run (ARCH-073, DES-114, IT-087)', () => {
  it('workflow_run advertises NEITHER `script` NOR `scriptSha256`', () => {
    const props = toolsMap['workflow_run']?.inputSchema?.properties ?? {};
    expect('script' in props).toBe(false);
    expect('scriptSha256' in props).toBe(false);
  });

  it('workflow_run advertises `version` (string, non-empty description)', () => {
    const versionProp = toolsMap['workflow_run']?.inputSchema?.properties?.['version'];
    expect(versionProp?.type).toBe('string');
    expect(versionProp?.description?.length ?? 0).toBeGreaterThan(0);
  });

  it('workflow_run advertises `channel` with the closed beta|release enum and a non-empty description', () => {
    const channelProp = toolsMap['workflow_run']?.inputSchema?.properties?.['channel'];
    expect(channelProp?.enum?.slice().sort()).toEqual(['beta', 'release']);
    expect(channelProp?.description?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('v22 schema drift-lock — workflow_resume (ARCH-073, DES-114, IT-087)', () => {
  it('workflow_resume no longer advertises `script`', () => {
    const props = toolsMap['workflow_resume']?.inputSchema?.properties ?? {};
    expect('script' in props).toBe(false);
  });

  it('workflow_resume still requires only `runId` (unchanged plain resume still works)', () => {
    expect(toolsMap['workflow_resume']?.required).toEqual(['runId']);
  });
});

describe('v22 schema drift-lock — workflow_publish (NEW tool, ARCH-073, DES-114, IT-087)', () => {
  it('workflow_publish exists in tools/list', () => {
    expect(toolsMap['workflow_publish']).toBeDefined();
  });

  it('workflow_publish requires name, version, channel', () => {
    expect(toolsMap['workflow_publish']?.required?.slice().sort()).toEqual(['channel', 'name', 'version']);
  });

  it('workflow_publish `channel` is the closed beta|release enum', () => {
    const channelProp = toolsMap['workflow_publish']?.inputSchema?.properties?.['channel'];
    expect(channelProp?.enum?.slice().sort()).toEqual(['beta', 'release']);
  });
});

describe('v22 schema drift-lock — workflow_get (ARCH-073, DES-114, IT-087)', () => {
  it('workflow_get advertises an optional `version` property', () => {
    const versionProp = toolsMap['workflow_get']?.inputSchema?.properties?.['version'];
    expect(versionProp).toBeDefined();
    expect(toolsMap['workflow_get']?.required).toEqual(['name']); // version stays optional
  });
});
