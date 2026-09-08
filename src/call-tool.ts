// src/call-tool.ts (v24 DES-140, ARCH-089, TASK-147): one ToolDeps object, schema BEFORE authz,
// one switch. Replaces the pre-v24 `callTool` (server.ts:868-1043) that took 14 positional
// parameters plus a name/args/principal/authEnabled tail — the v24 tool surface is entirely new
// names (TOOL_SPECS, tool-specs.ts) so this is a fresh dispatcher, not an in-place edit.
import Ajv from 'ajv';
import { TOOL_SPECS } from './tool-specs.js';
import { parseBudget } from './run-guard.js';
import { authorize as realAuthorize, type Principal, type OwnerLookup, type AuthzVerdict } from './authz.js';
import type { McpFacade } from './mcp-facade.js';
import { INLINE_SCRIPT_CLOSED_MESSAGE } from './mcp-facade.js';
import type { SqliteSchedulerPort, NewSchedule } from './scheduler.js';
import type { WebhookRegistry } from './webhook-registry.js';
import type { CasStore } from './cas-store.js';
import type { AssetSyncService } from './asset-sync.js';
import type { McpProbe } from './mcp-probe.js';
import type { IssueReporter, IssueReportInput, IssueListFilter } from './github/issue-reporter.js';
import { filterCatalog, enrichModelEntry, type ModelEntry, type CatalogFilter } from './models/model-catalog.js';
import type { SystemInfoSampler } from './system-info.js';
import type { RunStore } from './run-store.js';

// Ajv instance shared by every validateArgs() call — same construction as agent-executor.ts's
// schema validation (D-V4): allErrors:false (first failure is enough to refuse), strict:false
// (TOOL_SPECS schemas are hand-authored JSON Schema, not meant to satisfy ajv's strict-mode lints).
const ajv = new Ajv({ allErrors: false, strict: false });

export type AuditWriter = Pick<RunStore, 'appendAudit' | 'auditFor'>;

/** DES-140's signature, minus the retired `continuations`/`mcpRegistry`/`graphAnalyzer` members —
 *  17 positional parameters collapse into this one object. `authorize` is an optional override
 *  (tests inject a spy to prove the schema-before-authz order); production callers never set it —
 *  the real `authorize()` from authz.ts is the default. */
export interface ToolDeps {
  facade: McpFacade;
  scheduler: SqliteSchedulerPort;
  webhooks: WebhookRegistry;
  webhookBaseUrl: string;
  cas: CasStore;
  assetSync: AssetSyncService;
  mcpProbe: McpProbe;
  issueReporter: IssueReporter;
  buildModelCatalog: () => Promise<ModelEntry[]>;
  systemInfo: SystemInfoSampler;
  lookup: OwnerLookup;
  audit: AuditWriter;
  authorize?: (principal: Principal, spec: { name: string; key: string | null; authz: unknown }, args: Record<string, unknown>, lookup: OwnerLookup) => AuthzVerdict;
}

/** {code:number} marks the ONE case (unknown tool name) that lifts to a top-level JSON-RPC
 *  `error` rather than being wrapped in `result.content` — every other outcome (schema refusal,
 *  authz refusal, a handler's own envelope) carries a STRING error code inside the normal
 *  `{runId,status,result?,error?}` envelope shape every tool already returns. */
export interface UnknownToolResult {
  error: { code: number; message: string };
}

function unknownTool(name: string): UnknownToolResult {
  return { error: { code: -32601, message: `Unknown tool: ${name}` } };
}

function refusalEnvelope(code: string, message: string, detail?: Record<string, unknown>): Record<string, unknown> {
  return { runId: '', status: 'failed', code, error: { code, message, ...(detail ? { detail } : {}) } };
}

/** DES-140: schema validation is whatever `spec.inputSchema` actually declares — no implicit
 *  `additionalProperties:false`. A tool whose schema needs to be CLOSED (e.g. reject an unknown
 *  key outright) declares that itself; this function does not paper over a schema that doesn't. */
function validateArgs(schema: Record<string, unknown>, args: unknown): string | null {
  const validate = ajv.compile(schema);
  if (validate(args)) return null;
  const err = validate.errors?.[0];
  return err ? `${err.instancePath || '(root)'} ${err.message}` : 'invalid arguments';
}

/** The `*_list` scoping rule, declared ONCE (Gate 6.5+7 round 2 simplify): both trigger stores'
 *  list tools advertise "the caller's own …; unfiltered for the operator role", and it is a
 *  security-relevant predicate that must not drift between them. `auth-disabled` carries no actor
 *  id, so it is unfiltered for the same reason `admin` is: there is nobody to scope to. */
