// MCP Streamable HTTP server bootstrap (DES-001 / ARCH-001 / TASK-001).
// Owns transport + tool registration only — no business logic (pure delegation to McpFacade).
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { gunzip, inflate } from 'node:zlib';
import { promisify } from 'node:util';

const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpFacade } from './mcp-facade.js';
import { RunManager } from './run-manager.js';
import { createSemaphore } from './agent-semaphore.js';
import { reclaimStaleWorkspaces } from './workspace-gc.js';
import { SubmissionValidator } from './submission-validator.js';
import { SqliteRunStore } from './store/sqlite-run-store.js';
import { WorkflowCatalog } from './workflow-catalog.js';
import { SystemClock } from './clock.js';
import { LiteLLMGatewayClient, type AliasMap } from './gateway/client.js';
import { DEFAULT_ALIASES } from './default-aliases.js';
import type { GatewayClient } from './gateway/client.js';
import type { LiteLLMProxyManager } from './gateway/litellm-proxy.js';
import { loadAgentDefinitions } from './agent-definitions.js';
import { SqliteSchedulerPort, type Schedule, type NewSchedule } from './scheduler.js';
import { ContinuationStore } from './continuation-store.js';
import { WebhookRegistry } from './webhook-registry.js';
import { CasStore, isValidSha256Hex, isValidNamespace } from './cas-store.js';
import type { SecretValueProvider } from './secret-resolver.js';
import { isAllowedHost, isAllowedOrigin, isLoopback, isLoopbackPeer } from './net-guard.js';
import { parseMeta, parseWorkflowSkeleton } from './workflow-meta.js';
import { tick, RealTicker, type Ticker } from './scheduler-engine.js';
import { AssetSyncService, classifyAsset, type AssetPush, type AssetKind } from './asset-sync.js';
import { classifyTransport, RealMcpProbe, type McpProbe, type McpServerConfig } from './mcp-probe.js';
import { McpRegistry, type McpKind } from './mcp-registry.js';
import { IssueReporter, resolveEngineVersion, type IssueReportInput, type IssueListFilter } from './github/issue-reporter.js';
import { loadSecretSourceFromEnv } from './secret-source.js';
import { buildCatalog, filterCatalog, enrichModelEntry, type ModelEntry, type CatalogFilter } from './models/model-catalog.js';
import { SystemInfoSampler, RealSystemProbe, UTIL_PCT_CONVENTION } from './system-info.js';
import { assertUpdatePathsOutsideWorkRoot, writeUpdateFlag, SelfUpdateDb, readUpdateResult } from './self-update.js';
import type { UpdateOutcome } from './update-types.js';
import { verifyTagWebhook } from './self-update-webhook.js';
import Database from 'better-sqlite3';
import { TokenStore } from './auth/token-store.js';
import { createAuthRouteHandlers, resolvePrincipal, type AuthConfig } from './auth/auth-service.js';
import { wwwAuthenticateHeader } from './auth/oauth-metadata.js';
import { DEFAULT_CEILINGS, type Ceilings, type Effort } from './params/contract.js';

// REQ-066 (v11): engine version from package.json + best-effort git describe, replacing the hardcoded '1.0.0'.
const ENGINE_VERSION = resolveEngineVersion();
import { buildDashboardModel, layoutGraph, buildHomeView, computeWorkflowMetrics } from './dashboard.js';
import { DASHBOARD_HTML, buildDashboardHtml } from './dashboard-page.js';
import type { RunStore } from './run-store.js';

export interface ServerConfig {
  bind?: string;   // default '127.0.0.1'
  port?: number;
  // REQ-056 extension: extra Host/Origin authorities to allow (beyond loopback + bind). Lets a LAN-IP
  // or reverse-proxy hostname reach the server while bound to 0.0.0.0. Each is an explicit opt-in;
  // the DNS-rebinding/CSRF floor still rejects any host outside this union. No auth before v3 — only
  // add hosts on a trusted network.
  allowedHosts?: string[];
  workRoot?: string;
  // REQ-004: overrides the default (anthropic-only) alias table for both the gateway
  // (routing) and SubmissionValidator (UNKNOWN_ALIAS check at submission time) — composition-root
  // wiring gap found + closed at Gate 7.5 (retro L-002): this was declared but previously unused.
  aliases?: AliasMap;
  timeoutMs?: number;
  retries?: number;
  // D-R1: production default routes agent() calls through a managed LiteLLM proxy subprocess
  // rather than direct per-provider fetch. Explicit opt-out for callers that want the legacy
  // direct-fetch path (e.g. no `litellm` binary available in this environment).
  useLiteLLMProxy?: boolean;
  // Injectable proxy manager (tests only) — defaults to a real LiteLLMProxyManager.
  proxyManager?: LiteLLMProxyManager;
  // TASK-027: overrides the managed LiteLLM proxy's hard-coded default port (4000) — closes the
  // repeatedly-Gate-7.5-reproduced port-clash hazard when something else already owns 4000.
  litellmPort?: number;
  // D-F2: a directory of `agents/*.md` frontmatter files (compat-spec §5) loaded ONCE at startup
  // into the agentType registry AgentExecutor resolves opts.agentType against. Omitted -> empty
  // registry (every agentType is "unknown", same as before this field existed).
  agentDefinitionsDir?: string;
  // D-F1: additive composition-root override — lets a caller (e.g. the product entrypoint,
  // src/main.ts) supply a fully custom GatewayClient (e.g. a real
  // ClaudeAgentSdkGatewayClient session) instead of the aliases-driven LiteLLMGatewayClient built
  // below. No existing caller sets this, so it changes nothing unless explicitly used.
  gateway?: GatewayClient;
  // v5 (REQ-027..030): injectable IssueReporter for the `issue_report` tool — tests supply a fake
  // (no real GitHub call); omitted -> a real reporter reading RWE_SECRET_GITHUB_TOKEN from the env.
  issueReporter?: IssueReporter;
  // TASK-026 (DES-020): the one network dependency in asset_push's mcp-config validation, isolated
  // behind this port. Defaults to a real probe; tests inject a FakeMcpProbe to avoid a flaky
  // network dependency (DES-023 mock policy — real handshake/spawn only exercised at real-tier).
  mcpProbe?: McpProbe;
  // DES-022 (standing rule 1, UT-033): overrides the schedule store's default on-disk path
  // (`join(workRoot, 'schedules.db')`) — same override convention as workRoot itself.
  schedulerDbPath?: string;
  // DES-022 (standing rule 1, UT-033): overrides the asset store's default on-disk root
  // (`join(workRoot, 'assets')`).
  assetRoot?: string;
  // D-V3M-2 (REQ-020 / D-DOS, TASK-035): total process-global agent slots — the DOS cap on
  // concurrent SDK-CLI subprocess spawns across ALL runs, observable via `GET /api/status`.
  // Defaults to 32 (a generous backstop that never throttles a single workflow, whose own per-run
  // concurrency is already capped at min(16, cores-2)).
  agentSlots?: number;
  // REQ-026 (v2): run-workspace retention TTL in ms. When set (>0), a periodic GC reclaims TERMINAL
  // run workspaces older than this (never active/suspended). Omitted -> no auto-GC (workspaces are
  // kept until an explicit workspace_purge), so no surprise deletion by default.
  workspaceTtlMs?: number;
  // v7 (REQ-039/040): injectable live-catalog transports for the `models_list` tool — integration
  // tests supply fake Ollama/OpenRouter fetchers (no real network). Omitted -> real fetch against
  // the live endpoints. A fully injectable builder (`modelCatalog`) overrides these when set.
  modelCatalogFetchers?: { ollamaFetch?: typeof fetch; openrouterFetch?: typeof fetch; ollamaBaseUrl?: string };
  modelCatalog?: () => Promise<ModelEntry[]>;
  // v8 Slice 1 (REQ-041/043): max `workflow()` nesting depth (default 4) and max total nested
  // workflow() invocations per run (default 256). Read from rwe.config.json via main.ts FileConfig;
  // an invalid value is rejected at RunManager construction (i.e. at config load).
  maxWorkflowDepth?: number;
  maxWorkflowDescendants?: number;
  // v8 Slice 4 (REQ-054): max live top-level runs (default 64; invalid rejected at RunManager
  // construction). (REQ-053): override the continuation store's on-disk path (default
  // join(workRoot,'continuations.db')), same convention as schedulerDbPath.
  maxConcurrentRuns?: number;
  // v13 (REQ-080): https-only prefix allowlist for engine-pull seedRef. Absent/empty → seedRef is
  // fail-closed OFF (SEEDREF_DISABLED). Threaded FileConfig → ServerConfig → RunManager, same
  // convention as maxConcurrentRuns; RunManager normalizes + validates at construction.
  seedRefAllowlist?: string[];
  continuationDbPath?: string;
  // v10 Slice 2 (REQ-064): override the content-addressed store dir (default join(workRoot,'cas')).
  casDir?: string;
  // v14 (REQ-081, DES-086): max raw body size for POST /assets/blob/:sha (default 256 MiB, min 1 MiB).
  // Distinct from the 8 MiB MCP JSON-RPC body cap — the streaming route is the only path for large blobs.
  maxBlobBytes?: number;
  // v8 Defer B (REQ-057/058): override the webhook registry's on-disk path (default
  // join(workRoot,'webhooks.db')), same convention as schedulerDbPath/continuationDbPath.
  webhookDbPath?: string;
  // v11 Sprint 2 (REQ-068/069, TASK-062/DES-059): self-update wiring.
  // updateFlagPath: path the engine writes the update-trigger flag to (MUST be outside workRoot).
  // updateResultPath: path the bash helper writes the outcome JSON to (read by the engine at boot/lazily).
  // selfUpdateDbPath: SQLite DB for delivery dedup + pending outcome row (default join(workRoot,'self-update.db')).
  updateFlagPath?: string;
  updateResultPath?: string;
  selfUpdateDbPath?: string;
  // v12 (REQ-076/077, DES-073): injectable SystemInfoSampler (default: RealSystemProbe-backed).
  // Tests inject a StubProbe-based sampler (no real OS probe). ONE instance feeds both the
  // system_info MCP tool and GET /api/system (DES-073 "sample once").
  systemInfo?: SystemInfoSampler;
  // v15 (REQ-012/086, DES-095, TASK-086): per-caller auth AS. When absent/disabled, pre-v15
  // open behavior is preserved byte-for-byte (no auth gates added). Google is a legitimately-doubled
  // external dep via injected googleAuthorizeUrl/googleTokenUrl/googleJwksUrl+jwksFetch (same contract as the integration tests). DES-095 v18.
  auth?: AuthConfig;
  // v21 (ARCH-066 inv-6, DES-104, TASK-100): engine ceilings bounding the caller-override rung at
  // admission AND, since adjudication #7's G-1 fix, the values stored into a workflow's `defaults`
  // column at registration (ADR-005 — script per-call agent() opts stay unbounded) — refuse, never
  // clamp. Each key falls back independently to contract.ts's shared DEFAULT_CEILINGS when absent,
  // so the defaults are stated in exactly one place — see DEPLOY §1b for the values.
  maxTimeoutMs?: number;
  maxAppendPromptBytes?: number;
  maxEffort?: Effort;
  // v22 (ARCH-071, ADR-014, TASK-107): per-name version ceiling — same composeConfig wiring
  // convention as the three ceilings above. Goes into the SAME WorkflowCatalogOpts.ceilings object
  // (no new plumbing); absent -> WorkflowCatalog treats it as uncapped (front door, not a GC).
  maxWorkflowVersions?: number;
}

export interface Server {
  port: number;
  workRoot: string;
  close(): Promise<void>;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: unknown;
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

const TOOL_NAMES = [
  'workflow_run',
  'workflow_status',
  'workflow_result',
  'workflow_suspend',
  'workflow_resume',
  'workflow_stop',
  'workflow_list',
  'workflow_agent_log',
  'workflow_register',
  'workflow_deregister',
  // v22 (REQ-097, DES-111/DES-114, TASK-109): NEW tool — moves a named channel pointer.
  'workflow_publish',
  'workflow_get',
  'workflow_artifacts',
  // v1.5/v2: byte-fetch a workspace file chunk (REQ-022) + purge a run's workspace (REQ-026).
  'workflow_artifact_get',
  'workspace_purge',
  // v2 (DES-016/TASK-019): schedule CRUD + resident trigger, over the same RunManager.start path.
  'schedule_create',
  'schedule_list',
  'schedule_delete',
  'schedule_setEnabled',
  'workflow_trigger',
  // v2 (DES-019/TASK-021): asset sync core — recursion-guard + path-safety enforced on every push.
  'asset_push',
  'asset_list',
  'asset_delete',
  // v3 (DES-024/TASK-029): admin-write provisioning tool over the MCP Provisioning Registry.
  'mcp_provision',
  'issue_report',
  // v6 (REQ-031..034): read/reply GitHub-issue primitives for the "report -> agent solves it" flow.
  'issue_get',
  'issue_list',
  'issue_comments',
  'issue_comment',
  // v7 (REQ-039/040): unified, filterable cross-provider model catalog.
  'models_list',
  // v8 Slice 4 (REQ-053): durable on-completion chaining — "after run A completes, start run B".
  'chain_create',
  'chain_list',
  // v8 Defer B (REQ-058): external webhook ingress management.
  'webhook_create',
  'webhook_list',
  'webhook_delete',
  // v10 Slice 2 (REQ-064): efficient seeding — content-addressed blob upload + plan.
  'blob_put',
  'seed_plan',
  // v12 (REQ-076/077, DES-073/074): host system + process observability.
  'system_info',
] as const;

type ToolName = (typeof TOOL_NAMES)[number];

interface JsonSchemaProp {
  type?: string | string[];
  description?: string;
  // JSON Schema numeric range / default — used by system_info topN (DES-077).
  default?: unknown;
  minimum?: number;
  maximum?: number;
  enum?: unknown[];
  // Array/object shape — lets array params (e.g. workflow_run's seed/seedManifest) advertise their
  // element schema so a schema-validating MCP client serializes them as arrays, not strings (issue #21).
  items?: JsonSchemaProp & { properties?: Record<string, JsonSchemaProp>; required?: string[] };
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
  // v21 (DES-104, ARCH-064 inv-2): the workflow_run `overrides` object is closed — a locked key
  // (or any other unrecognized field) must not silently pass a schema-validating MCP client through.
  additionalProperties?: boolean;
}
interface ToolInputSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProp>;
  required?: string[];
}
interface ToolMeta {
  description: string;
  inputSchema: ToolInputSchema;
}

