# Quality-dimensions expert — Architecture round 1 (v35, REQ-205..210)

## Scope

state.yaml: v34 CLOSED (`dc652d9`, `.panel/` deleted, 52 items, 0 new gaps). This round is Gate 2
for **v35 only** — REQ-205..210, six requirements the requirements doc's own routing note (`01-requirements.md`
tail, "**路徑**") assigns to `/sdlc-fix` F1–F6 as "既有行為的修正或說明補齊,無新外部整合、無新能力". An
architecture panel is running anyway (orchestrator's call, not mine to relitigate), so I scope my four
dimensions to what these six REQs actually touch and file everything else — and there is a lot else,
this being a v34-deep system — under Risks §"out of v35 scope". Every `key_point` below traces to one
of REQ-205/206/207/208/209/210. I did not re-read the full `02-architecture.md` (125KB); I grepped the
seams the six REQs name and cite ARCH-IDs where a grep hit one (ARCH-005 gateway, ARCH-006 store, the
REQ-055/059/060 terminal-snapshot/journal-replay family). Where a REQ names a seam with no existing
ARCH-ID (the registration scanner, `checkMermaid`'s v2 param, `content[0]` wrapping), I say so — that
absence is itself a datum for Replaceability/Consumability below, not a gap in my reading.

## Altitude decision

This project is **both** a system and an AI-agent system (`state.yaml tech_stack`: Node/TS server,
SQLite, hand-rolled MCP-over-HTTP; **and** Claude Agent SDK / LiteLLM-routed `agent()` execution,
D1/D2). But the six REQs in front of this gate don't touch every altitude evenly — forcing all eight
cells (4 dimensions × 2 altitudes) would manufacture content the REQs don't ask for:

- **Observability** — agent altitude is the live one (REQ-205, REQ-207: a run's/agent's internal
  failure state must be inspectable without the caller reverse-engineering `agents[]`). System-altitude
  observability (logs/metrics/traces as infra) is unchanged by this iteration — not discussed further.
- **Replaceability** — system altitude: REQ-208 (regex scanner → should sit behind a swappable
  classification port) and REQ-209 (`checkMermaid`'s optional 5th param is a pluggability anti-pattern —
  a caller can silently downgrade coverage). Agent altitude (GatewayClient/LiteLLM swap, D2) is **already
  delivered** (ARCH-005) and none of REQ-205..210 touches it — noted for completeness, not re-argued.
- **Consumability** — agent altitude: the MCP tool surface *is* the SDK here (REQ-206, REQ-207, REQ-210
  are all about what a cold caller can correctly infer from the advertised interface alone).
- **Self-sustainability** — **system altitude only, and mostly N/A by design.** This is a self-hosted,
  single-node QM tool (D-G: "No heavier circuit-breaker/bulkhead is proposed — speculative for a
  single-node QM tool"). There is no LLM in the engine's own control loop except the optional
  `graphAnalyzer` (REQ-104, untouched by v35), so "self-reflection / prompt calibration" and "memory
  metabolism" at agent altitude would be the forced-irrelevant case the brief warns against — I say why
  below rather than skip silently, and file the one genuine future risk (journal.jsonl growth for
  resident/cron workflows) as backlog, not as a v35 finding.

---

## 1. Observability

**REQ-207 is this dimension's own words back at me almost verbatim** ("run 層要能讓呼叫端一眼看出「裡面全垮了」…現況需要呼叫端自己去讀 `agents[]` 才發現" — a silent/opaque failure is exactly the design defect this lens exists to catch). Two separable claims inside REQ-207, and they need different architectural remedies:

- **Run-level health signal.** Today a run where every `agent()` timed out still reports top-level
  `completed`/`result:null` with no aggregate signal — the caller must count `agents[].state==='failed'`
  itself. The fix is a **derived, not stored** field (`failedAgentCount`/`healthyRatio` or similar) computed
  the same way `computeWorkflowMetrics` already folds over terminal runs (§ARCH note near `RunStatusView`
  metrics) — i.e. this is a **read-model projection**, not a new write path, and should sit next to the
  existing `RunStatusView` fields (`terminalAt`, `agents[]`) rather than becoming a second source of truth
  that can drift from `agents[]`. **Design risk to flag now**: if this field is computed once and
  persisted at the terminal snapshot (REQ-055's pattern) instead of derived on read, it becomes a second
  place a fix can be applied and forgotten — exactly the class of bug REQ-186/REQ-189 (v31, `costUSD`
  presence bugs) already burned this codebase on. Recommend: pure fold, computed on every read, same
  as `computeWorkflowMetrics`.
- **Sequential-`await agent()` null-on-failure is undocumented, and the guide teaches only half of it.**
  `types.ts:189`'s `null`-not-throw is deliberate (matches `parallel()`'s thunk semantics), but
  `workflow_authoring_guide` currently only states the `parallel()` half — a cold subject let a
  stringified `null` flow into the next prompt (`"Critique this draft in one sentence: null"`), silent
  data corruption, not a crash. This is a **documentation-as-interface** finding, not a runtime one — the
  observable seam already exists (the value really is `null`); what's missing is that the guide doesn't
  teach the caller to *look* for it. Cheap, textual, no new ARCH surface.

**REQ-205** already owns the piece I'd otherwise have flagged as missing: it explicitly carries the
`toErr()`/`.detail`-drop widening routed here from v34 ("v34 路由過來的那條… v34 刻意不偷渡、在此正式
處理") — `run-manager.ts`'s `toErr()` must stop dropping the thrown error's `.detail` object so a
structured marker (e.g. `violation: AGENT_OPT_RETIRED`) is readable from the run-level error packet, with
its own test. Endorsed as scoped; no gap there. REQ-205's three other Given clauses (a dedicated `runs.error`
column distinct from `result`, so `run_result`'s `{ok:false}` shape stays unambiguous; a
`journal.jsonl` line recording terminal status + reason, closing the "directory completely empty" case;
`run_status`/`run_list`/dashboard exposing the reason as a field) are all likewise well-specified and
grounded in real evidence (`run bb151ba2`, `sqlite-run-store.ts:233`'s `recordResult` persisting only
success values).

One question REQ-205's own Given clauses don't cover, because every one of them describes a
**script-throw** failure (the reproducing case is a normal `_transition`-mediated `failed`, not a process
death): *who writes the reason line when the writer itself is what crashed?* REQ-060's boot-recovery path
reclassifies a row left `running` at boot (SIGKILL/OOM/power-loss mid-run) to `interrupted` — a
non-terminal, resumable status that never passes through the `_transition` choke REQ-052's `onTerminal`
hook fires from. If `interrupted` never becomes `failed` (because the run resumes and later completes),
REQ-205's disk-reason guarantee correctly doesn't apply to it. But an `interrupted` row that a caller
*never* resumes has no terminal status at all under the current state machine, and by REQ-205's own
literal Given clauses ("因腳本拋錯而失敗的 run") it's genuinely outside this REQ's stated scope — I'm not
asking REQ-205 to grow to cover it, only flagging that a crash-and-never-resumed run remains
diagnostically silent after this REQ ships, which is a real but *separate* gap (arguably v36's, not a
v35 send-back).

## 2. Replaceability

Both live findings here are the same architectural anti-pattern — **an interface that lets its caller
silently choose a weaker implementation without being told** — showing up in two different tools:

- **REQ-208** — `scanAgentCalls` is a regex over raw source text, so it cannot distinguish a real
  `agent(` call from the same four characters sitting inside a string literal (the reproducing case:
  system-prompt text embedded in an `agent()`'s `prompt` string — which is the *officially sanctioned*
  post-v34-agentType-retirement pattern — containing `agent (` as English prose). A regex fundamentally
  cannot solve this correctly; it needs to sit behind a **real-parser classification port** so "is
  this string a call site" is answered by parsing, not pattern-matching. One caveat before the designer
  picks an implementation: `package.json` runs this engine on Node 22.6's native
  `--experimental-transform-types` (type-stripping at runtime via `tsx`), and `typescript` is a
  **devDependency only** — used for `tsc --noEmit` type-checking, never loaded at runtime. Pulling the
  full TS compiler API into the registration path (a runtime code path) would newly promote a
  devDependency to a production one, an unforced complexity increase the simplicity lens should and will
  push back on (see Expected disagreements). A lightweight JS/TS-aware parser already scoped to runtime
  use (the `acorn`/`meriyah` family, or the TS compiler API only if this codebase separately decides it
  wants `typescript` as a real runtime dependency) satisfies the same structural argument at a fraction
  of the footprint.
  The REQ's own constraint — existing `SCAN_VIOLATION` tests must stay green — means this is a drop-in
  behind the *same* call signature, which is the replaceability property actually being asked for here:
  swap the classifier without touching every caller.
- **REQ-209** — `checkMermaid`'s 5th parameter (the v2-rules toggle: `DIAGRAM_DIRECTION`/`LANE_MISMATCH`/
  `TOOLS_MISMATCH`/`EDGE_MISMATCH`) is **optional**, and the real registration path (`workflow-catalog.ts:548`)
  always passes it while a direct unit-test caller can omit it and get a structurally-incomplete-but-green
  result — this is precisely how v34 shipped a doc example that passed the "static check" and then failed
  real registration twice (`TOOLS_MISMATCH`, `EDGE_MISMATCH`). An optional parameter that silently
  degrades coverage is a replaceability defect in the interface-design sense: two "implementations" of
  "checked" exist behind one name, and nothing forces the caller to know which one they got. REQ-209's own
  acceptance text already names the fix menu (required param / fail-closed / explicit
  "v2 rules not covered" marker on the result) — from this dimension's chair, **fail-closed by default
  with an explicit opt-out** is the one that can't regress silently again (a required-param signature
  change is enforced by `tsc`, matching this repo's stated preference for compiler-pinned guarantees
  over prose/test-only pins — see the v34 quality-dimensions round's D5 concession on exactly this
  point: "a sentence about a sentence is neither" self-checking).
- Agent-altitude replaceability (LiteLLM/GatewayClient swap, D2) is unaffected by any of REQ-205..210 and
  I'm not re-scoring it — ARCH-005 already delivers it and no v35 REQ touches `GatewayClient.invoke`.

## 3. Consumability

REQ-206, REQ-207 (its worst-case-timing clause), and REQ-210 are three instances of the same
consumability defect: **the advertised interface understates what the caller will actually receive**, so
a cold client (this codebase's own recurring acceptance-test subject — REQ-117, REQ-130, REQ-209 all use
"a cold model/client with only the schema/guide") gets it wrong the first time, exactly the failure mode
this iteration's REQs are collectively about (note the REQ-117-style framing embedded in REQ-206/207/209's
own acceptance text — "冷主體...因此..." — this is not incidental, it's this iteration's organizing test).

