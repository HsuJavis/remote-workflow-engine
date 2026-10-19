export const meta = {
  description: 'Gate 7.5 real-tier v41 REQ-227/231/232 load: per job, decide a + agent w in parallel, then decide b after w returns.',
  phases: [{ title: 'burst' }],
  params: {
    args: { n: { type: 'number', min: 1, max: 100, default: 10 } },
    decisions: {
      a: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 2 } },
      b: { model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' }, timeoutMs: { type: 'number', default: 5000 }, retries: { type: 'number', default: 2 } },
    },
    agents: {
      w: { model: { type: 'string', default: 'openrouter/anthropic/claude-haiku-5.5' }, effort: { type: 'enum', enum: ['low', 'medium', 'high'], default: 'low' }, timeoutMs: { type: 'number', default: 30000 } },
    },
  },
};

const Q = { q0: { type: 'bool', instructions: '這段文字是否提到甜點？', criteria: { true: '有提到', false: '沒提到' } } };
const tryDecide = async (fn, i, which) => {
  try { await fn(); return null; } catch (e) {
    return { i, which, name: String(e && e.name), code: String(e && e.code), msg: String(e && e.message).slice(0, 200) };
  }
};

phase('burst');
const outs = await parallel(Array.from({ length: args.n }, (_, i) => async () => {
  const state = { 編號: i, 文字: '測試訊息 ' + i + '：想問一下蛋糕和冰淇淋的事情。' };
  const [fa, text] = await parallel([
    () => tryDecide(() => decide('a', { state, questions: Q }), i, 'a'),
    () => agent('w', { prompt: '用一句繁體中文回覆這則測試訊息，不要用工具：' + state.文字, allowedTools: [] }),
  ]);
  const fb = await tryDecide(() => decide('b', { state: { ...state, 回覆: String(text || '') }, questions: Q }), i, 'b');
  return [fa, fb].filter(Boolean);
}));
const fails = outs.flat();
return { n: args.n, decides: args.n * 2, failed: fails.length, fails };
