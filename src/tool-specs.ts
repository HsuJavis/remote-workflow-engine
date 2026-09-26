// v24 DES-138 (ARCH-087, TASK-132): the 35-row tool surface — one data array that is the only
// source of `tools/list`, of each tool's `Errors:` line, and of the authorization row `authz.ts`
// checks once, before the dispatch switch. Pure data + one projection; imports only the `ErrorCode`
// TYPE from errors.ts (DES-137) so every row's `errors[]` is tsc-checked against the closed catalog.
import { ERROR_CATALOG, type ErrorCode } from './errors.js';
// v25 (#55): the ONE other value import this file takes, and for the same reason as the type one
// above — `run_start.overrides`'s description enumerates the locked keys, and a transcribed copy of
// that vocabulary is what let `tools` survive here after the pipeline moved to `allowedTools`.
// `params/contract.ts` is pure (no I/O, no VM) and imports only `ErrorCode`, so this adds no cycle.
import { LOCKED_KEYS } from './params/contract.js';
// v26 (DES-170, TASK-175, issue #64): another value import — SEED_ITEM_HINT so the
// `run_start` schema's `seed.items.contentB64` description and validateSeedSpec's refusal message
// (run-manager.ts, via workspace-seed.ts) can never drift apart. Pure (no I/O), no cycle.
import { SEED_ITEM_HINT } from './workspace-seed.js';

// v35 (DES-239, ARCH-152/154, TASK-237, REQ-210): ONE exported constant, stating the double-JSON
// envelope every tool result arrives in — consumed by BOTH the `initialize` handshake (server.ts)
// and (transitively, via workflow_authoring_guide) this module, so the wording is stated once.
export const ENVELOPE_NOTE =
  'Every tool result arrives as a JSON string inside content[0].text — parse it again to reach the actual payload.';

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
// v26 (REQ-128, DES-184): the fixture is now a v2-CONTRACT workflow, because registration checks
// one. `phase('Greet')` is not decoration — rule L2 refuses an `agent()` dispatched before the
// first `phase()`, so the published happy fixture must show the shape it is asking authors for.
export const FIXTURE_SCRIPT =
  "export const meta = {\n" +
  "  description: 'Greet the caller in one sentence',\n" +
  `  params: { agents: { greet: ${FIXTURE_AGENT_SPEC} } },\n` +
  '};\n' +
  "phase('Greet');\n" +
  "return await agent('greet', { prompt: 'Say hello' });";

/** Exactly the labels `FIXTURE_SCRIPT` uses, in the minimal form `checkMermaid` accepts.
 *  v26 (REQ-128, DES-184): the v2 swimlane — `graph LR`, one `subgraph` per `phase()` in call
 *  order, the agent's stadium node inside its own phase's lane. No `<br/>` value triple and no
 *  `tools:` segment: both are optional, and this fixture is the MINIMUM a v2 registration accepts. */
export const FIXTURE_MERMAID = 'graph LR\nsubgraph "Greet"\ngreet(["greet"])\nend';

/** The one label `FIXTURE_SCRIPT` declares — `run_agent_log`'s happy fixture needs it by name. */
export const FIXTURE_AGENT_LABEL = 'greet';

