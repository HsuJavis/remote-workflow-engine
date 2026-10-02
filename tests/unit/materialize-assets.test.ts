// UT-156 (DES-154, v24): materializeAssets(roots, workspace, declared, resolveMcp) — SELECTIVE,
// pure over an injected fs facade. Written test-first (Gate 5, RED) — today's materializeAssets
// is a private copy-ALL function (`claude-agent-sdk-client.ts:166`, not exported) taking
// (assetRoot, workspace) with no `declared` set at all.
import { describe, it, expect, vi } from 'vitest';
import { materializeAssets } from '../../src/gateway/claude-agent-sdk-client.js';
import type { McpServerConfig } from '../../src/mcp-probe.js';

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

  // issue #128: materializeAssets used to REWRITE `<workspace>/.mcp.json` on every dispatch (never
  // merged) — an admin-pushed global server's resolved config (command/args/env, including a
  // substituted `${secret:NAME}` value) landed in a file any runner of the run could
  // `workspace_pull`. It no longer writes ANY file for mcp — resolved configs travel only through
  // the return value (`mcp: Object.keys(configs)`), for the caller to thread into
  // `options.mcpServers` directly. `fs` here only still needs `exists`/`copyDir` (skills); a facade
  // with no `writeFile` at all is accepted — nothing ever calls one.
  it('writes no file at all for mcp — declared.mcp empty', async () => {
    const fs = { exists: vi.fn(() => false), copyDir: vi.fn() };
    const result = await materializeAssets({ workflow: '/root/wf', global: '/root/global' }, '/workspace', { skills: [], mcp: [] }, async () => ({ configs: {}, missing: [] }), fs);
    expect(fs.copyDir).not.toHaveBeenCalled();
    expect(result).toEqual({ skills: [], mcp: [], missing: [] });
  });

  it('writes no file at all for mcp — declared.mcp resolves to a real server config', async () => {
    const fs = { exists: vi.fn(() => false), copyDir: vi.fn() };
    // `McpServerConfig` (mcp-probe.ts) is a loose superset; `env` is not in its TS type but
    // `resolveConfig`/`materializeAssets` pass it through at runtime regardless (same convention as
    // the production call site casts `resolved` to `McpServerConfig`).
    const config = { type: 'stdio', command: 'npx', args: ['-y', 'x'], env: { TOKEN: 'resolved-secret-value' } } as unknown as McpServerConfig;
    const result = await materializeAssets(
      { workflow: '/root/wf', global: '/root/global' },
      '/workspace',
      { skills: [], mcp: ['srv'] },
      async () => ({ configs: { srv: config }, missing: [] }),
      fs,
    );
    // The resolved config (including the substituted secret) comes back to the caller — never
    // written anywhere by this function.
    expect(result).toEqual({ skills: [], mcp: ['srv'], missing: [] });
    expect(fs.copyDir).not.toHaveBeenCalled();
  });
});
