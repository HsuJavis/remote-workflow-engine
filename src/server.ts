// MCP Streamable HTTP server bootstrap (DES-001 / ARCH-001 / TASK-001).
// Owns transport + tool registration only — no business logic (pure delegation to McpFacade).
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpFacade } from './mcp-facade.js';
import { RunManager } from './run-manager.js';
import { SubmissionValidator } from './submission-validator.js';
import { SqliteRunStore } from './store/sqlite-run-store.js';
import { WorkflowCatalog } from './workflow-catalog.js';
import { SystemClock } from './clock.js';
import { LiteLLMGatewayClient, type AliasMap } from './gateway/client.js';
import type { GatewayClient } from './gateway/client.js';
import type { LiteLLMProxyManager } from './gateway/litellm-proxy.js';
import { loadAgentDefinitions } from './agent-definitions.js';
import { SqliteSchedulerPort, type Schedule, type NewSchedule } from './scheduler.js';
import { tick, RealTicker, type Ticker } from './scheduler-engine.js';
import { AssetSyncService, type AssetPush, type AssetKind } from './asset-sync.js';
import { classifyTransport, RealMcpProbe, type McpProbe, type McpServerConfig } from './mcp-probe.js';
import { buildDashboardModel } from './dashboard.js';
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
        agentId: { type: 'string', description: 'The agentId (from workflow_status\'s agents[]) to fetch the transcript for.' },
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
    description: "Lists the relative file names present in a run's on-disk workspace.",
    inputSchema: { type: 'object', properties: { runId: { type: 'string', description: 'The run whose workspace files to list.' } }, required: ['runId'] },
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
};

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
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
  assetSync: AssetSyncService,
  mcpProbe: McpProbe,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name as ToolName) {
    case 'workflow_run': return facade.workflow_run(args as { name?: string; script?: string; args?: unknown; budget?: number | null });
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
    // v2 (DES-016/TASK-019): schedule CRUD + resident trigger — thin pass-through to SqliteSchedulerPort,
    // whose own methods already return the { result?, error? } envelope shape (see scheduler.ts).
    case 'schedule_create': return scheduler.create(args as unknown as NewSchedule);
    case 'schedule_list': return { result: await scheduler.list() };
    case 'schedule_delete': return scheduler.delete(args['id'] as string);
    case 'schedule_setEnabled': return scheduler.setEnabled(args['id'] as string, args['enabled'] as boolean);
    case 'workflow_trigger': return scheduler.trigger(args['workflow'] as string, args['args']);
    // v2 (DES-019/TASK-021): asset_push reports a path-safety violation as a tool-result `error`
    // (never a thrown JSON-RPC-level error) — DES-001's own "never throw across the tool boundary".
    case 'asset_push': {
      const push = args as unknown as AssetPush;
      // TASK-026 (DES-020): a mcp-config push is rejected BEFORE it lands whenever its transport
      // isn't server-runnable or fails the live probe — reported in `excluded[]` the same way
      // asset-sync.ts's own self-referential check is (never silent, never a half-written asset dir).
      if (push.kind === 'mcp-config') {
        const reason = await checkMcpConfigTransport(push, mcpProbe);
        if (reason !== null) return { result: { stored: [], excluded: [{ name: push.name, reason }] } };
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
  const runMatch = /^\/api\/runs\/([^/]+)$/.exec(path);
  try {
    if (path === '/api/runs') {
      const runs = await store.listRuns();
      sendJson(res, 200, buildDashboardModel(runs).runs);
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
  const runManager = new RunManager({ store, clock, catalog, workRoot, gateway, agentTypes });
  const validator = new SubmissionValidator({ catalog, aliases: config?.aliases });
  const facade = new McpFacade({ clock, store, runManager, validator });
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
  // v2 (DES-020/TASK-026): defaults to a real network/spawn probe; tests inject a FakeMcpProbe.
  const mcpProbe: McpProbe = config?.mcpProbe ?? new RealMcpProbe();
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

  const http = createHttpServer((req, res) => {
    // D-V2V-2 (REQ-008 route-back): a real browser-renderable HTML/JS dashboard page, on the SAME
    // port as /mcp and /api/runs* (one data model, two transports — now genuinely two). SPA-style
    // routing: /dashboard/<runId> serves this exact same static page; its own client JS reads the
    // runId back out of location.pathname.
    if (req.method === 'GET' && (req.url === '/dashboard' || req.url?.startsWith('/dashboard/'))) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(DASHBOARD_HTML);
      return;
    }
    // TASK-025 (DES-018): read-only dashboard HTTP API, a distinct transport from /mcp on the
    // SAME port (no separate dashboard listener/port — one server, two transports).
    if (req.url?.startsWith('/api/runs')) {
      handleDashboardRequest(req, res, store, runManager).catch(() => {
        sendJson(res, 200, { degraded: 'internal dashboard error' });
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
              serverInfo: { name: 'remote-workflow-engine', version: '1.0.0' },
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
          const result = await callTool(facade, scheduler, assetSync, mcpProbe, name, args);
          sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: JSON.stringify(result) }] } });
          return;
        }
        sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: `Method not found: ${rpc.method}` } });
      } catch (err) {
        sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, error: { code: -32000, message: (err as Error).message } });
      }
    }).catch(() => {
      sendJson(res, 500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } });
    });
  });

  await new Promise<void>((resolve) => {
    http.listen(config?.port ?? 0, bind, resolve);
  });
  const address = http.address();
  const port = typeof address === 'object' && address ? address.port : 0;
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
