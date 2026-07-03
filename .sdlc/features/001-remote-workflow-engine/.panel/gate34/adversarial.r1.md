# Gate 3+4 panel — Adversarial group (interface-contract ⟂ boundary/error ⟂ testability)

> Model contract: claude-opus-4-8. **Provenance note:** this host exposes no Agent/Task tool, so
> the designer ran this lens group itself (degraded fallback per the Gate 3+4 contract). Karpathy
> simplicity-first is the tie-breaker throughout. Safety_class=QM → no functional-safety/cyber lenses.

## (a) interface-contract lens
- The seven MCP tools + `workflow_agent_log` must share ONE result envelope `{runId,status,result,error?}`
  so agent callers branch identically (already an ARCH-001 promise). DES must pin the envelope type and
  the `workflow_run` → `runId` (async) → poll `workflow_status` → `workflow_result` contract.
- The three injected seams (RunStore, GatewayClient, AgentSpawner/SDK) each need a narrow port with
  explicit input/output types; the IPC seam needs a **discriminated-union** message protocol (tag field)
  so child↔parent framing is unambiguous and versionable. Request/response correlation by `(runId, callSeq)`.
- `budget` handed into the VM is a **read-only view** — the interface must make mutation impossible
  (getters only, no setter), because ARCH-002 is sole source of truth.
- workflow-API VM bindings must expose EXACTLY `agent/parallel/pipeline/phase/log/args/budget/workflow`
  and nothing else (no fs/require/process). Signature parity with compat-spec §2 is the contract.

## (b) boundary/error lens
- Enumerate every null-returning path so the verifier can test each: (1) `agent()` terminal API error
  after retries → `null`; (2) `parallel()` thunk throw → that slot `null`, call never rejects; (3)
  `pipeline()` stage throw → item drops to `null`, remaining stages skipped; (4) provider unreachable/hung
  → bounded timeout→retry→`null` (D-G). These four MUST be one shared null-semantics contract, not four
  ad-hoc `catch`es, else they drift.
- Hard-throw (NOT null) paths, equally testable: budget ceiling reached (`spent()≥total`), second-level
  `workflow()` nesting, unknown `workflow(name)`, determinism-guard calls (`Date.now`/`Math.random`/argless
  `new Date()`), >4096 items/call, >512 KB script, TS-not-JS parse, malformed `meta` literal, unmapped
  model alias (at submission), unknown `agentType`.
- Boundary: concurrency cap `min(16,cores−2)` — at exactly N thunks none queue; at N+1 one queues.
  Agent counter hard cap 1000. These are off-by-one hotspots the UT must hit.
- Store must survive process restart mid-run: a `suspended` run re-hydrates; a `running` run at crash
  becomes recoverable/`failed` deterministically (define which).

## (c) testability lens
- Every DES must be coverable by a UT with the three seams stubbed. The IPC seam is the **master test
  seam**: stub AgentSpawner → dry-run the 641-line `sdlc-run.js` fixture with ZERO model calls. Design the
  AgentSpawner port so a fake returns canned results keyed by `(prompt,opts)`.
- **Clock/RNG seam consistency (Exit-Gate 5):** the determinism guard is the injection point for time and
  randomness. Name every method that reads time. In this kernel the ONLY sanctioned time reads are
  RunRecorder transition timestamps and the journal append timestamp — both live parent-side in ARCH-006.
  Rule to state in DES: *every parent-side method that stamps time takes the injected `Clock`; the sandbox
  VM has NO clock at all (guards throw)*. There is no `get_due(clock)`/`rearm(wallclock)` asymmetry here
  because the v1 kernel has no scheduler (that arrives at ARCH-010/v2 and must adopt the same injected
  Clock when built — flag forward). Avoid `Date.now()` anywhere in kernel code except behind `Clock`.
- Budget/token accounting must have ONE path (token deltas from the Executor feed both the `budget` view
  and the status API) so a UT asserting `budget.spent()` also asserts the status number — no divergence.

## Headline
Pin one envelope, one null-semantics contract, one tagged IPC union, and a fully-stubbable AgentSpawner
master seam; enumerate every throw-vs-null boundary; inject Clock into every parent-side time read (VM has
none). Simplicity holds — no new engines, only narrow ports at the already-chosen seams.
