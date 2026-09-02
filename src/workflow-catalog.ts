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
import { mkdirSync } from 'node:fs';
import { join, resolve, sep, isAbsolute } from 'node:path';
import { CatalogNotFoundError, WorkspaceEscapeError, codedError } from './errors.js';
import { parseMeta, parseMetaParams } from './workflow-meta.js';
import type { Clock } from './clock.js';
import { SystemClock } from './clock.js';
import { validateHarnessDefaults, type HarnessDefaults } from './harness-defaults.js';
// v21 Gate 6 adjudication (A-1): type-only import — erases at compile, no runtime edge, and this
// file is not one the sandbox child loads, so the .js->.ts child-import hazard does not apply.
// Bars a VALUE import only (which would drag the validator into a module the catalog stays
// independent of); typing get()/getFull()'s `params` as ParamContract|undefined instead of
// `unknown` is the point of the adjudication; list() carries the same typing.
import type { ParamContract, Ceilings } from './params/contract.js';
// v21 adjudication #6 (F-2): value import sanctioned for THIS file only — the catalog already
// throws PARAM_CONTRACT_INVALID itself (already doing validation) and already carries the A-1
// type-only import above; a second hand-rolled bounds checker here is exactly the drift class
// that has bitten this iteration twice (P-A2, R-G10). No sandbox-child hazard: this file is
// server-side (loads better-sqlite3) and contract.ts is already value-imported by run-manager.ts.
import { canonicalContract, checkValueAgainstSpec, effectiveBounds } from './params/contract.js';
// v22 (DES-111, DES-112, TASK-107): the lifted, pure registration-enforcement checks (TASK-106) —
// same codes submission used to produce, so no caller learns a new vocabulary (ADR-013).
import { validateScriptEntry, violatesFrameDelimiter } from './script-checks.js';

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

// DES-098: hardcoded operator email for boot backfill of NULL-owner rows
const BOOT_BACKFILL_EMAIL = 'hsuhungjung@gmail.com';

// v21 Gate 5 re-run (A-2, DES-103): does a declared `params.knobs.<key>.default` violate a given
// spec's type/enum/min/max (either the knob's OWN declared bounds, or a ceiling-narrowed one)?
// v21 adjudication #6 (F-2): was a hand-rolled duplicate of contract.ts's bounds predicate;
// now delegates to the shared `checkValueAgainstSpec` (see import above).
function violatesOwnSpec(value: unknown, spec: Parameters<typeof checkValueAgainstSpec>[2]): boolean {
  return !checkValueAgainstSpec('', value, spec).ok;
}

// v22 (DES-110): the total, pure resolution truth table — explicit `version` wins over any
// `channel` (REQ-097 "regardless of any channel"); a NULL channel pointer is CHANNEL_UNPUBLISHED,
// NEVER a fallback to the newest row (ADR-009). One caller (resolve()) — kept in this module rather
// than a separate file per DES-110.
export type Channel = 'beta' | 'release';
export interface Channels { release: string | null; beta: string | null }
export interface VersionSelector { version?: string; channel?: Channel }
export type ResolveErrorCode = 'INVALID_CHANNEL' | 'UNKNOWN_VERSION' | 'CHANNEL_UNPUBLISHED' | 'DANGLING_CHANNEL';
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
    return { ok: false, code: 'UNKNOWN_VERSION', version: sel.version };
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
export interface VersionEntry { script: string; version: string; defaults?: HarnessDefaults; params?: ParamContract }
export interface WorkflowDetail extends VersionEntry {
  name: string; createdAt: string; owner: string | null; channels: Channels; versions: string[];
}

