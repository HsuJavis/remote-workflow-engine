# Architecture panel — Adversarial group (Security × Scalability × Testability), round 2

**Iteration**: v23 (REQ-101..106) — **Gate 2 RE-RUN** for the Gate 8 send-back at `d294880`.
**This file supersedes the pre-send-back `adversarial.r2.md`** of the same name (last version in git),
exactly as `adversarial.r1.md` supersedes its pre-send-back predecessor.

**Read this round**: `quality-dimensions.r1.md` (this round's, 565 lines) in full, and my own
`adversarial.r1.md`. Everything below is either a response to a named QD item, a **concession against
my own r1**, or one of two new findings that came out of checking their text against the code.

**Headline.** The two panels converged much further than either of us predicted — including on A1,
where we each expected a fight and independently landed on the *same* mechanism (transport gate,
single projection). What round 2 actually produced is **two corrections that invalidate fix text both
panels wrote in r1**:

- **N-1**: "put the release in a `finally` in `_runJob`" — *my* r1 P3 and *their* QD-S2 both say this,
  and it does not close the leak. The claim and the slot are taken in `_startJob`, and the `job`
  closure `await`s `scriptPromise` **before** `_runJob` is entered. The one reachable throw source in
  this subsystem is on that await. **§1.**
- **N-2**: QD-S1's "the operator sees `DISABLED` for free" is false for the row QD-S1 itself proposes
  to write. The read layer synthesizes `DISABLED` **only** when `diagram === null`. Both of us chose
  `RETRIES_EXHAUSTED` as the settle without noticing it reports a false cause. **§2.**

And **one concession against my own r1**: my P2 (guard at `_startJob`) has a latent
prior-`ready`-row destruction, which I found by checking *their* Risk #5 against the code. §3.

---

## 1. N-1 — the release must wrap the `job` closure, not `_runJob`. Corrects **both** panels' r1 fix text.

Verified at `graph-analyzer.ts:204-219`:

```
private _startJob(name, version, principal, key, scriptPromise, priorRow): void {
  this._pendingKeys.add(key);                       // :209  ← claim taken HERE
  const job = async (): Promise<void> => {
    const script = await scriptPromise;             // :211  ← can reject
    await this._runJob(name, version, script, principal, key, priorRow);
  };
  if (this._runningCount >= 1) { this._queue.push(job); }
  else { this._runningCount++; this._schedule(job); }   // :217  ← slot taken HERE
}
```

The releases (`_pendingKeys.delete`, `_runningCount--`, queue drain) are at the **tail of `_runJob`**
(`:337-343`). So:

- A `finally` **inside `_runJob`** — which is what my r1 P3 wrote ("the releases live in a `finally`")
  and what QD-S2 wrote ("pool release belongs in a `finally`") — **never runs** when `await
  scriptPromise` rejects, because `_runJob` is never entered. The key and the slot leak permanently.
  This is the exact wedge QD-O5 describes, and the prescribed fix does not close it.
- The `.catch()` at the `setImmediate` site is also insufficient alone, and worse, it is **on the
  injectable seam**: `_schedule` is a constructor dependency (`:104`, `:125-126`), tests substitute
  `runInline`. An invariant enforced in the default seam is an invariant tests do not exercise — my
  r1 V-C, now with a concrete instance.

**Corrected fix statement, and it is smaller than the two it replaces:** one
`try { … } catch { settle + journal } finally { release + drain }` **inside the `job` closure**, so
the closure never rejects and every scheduler — production `setImmediate`, test `runInline`, and any
future one — inherits termination by construction. The `.catch()` at `:126` becomes belt-and-braces
rather than the mechanism.

**Amended ARCH-079 inv 2 text** (replaces my r1 P3 wording):

> Single-flight `concurrency:1` + `maxQueueDepth` is a bound only if the claim and the slot are
> released on **every** exit path of the unit that took them. The claim (`_pendingKeys.add`) and the
> slot (`_runningCount++`) are taken in `_startJob`; therefore the `try/catch/finally` wraps the
> **scheduled closure**, not the inner job — a handler placed inside `_runJob` does not cover the
> `await scriptPromise` that precedes it. The scheduled closure never rejects; the `schedule` seam
> carries no part of this invariant, because it is injectable. `QUEUE_FULL` is honest absence **only**
> under this invariant — a wedged slot reports itself with the same string, so a lost release is
> indistinguishable from correct operation at the surface.

**The reachable Gate-5 RED row — composed from their finding and mine, neither sufficient alone.**
QD-S2 records `[gr]` that `putDiagramPending` has no version-existence guard (unlike
`putDiagramResult`), so an `enqueue` racing a `deregister` can leave a `pending` diagram row whose
name/version row is gone (deregister deletes `workflow_versions` + `workflow_diagrams` in one
transaction, `workflow-catalog.ts:488-490` — a `putDiagramPending` landing *after* that commit
re-creates an orphan). At next boot `sweepAtBoot`'s requeue branch calls
`this._catalog.resolve(name, {version}).then(e => e.script)` with **no `.catch`** (`:177`) — and
`resolve` throws `CatalogNotFoundError` (`workflow-catalog.ts:517/522`). That rejection propagates
through the `job` closure to `void job()` at `:126`, with no `unhandledRejection` handler anywhere in
`src/` (both panels grepped this independently). Note the author **did** guard the analogous promise
in `regenerate` (`:156-160`) and did not guard this one.

So the RED row is concrete and needs no new seam: *seed an orphan pending row, boot-sweep, assert (a)
no unhandled rejection, (b) the row settles, (c) the **next** enqueued job still runs.* (c) is the
assertion that fails today and that a `_runJob`-local `finally` would still fail.

**Severity.** I hold **HIGH**, and I adopt QD's mechanism rather than my own r1 framing: not "the
engine dies on every boot" (my r1 V-A already withdrew that, and QD-S2 independently corrected the
same overclaim against its own Gate 8 text — the attempt-marker at `:173` bounds the boot case to one
restart). The severity is **wedge + silence**: the pool is dead, every later registration settles the
designed-looking `QUEUE_FULL`, and nothing anywhere says so.

