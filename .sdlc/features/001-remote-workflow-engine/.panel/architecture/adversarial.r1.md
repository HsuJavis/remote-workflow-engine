# Architecture panel — Adversarial group (Security × Scalability × Testability), round 1

**Iteration**: v23 (REQ-101..106) — **Gate 2 RE-RUN** for the Gate 8 send-back at `d294880`
(`send_back: ["architecture","tests","impl"]`, `arch_consistent:false`, 3 HIGH / 3 MED / 4 LOW).
**This file supersedes the pre-send-back `adversarial.r1.md`** for the same iteration; the earlier
proposal argued ARCH-077..086 into existence, this one argues what must *change* in them now that
the code exists and ten deviations are on the table.

**Scope taken.** The reviewer assigns Gate 2 the **A1 decision** plus the **four ARCH/ADR
amendments (A7–A10)**, and Gates 5/6 the rest. I honour that split, but architecture still owes
Gates 5/6 an *invariant to test against* for **A2, A3, A5, A6** — a Gate-5 RED row with no
architectural oracle is how this ledger got here. So each of those gets a one-line invariant, an
owning-gate tag, and nothing more. I also file **three items no panel filed** (V-A, V-B, V-C).

**Lens.** Three lenses that trade off: (a) security, (b) scalability/performance & consistency,
(c) testability. §5 is where they fight; Karpathy simplicity-first is the tie-breaker — the minimum
architecture that closes the deviation, nothing speculative.

---

## 0. Altitude call (per the panel brief, done before anything else)

`tech_stack` describes a Node/TS JSON-RPC-over-HTTP server, better-sqlite3 stores, an OAuth2/OIDC
auth subsystem, a `node:vm` sandbox, a scheduler — **a conventional system**. It *also* describes
`agent()` dispatch through two `GatewayClient` implementations into real LLMs, a curated tool
surface, and — new in v23 — **the engine itself as an LLM consumer for an internal control
surface**. So **both altitudes apply, to different parts of this send-back**:

- **System altitude** owns A1 (route authorization), A3 (async lifecycle, slot accounting), A4
  (request amplification), A10 (row state machine / crash consistency), V-B (per-process vs
  per-deployment bounds).
