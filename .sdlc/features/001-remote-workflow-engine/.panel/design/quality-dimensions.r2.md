---
stage: design
lens: quality-dimensions
iteration: v27 — Round v27b delta (scoped run: gates architecture+design+tests, impactIds REQ-133 / REQ-134 / REQ-140)
round: 2 (responses to the adversarial design r1 + final position)
responds_to: .panel/design/adversarial.r1.md (A-1..A-6, B-1..B-5, C-1..C-6, §2d, §6)
builds_on: .panel/design/quality-dimensions.r1.md (O-1..O-8, R-1..R-6, C-1..C-7, S-1..S-7, §5 order, risks QD-Δ-D1..D11). The architecture is settled (.panel/architecture/{quality-dimensions,adversarial}.r2.md) and is CITED, not reopened.
verified_this_round (file:line, all re-read at the working tree, HEAD 07266be): src/server.ts :325-338 (params; `authEnabled = false` :334), :488-552 (resolve chain :497-508 — inner catch assigns `skeletonScript = ''` at :504-506 and FALLS THROUGH; `expectedGraph` initialised `{lanes:[],slots:[],edges:[]}` unconditionally at :519; `if (!authEnabled)` :520; ternary :538; catch :540-542; payload :546-551), :1068 (the one call site); src/dashboard.ts :237-252 (`LayoutCell` — `label?` :243 has no doc comment; the :247-250 comment is on `tokens`/`costUSD`), :331 (inert cell "no agentId/state"), :339-345, :393-397, :425 (`placeCell(lane.index, { id: `__skel_${s.index}__`, kind: 'agent', laneSpan: 1 })` — NO label); src/dashboard-page.ts :581 (`c.label||c.kind||''`), :601-607; src/skeleton-graph.ts :25-45 (`ExpectedSlot.labels: string[]`), :149-155, :164 (a parallel group pushes EVERY label into ONE slot), :175; src/run-guard.ts :197-208 (`nextAgentId` → `agent-${n}`); src/agent-executor.ts :248-262 (`markQueued` → `queued`, `markRunning` → `running`); src/run-manager.ts :893-909, :1075; src/workflow-view.ts :26/:51/:109 (`owner: string | null`), :193 (`phases` from registered metadata); src/mcp-facade.ts :590; tests/integration/dag-masking-auth.test.ts :1-140 (never-resolving gateway :28-31, `SCRIPT` :33-38, harness :46-64, `mintBearer` :76-84); tests/integration/dashboard-disclosure.test.ts :35-44 (key-set row asserted "against the fixture itself"); tests/fixtures/dashboard-wire.ts :1-13, :73-90 (`DagPayloadFixture` is a LOCAL interface; `DAG_PAYLOAD_OPEN` :84; row label :112); tests/unit/dashboard-derive-lanes.test.ts :1-70; tests/unit/dashboard-metrics.test.ts :14-49 (UT-239: `predictedLanes` yields `bySlotLane.get(lane.index) ?? []`); tests/unit/layout-graph-phase.test.ts :102-109; tests/integration/dashboard-http.test.ts :200-218; tests/integration/diagram-contract-grandfather.test.ts :96-101, :149-153; `grep -rn "__skel_" tests/` → 13 hits, 0 assert `label`; `grep -rn laneSpan tests/` → typeof/literal assertions only, no deep-equal on a predicted cell; 01-requirements.md REQ-134 :1748-1771 (queued/pending = dashed border, opacity .65, hollow dot :1763; owner ruling :1769-1770); 02-architecture.md ARCH-125 :3359-3369 (v27b amendment puts the split/map in `ui/run.js`), ARCH-126 :3370-3378, ARCH-130 :3407-3416, ARCH-131 :3417-3426, ADR-055 :3470-3477; 03-tasks.md TASK-206 :1735-1743 (string table key `predictedLayout`), TASK-209 :1762-1770 (dod still says "when the overlay is masked"), TASK-210 :1771-1779; 05-tests.md IT-169 :11812-11823, UT-244 :11887-11896
---
# Quality-dimensions — v27b DESIGN r2: converged on the adversarial's three load-bearing corrections; three of my own r1 claims retracted at file:line; what is left is two refinements and one stale DoD clause nobody had named

## summary

**Converged, and not worth a third round.** The adversarial r1's three load-bearing items are all correct
on the source and I take them whole: **(1)** the disclosure key-set control is fixture-only
(`dashboard-disclosure.test.ts:36` — "against the fixture itself") and IT-168 must feed both LIVE DAG
payloads through the same `ALLOWED/REQUIRED` check (their C-1); **(2)** the predicted cell has no
`label` (`dashboard.ts:425`) and the legacy painter renders the literal word `agent` for it
(`dashboard-page.ts:581`) — after the reversal that is every unreached node on the deployment the owner
runs, so the cell gains a `label` (their A-4, with one refinement in §1); **(3)** the token→text mapping
belongs in `lib/strings.js` as a pure `warningText(lang, raw)`, not in `ui/run.js` where ADR-049 leaves
no unit tier (their C-3 — the same thing my O-1 proposed, now with their argument order).

**Where I retract my own r1, explicitly (§0):** `expected: ExpectedGraph | undefined` — the route
initialises the empty object unconditionally at `server.ts:519` and the `:540` catch leaves it, so
`undefined` cannot arrive post-reversal; "a live `AgentRecord` carries a random agentId" — it is
`agent-${n}` (`run-guard.ts:208`), which makes their stabilization predicate strictly better than my
precondition; O-7's FALLBACK greying — REQ-134 already paints predicted/pending cells dashed at .65, so
it was a no-op; and the `dagWarning()` formatter — conceded, the fixture literal plus an exact-equality
assertion is the lock, not a function.

