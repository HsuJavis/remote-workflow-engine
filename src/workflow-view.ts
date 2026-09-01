// workflow-view.ts (DES-115, ARCH-075, TASK-110).
// Pure allowlist projection for a catalog row's read surface. The non-owner branch is CONSTRUCTED
// from an explicit field list, never a `delete` on a full row — `script` is returned twice today
// (mcp-facade.ts:220/232), so a delete-based fix would leak the second copy (v21's fragment-leak
// defect verbatim). Pure: no I/O, no auth, no clock — the policy decision (who is the owner) is made
// by the caller (DES-116, TASK-111) and handed in as `viewerIsOwner`.
import type { ScriptCheckError } from './script-checks.js';

export interface ValidationPublic {
  ok: boolean;
}

export interface ValidationFull extends ValidationPublic {
  errors: ScriptCheckError[];
}

export interface WorkflowOwnerView {
  name: string;
  version: string;
  channels: Record<string, string>;
  versions: string[];
  description?: string;
  phases?: unknown;
  skeleton?: unknown;
  params?: unknown;
  owner: string | null;
  createdAt: string;
  reportProblem: string;
  validation: ValidationFull;
  script: string;
}

// `scriptWithheld: true` is a distinct key, not a `script: undefined`/`null` — the response never
// carries a `script` of a second shape a client's type-narrowing could misread.
export interface WorkflowPublicView {
  name: string;
  version: string;
  channels: Record<string, string>;
  description?: string;
  params?: unknown;
  owner: string | null;
  reportProblem: string;
  validation: ValidationPublic;
  scriptWithheld: true;
}

// The two-sided test oracle (DES-115): flattening this list catches BOTH a new leaked field and a
// missing `scriptWithheld`. Kept here — the module under test is the single source of truth for the
// literal key set, never hardcoded again at the call site.
export const EXPECTED_NON_OWNER_KEYS = [
  'channels', 'description', 'name', 'owner', 'params', 'reportProblem',
  'scriptWithheld', 'validation', 'validation.ok', 'version',
] as const;

export function projectWorkflowForRead(
  full: WorkflowOwnerView,
  viewerIsOwner: boolean,
): WorkflowOwnerView | WorkflowPublicView {
  if (viewerIsOwner) return full;

  return {
    name: full.name,
    version: full.version,
    channels: full.channels,
    description: full.description,
    params: full.params,
    owner: full.owner,
    reportProblem: full.reportProblem,
    validation: { ok: full.validation.ok },
    scriptWithheld: true,
  };
}
