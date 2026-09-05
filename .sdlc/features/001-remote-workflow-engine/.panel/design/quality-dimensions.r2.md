---
stage: design
lens: quality-dimensions
iteration: v24
round: 2 (response + final position)
reads: adversarial.r1.md (DES-137..160), quality-dimensions.r1.md
---
# Quality-dimensions — round 2 (Observability / Replaceability / Consumability / Self-sustainability)

## What I read and what changed

I read `adversarial.r1.md` in full (DES-137..160, the 18-row task partition, R1..R10, the seven
internal tie-breaks) and re-verified in the tree every point where we disagree. **Three of my r1
items were wrong on the facts and I concede them outright**; two more I concede in substance and keep
only a test obligation; one (C-6) I downgrade myself, HIGH→MID, because the failure mode I named does
not survive arithmetic. In exchange the verification turned up four things neither r1 had:

- **`provenance` already ships.** `agent-executor.ts:414-424` is described in its own comment as
  "the ONE descriptor-decoration site" and already merges `provenance: eff.provenance` (v21,
  DES-105/TASK-101) onto the descriptor coming back from **either** gateway. ARCH-104 adds `label`
  and `materialized`, not three fields.
- **`AgentRecord.label` already exists** (`types.ts:67`) and is populated **only on the live path**
  (`run-manager.ts:868`, `markQueued(agentId, key.opts.label, …)` — in-process spawner state, lost on
  restart). `deriveAgentRecords` (`run-store.ts:24`) never sets it. v24's `descriptor.label` is the
  first durable source for it, and closing that is one line.
- **`codedError` has 25 distinct literal codes across 8 files and 9 non-literal call sites — and I
  checked the types of all nine.** Eight already carry closed literal unions (`ParamErr['code']`,
  `contract.ts:57`; the egress verdict, `seedref-egress.ts:10`; `resolveVersionRequest`'s result;
  a locally inferred `'A'|'B'` at `workflow-catalog.ts:411`), so DES-137's narrowing compiles there.
  Exactly **one** is genuinely `string` — `toErr` (`run-manager.ts:115-121`), which can return
  `err.name`. But those unions carry **six codes that never appear as a `codedError('X'` literal
  anywhere**, so DES-137's grep-based drift lock reports complete while the catalog is missing them.
- **`lastFire` is written only on an admitted fire** (`scheduler.ts:248/287/293`, always beside a
  `runId`); `markFailed` (`:305-317`) does not touch it. That makes `refusalCount`'s reset rule a
  one-clause change to an UPDATE that already exists.

## Adjudication table

