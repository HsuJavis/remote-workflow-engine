// UT-156 (DES-154, v24): materializeAssets(roots, workspace, declared, resolveMcp) — SELECTIVE,
// pure over an injected fs facade. Written test-first (Gate 5, RED) — today's materializeAssets
// is a private copy-ALL function (`claude-agent-sdk-client.ts:166`, not exported) taking
// (assetRoot, workspace) with no `declared` set at all.
import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error — materializeAssets is not exported with the v24 signature yet (TASK-145)
import { materializeAssets } from '../../src/gateway/claude-agent-sdk-client.js';

describe('materializeAssets — selective, pure over injected fs (UT-156, DES-154)', () => {
  it('only the DECLARED skills are copied, not every skill in the tree', async () => {
    const fs = { exists: vi.fn((p: string) => p.includes('reviewer')), copyDir: vi.fn(), writeFile: vi.fn() };
    const result = await materializeAssets(
      { workflow: '/root/wf', global: '/root/global' },
      '/workspace',
      { skills: ['reviewer'], mcp: [] },
      async () => ({ configs: {}, missing: [] }),
      fs,
    );
    expect(result.skills).toEqual(['reviewer']);
    expect(fs.copyDir).toHaveBeenCalledTimes(1);
  });

  it('workflow scope wins a name clash with global', async () => {
    const fs = { exists: vi.fn(() => true), copyDir: vi.fn(), writeFile: vi.fn() };
    await materializeAssets(
      { workflow: '/root/wf', global: '/root/global' },
      '/workspace',
      { skills: ['dup'], mcp: [] },
      async () => ({ configs: {}, missing: [] }),
      fs,
    );
    expect(fs.copyDir).toHaveBeenCalledWith(expect.stringContaining('/root/wf'), expect.anything());
  });

  it('a declared skill absent in BOTH roots lands in missing[] and the run proceeds (no refusal)', async () => {
    const fs = { exists: vi.fn(() => false), copyDir: vi.fn(), writeFile: vi.fn() };
    const result = await materializeAssets(
      { workflow: '/root/wf', global: '/root/global' },
      '/workspace',
      { skills: ['ghost'], mcp: [] },
      async () => ({ configs: {}, missing: [] }),
      fs,
    );
    expect(result.missing).toEqual(['ghost']);
  });

  it('.mcp.json is rewritten (never merged) to an empty server map when declared.mcp is empty', async () => {
    const fs = { exists: vi.fn(() => false), copyDir: vi.fn(), writeFile: vi.fn() };
    await materializeAssets({ workflow: '/root/wf', global: '/root/global' }, '/workspace', { skills: [], mcp: [] }, async () => ({ configs: {}, missing: [] }), fs);
    expect(fs.writeFile).toHaveBeenCalledWith(expect.stringContaining('.mcp.json'), JSON.stringify({ mcpServers: {} }, null, 2));
  });
});
