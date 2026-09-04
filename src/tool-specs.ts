// v24 DES-138 (ARCH-087, TASK-132): the 35-row tool surface — one data array that is the only
// source of `tools/list`, of each tool's `Errors:` line, and of the authorization row `authz.ts`
// checks once, before the dispatch switch. Pure data + one projection; imports only the `ErrorCode`
// TYPE from errors.ts (DES-137) so every row's `errors[]` is tsc-checked against the closed catalog.
import { ERROR_CATALOG, type ErrorCode } from './errors.js';

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
  fixture: ToolFixture;
}

// ---------------------------------------------------------------------------
// Fixtures (DES-158, amended by adjudication (v24) #4 C-1)
// ---------------------------------------------------------------------------

/** The ids a fixture cannot know statically. `run_status`/`run_result`/`run_suspend`/`run_resume`/
 *  `run_stop`/`run_agent_log`/`workspace_*`/`schedule_delete`/`schedule_setEnabled` all key off an
 *  object that only exists after a real call mints a UUID (`run-store.ts` `randomUUID()`), so the
 *  twelve rows that used to hard-code `runId:'r1'` / `id:'s1'` could never pass. Adjudication #4 C-1
 *  REFUSED recording them UNVERIFIED — they are exactly the tools `/goal` requires verified — so the
 *  acceptance test runs a SETUP SEQUENCE first (register -> publish -> several runs driven into
 *  different states -> a schedule + a webhook) and fills these slots from what it observed. */
export type SetupKey =
  | 'workflow'        // the registered fixture workflow's name
  | 'version'         // the version string workflow_register returned for it ('v1')
  | 'agentLabel'      // the fixture script's one agent label
  | 'terminalRunId'   // a run that has reached a terminal state
  | 'liveRunId'       // a live run NO fixture mutates — the RUN_NOT_TERMINAL / run_agent_log reads
  | 'suspendedRunId'  // a run already driven to `suspended`, consumed by run_resume's happy path
  | 'suspendTargetRunId' // a live run consumed by run_suspend's happy path
  | 'stopTargetRunId'    // a live run consumed by run_stop's happy path
  | 'seededPath'      // a file seeded into terminalRunId's workspace, for workspace_pull/delete
  | 'scheduleId'      // a schedule minted by schedule_create, for schedule_setEnabled
  | 'deletableScheduleId' // a SECOND schedule, consumed by schedule_delete's happy path
  | 'webhookId';      // a webhook minted by webhook_create

/** A fixture slot filled from the setup sequence rather than by a literal. Deliberately a tagged
 *  object, not a `'${…}'` string convention: a marker that shares a type with real argument values
 *  is a marker that eventually reaches a tool un-substituted and is refused as a plain string. */
export interface FixtureRef { readonly $setup: SetupKey }
export function ref(key: SetupKey): FixtureRef { return { $setup: key }; }
export function isFixtureRef(v: unknown): v is FixtureRef {
  return typeof v === 'object' && v !== null && typeof (v as FixtureRef).$setup === 'string';
}

/** One level deep is all any fixture needs (every argument object here is flat apart from
 *  `config`/`seed`, which carry no ids). Arrays are walked so `paths:[ref('seededPath')]` works. */
export function resolveFixture(
  args: Record<string, unknown>,
  setup: Partial<Record<SetupKey, string>>,
): Record<string, unknown> {
  const fill = (v: unknown): unknown => {
    if (!isFixtureRef(v)) return v;
    const filled = setup[v.$setup];
    if (filled === undefined) throw new Error(`fixture ref '${v.$setup}' was not produced by the setup sequence`);
    return filled;
  };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    out[k] = Array.isArray(v) ? v.map(fill) : fill(v);
  }
  return out;
}

export interface ToolFixture {
  /** The success-path argument set. */
  happy: Record<string, unknown>;
  /** Argument sets that MUST be refused with the keyed code. DES-158's floor is ≥30 across the
   *  surface: the error path is the only place the authorization row is actually observed
   *  (v22's H2 was a read-only check that never asked), so a surface verified on happy paths alone
   *  is not verified. `{}` where no refusal of that tool is constructible from arguments alone. */
  errors: Partial<Record<ErrorCode, Record<string, unknown>>>;
}

/** A runId/trigger id that is well-formed but certainly absent — the *_NOT_FOUND fixtures. */
const ABSENT_ID = '00000000-0000-0000-0000-000000000000';
const ABSENT_WORKFLOW = 'no-such-workflow-fixture';

/** The one agent contract block the fixture script declares (DES-144 requires model/effort/
 *  timeoutMs, each with a `.default`). Same shape `authoring-guide.ts`'s examples teach. */
const FIXTURE_AGENT_SPEC =
  "{ model: { type: 'string', default: 'default' }, " +
  "effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, " +
  'timeoutMs: { type: \'number\', default: 60000 } }';

/** The `workflow_register` happy fixture's script. It was `workflow(async () => {})` — a script
 *  declaring NO agent label against a diagram declaring nodes `A` and `B`, which `checkMermaid`
 *  refuses (`UNDECLARED_NODE` -> MERMAID_INVALID) and which cascaded seven acceptance rows red
 *  because every one of them keys off the `demo` workflow this call was supposed to create
 *  (adjudication (v24) #4 C-1 [29] — reported three times before it was fixed). It is now a real
 *  minimal v24 workflow: one declared agent label, matched one-for-one by the diagram. */