| # | Item | Their position | Verdict | One-line reason |
|---|---|---|---|---|
| O-7 | descriptor fields on both `redactHarness` branches | DES-160: "`redactHarness` unchanged" | **CONCEDE** (seam was wrong) | the decoration site is single and downstream of both gateways; keep only the direct-fetch test |
| O-7b | `materialized` on a `surfaceType:'none'` dispatch | DES-154 materializes before the gateway call, unconditionally | **HOLD (new, MID)** | it reports files the direct-fetch agent cannot use — a truthful field that reads as a lie |
| O-8 | name ARCH-104's consumer | not named in DES-160 | **HOLD, sharpened** | `deriveAgentRecords` drops `label`; restart-reconstructed agents are anonymous today |
| O-9 | `adminReads` visibility + `/api/*` projection | DES-151: owner-only on `run_status` | **CONCEDE the rule, HOLD the carrier** | attach at the facade projection, not on `RunStatusView` — then the ungated route cannot leak it |
| O-10 | audit-write failure fails closed | DES-151: append is synchronous | **CONVERGED, cheaper** | synchronous + no `try/catch` = fail-closed by construction; say it, test it |
| O-11a | `lastError` vs `lastRefusalReason` | DES-150: distinct, `lastError` untouched, tested | **CONCEDE** | they supplied the stated precedence I demanded |
| O-11b | `refusalCount` unbounded in meaning | not addressed | **HOLD, now concrete** | reset to 0 in the admitted-fire UPDATE (`scheduler.ts:287/293`) |
| O-11c | `schedules.workflow` consumers | not enumerated | **HOLD** | `ScheduleStatus.workflow` (`:37`) and `listByWorkflow`'s `WHERE workflow=?` (`:213-217`) read the dropped column |
| O-12 | REQ-118 table path | DES-158: exact path + `UNVERIFIED(reason)` rows | **CONCEDE (theirs is better)** + one defect | an `afterAll` writer truncates the table on a filtered run |
| R-6 | null-owner rule | DES-139 tri-state `undefined`/`null`, DES-152 | **CONCEDE (theirs is better)** | existence-neutral `undefined` vs ownerless `null` is strictly stronger than my one rule |
| R-6b | the operator consequence | not stated | **HOLD** | every migrated trigger and legacy run goes admin-only the day auth is enabled — that is a DEPLOY line |
| R-7 | `pathVerdict` imports containment | DES-142: exactly that, plus purity split | **CONCEDE (theirs is better)** | lexical-pure / containment-injected + re-check after `mkdir -p` is the sharper form |
| R-7b | `seedNamespace` / `?namespace=` removal | DES-142 removes all three | **ENDORSE**, with a cost I own | it is a third break in the client plugin — see QD-R11 |
| R-8 | `resolveMcp` as a pure helper | DES-153: pure over `listAssets` | **CONVERGED** | one clause: it takes the catalog port, not `AssetSyncService` |
| R-9 | stale-`graphAnalyzer` boot warning | DES-141: one `console.warn` + integration test | **CONCEDE the item, HOLD the generalization** | warn on *any* unrecognized top-level key; `graphAnalyzer` gets the ADR-025 sentence |
| R-10 | no model alias in `GUIDE_EXAMPLES` | DES-143 refuses `model|effort|timeoutMs` and scans every example | **CONCEDE — subsumed** | their test implies mine |
| C-5 | fence `ERROR_CATALOG`, don't migrate call sites | DES-137: narrow `codedError`, catalog covers all of `src/` | **CONCEDE the fence, FIX the drift lock** | it is cheaper than I feared and than they specified — but the grep lock has a six-code hole |
| C-6 | byte ceiling on guide + `tools/list` | not addressed | **DOWNGRADE myself, HIGH→MID** | ~10k tokens is not an overflow; re-aim at always-on cost and regression |
| C-7 | guide interpolates effective ceilings | DES-157: pure over inputs + fake-ceiling test | **CONVERGED**, one clause | the root must pass *resolved `ServerConfig`* ceilings, not re-import `DEFAULT_CEILINGS` |
| C-8 | echo the applied `onlyRunnable` filter | DES-156 defaults it, does not echo | **HOLD (LOW)** | a silent default filter is the refuse-never-clamp rule (C-3) inverted |
| C-9 | Mermaid source, not a picture | — | **CONVERGED**, no dispute | one honesty line in README/guide |
| S-7 | the *loud* half of fail-closed | DES-141 refuses a malformed block at boot; says nothing about a missing one | **HOLD — this is my main open item** | ADR-028's justification is still asserted, not built |
| S-8a | `DROP COLUMN` SQLite ≥ 3.35 floor | DES-148 covers catalog migration; task 11 does not state the floor | **HOLD (LOW)** | one note beside the migration |
| S-8b | legacy global assets are rows-only | DES-148 walks the tree into rows | **CONVERGED** | agreed, no FS move |
| S-8c | orphan asset tree after a failed deregister hook | DES-148 deletes rows in one transaction; FS is the after-hook | **HOLD (LOW)** | reclaim in the existing workspace-GC sweep |
| — | `mode(args)` authz resolver (DES-138, their biggest call) | — | **ENDORSE**, one addition | the resolved mode must appear in the refusal envelope's `detail` |
| — | `outputSchema` on `ToolSpec` (DES-158) | flagged as possible scope creep | **ENDORSE from consumability** | typed I/O is the dimension; but publishing it interacts with C-6 |
| — | `LEGACY_REREGISTER` (their R6) | expects me to want a compatibility window | **CONCEDE — misattributed** | I never asked for a dual-shape schema; one condition attached |
| — | REQ-112 advice-vs-enforcement honesty (their R10) | — | **ENDORSE**, one addition | the guide must *mark* which rules are checked |

---

## 1. Observability

*(traceability fold: REQ-109's rows, REQ-114's `pushedBy`, REQ-115's counters and O-12's generated
artifact are what make an action traceable to a principal at Gate 8 — a row no projection returns and
a table that lives only in test stdout are both untraceable in the sense this ledger grades.)*

### O-7 — CONCEDE. My seam was wrong; the invariant it protected is not.

My r1 claim was that `redactHarness` (`agent-executor.ts:39-64`) returns from two branches and the
`surfaceType:'none'` branch would drop the new fields. Verified: the two branches are real, and the
`'none'` branch is the *entire direct-fetch gateway* (`gateway/client.ts:344-351` always passes
`surfaceType:'none'`; `claude-agent-sdk-client.ts:595` always `'curated'`). **But** the transcript
event is not written by either gateway. It is written at `agent-executor.ts:414-424`, which its own
comment calls "the ONE descriptor-decoration site", and which already spreads `provenance`,
`effort`, `timeoutMs` and `effortApplied` onto whatever descriptor came back — for both gateways,
both branches. DES-160's "`redactHarness` unchanged" is **correct**, and my QD-D1 is withdrawn.

What survives is one test obligation, and it is worth stating because the property is load-bearing
and undefended: **a direct-fetch (`surfaceType:'none'`) dispatch must produce a transcript event
carrying `label`, `provenance` and `materialized`.** DES-160's test
(`agent-log-harness-shape.test.ts`) should have that as a second case, not only the curated one —
otherwise a future refactor that moves decoration up into a gateway passes on the curated path and
blinds the degraded one. Cost: one fixture. (**QD-D1 severity HIGH → LOW**, kept only as this case.)

### O-7b — HOLD (new, MID). `materialized` on a direct-fetch dispatch is a truthful field that reads as a lie.

