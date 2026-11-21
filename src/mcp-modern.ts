// MCP revision 2026-07-28 (the stateless revision) on the engine's own /mcp endpoint.
//
// The engine is a dual-era server (spec, basic/versioning: "A dual-era server MAY serve both eras
// concurrently on the same endpoint"): a client that opens with `initialize` is served as before,
// and a client that puts its protocol version on every request (`params._meta`) is served by the
// rules in this file. Nothing here keeps state between requests.
//
// What the modern era adds on top of tools:
//  - `server/discover` (MUST), per-request version and header validation, `resultType` on results.
//  - the tasks extension (`io.modelcontextprotocol/tasks`) for `run_start`: the run is the task,
//    its id is the run id, `tasks/get` reads it, `tasks/cancel` stops it.
//  - `subscriptions/listen` for task status: the server pushes `notifications/tasks` when a run
//    ends, so a client no longer has to poll `run_status`.
//
// Pure helpers only; the HTTP wiring is in server.ts.

import type { IncomingHttpHeaders } from 'node:http';

export const MODERN_PROTOCOL_VERSION = '2026-07-28';
export const MODERN_PROTOCOL_VERSIONS: readonly string[] = [MODERN_PROTOCOL_VERSION];
/** Handshake-era revisions this server answers `initialize` for; the first is offered to a client asking for anything else. */
export const LEGACY_PROTOCOL_VERSIONS: readonly string[] = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion';
export const META_CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
export const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';
export const META_SUBSCRIPTION_ID = 'io.modelcontextprotocol/subscriptionId';
export const TASKS_EXTENSION = 'io.modelcontextprotocol/tasks';
/** Vendor `_meta` key on a `run_start` call: "answer with a task, not with the run id envelope". */
export const META_RUN_AS_TASK = 'com.remote-workflow-engine/runAsTask';
/** Vendor `_meta` key on a finished task's result: the run_status view (timings per call). */
export const META_RUN_STATUS = 'com.remote-workflow-engine/runStatus';

export const ERR_HEADER_MISMATCH = -32020;
export const ERR_MISSING_CLIENT_CAPABILITY = -32021;
export const ERR_UNSUPPORTED_PROTOCOL_VERSION = -32022;
export const ERR_METHOD_NOT_FOUND = -32601;
export const ERR_INVALID_PARAMS = -32602;