- **REQ-206**: an omitted `args` currently reaches the script as `null`, not `{}`, and a declared
  `args.<k>.default` is currently **rejected at registration** (`params/contract.ts:428`,
  `"never applied"`). Consumability reading: a documented default that is never applied is worse than no
  default — it's a promise the interface makes and breaks. The fix direction (materialize declared
  defaults into `effective_params`, always hand the script `{}` not `null`) is a pure interface-contract
  fix with a named, deliberate reversal of a prior Gate-8 ruling (P6-3) — the REQ text is explicit that
  the reversal is *for cause* (the "served but never applied is a silent lie" reasoning that justified P6-3
  no longer applies once serving means applying). I have no objection to the reversal; I'd ask that the
  reversal itself be pinned by a test asserting `default` really flows into `runs.effective_params`, not
  just that registration no longer rejects it — otherwise this recreates the exact "accepted but inert"
  shape P6-3 was written to prevent, just at a different site.
- **REQ-207's worst-case-wait clause**: `timeoutMs` bounds one attempt, not the call — deployed `retries:1`
  doubles real wait (advertised 60000ms, measured 120000ms). This is the same class of gap as the
  `content[0]` double-encoding below: a true fact about the runtime that the advertised interface doesn't
  state, so a caller's own timeout/retry budget is silently wrong. `workflow_describe` or the tool
  description should expose the *computed* worst case (`timeoutMs × (1 + retries)`), not just the
  input value — consumability's actual test (per the v34 round's own D1 finding, which I hold to) is
  "does hiding this fact cost the caller a decision they could make correctly" — here yes: a caller sizing
  its own upstream timeout needs the multiplied number, not the per-attempt one.
