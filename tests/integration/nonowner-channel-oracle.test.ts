// Issue #108 (low): a non-owner's `run_start`/`workflow_describe`/`workflow_source` ask for a
// non-release channel or an explicit version answered TWO different codes depending on whether
// that channel/version happened to be published — `CHANNEL_UNPUBLISHED` when the channel pointer
// was null, `VERSION_NOT_FOUND` (the existing #100/Q5 masking gate) once it was published. That
// distinction is itself an existence/publish-state oracle: a non-owner could learn "beta is
// pointed at something" from the code alone, without ever being allowed to run or read it.
//
// Root cause: `WorkflowCatalog.resolveDetail()` (via `resolveVersionRequest`) throws the REAL
// `CHANNEL_UNPUBLISHED`/`VERSION_NOT_FOUND` the moment resolution fails — which happens BEFORE the
// `canRunResolved` masking gate that `RunManager.start()`/`workflowDescribe`/`workflowSource` each
// ran AFTER a successful resolve. `WorkflowCatalog.resolveForActor()` folds the masking predicate to
// run FIRST (using only the owner row + channel pointers), so a would-be-masked request's real code
// never escapes at all. Release-channel-unpublished stays `CHANNEL_UNPUBLISHED` for a non-owner
// (release existence is public); every other refusal to a non-owner is `VERSION_NOT_FOUND`.
//
// Mock policy (integration, mirrors run-version-nonowner-admission.test.ts): real on-disk
// WorkflowCatalog + real RunManager + real McpFacade, hand-built Principal objects, no agent()/
// gateway needed.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { McpFacade } from '../../src/mcp-facade.js';
import { FixedClock } from '../../src/clock.js';
import type { Principal } from '../../src/authz.js';
import { registerPublished } from '../helpers/workflow-fixtures.js';

const CLOCK = new FixedClock(new Date('2026-10-02T00:00:00.000Z'));

const ALICE_ID = 'alice108@x.com';
const BOB: Principal = { kind: 'author', id: 'bob108@x.com' };
const ADMIN: Principal = { kind: 'admin', id: 'root108@x.com' };