DES-154 calls `materializeAssets` at the dispatch site (`agent-executor.ts:~340`) **before** the
gateway call, so it runs regardless of which gateway ends up serving. On the direct-fetch path there
is no curated surface and no MCP: the files are copied into the workspace and the agent has no way to
use them. `materialized:{skills:['x'],mcp:['y']}` beside `surfaceType:'none'` is then simultaneously
accurate and misleading, which is the worst kind of observability field.

Two honest options; design must pick one, not leave it:
- **(a) skip materialization when the target resolves to a direct-fetch gateway** and emit
  `materialized:{skills:[],mcp:[],missing:declared}` — truthful, and it deletes pure-waste FS copies.
  *Open question the synthesizer must check:* whether the gateway target is resolvable at `:340`,
  before `_invokeOnce`. If it is not, (a) is not available and this is not a free choice.
- **(b) keep unconditional materialization** and state in the field's docblock and in the agent-log
  line that `materialized` records **what was written to the workspace**, which on
  `surfaceType:'none'` is *not* what the agent received.

I prefer (a) on cost grounds, but I expect (b) is where this lands: gateway selection happens inside
`gateway/client.ts`'s routing, downstream of `:340`, so the target very likely is **not** known at the
materialization site — in which case (a) is not available and (b) is the honest answer. What I will
not take is neither.

### O-8 — HOLD, and it is now one line instead of a design debate.

`AgentRecord.label?: string` already exists (`types.ts:67`). It is populated on the **live** path only
(`run-manager.ts:868` → `markQueued(agentId, key.opts.label, …)`), from in-process spawner state that
does not survive a restart. `deriveAgentRecords` (`run-store.ts:24`, called at
`sqlite-run-store.ts:241` and `run-store.ts:227`) reconstructs `run_status.agents[]` from transcript
events and sets only `agentId/state/provider/model/tokens` — so **after a restart every agent on a
still-running run is anonymous**, which is exactly when a human is looking.

v24's `descriptor.label` is the first durable source for that field. The change is:
```
const hd = (harness.data as { descriptor?: { model?; provider?; label? } }).descriptor;
records.push({ agentId, ..., ...(hd?.label !== undefined ? { label: hd.label } : {}) });
```
with one integration test: write a harness event, drop the `RunManager`, read `run_status` from the
store, assert the label. `materialized` and `provenance` stay transcript-only and are read via
`run_agent_log` (they answer a post-hoc "why did skill X not load", not a "what is running now").

This is a **task-boundary** item, not a test-list item — see §5. (**QD-D2 stays HIGH** in
consequence, MINIMAL in cost.)

### O-9 — CONCEDE the visibility rule; the carrier fix is cheaper than my strip rule.

DES-151 makes `adminReads` present only when `p.id === owner`. I had also wanted it visible to an
admin; **I concede** — the trail is the owner's, and an admin who needs it has a store, not a
projection. Honest-absence (absent, not `[]`) holds either way and both r1s agree on it.

On the carrier I keep the finding but adopt a better fix. Verified again: `GET /api/runs/:id`
(`server.ts:1272`) returns `buildDashboardModel([], view).selected` — the whole `RunStatusView` —
through `dispatchDashboard` (`server.ts:1953`), which is **not** in the gated set (`server.ts:1852`
`/mcp`, `1792` blob, `1816` manifest, `1907` describe). So a *strip* rule is a rule someone must
remember. **Converged form: `adminReads` is attached by the facade's `run_status` projection, after
the `RunStatusView` is built, only for the owner — it is never a field of `RunStatusView`.** Then the
HTTP route cannot serve it, by construction rather than by discipline, and DES-151's owner-only test
is the only test needed. This is strictly better than what I proposed in r1.

What that does **not** fix, and what I still hold: `RunStatusView` already carries `principal`
(`types.ts:135-137`) on that same ungated route today. That is a v15-era condition and not v24's to
repair — but v24 chose this carrier, so the ledger should carry the rule once: **no identity field
(`actor`, `principal`, `pushedBy`, `createdBy`, `claimedBy`) is served on an ungated `/api/*`
route**, with the existing `principal` exposure named as a known deviation with a REQ pointer, or
fixed. Silently inheriting it while adding an audit trail beside it is the part I will not sign.

### O-10 — CONVERGED, and DES-151 makes it nearly free.

DES-151's "`appendAudit` is synchronous under better-sqlite3, so `audit(); read();` is ordered by the
language" also answers my failure-path question: a synchronous throw propagates and the read never
runs — **fail-closed by construction**. The design need only state the negative invariant — *no
`try/catch` around `appendAudit` at the call site, and no `.catch()` swallow* — and add one case to
their `audit-order.test.ts`: a fake store whose `appendAudit` throws ⇒ the tool returns the error and
`readArtifactChunk` was never called. That is one more `it` in a file they already specified.
(**QD-D9 MID → LOW.**)

### O-11 — one concede, two holds.

**(a) CONCEDE.** DES-150 keeps `lastError` and `lastRefusalReason` distinct, writes **no** `lastError`
on a refusal, gives the reason ("dispatch failed" vs "policy refused" are two questions) and tests it
(`lastError` untouched). My r1 said I would not concede "two last-failure fields with *no stated
precedence*" — they stated it. Adopted; ADR-031's three-field shape stands.

