# Gate-2 Architecture Review — ADVERSARIAL GROUP (round 1)

**Feature:** 001-remote-workflow-engine · **Iteration under review:** v1 (REQ-001..007,013,014) with v2/v3 attachment seams
**Lenses:** (a) Security · (b) Scalability/Performance · (c) Testability · **Tie-breaker:** Karpathy simplicity-first

**Headline recommendation:** A **7-module trusted-parent / untrusted-child compat kernel** joined by a single IPC seam, with **6 extension modules** that attach at pre-existing seams (auth-as-middleware, scheduler-over-catalog, dashboard-over-store) so v1 never gets reworked. The one load-bearing decision is the **trust boundary between the sandbox child (untrusted Claude JS + pure orchestration) and the run-host parent (budget/journal/agent-spawn/secrets)** — that single boundary simultaneously satisfies all three lenses, which is why it survives the tie-break.

---

## 1. Proposed decomposition

### 1.1 Compat kernel (v1) — the 100%-compat baseline (spec §1–§5)

The kernel splits along ONE fault line: **untrusted vs trusted**. Everything the Claude-generated script can touch lives in the child sandbox; everything holding a secret, the durable truth, or a network handle lives in the parent. Every `agent()` / `workflow()` call crosses this line via IPC.

| ID | Module | Responsibility | Boundary (what it is NOT) | Depends on | Realizes |
|----|--------|----------------|----------------------------|------------|----------|
| **K1** | **MCP Facade** | Streamable-HTTP transport; dispatch of `workflow_run/status/result/suspend/resume/stop/list` and `workflow_agent_log`; bind `127.0.0.1` by default (`0.0.0.0` opt-in); async `runId` return. | No business logic (delegates to K2); no persistence (reads via K6); no auth *decision* (calls the auth seam E1, which is a no-op in v1). | K2, K6, E1(no-op) | REQ-005, REQ-007(query) |
| **K2** | **Run Manager / Lifecycle** | The **single authority** per run: run state machine (`queued/running/suspended/stopped/completed/failed`), concurrency gate `min(16,cores−2)`, global agent counter (≤1000), **budget accounting** (`total/spent()/remaining()`, hard-throw at ceiling), serialized journal-append ordering, suspend/resume/stop, replay-from-cache orchestration. | Does NOT run script code (that's K3) and does NOT call the model (that's K4). Owns *policy & truth*, not execution. | K3, K4, K6, K7 | REQ-002, REQ-006 |
| **K3** | **Sandbox Host** | Spawn one Node child process per run; restricted **VM context** exposing ONLY the workflow API surface (`agent/parallel/pipeline/phase/log/args/budget/workflow`); determinism guards (`Date.now`, `Math.random`, argless `new Date()` throw); no fs/Node/network in context; 512 KB script cap; JS-not-TS parse rejection; `meta` literal validation. Marshals each `agent()`/`workflow()` over IPC to K2; receives cached/live results back. | Holds **no secrets, no store handle, no network**. Never spawns agents itself — it only *asks* K2. `budget` inside the script is a **view**; K2 is the source of truth. | K2 (IPC only) | REQ-001, REQ-002(caps/nesting/null-semantics) |
| **K4** | **Agent Executor** | Per `agent()` call: run one Claude Agent SDK headless session; enforce `schema`→StructuredOutput with retry-on-mismatch; resolve `agentType` from the server-side registry; apply `effort`/`isolation`; capture the full transcript; return final-text (no schema) / validated-object (schema) / `null` (terminal failure). | Does not decide concurrency or budget (K2 gates it before/after). Does not own model-provider config (asks K5). Runs in the **parent**, so untrusted script never touches the SDK or keys directly. | K5, K6(transcript write), K7(workspace root) | REQ-003, REQ-007(transcripts) |
| **K5** | **Model Gateway** | Manage the embedded **LiteLLM** subprocess; expose the alias→provider mapping (`sonnet/haiku/opus/default → Anthropic/OpenAI/Gemini/Ollama`); **custody of provider API keys**; submission-time validation that every referenced alias is mapped; surface real provider+model id and token usage back to K2/K4. Interface abstracted per D2 so LiteLLM is replaceable. | Not the SDK (K4 speaks to it via `ANTHROPIC_BASE_URL`). Not a router of *runs*, only of *model requests*. | (LiteLLM proc) | REQ-004 |
| **K6** | **Run Store** | Durable persistence: `journal.jsonl` per run (each `agent()` return, in completion order), `agent-<id>.jsonl` transcripts, SQLite index for `list/status` queries; restart survival; resume cache lookup keyed by `(prompt,opts)` longest-unchanged-prefix. | A dumb, injectable persistence port — no policy. Single writer *per run* (no cross-run contention because journals are per-run files). | (fs + SQLite) | REQ-006(durable), REQ-007(data) |
| **K7** | **Workflow Catalog** | Named registry (save/list/invoke-by-name, version pinning so prior runs reference their version); `workflow(name)` resolution; **per-workflow persistent work folder** + **per-run workspace** rooting (agent file I/O confined; run A cannot see run B; workflow X folder unreachable from Y via the API); retention/cleanup policy. | Not a general filesystem service — it hands K4 a *rooted* workspace path and refuses to resolve outside it. | K6 (metadata) | REQ-013, REQ-014 |

