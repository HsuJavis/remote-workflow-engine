// Domain error types. Implemented fully — pure value classes, no business logic.
import { MARKER_PREFIX, redact } from './secret-resolver.js';
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
  // v24 Gate 8 (AF-3, TASK-162): `authz.ts`'s loopback-exempt refusal — a caller reaching a tool
  // that needs an identity over a connection that carries none. It was DECLARED in
  // `AuthzErrorCode` and RETURNED by `authorize()` while missing here, so `call-tool.ts:136`
  // (`verdict.code ?? 'FORBIDDEN_ROLE'` — the fallback only covers a verdict with no code at all)
  // put an uncatalogued string on the wire. `see: null` like its role/ownership siblings: the fix
  // is to authenticate, which is a deployment matter, not an authoring one.
  PRINCIPAL_REQUIRED: { see: null, hint: 'this tool requires an authenticated principal; the caller supplied none' },
  // v24 adjudication #6 F-3 (D-14, REQ-116): thrown from the REGISTRATION path (mcp-facade.ts:313)
  // when a registration declares a trigger someone else created. REQ-116 requires a registration
  // that fails on trigger to point at the guide, and does not carve ownership out of "trigger" —
  // the guide is where the create-then-claim lifecycle is explained.
  NOT_TRIGGER_OWNER: { see: 'workflow_authoring_guide', hint: 'the caller does not own (did not create) this trigger' },

  // Script / registration authoring (workflow_authoring_guide-pointing)
  PARSE_ERROR: { see: 'workflow_authoring_guide', hint: 'the script body failed to parse as TypeScript' },
  UNKNOWN_ALIAS: { see: 'workflow_authoring_guide', hint: 'a model alias in the script is not in the configured alias table' },
  MCP_NOT_PROVISIONED: { see: 'workflow_authoring_guide', hint: 'an agent() call references an mcp name with no provisioned secret' },
  SCRIPT_INVALID: { see: 'workflow_authoring_guide', hint: 'the script violates a sandbox-enforced structural rule' },
  SCAN_VIOLATION: { see: 'workflow_authoring_guide', hint: 'an agent() call is not scannable — label/options must be literal (ADR-029)' },
  MERMAID_INVALID: { see: 'workflow_authoring_guide', hint: 'the diagram does not parse under checkMermaid\'s grammar' },
  MERMAID_REQUIRED: { see: 'workflow_authoring_guide', hint: 'v24 registration requires a non-empty mermaid diagram string (ADR-025)' },
  DIAGRAM_MISMATCH: { see: 'workflow_authoring_guide', hint: 'the diagram\'s agent labels disagree with the script\'s' },
  // v26 (DES-184, ARCH-119, ADR-043/039, TASK-189): checkMermaid v2 — four rules compared against
  // the script's own derived ExpectedGraph (lane/slot/edge shape), each carrying {rule, line, expected}.
  DIAGRAM_DIRECTION: { see: 'workflow_authoring_guide', hint: 'a v2 diagram header must be graph LR / flowchart LR' },
  LANE_MISMATCH: { see: 'workflow_authoring_guide', hint: 'the diagram\'s subgraph lanes (count/order/title, or a stadium\'s containing lane) disagree with the script\'s phases' },
  TOOLS_MISMATCH: { see: 'workflow_authoring_guide', hint: 'a stadium\'s tools: line disagrees with the script\'s allowedTools for that label' },
  EDGE_MISMATCH: { see: 'workflow_authoring_guide', hint: 'the diagram\'s edges do not realise the script\'s consecutive-slot flow' },
  // v26 integration (DES-184 boundary, REQ-128, REQ-117): `deriveExpectedGraph`'s one refusal.
  // Registration must answer this with its OWN line-pointed code, because a bare SCAN_VIOLATION
  // fails REQ-117's first-try bar — an author told only "scan violation" cannot find the phase().
  // v26 (M-5 send-back repair, ARCH-119/121's catalog drift-lock): `UNDECIDABLE_SHAPE` — a second,
  // speculative union arm — was deleted here, from the `DeriveResult` type ARCH-113 defines and from
  // `workflow_register`'s advertised `errors[]` (tool-specs.ts), together: it had ZERO producers
  // (`grep -rn UNDECIDABLE_SHAPE src/` found only the three declarations), and ADR-039's own
  // decision already routes every narrowing case it would have covered (a `switch`, a loop-body
  // `agent()`, a helper-reached `agent()`) through the EXISTING `SCAN_VIOLATION` — advertising a
  // code the checker can never emit is a branch a client may implement and never exercise.
  AGENT_BEFORE_PHASE: { see: 'workflow_authoring_guide', hint: 'under the v2 diagram contract every agent() must be dispatched inside a phase() — add a phase() before the first agent()' },
  AGENT_UNDECLARED: { see: 'workflow_authoring_guide', hint: 'a script agent() label has no params.agents.<label> declaration' },
  AGENT_DECLARED_NOT_IN_SCRIPT: { see: 'workflow_authoring_guide', hint: 'params.agents declares a label no agent() call in the script uses' },
  PARAM_CONTRACT_INVALID: { see: 'workflow_authoring_guide', hint: 'the declared parameter contract itself is malformed or out of its own bounds' },
  PARAM_OUT_OF_RANGE: { see: 'workflow_authoring_guide', hint: 'a declared or overridden parameter value is outside its allowed range' },
  PARAM_LOCKED: { see: 'workflow_authoring_guide', hint: 'a caller override targets a key the author locked (prompt/allowedTools/skills/mcp/workdir/cwd)' },
  PARAM_UNKNOWN: { see: 'workflow_authoring_guide', hint: 'a caller override names a parameter the contract does not declare' },
  UNKNOWN_AGENT_LABEL: { see: 'workflow_authoring_guide', hint: 'a caller override names an agent label the contract does not declare' },
  DEFAULTS_RETIRED: { see: 'workflow_authoring_guide', hint: 'meta.params.knobs / meta.defaults are retired; declare params.agents.<label> instead' },
  LEGACY_REREGISTER: { see: 'workflow_authoring_guide', hint: 'this version predates the v24 contract and cannot run; re-register it' },
  INLINE_SCRIPT_CLOSED: { see: 'workflow_authoring_guide', hint: 'inline run-time scripts are closed; register once, then run by name' },
  // v37 Gate-8 send-back (finding C-1, ARCH-181/ARCH-182): `call-tool.ts`'s remote-submission door
  // (ADR-083 owner_decision posture C) throws this code BEFORE schema/authz, same precedent as
  // INLINE_SCRIPT_CLOSED above — a real, remotely-reachable refusal is uncatalogued (invisible to
  // any cold MCP client reading `tools/list`/ERROR_CATALOG) unless it is a key here too.
  // v37 P1 (ADR-086's third owner ruling, 2026-09-25, DES-263's 第三次修訂): the hint used to end
  // "(a local/loopback submission still runs, unconfined)" — no longer true. A local run_start of
  // a REMOTELY-REGISTERED script is refused identically; only a submission that is local AND
  // resolves to a locally-registered script still runs unconfined.
  CONFINEMENT_UNAVAILABLE: { see: 'workflow_authoring_guide', hint: "this host could not measure a working Bash sandbox at boot; a run is refused when EITHER its trigger's provenance OR its resolved script version's registering submission is remote — a remote run_start/run_resume, a webhook delivery or schedule firing whose trigger was created remotely, or ANY run (including a local one) resolving to a version registered remotely" },
  NESTING_DEPTH_EXCEEDED: { see: 'workflow_authoring_guide', hint: 'nested workflow() calls exceed the configured maxWorkflowDepth' },
  NESTING_CYCLE: { see: 'workflow_authoring_guide', hint: 'a workflow() call would re-enter an ancestor already on this call\'s chain' },
  DESCENDANT_CAP_EXCEEDED: { see: 'workflow_authoring_guide', hint: 'nested workflow() calls exceed the configured maxWorkflowDescendants' },

  // Registration / versioning / triggers (operational, not authoring content)
  WORKFLOW_NOT_FOUND: { see: null, hint: 'no workflow is registered under this name' },
  WORKFLOW_ALREADY_EXISTS: { see: null, hint: 'a workflow with this name is already registered under a different owner' },
  REGISTRATION_CONFLICT: { see: null, hint: 'a concurrent registration of this name raced this one; retry' },
  VERSION_CEILING_EXCEEDED: { see: null, hint: 'this workflow name already has the configured maxWorkflowVersions; deregister an old one with workflow_deregister({name, version})' },
  VERSION_NOT_FOUND: { see: null, hint: 'the requested version is not a registered version of this workflow' },
  // v36 (DES-246, TASK-244): `workflow_deregister({name, version})`'s three version-scoped refusals.
  VERSION_PINNED_BY_CHANNEL: { see: null, hint: 'this version is published to a channel (release or beta) — unpublish it first' },
  VERSION_LAST_REMAINING: { see: null, hint: 'this is the only version of the workflow — use workflow_deregister({name}) to remove the whole workflow' },
  VERSION_PINNED_BY_RUN: { see: null, hint: 'a non-terminal run is pinned to this version' },
  INVALID_CHANNEL: { see: null, hint: 'the channel value is not "beta" or "release"' },
  CHANNEL_UNPUBLISHED: { see: null, hint: 'the requested channel has no published version' },
  DANGLING_CHANNEL: { see: null, hint: 'the channel points at a version that no longer exists (invariant violation)' },
  NOT_RUNNABLE: { see: null, hint: 'this version cannot be run (e.g. a legacy or refused registration)' },
  INVALID_CRON: { see: null, hint: 'the cron expression is not a valid 5-field expression' },
  INVALID_AT: { see: null, hint: 'the one-shot `at` value is not a parseable ISO timestamp' },
  // v24 adjudication #6 F-3 (D-14, REQ-116): both are registration-path refusals
  // (mcp-facade.ts:308/322) — see NOT_TRIGGER_OWNER above.
  TRIGGER_NOT_FOUND: { see: 'workflow_authoring_guide', hint: 'no trigger (schedule or webhook) is registered under this id' },
  TRIGGER_ALREADY_CLAIMED: { see: 'workflow_authoring_guide', hint: 'this trigger id is already claimed by a different workflow' },
  UNCLAIMED: { see: null, hint: 'this trigger has not been claimed by any workflow; it will not fire' },
  CLAIMED_WORKFLOW_MISSING: { see: null, hint: 'the workflow this trigger is claimed by no longer resolves' },
  NOT_IN_RELEASE: { see: null, hint: 'this trigger id is claimed but omitted from the currently released version' },

  // Run lifecycle
  RUN_NOT_FOUND: { see: null, hint: 'no run is recorded under this runId' },
  RUN_NOT_TERMINAL: { see: null, hint: 'this operation requires the run to be in a terminal state' },
  RUN_ADMISSION_LIMIT: { see: null, hint: 'the configured maxConcurrentRuns is already reached' },
  ILLEGAL_TRANSITION: { see: null, hint: 'the requested run-status transition is not allowed from its current state' },
  AGENT_LOG_NOT_FOUND: { see: null, hint: 'no transcript is recorded for this agentId on this run' },
  // v25 (DES-167, REQ-120, issue #61): the budget refusal finally has a CODE. It was thrown by
  // `RunGuard` since v1 as a bare `BudgetExceededError` whose class NAME reached the wire (the same
  // defect v24 fixed for IllegalTransitionError/CatalogNotFoundError/WorkspaceEscapeError), and
  // `parallel()` swallowed it to `null` on the way, so a refused dispatch left no code, no record
  // and no event. `see` points at the guide because REQ-120 requires the guide to explain how a
  // budget interacts with fan-out width — the refusal is now self-documenting.
  BUDGET_EXCEEDED: { see: 'workflow_authoring_guide', hint: 'the run\'s token budget is spent; the engine refused to dispatch this agent() call' },
  PARAM_SECRET_UNAVAILABLE: { see: null, hint: 'a resumed run\'s admission-time parameters carry a redaction marker that resume cannot restore' },

  // Workspace / assets / seeds / CAS
  WORKSPACE_ESCAPE: { see: null, hint: 'the resolved path escapes the run or asset workspace root' },
  RESERVED_PREFIX: { see: 'workflow_authoring_guide', hint: "the name or a path segment starts with the engine-reserved 'rwe-' prefix (ARCH-093)" },
  HOOKS_UNSUPPORTED: { see: null, hint: 'the requested Claude hook is not supported by the sandbox' },
  // v26 (DES-170, TASK-175, issue #64): now guide-pointing — a caller reading tools/list's item
  // schemas needs the same door to workflow_authoring_guide the other authoring refusals get.
  INVALID_SEED_SPEC: { see: 'workflow_authoring_guide', hint: 'the seed/seedManifest/seedManifestRef payload does not match its declared shape' },
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
  /** v25 (DES-167, REQ-120): carries the catalog code, so `ipcErrorCode`/`toErrEnvelope` surface
   *  `BUDGET_EXCEEDED` instead of the class name — same fix, same reason, as the three v24 classes
   *  below. A script catching it reads `e.code`/`e.name === 'BUDGET_EXCEEDED'`. */
  readonly code: ErrorCode = 'BUDGET_EXCEEDED';
  /** v26 (DES-181, ARCH-118, TASK-181): which of the two independent limits (`usd`/`tokens`) was
   *  hit — absent on the pre-v26 positional form (kept for `sandbox-refusal-error-code.test.ts`,
   *  which only needs A BudgetExceededError instance, not a real limit). */
  readonly limit?: 'usd' | 'tokens';
  readonly spent: number;
  readonly total: number;
  constructor(spentOrDetail: number | { limit: 'usd' | 'tokens'; spent: number; total: number }, total?: number) {
    if (typeof spentOrDetail === 'number') {
      super(`Budget exceeded: spent ${spentOrDetail} >= total ${total}`);
      this.spent = spentOrDetail;
      this.total = total as number;
    } else {
      super(`Budget exceeded (${spentOrDetail.limit}): spent ${spentOrDetail.spent} >= total ${spentOrDetail.total}`);
      this.limit = spentOrDetail.limit;
      this.spent = spentOrDetail.spent;
      this.total = spentOrDetail.total;
    }
    this.name = 'BudgetExceededError';
  }
}

