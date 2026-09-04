// Domain error types. Implemented fully — pure value classes, no business logic.
//
// v24 (DES-137, ARCH-087, TASK-131): ERROR_CATALOG is the closed `ErrorCode` union — every coded
// refusal this engine can throw is a key here, with the `see` pointer (workflow_authoring_guide|null)
// attached in this ONE place (never hand-typed again at a call site). NO `message` field: the call
// site always supplies its own, so the same code can carry a different message per occurrence.
//
// TASK-143 (DES-148) update: `HARNESS_DEFAULTS_INVALID` is retired below — `workflow-catalog.ts`'s
// v15-era `register(name, script, defaults, principal)` positional shape is gone (v24
// `register()`/`validateRegistration()`/`insertVersion()` take `{name, script, mermaid, ...}`, no
// `defaults` field at all, per ADR-035). The three dependent files this key's prior note named
// (`harness-defaults-validation.test.ts`, `val-098-harness-defaults.test.ts`,
// `val-103-effort-real.test.ts`) were already red before this change — a sibling v24 change
// (DES-144's `parseParamContract`) made every `registerPublished()`-based fixture throw
// `AGENT_UNDECLARED` first — so removing this key changes zero passing tests either way. See
// TASK-143's PARIMPL report (test_defects) for the full cross-task trace.
//
// TASK-154 (2026-09-04) update: the retirement forewarned above has now happened. All three files'
// `HARNESS_DEFAULTS_INVALID`/`defaults`-door assertions are deleted or replaced by a compact
// DEFAULTS_RETIRED regression suite (real HTTP + real SQLite catalog, each file's own original
// mock policy) — `grep -rn "HARNESS_DEFAULTS_INVALID" tests/` now returns only rows asserting the
// code is GONE, never asserting it as live. Case counts: harness-defaults-validation.test.ts 38->5,
// val-098-harness-defaults.test.ts 6->1 (REQ-088 itself is `superseded-by: REQ-110`, whose live
// acceptance coverage is VAL-121), val-103-effort-real.test.ts 4->2 (the 2 removed cases were the
// only ones touching the retired `defaults.effort` door; the 2 kept are per-call `overrides`/
// `agent(label,{effort})` cases unrelated to it).
export const ERROR_CATALOG = {
  // Generic / cross-cutting
  INVALID_ARGUMENT: { see: null, hint: 'the call did not match its declared inputSchema' },
  INTERNAL_ERROR: { see: null, hint: 'an unclassified engine fault; detail.rawCode carries the original signal when known' },
  FORBIDDEN_ROLE: { see: null, hint: 'the caller\'s role is below the tool\'s minRole' },
  NOT_FOUND: { see: null, hint: 'generic not-found for an entity with no more specific code' },

  // Ownership
  NOT_WORKFLOW_OWNER: { see: null, hint: 'the caller does not own this workflow name' },
  NOT_RUN_OWNER: { see: null, hint: 'the caller does not own this run' },
  NOT_TRIGGER_OWNER: { see: null, hint: 'the caller does not own (did not create) this trigger' },

  // Script / registration authoring (workflow_authoring_guide-pointing)
  PARSE_ERROR: { see: 'workflow_authoring_guide', hint: 'the script body failed to parse as TypeScript' },
  UNKNOWN_ALIAS: { see: 'workflow_authoring_guide', hint: 'a model alias in the script is not in the configured alias table' },
  MCP_NOT_PROVISIONED: { see: 'workflow_authoring_guide', hint: 'an agent() call references an mcp name with no provisioned secret' },
  SCRIPT_INVALID: { see: 'workflow_authoring_guide', hint: 'the script violates a sandbox-enforced structural rule' },
  SCAN_VIOLATION: { see: 'workflow_authoring_guide', hint: 'an agent() call is not scannable — label/options must be literal (ADR-029)' },
  MERMAID_INVALID: { see: 'workflow_authoring_guide', hint: 'the diagram does not parse under checkMermaid\'s grammar' },
  MERMAID_REQUIRED: { see: 'workflow_authoring_guide', hint: 'v24 registration requires a non-empty mermaid diagram string (ADR-025)' },
  DIAGRAM_MISMATCH: { see: 'workflow_authoring_guide', hint: 'the diagram\'s agent labels disagree with the script\'s' },
  AGENT_UNDECLARED: { see: 'workflow_authoring_guide', hint: 'a script agent() label has no params.agents.<label> declaration' },
  AGENT_DECLARED_NOT_IN_SCRIPT: { see: 'workflow_authoring_guide', hint: 'params.agents declares a label no agent() call in the script uses' },
  PARAM_CONTRACT_INVALID: { see: 'workflow_authoring_guide', hint: 'the declared parameter contract itself is malformed or out of its own bounds' },
  PARAM_OUT_OF_RANGE: { see: 'workflow_authoring_guide', hint: 'a declared or overridden parameter value is outside its allowed range' },
  PARAM_LOCKED: { see: 'workflow_authoring_guide', hint: 'a caller override targets a key the author locked (prompt/tools/skills/mcp/workdir/cwd)' },
  PARAM_UNKNOWN: { see: 'workflow_authoring_guide', hint: 'a caller override names a parameter the contract does not declare' },
  UNKNOWN_AGENT_LABEL: { see: 'workflow_authoring_guide', hint: 'a caller override names an agent label the contract does not declare' },
  DEFAULTS_RETIRED: { see: 'workflow_authoring_guide', hint: 'meta.params.knobs / meta.defaults are retired; declare params.agents.<label> instead' },
  LEGACY_REREGISTER: { see: 'workflow_authoring_guide', hint: 'this version predates the v24 contract and cannot run; re-register it' },
  INLINE_SCRIPT_CLOSED: { see: 'workflow_authoring_guide', hint: 'inline run-time scripts are closed; register once, then run by name' },
  NESTING_DEPTH_EXCEEDED: { see: 'workflow_authoring_guide', hint: 'nested workflow() calls exceed the configured maxWorkflowDepth' },
  NESTING_CYCLE: { see: 'workflow_authoring_guide', hint: 'a workflow() call would re-enter an ancestor already on this call\'s chain' },
  DESCENDANT_CAP_EXCEEDED: { see: 'workflow_authoring_guide', hint: 'nested workflow() calls exceed the configured maxWorkflowDescendants' },

  // Registration / versioning / triggers (operational, not authoring content)
  WORKFLOW_NOT_FOUND: { see: null, hint: 'no workflow is registered under this name' },
  WORKFLOW_ALREADY_EXISTS: { see: null, hint: 'a workflow with this name is already registered under a different owner' },
  REGISTRATION_CONFLICT: { see: null, hint: 'a concurrent registration of this name raced this one; retry' },
  VERSION_CEILING_EXCEEDED: { see: null, hint: 'this workflow name already has the configured maxWorkflowVersions; deregister an old one' },
  VERSION_NOT_FOUND: { see: null, hint: 'the requested version is not a registered version of this workflow' },
  INVALID_CHANNEL: { see: null, hint: 'the channel value is not "beta" or "release"' },
  CHANNEL_UNPUBLISHED: { see: null, hint: 'the requested channel has no published version' },
  DANGLING_CHANNEL: { see: null, hint: 'the channel points at a version that no longer exists (invariant violation)' },
  NOT_RUNNABLE: { see: null, hint: 'this version cannot be run (e.g. a legacy or refused registration)' },
  TRIGGER_NOT_FOUND: { see: null, hint: 'no trigger (schedule or webhook) is registered under this id' },
  TRIGGER_ALREADY_CLAIMED: { see: null, hint: 'this trigger id is already claimed by a different workflow' },
  UNCLAIMED: { see: null, hint: 'this trigger has not been claimed by any workflow; it will not fire' },
  CLAIMED_WORKFLOW_MISSING: { see: null, hint: 'the workflow this trigger is claimed by no longer resolves' },
  NOT_IN_RELEASE: { see: null, hint: 'this trigger id is claimed but omitted from the currently released version' },

  // Run lifecycle
  RUN_NOT_FOUND: { see: null, hint: 'no run is recorded under this runId' },
  RUN_NOT_TERMINAL: { see: null, hint: 'this operation requires the run to be in a terminal state' },
  RUN_ADMISSION_LIMIT: { see: null, hint: 'the configured maxConcurrentRuns is already reached' },
  ILLEGAL_TRANSITION: { see: null, hint: 'the requested run-status transition is not allowed from its current state' },
  AGENT_LOG_NOT_FOUND: { see: null, hint: 'no transcript is recorded for this agentId on this run' },
  PARAM_SECRET_UNAVAILABLE: { see: null, hint: 'a resumed run\'s admission-time parameters carry a redaction marker that resume cannot restore' },

  // Workspace / assets / seeds / CAS
  WORKSPACE_ESCAPE: { see: null, hint: 'the resolved path escapes the run or asset workspace root' },
  HOOKS_UNSUPPORTED: { see: null, hint: 'the requested Claude hook is not supported by the sandbox' },
  INVALID_SEED_SPEC: { see: null, hint: 'the seed/seedManifest/seedManifestRef payload does not match its declared shape' },
  SEED_SOURCE_CONFLICT: { see: null, hint: 'more than one of seed/seedManifest/seedRef/seedManifestRef was supplied' },
  MISSING_BLOBS: { see: null, hint: 'one or more referenced blobs are not present in the content store' },
  INVALID_BLOB_REQUEST: { see: null, hint: 'a blob upload/manifest request is malformed' },
  BLOB_HASH_MISMATCH: { see: null, hint: 'the declared sha256 does not match the computed one' },
  BLOB_SHA_MISMATCH: { see: null, hint: 'the declared sha256 does not match the computed one' },
  BLOB_TOO_LARGE: { see: null, hint: 'the blob exceeds the configured maxBlobBytes' },
  BLOB_UPLOAD_TIMEOUT: { see: null, hint: 'the blob upload stalled past the configured idle timeout' },
  CAS_UNAVAILABLE: { see: null, hint: 'this operation requires a configured content store (cas) and none is available' },
  SEEDREF_DISABLED: { see: null, hint: 'seedRef requires seedRefAllowlist in engine config' },
  SEEDREF_ALLOWLIST_INVALID: { see: null, hint: 'the configured seedRefAllowlist itself is malformed' },
  SEEDREF_FETCH_FAILED: { see: null, hint: 'the engine-pull git fetch of the seedRef failed' },
  SEEDREF_SHA_MISMATCH: { see: null, hint: 'the fetched commit sha does not match the requested one' },
  SEEDREF_TOO_LARGE: { see: null, hint: 'the fetched seedRef tree exceeds a configured size bound' },

  // MCP / issues / misc surfaces
  MCP_PROBE_FAILED: { see: null, hint: 'the MCP probe could not reach or validate the configured server' },
  EGRESS_DENIED: { see: null, hint: 'the requested network egress (seedRef repoUrl or MCP server URL) does not match any allowlisted prefix' },
  ISSUE_NOT_FOUND: { see: null, hint: 'no GitHub issue matches this reference' },
} as const satisfies Record<string, { see: 'workflow_authoring_guide' | null; hint: string }>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