export interface WorkflowCatalogOpts {
  /** When set and auth is enabled, backfill NULL-owner rows to this email at construction time. */
  backfillOwner?: boolean;
  /** Set of valid model alias names for register-time validation (D-AUTH-5-B). */
  aliasNames?: Set<string>;
  /** v22 (DES-112, TASK-107): registration-time MCP-name existence predicate, forwarded straight
   *  into validateScriptEntry's ports — never the registry object itself. Omitted -> every name
   *  passes (matches the pre-v22 no-MCP-registry-wired construction). */
  mcpLookup?: (name: string) => boolean;
  /** v22 (DES-112): forwarded into validateScriptEntry's ports; same REQ-038 default as
   *  SubmissionValidator's own openrouterPassthrough. */
  openrouterPassthrough?: boolean;
  /** v21 adjudication #6 (F-1 ceiling interaction) + #7 (G-1): engine ceilings, so ANY value that
   *  reaches the stored `defaults` column above the configured ceiling (e.g. `effort` above
   *  `maxEffort`) is refused at registration — a declared `params.knobs.<knob>.default` and a
   *  caller-supplied `defaults.<knob>` alike, instead of registering above a bound admission
   *  enforces. Must be the SAME object forwarded to RunManager/McpFacade (server.ts). */
  ceilings?: Ceilings;
}

export class WorkflowCatalog {
  private readonly _db: Database.Database;
  private readonly _runWorkspaces = new Map<string, string>(); // runId -> workspace dir
  private readonly _clock: Clock;
  private readonly _workRoot: string;
  private readonly _aliasNames?: Set<string>;
  private readonly _ceilings?: Ceilings;
  private readonly _mcpLookup: (name: string) => boolean;
  private readonly _openrouterPassthrough: boolean;

