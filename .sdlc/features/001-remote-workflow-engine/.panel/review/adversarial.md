# Gate 8 RE-REVIEW — Adversarial architecture group (security · scalability · testability)

- **Iteration:** v23, **post-send-back re-review** (round 1 of this file, written at `d294880`, is
  superseded input — its 7 findings are re-checked in §3 below).
- **Baseline compared:** the **amended** Gate 2 architecture (Gate 2 re-run `d294880`: ARCH-051,
  ARCH-077..086, ADR-016/017/021/022, ARCH-079 inv 2/4/5/6/8 amended + **new inv 9/10/11**, ADJ-A1,
  V-D, N-1, A5, A10) vs. the implementation at the Gate 7.5 round-4 tree (`41e6382`).
- **Scope:** the files on each v23 IMPL's `files:` line in `06-impl-log.md` (IMPL-159..176), plus the
  module-boundary files they directly reference (`workflow-meta.ts`, `params/contract.ts`,
  `gateway/client.ts`). No full-tree scan.
- **Method:** Gate 2's own handoff instruction — *"Gate 8 must re-verify each doc-only amendment **by
  grep**, not by reading this note"* — applied to code as well. Every claim is anchored at
  `file:line` read this pass. **Seven** ledger-honesty gaps are recorded in this iteration, so no
  ARCH/DES/IMPL/journal sentence was accepted as evidence of code behaviour.
- **Verdict:** `consistent: NO` — **6 deviations** (1 HIGH, 2 MED, 3 LOW). All three round-1 HIGHs
  (A1/A2/A3) are **closed or substantially closed**; the residue is one HIGH that is the *unfixed
  half* of A3, plus the observability field A3's own amendment was paid for with.

---

## 1. Findings

### R-1 — HIGH — inv 2's `try/catch/finally` wraps only the `scriptPromise` await, not the scheduled closure; every other throw in the closure still leaks the concurrency-1 slot and rejects unhandled

- **Violates:** ARCH-079 **inv 2** (as amended, A3/N-1); ARCH-079 **inv 5** (the amended
  "exceptional exit of inv 2's closure" journal line); ARCH-079 **inv 8** (as amended, V-C);
  ADR-017's "`pending` always settles", which inv 11 leans on by name.
- **Lens:** scalability/consistency (primary) → security (availability of the whole engine) →
  testability (the oracle drifted in the *matching* way, which is why this passed four gates).

**What the architecture ordered** (`02-architecture.md:1397`, inv 2 amendment, verbatim):

> the `try { … } catch { settle + journal } finally { release + drain }` **wraps the scheduled
> closure**, so the closure never rejects and every scheduler — production `setImmediate` (`:127`),
> the tests' `runInline`, any future one — inherits termination by construction; the `.catch()` at
> the `setImmediate` site is belt-and-braces, never the mechanism.

**What shipped** — `src/graph-analyzer.ts:255-264`:

```ts
const job = async (): Promise<void> => {
  let script: string;
  try {
    script = await scriptPromise;
  } catch {
    this._release(key);
    return;
  }
  await this._runJob(name, version, script, principal, key, priorRow);   // :263 — OUTSIDE the try
};
```

Three separate divergences from the ordered shape, all readable in those ten lines:

1. **The wrap covers one statement, not the closure.** `await this._runJob(…)` at `:263` sits
   outside the `try`. There is no `finally`.
2. **The `catch` does not `settle`, and does not `journal`.** It calls `_release(key)` only.
3. **The belt-and-braces `.catch()` was not added either** — `:127` is still
   `this._schedule = deps.schedule ?? ((job) => { setImmediate(() => { void job(); }); });`.
   Neither the mechanism nor the backstop exists.

**Consequences, from source read this pass:**

- **The slot still leaks on every unguarded throw.** `_release(key)` is reached only at
  `_runJob:388`. Verified throw sites inside `_runJob` and outside the `try`:
  `getTriggerBindings(name, this._ports)` at `:355` (four real store reads —
  `SqliteSchedulerPort.listByWorkflow`, `ContinuationStore.listPendingByWorkflow`,
  `SqliteRunStore.getWorkflowName`, webhooks), and `putDiagramResult` at `:377` / `:380` / `:385`,
  which `IMPL-160` documents as running `.immediate()` inside a transaction. Any of those throwing
  leaves `_runningCount` incremented and `_pendingKeys` holding the key **forever**, so every
  later registration settles `QUEUE_FULL` — and inv 2's own amendment names exactly this failure
  mode as undetectable: *"a wedged slot reports itself with the same string, so a lost release is
  indistinguishable from correct operation at the surface."*
  *(Checked and excluded from the evidence: `parseWorkflowSkeleton`/`parseMeta` at `:356` cannot
  throw — `src/workflow-meta.ts:2` states, and the code holds, "never throw on odd input".)*