- **REQ-210**: `content[0].text` being double-JSON-encoded and `workflow_authoring_guide` being ~39.5KB
  are both facts a cold client currently discovers by hitting them (one truncation, then a second, before
  getting the full guide) rather than by reading the advertised interface. Minimal fix is documentation
  (state the encoding, state an approximate size) and costs nothing structurally. One thing I'd want
  checked, not asserted, before this ships as "documentation only": whether the hand-rolled JSON-RPC
  transport (`src/server.ts`, confirmed drift from `@modelcontextprotocol/sdk` per `tech_stack`) could
  cheaply move to the MCP spec's `structuredContent` field instead of a stringified-JSON-inside-text
  envelope — if that's a small change it removes the defect instead of just labeling it, and REQ-210's
  wording ("有明說" — "state it") doesn't foreclose that reading. Flagging as an open question for the
  designer, not asserting the migration is trivial (I haven't read `server.ts`'s response-building code).

## 4. Self-sustainability

**Mostly N/A at agent altitude by design**, and I want to say why rather than force a finding:
this engine has no autonomous LLM control loop of its own outside the optional `graphAnalyzer`
(config-driven, human-triggered by re-registration, REQ-104 — untouched by v35), so "memory metabolism",
"tool-liveness probes", and "self-reflection/prompt calibration" describe a category of system this one
mostly isn't. At system altitude, autoscaling/self-healing are explicitly out-of-scope by prior owner
decision (D-G: "no heavier circuit-breaker/bulkhead… speculative for a single-node QM tool") and none of
REQ-205..210 reopens that.

