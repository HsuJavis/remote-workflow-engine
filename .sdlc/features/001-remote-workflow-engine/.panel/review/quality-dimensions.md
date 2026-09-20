# Quality-dimensions review — Gate 2 architecture vs. implementation (v34 iteration)

**Scope.** v34 iteration only: ARCH-136..140 / ADR-061..064 (02-architecture.md) against
IMPL-339/340/341 (TASK-228/229/230, 06-impl-log.md) and exactly the files those IMPLs' `files:`
lists name, plus module-boundary references (`harness-defaults.ts` from `resolve.ts`,
`tests/fixtures/dashboard-wire.ts` from the dashboard tests). No full-tree scan performed.

Files read: `src/workflow-view.ts`, `src/params/contract.ts`, `src/params/resolve.ts`,
`src/agent-executor.ts`, `src/types.ts`, `src/run-manager.ts`, `src/server.ts`, `src/main.ts`,
`src/workflow-meta.ts`, `src/workflow-catalog.ts`, `src/gateway/claude-agent-sdk-client.ts`,
`src/dashboard/lib/agent.js`, `src/dashboard/ui/agent-panel.js`, `src/tool-specs.ts`,
`src/authoring-guide.ts`, `docs/AUTHORING.md`, `src/harness-defaults.ts`,
`tests/unit/workflow-describe-projection.test.ts`, `tests/unit/params-contract.test.ts`,
`tests/unit/tool-specs.test.ts`, `tests/unit/authoring-guide.test.ts`,
`tests/unit/compose-config-v2-wiring.test.ts`, `tests/integration/resume-legacy-params.test.ts`,
`tests/fixtures/dashboard-wire.ts`.

Lens covers all four dimensions below; a skipped dimension would itself be a defect, so each gets
its own headed section even where the iteration's touched surface gave it little to say.

---

## 1. Observability

**ARCH/INV checked:** ARCH-136 (`unit`/`ceiling` disclosure), ARCH-138 (`detail.violation` as a
field), ADR-062 ("both are coded"), ADR-063 (dispatch-time refusal recorded via `_sink.capture`),
INV-V34-3 (removal is forward-only / totality over legacy rows).

**Consistent:**
- `workflow-view.ts:145-165` (`projectAgentParams`) emits `unit:'bytes'` gated to `appendPrompt`
  only and `ceiling` generically for any key carrying `ceilingKey` — file:line matches ARCH-136's
  `api:` clause exactly; `tests/unit/workflow-describe-projection.test.ts:148-` (UT-268) pins it.
- `params/contract.ts:559-565` mirrors the same `ceiling` word on the `appendPrompt`
  `PARAM_OUT_OF_RANGE` rejection, closing the asymmetry ARCH-136's note calls out; UT-269
  (`tests/unit/params-contract.test.ts:883-`) pins message/detail together.
- `workflow-catalog.ts:490` adds `violation: v.code` to every `SCAN_VIOLATION` throw (all seven
  arms), matching ARCH-138's registration-time promise.
- `agent-executor.ts:528-548` records the ADR-063 dispatch-time `agentType` refusal via
  `_sink.capture` *before* throwing, so it is visible through `workflow_status`'s per-agent
  `detail` string — verified by IT-176 (`tests/integration/resume-legacy-params.test.ts:151-193`).
- Legacy-row totality (INV-V34-3): `types.ts:529`'s `provenance` union still admits `'agentType'`/
  `'call'` for pre-v24 rows; `tests/fixtures/dashboard-wire.ts:28-41`'s `HARNESS_LEGACY_PRE_V34`
  fixture is deliberately kept carrying `systemPrompt` and is fed through the real projection
  (IT-175/IT-282) with no crash, dashboard line simply absent.

