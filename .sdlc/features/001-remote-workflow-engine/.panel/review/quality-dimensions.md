---
stage: review
lens: quality-dimensions (observability · replaceability · consumability · self-sustainability)
iteration: v24
baseline: 02-architecture.md ARCH-087..108 + ADR-023..035 (§ "v24 slice")
tree: HEAD = fb13c24
consistent: no
violations: 16
---

# Gate 8 review — quality dimensions vs. the v24 architecture

**Scope.** The v24 IMPL entries' own `files:` lines (IMPL-178..187) plus the three commits that
landed after IMPL-187 with no ledger entry (`d43d6d7`, `caf15c1`, `e9db0c4` — see O-4). Read:
`tool-specs.ts`, `authz.ts`, `owner-lookup.ts`, `call-tool.ts`, `mcp-facade.ts`, `errors.ts`,
`path-verdict.ts`, `authoring-guide.ts`, `check-mermaid.ts`, `params/contract.ts`,
`params/resolve.ts`, `workflow-catalog.ts`, `asset-sync.ts`, `mcp-probe.ts`, `scheduler.ts`,
`webhook-registry.ts`, `workflow-view.ts`, `audited-read.ts`, `store/sqlite-run-store.ts`,
`types.ts`, `agent-executor.ts`, `gateway/claude-agent-sdk-client.ts`, `dashboard-page.ts`,
plus the targeted seams in `server.ts` / `main.ts`. No full-tree scan.

**Note on invariants.** This ledger declares no `INV-*` items. The invariants checked are the
architecture's own bolded cross-component rules: audit-before-bytes (ARCH-091 note 2), one CAS
namespace derivation (ADR-028 — see R-6), grammar-is-a-strict-subset (ADR-023), descriptor records the
*materialized* set (ARCH-103/104), refuse-never-clamp (ARCH-094), one shared path verdict
(ARCH-093/REQ-108), `TOOL_SPECS` is the only tool surface (ARCH-087), materialization is additive
(ADR-034), one claim model across both trigger stores (ADR-026).

**Verdict rule used:** `consistent: no` if any finding is HIGH or MEDIUM. `violations` counts every
row below, all severities.

**Severity counts:** HIGH 1 · MEDIUM 6 · LOW 9.

---

## 1. Observability

*Checked and found sound:* the `kind:'harness'` transcript event carries `label`, per-key
`provenance` and `materialized:{skills,mcp,missing}` (`agent-executor.ts:429-441`) and is read back
by `run_agent_log` (`mcp-facade.ts:629-634`) — including the honest `missing: declaredNames`
fallback when a gateway materializes nothing. `auditedWorkspaceRead` appends **before** any byte and
rethrows an append failure as `INTERNAL_ERROR` (`audited-read.ts:35-45`); all four audited actions
route through it (`mcp-facade.ts:586/628/703/719`) and the run owner reads them back on
`run_status.adminReads[]` (`mcp-facade.ts:571`) — ARCH-091 note 2 / ADR-027 hold. Every one of
`RefusalReason`'s four members is now written on both fire paths (`server.ts:756-786`,
`webhook-registry.ts:256-283`) and projected by both `list()`s (`scheduler.ts:146-148`,
`webhook-registry.ts:180-182`) — ADR-031 holds. `graphAnalyzer` as a stale config key produces the
one ADR-025-naming boot warning (`main.ts:135-139`) — ARCH-090 holds.

### O-1 — MEDIUM — ARCH-101: the trigger-binding projection was deleted, not shrunk; `inRelease` is gone
- **violated:** ARCH-101 (`module: src/trigger-bindings.ts`, `getTriggerBindings(name) →
  TriggerBinding[]` with `{kind; id; claimedBy; inRelease}`), which explicitly says the module
  *survives* because "`workflow_describe.triggers[]` still needs one projected cross-store snapshot".
