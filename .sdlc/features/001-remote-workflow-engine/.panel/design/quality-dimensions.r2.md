# Design panel r2 — Quality-dimensions lens (v22: REQ-096..100, ARCH-071..076, ADR-009..014)

lens: quality-dimensions (observability / replaceability / consumability / self-sustainability)
round: 2 (convergence — responses to adversarial.r1, final position, remaining disagreements)
inputs read: `adversarial.r1.md` (full), my `quality-dimensions.r1.md`. Only two r1s exist in the panel dir.
note: this file **replaces a stale v21-round `quality-dimensions.r2.md`** that was left on disk from the
previous iteration (its header said REQ-090..095); do not read git history of this path as a v22 flip-flop.

## 0. Headline disposition

Adversarial r1 worked one layer below my r1 (signatures, a closed error table, oracles, primary-source line
numbers) and the two proposals are complementary, not opposed. **I concede or converge on every one of their
seven ranked findings**, several of which are holes my r1 missed outright (the stranded pre-v22 suspended
run; `scriptSha256` permanently unsatisfiable; the three-way `scriptVersion` field conflation). Of their
eight predicted disagreements with me (§6), **five were mispredictions** — my r1 already held their
position — and the rest converge with small riders. I make **one owned retraction** (SUS-1: per-version
delete is now in-slice, my "prune is a future requirements decision" is withdrawn), contribute **one guard
their own logic requires** (`VERSION_IN_USE` on per-version delete — without it their §2B.1 "closed cohort"
argument is falsified by their own §2B.4), and **hold two items they did not address**: the `validation`
key in the non-owner view (my lead finding — now a *blocking* decision, because their own key-set oracle
cannot be written until `EXPECTED_NON_OWNER_KEYS` is final) and where the fire-time trigger refusal lands
(my OBS-2/R2).

## 1. Responses to adversarial r1 — rebut / concede / hold

### 1.1 Their seven ranked findings

| Their item | Disposition | Reason |
|---|---|---|
| §2B.1 pre-v22 suspended named run stranded by the pin (HIGH) | **Concede the gap (my r1 missed the cohort); endorse option (b), with an observability rider** | Their mechanism is verified primary source (`run-manager.ts:385-394`, `workflow-catalog.ts:210-220`): the old bytes are already destroyed, so option (c)'s pin rewrite would *manufacture* a false REQ-096 answer — their reasoning for rejecting (c) is exactly this lens's. (b) is fail-soft degradation **recorded, not silent**: the substitution lands on the run's `validation` observation. Rider (folds into my OBS-1): the substitution must be visible **on the wire** — `workflow_status` for that run must surface it from the recorded observation, not leave it a stored-but-never-read field. Their RED-test shape (hand-built legacy fixture, assert resume + recorded substitution) is endorsed as-is; add one assertion on the status response. |
| §2A.7 `scriptSha256` permanently unsatisfiable | **Concede — my r1 missed it; textbook consumability defect** | An advertised parameter whose every use errors is the inverse of message-carries-recipe: the schema itself teaches the agent a lie. Remove with `script` in the same task, absence joins the ARCH-051 drift-lock. Their refusal to re-offer it on `workflow_register` is right (no requirement buys it). |
| §2A.1 complete catalog surface; `getFull` **renamed** to `resolveDetail` | **Concede/endorse — this is my REP-1 done properly** | Rename-not-keep makes every call site a compile error — the only mechanism this repo has that reliably works against the unwired-module class. `exists(): boolean` never-throws kills the `try/catch`-as-existence pattern at four call sites; `resolve()` excluding `owner` keeps authorization inputs off the execution read. All four contract points adopted. |
| §2A.4 `SubmissionValidatorDeps` shrinks to `{catalog}` | **Concede/endorse — REP-3's bug class, prevented in the opposite direction** | My r1 only guarded wiring-in (composeConfig class); they spotted the dual: dead wiring left behind is a standing invitation to grow a second enforcement site. Deleting the three dep fields turns that into a `tsc` error. Adopted. |
| §2B.4 version ceiling wedge → `workflow_deregister({name, version?})` | **Concede, and I retract SUS-1's deferral — with one guard their own argument requires (§1.3)** | Owned retraction: my r1 said prune is "a future requirements decision, not designed now" because the fence's one new MCP tool was spent. An optional parameter on an existing tool is not a new tool; the fence holds, and a wedge reachable by using the feature as designed (their words) is not simplicity. Their two refusals (channel-pointed, last-remaining) are necessary but **not sufficient** — see §1.3 for `VERSION_IN_USE`. `VERSION_CEILING_EXCEEDED`'s message names this escape (merges into my CONS-1 template table, satisfying my SUS-1(a)). |
| §2A.5 three meanings of `scriptVersion`; distinct journal field + decouple the counter | **Concede/endorse — observability is field-meaning purity** | Their primary-source finding (counter seeded from catalog version at `:394`, re-stamped `` `v${…}` `` at `:883`) shows the journal stamp is *already* neither meaning after the first resume. `resolvedWorkflowVersion?: string` as a new field + counter seeded from 1: both rulings adopted. A field that means two things is unobservable in the precise sense — you cannot ask it a question and trust the answer. |
| §2B.3 `.immediate()` + typed `REGISTRATION_CONFLICT` | **Concede/endorse** | Self-sustainability: an untyped 500 under self-update overlap is exactly the silent-ish failure ARCH-071 inv-5 claims to prevent; the typed "retry" code is the graceful-degradation shape. Their honesty that the race itself is not in-process-testable (assert transaction mode, record the residual) is the right testability call. |

