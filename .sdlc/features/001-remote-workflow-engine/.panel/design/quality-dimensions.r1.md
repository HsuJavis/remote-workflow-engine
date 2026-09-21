# Quality-dimensions lens — v36 Design stage (Gate 3, Tasks+Design merged), round 1

## Altitude check (tech_stack + requirements)

Unchanged from the architecture-stage panel's own finding, independently re-derived from
`state.yaml`'s `tech_stack` and `01-requirements.md`: this is **both** — a conventional
hand-rolled-HTTP/SQLite system (MCP facade, `WorkflowCatalog`, `RunStore`) whose payload is an
AI-agent execution engine (`agent()` dispatched through the `GatewayClient` port to
LiteLLM-direct-fetch or the Claude Agent SDK). None of REQ-211..216 is purely one altitude; I apply
both per dimension where the requirement reaches there, same as the prior round.

**Scope of this round, explicitly stated so it isn't silently re-litigated**: 02-architecture.md is
already **PASSED** for v36 (ARCH-155..173, ADR-072..079) — the architecture-stage quality-dimensions
panel (`.panel/architecture/quality-dimensions.r1.md`/`r2.md`) already ran these same four
dimensions against the design forks and the gate already ruled (`refusalRef` over the payload/ledger
alternatives, ADR-072). I am not re-opening that ruling. This round's job is the layer *below* it —
what 03-tasks.md's task split and 04-design.md's function-level contracts need to get right so the
already-decided architecture survives contact with test-first (Gate 5) and, concretely, with the
~20-implementer shared-tree reality this repo's own CLAUDE.md exists to warn about. That reframing is
where this round earns its keep; repeating the architecture panel's dimension-by-dimension content
would not.

## Summary

Four of the six ARCH rows carry a property that a naive task split can silently destroy even though
the architecture is correct on paper: (1) REQ-215's refusal marker crosses a real process boundary
through four files with no compiler to hold them together — only a real-sandbox test can catch a
partial implementation, and REQ-215's own acceptance text already demands that test exist first; (2)
REQ-213/216's `EventSink`/`attemptsFor` wiring is this repo's own named recurring bug class
(`composeconfig-wiring-bug-class`, hit at v11 and v15) and the fix ships its own guard test in the
same ARCH rows — task-splitting that separates "add the sink/helper" from "add the K8 wiring probe"
across two implementers reproduces the exact defect being fixed; (3) ARCH-171/173's port-formula fix
and its guide sentence are declared a byte-locked pair — splitting them risks a guide that describes
an engine that doesn't exist yet, mid-iteration, visible to every other agent reading
`docs/AUTHORING.md` off the same tree; (4) REQ-214's test seam is the one component in this slice that
isn't TypeScript/vitest (`deploy.sh`), and 04-design.md doesn't yet say what proves the two-instance
property. A fifth item is a housekeeping flag, not a design gap: ARCH-172 carries a **pending
owner_decision** that the task list must neither silently resolve nor block v36 on, since v36's own
REQ-216/K5 deliverable (a ruling on `listRuns()`) is already discharged by ADR-079.

## Key points

### (1) Observability

**REQ-215 — the property under test is exactly the property a per-file task split cannot verify.**
ADR-072's chosen design (`refusalRef`, `WeakMap<object, number>` keyed on Error object identity)
buys its safety from one specific runtime fact, stated on ARCH-165's own row: `parallel()`/
`pipeline()` must re-throw the *same* object, unwrapped, for the map key to survive. That fact is
not encoded anywhere a compiler checks it — `guards.ts` (map + read), `child-entry.ts` (stamp +
forward), `host.ts` (relay), `run-manager.ts` (ledger + fold into the run envelope) communicate
through a JSON IPC message and an in-process WeakMap that nothing but a live round trip exercises
end to end. A task split that hands these four files to four different implementers, each shipping
green unit tests for their own file, can converge on a fully-typed, fully-compiling system in which
the marker still silently fails to cross — exactly the "dead code plus a test that can never fail"
failure v35 was written to forbid, reproduced one layer up. REQ-215's own acceptance text already
requires the fix: "測試必須在 sandbox 真實層(不是 mock 掉 IPC)證明標記真的穿過去了." I'd make that
requirement a **task-splitting rule, not just a test requirement**: ARCH-165/166/167/168 should be
**one task**, RED-first with that real-child integration test written and failing before any of the
four files change, so no implementer can mark a partial slice of the seam "done" while the object-
identity property is still unverified. Two concrete cases I'd want named in that single task's test
list rather than left implicit: (i) the boundary case ARCH-165 itself flags — a `parallel()` branch
whose refused `agent()` re-throws the same object — and (ii) ARCH-168's 8-entry cap: a 9th refusal in
one run increments `refusalsDropped` and does not evict an earlier entry.

