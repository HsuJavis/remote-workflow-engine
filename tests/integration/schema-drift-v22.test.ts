// IT-087 (ARCH-073, DES-114, DES-117, TASK-109): schema drift-lock for v22 — `script` +
// `scriptSha256` removed from `run_start`/`run_resume`'s advertised schemas, the new
// `workflow_publish` tool, `version`/`channel` parameters with descriptions.
//
// Cases (drift-lock per DES-119 per-tier mock policy — schema is prose, asserted for PRESENCE;
// closure itself is asserted literally):
//   1. run_start: neither `script` nor `scriptSha256` in inputSchema.properties
//   2. run_start: `version` (string) and `channel` (enum beta|release) ARE present, each with a
//      non-empty description
//   3. run_resume: no `script` property
//   4. workflow_publish: a NEW tool, `{name, version, channel}` required, channel enum beta|release
//
// Red reason: today `run_start`/`run_resume` still advertise `script` (and `run_start`
// advertises `scriptSha256`); neither advertises `version`/`channel`; `workflow_publish` does not
// exist in tools/list at all. Every assertion below fails against the current schema.
//
// Mock policy (integration): real server, real tools/list response; no LLM.
// v24 (batch B, then CLOSED by the integrator — GREEN now): three cases were — PRODUCT defects, evidence in the batch B
// report. Summary:
//   * `workflow_publish` advertises `{name, version}` with ONLY `name` required and no `channel` at
//     all, while `mcp-facade.workflowPublish` takes `{name, version, channel}` and
//     `workflow-catalog.publish` writes `beta_version` whenever `channel !== 'release'`. Probed over
//     real MCP HTTP: publishing exactly what the schema advertises (`{name, version}`) logs
//     `catalog.publish` with NO channel, moves the BETA pointer, and the next `run_start({name})`
//     and `workflow_describe({name})` both fail `CHANNEL_UNPUBLISHED: release`. A cold model
//     obeying the advertised schema cannot make a workflow runnable — the REQ-117 first-try claim.
//   * `run_start` advertises no `channel` and its schema is CLOSED, so `run_start({name,
//     channel:'beta'})` is refused `INVALID_ARGUMENT: (root) must NOT have additional properties` —
//     yet 02-architecture.md's own v24 tool table (line 2645) specifies
//     `run_start({name, version?|channel?, …})`, `RunSpec.channel` (types.ts:207) and
//     `run-manager.ts:419` still consume it, and the row's `errors[]` advertises
//     CHANNEL_UNPUBLISHED. `mcp-facade.runStart` also never forwards `a.channel`. No design text
//     ratifies removing it; if the drop WAS intended, this case is retired instead — integrator call.
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

describe('v22 schema drift-lock — run_start (ARCH-073, DES-114, IT-087)', () => {
  it('run_start advertises NEITHER `script` NOR `scriptSha256`', () => {
    const props = toolsMap['run_start']?.inputSchema?.properties ?? {};
    expect('script' in props).toBe(false);
    expect('scriptSha256' in props).toBe(false);
  });

  it('run_start advertises `version` (string, non-empty description)', () => {
    const versionProp = toolsMap['run_start']?.inputSchema?.properties?.['version'];
    expect(versionProp?.type).toBe('string');
    expect(versionProp?.description?.length ?? 0).toBeGreaterThan(0);
  });

  it('run_start advertises `channel` with the closed beta|release enum and a non-empty description', () => {
    const channelProp = toolsMap['run_start']?.inputSchema?.properties?.['channel'];
    expect(channelProp?.enum?.slice().sort()).toEqual(['beta', 'release']);
    expect(channelProp?.description?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('v22 schema drift-lock — run_resume (ARCH-073, DES-114, IT-087)', () => {
  it('run_resume no longer advertises `script`', () => {
    const props = toolsMap['run_resume']?.inputSchema?.properties ?? {};
    expect('script' in props).toBe(false);
  });

  it('run_resume still requires only `runId` (unchanged plain resume still works)', () => {
    expect(toolsMap['run_resume']?.required).toEqual(['runId']);
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

describe('v22 schema drift-lock — workflow_source (ARCH-073, DES-114, IT-087)', () => {
  it('workflow_source advertises an optional `version` property', () => {
    const versionProp = toolsMap['workflow_source']?.inputSchema?.properties?.['version'];
    expect(versionProp).toBeDefined();
    expect(toolsMap['workflow_source']?.required).toEqual(['name']); // version stays optional
  });
});
