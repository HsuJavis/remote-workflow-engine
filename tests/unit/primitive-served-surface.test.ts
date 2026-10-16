// UT-356 (DES-276 v40 Gate 6 delta, ruling R-2, REQ-222, TASK-273): `models_list({modelType:
// 'decision'})` passes the REAL `tools/list` input schema (the same ajv construction call-tool.ts
// validates every call with). CHARACTERIZATION — green at the time of writing (the enum gained
// 'decision' in the Gate 6 WIP commit 0c31a63 without a test); the bogus-value case is the
// perturbation guard proving the schema check is live.
//
// UT-364 (DES-278, ARCH-194, ruling R-16, REQ-224, TASK-273): `workflow_describe` projects the
// declared `decisions`/`images` blocks — per label `model`/`timeoutMs`/`retries` with their
// defaults and bounds (`retries` range 0..MAX_PRIMITIVE_RETRIES, ceiling `maxRetries`; `timeoutMs`
// ceiling `maxTimeoutMs`) — and omits both keys when the contract declares neither.
// Red reason (UT-364): `projectWorkflowDescribe` copies only `params.agents`/`params.args`, so a
// decide workflow's describe shows no trace of its `decisions` block.
import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import { TOOL_SPECS } from '../../src/tool-specs.js';
import { projectWorkflowDescribe, type WorkflowOwnerView } from '../../src/workflow-view.js';

describe('UT-356: models_list schema accepts modelType "decision" (R-2; characterization)', () => {
  const spec = (TOOL_SPECS as ReadonlyArray<{ name: string; inputSchema: Record<string, unknown> }>).find((s) => s.name === 'models_list');
  const validate = new Ajv({ allErrors: false, strict: false }).compile(spec!.inputSchema);

  it('{modelType:"decision"} is valid against the real tool schema', () => {
    expect(validate({ modelType: 'decision' })).toBe(true);
  });

  it('perturbation guard: {modelType:"bogus"} is refused by the same schema', () => {
    expect(validate({ modelType: 'bogus' })).toBe(false);
  });
});

function owner(params: unknown): WorkflowOwnerView {
  return {
    name: 'describe-prim', version: 'v1',
    channels: { release: 'v1', beta: null },
    versions: ['v1'],
    description: '',
    phases: [{ title: 'Main' }],
    params: params as WorkflowOwnerView['params'],
    owner: null,
    createdAt: '2026-10-16T00:00:00.000Z',
    reportProblem: 'issue_report',
    validation: { ok: true, errors: [] },
    script: 'return 1;',
    mermaid: 'graph LR',
  } as unknown as WorkflowOwnerView;
}

const PRIM = (model: string, timeoutMs: number, retries: number) => ({
  model: { type: 'string', default: model },
  timeoutMs: { type: 'number', default: timeoutMs },
  retries: { type: 'number', default: retries },
});

describe('UT-364: workflow_describe projects decisions/images (R-16, DES-278)', () => {
  it('a declared decisions block is projected per label with defaults and bounds', () => {
    const view = projectWorkflowDescribe(owner({ agents: {}, args: {}, decisions: { gate: PRIM('openrouter/typesafe/jev-1.13', 5000, 2) } }), { triggers: [] });
    const p = view.params as unknown as { decisions?: Record<string, Record<string, unknown>> };
    expect(p.decisions?.['gate']).toMatchObject({
      model: { type: 'string', default: 'openrouter/typesafe/jev-1.13' },
      timeoutMs: { type: 'number', default: 5000, ceiling: 'maxTimeoutMs' },
      retries: { type: 'number', default: 2, range: { min: 0, max: 5 }, ceiling: 'maxRetries' },
    });
  });

  it('a declared images block is projected the same way', () => {
    const view = projectWorkflowDescribe(owner({ agents: {}, args: {}, images: { hero: PRIM('openrouter/google/gemini-2.5-flash-image', 120000, 0) } }), { triggers: [] });
    const p = view.params as unknown as { images?: Record<string, Record<string, unknown>> };
    expect(p.images?.['hero']).toMatchObject({ model: { default: 'openrouter/google/gemini-2.5-flash-image' }, retries: { default: 0 } });
  });

  it('regression guard: a contract with neither block has no decisions/images keys (agents-only describe unchanged)', () => {
    const view = projectWorkflowDescribe(owner({ agents: {}, args: {} }), { triggers: [] });
    expect(Object.keys(view.params).sort()).toEqual(['agents', 'args']);
  });
});