// v24 (integrator, DES-137 + adjudication #4 C-1/[31]): these three pre-v24 Error CLASSES predate
// `ERROR_CATALOG` and carried no `.code`, so every envelope built from them (`toErrEnvelope` falls
// back to `err.name`) surfaced `IllegalTransitionError` / `CatalogNotFoundError` /
// `WorkspaceEscapeError` as the machine-readable code — three names that are not members of the
// closed `ErrorCode` union and that no `tools/list` reader can ever anticipate. Verified live by
// the REQ-118 table: `run_suspend` on a terminal run answered `IllegalTransitionError` while its
// own advertised `errors[]` promises `ILLEGAL_TRANSITION`. Attaching the catalog code at the ONE
// place each class is constructed fixes every call site at once and cannot drift, which is why the
// fix is here and not in each of the (nine + n) throw sites.
export class IllegalTransitionError extends Error {
  readonly code: ErrorCode = 'ILLEGAL_TRANSITION';
  constructor(from: string, to: string) {
    super(`Illegal state transition: ${from} → ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export class CatalogNotFoundError extends Error {
  readonly code: ErrorCode = 'WORKFLOW_NOT_FOUND';
  constructor(name: string) {
    super(`Workflow not found in catalog: ${name}`);
    this.name = 'CatalogNotFoundError';
  }
}

export class WorkspaceEscapeError extends Error {
  readonly code: ErrorCode = 'WORKSPACE_ESCAPE';
  constructor(path: string) {
    super(`Path escapes run workspace: ${path}`);
    this.name = 'WorkspaceEscapeError';
  }
}

// v35 (DES-230, ARCH-141, TASK-236, REQ-205): `toErr` moved VERBATIM from `run-manager.ts:150`
// (behaviour byte-identical) and exported, so both of `run-manager.ts`'s call sites (the dispatch
// outcome and the nested-`workflow()` outcome) import the SAME function instead of each keeping a
// private copy. Deliberately gains no `detail` forwarding and no bound of its own — see
// DES-230's `owner_decision` (REQ-205's 4th acceptance criterion is out of scope this iteration).
export function toErr(err: unknown): { code: string; message: string } {
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    return { code: String((err as { code: unknown }).code), message: String((err as { message: unknown }).message) };
  }
  if (err instanceof Error) return { code: err.name || 'SCRIPT_ERROR', message: err.message };
  return { code: 'SCRIPT_ERROR', message: String(err) };
}

/** v35 (DES-230): the pre-eval bound moved off `toErr` (which stays total/unbounded) onto the
 *  SERIALIZED envelope that is actually persisted — `message` is `String(err.message)` off a
 *  script-thrown value and is the one unbounded, script-controlled string this slice newly writes
 *  to disk (`code` is bounded by construction: it comes from `toErrorCode`/the IPC wire, never
 *  from script text). */
export const MAX_ERROR_ENVELOPE_BYTES = 4096;

/** v35 send-back (C-2): the forward extension below (to complete a marker split by the cut) must
 *  itself be bounded — a marker's NAME is config-time (set by whoever configures a secret), so it
 *  is legitimately bounded, but the `›` the old code scanned for was found via
 *  `e.message.indexOf('›', markerStart)` against the REST of a script-controlled message with no
 *  end bound: a crafted thrown Error with a `‹secret:` look-alike near the cut and no real `›`
 *  anywhere close by made the scan (and the resulting persisted string) grow with the ENTIRE
 *  remainder of the message — unbounded, demonstrated at ~50MB from a single throw. 256 bytes is
 *  generous for any real secret name (env-var-style identifiers are a few dozen chars at most). */
export const MAX_SECRET_NAME_CHARS = 256;

/** Bounds `e.message` to `MAX_ERROR_ENVELOPE_BYTES`. MUST run AFTER `redact()`, never before: a
 *  substring cut applied to the RAW message first can split a secret so `redact()`'s value-exact
 *  match finds neither half (R-G9, `agent-executor.ts:662-671`, INV-V26-5). Identity when under
 *  bound; `code` is never truncated. The cut is utf8-safe — it never splits a multi-byte
 *  character, AND it never splits a `redact()` marker (`‹secret:NAME›`) that already survived the
 *  redaction pass — a naive byte cut landing inside one leaves a mangled, unrecognizable fragment
 *  where the caller depends on an INTACT marker surviving (`hasSecretMarker`, and any reader
 *  looking for `‹secret:NAME›` verbatim) (v35 GREEN-phase fix: found via the ordering test,
 *  `errors-to-err.test.ts`). If the UTF-8-safe head opens a marker it does not also close, the cut
 *  extends forward just far enough to include the marker's closing `›` — bounded to at most
 *  `MARKER_PREFIX.length + MAX_SECRET_NAME_CHARS` past the marker's start (v35 send-back C-2: NOT
 *  an unbounded scan of the rest of the message), unlike backing off and dropping the marker, which
 *  would satisfy the byte bound while breaking the one thing this function's caller reads the
 *  message FOR. Both the pathological case (no closing `›` anywhere, which `redact()` never
 *  produces) AND the case where `›` exists but only past the bounded window still back off,
 *  dropping the incomplete marker, rather than shipping a mangled fragment or scanning unbounded. */
export function capErrorEnvelope(e: { code: string; message: string }, maxBytes: number = MAX_ERROR_ENVELOPE_BYTES): { code: string; message: string } {
  const buf = Buffer.from(e.message, 'utf8');
  if (buf.length <= maxBytes) return e;
  let cut = maxBytes;
  // back off while `cut` sits inside a multi-byte sequence — a UTF-8 continuation byte's top two
  // bits are `10`.
  while (cut > 0 && (buf[cut]! & 0xc0) === 0x80) cut--;
  let head = buf.subarray(0, cut).toString('utf8');
  // Anchor on the marker's opening glyph alone (`‹`), not the 8-char `MARKER_PREFIX` — the cut can
  // land inside the PREFIX itself (e.g. after `‹se`), and `lastIndexOf(MARKER_PREFIX)` would then
  // find nothing and silently drop the marker instead of completing it.
  const glyphStart = head.lastIndexOf('‹');
  const markerStart = glyphStart !== -1 && e.message.startsWith(MARKER_PREFIX, glyphStart) ? glyphStart : -1;
  if (markerStart !== -1 && !head.slice(markerStart).includes('›')) {
    // Bounded forward scan (v35 send-back C-2): look for the closing `›` only within
    // MARKER_PREFIX.length + MAX_SECRET_NAME_CHARS chars of the marker's start, never further.
    const scanEnd = markerStart + MARKER_PREFIX.length + MAX_SECRET_NAME_CHARS;
    const window = e.message.slice(markerStart, scanEnd + 1); // +1 to include the closing glyph itself
    const relClose = window.indexOf('›');
    const closeIdx = relClose === -1 ? -1 : markerStart + relClose;
    head = closeIdx === -1 ? head.slice(0, markerStart) : e.message.slice(0, closeIdx + 1);
    cut = Buffer.byteLength(head, 'utf8');
  }
  const omitted = buf.length - cut;
  return { code: e.code, message: `${head}… [truncated: ${omitted} bytes omitted]` };
}

/** v36 (DES-241, ARCH-169/170, TASK-239, REQ-216/K2): one pure capture — redact THEN bound, in
 *  that order (INV-V26-5: a substring cut applied first can split a secret so redact()'s
 *  value-exact match finds neither half). `maxBytes` is a parameter, not shared constant, because
 *  the two pre-existing call sites never agreed on one (4096 at the envelope site, 200 at the
 *  seedRef site) — unifying either would silently widen or narrow the other twentyfold. */
export function captureFailure(
  err: unknown,
  secrets: ReadonlyArray<{ name: string; value: string }>,
  maxBytes: number = MAX_ERROR_ENVELOPE_BYTES,
): { code: string; message: string } {
  return capErrorEnvelope(redact(toErr(err), secrets) as { code: string; message: string }, maxBytes);
}

