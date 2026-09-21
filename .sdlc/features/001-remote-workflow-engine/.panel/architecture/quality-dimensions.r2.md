---
stage: architecture
iteration: v36
panel: architecture
lens: quality-dimensions (Observability / Replaceability / Consumability / Self-sustainability)
round: 2 (response to adversarial.r1.md)
scope: REQ-211..REQ-216
---

# Quality-dimensions lens — round 2

## 0. Self-correction first (my own evidence, wrong in r1)

My r1 built part of the REQ-213 × rotation argument on a wrong file identity: I wrote "journal.jsonl
carries 7 `catalog.publish` lines across 70 minutes." Re-checked on disk: `journal.jsonl` is
strictly **per-run** (`sqlite-run-store.ts:164`, `join(this._runDir(runId), 'journal.jsonl')`), and
`catalog.publish` (workflow-catalog.ts:803) is a bare `console.log` with no `runId` — it cannot land
in a per-run file. It goes to stdout, which `deploy.sh:63` redirects to `.rwe.log`
(`nohup … > .rwe.log 2>&1`). These are **two different unbounded-growth axes**, not one:

1. **`journal.jsonl` (per-run)** — the already-filed debt at `02-architecture.md:4659` ("D11":
   compaction/rotation for resident/cron workflows). Real, correctly filed, **not** what REQ-213
   touches.
2. **`.rwe.log` (engine-wide, `nohup`-redirected, never rotated)** — this IS what REQ-212's audit
   line and REQ-213's register/terminal lines land in, through adversarial's proposed single
   `EventSink`. Nothing in either r1 proposal bounds its growth; adversarial's R-7 covers its
   *permissions* (0600, PII-bearing) but not its *size*. And REQ-214 is touching this exact path
   this round (deriving its sibling PID/log location), which is the cheapest point to also state a
   size answer.

I relocate my rotation-coupling point to (2) below, under Self-sustainability, and withdraw the
journal.jsonl framing. This doesn't change my r1 conclusion (name the coupling explicitly rather
than assume "small lines ⇒ fine") — it changes which file the conclusion is about.

## 1. Disagreement map

