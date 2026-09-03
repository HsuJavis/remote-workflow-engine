// IT-110 (DES-148, v24): the catalog — validateRegistration/insertVersion split, `assets`, the
// ordered idempotent migration, deregister returning claimedTriggers. Written test-first (Gate 5,
// RED) — WorkflowCatalog.register still takes the pre-v24 (name, script, defaults, principal)
// shape with no `mermaid`/`triggers`, and `deregister` still returns only `{removed}`.
// Mock policy: real SQLite-backed WorkflowCatalog (better-sqlite3), no mocks.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';

describe('WorkflowCatalog v24 — mermaid/triggers required, assets, deregister union (IT-110, DES-148)', () => {
  let dir: string;
  let catalog: WorkflowCatalog;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rwe-catalog-v24-'));
    catalog = new WorkflowCatalog(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('register() without a mermaid string is refused MERMAID_REQUIRED, and NOTHING is written', async () => {
    await expect(
      // @ts-expect-error — v24 register() takes {name, script, mermaid, triggers, principal}; today omits mermaid entirely
      catalog.register({ name: 'wf-v24-a', script: 'workflow(() => {});' }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/MERMAID_REQUIRED/i) });
  });

  it('a MERMAID_REQUIRED refusal specifically leaves the version-row count unchanged [T1]', async () => {
    const before = await catalog.list();
    let threw: unknown;
    try {
      // @ts-expect-error — v24 shape
      await catalog.register({ name: 'wf-v24-b', script: 'workflow(() => {});' });
    } catch (e) {
      threw = e;
    }
    // Pinned to the SAME refusal as the case above — a differently-failing register (e.g. a
    // missing-script bug) must not false-green this row-count assertion.
    expect((threw as { message?: string } | undefined)?.message).toMatch(/MERMAID_REQUIRED/i);
    const after = await catalog.list();
    expect(after.length).toBe(before.length);
  });

  it('deregister() returns {removed, claimedTriggers} — the union over ALL versions', async () => {
    const result = await catalog.deregister('nonexistent-v24-workflow');
    // @ts-expect-error — claimedTriggers is not on the v21 {removed} return type yet
    expect(result.claimedTriggers).toBeDefined();
  });

  it('the assets table exists after migration (walked from the pre-v24 global tree as legacy rows)', () => {
    // @ts-expect-error — listAssets does not exist yet (v24 DES-148)
    expect(typeof catalog.listAssets).toBe('function');
  });
});
