// WorkflowCatalog (DES-011 / ARCH-007): named registry + per-workflow/per-run workspace rooting.
//
// Persistence (D-V2, REQ-014): registrations (name/version/script/createdAt) are stored in a
// SQLite DB rooted at workRoot (`catalog.db`, alongside the run store's own on-disk DB) so a
// fresh WorkflowCatalog instance pointed at the same workRoot — e.g. after a server restart —
// sees every previously-registered workflow. Per-name version numbering (register bumps the
// existing row's version) replaced the old in-memory global counter; nothing in this codebase
// depends on version numbers being globally unique across names, only on them changing on update.
//
// Retention/cleanup policy (TASK-016, DES-011 "documented retention/cleanup governs old run
// workspaces"): run workspaces (`workFolder(name)/runs/<runId>`) are retained on disk indefinitely
// by default — a completed run's produced files must stay retrievable (REQ-013) and no test in this
// v1 slice requires automatic deletion. Operators may prune workspace directories for runs that are
// no longer `queued`/`running`/`suspended` (safe to remove once RunStore shows a terminal status);
// this is a manual/ops-owned action, not an in-process timer, keeping the kernel free of unproven
// background-deletion logic.
import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { join, resolve, sep, isAbsolute } from 'node:path';
import { CatalogNotFoundError, WorkspaceEscapeError, codedError, ERROR_CATALOG, type ErrorCode } from './errors.js';
import { parseMeta, parseMetaParams, parseWorkflowSkeleton, checkMetaPhases } from './workflow-meta.js';
// v26 integration (REQ-128, DES-184/DES-174, ADR-048): the registration half of "one derivation,
// two consumers" — the SAME `deriveExpectedGraph` the run-DAG layout uses. ADR-048 put
// `skeleton-graph.ts` on ADR-022's internal-module allowlist for exactly this call site: the only
// thing it projects is the `expected:` block of a refusal, returned to the author who just
// submitted that script.
import { deriveExpectedGraph } from './skeleton-graph.js';
// Issue #91: the SAME literal `path-verdict.ts`'s asset-tree check refuses a reserved-prefix path
// segment with — reused, not re-typed, so the two checks can never drift on what "reserved" means.
import { RESERVED_PREFIX, isValidBareName } from './path-verdict.js';
import { isPathContained } from './path-containment.js';
import { scanAgentCalls, type AgentCallViolationCode } from './scan-agent-calls.js';
import { checkMermaid, type Rule } from './check-mermaid.js';
import type { Clock } from './clock.js';
import { createEventSink, type EventSink } from './event-log.js';
import { SystemClock } from './clock.js';
// v21 Gate 6 adjudication (A-1): type-only import — erases at compile, no runtime edge, and this
// file is not one the sandbox child loads, so the .js->.ts child-import hazard does not apply.
// Bars a VALUE import only (which would drag the validator into a module the catalog stays
// independent of); typing get()/getFull()'s `params` as ParamContract|undefined instead of
// `unknown` is the point of the adjudication; list() carries the same typing.
import type { ParamContract, AgentParamSpec, Ceilings, ModelRefWarning } from './params/contract.js';
import { EMPTY_MODEL_CATALOG, parseModelRef, type ModelCatalogSnapshot } from './providers.js';
import { piUnsupportedToolNames } from './harness-info.js';
// v22 (DES-111, DES-112, TASK-107): the lifted, pure registration-enforcement checks (TASK-106) —
// same codes submission used to produce, so no caller learns a new vocabulary (ADR-013).
import { validateScriptEntry } from './script-checks.js';

// v23 (DES-130, DES-123): the eight note codes the store actually persists — DISABLED/NOT_GENERATED
// are read-time-synthesized only (never written), so the full ten-value DiagramNoteCode (TASK-117)
// is deliberately not reused here.
export type PersistedDiagramNoteCode =
  | 'TIMEOUT' | 'PROVIDER_UNREACHABLE' | 'PROVIDER_ERROR'
  | 'GATE_REJECTED_CONTENT' | 'GATE_REJECTED_SHAPE'
  | 'QUEUE_FULL' | 'RETRIES_EXHAUSTED' | 'MODEL_UNMAPPED';

export interface DiagramRow {
  name: string; version: string;
  status: 'pending' | 'ready' | 'unavailable';
  diagram: string | null;
  noteCode: PersistedDiagramNoteCode | null;
  generatedAt: string | null;
  bindingsFp: string | null;
}

// v26 (DES-184, ARCH-119, ADR-043, TASK-189): the TOTAL map from every `checkMermaid` rule to the
// `ErrorCode` `validateRegistration` throws — replaces the two-way
// `onlyInScript/onlyInDiagram !== undefined ? 'DIAGRAM_MISMATCH' : 'MERMAID_INVALID'` ternary this
// module used to hide every OTHER rule's code decision behind. `satisfies Record<Rule, ErrorCode>`
// IS the "never" exhaustiveness check the design calls for: a new `Rule` member added to
// check-mermaid.ts without a matching key here is a compile error, not a silent MERMAID_INVALID.
// The three pre-existing "strays" (no distinct code of their own — genuinely unparsable shapes) map
// to MERMAID_INVALID EXPLICITLY — a named, greppable decision instead of the ternary's silence;
// DIAGRAM_SCRIPT_MISMATCH keeps its existing DIAGRAM_MISMATCH mapping; the four v2 rules are real
// ERROR_CATALOG rows and self-map.
// issue #155 B2a (owner-approved, 2026-10-07): `VALUE_MISMATCH`/`COLLAPSED_EDGE` PROMOTED out of the
// strays above — both used to fold into MERMAID_INVALID, which a code-branching client could not
// tell apart from a genuinely unparsable diagram. They are now real ERROR_CATALOG rows (errors.ts)
// and self-map here, same treatment as the four v2 rules.
export const RULE_CODE = {
  SIZE: 'MERMAID_INVALID',
  SUBGRAPH_TITLE: 'MERMAID_INVALID',
  MERMAID_INVALID: 'MERMAID_INVALID',
  DUPLICATE_NODE: 'MERMAID_INVALID',
  COLLAPSED_EDGE: 'COLLAPSED_EDGE',
  UNDECLARED_NODE: 'MERMAID_INVALID',
  AGENT_LABEL_FORMAT: 'MERMAID_INVALID',
  DIAGRAM_SCRIPT_MISMATCH: 'DIAGRAM_MISMATCH',
  VALUE_MISMATCH: 'VALUE_MISMATCH',
  LOOP_LABEL: 'MERMAID_INVALID',
  DIAGRAM_DIRECTION: 'DIAGRAM_DIRECTION',
  LANE_MISMATCH: 'LANE_MISMATCH',
  TOOLS_MISMATCH: 'TOOLS_MISMATCH',
  EDGE_MISMATCH: 'EDGE_MISMATCH',
} as const satisfies Record<Rule, ErrorCode>;

// v22 (DES-110): the total, pure resolution truth table — explicit `version` wins over any
// `channel` (REQ-097 "regardless of any channel"); a NULL channel pointer is CHANNEL_UNPUBLISHED,
// NEVER a fallback to the newest row (ADR-009). One caller (resolve()) — kept in this module rather
// than a separate file per DES-110.
export type Channel = 'beta' | 'release';
export interface Channels { release: string | null; beta: string | null }
export interface VersionSelector { version?: string; channel?: Channel }
// v24 (DES-137): constrained to the closed ErrorCode union at its declaration.
export type ResolveErrorCode = Extract<ErrorCode, 'INVALID_CHANNEL' | 'VERSION_NOT_FOUND' | 'CHANNEL_UNPUBLISHED' | 'DANGLING_CHANNEL'>;
export type RequestShape = { kind: 'version'; version: string } | { kind: 'channel'; channel: Channel } | { kind: 'default-release' };

export function resolveVersionRequest(
  sel: VersionSelector,
  ch: Channels,
  known: ReadonlySet<string>,
):
  | { ok: true; version: string; requested: RequestShape }
  | { ok: false; code: ResolveErrorCode; channel?: Channel; version?: string } {
  // Row 1: an out-of-range channel value is refused before anything else is consulted — the raw
  // selector may carry any string across the MCP boundary, regardless of the compile-time Channel type.
  if (sel.channel !== undefined && sel.channel !== 'beta' && sel.channel !== 'release') {
    return { ok: false, code: 'INVALID_CHANNEL', channel: sel.channel };
  }
  // Rows 2-3: an explicit version always wins over any channel.
  if (sel.version !== undefined) {
    if (known.has(sel.version)) {
      return { ok: true, version: sel.version, requested: { kind: 'version', version: sel.version } };
    }
    return { ok: false, code: 'VERSION_NOT_FOUND', version: sel.version };
  }
  // Rows 4-5: named channel.
  if (sel.channel !== undefined) {
    const pointer = ch[sel.channel];
    if (pointer === null) return { ok: false, code: 'CHANNEL_UNPUBLISHED', channel: sel.channel };
    if (!known.has(pointer)) return { ok: false, code: 'DANGLING_CHANNEL', channel: sel.channel }; // unreachable invariant
    return { ok: true, version: pointer, requested: { kind: 'channel', channel: sel.channel } };
  }
  // Rows 6-7: no selector at all — default release.
  if (ch.release === null) return { ok: false, code: 'CHANNEL_UNPUBLISHED', channel: 'release' };
  return { ok: true, version: ch.release, requested: { kind: 'default-release' } };
}

// v22 (DES-111): VersionEntry is the ONE execution read; WorkflowDetail is the ONE read read
// (REPLACES getFull()).
export interface VersionEntry {
  script: string;
  version: string;
  /** v24 (D-8, REQ-111/DES-156): the author-supplied Mermaid diagram, verbatim; `null` on a legacy
   *  row registered before ADR-025 required one (`mermaidNote:'LEGACY_NO_DIAGRAM'` downstream). */
  mermaid: string | null;
  params?: ParamContract;
  /** v24 (integrator; DES-150): the trigger ids this VERSION declares — the fire path's
   *  NOT_IN_RELEASE check needs "does the currently-released version still list this trigger", and
   *  the column had no reader before this. Absent when the version declares none. */
  triggers?: string[];
  /** v26 (DES-184, ARCH-119, TASK-189): `'v1'` for a NULL (pre-v26) row, `'v2'` for every row
   *  `insertVersion` writes from here on — a grandfathered row is never re-checked with `v2`. */
  diagramContract: 'v1' | 'v2';
  /** v37 P1 (ADR-086's third owner ruling, 2026-09-25, DES-263's 第三次修訂): who registered THIS
   *  version — written once by `insertVersion` from `ToolDeps.isRemoteSubmission`, never updated
   *  (a version row is immutable). Read by `RunManager.start()`'s second admission stage and by
   *  `runNested()`, OR'd against the trigger's own immutable `createdRemote`
   *  (`admissionRefusal`'s two-source rule). `false` on every pre-v37 row (grandfathered local). */
  registeredRemote: boolean;
  /** Issue #82 (option B): the version's DEFAULT seed — a CAS manifest ref bound at registration
   *  (`workflow_register({seedManifestRef})`), plus the CAS namespace the registrant proved
   *  possession of it in. `RunManager.start()` materializes it for a run that brings no seed of
   *  its own. Both absent on a version registered without one (and on every pre-#82 row). */
  seedManifestRef?: string;
  seedNamespace?: string;
  // issue #154 B5 (2026-10-07 reverify): THIS version's own registration timestamp — `insertVersion`
  // has always written a fresh `this._clock.isoNow()` into `workflow_versions.createdAt` on every
  // call, but no reader ever selected it; `resolveDetail` instead relabeled the WORKFLOW-level
  // `workflows.createdAt` (set once, on the name's first registration) as the resolved VERSION's
  // createdAt, so every version of a workflow reported the same birth time forever.
  createdAt: string;
}
export interface WorkflowDetail extends VersionEntry {
  name: string; owner: string | null; channels: Channels; versions: string[];
}

// v36 (DES-244, ARCH-157/158/161, TASK-242, REQ-212/REQ-114): `Actor` replaces the overloaded
// `principal: string|null` on the three mutating methods (validateRegistration/insertVersion,
// publish) — minted PER CALL SITE by `mcp-facade.ts`'s `actorFor`, never per-Principal, so an
// admin's ownership bypass on `deregister`/`publish` cannot silently leak onto `register`
// (R-1). `canMutate` is the TRUTHY form (`!owner`, not `owner === null`) because the legacy gate
// tests `row.owner` for truthiness and `owner === ''` is reachable on a pre-v15 row.
export interface Actor { id: string | null; bypass: boolean; idSource: 'authenticated' | 'claimed' | 'none' }
export function canMutate(owner: string | null, actor: Actor): boolean {
  return !owner || actor.bypass || owner === actor.id;
}
/** A legacy `principal: string|null` caller (every pre-v36 direct test/caller of
 *  validateRegistration/insertVersion/publish) reproduced as an `Actor`: `null` was ALWAYS a full
 *  ownership bypass (the gate's `principal !== null` term), a non-null principal was never a
 *  bypass and compared by identity — `canMutate` on either input is byte-identical to the old
 *  inline expression.
 *  Gate-8 send-back (h): this fallback maps ANY non-null string straight to
 *  `idSource:'authenticated'` — it is reachable ONLY from direct/legacy callers (a test or a
 *  pre-v36-shaped caller passing `principal` instead of a minted `Actor`), never from the
 *  production facade path (`mcp-facade.ts`'s `actorFor` always mints its own `idSource` via
 *  `idSourceOf`, DES-244). Do not read this as "any self-declared identity is audit-attested" —
 *  it manufactures no such guarantee; it only reproduces what the pre-v36 `principal` shape meant.
 *  v38 (issue #100 owner ruling): EXPORTED — `RunManager.start()`'s scheduler/webhook/nested call
 *  sites never mint an `Actor` at all (no principal travels down those paths), so `start()` falls
 *  back to this SAME reproduction rather than inventing a second "no actor supplied" convention. */