export const FIXTURE_SCRIPT =
  "export const meta = {\n" +
  "  description: 'Greet the caller in one sentence',\n" +
  `  params: { agents: { greet: ${FIXTURE_AGENT_SPEC} } },\n` +
  '};\n' +
  "return await agent('greet', { prompt: 'Say hello' });";

/** Exactly the labels `FIXTURE_SCRIPT` uses, in the minimal form `checkMermaid` accepts (one
 *  stadium node, no `<br/>` value triple, no edges — an edge to an undeclared node is what the
 *  old fixture got wrong). */
export const FIXTURE_MERMAID = 'graph TD;\ngreet(["greet"])';

/** The one label `FIXTURE_SCRIPT` declares — `run_agent_log`'s happy fixture needs it by name. */
export const FIXTURE_AGENT_LABEL = 'greet';

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
  // v24 Gate 7.5 (D-11, REQ-109/ADR-030): the transport key is `type` — the SAME key
  // `classifyTransport()` (mcp-probe.ts) and the materializer read. This row used to look for
  // `config.transport`, a key nothing else in the engine writes or reads, so a real
  // `{type:'stdio', command:'npx', …}` fell through to the `asset` row (`minRole:'author'`), the
  // admin-only gate never ran, and the probe spawned the author-supplied command on the engine
  // host. One key, read the same way on both sides; the outcome is pinned by
  // tests/integration/stdio-mcp-admin-gate.test.ts, never by this function's return value.
  if (args && args.kind === 'mcp' && args.config && args.config.type === 'stdio') return 'stdio';
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
    // v24 (integrator; adjudication #4 C-6 [21] + #2 A-4): reconciled BOTH ways against what the
    // register path actually throws — `script-checks.ts` (PARSE_ERROR / UNKNOWN_ALIAS /
    // MCP_NOT_PROVISIONED), `parseParamContract` (AGENT_UNDECLARED / AGENT_DECLARED_NOT_IN_SCRIPT /
    // PARAM_CONTRACT_INVALID / DEFAULTS_RETIRED), `workflow-catalog.ts` (SCAN_VIOLATION /
    // MERMAID_REQUIRED / MERMAID_INVALID / DIAGRAM_MISMATCH / VERSION_CEILING_EXCEEDED /
    // NOT_WORKFLOW_OWNER / REGISTRATION_CONFLICT) and the facade's trigger-claim step
    // (TRIGGER_NOT_FOUND / NOT_TRIGGER_OWNER / TRIGGER_ALREADY_CLAIMED / INVALID_ARGUMENT).
    // REMOVED: `WORKFLOW_ALREADY_EXISTS` — re-registering an existing name is how a NEW VERSION is
    // created; the refusal for someone else's name is NOT_WORKFLOW_OWNER, and advertising a code
    // the tool cannot answer teaches a cold model to branch on something that never arrives.
    // `SCRIPT_INVALID` stays: it is the sandbox structural refusal `validateScriptEntry` raises.
    errors: [
      'SCRIPT_INVALID', 'PARSE_ERROR', 'UNKNOWN_ALIAS', 'MCP_NOT_PROVISIONED', 'SCAN_VIOLATION',
      'AGENT_UNDECLARED', 'AGENT_DECLARED_NOT_IN_SCRIPT', 'PARAM_CONTRACT_INVALID', 'DEFAULTS_RETIRED',
      'MERMAID_REQUIRED', 'MERMAID_INVALID', 'DIAGRAM_MISMATCH',
      'NOT_WORKFLOW_OWNER', 'REGISTRATION_CONFLICT', 'VERSION_CEILING_EXCEEDED',
      'INVALID_ARGUMENT', 'TRIGGER_NOT_FOUND', 'NOT_TRIGGER_OWNER', 'TRIGGER_ALREADY_CLAIMED',
      'FORBIDDEN_ROLE',
    ],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'none' } as AuthzRow,
    fixture: {
      happy: { name: 'demo', script: FIXTURE_SCRIPT, mermaid: FIXTURE_MERMAID },
      errors: {
        MERMAID_REQUIRED: { name: 'fixture-no-mermaid', script: 'return 1;' },
        DIAGRAM_MISMATCH: { name: 'fixture-mismatch', script: FIXTURE_SCRIPT, mermaid: 'graph TD;\nother(["other"])' },
        SCAN_VIOLATION: { name: 'fixture-scan', script: 'const l = "greet";\nreturn await agent(l, {});', mermaid: FIXTURE_MERMAID },
      },
    },
  },
  {
    name: 'workflow_deregister', entity: 'workflow', key: 'name' as const,
    description: "Delete a workflow and release every trigger claimed under its name.",
    inputSchema: schema({ name: { type: 'string' } }, ['name']),
    outputSchema: OUT,
    errors: ['WORKFLOW_NOT_FOUND', 'NOT_WORKFLOW_OWNER', 'FORBIDDEN_ROLE'],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'workflow' } as AuthzRow,
    fixture: { happy: { name: ref('workflow') }, errors: { WORKFLOW_NOT_FOUND: { name: ABSENT_WORKFLOW } } },
  },
  {
    name: 'workflow_publish', entity: 'workflow', key: 'name' as const,
    description: "Point a workflow's release pointer at one of its registered versions.",
    // B-1 (v24 adjudication #3): `version` is a STRING (e.g. 'v1'), the exact value
    // workflow_register's `result.version` returns — not a number. The catalog stores versions as
    // strings; a number reaches it and comes back VERSION_NOT_FOUND while the correct string was
    // rejected by ajv first, so no argument shape succeeded before this fix.
    // v24 (integrator, REQ-117/REQ-097 — found by the Batch-B executor): the row advertised
    // `{name, version}` with `version` OPTIONAL and NO `channel` at all, while the handler writes
    // `beta_version` for every channel other than the literal 'release'. So a cold model driving
    // this tool from exactly what it was shown published to BETA, and its next `run_start`/
    // `workflow_describe` answered CHANNEL_UNPUBLISHED — a first-try failure caused purely by the
    // schema, which is REQ-117's own definition of a documentation defect. `version` is required in
    // substance too (`publish()` does `known.has(version)`), so it is required here.
    inputSchema: schema({
      name: { type: 'string' },
      version: { type: 'string', description: "The version string returned by workflow_register, e.g. 'v1'." },
      channel: { type: 'string', enum: ['release', 'beta'], description: "Which pointer to move. 'release' is the channel a bare run_start resolves." },
      // REQUIRED, per DES-114/ARCH-073's own drift lock (IT-087) — no v24 text retires it. The
      // facade still defaults an omitted channel to 'release' as defence for a direct (non-wire)
      // caller, but a caller reading the schema is told to name it: a silent default that sends the
      // publish to `beta_version` is what made this tool undriveable from its own advertisement.
    }, ['name', 'version', 'channel']),
    outputSchema: OUT,
    errors: ['WORKFLOW_NOT_FOUND', 'VERSION_NOT_FOUND', 'INVALID_CHANNEL', 'NOT_WORKFLOW_OWNER', 'FORBIDDEN_ROLE'],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'workflow' } as AuthzRow,
    fixture: {
      happy: { name: ref('workflow'), version: ref('version'), channel: 'release' },
      errors: {
        WORKFLOW_NOT_FOUND: { name: ABSENT_WORKFLOW, version: 'v1', channel: 'release' },
        VERSION_NOT_FOUND: { name: ref('workflow'), version: 'v999', channel: 'release' },
      },
    },
  },
  {
    name: 'workflow_describe', entity: 'workflow', key: 'name' as const,
    description: "Describe a workflow's runnable release: per-agent parameters, agent labels, and its author-supplied diagram.",
    inputSchema: schema({ name: { type: 'string' } }, ['name']),
    outputSchema: OUT,
    errors: ['WORKFLOW_NOT_FOUND'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: { name: ref('workflow') }, errors: { WORKFLOW_NOT_FOUND: { name: ABSENT_WORKFLOW } } },
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
    fixture: {
      happy: { name: ref('workflow') },
      errors: {
        WORKFLOW_NOT_FOUND: { name: ABSENT_WORKFLOW },
        VERSION_NOT_FOUND: { name: ref('workflow'), version: 'v999' },
      },
    },
  },
  {
    name: 'workflow_list', entity: 'workflow', key: null,
    description: 'List registered workflows; each row carries whether it currently has a runnable release.',
    inputSchema: schema({ onlyRunnable: { type: 'boolean' } }),
    outputSchema: OUT,
    errors: [] as ErrorCode[],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: {}, errors: {} },
  },
  {
    name: 'workflow_authoring_guide', entity: 'workflow', key: null,
    description: "Return the authoring guide, rendered from the engine's own enforcement constants — parameter ceilings, reserved names, and the agent-call scanning rules.",
    inputSchema: schema({}),
    outputSchema: OUT,
    errors: [] as ErrorCode[],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: {}, errors: {} },
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
        // v24 (integrator, REQ-001 — found by the Batch-E executor): `args` and `budget` were lost
        // when this schema was CLOSED (`additionalProperties:false`), exactly as the four seed
        // fields were (adjudication #2 A-2). Both are declared on `RunSpec`, both are read by
        // `McpFacade.runStart`, and `args` is the run-argument channel the authoring guide's own
        // `meta.params.args` example teaches — so the engine advertised a workflow API it then
        // refused to be called with.
        args: { description: "Run arguments, shaped by the script's own `meta.params.args` declaration and read in-script as `args.<key>`." },
        budget: { type: ['number', 'null'], description: 'Total token budget for the whole run, shared by every agent() call including nested workflow() frames. Omitted or null means unbounded.' },
        // B-1 (v24 adjudication #3): a STRING, the exact value workflow_register's
        // `result.version` returns — see workflow_publish's row for why.
        version: { type: 'string', description: "The version string returned by workflow_register, e.g. 'v1'." },
        // v24 (integrator, REQ-097 — found by the Batch-B/C executors): `channel` was dropped from
        // this CLOSED schema while `RunSpec.channel` and `run-manager.ts`'s `catalog.resolve(name,
        // {version, channel})` both still consume it, and this row's own errors[] advertises
        // CHANNEL_UNPUBLISHED — a code unreachable without it. No design text ratified the removal.
        channel: { type: 'string', enum: ['release', 'beta'], description: "Which published pointer to run. Defaults to 'release'. A `version` wins over a `channel`." },
        // v24 (integrator, REQ-117): the shape is DOCUMENTED here because `tools/list` is the only
        // thing a cold model reads. It stays OPEN (not `additionalProperties:false`) on purpose:
        // admission answers `PARAM_LOCKED` / `PARAM_UNKNOWN` / `UNKNOWN_AGENT_LABEL`, each of which
        // names the offending key, and a schema refusal would replace all three with a generic
        // INVALID_ARGUMENT.
        overrides: {
          type: 'object',
          description:
            "Per-agent parameter overrides, keyed by the script's own agent label: " +
            "{agents: {'<label>': {model?, effort?, timeoutMs?, appendPrompt?}}}. " +
            'There are no workflow-wide override fields — an override reaches exactly the label it names. ' +
            'prompt/tools/skills/mcp/workdir/cwd are author-locked (PARAM_LOCKED).',
        },
        seed: { type: 'array' },
        seedManifest: { type: 'array' },
        // v24 (integrator, REQ-080 — found by the Batch-B executor): a bare `{type:'object'}` told
        // a caller nothing about the two fields the fetcher requires, nor that the whole feature is
        // fail-closed behind the operator's `seedRefAllowlist`.
        seedRef: {
          type: 'object',
          description: 'Engine-pull seed from an allowlisted git remote. Requires the operator to have configured seedRefAllowlist, else SEEDREF_DISABLED. Mutually exclusive with seed/seedManifest/seedManifestRef (SEED_SOURCE_CONFLICT).',
          properties: { repoUrl: { type: 'string' }, sha: { type: 'string', description: 'The exact commit sha to fetch; a mismatch is SEEDREF_SHA_MISMATCH.' } },
          required: ['repoUrl', 'sha'],
        },
        seedManifestRef: { type: 'string' },
      }, ['name']),
      additionalProperties: false,
    },
    outputSchema: OUT,
    errors: ['WORKFLOW_NOT_FOUND', 'VERSION_NOT_FOUND', 'CHANNEL_UNPUBLISHED', 'NOT_RUNNABLE', 'INVALID_ARGUMENT', 'INLINE_SCRIPT_CLOSED', 'PARAM_LOCKED', 'PARAM_UNKNOWN', 'PARAM_OUT_OF_RANGE', 'UNKNOWN_AGENT_LABEL', 'UNKNOWN_ALIAS', 'AGENT_UNDECLARED', 'LEGACY_REREGISTER', 'INVALID_SEED_SPEC', 'SEED_SOURCE_CONFLICT', 'SEEDREF_DISABLED', 'EGRESS_DENIED', 'CAS_UNAVAILABLE', 'MISSING_BLOBS', 'RUN_ADMISSION_LIMIT'],
    seeAlso: ['workflow_publish', 'run_status', 'run_result'],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: {
      happy: { name: ref('workflow') },
      errors: {
        WORKFLOW_NOT_FOUND: { name: ABSENT_WORKFLOW },
        SEED_SOURCE_CONFLICT: { name: ref('workflow'), seed: [{ path: 'a.txt', contentB64: 'AAAA' }], seedManifest: [{ path: 'b.txt', sha256: '0'.repeat(64) }] },
      },
    },
  },
  {
    name: 'run_status', entity: 'run', key: 'runId' as const,
    description: "Poll a run's status; terminal states carry the final outcome. The owner's response also lists any cross-principal reads of this run's workspace or logs.",
    inputSchema: schema({ runId: { type: 'string' } }, ['runId']),
    outputSchema: OUT,
    errors: ['RUN_NOT_FOUND', 'NOT_RUN_OWNER'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'run' } as AuthzRow,
    fixture: { happy: { runId: ref('terminalRunId') }, errors: { RUN_NOT_FOUND: { runId: ABSENT_ID } } },
  },
  {
    name: 'run_result', entity: 'run', key: 'runId' as const,
    description: "Fetch a terminal run's result payload.",
    inputSchema: schema({ runId: { type: 'string' } }, ['runId']),
    outputSchema: OUT,
    errors: ['RUN_NOT_FOUND', 'RUN_NOT_TERMINAL', 'NOT_RUN_OWNER', 'NESTING_DEPTH_EXCEEDED', 'NESTING_CYCLE', 'DESCENDANT_CAP_EXCEEDED'],
    seeAlso: [] as string[],
    // Gate 6.5+7 round 2 (verifier): `adminCrossRead` was MISSING here while DES-151 states in so
    // many words that "`run_result` is added to the audited set" and `AuditAction` names it. Without
    // the flag `authorize()` let an admin read another principal's result and never set
    // `crossPrincipalRead`, so `McpFacade.runResult`'s audited branch was unreachable in production:
    // the cross-read happened, unaudited, and the owner's `run_status.adminReads[]` never showed it.
    authz: { minRole: 'user', ownership: 'run', adminCrossRead: true } as AuthzRow,
    fixture: {
      happy: { runId: ref('terminalRunId') },
      errors: {
        RUN_NOT_FOUND: { runId: ABSENT_ID },
        RUN_NOT_TERMINAL: { runId: ref('liveRunId') },
      },
    },
  },
  {
    name: 'run_suspend', entity: 'run', key: 'runId' as const,
    description: 'Suspend a running run.',
    inputSchema: schema({ runId: { type: 'string' } }, ['runId']),
    outputSchema: OUT,
    errors: ['RUN_NOT_FOUND', 'ILLEGAL_TRANSITION', 'NOT_RUN_OWNER'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'run' } as AuthzRow,
    fixture: {
      happy: { runId: ref('suspendTargetRunId') },
      errors: {
        RUN_NOT_FOUND: { runId: ABSENT_ID },
        ILLEGAL_TRANSITION: { runId: ref('terminalRunId') },
      },
    },
  },
  {
    name: 'run_resume', entity: 'run', key: 'runId' as const,
    description: 'Resume a suspended run.',
    inputSchema: schema({ runId: { type: 'string' } }, ['runId']),
    outputSchema: OUT,
    errors: ['RUN_NOT_FOUND', 'ILLEGAL_TRANSITION', 'NOT_RUN_OWNER', 'INVALID_ARGUMENT', 'INLINE_SCRIPT_CLOSED', 'LEGACY_REREGISTER', 'PARAM_SECRET_UNAVAILABLE'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'run' } as AuthzRow,
    fixture: {
      happy: { runId: ref('suspendedRunId') },
      errors: {
        RUN_NOT_FOUND: { runId: ABSENT_ID },
        ILLEGAL_TRANSITION: { runId: ref('terminalRunId') },
      },
    },
  },
  {
    name: 'run_stop', entity: 'run', key: 'runId' as const,
    description: 'Stop a run.',
    inputSchema: schema({ runId: { type: 'string' } }, ['runId']),
    outputSchema: OUT,
    errors: ['RUN_NOT_FOUND', 'ILLEGAL_TRANSITION', 'NOT_RUN_OWNER'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'run' } as AuthzRow,
    fixture: {
      happy: { runId: ref('stopTargetRunId') },
      errors: {
        RUN_NOT_FOUND: { runId: ABSENT_ID },
        ILLEGAL_TRANSITION: { runId: ref('terminalRunId') },
      },
    },
  },
  {
    name: 'run_agent_log', entity: 'run', key: 'runId' as const,
    // v24 (integrator, REQ-083/DES-088 — found by the Batch-B executor): the redaction sentence was
    // lost in the rename. Redaction is live (`secret-resolver.ts`'s marker), and a reader who does
    // not know the marker is engine-written reads it as the agent's own output.
    description:
      "Read one agent's harness log for a run, by the agent LABEL the script declares. A " +
      "cross-principal read of another principal's run is audited. " +
      'Secret values are replaced with \u2039secret:NAME\u203a markers in persisted transcripts.',
    inputSchema: schema({ runId: { type: 'string' }, label: { type: 'string' } }, ['runId', 'label']),
    outputSchema: OUT,
    errors: ['RUN_NOT_FOUND', 'AGENT_LOG_NOT_FOUND', 'NOT_RUN_OWNER'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'run', adminCrossRead: true } as AuthzRow,
    fixture: {
      happy: { runId: ref('liveRunId'), label: ref('agentLabel') },
      errors: {
        RUN_NOT_FOUND: { runId: ABSENT_ID, label: FIXTURE_AGENT_LABEL },
        AGENT_LOG_NOT_FOUND: { runId: ref('liveRunId'), label: 'no-such-label' },
      },
    },
  },
  {
    name: 'run_list', entity: 'run', key: null,
    description: "List runs, filtered to the caller's own rows; unfiltered for the operator role.",
    inputSchema: schema({ workflow: { type: 'string' }, status: { type: 'string' }, limit: { type: 'number' } }),
    outputSchema: OUT,
    errors: [] as ErrorCode[],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: {}, errors: {} },
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
    fixture: { happy: { manifest: [] }, errors: { INVALID_ARGUMENT: {} } },
  },
  {
    name: 'workspace_push', entity: 'workspace', key: null,
    description: 'Push content: a CAS blob into the caller\'s own pool, or a workflow-owned asset (skill/mcp). Any runId argument is refused — see workflow_authoring_guide.',
    inputSchema: pushInputSchema(),
    outputSchema: OUT,
    errors: ['INVALID_ARGUMENT', 'RESERVED_PREFIX', 'WORKSPACE_ESCAPE', 'BLOB_HASH_MISMATCH', 'FORBIDDEN_ROLE', 'NOT_WORKFLOW_OWNER', 'MCP_PROBE_FAILED', 'EGRESS_DENIED', 'HOOKS_UNSUPPORTED'],
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
    fixture: {
      // The sha256 of the three zero bytes `AAAA` decodes to — a fixture whose declared hash does
      // not match its own content is refused BLOB_HASH_MISMATCH and proves nothing about the tool.
      happy: { sha256: '709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c', contentB64: 'AAAA' },
      // DES-155's own boundary, verified from the schema rather than asserted in prose: a `runId`
      // matches NEITHER `oneOf` branch, so ajv refuses it before any handler runs.
      errors: {
        INVALID_ARGUMENT: { runId: ABSENT_ID, kind: 'skill', name: 'x' },
        // ARCH-093/A-5: the engine's own reserved prefix is refused for the asset NAME, not only
        // for the files inside it — a skill stored as `rwe-…` would be materialized into
        // `.claude/skills/rwe-…`, which is the impersonation the prefix exists to prevent.
        RESERVED_PREFIX: { workflow: 'demo', kind: 'skill', name: 'rwe-impostor', files: [] },
        BLOB_HASH_MISMATCH: { sha256: 'b'.repeat(64), contentB64: 'AAAA' },
      },
    },
  },
  {
    name: 'workspace_pull', entity: 'workspace', key: 'runId' as const,
    description: "Read a byte range from a file in a run's workspace; a cross-principal read of another principal's run is audited.",
    inputSchema: schema({ runId: { type: 'string' }, path: { type: 'string' }, offset: { type: 'number' }, length: { type: 'number' } }, ['runId', 'path']),
    outputSchema: OUT,
    errors: ['RUN_NOT_FOUND', 'WORKSPACE_ESCAPE', 'NOT_FOUND', 'NOT_RUN_OWNER'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'run', adminCrossRead: true } as AuthzRow,
    fixture: {
      happy: { runId: ref('terminalRunId'), path: ref('seededPath') },
      errors: {
        RUN_NOT_FOUND: { runId: ABSENT_ID, path: 'output.txt' },
        NOT_FOUND: { runId: ref('terminalRunId'), path: 'definitely-absent.txt' },
        WORKSPACE_ESCAPE: { runId: ref('terminalRunId'), path: '../../etc/passwd' },
      },
    },
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
    fixture: {
      happy: { runId: ref('terminalRunId') },
      errors: {
        RUN_NOT_FOUND: { runId: ABSENT_ID },
        WORKFLOW_NOT_FOUND: { workflow: ABSENT_WORKFLOW, kind: 'skill' },
      },
    },
  },
  {
    name: 'workspace_delete', entity: 'workspace', key: null,
    description: "Delete files from a run's workspace, an asset under a workflow, or (admin) a global asset.",
    inputSchema: schema({ runId: { type: 'string' }, paths: { type: 'array' }, workflow: { type: 'string' }, kind: { type: 'string' }, name: { type: 'string' }, scope: { type: 'string' } }),
    outputSchema: OUT,
    // v24 (integrator; adjudication #4 C-6 [21] — the found example): `withTerminalRun` really
    // throws RUN_NOT_TERMINAL on a live run and this row never said so, so a cold model could not
    // anticipate a refusal it is certain to meet. `INVALID_ARGUMENT` is the no-mode-matched branch.
    errors: ['RUN_NOT_FOUND', 'RUN_NOT_TERMINAL', 'WORKFLOW_NOT_FOUND', 'NOT_RUN_OWNER', 'NOT_WORKFLOW_OWNER', 'INVALID_ARGUMENT', 'FORBIDDEN_ROLE'],
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
    fixture: {
      happy: { runId: ref('terminalRunId'), paths: [ref('seededPath')] },
      errors: {
        RUN_NOT_FOUND: { runId: ABSENT_ID, paths: ['a.txt'] },
        RUN_NOT_TERMINAL: { runId: ref('liveRunId'), paths: ['a.txt'] },
      },
    },
  },
  {
    name: 'workspace_purge', entity: 'workspace', key: 'runId' as const,
    description: "Purge a terminated run's workspace from disk.",
    inputSchema: schema({ runId: { type: 'string' } }, ['runId']),
    outputSchema: OUT,
    errors: ['RUN_NOT_FOUND', 'RUN_NOT_TERMINAL', 'NOT_RUN_OWNER'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'run' } as AuthzRow,
    fixture: { happy: { runId: ref('terminalRunId') }, errors: { RUN_NOT_FOUND: { runId: ABSENT_ID } } },
  },

  // ---- schedule (4) ----
  {
    name: 'schedule_create', entity: 'schedule', key: null,
    description: "Register a time trigger for a workflow; the caller becomes its owner. Defaults to kind:'cron' — pass kind:'once' with {at} for a one-shot, or kind:'resident' for a trigger-only schedule that never fires on a clock.",
    // v24 (integrator, REQ-015): the row advertised ONLY `{workflow, cron}` with both required, so
    // the one-shot and resident kinds REQ-015 clause 2 specifies (and VAL-016 validates) were
    // unreachable through the tool surface — ajv refused them for a missing `cron` before the store
    // ever saw them. The store has supported all three kinds since v2; only the schema was narrow.
    inputSchema: schema({
      workflow: { type: 'string' },
      kind: { type: 'string', enum: ['cron', 'once', 'resident'], description: "Defaults to 'cron' when omitted." },
      cron: { type: 'string', description: "A 5-field cron expression, e.g. '0 3 * * *'. Required when kind is 'cron'." },
      at: { type: 'string', description: "An ISO-8601 timestamp. Required when kind is 'once'; a past value fires on the next tick." },
      tz: { type: 'string', description: "IANA timezone the cron fields are read in; UTC when omitted." },
      args: { description: 'Run arguments handed to every firing.' },
      enabled: { type: 'boolean', description: 'Defaults to true when omitted — a schedule created disabled never fires.' },
    }, ['workflow']),
    outputSchema: OUT,
    errors: ['WORKFLOW_NOT_FOUND', 'VERSION_NOT_FOUND', 'CHANNEL_UNPUBLISHED', 'INVALID_CRON', 'INVALID_AT', 'TRIGGER_ALREADY_CLAIMED', 'FORBIDDEN_ROLE'],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'none' } as AuthzRow,
    fixture: {
      happy: { workflow: ref('workflow'), cron: '* * * * *' },
      errors: { WORKFLOW_NOT_FOUND: { workflow: ABSENT_WORKFLOW, cron: '* * * * *' } },
    },
  },
  {
    name: 'schedule_list', entity: 'schedule', key: null,
    description: "List the caller's own schedules; unfiltered for the operator role.",
    inputSchema: schema({}),
    outputSchema: OUT,
    errors: [] as ErrorCode[],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'none' } as AuthzRow,
    fixture: { happy: {}, errors: {} },
  },
  {
    name: 'schedule_delete', entity: 'schedule', key: 'id' as const,
    description: "Delete a schedule and release its claim on the workflow name.",
    inputSchema: schema({ id: { type: 'string' } }, ['id']),
    outputSchema: OUT,
    errors: ['TRIGGER_NOT_FOUND', 'NOT_TRIGGER_OWNER'],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'trigger' } as AuthzRow,
    fixture: { happy: { id: ref('deletableScheduleId') }, errors: { TRIGGER_NOT_FOUND: { id: ABSENT_ID } } },
  },
  {
    name: 'schedule_setEnabled', entity: 'schedule', key: 'id' as const,
    description: "Enable or disable a schedule without releasing its claim.",
    inputSchema: schema({ id: { type: 'string' }, enabled: { type: 'boolean' } }, ['id', 'enabled']),
    outputSchema: OUT,
    errors: ['TRIGGER_NOT_FOUND', 'NOT_TRIGGER_OWNER'],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'trigger' } as AuthzRow,
    fixture: {
      happy: { id: ref('scheduleId'), enabled: false },
      errors: { TRIGGER_NOT_FOUND: { id: ABSENT_ID, enabled: false } },
    },
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
    fixture: {
      happy: { workflow: ref('workflow') },
      errors: { WORKFLOW_NOT_FOUND: { workflow: ABSENT_WORKFLOW } },
    },
  },
  {
    name: 'webhook_list', entity: 'webhook', key: null,
    description: "List the caller's own webhooks; unfiltered for the operator role.",
    inputSchema: schema({}),
    outputSchema: OUT,
    errors: [] as ErrorCode[],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'none' } as AuthzRow,
    fixture: { happy: {}, errors: {} },
  },
  {
    name: 'webhook_delete', entity: 'webhook', key: 'id' as const,
    description: "Delete a webhook and release its claim on the workflow name.",
    inputSchema: schema({ id: { type: 'string' } }, ['id']),
    outputSchema: OUT,
    errors: ['TRIGGER_NOT_FOUND', 'NOT_TRIGGER_OWNER'],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'trigger' } as AuthzRow,
    fixture: { happy: { id: ref('webhookId') }, errors: { TRIGGER_NOT_FOUND: { id: ABSENT_ID } } },
  },

  // ---- issue (5) ----
  {
    name: 'issue_report', entity: 'issue', key: null,
    // v24 (integrator, REQ-095/REQ-032 — found by the Batch-C executor): the row advertised
    // `{title, body}` with both required. `issue-reporter.ts`'s own REQUIRED_FIELDS are
    // `title/reproSteps/analysis` and there is no `body` field at all, so a caller obeying this
    // schema was refused ISSUE_REPORT_INVALID for a field it was never shown — while `workflow`,
    // which is live (it adds the `workflow:<name>` label and enters the ARCH-024 dedup
    // fingerprint), was undiscoverable.
    description: 'File a pre-analyzed issue against the engine. Reports are deduplicated by title+component+workflow.',
    inputSchema: schema({
      title: { type: 'string' },
      reproSteps: { type: 'string', description: 'How to reproduce it — required, non-empty.' },
      analysis: { type: 'string', description: 'What you already established about the cause — required, non-empty.' },
      logs: { type: 'string' },
      severity: { type: 'string' },
      component: { type: 'string' },
      runId: { type: 'string', description: 'The run this was observed on, if any.' },
      workflow: { type: 'string', description: 'Binds the report to a registered workflow name; adds a workflow:<name> label.' },
      version: { type: 'string', description: "The engine version, or (with `workflow`) that workflow's version." },
    }, ['title', 'reproSteps', 'analysis']),
    outputSchema: OUT,
    errors: [] as ErrorCode[],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: { title: 'fixture issue', reproSteps: 'call issue_report', analysis: 'REQ-118 surface probe' }, errors: {} },
  },
  {
    name: 'issue_get', entity: 'issue', key: 'number' as const,
    description: 'Fetch a single issue by number.',
    inputSchema: schema({ number: { type: 'number' } }, ['number']),
    outputSchema: OUT,
    errors: ['ISSUE_NOT_FOUND'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: { number: 1 }, errors: { ISSUE_NOT_FOUND: { number: 999999999 } } },
  },
  {
    name: 'issue_list', entity: 'issue', key: null,
    description: 'List issues.',
    inputSchema: schema({}),
    outputSchema: OUT,
    errors: [] as ErrorCode[],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: {}, errors: {} },
  },
  {
    name: 'issue_get_comments', entity: 'issue', key: 'number' as const,
    description: "Fetch an issue's latest comments.",
    inputSchema: schema({ number: { type: 'number' } }, ['number']),
    outputSchema: OUT,
    errors: ['ISSUE_NOT_FOUND'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: { number: 1 }, errors: { ISSUE_NOT_FOUND: { number: 999999999 } } },
  },
  {
    name: 'issue_comment_post', entity: 'issue', key: 'number' as const,
    description: 'Post a comment on an issue.',
    inputSchema: schema({ number: { type: 'number' }, body: { type: 'string' } }, ['number', 'body']),
    outputSchema: OUT,
    errors: ['ISSUE_NOT_FOUND'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: { number: 1, body: 'hi' }, errors: { ISSUE_NOT_FOUND: { number: 999999999, body: 'hi' } } },
  },

  // ---- environment (2) ----
  {
    name: 'models_list', entity: 'models', key: null,
    // v24 (integrator, REQ-117 — found by the Batch-B executor): every one of the nine filters
    // `filterCatalog()` implements, and the meaning of the enriched rating fields, were served but
    // undiscoverable. A cold model reading `{properties:{}}` cannot filter a catalog it must choose
    // a model from.
    description:
      'List the model catalog. Each row carries provider, model, description, modalities, ' +
      'contextWindow, price, toolUse, location, plus the engine ratings: `capability` (a one-line ' +
      'summary), `stability`, and `costLevel` — an integer 0..10 where 0 is free and 10 is the most ' +
      'expensive tier, null when the provider publishes no price.',
    inputSchema: schema({
      provider: { type: 'string', description: "Exact provider id, e.g. 'anthropic' or 'ollama'." },
      query: { type: 'string', description: 'Substring match over the model id and description.' },
      modalityIn: { type: 'string' },
      modalityOut: { type: 'string' },
      maxPricePerM: { type: 'number', description: 'Upper bound on price per million tokens.' },
      minContext: { type: 'number', description: 'Lower bound on contextWindow.' },
      toolUse: { type: 'boolean' },
      location: { type: 'string', enum: ['local', 'remote'] },
      limit: { type: 'number' },
    }),
    outputSchema: OUT,
    errors: [] as ErrorCode[],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: {}, errors: {} },
  },
  {
    name: 'system_info', entity: 'system', key: null,
    // v24 (integrator, REQ-117 — found by the Batch-B executor): `topN` is implemented
    // (`call-tool.ts` defaults it to 5, `system-info.ts` CLAMPS it to 50 rather than refusing) and
    // was advertised nowhere, so the only way to discover it was to read the engine's source.
    description:
      'Report engine system info: CPU, memory, disk, active processes, and the auth summary. ' +
      'Sizes are in bytes, load and utilisation as a percent (`usedPct`), uptime in seconds. ' +
      'A block whose probe is unavailable on this host is served as null with a reason, never omitted.',
    inputSchema: schema({
      topN: {
        type: 'integer',
        default: 5,
        minimum: 1,
        maximum: 50,
        description: 'How many processes to return, by descending CPU. Out-of-range values are CLAMPED to this range, never refused.',
      },
    }),
    outputSchema: OUT,
    errors: [] as ErrorCode[],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: {}, errors: {} },
  },
] as const satisfies readonly ToolSpec[];

