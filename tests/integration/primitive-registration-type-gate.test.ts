// IT-316 (DES-270/271 v40 Gate 6 delta, ARCH-189, ADR-095 + OD-1, ruling R-11, TASK-268): the
// registration-time model-type gate is WIRED into `WorkflowCatalog.validateRegistration` for all
// three label kinds — `agents` (refuse a KNOWN non-chat type), `decisions` (strictly `decision`),
// `images` (OD-1: any row whose catalog OUTPUT modalities include `image`, whatever its modelType)
// — at NEW registration only. An already-stored version is never re-judged: admission
// (`RunManager.start`) and `validateStoredVersion` (workflow_describe's runnable check) stay silent.
//
// Mock policy (integration): real WorkflowCatalog (real SQLite under a tmp dir), real
// `parseMetaParams`/`checkMermaid`; the model catalog is an injected `catalogSnapshot` (the
// documented seam) — the OpenRouter listing is the one third party this tier cannot run.
//
// Red reason: `checkPrimitiveModelType` (providers.ts) has no caller in `src/` — registration of an
// embedding model under `agents`/`images`, or a chat model under `decisions`, succeeds today, and no
// `MODEL_TYPE_UNVERIFIED` warning is ever produced. The OD-1 gemini case and the stored-version
// cases are GREEN today on purpose (characterization guards): they pin what the wiring must NOT
// break — a naive strict `image-gen` wiring would turn the gemini case red, and wiring the gate into
// admission or `validateStoredVersion` would turn the stored-version cases red.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { RunManager } from '../../src/run-manager.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import { ModelBook } from '../../src/models/model-book.js';
import type { ModelCatalogSnapshot } from '../../src/providers.js';
import type { GatewayClient } from '../../src/gateway/client.js';
import { synthesizeMermaid } from '../helpers/workflow-fixtures.js';

const clock = new FixedClock(new Date('2026-10-16T00:00:00.000Z'));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

// One catalog row per type the gate distinguishes. `modalities.out` rides on the snapshot entry
// (OD-1 needs it — DES-270 Gate 6 delta); `modelType`/`modelTypeSource` already do.
const ROWS = [
  { provider: 'openrouter', model: 'acme/chat-1', modelType: 'chat', modelTypeSource: 'openrouter-modalities', modalities: { in: ['text'], out: ['text'] } },
  { provider: 'openrouter', model: 'acme/embed-1', modelType: 'embedding', modelTypeSource: 'openrouter-modalities', modalities: { in: ['text'], out: ['embeddings'] } },
  { provider: 'openrouter', model: 'typesafe/jev-1.13', modelType: 'decision', modelTypeSource: 'openrouter-modalities', modalities: { in: ['text'], out: ['decisions'] } },
  { provider: 'openrouter', model: 'google/gemini-2.5-flash-image', modelType: 'chat', modelTypeSource: 'openrouter-modalities', modalities: { in: ['text', 'image'], out: ['text', 'image'] } },
  { provider: 'openrouter', model: 'acme/mystery', modelType: 'unknown', modelTypeSource: 'unknown', modalities: { in: ['text'], out: ['text'] } },
] as const;

const SNAPSHOT = { entries: ROWS, source: 'live' } as unknown as ModelCatalogSnapshot;

function boot(): { catalog: WorkflowCatalog; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'rwe-it316-'));
  dirs.push(dir);
  return { catalog: new WorkflowCatalog(join(dir, 'catalog'), clock, { catalogSnapshot: async () => SNAPSHOT }), dir };
}

const AGENT_SPEC = (model: string) =>
  `{ model: { type: 'string', default: '${model}' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }`;
const PRIM_SPEC = (model: string) =>
  `{ model: { type: 'string', default: '${model}' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 0 } }`;

function agentScript(model: string): string {
  return `export const meta = { phases: [{ title: 'Main' }], params: { agents: { x: ${AGENT_SPEC(model)} } } };
phase('Main');
return await agent('x', { prompt: 'hi' });`;
}
function decideScript(model: string): string {
  return `export const meta = { phases: [{ title: 'Main' }], params: { decisions: { gate: ${PRIM_SPEC(model)} } } };
phase('Main');
return await decide('gate', { state: {}, questions: { ok: { type: 'bool', instructions: 'i', criteria: { true: 't', false: 'f' } } } });`;
}
function imageScript(model: string): string {
  return `export const meta = { phases: [{ title: 'Main' }], params: { images: { hero: ${PRIM_SPEC(model)} } } };
phase('Main');
return await generateImage('hero', { prompt: 'a red dog' });`;
}

async function register(catalog: WorkflowCatalog, name: string, script: string) {
  return catalog.register({ name, script, mermaid: synthesizeMermaid(script), principal: null });
}

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try { await p; return undefined; } catch (e) { return (e as { code?: string }).code; }
}

