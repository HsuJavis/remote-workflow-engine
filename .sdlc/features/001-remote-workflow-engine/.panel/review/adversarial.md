# Review — Adversarial Architecture Group (security / scalability / testability)

- **Stage:** iso-agile-sdlc review
- **Lens:** Adversarial architecture — (a) security, (b) scalability/performance & consistency, (c) testability; Karpathy simplicity-first as tie-breaker.
- **Compared:** `02-architecture.md` (ARCH-001..014, cross-component invariants, decision rationale D-*/C1..C4) vs `06-impl-log.md` (IMPL-001..050) and the source files those IMPLs list.
- **Verdict:** NOT consistent — 5 architecture deviations + 1 simplicity advisory.

The three lenses conflict, and I surface the conflict explicitly per finding: the process-boundary trust split (D6/C1) is honored well for **secrets/network/fs** (security lens satisfied), but the same boundary does **not** back the **determinism / budget / journal-ordering** invariants the scalability-consistency lens cares about — and the one seam the design leaned on for future security (ARCH-009 auth) was never laid down.

---

## V1 — ARCH-009 / ARCH-001: the auth-middleware seam does not exist (security + rationale contradiction)
- **Severity:** MEDIUM
- **Violated:** ARCH-001 note ("no auth *decision* — calls the ARCH-009 seam, a no-op in v1"); ARCH-009 ("Wraps the ARCH-001 request pipeline; ships v1 as a pass-through no-op … **No ARCH-001 signature change → drop-in**"); load-bearing rationale ("extensions attach at pre-existing v1 seams — auth-as-middleware — with **zero v1 rework**"); decision C4.
- **Evidence:** `src/server.ts:133-166`. The HTTP handler goes transport → `JSON.parse` → `callTool(facade, …)` directly. There is no auth middleware, no pass-through hook, no wrapper function, no interface point between the transport and the facade where ARCH-009 could be swapped in. The container diagram's `CC → E1(ARCH-009) → K1` edge has no code counterpart.
- **Why it matters (adversarial):** The architecture's whole "v2 asset_push RCE is acceptable pre-v3 because auth drops in without rework" bet (C4) depends on the seam existing as a no-op today. As built, adding OIDC in v3 requires editing `createServer()`'s request pipeline — exactly the "v1 rework" the design promised to avoid. The security lens loses its promised future extension point, and the testability lens loses an injectable authn boundary.
- **Conflict note:** Simplicity (Karpathy) would say "don't build the no-op seam speculatively" — but the architecture *explicitly* decided (C4/D5) to ship the no-op seam precisely so exposure could be gated later. The impl took the simplicity path against an explicit architecture decision, so this is a deviation, not a defensible tie-break.

## V2 — ARCH-002: "hard-throw at ceiling" is a stale pre-check; budget is unbounded-overshoot under `parallel()`
- **Severity:** MEDIUM
- **Violated:** ARCH-002 ("**budget accounting** … hard-throw at ceiling … the shared **RunGuard** … so they cannot drift"); the scalability-consistency lens's "concurrency & consistency of failure/spend counting".
- **Evidence:** `src/run-manager.ts:314` calls `entry.guard.assertBudget()` (throws only if `_spent >= total`) *before* dispatch, but tokens are added only *after* the gateway returns — `src/agent-executor.ts:103` (`this._guard?.addTokens(delta)` inside `capture()`, invoked at `:192`, post-`invoke`). `RunGuard.assertBudget` (`src/run-guard.ts:67-71`) reads `_spent`, which is still stale for every concurrently in-flight call.
- **Failure scenario:** budget=1000; a `parallel([...50 agents])` — all 50 pass `assertBudget()` while `_spent` is 0, all dispatch (concurrency cap 16 in flight, rest queued but already past the budget gate), each adds ~1000 tokens → run spends ~50000 against a 1000 ceiling. The "hard-throw at ceiling" never fires as a spend cap.
- **Conflict note:** Single-authority is genuinely satisfied (one `RunGuard`, no cross-module drift — the ARCH-002 anti-drift goal holds). The gap is purely the *timing/consistency* of the ceiling under concurrency. A minimal fix consistent with C2 ("single-authority per run") is to reserve/pre-charge an estimate at `acquireSlot()` and reconcile in `capture()`, not a distributed-consensus mechanism.

## V3 — ARCH-002 + ARCH-006: nested `workflow()` corrupts the run journal via colliding `callSeq`
- **Severity:** HIGH
- **Violated:** ARCH-002 ("**serialized journal-append ordering**"); ARCH-006 (resume cache "keyed on `(prompt,opts)` **longest-unchanged-prefix**", journal per run); REQ-006 resume determinism.
- **Evidence:** `src/run-manager.ts:294` — a nested `workflow()` runs in a NEW `SandboxHost` whose `onAgentRequest` forwards to `this._handleAgentRequest(runId, …, callSeq)` using the **parent's** `runId`. But `callSeq` originates in the child process's own counter `let nextCallSeq = 0` (`src/sandbox/child-entry.ts:29,81`), and the nested workflow is a *separate* child process starting its counter at 0 again. Both the parent script's `agent()` calls and the nested workflow's `agent()` calls append to the **same run's** journal (`src/run-manager.ts:346-347`) with overlapping `callSeq` values (parent 0,1,2… and nested 0,1,2…).
- **Failure scenario:** parent calls `agent(A)` (callSeq 0) then `workflow('child')` which internally calls `agent(B)` (nested callSeq 0). Journal now holds two callSeq=0 rows with different `(prompt,opts)`. On `workflow_resume`, `ResumeCache.build(entry.journal, …)` / `replay(callSeq, key)` (`src/run-manager.ts:309-311`) key on `callSeq`, so the longest-unchanged-prefix match is computed over duplicate keys → wrong cache hit / non-deterministic replay, violating REQ-006.
- **Conflict note:** No lens trade-off here — this is a straight correctness/consistency defect. Fix: namespace nested journal entries (e.g. a compound `callSeq` or a per-invocation sub-run id) so the per-run journal keyspace stays unique.