**K2 and K1 (ARCH-170, ARCH-169) — the two rows state an ordering and then contradict it, and
03-tasks.md needs to pick a reading before either lands.** ARCH-170's note says K2 "lands first and
as its own commit, **before** ARCH-169's unification touches anything, so the security fix is
reviewable without a refactor wrapped around it" — but ARCH-170's own `api:` line writes the fix as
`failDetail: captureFailure(err, secrets, 200).message`, i.e. it already calls the pure function
ARCH-169 introduces. Both rows can't be literally true in that order: either K2 ships first as the
inline `capErrorEnvelope(redact(toErr(err)), 200)` it's meant to replace-in-place, and K1 later
refactors both capture sites (including K2's) onto `captureFailure`, or K1's `captureFailure` lands
first and K2 is simply its second caller — in which case "K2 lands first" describes commit *order
within the same task*, not a dependency-free standalone change. I'd read the intent as the latter
(one task, K2's redaction-ordering fix and K1's collapse land together, K2's commit first inside that
task for reviewability) since that's the only reading under which ARCH-170's own `api:` line is
correct as written — but this is a case where the architecture rows disagree with each other on
sequencing, not just under-specify it, and 04-design.md should say so explicitly rather than let an
implementer resolve it by picking whichever row they read first.

**REQ-213 — the wiring-probe pairing is the same shape as v36's own K8, and it generalizes.**
ARCH-159's note already says the quiet part out loud: "a new `main.ts` forwarding that is never
actually forwarded is this repo's documented bug class... the systematic guard is
`compose-config-v2-wiring.test.ts`... One probe row for `eventSink`, in the same sweep, in the same
commit." I'd promote that from a note to an explicit task-splitting constraint: the `EventSink`
module (ARCH-159), its two call sites (ARCH-160 run-terminal, ARCH-161 catalog register/publish/
deregister), and its wiring-guard probe row are **one task**, not "implement the sink" plus a
separate "write the wiring test" ticket. This project's own memory
(`composeconfig-wiring-bug-class`) records this exact split-causing-the-bug pattern twice already
(v11 `updateFlagPath`, v15 auth); a task list that repeats the split on the very feature meant to
close it would be an avoidable third instance, not a coincidence.

**REQ-213 × REQ-212 — the sink's own event shapes are inconsistent on identity, and this is a design-
stage finding, not an architecture one, because the shapes weren't fixed until ARCH-159..161 were
written.** Reading the three emitted event literals against each other: `catalog.publish` and
`catalog.register` (ARCH-161) carry the full `{principal: actor.id, bypass: actor.bypass, idSource:
actor.idSource}` triple; `catalog.deregister` — the slice's **one new destructive action** — is
`{kind, name, version}`, with **no actor fields at all**; and `run.terminal` (ARCH-160) uses
`principal: entry.principal ?? null`, the pre-REQ-212 single-string form, so a `claimed` id on an
auth-disabled server reads identically to an `authenticated` one in the very log line
`catalog.publish` now disambiguates two rows below it. That is REQ-212's own defect — "此稽核行記
principal 永遠是 null/未區分身分來源" — reproduced on a brand-new line, on the requirement whose
whole point is closing exactly that gap. Nothing catches this at compile time either: ARCH-159's sink
signature is `(event: Record<string, unknown>) => void`, so a missing `actor` field or a typo'd
`kind` string is silent. The 04-design.md ask: one discriminated-union `EngineEvent` type (keyed on
`kind`) as the sink's parameter in place of `Record<string, unknown>`, with a shared, required
`actor: {id, bypass, idSource}` sub-shape on every audit-bearing kind — `catalog.deregister` included
— so the omission becomes a type error instead of a silent gap, and K8's wiring probe gains a
compile-time twin for free. This is a small addition (~10 lines, no framework, no new module) that
belongs in the same task as ARCH-159/160/161 for the reason already given above: it's the same
wiring-pairing seam, one degree more specific.

**Agent altitude — one item, already named at the design layer.** ARCH-168's 8-entry refusal ledger
with its `refusalsDropped` counter is this round's only agent-altitude self-sustainability-adjacent
observability item (bounded per-run state, a visible signal instead of a silent cap); it's listed
again under (4) rather than duplicated here.

### (2) Replaceability

**The same untyped `Record<string, unknown>` sink parameter flagged under (1) is also a
replaceability gap.** A typed seam (`GatewayClient`, `RunStore`) is this project's own working
definition of "swap without rewrite"; `EventSink`'s current signature accepts any shape, so adding a
fourth event kind later — or a fifth `idSource` value at the facade — is a change nothing forces the
implementer to make consistently with the other three kinds. The discriminated-union fix proposed
under (1) closes this from the same edit; noted here only so it isn't read as an observability-only
concern.

**ARCH-171's `attemptsFor` needs a contract test across conformers, not two unit tests that happen to
agree today.** The defect K6/K7 closes (`client.ts` retrying an untimed call, `claude-agent-sdk-
client.ts` not) is precisely what "swap the gateway is a pure config change" is supposed to prevent —
two independently-tested files silently drifting on observable behavior. Homing the formula on the
port (ARCH-171's own choice) removes the *source* of drift, but 04-design.md should also close the
*detection* gap: one parametrized test that feeds the same `(retries, timeoutMs)` table into both
`GatewayClient` conformers' effective-attempts computation and asserts equal output, run as one test
against both, not "test A, separately test B, both currently pass." A per-file unit test would have
passed right up until the day this defect was introduced; a cross-conformer contract test is the one
shape that would have caught the divergence when it happened. This is the direct instrument-level
translation of the replaceability goal this project already names for itself.

**Task-splitting note, same shape as REQ-215's:** `client.ts` and `claude-agent-sdk-client.ts` plus
the shared helper are one seam for the same reason the sandbox IPC seam is — a task split that lands
"fix `client.ts`" and "fix `claude-agent-sdk-client.ts`" as two independent tickets can trivially
reintroduce a *third* formula if one implementer free-hands a local fix instead of importing the
port's export. One task, one shared function, both call sites updated in the same commit ARCH-171
already specifies — I'm only asking that 03-tasks.md not re-split what ARCH-171 already unified.

**REQ-211/212, confirmed unaffected:** the version→channel indirection and the new `Actor` struct
both stay decoupling seams (a caller depends on a channel or on `canMutate`'s pure predicate, not on
concrete storage), and neither requirement's design touches that. Flagged only to confirm no
regression, per the architecture round's own precedent of stating this rather than assuming it.

### (3) Consumability

**ARCH-171 + ARCH-173 + `docs/AUTHORING.md` is a byte-locked triple, and the task list should say so
in those words.** The architecture row states it as a shipping constraint ("must ship together or
the guide describes an engine that no longer exists"); I'd add the reason that matters specifically
*at the design/task-split stage*: this codebase's own guide-generation test pins `docs/AUTHORING.md`
byte-for-byte to the builder (ARCH-107/151 precedent), so an implementer who lands the `client.ts`
fix without the guide sentence doesn't get a silent gap — they get a **failing** guide-diff test,
which is good, but only if the task boundary doesn't let someone else's unrelated change land on top
of a half-finished pair first. On the shared tree this repo runs implementation gates on (per
CLAUDE.md, ~20 agents on one working tree), a "code-only" task that's momentarily red on the guide
test is a worse failure mode than a task that's simply not started yet, because a red test is
ambiguous between "known WIP" and "someone broke it." One task, both halves, same commit — as
ARCH-171/173 already say; I'm converting that from architectural intent into an explicit task-split
instruction.

**REQ-211's error-message fix is a small, isolable task — flagging it as the SAFE contrast case.**
Unlike the three pairs above, `VERSION_CEILING_EXCEEDED`'s hint-text rewrite (ARCH-155's note) has no
cross-file runtime coupling and no compiler-invisible property; it's a legitimate candidate for an
independent task, and I'd use it as the calibration example in 03-tasks.md for "this kind of change
splits safely" versus the four pairs above that don't.

**REQ-213's `workflow_list` fields — one thing worth pinning at the design-contract level.**
ARCH-163's projection adds `lastRunAt: lastRuns.get(w.name) ?? null` and forwards the
already-produced `description`. 04-design.md's test list should include the REQ-206-precedent case
explicitly (a workflow that has never run reports `lastRunAt: null`, not `0` or an absent key) as its
own assertion, not folded into a general "list shape" test — this is the exact sentinel-convention
bug class REQ-206 itself was written to close, on a brand-new field, and it's cheap to pin now versus
rediscovering it as a v37 defect report the way REQ-206 was discovered.

### (4) Self-sustainability

**REQ-214's test seam is architecturally decided (ARCH-164's 3 lines) but its *test harness* is not
yet named, and this is a genuine 04-design.md gap.** Every other v36 deliverable is TypeScript
exercised by vitest; `deploy.sh` is bash, and ARCH-164's own note explains *why* the seam is needed
("catching it for real means booting two engines... v34's Gate 7.5 hit this defect and shipped a
workaround while the script stayed broken") without saying what runs `--dry-run` and asserts on its
two printed paths. I'd want 04-design.md to pick one explicitly rather than leave it to whichever
implementer reaches this task first: a `vitest` test that shells out to `deploy.sh --dry-run` with
two different `RWE_CONFIG_PATH` values via `node:child_process` and asserts the two printed pid/log
paths differ (keeps the test inside the existing vitest run, no new test runner) versus a
standalone shell assertion invoked from CI separately from `npm test`. My preference is the former
— it keeps REQ-214's regression coverage inside the same `npm test` surface everything else reports
against, and it's the natural place for the two-instance-collision case this dimension flags as the
actual defect. Left unstated, the risk isn't that the seam goes untested — ARCH-164 clearly intends
it to be — it's that two different implementers invent two different harnesses for it if this isn't
pinned once at design time.

**ARCH-172's `owner_decision` — a housekeeping flag for the task list, not a new finding.** REQ-216/
K5's actual deliverable — "裁決要不要加" a bound on `listRuns()` — is already discharged: ADR-079
rules **no LIMIT**, with the reason in the port contract. The `owner_decision` marker on ARCH-172 is
about a *further*, optional question beyond that ruling (whether `listSummaries()`'s callers should
also move onto the paginated `list()`, changing what `/api/home`'s averages mean). 03-tasks.md should
not treat this as blocking v36's task list, and should not have a task quietly resolve it either way
— it's an owner-facing question the architecture stage correctly refused to answer unilaterally
("an owner-visible semantic change," its own words), and design/task-splitting inherits that same
refusal rather than re-deciding it under a different hat. Carry the marker forward as-is.

**Agent altitude.** ARCH-168's 8-entry refusal ledger with its `refusalsDropped` counter is the one
agent-altitude self-sustainability item this round adds: bounded per-run state (a script that loops
refused `agent()` calls cannot grow it past 8 entries) with a visible signal on overflow rather than a
silent drop — the same shape this dimension's canonical framing asks for at the context-memory
altitude, applied to a per-run ledger instead of a long-lived agent's context.

**Nothing else reopened.** No v36 requirement touches health endpoints, log rotation, or
autoscaling/circuit-breaking, and the architecture round's scoping of those as correctly out-of-scope
for a single-node QM tool stands; 04-design.md doesn't need to invent coverage for a property no
requirement asks for.

## Risks

1. **The two "must be one task" pairs (REQ-215's 4-file IPC seam; ARCH-171+173's port-fix-plus-guide)
   are exactly the kind of unit a naive task-splitter merges by file count, not by runtime coupling.**
   If 03-tasks.md is generated by splitting on file boundaries or on ARCH-row boundaries mechanically,
   both pairs are likely candidates for an accidental split. This is the single highest-value risk in
   this round because the failure mode is silent: everything compiles, per-task tests pass, and only
   a real-sandbox integration test (which only exists if the RED step for the whole seam was written
   first) catches it.
2. **The `EventSink`/`attemptsFor` wiring-probe pairing is a repeat of a bug class this repo has
   already paid for twice** (memory: `composeconfig-wiring-bug-class`, v11/v15). Splitting "add the
   capability" from "add its wiring guard" across tasks is not a new risk in the abstract — it is the
   literal, named mechanism of two prior real regressions, on the very requirement meant to close
   another instance of it (K8).
3. **`deploy.sh`'s test harness is unspecified.** Left to task-splitting time, two implementers on a
   shared tree could each write a different ad-hoc harness for the same `--dry-run` seam, producing
   either duplicate test infrastructure or (worse) two tests that both pass while exercising the seam
   differently, neither catching the actual multi-instance collision REQ-214 is about.
4. **ARCH-172's pending `owner_decision`, if not clearly marked "not blocking," could either stall the
   rest of v36's task list waiting on an answer nothing else depends on, or get quietly decided by an
   implementer choosing a page size because a task said "handle K5."** Both are avoidable by stating
   plainly, in 03-tasks.md itself, that REQ-216/K5 is closed by ADR-079 and the pending marker is a
   separate, non-blocking, owner-facing item.
5. **`EventSink`'s untyped `Record<string, unknown>` parameter already let one event kind ship
   inconsistent on identity** (`catalog.deregister` has no actor fields; `run.terminal` still uses the
   pre-REQ-212 single-string `principal`) — inside this very architecture round, before any code
   exists. Left untyped into task-splitting, a later event kind (v37+) reproduces the same gap a
   fourth time, on a sink whose entire job is being the one audited path.
6. **ARCH-169/ARCH-170's stated commit order for K1/K2 is internally inconsistent** (ARCH-170 says K2
   lands before `captureFailure` exists, but calls `captureFailure` in its own `api:` line). Read
   literally by two different implementers, this produces two different, incompatible diffs for the
   same pair of files.

## Expected disagreements with other lenses

- **Task granularity for the two "must be one task" pairs.** A testability- or minimal-diff-weighted
  lens may argue the IPC seam's four files are independently revertible and should stay four small
  tasks with the real-sandbox test as a fifth integration task layered on top after all four land —
  the same shape of disagreement the architecture round already surfaced over K1/K2 ("independently
  revertible" vs. "same PR, cheaper"). I'd resist that split specifically for this pair because the
  property under test is invisible until all four are in place; a partially-landed seam has no
  meaningful intermediate state to revert *to* that isn't simply "REQ-215 not started."
- **Whether the `attemptsFor` cross-conformer contract test is in scope for K7/K8's stated ~3-line
  sizing.** A Karpathy-tie-break-weighted lens (this project applies that tie-break explicitly, per
  the v36 decision rationale) may read my proposed contract test as scope growth beyond what the
  architecture round sized, since ARCH-171 already gets detection-by-construction from the shared
  helper and might judge a second, cross-conformer test redundant with "both call the same function."
  I'd hold that a test proving the *import* happened (both conformers call the shared export) is
  cheap and is exactly what would have caught this defect on the day it was introduced, but I expect
  this to be the most contested point in the round.
- **`deploy.sh`'s test harness choice.** I don't expect disagreement that it needs pinning, but I'd
  expect a lens weighting deployment-script simplicity more heavily to prefer a standalone shell
  assertion over a vitest-shells-out test, on the grounds that a bash script shouldn't need a Node
  process to verify itself.
- **The `EngineEvent` discriminated union.** I'd expect a Karpathy-tie-break-weighted lens to read this
  as scope growth beyond REQ-213's "JSON 一行" ask and beyond K8's "~3 行" sizing for the wiring probe,
  and to prefer catching the `catalog.deregister`/`run.terminal` inconsistency with an added test case
  instead of a new type. My counter is that the untyped `Record` is exactly what let the inconsistency
  ship inside the architecture round itself, before implementation — a test catches today's three
  kinds; a type prevents kind four from repeating it, at a cost smaller than the module it lives
  beside.
- **ARCH-172's marker.** I don't expect this to be contested on substance, but I'd expect at least one
  lens to propose resolving it now rather than carrying it forward, on the grounds that the design
  stage is a natural place to also decide `/api/home`'s pagination semantics while the surface is
  already open. I'd hold that this is exactly the "owner-visible semantic change" the architecture
  round explicitly declined to make unilaterally, and design-stage momentum isn't a reason to revisit
  that refusal.