- **evidence:** `grep -rn getTriggerBindings src/` → no production hit; the file is listed DELETED in
  `06-impl-log.md:2715` (IMPL-180). The replacement is a facade-private
  `McpFacade._resolveTriggers` at `src/mcp-facade.ts:261-271`, typed `unknown[]`, which unions the
  version row's declared ids with `claimedIdsFor()` from both stores and returns the **raw store
  rows** (`ScheduleStatus` / `WebhookView`) rather than a binding projection; consumed at
  `src/mcp-facade.ts:444`.
- **why it matters (observability):** `inRelease` is not computed anywhere. ARCH-101/ADR-026 make
  fire-time membership (`triggers[]` on the *release* version) the thing that decides whether a
  claimed trigger fires; `workflow_describe.triggers[]` is the surface a reader consults, and it
  now cannot distinguish "claimed and in the release" from "claimed but dropped from the release".
  The state is only discoverable *after* the trigger silently declines to fire, via
  `schedule_list.lastRefusalReason = NOT_IN_RELEASE`. REQ-115's headline consequence
  ("`workflow_publish` moving `release` changes the effective trigger set") is therefore not
  observable before the fact.
- **secondary:** the projection is a private method returning `unknown[]`, so the describe view's
  `triggers[]` shape is neither typed nor pinned; a store adding a field silently widens a public
  read surface.

