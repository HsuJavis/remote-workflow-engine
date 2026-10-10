// workflow-view.ts (DES-115, ARCH-075, TASK-110).
// Pure allowlist projection for a catalog row's read surface. The non-owner branch is CONSTRUCTED
// from an explicit field list, never a `delete` on a full row — `script` is returned twice today
// (mcp-facade.ts:220/232), so a delete-based fix would leak the second copy (v21's fragment-leak
// defect verbatim). Pure: no I/O, no auth, no clock — the policy decision (who is the owner) is made
// by the caller (DES-116, TASK-111) and handed in as `viewerIsOwner`.
import type { ScriptCheckError } from './script-checks.js';
import { LOCKED_KEYS, DEFAULT_CEILINGS, effectiveAgentBounds, type Ceilings, type AgentParamSpec, type ParamSpec } from './params/contract.js';
// issue #93 item 3: the SAME pure predicate `RunManager.start()` admits/refuses a run with —
// imported, never re-implemented, so `runnable`/`runnableReason` here and the actual admission
// decision cannot drift apart. `admissionRefusal` has no fs/db/clock of its own (run-manager.ts's
// other imports — better-sqlite3 included — are simply unused by this one named export; importing
// it does not give this module any I/O it didn't already effectively depend on at the process
// level, since a WorkflowOwnerView is never built without a live RunManager alongside it).
import { admissionRefusal } from './run-manager.js';

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
    // Owner follow-up ("don't reveal existence" applies to an ALLOWED response too, not just a
    // refusal): `full.channels` carries BOTH pointers verbatim — release AND beta — and beta names
    // a version id the non-owner caller may not even be able to run (issue #100 Q1/Q5). Masked to
    // release-only here, never `full.channels` wholesale; `versions[]` is not on this view at all
    // (WorkflowPublicView never declared it), so there is nothing else to mask on this surface.
    channels: { release: full.channels['release'] ?? null, beta: null } as unknown as WorkflowPublicView['channels'],
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
  attempts?: number;                               // timeoutMs ONLY (DES-239) — 1 + max(0, deployed retries)
  worstCaseMs?: number;                            // timeoutMs ONLY (DES-239) — default * attempts
}

// DES-239: the deployed default when a caller's ctx carries no attempts — 1 + max(0, retries:1).
const DEFAULT_ATTEMPTS = 2;

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
  // issue #93 item 3: `'CONFINEMENT_UNAVAILABLE'` joins the union — a version that would otherwise
  // run (published, non-legacy contract) but that `RunManager.start()` would actually refuse on
  // THIS host for THIS caller (see `projectWorkflowDescribe`'s own `ctx.confinementPosture` doc).
  // issue #154 B1-B4 (2026-10-07 reverify): `'NOT_RUNNABLE'` joins the union — a static
  // registration rule added AFTER this version was registered now refuses it (see
  // `ctx.notRunnable`'s own doc below). #157 (2026-10-07 re-verification of #154) independently
  // hit the SAME gap from `workflow_describe`'s read side: before `ctx.notRunnable` existed,
  // `workflow_source`'s own `validation.ok:false` (`catalog.validateCurrent()`, parse/shape only)
  // was the only place this fact surfaced, while `run_start` already refused the SAME row
  // `NOT_RUNNABLE` (run-manager.ts's admission sequence) — the read and the run path disagreed.
  // `ctx.notRunnable` (`catalog.validateStoredVersion()`) is a strict superset of that
  // `validateCurrent()` re-check (it re-runs `validateScriptEntry` plus name-validity/
  // `scanAgentCalls`/`parseMetaParams`) — ORed with `full.validation.ok===false` below (never
  // replacing it: `full.validation` is still the one field `workflow_source` itself reads, and an
  // existing caller that only ever sets `full.validation` — never the newer `ctx.notRunnable` —
  // must keep reporting NOT_RUNNABLE unchanged), so `describe`'s `runnable`/`runnableReason` now
  // mirrors `run_start` for every reason either issue found.

  runnableReason: 'CHANNEL_UNPUBLISHED' | 'LEGACY_REREGISTER' | 'CONFINEMENT_UNAVAILABLE' | 'NOT_RUNNABLE' | null;
  // Issue #154 residual (2026-10-10 follow-up): the generic `runnableReason:'NOT_RUNNABLE'` never
  // named WHICH static rule a stored row now fails (the 2026-10-08 reverify's own INFO note:
  // "只違反新規則的舊版本 ... describe 的 reason 未點名違規") — a caller could see `runnable:false`
  // but not, from `workflow_describe` alone, whether that was RESERVED_PREFIX, INVALID_NAME, a
  // scan violation, or anything else; only `run_start`'s thrown `detail.violation` named it.
  // Populated from the SAME `catalog.validateStoredVersion()` result `ctx.notRunnable` already
  // derives from (never a second, independent check) — null whenever `runnableReason` is not
  // `'NOT_RUNNABLE'`, and ALSO null for the pre-existing `full.validation.ok===false` branch (a
  // `validateCurrent()`-only parse/shape failure the caller never handed a `ctx.notRunnableDetail`
  // for) rather than guess at a cause this field was never given.
  runnableDetail: { violation: string; message: string } | null;
}