**Why K7 is one module, not two (simplicity):** registry-versions and work-folders are both keyed on the *same* per-workflow identity and share the same lifecycle (create on register, delete on retention). Splitting them would be two modules sharing one primary key — needless. They keep distinct *responsibilities* internally (versioning vs I/O rooting) but one boundary.

### 1.2 Extension modules (v2/v3) — attach at existing seams, zero v1 rework

| ID | Module | Attach point (the pre-built seam) | Depends on | Realizes | Iter |
|----|--------|-----------------------------------|------------|----------|------|
| **E1** | **Auth Middleware** | Wraps K1 request pipeline; **v1 ships it as a pass-through no-op**; v3 swaps in an OIDC resource server (401 + resource metadata, PKCE). No K1 signature change. | K1 | REQ-012 | v3 |
| **E2** | **Scheduler** | A driver **over K7 + K2**: cron / one-shot / resident-`workflow_trigger`; starts runs exactly as a manual `workflow_run` would (same code path). | K7, K2 | REQ-015 | v2 |
| **E3** | **Dashboard** | **Read-only over K6** (+ live tail); adds no write path, cannot perturb runs. | K6 | REQ-008 | v2 |
| **E4** | **Asset Sync** | MCP tools `asset_push/list/delete` writing into K7's server-side workspace; **recursion-guard filter (D4)** rejects/strips this system's own plugin/skill/MCP-config; validates that pushed MCP configs are non-interactive & server-runnable. | K7, K1 | REQ-009 | v2 |
| **E5** | **Client Plugin** | Pure client artifact: MCP connection config + guidance skill; **excluded from its own sync** (D4); coexists with the local dynamic Workflow tool. | (client-side) | REQ-010 | v2 |
| **E6** | **Deploy Packaging** | docker-compose / systemd bringing up K1..K7 + the LiteLLM (K5) subprocess; documented smoke check. | all K | REQ-011 | v2 |

**Attachment proof (the CRITICAL constraint):** v2/v3 touch K-modules only through seams that already exist in v1 — E1 wraps K1 (seam present as no-op), E2/E3 are *consumers* of K2/K6/K7 public surfaces (read or start-run, already needed by K1), E4 writes through K7's existing rooting API. No K-module's internal contract changes. v1 is independently shippable.

---

## 2. Three-lens argument

