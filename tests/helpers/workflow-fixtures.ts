// v22 fixture helper — the ONE migration target for the inline-script/channel sweep.
//
// Why this file exists: v22 closed inline script (`RunManager.start`/`run_start` refuse a
// `script`, INLINE_SCRIPT_CLOSED) and separated registration from publication (a freshly registered
// version is on NO channel until `workflow_publish`, so a bare register+run gets CHANNEL_UNPUBLISHED).
// Both are the intended design (adjudication #1, K-1/K-2). Dozens of pre-existing fixtures used
// inline script and bare register+run as SETUP SHORTCUTS, not as tests of either behaviour. They all
// migrate through here, so the register→publish→run recipe lives in one place instead of ninety.
//
// This is a test-only helper. `tests/` has no pre-existing shared-helper directory (measured: every
// test imports only `vitest`, `node:*` and `../../src/*`), so `tests/helpers/` is new. It is NOT
// collected by vitest (`include: ['tests/**/*.test.ts']`) but IS type-checked by `tsc --noEmit`
// (tsconfig `include` lists `tests`).
//
// DO NOT use this in a test whose SUBJECT is the ban or the pin — `inline-script-closed.test.ts`
// and `run-version-pin.test.ts`'s "even off the wire" case must keep their raw inline calls, or the
// only evidence the refusal works is gone.
//
// v24 (TASK-152, DES-148/DES-138): registration now REQUIRES a `mermaid` diagram bidirectionally
// consistent with the script's own agent() labels (REQ-111/MERMAID_REQUIRED/DIAGRAM_SCRIPT_MISMATCH).
// `synthesizeMermaid` builds the MINIMAL diagram `checkMermaid` accepts: one stadium node per label,
// no `<br/>` value-triple suffix (`check-mermaid.ts:152` skips the value-triple compare when a node
// carries no `<br/>` segment) and no edges (no edge is ever required by the grammar). It reuses the
// real `scanAgentCalls` — the same function registration itself calls — rather than re-deriving
// labels with a second regex. Also v24: `WorkflowCatalog.register()`'s pre-v24 positional
// `(name, script, defaults, principal)` shape is retired (ADR-035, DEFAULTS_RETIRED); `defaults` is
// no longer forwarded to registration at all.
import { randomUUID } from 'node:crypto';
import type { RunManager } from '../../src/run-manager.js';
import type { McpFacade } from '../../src/mcp-facade.js';
import type { WorkflowCatalog } from '../../src/workflow-catalog.js';
import type { RunSpec } from '../../src/types.js';
import { scanAgentCalls, parseWorkflowSkeleton } from '../../src/workflow-meta.js';
import { deriveExpectedGraph } from '../../src/skeleton-graph.js';
import type { Principal } from '../../src/authz.js';

export type Channel = 'beta' | 'release';

/** A unique registrable workflow name. Mandatory, not cosmetic: `new RunManager()` with no deps
 *  defaults its catalog to a SQLite file under `os.tmpdir()/remote-workflow-runs`, shared by every
 *  test file and surviving across suite runs — a fixed fixture name would collide with the previous
 *  run's rows. */
export function uniqueWorkflowName(prefix = 'fx'): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/** v26 (REQ-128, DES-184, integrator): registration now GATES on the v2 swimlane contract — the
 *  header must be `graph LR`, there is one `subgraph` per `phase()` in call order, every stadium
 *  node sits in its own phase's lane, and the edges must realise the script's consecutive-slot
 *  flow. Every fixture that registers through this file therefore needs a real LR swimlane, derived
 *  from the script it is given.
 *
 *  This is TEST SCAFFOLDING, not the production `mermaid:"auto"` the owner rejected at Gate 2 (Q1
 *  甲): `workflow_register` still requires the author's own diagram and hands back structure, never
 *  corrected Mermaid. Nothing here is reachable from src/.
 *
 *  It reuses the REAL `deriveExpectedGraph` — the same function registration itself now calls — so
 *  the fixture diagram cannot drift from what the checker expects; a second, independent renderer
 *  would just be a second opinion to keep in sync. `tools:` segments are omitted deliberately: rule
 *  12 SKIPS the comparison entirely when the expected value is `'default'`, which is every call
 *  with no literal `allowedTools`. A script whose shape `deriveExpectedGraph` refuses gets `null`
 *  and the caller falls back to the pre-v26 `graph TD` form (still correct for the tests that
 *  deliberately register a v1-shaped fixture and assert the refusal). */
