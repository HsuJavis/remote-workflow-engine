// pi harness v1 (spec "Shared MCP resolution"): direct unit coverage of the extracted
// src/gateway/mcp-config-resolver.ts — the SAME function both ClaudeAgentSdkGatewayClient and
// PiGatewayClient call, so ${secret:NAME}/${run:dir}/${run:id} substitution can never diverge
// between the two gateways. The sdk gateway's own existing suites (mcp-run-state-dispatch.test.ts,
// val-021-secret-store.test.ts, nested-asset-skill-mcp-scope.test.ts) already cover this
// end-to-end through invoke(); this file covers the extracted function directly and in isolation.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveMcpConfigs } from '../../src/gateway/mcp-config-resolver.js';

let root: string | undefined;
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = undefined; });

describe('resolveMcpConfigs (extracted, shared by both gateways)', () => {
  it('no resolveMcp dep -> empty configs, every name reported missing', async () => {
    const r = await resolveMcpConfigs({}, 'wf', ['a', 'b'], 'run-1', '/tmp/ws');
    expect(r).toEqual({ configs: {}, missing: ['a', 'b'] });
  });

  it('empty names -> empty configs, nothing missing, resolveMcp never called', async () => {
    let called = false;
    const r = await resolveMcpConfigs({ resolveMcp: async () => { called = true; return { configs: {}, missing: [] }; } }, 'wf', [], 'run-1', '/tmp/ws');
    expect(r).toEqual({ configs: {}, missing: [] });
    expect(called).toBe(false);
  });

  it('substitutes ${secret:NAME} via the injected secretSource', async () => {
    const r = await resolveMcpConfigs(
      {
        resolveMcp: async () => ({ configs: { srv: { command: 'x', env: { TOKEN: '${secret:API_KEY}' } } as never }, missing: [] }),
        secretSource: { resolve: (name: string) => (name === 'API_KEY' ? 'sk-real-value' : undefined), names: () => ['API_KEY'] },
      },
      'wf',
      ['srv'],
      'run-1',
      '/tmp/ws',
    );
    expect((r.configs['srv'] as unknown as { env: { TOKEN: string } }).env.TOKEN).toBe('sk-real-value');
  });

  it('resolves ${run:dir}/${run:id} against a sibling mcp-state dir, created only on use', async () => {
    root = mkdtempSync(join(tmpdir(), 'rwe-mcp-config-resolver-'));
    const workspace = join(root, 'workflows', 'wf', 'runs', 'run-42');
    const r = await resolveMcpConfigs(
      { resolveMcp: async () => ({ configs: { srv: { command: 'x', args: ['${run:dir}', '${run:id}'] } as never }, missing: [] }) },
      'wf',
      ['srv'],
      'run-42',
      workspace,
    );
    const args = (r.configs['srv'] as unknown as { args: string[] }).args;
    expect(args[1]).toBe('run-42');
    expect(existsSync(args[0]!)).toBe(true);
    expect(statSync(args[0]!).isDirectory()).toBe(true);
    // Sibling of the run workspace, not inside it (issue #126 B / #128 confidentiality).
    expect(args[0]!.startsWith(workspace)).toBe(false);
  });

  it('an unresolved secret handle throws a named, coded error (never a silent literal passthrough)', async () => {
    await expect(
      resolveMcpConfigs(
        {
          resolveMcp: async () => ({ configs: { srv: { command: 'x', env: { TOKEN: '${secret:MISSING}' } } as never }, missing: [] }),
          secretSource: { resolve: () => undefined, names: () => [] },
        },
        'wf',
        ['srv'],
        'run-1',
        '/tmp/ws',
      ),
    ).rejects.toThrow(/SECRET_MISSING/);
  });
});