/** A branchable Error carrying a `.code` (surfaced to the calling script via the sandbox IPC's code
 *  derivation — see host.ts ipcErrorCode / child-entry). One shared factory so run-manager, cas-store,
 *  and the tools never drift on the coded-error shape. `detail` (v24, DES-137) is attached only when
 *  supplied — the same optional-property convention every caller already uses via `Object.assign`. */
export function codedError(code: ErrorCode, message: string, detail?: Record<string, unknown>): Error & { code: ErrorCode; detail?: Record<string, unknown> } {
  return Object.assign(new Error(message), { code, detail });
}

/** v24 (DES-137): maps an arbitrary thrown-error `.code`-shaped string back to a catalog member —
 *  an unrecognized string (e.g. a raw JS `Error.name` at the one genuinely-string site,
 *  `run-manager.ts`'s `toErr()`) becomes `INTERNAL_ERROR`; the caller attaches `detail.rawCode`. */
export function toErrorCode(code: string): ErrorCode {
  return Object.hasOwn(ERROR_CATALOG, code) ? (code as ErrorCode) : 'INTERNAL_ERROR';
}

/** v24 (DES-137): the one place a thrown `codedError` becomes the wire envelope — `see` is ALWAYS
 *  read from the catalog, never hand-typed at a call site. */
