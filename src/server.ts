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
import { ClaudeAgentSdkGatewayClient } from './gateway/claude-agent-sdk-client.js';
import { DEFAULT_ALIASES } from './default-aliases.js';
import type { GatewayClient } from './gateway/client.js';
import type { LiteLLMProxyManager } from './gateway/litellm-proxy.js';
import { SqliteSchedulerPort, type Schedule, type NewSchedule } from './scheduler.js';
import type { RefusalReason } from './types.js';
import { WebhookRegistry } from './webhook-registry.js';
import { CasStore, isValidSha256Hex, isValidNamespace } from './cas-store.js';
import type { SecretValueProvider } from './secret-resolver.js';
import { isAllowedHost, isAllowedOrigin, isLoopback, isLoopbackPeer } from './net-guard.js';
import { parseWorkflowSkeleton, scanAgentCalls } from './workflow-meta.js';
import { deriveExpectedGraph } from './skeleton-graph.js';
import { tick, RealTicker, type Ticker } from './scheduler-engine.js';
import { AssetSyncService, defaultAssetRoot, globalAssetRoot, migrateLegacyGlobalAssets, resolveMcp, type AssetCatalogPort, type AssetCatalogRow, type AssetKind } from './asset-sync.js';
import { RealMcpProbe, type McpProbe } from './mcp-probe.js';
import { IssueReporter, resolveEngineVersion, type IssueReportInput, type IssueListFilter, type IssuesListView } from './github/issue-reporter.js';
import { loadSecretSourceFromEnv } from './secret-source.js';
import { buildCatalog, filterCatalog, enrichModelEntry, type ModelEntry, type CatalogFilter } from './models/model-catalog.js';
import { ModelBook } from './models/model-book.js';
import { SystemInfoSampler, RealSystemProbe, UTIL_PCT_CONVENTION } from './system-info.js';
import { assertUpdatePathsOutsideWorkRoot, writeUpdateFlag, SelfUpdateDb, readUpdateResult } from './self-update.js';
import type { UpdateOutcome } from './update-types.js';
import { verifyTagWebhook } from './self-update-webhook.js';
import Database from 'better-sqlite3';
import { TokenStore } from './auth/token-store.js';
import { createAuthRouteHandlers, resolvePrincipal, type AuthConfig } from './auth/auth-service.js';
import type { Role } from './tool-specs.js';
import { wwwAuthenticateHeader } from './auth/oauth-metadata.js';
import { DEFAULT_CEILINGS, type Ceilings, type Effort } from './params/contract.js';

// REQ-066 (v11): engine version from package.json + best-effort git describe, replacing the hardcoded '1.0.0'.
const ENGINE_VERSION = resolveEngineVersion();
import { buildDashboardModel, layoutGraph, deriveLanes, buildHomeView, computeWorkflowMetrics, type ExpectedGraph } from './dashboard.js';
import { DASHBOARD_HTML, buildDashboardHtml } from './dashboard-page.js';
import { lookupStaticAsset, readStaticAsset } from './static-assets.js';
import type { RunStore } from './run-store.js';
// v24 (DES-140/162, ARCH-089, TASK-147): the new tool surface — one deps object, schema-before-
// authz dispatcher, `tools/list` as a pure projection, and the ungated-route identity strip.
import { callTool, type ToolDeps } from './call-tool.js';
import { toPublicRunView, toPublicRunSummary } from './run-view.js';
import { projectToolsList, ENVELOPE_NOTE } from './tool-specs.js';
import { resolveRole, type Principal } from './authz.js';
import { createOwnerLookup } from './owner-lookup.js';
import { DiagramRenderer, renderWithMmdc, type DiagramRendererOpts } from './diagram-render.js';

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
  // v25 (DES-168, REQ-120, owner ruling 2026-09-07): per-RUN in-flight agent() cap — how wide one
  // workflow's parallel() may actually run. Defaults to DEFAULT_RUN_CONCURRENCY (24); `acquireSlot()`
  // queues past it, so a wider fan-out is slower, never truncated. Distinct from `agentSlots` above,
  // which rations spawns across ALL runs.
  runConcurrency?: number;
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
  // v24 (ARCH-090, DES-141, TASK-146): the role map composeConfig() forwards from
  // FileConfig.principals ("*" is a legal key). Absent -> ADR-028 fail-closed default (every
  // authenticated caller resolves to 'user'), announced visibly on the boot line + GET /api/system.
  principals?: Record<string, { role: Role }>;
  // v24 (ARCH-102, DES-153, TASK-146): https-only allowlist gating an `asset_push({kind:'mcp'})`
  // config's `http` transport BEFORE any probe/fetch (EGRESS_DENIED otherwise). Absent -> no http
  // MCP config is ever probed.
  mcpEgressAllowlist?: string[];
  // v25 (REQ-119, DES-166, TASK-166): the lazy server-side Mermaid→SVG renderer behind
  // `GET /api/workflows/:name/diagram.svg`. Every field is optional and the defaults are the
  // production ones (real mmdc child process, `MAX_CONCURRENT_RENDERS`, `RENDER_TIMEOUT_MS`);
  // tests inject a counting `render` so the three anti-exhaustion clauses (cache-first,
  // single-flight, cap) can be asserted by RENDER COUNT. Deliberately NOT forwarded from
  // rwe.config.json: no operator knob is asked for, and every unforwarded config block this repo
  // has added became a silent-failure bug (the composeConfig class, twice).
  diagramRender?: DiagramRendererOpts;
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

/** v24 (DES-142): `?namespace=` is retired on every CAS upload route — the namespace is derived
 *  from the caller's own identity, never echoed from the client. ONE declaration of the rule and
 *  its message; the four upload routes (blob/manifest x auth-gated/no-identity fallback) call it.
 *  Returns true when it has already answered the request. */
function refuseNamespaceParam(req: IncomingMessage, res: ServerResponse): boolean {
  if (!new URL(req.url ?? '/', 'http://x').searchParams.has('namespace')) return false;
  sendJson(res, 400, {
    code: 'INVALID_BLOB_REQUEST',
    message: 'INVALID_BLOB_REQUEST: ?namespace= is retired (v24) — the namespace is derived from the caller\'s own identity, never a query param',
  });
  return true;
}

/** The one CAS blob-upload failure -> HTTP-status mapping, shared by the auth-gated and the
 *  no-identity fallback copy of the `POST /assets/blob/:sha` route. */
function sendBlobUploadError(res: ServerResponse, err: unknown): void {
  const code = (err as { code?: string }).code ?? 'BLOB_ERROR';
  const message = (err as { message?: string }).message ?? String(err);
  const status = code === 'BLOB_TOO_LARGE' ? 413
    : code === 'BLOB_UPLOAD_TIMEOUT' ? 408
    : code === 'BLOB_SHA_MISMATCH' ? 409
    : 500;
  sendJson(res, status, { code, message });
}

