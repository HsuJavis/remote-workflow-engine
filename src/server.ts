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
  // D-F2: a directory of `agents/*.md` frontmatter files (compat-spec §5) loaded ONCE at startup
  // into the agentType registry AgentExecutor resolves opts.agentType against. Omitted -> empty
  // registry (every agentType is "unknown", same as before this field existed).
  agentDefinitionsDir?: string;
  // D-F1: additive composition-root override — lets a caller (e.g. the product entrypoint,
  // src/main.ts) supply a fully custom GatewayClient (e.g. a real
  // ClaudeAgentSdkGatewayClient session) instead of the aliases-driven LiteLLMGatewayClient built
  // below. No existing caller sets this, so it changes nothing unless explicitly used.
  gateway?: GatewayClient;
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
  'workflow_artifacts',
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
  workflow_artifacts: {
    description: "Lists the relative file names present in a run's on-disk workspace.",
    inputSchema: { type: 'object', properties: { runId: { type: 'string', description: 'The run whose workspace files to list.' } }, required: ['runId'] },
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

/** Dispatches a tools/call to the matching McpFacade method (pure delegation, DES-001). */
async function callTool(facade: McpFacade, name: string, args: Record<string, unknown>): Promise<unknown> {
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
    case 'workflow_artifacts': return facade.workflow_artifacts(args as { runId: string });
    default: throw new Error(`Unknown tool: ${name}`);
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
        })
      : undefined);
  // D-F2: agentType composition-root loader — populated ONCE at startup from agents/*.md frontmatter.
  const agentTypes = config?.agentDefinitionsDir ? loadAgentDefinitions(config.agentDefinitionsDir) : undefined;
  const runManager = new RunManager({ store, clock, catalog, workRoot, gateway, agentTypes });
  const validator = new SubmissionValidator({ catalog, aliases: config?.aliases });
  const facade = new McpFacade({ clock, store, runManager, validator });

  const http = createHttpServer((req, res) => {
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
        if (rpc.method === 'tools/list') {
          const tools = TOOL_NAMES.map((name) => ({ name, ...TOOL_METADATA[name] }));
          sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, result: { tools } });
          return;
        }
        if (rpc.method === 'tools/call') {
          const name = rpc.params?.name ?? '';
          const args = rpc.params?.arguments ?? {};
          const result = await callTool(facade, name, args);
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

  return {
    port,
    workRoot,
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        http.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