export function synthesizeLrSwimlane(script: string): string | null {
  const derived = deriveExpectedGraph(parseWorkflowSkeleton(script), scanAgentCalls(script));
  if (!derived.ok) return null;
  const { lanes, slots, edges } = derived.graph;
  // One node id per DISTINCT label, at the lane of the label's FIRST slot: `checkMermaid` keys its
  // label→node map by label, so a label used in two slots can only ever have one node.
  const idOf = new Map<string, string>();
  const laneNodes = new Map<number, string[]>();
  for (const slot of slots) {
    for (const label of slot.labels) {
      if (idOf.has(label)) continue;
      const id = `n${idOf.size}`;
      idOf.set(label, id);
      const arr = laneNodes.get(slot.lane) ?? [];
      arr.push(`${id}(["${label}"])`);
      laneNodes.set(slot.lane, arr);
    }
  }
  // A DYNAMIC lane (an agent() inside a loop/switch body) yields NO slots by design — the shape is
  // runtime-dependent — but `checkMermaid` step (6) still compares the diagram's stadium labels
  // against the script's own, both ways. So every scanned label with no slot gets a node too,
  // declared inside the first dynamic lane (the one whose contents the derivation declined to
  // predict), or the last lane when none is dynamic. This is what an author writing the diagram by
  // hand must do as well: name the agent that runs in the loop, in the loop's lane.
  const unslotted = [...new Set(scanAgentCalls(script).labels)].filter((l) => !idOf.has(l));
  if (unslotted.length > 0 && lanes.length > 0) {
    const home = lanes.find((l) => l.dynamic)?.index ?? lanes[lanes.length - 1]!.index;
    const arr = laneNodes.get(home) ?? [];
    for (const label of unslotted) {
      const id = `n${idOf.size}`;
      idOf.set(label, id);
      arr.push(`${id}(["${label}"])`);
    }
    laneNodes.set(home, arr);
  }

  const out: string[] = ['graph LR'];
  for (const lane of lanes) {
    // A `null` title is a runtime-computed `phase()` — rule 11 accepts any non-empty title there.
    out.push(`subgraph "${lane.title ?? `lane${lane.index}`}"`);
    out.push(...(laneNodes.get(lane.index) ?? []));
    out.push('end');
  }
  const firstIdOf = (slotIndex: number): string | undefined => {
    const label = slots.find((s) => s.index === slotIndex)?.labels[0];
    return label !== undefined ? idOf.get(label) : undefined;
  };
  for (const e of edges) {
    const from = firstIdOf(e.from);
    const to = firstIdOf(e.to);
    if (from !== undefined && to !== undefined && from !== to) out.push(`${from} --> ${to}`);
  }
  return out.join('\n');
}

/** The minimal diagram `checkMermaid` accepts for `script`: the v2 LR swimlane when the script's
 *  shape derives, else the pre-v26 `graph TD` form — one stadium node per agent label found by the
 *  real `scanAgentCalls`, no value-triple, no edges. A script with no `agent()` calls at all gets a
 *  header-only diagram (zero nodes is legal — nothing in `checkMermaid` requires any). */
export function synthesizeMermaid(script: string): string {
  const lr = synthesizeLrSwimlane(script);
  if (lr !== null) return lr;
  const { labels } = scanAgentCalls(script);
  // No trailing `;` — `check-mermaid.ts`'s STADIUM_RE is `^(\w+)\(\["(.*)"\]\)$`, anchored right
  // after the closing `"])` with no semicolon allowance (a stadium node's own line ends there).
  const lines = labels.map((label, i) => `n${i}(["${label}"])`);
  return ['graph TD;', ...lines].join('\n');
}

