// #169: the generateAudio() registration contract — `meta.params.audio.<label>` (same shape and
// validation as `images`), declared<=>used against the script's own generateAudio() labels, the
// call-site scanner, run-time overrides, the reachable-model set and the describe projection.
import { describe, it, expect } from 'vitest';
import { parseParamContract, validateUserOverrides } from '../../src/params/contract.js';
import { scanPrimitiveCalls, parseMetaParams } from '../../src/workflow-meta.js';
import { validateScriptEntry } from '../../src/script-checks.js';
import { reachableModels } from '../../src/models/model-book.js';
import { resolvePrimitiveParams } from '../../src/params/resolve.js';

const LYRIA = 'openrouter/google/lyria-3-clip-preview';
const SPEC = { model: { type: 'string' as const, default: LYRIA }, timeoutMs: { type: 'number' as const, default: 120000 }, retries: { type: 'number' as const, default: 1 } };
const labels = (generateAudio: string[]) => ({ decide: [], generateImage: [], generateAudio });

describe('#169: scanPrimitiveCalls finds generateAudio() labels', () => {
  it('finds a literal generateAudio() label, independent of generateImage()', () => {
    const r = scanPrimitiveCalls(`await generateAudio('song', {prompt:'la'}); await generateImage('hero', {prompt:'x'});`);
    expect(r.generateAudio).toEqual(['song']);
    expect(r.generateImage).toEqual(['hero']);
    expect(r.violations).toEqual([]);
  });

  it('does not match a member call or a commented-out call', () => {
    const r = scanPrimitiveCalls(`x.generateAudio('a', {prompt:'p'}); // generateAudio('b', {prompt:'p'})`);
    expect(r.generateAudio).toEqual([]);
  });

  it("a tunable in the call options is PARAM_IN_SCRIPT pointing at meta.params.audio; an unknown key is PARAM_UNKNOWN", () => {
    const r = scanPrimitiveCalls(`await generateAudio('song', {prompt:'p', model:'x'}); await generateAudio('s2', {prompt:'p', inputImages:[]});`);
    expect(r.violations).toEqual([
      expect.objectContaining({ code: 'PARAM_IN_SCRIPT', key: 'model', hint: 'move \'model\' to meta.params.audio.song.model.default' }),
      expect.objectContaining({ code: 'PARAM_UNKNOWN', key: 'inputImages' }),
    ]);
    expect(r.violations[1]!.hint).toMatch(/Accepted: prompt, outDir/);
  });

  it('a non-literal label is refused', () => {
    expect(scanPrimitiveCalls(`await generateAudio(name, {prompt:'p'});`).violations[0]?.code).toBe('AGENT_LABEL_NOT_LITERAL');
  });

  it('aliasing generateAudio is refused like the other sandbox API names', () => {
    const r = validateScriptEntry(`const g = generateAudio; await g('song', {prompt:'p'});`) as { ok: boolean };
    expect(r.ok).toBe(false);
  });
});

describe('#169: params.audio declared<=>used', () => {
  it('a generateAudio() call with no params.audio.<label> is refused AUDIO_UNDECLARED (with and without a params block)', () => {
    expect(parseParamContract({ agents: {} }, [], undefined, labels(['song']))).toMatchObject({ ok: false, code: 'AUDIO_UNDECLARED' });
    expect(parseParamContract(undefined, [], undefined, labels(['song']))).toMatchObject({ ok: false, code: 'AUDIO_UNDECLARED' });
  });

  it('a declared params.audio.<label> no generateAudio() call uses is refused AUDIO_DECLARED_NOT_IN_SCRIPT', () => {
    expect(parseParamContract({ audio: { song: SPEC } }, [], undefined, labels([]))).toMatchObject({ ok: false, code: 'AUDIO_DECLARED_NOT_IN_SCRIPT' });
  });

  it('declared + used parses into value.audio; absent block stays absent', () => {
    const r = parseParamContract({ audio: { song: SPEC } }, [], undefined, labels(['song']));
    expect(r).toMatchObject({ ok: true, value: { audio: { song: SPEC } } });
    const none = parseParamContract({ agents: {} }, [], undefined, labels([]));
    expect(none.ok && 'audio' in none.value).toBe(false);
  });

  it('a non-openrouter model is refused PRIMITIVE_PROVIDER_UNSUPPORTED; retries over the cap / missing timeoutMs refused', () => {
    expect(parseParamContract({ audio: { song: { ...SPEC, model: { type: 'string', default: 'anthropic/claude-sonnet-5' } } } }, [], undefined, labels(['song'])))
      .toMatchObject({ ok: false, code: 'PRIMITIVE_PROVIDER_UNSUPPORTED' });
    expect(parseParamContract({ audio: { song: { ...SPEC, retries: { type: 'number', default: 99 } } } }, [], undefined, labels(['song'])))
      .toMatchObject({ ok: false, code: 'PARAM_CONTRACT_INVALID' });
    const { timeoutMs: _t, ...noTimeout } = SPEC;
    expect(parseParamContract({ audio: { song: noTimeout } }, [], undefined, labels(['song']))).toMatchObject({ ok: false });
  });

  it('params.audio must be an object', () => {
    expect(parseParamContract({ audio: [] }, [], undefined, labels([]))).toMatchObject({ ok: false, code: 'PARAM_CONTRACT_INVALID' });
  });

  it('parseMetaParams wires the scanner into the contract end to end', () => {
    const script = `export const meta = { name: 'w', params: { audio: { song: { model: { type: 'string', default: '${LYRIA}' }, timeoutMs: { type: 'number', default: 120000 }, retries: { type: 'number', default: 0 } } } } };\nawait generateAudio('song', { prompt: 'p' });`;
    expect(parseMetaParams(script)).toMatchObject({ ok: true, value: { audio: { song: { model: { default: LYRIA } } } } });
  });
});

describe('#169: overrides.audio', () => {
  const contract = { agents: {}, args: {}, audio: { song: SPEC } };

  it('accepts {audio:{song:{model, timeoutMs, retries}}}', () => {
    expect(validateUserOverrides(contract as never, { audio: { song: { retries: 2, timeoutMs: 5000 } } })).toMatchObject({ ok: true, value: { audio: { song: { retries: 2, timeoutMs: 5000 } } } });
  });

  it('an undeclared audio label is UNKNOWN_AGENT_LABEL with block audio; effort is PARAM_UNKNOWN', () => {
    expect(validateUserOverrides(contract as never, { audio: { nope: {} } })).toMatchObject({ ok: false, code: 'UNKNOWN_AGENT_LABEL', detail: { block: 'audio' } });
    expect(validateUserOverrides(contract as never, { audio: { song: { effort: 'high' } } })).toMatchObject({ ok: false, code: 'PARAM_UNKNOWN' });
  });

  it('resolvePrimitiveParams folds an override over the declared defaults', () => {
    expect(resolvePrimitiveParams(contract.audio as never, { song: { retries: 3 } })).toEqual({ song: { model: LYRIA, timeoutMs: 120000, retries: 3 } });
  });
});

describe('#169: reachableModels includes audio models', () => {
  it('reads params.audio[*].model', () => {
    expect(reachableModels({ audio: { song: { model: LYRIA, timeoutMs: 1, retries: 0 } } } as never)).toContain(LYRIA);
  });
});
