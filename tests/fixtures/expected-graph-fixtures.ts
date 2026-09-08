// v26 (DES-174/ARCH-113, TASK-184): the ONE shared `(scriptSource, expected)` corpus consumed by
// BOTH the registration checker's tests (DES-184/check-mermaid-v2.test.ts) and the layout tests
// (DES-176/layout-graph-phase.test.ts) — INV-V26-3 as a test. Hand-written literals ONLY — never
// produced by running `deriveExpectedGraph` and pasting its output (that would convert a bug in the
// function into a green oracle; per-tier mock policy, 04-design.md §Per-tier mock policy v26).
//
// Local type copies of ARCH-113's `ExpectedGraph` shape (skeleton-graph.ts does not exist yet — a
// value import would break every file that imports this fixture module; these are structural
// literals the eventual `src/skeleton-graph.ts` must produce byte-for-byte, not a second source of
// truth). NOT collected by vitest (`include: ['tests/**/*.test.ts']` in vitest.config.ts).

export interface ExpectedLane {
  index: number;
  title: string | null;
  dynamic: boolean;
  slots: number[];
}

export interface ExpectedSlot {
  index: number;
  lane: number;
  labels: string[];
  kind: 'single' | 'parallel' | 'alt';
  tools: Record<string, string[] | 'default'>;
}

export interface ExpectedEdge {
  from: number;
  to: number;
}

export interface ExpectedGraph {
  lanes: ExpectedLane[];
  slots: ExpectedSlot[];
  edges: ExpectedEdge[];
}

export type DeriveResult =
  | { ok: true; graph: ExpectedGraph }
  | { ok: false; rule: 'AGENT_BEFORE_PHASE' | 'UNDECIDABLE_SHAPE'; line: number; label: string | null; message: string };

export interface GraphFixture {
  name: string;
  script: string;
  expected: DeriveResult;
}

const linearScript = `
export const meta = { name: 'linear', params: { agents: { a: {}, b: {}, c: {} } } };
phase('one');
await agent('a', { prompt: 'p' });
phase('two');
await agent('b', { prompt: 'p' });
phase('three');
await agent('c', { prompt: 'p' });
`;

const parallel3Script = `
export const meta = { name: 'par3', params: { agents: { a: {}, b: {}, c: {} } } };
phase('fanout');
await parallel([
  () => agent('a', { prompt: 'p' }),
  () => agent('b', { prompt: 'p' }),
  () => agent('c', { prompt: 'p' }),
]);
`;

const ternaryScript = `
export const meta = { name: 'ternary', params: { agents: { a: {}, b: {} } } };
phase('branch');
await (cond ? agent('a', { prompt: 'p' }) : agent('b', { prompt: 'p' }));
`;

const ifElseScript = `
export const meta = { name: 'ifelse', params: { agents: { a: {}, b: {} } } };
phase('branch');
if (cond) {
  await agent('a', { prompt: 'p' });
} else {
  await agent('b', { prompt: 'p' });
}
`;

const nestedWorkflowScript = `
export const meta = { name: 'nested', params: { agents: { a: {} } } };
phase('outer');
await agent('a', { prompt: 'p' });
phase('delegate');
await workflow('sub-workflow', {});
`;

const parallelOfWorkflowScript = `
export const meta = { name: 'parwf', params: { agents: {} } };
phase('fanout');
await parallel([
  () => workflow('sub-a', {}),
  () => workflow('sub-b', {}),
]);
`;

const dynamicTitleScript = `
export const meta = { name: 'dyntitle', params: { agents: { a: {} } } };
phase('fork:' + tier);
await agent('a', { prompt: 'p' });
`;

const duplicateTitlesScript = `
export const meta = { name: 'duptitles', params: { agents: { a: {}, b: {} } } };
phase('review');
await agent('a', { prompt: 'p' });
phase('review');
await agent('b', { prompt: 'p' });
`;

const duplicateLabelsScript = `
export const meta = { name: 'duplabels', params: { agents: { a: {} } } };
phase('one');
await agent('a', { prompt: 'p1' });
phase('two');
await agent('a', { prompt: 'p2' });
`;

const noAllowedToolsScript = `
export const meta = { name: 'noallowed', params: { agents: { a: {} } } };
phase('one');
await agent('a', { prompt: 'p' });
`;

const emptyAllowedToolsScript = `
export const meta = { name: 'emptyallowed', params: { agents: { a: {} } } };
phase('one');
await agent('a', { prompt: 'p', allowedTools: [] });
`;

const agentBeforePhaseScript = `
export const meta = { name: 'beforephase', params: { agents: { a: {} } } };
await agent('a', { prompt: 'p' });
phase('one');
`;

const switchScript = `
export const meta = { name: 'switchy', params: { agents: { a: {}, b: {} } } };
phase('one');
switch (mode) {
  case 'x': await agent('a', { prompt: 'p' }); break;
  default: await agent('b', { prompt: 'p' }); break;
}
`;

const loopBodyScript = `
export const meta = { name: 'loopbody', params: { agents: { a: {} } } };
phase('one');
for (const item of items) {
  await agent('a', { prompt: item });
}
`;

