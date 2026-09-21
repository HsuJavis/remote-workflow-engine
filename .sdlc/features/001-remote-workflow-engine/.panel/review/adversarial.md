# Gate 8 review — Adversarial architecture group (security / scalability / testability, Karpathy tie-break)

**Iteration:** v36 (REQ-211..216, ARCH-155..173, ADR-072..079, INV-V36-1..6)
**Compared:** `02-architecture.md` (v36 slice + cross-component invariants) vs. the files named on each v36
`IMPL-358..366` `files:` line, plus their direct module-boundary neighbours (`src/event-log.ts`,
`src/secret-resolver.ts`'s `redact`, `src/authz.ts`, `src/tool-specs.ts`,
`tests/unit/compose-config-v2-wiring.test.ts`, `tests/integration/deploy-control-files.test.ts`).
**Verdict:** NOT consistent — **7 violations** (3 medium, 4 low). No blocker: nothing here is a
live exploit path on the default deployment, and the two medium security items are an
*unenforced-as-written invariant* and an *unwritten guard*, not a new hole opened by v36 code.

**How the three lenses voted, and where they fight.** Security and testability collide twice in this
slice and the collisions are worth naming before the list: (i) ARCH-159's `createEventSink({})`
default exists *so that 80 construction sites keep compiling* — a testability/compat win that is
exactly what turned the IMPL-358 wiring miss into a silent unredacted-secret write instead of a
crash; (ii) ARCH-164's `RWE_START_CMD` seam is a testability win that security should not want in a
deploy script (an env var that names the command a root-ish deploy path executes). In both cases
Karpathy's tie-break agrees with what the implementation actually did, and the defect is that Gate 2
was never amended to say so. Scalability's only real disagreement is with ARCH-162's cost claim
(F7), which is a rationale error rather than a code error.

---

## F1 — INV-V36-4 ("one sink, one redaction") is not enforced; three surviving `console.log` paths write operational lines with no redaction
- **Violated:** INV-V36-4 (`02-architecture.md:5107`), and ARCH-161's 「One log path, not two」 rationale (`:4836`)
- **Severity:** MEDIUM — **lens: security** (scalability/testability neutral)
- **Evidence:**
  - `src/run-manager.ts:1083` — `` console.log(`run.legacySubstitution: ${JSON.stringify({runId, name, ...sub})}`) ``
  - `src/run-manager.ts:942` — `console.log(JSON.stringify({event:'usage_backfill_failed', runId, error: (err as Error).message}))`
  - `src/run-manager.ts:1337` — `console.log(JSON.stringify({event:'run_settle_failed', runId, error: String(e)}))`
  - `src/run-manager.ts:946`, `src/workflow-catalog.ts:261`, `src/workflow-catalog.ts:299`, `src/store/sqlite-run-store.ts:461`, `src/server.ts:1030` — further structured/operational lines on bare `console.log`
  - the audited path, for contrast: `src/event-log.ts:30` (`redact(...)` inside the sink)

  INV-V36-4 is written absolutely: *「Every structured operational line leaves the engine through
  `src/event-log.ts`'s sink … **No module writes an operational line with `console.log` after this
  slice**; a second path would be a second redaction posture.」* The implementation moved exactly one
  line (`catalog.publish`, `workflow-catalog.ts:899-901`) and added three new kinds. DES-243 then
  closed the `EngineEvent` union on purpose (「exactly the four kinds v36 emits」,
  `04-design.md:8918`) — so the design and the invariant disagree, and the code follows the design.

  Two of the survivors are the *second redaction posture* the invariant names, literally:
  `usage_backfill_failed` and `run_settle_failed` put `(err as Error).message` / `String(e)` on
  stdout with no `redact()` between. That is the same class of channel IMPL-358 was raised as a P1
  security blocker for; `run-manager.ts:1337`'s own comment even cites `usage_backfill_failed` as
  the precedent it is copying.

  The sharpest one is `run.legacySubstitution` at `:1083`. It is (a) the exact
  `` `<prefix>: ${JSON.stringify(...)}` `` shape ARCH-161 says the slice **deletes** rather than
  duplicates, and (b) the very line ARCH-155 cites as the thing that makes a substituted resume
  invisible (「records one `run.legacySubstitution` line and **continues executing different code**,
  which no caller ever sees」, `:4782`). v36 put the *refusal* side of that story on the audited sink
  (`catalog.deregister`, `workflow-catalog.ts:782`) and left the *substitution* side on
  `console.log`. An operator grepping the one audited stream for 「what happened to this run」 still
  cannot see it.