// D-G8-3: real per-tool descriptions + real JSON inputSchemas (properties/required) — an MCP
// client must be able to learn from tools/list alone what fields each tool actually takes, not
// just its own name repeated as `description` and an opaque `{type:'object'}` with no properties
// (review finding C-1). Mirrors the exact argument shapes callTool()/McpFacade already accept.
// issue #24: a schema-only consumer (no skill/docs) must be able to author a workflow from the tool
// schema alone. `script` is plain JS with an injected DSL that has no other schema home, so the
// contract lives here. Kept accurate to THIS engine: `meta` is OPTIONAL (a bare `await agent(...)`
// script runs); `log()` is currently a no-op so it is omitted; budget counts input+output tokens.
const SCRIPT_DSL_DOC =
  'A workflow script is plain async JavaScript run in a sandboxed VM (top-level await allowed). ' +
  'Injected globals: `args` (the value you pass as this call\'s args); ' +
  '`budget` = {total, spent(), remaining()} (the token pool, see the budget param); ' +
  '`agent(prompt, opts?)` — spawn a sub-agent, returns its final text (or, when opts.schema is set, a validated object); ' +
  '`parallel(thunks[])` and `pipeline(items[], ...stages)` — fan-out helpers; ' +
  '`phase(title)` — labels the agents that follow (for workflow_status/dashboard); ' +
  '`workflow(nameOrRef, args?)` — run another registered workflow inline. ' +
  'agent() opts: {model?, effort?: "low"|"medium"|"high"|"xhigh"|"max", timeoutMs? (per-call total timeout in ms; overrides the gateway default in both directions; on timeout the call yields null after retries — it does NOT throw; effective wall-clock ≈ timeoutMs × (1 + gateway retries, default 1)), label?, schema? (a JSON Schema — forces structured JSON output), agentType?, mcp?: string[] (names of server-provisioned MCP servers), isolation?: "worktree", phase?}. ' +
  'The `model` string is either a curated alias (see models_list entries\' `alias`, e.g. "opus"/"sonnet") or the join `provider + "/" + model` from a models_list entry (e.g. "openrouter/google/gemma-3-27b-it:free"); omitted → the "default" alias. ' +
  'The script\'s `return` value is exactly what workflow_result later yields. ' +
  'Optional: `export const meta = { name, description, phases }` (a pure literal) supplies workflow_list metadata + dashboard phase names — omit it and the script still runs (treated as empty, not an error). ' +
  'Minimal example: `const r = await agent("Summarize: " + args.text, { model: "sonnet" }); return { summary: r };`';