- **The closure still rejects, and nothing catches it.** With the production `schedule`
  (`:127`, `void job()` with no `.catch()`) and no `unhandledRejection` handler in `src/`, a throw
  from `_runJob` is an unhandled rejection. `sweepAtBoot()` is called at boot
  (`src/server.ts:1507`), so this is reachable during startup.
- **The one path that IS caught is left un-settled.** The `catch` at `:259-262` returns without
  writing a terminal row: the orphan `pending` row persists as `pending` for the rest of the process
  lifetime with **no journal line at all**, rescued only by the *next* boot's sweep. inv 5's amended
  list explicitly includes "**the exceptional exit of inv 2's closure**" among the paths owing a
  line; it emits none.

**The test oracle drifted the same way, which is the testability half of this finding.** Gate 2's
RED oracle (inv 2 amendment) ordered three assertions: *"(a) no unhandled rejection, **(b) the row
settles**, and (c) the next enqueued job still runs."* UT-125 as shipped
(`tests/unit/graph-analyzer.test.ts:703-743`) asserts (a) at `:724`, the released claim/slot at
`:726-727`, and (c) at `:741` — **(b) was dropped**. A test that asserted (b) would be red today.

**And the amendment's falsifiability case was never built.** inv 8's V-C amendment ordered a
failure-injection instance and named it: *"a throwing `putDiagramResult` must still produce exactly
one journal line."* Gate 5 recorded it as debt in UT-128's own docblock
(`tests/unit/graph-analyzer.test.ts:498-501`, verbatim): *"the amendment's V-C falsifiability case …
exercises the try/finally **SHAPE Gate 6 has not written yet**, so pinning it now would test a
mechanism rather than a requirement … named debt for a Gate 6.5+7 coverage-gate addition."* Round 4
closed the *other* named debt item (the `enabled:false` settle cases, `:551-581`) and left this one
open — correctly, because the shape it depends on still does not exist. inv 2 → inv 5 → inv 8/V-C is
one defect with three ARCH rows.

- **Severity: HIGH.** This is the unfixed remainder of a HIGH send-back item, on the one subsystem
  whose failure is silent by design, reachable at boot, and whose bound (inv 2) the architecture
  calls load-bearing for `QUEUE_FULL`'s honesty.
- **Minimum fix (Karpathy):** move `:263` inside the existing `try`, add `finally { this._release(key); }`,
  drop the now-redundant `_release` from `_runJob:388` and from the catch, and have the `catch`
  call `_settleUnavailable(…)` (which already journals). Roughly four lines, no new seam — `ports`
  and `catalog` are already injected, so V-C's throwing-`putDiagramResult` test costs nothing.

---

### R-2 — MED — inv 5's journal line ships **ten** keys against a ratified **eleven**; `cause` is missing, and the emitter did not move to the settle choke point

- **Violates:** ARCH-079 **inv 5** as amended (`02-architecture.md:1397`).
- **Lens:** security/observability (primary) → testability.

**Ordered:**

> The emitter lives at the **settle choke point, not inside `_attempt`** … **True field list,
> corrected in the same breath**: `{name, version, principal, model, promptTokens,
> completionTokens, durationMs, outcome, noteCode, gateFail, **cause**}` … `cause` is the eleventh,
> an engine-classified string that carries the *distinct* reason on paths where the persisted
> `noteCode` is overloaded. **No store migration**: the persisted `note_code` `CHECK` stays at eight
> values and **the distinct cause rides the journal field**.

**Shipped** — `src/graph-analyzer.ts:229-233`: exactly ten keys, `cause` absent.

