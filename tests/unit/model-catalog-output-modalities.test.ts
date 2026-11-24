// #169: OpenRouter's current `output_modalities` vocabulary — `speech`, `transcription`, `rerank`,
// `video` — must map to a real modelType instead of falling through to the id heuristic /
// 'unknown'; an audio-and-text row (Lyria) stays a chat row whose `modalities.out` says 'audio'.
import { describe, it, expect } from 'vitest';
import { buildCatalog, type ModelEntry } from '../../src/models/model-catalog.js';

function row(id: string, out: string[]): Record<string, unknown> {
  return {
    id,
    name: id,
    context_length: 8192,
    architecture: { input_modalities: ['text'], output_modalities: out },
    pricing: { prompt: '0.000001', completion: '0.000002' },
    top_provider: { max_completion_tokens: 1024 },
  };
}

async function entriesFor(rows: Record<string, unknown>[]): Promise<ModelEntry[]> {
  const fakeFetch = (async () => new Response(JSON.stringify({ data: rows }), { status: 200 })) as unknown as typeof fetch;
  return buildCatalog({
    includeStatic: false,
    openrouterFetch: fakeFetch,
    ollamaFetch: (async () => { throw new Error('no ollama here'); }) as unknown as typeof fetch,
  });
}

describe('OpenRouter output_modalities → modelType (#169)', () => {
  it.each([
    ['vendor-a/voice-one', ['speech'], 'tts'],
    ['vendor-b/listen-one', ['transcription'], 'stt'],
    ['vendor-c/order-one', ['rerank'], 'rerank'],
    ['vendor-d/motion-one', ['video'], 'video-gen'],
  ])('%s with output %j is modelType %s from openrouter-modalities', async (id, out, type) => {
    const [e] = await entriesFor([row(id, out)]);
    expect(e?.modelType as string).toBe(type);
    expect(e?.modelTypeSource).toBe('openrouter-modalities');
  });

  it('an audio+text row (Lyria) stays chat and says audio in modalities.out', async () => {
    const [e] = await entriesFor([row('google/lyria-3-clip-preview', ['text', 'audio'])]);
    expect(e?.modelType).toBe('chat');
    expect(e?.modalities?.out).toContain('audio');
  });
});