What v35 *does* touch under this dimension:

- **REQ-209's automation requirement is itself a self-sustainability fix**, and the good kind: "既有的
  `guide-examples-register.test.ts` 擴及 DEPLOY.md/README" turns a fact that silently rotted once already
  (v34: static-check green, real registration red, twice) into a **closed-loop guard** — a test that
  re-verifies the claim on every future doc edit instead of relying on a human re-reading prose. This is
  the correct shape per this repo's own house lesson from the v34 round's D5 concession: a prose-matching
  test "certifies whatever prose existed when it was written," a behavior test against the real code path
  is the durable form. REQ-209's ask is already specified as the latter (real `workflow_register`, not a
  re-implementation of the static checks) — endorse as written.
- **REQ-207's degradation semantics being stated, not just present**, is this dimension's actual test for
  self-sustainability in a system with no autoscaling: "minimize human intervention" here means a human
  operator (or a calling agent) can correctly reason about failure without reading source — the guide
  teaching the `null`-on-failure contract and the multiplied worst-case wait are both instances of making
  an already-designed degradation path *legible* rather than adding a new mechanism.

**Backlog risk, explicitly out of v35 (do not action this gate):** `journal.jsonl` is append-only per run
and the store is designed around per-run files (ARCH-006) — fine for run-once-now workloads, but D11's
resident/cron execution modes mean some workflows run indefinitely. Nothing in REQ-205..210 touches
journal compaction/rotation, and I'm not asking it to — flagging so a future architecture round (when
resident-workflow retention actually gets scoped) has a pointer rather than rediscovering it live.

---

## Summary

REQ-205..210 are six documentation/interface-honesty fixes, not new capability — and every one of them
reduces to the same shape from this lens: **an internal truth the engine already computes or already
exhibits is not reaching the caller who needs it** (a failed agent's null, a doubled wait, a rejected
default, a mis-scanned string, a downgradable check, an encoding fact). None require a new subsystem.
REQ-205 is already correctly scoped for the script-throw case it targets (including the `toErr()`/
`.detail` widening carried over from v34). The two things I'd want a sentence of scoping on before
implementation are: whether a crash-and-never-resumed `interrupted` run (outside REQ-205's stated scope,
never reaches `_transition`) is accepted as staying diagnostically silent, or gets a follow-up item; and
REQ-206 pinning the default's *application*, not just its acceptance, so the fix doesn't repeat P6-3's
"served but inert" shape one layer down.

## Key points

1. REQ-207's run-health field must be a pure read-time fold over `agents[]` (mirroring
   `computeWorkflowMetrics`), never a second persisted source of truth — this codebase has twice shipped
   `costUSD`-presence bugs (v31 REQ-186/189) from exactly that drift pattern.
2. REQ-205 needs one clarifying line: does the diagnosable-reason guarantee cover only
   `_transition`-mediated `failed`, or also boot-recovery's `interrupted` reclassification (a SIGKILL
   never goes through `_transition` at all) — separate from the `toErr()`/`.detail` widening, which
   REQ-205 already owns and specifies correctly, no change requested.