**Why the deferral defence does not apply.** What the amendment scheduled rather than paid was the
*ninth persisted note code plus a `CHECK` migration*. The journal field was explicitly the thing
carrying the cost **now** — "the distinct cause rides the journal field" — and it is the only
mitigation offered for the overloading inv 11 introduced in the same breath: *"`RETRIES_EXHAUSTED`
becomes an overloaded 'the engine gave up' code (inv 11 settles it with zero attempts made)."*
Concretely, today an operator reading the journal sees `noteCode:"RETRIES_EXHAUSTED"` for **three
distinct situations** with nothing to separate them — `enqueue`'s `enabled:false` guard (`:139`),
`sweepAtBoot`'s `enabled:false` guard (`:182`), and `sweepAtBoot`'s genuine stale-row settle
(`:196`) — plus real retry exhaustion from `_runJob`. That is V-D's defect (two internal states
collapsed onto one string) re-created in the operator channel one gate after it was fixed in the
user channel.

**Two further divergences from the same amendment, both provable from the shipped source:**

- **The emitter did not move.** `_journal` is called from `_settleUnavailable:212` **and from
  `_attempt:339`** — the model-call emitter is still inside `_attempt`, which is precisely what
  the amendment said to change. Two consequences follow: (i) with `retries ≥ 1` the `do/while` at
  `:369-373` calls `_attempt` once per attempt and each call journals, so one settle emits **N**
  lines, against "exactly one journal line per settle" *(tempered: `retries` defaults to `0` at
  `server.ts:1480`, so this is config-dependent, not the shipped default)*; (ii) on the DES-127 B5
  prior-ready restore (`:378-383`) the terminal row written is `status:'ready'` while the last
  journal line for that settle said `outcome:'unavailable'` — the journal contradicts the row.
- **Nobody re-read the amended list.** The Gate 6.5 addendum (`06-impl-log.md`, IMPL-175) calls it
  "the ten-key `JSON.stringify` shape" and Gate 7.5 round 4 (`journal.md`) validated "exactly one
  **ten-key** journal line". Both are internally consistent and both are measured against the
  pre-amendment field list.
- **Severity: MED.** No live leak; it is a lost observability contract on the exact signal class
  (`composeConfig` wiring gaps, disabled-vs-failed) inv 5 exists to make loud.
- **Minimum fix:** one optional `cause: string | null` key on `_journal`'s literal, set at the four
  `_settleUnavailable` call sites; optionally move the `_attempt` emitter's fields up to `_runJob`'s
  tail. The first half is ~5 lines and closes the finding.

---

### R-3 — MED — inv 11's guard is enforced at four call sites, not at the `_startJob` choke point the amendment prescribed; and no ledger entry records taking the fallback

- **Violates:** ARCH-079 **inv 11** (new at the Gate 2 re-run).
- **Lens:** security (primary — this is the script-egress control) → testability → Karpathy.

**Ordered:** *"`_startJob` is the single choke point at which this subsystem decides to spend a model
call — reached from all three callers — and it is the site of **both** claims: the in-memory
`_pendingKeys` claim and (after this amendment) the durable `putDiagramPending` write, **which moves
behind the guard** with the boot sweep passing its attempt stamp as a parameter. The `enabled` guard
is **the first statement**, before either claim."* And, as its own one-line rationale: *"a rule
enforced at callers is not a rule … three callers each carrying the check, two remembered, one
forgot."*

**Shipped:** the guard is at `graph-analyzer.ts:138` (`enqueue`) and `:181` (`sweepAtBoot`).
`_startJob` (`:250-271`) contains no `enabled` check. `putDiagramPending` was **not** moved behind
any guard — it remains at the callers, `enqueue:152` and `sweepAtBoot:187` — and `_startJob` takes
no stamp parameter. Counting every site that now carries this one rule: `server.ts:955`,
`mcp-facade.ts:462` (verified present), `graph-analyzer.ts:138`, `graph-analyzer.ts:181` — **four**.

**Counterweight, stated because it is strong.** (a) No live hole exists: `regenerate` reaches the
gateway only through `enqueue`, so all three `_startJob` callers are covered, and UT-124 pins all
three entry points plus the latent-clobber case. (b) The guard-before-`putDiagramPending` ordering
that the amendment cared about **does** hold at both sites (`:138` < `:152`; `:181` < `:187`), so the
latent `ON CONFLICT … diagram=NULL` clobber the amendment warned about is genuinely closed. (c) The
architecture itself pre-authorized a fallback — *"if Gate 6 wants zero structural change at a
send-back gate: QD-S1's requeue-branch-only `if`"* — and the shipped code **exceeds** that fallback.

