// MCP Streamable HTTP server bootstrap (DES-001 / ARCH-001 / TASK-001).
// Owns transport + tool registration only — no business logic (pure delegation to McpFacade).
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
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
import type { GatewayClient } from './gateway/client.js';
import type { LiteLLMProxyManager } from './gateway/litellm-proxy.js';
import { loadAgentDefinitions } from './agent-definitions.js';
import { SqliteSchedulerPort, type Schedule, type NewSchedule } from './scheduler.js';
import { ContinuationStore } from './continuation-store.js';
import { WebhookRegistry } from './webhook-registry.js';
import { isAllowedHost, isAllowedOrigin } from './net-guard.js';
import { tick, RealTicker, type Ticker } from './scheduler-engine.js';
import { AssetSyncService, classifyAsset, type AssetPush, type AssetKind } from './asset-sync.js';
import { classifyTransport, RealMcpProbe, type McpProbe, type McpServerConfig } from './mcp-probe.js';
import { McpRegistry, type McpKind } from './mcp-registry.js';
import { IssueReporter, type IssueReportInput, type IssueListFilter } from './github/issue-reporter.js';
import { loadSecretSourceFromEnv } from './secret-source.js';
import { buildCatalog, filterCatalog, type ModelEntry, type CatalogFilter } from './models/model-catalog.js';

// Single source for the engine version reported over MCP (serverInfo) and stamped into filed issues.
const ENGINE_VERSION = '1.0.0';
import { buildDashboardModel, buildDagModel } from './dashboard.js';
import { DASHBOARD_HTML } from './dashboard-page.js';
import type { RunStore } from './run-store.js';

export interface ServerConfig {
  bind?: string;   // default '127.0.0.1'
  port?: number;
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
  continuationDbPath?: string;
  // v8 Defer B (REQ-057/058): override the webhook registry's on-disk path (default
  // join(workRoot,'webhooks.db')), same convention as schedulerDbPath/continuationDbPath.
  webhookDbPath?: string;
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
] as const;

type ToolName = (typeof TOOL_NAMES)[number];

interface JsonSchemaProp {
  type?: string | string[];
  description?: string;
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
const TOOL_METADATA: Record<ToolName, ToolMeta> = {
  workflow_run: {
    description: 'Starts a new workflow run from either an inline script or a previously registered workflow name, returning its runId.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of a previously registered workflow to run (mutually exclusive with script).' },
        script: { type: 'string', description: 'Inline JavaScript workflow script to run (mutually exclusive with name).' },
        args: { description: 'Arbitrary arguments passed through to the script as `args`.' },
        budget: { type: ['number', 'null'], description: 'Optional token budget ceiling for this run; null/omitted means unbounded.' },
      },
    },
  },
  workflow_status: {
    description: "Returns a run's current lifecycle status (queued/running/suspended/stopped/completed/failed) plus its phases and in-flight/completed agent records.",
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
    description: 'Resumes a suspended or stopped run, optionally with an edited script; unchanged, already-journaled calls replay from cache instead of re-invoking the gateway.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'The run to resume.' },
        script: { type: 'string', description: 'Optional replacement script; omitted continues the original script.' },
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
    description: "Returns one agent() call's captured transcript events (message/tool_call/tool_result/usage, in order) for a given run.",
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
    description: 'Registers (or updates) a named workflow script in the catalog, so it can later be run by name via workflow_run({name}).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The workflow name to register/update.' },
        script: { type: 'string', description: 'The workflow script text to save under this name.' },
      },
      required: ['name', 'script'],
    },
  },
  workflow_deregister: {
    description: 'Removes a registered workflow from the catalog by name (returns removed:false if it was not registered). Prior runs are unaffected.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'The workflow name to remove from the catalog.' } },
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
        kind: { type: 'string', description: "One of 'skill' | 'hook' | 'mcp-config'." },
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
    description: "Returns a unified, normalized cross-provider model catalog (curated aliases + live Ollama /api/tags + live OpenRouter /api/v1/models + a static openai/anthropic table). Each entry is {provider, model, alias?, description, modalities{in,out}, contextWindow, price(in/out|'free'|'unknown'), toolUse(bool|'unknown'), location('local'|'remote')}. Optional filters narrow the (potentially large) result; an unreachable live source degrades gracefully. No API key ever appears in the output.",
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
};

