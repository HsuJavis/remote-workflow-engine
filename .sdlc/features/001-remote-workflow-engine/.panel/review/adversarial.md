# Gate 8 review — Adversarial architecture group (security · scalability · testability)

- **Iteration:** v23 (ARCH-077..086, ADR-015..022 vs IMPL-159..174)
- **Reviewer lens:** three lenses argued against each other, Karpathy simplicity-first as tie-breaker
- **Scope:** the files named on each v23 IMPL's `files:` line, plus the module-boundary files they
  directly reference (`workflow-meta.ts`, `gateway/client.ts`, `params/contract.ts`). No full-tree scan.
- **Method:** every claim below is anchored to source I read at `file:line`. Where the impl-log's own
  prose is the only evidence for a property, that is stated. The ledger records **six** ledger-honesty
  gaps in this iteration alone, so no ARCH/DES/IMPL sentence was accepted as proof of code behaviour.
- **Verdict:** `consistent: NO` — **7 deviations** (1 HIGH, 2 MED, 4 LOW).

---

## 1. Findings

### V-1 — HIGH — `GET /api/workflows/:name/describe` ships unauthenticated and unconditional; ARCH-083 says it is auth-gated, and the route it replaced actually did mask

- **Violates:** ARCH-083 (`api:` — "`GET /api/workflows/:name/describe` (auth-gated exactly as the
  route it replaces)"), ARCH-081's `owner` rationale, ADR-012 (masking keys on `authEnabled`;
  "`/api/*` and the dashboard serve the non-owner view whenever auth is on").
- **Lens:** security (primary); the scalability finding V-3 amplifies it.
- **Evidence:**
  - `src/server.ts:1173-1183` — the route body. No bearer check, no `authEnabled` branch: it calls
    `facade.workflow_describe({name}, {authEnabled, principal: null})` and sends `resp.result` whole.
  - `src/server.ts:1918-1930` — `/api/*` is dispatched **outside** the `if (authHandlers) { … }` block
    (`:1722-1880`), which returns early only for `/assets/blob/:sha`, `/assets/manifest` and `/mcp`.
    So with auth fully enabled this route answers an anonymous socket.
  - `git show ebd530d^:src/server.ts:1078-1085` — **the route it replaces did branch**:
    `if (authEnabled) sendJson(res, 200, {name, version, description})` else the full
    `{…, phases, skeleton}`. ARCH-083's "auth-gated exactly as the route it replaces" is therefore
    not satisfied on any reading — the branch was deleted, not preserved.
  - `src/workflow-view.ts:59-62` — the ratified non-owner allowlist `EXPECTED_NON_OWNER_KEYS` contains
    **no** `triggers`, **no** `versions`, **no** `diagram`. `src/workflow-view.ts:87-105` — the shipped
    describe view emits all three, plus `owner`.
  - `src/trigger-bindings.ts:18-21` — `triggers` carries raw **cron expressions**, `tz`, per-binding
    `enabled`, and chain **upstream workflow names**. Operational trigger topology; no prior
    unauthenticated surface served it.
  - `src/workflow-catalog.ts:598-621` — the pre-existing unauthenticated *workflow* surface,
    `GET /api/workflows` → `catalog.list()`, returns **no `owner`**; describe adds it.
    *Probed and reported honestly:* principal identity is **not** wholly new to the unauthenticated
    edge — `src/store/sqlite-run-store.ts:246` puts `principal` on `RunStatusView` and
    `src/server.ts:1215` serves that on `/api/runs/:id` with no bearer. So the `owner` half of this
    finding is "a second, easier path to an already-leaking class", not a first leak.
    `StartedBy` itself is clean (`src/types.ts:4-7` — `{type, id?}`, no identity).
  - `src/server.ts:1241` — the sibling route still enforces the v22 H2 rule
    (`const skeletonNodes = authEnabled ? [] : parseWorkflowSkeleton(skeletonScript)`). Two sibling
    routes now disagree about the same class of script-derived structure.