- **Honest scope:** every line above is pre-v36 and no v36 TASK asked to move any of them. The
  defect is that INV-V36-4 claims a property the slice did not deliver.
- **Resolution (pick one, Gate 8 owner's call):** (a) amend INV-V36-4 to its true scope — 「the four
  `EngineEvent` kinds leave through the sink; pre-v36 engine-log lines are filed for v37」 — and file
  the three unredacted ones as a named security item; or (b) route `usage_backfill_failed` /
  `run_settle_failed` / `run.legacySubstitution` through `_eventSink` (3 new union members, ~6 lines)
  and keep the invariant as written. Karpathy tie-break favours (a) + a filed item, because (b)
  widens a union the design deliberately closed this round.

## F2 — the wiring guard ARCH-159 and ARCH-171 both mandate was never written, and VAL-251 records it as green
- **Violated:** ARCH-159's 「The wiring is the known failure mode, so it is guarded rather than
  trusted … One probe row for `eventSink`, in the same sweep, in the same commit」 (`:4818`);
  ARCH-171's 「K8 rides the same commit: one `attempts` probe row (~3 lines) in
  `compose-config-v2-wiring.test.ts`'s sweep」 (`:4926`)
- **Severity:** MEDIUM — **lens: testability** (security co-signs: this is the guard whose absence
  let the P1 through)
- **Evidence:**
  - `tests/unit/compose-config-v2-wiring.test.ts` (361 lines) — `grep -n 'eventSink|attemptsFor|gatewayAttempts'` returns **nothing**. The only hit for `attempts` is the pre-existing `FileConfig` probe value `retries: 3` at `:321`.
  - `05-tests.md:14906-14908` — records, correctly, that no `eventSink` row was added and that DES-243 ruled it out in favour of the composition-root IT.
  - `git log --oneline a8a7b08^..HEAD -- tests/unit/compose-config-v2-wiring.test.ts` → **empty**. No v36 commit touched the file at all, so neither mandated row was written.
  - `05-tests.md:15275-15277` (VAL-251) — *「**K8**: a test-only `compose-config-v2-wiring.test.ts` probe, already green in the Gate 6.5+7 regression run」*. Read against the git history this is **imprecise attribution of a pre-v36 row**, not a fabricated test: the file's `retries: 3` probe (`:321`) is green, but it is pre-existing `FileConfig` fixture data, and `retries` is the *input* to `attemptsFor`, not the derived `gatewayAttempts` forwarding ARCH-171 asked to lock. 「already green」 is technically true and evidentially empty — a row that was green before the slice proves nothing the slice added.
- **Why this is the finding and not a bookkeeping nit:** ARCH-159 wrote down the failure mode
  (「a new `main.ts` forwarding that is never actually forwarded is this repo's documented bug
  class」), named the systematic instrument, and the instrument was not built. **The predicted
  failure then happened**: IMPL-358 (`06-impl-log.md:9236`) is a Gate-8 send-back P1 — production
  wrote unredacted secret values into the audit log behind a fully green suite, caught by a human
  reading `server.ts`, not by a test. IT-294's two new cases are a post-hoc, per-feature
  replacement; ARCH-159 explicitly says a per-feature test 「does not replace」 the systematic sweep.
- **Mitigation already in the ledger:** the `eventSink` half has a *documented, reasoned* reversal
  (DES-243's `tests:` line + IMPL-358's note: `eventSink` is composition-root constructed, not a
  `FileConfig` key, so the sweep is the wrong instrument). That reversal is defensible. The
  `attempts` half has **no** reversal anywhere, and VAL-251 asserts evidence that is not on disk.
- **Fix:** either add the ~3-line `gatewayAttempts` probe row and re-run, or amend ARCH-159/ARCH-171
  to record the DES-243 substitution and say why the composition-root IT replaces the sweep for both
  values — and in **either** case reword VAL-251 so it stops crediting K8 to a pre-v36 fixture row.

## F3 — INV-V36-5 ("a delete never silently reroutes a live run") is enforced only on the new version-scoped path
- **Violated:** INV-V36-5 (`02-architecture.md:5108`)
- **Severity:** MEDIUM — **lens: security** (correctness of a stated cross-component invariant)
- **Evidence:**
  - enforced: `src/mcp-facade.ts:408-418` — the `VERSION_PINNED_BY_RUN` probe, version branch only.
  - not enforced: `src/mcp-facade.ts:447` — the whole-name branch calls
    `catalog.deregister(a.name, actorFor(...))` with **no** pinned-run probe at all.
  - the reroute it permits: `src/run-manager.ts:1075-1083` — on resume, `VERSION_NOT_FOUND` →
    re-resolve through `release` → `recordLegacySubstitution` → the run **continues on different
    code**. `workflow_deregister({name})` on a name with a live run still walks straight into it.
- **The architecture contradicts itself here**, and that is the report: INV-V36-5 is written as a
  property of 「no catalog mutation」, while ARCH-155's note (`:4782`) deliberately leaves the
  whole-name path untouched to honour REQ-211's 「既有行為與其錯誤碼不變」 clause, and says the
  loud-failure alternative 「is filed, not built」.
- **Fix:** narrow INV-V36-5 to the path it actually covers (「no **version-scoped** catalog mutation
  …; the whole-name path retains the v21 substitution fallback, filed for v37」), or extend the probe
  to the whole-name branch. Karpathy tie-break: narrow the invariant — extending the gate is a
  REQ-098/099 behaviour change this slice deliberately declined.

## F4 — ARCH-164's `RWE_START_CMD` test seam does not exist, and ARCH-164's own `: >` truncation contradicts ADR-076
- **Violated:** ARCH-164 (`:4863`, api line: 「Test seam, ~3 lines: `start_cmd` is overridable via
  `RWE_START_CMD`」), echoed at `02-architecture.md:4778` (flags section) and `:5097` (interface
  table); ADR-078 (`:4990`)
- **Severity:** LOW — **lens: testability vs security, and they disagree**
- **Evidence:**
  - `deploy.sh:80` — `start_cmd=(node node_modules/tsx/dist/cli.mjs src/main.ts)`, hard-coded. `grep -rn RWE_START_CMD` over the repo hits only `.sdlc` prose and the panel documents; no shell file references it.
  - `tests/integration/deploy-control-files.test.ts:38-42` — IT-293 exercises `--dry-run` only.
  - `deploy.sh:32-33` — `(umask 077; touch "$RWE_LOG_FILE")` then `chmod 600 "$RWE_LOG_FILE"`, i.e. **append/touch**, where ARCH-164's api line specifies `: > "$RWE_LOG_FILE"` (truncate).
- **Reading:** the seam half is a genuine shortfall — ARCH-164's whole justification is that
  「catching it for real means booting two engines」 and v34's Gate 7.5 shipped a DEPLOY.md workaround
  because it could not. With only `--dry-run`, the regression test proves **path derivation** and
  never the half that was actually broken (the start path that writes the pid file and redirects the
  log). The truncation half is the opposite: ARCH-164's `: >` contradicts ADR-076/078, which make
  this log the engine's only audit record; `deploy.sh:29-31`'s comment states that reason and the
  implementer chose correctly. Security also prefers no `RWE_START_CMD`: an env var naming the
  command a deploy script executes is a new surface for a one-shell-assertion gain.
- **Fix:** amend ARCH-164 on both points (drop `RWE_START_CMD`, record `touch`+append and why), and
  — if the two-instance start path is to be proven — do it with the `--dry-run` path plus an
  assertion on the script text, not a new env var. Do **not** add the seam to satisfy the doc.

## F5 — five Gate-2 API rows describe shapes the implementation does not have (Gate 2 never amended for DES-243/244/245/248)
- **Violated:** ARCH-157 (`:4800`), ARCH-158 (`:4809`), the v36 amendment at `:687`/`:693`, ARCH-159 (`:4818`), ARCH-160 (`:4827`), ARCH-161 (`:4836`), ARCH-165/166 (`:4872`/`:4881`)
- **Severity:** LOW — **lens: testability/reviewability** (each individual delta is an improvement)
- **Evidence, one line each:**

  | ARCH says | code does | file:line |
  |---|---|---|
  | `Actor { id; kind: PrincipalKind; bypass; idSource }` — **4 fields** (ARCH-157 api; ARCH-158 mints `kind:'admin'`/`'auth-disabled'`/`'user'`; `:687` says 「4-field `Actor`」) | 3 fields, no `kind` | `src/workflow-catalog.ts:157` |
  | `canMutate` = `owner === null \|\| …` (ARCH-157 api, repeated at `:693`) | `!owner \|\| …` (truthy form) | `src/workflow-catalog.ts:159-161` |
  | `EventSink = (event: Record<string, unknown>) => void` (ARCH-159 api) | closed `EngineEvent` union | `src/event-log.ts:8-15` |
  | audit fields flat: `{principal: actor.id, bypass, idSource}`, publish carries `toVersion` (ARCH-157/161 api) | nested `actor: AuditActor`, field named `version` | `src/workflow-catalog.ts:677,782,901` |
  | `version: entry.scriptVersion` (numeric, ARCH-160 api) | `` version: `v${entry.scriptVersion}` `` | `src/run-manager.ts:1199` |
  | `refusalRef` a **sibling** of `error` on `ScriptResult`, read as `result.refusalRef` (ARCH-165/166 api) | nested **inside** `ScriptResult.error`; `child-entry.ts` hoists a copy to a wire sibling | `src/sandbox/guards.ts:66,338-345`; `src/sandbox/child-entry.ts:154` |

- **Karpathy tie-break favours the code in every row**, and four of the six have an explicit
  downstream ruling: DES-244 states 「**No `kind` field** — nothing reads it」 and defends `!owner`
  (`04-design.md:8944`); DES-243 defends the closed union and `run.terminal`'s `principal`-not-actor
  choice (`:8918`). The violation is that **Gate 2 was not amended in place**, which this ledger's
  own living-document rule requires, so ARCH-157/158's api lines now describe an interface that does
  not compile.
- **The one candidate security consequence was chased and does NOT hold — amend the arch, do not
  add the field.** The worry: without `kind`, could two different bypass doors write an identical
  audit line? Checked: all three mutating tools carry `authz: {minRole:'author', …}`
  (`src/tool-specs.ts:278, 305, 334`), and `authorize()` refuses a `loopback-exempt` principal for
  any row that is not `minRole:'user' + ownership:'none'` (`src/authz.ts:111-113`) — so
  `loopback-exempt` can never reach a catalog audit line. The only bypass-capable kinds that do are
  `admin` (`id:<email>`, `idSource:'authenticated'`) and `auth-disabled` (`id:null|claimed`,
  `idSource:'none'|'claimed'`), which `idSource` already tells apart. DES-244's 「nothing reads it」
  is therefore **correct in production**, and REQ-114's 「無痕跡的權限不可審查」 is satisfied by
  `idSource` alone. This strengthens the Karpathy verdict: ARCH-157/158 should be amended to the
  3-field shape, and the field should not be added back.
- **Verified harmless:** the nested `refusalRef` does not leak into a persisted record — `toErr`
  (`src/errors.ts:261-267`) copies only `code`/`message`, so `run-manager.ts:1328`'s
  `captureFailure(outcome.error, …)` drops it. `evaluateScript` has exactly one caller
  (`child-entry.ts:147`), so no other consumer sees the nesting.

## F6 — the new pinned-run probe runs before the ownership gate, inverting the refusal order ARCH-155 chose deliberately
- **Violated:** ARCH-155's refusal-ordering rationale (`:4782`, and its code comment 「1 (first):
  ownership — so a stranger cannot enumerate versions by refusal type」); DES-246's 「six outcomes in
  one pinned order」