---

## 2. N-2 — `DISABLED` is synthesized only for the *no-row* case, so both panels' settle reports a false cause. **New: V-D.**

QD-S1's remedy paragraph says: *"the read layer already synthesizes `DISABLED` at describe time
whenever `enabled:false` (`workflow-view.ts:130-138`) — so the operator sees
`diagramStatus:'unavailable'` / `DISABLED` for free."*

Verified at `workflow-view.ts:128-138`, the note precedence is:

```
if (diagram === null)                     → noteTextFor(analyzerEnabled ? 'NOT_GENERATED' : 'DISABLED')
else if (status === 'unavailable' && noteCode) → noteTextFor(diagram.noteCode)
else                                      → ''
```

`analyzerEnabled` is consulted **only on the `null` branch**. The row QD-S1 proposes to write is not
null — it is `unavailable` + persisted `RETRIES_EXHAUSTED` — so the second branch wins and the
operator who set `enabled:false` reads **"retries exhausted"**. My own r1 P2 picked the same settle
code and did not notice. This is not a nitpick: owner decision A1 and REQ-102's honest-absence rule
are the whole spine of this iteration, and a note that names a cause that did not happen is the thing
that rule exists to forbid.

**V-D (new) — one line in a pure function, no migration, no new surface.** Give `analyzerEnabled`
precedence over the persisted code for any non-`ready` row:

> `projectWorkflowDescribe`: a `ready` row's note stays `''`. Otherwise, when
> `ctx.analyzerEnabled === false` the note is `DISABLED`, regardless of whether a row exists and what
> it persists — because while egress is off, *disabled* is the operative reason the diagram is absent,
> and any persisted code describes a life the operator has since switched off.

Why this and not the alternatives: a ninth persisted `DISABLED` is the `CHECK` migration
(`workflow-catalog.ts:240-241`) that both panels' Risk lists exist to avoid, and `DISABLED` is
declared READ-SYNTHESIZED-ONLY at `graph-analyzer.ts:14-21` — V-D keeps that declaration true rather
than breaking it. Deleting the row instead would violate the derived-store single-deletion-path
invariant that QD's Gate 8 pass verified clean.

**Accepted cost, named:** while `enabled:false`, a *historical* failure cause on a non-`ready` row is
masked by `DISABLED` until the analyzer is re-enabled. I accept that: it is a read-time projection, no
information is destroyed, and the alternative is the false cause.

**Testability:** `projectWorkflowDescribe` is pure with an injected `ctx` and already has the two-sided
`EXPECTED_DESCRIBE_KEYS` oracle — the RED row is a table over `{row: null | pending | unavailable+code
| ready} × {analyzerEnabled}`, zero new seams.

---

## 3. Concession against my own r1 — P2's guard site is wrong as written

**CONCEDE (partially).** QD's Risk #5 says a reviewer skimming "gate the sweep on `enabled`" will
gate the whole sweep and strand every prior-life `pending` row. I checked it against the code, and the
check turned up a defect in **my** proposal instead of theirs.

Facts (`graph-analyzer.ts`): both `_startJob` call sites — `enqueue:143-144` and `sweepAtBoot:173-179`
— call `putDiagramPending` **before** `_startJob`. And `putDiagramPending`'s `ON CONFLICT` nulls
`diagram`. So a guard at `_startJob` entry that calls `_settleUnavailable` runs *after* a prior
`ready` diagram has already been destroyed on disk, and `_settleUnavailable`'s ready-check (`:194-199`)
sees `pending` and no longer protects it. **My r1 P2 traded a known bug for a latent one**, and my r1
called `mcp-facade.ts:462-464` "load-bearing" precisely because I could feel the hole without locating
it.

Two further facts settle the shape:

- **`server.ts:953`** gates registration's `enqueue` on `graphAnalyzer.enabled`, and
  **`mcp-facade.ts:462`** gates `regenerate`. So `sweepAtBoot` really is the *only* unguarded path —
  QD-S1's factual claim is exactly right. It is also a perfect specimen of my r1's complaint: **three
  callers each carrying the check, two remembered, one forgot.**
