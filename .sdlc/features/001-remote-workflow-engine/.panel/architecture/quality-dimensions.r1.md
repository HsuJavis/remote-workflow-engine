---
stage: architecture
lens: quality-dimensions
iteration: v27 — Round v27b delta (scoped run: gates architecture+design+tests, impactIds REQ-133 / REQ-134 / REQ-140)
round: 1 (independent proposal)
supersedes: the Sprint A r1 at this same path ONLY on the predicted-overlay predicate. The Sprint A body (53 KB, 2026-09-11 17:30) is preserved at `git show 07266be:.sdlc/features/001-remote-workflow-engine/.panel/architecture/quality-dimensions.r1.md` and stands unchanged for everything else (REQ-131/132/135/136/141, the client split, the usage accessor, REQ-136, demo mode, fonts, CSP). It is deliberately NOT pasted back in here — the synthesizer needs the delta, not the archive.
inputs: 01-requirements.md §Round v27b + REQ-133/134/140 (amended acceptance) + REQ-100 (:970-994) + REQ-105 (:1067-1070); state.yaml tech_stack + pending[0]; journal.md 2026-09-11 "Sprint A … Gate 6 stopped"; 02-architecture.md v27 slice (:3312-3663 — ADR-051 :3432, ADR-055 :3460, ARCH-126 :3364, ARCH-130 :3400, ARCH-131 :3409, the logical view, scenario 2 :3590, contract rows :3630/:3632, rationale "Retiring the `!authEnabled` mask"); 04-design.md DES-196/197/198 (:6745-6767); 03-tasks.md TASK-202/203 (:1699-1716); 05-tests.md UT-238 (:11772), IT-168 (:11797), VAL-199/200/204, IT-092 (v22 row); the v22 ancestors ADR-012, ARCH-073, ARCH-075, DES-114; 07-review.md H2 (:2983); src/server.ts :334, :500-552, :395-412, :555-575, :1236-1244; src/dashboard.ts :315-345; src/skeleton-graph.ts :25-30; src/workflow-view.ts :106; src/mcp-facade.ts :471-494; tests/integration/dag-masking-auth.test.ts; tests/unit/dashboard-derive-lanes.test.ts; tests/integration/dashboard-http.test.ts :140-150, :213-217, :251-265; tests/acceptance/val-116-skeleton-route-404.test.ts :1-4; README.md :308-330, :368-375; .panel/architecture/adversarial.r1.md D-ADV-2
---
# Quality-dimensions proposal — v27 delta: the predicted overlay is not principal-dependent

## summary

