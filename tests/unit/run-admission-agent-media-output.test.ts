// #169: a version stored BEFORE the registration gate existed (or registered while the catalog was
// unavailable) can still declare an audio-output model for agent(). run_start's admission re-reads
// the live catalog and refuses it, instead of running and silently dropping the audio.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunManager } from '../../src/run-manager.js';
import { WorkflowCatalog } from '../../src/workflow-catalog.js';
import { InMemoryRunStore } from '../../src/run-store.js';
import { FixedClock } from '../../src/clock.js';
import { ModelBook } from '../../src/models/model-book.js';
import type { AgentSpawner } from '../../src/agent-executor.js';
import { registerPublished } from '../helpers/workflow-fixtures.js';

const CLOCK = new FixedClock(new Date('2024-01-01T00:00:00Z'));
const LYRIA = 'openrouter/google/lyria-3-clip-preview';
const TEXT = 'openrouter/vendor/text-model';

function spawner(calls: string[]): AgentSpawner {
  return { async run(req) { calls.push(req.prompt); return { kind: 'text', value: '<instrumental>' }; } };
}

function book(): ModelBook {
  return new ModelBook(
    async () => [
      { provider: 'openrouter', model: 'google/lyria-3-clip-preview', modelType: 'chat', modelTypeSource: 'openrouter-modalities', modalities: { in: ['text'], out: ['text', 'audio'] } },
      { provider: 'openrouter', model: 'vendor/text-model', modelType: 'chat', modelTypeSource: 'openrouter-modalities', modalities: { in: ['text'], out: ['text'] } },
    ] as never,
    { clock: CLOCK },
  );
}

describe('run admission refuses an agent() model whose output is audio/video (#169)', () => {
  let workRoot: string;
  beforeEach(() => { workRoot = mkdtempSync(join(tmpdir(), 'rwe-admit-media-')); });
  afterEach(() => { rmSync(workRoot, { recursive: true, force: true }); });

  it('a stored version whose agent default is Lyria is refused MODEL_TYPE_MISMATCH and never dispatches', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK); // no live snapshot: the registration gate cannot fire
    const calls: string[] = [];
    await registerPublished(catalog, 'old-lyria', `phase('p'); return await agent('a', { prompt: 'a song' });`, { model: LYRIA });
    const mgr = new RunManager({ store: new InMemoryRunStore(CLOCK), clock: CLOCK, catalog, spawner: spawner(calls), harnessProviders: ['openrouter', 'ollama'], modelBook: book() });
    await expect(mgr.start({ name: 'old-lyria', origin: 'local', principal: null })).rejects.toMatchObject({
      code: 'MODEL_TYPE_MISMATCH',
      message: expect.stringContaining('generateAudio()'),
    });
    expect(calls).toEqual([]);
  });

  it('a text-output agent model is still admitted (perturbation guard)', async () => {
    const catalog = new WorkflowCatalog(workRoot, CLOCK);
    await registerPublished(catalog, 'text-ok', `phase('p'); return await agent('a', { prompt: 'hi' });`, { model: TEXT });
    const mgr = new RunManager({ store: new InMemoryRunStore(CLOCK), clock: CLOCK, catalog, spawner: spawner([]), harnessProviders: ['openrouter', 'ollama'], modelBook: book() });
    await expect(mgr.start({ name: 'text-ok', origin: 'local', principal: null })).resolves.toEqual(expect.any(String));
  });
});
