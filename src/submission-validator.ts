// SubmissionValidator (DES-012 / ARCH-008 / TASK-017).
// Thin facade at the submission entry point: fail fast on a bad submission, never mid-run.
//
// v22 (DES-112, DES-113, DES-117, TASK-108) SHRINK: the parse/alias/MCP-name checks that used to
// live in this file's `if (spec.script)` block moved to registration (ADR-013 — enforced once, at
// WorkflowCatalog.register(), via the lifted script-checks.ts). Inline scripts are now refused at
// RunManager.start() (REQ-098, INLINE_SCRIPT_CLOSED) regardless of what this validator does, so this
// file no longer has any script-shaped work left to check. `SubmissionValidatorDeps` shrinks to
// `{catalog}` — deleting `aliases`/`mcpRegistry`/`openrouterPassthrough` turns "re-add the alias
// check here too" into a `tsc` error, not a silent second enforcement site (ADR-013).
import type { RunSpec, ErrEnvelope } from './types.js';
import type { WorkflowCatalog } from './workflow-catalog.js';

export interface SubmissionValidatorDeps {
  catalog?: WorkflowCatalog;
}

export class SubmissionValidator {
  private readonly _catalog?: WorkflowCatalog;

  constructor(deps: SubmissionValidatorDeps = {}) {
    this._catalog = deps.catalog;
  }

  async validate(spec: RunSpec): Promise<{ ok: true } | { ok: false; errors: ErrEnvelope[] }> {
    // v22 (DES-117): renamed from MISSING_SCRIPT — a registered workflow "name" is the only way to
    // submit a run now; the old code/message named a parameter (`script`) that no longer exists and
    // would teach an agent to retry with it.
    if (!spec.name) {
      return {
        ok: false,
        errors: [{ code: 'MISSING_NAME', message: 'Submission requires a registered workflow "name" (workflow_register once, then workflow_run({name})).', field: 'name' }],
      };
    }

    // ARCH-007 delegate: registered-workflow existence.
    if (this._catalog) {
      if (!(await this._catalog.exists(spec.name))) {
        return { ok: false, errors: [{ code: 'UNKNOWN_WORKFLOW', message: `Unknown workflow: ${spec.name}`, field: 'name' }] };
      }
    } else {
      return { ok: false, errors: [{ code: 'UNKNOWN_WORKFLOW', message: `Unknown workflow: ${spec.name}`, field: 'name' }] };
    }

    return { ok: true };
  }
}