**Where I hold (all unopposed, all with a reason):** the reused-pin blind spot and the pin-HIGH FALLBACK
recipe (S-4 — now `requested=v2 resolved=v1`); the cohort transition (C-2 — consistent with their B-3);
`SCRIPT_PHASED` for a LANE anchor beside their CELL anchor, because REQ-134's ruling text names the
unreached-lane join, not the cell; and one const for the `PREDICTED_OVERLAY_UNAVAILABLE` token in
`server.ts` itself, because arm (iv) has no producer and its spelling is vouched for only if it shares
the reachable arm's identifier.

**New this round, named by neither r1:** TASK-209's `dod:` still says 「(or lanes-only plus 「尚無執行」
when the overlay is masked)」 (`03-tasks.md:1768`) — a mask sentence in a DoD is the same class of stump
as the `server.ts` comments both lenses listed for deletion. And A-4's `labels[0]` under-reports a
`parallel` slot (`skeleton-graph.ts:164` pushes every label of the group into ONE slot; `layoutGraph`
emits one cell per slot) — `labels.join(' / ')` is honest with no branch.

**Their §6 predictions of me that did not happen — record as unanimous, not resolved:** structured
`{token, params}` warning objects; a nested key-set row for `describe.phases[]` now; building the
dedupe `Set`; a surviving `masked` knob; a new `lib/warnings.js`. My r1 proposed none of them.

## Altitude call

Unchanged from r1: predominantly **system**-altitude (what an anonymous `GET /api/runs/:id/dag` and a
`workflow_describe` serialize), with the **agent**-altitude reading supplying the reason the owner
ranked it (the run page is the only surface that joins an agent workflow's *plan* to its *progress*,
and after this delta the surface where "the plan shown is not the plan that ran" is stated). Memory
metabolism, tool liveness and prompt calibration have no seam in this closure; each dimension says so
in one line.

---

## 0. Corrections to my own r1 — stated before anything else