- **Severity:** LOW — **lens: security** (narrow reachability; see below)
- **Evidence:**
  - `src/mcp-facade.ts:410-418` — `listRuns()` probe + `VERSION_PINNED_BY_RUN: run <runId> pins version 'vN' of '<name>'` returned **before** any actor is minted.
  - `src/mcp-facade.ts:419` — `actorFor(...)` is minted only afterwards.
  - `src/workflow-catalog.ts:750-755` — the catalog puts `canMutate` first, with the comment above explaining exactly why.
- **Reachability, checked rather than assumed:** `authorize()` (`src/authz.ts:101-170`) refuses an
  authenticated non-owner before the facade — `workflow_deregister` carries
  `authz: {minRole:'author', ownership:'workflow'}` (`src/tool-specs.ts:305`) — so the ordinary
  authenticated case is **not** exposed. The reachable case is `kind:'auth-disabled'`
  (`authz.ts:107` returns `{ok:true}` immediately) **with** an `args.principal` that does not match
  the row's owner: v24 restored real ownership enforcement for exactly that caller
  (`bypassWithArg`, `mcp-facade.ts:236-240` → `bypass:false`), and this probe now answers
  「a live run `<runId>` pins version X」 across that boundary before the ownership refusal fires.
- **Fix:** one line — mint `actorFor(principal, a, 'bypass')` once above the probe and either
  `canMutate`-gate the probe or move the probe after `deregisterVersion`'s ownership check. Cheap
  enough that Karpathy does not object.