const TOOL_METADATA: Record<ToolName, ToolMeta> = {
  workflow_run: {
    description: 'Starts a new workflow run of a previously registered workflow name (REQ-098: inline scripts are no longer accepted — register once via workflow_register, then run by name; a hand-rolled body carrying `script` is refused INLINE_SCRIPT_CLOSED). Selects which registered version to run: an explicit `version` wins over any `channel`; with neither, runs the `release` channel. Returns the envelope {runId, status, result:{runId}} — the run starts asynchronously; poll workflow_status and read workflow_result for the script\'s return value.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of a previously registered workflow to run.' },
        version: { type: 'string', description: 'Explicit registered version to run (e.g. "v2"). Wins over `channel` when both are supplied. Omitted -> resolved via `channel` (or `release` if that is also omitted). Unknown version -> UNKNOWN_VERSION.' },
        channel: { type: 'string', enum: ['beta', 'release'], description: 'Named channel to run (see workflow_publish). Ignored when `version` is supplied. Omitted -> defaults to `release`. An unpublished channel -> CHANNEL_UNPUBLISHED naming the channel and the workflow\'s available versions.' },
        args: { description: 'Arbitrary arguments passed through to the script as the injected `args` global.' },
        budget: { type: ['number', 'null'], description: 'Optional token budget (input+output tokens) for the whole run — a shared pool across the script and every agent()/workflow() call. null/omitted = unbounded. Enforced BETWEEN agent() calls, not mid-call: a call that starts under budget always completes; the NEXT agent() call throws once the pool is exhausted. Inside the script, `budget` is a {total, spent(), remaining()} object.' },
        // Seed params MUST be declared here with their array/object types — the handler (mcp-facade
        // workflow_run) accepts them, but an undeclared array param lets a schema-validating MCP
        // client serialize it to a string in transit, so the engine receives `"[…]"` and
        // `spec.seedManifest.map(...)` throws `TypeError: … .map is not a function` (issue #21).
        seed: {
          type: 'array',
          description: 'Inline seed tree materialized into the run workspace before agents start.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Workspace-relative destination path.' },
              contentB64: { type: 'string', description: 'Base64-encoded file contents.' },
            },
            required: ['path', 'contentB64'],
          },
        },
        seedManifest: {
          type: 'array',
          description: 'Content-addressed seed: references blobs uploaded via blob_put (see seedNamespace). Assembled engine-side before agents start.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Workspace-relative destination path.' },
              sha256: { type: 'string', description: 'SHA-256 of the blob (must have been blob_put into seedNamespace).' },
              exec: { type: 'boolean', description: 'Mark the file executable (0755) instead of 0644.' },
            },
            required: ['path', 'sha256'],
          },
        },
        seedNamespace: { type: 'string', description: 'Per-tenant CAS namespace whose blobs seedManifest/seedManifestRef resolves against (default "_default").' },
        seedManifestRef: { type: 'string', description: 'v14 server-side manifest ref (REQ-082): the sha256 of a manifest blob registered via POST /assets/manifest. The engine loads and re-validates the manifest at run-time (security boundary). Mutually exclusive with seed/seedManifest/seedRef (→ SEED_SOURCE_CONFLICT). Use blob_put + POST /assets/manifest to register the manifest, then pass the returned seedManifestRef here.' },
        seedRef: {
          type: 'object',
          description: 'v13 engine-pull seed (REQ-080): the engine fetches {repoUrl, sha} itself, for CI/forge/air-gapped callers that hold code the client cannot push. Mutually exclusive with seed/seedManifest (→ SEED_SOURCE_CONFLICT). Requires an operator egress allowlist in engine config, else SEEDREF_DISABLED (hint: add seedRefAllowlist:[…]); a repoUrl off the allowlist (or an SSRF-shaped target: internal IP / localhost / metadata endpoint / non-https) → SEEDREF_EGRESS_DENIED before any network call. Pre-run errors return on this call; a post-run fetch failure (SEEDREF_FETCH_FAILED / SEEDREF_SHA_MISMATCH / SEEDREF_TOO_LARGE) fails the run and shows on workflow_status.seedRef.',
          properties: {
            repoUrl: { type: 'string', description: 'https repo URL; its prefix must match an entry in the engine\'s seedRefAllowlist.' },
            sha: { type: 'string', description: 'Full 40-hex (or 64-hex) commit sha to fetch — branch refs and short shas are rejected (INVALID_SEED_SPEC).' },
          },
          required: ['repoUrl', 'sha'],
        },
        overrides: {
          type: 'object',
          description: 'v21 per-run tunable-parameter overrides (REQ-091): exactly model/effort/timeoutMs/appendPrompt — locked parameters (prompt/tools/skills/mcp/workdir/cwd) are unrepresentable here (naming one -> PARAM_LOCKED). Bound by BOTH the workflow\'s own declared contract (see workflow_get.params) and the engine\'s ceilings, whichever is narrower; out-of-range -> PARAM_OUT_OF_RANGE. Never accepted by workflow_resume — a resumed run always reuses its pinned admission-time snapshot.',
          properties: {
            model: { type: 'string', description: 'Overrides the registered/default model alias for every agent() call in this run.' },
            effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh', 'max'], description: 'Overrides the reasoning effort for every agent() call in this run (bounded by the engine\'s maxEffort ceiling).' },
            timeoutMs: { type: 'number', description: 'Overrides the per-call timeout for every agent() call in this run (bounded by the engine\'s maxTimeoutMs ceiling).' },
            appendPrompt: { type: 'string', description: 'Untrusted user text appended, in a fenced <user-instructions> block, after the script prompt for every agent() call in this run (bounded by the engine\'s maxAppendPromptBytes ceiling).' },
          },
          additionalProperties: false,
        },
      },
    },
  },
  workflow_status: {
    description: "Returns a run's current lifecycle status (queued/running/suspended/stopped/completed/failed) plus its phases and in-flight/completed agent records. Each agent record carries provider/model (known once the session is built, before the first token), tokens (input+output; populated at terminal — providers report usage only on the final message), startedAt/endedAt, and lastActivityAt (ISO time of the most recent streamed transcript event — advances past startedAt while an agent is genuinely progressing; absent/stale marks a stalled or hung agent). Pair with workflow_agent_log, which grows live as the run streams events.",
    inputSchema: { type: 'object', properties: { runId: { type: 'string', description: 'The run to inspect.' } }, required: ['runId'] },
  },
  workflow_result: {
    description: "Returns a completed run's own script return value, or its failure error.",
    inputSchema: { type: 'object', properties: { runId: { type: 'string', description: 'The run to fetch the result of.' } }, required: ['runId'] },
  },
  workflow_suspend: {
    description: 'Suspends a running run: aborts any in-flight agent() call and stops the sandbox child process, preserving state for a later resume.',
    inputSchema: { type: 'object', properties: { runId: { type: 'string', description: 'The run to suspend.' } }, required: ['runId'] },
  },
  workflow_resume: {
    description: 'Resumes a suspended or stopped run, continuing its original pinned script unchanged (REQ-098: workflow_resume no longer accepts a replacement script — a hand-rolled body carrying `script` is refused INLINE_SCRIPT_CLOSED); unchanged, already-journaled calls replay from cache instead of re-invoking the gateway.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'The run to resume.' },
      },
      required: ['runId'],
    },
  },
  workflow_stop: {
    description: 'Stops a running (or suspended) run permanently: aborts any in-flight agent() call and terminates the sandbox child process.',
    inputSchema: { type: 'object', properties: { runId: { type: 'string', description: 'The run to stop.' } }, required: ['runId'] },
  },
  workflow_list: {
    description: 'Lists every registered workflow (never-run or not) together with every run summary, in one flat kind-discriminated array.',
    inputSchema: { type: 'object', properties: {} },
  },
  workflow_agent_log: {
    description: "Returns one agent() call's captured transcript events (message/tool_call/tool_result/usage, in order) for a given run. Secret values are replaced with ‹secret:NAME› markers in persisted transcripts. The result's top-level `harness` object (null until the agent is dispatched) also carries the resolved tunable-parameter values for that call: `effort` (the resolved reasoning-effort directive, when any rung set one), `effortApplied` (whether/how it reached the wire: `{param,value}` applied, `{reason}` not applied, or absent when never requested), `timeoutMs` (the resolved per-call timeout), `provenance` (per-key precedence rung — 'call'/'agentType'/'override'/'default'/'engine' — each resolved value came from), and `mcpUnresolved` (present only when this agent referenced an MCP name that is no longer provisioned: the run was not refused, but that capability was absent from the session — re-provision the name or re-register the workflow).",
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'The run the agent call belongs to.' },
        agentId: { type: 'string', description: 'The agentId (from workflow_status\'s result.agents[]) to fetch the transcript for.' },
      },
      required: ['runId', 'agentId'],
    },
  },
  workflow_register: {
    description: 'Registers (or updates) a named workflow script in the catalog, so it can later be run by name via workflow_run({name}). Ownership: the first caller to register a name becomes its owner; only the owner may overwrite or deregister it (non-owner → NOT_WORKFLOW_OWNER). Optional harness defaults bind model/tools/timeoutMs at registration.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The workflow name to register/update.' },
        script: { type: 'string', description: 'The workflow script text to save under this name (run later via workflow_run({name})). ' + SCRIPT_DSL_DOC },
        // v15 (DES-096, TASK-087): optional caller principal for ownership attribution.
        principal: { type: 'string', description: 'Caller identity (email) for ownership attribution. When auth is enabled this is resolved from the bearer; when absent, the server uses null (auth-disabled or loopback path).' },
        // v15 (DES-099, TASK-089): optional harness defaults bound at registration time.
        defaults: {
          type: 'object',
          description: 'Optional harness defaults bound at registration (DES-099, widened v21 adjudication #6 F-1): {model?, tools?, skills?, timeoutMs?, prompt?, effort?, appendPrompt?}. Validated at register time: model must be a resolvable alias, tools must be in the curated allowlist, skills are deferred to run time, effort/timeoutMs/appendPrompt above the engine\'s configured ceilings are refused. Invalid → HARNESS_DEFAULTS_INVALID, nothing stored.',
          properties: {
            model: { type: 'string', description: 'Default model alias for agents in this workflow.' },
            tools: { type: 'array', items: { type: 'string' }, description: 'Default curated tool allowlist for agents.' },
            skills: { type: 'array', items: { type: 'string' }, description: 'Default skill names (existence deferred to run time).' },
            timeoutMs: { type: 'number', description: 'Default per-agent timeout in milliseconds.' },
            prompt: { type: 'string', description: 'Default system prompt prefix for agents.' },
            effort: { type: 'string', description: "Default reasoning effort ('low'|'medium'|'high'|'xhigh'|'max'), bounded by the engine's maxEffort ceiling." },
            appendPrompt: { type: 'string', description: "Default text appended to every agent's prompt, bounded by the engine's maxAppendPromptBytes ceiling." },
          },
        },
      },
      required: ['name', 'script'],
    },
  },
  workflow_deregister: {
    description: 'Removes a registered workflow from the catalog by name (returns removed:false if it was not registered). Only the owner may deregister an owned workflow (non-owner → NOT_WORKFLOW_OWNER). Prior runs are unaffected.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The workflow name to remove from the catalog.' },
        // v15 (DES-096, TASK-087): optional caller principal for ownership gate.
        principal: { type: 'string', description: 'Caller identity (email) for ownership gate. When auth is enabled this is resolved from the bearer; when absent, the server uses null (auth-disabled or loopback path).' },
      },
      required: ['name'],
    },
  },
  // v22 (REQ-097, DES-111, DES-114, TASK-109): NEW tool — moves a named channel pointer to an
  // already-registered version. Registration != publication: workflow_run/workflow_get resolve
  // through a channel pointer, never "the newest registered row".
  workflow_publish: {
    description: 'Moves a named channel (`beta` or `release`) to an already-registered version of a workflow, so workflow_run({name}) (or {channel}) resolves to it. Registration alone does not publish — a freshly registered version is on no channel until this is called. Only the owner may publish (non-owner → NOT_WORKFLOW_OWNER); unknown version → UNKNOWN_VERSION.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The registered workflow name.' },
        version: { type: 'string', description: 'An already-registered version of this workflow (e.g. "v2") to point the channel at.' },
        channel: { type: 'string', enum: ['beta', 'release'], description: 'Which channel pointer to move.' },
        // v15 (DES-096, TASK-087) pattern: optional caller principal for ownership gate.
        principal: { type: 'string', description: 'Caller identity (email) for ownership gate. When auth is enabled this is resolved from the bearer; when absent, the server uses null (auth-disabled or loopback path).' },
      },
      required: ['name', 'version', 'channel'],
    },
  },
  workflow_get: {
    description: "Returns a registered workflow's full detail — {name, version, createdAt, description (its purpose, from meta.description), phases, script, skeleton, owner (registration principal), defaults (harness defaults bound at registration), params (the tunable-parameter contract declared via meta.params — always present, ceiling-bounded; a script with no params block reads back the canonical 4-knob contract)} — so a client can understand what it does, inspect its owner, query its registered harness defaults and tunable-parameter contract, and see its predicted DAG (a static scan of phase/agent/parallel/workflow calls) BEFORE deciding to reuse it or author a new one. Unknown name → WORKFLOW_NOT_FOUND; a known name with an unresolvable `version` → UNKNOWN_VERSION.",
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The registered workflow to inspect.' },
        version: { type: 'string', description: 'Optional explicit version to inspect (e.g. "v2"); omitted reads the `release` channel\'s version. Unknown version -> UNKNOWN_VERSION.' },
      },
      required: ['name'],
    },
  },
  workflow_artifacts: {
    description: "Recursively lists a run's workspace files (relative path + size + sha256), so a client can diff/verify what changed. Realpath-contained (never lists outside the workspace).",
    inputSchema: { type: 'object', properties: { runId: { type: 'string', description: 'The run whose workspace files to list.' } }, required: ['runId'] },
  },
  workflow_artifact_get: {
    description: 'Reads a windowed, size-capped chunk of a run workspace file (base64), for fetching a patch/bundle too large for an inline workflow_result. Page by advancing `offset` until `eof`. A path escaping the workspace (../ or symlink) is denied.',
    inputSchema: { type: 'object', properties: { runId: { type: 'string', description: 'The run.' }, path: { type: 'string', description: 'Workspace-relative file path.' }, offset: { type: 'number', description: 'Byte offset to start at (default 0).' }, length: { type: 'number', description: 'Max bytes to return (capped at the server chunk ceiling).' } }, required: ['runId', 'path'] },
  },
  workspace_purge: {
    description: "Deletes a TERMINAL run's on-disk workspace tree (its journaled record/transcript is preserved). Refuses while the run is running/suspended/queued.",
    inputSchema: { type: 'object', properties: { runId: { type: 'string', description: 'The run whose workspace to purge.' } }, required: ['runId'] },
  },
  schedule_create: {
    description: 'Creates a cron, one-shot (`at`), or resident schedule for a registered workflow; validated synchronously (cron syntax / `at` timestamp / workflow existence).',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: "One of 'cron' | 'once' | 'resident'." },
        workflow: { type: 'string', description: 'Name of a previously registered workflow (see workflow_register).' },
        args: { description: 'Arbitrary arguments passed to the workflow on each fire/trigger.' },
        cron: { type: 'string', description: "5-field cron expression (kind:'cron' only)." },
        tz: { type: 'string', description: "Optional IANA timezone (kind:'cron' only)." },
        at: { type: 'string', description: "ISO timestamp to fire once at (kind:'once' only)." },
        enabled: { type: 'boolean', description: 'Whether the schedule is active.' },
      },
      required: ['kind', 'workflow', 'enabled'],
    },
  },
  schedule_list: {
    description: 'Lists every schedule with its current enabled/nextFire/lastFire/lastRunId observability fields.',
    inputSchema: { type: 'object', properties: {} },
  },
  schedule_delete: {
    description: 'Deletes a schedule by id.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'The schedule to delete.' } }, required: ['id'] },
  },
  schedule_setEnabled: {
    description: 'Enables or disables a schedule by id, without deleting it.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The schedule to update.' },
        enabled: { type: 'boolean', description: 'New enabled state.' },
      },
      required: ['id', 'enabled'],
    },
  },
  workflow_trigger: {
    description: 'Immediately starts a run of a resident-scheduled workflow via the same path as workflow_run; a disabled resident returns error{code:SCHEDULE_DISABLED}.',
    inputSchema: {
      type: 'object',
      properties: {
        workflow: { type: 'string', description: 'Name of the resident-scheduled workflow to trigger.' },
        args: { description: 'Arbitrary arguments passed through to the script as `args`.' },
      },
      required: ['workflow'],
    },
  },
  asset_push: {
    description: "Stores a skill/hook/mcp-config asset under the workspace root; self-referential (D4, reserved rwe-* / this server's own mcp-config) and path-unsafe files are excluded/rejected, never silently.",
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: "Asset type. \"skill\" materializes into the run workspace. \"hook\" is rejected (HOOKS_UNSUPPORTED) — hooks are not supported on the server. \"mcp-config\" is redirected to mcp_provision; use that tool instead." },
        name: { type: 'string', description: 'Asset name.' },
        files: { type: 'array', description: 'Array of { path, contentB64 } entries; every path must stay inside the asset dir.' },
      },
      required: ['kind', 'name', 'files'],
    },
  },
  asset_list: {
    description: 'Lists every stored asset as { kind, name }.',
    inputSchema: { type: 'object', properties: {} },
  },
  asset_delete: {
    description: 'Deletes a stored asset by kind + name.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: "One of 'skill' | 'hook' | 'mcp-config'." },
        name: { type: 'string', description: 'Asset name to delete.' },
      },
      required: ['kind', 'name'],
    },
  },
  mcp_provision: {
    description: 'Admin tool: provisions an MCP server config by name after a live probe; a dead config is rejected and nothing is persisted. Provisioned names may then be referenced by agent()\'s `mcp` option.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The MCP name later referenced by agent({ mcp: [name] }).' },
        kind: { type: 'string', description: "One of 'stdio' | 'http'." },
        config: { description: 'The MCP server config (stdio: {command,args}; http: {url}).' },
      },
      required: ['name', 'kind', 'config'],
    },
  },
  issue_report: {
    description: 'Files a structured GitHub issue into the engine\'s own repo (HsuJavis/remote-workflow-engine) from an agent-supplied, pre-analyzed problem report — so a problem hit from any connected machine can be reported without host-switching. Returns {issueNumber, url}. The GitHub token comes from the server-side secret store (RWE_SECRET_GITHUB_TOKEN), never the arguments.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short issue title.' },
        reproSteps: { type: 'string', description: 'Exact steps to reproduce the problem.' },
        analysis: { type: 'string', description: 'The already-confirmed analysis / suspected root cause.' },
        logs: { type: 'string', description: 'Relevant log excerpts (optional).' },
        severity: { type: 'string', description: 'Severity label, e.g. low|medium|high (optional).' },
        component: { type: 'string', description: 'Affected component/area (optional).' },
        runId: { type: 'string', description: 'A related run to link in the issue (optional).' },
        version: { type: 'string', description: 'Caller-supplied version string to include in the issue body (optional; whitespace-only treated as omitted, falls back to engine version). When `workflow` is also set, this doubles as that workflow\'s own version for the `name@version` reference.' },
        workflow: { type: 'string', description: 'Binds this report to a specific registered workflow name (optional): adds a `workflow:<name>` label and, with `version`, a `name@version` reference in the body. Never existence-checked.' },
      },
      required: ['title', 'reproSteps', 'analysis'],
    },
  },
  issue_get: {
    description: "Reads a single issue from the engine's repo, returning {number, title, state, labels, body, url, commentCount}. Unknown number -> ISSUE_NOT_FOUND; token missing -> GITHUB_TOKEN_MISSING.",
    inputSchema: {
      type: 'object',
      properties: { number: { type: 'number', description: 'The issue number to read.' } },
      required: ['number'],
    },
  },
  issue_list: {
    description: "Lists issues from the engine's repo (default state:open), returning a bounded array of {number, title, state, labels, url} so a solve agent can enumerate work. Size-capped (default 30, hard 100).",
    inputSchema: {
      type: 'object',
      properties: {
        labels: { type: 'array', description: 'Filter to issues carrying ALL of these labels (e.g. ["agent-reported"]).' },
        state: { type: 'string', description: "One of 'open' | 'closed' | 'all' (default 'open')." },
        since: { type: 'string', description: 'ISO timestamp; only issues updated at/after this.' },
        limit: { type: 'number', description: 'Max issues to return (default 30, capped at 100).' },
        workflow: { type: 'string', description: 'Filter to issues bound to this workflow name (folds into the label filter as `workflow:<name>`, optional). The label truncates at 50 chars, so two long names agreeing on their first 50 chars can collide in this filter (recorded, low-severity; unaffected: issue de-duplication uses the untruncated name).' },
      },
    },
  },
  issue_comments: {
    description: "Reads an issue's comment thread in order as {id, author, body, createdAt} (the prior attempts a solve agent needs). Unknown number -> ISSUE_NOT_FOUND; token missing -> GITHUB_TOKEN_MISSING.",
    inputSchema: {
      type: 'object',
      properties: { number: { type: 'number', description: 'The issue number whose comments to read.' } },
      required: ['number'],
    },
  },
  issue_comment: {
    description: 'Posts one reply comment to an issue and returns {commentId, url}. Empty body -> ISSUE_COMMENT_INVALID; unknown number -> ISSUE_NOT_FOUND; token missing -> GITHUB_TOKEN_MISSING. Bounded + typed-error like issue_report.',
    inputSchema: {
      type: 'object',
      properties: {
        number: { type: 'number', description: 'The issue number to comment on.' },
        body: { type: 'string', description: 'The comment body (markdown); must be non-empty.' },
      },
      required: ['number', 'body'],
    },
  },
  models_list: {
    description: "Returns a unified, normalized cross-provider model catalog (curated aliases + live Ollama /api/tags + live OpenRouter /api/v1/models + a static openai/anthropic table). Each entry includes: {provider, model, alias?, ref?, besteffort?, description, modalities{in,out}, contextWindow, price(in/out|'free'|'unknown'), toolUse(bool|'unknown'), location('local'|'remote')} PLUS enriched fields: capability (capability string ≤200 chars; never null), stability ('stable'|'variable'|'best-effort': stable=paid/curated, variable=local Ollama, best-effort=OpenRouter free tier), costLevel (integer 0–10: 0=free/local … 10=dearest; null=price unknown — do NOT infer cheapness from null), modalities forwarded. `ref`, WHEN PRESENT, is directly usable as an agent({model}) value (a curated alias, or an \"openrouter/<model>\" passthrough id); an entry with NO `ref` needs a configured alias to resolve — do not hand-join \"provider/model\" for anthropic/openai. This is CAPABILITY metadata, NOT a live-reachability guarantee: toolUse:true means the model declares tool support, not that it will respond now or follow a given instruction. besteffort:true marks OpenRouter \":free\" tiers, which queue/429/cold-start and can hang at 0 tokens — bound every call with agent({timeoutMs}) and null-harden the result. Optional filters narrow the (potentially large) result; an unreachable live source degrades gracefully. No API key ever appears in the output.",
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', description: "Only this provider (e.g. 'ollama'|'openrouter'|'openai'|'anthropic')." },
        query: { type: 'string', description: 'Case-insensitive substring match over model id / description / alias.' },
        modalityIn: { type: 'string', description: "Require this input modality (e.g. 'text'|'image')." },
        modalityOut: { type: 'string', description: "Require this output modality (e.g. 'text')." },
        maxPricePerM: { type: 'number', description: 'Max price per 1M tokens (the higher of in/out); free passes, unknown-priced models are excluded.' },
        minContext: { type: 'number', description: 'Minimum context window in tokens (models with an unknown window are excluded).' },
        toolUse: { type: 'boolean', description: 'Require confirmed tool-use support (true); models with unknown support are excluded.' },
        location: { type: 'string', description: "One of 'local' | 'remote'." },
        limit: { type: 'number', description: 'Max entries to return (default 100, hard cap 500).' },
      },
    },
  },
  chain_create: {
    description: "Registers a durable on-completion chain: when run `afterRunId` COMPLETES, start `run.workflow` with `run.args` exactly once (failed/stopped → skipped). Survives restart. Returns {chainId}; the spawned runId appears in chain_list once fired.",
    inputSchema: {
      type: 'object',
      properties: {
        afterRunId: { type: 'string', description: 'The run to chain after (its completion triggers the new run).' },
        run: { type: 'object', description: 'The run to start on completion: { workflow: <registered name>, args?, budget? }.' },
      },
      required: ['afterRunId', 'run'],
    },
  },
  chain_list: {
    description: 'Lists every registered continuation with its status (pending|fired|skipped), rootRunId lineage, and spawnedRunId (once fired).',
    inputSchema: { type: 'object', properties: {} },
  },
  webhook_create: {
    description: "Registers an external webhook that fires a PRE-BOUND registered workflow. Returns {webhookId, url, secret} with the secret shown ONCE. Callers POST to the url with X-RWE-Signature (sha256=HMAC(secret,body)), X-RWE-Timestamp (±300s), X-RWE-Delivery (dedup id); the parsed body arrives as args.event.",
    inputSchema: {
      type: 'object',
      properties: {
        workflow: { type: 'string', description: 'Name of a registered workflow to fire on each delivery.' },
        enabled: { type: 'boolean', description: 'Whether the webhook is active (default true).' },
      },
      required: ['workflow'],
    },
  },
  webhook_list: {
    description: 'Lists every webhook with {id, workflow, enabled, secretFingerprint} — never the secret itself.',
    inputSchema: { type: 'object', properties: {} },
  },
  webhook_delete: {
    description: 'Deletes a webhook by id.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'The webhook to delete.' } }, required: ['id'] },
  },
  blob_put: {
    description: "Uploads one content-addressed blob for efficient workspace seeding. The server verifies the bytes hash to `sha256` (rejects BLOB_HASH_MISMATCH) and records it for `namespace`. Idempotent. Then reference it from a workflow_run `seedManifest` entry `{path, sha256, exec?}`. For blobs larger than 8 MiB (the JSON-RPC body cap) use POST /assets/blob/:sha?namespace=<ns> (raw HTTP, no base64; error: BLOB_SHA_MISMATCH on hash mismatch).",
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Per-tenant/project scope the blob is credited to (its refset).' },
        sha256: { type: 'string', description: 'Claimed sha256 of the RAW bytes; the server verifies it.' },
        contentB64: { type: 'string', description: 'Base64 of the raw file bytes.' },
      },
      required: ['namespace', 'sha256', 'contentB64'],
    },
  },
  seed_plan: {
    description: "Given a manifest `[{path, sha256, exec?}]` and a namespace, returns `{missing:[sha256…]}` — the blobs this namespace must still blob_put (or POST /assets/manifest) before a workflow_run with this seedManifest will assemble. `missing` is per-namespace (never global existence).",
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'The namespace whose refset determines what is missing.' },
        manifest: { type: 'array', description: 'Entries { path, sha256, exec? } — regular files only.' },
      },
      required: ['namespace', 'manifest'],
    },
  },
  // v12 (REQ-076/077, DES-073/074/077): host system + process metrics
  system_info: {
    description:
      'Returns a host system + process snapshot for capacity planning and scheduling decisions. ' +
      'Call before scheduling compute-intensive work to check host headroom. ' +
      'cpu.utilizationPct is the host-aggregate 0–100 value (' + UTIL_PCT_CONVENTION + '); ' +
      'per-process cpuPct is %-of-one-core over the last sampled TTL window, not a lifetime average; ' +
      'null when awaiting a second sample. ' +
      'Any section (cpu.utilizationPct, memory, disk) may be null with a reason when the OS probe fails; ' +
      'handle null per section independently.',
    inputSchema: {
      type: 'object',
      properties: {
        topN: {
          type: 'integer',
          description:
            'Integer 1–50, default 5; how many host processes part (b) returns, sorted by cpuPct desc. ' +
            'Out-of-range values CLAMPED to [1,50] (never an error).',
          default: 5,
          minimum: 1,
          maximum: 50,
        },
      },
    },
  },
};

