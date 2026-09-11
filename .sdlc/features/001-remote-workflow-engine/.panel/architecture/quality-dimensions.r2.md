---
stage: architecture
lens: quality-dimensions
iteration: v27 — Round v27b delta (scoped run: gates architecture+design+tests, impactIds REQ-133 / REQ-134 / REQ-140)
round: 2 (responses to the other lens + final position)
responds_to: .panel/architecture/adversarial.r1.md (the v27b delta proposal — K-1..K-5, F-1..F-5, D-1..D-5). .panel/architecture/adversarial.r1.sprintA.md was read for context only: its D-ADV-2 is the ancestor of this delta and nothing else in it is in this closure.
builds_on: .panel/architecture/quality-dimensions.r1.md (my delta r1 — O-Δ/R-Δ/C-Δ/S-Δ items, key_points 1–9, risks QD-Δ-R1..R9). Its Sprint A body at `git show 07266be:…quality-dimensions.r1.md` stands unchanged.
verified_this_round (file:line, all re-read at the working tree): src/server.ts :320-339, :490-552, :1060-1069, :1284-1294; src/run-manager.ts :893-907, :1075; src/types.ts :24-45, :293-298, :347-352; src/run-view.ts :11-14; src/run-store.ts :355; src/dashboard.ts :339-345, :393-442; src/dashboard-page.ts :601-607; src/skeleton-graph.ts :95-155 (lane push at :111-112); src/workflow-meta.ts :114-135, :420-560; src/workflow-view.ts :106; src/mcp-facade.ts :455-494; tests/integration/dag-masking-auth.test.ts (whole); tests/unit/dashboard-derive-lanes.test.ts (whole); tests/integration/dashboard-disclosure.test.ts :1-50; tests/fixtures/dashboard-wire.ts :71-113; tests/helpers/workflow-fixtures.ts :128-143, :286-310; tests/unit/graph-layout.test.ts :165; tests/integration/diagram-contract-grandfather.test.ts :60-160; tests/unit/no-skeleton-surface.test.ts :53-70; 01-requirements.md :1658-1690, :1744, :1769, :1868, :1070; 02-architecture.md ADR-051 :3432, ADR-054 :3453, ADR-055 :3460, ARCH-130 :3400, ARCH-131 :3414-3415, contract rows :3630-3632; 04-design.md DES-196/197 :6745-6760, DES-206 :6825; 03-tasks.md TASK-202/203 :1699-1716; 05-tests.md UT-238 :11772, IT-168 :11797, VAL-204 :12067; state.yaml pending[0]; journal.md :3571-3600
---
# Quality-dimensions — round 2: the four deletions are converged; what is left is one warning vocabulary, one fixture, and one detector I reject

## summary

**Converged, and not worth a third round.** Both r1s delete the predicate rather than flip it — the
`if (!authEnabled)` branch, the never-implemented `McpFacadeDeps.maskPredictedOverlay`, `deriveLanes`'s
`masked` axis and `handleDashboardRequest`'s `authEnabled` parameter — keep the inner `try/catch`,
keep `status` on `deriveLanes`, re-trace IT-092 instead of relaxing it, and put F-1's witness on the
existing `warnings[]` channel. The adversarial file's D-1 ("QD will keep the seam") and D-2 ("QD will
prefer `masked:false`") describe a position my r1 did not take (R-Δ1, key_point 2: *delete the axis,
don't flip it*); §0 says so once so the synthesizer does not re-litigate them.

**Where I move.** (1) F-1 is a real case I missed — the release fallback at `server.ts:502-503`
renders an overlay from a version the run did not execute — and it folds into my O-Δ1 as a third
member of one reason set, *reusing the noun the engine already has for it* (`legacySubstitution
{pinned, resolved}`, `run-manager.ts:903-907`). (2) My r1 said the client "already renders" warnings;
it renders a count (`dashboard-page.ts:606`) — conceded, the rebuilt client owes the text. (3) K-4's
sentinel form of IT-092 is the right one: it keeps the row's REQ-100 trace honest and leaves the
positive shape to IT-168. (4) K-5 measure-before-cache, with a bound on the pre-approved memo. (5) D-4's
budget rule for key-set tests.