## F7 — ARCH-162's cost rationale contradicts ARCH-172/ADR-079's own finding about the same table
- **Violated:** ARCH-162's note (`:4854`, 「this is an index-ordered scan returning **one row per
  workflow**, one round trip」) against ARCH-172 (`:4935`) and ADR-079 (`:4996`)
- **Severity:** LOW — **lens: scalability** (no code defect; the trade is owner-pending)
- **Evidence:**
  - `src/store/sqlite-run-store.ts:398-403` — `SELECT name, MAX(createdAt) … FROM runs WHERE name IS NOT NULL GROUP BY name`
  - `src/mcp-facade.ts:634` — one call per `workflow_list` request (correct per ARCH-163 — **not** N+1; verified).
  - `02-architecture.md:4935` (ARCH-172) — 「run rows are **never deleted** (no `DELETE FROM runs` anywhere), so the table grows monotonically while `listSummaries()` … full-scans it per request」.
- **Reading:** 「one row per workflow」 is the *result* cardinality, not the scan cost. SQLite has no
  per-group index skip-scan for `MAX()`, so the grouped query reads **every row of the
  `runs(name,status,createdAt)` index** on every `workflow_list` call — O(all runs), on the table
  ARCH-172 has just finished proving never shrinks. ARCH-163 justifies choosing SQL here precisely
  because the listing path 「is exactly the cliff ADR-079 refuses to make worse」 — and then v36 adds
  a second per-request whole-index scan to that same cliff.
