---
stage: design
lens: adversarial (a) interface-contract / (b) boundary-error / (c) testability — Karpathy simplicity-first as tie-breaker
iteration: v27 — Round v27b delta (impactIds REQ-133 / REQ-134 / REQ-140)
round: 2 (debate — responses to quality-dimensions.r1, final position, remaining disagreements)
read_this_round: .panel/design/adversarial.r1.md (mine, whole), .panel/design/quality-dimensions.r1.md (whole)
verified_this_round (file:line, re-read at the working tree, not recalled): src/server.ts :328-340, :344-356, :436-444, :488-552 (init :519, branch :520, inner catch :504-506, derivation catch :540-542), :576-590, :814-824, :1060-1075; `grep -n authEnabled src/server.ts` → :334 :350 :520 :819; src/dashboard.ts :240-255, :320-352, :355-366, :415-445; src/skeleton-graph.ts :32-46; src/types.ts :322, :345-363 (`legacySubstitution?: {pinned; resolved}` :351, `scriptVersion: string` :362); src/run-manager.ts :890-912; src/workflow-view.ts :185-210 (`owner: full.owner` :199); tests/integration/dashboard-disclosure.test.ts :28-45; tests/fixtures/dashboard-wire.ts :70-115; tests/integration/dag-masking-auth.test.ts :1-140; tests/helpers/workflow-fixtures.ts :133-143, :284-312; tests/unit/error-catalog.test.ts :48; 04-design.md DES-196 :6745, DES-197 :6753, DES-198 :6761, DES-201 :6785
---

# Adversarial — v27b DESIGN r2: four concessions, three holds with new evidence, and five gaps neither r1 closed

## Summary

QD's r1 is stronger than my r1 predicted on three counts, and I concede those outright: the **reused-pin
blind spot (S-4)** is a testability precondition for *my own* B-2 arm-(ii) test, not out-of-closure trivia;
the **parity stabilization** must be a pre-dispatch precondition, not my poll (my poll was wrong, and wrong in
the exact direction my own §3 refused); and the **`dagWarning()` formatter** falls to my own C-3 symmetry
argument. QD's **C-2 cohort transition** is the best boundary finding in either file and it is not mine.

Three of my r1 positions survive with evidence QD did not have, all read this session:

1. **`expected` is not optional, and QD's new justification for keeping it is false at the working tree.**
   `server.ts:519` already declares `let expectedGraph: ExpectedGraph = { lanes: [], slots: [], edges: [] }`
   — non-optional, initialized unconditionally, *today, before the reversal*. The derivation catch
   (`:540-542`) leaves that literal in place, so "derivation failed" reaches `deriveLanes` as the **empty
   graph**, never as `undefined`.
2. **`pinned=` — concede the key name, rebut the value.** `types.ts:351` already defines
   `legacySubstitution?: { pinned: string; resolved: string }` and `run-manager.ts:907-909` already journals
   `run.legacySubstitution: {runId, name, pinned, resolved}`. `pinned` therefore already *means* the run's
   original pin. ARCH-130 (ii) would put the **requested** version under that same key. That breaks QD's own
   O-5 correlation principle in the one case it exists for.
3. **The describe half of the parity oracle fails on its first run as QD wrote it.** The describe projection
   carries `owner: full.owner` (`workflow-view.ts:199`); in this harness the auth server registers through a
   bearer as `it092-owner@example.com` and the open server registers anonymously.

And five gaps neither r1 closed: `current` flakes the parity we are both now conceding to; A-4's label is
wrong for a multi-label slot; arm (iv)'s production input is the empty graph; the formatter's detail must be
typed per token or QD-Δ-D6 stays a runtime grep; and QD's inert-cell detection rule greys the trigger.

**Headline:** converged on the formatter, the parity form, the reused-pin recipe, the cohort transition and
the withdrawal of C-4; still disputed: `expected`'s optionality (I hold, with the route's own initializer as
evidence), `pinned=`'s value (converged on a third form better than either r1), the bare-vs-`k=v` detail
grammar, and whether the predicted cell gets a label at all.

---

## 1. Verdict table — every item where the two r1s touch