- **Why this is a deviation and not a disagreement:** DES-132 (`04-design.md:4184`) consciously
  overrode ARCH-083 — "`/describe` is UNAUTHENTICATED and therefore pinned to the non-owner projection
  unconditionally — not 'auth-gated as the route it replaces'". Fine as a decision; but (a) **ARCH-083
  was never amended**, so the architecture of record still asserts a gate that does not exist, and
  (b) the override's own justification is not what the code does: the response is *not* "the non-owner
  projection" — `triggers`/`versions`/`diagram` are outside `EXPECTED_NON_OWNER_KEYS`, and `owner` is
  justified in ARCH-081 by pointing at ARCH-075's allowlist, which governs the **auth-gated** MCP
  `workflow_get`, not an anonymous HTTP GET. The engine is deployable non-loopback (D-BIND, ARCH-063),
  so "it's only localhost" is not available as a mitigation.
- **Honest counterweight:** `/api/*` being unauthenticated is a pre-existing posture, and `phases`
  going public is owner ruling adjudication #1. The *incremental v23 delta* is `owner` + `triggers` +
  `diagram` to an anonymous caller. That delta is what makes this HIGH rather than a residual.
- **Minimum fix (Karpathy):** one line, not a subsystem — either give the route the same
  `authEnabled ? … : …` treatment its sibling at `:1241` has, or move `/api/workflows/:name/describe`
  behind the existing `resolvePrincipal` gate the `/mcp` branch already uses. Do **not** build a second
  masking projection; DES-125's "one describe response" is right and worth keeping.

### V-2 — MED — the analyzer's concurrency-1 slot and single-flight key are released only on the happy path; one throw wedges diagram generation permanently, and the failure is indistinguishable from designed behaviour