3. REQ-208's fix belongs behind a real-parser classification port, not a smarter regex — a regex cannot
   in principle distinguish a call site from a string literal containing the same text; use a lightweight
   runtime-scoped parser (acorn/meriyah), not the TS compiler API, since `typescript` is presently a
   devDependency only (`package.json`) and this is a runtime code path.
4. REQ-209's `checkMermaid` v2-param fix should be fail-closed-by-default (compiler-enforced via a
   required parameter), not a documentation note — matches this repo's own stated preference for
   structural guards over prose-pinned tests (v34 round's D5 concession).
5. REQ-206's default-application fix needs its own test asserting the value reaches
   `runs.effective_params`, not just that registration stops rejecting it — otherwise it recreates the
   "served but never applied" shape P6-3 was written to prevent.
6. REQ-207's worst-case-wait exposure should publish the *computed* `timeoutMs × (1+retries)`, not the
   raw input — the caller's decision (sizing its own timeout) depends on the multiplied number.
7. REQ-210's `structuredContent`-vs-double-encoded-text question should go to the designer as an open
   question (cheap fix vs. documentation-only), not be pre-decided here — I have not read the response-
   building code well enough to assert either way.
8. REQ-209's automated doc-example guard is the one self-sustainability-shaped item in this batch and is
   already specified correctly (behavior test against real `workflow_register`, not a prose match) —
   endorse as written, no change requested.

## Risks

- **Under this dimension, in scope**: if REQ-205/207's new signals are computed once and persisted
  (REQ-055-snapshot-style) instead of derived on every read, a future fix to the underlying failure
  classification can be applied to the live path and silently miss the persisted one — the exact bug
  shape this codebase has hit before (`composeConfig` wiring-gap class; v31 `costUSD` presence bugs).
- **Under this dimension, out of v35 scope (backlog, not actionable this gate)**:
  - `journal.jsonl` has no compaction/rotation story for long-running resident/cron workflows (D11) —
    unbounded append-only growth is a self-sustainability gap this iteration correctly does not touch.
  - No distributed tracing / correlation-ID propagation across the MCP→RunManager→GatewayClient→child-
    process boundary beyond the existing `runId`/`agentId` tagging (ARCH-005 note) — adequate for today's
    single-node deployment, would matter if the engine ever became multi-node.
  - No OpenAPI/Swagger generation for the dashboard's `GET /api/*` routes (the MCP tool descriptions are
    self-documenting per REQ-101/090, but the raw HTTP surface is not) — not raised by any REQ-205..210
    acceptance criterion; noting only because "generated docs" is this dimension's literal system-altitude
    criterion and it's worth a future REQ if the HTTP surface ever grows external consumers.
  - No tool-liveness probing (e.g. periodically confirming a configured Ollama/OpenRouter endpoint is
    still reachable between runs) — the current design instead pays the cost per-call (bounded
    timeout→retry→null, D-G) and that was a deliberate, user-confirmed v1 choice for a single-node QM
    tool; revisit only if resident/cron workflows (D11) make idle-provider-death latency-sensitive.

## Expected disagreements

- **Security lens vs. REQ-205**: writing a "diagnosable reason" to disk risks putting raw provider error
  bodies (which can carry request headers, partial prompts, or vendor-side diagnostic text) into
  `journal.jsonl` unredacted — the exact class of gap `redact()`'s v14 wiring fix (ARCH note on
  `redactHarness`/journal-as-replay-source, D-v14-B) was built to close for a different sink. I'd expect
  security to ask whether REQ-205's reason line routes through the same `redact()` chokepoint as every
  other persist sink, or is a new, unredacted write path.
- **Simplicity/Karpathy lens vs. REQ-208**: an AST-backed classifier is a real dependency and complexity
  increase over "fix the regex to exclude string literals heuristically." I've argued for the structural
  fix because a regex is fundamentally the wrong tool (can't parse nesting/escaping correctly in general),
  but I'd expect push-back to land on "smallest fix that passes the reproducing case" and it's a
  legitimate tie-break I don't get to make unilaterally.
- **Process lens**: REQ-205..210's own routing line says `/sdlc-fix` F1–F6, and this document exists
  because an architecture panel ran anyway. I'd expect at least one lens to flag that as process
  drift independent of anything above.