function scopeToActor<T extends { createdBy?: string | null }>(rows: T[], principal: Principal, actor: string | null): T[] {
  if (principal.kind === 'admin' || principal.kind === 'auth-disabled') return rows;
  return rows.filter((r) => r.createdBy === actor);
}

/** DES-140: `find spec ?? unknownTool(name)` → `validateArgs` → `authorize()` → the one switch. */
export async function callTool(
  deps: ToolDeps,
  name: string,
  args: unknown,
  principal: Principal,
): Promise<unknown> {
  const spec = TOOL_SPECS.find((s) => s.name === name);
  if (!spec) return unknownTool(name);

  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
  // v24 (integrator; REQ-098 + DES-142): `run_start`'s schema is CLOSED, so a caller still using the
  // RETIRED inline door (`{script}`) would be answered a bare `INVALID_ARGUMENT: (root) must NOT
  // have additional properties` — technically true and completely useless. The whole point of
  // REQ-098's typed code is that the caller is TOLD to register first. `script` is deliberately not
  // a declared property (the advertised schema stays the clean v24 one a new caller reads), so the
  // migration answer is given here, ahead of ajv, for the one retired key that has one.
  // `run_resume` is included for the reason its own case is WORSE than run_start's: its schema is
  // open, so ajv admitted the key and the facade silently ignored it — a caller with a real
  // suspended runId was told the resume succeeded having had its script dropped on the floor
  // (found by the Batch-E executor).
  if ((spec.name === 'run_start' || spec.name === 'run_resume') && a['script'] !== undefined) {
    return refusalEnvelope('INLINE_SCRIPT_CLOSED', INLINE_SCRIPT_CLOSED_MESSAGE);
  }
  // v26 (DES-181, ARCH-118, ADR-037, TASK-181): the SAME precedent, one door down — `budget` was a
  // bare number pre-v26 (a token-only limit); `tool-specs.ts`'s advertised schema no longer accepts
  // one at all, so ajv's own complaint would be the generic "must be object" a cold caller cannot
  // act on. `parseBudget`'s own message (naming the USD/tokens migration) is reused here rather than
  // duplicated — it is the one door budget values pass through on the store side too.
  if (spec.name === 'run_start' && typeof a['budget'] === 'number') {
    try {
      parseBudget(a['budget'], { source: 'wire' });
    } catch (err) {
      const e = err as { message?: string; detail?: Record<string, unknown> };
      return refusalEnvelope('INVALID_ARGUMENT', e.message ?? 'INVALID_ARGUMENT: budget', e.detail);
    }
  }
  // v24 (integrator; DES-104 rule (a), found by the Batch-A executor): "the PRESENCE of an
  // `overrides` field on resume is a typed error, full stop — no absent-vs-`{}`-vs-equal semantics
  // to get subtly wrong". It had never been implemented on any surface: `schema()` sets no
  // `additionalProperties:false`, so ajv dropped the key and `runResume` never looked for it — the
  // caller was told the resume succeeded while its override reached nothing, which is the exact
  // silent-drop class this iteration keeps finding. A resume replays the run's PINNED admission
  // snapshot by design (ARCH-066); re-parameterising it is not a thing the engine can honour.
  if (spec.name === 'run_resume' && a['overrides'] !== undefined) {
    return refusalEnvelope(
      'INVALID_ARGUMENT',
      'INVALID_ARGUMENT: run_resume does not accept `overrides` — a resumed run replays the parameter snapshot pinned at admission (start a new run to change parameters)',
    );
  }
  // v24 orchestrator adjudication #8 (H-2, issue #56): the create-time trigger-binding door is
  // closed. `workflow` is off both create rows' inputSchema, but removal alone would make this
  // WORSE, not better — `schema()` declares no `additionalProperties:false`, so ajv would admit the
  // undeclared key and both handlers spread their args straight into the store, self-claiming
  // exactly as before while no longer advertising it. The refusal is given here, ahead of ajv, for
  // the same reason `run_resume`'s `overrides` is: the key has a migration answer, and a bare schema
  // complaint would not carry it. Gate 7.5's D-1 removed the create-time catalog check (REQ-115
  // moves it to `workflow_register`) and left the argument behind, which turned a documented leftover
  // into an unguarded path: a trigger could bind to a name that will never exist, and the id was then
  // unclaimable forever. The store's own `create({workflow})` is unchanged — pre-v24 rows keep firing
  // on their legacy binding; only this door closes.
  if ((spec.name === 'schedule_create' || spec.name === 'webhook_create') && a['workflow'] !== undefined) {
    return refusalEnvelope(
      'INVALID_ARGUMENT',
      `INVALID_ARGUMENT: ${spec.name} names no workflow — create the trigger unclaimed, then bind its id with workflow_register({name, script, mermaid, triggers:[id]})`,
    );
  }
  // v24 (integrator): `system_info.topN` is the one place two live design statements collide.
  // DES-077 names the behaviour "clamp-not-reject" (IT-069) AND requires the advertised schema to
  // carry `minimum:1, maximum:50` so a schema-only consumer knows the range (IT-072/VAL-088);
  // DES-140 then made the advertised schema authoritative ("validation is whatever
  // `spec.inputSchema` actually declares"), which turns the documented maximum into a refusal.
  // Clamping HERE, before validation, honours both: the range stays documented where a cold model
  // reads it, and an over-range request still succeeds with the 50 rows DES-077 promises. Scoped to
  // this one field; nothing else in the surface clamps, and nothing else should.
  if (spec.name === 'system_info' && typeof a['topN'] === 'number') {
    a['topN'] = Math.min(50, Math.max(1, Math.floor(a['topN'])));
  }
  const argErr = validateArgs(spec.inputSchema, a);
  if (argErr !== null) return refusalEnvelope('INVALID_ARGUMENT', `INVALID_ARGUMENT: ${argErr}`);

  const authorize = deps.authorize ?? realAuthorize;
  const verdict = authorize(principal, spec, a, deps.lookup);
  if (!verdict.ok) {
    return refusalEnvelope(verdict.code ?? 'FORBIDDEN_ROLE', verdict.reason ?? 'refused', verdict.detail);
  }
  const crossPrincipalRead = verdict.crossPrincipalRead === true;
  // `auth-disabled` carries no actor id — DES-151's audited handlers must never write a row for it.
  const actor = principal.kind === 'auth-disabled' || principal.kind === 'loopback-exempt' ? null : principal.id;

  const { facade } = deps;
  switch (spec.name) {
    // ---- workflow (7) ----
    case 'workflow_register': return facade.workflowRegister(a as never, principal);
    case 'workflow_deregister': return facade.workflowDeregister(a as never, principal);
    case 'workflow_publish': return facade.workflowPublish(a as never, principal);
    case 'workflow_describe': return facade.workflowDescribe(a as never, principal);
    case 'workflow_source': return facade.workflowSource(a as never, principal);
    case 'workflow_list': return facade.workflowList(a as never, principal);
    case 'workflow_authoring_guide': return facade.workflowAuthoringGuide();

    // ---- run (8) ----
    case 'run_start': return facade.runStart(a as never, principal);
    case 'run_status': return facade.runStatus(a as never, principal, crossPrincipalRead, actor);
    case 'run_result': return facade.runResult(a as never, principal, crossPrincipalRead, actor);
    case 'run_suspend': return facade.runSuspend(a as never, principal);
    case 'run_resume': return facade.runResume(a as never, principal);
    case 'run_stop': return facade.runStop(a as never, principal);
    case 'run_agent_log': return facade.runAgentLog(a as never, principal, crossPrincipalRead, actor);
    case 'run_list': return facade.runList(a as never, principal);

    // ---- workspace (6) ----
    case 'workspace_diff': return facade.workspaceDiff(a as never, principal);
    case 'workspace_push': return facade.workspacePush(a as never, principal);
    case 'workspace_pull': return facade.workspacePull(a as never, principal, crossPrincipalRead, actor);
    case 'workspace_list': return facade.workspaceList(a as never, principal, crossPrincipalRead, actor);
    case 'workspace_delete': return facade.workspaceDelete(a as never, principal);
    case 'workspace_purge': return facade.workspacePurge(a as never, principal);

    // ---- schedule (4) — thin pass-through to SqliteSchedulerPort, unchanged since v2 (DES-016)
    // except for the v24 principal-scoped list. ----
    case 'schedule_create': {
      const createdBy = actor ?? undefined;
      // v24 (integrator, adjudication #4 C-1): `NewSchedule` is a union DISCRIMINATED on `kind`,
      // but `schedule_create`'s advertised inputSchema is `{workflow, cron}` — "Register a
      // cron-style trigger". A cold model reading `tools/list` therefore sends no `kind` and the
      // INSERT died on `NOT NULL constraint failed: schedules.kind`, a raw SQLite string no caller
      // can act on. The discriminant is supplied here so the advertised schema is TRUE; an explicit
      // `kind` (the `resident`/`once` callers that predate this row) still wins.
      // Gate 6.5+7 round 2 (verifier): the SAME defect class one rung down. `enabled` is an
      // OPTIONAL boolean on the advertised schema and `SqliteSchedulerPort.create` stores
      // `s.enabled ? 1 : 0`, so the row's own happy fixture — `{workflow, cron}` — created a
      // schedule born DISABLED, which `tick()` never selects: "Register a time trigger" registered
      // one that could never fire, in silence. Defaulted here, next to `kind`, for the same reason:
      // so the advertised schema is TRUE. An explicit `enabled:false` still wins.
      const raw = a as unknown as Partial<NewSchedule> & Record<string, unknown>;
      const withKind = (raw.kind === undefined ? { ...raw, kind: 'cron' } : raw) as NewSchedule;
      const enabled = raw.enabled === undefined ? true : raw.enabled;
      return deps.scheduler.create({ ...withKind, enabled, createdBy });
    }
    case 'schedule_list': return { result: scopeToActor(await deps.scheduler.list(), principal, actor) };
    case 'schedule_delete': return deps.scheduler.delete(a['id'] as string);
    case 'schedule_setEnabled': return deps.scheduler.setEnabled(a['id'] as string, a['enabled'] as boolean);

    // ---- webhook (3) ----
    case 'webhook_create': {
      const r = await deps.webhooks.create({ ...(a as unknown as { workflow?: string; enabled?: boolean }), createdBy: actor ?? undefined });
      if ('error' in r) return { error: r.error };
      return { result: { webhookId: r.webhookId, url: `${deps.webhookBaseUrl}/hooks/${r.webhookId}`, secret: r.secret } };
    }
    // v24 (DES-139, TASK-142): principal-scoped exactly as `schedule_list` is — the row's own
    // description ("the caller's own webhooks; unfiltered for the operator role") is only true
    // once `webhooks.createdBy` exists to filter on.
    case 'webhook_list': return { result: scopeToActor(deps.webhooks.list(), principal, actor) };
    case 'webhook_delete': {
      // v24 (integrator, REQ-118): the registry method is total (`{deleted:false}`); the TOOL
      // advertises `TRIGGER_NOT_FOUND`, so deleting an id that never existed is a refusal here —
      // not a success envelope whose only signal is a boolean nothing told the caller to read.
      const r = deps.webhooks.delete(a['id'] as string);
      if (!r.deleted) return { error: { code: 'TRIGGER_NOT_FOUND', message: `Unknown webhook: ${String(a['id'])}` } };
      return { result: r };
    }

    // ---- issue (5) — envelope-not-throw, unchanged from the pre-v24 surface bar the renames. ----
    case 'issue_report': {
      const res = await deps.issueReporter.report(a as unknown as IssueReportInput);
      return res.ok ? { result: { issueNumber: res.issueNumber, url: res.url, deduped: res.deduped } } : { error: res.error };
    }
    case 'issue_get': {
      const res = await deps.issueReporter.getIssue(Number((a as { number?: unknown }).number));
      return res.ok ? { result: res.issue } : { error: res.error };
    }
    case 'issue_list': {
      const res = await deps.issueReporter.listIssues(a as unknown as IssueListFilter);
      return res.ok ? { result: res.issues } : { error: res.error };
    }
    case 'issue_get_comments': {
      const res = await deps.issueReporter.getComments(Number((a as { number?: unknown }).number));
      return res.ok ? { result: res.comments } : { error: res.error };
    }
    case 'issue_comment_post': {
      const res = await deps.issueReporter.postComment(Number((a as { number?: unknown }).number), (a as { body?: unknown }).body as string);
      return res.ok ? { result: { commentId: res.commentId, url: res.url } } : { error: res.error };
    }

    // ---- environment (2) ----
    case 'models_list': {
      const entries = await deps.buildModelCatalog();
      return { result: filterCatalog(entries, a as CatalogFilter).map(enrichModelEntry) };
    }
    case 'system_info': {
      const topN = a['topN'] !== undefined ? Math.floor(Number(a['topN'])) : 5;
      try {
        const view = await deps.systemInfo.get({ topN });
        return { status: 'ok', result: view };
      } catch (err) {
        return { status: 'error', error: { code: 'PROBE_ERROR', message: String(err) } };
      }
    }
    default: {
      // Exhaustiveness: every TOOL_SPECS row is handled above. Attempted a compile-time
      // `default: never` check here (DES-140) after TASK-155's `as const`, but `spec.name`
      // resolves to `any` at this call site (not the ToolName literal union `.find()` would
      // suggest) — reported as a defect rather than forced; this stays a runtime guard.
      return unknownTool(name);
    }
  }
}
