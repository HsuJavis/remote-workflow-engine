// v24 DES-138 (ARCH-087, TASK-132): the 35-row tool surface — one data array that is the only
// source of `tools/list`, of each tool's `Errors:` line, and of the authorization row `authz.ts`
// checks once, before the dispatch switch. Pure data + one projection; imports only the `ErrorCode`
// TYPE from errors.ts (DES-137) so every row's `errors[]` is tsc-checked against the closed catalog.
import type { ErrorCode } from './errors.js';

/** Declared here (not authz.ts) so the dependency between the two files stays one-directional —
 *  authz.ts imports Role from this module (ARCH-088). */
export type Role = 'admin' | 'author' | 'user';
type Ownership = 'none' | 'run' | 'workflow' | 'trigger' | 'asset';

export type AuthzRow =
  | { minRole: Role; ownership: Ownership }
  | { minRole: 'admin' | 'author' | 'user'; ownership: 'run'; adminCrossRead: true };

export type ToolAuthz = AuthzRow | { mode: (args: any) => string; rows: Record<string, AuthzRow> };

export interface ToolSpec {
  name: string;
  entity: string;
  key: 'name' | 'runId' | 'id' | 'number' | null;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  errors: ReadonlyArray<ErrorCode>;
  seeAlso: readonly string[];
  authz: ToolAuthz;
  fixture: { happy: Record<string, unknown> };
}

function schema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: 'object', properties, required };
}

/** v24 (DES-155, TASK-148): `workspace_push`'s two closed branches — modeA (a CAS blob) or modeB
 *  (a workflow-owned asset, `scope:'global'` omits `workflow`). CLOSED (`additionalProperties:
 *  false`) in EACH branch so a `runId` (or any other stray key) matches NEITHER branch and the
 *  overall `oneOf` refuses INVALID_ARGUMENT from the schema — "a run's workspace is immutable
 *  while live and meaningless after" (DES-155 boundary), not a runtime check. */
function pushInputSchema(): Record<string, unknown> {
  return {
    type: 'object',
    oneOf: [
      { type: 'object', properties: { sha256: { type: 'string' }, contentB64: { type: 'string' } }, required: ['sha256', 'contentB64'], additionalProperties: false },
      {
        type: 'object',
        properties: { workflow: { type: 'string' }, kind: { type: 'string' }, name: { type: 'string' }, files: { type: 'array' }, config: { type: 'object' }, scope: { type: 'string' } },
        required: ['kind', 'name'],
        additionalProperties: false,
      },
    ],
  };
}

/** Output schemas are a TEST ORACLE (DES-138) — not published in `tools/list` until the byte
 *  baseline of a later item exists. Loose here; the real shape lives in each handler's own tests. */
const OUT = schema({});

/** `mode()` is used by exactly three tools (DES-138): workspace_push, workspace_list,
 *  workspace_delete. Each is TOTAL — an arg set matching nothing resolves to `'invalid'`, whose row
 *  is always `{minRole:'user', ownership:'none'}` so the schema check (which runs first) answers
 *  INVALID_ARGUMENT rather than a permission error. */
function pushMode(args: any): 'cas' | 'asset' | 'global' | 'stdio' | 'invalid' {
  if (args && typeof args === 'object' && 'sha256' in args && 'contentB64' in args) return 'cas';
  if (args && args.scope === 'global') return 'global';
  if (args && args.kind === 'mcp' && args.config && args.config.transport === 'stdio') return 'stdio';
  if (args && args.workflow && args.kind) return 'asset';
  return 'invalid';
}

function listMode(args: any): 'run' | 'workflow' | 'invalid' {
  if (args && typeof args === 'object' && 'runId' in args) return 'run';
  if (args && typeof args === 'object' && 'workflow' in args && 'kind' in args) return 'workflow';
  return 'invalid';
}

function deleteMode(args: any): 'run' | 'workflow' | 'global' | 'invalid' {
  if (args && typeof args === 'object' && 'runId' in args) return 'run';
  if (args && args.scope === 'global') return 'global';
  if (args && typeof args === 'object' && 'workflow' in args && 'kind' in args && 'name' in args) return 'workflow';
  return 'invalid';
}