// Transcribed LITERALLY from WorkflowDescribeView's own top-level field list (same convention as
// EXPECTED_NON_OWNER_KEYS above) — DES-156: the four `diagram*` keys are DELETED (not left
// optional), replaced by `mermaid`/`mermaidNote`/`runnable`/`runnableReason`.
export const EXPECTED_DESCRIBE_KEYS = [
  'name', 'version', 'resolvedBy', 'channels', 'versions', 'description', 'phases',
  'params', 'lockedKeys', 'owner', 'reportProblem', 'triggers',
  'mermaid', 'mermaidNote', 'runnable', 'runnableReason', 'runnableDetail',
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
  attempts: number,
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
        ...(key === 'timeoutMs' && typeof s.default === 'number'
          ? { attempts, worstCaseMs: s.default * attempts }
          : {}),
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
  ctx: {
    triggers: unknown[]; ceilings?: Ceilings; attempts?: number;
    // issue #93 item 3: mirrors RunManager.start()'s TWO admission facts EXACTLY —
    // `confinementPosture` (this engine's boot-time measured posture; `undefined` ⇒ "never
    // measured", never gated, same fail-open convention `ToolDeps`/`RunManager` already use) and
    // the union of `isRemoteSubmission` (THIS caller's own socket peer locality — `spec.origin` at
    // `RunManager.start()`) with `registeredRemote` (THIS version's own registering submission —
    // `registered.registeredRemote`, the resolved catalog row's column). Both optional/defaulted
    // so the many pre-existing `projectWorkflowDescribe` test call sites keep compiling unchanged.
    confinementPosture?: 'confined' | 'unconfined'; isRemoteSubmission?: boolean; registeredRemote?: boolean;
    // Owner follow-up (issue #100 Q5, "don't reveal existence"): true for the owner, admin/
    // auth-disabled/loopback-exempt bypass, or an ownerless legacy row (`WorkflowCatalog.canMutate`'s
    // own notion — computed by the caller, `McpFacade.workflowDescribe`, never here: this function
    // stays pure, no auth). Omitted defaults to `true` (full visibility) so the many pre-existing
    // `projectWorkflowDescribe` call sites — which predate any viewer concept at all — keep
    // compiling AND keep their prior (unmasked) behaviour unchanged; only the one production call
    // site that now HAS a viewer to ask passes this explicitly. `false` masks `versions[]` down to
    // just the release version (or `[]` when there is none) and `channels.beta` to `null` — the
    // SAME two fields `McpFacade.workflowList`'s per-row projection masks, same reasoning.
    viewerIsOwner?: boolean;
    // issue #154 B1-B4 (2026-10-07 reverify): true when `catalog.validateStoredVersion(full.name,
    // full.version)` found this STORED version no longer passes a current static registration
    // rule — computed by the caller (`McpFacade.workflowDescribe`, which has the async catalog
    // access this function deliberately stays pure/sync without), same convention as
    // `confinementPosture`/`isRemoteSubmission`/`registeredRemote` above. Omitted/`false` means
    // "no newer rule refuses it" (every pre-existing call site, which predates this check, keeps
    // compiling and keeps its prior behaviour unchanged).
    notRunnable?: boolean;
    // Issue #154 residual (2026-10-10 follow-up): the SAME `validateStoredVersion()` result
    // `ctx.notRunnable` booleanizes, kept whole here so `runnableDetail` can name the violation —
    // never a second check, never re-derived. Omitted whenever `ctx.notRunnable` is falsy/omitted
    // (every pre-existing call site keeps compiling and keeps `runnableDetail: null`).
    notRunnableDetail?: { violation: string; message: string };
  },
): WorkflowDescribeView {
  const ceilings = ctx.ceilings ?? DEFAULT_CEILINGS;
  const attempts = ctx.attempts ?? DEFAULT_ATTEMPTS;
  const paramsRaw = full.params as { agents?: Record<string, AgentParamSpec>; args?: Record<string, ParamSpec> } | undefined;
  const legacy = isLegacyParamsShape(full.params);
  // #98 item 6: an explicit `version` selector (`full.resolvedBy === 'version'`) is what
  // `run_start({version})` ALSO resolves regardless of publication state (REQ-097 "explicit
  // version wins over any channel", and a non-release version is never even reached by a `channel`/
  // default-release selector — `resolveVersionRequest` throws CHANNEL_UNPUBLISHED before `full` is
  // ever built when that pointer is null, so `published` for THOSE two `resolvedBy` values is
  // always true by construction anyway). The bug this fixes: the OLD `release!=null||beta!=null`
  // term answered CHANNEL_UNPUBLISHED for an owner describing their OWN never-published version by
  // explicit id, even though `run_start({version})` runs it fine for them — the read and the run
  // path disagreed about the same row. By the time this function runs, `McpFacade.workflowDescribe`
  // has already refused a NON-owner's non-release request (VERSION_NOT_FOUND, Q5) with the SAME
  // `canRunResolved` predicate `RunManager.start()` uses, so `published` here answers ONLY for a
  // caller who really could run this exact resolved version — never a masking concern.
  const published = full.resolvedBy === 'version' || full.channels['release'] != null || full.channels['beta'] != null;
  // issue #93 item 3: the SAME `admissionRefusal()` predicate `RunManager.start()` calls, keyed on
  // the SAME OR'd origin: this call is remote, OR this version was registered remotely. Checked
  // LAST — after `legacy`/`published` — mirroring `RunManager.start()`'s own precedence exactly
  // (LEGACY_REREGISTER/CHANNEL_UNPUBLISHED are thrown by `catalog.resolve()`/the contract check,
  // both well before the deferred confinement throw at the bottom of `start()`).
  const confinementRefused = admissionRefusal({
    posture: ctx.confinementPosture,
    origin: ctx.isRemoteSubmission || ctx.registeredRemote ? 'remote' : 'local',
  }) !== null;
  // issue #154 B1-B4 (and #157, which independently re-verified the same gap from the describe
  // side — see the union doc comment above): `notRunnable` slots in AFTER legacy/published — both
  // of those are thrown by `catalog.resolve()`/the contract check well before `RunManager.start()`
  // ever reaches admission — and BEFORE confinement, which `start()` defers and throws LAST, past
  // every other admission check including this one.
  const runnableReason: WorkflowDescribeView['runnableReason'] = legacy
    ? 'LEGACY_REREGISTER'
    : !published
      ? 'CHANNEL_UNPUBLISHED'
      : ctx.notRunnable || full.validation.ok === false
        ? 'NOT_RUNNABLE'
        : confinementRefused
          ? 'CONFINEMENT_UNAVAILABLE'
          : null;
  const mermaid = full.mermaid ?? null;
  // Owner follow-up: masked for anyone who is not the owner/bypass/ownerless-row (`viewerIsOwner
  // === false`, the ONLY value that turns masking on — `undefined` stays full-visibility, see the
  // ctx doc comment above). `release` here is ALWAYS `full.version` for a masked caller by
  // construction: `McpFacade.workflowDescribe`'s own `canRunResolved` gate already refused any
  // non-owner request that would have resolved to a different version (Q5), so this never has to
  // re-derive "which version may this caller see" — it only has to stop NAMING the others.
  const viewerIsOwner = ctx.viewerIsOwner ?? true;
  const releasePointer = full.channels['release'] ?? null;
  const maskedChannels = { release: releasePointer, beta: viewerIsOwner ? (full.channels['beta'] ?? null) : null };
  const maskedVersions = viewerIsOwner ? full.versions : (releasePointer !== null ? [releasePointer] : []);

  return {
    name: full.name,
    version: full.version,
    resolvedBy: full.resolvedBy ?? 'default-release',
    channels: maskedChannels,
    versions: maskedVersions,
    description: full.description ?? '',
    phases: (full.phases as Array<{ title: string }> | undefined) ?? [],
    params: {
      agents: !legacy && paramsRaw?.agents ? projectAgentParams(paramsRaw.agents, ceilings, attempts) : {},
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
    // Issue #154 residual: named ONLY for the `ctx.notRunnableDetail`-carrying cause (a stored-row
    // staleness `validateStoredVersion()` found) — never for `full.validation.ok===false` (the
    // older, detail-less `validateCurrent()` branch folded into the SAME `'NOT_RUNNABLE'` reason,
    // where no caller has ever supplied a detail to name), and never for any other reason.
    runnableDetail: runnableReason === 'NOT_RUNNABLE' && ctx.notRunnableDetail ? ctx.notRunnableDetail : null,
  };
}