// v24 (DES-140, ARCH-089, TASK-147): the pre-v24 positional `callTool` (17 params, the old 9-tool
// switch) is RETIRED — dispatch now goes through `callTool(deps, name, args, principal)` in
// `call-tool.ts`, built from `ToolDeps` at each `/mcp` handler below.

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
  // v26 (H-4 send-back repair, ARCH-116): `ModelBook` (TTL'd, single-flight), never a raw catalog
  // builder — see the `/api/models` route below for why.
  modelBook: ModelBook,
  // v24 (DES-141): the same {enabled, principalsCount, defaultRole} shape as the boot line, computed
  // once at boot — GET /api/system's `auth` key (ARCH-090).
  authAnnounce: { enabled: boolean; principalsCount: number; defaultRole: 'user' } = { enabled: false, principalsCount: 0, defaultRole: 'user' },
  // v25 (REQ-119, DES-166): the (name, version)-keyed SVG cache in front of the renderer.
  diagrams: DiagramRenderer = new DiagramRenderer(),
): Promise<void> {
  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Dashboard API is read-only: only GET is supported.' });
    return;
  }
  const path = (req.url ?? '').split('?')[0]!;
  const agentMatch = /^\/api\/runs\/([^/]+)\/agents\/([^/]+)$/.exec(path);
  const dagMatch = /^\/api\/runs\/([^/]+)\/dag$/.exec(path);
  // v23 (DES-125/132, REQ-101, ARCH-083, TASK-120): replaces the deleted /skeleton route. This
  // route carries no bearer/identity at all (a browser GET carries none), so — unlike /skeleton,
  // which branched on `authEnabled` to choose WHAT to disclose — `workflow_describe` makes no
  // masking decision on `ctx` at all: every principal gets the same shape (DES-125). v27b (DES-198,
  // ADR-051): the DAG route below now shares this same no-masking posture.
  const describeMatch = /^\/api\/workflows\/([^/]+)\/describe$/.exec(path);
  // v25 (REQ-119, DES-166, TASK-166): the RENDERED diagram, as an image. Anonymous like /describe
  // beside it — which is exactly why `diagrams` is cache-first, single-flight and capped.
  const diagramMatch = /^\/api\/workflows\/([^/]+)\/diagram\.svg$/.exec(path);
  const runMatch = /^\/api\/runs\/([^/]+)$/.exec(path);
  const issuesDetailMatch = /^\/api\/issues\/(\d+)$/.exec(path);
  try {
    // v11 F1 (REQ-074/075): home view — 3-way grouped workflow cards with reliability metrics.
    if (path === '/api/home') {
      const [catalogEntries, runs] = await Promise.all([
        runManager.catalog.list(),
        // v27 (DES-194, ARCH-127, TASK-199): the usage-projected accessor — same one `/api/runs` reads.
        runManager.listSummaries(),
      ]);
      const metrics = computeWorkflowMetrics(runs);
      sendJson(res, 200, buildHomeView(catalogEntries, runs, metrics));
      return;
    }
    // v12 (REQ-076/077, DES-073): host system info — bare SystemInfoView (no MCP envelope wrapper).
    // [v28, DES-218, TASK-225, ARCH-135] topN raised 5 -> 20 for the dashboard's process table
    // (REQ-138); the MCP system_info tool keeps its own default of 5 (tool-specs.ts:999-1004). A
    // literal, never a value derived from the URL — no query-string knob (DES-218's own refusal:
    // SystemInfoSampler.get() applies topN at SHAPE time over the cached snapshot, so a different
    // constant per caller is free — and a knob on this unauthenticated route would widen recon).
    if (path === '/api/system') {
      const view = await systemInfo.get({ topN: 20 });
      // v24 (DES-141): auth = {enabled, principalsCount, defaultRole} (ARCH-090).
      sendJson(res, 200, { ...view, auth: authAnnounce });
      return;
    }
    // v12 (REQ-078, DES-075/076): enriched model list — returns EnrichedModelEntry[] directly.
    // v26 (H-4 send-back repair, ARCH-116): through `ModelBook.snapshot()` (TTL'd, single-flight —
    // a burst of dashboard loads fires at most one upstream fetch), and `catalogFetchedAt` on each
    // row is the snapshot's own "as of", not a hardcoded `null`.
    if (path === '/api/models') {
      const snapshot = await modelBook.snapshot();
      const entries = snapshot.entries as ModelEntry[];
      sendJson(res, 200, filterCatalog(entries).map((e) => enrichModelEntry(e, snapshot.fetchedAt)));
      return;
    }
    if (path === '/api/runs') {
      // v27 (DES-194, ARCH-127, TASK-199): the usage-projected accessor — same precedence chain
      // (live -> snapshot -> one-time backfilled fold -> absent) `/api/runs/:id`'s detail route folds.
      const runs = await runManager.listSummaries();
      // DES-240 rationale item 9: failedAgentCount is declined on this list surface (run_list, the
      // MCP tool, keeps it) — stripped here, not off RunSummary itself.
      sendJson(res, 200, buildDashboardModel(runs.map(toPublicRunSummary)).runs);
      return;
    }
    // v8 Slice 3 (REQ-049): registered-workflow cards for the dashboard home.
    if (path === '/api/workflows') {
      sendJson(res, 200, await runManager.catalog.list());
      return;
    }
    // v23 (REQ-101, DES-125/132, ARCH-083, TASK-120): replaces the deleted /skeleton route — the
    // same `workflow_describe` response the MCP tool returns (DES-132's parity guarantee), unwrapped
    // to its `result` (never the raw envelope). Unauthenticated with no owner branch to make (DES-125
    // drops `viewerIsOwner`), so `ctx` here makes no masking decision either.
    if (describeMatch) {
      const name = decodeURIComponent(describeMatch[1]!);
      const resp = await facade.workflowDescribe({ name }, { kind: 'auth-disabled' }) as {
        status: string; error?: { message?: string }; result?: unknown;
      };
      if (resp.status === 'failed') {
        sendJson(res, 404, { error: resp.error?.message ?? `Workflow not found: ${name}` });
        return;
      }
      sendJson(res, 200, resp.result);
      return;
    }
    // v25 (REQ-119, DES-166, TASK-166): the author's diagram, RENDERED — server-side, so the only
    // thing a viewer's browser receives is an image. The dashboard loads it with `<img>`; author
    // label text never reaches an HTML renderer in anyone's browser (ADR-033's surviving reason)
    // and no Mermaid library ships to the client (UT-161's guard, unchanged).
    if (diagramMatch) {
      const name = decodeURIComponent(diagramMatch[1]!);
      const version = new URL(req.url ?? '/', 'http://x').searchParams.get('version') ?? undefined;
      const resp = await facade.workflowDescribe({ name, version }, { kind: 'auth-disabled' }) as {
        status: string; error?: { message?: string }; result?: { version: string; mermaid: string | null; mermaidNote: string | null };
      };
      if (resp.status === 'failed' || !resp.result) {
        sendJson(res, 404, { code: 'WORKFLOW_NOT_FOUND', error: resp.error?.message ?? `Workflow not found: ${name}` });
        return;
      }
      const { version: resolved, mermaid, mermaidNote } = resp.result;
      // Nothing to draw (a pre-v24 row, ADR-025). 404 with the reason the read surface already
      // reports — and, importantly, no render is started.
      if (!mermaid) {
        sendJson(res, 404, { code: 'DIAGRAM_UNAVAILABLE', reason: mermaidNote ?? 'LEGACY_NO_DIAGRAM' });
        return;
      }
      // Keyed by the RESOLVED version, never by the requested selector: `?version=v1`, `release`
      // and the bare default must share one cache entry when they name the same row.
      const out = await diagrams.get(name, resolved, mermaid);
      if (!out.ok) {
        // Degrade, never pretend: the dashboard falls back to today's source display on a non-200,
        // and the reason is observable to the client (code) and to the operator (log, with detail —
        // an anonymous caller is told WHICH degradation, never the renderer's stderr).
        console.warn(JSON.stringify({ event: 'diagram_render_failed', workflow: name, version: resolved, reason: out.reason, detail: out.detail }));
        sendJson(res, 503, { code: 'DIAGRAM_RENDER_UNAVAILABLE', reason: out.reason });
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        // The image is served to an <img> tag; nosniff + a no-privilege CSP also make a DIRECT
        // navigation to this URL inert, where an SVG loads as a document and could otherwise run
        // script. `style-src 'unsafe-inline'` is required: mermaid emits an inline <style> block.
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
        // (name, 'v1') is reusable after a deregister, so a browser must not hold it independently.
        'Cache-Control': 'no-store',
        'X-Diagram-Cache': out.cached ? 'hit' : 'miss',
      });
      res.end(out.svg);
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
      // v28 (DES-218, TASK-219, REQ-139): named against IssuesListView — zero wire change, the
      // shape already served.
      const payload: IssuesListView = { open, resolved };
      sendJson(res, 200, payload);
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
      // v27b (DES-198, ADR-051, TASK-203): one warning per resolution/derivation fault, pushed onto
      // the payload's `warnings` beside `layoutGraph`'s own prose ones. `PREDICTED_OVERLAY_UNAVAILABLE`
      // is the one token both fault arms below spell (`PREDICTED_FROM_FALLBACK_VERSION` stays a
      // one-off literal — it has only one producer).
      const PREDICTED_OVERLAY_UNAVAILABLE = 'PREDICTED_OVERLAY_UNAVAILABLE';
      const routeWarnings: string[] = [];
      let skeletonScript = spec?.script ?? '';
      if (spec?.name) {
        try {
          // arm (i): the run's own pin — or, if resume already recorded a legacy substitution, the
          // version it actually resolved to that time (never the stale pin, `types.ts:351`).
          skeletonScript = (await runManager.catalog.resolve(spec.name, { version: view.legacySubstitution?.resolved ?? view.scriptVersion })).script;
        } catch {
          try {
            // arm (ii): the pin itself is gone (e.g. a deregister/re-register restarted the
            // lineage) — fall back to the name's current release and say so; FALLBACK is a STATE,
            // never logged (its durable record is `legacySubstitution`, not this line).
            const fallback = await runManager.catalog.resolve(spec.name, {});
            skeletonScript = fallback.script;
            routeWarnings.push(`PREDICTED_FROM_FALLBACK_VERSION: pinned=${view.scriptVersion} resolved=${fallback.version}`);
          } catch {
            // arm (iii): no version of this name resolves at all — the only cell of the two-arm
            // catch that pushes AND logs (this is the single most likely silent failure in this
            // delta: the push MUST sit inside this catch, never downstream of it).
            skeletonScript = '';
            routeWarnings.push(`${PREDICTED_OVERLAY_UNAVAILABLE}: reason=catalog-resolve-failed`);
            console.warn(JSON.stringify({ event: 'dashboard_api_degraded', route: 'dag', reason: 'catalog-resolve-failed', runId, name: spec.name }));
          }
        }
      }
      // v26 (DES-176, ARCH-114/113, TASK-187): the predicted overlay is now an `ExpectedGraph`
      // (ARCH-113/TASK-185's `deriveExpectedGraph`), not a flat `SkeletonNode[]`. A script that
      // fails to parse into a predicted graph degrades to an EMPTY overlay: live agent nodes still
      // render, only the predicted/inert-skeleton cells are withheld, never a 500 over a dashboard
      // read. v27b (DES-198, ADR-051): served on every deployment — this route no longer branches
      // on auth (the sibling describe route beside it already made the same call, DES-125).
      let expectedGraph: ExpectedGraph = { lanes: [], slots: [], edges: [] };
      try {
        const nodes = parseWorkflowSkeleton(skeletonScript);
        const scan = scanAgentCalls(skeletonScript);
        // v35 (DES-239, ARCH-151, TASK-237, REQ-209): this route cannot refuse (it is a dashboard
        // read, not the registration gate) — `scan.unscannable` is surfaced as a visible marker so
        // an oracle parse failure is distinguishable from a script that genuinely has no agent()
        // calls, instead of silently rendering an empty overlay.
        if (scan.unscannable) {
          routeWarnings.push(`${PREDICTED_OVERLAY_UNAVAILABLE}: reason=script-unscannable`);
        }
        const derived = deriveExpectedGraph(nodes, scan);
        // v26 integration (DES-176 boundary): a REFUSAL here does not mean "no overlay" — at
        // layout it means "this is a v1-contract script" (typically: it has no `phase()` at
        // all, which rule L2 refuses at REGISTRATION but which is perfectly legal to run and
        // to draw). v26 (M-3 send-back repair, INV-V26-3): re-derives with the SAME function's
        // `contract:'v1'` instead of the retired `v1FallbackGraph` — one derivation, so a v1
        // script's `parallel([a,b,c])` still lays out as a `parallel` slot (`call.group` honoured),
        // not three chained `single` ones. REQ-124 requires those runs to render as before.
        if (derived.ok) {
          expectedGraph = derived.graph;
        } else {
          const v1 = deriveExpectedGraph(nodes, scan, 'v1');
          if (v1.ok) {
            // `contract:'v1'` never refuses on L2 (its only refusal rule today) — this is the
            // legitimate v1-contract cohort (REQ-124), not a fault: emits no warning.
            expectedGraph = v1.graph;
          } else {
            expectedGraph = { lanes: [], slots: [], edges: [] };
            routeWarnings.push(`${PREDICTED_OVERLAY_UNAVAILABLE}: reason=derivation-failed`);
            console.warn(JSON.stringify({ event: 'dashboard_api_degraded', route: 'dag', reason: 'derivation-failed', runId, name: spec?.name }));
          }
        }
      } catch {
        // arm (iv): a parse/derivation fault degrades to an empty predicted overlay rather than a
        // 500 — defensive only (registration ran the same derivation, INV-V26-3), so no producer
        // with a registered script reaches this catch today.
        routeWarnings.push(`${PREDICTED_OVERLAY_UNAVAILABLE}: reason=derivation-failed`);
        console.warn(JSON.stringify({ event: 'dashboard_api_degraded', route: 'dag', reason: 'derivation-failed', runId, name: spec?.name }));
      }
      const layout = layoutGraph(expectedGraph, view.agents, view.phases, { startedByType: view.startedBy?.type });
      // v27b (DES-198/DES-196, ADR-051, TASK-203, REQ-134): `lanes`/`current` — the observed phases
      // extended UNCONDITIONALLY by the predicted overlay's unreached tail.
      const { lanes, current } = deriveLanes(view.phases, expectedGraph, { status: view.status });
      // DES-064: flat GraphPayload — cells/edges/warnings/truncated at top level (not nested under 'layout').
      const payload: Record<string, unknown> = {
        kind: 'run',
        ...layout,
        warnings: [...layout.warnings, ...routeWarnings],
        startedBy: view.startedBy ?? { type: 'unknown' },
        lanes,
        current,
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
      const shaped = await facade.runAgentLog({ runId, agentId, limit, offset }, { kind: 'auth-disabled' }, false, null);
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
      // v24 (DES-162): `/api/runs/:id` is ungated — no identity field leaves on this route.
      sendJson(res, 200, buildDashboardModel([], toPublicRunView(view)).selected);
      return;
    }
    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    // DES-018: never a 500 — degrade to a partial/last-known view with an error badge.
    // v27b (DES-198, TASK-203): 'internal' is the one member of the closed reason set that has no
    // warning by construction (an unexpected fault in ANY dashboard route, not just /dag).
    console.warn(JSON.stringify({ event: 'dashboard_api_degraded', route: path, reason: 'internal', detail: (err as Error).message }));
    sendJson(res, 200, buildDashboardModel([], undefined, undefined, (err as Error).message));
  }
}