**Deviation found (LOW, disclosed).** ARCH-138's `deps`/rationale and the dispatch-time comment at
`agent-executor.ts:535-536` ("the marker is the SAME `detail.violation` … so a client writes one
branch for both halves") claim parity between the registration-time and dispatch-time refusals.
In fact only the registration path (`workflow-catalog.ts:490`, via the MCP facade's own error
envelope) surfaces `detail.violation` as a structured field; at dispatch, `run-manager.ts`'s
`toErr()` (`:150-159`) keeps only `{code, message}` off the caught error and drops `.detail`
entirely, so `AGENT_OPT_RETIRED` reaches `mgr.status()`'s run-level `error` only inside a message
*string*, not as the field ARCH-138 describes. **This is not a hidden gap** — 06-impl-log.md:8709
(IMPL-340's `commit:` line) and 03-tasks.md's TASK-229 DoD item (4) both record the correction in
place ("Deliberately not fixed here … ROUTED TO v35"), and `tests/integration/
resume-legacy-params.test.ts:138-147` asserts against the string deliberately, not the object.
Recorded here because the lens is Observability and the code comment at `agent-executor.ts:535-
536` still overclaims parity it does not (yet) deliver — a future reader of that comment alone,
without the impl-log cross-reference, would believe the field-level parity already shipped.
**Disposition: tracked, routed to v35 (failed-run error observability) per TASK-229 DoD (4).**

---

## 2. Replaceability

**ARCH/INV checked:** ARCH-140 ("STAYS a named seam"), ADR-061 (delete-whole vs. tombstone),
INV-V34-1 (no invisible determinants — restrictive OR readable).

**Consistent:**
- `composePrompt` (`params/resolve.ts:177-181`) is kept as an exported, independently unit-tested
  seam rather than inlined into the executor, exactly per ARCH-140's "keep the seam" decision —
  the `USER_INSTRUCTIONS_OPEN`/`_CLOSE` constants it owns stay unit-testable without booting a
  gateway.
- `DEFAULTS_RETIRED` (`params/contract.ts:216`) is kept live with its producing pipeline (`meta.
  defaults`/`meta.params.knobs`) gone — a refusal that outlives its own feature, per ARCH-140's
  note (2).
- The node-local determinant this iteration removes (`agentDefinitionsDir`, a boot-time
  `readdirSync` + registry lookup with no cross-instance sync) is deleted rather than patched with
  a distribution mechanism, which is the scalability/replaceability property ARCH-137's "Process /
  deployment" paragraph claims — confirmed by `server.ts`/`main.ts` grep showing zero remaining
  `loadAgentDefinitions`/`agentDefinitionsDir` call sites (only the retirement-message map at
  `main.ts:105`).
- `authoring-guide.ts`'s "Providers and the model catalog" section (post-existing, unmodified by
  v34 but load-bearing for this dimension) still states the alias-table indirection that makes a
  model/provider swap a config change, not a rewrite — v34 does not touch or regress this.

**No violation found** in this iteration's scope for this dimension.

---

## 3. Consumability

**ARCH/INV checked:** ARCH-136/138 (wire vocabulary), ARCH-140 note (2), ADR-064 (`defaults.tools`
— "REQ-203's advertised 「two layers」 is false while it lives" + owner ruling (A) + Gate-5
constraint 9's required test), the v34 interface & API contracts table.

**Consistent:**
- `tool-specs.ts:453-461` and `docs/AUTHORING.md:64` ("Prompt layering") advertise the three
  `appendPrompt` rules and the two-segment truth exactly as the interface-contracts table
  specifies; no stale `agentType`/`systemPrompt` sentence remains in either (`grep -n
  "agentType|systemPrompt" docs/AUTHORING.md` → zero hits).
- `authoring-guide.ts:530-536` states the tool surface is exactly two layers, scoped explicitly to
  the SDK-gateway path and explicitly excluding `surfaceType:'none'` (direct-fetch), matching
  ARCH-140/TASK-230's DoD item (4).
- ADR-064's owner ruling (A) — retire `RunParams.tools` alongside `.prompt` — is implemented:
  `resolve.ts` no longer populates `.tools`/`.prompt` on `RunParams`, and `run-manager.ts:1030-
  1042` refuses resume (`LEGACY_REREGISTER`) on a stored snapshot carrying either key, confirmed by
  `tests/integration/resume-legacy-params.test.ts:97-119` (IT-177).

**Deviation found (MEDIUM, undisclosed).** ADR-064's note and 02-architecture.md's Gate 5
constraint 9 both require **two** things for this decision's test coverage, not one:
> "`tests/integration/resume-legacy-params.test.ts` **plus** a `workflow_describe`-side assertion,
> so the advertised layer count is checked against a legacy row's ACTUAL resolved layers — **not
> only against a new registration**."

Only the first half landed. IT-177 (`resume-legacy-params.test.ts:97-119`) proves a legacy `tools`
key is refused on **resume** — but no test asserts, via `workflow_describe`/
`projectWorkflowDescribe`, that the advertised "exactly two layers" claim in `authoring-guide.ts`
and `docs/AUTHORING.md` holds when read *through the describe surface* against a workflow whose
stored contract/params still carries the legacy shape. Checked:
- `grep -n "describe-side|constraint 9|workflow_describe.*legacy" 05-tests.md 06-impl-log.md
  journal.md` → zero hits: the omission is not dispositioned anywhere in the ledger.
- 05-tests.md's own exit-gate self-check (`:13951`, "Each key DES has a UT; each REQ has a VAL")
  maps `DES-228 → UT-272/IT-177` only — no third id for the describe-side half.
- The only "legacy" cases in `tests/unit/workflow-describe-projection.test.ts` (lines 93-103,
  138-139, 195-211) are pre-existing v24 material about `LEGACY_NO_DIAGRAM`/`LEGACY_REREGISTER`
  *runnability*, not a v34-era assertion about resolved tool-layer count.
- By contrast, the toErr()/`.detail` gap in §1 above **is** explicitly dispositioned in the same
  ledger (TASK-229 DoD item (4), corrected in place, routed to v35) — this one has no equivalent
  disposition anywhere.

Net effect: the advertised sentence ("the tool surface is exactly two layers … true for **all**
runs, including legacy snapshots") is exercised at the *resume* boundary but not at the *read*
boundary the architecture specifically flagged as the other place a cold client encounters this
claim (`workflow_describe`). Given ADR-064's own framing — "shipping a guide sentence the code
contradicts is the defect class v34 exists to remove" — the code plausibly satisfies the sentence
(no live path can populate a describe response with three layers post-cut), but the test the
architecture required to *prove* that for a legacy row specifically was not written, and nothing
records this as a conscious downgrade.

---

## 4. Self-sustainability

**ARCH/INV checked:** ARCH-139 ("REPLACES a special case instead of adding one" — warn-not-fail),
ADR-063 (fail-closed preserved through a deletion), INV-V34-3 (readers stay total).

**Consistent:**
- `main.ts:100-104` (`RETIRED_CONFIG_KEYS`) carries both `graphAnalyzer` and `agentDefinitionsDir`,
  replacing the old hardcoded single-key `if`, exactly as ARCH-139 specifies; `composeConfig` still
  boots on an unrecognized/retired key (owner ruling: no fail-fast) — a graceful-degradation
  property, confirmed live by `tests/unit/compose-config-v2-wiring.test.ts:247-265` (one
  `console.warn` naming all three of `graphAnalyzer`/`agentDefinitionsDir`/a typo, engine boots).
  `agentDefinitionsDir` is confirmed absent from `KNOWN_FILE_CONFIG_KEYS` (only the retirement
  message and a comment reference it in `main.ts`), satisfying Gate-5 constraint 5.
- ADR-063's fail-closed property is preserved through the deletion, not dropped with it:
  `agent-executor.ts:537-547` throws structurally on `Object.hasOwn(req.opts, 'agentType')` at the
  same site the old `Unknown agentType` throw stood, so a stale pre-v34 pinned script still fails
  loudly rather than silently degrading — `run-manager.ts:1039` extends the same self-protective
  posture to resume (`LEGACY_REREGISTER` on a legacy `tools`/`prompt` key), a capability-expansion
  refusal rather than a silent widen.
- INV-V34-2's one enforced property survives and is unchanged: `FRAME_CLOSE_FORGERY`
  (`params/contract.ts:142`) is still the sole structural check on the untrusted-instructions
  frame, exercised at both the declared-default path (`:338`) and the override path (`:540`).
- Constraint 7's own acceptance check (`grep -rn agentType src/ docs/`) returns only intentional
  historical references after the cut: the retirement-message maps (`main.ts:105`,
  `workflow-meta.ts:217-236`), the legacy `provenance` union (`types.ts:529`), the ADR-063 refusal
  branch and its surrounding comments (`agent-executor.ts:528-639`), and comment-only narration in
  `resolve.ts`/`authoring-guide.ts`/`tool-specs.ts` — no stray unintentional reference found.

**No violation found** in this iteration's scope for this dimension.

---

## Findings summary (ranked)

| # | Severity | Dimension | ARCH/ADR | Evidence (file:line) | Disposition |
|---|---|---|---|---|---|
| 1 | MEDIUM | Consumability | ADR-064 + Gate-5 constraint 9 | `06-impl-log.md:8703-8720` (IMPL-340 greens), `05-tests.md:13951`, missing counterpart to `tests/integration/resume-legacy-params.test.ts:97-119` | **Undisclosed** — the `workflow_describe`-side assertion ADR-064 required "beside" the resume test was not written and is not recorded anywhere as descoped |
| 2 | LOW | Observability | ARCH-138 / ADR-062 | `agent-executor.ts:535-547` vs. `run-manager.ts:150-159` | Disclosed and tracked — TASK-229 DoD (4) corrected in place, routed to v35 |

ARCHCHECK: lens=quality-dimensions, file=/home/user/Documents/remote-workflow/.sdlc/features/001-remote-workflow-engine/.panel/review/quality-dimensions.md, consistent=no, violations=2
