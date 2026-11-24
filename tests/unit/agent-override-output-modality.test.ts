// #169: an agent() label must not be pointed at an audio/video-output model at run time either —
// a run_start `overrides.agents.<label>.model` naming Lyria is refused like the registration gate
// refuses a declared default, instead of running and silently dropping the audio.
import { describe, it, expect } from 'vitest';
import { parseParamContract, validateUserOverrides } from '../../src/params/contract.js';
import type { AgentParamSpec } from '../../src/params/contract.js';

const catalog = {
  source: 'live' as const,
  entries: [
    { provider: 'openrouter', model: 'vendor/text-model', modelType: 'chat' as const, modelTypeSource: 'openrouter-modalities' as const, modalities: { out: ['text'] } },
    { provider: 'openrouter', model: 'vendor/image-chat', modelType: 'chat' as const, modelTypeSource: 'openrouter-modalities' as const, modalities: { out: ['image', 'text'] } },
    { provider: 'openrouter', model: 'google/lyria-3-clip-preview', modelType: 'chat' as const, modelTypeSource: 'openrouter-modalities' as const, modalities: { out: ['audio', 'text'] } },
    { provider: 'openrouter', model: 'google/gemini-omni-1.2-flash', modelType: 'chat' as const, modelTypeSource: 'openrouter-modalities' as const, modalities: { out: ['text', 'video'] } },
  ],
};

function contractWith(model: AgentParamSpec['model']) {
  const spec: AgentParamSpec = { model, effort: { type: 'enum', default: 'low' }, timeoutMs: { type: 'number', default: 10_000 } };
  const r = parseParamContract({ agents: { writer: spec } }, ['writer'], catalog);
  if (!r.ok) throw new Error(`contract refused: ${r.code} ${r.message}`);
  return r.value;
}

describe('agent model override vs output modalities (#169)', () => {
  it.each([
    ['openrouter/google/lyria-3-clip-preview', /includes audio.*generateAudio\(\)/],
    ['openrouter/google/gemini-omni-1.2-flash', /includes video, which agent\(\) cannot return$/],
  ])(
    'an unconstrained model override to %s is refused MODEL_TYPE_MISMATCH',
    (ref, message) => {
      const c = contractWith({ type: 'string', default: 'openrouter/vendor/text-model' });
      const r = validateUserOverrides(c, { agents: { writer: { model: ref } } }, catalog);
      expect(r).toMatchObject({ ok: false, code: 'MODEL_TYPE_MISMATCH' });
      if (!r.ok) expect(r.message).toMatch(message);
    },
  );

  it('an enum member override to an audio model is refused too', () => {
    const c = contractWith({ type: 'enum', enum: ['openrouter/vendor/text-model', 'openrouter/google/lyria-3-clip-preview'], default: 'openrouter/vendor/text-model' });
    const r = validateUserOverrides(c, { agents: { writer: { model: 'openrouter/google/lyria-3-clip-preview' } } }, catalog);
    expect(r).toMatchObject({ ok: false, code: 'MODEL_TYPE_MISMATCH' });
  });

  it.each(['openrouter/vendor/text-model', 'openrouter/vendor/image-chat'])('an override to %s is still accepted', (ref) => {
    const c = contractWith({ type: 'string', default: 'openrouter/vendor/text-model' });
    expect(validateUserOverrides(c, { agents: { writer: { model: ref } } }, catalog)).toMatchObject({ ok: true });
  });
});