### (a) SECURITY
- **Executing arbitrary Claude-generated JS (D6):** the whole risk is contained by the K3 trust boundary. The script runs in a VM context with only the API surface — **no fs, no network, no `require`, no keys**. Determinism guards double as a security control (no wall-clock/RNG side channels for replay tampering). K3 spawns nothing and holds nothing; it can only *ask* K2. So the worst a malicious script can do is exhaust its own run's budget/agent cap — which K2 hard-caps (≤1000 agents, budget ceiling, 4096-item/call). No lateral movement.
- **Secret protection:** provider API keys live **only in K5 (parent)**. The untrusted child (K3) never sees `ANTHROPIC_BASE_URL` targets or keys; even the Agent Executor (K4) is parent-side. This is the strongest possible posture given D6, achieved *for free* by the trust split.
- **Recursion guard (D4) as a boundary:** enforced in two places — E4 strips this service's own plugin/skill/MCP config from sync, and the server-side agent runtime (K4+K7) excludes the self-MCP-config — preventing remote agents from recursively invoking the engine (infinite recursion + amplification DoS).
- **MCP exposure / v1 no-auth (D5):** K1 binds `127.0.0.1`; remote = SSH tunnel. The E1 auth seam exists in v1 as a no-op so v3 is a drop-in. **Flagged risk:** v2 introduces `asset_push` (server-side code execution via npx stdio MCP) while real auth is still v3 — a `0.0.0.0` v2 deploy without a tunnel is an RCE surface. Mitigation is deployment discipline (D5's tunnel/VPN posture), documented in E6, not new code.

### (b) SCALABILITY / PERFORMANCE
- **State storage:** `journal.jsonl` is append-only **per run** → zero cross-run write contention; SQLite is a single-writer *index* for `list/status`, trivial at `min(16,cores−2)` concurrency. No need for Postgres/distributed store at this scale.
- **Budget/counter consistency across parallel agents:** K2 is the **single in-process authority** per run — the ≤16 parallel agents and any nested `workflow()` share one serialized counter/budget. Correct by construction; no distributed consensus.
- **Horizontal vs vertical:** a run is **vertically bound** to the host owning its child process + journal. Horizontal scale = partition *runs* across hosts (each host a self-contained K1..K7). Cross-host single-run scaling is explicitly out of scope (v1 is localhost); the decomposition doesn't preclude run-level sharding later but builds nothing for it now.
- **Resume/replay cost:** replay is a sequential read of the per-run journal, returning cached `(prompt,opts)` hits — O(#agent calls), all local. The 641-line `sdlc-run.js` has 17 `agent()` calls → negligible replay cost.
- **IPC overhead:** one message per `agent()`/`workflow()` boundary crossing. At agent latencies (seconds, model-bound), IPC is noise. Process-spawn cost is once per run, not per agent.

### (c) TESTABILITY
- **The IPC seam is the master test seam.** Because K3 dispatches every `agent()` through K2→K4, a test can inject a **stub K4** that returns canned/schema-valid objects (or `null`) and **dry-run `sdlc-run.js` end-to-end with zero real model calls** — exercising `parallel`/`pipeline` null-semantics, budget exhaustion, `workflow()` nesting-depth throw, concurrency capping, and the 4096-item cap. This is the compat-suite backbone (spec §7).
- **Determinism guards ARE the clock/RNG seam** — no extra injection needed; `Date.now/Math.random` are already forced to throw, so tests are inherently reproducible.
- **Injectable ports where it matters:** K4 (Agent SDK), K6 (Store: in-memory vs file), K5 (Gateway, already abstracted per D2). K2's state machine is unit-testable against a fake store; K3's VM restrictions and `meta`-literal validation are unit-testable with tiny scripts; K7 rooting is testable with two-run isolation assertions.
- **Compat kernel integration testability:** parse + dry-run the real fixture as the Gate-5 gate; synthetic fixtures (determinism violation, schema retry, nesting depth, budget ceiling, 4096 cap, meta validation) each map to exactly one K-module boundary.

---

## 3. Conflicts & simplicity tie-break

**C1 — Sandbox isolation strength vs performance & simplicity (Security ⟂ Scalability ⟂ Simplicity).**
Security's instinct: container/gVisor/seccomp per run. Performance: spawn+IPC cost. D6 already fixes the answer at *process + restricted VM*. **Tie-break:** honor D6 exactly — one child per run, VM-restricted globals, secrets parent-only. Do **not** build container-per-run (speculative, QM safety class doesn't warrant it). The trust split already removes keys/network/fs from the blast radius, so heavier isolation buys little. **Winner: the D6 posture, unembellished.**

**C2 — Single durable writer vs horizontal scale & parallel-agent consistency (Scalability internal ⟂ Scalability).**
Consistent `budget.spent()` across ≤16 parallel agents + nested workflows demands one authority; horizontal single-run scale demands many. These are irreconcilable. **Tie-break:** a run is single-authority/single-host; scale is across *runs*. Distributed budget consensus is exactly the "needless flexibility" a senior engineer would cut, especially when v1 is localhost. **Winner: single in-process authority (K2); no distributed budget.**

**C3 — Injectable seams vs simplicity (Testability ⟂ Simplicity).**
Testability wants an interface behind everything; simplicity warns of interface-for-its-own-sake. **Tie-break:** inject at exactly the boundaries that are non-deterministic, networked, or costly — **K4, K6, K5** — plus the guard-as-clock-seam. Do **not** wrap K3/K7/K1 in interfaces. Crucially, this is *not a testability compromise*: the K4 stub already unlocks full compat-suite dry-runs of the real fixture, so we get the big testability win with the minimum seams. **Winner: three injection points, not seven.**

**C4 — v2 `asset_push` RCE vs deferred auth (Security ⟂ D5 sequencing).**
Server-side code execution (npx MCP) arrives (v2) before real auth (v3). Security wants auth first; the roadmap fixed the order. **Tie-break:** do not pull OIDC forward (relitigating D5). Ship the E1 no-op seam now, gate exposure via D5's tunnel/VPN deployment posture, and **document the v2-without-auth caveat loudly in E6**. Code stays simple; the risk is handled operationally as the decisions already intend. **Winner: seam-now, auth-v3, documented caveat.**

**C5 — One module (K7) for registry+workspace vs separation-of-concerns (Simplicity ⟂ Security/clarity).**
Two concerns (versioning, I/O rooting) but one identity key. **Tie-break:** merge — two modules over one primary key is the overcomplication a senior reviewer flags. Keep the rooting *responsibility* explicit and independently testable inside K7. **Winner: single K7.**

**Net:** the decomposition is **7 kernel + 6 extension** modules with a single load-bearing seam. Every conflict resolves toward *fewer parts that already carry their weight* — and the same trust-boundary seam that minimizes the security blast radius is also the master testability seam and the natural budget-consistency point. That triple-duty is the sign the cut is in the right place.