export interface McpRpc {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

export interface McpRefusal {
  status: number;
  error: { code: number; message: string; data?: unknown };
}

function record(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

export function metaOf(rpc: McpRpc): Record<string, unknown> {
  return record(record(rpc.params)?.['_meta']) ?? {};
}

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Modern era = the request says so itself: a protocol version in `_meta`, or the modern version in
 * the `MCP-Protocol-Version` header. A handshake-era client sends that header too, but with a
 * handshake-era version, and never sends the `_meta` key, so it is never mistaken for modern.
 */
export function isModernRequest(headers: IncomingHttpHeaders, rpc: McpRpc): boolean {
  if (rpc.method === 'initialize') return false;
  if (typeof metaOf(rpc)[META_PROTOCOL_VERSION] === 'string') return true;
  const h = header(headers, 'mcp-protocol-version');
  return h !== undefined && MODERN_PROTOCOL_VERSIONS.includes(h.trim());
}

const B64_HEADER = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/;

/** `=?base64?...?=` header values carry non-ASCII or sentinel-looking text; anything else is literal. */
export function decodeHeaderValue(value: string): string {
  const m = B64_HEADER.exec(value);
  if (!m) return value;
  return Buffer.from(m[1] ?? '', 'base64').toString('utf8');
}

/** Which body value the `Mcp-Name` header mirrors, per method; undefined = the header is not required. */
export function nameForHeader(rpc: McpRpc): string | undefined {
  const p = record(rpc.params) ?? {};
  switch (rpc.method) {
    case 'tools/call':
    case 'prompts/get':
      return typeof p['name'] === 'string' ? p['name'] : '';
    case 'resources/read':
      return typeof p['uri'] === 'string' ? p['uri'] : '';
    case 'tasks/get':
    case 'tasks/update':
    case 'tasks/cancel':
      return typeof p['taskId'] === 'string' ? p['taskId'] : '';
    default:
      return undefined;
  }
}

/** The checks every modern request passes before it is dispatched. `null` = fine. */
export function validateModernRequest(headers: IncomingHttpHeaders, rpc: McpRpc): McpRefusal | null {
  const requested = metaOf(rpc)[META_PROTOCOL_VERSION];
  const headerVersion = header(headers, 'mcp-protocol-version')?.trim();
  const version = typeof requested === 'string' ? requested : headerVersion;
  if (version === undefined || !MODERN_PROTOCOL_VERSIONS.includes(version)) {
    return {
      status: 400,
      error: {
        code: ERR_UNSUPPORTED_PROTOCOL_VERSION,
        message: 'Unsupported protocol version',
        data: { supported: [...MODERN_PROTOCOL_VERSIONS, ...LEGACY_PROTOCOL_VERSIONS], requested: version ?? null },
      },
    };
  }
  const mismatch = (message: string): McpRefusal => ({ status: 400, error: { code: ERR_HEADER_MISMATCH, message: `Header mismatch: ${message}` } });
  if (typeof requested !== 'string') return mismatch(`_meta["${META_PROTOCOL_VERSION}"] is missing from the request body`);
  if (headerVersion === undefined) return mismatch('MCP-Protocol-Version header is missing');
  if (headerVersion !== requested) return mismatch(`MCP-Protocol-Version header value '${headerVersion}' does not match body value '${requested}'`);
  const method = typeof rpc.method === 'string' ? rpc.method : '';
  const headerMethod = header(headers, 'mcp-method')?.trim();
  if (headerMethod === undefined) return mismatch('Mcp-Method header is missing');
  if (headerMethod !== method) return mismatch(`Mcp-Method header value '${headerMethod}' does not match body value '${method}'`);
  const expectedName = nameForHeader(rpc);
  if (expectedName !== undefined) {
    const raw = header(headers, 'mcp-name');
    if (raw === undefined) return mismatch('Mcp-Name header is missing');
    const got = decodeHeaderValue(raw.trim());
    if (got !== expectedName) return mismatch(`Mcp-Name header value '${got}' does not match body value '${expectedName}'`);
  }
  return null;
}

/** `initialize` (handshake era): echo a revision this server knows, else offer its newest handshake-era one. */
export function negotiateLegacyVersion(clientVersion: unknown): string {
  if (typeof clientVersion === 'string' && LEGACY_PROTOCOL_VERSIONS.includes(clientVersion)) return clientVersion;
  // Kept from before this change: a client that names no version at all gets 2025-06-18.
  if (clientVersion === undefined) return '2025-06-18';
  return LEGACY_PROTOCOL_VERSIONS[0]!;
}

export interface ServerInfo {
  name: string;
  version: string;
}

/** Every modern result carries `resultType` and SHOULD carry the server info. */
export function completeResult(result: Record<string, unknown>, serverInfo: ServerInfo): Record<string, unknown> {
  const meta = record(result['_meta']) ?? {};
  return { resultType: 'complete', ...result, _meta: { ...meta, [META_SERVER_INFO]: serverInfo } };
}

export const MODERN_CAPABILITIES = { tools: {}, extensions: { [TASKS_EXTENSION]: {} } } as const;

export function discoverResult(instructions: string): Record<string, unknown> {
  return {
    supportedVersions: [...MODERN_PROTOCOL_VERSIONS],
    capabilities: MODERN_CAPABILITIES,
    instructions,
    // The instructions depend on who is asking (a pending account is told so), so the answer is
    // cacheable only inside one authorization context.
    ttlMs: 300_000,
    cacheScope: 'private',
  };
}

/** The tool list is the same projection for every caller. */
export const TOOLS_LIST_CACHE = { ttlMs: 300_000, cacheScope: 'public' } as const;

export function clientDeclaresTasks(rpc: McpRpc): boolean {
  const caps = record(metaOf(rpc)[META_CLIENT_CAPABILITIES]);
  const ext = record(caps?.['extensions']);
  return ext !== undefined && record(ext[TASKS_EXTENSION]) !== undefined;
}

export function missingTasksCapability(): McpRefusal {
  return {
    status: 400,
    error: {
      code: ERR_MISSING_CLIENT_CAPABILITY,
      message: 'Missing required client capability',
      data: { requiredCapabilities: { extensions: { [TASKS_EXTENSION]: {} } } },
    },
  };
}

/** A `run_start` call is answered with a task only when the client both can handle one and asked for it. */
export function wantsRunAsTask(rpc: McpRpc): boolean {
  return clientDeclaresTasks(rpc) && metaOf(rpc)[META_RUN_AS_TASK] === true;
}

export type TaskStatus = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';

/** Engine run status -> task status. A failed run is a COMPLETED task whose tool result says isError: `failed` is for JSON-RPC errors only. */
export function taskStatusOf(runStatus: unknown): TaskStatus {
  if (runStatus === 'completed' || runStatus === 'failed') return 'completed';
  if (runStatus === 'stopped') return 'cancelled';
  return 'working';
}

export function isTerminalTask(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export const TASK_POLL_INTERVAL_MS = 500;

export interface TaskView {
  taskId: string;
  status: TaskStatus;
  statusMessage?: string;
  createdAt: string;
  lastUpdatedAt: string;
  ttlMs: number | null;
  pollIntervalMs: number;
  result?: Record<string, unknown>;
}

/** The run_status view fields a task is built from. */
export interface RunStatusLike {
  status?: unknown;
  terminalAt?: unknown;
  phases?: unknown;
  agents?: unknown;
}

function earliestTimestamp(view: RunStatusLike): string | undefined {
  let first: number | undefined;
  const see = (v: unknown): void => {
    const t = Date.parse(String(v));
    if (!Number.isNaN(t) && (first === undefined || t < first)) first = t;
  };
  for (const p of Array.isArray(view.phases) ? view.phases : []) see(record(p)?.['ts']);
  for (const a of Array.isArray(view.agents) ? view.agents : []) see(record(a)?.['startedAt']);
  return first === undefined ? undefined : new Date(first).toISOString();
}

/**
 * The task for a run. `runResult` is the run_result tool's envelope and is only given for a run
 * that ended as completed or failed; it becomes the task's `result`, in the same shape a plain
 * `tools/call` result has, so a client reads a finished task exactly like a tool answer.
 */
export function taskOfRun(taskId: string, view: RunStatusLike, now: Date, runResult?: unknown): TaskView {
  const status = taskStatusOf(view.status);
  const terminalAt = typeof view.terminalAt === 'string' && !Number.isNaN(Date.parse(view.terminalAt)) ? view.terminalAt : undefined;
  const nowIso = now.toISOString();
  const task: TaskView = {
    taskId,
    status,
    createdAt: earliestTimestamp(view) ?? terminalAt ?? nowIso,
    lastUpdatedAt: terminalAt ?? nowIso,
    ttlMs: null,
    pollIntervalMs: TASK_POLL_INTERVAL_MS,
  };
  if (view.status === 'failed') task.statusMessage = 'the run failed; see the result';
  if (view.status === 'stopped') task.statusMessage = 'the run was stopped';
  if (status === 'completed' && runResult !== undefined) {
    task.result = {
      resultType: 'complete',
      content: [{ type: 'text', text: JSON.stringify(runResult) }],
      ...(view.status === 'failed' ? { isError: true } : {}),
      _meta: { [META_RUN_STATUS]: view },
    };
  }
  return task;
}

/** One Server-Sent Event carrying one JSON-RPC message. */
export function sseEvent(message: unknown): string {
  return `event: message\ndata: ${JSON.stringify(message)}\n\n`;
}

export const SSE_KEEPALIVE = ':\r\n\r\n';

/** The task ids a `subscriptions/listen` request asks to hear about (deduplicated, capped). */
export function requestedTaskIds(rpc: McpRpc, cap = 32): string[] {
  const n = record(record(rpc.params)?.['notifications']);
  const ids = Array.isArray(n?.['taskIds']) ? (n['taskIds'] as unknown[]) : [];
  return [...new Set(ids.filter((x): x is string => typeof x === 'string' && x !== ''))].slice(0, cap);
}