Their "expected disagreements" also predicts that *the observability lens may want a per-fire audit of
refusals instead of coalescing*. **Not my position either** — ADR-031's coalescing is settled, I
adopted it in r1 as S-1, and I have never asked for per-fire rows. The only thing I add to the
refusal path is (b) below.

**(b) HOLD, now concrete.** Nothing bounds `refusalCount`'s meaning. Verified: `lastFire` is written
only on an **admitted** fire (`scheduler.ts:248/287/293`, always with a `runId`); `markFailed`
(`:305-317`) does not touch it. So the reset has an obvious home: **`refusalCount = 0` in the same
UPDATE that writes `lastFire` on an admitted fire.** `refusalCount` then reads as *consecutive
refusals since the last successful fire* — self-documenting, bounded in meaning, and a health signal
rather than a lifetime tally that says `10080` about a trigger that has worked fine all week. One
column in two existing UPDATEs, one assertion in DES-150's `scheduler-refusal.test.ts` (refuse twice,
claim, fire, assert `0`). The same rule applies to the webhook store's admitted-delivery path; I do
not name its statement because I have not read it.

**(c) HOLD.** ARCH-099/100 replace `schedules.workflow` with `claimedBy`, and two consumers read the
dropped column: `ScheduleStatus.workflow` (`scheduler.ts:37`, projected at `:111`) and
`listByWorkflow`'s `WHERE workflow = ?` (`scheduler.ts:213-217`), which the sync port's
`getTriggerBindings` composes. Neither appears in DES-149/150 or in task 11's description. Enumerate
both at design: everything describing the old field moves with it, or `schedule_list` returns a
column that no longer exists.

### O-12 — CONCEDE (theirs is better), plus one defect in it.

DES-158's exact path (`.sdlc/features/001-remote-workflow-engine/v24-tool-surface.md`),
`UNVERIFIED(reason)` as a **row** with its reason string, and the per-array-entry assertion are
exactly what I asked for and more precisely. Adopted; my O-12 is closed.

The defect: an `afterAll` writer means **any filtered run (`-t`, a single-file run, a bail) rewrites
the repo file with a truncated table** — and a truncated conformance artifact that looks complete is
worse than none. Fix: write only when the run covered every `TOOL_SPECS` row (the file already
asserts one row per entry — gate the write on that same count), or stamp the artifact with
`rows: N/35` and let the second test fail on a short count. Either is one condition.

---

## 2. Replaceability

### R-6 — CONCEDE; DES-139 is strictly stronger than my rule.

I proposed one rule: NULL owner ⇒ admin-only, fail closed. DES-139 splits it correctly into a
**tri-state**: `undefined` = does not exist ⇒ `authorize` returns ok and the handler answers
`*_NOT_FOUND` (authz never leaks existence), `null` = exists and is ownerless ⇒ admin-only. That is
the right decomposition — collapsing them would either leak existence to probers or make every legacy
row readable. DES-152's "a `user` never sees ownerless runs" falls out as a consequence rather than a
second rule, which is what I wanted from the "same rule on both sides of the seam" clause. Fully
adopted; my R-6 as written is withdrawn in favour of theirs.

### R-6b — HOLD. The operator-visible consequence is still unwritten.

`OwnerLookup.triggerOwner` reads `createdBy`, which ARCH-099/100 add as `TEXT NULL` — so it is
`NULL` on **every migrated legacy trigger**, and `runs.principal` is `NULL` on every pre-v15 run and
every run submitted with auth disabled. Under DES-139 that means: **the day an operator enables auth,
every pre-existing trigger and run becomes admin-only.** That is the correct behaviour and it is a
support incident if it is discovered rather than announced. It belongs in DEPLOY/README in one
sentence and in S-7's boot line as a count ("N ownerless triggers, M ownerless runs — admin-only
under auth"). This is a replaceability item because it is the cost of swapping the auth backend on,
and the cost has to be legible before the swap, not after.

### R-7 — CONCEDE (theirs is better) and ENDORSE the namespace removal, owning its cost.

DES-142's split — `lexicalVerdict` pure and table-tested, `pathVerdict` taking an injected `realpath`
and delegating containment to `isPathContained` (`path-containment.ts:13`, already the shared jail
test for `workspace-seed.ts:10`, `workspace-artifacts.ts:9`,
`gateway/claude-agent-sdk-client.ts:20`, `self-update.ts:12`) — is the sharper form of my R-7, and
their "check containment **again** after `mkdir -p` of the parent, because a not-yet-created symlink
is undetectable" is a boundary I did not have. Their fixture rule (old `STRIP_RE` / `safeRelPath`
cases copied as **literal rows**, not imported) is also the right answer to my "unnamed fixture list"
complaint. Adopted wholesale; **QD-D12 closed**.

I **endorse** DES-142's removal of the three caller-typed namespace sites (`run_start.seedNamespace`,
`?namespace=` on blob and manifest): a namespace that the caller types is a partition the caller can
choose, which is a permission by another name, and ADR-028's "appears once" is false while they
exist. But it is my lens that owns the consumability bill: this is the **third** independent break in
the client plugin (tool renames, `?namespace=`, guidance text) — see QD-R11 in §5.

