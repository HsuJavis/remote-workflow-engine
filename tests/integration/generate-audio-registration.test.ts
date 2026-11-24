// #169: the registration-time model-type gate for generateAudio() and for audio-output models
// declared under agent(). Lyria (OpenRouter output ["audio","text"], catalogued modelType 'chat')
// used to register as an agent() model and "succeed" with text `<instrumental>` and no file.
//
// Mock policy (integration): real WorkflowCatalog (real SQLite under a tmp dir), real
// parseMetaParams/checkMermaid; the model catalog is the injected `catalogSnapshot` seam.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { FixedClock } from '../../src/clock.js';
import type { ModelCatalogSnapshot } from '../../src/providers.js';
import { synthesizeMermaid } from '../helpers/workflow-fixtures.js';

const clock = new FixedClock(new Date('2026-11-24T00:00:00.000Z'));
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const LYRIA = 'openrouter/google/lyria-3-clip-preview';
const ROWS = [
  { provider: 'openrouter', model: 'acme/chat-1', modelType: 'chat', modelTypeSource: 'openrouter-modalities', modalities: { in: ['text'], out: ['text'] } },
  { provider: 'openrouter', model: 'google/lyria-3-clip-preview', modelType: 'chat', modelTypeSource: 'openrouter-modalities', modalities: { in: ['text'], out: ['audio', 'text'] } },
  { provider: 'openrouter', model: 'google/gemini-2.5-flash-image', modelType: 'chat', modelTypeSource: 'openrouter-modalities', modalities: { in: ['text', 'image'], out: ['text', 'image'] } },
  { provider: 'openrouter', model: 'acme/mystery', modelType: 'unknown', modelTypeSource: 'unknown', modalities: { in: ['text'], out: ['text'] } },
] as const;
const SNAPSHOT = { entries: ROWS, source: 'live' } as unknown as ModelCatalogSnapshot;

function boot(snapshot: ModelCatalogSnapshot = SNAPSHOT): WorkflowCatalog {
  const dir = mkdtempSync(join(tmpdir(), 'rwe-audio-reg-'));
  dirs.push(dir);
  return new WorkflowCatalog(join(dir, 'catalog'), clock, { catalogSnapshot: async () => snapshot });
}

const AGENT_SPEC = (model: string) =>
  `{ model: { type: 'string', default: '${model}' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }`;
const PRIM_SPEC = (model: string) =>
  `{ model: { type: 'string', default: '${model}' }, timeoutMs: { type: 'number', default: 120000 }, retries: { type: 'number', default: 1 } }`;

const agentScript = (model: string) => `export const meta = { phases: [{ title: 'Main' }], params: { agents: { song: ${AGENT_SPEC(model)} } } };
phase('Main');
return await agent('song', { prompt: 'write a song' });`;
const audioScript = (model: string) => `export const meta = { phases: [{ title: 'Main' }], params: { audio: { song: ${PRIM_SPEC(model)} } } };
phase('Main');
return await generateAudio('song', { prompt: 'a calm piano loop' });`;

async function register(catalog: WorkflowCatalog, name: string, script: string) {
  return catalog.register({ name, script, mermaid: synthesizeMermaid(script), principal: null });
}
async function errOf(p: Promise<unknown>): Promise<{ code?: string; message?: string; detail?: Record<string, unknown> } | undefined> {
  try { await p; return undefined; } catch (e) { return e as { code?: string; message?: string }; }
}

describe('#169: registration gate — audio-output models', () => {
  it('Lyria under agents is refused MODEL_TYPE_MISMATCH, and the message points at generateAudio()', async () => {
    const err = await errOf(register(boot(), 'aud-agent-lyria', agentScript(LYRIA)));
    expect(err?.code).toBe('MODEL_TYPE_MISMATCH');
    expect(err?.message).toContain('song');
    expect(err?.message).toContain('lyria-3-clip-preview');
    expect(err?.message).toContain('generateAudio()');
    expect(err?.detail).toMatchObject({ required: 'text-output', actual: 'chat' });
  });

  it('Lyria as an agent model ENUM member (text default) is refused too', async () => {
    const script = `export const meta = { phases: [{ title: 'Main' }], params: { agents: { song: { model: { type: 'enum', enum: ['openrouter/acme/chat-1', '${LYRIA}'], default: 'openrouter/acme/chat-1' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } } };
phase('Main');
return await agent('song', { prompt: 'write a song' });`;
    const err = await errOf(register(boot(), 'aud-agent-enum', script));
    expect(err?.code).toBe('MODEL_TYPE_MISMATCH');
    expect(err?.detail).toMatchObject({ required: 'text-output', model: LYRIA });
  });

  it('an image+text chat model under agents still registers (perturbation guard)', async () => {
    expect(await errOf(register(boot(), 'aud-agent-gemini', agentScript('openrouter/google/gemini-2.5-flash-image')))).toBeUndefined();
  });

  it('Lyria under audio registers via generateAudio(), and the stored version stays runnable', async () => {
    const catalog = boot();
    const { version } = await register(catalog, 'aud-ok', audioScript(LYRIA));
    expect(await catalog.validateStoredVersion('aud-ok', version)).toEqual({ ok: true });
  });

  it('a text-only chat model under audio is refused MODEL_TYPE_MISMATCH required audio-output', async () => {
    const err = await errOf(register(boot(), 'aud-text', audioScript('openrouter/acme/chat-1')));
    expect(err?.code).toBe('MODEL_TYPE_MISMATCH');
    expect(err?.detail).toMatchObject({ required: 'audio-output' });
  });

  it('an unknown-typed model under audio registers with MODEL_TYPE_UNVERIFIED', async () => {
    const script = audioScript('openrouter/acme/mystery');
    const v = await boot().validateRegistration({ name: 'aud-unverified', script, mermaid: synthesizeMermaid(script) });
    expect((v.warnings ?? []).map((w) => (w as { code: string }).code)).toContain('MODEL_TYPE_UNVERIFIED');
  });

  it('catalog unavailable -> accepted (never "we could not check" -> refuse)', async () => {
    const catalog = boot({ entries: [], source: 'static' } as unknown as ModelCatalogSnapshot);
    expect(await errOf(register(catalog, 'aud-unavail', audioScript(LYRIA)))).toBeUndefined();
  });

  it('declared<=>used: generateAudio() with no params.audio block is refused AUDIO_UNDECLARED', async () => {
    const script = `export const meta = { phases: [{ title: 'Main' }] };\nphase('Main');\nreturn await generateAudio('song', { prompt: 'p' });`;
    expect((await errOf(register(boot(), 'aud-undeclared', script)))?.code).toBe('AUDIO_UNDECLARED');
  });

  it('a tunable inside the generateAudio() options is refused at registration (SCAN_VIOLATION PARAM_IN_SCRIPT)', async () => {
    const script = audioScript(LYRIA).replace("{ prompt: 'a calm piano loop' }", "{ prompt: 'p', retries: 2 }");
    const err = await errOf(register(boot(), 'aud-tunable', script));
    expect(err?.code).toBe('SCAN_VIOLATION');
    expect(err?.message).toMatch(/PARAM_IN_SCRIPT/);
  });
});