export function actorFromPrincipal(principal: string | null): Actor {
  return principal === null
    ? { id: null, bypass: true, idSource: 'none' }
    : { id: principal, bypass: false, idSource: 'authenticated' };
}

/** v38 (issue #100 + #98 item 6, owner-approved policy): the non-owner RUN/DESCRIBE admission
 *  predicate — reuses `canMutate`'s OWN owner/bypass/ownerless notion (the issue's explicit
 *  instruction: "confirm how canMutate/bypass works and apply the same notion") rather than
 *  inventing a parallel one. An owner, a bypass actor (admin/auth-disabled/loopback-exempt — the
 *  same three kinds `actorFor(..., 'bypass')` already bypasses for register/publish/deregister),
 *  or an ownerless legacy row (`!owner`) may reach ANY version. Everyone else is confined to the
 *  CURRENT RELEASE pointer — Q1/Q2 of issue #100: an explicit `version` is allowed only when it
 *  equals today's release; a `channel` selector is allowed only for `'release'` itself.
 *  `requestedChannel === 'beta'` is refused UNCONDITIONALLY (never falls through to the version
 *  equality check) even in the coincidental case beta and release point at the same version today
 *  — a non-owner's explicit ask for the beta channel must not be answered any differently than it
 *  would be the day beta and release diverge again; confirming "beta happens to equal release
 *  right now" is itself a channel-state disclosure Q5 (VERSION_NOT_FOUND, existence-masking) rules
 *  out. */
export function canRunResolved(
  owner: string | null,
  actor: Actor,
  resolvedVersion: string,
  channels: Channels,
  requestedChannel?: Channel,
): boolean {
  if (canMutate(owner, actor)) return true;
  if (requestedChannel === 'beta') return false;
  return resolvedVersion === channels.release;
}
function isActor(x: unknown): x is Actor {
  return typeof x === 'object' && x !== null && 'bypass' in x && 'idSource' in x;
}

export interface WorkflowCatalogOpts {
  /** Issue audit A1 (owner decision 2026-10-06): when set (the caller's own `auth.legacyOwner`,
   *  passed only while auth is enabled), backfill NULL-owner rows to this principal id at
   *  construction time — idempotent, same mechanics as the old hard-coded
   *  `BOOT_BACKFILL_EMAIL`, just operator-configured. Absent -> no
   *  backfill; see `authEnabled` for the "ownerless workflows" hint that fires instead. */
  backfillOwner?: string;
  /** Issue audit A1: whether auth is enabled for this boot — used ONLY to decide whether the
   *  "N ownerless workflow(s)" hint is worth logging when `backfillOwner` is absent (auth off ->
   *  ownership is unenforced, so the hint would be noise every single boot). */
  authEnabled?: boolean;
  /** 2026-09-26 (alias mechanism removed, owner decision 6): a live, already-resolved catalog
   *  snapshot fetcher for `model.default`/`enum` existence checks at registration (`checkModelRef`,
   *  `providers.ts`) — called fresh on every `validateRegistration()` (never memoized at
   *  construction), so it can be backed by `ModelBook`'s own TTL'd freshness. Omitted -> the empty
   *  snapshot (every openrouter/ollama ref accepted with a warning, matching a bare/unconfigured
   *  catalog — the same permissive default an empty `aliasNames` used to give). */
  catalogSnapshot?: () => Promise<ModelCatalogSnapshot>;
  /** v21 adjudication #6 (F-1 ceiling interaction) + #7 (G-1): engine ceilings, so ANY value that
   *  reaches the stored `defaults` column above the configured ceiling (e.g. `effort` above
   *  `maxEffort`) is refused at registration — a declared `params.knobs.<knob>.default` and a
   *  caller-supplied `defaults.<knob>` alike, instead of registering above a bound admission
   *  enforces. Must be the SAME object forwarded to RunManager/McpFacade (server.ts). */
  ceilings?: Ceilings;
  /** v36 (DES-243, ARCH-159, TASK-241, REQ-213): sink for `catalog.register`/`catalog.publish`/
   *  `catalog.deregister` audit lines (TASK-242/244 add the actual emit calls). Omitted -> a bare
   *  console sink (`createEventSink({})`'s own default), so every existing construction site
   *  compiles and behaves unchanged. */
  eventSink?: EventSink;
}

export class WorkflowCatalog {
  private readonly _db: Database.Database;
  private readonly _runWorkspaces = new Map<string, string>(); // runId -> workspace dir
  private readonly _clock: Clock;
  private readonly _workRoot: string;
  private readonly _catalogSnapshot: () => Promise<ModelCatalogSnapshot>;
  private readonly _ceilings?: Ceilings;
  /** v36 (DES-243, TASK-241): audit-line sink; TASK-242/244 call it. */
  private readonly _eventSink: EventSink;
  /** Issue #154 B1-B4: `validateStoredVersion`'s memoization — keyed `${name}@${version}`. A
   *  version row is immutable (ADR-025) and the static checks re-run have no other input, so the
   *  verdict can never change for the same key within one process's lifetime; a rule change only
   *  takes effect on the next process start (the same boundary every other registration-time check
   *  already has — nothing re-scans a stored row mid-process today). */
  private readonly _stalenessCache = new Map<string, { ok: true } | { ok: false; code: ErrorCode; message: string; detail?: Record<string, unknown> }>();

  constructor(workRoot: string, clock?: Clock, opts?: WorkflowCatalogOpts) {
    this._workRoot = workRoot;
    this._clock = clock ?? new SystemClock();
    this._catalogSnapshot = opts?.catalogSnapshot ?? (async () => EMPTY_MODEL_CATALOG);
    this._ceilings = opts?.ceilings;
    this._eventSink = opts?.eventSink ?? createEventSink({});
    mkdirSync(workRoot, { recursive: true });
    this._db = new Database(join(workRoot, 'catalog.db'));
    this._db.pragma('journal_mode = WAL');
    // v22 (DES-109): the NEW shape for a fresh install — script/version/defaults/params live only in
    // workflow_versions now. A pre-v22 DB already has this table (with the legacy columns), so
    // CREATE TABLE IF NOT EXISTS is a no-op there and the migration block below handles it.
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS workflows (
        name TEXT PRIMARY KEY,
        createdAt TEXT NOT NULL
      );
    `);
    const existingCols = (this._db.prepare('PRAGMA table_info(workflows)').all() as Array<{ name: string }>)
      .map((c) => c.name);
    const hasLegacy = existingCols.includes('script'); // only a pre-v22 DB still has this column
    if (!existingCols.includes('owner')) {
      this._db.exec('ALTER TABLE workflows ADD COLUMN owner TEXT');
    }
    // v15/v21 idempotent column adds — needed ONLY so a pre-v22 DB's migration SELECT below always
    // finds these columns (an ancient DB may predate one of them). Guarded by hasLegacy: once the
    // migration has DROPPED them, re-adding unconditionally on every later boot would resurrect the
    // exact stale second-source-of-truth this slice exists to delete.
    if (hasLegacy && !existingCols.includes('defaults')) {
      this._db.exec('ALTER TABLE workflows ADD COLUMN defaults TEXT');
    }
    if (hasLegacy && !existingCols.includes('params')) {
      this._db.exec('ALTER TABLE workflows ADD COLUMN params TEXT');
    }
    // Issue audit A1 (owner decision 2026-10-06): idempotent boot backfill — NULL-owner rows →
    // `auth.legacyOwner`; once/boot, self-limiting. Absent (auth off, or auth on but no
    // `auth.legacyOwner` configured) -> no backfill; when auth IS enabled, log a hint instead so an
    // operator who hits NOT_WORKFLOW_OWNER on an old workflow knows what to set, rather than
    // discovering a silent email transfer the way the old hard-coded constant produced one.
    if (opts?.backfillOwner) {
      const n = this._db
        .prepare("UPDATE workflows SET owner = ? WHERE owner IS NULL")
        .run(opts.backfillOwner).changes;
      if (n > 0) {
        console.log(`auth.migrate: ${n} workflows backfilled to owner=${opts.backfillOwner}`);
      }
    } else if (opts?.authEnabled) {
      const ownerless = (this._db.prepare('SELECT COUNT(*) as c FROM workflows WHERE owner IS NULL').get() as { c: number }).c;
      if (ownerless > 0) {
        console.log(
          `auth.migrate: ${ownerless} workflow(s) have no owner; set auth.legacyOwner in rwe.config.json to a ` +
            'principal id to backfill them (none will be backfilled until then — see DEPLOY.md).',
        );
      }
    }

    // v22 (DES-109, ADR-009, ADR-011): versioned catalog table + the two channel pointers.
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_versions (
        name TEXT NOT NULL, version TEXT NOT NULL,
        script TEXT NOT NULL, defaults TEXT, params TEXT, createdAt TEXT NOT NULL,
        PRIMARY KEY (name, version));
    `);
    if (!existingCols.includes('release_version')) {
      this._db.exec('ALTER TABLE workflows ADD COLUMN release_version TEXT');
    }
    if (!existingCols.includes('beta_version')) {
      this._db.exec('ALTER TABLE workflows ADD COLUMN beta_version TEXT');
    }
    // Transactional, idempotent boot migration (DES-109): a pre-v22 DB copies every row into
    // workflow_versions, publishes its migrated version to `release` (ADR-011 — no fleet-wide outage),
    // then drops the four legacy columns. A DB with no legacy columns (already migrated, or a fresh
    // install) migrates 0 rows — logged, not silent, so idempotence is observable at every boot.
    const migrated = hasLegacy
      ? this._db.transaction(() => {
          const info = this._db
            .prepare(`
              INSERT OR IGNORE INTO workflow_versions (name, version, script, defaults, params, createdAt)
              SELECT name, version, script, defaults, params, createdAt FROM workflows
            `)
            .run();
          this._db.prepare('UPDATE workflows SET release_version = version WHERE release_version IS NULL').run();
          const colsNow = (this._db.prepare('PRAGMA table_info(workflows)').all() as Array<{ name: string }>).map((c) => c.name);
          if (colsNow.includes('script')) this._db.exec('ALTER TABLE workflows DROP COLUMN script');
          if (colsNow.includes('version')) this._db.exec('ALTER TABLE workflows DROP COLUMN version');
          if (colsNow.includes('defaults')) this._db.exec('ALTER TABLE workflows DROP COLUMN defaults');
          if (colsNow.includes('params')) this._db.exec('ALTER TABLE workflows DROP COLUMN params');
          return info.changes;
        }).immediate()
      : 0;
    console.log(`catalog.migrate: ${migrated} workflows → workflow_versions, release published`);