export function toErrEnvelope(err: unknown): { code: ErrorCode; message: string; see: 'workflow_authoring_guide' | null; detail?: Record<string, unknown> } {
  const e = err as { code?: unknown; message?: unknown; detail?: Record<string, unknown> } | null | undefined;
  const code = toErrorCode(typeof e?.code === 'string' ? e.code : '');
  const message = typeof e?.message === 'string' ? e.message : String(err);
  return { code, message, see: ERROR_CATALOG[code].see, detail: e?.detail };
}

export class NotImplementedError extends Error {
  constructor(name: string) {
    super(`${name}: not implemented`);
    this.name = 'NotImplementedError';
  }
}

export class AgentCapError extends Error {
  constructor() {
    super('Agent count cap (1000) exceeded for this run');
    this.name = 'AgentCapError';
  }
}

export class BudgetExceededError extends Error {
  constructor(spent: number, total: number) {
    super(`Budget exceeded: spent ${spent} >= total ${total}`);
    this.name = 'BudgetExceededError';
  }
}

export class IllegalTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Illegal state transition: ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export class CatalogNotFoundError extends Error {
  constructor(name: string) {
    super(`Workflow not found in catalog: ${name}`);
    this.name = 'CatalogNotFoundError';
  }
}

export class WorkspaceEscapeError extends Error {
  constructor(path: string) {
    super(`Path escapes run workspace: ${path}`);
    this.name = 'WorkspaceEscapeError';
  }
}

