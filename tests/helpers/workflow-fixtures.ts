// v22 fixture helper — the ONE migration target for the inline-script/channel sweep.
//
// Why this file exists: v22 closed inline script (`RunManager.start`/`workflow_run` refuse a
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
import { randomUUID } from 'node:crypto';
import type { RunManager } from '../../src/run-manager.js';
import type { McpFacade } from '../../src/mcp-facade.js';
import type { WorkflowCatalog } from '../../src/workflow-catalog.js';
import type { HarnessDefaults } from '../../src/harness-defaults.js';
import type { RunSpec } from '../../src/types.js';

export type Channel = 'beta' | 'release';

/** A unique registrable workflow name. Mandatory, not cosmetic: `new RunManager()` with no deps
 *  defaults its catalog to a SQLite file under `os.tmpdir()/remote-workflow-runs`, shared by every
 *  test file and surviving across suite runs — a fixed fixture name would collide with the previous
 *  run's rows. */
export function uniqueWorkflowName(prefix = 'fx'): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

export interface RegisterPublishOpts {
  defaults?: HarnessDefaults;
  /** Threaded through BOTH register and publish: `publish` only skips the ownership gate when the
   *  principal is null, so a workflow registered as `alice` must be published as `alice` too. */
  principal?: string | null;
  /** Channel to publish onto. Defaults to `release` — what a bare `workflow_run({name})` resolves. */
  channel?: Channel;
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
  const { version } = await catalog.register(name, script, opts.defaults, principal);
  await catalog.publish(name, version, opts.channel ?? 'release', principal);
  return { version };
}

/** Drop-in for `mgr.start({ script, ...extra }, overrides)`: registers the script under a generated
 *  name (or `extra.name`), publishes it, then starts a NAMED run. Returns the runId, exactly as
 *  `start()` did. Every other RunSpec field (`args`, `budget`, `seed*`, `startedBy`, …) passes
 *  through untouched. */
export async function startScript(
  mgr: RunManager,
  script: string,
  extra: Omit<RunSpec, 'script'> = {},
  overrides?: unknown,
): Promise<string> {
  const name = extra.name ?? uniqueWorkflowName();
  await registerPublished(mgr.catalog, name, script, { principal: extra.principal ?? null });
  return mgr.start({ ...extra, name }, overrides);
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

/** Adapts an in-process `McpFacade` to the same ToolCaller shape as an HTTP `callTool`. */
export function facadeCaller(facade: McpFacade, principal: string | null = null): ToolCaller {
  return async (tool, args) => {
    switch (tool) {
      case 'workflow_register':
        return facade.workflow_register(args as { name: string; script: string; defaults?: Record<string, unknown> }, principal);
      case 'workflow_publish':
        return facade.workflow_publish(args as { name: string; version: string; channel: Channel }, principal);
      case 'workflow_run':
        return facade.workflow_run(args as Parameters<McpFacade['workflow_run']>[0], principal);
      default:
        throw new Error(`facadeCaller: unsupported tool '${tool}'`);
    }
  };
}

/** `workflow_register` reports the version twice: `result.version` as the `'vN'` string and a
 *  top-level `version` as a bare number. `workflow_publish` needs the string. */
function versionStringOf(response: unknown, name: string): string {
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
  // `opts.principal` travels as a TOOL ARG here (server.ts's `args.principal` fallback, honoured by
  // register/deregister/publish) — that is how the ownership fixtures inject an identity without a
  // bearer token. For an in-process facade, bind the identity in `facadeCaller(facade, principal)`
  // instead. Either way the SAME principal must register and publish: `publish` only skips the
  // ownership gate when the principal is null.
  const who = typeof opts.principal === 'string' ? { principal: opts.principal } : {};
  const registered = await call('workflow_register', { name, script, ...(opts.defaults ? { defaults: opts.defaults } : {}), ...who });
  const version = versionStringOf(registered, name);
  const published = await call('workflow_publish', { name, version, channel: opts.channel ?? 'release', ...who }) as { status?: string; error?: { code?: string; message?: string }; code?: string };
  if (published?.status === 'failed') {
    throw new Error(`registerPublishedVia: workflow_publish('${name}', ${version}) failed (${published.error?.code ?? published.code}: ${published.error?.message ?? ''})`);
  }
  return { version };
}

/** Drop-in for `callTool('workflow_run', { script, ...extra })` / `facade.workflow_run({ script })`:
 *  registers+publishes the script under a generated name, then runs it by name. Returns EXACTLY what
 *  the caller's own `workflow_run` call returns — same envelope, same type. */
export async function runScriptVia<T>(
  call: ToolCaller<T>,
  script: string,
  extra: Record<string, unknown> = {},
): Promise<T> {
  const name = (extra['name'] as string | undefined) ?? uniqueWorkflowName();
  await registerPublishedVia(call as ToolCaller, name, script);
  return call('workflow_run', { ...extra, name });
}