describe('IT-316: registration-time model-type gate, wired for agents/decisions/images (R-11, OD-1)', () => {
  it('positive control: a chat model under agents registers with no MODEL_TYPE_* warning', async () => {
    const { catalog } = boot();
    const script = agentScript('openrouter/acme/chat-1');
    const v = await catalog.validateRegistration({ name: 'it316-ok', script, mermaid: synthesizeMermaid(script) });
    expect((v.warnings ?? []).map((w) => (w as { code: string }).code)).not.toContain('MODEL_TYPE_UNVERIFIED');
    await expect(register(catalog, 'it316-ok', script)).resolves.toHaveProperty('version');
  });

  it('agents: an embedding model (a KNOWN non-chat type) is refused MODEL_TYPE_MISMATCH, naming the label and model', async () => {
    const { catalog } = boot();
    let err: { code?: string; message?: string } | undefined;
    try { await register(catalog, 'it316-agent-embed', agentScript('openrouter/acme/embed-1')); } catch (e) { err = e as typeof err; }
    expect(err?.code).toBe('MODEL_TYPE_MISMATCH');
    expect(err?.message).toContain('x');
    expect(err?.message).toContain('acme/embed-1');
  });

  it('decisions: a chat model is refused MODEL_TYPE_MISMATCH (decisions stay strictly `decision`)', async () => {
    const { catalog } = boot();
    expect(await codeOf(register(catalog, 'it316-decide-chat', decideScript('openrouter/acme/chat-1')))).toBe('MODEL_TYPE_MISMATCH');
  });

  it('decisions: a decision model registers (perturbation guard for the case above)', async () => {
    const { catalog } = boot();
    expect(await codeOf(register(catalog, 'it316-decide-ok', decideScript('openrouter/typesafe/jev-1.13')))).toBeUndefined();
  });

  it('images: an embedding row (output has no `image`) is refused MODEL_TYPE_MISMATCH (OD-1)', async () => {
    const { catalog } = boot();
    expect(await codeOf(register(catalog, 'it316-image-embed', imageScript('openrouter/acme/embed-1')))).toBe('MODEL_TYPE_MISMATCH');
  });

  it('images (OD-1 characterization guard): a gemini-style chat row whose OUTPUT includes image registers', async () => {
    const { catalog } = boot();
    expect(await codeOf(register(catalog, 'it316-image-gemini', imageScript('openrouter/google/gemini-2.5-flash-image')))).toBeUndefined();
  });

  it('agents: an `unknown`-typed model registers but the response carries MODEL_TYPE_UNVERIFIED naming the label', async () => {
    const { catalog } = boot();
    const script = agentScript('openrouter/acme/mystery');
    const v = await catalog.validateRegistration({ name: 'it316-unverified', script, mermaid: synthesizeMermaid(script) });
    const w = (v.warnings ?? []).find((x) => (x as { code: string }).code === 'MODEL_TYPE_UNVERIFIED') as { label?: string } | undefined;
    expect(w).toBeDefined();
    expect(w?.label).toBe('x');
  });

  it('stored-version guard (characterization): a version stored BEFORE the gate (embedding under agents) still admits at run_start and stays runnable', async () => {
    const { catalog, dir } = boot();
    const script = agentScript('openrouter/acme/embed-1');
    // `insertVersion` performs no static validation — the only way to hold a row the new gate would
    // refuse, i.e. exactly a pre-v40 registration.
    const params = { agents: { x: { model: { type: 'string', default: 'openrouter/acme/embed-1' }, effort: { type: 'enum', enum: ['low', 'medium', 'high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } }, args: {} };
    const { version } = await catalog.insertVersion({ name: 'it316-stored', script, mermaid: synthesizeMermaid(script), params: params as never, principal: null });
    await catalog.publish('it316-stored', version, 'release', null);

    // validateStoredVersion is workflow_describe's runnable check — the gate must not live there.
    expect(await catalog.validateStoredVersion('it316-stored', version)).toEqual({ ok: true });

    // Admission: the engine's ModelBook lists the row as an embedding model; start() must not refuse.
    const gateway: GatewayClient = { invoke: async () => ({ ok: true, provider: 'openrouter', model: 'acme/embed-1', tokens: { input: 1, output: 1 }, content: 'ok' }) } as unknown as GatewayClient;
    const modelBook = new ModelBook(async () => ROWS as never, { clock });
    const mgr = new RunManager({ store: new InMemoryRunStore(clock), clock, catalog, workRoot: dir, gateway, modelBook } as never);
    const started = await mgr.start({ name: 'it316-stored', origin: 'local' } as never).then((id) => ({ id }), (e) => ({ code: (e as { code?: string }).code }));
    expect(started).toHaveProperty('id');
    // settle before afterEach removes workRoot under the live child
    const runId = (started as { id: string }).id;
    for (let i = 0; i < 400; i++) {
      const st = (await mgr.status(runId)).status;
      if (st === 'completed' || st === 'failed' || st === 'stopped') break;
      await new Promise((r) => setTimeout(r, 25));
    }
  }, 30000);
});