// v24 (TASK-155, DES-138): `as const` above makes `name` a literal per row, so `ToolName` is the
// true 35-member literal union (not `string`) — DES-151's `AuditAction = Extract<ToolName, …>`
// depends on this narrowing to avoid silently resolving to `never`.
export type ToolName = (typeof TOOL_SPECS)[number]['name'];

function buildDescription(spec: ToolSpec): string {
  let text: string = spec.description;
  if (spec.errors.length > 0) text += `\nErrors: ${spec.errors.join(', ')}`;
  // v24 (integrator; REQ-106/REQ-116): the guide pointer is DERIVED, not hand-typed per row.
  // `ERROR_CATALOG` already records, once, which codes point back at `workflow_authoring_guide`
  // (DES-137's "the `see` pointer attached in this ONE place"); a tool that can answer any of them
  // must say so in the description a cold client reads, because `tools/list` is the only
  // documentation it ever sees. Hand-typing it per row is how `workflow_register` — the tool most
  // in need of the pointer — ended up without one.
  const pointsAtGuide =
    spec.errors.some((code) => ERROR_CATALOG[code]?.see === 'workflow_authoring_guide') ||
    spec.seeAlso.includes('workflow_authoring_guide');
  const seeAlso = pointsAtGuide && !spec.seeAlso.includes('workflow_authoring_guide')
    ? ['workflow_authoring_guide', ...spec.seeAlso]
    : [...spec.seeAlso];
  if (seeAlso.length > 0) text += `\nSee also: ${seeAlso.join(', ')}`;
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
