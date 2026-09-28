// issue #103(a): a nested workflow() call is its OWN admission point (same as run_start) — a child
// workflow declaring an unprovisioned mcp/skill name is refused MCP_NOT_PROVISIONED/
// SKILL_NOT_PROVISIONED BEFORE any side effect, resolved against the CHILD's own name/contract
// (never the parent's), via the SAME resolver run_start's admission uses
// (RunManager.bindAssetSync/_refuseUnprovisionedAssets).
// Mock policy (integration tier, mirrors nested-workflow-n-level.test.ts): real RunManager + real
// on-disk WorkflowCatalog + real AssetSyncService (fake mcp probe — no network) + the echo
// AgentSpawner override (structural case, no real LLM dispatch needed).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { AssetSyncService } from '../../src/asset-sync.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import { FakeMcpProbe } from '../../src/mcp-probe.js';
import type { AgentSpawner } from '../../src/agent-executor.js';
import { DEFAULT_FIXTURE_MODEL, startScript } from '../helpers/workflow-fixtures.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));

function echoSpawner(): AgentSpawner {
  return { async run(req) { return { kind: 'text', value: req.prompt }; } };
}

async function pollUntilSettled(mgr: RunManager, runId: string) {
  let view = await mgr.status(runId);
  for (let i = 0; i < 300 && (view.status === 'running' || view.status === 'queued'); i++) {
    await new Promise((r) => setTimeout(r, 25));
    view = await mgr.status(runId);
  }
  return view;
}

// `mcp`/`skills` declared ONLY in `meta.params.agents.<label>` — see
// registration-mcp-provisioning-warning.test.ts's own note for why they must never also be an
// agent() call option.
function scriptDeclaring(label: string, mcp: string[], skills: string[]): string {
  return [
    `export const meta = { params: { agents: { ${JSON.stringify(label)}: {`,
    `  model: { type: 'string', default: ${JSON.stringify(DEFAULT_FIXTURE_MODEL)} },`,
    "  effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' },",
    "  timeoutMs: { type: 'number', default: 60000 },",
    `  mcp: ${JSON.stringify(mcp)}, skills: ${JSON.stringify(skills)},`,
    "} } } };",
    "phase('Work');",
    `return await agent(${JSON.stringify(label)}, {});`,
  ].join('\n');
}

let tmpDir: string;
let catalog: WorkflowCatalog;
let mgr: RunManager;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'rwe-nested-provisioning-'));
  catalog = new WorkflowCatalog(join(tmpDir, 'catalog'), CLOCK);
  const assetSync = new AssetSyncService({
    workRoot: join(tmpDir, 'assets'), globalRoot: join(tmpDir, 'global-assets'),
    selfBind: { host: '127.0.0.1', port: 1 }, clock: CLOCK,
    catalog: {
      putAsset: () => undefined, deleteAsset: () => ({ deleted: false }), listAssets: () => [],
    },
    probe: new FakeMcpProbe(true), egressAllowlist: [],
  });
  mgr = new RunManager({ store: new InMemoryRunStore(CLOCK), workRoot: join(tmpDir, 'runs'), spawner: echoSpawner(), catalog });
  mgr.bindAssetSync(assetSync);
});
afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

describe('a nested workflow() call refuses an unprovisioned mcp/skill name (issue #103a)', () => {
  it('MCP_NOT_PROVISIONED, before any side effect — the parent run fails with that code', async () => {
    await catalog.register({ name: 'child-mcp', script: scriptDeclaring('c', ['echo-mcp'], []), mermaid: 'graph LR\nsubgraph "Work"\nn0(["c"])\nend' });
    await catalog.publish('child-mcp', 'v1', 'release', null);
    const runId = await startScript(mgr, `try { await workflow('child-mcp', {}); return { ok: true }; } catch (e) { return { code: e && (e.code || e.name), message: e && e.message }; }`);
    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');
    const result = await mgr.result(runId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const value = result.value as { code?: string; message?: string };
    expect(value.code).toBe('MCP_NOT_PROVISIONED');
    expect(value.message).toContain('echo-mcp');
  });

  it('SKILL_NOT_PROVISIONED, before any side effect', async () => {
    await catalog.register({ name: 'child-skill', script: scriptDeclaring('c', [], ['reviewer']), mermaid: 'graph LR\nsubgraph "Work"\nn0(["c"])\nend' });
    await catalog.publish('child-skill', 'v1', 'release', null);
    const runId = await startScript(mgr, `try { await workflow('child-skill', {}); return { ok: true }; } catch (e) { return { code: e && (e.code || e.name), message: e && e.message }; }`);
    const view = await pollUntilSettled(mgr, runId);
    expect(view.status).toBe('completed');
    const result = await mgr.result(runId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    const value = result.value as { code?: string; message?: string };
    expect(value.code).toBe('SKILL_NOT_PROVISIONED');
    expect(value.message).toContain('reviewer');
  });
});