/** Start the MCP Streamable HTTP server. Resolves when listening. */
export async function createServer(config?: ServerConfig): Promise<Server> {
  const bind = config?.bind ?? '127.0.0.1';
  // Real on-disk RunStore (journal.jsonl + SQLite index) — DES-015: E2E/acceptance must exercise
  // the real store, not the InMemory unit-test fake; a workRoot survives across a server restart.
  const workRoot = config?.workRoot ?? mkdtempSync(join(tmpdir(), 'rwe-'));
  // v24 (integrator, adjudication #4 C-7 [12]): the ONE resolved asset root — read by the writer
  // (AssetSyncService), by the reader (RunManager -> DES-154's selective materialization) and by
  // the orphan-tree GC sweep, so all three can no longer disagree.
  const assetRoot = config?.assetRoot ?? defaultAssetRoot(workRoot);
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
  // catalog.db/store/schedules.db — survives restart.
  const mcpProbe: McpProbe = config?.mcpProbe ?? new RealMcpProbe();
  // v15 (DES-098, DES-099, TASK-089): boot backfill + alias-aware validation
  const catalog = new WorkflowCatalog(workRoot, clock, {
    backfillOwner: config?.auth?.enabled ? true : undefined,
    // v24 (TASK-139/DES-159): the McpRegistry-backed `mcpLookup` is gone with the registry — no
    // replacement wiring here (defaults to WorkflowCatalog's own accept-all, unconfigured `() =>
    // true`; TASK-143/145 own the v24 catalog-backed MCP asset check).
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
  // D-V3M-2 (REQ-020 D-DOS): the ONE process-global agent-slot semaphore, shared by reference into
  // the RunManager (rations every SDK-CLI dispatch) and surfaced read-only via GET /api/status.
  const agentSemaphore = createSemaphore(config?.agentSlots ?? 32);
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
  // v21 Gate 8 RE-REVIEW (review §R2 (c), R-G3 MED): unlike the catalog's aliasNames (line ~1141,
  // registration-time enum check, deliberately empty=accept-all per D-AUTH-5-B), the admission-time
  // UNKNOWN_ALIAS check must mirror what DISPATCH actually resolves against — and on the documented
  // default/unconfigured deployment dispatch resolves via DEFAULT_ALIASES (run-manager.ts's
  // DEFAULT_GATEWAY_CONFIG), never "accept everything". Feeding an empty Set here left the B1/B2
  // admission control inert on exactly the deployment shape most installs use.
  const aliasNames = new Set(Object.keys(config?.aliases ?? DEFAULT_ALIASES));
  // v26 (DES-178, ARCH-116, TASK-178): `aliasMap` mirrors `aliasNames` one line up (same source,
  // same DEFAULT_ALIASES fallback) — RunManager resolves a reachable alias to {provider,model} with
  // it when building each run's price-book pin.
  const aliasMap = config?.aliases ?? DEFAULT_ALIASES;
  // v7 (REQ-039/040): the `models_list` catalog builder — federates the config's curated aliases +
  // the injectable live fetchers (default real fetch). Hoisted above RunManager (was built later,
  // only for callTool/the dashboard) so the SAME builder is also `ModelBook`'s injected source
  // (ARCH-116's own note: "the loader IS the already-injectable config.modelCatalog") — one catalog
  // fetch, not two independently-configured ones. A fully injectable builder wins when provided.
  const buildModelCatalog = config?.modelCatalog ?? ((): Promise<ModelEntry[]> => buildCatalog({
    aliases: config?.aliases,
    ollamaFetch: config?.modelCatalogFetchers?.ollamaFetch,
    openrouterFetch: config?.modelCatalogFetchers?.openrouterFetch,
    ollamaBaseUrl: config?.modelCatalogFetchers?.ollamaBaseUrl,
  }));
  // v26 (DES-178, ARCH-116, TASK-178): one TTL'd, single-flight snapshot shared by every run's
  // admission-time pin — never one fetch per run, let alone per agent() call.
  const modelBook = new ModelBook(buildModelCatalog, { clock });
  const runManager = new RunManager({ store, clock, catalog, workRoot, assetRoot, globalAssetRoot: globalAssetRoot(workRoot), gateway, semaphore: agentSemaphore, concurrency: config?.runConcurrency, maxWorkflowDepth: config?.maxWorkflowDepth, maxWorkflowDescendants: config?.maxWorkflowDescendants, maxConcurrentRuns: config?.maxConcurrentRuns, seedRefAllowlist: config?.seedRefAllowlist, cas, secretValueProvider, ceilings, aliasNames, modelBook, aliasMap });
  // v8 Defer B (REQ-057/058): durable webhook ingress registry, same workRoot convention.
  const webhooks = new WebhookRegistry({ clock, runManager, catalog, dbPath: config?.webhookDbPath ?? join(workRoot, 'webhooks.db') });
  // v22 (DES-113, TASK-108) SHRINK: SubmissionValidatorDeps is now `{catalog}` — the alias/MCP-name/
  // parse checks moved to registration (ADR-013); see submission-validator.ts's own header.
  const validator = new SubmissionValidator({ catalog });
  // v2 (DES-016/TASK-019): SQLite-persisted schedule store, same workRoot convention as
  // catalog.db/store — survives restart (REQ-014-style persistence extended to schedules).
  const scheduler = new SqliteSchedulerPort({
    clock, catalog, runManager,
    dbPath: config?.schedulerDbPath ?? join(workRoot, 'schedules.db'),
  });
  // D-V2I-2 (DES-017): re-derive nextFire for every persisted cron/once schedule from THIS boot's
  // clock before the driver's first tick — matches DES-017's own "Boot re-arm from persistence".
  scheduler.rearmAtBoot();

  // v24 (ARCH-090, DES-141, TASK-146): the auth boot announcement (ADR-028 fail-closed default is
  // BUILT, not merely asserted — an unwired `principals` map must be visible, never a silent
  // everyone-is-admin default). `enabled` answers "is role-based authorization active" — true when
  // EITHER a `principals` map was configured OR OAuth (`config.auth.enabled`) is on; these are
  // deliberately not conflated with "principals absent" (ARCH-090's own note). `defaultRole` is
  // always 'user' (ADR-028) — there is no config knob for it. Computed once at boot (a diagnostic,
  // not a per-request read); `getRun` (not `listRuns`, which doesn't project `principal`) is the
  // only RunStore read that already carries it (pre-v24, DES-096).
  const principalsCount = Object.keys(config?.principals ?? {}).length;
  // v25 (#59): `enabled` follows the auth GATE, not the presence of a config key. It used to be
  //  `principals !== undefined || auth.enabled`, which announced `enabled=true` for the exact
  //  shape `rwe.config.example.json` ships — a principals map WITH `auth.enabled:false` — on
  //  every first deployment, while auth was off. DEPLOY.md makes the firewall allowlist
  //  MANDATORY in that state, so the line was hiding a required safety step, not just a boolean.
  //  `principalsCount` still reports what is configured: a role table that is inert because auth
  //  is off is worth seeing, and conflating the two is what caused this.
  const authAnnounceEnabled = !!config?.auth?.enabled;
  const bootRunSummaries = await store.listRuns();
  const bootRunDetails = await Promise.all(bootRunSummaries.map((r) => store.getRun(r.runId)));
  const ownerlessRuns = bootRunDetails.filter((r) => r && !r.principal).length;
  const ownerlessTriggers =
    (await scheduler.list()).filter((s) => !s.createdBy).length +
    webhooks.list().filter((w) => !w.createdBy).length;
  const authAnnounce = { enabled: authAnnounceEnabled, principalsCount, defaultRole: 'user' as const };

  // v24 (TASK-139/DES-159): the TriggerPorts composition and the GraphAnalyzer boot (config field,
  // instance, sweepAtBoot, boot logs) are gone with the analyzer/trigger-bindings ports they read —
  // no replacement wiring here (TASK-149/DES-156 owns the by-id `triggers` replacement).
  // v24 (DES-149, TASK-148): the trigger-claim stores (schedulerClaims/webhookClaims) are wired
  // just below, once `scheduler`/`webhooks` exist; `assetSync` is bound after `http.listen()`
  // (see `facade.bindAssetSync` near the bottom — it needs the server's own bound port).
  // v24 Gate 7.5 (D-12): `aliasNames` — the SAME resolved Set admission and registration validate
  // against — reaches the facade so `workflow_authoring_guide` names the accepted aliases.
  // v25 (REQ-119, DES-166, TASK-166): one renderer/cache per engine. The default render function is
  // the real mmdc child process; `config.diagramRender.render` replaces it in tests.
  const diagrams = new DiagramRenderer({ render: renderWithMmdc, ...config?.diagramRender });
  // v35 (DES-239, ARCH-147/154, TASK-237, REQ-207): the deployed gateway's worst-case attempt count
  // — forwarded so `workflow_describe`'s advertised `timeoutMs.attempts`/`worstCaseMs` reflect what
  // THIS deployment actually retries (the composeConfig wiring class, twice bitten).
  const gatewayAttempts = 1 + Math.max(0, config?.retries ?? 1);
  const facade = new McpFacade({ clock, store, runManager, validator, ceilings, cas, schedulerClaims: scheduler, webhookClaims: webhooks, aliasNames, diagramCache: diagrams, runConcurrency: config?.runConcurrency, gatewayAttempts });

  // v24 (DES-139, ARCH-088, TASK-147): authorize()'s OwnerLookup is SYNC (a pure decision
  // function), while RunStore/WorkflowCatalog are async ports — a second connection to each
  // store's own SQLite file (both already WAL, so a concurrent reader is safe) answers
  // runOwner/workflowOwner synchronously without adding a sync method to either port.
  const runsOwnerDb = new Database(join(workRoot, 'store', 'index.db'));
  const catalogOwnerDb = new Database(join(workRoot, 'catalog.db'));
  const ownerLookup = createOwnerLookup({
    runOwner: (runId) => {
      const row = runsOwnerDb.prepare('SELECT principal FROM runs WHERE runId = ?').get(runId) as { principal: string | null } | undefined;
      return row ? row.principal : undefined;
    },
    workflowOwner: (name) => {
      const row = catalogOwnerDb.prepare('SELECT owner FROM workflows WHERE name = ?').get(name) as { owner: string | null } | undefined;
      return row ? row.owner : undefined;
    },
    scheduler, webhooks,
  });

  // v24 (DES-140, TASK-147): ToolDeps built once per request (only `webhookBaseUrl` varies with
  // the incoming Host header) — `assetSync` is read live off the outer `let` so a call after
  // `bindAssetSync` runs sees the real instance.
  function buildToolDeps(webhookBaseUrl: string): ToolDeps {
    return { facade, scheduler, webhooks, webhookBaseUrl, cas, assetSync, mcpProbe, issueReporter, modelBook, systemInfo: systemInfoSampler, lookup: ownerLookup, audit: store };
  }
  // v35 (DES-239b, ARCH-152, TASK-237, REQ-210): BOTH `initialize` results carry `instructions`
  // with `ENVELOPE_NOTE` and a guide-size figure COMPUTED per call from the SAME stringified
  // tool-result object a caller actually receives (no literal, no module-scope memo — DES-239's own
  // boundary (a)).
  async function buildInitializeInstructions(webhookBaseUrl: string, principal: Principal): Promise<string> {
    const guideResult = await callTool(buildToolDeps(webhookBaseUrl), 'workflow_authoring_guide', {}, principal);
    const bytes = Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(guideResult) }] }));
    return `${ENVELOPE_NOTE} workflow_authoring_guide is ~${bytes} bytes.`;
  }
  // v24 (DES-140, ARCH-089): `Principal` built ONCE per request from `resolvePrincipal` +
  // `authEnabled` + `isLoopbackPeer` — the three shapes ARCH-088 defines.
  function principalFor(id: string): Principal {
    return { kind: resolveRole(config?.principals, id), id };
  }
  // v6 (REQ-036): best-effort engine-side diagnostics for a runId, pulled through the SAME facade
  // the MCP tools use (status + artifact list + failing/last agent transcript tail), formatted as a
  // short markdown block. Bounded and swallow-all — an unknown/failed run returns null so the
  // enrichment NEVER fails an issue_report.
  const runDiagnostics = async (runId: string): Promise<string | null> => {
    try {
      const diagPrincipal: Principal = { kind: 'auth-disabled' };
      const statusEnv = await facade.runStatus({ runId }, diagPrincipal, false, null);
      if (statusEnv.error || !statusEnv.result) return null;
      const view = statusEnv.result;
      const lines: string[] = ['### Engine diagnostics', `- status: ${view.status}`];
      const artifactsEnv = await facade.workspaceList({ runId }, diagPrincipal, false, null);
      const artifacts = (artifactsEnv.result ?? []) as Array<{ path: string; size: number }>;
      lines.push(`- artifacts: ${artifacts.length}`);
      for (const f of artifacts.slice(0, 20)) lines.push(`  - \`${f.path}\` (${f.size} bytes)`);
      const agents = view.agents ?? [];
      const failing = agents.find((a) => a.state === 'failed') ?? agents[agents.length - 1];
      if (failing) {
        const logEnv = await facade.runAgentLog({ runId, agentId: failing.agentId }, diagPrincipal, false, null);
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
  // v12 (REQ-076/077, DES-073): ONE SystemInfoSampler instance shared between the system_info tool
  // and GET /api/system (DES-073 "sample once"). Tests inject a StubProbe-backed sampler via
  // config.systemInfo; production defaults to a RealSystemProbe.
  const systemInfoSampler = config?.systemInfo ?? new SystemInfoSampler(new RealSystemProbe(workRoot), clock, 1500);
  // v2 (DES-019/TASK-021): asset store rooted under workRoot; `selfBind` (this server's own
  // address) is assigned once the real listening port is known, just below.
  let assetSync: AssetSyncService;
  // D-V2I-2 (DES-017): the impure driver loop — every tick, pure `tick()` decides which persisted
  // cron/once schedules are due; each due firing starts a run via the SAME RunManager.start() path
  // as workflow_run/workflow_trigger (DES-016's "same run path" invariant), then the outcome is
  // recorded back onto the schedule (auto-complete for `once`, fresh nextFire for `cron`).
  const ticker: Ticker = new RealTicker(500);
  /** v24 (integrator; DES-150/ADR-031, REQ-115): the fire-path POLICY gate the design specified as
   *  "the driver becomes `resolveTarget(firing) -> {workflow} | {refused: reason}` then `start` or
   *  `markRefused`", and which nothing ever built — `scheduler.markRefused` had no caller at all,
   *  so "recorded refusals" recorded nothing and an unclaimed or orphaned trigger either fired
   *  against a missing workflow or was skipped in silence. Four reasons, in the order a firing
   *  meets them; `markRefused` shares `markFailed`'s advance, so a refused `cron` gets a fresh
   *  `nextFire` (ADR-031's coalescing — one row per due instant, not 1440 rows a day) and a refused
   *  `once` is CONSUMED. */
  async function resolveScheduleTarget(firing: { id: string; workflow: string }): Promise<{ workflow: string } | { refused: RefusalReason }> {
    // The CLAIM, not the owner: `ownerOf` answers `createdBy` (the creating principal) as of the
    // Gate 6.5+7 round-2 authorization fix, so reading it here would resolve a PRINCIPAL ID as a
    // workflow name and refuse every authenticated user's schedule CLAIMED_WORKFLOW_MISSING.
    // `??` still folds both "no such row" and "unclaimed" onto the pre-v24 `firing.workflow` door.
    const claimedBy = scheduler.get(firing.id)?.claimedBy ?? (firing.workflow !== '' ? firing.workflow : null);
    if (claimedBy === null || claimedBy === '') return { refused: 'UNCLAIMED' };
    let released;
    try {
      released = await catalog.resolve(claimedBy, { channel: 'release' });
    } catch (err) {
      const code = (err as { code?: unknown } | null)?.code;
      if (code === 'CHANNEL_UNPUBLISHED') return { refused: 'CHANNEL_UNPUBLISHED' };
      return { refused: 'CLAIMED_WORKFLOW_MISSING' };
    }
    // NOT_IN_RELEASE: the workflow still exists and is published, but the RELEASED version no
    // longer declares this trigger id. Two guards, and they are NOT the same guard twice (v24
    // Gate 8, AF-2 / TASK-161):
    //   - `triggers !== undefined` covers a genuine PRE-v24 version row, whose column did not exist;
    //   - `declaresTrigger` covers the create-time binding door (`schedule_create({workflow})`):
    //     a schedule bound that way never entered any version's `triggers[]`, so the release list
    //     has no jurisdiction over it. v24 adjudication #8 (H-2, issue #56) CLOSED that door on the
    //     tool surface — AF-5's "still shipped" is fixed — so this guard now covers PRE-v24 legacy
    //     rows only; the rows exist, so the guard stays. Until AF-2, the first guard did this job by proxy because an empty declaration
    //     was persisted as NULL — the exact conflation that made NOT_IN_RELEASE unreachable.
    if (released.triggers !== undefined && !released.triggers.includes(firing.id) && catalog.declaresTrigger(claimedBy, firing.id)) return { refused: 'NOT_IN_RELEASE' };
    return { workflow: claimedBy };
  }
  ticker.start(() => {
    const due = tick(scheduler.all(), clock.now());
    for (const firing of due) {
      // [v29, REQ-152, R29-A1] CLAIM FIRST, synchronously, before anything is awaited. `markFired`
      // below lands only after `runManager.start()` resolves; with a 500 ms ticker, a dispatch
      // slower than one tick used to leave this row still due and start a SECOND run for the same
      // firing. `markRefused` already named this race ("two ticks racing the same instant") and
      // guarded its own counter against it — the success path had no guard and lost a whole run to
      // it. A `false` here means another tick already took this firing.
      if (!scheduler.claimFiring(firing)) continue;
      void resolveScheduleTarget(firing).then((target) => {
      if ('refused' in target) {
        scheduler.markRefused(firing, target.refused);
        // eslint-disable-next-line no-console
        console.warn(`[remote-workflow-engine] scheduled firing ${firing.id} refused before dispatch: ${target.refused}`);
        return;
      }
      runManager
        .start({ name: target.workflow, args: firing.args, startedBy: { type: 'schedule', id: target.workflow } })
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

  // v24 (ARCH-098, TASK-160; Gate 8 AF-1 / adjudication #7 G-1): the pre-v24 asset migration, and
  // it runs HERE — synchronously, BEFORE the sweep below is armed — because the order IS the
  // requirement. The sweep deletes every child of `<assetRoot>/` that is not a live workflow, and a
  // pre-v24 deployment's global tree (`<assetRoot>/skill/<name>`) is exactly such a child. Arming
  // the timer first and migrating later would work only by luck of the interval.
  const legacyAssets = migrateLegacyGlobalAssets({ assetRoot, globalRoot: globalAssetRoot(workRoot), clock, port: catalog });
  if (!legacyAssets.alreadyDone) {
    // eslint-disable-next-line no-console
    console.log(`[remote-workflow-engine] assets.migrate: ${legacyAssets.rows} legacy row(s), ${legacyAssets.movedTrees} tree(s) moved out of the swept asset root`);
  }

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
            // v24 (integrator, adjudication #4 C-7 [12]): `hasWorkflow` + the resolved `assetRoot`
            // are supplied — without them the orphan asset-tree branch was dead code in production
            // (IT-110 only ever exercised it through a hand-built fixture).
            catalog
              .list()
              .then((workflows) => {
                const live = new Set(workflows.map((w) => w.name));
                reclaimStaleWorkspaces(workRoot, _gcTtl, (id) => statusByRun.get(id) ?? null, Date.now(), (name) => live.has(name), assetRoot); // det:allow — GC sweep, not a workflow decision
              })
              .catch(() => { /* a catalog read failure must never crash the sweep — retry next interval */ });
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
    // v23 Gate 6.5 (round 4): the ONE way this handler dispatches a dashboard/API request. A1 gave
    // `/api/workflows/:name/describe` a second, authenticated entry, and the POSITIONAL argument
    // list was typed out twice; a drift between the two copies would diverge on one path and not
    // the other, with no type error. Same one-declaration rule as
    // `DEFAULT_CEILINGS`/`UNBOUND_ENTRY_LABEL`.
    const dispatchDashboard = (): void => {
      handleDashboardRequest(req, res, store, runManager, issueReporter, facade, systemInfoSampler, modelBook, authAnnounce, diagrams).catch((err) => {
        // v27b (DES-198, TASK-203): 'internal' — the closed reason set's one member with no warning
        // by construction (a promise rejection `handleDashboardRequest`'s own try/catch didn't catch).
        console.warn(JSON.stringify({ event: 'dashboard_api_degraded', route: (req.url ?? '').split('?')[0], reason: 'internal', detail: (err as Error)?.message }));
        sendJson(res, 200, { degraded: 'internal dashboard error' });
      });
    };
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
          // v24 (DES-142): `?namespace=` is DROPPED — a caller-supplied value is refused, naming
          // the change, rather than silently ignored.
          if (refuseNamespaceParam(req, res)) return;
          if (!isValidSha256Hex(sha)) {
            sendJson(res, 400, { code: 'INVALID_BLOB_REQUEST', message: 'invalid sha256 hex' });
            return;
          }
          cas.putBlobStream(ns, sha, req, { maxBytes: blobMaxBytes, readTimeoutMs: 120_000 }).then((r) => {
            sendJson(res, 200, { sha256: r.sha256, bytes: r.bytes, namespace: ns });
          }).catch((err: unknown) => sendBlobUploadError(res, err));
        });
        return;
      }
      // Auth gate for manifest upload (DES-096: resolve-once before body read)
      if (!dbindExempt && req.method === 'POST' && req.url?.startsWith('/assets/manifest')) {
        void resolvePrincipal(req, authTokenStore!, wwwChallenge()).then(async (p) => {
          if ('status' in p) { send401(); return; }
          // DES-096: principal is the namespace for authenticated manifest uploads (server-derived).
          const ns = p.principal;
          if (refuseNamespaceParam(req, res)) return;
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
                const webhookBaseUrl = `http://${req.headers.host ?? `${bind}:${boundPort}`}`;
                const instructions = await buildInitializeInstructions(webhookBaseUrl, principalFor(p.principal));
                sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, result: { protocolVersion: clientProto ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'remote-workflow-engine', version: ENGINE_VERSION }, instructions } });
                return;
              }
              if (rpc.method === 'notifications/initialized' || rpc.method?.startsWith('notifications/')) {
                res.writeHead(202).end(); return;
              }
              if (rpc.method === 'ping') { sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, result: {} }); return; }
              if (rpc.method === 'tools/list') {
                sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, result: { tools: projectToolsList() } }); return;
              }
              if (rpc.method === 'tools/call') {
                const name = rpc.params?.name ?? '';
                const args = rpc.params?.arguments ?? {};
                const webhookBaseUrl = `http://${req.headers.host ?? `${bind}:${boundPort}`}`;
                const principal: Principal = principalFor(p.principal);
                const result = await callTool(buildToolDeps(webhookBaseUrl), name, args, principal);
                // v24 (DES-140): the ONE case that lifts to a top-level JSON-RPC `error` — every
                // other outcome (schema/authz refusal, a handler's own envelope) is wrapped in
                // `result.content` like before.
                if (result && typeof result === 'object' && 'error' in result && typeof (result as { error?: { code?: unknown } }).error?.code === 'number') {
                  sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, error: (result as { error: { code: number; message: string } }).error }); return;
                }
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
      // v24 orchestrator adjudication #8 (H-1, issue #57) OVERRULES ADJ-A1: the auth gate that stood
      // here — GET /api/workflows/:name/describe as dbindExempt's FOURTH gated member, admitted only
      // via loopback exemption or resolvePrincipal — is REMOVED, so the route joins the other
      // unauthenticated dashboard reads (/api/workflows, /api/runs*, /api/home, /api/system).
      // The dashboard's client is a plain browser fetch with no login and no token, so it satisfied
      // neither condition: with auth.enabled the one route serving the author's diagram and the
      // per-agent params answered 401 and the detail pane was blank. ADJ-A1 bought existence-hiding
      // that /api/workflows already gives away in full (every name, owner, description, versions,
      // channels and the whole per-agent param spec, anonymously). dbindExempt's three remaining
      // members (blob/manifest/mcp) are unchanged, and workflow_source — the privileged view, the one
      // carrying script text — keeps its own protection.
    }
    // v27b (DES-198/DES-199, ARCH-130/123, TASK-203/204, REQ-131/140): the dashboard's own static
    // assets (JS/CSS/fonts) — registered BEFORE the `/dashboard` SPA catch-all below. Route ORDER
    // is a correctness condition, not a style choice: an asset registered after the catch-all would
    // get the HTML page back with a 200 and the browser would silently render nothing. No auth (the
    // same posture as the page it serves). `lookupStaticAsset` is a closed-map `Map.get` — the URL
    // suffix is a KEY, not a path, so no traversal string ever reaches the filesystem (DES-199).
    if (req.url?.startsWith('/static/dashboard/')) {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      const key = req.url.slice('/static/dashboard/'.length).split('?')[0]!;
      const entry = lookupStaticAsset(key);
      // Read BEFORE writing the head: a listed key can still be missing on disk (DES-199's own
      // boundary — "a listed key whose file is deleted... 404s thereafter") and a `writeHead(200)`
      // already sent cannot be taken back for the 404 that follows.
      let body: Buffer | null = null;
      if (entry) {
        try {
          body = readStaticAsset(entry);
        } catch {
          body = null;
        }
      }
      if (!entry || !body) {
        sendJson(res, 404, { error: 'Not found' }); // never echoes the requested key
        return;
      }
      res.writeHead(200, {
        'Content-Type': entry.type,
        'Cache-Control': entry.cache,
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(body);
      return;
    }
    // D-V2V-2 (REQ-008 route-back): a real browser-renderable HTML/JS dashboard page, on the SAME
    // port as /mcp and /api/runs* (one data model, two transports — now genuinely two). SPA-style
    // routing: /dashboard/<runId> serves this exact same static page; its own client JS reads the
    // runId back out of location.pathname.
    if (req.method === 'GET' && (req.url === '/dashboard' || req.url?.startsWith('/dashboard/'))) {
      // DES-061 (TASK-064): lazily re-read the update result so the dashboard shows fresh state
      // even when the engine was NOT restarted after a failed build (the "failed" lazy-read case).
      ingestUpdateResult();
      // v27b (DES-198, ARCH-130, TASK-203, REQ-131): the SPA's own CSP — no inline executable JS
      // remains on this page (the one inline `<script>` left is `type="application/json"`, never
      // prepared for execution, so it needs no nonce); `blob:` in img-src is load-bearing for the
      // author-diagram `createObjectURL` render (REQ-119).
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' blob:; connect-src 'self'",
      });
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
      dispatchDashboard();
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
      // v24 (DES-142): namespace is derived from the caller's own identity, never `?namespace=` —
      // this fallback path (auth-disabled or a loopback-exempt peer) has no resolved id, so `'local'`
      // (ADR-028's ONE sentinel, same as every other no-identity site).
      if (refuseNamespaceParam(req, res)) return;
      const ns = 'local';
      if (!isValidSha256Hex(sha) || !isValidNamespace(ns)) {
        sendJson(res, 400, { code: 'INVALID_BLOB_REQUEST', message: 'invalid sha256 hex or namespace' });
        return;
      }
      const maxBytes = blobMaxBytes;
      cas.putBlobStream(ns, sha, req, { maxBytes, readTimeoutMs: 120_000 }).then((r) => {
        sendJson(res, 200, { sha256: r.sha256, bytes: r.bytes, namespace: ns });
      }).catch((err: unknown) => sendBlobUploadError(res, err));
      return;
    }
    // DES-087 (TASK-081, REQ-082): manifest register — POST /assets/manifest?namespace=<ns>.
    // Registered AFTER the net-guard (DES-087: same placement as the blob route).
    // Parses raw bytes as JSON manifest, validates referenced blobs present, stores manifest as CAS blob.
    if (req.method === 'POST' && req.url?.startsWith('/assets/manifest')) {
      // v24 (DES-142): same namespace-derivation rule as the blob route above.
      if (refuseNamespaceParam(req, res)) return;
      const ns = 'local';
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
          const initWebhookBaseUrl = `http://${req.headers.host ?? `${bind}:${boundPort}`}`;
          const initPrincipal: Principal = authCfg ? { kind: 'loopback-exempt' } : { kind: 'auth-disabled' };
          const instructions = await buildInitializeInstructions(initWebhookBaseUrl, initPrincipal);
          sendJson(res, 200, {
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              protocolVersion: clientProto ?? '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'remote-workflow-engine', version: ENGINE_VERSION },
              instructions,
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
          sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, result: { tools: projectToolsList() } });
          return;
        }
        if (rpc.method === 'tools/call') {
          const name = rpc.params?.name ?? '';
          const args = rpc.params?.arguments ?? {};
          const webhookBaseUrl = `http://${req.headers.host ?? `${bind}:${boundPort}`}`;
          // v24 (ARCH-088): this fallback handler serves BOTH auth-disabled AND a loopback-exempt
          // peer on an auth-ENABLED server (dbindExempt skipped the auth-gated block above) — the
          // two are distinct Principal kinds even though neither carries an id.
          const principal: Principal = authCfg ? { kind: 'loopback-exempt' } : { kind: 'auth-disabled' };
          const result = await callTool(buildToolDeps(webhookBaseUrl), name, args, principal);
          if (result && typeof result === 'object' && 'error' in result && typeof (result as { error?: { code?: unknown } }).error?.code === 'number') {
            sendJson(res, 200, { jsonrpc: '2.0', id: rpc.id, error: (result as { error: { code: number; message: string } }).error });
            return;
          }
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
  // v24 (DES-153, TASK-144/147): bridges `AssetSyncService`'s `AssetCatalogPort` (one flat
  // `listAssets()` over every row) to `WorkflowCatalog`'s per-workflow `putAsset/deleteAsset/
  // listAssets(workflow, kind?)` (TASK-143) — `''` is the catalog's own global-scope sentinel
  // (ARCH-098). `listAssets()` walks every registered workflow name plus the global scope; fine at
  // the human-rate row/workflow counts this engine assumes elsewhere.
  const assetCatalogPort: AssetCatalogPort = {
    putAsset(row) {
      catalog.putAsset({
        workflow: row.scope === 'global' ? '' : (row.workflow ?? ''),
        kind: row.kind, name: row.name, pushedBy: row.pushedBy ?? null, pushedAt: row.pushedAt,
        config: row.config ? JSON.stringify(row.config) : null,
      });
    },
    deleteAsset(c) {
      catalog.deleteAsset(c.scope === 'global' ? '' : (c.workflow ?? ''), c.kind, c.name);
    },
    async listAssets(): Promise<AssetCatalogRow[]> {
      const workflows = await catalog.list();
      const raw = [...catalog.listAssets(''), ...workflows.flatMap((w) => catalog.listAssets(w.name))];
      return raw.map((r) => ({
        scope: r.workflow === '' ? ('global' as const) : ('workflow' as const),
        ...(r.workflow !== '' ? { workflow: r.workflow } : {}),
        // v24 Gate 7.5 (D-13, REQ-113): "a global asset … is marked `builtin:true` in listings".
        // This projection hard-coded `false` for every row, so the one signal distinguishing an
        // engine-level asset every workflow sees from a workflow's own was always absent.
        builtin: r.workflow === '',
        kind: r.kind as AssetKind,
        name: r.name,
        pushedBy: r.pushedBy ?? 'local',
        pushedAt: r.pushedAt,
        ...(r.config ? { config: JSON.parse(r.config) as AssetCatalogRow['config'] } : {}),
      }));
    },
  };
  assetSync = new AssetSyncService({
    // v24 (integrator, adjudication #4 C-7 [12]): the ASSET root, not the bare work root. `main.ts`
    // has always RESOLVED `assetRoot` (defaulting it to `join(workRoot,'assets')`) and this call
    // site never read it — so the operator-facing key did nothing and the writer disagreed with the
    // GC about where a workflow's assets live. One expression now, in asset-sync.ts.
    workRoot: assetRoot,
    globalRoot: globalAssetRoot(workRoot),
    selfBind: { host: bind, port },
    clock,
    catalog: assetCatalogPort,
    probe: mcpProbe,
    egressAllowlist: config?.mcpEgressAllowlist ?? [],
  });
  facade.bindAssetSync(assetSync);
  // v24 (integrator; REQ-113, adjudication #4 C-2's wiring sweep): bind the catalog-backed
  // `resolveMcp` port DES-154 introduced to replace the deleted `mcp-registry.ts`. TASK-145 left it
  // unbound "out of scope", so `agents.<label>.mcp` names resolved to nothing on every dispatch.
  // Workflow scope wins a name clash with global, matching `materializeAssets`' rule for skills.
  // Gate 6.5+7 round 2 (seam-wiring check): this call site used to RE-IMPLEMENT that rule inline
  // over `catalog.assetsOf`, leaving `asset-sync.ts`'s exported `resolveMcp` — the helper DES-153
  // names as THE resolver — with zero production callers. One rule, one implementation, and the
  // production path is now the one `asset-sync-v24.test.ts` already covers. (`assetsOf` is left in
  // place, orphaned in production but still pinned by IT catalog-v24 — v25 debt, not a silent
  // deletion that would weaken a test.)
  if (gateway instanceof ClaudeAgentSdkGatewayClient) {
    gateway.bindResolveMcp((workflow, names) => resolveMcp(assetCatalogPort, workflow, names));
  }

  // v24 (DES-141): the boot announcement — "visibly", built rather than merely asserted.
  // eslint-disable-next-line no-console
  console.log(
    `[remote-workflow-engine] auth: enabled=${authAnnounce.enabled} principals=${authAnnounce.principalsCount} ` +
      `defaultRole=${authAnnounce.defaultRole} ownerlessRuns=${ownerlessRuns} ownerlessTriggers=${ownerlessTriggers}`,
  );

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