/** v22 Gate 6.5 simplify: one shared shaper for "a `catalog.resolve()` call at a create-time
 *  ingress (schedule_create, webhook_create) rejected" — `Scheduler.create()` and
 *  `WebhookRegistry.create()` each hand-rolled this same not-found/coded/unknown ladder
 *  (07-review.md §4.2 H4 + §8.1 second site). `extra` carries the one shape difference between the
 *  two call sites (`Scheduler`'s `{field:'workflow'}`). No separate "err isn't an Error" branch:
 *  `resolve()`'s only real implementation (`WorkflowCatalog`) only ever throws `codedError()`
 *  (always an `Error`) or `CatalogNotFoundError` — optional chaining below folds that
 *  never-actually-happens shape into the same line as the coded-error case instead of carrying an
 *  untestable defensive branch for it (Karpathy: no error handling for unrealistic edge cases). */
export function catalogResolveErrorEnvelope(
  err: unknown,
  workflowName: string,
  extra?: Record<string, unknown>,
): { code: string; message: string } & Record<string, unknown> {
  if (err instanceof CatalogNotFoundError) {
    return { code: 'WORKFLOW_NOT_FOUND', message: `Unknown workflow: ${workflowName}`, ...extra };
  }
  const e = err as { code?: unknown; message?: unknown } | null | undefined;
  const code = typeof e?.code === 'string' && e.code ? e.code : 'INTERNAL_ERROR';
  return { code, message: typeof e?.message === 'string' ? e.message : String(err), ...extra };
}