/** ARRAY_ITEMS_RULE — v26 Gate 7.5 round 1 (defect D1): EVERY array-typed property on any schema
 *  in this file must declare `items`. This is not a documentation nicety: a Google/Gemini-family
 *  MCP client rejects the WHOLE `tools/list` payload with `400 INVALID_ARGUMENT …
 *  properties[<name>].items: missing field`, so one bare `{type:'array'}` costs every tool on the
 *  surface for that entire client family (observed live — the round-1 cold-model probe died before
 *  its first tool call). REQ-121/DES-170 closed it for `run_start.seed`; UT-213 walks every schema
 *  (through `oneOf`/`anyOf`/`properties`/`items`) so a fifth site cannot be added in silence. */
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
        properties: {
          workflow: { type: 'string' }, kind: { type: 'string' }, name: { type: 'string' },
          // v26 Gate 7.5 round 1 (defect D1): item schema — see ARRAY_ITEMS_RULE below.
          files: { type: 'array', description: "A skill's files — each element is {path, contentB64}, the file bytes as base64.", items: { type: 'object', required: ['path', 'contentB64'], properties: { path: { type: 'string' }, contentB64: { type: 'string' } } } },
          config: { type: 'object' }, scope: { type: 'string' },
        },
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
    description: 'Register a new workflow version under a name; the caller becomes its owner. Registering the same name again appends a new version (v2, v3…) and overwrites nothing; use a different name only for a different purpose. ' +
      // Issue #78(b): advertised here because a cold client reads only tools/list.
      "The reply may carry result.warnings — non-fatal notes, the version is registered anyway: BASH_SUBSUMES_FILE_TOOLS when an agent() call's allowedTools names Bash beside Read/Grep/Glob/Write/Edit (allowedTools restricts names, and Bash can do what those do); BASH_READONLY_UNENFORCEABLE when an agent() declares bash:'readonly' on an engine with no working Bash sandbox (every dispatch of it will fail closed there).",
    inputSchema: schema({
      name: { type: 'string' },
      script: { type: 'string' },
      // v26 (REQ-128, DES-184, integrator): the v2 swimlane contract, compressed to what a cold
      // client reading only `tools/list` needs to get it right FIRST TRY (REQ-117). The full prose,
      // with the four codes and a worked example, is `workflow_authoring_guide`'s "Canonical
      // diagram" section — every one of these codes points back at it via `see`.
      mermaid: {
        type: 'string',
        description:
          'Required. From v26 a NEW registration must be an LR swimlane matching the script: header ' +
          '`graph LR` (or `flowchart LR`) — `DIAGRAM_DIRECTION`; one `subgraph "title"`/`end` block ' +
          'per `phase()` call in call order, with each agent node declared inside the lane of the ' +
          'phase it is dispatched under — `LANE_MISMATCH` (and every `agent()` must be inside some ' +
          '`phase()` — `AGENT_BEFORE_PHASE`); an agent node reads ' +
          '`label<br/>model · effort · timeout<br/>tools: a, b` (sorted; `tools: none` for ' +
          '`allowedTools: []`; the segment is not compared when the call declares no allowedTools) ' +
          '— `TOOLS_MISMATCH`; consecutive calls joined by an edge, paths through non-agent shapes ' +
          'allowed, a non-consecutive agent→agent edge needs a `|label|` — `EDGE_MISMATCH`. Every ' +
          'refusal returns the STRUCTURE it expected, never a corrected diagram. Versions registered ' +
          'before v26 keep diagramContract:"v1" and are never re-checked.',
      },
      // v26 Gate 7.5 round 1 (defect D1): item schema — see ARRAY_ITEMS_RULE below.
      triggers: { type: 'array', description: 'Trigger ids (from schedule_create / webhook_create) this version claims. Each element is the id string.', items: { type: 'string' } },
      // Issue #82 (option B): the version's default seed — a REF only, never inline content.
      seedManifestRef: {
        type: 'string',
        pattern: '^[0-9a-f]{64}$',
        description:
          "Optional default seed for THIS version: the sha256 of a manifest you already uploaded (POST /assets/blob/<sha> for each file, then POST /assets/manifest). " +
          'Every run of this version that brings no seed of its own — run_start, a scheduled firing, a webhook delivery — starts with those files in its workspace. ' +
          'A run_start seed (seed/seedManifest/seedManifestRef/seedRef) REPLACES it, never merges. Checked now, in your own CAS namespace: MISSING_BLOBS if you never uploaded it, INVALID_SEED_SPEC if it is not a manifest. ' +
          'References only — inline seed/seedManifest/seedRef are refused INVALID_ARGUMENT. Versions are immutable: a different seed is a new registration (a new version).',
      },
    }, ['name', 'script']),
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
      // v26 (REQ-128, DES-184): the v2 diagram contract's own refusals, plus the
      // `deriveExpectedGraph` rule registration now answers with before it ever reads the diagram.
      // Advertised because `advertised-surface-truth`/`facade-refusal-arms` pin "every code this
      // tool can throw is on its errors list" — and because a cold model that cannot see
      // AGENT_BEFORE_PHASE cannot satisfy REQ-117's first-try bar.
      // v26 (M-5 send-back repair): `UNDECIDABLE_SHAPE` deleted — see errors.ts's matching row for
      // the full reasoning (zero producers; ADR-039 already routes those cases through SCAN_VIOLATION).
      'AGENT_BEFORE_PHASE',
      'DIAGRAM_DIRECTION', 'LANE_MISMATCH', 'TOOLS_MISMATCH', 'EDGE_MISMATCH',
      'NOT_WORKFLOW_OWNER', 'REGISTRATION_CONFLICT', 'VERSION_CEILING_EXCEEDED',
      'INVALID_ARGUMENT', 'TRIGGER_NOT_FOUND', 'NOT_TRIGGER_OWNER', 'TRIGGER_ALREADY_CLAIMED',
      'FORBIDDEN_ROLE',
      // Issue #82: the seedManifestRef ladder (RunManager.loadSeedManifestRef), run at register time.
      'MISSING_BLOBS', 'INVALID_SEED_SPEC', 'CAS_UNAVAILABLE',
    ],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'none' } as AuthzRow,
    fixture: {
      happy: { name: 'demo', script: FIXTURE_SCRIPT, mermaid: FIXTURE_MERMAID },
      errors: {
        MERMAID_REQUIRED: { name: 'fixture-no-mermaid', script: 'return 1;' },
        // v26: an LR swimlane whose ONE node names a label the script does not declare — the
        // mismatch is still the subject; the direction/lane rules are satisfied so the refusal
        // that comes back is DIAGRAM_MISMATCH and not DIAGRAM_DIRECTION.
        DIAGRAM_MISMATCH: { name: 'fixture-mismatch', script: FIXTURE_SCRIPT, mermaid: 'graph LR\nsubgraph "Greet"\nother(["other"])\nend' },
        SCAN_VIOLATION: { name: 'fixture-scan', script: "phase('Greet');\nconst l = \"greet\";\nreturn await agent(l, {});", mermaid: FIXTURE_MERMAID },
      },
    },
  },
  {
    name: 'workflow_deregister', entity: 'workflow', key: 'name' as const,
    // v36 (DES-246, TASK-244): `version` is optional — omitted, this deletes the WHOLE workflow
    // (every version, its diagrams, its assets, the name row) exactly as before; supplied, it
    // deletes only that one version's rows and the name/assets/other versions survive.
    description: "Delete a workflow and release every trigger claimed under its name. Optionally pass `version` to delete only that one version instead of the whole workflow.",
    inputSchema: schema({ name: { type: 'string' }, version: { type: 'string', description: "Optional. Delete only this version (e.g. 'v1') instead of the whole workflow." } }, ['name']),
    outputSchema: OUT,
    errors: [
      'WORKFLOW_NOT_FOUND', 'NOT_WORKFLOW_OWNER', 'FORBIDDEN_ROLE',
      // v36 (DES-246, TASK-244): only reachable when `version` is supplied.
      'VERSION_NOT_FOUND', 'VERSION_PINNED_BY_CHANNEL', 'VERSION_LAST_REMAINING', 'VERSION_PINNED_BY_RUN',
    ],
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
      // issue #89 item 4: `channel` is REQUIRED + a closed enum, so `call-tool.ts`'s ajv validation
      // (schema BEFORE dispatch, DES-140) refuses an out-of-enum value before `workflowPublish` is
      // ever called — verified: `facade.workflowPublish` has exactly one wire caller, `call-tool.ts`,
      // always past ajv. `channel:'alpha'` is therefore refused `INVALID_ARGUMENT` ("/channel must be
      // equal to one of the allowed values"), never `mcp-facade.ts`'s own `INVALID_CHANNEL` throw —
      // that code stays live only for a DIRECT (non-wire) facade caller.
      channel: { type: 'string', enum: ['release', 'beta'], description: "Which pointer to move. 'release' is the channel a bare run_start resolves. A value outside {release, beta} is refused INVALID_ARGUMENT by schema validation, before this tool ever runs." },
      // REQUIRED, per DES-114/ARCH-073's own drift lock (IT-087) — no v24 text retires it. The
      // facade still defaults an omitted channel to 'release' as defence for a direct (non-wire)
      // caller, but a caller reading the schema is told to name it: a silent default that sends the
      // publish to `beta_version` is what made this tool undriveable from its own advertisement.
    }, ['name', 'version', 'channel']),
    outputSchema: OUT,
    errors: ['WORKFLOW_NOT_FOUND', 'VERSION_NOT_FOUND', 'INVALID_ARGUMENT', 'NOT_WORKFLOW_OWNER', 'FORBIDDEN_ROLE'],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'workflow' } as AuthzRow,
    fixture: {
      happy: { name: ref('workflow'), version: ref('version'), channel: 'release' },
      errors: {
        WORKFLOW_NOT_FOUND: { name: ABSENT_WORKFLOW, version: 'v1', channel: 'release' },
        VERSION_NOT_FOUND: { name: ref('workflow'), version: 'v999', channel: 'release' },
        // issue #89 item 4: exercises the ajv-schema refusal LIVE, so the v24 C-6 reverse lock
        // (every refusal code observed from a live call is declared in that tool's errors[]) covers
        // this row's INVALID_ARGUMENT the same way its other two fixtures already cover their codes.
        INVALID_ARGUMENT: { name: ref('workflow'), version: ref('version'), channel: 'alpha' },
      },
    },
  },
  {
    name: 'workflow_describe', entity: 'workflow', key: 'name' as const,
    // v27b (DES-197, ARCH-131, TASK-202, REQ-106's precedent): names `phases[].agents` in the
    // advertised description itself, not just the schema shape, so a cold, schema-only client
    // learns the predicted lane membership without fetching first.
    description: "Describe a workflow: per-agent parameters, agent labels, live triggers, its author-supplied diagram, and the predicted lane membership (phases[].agents). Also returns registeredRemote: whether THIS version was registered by a remote submission — on a host whose Bash-confinement probe failed at boot, such a version is refused CONFINEMENT_UNAVAILABLE even for a local run_start, and this is the field that says which version to re-register locally. Defaults to the release pointer; pass version or channel to describe another one — an unpublished version must be named with version, since the release default answers CHANNEL_UNPUBLISHED.",
    // v24 Gate 7.5 (D-7, REQ-118): the handler has always accepted `version`/`channel` (it builds
    // a `VersionSelector` from them) and the row advertised only `name`. `version` is not a
    // convenience: a workflow that was never published cannot be described WITHOUT it — the bare
    // call is refused CHANNEL_UNPUBLISHED — so the one state a draft author most needs to read was
    // unreachable from the advertisement. `CHANNEL_UNPUBLISHED` joins `errors[]` for the same
    // reason: it is what a bare call on a draft answers.
    inputSchema: schema({
      name: { type: 'string' },
      version: { type: 'string', description: "A specific version, e.g. 'v2' — the only way to describe a workflow that has never been published." },
      channel: { type: 'string', enum: ['release', 'beta'], description: "Which pointer to resolve; defaults to 'release'." },
    }, ['name']),
    outputSchema: OUT,
    errors: ['WORKFLOW_NOT_FOUND', 'VERSION_NOT_FOUND', 'CHANNEL_UNPUBLISHED'],
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
    description: "List registered workflows; each row carries whether it currently has a runnable release. `lastRunAt` is the most recent run on record; null = never run.",
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
    description: "Start a run of a workflow's current release. First-try traps: a just-registered workflow has no release yet — pass {version} to run the version workflow_register just returned, to iterate, and call workflow_publish to move it to release once it is stable — and starting a run returns no result; poll run_status until terminal, then call run_result. The result may carry non-fatal `warnings` (the run is started regardless): MODEL_TOOL_USE_UNVERIFIED names an agent that holds tools on a model whose last probe (models_list toolUseVerified:false) did not use a tool.",
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
        args: { description: "Run arguments, shaped by the script's own `meta.params.args` declaration and read in-script as `args.<key>`. Omitted entirely, the script receives `{}`; a key with a declared `meta.params.args.<key>.default` is filled in from that default when the caller omits it." },
        // v26 (DES-181, ARCH-118, ADR-037, TASK-181, REQ-127/REQ-120): a bare number was the v25
        // shape (a token-only limit) — no longer advertised, and refused ahead of ajv (call-tool.ts)
        // with a migration message, the same precedent as the retired `{script}` door (call-tool.ts). `null`
        // must keep meaning unbounded (the owner's own published principle); `{}` is refused by
        // `minProperties`, since "explicitly no limits" is spelled `null`, never `{}`.
        budget: {
          anyOf: [
            { type: 'null' },
            {
              type: 'object',
              properties: { usd: { type: 'number', minimum: 0 }, tokens: { type: 'integer', minimum: 0 } },
              additionalProperties: false,
              minProperties: 1,
            },
          ],
          description: 'Total budget for the whole run, shared by every agent() call including nested workflow() frames: {usd?: <USD ceiling>, tokens?: <token ceiling, the four-column sum>}. Either key may be omitted; an unpriced model call adds 0 to the USD spend/limit. Omitted or null means unbounded.',
        },
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
            // v25 (#55): INTERPOLATED, not transcribed. The hand-written copy of this list said
            // `tools` and outlived the pipeline's `allowedTools` by three iterations; the drift-lock
            // in params-admission.test.ts checks this description against LOCKED_KEYS itself, and a
            // second literal is one more thing that can fall behind it.
            `${LOCKED_KEYS.join('/')} are author-locked (PARAM_LOCKED). ` +
            // v34 (DES-229, TASK-230, REQ-202): the three appendPrompt rules a cold client needs
            // BEFORE its first call — none of this was advertised anywhere on the tool surface.
            'appendPrompt must be declared by the author in meta.params.agents.<label>.appendPrompt ' +
            'or the override is refused PARAM_UNKNOWN. The supplied text is wrapped in ' +
            '<user-instructions untrusted="true">…</user-instructions> and the model is told that ' +
            'segment is untrusted. The effective bound is min(author, maxAppendPromptBytes) bytes, ' +
            'and a value containing the </user-instructions> frame-close delimiter is refused ' +
            'PARAM_OUT_OF_RANGE.',
        },
        // v26 (DES-170, TASK-175, issue #64): item schemas — a bare `{type:'array'}` told a caller
        // nothing about the required shape, which is exactly how a sha256-only `seed` element (the
        // `seedManifest` shape, missing `contentB64`) slipped past `tools/list` and was silently
        // materialized as a 0-byte file. `additionalProperties` stays OPEN here (see DES-170
        // boundary note): `required` alone carries the refusal until TASK-194 closes it.
        // v26 (DES-187, ARCH-121, TASK-193, REQ-121): a top-level `description` on the three seed
        // shapes themselves — `tools/list` is the only documentation a cold client ever reads, and
        // the authoring guide interpolates these three strings rather than re-typing them (ADR-032).
        seed: {
          type: 'array',
          description: 'Seed files by inline content — each element is {path, contentB64}, the file bytes as base64. Refused INVALID_SEED_SPEC if any element is missing contentB64.',
          // v26 (clarification 10) — DELIBERATELY LEFT OPEN, decision recorded rather than applied.
          // TASK-194's cross-repo read confirmed `additionalProperties:false` would not break the
          // plugin (it never sends an inline `seed` at all). It would, however, change WHICH
          // refusal a caller meets: ajv would answer `INVALID_ARGUMENT` before `validateSeedSpec`
          // ever runs, and IT-141/DES-170/REQ-121 exist precisely to guarantee the typed
          // `INVALID_SEED_SPEC` that NAMES the offending path and points at `seedManifest` — the
          // whole content of issue #64. A schema refusal is strictly less useful to the author, so
          // the enforced gate stays where the requirement put it. (Measured: closing it turns
          // IT-141 red for exactly this reason.)
          items: {
            type: 'object',
            required: ['path'],
            properties: { path: { type: 'string' }, contentB64: { type: 'string', description: SEED_ITEM_HINT } },
          },
        },
        seedManifest: {
          type: 'array',
          description: 'Seed files already pushed to the CAS via workspace_push — each element is {path, sha256, exec?}, referenced by hash rather than carrying content inline. Use for large trees, or content you already have a sha256 for.',
          items: {
            type: 'object',
            required: ['path', 'sha256'],
            properties: {
              path: { type: 'string' },
              sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
              exec: { type: 'boolean' },
            },
          },
        },
        // v24 (integrator, REQ-080 — found by the Batch-B executor): a bare `{type:'object'}` told
        // a caller nothing about the two fields the fetcher requires, nor that the whole feature is
        // fail-closed behind the operator's `seedRefAllowlist`.
        seedRef: {
          type: 'object',
          description: 'Engine-pull seed from an allowlisted git remote. Requires the operator to have configured seedRefAllowlist, else SEEDREF_DISABLED. Mutually exclusive with seed/seedManifest/seedManifestRef (SEED_SOURCE_CONFLICT).',
          properties: { repoUrl: { type: 'string' }, sha: { type: 'string', description: 'The exact commit sha to fetch; a mismatch is SEEDREF_SHA_MISMATCH.' } },
          required: ['repoUrl', 'sha'],
        },
        seedManifestRef: {
          type: 'string',
          pattern: '^[0-9a-f]{64}$',
          description: 'Seed the whole workspace from ONE manifest previously pushed as a CAS blob — the sha256 of that manifest.',
        },
      }, ['name']),
      additionalProperties: false,
    },
    outputSchema: OUT,
    errors: ['WORKFLOW_NOT_FOUND', 'VERSION_NOT_FOUND', 'CHANNEL_UNPUBLISHED', 'NOT_RUNNABLE', 'INVALID_ARGUMENT', 'INLINE_SCRIPT_CLOSED', 'PARAM_LOCKED', 'PARAM_UNKNOWN', 'PARAM_OUT_OF_RANGE', 'UNKNOWN_AGENT_LABEL', 'UNKNOWN_ALIAS', 'AGENT_UNDECLARED', 'LEGACY_REREGISTER', 'INVALID_SEED_SPEC', 'SEED_SOURCE_CONFLICT', 'SEEDREF_DISABLED', 'EGRESS_DENIED', 'CAS_UNAVAILABLE', 'MISSING_BLOBS', 'RUN_ADMISSION_LIMIT', 'CONFINEMENT_UNAVAILABLE'],
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
    description: "Poll a run's status; terminal states carry the final outcome. `failedAgentCount` counts terminal non-success agents; it is omitted (never 0) when the run has no agent records yet — absence is not health, poll again once agents exist, and read it against the `agentCount` this same row already returns. A terminal failure's `error.code` alone is not engine-attested — a script can forge one by setting `e.name` before rethrowing — only this run's own captured refusal ledger is. The owner's response also lists any cross-principal reads of this run's workspace or logs.",
    inputSchema: schema({ runId: { type: 'string' } }, ['runId']),
    outputSchema: OUT,
    errors: ['RUN_NOT_FOUND', 'NOT_RUN_OWNER'],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'run' } as AuthzRow,
    fixture: { happy: { runId: ref('terminalRunId') }, errors: { RUN_NOT_FOUND: { runId: ABSENT_ID } } },
  },
  {
    name: 'run_result', entity: 'run', key: 'runId' as const,
    // v26 (DES-183, ARCH-118, TASK-183, REQ-127): declares `meta` in the DESCRIPTION (never a
    // specialised outputSchema — see DES-183's own boundary) — `meta.usage` is this run's token/USD
    // total plus `unpricedCalls`/`unmappedMessages`; `meta.budgetEnforceable` names which limits can
    // actually bind given the models this run can reach, and which of those have no known price.
    description: "Fetch a terminal run's result payload. On a failed run, `result.error` is `{code, message}`. This run's own refusal ledger — never anything lifted from outside this run — is engine-attested; `error.code` alone is not and never has been (a script can set `e.name` before rethrowing to forge any code). The response also carries `meta.usage` (tokens, USD cost, unpriced-call count) and `meta.budgetEnforceable` (which limits can bind, and which reachable models have no known price).",
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
    errors: ['RUN_NOT_FOUND', 'ILLEGAL_TRANSITION', 'NOT_RUN_OWNER', 'INVALID_ARGUMENT', 'INLINE_SCRIPT_CLOSED', 'LEGACY_REREGISTER', 'PARAM_SECRET_UNAVAILABLE', 'CONFINEMENT_UNAVAILABLE'],
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
      'Secret values are replaced with \u2039secret:NAME\u203a markers in persisted transcripts. ' +
      // v34 (DES-229, TASK-230, REQ-202/203): the retired agentType/systemPrompt harness sentence
      // is replaced by the two-segment truth \u2014 there is no separate systemPrompt slot any more.
      'harness.prompt is the verbatim string dispatched to the model: the script\'s own prompt, ' +
      'then any appendPrompt override framed inline with its <user-instructions untrusted="true">\u2026' +
      '</user-instructions> delimiters.',
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
    description: "List runs, filtered to the caller's own rows; unfiltered for the operator role. `failedAgentCount` is terminal-only — a live run's row omits it (absent, never 0); poll run_status for a live count, and read it against each row's own `agentCount`.",
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
    // v26 Gate 7.5 round 1 (defect D1): item schema — see ARRAY_ITEMS_RULE below.
    inputSchema: schema({ manifest: { type: 'array', description: 'The files you intend to seed — each element is {path, sha256}. Only the sha256 is compared; `missing` answers which hashes are not in your pool yet.', items: { type: 'object', required: ['sha256'], properties: { path: { type: 'string' }, sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' } } } } }, ['manifest']),
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
    // v24 Gate 7.5 (D-6, REQ-118): `HOOKS_UNSUPPORTED` REMOVED — no push can produce it. A
    // `kind:'hook'` never reaches `classifyAsset` (the pre-v24 classifier that owns the code, and
    // which TASK-147/148 left with no production caller at all): `pushMode` resolves it to
    // `'invalid'` and the answer is INVALID_ARGUMENT. The seed path refuses a `.claude/hooks/…`
    // file through `pathVerdict`'s own CLAUDE_HOOKS strip, not through this code. Advertising a
    // code the tool cannot answer teaches a cold model to branch on something that never arrives —
    // the same reason `WORKFLOW_ALREADY_EXISTS` came off `workflow_register`.
    errors: ['INVALID_ARGUMENT', 'RESERVED_PREFIX', 'WORKSPACE_ESCAPE', 'BLOB_HASH_MISMATCH', 'FORBIDDEN_ROLE', 'NOT_WORKFLOW_OWNER', 'MCP_PROBE_FAILED', 'EGRESS_DENIED'],
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
    // v26 Gate 7.5 round 1 (defect D1): item schema — see ARRAY_ITEMS_RULE below.
    inputSchema: schema({ runId: { type: 'string' }, paths: { type: 'array', description: "Workspace-relative file paths to delete, each a string.", items: { type: 'string' } }, workflow: { type: 'string' }, kind: { type: 'string' }, name: { type: 'string' }, scope: { type: 'string' } }),
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
    description: "Create a time trigger and return its id; the caller becomes its owner. Name no workflow — hand the id to workflow_register({triggers:[id]}) to bind it to a version. Defaults to kind:'cron' — pass kind:'once' with {at} for a one-shot, or kind:'resident' for a trigger-only schedule that never fires on a clock.",
    // v24 (integrator, REQ-015): the row advertised ONLY `{workflow, cron}` with both required, so
    // the one-shot and resident kinds REQ-015 clause 2 specifies (and VAL-016 validates) were
    // unreachable through the tool surface — ajv refused them for a missing `cron` before the store
    // ever saw them. The store has supported all three kinds since v2; only the schema was narrow.
    inputSchema: { ...schema({
      kind: { type: 'string', enum: ['cron', 'once', 'resident'], description: "Defaults to 'cron' when omitted." },
      cron: { type: 'string', description: "A 5-field cron expression, e.g. '0 3 * * *'. Required when kind is 'cron'." },
      at: { type: 'string', description: "An ISO-8601 timestamp. Required when kind is 'once'; a past value fires on the next tick." },
      tz: { type: 'string', description: "IANA timezone the cron fields are read in; UTC when omitted." },
      args: { description: 'Run arguments handed to every firing.' },
      enabled: { type: 'boolean', description: 'Defaults to true when omitted — a schedule created disabled never fires.' },
    // v24 Gate 7.5 (D-1, REQ-115 clause 1 + ADR-026 scenario S-5): the row required `workflow`, so
    // an unclaimed trigger was impossible to create over MCP — the store has supported one since
    // TASK-141; only this row blocked it. v24 orchestrator adjudication #8 (H-2, issue #56) finishes
    // that move: `workflow` is GONE, not merely optional. D-1 dropped the create-time catalog check
    // (REQ-115 moves it to `workflow_register`) but left the argument, so the old door kept binding
    // while validating nothing — a schedule could self-claim a name that will never exist, which
    // `workflow_register` could then never claim. Binding is `workflow_register({triggers:[id]})`
    // only, which is what ARCH-099's `create(spec)` says and what this row's description promises.
    // Passing it is refused INVALID_ARGUMENT with the migration answer (call-tool.ts, ahead of ajv —
    // `schema()` sets no `additionalProperties:false`, so an undeclared key would still be admitted).
    // Issue #82: that is exactly how `seed` was lost — admitted, then dropped by the store. The row
    // is now CLOSED; the four seed keys still get their own explanatory refusal in call-tool.ts.
    }), additionalProperties: false },
    outputSchema: OUT,
    // WORKFLOW_NOT_FOUND / VERSION_NOT_FOUND / CHANNEL_UNPUBLISHED are GONE with the create-time
    // catalog check: REQ-115's last clause moves that check off this row — a trigger's target is
    // resolved when it FIRES (`resolveScheduleTarget`, which records UNCLAIMED /
    // CLAIMED_WORKFLOW_MISSING / CHANNEL_UNPUBLISHED / NOT_IN_RELEASE as refusals), because a
    // trigger created before its workflow exists has nothing to resolve yet.
    errors: ['INVALID_CRON', 'INVALID_AT', 'FORBIDDEN_ROLE'],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'none' } as AuthzRow,
    fixture: {
      happy: { cron: '* * * * *' },
      errors: { INVALID_CRON: { cron: 'not a cron expression' } },
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
    description: 'Create a webhook trigger and return its id, url and (once only) secret; the caller becomes its owner. Name no workflow — hand the id to workflow_register({triggers:[id]}) to bind it to a version.',
    // v24 Gate 7.5 (D-1) made `workflow` optional and dropped the create-time catalog check; v24
    // orchestrator adjudication #8 (H-2, issue #56) removes the argument outright — see the
    // schedule_create row above for the reasoning (REQ-115 clause 1, ADR-026 S-5, ARCH-099). A
    // webhook is created unclaimed and bound by `workflow_register({triggers:[id]})`; delivering to
    // an unclaimed one is refused UNCLAIMED at delivery and the refusal is recorded on the row
    // (`lastRefusalReason`), which is REQ-115's own stated behaviour.
    // Issue #82: CLOSED, like schedule_create. `enabled` was always honoured by the store
    // (webhook-registry.ts `create`) but never advertised; it is declared now so closing the row
    // does not remove it.
    inputSchema: { ...schema({
      enabled: { type: 'boolean', description: 'Defaults to true when omitted — a disabled webhook refuses deliveries.' },
    }), additionalProperties: false },
    outputSchema: OUT,
    errors: ['FORBIDDEN_ROLE'],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'none' } as AuthzRow,
    fixture: {
      happy: {},
      errors: {},
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
      'List the model catalog. ONE row per model: `aliases` lists EVERY alias name this ' +
      'deployment configures for it (a model named twice is one priced row, not two rows one of ' +
      'which claims `price:"unknown"`), and `ref` is the first of them — the string to pass to ' +
      '`agent({model})`. Each row also carries provider, model, description, modalities, ' +
      'contextWindow, price, location, plus the engine ratings: `capability` (a one-line ' +
      'summary), `stability`, and `costLevel` — an integer 0..10 where 0 is free and 10 is the most ' +
      'expensive tier, null when the provider publishes no price. v26: `toolUseDeclared` / ' +
      '`effortDeclared` (boolean, or \'unknown\' when the catalog said nothing) and `declaredSource` ' +
      "('upstream'|'static'|'unknown') are DECLARED capability, never probed by dispatching a call; " +
      '`catalogFetchedAt` is per-row catalog provenance (string timestamp, or null). ' +
      '`toolUseVerified` / `proseVerified` are OBSERVED by the engine\'s own probe of each configured ' +
      'model (see models_probe) — true/false from the last probe, null when never probed — with ' +
      '`lastProbedAt` and a short `probeDetail`. `stabilitySource` says where `stability` came from: ' +
      "'probe' (prose failed -> 'unavailable'; tools failed -> 'degraded'; both passed -> the rule tier) " +
      "or 'rule' (never probed: 'best-effort' for free tiers, 'variable' for local, else 'stable').",
    inputSchema: schema({
      provider: { type: 'string', description: "Exact provider id, e.g. 'anthropic' or 'ollama'." },
      query: { type: 'string', description: 'Substring match over the model id and description.' },
      modalityIn: { type: 'string' },
      modalityOut: { type: 'string' },
      maxPricePerM: { type: 'number', description: 'Upper bound on price per million tokens.' },
      minContext: { type: 'number', description: 'Lower bound on contextWindow.' },
      toolUseDeclared: { type: 'boolean' },
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
    // Issue #73: the admin-only "probe now". Each probe is one prose call plus one call holding
    // only Bash that must print a random value the probe planted — through the engine's own
    // gateway, so it measures what an agent() call would get.
    name: 'models_probe', entity: 'models', key: null,
    description:
      'Admin only. Probe the configured models NOW, through the same gateway agents use: per distinct ' +
      'configured provider/model (or only the one `alias` names), one prose call and one call allowed ' +
      'only the Bash tool that must run a command and report its unguessable output. Returns one row per ' +
      'model: alias, provider, model, proseVerified, toolUseVerified, probedAt, latencyMs {prose, tools}, ' +
      'detail. Results are stored and appear on models_list (toolUseVerified/proseVerified/lastProbedAt/' +
      'probeDetail/stabilitySource). Takes up to two probe timeouts per model; the engine also re-probes ' +
      'on its own every modelProbe.intervalMs (default weekly).',
    inputSchema: {
      ...schema({
        alias: { type: 'string', description: 'Probe only this configured alias. Omit to probe every configured model once.' },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 600000, description: "Per-call bound for this probe only (default: the engine's modelProbe.timeoutMs)." },
      }),
      additionalProperties: false,
    },
    outputSchema: OUT,
    errors: ['UNKNOWN_ALIAS', 'INVALID_ARGUMENT', 'FORBIDDEN_ROLE'] as ErrorCode[],
    seeAlso: ['models_list'] as string[],
    authz: { minRole: 'admin', ownership: 'none' } as AuthzRow,
    fixture: {
      // A short bound: the conformance engine's provider never answers, so the happy path is a
      // quickly-recorded FAILED probe — which is still the tool working as specified.
      happy: { alias: 'default', timeoutMs: 1000 },
      errors: { UNKNOWN_ALIAS: { alias: 'no-such-alias-fixture' }, INVALID_ARGUMENT: { alias: 5 } },
    },
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

/** Deterministic: pure projection over static data, no I/O, no Date.now(). // det:allow — a doc comment naming the API, not a call */
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