/** v26 (REQ-128, integrator): rule L2 refuses an `agent()` dispatched before the first `phase()`,
 *  so a pre-v26 fixture script — which typically has no `phase()` at all — cannot be registered
 *  from v26 on. The same scaffolding convention `synthesizeMeta` already uses for the v24 parameter
 *  contract: a script that declares its own `phase()` is returned UNCHANGED (a test about phases
 *  keeps exactly the lanes it wrote), and only a phase-less script with `agent()` calls gets one
 *  synthesized. A script with no `agent()` calls needs nothing — L2 has nothing to refuse. */
export function synthesizePhase(script: string): string {
  if (/(?<!\.)\bphase\s*\(/.test(script)) return script;
  if (scanAgentCalls(script).labels.length === 0) return script;
  return `phase('main');\n${script}`;
}

/** `export const meta = {…}` locator used ONLY to detect "does this script already declare its
 *  own meta" — same pattern `src/sandbox/guards.ts`'s `checkMeta` anchors on. */
const META_DECL_RE = /export\s+const\s+meta\s*=\s*/;

/** v24 (DES-144, TASK-152 B-3): every scanned `agent()` label now needs a matching
 *  `params.agents.<label>` declaration (model/effort/timeoutMs all required) or registration
 *  refuses `AGENT_UNDECLARED` — there is no more "no params block ⇒ the engine-global knobs"
 *  fallback. Dozens of pre-v24 fixture scripts declare no `meta` at all. For those (and ONLY
 *  those — a script with its own `export const meta` is returned unchanged, never a second
 *  declaration), this synthesizes the minimal contract from the script's own labels.
 *  2026-09-26 (alias mechanism removed): `model.default` must be a full `<provider>/<model-id>`
 *  ref — `DEFAULT_FIXTURE_MODEL` is a static-table anthropic ref, accepted with no catalog lookup
 *  and no warning by `checkModelRef` regardless of what a bare `WorkflowCatalog`'s (unconfigured)
 *  catalog snapshot holds. */
export function synthesizeMeta(script: string, model = DEFAULT_FIXTURE_MODEL): string {
  if (META_DECL_RE.test(script)) return script;
  const { labels } = scanAgentCalls(script);
  if (labels.length === 0) return script;
  const agents = labels
    .map(
      (label) =>
        `${JSON.stringify(label)}: { model: { type: 'string', default: ${JSON.stringify(model)} }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } }`,
    )
    .join(', ');
  return `export const meta = { params: { agents: { ${agents} } } };\n${script}`;
}

/** 2026-09-26 (alias mechanism removed): every `model.default` must now be a full
 *  `<provider>/<model-id>` ref — no aliases, no bare names, no `'default'` fallback anywhere. This
 *  one is a static-table anthropic id: `checkModelRef` accepts it with NO warning and NO catalog
 *  lookup at all (the anthropic arm never consults the live-catalog snapshot), so it is safe as the
 *  across-the-board fixture default regardless of what catalog (if any) a given test server wires
 *  up. A fixture that dispatches through a REAL gateway (e.g. an ollama/openrouter smoke test) uses
 *  its own full ref via `RegisterPublishOpts.model` instead — this default is never itself
 *  dispatched by most fixtures (a fake spawner/gateway is the norm). */
export const DEFAULT_FIXTURE_MODEL = 'anthropic/claude-haiku-4-5-20251001';
/** @deprecated same-value re-export of `DEFAULT_FIXTURE_MODEL` under its pre-2026-09-26 name, so
 *  the ~140 existing fixture files that import it keep compiling unchanged. Prefer the new name in
 *  anything written from here on. */
export const DEFAULT_FIXTURE_ALIAS = DEFAULT_FIXTURE_MODEL;

export interface RegisterPublishOpts {
  /** Threaded through BOTH register and publish: `publish` only skips the ownership gate when the
   *  principal is null, so a workflow registered as `alice` must be published as `alice` too. */
  principal?: string | null;
  /** Channel to publish onto. Defaults to `release` — what a bare `run_start({name})` resolves. */
  channel?: Channel;
  /** Author-supplied diagram. Defaults to `synthesizeMermaid(script)` — pass this only when a test
   *  is itself about diagram content (DIAGRAM_SCRIPT_MISMATCH / MERMAID_INVALID / the value triple). */
  mermaid?: string;
  /** The alias the synthesized contract declares as every label's `model.default`. Defaults to
   *  `'default'`; pass a key from THIS server's own alias table when it does not define one. */
  model?: string;
  /** Trigger ids this registration CLAIMS. v24 orchestrator adjudication #8 (H-2, issue #56) closed
   *  the create-time binding door (`schedule_create({workflow})`), so `workflow_register` is now the
   *  ONLY way a fixture can bind a trigger to a workflow: create the trigger first, hand its id
   *  here. Only `registerPublishedVia` honours it — the in-process `registerPublished` talks to the
   *  catalog directly and its callers have no trigger ids to bind. */
  triggers?: string[];
}

// ---------------------------------------------------------------------------
// Tier 1 — bare WorkflowCatalog / RunManager (unit + integration fixtures)
// ---------------------------------------------------------------------------

/** Drop-in for `catalog.register(name, script)` in a fixture that then RUNS the workflow: registers
 *  and publishes the version it got back, so the name resolves on `release`. */
export async function registerPublished(
  catalog: WorkflowCatalog,
  name: string,
  script: string,
  opts: RegisterPublishOpts = {},
): Promise<{ version: string }> {
  const principal = opts.principal ?? null;
  const scriptWithMeta = synthesizeMeta(synthesizePhase(script), opts.model);
  const mermaid = opts.mermaid ?? synthesizeMermaid(scriptWithMeta);
  const { version } = await catalog.register({ name, script: scriptWithMeta, mermaid, principal });
  await catalog.publish(name, version, opts.channel ?? 'release', principal);
  return { version };
}

/** Drop-in for `mgr.start({ script, ...extra }, overrides)`: registers the script under a generated
 *  name (or `extra.name`), publishes it, then starts a NAMED run. Returns the runId, exactly as
 *  `start()` did. Every other RunSpec field (`args`, `budget`, `seed*`, `startedBy`, …) passes
 *  through untouched. `origin` defaults to `'local'` (v37, ARCH-182) — every fixture that reaches
 *  this helper is an in-process test submission; a fixture that needs `'remote'` still can. */
export async function startScript(
  mgr: RunManager,
  script: string,
  extra: Omit<RunSpec, 'script' | 'origin'> & { origin?: RunSpec['origin'] } = {},
  overrides?: unknown,
): Promise<string> {
  const name = extra.name ?? uniqueWorkflowName();
  await registerPublished(mgr.catalog, name, script, { principal: extra.principal ?? null });
  return mgr.start({ origin: 'local', ...extra, name }, overrides);
}

// ---------------------------------------------------------------------------
// Tier 2/3 — anything tool-shaped: an McpFacade, or an acceptance/e2e `callTool`
// over real HTTP. Both reduce to a ToolCaller so the recipe is implemented once.
// ---------------------------------------------------------------------------

/** The shape every acceptance/e2e file already hand-rolls around its own `${baseUrl}/mcp` fetch.
 *  `T` is inferred from the caller's own `callTool`, so an HTTP-tier fixture keeps whatever return
 *  type it already declared; the default is `any` because the three tools this dispatches to return
 *  three different envelopes and a `unknown` default would force a cast at every migrated line. */
export type ToolCaller<T = any> = (tool: string, args: Record<string, unknown>) => Promise<T>;

/** `{kind:'auth-disabled'}` — every pre-v24 fixture that reaches this file predates the `principals`
 *  auth model (REQ-109) and ran single-operator; that is the one `Principal` that reproduces the old
 *  always-allowed behaviour exactly (DES-139). A fixture that itself tests role enforcement builds
 *  its own `Principal` and does not go through `facadeCaller`. */
export const AUTH_DISABLED: Principal = { kind: 'auth-disabled' };

/** Adapts an in-process `McpFacade` to the same ToolCaller shape as an HTTP `callTool`. */
export function facadeCaller(facade: McpFacade, principal: Principal = AUTH_DISABLED): ToolCaller {
  return async (tool, args) => {
    switch (tool) {
      case 'workflow_register':
        return facade.workflowRegister(args as { name: string; script: string; mermaid: string; triggers?: string[] }, principal);
      case 'workflow_publish':
        return facade.workflowPublish(args as { name: string; version: string; channel: Channel }, principal);
      case 'run_start':
        return facade.runStart(args as Parameters<McpFacade['runStart']>[0], principal);
      default:
        throw new Error(`facadeCaller: unsupported tool '${tool}'`);
    }
  };
}

/** `workflow_register` reports the version as `result.version` (the `'vN'` string) or, on an
 *  in-process facade caller, a bare top-level `version` number. v24's `workflow_publish`/`run_start`
 *  schema (`tool-specs.ts`) declares `version` as `{type:'string'}` — the catalog itself stores and
 *  compares the `'vN'` string form (adjudication v24 #3 B-1: a number reaches the catalog as
 *  `UNKNOWN_VERSION` and ajv rejects the correct string first, so no argument shape succeeds unless
 *  this returns a string). Both response shapes are derived here so a caller missing either still
 *  resolves. */
function versionOf(response: unknown, name: string): string {
  const r = response as { result?: { version?: unknown }; version?: unknown; error?: { code?: string; message?: string }; code?: string } | null;
  const fromResult = r?.result?.version;
  if (typeof fromResult === 'string') return fromResult;
  if (typeof r?.version === 'number') return `v${r.version}`;
  const code = r?.error?.code ?? r?.code ?? 'UNKNOWN';
  throw new Error(`registerPublishedVia: workflow_register('${name}') did not return a version (${code}: ${r?.error?.message ?? JSON.stringify(response)})`);
}

/** Drop-in for `callTool('workflow_register', { name, script })` in a fixture that then RUNS the
 *  workflow: registers, then publishes the returned version onto `release`. */
export async function registerPublishedVia(
  call: ToolCaller,
  name: string,
  script: string,
  opts: RegisterPublishOpts = {},
): Promise<{ version: string }> {
  // `opts.principal` travels as a TOOL ARG here — that is how the ownership fixtures inject an
  // identity without a bearer token. v24 note (integrator): the v24 dispatch rewrite dropped this
  // path and it has been RESTORED to exactly the scope 04-design.md:3537 gives it — the argument is
  // honoured for attribution/ownership ONLY when the server is genuinely auth-DISABLED
  // (`mcp-facade.ts`'s `attributionWithArg`/`bypassWithArg`). On an auth-ENABLED server it is
  // ignored, so a fixture there must mint a real bearer; self-asserted identity reaching an
  // authenticated deployment is the hole v22's H1 closed. For an in-process facade, bind the
  // identity in `facadeCaller(facade, principal)` instead. Either way the SAME principal must
  // register and publish: `publish` only skips the ownership gate when the principal is null.
  const who = typeof opts.principal === 'string' ? { principal: opts.principal } : {};
  const scriptWithMeta = synthesizeMeta(synthesizePhase(script), opts.model);
  const mermaid = opts.mermaid ?? synthesizeMermaid(scriptWithMeta);
  const triggers = opts.triggers && opts.triggers.length > 0 ? { triggers: opts.triggers } : {};
  const registered = await call('workflow_register', { name, script: scriptWithMeta, mermaid, ...triggers, ...who });
  const version = versionOf(registered, name);
  const published = await call('workflow_publish', { name, version, channel: opts.channel ?? 'release', ...who }) as { status?: string; error?: { code?: string; message?: string }; code?: string };
  if (published?.status === 'failed') {
    throw new Error(`registerPublishedVia: workflow_publish('${name}', ${version}) failed (${published.error?.code ?? published.code}: ${published.error?.message ?? ''})`);
  }
  return { version };
}

/** Drop-in for `callTool('run_start', { script, ...extra })` / `facade.runStart({ script })`:
 *  registers+publishes the script under a generated name, then runs it by name. Returns EXACTLY what
 *  the caller's own `run_start` call returns — same envelope, same type. */
export async function runScriptVia<T>(
  call: ToolCaller<T>,
  script: string,
  extra: Record<string, unknown> = {},
): Promise<T> {
  const name = (extra['name'] as string | undefined) ?? uniqueWorkflowName();
  await registerPublishedVia(call as ToolCaller, name, script);
  return call('run_start', { ...extra, name });
}