- **Violates:** ARCH-079 load-bearing invariant (2) ("single-flight, `concurrency: 1`, with a bounded
  queue depth … when the queue is full the job is not run and the row settles `unavailable/QUEUE_FULL`,
  which is honest absence working as designed"), and invariant (1)'s premise that a bad provider cannot
  hold an engine path open.
- **Lens:** scalability/availability (primary), testability (the failure has no oracle).
- **Evidence:**
  - `src/graph-analyzer.ts:301-344` — `_runJob` has **no `try/finally`**. `this._pendingKeys.delete(key)`
    and `this._runningCount--` and the `_queue.shift()` drain are at `:337-343`, reachable only if
    nothing above them threw.
  - Unprotected throw sites inside that window: `getTriggerBindings(name, this._ports)` at `:304`
    (four synchronous SQLite reads across three separate DB files — `src/server.ts:1455-1460`), and
    `this._catalog.putDiagramResult(...)` at `:326/:329/:334`
    (`src/workflow-catalog.ts:271-289`). `_attempt` catches only around `gateway.invoke` (`:263-267`).
  - **Structural argument first, reachability second.** An invariant enforced only on the happy path
    is not an invariant, and ARCH-079 (2) stakes the whole queue bound on a release that *any* throw
    skips. Concrete triggers today: a thrown SQLite error (an external OS-level lock-holder — an
    operator's `sqlite3` CLI, a backup job, the self-updater — or a disk I/O error; note better-sqlite3
    is single-connection and synchronous, so in-process contention is **not** one of them), and the
    rejected `scriptPromise` path at `:177`.
  - Consequence, and the dichotomy is the point: `src/graph-analyzer.ts:127` schedules via
    `setImmediate(() => { void job(); })` — `void` discards the promise without attaching a handler.
    So a throw either **kills the process** (Node's default `--unhandled-rejections=throw`; the
    `sweepAtBoot` → `catalog.resolve` → `UNKNOWN_VERSION` path makes this a *boot-time* crash), or —
    wherever a global rejection handler is installed — **silently wedges the slot forever**:
    `_runningCount` stays `1`, `_startJob` (`:213-218`) pushes every later job onto a queue nothing
    drains, and past `maxQueueDepth` (default 8, `server.ts:1481`) `enqueue` settles **every** future
    registration `unavailable/QUEUE_FULL` (`:139-142`) — the exact string ARCH-079 defines as "honest
    absence working as designed". Which of the two you get depends on deployment, and that is itself
    part of the defect.
- **Minimum fix:** wrap `_runJob`'s body in `try { … } finally { key/counter/drain }`, and attach a
  `.catch()` in `_schedule`. Two lines. No new mechanism, no supervisor, nothing speculative.

### V-3 — MED — the dashboard fires one `/describe` per home card on every 3 s tick and throws the response away (the residual IMPL-167 explicitly routed to Gate 8 — adjudicated here: **delete the fetch**)

- **Violates:** ARCH-084 (`api:` — "the home-card mini-preview (`:223-227`) **drops its skeleton
  fetch** and renders nothing when no diagram exists"). The fetch was re-pointed, not dropped.
- **Lens:** scalability (primary); it is also the amplifier on V-1.
- **Evidence:**
  - `src/dashboard-page.ts:227-231` — `renderMiniPreviewAsync` issues
    `getJSON('/api/workflows/'+…+'/describe')` and its `.then` body is `if(!s||!s.diagram) return;` —
    every branch returns without touching the DOM.
  - `src/dashboard-page.ts:243` — called from `renderHomeGroup` for every card with a `name`;
    `:496` — `setInterval(render, 3000)`.
  - Cost per call, all **synchronous** `better-sqlite3` on the event loop: `catalog.resolveDetail` +
    `getTriggerBindings` (`src/mcp-facade.ts:436`) → `scheduler.listByWorkflow` +
    `webhooks.list()` **full-table scan then filter** (`src/server.ts:1457`) +
    `continuations.listPendingByWorkflow` + one `runs.getWorkflowName` per pending continuation +
    `catalog.getDiagram`. So N workflows × 20 requests/minute × every open tab, on a route that
    (per V-1) needs no credential.
- **Adjudication of IMPL-167's two recorded options:** take option 1 — **delete the fetch** and
  re-point UT-116's oracle at the absence of `/skeleton`. Option 2 ("finish the mini-preview") builds
  a second render path for an artifact owner decision A2 says has exactly one, and A1 already forbids
  a fallback drawing; there is nothing left for a mini-preview to draw that a `<pre>` does not.
  Simplicity tie-break: delete.

### V-4 — LOW — `phases` is on the shipped describe surface and pinned in its oracle, but ARCH-081's `api:` field list was never amended

- **Violates:** ARCH-081 `api:` ("emitting **exactly** `{name, version, resolvedBy, channels, versions,
  description, params, lockedKeys, owner, reportProblem, triggers, diagram, diagramStatus, diagramNote,
  diagramGeneratedAt, diagramStale}`").
- **Evidence:** `src/workflow-view.ts:94` (`phases: Array<{title: string}>` on `WorkflowDescribeView`),
  `:113` (`'phases'` in `EXPECTED_DESCRIBE_KEYS`), `:147` (projected).
- **Why it still counts:** the change is owner-authorised (adjudication #1, `ba3db17`) and recorded in
  DES-125/DES-136 — but ARCH-085 carries an explicit `[AMENDED v23 Gate 6.5+7 …]` marker in this same
  iteration, so the amendment convention exists and was simply not applied here. A reader of
  02-architecture.md alone is told the response emits "exactly" a list it does not emit.

### V-5 — LOW — two ARCH clauses describe mechanisms that do not exist, and the corrections live only in 04-design.md

- **Violates:** ARCH-077 `api:` and ARCH-079 invariant (4), against the ledger's own most-repeated
  defect class ("a deletion is not finished while something still describes the deleted thing").
- **Evidence:**
  - ARCH-077 `api:` — "`deregister()` **and the `maxWorkflowVersions` prune** each delete this
    name's/version's diagram rows inside their existing `db.transaction()`". There is no prune:
    `src/workflow-catalog.ts:231-233` records it in-code as phantom ("no prune hook, sweep, GC or
    orphan-reaper exists"), `:441-445` shows the ceiling *refuses the registration* instead, and
    `:490` shows `deregister` as the sole `DELETE FROM workflow_diagrams`. DES-130 carries the
    correction; ARCH-077 does not.
  - ARCH-079 invariant (4) — "the journal line carries an engine-classified error class **plus the
    provider HTTP status** and token counts". `src/graph-analyzer.ts:287-296` emits no provider status.
    DES-129 (`04-design.md:4126`) explicitly **strikes** the clause and DES's own rationale
    (`:4235`) states "02-architecture.md is **not** edited". That is a decision to leave the
    architecture of record wrong.
- **Not filed:** the extra `gateFail` field on the journal line. DES-129/`:4235` records it as an
  explicit, granted amendment to ARCH-079 invariant 5, it is a closed engine-authored enum, and
  `src/graph-analyzer.ts:274/295` confirms it never carries model or provider bytes.

### V-6 — LOW — the ADR-022 grep guard is four entries; ADR-022 and ARCH-083 both say three

- **Violates:** ADR-022 ("fails CI on any occurrence outside a **three-entry** internal allowlist
  (`workflow-meta.ts`, `dashboard.ts`, the auth-gated dag path in `server.ts`)"), ARCH-083 (same words).
- **Evidence:** `tests/unit/no-skeleton-surface.test.ts:36` —
  `const ALLOWLIST = new Set(['workflow-meta.ts', 'dashboard.ts', 'server.ts', 'graph-analyzer.ts'])`;
  `:61-63` pins `ALLOWLIST.size === 4`.
- **Assessment:** the widening is legitimate and well-argued (adjudication #3; `graph-analyzer.ts`
  consumes the skeleton only as gate grounding and serves no projection of it — confirmed at
  `src/graph-analyzer.ts:227-230`, the parsed nodes only feed `labels`). The defect is purely that
  neither ADR-022 nor ARCH-083 was amended, in the one iteration whose flagship ADR is *"review
  discipline demonstrably does not catch this class"*.

### V-7 — LOW — DES-127 B5 ("a failure must never clobber a prior `ready` row") does not survive a restart, and the code comment asserting it does is false

- **Violates:** DES-127 B5 as carried into ARCH-077 invariant (4)/ADR-017's recovery model.
- **Evidence:**
  - `src/graph-analyzer.ts:143-145` — `enqueue` reads `priorRow`, then `putDiagramPending` runs
    `ON CONFLICT … SET status='pending', diagram = NULL` (`src/workflow-catalog.ts:249-258`): the
    ready diagram is destroyed in the DB immediately; B5 is an in-memory *compensation* held only in
    the `priorRow` local (`:327-332`), not an invariant.
  - `src/graph-analyzer.ts:176-179` — after a crash, `sweepAtBoot` requeues with `priorRow = null` and
    the comment *"a still-pending row was never 'ready' — nothing to restore on failure"*. That is
    demonstrably false for the `regenerate → crash` sequence: the row was `ready` before the
    regenerate flipped it. If the swept attempt then fails, the previously-good diagram is gone for
    good, and ADR-017's "recoverable only by an explicit owner-gated regenerate" now means "by an
    explicit regenerate that also has to succeed".
- **Minimum fix:** either have `putDiagramPending` preserve `diagram`/`generated_at` on conflict and
  let `getDiagram` treat "pending with a diagram" as still-serveable, or state the window in ADR-017.
  The second is cheaper and may well be the right call — but it must be *stated*, not asserted false
  in a comment.

---

## 2. Invariants checked and **held** (so a reader can tell "checked" from "unchecked")

| Claim | Verified at |
|---|---|
| ARCH-078 security invariant: the webhook HMAC `secret` cannot reach the LLM prompt — port type pins `secret?: never; id?: never` **and** the composition root remaps to a fresh `{enabled}` literal (a method-return position gets no excess-property check, so the type alone would not have held) | `src/trigger-bindings.ts:13`; `src/server.ts:1457` |
| ARCH-080: gate is an **allowlist**, four passes in DES-124 order, exact case-sensitive token membership | `src/diagram-gate.ts:33-66` |
| ARCH-080/DES-133 upstream XSS half: `<`, `>`, `&` excluded from `DIAGRAM_CODEPOINTS`; ESC/C0/zero-width/RTL all excluded by construction (0x20–0x7E + `\n` + 13 named glyphs only) | `src/diagram-gate.ts:9-16` |
| ARCH-080: the gate is a **validator, never a transformer** — returns `raw` verbatim | `src/diagram-gate.ts:69` |
| A raw cron expression cannot be drawn: `*/5 * * * *` tokenises to `/5`, which is not in the allowlist | `src/diagram-gate.ts:61`; `src/trigger-bindings.ts:68-71` |
| ADR-016 isolation by omission: `invoke()` is passed only `{prompt, opts, runId, agentId}` — no `workspace`, no `onEvent`, no `onHarness`, no `SecretValueProvider`, so no transcript exists to mask | `src/graph-analyzer.ts:256-262` |
| ADR-016 log channel: the `catch` around `invoke` never reads or forwards the thrown message | `src/graph-analyzer.ts:263-267` |
| ADR-016: the user-visible note is rendered from a closed engine-authored enum, never model/provider text | `src/graph-analyzer.ts:51-66`; `src/workflow-view.ts:133-137` |
| ADR-020: `tools` defaults to `[]` **and survives** the gateway — `[] ?? …` does not fall through, and `curateToolsForProvider` returns `[]` before the `Bash` augmentation | `src/server.ts:1476`; `src/gateway/claude-agent-sdk-client.ts:225`, `:479-488` |
| DES-122 zero-config fail-closed: `graphAnalyzerNoJail` keys off the **operator-configured** `config?.workRoot`, not `createServer`'s internal `mkdtemp` fallback, and forces `tools: []` regardless of config | `src/server.ts:1471`, `:1476`, `:1483-1485` |
| DES-122 belt: the SDK gateway's fallback `cwd` is the dedicated `.graph-analyzer-scratch`, one exported constant, two importers — closes the recorded workRoot memory-leak class for analyzer sessions | `src/main.ts:216-223`; `src/graph-analyzer.ts:73`; `src/server.ts:1509` |
| ARCH-082: `workflow_regenerate_diagram` is owner-gated through the **shared** `resolveWritePrincipal` + `principalRequiredEnvelope`, and the ownership check runs **before** the analyzer is touched | `src/server.ts:883-885`, `:978-983`; `src/mcp-facade.ts:450-466` |
| ADR-012: `ReadContext` required with no default on `workflow_describe` | `src/mcp-facade.ts:410` |
| ARCH-081: `script` is absent from `WorkflowDescribeView` **as a type**, so a leak is a `tsc` error | `src/workflow-view.ts:87-105` |
| ARCH-081: `triggers` is always the live snapshot; `diagramStale` is a real `sha256` compare against the stored `bindings_fp`; `diagramGeneratedAt` only for `ready` | `src/workflow-view.ts:152-159`; `src/mcp-facade.ts:436-439` |
| ARCH-077 (1): PK `(name, version)` — cross-version serving is a schema impossibility | `src/workflow-catalog.ts:234-243` (PK at `:242`) |
| ARCH-077 (4): `CHECK ((status='ready') = (diagram IS NOT NULL))` — "unavailable with a diagram" is unrepresentable | `src/workflow-catalog.ts:239` |
| ARCH-077 (3): `note_code` CHECK-constrained to the eight persisted engine codes; `DISABLED`/`NOT_GENERATED` unrepresentable in the store | `src/workflow-catalog.ts:240-241`; `src/workflow-view.ts:130-133` |
| ARCH-077 (7)/ADR-021: the diagram row dies with its source **inside** `deregister`'s own transaction, plus a late-write guard for the `enqueue → deregister → result` race | `src/workflow-catalog.ts:488-490`, `:271-289` |
| ADR-018: no cache — no `inputs_fp` anywhere; only `bindings_fp`, used solely for staleness | `src/trigger-bindings.ts:58`; `src/graph-analyzer.ts` (no reuse key) |
| ADR-017: `unavailable` is recoverable **only** by the owner-gated regenerate — no background retry, no lazy read-triggered generation | `src/graph-analyzer.ts:150-162`; `src/mcp-facade.ts:450-466` |
| ARCH-079: `enqueue` returns before the job runs; two zero-model-call short-circuits (`MODEL_UNMAPPED`, `QUEUE_FULL`) ahead of the `pending` write | `src/graph-analyzer.ts:131-146` |
| ARCH-079: retry stops on a gate rejection (`while (!ok && !gatewayOk && n < attempts)`) — a provider that answered cannot be re-billed for a vocabulary miss | `src/graph-analyzer.ts:318-322` |
| ARCH-079 (6) + adjudication #7: allowlist = skeleton ∪ `meta.phases` ∪ aliases ∪ `default`/`model:param`/`UNBOUND_ENTRY_LABEL` ∪ trigger kinds ∪ chain upstream — and the unbound label has **one** declaration shared with the instruction that emits it | `src/graph-analyzer.ts:225-247`; `src/trigger-bindings.ts:29`, `:74` |
| ARCH-084: the model-authored string reaches the DOM only via `.textContent` into a `<pre>`; no `innerHTML` on any diagram path | `src/dashboard-page.ts:175`, `:219-220` |
| ARCH-083: v22 finding H2 is **not** re-opened — the dag route's `authEnabled ? [] : parseWorkflowSkeleton(…)` is untouched | `src/server.ts:1241` |
| ARCH-085: `graphAnalyzer` forwarded as a whole object from `composeConfig()`, defaulted at exactly one site | `src/main.ts:184`; `src/server.ts:1472-1482` |
| ARCH-082 testability: `McpFacadeDeps.triggerPorts`/`.graphAnalyzer` are **required**, the `deps = {}` default is gone, and `NO_TRIGGER_PORTS`/`NO_GRAPH_ANALYZER` are exported so "neither" reads as a decision | `src/mcp-facade.ts:23-34`, `:63-81`, `:168` |
| Testability: `schedule` and `clock` are injectable seams; the three new modules (`diagram-gate`, `trigger-bindings`, `workflow-view`) import no I/O beyond `node:crypto` | `src/graph-analyzer.ts:109-128`; `src/diagram-gate.ts:1-5`; `src/trigger-bindings.ts:6` |
| IMPL-162's latent fix is real and at the right depth (gateway, not call site) | `src/gateway/claude-agent-sdk-client.ts:223-228` |
| IMPL-173 V-2 is real: `proc.once('error', …)` is attached immediately after spawn, before the first health poll | `src/gateway/litellm-proxy.ts:178-188` |
| ADR-022's second assertion exists: no advertised tool description or schema string contains "skeleton" | `tests/unit/no-skeleton-surface.test.ts:65-77` |

---

## 3. The internal conflicts between the three lenses (surfaced, as the brief requires)

**C-1 — Live-bindings freshness (security/correctness) vs. per-read fan-out (scalability).**
ADR-019 is right that `triggers` must be live: a chain binding is transient, and a baked-in binding
would let a stale diagram contradict reality. But "live" was implemented as *recompute on every read*
(`src/mcp-facade.ts:436`), and the same iteration put that read on a 3 s browser poll (V-3) on an
unauthenticated route (V-1). The three costs compose into something none of the three filings owns.
**Resolution under the simplicity tie-break:** do not add a bindings cache — deleting the dead poll
(V-3) removes the multiplier at zero architectural cost, and the remaining per-describe fan-out is
genuinely cheap. Keep ADR-019.

**C-2 — ADR-016's no-transcript isolation (security) vs. testability of what actually reached the provider.**
ADR-016 buys the strongest possible mask ("nothing is stored, so nothing can leak"), and the code
honours it (`graph-analyzer.ts:256-267`). The price is that the **only** oracles for "what bytes went
to the provider" are one `console.log` line and a unit test over the prompt string. That price was
paid in this very iteration: adjudication #6 V-1 found that trigger bindings never reached the prompt
at all, and the *only* thing that caught it was a Gate 7.5 real run — no unit test could see it,
because there is nothing to assert against. This is a real, ongoing testability debt created by a
security decision I would still make the same way. **Recommendation, not a finding:** keep ADR-016;
record explicitly in the ADR that prompt-composition changes are only provable at the real tier, so
future gates do not mistake a green unit suite for coverage of this seam.

**C-3 — ADR-018's no-cache simplicity vs. per-registration LLM spend (S-1).**
ADR-018 is defensible and its claimed bounds were checked one by one: the per-name version ceiling is
real and refuses at the front door (`workflow-catalog.ts:441-445`); `concurrency 1` + `maxQueueDepth`
+ `timeoutMs` are all real and config-sourced (`graph-analyzer.ts:105-107`, `:139`, `:259`;
`server.ts:1477-1481`). **However the concurrency bound is exactly the thing V-2 breaks** — a bound
that can be silently lost to one `SQLITE_BUSY` is not a bound, and its failure mode presents as the
designed `QUEUE_FULL` message. So the correct reading is: ADR-018's cost argument holds *conditional
on V-2 being fixed*. S-1 stays recorded debt; no rate limiter should be built.

**C-4 — "One describe response for every principal" (testability/simplicity) vs. the network edge (security).**
DES-125's dropped `viewerIsOwner` is good design — a parameter that cannot change the output eventually
gets made to, and one projection is the only structural guarantee that two surfaces cannot drift.
The mistake is not the projection; it is concluding from "one projection for every *principal*" that
the *transport* also needs no gate (V-1). A principal is someone who authenticated. Keep the single
projection; put the gate on the route.

---

## 4. Recorded residuals I deliberately did **not** re-file as violations

- A secret in a **phase name** passes the gate (ADR-015 residual, owner-ruled 一律公開 in adjudication #1,
  documented in `docs/AUTHORING.md` per DES-135). Architecture-recorded decision, correctly implemented.
- `owner` served to every *principal* on the MCP surface (ARCH-081). Recorded; my objection is only to
  the unauthenticated **HTTP** edge, filed as V-1.
- S-1 (every registration costs an LLM call). Recorded in ARCH-079; bounds verified above in C-3.
- The 13 fake-`ChildProcess` builders and `_doStart`'s two early throws — both named and deliberately
  deferred by the Gate 6.5 pass (IMPL-173). Out of a review's scope to re-litigate.

---

## 5. Ledger observation (not a code finding)

Six IMPL entries in this iteration were written **retroactively** by verifiers because the implementer
shipped with no ledger entry (IMPL-159..172 note; IMPL-173; IMPL-174). Four of my seven findings
(V-4, V-5, V-6, and the documentary half of V-1) are the *same defect class in the architecture
document*: a decision was correctly made and correctly implemented, and the ARCH/ADR row that says
otherwise was never amended. ADR-022 exists precisely because "review discipline demonstrably does not
catch this class" — and the mechanical guard it built covers `src/`, not `02-architecture.md`. If one
process change comes out of this review, it should be that an adjudication that overrides an ARCH/ADR
row must edit that row (the `[AMENDED …]` marker on ARCH-085 shows the convention already exists).