| # | Item | my r1 | QD r1 | **r2** | one-line reason |
|---|---|---|---|---|---|
| D1 | `expected: ExpectedGraph \| undefined` | A-1 non-optional | R-2 optional = "derivation failed" | **HOLD (rebut reason, keep intent)** | `:519` is already non-optional and already unconditional; the catch leaves the empty literal, so `undefined` is a state the route cannot produce |
| D2 | FALLBACK detail's first key | A-6 `requested=` | O-2 `pinned=<what (i) asked for>` | **CONCEDE name, REBUT value** | `pinned` already means the run's pin (`types.ts:351`); set it to `view.scriptVersion` and both surfaces agree |
| D3 | `dagWarning()` formatter in `dashboard.ts` | §6 "machinery" | O-1 | **CONCEDE** (+ typed overloads) | my own C-3 says the parse half must be pure and unit-testable; the format half is the same argument |
| D4 | `PREDICTED_OVERLAY_UNAVAILABLE` detail | B-3 `reason=<token>` | O-2 bare token | **HOLD (low stakes)** | uniform `k=v` = one parse rule, one formatter shape, no union return type |
| D5 | Parity stabilization | C-2 poll until both live | S-1 precondition, no live record | **CONCEDE** (+ `current` exclusion) | my poll imports a random `agentId` into an exclusion-form comparison — the weakening §3 refused |
| D6 | Describe parity scope | C-2.3 `phases` only | S-1 whole payload over HTTP | **HOLD** | `owner: full.owner` (`workflow-view.ts:199`) differs by deployment in this harness |
| D7 | Predicted cell `label` | A-4 add it | *(silent)* | **HOLD + complete** | QD's O-7 greys the cell; without a label the operator gets a grey box reading `agent` |
| D8 | Client's inert-cell test | — | C-4 `agentId === undefined` | **REBUT (one word)** | the trigger cell has no `agentId` either (`dashboard.ts:352`) |
| D9 | The `:350` comment | keep (implicit) | W-4 delete | **REBUT (amend)** | it explains why `describe` masks nothing — a claim the reversal makes *more* true |
| D10 | Reused-pin blind spot | §6 "out of closure" | S-4 | **CONCEDE in full** | it is the precondition that makes *my* arm-(ii) test non-vacuous |
| D11 | Producer table / no injection seam | B-2 sites only | O-3 / O-4 | **CONCEDE, endorse** | O-3 completes B-2: which site pushes × which producer reaches it |
| D12 | Cohort transition (warning vanishes after resume) | — | C-2 | **CONCEDE, endorse** | verified at `run-manager.ts:898-908`; strongest boundary row in either file |
| D13 | `laneUntitled` string key | — | C-6 | **CONCEDE** | `title: null` is already on the wire (`dashboard-wire.ts:86`) |
| D14 | `parseDagWarning` as its own export | C-3 one export | O-1 two exports | **CONCEDE** (hold arg order) | `ui/run.js` needs the TOKEN for O-7's greying, not the rendered text; `warningText(lang, raw)` matches DES-201's `t(lang, key)` |
| D15 | Live key-set assertion in IT-168 | C-1 | *(silent)* | **HOLD** | parity compares two servers; a key added to the route appears on both and passes |
| D16 | Fixture warning literals | C-6 rename only | O-1 literals into `DAG_PAYLOAD` | **INTEGRATE, one correction** | that literal is the DISCLOSURE_TABLE's `ok` row; an `ok` DAG has `warnings: []` |
| D17 | Journal `reason` vocabulary | B-3 +`internal` | O-5 two members | **HOLD `internal`** | both pre-existing catches emit the same event and have no warning |