### 1.2 Their §6 predicted disagreements with me — scored

| # | Their prediction | Actual disposition |
|---|---|---|
| 6.1 publish audit trail (they cite "their OBS-2" — **citation error: it is my OBS-3**; OBS-2 is fire-time refusals) | **Converged, their rider accepted.** My r1 proposed exactly one log line, no table — ADR-009's decline stands. Their half-concession is a genuine improvement: an unasserted INFO line is the same class as an unwired module. The design pins the line's fields (`name, channel, fromVersion, toVersion, principal, at`) and a test asserts them. |
| 6.2 `validation` on `workflow_list` | **Misprediction — no dispute.** My r1's R5 already accepted the exclusion (3s poll × per-row parse); `workflow_get` is the seam. |
| 6.3 dashboard identity | **Misprediction; their mitigation endorsed.** I never asked for browser-session identity. The masked panel showing the exact `workflow_get` invocation that would return the script to its owner is message-carries-recipe applied to a dashboard — adopted into CONS-1's spirit at zero cost. |
| 6.4 retention/GC sweep | **Misprediction.** My r1 explicitly endorsed ceiling-with-visible-refusal *over* silent GC (dangling run pins). The real residual was the wedge, resolved via §2B.4 + §1.3. |
| 6.5 `resolveVersionRequest` as a separate injected module | **Concede their placement.** Replaceability is satisfied by purity + injected inputs (`ReadonlySet`, not a DB handle), not by file count. Exported pure function in the owning file; equally table-testable. |
| 6.6 `workflow_resume({runId, version})` (they cite "their CON-3" — **attribution error: my CONS-3 was inputSchema descriptions; I never proposed resume-time version selection**) | **No dispute.** ADR-010 stands; the legacy cohort they suspected I was reaching for is properly fixed by §2B.1(b). |
| 6.7 `Scheduler.create` resolves-release refusal | **Misprediction — my SUS-3 endorsed it in r1.** Their error-text sharpening ("publish `<name>@<version>` to `release` first") merges into the CONS-1 template table alongside my `context: 'schedule_create'` marker. No `schedule_create({channel})` — agreed. |
| 6.8 author-chosen version strings / semver | **Misprediction.** Never proposed; engine-assigned `v<n>` endorsed (their ambiguity argument — an author string colliding with a channel name — is a good extra reason). |
| 6.9 where they expected agreement | Confirmed: `get(name)` deleted outright; `WorkflowPublicView` with `script` unrepresentable. On record. |

### 1.3 My round-2 contribution: `VERSION_IN_USE` — the guard their own logic requires

Their §5.1 justifies the §2B.1 legacy fallback *because* "the cohort is closed and cannot grow after the
migration." Their §2B.4 per-version delete **falsifies that premise**: an author deletes `v2` while a run
suspended at pin `v2` sleeps, and we have recreated the identical stranding — post-v22, author-inflicted,
reachable forever. The two refusals they specified (channel-pointed, last-remaining) do not cover it.

