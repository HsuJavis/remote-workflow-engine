// workflow-view.ts (DES-115, ARCH-075, TASK-110).
// Pure allowlist projection for a catalog row's read surface. The non-owner branch is CONSTRUCTED
// from an explicit field list, never a `delete` on a full row — `script` is returned twice today
// (mcp-facade.ts:220/232), so a delete-based fix would leak the second copy (v21's fragment-leak
// defect verbatim). Pure: no I/O, no auth, no clock — the policy decision (who is the owner) is made
// by the caller (DES-116, TASK-111) and handed in as `viewerIsOwner`.
import type { ScriptCheckError } from './script-checks.js';
import type { DiagramRow } from './workflow-catalog.js';
import type { TriggerBinding } from './trigger-bindings.js';
import { noteTextFor } from './graph-analyzer.js';
import { LOCKED_KEYS } from './params/contract.js';

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

// v23 (DES-125, ARCH-081, TASK-118): the ONE `workflow_describe` response — every principal gets
// the SAME shape (no `viewerIsOwner` parameter: a param that can't change the output eventually
// gets made to). No `script` field exists on the type at all, so a leak is a `tsc` error.
export interface WorkflowDescribeView {
  name: string;
  version: string;
  resolvedBy: 'version' | 'channel' | 'default-release';
  channels: { release: string | null; beta: string | null };
  versions: string[];
  description: string;
  phases: Array<{ title: string }>; // adjudication #1 — public to every principal (DES-136)
  params: unknown; // the REQ-090 contract, already ceiling-bounded
  lockedKeys: readonly string[]; // === LOCKED_KEYS from src/params/contract.ts — imported, never re-typed
  owner: string | null;
  reportProblem: string;
  triggers: TriggerBinding[]; // ALWAYS the live snapshot (DES-128)
  diagram: string | null;
  diagramStatus: 'ready' | 'pending' | 'unavailable';
  diagramNote: string; // noteTextFor(code) — engine-authored
  diagramGeneratedAt: string | null;
  diagramStale: boolean;
}

// Transcribed LITERALLY from WorkflowDescribeView's own field list (same convention as
// EXPECTED_NON_OWNER_KEYS above) — `phases`, `versions`, `triggers` each contribute exactly ONE
// top-level key (the test's own `deepFlatten` does not recurse into arrays).
export const EXPECTED_DESCRIBE_KEYS = [
  'name', 'version', 'resolvedBy',
  'channels', 'channels.release', 'channels.beta',
  'versions', 'description', 'phases',
  'params', 'params.knobs',
  'lockedKeys', 'owner', 'reportProblem', 'triggers',
  'diagram', 'diagramStatus', 'diagramNote', 'diagramGeneratedAt', 'diagramStale',
] as const;

/** DES-125/DES-127: pure — no clock, no I/O, no auth. `ctx.diagram` is the stored row (or null for
 *  "no attempt has ever been written"); `ctx.bindings`/`ctx.bindingsFp` are the LIVE trigger
 *  snapshot (DES-128), always re-computed by the caller, never read off the stored row. */
export function projectWorkflowDescribe(
  full: WorkflowOwnerView,
  ctx: { diagram: DiagramRow | null; bindings: TriggerBinding[]; bindingsFp: string; analyzerEnabled: boolean },
): WorkflowDescribeView {
  const { diagram, bindings, bindingsFp, analyzerEnabled } = ctx;
  const isReady = diagram?.status === 'ready';

  // UT-126 (V-D, send-back `d294880`): a `ready` row's note always stays `''`; otherwise,
  // whenever `analyzerEnabled === false` the note is DISABLED regardless of whether a row exists
  // at all and regardless of what it persists — analyzerEnabled must win before any persisted
  // noteCode is consulted, not only on the `diagram === null` branch.
  let diagramNote: string;
  if (isReady) {
    diagramNote = '';
  } else if (!analyzerEnabled) {
    diagramNote = noteTextFor('DISABLED');
  } else if (diagram === null) {
    // B2: no row at all, analyzer on — NOT_GENERATED (no attempt yet), never persisted,
    // synthesized here only.
    diagramNote = noteTextFor('NOT_GENERATED');
  } else if (diagram.status === 'unavailable' && diagram.noteCode) {
    diagramNote = noteTextFor(diagram.noteCode);
  } else {
    diagramNote = '';
  }

  return {
    name: full.name,
    version: full.version,
    resolvedBy: full.resolvedBy ?? 'default-release',
    channels: { release: full.channels['release'] ?? null, beta: full.channels['beta'] ?? null },
    versions: full.versions,
    description: full.description ?? '',
    phases: (full.phases as Array<{ title: string }> | undefined) ?? [],
    params: full.params,
    lockedKeys: LOCKED_KEYS,
    owner: full.owner,
    reportProblem: full.reportProblem,
    triggers: bindings,
    diagram: isReady ? diagram.diagram : null,
    diagramStatus: diagram?.status ?? 'unavailable',
    diagramNote,
    // B3: only a `ready` row ever carries a stamp — a swept `pending` row's own `generated_at` is
    // the boot sweep's ATTEMPT marker, not a generation timestamp, and must not leak as one.
    diagramGeneratedAt: isReady ? diagram.generatedAt : null,
    diagramStale: isReady && bindingsFp !== diagram.bindingsFp,
  };
}