**Karpathy, argued both ways, then ruled.** Simplicity favours the shipped shape in the small: two
guards beat a refactor of `_startJob`'s signature at a send-back gate, and that was the fallback's
own stated rationale. Simplicity favours the architecture in the large: **one** guard at one choke
point is strictly less machinery than **four** copies of one predicate spread across three modules,
and the amendment's argument for the choke point was itself a simplicity argument. The tie-breaker
is the internal conflict with the security lens: this is the *only* documented script-egress control
(DEPLOY §1b), and a fourth `_startJob` caller — the shape the amendment was written against —
bypasses all four checks silently. **Ruled: deviation stands, MED.**

**What makes it a finding rather than a ratified choice:** the fallback was available, but nothing
records choosing it. `IMPL-175`'s A2 paragraph states the caller-side shape as if it were the plan
("all three `_startJob` callers are covered by two checks") without naming inv 11's primary
prescription or the fallback clause. An un-recorded downgrade of a HIGH send-back item's ordered fix
is the class this whole send-back exists to close.

- **Minimum fix:** either (i) move the two guards into `_startJob` as its first statement and pass
  the sweep's stamp as a parameter (~10 lines, what inv 11 asked for), or (ii) **amend inv 11** to
  record that the fallback was taken and why, and delete the redundant check at `server.ts:955`.
  Option (ii) is legitimate and cheap; what is not legitimate is the current state, where the
  architecture of record asserts a choke point that does not exist.

---

### R-4 — LOW — `enqueue()` runs synchronous store I/O on the registration request path, so an analyzer-side store failure can fail a registration that already committed

- **Violates:** ARCH-079 **inv 1** ("registration never blocks on the analyzer", REQ-102) in spirit;
  contradicts the in-line claim at `src/server.ts:952-954`.
- **Lens:** scalability/consistency.
- **Evidence:** `server.ts:957` calls `graphAnalyzer.enqueue(…)` **synchronously and unguarded**
  after `facade.workflow_register` has already committed (`:951`, `out.status === 'completed'`).
  `enqueue` then performs `getDiagram` (`graph-analyzer.ts:151`) and `putDiagramPending` (`:152`) —
  and on any settle path, `getTriggerBindings`'s four store reads plus a `.immediate()`
  `putDiagramResult` (`:206-211`). A throw from any of them propagates out of `enqueue`, out of
  `handleToolCall`, and turns a **committed** registration into a failed tool response; the client's
  natural retry then creates a second version or hits `maxWorkflowVersions`.
- **Counterweight, stated up front:** `better-sqlite3` is synchronous on one connection in one
  process, and inv 10 + `DEPLOY.md:916` (單一實例上限) rule multi-process contention out of scope, so
  `SQLITE_BUSY` is largely unreachable. What remains is disk-level I/O failure. That is why this is
  **LOW** and not MED, and why the honest fix is a two-line `try { … } catch { }` at `server.ts:957`
  rather than any restructuring.

---

### R-5 — LOW — the struck "three consumers" claim was deleted at one of its two `src/` sites; `diagram-gate.ts` still asserts it

- **Violates:** ARCH-080 as amended (A5).
- **Lens:** testability / doc-code consistency — and it is verbatim the class the send-back named:
  *"a clause struck in one of four places is the defect class this send-back is repairing."*
- **Evidence:** the false comment at `server.ts:299-300` **is** gone (verified — `:300-305` now
  documents the interpolation, and `:305` destructures `VOCAB_GLYPHS`). But
  `src/diagram-gate.ts:22-24` still reads: *"Three consumers, elsewhere: this gate, the shipped
  default graphAnalyzer.systemPrompt, and the AUTHORING/tool-description text."* The A5 amendment
  itself verified the third consumer is **absent**: `grep -n '◇\|⟲\|╭\|▶' docs/AUTHORING.md` returns
  nothing this pass. So the canonical declaration's own docblock is the one place still claiming a
  consumer that does not exist.
- **Minimum fix:** one comment edit, on the module the amendment made canonical.

---

### R-6 — LOW — the amended ARCH-051/ARCH-082 rows state `TOOL_NAMES` declares **39** tools; it declares **40**