**Rider (this lens insists):** `workflow_deregister({name, version})` also refuses when any **non-terminal**
run (`queued|running|suspended`) pins that version — one `SELECT` on the existing `runs.scriptVersion`
column, typed `VERSION_IN_USE`, message naming the blocking run id(s) (CONS-1: the error is the runbook).
Terminal runs do **not** block deletion — their pin degrades to the already-specified fail-soft shape
(pin string survives on the run record, status renders, DAG falls back; SUS-2's tests extend to cover the
per-version case). With pointer-clearing transactional alongside the delete (their §2B.6), their
`DANGLING_CHANNEL` becomes a true never-should-happen invariant code; it joins the CONS-1 table as such.

If adversarial contests the extra `SELECT` on cost grounds: it runs only inside an owner-initiated delete,
never on a hot path, and the alternative is re-opening §2B.1 as a permanent class instead of a closed cohort.

### 1.4 Smaller adoptions and merges (no dispute)

- **§2A.2 truth table, channel-token-first precedence** — adopted, including the four precedence-collision
  test rows. `DANGLING_CHANNEL` and the `requested` echo both join my CONS-1/OBS-1 items.
- **§2A.3 `workflow_run` returns `{runId, version, requested}`** — claimed as OBS-1 converged: the pin is
  usable without a second `workflow_status` call, and it is how a caller *sees* which of version/channel won
  (paying the silently-discarded-argument debt with visibility instead of an error — their §5.2, co-signed).
- **§2A.3 additive fourth `createRun` param, options-object refactor deferred as recorded debt** — endorsed;
  33 mechanical edits is review budget this slice cannot spare. Discriminated-union `RequestShape` adopted
  (renderable without parsing = consumability).
- **§2A.6 `MISSING_SCRIPT` → `MISSING_NAME`** — endorsed; an error code that teaches an agent to retry with
  a removed parameter is an agent-altitude defect, their framing exactly.
- **§2A.6 no unification of `UNKNOWN_WORKFLOW`/`WORKFLOW_NOT_FOUND`/`CatalogNotFoundError` in v22** —
  concede (churn vs. silent-failure risk profile), with the mapping pinned as a row block **inside the
  CONS-1 table** so Gate 5/6 cannot add a fourth name.
- **§2B.2 `DROP COLUMN` + `PRAGMA table_info` absence assertion** — endorsed; "the assertion, not a review,
  is what makes 'moved' true" is this lens's replaceability creed verbatim.
- **§2B.5 NULL-owner distinct remediation text** ("no recorded owner; run the boot backfill") — endorsed;
  one string is the difference between a bug report and a fix.
- **§2C oracles 1–6** — all endorsed. My OBS-1 (literal key assertions on `workflow_status`) and OBS-4
  (second boot logs 0-migrated, not silence) merge into their oracle set; their oracle 3 (IT-011 relative →
  literal) is v22 Rule 1 applied to the exact field this slice promotes to the pin.
- **§2C clock note** — `workflow_versions.createdAt` via `this._clock.isoNow()`: endorsed (untestable
  ordering under a fake clock is an observability failure of the test tier itself).
- **§3 task groupings T1/T4/T7/T2 + orderings** — fully compatible with my r1 task notes; merged. My note 1
  (wiring travels with the constructor) = their T7; my note 2 (real-transport masking as DoD) = their T4;
  my note 3 (pure-first TDD) is compatible with their "fixture task first"; my note 4 (one shared
  error-taxonomy DES item) now hosts their §2A.6 table as its content.

## 2. Final position — the four dimensions

### Dimension 1 — Observability

Altitude unchanged from r1: system-dominant; agent-side transcript/token observability (REQ-007) untouched
by this slice — recorded so the dimension is judged, not skipped. Final package:

1. **OBS-1 (wire, not just record):** `workflow_status`/`/api/runs/:id` carry `{version (pin), requested,
   validation}` with literal key assertions; **extended r2:** `workflow_run` returns `{runId, version,
   requested}` (their §2A.3, converged); the §2B.1(b) legacy substitution is surfaced on `workflow_status`
   from the recorded observation. `RequestShape` is a discriminated union.