export const TOOL_SPECS = [
  // ---- workflow (7) ----
  {
    name: 'workflow_register', entity: 'workflow', key: null,
    description: 'Register a new workflow version under a name; the caller becomes its owner.',
    inputSchema: schema({ name: { type: 'string' }, script: { type: 'string' }, mermaid: { type: 'string' }, triggers: { type: 'array' } }, ['name', 'script']),
    outputSchema: OUT,
    errors: ['WORKFLOW_ALREADY_EXISTS', 'SCRIPT_INVALID', 'SCAN_VIOLATION', 'DIAGRAM_MISMATCH', 'MERMAID_INVALID', 'FORBIDDEN_ROLE', 'REGISTRATION_CONFLICT', 'VERSION_CEILING_EXCEEDED'],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'none' } as AuthzRow,
    fixture: { happy: { name: 'demo', script: 'workflow(async () => {})', mermaid: 'graph TD;\nA-->B;' } },
  },
  {
    name: 'workflow_deregister', entity: 'workflow', key: 'name' as const,
    description: "Delete a workflow and release every trigger claimed under its name.",
    inputSchema: schema({ name: { type: 'string' } }, ['name']),
    outputSchema: OUT,
    errors: ['WORKFLOW_NOT_FOUND', 'NOT_WORKFLOW_OWNER', 'FORBIDDEN_ROLE'],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'workflow' } as AuthzRow,
    fixture: { happy: { name: 'demo' } },
  },
  {
    name: 'workflow_publish', entity: 'workflow', key: 'name' as const,
    description: "Point a workflow's release pointer at one of its registered versions.",
    // B-1 (v24 adjudication #3): `version` is a STRING (e.g. 'v1'), the exact value
    // workflow_register's `result.version` returns — not a number. The catalog stores versions as
    // strings; a number reaches it and comes back VERSION_NOT_FOUND while the correct string was
    // rejected by ajv first, so no argument shape succeeded before this fix.
    inputSchema: schema({ name: { type: 'string' }, version: { type: 'string', description: "The version string returned by workflow_register, e.g. 'v1'." } }, ['name']),
    outputSchema: OUT,
    errors: ['WORKFLOW_NOT_FOUND', 'VERSION_NOT_FOUND', 'NOT_WORKFLOW_OWNER', 'FORBIDDEN_ROLE'],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'workflow' } as AuthzRow,
    fixture: { happy: { name: 'demo', version: 'v1' } },
  },
  {
    name: 'workflow_describe', entity: 'workflow', key: 'name' as const,
    description: "Describe a workflow's runnable release: per-agent parameters, agent labels, and its author-supplied diagram.",
    inputSchema: schema({ name: { type: 'string' } }, ['name']),
    outputSchema: OUT,
    errors: ['WORKFLOW_NOT_FOUND'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: { name: 'demo' } },
  },
  {
    name: 'workflow_source', entity: 'workflow', key: 'name' as const,
    description: "Read a workflow version's script. A non-owner author receives a masked projection (scriptWithheld:true) — see workflow_describe for the runnable summary.",
    // B-1 (v24 adjudication #3): `version` is a STRING, the exact value workflow_register's
    // `result.version` returns — see workflow_publish's row for why.
    inputSchema: schema({ name: { type: 'string' }, version: { type: 'string', description: "The version string returned by workflow_register, e.g. 'v1'." } }, ['name']),
    outputSchema: OUT,
    errors: ['WORKFLOW_NOT_FOUND', 'VERSION_NOT_FOUND', 'FORBIDDEN_ROLE'],
    seeAlso: ['workflow_describe'],
    authz: { minRole: 'author', ownership: 'none' } as AuthzRow,
    fixture: { happy: { name: 'demo' } },
  },
  {
    name: 'workflow_list', entity: 'workflow', key: null,
    description: 'List registered workflows; each row carries whether it currently has a runnable release.',
    inputSchema: schema({ onlyRunnable: { type: 'boolean' } }),
    outputSchema: OUT,
    errors: [] as ErrorCode[],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: {} },
  },
  {
    name: 'workflow_authoring_guide', entity: 'workflow', key: null,
    description: "Return the authoring guide, rendered from the engine's own enforcement constants — parameter ceilings, reserved names, and the agent-call scanning rules.",
    inputSchema: schema({}),
    outputSchema: OUT,
    errors: [] as ErrorCode[],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: {} },
  },

  // ---- run (8) ----
  {
    name: 'run_start', entity: 'run', key: null,
    description: "Start a run of a workflow's current release. First-try traps: a just-registered workflow has no release — call workflow_publish first or pass {version} — and starting a run returns no result; poll run_status until terminal, then call run_result.",
    // v24 adjudication #2 A-2: seed/seedManifest/seedRef/seedManifestRef are RESTORED here — only
    // seedNamespace was meant to drop (ADR-028 derives it from the principal). Omitting them left the
    // TASK-153 plugin doc advertising run_start({seedManifestRef}) against an engine that rejected it.
    // v24 (DES-142, TASK-147): CLOSED (`additionalProperties:false`) — a caller-supplied
    // `seedNamespace` (or any other unlisted key) is refused INVALID_ARGUMENT from the schema; the
    // CAS namespace is derived ONLY from the principal (`nsOf`, mcp-facade.ts).
    inputSchema: {
      ...schema({
        name: { type: 'string' },
        // B-1 (v24 adjudication #3): a STRING, the exact value workflow_register's
        // `result.version` returns — see workflow_publish's row for why.
        version: { type: 'string', description: "The version string returned by workflow_register, e.g. 'v1'." },
        overrides: { type: 'object' },
        seed: { type: 'array' },
        seedManifest: { type: 'array' },
        seedRef: { type: 'object' },
        seedManifestRef: { type: 'string' },
      }, ['name']),
      additionalProperties: false,
    },
    outputSchema: OUT,
    errors: ['WORKFLOW_NOT_FOUND', 'NOT_RUNNABLE', 'PARAM_OUT_OF_RANGE', 'UNKNOWN_ALIAS', 'AGENT_UNDECLARED', 'LEGACY_REREGISTER', 'INVALID_SEED_SPEC', 'SEED_SOURCE_CONFLICT', 'SEEDREF_DISABLED', 'EGRESS_DENIED', 'CAS_UNAVAILABLE', 'MISSING_BLOBS', 'RUN_ADMISSION_LIMIT'],
    seeAlso: ['workflow_publish', 'run_status', 'run_result'],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: { name: 'demo' } },
  },
  {
    name: 'run_status', entity: 'run', key: 'runId' as const,
    description: "Poll a run's status; terminal states carry the final outcome. The owner's response also lists any cross-principal reads of this run's workspace or logs.",
    inputSchema: schema({ runId: { type: 'string' } }, ['runId']),
    outputSchema: OUT,
    errors: ['RUN_NOT_FOUND', 'NOT_RUN_OWNER'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'run' } as AuthzRow,
    fixture: { happy: { runId: 'r1' } },
  },
  {
    name: 'run_result', entity: 'run', key: 'runId' as const,
    description: "Fetch a terminal run's result payload.",
    inputSchema: schema({ runId: { type: 'string' } }, ['runId']),
    outputSchema: OUT,
    errors: ['RUN_NOT_FOUND', 'RUN_NOT_TERMINAL', 'NOT_RUN_OWNER', 'NESTING_DEPTH_EXCEEDED', 'NESTING_CYCLE', 'DESCENDANT_CAP_EXCEEDED'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'run' } as AuthzRow,
    fixture: { happy: { runId: 'r1' } },
  },
  {
    name: 'run_suspend', entity: 'run', key: 'runId' as const,
    description: 'Suspend a running run.',
    inputSchema: schema({ runId: { type: 'string' } }, ['runId']),
    outputSchema: OUT,
    errors: ['RUN_NOT_FOUND', 'ILLEGAL_TRANSITION', 'NOT_RUN_OWNER'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'run' } as AuthzRow,
    fixture: { happy: { runId: 'r1' } },
  },
  {
    name: 'run_resume', entity: 'run', key: 'runId' as const,
    description: 'Resume a suspended run.',
    inputSchema: schema({ runId: { type: 'string' } }, ['runId']),
    outputSchema: OUT,
    errors: ['RUN_NOT_FOUND', 'ILLEGAL_TRANSITION', 'NOT_RUN_OWNER', 'PARAM_SECRET_UNAVAILABLE'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'run' } as AuthzRow,
    fixture: { happy: { runId: 'r1' } },
  },
  {
    name: 'run_stop', entity: 'run', key: 'runId' as const,
    description: 'Stop a run.',
    inputSchema: schema({ runId: { type: 'string' } }, ['runId']),
    outputSchema: OUT,
    errors: ['RUN_NOT_FOUND', 'ILLEGAL_TRANSITION', 'NOT_RUN_OWNER'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'run' } as AuthzRow,
    fixture: { happy: { runId: 'r1' } },
  },
  {
    name: 'run_agent_log', entity: 'run', key: 'runId' as const,
    description: "Read one agent's harness log for a run; a cross-principal read of another principal's run is audited.",
    inputSchema: schema({ runId: { type: 'string' }, label: { type: 'string' } }, ['runId', 'label']),
    outputSchema: OUT,
    errors: ['RUN_NOT_FOUND', 'AGENT_LOG_NOT_FOUND', 'NOT_RUN_OWNER'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'run', adminCrossRead: true } as AuthzRow,
    fixture: { happy: { runId: 'r1', label: 'main' } },
  },
  {
    name: 'run_list', entity: 'run', key: null,
    description: "List runs, filtered to the caller's own rows; unfiltered for the operator role.",
    inputSchema: schema({ workflow: { type: 'string' }, status: { type: 'string' }, limit: { type: 'number' } }),
    outputSchema: OUT,
    errors: [] as ErrorCode[],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: {} },
  },

  // ---- workspace (6) ----
  {
    name: 'workspace_diff', entity: 'workspace', key: null,
    description: "Diff a manifest against the caller's own content-addressed blob pool.",
    inputSchema: schema({ manifest: { type: 'array' } }, ['manifest']),
    outputSchema: OUT,
    errors: ['INVALID_ARGUMENT'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: { manifest: [] } },
  },
  {
    name: 'workspace_push', entity: 'workspace', key: null,
    description: 'Push content: a CAS blob into the caller\'s own pool, or a workflow-owned asset (skill/mcp). Any runId argument is refused — see workflow_authoring_guide.',
    inputSchema: pushInputSchema(),
    outputSchema: OUT,
    errors: ['INVALID_ARGUMENT', 'FORBIDDEN_ROLE', 'NOT_WORKFLOW_OWNER', 'MCP_PROBE_FAILED', 'EGRESS_DENIED', 'HOOKS_UNSUPPORTED'],
    seeAlso: ['workflow_authoring_guide'],
    authz: {
      mode: pushMode,
      rows: {
        cas: { minRole: 'user', ownership: 'none' },
        asset: { minRole: 'author', ownership: 'workflow' },
        global: { minRole: 'admin', ownership: 'none' },
        stdio: { minRole: 'admin', ownership: 'none' },
        invalid: { minRole: 'user', ownership: 'none' },
      },
    } as ToolAuthz,
    fixture: { happy: { sha256: 'a'.repeat(64), contentB64: 'AAAA' } },
  },
  {
    name: 'workspace_pull', entity: 'workspace', key: 'runId' as const,
    description: "Read a byte range from a file in a run's workspace; a cross-principal read of another principal's run is audited.",
    inputSchema: schema({ runId: { type: 'string' }, path: { type: 'string' }, offset: { type: 'number' }, length: { type: 'number' } }, ['runId', 'path']),
    outputSchema: OUT,
    errors: ['RUN_NOT_FOUND', 'WORKSPACE_ESCAPE', 'NOT_FOUND', 'NOT_RUN_OWNER'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'run', adminCrossRead: true } as AuthzRow,
    fixture: { happy: { runId: 'r1', path: 'output.txt' } },
  },
  {
    name: 'workspace_list', entity: 'workspace', key: null,
    description: "List files in a run's workspace, or an asset's files under a workflow.",
    inputSchema: schema({ runId: { type: 'string' }, workflow: { type: 'string' }, kind: { type: 'string' } }),
    outputSchema: OUT,
    errors: ['RUN_NOT_FOUND', 'WORKFLOW_NOT_FOUND', 'NOT_RUN_OWNER', 'NOT_WORKFLOW_OWNER'],
    seeAlso: [] as string[],
    authz: {
      mode: listMode,
      rows: {
        run: { minRole: 'user', ownership: 'run', adminCrossRead: true },
        workflow: { minRole: 'author', ownership: 'workflow' },
        invalid: { minRole: 'user', ownership: 'none' },
      },
    } as ToolAuthz,
    fixture: { happy: { runId: 'r1' } },
  },
  {
    name: 'workspace_delete', entity: 'workspace', key: null,
    description: "Delete files from a run's workspace, an asset under a workflow, or (admin) a global asset.",
    inputSchema: schema({ runId: { type: 'string' }, paths: { type: 'array' }, workflow: { type: 'string' }, kind: { type: 'string' }, name: { type: 'string' }, scope: { type: 'string' } }),
    outputSchema: OUT,
    errors: ['RUN_NOT_FOUND', 'WORKFLOW_NOT_FOUND', 'NOT_RUN_OWNER', 'NOT_WORKFLOW_OWNER', 'FORBIDDEN_ROLE'],
    seeAlso: [] as string[],
    authz: {
      mode: deleteMode,
      rows: {
        run: { minRole: 'user', ownership: 'run' },
        workflow: { minRole: 'author', ownership: 'workflow' },
        global: { minRole: 'admin', ownership: 'none' },
        invalid: { minRole: 'user', ownership: 'none' },
      },
    } as ToolAuthz,
    fixture: { happy: { runId: 'r1', paths: ['a.txt'] } },
  },
  {
    name: 'workspace_purge', entity: 'workspace', key: 'runId' as const,
    description: "Purge a terminated run's workspace from disk.",
    inputSchema: schema({ runId: { type: 'string' } }, ['runId']),
    outputSchema: OUT,
    errors: ['RUN_NOT_FOUND', 'RUN_NOT_TERMINAL', 'NOT_RUN_OWNER'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'run' } as AuthzRow,
    fixture: { happy: { runId: 'r1' } },
  },

  // ---- schedule (4) ----
  {
    name: 'schedule_create', entity: 'schedule', key: null,
    description: 'Register a cron-style trigger for a workflow; the caller becomes its owner.',
    inputSchema: schema({ workflow: { type: 'string' }, cron: { type: 'string' } }, ['workflow', 'cron']),
    outputSchema: OUT,
    errors: ['WORKFLOW_NOT_FOUND', 'TRIGGER_ALREADY_CLAIMED', 'FORBIDDEN_ROLE'],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'none' } as AuthzRow,
    fixture: { happy: { workflow: 'demo', cron: '* * * * *' } },
  },
  {
    name: 'schedule_list', entity: 'schedule', key: null,
    description: "List the caller's own schedules; unfiltered for the operator role.",
    inputSchema: schema({}),
    outputSchema: OUT,
    errors: [] as ErrorCode[],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'none' } as AuthzRow,
    fixture: { happy: {} },
  },
  {
    name: 'schedule_delete', entity: 'schedule', key: 'id' as const,
    description: "Delete a schedule and release its claim on the workflow name.",
    inputSchema: schema({ id: { type: 'string' } }, ['id']),
    outputSchema: OUT,
    errors: ['TRIGGER_NOT_FOUND', 'NOT_TRIGGER_OWNER'],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'trigger' } as AuthzRow,
    fixture: { happy: { id: 's1' } },
  },
  {
    name: 'schedule_setEnabled', entity: 'schedule', key: 'id' as const,
    description: "Enable or disable a schedule without releasing its claim.",
    inputSchema: schema({ id: { type: 'string' }, enabled: { type: 'boolean' } }, ['id', 'enabled']),
    outputSchema: OUT,
    errors: ['TRIGGER_NOT_FOUND', 'NOT_TRIGGER_OWNER'],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'trigger' } as AuthzRow,
    fixture: { happy: { id: 's1', enabled: false } },
  },

  // ---- webhook (3) ----
  {
    name: 'webhook_create', entity: 'webhook', key: null,
    description: 'Register a webhook trigger for a workflow; the caller becomes its owner.',
    inputSchema: schema({ workflow: { type: 'string' } }, ['workflow']),
    outputSchema: OUT,
    errors: ['WORKFLOW_NOT_FOUND', 'TRIGGER_ALREADY_CLAIMED', 'FORBIDDEN_ROLE'],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'none' } as AuthzRow,
    fixture: { happy: { workflow: 'demo' } },
  },
  {
    name: 'webhook_list', entity: 'webhook', key: null,
    description: "List the caller's own webhooks; unfiltered for the operator role.",
    inputSchema: schema({}),
    outputSchema: OUT,
    errors: [] as ErrorCode[],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'none' } as AuthzRow,
    fixture: { happy: {} },
  },
  {
    name: 'webhook_delete', entity: 'webhook', key: 'id' as const,
    description: "Delete a webhook and release its claim on the workflow name.",
    inputSchema: schema({ id: { type: 'string' } }, ['id']),
    outputSchema: OUT,
    errors: ['TRIGGER_NOT_FOUND', 'NOT_TRIGGER_OWNER'],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'trigger' } as AuthzRow,
    fixture: { happy: { id: 'w1' } },
  },

  // ---- issue (5) ----
  {
    name: 'issue_report', entity: 'issue', key: null,
    description: 'File a new issue against the engine.',
    inputSchema: schema({ title: { type: 'string' }, body: { type: 'string' } }, ['title', 'body']),
    outputSchema: OUT,
    errors: [] as ErrorCode[],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: { title: 'x', body: 'y' } },
  },
  {
    name: 'issue_get', entity: 'issue', key: 'number' as const,
    description: 'Fetch a single issue by number.',
    inputSchema: schema({ number: { type: 'number' } }, ['number']),
    outputSchema: OUT,
    errors: ['ISSUE_NOT_FOUND'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: { number: 1 } },
  },
  {
    name: 'issue_list', entity: 'issue', key: null,
    description: 'List issues.',
    inputSchema: schema({}),
    outputSchema: OUT,
    errors: [] as ErrorCode[],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: {} },
  },
  {
    name: 'issue_get_comments', entity: 'issue', key: 'number' as const,
    description: "Fetch an issue's latest comments.",
    inputSchema: schema({ number: { type: 'number' } }, ['number']),
    outputSchema: OUT,
    errors: ['ISSUE_NOT_FOUND'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: { number: 1 } },
  },
  {
    name: 'issue_comment_post', entity: 'issue', key: 'number' as const,
    description: 'Post a comment on an issue.',
    inputSchema: schema({ number: { type: 'number' }, body: { type: 'string' } }, ['number', 'body']),
    outputSchema: OUT,
    errors: ['ISSUE_NOT_FOUND'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: { number: 1, body: 'hi' } },
  },

  // ---- environment (2) ----
  {
    name: 'models_list', entity: 'models', key: null,
    description: 'List the model catalog: aliases, capability/stability/cost ratings.',
    inputSchema: schema({}),
    outputSchema: OUT,
    errors: [] as ErrorCode[],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: {} },
  },
  {
    name: 'system_info', entity: 'system', key: null,
    description: 'Report engine system info: CPU, memory, disk, active processes, and the auth summary.',
    inputSchema: schema({}),
    outputSchema: OUT,
    errors: [] as ErrorCode[],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: {} },
  },
] as const satisfies readonly ToolSpec[];

// v24 (TASK-155, DES-138): `as const` above makes `name` a literal per row, so `ToolName` is the
// true 35-member literal union (not `string`) — DES-151's `AuditAction = Extract<ToolName, …>`
// depends on this narrowing to avoid silently resolving to `never`.
export type ToolName = (typeof TOOL_SPECS)[number]['name'];

function buildDescription(spec: ToolSpec): string {
  let text: string = spec.description;
  if (spec.errors.length > 0) text += `\nErrors: ${spec.errors.join(', ')}`;
  if (spec.seeAlso.length > 0) text += `\nSee also: ${spec.seeAlso.join(', ')}`;
  return text;
}

/** Deterministic: pure projection over static data, no I/O, no Date.now(). */
export function projectToolsList(): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}> {
  return TOOL_SPECS.map((spec) => ({
    name: spec.name,
    description: buildDescription(spec),
    inputSchema: spec.inputSchema,
    outputSchema: spec.outputSchema,
  }));
}