    // Issue #87: a monotonic per-name high-water mark, SEPARATE from `workflows`/`workflow_versions`
    // — neither `deregister()` (which drops the `workflows` row itself) nor `deregisterVersion()`
    // (which drops one `workflow_versions` row) may ever delete or decrement it. Without this table
    // the allocator in `insertVersion` below read `MAX(version)` over SURVIVING rows only, so
    // deleting the highest version (or every version) freed its number back up for the NEXT
    // registration — a different script reusing a number already used, silently breaking the
    // documented immutability of a version row (docs/AUTHORING.md). `lastVersion` is bumped inside
    // the SAME transaction as the version INSERT (below); nothing else writes this table.
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_version_hwm (
        name TEXT PRIMARY KEY,
        lastVersion INTEGER NOT NULL
      );
    `);
    // Boot backfill (idempotent, `INSERT OR IGNORE`): every name that already has version rows gets
    // a hwm row seeded from its current MAX before any deregister can run against this fixed engine
    // — closes the one gap `insertVersion`'s own `max(hwm, MAX(existing))` fallback cannot close on
    // its own: a pre-fix DB with v1..v3 whose v3 is deregistered BEFORE ever registering again would
    // otherwise still see MAX(existing)=2 on the next registration and reuse 'v3'. A name that has
    // already been wholly deregistered before this fix shipped has no surviving row to seed from —
    // its counter cannot be recovered; the next registration under that name starts at 'v1' again
    // (accepted gap, issue #87).
    this._db.exec(`
      INSERT OR IGNORE INTO workflow_version_hwm (name, lastVersion)
      SELECT name, MAX(CAST(SUBSTR(version, 2) AS INTEGER)) FROM workflow_versions GROUP BY name
    `);

    // v23 (DES-130, TASK-114): the graph-analyzer's own diagram store, folded into the same DB/
    // handle as workflow_versions (a derived store must not outlive its source, ADR-021). PK is
    // (name, version) — a v3 read can never return a v4 row, a schema property, not a code
    // discipline. `deregister()`'s existing transaction is the ONLY deletion path (below); no prune
    // hook, sweep, GC or orphan-reaper exists (ARCH-077's "maxWorkflowVersions prune" does not exist
    // — the ceiling refuses registration, ADR-014).
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_diagrams (
        name TEXT NOT NULL, version TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','ready','unavailable')),
        diagram TEXT NULL, note_code TEXT NULL, generated_at TEXT NULL, bindings_fp TEXT NULL,
        CHECK ((status = 'ready') = (diagram IS NOT NULL)),
        CHECK (note_code IS NULL OR note_code IN ('TIMEOUT','PROVIDER_UNREACHABLE','PROVIDER_ERROR',
          'GATE_REJECTED_CONTENT','GATE_REJECTED_SHAPE','QUEUE_FULL','RETRIES_EXHAUSTED','MODEL_UNMAPPED')),
        PRIMARY KEY (name, version));
    `);

    // v24 (ARCH-098, DES-148, TASK-143): `mermaid`/`triggers` columns on `workflow_versions` — both
    // NULL only on pre-v24 rows (ADR-025/026); `validateRegistration` refuses `MERMAID_REQUIRED` on
    // every NEW row, so no row written from here on can carry `mermaid NULL`.
    const versionCols = (this._db.prepare('PRAGMA table_info(workflow_versions)').all() as Array<{ name: string }>).map((c) => c.name);
    if (!versionCols.includes('mermaid')) this._db.exec('ALTER TABLE workflow_versions ADD COLUMN mermaid TEXT');
    if (!versionCols.includes('triggers')) this._db.exec('ALTER TABLE workflow_versions ADD COLUMN triggers TEXT');
    // v26 (DES-184, ARCH-119, TASK-189): `NULL` (every pre-v26 row) reads as `'v1'` — a grandfathered
    // row is never re-checked and renders as before (ADR-025: version rows are immutable). Every row
    // `insertVersion` writes from here on carries `'v2'` explicitly.
    if (!versionCols.includes('diagram_contract')) this._db.exec('ALTER TABLE workflow_versions ADD COLUMN diagram_contract TEXT');
    // v37 P1 (ADR-086's third owner ruling, 2026-09-25, DES-263's 第三次修訂): "who wrote the
    // script that is about to run" — write-once at `insertVersion`, from the same
    // `ToolDeps.isRemoteSubmission` `workflow_register` already threads; a version row is
    // immutable (ADR-025), so there is no UPDATE path for this column either, ever.
    // `DEFAULT 0` grandfathers every pre-existing row as local — deliberate (see DES-263's own
    // migration-semantics note): coverage grows from the next remote registration onward, never
    // backfilled.
    if (!versionCols.includes('registeredRemote')) this._db.exec('ALTER TABLE workflow_versions ADD COLUMN registeredRemote INTEGER NOT NULL DEFAULT 0');
    // Issue #82 (option B): the version's default seed — write-once like every other column here
    // (a new seed is a new version). NULL = no default seed (every pre-#82 row).
    if (!versionCols.includes('seed_manifest_ref')) this._db.exec('ALTER TABLE workflow_versions ADD COLUMN seed_manifest_ref TEXT');
    if (!versionCols.includes('seed_namespace')) this._db.exec('ALTER TABLE workflow_versions ADD COLUMN seed_namespace TEXT');

    // v24 (ARCH-098, DES-148, DES-153, TASK-143): the asset store's catalog rows — `workflow = ''` is
    // the global-scope sentinel (SQLite refuses expressions in a PK). `AssetSyncService` (TASK-144)
    // is the only writer via `putAsset`/`deleteAsset` below; this catalog knows nothing else about
    // asset file bytes (those live on disk under `assetRoot`, a server.ts/AssetSyncService concern).
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS assets (
        workflow TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL,
        pushedBy TEXT, pushedAt TEXT NOT NULL, config TEXT NULL,
        PRIMARY KEY (workflow, kind, name));
    `);
  }

  /** v24 Gate 8 (AF-2, TASK-161): the UNION of `triggers[]` over every version row of `name` — "has
   *  this workflow ever DECLARED this trigger id?".
   *
   *  Why the fire path needs it. `NOT_IN_RELEASE` exists to make "the released version no longer
   *  lists this trigger" observable. Until AF-2 the check was gated on `triggers !== undefined`,
   *  using a NULL column as a proxy for "this trigger did not arrive through the registration claim
   *  door" — the OTHER door (`schedule_create({workflow})` / `webhook_create({workflow})`, closed
   *  on the tool surface by v24 adjudication #8 (H-2, issue #56) and now reachable only as a pre-v24
   *  legacy row) binds a trigger that never enters any version's `triggers[]`. Once `[]` is stored honestly (as ARCH-098 requires) that proxy is
   *  gone, and the membership check would refuse every create-time-bound trigger on every v24
   *  workflow. This predicate is the honest discriminator, and it needs no new column — which
   *  matters because the webhook store has only ONE binding column and could not tell the two doors
   *  apart any other way. Adjudication #8 closed the door for NEW triggers, but the legacy rows
   *  it left behind still reach the fire path, so the predicate stays until they are gone. */
  declaredTriggers(name: string): Set<string> {
    const rows = this._db.prepare('SELECT triggers FROM workflow_versions WHERE name = ?').all(name) as Array<{ triggers: string | null }>;
    const declared = new Set<string>();
    for (const row of rows) {
      if (!row.triggers) continue; // a pre-v24 row declared nothing — the column did not exist
      for (const id of JSON.parse(row.triggers) as string[]) declared.add(id);
    }
    return declared;
  }

  /** v24 Gate 8 (AF-2, TASK-161): the fire path's one-id form of `declaredTriggers` — see there. */
  declaresTrigger(name: string, triggerId: string): boolean {
    return this.declaredTriggers(name).has(triggerId);
  }

  /** issue #160 BUG-ish (owner-approved 2026-10-07): a trigger claimed through a version's
   *  `triggers[]` is PINNED to that declaration, not to whatever channel happens to be released —
   *  "bind a trigger to v3" must mean v3 fires, even while `release` points elsewhere (or nowhere).
   *  Replaces the old release-channel-membership gate (`NOT_IN_RELEASE`): that check could only ever
   *  ask "does the CURRENT release still list this id", which is a different (and, per the owner,
   *  wrong) question from "which version did the author actually bind this id to".
   *
   *  Returns the HIGHEST-numbered version (by the same numeric-suffix ordering `_listVersions` uses,
   *  never lexicographic — 'v10' > 'v2') among every row of `name` whose `triggers[]` lists
   *  `triggerId`, or `null` when no version ever declared it (the pre-v24 create-time-binding door —
   *  `declaresTrigger` is false for exactly the same rows, and the fire path falls back to the old
   *  release-channel resolution for them). Re-declaring the same id in a later version moves the
   *  binding forward (the latest declarer wins); omitting it from a later version leaves the binding
   *  on the latest version that still lists it — the id is never implicitly un-bound by a newer
   *  version that simply does not mention it (only `workflow_deregister`/`workflow_deregister
   *  {version}` releases a claim, and now disables the trigger outright — see `release()`'s callers). */
  boundVersionFor(name: string, triggerId: string): string | null {
    const rows = this._db.prepare('SELECT version, triggers FROM workflow_versions WHERE name = ?').all(name) as Array<{ version: string; triggers: string | null }>;
    let best: { version: string; n: number } | null = null;
    for (const row of rows) {
      if (!row.triggers) continue; // pre-v24 row — declared nothing
      const declared = JSON.parse(row.triggers) as string[];
      if (!declared.includes(triggerId)) continue;
      const n = Number(row.version.replace(/^v/, '')) || 0;
      if (best === null || n > best.n) best = { version: row.version, n };
    }
    return best?.version ?? null;
  }

  /** v24 (ARCH-098, DES-153, TASK-143): upsert one asset row. `workflow: ''` = the global scope. */
  putAsset(row: { workflow: string; kind: string; name: string; pushedBy: string | null; pushedAt: string; config?: string | null }): void {
    this._db
      .prepare(`
        INSERT INTO assets (workflow, kind, name, pushedBy, pushedAt, config)
        VALUES (@workflow, @kind, @name, @pushedBy, @pushedAt, @config)
        ON CONFLICT (workflow, kind, name) DO UPDATE SET
          pushedBy = excluded.pushedBy, pushedAt = excluded.pushedAt, config = excluded.config
      `)
      .run({ workflow: row.workflow, kind: row.kind, name: row.name, pushedBy: row.pushedBy, pushedAt: row.pushedAt, config: row.config ?? null });
  }

  /** v24 (ARCH-098, TASK-160, Gate 8 AF-1): the catalog half of the pre-v24 asset migration — every
   *  legacy row in ONE `.immediate()` transaction (ARCH-071's precedent), upsert so a re-run after a
   *  crash writes the same rows rather than failing on the primary key. */
  putLegacyAssets(rows: readonly { workflow: string; kind: string; name: string; pushedBy: string; pushedAt: string; config: string | null }[]): void {
    this._db.transaction(() => {
      for (const row of rows) this.putAsset(row);
    }).immediate();
  }

  /** v24 (ARCH-098, TASK-160, Gate 8 AF-1): reads the PRE-v24 `mcp_provisions` table off DISK.
   *  Pre-v24 that table lived in its own sibling database, `<workRoot>/mcp-registry.db` (pre-v24
   *  `server.ts:1362`), NOT in `catalog.db`. `grep -rn "mcp_provisions" src/` is empty because v24
   *  deleted `mcp-registry.ts` — that says nothing about an upgraded deployment's disk, which is
   *  exactly the confusion AF-1 turned on. The file is left in place afterwards (never dropped): the
   *  migration marker, not a destructive DDL, is what stops a second copy. */
  readLegacyMcpProvisions(): Array<{ name: string; config: string; provisionedAt: string }> {
    const dbPath = join(this._workRoot, 'mcp-registry.db');
    if (!existsSync(dbPath)) return [];
    const legacy = new Database(dbPath);
    try {
      const table = legacy.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mcp_provisions'").get();
      if (!table) return [];
      return legacy.prepare('SELECT name, config, provisionedAt FROM mcp_provisions ORDER BY name').all() as Array<{
        name: string; config: string; provisionedAt: string;
      }>;
    } finally {
      legacy.close();
    }
  }

  /** v24 (ARCH-098, DES-153, TASK-143): `{deleted:false}` when no such row existed (idempotent). */
  deleteAsset(workflow: string, kind: string, name: string): { deleted: boolean } {
    const info = this._db.prepare('DELETE FROM assets WHERE workflow = ? AND kind = ? AND name = ?').run(workflow, kind, name);
    return { deleted: info.changes > 0 };
  }

  /** v24 (ARCH-098, DES-153, TASK-143): rows for ONE scope (`workflow` is `''` for global). */
  listAssets(workflow: string, kind?: string): Array<{ workflow: string; kind: string; name: string; pushedBy: string | null; pushedAt: string; config: string | null }> {
    const rows = kind === undefined
      ? this._db.prepare('SELECT workflow, kind, name, pushedBy, pushedAt, config FROM assets WHERE workflow = ? ORDER BY kind, name').all(workflow)
      : this._db.prepare('SELECT workflow, kind, name, pushedBy, pushedAt, config FROM assets WHERE workflow = ? AND kind = ? ORDER BY name').all(workflow, kind);
    return rows as Array<{ workflow: string; kind: string; name: string; pushedBy: string | null; pushedAt: string; config: string | null }>;
  }

  /** v24 (ARCH-098, DES-153, TASK-143): both scopes (workflow ∪ global) in one call — DES-153's
   *  `resolveMcp`/`AssetSyncService.list` convenience (workflow scope first, global second). */
  assetsOf(workflow: string): Array<{ workflow: string; kind: string; name: string; pushedBy: string | null; pushedAt: string; config: string | null }> {
    return [...this.listAssets(workflow), ...this.listAssets('')];
  }

  /** v23 (DES-130): stamps the boot sweep's own attempt marker into `generated_at` when given
   *  (DES-131's `sweepAtBoot`); a fresh enqueue omits it and the column stays NULL. Overwrites any
   *  prior row for the same (name, version) back to a clean pending state. */
  putDiagramPending(name: string, version: string, generatedAt?: string): void {
    this._db
      .prepare(`
        INSERT INTO workflow_diagrams (name, version, status, diagram, note_code, generated_at, bindings_fp)
        VALUES (?, ?, 'pending', NULL, NULL, ?, NULL)
        ON CONFLICT (name, version) DO UPDATE SET
          status = 'pending', diagram = NULL, note_code = NULL, generated_at = excluded.generated_at, bindings_fp = NULL
      `)
      .run(name, version, generatedAt ?? null);
  }

  /** v23 (DES-130, DES-127 B6): the late-write guard — runs inside a transaction and writes ONLY
   *  where a `workflow_versions` row for (name, version) still exists; otherwise a silent no-op.
   *  Without this, `enqueue → deregister commits → putDiagramResult lands` would create an immortal
   *  orphan row (this table has no foreign key, and the single-deletion-path rule is exactly what
   *  makes an orphan unreachable afterwards). */
  putDiagramResult(
    name: string,
    version: string,
    r:
      | { status: 'ready'; diagram: string; generatedAt: string; bindingsFp: string }
      | { status: 'unavailable'; noteCode: PersistedDiagramNoteCode; generatedAt: string; bindingsFp: string },
  ): void {
    this._db
      .transaction(() => {
        const exists = this._db.prepare('SELECT 1 FROM workflow_versions WHERE name = ? AND version = ?').get(name, version);
        if (!exists) return; // late-write guard: no surviving version row, nothing written
        const diagram = r.status === 'ready' ? r.diagram : null;
        const noteCode = r.status === 'unavailable' ? r.noteCode : null;
        this._db
          .prepare(`
            INSERT INTO workflow_diagrams (name, version, status, diagram, note_code, generated_at, bindings_fp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (name, version) DO UPDATE SET
              status = excluded.status, diagram = excluded.diagram, note_code = excluded.note_code,
              generated_at = excluded.generated_at, bindings_fp = excluded.bindings_fp
          `)
          .run(name, version, r.status, diagram, noteCode, r.generatedAt, r.bindingsFp);
      })
      .immediate();
  }

  /** v23 (DES-130): null for a version with no diagram row at all — a version registered before v23
   *  (DES-127 B1), or one no attempt has ever been written for. */
  getDiagram(name: string, version: string): DiagramRow | null {
    const row = this._db
      .prepare('SELECT name, version, status, diagram, note_code, generated_at, bindings_fp FROM workflow_diagrams WHERE name = ? AND version = ?')
      .get(name, version) as
      | { name: string; version: string; status: DiagramRow['status']; diagram: string | null; note_code: PersistedDiagramNoteCode | null; generated_at: string | null; bindings_fp: string | null }
      | undefined;
    if (!row) return null;
    return {
      name: row.name, version: row.version, status: row.status,
      diagram: row.diagram, noteCode: row.note_code, generatedAt: row.generated_at, bindingsFp: row.bindings_fp,
    };
  }

  /** v23 (DES-130): the only sweep, bounded by the number of `pending` rows (DES-131's boot sweep). */
  listPendingDiagrams(): Array<{ name: string; version: string }> {
    return this._db.prepare("SELECT name, version FROM workflow_diagrams WHERE status = 'pending'").all() as Array<{ name: string; version: string }>;
  }

  // v24 (ARCH-098, DES-148, TASK-143): the diagram-check's fixed size ceiling — same values the
  // retired `graphAnalyzer.maxBytes`/`maxLines` config defaulted to (rwe.config.example.json, now
  // author-supplied rather than model-generated, so no config knob is needed for it).
  private static readonly MERMAID_LIMITS = { maxBytes: 8192, maxLines: 120 };

  /** v24 (ARCH-098, DES-148, TASK-143): every pure registration-time check, PINNED order, NOTHING
   *  written — `validateScriptEntry` → `scanAgentCalls` → `parseParamContract` → `checkMetaPhases`
   *  (v39) → `checkMermaid` → version-count ceiling → owner gate (read-only). Used directly by
   *  `register()` below, and by the
   *  facade's trigger-claim sequence (ARCH-091/DES-149: validate → claim each trigger → insertVersion
   *  → release on throw) — `insertVersion` is a SEPARATE step so a claim can happen in between. */
  async validateRegistration(req: { name: string; script: string; mermaid: string; principal?: string | null; actor?: Actor }): Promise<{ params: ParamContract; labels: string[]; agents: Record<string, AgentParamSpec>; warnings?: ModelRefWarning[] }> {
    const { name, script, mermaid } = req;

    // Issue #91: checked FIRST, before any other registration work (including `actorFromPrincipal`
    // below has no bearing on it) — the engine registers no `rwe-*` workflows for ANY principal,
    // admin included (owner decision), so a script/mermaid full of unrelated errors must still come
    // back RESERVED_PREFIX rather than some other code that happened to run first. Same
    // case-sensitive `startsWith` rule as `path-verdict.ts`'s asset-tree check (no `toLowerCase`) —
    // a workflow name has no path segments to split on, so the whole name is compared directly.
    if (name.startsWith(RESERVED_PREFIX)) {
      throw codedError(
        'RESERVED_PREFIX',
        `RESERVED_PREFIX: workflow name '${name}' starts with the engine-reserved '${RESERVED_PREFIX}' prefix (ARCH-093) — the engine registers no ${RESERVED_PREFIX}* workflows`,
      );
    }

    // Issue #154 B4 (CRITICAL): checked SECOND, right after RESERVED_PREFIX and before any other
    // registration work, for the same reason RESERVED_PREFIX is checked first — a script/mermaid
    // full of unrelated errors must still come back INVALID_NAME, not some other code that happened
    // to run first. Before this check, the ONLY thing ever validated about `name` was this prefix:
    // empty/whitespace/`..`/an embedded `/`/an unbounded length all registered successfully, and the
    // raw name was later joined UNSANITIZED into a real host path (`workFolder(name)`, this
    // workflow's own run-workspace `cwd`) with no containment check anywhere on that path — a
    // sufficiently-dotted name (e.g. `../../../../tmp/evil`) escaped `workRoot` entirely onto an
    // arbitrary host path the engine process can write to. `isValidBareName` (path-verdict.ts)
    // requires a single non-empty, slash-free, non-`.`/`..`, length-bounded segment — the ONE shape
    // that can never add, remove, or escape a directory level when joined.
    if (!isValidBareName(name)) {
      throw codedError(
        'INVALID_NAME',
        `INVALID_NAME: workflow name '${name}' must be a single path segment: non-empty, no leading/trailing whitespace, no '/' or '\\', not '.' or '..', at most 128 characters`,
      );
    }

    const actor: Actor = req.actor ?? actorFromPrincipal(req.principal ?? null);

    // v22 (DES-111, DES-112, DES-117, TASK-107): validateScriptEntry runs FIRST — DES-148's own
    // pinned order (`validateScriptEntry → scanAgentCalls → parseParamContract → checkMermaid → …`)
    // content checks (ADR-013 — registration ENFORCES fail-closed). 2026-09-26 (alias mechanism
    // removed): the model check moved entirely into `parseMetaParams`/`parseParamContract` below,
    // which is where the catalog-existence check (`checkModelRef`) actually needs to run. issue
    // #103(a): validateScriptEntry checks PARSE_ERROR only now — its MCP_NOT_PROVISIONED check (a
    // regex scan against an injected predicate, never wired to a real catalog in production) is
    // retired; mcp/skill provisioning is now a non-fatal registration WARNING computed one layer up
    // (mcp-facade.ts's `workflowRegister`, against the real asset catalog) and an admission-time
    // REFUSAL (run-manager.ts's `start()`) — never a registration throw. All errors surface, the
    // first is thrown, the rest travel in `detail.errors`.
    const scriptCheck = validateScriptEntry(script);
    if (!scriptCheck.ok) {
      const [first, ...rest] = scriptCheck.errors;
      throw Object.assign(codedError(first!.code, first!.message), { detail: { ...first!.detail, errors: [first, ...rest] } });
    }

    // DES-143 (TASK-135): every scannable agent() call's label + any scan violation.
    const scan = scanAgentCalls(script);
    if (scan.violations.length > 0) {
      const v = scan.violations[0]!;
      throw codedError('SCAN_VIOLATION', `${v.code}: ${v.hint} (line ${v.line})`, { line: v.line, key: v.key, violation: v.code });
    }

    // DES-144 (TASK-136): the per-agent parameter contract — AGENT_UNDECLARED etc.
    // v24 Gate 7.5 (D-2): this line used to call a PRIVATE COPY of `workflow-meta.ts`'s
    // `parseMetaParams`, duplicated here while that function still had a call-signature bug and
    // left behind after it was fixed — the copy was the one the registration path ran, so a check
    // added to the shared function (`meta.defaults` is retired) would have been invisible in
    // production. Same defect class as D-3's two `toErrEnvelope`s. The copy is gone; `scan.labels`
    // is exactly what `parseMetaParams` recomputes internally from the same `scanAgentCalls`.
    // 2026-09-26: `catalog` is fetched FRESH here (never memoized) so `.default`/`enum` full-ref
    // existence (openrouter/ollama live listing, anthropic static table) is checked against
    // current data, not a boot-time snapshot.
    const catalog = await this._catalogSnapshot();
    const paramsResult = parseMetaParams(script, catalog);
    if (!paramsResult.ok) {
      throw codedError(paramsResult.code, paramsResult.message, paramsResult.detail);
    }
    for (const w of paramsResult.warnings ?? []) console.warn(`[model-catalog] workflow '${name}' agent '${w.label}': ${w.message}`);

    // review M3: pi harness v1's spec says an unsupported tool (WebFetch/WebSearch/Task/
    // NotebookEdit/...) is refused "at registration AND dispatch" — only dispatch
    // (`PiGatewayClient.invoke`'s own `mapTools`) was wired; a workflow declaring
    // `allowedTools:['Read','WebFetch']` registered successfully and only failed once a run actually
    // tried to dispatch that agent, with the run left `completed` and the agent `failed`. Gated on
    // `catalog.harnessProviders !== undefined` — the SAME flag `checkModelRef`'s anthropic-provider
    // gate already uses, present only under `gateway:"pi"` (never under `"sdk"`, zero behavior change
    // there). `scan.calls` already has each agent() call's literal `allowedTools` from `scanAgentCalls`
    // above (DES-143) — no new script parse needed. An `'absent'` allowedTools (the deployment
    // default, Read/Write/Edit/Glob/Grep/Bash — all pi-supported) needs no check.
    if (catalog.harnessProviders !== undefined) {
      for (const call of scan.calls) {
        if (call.allowedTools === undefined || call.allowedTools === 'absent') continue;
        const unsupported = piUnsupportedToolNames(call.allowedTools);
        if (unsupported.length > 0) {
          throw codedError(
            'TOOL_UNSUPPORTED_BY_HARNESS',
            `TOOL_UNSUPPORTED_BY_HARNESS: ${unsupported.join(', ')} ${unsupported.length === 1 ? 'has' : 'have'} no mapping under the pi harness (gateway:"pi") — agent '${call.label}' (line ${call.line}) declares allowedTools including it; only Read/Write/Edit/Bash/Grep/Glob/LS and mcp__<server>__<tool> names are supported`,
            { line: call.line, label: call.label, unsupported },
          );
        }
      }
    }

    // v39 (owner decision 2026-09-30): `meta.phases` is now REQUIRED on every NEW registration and
    // must equal the script's own `phase()` calls (count/order/title — `PHASES_REQUIRED` /
    // `PHASES_MISMATCH`). Checked here — a pure script-content check, right after the other
    // script-content checks (scan/params) and BEFORE `MERMAID_REQUIRED` below — for the same reason
    // `MERMAID_REQUIRED`'s own comment gives: a script that fails an earlier, unrelated check must
    // be refused with THAT code, not a misleading "you forgot the diagram" (or, here, "you forgot
    // meta.phases" arriving after a diagram-shaped refusal that never got the chance to fire).
    // `scriptPhaseTitles` is the same `parseWorkflowSkeleton` phase-node scan `deriveExpectedGraph`
    // (below) turns into lanes — a non-literal `phase()` title is `null`, matched by POSITION only,
    // mirroring `checkMermaid`'s own LANE_MISMATCH rule for a dynamic lane title.
    const scriptPhaseTitles = parseWorkflowSkeleton(script)
      .filter((n): n is typeof n & { kind: 'phase' } => n.kind === 'phase')
      .map((n) => n.title ?? null);
    const phasesCheck = checkMetaPhases(script, scriptPhaseTitles);
    if (!phasesCheck.ok) {
      throw codedError(phasesCheck.code!, `${phasesCheck.code}: ${phasesCheck.message}`);
    }

    // DES-147 (TASK-138): the author-supplied diagram vs the script's own agent labels + declared
    // model/effort/timeoutMs. `agentDefaults` is derived from the just-validated contract — the
    // value-triple check compares the DIAGRAM against what registration is ABOUT to store.
    const agentDefaults: Record<string, { model?: string; effort?: string; timeoutMs?: number }> = {};
    for (const [label, spec] of Object.entries(paramsResult.value.agents)) {
      agentDefaults[label] = {
        model: typeof spec.model.default === 'string' ? spec.model.default : undefined,
        effort: typeof spec.effort.default === 'string' ? spec.effort.default : undefined,
        timeoutMs: typeof spec.timeoutMs.default === 'number' ? spec.timeoutMs.default : undefined,
      };
    }
    // v24 boundary (DES-148): `MERMAID_REQUIRED` on `undefined | ''` — checked here, immediately
    // before the grammar check itself (step 4 of the pinned order above), so a script that fails an
    // EARLIER, unrelated check (bad parse / unknown alias / unprovisioned mcp / undeclared agent
    // label) is still refused with THAT code, not a misleading "you forgot the diagram".
    if (mermaid === undefined || mermaid === '') {
      throw codedError('MERMAID_REQUIRED', `MERMAID_REQUIRED: workflow '${name}' registration requires a non-empty mermaid diagram string (ADR-025)`);
    }
    // v24 boundary (DES-148): whitespace-only is DISTINCT from empty — `checkMermaid` treats a
    // document with zero non-blank lines as a legitimately empty (but headed) diagram, so a
    // string that is present but carries no real content at all (not even a header) is refused
    // here as MERMAID_INVALID(line 1) rather than silently passing checkMermaid's own
    // zero-labels/zero-nodes "ok" case.
    if (mermaid.trim() === '') {
      throw codedError('MERMAID_INVALID', `MERMAID_INVALID: workflow '${name}' mermaid diagram is whitespace-only (line 1)`, { line: 1 });
    }
    // v26 integration (REQ-128, DES-184, ADR-043, clarification 29): registration-time v2 GATING.
    // TASK-189 built `checkMermaid`'s v2 arm and `insertVersion` already writes
    // `diagram_contract='v2'` on every new row — but nothing ever passed the 5th argument, so the
    // column was a STAMP claiming a check that never ran. REQ-128's own acceptance ("v26 之後的新
    // 註冊 … 頭必須是 graph LR … subgraph 的數量與順序等於 script 的 phase() 呼叫") makes this
    // unconditional for NEW registrations; pre-v26 rows keep `'v1'`, are never re-checked, and
    // still render (version rows are immutable, ADR-025, so no v1 row can drift into needing one).
    // A derive REFUSAL is answered with its own code and line rather than a bare SCAN_VIOLATION —
    // DES-184's boundary requires that, and REQ-117's first-try bar depends on it.
    const derived = deriveExpectedGraph(parseWorkflowSkeleton(script), scan);
    if (!derived.ok) {
      throw codedError(
        derived.rule,
        `${derived.rule}: ${derived.message} (line ${derived.line})`,
        { rule: derived.rule, line: derived.line, ...(derived.label !== null ? { label: derived.label } : {}) },
      );
    }
    const diagramCheck = checkMermaid(mermaid, scan.labels, agentDefaults, WorkflowCatalog.MERMAID_LIMITS, { expected: derived.graph });
    if (!diagramCheck.ok) {
      // v26 (DES-184, TASK-189): RULE_CODE replaces the old two-way ternary — every `ok:false`
      // path above sets `rule` (the flat-shape comment on CheckMermaidResult explains why the type
      // still carries it as optional); `!` is safe here, inside `!diagramCheck.ok`.
      const code = RULE_CODE[diagramCheck.rule!];
      // v26: the detail literal is widened to carry `expected` — the v2 refusal's lane/slot/edge
      // structure as data (TASK-194 pins one such envelope as a literal fixture).
      // Issue #89 item 5: a rule named like its code is not repeated ("TOOLS_MISMATCH: TOOLS_MISMATCH"),
      // and TOOLS_MISMATCH spells out the exact segment text the node must carry.
      const lineText = diagramCheck.line !== undefined ? ` (line ${diagramCheck.line})` : '';
      const toolsExp = diagramCheck.rule === 'TOOLS_MISMATCH' ? (diagramCheck.expected as { label?: string; tools?: string[] } | undefined) : undefined;
      // Issue #89 item 5 (verification finding 7): when `rule === code` (the v2 rules that self-map
      // in RULE_CODE — DIAGRAM_DIRECTION/LANE_MISMATCH/EDGE_MISMATCH, TOOLS_MISMATCH handled above)
      // the message used to be exactly `${code}:${lineText}` — a colon straight into "(line N)" with
      // no rule text at all ("LANE_MISMATCH: (line 2)"). This interpolates a short, meaningful
      // phrase: the catalog's own `hint` when it reads well inline, else a generic fallback — never
      // a SECOND copy of the hint text (`ERROR_CATALOG` stays the one place it is authored).
      const HINT_INLINE_LIMIT = 80; // chars — a hint written as prose (LANE_MISMATCH's) reads worse
      // inline than a short generic phrase; a short one (DIAGRAM_DIRECTION's/EDGE_MISMATCH's) is
      // fine to reuse as-is.
      const catalogHint = (ERROR_CATALOG as Record<string, { hint?: string }>)[code]?.hint;
      const meaningfulText = catalogHint !== undefined && catalogHint.length <= HINT_INLINE_LIMIT
        ? catalogHint
        : 'diagram does not match the script';
      const message = toolsExp?.label !== undefined && Array.isArray(toolsExp.tools)
        ? `${code}: node '${toolsExp.label}'${lineText} must carry "${toolsExp.tools.length === 0 ? 'tools: none' : `tools: ${[...toolsExp.tools].sort().join(', ')}`}" as its third <br/> segment to match allowedTools ${JSON.stringify(toolsExp.tools)}`
        : diagramCheck.rule === undefined || diagramCheck.rule === code
          ? `${code}: ${meaningfulText}${lineText}`
          : `${code}: ${diagramCheck.rule}${lineText}`;
      throw codedError(code, message, {
        rule: diagramCheck.rule, line: diagramCheck.line, onlyInScript: diagramCheck.onlyInScript, onlyInDiagram: diagramCheck.onlyInDiagram,
        expected: diagramCheck.expected,
      });
    }

    // v22 send-back H3 precedent: version-count ceiling is READ-ONLY here (re-checked, defence in
    // depth, inside insertVersion's transaction below — a read here cannot itself race a write).
    const existing = this._db.prepare('SELECT owner FROM workflows WHERE name = ?').get(name) as { owner: string | null } | undefined;
    const count = (this._db.prepare('SELECT COUNT(*) AS n FROM workflow_versions WHERE name = ?').get(name) as { n: number }).n;
    const maxWorkflowVersions = (this._ceilings as (Ceilings & { maxWorkflowVersions?: number }) | undefined)?.maxWorkflowVersions;
    // R2-C2/R2-D7 (2026-10-06): `!= null` catches BOTH absent (undefined) and an explicit JSON
    // `null` (NULL-WAS-DEFAULT treats null as "no ceiling", same as every other ceiling key this
    // round normalized) — `!== undefined` alone let `null` through as a present value, and
    // `count >= null` is true for every count (JS coerces null to 0), refusing the very first
    // registration of any name.
    if (maxWorkflowVersions != null && count >= maxWorkflowVersions) {
      throw codedError(
        'VERSION_CEILING_EXCEEDED',
        `VERSION_CEILING_EXCEEDED: workflow '${name}' already has ${count} version(s) (maximum ${maxWorkflowVersions}) — deregister an old one with workflow_deregister({name, version}), or raise the engine's maxWorkflowVersions ceiling`,
      );
    }
    // DES-098/v36 (DES-244): ownership gate (read-only) — `canMutate` is the truthy form so a
    // pre-v15 `owner === ''` row is never wrongly refused. Re-checked (defence in depth) inside
    // insertVersion's transaction. Issue #90: the message never names the actual owner (`existing.
    // owner`) — it reaches the refused caller verbatim, so disclosing who owns the name to a
    // stranger who merely guessed it would be a leak, not a courtesy.
    if (existing && !canMutate(existing.owner, actor)) {
      throw codedError('NOT_WORKFLOW_OWNER', `NOT_WORKFLOW_OWNER: workflow '${name}' is not owned by the caller`);
    }

    return { params: paramsResult.value, labels: scan.labels, agents: paramsResult.value.agents, ...(paramsResult.warnings ? { warnings: paramsResult.warnings } : {}) };
  }

  /** v24 (ARCH-098, DES-148, TASK-143): the ONE write — INSERTs a new (name, version) row (never
   *  ON CONFLICT DO UPDATE); version = v<max(hwm, MAX(live rows))+1> over that name's OWN rows —
   *  issue #87: the high-water mark in `workflow_version_hwm` (bumped in the same transaction,
   *  never deleted by deregister) keeps a number from being reused once a row using it is gone;
   *  published to no channel
   *  (REQ-097 — registration ≠ publication). The ownership read, the version-count read, and the two
   *  writes all live inside ONE `.immediate()` transaction (defence in depth — `validateRegistration`
   *  already checked both, read-only, above). Residual PK/BUSY races map to a typed
   *  REGISTRATION_CONFLICT instead of an untyped 500. Callers (the facade, ARCH-091/DES-149) run any
   *  trigger `claim()` BETWEEN `validateRegistration` and this call — this method itself does not
   *  know about trigger stores. */
  async insertVersion(req: { name: string; script: string; mermaid: string; triggers?: string[]; params: ParamContract; principal?: string | null; actor?: Actor; registeredRemote?: boolean; seedManifestRef?: string; seedNamespace?: string }): Promise<{ version: string }> {
    const { name, script, mermaid, triggers, params } = req;
    const actor: Actor = req.actor ?? actorFromPrincipal(req.principal ?? null);
    // v37 P1 (ADR-086's third owner ruling, 2026-09-25, DES-263's 第三次修訂): the ONE write this
    // column ever gets — never re-evaluated or re-stamped afterwards (a version row is immutable,
    // ADR-025). `mcp-facade.ts`'s `workflowRegister` forwards the SAME `isRemoteSubmission` the
    // door (DES-262) and the trigger stores' creation stamp already read — no second source of
    // truth for "was this submission remote".
    const registeredRemote = req.registeredRemote === true ? 1 : 0;
    const paramsJson = JSON.stringify(params);
    // v24 Gate 8 (AF-2, TASK-161, adjudication #7 G-2): an EMPTY array is stored as '[]', never as
    // NULL. `NULL` is reserved for pre-v24 rows — rows written before this column existed — which is
    // what ARCH-098 says and what both fire paths rely on: `server.ts:775` and
    // `webhook-registry.ts:279` skip the membership check when `released.triggers === undefined`, so
    // that the pre-v24 create-time-binding door keeps working. Writing NULL for `[]` made a v24 row
    // byte-identical to a legacy one, which made NOT_IN_RELEASE unreachable and left "remove a
    // trigger" as the one direction publishing could not express. `?? []` covers the `register()`
    // convenience caller too: every row this engine writes from here on is non-NULL.
    const triggersJson = JSON.stringify(triggers ?? []);
    const createdAt = this._clock.isoNow();
    try {
      const version = this._db.transaction((): string => {
        const existing = this._db.prepare('SELECT owner FROM workflows WHERE name = ?').get(name) as { owner: string | null } | undefined;
        if (existing && !canMutate(existing.owner, actor)) {
          throw codedError('NOT_WORKFLOW_OWNER', `NOT_WORKFLOW_OWNER: workflow '${name}' is not owned by the caller`);
        }
        const count = (this._db.prepare('SELECT COUNT(*) AS n FROM workflow_versions WHERE name = ?').get(name) as { n: number }).n;
        const maxWorkflowVersions = (this._ceilings as (Ceilings & { maxWorkflowVersions?: number }) | undefined)?.maxWorkflowVersions;
        // R2-C2/R2-D7: see the mirrored check in validateRegistration above — `!= null` treats an
        // explicit `null` the same as absent.
        if (maxWorkflowVersions != null && count >= maxWorkflowVersions) {
          throw codedError(
            'VERSION_CEILING_EXCEEDED',
            `VERSION_CEILING_EXCEEDED: workflow '${name}' already has ${count} version(s) (maximum ${maxWorkflowVersions}) — deregister an old one with workflow_deregister({name, version}), or raise the engine's maxWorkflowVersions ceiling`,
          );
        }
        // v22 send-back H3 (07-review.md §4.2, ARCH-071 inv 7): the allocator must be the MAX over
        // the name's existing rows, not a COUNT — a migrated-then-re-registered name (e.g. one row
        // at 'v7') must allocate 'v8', not 'v2'; COUNT also collides on a gapped version history.
        const maxVersion = (this._db
          .prepare('SELECT MAX(CAST(SUBSTR(version, 2) AS INTEGER)) AS m FROM workflow_versions WHERE name = ?')
          .get(name) as { m: number | null }).m;
        // Issue #87: version numbers must never be reused, even after every surviving row that used
        // a number is gone (a version deregister, or a whole-workflow deregister). `maxVersion`
        // above sees ONLY live rows, so it is not enough on its own — the allocator also takes the
        // per-name high-water mark (`workflow_version_hwm`, never touched by deregister/
        // deregisterVersion) and never allocates BELOW it. `hwm ?? 0` covers a name with no hwm row
        // yet (never registered under this fixed engine — the boot backfill above and this fallback
        // both seed it from `maxVersion` the first time, so a pre-fix, already-migrated, or
        // hand-seeded DB still allocates correctly).
        const hwm = (this._db
          .prepare('SELECT lastVersion FROM workflow_version_hwm WHERE name = ?')
          .get(name) as { lastVersion: number } | undefined)?.lastVersion;
        const next = Math.max(hwm ?? 0, maxVersion ?? 0) + 1;
        const v = `v${next}`;
        const owner = existing?.owner ?? actor.id;
        if (!existing) {
          this._db.prepare('INSERT INTO workflows (name, createdAt, owner) VALUES (?, ?, ?)').run(name, createdAt, owner);
        }
        this._db
          .prepare('INSERT INTO workflow_versions (name, version, script, defaults, params, mermaid, triggers, createdAt, diagram_contract, registeredRemote, seed_manifest_ref, seed_namespace) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(name, v, script, paramsJson, mermaid, triggersJson, createdAt, 'v2', registeredRemote, req.seedManifestRef ?? null, req.seedManifestRef !== undefined ? (req.seedNamespace ?? null) : null);
        this._db
          .prepare('INSERT INTO workflow_version_hwm (name, lastVersion) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET lastVersion = excluded.lastVersion')
          .run(name, next);
        return v;
      }).immediate();
      // v36 (DES-243/244, TASK-242, REQ-213/212): one audit line per successful registration,
      // AFTER the transaction commits — never inside it (the sink is not part of the SQL unit).
      this._eventSink({ kind: 'catalog.register', name, version, actor });
      return { version };
    } catch (err) {
      const sqliteCode = (err as { code?: string } | undefined)?.code;
      if (sqliteCode === 'SQLITE_BUSY' || sqliteCode === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        throw codedError('REGISTRATION_CONFLICT', `REGISTRATION_CONFLICT: concurrent registration of '${name}' — retry`);
      }
      throw err;
    }
  }

  /** v24 (ARCH-098, DES-148, TASK-143): convenience composition of `validateRegistration` +
   *  `insertVersion` for a direct (non-facade) caller with no triggers to claim — `register({name,
   *  script, mermaid, triggers?, principal?})`. REPLACES the pre-v24 positional
   *  `register(name, script, defaults, principal)` shape (ADR-035 retires `defaults` from
   *  registration entirely). The facade (ARCH-091/DES-149) does NOT call this — it calls
   *  `validateRegistration`/`insertVersion` separately with a trigger-claim step in between. */
  async register(req: { name: string; script: string; mermaid: string; triggers?: string[]; principal?: string | null; registeredRemote?: boolean; seedManifestRef?: string; seedNamespace?: string }): Promise<{ version: string }> {
    if (typeof req !== 'object' || req === null || typeof (req as { name?: unknown }).name !== 'string') {
      throw codedError(
        'INVALID_ARGUMENT',
        'register() takes {name, script, mermaid, triggers?, principal?} since v24 (DES-148) — the pre-v24 positional (name, script, defaults, principal) shape is retired (ADR-035).',
      );
    }
    const { params } = await this.validateRegistration(req);
    return this.insertVersion({ ...req, params });
  }

  /** Remove a registered workflow (and every version row) from the catalog. `removed:false` when the
   *  name was not present. Name-granular only — no per-version delete in v22 (DES-111, D2). Prior
   *  runs' journals keep their own scriptVersion pin, so this only affects future run-by-name.
   *  v15 (DES-098, TASK-089): ownership gate — non-owner principal → NOT_WORKFLOW_OWNER. */
  async deregister(name: string, principalOrActor: string | null | Actor = null): Promise<{ removed: boolean; claimedTriggers: string[] }> {
    const actor: Actor = isActor(principalOrActor) ? principalOrActor : actorFromPrincipal(principalOrActor);
    const existing = this._db.prepare('SELECT owner FROM workflows WHERE name = ?').get(name) as
      | { owner: string | null }
      | undefined;

    if (existing && !canMutate(existing.owner, actor)) {
      throw codedError('NOT_WORKFLOW_OWNER', `NOT_WORKFLOW_OWNER: workflow '${name}' is not owned by the caller`);
    }

    // v24 (ARCH-098, DES-148, TASK-143): `claimedTriggers` = the UNION of `triggers[]` over EVERY
    // version row (a beta-only claim is still a claim) — read BEFORE the delete, inside the same
    // transaction, so it reflects exactly what is about to be removed. Same union as
    // `declaredTriggers()` below and computed by it, so the two can never disagree about what
    // "this workflow declared that trigger" means.
    let claimed = new Set<string>();
    const info = this._db.transaction(() => {
      claimed = this.declaredTriggers(name);
      this._db.prepare('DELETE FROM workflow_versions WHERE name = ?').run(name);
      this._db.prepare('DELETE FROM workflow_diagrams WHERE name = ?').run(name); // v23 (DES-130): same transaction, so a mid-transaction throw leaves both present
      this._db.prepare('DELETE FROM assets WHERE workflow = ?').run(name); // v24 (ARCH-098, DES-148): same transaction, same reasoning
      return this._db.prepare('DELETE FROM workflows WHERE name = ?').run(name);
    }).immediate();
    return { removed: info.changes > 0, claimedTriggers: [...claimed] };
  }

  /** v36 (DES-246, ARCH-155/156, TASK-244): a SIBLING of `deregister()`, never a mode flag on it —
   *  deletes ONE version's rows (`workflow_versions`, `workflow_diagrams`) instead of every version,
   *  the diagrams and the name row. Six outcomes in a PINNED order — see DES-246's signature comment
   *  for the full table: ownership → name-absent → version-not-found → pinned-by-run →
   *  channel-pinned → last-remaining. `assets` and the `workflows` row are untouched: `assets` is
   *  shared across versions and the name row carries the channels/owner every surviving version
   *  still needs. `claimedTriggers` is the before/after difference of `declaredTriggers(name)`
   *  computed INSIDE the same transaction — a trigger id still declared by a surviving version is
   *  not released; one only the deleted version declared is.
   *  2026-09-22 (Gate-8 F6 send-back): `pinnedRunId: string | null` is a REQUIRED 4th parameter, not
   *  an optional port — the FACADE gathers the fact (it is the only module holding both database
   *  handles, ARCH-156) but this method owns the refusal, at ladder position 4, AFTER ownership.
   *  The prior shape had the facade refuse before ever calling this method, which let a non-owner
   *  learn a pinned-run fact before `NOT_WORKFLOW_OWNER` fired — ADR-075 amended in place. This
   *  method neither computes nor verifies `pinnedRunId`; it only throws from it. */
  async deregisterVersion(name: string, version: string, actor: Actor, pinnedRunId: string | null): Promise<{ removed: boolean; remaining: string[]; claimedTriggers: string[] }> {
    const row = this._db
      .prepare('SELECT owner, release_version, beta_version FROM workflows WHERE name = ?')
      .get(name) as { owner: string | null; release_version: string | null; beta_version: string | null } | undefined;

    // 1 (first): ownership — so a stranger cannot enumerate versions by refusal type. Only
    // reachable when the name is registered; an unregistered name falls through to outcome 2 below,
    // identically for every caller.
    if (row && !canMutate(row.owner, actor)) {
      throw codedError('NOT_WORKFLOW_OWNER', `NOT_WORKFLOW_OWNER: workflow '${name}' is not owned by the caller`);
    }
    // 2: an absent NAME mirrors deregister() — a delete of nothing is not an error.
    if (!row) return { removed: false, remaining: [], claimedTriggers: [] };

    const known = new Set(this._listVersions(name));
    // 3: name present, version absent.
    if (!known.has(version)) {
      throw codedError('VERSION_NOT_FOUND', `VERSION_NOT_FOUND: '${version}' is not a registered version of '${name}'`);
    }
    // 4 (F6): a non-terminal run pins this version — the FACT was gathered by the FACADE
    // (ARCH-156, `store.listRuns()` — this catalog holds no run store of its own); this method
    // only throws from the argument, never re-derives or verifies it.
    if (pinnedRunId !== null) {
      throw codedError('VERSION_PINNED_BY_RUN', `VERSION_PINNED_BY_RUN: run ${pinnedRunId} pins version '${version}' of '${name}'`);
    }
    // 5: a release/beta channel points at this version — clear it there first.
    // Issue #98 item 8: names the EXACT call, now that one exists — `workflow_publish` accepts an
    // explicit `version: null` to clear a channel (see `publish()` above); there was previously no
    // tool that could ever satisfy this refusal.
    if (row.release_version === version || row.beta_version === version) {
      const pinnedOn = [
        row.release_version === version ? 'release' : null,
        row.beta_version === version ? 'beta' : null,
      ].filter((c): c is string => c !== null);
      const calls = pinnedOn.map((c) => `workflow_publish({name, channel:'${c}', version:null})`).join(' and ');
      throw codedError(
        'VERSION_PINNED_BY_CHANNEL',
        `VERSION_PINNED_BY_CHANNEL: '${version}' of '${name}' is published to ${pinnedOn.join(' and ')} — call ${calls} to clear ${pinnedOn.length > 1 ? 'them' : 'it'} first`,
      );
    }
    // 6: the only version — whole-name deregister is the honest tool for that.
    if (known.size <= 1) {
      throw codedError('VERSION_LAST_REMAINING', `VERSION_LAST_REMAINING: '${version}' is the only version of '${name}' — use workflow_deregister({name}) to remove the whole workflow`);
    }

    let claimedTriggers: string[] = [];
    this._db.transaction(() => {
      const before = this.declaredTriggers(name);
      this._db.prepare('DELETE FROM workflow_versions WHERE name = ? AND version = ?').run(name, version);
      this._db.prepare('DELETE FROM workflow_diagrams WHERE name = ? AND version = ?').run(name, version);
      const after = this.declaredTriggers(name);
      claimedTriggers = [...before].filter((id) => !after.has(id));
    }).immediate();

    this._eventSink({ kind: 'catalog.deregister', name, version, actor });
    return { removed: true, remaining: this._listVersions(name), claimedTriggers };
  }

  /** v22 (DES-111): row lookup shared by resolve/resolveDetail/publish — throws CatalogNotFoundError
   *  when the name itself is unregistered. */
  private _requireName(name: string): { createdAt: string; owner: string | null; release_version: string | null; beta_version: string | null } {
    const row = this._db
      .prepare('SELECT createdAt, owner, release_version, beta_version FROM workflows WHERE name = ?')
      .get(name) as { createdAt: string; owner: string | null; release_version: string | null; beta_version: string | null } | undefined;
    if (!row) throw new CatalogNotFoundError(name);
    return row;
  }

  /** Ascending by version NUMBER (not lexicographic — 'v10' must sort after 'v2'). */
  private _listVersions(name: string): string[] {
    return (this._db
      .prepare('SELECT version FROM workflow_versions WHERE name = ? ORDER BY CAST(SUBSTR(version, 2) AS INTEGER) ASC')
      .all(name) as Array<{ version: string }>).map((r) => r.version);
  }

  /** v22 (DES-111): the ONE execution read. `sel` selects an explicit version, a channel, or (empty)
   *  defaults to `release` — see resolveVersionRequest's truth table (DES-110). Never returns `owner`
   *  (an authorization input stays off the execution read). */
  async resolve(name: string, sel: VersionSelector): Promise<VersionEntry> {
    const row = this._requireName(name); // throws CatalogNotFoundError for an unknown name
    const known = new Set(this._listVersions(name));
    // A name row with zero version rows is unreachable via register() (INSERT is atomic with the
    // workflow_versions row), but is possible if a caller partially seeds a DB directly — treat the
    // same as an unknown workflow rather than a confusing VERSION_NOT_FOUND/CHANNEL_UNPUBLISHED.
    if (known.size === 0) throw new CatalogNotFoundError(name);
    const channels: Channels = { release: row.release_version, beta: row.beta_version };
    const result = resolveVersionRequest(sel, channels, known);
    if (!result.ok) {
      throw codedError(result.code, `${result.code}: ${result.channel ?? result.version ?? ''} (workflow '${name}')`.trim());
    }
    const vrow = this._db
      // v24 Gate 7.5 (ADR-035): `defaults` is NOT selected — the workflow-wide defaults object is
      // retired (a registration declaring one is refused DEFAULTS_RETIRED), so the column only ever
      // holds pre-v24 rows, and any run reaching one of those is already refused LEGACY_REREGISTER
      // for the missing per-agent contract. Reading a retired column kept a dead value flowing
      // through the whole admission path.
      .prepare('SELECT script, mermaid, params, triggers, diagram_contract, registeredRemote, seed_manifest_ref, seed_namespace, createdAt FROM workflow_versions WHERE name = ? AND version = ?')
      .get(name, result.version) as { script: string; mermaid: string | null; params: string | null; triggers: string | null; diagram_contract: string | null; registeredRemote: number; seed_manifest_ref: string | null; seed_namespace: string | null; createdAt: string };
    return {
      script: vrow.script,
      version: result.version,
      // issue #154 B5: this version's OWN registration timestamp (see VersionEntry.createdAt's doc).
      createdAt: vrow.createdAt,
      // v24 Gate 7.5 (D-8, REQ-111): the author-supplied diagram. `insertVersion` has written this
      // column since TASK-143 and NO reader selected it, so every v24 workflow's
      // `workflow_describe(...).mermaid` was null with `mermaidNote:'LEGACY_NO_DIAGRAM'` — the
      // iteration's main user-visible feature stored and never delivered. NULL only for a genuinely
      // legacy row registered before ADR-025 required one, which is what that note is for.
      mermaid: vrow.mermaid,
      params: vrow.params ? JSON.parse(vrow.params) as ParamContract : undefined,
      // v24 (integrator; DES-150's NOT_IN_RELEASE): the trigger ids THIS version declares. The
      // column has existed since TASK-143 and no reader ever selected it, which is why the fire
      // path could not tell "claimed but omitted from the current release" from "claimed".
      ...(vrow.triggers ? { triggers: JSON.parse(vrow.triggers) as string[] } : {}),
      // v26 (DES-184, TASK-189): NULL (every pre-v26 row) reads as 'v1' (ADR-025 grandfather).
      diagramContract: vrow.diagram_contract === 'v2' ? 'v2' : 'v1',
      // v37 P1 (ADR-086's third owner ruling, DES-263's 第三次修訂): read back for the admission
      // predicate's second source and for `workflow_describe` (so an operator can see which
      // version is tainted).
      registeredRemote: vrow.registeredRemote === 1,
      // Issue #82 (option B): the version's default seed, if one was bound at registration.
      ...(vrow.seed_manifest_ref ? { seedManifestRef: vrow.seed_manifest_ref, ...(vrow.seed_namespace ? { seedNamespace: vrow.seed_namespace } : {}) } : {}),
    };
  }

  /** v22 (DES-111): the ONE read read (REPLACES getFull()) — adds name/createdAt/owner/channels/versions. */
  async resolveDetail(name: string, sel: VersionSelector): Promise<WorkflowDetail> {
    const row = this._requireName(name);
    // issue #154 B5: `entry.createdAt` (from `resolve()`) is now the RESOLVED VERSION's own
    // timestamp — spread it through unmodified; do NOT overwrite it with `row.createdAt` (the
    // workflow's first-registration time), which is exactly the bug this fixed.
    const entry = await this.resolve(name, sel);
    return {
      ...entry,
      name,
      owner: row.owner,
      channels: { release: row.release_version, beta: row.beta_version },
      versions: this._listVersions(name),
    };
  }

  /** issue #108: the owner-masking SIBLING of `resolveDetail` — every one of its three call sites
   *  (`RunManager.start()`, `workflowDescribe`, `workflowSource`) already applies the SAME
   *  `canRunResolved` gate AFTER `resolveDetail` succeeds, so a non-owner asking for a real-but-
   *  forbidden version/channel was already answered the masked `VERSION_NOT_FOUND` — but
   *  `resolveDetail` ITSELF throws the real `CHANNEL_UNPUBLISHED`/`VERSION_NOT_FOUND` the moment
   *  `resolveVersionRequest` fails, which happens BEFORE that gate ever runs. A non-owner naming an
   *  unpublished `beta` got `CHANNEL_UNPUBLISHED`; the same non-owner naming a published `beta`
   *  (resolution succeeds, THEN the gate masks it) got `VERSION_NOT_FOUND` — two different codes for
   *  the two states of a channel they can never read anyway, an existence oracle (Q5). Decides the
   *  masking policy BEFORE calling `resolve()` at all (so a would-be-masked request's thrown code
   *  never leaks past this method), using only the owner row and the channel pointers — the exact
   *  same two facts `canRunResolved` reads, just available one step earlier here. Review send-back
   *  (INFO 5): rather than re-deriving `canRunResolved`'s three-branch predicate inline (its own
   *  policy and this method's would silently drift the next time either changes), this CALLS
   *  `canRunResolved` directly once a candidate resolution exists — `channel:'beta'` is refused
   *  UNCONDITIONALLY for a non-owner (published or not — confirming "published" is itself a
   *  disclosure) via that function's own second branch; an explicit `version` (or `channel:'release'`,
   *  or no selector) is let through to the REAL resolution only when it will turn out to equal
   *  today's release pointer (its third branch), so `workflow_describe`-style owner/bypass/ownerless
   *  behaviour and a release-pointed explicit version are BYTE-IDENTICAL to calling `resolveDetail`
   *  directly — only the masked branch's wording changes, never its real content. A failed
   *  resolution (`!verdict.ok` — no version/channel exists to even ask `canRunResolved` about) is
   *  never permitted, the same as the unconditional `'beta'` case. */
  async resolveForActor(name: string, sel: VersionSelector, actor: Actor): Promise<WorkflowDetail> {
    const row = this._requireName(name); // throws CatalogNotFoundError for an unknown name — unrelated to the oracle (issue #108), unaffected
    const known = new Set(this._listVersions(name));
    if (known.size === 0) throw new CatalogNotFoundError(name);
    const channels: Channels = { release: row.release_version, beta: row.beta_version };
    const nonOwner = !canMutate(row.owner, actor);
    const nonRelease = sel.version !== undefined || (sel.channel !== undefined && sel.channel !== 'release');
    if (nonOwner && nonRelease) {
      const verdict = resolveVersionRequest(sel, channels, known);
      const permitted = verdict.ok && canRunResolved(row.owner, actor, verdict.version, channels, sel.channel);
      if (!permitted) {
        const label = sel.version ?? sel.channel ?? 'release';
        throw codedError('VERSION_NOT_FOUND', `VERSION_NOT_FOUND: ${label} (workflow '${name}')`);
      }
    }
    return this.resolveDetail(name, sel);
  }

  /** v22 (DES-111): existence check that never throws — replaces the repo-wide
   *  try/catch-around-the-deleted-accessor pattern (4 call sites). */
  async exists(name: string): Promise<boolean> {
    return this._db.prepare('SELECT 1 FROM workflows WHERE name = ?').get(name) !== undefined;
  }

  async listVersions(name: string): Promise<string[]> {
    return this._listVersions(name);
  }

  /** 2026-09-26 (alias mechanism removed, owner decision 10): the distinct full
   *  `<provider>/<model-id>` refs declared by `agents.<label>.model.default` across EVERY
   *  registered version row of every workflow — release/beta and every other live version, since a
   *  live row is one this engine could still run (`resume()` on a non-released version, a pinned
   *  in-flight run). Deregistered rows are gone from `workflow_versions` already (the single-
   *  deletion-path rule), so nothing extra needs excluding here. Used ONLY as `ModelProber`'s target
   *  set — a malformed/legacy entry is silently skipped by `probeTargets` itself. */
  /** Owner decision 2026-10-02 (CAS cleanup): every registered version's default seed manifest ref
   *  and the CAS namespace it was bound from (null on a row bound without one → read as 'local',
   *  exactly as `RunManager.start()` reads it). These are LIVE roots `workspace_prune_blobs` never
   *  removes. Deregistered rows are already gone from `workflow_versions`. */
  seedManifestRoots(): Array<{ ref: string; namespace: string | null }> {
    return (this._db.prepare('SELECT DISTINCT seed_manifest_ref AS ref, seed_namespace AS namespace FROM workflow_versions WHERE seed_manifest_ref IS NOT NULL')
      .all() as Array<{ ref: string; namespace: string | null }>);
  }

  distinctModelRefs(): string[] {
    const rows = this._db.prepare('SELECT params FROM workflow_versions WHERE params IS NOT NULL').all() as Array<{ params: string }>;
    const refs = new Set<string>();
    for (const row of rows) {
      let parsed: unknown;
      try { parsed = JSON.parse(row.params); } catch { continue; }
      const agents = (parsed as { agents?: Record<string, { model?: { default?: unknown } }> } | null)?.agents;
      if (!agents) continue;
      for (const spec of Object.values(agents)) {
        const ref = spec?.model?.default;
        if (typeof ref === 'string') refs.add(ref);
      }
    }
    return [...refs];
  }

  /** v22 (DES-115/DES-116, REQ-099, TASK-111): re-runs the SAME registration-time structural check
   *  (`validateScriptEntry`) against the CURRENT script — never the registration-time result — so a
   *  script that would now fail to PARSE is visible on every read as staleness, not silently
   *  stale-green forever. Pure re-check: reads no DB row, stores nothing.
   *  2026-09-26 (alias mechanism removed, deliberate drop): this used to ALSO re-check the script's
   *  model literal(s) against the current alias table; that model check is gone (see script-checks.ts's
   *  own header) and nothing replaces it here — a read-time staleness signal for "the model in this
   *  registered version no longer exists" does not exist post-registration (the map's own D5: an
   *  anthropic id is never refused, and re-verifying openrouter/ollama existence on every
   *  workflow_get would mean a live catalog fetch on a read path, which this method's callers do not
   *  expect). issue #103(a): MCP/skill provisioning is no longer re-checked here either — it moved
   *  off `validateScriptEntry` entirely (registration warning + admission refusal, never a read-time
   *  `validation` staleness signal); `workflow_describe`/`workflow_source`'s `validation` field is
   *  PARSE_ERROR-only now. */
  validateCurrent(script: string): ReturnType<typeof validateScriptEntry> {
    return validateScriptEntry(script);
  }

  /** Issue #154 B1-B4 (2026-10-07 reverify): a static registration rule added AFTER a version was
   *  already registered never retroactively applied to it — only a FRESH `register()` call ran the
   *  current rule set (`validateRegistration`'s own pinned pipeline below), so an old row kept
   *  `runnable:true` and kept reproducing whatever bug the new rule exists to catch, forever. This
   *  re-runs the SAME three STATIC, rule-only checks `validateRegistration` applies to a fresh
   *  script — against an ALREADY-STORED version's script — called from every real dispatch door
   *  (`run_start`, `run_resume`, a nested `workflow()` call) so a stale row is refused with a coded
   *  error instead of silently dispatching the exact bug a newer rule was written to close.
   *
   *  Issue #154 B4 PARTIAL (2026-10-07 reverify, FIXED here): name validity (`isValidBareName`) now
   *  JOINS the re-run set. The earlier version of this doc comment claimed re-checking it "can never
   *  produce a different verdict than it did at registration" — true only for a row `register()`
   *  itself produced under the rule's own regime, false for any row that PREDATES the rule (seeded
   *  directly, or genuinely registered before issue #154 B4 shipped): the live reverify measured a
   *  stored row renamed to `../store` staying `runnable:true` and actually completing a `run_start`,
   *  with its agent workspace landing at `<workRoot>/store/runs/<runId>` — the SAME path the run
   *  store's own on-disk directory for that run occupies. Checked FIRST among the four (before
   *  `validateScriptEntry` even runs) for the same "the cheapest, most fundamental check answers
   *  first" reason `validateRegistration` checks it before anything else.
   *
   *  Deliberately NOT re-checked (both documented here, not merely by omission):
   *    - Mermaid/diagram-grammar (`checkMermaid`'s v2 rules) — `diagramContract:'v1'` rows are
   *      EXPLICITLY grandfathered (ADR-025/DES-184); retroactively imposing v26's diagram grammar
   *      on every pre-v26 row would mass-invalidate a large fraction of an existing fleet for a
   *      presentation concern this gap has nothing to do with.
   *    - `TOOL_UNSUPPORTED_BY_HARNESS` — depends on the LIVE deployment's `catalog.harnessProviders`
   *      (gateway:"pi" vs "sdk"), not on anything about the stored row; re-checking it here would
   *      make a row's runnability flap on an unrelated gateway config change.
   *    - Live model-existence (`checkModelRef` against a real openrouter/ollama catalog fetch) —
   *      `parseMetaParams` below is called with `EMPTY_MODEL_CATALOG` (no live catalog), the SAME
   *      "unavailable — accepted without verification" path `checkModelRef` already takes for a
   *      cold/unreachable provider — for the same flapping reason as the harness check above: a
   *      model vanishing from a provider's live listing tomorrow must not retroactively refuse a
   *      row that passed yesterday. Only the STATIC shape/bound checks (declared type/enum/min/max,
   *      locked-key, anthropic static price table) still run.
   *    - `SCRIPT_UNSCANNABLE` (2026-10-08 integration fix) — a row written before the
   *      `nonCodeSpans` oracle existed is EXPLICITLY grandfathered, same precedent as the Mermaid
   *      row above: it stays runnable, with only a read-time marker on `workflow_describe`/the dag
   *      route (tests/integration/scan-unscannable-markers.test.ts, item 6/Gate 8). A genuinely
   *      unparseable script also fails `validateScriptEntry`'s OWN `PARSE_ERROR` check below — that
   *      check still runs and still refuses every OTHER `PARSE_ERROR` cause (e.g. an illegal
   *      top-level function wrapper), just not this one, which is why `scan.unscannable` is read
   *      BEFORE `validateScriptEntry` runs rather than skipping `PARSE_ERROR` wholesale.
   *    - `AGENT_OPT_RETIRED` (scanAgentCalls's code for `agentType` and any other key in
   *      `RETIRED_AGENT_OPT_KEYS` specifically — NOT `PARAM_UNKNOWN`, the separate catch-all for a
   *      key that never worked at all, e.g. a typo: that one stays refused, below) for the
   *      `agentType` retirement (2026-10-08 integration fix; REQ-203/DES-224/226) — a PRE-v34
   *      pinned row carrying `agentType` is the ONLY way dispatch's own `agent-executor.ts` runtime
   *      guard is ever reached (it throws the DIFFERENT code `PARAM_UNKNOWN` at that point — a
   *      separate mapping, unrelated to scanAgentCalls's violation-code naming); that refusal is
   *      DELIBERATELY at dispatch, with a structured per-agent detail, never a blanket admission
   *      NOT_RUNNABLE (tests/integration/resume-legacy-params.test.ts IT-176,
   *      tests/integration/refusal-marker-real-child.test.ts IT-298 — both use `agentType` only).
   *
   *  Memoized per (name,version) in `_stalenessCache` — see that field's own doc. */
  async validateStoredVersion(name: string, version: string): Promise<{ ok: true } | { ok: false; code: ErrorCode; message: string; detail?: Record<string, unknown> }> {
    const cacheKey = `${name}@${version}`;
    const cached = this._stalenessCache.get(cacheKey);
    if (cached) return cached;
    const row = this._db
      .prepare('SELECT script FROM workflow_versions WHERE name = ? AND version = ?')
      .get(name, version) as { script: string } | undefined;
    // Every real caller has already resolved (name, version) through `resolve()` immediately
    // before calling this — an absent row here would mean the row vanished between that resolve
    // and this call, which `register()`/`deregisterVersion()`'s own transactional semantics make
    // unreachable in practice. Fail OPEN (not a fabricated refusal for a row this method cannot
    // even examine) rather than invent a verdict about content it never saw.
    if (!row) return { ok: true };
    const result = this._computeStoredVersionValidity(name, row.script);
    this._stalenessCache.set(cacheKey, result);
    return result;
  }

  /** The four re-run checks (name validity, then the SAME three PINNED to the relative order
   *  `validateRegistration` uses for them: `validateScriptEntry` → `scanAgentCalls` →
   *  `parseMetaParams`), stopping at the first failure — same "first error wins, the rest never
   *  run" convention every other registration-time check in this file already follows.
   *  `scanAgentCalls` is actually CALLED once before `validateScriptEntry` now (2026-10-08
   *  integration fix) — only to peek at `scan.unscannable` for the grandfather short-circuit this
   *  method's own class-level doc describes; its OWN violations are still consulted in the pinned
   *  relative order, after `validateScriptEntry`. */
  private _computeStoredVersionValidity(name: string, script: string): { ok: true } | { ok: false; code: ErrorCode; message: string; detail?: Record<string, unknown> } {
    // Issue #154 B4 PARTIAL: checked FIRST, same ordering rationale as `validateRegistration`'s own
    // RESERVED_PREFIX/INVALID_NAME pair at the top of that method — a row whose name predates this
    // rule must come back INVALID_NAME, not some other code a later check happens to hit first.
    if (!isValidBareName(name)) {
      return {
        ok: false,
        code: 'NOT_RUNNABLE',
        message: `NOT_RUNNABLE: this version's name ('${name}') is no longer a valid workflow name (INVALID_NAME) — re-register it under a valid name`,
        detail: { violation: 'INVALID_NAME' },
      };
    }
    // 2026-10-08 integration (rv) fix: `scanAgentCalls` runs FIRST now (ahead of its pinned
    // position below `validateScriptEntry`) ONLY to read `scan.unscannable` — a row written before
    // the `nonCodeSpans` oracle existed (the SAME condition `scanAgentCalls` itself reports as the
    // `SCRIPT_UNSCANNABLE` violation below) stays RUNNABLE by design: only a read-time marker fires
    // (`workflow_describe.toolSurfaceUnscannable`, the dag route's
    // `PREDICTED_OVERLAY_UNAVAILABLE`), never an admission refusal
    // (tests/integration/scan-unscannable-markers.test.ts, item 6/Gate 8). Genuinely unparseable
    // JS fails `validateScriptEntry` too (as `PARSE_ERROR`, a DIFFERENT code than `scanAgentCalls`'s
    // own `SCRIPT_UNSCANNABLE`) — checking `scan.unscannable` before that gate, instead of trying
    // to special-case `PARSE_ERROR` there, keeps `validateScriptEntry`'s OTHER `PARSE_ERROR` cases
    // (e.g. an illegal top-level function wrapper — a real, intentional, pre-#154 registration
    // rule with no such grandfather) refusing NOT_RUNNABLE exactly as before.
    const scan = scanAgentCalls(script);
    if (scan.unscannable) return { ok: true };
    const scriptCheck = validateScriptEntry(script);
    if (!scriptCheck.ok) {
      const first = scriptCheck.errors[0]!;
      return {
        ok: false,
        code: 'NOT_RUNNABLE',
        message: `NOT_RUNNABLE: this version no longer passes registration-time validation (${first.code}: ${first.message}) — re-register it to fix or confirm the script`,
        detail: { violation: first.code, ...first.detail },
      };
    }
    // 2026-10-08 integration (rv) fix: `AGENT_OPT_RETIRED` ONLY (the `agentType` retirement,
    // REQ-203/DES-224/226) is likewise EXCLUDED from this re-check — a PRE-v34 pinned row carrying
    // `agentType` is the ONLY way dispatch's own `agent-executor.ts` runtime guard is ever reached;
    // REQ-203's whole point is that THIS refusal happens at DISPATCH, with a structured per-agent
    // detail, not as a blanket admission NOT_RUNNABLE (tests/integration/resume-legacy-params.test.ts
    // IT-176, tests/integration/refusal-marker-real-child.test.ts IT-298 — both exercise `agentType`
    // specifically, never a merely-unrecognized key). `PARAM_UNKNOWN` (a key that NEVER worked —
    // e.g. a typo'd `alowedTools`) is deliberately NOT in this exclusion: nothing else in the engine
    // defers it to dispatch, so a stale row carrying one is exactly "a bug a newer/any rule exists
    // to catch" and must still refuse here. Every OTHER violation code (the actual #154 NEW-HIGH
    // targets: AGENT_LABEL_*, AGENT_OPTS_SPREAD/SHORTHAND/VALUE_NOT_LITERAL/NOT_LITERAL,
    // PARAM_IN_SCRIPT, PARAM_UNKNOWN) still refuses NOT_RUNNABLE here unchanged.
    const GRANDFATHERED_SCAN_CODES = new Set<AgentCallViolationCode>(['AGENT_OPT_RETIRED']);
    const staleViolation = scan.violations.find((v) => !GRANDFATHERED_SCAN_CODES.has(v.code));
    if (staleViolation !== undefined) {
      const v = staleViolation;
      return {
        ok: false,
        code: 'NOT_RUNNABLE',
        message: `NOT_RUNNABLE: this version no longer passes registration-time validation (${v.code}: ${v.hint}, line ${v.line}) — re-register it to fix or confirm the script`,
        detail: { violation: v.code, line: v.line, ...(v.key !== undefined ? { key: v.key } : {}) },
      };
    }
    // EMPTY_MODEL_CATALOG — see this method's own doc for why no live catalog is passed here.
    const paramsResult = parseMetaParams(script, EMPTY_MODEL_CATALOG);
    if (!paramsResult.ok) {
      return {
        ok: false,
        code: 'NOT_RUNNABLE',
        message: `NOT_RUNNABLE: this version no longer passes registration-time validation (${paramsResult.code}: ${paramsResult.message}) — re-register it to fix or confirm the script`,
        detail: { violation: paramsResult.code, ...paramsResult.detail },
      };
    }
    return { ok: true };
  }

  /** v22 (DES-111, REQ-097): moves a named channel pointer to an already-registered version.
   *  Ownership-gated like register/deregister.
   *  Issue #98 item 8: `version: null` CLEARS the channel (sets its column back to NULL) instead of
   *  pointing it — the same authz as a normal publish, no `VERSION_NOT_FOUND` check (there is no
   *  version to look up), and `resolve()`'s existing NULL-pointer branch (line ~126/131 above)
   *  already answers CHANNEL_UNPUBLISHED for it, exactly as it does for a channel that was never
   *  published — no change needed there. This is the clearing mechanism `VERSION_PINNED_BY_CHANNEL`
   *  (deregisterVersion, below) tells a caller to use before it retires the last surviving code path
   *  that could ever produce that refusal for a channel with no other way to become unpinned. */
  async publish(name: string, version: string | null, channel: Channel, principalOrActor: string | null | Actor): Promise<{ channel: Channel; version: string | null; from: string | null }> {
    const actor: Actor = isActor(principalOrActor) ? principalOrActor : actorFromPrincipal(principalOrActor);
    const row = this._requireName(name);
    if (!canMutate(row.owner, actor)) {
      throw codedError('NOT_WORKFLOW_OWNER', `NOT_WORKFLOW_OWNER: workflow '${name}' is not owned by the caller`);
    }
    if (version !== null) {
      const known = new Set(this._listVersions(name));
      if (!known.has(version)) {
        throw codedError('VERSION_NOT_FOUND', `VERSION_NOT_FOUND: '${version}' is not a registered version of '${name}'`);
      }
    }
    const column = channel === 'release' ? 'release_version' : 'beta_version';
    const from = channel === 'release' ? row.release_version : row.beta_version;
    this._db.transaction(() => {
      this._db.prepare(`UPDATE workflows SET ${column} = ? WHERE name = ?`).run(version, name);
    }).immediate();
    // v36 (DES-243/244, TASK-242, REQ-213/212): the bare console.log line is GONE, not duplicated
    // — the same audit line now goes through the injected, redacting `_eventSink`.
    this._eventSink({ kind: 'catalog.publish', name, version, channel, fromVersion: from, actor });
    return { channel, version, from };
  }

  // issue #93 item 3: `registeredRemote` joins the projection — the SAME column `resolveDetail()`
  // already reads for `workflow_describe`, added here so `workflow_list`'s own `runnable` can be
  // just as truthful about a version this host would actually refuse to run.
  async list(): Promise<Array<{ name: string; version: string; createdAt: string; owner: string | null; description: string; params: ParamContract | undefined; versions: string[]; channels: Channels; registeredRemote: boolean }>> {
    // v9 (REQ-061): surface each workflow's purpose (meta.description) so a client can see WHAT each
    // one does without reading its script — parsed on-demand from the stored script (always in sync).
    // v22 (DES-111): `version`/`description`/`params` describe the RELEASE channel's version when
    // published, else `beta`, else the newest registered version (a draft with no channel is still
    // visible in the listing, just not runnable by name yet).
    // v24 adjudication #6 F-4: `owner` joins the projection. `workflow_list` has advertised an
    // `owner` field since v24 and this query never selected the column, so every caller read
    // `null` — "this workflow has no owner" — for every workflow on every deployment.
    const rows = this._db.prepare('SELECT name, createdAt, owner, release_version, beta_version FROM workflows').all() as Array<{
      name: string; createdAt: string; owner: string | null; release_version: string | null; beta_version: string | null;
    }>;
    return rows.map((r) => {
      const versions = this._listVersions(r.name);
      const channels: Channels = { release: r.release_version, beta: r.beta_version };
      const version = r.release_version ?? r.beta_version ?? versions[versions.length - 1] ?? '';
      const vrow = version
        ? (this._db.prepare('SELECT script, params, registeredRemote, createdAt FROM workflow_versions WHERE name = ? AND version = ?').get(r.name, version) as { script: string; params: string | null; registeredRemote: number; createdAt: string } | undefined)
        : undefined;
      return {
        // issue #154 B5: the listed row's createdAt is the RESOLVED VERSION's own timestamp (same
        // fix as resolveDetail) — falls back to the workflow-level createdAt only for the
        // unreachable-via-register() zero-version case `resolve()`'s own comment above describes.
        name: r.name, version, createdAt: vrow?.createdAt ?? r.createdAt, owner: r.owner,
        description: parseMeta(vrow?.script ?? '').description,
        params: vrow?.params ? JSON.parse(vrow.params) as ParamContract : undefined,
        versions, channels,
        registeredRemote: vrow?.registeredRemote === 1,
      };
    });
  }

  workFolder(name: string): string {
    const workflowsRoot = join(this._workRoot, 'workflows');
    const folder = join(workflowsRoot, name);
    // Issue #154 B4, layer 2 (defense in depth): `validateRegistration` is the primary fix — a name
    // that reaches here has normally already passed `isValidBareName` there — but this is a
    // CONTAINMENT check (not a charset check) specifically so it does not reject the `'_adhoc'`
    // sentinel (run-manager.ts's `spec.name ?? '_adhoc'`) or any other internally-constructed name
    // that never goes through registration at all: anything that resolves INSIDE this workflow's
    // own subtree is accepted regardless of its shape, and only a genuine escape is refused. A
    // future caller that bypasses `validateRegistration` (an internal call, a migration, …) still
    // cannot produce a path outside it through this method.
    //
    // Issue #154 B4 PARTIAL (2026-10-07 reverify, FIXED here): contained against `workflowsRoot`
    // (`<workRoot>/workflows`), NOT `this._workRoot` at large as before — `join(workRoot,
    // 'workflows', '../store')` resolves to `<workRoot>/store`, which IS still inside `workRoot`,
    // so the old check saw no escape at all for a one-level-up name. `<workRoot>/store` is exactly
    // where this engine's own `RunStore` keeps its on-disk state (the `store` subdirectory every
    // real deployment and this repo's own fixtures construct it with) — a workflow named
    // `../store` could alias its own agent workspace onto the run store's directory. A name with
    // enough `..` segments to escape `workRoot` ENTIRELY was already caught by the old check and
    // still is here (the same escape, just checked against a narrower, correct root).
    if (!isPathContained(folder, workflowsRoot)) {
      throw codedError('INVALID_NAME', `INVALID_NAME: workflow name '${name}' resolves outside the engine's workflows directory`);
    }
    return folder;
  }

  runWorkspace(name: string, runId: string): string {
    const ws = join(this.workFolder(name), 'runs', runId);
    this._runWorkspaces.set(runId, ws);
    return ws;
  }

  /** Resolves a relative path inside the run workspace; throws WorkspaceEscapeError on escape attempts. */
  resolveInWorkspace(runId: string, rel: string): string {
    const base = this._runWorkspaces.get(runId) ?? join(this._workRoot, '_runs', runId);
    if (isAbsolute(rel)) throw new WorkspaceEscapeError(rel);
    const resolved = resolve(base, rel);
    if (resolved !== base && !resolved.startsWith(base + sep)) throw new WorkspaceEscapeError(rel);
    return resolved;
  }
}
