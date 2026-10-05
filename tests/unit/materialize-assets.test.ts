// UT-156 (DES-154, v24): materializeAssets(roots, skillsRoot, declared, resolveMcp) — SELECTIVE,
// pure over an injected fs facade. Written test-first (Gate 5, RED) — today's materializeAssets
// is a private copy-ALL function (`claude-agent-sdk-client.ts:166`, not exported) taking
// (assetRoot, workspace) with no `declared` set at all.
//
// Issue #144 rewrite: the second parameter is no longer the run WORKSPACE — it is the caller's own
// private, per-dispatch directory OUTSIDE the workspace (`claude-agent-sdk-client.ts`'s `_invokeOnce`
// builds one per call; `pi-gateway-client.ts` reuses its own already-private `tmpDir`). Skills land at
// `<skillsRoot>/skills/<name>/`, plus a `.claude-plugin/plugin.json` manifest (once skills.length > 0)
// so the SDK's `Options.plugins` can load `skillsRoot` as a local plugin — see that function's own
// doc comment in claude-agent-sdk-client.ts for the full story and the real-CLI verification behind
// the plugin-manifest shape.
import { describe, it, expect, vi } from 'vitest';
import { materializeAssets, RWE_SKILLS_PLUGIN_NAME } from '../../src/gateway/claude-agent-sdk-client.js';
import type { McpServerConfig } from '../../src/mcp-probe.js';

function fakeFs(exists: (p: string) => boolean) {
  return { exists: vi.fn(exists), copyDir: vi.fn(), writeFile: vi.fn() };
}

describe('materializeAssets — selective, pure over injected fs (UT-156, DES-154, issue #144)', () => {
  it('only the DECLARED skills are copied, not every skill in the tree', async () => {
    const fs = fakeFs((p) => p.includes('reviewer'));
    const result = await materializeAssets(
      { workflow: '/root/wf', global: '/root/global' },
      '/private/skills-root',
      { skills: ['reviewer'], mcp: [] },
      async () => ({ configs: {}, missing: [] }),
      fs,
    );
    expect(result.skills).toEqual(['reviewer']);
    expect(fs.copyDir).toHaveBeenCalledTimes(1);
  });

  it('workflow scope wins a name clash with global', async () => {
    const fs = fakeFs(() => true);
    await materializeAssets(
      { workflow: '/root/wf', global: '/root/global' },
      '/private/skills-root',
      { skills: ['dup'], mcp: [] },
      async () => ({ configs: {}, missing: [] }),
      fs,
    );
    expect(fs.copyDir).toHaveBeenCalledWith(expect.stringContaining('/root/wf'), expect.anything());
  });

  it('a declared skill absent in BOTH roots lands in missing[] and the run proceeds (no refusal)', async () => {
    const fs = fakeFs(() => false);
    const result = await materializeAssets(
      { workflow: '/root/wf', global: '/root/global' },
      '/private/skills-root',
      { skills: ['ghost'], mcp: [] },
      async () => ({ configs: {}, missing: [] }),
      fs,
    );
    expect(result.missing).toEqual(['ghost']);
  });

  // issue #144: the SECOND parameter is now a PRIVATE directory, never the run workspace — copies
  // land at `<skillsRoot>/skills/<name>/`, not `<skillsRoot>/.claude/skills/<name>/` (the pre-#144
  // shape, which lived directly under the shared workspace).
  it('copies into <skillsRoot>/skills/<name>/, not a .claude/skills/ subtree', async () => {
    const fs = fakeFs(() => true);
    await materializeAssets(
      { workflow: '/root/wf', global: '/root/global' },
      '/private/skills-root',
      { skills: ['reviewer'], mcp: [] },
      async () => ({ configs: {}, missing: [] }),
      fs,
    );
    expect(fs.copyDir).toHaveBeenCalledWith(expect.anything(), '/private/skills-root/skills/reviewer');
  });

  // issue #144: a local-plugin manifest is written ONLY when at least one skill actually landed —
  // this is the shape `Options.plugins: [{type:'local', path: skillsRoot}]` needs to discover it
  // (verified against the real bundled CLI — see materializeAssets's own doc comment).
  it('writes a .claude-plugin/plugin.json manifest once a skill is materialized, naming RWE_SKILLS_PLUGIN_NAME', async () => {
    const fs = fakeFs(() => true);
    await materializeAssets(
      { workflow: '/root/wf', global: '/root/global' },
      '/private/skills-root',
      { skills: ['reviewer'], mcp: [] },
      async () => ({ configs: {}, missing: [] }),
      fs,
    );
    expect(fs.writeFile).toHaveBeenCalledWith('/private/skills-root/.claude-plugin/plugin.json', JSON.stringify({ name: RWE_SKILLS_PLUGIN_NAME }));
  });

  it('writes no manifest at all when no skill was declared', async () => {
    const fs = fakeFs(() => false);
    await materializeAssets({ workflow: '/root/wf', global: '/root/global' }, '/private/skills-root', { skills: [], mcp: [] }, async () => ({ configs: {}, missing: [] }), fs);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('writes no manifest at all when every declared skill is missing', async () => {
    const fs = fakeFs(() => false);
    await materializeAssets({ workflow: '/root/wf', global: '/root/global' }, '/private/skills-root', { skills: ['ghost'], mcp: [] }, async () => ({ configs: {}, missing: [] }), fs);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  // issue #128: materializeAssets used to REWRITE `<workspace>/.mcp.json` on every dispatch (never
  // merged) — an admin-pushed global server's resolved config (command/args/env, including a
  // substituted `${secret:NAME}` value) landed in a file any runner of the run could
  // `workspace_pull`. It no longer writes ANY file for mcp — resolved configs travel only through
  // the return value (`mcp: Object.keys(configs)`), for the caller to thread into
  // `options.mcpServers` directly.
  it('writes no file at all for mcp — declared.mcp empty', async () => {
    const fs = fakeFs(() => false);
    const result = await materializeAssets({ workflow: '/root/wf', global: '/root/global' }, '/private/skills-root', { skills: [], mcp: [] }, async () => ({ configs: {}, missing: [] }), fs);
    expect(fs.copyDir).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(result).toEqual({ skills: [], mcp: [], missing: [] });
  });

  it('writes no file at all for mcp — declared.mcp resolves to a real server config', async () => {
    const fs = fakeFs(() => false);
    // `McpServerConfig` (mcp-probe.ts) is a loose superset; `env` is not in its TS type but
    // `resolveConfig`/`materializeAssets` pass it through at runtime regardless (same convention as
    // the production call site casts `resolved` to `McpServerConfig`).
    const config = { type: 'stdio', command: 'npx', args: ['-y', 'x'], env: { TOKEN: 'resolved-secret-value' } } as unknown as McpServerConfig;
    const result = await materializeAssets(
      { workflow: '/root/wf', global: '/root/global' },
      '/private/skills-root',
      { skills: [], mcp: ['srv'] },
      async () => ({ configs: { srv: config }, missing: [] }),
      fs,
    );
    // The resolved config (including the substituted secret) comes back to the caller — never
    // written anywhere by this function.
    expect(result).toEqual({ skills: [], mcp: ['srv'], missing: [] });
    expect(fs.copyDir).not.toHaveBeenCalled();
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});