**Converged with no argument** (stated once, not re-derived): `current`'s seven-member table stands (A-2 =
R-2) and ARCH-126's one clause is corrected, not DES-196; the four deletions and their `tsc` safety (B-1 =
R-4) modulo D9; no new config key (R-5); the resolve chain stays three inline lines, no helper (R-3 = my
Karpathy); `__skel_` stays on the wire (A-5) and engine tests may key on it (C-4); IT-092 re-traced as a
**green** REQ-100 guard with a body-literal sentinel on `await res.text()` — adopt QD's `IT092_SENTINEL`
constant (C-5 = S-2); UT-238 gains the observed-longer-than-expected row (B-5 = S-3 (iii)); the memo and the
journal dedupe are **documented as shapes, not built** (my risk 5 = S-5/O-5); VAL-199's auth-ON Chromium case
with the `mintBearer` trap named + VAL-204's VAL-side p95 (C-2.3 = S-5); **DES-197's C-4 withdrawal (W-1) is
uncontested** — and it deletes, rather than argues down, the `composeConfig` forwarding hazard my r1 would
otherwise have had to fight.

---

## 2. The holds, with the evidence QD did not have

### D1 — `deriveLanes(phases: PhaseView[], expected: ExpectedGraph, opts: { status: RunStatus })`

QD's R-2 keeps `| undefined` but replaces its *reason*: no longer "the auth branch", now "`undefined` means
the derivation failed, and it is the only reason." Both readings die on the same three lines:

```
src/server.ts:519   let expectedGraph: ExpectedGraph = { lanes: [], slots: [], edges: [] };
src/server.ts:520   if (!authEnabled) {                       ← the deletion
src/server.ts:540-542   } catch { /* degrades to an empty predicted overlay rather than a 500 */ }
```

The variable is **already** typed `ExpectedGraph`, **already** initialized unconditionally, and the
derivation catch **already** leaves that literal in place. So DES-196's stated justification ("a non-optional
signature forces a fake empty object at the call site") is false at the working tree today, before the
reversal; and R-2's replacement justification would have to be newly *manufactured* by assigning `undefined`
in the catch — a second encoding of a state this delta already encodes as **empty graph + `PREDICTED_OVERLAY_UNAVAILABLE: reason=derivation-failed`**. Karpathy: one encoding.

What I concede is QD's real ask, and it is the important half: the DES-196 sentence must be **rewritten, not
merely stripped of `masked`**, or the next reader reconstructs the auth reading from the type alone. The
replacement sentence: *`expected` is always a value; the empty graph IS the derivation-failure input, and the
failure is reported on the wire by the warning, never by the parameter's absence.*

**Consequence for UT-238 (this is the gap neither r1 stated).** QD's row (ii) (`expected: undefined` →
observed-only, never throws) is testing a shape production cannot produce. It splits into two rows:

- **production row:** `expected = { lanes: [], slots: [], edges: [] }` → lanes are the observed phases only.
  This is arm (iv)'s real input and it is what O-4's "defensive, no injection seam" actually covers.
- **robustness row:** `undefined` behind `@ts-expect-error` — house precedent exists
  (`tests/unit/error-catalog.test.ts:48`). The body stays garbage-tolerant to match `layoutGraph`'s own guard
  (`Array.isArray(expected?.lanes)`, `dashboard.ts:346`); tolerance is a body property, not a type property.

### D2 — `pinned` keeps its name and gets the run's actual pin

New evidence, both in the tree:

```
src/types.ts:351        legacySubstitution?: { pinned: string; resolved: string };
src/run-manager.ts:907        const sub = { pinned: view.scriptVersion, resolved: registered.version };
src/run-manager.ts:909        console.log(`run.legacySubstitution: ${JSON.stringify({ runId, name: spec.name, ...sub })}`);
```

`pinned` already means *the run's original pin* in a durable field and in a journal line. ARCH-130 (ii) emits
the warning for whatever arm (i) **asked for** — `legacySubstitution?.resolved ?? view.scriptVersion` — so
under QD's grammar a run pinned `v3` that already substituted to `v2`, and whose `v2` was then purged too,
would journal `pinned=v3` and serve `pinned=v2`. An operator grepping `pinned=v2` across the journal and the
payload — exactly the correlation O-5 exists to buy — gets two different facts under one key.

**Converged form, better than either r1:**

> `PREDICTED_FROM_FALLBACK_VERSION: pinned=<view.scriptVersion> resolved=<the version actually derived from>`

