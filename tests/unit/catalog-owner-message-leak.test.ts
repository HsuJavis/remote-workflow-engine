// Issue #90: NOT_WORKFLOW_OWNER refusals thrown directly by WorkflowCatalog must not disclose the
// resource owner's identity in the error message that reaches the refused (non-owner) caller —
// `validateRegistration` (pre-check, read-only), `insertVersion` (the in-transaction defence-in-
// depth copy of the same check), `deregister`, `deregisterVersion`, and `publish` each throw their
// own `NOT_WORKFLOW_OWNER` independently (workflow-catalog.ts, five call sites) — every one of them
// is exercised here directly, not just the shared `authorize()` gate (`tests/unit/authz.test.ts`
// covers that one separately).
//
// Mock policy (unit): a REAL WorkflowCatalog over a real temp-dir SQLite file — same convention as
// tests/unit/catalog-deregister-version.test.ts.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { FixedClock } from '../../src/clock.js';

const clock = new FixedClock(new Date('2026-09-26T00:00:00.000Z'));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

function catalog(): WorkflowCatalog {
  const dir = mkdtempSync(join(tmpdir(), 'rwe-issue90-catalog-'));
  dirs.push(dir);
  return new WorkflowCatalog(dir, clock);
}

const OWNER_EMAIL = 'owner-secret@example.com';
const MALLORY = { id: 'mallory@example.com', bypass: false, idSource: 'authenticated' as const };

async function refusalMessage(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error('expected a rejection, got none');
}

describe('issue #90: WorkflowCatalog NOT_WORKFLOW_OWNER refusals never disclose the owner', () => {
  it('validateRegistration (pre-check, read-only) refusal message does not contain the owner', async () => {
    const cat = catalog();
    await cat.register({ name: 'ut90-validate', script: 'return 1;', mermaid: 'graph LR', principal: OWNER_EMAIL });
    const msg = await refusalMessage(() =>
      cat.validateRegistration({ name: 'ut90-validate', script: 'return 2;', mermaid: 'graph LR', actor: MALLORY }),
    );
    expect(msg).toMatch(/^NOT_WORKFLOW_OWNER:/);
    expect(msg).not.toContain(OWNER_EMAIL);
  });

  it('insertVersion (in-transaction defence-in-depth copy) refusal message does not contain the owner', async () => {
    const cat = catalog();
    const { params } = await cat.validateRegistration({ name: 'ut90-insert', script: 'return 1;', mermaid: 'graph LR', principal: OWNER_EMAIL });
    await cat.insertVersion({ name: 'ut90-insert', script: 'return 1;', mermaid: 'graph LR', params, principal: OWNER_EMAIL });
    const msg = await refusalMessage(() =>
      cat.insertVersion({ name: 'ut90-insert', script: 'return 2;', mermaid: 'graph LR', params, actor: MALLORY }),
    );
    expect(msg).toMatch(/^NOT_WORKFLOW_OWNER:/);
    expect(msg).not.toContain(OWNER_EMAIL);
  });

  it('deregister refusal message does not contain the owner', async () => {
    const cat = catalog();
    await cat.register({ name: 'ut90-deregister', script: 'return 1;', mermaid: 'graph LR', principal: OWNER_EMAIL });
    const msg = await refusalMessage(() => cat.deregister('ut90-deregister', MALLORY));
    expect(msg).toMatch(/^NOT_WORKFLOW_OWNER:/);
    expect(msg).not.toContain(OWNER_EMAIL);
  });

  it('deregisterVersion refusal message does not contain the owner', async () => {
    const cat = catalog();
    await cat.register({ name: 'ut90-deregisterVersion', script: 'return 1;', mermaid: 'graph LR', principal: OWNER_EMAIL });
    const msg = await refusalMessage(() => cat.deregisterVersion('ut90-deregisterVersion', 'v1', MALLORY, null));
    expect(msg).toMatch(/^NOT_WORKFLOW_OWNER:/);
    expect(msg).not.toContain(OWNER_EMAIL);
  });

  it('publish refusal message does not contain the owner', async () => {
    const cat = catalog();
    await cat.register({ name: 'ut90-publish', script: 'return 1;', mermaid: 'graph LR', principal: OWNER_EMAIL });
    const msg = await refusalMessage(() => cat.publish('ut90-publish', 'v1', 'release', MALLORY));
    expect(msg).toMatch(/^NOT_WORKFLOW_OWNER:/);
    expect(msg).not.toContain(OWNER_EMAIL);
  });
});
