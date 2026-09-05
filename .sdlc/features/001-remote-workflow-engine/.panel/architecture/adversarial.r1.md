# Architecture panel — adversarial group (Security × Scalability/Consistency × Testability), round 1

**Lens:** adversarial architecture group. Three lenses argued separately, conflicts surfaced, Karpathy
simplicity-first as the tie-breaker. **Scope:** v24, REQ-107..118 (01-requirements.md:1125-1250), the
36-tool table in `v24-gate1-working-notes.md` ch. 9 as corrected by ch. 10.1.
**Inputs verified on disk:** `src/server.ts` (2138 lines, `callTool` switch :923-1100, `dbindExempt`
:1727, blob/manifest HTTP ingress :1789-1830), `src/auth/auth-service.ts` (`AuthConfig`, `resolvePrincipal`
→ `{principal: email}`), `src/workflow-catalog.ts` (owner gate :433-438/:480-485/:580, `workflow_diagrams`
:235), `src/store/sqlite-run-store.ts` (`runs.principal` additive column :67, `transitions` :46),
`src/scheduler.ts` (H4 release check :158-167, `schedules.workflow NOT NULL`), `src/webhook-registry.ts`
(`webhooks.workflow NOT NULL, secret`, deliver order :120-150), `src/mcp-registry.ts` (`mcp_provisions`
keyed by global `name`, `provisionedAt` only), `src/mcp-probe.ts` (`fetch(url, HEAD)` :62 and `spawn`
:72 — **not routed through `seedref-egress.ts`'s allowlist**), `src/cas-store.ts` (caller-supplied
`namespace`), `src/asset-sync.ts` (single global `assetRoot/<kind>/<name>`, `list()` returns
`{kind,name}` only), `src/workspace-seed.ts` (STRIP_RE + `.git` + `isPathContained`), `src/params/
contract.ts` (LOCKED_KEYS/TUNABLE_KEYS/DEFAULT_CEILINGS, flat `UserOverrides`), `src/params/resolve.ts`
(`effort`/`timeoutMs` have no per-agent rung), `src/workflow-meta.ts` (`parseWorkflowSkeleton` regex
`CALL_RE`), `src/diagram-gate.ts` (`DIAGRAM_CODEPOINTS` excludes `<`/`>`/`&`), 8 files importing the
analyzer (`dashboard-page, diagram-gate, graph-analyzer, main, mcp-facade, server, workflow-catalog,
workflow-view`), `package.json` (no mermaid dependency; 3 runtime deps), tests: 283 files, 50
integration tests boot `createServer()` directly.

---

## Summary

**Altitude decision first.** The engine is an AI-agent system (it spawns model sessions, sandboxes
scripts that call `agent()`), but **v24 is a control-plane slice**: names, roles, parameters, a
validator, a guide. So: security, scalability/consistency and testability are argued at **system
altitude** throughout. **Agent altitude applies in exactly two places and I apply it only there:**
(1) REQ-116/117 — the *consumer* of this surface is an LLM with nothing but `tools/list` and one guide
call, so tool descriptions, error envelopes and the guide **are the API** (consumability = "a cold model
gets it right first try", not "a developer can read the README"); (2) REQ-110 — "no model name in a
script" is *replaceability at agent altitude*: a workflow must survive its model being retired without
an author edit. Observability/self-sustainability at agent altitude are not moved by v24 and I do not
force them in.

**The slice in one sentence.** v24 is one structural addition, one deletion and a lot of renaming:
the addition is a **single authorization table evaluated once before the tool switch**, on a
`Principal = {id, role}` built at the HTTP edge; the deletion is the whole v23 analyzer subsystem,
replaced by a **pure fixed-grammar Mermaid check** that diffs the diagram's agent set against the
script's literal `agent({label})` set in both directions. Everything else (six workspace tools, per-agent
params, workflow-owned assets, claimable triggers, the guide) is re-shaping existing modules. **Zero new
services, zero new daemons, zero new dependencies (no `mermaid` — it needs a DOM, and the vocabulary is
closed so a fixed grammar is the *honest* meaning of "renders"), one new append-only table (audit),
five new pure files (authz table, path verdict, Mermaid check, tool-spec data, guide builder) against
six deletions, and one data array that drives `tools/list`, authorization, the `errors:` lines, and
the REQ-118 exercise table at once.**

**Where the three lenses actually disagree with each other** (argued in §Conflicts): exact
bidirectional diagram match (security/anti-drift) vs first-try consumability (the refusal has to hand
back both diffs and the guide pointer or a cold model loops); namespace-from-principal (security) vs
the auth-off developer path (needs a sentinel, which is a second code path to test); opening
`mcp_provision` to authors (owner decision, REQ-114) vs a probe that today fetches/spawns arbitrary
author-supplied targets with no egress gate (security says this is a *new* SSRF surface the permission
widening creates); cross-file claim atomicity (consistency) vs not merging four SQLite files
(simplicity); a pure authz table (testability) vs ownership predicates that must read three stores
(resolved by an injected `OwnerLookup` port).