True in every arm, identical in meaning to the durable record and the journal line, and it retires my
`requested=` as a concept nobody needs (the intermediate request is mechanism, not a fact a consumer acts
on). `view.scriptVersion` is `string`, not `string | undefined` (`types.ts:362`), so the grammar's
`[A-Za-z0-9._-]+` is enforceable. **QD's C-1 contract sentence and the fixture literal `pinned=v3 resolved=v2`
stand verbatim** — only the route's argument changes.

### D6 — the describe parity must be scoped to `phases`

`projectWorkflowDescribe` returns `owner: full.owner` (`workflow-view.ts:199`). In this very harness the auth
server registers through `mintBearer` as `it092-owner@example.com` (`dag-masking-auth.test.ts:76-84`) and the
open server registers with no principal. A whole-payload describe parity therefore **fails on its first run**,
and the natural repair is to add `owner` to the shared exclusion list — which silently weakens the DAG half
too. Scope: `phases` exactly. (`triggers` and `resolvedBy` are equal here but are not the point; the rule is
that a describe payload legitimately differs by deployment and a DAG payload does not.)

### D15 — the live key-set assertion, and why parity does not replace it

`dashboard-disclosure.test.ts:36`'s own `it()` title reads "**against the fixture itself**", and
`DagPayloadFixture` is a local interface in the fixture file (`dashboard-wire.ts:73-84`), so `tsc` cannot see
a server-side addition. QD's parity compares the **two servers**: a new key added to the route appears on
both and parity is green. Disclosure budget ≠ deployment parity; they fail on different mistakes. IT-168
already boots both servers and reads both DAG payloads — feed both through
`keys ⊆ ALLOWED_DAG_KEYS && REQUIRED_DAG_KEYS ⊆ keys`, importing the two tuples. ~6 lines, no new file.

### D17 — the journal's `reason` domain is the warning enum ∪ `{internal}`

DES-198 (4) routes **both** pre-existing catches through `dashboard_api_degraded`, and neither has a warning:
`server.ts:582-585` currently surfaces `(err as Error).message`, `:1067-1071` `{degraded:'internal dashboard
error'}`. So O-5's rule ("journal `reason` = warning detail, verbatim") is only *total* when stated as:

> `reason ∈ { catalog-resolve-failed, derivation-failed, internal }`. The first two equal the warning's
> `reason=` value byte-for-byte; `internal` is the one member that has no warning **by construction**, and the
> free-form message rides a separate `detail` key that is never grepped.

House precedent is exact and already in the same file: `diagram_render_failed` emits
`{ reason: out.reason, detail: out.detail }` (`server.ts:440`).

---

## 3. Five gaps neither r1 closed