**What changed since the Sprint A r1.** The architect took my O-3 ("lanes from `view.phases`, leave the
overlay masked, state the masking rule in the contract row") as ADR-051 decision (a), escalated the
reversal as an `owner_decision`, and the owner overruled it: **開 —— 撤銷遮罩** (Round v27b). My r1
position on this predicate is therefore the one that lost, and this delta proposal is written from the
ruling, not from continuity. Gate 6 was stopped with zero product code written against the mask; the
mask reached exactly two test files — `tests/integration/dag-masking-auth.test.ts` (IT-092 / IT-168)
and `tests/unit/dashboard-derive-lanes.test.ts` (UT-238's `masked` arm) — plus every ledger row that
describes it.

**The one architectural call this delta has to get right: delete the `masked` axis, do not flip its
default.** DES-197 designed `McpFacadeDeps.maskPredictedOverlay?: boolean` as *absent ⇒ `true`
(masked)*, and ARCH-126/DES-196 designed `deriveLanes(…, { masked })`, both "so that when the owner
answers, one call site changes and no arithmetic moves". After the answer, a boolean whose only
legitimate value is `false` is a dead configuration axis — and its *fail-closed default now fails
closed to the behaviour the owner refused*: a facade constructed in a unit test, or a forgotten
forward at the one construction site, silently reproduces the overruled mask and nothing visible goes
red. That is this ledger's twice-bitten `composeConfig` class (MEMORY: "new config block forgotten in
composeConfig → feature silently off"), inverted. Proposal: no dep, no `opts.masked`; `expectedGraph`
is always derived at the DAG route; `predictedLanes` is always joined into `describe.phases[].agents`.
The Gate-5 verifier's own signature note (UT-238 calls `{ masked, status }` because ARCH-126 typed only
`{ masked }`, `dashboard-derive-lanes.test.ts:7-13`) collapses to `{ status }` and is reconciled here
instead of being left for Gate 6.

**The seam the reversal creates.** While the mask existed, a run page with fewer lanes than the script
declares was *a decision* (ADR-051 wrote it down). With the mask gone, the only remaining cause is a
derivation failure — and that is silent twice today: the inner `catch { }` at `server.ts:540-541` and the
`skeletonScript = ''` fallback after two catalog-resolve failures (`server.ts:500-506`). A just-started
run whose derivation failed is byte-identical on the wire to a run whose script has no agents
(`cells: ['__trigger__']`, `warnings: []`). Two pushes into channels that already exist close it: one
`warnings[]` entry on the DAG payload and the inner catch folded into ARCH-130's
`dashboard_api_degraded` line. Without them REQ-134's 「一眼看出卡在哪」 under auth is unverifiable
precisely when it fails.

**The traceability fold — and one row nobody has named.** Round v27b lists what it reverses: v22 H2 /
DES-114 / ARCH-073 / ARCH-075 / ADR-012. It does not list **REQ-105**, whose acceptance
(`01-requirements.md:1070`) still reads: *"Given the run-DAG route `/api/runs/:id/dag` … Then it
stays **behind the auth gate** (v22 finding H2 closed exactly this hole; v23 must not re-open it)"*.
After this delta the top of the chain would contradict the code, and Gate 8 verifies REQs against
code. REQ-105 needs the same `[PARTIALLY SUPERSEDED …]` marker REQ-100 already carries twice
(`:976-993`) — for the auth-gate clause only; the "serves layout only, never a named artifact" clause
and the C3 word-ban stand untouched. That is a Gate 1 housekeeping amendment for the orchestrator
(the ADR-053 acceptance-text precedent), listed first under key_points because it is the one item
this scoped run cannot do itself.

Everything else in this file is the sweep: which rows change meaning, which get a supersession
marker instead of a rewrite, and which must stay untouched and green so the delta cannot creep into
REQ-100's script masking.

## Altitude call (which system is this?)

Unchanged from the Sprint A r1: **both**, and this delta is predominantly **system-altitude** — a
disclosure rule on two unauthenticated read surfaces (`GET /api/runs/:id/dag`, `workflow_describe` /
`GET /api/workflows/:name/describe`), i.e. what a plain HTTP API serializes. The **agent-altitude**
reading is why the owner ranked it: the predicted overlay is the agent workflow's *plan* — which
agents will run, in which lane, with which tool surface — made inspectable *before* and *during*
execution. On the deployment the owner actually runs (「我 + 團隊,遠端連進來」 ⇒ `auth.enabled:true`)
the mask hid exactly that plan from the people it was built for. *Memory metabolism*, *tool liveness*
and *self-reflection* have no seam in this delta and are named once and dropped, as before.

---

## 1. Observability

**The question this delta asks of the observability lens is inverted from Sprint A's: not "does the
page show what the engine knows" but "when the engine cannot produce the overlay, does anyone find
out — and does every document still tell the truth about when it is shown".**

### System altitude

**O-Δ1 — With the mask gone, an absent overlay is a fault, and it must say so on the payload.**
Today the DAG route derives the overlay only `if (!authEnabled)` (`server.ts:520`) and degrades to an
empty `ExpectedGraph` on (a) two failed catalog resolves (`skeletonScript = ''`, `:500-506`) and (b)
any parse/derivation throw (`catch { }`, `:540-541`) — "the same graceful-degradation contract auth-masking
already relies on" (`:516-518`). Both arms were tolerable while auth-masking produced the same shape by
design; after the reversal they are the *only* producers of a lane-short page, and both are silent.
`layoutGraph` already owns a `warnings: string[]` channel on the payload (`dashboard.ts:315-345`) and
already uses it for "lane N is beyond the predicted layout: appended" (`:430-434`) — but that warning
fires only once a live agent lands in an unpredicted lane; a run with zero completed agents (the IT-092
harness case, and every run in its first seconds) emits nothing. Proposal: the route pushes one entry,
`predicted overlay unavailable: <reason>` with `reason ∈ {catalog-resolve-failed, derivation-failed}`,
into the same `warnings[]` the client already renders (REQ-134's legend row is the natural home:
「預測結構不可用」 beside the run summary). The v1-contract fallback (`deriveExpectedGraph(nodes, scan,
'v1')`, `:531-538`) is **not** a warning — it yields a real graph and REQ-124 requires those runs to
draw as before.

**O-Δ2 — …and in the journal.** ARCH-130 (4) already puts `{event:'dashboard_api_degraded', route,
reason}` on the two outer catches (`server.ts:582-585`, `:1067-1071`). The inner catch at `:540-541` is a
third catch on the same surface and should emit the same event with `route:'dag'`, `runId`, and the
reason — the DAG page is the one surface whose degradation now has no other witness. One line, the
existing convention (`diagram_render_failed`, `:440`).

**O-Δ3 — `current` and `lanes` after the reversal: the contract row, restated so the client has one
rule.** `lanes[]` = the observed phases (`view.phases`, `types.ts:293-298`, ordinal = index, the same
integer `layoutGraph` lays out as `col = lane.index + 1`, `dashboard.ts:363`) **always** extended by
the expected lanes the run has not entered yet (`ExpectedLane.index/title`, `skeleton-graph.ts:25-30`).
The only condition under which the extension is missing is O-Δ1's warning being present. `current`
is unchanged from DES-196 (defined for all seven `RunStatus` members). Under auth and under no auth
the byte shape is identical — that is the whole of REQ-140's 「在啟用 auth 時同樣回傳」 now.

**O-Δ4 — The traceability fold: three partitions, enumerated so the architect and designer amend by
list and Gate 8 checks by list.** This is the "folds in traceability" half of the lens, and it is
where the delta is most likely to be under-done, because the mask is described in more places than it
is implemented.

*(a) Rows whose MEANING changes — amend in place at `iter: v27`:*
- `src/server.ts` (the only product code the delta's tests will drive, named so Gate 6 does not stop
  at the branch) — the `if (!authEnabled)` guard (:520) leaves; `handleDashboardRequest`'s
  `authEnabled` parameter and its v22 comment (:331-334) leave; the `!!authCfg` argument (:1068) and
  the ":1064 masking flag" comment leave; the :508-518 comment block is rewritten to state the ruling
  and the degradation contract (R-Δ1, O-Δ1).
- `02-architecture.md` — **ADR-051** (:3432): decision → (b), `owner_decision` → answered (quote the
  ruling, cite Round v27b), and one added sentence saying where a future policy would live (R-Δ2).
  **ADR-055** (:3460): drop "masked exactly like the run-DAG predicted overlay (ADR-051), with (a) as
  the under-auth fallback". **ARCH-126** `api:` (:3369) — `deriveLanes(phases, expected, opts:
  { status })`, delete "only when `masked` is false", and its `note:` sentence "the `masked` parameter
  is not a policy decision taken here". **ARCH-130** `api:` (2) (:3405) — `deriveLanes(view.phases,
  expectedGraph, { status: view.status })`; the `if (!authEnabled)` guard leaves the route. **ARCH-131**
  `api:`+`note:` (:3414-3415) — delete "emitted only when the predicted overlay is unmasked … under
  auth the field is absent" and the whole "masking predicate must be handed to the facade explicitly"
  paragraph (there is no predicate to hand). The **logical view**'s `MASK{"authEnabled?"}` node and
  its two edges (:3505-3506). **Scenario 2** "Nine agents across five phases, auth on" (:3590) — now
  reads: every lane, the dashed edges to unreached nodes, by the owner's ruling. **Contract rows** for
  `GET /api/runs/:id/dag` (:3630, "Masking rule: …") and `describe` (:3632, "absent under auth").
  **Housekeeping (3)** in the rationale (:3663) — the `auth.enabled:true` validation case now proves
  presence, not degradation.
- `04-design.md` — **DES-196** signature/boundary (:6748-6749): `opts: { status: RunStatus }`; delete
  the `masked` sentences; keep "absent, never `[]`" with its new meaning (C-Δ2). **DES-197**
  (:6756-6758): delete `McpFacadeDeps.maskPredictedOverlay` and the "fail-closed" paragraph entirely;
  `phases[].agents` is joined unconditionally; `tests:` → open and auth servers assert the SAME
  positive shape. **DES-198** signature (2) (:6764): the `{ masked: authEnabled }` argument goes; add
  O-Δ1's warning and O-Δ2's log line to (4).
- `03-tasks.md` — **TASK-202** `dod:` (:1704): "a facade constructed with NO `maskPredictedOverlay`
  omits `phases[].agents`" and "the auth server answers `agents` ABSENT" invert; README row loses its
  masking sentence. **TASK-203** `dod:` (:1713): the DAG payload's `lanes` include unreached lanes on
  the auth server; the forced derivation failure produces the warning + the log line.
- `05-tests.md` — **UT-238** (:11772): 7×2×2 → 7×2 (status × phases); the two join cases become
  "always extends by the unreached expected lanes" + "expected `undefined` → observed-only AND the
  caller can tell" (the `undefined` arm survives as the derivation-failure arm). **IT-168** (:11797):
  cases 1–2 flip to positive assertions (auth ON: `lanes` includes index 2 "three"; auth ON:
  `phases[].agents` PRESENT with labels); case 3 unchanged. **IT-092** (v22 row, `traces: ARCH-073,
  ARCH-075, ADR-012, DES-114, DES-115, REQ-100`): case 1 flips from `['__trigger__']` to
  `__trigger__ + 3 __skel_*` under auth — the same measured shape its own red-reason paragraph
  recorded pre-fix; the row's title ("masks the script-derived skeleton overlay while auth is enabled")
  and the file's header comment (`dag-masking-auth.test.ts:1-16`) and `describe` title (:113) all
  invert. Give the flipped case its v27 trace (ADR-051, REQ-140) and keep the v22 traces as history.
  **VAL-204** (:12067): its real-tier path now proves *presence* on the auth server. **VAL-199 /
  VAL-200**: one `auth.enabled:true` Chromium case between them (S-Δ2).

*(b) Rows that get a SUPERSESSION MARKER, not a rewrite (history is read, not edited):*
- **REQ-105** (`01-requirements.md:1070`) — `[PARTIALLY SUPERSEDED v27, Round v27b]` on the "stays
  behind the auth gate … v23 must not re-open it" clause only; REQ-100's two existing markers
  (`:976-993`) are the house style. **Orchestrator item — outside this run's gates.**
- **ADR-012** (`/api/*` and the dashboard serve the non-owner view whenever auth is on — still true
  for *script text*; superseded for the predicted-overlay predicate), **ARCH-073** `api:` ("`/api/runs/
  :id/dag` serve[s] the non-owner projection whenever auth is enabled"), **ARCH-075** (trap 2/3:
  `skeleton`/`phases` "masked by default"), **DES-114** boundary ("the dashboard DAG loses its
  predicted-skeleton overlay") — one line each: *superseded in part (predicted-overlay predicate only)
  by Round v27b / ADR-051 v27; script masking unchanged.*
- **07-review.md H2** (:2983) — the finding and its closure are a record; a one-line pointer at the
  closure note ("predicate reversed by the owner at v27 Round v27b, see ADR-051") is enough.
- **Code and test comments that now lie** — `server.ts:508-518` (the v22 H2 / v26 DES-176 block:
  rewrite to state the ruling and the degradation contract), `val-116-skeleton-route-404.test.ts:1-4`
  ("`GET /api/runs/:id/dag` still serves its layout behind the auth gate (unchanged, v22 finding H2)"
  — the 404 assertion stays, the comment changes), `dag-masking-auth.test.ts:1-16, :113, :130-133`.
  REQ-105's own last clause is the standard: *the deletion is not finished while something still
  describes the deleted thing* — nine recorded instances by v23; this delta must not be the tenth.

*(c) Must stay UNTOUCHED and green — the delta's outer boundary (checked by ROUTE, not by the word
"masked": of the 16 test files that touch `/dag` or `__skel_`, only `dag-masking-auth.test.ts` boots
an auth-enabled server — `val-080`, `val-081`, `nested-frame-phase`, `diagram-contract-grandfather`,
`graph-payload-http`, `refused-survives-restart` and `dashboard-http` all run open, so none has an
auth case to flip):*
`tests/integration/workflow-masking-http.test.ts` (IT-089, `workflow_source`/`workflow_list` script
masking), `tests/acceptance/val-110-script-masking.test.ts`, `val-111-phases-public-everywhere.test.ts`,
`tests/unit/workflow-view.test.ts:119` (script body stays masked), `tests/acceptance/val-116-skeleton-
route-404.test.ts` (the `/skeleton` route stays 404 — REQ-105's live clause), `tests/integration/
dashboard-http.test.ts:213-217` (empty script ⇒ no `__skel_*` — unchanged, it is not an auth case) and
`:140-150` (the pinned `{kind,cells,edges,startedBy}` shape). `workflowSource`'s masked projection
(`mcp-facade.ts:494`) and `tool-specs.ts:352` are REQ-100 and are not in this closure. README
`:312-313`'s claim ("沒有後門端點能看到未授權的**腳本本文**") remains *true* after the reversal — the
overlay is structure, not text — and should not be edited.

### Agent altitude

**O-Δ5 — What the overlay makes observable, stated once so the ADR can cite it.** For a running
agent workflow the overlay is the only surface that shows *the difference between plan and progress*:
the dashed edge from a done node to an unreached one (REQ-134) is "this agent has not been dispatched
yet", as opposed to "this agent does not exist". The ruling's rationale (the same structure is already
public via `/api/workflows`, `describe.phases`, `describe.mermaid`, `toolSurface`, `mcp-facade.ts:
471-490`) is an *information* argument; the observability argument is that the run page is the only
place that structure is joined to live state, and the join is worthless if one side is withheld on the
owner's own deployment.

---

## 2. Replaceability

**The delta removes a seam; the lens's job is to make sure it is removed rather than parked, and to
say where the next policy would go so nobody re-parks it.**

### System altitude

**R-Δ1 — Delete the axis; a parameter with one legitimate value is coupling, not pluggability.**
Three places were designed to carry the predicate: `McpFacadeDeps.maskPredictedOverlay?` (DES-197),
`deriveLanes(…, { masked })` (ARCH-126/DES-196) and `{ masked: authEnabled }` at the DAG route
(ARCH-130/DES-198). None exists in code yet (`grep -rn 'maskPredictedOverlay\|deriveLanes\|
predictedLanes' src/` — no hits; the only `authEnabled` branch on this surface is `server.ts:520`).
`McpFacadeDeps` (`mcp-facade.ts:88-118`) carries no auth field today and should not gain one for a
value that is always `false`. Keeping the parameter "for symmetry" costs: a dead branch in a pure
function that the 7×2×2 table then has to test both ways (testing code with no legitimate input),
a dep that the twice-bitten wiring class can forget, and a `note:` that has to explain why it is
always `false`. Removing it costs one call site — and it must be removed all the way down:
`handleDashboardRequest`'s `authEnabled = false` parameter (`server.ts:334`, with its v22 comment at
`:331-333`) has exactly ONE consumer, the `if (!authEnabled)` at `:520`, and exactly ONE caller, the
`!!authCfg` argument at `:1068` (whose comment at `:1064` still calls it "the masking flag"). Once the
branch is unconditional, the parameter, the argument and both comments are dead — and a dead
`authEnabled` parameter on the dashboard handler is precisely the stump a future hardening reviewer
restores the mask from. `authAnnounce` (`:337`, `GET /api/system`'s `auth` key) is a different
parameter and stays; `server.ts` is on the six-file `no-skeleton-surface` allowlist
(`no-skeleton-surface.test.ts:54`), so rewriting its comment block is safe.

**R-Δ2 — Where a future policy lives (one sentence for ADR-051, so it is not re-derived).** If an
owner ever wants the overlay withheld again, the ruling itself tells us the shape: it is *not
principal-dependent* now, so making it principal-dependent later means a per-principal projection
through the auth layer — i.e. reopening Won't-have D1 and adding browser-session identity to
`/api/*`, which is a subsystem ADR-012 already declined to invent. It is **not** a global
`dashboard.predictedOverlay: boolean` config key "for safety": that would reintroduce the dead axis
with a `composeConfig` forwarding obligation (S-Δ3) to protect a state the owner refused.

**R-Δ3 — The derivation stays swappable and single.** INV-V27-4 ("one shape derivation") is
untouched: the DAG route, `predictedLanes` and the registration checker all consume
`deriveExpectedGraph` (`skeleton-graph.ts`, ARCH-113). `expected: ExpectedGraph | undefined` stays on
`deriveLanes`'s signature — not because a server may withhold it, but because derivation can fail —
and the docstring must say that, or the next reader restores the auth reading from the type alone.

### Agent altitude

**R-Δ4 — Nothing about the LLM backend or provider seam moves.** The overlay is script-derived
(`parseWorkflowSkeleton` + `scanAgentCalls`) and provider-agnostic; REQ-125's `provider`/`transport`
facts ride the *live* records, not the overlay. Recorded so the replaceability section is honestly
short rather than padded.

---

## 3. Consumability

**Two consumers: the browser client (`src/dashboard/ui/*.js`, ARCH-125) and any MCP caller of
`workflow_describe` (including the cross-repo `rwe-mcp` plugin). The ruling makes both simpler, and
the contract table must say so instead of leaving the "absent under auth" branch for them to discover
by reading tests.**

**C-Δ1 — One wire shape regardless of auth ⇒ one client code path.** DES-206's `ui/workflow.js`
(predicted layout) and `ui/run.js` (swimlane) no longer need an "auth on ⇒ lanes-only, no dashed
edges" branch, and the string table loses whatever 「auth 啟用時不顯示預測結構」 copy DES-197 would have
required. This is a *reduction* in what the client has to know: it never learns whether auth is on
for this view (it still does not — the synthetic `{kind:'auth-disabled'}` principal at `server.ts:402`
and `:563` is unchanged).

**C-Δ2 — `agents?` stays optional on the wire, and "absent ≠ `[]`" keeps its rule with a new
meaning.** DES-196/197's rule — absent means *unknown*, `[]` would be the lie "this lane has no
agents" — was written for the mask; it is exactly right for derivation failure too. So the type does
not change (`phases: Array<{ title: string; agents?: string[] }>`), only the sentence beside it in the
contract row: *absent iff the engine could not derive the predicted layout for this version; never
absent because of auth.* The client renders 「預測結構不可用」 for absence, one branch, one reason.
Same for the DAG: the client detects an inert predicted cell by `cell.agentId === undefined` (the
v11 DES-064 shape, `dashboard.ts:330-331`), **never** by the `__skel_` id prefix — the id is an
opaque identifier, the prefix is a retired word's stump, and a prefix test would couple the served
client bytes to it (INV-V27-8's guards walk `.js` now).

**C-Δ3 — The contract table rows, rewritten.** `GET /api/runs/:id/dag`: "gains `lanes` (observed
phases extended by every unreached expected lane — **regardless of auth**, Round v27b) and `current`;
if the predicted layout could not be derived, `warnings[]` carries `predicted overlay unavailable:
<reason>` and `lanes` are observed-only". `describe`: "`phases[].agents?` — the predicted lane
membership, **served to every caller regardless of auth**; absent only on derivation failure". The
README §Dashboard JSON REST API (`README.md:368-375`) has no describe row yet; TASK-202's `dod:` says
it gains one "with its masking sentence" — write it without one.

**C-Δ4 — Cross-repo note stays additive.** `workflow_describe.phases[].agents` is a new optional
field for every MCP caller; the plugin's authoring skill can now draw the predicted layout from
`describe` alone without parsing `mermaid`. One release-note line; no breaking change on this
surface (REQ-136's `harness.prompt` change remains the only breaking one in v27).

**C-Δ5 — Seen, out of closure, one line for the orchestrator.** `README.md:325-330` still says the
HTTP describe route "跟 /mcp 走同一套 D-BIND 規則 … 沒過就回 401" — that gate was removed by v24
adjudication #8 (`server.ts:1236-1244`). Not this delta's to fix, but TASK-202 touches the same README
section and a reader of the new `agents` row will read those lines next.

---

## 4. Self-sustainability

**Will the ruling still be in force in three iterations, with nobody watching? What keeps a future
"security hardening" pass from re-masking, and what keeps the page honest when the derivation breaks?**

### System altitude

**S-Δ1 — The regression guard is a positive integration assertion on the auth server, and it is
the only one.** After the delta, the thing that stops a future pass from restoring `if (!authEnabled)`
is IT-168/IT-092's flipped cases: *auth ON, anonymous DAG GET ⇒ `__skel_*` cells present, `lanes`
include the unreached lane, `describe.phases[].agents` present with labels.* Both servers already
boot in that harness (`dag-masking-auth.test.ts:46-64`, real `createServer` × 2, real `TokenStore`
bearer). A negative assertion ("not absent") is weaker than the positive shape; assert the labels.
Rename the file's `describe` titles so a future reader sees "the overlay is served under auth (owner
ruling v27b)" rather than "masks … while auth is enabled" — the title is the first thing the next
hardening reviewer reads.

**S-Δ2 — Gate 7.5's `auth.enabled:true` case, with the harness trap named now.** Round v27b requires
one real case proving the overlay IS visible under auth. IT-168 proves the wire; the *visible* claim
(dashed edges to unreached nodes, REQ-134; 「預測結構」 for a never-run workflow, REQ-133) is Chromium,
and VAL-199/VAL-200 boot open servers. Propose one auth-ON case under VAL-199 (the never-run predicted
layout is the cheapest: no gateway needed) with VAL-204 carrying the wire half. The trap: under auth,
`workflow_register`/`workflow_publish`/`run_start` need a minted bearer (IT-092's `mintBearer`,
`dag-masking-auth.test.ts:76-84`) while the page and `/api/*` GETs need none — a VAL author who forgets
gets a registration refusal and a vacuous or skipped case, and the ruling goes unproven exactly where
the owner asked for proof.

**S-Δ3 — No new config key ⇒ no `composeConfig` exposure.** The delta *removes* a planned dep and adds
no `FileConfig` field; the twice-bitten "correct implementation, unwired call site, every unit test
green" class has nothing to bite. Worth stating as a positive in ADR-051, because the alternative
(R-Δ2's global knob) would have reintroduced it.

**S-Δ4 — Self-healing when the derivation fails is unchanged, and now visible.** The route still
degrades to live-only (never a 500 — DES-018's contract), and after O-Δ1/O-Δ2 the degradation has a
witness on the payload and in the journal. A catalog whose pinned version was purged (REQ-026 GC) or
a script that stopped parsing after an engine update no longer produces a page that quietly looks
like a smaller workflow.

### Agent altitude

**S-Δ5 — Not applicable, and why.** No memory, tool-liveness or prompt-calibration seam is touched:
the overlay is derived from stored script text on every read (no cache to metabolize), and the
agents it names are not probed. Recorded so the section is complete rather than invented.

---

## key_points

1. **Orchestrator, first:** REQ-105's acceptance (`01-requirements.md:1070`, "stays behind the auth
   gate … v23 must not re-open it") needs a `[PARTIALLY SUPERSEDED v27, Round v27b]` marker on that
   clause — REQ-100's house style — or Gate 8 finds the top of the chain contradicting the code. Not
   in this run's gates; must not be silently skipped.
2. **Delete the `masked` axis, don't flip it:** no `McpFacadeDeps.maskPredictedOverlay`, no
   `opts.masked`; `deriveLanes(phases, expected, { status })`; the DAG route derives the overlay
   unconditionally; `predictedLanes` joins into `describe.phases[].agents` unconditionally; the
   `authEnabled` parameter of `handleDashboardRequest` (`server.ts:331-334`) and its `!!authCfg`
   argument (`:1068`) go with the branch — no stump. A fail-closed default now fails closed to the
   refused behaviour (R-Δ1).
3. **Make the only remaining absence visible:** `warnings.push('predicted overlay unavailable:
   <reason>')` for the `''`-script and `catch {}` arms (`server.ts:500-506`, `:540-541`), and the inner
   catch emits `dashboard_api_degraded {route:'dag', runId, reason}` (O-Δ1, O-Δ2).
4. **Sweep by list, in three partitions** (O-Δ4): (a) meaning changes — ADR-051, ADR-055, ARCH-126/
   130/131, logical view, scenario 2, two contract rows, housekeeping (3), DES-196/197/198,
   TASK-202/203, UT-238 (7×2), IT-168, IT-092 (case 1 + title + header), VAL-204, VAL-199/200;
   (b) supersession markers — REQ-105, ADR-012, ARCH-073, ARCH-075, DES-114, 07-review H2, and the
   comments at `server.ts:508-518`, `val-116:1-4`, `dag-masking-auth.test.ts:1-16/:113/:130-133`;
   (c) untouched and green — IT-089 / val-110 / val-111 / workflow-view.test / val-116's 404 /
   dashboard-http `:213-217` + `:140-150`; README `:312-313` stays as written (still true).
5. **One wire shape regardless of auth** — the client has one code path; `agents?` stays optional
   with "absent = could not derive, never = auth"; inert cells detected by `agentId === undefined`,
   never by the `__skel_` prefix; README/contract rows lose the masking sentence; cross-repo note is
   additive (C-Δ1..C-Δ4).
6. **Where a future policy lives, in one ADR-051 sentence:** a per-principal projection through the
   auth layer (D1 reopened), never a global `dashboard.predictedOverlay` knob (R-Δ2, S-Δ3).
7. **The guard against re-masking is a positive assertion on the auth server** (labels present, not
   "not absent"), with the file's `describe` titles renamed to state the ruling (S-Δ1).
8. **Gate 7.5 auth-ON proof:** one Chromium case under VAL-199 + the wire under VAL-204; the
   `mintBearer` trap named so the case cannot be vacuous (S-Δ2).
9. **Reconcile UT-238's `{ masked, status }` here**, not at Gate 6: the verifier's signature note
   (`dashboard-derive-lanes.test.ts:7-13`) resolves to `{ status }` by deletion.

## risks

| # | Risk | Severity | Where it lands |
|---|---|---|---|
| QD-Δ-R1 | **The dead axis survives as a parameter that defaults to masked.** DES-197's `absent ⇒ true` and DES-196's `{ masked }` were designed for a pending answer; kept after the answer, a unit-constructed facade or a forgotten forward at the one construction site silently reproduces the overruled mask with every test green — the `composeConfig` class inverted. | HIGH | ADR-051, DES-196/197/198, ARCH-126/130/131 (R-Δ1) |
| QD-Δ-R2 | **REQ-105 still says "stays behind the auth gate; v23 must not re-open it"** (`01-requirements.md:1070`). Round v27b names the v22 rows it reverses but not this REQ; Gate 8 verifies REQs against code and will read a contradiction as a defect. | HIGH | REQ-105 → orchestrator amendment (key_point 1) |
| QD-Δ-R3 | **IT-092's first case asserts `['__trigger__']` under auth** (`dag-masking-auth.test.ts:113-121`) and its row traces to REQ-100/ADR-012/DES-114 — a v22 ID. If the delta only touches IT-168's three cases, the suite is red on the flipped route, or worse, someone "fixes" it by restoring the branch. | HIGH (certainty) | IT-092, 05-tests.md v22 row (O-Δ4 a) |
| QD-Δ-R4 | **A failed derivation is now indistinguishable from a small workflow.** Two silent arms (`server.ts:500-506`, `:540-541`) produce `cells:['__trigger__'], warnings:[]` for a just-started run — the same bytes as a script with no agents. Previously "by decision", now a fault with no witness. | MID | REQ-134/140 (O-Δ1, O-Δ2) |
| QD-Δ-R5 | **"Deleted but still described."** ARCH-073's `api:` line, ARCH-075's traps, DES-114's boundary, ADR-012, REQ-105, the `server.ts:508-518` block, `val-116:1-4`, the masking test's header/titles, 07-review H2 — nine places that will state the mask after the code stops applying it. REQ-105's own last clause calls this the ledger's most-repeated defect. | MID | ledger-wide (O-Δ4 b) |
| QD-Δ-R6 | **Scope creep into REQ-100.** The same test harness and the same words ("masked", "non-owner projection") cover script-text masking, which the ruling explicitly leaves standing. A sweep by grep rather than by list touches IT-089 / val-110 / val-111 / `workflowSource`. | MID | REQ-100 (O-Δ4 c) |
| QD-Δ-R7 | **The Gate 7.5 auth-ON case is vacuous.** Under auth, registration and `run_start` need a minted bearer while the GETs do not; a VAL that forgets registers nothing, renders 「找不到」, and passes a negative assertion. | MID | VAL-199/VAL-204 (S-Δ2) |
| QD-Δ-R8 | **A global kill-switch is added "for defence in depth".** `dashboard.predictedOverlay:false` would recreate the dead axis plus a `composeConfig` obligation to protect a state the owner refused; and it is not per-principal, so it does not even buy what D1 declined. | LOW | ADR-051 (R-Δ2, S-Δ3) |
| QD-Δ-R9 | **Client keys on the `__skel_` prefix.** Couples served `.js` to a retired word's stump; `agentId === undefined` is the v11 contract and needs no string test. | LOW | DES-203/206, ui/run.js (C-Δ2) |

## expected disagreements with other lenses

- **vs. the adversarial lens (D-ADV-2 argued FOR the reversal — agreement on the headline is
  expected).** Friction I anticipate: *(a)* keeping `maskPredictedOverlay` as a global kill-switch for
  defence in depth. My answer is R-Δ2/S-Δ3: it protects nothing (the structure is anonymously public
  through four other fields), it is not per-principal (so it is not the D1 tier either), and it
  reintroduces the wiring class for a refused state. *(b)* that `__skel_*` cells under auth now carry
  slot `kind` and per-label tools to anonymous callers of any `runId` — true, and already public via
  `toolSurface` and `describe.mermaid` (`mcp-facade.ts:483-490`); ADR-054's key-set test sees no new
  top-level key because `lanes`/`current` were already planned. If they want the widening *recorded*,
  ADR-051's rewritten note is the place, and I support that.
- **vs. the architect / synthesizer — on closure discipline.** The dispatch names impactIds
  REQ-133/134/140; my sweep touches IT-092 (REQ-100 trace), the v22 ancestors, `val-116`'s comment and
  07-review H2, and asks the orchestrator to amend REQ-105. Expected pushback: "outside the closure".
  My answer: supersession *markers* are the trace chain's own consistency, not a widening — no v22
  decision is rewritten, each gets one line saying what overruled which clause; and REQ-105's clause is
  the single place where leaving it alone makes Gate 8 fail by construction. The ADR-053 precedent
  (acceptance-text amendment handed to the orchestrator) is the mechanism.
- **vs. a simplicity lens — on O-Δ1/O-Δ2.** "Two more lines for a case that never happens." The case
  happens on every purged pinned version and every parse regression, and both arms are *already*
  written as catches — the proposal adds one `push` into an existing array and one `warn` on an
  existing convention. The alternative is a page that looks like a smaller workflow, which is the
  silent failure this lens exists to forbid.
- **vs. a testability lens — on deleting `masked` from `deriveLanes`.** They may prefer the parameter
  so the 7×2×2 table can exercise both arms. A branch with no legitimate input is dead code with a
  test; the `expected: undefined` arm keeps the interesting degradation testable (UT-238's last case,
  `dashboard-derive-lanes.test.ts:64-66`) without a policy flag.
- **vs. a security lens — on the ruling itself.** Not mine to relitigate; the owner ruled with the
  consequence attached. What this lens adds is that the ruling must be *legible* three iterations
  from now: the positive auth-ON assertion with the ruling in its title (S-Δ1), the one-sentence
  "where a future policy lives" (R-Δ2), and no document left saying the opposite (O-Δ4 b).