**Where I hold or push back — all low-stakes, all with a file:line reason.** F-1's *conflict rule* is
right and its *detector* is wrong: a loop-body `phase()` produces the exact observed/expected title
mismatch the detector keys on, with no substitution anywhere (`run-manager.ts:1075` appends one
`PhaseView` per entry; L1 opens one lane per node). K-3's parity test is necessary and vacuous on its
own — both servers failing derivation identically pass it — so it needs one positive anchor, and the
anchor needs a second fixture, because `registerPublishedVia` registers IT-092's phase-less `SCRIPT`
as a single synthesized lane (`workflow-fixtures.ts:139-143`) on which no lane is ever "unreached".
REQ-105's supersession marker is still the one Gate-8-by-construction failure and nobody else has
named it.

## Altitude call

Unchanged: predominantly **system**-altitude (what an unauthenticated HTTP read serializes), with the
**agent**-altitude reading supplying the reason the owner ranked it (the run page is the only surface
that joins an agent workflow's *plan* to its *progress*). Memory metabolism, tool liveness and prompt
calibration have no seam in this delta; each dimension below says so in one line rather than padding.

---

## 0. Convergence — stated once (no dispute; the synthesizer should record these as agreed)

| # | Item | Adversarial r1 | My r1 | Verified this round |
|---|---|---|---|---|
| 1 | Delete `if (!authEnabled)`; keep the inner `try/catch` degradation | K-1 (1) | O-Δ4 (a), key_point 2 | `server.ts:520`, catch at `:540-542` |
| 2 | `McpFacadeDeps.maskPredictedOverlay` never exists | K-1 (2), K-2 | R-Δ1, QD-Δ-R1 | `grep -rn maskPredictedOverlay src tests` → 0 hits; DES-197 text only |
| 3 | `deriveLanes(phases, expected, { status })` — `masked` dropped, `status` kept, UT-238's signature note reconciled here | K-1 (3) | key_point 9 | `dashboard-derive-lanes.test.ts:7-13`, `:33-35` |
| 4 | `handleDashboardRequest`'s `authEnabled` param, the `!!authCfg` argument and the comments go | K-1 (4) | R-Δ1 | declaration `:334`, one consumer `:520`, one caller `:1068`; comment `:350` goes, comment `:819` is about ARCH-088's peer shapes and **stays**; positional deletion is type-safe because the trailing params are `authAnnounce: {…}` and `diagrams: DiagramRenderer` (`:336-338`) |
| 5 | ADR-051 amended in place → (b) with ruling + date, options analysis kept; ADR-055 amended; F-2 residual and F-5 instruction flip recorded | K-1, F-2, F-5 | O-Δ4 (a), housekeeping (3) | ADR-051 `:3432`, ADR-055 `:3460`; the HTTP describe route takes no `?version=` (`server.ts:395-412`) while the diagram route does (`:416-431`) — F-2's cohort boundary holds |
| 6 | IT-092 re-traced, never relaxed; IT-168 flips to positive; UT-238 → 7×2 | K-4 | O-Δ4 (a), QD-Δ-R3 | see §4 |
| 7 | F-3's synthetic-principal pattern noted in ARCH-131; F-4's scope boundary | F-3, F-4 | C-Δ1, O-Δ4 (c), QD-Δ-R6 | `server.ts:402`, `:563`; ARCH-131 `:3415` |
| 8 | D-1 / D-2 do not exist as disputes | predicted | R-Δ1 deletes, never flips | — |
| 9 | F-1's witness rides `warnings[]`; no new wire field | D-3 | O-Δ1 | `dashboard.ts:339-340`; `ALLOWED_DAG_KEYS` already lists `warnings` (`dashboard-wire.ts:88`) |
| 10 | D-5's list | agreed | agreed | — |

---

## 1. Observability

**The delta's question is unchanged from my r1: when the engine cannot produce the overlay — or
produces the wrong one — does anyone find out, on the payload and in the journal, and does every
document still tell the truth about when it is shown.**

### System altitude

**O-Δ1 (revised — integrates F-1): one reason set, three members, pushed at the site where each
degradation happens.** The block at `server.ts:497-508` has three exits and the derivation one more;
I enumerate all of them so the warning cannot be "inferred from an empty graph" (a legitimate script
with no `agent()` calls yields the same empty `ExpectedGraph`, and `dashboard-http.test.ts:213-217`
pins that case silent):

| Exit | Today | `warnings[]` entry |
|---|---|---|
| pin resolves (`:500`) | overlay from the run's own version | none |
| pin throws, `release` resolves (`:502-503`) — **F-1** | overlay silently from a version the run did not execute | `PREDICTED_FROM_FALLBACK_VERSION: pinned=v3 resolved=v5` |
| both throw (`:505`, `skeletonScript = ''`) | empty overlay, silent | `PREDICTED_OVERLAY_UNAVAILABLE: catalog-resolve-failed` |
| parse/derivation throws (`:540`) | empty overlay, silent | `PREDICTED_OVERLAY_UNAVAILABLE: derivation-failed` |
| `derived.ok === false` → `contract:'v1'` re-derive (`:531-538`) | a real graph | **none** — REQ-124's grandfather bar; both r1s agree |
| `spec.name` absent (inline script) | no resolve at all | none |

Four constraints, each verified rather than assumed: **(a)** no warning text may contain the retired
word — `graph-layout.test.ts:165` asserts no warning matches `/skeleton/i`; **(b)** the four
`warnings: []` pins on the grandfather cohort (`diagram-contract-grandfather.test.ts:101`, `:156`;
`dag-warnings-empty.test.ts:37`; `refused-survives-restart.test.ts:4`) are untouched, because those
runs resolve their own pin (IT-151 rewrites the version row *in place*, the pin stays valid) and the v1
arm is silent; **(c)** `warnings` is already in `ALLOWED_DAG_KEYS`, so no key-set edit (§3);
**(d)** the push happens in the `catch` arms, never by inspecting the resulting graph.

**The FALLBACK member reuses an existing noun — concede on the case, integrate on the name.** The
adversarial file coined `PREDICTED_FROM_FALLBACK_VERSION`; I keep that spelling verbatim (less churn
in synthesis) and make the *detail* mirror the engine's own record of exactly this situation:
`RunStatusView.legacySubstitution?: { pinned, resolved }` (`types.ts:347-352`), written durably by
`_requireLive` when a resume resolves through `release` (`run-manager.ts:903-907`), and already on the
wire at `/api/runs/:id` because `toPublicRunView` strips only `principal` (`run-view.ts:11-14`,
`run-store.ts:355`). Two sources means the client needs **one rule**, stated in the contract row so it
is not chosen wrong: *the DAG `warnings[]` entry is the authority for greying the overlay on this
read; `legacySubstitution` on the run view is the durable record that an* execution *resumed on a
substitute.* They do not coincide — the run-view field is set only by resume, so a never-resumed run
whose pin was purged after it started has the warning and no field.

**Correction to my r1 (concede).** I wrote that the route pushes into "the same `warnings[]` the
client already renders". The page renders `N warning(s)` as a **count** (`dashboard-page.ts:601-607`);
no warning text is rendered anywhere today. The adversarial file measured this and I did not. The
consequence is the one it drew: the rebuilt client (DES-206, `ui/run.js`) owes the legend rendering
regardless, so no plumbing is added by this delta — but the design row must say the text is rendered,
or REQ-134's legend row ships as a count again.

**Token form (D-3 — converged on the channel; only spelling is open).** `TOKEN: detail`. The client
splits on the first `: `, maps the token through the string table, and falls back to raw text for
the existing prose warnings (`lane 2 is dynamic…`, `agent x unmatched…`, `graph truncated…`,
`dashboard.ts:393-442`). The spelling is the architect's call; the *constraint* is that the detail
carries only version strings and a reason enum — never script text — so the IT-092 sentinel (§4)
guards this channel too.

**O-Δ2 (hold, narrowed).** `{event:'dashboard_api_degraded', route:'dag', runId, reason}` on the two
`PREDICTED_OVERLAY_UNAVAILABLE` arms — those are faults. **Not** on FALLBACK: it is a state, it is on
the payload every read, and its durable record is `legacySubstitution` when a resume happens. Flood
note for self-sustainability: a deregistered workflow's old run polled at 3 s by k viewers logs k
lines / 3 s until an operator acts — acceptable for a fault that needs an operator; if Gate 7.5 sees
it drown the journal, a once-per-`(runId, reason)`-per-process `Set` is pre-approved on K-5's pattern.

**F-1's conflict rule — concede the rule, rebut the detector.** *Observed phases win for any lane the
run entered; the predicted overlay fills gaps only* — that is O-Δ3 / DES-196's ordinal join restated,
agreed. *"A title conflict at the same lane index emits the warning"* — rejected, because the detector
has a producer that is not substitution. The runtime appends one `PhaseView` per `phase()` **entry**
(`run-manager.ts:1075`, `onPhase: (title) => …phases.push({ title, ts })`), while L1 opens one lane
per `phase` **node** in source order (`skeleton-graph.ts:111-112`). A legal loop-body `phase('step')`
followed by `phase('after')` gives observed `[step, step, step, after]` against expected
`[step, after]`: at ordinal 1 both titles are non-null and different, nothing was substituted, and the
detector greys a correct overlay. When substitution *is* the cause, the FALLBACK entry already fired at
the resolve site. This is the adversarial lens's own Karpathy tie-break applied to its own proposal:
the rule stays, the detector is dead machinery. UT-238 gains the row that proves the rule instead
(§4): observed longer than expected → `lanes` is the observed list, no extra output. (The lane-count
overflow itself is already witnessed by `layoutGraph`'s `lane N is beyond the predicted layout:
appended`, `dashboard.ts:434`.)

**O-Δ4 sweep (hold; two additions from this round's reading).** Everything in my r1's three
partitions stands. Add to partition (b): `tests/fixtures/dashboard-wire.ts:112`'s row label
`GET /api/runs/:id/dag (open)` and its constant `DAG_PAYLOAD_OPEN` (`:84`) — "(open)" is a stale
qualifier once the payload is auth-invariant; drop it (one identifier, no allowed-set change). And
the adversarial appendix's list is a strict subset of mine — REQ-105, ADR-012, ARCH-073, ARCH-075,
DES-114, 07-review H2, `val-116:1-4` and the `server.ts:508-518` block are still only in my list;
partition (c) (untouched and green: IT-089, val-110, val-111, `workflow-view.test.ts:119`, val-116's
404, `dashboard-http.test.ts:140-150` and `:213-217`, README `:312-313`) is the delta's outer wall.

### Agent altitude

**O-Δ5 stands.** The overlay is the only surface where "this agent has not been dispatched yet" is
distinguishable from "this agent does not exist", and after this delta it is also the surface where
"the plan shown is not the plan that ran" is distinguishable from either — the FALLBACK entry is the
agent-altitude honesty clause. Chain-of-thought, token and tool-call inspection are REQ-135/140/141
and untouched here.

---

## 2. Replaceability

**The delta removes a seam. Both lenses agree it is removed rather than parked; the remaining work is
to say where the next policy lives and to keep the derivation single.**

### System altitude

**D-1 / D-2 — non-disputes.** My r1 deletes the axis (R-Δ1) and refuses `masked: false` in code for
the adversarial file's own reason ("a decision nobody can find and everybody can flip"). The one
sentence I keep asking for goes in ADR-051's amended note, not in code: *a future withholding policy
would be a principal-aware projection through the auth layer (D1 reopened), never a global
`dashboard.predictedOverlay` knob* (R-Δ2). The adversarial D-1 pre-argument says the same thing from
the other side — a principal-aware seam is a different dep with different plumbing — so this is one
sentence, jointly held.

**R-Δ1 (hold, verified).** Deleting the positional `authEnabled` is type-safe (§0 row 4) and the v23
one-dispatch rule guarantees exactly one call site (`server.ts:1064-1069`). `authAnnounce` stays:
`/api/system`'s `auth` key (ARCH-090) is how an operator learns auth is on — that is a different fact
from "what the DAG discloses" and must not be deleted by sympathy.

**R-Δ3 (hold).** `expected: ExpectedGraph | undefined` stays on `deriveLanes` because *derivation can
fail*, not because a server may withhold it; DES-196's signature sentence (`server.ts:519-520
populates it only if (!authEnabled)`) is the one that must be rewritten, or the next reader restores
the auth reading from the type alone. INV-V26-3 / INV-V27-4 (one shape derivation, three consumers)
is untouched.

**K-5 — concede measure-before-cache, with two riders.** No memo now; Gate 7.5 records one p95 for
`GET /api/runs/:id/dag`, auth on, the largest corpus script; the 50 ms threshold and the
`${name}@${version}` key are fine (a registered version's script is immutable). Rider 1 (bound): on a
long-lived engine the key space grows with every registration and shrinks only on REQ-026 GC, so the
*pre-approval* must carry a bound — LRU 64, or evict on catalog GC — otherwise a five-line memo is
pre-approved as an unbounded map. Rider 2 (instrument): the p95 is a VAL-side wall-clock loop (200
sequential GETs against the real box), not a product-side timing seam; one number does not buy a
metrics subsystem, and the journal line in O-Δ2 already covers the failure path.

### Agent altitude

**R-Δ4 stands.** Provider, transport and model seams do not move; the overlay is script-derived and
provider-agnostic. Recorded so the section is honest rather than padded.

---

## 3. Consumability

**Two consumers, one wire shape regardless of auth. Both r1s agree; what this round adds is the exact
sentence for each contract row and the one client rule for the new warnings.**

### System altitude

**C-Δ1 / C-Δ2 (hold, one refinement).** The client never learns whether auth is on (the synthetic
`{kind:'auth-disabled'}` principal at `server.ts:402` and `:563` is unchanged — F-3 agreed). The
client detects an inert predicted cell by `agentId === undefined` (`dashboard.ts:330-331`), never by
the `__skel_` id prefix. Refinement: the engine's own *tests* may key on that prefix (IT-092, IT-168,
the parity case do, and the open-server case measures 3 of them today) — that is the wire id asserted
where it is produced, not the client coupling C-Δ2 forbids.

**C-Δ3 — the contract rows, final wording.** `GET /api/runs/:id/dag` (`:3630`): *gains `lanes` (the
observed phases extended by every unreached expected lane — regardless of auth, Round v27b) and
`current`; `warnings[]` may carry `PREDICTED_OVERLAY_UNAVAILABLE: <reason>` (lanes observed-only) or
`PREDICTED_FROM_FALLBACK_VERSION: pinned=… resolved=…` (overlay derived from a substitute version — the
client greys it); the DAG warning is the authority for this read, `legacySubstitution` on the run view
is the execution record.* `describe` (`:3632`): *`phases[].agents?` — the predicted lane membership,
served to every caller regardless of auth; absent only when the engine could not derive the predicted
layout for this version.* README §Dashboard JSON REST API gains the describe row **without** the
masking sentence TASK-202's `dod:` (`03-tasks.md:1704`) currently asks for.

**D-4 — concede the budget rule; two measured notes and one hold.** *A key-set test is owed by the
endpoint whose key set this delta changes* — agreed. Note 1: IT-165 (`dashboard-disclosure.test.ts:
35-44`) asserts `keys ⊆ ALLOWED` and `REQUIRED ⊆ keys` **against the fixture table itself**,
top-level only; `warnings` is already allowed (`dashboard-wire.ts:88`), so O-Δ1 costs nothing there.
Note 2: there is **no describe row** in `DISCLOSURE_TABLE` at all (`:108-113`), so "extend the key-set
test to `describe.phases[]`" is a *new nested row*, not an extension. Hold (defer, low stakes): the
nested `phases[]` shape is pinned positively by IT-168's labels and by val-111; a nested key-set is a
fixture-shape change outside this delta's impactIds and belongs to the Sprint A closure's own Gate 6.

**C-Δ4 / C-Δ5 (hold).** `phases[].agents` is additive for every MCP caller — one release-note line;
README `:325-330`'s stale D-BIND sentence is seen and out of closure.

### Agent altitude

A cold model calling `workflow_describe` gets one shape on every deployment and can draw the
predicted layout from `phases[].agents` without parsing `mermaid`; that is the reuse REQ-133's data
buys beyond the page.

---

## 4. Self-sustainability

**Will the ruling still be in force three iterations from now, with nobody watching — and will the
tests that guard it be able to fail?**

### System altitude

**S-Δ1 + K-3 — integrate: parity is the invariance guard, and it needs a positive anchor.** The
parity test (structural fields equal across the two servers the harness already boots,
`dag-masking-auth.test.ts:46-64`) is strictly stronger than the mask assertion it replaces, and I
accept `cells[].id` rather than `.label` (the trigger label follows `startedByType`, `server.ts:544`).
But parity is **vacuous when both servers degrade identically**: both `derivation-failed` → both
`['__trigger__']`, both lanes observed-only, both `warnings` equal → green, and the ruling is unproven.
So: parity over `{ set(cells[].id), edges, lanes, current, warnings, describe.phases[].agents }` —
**add `warnings` to the set**, a divergent degradation is exactly what parity should catch — *plus*
one positive anchor on the **auth** server, asserting the labels.

**The anchor needs a second fixture (new, verified).** `registerPublishedVia` wraps every script in
`synthesizePhase` (`workflow-fixtures.ts:302`), which prepends `phase('main')` to a phase-less
script and leaves a phased one unchanged (`:139-143`). IT-092's `SCRIPT` therefore registers as **one
lane** `main` with three slots: fine for `phases[].agents` (`[{title:'main', agents:[do-skel-1..3]}]`)
and for the `__skel_*` count, but no lane is ever *unreached* on it, so the DES-196 join — the clause
REQ-134's dashed edges to unreached nodes actually depends on — cannot be anchored there. Add one
constant: `SCRIPT_PHASED` = `phase('one'); await agent('p-1',{}); phase('two'); await agent('p-2',{});
phase('three'); await agent('p-3',{});`. Under the never-resolving gateway the run sits in `one`, so
on the auth server: `lanes.map(l => l.title)` deep-equals `['one','two','three']` and
`describe.phases[].agents` is `[['p-1'],['p-2'],['p-3']]` — these two are timing-independent (every
lane is an expected lane whether entered or not, and `describe` involves no run). **`current` is
not:** the harness reads the DAG immediately after `run_start` (the open case measures 3 `__skel_*`
+ trigger, i.e. no live record yet), and whether `phase('one')` has fired `onPhase` at that instant
is unverified — observed `[]` gives `current: null`, observed `[one]` gives `0`. Assert
`current ∈ {null, 0}`, or poll `/api/runs/:id` until `phases.length ≥ 1` before asserting `0`; the
full `current` table is UT-238's job, not this anchor's. Registration is safe: `synthesizeMermaid`
tries `synthesizeLrSwimlane(script)` first (the per-phase form the v2 checker wants); if the verifier
finds it refused, pass `opts.mermaid` explicitly the way IT-151 does
(`diagram-contract-grandfather.test.ts:66`). The harness registers per case by name — cost is one
constant.

**Red versus guard — label them, or Gate 5 records a false red.** The **red** tests of this delta are
IT-168's flipped cases and the parity case: red today because `deriveLanes` is not exported,
`phases[].agents` is not projected, and — on `cells` alone — the auth server answers 1 id where the
open server answers 4 (the branch at `:520`). The IT-092 **sentinel** is green before and after: it is
a REQ-100 *guard* riding along, not the delta's red test, and its row must say so. House precedent for
the technique: `dashboard-disclosure.test.ts:50`'s `MARKER = 'RWE-V27-SYSTEMPROMPT-MARKER-DO-NOT-LEAK'`.

**K-4 — concede the sentinel, with the precision that makes it not a false pass.** IT-092 traces to
REQ-100 (script text); rewriting it to assert *no script bytes on the DAG payload* keeps that trace
honest, whereas my r1's flip-to-positive would have made it a duplicate of IT-168 with a mixed trace.
What the derivation can surface, verified at `workflow-meta.ts:420-560`: `scanAgentCalls` yields
literal labels matching `/^[A-Za-z_][\w-]*$/` and `allowedTools` arrays; `parseWorkflowSkeleton`
yields `phase()` titles and `workflow()` names when the whole first argument is a string literal.
A line `const IT092_SENTINEL = 'never-leaves-the-engine';` matches neither `CALL_RE` nor
`AGENT_CALL_RE`, and the payload's other string carriers — `cells[].label`, `lanes[].title`,
`warnings[]` (an enum plus version strings) — cannot carry it either. Assert on `await res.text()`,
not on parsed fields, so a future field cannot smuggle it past a key-set.

**S-Δ2 (hold; F-5 agrees).** One Chromium case under VAL-199 with `auth.enabled:true` (the never-run
predicted layout — no gateway needed) and the wire half under VAL-204; the `mintBearer` trap
(`dag-masking-auth.test.ts:76-84`: registration and `run_start` need the bearer, the page and `/api/*`
GETs need none) named in the VAL row so the case cannot pass vacuously on 「找不到」.

**S-Δ3 / S-Δ4 (hold).** No new config key, so nothing for the twice-bitten `composeConfig` class to
bite — worth one positive sentence in ADR-051. Self-healing on derivation failure is unchanged
(never a 500) and now has a three-member witness on the payload and a journal line on the two fault
arms.

**UT-238 after this round: 7 × 2 plus four join rows.** (i) unreached expected lanes extend the
observed list (index 2 `three`); (ii) `expected: undefined` → observed-only, never throws — the
derivation-failure arm; (iii) **new** — observed longer than expected (the loop-body case) → `lanes`
is the observed list, length = observed length, no conflict output — the row that pins the rule and
retires the detector; (iv) `status` over all seven members, unchanged.

### Agent altitude

**S-Δ5 stands.** No memory to metabolize (the overlay is derived from stored script text on every
read — until and unless K-5's bounded memo is triggered by a number), no tool probed, no prompt
calibrated.

---

## Final position (key_points)

1. **Orchestrator, first (hold — nobody else has named it):** REQ-105's acceptance
   (`01-requirements.md:1070`, "stays behind the auth gate … v23 must not re-open it") needs
   `[PARTIALLY SUPERSEDED v27, Round v27b]` on that clause, REQ-100's house style (`:976-993`). Gate 8
   verifies REQs against code; this is the one contradiction the delta cannot fix inside its gates.
2. **Four deletions, converged (§0):** branch, dep, `masked`, `authEnabled` parameter + `!!authCfg`
   argument + the `:331-334`/`:350`/`:1064` comments; inner `try/catch` kept; `status` kept.
3. **One warning vocabulary, three members, pushed at the site:** `PREDICTED_FROM_FALLBACK_VERSION:
   pinned=… resolved=…` (`:502-503`), `PREDICTED_OVERLAY_UNAVAILABLE: catalog-resolve-failed` (`:505`),
   `PREDICTED_OVERLAY_UNAVAILABLE: derivation-failed` (`:540`); the v1 re-derive and the inline-script
   path stay silent; no "skeleton" in any text; the grandfather `warnings: []` pins untouched.
4. **One client rule:** the DAG warning is the authority for greying this read's overlay;
   `legacySubstitution` on the run view is the execution record. Token → string table; unknown token →
   raw text. The rebuilt client renders the text (today: a count).
5. **Journal line** `dashboard_api_degraded {route:'dag', runId, reason}` on the two UNAVAILABLE arms
   only; once-per-`(runId, reason)` dedupe pre-approved if Gate 7.5 sees a flood.
6. **Conflict rule yes, detector no** (loop-body `phase()` is a non-substitution producer); UT-238
   gains the row that pins the rule.
7. **Tests:** parity over `{cells[].id set, edges, lanes, current, warnings, phases[].agents}` +
   one positive anchor on the auth server; `SCRIPT_PHASED` as the second fixture; IT-168 + parity
   labelled red, the IT-092 sentinel labelled guard under REQ-100 and asserted on `res.text()`.
8. **Key-set budget:** only what this delta widens; `warnings` is already allowed; a nested describe
   row is deferred to the Sprint A closure.
9. **K-5:** measure at Gate 7.5 (VAL-side wall clock); the pre-approved memo carries a bound.
10. **Sweep:** my r1's three partitions + `dashboard-wire.ts:84/:112`'s "(open)"; partition (c) is
    the wall against creep into REQ-100.
11. **Gate 7.5:** one Chromium auth-ON case + the `mintBearer` trap named; ADR-051's instruction
    flips from "record what degrades" to "prove it is visible" (F-5).

## Remaining disagreements (all low; none needs a third round)

| # | With | Mine | Theirs | Tie-break I propose |
|---|---|---|---|---|
| RD-1 | adversarial D-3 | `TOKEN: detail`, token mapped by the client | `PREDICTED_FROM_FALLBACK_VERSION` as a bare code | Channel and semantics are agreed; spelling is the architect's call. Constraint that is not negotiable: detail carries an enum + version strings only. |
| RD-2 | adversarial F-1 (second half) | the title-conflict detector is rejected | "a title conflict at the same lane index emits the warning" | If the adversarial lens holds, the burden is a producer of a non-null title mismatch that is neither substitution (already witnessed) nor a loop-body `phase()` (`run-manager.ts:1075` vs `skeleton-graph.ts:111-112`). I found none. |
| RD-3 | adversarial K-3 (supporting control 1) | nested `describe.phases[]` key-set row deferred | "ADR-054's golden key-set test extends to … `describe.phases[]`" | There is no describe row in `DISCLOSURE_TABLE` today (`dashboard-wire.ts:108-113`); IT-168's labels + val-111 pin the nested shape positively; a fixture-shape change is Sprint A Gate 6 work, not a v27b item. |
| RD-4 | (unstated by the other lens) | no journal line on the FALLBACK arm | — | A state on every read, durably recorded by resume; the two fault arms log. Trivial either way. |

## Ledger edits — delta over the adversarial appendix §5 (only rows where I add to or differ from it)

| Item | Adversarial §5 says | Add / differ |
|---|---|---|
| ARCH-130 | `warnings` gains `PREDICTED_FROM_FALLBACK_VERSION` | + the two `PREDICTED_OVERLAY_UNAVAILABLE` members; pushed in the catch arms at `:502-503` / `:505` / `:540`; (4) gains `route:'dag'` on the two UNAVAILABLE arms |
| ARCH-126 / DES-196 | `deriveLanes(phases, expected, { status })` | + boundary: observed wins, predicted fills gaps, **no** conflict output; `expected \| undefined` means derivation can fail (rewrite the `server.ts:519-520` sentence) |
| DES-197 | `maskPredictedOverlay` never exists | + `tests:` — open and auth servers assert the SAME positive shape; `phases[].agents` absent only on derivation failure |
| DES-198 | signatures follow | + (4) the three pushes and the narrowed log line |
| DES-206 / `ui/run.js` | — | token → string table; UNAVAILABLE → 「預測結構不可用」, FALLBACK → greyed overlay + 「預測結構來自替代版本 vN」; the DAG warning is the authority, not `legacySubstitution`; text rendered, not a count |
| UT-238 | `masked` cases dropped | + join row (iii): observed longer than expected → `lanes` = observed |
| IT-168 / IT-092 file | re-trace + flip + one parity case | + `warnings` in the parity set; + `SCRIPT_PHASED`; + positive anchor on the auth server; red-vs-guard labels; sentinel via `res.text()`; `describe` titles state the ruling |
| contract rows `:3630` / `:3632` | — | the C-Δ3 sentences above; "regardless of auth"; "absent only on derivation failure" |
| `dashboard-wire.ts:84/:112` | — | drop "(open)" from `DAG_PAYLOAD_OPEN` / the row label |
| ADR-051 | amend → (b) + F-2 + F-5 | + R-Δ2's one sentence (where a future policy lives) + S-Δ3's "no new config key" positive |
| REQ-105 | — | orchestrator: `[PARTIALLY SUPERSEDED v27, Round v27b]` on the auth-gate clause only |
| VAL-199 / VAL-204 | Gate 7.5 instruction flip | + one Chromium auth-ON case (never-run predicted layout) with the `mintBearer` trap named |
| K-5 memo | pre-approved if p95 > 50 ms | + bounded (LRU 64 or evict on catalog GC); instrument is VAL-side, no product timing seam |
| TASK-202 / TASK-203 `dod:` | scope lines follow | TASK-202: README describe row **without** a masking sentence; TASK-203: forced degrade on the DAG route produces the warning + the log line |
