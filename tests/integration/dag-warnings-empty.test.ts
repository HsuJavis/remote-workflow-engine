// IT-146 (DES-176, ARCH-114/113, TASK-187, v26, REQ-124): a REAL pre-v26 terminal snapshot
// (tests/fixtures/pre-v26-terminal-snapshot.json, engine-generated at Gate 5 — see its own
// `_fixtureMeta`) — neither agent carries `phase`/`phaseIndex` — must still place every agent in its
// TRUE column via `inferPhase`, with `warnings: []`. This is REQ-124's own acceptance clause ("the
// existing production runs" must show zero warnings). Written test-first (Gate 5, RED): `inferPhase`
// does not exist and today's `layoutGraph` joins by `a.phase ?? ''` string equality, which is always
// `''` for this fixture — 100% frame-grouped, non-empty `warnings`.
// Mock policy (integration): the real dashboard.ts derivation functions over a real (fixture) run
// snapshot and a real skeleton derived from the fixture's own recorded script — no server needed
// (this is the same "no server, no engine, no database" shared-corpus discipline as DES-174).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { layoutGraph } from '../../src/dashboard.js';
import { parseWorkflowSkeleton, scanAgentCalls } from '../../src/workflow-meta.js';

const FIXTURE_PATH = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/pre-v26-terminal-snapshot.json');
const snapshot = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8'));

const SCRIPT = `
phase('collect');
await agent('a', { prompt: 'p1' });
phase('review');
await agent('b', { prompt: 'p2' });
`;

describe('a real pre-v26 snapshot places every agent with zero warnings (IT-146, DES-176, REQ-124)', () => {
  it('agent-1 lands in "collect", agent-2 lands in "review", warnings: []', async () => {
    const nodes = parseWorkflowSkeleton(SCRIPT);
    const scan = scanAgentCalls(SCRIPT);
    const { deriveExpectedGraph } = await import('../../src/skeleton-graph.js');
    const derived = deriveExpectedGraph(nodes as any, scan as any) as any;
    expect(derived.ok).toBe(true);

    const result = layoutGraph(derived.graph, snapshot.agents as any, snapshot.phases as any) as any;
    expect(result.warnings).toEqual([]);

    const cellA = result.cells.find((c: any) => c.agentId === 'agent-1');
    const cellB = result.cells.find((c: any) => c.agentId === 'agent-2');
    expect(cellA?.col).toBeLessThan(cellB?.col);
  });
});