let dir: string;
let catalog: WorkflowCatalog;
let runManager: RunManager;
let facade: McpFacade;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rwe-it108-'));
  catalog = new WorkflowCatalog(dir, CLOCK);
  runManager = new RunManager({ clock: CLOCK, workRoot: dir, catalog });
  facade = new McpFacade({ runManager });
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('issue #108: a non-owner\'s beta refusal is the SAME code+message whether beta is unpublished or published', () => {
  it('[LOAD-BEARING] run_start: beta UNPUBLISHED (no beta version at all) => VERSION_NOT_FOUND, never CHANNEL_UNPUBLISHED', async () => {
    const NAME = 'oracle108-unpub';
    await registerPublished(catalog, NAME, 'return "v1";', { principal: ALICE_ID, channel: 'release' });
    const r = await facade.runStart({ name: NAME, channel: 'beta' }, BOB);
    expect(r.error?.code).toBe('VERSION_NOT_FOUND');
    expect(r.error?.message).not.toContain(ALICE_ID);
  });

  it('run_start: beta PUBLISHED (pointed at a real version) => the SAME VERSION_NOT_FOUND code+message shape', async () => {
    const NAME = 'oracle108-pub';
    await registerPublished(catalog, NAME, 'return "v1";', { principal: ALICE_ID, channel: 'release' });
    await registerPublished(catalog, NAME, 'return "v2";', { principal: ALICE_ID, channel: 'beta' });
    const r = await facade.runStart({ name: NAME, channel: 'beta' }, BOB);
    expect(r.error?.code).toBe('VERSION_NOT_FOUND');
    expect(r.error?.message).toBe(`VERSION_NOT_FOUND: beta (workflow '${NAME}')`);
  });

  it('run_start: both states above produce the BYTE-IDENTICAL message (the oracle itself)', async () => {
    const UNPUB = 'oracle108-cmp-unpub';
    const PUB = 'oracle108-cmp-pub';
    await registerPublished(catalog, UNPUB, 'return "v1";', { principal: ALICE_ID, channel: 'release' });
    await registerPublished(catalog, PUB, 'return "v1";', { principal: ALICE_ID, channel: 'release' });
    await registerPublished(catalog, PUB, 'return "v2";', { principal: ALICE_ID, channel: 'beta' });
    const unpub = await facade.runStart({ name: UNPUB, channel: 'beta' }, BOB);
    const pub = await facade.runStart({ name: PUB, channel: 'beta' }, BOB);
    expect(unpub.error?.code).toBe(pub.error?.code);
    // messages differ only by the workflow name, never by published-vs-not
    expect(unpub.error?.message).toBe(`VERSION_NOT_FOUND: beta (workflow '${UNPUB}')`);
    expect(pub.error?.message).toBe(`VERSION_NOT_FOUND: beta (workflow '${PUB}')`);
  });

  it('workflow_describe: beta UNPUBLISHED vs PUBLISHED both answer VERSION_NOT_FOUND for a non-owner', async () => {
    const UNPUB = 'oracle108-describe-unpub';
    const PUB = 'oracle108-describe-pub';
    await registerPublished(catalog, UNPUB, 'return "v1";', { principal: ALICE_ID, channel: 'release' });
    await registerPublished(catalog, PUB, 'return "v1";', { principal: ALICE_ID, channel: 'release' });
    await registerPublished(catalog, PUB, 'return "v2";', { principal: ALICE_ID, channel: 'beta' });
    const unpub = await facade.workflowDescribe({ name: UNPUB, channel: 'beta' }, BOB) as { code?: string; error?: { code?: string; message?: string } };
    const pub = await facade.workflowDescribe({ name: PUB, channel: 'beta' }, BOB) as { code?: string; error?: { code?: string; message?: string } };
    expect(unpub.code).toBe('VERSION_NOT_FOUND');
    expect(pub.code).toBe('VERSION_NOT_FOUND');
    expect(unpub.error?.message).not.toContain(ALICE_ID);
    expect(pub.error?.message).not.toContain(ALICE_ID);
  });

  it('workflow_source: beta UNPUBLISHED vs PUBLISHED both answer VERSION_NOT_FOUND for a non-owner', async () => {
    const UNPUB = 'oracle108-source-unpub';
    const PUB = 'oracle108-source-pub';
    await registerPublished(catalog, UNPUB, 'return "v1";', { principal: ALICE_ID, channel: 'release' });
    const { version: pubV1 } = await registerPublished(catalog, PUB, 'return "v1";', { principal: ALICE_ID, channel: 'release' });
    const { version: pubV2 } = await registerPublished(catalog, PUB, 'return "v2";', { principal: ALICE_ID, channel: 'beta' });
    expect(pubV1).not.toBe(pubV2);
    // workflow_source has no `channel` selector — exercise the equivalent explicit-version oracle:
    // a non-release version id that does not exist (UNPUB has only v1/release) vs one that does
    // exist but is not the release pointer (PUB's beta version).
    const nonexistent = await facade.workflowSource({ name: UNPUB, version: 'v999' }, BOB) as { code?: string; error?: { code?: string } };
    const existingNonRelease = await facade.workflowSource({ name: PUB, version: pubV2 }, BOB) as { code?: string; error?: { code?: string } };
    expect(nonexistent.code).toBe('VERSION_NOT_FOUND');
    expect(existingNonRelease.code).toBe('VERSION_NOT_FOUND');
  });

  it('owner still gets the REAL CHANNEL_UNPUBLISHED for her own unpublished beta (masking never applies to the owner)', async () => {
    const NAME = 'oracle108-owner-unpub';
    const ALICE: Principal = { kind: 'author', id: ALICE_ID };
    await registerPublished(catalog, NAME, 'return "v1";', { principal: ALICE_ID, channel: 'release' });
    const r = await facade.runStart({ name: NAME, channel: 'beta' }, ALICE);
    expect(r.error?.code).toBe('CHANNEL_UNPUBLISHED');
  });

  it('admin still gets the REAL CHANNEL_UNPUBLISHED (bypass actor, masking never applies)', async () => {
    const NAME = 'oracle108-admin-unpub';
    await registerPublished(catalog, NAME, 'return "v1";', { principal: ALICE_ID, channel: 'release' });
    const r = await facade.runStart({ name: NAME, channel: 'beta' }, ADMIN);
    expect(r.error?.code).toBe('CHANNEL_UNPUBLISHED');
  });

  it('non-owner: release itself unpublished (no version published at all) => the REAL CHANNEL_UNPUBLISHED, not masked (release existence is public)', async () => {
    const NAME = 'oracle108-release-unpub';
    await catalog.register({ name: NAME, script: `export const meta = { phases: [] };\nreturn "x";`, mermaid: 'graph LR', principal: ALICE_ID });
    const bare = await facade.runStart({ name: NAME }, BOB);
    const explicit = await facade.runStart({ name: NAME, channel: 'release' }, BOB);
    expect(bare.error?.code).toBe('CHANNEL_UNPUBLISHED');
    expect(explicit.error?.code).toBe('CHANNEL_UNPUBLISHED');
  });

  it('non-owner: an explicit non-release version (exists) vs a nonexistent version both answer VERSION_NOT_FOUND', async () => {
    const NAME = 'oracle108-version-cmp';
    const { version: v1 } = await registerPublished(catalog, NAME, 'return "v1";', { principal: ALICE_ID, channel: 'release' });
    const { version: v2 } = await registerPublished(catalog, NAME, 'return "v2";', { principal: ALICE_ID, channel: 'beta' });
    expect(v1).not.toBe(v2);
    const existing = await facade.runStart({ name: NAME, version: v2 }, BOB);
    const nonexistent = await facade.runStart({ name: NAME, version: 'v999' }, BOB);
    expect(existing.error?.code).toBe('VERSION_NOT_FOUND');
    expect(nonexistent.error?.code).toBe('VERSION_NOT_FOUND');
    expect(existing.error?.message).toBe(`VERSION_NOT_FOUND: ${v2} (workflow '${NAME}')`);
  });
});