**Requirement gaps I am obliged to flag before design builds them:** (G1) `chain_create`/`chain_list`
deletion is what makes 40→36 (notes ch. 7) but **no REQ-107..118 clause names it**; ARCH-078's `chain`
binding and `UNBOUND_ENTRY_LABEL='workflow_run'` in `trigger-bindings.ts` both die with it. (G2)
notes ch. 9 still shows `workspace_push {runId,path}` but ch. 10.1 and REQ-108 forbid it — REQ-108 is
authoritative; the guide must be generated from the code, not from ch. 9. (G3) REQ-113/114 say assets
become per-workflow but are silent on whether **`mcp_provisions` (global `name` PK) also becomes
per-workflow** — it has the identical fifty-authors collision, and `agent({mcp})` resolves by that
global name. (G4) REQ-115 says triggers are "the user's resources" but does not say **who may claim**:
creator-only, or any author? I propose creator-or-admin and ask for a ruling. (G5) `run_trigger({workflow})`
is keyed by a workflow name and acts on a schedule — it breaks REQ-107's own `run_*`-keyed-by-`runId`
clause; see ARCH-094.

---

## Key points (proposed ARCH-087..096, ADR-023..030, in 02-architecture.md conventions)

### Slice shape (Karpathy check up front)
Touched module roots: `server.ts` (dispatch + schemas), `mcp-facade.ts`, `workflow-catalog.ts`,
`store/sqlite-run-store.ts`, `params/contract.ts` + `params/resolve.ts`, `scheduler.ts`,
`webhook-registry.ts`, `mcp-registry.ts`, `asset-sync.ts`, `cas-store.ts`, `workspace-seed.ts`,
`diagram-gate.ts` (repurposed), `dashboard-page.ts`, `main.ts` (config). New files: **five**, all pure and server-free (tests import them without `createServer()`):
`src/authz.ts`, `src/path-verdict.ts`, `src/mermaid-check.ts`, `src/tool-specs.ts` (data), `src/authoring-guide.ts`
(text builder over the others' exports). Net file count after the deletions below is **−1**.
Deleted: `src/graph-analyzer.ts`, the `graphAnalyzer` config block, `workflow_diagrams` table (mermaid
moves onto the immutable version row — see ADR-025), `diagramStatus` machinery, `continuation-store.ts`
+ `chain_*` (pending G1), `workflow_regenerate_diagram`.

### ARCH-087 — one authorization table, one `Principal`, evaluated once before the tool switch
- **traces:** REQ-109, REQ-114, REQ-107
- **module:** src/authz.ts (pure) + src/server.ts (edge: build `Principal`; `callTool`: one call)
- **deps:** ARCH-060 (principal resolved once at edge), ARCH-051 (drift-lock pattern), ARCH-076
- **api:** `type Role = 'admin'|'author'|'user'`; `type Principal = { kind: 'authenticated'; id: string; role: Role } | { kind: 'auth-disabled'; id: null; role: 'admin' } | { kind: 'loopback-exempt'; id: null }` — the third shape is the D-BIND loopback caller reaching an **auth-enabled** server (`server.ts:1727`), which must NOT be conflated with auth-disabled (ADR-012: masking keys on `authEnabled`, never on `principal == null`); `authorize()` is total over this union with no side flag (auth disabled → `'admin'`, **unchanged single-operator behaviour**; `loopback-exempt` → `PRINCIPAL_REQUIRED` for anything above `minRole:'user'`-with-`ownership:'none'`); `resolveRole(cfg.principals: Record<string, Role> & {'*'?: Role}, id) → Role` (default `user` per owner); `AUTHZ: Record<ToolName, { minRole: Role; ownership: 'none'|'run'|'workflow'|'trigger'|'asset'; adminCrossRead?: true }>`; `authorize(tool, principal, args, lookup: OwnerLookup) → ok | { code: 'FORBIDDEN_ROLE'|'NOT_WORKFLOW_OWNER'|'NOT_RUN_OWNER'|'NOT_TRIGGER_OWNER', … }` where `OwnerLookup = { runOwner(runId), workflowOwner(name), triggerOwner(id), assetOwner(workflow) }` is an **injected port** (the table stays pure; the reads live in the stores that already have the rows: `runs.principal`, `workflows.owner`, new `createdBy` columns).
- **note:** This is the v22-H2 lesson generalized. `mcp_provision` shipped an "Admin tool" *description* with no check because the check lived per-`case` in a 2138-line switch, and the description was the only place the intent existed. With the table, **a tool with no row is a `tsc` error** (`Record<ToolName, …>` is total) and a **drift-lock test** asserts every entry in `tools/list` has a row and every row's `minRole`/`ownership` agrees with the tool's own description text (`ARCH-051` pattern). The per-`case` `resolveWritePrincipal` / `principalRequiredEnvelope` pair (`server.ts:876-886`) collapses into `authorize`: the `loopback-exempt` shape *is* the former `authEnabled && principal === null` condition, now carried in the type instead of a flag threaded through nine positional arguments. The catalog's own owner checks (`workflow-catalog.ts:437/484/580`) **stay** as defence in depth — the table decides, the store re-asserts; a mismatch between the two is a test failure, not a policy.
- **Karpathy:** no role service, no permission DSL, no per-resource ACLs. Three roles, five ownership kinds, one table.

### ARCH-088 — run ownership gate on every `run_*` / `workspace_*({runId})`, server-side `run_list` filter, and the admin cross-read audit row
- **traces:** REQ-109, REQ-108, REQ-107
- **module:** src/store/sqlite-run-store.ts (+ `run-store.ts` port), src/mcp-facade.ts
- **deps:** ARCH-087, ARCH-006 (transitions idiom), ARCH-056 (redaction)
- **api:** `RunStore.getOwner(runId) → string | null`; `RunStore.list({workflow?, status?, principal?, limit}) → RunSummary[]` with a new index `CREATE INDEX IF NOT EXISTS runs_name_status_created ON runs(name, status, createdAt DESC)`; `RunStore.appendAudit({ts, actor, action:'workspace_read'|'workspace_list'|'agent_log_read', runId, owner})` into `audit_events(seq INTEGER PK AUTOINCREMENT, ts, actor, action, runId, owner)` — same append-only idiom as `transitions` (`sqlite-run-store.ts:46`).
- **note:** Working notes ch. 4 verified that `workflow_artifacts`/`workflow_artifact_get`/`workspace_purge` take `{runId}` only and check nothing — any authenticated caller reads any run's workspace, and seeding exists precisely to put real codebases there. `runs.principal` already exists (v15 additive migration), so the gate is a lookup, not a schema change. **`run_list` for a `user` must filter by `principal` in SQL**, not in the facade after a full read (a `user` on a busy engine would otherwise page through everyone's metadata even if the rows are masked). **Admin cross-principal read → one audit row, written before the bytes are served** (REQ-109: "a permission that leaves no trace cannot be reviewed"). No viewer tool — REQ-109 says *write*, and adding `audit_list` is speculative; an admin has the SQLite file. **Owner decision carried in:** a workflow owner does NOT get to read other principals' runs of their workflow (ch. 4); the guide must say a problem report has to carry its own evidence.
- **Consistency:** the audit row and the read are not one transaction (the read is a filesystem op). Order: audit first, then read; a crashed read leaves an audit row for a read that did not happen — acceptable, the reverse is not.

