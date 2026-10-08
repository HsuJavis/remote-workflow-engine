// UT-330 (DES-263, ARCH-182, TASK-258, REQ-218) — RunManager.start()'s confinement admission check.
//
// [更正 2026-09-26, issue #93 item 2] This file used to pin admissionRefusal() firing as the FIRST
// statement in start() — ahead of RUN_ADMISSION_LIMIT and INLINE_SCRIPT_CLOSED. That ordering was
// itself the defect issue #93 item 2 closed: call-tool.ts's own door mirrored the SAME "confinement
// first" precedence one layer up, so a remote+unconfined caller whose workflow did not exist, or
// whose args were malformed, was told CONFINEMENT_UNAVAILABLE instead of WORKFLOW_NOT_FOUND/
// VERSION_NOT_FOUND/INVALID_ARGUMENT — a permanent, migration-shaped refusal that told it nothing
// about its OWN mistake. The confinement check is now DEFERRED: both admission sources
// (`spec.origin`, the trigger's own provenance; `registered.registeredRemote`, the resolved
// version's) still measure at the same two points, but the THROW is deferred to the LAST pure
// check, immediately before the first durable write (`createRun`). `INLINE_SCRIPT_CLOSED` is kept
// as the cheap ordering witness this file always used — it needs no catalog/gateway/sandbox setup,
// and now proves the OPPOSITE fact: it fires BEFORE the confinement refusal, not after.
// The full "an otherwise-ADMISSIBLE remote+unconfined run_start still ends up refused
// CONFINEMENT_UNAVAILABLE" property is proved end-to-end (real catalog, real callTool) by
// `tests/integration/registered-remote-admission.test.ts` and
// `tests/integration/confinement-precedence.test.ts` (issue #93 item 2's own new coverage for the
// WORKFLOW_NOT_FOUND/INVALID_ARGUMENT/CONFINEMENT_UNAVAILABLE precedence ladder).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { RunManager } from '../../src/run-manager.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { synthesizeMermaid } from '../helpers/workflow-fixtures.js';

describe('UT-330 RunManager.start(): the confinement refusal is DEFERRED past INLINE_SCRIPT_CLOSED (issue #93 item 2)', () => {
  it('[LOAD-BEARING] remote + unconfined + an inline spec.script => INLINE_SCRIPT_CLOSED, never CONFINEMENT_UNAVAILABLE — a more specific refusal always wins', async () => {
    const rm = new RunManager({ confinementPosture: 'unconfined' });
    await expect(rm.start({ script: 'noop', origin: 'remote' })).rejects.toMatchObject({ code: 'INLINE_SCRIPT_CLOSED' });
  });

  it('local + unconfined => the admission gate does NOT fire at all; INLINE_SCRIPT_CLOSED (the owner\'s accepted local-unconfined cost, stated as code)', async () => {
    const rm = new RunManager({ confinementPosture: 'unconfined' });
    await expect(rm.start({ script: 'noop', origin: 'local' })).rejects.toMatchObject({ code: 'INLINE_SCRIPT_CLOSED' });
  });

  it('remote + confined => the admission gate does NOT fire (sandbox measured working); reaches INLINE_SCRIPT_CLOSED next', async () => {
    const rm = new RunManager({ confinementPosture: 'confined' });
    await expect(rm.start({ script: 'noop', origin: 'remote' })).rejects.toMatchObject({ code: 'INLINE_SCRIPT_CLOSED' });
  });

  it('confinementPosture omitted entirely (every pre-existing RunManager test call site) => never gated regardless of origin', async () => {
    const rm = new RunManager({});
    await expect(rm.start({ script: 'noop', origin: 'remote' })).rejects.toMatchObject({ code: 'INLINE_SCRIPT_CLOSED' });
  });
});