### R-8 — CONVERGED, one clause.

DES-153 makes `resolveMcp` "a pure helper over `listAssets` (not a method that needs FS)", which is
the call I made. One clause to pin: it takes the **catalog port**, not `AssetSyncService`, so it is
constructible in a unit test with an in-memory catalog and no tmp roots — otherwise "pure helper"
degrades to "method that happens not to touch the disk yet".

### R-9 — CONCEDE the item; HOLD the generalization.

DES-141 specifies what I asked for: an unknown `graphAnalyzer` key ⇒ one `console.warn` naming
ADR-025, with `main-composition-root.test.ts` asserting it and the wiring test **losing** its
`graphAnalyzer` row. My r1 concern (a type removal is compile-time and does nothing at runtime) is
answered. **QD-D10 closed as specified.**

I hold one amendment: make the check **general** — warn once, listing every unrecognized top-level
key, with `graphAnalyzer` carrying the ADR-025 sentence as a special case. The single-key version has
to be re-added by hand the next time a config block is retired, and the twice-bitten `composeConfig`
bug class is precisely "a config block that is present and does nothing". A general unknown-key
warning is the same code with a `Set` difference instead of one `if`. DES-141's malformed-role
`process.exit(1)` I endorse without reservation and note that it is *louder* than I proposed.

### R-10 — CONCEDE, subsumed.

DES-143 refuses `model|effort|timeoutMs` keys in any `agent()` call (`PARAM_IN_SCRIPT{key}`) and
tests that every `GUIDE_EXAMPLES[].script` scans clean. My "no model alias appears in any example"
test is implied by theirs. Withdrawn.

**Standing (not disputed):** ADR-033 settled the diagram cost question; with no model name legal in
any script, retiring a provider is a `meta` default edit or a `run_start({overrides})`, never a
workflow-logic edit. That is the v24 replaceability win and it needs no further design.

---

## 3. Consumability

### C-5 — CONCEDE the fence; DES-137 is cheaper than I feared, and its drift lock has a hole.

My r1 fenced `ERROR_CATALOG` to "codes named by `TOOL_SPECS` plus new v24 codes" and forbade touching
existing `codedError()` call sites, fearing a 40-file refactor. **Measured:** `src/` contains **25
distinct literal codes** across 8 files, and **9 non-literal call sites**. I then checked the type of
the value at each of those nine, which is what settles the cost:

| site | what `code` is typed as | narrows? |
|---|---|---|
| `run-manager.ts:111` | `ParamErr['code']` — a 5-member union (`contract.ts:57`) | yes |
| `run-manager.ts:337` | `'SEEDREF_DISABLED' \| 'SEEDREF_EGRESS_DENIED'` (`seedref-egress.ts:10`) | yes |
| `workflow-catalog.ts:329` / `:354` | `validateScriptEntry` / `parseParamContract` error unions | yes |
| `workflow-catalog.ts:412` / `:417` | `const code = fromCaller ? 'HARNESS_DEFAULTS_INVALID' : 'PARAM_CONTRACT_INVALID'` — inferred literal union (`:411`) | yes |
| `workflow-catalog.ts:526` | `resolveVersionRequest`'s result union (`:89-106`) | yes |
| `workflow-catalog.ts:443` | a literal | yes |
| **`run-manager.ts:838`** | **`toErr(): { code: string }`** (`:115-121`) — returns `err.name` for a non-coded throw | **no** |

So my fence is withdrawn *and* my r1 fear was wrong in the other direction too: DES-137's stronger
scope is affordable, and **eight of the nine sites need nothing at all**. Only `toErr` does.

**The real finding — DES-137's drift lock has a six-code hole.** Their lock is "every
`codedError('X'` literal in `src/` is a catalog key", which by construction only sees literals. But
`SEEDREF_EGRESS_DENIED`, `INVALID_CHANNEL`, `CHANNEL_UNPUBLISHED`, `DANGLING_CHANNEL`, `PARAM_LOCKED`
and `PARAM_UNKNOWN` reach `codedError` **only** through those union-typed pass-throughs and appear as
a literal nowhere — they are absent from the 25. A catalog assembled from the grep is silently
incomplete, and the lock says it is complete.

**Proposal, two parts:**
1. **Let `tsc` be the lock, not grep.** The four upstream result types are already closed unions, so
   constrain each one's `code` to `ErrorCode` at its declaration (`contract.ts:57`,
   `seedref-egress.ts:10`, `resolveVersionRequest`'s result, `validateScriptEntry`'s error). Then a
   code that is not catalogued is a compile error at the *source* of the value rather than at a
   `codedError` call the grep cannot see. Cost: four type annotations, no call-site edits, and it
   turns the six invisible codes into six catalog rows the compiler demands.