- **Not a code change request:** the design's comparison was against N+1 and against a denormalized
  column, and against both of those the grouped query is right. **Fix:** correct ARCH-162's cost
  sentence to say what it is (a full index scan whose cost tracks total run count, acceptable at
  today's volumes) and fold it into the live `owner_decision` already parked at
  `02-architecture.md:4942` — that marker asks the pagination question for `/api/runs` and
  `/api/home`, and `lastRunAtByName()` now belongs on the same list.

---

## Confirmed consistent (checked, no finding)
- **INV-V36-1 / INV-V36-2 — the `refusalRef` seam.** The ref is read from the module-scope `WeakMap`,
  never off the error (`src/sandbox/guards.ts:338`, with `:181` module scope outside the vm context
  built at `:315+`); `child-entry.ts:86` marks before `p.reject`, so the ref rides object identity
  through a script's catch/rethrow; `host.ts:180` relays a `typeof === 'number'`-checked integer and
  validates nothing (ARCH-167 as written); `run-manager.ts:1327-1328` honours a ref **only** when
  this run's own ledger contains it and falls through unchanged otherwise. Bound of 8 +
  `refusalsDropped`, no eviction (`:1571-1576`), and `RECORDED_REFUSAL_CODES` (`:216`) is pinned
  equal to `guards.ts:175`'s inlined set by UT-304's drift test — the forced duplicate is justified
  on the record by the child's `.js`→`.ts` value-import limitation.
- **INV-V36-3, R-1 — per-call-site actor mint.** `actorFor(p, a, gate)` (`mcp-facade.ts:254-260`)
  with `'attribution'` on register (`:370`) and `'bypass'` on deregister/publish (`:419,:447,:494`),
  so an admin registering over another owner's name is still refused. `id` is always the attribution
  answer, `bypass ≡ (gate value === null)` — behaviour-preserving as DES-244 claims. `idSource`
  attests a caller-supplied id as `'claimed'` (`:250-252`).
- **ARCH-161 — the audit line is written where the write commits**, inside the catalog transaction's
  method (`workflow-catalog.ts:677, 782, 901`), and the bare `` console.log(`catalog.publish: …`) ``
  is gone (`:899` comment marks the deletion).
- **ARCH-171 — one `attempts` formula on the port.** `attemptsFor` exported at
  `src/gateway/client.ts:182`; both conformers call it (`client.ts:523`,
  `claude-agent-sdk-client.ts:507`), and the previously deviant untimed-retry branch is gone.
- **ARCH-172 / ADR-079 — `listRuns()` stays unbounded** and the ruling is in the port contract
  (`src/run-store.ts` doc comment); the delete probe uses it deliberately (ARCH-156).
- **ARCH-169/170 — `captureFailure` ordering.** `capErrorEnvelope(redact(toErr(err), secrets), maxBytes)`
  (`src/errors.ts`), redact-then-bound per INV-V26-5, with the bound as a parameter so the 200-char
  `failDetail` site and the 4096-byte envelope site cannot be unified into each other's bound.
- **ARCH-155 — the transaction is exactly two DELETEs** (`workflow-catalog.ts:774-780`), `assets`
  and the `workflows` row untouched, `claimedTriggers` computed inside the same transaction.
- **ARCH-155's late-write guard IS re-keyed.** `putDiagramResult`'s existence check reads
  `SELECT 1 FROM workflow_versions WHERE name = ? AND version = ?`
  (`src/workflow-catalog.ts:460-461`), inside the same `.immediate()` transaction as the upsert — so
  the `enqueue → deregisterVersion commits → putDiagramResult lands` race ARCH-155 calls 「not
  optional housekeeping」 cannot write an orphan row for a deleted version. ARCH-155's other doc
  clause holds too: both `VERSION_CEILING_EXCEEDED` message copies
  (`workflow-catalog.ts:610, 656`) and its `ERROR_CATALOG` hint (`src/errors.ts:95`) now name the
  exact call shape `workflow_deregister({name, version})`.
- **ADR-078's disclosure landed.** `DEPLOY.md:97-100` carries both required sentences — the log is
  the deployment's only audit record and is PII-bearing (`catalog.register`/`catalog.publish` carry
  the caller's email), 0600, append-never-truncate; and the engine does **not** rotate it, so point
  your own `logrotate`/supervisor at it.
- **ARCH-158's `idSource` fallback** (`actorFromPrincipal`, `workflow-catalog.ts:173-176`) maps a
  legacy string to `'authenticated'`, but it is unreachable from the production facade path — the
  code comment says so and I confirmed all three facade call sites mint via `actorFor`.

## Notes (design choices, deliberately taken — recorded so the next reviewer does not re-litigate)
1. **The unredacting default sink.** `deps.eventSink ?? createEventSink({})`
   (`run-manager.ts:388`, `workflow-catalog.ts:226`) means an unwired composition root logs
   **unredacted**. ARCH-159 took this knowingly for the 53+27 construction sites, and it is exactly
   what made IMPL-358 silent rather than loud. Security's preference (a default that writes nothing,
   or throws in production) loses to testability here on a stated trade — but it is the reason F2
   matters more than its "test-only" label suggests.
2. **`--dry-run` has a side effect.** `deploy.sh:32-33` creates and `chmod 600`s the log file
   **before** the `--dry-run` branch at `:35`, so a dry run writes a file into the config's
   directory. Harmless and arguably wanted (IT-293 asserts the 0600 mode), but ARCH-164 says
   `--dry-run` 「prints the two resolved paths and exits」.
3. **Ledger gap, not an architecture violation:** no IMPL row documents TASK-241's original
   `src/event-log.ts` landing or TASK-244's original `deregisterVersion` landing — IMPL-358/359 are
   both *send-back repairs* that trace those tasks. TASK-245 is correctly still `draft` pending the
   IT-297 fixture fix (IMPL-364).
