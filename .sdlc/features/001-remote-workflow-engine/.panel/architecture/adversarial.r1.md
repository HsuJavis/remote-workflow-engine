# Architecture panel — Adversarial group (Security × Scalability/Consistency × Testability), round 1

**Iteration**: v23 (REQ-101..106) — **Gate 2 RE-RUN #2**, for the Gate 8 **re-review** send-back at
`41e6382` (`07-review.md` §8: `send_back = ["architecture","tests","impl"]`, `consistent: NO`,
**1 HIGH · 4 MED · 4 LOW**; the HIGH is the unfixed half of the *previous* send-back's A3).

**This file supersedes the previous `adversarial.r1.md`** (written for the first send-back at
`d294880`, which argued A1–A10 / V-A–V-D into ARCH-077..086). That round's amendments are **not
re-opened**: eight of them were verified CLOSED in code this pass. This round argues only what must
change *now that the amended architecture and the shipped code disagree in four specific places*.

**Baseline read this pass** (every claim below is anchored at `file:line` I opened, not quoted from
the ledger — this iteration has recorded seven ledger-honesty gaps, so no ARCH/DES/IMPL sentence was
accepted as evidence of code behaviour):
`src/graph-analyzer.ts` (whole file, esp. `:110-145`, `:170-235`, `:250-271`, `:299-400`),
`src/server.ts:173`, `:948-960`, `:1476-1516`, `src/main.ts:184`, `src/mcp-facade.ts:462`,
`src/diagram-gate.ts:18-26`, `tests/unit/graph-analyzer.test.ts:695-745`,
`02-architecture.md:555`, `:1403` (ARCH-079's whole invariant list), `:1456`, `:1478` (ADR-016),
`:1611`, `:1708`, and `07-review.md` §4/§8/§9.

**Lens.** Three lenses that trade against each other: **(a) security** — authn/authz correctness,
secret/script protection, attack surface; **(b) scalability & consistency** — state storage,
concurrency, the correctness of *counting* under failure; **(c) testability** — module boundaries,
injectable dependencies, oracles that can actually go red. §7 is where they fight. **Karpathy
simplicity-first is the tie-breaker**: the minimum architecture that closes the deviation, nothing
speculative.

---

## §0 Altitude call (done first, per the panel brief)

`tech_stack` describes a Node 22 / TypeScript ESM server: hand-rolled JSON-RPC-over-HTTP, two
`better-sqlite3` stores, an OAuth2 authorization server of its own, a `node:vm` + child-process
sandbox, an in-memory scheduler. That is a **conventional system**. It *also* describes `agent()`
dispatch through two `GatewayClient` implementations into real LLMs and — new in v23 — **the engine
itself as an LLM consumer for an internal control surface** (`GraphAnalyzer` → `gateway.invoke()`).
So **both altitudes apply, and they own different findings in this send-back**:

- **System altitude** owns R-1 (async lifecycle, slot accounting, process termination), R-2/R-2b
  (log-as-state-machine-record), R-4 (request-path I/O), R-6 / CONS-1 (interface drift-locks).
- **Agent altitude** owns R-3: `graphAnalyzer.enabled:false` is not a feature flag, it is the
  operator's **script-egress control** — the one switch that stops a registered (and, since v22,
  masked) workflow script from being shipped to a third-party provider. Its correctness property is
  "no code path reaches the model", which is an *agent-system* property; a conventional feature flag
  would be satisfied by "the feature appears off".

**What I deliberately do not force.** The standing lens charter names JWT forgery, brute force,
distributed failure counters and timing attacks. **None of those is this send-back's surface**: the
v15 token path is untouched by v23 (no v23 IMPL lists `auth*.ts` on its `files:` line), and no
failure counter is distributed — inv 10 already fixed the bounds as *per-process*. The charter items
that *are* live, translated to real surfaces: **egress control correctness** (R-3), **a bound whose
loss is indistinguishable from correct operation** (R-1, and this is the closest thing here to a
"failure counting consistency" problem), and **a log channel that can echo request text** (R-2's
`cause` field). Forcing the rest would spend the round's credibility on prose.

---

## §1 Summary

**Position in one line:** three of the four MED/HIGH items are the *same shape* — an invariant was
amended in round 1 and implemented "to the letter of its most convenient clause" in round 2, with no
record of the downgrade — and the fix for that shape is **not more prose; it is to move each rule to
a choke point where the narrower implementation is not expressible, and to hand Gate 5 oracles that
are red against today's tree.**

Rulings I propose, each argued in §3:

| # | Item | Ruling | Net new mechanism |
|---|---|---|---|
| **P1** | R-1 (HIGH) — inv 2's wrap covers one `await`, not the closure | **Re-assert inv 2 unchanged. It is right; the code is wrong.** Architecture adds only the *residual hole* the ordered shape still has (P2) and three red-today oracles | 0 (Gate 6 owes ~8 lines) |
| **P2** | NEW **V-E** — a naive `finally { this._release(key) }` **double-releases** with `_runJob`'s tail release: `_runningCount` goes negative and concurrency-1 silently becomes concurrency-N | **Amend inv 2**: `_release` is **idempotent per key**, and `_runningCount` is never negative — stated as a testable floor, not a review note | one `if` |
| **P3** | NEW **V-F** — the ordered `catch { settle + journal }` can itself throw (`_settleUnavailable` does three store calls), so the closure rejects anyway | **Amend inv 2**: the catch body is **total** — a failed settle still journals and still releases; the row stays `pending` and the next boot sweep settles it (ADR-017's existing crash path, reused, not extended) | one nested `try` |
| **P4** | R-2b/OBS-2 (MED) — emitter still inside `_attempt`; the B5 restore logs `unavailable` over a row it writes `ready` | **Hold inv 5 as amended (settle choke point). Do not ratify per-attempt lines.** Introduce one private `_settle()` that writes the row *and* emits the line; `_attempt` returns telemetry instead of logging | one function, 3 call sites moved |
| **P5** | R-2/OBS-1 (MED) — 10 shipped keys vs 11 pinned (`cause` absent) | **Keep `cause`; implement it.** But **amend its type**: a closed union, never `string` — ADR-016's "never raw provider text" must be enforced by the compiler, not by care | one union type |
| **P6** | R-3 (MED) — inv 11's guard sits at 4 caller sites, not at `_startJob` | **Build the choke point.** Decline the pre-authorized fallback. Security lens overrules the churn objection; testability lens gets it **sequenced after P1**, not merged into it | one `if` + two moved lines + one param |
| **P7** | SUS-2 (MED) — ADR-020's "loud boot warning when `tools` is non-empty" never built | **Re-assert. Doc is right, code is missing.** Add the mirror-test row so the third mitigation cannot be dropped silently again | 0 (Gate 6 owes one `console.warn`) |
| **P8** | R-6 (LOW) — doc says 39 tools, code declares 40 | **Delete the number from the architecture**, do not correct it. A count in prose is a second source of truth; the amendment that carries it *replaced a count-based lock with set equality* | −1 claim |
| **P9** | CONS-1 (LOW) — ARCH-085 lists six `graphAnalyzer` keys, nine ship | **Replace the enumerated literal with the derived type.** `server.ts:173` already says `Partial<GraphAnalyzerConfig>` — one declaration, nine keys, cannot drift again | −1 re-typed list |
| **P10** | Interface table's journal row contradicts itself (`:1708`) | Strike the trailing clause. Doc-only, one line | 0 |
| **P11** | R-4 (LOW) — analyzer store I/O on the registration request path | **Make `enqueue()` total at its own front door**, not `try/catch` at the caller — the same choke-point argument as P6, applied consistently | one `try` |

**Net new mechanism across all eleven: one function, three `if`/`try` statements, one union type,
one parameter, and two deleted claims.** No new module, no new store, no new config key, no
migration, no global handler. That is the correct output for a gate whose defect is *deviation from
an already-agreed shape*, not missing design.

---

## §2 Key points

1. **The architecture text is not the problem this round; the *enforcement site* is.** Round 1's
   amendments were correct and were verified correct in code eight times out of ten. The two that
   failed (inv 2, inv 11) failed the same way: they described a **property** ("the bound holds on
   every exit path", "no path reaches the gateway") and Gate 6 shipped the **narrowest instance**
   that satisfies the sentence's example. A property enforced at N call sites is not a property; it
   is N chances to be right. Both fixes I propose are *reductions* in site count (4 → 1 for the
   egress guard, 3 → 1 for the settle emitter), which is why simplicity-first does not fight
   security here — this once, they agree.

2. **R-1 is a bound whose loss is invisible, which is the only reason it survived four gates.**
   ARCH-079 inv 2 itself says it: a wedged slot reports `QUEUE_FULL`, and `QUEUE_FULL` is *designed*
   behaviour. There is no metric, no log line, and no test that distinguishes "the queue is busy"
   from "the queue has been dead since boot". Everything else in this document is secondary to
   making that state **observable** (P4's settle line at the choke point) and **impossible** (P2's
   floor assertion).

3. **R-1's blast radius is process-level, not queue-level — stated precisely, without the overclaim
   both panels already withdrew once.** Node 22's default for an unhandled rejection is to
   terminate the process; `grep -rn "unhandledRejection" src/` is empty; and the reachable throw
   sites (`getTriggerBindings`, `putDiagramResult`) are inside a closure scheduled from
   `sweepAtBoot()` at `server.ts:1507`. So a single orphan `pending` row can take the engine down
   **at boot**. It is bounded to **one** such restart by inv 9 (the sweep stamps before it
   schedules, so the second boot takes the "stamped by a dead process" branch and settles with zero
   model calls) — this is *not* the unbounded crash-loop the round-1 panels filed and withdrew. One
   crash, one restart, then correct. That is still an availability defect on the boot path, and it
   is the reason I keep R-1 at HIGH rather than accepting "it only leaks a slot".

4. **The oracle problem is the real finding.** The reviewer ran
   `npx vitest run tests/unit/graph-analyzer.test.ts` → **33/33 green with the defect present**, and
   the full suite → **1837 green**. UT-125 (`tests/unit/graph-analyzer.test.ts:703-743`) asserts the
   released claim, the released slot and the next job — and **drops the ordered assertion (b), that
   the orphan row settles**; its own docblock calls the `scriptPromise` rejection *"the one
   reachable throw"*, which the four throw sites in `_runJob` falsify. Architecture's deliverable
   this round is therefore not only amended prose but **five oracles that are red against
   `41e6382`** (§4). An architecture that ships an invariant without a red-today oracle has shipped
   a wish.

5. **One new rule, and only one** (this ledger's own retro asked for it, §9 item 1): **an
   implementation that deviates from an amended invariant must amend that invariant in the same
   commit.** I would put it in ARCH-079's preamble rather than leave it in a retro, because a retro
   is not a gate input. R-3 is the pure case: the shipped shape is *defensible* (it has no live
   hole, and the architecture pre-authorized a weaker fallback), and it is still a finding **solely
   because nothing recorded taking the fallback**. The doc and the code disagreeing is the defect,
   independent of which one is better.

---

## §3 Proposals

### P1 — R-1: re-assert inv 2 verbatim; the amendment was right and is still unbuilt

**Finding, re-verified this pass** at `src/graph-analyzer.ts:255-264`:

```ts
const job = async (): Promise<void> => {
  let script: string;
  try { script = await scriptPromise; }
  catch { this._release(key); return; }          // no settle, no journal
  await this._runJob(name, version, script, principal, key, priorRow);   // OUTSIDE the try
};
```

and `:127` — `this._schedule = deps.schedule ?? ((job) => { setImmediate(() => { void job(); }); })`,
i.e. the belt-and-braces `.catch()` was not added either. `_release` is otherwise reached only at
`_runJob`'s tail.

**Ruling: no amendment.** ARCH-079 inv 2 as amended already prescribes exactly the right shape —
*"the `try { … } catch { settle + journal } finally { release + drain }` **wraps the scheduled
closure**"* — and it is right for the reason it gives: the claim and the slot are taken in
`_startJob`, so any narrower wrap leaves an exit path that never releases. Architecture does not owe
new text for R-1; **it owes the two residual holes the ordered shape still has (P2, P3) and the
oracles (§4).** Gate 6 owes ~8 lines: wrap the closure, `catch` → settle + journal, `finally` →
release + drain, **delete `_runJob`'s tail release**, add the `.catch()` backstop at `:127`.

**Why the `.catch()` at `:127` is belt-and-braces and not the mechanism** (worth restating, because
it is the clause most likely to be "implemented instead of" the real one): `schedule` is an
injectable seam (inv 8), so an invariant enforced only in the *default* seam is one every test that
injects `runInline` never exercises — which is precisely how this defect reached Gate 8 twice.

---

### P2 — NEW (V-E): the ordered `finally` **double-releases** unless `_release` is made idempotent — and a negative `_runningCount` silently converts concurrency-1 into unbounded concurrency

This is the most consequential thing in this file, and no panel has filed it.

`_release(key)` does three things: `_pendingKeys.delete(key)`, `_runningCount--`, and drain (shift
the queue, `_runningCount++`, schedule). Today it is called from **`_runJob`'s tail** on the normal
path. P1's ordered fix adds a `finally { this._release(key) }` around the closure — and `_runJob`
runs *inside* that closure. **If Gate 6 adds the `finally` without deleting the tail release — the
single most likely partial implementation, and this iteration's demonstrated failure mode — every
successful job releases twice.** `_runningCount` then goes `1 → 0 → -1`, and `_startJob`'s admission
test is `if (this._runningCount >= 1) queue else run`. At `-1`, **every** subsequent job runs
immediately: the "concurrency: 1, bounded queue" invariant becomes unbounded parallel
`gateway.invoke()` — an internal LLM caller with no bound, which ARCH-079's own note calls "the scar
this engine already carries (D-G8-4)". Cost amplification and provider rate-limit exhaustion, from a
two-line edit that looks like the fix.

Note the asymmetry that makes this worth an invariant rather than a code review comment: the
**leak** direction (R-1) fails closed and loudly-ish (`QUEUE_FULL`); the **double-release** direction
fails **open and silently** — more diagrams get drawn, faster, and every test that asserts "the next
job runs" goes *greener*. A test suite cannot distinguish it from a performance improvement.

**Amendment to ARCH-079 inv 2 (append):**

> **The release is idempotent per key.** `_release(key)` returns without effect unless the key is
> still claimed (`_pendingKeys.has(key)`); the claim is the authoritative record that this unit still
> owns a slot. Consequences pinned as testable floors: **`_runningCount` is never negative**, and
> **`_runningCount` never exceeds 1**, at any observable point, including after a job that both
> throws and completes a settle. The `finally` in inv 2's closure is therefore the *only* release
> site; `_runJob`'s tail release is deleted, and if a future edit re-adds one, idempotence — not
> review vigilance — is what keeps the bound true.

**Cost: one `if`.** Simplicity-first note: I considered and rejected a counter/semaphore abstraction
(`agent-semaphore.ts` already exists, unclaimed, in the `solid_check` LOW list). Reusing it here
would be a module-boundary change at a send-back gate to solve a problem one `if` solves.

---

### P3 — NEW (V-F): the ordered `catch { settle + journal }` can itself throw, so "the closure never rejects" is not yet true

`_settleUnavailable` (`:204-221`) performs `getDiagram`, `getTriggerBindings(name, this._ports)` and
`putDiagramResult` — the *same* three store/port calls that are the reachable throw sites R-1 is
about. So the ordered `catch { settle + journal }` calls, in its recovery path, the code whose
failure it is recovering from. If `putDiagramResult` is what threw, the settle throws too, the
`finally` still releases (good), and the closure **still rejects** (bad) — inv 2's headline claim,
*"the closure never rejects"*, remains false, and the process still terminates at boot.

**Amendment to ARCH-079 inv 2 (append):**

> **The catch body is total.** The settle attempt inside the `catch` is itself wrapped; if it fails,
> the journal line is still emitted (with `outcome:'unavailable'` and `cause:'settle_failed'`) and
> the `finally` still releases. The row is then left `pending` **on purpose**: that is exactly the
> state ADR-017's boot sweep already resolves (inv 9 stamps before scheduling, so the next boot
> settles it with zero model calls). No new recovery path is built — the existing one is named as
> the fallback, so "we could not settle" is a *recorded* state rather than an unhandled rejection.
> `_journal` is a `console.log` of engine-classified fields only and cannot throw, which is what
> makes this ordering safe; that property is now load-bearing and is stated here so a future edit
> that makes the emitter do I/O has to come back to this sentence.

**Cost: one nested `try`.** This is the difference between an invariant that holds on the paths we
imagined and one that holds on the path that actually breaks.

---

### P4 — R-2b/OBS-2: hold inv 5 (settle choke point); do **not** ratify per-attempt lines

**Finding, re-verified:** `grep -n "_journal(" src/graph-analyzer.ts` → `212` (`_settleUnavailable`),
`223` (declaration), **`339` (`_attempt`)**. Two consequences, both real:

1. With `retries > 0` the `do/while` at `:369-373` emits N lines for one settle. (Shipped default is
   `retries: 0` at `server.ts:1480`, so this is config-dependent — but `retries` is a REQ-104
   operator knob, so "the default hides it" is not a defence.)
2. **The B5 prior-ready restore (`:378-383`) writes the row `status:'ready'` while the only line
   emitted for that settle says `outcome:'unavailable'`.** The journal actively contradicts the
   store. This is a defect **under either reading of inv 5**, which is why the reviewer said so.

**Ruling: hold the amended invariant.** Gate 2 already adjudicated this once (referee call R-1,
quality's §1.1 adopted over adversarial's §5.4) — re-litigating an adjudicated call because the
implementation went the other way is exactly the ratchet this send-back exists to stop. Beyond
precedent, the substantive argument: a **settle** is the state transition an operator counts (one
diagram, one outcome, one cost); an **attempt** is an implementation detail of the retry policy. A
log whose line count varies with a config knob cannot be summed into "how many diagrams settled
unavailable this week" without knowing that knob's history.

**Minimal shape (this is the whole design):** one private method

> `_settle(name, version, row, telemetry)` — the **only** caller of
> `catalog.putDiagramResult(...)`, and the only caller of `_journal(...)`. Every terminal path goes
> through it: `_settleUnavailable`'s zero-call settle, `_runJob`'s three branches (`ready`, B5
> restore, `unavailable`), and inv 2's catch. `_attempt` **returns** its telemetry
> (`promptTokens`, `completionTokens`, `durationMs`, `gateFail`) inside its existing
> `AttemptOutcome` union instead of logging it.

Two properties fall out **by construction** rather than by care: the journal line's `outcome` is
computed from the very row being written (B5 can no longer disagree with itself), and "exactly one
line per settle" is true because there is exactly one place that writes a terminal row.

**Cost accounting across a retry loop, so the move loses nothing:** `promptTokens` /
`completionTokens` / `durationMs` are **summed across attempts** (cost attribution is the reason
inv 5 exists — S-1), `gateFail` and `noteCode` come from the last attempt, and I propose one extra
field, **`attempts: number`**, as the minimum that preserves the only information the move destroys.
*Marked referee-decidable*: if the referee judges a twelfth field to be scope, drop it and record
"per-attempt visibility is lost when `retries > 0`" as named debt — but do not keep the `_attempt`
emitter as the way to get it back.

**The B5 restore line's exact shape, pinned here so this proposal does not leave the very ambiguity
it is filed against.** Under O5 the restore settle must log the row it wrote, i.e.
`outcome:'ready'` — but the attempt that triggered it *failed*, so "`noteCode`/`gateFail` from the
last attempt" is ambiguous exactly where Gate 6 has twice taken the convenient clause. Pinned:
**`outcome:'ready'`, `noteCode:null`** (preserving the shipped `ready ⇒ noteCode null` convention,
which `workflow-view.ts`'s note precedence relies on), `gateFail` from the last attempt (it is a
model-call fact, null when no call was made), and the failure class carried by
**`cause:'prior_restored'`** — added to P5's union. So the line reads "this settle left a good
diagram in place, and here is why a new one was not drawn", which is the only reading an operator
can act on.

---

### P5 — R-2/OBS-1: keep `cause`, and make it a closed union (the security half no one has stated)

**Finding, re-verified:** `_journal`'s parameter type and its `JSON.stringify` literal
(`:223-233`) both carry exactly ten keys; `cause` exists nowhere in `src/`. The amended inv 5,
ADR-016's true-up and the interface table's journal row all pin **eleven**.

**Ruling: implement `cause`, do not amend it away.** It is not decoration: inv 11 makes
`RETRIES_EXHAUSTED` cover *three operationally distinct* states — the operator switched the
analyzer off, a previous process died mid-generation, and the provider genuinely failed after
retries — which are identical on both the persisted channel (the `note_code` `CHECK` stays at eight
values, no migration) and the user-visible channel (one enum string). Without `cause`, the operator
cannot tell "I did this" from "the provider is down". That is the same class as this repo's
`composeConfig` forwarding-gap signature, which inv 5 was amended to make loud.

**But the security lens amends its *type*, and this is my one substantive change to an
already-amended invariant:**

> **Amendment to inv 5 (and the same sentence to ADR-016):** `cause` is a **closed union of
> engine-authored literals** — today `'disabled' | 'model_unmapped' | 'queue_full' |
> 'boot_abandoned' | 'provider_terminal' | 'gate_refused' | 'script_unresolved' | 'prior_restored' |
> 'settle_failed'` —
> declared once beside `GateFailReason` and **never typed `string`**. ADR-016's rule ("the journal
> carries an engine-classified error class, never raw provider or model text, because a provider
> error payload can echo the request and the request contains the masked script") is currently held
> by a `catch` that discards the error object at `:318`. A field typed `string` re-opens that
> channel with a one-line diff and no security thought; a union makes the leak a **compile error**.

This is the cheapest possible enforcement of the one genuine confidentiality property v23 added
(REQ-100's mask must not be undone by the analyzer's own log), and it costs a type alias.

---

### P6 — R-3: build inv 11's choke point; decline the pre-authorized fallback

**Finding, re-verified:** the `enabled` guard is at `graph-analyzer.ts:138` (`enqueue`) and `:181`
(`sweepAtBoot`); `_startJob` (`:250-271`) reads `this._config.enabled` **nowhere**;
`putDiagramPending` was **not** moved behind any guard (still at `enqueue:152` / `sweepAtBoot:187`);
`_startJob` takes no stamp parameter. Total sites now carrying this one rule: `server.ts:955`,
`mcp-facade.ts:462`, `graph-analyzer.ts:138`, `:181` — **four, across three modules.** The
architecture of record (inv 11) asserts a choke point that does not exist.

**The counterweight is real and I state it before my ruling:** there is **no live hole** — all three
`_startJob` callers are covered, UT-124 pins all three entry points plus the prior-`ready` clobber
trap, the guard-before-`putDiagramPending` ordering the amendment actually cared about *does* hold at
both sites, and inv 11 itself pre-authorized the weaker fallback ("QD-S1's requeue-branch-only `if`")
for exactly the situation we are in. On a pure risk-today reading, the shipped shape is fine and the
honest fix is a doc amendment.

**Ruling: build the choke point anyway.** Three grounds, in decreasing strength:

1. **Agent-altitude security.** `enabled:false` is the *script-egress* control — the switch an
   operator flips because DEPLOY §1b told them registration ships the script to the provider. Its
   correctness property is "no path reaches `this._gateway`", a **universal over paths**. A
   universal enforced at four sites in three modules is one refactor, one new caller, or one
   `regenerate`-shaped feature away from false; inv 11's own rationale is this repo's evidence:
   *"three callers each carrying the check, two remembered, one forgot."* v22 already shipped a
   masking control that a later surface (`workflow_agent_log`) could have re-opened; that is the
   same story one iteration earlier.
2. **The fallback was authorized for a *cost* that has since been paid.** Its stated justification
   was "if Gate 6 wants zero structural change at a send-back gate". Gate 6 is now doing structural
   work in this exact function regardless (P1 rewrites the closure `_startJob` schedules). The
   marginal cost of the choke point is now **one `if`, two moved lines and one parameter**, against
   a permanent reduction from four rule-sites to one load-bearing site plus two defence-in-depth
   ones.
3. **Site count is the simplicity metric here.** Karpathy-minimal is not "smallest diff today"; it
   is "least machinery to maintain". Four copies of a security rule is more machinery than one.

**Shape (unchanged from inv 11, restated so Gate 6 cannot ship a third reading):** `_startJob`'s
first statement is the `enabled` check, **before either claim**; when disabled it **settles**
(`_settleUnavailable`, code `RETRIES_EXHAUSTED`, `cause:'disabled'` per P5) and returns.
`putDiagramPending` moves **into** `_startJob`, behind that guard, with `sweepAtBoot` passing its
attempt stamp as a parameter (inv 9's stamp-before-schedule ordering is preserved — it is now
stamp-inside-`_startJob`-before-schedule, which is strictly tighter). `enqueue` keeps reading
`priorRow` **before** calling `_startJob` and passes it through, so the B5 prior-`ready` protection
is unchanged. `server.ts:955` and `mcp-facade.ts:462` stay as defence-in-depth and each earn a
one-line assertion — they are no longer load-bearing.

**Sequencing, and this is a condition of my ruling, not a note:** P6 lands as a **separate RED→GREEN
step after P1/P2/P3**, not in the same commit. Two structural changes to the same closure in one
commit is how a fix and a regression become indistinguishable at Gate 8 — and this subsystem has now
produced two consecutive blocking rounds by exactly that mechanism.

---

### P7 — SUS-2: re-assert ADR-020(c); the doc is right and the mitigation is missing

**Finding, re-verified:** `src/server.ts:1512` is the only analyzer-tools boot line and it is an
unconditional `console.log`, byte-identical in form for `tools=[]` and `tools=["Bash","Write"]`;
`console.warn` appears once in this block, for the unknown-alias case at `:1497`. ADR-020 decision
(c) is verbatim *"mandate the key, default it to `[]`, **warn loudly at boot when it is non-empty**,
and record non-empty as an accepted operator risk."*

**Ruling: no amendment — Gate 6 owes one conditional `console.warn` beside `:1512`, naming the risk
in the operator's words** (a non-empty tool surface gives the analyzer model tools inside the
scratch jail). ADR-020 is the decision that *permits* the key to exist at all; two of its three
mitigations shipped and the one that converts a silent hazard into an **accepted** one did not. An
ADR whose permission survives and whose condition does not is a decision that was never actually
made. The loud-line pattern already exists eight lines above (the fail-closed no-jail downgrade at
`:1486`), so this is reuse, not new machinery. **Add the mirror test row** (assert a warn-level line
when `tools` is non-empty and none when empty) — without it, this drops silently a second time.

---

### P8 — R-6: delete the count, don't correct it

`02-architecture.md:555` says `TOOL_NAMES` *"declares **39** tools, all 39 advertised"*; direct count
this pass: **40**. The delicious part is where the wrong number sits — **inside the amendment whose
entire purpose was to replace a count-based drift-lock with a set equality**, because a count cannot
detect a rename.

**Ruling: strike the number from ARCH-051/ARCH-082 rather than update it**, replacing it with the
mechanism: *"`TOOL_NAMES` (`server.ts:189-243`) is the single declaration; the advertised set is
pinned by IT-102's two-sided set equality against a hand-written literal that is never imported from
`server.ts`."* Correcting 39→40 buys one iteration of accuracy and re-arms the same trap; deleting
the claim removes a second source of truth permanently. (Same reasoning applied in P9.)

---

### P9 — CONS-1: replace the enumerated key list with the derived type

`02-architecture.md:1456` advertises
`FileConfig.graphAnalyzer?: {enabled?, model?, systemPrompt?, tools?, timeoutMs?, retries?}` — six
keys. The shipped block has **nine** (`maxBytes`, `maxLines`, `maxQueueDepth` added, ratified by
DES-134 for a REQ-104 reason), defaulted at `server.ts:1481-1483`.

**Checked, because this repo's signature bug is exactly here and a doc-only ruling would be wrong if
the wiring were broken:** `src/server.ts:173` declares `graphAnalyzer?: Partial<GraphAnalyzerConfig>`
— a **derived** type over the nine-key `GraphAnalyzerConfig` (`graph-analyzer.ts:75-85`) — and
`src/main.ts:184` forwards `graphAnalyzer: fileConfig.graphAnalyzer` **as a whole block**. So all
nine keys genuinely reach `ServerConfig`; this is **not** a `composeConfig` forwarding gap (v11
`updateFlagPath`, v15 `auth`, v16 `workspaceTtlMs`), and I say so explicitly because the row's
六-key text *looks* exactly like one and the next reader will assume it is.

**Ruling: doc-only, and fix it by pointing at the declaration** —
*"`FileConfig.graphAnalyzer?: Partial<GraphAnalyzerConfig>` (`server.ts:173`) — one declaration
(`graph-analyzer.ts:75-85`, nine keys today), forwarded whole through `composeConfig()`
(`main.ts:184`), defaulted at one place (`server.ts:1476-1484`), documented in
`rwe.config.example.json` + DEPLOY §1b."* A row that re-types a key list will drift on the tenth key;
a row that names the type cannot.

---

### P10 — the interface table's journal row contradicts itself in one line

`02-architecture.md:1708` states **"+ provider HTTP status" STRUCK** (A8) and then closes with
*"Engine-classified error class + provider HTTP status only"*. One line, both readings. **Strike the
trailing clause** → *"Engine-classified error class + token counts only; **never** transcript text,
raw provider text, or the script."* The mermaid note at `:1611` and ADR-016 at `:1478` already read
correctly, so this is the fourth-of-four site the A8 strike missed — the very defect class A8 was
written to repair.

---

### P11 — R-4 (LOW): make `enqueue()` total at its own front door

`server.ts:957` calls `graphAnalyzer.enqueue(...)` **synchronously and after**
`facade.workflow_register` has committed; `enqueue` does `getDiagram` + `putDiagramPending` (and on
a settle path, `getTriggerBindings` ×N + an `.immediate()` write). A throw turns a **committed**
registration into a failed tool response — the caller retries, gets `VERSION_CEILING_EXCEEDED` or a
duplicate version, and the engine has lied about what it did.

The reviewer's suggested fix is a two-line `try/catch` at the call site, marked "owner's call".
**I propose the choke-point form instead**, for consistency with P6: the analyzer's own front door
is total — `enqueue()` never throws at its caller; an internal failure settles (or, if the settle
fails, journals `cause:'settle_failed'` per P3) and returns. One `try` inside `enqueue` covers
`server.ts:957`, `mcp-facade.ts`'s regenerate path, and any future caller; a `try` at one call site
covers one call site. Still **LOW** — `better-sqlite3` is single-process-synchronous and inv 10 rules
multi-process contention out of scope — so this is a Gate 6 opportunistic item, not a blocker.

---

## §4 What architecture owes Gate 5: five oracles that are **red today**

Gate 8's retro item 2 is right — *"a deferred oracle is where this defect hides"* — so these are
listed with their owning gate on the scope line, not in a docblock. All five are reachable with
**seams that already exist** (`schedule`, `ports`, `catalog`, `gateway` are constructor-injected);
**no new seam is proposed**, which is the V-C amendment already paying for itself.

| # | Oracle | Red against `41e6382` because | Pins |
|---|---|---|---|
| **O1** | Injected `ports` whose `getTriggerBindings` throws, on a job reaching `_runJob`: assert (a) zero unhandled rejections, (b) **the row settles** `unavailable`, (c) exactly **one** journal line, (d) the next enqueued job runs, (e) `_runningCount === 0` | `_runJob` is outside the `try`; nothing settles, nothing journals, the slot leaks | inv 2, inv 5, P3 |
| **O2** | Injected `catalog` whose `putDiagramResult` throws **on the `ready` branch**: same five assertions | inv 8's V-C case, named as debt in UT-128's docblock `:497-501` and never picked up | inv 2, inv 5, inv 8 |
| **O3** | UT-125 **gains its dropped assertion (b)**: the orphan `ga-orphan@v1` row settles (not left `pending`) | the shipped `catch` calls `_release` only | inv 2, ADR-017 |
| **O4** | **Slot-accounting floor**: across a mixed burst (one throwing job, then `maxQueueDepth + 3` valid ones) assert `_runningCount` is never `< 0` and never `> 1` at any settle, and that concurrent `gateway.invoke` calls never exceed 1 | nothing today can observe a double release; this is the oracle that makes P2 falsifiable **before** Gate 6 writes the `finally` | inv 2 (P2) |
| **O5** | **Self-checking settle**: for every terminal path (all six, incl. B5 restore), assert the journal line's `outcome` **equals** the status of the row actually read back from the catalog | today the B5 restore writes `ready` and logs `unavailable` | inv 5 (P4) |

**O5 is the one I would keep if I could keep only one.** It is a *relational* oracle — it compares
two things the code produces rather than asserting a literal — so it cannot be satisfied by editing
the expected value to match the shipped behaviour, which is this iteration's documented test-drift
failure (v22's `val-107` rewritten to assert success; IT-080 built on the vulnerability it should
have caught). A relational oracle is the cheapest structural defence against an oracle that drifts
with the code.

Additionally, if the referee keeps P5's eleven/twelve-field list: **a `cause`-value assertion on
UT-128's five zero-model-call paths**, and a type-level assertion that `cause` is not `string`
(a `@ts-expect-error` on assigning an arbitrary string is enough).

---

## §5 What I decline to build (simplicity-first, stated so the declines are on the record)

- **A process-level `unhandledRejection` handler.** It would mask R-1 rather than fix it, at the
  wrong altitude (global) for a bound owned by one closure, and it would make O1/O2 pass without
  the invariant holding. Declined even though it is one line and would have prevented the boot
  crash — *because* it would have prevented the boot crash, which is the only reason this defect was
  ever visible.
- **A distributed lock / cross-process slot accounting.** Inv 10 already rules multi-instance over
  one catalog out of scope; P2's per-process floor is the honest bound.
- **A ninth persisted `note_code` + `CHECK` migration.** `cause` on the journal field is the
  precedent-backed (DES-129 `gateFail`) zero-migration answer; the migration stays scheduled debt.
- **A rate limiter over registrations** (v22 debt S-1: every registration now costs an LLM call).
  Concurrency 1 + queue cap + `timeoutMs` + `maxWorkflowVersions` bound it; a limiter is a new
  subsystem at a send-back gate.
- **Reusing `agent-semaphore.ts`** for P2 (see P2's note): a module-boundary change to replace one
  `if`.
- **A second render path / any change to A1, A4, A5, V-D, inv 4/6/9/10.** Verified CLOSED this pass;
  re-opening verified-closed items at a send-back round is how a gate loop fails to terminate.

---

## §6 Risks

| # | Risk | Severity | Mitigation I am proposing |
|---|---|---|---|
| **RK-1** | Gate 6 implements P1's `finally` **without** deleting `_runJob`'s tail release → concurrency-1 becomes unbounded, silently, and every existing test goes greener | **HIGH** (fails open; cost + provider rate limits) | P2's idempotent `_release` + **O4**, which is red *before* the `finally` is written |
| **RK-2** | P1 and P6 land in one commit → a fix and a regression in the same closure are indistinguishable at Gate 8, producing a **third** consecutive blocking round on this file | **HIGH** (process risk, and this loop has already run twice) | P6 sequenced as a separate RED→GREEN step; each with its own oracle |
| **RK-3** | The `catch { settle }` throws (P3) and the closure rejects anyway → R-1 is reported fixed while the boot-path termination remains | MED | P3's total catch + O1/O2 assert *zero unhandled rejections*, not "the row settled" |
| **RK-4** | `cause` ships as `string` and a later "helpful" edit concatenates the provider message → REQ-100's mask is undone through the log channel, silently, with no test failing | MED (confidentiality) | P5's closed union: the leak becomes a compile error |
| **RK-5** | Moving the emitter to `_settle` (P4) loses per-attempt cost visibility when an operator sets `retries > 0` | LOW | summed tokens/duration + `attempts` field; if the referee cuts `attempts`, record as named debt on the scope line — never in a docblock (retro item 2) |
| **RK-6** | Moving `putDiagramPending` into `_startJob` (P6) re-orders it relative to `enqueue`'s `priorRow` read → the B5 prior-`ready` protection silently regresses | MED | `priorRow` is read in `enqueue` **before** `_startJob` and passed through, unchanged; UT-124's fourth case (the latent-clobber trap) is the existing guard and must stay green |
| **RK-7** | The doc-only items (P8/P9/P10) are treated as cosmetic and deferred → the architecture of record keeps asserting a choke point, a key count and a struck clause that the code contradicts, and Gate 8 files them a third time | LOW individually, **structural in aggregate** | all four are ≤2 lines; they are the cheapest items in the round and there is no defensible reason to carry them |
| **RK-8** | This round adds text to an invariant that is already ~2 400 words (ARCH-079 inv 2/5/11) and the *next* implementer reads the most convenient clause again | MED (the documented failure mode) | P2/P3 are appended as **numbered, testable floors** (`never negative`, `never > 1`, `no unhandled rejection`), each with a named oracle — a floor with a test ID is not a clause to interpret |

---

## §7 Where my own three lenses conflict (the part the brief actually asks for)

1. **Security vs Testability — P6's timing.** Security wants the egress choke point *now*: four
   sites in three modules is a control with no owner, and the repo's own history is "two remembered,
   one forgot". Testability wants **zero** structural change to `_startJob` in the same round that
   rewrites the closure it schedules, because confounded changes are unverifiable and this exact
   confusion has now cost two Gate 8 rounds. **Resolution: build it, sequenced separately.** Neither
   lens gets what it asked for (security waits a step; testability accepts churn), and that is the
   correct outcome — the alternative "amend the doc to ratify four sites" makes the *architecture*
   the thing that drifted, which is worse than either.

2. **Scalability/consistency vs Security — the direction of P2's failure.** The consistency lens
   reads the missing `finally` as a **leak** (slot lost, queue wedged, `QUEUE_FULL` forever) and
   would fix it by always releasing. The security lens reads the *fix* as the bigger hazard: a leak
   fails **closed** (no model calls, no spend, honest-if-misleading `QUEUE_FULL`), while a
   double-release fails **open** (unbounded concurrent LLM calls, cost amplification, provider
   rate-limit exhaustion) and looks like a performance win to every test. **Resolution: idempotence
   plus a two-sided floor** (`never < 0` *and* `never > 1`). The one-sided fix each lens would have
   written alone is wrong in the other's direction.

3. **Observability vs Confidentiality — P5's `cause`.** Observability wants the distinct reason on
   the log line and, taken alone, would type it `string` and let the provider's own message through
   (that is the most *useful* value). Confidentiality says the request contains the v22-masked
   script and a provider error payload can echo the request. **Resolution: keep the field, close the
   type.** The observability gain (distinguishing "operator disabled it" / "process died" /
   "provider failed") is fully realised by eight engine literals; the leak is fully prevented by the
   compiler. This is the only place where the two lenses can both win outright, and it costs a type
   alias.

4. **Testability vs Security — injectable failure seams (V-C).** Testability needs `ports` and
   `catalog` to be able to throw on demand (O1/O2 do not exist otherwise). Security's reflex is that
   every seam is attack surface. **Resolution: dismissed, with the boundary stated** — these are
   **constructor** parameters resolved in the composition root, not config-reachable and not
   run-reachable; the hazard would be a test-only seam that is *also* an operator knob
   (`graphAnalyzer.tools` is precisely that, which is why ADR-020(c)'s warning in P7 is not
   optional). Recording the distinction is what stops the next seam from being added at the wrong
   altitude.

5. **Simplicity vs Observability — P4's `attempts`.** Simplicity says the settle line is already
   eleven fields and a twelfth is scope at a send-back gate. Observability says moving the emitter
   *destroys* information that exists today (per-attempt lines under `retries > 0`) and that
   deleting information is not simplification. **Resolution: propose it, mark it
   referee-decidable, and pre-commit to the debt entry if it is cut** — I am not willing to have
   the loss be silent either way, and that is the actual requirement.

---

## §8 Expected disagreements with the quality-dimensions lens (round 2 preview)

1. **P6 (inv 11 choke point) — the sharpest one.** Quality filed the **weaker** fix in round 1
   (QD-S1's requeue-branch-only `if`) and the reviewer graded R-3 quality-**LOW** / adversarial-MED.
   I expect them to argue *"no live hole; amend inv 11 to ratify the two-caller placement and say
   why; a send-back round is the wrong place for a structural move."* That is a coherent
   consumability/replaceability position and it is not stupid. **My concession in advance:** if the
   referee takes it, the amendment must state (a) that the guard is enforced at four sites across
   three modules, (b) that adding a caller requires carrying it, and (c) an assertion per site — a
   ratification that does not enumerate the cost is just the silence that produced R-3.

2. **P4's `attempts` field / a config-readback surface.** Quality's observability and
   self-sustainability altitudes tend to want *more* surface: an `attempts` field, a
   `graphAnalyzer_status` MCP tool, a persisted ninth note code. I expect to be arguing **against**
   at least the last two: the journal line is already the effective-config seam (inv 5's own
   rationale — an operator who edits `graphAnalyzer.model` sees the new model on the next line), and
   a second readback surface is a second thing that can disagree with the first.

3. **A process-level `unhandledRejection` handler.** Classic self-sustainability ask (the engine
   should not die at boot), and I decline it in §5 for a reason quality will find unsatisfying:
   masking is not surviving. Expect this to need a referee call. **My fallback if I lose:** the
   handler must **log and re-throw** in test/CI mode, or O1/O2 stop being able to fail.

4. **P8/P9 (delete the count, name the type).** Quality's consumability lens may prefer the
   architecture to spell keys out for a human reader rather than point at a TypeScript declaration.
   I would rather a reader follow one link than trust a list that has now drifted twice (39/40,
   six/nine) in a single iteration. Compromise available: keep the enumerated list **plus** the type
   name, on the explicit condition that the type name comes first, so a drifted list is visibly
   secondary.

5. **Where we will agree, stated so the referee does not have to discover it:** inv 5's settle choke
   point (they won that call in round 1 and I am holding their result **against** the shipped code),
   the B5 mismatch being a defect under either reading, SUS-2 (their filing, and it is right), and —
   I expect — P2 and P3 once stated, since both are pure "an invariant that does not hold on the
   failure path is prose", which is their vocabulary as much as mine.

---

## §9 Karpathy check on this round

**Net new mechanism, counted:** one private `_settle()` method (which *removes* two of the three
existing terminal-write sites and one of the two emitters), one `if` for idempotent release, one
nested `try` in a `catch`, one `if` + two moved lines + one parameter for the egress choke point, one
`try` at `enqueue`'s front door, one closed union type, one conditional `console.warn` (reusing the
pattern eight lines above it), one journal field, and — in the docs — **two claims deleted** (a tool
count, a re-typed key list) and one contradictory clause struck.

**Nothing new is stored, nothing new is configured, nothing new is exposed on any surface, no
migration.** Five of the eleven proposals *reduce* the number of places a rule lives (4 → 1 egress
sites, 3 → 1 emitter sites, 4 → 1 terminal-write sites, 2 → 1 release sites, 2 → 1 key-list sources).
That is the shape a send-back round should have: the defect was never missing design, it was a
design enforced in too many places to hold.