2. **One runtime guard at the one genuinely-`string` site.** Export `toErrorCode(s: string):
   ErrorCode` beside the catalog — the key if present, else `'INTERNAL_ERROR'` with the original in
   `detail.rawCode` (DES-137's own `toErrEnvelope` passthrough mapping, pulled one layer earlier so
   the same rule applies whether a bad code arrives at the envelope or at the throw). Apply it at
   `run-manager.ts:838` only. A `rawCode` in production is then a real signal — an uncatalogued code
   escaped — and it is greppable.

Keep their literal grep as a *second* lock; it is cheap and catches the common case. It just cannot
be the only one. (**QD-D11 stays MID**, re-aimed from "unscoped catalog" to "a drift lock that
reports complete while six codes are missing".)

### C-6 — I downgrade my own item, HIGH → MID, and re-aim it.

My r1 claimed REQ-117's context budget is unbounded and that the guide plus 35 tool descriptions
could overflow the subject. Doing the arithmetic honestly: DES-157's ≥10 examples plus the vocabulary
and tables is plausibly 15–30KB, and the projected descriptions a few KB more — order **10k tokens**,
a few percent of a modern context window. **Overflow is the wrong failure mode**, and the real risk
(attention dilution) is not something a byte ceiling measures. QD-D4 drops to MID and my invented
24KB numbers are withdrawn.

What is still worth one test, re-aimed: **`tools/list` description bytes are an always-on cost** —
paid on every session by every client, including ones that never read the guide — while the guide is
paid on demand. So the guard belongs there: one test that records the total projected `tools/list`
byte count against a pinned baseline and fails on a jump beyond a stated tolerance. That is a
**regression guard**, not a budget, and it should be labelled as such in 05-tests.md next to their R8
list of drift locks. It costs one assertion and it is the only thing that will notice the surface
doubling three iterations from now.

This interacts with one of their items: **DES-158's `outputSchema`.** From consumability I
**endorse** it — structured, typed I/O is exactly this dimension, and without it REQ-118's "asserted
against its own documented contract" has no document. But if `outputSchema` is ever *published* in
`tools/list` (rather than staying a test oracle), it multiplies the always-on payload by 35 rows. So:
adopt it as a `ToolSpec` field and a test oracle now; treat publishing it as a separate decision that
must be taken **after** the byte baseline exists, not before. Naming that ordering is the whole of my
contribution here.

### C-7 — CONVERGED, one clause.

DES-157 makes `buildAuthoringGuide` **pure over its inputs**, with no constant imports inside the
builder, so a test can pass a fake ceiling and prove interpolation rather than a hard-coded number —
that is C-7 and a better test than the one I proposed. One clause to nail down: the composition root
must pass the **resolved `ServerConfig` ceilings**, not re-import `DEFAULT_CEILINGS` at the root.
Purity of the builder is defeated by an impure caller, and `maxTimeoutMs`/`maxAppendPromptBytes`/
`maxEffort` are operator-overridable (they are already rows in
`compose-config-v2-wiring.test.ts:130-145`). Add one boot-level test with a non-default ceiling
asserting the guide text carries it. (**QD-D7 stays MID** until that root-side test exists.)

### C-8 — HOLD (LOW).

DES-156 defaults `onlyRunnable:true` for `user` and does not echo it. A user whose `workflow_list`
comes back empty cannot tell "nothing registered" from "everything filtered". Echo the applied filter
in the response (`filter:{onlyRunnable:true}`). Same principle as refuse-never-clamp (C-3, adopted as
ARCH-094): the caller learns the rule from the response, on the first attempt.

### C-9 / `LEGACY_REREGISTER` — CONCEDE, with one condition, and a misattribution corrected.

Their "expected disagreements" predicts that *quality-dimensions/consumability* will want `run_start`
to accept the flat override form behind a deprecation note. **That is not my position and never
was.** A schema accepting two shapes is two rules for every future caller to learn — the exact cost
adjudication A-2 refused for `defaults`. I concede their R6 in full: `runnable:false` +
`LEGACY_REREGISTER`.

The consumability condition on that concession: **the refusal must be discoverable before it is
hit.** DES-156 already carries `runnable` and `runnableReason` on both `workflow_list` and
`describe`, which satisfies it — so the condition is met by their own design, and what remains is one
guide sentence naming `LEGACY_REREGISTER` and what to do about it. A typed refusal at run time that
the caller could have seen at list time is a support ticket; one that was already visible is a
migration note.

### ENDORSE — REQ-112 advice-vs-enforcement honesty (their R10), with one addition.

DES-147's honesty about which REQ-112 clauses are mechanically decidable is right, and their tie-break
("a rule that cannot be tested cannot be claimed") is the correct one. Addition from this lens: the
**guide must mark them differently** — an "enforced (refused with this code)" section and an
"authoring convention (not checked)" section. An author who cannot tell which is which either fights
a checker that isn't there or ships a diagram that silently violates a rule they were told was a
rule. Same one-line cost as writing them in one undifferentiated list.

### ENDORSE — the `mode(args)` resolver (DES-138), with one addition.

Their biggest interface call gets a second vote: a `mode()` function on the row is code, but it is
co-located with the row, total (their `'invalid'` fallback routing to a schema error, not a
permission error, is the right choice for a cold model), and enumerable by a fixture test.
Escalation logic in the handler is the v22-H2 defect class. **Addition:** when `authorize` refuses,
the resolved **mode must appear in the refusal envelope's `detail`** (`detail.mode:'stdio'`).
Otherwise a caller refused on `workspace_push` — which has four outcomes — cannot tell which rule
refused them, and neither can an operator reading the log. One field, and it is the difference
between an authz seam that is observable and one that is merely correct.

---

## 4. Self-sustainability

### S-7 — HOLD. This is my main remaining open item.

DES-141 handles the **malformed** case well (an invalid role string refuses boot with
`process.exit(1)` — louder than I proposed, and I endorse it). It says nothing about the **missing**
case, which is the one ADR-028's rationale rests on: an unwired or absent `principals` block "locks
the operator out visibly, not grants everyone `admin` silently". **Visibility is still asserted, not
built.** Nothing announces the state; an operator discovers it by trying `workflow_register` and
being refused, then guessing why.

The build is small and I hold it unchanged from r1: **one startup line and three `system_info`
fields** stating auth mode, `principals` entry count, and the effective default role — plus, per
R-6b, the ownerless-row counts. `system_info` already exists, is read-only, and is one of the 35.
Then "locked out within minutes" is *announced* rather than *discovered*, and the `composeConfig`
bug class — which has now bitten this project twice (v11 `updateFlagPath`, v15 auth) and whose only
existing detector is a real Gate 7.5 run — gains a detector that fires at boot.

Anticipating the simplicity objection: this is one `console.log` and three fields on an existing
read-only tool. It is not a subsystem. The asymmetry it fixes is that v24 spends real design effort on
failing closed and zero on saying so.

### S-8 — one converged, two held (both LOW).

**(b) CONVERGED.** DES-148 walks the pre-v24 global tree into `assets(workflow='',
pushedBy='legacy')` rows with no FS move — the global tree path is unchanged in ARCH-102. Agreed;
rows only, one fewer task, no half-moved tree.

**(a) HOLD.** `schedules.workflow → claimedBy, then drop` uses SQLite `ALTER TABLE … DROP COLUMN`,
which needs **SQLite ≥ 3.35**. better-sqlite3 bundles a newer one, so this is fine today — but a
rebuild against a system SQLite turns it into a boot failure nobody predicted, and the note costs one
line beside the migration in task 11. DES-148 pins the catalog migration's ordering and idempotency
carefully; the scheduler migration deserves the same sentence.

**(c) HOLD.** `deregister` deletes `workflow_versions`/`workflows`/`assets` rows in one transaction
(DES-148) while the FS removal is an after-hook outside it (ARCH-098). A failure there leaves an
orphan `<workRoot>/<name>/assets/` tree with no row — unreachable, uncounted, growing. Pin the
reclaim to the **existing workspace-GC sweep** (ARCH-022 / `workspace-gc.ts`): reclaim asset trees
with no `assets` row. Not a log line, not a manual runbook step. Note this is the same shape as
DES-153's accepted "crash between tree and row leaves an unlisted directory that the next push
overwrites" — except deregister has no next push, so it needs the sweep.

### S-9 — standing, no dispute.

The v24 autonomy ledger is net positive and should be claimed in the design: **deleted** an async
single-flight LLM subsystem, its config block, its reconcile machinery, two `diagramStatus` states and
a regenerate tool; **added** two tables, five columns and one bounded coalesced counter (bounded in
meaning too, once O-11b's reset lands). Registration no longer depends on a provider being reachable.

**Still out of scope, one sentence each** (unchanged from r1, and no other lens has proposed
otherwise): **tool-liveness probing** — REQ-113 gives an author *discovery* of provisioned MCP for the
first time, which is the precondition, but nothing asks for probing, and the one probe that exists
(`mcp-probe.ts`, at push time) is a validation gate, not a liveness monitor; **memory metabolism /
context compression** — runs are bounded and journalled, there is no resident memory to compress;
**self-reflection / prompt calibration** — nothing in REQ-107..118 asks for it, and inventing it is
scope invention, not quality.

---

## 5. Task partition — every r1 rule of mine adjudicated against their 18-row table

| my r1 rule | their tasks | verdict |
|---|---|---|
| 1. `TOOL_SPECS` + `authorize()` + the server wire are ONE task | 2, 3, 15 | **CONCEDE the split, one condition** |
| 2. `principals` wiring + its wiring-test row + S-7's announcement are one task | folded into 15 | **HOLD — split task 15** |
| 3. descriptor + `deriveAgentRecords` are one task | 10 (run store) / 14 (asset-sync + descriptor) | **HOLD — assign to 14** |
| 4. `ERROR_CATALOG` lands before any v24 typed error | 1 | **CONVERGED** |
| 5. migrations precede the facade | 13 before 15 | **CONVERGED** |
| 6. guide builder last among code tasks; REQ-118 table after it | 16 then 17 | **CONVERGED** |
| 7. the client-plugin rename needs a tracked task | absent | **HOLD — add task 19** |

**Rule 1 — CONCEDE, conditioned.** Their defence is sound: task 2's drift-locks run over
`projectToolsList()` and task 3's over `authorize()`, both pure, both green in isolation. My r1 worry
("green at no intermediate state") was about a *live-server* lock, so the condition is placement, not
merging: **the "`tools/list` over real HTTP contains none of the 15 old names" assertion belongs to
task 15 (or 17), not task 2.** DES-140 already puts `mcp-tools-list-http.test.ts` at task 15 — so
this is agreement once stated. Task 2's own old-name lock stays over the projection.

**Rule 2 — HOLD, and it is really a "task 15 is too big" objection.** Task 15 currently carries
DES-140 + 141 + 149 + 155 + 156: `callTool`'s deps refactor, `composeConfig` forwarding, the facade
register/claim sequence, six `workspace_*` tools, and four read projections. That is the largest task
in the table by a wide margin and it is the one a lower-tier implementer is running. Split it:
**15a** = `Principal` at the edge + `composeConfig` forwarding + `normalizePrincipals` + the S-7 boot
announcement + the wiring-test rows; **15b** = `callTool(deps)` + the register/claim sequence +
`workspace_*` + projections. 15a is small, self-contained, and is the task whose *absence* is the
twice-repeated `composeConfig` bug — it should not be a subsection of the biggest task in the run.

**Rule 3 — HOLD.** The `deriveAgentRecords` one-liner and its `run_status` test belong to **task 14**
(which already owns the descriptor via DES-154/160), not task 10 (run store) and not "wherever". A
task boundary between a field's producer and its consumer is exactly how a write-only field ships,
and this one has a live example: `label` has been on `AgentRecord` since v1 (`git log -S`) and the
reconstruct path has never once populated it.

**Rule 7 — HOLD, and it grew.** The client plugin (ARCH-013, separate repo, no SDLC ledger of its own)
now takes **three** independent v24 breaks: the 15 tool renames, `?namespace=` removal on both HTTP
routes (DES-142), and its guidance skill still teaching the old surface. REQ-117 is measured on what
a **cold client** sees, and a cold client sees the plugin. Add **task 19: "client plugin v24 sync —
external, owner-scheduled, blocks the REQ-117 probe"**. A task that says so is honest; no task at all
is how the probe gets run against a plugin still saying `workflow_run`. (**QD-R11 stays MID, scope
tripled.**)

**Their two ordering constraints — CONCEDE both, one condition.** Task 9 (deletion) before task 15,
and task 18 (the 113-file rename sweep) last but before Gate 5's RED confirmation: both are right,
and the second is the difference between 113 rename failures drowning the genuine REDs and not.
Condition, from this project's own history: **a WIP commit per task**, because the window between
task 9 and task 15 is a deliberately red tree, and this ledger has already lost a full iteration's
work to an agent operating on a tree it could not cleanly diff (CLAUDE.md, 2026-08-31). Also, task
18 should land as a **mechanical commit whose message carries the `grep -c` before/after counts**, so
a 113-file diff is reviewable as a number rather than by reading it.

---

## Remaining disagreements (what round 3 or the synthesizer must settle)

1. **S-7 — the boot announcement.** Held, unaddressed by the adversarial group. One log line + three
   `system_info` fields. If the synthesizer strikes it, ADR-028's rationale sentence ("locks the
   operator out *visibly*") should be edited to drop the word, because it would no longer be true.
2. **O-7b — `materialized` on a `surfaceType:'none'` dispatch.** Option (a) skip-and-report-empty vs
   (b) keep-and-document. Contingent on whether the gateway target is resolvable before dispatch,
   which the synthesizer must check.
3. **O-8 / task 14 — the descriptor's consumer.** Agreement on the field, no agreement yet on who
   owns `deriveAgentRecords`.
4. **R-9's generalization** — warn on *any* unrecognized top-level config key, not only
   `graphAnalyzer`. Minor, and I hold it lightly.
5. **O-11b/c** — `refusalCount`'s reset, and the two `schedules.workflow` consumers not yet
   enumerated.
5b. **C-5's lock** — whether the four upstream result types are constrained to `ErrorCode` (making
   `tsc` the lock) or the grep lock ships alone with its six-code hole.
6. **Splitting task 15.** A partition objection, not a design objection; the synthesizer decides.
7. **`outputSchema` publishing.** Endorsed as an oracle; publishing deferred until the `tools/list`
   byte baseline exists. Not a conflict, an ordering.

## Withdrawn this round (so the synthesizer does not carry them)

QD-D1 (HIGH → LOW, kept only as a direct-fetch fixture) · QD-D4 (HIGH → MID, re-aimed at always-on
`tools/list` bytes as a regression guard, my invented 24KB numbers dropped) · QD-D5 (closed by
DES-139, which is stronger) · QD-D9 (MID → LOW, free under DES-151's synchronous append) · QD-D10
(closed as specified by DES-141) · QD-D12 (closed by DES-142) · C-5's fence (withdrawn; eight of the nine
non-literal sites need nothing, and the finding is now the grep lock's six-code hole) · R-10's test (subsumed by DES-143) · O-12 (closed by DES-158,
minus the `afterAll` truncation defect) · my r1 partition rules 1, 4, 5 and 6 (converged with their
table).