- `sweepAtBoot`'s **second** branch (`:180-188`, stamped-by-a-dead-process) settles with zero model
  calls and **never touches `_startJob`**. So a guard at the `_startJob` choke point gates *exactly*
  the requeue branch — QD's Risk #5 is satisfied **by construction**, not by care.

**Primary proposal (refined), and it is a simplification, not an addition:** move the durable pending
write **behind** the guard, into `_startJob`, next to the in-memory claim it belongs with:

> **ARCH-085 / ARCH-079 (new invariant):** no `GraphAnalyzer` code path reaches `this._gateway` when
> `config.enabled === false`. `_startJob` is the single choke point and it is the site of **both**
> claims — the in-memory `_pendingKeys` claim and the durable `putDiagramPending` write (the boot
> sweep passes its attempt stamp as a parameter). The `enabled` guard is the first statement, before
> either claim, and it **settles** (`_settleUnavailable`), because ADR-017's "`pending` always
> settles" is what makes `unavailable` honest rather than lost.

With the write behind the guard, both cases come out right for free: the sweep's row is `pending`, so
`_settleUnavailable` writes `unavailable` and **nothing is stranded**; the enqueue case's row may be
`ready`, so `_settleUnavailable` **returns early and the prior diagram survives**. Cost: two lines
moved and one optional `stamp` parameter. It also makes my r1 **V-A** ("the sweep stamps before
scheduling — that stamp is what makes the requeue at-most-once across restarts") *structural* instead
of prose, and it removes the current split where the in-memory claim and the durable claim are made in
different files' worth of control flow — the same seam A10 sits on.

**Fallback, named for the referee:** if the referee wants zero structural change at a send-back gate,
take **QD-S1 verbatim** (one `if` on the requeue branch only). It closes the shipped hole. What it
does not do is stop a fourth caller, and it leaves the shape that produced this defect.

**Downgraded from my r1:** `mcp-facade.ts:462-464` is **defence-in-depth**, not load-bearing, under
either fix. My r1 R2 overstated it. It still deserves the one-line assertion, at LOW.

**Settle code:** `RETRIES_EXHAUSTED` (no migration), **plus V-D** so the operator-facing note is
`DISABLED`. Without V-D this fix ships a lie; with it, the persisted-code choice stops being
operator-visible at all.

---

## 4. Point-by-point on quality-dimensions r1

| QD item | My call | Engineering reason (short) |
|---|---|---|
| **QD-C1** A1: transport gate, single projection | **CONCEDE the framing, HOLD one clause** | We converged independently; their drift argument (REQ-101 "the masks cannot drift apart") is the *better* justification and I adopt it over my "second mask wearing a hat". I hold the **loopback exemption** — see §5.1. |
| **QD-S1** `enabled` on the sweep | **CONCEDE the fact, HOLD the site (refined)** | §3. Their fact is right and my r1 site was wrong; the refined choke point satisfies their Risk #5 by construction. |
| **QD-S2** release in a `finally` | **HOLD the invariant, CORRECT the fix text** | §1. Both r1 texts name a site the leak does not pass through. |
| **QD-O4** one journal line on every exit, incl. the exceptional one | **CONCEDE — this was the gap in my r1** | My r1 P3 said "the catch settles and emits the journal line" as a clause; QD-O4 is right that it is an *invariant of its own*. Scope it (§5.4). |
| **QD-O4** middle path: journal field, not a ninth persisted code | **CONCEDE, and I pick it explicitly** | The `CHECK` at `workflow-catalog.ts:240-241` is a migration on a shipped store. `DES-129`'s `gateFail` is direct precedent for a tenth journal field. **Name the debt in ARCH-079**: `RETRIES_EXHAUSTED` becomes an overloaded "the engine gave up" code whose true cause lives only in the journal. The ninth code + migration is the price of un-overloading it, scheduled, not smuggled. |
| **QD-O5** `QUEUE_FULL`'s honesty is conditional on the release invariant | **CONCEDE** | Same sentence as my r1 P3's last line, arrived at independently. Adopt theirs; it says it in one clause. |
| **QD-O6** analyzer gauge on `GET /api/status` | **REBUT** | §5.2. |
| **QD-O1** allowlist membership (inv 6) | **CONCEDE + one addition** | Identical finding, identical re-audit conclusion. I **drop** my r1's LOW→MED severity fight — it changes no text (§5.3). I **hold** the added rule: *adding an author-controlled member requires that member to be independently non-owner-visible*, so the next widening cannot be a one-line diff with no security thought. |
| **QD-O2** `phases` missing from ARCH-081 + iface table | **CONCEDE + integrate** | I did not file this. It is the **other half of QD-O1**: `meta.phases[].title` is an allowlist member *only because* phases are non-owner-visible, and ARCH-081 is where that visibility is pinned. Amending one without the other leaves the audit chain broken. |
| **QD-O3** strike the `maxWorkflowVersions` prune | **CONCEDE** | Same finding; take **their** citations (`ARCH-077:1383/1384`, `:1687`, `ADR-021:1507`) — see §5.5. |
| **QD-R1/R2** one declaration + interpolation, elevated to an ADR | **CONCEDE the ADR, HOLD two scoping clauses** | §5.6. |
| **QD-C2** drift-lock = two-sided set equality | **CONCEDE + concede the cost I missed** | Identical to my r1 P5, including the same anti-pattern ("deriving from the advertised list makes an eleventh tool pass" ≡ my "the oracle must never be imported from `server.ts`"). Two independent derivations of one shape is the strongest signal this round produced. I **concede their backfill-budget point**: I costed this at "one `toEqual`" and it is not — the currently-uncovered advertised tools go red until their per-tool rows exist. **Budget at Gate 3.** |
| **QD-C3** grep allowlist is four, not three | **CONCEDE** | Same finding (raised adversarially at Gate 8, owned here). Add: the test pins the size, so the number cannot re-drift. |
| **QD-S4** delete the mini-preview; a deletion item enumerates **call sites** | **CONCEDE + hold my amplification number** | Same two-line fix. Their architectural half (`ADR-022`'s grep guard is word-specific and structurally cannot catch a dead call site) is better than my r1's framing and I adopt it. I hold the 20N/min figure and the A1+A4 convergence sentence: the security lens and the scalability lens close two halves of one hole. |
| **QD-S5** DES-127 B5 comment | **CONCEDE the outcome, HOLD the cause** | We agree: fix the comment, no schema. But the amendment must record **why** the cheap fix is the right one — `generated_at` serves two state machines at once (provenance stamp on `ready`/`unavailable`, boot-sweep attempt marker on `pending`), which is what makes "just stop nulling `diagram`" a migration and not a one-liner. My r1 withdrew that costing publicly; without the cause written down, v24 re-proposes the one-liner. |
| **QD-S3** global `unhandledRejection` handler | **CONCEDE — deferred, agreed** | They pre-conceded to the fail-fast argument on the strongest available grounds (REQ-059/060 make restart-and-resume a *designed* capability). No argument left to have. §1's closure handler is the real fix and is not a global. |
| **QD-R3 / QD-S6** boot-time glyph lint / metabolism + liveness probe | **CONCEDE — declined, agreed** | Correctly labelled (iii). QD-S6(1) also **rests on** QD-O3's fact: there is no prune anywhere, so "no metabolism" is a true statement about a real long-horizon gap, not a v23 defect. Record; do not build. |
| **QD Risk 7** (every (i) item is a text edit whose only proof is that someone made it) | **CONCEDE, and I amplify it** | This ledger has an instance of a gate "fixing" something in prose while the RED row was skipped. Gate 8 must re-verify each (i) item **by grep**, not by reading the gate note. |

**My r1 items QD did not file, all held:** V-A (stamp-before-schedule, now structural under §3), V-B
(the bounds are per-*process*), V-C (a seam added for happy-path determinism must admit the failure the
invariant claims to survive — §1 is its first concrete instance), and the ARCH-079 inv-4
provider-status strike (which QD independently bundled under QD-O4 — converged).

**V-B gains independent support from their text:** QD-S2 describes `putDiagramResult` taking
`.immediate()` write locks on "a database two processes can contend for". That is my V-B's premise
stated by the other panel. Neither of us proposes a lock. The fix is one clause in ARCH-079: *the
bounds are per-process; the durable row is the only cross-process state and it has no lock;
multi-instance over one catalog is out of scope (DEPLOY §multi-instance, `DEPLOY.md:882`).* Writing the
constraint down **is** the whole fix.

---

## 5. The disagreements that survive, argued

### 5.1 A1 — converged on mechanism; I hold the **loopback exemption** (HOLD)

We agree on everything that matters: gate the **transport**, keep **one projection**, amend
`ARCH-083`'s false clause under *either* outcome. I concede their reasoning is stronger than mine —
"a field-level fork replaces one auditable projection with two that will disagree by v25" is a
sharper argument than my "second mask wearing a hat", and it comes from *their* lens, which is what
makes it credible.

**What I hold**: QD-C1 states the rule as "under `auth.enabled:true` on a non-loopback bind the route
requires a bearer and answers 401" — the mechanism is left implicit. I hold my r1 P1's literal form,
because the placement is the entire finding:

> Admitted **only** when `!authEnabled`, **or** the peer is loopback (`isLoopbackPeer`, the
> REQ-089/D-BIND exemption), **or** `resolvePrincipal` returns a principal; otherwise **401** with
> `wwwChallenge()`, before any store read. The **gate** joins the `authHandlers` block
> (`server.ts:1722`) as the **fourth** `dbindExempt` member alongside `/assets/blob`,
> `/assets/manifest` and `/mcp` — 401 or fall through. The **handler stays** in the `/api/*` dispatch
> at `:1918-1930`, because `authHandlers` is `authCfg && authTokenStore` (`:1623`) and a route
> *living* inside that block would 404 for every no-auth deployment — this product's majority local
> posture.

Two reasons this is not pedantry. **(a)** QD's own accepted cost ("an unauthenticated dashboard under
`auth.enabled:true` loses the workflow-detail diagram") is *smaller* with the loopback exemption than
without: a browser on the engine host or over DEPLOY's own SSH-tunnel posture keeps working, so the
blast radius is remote viewers only, one view, once A4 lands. The exemption serves **their** lens.
**(b)** A bare "requires a bearer" implemented one block too deep 404s every no-auth deployment. That
is why the first Gate-5 assertion must be `{authEnabled:false} → 200`.

**Test oracle** (so Gate 5 has one): parameterized over `{authEnabled:false}` → 200;
`{authEnabled:true, loopback}` → 200; `{authEnabled:true, non-loopback, no/invalid bearer}` → **401 +
`WWW-Authenticate`, zero store reads**; **plus** a parity assertion that the 200 body is key-identical
to the MCP tool's `result` under the existing two-sided `EXPECTED_DESCRIBE_KEYS` oracle. That parity
row is what mechanically enforces QD-C1's "the masks cannot drift apart", and it currently exercises
only one of the two call sites.

**Still open and not ours to close: `ADJ-A1`.** P1/QD-C1 partially retires REQ-086's ratified non-goal
("the read-only dashboard remains unauthenticated"). Both panels agree the **documents must move under
either ruling**. If the owner rules the route stays open, then `ARCH-083` and ADR-012's masking posture
must be amended to *say* the describe payload is public by decision, and `EXPECTED_NON_OWNER_KEYS`
(`workflow-view.ts:59-62`) reconciled with it. The one outcome both panels reject is the documents
continuing to claim a gate that does not exist. Contingent doc edits either way: `README.md` §使用範例
(~:176,「任何人都能問」) and DEPLOY's describe-route description.

### 5.2 QD-O6 — analyzer gauge on `GET /api/status` (**REBUT**, with their fallback conceded in full)

Their argument is the strongest one available: `ARCH-085` declined a config-readback surface on the
grounds that *"the journal line already carries the model per run, which is the same signal for free"*,
and QD-S2 falsifies that — the journal line is exactly what is absent when the subsystem breaks. A
justification that has been empirically falsified must be re-decided, not re-asserted. I accept that
principle entirely.

**Where it breaks**: the falsification is **repaired by QD-O4**, not merely exposed by it. Once §1's
closure handler and QD-O4's exceptional-exit journal line land, the journal line *is* emitted on the
failure path, and `ARCH-085`'s justification becomes true rather than false. Adding a gauge for a state
that the same round makes unreachable is the speculative machinery this slice spent its budget
avoiding.

Three supporting points:

1. **The gauge is strictly weaker diagnostics for the same state.** `{running:1, queued:8}` tells an
   operator *that* something is wedged; QD-O4's line tells them **which** `name@version`, on which
   attempt, against which model, with which cause. If we can only afford one, the journal line wins on
   its own merits.
2. **Unbounded hang is a different question, and it is not the analyzer's.** `timeoutMs` (default
   60000, `server.ts:1477`) is passed to `gateway.invoke` at `graph-analyzer.ts:259`, and the invoke is
   `try`/`catch`-wrapped at `:263-267`. So a hang inside the provider is a **gateway-contract**
   question, not an analyzer one. I state it that way deliberately rather than claiming the hang is
   impossible — if the panel wants insurance against a gateway that ignores `timeoutMs`, the honest fix
   is a wrapper timeout at the one call site, not a status gauge that reports the symptom.
3. **The surface is anonymous, at the gate where we are closing an anonymous surface.** `GET
   /api/status` is unauthenticated. QD anticipated this and scoped it to counts, which I credit — but
   it is still an odd round in which to hand anonymous callers a live gauge of engine-internal queue
   activity while simultaneously 401-ing the describe route for the same callers. Small, and it is not
   my main argument; it is the tie-breaker once (1) and (2) leave the gauge with no unique job.

**Conceded in full, and it is their stated fallback:** `ARCH-085`'s justification sentence must not
survive unchanged. It should be **amended to name its own dependency** — *"the per-run journal line is
the readback, and that is only true because ARCH-079 inv 5 now covers the exceptional exit"* — so the
next reader cannot separate the claim from the thing that makes it true. That is QD-O5's own move,
applied to QD-O6's target.

### 5.3 Severity labels — I drop both fights (**CONCEDE**)

My r1 escalated A7 LOW→MED; QD-S2 argues A3 *down* from its own Gate 8 text. Neither changes a line of
amendment text, and QD-O1's own paragraph already makes my escalation argument in full ("this is not
ordinary doc drift — `ADR-015`'s entire security claim is audited against inv 6's membership list").
Arguing labels when the text is agreed is the panel spending credibility on nothing. I withdraw the
severity dispute and keep only the **rule** I attached to it (§4, QD-O1 row).

### 5.4 QD-O4's scope needs one clause, or my §3 guard reads as violating it (**CONCEDE + precision**)

The refined `enabled` guard settles **synchronously** inside `_startJob`, emitting no journal line —
the same shape `QUEUE_FULL` and `MODEL_UNMAPPED` already have today (`enqueue:135-142`). If QD-O4's
invariant is written as "every analyzer settle emits a journal line", the fix we are both proposing
violates the invariant we are both adopting, and Gate 8 files it as a new deviation.

> Scope it: *every **scheduled job** exits through exactly one journal line, including its exceptional
> exit. A **pre-scheduling refusal** (`QUEUE_FULL`, `MODEL_UNMAPPED`, `enabled:false`) settles the row
> without one — it consumed no slot, made no model call, and is fully described by its persisted
> `noteCode`* — **which is true only with V-D** (§2), since without it the `enabled:false` refusal's
> persisted code names the wrong cause.

### 5.5 Citations — theirs win (**CONCEDE**)

QD re-verified `02-architecture.md` line numbers this round by grepping each quoted clause and found
three carried-in citations off by a few lines (`ARCH-081` `api:` is `:1419` not `:1425`; `ARCH-080`
`api:` is `:1410` not `:1409`; `ADR-021`'s note is `:1507` not `:1508`). My r1 cited ARCH rows by
identifier and `src/` by `file:line`; I did not re-verify the architecture-document line numbers.
**The amending editor should take QD-R1's/QD-O2's/QD-O3's numbers over both the Gate 8 review panel's
and mine.** My `src/`-side `file:line` citations are re-verified this round and stand.

### 5.6 QD-R2's ADR — conceded, with two scoping clauses I hold

**CONCEDE the ADR.** My r1 put the rule in `ARCH-080`'s note; QD wants an ADR. An ADR costs text and
buys cross-iteration memory, and this is the **third recurrence** of one class (adjudication #7 /
IMPL-174's two hand-typed `UNBOUND_ENTRY_LABEL` copies — where the engine instructed a token its own
gate refused and *every first diagram was lost*, fixed one file away, this iteration). Karpathy's rule
is "no speculative machinery", not "no writing down a defect class that has fired three times".

Two clauses I hold, because without them the ADR is either unenforceable or self-contradictory:

1. **Scope it to engine-instructs/engine-validates vocabulary.** Written as "no duplicated constant
   anywhere", the rule is unenforceable and will be ignored. Written as *"any vocabulary the engine
   both instructs a model to produce and validates on the model's return has exactly one declaration
   in `src/`, and the prompt is built by interpolation, never transcription"*, it is a checkable
   property with a named test.
2. **Carry my r1 C4's REQ-104 asymmetry paragraph into it**, or a careful reader files the ADR itself
   as a REQ-104 violation ("no analyzer harness value is hard-coded in engine source"). The
   resolution: *the default prompt is source; an operator override replaces it wholesale; the gate
   constant is unoverridable either way.* So interpolation **cannot** reduce operator tunability, an
   override can never **widen** the vocabulary, and an override with the wrong vocabulary
   self-diagnoses as `GATE_REJECTED_SHAPE` — which `08-validation.md` round 3 records as the live
   failure mode (`gateFail:"codepoint"`). This asymmetry is ADR-015 restated and it is exactly what
   makes QD-R2 safe.

**And the enforcement clause, or the ADR is prose:** the membership assertion must cover the shipped
default prompt **and** `rwe.config.example.json:59` — a file read, which is the point, because the
config template is the copy that rots silently while `ARCH-085` actively invites operators to edit
`systemPrompt` for their model class.

---

## 6. Where my three lenses fight, after the debate

**C1 — A1 (security vs consumability).** Unchanged in outcome, *strengthened in provenance*: the
consumability lens independently reached the security lens's conclusion, from REQ-101's drift clause
rather than from disclosure. When the two lenses that most often trade off converge from opposite
premises, that is the strongest evidence this panel can produce. **Tie-break stands: `dbindExempt`** —
minimum mechanism, zero new concepts, and the loopback exemption is what keeps consumability's loss
bounded to remote viewers.

**C2 — A2 (security vs testability), resolved without a trade, now with a correction.** Security wants
one choke-point guard; testability wants per-caller behaviour asserted. Both: the guard sits at
`_startJob` **with the durable write behind it** (§3), and Gate 5 writes one RED row *per entry point*
asserting `gateway.invoke` is never called — the gateway is already injected, so per-caller
**assertions** cost nothing. Testability's requirement was per-caller assertions, never per-caller
code. §3 is the correction: the choke point had to move to where the *durable* claim is made, not just
where the job is scheduled.

**C3 — new this round: honesty vs migration cost (§2).** The persisted note vocabulary is closed by a
SQL `CHECK` on a shipped store, so every new *true* cause costs a migration; the pressure is therefore
to reuse a wrong-but-admitted code. Both panels felt it and both took `RETRIES_EXHAUSTED`. **V-D breaks
the tie without paying**: move the honesty to the **read projection**, which is pure, already
two-sided-tested, and where `DISABLED`/`NOT_GENERATED` were declared to live in the first place. The
principle worth keeping: *when the durable vocabulary is closed and the read layer is pure, buy honesty
in the projection.* Its limit is stated openly — for the throw path (QD-O4) there is no
`analyzerEnabled`-like context to synthesize from, so that one **does** ship an overloaded
`RETRIES_EXHAUSTED` with the true cause in the journal, and ARCH-079 must say so (§4).

**C4 — A5 (security/consistency vs replaceability).** Resolved by asymmetry, not precedence (§5.6.2).
Unchanged from r1, now inside QD-R2's ADR.

**C5 — the standing tension, restated after two rounds.** Security's answer to every analyzer question
is "gate it, allowlist it, do not call the model"; scalability's is "the model call is the product,
bound it"; testability's is "make it deterministic". The one place all three agree is **ARCH-080's
gate** — still the only part of v23 with no HIGH against it. Both panels arrived there and neither
proposes moving policy out of it. That agreement is the design's strongest evidence about itself.

---

## 7. Karpathy check — what round 2 adds, and what it explicitly does not

**Net new mechanism across both panels' adopted items:** one reuse of an existing predicate pair (A1),
**one** `try/catch/finally` in one closure (§1 — this *replaces* my r1's two-site fix and QD-S2's
`finally`+`.catch` pair, so the debate made the fix smaller), one `if` plus two moved lines (§3), one
line of note precedence (§2, V-D), one exported constant + interpolation (QD-R2), one `toEqual` where a
`toContain` stands (QD-C2), two lines deleted (QD-S4), one journal field (QD-O4). Everything else is
amendment text — the correct output for a gate whose deviations are 40% "the row was never edited".

**Still NOT proposed, by both panels now**: no rate limiter, no distributed lock or leader election, no
second masking projection, no `diagramCache`, no `admin` trust tier, no new state store, no global
`unhandledRejection` handler, no `note_code` `CHECK` migration, no preserved-prior-diagram schema
change, no boot-time prompt lint, no liveness probe, no diagram-row prune. **And, new this round: no
status gauge** (§5.2).

---

## 8. Amendment list handed to Gate 2's writer (round-2 final; supersedes my r1 §7)

| # | Row | Amendment | Gate |
|---|---|---|---|
| **N-1** | **ARCH-079 inv 2** | The `try/catch/finally` wraps the **scheduled closure** in `_startJob`, not `_runJob` — the claim and slot are taken at `:209/:217` and the closure `await`s `scriptPromise` at `:211` before `_runJob` is entered. The closure never rejects, so the injectable `schedule` seam carries no part of the invariant. Plus QD-O5's clause: `QUEUE_FULL`'s honesty **depends on** this release invariant. **Corrects both r1 texts.** | 2 (text) / 5,6 |
| **N-2 / V-D** | **ARCH-081** (+ DES-125/127 note) | `projectWorkflowDescribe`: `analyzerEnabled === false` yields `DISABLED` for any non-`ready` row, not only `diagram === null` (`workflow-view.ts:128-138`). Accepted cost: a historical cause is masked while disabled. **Prerequisite for §3's settle being honest.** | 2 / 5,6 |
| **A2** | **ARCH-085** + **ARCH-079** | Guard at `_startJob`, **with `putDiagramPending` moved behind it** (sweep passes its stamp as a param); it settles `RETRIES_EXHAUSTED` + V-D. Fallback named: QD-S1's requeue-branch-only `if`. `mcp-facade:462` demoted to defence-in-depth (LOW assertion). Makes V-A structural. | 2 (text) / 5,6 |
| **A1** | **ARCH-083** `api:` + iface table `:1698` | The literal `!authEnabled ‖ loopback ‖ resolvePrincipal` rule; **gate** joins `authHandlers` (`:1722`) as the fourth `dbindExempt` member, **handler stays** at `:1918-1930`. Record `ADJ-A1`, the README/DEPLOY edits, and the MCP-parity test row. Amend **under either owner ruling**. | 2 |
| **QD-O4** | **ARCH-079 inv 5** (+ inv 4 strike) | Every **scheduled job** exits through exactly one journal line, incl. the exceptional exit; pre-scheduling refusals settle without one (§5.4). Cause rides as a journal field (`DES-129` `gateFail` precedent); name the `RETRIES_EXHAUSTED` overload and the migration price of undoing it. Strike inv 4's provider-status clause (struck by DES-129, never amended). | 2 (text) / 5,6 |
| **QD-O1 + P6** | **ARCH-079 inv 6** | True membership (+`meta.phases[].title`, `'default'`, `'model:param'`, `UNBOUND_ENTRY_LABEL`; −`DIAGRAM_CODEPOINTS` → the gate's separate codepoint pass); record the ADR-015 re-audit **result per member**; add the future-widening rule. | 2 |
| **QD-O2** | **ARCH-081** + iface table `:1692` | `phases` **is** emitted (adjudication #1 一律公開). This is the other half of QD-O1's audit — the allowlist member is justified only because this row pins the visibility. | 2 |
| **QD-O3** | **ARCH-077** `api:`/inv 7 (`:1383/:1384`), `:1687`, **ADR-021** (`:1507`) | Strike the `maxWorkflowVersions` prune — the ceiling **refuses registration** (`workflow-catalog.ts:441-445`); diagram rows are bounded, not pruned; the derived-store invariant rests on the single deletion path (`:488-490`). | 2 |
| **QD-R1/R2** | **ARCH-080** + **new ADR** | One declaration + interpolation, scoped to engine-instructs/engine-validates vocabulary; carry the REQ-104 asymmetry paragraph; membership assertion covers the shipped prompt **and** `rwe.config.example.json:59`; delete the false "third consumer" comment at `server.ts:300`. | 2 (text) / 5,6 |
| **QD-C2** | **ARCH-051** / **ARCH-082** / **ARCH-086** | Drift-lock is **two-sided set equality**, not containment; the literal expectation stays in the test and is never derived from the advertised list. **Backfill budgeted at Gate 3.** Plus one literal assertion on `server.ts:493`'s script-absence sentence. | 2 (text) / 3,5 |
| **QD-S4** | **ARCH-084** + **ADR-022** | The mini-preview is **deleted**, not re-pointed (20N req/min/tab); a deletion item enumerates **call sites**, not definitions — the grep guard is word-specific and cannot catch a renamed dead caller. A1+A4 close two halves of one hole. | 2 (text) / 6 |
| **QD-C3** | **ARCH-083** note (`:1438`) / **ADR-022** (`:1513`) | The grep allowlist is **four** entries; the test pins the size so it cannot re-drift. | 2 |
| **QD-S5 / A10** | **ADR-017** / **ARCH-077** | State the `regenerate → crash → sweep` window **and its cause**: `generated_at` serves two state machines (provenance stamp / boot-sweep attempt marker), which is what makes "stop nulling `diagram`" a migration rather than a one-liner. Correct the false comment at `graph-analyzer.ts:176-179`. Durable guarantee is *"`pending` always settles"*; a prior `ready` diagram survives a failure only within one process lifetime. No schema. | 2 |
| **V-B** | **ARCH-079** | The bounds are **per-process**; the durable row is the only cross-process state and has no lock; multi-instance over one catalog is out of scope (`DEPLOY.md:882`). | 2 |
| **V-C** | **ARCH-079 inv 8** | A seam added for happy-path determinism must also admit the failure the invariant claims to survive. First instance: §1's RED row (orphan pending row → boot sweep → rejected `resolve`). | 2 |

**Re-verified in `src/` by me this round** (not carried from any panel): `graph-analyzer.ts:14-21`,
`:100-146`, `:156-160`, `:165-192`, `:194-201`, `:204-219`, `:225-247`, `:250-300`, `:300-345`;
`workflow-view.ts:110-160`; `workflow-catalog.ts:480-495`, `:516-536`; `mcp-facade.ts:455-466`;
`server.ts:297-300`, `:507`, `:953-955`, `:1462-1508`, `:1900-1930`.

**Claims withdrawn or corrected by me across the two rounds**: the unbounded crash-loop (r1 V-A,
withdrawn); the "one-line SQL fix" for A10 (r1 P8, withdrawn as a migration); "`mcp-facade:462` is
load-bearing" (r1 R2, downgraded); **"the release goes in a `finally` in `_runJob`"** (r1 P3,
corrected — §1); **"settle `RETRIES_EXHAUSTED` and the operator is informed"** (r1 P2, corrected —
§2); and the A7 severity escalation (r1 P6, dropped as label-only).

---

## 9. Remaining disagreements, for the referee

1. **A1's loopback exemption** (§5.1). QD states the rule as "requires a bearer"; I hold
   `!authEnabled ‖ loopback ‖ principal` with the gate as the fourth `dbindExempt` member. This is a
   *narrowing* of their accepted cost, not a widening, so I expect it to be adopted — but it must be
   written literally, because a gate one block too deep 404s every no-auth deployment.
2. **QD-O6's status gauge** (§5.2). The only live rebut. My position: dominated by QD-O4 once §1
   lands; their fallback (amend `ARCH-085`'s falsified sentence to name its dependency) is conceded in
   full and must happen either way. If the referee adopts the gauge anyway, it should be **counts
   only** and the referee should note it is being adopted against a Karpathy objection, not by
   default.
3. **A2's guard site** (§3). Primary (refined choke point, two lines moved) vs QD's fallback
   (requeue-branch `if`). Both close the shipped hole; they differ on whether a fourth caller is
   covered by construction. Referee picks; either is defensible, and **V-D is required by both**.
4. **`ADJ-A1` — owner ruling, not a panel disagreement.** REQ-086's non-goal is partially retired by
   A1. Both panels agree the documents move under either ruling; only the direction is the owner's.
5. **QD-O4's persisted-code question** — I picked the journal field over a ninth code + migration, and
   both panels now agree, so this is closed *provided* the ARCH text names the `RETRIES_EXHAUSTED`
   overload as a debt rather than silently reusing the code. The failure mode QD named — "picking
   neither" — is the one to avoid.

**Nothing else survives.** On A3's mechanism, A4, A5, A6, A7, A8, A9, the five doc-only corrections,
and all three deferred (iii) items, the two panels agree on both the fact and the text.
