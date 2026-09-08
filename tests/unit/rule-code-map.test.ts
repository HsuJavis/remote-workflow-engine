// UT-197 (DES-184, ARCH-119, ADR-043, TASK-189, v26): `RULE_CODE: Record<Rule, ErrorCode>` — a
// TOTAL map replacing the two-way ternary at `workflow-catalog.ts:492-499`
// (`const code = diagramCheck.onlyInScript !== undefined || diagramCheck.onlyInDiagram !== undefined
// ? 'DIAGRAM_MISMATCH' : 'MERMAID_INVALID'`). The five pre-existing strays (`SIZE`,
// `COLLAPSED_EDGE`, `UNDECLARED_NODE`, `AGENT_LABEL_FORMAT`, `VALUE_MISMATCH`) map EXPLICITLY to
// `MERMAID_INVALID`; the four v2 rules become real `ERROR_CATALOG` rows with `see:
// 'workflow_authoring_guide'`. Written test-first (Gate 5, RED): `RULE_CODE` does not exist yet, and
// none of the four v2 codes (`DIAGRAM_DIRECTION`/`LANE_MISMATCH`/`TOOLS_MISMATCH`/`EDGE_MISMATCH`)
// are `ERROR_CATALOG` keys today.
// Mock policy (unit): pure data assertion, no I/O.
import { describe, it, expect } from 'vitest';
import { ERROR_CATALOG } from '../../src/errors.js';

const V2_CODES = ['DIAGRAM_DIRECTION', 'LANE_MISMATCH', 'TOOLS_MISMATCH', 'EDGE_MISMATCH'];
const PRE_EXISTING_STRAYS = ['SIZE', 'COLLAPSED_EDGE', 'UNDECLARED_NODE', 'AGENT_LABEL_FORMAT', 'VALUE_MISMATCH'];

describe('RULE_CODE is total and the four v2 codes are real catalog rows (UT-197, DES-184)', () => {
  it('each of the four v2 rule codes is a real ERROR_CATALOG key with see:workflow_authoring_guide', () => {
    for (const code of V2_CODES) {
      expect(Object.hasOwn(ERROR_CATALOG, code)).toBe(true);
      expect((ERROR_CATALOG as any)[code]?.see).toBe('workflow_authoring_guide');
    }
  });

  it('RULE_CODE exists and is total over the workflow-catalog module', async () => {
    const mod = await import('../../src/workflow-catalog.js');
    expect((mod as any).RULE_CODE).toBeDefined();
    for (const rule of [...V2_CODES, ...PRE_EXISTING_STRAYS]) {
      expect((mod as any).RULE_CODE[rule]).toBeDefined();
    }
  });

  it('the five pre-existing strays all map to MERMAID_INVALID explicitly', async () => {
    const mod = await import('../../src/workflow-catalog.js');
    for (const rule of PRE_EXISTING_STRAYS) {
      expect((mod as any).RULE_CODE[rule]).toBe('MERMAID_INVALID');
    }
  });
});
