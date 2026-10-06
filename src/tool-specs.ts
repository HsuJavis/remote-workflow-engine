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
// issue #146: workspace_list's own `includeBody` description states the real enforced byte bound —
// interpolated, not transcribed, so it cannot drift from what AssetSyncService actually enforces
// the way LOCKED_KEYS's old hand-typed copy (above) once did. Pure value (no cycle: asset-sync.ts
// imports neither this file nor authoring-guide.ts).
import { GLOBAL_SKILL_BODY_MAX_BYTES } from './asset-sync.js';
// issue #97: the delivery-contract facts webhook_create's description states — header names,
// the signature/HMAC key relationship, and the timestamp skew window — are the SAME exported values
// server.ts's POST /hooks/:id route and webhook-registry.ts's deliver() enforce, so a drift between
// what a cold client is told and what the wire actually checks fails a test instead of shipping.
import { WEBHOOK_HEADERS, REPLAY_WINDOW_MS } from './webhook-registry.js';
import { ADMISSION_PERMANENT_CODES } from './run-manager.js';
import { ALL_FIELDS, COMPACT_FIELDS, SORT_KEYS, DEFAULT_LIMIT, MAX_LIMIT } from './models/models-query.js';

// v35 (DES-239, ARCH-152/154, TASK-237, REQ-210): ONE exported constant, stating the double-JSON
// envelope every tool result arrives in — consumed by BOTH the `initialize` handshake (server.ts)
// and (transitively, via workflow_authoring_guide) this module, so the wording is stated once.
export const ENVELOPE_NOTE =
  'Every tool result arrives as a JSON string inside content[0].text — parse it again to reach the actual payload.';

/** Declared here (not authz.ts) so the dependency between the two files stays one-directional —
 *  authz.ts imports Role from this module (ARCH-088). */
export type Role = 'admin' | 'author' | 'user';
type Ownership = 'none' | 'run' | 'workflow' | 'trigger' | 'asset';

// Service accounts spec (owner decision 2026-10-03), §Authorization: `workflowArg` names the args
// property holding a workflow name for a row with no ownership subject of its own to key off (every
// CREATE-shaped tool — workflow_register, run_start, workflow_describe/source — whose row is
// `ownership:'none'` because there is nothing to own yet, or because reading a workflow's metadata
// needs no ownership at all). `authz.ts`'s allowlist check reads it for those rows; a row with
// `ownership:'workflow'`/`'asset'` needs no such field (its own existing subject resolution already
// names a workflow — see that check's own doc for why).
export type AuthzRow =
  | { minRole: Role; ownership: Ownership; workflowArg?: string }
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
  | 'stoppedRunId'    // a run already driven to `stopped`, for run_result's RUN_STOPPED fixture (issue #160 BUG-1)
  | 'seededPath'      // a file seeded into terminalRunId's workspace, for workspace_pull/delete
  | 'scheduleId'      // a schedule minted by schedule_create, for schedule_setEnabled
  | 'deletableScheduleId' // a SECOND schedule, consumed by schedule_delete's happy path
  | 'webhookId'       // a webhook minted by webhook_create
  // Service accounts spec (owner decision 2026-10-03): a service account minted by the setup
  // sequence (distinct from service_account_create's OWN happy-fixture name, so the two never
  // collide) — consumed by update/rotate/revoke/delete's happy fixtures.
  | 'serviceAccountName'
  | 'serviceAccountSecretId'
  // Send-back D2: a name created then immediately deleted by the setup sequence, so service_
  // account_create's SERVICE_ACCOUNT_NAME_RETIRED fixture has a real tombstone to hit.
  | 'retiredServiceAccountName';

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
  "{ model: { type: 'string', default: 'anthropic/claude-haiku-4-5-20251001' }, " +
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
// v39 (owner decision 2026-09-30): `meta.phases` is now REQUIRED and must match the script's own
// `phase()` calls — the fixture declares `phases: [{title:'Greet'}]`, matching the one `phase('Greet')`
// call below, or every consumer of this "happy" fixture would be refused PHASES_REQUIRED.
export const FIXTURE_SCRIPT =
  "export const meta = {\n" +
  "  description: 'Greet the caller in one sentence',\n" +
  "  phases: [{ title: 'Greet' }],\n" +
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
          workflow: { type: 'string' },
          // Issue #92 part B: closed enum of the actually-supported v24 AssetKind values — a bare
          // `{type:'string'}` let `kind:'nonsense'` (or any other junk) reach the handler; ajv now
          // answers INVALID_ARGUMENT itself, before any handler runs.
          kind: { type: 'string', enum: ['skill', 'mcp'] },
          name: { type: 'string' },
          // v26 Gate 7.5 round 1 (defect D1): item schema — see ARRAY_ITEMS_RULE below.
          // Issue #105 part A (owner decision): each element is {path, contentB64, exec?} — the
          // SAME shape (and the same materialized-mode meaning) as seedManifest's {path, sha256,
          // exec?}, so `exec:true` never means two different things on the same surface.
          files: {
            type: 'array',
            description:
              "A skill's files — each element is {path, contentB64, exec?}, the file bytes as base64. " +
              'exec:true materializes that file 0o755 — for a script with a shebang or a compiled CLI (an ELF binary, not a text script); absent/false materializes 0o644. ' +
              "Never set exec:true on this skill's own top-level SKILL.md (INVALID_ARGUMENT) — it is the skill's manifest, never executed. " +
              'The dispatched agent always runs inside its Bash sandbox either way — exec only decides whether the OS itself can exec the file directly: without it a shebang script still runs via `sh <path>` or `python3 <path>`, but a compiled binary cannot run at all.',
            items: {
              type: 'object',
              required: ['path', 'contentB64'],
              properties: {
                path: { type: 'string' },
                contentB64: { type: 'string' },
                exec: { type: 'boolean', description: "Materialize this file 0o755 instead of 0o644 (scripts with a shebang, compiled CLIs). Refused INVALID_ARGUMENT on this skill's top-level SKILL.md." },
              },
            },
          },
          config: { type: 'object' },
          // Issue #92 part B: closed enum of the two supported AssetScope values (same reasoning as `kind` above).
          scope: { type: 'string', enum: ['workflow', 'global'] },
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

// Issue #98 item 5: `seedManifestRef` (workflow_register, run_start) only ever named the HTTP path
// (POST /assets/blob/<sha>, then POST /assets/manifest) — there is no separate "manifest mode" on
// `workspace_push`, but the SAME blob-push mode it already has ({sha256, contentB64}) is the MCP
// path: push each file once, then push the manifest JSON's own bytes the SAME way. Shared here so
// workflow_register's and run_start's descriptions cannot drift apart on the same mechanic.
const MCP_MANIFEST_PUSH_HINT =
  'Over MCP (no separate "manifest mode" — this is the SAME workspace_push blob call, used twice): ' +
  "push each file's bytes with workspace_push({sha256, contentB64}) (sha256 is that file's own hex sha256; one call per file), " +
  'then push the manifest ITSELF the same way — workspace_push({sha256, contentB64}) again, where contentB64 is the base64 of the manifest JSON bytes ' +
  '(a JSON array of {path, sha256, exec?}, each sha256 referencing an already-pushed file blob; exec:true materializes that file 0o755, else 0o644) ' +
  "and sha256 is that JSON's own hex sha256 — the accepted sha256 from that second push IS the ref. " +
  '(The HTTP equivalent — POST /assets/blob/<sha> per file, then POST /assets/manifest — does the identical two pushes and returns the same ref as seedManifestRef directly; ' +
  'it also validates every referenced blob is present at manifest-upload time, where this MCP path defers that check to registration/run_start, answering the same MISSING_BLOBS either way.)';

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

/** Owner decision 2026-10-02: `workspace_prune_blobs` on ANOTHER namespace is admin-only. */
function pruneMode(args: any): 'own' | 'other' {
  return args && typeof args === 'object' && 'namespace' in args ? 'other' : 'own';
}

// issue #109: `scope:'global'` is checked BEFORE the `workflow`+`kind` branch (same order
// `pushMode`/`deleteMode` already use for their own `global` row) — `{scope:'global', workflow}`
// still resolves here to `'global'`, and the HANDLER (mcp-facade.ts's `workspaceList`) is what
// refuses that combination clearly, rather than the authz layer silently preferring one meaning.
function listMode(args: any): 'run' | 'workflow' | 'global' | 'invalid' {
  if (args && typeof args === 'object' && 'runId' in args) return 'run';
  if (args && args.scope === 'global') return 'global';
  if (args && typeof args === 'object' && 'workflow' in args && 'kind' in args) return 'workflow';
  return 'invalid';
}

function deleteMode(args: any): 'run' | 'workflow' | 'global' | 'invalid' {
  if (args && typeof args === 'object' && 'runId' in args) return 'run';
  if (args && args.scope === 'global') return 'global';
  if (args && typeof args === 'object' && 'workflow' in args && 'kind' in args && 'name' in args) return 'workflow';
  return 'invalid';
}

// Issue #130: `issue_report({runId})` used to attach that run's diagnostics (server.ts's
// `runDiagnostics`) with NO ownership check at all — any principal who learned another principal's
// runId could publish excerpts of its transcript to the PUBLIC GitHub issue tracker. `key: null`
// (same as workspace_push/list/delete above) lets authz.ts's existing moded-row fallback resolve
// the ownership subject off `args.runId` directly — this is the SAME mechanism run_status's own
// `ownership:'run'` row already uses, not a new one. A bare report (no `runId`) keeps needing no
// ownership at all.
function issueReportMode(args: any): 'run' | 'bare' {
  return args && typeof args === 'object' && 'runId' in args ? 'run' : 'bare';
}