// REQ-024 (v1.5, DoS): cap the request body so a large/hostile body can't buffer unbounded and OOM
// the process. Default 8 MiB; a run submission carrying a seed tree or a large script stays well
// under this, and the byte-fetch path (workflow_artifact_get) is what carries large payloads OUT.
const MAX_BODY_BYTES = 8 * 1024 * 1024;

class BodyTooLargeError extends Error {
  readonly code = 'BODY_TOO_LARGE' as const;
  constructor(max: number) {
    super(`request body exceeds the ${max}-byte cap`);
    this.name = 'BodyTooLargeError';
  }
}

function readBody(req: IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let capped = false;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      if (capped) return; // already over cap — DISCARD further data (bounded memory), don't buffer
      size += chunk.length;
      if (size > maxBytes) {
        capped = true;
        reject(new BodyTooLargeError(maxBytes)); // caller sends 413; socket keeps draining (discarded)
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!capped) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
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
  assetSync: AssetSyncService,
  mcpProbe: McpProbe,
  mcpRegistry: McpRegistry,
  issueReporter: IssueReporter,
  buildModelCatalog: () => Promise<ModelEntry[]>,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name as ToolName) {
    case 'workflow_run': return facade.workflow_run(args as { name?: string; script?: string; args?: unknown; budget?: number | null; seed?: { path: string; contentB64: string }[] });
    case 'workflow_status': return facade.workflow_status(args as { runId: string });
    case 'workflow_result': return facade.workflow_result(args as { runId: string });
    case 'workflow_suspend': return facade.workflow_suspend(args as { runId: string });
    case 'workflow_resume': return facade.workflow_resume(args as { runId: string; script?: string });
    case 'workflow_stop': return facade.workflow_stop(args as { runId: string });
    case 'workflow_list': return facade.workflow_list();
    case 'workflow_agent_log': return facade.workflow_agent_log(args as { runId: string; agentId: string });
    case 'workflow_register': return facade.workflow_register(args as { name: string; script: string });
    case 'workflow_deregister': return facade.workflow_deregister(args as { name: string });
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
    // is reflected), then AND-filter it. Never throws across the tool boundary — an unreachable live
    // source degrades to fewer entries, and an empty match returns [].
    case 'models_list': {
      const entries = await buildModelCatalog();
      return { result: filterCatalog(entries, args as CatalogFilter) };
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
): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Dashboard API is read-only: only GET is supported.' });
    return;
  }
  const path = (req.url ?? '').split('?')[0]!;
  const agentMatch = /^\/api\/runs\/([^/]+)\/agents\/([^/]+)$/.exec(path);
  const dagMatch = /^\/api\/runs\/([^/]+)\/dag$/.exec(path);
  const runMatch = /^\/api\/runs\/([^/]+)$/.exec(path);
  try {
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
    // v8 Slice 3 (REQ-048/049): the reconstructed call tree (DAG) for one run.
    if (dagMatch) {
      const [, runId] = dagMatch as unknown as [string, string];
      const stored = await store.getRun(runId);
      if (!stored) { sendJson(res, 404, { error: `Run not found: ${runId}` }); return; }
      const view = await runManager.status(runId).catch(() => stored);
      sendJson(res, 200, buildDagModel(view));
      return;
    }
    if (agentMatch) {
      const [, runId, agentId] = agentMatch as unknown as [string, string, string];
      const stored = await store.getRun(runId);
      if (!stored) { sendJson(res, 404, { error: `Run not found: ${runId}` }); return; }
      const view = await runManager.status(runId).catch(() => stored);
      if (!view.agents.some((a) => a.agentId === agentId)) {
        sendJson(res, 404, { error: `Agent not found: ${agentId}` });
        return;
      }
      const transcript = await store.getTranscript(runId, agentId);
      sendJson(res, 200, buildDashboardModel([], view, transcript).transcript);
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
  const store = new SqliteRunStore(join(workRoot, 'store'), clock);
  await store.hydrateAll(); // boot recovery: re-classify any stale 'running' rows as 'failed'
  const catalog = new WorkflowCatalog(workRoot, clock);
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
  let continuations: ContinuationStore | undefined;
  const runManager = new RunManager({ store, clock, catalog, workRoot, gateway, agentTypes, semaphore: agentSemaphore, maxWorkflowDepth: config?.maxWorkflowDepth, maxWorkflowDescendants: config?.maxWorkflowDescendants, maxConcurrentRuns: config?.maxConcurrentRuns, onTerminal: (runId, status) => { void continuations?.onTerminal(runId, status); } });
  // v8 Slice 4 (REQ-053): SQLite-persisted on-completion chaining, same workRoot convention as
  // schedules.db; rearmAtBoot reconciles any continuation whose target terminated while down.
  continuations = new ContinuationStore({ clock, runManager, store, dbPath: config?.continuationDbPath ?? join(workRoot, 'continuations.db') });
  void continuations.rearmAtBoot();
  // v8 Defer B (REQ-057/058): durable webhook ingress registry, same workRoot convention.
  const webhooks = new WebhookRegistry({ clock, runManager, catalog, dbPath: config?.webhookDbPath ?? join(workRoot, 'webhooks.db') });
  // v3 (DES-020/TASK-026): defaults to a real network/spawn probe; tests inject a FakeMcpProbe.
  // Constructed here (moved up from its old asset_push-only spot) so the v3 MCP Provisioning
  // Registry below can reuse the SAME injected probe seam (DES-024's "provision-time McpProbe
  // wiring" — no second, undertested probe port).
  const mcpProbe: McpProbe = config?.mcpProbe ?? new RealMcpProbe();
  // v3 (DES-024/TASK-028/TASK-029): SQLite sibling catalog, same workRoot convention as
  // catalog.db/store/schedules.db — survives restart. Referenced by the submission validator
  // below (fail-fast on an unprovisioned `mcp` name) and by the mcp_provision admin tool.
  const mcpRegistry = new McpRegistry({ dbPath: join(workRoot, 'mcp-registry.db'), probe: mcpProbe });
  const validator = new SubmissionValidator({ catalog, aliases: config?.aliases, mcpRegistry });
  const facade = new McpFacade({ clock, store, runManager, validator });
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
        const events = Array.isArray(logEnv.result) ? logEnv.result : [];
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
        .start({ name: firing.workflow, args: firing.args })
        .then((runId) => scheduler.markFired(firing, runId))
        .catch((err: unknown) => {
          // A failed dispatch (e.g. the catalog entry was deleted after the schedule was created)
          // must not wedge this schedule as permanently "due" — a bare console.error surfaces it
          // without crashing the driver loop; targeted follow-up dispatch-failure handling is a
          // documented v3 boundary (mirrors runManager.start's own existing error surface).
          // eslint-disable-next-line no-console
          console.error(`[remote-workflow-engine] scheduled firing ${firing.id} failed to start:`, err);
        });
    }
  });

  // REQ-026 (v2): opt-in periodic run-workspace GC (only when a retention TTL is configured).
  let gcTimer: ReturnType<typeof setInterval> | undefined;
  if (config?.workspaceTtlMs && config.workspaceTtlMs > 0) {
    const ttl = config.workspaceTtlMs;
    const sweep = (): void => {
      store
        .listRuns()
        .then((runs) => {
          const statusByRun = new Map(runs.map((r) => [r.runId, r.status]));
          reclaimStaleWorkspaces(workRoot, ttl, (id) => statusByRun.get(id) ?? null, Date.now()); // det:allow — GC sweep, not a workflow decision
        })
        .catch(() => {
          /* a sweep error must never crash the server — retry next interval */
        });
    };
    gcTimer = setInterval(sweep, Math.min(ttl, 60 * 60 * 1000)); // sweep at most hourly
    gcTimer.unref?.();
  }

  // v8 Defer B (REQ-056): the real listening port is known only after listen(); the handler closure
  // reads it via this mutable, assigned below. 0 until then (no request is served before listen).
  let boundPort = 0;
  const http = createHttpServer((req, res) => {
    // v8 Defer B (REQ-056): Host/Origin allowlist — DNS-rebinding + CSRF defense, uniform across every
    // route (/mcp, /api/*, /dashboard, /hooks/*). A foreign Host (rebinding) or a present-but-foreign
    // Origin (drive-by browser CSRF) is refused 403; an ABSENT Origin is allowed (programmatic clients
    // send none — fail-open). This is the interim access control until OIDC (REQ-012, D5).
    if (!isAllowedHost(req.headers.host, bind, boundPort) || !isAllowedOrigin(req.headers.origin, bind, boundPort)) {
      sendJson(res, 403, { error: 'Forbidden: Host/Origin not allowlisted' });
      return;
    }
    // D-V2V-2 (REQ-008 route-back): a real browser-renderable HTML/JS dashboard page, on the SAME
    // port as /mcp and /api/runs* (one data model, two transports — now genuinely two). SPA-style
    // routing: /dashboard/<runId> serves this exact same static page; its own client JS reads the
    // runId back out of location.pathname.
    if (req.method === 'GET' && (req.url === '/dashboard' || req.url?.startsWith('/dashboard/'))) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(DASHBOARD_HTML);
      return;
    }
    // D-V3M-2 (REQ-020 D-DOS gauge): read-only observability of the process-global agent-slot
    // semaphore — GET /api/status -> { agentSemaphore: { total, inUse, queued } }. inUse rises with
    // concurrent SDK-CLI dispatches and returns to baseline (0) once they settle.
    if (req.method === 'GET' && (req.url === '/api/status' || req.url?.startsWith('/api/status?'))) {
      sendJson(res, 200, { agentSemaphore: runManager.semaphoreGauge() });
      return;
    }
    // TASK-025 (DES-018): read-only dashboard HTTP API, a distinct transport from /mcp on the
    // SAME port (no separate dashboard listener/port — one server, two transports).
    if (req.url?.startsWith('/api/runs') || req.url?.startsWith('/api/workflows')) {
      handleDashboardRequest(req, res, store, runManager).catch(() => {
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
        if (err instanceof BodyTooLargeError) sendJson(res, 413, { error: err.message });
        else sendJson(res, 500, { error: 'webhook ingress error' });
      });
      return;
    }
    if (req.method !== 'POST' || !req.url?.startsWith('/mcp')) {
      sendJson(res, 404, { jsonrpc: '2.0', id: null, error: { code: -32601, message: 'Not found' } });
      return;
    }
    readBody(req).then(async (raw) => {
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
          const result = await callTool(facade, scheduler, continuations!, webhooks, webhookBaseUrl, assetSync, mcpProbe, mcpRegistry, issueReporter, buildModelCatalog, name, args);
          sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
          return;
        }
        sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: `Method not found: ${rpc.method}` } });
      } catch (err) {
        sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, error: { code: -32000, message: (err as Error).message } });
      }
    }).catch((err: unknown) => {
      // REQ-024: an over-cap request body rejects readBody -> 413, not a 500/OOM.
      if (err instanceof BodyTooLargeError) {
        sendJson(res, 413, { jsonrpc: '2.0', id: null, error: { code: -32001, message: err.message } });
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
        .then(() => gateway?.stop?.());
    },
  };
}