2. **OBS-2 (held — unaddressed by adversarial, still open):** fire-time resolution refusals on unattended
   triggers (standing schedule/webhook/chain hitting `CHANNEL_UNPUBLISHED`/deregistered name at 3am with no
   caller) must land in a run-refused/trigger-failed journal entry attributable to the schedule id, surfaced
   in the ARCH-046/047 reliability metrics. A log line alone is not a seam a caller can read. This is my R2
   and I restate it for the synthesizer as the default unless rebutted.
3. **OBS-3 (converged with their rider):** one structured journal line per successful `publish`
   (`{name, channel, fromVersion, toVersion, principal, at}`), **fields test-pinned** — unasserted logging
   is the unwired-module class. No audit table; ADR-009 stands.
4. **OBS-4:** migration boot line contract + idempotent second boot logs `0 migrated` (asserted in S-2's
   real-fixture test, per their oracle 2's hand-written-SQL rule).
5. **Field-meaning purity (new, from their §2A.5):** `resolvedWorkflowVersion` as a distinct journal field;
   resume counter decoupled and seeded from 1. A field with two meanings cannot be trusted to answer either
   question.

### Dimension 2 — Replaceability

1. **Compile-error-driven replacement:** `get()` deleted, `getFull` **renamed** `resolveDetail` (their
   §2A.1 — adopted over my r1's silence on `getFull`); `SubmissionValidatorDeps` shrunk to `{catalog}`
   (their §2A.4) so both directions of the wiring bug class are `tsc` errors.
2. **Port shapes pinned (REP-1):** `validateScriptEntry`'s `mcpLookup` is `(name) => boolean`, not the
   registry object; `resolveVersionRequest` takes `ReadonlySet<string>`, not a DB handle. Placement
   conceded to adversarial: exported pure function in the owning file, no separate module — purity, not
   file count, is what buys replaceability.
3. **One-predicate rule (REP-2):** `FRAME_CLOSE_FORGERY` imported from `params/contract.ts`; grep-style
   test asserts no second regex copy (v21 QD-REP-1 precedent). Their oracle 6's structural assertions are
   the same instrument generalized; endorsed wholesale.
4. **Wiring is DoD (REP-3):** catalog deps + `maxWorkflowVersions` threaded in `main.ts` and added to
   `compose-config-v2-wiring.test.ts` in the same task (= their T7). Storage stays un-injected (their §5.3:
   tmp-workRoot real file beats a `Database` seam — conceded; the simpler design is the more testable one
   here). ADR-014's CAS-ref-ready script column keeps storage replaceable without building it. LLM-backend
   pluggability untouched by the slice — correct.

### Dimension 3 — Consumability

Callers are agents; schema + error text are the documentation (their altitude principle 1 = my r1 stance).

1. **CONS-1, now the design's spine:** one DES item hosting (a) their §2A.6 closed per-surface code table,
   (b) my message-template column (every code's literal template, tested per v22 Rule 1), (c) the
   three-names-one-condition mapping pinned, (d) new rows from r2: `MISSING_NAME` (renamed),
   `DANGLING_CHANNEL` (never-should-happen invariant once §1.3 lands), `REGISTRATION_CONFLICT` ("retry"),
   `VERSION_IN_USE` (names blocking run ids), `LEGACY_PIN_UNRESOLVABLE` **only if** §2B.1 is decided
   strict — my position is (b), so this row should not exist, (e) `VERSION_CEILING_EXCEEDED` naming both
   remedies including the now-real per-version deregister, (f) `CHANNEL_UNPUBLISHED` in `schedule_create`
   context carrying "publish `<name>@<version>` to `release` first", (g) NULL-owner `scriptWithheld` reason
   distinguishing not-owner from no-recorded-owner.
2. **CONS-2:** list → `get(name)` errors → `get(name, version-from-error)` succeeds, asserted as a
   sequence; the error detail (available versions + published channels) widens nothing already on the
   everyone-visible `workflow_list` allowlist.
3. **CONS-3:** `version?`/`channel?` inputSchema descriptions state precedence (version wins; channel
   defaults to release; registration ≠ publication) and join the ARCH-051 drift-lock; `scriptSha256` and
   `script` absent from the schema, absence drift-locked (their §2A.7).
4. **CONS-4 = the lead finding, held (see §3).** Dashboard signpost mitigation (their §6.3) adopted.
5. **Schema-teaches-truth rule (generalizing §2A.7):** no advertised parameter may be permanently
   unsatisfiable; no error code may name a removed concept. Both are agent-altitude defects, not cosmetics.

### Dimension 4 — Self-sustainability

System altitude; agent-altitude memory-metabolism/prompt-calibration remain honestly out of scope, with the
one legitimate mapping unchanged: ARCH-074's lazy read/admission staleness recompute is this system's
tool-liveness probe, and a background sweep stays refused (fence: zero new background jobs).

1. **SUS-1 revised (owned retraction):** the ceiling dead-end is closed *in-slice* by
   `workflow_deregister({name, version?})` (their §2B.4) — my r1's "prune later" deferral is withdrawn:
   an optional parameter is not a new tool, the fence holds, and a documented trap is not simplicity.
   **Conditional on the §1.3 `VERSION_IN_USE` guard**, without which the slice trades an author wedge for
   a permanent run-stranding class.
2. **SUS-2 extended:** the fail-soft degradation shapes are test-pinned, now including: per-version-deleted
   pin on a terminal run (string survives, status renders, DAG falls back), the §2B.1(b) legacy resume with
   recorded substitution, and pre-v22 inline-cohort resume via persisted `spec.script` (ARCH-072 inv-3).
3. **SUS-3 converged:** `Scheduler.create` refusal endorsed by both lenses; error shape = CONS-1 row (f);
   pairs with OBS-2 for the standing-schedule case creation-time checks cannot cover.
4. **Cross-process self-healing:** `.immediate()` transactions + `busy_timeout` + typed
   `REGISTRATION_CONFLICT` (their §2B.3) — degradation under self-update overlap is a typed, actionable
   refusal, not an untyped 500. Migration atomicity/idempotence (ADR-011) unchanged and endorsed.
5. **Legacy-cohort closure (their §2B.1(b)):** the self-healing answer for a closed cohort whose true bytes
   are unrecoverable — substitute, record, surface. Option (c)'s pin rewrite stays rejected jointly: a
   manufactured answer is worse than an honest substitution.

## 3. Remaining disagreements / open items for the synthesizer

1. **[BLOCKING — decide in 04-design] `validation` in the non-owner `workflow_get` view (my r1 lead
   finding, R1).** Adversarial was **silent** on it, but their own altitude principle 2 ("the masked view
   must still let a non-owner agent decide and act") entails my position: an agent choosing between `beta`
   and `release` cannot decide without seeing that beta references a deprovisioned MCP server; withholding
   it only moves discovery to a failed run. This is now *blocking*, not ambient: their §2C.5 two-sided
   key-set oracle **cannot be written** until `EXPECTED_NON_OWNER_KEYS` is finalized. Recommendation
   unchanged: include `validation` (environment status, not script disclosure; `errors[].code/message`
   name only aliases/MCP names the run transcript would surface anyway) and amend the allowlist
   deliberately. If excluded, that must be an explicit recorded decision with the consumability cost named.
2. **[OPEN — unaddressed] OBS-2 fire-time refusal landing.** Restated as the default: journal entry
   attributable to the schedule id + ARCH-046/047 reliability-metrics surfacing. A silently dying cron
   remains this lens's definition of a design defect.
3. **[CONDITIONAL] `VERSION_IN_USE` (§1.3).** I expect adversarial to accept (it is their own closed-cohort
   premise, defended); if contested on cost, the counter is recorded in §1.3. My concession on §2B.4 is
   coupled to this guard.
4. **Coupled pair to carry whole:** their B-3-style coupling discipline applies to §2B.1 — if the
   synthesizer picks strict option (a) over (b), then `LEGACY_PIN_UNRESOLVABLE` enters CONS-1 *and* the
   OBS-1 status-surface rider changes shape; the choice must not be silently halved.
5. **No other disputes remain.** Everything else in both r1s is converged as disposed above; r1 items not
   named here stand unchanged.