export const TOOL_SPECS = [
  // ---- workflow (7) ----
  {
    name: 'workflow_register', entity: 'workflow', key: null,
    description: 'Register a new workflow version under a name; the caller becomes its owner. Registering the same name again appends a new version (v2, v3…) and overwrites nothing; use a different name only for a different purpose. ' +
      // Issue #91: the engine registers no rwe-* workflows, for EVERY caller including admin — the
      // client plugin is being removed, so this door has to be self-contained here too, not just on
      // workspace_push's asset-name check.
      "`name` may not start with the engine-reserved 'rwe-' prefix — refused RESERVED_PREFIX, for every caller including admin. " +
      // Issue #102 (asset squatting): the supported order, stated here for symmetry with
      // workspace_push's own description of the same rule — registration does not require any
      // declared skill/mcp asset to exist yet, so push AFTER register, never before (a push
      // against an unregistered name is refused WORKFLOW_NOT_FOUND, not silently parked for
      // whoever registers the name next).
      'Registering a name does not require any of its declared skill/mcp assets to already be pushed — the supported order is workflow_register FIRST, then workspace_push({workflow, kind, name, ...}) for each asset. ' +
      // v39 (owner decision 2026-09-30): meta.phases is now REQUIRED and checked against the
      // script's own phase() calls at registration time — self-contained here since the client
      // plugin is removed and this is a cold model's only documentation of the rule.
      "`meta.phases: [{title}, ...]` is REQUIRED and must equal your script's own `phase()` calls, in the same count and order (title too, for any phase() call whose title is a plain string literal) — refused `PHASES_REQUIRED` when it is missing or not shaped as an array of `{title:string}`, `PHASES_MISMATCH` when it disagrees with your phase() calls (the message names both lists and the first difference). A script with zero `phase()` calls must still declare `phases: []` explicitly. A `phase()` call whose title is computed at runtime (e.g. `phase('tier:' + args.tier)`) cannot be checked textually — declare ANY non-empty title for it, at the right position; only the position (not the text) is checked there. Example: `export const meta = { phases: [{ title: 'draft' }, { title: 'revise' }] };` beside `phase('draft'); …; phase('revise');`. This is what `workflow_describe`'s `phases`/`phases[].agents` read back (`phasesSource: 'declared'`) — an EXISTING version registered before this rule existed has no such guarantee; `workflow_describe` instead DERIVES its `phases` from that version's own `phase()` calls (`phasesSource: 'derived'`), never from this rule. " +
      "Every agent() call's model comes from `script`'s own `export const meta = { params: { agents: { <label>: { model: {...} } } } }`: `model` is REQUIRED with a `.default`, and that default MUST be a full `<provider>/<model-id>` ref — providers are exactly anthropic, openrouter, ollama (e.g. \"anthropic/claude-haiku-4-5-20251001\", \"openrouter/openai/gpt-4.1\", \"ollama/qwen2.5:7b\"); there are no aliases, no bare names, no 'default'/'local'-style shortcuts — a bare name is refused UNKNOWN_MODEL. Use models_list to find a valid ref (copy its `ref` field verbatim). A run_start override may replace it with a different full ref per run; see workflow_authoring_guide for the complete authoring rules. " +
      // Issue #78(b): advertised here because a cold client reads only tools/list.
      "The reply may carry result.warnings — non-fatal notes, the version is registered anyway: BASH_SUBSUMES_FILE_TOOLS when an agent() call's allowedTools names Bash beside Read/Grep/Glob/Write/Edit (allowedTools restricts names, and Bash can do what those do); BASH_READONLY_UNENFORCEABLE when an agent() declares bash:'readonly' on an engine with no working Bash sandbox (every dispatch of it will fail closed there); MODEL_CATALOG_UNVERIFIED when a declared model ref could not be checked against a live catalog listing (openrouter/ollama) or is an anthropic id not yet in this deployment's static price table; MCP_NOT_PROVISIONED/SKILL_NOT_PROVISIONED when a label's declared `mcp`/`skills` name has no workspace_push-provisioned asset yet (workflow-scoped or global) — the version registers anyway, but run_start (and every firing, and a nested workflow() call) REFUSES with the same code until it is provisioned.",
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
          'Optional default seed for THIS version: the sha256 of a manifest you already uploaded. ' +
          `${MCP_MANIFEST_PUSH_HINT} ` +
          'Every run of this version that brings no seed of its own — run_start, a scheduled firing, a webhook delivery — starts with those files in its workspace. ' +
          'A run_start seed (seed/seedManifest/seedManifestRef/seedRef) REPLACES it, never merges. Checked now, in your own CAS namespace: MISSING_BLOBS if you never uploaded it, INVALID_SEED_SPEC if the referenced blob is not a JSON array of {path, sha256, exec?}. ' +
          'References only — inline seed/seedManifest/seedRef are refused INVALID_ARGUMENT. Versions are immutable: a different seed is a new registration (a new version).',
      },
    }, ['name', 'script']),
    outputSchema: OUT,
    // v24 (integrator; adjudication #4 C-6 [21] + #2 A-4): reconciled BOTH ways against what the
    // register path actually throws — `script-checks.ts` (PARSE_ERROR only, issue #103a: its old
    // MCP_NOT_PROVISIONED throw is retired — a declared-but-unprovisioned mcp/skill name is a
    // `result.warnings` entry now, see this row's description, never a registration refusal),
    // `parseParamContract` (AGENT_UNDECLARED / AGENT_DECLARED_NOT_IN_SCRIPT /
    // PARAM_CONTRACT_INVALID / DEFAULTS_RETIRED), `workflow-catalog.ts` (SCAN_VIOLATION /
    // MERMAID_REQUIRED / MERMAID_INVALID / DIAGRAM_MISMATCH / VERSION_CEILING_EXCEEDED /
    // NOT_WORKFLOW_OWNER / REGISTRATION_CONFLICT) and the facade's trigger-claim step
    // (TRIGGER_NOT_FOUND / NOT_TRIGGER_OWNER / TRIGGER_ALREADY_CLAIMED / INVALID_ARGUMENT).
    // REMOVED: `WORKFLOW_ALREADY_EXISTS` — re-registering an existing name is how a NEW VERSION is
    // created; the refusal for someone else's name is NOT_WORKFLOW_OWNER, and advertising a code
    // the tool cannot answer teaches a cold model to branch on something that never arrives.
    // `SCRIPT_INVALID` stays: it is the sandbox structural refusal `validateScriptEntry` raises.
    errors: [
      'SCRIPT_INVALID', 'PARSE_ERROR', 'UNKNOWN_MODEL', 'SCAN_VIOLATION',
      'AGENT_UNDECLARED', 'AGENT_DECLARED_NOT_IN_SCRIPT', 'PARAM_CONTRACT_INVALID', 'DEFAULTS_RETIRED',
      // v39 (owner decision 2026-09-30): meta.phases is required on every NEW registration and must
      // match the script's own phase() calls — checked right after the params contract, before the
      // mermaid checks below (see workflow-catalog.ts's own pinned-order comment).
      'PHASES_REQUIRED', 'PHASES_MISMATCH',
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
      // Issue #91: `name` starting with the engine-reserved 'rwe-' prefix — checked before every
      // other registration step (workflow-catalog.ts's validateRegistration), for every caller.
      'RESERVED_PREFIX',
      // Issue #82: the seedManifestRef ladder (RunManager.loadSeedManifestRef), run at register time.
      'MISSING_BLOBS', 'INVALID_SEED_SPEC', 'CAS_UNAVAILABLE',
      // review round 4 (R4-1): only reachable under gateway:"pi" (harnessProviders set) — an
      // anthropic/* model ref (via checkModelRef's harnessProviders gate, inside parseMetaParams)
      // or a declared allowedTools name the pi harness has no mapping for (workflow-catalog.ts's own
      // post-params check) is refused here, at registration, never silently deferred to dispatch.
      'PROVIDER_UNSUPPORTED_BY_HARNESS', 'TOOL_UNSUPPORTED_BY_HARNESS',
    ],
    seeAlso: ['models_list'] as string[],
    // Service accounts spec (owner decision 2026-10-03): a create-shaped tool — no ownership
    // subject of its own (a NEW name has no owner yet; an EXISTING name's ownership is the
    // catalog's own NOT_WORKFLOW_OWNER check, downstream of authorize()) — `workflowArg` is what
    // lets an allowlisted service account be restricted here at all.
    authz: { minRole: 'author', ownership: 'none', workflowArg: 'name' } as AuthzRow,
    fixture: {
      happy: { name: 'demo', script: FIXTURE_SCRIPT, mermaid: FIXTURE_MERMAID },
      errors: {
        // v39: this script calls phase() zero times, so meta.phases must be declared [] — otherwise
        // PHASES_REQUIRED would fire first and this fixture would never reach the check it targets.
        MERMAID_REQUIRED: { name: 'fixture-no-mermaid', script: "export const meta = { phases: [] };\nreturn 1;" },
        // v26: an LR swimlane whose ONE node names a label the script does not declare — the
        // mismatch is still the subject; the direction/lane rules are satisfied so the refusal
        // that comes back is DIAGRAM_MISMATCH and not DIAGRAM_DIRECTION.
        DIAGRAM_MISMATCH: { name: 'fixture-mismatch', script: FIXTURE_SCRIPT, mermaid: 'graph LR\nsubgraph "Greet"\nother(["other"])\nend' },
        SCAN_VIOLATION: { name: 'fixture-scan', script: "phase('Greet');\nconst l = \"greet\";\nreturn await agent(l, {});", mermaid: FIXTURE_MERMAID },
        // Issue #91: an otherwise-valid registration, refused for the NAME alone — proves the check
        // runs before script/mermaid content is ever inspected.
        RESERVED_PREFIX: { name: 'rwe-impostor', script: FIXTURE_SCRIPT, mermaid: FIXTURE_MERMAID },
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
    // Issue #98 item 8: an explicit `version: null` (JSON null, never an omitted key) CLEARS the
    // named channel — the only tool that can (VERSION_PINNED_BY_CHANNEL names this exact call).
    description: "Point a workflow's release pointer at one of its registered versions. Pass `version: null` (an explicit JSON null, not an omitted key) to CLEAR the named channel instead — same authz as publishing (owner/admin only) — after which a bare run_start (or a trigger bound to that channel) answers CHANNEL_UNPUBLISHED, same as a channel that was never published.",
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
      // Issue #98 item 8: `anyOf[null, string]` — same shape as run_start's `budget` (tool-specs.ts
      // above) for the same reason: `null` is a MEANINGFUL explicit value here (clear the channel),
      // never conflated with "omitted" (which schema `required` below still refuses outright).
      version: {
        anyOf: [
          { type: 'null' },
          { type: 'string' },
        ],
        description: "The version string returned by workflow_register, e.g. 'v1' — or an explicit JSON `null` to CLEAR the named channel instead of pointing it.",
      },
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
    // v39 (owner decision 2026-09-30, Part B) supersedes issue #98 item 8b: on a version registered
    // under the v39 rule, `meta.phases` is REQUIRED and already known to equal the script's own
    // `phase()` calls (workflow_register's own PHASES_REQUIRED/PHASES_MISMATCH gate), so `phases`
    // here is read back verbatim (`phasesSource:'declared'`). An EXISTING version registered BEFORE
    // v39 (immutable, never re-checked) may have no `meta.phases` at all — for THAT row `phases` is
    // instead DERIVED from the stored script's own `phase()` calls (`phasesSource:'derived'`), so
    // `phases`/`phases[].agents` are populated either way; only `phasesSource` tells you which.
    description: "Describe a workflow: per-agent parameters, agent labels, live triggers, its author-supplied diagram, and the predicted lane membership (phases[].agents). `phases` is `meta.phases: [{title}, ...]` when the script validly declares one (`phasesSource:'declared'` — required on every version registered since v39, and workflow_register already checked it equals the script's own `phase()` calls) — else DERIVED from the stored script's own `phase()` calls (`phasesSource:'derived'`, a version registered before v39, immutable and never re-checked against the new rule). Either way `phases[].agents` joins the predicted per-lane agent labels onto it. Also returns registeredRemote: whether THIS version was registered by a remote submission — on a host whose Bash-confinement probe failed at boot, such a version is refused CONFINEMENT_UNAVAILABLE even for a local run_start, and this is the field that says which version to re-register locally. Defaults to the release pointer; pass version or channel to describe another one — an unpublished version must be named with version, since the release default answers CHANNEL_UNPUBLISHED. `runnable`/`runnableReason` are computed for the RESOLVED version and the CALLER, exactly matching what run_start would do — a version the owner/admin could run is `runnable:true` even if unpublished. A non-owner (non-admin) naming a version/channel that is not today's release is refused VERSION_NOT_FOUND, same as run_start and same as an unknown version — this never discloses whether the version exists. Even on an ALLOWED (release) response, a non-owner's `versions` is `[<release>]` only and `channels.beta` is `null` — no non-release version id is ever named to a caller who could not run it.",
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
    // Service accounts spec: ownership:'none' (reading metadata needs no ownership) — `workflowArg`
    // is the only thing that lets an allowlisted service account be restricted here at all.
    authz: { minRole: 'user', ownership: 'none', workflowArg: 'name' } as AuthzRow,
    fixture: { happy: { name: ref('workflow') }, errors: { WORKFLOW_NOT_FOUND: { name: ABSENT_WORKFLOW } } },
  },
  {
    name: 'workflow_source', entity: 'workflow', key: 'name' as const,
    description: "Read a workflow version's script. A non-owner author receives a masked projection (scriptWithheld:true) — see workflow_describe for the runnable summary. That masked projection's `channels.beta` is always `null`, regardless of the real beta pointer.",
    // B-1 (v24 adjudication #3): `version` is a STRING, the exact value workflow_register's
    // `result.version` returns — see workflow_publish's row for why.
    inputSchema: schema({ name: { type: 'string' }, version: { type: 'string', description: "The version string returned by workflow_register, e.g. 'v1'." } }, ['name']),
    outputSchema: OUT,
    errors: ['WORKFLOW_NOT_FOUND', 'VERSION_NOT_FOUND', 'FORBIDDEN_ROLE'],
    seeAlso: ['workflow_describe'],
    // Service accounts spec: same reasoning as workflow_describe's row just above.
    authz: { minRole: 'author', ownership: 'none', workflowArg: 'name' } as AuthzRow,
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
    description: "List registered workflows; each row carries whether it currently has a runnable release. `lastRunAt` is the most recent run on record; null = never run. For a workflow the caller does not own (owner/admin see everything), `versions` and `channels.beta` never name a non-release version id — `versions` is `[<release>]` (or `[]` with none released) and `channels.beta` is `null`, matching what that caller could actually run/describe.",
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
    description: "Start a run of a workflow's current release. First-try traps: a just-registered workflow has no release yet — pass {version} to run the version workflow_register just returned, to iterate, and call workflow_publish to move it to release once it is stable — and starting a run returns no result; poll run_status until terminal, then call run_result. " +
      "Running ANOTHER principal's workflow: the owner and admin may run any version/channel; everyone else may only run the CURRENT RELEASE — an explicit version or channel that is not today's release (including 'beta') is refused VERSION_NOT_FOUND, the same code a genuinely unknown version gets, so this never discloses whether a non-release version exists. A run already admitted keeps the version it started with even if the release pointer later moves. " +
      "overrides.agents.<label>.model, when given, MUST be a full `<provider>/<model-id>` ref — providers are exactly anthropic, openrouter, ollama; there are no aliases, no bare names — anything else is refused UNKNOWN_MODEL. Use models_list to find a valid ref (copy its `ref` field verbatim). " +
      "The result may carry non-fatal `warnings` (the run is started regardless): MODEL_TOOL_USE_UNVERIFIED names an agent that holds tools on a model whose last probe (models_list toolUseVerified:false) did not use a tool.",
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
            'model, when given, MUST be a full `<provider>/<model-id>` ref — providers are exactly ' +
            'anthropic, openrouter, ollama (e.g. "anthropic/claude-haiku-4-5-20251001"); there are no ' +
            'aliases, no bare names — anything else is refused UNKNOWN_MODEL. Use models_list to find ' +
            'a valid ref (copy its `ref` field verbatim). ' +
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
          description: 'Seed files already pushed to the CAS via workspace_push({sha256, contentB64}) — each element here is {path, sha256, exec?}, referenced by hash rather than carrying content inline (exec:true materializes that file 0o755, else 0o644). Use for large trees, or content you already have a sha256 for.',
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
          description:
            'Seed the whole workspace from ONE manifest previously pushed as a CAS blob — the sha256 of that manifest. ' +
            MCP_MANIFEST_PUSH_HINT,
        },
      }, ['name']),
      additionalProperties: false,
    },
    outputSchema: OUT,
    // issue #103(a): MCP_NOT_PROVISIONED/SKILL_NOT_PROVISIONED joined this row's errors[] —
    // registration only WARNS about a declared-but-unprovisioned mcp/skill name (workflow_register's
    // own row, above); admission REFUSES it here, before any side effect, naming the label + the
    // missing name(s) — push it (workspace_push) then re-run.
    // review round 4 (R4-1): PROVIDER_UNSUPPORTED_BY_HARNESS joined this row — only reachable under
    // gateway:"pi" (harnessProviders set), when _refuseUnadmittableParams's checkModelRef gate finds
    // a reachable model this harness cannot dispatch (run-manager.ts).
    errors: ['WORKFLOW_NOT_FOUND', 'VERSION_NOT_FOUND', 'CHANNEL_UNPUBLISHED', 'NOT_RUNNABLE', 'INVALID_ARGUMENT', 'INLINE_SCRIPT_CLOSED', 'PARAM_LOCKED', 'PARAM_UNKNOWN', 'PARAM_OUT_OF_RANGE', 'UNKNOWN_AGENT_LABEL', 'UNKNOWN_MODEL', 'PROVIDER_UNSUPPORTED_BY_HARNESS', 'AGENT_UNDECLARED', 'LEGACY_REREGISTER', 'INVALID_SEED_SPEC', 'SEED_SOURCE_CONFLICT', 'SEEDREF_DISABLED', 'EGRESS_DENIED', 'CAS_UNAVAILABLE', 'MISSING_BLOBS', 'RUN_ADMISSION_LIMIT', 'DISK_LOW', 'CONFINEMENT_UNAVAILABLE', 'MCP_NOT_PROVISIONED', 'SKILL_NOT_PROVISIONED', 'SERVICE_ACCOUNT_DISABLED', 'WORKFLOW_NOT_ALLOWED'],
    seeAlso: ['workflow_publish', 'run_status', 'run_result'],
    // Service accounts spec: run_start has no ownership subject of its own (ownership:'none' —
    // "run any version" vs "release only" is a separate rule inside RunManager.start(), not
    // authz.ts) — `workflowArg` is what lets an allowlisted service account be restricted here.
    authz: { minRole: 'user', ownership: 'none', workflowArg: 'name' } as AuthzRow,
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
    description: "Poll a run's status; terminal states carry the final outcome. `agent()` calls that fail or time out still resolve `null` to the script, which still completes — `failedAgentCount` counts those terminal non-success agents (failed/refused) LIVE, before the run itself is terminal; it is omitted (never 0) when the run has no agent records yet — absence is not health, poll again once agents exist, and read it against the `agentCount` this same row already returns. When `failedAgentCount` > 0, `agentFailures` names each one: `{label, agentId, reason: 'timeout'|'error'|'aborted'|'refused', message}` — `message` is a bounded, redacted summary of that agent's own failure detail, never a runId/principal/prompt; the CLI's stderr diagnostics are left out of it — read them with run_agent_log. A terminal failure's `error.code` alone is not engine-attested — a script can forge one by setting `e.name` before rethrowing — only this run's own captured refusal ledger is. The owner's response also lists any cross-principal reads of this run's workspace or logs. `warnings`, present only when non-empty, lists non-fatal per-agent harness warnings `{label, agentId, code, server, status, message}` — today `MCP_SERVER_NOT_CONNECTED`: a declared MCP server was not connected (or exposed no tools) when that agent's session started, so its tools were missing from the model's first turn; run_agent_log's harness.mcpStatus has the detail. A `running` agent's `tokens`/`costUSD` reflect only COMMITTED usage — every already-SETTLED attempt so far (a schema re-ask that failed validation and is retrying, for example) — never the CURRENTLY in-flight attempt's own live, still-streaming figure; for a single-attempt call (no re-ask in progress) that means no `tokens` at all appear until the agent itself goes terminal. The in-flight attempt's own live total is not exposed on this record at all while it is running; poll again once the agent settles, or read run_agent_log for its transcript as it streams. `agents[].tokens`/`costUSD` are populated on a FAILED agent too (not only `done`) when the gateway reported usage before the call ended — e.g. one cut short by run_suspend/run_stop, a timeout, or a terminal provider error that still reported its own total; `agents[].partial:true` marks a figure that is a LOWER BOUND (the deduped sum of streamed usage before the cutoff) rather than the provider's own finalized total — this can appear on a `done` agent too, when a retried call's final successful attempt folds in an earlier failed attempt's own lower-bound spend; either way it is also reflected in this run's own cost/token totals (run_list's usage projection) once the agent settles. On a `partial` figure, `output` specifically can undercount by an order of magnitude or more: each streamed per-turn usage snapshot it is built from is deduped and summed by `message.id`, but a turn's own `output_tokens` only reaches its true count on that turn's OWN final frame, which a cut-short call's in-flight turn never reaches — `input`/`cacheRead`/`cacheWrite` are not affected the same way and track the eventual finalized total closely. A `partial` figure is frozen the moment the agent's own state goes terminal — later provider chatter the harness subprocess emits as it finishes shutting down never revises it upward.",
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
    // dash-auth-spec.md section C (2026-09-30): `meta.warnings` — see the description string.
    description: "Fetch a terminal run's result payload. On a failed run, `result.error` is `{code, message}`. On a run stopped via run_stop, `result.error.code` is `RUN_STOPPED` — it never completed, so there is no script return value. This run's own refusal ledger — never anything lifted from outside this run — is engine-attested; `error.code` alone is not and never has been (a script can set `e.name` before rethrowing to forge any code). The response also carries `meta.usage` (tokens, USD cost, unpriced-call count) and `meta.budgetEnforceable` (which limits can bind, and which reachable models have no known price). If any agent() call inside this run failed or timed out — it still resolved `null` to the script, which still completed normally — `meta.warnings` carries one `{code: 'AGENT_FAILED', message}` entry naming how many; call run_status for the per-agent `agentFailures` detail.",
    inputSchema: schema({ runId: { type: 'string' } }, ['runId']),
    outputSchema: OUT,
    // Service accounts spec: WORKFLOW_NOT_ALLOWED joins its three NESTING_*/DESCENDANT_CAP_EXCEEDED
    // siblings for the same reason they are here — an uncaught nested workflow() refusal becomes
    // THIS run's own terminal `result.error`.
    // issue #160 BUG-1: RUN_STOPPED joins RUN_NOT_TERMINAL — a stopped run is terminal (unlike a
    // genuinely live one) but carries no script result, so it gets its own typed code rather than
    // either RUN_NOT_TERMINAL (wrong: it IS terminal) or a silent RUN_FAILED.
    errors: ['RUN_NOT_FOUND', 'RUN_NOT_TERMINAL', 'RUN_STOPPED', 'NOT_RUN_OWNER', 'NESTING_DEPTH_EXCEEDED', 'NESTING_CYCLE', 'DESCENDANT_CAP_EXCEEDED', 'WORKFLOW_NOT_ALLOWED'],
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
        RUN_STOPPED: { runId: ref('stoppedRunId') },
      },
    },
  },
  {
    name: 'run_suspend', entity: 'run', key: 'runId' as const,
    // issue #94: pairs with run_resume — use this (never run_stop) to pause a run you may want to
    // continue later.
    description: 'Suspend a running run, so it can be continued later with run_resume.',
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
    // issue #94 (owner decision): `stopped` is a TRUE terminal state, not resumable — stated here so
    // a caller does not learn it only after an ILLEGAL_TRANSITION.
    description: 'Resume a suspended or interrupted run. A stopped run cannot be resumed — stop is final; use run_suspend instead of run_stop if you may want to continue the run later. ' +
      // Send-back D1 (owner decision 2026-10-03, reversing the original "forward-only" call): a
      // disabled/expired/deleted service account, or one whose allowlist no longer includes this
      // run's own workflow, is refused HERE too — not only at a fresh run_start. There is no window
      // where a suspended/interrupted run outlives its creator's current standing.
      "A service account's CURRENT liveness and workflows allowlist are re-checked on every resume, not only at the run's original admission: SERVICE_ACCOUNT_DISABLED for a disabled/expired/deleted account, WORKFLOW_NOT_ALLOWED if the allowlist has since narrowed past this run's own workflow. A run already stopped still answers ILLEGAL_TRANSITION first (a run-state fact, never masked by either of those).",
    inputSchema: schema({ runId: { type: 'string' } }, ['runId']),
    outputSchema: OUT,
    // review round 4 (R4-1): PROVIDER_UNSUPPORTED_BY_HARNESS joined this row — run-manager.ts's own
    // review-L2 resume-time re-check (a run admitted under gateway:"sdk" can be resumed after the
    // deployment switched to gateway:"pi", which cannot dispatch an anthropic/* ref it was pinned to).
    errors: ['RUN_NOT_FOUND', 'ILLEGAL_TRANSITION', 'NOT_RUN_OWNER', 'INVALID_ARGUMENT', 'INLINE_SCRIPT_CLOSED', 'LEGACY_REREGISTER', 'PARAM_SECRET_UNAVAILABLE', 'PROVIDER_UNSUPPORTED_BY_HARNESS', 'CONFINEMENT_UNAVAILABLE', 'DISK_LOW', 'SERVICE_ACCOUNT_DISABLED', 'WORKFLOW_NOT_ALLOWED'],
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
    // issue #94 (owner decision): stop is final, unlike run_suspend.
    description: 'Stop a run permanently — a terminal state; the run can never be resumed. To pause a run and continue it later, use run_suspend instead.',
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
      '</user-instructions> delimiters. ' +
      // Issue #106: the session's own system/init snapshot, and the warning derived from it.
      'For an agent with declared MCP servers, harness.mcpStatus is [{server, status, tools}] as the CLI ' +
      'reported them when the session started, i.e. what the model\'s first turn was built with: status is ' +
      'the CLI\'s own word (connected/pending/failed/\u2026, or absent) and tools the mcp__<server>__* names ' +
      'exposed. Every tool of a declared server is exposed whatever allowedTools says (allowedTools only ' +
      'pre-approves). harness.warnings carries {code: \'MCP_SERVER_NOT_CONNECTED\', server, status, message} ' +
      'for a declared server that was not connected then or exposed no tool \u2014 the model could not use it ' +
      'on that turn.',
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
    description: "List runs, filtered to the caller's own rows; unfiltered for the operator role. `failedAgentCount` is terminal-only — a live run's row omits it (absent, never 0), consistent with run_status's own row for the SAME run once it goes terminal; poll run_status for a live count, and read it against each row's own `agentCount`. This list row does NOT carry `agentFailures` (the per-agent detail array) — call run_status or run_result for that. `limit` must be a whole number >= 0 (max 500, larger values clamped); `0` returns no rows (pre-existing, unchanged); a non-integer or negative value is refused INVALID_ARGUMENT.",
    // issue #160 BUG-2: `type:'number'` let a float (e.g. 1.5) straight through ajv, where the
    // store's own `Math.min(limit, 500)` bound it unmodified into a SQL `LIMIT ?`, and
    // better-sqlite3 threw a raw, uncoded 'datatype mismatch' for it. `integer`+`minimum:0` refuses
    // it HERE, typed, before it ever reaches the store (the store also clamps defensively for any
    // non-wire caller — see sqlite-run-store.ts `list()`).
    // issue #160 BUG-2 follow-up (review D1-item1): `minimum` is `0`, not `1` — an explicit
    // `limit:0` meaning "return []" is pre-existing, owner-acknowledged behavior (issue #160's own
    // DOC section), a design choice the owner rules require be left unchanged. Only floats and
    // negative values (the actual ceiling-bypass/raw-error defects) are refused.
    inputSchema: schema({ workflow: { type: 'string' }, status: { type: 'string' }, limit: { type: 'integer', minimum: 0 } }),
    outputSchema: OUT,
    errors: ['INVALID_ARGUMENT'] as ErrorCode[],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: {}, errors: { INVALID_ARGUMENT: { limit: 1.5 } } },
  },

  // ---- workspace (6) ----
  {
    name: 'workspace_diff', entity: 'workspace', key: null,
    description: "Diff a manifest against the caller's own content-addressed blob pool. Returns `{ missing, quota }`: `missing` = the sha256s you still need to upload; " +
      "`quota` = your own content-store quota `{ usedBytes, limitBytes, source }` (limitBytes null = unlimited; source 'role-default' or 'override' set by an administrator). " +
      "Usage is the total size of every blob in YOUR pool (a blob other principals also hold still counts fully for you); an upload that would exceed limitBytes is refused QUOTA_EXCEEDED before anything is stored — free space with workspace_prune_blobs.",
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
    description: 'Push content: a CAS blob into the caller\'s own pool, or a workflow-owned asset (skill/mcp). Any runId argument is refused — see workflow_authoring_guide. ' +
      'A CAS blob/manifest is content-addressed within the caller\'s own pool and counts against the caller\'s content-store quota (see workspace_diff for usedBytes/limitBytes): a push that would exceed it is refused QUOTA_EXCEEDED {usedBytes, limitBytes, requestedBytes, hint} before anything is stored, and any push is refused DISK_LOW {freeBytes, floorBytes} (transient — retry later) while the engine\'s disk is below its free-space floor. ' +
      'Accepted blobs stay until removed with workspace_prune_blobs (which only removes blobs no registered workflow version\'s seed needs and that were not used recently) — workspace_delete never removes a CAS blob or manifest. ' +
      // Issue #102 (asset squatting): registration is not a precondition asset PUSH used to
      // enforce — a skill/mcp pushed under a name nobody had registered yet was silently adopted by
      // whoever registered that name later (prompt injection via SKILL.md). `workflow` on a
      // non-global push must now name an ALREADY-REGISTERED workflow (WORKFLOW_NOT_FOUND
      // otherwise) — the supported order is workflow_register FIRST, then workspace_push its
      // skill/mcp assets, never the reverse.
      "A non-global `workflow` must already be registered (workflow_register FIRST, then workspace_push its assets) — WORKFLOW_NOT_FOUND otherwise; registration itself does not require any declared skill to exist yet. " +
      // Issue #105 (q6, owner decision): a cold client reading only this description has no way to
      // know WHICH role can push which asset kind/scope/transport before trying — the guide's
      // "Provisioning skills and MCP servers" section carries the full role x asset-kind/scope/
      // transport matrix plus the MCP config shapes, the `${secret:NAME}` grammar, and why `stdio`
      // is admin-only; pointed at here rather than duplicated (a second copy is a copy that drifts).
      "A `kind:'mcp'` stdio server's own persisted state is shared host-wide across every run/principal that declares it unless its `env`/`args` opt into a per-run private directory with `${run:dir}` (created fresh for THIS run only, e.g. `MEMORY_FILE_PATH:'${run:dir}/memory.jsonl'`) and/or `${run:id}` (this run's id) — any other `${run:xxx}` name is refused UNKNOWN_RUN_PLACEHOLDER before the probe runs. " +
      'See workflow_authoring_guide\'s "Provisioning skills and MCP servers" section for the full role x asset-kind/scope/transport matrix, the two accepted MCP config shapes, the `${secret:NAME}`/`${run:...}` handle grammars, and why stdio server state needs keeping per-run.',
    inputSchema: pushInputSchema(),
    outputSchema: OUT,
    // v24 Gate 7.5 (D-6, REQ-118): `HOOKS_UNSUPPORTED` REMOVED — no push can produce it. A
    // `kind:'hook'` never reaches `classifyAsset` (the pre-v24 classifier that owns the code, and
    // which TASK-147/148 left with no production caller at all): `pushMode` resolves it to
    // `'invalid'` and the answer is INVALID_ARGUMENT. The seed path refuses a `.claude/hooks/…`
    // file through `pathVerdict`'s own CLAUDE_HOOKS strip, not through this code. Advertising a
    // code the tool cannot answer teaches a cold model to branch on something that never arrives —
    // the same reason `WORKFLOW_ALREADY_EXISTS` came off `workflow_register`.
    errors: ['INVALID_ARGUMENT', 'RESERVED_PREFIX', 'WORKSPACE_ESCAPE', 'BLOB_HASH_MISMATCH', 'FORBIDDEN_ROLE', 'NOT_WORKFLOW_OWNER', 'WORKFLOW_NOT_FOUND', 'MCP_PROBE_FAILED', 'EGRESS_DENIED', 'QUOTA_EXCEEDED', 'DISK_LOW', 'UNKNOWN_RUN_PLACEHOLDER'],
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
    // issue #109: `scope:'global'` is the ONLY way to discover a global skill/MCP server by name —
    // self-contained here since the client plugin is removed and this is a cold model's only
    // documentation of it. Global assets are opt-in by EXACT name in your own script's declared
    // `skills`/`mcp` (see workflow_authoring_guide) — this just lets you find the name in the first
    // place; it never grants or auto-declares anything.
    description: "List files in a run's workspace, an asset's files under a workflow, or " +
      "({scope:'global', kind}, `kind` required) every GLOBAL skill/MCP server any admin has pushed " +
      "— name only, plus (skills) the SKILL.md description or (mcp) the transport type; never " +
      "command/args/env/url/secrets. Callable by any approved principal (role 'user' or above); " +
      "`scope:'global'` does not take a `workflow` (refused INVALID_ARGUMENT — global assets are " +
      'engine-wide). A global asset is opt-in by EXACT name, never auto-granted — use the name this ' +
      'lists in your own agent\'s declared `meta.params.agents.<label>.skills`/`.mcp` to actually ' +
      'reach it (workflow_authoring_guide has the full rule). ' +
      // issue #146: lightweight (owner-approved) fix for pre-registration skill discovery — read
      // the SAME single SKILL.md path the description field already reads, just the whole text
      // instead of one frontmatter line; never any other file in the skill's tree.
      "`{scope:'global', kind:'skill', includeBody:true}` ALSO returns each skill's own SKILL.md " +
      `text (frontmatter + body, capped at ${GLOBAL_SKILL_BODY_MAX_BYTES / 1024} KiB and flagged ` +
      '`bodyTruncated:true` past the cap) — ' +
      'so you can read its instructions and any dependency it names (e.g. "requires MCP X") BEFORE ' +
      'declaring/registering it; default (omitted or false) keeps the response name+description-only ' +
      "as before. `includeBody` is refused INVALID_ARGUMENT outside {scope:'global', kind:'skill'}. " +
      'SECURITY: a global skill\'s SKILL.md text is visible this way to every approved principal — an ' +
      'admin pushing a global skill must never put a secret in its SKILL.md.',
    // Issue #92 part B/C follow-up: closed enum of the actually-supported AssetKind values — same
    // reasoning as workspace_delete/workspace_push (a bare {type:'string'} let a junk `kind` reach
    // the handler and answer an empty list rather than INVALID_ARGUMENT).
    inputSchema: schema({ runId: { type: 'string' }, workflow: { type: 'string' }, kind: { type: 'string', enum: ['skill', 'mcp'] }, scope: { type: 'string', enum: ['workflow', 'global'] }, includeBody: { type: 'boolean' } }),
    outputSchema: OUT,
    errors: ['RUN_NOT_FOUND', 'WORKFLOW_NOT_FOUND', 'NOT_RUN_OWNER', 'NOT_WORKFLOW_OWNER', 'INVALID_ARGUMENT'],
    seeAlso: [] as string[],
    authz: {
      mode: listMode,
      rows: {
        run: { minRole: 'user', ownership: 'run', adminCrossRead: true },
        workflow: { minRole: 'author', ownership: 'workflow' },
        // issue #109: role-only (any approved principal, i.e. not role:'none') — same shape as
        // workspace_push/workspace_delete's own `global` row minus the `admin` floor: a global
        // READ is open to every approved principal, only a global WRITE is admin-only.
        global: { minRole: 'user', ownership: 'none' },
        invalid: { minRole: 'user', ownership: 'none' },
      },
    } as ToolAuthz,
    fixture: {
      happy: { runId: ref('terminalRunId') },
      errors: {
        RUN_NOT_FOUND: { runId: ABSENT_ID },
        WORKFLOW_NOT_FOUND: { workflow: ABSENT_WORKFLOW, kind: 'skill' },
        INVALID_ARGUMENT: { scope: 'global', workflow: ABSENT_WORKFLOW, kind: 'skill' },
      },
    },
  },
  {
    name: 'workspace_delete', entity: 'workspace', key: null,
    description: "Delete files from a run's workspace, an asset under a workflow, or (admin) a global asset. " +
      "Asset mode ({workflow or scope:'global', kind, name}) answers {deleted:false} rather than an error when nothing matched the given name — deleting is idempotent, not an existence check. " +
      "Run mode ({runId, paths}) processes EVERY path in the array independently and is never all-or-nothing: each input path lands in exactly one of the response's deleted/missing/rejected lists, so one bad path (escapes the workspace, absolute, a symlink out, etc.) never causes the other, valid paths in the same call to go undeleted and unreported. " +
      "Does not, and cannot, delete a CAS blob or manifest uploaded via workspace_push or POST /assets/* — those are content-addressed within the caller's own pool; remove unused ones with workspace_prune_blobs.",
    // v26 Gate 7.5 round 1 (defect D1): item schema — see ARRAY_ITEMS_RULE below.
    // Issue #92 part B: `kind`/`scope` are closed enums of the actually-supported AssetKind/
    // AssetScope values — see the matching comment on workspace_push's mode-B branch above.
    inputSchema: schema({ runId: { type: 'string' }, paths: { type: 'array', description: "Workspace-relative file paths to delete, each a string.", items: { type: 'string' } }, workflow: { type: 'string' }, kind: { type: 'string', enum: ['skill', 'mcp'] }, name: { type: 'string' }, scope: { type: 'string', enum: ['workflow', 'global'] } }),
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
    description: "Create a time trigger and return its id; the caller becomes its owner. Name no workflow — hand the id to workflow_register({triggers:[id]}) to bind it to a version. Defaults to kind:'cron' — pass kind:'once' with {at} for a one-shot, or kind:'resident' for a trigger-only schedule that never fires on a clock. A `once` firing that fails or is refused is CONSUMED — it never retries, no matter the cause (even a transient one like DISK_LOW) — so check schedule_list after a `once` firing to confirm it actually ran; create a new schedule to try again.",
    // v24 (integrator, REQ-015): the row advertised ONLY `{workflow, cron}` with both required, so
    // the one-shot and resident kinds REQ-015 clause 2 specifies (and VAL-016 validates) were
    // unreachable through the tool surface — ajv refused them for a missing `cron` before the store
    // ever saw them. The store has supported all three kinds since v2; only the schema was narrow.
    inputSchema: { ...schema({
      kind: { type: 'string', enum: ['cron', 'once', 'resident'], description: "Defaults to 'cron' when omitted." },
      cron: { type: 'string', description: "A 5-field cron expression, e.g. '0 3 * * *'. Required when kind is 'cron'. Fields: minute(0-59) hour(0-23) day-of-month(1-31) month(1-12) day-of-week(0-6, Sun=0; 7 is refused, not aliased to 0) — each '*', a number, a range 'a-b', or a comma list, optionally with a '/step'. Standard Vixie/POSIX day rule: day-of-month and day-of-week are each 'restricted' only when the field does NOT start with '*' (so '*/2' still counts as unrestricted even though it filters values). When BOTH are restricted, a date matches if day-of-month OR day-of-week matches (not AND) — e.g. '0 9 1 * 1' fires on the 1st of the month OR every Monday. Must have a next fire within a 4-year search horizon." },
      at: { type: 'string', description: "An ISO-8601 timestamp. Required when kind is 'once'. An UNCLAIMED trigger never fires, no matter how far past `at` is — it fires on the next tick only once a workflow claims it (workflow_register({triggers:[id]})); a past `at` on an ALREADY-claimed trigger also fires on the next tick." },
      tz: { type: 'string', description: "IANA timezone the cron fields are read in; UTC when omitted. An unrecognised zone name is refused INVALID_TZ (field:'tz'), distinct from a malformed cron expression." },
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
    // issue #160 BUG-3: INVALID_TZ joins INVALID_CRON — an invalid `tz` (e.g. not a real IANA
    // zone) is its own field-specific refusal, never folded into the cron field's message.
    errors: ['INVALID_CRON', 'INVALID_TZ', 'INVALID_AT', 'FORBIDDEN_ROLE'],
    seeAlso: [] as string[],
    authz: { minRole: 'author', ownership: 'none' } as AuthzRow,
    fixture: {
      happy: { cron: '* * * * *' },
      errors: {
        INVALID_CRON: { cron: 'not a cron expression' },
        INVALID_TZ: { cron: '0 9 * * *', tz: 'Mars/Olympus_Mons' },
      },
    },
  },
  {
    name: 'schedule_list', entity: 'schedule', key: null,
    description: "List the caller's own schedules; unfiltered for the operator role. A failed dispatch carries lastError:{code,at,message} and a policy refusal before dispatch carries lastRefusedAt/lastRefusalReason/lastRefusalMessage — both messages are a static, secret-free hint for the code, never raw error text. A refused `once` trigger is still consumed (enabled:false) even though it never dispatched; read lastRefusalReason/lastRefusalMessage to see why. For a `once` row (never a `cron` row) that message also says so plainly, e.g. \"... — this one-shot schedule was consumed by the failed firing and will not fire again; fix the cause and create a new schedule\" — the bare catalog hint alone (which may say \"retry later\") would otherwise read as a promise this engine cannot keep for a row that already disabled itself. A later successful fire clears lastError/lastRefusedAt/lastRefusalReason (and refusalCount, already reset) — nothing stale survives a real dispatch.",
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
    // issue #97: the delivery contract used to live NOWHERE a cold MCP client could see it —
    // not this description, not the authoring guide — so the ONLY moment a caller learns the
    // signature/timestamp/dedup rules is the moment it receives `secret` and has nothing else to go
    // on. Every fact below is a literal or constant from webhook-registry.ts's real `deliver()`
    // (see its own docblock) and server.ts's POST /hooks/:id route — pinned by
    // webhook-create-description-pins-contract.test.ts so this text can never drift from the code
    // it describes.
    description: 'Create a webhook trigger and return its id, url and (once only) secret; the caller becomes its owner. Name no workflow — hand the id to workflow_register({triggers:[id]}) to bind it to a version. ' +
      'Delivery contract: POST the raw JSON body to url exactly as sent (the signature covers those exact bytes, so never re-serialize before signing) — the parsed body reaches the started workflow\'s script as args.event. Headers: ' +
      `${WEBHOOK_HEADERS.signature} = "sha256=" + hex HMAC-SHA256 of the RAW body, keyed with the returned secret (the timestamp is NOT part of what is signed); ` +
      `${WEBHOOK_HEADERS.timestamp} = an ISO-8601 timestamp, refused 401 if it differs from server time by more than ${REPLAY_WINDOW_MS / 1000}s in either direction; ` +
      `${WEBHOOK_HEADERS.deliveryId} (OPTIONAL — omit it and there is no dedup at all, every POST starts a new run) = a caller-chosen dedup id. Replay semantics (issue #88): a delivery this engine actually ACCEPTED (202) or PERMANENTLY refused (403, or 409 from an admission-time refusal below) replays that SAME outcome for any later delivery carrying the SAME id — retrying a refusal needs a NEW id after fixing the cause, never the same one. A 503/500, or a 409 CLAIM-STATE refusal (the claimed workflow cannot be fired right now), is transient and is NOT recorded, so retrying with the SAME id reprocesses for real. ` +
      `Responses: 202 {runId} accepted, a run started. 200 {replayed:true, runId?} this exact deliveryId was already resolved — the body reports the ORIGINAL outcome, not a fresh delivery. 401 bad signature, or a missing/stale timestamp. 403 the webhook is disabled (checked BEFORE the signature, so a disabled hook answers 403 even for an unsigned/badly-signed POST), or Bash confinement unavailable for a remote-sourced run — a PERMANENT admission refusal that replays the same 403 for this deliveryId. 404 unknown webhook id. 409 EITHER the claimed workflow cannot be fired right now (unclaimed / deregistered / channel unpublished / dropped from the released version's triggers) — a CLAIM-STATE refusal, never recorded, retryable once fixed — OR one of ${ADMISSION_PERMANENT_CODES.length} PERMANENT admission-time refusals RunManager.start() itself can throw (a bad/locked/unknown parameter, an unknown model, an unprovisioned mcp/skill asset, a legacy/unrunnable/missing workflow version, a malformed seed spec — see run_start's own errors[] for the exhaustive list), which DOES replay the SAME 409 + {code} for this deliveryId, same as 403 above — retry needs a NEW id after fixing the cause. 503 transient: over the run-admission concurrency cap, the engine's disk below its free-space floor ({code: DISK_LOW}), or a concurrent duplicate of the SAME deliveryId still in flight — retry. 500 an admission fault this engine could not otherwise classify (e.g. a content-store outage) — transient, NOT recorded, retry with the SAME id reprocesses for real.`,
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
    description: "List the caller's own webhooks; unfiltered for the operator role. A permanent delivery refusal carries lastRefusedAt/lastRefusalReason/lastRefusalMessage — the message is the same static, secret-free hint for the code the HTTP delivery response itself returns, never raw error text.",
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
    description: 'File a pre-analyzed issue against the engine. Reports are deduplicated by title+component+workflow. ' +
      // Issue #130: the ownership rule is the SAME as run_status's own — a `runId` must be the
      // caller's own run, or the caller must be admin — refused NOT_RUN_OWNER otherwise, nothing
      // filed; a nonexistent runId answers RUN_NOT_FOUND, the same as run_status, before any
      // GitHub call. Omitting `runId` needs no ownership at all.
      "A `runId` argument is checked for ownership exactly like run_status({runId}) — only the run's owner or an admin may attach it, else the whole report is refused (NOT_RUN_OWNER / RUN_NOT_FOUND) and nothing is filed. An admin attaching another principal's run is recorded in that run's audit trail (action issue_report) before anything is filed.",
    inputSchema: schema({
      title: { type: 'string' },
      reproSteps: { type: 'string', description: 'How to reproduce it — required, non-empty.' },
      analysis: { type: 'string', description: 'What you already established about the cause — required, non-empty.' },
      logs: { type: 'string' },
      severity: { type: 'string' },
      component: { type: 'string' },
      runId: { type: 'string', description: "The run this was observed on, if any — must be the caller's own run (or caller is admin); refused NOT_RUN_OWNER/RUN_NOT_FOUND otherwise, before anything is filed." },
      workflow: { type: 'string', description: 'Binds the report to a registered workflow name; adds a workflow:<name> label.' },
      version: { type: 'string', description: "The engine version, or (with `workflow`) that workflow's version." },
    }, ['title', 'reproSteps', 'analysis']),
    outputSchema: OUT,
    errors: ['RUN_NOT_FOUND', 'NOT_RUN_OWNER'] as ErrorCode[],
    seeAlso: ['run_status'],
    authz: {
      mode: issueReportMode,
      rows: {
        // Issue #134: an admin attaching another principal's run publishes that run's diagnostics
        // (transcript tail) to the PUBLIC tracker — the same cross-principal exposure run_result/
        // run_agent_log/workspace_list already audit. Without this flag `authorize()` never raised
        // `crossPrincipalRead`, so `call-tool.ts`'s own audited wrapper around `issueReporter.report`
        // was unreachable: the cross-read happened, unaudited (same defect class the Gate 6.5+7
        // round-2 comment on `run_result`'s own row above describes).
        run: { minRole: 'user', ownership: 'run', adminCrossRead: true },
        bare: { minRole: 'user', ownership: 'none' },
      },
    } as ToolAuthz,
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
    // Issue #104: everything model SELECTION needs, self-described here (no client plugin exists).
    description:
      'List the model catalog to choose a model. Returns ONE PAGE: `{ models, nextCursor, total }` — `total` counts every row matching the filters; ' +
      `pass \`nextCursor\` back as \`cursor\` (same filters) for the next page; nextCursor null = last page. \`limit\` defaults to ${DEFAULT_LIMIT}, max ${MAX_LIMIT} ` +
      '(larger is clamped); a page of very large rows may also end early to stay well under the response size limit — just follow nextCursor. ' +
      'ONE row per model: `ref` is the exact `<provider>/<model-id>` string (providers: anthropic, openrouter, ollama) to paste VERBATIM into ' +
      'meta.params.agents.<label>.model.default at workflow_register, or into a run_start override — there are no aliases; every model is addressed by this one full ref.\n' +
      `ROW SHAPE. By default each row is COMPACT: ${COMPACT_FIELDS.join(', ')} — with capabilities reduced to {toolUse}, benchmarks to {artificialAnalysis} (or null), ` +
      "and observed to per-bucket {calls, successRate, latencyMsP50, latencyMsP95, avgCostUsdPerCall}. `fields: ['*']` returns every field in full; " +
      '`fields: [..names]` returns just those top-level fields (+ ref).\n' +
      'FIELDS (null ALWAYS means "the source did not say / not measured" — never zero, never false, never guessed):\n' +
      '- provider, model, description, modalities {in, out} (e.g. out ["embedding"] for an embedding model), location local|remote, besteffort (OpenRouter :free tier — queues/429s/cold-starts).\n' +
      "- modelType: chat|embedding|rerank|image-gen|tts|stt|moderation|unknown. Only 'chat' models can drive an agent() call. modelTypeSource: ollama-capabilities (Ollama's own " +
      "/api/show capabilities) | openrouter-modalities (any text output = chat) | static (built-in anthropic table) | id-heuristic (the model id alone — least reliable) | unknown.\n" +
      '- limits {contextWindow, maxOutputTokens} (tokens; OpenRouter context_length and top_provider.max_completion_tokens; Ollama the model\'s trained context length — its runtime num_ctx may be lower). ' +
      'contextWindow is also kept top-level.\n' +
      '- price {in, out} display string per 1M tokens, "free", or "unknown"; ratesPerM = the numeric USD-per-TOKEN rates {in, out, cacheRead, cacheWrite}. ' +
      'pricingDetail = further price components when the source gives them: reasoning, cacheRead, cacheWrite, cacheWrite1h in USD per 1M tokens; request, image, webSearch in USD per unit as OpenRouter publishes them; null when none. ' +
      'Engine ratings: `capability` (a one-line summary), `stability`, and `costLevel` — an integer 0..10 where 0 is free and 10 is the most expensive tier, null when the provider publishes no price.\n' +
      '- capabilities {toolUse, toolChoice, structuredOutput, promptCaching, vision, reasoning {supported, efforts, defaultEffort, mandatory}} — DECLARED by the source, never probed: ' +
      'OpenRouter supported_parameters (tools, tool_choice, structured_outputs/response_format, reasoning), its reasoning block, cache prices (promptCaching), input image modality (vision); ' +
      'Ollama capabilities (tools, vision, thinking); the anthropic static table (toolUse, toolChoice, promptCaching, vision).\n' +
      "- effortAppliedOnTransport: whether THIS engine's dispatch path actually carries an agent's `effort` to THIS model — a live, per-model fact, not a blanket per-provider one: true for anthropic; " +
      "false for ollama (no dial, any gateway); for openrouter it depends on the deployed gateway — false under the sdk gateway (the hop drops it), true under the pi harness for a model whose own row " +
      "declares reasoning support (capabilities.reasoning.supported). Check this field per row, not a provider-level assumption; `run_agent_log.harness.effortApplied` confirms it per call. " +
      "Use this, not effortDeclared, to decide whether setting effort does anything. `toolUseDeclared` / `effortDeclared` (boolean, or 'unknown' when the catalog said nothing) and `declaredSource` " +
      "('upstream'|'static'|'unknown') are the older DECLARED flags, never probed by dispatching a call; effortDeclared only says the upstream catalog lists a reasoning parameter (deprecated in favour of " +
      'capabilities.reasoning + effortAppliedOnTransport).\n' +
      '- local {family, parameterSize, quantization}: Ollama rows only (from Ollama details); null elsewhere.\n' +
      "- lifecycle {releasedAt (OpenRouter's listing date), knowledgeCutoff, expiresAt (scheduled removal)} — ISO strings or null.\n" +
      '- benchmarks: THIRD-PARTY, GLOBAL quality scores (not about this host): {source: "openrouter:artificial_analysis+design_arena", fetchedAt, borrowedFrom? (same full ref as the top-level borrowedFrom below), ' +
      'artificialAnalysis {intelligence, coding, agentic} (Artificial Analysis indices, higher is better, or null), designArena [{arena, category, elo, winRate, rank}]} as OpenRouter publishes them; ' +
      'benchmarks is null when OpenRouter has no scores for the model.\n' +
      '- sameModelAs: refs of the same underlying model on OTHER providers (e.g. anthropic/claude-haiku-4-5-20251001 <-> openrouter/anthropic/claude-haiku-4.5). ' +
      "borrowedFrom: for an anthropic-direct row, the OpenRouter ref it borrowed benchmarks, knowledgeCutoff, releasedAt, capabilities.reasoning and maxOutputTokens from (never its price); null otherwise.\n" +
      "- observed: MEASURED BY THIS ENGINE on this host over the last 30 days, split by call kind: {window: '30d', source: 'runs'|'probe'|'none', prose, tools, probeLatencyMs?}. " +
      "prose = agent calls with allowedTools: []; tools = calls holding tools. Each bucket is {calls, successRate (0..1), latencyMsP50, latencyMsP95 (agent call wall clock), avgInputTokens, avgOutputTokens, " +
      "avgCacheReadTokens, avgCacheWriteTokens, avgCostUsdPerCall, lastAt} or null (no such calls). source 'probe' = no run data, only the last models_probe latency (probeLatencyMs); " +
      "'none' = never measured. avgCostUsdPerCall reflects this engine's real harness overhead, so it predicts a run's cost better than unit price. " +
      'Observed data is what THIS deployment actually saw; benchmarks are what third parties measured elsewhere.\n' +
      "- Probe results (see models_probe): `toolUseVerified` / `proseVerified` are OBSERVED by the engine's own probe of each configured model — true/false from the last probe, null when never probed — " +
      "with `lastProbedAt`, a short `probeDetail`, and probeFailureReason {leg: prose|tools, kind: timeout|unreachable|error|empty-reply|no-tool-use|wrong-answer, hint} (null when never probed or passing). " +
      "`stabilitySource` says where `stability` came from: 'probe' (prose failed -> 'unavailable'; tools failed -> 'degraded'; both passed -> the rule tier) " +
      "or 'rule' (never probed: 'best-effort' for free tiers, 'variable' for local, else 'stable'). `catalogFetchedAt` is per-row catalog provenance (string timestamp, or null). " +
      "PER-HARNESS (issue #138): a probe only counts as evidence for the gateway/transport that actually ran it — after this deployment switches gateway (e.g. sdk -> pi), " +
      "toolUseVerified/proseVerified read null again (stabilitySource back to 'rule') for every model until re-probed under the NEW harness; this is 'never probed under THIS harness', not 'this model is untrustworthy'. " +
      "The periodic prober catches up on its own next tick, or run an admin models_probe() immediately.\n" +
      'FILTERS (all optional, AND-ed; a row whose value is null never passes a min/max filter). ' +
      `SORT: sortBy ${SORT_KEYS.join('|')} (observed keys — latency, successRate, avgCostPerCall — read the callKind bucket, default tools; latency falls back to probe latency); ` +
      'order asc|desc (default: cheapest/fastest/best first — asc for price, costLevel, latency, avgCostPerCall; desc for the rest); nulls sort last whatever the order.\n' +
      "READING THE NUMBERS (issue #132): (1) a null benchmark or observed value means the source did not publish / this engine has not measured it — never a low score; OpenRouter only republishes Artificial Analysis intelligence/coding/agentic (often null for coding/agentic even on frontier models) plus Design Arena, so there is no instruction-following, tool-calling, long-context or language score to filter on — compare candidates only on dimensions both have. " +
      "(2) observed successRate counts agent calls that ended without a provider/harness failure; a call whose output kept failing an agent() `schema` (the script receives null after the bounded schema retries) still counts as a success there — the engine enforces `schema` itself on every model (schema stated in the prompt, reply validated, up to 3 re-asks), so capabilities.structuredOutput (an upstream declaration, null on anthropic-direct rows) neither enables nor guarantees it — keep the schema a small top-level object, prefer stronger models for strict JSON, and handle a null result in the script (e.g. retry with another model). Fields outside the compact row (capabilities, ratesPerM, full observed buckets incl. avgCacheReadTokens) need `fields`. " +
      "(3) the upstream vendor of an openrouter ref is its second path segment (openrouter/<vendor>/<model>); a `:batch` / `:free` suffix is the SAME model under a different pricing/queueing tier (`besteffort` marks :free) — drop duplicates yourself when assembling a cross-vendor panel. " +
      "(4) there is no blended-price or score-per-dollar field: compute it from ratesPerM (e.g. blended = (3*in + out)/4) and the benchmark you care about; once a model has run here, observed avgCostUsdPerCall is the better cost predictor. " +
      "(5) a model that loops on tool calls shows up as high avgCacheReadTokens / avgInputTokens with low avgOutputTokens in observed.tools; cap any agent with timeoutMs and the run budget.\n" +
    "EXAMPLES: a cheap tool-capable agent model: {modelType:'chat', toolUseVerified:true, sortBy:'avgCostPerCall'} (or toolUseDeclared:true with sortBy:'price' when nothing was probed/measured); " +
      "the strongest coder under $5/1M: {maxPricePerM:5, sortBy:'coding'}; a fast prose summarizer: {callKind:'prose', maxLatencyMsP95:5000, sortBy:'latency'}; " +
      "an embedding model: {modelType:'embedding'}; reliable here: {minSuccessRate:0.95, callKind:'tools'}.",
    // F2 (verify-H, issue #104): built as a literal (type/properties/required/additionalProperties
    // together), not `{...schema(...), additionalProperties:false}` — spreading `schema()`'s
    // `Record<string, unknown>`-typed return erases its `properties` key at the TYPE level (nothing
    // runtime-visible; ajv still sees the real object), which broke a test casting this schema to
    // read `.properties` back out. `pushInputSchema()` above uses the same hand-built-literal shape
    // for the same `additionalProperties:false` reason. The trailing `as Record<string, unknown>`
    // widens away the `as const satisfies` array's deep-readonly literal inference (e.g. `enum`
    // tuples) TOOL_SPECS's own outer cast gives this one entry — every OTHER row gets that same
    // widening implicitly, via `schema()`'s declared return type.
    inputSchema: {
      type: 'object',
      required: [] as string[],
      properties: {
        provider: { type: 'string', description: "Exact provider id: 'anthropic', 'openrouter' or 'ollama'." },
        query: { type: 'string', description: 'Case-insensitive substring match over the model id and description.' },
        modalityIn: { type: 'string', description: "Only rows accepting this input modality (e.g. 'image')." },
        modalityOut: { type: 'string', description: "Only rows producing this output modality (e.g. 'text', 'embedding')." },
        maxPricePerM: { type: 'number', description: 'Upper bound on max(in, out) price in USD per million tokens (unpriced rows never pass).' },
        minContext: { type: 'number', description: 'Lower bound on contextWindow in tokens (null never passes).' },
        toolUseDeclared: { type: 'boolean', description: 'Only rows whose catalog declares tool use (true) / declares none (false).' },
        location: { type: 'string', enum: ['local', 'remote'], description: 'local = this host (Ollama); remote = a hosted API.' },
        modelType: { type: 'string', enum: ['chat', 'embedding', 'rerank', 'image-gen', 'tts', 'stt', 'moderation', 'unknown'], description: "Only this model type. Use 'chat' for agent() models." },
        toolUseVerified: { type: 'boolean', description: "Only rows whose last models_probe did (true) / did not (false) make a real tool call; never-probed rows match neither." },
        structuredOutput: { type: 'boolean', description: 'Only rows whose source declares structured output (JSON schema / response_format).' },
        reasoning: { type: 'boolean', description: 'Only rows whose capabilities.reasoning.supported equals this.' },
        minIntelligence: { type: 'number', description: 'Minimum benchmarks.artificialAnalysis.intelligence (third-party index; null never passes).' },
        minCoding: { type: 'number', description: 'Minimum benchmarks.artificialAnalysis.coding.' },
        minAgentic: { type: 'number', description: 'Minimum benchmarks.artificialAnalysis.agentic.' },
        maxLatencyMsP95: { type: 'number', description: 'Maximum observed p95 latency (ms) in the callKind bucket, falling back to the last probe latency; unmeasured rows never pass.' },
        minSuccessRate: { type: 'number', description: 'Minimum observed success rate (0..1) in the callKind bucket; unmeasured rows never pass.' },
        maxAvgCostUsdPerCall: { type: 'number', description: 'Maximum observed average USD cost per agent call in the callKind bucket; unmeasured rows never pass.' },
        callKind: { type: 'string', enum: ['prose', 'tools'], description: "Which observed bucket the observed filters and sorts read: 'tools' (default; calls holding tools) or 'prose' (allowedTools: [])." },
        sortBy: { type: 'string', enum: [...SORT_KEYS], description: 'Sort key; nulls always last. Omit to keep catalog order (anthropic, ollama, openrouter).' },
        order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction; the default is best-first for the key (asc for price/costLevel/latency/avgCostPerCall, desc otherwise).' },
        fields: { type: 'array', items: { type: 'string', enum: ['*', ...ALL_FIELDS] }, description: "Top-level fields to return (ref is always included). Omit for the compact default; ['*'] for every field." },
        limit: { type: 'number', description: `Rows per page (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}; larger values are clamped).` },
        cursor: { type: 'string', description: "The previous page's nextCursor, to fetch the next page (keep the same filters)." },
      },
      // CLOSED (`additionalProperties:false`) — every one of the filters `matchesCatalogFilter`/
      // `queryModels` actually reads is declared above, so a typo'd filter (e.g. `minIntelligenc`)
      // is refused INVALID_ARGUMENT instead of silently widening the selection to the whole catalog
      // — the same convention `run_start`'s schema already follows.
      additionalProperties: false,
    } as Record<string, unknown>,
    outputSchema: OUT,
    errors: [] as ErrorCode[],
    seeAlso: [] as string[],
    authz: { minRole: 'user', ownership: 'none' } as AuthzRow,
    fixture: { happy: {}, errors: {} },
  },
  {
    // Issue #73: the admin-only "probe now". Each probe is one prose call plus one call holding
    // only Read that must report a random value the probe planted in a nonce file — through the
    // engine's own gateway, so it measures what an agent() call would get.
    // issue #93 item 4: was `Bash` + `cat <nonce file>`; switched to `Read` on the nonce file's
    // absolute path — same proof (a real tool_use whose result the model could not have guessed)
    // without a shell.
    name: 'models_probe', entity: 'models', key: null,
    description:
      'Admin only. Probe models NOW, through the same gateway agents use: per distinct model declared ' +
      'by a registered workflow version (or only the one full `model` ref names — copy the exact `ref` ' +
      'string from models_list, e.g. "anthropic/claude-haiku-4-5-20251001"), one prose call and one ' +
      'call allowed only the Read tool that must read a file and report its unguessable content. ' +
      'Returns one row per model: provider, model, proseVerified, toolUseVerified, probedAt, ' +
      'latencyMs {prose, tools}, detail, harness. Results are stored and appear on models_list ' +
      '(toolUseVerified/proseVerified/lastProbedAt/probeDetail/stabilitySource). Takes up to two probe ' +
      "timeouts per model; the engine also re-probes on its own every modelProbe.intervalMs (default weekly). " +
      'CALLED WITH NO `model`: only refs already DECLARED by a currently registered workflow version are ' +
      'probed — a model no workflow declares yet is silently skipped, never probed implicitly; pass ' +
      '`model` to probe one explicitly, declared or not. ' +
      "PER-HARNESS (issue #138): harness records which gateway/transport ('claude-agent-sdk', 'direct-fetch' or " +
      "'pi') actually ran THIS probe — a result recorded under one harness is never shown as verified evidence " +
      "once the deployment is running a different one. After a gateway switch (e.g. sdk -> pi), every model's " +
      'toolUseVerified/proseVerified read null again (stabilitySource falls back to the rule tier) until it is ' +
      're-probed under the NEW harness — either automatically on the periodic prober\'s next tick, or immediately ' +
      'via this tool. ' +
      'PROBE-LOGIC VERSIONING (issue #152): a stored result whose internal logic version differs from the ' +
      "engine's current one (bumped when the probe's own classification/dispatch rules change — e.g. a probe " +
      "bug fix) is likewise treated as never probed and re-probed automatically on the next sweep.",
    inputSchema: {
      ...schema({
        model: {
          // No `pattern` here deliberately: a malformed ref must reach the typed UNKNOWN_MODEL
          // refusal (naming the expected form and the three providers), never a generic ajv
          // INVALID_ARGUMENT — same convention as run_start's `overrides` schema (tool-specs.ts).
          type: 'string',
          description: 'Probe only this full <provider>/<model-id> ref (e.g. "ollama/qwen2.5:7b" — copy from models_list). Providers: anthropic, openrouter, ollama — a bare name or unknown provider is refused UNKNOWN_MODEL. Omit to probe every model a registered workflow version declares.',
        },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 600000, description: "Per-call bound for this probe only (default: the engine's modelProbe.timeoutMs)." },
      }),
      additionalProperties: false,
    },
    outputSchema: OUT,
    // review round 4 (R4-1): PROVIDER_UNSUPPORTED_BY_HARNESS joined this row — call-tool.ts's own
    // checkModelRef gate (owner decision 2, M7) refuses an explicit anthropic/* ref before ever
    // reaching ModelProber, under gateway:"pi".
    errors: ['UNKNOWN_MODEL', 'PROVIDER_UNSUPPORTED_BY_HARNESS', 'INVALID_ARGUMENT', 'FORBIDDEN_ROLE'] as ErrorCode[],
    seeAlso: ['models_list'] as string[],
    authz: { minRole: 'admin', ownership: 'none' } as AuthzRow,
    fixture: {
      // A short bound: the conformance engine's provider never answers, so the happy path is a
      // quickly-recorded FAILED probe — which is still the tool working as specified.
      happy: { model: 'anthropic/claude-haiku-4-5-20251001', timeoutMs: 1000 },
      errors: { UNKNOWN_MODEL: { model: 'not-a-valid-ref' }, INVALID_ARGUMENT: { model: 5 } },
    },
  },
  {
    name: 'system_info', entity: 'system', key: null,
    // v24 (integrator, REQ-117 — found by the Batch-B executor): `topN` is implemented
    // (`call-tool.ts` defaults it to 5, `system-info.ts` CLAMPS it to 50 rather than refusing) and
    // was advertised nowhere, so the only way to discover it was to read the engine's source.
    // Issue #98 item 7: this used to promise "the auth summary" (no such block exists — deliberately
    // NOT added: it would disclose principal info to every caller of a `minRole:'user'` tool) and "a
    // block whose probe is unavailable is served as null with a reason, never omitted" (measured
    // against system-info.ts: `memory`/`disk`/`process.system` are each EITHER their normal shape OR
    // entirely REPLACED by a `{reason, detail?}` object — never JSON null; `cpu.utilizationPct` is
    // the one field that IS null on degrade, with the reason in the SIBLING `cpu.utilizationDegraded`
    // field, present only then; `process.self.cpuPct`/`process.topN[].cpuPct` are null with NO reason
    // at all on the very first sample — not enough delta yet, not a probe failure).
    description:
      'Report engine system info: CPU, memory, disk, and process metrics (engine-self plus the top-N by CPU). No auth/principal information is included. ' +
      'Sizes are in bytes; `cpu.utilizationPct` and every `usedPct` are a percent (0-100); `cpu.loadAvg` is the OS 1/5/15-minute load average, NOT a percent; uptime is in seconds. ' +
      '`memory`, `disk` and `process.system` are each EITHER their normal shape OR entirely replaced by a `{reason, detail?}` object when that probe is unavailable on this host — never JSON null. ' +
      '`cpu.utilizationPct` is null (reason in the sibling `cpu.utilizationDegraded`, present only when degraded) on the first sample and on a CPU probe failure. ' +
      '`process.self.cpuPct` and `process.topN[].cpuPct` are null with no reason field at all on the very first sample — read as "not enough samples yet", not a failure. ' +
      '`policy.mcpEgressAllowlist` (owner decision 2026-09-30) is the engine\'s effective `rwe.config.json` `mcpEgressAllowlist` — the https-only URL-prefix allowlist a `workspace_push({kind:\'mcp\'})` config\'s `http` transport is checked against BEFORE any probe. A prefix matches on origin+path with a trailing slash, https only, no userinfo. Always present, `[]` when unconfigured — an empty list means EVERY `http` MCP push is refused `EGRESS_DENIED`. Check this before pushing an `http` MCP server.',
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
  // ---- principals (2) — dashboard auth spec §A2 (2026-09-30) ----
  {
    name: 'principals_list', entity: 'principal', key: null,
    description:
      'Admin only. List every principal (a Google account email) this engine knows and the role it resolves to NOW. ' +
      'Known = the rwe.config.json `principals` entries, every runtime role override, and everyone who has ever signed in (MCP bearer/refresh token or dashboard session). ' +
      'Returns `{ authEnabled, principals: [{ id, kind, role, source, firstSeenAt, lastSeenAt, updatedBy?, updatedAt?, quota }] }`. ' +
      // L7 fix (send-back review): the pre-fix wording read as "both tools refuse an sa: id",
      // which is wrong — only principal_set_role does (role lives on the account's own row); quota
      // has no service_account_* equivalent and is a normal per-id override for ANY id, service
      // account included, with one extra rule send-back D2 added: an sa: id must already exist.
      "kind is 'human' (a Google account email) or 'service' (an `sa:<name>` service account, service_account_create/_list) — a service account's role/workflows live on its OWN row (service_account_update), never principal_roles. principal_set_role refuses an `sa:` id outright (INVALID_ARGUMENT — points at service_account_update instead). principal_set_quota has NO such restriction: a service account's CAS quota is a normal per-id override exactly like a human's, except an `sa:` id must already exist (SERVICE_ACCOUNT_NOT_FOUND for an unknown or deleted one — unlike a human id, it cannot be pre-provisioned). " +
      'role is admin|author|user|none (admin: everything incl. other principals\' runs and these tools; author: register/publish workflows; user: run published workflows and read their own runs; ' +
      'none: signed in but PENDING APPROVAL — every tool answers ACCOUNT_PENDING_APPROVAL; grant with principal_set_role). ' +
      "source says where the role comes from, in precedence order: 'config-locked' (an admin in rwe.config.json — cannot be changed at runtime), " +
      "'db' (a runtime override set by principal_set_role; updatedBy/updatedAt say who and when), 'config' (the id's own rwe.config.json entry), " +
      "'default' (no entry: the config '*' role, else none = pending approval). firstSeenAt/lastSeenAt are ISO timestamps of sign-ins (null = never signed in since this was recorded). " +
      "quota = the principal's content-store (uploaded blob) quota { usedBytes, limitBytes (null = unlimited), source, updatedBy?, updatedAt? }: source 'override' (set by principal_set_quota) or 'role-default' (rwe.config.json casQuota for its role — defaults user 1 GiB, author 5 GiB, admin unlimited; a pending principal 0). " +
      'With authEnabled false the engine runs without authentication and roles are stored but not enforced.',
    inputSchema: { ...schema({}), additionalProperties: false },
    outputSchema: OUT,
    errors: ['FORBIDDEN_ROLE'] as ErrorCode[],
    seeAlso: ['principal_set_role', 'principal_set_quota'] as string[],
    authz: { minRole: 'admin', ownership: 'none' } as AuthzRow,
    fixture: { happy: {}, errors: {} },
  },
  {
    name: 'principal_set_role', entity: 'principal', key: 'id' as const,
    description:
      'Admin only. Change a principal\'s role at runtime — effective on that principal\'s very next request, no restart. ' +
      '`role` null removes the runtime override so the principal falls back to its rwe.config.json entry, else the config \'*\' role, else none. ' +
      "'none' = no access (pending approval): the account can sign in, but every tool and dashboard route answers ACCOUNT_PENDING_APPROVAL until an admin grants user/author/admin — use it to revoke access. " +
      'The id need not have signed in yet (pre-provisioning is allowed). Returns the principal\'s updated entry (same shape as principals_list). ' +
      'Refused ROLE_LOCKED for an admin listed in rwe.config.json principals (config admins are locked so a runtime change can never lock the operator out), ' +
      'and LAST_ADMIN when the change would demote the last remaining admin. Every change is audited: the override row records updatedBy/updatedAt and the engine logs a principal_role_changed line.',
    inputSchema: {
      ...schema({
        id: { type: 'string', minLength: 1, maxLength: 320, description: "The principal's id — the Google account email exactly as principals_list shows it. '*' is refused (edit rwe.config.json for the default role)." },
        role: { enum: ['admin', 'author', 'user', 'none', null], description: "The new role; 'none' revokes access (the principal can still sign in but every tool answers ACCOUNT_PENDING_APPROVAL); null removes the runtime override." },
      }, ['id', 'role']),
      additionalProperties: false,
    },
    outputSchema: OUT,
    errors: ['ROLE_LOCKED', 'LAST_ADMIN', 'INVALID_ARGUMENT', 'FORBIDDEN_ROLE'] as ErrorCode[],
    seeAlso: ['principals_list'] as string[],
    authz: { minRole: 'admin', ownership: 'none' } as AuthzRow,
    fixture: { happy: { id: 'fixture-principal@example.com', role: 'author' }, errors: { INVALID_ARGUMENT: { id: 'fixture-principal@example.com', role: 'owner' } } },
  },
  // Owner decision 2026-10-02: per-principal content-store quota override — a sibling of
  // principal_set_role (not an extra argument on it) so the role lockout rules and the quota stay
  // two independent, separately audited changes.
  {
    name: 'principal_set_quota', entity: 'principal', key: 'id' as const,
    description:
      "Admin only. Set or clear a principal's content-store quota OVERRIDE — the cap on the total size of blobs it may upload (POST /assets/blob, POST /assets/manifest, workspace_push blob mode, engine-fetched seedRef trees). Effective on its very next upload, no restart. " +
      '`limit` = a byte count (integer), a size string ("500MiB", "5GiB", "2GB" — KiB/MiB/GiB/TiB binary, KB/MB/GB/TB decimal), or "unlimited"; null removes the override so the principal falls back to its role default (rwe.config.json casQuota: user 1 GiB, author 5 GiB, admin unlimited unless configured; a pending principal 0). ' +
      'Lowering a limit below current usage deletes nothing — further uploads are refused QUOTA_EXCEEDED until the principal frees space (workspace_prune_blobs). A human (email) id need not have signed in yet — pre-provisioning is allowed. ' +
      // L7 fix (send-back review): an `sa:<name>` id has NO such pre-provisioning — it must already
      // exist (and not be deleted), refused SERVICE_ACCOUNT_NOT_FOUND otherwise (send-back D2: a
      // quota staged for a name that could never legally be reused anyway would just be dead
      // weight). This is a DIFFERENT rule from principal_set_role's: quota has no service_account_*
      // equivalent, so it stays the one normal per-id override a service account's CAS pool uses.
      "An `sa:<name>` id must already exist (SERVICE_ACCOUNT_NOT_FOUND otherwise, including a deleted name) — unlike a human id, it cannot be pre-provisioned. " +
      'Returns the principal\'s updated entry (same shape as principals_list, incl. quota {usedBytes, limitBytes, source}). Audited like a role change: the override row records updatedBy/updatedAt and the engine logs a principal_quota_changed line.',
    inputSchema: {
      ...schema({
        id: { type: 'string', minLength: 1, maxLength: 320, description: "The principal's id — the Google account email exactly as principals_list shows it. '*' is refused (edit rwe.config.json casQuota for role defaults)." },
        limit: { type: ['integer', 'string', 'null'], description: 'Bytes (integer >= 0), a size string like "5GiB", "unlimited", or null to remove the override.' },
      }, ['id', 'limit']),
      additionalProperties: false,
    },
    outputSchema: OUT,
    errors: ['INVALID_ARGUMENT', 'FORBIDDEN_ROLE', 'SERVICE_ACCOUNT_NOT_FOUND'] as ErrorCode[],
    seeAlso: ['principals_list', 'workspace_prune_blobs'] as string[],
    authz: { minRole: 'admin', ownership: 'none' } as AuthzRow,
    fixture: {
      happy: { id: 'fixture-principal@example.com', limit: '2GiB' },
      errors: {
        INVALID_ARGUMENT: { id: 'fixture-principal@example.com', limit: 'plenty' },
        SERVICE_ACCOUNT_NOT_FOUND: { id: 'sa:no-such-service-account-fixture', limit: '1GiB' },
      },
    },
  },
  // ---- service accounts (6) — owner decision 2026-10-03: non-interactive full-MCP principals.
  // Admin only, ownership:'none' (one admin manages every account centrally — there is no
  // per-account ownership concept the way workflows/runs have one). client_secret is shown ONCE,
  // at create/rotate; everywhere else (list/get) only {id, createdAt, expiresAt, lastUsedAt} per
  // secret. expiresAt is ISO-8601 on the wire (epoch ms internally — see call-tool.ts's render).
  {
    name: 'service_account_create', entity: 'service_account', key: 'name' as const,
    description:
      'Admin only. Create a service account for non-interactive full-MCP access (a CI job, a bot, another service — RFC 6749 client_credentials, POST /token) and return its credentials. ' +
      '`name` must match [a-z0-9][a-z0-9-]{1,40} and be unique — its client_id is `sa:<name>`, which can never collide with a Google account email (an email local-part cannot contain \':\'). ' +
      'role is \'author\' or \'user\' (the SAME role semantics as a human principal) — NEVER \'admin\', refused INVALID_ARGUMENT. ' +
      // L6 fix (send-back review): the pre-fix wording over-claimed "run_* on the account's own
      // runs" and "run_list filters to it" — most run_* tools (run_status/run_result/run_suspend/
      // run_stop/run_agent_log) take a runId, not a workflow name, and are scoped by OWNERSHIP
      // (the account's own runs), never re-checked against the allowlist by name; run_list needs no
      // separate filter for the same reason. The one run_* exception is run_resume (send-back D1):
      // it DOES re-check both liveness and the allowlist on every resume, not only at admission.
      '`workflows` (optional) is an allowlist of workflow names: run_start, the workflow_register/describe/source/publish family, workspace_push/list/delete (asset mode), run_resume (re-checked on every resume, not only at the run\'s original admission), and a nested workflow() call from one of the account\'s own runs are all limited to those names — refused WORKFLOW_NOT_ALLOWED otherwise. workflow_list filters its rows to the allowlist. A trigger (schedule/webhook) firing created by this account is checked the SAME way at the moment it fires: a disabled/expired/deleted account or a since-narrowed allowlist refuses the firing, never silently starting it. run_list needs no separate filter — it is already scoped to the account\'s own runs, which can only ever be runs of a workflow the account was allowed to start in the first place. Omitted/empty = no restriction beyond role. ' +
      '`expiresAt` (optional ISO-8601) — omitted = never expires; the account is refused everywhere (SERVICE_ACCOUNT_DISABLED, or invalid_client at /token) once passed, on every subsequent request even for an already-issued bearer. ' +
      'Returns `{ clientId, clientSecret, account }` — clientSecret (`rwe_sa_...`, >=256 bits) is shown ONLY HERE; store it now, it cannot be retrieved again (rotate to get a new one). `account` is the same shape service_account_list shows (secrets carry id/createdAt/expiresAt/lastUsedAt, never a hash or the raw value). Audited: the engine logs a service_account_created line (no secret).',
    inputSchema: {
      ...schema({
        name: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{1,40}$', description: 'Unique; forms the client_id sa:<name>.' },
        description: { type: 'string', description: 'Free-text note (e.g. what this account is for).' },
        role: { type: 'string', enum: ['author', 'user'], description: 'Never admin — refused INVALID_ARGUMENT.' },
        workflows: { type: 'array', items: { type: 'string' }, description: 'Optional workflow-name allowlist. Omitted/empty = no restriction beyond role.' },
        expiresAt: { type: 'string', description: 'Optional ISO-8601 timestamp. Omitted = never expires.' },
      }, ['name', 'role']),
      additionalProperties: false,
    },
    outputSchema: OUT,
    errors: ['INVALID_ARGUMENT', 'SERVICE_ACCOUNT_EXISTS', 'SERVICE_ACCOUNT_NAME_RETIRED', 'FORBIDDEN_ROLE'] as ErrorCode[],
    seeAlso: ['service_account_list', 'service_account_update', 'service_account_rotate_secret'] as string[],
    authz: { minRole: 'admin', ownership: 'none' } as AuthzRow,
    fixture: {
      happy: { name: 'v24-fixture-sa', role: 'user' },
      errors: {
        SERVICE_ACCOUNT_EXISTS: { name: 'v24-fixture-sa', role: 'user' },
        INVALID_ARGUMENT: { name: 'v24-fixture-sa-admin-attempt', role: 'admin' },
        // Filled by the setup sequence, which creates-then-deletes a throwaway name for this one
        // fixture — see v24-tool-surface.test.ts's own runSetupSequence.
        SERVICE_ACCOUNT_NAME_RETIRED: { name: ref('retiredServiceAccountName'), role: 'user' },
      },
    },
  },
  {
    name: 'service_account_list', entity: 'service_account', key: null,
    description:
      'Admin only. List every service account. Returns an array of `{ clientId, name, description, role, workflows, expiresAt, createdBy, createdAt, disabled, lastUsedAt, secrets: [{id, createdAt, expiresAt, lastUsedAt}] }` — never a secret hash or raw value (only service_account_create/_rotate_secret ever show the raw secret, once). ' +
      'Also visible, read-only, from principals_list (kind:\'service\'); this tool is the one that shows the allowlist/secrets/disabled detail principals_list does not.',
    inputSchema: { ...schema({}), additionalProperties: false },
    outputSchema: OUT,
    errors: ['FORBIDDEN_ROLE'] as ErrorCode[],
    seeAlso: ['service_account_create', 'principals_list'] as string[],
    authz: { minRole: 'admin', ownership: 'none' } as AuthzRow,
    fixture: { happy: {}, errors: {} },
  },
  {
    name: 'service_account_update', entity: 'service_account', key: 'name' as const,
    description:
      'Admin only. Patch a service account\'s role/workflows/description/disabled/expiresAt — only the fields supplied change; omitted fields are left as-is. `disabled:true` refuses the account everywhere on its VERY NEXT request (SERVICE_ACCOUNT_DISABLED / invalid_client at /token), even for an already-issued bearer — no restart, no waiting for the token to expire. ' +
      '`workflows`/`expiresAt` accept `null` to CLEAR (no allowlist / never expires); omitted leaves the current value. role is \'author\'/\'user\' only — never \'admin\' (INVALID_ARGUMENT). Returns the updated account (same shape as service_account_list\'s rows). Audited: service_account_updated.',
    inputSchema: {
      ...schema({
        name: { type: 'string', description: 'The account to update (as created by service_account_create).' },
        role: { type: 'string', enum: ['author', 'user'] },
        workflows: { type: ['array', 'null'], items: { type: 'string' }, description: 'null clears the allowlist (no restriction beyond role); omitted leaves it unchanged.' },
        description: { type: 'string' },
        disabled: { type: 'boolean' },
        expiresAt: { type: ['string', 'null'], description: 'null clears expiry (never expires); omitted leaves it unchanged.' },
      }, ['name']),
      additionalProperties: false,
    },
    outputSchema: OUT,
    errors: ['INVALID_ARGUMENT', 'SERVICE_ACCOUNT_NOT_FOUND', 'FORBIDDEN_ROLE'] as ErrorCode[],
    seeAlso: ['service_account_create', 'service_account_list'] as string[],
    authz: { minRole: 'admin', ownership: 'none' } as AuthzRow,
    fixture: {
      happy: { name: ref('serviceAccountName'), description: 'updated by v24-tool-surface fixture' },
      errors: { SERVICE_ACCOUNT_NOT_FOUND: { name: 'no-such-service-account-fixture', disabled: true } },
    },
  },
  {
    name: 'service_account_rotate_secret', entity: 'service_account', key: 'name' as const,
    description:
      'Admin only. Mint a NEW active secret for a service account (rotation overlap — up to 2 active secrets at once, so a caller can switch to the new one before the old is revoked). Refused TOO_MANY_SECRETS at the cap; revoke one first (service_account_revoke_secret). ' +
      'Returns `{ secretId, clientSecret }` — clientSecret is shown ONLY HERE, once. `expiresAt` (optional ISO-8601) applies to this NEW secret only. Audited: service_account_secret_rotated (no secret).',
    inputSchema: {
      ...schema({
        name: { type: 'string' },
        expiresAt: { type: 'string', description: 'Optional ISO-8601 timestamp for the new secret. Omitted = never expires.' },
      }, ['name']),
      additionalProperties: false,
    },
    outputSchema: OUT,
    errors: ['INVALID_ARGUMENT', 'SERVICE_ACCOUNT_NOT_FOUND', 'TOO_MANY_SECRETS', 'FORBIDDEN_ROLE'] as ErrorCode[],
    seeAlso: ['service_account_create', 'service_account_revoke_secret'] as string[],
    authz: { minRole: 'admin', ownership: 'none' } as AuthzRow,
    fixture: {
      happy: { name: ref('serviceAccountName') },
      errors: {
        SERVICE_ACCOUNT_NOT_FOUND: { name: 'no-such-service-account-fixture' },
        // Consumes the setup account's SECOND active-secret slot (the create-time one is the
        // first) — a third rotate on the SAME account, run after the happy case above, is refused.
        TOO_MANY_SECRETS: { name: ref('serviceAccountName') },
      },
    },
  },
  {
    name: 'service_account_revoke_secret', entity: 'service_account', key: 'name' as const,
    description:
      'Admin only. Revoke ONE secret by id (service_account_create/_rotate_secret\'s returned secretId, or service_account_list\'s secrets[].id) — the account itself and its other secret(s) are unaffected. A bearer already issued from the revoked secret is unaffected until it expires (the secret, not the bearer, is what is revoked) — disable the account instead for an immediate cutoff. Audited: service_account_secret_revoked.',
    inputSchema: {
      ...schema({
        name: { type: 'string' },
        secretId: { type: 'string' },
      }, ['name', 'secretId']),
      additionalProperties: false,
    },
    outputSchema: OUT,
    errors: ['SERVICE_ACCOUNT_NOT_FOUND', 'SERVICE_ACCOUNT_SECRET_NOT_FOUND', 'FORBIDDEN_ROLE'] as ErrorCode[],
    seeAlso: ['service_account_rotate_secret', 'service_account_list'] as string[],
    authz: { minRole: 'admin', ownership: 'none' } as AuthzRow,
    fixture: {
      happy: { name: ref('serviceAccountName'), secretId: ref('serviceAccountSecretId') },
      errors: {
        SERVICE_ACCOUNT_NOT_FOUND: { name: 'no-such-service-account-fixture', secretId: '00000000-0000-0000-0000-000000000000' },
        SERVICE_ACCOUNT_SECRET_NOT_FOUND: { name: ref('serviceAccountName'), secretId: '00000000-0000-0000-0000-000000000000' },
      },
    },
  },
  {
    name: 'service_account_delete', entity: 'service_account', key: 'name' as const,
    description:
      // D2 fix (send-back review, owner decision: tombstone deleted names): the pre-fix text said
      // "a new account with the same name is a DIFFERENT principal with no relationship to the
      // deleted one's history" — false. Ownership everywhere (catalog/runs/webhooks/schedules/CAS
      // namespace) is the bare string `sa:<name>`, so a re-created account would have SILENTLY
      // inherited everything. Fixed by retiring the name outright, never by re-issuing it.
      'Admin only. Delete a service account and revoke every bearer it currently holds (immediate — no waiting for expiry). Workflows it registered and runs it started are NOT deleted or reassigned — they remain, owned by the now-dead `sa:<name>` id (visible to admin, e.g. via run_list/workflow_list; nobody else can act on them, same as any other ownerless-by-departure resource). Irreversible: `name` is RETIRED PERMANENTLY — service_account_create refuses it forever (SERVICE_ACCOUNT_NAME_RETIRED), because `sa:<name>` is also the bare ownership string in the catalog/runs/webhooks/schedules/CAS namespace, and reusing it would silently inherit everything the deleted account ever touched. Pick a different name for a replacement account. Audited: service_account_deleted.',
    inputSchema: { ...schema({ name: { type: 'string' } }, ['name']), additionalProperties: false },
    outputSchema: OUT,
    errors: ['SERVICE_ACCOUNT_NOT_FOUND', 'FORBIDDEN_ROLE'] as ErrorCode[],
    seeAlso: ['service_account_create'] as string[],
    authz: { minRole: 'admin', ownership: 'none' } as AuthzRow,
    fixture: {
      happy: { name: ref('serviceAccountName') },
      errors: { SERVICE_ACCOUNT_NOT_FOUND: { name: 'no-such-service-account-fixture' } },
    },
  },
  // Owner decision 2026-10-02: the content-store cleanup.
  {
    name: 'workspace_prune_blobs', entity: 'workspace', key: null,
    description:
      "Free content-store quota: remove blobs from YOUR OWN pool (the blobs and manifests you uploaded via POST /assets/blob, POST /assets/manifest or workspace_push blob mode) that nothing needs. DEFAULT IS A DRY RUN — pass dryRun:false to actually remove. " +
      'A blob in your pool is removed only when BOTH hold: (1) it is not a live root — not the seedManifestRef of any workflow version registered from your pool (workflow_register({seedManifestRef})), nor any blob that manifest lists; and (2) it has not been USED for olderThanDays days (default 30, min 1) — "used" = uploaded again, named in a manifest registration, checked by workspace_diff, or read by a run admission (run_start with seedManifest/seedManifestRef, or a version default seed). ' +
      'Removing a blob from your pool lowers your usage by its size; the file itself is deleted from the engine\'s disk only when no other principal\'s pool still holds it. Runs already started are unaffected (their workspace is already materialized). ' +
      'Returns `{ namespace, dryRun, olderThanDays, refs: [{sha256, bytes, lastUsedAt}] (first 500), refsCount, truncated, freedBytes, blobFilesDeleted, diskBytesFreed, quota: {usedBytes, limitBytes, source} }` — on a dry run refs/freedBytes are what WOULD be removed and nothing changes. ' +
      '`namespace` (admin only) prunes another principal\'s pool (its id as principals_list shows it, or "local" for uploads made with authentication disabled); any other caller passing it is refused FORBIDDEN_ROLE.',
    inputSchema: {
      ...schema({
        dryRun: { type: 'boolean', description: 'Default true: report only. false = remove.' },
        olderThanDays: { type: 'integer', minimum: 1, maximum: 3650, description: 'Grace window in days (default 30): a blob used more recently than this is kept.' },
        namespace: { type: 'string', minLength: 1, maxLength: 320, description: "Admin only: the principal id whose pool to prune (default: your own)." },
      }),
      additionalProperties: false,
    },
    outputSchema: OUT,
    errors: ['INVALID_ARGUMENT', 'FORBIDDEN_ROLE', 'CAS_UNAVAILABLE'] as ErrorCode[],
    seeAlso: ['workspace_diff', 'workspace_push', 'principal_set_quota'] as string[],
    authz: {
      mode: pruneMode,
      rows: {
        own: { minRole: 'user', ownership: 'none' },
        other: { minRole: 'admin', ownership: 'none' },
      },
    } as ToolAuthz,
    fixture: { happy: {}, errors: { INVALID_ARGUMENT: { olderThanDays: 0 } } },
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
