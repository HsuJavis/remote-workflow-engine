// IT-074 (DES-084, ARCH-052, TASK-079): `run_start` TOOL_DEFS `seedRef` schema drift-lock.
// Reads the SERVED tools/list (not the raw TOOL_DEFS object) and asserts:
//   - `seedRef` property is present on `run_start`'s inputSchema
//   - `seedRef.properties.repoUrl` and `seedRef.properties.sha` exist
//   - `run_start` description or `seedRef` description contains "SEEDREF_DISABLED",
//     "seedRefAllowlist", and "mutually exclusive" keywords (consumability per DES-084)
//   - `seedRef` is NOT in `required` (it is optional, mutually exclusive with seed/seedManifest)
//   - Error redaction: the description for SEEDREF_EGRESS_DENIED references `attempted:{scheme,host}`
//     but does NOT promise to include the full URL or the allowlist contents
//
// Red reason: `run_start` TOOL_DEFS in server.ts has no `seedRef` property yet →
//   the `seedRef` property assertion fails. This is the correct unimplemented-feature red.
//
// Mock policy (integration): real `createServer` + real HTTP tools/list round trip.
//   No mocks of the SUT boundary (same pattern as IT-072 / schema-drift.test.ts).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

interface ParamSchema {
  type?: string;
  description?: string;
  properties?: Record<string, ParamSchema>;
  required?: string[];
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
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it074-'));
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

function getWorkflowRun(): ToolDescriptor {
  const t = allTools.find((t) => t.name === 'run_start');
  if (!t) throw new Error("'run_start' not found in served tools/list");
  return t;
}

describe('IT-074: run_start seedRef schema drift-lock (DES-084, ARCH-052, TASK-079)', () => {
  it('run_start is in the served tools/list', () => {
    expect(allTools.some((t) => t.name === 'run_start')).toBe(true);
  });

  it('run_start.inputSchema has a seedRef property (additive, optional)', () => {
    const tool = getWorkflowRun();
    expect(tool.inputSchema.properties).toHaveProperty('seedRef');
  });

  it('seedRef is of type object', () => {
    const seedRef = getWorkflowRun().inputSchema.properties?.['seedRef'];
    expect(seedRef?.type).toBe('object');
  });

  it('seedRef.properties.repoUrl exists (string, required for the sub-object)', () => {
    const seedRef = getWorkflowRun().inputSchema.properties?.['seedRef'];
    expect(seedRef?.properties).toHaveProperty('repoUrl');
    expect(seedRef?.properties?.['repoUrl']?.type).toBe('string');
  });

  it('seedRef.properties.sha exists (string, 40-or-64 hex)', () => {
    const seedRef = getWorkflowRun().inputSchema.properties?.['seedRef'];
    expect(seedRef?.properties).toHaveProperty('sha');
    expect(seedRef?.properties?.['sha']?.type).toBe('string');
  });

  it('seedRef is NOT in the top-level required array (it is optional)', () => {
    const tool = getWorkflowRun();
    const required = tool.inputSchema.required ?? [];
    expect(required).not.toContain('seedRef');
  });

  it('seedRef description or tool description mentions "SEEDREF_DISABLED"', () => {
    const tool = getWorkflowRun();
    const seedRef = tool.inputSchema.properties?.['seedRef'];
    const combined = `${tool.description} ${seedRef?.description ?? ''}`;
    expect(combined).toContain('SEEDREF_DISABLED');
  });

  it('seedRef description or tool description mentions "seedRefAllowlist" (actionable hint)', () => {
    const tool = getWorkflowRun();
    const seedRef = tool.inputSchema.properties?.['seedRef'];
    const combined = `${tool.description} ${seedRef?.description ?? ''}`;
    expect(combined).toContain('seedRefAllowlist');
  });

  it('seedRef description or tool description mentions "mutually exclusive" (SEED_SOURCE_CONFLICT guard)', () => {
    const tool = getWorkflowRun();
    const seedRef = tool.inputSchema.properties?.['seedRef'];
    const combined = `${tool.description} ${seedRef?.description ?? ''}`.toLowerCase();
    expect(combined).toContain('mutually exclusive');
  });
});