// issue #93 item 2: RUN_ADMISSION_LIMIT is a pure capacity READ (no durable write), and the
// deferred confinement throw now sits AFTER it (it used to sit ahead, by deliberate P1 design —
// see run-manager.ts's own comment on this trade-off) — a remote+unconfined submission arriving
// while the engine is already at `maxConcurrentRuns` is answered the RETRYABLE RUN_ADMISSION_LIMIT,
// not the PERMANENT CONFINEMENT_UNAVAILABLE. This is the accepted cost of moving
// existence/argument precedence ahead of confinement; needs one run occupying the single slot
// (`maxConcurrentRuns` must be >= 1) so a second submission actually observes the cap.
describe('UT-330b RUN_ADMISSION_LIMIT precedes the deferred confinement refusal when the cap is saturated (issue #93 item 2)', () => {
  it('[LOAD-BEARING] a live run occupies the one slot; the next remote+unconfined submission is refused RUN_ADMISSION_LIMIT, not CONFINEMENT_UNAVAILABLE', async () => {
    const rm = new RunManager({ confinementPosture: 'unconfined', maxConcurrentRuns: 1 });
    // Occupies the single slot: a LOCAL, no-name/no-script ad-hoc submission reaches
    // `_store.createRun` (the in-memory default store) and stays 'running'/'queued' (no agent()
    // calls to await), never reaching a terminal state within this test.
    await rm.start({ origin: 'local' });
    await expect(rm.start({ origin: 'remote' })).rejects.toMatchObject({ code: 'RUN_ADMISSION_LIMIT' });
  });
});

// #157 NEW (2026-10-07 re-verification of #154): a registered version that STILL VALIDATES at
// registration time can later fail `catalog.validateCurrent()` (workflow-catalog.ts:1252) once a
// stricter static rule ships — `workflow_describe` already surfaces this as `runnable:false`/
// `validation.ok:false` (mcp-facade.ts:706), but `RunManager.start()`'s own admission sequence never
// called `validateCurrent` at all, so the same version was still ACCEPTED by run_start and ran
// (observed ending ABORTED with no error code). No real engine needed to reproduce: a v22+ row
// whose STORED script is later overwritten (simulating "a rule added after registration") is
// indistinguishable, from run_start's point of view, from one that always looked like that — the
// admission check reads the stored script fresh on every start() call either way.
describe('UT-NOT_RUNNABLE RunManager.start() refuses a version that fails validateCurrent (#157, #154 cross-ref)', () => {
  const dirs: string[] = [];
  function tempDir(): string {
    const d = mkdtempSync(join(tmpdir(), 'rwe-ut157-'));
    dirs.push(d);
    return d;
  }
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  const VALID_SCRIPT =
    "export const meta = { phases: [{ title: 'Work' }], params: { agents: { a: { " +
    "model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } } };\n" +
    "phase('Work');\n" +
    "return await agent('a', { prompt: 'x' });";
  // Fails `validateScriptEntry` today (#154 B1a: a never-called top-level function wrapper) —
  // stands in for "a rule added after this version was registered".
  const NOW_INVALID_SCRIPT =
    "export const meta = { phases: [{ title: 'Work' }], params: { agents: { a: { " +
    "model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, effort: { type: 'enum', enum: ['low'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } } };\n" +
    "async function main(){ phase('Work'); return await agent('a', { prompt: 'x' }); }";

  it('[LOAD-BEARING] a version whose stored script now fails validateCurrent is refused NOT_RUNNABLE at run_start, not admitted', async () => {
    const workRoot = tempDir();
    const catalog = new WorkflowCatalog(workRoot, undefined as never);
    const name = 'edge-157-stale';
    const { version } = await catalog.register({ name, script: VALID_SCRIPT, mermaid: synthesizeMermaid(VALID_SCRIPT) });
    await catalog.publish(name, version, 'release', null);

    // Pre-condition: workflow_describe's own validateCurrent call already reports this as stale —
    // proves the fixture matches #154/#157's actual observed shape before asserting the admission gate.
    const check = catalog.validateCurrent(NOW_INVALID_SCRIPT);
    expect(check.ok).toBe(false);

    // Plant the now-invalid script directly (same raw-SQL technique as
    // workflow-describe-facade.test.ts) — no registration path can produce this row any more.
    const db = new Database(join(workRoot, 'catalog.db'));
    db.prepare('UPDATE workflow_versions SET script = ? WHERE name = ? AND version = ?').run(NOW_INVALID_SCRIPT, name, version);
    db.close();

    const rm = new RunManager({ catalog });
    await expect(rm.start({ name, origin: 'local' })).rejects.toMatchObject({ code: 'NOT_RUNNABLE' });
  });
});