### ARCH-089 — six workspace tools, one shared `pathVerdict`, CAS namespace derived from the principal
- **traces:** REQ-108, REQ-065, REQ-022/023/026
- **module:** src/path-verdict.ts (new, pure), src/workspace-seed.ts, src/asset-sync.ts, src/cas-store.ts, src/mcp-facade.ts, src/server.ts
- **deps:** ARCH-007, ARCH-054/055, ARCH-088
- **api:** `pathVerdict(dest: {kind:'run-workspace', root} | {kind:'asset-tree', root, reservedPrefix}, rel) → {verdict:'ok', abs} | {verdict:'stripped'} | {verdict:'rejected', reason: 'ESCAPE'|'GIT_INTERNAL'|'RESERVED_PREFIX'|'ABSOLUTE'}` — the one function `materializeSeed`, `materializeManifest`, `AssetSyncService.push`, `workspace_pull`, `workspace_delete` all call. Six tools exactly as REQ-108: `workspace_diff({manifest})` (no scope arg; pool = caller's namespace), `workspace_push` (mode A `{sha256, contentB64}` → CAS in the caller's namespace; mode B `{workflow, kind, name, files}` → asset tree; **`runId` present → `INVALID_ARGUMENT` pointing at the guide**), `workspace_pull({runId, path, offset?, length?})`, `workspace_list({runId} | {workflow, kind})`, `workspace_delete({runId, paths[]} | {workflow, kind, name})`, `workspace_purge({runId})`.
- **note (security):** `namespace` today is a caller-typed string — a partition, not a permission (ch. 4). It becomes `principal.id`; the HTTP ingress (`server.ts:1797/1820`) already does exactly this for authenticated uploads, so the MCP tool path merely stops being the exception. **Auth-disabled sentinel is decided now, not later:** `namespace = 'local'` (a fixed string that `isValidNamespace` accepts and that cannot collide with an email). The existing "no cross-namespace dedup" stays (existence oracle). **The `.claude/settings*.json`/`hooks/**` strip and `.git`/`../`/symlink reject apply to the run-workspace destination; `rwe-*` reserved-prefix reject applies to the asset destination** — one function, two rule sets keyed by destination, so they cannot drift (REQ-108's last clause).
- **note (consistency):** "`workspace_delete`/`workspace_purge` refused while the run is `queued|running|suspended`" is a TOCTOU if checked in the facade against a status read: a run can transition between the read and the `rm`. The check belongs **inside `RunManager`'s state path** (the same place that owns transitions), as `runManager.withTerminalRun(runId, fn)` that holds the in-process run entry and refuses if not terminal. Single-process, so this is a mutex, not a lock protocol — say so.

### ARCH-090 — per-agent parameter contract: values live in `meta.params.agents.<label>`, scripts carry names only, ceilings refuse
- **traces:** REQ-110, REQ-090..092
- **module:** src/params/contract.ts, src/params/resolve.ts, src/workflow-meta.ts (label scan), src/agent-executor.ts, src/mcp-facade.ts (`workflow_describe` shape)
- **deps:** ARCH-064..066, ADR-002 (resolve once at admission, run-immutable), ADR-005
- **api:** `ParamContract.agents: Record<label, { model?, effort?, timeoutMs?, appendPrompt?: ParamSpec; skills?: string[]; mcp?: string[] }>`; `UserOverrides = { agents: Record<label, Partial<Record<TunableKey, unknown>>> }` (flat form **removed**, not kept as shorthand — REQ-110 says "gone"); `scanAgentCalls(script) → { labels: string[]; violations: {line, key}[] }` — extends the existing `CALL_RE` scan (`workflow-meta.ts`) to read the literal options object of each `agent(` call; registration refuses with `PARAM_IN_SCRIPT { label, key, hint: 'declare it at meta.params.agents.<label>.<key>' }` if `model|effort|timeoutMs` appears, and with `AGENT_LABEL_NOT_LITERAL` if `label` is not a string literal; `resolveCallParams(label, contract, overrides, agentTypeDefaults, ceilings)` gains the per-label rung for **all four** keys (today only `model` has an intermediate rung — `resolve.ts:74`).
- **note:** Settles ch. 12.3's two open points on Testability grounds: **(a) `label` is REQUIRED on every `agent()` call once `meta.params.agents` is declared** (otherwise the contract cannot be keyed and the diagram check has nothing to match); **(b) duplicate labels are legal and share one spec** (same role run twice) — the check counts *distinct* labels. **Statically decidable requires literal labels**: a template-string or variable label cannot be matched to a Mermaid node at registration, so it is refused, and the guide says so. Ceilings are refusals (`PARAM_OUT_OF_RANGE`), never clamps — `effectiveBounds` continues to *report* the intersection for `describe`, but admission compares and refuses. LOCKED_KEYS unchanged; `skills`/`mcp` under `agents.<label>` are author-owned and validated at registration against the workflow's own + global assets (ARCH-092) — a user override naming them is `PARAM_LOCKED`.
- **Agent-altitude replaceability:** with no model name in a script, retiring a model is a `describe` + `run_start({overrides})` decision by the user, or a `meta` default edit by the author — never a code edit to the workflow's logic.

### ARCH-091 — `checkMermaid(src, scriptLabels)`: a pure fixed-grammar parser for the closed REQ-112 vocabulary, bidirectional label diff, stored on the immutable version row
- **traces:** REQ-111, REQ-112, REQ-116
- **module:** src/mermaid-check.ts (new, pure; `diagram-gate.ts` repurposed into it), src/workflow-catalog.ts (`workflow_versions.mermaid TEXT NULL` — nullable for the migration, see ADR-025), src/dashboard-page.ts
- **deps:** ARCH-071 (append-only version row), ARCH-090 (label scan), ARCH-084 (`textContent` into `<pre>`)
- **api:** `checkMermaid(src: string, scriptLabels: Set<string>) → { ok: true; agents: string[] } | { ok: false; code: 'MERMAID_INVALID'|'MERMAID_RULE_VIOLATION'|'DIAGRAM_SCRIPT_MISMATCH'; rule?: 'SHAPE'|'AGENT_LABEL_FORMAT'|'COLLAPSED_EDGE'|'SUBGRAPH_TITLE'|'LOOP_LABEL'|'DASHED_SKIP'; line?: number; onlyInDiagram?: string[]; onlyInScript?: string[]; see: 'workflow_authoring_guide' }`. Grammar: `flowchart|graph <dir>`, node declarations in the four fixed shapes, one edge per line (`-->`, `<-->`, `-.->`, `-- text -->`), `subgraph <title> … end`, `%%` comments; anything else is `MERMAID_INVALID` with the line. Agent node label must match `/^(?<label>[A-Za-z_][\w-]*)<br\/>(?<model>[^·]+) · (?<effort>low|medium|high|xhigh|max) · (?<timeoutMs>\d+)$/` and the `label` is diffed against `scriptLabels`; **the `model · effort · timeoutMs` triple is diffed against `meta.params.agents.<label>.{model,effort,timeoutMs}.default`** (`checkMermaid` takes `agentDefaults: Record<label, {model?, effort?, timeoutMs?}>` as a third argument and returns `valueMismatch: [{label, key, diagram, meta}]`). REQ-112 puts the values on the picture for the user's benefit; a picture that shows `opus · high` while `meta` defaults to `haiku · low` is the v22 rule-3 failure in miniature, and the compare is the same static pass as the label diff. An agent with no declared default for a key must draw the engine default — the guide states the engine defaults so this is writable.
- **note (Karpathy, ADR-023):** **No `mermaid` dependency.** `mermaid` needs a DOM (jsdom or a headless browser) to answer "renders" and pulls hundreds of transitive packages into a 3-dependency engine; `@mermaid-js/parser` does not cover flowcharts. REQ-112 *fixes* the vocabulary, so "renders" honestly means "is in the grammar we accept", and that grammar is a few hundred lines with total, line-numbered errors — which is also what REQ-116/117 need (a cold model can fix line 7; it cannot fix "mermaid threw"). Risk accepted and stated: something our grammar accepts might not render in real Mermaid (mitigated: the grammar is a strict *subset* of Mermaid flowchart syntax; a Gate 7.5 check renders the guide's examples once in a browser).
- **note (security):** `DIAGRAM_CODEPOINTS` (`diagram-gate.ts:24`) excludes `<`/`>`/`&`, but REQ-112 mandates `<br/>` and `<-->`. The codepoint pass must admit them **and the dashboard must keep `textContent` into `<pre>` (ARCH-084) — no client-side Mermaid renderer**, because an author-controlled label is otherwise an XSS surface into every principal's browser. The diagram is author-supplied and served to *other* principals; the v23 allowlist gate's *reason for existing* (model output published as engine fact) is gone, but the *injection* concern is unchanged and now sits on the author instead of the model.
- **ADR-025 — mermaid on the version row, `workflow_diagrams` dropped:** v23 put the diagram in a separate mutable table because it was *derived* and regenerated (ADR-021). In v24 it is *author-supplied input, validated at registration, never mutated* — exactly the properties of the append-only version row. `deregister` needs no second delete; a new version requires a new `mermaid` (REQ-111), which the NOT NULL column enforces structurally. Migration: the boot migration cannot invent a diagram for existing rows → the column is **nullable** and existing versions get `mermaid = NULL` (`describe` reports `mermaid: null, note: 'LEGACY_NO_DIAGRAM'`); **NOT NULL is enforced on the registration path as a refusal (`MERMAID_REQUIRED`), not by the schema** — which makes "every post-v24 row has a diagram" a *code discipline*, not a structural invariant, so a test must register without `mermaid` and assert the refusal, and a second test must assert no post-migration row is ever written NULL. Owner accepted "malformed diagram blocks a valid registration"; this is the same trade.

### ARCH-092 — workflow-owned assets with `pushedBy`, per-agent selective materialization, admin-only builtins
- **traces:** REQ-113, REQ-114, REQ-109
- **module:** src/asset-sync.ts, src/workflow-catalog.ts (`assets` table), src/gateway/claude-agent-sdk-client.ts (materialize loop :166-175), src/mcp-registry.ts
- **deps:** ARCH-087, ARCH-089, ARCH-071
- **api:** filesystem: `<workRoot>/<workflow>/assets/<kind>/<name>/` and `<workRoot>/assets/<kind>/<name>/` (global, `builtin:true`); catalog table `assets(workflow TEXT NOT NULL, kind, name, pushedBy, pushedAt, PRIMARY KEY(workflow, kind, name))` in `catalog.db` — **`workflow = ''` is the global-scope sentinel** (SQLite refuses expressions in a PK, so no `coalesce`; same sentinel pattern as ADR-028's `'local'` namespace) so `deregister()` deletes the rows **inside its existing transaction** and the directory removal is the compensating FS op afterwards (same order the workspace dirs already follow); `AssetSyncService.list({workflow, kind}) → [{scope:'workflow'|'global', builtin, kind, name, pushedBy, pushedAt}]`; `materializeAssets(runWorkspace, contract.agents)` copies only the union of `agents.*.skills` (per-agent scoping *inside* a run is impossible today — one workspace per run, ch. 3 — so the unit of selectivity is the run's declared set, stated honestly); `mcp_provisions` gains `pushedBy, pushedAt` and — pending G3 — a `workflow` scope column with the same `(workflow, name)` key.
- **note:** Why a table and not a `rwe-meta.json` sidecar per asset dir: `pushedBy` must be *listable* and must die with the workflow in the same transaction as the version rows; a sidecar gives neither without a directory walk. Why `catalog.db` and not a fifth SQLite file: ADR-021's reasoning in reverse — the invariant "an asset row never outlives its workflow" is only structural with the same `Database` handle.

### ARCH-093 — triggers created unclaimed, claimed atomically at registration, released (never deleted) at deregistration; refused-while-unclaimed is recorded
- **traces:** REQ-115, REQ-053, REQ-058
- **module:** src/scheduler.ts, src/webhook-registry.ts, src/workflow-catalog.ts (register sequence), src/mcp-facade.ts
- **deps:** ARCH-071, ARCH-072 (H4 check moves), ARCH-087
- **api:** columns `claimedBy TEXT NULL` (workflow name; `workflow NOT NULL` dropped), `createdBy TEXT` on `schedules` and `webhooks`; `TriggerStore.claim(id, workflow) → 'claimed'|'NOT_FOUND'|'ALREADY_CLAIMED'` implemented as `UPDATE … SET claimedBy=? WHERE id=? AND claimedBy IS NULL` and reading `changes` — **atomic per store**; `release(id, workflow)` symmetric and idempotent; `workflow_register({…, triggers?: string[]})`; `workflow_deregister → {removed, releasedTriggers[]}`; `schedule_list`/`webhook_list` carry `claimedBy`; unclaimed fire: scheduler writes a `run_origins` row with `refused:'TRIGGER_UNCLAIMED'` and starts nothing; webhook **verifies HMAC + timestamp first**, then refuses `409 TRIGGER_UNCLAIMED` and records it in `webhook_deliveries` (an unauthenticated caller must not learn claim state — the refusal is only visible to a caller who holds the secret).
- **note (consistency — the real problem of this slice):** `catalog.db`, `schedules.db`, `webhooks.db`, `mcp-registry.db` are **four SQLite files** (ARCH-078 note (i)). "Register claims triggers and inserts the version" cannot be one transaction. **Sequence:** (1) all pure checks (parse, params, `checkMermaid`, label scan) — nothing written; (2) claim each trigger id in its store (atomic each; on the first `ALREADY_CLAIMED`/`NOT_FOUND`, release the ones already claimed — idempotent compensation — and refuse `TRIGGER_ALREADY_CLAIMED`/`TRIGGER_NOT_FOUND`); (3) insert the version row in `catalog.db`'s `.immediate()` transaction; (4) if (3) throws, release the claims (compensation). Deregister: release inside the catalog transaction's *after* hook — a crash between the version delete and the release leaves a claim pointing at a deleted workflow; **the scheduler treats `claimedBy` naming a non-existent workflow as unclaimed** (refuses + records), so the failure mode is "trigger needs manual re-claim", never "trigger fires a phantom". **Single-process assumption stated:** the engine is one Node process with one writer per file; this is not a distributed protocol and must not be dressed as one. **Rejected alternative (ADR-026):** merge the trigger stores into `catalog.db` for a true transaction — fewer failure modes, but it is a data migration of three live tables for one claim edge case, and the compensation above is three lines. Name it, don't do it.
- **H4 moves:** the `resolve(…, {channel:'release'})` check at `scheduler.ts:158-167` and `webhook-registry.ts:97` is deleted (a trigger no longer names a workflow at creation); `workflow_register` validates each id exists and is unclaimed. Per carried-in rule 3, the fifteen-instance lesson: the ARCH-072 note 1, the `SqliteSchedulerPort` docblock (:51), the `WebhookRegistry` header (:3, :25), `catalogResolveErrorEnvelope`'s two call sites and the two tests asserting `CHANNEL_UNPUBLISHED` from `schedule_create`/`webhook_create` **all** move with it; the design gate should list them by line. **Firing an unpublished-but-claimed workflow:** the fire path resolves `release` at fire time (it already does, via `runManager.start`) and refuses `CHANNEL_UNPUBLISHED` — recorded like any refusal.

### ARCH-094 — `TOOL_SPECS`: one data array drives `tools/list`, the `errors:` line, authorization, and the REQ-118 exercise table
- **traces:** REQ-107, REQ-116, REQ-118, REQ-109
- **module:** src/tool-specs.ts (new, data), src/server.ts (`tools/list` becomes a projection), tests/acceptance
- **deps:** ARCH-087, ARCH-051
- **api:** `TOOL_SPECS: ReadonlyArray<{ name: ToolName; entity: 'workflow'|'run'|'workspace'|'schedule'|'webhook'|'issue'|'env'; key: 'name'|'runId'|'id'|'number'|null; inputSchema; description; errors: ErrorCode[]; dependsOn?: ToolName[]; authz: {minRole, ownership} }>`; `tools/list = TOOL_SPECS.map(project)` where `project` appends `Errors: …` and `See also: …` deterministically; the REQ-107 prefix rule is a **unit test over the array** (`name.startsWith(entity + '_')`, and `entity==='run' && key !== null ⇒ key==='runId'` — creators are keyed by the parent's key, so `run_start({name})` has `key:null`), not a review item. **G5 (ruling needed):** `run_trigger({workflow})` sits in ch. 9's run table but is keyed by a *workflow* name and acts on a *schedule*; it violates REQ-107's own "`run_*` keyed by `runId`" clause. Either it becomes `schedule_trigger({id})` (keyed by the trigger it fires — consistent with REQ-115's claimed-trigger model) or REQ-107 is amended; a drift-lock that is red on day one is worse than none.
- **REQ-118 last clause:** `workflow_list` reports `runnable` (= `release` pointer non-null) per row and accepts `onlyRunnable`; the filter is applied in the catalog query, and a `user` role's default view is `onlyRunnable:true` so drafts that will refuse are not shown.
- **note (agent altitude, consumability):** REQ-117 says the description text *is* the API. Notes ch. 10.3/10.4 found the two first-try traps: `register → run_start` hits `CHANNEL_UNPUBLISHED`, and nothing says "poll `run_status` until terminal, then `run_result`". Those sentences must live **on `run_start`'s row**, and a test asserts `TOOL_SPECS.find(run_start).description` contains both — a doc defect (REQ-117) is then a red test, not a re-read. Old names are simply not in the array → unknown-tool, no deprecation branch anywhere (owner decision).

### ARCH-095 — `workflow_authoring_guide`: assembled from exported constants and a `GUIDE_EXAMPLES` array that a test registers against a booted engine
- **traces:** REQ-116, REQ-117, REQ-112, REQ-110
- **module:** src/authoring-guide.ts (new, pure text builder), tests/integration
- **deps:** ARCH-090 (LOCKED_KEYS, DEFAULT_CEILINGS), ARCH-091 (vocabulary), ARCH-094
- **api:** `buildAuthoringGuide({ceilings, lockedKeys, vocab, examples}) → string`; `GUIDE_EXAMPLES: ReadonlyArray<{ title; script; mermaid; expectRegister: 'ok' }>` exported; **one integration test iterates the array, calls `workflow_register` over real MCP HTTP against `createServer()` and asserts `{version}`** — the v23 `AUTHORING.md` defect becomes structurally impossible. Every registration-time refusal envelope (`PARSE_ERROR`, `PARAM_IN_SCRIPT`, `MERMAID_*`, `DIAGRAM_SCRIPT_MISMATCH`, `TRIGGER_*`) carries `see: 'workflow_authoring_guide'`.
- **note:** `docs/AUTHORING.md` (ARCH-086) becomes a generated artifact of the same builder or is deleted — two sources of authoring truth is how v23 taught an invalid example. Testability wins: generate it, and a CI check diffs it.

### ARCH-096 — REQ-118 live-engine exercise as a table-driven acceptance test
- **traces:** REQ-118
- **module:** tests/acceptance/v24-tool-surface.test.ts
- **deps:** ARCH-094
- **api:** for each `TOOL_SPECS` row: one happy call with required args, one call per `errors[]` entry where constructible, response asserted against the row's documented contract; rows that need GitHub/OpenRouter credentials emit `UNVERIFIED(reason)` rows into the same table (never skipped silently); the table is written to `08-validation.md` by the test itself.

### ADR summary
- **ADR-023** no `mermaid` dependency; fixed grammar is the honest "renders" for a closed vocabulary.
- **ADR-024** no role service / ACLs; one total `Record<ToolName, …>` table, ownership via an injected port.
- **ADR-025** mermaid on the immutable version row; `workflow_diagrams` dropped; legacy rows `NULL` and blocked from re-registration without a diagram.
- **ADR-026** no store merge; cross-file claim via atomic conditional `UPDATE` + idempotent compensation; single-process assumption explicit.
- **ADR-027** one append-only `audit_events` table in the run store; no viewer tool.
- **ADR-028** auth-disabled CAS namespace sentinel `'local'`; auth-disabled principal `{id:null, role:'admin'}`.
- **ADR-029** literal-only `agent({label})`; label required when `params.agents` declared; duplicates share a spec.
- **ADR-030** `mcp_provisions` becomes workflow-scoped with `pushedBy` (pending G3), and **author MCP push is gated on an egress allowlist for the probe** (see R1).

---

## Risks

- **R1 (BLOCKING, security):** REQ-114 widens `mcp_provision` from admin-in-name to `author`. `McpProbe` (`mcp-probe.ts:62/72`) does a `fetch(HEAD)` to an author-supplied URL and `spawn()`s an author-supplied command **with no egress gate** — ARCH-052's allowlist covers `seedRef` only. Today this was acceptable because the single operator was the only caller; with authors it is (a) an SSRF/port-scan oracle (`MCP_PROBE_FAILED` vs `ok` leaks reachability of internal hosts) and (b) arbitrary command execution on the engine host for `stdio` kind. **Proposal:** `http` kind must pass `isEgressAllowed(url, cfg.mcpEgressAllowlist)` (reuse `seedref-egress.ts`, default empty = refused); `stdio` kind stays **admin-only** regardless of REQ-114's widening — the requirement says "MCP config", and I read command-spawning configs as outside what the owner meant to open. Needs an owner ruling; without it REQ-114 should not ship as written.
- **R2 (consistency):** the four-file claim/release sequence (ARCH-093) has two crash windows; both degrade to "trigger unclaimed / needs re-claim", never to a phantom fire — but only if the scheduler's "claimedBy names a missing workflow ⇒ treat as unclaimed" rule is implemented and tested. A missed rule here is a trigger firing a deregistered workflow's stale `release` pointer — the exact thing REQ-115 exists to end.
- **R3 (security/consumability conflict):** exact bidirectional match refuses the honest author who adds an agent and forgets the picture. Acceptable per owner, **but only if the refusal carries `onlyInScript`/`onlyInDiagram` and the guide pointer**; a bare `DIAGRAM_SCRIPT_MISMATCH` fails REQ-117 on the first real run.
- **R4 (security):** admitting `<`/`>` into the diagram codepoints re-opens the dashboard XSS the v23 gate closed, unless `textContent`-only rendering is kept and asserted by test (ARCH-084's grep guard should be extended to forbid any Mermaid client library import).
- **R5 (scalability):** `run_list` without an index is a full scan of `runs`; `runs.principal` filter for `user` role adds a second predicate — the composite index in ARCH-088 is required, not optional. Also `workspace_list({runId})` computing `sha256` per file (ch. 9) is O(bytes) per call; cap it with the existing `DEFAULT_MAX_CHUNK` discipline or make `sha256` opt-in.
- **R6 (testability):** the static `agent()` option scan is regex-based (`CALL_RE`). It will be fooled by `agent(prompt, opts)` where `opts` is a variable. **Decision:** refuse non-literal option objects too (`AGENT_OPTS_NOT_LITERAL`) — the alternative (a real JS parser) is a new dependency for a rule the guide can state in one line. Stated as a Karpathy call; the design gate may overrule if authors need computed opts.
- **R7 (migration):** legacy versions get `mermaid = NULL`; every `describe` of a legacy version must say so and every re-registration must supply one. Also `defaults` (ARCH-062 harness defaults) and the new `params.agents` overlap — the flat `defaults` should be refused when `params.agents` is present, or its role stated; otherwise two precedence rungs describe the same knob.
- **R8 (requirement gaps G1–G5)** above — G1 (chain deletion unnamed), G3 (mcp_provisions scope), G4 (who may claim) and G5 (`run_trigger` naming) each change a schema or a tool name; they need a ruling *before* Gate 3/4, not a design-time assumption.
- **R9 (REQ-117 protocol):** the "cold model" subject must be a fresh instance with a stub MCP client and nothing else; the test harness must **not** load this repo's `CLAUDE.md`/memory into the subject (the `rwe-workspace-memory-leak` finding — workRoot nested under a Claude project leaks operator context). The probe must run from outside the project tree.

---

## Conflicts between my three lenses (argued, with the tie-break)

1. **Exact bidirectional diagram match** — Security/anti-drift wants refusal; Consumability wants tolerance. Tie-break: refuse (owner + statically decidable), but the refusal is a *diff*, not a boolean (R3). Cost: one more error shape.
2. **Namespace from principal vs auth-off developer path** — Security wants no caller-typed partition; Testability hates a sentinel because it is a second branch. Tie-break: one constant `'local'`, chosen at the edge where `Principal` is built, so every downstream module sees exactly one code path (`principal.id ?? 'local'` appears once).
3. **Opening MCP push to authors vs the probe's egress** — the owner's traceability argument (pushedBy makes it auditable) is right for *who*, wrong for *what the probe can reach*. Tie-break: audit ≠ containment; gate the probe (R1). This is the one place I recommend the architecture push back on a Gate 1 decision.
4. **Cross-file atomicity vs not merging stores** — Consistency wants one transaction; Simplicity refuses a three-table migration. Tie-break: conditional `UPDATE` + compensation + the "missing workflow ⇒ unclaimed" rule (ADR-026). If Gate 7.5 finds a phantom fire, the merge is the fallback, not more compensation code.
5. **Pure authz table vs ownership reads** — Testability wants `authorize()` pure; Security needs it to see `runs.principal`/`workflows.owner`/`triggers.createdBy`. Tie-break: an injected `OwnerLookup` port; unit tests pass a map, integration tests pass the stores.
6. **Table-driven `tools/list` vs hand-written descriptions** — Consumability (agent altitude) wants rich prose per tool; Testability wants the prose asserted. Tie-break: prose lives in the array so it can be asserted; the array is the only source.

---

## Expected disagreements with other lenses

- **Domain/product lens** will likely want a deprecation alias layer "just for `workflow_run`". Owner ruled no window; I agree and add: any alias is a second row in `TOOL_SPECS`, visible in `tools/list`, and REQ-117's cold model *will* pick the wrong one.
- **Data/consistency purists** will argue for merging the four SQLite files into one (`catalog.db`) so claims are transactional. I name it as ADR-026's rejected alternative; I expect to be asked to justify the compensation path with a test that kills the process between steps (2) and (3) — that test should exist.
- **DX/consumability lens** may propose keeping `graph-analyzer` as an *optional* diagram generator to seed the author's `mermaid`. I object: it is 487 lines + a config block + a trust inversion (v23 ARCH-079 note) kept for convenience; REQ-111 says removed, and the guide's examples are the seed.
- **Simplicity purists** may object to `audit_events` as a new table for one admin action. I hold: it is REQ-109's explicit clause, one `CREATE TABLE`, one insert, no reader.
- **Security maximalists** may want per-file ACLs inside a run workspace or per-agent workspaces. Out of scope; ch. 3 verifies one workspace per run and no agent isolation — an existing, stated design, not a v24 defect.
- **Someone will propose a real Mermaid render check via jsdom in tests only.** Fine as a Gate 7.5 one-off over `GUIDE_EXAMPLES`; not as a runtime dependency.
- **The merger will ask whether `TOOL_SPECS` + `AUTHZ` + `GUIDE_EXAMPLES` are three arrays or one.** Two: `TOOL_SPECS` (per tool, includes authz) and `GUIDE_EXAMPLES` (per example). Not one, because examples are not tools.