| Item | Adversarial r1 | Mine r1 | Verdict | Reason |
|---|---|---|---|---|
| REQ-215 Design A/B fork | Primary = WeakMap payload + host-side allowlist; fallback = host ledger + `refusalRef`; explicitly asks panel to decide (§4.7) | Same fork, named Design A/B, undecided (risk #2) | **Converge on primary, with one placement amendment** | see §2, observability-correctness tie-break is mine to supply |
| WeakMap not WeakSet | Payload must ride the map; the object handed to script land is mutable | Not raised — my Design A only distrusted the *sender*, not the *object's mutability* | **Concede** | strictly stronger finding; a `catch(e){e.detail=…}` defeats any set-membership check |
| WeakMap placement | "module scope in the child" | — | **Amend** | `child-entry.ts` imports `guards.ts` (confirmed), not the reverse; homing the map in `guards.ts` needs no new import edge and keeps writer+reader in one module — see §2 |
| Allowlist duplication | Grows `ENGINE_REFUSAL_CODES` (guards.ts, inlined) to admit `PARAM_UNKNOWN`; separately wants the code→detail-keys table in `errors.ts` (host) | Not raised | **New finding, mine** | two independently-maintained sets answering "which codes are engine refusals" is exactly the K7 drift class already realized once in this codebase — needs a guard test, §2 |
| REQ-212 `Actor`/`idSource` | 4-field struct, `idSource: authenticated\|claimed\|none`, caught `bypassWithArg` taking the id from tool args | I only said "add a field, don't repurpose null" (risk #4), didn't find the `bypassWithArg` forgery vector | **Concede/integrate in full** | their evidence is the sharper, specific version of my general warning |
| REQ-213 `lastRunAt` via grouped query vs. column | Verified "no `DELETE FROM runs` anywhere" on disk, kills the denormalization case | Assumed nothing either way; deferred to synthesis | **Concede** | checked claim beats unchecked deference |
| REQ-216/K5 | All 4 `listRuns()` callers read; NO LIMIT there (would break boot/hydrate/GC), carve-out moves `listSummaries()` → paginated `list()` | Leaned toward "add a default LIMIT," named as a synthesis-owned ruling | **Concede** | I read the requirement's framing, not the call sites; their fix is at the correct layer and is itself a self-sustainability fix (see §5) |
| REQ-214 path derivation | Sibling-of-resolved-config-path + `--dry-run`/`RWE_START_CMD` seam | `dirname(RWE_CONFIG_PATH)` preferred, hash and `workRoot` as alternates, no test-seam proposal | **Adopt their seam; hold on exact path form** | seam is a clear win (§5); sibling-vs-hash is Gate 4's call, not a quality-dimensions question |
| REQ-211 three refusal cases | Case 3 (non-terminal run pinned to the version silently resumes on `release` via the `VERSION_NOT_FOUND` catch, `run.legacySubstitution` logged, caller never told) | Only flagged case 1 (channel), noted the false-hint consumability bug | **Concede in full, escalate in my own words** | this is the canonical instance of *my* dimension's own thesis — see §2 |
| K1/K2 ordering | K2 (redact, unmerged) lands first and separately; K1 unification takes the bound as a parameter | "Land K1+K2 in the same PR," didn't separate the bound risk | **Concede ordering** | "same PR" and "K2 as its own commit first" aren't actually in tension; the bound-as-parameter point is the one that matters and I missed it |
| §4.1 predicted fight (free-form detail bag, log levels, correlation IDs) | Predicted I'd push for the generic version | My r1 already declined correlation IDs and an OpenAPI surface explicitly | **No fight — confirm** | nothing to rebut; stating it removes it from round 3's list |

## 2. Observability

**REQ-215 — converging on the primary design, with the placement correction it needs.**
Both lenses independently found the same fork (mine as Design A/B, theirs as primary/fallback) —
worth naming, because two lenses converging on the same fork from different reasoning is stronger
evidence the fork is real than either alone. The tie-break my dimension can supply and theirs
couldn't fully state: **Design B / their fallback loses exact causality.** A host-side ledger keyed
by `callSeq` can only assert "the run died after refusal N was issued" — a script that catches the
`AGENT_OPT_RETIRED` throw and then fails later for an unrelated reason would attribute wrongly under
B, silently. That is exactly the "silent/opaque failure is a design defect" case my dimension exists
to catch, now pointed at the *diagnostic mechanism itself* rather than at the product. **Verdict:
primary design (WeakMap payload + host-side allowlist/redact/bound).** It also better serves
consumability (§4): the run-level `error.code` stays *exactly* attributable to the `agent()` call
that got refused, extending `refusalCode()`'s existing enum-membership contract (v25/REQ-120,
`BUDGET_EXCEEDED`) to a second code with the same causal precision, not a weaker one.

I concede the WeakMap-over-WeakSet finding outright — my Design A validated the *sender* (parent
collapses non-allowlisted codes on receipt) but not the *object*: since the error handed to script
land at `child-entry.ts:82` is an ordinary mutable `Error`, a set-membership check survives
`catch (e) { e.detail = {…}; throw e }` while a payload-carrying map does not, because the map never
consults the object's own (script-writable) fields.

**One placement amendment, checked against the actual import graph** (not adversarial's error, just
underspecified): `grep -n "^import"` on both files shows `child-entry.ts` does
`import { evaluateScript } from './guards.ts'` — a working value import — and `guards.ts` imports
nothing from `child-entry.ts` (confirmed no reverse edge). Adversarial's text says the WeakMap lives
in "module scope in the child" without saying which file; if read as *literally* `child-entry.ts`'s
module scope, `guards.ts` (which reads it at the crush-to-`SCRIPT_ERROR` site, ~322-335) would need
a new value-import edge from `guards.ts` back into `child-entry.ts` — backwards relative to the
existing, confirmed-working direction, and exactly the shape of cross-file value-import fragility
`guards.ts`'s own header comment (lines 7-13) already works around by inlining rather than importing.
**Home the WeakMap and its setter in `guards.ts` instead** (e.g. `export function markEngineRefusal
(err: Error, payload: {code:string; detail?:unknown}): void` + the map, both file-local): reader
(guards.ts:322-335) and writer share one module with zero new import edges, and `child-entry.ts`
populates it at its existing reject site (82) through the import direction that already works. Same
security property (module scope unreachable from the vm context, guards.ts builds that context
explicitly at 290-309), smaller diff.

**New finding: the allowlist itself is about to fork into two copies.** Adversarial's own design
correctly keeps two things in two different places for a real reason — `ENGINE_REFUSAL_CODES`
inlined in `guards.ts` (child-side; can't import from `errors.ts`, per the file's own documented
constraint) gates *which codes even get marked* for forwarding, while a `code → permitted detail
keys` table lives in `errors.ts` (host-side; authoritative validation, redaction, bound). That is
**one policy question, "which codes are engine refusals," answered by two independently-edited
constants.** This is the identical shape to REQ-216/K7 (two `GatewayClient` conformers computing
`attempts` differently until one drifted) — a divergence this codebase has already paid for once.
Concretely: adding a third code later (v37's Bash-jail work is flagged in adversarial's §"Cross-
iteration note" as sharing this exact boundary) is exactly the kind of two-site edit that silently
drifts when only one site gets touched. **Proposal:** a guard test, in the shape of K8's
`compose-config-v2-wiring.test.ts` precedent (this repo's own documented pattern for a class of
silent-forward bug), asserting `guards.ts`'s inlined `ENGINE_REFUSAL_CODES` is a subset of (ideally
equal to) the code set `errors.ts`'s host-side table permits. Cheap — a handful of lines — and it is
the one piece neither r1 proposal named.

**REQ-211 case 3 — conceding in full, and it is the sharpest instance of my own dimension's claim
in this round.** Adversarial's evidence (`run-manager.ts:1049-1060`: a resumed run whose pinned
version was just deleted hits the `VERSION_NOT_FOUND` **catch**, silently re-resolves through
`release`, and runs different code) is exactly the failure my r1's framing names in the abstract
("A silent/opaque failure is a design defect — design the observable seam") without having found
the concrete instance. My r1 only reached the *interface-honesty* half of REQ-211 (§3 below); I did
not read `run-manager.ts` closely enough to find the resume path. The `run.legacySubstitution` log
line existing does not discharge this — it is written where the caller cannot see it, at the moment
the substitution happens, not surfaced through any channel a caller watches. I fully endorse
treating this as a third refusal case (not a v37 deferral) and endorse the ADR-014 amendment
obligation — a silently-diverging ADR is precisely what stops a ledger from being trustworthy, which
is an observability claim about the *documentation*, not just the *runtime*.

