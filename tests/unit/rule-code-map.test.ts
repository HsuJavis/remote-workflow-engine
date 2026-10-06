// UT-197 (DES-184, ARCH-119, ADR-043, TASK-189, v26): `RULE_CODE: Record<Rule, ErrorCode>` — a
// TOTAL map replacing the two-way ternary at `workflow-catalog.ts:492-499`
// (`const code = diagramCheck.onlyInScript !== undefined || diagramCheck.onlyInDiagram !== undefined
// ? 'DIAGRAM_MISMATCH' : 'MERMAID_INVALID'`). The three pre-existing strays (`SIZE`,
// `UNDECLARED_NODE`, `AGENT_LABEL_FORMAT`) map EXPLICITLY to `MERMAID_INVALID`; the four v2 rules
// AND (issue #155 B2a, 2026-10-07) `VALUE_MISMATCH`/`COLLAPSED_EDGE` are real `ERROR_CATALOG` rows
// with `see: 'workflow_authoring_guide'`, self-mapped rather than folded into `MERMAID_INVALID` —
// a client branching on `code` could not otherwise tell a genuinely unparsable diagram from a
// well-formed one that merely disagrees with the script's declared value triple or writes the `&`
// fan-out shorthand. Written test-first (Gate 5, RED): `RULE_CODE` does not exist yet, and
// none of the four v2 codes (`DIAGRAM_DIRECTION`/`LANE_MISMATCH`/`TOOLS_MISMATCH`/`EDGE_MISMATCH`)
// are `ERROR_CATALOG` keys today.
// Mock policy (unit): pure data assertion, no I/O.
import { describe, it, expect } from 'vitest';
import { ERROR_CATALOG } from '../../src/errors.js';

// issue #155 B2a: promoted out of PRE_EXISTING_STRAYS — each is now its own ERROR_CATALOG key and
// self-maps in RULE_CODE, same treatment as the four v2 codes above.
const OWN_CODE_RULES = ['DIAGRAM_DIRECTION', 'LANE_MISMATCH', 'TOOLS_MISMATCH', 'EDGE_MISMATCH', 'VALUE_MISMATCH', 'COLLAPSED_EDGE'];
const PRE_EXISTING_STRAYS = ['SIZE', 'UNDECLARED_NODE', 'AGENT_LABEL_FORMAT'];

describe('RULE_CODE is total and the four v2 codes are real catalog rows (UT-197, DES-184)', () => {
  it('each own-code rule (the four v2 codes plus issue #155 B2a\'s VALUE_MISMATCH/COLLAPSED_EDGE) is a real ERROR_CATALOG key with see:workflow_authoring_guide', () => {
    for (const code of OWN_CODE_RULES) {
      expect(Object.hasOwn(ERROR_CATALOG, code)).toBe(true);
      expect((ERROR_CATALOG as any)[code]?.see).toBe('workflow_authoring_guide');
    }
  });

  it('RULE_CODE exists and is total over the workflow-catalog module', async () => {
    const mod = await import('../../src/workflow-catalog.js');
    expect((mod as any).RULE_CODE).toBeDefined();
    for (const rule of [...OWN_CODE_RULES, ...PRE_EXISTING_STRAYS]) {
      expect((mod as any).RULE_CODE[rule]).toBeDefined();
    }
  });

  it('the three pre-existing strays all map to MERMAID_INVALID explicitly', async () => {
    const mod = await import('../../src/workflow-catalog.js');
    for (const rule of PRE_EXISTING_STRAYS) {
      expect((mod as any).RULE_CODE[rule]).toBe('MERMAID_INVALID');
    }
  });

  // issue #155 B2a: the whole point of the fix — these two no longer fold into MERMAID_INVALID.
  it('VALUE_MISMATCH and COLLAPSED_EDGE self-map, never MERMAID_INVALID', async () => {
    const mod = await import('../../src/workflow-catalog.js');
    expect((mod as any).RULE_CODE.VALUE_MISMATCH).toBe('VALUE_MISMATCH');
    expect((mod as any).RULE_CODE.COLLAPSED_EDGE).toBe('COLLAPSED_EDGE');
  });
});