export const GRAPH_FIXTURES: GraphFixture[] = [
  {
    name: 'linear 3-phase',
    script: linearScript,
    expected: {
      ok: true,
      graph: {
        lanes: [
          { index: 0, title: 'one', dynamic: false, slots: [0] },
          { index: 1, title: 'two', dynamic: false, slots: [1] },
          { index: 2, title: 'three', dynamic: false, slots: [2] },
        ],
        slots: [
          { index: 0, lane: 0, labels: ['a'], kind: 'single', tools: { a: 'default' } },
          { index: 1, lane: 1, labels: ['b'], kind: 'single', tools: { b: 'default' } },
          { index: 2, lane: 2, labels: ['c'], kind: 'single', tools: { c: 'default' } },
        ],
        edges: [{ from: 0, to: 1 }, { from: 1, to: 2 }],
      },
    },
  },
  {
    name: 'parallel of 3',
    script: parallel3Script,
    expected: {
      ok: true,
      graph: {
        lanes: [{ index: 0, title: 'fanout', dynamic: false, slots: [0] }],
        slots: [{ index: 0, lane: 0, labels: ['a', 'b', 'c'], kind: 'parallel', tools: { a: 'default', b: 'default', c: 'default' } }],
        edges: [],
      },
    },
  },
  {
    name: 'ternary',
    script: ternaryScript,
    expected: {
      ok: true,
      graph: {
        lanes: [{ index: 0, title: 'branch', dynamic: false, slots: [0] }],
        slots: [{ index: 0, lane: 0, labels: ['a', 'b'], kind: 'alt', tools: { a: 'default', b: 'default' } }],
        edges: [],
      },
    },
  },
  {
    name: 'if/else',
    script: ifElseScript,
    expected: {
      ok: true,
      graph: {
        lanes: [{ index: 0, title: 'branch', dynamic: false, slots: [0] }],
        slots: [{ index: 0, lane: 0, labels: ['a', 'b'], kind: 'alt', tools: { a: 'default', b: 'default' } }],
        edges: [],
      },
    },
  },
  {
    name: 'nested workflow() is transparent',
    script: nestedWorkflowScript,
    expected: {
      ok: true,
      graph: {
        lanes: [
          { index: 0, title: 'outer', dynamic: false, slots: [0] },
          { index: 1, title: 'delegate', dynamic: false, slots: [] },
        ],
        slots: [{ index: 0, lane: 0, labels: ['a'], kind: 'single', tools: { a: 'default' } }],
        edges: [],
      },
    },
  },
  {
    name: 'parallel of workflow() yields no slot',
    script: parallelOfWorkflowScript,
    expected: {
      ok: true,
      graph: {
        lanes: [{ index: 0, title: 'fanout', dynamic: false, slots: [] }],
        slots: [],
        edges: [],
      },
    },
  },
  {
    name: 'dynamic title — lane matched by position, title null',
    script: dynamicTitleScript,
    expected: {
      ok: true,
      graph: {
        lanes: [{ index: 0, title: null, dynamic: false, slots: [0] }],
        slots: [{ index: 0, lane: 0, labels: ['a'], kind: 'single', tools: { a: 'default' } }],
        edges: [],
      },
    },
  },
  {
    name: 'duplicate phase titles — two distinct lanes, ordinal not string-equal',
    script: duplicateTitlesScript,
    expected: {
      ok: true,
      graph: {
        lanes: [
          { index: 0, title: 'review', dynamic: false, slots: [0] },
          { index: 1, title: 'review', dynamic: false, slots: [1] },
        ],
        slots: [
          { index: 0, lane: 0, labels: ['a'], kind: 'single', tools: { a: 'default' } },
          { index: 1, lane: 1, labels: ['b'], kind: 'single', tools: { b: 'default' } },
        ],
        edges: [{ from: 0, to: 1 }],
      },
    },
  },
  {
    name: 'duplicate labels — two distinct slots joined by offset, not label',
    script: duplicateLabelsScript,
    expected: {
      ok: true,
      graph: {
        lanes: [
          { index: 0, title: 'one', dynamic: false, slots: [0] },
          { index: 1, title: 'two', dynamic: false, slots: [1] },
        ],
        slots: [
          { index: 0, lane: 0, labels: ['a'], kind: 'single', tools: { a: 'default' } },
          { index: 1, lane: 1, labels: ['a'], kind: 'single', tools: { a: 'default' } },
        ],
        edges: [{ from: 0, to: 1 }],
      },
    },
  },
  {
    name: 'allowedTools: [] — recorded verbatim, not "default"',
    script: emptyAllowedToolsScript,
    expected: {
      ok: true,
      graph: {
        lanes: [{ index: 0, title: 'one', dynamic: false, slots: [0] }],
        slots: [{ index: 0, lane: 0, labels: ['a'], kind: 'single', tools: { a: [] } }],
        edges: [],
      },
    },
  },
  {
    name: 'no allowedTools — "default"',
    script: noAllowedToolsScript,
    expected: {
      ok: true,
      graph: {
        lanes: [{ index: 0, title: 'one', dynamic: false, slots: [0] }],
        slots: [{ index: 0, lane: 0, labels: ['a'], kind: 'single', tools: { a: 'default' } }],
        edges: [],
      },
    },
  },
  {
    name: 'agent() before any phase() — refused, never throws',
    script: agentBeforePhaseScript,
    expected: { ok: false, rule: 'AGENT_BEFORE_PHASE', line: 3, label: 'a', message: 'every agent must be dispatched inside a phase' },
  },
  {
    name: 'switch — existing SCAN_VIOLATION shape, undecidable here',
    script: switchScript,
    expected: { ok: false, rule: 'UNDECIDABLE_SHAPE', line: 3, label: null, message: 'a switch over agent() calls cannot be statically resolved into a slot' },
  },
  {
    name: 'agent() inside a for body — dynamic lane, no static slot',
    script: loopBodyScript,
    expected: {
      ok: true,
      graph: {
        lanes: [{ index: 0, title: 'one', dynamic: true, slots: [] }],
        slots: [],
        edges: [],
      },
    },
  },
];