| # | r1 claim | Verified this round | Correction |
|---|---|---|---|
| X-1 | **R-2:** `expected: ExpectedGraph \| undefined` stays; "`undefined` means the derivation failed" | `server.ts:519` — `let expectedGraph: ExpectedGraph = { lanes: [], slots: [], edges: [] }` before any branch; the `:540-542` catch does not reassign it | **Retracted.** `undefined` cannot arrive from production. Their A-1: non-optional TYPE, garbage-tolerant BODY (`Array.isArray(expected?.lanes)`, matching `layoutGraph` at `:345`). UT-238's `undefined` case survives only behind `@ts-expect-error`. DES-196's `:519-520` sentence is rewritten to what ARCH-126's v27b note already says: EMPTY, for exactly one reason. |
| X-2 | **S-1:** "a live `AgentRecord` carries a runtime `agentId`… a random string", hence the precondition `cells.every(c => c.agentId === undefined)` | `run-guard.ts:197-208` — `nextAgentId()` returns `agent-${this._agentsIssued}`; deterministic per run | **Retracted.** Live cells are parity-comparable (`agent-1`, its label, its state). Their C-2 predicate — poll until ≥1 predicted cell AND exactly one live agent cell in `running` — is the never-resolving gateway's steady state (`markQueued` → `markRunning`, `agent-executor.ts:248-262`, then the promise never settles); my precondition was a transient the GET may already have missed. Consequence: `current` is `0` after the predicate holds, not `∈ {null, 0}` (C-5 tightened). |
| X-3 | **O-7:** a FALLBACK entry ALSO greys the predicted cells | REQ-134 `:1763` — queued/pending are ALREADY dashed border, opacity .65, hollow dot; a predicted cell has no `state` (`dashboard.ts:331`), and the rebuilt painter TAKES the pending style for it — the rule DES-206 now states (§5), not one REQ-134 already implies — regardless of any warning | **Withdrawn.** The legend text is the only FALLBACK marker; no extra class, no extra decision in `ui/`. This also removes the reason to export `parseDagWarning` separately — one export, `warningText`, is enough (their C-3). |
| X-4 | **O-1:** `dagWarning(token, detail)` formatter in `dashboard.ts`; route spells no token | — | **Conceded** as machinery. The lock is the fixture literal + IT-169's exact-bytes assertion on the filtered token entries of the two reachable producers (the recipe's versions are known: `requested=v2 resolved=v1`; `reason=catalog-resolve-failed`). What I keep is ONE identifier for the UNAVAILABLE token in `server.ts` (§2.1 O-2'), for the arm no test can reach. |
| X-5 | **O-1:** the three example strings live INSIDE `DAG_PAYLOAD.warnings` | — | **Refined.** A payload literal that carries two mutually exclusive arms at once pins a shape no route can serve. `DAG_PAYLOAD.warnings` stays `[]` (the healthy shape); the vocabulary is its own export `DAG_WARNING_EXAMPLES` in the same file. `DAG_WARNING_TOKENS` is dropped — the examples ARE the tokens. |

---

## 1. Rebut / concede / hold — one row per adversarial item

| # | Their item | Verdict | Engineering reason (file:line) |
|---|---|---|---|
| A-1 | `expected` non-optional; garbage-tolerant body | **Concede** | X-1. |
| A-2 | DES-196's seven-member `current` table stands; ARCH-126's `status === 'running'` clause is corrected one altitude up | **Agree** | Same as my R-2's second half; the correction is routed in §4. |
| A-3 | `lanes` DENSE and ordered, `lanes[k].index === k`; `current ∈ null ∪ [0, lanes.length)`; non-contiguous `expected.lanes` re-indexed on append | **Concede** | `layoutGraph` lays out `col = lane.index + 1` (`:363`) and the client joins by ordinal; a hole makes position and `index` disagree. Nothing produces one (L1 pushes `index: lanes.length`, `skeleton-graph.ts:112/:133`) — defensive, one UT row, cheapest in the delta. |
| A-4 | the predicted cell gains `label` from `ExpectedSlot.labels[0]` | **Concede from consumability, with one refinement and one correction** | Consumability reaches it first: a wire consumer that receives `{id:'__skel_2__', kind:'agent'}` learns nothing, and the run view's fetch set is `/dag` only. Disclosure is unchanged — ADR-055 already serves the same labels as `describe.phases[].agents` to every caller. **Refinement:** `label: s.labels.join(' / ')` when `s.labels.length > 0`, else absent — `skeleton-graph.ts:164` pushes every label of a `parallel([...])` group into ONE slot and `layoutGraph:425` emits ONE cell per slot, so `labels[0]` would show one name for a three-agent parallel; `join` is the identity for `single` and needs no branch on `kind`. **Correction:** the "fifth site" is not at `dashboard.ts:250` — that comment (`:247-250`) is on `tokens`/`costUSD` and stays true; `label?` (`:243`) has no doc comment to amend. The `:331` comment ("no agentId/state") also stays true. Blast radius re-checked: 13 `__skel_` hits, 0 assert `label`; no `laneSpan` deep-equal on a predicted cell anywhere in `tests/`. |
| A-5 | `__skel_` stays on the wire; one sentence says why | **Agree** | Never rendered, not the forbidden word, pinned by three test files; the client keys on `agentId === undefined` (my C-4, their arch r2 item 10). |
| A-6 | `pinned=` → `requested=`; uniform `k=v` grammar with keys `{requested, resolved, reason}` | **Concede** | When a substitution exists, (i) asks for `legacySubstitution.resolved`, so `pinned=` would carry the substitute — the lie the string exists to prevent. And one grammar means one parser: UNAVAILABLE becomes `reason=<enum>` rather than my bare token. Final grammar in §2.1. |
| B-1 | the four deletions verified; the `:331-334`/`:1064` comments are part of the deletion | **Agree** | My R-4 / W-4, same lines. |
| B-2 | the pushes happen INSIDE the catches — the inner catch assigns `skeletonScript = ''` and falls through (`:504-506`), so nothing downstream throws | **Concede — load-bearing** | Verified at `:497-508`. My R-3 ("a `??` inside an expression that already exists, no helper") still stands for the RESOLVE; their table stands for the PUSH sites. An implementer who pushes after `layoutGraph` pushes nothing, forever, green. Adopted verbatim into DES-198 with `requested=` (§2.1 O-2'). |
| B-3 | `dashboard_api_degraded.reason` is a closed kebab set `{catalog-resolve-failed, derivation-failed, internal}`; free text rides `detail`; FALLBACK is not logged | **Concede** | My O-5 constrained only the two UNAVAILABLE arms (`reason` = the warning's detail verbatim); their `internal` covers the two generic catches (`:582-585`, `:1067-1071`) I left unnamed. One operator `grep`, one vocabulary. |
| B-4 | `describe.phases[].agents`: join by ordinal against `full.phases`; absent = could not derive; `[]` = derivable but no static labels; derived lanes beyond `phases.length` dropped | **Concede, with a precision** | `workflow-view.ts:193` builds `phases` from registered metadata; `predictedLanes` re-derives from the script. The `[]`/absent split needs NO special-casing: UT-239 (`dashboard-metrics.test.ts:41-47`) already pins `predictedLanes` to yield `bySlotLane.get(lane.index) ?? []` — a dynamic lane contributes no static slot (`skeleton-graph.ts:149-155`) and naturally yields `[]`. Absent is the only shape the facade must PRODUCE deliberately (derivation failed / no derived lane at that ordinal). The consumer is TASK-209's `ui/workflow.js` (§2.3 C-3'). |
| B-5 | `current` may legally exceed the predicted lane count; say so or it gets clamped | **Agree** | My S-3 row (iii) is the same case (`run-manager.ts:1075` vs `skeleton-graph.ts:111-112`); the DES-196 sentence now names `current` explicitly, not only `lanes`. |
| C-1 | feed both LIVE DAG payloads through `keys ⊆ ALLOWED_DAG_KEYS && REQUIRED_DAG_KEYS ⊆ keys` in IT-168 | **Concede and integrate** | `dashboard-disclosure.test.ts:36-44` is fixture-only; `DagPayloadFixture` is a local interface (`dashboard-wire.ts:73-84`), so `tsc` sees no server-side addition. My S-1 parity's exclusion list was already written against the fixture tuple; C-1 is the missing half. If only one of {C-1, a nested key-set row} lands, C-1 — I agree with their ranking. |
| C-2 (1) | stabilization predicate: poll until ≥1 predicted cell ∧ exactly one live agent cell in `running`; then compare | **Concede** | X-2. |
| C-2 (2) | `PARITY_EXCLUDED = ['runId', 'terminalAt'] as const`, with the note that `runId` is not a DAG key today | **Agree** | My W-6/S-1 said the same; a named constant is where the disclosure decision lives. |
| C-2 (3) | describe parity scoped to `phases` exactly, never the whole payload | **Concede** | `workflow-view.ts:26/:109` — `owner: string \| null` legitimately differs by deployment (the registering principal vs none). A whole-payload compare fails on the first run and gets "fixed" by widening the shared exclusion list, which weakens the DAG half. My S-1 did not say which; theirs is right. |
| C-3 | `warningText(lang, raw)` pure in `lib/strings.js`; `ui/run.js` calls it and nothing else; four UT cases | **Concede the argument order and the single export** | Matches `t(lang, key)`'s order in the same module. With X-3, no separate parser export is needed. Keys converged on TASK-206's existing naming: `predictedLayout` (exists), `predictedLayoutUnavailable`, `predictedLayoutFromFallback` (takes `resolved`), plus my `laneUntitled`. |
| C-4 | UT-238 visibly non-relaxing: 14 cases intact, the cast disappears, the `undefined` case behind `@ts-expect-error`, plus A-3's density row | **Agree** | My S-3, with X-1 applied. |
| C-5 | IT-092's sentinel is a COMMENT in the fixture script, asserted absent on `res.text()`; filename kept, header rewritten | **Concede the comment form** | My const-string form works, but a label-based sentinel would be a false red the day A-4 lands, and a comment cannot legitimately reach any projection. Same file, same `res.text()`, same REQ-100 re-trace (my S-2). |
| C-6 | `DAG_PAYLOAD_OPEN` → `DAG_PAYLOAD`; row label without "(open)" | **Agree** | My O-6, same two identifiers. |
| §2d | `superseded_in_part` markers on DES-114 / DES-115 | **Agree** | Housekeeping in the house style; marker, not rewrite. |
| §4 | task ordering: TASK-203 before the view; TASK-206 before/with the view; TASK-201's `label` before VAL-199/204 | **Agree, with one correction** | The warnings render is **TASK-210** (`ui/run.js`, `03-tasks.md:1771`), not 208/209. TASK-209 (`ui/workflow.js`, `:1762`) is the `describe.phases[].agents` consumer — which is where B-4's absent/`[]` rule lands. Merged order in §2.2 R-6'. |
| §5.5 | refuse the memo before the p95 is measured | **Agree** | My S-5 said the same: bounded, pre-approved on the number, not built before it. |

---

## 2. The four dimensions — final position

### 2.1 Observability

**O-1' — The lock (final).** `tests/fixtures/dashboard-wire.ts` exports
`DAG_WARNING_EXAMPLES = { fallback: 'PREDICTED_FROM_FALLBACK_VERSION: requested=v2 resolved=v1',
unavailable: 'PREDICTED_OVERLAY_UNAVAILABLE: reason=catalog-resolve-failed',
prose: 'lane 2 (review) is dynamic: agents cannot be statically slotted' } as const` (the third is
`dashboard.ts:393`'s format verbatim, and it contains `': '` — that is the point). `DAG_PAYLOAD.warnings`
stays `[]`. Three readers, one literal: **IT-169** asserts, for each of the two reachable producers (O-4'),
`warnings.filter(w => /^PREDICTED_/.test(w))` deep-equals `[<the fixture literal>]` — exact bytes, exactly
one token entry, prose siblings tolerated. Not `toEqual` on the whole array: `layout.warnings` may well be
non-empty in the deregister case (zero predicted lanes and a live agent at `phase.index 0` make
`dashboard.ts:432-434` append it WITH a warning), so a whole-array equality goes red for the wrong reason,
and a bare `toContain` cannot say "exactly one". **UT-244** (`.js`) maps each through `warningText` — FALLBACK →
「預測結構來自替代版本 v2」/`predicted layout from substitute version v2`, UNAVAILABLE → 「預測結構不可用」/
`predicted layout unavailable`, prose → the RAW string unchanged; and `tsc --noEmit` on the fixture is
unchanged. The grammar, merged from their A-6 and my O-2:

> `WARNING := TOKEN (': ' DETAIL)?` — `TOKEN` ∈ {`PREDICTED_OVERLAY_UNAVAILABLE`, `PREDICTED_FROM_FALLBACK_VERSION`},
> else the string is `layoutGraph` prose and carries no token. `DETAIL := k=v (' ' k=v)*`, keys
> `{requested, resolved, reason}`, values `[A-Za-z0-9._-]+`. FALLBACK carries `requested` and `resolved`
> (both `/^v\d+$/`, `workflow-catalog.ts:621`'s shape); UNAVAILABLE carries `reason` ∈
> `{catalog-resolve-failed, derivation-failed}`. Client rule: split on the FIRST `': '`; an unknown head,
> a missing `=`, or a known token with a malformed detail → return `raw` (never `undefined`, never the
> detail half — for a prose line that would drop its subject). `/skeleton/i` asserted absent on the
> served bytes once, in IT-169.

**O-2' — The pushes at their sites (their B-2, adopted; `requested=` applied).**

| arm | site (`server.ts`) | push into `routeWarnings` |
|---|---|---|
| (i) `resolve(spec.name, { version: view.legacySubstitution?.resolved ?? view.scriptVersion })` succeeds | `:500` | nothing |
| (ii) first `catch` → `resolve(spec.name, {})` succeeds | inside that catch, BEFORE the fall-through | `PREDICTED_FROM_FALLBACK_VERSION: requested=<what (i) asked for> resolved=<release.version>` |
| (iii) second `catch` (`:504-506`) | inside that catch — nothing downstream throws | `PREDICTED_OVERLAY_UNAVAILABLE: reason=catalog-resolve-failed` |
| (iv) derivation `catch` (`:540`) or the FALSE arm of `v1.ok ?` (`:538`) | those two sites only — never the `else` at `:534` | `PREDICTED_OVERLAY_UNAVAILABLE: reason=derivation-failed` |

Standing negatives: no `spec.name` (inline script) → nothing; the `:534` v1 path → nothing
(`diagram-contract-grandfather.test.ts:101`, `dag-warnings-empty.test.ts:37` stay green). `warnings:
[...layout.warnings, ...routeWarnings]`; `layoutGraph` stays pure. **One identifier for the UNAVAILABLE
token, in `server.ts` itself** (`const PREDICTED_OVERLAY_UNAVAILABLE = 'PREDICTED_OVERLAY_UNAVAILABLE'`
beside the route): arm (iv) has no producer with a registered script (registration ran the SAME derivation,
INV-V26-3; `contract:'v1'` never refuses) and O-4 refuses an injection seam for it — so the only thing
that vouches for arm (iv)'s spelling is that it shares arm (iii)'s identifier, which IT-169 does reach.
Not a formatter, not a `dashboard.ts` export, not a grep guard: one `const` in the file that uses it twice.

**O-3' — Journal ↔ payload.** On arms (iii)/(iv): `console.warn(JSON.stringify({event:'dashboard_api_degraded',
route:'dag', runId, reason}))` with `reason` byte-equal to the warning's `reason=` value. The two generic
catches (`:582-585`, `:1067-1071`) emit `reason:'internal'` and put the message under `detail` (their
B-3). IT-169's deregister case spies `console.warn`, parses exactly one line, and asserts
`parsed.reason === warning.split(': ')[1].slice('reason='.length)`. FALLBACK is NOT logged (a state;
its durable record is `legacySubstitution`, `run-manager.ts:909`). The dedupe shape (`runId + ':' +
reason`, per-process `Set`) is documented in DES-198 and not built (unanimous).

**O-4' — Producers per arm, and the recipe that is not vacuous.** (iii): the deregister case
`dashboard-http.test.ts:205-218` already builds — extend it. (ii): `registerPublishedVia` ×2 (release =
`v2`) → `run_start` (pin `v2`) → `workflow_deregister` → `registerPublishedVia` ×1 (lineage `v1`) → GET →
`requested=v2 resolved=v1`. The pin must outnumber the re-registered lineage (S-4): the natural recipe
(pin `v1`, re-register once) makes arm (i) FIND the new `v1`, push nothing, and IT-169's exact-equality
assertion goes red for a reason the author will not expect — and the likely "fix" is to weaken the
assertion. (iv): defensive — covered by `deriveLanes` never throwing and the kept `try/catch`; no seam.

**O-5' — The render.** TASK-210's `ui/run.js` renders `warningText(lang, w)` per entry via `textContent`
(D5), replacing `N warning(s)` (`dashboard-page.ts:601-607`). The legend text is the only FALLBACK
marker (X-3); predicted cells take REQ-134's pending style (DES-206's rule) whatever the warnings say.

**Agent altitude.** Three states an operator watching agents can now tell apart on every deployment:
not yet dispatched (inert cell, `agentId === undefined`, and — after A-4 — with the NAME of the agent
expected there), not in the plan (no cell), and the plan shown is not the plan that ran (FALLBACK
legend). A cold model reading `warnings[]` parses the same two-token grammar. Chain-of-thought, token and
tool-call inspection (REQ-135/140/141) are untouched.

### 2.2 Replaceability

**R-1 — C-4 withdrawn.** Unchanged from r1 (W-1): DES-197 loses the `maskPredictedOverlay` signature
clause, the fail-closed paragraph and the UT line; one cited sentence on the synthetic principal +
INV-V27-9 replaces them. Unanimous across both stages.

**R-2' — `deriveLanes(phases: PhaseView[], expected: ExpectedGraph, opts: { status: RunStatus })`.**
Non-optional (X-1). Body tolerant (`Array.isArray(expected?.lanes)`), the tolerance a body property,
not a type property. DES-196's stale `:519-520` sentence becomes: *`expected` may arrive EMPTY for
exactly one reason — the derivation failed; a later reader must not restore the auth reading from the
type.* The seven-member `current` table stands (A-2); `lanes` is dense and ordered (A-3); `current` may
exceed `expected.lanes.length` and is never clamped (B-5).

**R-3' — The resolve chain stays in the route; the pushes move into the catches.** No helper (a unit
tier only for the arm O-4 declines), no `derive` parameter, no `dashboard.ts` I/O. The `??` is the
whole change to the resolve; B-2's table is the whole change to the pushes.

**R-4 / R-5 — unchanged.** The four deletions by line (`:520`, `:334` + default, `:1068`, comments
`:331-334`/`:350`/`:1064`; `:819` stays); `authAnnounce` stays; no config key; a future withholding
policy is a principal-aware projection, never a knob (unanimous).

**R-6' — A stump neither r1 named: TASK-209's `dod:`.** `03-tasks.md:1768` reads 「a never-run workflow
renders its predicted lanes with agent labels from `describe.phases[].agents` (or lanes-only plus
「尚無執行」 when the overlay is masked)」. Delete the parenthetical's condition: the lanes-only arm is
keyed on `agents` ABSENT (B-4) and its text is 「預測結構不可用」 — the SAME string-table key as the DAG
warning (one key, two surfaces, §2.3). Whether 「尚無執行」 survives as the run-chip empty state is
DES-204's business, not this delta's. Merged task order (theirs + mine): **TASK-197** (fixture) →
**TASK-201** (`deriveLanes` signature, density, `label` on the predicted cell) → **TASK-203** (route:
deletions, `??`, pushes in the catches, the one const, the log line) → **TASK-202** (facade: `agents`
unconditional, absent/`[]` rule) → **TASK-206** (`warningText` + three keys) → **TASK-209** (describe
consumer) and **TASK-210** (warnings as text) → VAL-199/204 judged only after 201's `label` has landed,
or the Chromium screenshot photographs blank boxes and becomes the baseline.

**Agent altitude.** Provider, transport and model seams do not move; the overlay is script-derived
and provider-agnostic. One line.

### 2.3 Consumability

**C-1' — Contract sentences (final).** `GET /api/runs/:id/dag`: *gains `lanes` (dense, ordered: the
observed phases extended by every unreached expected lane — regardless of auth, Round v27b) and
`current`; a predicted cell carries `label` (the agent label(s) expected in that slot, `' / '`-joined
for a parallel group) and no `agentId`/`state`; `warnings[]` may carry `PREDICTED_OVERLAY_UNAVAILABLE:
reason=<catalog-resolve-failed|derivation-failed>` (lanes observed-only) or
`PREDICTED_FROM_FALLBACK_VERSION: requested=vN resolved=vM` (overlay derived from a substitute
version).* `describe.phases[]`: *`agents?: string[]` — the predicted lane membership, served to every
caller regardless of auth; `[]` when the lane is derivable but has no static labels; absent only when
the engine could not derive the predicted layout for this version.* TASK-202's `dod:` loses "with its
masking sentence"; README `:312-313` is unchanged and still true.

**C-2 — The cohort transition (hold; consistent with their B-3).** `legacySubstitution` is written only
on RESUME (`run-manager.ts:903-909`); a run whose pin was purged after it started carries the FALLBACK
warning on every DAG read and NO field — until a resume records the substitution, after which arm (i)
reads `resolved` and the warning disappears. The DAG warning is the authority for THIS read; the field is
the durable record that an EXECUTION resumed on a substitute. No test may assert the warning persists.

**C-3' — Two consumers of `describe.phases[].agents`, one vocabulary.** The MCP caller: additive field;
`tool-specs.ts:332`'s description gains "and the predicted lane membership (`phases[].agents`)". The
page: TASK-209's `ui/workflow.js` renders, per phase, the `agents` labels as predicted cells; `[]` → a
lane with no cells; absent on EVERY phase → lanes-only plus `t(lang, 'predictedLayoutUnavailable')`.
That the never-run view and the run view say 「預測結構不可用」 through the same key is the reuse
REQ-131 asks for — one string, one meaning, two surfaces.

**C-4' — Inert-cell detection unchanged; the cell now has a name.** The client detects a predicted cell
by `agentId === undefined`, never by the id prefix; it renders `label` when present and falls back to
nothing rather than to the kind word. Engine tests may keep keying on `__skel_` where the id is
produced (IT-092, IT-168's cell anchor); NEW assertions should prefer the contract predicate
(`kind === 'agent' && agentId === undefined`) so the test and the client read the same fact.

**C-5' — Timing.** After the stabilization predicate holds, `phase('one')` has necessarily fired, so
`current === 0` exactly (X-2). `lanes.map(l => l.title)` and `describe.phases[].agents` are
timing-independent as before.

**C-6 — `laneUntitled`.** Unchanged: `lanes[].title: string | null` is on the wire; one key
(「未命名 lane」/`untitled lane`) or `ui/run.js` renders the literal `null`.

**Agent altitude.** A cold model calling `workflow_describe` gets one shape on every deployment,
can tell "no static agents" (`[]`) from "could not derive" (absent), and can draw the predicted layout
without parsing `mermaid` — which is what makes the field a reusable asset rather than a page detail.

### 2.4 Self-sustainability

**S-1' — The parity oracle, as a test row (final).** In `dag-masking-auth.test.ts`: register the same
script on both servers, `run_start` on both, poll both `/api/runs/:id/dag` anonymously until each has
≥1 predicted cell and exactly one live agent cell in `running` (their predicate), then: **(a)** both
live payloads pass `keys ⊆ ALLOWED_DAG_KEYS && REQUIRED_DAG_KEYS ⊆ keys` imported from the fixture
(their C-1); **(b)** deep-equal the two payloads minus `PARITY_EXCLUDED = ['runId', 'terminalAt'] as
const` — written against the fixture's key tuple so a new key is compared by default; **(c)** describe
parity over anonymous HTTP on both servers, scoped to `phases` exactly (their C-2.3 — `owner` differs);
**(d)** the positive anchors ON THE AUTH SERVER, two of them: `cells.some(isPredictedCell)` (their cell
anchor — the exact assertion IT-092 inverts today) **and** `lanes.map(l => l.title)` `===`
`['one','two','three']` with `current === 0` (my lane anchor). The lane anchor needs a script with ≥2
phases: `registerPublishedVia` wraps IT-092's phase-less `SCRIPT` in a single synthesized `main` lane
(`workflow-fixtures.ts:139-143`) on which no lane is ever unreached, so `SCRIPT_PHASED` is a second
`const` in the same test file — not a new fixture module. The reason the lane anchor is not optional:
REQ-134's ruling text (`01-requirements.md:1769-1770`) says 「不得因 auth 而退化成只顯示已走到的 lane」 —
the unreached-LANE join is what the owner named; a same-lane predicted cell existed on the open server
before this delta.

**S-2 — Red versus guard, labelled.** Unchanged in substance: IT-168's flipped cases and the parity case
are RED today; IT-092 is re-traced to REQ-100 as a GREEN guard with a COMMENT sentinel
(`// RWE-IT092-SCRIPT-BYTES-DO-NOT-LEAK`, their C-5) asserted absent on `await res.text()`; the
`['__trigger__']` assertion is deleted; the file's header (`:1-15`) and the IT-168 block comment
(`:130-139`) are rewritten with the tests; the filename stays.

**S-3 — UT-238 after this delta.** 7 × 2 for `current` (14 cases, same oracle, the `:34` cast gone —
its disappearance IS the evidence); join rows: (i) unreached expected lanes extend the observed list;
(ii) `expected: undefined` behind `@ts-expect-error` never throws; (iii) observed longer than expected →
`lanes` IS the observed list, `current === phases.length - 1` even beyond `expected.lanes.length`, no
conflict output; (iv) A-3's density row (`expected.lanes` = `[0,1,3]` → `lanes[k].index === k`).

**S-4 — The reused-pin blind spot (hold).** `register()` mints `v<max+1>` over the name's OWN rows
(`workflow-catalog.ts:583, :621`); deregister → re-register restarts at `v1`; a run pinned to the OLD
`v1` resolves the NEW `v1` on arm (i) — no throw, no warning, a wrong overlay, and `legacySubstitution`
never set (resume resolves the same way, `run-manager.ts:899-901`). The FALLBACK arm witnesses an ABSENT
pin, never a REUSED one. DES-198's boundary states it in one sentence and names the v28 check
(`workflow_versions.createdAt > run.createdAt` ⇒ reused) as a catalog-lineage item OUT of this closure.
The in-closure consequence is O-4's recipe.

**S-5 — Gate 7.5 rows.** VAL-199 gains one Chromium case with `auth.enabled:true`: a never-run workflow
renders its predicted lanes WITH agent names (A-4 — the screenshot must show a name, not `agent`), the
`mintBearer` trap named (registration needs the bearer; the page and `/api/*` GETs need none). VAL-204:
the VAL-side p95 loop (200 sequential `GET /api/runs/:id/dag`, auth on, the largest corpus script); the
bounded memo pre-approved on the number and not built before it (unanimous). The real-tier table rows
for REQ-133/140 gain "on the auth-enabled engine" / "the unreached predicted lanes and
`describe.phases[].agents` present in BOTH".

**S-6 — Self-healing unchanged.** Every fault still degrades to an empty overlay and a 200; the two
fault-arm log lines close the loop; the dedupe is a documented shape.

**Agent altitude.** No memory to metabolize (the overlay is derived from stored script text on every
read until a measured number says otherwise), no tool probed, no prompt calibrated. One line, honestly.

---

## 3. Remaining disagreements — none blocking

| # | Item | My position | Why it may still be contested | Cost of either outcome |
|---|---|---|---|---|
| D-1 | `SCRIPT_PHASED` as a second `const` in `dag-masking-auth.test.ts` for the LANE anchor | **Hold** | Their §4/§7 say "no new fixture". I read that as no new fixture MODULE; a script constant in the test file is not one. If they mean no second script at all, the unreached-lane join — the clause the ruling names — is witnessed on no server. | One `const`; zero files. |
| D-2 | One `const` for the UNAVAILABLE token in `server.ts` | **Hold (weak)** | They may call it machinery. It is one line in the file that uses it twice, and it is the only thing that vouches for arm (iv)'s spelling. | One line. |
| D-3 | `label: labels.join(' / ')` rather than `labels[0]` | **Refinement of their A-4** | Expected accepted: no branch on `kind`, identity for `single`. | One expression. |
| D-4 | Test-side predicate: `__skel_` regex vs `agentId === undefined` | **Not a dispute** | Either is correct where the id is produced; new lines should read the contract fact. | None. |

Everything else in both r1s is agreed or retracted above.

---

## 4. ARCH text corrections routed to the synthesizer — one list, wire strings against amended rows

1. **ARCH-130 (ii):** `pinned=` → `requested=`. **(iii)/(iv):** `PREDICTED_OVERLAY_UNAVAILABLE: reason=<enum>`
   (k=v form, one parser). **(2):** the three pushes happen INSIDE the catches at `:500-506` / `:538` /
   `:540`, never after `layoutGraph` (B-2).
2. **ARCH-126 `api:`:** 「while `status === 'running'`」 → 「while the run is live (`running | suspended |
   interrupted`)」 (A-2; DES-196's table stands).
3. **ARCH-125 v27b amendment:** the split/map/fallback lives in `lib/strings.js` as `warningText(lang,
   raw)`; `ui/run.js` calls it and does nothing else with warnings (C-3).
4. **TASK-209 `dod:`** (`:1768`): delete "when the overlay is masked"; lanes-only is keyed on `agents`
   absent and reads `predictedLayoutUnavailable` (R-6').

---

## 5. Ledger edit map — converged (supersedes r1's table)

| Item | Edit |
|---|---|
| DES-196 | signature `deriveLanes(phases, expected: ExpectedGraph, { status })` — non-optional, body tolerant; the `:519-520` sentence → "EMPTY for exactly one reason: derivation failed"; `lanes` dense and ordered; `current` seven-member rule STANDS and may exceed the predicted count; predicted cell gains `label: labels.join(' / ')` (absent when no labels); tests: 14 + join rows (i)–(iv) |
| DES-197 | DELETE the `maskPredictedOverlay` clause, paragraph and UT line; `phases[].agents` unconditional, `[]` = no static labels, absent ⇔ not derivable / no derived lane at that ordinal, derived lanes beyond `phases.length` dropped; one cited sentence on the synthetic principal + INV-V27-9 |
| DES-198 | (2) `deriveLanes(view.phases, expectedGraph, { status: view.status })`; four deletions by line; resolution (i)–(iv) with the `??`; the pushes INSIDE the catches per O-2'; one `const` for the UNAVAILABLE token; grammar per O-1'; (4) `{event, route:'dag', runId, reason}` on (iii)/(iv) with `reason` = the `reason=` value verbatim, `internal` + `detail` on the generic catches; dedupe shape documented; boundary: cohort transition (C-2), reused-pin limit + v28 check (S-4), `derivation-failed` defensive (O-4), `__skel_` stays (A-5), no config key |
| DES-201 | `lib/strings.js` gains `warningText(lang, raw)` and keys `predictedLayoutUnavailable`, `predictedLayoutFromFallback` (takes `resolved`), `laneUntitled`; key parity covers them |
| DES-206 | `ui/run.js` renders `warningText(lang, w)` per entry as TEXT; `ui/workflow.js` renders `agents` per phase, `[]` → no cells, all-absent → lanes-only + the same key; a predicted cell (`agentId === undefined`, no `state`) TAKES REQ-134's queued/pending style — a rule this row states, since REQ-134 names states and a predicted cell has none; detection by `agentId === undefined` |
| DES-114 / DES-115 | `superseded_in_part` marker bullets (their §2d), `iter:` stays v22 |
| TASK-197 | `DAG_PAYLOAD_OPEN` → `DAG_PAYLOAD`; row label without "(open)"; `DAG_WARNING_EXAMPLES` (three literals); `DAG_PAYLOAD.warnings` stays `[]` |
| TASK-201 / 202 / 203 / 206 / 209 / 210 `dod:` | per §2.2 R-6' order; TASK-209 loses "when the overlay is masked"; TASK-203 enumerates the four deletions by line, the two producer cases, the one const |
| UT-238 | `masked` out; 7×2; join rows (i)–(iv); the cast disappears; `undefined` behind `@ts-expect-error` |
| UT-244 | + the map over `DAG_WARNING_EXAMPLES` (both languages, prose passthrough, malformed → raw); + the three keys in parity |
| IT-168 | flipped positive on both servers; stabilization predicate; live key-set check on both payloads; `PARITY_EXCLUDED`; describe parity scoped to `phases`; cell anchor + lane anchor (`SCRIPT_PHASED`, `current === 0`) on the auth server; header comments rewritten |
| IT-169 | deregister case gains `warnings.filter(w => /^PREDICTED_/.test(w))` deep-equals `[DAG_WARNING_EXAMPLES.unavailable]` + the parsed log line; new FALLBACK case with the pin-HIGH recipe, the same filtered shape deep-equals `[DAG_WARNING_EXAMPLES.fallback]` + no log line; `/skeleton/i` absent on served bytes; a predicted cell carries `label` |
| IT-092 | re-traced to REQ-100 as a green GUARD: comment sentinel absent on `res.text()`; `['__trigger__']` assertion deleted |
| VAL-199 / VAL-204 | one auth-ON Chromium never-run case showing agent NAMES with the `mintBearer` trap named; VAL-side p95; memo pre-approved on the number |
| Real-tier table (04-design.md:6849) | REQ-133 row + "on the auth-enabled engine"; REQ-140 row + "the unreached predicted lanes and `describe.phases[].agents` present in BOTH" |
| README `:368-375`, `tool-specs.ts:332` | the two C-1' sentences; the describe row WITHOUT a masking sentence; the tool description names `phases[].agents` |
| ARCH-125 / ARCH-126 / ARCH-130 | the four corrections in §4 |
| REQ-105 `:1070` | orchestrator: `[PARTIALLY SUPERSEDED v27b, Round v27b]` on the auth-gate clause only (unanimous, both stages) |

---

## key_points

1. **Three load-bearing adversarial items conceded on the source:** live key-set check in IT-168 (C-1,
   `dashboard-disclosure.test.ts:36`); `label` on the predicted cell (A-4, `dashboard.ts:425`,
   `dashboard-page.ts:581`); `warningText(lang, raw)` pure in `lib/strings.js` (C-3).
2. **Three of my r1 claims retracted at file:line:** `| undefined` on `expected` (`server.ts:519`);
   "random agentId" (`run-guard.ts:208`); O-7's redundant greying (REQ-134 `:1763`). The
   `dagWarning()` formatter is conceded; the fixture literal + exact bytes on the filtered token entry
   (`warnings.filter(/^PREDICTED_/)` deep-equals `[literal]`) is the lock.
3. **Grammar final (A-6 + O-2 merged):** `TOKEN: k=v k=v`; FALLBACK `requested=vN resolved=vM`;
   UNAVAILABLE `reason=<catalog-resolve-failed|derivation-failed>`; split on the first `': '`; anything
   unparseable → raw; `/skeleton/i` absent on served bytes once.
4. **Pushes INSIDE the catches (B-2)** — `:504-506` falls through with `''`; a downstream push is
   silent forever. One `const` for the UNAVAILABLE token in `server.ts`, for the arm no test reaches.
5. **Journal `reason` = the warning's `reason=` value, verbatim; `internal` + `detail` on the generic
   catches (B-3);** FALLBACK never logged; dedupe documented, not built.
6. **`describe.phases[].agents`: `[]` = derivable, no static labels; absent = not derivable (B-4)** —
   falls out of UT-239's existing `?? []`; the consumer is TASK-209, and its `dod:` loses a stale mask
   clause (R-6').
7. **Parity (S-1'):** their stabilization predicate; live key-set on both payloads; `PARITY_EXCLUDED`;
   describe scoped to `phases` (`owner` differs); cell anchor AND lane anchor on the auth server —
   the lane anchor needs `SCRIPT_PHASED` because the ruling names the unreached-lane join.
8. **`deriveLanes(phases, expected, { status })`** non-optional, tolerant body; dense `lanes`;
   `current` unclamped; UT-238 = 14 cases + four join rows, the cast gone.
9. **Cohort transition (C-2) and reused-pin limit (S-4) held, unopposed;** the FALLBACK recipe pins
   HIGH (`requested=v2 resolved=v1`) or IT-169 goes red for a reason the author will misattribute.
10. **Parallel-slot label:** `labels.join(' / ')`, not `labels[0]` (`skeleton-graph.ts:164`); the
    `dashboard.ts:250` comment is about `tokens` and needs no amendment.
11. **Order:** 197 → 201 → 203 → 202 → 206 → 209/210 → VAL; `label` lands before any screenshot.
12. **Unanimous, not resolved:** four deletions; no knob; no structured warning objects; no
    `lib/warnings.js`; no nested key-set row now; no memo or dedupe before a measurement; REQ-105 marker.

## risks

| # | Risk | Severity | Where it lands |
|---|---|---|---|
| QD-Δ-D1' | **The two spellings drift with CI green** — the fixture literal, the route's string and the client's map are three files; only IT-169's exact bytes on the filtered token entry (not `startsWith`, not `toContain`) and UT-244's map over the same literal hold them together. | HIGH | O-1', IT-169, UT-244 |
| QD-Δ-D2' | **Arm (iii) implemented after `layoutGraph`** — pushes nothing, forever, every test green. The single most likely silent failure (their risk 3, my concession). | HIGH | O-2', TASK-203 `dod:` |
| QD-Δ-D3' | **The FALLBACK case uses the natural recipe (pin `v1`)** → arm (i) finds the new `v1` → red for an unexpected reason → the assertion gets weakened. | HIGH | O-4', S-4 |
| QD-Δ-D4' | **Parity written without the stabilization predicate** → `cells[].state` flakes across `acquireSlot()` → quarantined → INV-V27-9 has no empirical control. | HIGH | S-1' |
| QD-Δ-D5' | **A-4 ruled out of closure and REQ-134 not amended** → every unreached node on the auth deployment reads `agent`; Gate 7.5 finds it by screenshot. | MID | A-4, S-5 |
| QD-Δ-D6' | **Describe parity compared whole** → fails on `owner` → "fixed" by widening the shared exclusion list → the DAG half weakens. | MID | S-1' (c) |
| QD-Δ-D7' | **TASK-209's mask clause survives** → the never-run view keeps a "masked" arm that no engine state produces, and a Gate 6 reader restores the branch from the DoD. | MID | R-6' |
| QD-Δ-D8' | **A test asserts the FALLBACK warning persists across a resume** — it disappears by design. | MID | C-2 |
| QD-Δ-D9' | **`labels[0]` on a parallel slot** → a three-agent parallel group shows one name; the operator counts wrong. | LOW | D-3 |
| QD-Δ-D10' | **`derivation-failed` grows an injection seam** to become unit-testable — the class this delta deletes. | LOW | O-4', R-3' |
| QD-Δ-D11' | **The reused-pin blind spot surfaces at Gate 7.5 as "the overlay is wrong under auth"** and is misattributed to the reversal. | LOW (cost) / MID (confusion) | S-4 |