// REQ-024 (v1.5, DoS): cap the request body so a large/hostile body can't buffer unbounded and OOM
// the process. Default 8 MiB; a run submission carrying a seed tree or a large script stays well
// under this, and the byte-fetch path (workflow_artifact_get) is what carries large payloads OUT.
const MAX_BODY_BYTES = 8 * 1024 * 1024;

// v10 Slice 1 (REQ-063): the decompressed-output cap for a gzip/deflate request body — bounds a
// decompression bomb (tiny compressed → huge output). 8× the compressed cap: real headroom for a
// compressible code seed, still bounded so a bomb can't OOM the process.
const MAX_DECOMPRESSED_BYTES = MAX_BODY_BYTES * 8;

class BodyTooLargeError extends Error {
  readonly code = 'BODY_TOO_LARGE' as const;
  /** v10 Slice 1: which cap was hit + the actionable hint the typed 413 surfaces. */
  constructor(readonly cap: number, readonly phase: 'compressed' | 'decompressed', readonly hint: string) {
    super(`request body exceeds the ${cap}-byte ${phase} cap`);
    this.name = 'BodyTooLargeError';
  }
}

const GZIP_HINT = 'compress the body with Content-Encoding: gzip, or split the payload';

function readBodyBuffer(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let capped = false;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      if (capped) return; // already over cap — DISCARD further data (bounded memory), don't buffer
      size += chunk.length;
      if (size > maxBytes) {
        capped = true;
        reject(new BodyTooLargeError(maxBytes, 'compressed', GZIP_HINT)); // caller → 413; socket drains
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!capped) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

/** Reads the request body as a utf8 string, capped at maxBytes (RAW bytes). Used where the raw body
 *  is required (webhook HMAC is over the delivered bytes — must NOT auto-decompress). */
function readBody(req: IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<string> {
  return readBodyBuffer(req, maxBytes).then((b) => b.toString('utf8'));
}

/** v10 Slice 1 (REQ-063): reads the body honoring `Content-Encoding: gzip|deflate` — the compressed
 *  bytes are capped at maxBytes, then decompressed with a bounded output (MAX_DECOMPRESSED_BYTES) so a
 *  bomb can't OOM the process. An un-encoded body behaves exactly as `readBody`. */
async function readBodyDecoded(req: IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<string> {
  const raw = await readBodyBuffer(req, maxBytes);
  const enc = String(req.headers['content-encoding'] ?? '').toLowerCase().trim();
  if (enc === '' || enc === 'identity') return raw.toString('utf8');
  try {
    const opts = { maxOutputLength: MAX_DECOMPRESSED_BYTES };
    // Async zlib runs decompression off the JS thread (libuv pool) so a large blob upload doesn't
    // block other in-flight requests on the single-threaded event loop.
    const out = enc === 'gzip' ? await gunzipAsync(raw, opts) : enc === 'deflate' ? await inflateAsync(raw, opts) : null;
    if (out === null) return raw.toString('utf8'); // unknown encoding → treat as raw (best-effort)
    return out.toString('utf8');
  } catch (err) {
    // zlib throws RangeError('… maxOutputLength') when the decompressed size exceeds the cap → a bomb.
    if (err instanceof RangeError) throw new BodyTooLargeError(MAX_DECOMPRESSED_BYTES, 'decompressed', GZIP_HINT);
    throw err;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

/** TASK-026 (DES-020): gates a mcp-config push on `classifyTransport` first (pure, synchronous —
 *  no probe attempted for an already-`'unsupported'` transport), then the injected `McpProbe`.
 *  Returns `null` when the push may proceed; otherwise the exclusion reason to report. Only the
 *  first file that parses as JSON is treated as the server config (matches asset-sync.ts's own
 *  `isSelfReferential` convention for mcp-config payloads). */
async function checkMcpConfigTransport(push: AssetPush, probe: McpProbe): Promise<string | null> {
  for (const f of push.files) {
    let cfg: McpServerConfig;
    try {
      cfg = JSON.parse(Buffer.from(f.contentB64, 'base64').toString('utf-8')) as McpServerConfig;
    } catch {
      continue; // not parseable JSON — not this validator's concern
    }
    if (classifyTransport(cfg) === 'unsupported') {
      return 'unsupported MCP transport: not server-runnable (remote-http or npx-stdio only)';
    }
    const probed = await probe.probe(cfg);
    if (!probed.ok) return probed.message;
  }
  return null;
}

/** Dispatches a tools/call to the matching McpFacade method (pure delegation, DES-001). */
async function callTool(
  facade: McpFacade,
  scheduler: SqliteSchedulerPort,
  continuations: ContinuationStore,
  webhooks: WebhookRegistry,
  webhookBaseUrl: string,
  cas: CasStore,
  assetSync: AssetSyncService,
  mcpProbe: McpProbe,
  mcpRegistry: McpRegistry,
  issueReporter: IssueReporter,
  buildModelCatalog: () => Promise<ModelEntry[]>,
  systemInfo: SystemInfoSampler,
  name: string,
  args: Record<string, unknown>,
  principal: string | null = null,
  // v22 (DES-116, ARCH-076, TASK-111): server-level "is auth configured at all" — sourced from
  // `authCfg`/`authHandlers` presence at BOTH call sites, never from whether `principal` resolved
  // (a D-BIND loopback-exempt caller reaches the auth-enabled server with `principal === null`, and
  // masking must still apply — ADR-012).
  authEnabled = false,
): Promise<unknown> {
  switch (name as ToolName) {
    case 'workflow_run': return facade.workflow_run(args as { name?: string; script?: string; args?: unknown; budget?: number | null; seed?: { path: string; contentB64: string }[]; seedManifest?: { path: string; sha256: string; exec?: boolean }[]; seedNamespace?: string; seedRef?: { repoUrl: string; sha: string }; seedManifestRef?: string; version?: string; channel?: 'beta' | 'release'; overrides?: unknown }, principal);
    case 'workflow_status': return facade.workflow_status(args as { runId: string });
    case 'workflow_result': return facade.workflow_result(args as { runId: string });
    case 'workflow_suspend': return facade.workflow_suspend(args as { runId: string });
    case 'workflow_resume': return facade.workflow_resume(args as { runId: string; script?: string });
    case 'workflow_stop': return facade.workflow_stop(args as { runId: string });
    case 'workflow_list': return facade.workflow_list(args, { authEnabled, principal });
    case 'workflow_agent_log': return facade.workflow_agent_log(args as { runId: string; agentId: string });
    // v15 (DES-096, TASK-087): thread principal to mutation methods for ownership attribution.
    // Effective principal: auth-resolved wins; if null (loopback/auth-disabled), fall back to
    // args.principal if the caller supplies one (IT-080 pattern for catalog-layer integration tests).
    case 'workflow_register': {
      const { principal: argPrincipal, ...regArgs } = args as { name: string; script: string; principal?: string | null; defaults?: Record<string, unknown> };
      const effectivePrincipal = principal ?? (typeof argPrincipal === 'string' ? argPrincipal : null);
      return facade.workflow_register(regArgs, effectivePrincipal);
    }
    case 'workflow_deregister': {
      const { principal: argPrincipal, ...deregArgs } = args as { name: string; principal?: string | null };
      const effectivePrincipal = principal ?? (typeof argPrincipal === 'string' ? argPrincipal : null);
      return facade.workflow_deregister(deregArgs, effectivePrincipal);
    }
    // v22 (REQ-097, DES-111/DES-114, TASK-109): same principal-threading pattern as register/deregister.
    case 'workflow_publish': {
      const { principal: argPrincipal, ...pubArgs } = args as { name: string; version: string; channel: 'beta' | 'release'; principal?: string | null };
      const effectivePrincipal = principal ?? (typeof argPrincipal === 'string' ? argPrincipal : null);
      return facade.workflow_publish(pubArgs, effectivePrincipal);
    }
    case 'workflow_get': return facade.workflow_get(args as { name: string; version?: string }, { authEnabled, principal });
    case 'workflow_artifacts': return facade.workflow_artifacts(args as { runId: string });
    case 'workflow_artifact_get': return facade.workflow_artifact_get(args as { runId: string; path: string; offset?: number; length?: number });
    case 'workspace_purge': return facade.workspace_purge(args as { runId: string });
    // v2 (DES-016/TASK-019): schedule CRUD + resident trigger — thin pass-through to SqliteSchedulerPort,
    // whose own methods already return the { result?, error? } envelope shape (see scheduler.ts).
    case 'schedule_create': return scheduler.create(args as unknown as NewSchedule);
    case 'schedule_list': return { result: await scheduler.list() };
    case 'schedule_delete': return scheduler.delete(args['id'] as string);
    case 'schedule_setEnabled': return scheduler.setEnabled(args['id'] as string, args['enabled'] as boolean);
    case 'workflow_trigger': return scheduler.trigger(args['workflow'] as string, args['args']);
    // v8 Slice 4 (REQ-053): durable on-completion chaining over the ContinuationStore.
    case 'chain_create': {
      const r = await continuations.chainCreate(args as unknown as { afterRunId: string; run: { workflow: string; args?: unknown; budget?: number | null } });
      return r.error ? { error: r.error } : { result: { chainId: r.chainId } };
    }
    case 'chain_list': return { result: await continuations.list() };
    // v8 Defer B (REQ-058): webhook ingress management. webhook_create returns the secret ONCE + the
    // POST url; webhook_list returns fingerprints only; webhook_delete removes by id.
    case 'webhook_create': {
      const r = await webhooks.create(args as unknown as { workflow: string; enabled?: boolean });
      if ('error' in r) return { error: r.error };
      return { result: { webhookId: r.webhookId, url: `${webhookBaseUrl}/hooks/${r.webhookId}`, secret: r.secret } };
    }
    case 'webhook_list': return { result: webhooks.list() };
    case 'webhook_delete': return { result: webhooks.delete(args['id'] as string) };
    // v10 Slice 2 (REQ-064): content-addressed blob upload + per-namespace plan.
    case 'blob_put': {
      const a = args as { namespace: string; sha256: string; contentB64: string };
      try {
        const r = await cas.putBlob(a.namespace, a.sha256, Buffer.from(a.contentB64 ?? '', 'base64'));
        return { result: { sha256: r.sha256, accepted: r.accepted } };
      } catch (err) {
        return { error: { code: (err as { code?: string }).code ?? 'BLOB_ERROR', message: (err as Error).message } };
      }
    }
    case 'seed_plan': {
      const a = args as { namespace: string; manifest: Array<{ sha256: string }> };
      const shas = (a.manifest ?? []).map((e) => e.sha256).filter(Boolean);
      return { result: { missing: await cas.missing(a.namespace, shas) } };
    }
    // v2 (DES-019/TASK-021): asset_push reports a path-safety violation as a tool-result `error`
    // (never a thrown JSON-RPC-level error) — DES-001's own "never throw across the tool boundary".
    case 'asset_push': {
      const push = args as unknown as AssetPush;
      // v3 (DES-028/TASK-034): classify BEFORE anything else touches disk/network — a `hook` is
      // rejected by construction (never materialized, closes the arbitrary-server-side-code vector)
      // and an `mcp-config` is redirected to the v3 Provisioning Registry (REQ-009 rescope: use
      // `mcp_provision`, not a per-run materialized asset) — so the old mcp-config probe check
      // below no longer runs for that kind at all.
      const disposition = classifyAsset(push.kind, push);
      if (disposition.action === 'reject') {
        return { result: { stored: [], excluded: [{ name: push.name, reason: disposition.code }] } };
      }
      if (disposition.action === 'redirect-to-provisioning') {
        return { result: { stored: [], redirected: true, excluded: [{ name: push.name, reason: 'REDIRECTED_TO_PROVISIONING: use mcp_provision instead of asset_push for mcp-config' }] } };
      }
      try {
        return { result: await assetSync.push(push) };
      } catch (err) {
        return { error: { code: 'ASSET_PATH_ESCAPE', message: (err as Error).message } };
      }
    }
    case 'asset_list': return { result: await assetSync.list() };
    case 'asset_delete':
      await assetSync.delete(args as unknown as { kind: AssetKind; name: string });
      return { result: undefined };
    // v3 (DES-024/TASK-029): probes the config first via the same injected McpProbe seam
    // asset_push's mcp-config validation already uses (TASK-026) — dead config -> MCP_PROBE_FAILED,
    // nothing persisted; live -> row persisted, later resolvable by name (never a thrown
    // JSON-RPC-level error — DES-001's own tool-boundary envelope convention).
    case 'mcp_provision': {
      const outcome = await mcpRegistry.register(args as unknown as { name: string; kind: McpKind; config: unknown });
      return outcome.ok
        ? { result: { ok: true } }
        : { error: { code: outcome.error, message: `MCP probe failed for '${(args as { name?: string }).name ?? ''}'` } };
    }
    case 'issue_report': {
      // REQ-027..030/035/036: envelope-not-throw — validation/token/API failures come back as {error}.
      const res = await issueReporter.report(args as unknown as IssueReportInput);
      return res.ok ? { result: { issueNumber: res.issueNumber, url: res.url, deduped: res.deduped } } : { error: res.error };
    }
    // v6 (REQ-031..034): read/reply issue primitives — same envelope-not-throw discipline.
    case 'issue_get': {
      const res = await issueReporter.getIssue(Number((args as { number?: unknown }).number));
      return res.ok ? { result: res.issue } : { error: res.error };
    }
    case 'issue_list': {
      const res = await issueReporter.listIssues(args as unknown as IssueListFilter);
      return res.ok ? { result: res.issues } : { error: res.error };
    }
    case 'issue_comments': {
      const res = await issueReporter.getComments(Number((args as { number?: unknown }).number));
      return res.ok ? { result: res.comments } : { error: res.error };
    }
    case 'issue_comment': {
      const res = await issueReporter.postComment(Number((args as { number?: unknown }).number), (args as { body?: unknown }).body as string);
      return res.ok ? { result: { commentId: res.commentId, url: res.url } } : { error: res.error };
    }
    // v7 (REQ-039/040): build the federated catalog fresh (so a live source recovering after boot
    // is reflected), then AND-filter + enrich it. Never throws across the tool boundary — an
    // unreachable live source degrades to fewer entries, and an empty match returns [].
    case 'models_list': {
      const entries = await buildModelCatalog();
      return { result: filterCatalog(entries, args as CatalogFilter).map(enrichModelEntry) };
    }
    // v12 (REQ-076/077, DES-073/074): host + process system info.
    case 'system_info': {
      const topN = args['topN'] !== undefined ? Math.floor(Number(args['topN'])) : 5;
      try {
        const view = await systemInfo.get({ topN });
        return { status: 'ok', result: view };
      } catch (err) {
        return { status: 'error', error: { code: 'PROBE_ERROR', message: String(err) } };
      }
    }
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

/** TASK-025 (DES-018): read-only HTTP dashboard transport. Reads through the same injectable
 *  RunStore port + RunManager.status() the MCP tools already use (no bespoke event bus, no
 *  parallel dashboard DTO — `buildDashboardModel` shapes exactly the existing
 *  RunSummary[]/RunStatusView/TranscriptEvent[] shapes). Strictly GET-only; a store read error
 *  degrades to a partial VM with `degraded` set, never a 500 that takes the page down. */
async function handleDashboardRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: RunStore,
  runManager: RunManager,
  issueReporter: IssueReporter,
  facade: McpFacade,
  systemInfo: SystemInfoSampler,
  buildModelCatalog: () => Promise<ModelEntry[]>,
  // v22 (DES-115, REQ-100, TASK-111): the skeleton route is script-derived and has no bearer/identity
  // plumbing at all (a browser GET carries none) — so under auth it is unconditionally the
  // non-owner/masked row; auth off keeps the pre-v22 surface.
  authEnabled = false,
): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Dashboard API is read-only: only GET is supported.' });
    return;
  }
  const path = (req.url ?? '').split('?')[0]!;
  const agentMatch = /^\/api\/runs\/([^/]+)\/agents\/([^/]+)$/.exec(path);
  const dagMatch = /^\/api\/runs\/([^/]+)\/dag$/.exec(path);
  const skeletonMatch = /^\/api\/workflows\/([^/]+)\/skeleton$/.exec(path);
  const runMatch = /^\/api\/runs\/([^/]+)$/.exec(path);
  const issuesDetailMatch = /^\/api\/issues\/(\d+)$/.exec(path);
  try {
    // v11 F1 (REQ-074/075): home view — 3-way grouped workflow cards with reliability metrics.
    if (path === '/api/home') {
      const [catalogEntries, runs] = await Promise.all([
        runManager.catalog.list(),
        store.listRuns(),
      ]);
      const metrics = computeWorkflowMetrics(runs);
      sendJson(res, 200, buildHomeView(catalogEntries, runs, metrics));
      return;
    }
    // v12 (REQ-076/077, DES-073): host system info — bare SystemInfoView (no MCP envelope wrapper).
    if (path === '/api/system') {
      const view = await systemInfo.get({ topN: 5 });
      sendJson(res, 200, view);
      return;
    }
    // v12 (REQ-078, DES-075/076): enriched model list — returns EnrichedModelEntry[] directly.
    if (path === '/api/models') {
      const entries = await buildModelCatalog();
      sendJson(res, 200, filterCatalog(entries).map(enrichModelEntry));
      return;
    }
    if (path === '/api/runs') {
      const runs = await store.listRuns();
      sendJson(res, 200, buildDashboardModel(runs).runs);
      return;
    }
    // v8 Slice 3 (REQ-049): registered-workflow cards for the dashboard home.
    if (path === '/api/workflows') {
      sendJson(res, 200, await runManager.catalog.list());
      return;
    }
    // v9 (REQ-062): a registered workflow's predicted static DAG skeleton (inspect before running).
    if (skeletonMatch) {
      const name = decodeURIComponent(skeletonMatch[1]!);
      try {
        const full = await runManager.catalog.resolveDetail(name, {});
        const meta = parseMeta(full.script);
        // v22 (DES-115, REQ-100, TASK-111): skeleton/phases are script-derived and masked by
        // default — this route carries no bearer, so under auth it is always the non-owner row.
        if (authEnabled) {
          sendJson(res, 200, { name, version: full.version, description: meta.description });
        } else {
          sendJson(res, 200, { name, version: full.version, description: meta.description, phases: meta.phases, skeleton: parseWorkflowSkeleton(full.script) });
        }
      } catch { sendJson(res, 404, { error: `Workflow not found: ${name}` }); }
      return;
    }
    // v11 (REQ-067): GET /api/issues — read-only issues dashboard list, partitioned by state.
    if (path === '/api/issues') {
      const result = await issueReporter.listIssues({ labels: ['agent-reported'], state: 'all' });
      if (!result.ok) {
        sendJson(res, 200, { open: [], resolved: [], degraded: 'GitHub not configured' });
        return;
      }
      const open = result.issues.filter((s) => s.state === 'open');
      const resolved = result.issues.filter((s) => s.state !== 'open');
      sendJson(res, 200, { open, resolved });
      return;
    }
    // v11 (REQ-067): GET /api/issues/:number — full IssueView or 404 on not-found; token-missing → 200 degraded.
    if (issuesDetailMatch) {
      const number = Number(issuesDetailMatch[1]);
      const result = await issueReporter.getIssue(number);
      if (!result.ok) {
        if (result.error.code === 'ISSUE_NOT_FOUND') {
          sendJson(res, 404, { error: result.error.message });
          return;
        }
        sendJson(res, 200, { degraded: 'GitHub not configured' });
        return;
      }
      sendJson(res, 200, result.issue);
      return;
    }
    // v11 Sprint 3 (TASK-067 / DES-064): GraphPayload envelope — kind:'run' + logical layout cells.
    if (dagMatch) {
      const [, runId] = dagMatch as unknown as [string, string];
      const stored = await store.getRun(runId);
      if (!stored) { sendJson(res, 404, { error: `Run not found: ${runId}` }); return; }
      const view = await runManager.status(runId).catch(() => stored);
      const spec = await store.getSpec(runId);
      // v22 (DES-114, TASK-109): the DAG skeleton derives from the run's PINNED (name, version), not
      // `spec.script` — a named run never persists an inline script (start() resolves it from the
      // catalog), so `spec?.script` is empty for every named run today. Mirrors run-manager.ts's own
      // legacy-cohort fallback (`_requireLive`): try the pin, else `release`, else an empty skeleton
      // (never crash the dashboard route over a stale/unresolvable pin).
      let skeletonScript = spec?.script ?? '';
      if (spec?.name) {
        try {
          skeletonScript = (await runManager.catalog.resolve(spec.name, { version: view.scriptVersion })).script;
        } catch {
          try {
            skeletonScript = (await runManager.catalog.resolve(spec.name, {})).script;
          } catch {
            skeletonScript = '';
          }
        }
      }
      const skeletonNodes = parseWorkflowSkeleton(skeletonScript);
      const layout = layoutGraph(skeletonNodes, view.agents, { startedByType: view.startedBy?.type });
      // DES-064: flat GraphPayload — cells/edges/warnings/truncated at top level (not nested under 'layout').
      const payload: Record<string, unknown> = {
        kind: 'run',
        ...layout,
        startedBy: view.startedBy ?? { type: 'unknown' },
      };
      if (view.terminalAt) payload['terminalAt'] = view.terminalAt;
      sendJson(res, 200, payload);
      return;
    }
    if (agentMatch) {
      const [, runId, agentId] = agentMatch as unknown as [string, string, string];
      // DES-067 (TASK-070): parse ?limit=N&offset=M for the events window.
      const qs = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
      const limitParam = Number(qs.get('limit'));
      const offsetParam = Number(qs.get('offset'));
      const limit = limitParam > 0 ? limitParam : undefined;
      const offset = offsetParam > 0 ? offsetParam : undefined;
      const shaped = await facade.workflow_agent_log({ runId, agentId, limit, offset });
      if (shaped.error) {
        // HTTP: map typed error codes to standard { error: string } 404s (dashboard convention).
        sendJson(res, 404, { error: shaped.error.message });
        return;
      }
      sendJson(res, 200, shaped);
      return;
    }
    if (runMatch) {
      const [, runId] = runMatch as unknown as [string, string];
      const stored = await store.getRun(runId);
      if (!stored) { sendJson(res, 404, { error: `Run not found: ${runId}` }); return; }
      const view = await runManager.status(runId).catch(() => stored);
      sendJson(res, 200, buildDashboardModel([], view).selected);
      return;
    }
    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    // DES-018: never a 500 — degrade to a partial/last-known view with an error badge.
    sendJson(res, 200, buildDashboardModel([], undefined, undefined, (err as Error).message));
  }
}

/** Start the MCP Streamable HTTP server. Resolves when listening. */
export async function createServer(config?: ServerConfig): Promise<Server> {
  const bind = config?.bind ?? '127.0.0.1';
  // Real on-disk RunStore (journal.jsonl + SQLite index) — DES-015: E2E/acceptance must exercise
  // the real store, not the InMemory unit-test fake; a workRoot survives across a server restart.
  const workRoot = config?.workRoot ?? mkdtempSync(join(tmpdir(), 'rwe-'));
  const clock = new SystemClock();

  // v11 Sprint 2 (REQ-068, TASK-062/DES-059): self-update wiring.
  // Boot guard: flag/result paths must not reside inside the workRoot (RCE-prevention).
  if (config?.updateFlagPath || config?.updateResultPath) {
    assertUpdatePathsOutsideWorkRoot([config.updateFlagPath, config.updateResultPath], [workRoot]);
  }
  // Resolve the HMAC secret once at startup (RWE_SECRET_GITHUB_WEBHOOK_SECRET).
  const githubWebhookSecret = loadSecretSourceFromEnv().resolve('GITHUB_WEBHOOK_SECRET');
  // Dedup DB — created when any self-update path is configured (flag, result, or explicit DB path).
  // VAL-079: updateResultPath alone (without updateFlagPath) is a valid "observe-only" config.
  const selfUpdateDb = (config?.updateFlagPath || config?.updateResultPath || config?.selfUpdateDbPath)
    ? new SelfUpdateDb(config.selfUpdateDbPath ?? join(workRoot, 'self-update.db'), clock)
    : null;
  // Anchored tag pattern (rejects injection attempts like "v1.0.0; rm -rf /").
  const GITHUB_TAG_PATTERN = /^v[0-9][0-9A-Za-z.\-+]*$/;
  const store = new SqliteRunStore(join(workRoot, 'store'), clock);
  const hydratedRuns = await store.hydrateAll(); // boot recovery: re-classify stale 'running' as 'interrupted'
  const interruptedRuns = hydratedRuns.filter((r) => r.status === 'interrupted').length;

  // DES-061 (TASK-064): last-update outcome — ingested at boot (covers applied restart) AND lazily
  // on /api/status (covers failed: engine not restarted).
  // DB row is the served authority so that:
  //  (a) armed-but-no-result-file-yet → DB pending row is visible immediately.
  //  (b) stale-tag guard: pending row for T_new is NOT clobbered by applied/failed for T_old.
  let lastUpdateOutcome: UpdateOutcome | null = null;
  const sameOutcome = (a: UpdateOutcome | null, b: UpdateOutcome | null): boolean =>
    a === b || (!!a && !!b && a.tag === b.tag && a.status === b.status && a.ts === b.ts && a.detail === b.detail);
  const ingestUpdateResult = (): void => {
    const result = config?.updateResultPath ? readUpdateResult(config.updateResultPath) : null;
    if (!selfUpdateDb) {
      // No DB: serve file result directly (no pending tracking).
      if (result) lastUpdateOutcome = result;
      return;
    }
    const current = selfUpdateDb.readOutcome();
    // Stale-tag guard: don't overwrite a pending row for T_new with an old result for T_old.
    const stale = !!(result && current?.status === 'pending' && current.tag !== result.tag);
    // Only write when the value actually changed — this runs on every /api/status poll (~3s), so
    // an unchanged terminal result must not re-issue an identical INSERT OR REPLACE (WAL) each hit.
    if (result && !stale && !sameOutcome(result, current)) selfUpdateDb.overwriteOutcome(result);
    // Serve the freshest row (the just-written result, else the current DB row — captures pending
    // even before the result file exists). No second SELECT: the value is already in hand.
    lastUpdateOutcome = (result && !stale ? result : current) ?? lastUpdateOutcome;
  };
  ingestUpdateResult(); // boot-time read (covers the "applied" case after a systemctl restart)

  // v21 adjudication #6 (F-1 ceiling interaction): computed BEFORE the catalog so a declared knob
  // default can be bounded at registration too, not just at admission/read (moved up from its
  // former spot below — same object, forwarded to the catalog AND to RunManager/McpFacade).
  // v21 Gate 8 RE-REVIEW #6 (P6-5): the per-key fallback reads contract.ts's shared
  // DEFAULT_CEILINGS. This composition root used to re-type the three numbers, so a change at
  // run-manager.ts/mcp-facade.ts would have left PRODUCTION on the old values with a green suite.
  // v22 (TASK-107): widened inline (was `: Ceilings`) so the object can also carry
  // maxWorkflowVersions, structurally compatible with every Ceilings-typed consumer below — same
  // `Ceilings & { maxWorkflowVersions? }` shape workflow-catalog.ts's own read already casts to.
  // No shared DEFAULT_CEILINGS entry for it — absent means uncapped (DES-111).
  const ceilings: Ceilings & { maxWorkflowVersions?: number } = {
    maxTimeoutMs: config?.maxTimeoutMs ?? DEFAULT_CEILINGS.maxTimeoutMs,
    maxAppendPromptBytes: config?.maxAppendPromptBytes ?? DEFAULT_CEILINGS.maxAppendPromptBytes,
    maxEffort: config?.maxEffort ?? DEFAULT_CEILINGS.maxEffort,
    maxWorkflowVersions: config?.maxWorkflowVersions,
  };
  // v3 (DES-024/TASK-028/TASK-029): SQLite sibling catalog, same workRoot convention as
  // catalog.db/store/schedules.db — survives restart. Moved up from its old below-catalog spot
  // (v22, TASK-107) so the WorkflowCatalog's own registration-time MCP_NOT_PROVISIONED check
  // (DES-112, ADR-013) can wire a real mcpLookup instead of registering unwired (this repo's
  // signature defect class) — no ordering dependency on `catalog` in either direction.
  const mcpProbe: McpProbe = config?.mcpProbe ?? new RealMcpProbe();
  const mcpRegistry = new McpRegistry({ dbPath: join(workRoot, 'mcp-registry.db'), probe: mcpProbe });
  // v15 (DES-098, DES-099, TASK-089): boot backfill + alias-aware validation
  const catalog = new WorkflowCatalog(workRoot, clock, {
    backfillOwner: config?.auth?.enabled ? true : undefined,
    // v22 (DES-112, TASK-107): the SAME registry the mcp_provision admin tool reads/writes —
    // registration now refuses an unprovisioned MCP name the same way submission used to.
    mcpLookup: (name) => mcpRegistry.get(name) !== undefined,
    // v21 Gate 8 re-review #3 (P-A2): mirror the run manager's own fallback (line ~1196,
    // R-G3) — an unconfigured deployment must feed the SAME non-empty DEFAULT_ALIASES table to
    // BOTH registration and admission, or a model.enum/default absent from DEFAULT_ALIASES
    // registers fine here and is refused only later at every run ("register succeeds, every run
    // fails", discovered only after the fact).
    aliasNames: new Set(Object.keys(config?.aliases ?? DEFAULT_ALIASES)),
    ceilings,
  });
  const gateway =
    config?.gateway ??
    (config?.aliases
      ? new LiteLLMGatewayClient({
          aliases: config.aliases,
          timeoutMs: config?.timeoutMs ?? 15000,
          retries: config?.retries ?? 1,
          // D-R1: production default = SDK+LiteLLM proxy path, explicit opt-out via useLiteLLMProxy:false.
          useLiteLLMProxy: config?.useLiteLLMProxy ?? true,
          proxyManager: config?.proxyManager,
          litellmPort: config?.litellmPort,
        })
      : undefined);
  // D-F2: agentType composition-root loader — populated ONCE at startup from agents/*.md frontmatter.
  const agentTypes = config?.agentDefinitionsDir ? loadAgentDefinitions(config.agentDefinitionsDir) : undefined;
  // D-V3M-2 (REQ-020 D-DOS): the ONE process-global agent-slot semaphore, shared by reference into
  // the RunManager (rations every SDK-CLI dispatch) and surfaced read-only via GET /api/status.
  const agentSemaphore = createSemaphore(config?.agentSlots ?? 32);
  // v8 Slice 4 (REQ-053): the continuation store subscribes to RunManager.onTerminal. There is a
  // construction cycle (RunManager needs onTerminal → store; store needs runManager.start) — broken
  // with a late-bound closure: onTerminal fires via queueMicrotask at runtime, long after both are
  // assigned, so `continuations` is populated by then.
  // v10 Slice 2 (REQ-064/065): the content-addressed store backing efficient seedManifest assembly.
  const cas = new CasStore(config?.casDir ?? join(workRoot, 'cas'));
  // v14 (REQ-081, DES-086): max raw bytes for POST /assets/blob/:sha (default 256 MiB, min 1 MiB).
  const MIN_BLOB_BYTES = 1024 * 1024; // 1 MiB minimum per DES-086
  const DEFAULT_BLOB_BYTES = 256 * 1024 * 1024; // 256 MiB default per DES-086
  const blobMaxBytes = config?.maxBlobBytes !== undefined
    ? Math.max(MIN_BLOB_BYTES, config.maxBlobBytes)
    : DEFAULT_BLOB_BYTES;
  // v14 (REQ-083, DES-088): SecretValueProvider from env for redact-at-capture wiring.
  const secretSource = loadSecretSourceFromEnv();
  const secretValueProvider: SecretValueProvider = {
    entries(): ReadonlyArray<{ name: string; value: string }> {
      return secretSource.names().map((n) => ({ name: n, value: secretSource.resolve(n) ?? '' })).filter((s) => s.value.length > 0);
    },
  };
  // `ceilings` (ARCH-066 inv-6, DES-104, TASK-100) is defined above, before `catalog`, and forwarded
  // to BOTH RunManager (admission — refuses) and McpFacade (workflow_get/list read-time effective
  // bounds) so a lowered ceiling is honored consistently everywhere, not just at the rung that
  // happens to enforce it — now including the catalog's own registration-time check (F-1).
  let continuations: ContinuationStore | undefined;
  // v21 Gate 8 RE-REVIEW (review §R2 (c), R-G3 MED): unlike the catalog's aliasNames (line ~1141,
  // registration-time enum check, deliberately empty=accept-all per D-AUTH-5-B), the admission-time
  // UNKNOWN_ALIAS check must mirror what DISPATCH actually resolves against — and on the documented
  // default/unconfigured deployment dispatch resolves via DEFAULT_ALIASES (run-manager.ts's
  // DEFAULT_GATEWAY_CONFIG), never "accept everything". Feeding an empty Set here left the B1/B2
  // admission control inert on exactly the deployment shape most installs use.
  const aliasNames = new Set(Object.keys(config?.aliases ?? DEFAULT_ALIASES));
  const runManager = new RunManager({ store, clock, catalog, workRoot, gateway, agentTypes, semaphore: agentSemaphore, maxWorkflowDepth: config?.maxWorkflowDepth, maxWorkflowDescendants: config?.maxWorkflowDescendants, maxConcurrentRuns: config?.maxConcurrentRuns, seedRefAllowlist: config?.seedRefAllowlist, cas, secretValueProvider, ceilings, aliasNames, onTerminal: (runId, status) => { void continuations?.onTerminal(runId, status); } });
  // v8 Slice 4 (REQ-053): SQLite-persisted on-completion chaining, same workRoot convention as
  // schedules.db; rearmAtBoot reconciles any continuation whose target terminated while down.
  continuations = new ContinuationStore({ clock, runManager, store, dbPath: config?.continuationDbPath ?? join(workRoot, 'continuations.db') });
  void continuations.rearmAtBoot();
  // v8 Defer B (REQ-057/058): durable webhook ingress registry, same workRoot convention.
  const webhooks = new WebhookRegistry({ clock, runManager, catalog, dbPath: config?.webhookDbPath ?? join(workRoot, 'webhooks.db') });
  // v22 (TASK-107): mcpProbe/mcpRegistry moved up above the catalog (see there) so registration can
  // wire the same registry's MCP_NOT_PROVISIONED check; still referenced below by the mcp_provision
  // admin tool.
  // v22 (DES-113, TASK-108) SHRINK: SubmissionValidatorDeps is now `{catalog}` — the alias/MCP-name/
  // parse checks moved to registration (ADR-013); see submission-validator.ts's own header.
  const validator = new SubmissionValidator({ catalog });
  const facade = new McpFacade({ clock, store, runManager, validator, ceilings });
  // v6 (REQ-036): best-effort engine-side diagnostics for a runId, pulled through the SAME facade
  // the MCP tools use (status + artifact list + failing/last agent transcript tail), formatted as a
  // short markdown block. Bounded and swallow-all — an unknown/failed run returns null so the
  // enrichment NEVER fails an issue_report.
  const runDiagnostics = async (runId: string): Promise<string | null> => {
    try {
      const statusEnv = await facade.workflow_status({ runId });
      if (statusEnv.error || !statusEnv.result) return null;
      const view = statusEnv.result;
      const lines: string[] = ['### Engine diagnostics', `- status: ${view.status}`];
      const artifactsEnv = await facade.workflow_artifacts({ runId });
      const artifacts = artifactsEnv.result ?? [];
      lines.push(`- artifacts: ${artifacts.length}`);
      for (const f of artifacts.slice(0, 20)) lines.push(`  - \`${f.path}\` (${f.size} bytes)`);
      const agents = view.agents ?? [];
      const failing = agents.find((a) => a.state === 'failed') ?? agents[agents.length - 1];
      if (failing) {
        const logEnv = await facade.workflow_agent_log({ runId, agentId: failing.agentId });
        const events = logEnv.events ?? [];
        const tail = events.slice(-5).map((e) => `- ${e.kind}: ${JSON.stringify(e.data).slice(0, 200)}`);
        if (tail.length) {
          lines.push(`- last agent \`${failing.label ?? failing.agentId}\` (${failing.state}) transcript tail:`);
          lines.push(...tail);
        }
      }
      return lines.join('\n');
    } catch {
      return null; // best-effort — never fail the report on an enrichment error
    }
  };
  // v5 (REQ-027..030): the issue_report reporter. Token from the server-side secret store
  // (RWE_SECRET_GITHUB_TOKEN), never workspace-reachable. A test seam replaces it with a fake.
  const issueReporter = config?.issueReporter ?? new IssueReporter({ secretSource: loadSecretSourceFromEnv(), engineVersion: ENGINE_VERSION, runDiagnostics });
  // v7 (REQ-039/040): the `models_list` catalog builder — federates the config's curated aliases +
  // the injectable live fetchers (default real fetch). Built per call inside callTool so a live
  // source recovering after boot is reflected. A fully injectable builder wins when provided.
  const buildModelCatalog = config?.modelCatalog ?? ((): Promise<ModelEntry[]> => buildCatalog({
    aliases: config?.aliases,
    ollamaFetch: config?.modelCatalogFetchers?.ollamaFetch,
    openrouterFetch: config?.modelCatalogFetchers?.openrouterFetch,
    ollamaBaseUrl: config?.modelCatalogFetchers?.ollamaBaseUrl,
  }));
  // v12 (REQ-076/077, DES-073): ONE SystemInfoSampler instance shared between the system_info tool
  // and GET /api/system (DES-073 "sample once"). Tests inject a StubProbe-backed sampler via
  // config.systemInfo; production defaults to a RealSystemProbe.
  const systemInfoSampler = config?.systemInfo ?? new SystemInfoSampler(new RealSystemProbe(workRoot), clock, 1500);
  // v2 (DES-016/TASK-019): SQLite-persisted schedule store, same workRoot convention as
  // catalog.db/store — survives restart (REQ-014-style persistence extended to schedules).
  const scheduler = new SqliteSchedulerPort({
    clock, catalog, runManager,
    dbPath: config?.schedulerDbPath ?? join(workRoot, 'schedules.db'),
  });
  // D-V2I-2 (DES-017): re-derive nextFire for every persisted cron/once schedule from THIS boot's
  // clock before the driver's first tick — matches DES-017's own "Boot re-arm from persistence".
  scheduler.rearmAtBoot();
  // v2 (DES-019/TASK-021): asset store rooted under workRoot; `selfBind` (this server's own
  // address) is assigned once the real listening port is known, just below.
  let assetSync: AssetSyncService;
  // D-V2I-2 (DES-017): the impure driver loop — every tick, pure `tick()` decides which persisted
  // cron/once schedules are due; each due firing starts a run via the SAME RunManager.start() path
  // as workflow_run/workflow_trigger (DES-016's "same run path" invariant), then the outcome is
  // recorded back onto the schedule (auto-complete for `once`, fresh nextFire for `cron`).
  const ticker: Ticker = new RealTicker(500);
  ticker.start(() => {
    const due = tick(scheduler.all(), clock.now());
    for (const firing of due) {
      runManager
        .start({ name: firing.workflow, args: firing.args, startedBy: { type: 'schedule', id: firing.workflow } })
        .then((runId) => scheduler.markFired(firing, runId))
        .catch((err: unknown) => {
          // DES-118: a failed dispatch (e.g. the catalog entry was deleted after the schedule was
          // created) gets a writer — `markFailed` advances/disables the schedule exactly like a
          // successful `markFired` would, and records `lastError` so `schedule_list` shows the
          // failure instead of silence. Without this the schedule stays "due" and re-fires at the
          // 500ms driver-tick cadence forever.
          const code = err instanceof Error && 'code' in err ? String((err as { code: unknown }).code) : 'DISPATCH_FAILED';
          scheduler.markFailed(firing, code);
          // eslint-disable-next-line no-console
          console.error(`[remote-workflow-engine] scheduled firing ${firing.id} failed to start:`, err);
        });
    }
  });

  // gcTimer declared here; sweep block follows after authTokenStore init (MED-2 v16: gcExpired wired).
  let gcTimer: ReturnType<typeof setInterval> | undefined;

  // v15 (REQ-012/086, DES-095, TASK-086): auth AS — token-store + route handlers.
  // When auth disabled/absent, pre-v15 open behavior is preserved byte-for-byte.
  const authCfg = config?.auth?.enabled ? config.auth : undefined;
  const authTokenStore = authCfg
    ? new TokenStore(new Database(join(workRoot, 'auth-tokens.db')), {
        clock: () => clock.now(),
        csprng: (n: number) => randomBytes(n),
      })
    : undefined;
  const authHandlers = authCfg && authTokenStore
    ? createAuthRouteHandlers(authCfg, authTokenStore)
    : undefined;

  // REQ-026 (v2, v16): periodic maintenance sweep — workspace GC (when TTL set) + auth-table GC
  // (when auth enabled, MED-2 v16). Created when workspaceTtlMs>0 OR auth enabled; capped hourly.
  const _gcTtl = config?.workspaceTtlMs ?? 0;
  if (_gcTtl > 0 || authCfg) {
    const sweep = (): void => {
      // MED-2 (v16): prune expired auth rows — runs iff auth wired, never throws into scheduler
      if (authTokenStore) {
        try { authTokenStore.gcExpired(); } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[remote-workflow-engine] gcExpired error (non-fatal):', e);
        }
      }
      // Workspace reclaim — only when a TTL is configured
      if (_gcTtl > 0) {
        store
          .listRuns()
          .then((runs) => {
            const statusByRun = new Map(runs.map((r) => [r.runId, r.status]));
            reclaimStaleWorkspaces(workRoot, _gcTtl, (id) => statusByRun.get(id) ?? null, Date.now()); // det:allow — GC sweep, not a workflow decision
          })
          .catch(() => {
            /* a sweep error must never crash the server — retry next interval */
          });
      }
    };
    const _intervalMs = _gcTtl > 0 ? Math.min(_gcTtl, 60 * 60 * 1000) : 60 * 60 * 1000;
    gcTimer = setInterval(sweep, _intervalMs); // sweep at most hourly
    gcTimer.unref?.();
  }

  // v8 Defer B (REQ-056): the real listening port is known only after listen(); the handler closure
  // reads it via this mutable, assigned below. 0 until then (no request is served before listen).
  let boundPort = 0;
  const http = createHttpServer((req, res) => {
    // v11 Sprint 2 (REQ-068, TASK-062/DES-059): GitHub tag webhook — Host-EXEMPT (HMAC is this route's
    // auth; a forwarded delivery carries a public Host, which the REQ-056 allowlist would refuse).
    // This branch runs BEFORE the Host/Origin gate and fully owns the path (always returns here).
    if (req.method === 'POST' && req.url === '/github/webhook') {
      readBodyBuffer(req, MAX_BODY_BYTES).then((rawBody) => {
        const verdict = verifyTagWebhook({
          event: (req.headers['x-github-event'] as string | undefined) ?? '',
          signatureHeader: req.headers['x-hub-signature-256'] as string | undefined,
          deliveryId: req.headers['x-github-delivery'] as string | undefined,
          rawBody,
        }, {
          secret: githubWebhookSecret,
          tagPattern: GITHUB_TAG_PATTERN,
        });
        if (!verdict.arm) {
          sendJson(res, verdict.httpStatus, verdict.code
            ? { code: verdict.code, reason: verdict.reason }
            : { reason: verdict.reason });
          return;
        }
        // Armed: verify the feature is configured (flag path must exist).
        const flagPath = config?.updateFlagPath;
        if (!flagPath || !selfUpdateDb) {
          sendJson(res, 503, { code: 'UPDATE_WEBHOOK_UNCONFIGURED', reason: 'flag path not configured' });
          return;
        }
        // DES-059 ordering: dedup → pending-upsert → flag-write → 202.
        if (selfUpdateDb.isDuplicate(verdict.deliveryId)) {
          sendJson(res, 200, { replayed: true });
          return;
        }
        selfUpdateDb.upsertPending(verdict.tag);
        writeUpdateFlag(verdict.tag, flagPath);
        sendJson(res, 202, { tag: verdict.tag });
      }).catch(() => {
        sendJson(res, 500, { error: 'Internal error reading webhook body' });
      });
      return;
    }
    // v8 Defer B (REQ-056): Host/Origin allowlist — DNS-rebinding + CSRF defense. The Host check
    // (the DNS-rebinding guard) applies to EVERY route. The Origin/CSRF check applies to browser-facing
    // routes (/dashboard, /api/*, /hooks/*) but is EXEMPTED for the /mcp JSON-RPC endpoint (issue #14):
    // MCP Streamable-HTTP clients (Claude Code, per spec) send an Origin identifying the client APP
    // (e.g. `app://claude`, `https://claude.ai`), never a loopback URL, so a uniform Origin floor 403s
    // the very clients /mcp exists to serve — degrading them into an "auth-required" state. Host is the
    // real rebind guard for this non-form JSON-RPC route; the CSRF concern (a drive-by browser form POST
    // from an attacker page) does not apply to a JSON body endpoint. An ABSENT Origin is always allowed.
    const isMcpRoute = (req.url ?? '').split('?')[0] === '/mcp';
    const originOk = isMcpRoute || isAllowedOrigin(req.headers.origin, bind, boundPort, config?.allowedHosts);
    if (!isAllowedHost(req.headers.host, bind, boundPort, config?.allowedHosts) || !originOk) {
      sendJson(res, 403, { error: 'Forbidden: Host/Origin not allowlisted' });
      return;
    }
    // v15 (DES-097, TASK-088): D-BIND loopback-peer exemption. When the server is bound to a
    // non-loopback address (0.0.0.0 or a LAN IP) AND auth is enabled, loopback socket peers
    // (127/8, ::1, ::ffff:127.x) are exempt from the auth gate — preserving the local-admin /
    // self-update rescue path. Loopback-bound servers are excluded (no non-loopback peers possible).
    // Tunnel/forwarded headers → NEVER exempt (D-AUTH-3 cloudflared-on-loopback hole).
    const dbindExempt = isLoopbackPeer(req.socket?.remoteAddress, req.headers) && !isLoopback(bind);
    // v15 (DES-095, TASK-086): OAuth AS routes — public (no bearer required), only when auth enabled.
    // effectiveIssuer replaces port 0 with the real bound port (issuer placeholder at startup).
    if (authHandlers) {
      const effectiveIssuer = (): string => {
        const raw = authCfg?.issuer ?? `http://${bind}:${boundPort}`;
        try {
          const u = new URL(raw);
          if (u.port === '0') u.port = String(boundPort);
          return u.toString().replace(/\/$/, '');
        } catch {
          return raw.replace(/\/$/, '');
        }
      };
      const wwwChallenge = (): string => wwwAuthenticateHeader({ issuer: effectiveIssuer() });
      const send401 = (): void => {
        const wwa = wwwChallenge();
        res.writeHead(401, { 'WWW-Authenticate': wwa, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
      };
      if (req.method === 'GET' && req.url === '/.well-known/oauth-protected-resource') {
        authHandlers.wellKnownProtectedResource(res, effectiveIssuer());
        return;
      }
      if (req.method === 'GET' && req.url === '/.well-known/oauth-authorization-server') {
        authHandlers.wellKnownAuthServer(res, effectiveIssuer());
        return;
      }
      if (req.method === 'GET' && (req.url === '/authorize' || req.url?.startsWith('/authorize?'))) {
        authHandlers.authorize(req, res, effectiveIssuer());
        return;
      }
      if (req.method === 'GET' && req.url?.startsWith('/oauth/google/callback')) {
        authHandlers.googleCallback(req, res, effectiveIssuer()).catch(() => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'OAuth callback error' }));
        });
        return;
      }
      if (req.method === 'POST' && (req.url === '/token' || req.url?.startsWith('/token?'))) {
        authHandlers.tokenExchange(req, res).catch(() => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'token exchange error' }));
        });
        return;
      }
      if (req.method === 'POST' && (req.url === '/register' || req.url?.startsWith('/register?'))) {
        authHandlers.register(req, res).catch(() => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'registration error' }));
        });
        return;
      }
      // Auth gate for blob upload (DES-096: resolve-once before putBlobStream consumes req)
      const blobMatchAuth = req.method === 'POST' ? /^\/assets\/blob\/([^/?]+)/.exec(req.url ?? '') : null;
      if (!dbindExempt && blobMatchAuth) {
        void resolvePrincipal(req, authTokenStore!, wwwChallenge()).then((p) => {
          if ('status' in p) { send401(); return; }
          const sha = decodeURIComponent(blobMatchAuth[1]!);
          // DES-096: principal is the namespace for authenticated uploads (server-derived, not echoed from client).
          const ns = p.principal;
          if (!isValidSha256Hex(sha)) {
            sendJson(res, 400, { code: 'INVALID_BLOB_REQUEST', message: 'invalid sha256 hex' });
            return;
          }
          cas.putBlobStream(ns, sha, req, { maxBytes: blobMaxBytes, readTimeoutMs: 120_000 }).then((r) => {
            sendJson(res, 200, { sha256: r.sha256, bytes: r.bytes, namespace: ns });
          }).catch((err: unknown) => {
            const code = (err as { code?: string }).code ?? 'BLOB_ERROR';
            const msg = (err as { message?: string }).message ?? String(err);
            if (code === 'BLOB_TOO_LARGE') { sendJson(res, 413, { code, message: msg }); return; }
            if (code === 'BLOB_UPLOAD_TIMEOUT') { sendJson(res, 408, { code, message: msg }); return; }
            if (code === 'BLOB_SHA_MISMATCH') { sendJson(res, 409, { code, message: msg }); return; }
            sendJson(res, 500, { code, message: msg });
          });
        });
        return;
      }
      // Auth gate for manifest upload (DES-096: resolve-once before body read)
      if (!dbindExempt && req.method === 'POST' && req.url?.startsWith('/assets/manifest')) {
        void resolvePrincipal(req, authTokenStore!, wwwChallenge()).then(async (p) => {
          if ('status' in p) { send401(); return; }
          // DES-096: principal is the namespace for authenticated manifest uploads (server-derived).
          const ns = p.principal;
          if (!cas) {
            sendJson(res, 400, { code: 'INVALID_BLOB_REQUEST', message: 'CAS not configured' });
            return;
          }
          const rawBytes = await readBodyBuffer(req, blobMaxBytes).catch((err: unknown) => {
            if (err instanceof BodyTooLargeError) sendJson(res, 413, { error: err.message, code: err.code });
            else sendJson(res, 500, { error: 'manifest register error' });
            return null;
          });
          if (rawBytes === null) return;
          let parsed: unknown;
          try { parsed = JSON.parse(rawBytes.toString('utf8')); } catch {
            sendJson(res, 400, { code: 'INVALID_SEED_SPEC', message: 'manifest body is not valid JSON' });
            return;
          }
          if (!Array.isArray(parsed)) {
            sendJson(res, 400, { code: 'INVALID_SEED_SPEC', message: 'manifest must be a JSON array of {path, sha256, exec?}' });
            return;
          }
          const referencedShas = (parsed as Array<{ sha256?: unknown }>).map((e) => String(e.sha256 ?? ''));
          const missing = await cas.missing(ns, referencedShas);
          if (missing.length > 0) {
            sendJson(res, 409, { code: 'MISSING_BLOBS', missing, message: `${missing.length} blob(s) not found in namespace ${ns}` });
            return;
          }
          const { sha256: manifestRef } = await cas.putBlob(ns, createHash('sha256').update(rawBytes).digest('hex'), rawBytes);
          sendJson(res, 200, { seedManifestRef: manifestRef, namespace: ns });
        }).catch(() => { sendJson(res, 500, { error: 'manifest auth error' }); });
        return;
      }
      // Auth gate for /mcp (DES-096: headers-only before readBodyDecoded)
      if (!dbindExempt && req.method === 'POST' && req.url?.startsWith('/mcp')) {
        void resolvePrincipal(req, authTokenStore!, wwwChallenge()).then((p) => {
          if ('status' in p) { send401(); return; }
          return readBodyDecoded(req).then(async (raw) => {
            let rpc: JsonRpcRequest;
            try {
              rpc = JSON.parse(raw) as JsonRpcRequest;
            } catch {
              sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
              return;
            }
            try {
              if (rpc.method === 'initialize') {
                const clientProto = (rpc.params as { protocolVersion?: string } | undefined)?.protocolVersion;
                sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: clientProto ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'remote-workflow-engine', version: ENGINE_VERSION } } });
                return;
              }
              if (rpc.method === 'notifications/initialized' || rpc.method?.startsWith('notifications/')) {
                res.writeHead(202).end(); return;
              }
              if (rpc.method === 'ping') { sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, result: {} }); return; }
              if (rpc.method === 'tools/list') {
                const tools = TOOL_NAMES.map((name) => ({ name, ...TOOL_METADATA[name] }));
                sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, result: { tools } }); return;
              }
              if (rpc.method === 'tools/call') {
                const name = rpc.params?.name ?? '';
                const args = rpc.params?.arguments ?? {};
                const webhookBaseUrl = `http://${req.headers.host ?? `${bind}:${boundPort}`}`;
                const result = await callTool(facade, scheduler, continuations!, webhooks, webhookBaseUrl, cas, assetSync, mcpProbe, mcpRegistry, issueReporter, buildModelCatalog, systemInfoSampler, name, args, p.principal, !!authCfg);
                sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } }); return;
              }
              sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: `Method not found: ${rpc.method}` } });
            } catch (err) {
              sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, error: { code: -32000, message: (err as Error).message } });
            }
          }).catch((err: unknown) => {
            if (err instanceof BodyTooLargeError) {
              sendJson(res, 413, { jsonrpc: '2.0', id: null, error: { code: err.code, message: err.message, cap: err.cap, phase: err.phase, hint: err.hint } });
              return;
            }
            sendJson(res, 500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } });
          });
        }).catch(() => { sendJson(res, 500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } }); });
        return;
      }
    }
    // D-V2V-2 (REQ-008 route-back): a real browser-renderable HTML/JS dashboard page, on the SAME
    // port as /mcp and /api/runs* (one data model, two transports — now genuinely two). SPA-style
    // routing: /dashboard/<runId> serves this exact same static page; its own client JS reads the
    // runId back out of location.pathname.
    if (req.method === 'GET' && (req.url === '/dashboard' || req.url?.startsWith('/dashboard/'))) {
      // DES-061 (TASK-064): lazily re-read the update result so the dashboard shows fresh state
      // even when the engine was NOT restarted after a failed build (the "failed" lazy-read case).
      ingestUpdateResult();
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(buildDashboardHtml({ lastUpdate: lastUpdateOutcome, interruptedRuns: interruptedRuns || undefined }));
      return;
    }
    // DES-061 (TASK-064): version endpoint — reuses resolveEngineVersion() result, same value
    // exposed in the MCP initialize response's serverInfo.version.
    if (req.method === 'GET' && req.url === '/api/version') {
      sendJson(res, 200, { version: ENGINE_VERSION });
      return;
    }
    // D-V3M-2 (REQ-020 D-DOS gauge): read-only observability of the process-global agent-slot
    // semaphore — GET /api/status -> { agentSemaphore, version, lastUpdate?, interruptedRuns? }.
    // DES-061 (TASK-064): version + last-update outcome + interrupted-run call-to-action added.
    if (req.method === 'GET' && (req.url === '/api/status' || req.url?.startsWith('/api/status?'))) {
      // Lazily re-read update result so the "failed" case (no restart) is observable.
      ingestUpdateResult();
      const statusBody: Record<string, unknown> = {
        agentSemaphore: runManager.semaphoreGauge(),
        version: ENGINE_VERSION,
      };
      if (lastUpdateOutcome) statusBody['lastUpdate'] = lastUpdateOutcome;
      if (interruptedRuns > 0) statusBody['interruptedRuns'] = interruptedRuns;
      sendJson(res, 200, statusBody);
      return;
    }
    // TASK-025 (DES-018): read-only dashboard HTTP API, a distinct transport from /mcp on the
    // SAME port (no separate dashboard listener/port — one server, two transports).
    // v11 (REQ-067): /api/issues* added alongside existing /api/runs* and /api/workflows*.
    // v12 (REQ-076/077/078): /api/system and /api/models added.
    if (
      req.url?.startsWith('/api/runs') ||
      req.url?.startsWith('/api/workflows') ||
      req.url?.startsWith('/api/issues') ||
      req.url === '/api/home' || req.url?.startsWith('/api/home?') ||
      req.url?.startsWith('/api/system') ||
      req.url?.startsWith('/api/models')
    ) {
      handleDashboardRequest(req, res, store, runManager, issueReporter, facade, systemInfoSampler, buildModelCatalog, !!authCfg).catch(() => {
        sendJson(res, 200, { degraded: 'internal dashboard error' });
      });
      return;
    }
    // v8 Defer B (REQ-057): webhook ingress. POST /hooks/:id — verify (HMAC over the RAW body BEFORE
    // JSON parse, timestamp window, deliveryId dedup) then fire the PRE-BOUND workflow. Slots in before
    // the /mcp fallthrough; the 413 body cap is inherited from readBody.
    const hookMatch = req.method === 'POST' ? /^\/hooks\/([^/?]+)/.exec(req.url ?? '') : null;
    if (hookMatch) {
      const webhookId = decodeURIComponent(hookMatch[1]!);
      readBody(req).then(async (raw) => {
        let parsed: unknown = undefined;
        try { parsed = raw ? JSON.parse(raw) : undefined; } catch { parsed = raw; } // non-JSON body → pass through as text
        const out = await webhooks.deliver(webhookId, {
          signature: req.headers['x-rwe-signature'] as string | undefined,
          timestamp: req.headers['x-rwe-timestamp'] as string | undefined,
          deliveryId: req.headers['x-rwe-delivery'] as string | undefined,
          rawBody: raw, parsedBody: parsed,
        });
        if (out.ok) sendJson(res, out.httpStatus, out.replayed ? { replayed: true } : { runId: out.runId });
        else sendJson(res, out.httpStatus, { error: out.reason });
      }).catch((err: unknown) => {
        if (err instanceof BodyTooLargeError) sendJson(res, 413, { error: err.message, code: err.code, cap: err.cap, hint: err.hint });
        else sendJson(res, 500, { error: 'webhook ingress error' });
      });
      return;
    }
    // DES-086 (TASK-080, REQ-081): streaming blob ingest — POST /assets/blob/:sha?namespace=<ns>.
    // Registered AFTER the net-guard (DES-086 BE placement). Reads the request body UNDECODED
    // (BE-3: does not reuse readBodyDecoded; gzip body simply mismatches → BLOB_SHA_MISMATCH).
    const blobMatch = req.method === 'POST' ? /^\/assets\/blob\/([^/?]+)/.exec(req.url ?? '') : null;
    if (blobMatch) {
      const sha = decodeURIComponent(blobMatch[1]!);
      const ns = new URL(req.url ?? '/', `http://x`).searchParams.get('namespace') ?? '';
      if (!isValidSha256Hex(sha) || !isValidNamespace(ns)) {
        sendJson(res, 400, { code: 'INVALID_BLOB_REQUEST', message: 'invalid sha256 hex or namespace' });
        return;
      }
      const maxBytes = blobMaxBytes;
      cas.putBlobStream(ns, sha, req, { maxBytes, readTimeoutMs: 120_000 }).then((r) => {
        sendJson(res, 200, { sha256: r.sha256, bytes: r.bytes, namespace: ns });
      }).catch((err: unknown) => {
        const code = (err as { code?: string }).code ?? 'BLOB_ERROR';
        const msg = (err as { message?: string }).message ?? String(err);
        if (code === 'BLOB_TOO_LARGE') { sendJson(res, 413, { code, message: msg }); return; }
        if (code === 'BLOB_UPLOAD_TIMEOUT') { sendJson(res, 408, { code, message: msg }); return; }
        if (code === 'BLOB_SHA_MISMATCH') { sendJson(res, 409, { code, message: msg }); return; }
        sendJson(res, 500, { code, message: msg });
      });
      return;
    }
    // DES-087 (TASK-081, REQ-082): manifest register — POST /assets/manifest?namespace=<ns>.
    // Registered AFTER the net-guard (DES-087: same placement as the blob route).
    // Parses raw bytes as JSON manifest, validates referenced blobs present, stores manifest as CAS blob.
    if (req.method === 'POST' && req.url?.startsWith('/assets/manifest')) {
      const ns = new URL(req.url, `http://x`).searchParams.get('namespace') ?? '';
      if (!cas || !isValidNamespace(ns)) {
        sendJson(res, 400, { code: 'INVALID_BLOB_REQUEST', message: 'CAS not configured or invalid namespace' });
        return;
      }
      readBodyBuffer(req, blobMaxBytes).then(async (rawBytes) => {
        let parsed: unknown;
        try { parsed = JSON.parse(rawBytes.toString('utf8')); } catch {
          sendJson(res, 400, { code: 'INVALID_SEED_SPEC', message: 'manifest body is not valid JSON' });
          return;
        }
        if (!Array.isArray(parsed)) {
          sendJson(res, 400, { code: 'INVALID_SEED_SPEC', message: 'manifest must be a JSON array of {path, sha256, exec?}' });
          return;
        }
        // Validate referenced blobs are present in the namespace.
        const referencedShas = (parsed as Array<{ sha256?: unknown }>).map((e) => String(e.sha256 ?? ''));
        const missing = await cas.missing(ns, referencedShas);
        if (missing.length > 0) {
          sendJson(res, 409, { code: 'MISSING_BLOBS', missing, message: `${missing.length} blob(s) not found in namespace ${ns}` });
          return;
        }
        // Store the manifest as a CAS blob (seedManifestRef = sha256(rawBytes) — client-derivable).
        const { sha256: manifestRef } = await cas.putBlob(ns, createHash('sha256').update(rawBytes).digest('hex'), rawBytes);
        sendJson(res, 200, { seedManifestRef: manifestRef, namespace: ns });
      }).catch((err: unknown) => {
        if (err instanceof BodyTooLargeError) { sendJson(res, 413, { error: err.message, code: err.code }); return; }
        sendJson(res, 500, { error: 'manifest register error' });
      });
      return;
    }
    if (req.method !== 'POST' || !req.url?.startsWith('/mcp')) {
      sendJson(res, 404, { jsonrpc: '2.0', id: null, error: { code: -32601, message: 'Not found' } });
      return;
    }
    readBodyDecoded(req).then(async (raw) => {
      let rpc: JsonRpcRequest;
      try {
        rpc = JSON.parse(raw) as JsonRpcRequest;
      } catch {
        sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        return;
      }
      try {
        // MCP lifecycle handshake (spec-required before a compliant client will call tools).
        if (rpc.method === 'initialize') {
          const clientProto = (rpc.params as { protocolVersion?: string } | undefined)?.protocolVersion;
          sendJson(res, 200, {
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              protocolVersion: clientProto ?? '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'remote-workflow-engine', version: ENGINE_VERSION },
            },
          });
          return;
        }
        // Notifications carry no id and expect no JSON-RPC response body — just ack the POST.
        if (rpc.method === 'notifications/initialized' || rpc.method?.startsWith('notifications/')) {
          res.writeHead(202).end();
          return;
        }
        if (rpc.method === 'ping') {
          sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, result: {} });
          return;
        }
        if (rpc.method === 'tools/list') {
          const tools = TOOL_NAMES.map((name) => ({ name, ...TOOL_METADATA[name] }));
          sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, result: { tools } });
          return;
        }
        if (rpc.method === 'tools/call') {
          const name = rpc.params?.name ?? '';
          const args = rpc.params?.arguments ?? {};
          const webhookBaseUrl = `http://${req.headers.host ?? `${bind}:${boundPort}`}`;
          const result = await callTool(facade, scheduler, continuations!, webhooks, webhookBaseUrl, cas, assetSync, mcpProbe, mcpRegistry, issueReporter, buildModelCatalog, systemInfoSampler, name, args, null, !!authCfg);
          sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
          return;
        }
        sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: `Method not found: ${rpc.method}` } });
      } catch (err) {
        sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, error: { code: -32000, message: (err as Error).message } });
      }
    }).catch((err: unknown) => {
      // REQ-024/063: an over-cap body (compressed or decompressed) → a TYPED, actionable 413.
      if (err instanceof BodyTooLargeError) {
        sendJson(res, 413, { jsonrpc: '2.0', id: null, error: { code: err.code, message: err.message, cap: err.cap, phase: err.phase, hint: err.hint } });
        return;
      }
      sendJson(res, 500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } });
    });
  });

  await new Promise<void>((resolve) => {
    http.listen(config?.port ?? 0, bind, resolve);
  });
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  boundPort = port; // v8 Defer B: now the Host/Origin allowlist knows our real port
  assetSync = new AssetSyncService({
    assetRoot: config?.assetRoot ?? join(workRoot, 'assets'),
    selfBind: { host: bind, port },
  });

  return {
    port,
    workRoot,
    close(): Promise<void> {
      // D-V2I-2: stop the firing-engine ticker so a closed server never fires another schedule.
      ticker.stop();
      if (gcTimer) clearInterval(gcTimer); // REQ-026: stop the workspace GC sweep on shutdown
      return new Promise<void>((resolve, reject) => {
        http.close((err) => (err ? reject(err) : resolve()));
      })
        // D-V2I-6: cascade-stop an internally-constructed (or injected) LiteLLMProxyManager on
        // whichever gateway path built one — closes the v1 DEPLOY known-open orphan-subprocess
        // item for the direct-fetch/legacy gateway path too (the 'sdk' path's own proxy is already
        // reaped by main.ts's shutdown handler via composeConfig()'s returned `proxyManager`).
        .then(() => gateway?.stop?.())
        // v11 (TASK-062): close the self-update SQLite DB if it was opened.
        .then(() => { selfUpdateDb?.close(); });
    },
  };
}
