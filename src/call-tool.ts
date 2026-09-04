// src/call-tool.ts (v24 DES-140, ARCH-089, TASK-147): one ToolDeps object, schema BEFORE authz,
// one switch. Replaces the pre-v24 `callTool` (server.ts:868-1043) that took 14 positional
// parameters plus a name/args/principal/authEnabled tail — the v24 tool surface is entirely new
// names (TOOL_SPECS, tool-specs.ts) so this is a fresh dispatcher, not an in-place edit.
import Ajv from 'ajv';
import { TOOL_SPECS } from './tool-specs.js';
import { authorize as realAuthorize, type Principal, type OwnerLookup, type AuthzVerdict } from './authz.js';
import type { McpFacade } from './mcp-facade.js';
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
      return deps.scheduler.create({ ...(a as unknown as NewSchedule), createdBy });
    }
    case 'schedule_list': {
      const all = await deps.scheduler.list();
      const rows = principal.kind === 'admin' || principal.kind === 'auth-disabled' ? all : all.filter((s) => s.createdBy === actor);
      return { result: rows };
    }
    case 'schedule_delete': return deps.scheduler.delete(a['id'] as string);
    case 'schedule_setEnabled': return deps.scheduler.setEnabled(a['id'] as string, a['enabled'] as boolean);

    // ---- webhook (3) ----
    case 'webhook_create': {
      const r = await deps.webhooks.create(a as unknown as { workflow?: string; enabled?: boolean });
      if ('error' in r) return { error: r.error };
      return { result: { webhookId: r.webhookId, url: `${deps.webhookBaseUrl}/hooks/${r.webhookId}`, secret: r.secret } };
    }
    // Note: WebhookRegistry does not persist `createdBy` yet (webhook-registry.ts, TASK-142) — every
    // caller sees every webhook until that column lands; flagged in this implementer's report.
    case 'webhook_list': return { result: deps.webhooks.list() };
    case 'webhook_delete': return { result: deps.webhooks.delete(a['id'] as string) };

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
      // Exhaustiveness: every TOOL_SPECS row is handled above. TypeScript cannot narrow `spec.name`
      // to `never` here because ToolSpec['name'] is `string` (TOOL_SPECS is a plain array, not
      // `as const` — DES-138 defers that), so this is a runtime guard, not a compile-time one.
      return unknownTool(name);
    }
  }
}