- **Agent altitude** owns A2 (script egress to a provider is the thing `enabled:false` exists to
  stop), A5 (prompt-vocabulary vs gate-vocabulary drift — a *replaceability* property of a
  model-authored artifact), A7 (the allowlist **is** ADR-015's security audit input), and the
  honest-absence discipline that A1's owner decision put in the requirement.

**What I deliberately do not force.** The lens template names JWT forgery, brute force, distributed
failure counters and timing attacks. None of those is this send-back's surface: the token path
(v15) is untouched by v23, and no failure counter is distributed. The one template item that *is*
live is **unauthenticated enumeration**, and it lands squarely on A1. Forcing the rest would spend
the panel's credibility on machinery nobody asked for — the same discipline REQ-102's "no degraded
fallback" applies to the product.

---

## 1. Summary

The ten deviations are not ten problems. They are **three structural mistakes plus a documentary
habit**, and the architecture of record should be amended to say so rather than patched ten times:

1. **A surface was placed where it cannot express the decision it must make.** `GET
   /api/workflows/:name/describe` sits in the `/api/*` dashboard dispatch block
   (`server.ts:1918-1930`), which is structurally incapable of an authorization decision — the only
   three routes that make one (`/assets/blob`, `/assets/manifest`, `/mcp`) live in the
   `authHandlers` block at `:1722` and are the sole users of `dbindExempt` (`:1719`). ARCH-083 says
   the route is "auth-gated exactly as the route it replaces"; the replaced `/skeleton` route *did*
   branch (`git show ebd530d^:src/server.ts`). **The deviation is a placement fact, not an
   oversight of an `if`.** → **P1**.
2. **A bound that one throw can lose is not a bound, and a flag checked at call sites is not a
   control.** A3 (`_runJob` has no `finally`; `setImmediate(() => { void job(); })` at `:127`) and
   A2 (`sweepAtBoot` never reads `_config.enabled`) are the same shape: an invariant asserted in
   prose at the *callers* instead of enforced at the *choke point*. ARCH-079 inv 2 and ARCH-085's
   "`enabled:false` is a first-class state" are both currently unfalsifiable. → **P2, P3**.
3. **A constant claimed three consumers and got one.** A5's 13 glyphs are hand-typed at
   `diagram-gate.ts:5/22`, `server.ts:306-311` and `rwe.config.example.json:59`, with a *false*
   "third consumer" comment at `server.ts:300` — one file away from IMPL-174, which paid for exactly
   this defect class (`UNBOUND_ENTRY_LABEL`) one round ago. Same shape as A6, where the drift-lock
   is a **subset** assertion and therefore admits new tools silently. → **P4, P5**.
4. **Four rows were never amended** (A7–A10). Three are genuinely documentary. **A7 is not** — see
   §2.1/P6.

**Headline position.** Gate 2's only *decision* is A1, and I recommend **gating the route behind the
existing `dbindExempt` predicate**, not shrinking the payload and not building a second projection.
Everything else is amendment text plus four invariants for Gates 5/6.

---

## 2. Key points

### 2.1 Security lens

**P1 — A1: gate the route with the predicate REQ-089 already ships. `RECOMMENDED`. Owning gate: 2
(decision + ARCH-083 amendment), then 6 (wire) and 5 (RED).**

Amend ARCH-083's `api:` from the unfalsifiable *"auth-gated exactly as the route it replaces"* to a
literal rule:

> `GET /api/workflows/:name/describe` is admitted **only** when `!authEnabled`, **or** the peer is
> loopback (`isLoopbackPeer`, the REQ-089/D-BIND exemption), **or** `resolvePrincipal` returns a
> principal; otherwise **401** with `wwwChallenge()`, before any store read.
>
> **Wiring, stated literally because it is the whole finding:** the **gate** joins the
> `authHandlers` block (`server.ts:1722`) as the **fourth** `dbindExempt` member alongside
> `/assets/blob`, `/assets/manifest` and `/mcp` — it either 401s or lets the request **fall
> through**. The **handler stays where it is**, in the `/api/*` dispatch at `:1918-1930`. This
> ordering is not cosmetic: `authHandlers` is `authCfg && authTokenStore` (`:1623`), so the entire
> block is skipped when auth is disabled — a route that *lived* inside it would 404 for every
> no-auth deployment, which is this product's majority local posture. The three existing
> `dbindExempt` routes already have exactly this shape. Being the fourth member is the enforcement,
> and the four cannot drift on the `!authEnabled` gate independently.

Why this and not the alternatives:

- *Shrink the response for the unauthenticated surface* — this is the second masking projection the
  reviewer forbids, and REQ-101's own words ("the two masks cannot drift apart") forbid it too. It
  is also **dishonest by the iteration's own rule**: an anonymous caller receiving `triggers: []`
  when three triggers are bound is a silent lie, and owner decision A1 (`diagramStatus`,
  `diagramNote`) established that a withheld thing must *say* it is withheld. A `triggersWithheld`
  marker is a second response shape, i.e. the forbidden thing wearing a hat.
- *Shrink the single projection for everyone* — deletes `triggers`/`versions`/`owner` from
  `WorkflowDescribeView` and breaks REQ-101's and REQ-103's literal field lists.
- *Accept it as pre-existing `/api/*` posture* — the counterweight is real (`/api/runs/:id` already
  serves `principal`), but the shipped object is **not** the ratified non-owner projection:
  `EXPECTED_NON_OWNER_KEYS` (`workflow-view.ts:59-62`) contains no `triggers`, `versions` or
  `diagram`, so DES-132's own justification does not describe what it shipped.

The incremental anonymous disclosure, ranked: **`triggers[]`** — raw cron expression + `tz` +
per-binding `enabled` + chain `upstreamWorkflow` (`trigger-bindings.ts:18-21`) is *operational
timing intelligence and internal topology*, and it is the one field with no anonymous precedent
anywhere in this codebase; then **`diagram`** (agent count, resolved model per agent, fan-out,
phases); then **`versions[]`** and **`owner`**, both of which have weaker claims — `catalog.list()`
already serves `versions`/`channels`/`description`/`params` anonymously at `/api/workflows`
(`workflow-catalog.ts:598`), and `owner` is an email already reachable via `/api/runs/:id`'s
`principal`. **I do not inflate the `owner` finding**: its real security weight is that engine
authorization is owner-email-valued, so anonymous *per-workflow* attribution improves an attacker's
enumeration of the exact strings that appear in authorization decisions — an increment in
enumerability, not in kind.

**Named cost, and it needs an owner ruling (`ADJ-A1`).** REQ-086's non-goal states the read-only
dashboard stays unauthenticated (documented trusted-network caveat). P1 **partially retires that
posture for one route**. Concretely: under `auth.enabled:true` on a non-loopback bind, a *remote*
browser's workflow-detail view goes dark; a browser on the engine host or over an SSH tunnel
(DEPLOY's own operator posture) is loopback-exempt and unaffected. Blast radius is exactly one view,
because A4 deletes the only other consumer. This is the same degradation shape v22's H2 already
established at `server.ts:1241` (`authEnabled ? [] : parseWorkflowSkeleton(...)`) — and the fact
that the **sibling route applies the opposite rule to the same class of script-derived structure**
is what makes the current state a deviation rather than a policy.

**Contingent doc edits, same round, or the fix is not done:** `README.md` §使用範例 (~:176,
「任何人都能問」) and DEPLOY's description of the HTTP describe route both become false.

**P2 — A2: put the `enabled:false` guard at the choke point, not on the branches. Owning gates: 5
then 6. This is a deliberate deviation from the reviewer's prescribed fix, flagged as such.**

The reviewer prescribes gating `sweepAtBoot`'s requeue branch. That closes today's hole and leaves
the shape that produced it: `_config.enabled` consulted by *callers*. `_startJob` is the single
point at which this class decides to spend a model call — reached from `enqueue` (registration),
from `regenerate` via `enqueue`, and from `sweepAtBoot` — so:

> **ARCH-079, new invariant:** no `GraphAnalyzer` code path reaches `this._gateway` when
> `config.enabled === false`; the guard is at `_startJob`, so a future fourth caller is covered by
> construction. The guard **settles** — it never returns leaving a `pending` row, because ADR-017's
> "`pending` always settles" is the property that makes `unavailable` honest rather than lost.

Two facts constrain the settle value, both verified: (i) `note_code`'s CHECK constraint
(`workflow-catalog.ts:240-241`) admits eight codes and **`DISABLED` is not among them** —
`DISABLED`/`NOT_GENERATED` are read-synthesized only (`graph-analyzer.ts:14-21`, applied at
`workflow-view.ts:131-133` for the *no-row* case). So the guard settles `RETRIES_EXHAUSTED` (the
reviewer's constraint-safe choice, and the treatment `sweepAtBoot`'s second branch already gives),
**or** we add `DISABLED` to the enum + a migration — which I do not recommend, for one code's worth
of prose. (ii) `_settleUnavailable` already refuses to clobber a `ready` row (`:194-199`), so the
guard inherits that protection for free.

**Residual this creates, and it must be pinned rather than left as an accident:** with the guard at
`_startJob`, an `enabled:false` *regenerate* on a `ready` row would run `putDiagramPending` (nulling
the diagram) before the guard settles. That path is currently unreachable **only because
`mcp-facade.ts:462-464` short-circuits to `ANALYZER_DISABLED`** — which means that short-circuit is
now load-bearing and needs its own assertion, not a comment.

**P6 — A7 is a security finding, and I escalate it from the reviewer's LOW to MED. Owning gate: 2.**

ARCH-079 inv 6 defines the allowlist as `parseWorkflowSkeleton(script)` ∪ model aliases ∪ trigger
kinds/upstream ∪ `DIAGRAM_CODEPOINTS`. The code adds four members it does not name —
`meta.phases[].title`, `'default'`, `'model:param'`, `UNBOUND_ENTRY_LABEL`
(`graph-analyzer.ts:231/233/234/241`) — and `DIAGRAM_CODEPOINTS` is not a label member at all, it is
a separate codepoint pass. **ADR-015's entire security claim — "every token the diagram may contain
is already served on a masked surface today" — is audited against that membership list.** An
un-amended list means an unaudited claim, which is a different thing from stale prose.

I performed the re-audit; **the claim survives**, and the amendment must record *that*, not merely
the four names: `meta.phases[].title` is served to non-owners today (`WorkflowPublicView.phases`,
`workflow-view.ts:46`, owner adjudication #1 一律公開); `'default'`, `'model:param'` and
`UNBOUND_ENTRY_LABEL` are **engine-authored constants**, not author-controlled, so they cannot carry
script-derived text. Amend ARCH-079 inv 6 to the true membership list, move `DIAGRAM_CODEPOINTS` out
of it into the shape pass, and append: *"ADR-015's claim is re-audited whenever this list changes;
adding an author-controlled member requires that member to be independently non-owner-visible."*
That last clause is the only new rule I propose, and it exists so the next widening cannot be a
one-line diff with no security thought.

**Held, re-verified by me, filed here so the consolidator does not re-derive it:** the webhook HMAC
`secret` and webhook `id` cannot reach the analyzer prompt (`trigger-bindings.ts:13` type +
`server.ts:1457` fresh-`{enabled}` remap) — this matters *more* than the diagram gate, because the
gate protects the diagram while the prompt goes to the provider. `script` is absent from
`WorkflowDescribeView` as a **type** (`workflow-view.ts:87-105`). The gate is an allowlist and never
a transformer (`diagram-gate.ts:33-69`). v22's H2 is still closed (`server.ts:1241`).

### 2.2 Scalability / performance / consistency lens

**P3 — A3: the release is the invariant, not the happy path. Owning gates: 5 then 6.**

`_runJob` (`graph-analyzer.ts:301-344`) releases `_pendingKeys`/`_runningCount`/`_queue` at
`:337-343`, *after* `getTriggerBindings` at `:304` (three separate SQLite files) and three
`putDiagramResult` calls (`:326/329/334`, `.immediate()` write lock). `_attempt` catches only around
`gateway.invoke` (`:263-267`). Amend **ARCH-079 invariant 2** to say what a bound means:

> Single-flight `concurrency:1` + `maxQueueDepth` is a bound **only if the slot is released on every
> exit path**: the releases live in a `finally`, the catch settles `unavailable` and emits the
> journal line, and the production scheduler attaches a rejection handler (`setImmediate(() => {
> job().catch(…) })`) — a `void promise` on an engine-owned path is prohibited. `QUEUE_FULL` is
> honest absence **only** under this invariant; a wedged slot reports itself with the same string,
> so a lost release is *indistinguishable from correct operation* at the surface.

That last sentence is the severity argument and it is why I concur with the adjudication to HIGH:
the failure disguises itself as the design.

**V-A (original, not filed by either panel) — the crash-loop is bounded, and the thing that bounds
it is unwritten.** `deploy/rwe.service` runs `Restart=on-failure` (DEPLOY.md:500). A throw on the
job path under Node's default `--unhandled-rejections=throw` (no `unhandledRejection` handler
anywhere in `src/`) kills the process; systemd restarts; `sweepAtBoot` runs again. This does **not**
amplify model calls — because `sweepAtBoot` calls `putDiagramPending(name, version, stamp)`
*before* `_startJob` (`:172-179`), so the next boot finds `generatedAt < bootInstant` and takes the
**zero-model-call** settle branch (`:180-188`). The per-row lifetime budget is therefore
`1 + retries` in-process plus exactly one post-crash requeue. **This ordering is load-bearing and
no ARCH row states it** — a future refactor that moves the stamp after the requeue converts a
bounded cost into a restart-driven billing loop. Pin as ARCH-079 invariant 9: *"the boot sweep
stamps its attempt marker before scheduling the requeue; the stamp is what makes the requeue
at-most-once across restarts."* Cost: one sentence. (I record this as a **corrected** claim: my
first reading of A3 assumed an unbounded crash-loop. It is not one, and the panel should not carry
that overclaim forward.)

**V-B (original) — ARCH-079's bounds are per-*process*, and the document reads as if they were
per-*deployment*.** `_runningCount`, `_queue` and `_pendingKeys` are in-memory; `workflow_diagrams`
is durable and shared. DEPLOY.md:882 already states single-instance-only for the self-update
mechanism, but ARCH-079 says "concurrency: 1" with no such qualifier, and this engine has a standing
temptation toward multi-port instances over one work root. Two processes on one catalog DB would
each run one job, double the bound, break DES-127 B4 single-flight, and race `putDiagramResult`.
**I do not propose a distributed lock** — that is exactly the speculative machinery this slice spent
its budget avoiding. I propose one clause in ARCH-079: *"these bounds are per-process; the durable
row is the only cross-process state and it has no lock. Multi-instance over one catalog is out of
scope (DEPLOY §multi-instance)."* Writing the constraint down is the whole fix.

**P7 — A4: delete `renderMiniPreviewAsync`, do not re-point it. Owning gate: 6.** ARCH-084 says the
home-card mini-preview "drops its skeleton fetch"; `dashboard-page.ts:227-231` fetches `/describe`
and its body is `if(!s||!s.diagram) return;` on every branch — a fetch whose response is
unconditionally discarded, called at `:243` per named card under `setInterval(render,3000)`
(`:496`). That is **20N requests/minute/tab**, and each one performs the describe read: three
separate synchronous SQLite file reads in `getTriggerBindings` plus a `RunStore.getRun` join for
chain upstream, on the single Node thread that also dispatches `/mcp` runs. **The security and
scalability lenses converge here**: A1 removes the anonymous vector, A4 removes the amplifier, and
either alone leaves the other half. Both panels reached the same two-line fix independently; I add
only that UT-116's oracle re-points to the *absence* of `/skeleton`.

**P8 — A10: state the window; the "one-line SQL fix" is not one line, and I withdraw it. Owning
gate: 2 (ADR-017 amendment) + a comment correction.**

DES-127 B5 ("a failure must never clobber a prior `ready` row") is an **in-memory compensation**
(`_runJob`'s `priorRow`), not an invariant. `putDiagramPending`'s `ON CONFLICT … SET
status='pending', diagram=NULL, note_code=NULL, generated_at=excluded.generated_at,
bindings_fp=NULL` (`workflow-catalog.ts:249-258`) destroys the prior row on disk; on
`regenerate → crash → boot sweep`, `sweepAtBoot` requeues with `priorRow = null` (`:176-179`) and a
failed attempt loses a previously-good diagram permanently. The in-line comment there — *"a
still-pending row was never 'ready' — nothing to restore on failure"* — is **false** for that
sequence.

I initially favoured "stop nulling `diagram` on conflict." **That is wrong as costed**, and the
structural reason is the finding worth recording: **`generated_at` serves two state machines at
once** — provenance stamp on `ready`/`unavailable` rows, and boot-sweep attempt marker on `pending`
rows, which is precisely what `sweepAtBoot`'s three branches discriminate on. Preserving a prior
diagram through `pending` therefore needs `prior_*` columns (or a separate marker column) plus a
migration, and a `pending` row carrying an old `generated_at` would be mis-read by the next sweep as
"stamped by a dead process" and settled over. So: **primary = the reviewer's option** (state the
window in ADR-017, correct the false comment), **alternative = the schema variant, honestly costed
as a migration**, deferred. Amend ADR-017 to say the durable guarantee is *"`pending` always
settles"*, and that *"a prior `ready` diagram survives a failure only within one process lifetime;
across a crash it is lost — the row is `unavailable`, never stale-but-wrong,"* which is at least
consistent with owner decision A1.

**Recorded, not architected around:** S-1 (every registration costs an LLM call, ceiling-less
catalog). With P1 landed, the cost surface is bounded by *authenticated principals* × ADR-014's
`maxWorkflowVersions`, and `workflow_regenerate_diagram` is owner-gated. No rate limiter. This is
conditional on P3 — the reviewer's own §4.4 note is right that a bound one throw can lose is not a
bound.

### 2.3 Testability lens

**P4 — A5: one exported ordered constant, interpolated, asserted at both copy sites. Owning gates:
5 + 6.** Export the ordered glyph list from `diagram-gate.ts`, interpolate it into the shipped
default `systemPrompt`, delete the false "third consumer" comment at `server.ts:300`, and add one
membership assertion covering the prompt string **and** `rwe.config.example.json:59` (a file read,
which is the point — the config example is the copy that rots silently). 08-validation ROUND 3's own
live failure mode is `GATE_REJECTED_SHAPE`/`gateFail:"codepoint"`, i.e. prompt-vocabulary vs
gate-vocabulary disagreement, so this is not hypothetical drift.

**A5 collides with REQ-104 and the resolution must be written down, or a careful reader will file it
as a new violation.** REQ-104 says *"no analyzer harness value is hard-coded in engine source"*, and
interpolating the vocabulary into the default prompt puts vocabulary in source. The resolution:
**the default is source; an operator override replaces the prompt wholesale, and the gate constant
is unchanged either way** — so an override can never *widen* the vocabulary, and an override with a
wrong vocabulary self-diagnoses as `GATE_REJECTED_SHAPE`. That asymmetry is ADR-015 restated ("the
system prompt is a hint, the gate is the control") and belongs in ARCH-080's note.

**P5 — A6: the drift-lock is currently a subset assertion, which is why it admitted two tools
silently. Owning gate: 5.** `tests/integration/mcp-tools-list-schema.test.ts:28-39` lists ten tools
and neither `workflow_describe` nor `workflow_regenerate_diagram`; the only assertions reaching them
are generic loops a one-word description would pass. ARCH-082's "**Both** new tool schemas join
ARCH-051's structured drift-lock" is asserted nowhere, so REQ-101's last clause (a schema-only
client learns the script is deliberately not in the response) has no test. Amend **ARCH-051**:

> the drift-lock asserts **set equality** between the advertised tool list and the test's literal
> expectation, not containment — adding a tool without updating the lock must turn the build red.
> Per the carried-in rule *"a test whose oracle is the code under test cannot fail when the code is
> wrong,"* the literal list stays in the test and is never imported from `server.ts`.

Plus one literal assertion on `server.ts:493`'s served sentence — today deleting it turns nothing
red.

**V-C (original) — every seam this design added is a happy-path seam.** ARCH-079 inv 8 introduced
`schedule` (default `setImmediate`, tests pass `runInline`) precisely so the job runs
deterministically. But the **failure** path has no seam: there is no injection point that makes
`getTriggerBindings` or `putDiagramResult` throw, which is exactly why A3 has no test. Generalize it
in ARCH-079: *"a seam added for happy-path determinism must also admit the failure the invariant
claims to survive; otherwise the invariant is prose."* Concretely this costs nothing new — `ports`
and `catalog` are already injected, so the Gate-5 RED row is "a throwing `putDiagramResult`, and the
*next* enqueued job still runs."

**Testability of P1**, so Gate 5 has an oracle: one parameterized route test over
`{authEnabled:false}` → 200; `{authEnabled:true, loopback peer}` → 200; `{authEnabled:true,
non-loopback, no/invalid bearer}` → **401 + `WWW-Authenticate`, and zero store reads**; plus a
**parity** assertion that the 200 bodies are key-identical to the MCP tool's `result` under the
existing two-sided `EXPECTED_DESCRIBE_KEYS` literal oracle. The parity assertion is the structural
guarantee ARCH-081 already claims and currently only exercises on one of the two call sites.

---

## 3. Risks

**R1 — P1 partially retires a ratified non-goal (REQ-086: "the read-only dashboard remains
unauthenticated").** Needs an owner ruling (`ADJ-A1`). Mitigation: loopback exemption preserves the
documented operator posture; blast radius is one view once A4 lands. *If the owner rules the route
stays open,* then the honest consequence is that ARCH-083 and ADR-012's masking posture must be
amended to **say** the describe payload is public-by-decision, and `EXPECTED_NON_OWNER_KEYS` must be
reconciled with it — the one outcome I will argue against is leaving the documents claiming a gate
that does not exist.

**R2 — P2's choke-point guard is safe only while `mcp-facade.ts:462-464` short-circuits.** If that
short-circuit is ever removed, an `enabled:false` regenerate nulls a good diagram before settling.
Mitigation: assert it (§2.1 P2). This is the *same* class as A10 — a compensation standing in for an
invariant.

**R3 — P1 edits the request dispatcher**, the file with this iteration's highest defect density.
Smaller than it first appears: P1 **adds a gate, it does not move a route** (§2.1) — the handler
stays at `:1918-1930` and the auth block gains a fourth 401-or-fall-through clause using an existing
predicate pair (`isLoopbackPeer` + `resolvePrincipal`), introducing no new concept. The residual
risk is the auth-disabled path, and it is the one Gate 5 must assert first
(`{authEnabled:false} → 200`), because a gate placed one block too deep returns 404 to every
no-auth deployment. The rejected fallback — threading a resolved principal into
`handleDashboardRequest` — I like less: it makes an authorization decision reachable from a block
whose other seven routes do not make one, i.e. it re-creates the condition that produced A1.

**R4 — A7's amendment could be read as a rubber stamp.** Mitigation: the amendment records the
re-audit *result* per member and the rule for future widenings, not just the four names.

**R5 — scope creep back into Gates 5/6.** Four of my eight proposals are Gate 5/6 work. Mitigation:
each carries an owning-gate tag and contributes only an invariant here. Gate 2 must not "fix" A2/A3
in prose and let Gate 5 skip the RED row — this ledger has a recorded instance of exactly that.

**R6 — A10 remains a real, accepted data-loss window** after the recommended fix. It is
`regenerate → crash → sweep` only, it degrades to `unavailable` (never to stale-but-wrong), and the
schema variant is available if the owner values the prior diagram more than a migration.

---

## 4. Karpathy check (what I am NOT proposing)

No rate limiter. No distributed lock or leader election. No second masking projection. No
`diagramCache`. No `admin` trust tier. No new state store. No `unhandledRejection` global handler
(a `.catch()` at the one scheduler site is the fix; a global handler converts a crash into silent
corruption everywhere). No `DISABLED` note-code migration. No preserved-prior-diagram schema change.
**Net new mechanism across all eight proposals: one reuse of an existing predicate pair (P1), one
`finally` + one `.catch()` (P3), one `if` (P2), one exported constant (P4), one `toEqual` where a
`toContain` stands (P5).** Everything else is amendment text — which is the correct output for a
gate whose deviations are 40% "the row was never edited".

---

## 5. Where my three lenses fight, and how I break the tie

**C1 — A1: security wants the route gated; consumability/availability wants it open; testability is
neutral-to-positive on gating (an auth branch is testable; an implicit posture is not).** The real
conflict is that the route's *only* consumer is an explicitly-unauthenticated dashboard, so gating
it under auth = deleting the browser feature for remote viewers. **Tie-break: `dbindExempt`.** It is
the minimum mechanism that satisfies security (no anonymous remote topology read), preserves the
documented operator posture (loopback/SSH-tunnel browsers keep working), and adds zero new concepts.
Karpathy: reusing REQ-089's predicate beats inventing a per-surface policy.

**C2 — A10: security's instinct is that a `pending` row must not serve a diagram whose provenance is
mid-flight; availability wants the last-good diagram retained.** On inspection **security has no
real objection**: a retained diagram is a previously gate-passed artifact for the *same*
`(name, version)`, so retention opens no disclosure the surface did not already have. The genuine
objection is a *consistency* one — `status` and payload would disagree — and it is answered by
fields the response already carries (`diagramStatus`, `diagramGeneratedAt`). **So the tie is broken
not by lens but by cost** (§2.2 P8: `generated_at`'s double duty makes it a migration), and I say so
explicitly because "security prefers nulling" would be a false justification for the cheap option.

**C3 — A2: security wants one choke-point guard; testability wants the guard visible at each caller
so each caller's behaviour is asserted independently.** Resolved without a trade: the guard goes at
`_startJob` (drift-proof for a future fourth caller) **and** Gate 5 writes one RED row *per entry
point* asserting `gateway.invoke` is never called — the gateway is already injected, so per-caller
assertions cost nothing extra. Testability's real requirement was per-caller *assertions*, not
per-caller *code*.

**C4 — A5: security's fix (interpolate the gate constant into the shipped prompt) reads as a
REQ-104 violation ("no analyzer harness value hard-coded in engine source"), which is a
replaceability/config-separation requirement.** Tie-break by asymmetry, not by precedence: the
constant governs the **gate**, which an operator cannot override; the prompt is a default an
operator replaces wholesale. So interpolation cannot reduce operator tunability, and it removes the
one drift (prompt vocabulary vs gate vocabulary) that 08-validation shows failing in real runs.
Must be *stated* in ARCH-080, because the collision is real and a future reviewer will re-file it.

**C5 — the standing lens tension in this slice, restated:** security's answer to every analyzer
question is "gate it, allowlist it, do not call the model"; scalability's is "the model call is the
product, bound it"; testability's is "make it deterministic". The one place all three agree is
**ARCH-080's gate**, which is why it is the only part of v23 with no HIGH against it. That
agreement is evidence the gate is in the right place, and I would resist any send-back fix that
moves policy *out* of it.

---

## 6. Expected disagreements with the quality-dimensions lens

1. **A1 (biggest).** I expect quality to weight **consumability** — the dashboard's describe view
   and README's 「任何人都能問」 — and to prefer keeping the route open with a trimmed payload. I
   will argue that is the forbidden second mask, that an empty `triggers[]` is a silent lie under
   this iteration's own honest-absence rule, and that `dbindExempt` gives them the operator's
   browser back for free. **Expected convergence point:** both of us treat "the documents claim a
   gate that does not exist" as unacceptable; we differ on which side of the claim moves.
2. **A10.** Quality's self-sustainability instinct is "document the window honestly" — which is now
   *also* my recommendation, but I arrived via cost, not via honesty, and I want the **structural
   cause** (`generated_at` serving two state machines) in the amendment. Expect them to accept the
   cause and to be lukewarm on carrying the schema variant as a named alternative.
3. **A2.** Quality filed this as SUS-1 against the sweep branch; I move the guard to `_startJob`.
   Expect them to object that a guard inside a private method is less **observable** than one at the
   call site. Counter: the journal line already carries the outcome per run, and a settle emits it.
4. **Auto-retry.** Quality's self-sustainability lens may want `unavailable` to self-heal in the
   background. ADR-017 forbids it and I side with ADR-017: a background retry is an unbounded cost
   loop against a paid provider, and A3 shows this module cannot yet be trusted with an unattended
   loop.
5. **Observability additions.** I expect quality to propose an effective-config readback surface or
   a gate-decision counter. ARCH-079 inv 5's journal line already carries `model` per run (the
   wiring-gap signature) and ARCH-080's split reason code already separates the security event
   (`GATE_REJECTED_CONTENT`) from the replaceability event (`GATE_REJECTED_SHAPE`). Both exist; I
   will argue against a third surface.
6. **A7 severity.** I escalate LOW→MED on security grounds (it is ADR-015's audit input). Expect
   quality to hold it at LOW as documentation drift. Severity is the disagreement; the amendment
   text is not.
7. **Where I expect no daylight:** A3's fix, A4's deletion, A5's single constant, A6's equality
   assertion, A8's and A9's straight amendments. Both prior panels agreed on facts everywhere they
   overlapped, and I found nothing in the code to reopen.

---

## 7. Concrete amendment list handed to Gate 2's writer

| # | Row | Amendment | Gate |
|---|-----|-----------|------|
| P1 | **ARCH-083** `api:` | Replace "auth-gated exactly as the route it replaces" with the literal `!authEnabled ‖ loopback ‖ resolvePrincipal` rule; state that the **gate** joins the `authHandlers` block as the **fourth** `dbindExempt` member (401 or fall through) while the **handler stays** at `:1918-1930`, because the block is skipped entirely when auth is off; name the guard test. Record `ADJ-A1` (partially retires REQ-086's dashboard non-goal) and the README/DEPLOY edits. | 2 |
| P2 | **ARCH-085** + **ARCH-079** | New invariant: no path reaches `gateway` when `enabled:false`; guard at `_startJob`; it **settles** (`RETRIES_EXHAUSTED`, because `DISABLED` is read-synthesized only and outside the `note_code` CHECK). Note the load-bearing `ANALYZER_DISABLED` short-circuit. | 2 (text) / 5,6 |
| P3 | **ARCH-079** inv 2 | A bound requires release-on-every-exit-path: `finally`, catch→settle+journal, `.catch()` at the `setImmediate` site; no `void promise` on engine paths. State that a wedge reports itself as `QUEUE_FULL`. | 2 (text) / 5,6 |
| P4 | **ARCH-080** | Reduce the "three consumers" claim to one exported ordered constant + interpolation into the default prompt + a membership assertion over the prompt and `rwe.config.example.json`; add the REQ-104 asymmetry paragraph (default is source, override is wholesale, gate is unoverridable). | 2 (text) / 5,6 |
| P5 | **ARCH-051** / **ARCH-082** | Drift-lock is **set equality**, not containment; literal expectation stays in the test; one literal assertion on the script-absence sentence. | 2 (text) / 5 |
| P6 | **ARCH-079** inv 6 | True membership (+`meta.phases[].title`, `'default'`, `'model:param'`, `UNBOUND_ENTRY_LABEL`; −`DIAGRAM_CODEPOINTS`→shape pass); record the ADR-015 re-audit **result** per member; add the rule for future widenings. **MED, not LOW.** | 2 |
| P7 | **ARCH-084** | The mini-preview is **deleted**, not re-pointed; state the 20N/min amplification it caused and that A1+A4 close two halves of one hole. | 2 (text) / 6 |
| P8 | **ADR-017** / **ARCH-077** / **ADR-021** | State the `regenerate→crash→sweep` window and its cause (`generated_at` serving two state machines); correct the false comment. Strike the `maxWorkflowVersions` **prune** — the ceiling *refuses registration* (`workflow-catalog.ts:441-445`); note diagram rows are consequently bounded, not pruned. | 2 |
| — | **ARCH-079** inv 4 | Strike "provider HTTP status" from the journal line (struck by DES-129, never amended); record the replaceability-observability loss as accepted. | 2 |
| — | **ADR-022** / **ARCH-083** | Grep allowlist is **four** entries (`graph-analyzer.ts` added by adjudication #3); say the test pins the size so the number cannot re-drift. | 2 |
| V-A | **ARCH-079** inv 9 (new) | The boot sweep stamps before scheduling; the stamp is what makes the requeue at-most-once across restarts under `Restart=on-failure`. | 2 |
| V-B | **ARCH-079** | The bounds are **per-process**; the durable row is the only cross-process state and has no lock; multi-instance over one catalog is out of scope. | 2 |
| V-C | **ARCH-079** inv 8 | A seam added for happy-path determinism must also admit the failure the invariant claims to survive. | 2 |

**Verified by me at `file:line` for this proposal** (not taken from either prior panel or from ledger
prose): `server.ts:1169-1183`, `:1241-1244`, `:1719-1722`, `:1774/1798/1834`, `:1918-1930`;
`workflow-view.ts:40-62`, `:87-105`, `:131-133`; `workflow-catalog.ts:240-258`, `:270`, `:598`;
`graph-analyzer.ts:14-21`, `:108-160`, `:165-199`, `:250-344`; `dashboard-page.ts:203-246`;
`DEPLOY.md:500`, `:882`. **One claim of my own falsified and withdrawn** (V-A: the crash-loop is
bounded), **one costing of my own falsified and withdrawn** (P8: the ON CONFLICT change is a
migration, not a one-liner).
