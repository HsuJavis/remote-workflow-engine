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
// issue #97: the delivery-contract facts webhook_create's description states — header names,
// the signature/HMAC key relationship, and the timestamp skew window — are the SAME exported values
// server.ts's POST /hooks/:id route and webhook-registry.ts's deliver() enforce, so a drift between
// what a cold client is told and what the wire actually checks fails a test instead of shipping.
import { WEBHOOK_HEADERS, REPLAY_WINDOW_MS } from './webhook-registry.js';

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
      // Issue #98 item 8b: workflow_describe's `phases`/`phases[].agents` read `meta.phases` back
      // VERBATIM — they are not derived from your `phase()` calls or your mermaid diagram, so a
      // script that calls `phase()` but never declares `meta.phases` describes as `phases:[]`.
      "Declare `meta.phases: [{title}, ...]` (in the same order as your `phase()` calls) if you want workflow_describe's `phases`/`phases[].agents` populated — that field is read back verbatim, never derived from `phase()` calls or your mermaid diagram. " +
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
    ],
    seeAlso: ['models_list'] as string[],
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
    // Issue #98 item 8b: `phases` is NOT derived from the script's own `phase()` calls (that static
    // scan feeds only the internal predicted-graph/toolSurface derivation) — it is `meta.phases`,
    // an author-declared literal in the script's OWN `export const meta = {...}` block
    // (workflow-meta.ts:parseMeta), read back VERBATIM. A script that calls `phase('P')` but never
    // declares `meta.phases: [{title:'P'}, ...]` (in the same order as its `phase()` calls) answers
    // `phases:[]` here, and `phases[].agents` then has no lane to join onto either — this is the
    // current, measured mechanism (not a bug in this projection), so declare `meta.phases` yourself
    // if you want either field populated.
    description: "Describe a workflow: per-agent parameters, agent labels, live triggers, its author-supplied diagram, and the predicted lane membership (phases[].agents). `phases` is your OWN `meta.phases: [{title}, ...]` declaration (workflow_register's script), read back verbatim — NOT derived from your `phase()` calls or your mermaid diagram; a script with `phase()` calls but no declared `meta.phases` answers `phases:[]` here (and `phases[].agents` has no lane to join onto), even though the run itself still executes its phases. Also returns registeredRemote: whether THIS version was registered by a remote submission — on a host whose Bash-confinement probe failed at boot, such a version is refused CONFINEMENT_UNAVAILABLE even for a local run_start, and this is the field that says which version to re-register locally. Defaults to the release pointer; pass version or channel to describe another one — an unpublished version must be named with version, since the release default answers CHANNEL_UNPUBLISHED. `runnable`/`runnableReason` are computed for the RESOLVED version and the CALLER, exactly matching what run_start would do — a version the owner/admin could run is `runnable:true` even if unpublished. A non-owner (non-admin) naming a version/channel that is not today's release is refused VERSION_NOT_FOUND, same as run_start and same as an unknown version — this never discloses whether the version exists. Even on an ALLOWED (release) response, a non-owner's `versions` is `[<release>]` only and `channels.beta` is `null` — no non-release version id is ever named to a caller who could not run it.",
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
    description: "Read a workflow version's script. A non-owner author receives a masked projection (scriptWithheld:true) — see workflow_describe for the runnable summary. That masked projection's `channels.beta` is always `null`, regardless of the real beta pointer.",
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
    errors: ['WORKFLOW_NOT_FOUND', 'VERSION_NOT_FOUND', 'CHANNEL_UNPUBLISHED', 'NOT_RUNNABLE', 'INVALID_ARGUMENT', 'INLINE_SCRIPT_CLOSED', 'PARAM_LOCKED', 'PARAM_UNKNOWN', 'PARAM_OUT_OF_RANGE', 'UNKNOWN_AGENT_LABEL', 'UNKNOWN_MODEL', 'AGENT_UNDECLARED', 'LEGACY_REREGISTER', 'INVALID_SEED_SPEC', 'SEED_SOURCE_CONFLICT', 'SEEDREF_DISABLED', 'EGRESS_DENIED', 'CAS_UNAVAILABLE', 'MISSING_BLOBS', 'RUN_ADMISSION_LIMIT', 'CONFINEMENT_UNAVAILABLE', 'MCP_NOT_PROVISIONED', 'SKILL_NOT_PROVISIONED'],
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
    description: 'Resume a suspended or interrupted run. A stopped run cannot be resumed — stop is final; use run_suspend instead of run_stop if you may want to continue the run later.',
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
    description: 'Push content: a CAS blob into the caller\'s own pool, or a workflow-owned asset (skill/mcp). Any runId argument is refused — see workflow_authoring_guide. ' +
      'A CAS blob/manifest is content-addressed within the caller\'s own pool and is retained indefinitely once accepted — there is no delete for it (workspace_delete only removes workflow/global assets, never a CAS blob or manifest). ' +
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
      'See workflow_authoring_guide\'s "Provisioning skills and MCP servers" section for the full role x asset-kind/scope/transport matrix, the two accepted MCP config shapes, and the `${secret:NAME}` handle grammar.',
    inputSchema: pushInputSchema(),
    outputSchema: OUT,
    // v24 Gate 7.5 (D-6, REQ-118): `HOOKS_UNSUPPORTED` REMOVED — no push can produce it. A
    // `kind:'hook'` never reaches `classifyAsset` (the pre-v24 classifier that owns the code, and
    // which TASK-147/148 left with no production caller at all): `pushMode` resolves it to
    // `'invalid'` and the answer is INVALID_ARGUMENT. The seed path refuses a `.claude/hooks/…`
    // file through `pathVerdict`'s own CLAUDE_HOOKS strip, not through this code. Advertising a
    // code the tool cannot answer teaches a cold model to branch on something that never arrives —
    // the same reason `WORKFLOW_ALREADY_EXISTS` came off `workflow_register`.
    errors: ['INVALID_ARGUMENT', 'RESERVED_PREFIX', 'WORKSPACE_ESCAPE', 'BLOB_HASH_MISMATCH', 'FORBIDDEN_ROLE', 'NOT_WORKFLOW_OWNER', 'WORKFLOW_NOT_FOUND', 'MCP_PROBE_FAILED', 'EGRESS_DENIED'],
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
    // Issue #92 part B/C follow-up: closed enum of the actually-supported AssetKind values — same
    // reasoning as workspace_delete/workspace_push (a bare {type:'string'} let a junk `kind` reach
    // the handler and answer an empty list rather than INVALID_ARGUMENT).
    inputSchema: schema({ runId: { type: 'string' }, workflow: { type: 'string' }, kind: { type: 'string', enum: ['skill', 'mcp'] } }),
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
    description: "Delete files from a run's workspace, an asset under a workflow, or (admin) a global asset. " +
      "Asset mode ({workflow or scope:'global', kind, name}) answers {deleted:false} rather than an error when nothing matched the given name — deleting is idempotent, not an existence check. " +
      "Run mode ({runId, paths}) processes EVERY path in the array independently and is never all-or-nothing: each input path lands in exactly one of the response's deleted/missing/rejected lists, so one bad path (escapes the workspace, absolute, a symlink out, etc.) never causes the other, valid paths in the same call to go undeleted and unreported. " +
      "Does not, and cannot, delete a CAS blob or manifest uploaded via workspace_push — those are content-addressed within the caller's own pool and are retained indefinitely once accepted.",
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
    description: "Create a time trigger and return its id; the caller becomes its owner. Name no workflow — hand the id to workflow_register({triggers:[id]}) to bind it to a version. Defaults to kind:'cron' — pass kind:'once' with {at} for a one-shot, or kind:'resident' for a trigger-only schedule that never fires on a clock.",
    // v24 (integrator, REQ-015): the row advertised ONLY `{workflow, cron}` with both required, so
    // the one-shot and resident kinds REQ-015 clause 2 specifies (and VAL-016 validates) were
    // unreachable through the tool surface — ajv refused them for a missing `cron` before the store
    // ever saw them. The store has supported all three kinds since v2; only the schema was narrow.
    inputSchema: { ...schema({
      kind: { type: 'string', enum: ['cron', 'once', 'resident'], description: "Defaults to 'cron' when omitted." },
      cron: { type: 'string', description: "A 5-field cron expression, e.g. '0 3 * * *'. Required when kind is 'cron'. Fields: minute(0-59) hour(0-23) day-of-month(1-31) month(1-12) day-of-week(0-6, Sun=0; 7 is refused, not aliased to 0) — each '*', a number, a range 'a-b', or a comma list, optionally with a '/step'. Standard Vixie/POSIX day rule: day-of-month and day-of-week are each 'restricted' only when the field does NOT start with '*' (so '*/2' still counts as unrestricted even though it filters values). When BOTH are restricted, a date matches if day-of-month OR day-of-week matches (not AND) — e.g. '0 9 1 * 1' fires on the 1st of the month OR every Monday. Must have a next fire within a 4-year search horizon." },
      at: { type: 'string', description: "An ISO-8601 timestamp. Required when kind is 'once'. An UNCLAIMED trigger never fires, no matter how far past `at` is — it fires on the next tick only once a workflow claims it (workflow_register({triggers:[id]})); a past `at` on an ALREADY-claimed trigger also fires on the next tick." },
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
      `${WEBHOOK_HEADERS.deliveryId} (OPTIONAL — omit it and there is no dedup at all, every POST starts a new run) = a caller-chosen dedup id. Replay semantics (issue #88): a delivery this engine actually ACCEPTED (202) or PERMANENTLY refused (403) replays that SAME outcome for any later delivery carrying the SAME id — retrying a refusal needs a NEW id after fixing the cause, never the same one. A 503/500 is transient and is NOT recorded, so retrying with the SAME id reprocesses for real; a 409 claim-state refusal is also never recorded (retry once the claim is fixed). ` +
      'Responses: 202 {runId} accepted, a run started. 200 {replayed:true, runId?} this exact deliveryId was already resolved — the body reports the ORIGINAL outcome, not a fresh delivery. 401 bad signature, or a missing/stale timestamp. 403 the webhook is disabled (checked BEFORE the signature, so a disabled hook answers 403 even for an unsigned/badly-signed POST), or a permanent admission refusal (e.g. Bash confinement unavailable for a remote-sourced run) — replays the same 403 for this deliveryId. 404 unknown webhook id. 409 the claimed workflow cannot be fired right now (unclaimed / deregistered / channel unpublished / dropped from the released version\'s triggers) — retryable once fixed. 503 transient: over the run-admission concurrency cap, or a concurrent duplicate of the SAME deliveryId still in flight — retry. 500 an otherwise-uncategorized internal failure.',
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
      'List the model catalog. ONE row per model: `ref` is the exact `<provider>/<model-id>` string ' +
      '(providers: anthropic, openrouter, ollama) to paste VERBATIM into ' +
      'meta.params.agents.<label>.model.default at workflow_register, or into a run_start override ' +
      '— there are no aliases; every model is addressed by this one full ref. Each row also carries ' +
      'provider, model, description, modalities, contextWindow, price, location, plus the engine ratings: `capability` (a one-line ' +
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
      'latencyMs {prose, tools}, detail. Results are stored and appear on models_list ' +
      '(toolUseVerified/proseVerified/lastProbedAt/probeDetail/stabilitySource). Takes up to two probe ' +
      "timeouts per model; the engine also re-probes on its own every modelProbe.intervalMs (default weekly).",
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
    errors: ['UNKNOWN_MODEL', 'INVALID_ARGUMENT', 'FORBIDDEN_ROLE'] as ErrorCode[],
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