**G-1 — `current` flakes the parity we both now endorse.** QD's precondition (`cells.every(c => c.agentId ===
undefined)`) guarantees no live record. It does **not** guarantee both runs entered the same number of phases:
`phase('one')` fires before any `agent()`, so `current` can legitimately be `null` on one server and `0` on
the other — and `current` is not in QD's exclusion list. No poll fixes this (reading `phases.length` off
`/api/runs/:id` to gate it just moves the race). Therefore:

> `const PARITY_EXCLUDED = ['terminalAt', 'current'] as const;` — with a comment stating that `current` is
> excluded for **timing**, not disclosure, and is covered instead by UT-238's 14-case table and the positive
> anchor's `current ∈ {null, 0}`; `terminalAt` is excluded for timing too. Adding any member is a decision
> that must name which of the two reasons it is.

`runId` comes **off** my r1's exclusion list: QD is right that the list is written against the fixture key
tuple so a new key is compared by default, and `runId` is not a key of the DAG payload
(`ALLOWED_DAG_KEYS`, `dashboard-wire.ts:88`). This is the honest residue of my §3 (b)-vs-(c) tension: two
timing exclusions, named as such, and nothing weakened for disclosure.

**G-2 — A-4's label is wrong for a multi-label slot.** `layoutGraph` places **one** `__skel_` cell per SLOT
(`dashboard.ts:422-425`) and suppresses it when any covering agent matches **any** of `s.labels`
(`skeleton-graph.ts:32-38`: `labels: string[]`, `kind: 'single' | 'parallel' | 'alt'`). So `labels[0]` — my
r1's wording — labels a `parallel([a,b,c])` node `a`. Rule:

> `label = s.labels.length === 0 ? undefined : s.labels.join(s.kind === 'alt' ? ' | ' : ', ')`

**absent**, never `''`, for a label-less slot, or `c.label || c.kind` renders the literal `agent` again
(`dashboard-page.ts:581`). One ternary buys the honest reading for `alt` (only one of them runs). Blast radius
unchanged: the 12 `__skel_` assertions in `tests/` are all on ids or counts, none on `label`. The doc comment
at `dashboard.ts:250` ("never on a predicted/inert `__skel_*` one") is about `tokens`/`costUSD` and must gain
one clause so the next reader does not read it as covering `label` too.

**G-3 — type the formatter's detail per token (the price of my D3 concession).**
`dagWarning(token, detail: Record<string, string>)` lets `catalog_resolve_failed` through — QD-Δ-D6, caught
only by a runtime grep. Two overloads, ~4 lines, make it a `tsc --noEmit` error and fix key order for the
byte-equality assertion without depending on insertion order:

```ts
export function dagWarning(t: 'PREDICTED_OVERLAY_UNAVAILABLE', d: { reason: 'catalog-resolve-failed' | 'derivation-failed' }): string;
export function dagWarning(t: 'PREDICTED_FROM_FALLBACK_VERSION', d: { pinned: string; resolved: string }): string;
```

**And QD's cheap guard has to go or change.** `grep -c PREDICTED_ src/server.ts → 0` is unsatisfiable once the
route imports a const object whose property names echo the token, and is theatre if it passes. Grep the
**quoted literal** (`'PREDICTED_`) or drop the guard entirely — the lock is the formatter plus IT-169's
byte-equality against the fixture, not the grep.

**G-4 — arm (iv)'s production input is the empty graph** (folded into D1 above; named separately because it is
what O-4's "defensive, no seam" claim actually rests on: the catch at `:540-542` stays, and the pure coverage
is `deriveLanes(phases, EMPTY_GRAPH, …)`, not `deriveLanes(phases, undefined, …)`).