  constructor(workRoot: string, clock?: Clock, opts?: WorkflowCatalogOpts) {
    this._workRoot = workRoot;
    this._clock = clock ?? new SystemClock();
    this._aliasNames = opts?.aliasNames;
    this._ceilings = opts?.ceilings;
    this._mcpLookup = opts?.mcpLookup ?? (() => true);
    this._openrouterPassthrough = opts?.openrouterPassthrough ?? true;
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
    // DES-098: idempotent boot backfill — NULL-owner rows → operator email; once/boot, self-limiting
    if (opts?.backfillOwner) {
      const n = this._db
        .prepare("UPDATE workflows SET owner = ? WHERE owner IS NULL")
        .run(BOOT_BACKFILL_EMAIL).changes;
      if (n > 0) {
        console.log(`auth.migrate: ${n} workflows backfilled to owner=${BOOT_BACKFILL_EMAIL}`);
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

  // v15 (DES-098, DES-099, TASK-089): ownership gate + harness defaults registration.
  async register(
    name: string,
    script: string,
    defaults?: HarnessDefaults,
    principal: string | null = null,
  ): Promise<{ version: string }> {
    // v22 (DES-111, DES-112, DES-117, TASK-107): validateScriptEntry runs FIRST, before any other
    // check or write (ADR-013 — registration ENFORCES fail-closed). Same codes submission used to
    // produce (PARSE_ERROR / UNKNOWN_ALIAS / MCP_NOT_PROVISIONED); all errors surface, the first is
    // thrown, the rest travel in `detail.errors`.
    const scriptCheck = validateScriptEntry(script, {
      aliases: this._aliasNames ?? new Set(),
      openrouterPassthrough: this._openrouterPassthrough,
      mcpLookup: this._mcpLookup,
    });
    if (!scriptCheck.ok) {
      const [first, ...rest] = scriptCheck.errors;
      throw Object.assign(codedError(first!.code, first!.message), { detail: { ...first!.detail, errors: [first, ...rest] } });
    }

    // P6-2 registration half (S-1 debt closed, DES-117): an author-declared defaults.appendPrompt
    // carrying a forged frame-close delimiter is refused here — same shared predicate the admission
    // rung (run-manager.ts) re-checks post-merge, reported by size only, never by content.
    if (defaults && typeof (defaults as Record<string, unknown>)['appendPrompt'] === 'string') {
      const appendPrompt = (defaults as Record<string, unknown>)['appendPrompt'] as string;
      if (violatesFrameDelimiter(appendPrompt)) {
        throw codedError('PARAM_CONTRACT_INVALID', 'defaults.appendPrompt cannot contain the user-instructions frame close delimiter');
      }
    }

    // D-AUTH-5 (DES-099): validate defaults before any DB operation (fail-closed, no partial write)
    if (defaults !== undefined) {
      const result = validateHarnessDefaults(defaults as Record<string, unknown>, this._aliasNames);
      if (!result.ok) {
        throw codedError('HARNESS_DEFAULTS_INVALID', result.message);
      }
    }

    // v21 (DES-103, DES-101, ARCH-067, TASK-099): parse+validate meta.params before any DB
    // operation — fail-closed, nothing stored (same precedent as HARNESS_DEFAULTS_INVALID above).
    const paramsResult = parseMetaParams(script, this._aliasNames ?? new Set());
    if (!paramsResult.ok) {
      throw codedError(paramsResult.code, paramsResult.message);
    }
    const paramsJson = JSON.stringify(paramsResult.value);

    // v21 Gate 5 re-run (A-2, DES-103): cross-validate each declared knob default — against its
    // own spec, then against defaults.<knob> — before any DB write. A disagreement or an
    // out-of-own-bounds default is a typed rejection with nothing stored (same D-AUTH-5-E
    // fail-closed precedent as HARNESS_DEFAULTS_INVALID above). A declared default with no
    // corresponding defaults.<knob> is accept-and-normalize: written into the stored defaults so
    // the served default is always DERIVED from the defaults column, never a second source.
    const effectiveDefaults: Record<string, unknown> = defaults ? { ...defaults } : {};
    for (const [key, spec] of Object.entries(paramsResult.value.knobs)) {
      if (spec.default === undefined) continue;
      if (violatesOwnSpec(spec.default, spec)) {
        throw codedError('PARAM_CONTRACT_INVALID', `params.knobs.${key}.default violates its own declared bounds`);
      }
      // v21 adjudication #6 (F-1): adjudication #5's E-3 ("reject a default for a knob no rung can
      // apply") is SUPERSEDED — REQ-090's own acceptance text permits a declared default on every
      // tunable knob, `effort`/`appendPrompt` included (D12). Widen, don't reject: every declared
      // knob default is normalized into the stored `defaults`/`effectiveDefaults` here; the two
      // author-only knobs becoming readable by a rung (`defaultRunParams`, KNOWN_KEYS) is TASK-098/104's
      // side of this fix, not this file's.
      if (key in effectiveDefaults) {
        if (effectiveDefaults[key] !== spec.default) {
          throw codedError('PARAM_CONTRACT_INVALID', `params.knobs.${key}.default disagrees with defaults.${key}`);
        }
      } else {
        effectiveDefaults[key] = spec.default;
      }
    }

    // v21 adjudication #6 (F-1 ceiling interaction) + #7 (G-1): ONE ceiling pass over the FINAL
    // stored defaults — the values that actually reach the `defaults` column, whether they arrived
    // as a caller-supplied `defaults.<knob>` or were normalized out of a declared
    // `params.knobs.<knob>.default` above. Running it inside the declared-knob loop (its former
    // home) left G-1's hole: that loop only ever visits knobs the AUTHOR declared a default for, so
    // `defaults: {effort:'max'}` with no `params` block at all was ceiling-checked nowhere —
    // `validateHarnessDefaults` has no ceilings, and admission re-checks only the caller's
    // `overrides`, never the registered defaults. Bounds come from the canonical contract narrowed
    // by live config, i.e. the CEILING alone (the author's own bounds are already enforced above),
    // via the same `effectiveBounds`/`checkValueAgainstSpec` pair the read and admission rungs use —
    // so registration can never refuse against a different number than admission enforces.
    const ceilingKnobs = this._ceilings ? effectiveBounds(canonicalContract(), this._ceilings).knobs : undefined;
    for (const [key, value] of Object.entries(effectiveDefaults)) {
      const ceilingSpec = ceilingKnobs?.[key];
      if (ceilingSpec === undefined) continue; // not a ceiling-bounded knob (tools/skills/prompt)
      // The rejection code follows the value's ORIGIN, so the caller sees the input they supplied
      // named back: a caller `defaults` key answers under the D-AUTH-5 family's
      // HARNESS_DEFAULTS_INVALID, a declared knob default under PARAM_CONTRACT_INVALID.
      const fromCaller = defaults !== undefined && key in defaults;
      const code = fromCaller ? 'HARNESS_DEFAULTS_INVALID' : 'PARAM_CONTRACT_INVALID';
      const label = fromCaller ? `defaults.${key}` : `params.knobs.${key}.default`;
      // appendPrompt's ceiling is a byte cap, not a spec-shaped bound (DES-101 row 6) — checked by
      // size only, never echoing the text (same "report by size, never by content" rule
      // contract.ts's validateUserOverrides applies to a caller-supplied appendPrompt).
      if (key === 'appendPrompt' && typeof value === 'string') {
        const bytes = Buffer.byteLength(value, 'utf8');
        if (bytes > this._ceilings!.maxAppendPromptBytes) {
          throw codedError(code, `${label} exceeds the engine's configured byte ceiling (${bytes} > ${this._ceilings!.maxAppendPromptBytes} bytes)`);
        }
        continue;
      }
      if (violatesOwnSpec(value, ceilingSpec)) {
        throw codedError(code, `${label} exceeds the engine's configured ceiling`);
      }
    }

    // v22 (DES-111): register only ever INSERTs a new (name, version) row — never
    // ON CONFLICT DO UPDATE. version = v<max+1> over that name's OWN rows; published to no channel
    // (REQ-097 — registration ≠ publication). The ownership read, the version-count read, and the
    // two writes all live inside ONE `.immediate()` transaction: `.immediate()` acquires the write
    // lock up front (plain `db.transaction` is deferred — two processes could otherwise both read
    // the same max(version) before either writes). Residual PK/BUSY races map to a typed
    // REGISTRATION_CONFLICT instead of an untyped 500.
    const defaultsJson = Object.keys(effectiveDefaults).length > 0 ? JSON.stringify(effectiveDefaults) : null;
    const createdAt = this._clock.isoNow();
    let version = '';
    try {
      version = this._db.transaction((): string => {
        const existing = this._db.prepare('SELECT owner FROM workflows WHERE name = ?').get(name) as
          | { owner: string | null }
          | undefined;
        // DES-098: ownership gate — only non-null principal is gated; null principal = auth-disabled (D-AUTH-6)
        if (existing && existing.owner && principal !== null && existing.owner !== principal) {
          throw codedError('NOT_WORKFLOW_OWNER', `NOT_WORKFLOW_OWNER: workflow '${name}' is owned by ${existing.owner}`);
        }
        const count = (this._db.prepare('SELECT COUNT(*) AS n FROM workflow_versions WHERE name = ?').get(name) as { n: number }).n;
        const maxWorkflowVersions = (this._ceilings as (Ceilings & { maxWorkflowVersions?: number }) | undefined)?.maxWorkflowVersions;
        if (maxWorkflowVersions !== undefined && count >= maxWorkflowVersions) {
          throw codedError(
            'VERSION_CEILING_EXCEEDED',
            `VERSION_CEILING_EXCEEDED: workflow '${name}' already has ${count} version(s) (maximum ${maxWorkflowVersions}) — deregister an old version, or raise the engine's maxWorkflowVersions ceiling`,
          );
        }
        // v22 send-back H3 (07-review.md §4.2, ARCH-071 inv 7): the allocator must be the MAX over
        // the name's existing rows, not a COUNT — a migrated-then-re-registered name (e.g. one row
        // at 'v7') must allocate 'v8', not 'v2'; COUNT also collides on a gapped version history.
        // Same expression _listVersions (:402) already uses for ordering.
        const maxVersion = (this._db
          .prepare('SELECT MAX(CAST(SUBSTR(version, 2) AS INTEGER)) AS m FROM workflow_versions WHERE name = ?')
          .get(name) as { m: number | null }).m;
        const v = `v${(maxVersion ?? 0) + 1}`;
        const owner = existing?.owner ?? principal;
        if (!existing) {
          this._db.prepare('INSERT INTO workflows (name, createdAt, owner) VALUES (?, ?, ?)').run(name, createdAt, owner);
        }
        this._db
          .prepare('INSERT INTO workflow_versions (name, version, script, defaults, params, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
          .run(name, v, script, defaultsJson, paramsJson, createdAt);
        return v;
      }).immediate();
    } catch (err) {
      const sqliteCode = (err as { code?: string } | undefined)?.code;
      if (sqliteCode === 'SQLITE_BUSY' || sqliteCode === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        throw codedError('REGISTRATION_CONFLICT', `REGISTRATION_CONFLICT: concurrent registration of '${name}' — retry`);
      }
      throw err;
    }
    return { version };
  }

  /** Remove a registered workflow (and every version row) from the catalog. `removed:false` when the
   *  name was not present. Name-granular only — no per-version delete in v22 (DES-111, D2). Prior
   *  runs' journals keep their own scriptVersion pin, so this only affects future run-by-name.
   *  v15 (DES-098, TASK-089): ownership gate — non-owner principal → NOT_WORKFLOW_OWNER. */
  async deregister(name: string, principal: string | null = null): Promise<{ removed: boolean }> {
    const existing = this._db.prepare('SELECT owner FROM workflows WHERE name = ?').get(name) as
      | { owner: string | null }
      | undefined;

    if (existing && existing.owner && principal !== null && existing.owner !== principal) {
      throw codedError('NOT_WORKFLOW_OWNER', `NOT_WORKFLOW_OWNER: workflow '${name}' is owned by ${existing.owner}`);
    }

    const info = this._db.transaction(() => {
      this._db.prepare('DELETE FROM workflow_versions WHERE name = ?').run(name);
      this._db.prepare('DELETE FROM workflow_diagrams WHERE name = ?').run(name); // v23 (DES-130): same transaction, so a mid-transaction throw leaves both present
      return this._db.prepare('DELETE FROM workflows WHERE name = ?').run(name);
    }).immediate();
    return { removed: info.changes > 0 };
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
    // same as an unknown workflow rather than a confusing UNKNOWN_VERSION/CHANNEL_UNPUBLISHED.
    if (known.size === 0) throw new CatalogNotFoundError(name);
    const channels: Channels = { release: row.release_version, beta: row.beta_version };
    const result = resolveVersionRequest(sel, channels, known);
    if (!result.ok) {
      throw codedError(result.code, `${result.code}: ${result.channel ?? result.version ?? ''} (workflow '${name}')`.trim());
    }
    const vrow = this._db
      .prepare('SELECT script, defaults, params FROM workflow_versions WHERE name = ? AND version = ?')
      .get(name, result.version) as { script: string; defaults: string | null; params: string | null };
    return {
      script: vrow.script,
      version: result.version,
      defaults: vrow.defaults ? JSON.parse(vrow.defaults) as HarnessDefaults : undefined,
      params: vrow.params ? JSON.parse(vrow.params) as ParamContract : undefined,
    };
  }

  /** v22 (DES-111): the ONE read read (REPLACES getFull()) — adds name/createdAt/owner/channels/versions. */
  async resolveDetail(name: string, sel: VersionSelector): Promise<WorkflowDetail> {
    const row = this._requireName(name);
    const entry = await this.resolve(name, sel);
    return {
      ...entry,
      name,
      createdAt: row.createdAt,
      owner: row.owner,
      channels: { release: row.release_version, beta: row.beta_version },
      versions: this._listVersions(name),
    };
  }

  /** v22 (DES-111): existence check that never throws — replaces the repo-wide
   *  try/catch-around-the-deleted-accessor pattern (4 call sites). */
  async exists(name: string): Promise<boolean> {
    return this._db.prepare('SELECT 1 FROM workflows WHERE name = ?').get(name) !== undefined;
  }

  async listVersions(name: string): Promise<string[]> {
    return this._listVersions(name);
  }

  /** v22 (DES-115/DES-116, REQ-099, TASK-111): re-runs the SAME registration-time checks
   *  (`validateScriptEntry`, same ports this instance already validates `register()` with) against
   *  the CURRENT alias/MCP config — never the registration-time result — so an alias removed (or an
   *  MCP no longer provisioned) AFTER a workflow was registered is visible on every read as
   *  staleness, not silently stale-green forever. Pure re-check: reads no DB row, stores nothing. */
  validateCurrent(script: string): ReturnType<typeof validateScriptEntry> {
    return validateScriptEntry(script, {
      aliases: this._aliasNames ?? new Set(),
      openrouterPassthrough: this._openrouterPassthrough,
      mcpLookup: this._mcpLookup,
    });
  }

  /** v22 (DES-111, REQ-097): moves a named channel pointer to an already-registered version.
   *  Ownership-gated like register/deregister. */
  async publish(name: string, version: string, channel: Channel, principal: string | null): Promise<{ channel: Channel; version: string; from: string | null }> {
    const row = this._requireName(name);
    if (row.owner && principal !== null && row.owner !== principal) {
      throw codedError('NOT_WORKFLOW_OWNER', `NOT_WORKFLOW_OWNER: workflow '${name}' is owned by ${row.owner}`);
    }
    const known = new Set(this._listVersions(name));
    if (!known.has(version)) {
      throw codedError('UNKNOWN_VERSION', `UNKNOWN_VERSION: '${version}' is not a registered version of '${name}'`);
    }
    const column = channel === 'release' ? 'release_version' : 'beta_version';
    const from = channel === 'release' ? row.release_version : row.beta_version;
    this._db.transaction(() => {
      this._db.prepare(`UPDATE workflows SET ${column} = ? WHERE name = ?`).run(version, name);
    }).immediate();
    const at = this._clock.isoNow();
    // DES-111: one structured log line per publish — fields are the documented contract.
    console.log(`catalog.publish: ${JSON.stringify({ name, channel, fromVersion: from, toVersion: version, principal, at })}`);
    return { channel, version, from };
  }

  async list(): Promise<Array<{ name: string; version: string; createdAt: string; description: string; params: ParamContract | undefined; versions: string[]; channels: Channels }>> {
    // v9 (REQ-061): surface each workflow's purpose (meta.description) so a client can see WHAT each
    // one does without reading its script — parsed on-demand from the stored script (always in sync).
    // v22 (DES-111): `version`/`description`/`params` describe the RELEASE channel's version when
    // published, else `beta`, else the newest registered version (a draft with no channel is still
    // visible in the listing, just not runnable by name yet).
    const rows = this._db.prepare('SELECT name, createdAt, release_version, beta_version FROM workflows').all() as Array<{
      name: string; createdAt: string; release_version: string | null; beta_version: string | null;
    }>;
    return rows.map((r) => {
      const versions = this._listVersions(r.name);
      const channels: Channels = { release: r.release_version, beta: r.beta_version };
      const version = r.release_version ?? r.beta_version ?? versions[versions.length - 1] ?? '';
      const vrow = version
        ? (this._db.prepare('SELECT script, params FROM workflow_versions WHERE name = ? AND version = ?').get(r.name, version) as { script: string; params: string | null } | undefined)
        : undefined;
      return {
        name: r.name, version, createdAt: r.createdAt,
        description: parseMeta(vrow?.script ?? '').description,
        params: vrow?.params ? JSON.parse(vrow.params) as ParamContract : undefined,
        versions, channels,
      };
    });
  }

  workFolder(name: string): string {
    return join(this._workRoot, 'workflows', name);
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