## V4 — ARCH-003: determinism guards are bypassable; the process boundary does not back them
- **Severity:** LOW
- **Violated:** ARCH-003 ("determinism guards (`Date.now`,`Math.random`, argless `new Date()` throw)"); indirectly REQ-006 replay integrity (resume cache assumes deterministic re-execution).
- **Evidence:** `src/sandbox/guards.ts:163-174` builds the VM context with host-realm objects/functions (`agent`, `parallel`, `pipeline`, `workflow`, `args`, `budget`). `node:vm` is not a security/realm boundary, so a script reaches the host realm's `Function` via e.g. `parallel.constructor.constructor('return Date.now()')()` and calls the **real** `Date.now`/`Math.random`, defeating the guarded `Date`/`Math` injected at `:37-64`.
- **Conflict note (this is the core three-way tension):** For **secrets/network/fs**, the architecture is right that the *process* boundary (ARCH-003/D6/C1), not the VM, is the real defense — an escapee lands in a child that holds no keys/store/network, so the security blast radius is genuinely contained (this part is sound and I do not fault it). But **determinism is not a process-boundary property** — the child has a real clock/RNG — so this specific guard is unenforced, and the resume-cache correctness that depends on it is weaker than ARCH-003 states. Honest severity is LOW because the threat model is Claude-generated (non-adversarial) scripts; flagged so the design text stops implying determinism is enforced when it is only advisory.

## V5 — ARCH-005 / D-R2: SDK gateway forwards the entire host environment to the spawned CLI
- **Severity:** LOW-MEDIUM
- **Violated:** ARCH-005 ("**sole custody of provider API keys** (parent-only)"); D-R2 hermeticity as stated in-code ("this class never reads or forwards a real host credential").
- **Evidence:** `src/gateway/claude-agent-sdk-client.ts:129-133` — `env: { ...process.env, ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY: DUMMY_API_KEY }`. Only `ANTHROPIC_API_KEY` is overridden; every other host variable (`OPENAI_API_KEY`, `GEMINI_API_KEY`, cloud creds, tokens) is spread verbatim into the spawned `claude` CLI subprocess.
- **Why it matters:** contradicts the D-R2 claim of forwarding *no* real credential. The subprocess is parent-trusted (not the sandbox child), so this is not a sandbox-escape leak — hence not HIGH — but it is a real deviation from the stated "sole custody / never forward a real host credential" rationale and widens the attack surface of a tool-loop-capable CLI. Fix: pass an explicit allowlisted env (base URL + dummy key + PATH/HOME as needed), not `...process.env`.

---

## Advisory (Karpathy simplicity tie-breaker) — gateway path proliferation vs ARCH-005 "one impl today"
- **Not counted as a violation; flagged for the record.**
- ARCH-005 said the gateway is exposed "through a narrow `GatewayClient.invoke` … (**one impl today**, `LiteLLMGatewayClient`)". The delivered surface is three parallel dispatch paths — `LiteLLMGatewayClient` direct-fetch (`src/gateway/client.ts:48-151`), the same class's LiteLLM-proxy path (`:159-204`), and `ClaudeAgentSdkGatewayClient` (`src/gateway/claude-agent-sdk-client.ts`) — each re-implementing its own `AbortController` timeout/abort/retry race (`client.ts:55-61,175-179`; `claude-agent-sdk-client.ts:87-155`). This is legitimately driven by user decision D1 (real SDK session) and Gate-7.5 route-backs, so it is not a violation — but the duplicated race/timeout logic across three paths is the kind of surface Karpathy's "minimum architecture" discipline would consolidate (one shared bounded-race helper). Testability lens agrees: three near-identical paths each need their own abort/timeout tests.

---

## What the impl got right (adversarial lens, for balance)
- **Trust split (D6/C1):** real per-run child process (`src/sandbox/host.ts:62-66`), SIGKILL abort from outside the isolate (`:130-134`), child holds no store/keys/network — secrets blast radius is genuinely contained. Security lens satisfied on the property that actually matters.
- **Testability seams (C3):** gateway/store/spawner/clock are all constructor-injected (`src/run-manager.ts:87-96,128`); `SandboxHost.onAgentRequest` defaults to a canned response so scripts dry-run with zero model calls (`src/sandbox/host.ts:75`) — the master test seam the architecture promised exists.
- **Bind default (ARCH-001/D5):** `bind = config?.bind ?? '127.0.0.1'` (`src/server.ts:107`) — compliant, 0.0.0.0 is opt-in.
- **Caps (ARCH-002):** concurrency `Math.max(1, Math.min(16, cores-2))` (`src/run-manager.ts:92`) and agent cap 1000 (`src/run-guard.ts:5,45-51`) match spec.
- **Fail-fast validator (ARCH-008/D-VAL):** thin facade delegating meta/parse/alias/name checks at submission (`src/submission-validator.ts:44-82`) — ownership not inverted, matches the D-VAL resolution.
