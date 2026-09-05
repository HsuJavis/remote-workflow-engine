// Re-export shim (v24 DES-143/TASK-135): `scanAgentCalls`'s real implementation lives in
// `workflow-meta.ts` per ARCH-096's `module:` — it extends that file's existing `matchDelimiter`
// helper. This file exists only because `tests/unit/scan-agent-calls.test.ts` (Gate 5) imports
// from this path; see the implementer's PARIMPL report (test_defects) for the mismatch against
// 03-tasks.md's `files:` list.
export { scanAgentCalls } from './workflow-meta.js';
export type { AgentCallScan, AgentCallViolation, AgentCallViolationCode } from './workflow-meta.js';