- **Violates:** ARCH-051 and ARCH-082 as amended (A6).
- **Evidence:** `02-architecture.md:555` ("declares **39** tools, all 39 advertised") and `:1430`
  (same claim). Direct count of the `TOOL_NAMES` array literal (`src/server.ts:188-242`) this pass:
  **40**. Gate 5 found this and recorded the correction **in the test file's comment**
  (`tests/integration/mcp-tools-list-schema.test.ts`, "gives 40 — the literal list below is the
  VERIFIED count"), and `ALL_ADVERTISED_TOOL_NAMES` correctly carries 40 names — but the
  architecture of record was never fixed.
- **Why it is worth one line:** the amendment that carries the wrong count is the amendment written
  to replace a *count-based* drift-lock with a set equality. Doc-only; Gate 2 edit, no code.

---

## 2. Confirmed closed — the send-back items, re-verified at `file:line`

Half a re-review's value is confirming closures, so the consolidating reviewer does not re-derive
them. All checked against source this pass, not against the ledger.

| Item | Ordered by | Status | Evidence |
|---|---|---|---|
| **A1** transport gate on `/describe` | ADJ-A1, ARCH-083 | **CLOSED** | `server.ts:1898-1907` — `GET` + path regex computed **inside** the `authHandlers` block, fourth `dbindExempt` member; non-exempt peers must clear `resolvePrincipal` before `dispatchDashboard()`, else `send401()` (`:1746-1750`) **before any store read**. Handler at `:1175-1186` untouched, so the projection stays single (DES-125/132). Gate and handler use the identical `split('?')[0]` + regex, so they cannot disagree on a path. Existence leak closed: 401 is returned before the name is resolved. |
| **A2** `enabled:false` never reaches the gateway | ARCH-079 inv 11 | **CLOSED (behaviour)** | `graph-analyzer.ts:138`, `:181`; all three entry points pinned by UT-124. Structural residue filed as **R-3**. |
| **A3** unguarded async in `_startJob` | ARCH-079 inv 2 / N-1 | **PARTIAL** | `scriptPromise` rejection handled (`:257-262`); remainder filed as **R-1**. |
| **A4** mini-preview deleted, not re-pointed | ARCH-084 | **CLOSED** | `renderMiniPreviewAsync` absent from `dashboard-page.ts`; `renderHomeGroup` present at `:228`; exactly **one** `/describe` fetch, at `:214`, reached from a card click. |
| **A5** one vocabulary declaration | ARCH-080 | **CLOSED** (comment residue = **R-5**) | `VOCAB_GLYPHS` exported at `diagram-gate.ts:8`; `server.ts:305` destructures it and `:306-317` interpolates every glyph; UT-127's second case reads `rwe.config.example.json:59` from disk. |
| **A6** `tools/list` drift-lock | ARCH-051, ARCH-082 | **CLOSED** (count = **R-6**) | IT-102 in `tests/integration/mcp-tools-list-schema.test.ts`: sorted **set equality** against a hand-written 40-name literal never imported from `server.ts`, plus per-tool rows for the two v23 tools and the script-absence sentence. |
| **A10** false in-line comment | ARCH-085 | **CLOSED** | `grep "nothing to restore on failure\|never 'ready'" src/graph-analyzer.ts` → empty. |
| **V-D** note precedence total over `{row} × {analyzerEnabled}` | ARCH-081 | **CLOSED** | `workflow-view.ts:133-146` — `ready → ''`, then `!analyzerEnabled → DISABLED` **before** any persisted `noteCode` is consulted, and the `&& diagram.noteCode` guard the amendment insisted on is kept at `:142`. |
| **inv 6** allowlist membership | ARCH-079 | **HOLDS, exactly** | `graph-analyzer.ts:279-297` = skeleton titles/child-workflow names ∪ `meta.phases[].title` (`:283`) ∪ aliases (`:284`) ∪ `'default'` (`:285`) ∪ `'model:param'` (`:286`) ∪ `UNBOUND_ENTRY_LABEL` (`:293`) ∪ trigger kinds/upstream (`:294-297`). No `DIAGRAM_CODEPOINTS`, per the amendment. ADR-015's audit chain intact. |
| **inv 9** sweep stamps before it schedules | ARCH-079 | **HOLDS** | `putDiagramPending(name, version, stamp)` at `:187` precedes `_startJob` at `:189`. |
| **inv 10** bounds are per-process | ARCH-079 | **HOLDS (documented)** | `DEPLOY.md:916` 單一實例上限 rules multi-instance out of scope. |
| **inv 4** journal carries no provider/model text | ARCH-079 | **HOLDS** | `_journal`'s ten keys (`:229-233`) are all engine-classified; `_attempt:315-319` discards the caught error without inspecting it, per ADR-016. The struck "provider HTTP status" field is genuinely absent. |
| **ARCH-079 isolation** | ADR-016 | **HOLDS** | `_attempt:308-314` passes only `prompt`/`opts`/synthetic `runId`/`agentId` — no `workspace`, `onEvent`, `onHarness`, or `SecretValueProvider`. |

**Not filed, recorded as accepted posture:** script egress to the configured provider is **on by
default** (`server.ts:1467`, `enabled ?? true`). That is an owner-ratified decision (ARCH-085,
DES-134) carrying a standing disclosure on `workflow_register`'s advertised description
(`server.ts:298`), and it is out of scope for a consistency review — but it is the reason R-3's
control matters more than its severity suggests.

---

## 3. Round-1 findings, re-checked

| Round 1 | Then | Now |
|---|---|---|
| V-1 unauthenticated `/describe` (HIGH) | HIGH | **Closed** — ADJ-A1 gate, see §2/A1 |
| V-2 `sweepAtBoot` ignores `enabled` (HIGH) | HIGH | **Closed behaviourally**; structural residue → **R-3** |
| V-3 `_runJob` unguarded async (MED, adjudicated up to HIGH) | HIGH | **Partial** → **R-1** |
| V-4 mini-preview re-pointed not deleted (MED) | MED | **Closed** — IMPL-176 |
| V-5 `DIAGRAM_CODEPOINTS` one consumer, not three (MED) | MED | **Closed in code** → comment residue **R-5** |
| V-6 neither new tool joined the drift-lock (MED) | MED | **Closed** — IT-102 |
| V-7 four Gate-2 doc-only drifts (LOW×4) | LOW | **Closed** by the Gate 2 re-run's amendments; the amendments themselves introduced **R-6** |

---

## 4. Lens conflicts, surfaced as the lens requires

- **Security vs. Karpathy, on R-3.** Security wants the guard at the choke point (one place to audit,
  no fourth-caller bypass). Simplicity-at-a-send-back-gate wants no signature change on `_startJob`.
  Both are defensible; the deciding argument is that four copies of one predicate across three
  modules is *more* architecture than one, so simplicity does not actually favour the shipped shape —
  it only favoured shipping it that day. Ruled for the architecture, MED not HIGH.
- **Testability vs. scalability, on R-1.** The testability reading is the harsher one: UT-125 is
  green, so the bound *looks* proven. The scalability reading is that the proven bound covers one
  of five reachable throw sites. The seam to prove the rest already exists (`ports`/`catalog` are
  injected — inv 8's whole point), so this conflict resolves to "the test is cheap and was deferred
  on a dependency that never landed", not to a genuine cost trade.
- **Security vs. observability, on R-2.** Not building `cause` is the *safer* choice on the ADR-016
  axis (fewer engine-authored strings on a concatenation site). It is the worse choice on the inv-5
  axis (three states collapsed onto `RETRIES_EXHAUSTED`). ADR-016 is satisfied by any engine-authored
  closed enum, so the conflict is only apparent — a `cause` drawn from a fixed set costs nothing on
  the security axis. Ruled for observability.

---

## 5. Recommended routing

- **Gate 6:** R-1 (≈4 lines in `_startJob`), R-2 (`cause` key + four call sites), R-5 (one comment).
- **Gate 5:** the V-C RED that R-1 unblocks — a throwing `putDiagramResult` must produce exactly one
  journal line and must not wedge the queue; plus UT-125 assertion (b), the settle the ordered
  oracle listed and the shipped test dropped.
- **Gate 2:** R-3 (build the choke point **or** amend inv 11 to record the fallback — either is
  acceptable, the current silence is not) and R-6 (39 → 40 at `02-architecture.md:555` and `:1430`).
- **Optional / owner's call:** R-4, two lines at `server.ts:957`.