**G-5 — QD's inert-cell detection greys the trigger.** `cells.push({ id: '__trigger__', kind: 'trigger', …,
label: opts?.startedByType ?? 'trigger' })` (`dashboard.ts:352`) carries no `agentId`, so C-4's rule
(`agentId === undefined`) classifies it as predicted. The client rule is
**`kind === 'agent' && agentId === undefined`**. QD's *test-side* precondition (`cells.every(c => c.agentId ===
undefined)`) is unaffected and correct as written — it means "no live record anywhere", which is what it says.

---

## 4. Final position — the delta as I would ship it

Unchanged from my r1 except where §1–§3 move it. The full row-by-row edit map is QD's (their "Ledger edit
map"); these are the **deltas to it**, so the synthesizer applies one list, not two.

| Row | delta to QD's edit map |
|---|---|
| DES-196 | signature `expected: ExpectedGraph` (**non-optional**) with the rewritten reason (D1); `lanes` DENSE and ordered — `lanes[k].index === k`, observed first, unreached expected appended in `index` order, a non-contiguous `expected.lanes` re-indexed on append (A-3, one UT case); `current` clamped by nothing (B-5: it may legally exceed the predicted lane count on a loop-body `phase()`); the predicted cell's `label` per G-2 |
| DES-197 | + G-5's one-word correction to the client detection rule |
| DES-198 | `pinned=<view.scriptVersion>` (D2); uniform `k=v` detail incl. `reason=` (D4); the four pushes **at their sites** — arm (iii) inside the inner catch at `:504-506`, because `parseWorkflowSkeleton('')` does not throw and a downstream push is silently never reached (B-2, unchanged and still the single most likely silent failure); `reason ∈ {…, internal}` (D17); the `:350` comment **amended, not deleted** (D9) |
| DES-201 | `dagWarning` overloads (G-3); `warningText(lang, raw)` arg order per `t(lang, key)`; QD's key names conceded |
| TASK-197 / fixture | QD's rename (= my C-6); the three warning literals as their own export (`DAG_WARNING_SAMPLES` + `DAG_WARNING_TOKENS`), **not** inside `DAG_PAYLOAD` — that literal is DISCLOSURE_TABLE's `ok` row (`dashboard-wire.ts:112`) and an `ok` DAG carries `warnings: []` (D16). Under D4 the UNAVAILABLE sample literal reads `PREDICTED_OVERLAY_UNAVAILABLE: reason=catalog-resolve-failed` |
| IT-168 | + the live key-set assertion on both payloads (D15); `PARITY_EXCLUDED = ['terminalAt','current']` with the two named reasons (G-1); describe parity scoped to `phases` (D6); QD’s precondition and positive anchor as written — W-6 independently re-verified this round: `startedBy.id` is optional (`types.ts:6-9`) and `run_start` passes the literal `{ type: 'client' }` with no id (`mcp-facade.ts:590`), so no bearer asymmetry reaches the compared payload |
| UT-238 | QD's 7×2 + join rows, with row (ii) split into the empty-graph production row and the `@ts-expect-error` robustness row (D1); + A-3's density case. **The 14-case status table survives intact and the `as { masked: boolean; status: RunStatus }` cast at `dashboard-derive-lanes.test.ts:34` disappears — its disappearance is the evidence the signature was reconciled literally rather than re-cast** (C-4, unchanged: a 28 → 14 shrink is the shape of an accidental weakening and Gate 8 must be able to diff intent) |

**Order.** QD's §5 and my §4 agree and compose: TASK-197 (fixture) before every reader; TASK-201 → TASK-203 →
TASK-202; TASK-206 before TASK-208/210. Two additions from my r1 that QD's list does not carry: **TASK-206 is
absent from the architecture's own v27b housekeeping list** and will land unowned if the synthesizer copies
that list; and **TASK-201's `label` must land before VAL-199/204 are judged**, or the Chromium oracle
photographs grey boxes reading `agent` and that screenshot becomes the accepted baseline.

---

## 5. Remaining disagreements (for the synthesizer to rule)

1. **D1 — `expected`'s optionality.** I hold non-optional on the route's own initializer. If the synthesizer
   prefers QD's optional, then the route must be *changed* to assign `undefined` in the `:540-542` catch —
   otherwise the type advertises a state nothing produces, and UT-238's production row for arm (iv) is testing
   the wrong input either way. **Rule it explicitly; do not let it be settled by whoever edits DES-196 last.**
2. **D4 — bare reason vs `reason=<token>`.** Low stakes, but it must be decided *before* Gate 5 writes
   `parseDagWarning`. If QD's bare form wins, the parse must **normalize** to `{ reason: <detail> }` so the
   client still sees one shape — say so in DES-201 rather than leaving the client to branch.
3. **D7 — whether the predicted cell gets a label at all.** If it is ruled outside the REQ-133/134/140 impact
   set, **REQ-134's 「5 lane、9 agent 一眼看出卡在哪」 must be amended in the same pass** to say the unreached
   nodes are unlabelled. Shipping it silently is how Gate 7.5 finds it with a screenshot. QD's O-7 (greying the
   inert cells) makes the consequence more visible, not less.
4. **D9 — `:350` delete vs amend.** Deleting it removes the only place the describe route's masking posture is
   explained; the reversal makes its claim *more* true. Amend.
5. **Recorded, not disputed:** REQ-105's `[PARTIALLY SUPERSEDED v27b]` marker (`01-requirements.md:1070`) is
   orchestrator housekeeping — both r1s name it, neither gate owns it, and Gate 8 verifies REQs against code.
   It fails by construction if nobody does it.

## 6. Karpathy check on the converged delta

Against my r1's ledger: **−1 concept** (`requested` retired in favour of the key that already exists),
**−1 mechanism** (my parity poll deleted in favour of a two-line precondition), **+1 export I argued against
and lost** (`dagWarning`, in a file already being edited, with overloads that make an enum a compile error),
**+2 exclusion members named with their reasons**, **+1 ternary** for the multi-label slot. Still: no new
module, no new file, no new route, no new config key, no cache, no new test file, no rename of any file the
trace chain cites. Every item above is a deletion, a line in a file the delta already edits, or a sentence
that stops an implementer guessing.
