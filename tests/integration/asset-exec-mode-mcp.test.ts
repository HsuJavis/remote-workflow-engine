// Issue #105 part A (owner decision): workspace_push's skill-mode `files` entries get a per-file
// optional `exec` flag ({path, contentB64, exec?}) — exec:true materializes 0o755 on disk (both in
// the pushed asset tree and, per materializeAssets/copyFileSync's mode-preserving copy, in every
// run workspace that skill is later copied into); absent/false materializes 0o644. exec:true on
// the skill's own top-level SKILL.md is refused INVALID_ARGUMENT.
//
// MCP-level (real HTTP, real createServer(), no mock of the SUT boundary — same policy as
// asset-mcp-tools.test.ts / asset-squatting-ownership.test.ts). The RED evidence for this
// behaviour was carried at the unit tier (tests/unit/asset-exec-mode.test.ts, against
// AssetSyncService.push() directly, pre-fix); this file was added AFTER that GREEN, to pin the
// same behaviour over the real MCP HTTP transport rather than assuming the facade forwards
// `exec` unchanged.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../../src/server.js';
import type { Server } from '../../src/server.js';

let server: Server;
let tmpDir: string;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-it105a-'));
  server = await createServer({ port: 0, bind: '127.0.0.1', workRoot: tmpDir });
});

afterAll(async () => {
  await server?.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(name: string, args: Record<string, unknown>): Promise<any> {
  const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json() as { result?: { content?: Array<{ text?: string }> } };
  return JSON.parse(body.result?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
}
const codeOf = (r: Record<string, unknown>) => (r['code'] ?? (r['error'] as { code?: string } | undefined)?.code) as string | undefined;

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

describe('workspace_push skill files: exec flag over real MCP HTTP (issue #105 part A)', () => {
  it('exec:true materializes 0o755 on disk, exec absent stays 0o644, in the SAME push call', async () => {
    const wf = 'it105a-exec-mixed';
    const reg = await callTool('workflow_register', { name: wf, script: 'export const meta = { phases: [] };\nreturn 1;', mermaid: 'graph LR' });
    expect(codeOf(reg)).toBeUndefined();

    const push = await callTool('workspace_push', {
      workflow: wf, kind: 'skill', name: 'mixed',
      files: [
        { path: 'SKILL.md', contentB64: Buffer.from('# mixed skill').toString('base64') },
        { path: 'run.sh', contentB64: Buffer.from('#!/bin/sh\necho hi\n').toString('base64'), exec: true },
        { path: 'notes.txt', contentB64: Buffer.from('plain').toString('base64') },
      ],
    });
    expect(codeOf(push)).toBeUndefined();
    expect((push['result'] as { stored?: string } | undefined)?.stored).toBe('mixed');

    const skillDir = join(tmpDir, 'assets', wf, 'skill', 'mixed');
    expect(mode(join(skillDir, 'run.sh'))).toBe(0o755);
    expect(mode(join(skillDir, 'SKILL.md'))).toBe(0o644);
    expect(mode(join(skillDir, 'notes.txt'))).toBe(0o644);
  });

  it('exec:true on the skill\'s top-level SKILL.md is refused INVALID_ARGUMENT, nothing stored', async () => {
    const wf = 'it105a-exec-skillmd';
    const reg = await callTool('workflow_register', { name: wf, script: 'export const meta = { phases: [] };\nreturn 1;', mermaid: 'graph LR' });
    expect(codeOf(reg)).toBeUndefined();

    const push = await callTool('workspace_push', {
      workflow: wf, kind: 'skill', name: 'bad',
      files: [{ path: 'SKILL.md', contentB64: Buffer.from('# bad').toString('base64'), exec: true }],
    });
    expect(codeOf(push)).toBe('INVALID_ARGUMENT');

    const { existsSync } = await import('node:fs');
    expect(existsSync(join(tmpDir, 'assets', wf, 'skill', 'bad'))).toBe(false);
  });

  it('tools/list advertises the exec property on workspace_push\'s files item schema', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    });
    const body = await res.json() as { result?: { tools: Array<{ name: string; inputSchema: unknown }> } };
    const push = body.result?.tools.find((t) => t.name === 'workspace_push');
    expect(push).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const schema = push!.inputSchema as any;
    const assetBranch = (schema.oneOf as Array<Record<string, unknown>>).find((b) => (b['properties'] as Record<string, unknown> | undefined)?.['kind'] !== undefined);
    expect(assetBranch).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filesItems = ((assetBranch as any)['properties']['files']['items']['properties']) as Record<string, unknown>;
    expect(filesItems['exec']).toMatchObject({ type: 'boolean' });
  });
});
