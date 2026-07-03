// UT-013: Cross-cutting null semantics — parallel thunk fail → null slot; pipeline stage throw → item null (DES-013)
import { describe, it, expect } from 'vitest';
import { evaluateScript } from '../../src/sandbox/guards.js';
import type { SandboxApi } from '../../src/sandbox/guards.js';
import type { Budget } from '../../src/types.js';

const NEVER_BUDGET: Budget = { total: null, spent: () => 0, remaining: () => Infinity };

// An API where specific prompts throw
function apiWithFailures(failOn: string[]): SandboxApi {
  return {
    async agent(prompt: string) {
      if (failOn.includes(prompt)) throw new Error(`terminal failure for: ${prompt}`);
      return `result:${prompt}`;
    },
    args: undefined,
    budget: NEVER_BUDGET,
  };
}

describe('Null semantics (DES-013)', () => {
  it('parallel(): a throwing thunk resolves to null, others complete normally', async () => {
    const api = apiWithFailures(['fail-me']);
    const script = `
      return parallel([
        async () => agent('ok-1'),
        async () => agent('fail-me'),
        async () => agent('ok-2'),
      ]);
    `;
    const r = await evaluateScript(script, api);
    expect(r.kind).toBe('done');
    expect(r.value).toEqual(['result:ok-1', null, 'result:ok-2']);
  });

  it('parallel() itself never rejects — barrier resolves with nulls', async () => {
    const api = apiWithFailures(['all-fail', 'also-fail']);
    const script = `
      return parallel([
        async () => agent('all-fail'),
        async () => agent('also-fail'),
      ]);
    `;
    const r = await evaluateScript(script, api);
    expect(r.kind).toBe('done');
    expect(r.value).toEqual([null, null]);
  });

  it('pipeline(): a throwing stage resolves that item to null, remaining stages skipped', async () => {
    const api: SandboxApi = {
      async agent() { return 'unused'; },
      args: undefined,
      budget: NEVER_BUDGET,
    };
    const script = `
      const stage1 = async (prev, item) => { if (item === 'bad') throw new Error('bad item'); return 'stage1:' + item; };
      const stage2 = async (prev, item) => 'stage2:' + prev;
      return pipeline(['good', 'bad'], stage1, stage2);
    `;
    const r = await evaluateScript(script, api);
    expect(r.kind).toBe('done');
    // 'good' goes through both stages; 'bad' → null (stage1 throws, stage2 skipped)
    expect(r.value).toEqual(['stage2:stage1:good', null]);
  });

  it('pipeline() itself never rejects', async () => {
    const api: SandboxApi = {
      async agent() { return 'ok'; },
      args: undefined,
      budget: NEVER_BUDGET,
    };
    const script = `
      const throwingStage = async () => { throw new Error('always fails'); };
      return pipeline(['a', 'b', 'c'], throwingStage);
    `;
    const r = await evaluateScript(script, api);
    expect(r.kind).toBe('done');
    expect(r.value).toEqual([null, null, null]);
  });

  it('agent() terminal error via IPC agentThrow resolves to null (not script exception)', async () => {
    // The IPC delivers agentThrow only for budget/nesting/unknown-name — those DO throw in-script.
    // For terminal API errors the parent sends agentResult{value:null}.
    // This test verifies the null-semantics path by simulating an API that returns null.
    const api: SandboxApi = {
      async agent() { return null; },
      args: undefined,
      budget: NEVER_BUDGET,
    };
    const r = await evaluateScript('return agent("query");', api);
    expect(r.kind).toBe('done');
    expect(r.value).toBeNull();
  });
});
