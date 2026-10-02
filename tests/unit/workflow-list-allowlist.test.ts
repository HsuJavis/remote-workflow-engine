// Service accounts spec (owner decision 2026-10-03), §Authorization: "list tools (workflow_list,
// run_list) filter to the allowlist." run_list already scopes to the caller's OWN runs
// (runListScope/nsOf), which an allowlisted SA can only ever have started for an allowlisted
// workflow in the first place — nothing to add there. workflow_list has no such ownership scoping
// (it lists every registered workflow), so IT needs an explicit filter against
// `principal.workflows`.
//
// Red reason: `McpFacade.workflowList` ignores `principal.workflows` entirely — an allowlisted SA
// sees every workflow, not just its own.
import { describe, it, expect } from 'vitest';
import { McpFacade } from '../../src/mcp-facade.js';
import { FIXTURE_SCRIPT, FIXTURE_MERMAID } from '../../src/tool-specs.js';
import { AUTH_DISABLED } from '../helpers/workflow-fixtures.js';
import type { Principal } from '../../src/authz.js';

async function registerTwo(facade: McpFacade): Promise<void> {
  await facade.workflowRegister({ name: 'foo', script: FIXTURE_SCRIPT, mermaid: FIXTURE_MERMAID }, AUTH_DISABLED, false);
  await facade.workflowRegister({ name: 'bar', script: FIXTURE_SCRIPT, mermaid: FIXTURE_MERMAID }, AUTH_DISABLED, false);
}

describe('workflow_list filters to a service account\'s allowlist (service accounts spec §Authorization)', () => {
  it('an allowlisted principal sees only workflows named in Principal.workflows', async () => {
    const facade = new McpFacade({});
    await registerTwo(facade);
    const scoped: Principal = { kind: 'author', id: 'sa:ci-bot', workflows: ['foo'] };
    const env = await facade.workflowList({ onlyRunnable: false }, scoped);
    expect((env.result ?? []).map((w) => w.name)).toEqual(['foo']);
  });

  it('a principal with no workflows field sees everything (unrestricted)', async () => {
    const facade = new McpFacade({});
    await registerTwo(facade);
    const env = await facade.workflowList({ onlyRunnable: false }, AUTH_DISABLED);
    expect((env.result ?? []).map((w) => w.name).sort()).toEqual(['bar', 'foo']);
  });

  it('a principal with an empty workflows array sees everything (spec: empty = unrestricted)', async () => {
    const facade = new McpFacade({});
    await registerTwo(facade);
    const unrestricted: Principal = { kind: 'author', id: 'sa:ci-bot', workflows: [] };
    const env = await facade.workflowList({ onlyRunnable: false }, unrestricted);
    expect((env.result ?? []).map((w) => w.name).sort()).toEqual(['bar', 'foo']);
  });
});
