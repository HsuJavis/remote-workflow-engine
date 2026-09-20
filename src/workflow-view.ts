// workflow-view.ts (DES-115, ARCH-075, TASK-110).
// Pure allowlist projection for a catalog row's read surface. The non-owner branch is CONSTRUCTED
// from an explicit field list, never a `delete` on a full row — `script` is returned twice today
// (mcp-facade.ts:220/232), so a delete-based fix would leak the second copy (v21's fragment-leak
// defect verbatim). Pure: no I/O, no auth, no clock — the policy decision (who is the owner) is made
// by the caller (DES-116, TASK-111) and handed in as `viewerIsOwner`.
import type { ScriptCheckError } from './script-checks.js';
import { LOCKED_KEYS, DEFAULT_CEILINGS, effectiveAgentBounds, type Ceilings, type AgentParamSpec, type ParamSpec } from './params/contract.js';

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
  params?: unknown;
  owner: string | null;
  createdAt: string;
  reportProblem: string;
  validation: ValidationFull;
  script: string;
  // v23 (DES-125, TASK-118): how this row's version was resolved — carried through from
  // resolveVersionRequest's RequestShape (DES-110). Optional here (the pre-v23 read paths that
  // build a WorkflowOwnerView never set it) — projectWorkflowDescribe defaults an absent value.
  resolvedBy?: 'version' | 'channel' | 'default-release';
  // v24 (DES-156, TASK-149): the stored Mermaid diagram string, verbatim, or absent/null on a
  // legacy row registered before ADR-025 required one — `projectWorkflowDescribe` reads this
  // directly (no separate diagram row/ctx any more, TASK-139 retired the analyzer that drew one).
  mermaid?: string | null;
}

// `scriptWithheld: true` is a distinct key, not a `script: undefined`/`null` — the response never
// carries a `script` of a second shape a client's type-narrowing could misread.
export interface WorkflowPublicView {
  name: string;
  version: string;
  channels: Record<string, string>;
  description?: string;
  // v23 (DES-136, TASK-125, adjudication #1 一律公開): public on every surface — titles only.
  phases?: Array<{ title: string }>;
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
  'channels', 'description', 'name', 'owner', 'params', 'phases', 'reportProblem',
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
    phases: full.phases as WorkflowPublicView['phases'],
    params: full.params,
    owner: full.owner,
    reportProblem: full.reportProblem,
    validation: { ok: full.validation.ok },
    scriptWithheld: true,
  };
}

/** One `params.agents.<label>` entry per tunable key (DES-156) — `range` is `author ∩ ceiling`
 *  (via `effectiveAgentBounds`), never the raw author-declared range, so a user only ever sees
 *  what will actually be ACCEPTED. */
export interface DescribeAgentParamKey {
  type: ParamSpec['type'];
  default: unknown;
  range?: unknown[] | { min?: number; max?: number };
  unit?: 'bytes';                                  // appendPrompt ONLY — see boundary in DES-223
  ceiling?: NonNullable<ParamSpec['ceilingKey']>;  // 'maxTimeoutMs'|'maxAppendPromptBytes'|'maxEffort'
}

// v24 (DES-156, ARCH-105/106, TASK-149): the ONE `workflow_describe` response — every principal
// gets the SAME shape (no `viewerIsOwner` parameter). No `script` field exists on the type at
// all, so a leak is a `tsc` error. Replaces the retired `diagram`/`diagramStatus`/
// `diagramGeneratedAt`/`diagramStale` family (TASK-139) with `mermaid`/`mermaidNote` (verbatim
// stored string, honest-null note) and adds `runnable`/`runnableReason` and a by-id `triggers`.
export interface WorkflowDescribeView {
  name: string;
  version: string;
  resolvedBy: 'version' | 'channel' | 'default-release';
  channels: { release: string | null; beta: string | null };
  versions: string[];
  description: string;
  phases: Array<{ title: string }>; // adjudication #1 — public to every principal (DES-136)
  params: { agents: Record<string, Record<string, DescribeAgentParamKey>>; args: Record<string, ParamSpec> };
  lockedKeys: readonly string[]; // === LOCKED_KEYS from src/params/contract.ts — imported, never re-typed
  owner: string | null;
  reportProblem: string;
  triggers: unknown[]; // resolved BY ID by the caller (scheduler.get(id) ?? webhooks.get(id)) — live snapshot
  mermaid: string | null; // the stored string VERBATIM
  mermaidNote: 'LEGACY_NO_DIAGRAM' | null; // set iff mermaid === null
  runnable: boolean;
  runnableReason: 'CHANNEL_UNPUBLISHED' | 'LEGACY_REREGISTER' | null;
}

