# v40 Gate 6 — clarification rulings (2026-10-16)

The composed run `wf_29dc525c-7ee` stopped at gate `impl` with 17 implementer clarifications plus one
Gate 2 `owner_decision`. The orchestrator put one question to the owner and proposed rulings for the
rest. The owner accepted every ruling in session: 「接受」(OD-1) and 「可以,照做」(R-1..R-17).
Partial GREEN state at the stop: commit `0c31a63`. The golden "before" provenance for TASK-265/266 is
commit `0e19fae` (Gate 5 WIP). Its `src/models/model-catalog.ts` is the
pre-v40 file (`git status src` was empty when it was taken).

## Owner decision

**OD-1 — image-capable chat models are accepted by `generateImage()`.** `meta.params.images.<label>`
accepts a model whose catalog **output modalities include `image`**, whatever its `modelType` (e.g.
`google/gemini-2.5-flash-image`, catalogued `chat`). The REQ-223 gate for `images` becomes
"output includes image", not "modelType === 'image-gen'". `decisions` stays strictly `decision`, and
`agents` stays strictly "not a known non-chat type". REQ-223 acceptance text is amended to match.

## Rulings

| # | Clarification | Ruling |
|---|---|---|
| R-1 | TASK-265 golden must be committed before TASK-266 | **Resolved**: Gate 5 WIP commit `0e19fae` captured fixtures + golden while `model-catalog.ts` was untouched. Record its hash in the TASK-265 note. |
| R-2 | `models_list` MCP schema enum lacks `decision` (`tool-specs.ts`) | **Add** `decision` to the enum + description; `src/tool-specs.ts` joins TASK-273's files. Needs a test that `models_list({modelType:'decision'})` passes the real tool schema. |
| R-3 | `filterCatalog` gained a `modelType` filter (deviates from "filter code unchanged") | **Accept** the deviation; amend DES-269 text. |
| R-4 | Price-string collapse: an image model with token price 0/unknown but a real per-image rate shows `price:'free'` and loses its price | **Must fix** — a per-image model shown as free is a REQ-225 violation ($0 for a priced call). The per-image rate must survive on the row independently of the token `price` string, and `pricePrimitiveCall` must use it. Needs a RED test with a fixture row `prompt:'0', completion:'0', image_output>0`. |
| R-5 | `docs/AUTHORING.md` needs `npm run gen:authoring` regeneration | **Expected** — the integrator regenerates after TASK-269/273. |
| R-6 | Failed primitive usage event lacks `reason`, so it derives as `done` | **Fix** in TASK-271: the failed-state usage event sets `reason`. Needs a test that a failed decide derives as `failed`. |
| R-7 | `aggregateFacts` decide/image buckets have no direct test | **Add** a UT for the bucketing. |
| R-8 | `label` is optional on `runDecide/runImage` | **Accept**; the handler must pass `req.label`. Add an assertion that the thrown message quotes the label. |
| R-9 | `defaultDirectDeps` and `CatalogSourceRow.modelType` implemented ahead of tests | **Accept**; both get covered by the R-10/R-11 tests. |
| R-10 | `scanPrimitiveCalls` refusals (non-literal label/options; model/timeoutMs/retries inside the call's options) | **Option (a)**: mirror the agent path exactly. Return AgentCallViolation-shaped `violations`; `workflow-catalog.ts` throws the existing generic `SCAN_VIOLATION`. No new ErrorCode. Needs RED cases in `scan-primitive-calls.test.ts`. |
| R-11 | Wire `checkPrimitiveModelType` into registration | **Wire for all three kinds** (agents, decisions, images per OD-1), at **new registration only** (never admission/resume, per V40-Q6). Needs tests: embedding model in `agents` → `MODEL_TYPE_MISMATCH`; unknown/id-heuristic → registered + warning; an existing registered version still admits. The full existing registration suite must stay green. |
| R-12 | `checkMermaid` / `skeleton-graph.ts` must accept primitive labels as nodes | **Add** `src/skeleton-graph.ts` to TASK-268's files. Primitive labels are accepted as node ids, never required, excluded from `deriveExpectedGraph` and `AGENT_BEFORE_PHASE`. Needs a test. |
| R-13 | No validator for run-time overrides of `decisions`/`images` params | **Add** one: an override for an undeclared label takes the existing unknown-label refusal path; `retries` is bounded by a ceiling on the override path. Needs a DES entry (signature) + tests. |
| R-14 | Primitive refusals bridged through the 8-slot shared refusal ledger | **Accept the bridge, split the cap**: primitive entries get their own cap/counter, so they can never evict an `agent()` refusal (e.g. `BUDGET_EXCEEDED`) from its slots. Needs a test: 9 caught decide failures, then an agent `BUDGET_EXCEEDED` keeps its real code. |
| R-15 | `system_info` semaphore gauges (DES-275) | **Defer**: `system_info` does not show the agent semaphore today either. Keep `/api/status` only, and amend DES-275/TASK-272 text so nothing claims `system_info` shows them. |
| R-16 | `workflow_describe` drops decisions/images | **Implement** the projection in `workflow-view.ts` (model/timeoutMs/retries) with a UT. Agents author these workflows and need describe to show them. |
| R-17 | Guide examples use live OpenRouter ids (`typesafe/jev-1.13`, `black-forest-labs/flux-3-image`) | **Accept**; note the drift risk. With OD-1 the image example may also use a chat image model. |

Out of scope / do not touch: `package-lock.json` churn from an `npm install` (platform optional deps
only, `package.json` unchanged). It is left uncommitted and must not be "fixed" with `git checkout`.

## Round 2 — second Gate 6 stop (run `wf_93b33a88-4c8`, 2026-10-16)

Full suite at the stop: 6273 tests, 25 failed in 11 files (report: `.sdlc/.scratch/v40-fullsuite.json`).
The core decide()/generateImage() path still ends `failed` end-to-end, and the registration declare/use checks
(`primitive-contract.test.ts`) are not wired. Gate 6 is not done; these rulings unblock it.

| # | Clarification | Ruling |
|---|---|---|
| R-18 | IT-154 forbids the string `PRICE_UNKNOWN` (ADR-038, v26: unpriced agent() is admitted at $0), but V40-Q12 refuses unpriced primitive calls under a USD budget | **Owner decided 2026-10-16: 「分開處理」.** Primitives refuse with `PRICE_UNKNOWN`; `agent()` keeps ADR-038's admit behaviour unchanged. Narrow IT-154 so it pins only "the agent() path never emits `PRICE_UNKNOWN`" (e.g. an unpriced agent call under a USD budget is admitted with `unpriced:true`), and drop the global grep. Record the split as an ADR-038 amendment line. |
| R-19 | IT-314 never asserts the REQ-230 bound | **Strengthen IT-314**: stub provider with a fixed delay, then assert p95(script-observed − provider-observed) ≤ 200ms over 100 calls. Measure with timestamps from the stub, not wall-clock guesses. |
| R-20 | `status-disclosure` (anonymous `/api/status`) now leaks `decideSemaphore`/`imageSemaphore` | **Security regression; fix.** Anonymous callers keep exactly `{agentSemaphore, version}`. The new gauges go only on the authenticated branch. The test is right; do not edit it. |
| R-21 | `authoring-guide` EXAMPLE_MODEL invariant broken by the decide/image guide examples | **Extend the invariant, don't weaken it**: chat examples keep `EXAMPLE_MODEL`; decide/image examples use single constants `EXAMPLE_DECISION_MODEL` / `EXAMPLE_IMAGE_MODEL`, and the test pins each kind to its constant. |
| R-22 | `register-bash-subsumption-warning`: a guide example (decide gate with agent fallback) trips a warning | **Fix the example**, not the warning: guide examples must register warning-free. |
| R-23 | Tests use `openrouter/black-forest-labs/flux-1.1-pro`, which OpenRouter has retired (live catalog → `UNKNOWN_MODEL`) | **Replace** with `EXAMPLE_IMAGE_MODEL` (a live-listed image model; per OD-1 `google/gemini-2.5-flash-image` qualifies), and add that row to `tests/fixtures/models/openrouter-models-all.json`. Tests stop depending on a retired id. |
| R-24 | Full-suite enumeration was tail-only | **Done by the orchestrator**: the 11 failing files are listed above. Gate 6 closes only when the full suite is green apart from failures proven to predate v40. |