### O-2 — MEDIUM — ARCH-097 / ADR-029: the value-triple check is opt-in, and its refusal says nothing
- **violated:** ARCH-097's api (`valueMismatch: Array<{label; key; diagram; meta}>` on the refusal;
  agent node text **matches** `^label<br/>model · effort · timeout$`) and its stated rationale
  ("a bare mismatch fails REQ-117 on the first real run … both diff sets and the guide pointer are
  on every refusal"); ADR-029's soundness argument ("there is always a declared value to compare
  the picture against").
- **evidence:** `src/check-mermaid.ts:198` — `if (parts.length < 2) continue; // no meta on this
  node — nothing to compare`. An agent node written as `A(["analyze"])` with no `<br/>` triple
  skips the comparison entirely; `src/authoring-guide.ts:344-348` then teaches that the triple is
  optional. When the check *does* fire, `src/check-mermaid.ts:210` returns
  `err('VALUE_MISMATCH', { line: node.line })` — no label, no key, no diagram-vs-meta values.
- **why it matters:** the value triple exists to catch "the picture says opus, the meta says haiku"
  — the drift ADR-029 says this ledger "has met fifteen times". As shipped an author avoids the
  check by omitting the triple, and an author who hits it is told only a line number.

### O-3 — LOW — ARCH-092: the audit action vocabulary in the architecture is not the vocabulary in the store
- **violated:** ARCH-092's api — `appendAudit({… action:'workspace_list'|'workspace_pull'|
  'agent_log_read' …})`.
- **evidence:** `src/types.ts:170` — `AuditAction = Extract<ToolName, 'workspace_list' |
  'workspace_pull' | 'run_agent_log' | 'run_result'>`. `'agent_log_read'` does not exist; a fourth
  member (`run_result`, correctly added per DES-151 and IMPL-184(g)) was never written back into
  ARCH-092.
- **why it matters:** the architecture is the document an operator greps `audit_events.action`
  against. Low severity — the code's vocabulary is the better one (it is `ToolName`-derived and
  cannot drift from the tool surface); the defect is that ARCH-092 was never amended.

### O-4 — LOW — traceability: three post-IMPL-187 commits carry no ledger entry, and `state.yaml` still reports D-14 open
- **violated:** the ledger's own IMPL-per-change rule, recorded as a recurring gap at
  `06-impl-log.md:2697` ("EIGHTH occurrence") and `:2771` ("NINTH occurrence"). This is the tenth.
- **evidence:** `git diff --stat dc2629d..HEAD -- src scripts docs` → 7 files changed
  (`src/authoring-guide.ts`, `src/errors.ts`, `src/mcp-facade.ts`, `src/scheduler.ts`,
  `src/tool-specs.ts`, `src/workflow-catalog.ts`, `docs/AUTHORING.md`) across `d43d6d7` (D-14),
  `caf15c1` (F-4a), `e9db0c4` (F-4b); `06-impl-log.md` ends at IMPL-187, whose last commit is
  `dc2629d`. Separately `state.yaml:7` still reads "REQ-116 red on ONE clause: D-14 … Route back to
  Gate 6", while `fb13c24`'s subject is "stop calling D-14 an open defect".
- **why it matters:** the ledger is the only observability surface over the implementation itself;
  a Gate 8 reader working from `06-impl-log.md` + `state.yaml` gets a tree state that is two fixes
  and one gate outcome behind the tree.

---

## 2. Replaceability

*Checked and found sound:* `authorize()` is pure with ownership behind the injected `OwnerLookup`
port (`authz.ts:33-35`, bound once at the composition root in `owner-lookup.ts:20-28`) — ADR-024's
"swap `resolveRole`, not 35 call sites" holds. `pathVerdict`/`lexicalVerdict` is the single shared
write decision and **every** call site passes its `dest` explicitly (`workspace-seed.ts:29,36`,
`asset-sync.ts:261,284,323`, `mcp-facade.ts:744`), so the default-argument hazard is not live and
the two private copies really are gone (`grep -c "STRIP_RE\|safeRelPath"` → 0/0) — ARCH-093 /
REQ-108 hold. `authoring-guide.ts` imports `LOCKED_KEYS`/`TUNABLE_KEYS` (`:13`) and
`SHAPES`/`EDGE_FORMS` (`:18`) and renders them (`:226,:231,:310`) rather than re-typing them —
ARCH-107 / ADR-032 hold. No `mermaid` runtime dependency, and UT-161's grep guard enforces it
(`tests/unit/no-retired-surface.test.ts:41-44`) — ADR-023/ADR-033 hold.

### R-1 — MEDIUM — ARCH-099 / ARCH-100 / ADR-026: one claim model, two different implementations and two different column vocabularies
- **violated:** ARCH-099 ("the `workflow NOT NULL` column is **migrated** (`claimedBy = workflow`,
  then dropped)"); ARCH-100 ("`webhooks` gains **the same five columns** as ARCH-099 —
  `claimedBy`, `createdBy`, `refusalCount`, `lastRefusedAt`, `lastRefusalReason` … `list()` carries
  `claimedBy`"); ADR-026's single name-level claim.
- **evidence:**
  - schedules: `src/scheduler.ts:167-196` keeps `workflow` **and** adds `claimedBy`; nothing drops
    or back-fills the legacy column. Both are live doors — `src/scheduler.ts:271` (`WHERE claimedBy
    = ? OR workflow = ?`) and `src/server.ts:761` (`scheduler.get(id)?.claimedBy ?? firing.workflow`).
  - webhooks: `src/webhook-registry.ts:90-96` and the v24 rebuild at `:117-127` define **no**
    `claimedBy`; `claim()`/`release()` write the legacy `workflow` column
    (`src/webhook-registry.ts:194-208`), and `WebhookView` (`:40-52`) exposes `workflow`, never
    `claimedBy`.
  - the fire-time claim/publish/membership gate is consequently written **twice, in two modules**:
    `src/server.ts:756-777` for schedules and `src/webhook-registry.ts:256-283` for webhooks.
- **why it matters (replaceability + consumability):** the architecture's whole argument for the
  claim model is one rule, one shape, two stores behind the same three primitives. As shipped, the
  concept "which workflow holds this trigger" has two column names and two gate implementations
  that must be kept in step by hand — the drift shape ARCH-093 and ADR-031 are elsewhere written to
  prevent. It has already cost one live defect: D-1b (a deregistered trigger still pointing at the
  deleted name through the legacy `workflow` column, inherited by a same-name re-registration) is
  exactly this second door, and `src/mcp-facade.ts:344-347` documents it. A cold model reading
  `schedule_list` then `webhook_list` sees the same concept under two keys.

### R-2 — LOW — ARCH-087: `tool-specs.ts` imports a value from `src/`, and its own header says it does not
- **violated:** ARCH-087 — "Pure data + one projection; **imports nothing from `src/`**".
- **evidence:** `src/tool-specs.ts:5` — `import { ERROR_CATALOG, type ErrorCode } from
  './errors.js';` (a value import, used at `:884`), while `src/tool-specs.ts:3-4` claims it "imports
  only the `ErrorCode` TYPE from errors.ts".
- **why it matters:** benign at runtime (`errors.ts` imports nothing, so there is no cycle with
  `authz.ts → tool-specs.ts`), but two documents — the architecture and the file's own header —
  both describe a boundary the file does not have. Repair is the declaration, not the code.

### R-3 — LOW — ARCH-096 / ARCH-097: the `module:` paths name files that do not exist
- **violated:** ARCH-096 `module: src/workflow-meta.ts` (for `scanAgentCalls`); ARCH-097
  `module: src/diagram-gate.ts` (for `checkMermaid`).
- **evidence:** shipped homes are `src/scan-agent-calls.ts` and `src/check-mermaid.ts`
  (`src/workflow-catalog.ts:22-23`); `diagram-gate.ts` is DELETED (`06-impl-log.md:2715`).
- **why it matters:** already adjudicated at Gate 3/4 as "instance #17 of a description that stopped
  matching the thing it describes" and corrected in `04-design.md:5316-5317` and `03-tasks.md` —
  but ARCH-096/097 were never amended, so the *architecture's* traceability key still points at
  nothing. Same class as the ARCH-088 correction already recorded in-place at
  `02-architecture.md:2143`.

### R-4 — LOW — ARCH-088: the `Principal` union in the architecture is not the shipped one
- **violated:** ARCH-088's api — `{kind:'authenticated'; id; role} | {kind:'auth-disabled'; id:null;
  role:'admin'} | {kind:'loopback-exempt'; id:null}`.
- **evidence:** `src/authz.ts:16-21` — the role **is** the kind: `{kind:'user'|'author'|'admin';
  id} | {kind:'auth-disabled'} | {kind:'loopback-exempt'}`. The 2026-09-04 correction at
  `02-architecture.md:2143` amended argument order and `triggerOwner` arity but not this.
- **why it matters:** DES-139 is operative and the shipped shape is the better one (no separate
  `role` field to drift from `kind`). The defect is the un-amended prose, which is what the next
  reader builds against — the same failure the 2143 note calls "instance #16".

### R-5 — LOW — ARCH-103 / ADR-034: selective materialization exists on one gateway backend only
- **violated:** nothing literally — ARCH-103's `module:` is
  `src/gateway/claude-agent-sdk-client.ts`. Recorded because ADR-034's "honest limit" paragraph
  enumerates the limits of selective materialization and does not name this one.
- **evidence:** `materializeAssets` is defined and called only in
  `src/gateway/claude-agent-sdk-client.ts:146,498`; `src/gateway/client.ts:96` states "other
  gateways ignore it, unchanged"; `src/main.ts:44-47` exposes `gateway: 'sdk' | 'direct-fetch'`,
  and `direct-fetch` selects `LiteLLMGatewayClient`, which never materializes.
- **why it matters (agent-altitude replaceability):** the LLM-backend swap the architecture treats
  as a config change silently changes REQ-113 behaviour — a declared skill/MCP is simply never
  placed. It is not *unobservable* (`agent-executor.ts:441` records `missing: declaredNames`), but
  a config-level backend switch changing a requirement's behaviour belongs in the ADR's stated
  limits.

### R-6 — LOW — ADR-028: the CAS-namespace sentinel does not appear "exactly once"
- **violated:** ADR-028 / ARCH-091 — "one constant `'local'` chosen at the edge where `Principal`
  is built, so `principal.id ?? 'local'` appears **exactly once** (ARCH-091)".
- **evidence:** the derivation is a shared exported function, which is the right shape but not the
  named site: `casNamespaceFor` lives in `src/cas-store.ts:44-46` and is called from
  `src/mcp-facade.ts:55` (write side) and `src/run-manager.ts:379,407,517` (read side). A second,
  hand-typed literal survives at `src/server.ts:1195` — `const ns = 'local';` on the blob-upload
  no-identity fallback, where `casNamespaceFor(null)` is the same value by hand.
- **why it matters:** the value is currently identical everywhere, so nothing is broken. It is
  recorded because this exact invariant already failed once in this iteration — IMPL-178 records
  the write side deriving the namespace while the read side spelled it `'_default'`, so every
  seeded run failed `MISSING_BLOBS` — and one hand-typed copy of the sentinel is how that returns.

---

## 3. Consumability

*Checked and found sound:* `TOOL_SPECS.length === 35` is pinned (`tests/unit/tool-specs.test.ts:19`)
and `run_start`'s row carries both REQ-117 first-try trap sentences verbatim
(`src/tool-specs.ts:330`) — ARCH-087's consumability note holds. Nothing clamps a parameter: the one
`Math.min` in `params/contract.ts:171` is `effectiveBounds`' author-range ∩ ceiling *report*, which
ARCH-095 requires; ceilings refuse — ARCH-094's refuse-never-clamp holds. `EXPECTED_DESCRIBE_KEYS`
(`src/workflow-view.ts:121-125`) carries no `diagram*` key and does carry `mermaid`/`mermaidNote` —
ARCH-105 holds. `DIAGRAM_SCRIPT_MISMATCH` carries **both** diff sets
(`src/check-mermaid.ts:189-193`) — ARCH-097's diff half holds.

### C-1 — HIGH — ARCH-087 / DES-137: `PRINCIPAL_REQUIRED` is a live wire code that is not in the closed `ErrorCode` catalog
- **violated:** ARCH-087 (`errors: ErrorCode[]` tsc-checked against the closed catalog; the array
  **is** the tool surface) and IMPL-178's own stated bidirectional drift lock
  (`06-impl-log.md:2685`: "every code OBSERVED from a real call must be declared").
- **evidence:** `src/authz.ts:37` declares `AuthzErrorCode` including `'PRINCIPAL_REQUIRED'`;
  `src/authz.ts:89` returns it; `src/call-tool.ts:136` puts `verdict.code` **verbatim** into the
  wire envelope's `code` field. `grep -n 'PRINCIPAL_REQUIRED' src/errors.ts` → no hit; no
  `TOOL_SPECS` row lists it (`grep` over `src/tool-specs.ts` → no hit). It is a real, tested wire
  outcome: `tests/integration/catalog-write-auth-dbind.test.ts:138,155,174`.
- **failure:** an unauthenticated loopback caller on an auth-enabled engine calling any tool whose
  resolved row is not `{minRole:'user', ownership:'none'}` receives `{"code":"PRINCIPAL_REQUIRED"}`
  — a code no `tools/list` reader can anticipate (it is on no row's `errors[]`). `refusalEnvelope`
  puts `verdict.code` on the wire **without** passing it through `errors.ts:131`'s `toErrorCode()`,
  so the closed-union guard never sees it at all; and it is a code the authoring
  guide's error section (rendered from `ERROR_CATALOG`, `authoring-guide.ts:193-197`) cannot
  mention. This is precisely the class IMPL-178 says it locked in both directions; the lock has a
  hole because authz refusals are minted *before* the dispatch switch and no acceptance fixture
  constructs a loopback-exempt principal.

### C-2 — MEDIUM — ARCH-088 / ADR-024 / `02-architecture.md:2642`: no authorization refusal ever carries a `see` pointer, and one code carries two different ones
- **violated:** ARCH-088's api (`{ok:false; code; see: 'workflow_authoring_guide'|null}`);
  `02-architecture.md:2642` — for `workflow_register`, "**every refusal** carries
  `see:'workflow_authoring_guide'`", with `NOT_WORKFLOW_OWNER` and `FORBIDDEN_ROLE` on that row's
  own error list; `src/errors.ts:3-6`'s stated rule that `see` is attached "in this ONE place
  (never hand-typed again at a call site)".
- **evidence:**
  - `src/authz.ts:70` hand-types `see: 'workflow_authoring_guide'` on **every** refusal —
    a call-site copy of the pointer the catalog owns.
  - `src/call-tool.ts:136` builds the envelope with `refusalEnvelope(code, reason, detail)`;
    `refusalEnvelope` (`src/call-tool.ts:59-61`) has no `see` parameter, so the field authz just
    computed is **discarded**. No authorization refusal reaches a caller with a `see`.
  - the two sources also disagree: `ERROR_CATALOG` has `FORBIDDEN_ROLE`, `NOT_WORKFLOW_OWNER`,
    `NOT_RUN_OWNER` at `see: null` (`src/errors.ts:31,35,36`) but `NOT_TRIGGER_OWNER` at
    `see:'workflow_authoring_guide'` (`src/errors.ts:41`). `NOT_TRIGGER_OWNER` therefore carries
    the pointer when thrown from the facade's registration path (`mcp-facade.ts:313`, via
    `toErrEnvelope`) and **not** when the identical code comes from `authorize()`.
- **why it matters:** REQ-116's contract is that an authoring-relevant refusal points at the guide.
  A non-owner author re-registering someone else's workflow name gets `NOT_WORKFLOW_OWNER` with no
  pointer, and the architecture's own tool table says otherwise. The dead `see` field on
  `AuthzVerdict` is the tell.

### C-3 — MEDIUM — ARCH-097: four diagram refusal codes collapsed to two, and a value mismatch is reported under a code whose catalog hint is wrong
- **violated:** ARCH-097's api — `code: 'MERMAID_INVALID'|'MERMAID_RULE_VIOLATION'|
  'DIAGRAM_SCRIPT_MISMATCH'|'DIAGRAM_VALUE_MISMATCH'`; and `02-architecture.md:2642`'s
  `workflow_register` error list, which names `MERMAID_RULE_VIOLATION`, `DIAGRAM_SCRIPT_MISMATCH`,
  `DIAGRAM_VALUE_MISMATCH`, `AGENT_LABEL_REQUIRED`, `AGENT_LABEL_NOT_LITERAL`,
  `AGENT_OPTS_NOT_LITERAL`, `PARAM_IN_SCRIPT` — **none of which exists** in `ERROR_CATALOG`.
- **evidence:** `src/workflow-catalog.ts:435` — `const code = diagramCheck.onlyInScript !== undefined
  || diagramCheck.onlyInDiagram !== undefined ? 'DIAGRAM_MISMATCH' : 'MERMAID_INVALID';`. A
  `VALUE_MISMATCH` (`check-mermaid.ts:210`) sets neither diff set, so it is answered
  `MERMAID_INVALID`, whose catalog hint reads "the diagram does not parse under checkMermaid's
  grammar" (`src/errors.ts:49`) — the diagram parsed fine; its numbers disagree with `meta`. The
  seven scan/rule codes are likewise folded into `SCAN_VIOLATION` with the real code demoted to a
  message prefix (`src/workflow-catalog.ts:392`).
- **status:** the collapse itself was ruled at Gate 3/4 (`04-design.md:5303` shows
  `SCAN_VIOLATION: AGENT_LABEL_REQUIRED` as the intended shape), so the *code* is defensible; what
  is not is (a) ARCH-097 and the architecture's tool table never being amended, and (b) the
  value-mismatch case landing on a code whose published hint actively misdescribes it. Fix is one
  catalog member (`DIAGRAM_VALUE_MISMATCH`) or one hint edit, plus the doc amendment.

### C-4 — LOW — asset-push refusals reach the caller as a bare code with the code as its message
- **violated:** ARCH-091/ARCH-102's premise that a refusal is actionable at agent altitude.
- **evidence:** `src/mcp-facade.ts:685` — `return { … code: r.error, error: { code: r.error,
  message: r.error } }`. `EGRESS_DENIED` therefore arrives as
  `{"code":"EGRESS_DENIED","message":"EGRESS_DENIED"}`, although `ERROR_CATALOG` holds a usable
  hint for it (`src/errors.ts:115`) and the ADR-030 remedy (an operator must list the host in
  `mcpEgressAllowlist`) is not something a caller can guess.
- **why it matters:** this is the first-call experience REQ-117 measures, on the one path an
  author most plausibly hits (a default-empty allowlist refuses every `http` MCP push).

---

## 4. Self-sustainability

*Checked and found sound:* the register sequence is ADR-026's four steps with correct compensation,
including the `'held'` case never being released (`src/mcp-facade.ts:317-334`) and reverse-order
release on both the claim-loop failure and the `insertVersion` throw. `withTerminalRun` exists
(`run-manager.ts:684`) and is the gate for **both** `workspace_delete` and `workspace_purge`
(`mcp-facade.ts:737,777`) — ARCH-091 note 1 holds. `materializeAssets` only copies in; there is no
`rm`/`rmSync` of `.claude/skills` — ADR-034's additivity holds. The stdio MCP admin gate now keys on
`config.type`, the same field `classifyTransport` reads (`tool-specs.ts:168` ↔ `mcp-probe.ts:23`),
with `http` gated by `isEgressAllowed` before any probe (`asset-sync.ts:268-273`) — ADR-030 holds.
The webhook `workflow NOT NULL` rebuild is transactional and PRAGMA-guarded, so a second boot skips
it (`webhook-registry.ts:110-134`) — idempotent as required.

### S-1 — MEDIUM — ARCH-098: the v24 boot migration of legacy assets and `mcp_provisions` does not exist
- **violated:** ARCH-098's closing note — "Legacy assets in the pre-v24 global tree are migrated at
  boot into `assets(workflow='', pushedBy='legacy')` rows, `mcp_provisions` rows likewise with
  `kind:'mcp'` and their `config` — transactional and idempotent per ARCH-071's precedent"; and
  ADR-030's storage clause ("`mcp_provisions` retired **into** `catalog.assets`").
- **evidence:** `grep -rn "mcp_provisions" src/` → **no hit anywhere**: the module that owned the
  table (`mcp-registry.ts`) is deleted (`06-impl-log.md:2715`), so nothing in the engine reads,
  writes, migrates **or drops** it — an existing `mcp_provisions` table simply sits in the store
  with no reader (I did not verify a drop, because no code references the name at all).
  `src/workflow-catalog.ts:256-260` creates the `assets` table and
  nothing populates it from any pre-existing source; `grep -n "'legacy'" src/*.ts` → no hit. The
  only writer is `putAsset` (`workflow-catalog.ts:264`), reached only from a live
  `workspace_push`.
- **failure scenario:** an existing deployment upgrades to v24. `resolveMcp`
  (`src/asset-sync.ts:200-216`) resolves an agent's declared `mcp` names **exclusively** from
  `catalog.assets` rows, which are empty. Every MCP server provisioned before v24 becomes
  unresolvable: the agent runs without it, recorded only as `mcpUnresolved`
  (`agent-executor.ts:61`). Pre-v24 global skills under `<workRoot>/assets/skill/<name>/` likewise
  have no `assets` row, so `workspace_list({workflow,kind})` reports them as absent even though
  `materializeAssets` still copies them off disk — the discovery surface and the materialization
  surface disagree.
- **why it is MEDIUM, not HIGH:** the degradation is **not** silent — ARCH-094's stated seam holds,
  because `mcpUnresolved` (a v22 fix, IMPL-148) names the unresolved server on the run record. What
  is absent is the upgrade path itself: a migration ARCH-098 names as part of the retirement was
  never built, and neither the architecture nor `DEPLOY.md` tells an operator that a pre-v24
  deployment must re-push its MCP configs (and re-push, or accept an incomplete
  `workspace_list`, for its pre-v24 global skills). Cost is one boot migration or one documented
  upgrade step, not a redesign.

### S-2 — MEDIUM — ARCH-098 / ADR-025: `workflow_diagrams` is still created at every boot, with live writers and no readers
- **violated:** ARCH-098 ("`workflow_diagrams` **dropped by the boot migration**"); ADR-025
  ("`workflow_diagrams` is dropped"); and the Gate 3/4 adjudication ruling at `04-design.md:5291`
  ("表、`putDiagramPending` 及其存取器全刪").
- **evidence:** `src/workflow-catalog.ts:234-236` — `CREATE TABLE IF NOT EXISTS workflow_diagrams
  (…)` still runs on every construction; the accessors survive at `:298` (`putDiagramPending`),
  `:314` (`putDiagramResult`), `:344` (the read), `:357` (the pending sweep); `deregister` still
  pays a `DELETE FROM workflow_diagrams` at `:555`. `IMPL-186` (`06-impl-log.md:2791`) concedes the
  point — "47 of its 51 missing lines are the three DEAD `workflow_diagrams` accessors round 1
  found have zero callers — a v25 deletion".
- **why it matters (self-sustainability):** v24's slice shape is "one structural addition, one
  structural **deletion**" (`02-architecture.md:2086`). The deletion did not reach the storage
  layer: a fresh v24 boot still materializes a retired table, and two public write methods can
  still create rows that nothing on any surface will ever read or garbage-collect. It is also the
  ledger's own recorded anti-pattern — a retired mechanism left alive and green reads to the next
  maintainer as still-supported.

---

## Summary table

| # | Dim | Severity | ARCH/ADR violated | Evidence |
|---|-----|----------|-------------------|----------|
| O-1 | Observability | MEDIUM | ARCH-101 | `src/mcp-facade.ts:261-271,444`; no `getTriggerBindings` in `src/` |
| O-2 | Observability | MEDIUM | ARCH-097, ADR-029 | `src/check-mermaid.ts:198,210`; `src/authoring-guide.ts:344-348` |
| O-3 | Observability | LOW | ARCH-092 | `src/types.ts:170` |
| O-4 | Observability | LOW | ledger IMPL-per-change rule | `git diff dc2629d..HEAD`; `state.yaml:7` |
| R-1 | Replaceability | MEDIUM | ARCH-099, ARCH-100, ADR-026 | `src/scheduler.ts:167-196,271`; `src/webhook-registry.ts:90-96,194-208`; `src/server.ts:756-777` |
| R-2 | Replaceability | LOW | ARCH-087 | `src/tool-specs.ts:3-5,884` |
| R-3 | Replaceability | LOW | ARCH-096, ARCH-097 (`module:`) | `src/workflow-catalog.ts:22-23`; `04-design.md:5316-5317` |
| R-4 | Replaceability | LOW | ARCH-088 (`Principal`) | `src/authz.ts:16-21` |
| R-5 | Replaceability | LOW | ADR-034 (unstated limit) | `src/gateway/client.ts:96`; `src/main.ts:44-47` |
| R-6 | Replaceability | LOW | ADR-028 (`'local'` appears once) | `src/cas-store.ts:44-46`; `src/server.ts:1195` |
| C-1 | Consumability | **HIGH** | ARCH-087 / DES-137 closed catalog | `src/authz.ts:37,89`; `src/call-tool.ts:136`; absent from `src/errors.ts` |
| C-2 | Consumability | MEDIUM | ARCH-088, ADR-024, `02-architecture.md:2642` | `src/authz.ts:70`; `src/call-tool.ts:59-61,136`; `src/errors.ts:31,35,36,41` |
| C-3 | Consumability | MEDIUM | ARCH-097, `02-architecture.md:2642` | `src/workflow-catalog.ts:392,435`; `src/errors.ts:49` |
| C-4 | Consumability | LOW | ARCH-091/102 (actionable refusal) | `src/mcp-facade.ts:685` |
| S-1 | Self-sustainability | MEDIUM | ARCH-098, ADR-030 | no `mcp_provisions`/`'legacy'` in `src/`; `src/asset-sync.ts:200-216` |
| S-2 | Self-sustainability | MEDIUM | ARCH-098, ADR-025 | `src/workflow-catalog.ts:234,298,314,344,357,555` |

**Recommended send-back set (code):** C-1, C-2, S-2, S-1, C-3(b), O-2.
**Recommended doc amendments (no code):** O-3, R-2, R-3, R-4, C-3(a), plus R-5's ADR-034 limit and
O-4's ledger/state backfill, and R-6's one hand-typed sentinel (a one-line code edit either way).