// Transcribed LITERALLY from WorkflowDescribeView's own top-level field list (same convention as
// EXPECTED_NON_OWNER_KEYS above) — DES-156: the four `diagram*` keys are DELETED (not left
// optional), replaced by `mermaid`/`mermaidNote`/`runnable`/`runnableReason`.
export const EXPECTED_DESCRIBE_KEYS = [
  'name', 'version', 'resolvedBy', 'channels', 'versions', 'description', 'phases',
  'params', 'lockedKeys', 'owner', 'reportProblem', 'triggers',
  'mermaid', 'mermaidNote', 'runnable', 'runnableReason',
] as const;

/** True for any version row that predates the v24 per-agent contract — it cannot be run
 *  (LEGACY_REREGISTER). Two shapes qualify, and the second was MISSING (v24 integrator):
 *   - the pre-v24 flat `{knobs:{…}}` contract (ADR-035 retired it), and
 *   - NO contract at all (`undefined`/`null`), which is every pre-v22 row a catalog migration
 *     carried forward. `insertVersion` writes a contract unconditionally — `{agents:{},args:{}}` at
 *     minimum — so an absent one means exactly "registered before v24".
 *  Without the second case `workflow_describe` reported a migrated pre-v22 row as `runnable:true`
 *  while `run_start` refused it LEGACY_REREGISTER: the read surface and the run path disagreed
 *  about one row, which is precisely the condition this field exists to make visible. */
function isLegacyParamsShape(params: unknown): boolean {
  if (params === undefined || params === null) return true;
  if (typeof params !== 'object') return false;
  const p = params as Record<string, unknown>;
  return 'knobs' in p && !('agents' in p);
}

/** DES-156: `params.agents.<label>` projected to `{type, default, range}` per tunable key, with
 *  `range` bounded to `author ∩ ceiling` via `effectiveAgentBounds` — never the raw author range. */
function projectAgentParams(
  agents: Record<string, AgentParamSpec>,
  ceilings: Ceilings,
): Record<string, Record<string, DescribeAgentParamKey>> {
  const out: Record<string, Record<string, DescribeAgentParamKey>> = {};
  for (const [label, spec] of Object.entries(agents)) {
    const eff = effectiveAgentBounds(spec, ceilings);
    const projected: Record<string, DescribeAgentParamKey> = {};
    for (const key of ['model', 'effort', 'timeoutMs', 'appendPrompt'] as const) {
      const s = eff[key] as ParamSpec | undefined;
      if (!s) continue;
      projected[key] = {
        type: s.type,
        default: s.default,
        ...(s.enum !== undefined ? { range: s.enum } : s.min !== undefined || s.max !== undefined ? { range: { min: s.min, max: s.max } } : {}),
        ...(key === 'appendPrompt' ? { unit: 'bytes' as const } : {}),
        ...(s.ceilingKey !== undefined ? { ceiling: s.ceilingKey } : {}),
      };
    }
    out[label] = projected;
  }
  return out;
}

/** DES-156: pure — no clock, no I/O, no auth. `ctx.triggers` is the caller's already-resolved,
 *  by-id live snapshot (`scheduler.get(id) ?? webhooks.get(id)`, never a by-workflow query — that
 *  port was retired with the analyzer, TASK-139); `ctx.ceilings` defaults to `DEFAULT_CEILINGS`
 *  when the caller has no operator override to pass. */
export function projectWorkflowDescribe(
  full: WorkflowOwnerView,
  ctx: { triggers: unknown[]; ceilings?: Ceilings },
): WorkflowDescribeView {
  const ceilings = ctx.ceilings ?? DEFAULT_CEILINGS;
  const paramsRaw = full.params as { agents?: Record<string, AgentParamSpec>; args?: Record<string, ParamSpec> } | undefined;
  const legacy = isLegacyParamsShape(full.params);
  const published = full.channels['release'] != null || full.channels['beta'] != null;
  const runnableReason: WorkflowDescribeView['runnableReason'] = legacy
    ? 'LEGACY_REREGISTER'
    : !published
      ? 'CHANNEL_UNPUBLISHED'
      : null;
  const mermaid = full.mermaid ?? null;

  return {
    name: full.name,
    version: full.version,
    resolvedBy: full.resolvedBy ?? 'default-release',
    channels: { release: full.channels['release'] ?? null, beta: full.channels['beta'] ?? null },
    versions: full.versions,
    description: full.description ?? '',
    phases: (full.phases as Array<{ title: string }> | undefined) ?? [],
    params: {
      agents: !legacy && paramsRaw?.agents ? projectAgentParams(paramsRaw.agents, ceilings) : {},
      args: (!legacy && paramsRaw?.args) || {},
    },
    lockedKeys: LOCKED_KEYS,
    owner: full.owner,
    reportProblem: full.reportProblem,
    triggers: ctx.triggers,
    mermaid,
    mermaidNote: mermaid === null ? 'LEGACY_NO_DIAGRAM' : null,
    runnable: runnableReason === null,
    runnableReason,
  };
}