**REQ-213/REQ-212 sink — not actually a conflict with my r1, restated precisely.** My r1 said "reuse
the capture seam (redact-at-capture)"; adversarial's `EventSink` is the emission point. These compose
rather than compete: `redact()` at capture, `sink()` at emission, same ordering rule the codebase
already learned the hard way (redact-before-truncation, INV-V26-5, cited in both r1 documents
independently — another point of unprompted convergence worth naming). One sink, one redaction
point, `catalog.publish`'s existing bare `console.log` folded onto it so the product ends with one
log path rather than two, per adversarial's simplicity tie-break. I add only the size axis, in §5.

## 3. Replaceability

**`GatewayClient`/K7 — unchanged from r1, and adversarial's K6/K7 treatment (§2.6 of their doc)
lands in the same place:** one `attempts` formula homed on the port module, both conformers call it,
the missing guide sentence ships in the same change. No disagreement here; noting only because the
allowlist-duplication finding above (§2) is the *same failure shape* recurring in REQ-215's new
surface, which is why I'm treating it as a genuine architectural pattern for this codebase rather
than a one-off: **whenever one policy answer needs to exist in two places for a documented technical
reason (can't import across a boundary), that boundary needs its own drift guard, not just a
one-time correct implementation.** K8's wiring-scanner precedent, this round's new allowlist-subset
test, and K7's shared `attempts()` helper are three instances of the same rule.

**REQ-215's wire as an additive contract — unchanged from r1, and consistent with adversarial's
design.** Adding a `detail` field via the WeakMap-fed message stays additive (an optional field on
the existing `{code,message}`/`AgentThrowMsg` shape), following the v26 `spent`-field precedent I
cited in r1. Nothing in adversarial's proposal reshapes the envelope; confirmed compatible.

**REQ-212's `Actor` struct, replaceability angle.** Adversarial's resolution deliberately keeps the
struct changing *only* the facade→commit path (§2.1 of their doc: "no role engine inside the
catalog... it is told `bypass: true`, it does not infer it"). That is the right decoupling shape for
this dimension: the catalog module stays ignorant of *why* a caller bypasses, only *that* it does —
so a future auth mechanism (a third `idSource` value, say `'delegated'`) is a value addition, not a
catalog-side rewrite. I have nothing to add here beyond endorsing the shape; it is their finding.

## 4. Consumability

**REQ-211's false error hint — unchanged, adversarial's fix text matches mine exactly.** Both r1
documents independently landed on rewriting `VERSION_CEILING_EXCEEDED`'s hint to name the actual call
shape (`workflow_deregister({name, version})`) rather than a capability that doesn't exist. No
disagreement; the interface must not advertise a capability the tool lacks, whether that's an error
hint (my r1) or a silent version substitution the caller is never told about (their case 3, §2
above) — same principle, two altitudes of the same tool.

**REQ-215, extended.** With the primary design adopted (§2), the consumability claim strengthens
rather than changes: a workflow author calling `agent()` gets the *same* `run_result.error.code`
mechanism for a second refusal class, with detail keys that are per-code and host-validated rather
than free-form — this is a better answer to my own r1 concern ("reuse `refusalCode()`'s enum-
membership shape... so callers learn one mechanism, not two") than my own Design A/B framing
supplied, because the host-side `code → permitted detail keys` table (adversarial §2.4 step 2) makes
the *shape* of each refusal's detail typed and closed, not just the top-level code.

**REQ-213's `lastRunAt`/`null`-for-never-run sentinel — unchanged, converged.** Both documents landed
on the REQ-206 `null`-over-ambiguous-default precedent independently. No disagreement.

## 5. Self-sustainability

**`.rwe.log` growth — the corrected version of my r1 rotation point (§0).** REQ-212 makes this file
PII-bearing (adversarial R-7, which I endorse); REQ-213 adds a second new line *kind* (register/
terminal) onto the same never-rotated, `nohup`-redirected stream that already carries
`catalog.publish` and whatever else prints to stdout. Adversarial's R-7 mitigation is 0600 + a
DEPLOY.md note — correct for the *confidentiality* half, silent on the *size* half. This is the same
"don't let 'the new lines are small so it's fine' pass without being said out loud" claim from my r1,
now anchored to the right file: I am not asking for rotation to be built this round (no requirement
asks for it, and REQ-214 is already carrying a 3-line testability seam as its one accepted scope
addition — a second unscoped addition in the same round risks exactly the "no requirement asked for
it" problem this project's own trade-off discipline refuses elsewhere). I am asking that the
coupling be **named** in the architecture doc as a REQ-214/REQ-212/REQ-213-adjacent, explicitly-filed
debt item (parallel to the existing `journal.jsonl` D11 entry at `02-architecture.md:4659`, which is
a *different* file and should not be conflated with this one) — a stated growth bound or an explicit
"still tolerable because X" is the deliverable, not code.

**REQ-214's `--dry-run`/`RWE_START_CMD` seam — adopted, and it is itself a self-sustainability
argument, not merely testability.** A shell script with no seam is a mechanism that "requires MORE
manual bookkeeping" than the workaround it replaces, exactly the graceful-degradation failure my r1
named — the difference adversarial adds is the concrete fix (3-line override), which converts "Gate
7.5 might catch it" (demonstrably didn't, in v34, per their evidence) into a fast, hermetic,
always-run regression. I adopt this over my r1's silence on testability entirely. I hold, not
concede or rebut, on **which** derived path (`dirname(RWE_CONFIG_PATH)` sibling vs. a hash suffix):
both satisfy the acceptance criterion, this is a debuggability-vs-implementation-simplicity call
Gate 3/4 should make with the config schema in front of it, and neither lens has grounds to force it
from an architecture-round proposal.

**Ordering: REQ-214 before REQ-213 — adopted, and it is an observability argument I should have made
myself.** My r1 didn't sequence these two at all. Adversarial's reasoning (if the PID/log path is
still repo-global when REQ-213's structured lines start flowing, two instances interleave into one
file and the *new* observability is born already corrupted) is correct and is, again, my own
dimension's thesis applied somewhere I hadn't looked: an observable seam built on an already-broken
foundation is worse than no seam, because it looks trustworthy. Full concession, adopted into this
round's ordering.

**REQ-216/K5 — concede cleanly; this is itself the self-sustainability fix for that item.** I leaned
toward a default LIMIT on `listRuns()` in r1 without reading all four call sites. Adversarial read
boot recovery (server.ts:815), `hydrateAll` (sqlite-run-store.ts:444), and the workspace-reclaim
sweep (server.ts:1037) — a LIMIT there is "a data-loss bug sold as a scalability fix," which is
precisely the wrong-mechanism failure my dimension's brief warns against (a fix that looks like
self-healing but silently stops recovering/reclaiming beyond a cutoff). Their carve-out —
`listSummaries()` moved onto the already-paginated `list()` (limit 50/cap 500) while the four sweep
callers keep unbounded `listRuns()` — is the correct-altitude fix: bound the *per-request, human-
facing* path, leave the *sweep* paths (which exist precisely to converge the system back to a
consistent state without a human, the literal definition of self-sustainability here) unbounded on
purpose. I withdraw my r1 lean and adopt theirs.

**Agent-altitude memory metabolism — unchanged from r1.** The catalog's `lastRunAt`/purpose fields
give a future GC the *observability* it would need; they are not themselves a closed loop. Nothing in
adversarial's r1 touches this framing; it stands.

## 6. Remaining disagreements (should be near-empty)

1. **REQ-214's exact derived-path form** (sibling-of-config-path vs. hash suffix vs. inside
   `workRoot`) — genuinely open, correctly left to Gate 3/4 by both lenses; not a quality-dimensions
   question.
2. **The allowlist-duplication guard test (§2, new this round)** — not disputed by anything in
   adversarial's r1 (it predates my reading of their design), but unconfirmed by them either; flagged
   for round 3 or direct synthesis pickup, since it's a small, concrete addition rather than a fork.

Everything else that looked like a fork in round 1 (REQ-215 Design A/B vs. primary/fallback, REQ-212
signature-vs-null, REQ-213 column-vs-query, REQ-216/K5's ruling, REQ-214's ordering and seam) is
converged above, mostly by conceding to adversarial's more heavily-verified r1 where our conclusions
differed, plus two findings this round contributes back: the WeakMap placement correction and the
allowlist two-copy drift risk.
