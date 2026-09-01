---
stage: review
status: send-back
---
# 07 Review & Retro — Gate 8

## v21 GATE 8 RE-REVIEW #6 (2026-09-01, CURRENT / AUTHORITATIVE — SEND BACK to tests+impl)

> **Sixth Gate 8 pass — after the §S7 send-back was closed end to end** (Gate 5 RED `976249c`,
> Gate 6 closeout #6 `2e58d86` + doc closeout `9eae708` + adjudication #9 `c0e6cec`, Gate 6.5+7
> working-tree dedup + coverage cases, Gate 7.5 ROUND 4 against a fresh `deploy.sh` boot at
> `g9eae708`). Both architecture experts were re-dispatched on the post-closeout tree
> (`.panel/review/adversarial.md` pass 6, `quality-dimensions.md` — both dated this pass;
> consolidated only, none re-spawned, per dispatch). **Every §S7 item is genuinely closed or
> honestly decided at HEAD** — verified independently in source by this reviewer (§T1), including
> the measurement-retired F1 half 2 (pinned by 3 IT-081 cases, not merely argued).
> **Verdict: still NOT closeable — `send_back: ["tests","impl"]`, `arch_consistent: false`.**
> §S5's terminating rule applied honestly: "pass 6 closes with recorded debt **unless a
> boundary-crossing finding remains**" — one remains. **P6-1**: `FRAME_CLOSE_FORGERY`
> (`contract.ts:75`) is case-sensitive and whitespace-intolerant, so `</USER-INSTRUCTIONS>`,
> `</User-Instructions>`, `</ user-instructions>` and `< /user-instructions>` all pass the caller
> (cross-principal) rung — the exact actor/rung/mechanism F2 was BLOCKED for in pass 5, one
> variant class over. Pass 5's evidentiary standard decides the call: F2 was blocked without
> demanding proof the LLM consumer honours an exact-match close; demanding that proof now for the
> case/space variants would be a stricter standard for the identical mechanism. And no
> model-behaviour speculation is even needed: the control's own shipped comment
> (`contract.ts:68-74`) claims the variant class "cannot slip a literal-string check", and four of
> six variants slip — the implementation fails its own documented goal. Closing over it would ship
> the asymmetry pass 7 would have to re-file ("blocked for exact-match, shipped
> case-insensitive"). Fix is ONE LINE (widen the one shared, already-imported constant). Everything
> else this pass found is non-blocking and rides or is recorded (§T5).
> **Terminating rule for pass 7 (tightened): P6-1 is the ONLY item this batch may block on. Every
> rider carries a verified-decision escape hatch. Pass 7 closes with recorded debt unless a NEW
> boundary-crossing finding introduced by this batch itself remains.**

### T1. §S7 closure verification (independent, on disk at `9eae708` + declared working tree)

| §S7 item | reviewer verification |
|---|---|
| F2 admission half | `contract.ts:344-356` — `FRAME_CLOSE_FORGERY.test(val)` before the size bounds, refusal not escaping, detail `{param, suppliedBytes}` only (DES-101 row 6) — read in source |
| F2 durable half | `run-manager.ts:~547` resume-side check via the **imported** constant (the Gate 6.5+7 dedup exported it from `contract.ts:75`; working-tree diff read line-by-line — quality-only, no behavior change) |
| F1 half 1 (predicate swap) | `harness-defaults.ts:89-93` now calls `contract.ts`'s exported `isKnownAlias` (empty-table skip + `openrouter/<id>` passthrough inherited); hand-rolled `aliasNames.has()` gone — read in source |
| F1 half 2 (gate reorder) | **Correctly RETIRED by measurement** (IMPL-146): production composition already refuses all 6 probe shapes; the reorder changed zero decisions and broke §S7's own origin-keyed-code constraint; pinned by 3 new IT-081 cases so it cannot be silently re-applied. The reviewer accepts the retirement — the counterfactual was measured, not argued, and the residual (ceilings-less catalog) is S-1 verbatim, explicitly on §S7's NOT-in-scope list |
| F4 | `contract.ts:183-185` rejects `min`/`max` on a `type:'enum'` spec, typed, nothing stored — read in source; Gate 7.5 ROUND 4 probed it live |
| F5 | Decided-and-recorded: collision documented at `issue-reporter.ts:169-177` + the `issue_list.workflow` tool description; fingerprint uses the raw name — per adversarial's closure table |
| Doc batch (F3, S-2, C-3) | F3: ARCH-066 residual + `04-design.md` rewritten to the wider true statement ("introduced by v21", parent-author rungs, child row never read), verified at the v20 tip; S-2: ADR-005 + inv-4 now state both rungs, asymmetry measured-then-declared-intended, boot-sweep v22 candidate; C-3: `server.ts:395-403` advertises all 7 defaults keys + ceiling refusal, drift-locked in `schema-drift-v15.test.ts`; the DES-098→DES-099 misattribution recorded rather than silently retargeted |
| §S7 ledger honesty | IMPL-145 (one commit = one entry for `2e58d86`, fifth race instance recorded) + IMPL-146 (measurement record); gap-set growth 11→14 disclosed, not smoothed |

### T2. Traceability consistency

`sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check`: **823 items / 14 gaps — the
exact set Gate 6 closeout #6 disclosed** (reviewer re-derived the list from trace.py's own
analyzer, not from the dashboard):

- 12 × 漂移 LOW: UT-058→DES-038, UT-064→DES-054, IT-057→DES-054, UT-094→DES-095, UT-095→DES-095,
  DES-094→IMPL-122, DES-088→IMPL-127, DES-088→IMPL-140, DES-066→IMPL-140, **DES-099→IMPL-145,
  DES-099→IMPL-146, DES-100→IMPL-146** (the last three are this round's declared false-positive
  pairs — v15 design items traced by v21 IMPL entries; `iter:` records origin, not last touch,
  same class as the DES-088/DES-066 pairs)
- 1 × 未實作 LOW: TASK-018 (pre-existing, recorded debt since v14)
- 1 × TDD MID: IMPL-082 no test coverage (pre-existing, recorded debt since v14)

0 高嚴重度, 0 未驗證, 0 未真實驗證, 0 orphan/broken-link. All 14 remain recorded known tech debt
(record renewed; the +3 growth was the honest choice over the two dishonest ways to hold 11).
Item delta since #5: 821→823 = IMPL-145/IMPL-146, exactly the closeout's ledger entries. Docs and
code at the same iteration for the v21 scope; no unrecorded drift beyond §T5's QD-CONS-3.

### T3. Dashboard QA + module boundaries

- Regenerated via `sh .sdlc/trace` — 823 items, dashboard.html rewritten. **Degraded modes,
  unchanged from #4/#5, recorded per contract:** (a) repo `trace.py` predates the `--tool`
  dispatcher → `dashboard_check`/`solid_check` run from the plugin cache (2.1.3 scripts); (b) no
  playwright browser tools in this session — lexical + structural checks only.
- `dashboard_check.py`: 0 high / 1 mid / 1 low — **both known and previously adjudicated**: the
  MID is the recorded checker false positive (mermaid `erDiagram` crow's-foot `||--o{`
  cardinality at `02-architecture.md:933` — re-confirmed by direct read this pass: all attribute
  `{…}` blocks balance; valid mermaid), the LOW is the missing offline fallback (repo trace.py
  older than plugin — housekeeping debt, unchanged). SoT links + all other mermaid blocks clean.
- `solid_check.py`: **PASS** — 7 modules, 0 high / 0 mid / 10 LOW 未認領檔案, byte-identical to
  the #4/#5 baseline (recorded arch-doc debt, not v21-caused).

### T4. Validation & handover

- **Real-tier: all green.** trace: 0 未驗證, 0 未真實驗證; `rtm.md` 95/95 REQs ✅ real:true
  (reviewer-grepped: 96 ✅ = 95 rows + legend, 1 ❌ = legend only).
- `08-validation.md` carries **ROUND 4** (post-`2e58d86`, boot version cross-checked `g9eae708`):
  REQ-090/091/092/094's behavior deltas (F2 admission refusal incl. the space-variant probe, F1
  alias-predicate swap both directions, F4 enum min/max rejection) re-proved live over MCP HTTP
  against a fresh `deploy.sh --background` one-command boot; REQ-093/095 stand on Round 1/2
  evidence per honest src-diff scoping (their paths untouched — reasoning verified sound). The F2
  durable half correctly cited to the real-SqliteRunStore IT rather than a live re-probe (the
  front door now refuses the shape; seeding is the only way in — VAL-100 precedent).
- **Reviewer's own re-runs this pass:** `npx tsc --noEmit` clean; full `npx vitest run` —
  **1565/1565 pass, 243 files, 2 pre-existing spawn-litellm-ENOENT background errors, 0 test
  failures** — identical to the Gate 6.5+7 / Gate 7.5 ROUND 4 stamps.
- README.md + DEPLOY.md: last touch `507aff7` (Gate 7.5); spot-re-read — current-state,
  history-free, 淺白繁中, ASCII diagram, §0 leads with `./deploy.sh --background`, the exact
  command ROUND 4 ran; 設定總表 §1b single-source, no new config keys this round. **One stale
  clause found** (QD-CONS-3's second surface): the `maxTimeoutMs` row's "不影響作者 `defaults`"
  has been false since G-1 — routed through the Gate 6 doc batch (one clause, not a broken
  command; H-4 precedent, same as S-2/C-3), NOT a Gate 7.5 send-back.
- **Checked, otherwise clean.**

### T4b. Special-file review

`git diff 0abba3a..HEAD --name-only` + working tree ∩ {CLAUDE.md, AGENTS.md, *SKILL.md} = **∅**
(this round touched 5 src files, 5 test files, ledger docs only). CLAUDE.md unchanged since the
#4 claude-md-improver audit (pass, 2 LOW) — verdict carried.

### T5. Architecture consistency (consolidated from the 2 pre-run expert reports)

**Sources:** `.panel/review/adversarial.md` (security+scalability+testability, pass 6, evidence
by *executed probes*, tree `9eae708`+WT) and `.panel/review/quality-dimensions.md`
(observability/replaceability/consumability/self-sustainability, scope verified against
`git diff 637b86e..HEAD --stat -- src/`). QM ⇒ no safety lenses, correct. The reports are
complementary: quality confirms every load-bearing v21 invariant it owns is implemented as
decided (2 LOW, both guard-rail/doc class, zero behavior deviations); adversarial verifies §S7's
closure row-by-row and files 2 MED / 3 LOW against the newly-landed control itself. This
reviewer independently re-verified every load-bearing anchor in source before accepting
(`contract.ts:75/183-185/265/343-356/422-430`, `run-manager.ts:409-437/~547`,
`harness-defaults.ts:75-93`, `server.ts:1144-1147`, `mcp-facade.ts:20`, `run-manager.ts:110`,
`02-architecture.md:967`, DEPLOY.md `maxTimeoutMs` row).

**Consolidated findings (deduplicated):**

| # | sev | finding (evidence, reviewer-verified) | route |
|---|---|---|---|
| **P6-1** | **MED — BLOCKING** | `FRAME_CLOSE_FORGERY = /<\/user-instructions/` (`contract.ts:75`): no `i` flag, no whitespace tolerance between `<`/`/`/name — `</USER-INSTRUCTIONS>`, `</User-Instructions>`, `</ user-instructions>`, `< /user-instructions>` all pass the **caller** rung. The control's own comment (`:68-74`) claims the variant class cannot slip; 4 of 6 variants slip. Same actor/rung/mechanism as pass-5's blocking F2 — cross-principal attribution forgery on ADR-007's structural control. Violates ADR-007(c)/ARCH-065 + the comment's own claim. | **BLOCKING → tests+impl.** Fix = widen the ONE shared constant to `/<\s*\/\s*user-instructions/i` — nothing else (both refusal sites inherit by import after the dedup). **Pattern must stay linear** (no nested quantifiers — a careless widening is how an A2 regression returns). NOT semantic screening — ADR-007's rejection of that stands; the honest residual (prose that *suggests* a boundary) is unreachable-by-construction and recorded, not pretended away. |
| P6-2 | MED | F2's control covers 1 of 3 origins of `appendPrompt`: caller override ✅ (`contract.ts:349`), author `defaults.appendPrompt` ❌ (`harness-defaults.ts:80-82` type-only; no frame check at registration), post-merge admission ❌ (`run-manager.ts:416-431` re-asserts `isKnownAlias` on `effectiveParams.model` per R-G2 but nothing on `.appendPrompt`) — while resume ✅ refuses the same bytes (`:~547`). So an author-origin delimiter is **dispatched with a forged frame on every normal run and refused only at resume** — start/resume disagree on identical bytes (ARCH-066 inv-2's two-door agreement; verbatim R-G2 one field over). IMPL-145 declared only the availability half. NOT boundary-crossing (author-scoped; author already owns the un-framed `defaults.prompt` rung; the one cross-principal edge sits inside the declared F3 residual). | **Rides** in the P6-1 batch: 3-line R-G2 mirror beside `run-manager.ts:424` over `effectiveParams.appendPrompt`, same imported constant, same typed code — also deletes the start/resume asymmetry. **Escape hatch:** a recorded verified decision (+ the IMPL-145 sentence amended to name the dispatch half, not only the resume half) closes it as debt. |
| P6-3 | LOW | Declared `args.<k>.default` is parsed, stored, served on `workflow_get` — and never applied to any run, never checked against its own spec (`validateDeclaredArgs` `contract.ts:422-430` `continue`s on absent key; catalog own-spec loop covers knobs only). Advertised≠enforced, 6th instance; silent `undefined` to the script. | Rides (F4's own precedent, same file): reject `default` on an args spec in `validateSpecShape`, typed, nothing stored. Escape hatch: verified decision + doc. |
| P6-4 | LOW | `type:'enum'` specs are string-only by construction (`contract.ts:265` `expectedType` ternary sends enum→'string' before membership runs): a registrable numeric enum (`enum:[1,2,3]`) admits **no value at all** — fail-closed brick, misleading error (`expectedType:"string"`). | Rides: reject non-string enum members in `validateSpecShape` (parse-time, F4 precedent). Escape hatch: verified decision + doc. |
| P6-5 | LOW | The fail-closed ceiling default triple exists at **three** independent literal sites, not the two S-1 records: `run-manager.ts:110`, `mcp-facade.ts:20`, and `server.ts:1144-1147` — the production composition root re-types the numbers, importing neither constant. Values identical today; a future change at the "natural" site leaves production on the old number with green tests. | Rides: export one `DEFAULT_CEILINGS` from `contract.ts` (net-negative), OR amend the S-1 residual to name three sites with `server.ts:1145` as the production one. |
| QD-REP-1 | LOW | The declared "unsafe to adopt" fence on `resolve.ts`'s `mapEffort` copy (`:154-164`, no `restPath`) has no structural pin — unlike the parallel ADR-006 fence (`gateway-effort.test.ts:198-213` zero-importer assertion). A future `src/` importer regresses P-A1 with nothing red. | Rides: one `it()` zero-importer pin mirroring the ADR-006 one (until the pre-authorized deletion lands with the next DES-102/DES-106 touch). |
| QD-CONS-3 | LOW | `02-architecture.md:967` (v21 interface table, the surface an integrating caller reads first) still says the three ceilings are "user-override ceilings only", and `DEPLOY.md`'s `maxTimeoutMs` row says "不影響作者 `defaults`" — both false since G-1 bounds registered defaults too. Verbatim the class S-2 warned about, surviving on two more surfaces. | Rides in the Gate 6 doc batch: one-line amendment to each (both rungs + ADR-005's per-call-opts exclusion). |

Also verified-not-refiled (declared residuals confirmed as declared, counted 0): R-1 `mapEffort`
twin (debt stands; QD-REP-1 is about its missing *fence*, filed once); S-1 ceilings-less catalog
(re-measured by IMPL-146, rationale stands); self-inflicted resume refusal (declared; the
dispatch half is P6-2); the wider internal `EffortApplied` shape (production never persists it —
noted so pass 7 does not re-open); `UNKNOWN_ALIAS` echoing alias names (not secrets); caller
`args` in the author-trusted segment (pre-v21, outside ADR-007's stated scope); registration
read-modify-write (pre-v21, out of scope). Adversarial's scalability sweep: no findings; the F2
check is linear-time, A2 class not re-introduced.

**arch_consistent = false.** Blocking violation: P6-1 (with P6-2..P6-5, QD-REP-1, QD-CONS-3
riding). Zero behavior-level deviations found by the quality lens; every §S7 closure verified.

### T6. Send-back scope pin (pass 7 terminating rule above; unpinned scope is how this hit 6 passes)

- **Gate 5 (tests) — RED first:**
  - P6-1: extend the existing forgery block in `params-contract.test.ts` with the 4 slipping
    variants (red pre-fix); one green pin on the resume side is enough (shared constant).
  - P6-2 (if the mirror is taken): red case constructing the author-origin path — register
    `defaults.appendPrompt` carrying the delimiter, `workflow_run` with NO overrides → refused at
    admission before durable work.
  - P6-3/P6-4 (if taken): red cases — `args` spec with `default` refused; non-string enum member
    refused (and the numeric-enum brick pinned as the motivating case).
  - QD-REP-1: one green zero-importer `it()` (no red needed — it pins current truth).
- **Gate 6 (impl) — GREEN + doc batch in the same pass (H-4 precedent):**
  - P6-1: widen the constant — one line, linear pattern, nothing else moves.
  - P6-2 mirror (3 lines) OR the recorded verified decision + IMPL-145 sentence amendment.
  - P6-3/P6-4 `validateSpecShape` rejections OR recorded verified decisions.
  - P6-5: shared `DEFAULT_CEILINGS` export OR corrected S-1 residual (3 sites, `server.ts:1145`
    named as production).
  - Doc batch: QD-CONS-3 (`02-architecture.md:967` + DEPLOY.md `maxTimeoutMs` row).
- **Standing flag for validation (via flag, NOT via send_back — #4/#5 convention):** this batch
  lands behavior-affecting `src/` after Gate 7.5 ROUND 4's evidence; ROUND 5 must re-confirm the
  touched REQ paths (REQ-091/094 at minimum — the forgery refusal is on their path) before pass 7
  closes.
- **NOT in scope:** anything in §T1's closure table; R-1/S-1 rationales; the 14 trace gaps;
  solid_check's 10 unclaimed files; trace.py version sync; state.yaml strict-YAML defect.

### T7. Retro (v21, sixth pass) + report

- **What went well:** the terminating discriminator worked — pass 6 produced 0 HIGH and exactly
  one blocking candidate, and the adversarial expert stated its uncertainty honestly instead of
  resolving it in its own favour; F1 half 2's retirement-by-measurement is the strongest closure
  evidence this iteration has produced; the gap-set growth was disclosed rather than smoothed.
- **To change:** (1) when a fix ships a *pattern* (regex/delimiter/marker), the RED tests must
  enumerate the variant class the rationale comment claims — the comment made a claim no test
  checked; (2) a control over a field must be asserted total over every *origin* of the field at
  the point the origins merge (R-G2 was this lesson for `model`; P6-2 is the same lesson for
  `appendPrompt` — one checklist line at the post-merge rung would have caught both); (3) the
  composition root should import shared defaults, never re-type them.
- **Known tech debt (all recorded):** the 14 trace gaps (12 drift LOW incl. 5 declared
  false-positive pairs, TASK-018 LOW, IMPL-082 MID); R-1 mapEffort twin (deletion instruction
  standing); S-1 ceilings residual (count to be corrected to 3 sites per P6-5's route); any
  P6-2..P6-4 rider closed by verified decision; solid_check's 10 unclaimed files; repo trace.py
  older than plugin (no `--tool`, no mermaid offline fallback); erDiagram checker false positive;
  state.yaml strict-YAML defect; pre-v21 registration read-modify-write wart.

```
Gaps: high=0 mid=3 (P6-1, P6-2 new; IMPL-082 pre-existing TDD)
      low=22 (P6-3, P6-4, P6-5, QD-REP-1, QD-CONS-3 new + R-1, S-1 carried + 13 trace-recorded
      + 1 dashboard-fallback + 1 checker-false-positive) — all remaining recorded
Drift: none unrecorded — 12 trace iter-drift LOW (5 declared false positives) + QD-CONS-3's two
       stale ceiling-scope surfaces (02-architecture.md:967, DEPLOY.md), routed to the doc batch
Architecture consistent: NO — P6-1 (frame-close variant class slips the caller rung — same
       boundary-crossing mechanism pass 5 blocked F2 for; BLOCKING, one-line fix) + P6-2 (control
       total over 1 of 3 origins, start/resume disagree; author-scoped, rides) + P6-3/4/5,
       QD-REP-1, QD-CONS-3 LOW riders
Validation: real-tier all-green? YES (95/95 real:true; ROUND 4 fresh one-command boot at
       g9eae708; reviewer re-ran the suite: 1565/1565, tsc clean) · README+DEPLOY present? YES
       (current-state, history-free, 繁中, 一鍵部署 verified-run; one stale clause routed to the
       doc batch)
Dashboard: renders per lexical checks; 1 recorded checker false positive; degraded modes noted
Module boundaries: solid_check PASS (0 high/0 mid/10 pre-existing LOW)
Conclusion: SEND BACK to Gate 5 (tests) + Gate 6 (impl) — scope pinned in T6, P6-1 the only
       blocking item, every rider carries an escape hatch. Validation re-confirms via the
       standing flag (ROUND 5). Pass 7 closes with recorded debt unless a NEW boundary-crossing
       finding introduced by this batch remains. .panel/ retained for the re-run.
```

## v21 GATE 8 RE-REVIEW #5 (2026-09-01, SUPERSEDED by RE-REVIEW #6 above — kept for history; was SEND BACK to tests+impl)

> **Fifth Gate 8 pass — after the §Q7 send-back was closed end to end** (Gate 5 re-run #4 commit
> `92667d7`, Gate 6 closeout #5 `43042d3`+`c5b3509`, the out-of-band leak fix `997626d` reconciled
> as IMPL-144, Gate 6.5+7 `631ccbb`, Gate 7.5 ROUND 3 `0abba3a`). Both architecture experts were
> re-dispatched on the post-closeout tree (`.panel/review/adversarial.md` pass 5,
> `quality-dimensions.md` — both dated this pass; consolidated only, none re-spawned, per dispatch).
> **Every §Q7 item is genuinely closed in code and doc** — A1 both halves, A2, A4, A5, A6, and the
> full 11-item doc batch were re-verified at HEAD `0abba3a` by both experts AND spot-verified
> independently by this reviewer (§S1). Gate 7.5 ROUND 3 re-proved the touched REQ paths at the
> real tier against a fresh one-command boot.
> **Verdict: still NOT closeable — `send_back: ["tests","impl"]`, `arch_consistent: false`.** The
> block is ONE MED finding, **F2** — v21's own `<user-instructions untrusted="true">` frame (ADR-007's
> entire structural mechanism) is forgeable by the very text it frames — plus **F1** riding in the
> same batch (safe-direction alias-predicate split + gate-ordering hole, net-negative-lines fix).
> The discriminator applied (and the terminating rule for pass 6): a finding blocks only if it lets
> an actor cross a boundary the architecture claims is enforced. F2 does (cross-principal
> attribution forgery on the one control ADR-007 relies on, in v21-new code); F1 does not on its own
> (divergence direction is safe, no escalation) and rides only because the gates re-run anyway.
> Everything else this pass found is doc-layer or recorded debt. **If pass 6 returns only
> non-boundary-crossing findings, the iteration closes with recorded debt.**

### S1. §Q7 closure verification (independent, on disk at `0abba3a`)

| §Q7 item | reviewer verification |
|---|---|
| A1 half 1 (parser shape guard) | `contract.ts:156-170` `validateSpecShape` (type∈literals / enum array / min/max numbers), called at `:207` (knobs) and `:232` (args) — read in source |
| A1 half 2 (read path total over poisoned row) | `boundEffort` `contract.ts:125-129` (`Array.isArray` guard → `ALL_EFFORTS` fallback), `boundMax` `:117-120` (non-number `max` → `Infinity`) — no TypeError path survives; H-1's "verify no deployed row" escape correctly declined in favour of totality |
| A2 (O(n) truncation) | `truncatedSupplied` `contract.ts:80-93` — single `Buffer.from` + `subarray(0,64)` + UTF-8 continuation back-off; the O(n²) loop is gone |
| A4 (string min/max byte-length semantics) | `contract.ts:269` byte-length branch for `type:'string'` (via quality's re-verification + adversarial's F4 delta read) |
| A5 (third ceiling advertised) | `server.ts:334` names `maxAppendPromptBytes` in the tool schema (reviewer grep hit); `boundMax` shared by timeoutMs and appendPrompt in `effectiveBounds` `contract.ts:138-141` — read in source |
| A6 (effortApplied honesty) | doc route chosen and recorded: ARCH-068/069 both define `applied:true` = "sent on the wire, not verified-honoured", mirrored (both experts verified) |
| Doc batch (A3, A7..A12, O-3, C-2, R-2) | quality's closure table verified each at its anchor (02-architecture/04-design/05-tests/06-impl-log); adversarial's "Checked and clean" concurs; spot-read of ARCH-064 inv (2) rewrite confirms |
| IMPL-144 / `997626d` (post-Round-2 leak fix) | reconciled in 06-impl-log (Gate 6.5+7); sanitized rejection at `contract.ts:360-367` read in source (`supplied`/`suppliedTruncated` deleted, `suppliedBytes` substituted, author `allowed` presets kept); Gate 7.5 ROUND 3 re-proved REQ-090/091 live |

### S2. Traceability consistency

`sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check`: **821 items / 11 gaps — the
identical set carried since IMPL-140** (extracted from the regenerated dashboard gap list):

- 9 × 漂移 LOW: UT-058→DES-038, UT-064→DES-054, IT-057→DES-054, UT-094→DES-095, UT-095→DES-095,
  DES-094→IMPL-122, DES-088→IMPL-127, DES-088→IMPL-140, DES-066→IMPL-140 (the last two are the
  declared false-positive pairs — `iter:` records origin, not last-touched)
- 1 × 未實作 LOW: TASK-018 (pre-existing, recorded debt since v14)
- 1 × TDD MID: IMPL-082 no test coverage (pre-existing, recorded debt since v14)

0 高嚴重度, 0 未驗證, 0 未真實驗證, 0 orphan/broken-link. All 11 remain recorded known tech debt
(record renewed). Item delta since #4: 818→821 = IMPL-142/143/144, exactly the ledger entries the
closeout and verifier passes added — **the A7 ledger-honesty gap from #4 is closed** (the
`secret-resolver.ts` change and the out-of-band `997626d` commit are both traced now). Docs and
code are at the same iteration for the v21 scope; no unrecorded drift found this pass.

### S3. Dashboard QA

- Regenerated via `sh .sdlc/trace` (repo copy) — 821 items scanned, dashboard.html rewritten.
  **Degraded modes, same as #4, recorded per contract:** (a) repo `trace.py` predates the `--tool`
  dispatcher → `dashboard_check`/`solid_check` run from the plugin cache
  (`iso-agile-sdlc/2.1.3/skills/iso-agile-sdlc/scripts/`); (b) no playwright browser tools in this
  session — lexical + structural checks only, no in-browser render/tab/SoT-click pass.
- `dashboard_check.py`: 0 high / 1 mid / 1 low — **both known and previously adjudicated**:
  - MID "02-architecture.md:931 括號不平衡" = the **recorded checker false positive** from #4
    (mermaid `erDiagram` crow's-foot `||--o{` cardinality; all attribute `{…}` blocks balance —
    re-confirmed by direct read of the block this pass). Not a defect; stays recorded so the next
    pass does not re-file it.
  - LOW: no mermaid offline fallback (repo trace.py older than plugin) — recorded housekeeping debt,
    unchanged.
- SoT links / all other mermaid blocks: clean per the checker.

### S4. Module-boundary check (SOLID)

`solid_check.py`: **PASS** — 7 modules, 0 mid; the same 10 pre-existing LOW 未認領檔案 warnings
(`harness-defaults.ts`, `self-update.ts`, `agent-semaphore.ts`, `mcp-probe.ts`, `net-guard.ts`,
`workflow-meta.ts`, `workspace-artifacts.ts`, `webhook-registry.ts`, `continuation-store.ts`,
`main.ts`) — recorded arch-doc debt, not v21-caused. #4's R-2 (undeclared gateway→executor dep) is
**closed**: ARCH-069 `deps:` now names ARCH-068 (verified by quality at `02-architecture.md:768`).

### S5. Architecture consistency (consolidated from the 2 pre-run expert reports)

**Sources:** `.panel/review/adversarial.md` (security+scalability+testability, pass 5, tree
`0abba3a`) and `.panel/review/quality-dimensions.md` (observability/replaceability/consumability/
self-sustainability, post-IMPL-142/143/144). QM ⇒ no safety lenses, correct.

**The reports are complementary this pass, not contradictory** (unlike #4): quality confirms every
code-level invariant of ARCH-064..070/ADR-001..008 holds at HEAD and files 4 LOW (2 carried debt,
2 new doc-layer); adversarial confirms the same anchors ("Checked and clean" table, 20+ rows) and
files 3 MED / 2 LOW on seams the A-batch never examined. This reviewer independently verified the
two load-bearing MEDs in source before accepting them (F1 both doors read directly; F2's three
evidence anchors read directly + `grep 'user-instructions'` = 3 hits, all constants/description).

**Consolidated findings (deduplicated):**

| # | sev | finding (evidence) | route |
|---|---|---|---|
| **F2** | **MED — BLOCKING** | The `<user-instructions untrusted="true">` frame is forgeable by its payload: `composePrompt` (`resolve.ts:146-148`) concatenates with no scan; `validateUserOverrides`' appendPrompt branch checks bytes only (`contract.ts:326-345`); the drift-lock (`params-resolve.test.ts:193-200`) pins the wrapping, not the invariant. A non-owner submitter's `appendPrompt` containing `</user-instructions>` closes the untrusted block and attributes trailing text to the author — cross-principal attribution forgery on ADR-007's chosen structural control; the accepted residual's "bounded **and attributed**" claim fails on the attribution half. Violates ADR-007(c)/ARCH-065. Reviewer-verified in source. **Durable half (reviewer-added, mirroring A1's pattern):** a run admitted pre-fix carries the forged text in its persisted `effectiveParams`; resume reads the pinned snapshot back with only the secret-marker refusal (`run-manager.ts:538-539`, `:633`) — it would re-dispatch the forgery. | **BLOCKING → tests+impl.** Fix = one rejection row (refusal at admission, **not** escaping — escaping breaks ARCH-066 inv-2 resume byte-identity and inv-4 "refuse, never silently alter"; adversarial argued this and it is pinned). Plus the durable half: resume-side delimiter check OR a recorded verified decision that no persisted run carries the delimiter (a live deployment exists). |
| F1 | MED | Two alias predicates + D-AUTH-5 gate not total over the stored column: `harness-defaults.ts:85-88` hand-rolls strict `aliasNames.has()` (no `openrouter/<id>` passthrough) vs `isKnownAlias` (`contract.ts:71-75`); and `validateHarnessDefaults` runs at `workflow-catalog.ts:119` BEFORE the normalization loop (`:139-158`) writes declared knob defaults into `effectiveDefaults` — the normalized half never passes it. One value, two doors, opposite answers (`defaults.model:'openrouter/…'` refused; same string as `params.knobs.model.default` accepted via `contract.ts:225-227` — both doors read by this reviewer). Direction is SAFE (permissive predicate matches dispatch; admission re-checks post-merge, `run-manager.ts:424`): no escalation — violates ARCH-064's "the ONE alias predicate" api claim, 4th instance of the credit-a-control-that-doesn't-run class. | Rides in the F2 batch (does not independently block): predicate swap (`isKnownAlias` in harness-defaults) + move the `validateHarnessDefaults` call after the normalization loop over `effectiveDefaults` — net-negative lines, **preserving the origin-keyed rejection codes** (`workflow-catalog.ts:175-180` convention). |
| F3 | MED | The nesting residual record is doubly wrong: `04-design.md:2711` says "inherited not introduced" and names only caller *overrides* — but pre-v21 `resolveHarnessParams` had zero callers, so parent-author `defaults.tools`/`prompt` governing a CHILD workflow's agents (`resolve.ts:43-58,124-125`; `run-manager.ts:782,852-855`; `agent-executor.ts:349-358` — child's own defaults/params columns never read) is **introduced by v21** and moves *author* rungs. Bounded today (tool allowlist; scripts are readable anyway); becomes live when v22/D15 masking lands. | Doc-only, folded into the impl re-run's doc batch: amend `04-design.md:2711` + the ARCH-066/ADR-002 residual line to the wider true statement; re-file the v22 candidate against it. No code (adversarial's own Karpathy ruling, adopted). |
| F4 | LOW | `min`/`max` on a `type:'enum'` spec are NaN-inert (`contract.ts:269` numeric branch; `validateSpecShape` accepts them) — advertised≠enforced, residual edge of A4. | Fold into the impl batch (same file, ~3 lines): reject `min`/`max` on enum specs in `validateSpecShape` (the cheaper option — an enum's membership IS its bound). |
| F5 | LOW | `workflowLabel` 50-char truncation (`issue-reporter.ts:169-170`) can collide two workflows in `issue_list` filtering (dedup fingerprint uses the raw name and is safe). | Fold into the impl batch: hash-suffix the truncated label or document the collision on the tool description — decide and record, don't leave unrouted. |
| C-3 | LOW | `workflow_register` tool schema advertises 5 defaults keys; engine accepts/applies 7 (`server.ts:395-402` vs `harness-defaults.ts:39,77-82`); G-1 ceiling refusal undocumented; no drift-lock pins the property list; DES-098 still declares the 5-key shape + deleted `resolveHarnessParams` (`04-design.md:2341,2352,2404`). The docs/behavior split class ARCH-067's own note forbids minting. | Fold into the impl doc batch: schema properties + description + drift-lock pin (`schema-drift-v15.test.ts`) + DES-098 amendment. |
| S-2 | LOW | ADR-005 (`02-architecture.md:809`) + ARCH-066 inv-4 (`:743`) still say ceilings bound "the USER override rung only" — false since G-1 applied them to registered defaults at registration time. An architect reading ADR-005 today re-opens G-1's hole at the next composition site. The lowered-ceiling-vs-stored-defaults asymmetry should be declared intended (or not) in the same paragraph. | Fold into the doc batch: one-paragraph amendment to ADR-005 + inv-4. |
| R-1 | LOW | Wrong `mapEffort` twin still ships (`resolve.ts:151-164`, no `restPath`; zero production callers; 5 UT cases pin it). | Stays recorded debt (upgraded wording landed in the A12 batch); deletion lands with the next touch of DES-102/DES-106 + re-pointing the UT cases. |
| S-1 | LOW | `DEFAULT_CEILINGS` duplicated (`run-manager.ts:110`, `mcp-facade.ts:20`); catalog without `opts.ceilings` enforces no registration ceiling. Production composition root always passes the shared object. | Stays recorded debt (IMPL-141/143 rationale stands, re-affirmed by both experts). |

Also verified-not-filed by adversarial and accepted by this reviewer: the pre-v21 registration
read-modify-write concurrency wart (out of scope, recorded); `UNKNOWN_ALIAS` echoing alias names
(not secrets); the impure-`meta` canonicalization path (inert — `checkMetaLiteral` fails such
scripts at run time); self-inflicted resume refusal on a typed `‹secret:` (caller-scoped,
fail-closed); IC4's ceilings-vs-inline-script argument (ADR-005 ruling stands).

**arch_consistent = false.** Blocking violation: F2 (with F1 riding in the batch). F3 is a MED
record-honesty defect (doc-only). The LOW set is doc-layer drift + declared debt.

### S6. Validation & handover

- **Real-tier: all green.** trace: 0 未驗證, 0 未真實驗證. `rtm.md`: **95/95 REQs ✅ real:true**
  (reviewer-grepped: the only ❌/✅ outside rows are the legend line).
- `08-validation.md` v21 section now carries ROUND 3 (commit `631ccbb`): scope correctly narrowed
  by `git diff 90b5d30..HEAD -- src/` (only `contract.ts` moved post-Round-2), REQ-090/091
  re-confirmed live over MCP HTTP against a fresh `deploy.sh --background` boot (version string
  cross-checked against `git rev-parse`), including a byte-for-byte wire-response inspection for
  the 997626d leak class plus the honest `toErrEnvelope()` pre-fix-observability note. ROUND 1/2
  stamps stand for the untouched REQ paths — reasoning verified sound.
- **README.md + DEPLOY.md: unchanged since #4's clean check** (`git log` — last touch `507aff7`,
  the Gate 7.5 pass); spot-re-read confirms current-state, history-free header, 淺白繁中, ASCII
  diagram, §0 一鍵部署 `./deploy.sh --background` leading — the exact command Gate 7.5 ROUND 3 ran
  again this round. 設定總表 §1b single-source; no new config keys this round (contract.ts only).
- **Checked, clean.**

### S6b. Special-file review (files touched this iteration)

`git diff 016e95c..HEAD --name-only` (this round) ∩ {CLAUDE.md, AGENTS.md, *SKILL.md} = **∅** —
this round touched only ledger docs, `src/params/contract.ts`, and 3 test files. CLAUDE.md (new in
v21, reviewed via claude-md-improver audit at #4: pass, 2 LOW notes) is unchanged since — verdict
carried, no re-review needed.

### S7. Send-back scope pin (the auto re-run runs each gate ONCE; unpinned scope is how items dangle)

- **Gate 5 (tests) — RED first:**
  - F2: (a) admission refuses an `appendPrompt` containing the close-delimiter (`</user-instructions>`
    — or tighter, `<` + `/user-instructions`) with `PARAM_OUT_OF_RANGE`, reported by position/size,
    **never by content** (DES-101 row 6 discipline); (b) extend the drift-lock at
    `params-resolve.test.ts:193-200` to pin frame **integrity** (the invariant), not just the
    wrapping (the spelling); (c) the durable half: a pre-fix-admitted run whose persisted
    `effectiveParams` carry the delimiter must be refused at resume (or the alternative below).
  - F1: the red case must construct the **post-normalization** object (register via
    `params.knobs.model.default` with an `openrouter/<id>` string AND via `defaults.model` with the
    same string — pin that both doors give the SAME answer); both halves are unit-test-invisible in
    isolation, which is why the hole survived 4 passes.
  - F4: `validateSpecShape` rejects `min`/`max` on a `type:'enum'` spec (typed, nothing stored).
- **Gate 6 (impl) — GREEN + doc batch in the same pass:**
  - F2: one rejection row in `validateUserOverrides` — **refusal, not escaping** (escaping breaks
    ARCH-066 inv-2 resume byte-identity + inv-4 refuse-never-alter; pinned so the fix is not
    "improved" into the wrong shape). Durable half: resume-side delimiter check next to the
    existing `hasSecretMarker` guard, OR a recorded verified decision that no persisted run in the
    live deployment carries the delimiter.
  - F1: `harness-defaults.ts:86` → `isKnownAlias`; move the `validateHarnessDefaults` call after
    the normalization loop, over `effectiveDefaults`, **preserving the origin-keyed rejection
    codes** (`workflow-catalog.ts:175-180`). Net-negative lines.
  - F4 code fold-in; F5 decided (hash-suffix or documented collision) and recorded.
  - **Doc batch (same pass, not a follow-up — H-4 precedent):** F3 (`04-design.md:2711` +
    ARCH-066/ADR-002 residual rewrite, re-file the v22 candidate), S-2 (ADR-005 + inv-4 G-1
    amendment incl. the lowered-ceiling asymmetry statement), C-3 (`workflow_register` schema
    properties + description + drift-lock pin + DES-098 amendment).
- **NOT in scope:** anything in §S1's closure table; R-1/S-1 (recorded debt with standing
  rationales); the 11 trace gaps; solid_check's 10 unclaimed files; trace.py version sync;
  state.yaml strict-YAML defect (housekeeping debt, unchanged from #4).

### S8. Retro (v21, fifth pass)

- **What went well:** the send-back machinery genuinely converged — 2 HIGH → 0 HIGH across one
  re-run cycle; every one of the 30+ accumulated findings from passes 1–4 is verifiably closed at
  HEAD; the out-of-band commit class (`997626d`) was caught by the verifier's flag and re-validated
  at the real tier instead of riding a stale stamp; ledger honesty (A7) was actually repaired.
- **To change:** (1) v21 shipped a *structural* control (the frame) with a drift-lock that pinned
  its spelling but not its meaning — when a control IS a delimiter/fence/marker, the RED test must
  include the forgery case from day one; (2) validation gates that run before all their inputs
  exist (F1's ordering) are invisible to per-half unit tests — integration cases must construct
  the post-normalization object; (3) five passes is the cost of unpinned early scope — the
  boundary-crossing discriminator + terminating rule (§preamble) is now explicit so pass 6 cannot
  re-open indefinitely.
- **Known tech debt (all recorded):** the 11 trace gaps (9 drift LOW incl. 2 declared
  false-positive pairs, TASK-018 LOW, IMPL-082 MID); R-1 mapEffort twin (deletion instruction
  standing); S-1 ceilings-copy residual; solid_check's 10 unclaimed files; repo trace.py older
  than plugin (no `--tool`, no mermaid offline fallback); state.yaml strict-YAML defect;
  pre-v21 registration read-modify-write concurrency wart; erDiagram checker false positive
  (recorded to prevent re-filing).

### S9. Report

```
Gaps: high=0 mid=4 (F1, F2, F3 new; IMPL-082 pre-existing TDD)
      low=17 (F4, F5, C-3, S-2 new + R-1, S-1 carried + 10 trace-recorded + 1 dashboard-fallback;
      state.yaml strict-YAML counted under housekeeping) — all remaining recorded
Drift: none unrecorded — the 9 trace iter-drift LOW (2 declared false positives) + the S5 LOW doc
       batch (ADR-005/DES-098/design-residual text lagging adjudicated code); A7 ledger-honesty
       from #4 verified CLOSED (IMPL-142/143/144 traced)
Architecture consistent: NO — F2 (ADR-007's frame forgeable by its payload — cross-principal
       attribution forgery, v21-new code, BLOCKING) + F1 (ARCH-064 one-predicate claim split,
       safe direction, rides) + F3 (residual record mis-scoped, doc-only) + F4/F5/C-3/S-2 LOW
Validation: real-tier all-green? YES (95/95 real:true, ROUND 3 fresh one-command boot) ·
       README+DEPLOY present? YES (current-state, history-free, 繁中, 一鍵部署 verified-run)
Dashboard: renders per lexical checks; 1 recorded checker false positive (erDiagram crow's-foot);
       no-playwright + plugin-script degraded modes noted
Module boundaries: solid_check PASS (10 pre-existing LOW unclaimed; #4's R-2 closed)
Conclusion: SEND BACK to Gate 5 (tests) + Gate 6 (impl) — scope pinned in S7. Not closeable over
       F2 (F1/F4/F5 + doc batch ride the same re-run). Terminating rule declared: pass 6 closes
       with recorded debt unless a boundary-crossing finding remains. .panel/ retained for the
       re-run.
```

## v21 GATE 8 RE-REVIEW #4 (2026-09-01, SUPERSEDED by RE-REVIEW #5 above — kept for history; was SEND BACK to tests+impl)

> **Fourth Gate 8 pass — after the IMPL-141 closeout (commits `90b5d30`, `1f13b61`, `016e95c`) and
> Gate 7.5 ROUND 2 (real-tier re-validation of G-1/P-A3 against a fresh `deploy.sh --background`
> boot).** Both architecture experts were re-dispatched on the post-IMPL-141 state
> (`.panel/review/adversarial.md` pass 4, `quality-dimensions.md` — both dated this pass).
> **Every prior send-back item is genuinely closed in code**: R-G1..R-G10, P-A1..P-A4, F-1/F-2,
> G-1/G-2 and P-A6 were all re-verified at HEAD by the adversarial expert's "Checked and clean"
> table AND spot-verified independently by this reviewer (§Q1). The v21 wiring — ceilings threaded
> from ONE shared object, one bounds predicate at all rungs, refusal-only resume, redact-then-cap,
> correct `output_config.effort` wire shape against both vendored SDKs — is sound.
> **Verdict: still NOT closeable — `send_back: ["tests","impl"]`, `arch_consistent: false`.** The
> block is TWO NEW HIGH findings in `src/params/contract.ts` — the parser's own input validation
> (A1) and the cost of its rejection path (A2). Neither is a regression of any prior fix (the
> auto-re-run-ONCE budget has not been spent on them); they are the *inverse* of the class the three
> send-backs closed: not "an advertised bound enforced nowhere" but "an accepted input that is
> unsurvivable downstream". Both were **independently reproduced by this reviewer on this tree**,
> not taken on the expert's word.

### Q1. Prior-send-back closure verification (independent, on disk at `016e95c`)

| item | reviewer verification |
|---|---|
| P-A1 (wire shape) | `gateway/client.ts:42` `restPath:['output_config','effort']`; adversarial cross-checked against the **vendored** `@anthropic-ai/sdk` `OutputConfig` type (`messages.d.ts:853-863`) — genuinely closed |
| P-A2/R-G3 (one alias table) | `server.ts:1155`/`:1206` both read `config?.aliases ?? DEFAULT_ALIASES` |
| P-A3 (defaults reach dispatch) | Gate 7.5 ROUND 2 live evidence: registered `defaults.effort:'high'`, no override → `workflow_agent_log` harness `effort:'high'`, `provenance.effort:'default'`, real Ollama run completed (08-validation.md v21 ROUND 2) |
| P-A4 (model.default alias-checked at registration) | `contract.ts:184-186` |
| F-1/G-1 (ceiling over FINAL effectiveDefaults) | `workflow-catalog.ts:171-193`, one pass keyed by knob, shares `checkValueAgainstSpec`; real-tier ceiling-bypass refusal case green (VAL evidence, `HARNESS_DEFAULTS_INVALID`) |
| F-2 (one bounds predicate) | `checkValueAgainstSpec` exported (`contract.ts:204`), catalog's `violatesOwnSpec` delegates |
| G-2 | both surviving adjudication-#5 citations read as historical SUPERSEDED notes — verified by adversarial, spot-read by reviewer |
| P-A6 (marker grammar dedup) | `hasSecretMarker` exported from `secret-resolver.ts:124`, imported at `run-manager.ts:35` — **closed in code**, but see A7: the ledger says otherwise |

### Q2. Traceability consistency

`sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check`: **818 items / 11 gaps — the
identical set carried since IMPL-140**, byte-matched against the extracted dashboard gap list:

- 9 × 漂移 LOW: UT-058→DES-038, UT-064→DES-054, IT-057→DES-054, UT-094→DES-095, UT-095→DES-095,
  DES-094→IMPL-122, DES-088→IMPL-127, DES-088→IMPL-140, DES-066→IMPL-140 (the last two are the
  **declared false-positive pairs** — `iter:` records origin, not last-touched; amended notes exist
  on both DES items)
- 1 × 未實作 LOW: TASK-018 (pre-existing, recorded debt since v14)
- 1 × TDD MID: IMPL-082 no test coverage (pre-existing, recorded debt since v14)

0 高嚴重度, 0 未驗證, 0 未真實驗證, 0 orphan/broken-link. **All 11 remain recorded known tech
debt** (this section renews the record). One NEW ledger-honesty gap found outside trace.py's view:
**A7** — `src/secret-resolver.ts` changed in v21 (`git diff 637b86e..HEAD` = +14/−1: `MARKER_PREFIX`,
`hasSecretMarker()`) but appears on **no v21 IMPL `files:` line**, and IMPL-141's "Not done,
declared" paragraph still routes F-4/P-A6 as outstanding although the code closed it (Q1 last row).
Doc↔code drift in the impl log itself → folded into the send-back's doc batch (§Q7).

### Q3. Dashboard QA

- Regenerated via `sh .sdlc/trace` (repo copy). **Degraded modes, recorded per contract:** (a) this
  repo's `trace.py` predates the `--tool` dispatcher, so `dashboard_check`/`solid_check` were run
  from the plugin cache (`iso-agile-sdlc/2.1.3/skills/iso-agile-sdlc/scripts/`); (b) no playwright
  browser tools in this session — no in-browser render/tab/SoT-click pass; lexical + structural
  checks only.
- `dashboard_check.py`: 0 high / 1 mid / 1 low.
  - **MID — determined a checker FALSE POSITIVE, verified, not a defect:** "02-architecture.md:929
    (v21 data architecture) 括號不平衡". The block is a mermaid `erDiagram`; the "unbalanced"
    character is the `{` in the crow's-foot cardinality `WORKFLOWS ||--o{ RUNS : "…"` — **valid
    mermaid erDiagram syntax**; the checker is a lexical bracket counter that does not know the
    notation. All identifier/attribute `{…}` blocks in the diagram balance. Recorded here so the
    next reviewer's re-run of the same checker does not re-file it as unaddressed.
  - LOW — `dashboard.html` has no mermaid offline fallback because the repo's `trace.py` is older
    than the plugin's. **Recorded debt:** sync the repo's `.sdlc/trace.py` with the plugin copy in a
    future housekeeping pass (also retires degraded mode (a)).
- SoT links / other mermaid blocks: clean per the checker.

### Q4. Module-boundary check (SOLID)

`solid_check.py`: **PASS** — 7 modules, all cross-module deps as declared on the ARCH `module:`/
`deps:` lines; 0 mid. 10 LOW "未認領檔案" warnings (`harness-defaults.ts`, `self-update.ts`,
`agent-semaphore.ts`, `mcp-probe.ts`, `net-guard.ts`, `workflow-meta.ts`, `workspace-artifacts.ts`,
`webhook-registry.ts`, `continuation-store.ts`, `main.ts` unclaimed by any ARCH module) —
pre-existing arch-doc drift, recorded debt (not v21-caused). One boundary finding the checker's
granularity misses, from the quality expert (**R-2, NEW, LOW**): both gateway impls value-import
`redactHarness` from the executor module (`gateway/client.ts:7` added in v21 by adjudication A-4;
`claude-agent-sdk-client.ts:16` pre-existing) — ARCH-069's `deps:` names only ARCH-065/ARCH-005 and
the container diagram's direction is K4→K5. Route: one-line `deps:` amendment on ARCH-069 (or
relocate `redactHarness`/`capPrompt` to a neutral module) — folded into the doc batch (§Q7).

### Q5. Architecture consistency (consolidated from the 2 pre-run expert reports)

**Sources:** `.panel/review/adversarial.md` (security+scalability+testability, pass 4) and
`.panel/review/quality-dimensions.md` (observability/replaceability/consumability/self-sustainability).
QM ⇒ no safety lenses, correct.

**The two reports disagree and the disagreement was adjudicated on primary evidence, not averaged.**
Quality's §3 "verified consistent" claims — "allowlist-at-both-ends holds", "advertised bound ==
enforced bound by the shared predicate" — are **contradicted by adversarial's reproductions**, and
this reviewer's own reads sided with adversarial each time: no schema validator exists on the tool
dispatch path (A3 — `inputSchema` is declarative metadata; grep confirms the only ajv is the
agent-*output* schema), `min`/`max` on a `type:'string'` knob are NaN-inert (A4 — `contract.ts:222,
230` compare `(value as number)`), and `effectiveBounds` narrows only `timeoutMs`/`effort` so the
third ceiling is never advertised (A5 — `contract.ts:117-127`). Quality verified that text/pointers
exist; adversarial verified what executes. Where they agree (the entire Q1 closure table, purity of
`params/*`, ONE decoration site, refusal-only resume) the agreement is genuine and independently
anchored.

**Consolidated findings (deduplicated across both reports):**

| # | sev | finding (evidence) | route |
|---|---|---|---|
| **A1** | **HIGH** | `parseParamContract` never checks `ParamSpec.type` ∈ literals / `enum` is an array / `min`/`max` are numbers (`contract.ts:161-197`; only locked-key, unknown-key, `enum.length`, model-alias checks exist). `enum:'abc'` on `effort` **registers** ('abc'.length=3 ≤ 32 passes the only guard); `boundEffort` (`contract.ts:110-112`) then throws `TypeError: authorEnum.filter is not a function` on **every** `workflow_get`/`workflow_list` — one poisoned registration by any authenticated principal (or the LAN, auth off by default) is a **durable, engine-wide denial of workflow discovery**, and turns admission into an untyped 500. Violates ARCH-067 fail-closed ("nothing is stored") + ARCH-064's typed-taxonomy invariant. Reviewer-verified in source. | **BLOCKING → tests+impl.** Fix has TWO halves: (1) parser shape guard (~6 lines, `invalid(param,reason)`); (2) **the durable-poison half** — a row poisoned pre-fix still bricks the read path; the re-run must either make `readParams`/`effectiveBounds` total over a malformed stored contract (canonical fallback or typed error, never TypeError) or record an explicit verified decision that no deployed DB carries a poisoned row (a live deployment EXISTS — this is not vacuous). |
| **A2** | **HIGH** | `truncatedSupplied`'s loop trims ONE char per iteration, re-measuring/re-copying each time (`contract.ts:77-84`) — O(n²). **Reviewer-reproduced on this host: 611 ms @ 100k chars, 2396 ms @ 200k, clean 4× per doubling** → an 8 MiB `overrides.model` (bounded only by `MAX_BODY_BYTES`, `server.ts:687`) blocks the single-threaded event loop ≈70 min from ONE request, upstream of `createRun`/`maxConcurrentRuns`/budget, leaving no journal trace. Violates ARCH-066's zero-durable-cost rung property + ADR-005's cost-bounding purpose. | **BLOCKING → tests+impl.** One O(n) `slice` (`Buffer.byteLength` guard + single `subarray(0,64)`). **Red-test shape (pin, to avoid a Gate 5 stall on "testing a complexity bug"):** assert supplied-echo ≤ 64 bytes AND a generous wall-clock ceiling (< 1 s) on a ~1 MB out-of-enum `model` — current code takes ≫60 s, fixed code takes ms; the 100–1000× separation makes the timing assertion robust, not flaky. |
| A3 | MED | ARCH-064 inv (2) "allowlist at both ends" + S-2 credit `additionalProperties:false` as a control; nothing evaluates `inputSchema` server-side (`server.ts:799` casts and forwards). Behaviourally fail-closed today (`validateUserOverrides` is total); the defect is the doc claiming a control that does not run. | Doc fix (adversarial's own adjudicated call, dissent recorded): amend ARCH-064 inv (2)/S-2 — the closed type + parser are the control, the schema is client-facing documentation. Fold into impl re-run doc batch. |
| A4 | MED | `min`/`max` on a `type:'string'` knob are inert (NaN comparisons, `contract.ts:222,230`); author's declared `max` is served on `workflow_get` and enforced nowhere — advertised≠enforced, 4th instance; ADR-007's stated fallback mechanism silently does nothing. Adversarial reproduced (`'x'.repeat(40)` vs `max:10` → ok:true). | **Fold into the A1 fix batch** (same module, same shape guard): length semantics for string `min`/`max` in `checkValueAgainstSpec`, or reject `min`/`max` on string specs at parse. |
| A5 | MED | `maxAppendPromptBytes` enforced at admission but never advertised — `effectiveBounds` narrows only 2 of 3 ceilings; the shipped tool description (`server.ts:334`) even names the ceiling. Fail-closed, consumability defect. | Fold into the A4/A1 batch: add the byte bound to the `appendPrompt` spec in `effectiveBounds`, same-predicate discipline. |
| A6 | MED | `effortApplied:true` keyed per-**provider** (`EFFORT_PROFILES`, `gateway/client.ts:41-43,55-59` — reviewer-verified) while effort support is per-**model** (vendored `claude-agent-sdk/sdk.d.ts:174-178,1198-1202`: per-model `supportsEffort`, silent downgrade). A run on an effort-less anthropic model records "applied" — the dishonest-observability mode ARCH-068's tri-state exists to prevent; weakens REQ-093's low-vs-max assertion shape. | Doc-or-code, expert-sanctioned either way: amend ARCH-069/068 to define `effortApplied:true` = "sent, not honoured" (cheap), or consult the SDK's post-downgrade report (better). Impl re-run decides; record the choice. |
| A7 | LOW | `secret-resolver.ts` v21 change untraced in 06-impl-log; IMPL-141 falsely declares F-4/P-A6 "not done" (it IS done in code — Q1). | Ledger fix in impl re-run: IMPL entry naming the file + correct the IMPL-141 paragraph. |
| A8/O-1 | LOW | 02-architecture.md:913 sequence diagram still emits `appendPromptBytes` (dropped by adjudication B-2). | Doc batch. |
| A9/C-1 | LOW | ARCH-064 note 1 + S-2 name phantom `parseUserOverrides` (grep src/ → 0; real name `validateUserOverrides`). Reviewer-verified. | Doc batch (the F-4 "ARCH-064 rename"). |
| A10/O-2 | LOW | `:975` decision rationale + `:761` note still describe the pre-R-G9 cap site/fields (`redactHarness` cap, `promptTruncated`+`appendPromptBytes`); auditor following ARCH-068 to the redact→cap ordering is pointed at the wrong site. | Doc batch. |
| A11 | LOW | DES-105 body still declares `appendPromptBytes?`/`promptTruncated?` — only the appended B-2 adjudication retracts them; neither exists in `types.ts`. | Doc batch. |
| A12/R-1 | LOW | ARCH-065/069 api lines describe the pre-P-A1 flat `{param,value}` shape; AND the zero-caller duplicate `mapEffort` in `params/resolve.ts:151-164` has **no `restPath`** — the declared F5/QD-2 debt has diverged from "duplicate" to "wrong" (a future caller picking it emits the exact top-level-`effort` HIGH pass 3 filed). | Doc batch + upgrade the debt entry's wording; deleting the dead duplicate is the cheaper true fix — impl re-run's call. |
| O-3 | LOW | 05-tests.md UT-020 note claims "6/6"; file holds 5 cases (quality re-ran: 5/5). | Doc batch. |
| C-2 | LOW | DES-102 prose still says skills-carrying trio / "seven registered keys" vs shipped six-key shape (adjudication B-3) — the routed F-3. | Doc batch (F-3). |
| R-2 | LOW | Undeclared gateway→executor `redactHarness` dep (see Q4). | Doc batch (ARCH-069 `deps:` line) or relocation. |
| S-1 | LOW | `DEFAULT_CEILINGS` duplicated (`run-manager.ts:110`, `mcp-facade.ts:20`); catalog without `opts.ceilings` enforces no registration ceiling. Declared residual with recorded rationale (IMPL-141); production composition root always passes the shared object — adversarial re-verified. | Stays recorded debt, rationale stands. |

**arch_consistent = false.** Violations that block: A1, A2 (both ARCH-invariant violations verified
in source and reproduced). A3..A6 are MED honesty-of-control defects (doc-or-cheap-code); the LOW
set is doc-layer drift, 7 of it already routed by IMPL-141's own F-3/F-4 and still open.

### Q6. Validation & handover

- **Real-tier: all green.** trace: 0 未驗證, 0 未真實驗證. `rtm.md` (regenerated at Gate 7.5 R2 via
  trace.py's own scan/build_matrix): **95/95 REQs ✅ real:true**, 0 ❌ (reviewer-grepped: no ❌ rows).
- `08-validation.md` exists with the v21 ROUND 2 section: fresh `deploy.sh --background` boot
  (version string cross-checked against the clone's `git rev-parse` — the stale-zombie-port gotcha
  honestly recorded), G-1 refusal + P-A3 default-reaches-dispatch live over MCP HTTP against local
  Ollama, suite 1519/1519, tsc clean.
- **README.md + DEPLOY.md present, current-state, 淺白繁中, ASCII 系統圖在 DEPLOY §0.**
  DEPLOY.md **leads with the 一鍵部署** (`./deploy.sh --background`, §0) **that Gate 7.5 actually
  ran**, with the real captured output. History-free by construction (header declares it; spot-greps
  for changelog/version-diff narrative → none; the 設定總表 `iter` column is per-key provenance
  metadata, not superseded instructions — same format every closed review accepted). **設定總表 §1b
  is declared and verified the single place config keys are documented** (other mentions are
  references); v21's 3 ceiling keys present (rows at DEPLOY.md:349-351); Gate 7.5 re-confirmed
  32↔32 both directions.
- **Checked, clean.**

### Q6b. Special-file review (files touched this iteration)

`git diff 637b86e..HEAD --name-only` ∩ {CLAUDE.md, AGENTS.md, *SKILL.md} = **CLAUDE.md (new file,
22 lines)**. Reviewed via the claude-md-improver skill in **audit-only mode** (reviewer discipline:
no edits to work under review). Verdict: **pass, LOW notes only.**

- Accuracy: correct (`git show <sha>:<path>` reads without writing; `git checkout <sha> -- <path>`
  does overwrite AND stage — verified semantics). Currency: reflects a real 2026-08-31 incident;
  actionable, imperative, no stale instructions. The trace-baseline rule matches how this repo's
  trace.py actually works (reads working tree).
- LOW note 1: the incident narrative (7 lines) is longer than CLAUDE.md norms — 2–3 lines would
  carry the rule; the severity context arguably earns its keep. Non-blocking.
- LOW note 2: file is rule-only (no build/test/architecture context). Acceptable here: README/
  DEPLOY/.sdlc carry that for humans and agents alike; not a Gate 8 finding.

### Q7. Send-back scope pin (§P2-style — the auto re-run runs each gate ONCE; unpinned scope is how F-3/F-4 dangled through two closeouts)

- **Gate 5 (tests) — RED first:** A1 (registration of each malformed-spec shape refused typed +
  nothing stored; read path total over a pre-poisoned stored row — seed the column directly);
  A2 (echo ≤64 bytes + <1 s wall-clock on ~1 MB out-of-enum `model`; see the pinned test shape in
  Q5 — do NOT write a bare timing-only assertion); A4 (string `min`/`max` enforced or rejected —
  pick ONE semantics and pin it); A5 (advertised `appendPrompt` bound == `maxAppendPromptBytes`).
- **Gate 6 (impl) — GREEN + doc batch in the same pass:** A1 both halves, A2 one-line O(n) fix,
  A4/A5 same-module fold-ins; A6 decision (doc or SDK-truth) recorded; the deduplicated doc batch =
  A3, A8/O-1, A9/C-1, A10/O-2, A11, A12/R-1 (incl. debt-entry upgrade or duplicate deletion), O-3,
  C-2 (=F-3), R-2 (ARCH-069 deps line), A7 (IMPL entry for secret-resolver.ts + correct IMPL-141's
  false "F-4 not done"). S-1 stays debt.
- NOT in scope: anything green in Q1; the 11 recorded trace gaps; the solid_check unclaimed-file
  list; trace.py version sync (housekeeping debt).

### Q8. Retro (v21, fourth pass)

- **What went well:** the send-back machinery converged — all 24 accumulated findings across three
  passes (R-G1..10, P-A1..A4+P-A6, F-1/F-2, G-1/G-2) are verifiably closed in code, most re-proved
  at the REAL tier against a fresh one-command boot; the two-expert split (adversarial reproduces,
  quality traces) caught each other's blind spots — quality's "verified consistent" on A3/A4/A5
  was falsified by adversarial's reproductions, exactly what the two-lens design is for.
- **To change:** (1) every send-back so far attacked the *enforcement* seams; nobody until pass 4
  asked "is the parser's own input survivable downstream?" — add a standing "fail-open parser"
  lens item: any accepted input must be provably consumable by every downstream reader.
  (2) Rejection-path COST is part of the contract: a validator that is fail-closed but O(n²) is
  still a hole; cheap micro-benchmark on new hot validators at Gate 7. (3) Ledger honesty drifted
  under out-of-band commits (35e6994 landed work with no IMPL entry; IMPL-141 declares done work
  not-done) — the "no commit without an IMPL entry" rule needs to survive racing workflows.
- **Known tech debt (all recorded):** the 11 trace gaps (9 drift LOW incl. 2 declared
  false-positive pairs, TASK-018 LOW, IMPL-082 MID); S-1 ceilings-copy residual; solid_check's 10
  unclaimed files; repo trace.py older than plugin (no --tool, no mermaid offline fallback);
  A6's provider-vs-model honesty note if the doc route is chosen; **NEW LOW (found this pass,
  pre-existing)**: `state.yaml` is not strict-valid YAML — an old gate note (line 73, the
  validation entry, col ~8978: `version:"v1.4.0-val75"` unescaped inner quotes inside a
  double-quoted flow scalar) breaks `yaml.safe_load`; the workflow tooling reads it leniently so
  nothing is broken today, but any strict-YAML consumer of the resume file will fail — housekeeping
  fix (escape or re-quote that one note) alongside the trace.py sync.

### Q9. Report

```
Gaps: high=2 (A1, A2 — NEW, blocking) mid=5 (A3..A6 new; IMPL-082 pre-existing TDD)
      low=22 (10 expert/deduped + 10 trace-recorded + 1 dashboard-fallback + 1 state.yaml
      strict-YAML defect, pre-existing) — all remaining recorded
Drift: doc-layer only — 9 trace iter-drift LOW (2 declared false positives) + the Q5 LOW doc batch
       (arch/design/test text lagging adjudicated code) + A7 impl-log honesty; no unrecorded drift
Architecture consistent: NO — A1 (ARCH-067 fail-closed violated, durable engine-wide discovery DoS),
       A2 (ARCH-066/ADR-005 rejection-cost violated, single-request event-loop DoS ~70 min),
       A3..A6 MED honesty-of-control
Validation: real-tier all-green? YES (95/95 real:true, fresh one-command boot) · README+DEPLOY? YES
       (current-state, history-free, 繁中, 一鍵部署 verified-run)
Dashboard: renders per lexical checks; 1 checker false positive (erDiagram crow's-foot) recorded;
       no-playwright + plugin-script degraded modes noted
Module boundaries: solid_check PASS (10 pre-existing LOW unclaimed + R-2 deps-line amendment)
Conclusion: SEND BACK to Gate 5 (tests) + Gate 6 (impl) — scope pinned in Q7. Not closeable over
       A1/A2. .panel/ retained for the re-run.
```

## v21 GATE 8 RE-REVIEW #3 (2026-09-01, SUPERSEDED by RE-REVIEW #4 above — kept for history; was SEND BACK to tests+impl)

> **Third Gate 8 pass — after the §R2 closeout (IMPL-140, commits `f8bb366`, `50a2a36`).**
> Both architecture experts were re-dispatched on the post-IMPL-140 state
> (`.panel/review/adversarial.md` pass 3, `quality-dimensions.md` — both dated this pass).
> **All ten §R2 findings R-G1..R-G10 are genuinely closed in code** — confirmed by both experts AND
> independently spot-verified by this reviewer (§P1). The redaction/resume/CallKey core is now sound.
> **Verdict: still NOT closeable — `send_back: ["tests","impl"]`, `arch_consistent: false`.** The
> block is a set of NEW findings (not regressions of any R-G fix, so the auto-re-run-ONCE budget has
> not been spent on them): one HIGH wire-contract falsity in the original v21 ARCH-069 wiring that
> every test tier is structurally blind to, plus three MED instances of the registration↔admission
> seam — the same "fix complete at one end of the seam only" pattern that produced R-G3.

### P1. §R2 closure verification (independent, on disk at `50a2a36` — not carried on the experts' word)

| item | reviewer verification |
|---|---|
| R-G1 | `grep -rn unredactBestEffort src/` → 1 hit, a comment (`run-manager.ts:628` explaining why it was deleted); refusal-only resume via `PARAM_SECRET_UNAVAILABLE` at `run-manager.ts:538-539`, scan covers the whole rehydrated snapshot |
| R-G2 | effective **post-merge** model checked at `run-manager.ts:424-431` (after `mergeRunParams`, before `createRun`) — un-overridden stale registered defaults covered, rationale comment in place |
| R-G3 (admission end) | `server.ts:1196` feeds `config?.aliases ?? DEFAULT_ALIASES` with the mirror-dispatch rationale comment |
| R-G9 | `agent-executor.ts:430-439`: `redact()` FIRST, `capPrompt` applied unconditionally SECOND — no partial-credential window |
| R-G10 | `grep -n "!== 'harness'"` → only explanatory comments (`:174`, `:452`); both redaction-skip carve-outs deleted |
| R-G4..G8 | closed by subsumption/doc amendment — confirmed via the experts' per-line checks (adversarial "Checked and clean" section, quality §1-4 conformant lists) |

`npx tsc --noEmit` → clean (run by this reviewer). Suite 1499/1499 green is **inherited from
IMPL-140's record at `50a2a36`** (vitest exit 1 = the pre-existing spawn-litellm-ENOENT background
artifact, verified at the stashed baseline per state.yaml) — acceptable here because the mandated
Gate 5+6 re-run below re-establishes the full suite anyway.

### P2. Blocking findings from THIS re-review (consolidated from both pass-3 experts; every load-bearing claim re-verified on disk)

| # | Sev | Finding (expert id) | Reviewer-verified evidence + corrections |
|---|-----|---------------------|------------------------------------------|
| **P-A1** | **HIGH** | **`EFFORT_PROFILES.anthropic.param='effort'` is spread TOP-LEVEL into the Anthropic Messages request body on the REST path, where the real API contract is `output_config:{effort:…}` — every effort-bearing anthropic call on that path fails `400 → terminal` while the descriptor records `effortApplied:{param:'effort',value:…}`, a false claim of success** (adversarial A1). Violates ARCH-069, ARCH-068's tri-state honesty, DES-106, and REQ-093's own acceptance clause ("**provider-appropriate** mapping", "never a silent claim of success"). | `client.ts:32` (profile), `:126` (`effortBodyFields` spread), `:156` (direct `api.anthropic.com/v1/messages` body), `:293` (LiteLLM-proxy branch, same spread); `claude-agent-sdk-client.ts:581` sets `Options.effort` — a REAL SDK field, so the SDK path is correct. API contract verified this pass against the authoritative Claude API reference: effort is GA **inside `output_config`, not top-level**; an unknown top-level param → `400 invalid_request_error`. The profile encodes a *name* where the two consumers need a *placement*; ARCH-069's object-identity defence guarantees record≡intent, not that the field is real at each transport. **Reviewer correction to the expert's exposure claim:** `main.ts` default gateway is **`sdk`** (correct path) — the broken REST body lives on the documented `gateway:"direct-fetch"` opt-out (both its direct-anthropic and its own LiteLLM-proxy branch), NOT the default deployment; the expert's "any authenticated principal can deny every anthropic call on a default deployment" framing requires that opt-out config. Still HIGH: supported documented configuration, false-success observability defect (the exact class REQ-093 exists to kill), and **structurally invisible to every test tier that ran** (UT-101 asserts only bytes-differ against an injected fetchImpl; UT-020 asserts the value lands on `Options`; no test compares emitted shape to the transport's documented contract). |
| **P-A2** | MED | **Registration and admission are fed DIFFERENT alias tables — R-G3's defect at the other end of the same seam** (adversarial A2 ≡ quality QD-4, independent convergence). Violates ARCH-064 ("the ONE alias predicate … shared by the registration-time and admission-time rungs") + ARCH-067 fail-closed registration. | `server.ts:1142` hands the catalog `config?.aliases ? … : undefined` → `workflow-catalog.ts:117` `?? new Set()` → `contract.ts:72` empty-table rule = **no-op**, while `server.ts:1196` hands the run manager `config?.aliases ?? DEFAULT_ALIASES` (R-G3). On the documented default deployment: `workflow_register` accepts a `model.enum` entry (`workflow_get` then advertises it as an allowed value) that **every** subsequent run refuses `UNKNOWN_ALIAS` at `run-manager.ts:424` — advertised bound ≠ enforced bound, register-succeeds-every-run-fails, discovered only at run time. One wiring line. |
| **P-A3** | MED | **A declared `knobs.effort.default`/`knobs.appendPrompt.default` is validated, normalized into the stored `defaults` column, and then never read — the declared default is inert and the descriptor reports "never requested"; the engine-produced `defaults` object also breaks the discover→edit→re-register round-trip** (adversarial A3). Violates ARCH-067/A-2(c) ("the served default is always DERIVED from one source and the two cannot diverge"), ARCH-068 tri-state, REQ-090 — the silent-no-op class v21 exists to repair, reintroduced through the normalization path. | `workflow-catalog.ts:130-142` loop injects EVERY knob's default into `effectiveDefaults` (incl. `effort`/`appendPrompt`); `harness-defaults.ts` `KNOWN_KEYS` = `{model,tools,skills,timeoutMs,prompt}` only → re-registering the engine's own served `defaults` fails `HARNESS_DEFAULTS_INVALID: Unknown harness defaults key: "effort"`; `resolve.ts:38-51` `defaultRunParams` reads only `model/timeoutMs/prompt/tools` (comments admit "no author-side effort/appendPrompt exists"). Fix shape is the impl gate's choice (reject a default no rung can apply, or widen the snapshot's author side) — silently persisting into a type that cannot represent it is the one wrong option. |
| **P-A4** | MED | **A declared `knobs.model.default` bypasses D-AUTH-5-B alias validation, because knob-default normalization runs AFTER `validateHarnessDefaults`** (adversarial A4). Violates ARCH-067 fail-closed / ARCH-062. | `workflow-catalog.ts:108-113` validates the caller-supplied `defaults` only; the `:130-142` loop injects `model:<spec.default>` afterwards; `contract.ts` `parseParamContract` alias-checks `spec.enum` entries but never `spec.default`. On a configured-alias deployment a non-alias `model.default` registers successfully and every named run is refused at admission (R-G2 backstop — why MED not HIGH): the register-time control that should make it impossible-by-construction never fires. |

**Batched into the same re-run (blocking-adjacent, per the B5/R-G6..G10 precedent — same files, strictly-less-code or doc-only):**
P-A5 (MED, adversarial A5) — the value/bounds checker now exists twice (`contract.ts:193-228`
`checkValueAgainstSpec` vs `workflow-catalog.ts:38-45` `violatesOwnSpec`, the latter's own comment
citing a task-file boundary as the reason), against ARCH-064's "cannot drift into three copies";
consolidate to one exported predicate with an explicit `{ceilings?}` parameter while the impl gate
is in these exact files. P-A6 (LOW, adversarial A6) — the `‹secret:` marker grammar is duplicated
into `run-manager.ts:538` as a **fail-open detector** (a future marker-format change in
`secret-resolver.ts:101` silently disables the `PARAM_SECRET_UNAVAILABLE` guard); export a
`hasSecretMarker()` from `secret-resolver.ts` so the two move together. Doc amendments (LOW,
adversarial A7/A8 ≡ quality QD-1/2/3, all confirmed still open at HEAD): (i) ARCH-066 inv-2 gains
its legacy-NULL-snapshot exception clause (`run-manager.ts:615-633` re-resolves pre-v21 rows from
the current catalog row — IMPL-133's deliberate fallback, undocumented in the invariant);
(ii) 02-architecture.md:913 process view drops `appendPromptBytes` (B-2); (iii) `server.ts:373`
`workflow_agent_log` description documents the served `harness` object's v21 fields
(`effort`/`effortApplied`/`timeoutMs`/`provenance`) per ARCH-051; (iv) ARCH-064 note + S-2 rename
phantom `parseUserOverrides` → `validateUserOverrides`.

**Re-run scope (pinned; the workflow auto re-runs each listed gate ONCE).** Gate 5 first — RED
tests that kill the CLASS, not just the instance: (a) **transport-contract shape pins** for the
effort mapping — the REST body places effort at `output_config.effort` (the documented Messages API
placement) and the SDK path sets `Options.effort`, each asserted against that transport's documented
contract, NOT against "differs from the other run" (the assertion style that let P-A1 through every
tier); plus the descriptor stays honest on both paths. (b) **table-parity**: registration and
admission are fed the SAME alias table on the default AND configured deployments (structural pin at
the wiring, the shape R-G3 taught us); registered-then-unrunnable is unrepresentable. (c) declared
knob defaults: a declared default either takes effect at dispatch (observable in
provenance/descriptor) or is refused at registration — never inert; and the discover→edit→
re-register round-trip succeeds on engine-produced `defaults`. (d) a non-alias `knobs.model.default`
is refused at registration on a configured-alias deployment. Gate 6 then GREEN + the P-A5/P-A6
consolidation + the four doc amendments + full regression.
**OUT of scope for the re-run (so re-review #4 does not re-litigate):** A9 (invalid `maxEffort`
config value silently empties the effort enum — recorded debt below), the F4 nested-frame contract
(deferred to v22 by design, unchanged), F5/QD-2 dead `mapEffort` copy in `resolve.ts` (recorded
debt, though note adversarial's observation that its richer `ProviderEffortProfile` shape is the
closer starting point for P-A1's placement-aware profile), all pre-existing trace/solid debt.

### P3. Non-blocking — recorded tech debt (NEW this pass; adds to the §4 table)

| Finding | Sev | Disposition |
|---|---|---|
| A9 — `maxEffort:"highest"` (any invalid value) in `rwe.config.json` silently yields `EFFORT_RANK[…]=undefined` → effective enum `[]` → every `overrides.effort` refused engine-wide, no startup error (`main.ts:164`, `server.ts:1187`, `contract.ts:109-113`; `isEffort` exists in the same module, unused at the config boundary) | LOW | Debt: validate at the boundary the value enters (fail fast or documented-default + log line). Not clamping — ADR-005 stays intact for caller values; this is an operator value. |
| VAL-103 applied-branch residual: the anthropic `applied:true` mapping's real-tier evidence never confirmed backend **acceptance** (the live Anthropic SDK dispatch died on an unrelated model-not-found; Ollama has no dial; the REST path has zero real coverage) | — | Same accepted-gap class as D-V3 (no paid-provider key in this environment). NOT a mock-only REQ — VAL-103 ran 17/17 with 0 skips against real Ollama + a real `api.anthropic.com` dispatch. After the P-A1 fix lands, strengthen at the next Gate 7.5 touch when a dial-bearing provider is reachable. |
| Both P2 experts' reports carry two factual errors this review corrects: "default deployment selects LiteLLM gateway" (default is `sdk`) and "VAL-103's HAS_PROVIDER case skipped" (it ran, 0 skips) | — | Recorded so the re-run implementer works from the corrected exposure model, not the expert prose. |

### P4. Traceability / dashboard / module-boundary / validation / special files (this pass)

- **Trace** (`sh .sdlc/trace … --check`): **817 items / 11 gaps** — 0 high, 1 mid (IMPL-082 TDD,
  pre-v5), 10 low (9 iter-drift incl. the 2 NEW declared false-positive pairs DES-088/DES-066 ←
  IMPL-140, amended in-doc per state.yaml "iter records origin, not last-touched"; + TASK-018).
  0 broken links, 0 orphans, **0 未驗證, 0 未真實驗證**. All 11 recorded (Exit Gate 1 by recording).
  `rtm.md`: 95/95 REQ real-verified.
- **Dashboard QA** (`dashboard_check`, plugin 2.1.3 run from cache — repo `trace.py` predates
  `--tool`, known version-skew debt): 0 high / 1 mid / 1 low, both same as pass 1. The mid
  (02-architecture.md:929 "unbalanced `{`") **independently re-verified FALSE POSITIVE this pass**:
  all 5 mermaid blocks balance once erDiagram crow's-foot tokens (`||--o{`) are stripped — checker
  limitation, filed upstream. The low = missing offline-fallback, same skew debt. **Degraded mode:**
  no playwright/browser tools in this session — link targets + mermaid verified by tool only,
  in-browser SVG render not re-spot-checked.
- **Module boundaries** (`solid_check`): **PASS — 7 modules, 0 mid**, 10 low pre-existing
  未認領檔案 (recorded debt, unchanged).
- **Validation & handover:** unchanged since Gate 7.5 (`git log 637b86e..HEAD -- README.md DEPLOY.md`
  → last touch `507aff7`, the 7.5 commit). Re-spot-checked: DEPLOY.md leads with §0 一鍵部署
  `./deploy.sh --background` (actually ran at 7.5, output reproduced), history-free banner honored,
  single §1b 設定總表 (README defers to it, no duplication), config round-trip 32/32 keys verified at
  7.5. Checked, clean. 08-validation.md present with per-VAL evidence.
- **Special files:** CLAUDE.md unchanged since commit `952438b` (pre-pass-1) — the pass-1
  claude-md-improver review (≈72/B, non-blocking suggestions as debt) stands; no SKILL.md/AGENTS.md
  touched; no re-review needed this pass.
- `.panel/` **retained** (send_back non-empty). `gates.review.passed` stays **false**.

### P5. Retro (pass 3)

- **What went well:** the R-G1..R-G10 closeout was verified genuinely complete by two independent
  experts + reviewer spot-checks — the send-back loop converges on what it pins; the redact/resume
  core that produced two rounds of HIGHs is now clean.
- **To change:** (1) every test asserting an outbound-wire property must be pinned against the
  transport's **documented external contract**, never against "differs from the sibling run" or
  "lands on the object" — P-A1 passed four tiers because every tier's oracle was the code under
  test; (2) a seam fix (R-G3) must ship with a parity assertion across BOTH ends of the seam, or the
  other end surfaces one review later (P-A2/A3/A4 are all the registration end of admission-side
  fixes); (3) expert reports are inputs, not verdicts — two material factual errors (default
  gateway, VAL skip claim) were caught only by on-disk re-verification.

### P6. Report (v21 Gate 8 RE-REVIEW #3, 2026-09-01 — CURRENT / AUTHORITATIVE)

```
Gaps: high=1 mid=4 low=~9 (architecture-consistency findings: P-A1 HIGH; P-A2/A3/A4 + P-A5 MED; P-A6..A9 + QD-1..3 LOW)
      trace: high=0 mid=1 low=10, all pre-existing/declared+recorded
Drift: none inside the v21 closure (R-G1..G10 all verified closed); 2 new declared iter-drift false
       positives (DES-088/DES-066←IMPL-140) recorded; 4 doc-amendment LOWs batched into the re-run
Architecture consistent: NO — P-A1 HIGH (effort spread top-level into the Messages body on the
  direct-fetch path where the contract is output_config.effort, descriptor records false success;
  test pyramid structurally blind), P-A2/A3/A4 MED (registration↔admission seam: split alias
  tables, inert declared defaults + broken round-trip, unvalidated model default)
Validation: real-tier all-green? YES (95/95 REQ real-verified; VAL-103 applied-branch acceptance
  residual recorded as D-V3-class accepted gap) · README+DEPLOY present? YES (current-state,
  history-free, 一鍵部署 verified-run)
Conclusion: SEND BACK — re-run Gate 5 (tests) + Gate 6 (impl) once, scope pinned in P2; then
  re-review. gates.review.passed stays FALSE; .panel/ retained.
```

---

## v21 GATE 8 RE-REVIEW #2 (2026-09-01, SUPERSEDED by RE-REVIEW #3 above — kept for history; was SEND BACK to tests+impl)

> **Second Gate 8 pass — after the send-back closeout (IMPL-139, commits `5ff0bf2`, `e6077e0`).**
> The first v21 pass (section below) routed B1..B5 to Gates 5+6; the impl gate re-ran and reported
> B1..B5 closed. The two architecture-consistency experts were then **re-dispatched** and re-ran on
> the closeout scope (`.panel/review/adversarial.md`, `quality-dimensions.md`, both dated this pass).
> **Verdict: STILL NOT closeable — `send_back: ["tests","impl"]`, `arch_consistent: false`.**
> Three of the five items (B3/B4/B5) closed cleanly and are verified on disk. **But B1 closed only
> its narrowest half, and the B2 fix introduced a NEW HIGH security regression.** Because this is the
> post-auto-re-run re-review and it is still blocking, per the Gate 8 contract this hands back to the
> orchestrator with the pinned scope below.

### R1. What the re-run closed cleanly (verified on disk, not from the log)

| item | claim | reviewer verification |
|---|---|---|
| B3 | `redact()` at the `kind:'harness'` decoration site before `appendTranscript` | ✅ `agent-executor.ts:415-422`; both gateways emit the descriptor only via `onHarness` (no `kind:'harness'` producer reaches `onEvent`) |
| B4 | one `isKnownAlias` predicate, passthrough-aware + empty-table-skipping, at both rungs | ✅ `contract.ts:71-75`, used at registration (`:175`) and admission (`:284`); parity with `harness-defaults.ts:70` |
| B5 | four stale ARCH lines amended | ✅ nesting bound dropped, `composePrompt` 4-arg named, `promptTruncated`/`appendPromptBytes` dropped, ARCH-070 note restated |

### R2. Blocking findings from THIS re-review (both experts verdict NOT consistent)

Every load-bearing claim re-verified on disk by the reviewer before routing.

| # | Sev | Finding (expert id) | Reviewer-verified evidence |
|---|-----|---------------------|----------------------------|
| **R-G1** | **HIGH (security regression, NEW this closeout)** | The B2 fix turns the redaction marker into a **secret-dereference primitive** (adversarial G1). `unredactBestEffort` blind-expands any `‹secret:NAME›` to the live secret value on resume and cannot tell an engine-written marker from caller-typed text. | `run-manager.ts:128-144` (blind `split/join` over the whole snapshot), reached by every rehydrated resume at `:644-646`; `appendPrompt` is arbitrary caller text screened only for byte length (`contract.ts:261-271`, no char screen), lands verbatim in `RunParams` (`resolve.ts:61`) and is dispatched into the prompt (`agent-executor.ts:342`). Attack: `overrides.appendPrompt="…‹secret:RWE_SECRET_GITHUB_TOKEN›"` → suspend → resume → the real credential is composed into the dispatched prompt; the harness re-redaction at `:415` then hides the trace (B3 masks the B2 defect). Inverts ARCH-056's one-way `redact()` choke-point premise (02-architecture.md:627-640). **Minimum fix: delete `unredactBestEffort`, keep the `:550` typed refusal** — net deletion, closes G1/G4/G5 together. |
| **R-G2** | **HIGH** | B1 checks only caller-supplied `overrides.model`, never the **effective** post-merge model — the "stale registered defaults" hole S-1 was adopted to close is **still open** (adversarial G2 ≡ the original B1 intent). | `contract.ts:241` loops over `Object.entries(obj)` = caller-supplied keys only; a named run with no `overrides.model` never reaches the `:284` check, and even when supplied it is gated on `spec.enum === undefined`. `run-manager.ts:437` validates before `mergeRunParams` (`:443-445`), so the merged `defaults.model` is never re-examined. 02-architecture.md:974 + interface table :959 pin **effective** (post-merge). Blast radius is *larger* than the override case B1 fixed — a stale default hits every submission. Fix: assert the alias on `effectiveParams.model` after merge, before `createRun`. |
| R-G3 | MED | The admission check is fed an **empty** alias table on the documented default deployment while dispatch uses `DEFAULT_ALIASES` (adversarial G3). | `server.ts:1191` `config?.aliases ? … : undefined` → `run-manager.ts:266` `?? new Set()` → `contract.ts:72` `size===0 ⇒ return true` (accept all), yet dispatch resolves against `DEFAULT_ALIASES` (`run-manager.ts:48,242`); `main.ts:36-38` documents omitting `aliases` as normal. The B1 control is inert exactly where most installs sit. Same line duplicates the Set expression already built at `server.ts:1141` (F6's fourth instance). Fix: feed `config?.aliases ?? DEFAULT_ALIASES`, hoist the one Set. |
| R-G4 | MED | A rotated secret makes resume dispatch **different bytes** than admission — silent substitution, the exact thing the restored invariant forbids (adversarial G4). | `run-manager.ts:644-646` restores from the **current** SecretValueProvider; D-1 records this very deployment has an expiring token. Subsumed by R-G1's deletion. |
| R-G5 | MED | `‹secret:…›` marker grammar now duplicated into `run-manager.ts`, breaking `secret-resolver.ts`'s single-owner boundary (adversarial G5). | literal in three spellings: `secret-resolver.ts:101` (writer), `run-manager.ts:132` (inverter), `:550` (residue guard). No shared constant. Closed by R-G1's deletion + one exported prefix constant. |
| R-G6 | MED | A new security-relevant mechanism + a new caller-visible error code shipped with **zero** architecture record (adversarial G6). | `grep` over the ledger: `PARAM_SECRET_UNAVAILABLE` = 0 hits in 02/04/05-docs though thrown at `run-manager.ts:551`; `unredact` absent from v21 ARCH/DES; interface-table `workflow_resume` row (:960) and ARCH-066 inv-5 (:743) describe only the write direction. B5 amended retracted design but missed the NEW mechanism. |

**Also blocking-adjacent LOW (batch with the above re-run):** R-G7 ARCH-064 api line still declares pre-B1 error set (02-architecture.md:724 omits `UNKNOWN_ALIAS`; code `contract.ts:47`); R-G8 ARCH-056 sink enumeration still asserts the B3-disproved "harness already redacted" premise (:633); R-G9 truncate-before-redact can leave partial secret material in the persisted descriptor (`agent-executor.ts:26-32` cuts before `:415` redacts — redact-first fixes it); R-G10 the two `kind!=='harness'` redaction-skip guards survive with their justification deleted (`agent-executor.ts:159,436` — delete both for strictly-less-code). Quality lens adds three LOW doc-drift only (QD-OBS-1 process-view `appendPromptBytes`; QD-CONS-1 `workflow_agent_log` description omits the v21 `harness` output additions; QD-CONS-2 ARCH-064 note names phantom `parseUserOverrides`) — **the quality lens confirms every code-level invariant it checked holds; its 3 findings are doc-level.**

**Re-run scope (pinned):** Gate 5 first — RED tests for (a) the **adversarial** resume case (`appendPrompt` containing a marker literal → resume must NOT produce the secret value), (b) effective post-merge model refused with **zero durable work** on an unresolvable default (negative assertion per ADR-008 no-telemetry), (c) default-deployment alias table non-empty. Gate 6 then GREEN + the deletion (`unredactBestEffort`) + R-G3 wiring + R-G6/G7/G8 doc amendments + R-G9/G10 line-order/deletion cleanups + full regression. The adversarial minimum path (steps 1/2/4) is a **net reduction in source lines** — the tie-break's own signal that the remaining gap is machinery that should not have been added.

### R3. Consolidated verdict for THIS re-review

- **`arch_consistent: false`** — both experts independently NOT-consistent; adversarial 10 findings (2 HIGH, 4 MED, 4 LOW), quality 3 LOW doc-drift.
- Traceability, dashboard, module boundaries, and Gate 7.5 real-tier evidence status are **unchanged from the first pass below** (re-verified this pass: `sh .sdlc/trace` → 816 items / 9 gaps, all pre-existing; `dashboard_check` → 1 mid crow's-foot FALSE POSITIVE + 1 low version-skew; `solid_check` → PASS 7 modules / 0 mid / 10 low unclaimed-file debt; `rtm.md` 95/95 REQ real-verified; DEPLOY.md 一鍵部署 `./deploy.sh --background` verified-run, history-free 設定總表). **None of these block; the block is architecture consistency (R-G1 HIGH security regression + R-G2 HIGH half-closed).**
- `.panel/` **retained** (send_back non-empty — the re-run gates and the next re-review need it). `gates.review.passed` stays **false**.

### R4. Report (v21 Gate 8 RE-REVIEW, 2026-09-01 — CURRENT / AUTHORITATIVE)

```
Gaps: high=2 mid=4 low=7  (architecture-consistency findings) · trace: high=0 mid=1 low=8 all pre-existing/recorded
Drift: none inside the v21 closure; NEW security regression R-G1 introduced by the B2 closeout; doc-drift R-G6..G8 + QD; 7 pre-existing cross-iteration iter-drift pairs recorded
Architecture consistent: NO — R-G1 HIGH (B2 fix = secret-dereference primitive on resume), R-G2 HIGH (B1 half-closed, stale-default hole open), R-G3..G6 MED, R-G7..G10 + QD LOW
Validation: real-tier all-green? YES (REQ-090..095 real:true, deploy.sh boot-from-docs) · README+DEPLOY present? YES (current-state, history-free, 一鍵部署 verified-run)
Conclusion: SEND BACK — re-run Gate 5 (tests) + Gate 6 (impl); scope pinned in R2. Post-auto-re-run still-blocking → hand back to orchestrator. gates.review.passed stays FALSE; .panel/ retained.
```

---

## v21 GATE 8 REVIEW (2026-09-01, FIRST PASS — superseded by the RE-REVIEW above; kept for history — SEND BACK to tests+impl)

> **v21 — tunable-parameter contract, author/user separation part 1 (REQ-090..095 → ARCH-064..070 +
> ADR-001..008 → DES-101..108 → TASK-096..104 → IMPL-129..138 → VAL-100..105).**
> **Verdict: NOT closeable this pass — `send_back: ["tests","impl"]`.** One HIGH architecture-consistency
> violation (both panel experts independently, reviewer-verified on disk): an adopted Gate 2 decision
> produced no code and left a dead parameter plus an in-code comment claiming a check that does not
> exist — the exact silent-wiring class this iteration exists to kill. Two MEDIUM violations of the
> *named* ARCH-066 invariant (5) ride in the same re-run. Everything else is recorded tech debt.
> Traceability, dashboard, module boundaries, Gate 7.5 real-tier evidence, and the handover manuals
> are otherwise clean.

### 1. Traceability consistency (`sh .sdlc/trace`, regenerated 2026-09-01)

**815 items / 9 gaps** (v20 close-out baseline: 756/9; +59 items are the v21 chain itself).
`--check` gap list, all **pre-existing** (none introduced or widened by v21):

| ID | Severity | Type | Disposition |
|----|----------|------|-------------|
| IMPL-082 | MID | TDD label drift (no test link) | Pre-existing since v4 — known debt |
| UT-058 / UT-064 / IT-057 | LOW ×3 | iter drift v6/v9 behind DES-038/DES-054 v11 | Pre-existing — known debt |
| UT-094 / UT-095 | LOW ×2 | iter drift v18/v16 behind DES-095 v20 | Pre-existing — known debt |
| DES-094 | LOW | iter drift v18 behind IMPL-122 v20 | Pre-existing — known debt |
| DES-088 | LOW | iter drift v14 behind IMPL-127 v15 | Pre-existing — known debt |
| TASK-018 | LOW | no implementation (OIDC task) | Functionally superseded by v15..v20 OAuth — known debt |

- **Touched-chain iter alignment is clean:** every drift pair above is pre-v21; the whole v21 chain
  (REQ-090..095 → ARCH-064..070 → DES-101..108 → TASK-096..104 → IMPL-129..138 → UT/IT/VAL) sits at
  iter v21 — no doc↔code drift inside this iteration's closure.
- **0 broken links, 0 orphans, 0 未驗證, 0 未真實驗證 (mock-only).** Gap counts: high=0, mid=1, low=8.
- `rtm.md` (validator-generated, see adjudication D-3): 95/95 REQs ✅ real-verified, 0 ❌.

### 2. Dashboard QA (`dashboard_check`, plugin 2.1.3 tooling)

- The repo-local `.sdlc/trace.py` predates the plugin's `--tool` dispatcher; `dashboard_check.py` /
  `solid_check.py` were run from the plugin cache directly (same plugin/project version-skew class as
  adjudication **D-3**'s missing `--rtm` flag — reconcile upstream, recorded as debt).
- `dashboard_check` result: 0 high / 1 mid / 1 low.
  - **[mid] — verified FALSE POSITIVE**: the flagged mermaid block (02-architecture.md:929, v21 data
    architecture) is an `erDiagram`; the "unbalanced `{`" is the crow's-foot relationship token
    `||--o{` — standard, valid mermaid. Reviewer re-ran the balance check with crow's-foot tokens
    stripped: **all 5 mermaid blocks in 02-architecture.md balance**. Doc unchanged; checker
    limitation filed upstream (plugin scripts), not against this ledger.
  - **[low]** dashboard.html lacks the mermaid offline fallback the 2.1.3 `trace.py` emits — same
    version-skew debt as above (sync `.sdlc/trace.py` from the plugin next iteration).
- **Degraded mode noted:** no playwright/browser tools in this session — SoT link targets and mermaid
  lexical checks verified by tool; in-browser SVG render spot-check not performed.
- SoT file:line link targets: `dashboard_check` reports 0 dead links (the mid/low above are its only
  findings).

### 3. Module-boundary check (`solid_check`)

- **PASS: 7 declared modules (ARCH-064..070), 0 high / 0 mid; 10 low** `未認領檔案` (pre-existing
  files with no ARCH `module:` declaration at all — `main.ts`, `net-guard.ts`, `self-update.ts`,
  `harness-defaults.ts`, `agent-semaphore.ts`, `mcp-probe.ts`, `workflow-meta.ts`,
  `workspace-artifacts.ts`, `webhook-registry.ts`, `continuation-store.ts`); out of this pass's
  scope, recorded as debt (claim them in a future architecture pass).
- **Tool-vs-panel discrepancy recorded honestly (QD-4):** `src/gateway/client.ts:7` value-imports
  `redactHarness` from `../agent-executor.js` — new in v21, and ARCH-069's `deps:` does not name
  ARCH-068's module. `solid_check` nevertheless reported clean, most likely treating ARCH-068's
  declared dep on ARCH-069 as covering the pair. The edge is real and undeclared → recorded as LOW
  debt (move `redactHarness` to a neutral module or declare the dep); not chasing the tool's
  internals here.

### 4. Architecture consistency (consolidated from `.panel/review/adversarial.md` + `quality-dimensions.md`)

Both experts ran on the v21 scope only (IMPL-129..138 `files:` + module-boundary neighbours) against
ARCH-064..070/ADR-001..008 and the A-*/B-*/C-* adjudications. Both independently verdict **NOT
consistent**. Every load-bearing claim below was **re-verified on disk by this reviewer** before
routing. Adjudication #4 (04-design.md:2920) covers none of these — they are fresh findings.

**Consolidated verdict: NOT consistent — `arch_consistent: false`.**

#### BLOCKING (→ re-run Gates 5+6, tests-first; one batch)

| # | Sev | Finding (expert ids) | Verified evidence |
|---|-----|----------------------|-------------------|
| B1 | **HIGH** | **Adopted S-1 decision never implemented; dead `aliasNames` param; lying comment** (adversarial F1 ≡ quality QD-1 — independent convergence). 02-architecture.md:974 + interface table :959 adopt "effective post-merge model alias-checked at submission, existing `UNKNOWN_ALIAS` rule, before any durable work"; DES-101 boundary clause (04-design.md:2549) specifies it. | `contract.ts:220` declares `aliasNames`, body never reads it (only use is `parseParamContract`:161); `run-manager.ts:399` hardcodes `new Set()`; `contract.ts:157-158` comment claims a submission-time re-check that exists nowhere (`grep UNKNOWN_ALIAS src/` → submission-validator.ts only, which scans inline `spec.script` — named runs never checked); unresolvable `overrides.model`/registered default admits the run, burns run row+workspace+sandbox+semaphore slots, every `agent()` → opaque `null` (gateway/client.ts:324). Fifth instance of the silent-wiring class v21 was built to end. |
| B2 | MED | **Resume dispatches the REDACTED snapshot — violates ARCH-066 invariant (5)** ("the dispatched copy is never redacted", :743) (adversarial F2). | Start path redacts persist-only (`run-manager.ts:411-413`, live entry keeps unredacted :479 — correct). Restart/rehydrate path: `:595` reads the persisted (redacted) column via `getEffectiveParams`, `:626` makes it `entry.effectiveParams`, `:817` dispatches it; `redact()` is destructive (`secret-resolver.ts`), no inverse. Restart-conditional silent input substitution — the invariant to restore: **resume dispatches byte-identical params to what admission dispatched, or refuses typed; never silent substitution.** Mechanism choice belongs to the impl gate. |
| B3 | MED | **v21 `appendPrompt` reaches the `kind:'harness'` transcript sink with NO secret redaction — violates ARCH-066 inv (5) sink-completeness + adjudication B-4** ("the non-negotiable item of the batch") (adversarial F3). | `agent-executor.ts:339` composes user `appendPrompt` + author `defaults.prompt` into the prompt; both gateways put it on the descriptor; `redactHarness` (agent-executor.ts:17-45) truncates only, zero secret redaction; the decoration site persists via `appendTranscript` with no `redact()` (:404-410) and `onEvent` **explicitly excludes** `kind==='harness'` from redaction (:419-424) on a "double-redaction exclusivity" premise that is false. One-line fix shape (run `redact()` at the decoration site); extend IT-075's sweep to sink 6. |
| B4 | MED | **Divergent author-side model vocabulary in one `register()` call** (quality QD-3; same seam as B1). | `server.ts:1141` passes `undefined` when `aliases` unconfigured; `workflow-catalog.ts:117` then fail-closes `params.knobs.model.enum` against `new Set()` (every enum entry rejected on a default-alias server) while three lines up `validateHarnessDefaults` (harness-defaults.ts:70) deliberately skips the same check when the set is empty (D-AUTH-5-B); `contract.ts:159-165` also lacks the `openrouter/<id>` passthrough carve-out that submission-validator.ts:106-113 and `models_list` guidance grant. Fix: one DEFAULT_ALIASES-aware + passthrough-aware predicate threaded into both — the same predicate B1 requires. |
| B5 | LOW (mechanical, batch with above) | **Four stale ARCH lines describing retracted pre-adjudication design** (adversarial F8 ≡ quality QD-5) + ARCH-065's now-false "ONLY effort translator" sentence. | Amend in the re-run (adjudicated content, Gate 6.5+7's editing of ARCH `deps:` lines is precedent): (i) :760/:961 drop `promptTruncated`/`appendPromptBytes` per B-2; (ii) :725 drop the nesting-depth bound per B-1; (iii) :779 note (1) restate per A-5 (label-scoped sanitize, no registration-rule reuse); (iv) :733 `composePrompt` is 4-arg with the author segment; and amend ARCH-065/:734 + the dev-view arrow to name `src/gateway/client.ts` as the wired effort mapper (the F5 code duplicate itself stays debt, below). Also append the effective-model alias check to DES-104's admission order line (04-design.md:2621) so design and code agree after B1 lands. |

**Re-run scope (workflow auto re-runs each listed gate ONCE):** Gate 5 first — RED tests for (a)
admission-time `UNKNOWN_ALIAS` on the effective post-merge model incl. passthrough carve-out and
zero-durable-work assertion, (b) resume/rehydrate read-back equality (or typed refusal) vs admission
dispatch, (c) harness-sink secret-redaction sweep case (sink 6), (d) registration model-enum
vocabulary parity with `validateHarnessDefaults` + passthrough. Gate 6 then makes them GREEN + the B5
doc amendments + full regression (this ledger's impl exit bar). Either use or delete the dead
`aliasNames` parameter — silently keeping the signature is the one wrong option.

#### NON-BLOCKING — recorded tech debt (accepted with reasons; not fixed this pass)

| Finding | Sev | Disposition |
|---|---|---|
| F4 — nested `workflow()` frames run under the parent's snapshot; callee's `defaults`/`params` contract never read (`run-manager.ts:744` consumes only `registered.script`; three scenarios incl. cross-owner tool-surface substitution) | MED | **Deferred to v22 by design**: v21 is explicitly "author/user separation part 1"; the nesting boundary needs an un-adjudicated design decision (per-frame re-resolution vs one-snapshot story), not a patch. Must be a REQ/ARCH item in part 2. Recorded here + flagged for the v22 Gate 1/2 intake. |
| F5/QD-2 — two `mapEffort` implementations; `resolve.ts:144-157` copy has zero production callers while ARCH-065 says "ONLY" | MED | Debt: delete the dead copy (re-point UT-099) next touch of DES-102/106; the ARCH sentence is amended in B5 so the doc stops lying meanwhile. IMPL-138 already records the observation. |
| F6 — `DEFAULT_CEILINGS` triplicated (run-manager.ts:105, mcp-facade.ts:20, server.ts:1184-1186); advertised==enforced held by copy-paste | LOW | Debt: single exported `DEFAULT_CEILINGS` in `contract.ts` (strictly less code); A-3's pin test when touched. |
| F7 — `workflowLabel()` non-injective (sanitize+50-char truncate), `issue_list({workflow})` can return another workflow's reports | LOW | Debt/accepted residual: authenticated-only surface, dedup fingerprint unaffected (raw-name hash); fix shape = short hash suffix when sanitize changed the name, or amend ARCH-070's symmetry note. |
| F9 — `parseParamContract` stores/serves author spec objects wholesale (unknown/nested fields not stripped), contradicting ADR-004's "normalized" and B-1's "never served" premise | LOW | Debt: 3-line strip-to-declared-fields at parse, or correct B-1's rationale to "bounded by the 4 KB source cap" (which is the argument that holds). |
| F10 — effort identity-mapped with no value-set validation on the un-ceilinged author/script rung (D-F6-shaped 4xx risk if a backend rejects `xhigh`/`max`) | LOW | Structural residual, not an asserted live bug; cheap option when touched: `EffortProfile` carries accepted set → honest `{applied:false, reason}`. |
| QD-4 — undeclared reverse edge `gateway → agent-executor` (redactHarness value import, client.ts:7) | LOW | Debt: relocate `redactHarness` to a neutral module or declare the dep (see §3; B3's fix may relocate it anyway). |
| solid_check 10 low unclaimed files | LOW | Debt: assign `module:` owners in a future architecture pass. |
| `.sdlc/trace.py` version skew vs plugin 2.1.3 (no `--tool`/`--rtm`, no mermaid offline fallback in dashboard.html) | LOW | Debt: sync the ledger's trace.py from the plugin; `dashboard_check`'s crow's-foot false positive filed upstream against the plugin. |
| Adjudication D-1: production `RWE_SECRET_GITHUB_TOKEN` expired (401) | — | Operator action item (rotate); not a v21 defect; VAL-105 evidence stands on a real `gh auth token` call. |
| Adjudication D-2: production serves v20 until this branch merges | — | Normal branch-scope; not an incomplete iteration. |

**Consistent areas (checked, clean — consolidated from both experts, spot-verified):** ADR-001 closed
`UserOverrides` + `additionalProperties:false` at both ends (locked key unrepresentable end-to-end);
ARCH-066 admission-rung insertion point with zero durable work on rejection and no existing rung
moved; ADR-002 `CallKey` byte-untouched + pinned-snapshot resume (no catalog re-resolution) + legacy
NULL fallback; ARCH-066 inv-6 `composeConfig()` forwarding of all three ceiling keys with the
wiring-guard test rows (fifth instance of the composeConfig bug class genuinely closed, plus four
older instances); ceilings refuse-never-clamp with read-time `effectiveBounds`; ARCH-067 idempotent
migration + fail-closed registration + `ON CONFLICT` params refresh; ARCH-064 inv-5 pre-eval 4 KB
bound; ARCH-068 required `runParams` (tsc lever), one decoration site, provenance emitted by the
computing function, record-then-throw pre-dispatch guard; ARCH-069 `thinkingFor` sole writer of
`options.thinking`, effort object travels by identity, ADR-006 fence intact (zero
`session-options-builder` importers); ARCH-070 fingerprint extension + byte-identical absent-case;
IMPL-138's dead-line deletion claim.

### 5. Validation & handover (Gate 7.5)

- **Mock hard-rule satisfied:** trace reports **0 未驗證 / 0 未真實驗證**; REQ-090..095 all carry
  `real:true` greens (VAL-100..105, 17/17 acceptance cases) against a **deploy.sh-booted fresh
  `git clone`** with real Ollama (qwen2.5:7b) and the real GitHub API (issues #41/#42/#43
  independently re-confirmed via `gh api` by the second validator dispatch). 08-validation.md
  evidence present and specific. The blocking findings above do not invalidate any REQ clause's
  evidence — they are architecture-decision deviations beside the REQ surface.
- **DEPLOY.md** — leads with §0 一鍵部署 `./deploy.sh --background`, which Gate 7.5 **actually ran**
  (08-validation.md:4748-4757, including the health-check output reproduced in the manual);
  淺顯繁中, current-state framing declared and honored (history relegated to the ledger), ASCII
  system diagram, single deduplicated §1b 設定總表 (the three v21 ceiling keys documented there and
  only there; the one `deprecated` row documents a still-honored live fallback = current state, not
  history). Checked, clean.
- **README.md** — 繁中 quickstart + v21 override/contract usage examples + 37-tool surface + security
  model; config keys deferred to DEPLOY §1b (no duplication). Checked, clean.
- No superseded ports/keys/commands found in either manual (changelog-scan clean).

### 6. Special-file review (files touched this iteration)

- **CLAUDE.md (NEW this branch)** — reviewed via the claude-md-improver skill (audit-only; reviewer
  writes nothing outside review files). Score ≈72/100 (B): one high-value, accurate, imperative
  gotcha (never `git checkout <sha> -- <path>` to read history; `git show`/stash instead) with
  copy-paste-safe alternatives — exactly the non-obvious-pattern content that earns its place, and it
  guards the incident class that destroyed this very ledger's working tree on 2026-08-31.
  Non-blocking suggestions (debt): add build/test commands (`npx vitest run`, `tsc --noEmit`,
  `sh .sdlc/trace`) and compress the incident narrative to ~2 lines (history lives in the ledger).
  No SKILL.md / AGENTS.md touched.

### 7. Retro (v21)

- **What went well:** the pure-module + required-argument + provenance architecture made most of the
  silent-failure class unrepresentable, and the panel could *prove* the clean areas quickly; Gate 7.5
  produced the repo's first committed one-command deploy and boot-from-docs evidence; the two-expert
  independent convergence on the same HIGH (F1≡QD-1) is the review layout working as designed;
  adjudication discipline (A/B/C/D series) meant zero re-litigation at Gate 8.
- **To change:** (1) an "adopted in reduced form" rationale line must land as a TASK — S-1's check was
  adopted in prose, decomposed into a DES boundary *clause*, and never became a task card, which is
  how it produced no code while everything traced green; (2) a comment asserting a cross-module
  behavior ("re-checked at submission") should be written only where the behavior lives; (3) invariant
  wording like ARCH-066 inv-5 needs its *read-back* direction enumerated, not just the write
  direction — both B2 and B3 are "invariant implemented where the diagram drew it, not where the
  system flows"; (4) sync the ledger's trace.py with the plugin per release to stop the D-3/§2 skew
  class.
- **Known tech debt:** the non-blocking table above + the 9 pre-existing trace gaps (§1) — all
  explicitly recorded (Exit Gate 1 satisfied by recording).

### Report (v21 Gate 8, 2026-09-01 — CURRENT / AUTHORITATIVE)

```
Gaps: high=0 mid=1 low=8 (all pre-existing, all recorded — plus dashboard_check 1 mid FALSE POSITIVE / 1 low version-skew, recorded)
Drift: none inside the v21 closure; 7 pre-existing cross-iteration iter-drift pairs (v6..v20), recorded
Architecture consistent: NO — B1 HIGH (adopted S-1 alias check unimplemented + dead param + false comment),
  B2/B3 MED (ARCH-066 inv-5 violated on resume read-back and the harness sink), B4 MED (divergent alias
  vocabulary); B5 doc amendments; F4..F10/QD-4 recorded debt
Validation: real-tier all-green? YES (REQ-090..095 real:true, deploy.sh boot-from-docs) · README+DEPLOY present? YES (current-state, history-free, 一鍵部署 verified-run)
Conclusion: SEND BACK — re-run Gate 5 (tests) + Gate 6 (impl) once, scope pinned in §4; then re-review.
  gates.review.passed stays FALSE; .panel/ retained for the re-run.
```

## v20 GATE 8 REVIEW (2026-08-19, SUPERSEDED by v21 above — kept for history)

> This section supersedes "## v19 GATE 8 REVIEW (2026-08-19)" below (kept for history).
> **v20 fix-mode iteration — refresh tokens + callback success page (REQ-012 v20, ARCH-059 v20).**
> Impact closure: REQ-012, ARCH-059, DES-092, DES-093, DES-095, IMPL-122, IT-078, TASK-094, TASK-095 — iter v20.
> No new high/severe gaps, no new broken chains, no arch violations for v20-scoped changes.

### Traceability consistency (v20)

Trace `--check` result (regenerated 2026-08-19): **756 items, 9 gaps.**

Change from v19 baseline (754 items / 12 gaps):

- **2 new items:** TASK-094 and TASK-095 added (both trace ARCH-059, DES-092/093/095, IMPL-122). Both status:done — no 未實作 gap.
- **3 gaps CLOSED:** UT-092 (now at v20, matching DES-092 v20), UT-093 (now at v20, matching DES-093 v20), DES-092 (now at v20, matching IMPL-122 v20). All three were bumped as part of the v20 test/design updates.
- **3 gaps widened (cosmetic — same gap, wider numeric delta):** UT-094 (v18 behind DES-095 v20, was v18 behind DES-095 v19), UT-095 (v16 behind DES-095 v20, was v16 behind DES-095 v19), DES-094 (v18 behind IMPL-122 v20, was v18 behind IMPL-122 v19). google-verifier.ts scope unchanged in v20 — same precedent as prior iterations.
- **Touched-chain iter alignment is clean:** all items in the v20 impact closure (REQ-012, ARCH-059, DES-092, DES-093, DES-095, IMPL-122, IT-078, VAL-095, TASK-094, TASK-095) are at v20 — the chain guard for a fix iteration passes.
- **No new broken links, no new orphans, 0 未驗證, 0 未真實驗證, 0 severe gaps introduced by v20.**

Net: +2 items (TASK-094, TASK-095), -3 gaps (UT-092, UT-093, DES-092 closed). 754→756 items, 12→9 gaps. ✓

| ID | Severity | Type | Note |
|----|----------|------|------|
| IMPL-082 | MID | TDD label drift | Pre-existing since v4; no change |
| UT-058 | LOW | iter drift v6 behind DES-038 v11 | Pre-existing since F1; cosmetic |
| UT-064 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| IT-057 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| UT-094 | LOW | iter drift v18 behind DES-095 v20 | Widened (same gap; DES-095 bumped v19→v20; google-verifier.ts scope unchanged in v20 — cosmetic) |
| UT-095 | LOW | iter drift v16 behind DES-095 v20 | Widened (same gap; DES-095 bumped v18→v20; resolvePrincipal unchanged in v20 — cosmetic) |
| DES-094 | LOW | iter drift v18 behind IMPL-122 v20 | Widened (same gap; IMPL-122 bumped v19→v20; google-verifier.ts scope unchanged in v20 — cosmetic) |
| DES-088 | LOW | iter drift v14 behind IMPL-127 v15 | Pre-existing from v15 |
| TASK-018 | LOW | no implementation | OIDC task; functionally superseded by v15+v17+v18+v19+v20 OAuth implementation |

Dashboard confirms: 0 severe gaps, 0 未驗證 requirements, 0 mock-only validations. All 9 remaining gaps are recorded as known tech debt (Exit Gate 1 satisfied).

### Architecture consistency (v20 self-check — lean QM fix, no panel)

Fix scope: `src/auth/oauth-metadata.ts`, `src/auth/token-store.ts`, `src/auth/auth-service.ts`, `src/auth/google-verifier.ts` (file listed but no v20 changes), `src/server.ts` (dispatch unchanged — refresh_token rides existing `/token` handler at line 1403), `vitest.config.ts` (test config only). Checked against ARCH-059 v20 (the only ARCH decision touched by v20).

**ARCH-059 v20 — refresh tokens + callback success page:**

Architecture text (ARCH-059 v20 excerpt, v20 clause): adds refresh-token support WITHOUT a new module/route/seam; scope captured at `/authorize`, persisted separately from the Google leg (which stays hard-coded `openid email`); `offline_access` in granted scope (space-split membership, not substring) → refresh_token issued alongside access_token; `grant_type=refresh_token` branch on EXISTING `/token` route, single-use atomic consume, RFC 9700 rotation; refresh token uses same opaque sha256-at-rest/injected-clock+CSPRNG discipline as bearer (D-AUTH-1); gcExpired reaps 5th table; `/register` grant-type clamp widens to include `refresh_token`; `/oauth/google/callback` returns 200 HTML success page (id="callback-url" + meta-refresh) instead of 302.

Implementation checks:

1. **D-AUTH-1 — opaque sha256-at-rest, no JWT for refresh token** (`src/auth/token-store.ts:183-213`): `issueRefresh` calls `genRandom(this._csprng)` + stores `sha256hex(token)` as `token_hash`. `consumeRefresh` looks up by `sha256hex(rawToken)`. Identical pattern to bearer token. No JWT. **Matches.**
2. **Seam-consistency — no Date.now() or randomBytes() in token-store.ts** (`src/auth/token-store.ts:183-213`): `issueRefresh` uses `this._clock()` for both `now` and `expiresAt`. `consumeRefresh` uses `this._clock()` for the expiry check. `genRandom` uses `this._csprng`. No direct `Date.now()` or `randomBytes()` calls anywhere in the file. **Matches.**
3. **Scope threading — client scope separate from Google leg** (`src/auth/auth-service.ts:193-194, 201`): client scope captured as `const scope = url.searchParams.get('scope')` and passed to `putState({..., scope})`; the Google redirect hard-codes `gUrl.searchParams.set('scope', 'openid email')`. The client scope is NEVER forwarded to Google. **Matches.**
4. **offline_access check — space-split membership, not substring** (`src/auth/auth-service.ts:353`): `scope.split(' ').includes('offline_access')`. **Matches.**
5. **Single-use atomic consume (RFC 9700) + rotation** (`src/auth/token-store.ts:195-213`): `consumeRefresh` wraps SELECT + DELETE in a `this._db.transaction()`, deleting the row on first read (single-use). `tokenExchange` refresh branch issues a NEW `issueRefresh(row.principal, row.scope, row.clientId, REFRESH_TTL_MS)` on each use — RFC 9700 rotation. `400 invalid_grant` on null/expired result. **Matches.**
6. **client_id binding** (`src/auth/auth-service.ts:298-301`): `if (row.clientId !== null && row.clientId !== clientId) → invalid_grant`. Enforced when stored; skipped when null. Consistent with public-client public-PKCE model. **Matches.**
7. **gcExpired sweeps 5th table** (`src/auth/token-store.ts:247`): `n += this._db.prepare('DELETE FROM refresh_tokens WHERE expires_at <= ?').run(now).changes`. **Matches.**
8. **grant_types clamp widens to include refresh_token** (`src/auth/auth-service.ts:395`): `/register` response body: `grant_types: ['authorization_code', 'refresh_token']`. **Matches.**
9. **200 HTML callback page (v20b), no new route** (`src/auth/auth-service.ts:270-275`): `res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })`. HTML has `id="callback-url"` element with raw URL, `<meta http-equiv="refresh">` with HTML-escaped URL, copy button, JS redirect. No new route in server.ts — `tokenExchange` is the same handler dispatch at `server.ts:1403`. **Matches.**
10. **AS metadata 4 new fields** (`src/auth/oauth-metadata.ts:47-51`): `grant_types_supported: ['authorization_code', 'refresh_token']`, `scopes_supported: ['openid', 'email', 'offline_access']`, `token_endpoint_auth_methods_supported: ['none']`, `authorization_response_iss_parameter_supported: true`. **Matches.**
11. **Idempotent additive migrations** (`src/auth/token-store.ts:80-81`): `try { ALTER TABLE auth_codes ADD COLUMN scope TEXT } catch`, `try { ALTER TABLE oauth_state ADD COLUMN scope TEXT } catch`. `refresh_tokens` table uses `CREATE TABLE IF NOT EXISTS` in the main `_init()` exec. **Matches.**
12. **v19 LOW-6 carry-forward** (`src/auth/auth-service.ts:191`): `const clientState = url.searchParams.get('state')` and new `const scope = url.searchParams.get('scope')` at line 193 — BOTH return `''` for param-present-but-empty; `?? null` in `putState` does not convert `''`. Both `if (clientState)` and `scope.split(' ').includes('offline_access')` guard correctly for `''` (falsy echo, no offline_access). LOW-6 text nit and its sibling scope nit remain cosmetic and carry forward.

**Verdict for v20-touched code: architecture CONSISTENT with ARCH-059 v20.**

Pre-existing violations (UNCHANGED from v19 review — not re-litigated here):

| Label | Severity | Finding | Status |
|-------|----------|---------|--------|
| H-2 | HIGH | ARCH-017/D-PROFILE/DES-031 session-options-builder orphaned | Gate 2 adjudication pending (security-hardening iter) |
| H-3 | HIGH | D-KILL/D-PROC cli-lifecycle + timeout-race dead code | Gate 2 adjudication pending |
| M-1 | MED | LiteLLMGatewayClient transcript opaque | Pre-existing, separately tracked |
| L-1 | LOW | McpRegistry wall-clock direct Date.now | Pre-existing |
| L-2 | LOW | materializeAssets hook arm not removed | Pre-existing |
| LOW-3 | LOW | client-echoable principal on null-edge path | Pre-existing; restrict to test seam when convenient |
| LOW-4 | LOW | ARCH-059 inv.3 text: state TTL 600 s vs. "≤60 s" | Carry-forward; amend to "state ≤10 min / codes ≤60 s" |
| LOW-5 | LOW | ARCH-059 v18 text: "no config-schema change" vs. 3 new optional AuthConfig fields | Carry-forward; amend to "no breaking config change" |
| LOW-6 | LOW | DES-093/DES-095 v19/v20 text: param-present-but-empty stores `''` not null; if/split guards correctly | Carry-forward from v19; scope param inherits same nit; add `\|\| null` coercion or amend text |

**Architecture consistency overall: v20-scoped changes are consistent with ARCH-059 v20. Pre-existing H-2/H-3 remain on their own adjudication track. No new violations.**

### Validation & handover check (v20)

- **VAL-095 (REQ-012, v20):** `real:true`, green, iter v20 (08-validation.md authoritative; trace reports 0 未真實驗證). 9/9 acceptance cases pass; 8 live curl checks (AS metadata v20 fields, 200 HTML callback, offline_access→refresh_token, RFC 9700 rotation, single-use invalidation→400, no offline_access→no refresh_token, refreshed bearer /mcp 200 37 tools, across-expiry 37 tools via SQLite ms-integer backdate).
- **IT-078:** 37/37 (including cases 23-28: v20 refresh token rotation, single-use, across-expiry). VAL-096 5/5, VAL-097 8/8 (F3 updated to v20b 200-HTML extraction).
- **Full suite:** 1369/1369 pass (233 files; zero regression against 1350/1350 pre-v20 baseline).
- **Production service (Gate 7.5 smoke):** `systemctl --user restart rwe.service` → 5 auth tables (bearer_tokens, auth_codes, oauth_state, registered_clients, refresh_tokens), scope cols in oauth_state+auth_codes confirmed, 37 tools, /authorize → accounts.google.com. Idempotent ALTER migrations confirmed.
- **No mock-only/unverified REQ for any v20-touched item.**
- **`08-validation.md`:** present, v20 Gate 7.5 PASSED section written (2026-08-19).
- **`README.md`:** present. Current-state v20. No stale commands.
- **`DEPLOY.md`:** present. Current-state v20. No new config keys in v20 (`REFRESH_TTL_MS` is a code constant, not an operator config key). §1 設定総表 unchanged — no new rows, no key duplication. §7 変更紀錄 has v20 entry (2026-08-19, Gate 7.5 PASSED detail). No superseded instructions outside §7 変更紀錄. Config keys deduplicated.
- **Unreachable deps (carry-forward):** interactive browser Google consent flow and real Claude Code across-expiry SDK loop — engine-side portions fully validated; client-interactive pieces remain headless-unreachable, same classification as v15-v19.
- **Validation verdict: Gate 7.5 v20 PASSED. VAL-095 v20 real:true. 1369/1369 pass. README + DEPLOY present, current-state. No mock-only/unverified REQ.**

### Retro (v20 — refresh tokens + callback success page)

**What changed (IMPL-122 v20, TASK-094/095):**

- `src/auth/oauth-metadata.ts`: `buildAuthServerMetadata` gains 4 fields: `grant_types_supported`, `scopes_supported`, `token_endpoint_auth_methods_supported`, `authorization_response_iss_parameter_supported`.
- `src/auth/token-store.ts`: `auth_codes` and `oauth_state` gain `scope TEXT` column (CREATE TABLE + idempotent ALTER); 5th table `refresh_tokens` (token_hash PK, principal, scope, client_id, issued_at, expires_at); `mintAuthCode` gains optional `scope?:string|null`; `consumeAuthCode` returns `scope:string|null`; `putState` gains `scope?:string|null`; `consumeState` returns `scope:string|null`; `issueRefresh` + `consumeRefresh` added (sha256-at-rest, seam-consistent); `gcExpired` sweeps 5th table.
- `src/auth/auth-service.ts`: `REFRESH_TTL_MS=90d` exported; `authorize()` captures `scope` and threads to `putState`; `googleCallback()` threads `scope` to `mintAuthCode` and returns 200 HTML page (id="callback-url" + meta-refresh/JS redirect) instead of 302; `tokenExchange()` adds `grant_type=refresh_token` branch (single-use consume, RFC 9700 rotation) and ALWAYS echoes `scope`+`expires_in`, conditionally issues `refresh_token` iff `offline_access`; `register()` widens grant_types clamp to include `refresh_token`.
- `vitest.config.ts`: minor test-config adjustment (test timeout/sequencing; no arch impact).
- Documented deviation: `mintAuthCode` scope param implemented as optional (`scope?:string|null`) rather than required per DES-095 v20a, because the UT-093 gcExpired fixture calls `mintAuthCode` with 3 args; threading correctness verified instead by UT-093 scope-threading cases + IT-078 cases 24-28.

**What went well:**

- The v19 client_state plumbing (nullable column + optional putState param + consumeState return extension) provided an exact template for the v20 scope threading. Zero novel design decisions needed.
- ARCH-059's D-AUTH-1 discipline (opaque sha256-at-rest, injected clock+CSPRNG) extended cleanly to `issueRefresh`/`consumeRefresh` — the pattern is isomorphic to `issue`/`verifyByHash` for bearer and `mintAuthCode`/`consumeAuthCode` for codes.
- The three-iteration arc of test defects (F2 VAL-096/VAL-097 broken by v20b 200-HTML change → F3 Gate 5 fix → F3 Gate 6 clean green) was caught immediately by the CI suite; the v20b spec change was the right decision (browsers and headless use cases both served) and the blast radius was limited to two acceptance tests.
- IT-078's end-to-end integration tier (real SQLite + real HTTP + fake RS256 Google IdP) absorbed all 6 new v20 refresh-token cases (23-28) cleanly; no new test infrastructure needed.

**What to change:**

- **`|| null` coercion in authorize()** for both `clientState` and `scope` captures: `url.searchParams.get(...)` returns `''` for a param present-but-empty; `?? null` in `putState` doesn't convert `''`. The guards (`if (clientState)`, `scope.split(' ').includes('offline_access')`) handle `''` correctly for behavior, but the stored value differs from the DES text. One-liner at the capture site (`const clientState = url.searchParams.get('state') || null`, same for `scope`). LOW-6 carry-forward.
- **composeConfig snapshot test** (overdue since v16): v20 adds no new config keys, but the pattern continues. Must build before next config-adding iteration.
- **TASK-018** (OIDC task): superseded by v15+v17+v18+v19+v20 auth; recommend close/annotate in 03-tasks.md.
- **LOW-4** (ARCH-059 inv.3 state TTL text): carry-forward from v17.
- **LOW-5** (ARCH-059 v18 text): carry-forward from v18.

**Impact closure:**

- **"Missing refresh tokens force browser re-auth on every access-token expiry":** CLOSED. Root cause: v15–v19 "no scopes/no refresh" stance was correct for the original design but wrong for real MCP clients — Claude Code auto-appends `offline_access` when advertised, and a missing `refresh_token` forced a browser re-auth on each weekly expiry. Fix: full end-to-end refresh token support (AS metadata advertisement → scope capture → refresh_token issuance iff offline_access → RFC 9700 rotation → single-use enforcement). Engine-side across-expiry proof in Gate 7.5 CHECK 8.
- **"Bare 302 callback URL inaccessible in headless/no-browser flows":** CLOSED. Root cause: the /oauth/google/callback 302 redirect sent the authorization code to the loopback redirect_uri, but in a headless environment nothing is listening on that local port. Fix: 200 HTML success page with `id="callback-url"` (copy-paste for headless) + meta-refresh/JS redirect (auto-catch for same-machine listener).
- **REQ-012 v20 real-client connect (refresh tokens + callback success page clause):** CLOSED.
- **ARCH-059 v20 (refresh token architecture documented):** CLOSED.

**Known tech debt (all recorded, updated from v19):**

*Carry forward — Gate 2 adjudication pending:*
- [HIGH] H-2: ARCH-017/D-PROFILE/DES-031 builder cluster unwired
- [HIGH] H-3: D-KILL/D-PROC cli-lifecycle + timeout-race orphaned

*Carry forward — lower urgency:*
- [MED] M-1: LiteLLMGatewayClient transcript opaque
- [LOW] LOW-3: client-echoable principal on null-edge path
- [LOW] LOW-4: ARCH-059 inv.3 text — amend state TTL bound
- [LOW] LOW-5: ARCH-059 v18 text — amend "no config-schema change"
- [LOW] LOW-6: DES-093/DES-095 v19/v20 text — param-present-but-empty stores `''` not null; add `|| null` coercion or amend text
- [LOW] L-1: McpRegistry wall-clock direct Date.now
- [LOW] L-2: materializeAssets hook arm not removed

---

## v19 GATE 8 REVIEW (2026-08-19, SUPERSEDED by v20 above — kept for history)

> This section supersedes "## v18 GATE 8 REVIEW (2026-08-18)" below (kept for history).
> **v19 fix-mode iteration — OAuth2 client state round-trip + RFC 9207 iss (REQ-012 v19, ARCH-059 v19).**
> Impact closure: REQ-012, ARCH-059, DES-093, DES-095, IMPL-122, IT-078, TASK-093 — iter v19.
> No new high/severe gaps, no new broken chains, no arch violations for v19-scoped changes.

### Traceability consistency (v19)

Trace `--check` result (regenerated 2026-08-19): **754 items, 12 gaps.**

Change from v18 baseline (753 items / 11 gaps):

- **1 new item:** TASK-093 added (traces ARCH-059, DES-093, DES-095, IMPL-122). status:done — no 未實作 gap.
- **1 gap closed:** DES-093 iter bumped to v19 (matches IMPL-122 v19) — prior drift gap DES-093 v17 behind IMPL-122 v18 is resolved.
- **2 new LOW wavefront-drift gaps (TDD wavefront on untouched-scope items):** UT-094 (v18 behind DES-095 v19 — `google-verifier.ts` scope unchanged in v19; cosmetic) and DES-094 (v18 behind IMPL-122 v19 — `google-verifier.ts` scope unchanged in v19; cosmetic). Same precedent as the DES-092/DES-093 wavefront gaps introduced in v18.
- **Existing drift gaps widened (same gap, cosmetic):** UT-093 (v16 behind DES-093 now v19), UT-095 (v16 behind DES-095 now v19), DES-092 (v17 behind IMPL-122 now v19). Severity unchanged (LOW).
- **Touched-chain iter alignment is clean:** all items in the v19 impact closure (REQ-012, ARCH-059, DES-093, DES-095, IMPL-122, IT-078, VAL-095, TASK-093) are at v19 — the chain guard for a fix iteration passes.
- **No new broken links, no new orphans, 0 未驗證, 0 未真實驗證, 0 severe gaps introduced by v19.**

Net: -1 (DES-093 drift closed) + 2 (UT-094, DES-094 wavefront) = +1. 11 → 12. ✓

| ID | Severity | Type | Note |
|----|----------|------|------|
| IMPL-082 | MID | TDD label drift | Pre-existing since v4; no change |
| UT-058 | LOW | iter drift v6 behind DES-038 v11 | Pre-existing since F1; cosmetic |
| UT-064 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| IT-057 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| UT-092 | LOW | iter drift v15 behind DES-092 v17 | Pre-existing from v17 |
| UT-093 | LOW | iter drift v16 behind DES-093 v19 | Widened (same gap; DES-093 bumped v17→v19; UT-093 scope unchanged) |
| UT-094 | LOW | iter drift v18 behind DES-095 v19 | New TDD-wavefront drift; DES-095 bumped v18→v19; google-verifier.ts scope unchanged in v19 — cosmetic |
| UT-095 | LOW | iter drift v16 behind DES-095 v19 | Widened (same gap; DES-095 bumped v18→v19; resolvePrincipal unchanged) |
| DES-092 | LOW | iter drift v17 behind IMPL-122 v19 | Widened (same gap; IMPL-122 bumped v18→v19; oauth-metadata.ts scope unchanged) |
| DES-094 | LOW | iter drift v18 behind IMPL-122 v19 | New TDD-wavefront drift; google-verifier.ts scope unchanged in v19 — cosmetic |
| DES-088 | LOW | iter drift v14 behind IMPL-127 v15 | Pre-existing from v15 |
| TASK-018 | LOW | no implementation | OIDC task; functionally superseded by v15+v17+v18+v19 OAuth implementation |

Dashboard confirms: 0 severe gaps, 0 未驗證 requirements, 0 mock-only validations. All 12 remaining gaps are recorded as known tech debt (Exit Gate 1 satisfied).

### Architecture consistency (v19 self-check — lean QM fix, no panel)

Fix scope: `src/auth/token-store.ts`, `src/auth/auth-service.ts`. Checked against ARCH-059 v19 (the only ARCH decision touched by v19).

**ARCH-059 v19 — client OAuth2 state round-trip + RFC 9207 iss:**

Architecture text (ARCH-059 v19 excerpt): "The two `state` values are architecturally SEPARATE and must never be conflated: the engine-leg `state` stays the `oauth_state` PK; the client's `state` is captured at `/authorize`, persisted across the Google round-trip in a new nullable `oauth_state.client_state` column, and returned only at the final client redirect (`…/callback?code=<engineCode>&state=<clientState>&iss=<issuer>`). The engine also adds the RFC 9207 `iss` parameter (its issuer, byte-equal to the advertised AS metadata `issuer`) on that final client redirect. An omitted/empty client `state` echoes none. No new module, no new route, no config-schema change (one nullable column via idempotent additive migration; the client value is client-supplied so no new clock/CSPRNG seam)."

Implementation checks:

1. **Structural separation of state values** (`src/auth/token-store.ts:55-58`): `oauth_state` table has `state TEXT PRIMARY KEY` (engine-leg CSRF) and a separate `client_state TEXT` (nullable). DES-093 comment (line 133): "The CLIENT's OAuth2 state (RFC 6749 §4.1.2) — distinct from `state` (the engine-leg CSRF token). v19." **Matches.**
2. **Captured at /authorize, persisted across Google round-trip** (`src/auth/auth-service.ts:189-190`): `const clientState = url.searchParams.get('state')` captured after binding/loopback checks; passed to `tokenStore.putState({ ..., clientState })`. **Matches.**
3. **Echoed only at final client redirect** (`src/auth/auth-service.ts:259-260`): in `googleCallback()`, absolute-URL (try) branch: `if (clientState) u.searchParams.set('state', clientState)` + unconditional `u.searchParams.set('iss', effectiveIssuer)`. `iss` uses raw `effectiveIssuer` (not slash-stripped `b`) per Decision B — byte-equal to AS metadata `issuer` as emitted by `oauth-metadata.ts:38`. **Matches.**
4. **No spurious echo when omitted** (`if (clientState)` guard is falsy for null): IT-078 case 22 validates omitted state → no `state=` in callback Location. **Matches.**
5. **No new module, no new route**: no additions to `server.ts` handler list. **Matches.**
6. **No new clock/CSPRNG seam** (`src/auth/token-store.ts:138-139`): `client_state` stored verbatim from client-supplied value; no `this.clock()` or `this.csprng()` call added. DES-093 v19 note confirms seam-consistency. **Matches.**
7. **Idempotent additive migration** (`src/auth/token-store.ts:67-68`): `try { this._db.exec('ALTER TABLE oauth_state ADD COLUMN client_state TEXT'); } catch { /* already exists */ }` — same pattern as `sqlite-run-store.ts:64`. Production service confirmed: `PRAGMA table_info(oauth_state)` shows `client_state` column present after restart. **Matches.**

**LOW-6 (new, text nit):** DES-093 v19 boundary-conditions states `clientState` for `state=` (empty value) is "stored as null." The implementation uses `url.searchParams.get('state')` which returns `''` for `state=`; `?? null` does not convert `''` (non-nullish), so `''` is stored as `''` not `null`. Observable contract is still correct — `if (clientState)` is falsy for `''` so no spurious echo, and `iss` is always present — and IT-078 case 22 covers *omitted* state (no `state=` param, not `state=`). No production impact (no caller sends `state=` without a value). Recommend either a `|| null` coercion in authorize() or a DES-093 text amendment to "null when param absent, empty string when param present-but-empty — both treated as falsy-echo by the if guard." One-liner future cleanup.

**Verdict for v19-touched code: architecture CONSISTENT with ARCH-059 v19.**

Pre-existing violations (UNCHANGED from v18 review — not re-litigated here), plus LOW-6:

| Label | Severity | Finding | Status |
|-------|----------|---------|--------|
| H-2 | HIGH | ARCH-017/D-PROFILE/DES-031 session-options-builder orphaned | Gate 2 adjudication pending (security-hardening iter) |
| H-3 | HIGH | D-KILL/D-PROC cli-lifecycle + timeout-race dead code | Gate 2 adjudication pending |
| M-1 | MED | LiteLLMGatewayClient transcript opaque | Pre-existing, separately tracked |
| L-1 | LOW | McpRegistry wall-clock direct Date.now | Pre-existing |
| L-2 | LOW | materializeAssets hook arm not removed | Pre-existing |
| LOW-3 | LOW | client-echoable principal on null-edge path | Pre-existing; restrict to test seam when convenient |
| LOW-4 | LOW | ARCH-059 inv.3 text: state TTL 600 s vs. "≤60 s" | Carry-forward; amend to "state ≤10 min / codes ≤60 s" |
| LOW-5 | LOW | ARCH-059 v18 text: "no config-schema change" vs. 3 new optional AuthConfig fields | Carry-forward; amend to "no breaking config change" |
| LOW-6 | LOW | DES-093 v19 text: "both stored as null" — `state=` stores `''` not null; `if (clientState)` guards correctly | New this review; add `|| null` coercion or amend DES-093 text |

**Architecture consistency overall: v19-scoped changes are consistent with ARCH-059 v19. Pre-existing H-2/H-3 remain outstanding on their own adjudication track. One new LOW-6 text nit. No new violations.**

### Validation & handover check (v19)

- **VAL-095 (REQ-012, v19):** `real:true`, green, iter v19 (08-validation.md authoritative; trace reports 0 未真實驗證). 9/9 acceptance cases pass (all pre-existing carry-forward green; v19 client-state behavior validated by IT-078 cases 21–22 and live curl below).
- **Live evidence (Gate 7.5):** IT-078 31/31 (29 pre-existing + 2 new v19 cases). Case 21: `/authorize?...&state=CLIENT_STATE_ABC123_V19VAL` → fake Google → `/oauth/google/callback` → final client redirect carries `state=CLIENT_STATE_ABC123_V19VAL` byte-exact + `iss=http://127.0.0.1:19195` (PASS). Case 22: no state param → no `state=` in client redirect + `iss` present (PASS). Full token exchange: POST /token (PKCE) → bearer; authenticated `/mcp` returns 37 tools.
- **Full suite:** 1350/1350 pass (233 files; +2 new IT-078 cases; zero regression against 1348/1348 pre-v19 baseline).
- **Production service (Gate 7.5 smoke):** `systemctl --user restart rwe.service` → `oauth_state.client_state` column present (idempotent migration confirmed); 37 tools; `/authorize` → `accounts.google.com` (v18 Google-host evidence carries forward).
- **No mock-only/unverified REQ for any v19-touched item.**
- **`08-validation.md`:** present, v19 Gate 7.5 PASSED section written (2026-08-19).
- **`README.md`:** present. Current-state v19. OAuth2 client-state round-trip documented in feature list. No stale commands.
- **`DEPLOY.md`:** present. Current-state v19. No new config keys in v19 (`無新設定鍵`). §1 設定總表 unchanged — no new rows, no key duplication. §7 変更紀錄 has v19 entry ("無破壞性變更；無新設定鍵；自動遷移…"). No superseded instructions outside §7 変更紀錄. Config keys deduplicated.
- **Unreachable dep (carry-forward):** interactive browser Google consent flow — headless-unreachable; same pre-existing `unreachable-dep` classification.
- **Validation verdict: Gate 7.5 v19 PASSED. VAL-095 v19 real:true. 1350/1350 pass. README + DEPLOY present, current-state. No mock-only/unverified REQ.**

### Retro (v19 — OAuth2 client state round-trip + RFC 9207 iss)

**What changed (IMPL-122 v19, TASK-093):**

- `src/auth/token-store.ts`: `oauth_state` CREATE TABLE gains `client_state TEXT` (nullable); idempotent `ALTER TABLE … ADD COLUMN client_state TEXT` migration (try/catch pattern per `sqlite-run-store.ts:64`); `putState()` params extended with `clientState?: string | null` (optional, `?? null` guard against undefined bind); INSERT bind extended; `consumeState()` SELECT extended with `client_state`; return type gains `clientState: string | null`.
- `src/auth/auth-service.ts`: `authorize()` captures `const clientState = url.searchParams.get('state')` after binding/loopback checks, passes to `putState()`; `googleCallback()` destructures `clientState` from `consumeState`; in the absolute-URL (try) branch: `if (clientState) u.searchParams.set('state', clientState)` + unconditional `u.searchParams.set('iss', effectiveIssuer)` (raw, not slash-stripped). Catch branch (relative-URI fallback, unreachable post-v16) NOT touched.
- No `server.ts` changes — handler signatures unchanged.

**What went well:**

- Root cause was immediately actionable: the ARCH-059 description of the `oauth_state` table already had "engine-leg state" language; adding `client_state` as a second distinct column was the obvious Karpathy-minimal fix.
- The architectural decision to keep the engine-leg state and client state structurally separate (different columns, never conflated) meant no control-flow refactor — two surgical edits only.
- DES-093 v19 note on seam-consistency ("client_state is CLIENT-supplied — no new clock/CSPRNG read") let the TDD wavefront analysis at Gate 3+4 be trivially quick.
- IT-078 case structure (real SQLite + real HTTP server + fake Google server) made the client-state round-trip an easy end-to-end integration test to add.

**What to change:**

- **`|| null` coercion in authorize()**: `url.searchParams.get('state')` returns `''` for `state=`; the `?? null` guard in putState only catches `undefined`. A `|| null` coercion at the capture site (`const clientState = url.searchParams.get('state') || null`) would make the stored value consistently null for both absent and empty, matching DES-093 v19 text and removing the LOW-6 nit. One-liner, safe to do at any time.
- **composeConfig snapshot test is now 5-for-5 overdue** (named at v16, carried through v17/v18/v19). v19 adds no new config keys, but the pattern continues. MUST build before next config-adding iteration.
- **TASK-018** (OIDC task): functionally superseded by v15+v17+v18+v19; recommend close/annotate in 03-tasks.md to remove the persistent LOW trace gap.
- **LOW-4** (ARCH-059 inv.3 state TTL text): carry-forward from v17.
- **LOW-5** (ARCH-059 v18 text "no config-schema change"): carry-forward from v18.
- **LOW-6** (new this review): DES-093 "both stored as null" text vs `''` stored for empty-string; add `|| null` coercion or amend DES-093 text.

**Impact closure:**

- **"OAuth state mismatch - possible CSRF attack" connect failure:** CLOSED. Root cause: engine handled only its own Google-leg state; never echoed the client's state back to the client redirect_uri (RFC 6749 §4.1.2). Fix: capture client state at /authorize, persist in `oauth_state.client_state`, echo at final client redirect with RFC 9207 `iss`. IT-078 cases 21–22 confirm round-trip; live curl two-case validation; production service restart confirmed idempotent migration.
- **REQ-012 v19 real-client connect (client-state clause):** CLOSED.
- **ARCH-059 v19 (client-state structural separation documented):** CLOSED. Architecture accurately reflects the two structurally separate state values; no new seam, no new module.

**Known tech debt (all recorded, updated from v18):**

*Carry forward — Gate 2 adjudication pending:*
- [HIGH] H-2: ARCH-017/D-PROFILE/DES-031 builder cluster unwired
- [HIGH] H-3: D-KILL/D-PROC cli-lifecycle + timeout-race orphaned

*Carry forward — lower urgency:*
- [MED] M-1: LiteLLMGatewayClient transcript opaque
- [LOW] LOW-3: client-echoable principal on null-edge path
- [LOW] LOW-4: ARCH-059 inv.3 text — amend state TTL bound
- [LOW] LOW-5: ARCH-059 v18 text — amend "no config-schema change"
- [LOW] LOW-6: DES-093 v19 text — `state=` empty stores `''` not null; add `|| null` coercion or amend text (new this review)
- [LOW] L-1: McpRegistry wall-clock direct Date.now
- [LOW] L-2: materializeAssets hook arm not removed

---

## v18 GATE 8 REVIEW (2026-08-18, SUPERSEDED by v19 above — kept for history)

> This section supersedes "## v17 GATE 8 REVIEW (2026-08-18)" below (kept for history).
> **v18 fix-mode iteration — Google OAuth 3-endpoint real-consent fix (REQ-012 v18, ARCH-059 v18).**
> Impact closure: REQ-012, ARCH-059, DES-094, DES-095, IMPL-122, IT-078, TASK-092 — iter v18.
> No new high/severe gaps, no new broken chains, no arch violations for v18-scoped changes.

### Traceability consistency (v18)

Trace `--check` result (regenerated 2026-08-18): **753 items, 11 gaps.**

Change from v17 baseline (752 items / 9 gaps):

- **1 new item:** TASK-092 added (traces ARCH-059, DES-094/095, IMPL-122).
- **2 new LOW iter-drift gaps (TDD wavefront):** DES-092 (v17) and DES-093 (v17) both lag behind IMPL-122 (v18). These design items were not bumped because the v18 URL-injection fix is outside their metadata/token-store scope; IMPL-122 was bumped as the single impl item covering the whole auth subsystem. Cosmetic — no production code gap.
- **UT-095 drift widened:** was "v16 behind DES-095 v17," now "v16 behind DES-095 v18" — same gap item, severity unchanged (LOW). `resolvePrincipal` is unchanged in v18.
- **No new broken links, no new orphans, 0 未驗證, 0 未真實驗證, 0 high-severity gaps introduced by v18.**

| ID | Severity | Type | Note |
|----|----------|------|------|
| IMPL-082 | MID | TDD label drift | Pre-existing since v4; no change |
| UT-058 | LOW | iter drift v6 behind DES-038 v11 | Pre-existing since F1; cosmetic |
| UT-064 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| IT-057 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| UT-092 | LOW | iter drift v15 behind DES-092 v17 | Pre-existing from v17 |
| UT-093 | LOW | iter drift v16 behind DES-093 v17 | Pre-existing from v17 |
| UT-095 | LOW | iter v16 behind DES-095 v18 | Widened (same gap, DES-095 bumped v18; resolvePrincipal unchanged in v18 — cosmetic) |
| DES-092 | LOW | iter drift v17 behind IMPL-122 v18 | New TDD-wavefront drift; DES-092 scope (metadata) unchanged by v18 — cosmetic |
| DES-093 | LOW | iter drift v17 behind IMPL-122 v18 | New TDD-wavefront drift; DES-093 scope (token-store) unchanged by v18 — cosmetic |
| DES-088 | LOW | iter drift v14 behind IMPL-127 v15 | Pre-existing from v15 |
| TASK-018 | LOW | no implementation | OIDC task; functionally superseded by v15+v17+v18 OAuth implementation |

Dashboard confirms: 0 severe gaps, 0 未驗證 requirements, 0 mock-only validations. All 11 remaining gaps are recorded as known tech debt (Exit Gate 1 satisfied).

### Architecture consistency (v18 self-check — lean QM fix, no panel)

Fix scope: `src/auth/auth-service.ts`, `src/auth/google-verifier.ts`, `src/server.ts`, `vitest.config.ts`. Checked against ARCH-059 v18 (the only ARCH decision touched by v18).

**ARCH-059 v18 — Google 3-endpoint URL injection:**

Architecture text (ARCH-059 v18 excerpt): "three separately-injectable URL fields (`googleAuthorizeUrl`/`googleTokenUrl`/`googleJwksUrl`), each defaulting to its correct production host via an exported named constant; a static UT regression guard pins the two previously-wrong production defaults (token + JWKS); the `google-verifier.ts` deps drop the misnamed `googleBase` for a full `jwksUri` (host-agnostic). No new module, no new route, no config-schema change (the three URLs are test-injectable overrides with production defaults; production config is unchanged)."

Implementation checks:

1. **Exported named constants** (`src/auth/auth-service.ts:9-13`): `GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'`, `GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'`, `GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs'` — three distinct production hosts, each an exported named constant. **Matches.**
2. **Separately-injectable fields** (`src/auth/auth-service.ts:28-32`): `AuthConfig.googleAuthorizeUrl?`, `googleTokenUrl?`, `googleJwksUrl?` with 3-way priority resolution (new field > `googleBase`-derived backward-compat fallback > production constant). **Matches injectable override semantics.**
3. **google-verifier.ts rename** (`src/auth/google-verifier.ts:8,16,76`): `JwksPort` type parameter `googleBase→jwksUri`; deps field `jwksUri: string`; call `deps.jwksFetch(deps.jwksUri)`. **Matches "drops misnamed googleBase for full jwksUri (host-agnostic)."**
4. **Static UT regression guard** (UT-094 via `vitest.config.ts`, pinning `GOOGLE_TOKEN_URL`/`GOOGLE_JWKS_URL` constants against wrong defaults). Per DES-095 per-tier policy, unit is the only tier that can catch the fake-double-collapses-hosts class. **Matches.**
5. **No new module, no new route:** `src/server.ts:149` comment updated (terminology only); no route additions. **Matches.**

**Documented deviation (design-level, not arch violation):** DES-095 v18 states `googleBase` is dropped. The implementation retains `googleBase` as `/** @deprecated */` with backward-compat fallback resolution (`src/auth/auth-service.ts:25-26, 124-130`). Documented in IMPL-122 v18 note: VAL-096/097 (v15 fixtures outside F3 closure scope) reference `googleBase`; removal deferred to fixture migration. No production behavior change (fallback only activates when all three new fields are absent AND `googleBase` is explicitly set, which production config never does).

**LOW-5 text-amendment recommendation (new):** ARCH-059 v18 prose says "no config-schema change." The `AuthConfig` TypeScript interface gained 3 new optional fields (`googleAuthorizeUrl?`, `googleTokenUrl?`, `googleJwksUrl?`) and 1 deprecated field (`googleBase?`), with 4 new rows in DEPLOY.md §1 設定総表. The implementation intent is correct ("production config unchanged" — existing configs work without modification). Recommend amending ARCH-059 v18 text to "no breaking config change (3 new optional test-injectable fields + 1 deprecated)". No code gap; LOW doc-debt identical treatment to LOW-4.

**Verdict for v18-touched code: architecture CONSISTENT with ARCH-059 v18.**

Pre-existing violations (UNCHANGED from v17 review — not re-litigated here), plus LOW-5:

| Label | Severity | Finding | Status |
|-------|----------|---------|--------|
| H-2 | HIGH | ARCH-017/D-PROFILE/DES-031 session-options-builder orphaned | Gate 2 adjudication pending (security-hardening iter) |
| H-3 | HIGH | D-KILL/D-PROC cli-lifecycle + timeout-race dead code | Gate 2 adjudication pending |
| M-1 | MED | LiteLLMGatewayClient transcript opaque | Pre-existing, separately tracked |
| L-1 | LOW | McpRegistry wall-clock direct Date.now | Pre-existing |
| L-2 | LOW | materializeAssets hook arm not removed | Pre-existing |
| LOW-3 | LOW | client-echoable principal on null-edge path | Pre-existing; restrict to test seam when convenient |
| LOW-4 | LOW | ARCH-059 inv.3 text: state TTL 600 s vs. "≤60 s" | Recommend text amendment to "state ≤10 min / codes ≤60 s" |
| LOW-5 | LOW | ARCH-059 v18 text: "no config-schema change" vs. 3 new optional AuthConfig fields + 1 deprecated | Recommend text amendment to "no breaking config change (3 new optional test-injectable fields + 1 deprecated)" |

**Architecture consistency overall: v18-scoped changes are consistent with ARCH-059 v18. Pre-existing H-2/H-3 remain outstanding on their own adjudication track. One new LOW-5 text-amendment recommended. No new violations.**

### Validation & handover check (v18)

- **VAL-095 (REQ-012, v18):** `real:true`, green, iter v18 (in `08-validation.md`, which is authoritative; `05-tests.md` carries `real:false` automated entry — trace reports 0 未真實驗證, consistent with the established pattern). 9/9 acceptance cases pass: case 3 — `/oauth/google/callback` token exchange hits injected `googleTokenUrl` (distinct host from dead `googleBase`); case 4 — JWKS fetch hits injected `googleJwksUrl`; 7 pre-existing cases green.
- **Live evidence (Gate 7.5):** IT-078 29/29 — case 19: `/authorize` Location origin = `googleAuthorizeUrl`; case 20: callback exchanges code at `googleTokenUrl` on distinct port. UT-094 15/15 static-pin guard passes. Real Google hosts confirmed: `GET https://www.googleapis.com/oauth2/v3/certs → 200 + 4 RSA keys`; `POST https://oauth2.googleapis.com/token bogus → invalid_client` (not 404); `/authorize → Location: https://accounts.google.com/o/oauth2/v2/auth?...`. Composition-root wiring confirmed (scratch config `googleAuthorizeUrl:127.0.0.1:59099`).
- **Full suite:** 1348/1348 pass (233 files; zero regression against 1342/1342 pre-v18 baseline).
- **No mock-only/unverified REQ for any v18-touched item.**
- **`08-validation.md`:** present, v18 Gate 7.5 PASSED section written (2026-08-18).
- **`README.md`:** present. Current-state v18. Three-endpoint separation documented. No stale commands.
- **`DEPLOY.md`:** present. Current-state v18. §1 設定総表 has 4 new rows (`auth.googleAuthorizeUrl`, `auth.googleTokenUrl`, `auth.googleJwksUrl`, `auth.googleBase` [deprecated]). §変更紀錄 has v18 entry. No superseded instructions outside §変更紀錄. Config keys deduplicated.
- **Unreachable dep (carry-forward):** interactive browser Google consent flow — headless-unreachable (pre-existing, classified `unreachable-dep`, no code gap).
- **Validation verdict: Gate 7.5 v18 PASSED. VAL-095 v18 real:true. 1348/1348 pass. README + DEPLOY present, current-state. No mock-only/unverified REQ.**

### Retro (v18 — Google OAuth 3-endpoint real-consent fix)

**What changed (IMPL-122 v18, TASK-092):**

- `src/auth/auth-service.ts`: exported `GOOGLE_AUTHORIZE_URL`/`GOOGLE_TOKEN_URL`/`GOOGLE_JWKS_URL` named constants (3 correct production hosts); added `AuthConfig.googleAuthorizeUrl?`/`googleTokenUrl?`/`googleJwksUrl?` optional fields with `/** @deprecated */ googleBase?` retained for backward compat; `createAuthRouteHandlers` resolves each URL via 3-way priority (explicit field > `googleBase`-derived fallback > production constant); passes `jwksUri: googleJwksUrl` to `verifyIdToken` deps.
- `src/auth/google-verifier.ts`: renamed `VerifyIdTokenDeps.googleBase` → `jwksUri`; `JwksPort` parameter `googleBase→jwksUri`; call site `deps.jwksFetch(deps.jwksUri)`.
- `src/server.ts`: line 149 comment updated to new field names.
- `vitest.config.ts`: static UT regression guard pinning `GOOGLE_TOKEN_URL` and `GOOGLE_JWKS_URL` constants to their correct production values.

**What went well:**

- The per-tier testing policy in DES-095 v18 (unit = only tier that can detect fake-double-collapses-hosts) was precise and decisive: once the right tests existed, the root cause was immediately visible and non-ambiguous.
- 3-way priority resolution (new-field > deprecated-fallback > production-constant) kept backward compatibility for existing fixtures (VAL-096/097) without any fixture migration in v18 scope, keeping the closure tight.
- Gate 7.5 live confirmation of all three production Google hosts in one pass gave high confidence the root cause was fully resolved.

**What to change:**

- **composeConfig snapshot test is now 4-for-4 overdue** (named at v16, carried through v17 and v18). v18 added 3 new optional config fields; none silently dropped, but the absence of a snapshot test means this class is caught only by live integration, not unit regression. MUST build before next config-adding iteration.
- **TASK-018** (OIDC task): functionally superseded by v15+v17+v18; recommend close/annotate in 03-tasks.md to remove the persistent LOW trace gap.
- **LOW-4** (ARCH-059 inv.3 state TTL text): amend "≤60 s" to "state ≤10 min / codes ≤60 s" (carry-forward from v17, no code change).
- **LOW-5** (ARCH-059 v18 text): amend "no config-schema change" to "no breaking config change (3 new optional test-injectable fields + 1 deprecated)".
- **TASK-091/TASK-092 `status: draft`** despite being shipped: cosmetic ledger residual; flip authorized by orchestrator at next iteration.

**Impact closure:**

- **Real consent 502 at `/oauth/google/callback`:** CLOSED. Root cause: `googleBase=accounts.google.com` used for all three Google OAuth operations; token exchange and JWKS fetch hit non-existent endpoints. Fix: three separately-injectable URLs each defaulting to the correct production host. VAL-095 v18 cases 3+4 confirm correct routing; Gate 7.5 real-Google host confirmation.
- **ARCH-059 v18 (Google endpoint topology documented):** CLOSED. Architecture accurately reflects the three-host topology; static UT regression guard prevents future conflation.

**Known tech debt (all recorded, updated from v17):**

*Carry forward — Gate 2 adjudication pending:*
- [HIGH] H-2: ARCH-017/D-PROFILE/DES-031 builder cluster unwired
- [HIGH] H-3: D-KILL/D-PROC cli-lifecycle + timeout-race orphaned

*Carry forward — lower urgency:*
- [MED] M-1: LiteLLMGatewayClient transcript opaque
- [LOW] LOW-3: client-echoable principal on null-edge path
- [LOW] LOW-4: ARCH-059 inv.3 text — amend state TTL bound
- [LOW] LOW-5: ARCH-059 v18 text — amend "no config-schema change" (new this review)
- [LOW] L-1: McpRegistry wall-clock direct Date.now
- [LOW] L-2: ARCH-018 hooks-drop live branch in materializeAssets

*Action items (carry-forward):*
- [LOW] composeConfig snapshot test — 4 iterations, same bug class; MUST build before next config-adding iteration.

*Trace gaps (all recorded):*
- IMPL-082 MID (TDD-label, pre-existing since v4)
- DES-088 LOW (iter drift v14 behind IMPL-127 v15)
- DES-092 LOW (iter drift v17 behind IMPL-122 v18 — cosmetic; DES-092 metadata scope unchanged)
- DES-093 LOW (iter drift v17 behind IMPL-122 v18 — cosmetic; DES-093 token-store scope unchanged)
- UT-058/UT-064/IT-057 LOW (iter drifts, pre-existing cosmetic)
- TASK-018 LOW (OIDC task, functionally superseded — recommend close/annotate)
- UT-092/UT-093 LOW (TDD-wavefront drift from v17; cosmetic)
- UT-095 LOW (TDD-wavefront drift, widened to v18; resolvePrincipal unchanged — cosmetic)

*Pre-existing doc-debt (unchanged):*
- DEPLOY.md §1b historical v2 blockquote + §6 scenario JSON config keys.

---

## v17 GATE 8 REVIEW (2026-08-18, superseded by v18 above — kept for history)

> This section supersedes "## v16 GATE 8 REVIEW (2026-08-18)" below (kept for history). Superseded by "## v18 GATE 8 REVIEW (2026-08-18)" above.
> **v17 fix-mode iteration — RFC 7591 Dynamic Client Registration (REQ-012 v17 DCR fix).**
> Impact closure: REQ-012, ARCH-059 "explicitly reject DCR" stance reversed, DES-092/093/095, IMPL-122, IT-078, TASK-091 — iter v17.
> No new gaps, no new broken chains, no arch violations for v17-scoped changes.

### Traceability consistency (v17)

Trace `--check` result (regenerated 2026-08-18): **752 items, 9 gaps.**

Change from v16 baseline (751 items / 6 gaps):

- **1 new item:** TASK-091 added (traces ARCH-059, DES-092, IMPL-122).
- **3 new low iter-drift gaps (TDD wavefront):** UT-092/UT-093/UT-095 paired-UT items sat behind DES/IMPL bumped to v17; 2 of the 5 TDD-wavefront drifts from Gate 5–7 were resolved at Gate 7.5 (VAL-095 bumped to v17 in the validation pass; IT-078 bumped at Gate 7). Remaining 3 are cosmetic — no production code gap.
- **No new broken links, no new orphans, 0 未驗證, 0 未真實驗證, 0 high-severity gaps introduced by v17.**

| ID | Severity | Type | Note |
|----|----------|------|------|
| IMPL-082 | MID | TDD label drift | Pre-existing since v4; no change |
| UT-058 | LOW | iter drift v6 behind DES-038 v11 | Pre-existing since F1; cosmetic |
| UT-064 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| IT-057 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| DES-088 | LOW | iter drift v14 behind IMPL-127 v15 | Pre-existing from v15 open; DES-088 iter unchanged by v17 |
| TASK-018 | LOW | no implementation | OIDC task; functionally superseded by v15+v17 OAuth implementation |
| UT-092 | LOW | iter drift behind DES-093 v17 | New TDD-wavefront drift; cosmetic |
| UT-093 | LOW | iter drift behind DES-093 v17 | New TDD-wavefront drift; cosmetic |
| UT-095 | LOW | iter v16 behind IMPL-122 v17 | New TDD-wavefront drift; resolvePrincipal unchanged in v17 — cosmetic |

Dashboard confirms: 0 severe gaps, 0 未驗證 requirements, 0 mock-only validations. All 9 remaining gaps are recorded as known tech debt (Exit Gate 1 satisfied).

### Architecture consistency (v17 self-check — lean QM fix, no panel)

Fix scope: `src/auth/oauth-metadata.ts`, `src/auth/token-store.ts`, `src/auth/auth-service.ts`, `src/server.ts`, `vitest.config.ts`. Checked against ARCH-059 v17 (the only ARCH decision touched by v17).

**ARCH-059 v17 reversal — DCR implemented:**

Architecture text (ARCH-059 v17): "advertise `registration_endpoint` in `/.well-known/oauth-authorization-server`; implement a public `POST /register` that issues a public PKCE `client_id` (no `client_secret`), clamping requested metadata; enforce RFC 8252 loopback rule on every `redirect_uri` at registration; persist to a GC'd `registered_clients` table; `/authorize` applies port-agnostic binding (scheme+host+path, port ignored per RFC 8252 §7.3) for registered clients; unregistered/absent `client_id` falls through to loopback-only path (backward compatible)."

Implementation checks:

1. **`registration_endpoint` in AS metadata** (`src/auth/oauth-metadata.ts:41`): `registration_endpoint: \`${b}/register\`` added to `buildAuthServerMetadata` return. **Matches.**
2. **`POST /register` public endpoint** (`src/server.ts:1409`): route inside `if (authHandlers)` block at line 1409 after `/token`, no bearer check, calls `authHandlers.register(req, res)`. **Matches ARCH-059 "public endpoint, no bearer."**
3. **Loopback enforcement at registration** (`src/auth/auth-service.ts:304-308`): `redirect_uris` must all pass `isLoopbackRedirectUri`; non-loopback/empty → 400 `invalid_redirect_uri`. **Matches ARCH-059 inv.4 extension to registration.**
4. **Metadata clamping** (`src/auth/auth-service.ts:311-325`): response always `grant_types:["authorization_code"]`, `response_types:["code"]`, `token_endpoint_auth_method:"none"`, no `client_secret` issued. **Matches "public PKCE client_id" and "clamping not rejecting."**
5. **`registered_clients` table + GC** (`src/auth/token-store.ts:59-80, 161-192`): 4th table with `client_id PK`, `redirect_uris TEXT`, `client_id_issued_at`, `expires_at`; `registerClient` uses `this._csprng()` + `this._clock()` (seam-consistent, no raw `randomBytes`/`Date.now`); `gcExpired` extended to delete expired `registered_clients` rows. **Matches DES-093 v17 seam-consistency requirement.**
6. **Port-agnostic binding in `/authorize`** (`src/auth/auth-service.ts:138-156`): `tokenStore.getClient(clientId)` looked up; if registered, compares `req_u.protocol === reg_u.protocol && req_u.hostname === reg_u.hostname && req_u.pathname === reg_u.pathname` (port NOT compared); mismatch → 400 before `putState`. **Matches RFC 8252 §7.3 port-ignored binding.**
7. **Backward compatibility** (`src/auth/auth-service.ts:157-162`): absent/unregistered `client_id` → existing `isLoopbackRedirectUri` check (loopback-only path unchanged). **Matches "backward compatible, keeps pre-DCR callers green."**
8. **No new config keys:** `POST /register` is a public endpoint with no secrets; `registered_clients` table auto-managed. Config file unchanged from v16. **Confirmed by Gate 7.5 config-sync check.**
9. **D-AUTH-1 (opaque bearer, no JWT):** DCR adds only a `client_id` (not a bearer token). No JWT introduced. **Consistent.**
10. **ARCH-063 interaction:** `/register` is inside `if (authHandlers)` (auth-enabled guard), but public (no bearer). The net-guard's `isAllowedHost`/`isAllowedOrigin` still covers this route (all routes go through the top-of-handler guard before the `authHandlers` dispatch). **Consistent — "public" means no bearer, not exempted from net-guard.**

**Verdict for v17-touched code: architecture CONSISTENT with ARCH-059 v17.**

Pre-existing violations (UNCHANGED from v16 review — not re-litigated here):

| Label | Severity | Finding | Status |
|-------|----------|---------|--------|
| H-2 | HIGH | ARCH-017/D-PROFILE/DES-031 session-options-builder orphaned | Gate 2 adjudication pending (security-hardening iter) |
| H-3 | HIGH | D-KILL/D-PROC cli-lifecycle + timeout-race dead code | Gate 2 adjudication pending |
| M-1 | MED | LiteLLMGatewayClient transcript opaque | Pre-existing, separately tracked |
| L-1 | LOW | McpRegistry wall-clock direct Date.now | Pre-existing |
| L-2 | LOW | materializeAssets hook arm not removed | Pre-existing |
| LOW-3 | LOW | client-echoable principal on null-edge path | Pre-existing; restrict to test seam when convenient |
| LOW-4 | LOW | ARCH-059 inv.3 text: state TTL 600 s vs. "≤60 s" | Recommend text amendment to "state ≤10 min / codes ≤60 s" |

**Architecture consistency overall: v17-scoped changes are consistent with ARCH-059 v17. Pre-existing H-2/H-3 remain outstanding on their own adjudication track. No new violations.**

### Validation & handover check (v17)

- **VAL-095 (REQ-012, v17):** `real:true`, green, iter v17. 9/9 acceptance cases pass (5 carry-forward + 4 new DCR cases 7a–7d). Case 7a: `registration_endpoint` present in AS metadata. Case 7b: `registerClient()` SDK call → 201 + `client_id`, no `client_secret`. Case 7c: non-loopback `redirect_uris` → SDK throws (server 400 `invalid_redirect_uri`). Case 7d: full DCR end-to-end (registerClient → authorize port-ignored binding → token → MCP 200).
- **Live curl evidence (Gate 7.5):** POST /register → 201 + `client_id`; `registration_endpoint` present in `/.well-known/oauth-authorization-server`; non-loopback `redirect_uri` → 400; port-ignored `/authorize` → 302; restart survival confirmed (`registered_clients` persists across SIGTERM + restart).
- **IT-078 27/27:** 17 pre-existing + 10 new DCR integration cases, all green, real SQLite + real HTTP.
- **Full suite:** 1342/1342 pass (233 files; 1338 pre-existing zero regression + 4 new acceptance cases 7a–7d).
- **No mock-only/unverified REQ for any v17-touched item.**
- **`08-validation.md`:** present, v17 section written (Gate 7.5 v17 PASSED 2026-08-18 confirmed).
- **`README.md`:** present. Current-state v17 (2026-08-18). Quick-start reflects DCR behavior. No stale commands.
- **`DEPLOY.md`:** present. Current-state v17. §7 変更紀錄 has v17 entry (2026-08-18). No new config keys → §1 設定総表 unchanged. No superseded instructions outside §7.
- **Config key deduplication:** v17 adds no new config keys. §1 設定総表 remains deduplicated and authoritative.
- **Unreachable dep (carry-forward + v17 note):** real Google OAuth browser consent flow requires interactive browser + real Google account; headless-unreachable (classified `unreachable-dep`, not a code gap). Real Claude Code DCR browser flow: original "Incompatible auth server" failure is now closed (proven by VAL-095 cases 7a–7d); the interactive browser-consent step remains headless-unreachable but the SDK-function-level proof (case 7d) exercises the same code path.
- **Validation verdict: Gate 7.5 v17 PASSED. VAL-095 v17 real:true. 1342/1342 pass. README + DEPLOY present, current-state. No mock-only/unverified REQ.**

### Retro (v17 — RFC 7591 DCR fix for REQ-012 real-connect failure)

**What changed (IMPL-122 v17, TASK-091):**

- `src/auth/oauth-metadata.ts`: added `registration_endpoint: \`${b}/register\`` to `buildAuthServerMetadata` return (DES-092 v17).
- `src/auth/token-store.ts`: added 4th table `registered_clients(client_id PK, redirect_uris TEXT, client_id_issued_at, expires_at)`; `registerClient({redirectUris, ttlMs})` using injected clock+CSPRNG (seam-consistent, no `Date.now`/`randomBytes` in module); `getClient(clientId)` returning `null` for expired entries; `gcExpired()` extended to sweep all 4 auth tables (DES-093 v17).
- `src/auth/auth-service.ts`: added `register(req, res)` handler to `AuthRouteHandlers` interface + implementation (JSON body parse; loopback enforcement on all `redirect_uris`; metadata clamping; 201 no `client_secret`); updated `authorize()` to perform port-agnostic binding (scheme+hostname+pathname match, port ignored per RFC 8252 §7.3) for registered clients, with graceful fallback to loopback-only path for unregistered/absent `client_id` (DES-095 v17).
- `src/server.ts`: added `POST /register` dispatch inside `if (authHandlers)` block after `/token` at line 1409.

**What went well:**

- The three key design decisions (port-agnostic binding, clamp-not-reject, weeks-scale bounding with GC) were taken at Gate 3+4 and all held through implementation unchanged — no mid-stream pivots. The pre-advisor review before the decisions crystallized saved a potential 400-loop at Gate 7.5 (exact-match port binding would have broken the live-connect case).
- Determinism-by-construction: `registerClient` obeys the injected-seam rule identically to the 3 pre-existing `registerToken`/`storeAuthCode`/`putState` methods — no special handling needed, and the GC determinism property fell out for free.
- The "clamp-not-reject" stance on metadata (e.g., MCP SDK requesting `refresh_token` grant type) meant zero breakage from client diversity; the 201 response always carries the correct supported-subset regardless of what the client sent.
- IT-078 added 10 new cases RED-first at Gate 5, all flipped GREEN at Gate 6 with zero changes to pre-existing 17 cases — the test-before-impl chain guard worked exactly as intended for a surgical fix.

**What to change:**

- **composeConfig snapshot test is 2-for-2 overdue** (named at v16 retro; carry-forward). A snapshot pinning every `fileConfig` key against `ServerConfig` would catch the two silent-drop bugs from v15+v16 before Gate 7.5. This MUST be built before the next config-adding iteration.
- **TASK-018** (OIDC task): functionally superseded by v15+v17 implementation; close or annotate as superseded in 03-tasks.md to remove the persistent LOW trace gap.
- **LOW-4 ARCH-059 text (state TTL):** amend "≤60 s" to "state ≤10 min / codes ≤60 s" to match the 600 s implementation. No code change required.

**Impact closure:**

- **Real-connect failure ("Incompatible auth server: does not support dynamic client registration"):** CLOSED. `registration_endpoint` advertised in AS metadata; `POST /register` issues public PKCE `client_id`; a spec-only MCP client (Claude Code / `@modelcontextprotocol/sdk`) with no pre-registered `client_id` can now complete the OAuth flow. SDK-function-level proof in VAL-095 cases 7b/7d.
- **REQ-012 DCR acceptance clause:** CLOSED. VAL-095 v17 real:true, 9/9, including live curl and restart survival.
- **ARCH-059 "explicitly reject DCR" stance:** REVERSED in place (v17 amendment). The prior stance was wrong for a spec-only MCP client; the architecture now correctly implements DCR as the real-connect path.

**Known tech debt (all recorded, unchanged from v16 except as noted):**

*Newly closed by v17:*
- [N/A] ARCH-059 "reject DCR" stance — REVERSED/CLOSED (was never a bug record, was the prior arch decision)

*Carry forward — Gate 2 adjudication pending:*
- [HIGH] H-2: ARCH-017/D-PROFILE/DES-031 builder cluster unwired
- [HIGH] H-3: D-KILL/D-PROC cli-lifecycle + timeout-race orphaned

*Carry forward — lower urgency:*
- [MED] M-1: LiteLLMGatewayClient transcript opaque
- [LOW] LOW-3: client-echoable principal on null-edge path
- [LOW] LOW-4: ARCH-059 inv.3 text: amend state TTL bound
- [LOW] L-1: McpRegistry wall-clock direct Date.now
- [LOW] L-2: ARCH-018 hooks-drop live branch in materializeAssets

*Action items (carry-forward from v16 + no new):*
- [LOW] composeConfig snapshot test — 3 iterations now, same bug class; must be built before next config-adding iteration.

*Trace gaps (all recorded):*
- IMPL-082 MID (TDD-label, pre-existing since v4)
- DES-088 LOW (iter drift v14 behind IMPL-127 v15 — fix: bump DES-088 iter)
- UT-058/UT-064/IT-057 LOW (iter drifts, pre-existing cosmetic)
- TASK-018 LOW (OIDC task, functionally superseded by v15+v17 — recommend close/annotate)
- UT-092/UT-093/UT-095 LOW (TDD-wavefront drift from v17; cosmetic — resolvePrincipal / token-store methods unchanged)

*Pre-existing doc-debt (unchanged):*
- DEPLOY.md §1b historical v2 blockquote + §6 scenario JSON config keys.

---

## v16 GATE 8 REVIEW (2026-08-18, superseded by v17 above — kept for history)

> This section supersedes "## v15 GATE 8 REVIEW (2026-08-18)" below (kept for history).
> **v16 fix-mode iteration — ARCH-059 inv.4 open-redirect (HIGH-1) + gcExpired unscheduled (MED-2) + composeConfig workspaceTtlMs forwarding fix.**
> Both v15 Gate-8 blocking violations are fixed and verified real-tier. No new gaps, no new drift, no new arch violations.

### Traceability consistency (v16)

Trace `--check` result (regenerated 2026-08-18): **751 items, 6 gaps.**

Change from v15 baseline (750 items / 6 gaps):

- **1 new item:** TASK-090 added (traces ARCH-059, closes the TASK-090 未實作 gap introduced at Gate 3+4 v16).
- **3 iter-drift gaps resolved:** UT-093, UT-095 bumped to v16 (matching DES-093/DES-095 v16 bump), plus one more drift resolved at Gate 7.5 — trace went from 751/9 (Gate 7) to 751/6 (Gate 7.5).
- **No new gaps opened by v16.**

| ID | Severity | Type | Note |
|----|----------|------|------|
| IMPL-082 | MID | TDD label drift | Pre-existing since v4; no change |
| UT-058 | LOW | iter drift v6 behind DES-038 v11 | Pre-existing since F1; cosmetic |
| UT-064 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| IT-057 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| DES-088 | LOW | iter drift v14 behind IMPL-127 v15 | Opened at v15; cosmetic; DES-088 iter unchanged by v16 |
| TASK-018 | LOW | no implementation | OIDC task; functionally superseded by v15+v16 OAuth implementation |

Dashboard confirms: 0 severe gaps, 0 未驗證 requirements, 0 mock-only validations. All 6 remaining gaps are recorded as known tech debt (Exit Gate 1 satisfied).

### Architecture consistency (v16 self-check — lean QM fix, no panel)

Fix scope: `src/auth/auth-service.ts`, `src/server.ts`, `src/main.ts`, `vitest.config.ts`. Checked against ARCH-059 (the only ARCH touched by v16).

**HIGH-1 fix — ARCH-059 inv.4 (loopback-only redirect_uri):**

Architecture text: "`/authorize` validates the `redirect_uri` is an RFC 8252 loopback URI … BEFORE storing any `oauth_state` and BEFORE redirecting to Google — a non-loopback / missing / unparseable `redirect_uri` is refused 400 `invalid_request` with no state row written."

Implementation (`src/auth/auth-service.ts:30-40, 132-140`): `isLoopbackRedirectUri(uri)` — `http:` scheme, hostname ∈ {`127.0.0.1`, `localhost`, `[::1]`}, any port, try/catch→false. Called at `authorize()` BEFORE `tokenStore.putState()` and BEFORE building the Google redirect. Non-loopback → `400 {error:"invalid_request"}`, no state row. Handles WHATWG IPv6 bracket serialization (`[::1]`) correctly per named UT. `https://127.0.0.1` correctly rejected (`http:` scheme required). **Matches ARCH-059 inv.4 exactly.** Confirmed by live curl (8 cases) and IT-078 cases 8a-9c (VAL-095 v16).

**MED-2 fix — ARCH-059 note (gcExpired in sweep):**

Architecture text: "`gcExpired` is called each tick of the REQ-026 periodic maintenance sweep (try/catch→log+continue, never throws into the scheduler); to guarantee bounded auth tables even in the auth-enabled / no-workspace-TTL config, the sweep interval is created when `workspaceTtlMs>0` OR auth is enabled."

Implementation (`src/server.ts:1273-1296`): `const _gcTtl = config?.workspaceTtlMs ?? 0; if (_gcTtl > 0 || authCfg) { … authTokenStore?.gcExpired() … }` — sweep created under the OR condition; `gcExpired()` called first in each tick with its own try/catch; `reclaimStaleWorkspaces` runs only when `_gcTtl>0`; interval = `Math.min(ttl, hourly)` when TTL set, `hourly` otherwise. **Matches ARCH-059 note exactly.** Confirmed by IT-078 case 10 (real SQLite) and cross-process live confirmation (3 expired rows deleted within 2 s at 500 ms interval).

**composeConfig workspaceTtlMs forwarding (`src/main.ts:153-158`):**

No dedicated ARCH item; this is the composition-root wiring fix preventing `_gcTtl=0` in production. Follows the identical forwarding pattern as the v15 `auth:` forwarding fix. Correct.

**vitest.config.ts `sequence: { hooks: 'stack' }`:**

Test tooling only; no ARCH item.

**Verdict for v16-touched code: architecture CONSISTENT.**

Pre-existing violations (UNCHANGED from v15 review — not re-litigated here, all previously recorded):

| Label | Severity | Finding | Status |
|-------|----------|---------|--------|
| H-2 | HIGH | ARCH-017/D-PROFILE/DES-031 session-options-builder orphaned | Gate 2 adjudication pending (security-hardening iter) |
| H-3 | HIGH | D-KILL/D-PROC cli-lifecycle + timeout-race dead code | Gate 2 adjudication pending |
| M-1 | MED | LiteLLMGatewayClient transcript opaque | Pre-existing, separately tracked |
| L-1 | LOW | McpRegistry wall-clock direct Date.now | Pre-existing |
| L-2 | LOW | materializeAssets hook arm not removed | Pre-existing |
| LOW-3 | LOW | client-echoable principal on null-edge path | Pre-existing; restrict to test seam when convenient |
| LOW-4 | LOW | ARCH-059 inv.3 text: state TTL 600 s vs. "≤60 s" | Recommend text amendment to "state ≤10 min / codes ≤60 s" |

These all carry the operator's standing decision (memory: arch-debt-unwired-security-modules = separate security-hardening iteration). HIGH-1 and MED-2 from v15 are CLOSED by this fix.

**Architecture consistency overall: v16-scoped changes are consistent with ARCH-059. Pre-existing H-2/H-3 remain outstanding on their own adjudication track.**

### Validation & handover check (v16)

- **VAL-095 (REQ-012, v16):** `real:true`, green, iter v16. 8 live-server curl tests (HIGH-1: evil.example/https-scheme/garbage/empty/missing → 400, no state row; loopback 127.0.0.1/localhost/[::1] → 302). IT-078 17/17 (7 v16 new + 10 pre-existing). IT-079 4/4 (regression). Cross-process GC: 3 expired oauth_state rows deleted within 2 s at 500 ms interval (MED-2 confirmed real).
- **composeConfig fix (same VAL-095 session):** `workspaceTtlMs: fileConfig.workspaceTtlMs` forwarded; `_gcTtl` now non-zero in production when configured. 1328/1328 pass unchanged after fix.
- **All prior REQs (001..089):** VAL-001..094 hold evidence from prior rounds; 1328/1328 regression pass.
- **No mock-only/unverified REQ for any touched item.**
- **`08-validation.md`:** present, v16 section written (lines 4225–4360), Gate 7.5 v16 PASSED 2026-08-18 confirmed.
- **`README.md`:** present. Current-state v16 (2026-08-18). Quickstart reflects v16 behavior. No stale commands.
- **`DEPLOY.md`:** present. Current-state v16. §7 変更紀錄 has v16 entry (2026-08-18). `workspaceTtlMs` key in §1 設定総表 (single canonical source; no duplicate). No superseded instructions outside §7.
- **Config key deduplication:** `workspaceTtlMs` documented in §1 設定総表; referenced by name in §7. No duplication.
- **Validation verdict: Gate 7.5 v16 PASSED. VAL-095 v16 real:true. 1328/1328 pass. README + DEPLOY present, current-state. No mock-only/unverified REQ.**

### Retro (v16 — ARCH-059 inv.4 + gcExpired + composeConfig workspaceTtlMs fix)

**What changed (IMPL-122 v16, TASK-090):**

- `src/auth/auth-service.ts`: added `isLoopbackRedirectUri(uri): boolean` (pure export, lines 24-40). Called in `authorize()` BEFORE `tokenStore.putState()` — non-loopback/missing/unparseable `redirect_uri` → 400, no state row. Handles WHATWG IPv6 bracket serialization. Relative-URI fallback in `googleCallback` is now unreachable; flagged in code comment but intentionally not removed per DES-095 v16 (surgical fix).
- `src/server.ts`: REQ-026 sweep block moved after `authTokenStore` init (necessary for the condition change); interval-creation condition widened to `(_gcTtl > 0 || authCfg)`; `authTokenStore?.gcExpired()` called first in each tick (own try/catch, never throws into scheduler); `reclaimStaleWorkspaces` only when `_gcTtl > 0`. Auth-only/no-TTL config now bounds auth tables hourly.
- `src/main.ts`: `workspaceTtlMs: fileConfig.workspaceTtlMs` added to `composeConfig()` (lines 153-158). Prevents `_gcTtl=0` in production, ensuring GC runs at the configured interval rather than hourly.
- `vitest.config.ts`: `sequence: { hooks: 'stack' }` — fixes Vitest v1.6.1 parallel-hooks race (test tooling only, no production impact).

**What went well:**

- Gate 7.5 live test caught the `workspaceTtlMs` composition-root gap before the iteration closed — the same safety-net that caught the `auth:` forwarding gap in v15. Real validation found a real production bug.
- The fix is minimal: 3 files, 2 behavioral changes, zero ARCH expansion (the OR-condition widening of the sweep interval is the boldest change, and ARCH-059 named it).
- IT-078 test-first coverage (7 new RED cases at Gate 5, all GREEN at Gate 7) gave precise pass/fail feedback for the fix — the cases 8a-9c provided both failure modes and regression guards in a single test file.

**What to change:**

- **composeConfig snapshot test is now 2-for-2 overdue.** The same bug class (a config key silently dropped from `composeConfig()`) has occurred in consecutive iterations (`auth:` in v15, `workspaceTtlMs` in v16), and the v15 retro already named the fix: a snapshot test pinning every key present in `fileConfig` against `ServerConfig`. This MUST be built before the next config-adding iteration, not after. File as LOW tech debt targeted at the next gate-5 pass for any config-adding iteration.
- **LOW-4 ARCH-059 text fix (state TTL):** amend "≤60 s" to "state ≤10 min / codes ≤60 s" to match the 600 s implementation. No code change required.
- **TASK-018** (OIDC task, functionally superseded): close or annotate as superseded in 03-tasks.md to remove the 未實作 trace gap.

**Impact closure:**

- HIGH-1 (ARCH-059 inv.4 open-redirect → bearer theft): CLOSED. `isLoopbackRedirectUri()` enforced before `putState`. Attack surface: attacker-supplied `redirect_uri` can no longer receive an engine auth-code.
- MED-2 (ARCH-059 gcExpired unscheduled → unbounded auth tables): CLOSED. `gcExpired()` wired into REQ-026 sweep; sweep created for auth-enabled configs. Auth table rows now expire and are reclaimed.
- composeConfig workspaceTtlMs forwarding: CLOSED. Production `_gcTtl` now reflects the configured value; GC fires at the configured interval, not hourly.

**Known tech debt (all recorded, unchanged from v15 except as noted):**

*Closed by v16:*
- [HIGH] HIGH-1: ARCH-059 inv.4 redirect_uri not validated — CLOSED
- [MED] MED-2: ARCH-059 gcExpired never scheduled — CLOSED

*Carry forward — Gate 2 adjudication pending:*
- [HIGH] H-2: ARCH-017/D-PROFILE/DES-031 builder cluster unwired
- [HIGH] H-3: D-KILL/D-PROC cli-lifecycle + timeout-race orphaned

*Carry forward — lower urgency:*
- [MED] M-1: LiteLLMGatewayClient transcript opaque
- [LOW] LOW-3: client-echoable principal on null-edge path
- [LOW] LOW-4: ARCH-059 inv.3 text: amend state TTL bound
- [LOW] L-1: McpRegistry wall-clock direct Date.now
- [LOW] L-2: ARCH-018 hooks-drop live branch in materializeAssets

*Newly identified action items:*
- [LOW] composeConfig snapshot test — 2-for-2 same bug class; must be built before next config-adding iteration.

*Trace gaps (all recorded):*
- IMPL-082 MID (TDD-label, pre-existing since v4)
- DES-088 LOW (iter drift v14 behind IMPL-127 v15 — fix: bump DES-088 iter)
- UT-058/UT-064/IT-057 LOW (iter drifts, pre-existing cosmetic)
- TASK-018 LOW (OIDC task, functionally superseded by v15+v16 — recommend close/annotate)

*Pre-existing doc-debt (unchanged):*
- DEPLOY.md §1b historical v2 blockquote + §6 scenario JSON config keys.

---

## v15 GATE 8 REVIEW (2026-08-18, superseded by v16 above — kept for history)

> This section supersedes "## v14 GATE 8 REVIEW (2026-08-16)" below (kept for history).
> **v15 Slice B — OAuth AS + per-caller principal + workflow ownership + harness-defaults + D-BIND fail-closed**
> (REQ-012 + REQ-086..089). Gate 7.5 v15 PASSED 2026-08-18 (composition-root fix applied first;
> VAL-095..099 real:true; 1316/1316 pass). Panel architects pre-ran (not re-spawned): adversarial group
> (ARCH-059..063 / IMPL-122..128 scope) + quality-dimensions group (v14+v15 scope) reports are in
> `.panel/review/`. This section consolidates them; `.panel/` is removed at end of Gate 8.
>
> **Conclusion: SEND BACK TO GATE 6** — adversarial HIGH-1 (redirect_uri not validated, ARCH-059 inv.4)
> is a fresh HIGH violation in the iteration's own newly-shipped auth code; the fix is one `if` at
> `auth-service.ts:authorize`. MEDIUM-2 (gcExpired unscheduled, ARCH-059 note) is a one-line call into
> the existing sweep. These are not pre-existing built-but-unwired debt; they are the ARCH-059 slice's
> own stated invariants not enforced. Pre-existing H-2/H-3 carry the standing "security-hardening
> iteration" umbrella (Gate 2 adjudication pending); HIGH-1 and MEDIUM-2 do not.

### Traceability consistency (v15)

Trace `--check` result (regenerated 2026-08-18): **750 items, 6 gaps.**

Change from v14 baseline (704 items / 6 gaps):
- **CLOSED:** REQ-012 HIGH 未真實驗証 gap — v15 implemented OAuth AS (ARCH-059..063 / IMPL-122..128)
  and VAL-095 is now `real:true`; REQ-012 is no longer unvalidated.
- **OPENED:** DES-088 LOW drift — DES-088 design is at iter v14, while IMPL-127 (which traces to it) is
  at iter v15. Cosmetic iter mismatch introduced when v15 updated the `workflow_agent_log` TOOL_DEF
  description (‹secret:NAME› marker documentation) without bumping DES-088 to v15. Fix: bump DES-088
  iter to v15 or add a v15 note. Does not affect functionality.
- **Net:** 46 new items (750−704), same gap count (6). The v15 Gate 7.5 state.yaml recorded 750/11 during
  Gate 7 (when 5 v15 gaps — REQ-086..089 × {未實作+未驗證} — were still open); those 5 closed when
  VAL-095..099 flipped real:true, restoring the count to 6.

| ID | Severity | Type | Note |
|----|----------|------|------|
| IMPL-082 | MID | TDD label | Pre-existing since v4; no change |
| UT-058 | LOW | iter drift v6 behind DES-038 v11 | Pre-existing since F1; cosmetic |
| UT-064 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| IT-057 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| DES-088 | LOW | iter drift v14 behind IMPL-127 v15 | **NEW (v15)** — bump DES-088 iter to fix |
| TASK-018 | LOW | no implementation | OIDC task, superseded by v15 OAuth; defer or close |

All remaining gaps recorded as known tech debt (Exit Gate 1 satisfied). DES-088 is the only new drift;
it is LOW cosmetic and does not affect correctness.

### Architecture consistency (v15 panel consolidation)

Two expert groups pre-ran (see `.panel/review/adversarial.md` and `.panel/review/quality-dimensions.md`).

**Overall verdict: NOT consistent — new HIGH violation in v15 auth code requires Gate 6 fix.**

#### Changes since v14 Gate 8

**FIXED by v15 — previously H-1 [HIGH] D-BIND bind guard unimplemented:**
ARCH-063 (TASK-089 / IMPL-128) implemented the D-BIND fail-closed guard. Adversarial confirms D-AUTH-3
(`isLoopbackPeer`) holds: non-loopback without bearer → 401; loopback always exempt; forwarded headers
strip the exemption. VAL-099 real-validated. **This finding is CLOSED.**

**Adversarial panel new findings (v15 auth scope — ARCH-059..063 / IMPL-122..128):**

#### HIGH-1 [HIGH] ARCH-059 invariant 4 violated: redirect_uri not validated (open redirect → bearer theft)

**Violates:** ARCH-059 load-bearing invariant (4): loopback redirect URIs per RFC 8252 (no open-redirect).

**Evidence:**
- `src/auth/auth-service.ts:104-115` (`authorize`) — reads `redirect_uri` from the query and stores it
  verbatim via `tokenStore.putState(...)`. No loopback / host / allowlist check.
- `src/auth/auth-service.ts:177-189` (`googleCallback`) — after Google auth succeeds, 302-redirects
  the browser to the unvalidated `redirect_uri` carrying `?code=<engine auth-code>`.
- `src/auth/auth-service.ts:221-223` (`tokenExchange`) — only checks equality to the stored value;
  the stored value is itself attacker-supplied. No `loopback|127|localhost|allow|valid` predicate anywhere.

**Failure scenario:** Attacker crafts a link with `redirect_uri=https://evil.example`. Victim completes
Google consent as themselves. Engine mints an auth-code for victim's principal, redirects to
`https://evil.example?code=…`. Attacker holds the PKCE verifier, exchanges the code at `/token`, receives
a valid engine bearer for victim. Full impersonation on every protected surface.

**Fix direction:** in `authorize`, reject any `redirect_uri` whose host is not `127.0.0.1`/`::1`/`localhost`
(reuse the `net-guard` loopback predicate) before `putState`. One `if` fail-closed.

**Action: Gate 6 fix.**

#### MED-2 [MED] ARCH-059 note violated: gcExpired() defined but never scheduled (unbounded auth-table growth)

**Violates:** ARCH-059 note: "`gcExpired` reuses the existing workspace-TTL GC cadence (no new scheduler)."

**Evidence:** `src/auth/token-store.ts:155` defines `gcExpired()`. No caller exists anywhere in `src/`.
The workspace GC sweep at `server.ts:1256-1270` (`reclaimStaleWorkspaces`) does NOT invoke
`authTokenStore.gcExpired()`. Abandoned `oauth_state` rows, unexchanged `auth_codes`, and expired
`bearer_token` rows grow without bound.

**Fix direction:** one line — call `authTokenStore.gcExpired()` inside the existing `sweep` at
`server.ts:1264`, piggybacking the cadence ARCH-059 named.

**Action: Gate 6 fix (one-line addition).**

#### LOW-3 [LOW] D-AUTH-2 spirit: caller-echoable principal on null-edge path

**Tension with:** D-AUTH-2 (principal resolved at the edge, never echoed from client).

**Evidence:** `server.ts:786-793` (`callTool`, `workflow_register`/`workflow_deregister`): when edge
principal is null (loopback-exempt or auth-disabled), `args.principal` becomes the ownership value.
`mcp-facade.ts:89` similarly forwards caller-supplied `principal` on the null-edge path.

**Assessment:** Scoped to already-trusted callers (authenticated remote callers cannot exploit it —
`p.principal` is non-null and wins); documented as a test affordance (IMPL-124/IT-080). LOW. Consider
removing or restricting to a test seam to be consistent with the `/assets/*` pattern (which explicitly
refuses client echo).

#### LOW-4 [LOW] ARCH-059 inv.3 literal deviation: oauth_state TTL is 600 s, not ≤60 s

**Evidence:** `token-store.ts:128` sets `oauth_state.expires_at = now + 600_000` (10 min). `auth_codes`
at line 90 correctly use `now + 60_000`.

**Assessment:** Single-use and atomic-consume (the security-critical properties the invariant exists for)
HOLD. Only the numeric TTL exceeds the stated bound, and 60 s is impractical for interactive Google
consent. **Recommended action:** amend ARCH-059 text to "state ≤10 min / codes ≤60 s" rather than
tightening the impl. LOW.

#### Pre-existing violations carried from v14 (Quality-Dimensions confirmation)

Quality-dimensions panel scoped to v14+v15 (IMPL-117..128). Its findings cross-reference the v14 catalog:

| Label | Severity | Panel finding | v14 catalog label |
|-------|----------|---------------|-------------------|
| H-2 | HIGH | R-1 (ProviderProfile / session-options-builder orphaned) | H-2: ARCH-017/D-PROFILE/DES-031 |
| H-3 | HIGH | O-2 + S-2 (FailureEnvelope not emitted; timeout-race dead code) | H-3: D-KILL/D-PROC cluster |
| M-1 | MED | (LiteLLMGatewayClient transcript opaque — quality O-2 scope) | M-1: ARCH-004 LiteLLM gap |
| L-1 | LOW | (McpRegistry wall-clock direct Date.now) | L-1: C3 seam gap |
| L-2 | LOW | (materializeAssets hook arm not removed) | L-2: ARCH-018 defense-in-depth |
| —   | ACK | R-2 (CasStore no port, D-v14-F), C-2 (seedManifest handshake) | Acknowledged deferred debt |
| —   | ACK | S-1 (no disk-full guard, G-SUS-3 deferred), C-1 (allowedTools) | Pre-existing quality gaps |

**O-1 (SessionInitRecord) — re-apply ARCH-044 supersession:** Quality panel re-raised O-1 but without
the ARCH-044 context. ARCH-044 explicitly superseded the SessionInitRecord contract, replacing it with
`HarnessDescriptor` (wired end-to-end, confirmed by adversarial). **Not a violation.** Residual:
`thinkingMode` not in `HarnessDescriptor`, deliberate per ARCH-044 scope, LOW observability debt.

All pre-existing violations carry the operator's standing decision (memory: arch-debt-unwired-security-modules
= a separate security-hardening iteration). H-2 and H-3 require Gate 2 adjudication (wire or formally
supersede following ARCH-044 precedent).

**Architecture consistency conclusion: no.** Fresh HIGH (HIGH-1) and MED (MED-2) in v15's own auth code;
pre-existing H-2, H-3, M-1, L-1, L-2 (all pre-existing, separately tracked). Gate 6 fix required for
HIGH-1 and MED-2 before this iteration closes. Gate 2 adjudication pending for H-2/H-3 (separate
security-hardening iteration).

### Validation & handover check (v15)

- **VAL-095 (REQ-012):** `real:true`, green — SDK-driven OAuth discovery: PRM → AS metadata chain;
  full PKCE auth-code flow via fake RS256 IdP; bearer-authenticated POST /mcp returns 200; unauthenticated
  → 401 with WWW-Authenticate; auth-disabled server returns 200 (backward-compat). 5/5 pass.
- **VAL-096 (REQ-086):** `real:true`, green — per-caller principal: /mcp/assets without bearer → 401;
  bearer-authed workflow_run carries `principal:'alice@example.com'` in run record; CAS namespace
  attributed to principal. 5/5 pass.
- **VAL-097 (REQ-087):** `real:true`, green — workflow ownership gate: creator-only mutation; backfill
  NULL-owner → `hsuhungjung@gmail.com` on first auth-enabled boot; `NOT_WORKFLOW_OWNER` on mismatch.
  8/8 pass.
- **VAL-098 (REQ-088):** `real:true`, green — harness defaults bound at registration; per-param merge
  at run time; HARNESS_DEFAULTS_INVALID on invalid values. 6/6 pass.
- **VAL-099 (REQ-089):** `real:true`, green — D-BIND fail-closed: LAN-IP → 401; loopback exempt;
  webhook HMAC path unaffected; auth-disabled → not 401 (backward-compat). 4/4 pass.
- **Google interactive consent flow:** classified `unreachable-dep` (headless-unreachable; same precedent
  as v11 Playwright); fake RS256 IdP validates all engine-side auth routes with full HTTP. Not mock-only.
- **All prior REQs (001..089):** VAL-001..094 hold evidence from prior rounds; 1316/1316 regression pass.
  REQ-012 gap is NOW CLOSED (VAL-095 real:true). TASK-018 (OIDC task) is functionally superseded by the
  v15 OAuth implementation; recommend closing.
- **`08-validation.md`:** present, v15 section written, Gate 7.5 v15 PASSED 2026-08-18 confirmed.
- **`README.md`:** present at repo root. Current-state (v15, 2026-08-18). Step-by-step quickstart.
  OAuth auth documented as opt-in (v15 section). No stale commands or superseded content.
- **`DEPLOY.md`:** present at repo root. Current-state (v15, 2026-08-18). §7 変更紀錄 includes v15 entry
  (2026-08-18). Three new `auth.*` config keys in §1 設定総表 v15 block, with full descriptions +
  defaults. v15 rwe.config.example.json `auth` block present. No superseded current-state instructions
  outside §7.
- **Config key deduplication:** `設定総表` (§1 DEPLOY.md) is the single canonical source for `auth.enabled`/
  `auth.googleClientId`/`auth.googleClientSecret`. §7 変更紀錄 references them by name (correct). No
  duplication across sections.
- **Pre-existing doc-debt (LOW, unchanged from v14):** DEPLOY.md §1b historical v2 blockquote (inline
  supersession marker); §6 scenario JSON blocks carry config key examples. Risk low. Carry forward.
- **Validation verdict:** Gate 7.5 v15 PASSED. VAL-095..099 real:true. 1316/1316 pass. README + DEPLOY
  present, step-by-step, current-state. 設定総表 deduplicated. No mock-only/unverified REQ.
  **HIGH-1 and MED-2 require Gate 6 fix before final closure; no Gate 7.5 send-back on validation itself.**

### Retro (v15 — OAuth AS + per-caller principal + ownership + harness-defaults + D-BIND)

**What changed (ARCH-059..063 / IMPL-122..128):**
- IMPL-122 `auth-service.ts` — OAuth AS: authorization-code + PKCE S256; Google IdP (injected
  `jwksFetch`/`googleBase`); engine-issued opaque bearer (sha256-at-rest, 32-CSPRNG-byte, no JWT);
  `/.well-known/oauth-protected-resource` + `/.well-known/oauth-authorization-server` endpoints.
- IMPL-123 `token-store.ts` — three-table SQLite auth store (oauth_state, auth_codes, bearer_tokens);
  injected clock + csprng + db; `gcExpired()` defined (wiring gap = MED-2 above).
- IMPL-124 `google-verifier.ts` — RS256 JWKS verify; pins `alg`/`iss`/`aud`/`exp`/`email_verified`.
- IMPL-125 `oauth-metadata.ts` — pure PRM + AS metadata builders.
- IMPL-126 `net-guard.ts` + `src/harness-defaults.ts` + `src/workflow-catalog.ts` — `isLoopbackPeer`
  (loopback exemption for D-BIND); `validateHarnessDefaults` + `resolveHarnessParams`; ownership gate.
- IMPL-127 `mcp-facade.ts` + `server.ts` (auth wiring, 1276-1503) — `resolvePrincipal` edge resolver;
  auth routes wired in server; `workflow_agent_log` TOOL_DEF updated (traces DES-088, iter v15 →
  creates DES-088 LOW drift since DES-088 iter is v14).
- IMPL-128 `src/main.ts` composition-root fix (`auth: fileConfig.auth` forwarded) — the composition-root
  gap caught at Gate 7.5 (`composeConfig` silently dropped the `auth` block; live test showed /mcp
  returned 200 without bearer even with `auth.enabled:true`; 1-line fix, then curl 200→401 confirmed).

**What went well:**
- D-AUTH-1..6 all confirmed HELD by adversarial panel — the security invariants that *were* wired are
  correctly wired (sha256-at-rest, no JWT forgery surface, principal never enters sandbox, D-BIND loopback
  guard, harness-defaults fail-closed, auth-disabled idempotent backfill).
- Gate 7.5 caught the composition-root gap (IMPL gap, not doc-only) before it left the iteration —
  the "seam-wired-in-tests-but-not-in-production" pattern surfaced via a live curl, not just the test suite.
- REQ-012 is now CLOSED (VAL-095 real:true) after being the iteration's sole HIGH trace gap for 14 iterations.
- v14 H-1 (D-BIND bind guard) is now FIXED — one pre-existing HIGH eliminated.

**What to change:**
- **Composition-root config-forwarding drift-lock:** the `composeConfig` function has dropped config keys
  twice (first `auth`, and the pattern is documented as the recurring bug class in the code itself).
  Add a `composeConfig` snapshot test pinning each key present in `fileConfig` against `ServerConfig`
  to catch the next dropped key at Gate 7 (not Gate 7.5).
- **`redirect_uri` allowlist must be written before closure (HIGH-1):** a one-`if` loopback check in
  `authorize()` before `putState`. The ARCH-059 invariant was explicit; this is the fastest Gate 6
  round-trip possible.
- **gcExpired wiring must be done before closure (MED-2):** one line in the existing sweep.
- **DES-088 iter bump:** bump DES-088's `iter` field to v15 to close the trace drift.

**Known tech debt (all recorded):**

*New for v15 — require Gate 6 fix before this iteration closes:*
- [HIGH] HIGH-1: ARCH-059 inv.4 redirect_uri not validated — one `if` in `authorize()`.
- [MED] MED-2: ARCH-059 gcExpired never scheduled — one `gcExpired()` call in the existing sweep.

*Newly downgraded to LOW (no longer a security gap, pending ARCH-text fix):*
- [LOW] LOW-4: ARCH-059 inv.3 text: amend to "state ≤10 min / codes ≤60 s" (impl is defensible; text wrong).

*Pre-existing, Gate 2 adjudication pending:*
- [HIGH] H-2: ARCH-017/D-PROFILE/DES-031 builder cluster unwired — wire or formally supersede (ARCH-044 precedent).
- [HIGH] H-3: D-KILL/D-PROC cli-lifecycle + timeout-race orphaned — wire or formally supersede.

*Pre-existing, Gate 6 fix (lower urgency — no new data in v15):*
- [MED] M-1: LiteLLMGatewayClient transcript opaque.
- [LOW] LOW-3: client-echoable principal on null-edge path (restrict/remove args.principal fallback).
- [LOW] L-1: McpRegistry wall-clock direct Date.now.
- [LOW] L-2: ARCH-018 hooks-drop live branch in materializeAssets (delete hook arm).

*Acknowledged deferred quality debt (no committed resolution path):*
- S-1: No disk-full defense on CAS blob writes / journal appends (G-SUS-3 deferred).
- C-1: allowedTools absent from AgentOpts interface.
- R-2: CasStore no port (acknowledged D-v14-F).
- C-2: seedManifest handshake not inline in workflow_run description.

*Trace gaps (all recorded):*
- IMPL-082 MID (TDD-label, pre-existing since v4)
- DES-088 LOW (iter drift v14 behind IMPL-127 v15 — fix: bump DES-088 iter)
- UT-058/UT-064/IT-057 LOW (iter drifts, pre-existing cosmetic)
- TASK-018 LOW (OIDC task, functionally superseded by v15 OAuth — recommend closing)

*Pre-existing doc-debt (unchanged):*
- DEPLOY.md §1b historical v2 blockquote (inline supersession marker) + §6 scenario JSON config keys.

**Gate 7.5:** PASSED 2026-08-18 (composition-root fix applied first). VAL-095..099 `real:true`.
1316/1316 regression pass.
**Gate 8 conclusion: SEND BACK TO GATE 6** — HIGH-1 (redirect_uri) and MED-2 (gcExpired) are the
blocking findings. Both are one-`if`/one-line fixes in the v15 auth code. All other findings are either
pre-existing recorded debt or LOW/cosmetic.

---

## v14 GATE 8 REVIEW (2026-08-16, superseded by v15 above — kept for history)

> This section supersedes "## v12 GATE 8 REVIEW (2026-08-15)" below (kept for history).
> This round closes the v13 + v14 chain together (v13 never ran a standalone Gate 8): **v13 —
> engine-pull seedRef** (REQ-080); **v14 — streaming blob + manifest ref + redact-at-capture +
> schema honesty + scriptSha256** (REQ-081..085). Gate 7.5 ran two rounds: ROUND 1 found the
> REQ-083 key.prompt structural gap (JournalEntry.key.prompt not redacted); ROUND 2 confirmed the
> fix (live Ollama run 8cdbed02, qwen2.5:7b). All six pre-existing trace gaps remain — none
> introduced or closed by this round (REQ-083 gap was a Gate 7.5 implementation finding, not a
> trace-tool gap; VAL-092 flipped to green/pass after fix).
>
> **Panel architects pre-ran (not re-spawned):** adversarial group + quality-dimensions group
> reports are in `.panel/review/`. This section consolidates them; `.panel/` is removed at end of Gate 8.

### Traceability consistency (v14)

Trace `--check` result (regenerated 2026-08-16): **704 items, 6 gaps — ZERO new gaps from v13/v14.**
The v13/v14 chain (REQ-080..085) is fully closed: REQ→ARCH→TASK→DES→IMPL→UT/IT/VAL with
VAL-089..094 all `real:true`. Gap breakdown (all pre-existing; first recorded in v12 Gate 8):

| ID | Severity | Type | Note |
|----|----------|------|------|
| REQ-012 | HIGH | 未真實驗證 | OIDC deferred by user decision D5; pre-existing known tech debt; not a Gate 7.5 send-back |
| IMPL-082 | MID | TDD label gap | Pre-existing since v4 |
| UT-058 | LOW | iter drift v6 behind DES-038 v11 | Pre-existing since F1; underlying ops covered; cosmetic lag only |
| UT-064 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| IT-057 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| TASK-018 | LOW | no implementation | OIDC task, deferred D5 |

All 6 are pre-existing; none introduced by v13/v14. Every remaining gap is recorded here as known tech debt (Exit Gate 1 satisfied).

Iter drift check on the v14 chain: IMPL-117..121 at iter v14; DES-086..091 at iter v14; VAL-089..094 at iter v14; ARCH-054..058 at iter v14. No new drift introduced.

### Architecture consistency (v14 panel consolidation)

Two expert groups pre-ran against the v14 codebase (both read `02-architecture.md` ARCH/INV/rationale,
`06-impl-log.md`, and the files on each IMPL `files:` for the v3 scope — IMPL-068..080 + surrounding
wiring — which is the standing v3 built-but-unwired control set the panels track; v14-scope IMPL-117..121
is grounded below separately). Their findings are consolidated here.

**Verdict: NOT consistent. 3 HIGH + 1 MED + 3 LOW violations.**

**Changes since v12 panel:**
- FIXED: M-2 D-REDACT `redact()` orphaned — IMPL-119 (v14) wired `redact({name,value}[])` into all four
  persist sinks (AgentExecutor transcript, RunManager snapshot, RunManager journal entry including
  `key.prompt` fix from Round 2). Quality's wired-positive inventory confirms the sinks at
  `agent-executor.ts:154`, `run-manager.ts:575`, `run-manager.ts:771`, and IMPL-119's full coverage.
  **Not a violation in v14.**
- FIXED: M-3 ARCH-015 MCP_NOT_PROVISIONED silent for named workflows — Adversarial's consistent-list
  confirms `claude-agent-sdk-client.ts:416-436` now produces the typed `MCP_NOT_PROVISIONED` result.
  **Not a violation in v14.**
- NEW: O-1 LiteLLMGatewayClient transcript opaque (quality O-1, MED) — carries forward from v14 panel.
- NEW: V4 ARCH-018 hooks-drop live branch in `materializeAssets` (adversarial V4, LOW) — carries forward.

#### ARCH-044 reconciliation — SessionInitRecord vs HarnessDescriptor

Both new panels flag `SessionInitRecord` as never emitted (adversarial V2 at MED, quality O-2 at HIGH).
The v12 Gate 8 review ruled this a "not-a-violation" under ARCH-044 (signed later, supersedes ARCH-017's
`SessionInitRecord` contract). ARCH-044 is confirmed in `02-architecture.md:463-490`: `HarnessDescriptor`
with `redactHarness` is the designated replacement, wired end-to-end, and the adversarial panel's
own consistent-list confirms `harness` events are emitted at `claude-agent-sdk-client.ts:575-587`.

**Ruling (stable from v12):** `SessionInitRecord` absence = superseded-intentional per ARCH-044.
`HarnessDescriptor` is the production audit record. **Not a standalone violation.**

However, the panels' cluster around the builder contains three legitimate violations *distinct* from
SessionInitRecord that ARCH-044 does NOT supersede:

#### H-1 [HIGH] D-BIND fail-closed bind guard unimplemented (adversarial V3; quality S-2)

Decision D-BIND (amends ARCH-009) requires a fail-closed guard refusing `bind != 127.0.0.1` unless
`insecureNoAuth:true` is set. `src/net-guard.ts:14` exports `isLoopback()` but it is never imported by
`src/server.ts` or `src/main.ts` for bind refusal. `grep -rn insecureNoAuth src/` → zero hits.
`src/main.ts:97` and `src/server.ts:1025` pass the bind address through with no guard.
DEPLOY.md preamble documents the live deployment at `0.0.0.0:8899` — the exact configuration D-BIND
exists to block. Compensating control: ufw allowlist `192.168.0.0/24 + SSH` documented in DEPLOY.md.
That control is outside the engine; D-BIND requires an in-engine guard.

**Evidence:** `src/net-guard.ts:14`; `src/server.ts:28` (no isLoopback import); `src/main.ts:97`.
**Severity:** HIGH. RCE + secret surface exposed with a live `0.0.0.0` deployment.
**Action:** Gate 6 fix — one `if (!isLoopback(bind) && !config.insecureNoAuth) throw` at bind site.

#### H-2 [HIGH] D-PROFILE dual thinking policy + dead DES-031 per-session re-walk (adversarial V2; quality R-1)

ARCH-017 designates `buildSessionOptions()` (`src/session-options-builder.ts`) as the master v3 test
seam, consolidating thinking policy, curated allowlist, and MCP injection for all providers. D-PROFILE
requires `ProviderProfile` (from this module) as the single source of truth for thinking-disabled policy.

Two concrete violations:
1. **Dual thinking policy:** production (`claude-agent-sdk-client.ts:325-328`) keys off inline
   `thinkingFor(aliases, model)` using a local `aliases?.[model]?.provider === 'anthropic'` check;
   `buildSessionOptions` keys off `ProviderProfile.supportsExtendedThinking`. The two tables can
   diverge silently. Adding a new provider requires changing two independent code paths.
2. **Dead DES-031 per-session re-walk:** `findProjectMarkerAncestor(cwd, workRoot)` (ARCH-019 intra-run
   confinement re-check) lives only inside `buildSessionOptions`, which has zero production callers.
   Only the boot-time `assertWorkRootIsolated` (`main.ts:94`) runs. If an agent writes a `.git`/`CLAUDE.md`
   marker into its workspace during a run, the per-session re-walk that would refuse the next session
   call is never invoked.

**Note:** `buildSessionOptions` has zero production importers (confirmed by adversarial V2 + quality R-1
both grepping `src/`; impl-log IMPL-078 note also acknowledges "not-yet-wired (TASK-032)").

**Evidence:** `src/session-options-builder.ts` (zero production importers); `claude-agent-sdk-client.ts:325-328`; `src/main.ts:94` (single boot guard only).
**Severity:** HIGH. Confinement invariant unenforced per-session; D-PROFILE single-source broken.
**Action:** Gate 2 adjudication — wire the seam or formally supersede ARCH-017/D-PROFILE/DES-031
following the ARCH-044 precedent (signed supersession with explicit rationale). TASK-032 is the standing open task.

#### H-3 [HIGH] D-KILL/D-PROC: cli-lifecycle + timeout-race orphaned; no engine-owned process-group kill (adversarial V1; quality S-1)

ARCH-017 (D-KILL) requires the outer `Promise.race` to physically kill the CLI subprocess on timeout
(not merely abandon the promise via `abortController.abort()`), freeing the semaphore slot exactly once.
D-PROC requires SIGTERM→SIGKILL escalation on a detached process group to reap stdio-MCP grandchildren.

Both `src/cli-lifecycle.ts` (`RealCliLifecycle.killGroup`) and `src/timeout-race.ts` (`raceWithTimeout`)
have zero production callers. The real timeout path at `claude-agent-sdk-client.ts:462-463,603-616`
delegates cancellation entirely to `abortController.abort()`. Whether the SDK's `claude` CLI child and
its stdio-MCP grandchildren are reaped is the SDK's own policy — the engine performs no `kill(-pid)`.
Under the scheduled fan-out use case (D-DOS), this is the single-node exhaustion surface D-KILL/D-DOS were
raised to close (adversarial V1 notes semaphore slot IS freed via `withSlot` `finally`, which is a partial
mitigation — the slot is freed when the SDK promise settles, not when the subprocess exits).

**Evidence:** `src/cli-lifecycle.ts` (zero production importers); `src/timeout-race.ts` (zero production importers); `claude-agent-sdk-client.ts:462-463`; `run-manager.ts:585` (`withSlot` direct, no `raceWithTimeout`).
**Severity:** HIGH. Orphaned MCP grandchildren + token burn on timeout; no SIGKILL escalation.
**Action:** Gate 2 adjudication — wire or formally supersede D-KILL/D-PROC following ARCH-044 precedent.

#### M-1 [MED] LiteLLMGatewayClient transcript opaque (quality O-1)

ARCH-004 requires a single capture path that taps the SDK message/event stream into `agent-<id>.jsonl`.
`LiteLLMGatewayClient` (`src/gateway/client.ts:53`) never calls `onEvent`; runs dispatched via the
direct-fetch path produce only a terminal usage event. Tool-call traces, message text, and reasoning
steps are absent from those transcripts. `workflow_agent_log` for such runs returns a single opaque record.

**Evidence:** `src/gateway/client.ts:53` (comment confirms `onEvent` is never called for LiteLLM path).
**Severity:** MED. Observability gap on the non-Anthropic gateway path; no data loss.
**Action:** Gate 6 fix — stream per-event records through `onEvent` in the LiteLLM path.

#### L-1 [LOW] McpRegistry wall-clock (pre-existing; persists from v12)

`src/mcp-registry.ts:61` uses `new Date().toISOString()` directly instead of the injected `Clock`,
violating the C3 clock/RNG seam. Confirmed present in v14 tree (verified by direct read). Neither v14
panel re-flagged it, but the code path is unchanged. Does not affect production correctness; breaks
hermetic test seam.

**Evidence:** `src/mcp-registry.ts:61`.
**Severity:** LOW. One-line fix, opportunistic.

#### L-2 [LOW] ARCH-018 hooks-drop live branch in `materializeAssets` (adversarial V4)

ARCH-018 requires hook-kind assets rejected "by construction" — the materializer must not have a hook
arm at all. `claude-agent-sdk-client.ts:166-176` `materializeAssets` iterates `[['skill','skills'],
['hook','hooks']]` and would `copyDirRecursive` hook assets into `<workspace>/.claude/hooks/` on every
`agent()` call. The branch is dead today (classifyAsset and seedManifest strip hooks before disk), but
the structural ban ARCH-018 requires is not present in the materializer itself.

**Evidence:** `src/gateway/claude-agent-sdk-client.ts:166-176`.
**Severity:** LOW. Defense-in-depth gap; no open RCE today.
**Action:** Delete the `'hook'` arm from `materializeAssets` loop.

#### L-3 [LOW residual] SessionInitRecord — superseded by ARCH-044; thinkingMode absent from HarnessDescriptor

Per ARCH-044 ruling above, SessionInitRecord absence is not a violation. Residual observability debt:
`HarnessDescriptor` carries `prompt/tools/skills/mcpServers` but not `thinkingMode`, `secretHandleNames`,
or `settingSources`. This narrowing was deliberate (ARCH-044 scope). Recorded as LOW observability debt,
intentional per ARCH-044.

#### v14-chain architecture consistency (ARCH-054..058 / IMPL-117..121)

No panel finding touches the v14 ARCH-054..058 chain. Independent check against Gate 2 decisions:
- ARCH-054 streaming blob (IMPL-117): `isValidSha256Hex`/`isValidNamespace` guards wired before any fd;
  `putBlobStream` seam injectable; net-guard 403 on foreign Host; no-exists-shortcut invariant preserved.
  Consistent with ARCH-054.
- ARCH-055 manifest ref (IMPL-118): manifest stored as CAS blob; `seedManifestRef = sha256(bytes)`;
  4-way SEED_SOURCE_CONFLICT ladder; re-validation at run-time. Consistent with ARCH-055.
- ARCH-056 redact-at-capture (IMPL-119): `SecretValueProvider` port; `redact({name,value}[])` wired at
  all 4 sinks including JournalEntry (key.prompt + value). Quality's wired-positive inventory confirms.
  Consistent with ARCH-056. **M-2 from v12 CLOSED.**
- ARCH-057 schema honesty (IMPL-120): `asset_push` kind description includes HOOKS_UNSUPPORTED/mcp_provision;
  IT-077 drift-lock. Consistent with ARCH-057. **ARCH-015 named-workflow finding from v12 CLOSED** (adversarial
  confirms `claude-agent-sdk-client.ts:416-436` correctly resolves MCP_NOT_PROVISIONED).
- ARCH-058 scriptSha256 (IMPL-121): pure `assertScriptIntegrity` placed before admission; SCRIPT_SHA_MISMATCH
  / SCRIPT_SHA_WITHOUT_SCRIPT typed errors. Consistent with ARCH-058.

**Architecture consistency conclusion: no.** 3 HIGH + 1 MED + 3 LOW violations, all in the v3
built-but-unwired control set. No panel finding touches the v14 ARCH-054..058 chain (fully consistent).
**Gate 2 adjudication required** for H-2 (ARCH-017/D-PROFILE/DES-031) and H-3 (D-KILL/D-PROC).
**Gate 6 fix required** for H-1 (D-BIND) and M-1 (LiteLLM transcript).
Per the operator's standing decision (memory: arch-debt-unwired-security-modules — a separate security
hardening iteration), these violations do not block v14 iteration closure; they are carried as recorded
known tech debt.

### Validation & handover check (v14)

- **VAL-089 (REQ-080):** `real:true`, green — seedRef live GitHub pull + 4 SSRF denial cases confirmed.
- **VAL-090 (REQ-081):** `real:true`, green — POST /assets/blob/:sha streaming; sha mismatch 409;
  oversized 413; foreign Host 403; live production blob uploaded.
- **VAL-091 (REQ-082):** `real:true`, green — POST /assets/manifest + seedManifestRef round-trip;
  MISSING_BLOBS + SEED_SOURCE_CONFLICT confirmed; live production manifest registered.
- **VAL-092 (REQ-083):** `real:true`, green (ROUND 2) — live Ollama run (runId 8cdbed02, qwen2.5:7b,
  SDK+LiteLLM); journal.jsonl JournalEntry key.prompt redacted to `‹secret:VAL092_SECRET›`; events
  array clean; IT-075 extended (5/5 pass); val-092 clauses 2+3 pass under RWE_SKIP_ONLINE_TESTS=1.
- **VAL-093 (REQ-084):** `real:true`, green — `tools/list` asset_push kind description confirmed with
  HOOKS_UNSUPPORTED + mcp_provision text; push kind=hook → HOOKS_UNSUPPORTED.
- **VAL-094 (REQ-085):** `real:true`, green — matching scriptSha256 → run proceeds; mismatch →
  SCRIPT_SHA_MISMATCH; no sha → unchanged behavior; named + sha → SCRIPT_SHA_WITHOUT_SCRIPT.
- **REQ-012:** 1 未真實驗証 HIGH (OIDC, D5 deferral, user-accepted). Not a Gate 7.5 send-back; known
  tech debt per user decision D5. TASK-018 and its gate gap remain as LOW unimplemented.
- **1170/1170 pass.** 217 test files. `npx tsc --noEmit` clean.
- **`08-validation.md`:** present, front-matter `status: passed`, v14 ROUND 2 evidence recorded.
- **`README.md`:** present at repo root (layout.readme). Current-state (v14, 2026-08-16). Step-by-step
  quickstart (6 numbered steps). All 37 tools documented. No stale commands or superseded content.
- **`DEPLOY.md`:** present at repo root (layout.deploy). Current-state (v14, 2026-08-16). §0 step-by-step
  quickstart (verbatim copy-paste). §7 変更紀錄 includes v13 (2026-08-15) and v14 (2026-08-16) entries.
  New config keys `seedRefAllowlist` and `maxBlobBytes` documented in §1b with full descriptions + defaults;
  also present in `rwe.config.example.json` JSON block. No superseded commands or keys outside §7.
- **Config key deduplication:** `設定総表` (§1b) is the single canonical source. `seedRefAllowlist` and
  `maxBlobBytes` appear in the §1b JSON example + description blocks only (§7 変更紀錄 references them by
  name in the change entry, which is correct). No duplication.
- **Doc-debt (LOW, does not change conclusion, pre-existing from v12):** §1b lines 287-289 still carry
  the historical v2 blockquote with an inline "(v3 更新, 2026-07-11): 上述 v2 敘述已被 D-V3M-3 取代"
  supersession note — append-with-inline-marker rather than clean supersede-not-append. Current truth is
  stated inline; quickstart real-validated this round. §6 scenario-recipe JSON blocks also contain config
  key examples. Risk remains low (same as v12 assessment). Carry forward as LOW doc-debt; fold cleanup
  into the next Gate 6 round-trip.
- **Validation verdict:** Gate 7.5 v14 ROUND 2 real-tier all-green for REQ-080..085. README + DEPLOY
  present, step-by-step, current-state. 設定総表 deduplicated. No mock-only/unverified REQ for touched
  items. REQ-012 gap user-deferred and recorded.

### Retro (v13+v14 — engine-pull seedRef + streaming blob + redact-at-capture + schema honesty + scriptSha256)

- **What changed — v13 (REQ-080 / IMPL-116):** `workflow_run({seedRef:{repoUrl,sha},seedNamespace?})`
  allows the engine to pull a git repository at a specific sha for workspace seeding. SSRF-safe: fail-closed
  `seedRefAllowlist:[]` default (any seedRef → `SEEDREF_DISABLED`); repoUrl prefix must match allowlist or
  → `SEEDREF_EGRESS_DENIED` before any network call. Hardened git child (isolated env, `--depth 1`,
  `http.followRedirects=false`, ls-tree byte caps, two-step sha verify, symlink/gitlink discard).
  `workflow_status.result.seedRef` stamps resolvedSha/bytes/latencyMs/dropped/failCode. Gate 6 integrator
  fix: implementer chunk stalled on API; orchestrator completed IMPL-116 + two test_defects (pinned private
  repo → octocat public, VAL-089 workspace assembly).
- **What changed — v14 (REQ-081..085 / IMPL-117..121):**
  - IMPL-117 streaming blob: `POST /assets/blob/:sha` raw-body route bypasses the 8 MiB JSON-RPC cap.
    Pure `isValidSha256Hex`/`isValidNamespace` validators before any fd; `putBlobStream` seam with temp-file
    + incremental sha256 + mid-stream abort + atomic rename + no-exists-shortcut invariant.
  - IMPL-118 manifest ref: `POST /assets/manifest` stores manifest as CAS blob; `seedManifestRef =
    sha256(rawBytes)` client-derivable; 4-way SEED_SOURCE_CONFLICT ladder; run-time re-validation.
  - IMPL-119 redact-at-capture: `SecretValueProvider` port + `redact({name,value}[])` wired into all 4
    persist sinks. The Round 1 Gap (key.prompt unredacted in JournalEntry) was caught via live run, fixed
    by extending sink 4 to redact the entire JournalEntry (key.prompt + key.opts + value), re-verified
    in Round 2 via live Ollama run. This closes the pre-existing v12 M-2 D-REDACT violation.
  - IMPL-120 schema honesty: `asset_push` kind description explicitly documents HOOKS_UNSUPPORTED and
    mcp_provision redirect; IT-077 drift-lock. Closes the pre-existing v12 M-3 ARCH-015 finding.
  - IMPL-121 scriptSha256: pure `assertScriptIntegrity(script, sha?)` before admission; typed
    SCRIPT_SHA_MISMATCH / SCRIPT_SHA_WITHOUT_SCRIPT errors.
- **Gate 7.5 real-run value story:** the Round 1 Gap (REQ-083 key.prompt unredacted) was a genuine
  implementation defect caught ONLY by real-run evidence — the on-disk `journal.jsonl` revealed raw secret
  in `key.prompt` after a live Ollama run, which no unit or integration test caught (IT-075's test prompt
  'A' contained no secret). This is the exact class of defect Gate 7.5 exists to catch.
- **Impact closure:** REQ-080..085 fully chained (REQ→ARCH→TASK→DES→IMPL→UT/IT/VAL with real:true).
  1170/1170 regression pass. Gate 7.5 v14 ROUND 2 PASSED 2026-08-16. ZERO new trace gaps introduced.
- **Known tech debt (all pre-existing unless noted, all recorded):**
  - [HIGH] H-1 D-BIND bind guard unimplemented — Gate 6 fix required; ufw is the current compensating control.
  - [HIGH] H-2 ARCH-017/D-PROFILE/DES-031 builder cluster unwired — Gate 2 adjudication (wire or supersede).
  - [HIGH] H-3 D-KILL/D-PROC cli-lifecycle + timeout-race orphaned — Gate 2 adjudication.
  - [MED] M-1 LiteLLMGatewayClient transcript opaque — Gate 6 fix (stream onEvent in LiteLLM path).
  - [LOW] L-1 McpRegistry wall-clock — one-line fix, opportunistic.
  - [LOW] L-2 ARCH-018 hooks-drop live branch in materializeAssets — delete the hook arm.
  - [LOW] L-3 SessionInitRecord superseded (ARCH-044); thinkingMode not in HarnessDescriptor, intentional.
  - [LOW] DEPLOY.md §1b historical v2 blockquote + §6 scenario JSON config key instances — doc cosmetics.
  - Trace gaps: REQ-012/TASK-018 (OIDC, D5), IMPL-082 (TDD-label), UT-058/UT-064/IT-057 (iter drift).
- **Gate 7.5:** PASSED 2026-08-16 (ROUND 2). VAL-089..094 `real:true`. 1170/1170 regression.

## v12 GATE 8 REVIEW (2026-08-15, superseded by v14 above)

> This section supersedes "## v11 GATE 8 FIX-ITERATION REVIEW (2026-08-09)" below (kept for history).
> This round lands four already-implemented, GREEN, real-validated items: **v12 — system metrics +
> models enrichment**: REQ-076 (`system_info` CPU/mem/disk), REQ-077 (process metrics via `system_info`),
> REQ-078 (`models_list` enrichment with provider/context/pricing), REQ-079 (drift-locked input/output
> schemas). All are additive tool surface additions; no v1-core or run-lifecycle change.
> Ledger chain: REQ-076..079 → ARCH/TASK/DES chain → IMPL-101..102 (iter v12) → VAL-085/086/087/088.
>
> **Gate 7.5 v12 ROUND 1 PASSED 2026-08-15.** VAL-085..088 all `real:true`. 998/998 regression pass.
> 37 tools. `npx tsc --noEmit` clean.
>
> **Panel architects pre-ran (not re-spawned):** adversarial group + quality-dimensions group reports
> were in `.panel/review/`. This section consolidates them; `.panel/` is removed at end of Gate 8.

### Traceability consistency (v12)

Trace `--check` result (regenerated 2026-08-15): **642 items, 6 gaps — ZERO new gaps from v12.**
REQ-076..079 are fully chained (REQ→ARCH→TASK→DES→IMPL→UT/VAL) with VAL-085..088 `real:true`.
Gap breakdown:

| ID | Severity | Type | Note |
|----|----------|------|------|
| REQ-012 | HIGH / 嚴重 | 未真實驗證 | OIDC deferred by user decision D5; pre-existing known tech debt; not a Gate 7.5 send-back |
| IMPL-082 | MED | TDD label gap | Pre-existing since v4 |
| UT-058 | LOW | iter drift v6 behind DES-038 v11 | Pre-existing since F1; underlying ops covered; cosmetic lag only |
| UT-064 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| IT-057 | LOW | iter drift v9 behind DES-054 v11 | Pre-existing since v9 |
| TASK-018 | LOW | no implementation | OIDC task, deferred D5 |

All 6 are pre-existing; none introduced by v12. Every remaining gap is recorded here as known tech debt (Exit Gate 1 satisfied).

### Architecture consistency (v12 panel consolidation)

Two expert groups pre-ran against the v12 implementation. Both independently concluded NOT consistent.
Their findings are consolidated here; `.panel/review/` files removed at end of this gate.

**Expert scope:** adversarial group (security + scalability + testability) and quality-dimensions group
(observability + replaceability + consumability + self-sustainability). Both read `02-architecture.md`
(ARCH/INV/rationale), `06-impl-log.md`, and the files listed on each IMPL `files:` for the v12 iter block.

**Verdict: NOT consistent. 6 violations (2 HIGH, 3 MED, 1 LOW) and 1 superseded item.**

#### H-1 [HIGH] D-BIND fail-closed bind guard unimplemented (co-signed by both groups)

Decision D-BIND requires the engine to refuse any bind that would expose a no-auth server to a
non-loopback/non-LAN address. `src/net-guard.ts` exports `isLoopback()` but it is never imported by
`src/server.ts` or `src/main.ts` for bind refusal. Verified: `grep -rn insecureNoAuth src/` returns
zero hits; `isLoopback` absent from `src/server.ts` and `src/main.ts`. `src/main.ts:97` and
`src/server.ts:1005` pass the bind address through with no guard. The `insecureNoAuth` config key does
not exist anywhere in src/. `DEPLOY.md` preamble documents the live deployment at `0.0.0.0:8899` — the
exact configuration D-BIND was designed to block fail-closed.

**Evidence:** `src/net-guard.ts:14` (exports `isLoopback`, not wired to bind path);
`src/server.ts:28` (imports `isAllowedHost, isAllowedOrigin` only — no bind guard);
`src/main.ts:97` (bind passed through unguarded).

**Severity:** HIGH. Unenforced on an RCE + secret surface with a live `0.0.0.0` deployment.
**Action required:** Gate 6 fix (a one-`if` guard at the bind site).

#### H-2 [HIGH] ARCH-017/019 session-options-builder + per-session confinement re-walk absent (quality group R-1)

ARCH-017 designates `src/session-options-builder.ts:buildSessionOptions()` as the master test seam for
session-level SDK option assembly. ARCH-019 part-2 requires a per-session workroot re-walk (DES-031),
enforcing confinement at each session, not only at boot. `buildSessionOptions()` has zero production
importers — the gateway `claude-agent-sdk-client.ts:520-573` builds SDK options inline via `thinkingFor()`
and `curateToolsForProvider()`, bypassing the seam entirely. `src/workroot-guard.ts:findProjectMarkerAncestor()`
is imported only by session-options-builder, which is itself never called in production. The boot guard at
`src/main.ts:94` runs once; DES-031 per-session re-walk is never executed. The confinement invariant
(work-root re-verified per session) is not enforced at runtime.

**Evidence:** `src/session-options-builder.ts` (zero production importers);
`claude-agent-sdk-client.ts:520-573` (inline SDK option build, no seam call);
`src/workroot-guard.ts:findProjectMarkerAncestor()` (reachable only through the orphaned builder);
`src/main.ts:94` (single boot guard only).

**Severity:** HIGH. Confinement invariant unenforced at runtime; ARCH-017 test-seam trust not realized.
**Action required:** Gate 2 adjudication — wire the seam or formally supersede ARCH-017/019, following
the ARCH-044 precedent for explicitly signed supersession decisions.

#### M-1 [MED] D-PROC/D-KILL / FailureEnvelope / cli-lifecycle + timeout-race cluster orphaned (both groups)

Three related built-but-unwired modules: (a) `src/cli-lifecycle.ts:RealCliLifecycle` — zero production
importers; no SIGKILL escalation after grace window, no explicit temp-dir cleanup tied to session
lifecycle. (b) `src/timeout-race.ts:raceWithTimeout()` — zero production importers; `run-manager.ts:585`
uses `withSlot(() => spawner.run({signal}))` directly, bypassing the D-PROC timeout-race seam.
(c) `src/timeout-race.ts:FailureEnvelope` — zero production callers; `agent-executor.ts:218` emits a
different `{kind:'usage', data:{reason,provider,detail}}` taxonomy without `attempts` or `elapsedMs`;
the retry counter at `claude-agent-sdk-client.ts:291-302` exists but is never surfaced via FailureEnvelope.
Gateway uses `abortController.abort()` only; D-KILL SIGTERM→SIGKILL escalation sequence not connected.

**Evidence:** `src/cli-lifecycle.ts` (zero production importers);
`src/timeout-race.ts` (zero production importers/callers);
`run-manager.ts:585` (withSlot direct, no raceWithTimeout);
`agent-executor.ts:218` (different taxonomy, no FailureEnvelope);
`claude-agent-sdk-client.ts:291-302` (retry counter, not surfaced).

**Severity:** MED. Process-group kill guarantee and failure taxonomy incomplete; no active data-loss but
degrades correctness under timeout/kill scenarios.
**Action required:** Gate 2 adjudication — wire or formally supersede D-PROC/D-KILL (following ARCH-044 precedent).

#### M-2 [MED] D-REDACT `redact()` orphaned (adversarial V5)

Decision D-REDACT requires capture-time secret scrubbing before any transcript event is stored or emitted.
`src/secret-resolver.ts:88 redact()` is imported by nothing in src/. The transcript capture path at
`claude-agent-sdk-client.ts:589` stores raw events with no `redact()` applied. Secret values resolved
from `RWE_SECRET_*` env vars can appear verbatim in stored transcripts.

**Evidence:** `src/secret-resolver.ts:88` (redact() exported, zero production importers);
`claude-agent-sdk-client.ts:589` (raw event capture, no redact call).

**Severity:** MED. Secret leakage into transcripts on an RCE surface.
**Action required:** Gate 6 fix (wire redact() at the transcript capture site).

#### M-3 [MED] ARCH-015 MCP_NOT_PROVISIONED silent for named workflows (adversarial V6)

ARCH-015 mandates a typed `MCP_NOT_PROVISIONED` error when an agent call references an MCP server name
not in the provisioning list. `claude-agent-sdk-client.ts:421` silently maps an unprovisioned MCP name
to `{}` (empty allowedTools), swallowing the error. The `if (spec.script)` gate at
`submission-validator.ts:100` skips named-workflow runs from submission-time scan entirely, so an
unprovisioned name is never caught before dispatch for named workflows.

**Evidence:** `claude-agent-sdk-client.ts:421` (maps unprovisioned name to `{}`);
`submission-validator.ts:100` (named-workflow bypass).

**Severity:** MED. Silent failure degrades operator debuggability.
**Action required:** Gate 6 fix.

#### L-1 [LOW] McpRegistry wall-clock (adversarial V7)

`src/mcp-registry.ts:61` uses `new Date().toISOString()` directly instead of the injected `Clock`,
violating the C3 clock/RNG seam. Does not affect production correctness but breaks hermetic test seam.

**Evidence:** `src/mcp-registry.ts:61`.

**Severity:** LOW. One-line fix, opportunistic.

#### Not-a-violation: SessionInitRecord superseded by ARCH-044

Adversarial flagged `SessionInitRecord` (defined at `session-options-builder.ts:23-37`) as never emitted.
Quality's response: ARCH-044 (signed later) explicitly superseded it, replacing it with `HarnessDescriptor`
emitted via `redactHarness()`, which IS wired end-to-end. **Later-signed ARCH-044 wins** — not a violation.
Residual: `thinkingMode` absent from `HarnessDescriptor`, so it is not auditable in the harness log.
ARCH-044 deliberately narrowed scope. Recorded as: superseded-with-residual, intentional per ARCH-044,
LOW observability debt.

#### Not-a-violations confirmed by both groups

D-DOS semaphore correctly wired; host-ambient MCP isolation (VAL-003) holds; ARCH-018 asset classifier
correct; D-SEC two-layer secret containment wired at composition root; `withSlot()` semaphore gates DOS;
ARCH-033 Host/Origin allowlist correctly enforced.

#### Architecture consistency conclusion

Architecture consistent: **no**. 2 HIGH + 3 MED + 1 LOW violations, all in the v3 built-but-unwired
control set. The v12 REQ-076..079 ARCH chain is fully satisfied (no panel finding touches v12 scope).

**Overall conclusion: send back to Gate 6** for D-BIND, D-REDACT, and ARCH-015 (fixable, concrete).
**Gate 2 adjudication recommended** for ARCH-017/019 and D-PROC/D-KILL (wire vs formally supersede,
following the ARCH-044 precedent).

### Validation & handover check (v12)

- **VAL-085 (REQ-076):** `real:true`, green — live `system_info` returned CPU/mem/disk metrics.
- **VAL-086 (REQ-077):** `real:true`, green — `system_info` process metrics (pid, uptime, heap, rss).
- **VAL-087 (REQ-078):** `real:true`, green — `models_list` enriched with provider/context/pricing.
- **VAL-088 (REQ-079):** `real:true`, green — schema drift-lock confirmed.
- **`08-validation.md`:** status: passed. Gate 7.5 v12 ROUND 1 PASSED 2026-08-15.
- **No mock-only/unverified gaps for v12 chain:** trace reports 0 未驗證需求, 0 僅mock驗證 for REQ-076..079.
- **REQ-012:** 1 未真實驗證 (OIDC, D5 deferral). User-deferred; not a Gate 7.5 send-back. Known tech debt.
- **998/998 regression pass.** 37 tools. `npx tsc --noEmit` clean.
- **`README.md`:** present, current-state (v12, 2026-08-15). Step-by-step quickstart (6 numbered steps).
  All 37 tools documented. No stale commands or superseded content.
- **`DEPLOY.md`:** present, current-state. §0 step-by-step quickstart (逐字可貼上執行). §7 変更紀錄
  includes v12 entry (2026-08-15). No new config keys in v12. No stale current-state docs.
- **DEPLOY.md doc-debt (LOW, does not change conclusion):** §1b lines 276-290 carry a historical v2/pre-v3
  `defaultAllowedTools` blockquote with an inline "(v3 更新, 2026-07-11): 上述 v2 敘述已被 D-V3M-3 取代"
  supersession note — append-with-inline-marker rather than clean supersede-not-append. Config keys also
  appear in §6 scenario-recipe JSON examples. Risk is low (current truth stated inline; quickstart
  real-validated this round). Fold cleanup into the Gate 6 round-trip.
- **Validation verdict:** Gate 7.5 real-tier all-green for v12 REQ-076..079. README + DEPLOY present.
  No mock-only/unverified REQ for touched items. REQ-012 gap user-deferred and recorded.

### Retro (v12 — system metrics + models enrichment)

- **What changed:** `system_info` MCP tool — CPU usage (user/system/idle %), memory (total/used/free,
  usedPercent), disk (each mount point: size/used/available/usedPercent), all in SI-prefixed units;
  process metrics (pid, uptimeSeconds, heapUsedMB, heapTotalMB, rssMB). `models_list` enriched with
  provider, contextWindow, maxOutput, and pricing fields. Input/output schemas drift-locked by
  schema-registry test (REQ-079). Additive only — no v1-core, no run-lifecycle, no config change.
- **Impact closure:** REQ-076..079 fully chained. 998/998 regression. Gate 7.5 v12 ROUND 1 PASSED
  2026-08-15. ZERO new trace gaps introduced.
- **Panel architecture findings are pre-existing, none introduced by v12:** The 6 violations are all in
  the v3 built-but-unwired control set (session-options-builder, cli-lifecycle, timeout-race, net-guard
  bind guard, redact, ARCH-015 named-workflow path). The panel's v12-era line numbers confirm current-tree
  findings. Zero violations touch the REQ-076..079 chain.
- **Root cause of built-but-unwired pattern:** ARCH decisions (Gate 2) created module contracts; Gate 6
  created the modules; but the gateway composition (`claude-agent-sdk-client.ts`, `main.ts`) was never
  updated to call them. Future Gate 6 exit criteria should include a production-caller check (zero
  importers on a wired ARCH decision = open finding).
- **Known tech debt (all pre-existing, all recorded):**
  - [HIGH] D-BIND bind guard unimplemented — Gate 6 fix required before any `0.0.0.0` deployment.
  - [HIGH] ARCH-017/019 session-options-builder + per-session re-walk absent — Gate 2 adjudication.
  - [MED] D-PROC/D-KILL / FailureEnvelope / cli-lifecycle + timeout-race orphaned — Gate 2 adjudication.
  - [MED] D-REDACT `redact()` orphaned — Gate 6 fix.
  - [MED] ARCH-015 MCP_NOT_PROVISIONED silent for named workflows — Gate 6 fix.
  - [LOW] McpRegistry wall-clock — one-line fix, opportunistic.
  - [LOW] SessionInitRecord superseded by ARCH-044 (thinkingMode not auditable, intentional).
  - [LOW] DEPLOY.md doc-debt (historical blockquote append-with-marker; §6 scenario JSON config keys).
  - Trace gaps: REQ-012/TASK-018 (OIDC, D5), IMPL-082 (TDD-label), UT-058/UT-064/IT-057 (iter drift).
- **Gate 7.5:** PASSED 2026-08-15. VAL-085..088 `real:true` (live engine, 37 tools, 998/998 regression).

## v11 GATE 8 FIX-ITERATION REVIEW (2026-08-09, superseded by v12 above)

> This section supersedes "## v10 GATE 8 REVIEW (2026-08-01)" below (kept for history).
> Fix-mode iteration: impact closure on REQ-066 (version autofill) and REQ-067 (read-only Issues dashboard).
> Scope: IMPL-100 touching three files — `src/github/issue-reporter.ts`, `src/server.ts`,
> `src/dashboard-page.ts`. No panel spawned (fix scale, self-decided per SDLC fix-mode rules).
>
> **Trace --check result (regenerated this review):** 532 items, 20 gaps — ZERO new gaps from v11.
> REQ-066/067 are fully chained (REQ→ARCH→TASK→DES→IMPL→UT/IT→VAL) with VAL-075/076 real:true.
> Gap breakdown: 1 HIGH (REQ-012 未真實驗証 — OIDC deferred D5, pre-existing known tech debt) /
> 17 MID (REQ-068..075 × 2 each = future sprint work, 16; IMPL-082 TDD-label, 1) /
> 2 LOW (UT-058 drift v6 behind DES-038 v11 — flagged since F1 design stage; TASK-018 OIDC unimplemented).
> All 20 are pre-existing; none introduced by this iteration.

### Consistency self-check (architecture, v11 scope only)

Checked IMPL-100's three touched files against the Gate 2 ARCH/INV/rationale in 02-architecture.md:

- **ARCH-023 (v11 NB, REQ-066):** `resolveEngineVersion()` export replaces the hardcoded `ENGINE_VERSION`
  constant; `IssueReportInput.version?` optional caller override; `renderIssueBody` always renders all five
  Environment fields with `_none_` placeholders; `report()` effective-version rule (`input.version?.trim() ||
  cfg.engineVersion`). Implementation in `src/github/issue-reporter.ts` matches the ARCH-023 v11 annotation
  exactly. **No violation.**
- **ARCH-024 (v11 NB, REQ-067):** read-only `/api/issues` + `/api/issues/:number` endpoints on the
  existing `handleDashboardRequest` transport (ARCH-011); degrade-to-200 on missing token or API error (never
  500); `/dashboard/issues` view using ARCH-029's dashboard page. Implementation in `src/server.ts` and
  `src/dashboard-page.ts` matches the ARCH-024 v11 annotation exactly. **No violation.**
- **ARCH-001 (MCP tool surface):** optional `version` field added to `issue_report` inputSchema — backward-
  compatible (optional, existing callers unaffected). **No violation.**
- **ARCH-011/ARCH-029 (dashboard HTTP + page):** new `/api/issues*` predicate follows the `startsWith`
  pattern established by `/api/workflows` (the ARCH-029 routing-gap fix pattern, documented in the v8 Slice 3
  retro). **No violation.**
- **ARCH-016 (server-side secrets):** `RWE_SECRET_GITHUB_TOKEN` stays in the server-side secret store;
  the new `/api/issues` routes use the same `issueReporter` instance that already holds the token
  server-side. **No violation.**
- **ARCH-033 (Host/Origin allowlist):** the new routes go through the same top-level dispatcher that applies
  `isAllowedHost`/`isAllowedOrigin` before routing to `handleDashboardRequest`. **No violation.**
- **DES-013 (null-vs-throw / never 500):** both `/api/issues` routes degrade to HTTP 200 `{degraded:...}`
  on any `{ok:false}` result — no 500 escapes. **No violation.**
- **DES-038/KP-12 (XSS invariant):** all remote content in `src/dashboard-page.ts` is rendered via the
  `el()` helper's `textContent` assignment or direct `.textContent`; `innerHTML=''` is used only to clear
  containers (empty string, no user content); `link.setAttribute('href', data.url||'#')` is acceptable
  (GitHub API URLs are always HTTPS; display text is separately `textContent`). **No violation.**
- **Iter drift check (the fix chain guard):** IMPL-100 at iter v11; DES-037/038 at v11; UT-057/IT-043/
  IT-044/VAL-075/076 at v11. The one LOW drift flagged (UT-058 v6 vs DES-038 v11) was created at F1
  (design bump) and pre-dates this implementation; UT-058's existing 9 cases cover the underlying
  `GithubIssueClient` read ops (unchanged in v11) and the v11 dashboard addition is covered by IT-044.
  No new drift introduced by IMPL-100.

Architecture consistent: **yes** (no violations found across all lenses checked).

### Validation check (v11)

- **VAL-075 (REQ-066):** real:true, green — GitHub issue #7 filed with caller `version:"v1.4.0-val75"` →
  body contained `Version: v1.4.0-val75`; issue #8 filed without version → body contained
  `Version: 0.1.0 (v0.4.0-39-g5832599)` (engine autofill via `resolveEngineVersion()`); all five
  Environment fields rendered. Both issues closed after evidence capture.
- **VAL-076 (REQ-067):** real:true, green — `GET /api/issues` → 200 `{open:[2 items],resolved:[2 items]}`;
  `GET /api/issues/7` → 200 full IssueView; `GET /api/issues/999999` → 404 `{error:...}`; no-token degrade
  → 200 `{degraded:"GitHub not configured"}`; `/dashboard/issues` → HTML with Open/Resolved groups and
  `#issue-detail` panel.
- **08-validation.md:** status: passed (front-matter).
- **README.md + DEPLOY.md:** current-state confirmed. README fully rewritten at Gate 7.5 v11. DEPLOY.md
  preamble de-stacked (v3/v6/v7 blockquotes removed), §0 Quickstart added, §1b `RWE_SECRET_GITHUB_TOKEN`
  documented (single row, no duplication), §7 v11 entry in 変更紀錄. No superseded commands or keys found
  outside §7 変更紀錄. `設定総表` (§1b env-var table) is deduplicated — `RWE_SECRET_GITHUB_TOKEN` appears
  exactly once (line 377 of DEPLOY.md).
- **No config-file changes:** v11 reuses the existing `RWE_SECRET_GITHUB_TOKEN` secret store key.
- **mock-only / 未真實驗証 for touched REQs:** none — trace shows REQ-066/067 have real:true VAL items.

### Retro (v11 — version autofill + Issues dashboard, fix iteration)

- **What changed (IMPL-100, 3 files):**
  - `src/github/issue-reporter.ts` — new `resolveEngineVersion(exec?)` export (pkg.version + best-effort
    `git describe`, injectable for unit tests); `IssueReportInput.version?` optional field; `renderIssueBody`
    widened to accept both `version` and `engineVersion` (backward-compat) and always renders all five
    Environment fields with `_none_` placeholders; `report()` reads caller-supplied version with whitespace-
    only fallback to engine autofill. The hardcoded `ENGINE_VERSION = '1.0.0'` constant in `src/server.ts` is
    replaced by a call to `resolveEngineVersion()` at module load — `initialize` response now carries the real
    version string including git-describe.
  - `src/server.ts` — `issue_report` inputSchema gains optional `version` field; `handleDashboardRequest`
    grows a 5th `issueReporter` parameter (already wired from the composition root); new `/api/issues` and
    `/api/issues/:number` route branches; top-level dispatcher predicate widened with `||
    startsWith('/api/issues')` (the ARCH-029 routing-gap pattern).
  - `src/dashboard-page.ts` — Issues nav link; `#issues` section with `#issues-open`, `#issues-resolved`,
    `#issue-detail`; `currentRunId()` special-cases `"issues"` segment; `isIssuesView()` helper; `loadIssues()`
    / `renderIssueList()` / `loadIssueDetail()` — all remote content via `textContent` (XSS-safe).
- **Impact closure:** REQ-066 and REQ-067 fully chained and real-validated (VAL-075/076 real:true, Gate 7.5
  v11 ROUND 1 PASSED 2026-08-09). Issues #7 and #8 filed and verified live against the production engine
  (`rwe.service`, `127.0.0.1:8787`, `tools/list` → 36 tools). Zero regressions: full suite 697 pass / 156
  files; `npx tsc --noEmit` clean.
- **Design-stage decision to note:** the `toErrEnvelope` pre-existing bug (surfaced in v10) had already
  been fixed, so IMPL-100 inherits correct coded-error surfacing at the tool boundary without additional work.
  The `resolveEngineVersion()` seam design (injectable `exec`) was chosen specifically to keep the unit
  tests hermetic (no git subprocess in CI) — the production path calls `execSync('git describe --tags
  --always')` at module load with a try/catch fallback, ensuring a non-empty version even in a shallow clone.
- **Residual tech debt (all pre-existing, none introduced here):**
  - UT-058 (v6) trails DES-038 (v11) — LOW drift, flagged since the F1 design stage. UT-058's 9 original
    cases cover the underlying `GithubIssueClient` read primitives (unchanged); the v11 Issues dashboard
    addition is covered by IT-044 at v11. No behavioral gap; cosmetic iter lag only.
  - IMPL-082: no unit/IT coverage (TDD-label gap, pre-existing since v4).
  - TASK-018 / REQ-012: OIDC deferred by user decision D5 — unchanged.
  - REQ-068..075 (future sprint): tag-triggered self-update + enhanced graph dashboard, not yet started.
- **Gate 7.5:** PASSED 2026-08-09, ROUND 1. Trace `--check`: 532 items, 20 gaps — the REQ-066/067 chain
  is fully closed (REQ→ARCH→TASK→DES→IMPL→UT/IT→VAL with real:true); remaining 20 gaps are ALL pre-existing.
  ZERO new gaps introduced by this fix iteration.

## v10 GATE 8 REVIEW (2026-08-01, superseded by v11 above)

> This section supersedes "## v9 GATE 8 REVIEW (2026-08-01)" below (kept for history).
> This round opens a NEW theme — **efficient large-codebase seeding** — landing its first two vertical
> slices, both already-implemented, GREEN, and real-validated. The accepted architecture is the 4-architect
> panel debate recorded in `docs/seed-sync-architecture.md`. Slice 1 (REQ-063): accept `Content-Encoding:
> gzip|deflate` on the `/mcp` body (bounded on BOTH the compressed input AND the decompressed output, so a
> gzip bomb can't OOM) + turn the opaque raw 413 into a typed, actionable `{code:'BODY_TOO_LARGE', cap, phase,
> hint}`. Slice 2 (REQ-064/065, the main event): a content-addressed blob store (`CasStore` — immutable blob
> pool + per-namespace SQLite refset, byte-verify-under-computed-hash, per-namespace `missing`) + assemble a
> run workspace from a `seedManifest:[{path,sha256,exec?}]` through the SAME `materializeSeed` guardrails,
> failing fast with `MISSING_BLOBS` before any durable work. Both slices are additive — the inline
> `{path,contentB64}` seed and `asset_push` are untouched.
> Ledger items added this round: REQ-063 (Slice 1) + REQ-064/065 (Slice 2) (requirements pre-written, iter
> v10) → ARCH-036 + ARCH-037 → TASK-057 + TASK-058 → DES-055 + DES-056/057 → IMPL-098 + IMPL-099 → IT-058
> (Slice 1) + IT-059 + IT-060 (Slice 2) → VAL-072 + VAL-073 + VAL-074.

### Retro (v10 — efficient large-codebase seeding, Slices 1+2)

- **What changed — Slice 1 (compressed body + typed error):** `src/server.ts` — a new decompressed-output cap
  `MAX_DECOMPRESSED_BYTES` (8× the compressed cap), a typed `BodyTooLargeError{code,cap,phase,hint}`, `readBody`
  split into a raw capped `readBodyBuffer` + a new `readBodyDecoded` (honors `Content-Encoding: gzip|deflate`
  with a bounded output so a bomb throws mid-inflate), the `/mcp` handler routed through `readBodyDecoded`, and
  the typed 413 emitted on both the `/mcp` and webhook catch blocks. The webhook keeps the RAW un-decoded body
  (its HMAC is over the delivered bytes) — it only gains the typed 413.
- **What changed — Slice 2 (the CAS substrate):** NEW `src/cas-store.ts` (`CasStore` — fs blob pool
  `blobs/<sha[0:2]>/<sha>` + SQLite per-namespace refset; byte-verifying `putBlob` that stores under the
  COMPUTED hash and throws `BLOB_HASH_MISMATCH` on a claim mismatch; per-namespace `missing`/`hasRef`;
  `readBlob`/`readBlobSync`); `src/workspace-seed.ts` extracted the shared per-path `seedPathVerdict` (reused by
  `materializeSeed` and the NEW `materializeManifest`, which reads CAS bytes + applies the masked exec bit) +
  the `ManifestEntry {path,sha256,exec?}` schema (regular files only); `src/run-manager.ts` threads a `cas?`
  dep, fails fast with `MISSING_BLOBS`/`CAS_UNAVAILABLE` before `createRun`, and assembles from the CAS;
  `src/types.ts` added `RunSpec.seedManifest`/`seedNamespace`; `src/mcp-facade.ts` forwards them; `src/server.ts`
  constructs the `CasStore` (`casDir` config), threads `cas` into `callTool`, and adds `blob_put`/`seed_plan`.
- **Key decisions (see the DES-055/056/057 rationale + `docs/seed-sync-architecture.md`):** TWO caps not one
  (compressed input + decompressed output — the compressed cap alone can't stop a bomb); the webhook keeps the
  raw body (HMAC is over delivered bytes, must not auto-decompress); the CAS byte-verifies and stores under the
  COMPUTED hash with NO exists-skip (closes hash-poisoning + confused-deputy at once); `missing`/`hasRef` are
  PER-NAMESPACE not global (closes the cross-tenant dedup oracle); ONE shared `seedPathVerdict` so the inline
  and CAS seed paths can never diverge; the manifest is regular-files-only with `exec?` the sole masked metadata
  bit and NO symlinks ever (retrofit-avoidance); fail fast on `MISSING_BLOBS` before any durable work.
- **The `toErrEnvelope` fix — a PRE-EXISTING latent bug fixed this round.** `src/mcp-facade.ts:toErrEnvelope`
  previously returned `err.name` (`'Error'`) for run-manager `codedError`s, so `RUN_ADMISSION_LIMIT` /
  `NESTING_*` (and the new `MISSING_BLOBS`) surfaced through `workflow_run` as a useless `'Error'` code — the
  branchable code was silently swallowed at the tool boundary since v8. It now prefers `.code`, falling back to
  the Error name only for a genuinely un-coded error. This was mandatory for the CAS upload-then-retry loop (the
  client keys on `MISSING_BLOBS`) and also un-swallows the pre-existing admission/nesting codes.
- **No regressions.** Full suite 683 pass / 155 files (up from 671 / 152 — three new integration files:
  compressed-body, cas-store, seed-manifest-http), `npx tsc --noEmit` clean. The change is additive: the inline
  `{path,contentB64}` seed and `asset_push` are untouched; the existing `workspace-artifacts-seed.test.ts`
  (exercising the `materializeSeed`→`seedPathVerdict` refactor) stays green; `workflow_run` gains only additive
  fields; `blob_put`/`seed_plan` are new tools older clients ignore.
- **Deferred to later increments (per `docs/seed-sync-architecture.md` §Roadmap):** the raw-streaming
  `POST /assets/blob/<sha256>` blob endpoint (no base64, no 8 MiB cap — the many-large-files transport), per-tenant
  quotas + immutable-pool refcount GC, the client `push_workspace.py` helper (git-as-client-cache: memoize
  `gitOID→sha256` so a re-align is `git status`-fast) + the `rwe seed` CLI, and the optional `seedRef:{repoUrl,sha}`
  engine-pull behind an egress allowlist (CI/forge/air-gapped). Rejected outright (not deferred): rsync (bypasses
  `materializeSeed`, second auth root) and git-bundle-as-transport (engine-minted baseline has no common ancestor →
  zero delta). Deferred UNCHANGED from v8/v9: SSE, RUN-dag parallel-group markers, and full OIDC (REQ-012, D5 — the
  Host/Origin allowlist + loopback/LAN bind is the interim control the blob route will inherit).
- **Gate 7.5:** PASSED 2026-08-01. Live production engine (systemd `rwe.service`, `127.0.0.1:8787`) restarted with
  the v10 code, `tools/list` → 36 tools incl `blob_put`/`seed_plan`. Slice 1: a gzip'd `tools/list` decoded (34
  tools); an oversized uncompressed body → typed 413 `{code:'BODY_TOO_LARGE', cap:8388608, hint:…}`. Slice 2:
  uploaded two blobs to namespace `liveproj` (`seed_plan` 2 missing → `[]` after `blob_put`); `workflow_run` with
  the `seedManifest` completed; `workflow_artifacts` byte-identical sha256; on-disk modes `0755` (`exec:true`) /
  `0644` (`exec:false`); an un-uploaded blob → `MISSING_BLOBS`. See VAL-072 / VAL-073 / VAL-074. Trace `--check`:
  the 6 REQ-063/064/065 gaps (untraced requirements) are CLOSED by this round's chain; the remaining 3 gaps are ALL
  pre-existing (REQ-012 / TASK-018 OIDC-deferred, IMPL-082 TDD-label) — ZERO new gaps introduced.

## v9 GATE 8 REVIEW (2026-08-01)

> This section is superseded by "## v10 GATE 8 REVIEW (2026-08-01)" above (kept for history).
> This section supersedes "## v8 DEFER A GATE 8 REVIEW (2026-08-01)" below (kept for history).
> This round lands ONE already-implemented, GREEN, real-validated slice: **v9 — workflow discovery / reuse
> decision**, a new discovery theme. Before an operator reuses a registered workflow (or authors a new one),
> they can now answer "what is it FOR?" and "what SHAPE does it have?" WITHOUT running it or reading its
> script — a workflow's purpose (`meta.description` + `phases`) is queryable via `workflow_list` +
> `workflow_get`, and its predicted DAG (a pure static scan) is inspectable via `workflow_get.skeleton` +
> `GET /api/workflows/:name/skeleton`, drawn on the dashboard card. Purely ADDITIVE read layer — no
> registration-storage/schema change (description derived on-demand → migration-free + always in-sync), no
> run-lifecycle/sandbox/journal change, no change to any existing tool's semantics beyond an additive
> `description` field on `workflow_list`.
> Ledger items added this round: REQ-061 + REQ-062 (requirements pre-written, iter v9) → ARCH-035 →
> TASK-056 → DES-054 → IMPL-097 → UT-064 (5 cases) + IT-057 (4 cases) → VAL-070 + VAL-071.

### Retro (v9 — workflow discovery / reuse decision)

- **What changed:** (a) a NEW pure module `src/workflow-meta.ts` — `parseMeta(script) → {description, phases}`
  (reuses the sandbox `checkMeta` guard to obtain the validated pure-literal meta, then evaluates it in an
  empty, timeout-bounded VM; degrades to empty, never throws) + `parseWorkflowSkeleton(script) →
  SkeletonNode[]` (a pure static scan of `phase`/`agent`/`parallel`/`workflow` calls in order — parallel-group
  ids, sub-workflow names, best-effort `dynamic` markers for loop/conditional bodies; never executes, never
  throws). (b) `WorkflowCatalog.list()` now returns each `{name, version, createdAt, description}` (description
  derived on-demand) and a NEW `getFull(name)` returns the full row (throws `CatalogNotFoundError` for
  unknown). (c) a NEW `workflow_get({name})` MCP tool → full detail + `skeleton`, unknown → typed
  `WORKFLOW_NOT_FOUND` envelope; `workflow_list` widened with `description`. (d) a NEW dashboard route
  `GET /api/workflows/:name/skeleton`. (e) the dashboard workflow card shows the description and is clickable →
  a rendered predicted DAG (parallel-group boxes, `×? (dynamic)` markers, the description as purpose text).
- **Key decisions (see DES-054 rationale):** on-demand `parseMeta` at read time rather than a stored/migrated
  `description` column — migration-free and always in-sync with the current script; the skeleton is an
  explicitly BEST-EFFORT static prediction (loop/conditional shapes resolve only at run time → flagged
  `dynamic`, never claimed exact) that never runs the script; and the meta VM eval is safe by construction
  because it evaluates the object text ONLY when the reused `checkMeta` guard reports a pure literal, in an
  empty prototype-free timeout-bounded context (side-effect-free, bounded, degrades to empty on any failure).
- **No regressions.** Full suite 671 pass / 152 files, `npx tsc --noEmit` clean. The change is a purely
  additive read layer: no existing tool's behavior changed beyond the additive `description` field on
  `workflow_list` (older clients ignore it); `workflow_get` + `/skeleton` are new read-only surfaces. No src
  code touched outside the discovery path.
- **Deferred items UNCHANGED from v8 (still open, not addressed this round):** SSE (the dashboard keeps its 3s
  poll), `parallel()` group markers on the RUN dag (needs a sandbox-child IPC change — note the STATIC
  skeleton added here DOES carry parallel groups, but the live-run DAG still does not), and full OIDC
  (REQ-012, D5 — the separate deferred auth track; a public `0.0.0.0` bind without OIDC remains the documented
  caveat, with the Host/Origin allowlist + loopback/LAN bind as the interim control).
- **Gate 7.5:** PASSED 2026-08-01. Live production engine (systemd `rwe.service`, `127.0.0.1:8787`) restarted
  with the v9 code: registered `disc-demo`, confirmed `workflow_list` description, `workflow_get`
  description + phases + skeleton `[agent(parallel:1), agent(parallel:1), agent, workflow:notify]`, and the
  Playwright-headless dashboard card → clicked → predicted DAG with the parallel group + workflow node + the
  description as purpose text. See VAL-070 / VAL-071. Trace `--check`: the 4 REQ-061/062 gaps (untraced
  requirements) are CLOSED by this round's chain; the remaining 3 gaps are ALL pre-existing (REQ-012 / TASK-018
  OIDC-deferred, IMPL-082 TDD-label) — ZERO new gaps introduced.

## v8 DEFER A GATE 8 REVIEW (2026-08-01)

> This section supersedes "## v8 SLICE 2c + DEFER B GATE 8 REVIEW (2026-08-01)" below (kept for history).
> This round lands ONE already-implemented, GREEN, real-validated slice: **Defer A — crash durability**,
> the last core v8 trigger-durability gap. A run in-flight when the engine crashes/restarts is now
> RESUMABLE, not lost. Achieved via **Option X**: reuse the EXISTING ResumeCache/journal-replay (the same
> machinery suspend/resume relies on) plus a non-terminal `interrupted` status assigned at boot recovery
> and a persisted-journal READ-BACK — NO new sandbox-checkpoint / VM-snapshot protocol. No v1-core change
> (RunSpec/RunStore shapes, the journal format, and the terminal state machine untouched) — one new
> `RunStatus` value, one boot-recovery reclassify, one port read-back method (two impls), one rehydration-
> path change, one cosmetic CSS rule.
> Ledger items added this round: REQ-059 + REQ-060 (requirements pre-written, iter v8) → ARCH-034 →
> TASK-055 → DES-053 → IMPL-096 → IT-056 (4 cases, + a one-line IT-006 assertion update) →
> VAL-068 + VAL-069.

### Retro (v8 Defer A — crash durability)

- **What changed:** (a) `'interrupted'` added to the `RunStatus` union (`src/types.ts:5`) — a RESUMABLE,
  NON-terminal boot-recovery status distinct from user `suspended`/`stopped` (NOT in `TERMINAL`
  `src/run-manager.ts:69`, so it never fires onTerminal and stays resumable). (b) `hydrateAll` reclassifies
  boot-time `running` rows → `interrupted` (`src/store/sqlite-run-store.ts:222-227`, was force-to-`failed`),
  logging `… N re-classified running→interrupted (resumable)`. (c) a NEW `RunStore.getJournal(runId)`
  read-back (`src/run-store.ts:53-57`, `:185-187`; `src/store/sqlite-run-store.ts:113-124`) — reads
  journal.jsonl, drops the terminal `{type:'result'}` marker, ROBUST to a crash-truncated final line (an
  unparseable tail is skipped, not thrown — a real SIGKILL can leave a half-written line). (d) `_requireLive`
  now accepts `interrupted`, populates the rehydrated entry's `journal` from `getJournal` (was hard-coded
  `journal:[]`), and re-resolves a NAMED workflow's script from the catalog (`src/run-manager.ts:338,
  347-354, 369`); `resume()` accepts `interrupted` (`:271-273`). (e) a cosmetic `.st-interrupted` dashboard
  color (`src/dashboard-page.ts:28`).
- **Key decision:** Option X — reuse ResumeCache + a status gate + journal read-back, NOT a VM/sandbox
  checkpoint. The journal of settled `agent()`/`workflow()` calls IS the durable checkpoint; re-executing
  the script against a cache populated from it reconstructs the run's position by replaying settled calls
  and running only the unfinished tail — no new serialization format, reusing tested machinery. A
  mid-flight-at-crash call (dispatched but never journaled → cache MISS → live re-run on resume) is the
  SAME semantics suspend/resume already carries — a documented caveat, not silent loss; and a re-run tail
  call's non-idempotent side effects (e.g. an already-sent email) may repeat — the workflow author's
  responsibility, the same boundary suspend/resume has always had.
- **The real Gate-7.5 value story — a PRE-EXISTING bug found via live crash testing.** A NAMED-workflow run
  (`start({name})`) stores `spec.script = null` (start() resolves the script from the catalog at launch);
  `_requireLive` used `spec.script ?? ''`, so ANY restart-resume of a named workflow — not only a crash, but
  the pre-Defer-A suspended-run restart-resume path too — executed an EMPTY script and returned `undefined`,
  with only the pre-crash agent journaled. Every unit test missed it because they ALL used inline
  `start({script})`. Live Gate-7.5 crash testing of a named workflow (`lr4`) exposed it: the resumed run
  "completed" in ~0.13s with a null result and no re-dispatch. Fixed by re-resolving the script from the
  catalog in `_requireLive`, mirroring `start()`; after the fix the live resume returned a 5-element array
  of real opus responses. IT-056's third case is the deliberate regression guard. This is exactly the kind
  of confinement/rehydration bug the real-run validation gate exists to catch that a mock suite cannot.
- **Cross-slice interaction (recorded):** `hydrateAll` now yields `interrupted` (non-terminal) for a
  crashed run instead of `failed` (terminal). The Slice-4 boot-reconcile completeness argument ("every
  continuation target is terminal on boot, because hydrateAll marks a cross-restart running run failed")
  therefore shifts: a continuation whose target was running-at-crash now stays pending until that target is
  RESUMED to a terminal status, rather than being force-skipped at boot as a `failed` target — which is the
  more correct behavior (the downstream fires iff the resumed run actually completes), not a regression.
- **Gate 7.5:** PASSED 2026-08-01. Live production engine (systemd `rwe.service`, `127.0.0.1:8787`):
  registered named workflow `lr4` (5-iteration opus `agent()` loop), ran it, `kill -9` of the engine at
  ~1 agent done (status `running`); systemd restarted it. Boot log
  `hydrateAll: … 1 re-classified running→interrupted (resumable)`; `workflow_status` → **`interrupted`**
  (not `failed`); `workflow_resume` re-executed (~10s, re-dispatching the 4 remaining agents) →
  **`completed` with a 5-element array of real opus responses** (not `undefined` — the script-re-resolution
  fix). REQ-059/060 `real:true` (VAL-068/069).
- **No regressions:** full suite **662 pass / 150 files**, `npx tsc --noEmit` clean. No v1-core change —
  RunSpec/RunStore shapes, the journal format, the sandbox protocol, and the terminal state machine are
  untouched; Option X adds one status value + one boot reclassify + one read-back method + one rehydration
  change + one CSS rule. The one existing test touched is IT-006 (`run-store-persistence.test.ts`), a
  one-line assertion update (`interrupted` was `failed`) — the behavior REQ-060 deliberately changes, NOT a
  new IT id.
- **Still deferred (recorded, not this increment):** **SSE** (the dashboard keeps its 3s poll), **parallel()
  group markers** (needs a sandbox-child IPC change), the **static pre-read skeleton + `scriptVersion`
  cache**; and, as accepted caveats of Option X, the **mid-flight-at-crash re-run** (correct-by-design, same
  as suspend/resume) and **side-effect idempotency** of a re-run tail call. Full OIDC (REQ-012, D5) stays
  deferred; a public `0.0.0.0` bind without OIDC remains a documented deployment caveat (the Host/Origin
  allowlist REQ-056 is the interim control).
- **Trace note:** all Defer-A work items use `###` headings and this section deliberately avoids ID-shaped
  sub-headings, so it introduces no scanner collision (trace.py parses only `###`).

## v8 SLICE 2c + DEFER B GATE 8 REVIEW (2026-08-01, historical — superseded by the v8 Defer A section above)

> This section supersedes "## v8 SLICE 4 GATE 8 REVIEW (2026-08-01)" below (kept for history). This
> round lands TWO already-implemented, GREEN, real-validated slices: **Slice 2c — cross-restart DAG
> persistence** (the one real data-loss the observability slices left open: after a restart an
> out-of-process composite run's nested DAG/phases/agent-frames FLATTENED) and **Defer B — external-
> ingress security** (a Host/Origin allowlist + an HMAC-verified webhook ingress + a durable webhook
> registry — the interim access control before OIDC). No v1-core change in either — one engine-owned
> side table + one terminal-edge write (2c); one top-of-handler guard + one new route + one durable side
> table + three MCP tools (Defer B).
> Ledger items added this round: REQ-055 (2c) + REQ-056/057/058 (Defer B, requirements pre-written) →
> ARCH-032 + ARCH-033 → TASK-053 + TASK-054 → DES-050 + DES-051 + DES-052 → IMPL-094 + IMPL-095 →
> IT-052 (2 cases) + UT-063 (7) + IT-053 (5) + IT-054 (8) + IT-055 (1) → VAL-064 + VAL-065/066/067.

### Retro (v8 Slice 2c — cross-restart DAG persistence)

- **What changed:** a new `RunDagSnapshot {phases, agents, workflowNodes}` (`src/run-store.ts:60-65`) +
  `RunStore.saveSnapshot` port method, captured ONCE at the authoritative terminal `_transition`
  (`src/run-manager.ts:373-378`, via the in-process AgentExecutor's `getAllRecords()` so the persisted
  agents carry `label`/`phase`/`frame`/`startedAt`/`endedAt`, not just tokens), overlaid on `getRun`
  read-back in BOTH stores (`src/run-store.ts:150-158`, `src/store/sqlite-run-store.ts:179-193`) with a
  `?? deriveAgentRecords(...)` / `?? []` fallback. A migration-free side table
  `run_snapshots(runId PRIMARY KEY, json TEXT)` (`INSERT OR REPLACE`).
- **Key decision:** snapshot ONCE at the terminal edge (not incrementally — no torn half-tree, covers
  failed/stopped via the single choke); overlay-with-fallback keeps it strictly backward-compatible (a
  pre-change / no-snapshot run reconstructs exactly as today, never worse, never a crash); persist the
  enriched `getAllRecords()` (not the token-only transcript derivation) so `buildDagModel` regroups by
  `frame` + shows durations after a restart; a migration-free side table (same "don't touch v1 core"
  stance as the scheduler/continuation tables).
- **Gate 7.5:** PASSED 2026-08-01. Live engine restarted mid-run: `phase('top') → workflow('s2c-mid'){
  phase('p1') → workflow('s2c-leaf') }` — before restart `/api/runs/:id/dag` children `[(s2c-mid,1)]`;
  after restart STILL `[(s2c-mid,1)]` + `phases ['top']` + `workflowNodes ['s2c-mid','s2c-leaf']` — the
  DAG did NOT flatten (reversing the Slice-3 documented flattening). REQ-055 `real:true` (VAL-064).

### Retro (v8 Defer B — external-ingress security)

- **What changed:** (a) pure allowlist helpers `isAllowedHost`/`isAllowedOrigin` (`src/net-guard.ts:47-67`)
  enforced by a TOP-of-handler 403 guard uniform across `/mcp`, `/api/*`, `/dashboard`, `/hooks/*`
  (`src/server.ts:867-870`), plus a mutable `boundPort` assigned after listen (`:861`, `:986`) so the
  closure knows the real port. (b) a NEW durable `WebhookRegistry` (`src/webhook-registry.ts`) — SQLite
  side tables `webhooks` + `webhook_deliveries`, `create`/`list`/`delete`/`deliver`, the fail-closed
  verify+fire (`createHmac`/`timingSafeEqual` over the RAW body + ±300s window + `INSERT OR IGNORE`
  dedup + `runManager.start` pre-bound), reached through structural `RunManagerPort`/`CatalogPort` seams.
  (c) a `POST /hooks/:id` ingress route (`src/server.ts:895-917`) + `webhook_create`/`list`/`delete` MCP
  tools + config key `webhookDbPath`.
- **Key decision:** fail-OPEN on an absent Origin, fail-CLOSED on an absent Host (an absent Origin is the
  normal programmatic case — a fail-closed Origin check would break every non-browser MCP client; an
  absent Host is anomalous/rebinding-shaped). Store the webhook secret SERVER-SIDE (not a one-way hash)
  because HMAC verification needs the key — the GitHub/Stripe model; `list` exposes only a sha256
  fingerprint. Verify ORDER exists+enabled → signature-over-RAW-body → timestamp → delivery-dedup → fire,
  so authentication precedes any side effect and the fired workflow name is ALWAYS the stored
  registration (no workflow-selection injection).
- **Caught + fixed regression:** `webhook_list` is a genuine ZERO-ARG tool (`inputSchema.properties:{}`),
  which the existing IT-028 (`tests/integration/mcp-tools-list-schema.test.ts`) flags UNLESS allowlisted —
  added `webhook_list` to that test's `ZERO_ARG_TOOLS` (a one-line update, NOT a new IT id) alongside
  `chain_list`/`schedule_list`/`asset_list`.
- **Gate 7.5:** PASSED 2026-08-01. Live engine (33 tools incl. `webhook_*`): allowlist `curl -H 'Host:
  evil.example.com'` → 403, normal → 200, `-H 'Origin: http://evil.example.com' POST /mcp` → 403; webhook
  `webhook_create` → `{url, secret}`, a signed `POST /hooks/:id` (openssl HMAC) → 202 `{runId}`, the
  pre-bound workflow ran → `{got:{deploy:'v9'}}` (body → `args.event`), a replay of the same delivery →
  200 (no second run), `webhook_list` fingerprint-only. REQ-056/057/058 `real:true` (VAL-065/066/067).

### Combined (both slices)

- **No regressions:** full suite **658 pass / 149 files**, `npx tsc --noEmit` clean. No v1-core change in
  either slice — RunSpec/RunStore/journal untouched (2c adds an engine-owned migration-free side table +
  one terminal-edge write; Defer B adds a top-of-handler guard, one route, one durable side table, three
  tools). The run lifecycle (RunGuard budget, agent semaphore, `_transition` state machine) is otherwise
  untouched.
- **Still deferred (recorded, not these increments):** Slice 2c's remaining dashboard items — **Item B =
  SSE** (the page keeps the 3s poll), **Item C = parallel-group markers** (which siblings ran as one
  `parallel()` batch — needs a sandbox-child IPC change), **Item D = static pre-read skeleton +
  `scriptVersion` cache**; and **Defer A = durable in-flight-graph suspend/resume** (persist/rehydrate a
  mid-execution call-tree across restart — 2c persists a run's DAG only at TERMINAL, not mid-flight). Full
  OIDC (REQ-012, D5) stays deferred; a public `0.0.0.0` bind without OIDC remains a documented deployment
  caveat — the Host/Origin allowlist (REQ-056) is the interim control.
- **Trace note:** all Slice-2c + Defer-B work items use `###` headings and this section deliberately
  avoids ID-shaped sub-headings, so it introduces no scanner-collision (trace.py parses only `###`).

## v8 SLICE 4 GATE 8 REVIEW (2026-08-01, historical — superseded by the v8 Slice 2c + Defer B section above)

> This section supersedes "## v8 SLICE 2b GATE 8 REVIEW (2026-07-31)" below (kept for history). v8
> Slice 4 is CROSS-TRIGGER CHAINING + RUN-ADMISSION — the last core v8 trigger mechanism: runs can now
> durably trigger runs, and the engine bounds how many top-level runs may be live at once. No v1-core
> change (RunSpec/RunStore/journal untouched) — one authoritative terminal notification (`onTerminal`),
> one engine-owned durable side table (continuations), one admission counter.
> Ledger items added this slice: REQ-052/053/054 (requirements, pre-written) → ARCH-031 → TASK-052 →
> DES-048 + DES-049 → IMPL-093 → IT-050 (4 cases) + IT-051 (6 cases) → VAL-061/062/063.

### Retro (v8 Slice 4)

- **What changed:** (a) `RunManager` gained an authoritative `onTerminal(runId,status)` hook fired from
  the ONE `_transition` choke (`src/run-manager.ts:369-380`) via `queueMicrotask`+`try/catch`
  (fire-and-forget, covers `stopped`) + a `maxConcurrentRuns` admission gate at the top of `start()`
  (`:204-210`, default 64 via the existing `_positiveInt` validator, counting non-terminal `_runs` with
  `_liveRunCount()` `:162-164`). (b) a NEW durable `ContinuationStore` (`src/continuation-store.ts`) —
  SQLite+WAL side table mirroring the scheduler, `chainCreate`/`onTerminal`/`rearmAtBoot`/`list` +
  atomic `WHERE status='pending'` reconcile + `_rootOf` lineage, reached through structural
  RunManagerPort/RunStorePort seams (no class import). (c) `chain_create`/`chain_list` MCP tools + a
  late-bound `let continuations` closure in server composition (`src/server.ts:706-711`) breaking the
  RunManager↔store construction cycle. Config keys `maxConcurrentRuns`/`continuationDbPath`
  (`src/main.ts`, `rwe.config.example.json`).
- **Key decision:** fire `onTerminal` from `_transition` (the single authoritative terminal writer), NOT
  the `_runLive` `.then` (which never sees `stop()`); fire-and-forget so a continuation's real `start(B)`
  can never wedge A's terminal write. Admit BEFORE any durable work — the run-count/sandbox-fork DoS
  chokepoint the global agent-semaphore (which caps only `agent()` dispatch) does not provide; a nested
  `workflow()` consumes no slot. completed→fire, failed/stopped→skip. Boot-reconcile is COMPLETE because
  `hydrateAll` marks a cross-restart running run `failed`, so a continuation's target is always terminal
  on boot — no "stuck pending forever" hole.
- **Caught + fixed regression:** `chain_list` is a genuine ZERO-ARG tool (`inputSchema.properties:{}`),
  which the existing IT-028 (`tests/integration/mcp-tools-list-schema.test.ts`) flags as a schema
  violation UNLESS allowlisted — added `chain_list` to that test's `ZERO_ARG_TOOLS` (a one-line update,
  NOT a new IT id) alongside `workflow_list`/`schedule_list`/`asset_list`.
- **Gate 7.5:** PASSED 2026-08-01. Live production engine (systemd `rwe.service`, `127.0.0.1:8787`,
  `tsx src/main.ts`) restarted with the Slice-4 code; `tools/list` served 30 tools incl.
  `chain_create`/`chain_list`. LATE-CREATE: `chain_create` after target `A` completed → `chain_list`
  `status:'fired', rootRunId:A, spawnedRunId:<B>`, `workflow_result(B)==="B-ran"` (chained run really
  ran). LIVE onTerminal: an in-flight opus `A2` chained mid-run fired its continuation on real
  completion. REQ-052/053 `real:true`; REQ-054 `real:true` honest-partial via IT-050 (VAL-061/062/063).
- **No regressions:** full suite 635 pass / 144 files, `npx tsc --noEmit` clean. No v1-core change —
  RunSpec/RunStore/journal untouched; the ContinuationStore is an engine-owned durable side table (same
  "don't touch v1 core" stance as the scheduler), and admission + onTerminal are the only run-lifecycle
  additions (RunGuard budget + agent semaphore untouched).
- **Deferred (recorded, not this increment):** external ingress security = **Defer B** (authn/z +
  rate-limit on any public trigger surface); durable in-flight-graph suspend/resume = **Defer A**
  (persist/rehydrate a mid-execution call-tree across restart); and the Slice-2c dashboard items
  (parallel-group markers, cross-restart phase/tree persistence, SSE, static pre-read + scriptVersion
  cache) carried forward from the Slice-2b retro below.
- **Trace note:** all Slice-4 work items use `###` headings and this section deliberately avoids
  ID-shaped sub-headings, so it introduces no scanner-collision (trace.py parses only `###`).

## v8 SLICE 2b GATE 8 REVIEW (2026-07-31, historical — superseded by the v8 Slice 4 section above)

> This section supersedes "## v8 SLICE 3 GATE 8 REVIEW (2026-07-31)" below (kept for history). v8
> Slice 2b is the LIVE-EXECUTION-DETAIL layer over Slice-2/Slice-3's call-tree read-model + dashboard:
> it adds the two "what is happening right now" signals the dashboard was missing — a phase timeline
> (with timestamps + a current-step marker) and per-agent timing (dispatch→settle duration) — a
> read-model/observability extension, no execution-semantics change.
> Ledger items added this slice: REQ-050/051 (requirements, pre-written) → ARCH-030 → TASK-051 →
> DES-047 → IMPL-092 → UT-062 (1 case) + IT-049 (2 cases) → VAL-059/060.

### Retro (v8 Slice 2b)

- **What changed:** `PhaseView.ts` made a REQUIRED field so every `phases[]` entry carries the ISO time
  its `phase()` was entered (`src/types.ts`, stamped in the sandbox `onPhase` callback via the injectable
  `Clock`, `src/run-manager.ts:357`); `AgentRecord` gains `startedAt` (stamped at the slot-acquired
  `markRunning` seam, `src/run-manager.ts:494` → `src/agent-executor.ts:128-130`) + `endedAt` (the
  `capture()` clock time, carried on both ok+failed branches, `src/agent-executor.ts:135-153`);
  `buildDagModel` exposes `startedAt`/`endedAt` + a derived non-negative `durationMs`
  (`undefined` while unfinished, `src/dashboard.ts:54-55`); and the dashboard detail page renders a
  `#phases` timeline (each phase a chip with its `ts` tooltip, the last chip marked `cur` only while
  `running`) plus each agent node's `<n> ms` duration (`src/dashboard-page.ts`).
- **Key decision:** stamp `startedAt` at `markRunning` (slot-acquired / dispatch), NOT at enqueue — so
  `durationMs` measures real execution, not queue wait, and a queued-not-yet-dispatched agent stays
  timestamp-less (per REQ-051). Derive `durationMs` in the model (`max(0, endedAt − startedAt)`), don't
  persist it — one source of truth in the two timestamps, `undefined` for an unfinished agent for free.
  Use the ONE injectable `Clock` for both the phase `ts` and the agent timing, so an advancing test clock
  makes the timeline ordering + `endedAt ≥ startedAt` deterministically assertable (IT-049).
- **Gate 7.5:** PASSED 2026-07-31. Live production engine (systemd `rwe.service`, `127.0.0.1:8787`,
  `tsx src/main.ts`) restarted with the Slice-2b code; an ad-hoc `phase('draft'); agent 'pinger'(opus);
  phase('done')` run in-process returned `phases:[{draft,ts},{done,ts}]` (ordered) and an agent record
  `{startedAt,endedAt}` (~5.3s real opus call, `endedAt ≥ startedAt`) from `GET /api/runs/:id`;
  `/dashboard/:runId` (DOM-verified) rendered `#phases` chips `['draft','done']` each with its `ts`
  tooltip and the agent node text `pinger opus done 7 tok 5325 ms`. REQ-050/051 both `real:true`
  (VAL-059/060).
- **No regressions:** full suite 625 pass / 142 files, `npx tsc --noEmit` clean; only the read-model
  presentation changed (two timestamps + a derived duration + timeline/duration rendering) — no
  run-lifecycle / budget / concurrency state added. `src/mcp-facade.ts` unchanged. The one compile
  consequence — a `PhaseView` fixture in `tests/unit/dashboard-model.test.ts` gaining `ts` — is the cost
  of making `ts` required.
- **Deferred to Slice 2c (recorded, not this increment):** parallel-group markers (which sibling nodes
  ran as one `parallel()` batch — needs a sandbox-child protocol change to report batch membership);
  cross-restart phase/tree persistence (after a service restart an out-of-process run's phases/tree are
  not rehydrated — the live timeline/tree lives in the per-process `RunEntry`); SSE (the page keeps the
  3-second poll); static pre-read + `scriptVersion` cache (serve the skeleton before the run starts).
- **Trace note:** all Slice-2b work items use `###` headings and this section deliberately avoids
  ID-shaped sub-headings, so it introduces no scanner-collision (trace.py parses only `###`).

## v8 SLICE 3 GATE 8 REVIEW (2026-07-31, historical — superseded by the v8 Slice 2b section above)

> This section supersedes "## v8 SLICE 2 GATE 8 REVIEW (2026-07-30)" below (kept for history). v8
> Slice 3 is the PRESENTATION layer over Slice-2's frame-tagged read-model: it turns the flat
> read-model into a PURE call-tree model and the browser-facing dashboard that renders cards → a nested
> composite DAG → an agent transcript — a read-model reshaping + a page, no execution-semantics change.
> Ledger items added this slice: REQ-048/049 (requirements, pre-written) → ARCH-029 → TASK-050 →
> DES-045/DES-046 → IMPL-091 → UT-061 (3 cases) + IT-048 (2 cases) → VAL-057/058.

### Retro (v8 Slice 3)

- **What changed:** `buildDagModel(RunStatusView) → DagNode` (`src/dashboard.ts`) — a PURE, total
  reconstruction of a run's call-tree (group agents by `frame`, nest composite frames by `parentFrame`,
  root-fallback so no agent is dropped) — plus two read-only endpoints on the existing dashboard-API
  transport (`GET /api/workflows` → the registered catalog for home cards; `GET /api/runs/:id/dag` →
  `buildDagModel(view)`), and a rewritten self-contained SPA (`src/dashboard-page.ts`) that renders
  workflow + run cards on `/dashboard`, a recursive nested-group DAG (composite `.grp` groups, 3-state
  agent nodes showing model) on `/dashboard/:runId`, and an agent transcript drill-down, on a 3-second
  poll. `buildDagModel` is shared by the endpoint AND the page — one tested model, no browser-side tree
  logic.
- **Key decision:** keep one pure `buildDagModel` (unit-tested, UT-061) served whole by `/api/runs/:id/dag`
  and just walked by the page's `renderNode`, rather than rebuild the tree in client JS — one
  reconstruction, one test. Make it total (never throws, never drops an agent: orphan parentFrame →
  root, unknown agent frame → root) so the dashboard degrades to a flatter-but-complete tree, never a
  500 or a missing agent.
- **Gate-7.5-caught routing gap:** the top-level request router's dispatch predicate matched only
  `/api/runs*`, so `GET /api/workflows` fell through to the `/mcp` JSON-RPC handler and returned
  `-32601` (method-not-found). Caught on the real run at Gate 7.5 and fixed by widening the predicate to
  also match `/api/workflows` (`src/server.ts:797`) — one shared `handleDashboardRequest` branch, no
  second handler. Regression-locked by IT-048's `GET /api/workflows` case.
- **Gate 7.5:** PASSED 2026-07-31. REQ-049 fully live via a headless browser (Playwright) — `/dashboard`
  rendered workflow + run cards; a nested composite `dag2mid → dag2leaf → agent 'pinger'(opus)` opened
  at `/dashboard/<runId>` rendered `groupHeaders = ["workflow dag2mid · depth 1","workflow dag2leaf ·
  depth 2"]`, the agent node nested two groups deep (`node st-done`, `pinger opus done 7 tok`), and
  clicking it loaded the real opus transcript ("PONG"). REQ-048 (`buildDagModel`) real:true via UT-061 +
  the live `/dag` tree.
- **No regressions:** full suite 622 pass / 141 files, `npx tsc --noEmit` clean; only the read-model
  presentation changed (a pure `buildDagModel` + two read-only endpoints + the page) — no run-lifecycle
  / scheduling state added. `src/mcp-facade.ts` unchanged.
- **Deferred (recorded, not this increment):** server-sent events (the page keeps the 3-second poll);
  parallel-group markers (which sibling nodes ran as one `parallel()` batch); phase persistence +
  current-step + timing (per-node start/end/duration); static pre-read + `scriptVersion` cache (serve
  the tree skeleton before the run starts); cross-restart tree persistence (after a service restart an
  out-of-process run's `/api/runs/:id/dag` flattens because `getRun()` returns `workflowNodes: []` — the
  live tree lives in the per-process `RunEntry`; a later increment can back it with a persisted node
  table without changing the shape — exactly REQ-047's documented cross-restart-out-of-scope, confirmed
  live).
- **Trace note:** all Slice-3 work items use `###` headings and this section deliberately avoids
  ID-shaped sub-headings, so it introduces no scanner-collision (trace.py parses only `###`).

## v8 SLICE 2 GATE 8 REVIEW (2026-07-30, historical — superseded by the v8 Slice 3 section above)

> This section supersedes "## v8 SLICE 1 GATE 8 REVIEW (2026-07-30)" below (kept for history). v8
> Slice 2 is the first increment of the dashboard DATA layer over Slice 1's N-level composition: it
> SURFACES the already-computed frame structure so a client can reconstruct a composite run's live
> call-tree (DAG) and drill from any node to its transcript — a read-model/observability extension,
> no execution-semantics change. Ledger items added this slice: REQ-045..047 (requirements,
> pre-written) → ARCH-028 → TASK-049 → DES-043/DES-044 → IMPL-090 → IT-047 (2 cases) → VAL-054..056.

### Retro (v8 Slice 2)

- **What changed:** each `agent()` record now carries the composite `frame` it ran in (root `""`; a
  nested agent's frame has its parent frame as a strict prefix), each nested `workflow()` call is
  recorded as a `workflowNodes` boundary node `{frame,name,parentFrame,depth}`, and both are exposed
  through the existing `workflow_status` / `GET /api/runs/:id` read-model — so the dashboard can render
  a composite as nested sub-cards and click a node to its log. `mcp-facade.ts` needed no change (it
  already returns the full `RunStatusView` as `result`).
- **Key decision:** reuse the ARCH-027 frame-path key as the tree key rather than mint a parallel
  id-space — so `node.frame == its inner agents' frame` holds by construction (one source of frame
  identity for both journal namespacing and tree linkage), and the frame is stamped at `markQueued`
  (not `capture`) so in-flight/queued agents already carry it (REQ-047's "current step = the running
  node").
- **Gate 7.5:** PASSED 2026-07-30. REQ-046/047 fully live — a model-free composite (`dagmid` →
  `workflow('dagleaf')`) run against the live engine returned, via real MCP, `workflowNodes:
  [{frame:".0",name:"dagmid",parentFrame:"",depth:1},{frame:".0.0",name:"dagleaf",parentFrame:".0",depth:2}]`
  (correct depth/parentFrame hierarchy, `dagleaf.parentFrame == dagmid.frame`). REQ-045 (agent frame
  tagging) is `real:true` via the real-sandbox integration test IT-047 (a live agent needs a model
  provider, so the live check used the model-free linkage path) — honest partial mirroring the
  VAL-046/051 precedent.
- **No regressions:** full suite 617 pass / 140 files, `npx tsc --noEmit` clean; only the read-model
  changed (agents gain a `frame`, a per-run `workflowNodes` list is populated + exposed) — no
  run-lifecycle / scheduling state added.
- **Deferred (recorded, not this increment):** parallel-group markers (which sibling nodes ran as one
  `parallel()` batch); phase persistence + current-step + timing (per-node start/end/duration);
  static pre-read + `scriptVersion` cache (serve the tree skeleton before the run starts); cross-restart
  tree persistence (the persisted/derived `getRun()` path defaults `workflowNodes: []` — the live tree
  lives in the per-process `RunEntry`; a later increment can back it with a persisted node table without
  changing the shape). These are the natural next Slice-2 increments toward the full dashboard.
- **Trace note:** all Slice-2 work items use `###` headings and this section deliberately avoids
  ID-shaped sub-headings, so it introduces no scanner-collision (the trace.py item regex now parses
  only `###`, per the Slice-1 carry-forward fix).

## v8 SLICE 1 GATE 8 REVIEW (2026-07-30, historical — superseded by the v8 Slice 2 section above)

> This section supersedes "## v7 GATE 8 CLOSING REVIEW (2026-07-24)" below (kept for history). v8
> Slice 1 lifts one-level `workflow()` nesting into config-capped N-level composition with cycle +
> descendant guards and a depth-safe journal keying rework. Ledger items added this slice: REQ-041..044
> (requirements, pre-written) → ARCH-027 → TASK-048 → DES-041/DES-042 → IMPL-089 → IT-046 (7 cases,
> +IT-026 regression) → VAL-050..053. Gate 7.5 v8 Slice 1 ROUND 1 PASSED 2026-07-30: REQ-041 fully
> live (CASE A depth-2 `"M(L)"`; CASE B depth-3 → `NESTING_DEPTH_EXCEEDED` under live `maxWorkflowDepth:2`);
> REQ-042/043/044 real:true via the real-wiring integration test IT-046 + the same live nested code
> path (honest partial on the isolated guard/budget probes, mirrors the VAL-046 pattern).

### 1. Traceability

`sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check` regenerated. The v8 chain is
intact end-to-end: REQ-041..044 → ARCH-027 (traces all four REQs) → TASK-048 → DES-041/042 →
IMPL-089 (traces TASK-048 + DES-041/042, greens) and IT-046 (traces DES-041/042) + VAL-050..053
(each traces its REQ, real:true) — so all four REQs are implemented, verified, and real-verified (no
新 未實作 / 未驗證 / 未真實驗證 gap from this slice). All v8 items carry `iter: v8`; no doc↔code drift
(IMPL-089 v8 traces DES-041/042 v8, equal iter).

Pre-existing gaps unrelated to this slice are NOT touched: REQ-012 未真實驗證 (OIDC deferred, D5) and
TASK-018 未實作 (OIDC seam) remain accepted tech debt. NB — a pre-existing scanner collision (the v7
review's `#### ARCH-025`/`#### ARCH-026` sub-headings match trace.py's `#{2,4}` item regex and, being
scanned after 02-architecture.md, overwrite the real ARCH-025/026 traces) currently shows REQ-037..040
as 未實作; this predates v8, is out of this slice's scope, and is left recorded here rather than
silently patched. This v8 section deliberately avoids ID-shaped sub-headings so it introduces no new
collision.

### 2. Architecture consistency — ARCH-027 (lean-tier self-check, QM)

Checked against the v8-touched files on IMPL-089: `src/run-manager.ts` (nesting context + 3 guards +
`_frameBaseFor`/`NESTED_FRAME_STRIDE` + `_positiveInt`), `src/server.ts` + `src/main.ts` (config
threading), `rwe.config.example.json`. The three guards fire at the `onWorkflowRequest` boundary in
the ARCH-027-specified order (depth → cycle → descendant), each as a typed envelope error; the nested
child shares the parent `RunEntry`/`RunGuard` (shared-budget invariant by construction); the additive
frame keying replaces the overflowing multiplicative scheme. Consistent with ARCH-027 and its
Depends (ARCH-002 run/journal/budget, ARCH-005 catalog resolution, ARCH-001 config threading). No
drift found.

### Retro (v8 Slice 1)

- **What changed:** one-level `workflow()` nesting → N-level composition (default depth 4 /
  descendants 256, both config-validated at load), so a registered composite can be a node inside
  another — the foundation for composing workflows into a system graph.
- **Key finding (callSeq overflow):** the v1 multiplicative nested-callSeq keying `(parentCallSeq+1)*1e6+n`
  overflows `MAX_SAFE_INTEGER` past ~depth 2 and would corrupt resume replay at depth ≥3. Reworked to
  an additive per-frame base allocation, deterministic across resume (incl. `parallel()` array order);
  regression-guarded by IT-026 staying green.
- **No regressions:** full suite 615 pass / 139 files, `npx tsc --noEmit` clean; only the nesting path
  changed (nested child reuses parent budget/journal — no new run-lifecycle state).
- **Carry-forward:** the trace.py `#{2,4}` heading-collision (ARCH-025/026 in 07-review.md) is worth a
  tooling fix (restrict item headings to `###`, or de-dupe by first occurrence) so review prose can
  cite IDs in sub-headings without breaking upstream chains — deferred, not v8-scope.

Gaps: high=1 mid=5 low=1 — ALL pre-existing and out-of-v8-scope (high=REQ-012 未真實驗證; mid=REQ-037..040
未實作 [v7 review heading-collision] + IMPL-082 TDD label; low=TASK-018 未實作). 0 new gaps from the v8
slice. Conclusion: v8 Slice 1 can close; the four REQs are fully traced + real-validated.

## v7 GATE 8 CLOSING REVIEW (2026-07-24, CURRENT / AUTHORITATIVE)

> This section supersedes "## v6 GATE 8 CLOSING REVIEW (2026-07-19)" below (kept for history). v7
> adds provider-native SDK routing + OpenRouter first-class provider + `models_list` federated
> catalog (ARCH-025/026). REQ-037..040 / IMPL-087/088 / VAL-046..049. Gate 7.5 v7 ROUND 1 PASSED
> 2026-07-24: all four REQs real-validated against live engine (28 tools, real OPENROUTER_API_KEY);
> REQ-037 security invariant real (unit-real test); REQ-038 OpenRouter passthrough → "PONG" live;
> REQ-039 federated catalog 100 entries live; REQ-040 filter live (5 results). Anthropic-direct live
> auth: honest partial (no anthropic alias+key on this engine — not a code defect).

### 1. Traceability (398 items, 3 gaps)

`sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check` — 398 items scanned, 3 gaps
detected (exit 1). Dashboard regenerated: `dashboard.html`.

V7 adds 19 traceability items (REQ-037..040, ARCH-025/026, TASK-046/047, DES-039/040, IMPL-087/088,
UT-059/060, IT-045, VAL-046..049). All chains are intact. The 3 remaining gaps are identical to v6
— all pre-existing and out-of-v7-scope:

| Sev | Type | ID | Description | Classification |
|---|---|---|---|---|
| HIGH | 未真實驗證 | REQ-012 | no real:true VAL; mock-only | OIDC deferred; accepted gap D5 |
| MID | TDD | IMPL-082 | no test item directly cites IMPL-082 | trace-label cleanup; covered in substance (IT-042/VAL-033) |
| LOW | 未實作 | TASK-018 | no corresponding implementation | OIDC deferred; accepted gap D5 |

Zero drift: all v7 ledger items (ARCH-025/026 / TASK-046/047 / DES-039/040 / IMPL-087/088 /
UT-059/060 / IT-045 / VAL-046..049) carry `iter: v7`. No IMPL/DES/UT with mismatched iter stamps
relative to their upstream within v7.

### 2. Architecture Consistency — v7 ARCH-025/026 (lean-tier self-check, QM)

No pre-run panel reports exist for the v7 scope (no `.panel/` directory). Per lean-tier rules (QM,
single-area, v7 slice), the architecture-consistency check is performed here against the v7-touched
files listed on IMPL-087/088 in 06-impl-log.md: `src/gateway/claude-agent-sdk-client.ts` (provider-
aware routing additions), `src/gateway/client.ts` (openrouter provider case), `src/gateway/
litellm-proxy.ts` (`openrouter/*` wildcard), `src/submission-validator.ts` (passthrough acceptance),
`src/main.ts` (config threading), `src/models/model-catalog.ts` (NEW), `src/server.ts` (models_list
wiring).

#### ARCH-025 — Provider-native SDK routing + OpenRouter provider (IMPL-087)

_Provider-aware routing split at SDK-session build time:_
`effectiveProvider()` (sdk-client.ts:206-208) derives the provider from the alias table for
configured aliases, or from the `openrouter/` prefix for passthrough model strings. `buildSubprocessEnv()`
(sdk-client.ts:350-367) branches on `provider === 'anthropic'`: Anthropic-direct path gets
`ANTHROPIC_BASE_URL = anthropicBaseUrl ?? 'https://api.anthropic.com'` and real auth; every other
provider (openai/openrouter/ollama/gemini/unknown) gets `ANTHROPIC_BASE_URL = config.baseUrl` (the
managed LiteLLM proxy) and the dummy key. Consistent with ARCH-025's "LiteLLM bypassed for
anthropic; translation layer preserved for everything else."

_SECURITY INVARIANT — VERIFIED GREEN:_

(a) **Real ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN in subprocess env ONLY**: `ENV_ALLOWLIST`
(sdk-client.ts:330) = `['PATH', 'HOME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'TERM']`. Neither
`ANTHROPIC_API_KEY` nor `CLAUDE_CODE_OAUTH_TOKEN` appears in this list. The real key or oauth token
is injected only in the `provider === 'anthropic'` branch of `buildSubprocessEnv()` (lines 356-361),
directly into the SDK subprocess `options.env` field (line 557). The code comment on `buildSubprocessEnv()`
explicitly states: "The real key / oauth token is injected ONLY here, into the SDK subprocess env —
never written to the run workspace, sandbox, or any transcript (D-R2)." No log path, no workspace
write, no transcript capture reads from `envResult.env`; the env is passed directly to `options.env`.

(b) **CLAUDE_CODE_OAUTH_TOKEN NOT in ENV_ALLOWLIST**: Verified — it is absent from `ENV_ALLOWLIST`
(line 330). The code comment at line 347 states explicitly: "CLAUDE_CODE_OAUTH_TOKEN is an auth var
treated like the ANTHROPIC_* pair (deliberately NOT added to ENV_ALLOWLIST, which is for benign host
vars only)." Consistent with ARCH-025 invariant.

(c) **Missing auth → ANTHROPIC_AUTH_MISSING typed error, never a silent dummy attempt**:
`resolveAnthropicAuth()` (lines 96-108) returns `{ok:false}` when the required secret is absent for
the configured mode. `buildSubprocessEnv()` (line 358) propagates to `{ok:false, detail:'ANTHROPIC_AUTH_MISSING'}`.
`_invokeOnce()` (lines 491-494) returns a typed terminal `GatewayResult` immediately, before
`this._query()` is ever called. The dummy key (`DUMMY_API_KEY`) is assigned ONLY in the non-anthropic
branch (line 365). Consistent with ARCH-025: "required-secret-missing case is a TYPED
ANTHROPIC_AUTH_MISSING error, never a silent dummy-key run."

(d) **Passthrough models not proxy-cloaked (route-back fix)**: `isPassthroughModel()` (lines 200-202)
returns true for any `model.startsWith('openrouter/')`. In `_invokeOnce()` (lines 499-503), the
`modelName` assignment is: if `anthropicTarget` → real Anthropic id; else if `isPassthroughModel`
→ `req.opts.model` (the raw `openrouter/<id>` string, not cloaked); else `proxyModelName(...)`. The
raw string matches LiteLLM's `openrouter/*` wildcard (litellm-proxy.ts line 71: `model_name:
"openrouter/*"`). No `rwe-proxy-` prefix ever applied to a passthrough model. Consistent with
ARCH-025: "passthrough model string openrouter/<id> is NOT alias-cloaked."

_OpenRouter as first-class provider:_
- `AliasMap` type (client.ts line 9) admits `'openrouter'` as a valid provider value.
- `litellm-proxy.ts` generates the `openrouter/*` wildcard route (reads `OPENROUTER_API_KEY` from the
  proxy env, not from the subprocess env — the key stays in the LiteLLM process where it belongs).
- `submission-validator.ts` (lines 107-112): an `openrouter/<id>`-shaped model string passes the
  UNKNOWN_ALIAS check via `OPENROUTER_PASSTHROUGH` regex when `openrouterPassthrough` is true
  (default). Not rejected as an unknown alias.
- `client.ts` (lines 128-143): direct-fetch path has an explicit `openrouter` case using its own
  `OPENROUTER_API_KEY` — separate from `OPENAI_API_KEY`, no global `OPENAI_API_BASE` remap.
Consistent with ARCH-025.

_main.ts config threading:_
`composeConfig()` (main.ts lines 55-60, 183-188) threads `secretSource` (from `loadSecretSourceFromEnv()`),
`anthropicBaseUrl`, and `anthropicAuth` into `ClaudeAgentSdkGatewayConfig`. Consistent with
ARCH-025: config seams properly wired from the composition root.

**ARCH-025 architecture-consistency summary:**
- HIGH findings: 0
- MEDIUM findings: 0
- LOW findings: 0
- Security invariant: VERIFIED GREEN on all four checks (a)(b)(c)(d).

#### ARCH-026 — Model catalog (`models_list`) (IMPL-088)

_Federation from four sources:_
`buildCatalog()` (model-catalog.ts:167-186) assembles: (1) `STATIC_ANTHROPIC` + `STATIC_OPENAI`
static tables (included by default), (2) live Ollama `/api/tags` via `fetchOllama()`, (3) live
OpenRouter `/api/v1/models` via `fetchOpenRouter()`, (4) curated-alias overlay via `overlayAliases()`.
Sources run concurrently via `Promise.all`. Consistent with ARCH-026.

_Injectable fetchers (test seams):_
`BuildCatalogOptions` (lines 35-48) exposes `ollamaFetch`, `openrouterFetch`, `ollamaBaseUrl` —
all optional; defaults are the global `fetch` and the `OLLAMA_BASE_URL` env var. `ServerConfig`
(server.ts line 87) carries `modelCatalogFetchers` which are passed through to `buildCatalog()`
(server.ts lines 700-703). Consistent with ARCH-026: "injectable fetchers … tests fake the fetch
transport."

_Graceful degradation:_
`Promise.all([fetchOllama(...).catch(() => []), fetchOpenRouter(...).catch(() => [])])` (lines 178-181).
A throw/timeout/non-ok from either live source contributes zero entries while the static table and
aliases still return. Each `fetchWithTimeout()` (lines 70-78) has its own `AbortController` with
`timeoutMs` bound. The server-side builder (server.ts line 699) uses `config?.modelCatalog` (fully
injectable at the server level) — integration test IT-045 exercises this seam directly.
Consistent with ARCH-026: "degrades gracefully — an unreachable live catalog drops only its own
entries."

_Unified ModelEntry shape:_
`ModelEntry` interface (lines 10-21): `{provider, model, alias?, description, modalities:{in,out},
contextWindow, price, toolUse, location}` — all fields present, including `alias?` for the curated
overlay. All four source paths populate this shape. Consistent with ARCH-026.

_SECRET-FREE output:_
`buildCatalog()` (and `fetchOllama()` / `fetchOpenRouter()`) reads no credentials — no auth header
is set in any fetch call (OpenRouter's models list endpoint is public). No `ModelEntry` field can
hold a key value — the type itself has no such field. `OPENROUTER_API_KEY` is read only in
`litellm-proxy.ts` (proxy config generation) and `client.ts` (direct-fetch path) — not in
`model-catalog.ts`. Consistent with ARCH-026: "NO secret/API-key value ever appears in the output
(secret-separated by construction — this module reads no credentials at all)."

_Filtering (AND-filter + limit + empty-match):_
`filterCatalog()` (lines 203-224) chains all filter dimensions (`provider`, `location`, `toolUse`,
`modalityIn`, `modalityOut`, `minContext`, `maxPricePerM`, `query`) as explicit `if (filter.X !==
undefined && ...)` guards — every dimension is optional; all must pass. `limit` is capped at
`min(max(1, limit ?? 100), 500)`. An unmatched filter returns `[]`, not an error (`.slice(0, limit)`
on an empty `matched` array). Consistent with ARCH-026: "AND-filter … an empty match returns []."

_Server wiring (ARCH-001 tool surface):_
`'models_list'` in `TOOL_NAMES` (server.ts line 138). `TOOL_METADATA` entry (lines 387-417) has
description + input schema with all filter parameters. `callTool` case (lines 563-565) calls
`buildModelCatalog()` and passes `args` as `CatalogFilter`. `buildModelCatalog` is the injectable
seam (line 477): uses `config?.modelCatalog` override if provided (test path), else constructs the
real `buildCatalog()` call with the live fetchers and alias table. Consistent with ARCH-026:
"Surfaces as MCP tool models_list … ServerConfig exposes injectable catalog seams."

**ARCH-026 architecture-consistency summary:**
- HIGH findings: 0
- MEDIUM findings: 0
- LOW findings: 0
- ARCH-026 implemented exactly as specified; no deviations from decision rationale.

#### v7 architecture-consistency overall

- New HIGH findings: 0
- New MEDIUM findings: 0
- New LOW findings: 0 (DEPLOY.md doc gap recorded separately in §3 below — not an ARCH violation)
- Architecture consistent: YES. ARCH-025/026 are implemented exactly as specified. Security
  invariant: VERIFIED GREEN (all four checks pass).

### 3. Validation and Handover

Gate 7.5 v7 ROUND 1 passed (2026-07-24, `08-validation.md` §v7 ROUND 1). VAL-046..049 all
real-tier:

- VAL-046 (REQ-037): real — provider-aware routing decision + security invariant confirmed by
  `tests/unit/claude-agent-sdk-provider-aware-env.test.ts` (real unit test, no SUT-boundary mock;
  real `ClaudeAgentSdkGatewayClient` instance, actual `options.env` inspected). ANTHROPIC_API_KEY /
  CLAUDE_CODE_OAUTH_TOKEN appear only in subprocess options.env; api-key and subscription modes both
  pass; missing secret → typed ANTHROPIC_AUTH_MISSING. Non-Anthropic live path confirmed by
  REQ-038's `workflow_run` → "PONG" via OpenRouter. Anthropic-direct live auth: honest partial
  (no anthropic alias+key on this engine; routing decision is real:true).
- VAL-047 (REQ-038): real — `workflow_run` with `openrouter/nex-agi/nex-n2-pro` (passthrough id,
  not a pre-listed alias) against live engine → `result:"PONG"`. Full SDK→LiteLLM→OpenRouter chain.
  Passthrough id NOT proxy-cloaked (isPassthroughModel guard). No SUT-boundary mock.
- VAL-048 (REQ-039): real — `models_list{}` → 100 entries: `{anthropic:3, openai:3, ollama:3,
  openrouter:91}`. Live Ollama `/api/tags` + live OpenRouter `/api/v1/models` both queried at
  call time. No key/secret in any entry. No SUT-boundary mock.
- VAL-049 (REQ-040): real — `models_list{location:"remote",toolUse:true,query:"qwen",limit:5}` →
  exactly 5 entries, all matching all filters. No SUT-boundary mock.

**README.md + DEPLOY.md**: both present and step-by-step. No superseded commands or ports outside
the `## 變更紀錄` section.

**LOW finding — DEPLOY.md doc gap (OPENROUTER_API_KEY not in 設定總表)**:
`08-validation.md` §config-sync-check stated "`OPENROUTER_API_KEY` is already added to DEPLOY.md
§1 設定總表." This claim is incorrect: `OPENROUTER_API_KEY` does not appear in the LLM provider
keys table in DEPLOY.md (§1, lines ~333-338). The key IS correctly used by the implementation
(litellm-proxy.ts reads it from the proxy env; validated by the live VAL-047 "PONG" run). This is
a documentation gap only — not a code defect and not mock-only evidence. Recording as LOW backlog;
does not block v7 close (all VALs are real:true, the feature is fully validated, and the variable
name is self-documenting). The entry should be added to DEPLOY.md §1 in a follow-up pass (new row:
`OPENROUTER_API_KEY | provider:"openrouter" aliases | OpenRouter API key`).

### 4. Retro

**What went well:**

- Security-invariant design for ARCH-025 was precise and implementable: `ENV_ALLOWLIST` discipline
  + `buildSubprocessEnv()` provider-branch + typed `ANTHROPIC_AUTH_MISSING` terminal failure together
  close the three attack surfaces (credential leak to subprocess, silent dummy-key fallback, passthrough
  proxy-cloaking) without complicating the non-Anthropic path. The explicit code comment at line 347
  ("CLAUDE_CODE_OAUTH_TOKEN is an auth var treated like the ANTHROPIC_* pair — deliberately NOT
  added to ENV_ALLOWLIST") shows the invariant was held consciously, not by accident.
- The `isPassthroughModel` / `effectiveProvider` separation (sdk-client.ts lines 200-208) cleanly
  distinguishes three routing cases (anthropic-direct, passthrough, proxy-via-alias) with no if-nest
  sprawl. The passthrough route-back fix (discovered and repaired during Gate 7.5) is well-contained
  and has a regression test (UT).
- `model-catalog.ts` is a textbook injectable-fetcher module: zero global state, zero credential
  reads, `Promise.all` + `.catch(() => [])` per-source degradation, clean `ModelEntry` type. It
  was easy to test (IT-045 wires a fake fetcher; no live network needed in the test tier) and easy
  to validate live (models_list{} → 100 entries in one curl).
- Gate 7.5 real-run evidence quality: VAL-047 "PONG" from an actual OpenRouter model, VAL-048 with
  per-provider counts, VAL-049 with exact filter match — all three make the feature unmistakably
  real without ambiguity.

**To change / improve:**

- The validator's config-sync check (08-validation.md §v7 round, "already added to DEPLOY.md §1
  設定總表") was wrong — `OPENROUTER_API_KEY` was not actually added to DEPLOY.md. Gate 7.5
  validators should verify the claim by checking the file, not by asserting from memory. A single
  `grep OPENROUTER_API_KEY DEPLOY.md` would have caught this.
- The `resolveAnthropicAuth()` function resolves from three sources in a fixed priority order:
  `secretSource.resolve()` → `process.env['RWE_SECRET_*']` → `process.env['ANTHROPIC_API_KEY']`
  (plain env fallback). The plain-env fallback (`process.env['ANTHROPIC_API_KEY']`) means that if
  the operator sets a real Anthropic key as a plain env var (not via `RWE_SECRET_*`), Anthropic-direct
  routing will silently activate even without an explicit alias `provider:"anthropic"`. This is not
  a security problem (the key is read from the process env the operator controls), but it could
  cause unexpected behavior. A future iteration could require explicit opt-in.
- REQ-037's Anthropic-direct live-auth path remains untested against a real Anthropic API because
  this engine has no `anthropic` alias + key. An integration test fixture with a mocked Anthropic
  endpoint would close this gap without needing a real key; the unit coverage (VAL-046) is solid
  but live-auth is the one real-world path that has never been end-to-end exercised.

**Known tech debt (carried):**

- REQ-012 / TASK-018: OIDC auth deferred (D5). The pre-OIDC unauthenticated surface now also
  fronts the new `models_list` tool (read-only, no secret output, low risk). Existing compensations
  (ufw allowlist, loopback default bind) unchanged.
- REQ-037 Anthropic-direct live auth: honest partial accepted at Gate 7.5. Unit-covered; live path
  pending an anthropic alias + real key on a future engine.
- IMPL-082 trace-label: pre-existing, covered in substance, not a code gap.
- DEPLOY.md `OPENROUTER_API_KEY` entry: missing from §1 LLM provider keys table (LOW, see §3).

### 5. Report

```
Gaps: high=1 mid=1 low=1 (all 3 pre-existing, all recorded as backlog — REQ-012/TASK-018 OIDC D5; IMPL-082 trace-label)
Drift: none (all v7 items iter:v7)
Architecture consistent: yes (ARCH-025 security invariant VERIFIED GREEN; ARCH-026 model catalog consistent; 0 new HIGH/MID/LOW findings)
Validation: real-tier all-green? yes (VAL-046..049 all real:true) · README+DEPLOY present? yes
Backlog (not gate blockers):
  (a) REQ-037 anthropic-direct-live auth: honest partial, unit-covered, no anthropic alias+key on this engine
  (b) REQ-012/TASK-018: OIDC deferred D5; models_list now also on pre-OIDC surface (read-only, low-risk; same firewall/PAT compensation)
  (c) IMPL-082: trace-label cleanup (pre-existing, covered in substance)
  (d) LOW: OPENROUTER_API_KEY missing from DEPLOY.md §1 provider keys table (doc gap only)
Conclusion: v7 iteration closes; gates.review.passed stays true
```

---

## v6 GATE 8 CLOSING REVIEW (2026-07-19, SUPERSEDED — kept for history)

> This section supersedes "## v5 GATE 8 CLOSING REVIEW (2026-07-19)" below (kept for history). v6
> adds the issue read/reply toolset + dedup + runId enrichment (ARCH-024). REQ-031..036 /
> IMPL-086 / VAL-040..045. Gate 7.5 v6 ROUND 1 PASSED 2026-07-19: REQ-031..036 real-validated
> against the live production engine (systemd user service, 127.0.0.1:8787, 27 tools, real PAT);
> issue_get/issue_list/issue_comments/issue_comment all real; dedup (fingerprint + rwe-fp marker +
> deduped:true) real end-to-end; REQ-036 enrichment an honest partial (report path real via VAL-044,
> enrichment mechanism covered by UT-058, live path not triggered — no runId in validation reports).

### 1. Traceability (379 items, 3 gaps)

`sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check` — 379 items scanned, 3 gaps
detected (exit 1). Dashboard regenerated: `dashboard.html`.

V6 adds 18 traceability items (REQ-031..036, ARCH-024, TASK-045, DES-038, IMPL-086, UT-058,
IT-044, VAL-040..045). All chains are intact. The 3 remaining gaps are identical to v5 — all
pre-existing and out-of-v6-scope:

| Sev | Type | ID | Description | Classification |
|---|---|---|---|---|
| HIGH | 未真實驗證 | REQ-012 | no real:true VAL; mock-only | OIDC deferred; accepted gap D5 |
| MID | TDD | IMPL-082 | no test item directly cites IMPL-082 | trace-label cleanup; covered in substance (IT-042/VAL-033) |
| LOW | 未實作 | TASK-018 | no corresponding implementation | OIDC deferred; accepted gap D5 |

Zero drift: all v6 ledger items (ARCH-024 / TASK-045 / DES-038 / IMPL-086 / UT-058 / IT-044 /
VAL-040..045) carry `iter: v6`. No IMPL/DES/UT with mismatched iter stamps relative to their
upstream within v6.

### 2. Architecture Consistency — v6 ARCH-024 (lean-tier self-check, QM)

No pre-run panel reports exist for the v6 scope (no `.panel/` directory). Per lean-tier rules (QM,
single-area, v6 slice), the architecture-consistency check is performed here against the v6-touched
files listed on IMPL-086 in 06-impl-log.md: `src/github/issue-reporter.ts` (v6 extensions) and
the v6-specific portions of `src/server.ts`.

**ARCH-024 (GitHub Issue Ops) — IMPL-086**

_Token ONLY from server-side SecretSource (same discipline as ARCH-023/ARCH-016):_
All four new `IssueReporter` methods (`getIssue`, `listIssues`, `getComments`, `postComment`) call
`this.resolveToken()` as their first action. `resolveToken()` reads exclusively from
`this.cfg.secretSource.resolve(TOKEN_SECRET_NAME)` — identical to the v5 path. No caller-supplied
token field exists on any of the four new operations. The composition root (server.ts line 662)
wires `loadSecretSourceFromEnv()` for the default reporter, injecting `runDiagnostics` alongside.
Consistent with ARCH-024's stated inheritance from ARCH-023 and ARCH-016.

_Envelope-not-throw typed errors (all four required codes present):_
- `ISSUE_NOT_FOUND`: returned by `getIssue` (line 394), `getComments` (line 419), and `postComment`
  (line 435) when the 404→null path is triggered at the client layer and propagated up; also by
  `postComment` when `createComment` returns null after the 404 mapping.
- `ISSUE_COMMENT_INVALID`: returned by `postComment` (line 431) when body is empty or non-string —
  before any API call is made.
- `GITHUB_TOKEN_MISSING`: returned by `resolveToken()` (line 320-321) on all four methods when the
  secret resolves to undefined or empty string.
- `GITHUB_API_ERROR`: `apiError()` (line 334-339) catches any `GithubApiError` thrown by the
  bounded client on all four paths.
- All four `callTool` cases in server.ts (lines 518-533) follow `res.ok ? {result:...} : {error:res.error}`
  — no exception crosses the tool boundary. Consistent with the envelope-not-throw invariant in
  ARCH-024.

_Bounded fetch on all new read/write methods:_
All five `GithubIssueClient` methods — including the four new ones (`getIssue`, `listIssues`,
`getComments`, `createComment`, `findOpenByFingerprint`) — use the shared `ghFetch` inner function
(lines 193-227), which applies an `AbortController` per attempt with `setTimeout(() => ctrl.abort(),
timeoutMs)` and retries only on 5xx/429/network errors (`res.status >= 500 || res.status === 429`).
Non-retryable 4xx responses are passed through immediately for the caller to interpret (404→null
or an explicit `fail()` throw). The retry budget and timeout are the same knobs (`timeoutMs`,
`retries`) shared with the v5 `createIssue` path. Consistent with ARCH-024's "same never-hang/
crash/fake-success discipline as ARCH-023."

_404→null mapping (get / comments / createComment only — correct subset):_
- `getIssue` (line 248): `if (res.status === 404) return null`
- `getComments` (line 286): `if (res.status === 404) return null`
- `createComment` (line 298): `if (res.status === 404) return null` (issue vanished between search
  and comment — handled gracefully in `report()` by falling through to createIssue)
- `listIssues` uses `ghJson` (throws on non-2xx, correct: GitHub list API returns 200+[] for empty
  and only 404s if the repo does not exist, which is a genuine error)
- `findOpenByFingerprint` uses `ghJson` (correct: GitHub search API returns 200+{items:[]} for no
  matches, never 404)
Consistent with ARCH-024's specified "404→null on get/comments/createComment."

_Dedup fingerprint + rwe-fp search:_
`issueFingerprint(title, component)` (lines 119-121) = sha256(normalizeTitle(title) + '|' +
(component ?? '')).hex().slice(0, 16). `findOpenByFingerprint(fp)` (lines 305-310) queries
`repo:X is:issue is:open in:body "rwe-fp:<fp>"` via the search API. The dedup flow in `report()`
(lines 371-382): `findOpenByFingerprint → if dup found → createComment(dup, body) → {deduped:true}`;
if `createComment` returns null (race: issue closed between search and comment), falls through to
`createIssue` with `{deduped:false}`. The hidden `<!-- rwe-fp:<fp> -->` marker is always appended
to the body by `renderIssueBody` (line 156), so every filed issue carries the search anchor.
Consistent with ARCH-024's dedup specification.

_runDiagnostics best-effort / injectable:_
`IssueReporterConfig.runDiagnostics?: (runId: string) => Promise<string | null>` (line 111) is the
injection seam. In `report()` (lines 357-360): called with `.catch(() => null)` and only when
`input.runId && this.cfg.runDiagnostics` — a null/throw never fails the report. The composition-root
`runDiagnostics` (server.ts lines 634-659) wraps the entire facade call chain in a `try/catch`
returning `null`, uses `facade.workflow_status` + `facade.workflow_artifacts` + `facade.workflow_agent_log`
(ARCH-002, same facade the MCP tools use — no bespoke data bus). Consistent with ARCH-024's
"never fails the report when the runId is unknown" and ARCH-002 dependency.

_Four new tools wired consistently:_
`TOOL_NAMES` (lines 127-130): `issue_get`, `issue_list`, `issue_comments`, `issue_comment`.
`TOOL_METADATA` (lines 340-378): each tool has a description (including all typed error codes
surfaced) and a typed `inputSchema` with `required` fields. All four `callTool` cases (lines
518-533) delegate to the corresponding `IssueReporter` method and return the typed envelope.
Consistent with ARCH-024's tool-surface specification.

_ARCH-023 report() amendment (dedup + enrichment):_
The `issue_report` callTool case (server.ts line 514-515) now exposes `deduped: res.deduped` in
the result. The `runDiagnostics` function is wired into the default `IssueReporter` constructor
at line 662. Both amendments are exactly as specified in the ARCH-023 NB note and ARCH-024.

**Implementation detail not in ARCH-024 (not a deviation):**
`listIssues` filters out pull requests from GitHub's list-issues response (`it.pull_request ===
undefined`, line 273). GitHub's list-issues API returns PRs mixed with issues; dropping them is a
necessary correctness measure invisible to callers. No architectural violation.

**v6 architecture-consistency summary:**
- New HIGH findings: 0
- New MEDIUM findings: 0
- New LOW findings: 0
- ARCH-024 is implemented exactly as specified; no deviations from the decision rationale found.
- Pre-existing security observation (pre-OIDC unauthenticated surface) extended below in backlog:
  the new write tool `issue_comment` adds a GitHub comment-write capability on the same surface.
  Compensating controls unchanged (ufw allowlist + Issues-only single-repo PAT).

### 3. Validation and Handover

Gate 7.5 v6 ROUND 1 passed (2026-07-19, `08-validation.md` §v6 ROUND 1). VAL-040..045 all real-tier:

- VAL-040 (REQ-031): real — `issue_get{number:2}` against live engine returned full IssueView
  envelope (all required fields including fingerprint marker in body); `issue_get{number:999999}` →
  `{error:{code:"ISSUE_NOT_FOUND"}}`. No SUT-boundary mock.
- VAL-041 (REQ-032): real — `issue_list{labels:["agent-reported"],state:"open",limit:10}` returned
  filtered bounded array; issue #1 (closed) absent, issue #2 (open) present. Uniform IssueSummary
  envelope confirmed.
- VAL-042 (REQ-033): real — `issue_comments{number:2}` returned the real comment (id:5013786770)
  posted by VAL-043. Fields {id, author, body, createdAt} all present; ordered array confirmed.
- VAL-043 (REQ-034): real — `issue_comment{number:2, body:"agent reply…"}` posted a genuine comment
  (id:5013786770) visible at the real GitHub URL. Empty body → `ISSUE_COMMENT_INVALID`. No mock.
- VAL-044 (REQ-035): real — dedup end-to-end: first call → `{issueNumber:2, deduped:false}`,
  fingerprint marker embedded (confirmed via VAL-040 body); second identical call → `{issueNumber:2,
  deduped:true}`. No issue #3 created. `findOpenByFingerprint → createComment` chain is real:true.
- VAL-045 (REQ-036): real (honest partial) — report path real via VAL-044; enrichment mechanism
  (runDiagnostics injected, appended to ## Linked run, null/throw-safe) confirmed by UT-058 (known-
  runId → diagnostics appended; unknown → report still filed). Live enrichment path not exercised
  (no runId in validation flows). Accepted: best-effort by design, no code defect.

trace.py reports 0 未真實驗證 for REQ-031..036. REQ-012 HIGH gap is pre-existing, accepted.

No new config keys, ports, or feature flags introduced by v6. `RWE_SECRET_GITHUB_TOKEN` follows
the existing `RWE_SECRET_<NAME>` pattern already in DEPLOY.md §1 (established in v3). No changes
to DEPLOY.md required. README.md present.

**Doc drift observation (LOW, pre-existing):** README.md line 123 states "22 個工具" but the live
engine exposes 27 tools. The discrepancy predates v6 (v3 Gate 8 set the count to 22; v4's
`workspace_purge`/`workflow_deregister`, v5's `issue_report`, and v6's four new tools each
incremented it without a README update). Not a config/command error; no deployment risk. Recorded
as LOW backlog; does not affect Gate 7.5 pass status or v6 close.

### 4. v6 Retro

**What went well:**
- ARCH-024 implemented and validated in a single Gate 7.5 pass — no route-back needed.
- Sharing the `ghFetch` bounded client across all five `GithubIssueClient` methods (createIssue +
  four new ones) means the "never-hang/crash/fake-success" discipline was not re-implemented —
  it was inherited. No new timeout/retry logic to test separately.
- The dedup mechanism (sha256 fingerprint + hidden body marker + GitHub search) is testable
  entirely through the `GithubIssueClient` interface seam, with no real API calls in unit tests.
  VAL-044 then exercised the full end-to-end path live (first call → deduped:false, second call →
  deduped:true, no issue #3 created).
- The "dup race" fallback (if `createComment` returns null — issue closed between search and
  comment, fall through to createIssue) is both tested by UT-058 and architecturally sound: it
  means the dedup path can never silently swallow a report.
- `runDiagnostics` uses the existing `McpFacade` interface rather than a new data bus — the
  enrichment data is the same shape already observable via `workflow_status/artifacts/agent_log`.
  No new subsystem, no new test surface; the composition-root function is a thin adapter.
- REQ-036 "honest partial" framing was correct: a null return from `runDiagnostics` never fails
  the report, and the enrichment mechanism is deterministically testable via injection. VAL-045
  accepted this without requiring a live runId probe.
- The PR-filter in `listIssues` (dropping items with `pull_request` field) was added defensively
  without an explicit ARCH requirement — it prevents a common GitHub API pitfall from surfacing
  as noise in a solve agent's work queue.
- Full suite (569) green; tsc clean; all 18 new traceability items connected without introducing
  new gaps.

**What to change next time:**
- The four new issue tools are exposed on the pre-OIDC unauthenticated listener, same surface as
  `issue_report`. The v5 backlog item was "rate-guard/dedup on pre-OIDC surface"; v6 compounds
  this with a write capability (`issue_comment` lets any LAN-allowlisted caller comment on the
  repo). The dedup half (REQ-035) now partially mitigates spam-by-duplicate, but a rate/volume
  guard is still open. Future work should either gate on OIDC (REQ-012, D5) or add a lightweight
  per-tool rate guard at the server layer.
- REQ-036 live enrichment was not triggered because no `runId` was available in the validation
  reports. A future validation round that runs a real `workflow_run` and then calls `issue_report`
  with the resulting `runId` would exercise this path live. A dedicated test repo (for error-path
  probes without spurious real-issue creation) would also close the "happy path only" limitation
  on live validation.
- README.md tool count has drifted to "22 個工具" across v4/v5/v6. The next iteration should
  include a README tool-count update as part of the handover checklist.

**Known tech debt (carried forward, updates noted):**
- IMPL-082 trace-label: IT-042 should cite DES-033 in its `traces:` field (LOW)
- V1: auth seam absent (MEDIUM) — no HTTP auth on engine endpoints; ufw allowlist mitigates;
  v6's `issue_comment` write capability adds to this surface (compensated by PAT scope + ufw)
- V3 residual: Bash opt-in bypass (LOW) — workspace confinement covers Read/Write; Bash requires
  explicit opt-in
- V3 LOW: SessionInitRecord.resolvedProjectRoot audit-fidelity
- V4, V5, O-2, R-1, R-3, C-2, C-3, S-2: unchanged from v2/v3 Gate 8 backlog
- REQ-012 / TASK-018 (OIDC): deferred per D5; no timeline
- v5 backlog: issue_report rate-guard on pre-OIDC surface (LOW) — **UPDATED**: REQ-035 dedup now
  partially addresses the dedup half (spam-by-duplicate is mitigated); a rate/volume guard remains
  open; `issue_comment` write capability (v6) further motivates this work
- NEW v6 backlog: `issue_comment` (and the other read tools) exposed on pre-OIDC listener; write
  capability allows any LAN-allowlisted caller to comment on the repo (LOW — compensated by ufw
  allowlist + Issues-only single-repo PAT; same surface and same mitigations as v5 issue_report)
- NEW v6 backlog: README.md tool count stale (22 documented, 27 actual) — LOW doc drift,
  pre-existing across v4/v5/v6; no deployment risk; update in next iteration

### Report

```
Gaps: high=1 mid=1 low=1 (all 3 recorded as known backlog; none in v6 scope)
  - high=1: REQ-012 (OIDC, 未真實驗證) — deferred D5, not a blocker
  - mid=1:  IMPL-082 (TDD trace-label) — covered in substance by IT-042+VAL-033; cleanup item only
  - low=1:  TASK-018 (OIDC auth middleware, 未實作) — deferred D5, not a blocker
Drift: README.md tool count 22 vs actual 27 (LOW, pre-existing across v4/v5/v6; no deployment risk)
Architecture consistent: yes — ARCH-024 fully consistent with IMPL-086;
  no new findings (HIGH/MEDIUM/LOW); token-from-SecretSource, envelope-not-throw
  (ISSUE_NOT_FOUND/ISSUE_COMMENT_INVALID/GITHUB_TOKEN_MISSING/GITHUB_API_ERROR), bounded fetch
  (shared ghFetch/AbortController/retry budget), 404→null (get/comments/createComment only),
  dedup (sha256 fingerprint + rwe-fp marker + findOpenByFingerprint search), runDiagnostics
  (best-effort/.catch/injectable/McpFacade-backed), 4 new tools wired consistently, ARCH-023
  report() amendment (deduped field + runDiagnostics wired) — all verified against source;
  pre-OIDC write surface (issue_comment) logged as LOW backlog, non-blocking
Validation: real-tier all-green? yes (VAL-040..045, 6/6 real:true; REQ-036 honest partial accepted;
           REQ-012 accepted D5) · README+DEPLOY present? yes (no v6 updates required)
Conclusion: v6 slice closes; gates.review.passed stays true;
  3 residual gaps are pre-existing accepted backlog (OIDC D5 x2 + IMPL-082 trace-label cleanup);
  2 new LOW backlog items added (issue_comment pre-OIDC write surface; README tool count drift);
  v5 rate-guard backlog updated: dedup half now partially mitigated by REQ-035
```

---

## v5 GATE 8 CLOSING REVIEW (2026-07-19, SUPERSEDED — kept for history)

> This section is superseded by "## v6 GATE 8 CLOSING REVIEW (2026-07-19)" above. v5 adds the
> `issue_report` GitHub tool (ARCH-023). REQ-027..030 / IMPL-085 / VAL-036..039. Gate 7.5 v5
> ROUND 1 PASSED 2026-07-19: issue #1 genuinely created at HsuJavis/remote-workflow-engine via the
> live engine.

### 1. Traceability (361 items, 3 gaps)

`sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check` — 361 items scanned, 3 gaps
detected (exit 1). Dashboard regenerated: `dashboard.html`.

V5 adds 14 traceability items (REQ-027..030, ARCH-023, TASK-044, DES-037, IMPL-085, UT-057,
IT-043, VAL-036..039). All chains are intact. The 3 remaining gaps are identical to v4 — all
pre-existing and out-of-v5-scope:

| Sev | Type | ID | Description | Classification |
|---|---|---|---|---|
| HIGH | 未真實驗證 | REQ-012 | no real:true VAL; mock-only | OIDC deferred; accepted gap D5 |
| MID | TDD | IMPL-082 | no test item directly cites IMPL-082 | trace-label cleanup; covered in substance (IT-042/VAL-033) |
| LOW | 未實作 | TASK-018 | no corresponding implementation | OIDC deferred; accepted gap D5 |

Zero drift: all v5 ledger items (ARCH-023 / TASK-044 / DES-037 / IMPL-085 / UT-057 / IT-043 /
VAL-036..039) carry `iter: v5`. No IMPL/DES/UT with mismatched iter stamps relative to their
upstream within v5.

### 2. Architecture Consistency — v5 ARCH-023 (lean-tier self-check, QM)

No pre-run panel reports exist for the v5 scope. Per lean-tier rules (QM, single-area, v5 slice),
the architecture-consistency check is performed here against the v5-touched files listed on
IMPL-085 in 06-impl-log.md: `src/github/issue-reporter.ts` + the v5-specific portions of
`src/server.ts`.

**ARCH-023 (GitHub Issue Reporter) — IMPL-085**

_Token ONLY from server-side SecretSource (extends ARCH-016/REQ-018):_
`IssueReportInput` carries `{title, reproSteps, analysis, logs?, severity?, component?, runId?}` —
no token field; the caller can never supply one. `IssueReporter.report()` at
`src/github/issue-reporter.ts:155` resolves the token exclusively via
`this.cfg.secretSource.resolve('GITHUB_TOKEN')` — the same `SecretSource` interface used by
ARCH-016. At `src/server.ts:571` the composition-root wires `loadSecretSourceFromEnv()` which
reads `RWE_SECRET_GITHUB_TOKEN` from the parent-process environment only; the run workspace and
the untrusted sandbox have no access to this env var. The `ServerConfig.issueReporter` seam
(line 63) lets tests inject a fake reporter without touching the secret store. Consistent with
ARCH-023 and the ARCH-016 extension described in the decision rationale.

_Envelope-not-throw typed errors:_
- `ISSUE_REPORT_INVALID`: returned at lines 150-152 when any of `[title, reproSteps, analysis]`
  is missing or blank — no GitHub API call is made.
- `GITHUB_TOKEN_MISSING`: returned at lines 156-158 when the secret resolves to undefined or
  empty string — no partial/silent no-op.
- `GITHUB_API_ERROR`: `GithubApiError` (code field `'GITHUB_API_ERROR'`) thrown by the bounded
  client is caught at lines 176-181 and converted to `{ok:false,error:{code,message}}`. The code
  is extracted from the error object if present, defaulting to `'GITHUB_API_ERROR'`.
- At `src/server.ts:470-471` the `case 'issue_report'` branch returns
  `res.ok ? {result:{issueNumber,url}} : {error:res.error}` — no exception crosses the tool
  boundary. Consistent with the envelope-not-throw invariant specified in ARCH-023.

_Bounded fetch timeout + retries:_
`createGithubIssueClient` (lines 88-140) applies an `AbortController` per attempt with
`setTimeout(() => ctrl.abort(), timeoutMs)` (default 10 000 ms). The retry loop runs
`for (attempt=0; attempt<=retries; attempt++)` (default retries=1 → 2 attempts max). 4xx
responses (except 429) are thrown immediately without retry (`if (res.status < 500 && res.status !== 429) throw`),
preventing pointless retries for a structurally bad request. Timeout and network errors are
caught and re-surfaced as `GithubApiError` after the retry budget is exhausted. Consistent
with ARCH-023's bounded-fetch specification.

_Injectable client seam:_
`GithubIssueClient` interface (lines 30-32) is the abstraction boundary; `IssueReporterConfig.clientImpl?`
(line 39) lets unit tests inject a fake client that never touches the network;
`IssueReporterConfig.fetchImpl?` / `timeoutMs?` / `retries?` (lines 42-45) let the real client
be tuned or have its fetch replaced without changing production wiring. `ServerConfig.issueReporter?`
(server.ts line 63) is the composition-root seam for integration tests. Consistent with ARCH-023.

**Security observation (NOT a blocker — recorded as backlog):**
`issue_report` is exposed on the pre-OIDC unauthenticated MCP listener (port 8787). Any
LAN-allowlisted caller can create GitHub issues in the engine's own repo without authentication
at the engine layer. Current compensating controls: ufw allowlist restricts access to
`192.168.0.0/24` + SSH, and the PAT is a fine-grained token scoped to Issues-only on a single
private repository (`HsuJavis/remote-workflow-engine`). A future OIDC gate (REQ-012, deferred D5)
or a dedicated per-tool rate-guard / dedup check would tighten this surface. Logged as backlog
item below (non-blocking; V1 auth-seam gap already covers the unauthenticated-listener concern
at the feature level).

**v5 architecture-consistency summary:**
- New HIGH findings: 0
- New MEDIUM findings: 0
- New LOW findings: 0 (security observation above is a pre-existing surface inherited from V1,
  not a new gap introduced by v5)
- ARCH-023 is implemented exactly as specified; no deviations from the decision rationale found.
- All prior backlog items (V1, V3 residual, V4, V5, O-2, R-1, R-3, C-2, C-3, S-2, the v3 LOW
  SessionInitRecord audit-fidelity note, IMPL-082 trace-label) unchanged.

### 3. Validation and Handover

Gate 7.5 v5 ROUND 1 passed (2026-07-19, `08-validation.md` §v5 ROUND 1). VAL-036..039 all real-tier:

- VAL-036 (REQ-027): real — `tools/call issue_report{...}` against the live engine returned
  `{issueNumber:1, url:"https://github.com/HsuJavis/remote-workflow-engine/issues/1"}`; issue #1
  genuinely created in the private repo (externally visible on GitHub)
- VAL-037 (REQ-028): real — live call succeeded only because `RWE_SECRET_GITHUB_TOKEN` is
  configured server-side; `GITHUB_TOKEN_MISSING` path exercised by IT-043 (real HTTP POST to
  test server with no env token; 535-test suite green)
- VAL-038 (REQ-029): real — authenticated GET of issue #1 confirmed labels
  `["agent-reported","severity:low"]` and all body sections (`## Summary`, `## Reproduction steps`,
  `## Logs`, `## Analysis / root cause`, `## Environment`, `## Linked run`)
- VAL-039 (REQ-030): real — live call completed without hang/crash; error-bound paths (422
  no-retry, network error after retries, timeout → `GITHUB_API_ERROR`) confirmed by UT-057
  (injected fetch)
- REQ-012: deferred (D5); no VAL; accepted gap

trace.py reports 0 未真實驗證 for REQ-027..030. REQ-012 HIGH gap is pre-existing, accepted.
No new config keys, ports, or feature flags introduced by v5 (`RWE_SECRET_GITHUB_TOKEN` follows
the existing `RWE_SECRET_*` pattern already documented in DEPLOY.md §1 設定總表 as of v3).
README.md and DEPLOY.md present; no v5-specific updates required (fixed repo compiled in;
not user-configurable). No superseded commands or duplicated config keys.

### 4. v5 Retro

**What went well:**
- ARCH-023 (GitHub Issue Reporter) implemented and validated in a single Gate 7.5 pass — no
  route-back needed.
- The `GithubIssueClient` interface seam (injectable client) kept the unit tests entirely
  network-free while leaving the composition root wired to the real bounded client; IT-043
  threaded the seam through `ServerConfig.issueReporter` for integration coverage.
- Token isolation is end-to-end by design: `IssueReportInput` carries no token field, so it is
  structurally impossible for a caller to supply one; the SecretSource indirection ensures the
  raw PAT never appears in a tool response, a transcript, or a workspace.
- Real validation was decisive: issue #1 on GitHub is an externally visible artifact that cannot
  be produced by a stub — a higher quality bar than a logged return value.
- Body template verified externally (authenticated GET, not inferred from source), confirming
  the machine-parseable structure survives the round-trip to GitHub's storage.
- 4xx-not-retried logic is correct and tested: a 422 (invalid label, etc.) does not waste the
  retry budget on a request that cannot succeed by retrying.
- Full suite (535) green; tsc clean; all 14 new traceability items connected without introducing
  new gaps.

**What to change next time:**
- The `issue_report` tool is exposed on the pre-OIDC unauthenticated listener. Future issue-type
  tools should either wait for OIDC (REQ-012, D5) or include a lightweight per-tool rate guard
  at the server layer — filing N issues per second against a PAT is cheap for a LAN caller.
- The fixed repo (`HsuJavis/remote-workflow-engine`) is compiled into the implementation, not
  configurable. If the engine is ever redeployed under a different owner/repo, this requires a
  code change. A `githubRepo` config key in `rwe.config.json` would future-proof this, but the
  current design matches the ARCH-023 spec ("Fixed target repo") so it is not a deviation.
- `VAL-039` real error-path probe (e.g. deliberately wrong token → live `GITHUB_API_ERROR`) was
  intentionally skipped to avoid spurious issue creation. A dedicated test-repo or a mock HTTP
  intercept at the acceptance level would allow full real error-path coverage without side
  effects.

**Known tech debt (carried forward, no changes):**
- IMPL-082 trace-label: IT-042 should cite DES-033 in its `traces:` field (LOW)
- V1: auth seam absent (MEDIUM) — no HTTP auth on engine endpoints; ufw allowlist mitigates;
  `issue_report` on this surface adds a GitHub write capability — compensated by PAT scope
- V3 residual: Bash opt-in bypass (LOW) — workspace confinement covers Read/Write; Bash requires
  explicit opt-in
- V3 LOW: SessionInitRecord.resolvedProjectRoot audit-fidelity (stores workspace cwd instead of
  null on clean path)
- V4, V5, O-2, R-1, R-3, C-2, C-3, S-2: unchanged from v2/v3 Gate 8 backlog
- REQ-012 / TASK-018 (OIDC): deferred per D5; no timeline
- NEW backlog: issue_report rate-guard / dedup on the pre-OIDC surface (LOW — mitigated by PAT
  scope + ufw; follow-on to OIDC work or a standalone lightweight guard)

### Report

```
Gaps: high=1 mid=1 low=1 (all 3 recorded as known backlog; none in v5 scope)
  - high=1: REQ-012 (OIDC, 未真實驗證) — deferred D5, not a blocker
  - mid=1:  IMPL-082 (TDD trace-label) — covered in substance by IT-042+VAL-033; cleanup item only
  - low=1:  TASK-018 (OIDC auth middleware, 未實作) — deferred D5, not a blocker
Drift: none
Architecture consistent: yes — ARCH-023 fully consistent with IMPL-085;
  no new findings (HIGH/MEDIUM/LOW); token isolation, envelope-not-throw, bounded fetch,
  and injectable seam all verified against source; security observation (pre-OIDC listener
  write-capability) logged as LOW backlog, non-blocking
Validation: real-tier all-green? yes (VAL-036..039, 4/4 real:true; REQ-012 accepted D5)
           README+DEPLOY present? yes (no v5-specific updates required)
Conclusion: v5 slice closes; gates.review.passed stays true;
  3 residual gaps are pre-existing accepted backlog (OIDC D5 x2 + IMPL-082 trace-label cleanup);
  1 new LOW backlog item added (issue_report rate-guard on pre-OIDC surface)
```

---

## v4 GATE 8 CLOSING REVIEW (2026-07-19, CURRENT / AUTHORITATIVE)

> This section supersedes "## v3 GATE 8 CLOSING REVIEW (2026-07-18)" below (kept for history). v4
> adds workspace byte-transport (ARCH-020), seed-into-workspace + .claude RCE strip (ARCH-021), and
> run-workspace retention / TTL GC (ARCH-022). REQ-022..026 / IMPL-081..084 / VAL-031..035.
> REQ-022..026 requirement text was backfilled into 01-requirements.md on 2026-07-19, reconnecting
> the five previously-broken ARCH-020..022 chains. Gate 7.5 v4 ROUND 1 PASSED 2026-07-19.

### 1. Traceability (347 items, 3 gaps)

`sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check` — 347 items scanned, 3 gaps
detected (exit 1). Dashboard regenerated: `dashboard.html`.

The five HIGH broken-chain gaps from v3 Gate 8 (ARCH-020..022 → missing REQ-022..026) are CLOSED:
the requirement headings were backfilled into 01-requirements.md on 2026-07-19, reconnecting all
chains. The 3 remaining gaps are pre-existing and out-of-v4-scope:

| Sev | Type | ID | Description | Classification |
|---|---|---|---|---|
| HIGH | 未真實驗證 | REQ-012 | no real:true VAL; mock-only | OIDC deferred; accepted gap D5 |
| MID | TDD | IMPL-082 | no test item directly cites IMPL-082 | trace-label cleanup; covered in substance (see §3) |
| LOW | 未實作 | TASK-018 | no corresponding implementation | OIDC deferred; accepted gap D5 |

Zero drift: no IMPL/DES/UT with mismatched `iter` stamps relative to their upstream within v4.

**IMPL-082 detailed assessment**: The trace tool flags IMPL-082 (readBody body cap, `src/server.ts:315-335,
620, 669-671`) as a TDD-ordering gap because no test item's `traces:` field directly references
IMPL-082 or DES-033. However, IT-042 (`tests/integration/v15-v2-workspace-transport.test.ts`)
explicitly includes a body-cap test at line 75 (`REQ-024: an over-cap request body is rejected with
413, not buffered/OOMed`) and IT-042 traces to ARCH-020, whose note explicitly lists "server.ts
readBody body-size cap (413)" as part of its scope. VAL-033 provides additional real-run evidence
(30 MB POST → 413 on the live engine). **Assessment: trace-label cleanup item — the code is covered
in substance by IT-042 and VAL-033. IT-042 should add DES-033 to its traces field to close the
formal chain. Not a genuine uncovered-code gap. Not a blocker for this iteration.**

### 2. Architecture Consistency — v4 ARCH-020..022 (lean-tier self-check, QM)

No pre-run panel reports exist for the v4 scope (no new `.panel/review/*.md`). Per lean-tier rules
(QM, single-area, v4 slice), the architecture-consistency check is performed here against the
v4-touched files listed on each IMPL in 06-impl-log.md.

**ARCH-020 (Workspace byte-transport) — IMPL-081, IMPL-082**
`src/workspace-artifacts.ts`: `listArtifacts(workspace)` recursively walks the workspace directory,
applying `isPathContained` (realpath-based) per entry — symlink escapes skipped, not silently
included. `.git` directories are excluded at any depth (engine seed baseline, not client deliverable).
Each regular file gets `{path, size, sha256}` with workspace-relative forward-slash paths.
`readArtifactChunk(workspace, relPath, offset, length, maxChunk=1MiB)` applies `isPathContained`
before any file open — a path escaping via `../` or symlink returns `{error:'PATH_OUTSIDE_WORKSPACE'}`
with no bytes read. Positioned read (openSync/readSync at offset) so large files are never fully
buffered for a windowed read. `src/server.ts:315-335`: `readBody(req, maxBytes=8MiB)` accumulates
chunks into a buffer, calling `reject(new BodyTooLargeError(maxBytes))` as soon as accumulated
length exceeds the cap — the socket continues draining (no back-pressure hang) and the caller sends
413. Consistent with ARCH-020.

**ARCH-021 (Seed-into-workspace) — IMPL-083**
`src/workspace-seed.ts`: `materializeSeed(workspace, seed[])` applies `isPathContained` before every
write (path-escape → `rejected[]`) and checks `.git` internals (`/.git/` or `/.git` suffix →
`rejected[]`). `STRIP_RE = /(^|\/)\.claude\/(settings[^/]*\.json|hooks\/.*)$/` matches
`.claude/settings.json`, `.claude/settings.local.json`, and `.claude/hooks/**` at any nesting depth
— stripped entries go to `stripped[]` and are never written. `.claude/CLAUDE.md` and
`.claude/skills/**` are explicitly NOT stripped (inert data / intended materialization surface).
Seed materialization is called from `RunManager` before `_runLive` (pre-agent, replay-safe).
Consistent with ARCH-021 (closes DES-028 hook-gate for the seed path).

**ARCH-022 (Run-workspace retention) — IMPL-084**
`src/workspace-gc.ts`: `reclaimStaleWorkspaces(workRoot, ttlMs, statusOf, nowMs)` only deletes a
workspace when `statusOf(runId)` returns a TERMINAL status (`stopped|completed|failed`) AND the
directory mtime is older than the TTL. A `null` status (store miss / unknown) or non-TERMINAL status
is treated as keep — never deletes an active/suspended/queued run. `statusOf` and `nowMs` are
injected (unit-testable without wall-clock). `src/mcp-facade.ts:188-192`: `workspace_purge` checks
`stored.status` against TERMINAL states before deleting — returns `RUN_NOT_TERMINAL` error for
active/suspended runs. `src/server.ts:572-581`: GC ticker only started when
`config.workspaceTtlMs > 0` (opt-in; default = no auto-GC); cleared on server shutdown (line 694).
Consistent with ARCH-022.

**v4 architecture-consistency summary:**
- New HIGH findings: 0
- New MEDIUM findings: 0
- New LOW findings: 0
- All three ARCH-020..022 modules are implemented exactly as specified; no deviations found.
- No amendments to prior backlog items: V1, V3 residual, V4, V5, O-2, R-1, R-3, C-2, C-3, S-2,
  and the v3 LOW SessionInitRecord audit-fidelity note are unchanged.

### 3. Validation and Handover

Gate 7.5 v4 ROUND 1 passed (2026-07-19, `08-validation.md` §v4 ROUND 1). VAL-031..035 all real-tier:

- VAL-031 (REQ-022): real — `workflow_artifacts` returned `sub/a.txt` with sha256 and nested path;
  `.claude/hooks/evil.sh` absent (stripped, confirming VAL-034 / ARCH-021 wiring)
- VAL-032 (REQ-023): real — windowed read returns first 5 bytes in base64; path-escape
  `../../../../etc/passwd` returns `PATH_OUTSIDE_WORKSPACE` error, no bytes leaked
- VAL-033 (REQ-024): real — 30 MB body → HTTP 413 on live engine, no OOM/buffering
- VAL-034 (REQ-025): real — `.claude/hooks/evil.sh` seed entry stripped; `sub/a.txt` materialized
  and readable (byte-verified via VAL-032)
- VAL-035 (REQ-026): real — completed-run purge returns `{purged:true}`; post-purge `workflow_artifacts`
  returns `[]`; active-run refusal exercised by IT-042 (`RUN_NOT_TERMINAL` assert, green in 522-test
  suite)
- REQ-012: deferred (D5); no VAL; accepted gap

trace.py reports 0 未真實驗證 for REQ-022..026. REQ-012 HIGH gap is pre-existing, accepted.
No new config keys, env vars, ports, or feature flags introduced by v4 (confirmed at Gate 7.5 v4
ROUND 1). README.md and DEPLOY.md present; no new entries required for v4; no superseded commands or
duplicated config keys.

### 4. v4 Retro

**What went well:**
- All three ARCH-020..022 modules (workspace byte-transport, seed materialization + .claude strip,
  workspace retention / TTL GC) implemented and validated in one Gate 7.5 pass without a route-back.
- The `.git` directory exclusion in `listArtifacts` (skips the engine's own seed baseline) was added
  proactively, closing a correctness gap that would have surfaced `.git` internals as client-pullable
  artifacts — caught during implementation, not at review.
- Realpath-based containment (`isPathContained`) applied consistently across all three path-sensitive
  surfaces (list, read, write) — no lexical-only path check left.
- Gate 7.5 real probes are fully deterministic (seed-based, no model execution needed); all five REQs
  verified against the live production engine without modifying or restarting it.
- Backfilling REQ-022..026 requirement text into 01-requirements.md closed five HIGH broken chains
  in a single edit, consistent with the v3 retro recommendation ("REQ text committed before ARCH").
- 522 tests all green; IMPL-082 body-cap coverage confirmed present in IT-042 (body-cap 413 test at
  line 75 of v15-v2-workspace-transport.test.ts).

**What to change next time:**
- IMPL-082's DES-033 trace is not linked from any test item's `traces:` field — IT-042 covers the
  behavior but omits the formal link. Add DES-033 to IT-042's traces as a follow-up trace-label
  cleanup (low priority, no correctness risk).
- Seed write in `materializeSeed` uses `writeFileSync(abs, Buffer.from(f.contentB64 ?? '', 'base64'))`
  which silently writes a zero-byte file if contentB64 is malformed base64. A future iteration could
  add a base64 validation guard (reject rather than silently materialize garbage).

**Known tech debt (carried forward):**
- IMPL-082 trace-label: IT-042 should cite DES-033 in its `traces:` field (trace-label cleanup; LOW)
- V1: auth seam absent (MEDIUM) — no HTTP auth on engine endpoints; host firewall mitigation
- V3 residual: Bash opt-in bypass (LOW) — workspace confinement covers Read/Write via realpath
  callback; Bash requires explicit opt-in but is not blocked
- V3 LOW: SessionInitRecord.resolvedProjectRoot audit-fidelity (stores workspace cwd instead of null
  on clean path)
- V4, V5, O-2, R-1, R-3, C-2, C-3, S-2: unchanged from v2/v3 Gate 8 backlog (see sections below)
- REQ-012 / TASK-018 (OIDC): deferred per D5; no timeline

### Report

```
Gaps: high=1 mid=1 low=1 (all 3 recorded as known backlog; none in v4 scope)
  - high=1: REQ-012 (OIDC, 未真實驗證) — deferred D5, not a blocker
  - mid=1:  IMPL-082 (TDD trace-label) — covered in substance by IT-042+VAL-033; cleanup item only
  - low=1:  TASK-018 (OIDC auth middleware, 未實作) — deferred D5, not a blocker
Drift: none
Architecture consistent: yes — ARCH-020..022 fully consistent with IMPL-081..084;
  no new findings (HIGH/MEDIUM/LOW); all v4 path-sensitive surfaces use realpath containment;
  10 prior backlog items unchanged
Validation: real-tier all-green? yes (VAL-031..035, 5/5 real:true; REQ-012 accepted D5)
           README+DEPLOY present? yes (no v4-specific updates required)
Conclusion: v4 slice closes; gates.review.passed stays true;
  3 residual gaps are pre-existing accepted backlog (OIDC D5 x2 + IMPL-082 trace-label cleanup)
```

---

## v3 GATE 8 CLOSING REVIEW (2026-07-18, CURRENT / AUTHORITATIVE)

> This section supersedes "## v2 GATE 8 FINAL CLOSING REVIEW (2026-07-04 22:40)" below (kept for
> history). v3 adds MCP-by-name provisioning (ARCH-015), server-side secrets (ARCH-016), SDK
> session-options builder + timeout race (ARCH-017), asset-ingestion policy (ARCH-018), and workRoot
> project-isolation guard (ARCH-019). REQ-016..021 / IMPL-068..080 / VAL-025..030.

### 1. Traceability (337 items, 8 gaps)

`sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check` — 337 items scanned, 8 gaps
detected (exit 1 expected). Dashboard regenerated: `dashboard.html`.

All 8 gaps are pre-existing or out-of-v3-scope; none introduced by v3 IMPL-068..080:

| Sev | Type | ID | Description | Classification |
|---|---|---|---|---|
| HIGH | 斷鏈 | ARCH-020 | traces to non-existent REQ-022 | v4 chain — REQ text never written |
| HIGH | 斷鏈 | ARCH-020 | traces to non-existent REQ-023 | v4 chain — REQ text never written |
| HIGH | 斷鏈 | ARCH-020 | traces to non-existent REQ-024 | v4 chain — REQ text never written |
| HIGH | 斷鏈 | ARCH-021 | traces to non-existent REQ-025 | v4 chain — REQ text never written |
| HIGH | 斷鏈 | ARCH-022 | traces to non-existent REQ-026 | v4 chain — REQ text never written |
| HIGH | 未真實驗證 | REQ-012 | mock-only, no real:true VAL | OIDC deferred; accepted gap D5 |
| MID | TDD | IMPL-082 | no test coverage | v4 IMPL — backlog |
| LOW | 未實作 | TASK-018 | no corresponding implementation | OIDC deferred; accepted gap D5 |

Top v4 backlog item: **backfill REQ-022..026 requirement text + close v4 Gate 7.5/8** (closes 5 HIGH
broken chains and 1 MID TDD gap for IMPL-082). REQ-012 and TASK-018 remain under decision D5 (OIDC
deferred, no timeline set). Zero drift: no IMPL/DES/UT with mismatched `iter` stamps relative to their
upstream within v3.

### 2. Architecture Consistency — v3 ARCH-015..019 (lean-tier self-check, QM)

The existing `.panel/review/adversarial.md` and `.panel/review/quality-dimensions.md` cover
IMPL-001..066 (v2 baseline) only and are not applicable to the v3 scope. Per lean-tier rules (QM,
single-area, v3 slice), the architecture-consistency check is performed here against the v3-touched
files listed on each IMPL in 06-impl-log.md.

**ARCH-015 (MCP Provisioning Registry) — IMPL-068, IMPL-073**
`src/mcp-registry.ts`: SQLite-backed, probe-gated `register()` (returns `MCP_PROBE_FAILED` on failed
probe), strict `resolveInjected(referencedNames)` returning `{error:'MCP_NOT_PROVISIONED'}` on first
unknown name. Host ambient MCP never inherited (only explicitly referenced names returned). Consistent
with ARCH-015.

**ARCH-016 (Secret Store + Resolver) — IMPL-069, IMPL-074, IMPL-079**
`src/secret-resolver.ts`: atomic all-or-nothing `resolveConfig()`, typed errors `SECRET_MISSING` /
`SECRET_HANDLE_INVALID`, `redact()` baked in for transcript/dashboard sanitisation. `src/path-
containment.ts`: `isPathContained()` uses `safeRealpath` (realpathSync with lexical fallback) —
symlink-safe. Consistent with ARCH-016.
Note: IMPL-079 closes the symlink escape from v2 adversarial finding V3 (realpath-based callback
replaces prior lexical-resolve check). Bash opt-in bypass and non-`file_path` tools remain outside the
realpath callback scope (carried residual — see V3 status update below).

**ARCH-017 (SDK Session-Options Builder + outer timeout race) — IMPL-070, IMPL-072, IMPL-075**
`src/session-options-builder.ts`: pure builder (no fs/net/process direct imports), `thinkingMode =
'disabled'` for non-Anthropic (D-F6), `settingSources:['project']` hardcoded — never 'user' or
'local' (R9), DES-031 session-init re-walk calls `findProjectMarkerAncestor(cwd, workRoot)` and
returns `{ok:false, error:'WORKROOT_INSIDE_PROJECT'}` if hit. `src/timeout-race.ts`:
`raceWithTimeout` calls `opts.kill()` on timeout (D-KILL, not bare abandon), wrapped in
`semaphore.withSlot()` for slot accounting, returns `FailureEnvelope{kind,attempts,elapsedMs}`.
Consistent with ARCH-017.
LOW observation: `resolvedProjectRoot: config.cwd` at `session-options-builder.ts:115` — in the
nominal clean path (no WORKROOT_INSIDE_PROJECT hit) there is no project root; the field should be null
rather than the run-workspace cwd. The field is typed `string | null` but always receives `config.cwd`,
conflating workspace path with project root in the audit record. Not a security issue; a low
audit-fidelity concern.
V2 finding CLOSED: `src/server.ts:525` creates `agentSemaphore = createSemaphore(config?.agentSlots ??
32)` at the composition root, injected into `RunManager` and from there into each call's semaphore
slot. Per-run `RunGuard` handles budget accounting; the process-global semaphore bounds concurrent host
spawns. D-DOS wired correctly; V2 MEDIUM is closed.

**ARCH-018 (Asset-Ingestion Policy) — IMPL-077, IMPL-078**
`src/asset-sync.ts`: `classifyAsset()` — `hook → {action:'reject', code:'HOOKS_UNSUPPORTED'}`,
`mcp-config → {action:'redirect-to-provisioning'}`, `skill/other → {action:'materialize'}`. Wired
into the `asset_push` endpoint. Consistent with ARCH-018.

**ARCH-019 (WorkRoot Project-Isolation Guard) — IMPL-080**
`src/workroot-guard.ts`: `WorkRootInsideProjectError {code:'WORKROOT_INSIDE_PROJECT', ancestor, marker,
remedy}`, `assertWorkRootIsolated()` walks all ancestors to the filesystem root (boot-time check),
`findProjectMarkerAncestor()` uses `realpathImpl` first (symlink-safe), walks from resolved path to
`stopAt` exclusive, checks both `.git` and `CLAUDE.md`. Session-init re-walk wired in
`buildSessionOptions()`. Consistent with ARCH-019.

**v3 architecture-consistency summary:**
- New HIGH findings: 0
- New MEDIUM findings: 0 (V2 CLOSED; V3 Bash residual downgraded — see below)
- New LOW findings: 1 (SessionInitRecord.resolvedProjectRoot audit-fidelity, noted above)

v2-era backlog item status after v3 review:
- V2 (global-vs-per-run RunGuard, MEDIUM): CLOSED — AgentSemaphore wired process-global at composition root (server.ts:525)
- V3 (Bash opt-in/symlink bypass, MEDIUM): PARTIALLY CLOSED — symlink escape fixed by IMPL-079 realpath; Bash opt-in bypass remains, downgraded to LOW (Bash is off-by-default; enabling requires explicit BUILT_IN_CORE_TOOLS extension, a deliberate operator choice not an oversight)
- V1, V4, V5, O-2, R-1, R-3, C-2, C-3, S-2: unchanged (see v2 GATE 8 section for detail)

Remaining open backlog items: 10 (V2 closed; V3 reduced to LOW residual; 9 others unchanged).

### 3. Validation and Handover

Gate 7.5 v3 ROUND 1 passed (2026-07-18, `08-validation.md` §v3 ROUND 1). VAL-025..030 all real-tier:

- VAL-025 (REQ-016): real — SDK gateway executes end-to-end; D-F11 capability gap (qwen2.5:7b
  does not emit native tool_use) accepted
- VAL-026 (REQ-017): real — MCP_NOT_PROVISIONED error path; provision probe (real HTTP HEAD to live
  engine); DB handle confirmed present
- VAL-027 (REQ-018): real — SECRET_MISSING error; DB stores handle not value; workspace-clean grep
  produced no output
- VAL-028 (REQ-019): real — HOOKS_UNSUPPORTED returned; nothing written to workspace
- VAL-029 (REQ-020): real — `val-023` test 2/2 pass in 7.76s with real fault-injected HTTP server +
  real `ClaudeAgentSdkGatewayClient`
- VAL-030 (REQ-021): real — WORKROOT_INSIDE_PROJECT exit=1 on nested path; clean boot reaches ready
  (exit 124 = SIGTERM kill by timeout, not error)
- REQ-012: deferred (D5); no VAL; accepted gap

trace.py reports 0 未真實驗證 for REQ-016..021. REQ-012 HIGH gap is pre-existing, accepted.
Config-key sync: no new required config keys introduced by v3 (verified at Gate 7.5).
README.md (407 lines) and DEPLOY.md (835 lines) present; content verified at Gate 7.5 as step-by-step
current-state. No superseded commands or duplicated config keys found.

### 4. v3 Retro

**What went well:**
- All 5 ARCH-015..019 modules (MCP registry, secret resolver, session options builder, asset-ingestion
  policy, workRoot guard) implemented and validated in one gate cycle without a route-back.
- DES-031 (session-init re-walk for intra-run marker injection) was discovered and closed during test
  writing inside the same iteration rather than slipping to a follow-up.
- D-F6 (thinking-disabled for non-Anthropic) fixed a real 400 regression caught by the qwen2.5:7b
  spike before any v3 code was written — spike-then-design sequence worked.
- D-KILL (kill subprocess on timeout, not bare abandon) produces a deterministic `FailureEnvelope`
  instead of a silently-hung slot — better observability than the v1/v2 era.
- D-DOS global AgentSemaphore wired at composition root (server.ts:525) closes V2 (the per-run vs.
  process-global RunGuard gap from v2 Gate 8 backlog) — confirmed by reading the wiring, not by
  inference from the design docs.
- IMPL-079 realpath-based path containment closes the symlink escape in the workspace confinement
  callback (V3 MEDIUM → LOW residual Bash opt-in only).
- Gate 7.5 round 1 passed without a repeat round; all 6 v3 REQs real-verified in a single pass.

**What to change next time:**
- REQ-022..026 were built opportunistically alongside v3 without writing requirement headings into
  01-requirements.md first. Five HIGH broken chains resulted. Enforce: REQ text committed to
  01-requirements.md before ARCH is created, even for exploratory slices.
- IMPL-082 (v4) has no test coverage — the TDD discipline broke for the opportunistic v4 slice.
  Enforce Gate 5 test-first before any IMPL is committed.
- Future slices should complete their own gate sequence before building the next. Building v4 ARCH/IMPL
  alongside v3 created debt that now requires a dedicated v4 Gate 1.5–8 backfill.

**Known tech debt (v4 backlog):**
- TOP: backfill REQ-022..026 requirement text + close v4 Gate 7.5/8 (closes 5 HIGH broken chains,
  1 MID TDD gap IMPL-082)
- V1: auth seam absent (MEDIUM) — no HTTP auth on engine endpoints; host firewall mitigation (ufw
  192.168.0.0/24)
- V3 residual: Bash opt-in bypass (LOW) — workspace confinement covers Read/Write via realpath
  callback; Bash requires explicit opt-in but is not blocked
- NEW LOW: SessionInitRecord.resolvedProjectRoot audit-fidelity (always stores workspace cwd, not
  actual project root; should be null in the nominal clean path)
- V4, V5, O-2, R-1, R-3, C-2, C-3, S-2: unchanged from v2 Gate 8 backlog (see section below)
- REQ-012 (OIDC): deferred per D5; no timeline

### Report

```
Gaps: high=6 mid=1 low=1 (all 8 recorded as known tech debt; none in v3 scope)
Drift: none
Architecture consistent: yes — ARCH-015..019 fully consistent with IMPL-068..080;
  V2 finding CLOSED (D-DOS global semaphore at composition root);
  V3 finding partially closed (symlink escape fixed by IMPL-079; Bash opt-in → LOW);
  10 backlog items remain (was 11)
Validation: real-tier all-green? yes (VAL-025..030, 6/6 real:true or accepted D5)
           README+DEPLOY present? yes (README.md 407L, DEPLOY.md 835L)
Conclusion: v3 iteration can close; gates.review.passed stays true;
  v4 chain-backfill (REQ-022..026 requirement text + Gate 7.5/8) is the top backlog item
```

---

## v2 GATE 8 FINAL CLOSING REVIEW (2026-07-04 22:40, CURRENT / AUTHORITATIVE)

> This section supersedes "## v2 GATE 8 CLOSING RE-REVIEW (2026-07-04 20:05)" immediately below
> (kept for history). That 20:05 pass reviewed the working tree as IMPL-064 left it and correctly
> reported the V3 HIGH as downgraded to MEDIUM. Between that pass and this one, a further real-run
> defect was found and fixed **within the same fix round** (same binding decisions D-V2G8-1/D-V2G8-2,
> no new decision needed): **IMPL-067** (journal 2026-07-04 21:20) — picking up IMPL-064's own
> hand-off — ran a REAL (non-mocked) `@anthropic-ai/claude-agent-sdk` session and found that the
> `canUseTool` callback IMPL-064 wired was **silently shadowed** for the default (no opt-in)
> `Read`/`Write` case: a bare `allowedTools` entry auto-approves that tool call before `canUseTool`
> is ever consulted (the SDK's own `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` runtime warning), so a real
> unmocked `Read` of `/etc/hostname` (outside the workspace) SUCCEEDED despite the mocked UT-040
> passing green — the exact default-path exfiltration vector the original V3 HIGH named, still open
> in practice though closed on paper. IMPL-067 fixed this by wiring the SAME boundary decision as
> BOTH `canUseTool` (unchanged) AND a new `hooks.PreToolUse` matcher (`makePreToolUseHook`,
> `src/gateway/claude-agent-sdk-client.ts:164-180`) — the SDK's own documented alternative for a call
> a bare `allowedTools` entry already auto-approved — without touching `allowedTools` itself (so the
> pre-existing `UT-024`/D-F11 regression test, which requires the built-in fallback to stay bare,
> stays green). This was independently re-verified for real at **Gate 7.5 v2 ROUND 4** (journal
> 2026-07-04 22:10, `08-validation.md` "## v2 ROUND 4", VAL-019..022): live `ps aux` argv, live
> `/proc/<pid>/environ` key-custody diffing, and the REAL captured `canUseTool`/`PreToolUse` callback
> objects denying 3 real hostile-path attempts (LiteLLM's own config, a different real run's
> workspace secret, `/etc/hostname`) while allowing a genuine in-workspace path. ROUND 4 also found
> and fixed 1 new config-drift defect (`rwe.config.example.json`/DEPLOY.md's shipped example still
> listed `Bash` in `defaultAllowedTools`, which the documented `cp ...example.json rwe.config.json`
> quickstart would have silently re-enabled) — corrected to `["Read","Write"]`
> (`rwe.config.example.json:9`), confirmed on disk above. **Net effect on the architecture-consistency
> verdict below: unchanged in substance** — the residual V3 finding (Bash opt-in / symlink / other
> file-tool bypass) the 2 architecture-expert panel reports already describe is exactly what survives
> after IMPL-067 too (their critique was never about the shadowing bug — that was a real-execution-only
> defect neither static architecture lens could see — and IMPL-067 didn't touch Bash/symlink/other-tool
> coverage), so the panel reports at `.panel/review/*.md` remain valid without a re-spawn; only their
> line-citations for `canUseTool` have drifted by a few lines (now ~147-159, not 140-148) since
> IMPL-067 added `makePreToolUseHook` above it — noted here, not requiring a re-run.
>
> **V3/V4 resolved-on-disk verification performed this pass** (fresh, not trusted from the log):
> - `permissionMode: 'default'` — `src/gateway/claude-agent-sdk-client.ts:293`.
> - `BUILT_IN_CORE_TOOLS = ['Read', 'Write']` (no `Bash`) — `:118`.
> - `canUseTool: makeCanUseTool(...)` — `:294`, `makeCanUseTool`/`toolUsePreCheck`/`isInsideWorkspace`
>   — `:124-159`.
> - `hooks: { PreToolUse: [{ hooks: [makePreToolUseHook(...)] }] }` (the IMPL-067 shadowing fix) —
>   `:326`, `makePreToolUseHook` — `:164-180`.
> - `env: buildSubprocessEnv(...)` (agent-CLI env allowlist, no host secrets) — `:329`,
>   `buildSubprocessEnv`/`ENV_ALLOWLIST` — `:194-213`.
> - Proxy-subprocess env custody (D-V2G8-1(c)) — `src/gateway/litellm-proxy.ts` `_doStart()`'s
>   `spawnImpl(...)` explicit `env:` passthrough (unchanged since IMPL-064, re-verified present).
> - `RunGuard.reserve()` reserves `Math.min(remaining, this.total / 2)`, not 100%-of-remaining —
>   `src/run-guard.ts:92-98` (D-V2G8-2).
> - New/route-back tests, re-run standalone this pass, all green: `UT-039` (3/3, permission
>   hardening), `UT-040` (5/5, workspace boundary), `UT-041` (3/3, provider-key non-reachability),
>   `IT-037` (2/2, parallel budget-estimate reservation), plus the pre-existing regression guard
>   `UT-024` (3/3, D-F11 bare-`allowedTools` shape) confirmed still green (no shadowing-fix
>   regression). Full suite re-run fresh this pass: 96 files / 356 tests, 354 pass / 2 fail — same 2
>   pre-existing `IT-015`(env defect)/`IT-024`(in-flight-state test, ~1/6 documented flake, unrelated
>   to the in-flight-agent-state test's own name collision with the route-back's `IT-037` — different
>   files) failures, unchanged, no new regression.
> - `sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check` re-run fresh this pass: 247
>   items, 3 gaps (REQ-012 未實作/未驗證 + TASK-018 未實作, v3-out-of-scope baseline, byte-identical
>   to every prior round), 0 orphan/broken-link/漂移/未真實驗證, `dashboard.html` regenerated.
>
> **Conclusion of this pass: V3 (HIGH) and V4 (MEDIUM regression) both confirmed resolved on disk**,
> with real-execution re-verification (not just mocked-unit-test claims) at Gate 7.5 ROUND 4 — see
> the updated Report block at the end of this section. The rest of the architecture-consistency
> table (§2 below, unchanged from the 20:05 pass) still stands: 11 residual MEDIUM/LOW findings, 0
> HIGH, recorded as v2.1 backlog, not blocking.

### v2.1 backlog (carried, unchanged in substance by IMPL-067 — full detail in the 20:05 section §2/Retro below)
V1 (auth no-op seam, worse in v2), V2 (RunGuard global-vs-per-run cap multiplication), V3-residual
(Bash opt-in / symlink / non-`file_path`-tool workspace-confinement gaps — MEDIUM, not HIGH, since
the default surface's real shadowing bug is now closed by IMPL-067), V4-residual (`total/2`
budget-reservation magic constant, stale `run-manager.ts` comment), V5 (VM determinism guards
bypassable), O-2 (no transition-history audit trail), R-1 (3 drifted `DEFAULT_ALIASES` tables), R-3
(`workflow_artifacts` bypasses `RunStore`), C-2 (2 generic IPC error codes), C-3 (`workflow_status`
non-uniform envelope), S-2 (no LiteLLM-proxy liveness/restart supervision). 11 items, all
MEDIUM/Medium-High/LOW, 0 HIGH — not fixed this round, per binding scope (only V3/V4 were in scope
for D-V2G8-1/D-V2G8-2).

### Report (v2 Gate 8 FINAL CLOSING REVIEW, 2026-07-04 22:40 — CURRENT / AUTHORITATIVE)
```
Gaps: high=0 mid=2 low=1 (REQ-012 未實作/未驗證 + TASK-018 未實作, v3-out-of-scope, recorded as
  known tech debt; re-confirmed byte-identical this pass: 247 items, 3 gaps, 0 severe)
Drift: none (trace.py 0 漂移/orphan/broken-link gaps this pass; every v2 REQ/ARCH/TASK/DES/IMPL/UT
  chain, incl. the route-back items UT-039..041/IT-037/IMPL-064/067, consistently iter:v2/v2g8)
Architecture consistent: no — 11 residual findings, 0 HIGH (V3 HIGH from the original pre-route-back
  pass is now genuinely resolved for the default path, real-execution-verified via IMPL-067 +
  Gate 7.5 ROUND 4 VAL-019..022, and downgraded to MEDIUM for its acknowledged residual scope
  — Bash opt-in / symlink / non-file_path-tool bypass). 5 MEDIUM/LOW from adversarial (V1, V2,
  V3-downgraded, V4-downgraded, V5) + 6 Medium/Medium-High/Low-Medium from quality-dimensions (O-2,
  R-1, R-3, C-2, C-3, S-2) — all in the v2.1 backlog above, none new, none blocking.
Validation: real-tier all-green? yes (Gate 7.5 v2 ROUND 4, SCOPED security re-validation dispatched
  standalone after IMPL-067, fresh independent process, VAL-019..022 confirm D-V2G8-1(a)(b)(c)(d) +
  D-V2G8-2 for real via ps aux argv / /proc/<pid>/environ diffing / real captured canUseTool+
  PreToolUse callback deny-tests / real parallel() concurrency-restored-to-2 with 3rd budget-capped;
  0 mock-only/未驗證 among v1/v2 in-scope REQs) · README+DEPLOY present? yes, step-by-step, updated
  ROUND 4 (1 new config-drift found+fixed this round: rwe.config.example.json/DEPLOY.md's shipped
  defaultAllowedTools still listed Bash, corrected to ["Read","Write"])
Conclusion: iteration can close. The pre-route-back HIGH (V3, agent-CLI Bash/default-path escaping
  the trust boundary) is fixed and real-execution-verified twice over (IMPL-067's own repro +
  Gate 7.5 ROUND 4's independent re-verification), not merely claimed from a mocked unit test. The
  MEDIUM regression (V4, parallel() collapsing to 1 under budget) is fixed and confirmed restoring
  concurrency to 2 with the hard ceiling intact. 11 residual MEDIUM/Medium-High/LOW
  architecture-consistency findings are recorded as v1.1/v2.1 backlog, real and unresolved but none
  HIGH and none blocking, per the same binding-deferral precedent set at v1's own Gate 8 close.
  gates.review.passed -> true.
```

---

## v2 GATE 8 CLOSING RE-REVIEW (2026-07-04 20:05, superseded by the FINAL CLOSING REVIEW above)

> This section supersedes "## v2 GATE 8 REVIEW (2026-07-04, iteration v2)" immediately below, which
> was the **as-found, pre-route-back** record (correctly identified 1 HIGH — V3, agent-CLI `Bash`
> escapes the trust boundary — plus 2 related MEDIUM, V2/V4, and recommended a Gate 6 route-back).
> That route-back happened: the orchestrator dispatched D-V2G8-1 (drop `bypassPermissions`, curate
> the default tool surface to `['Read','Write']`, wire a `canUseTool` workspace-boundary callback,
> explicit proxy-subprocess env custody) and D-V2G8-2 (per-call budget-reservation cap at
> `total/2` instead of 100%-of-remaining) — RED tests (UT-039/040/041, IT-037) written at Gate 5,
> GREENED at Gate 6 (**IMPL-064**), verification-closed at Gate 6.5/7 (**IMPL-065/066**), and the
> whole iteration re-validated for real at Gate 7.5 **ROUND 3** (`08-validation.md`, `state.yaml`
> `gates.validation.note`, journal 2026-07-04 19:15). This pass re-reviews the **post-fix** code
> against the 2 architecture-expert reports, which were themselves **re-run against the fixed
> source** (`.panel/review/adversarial.md`, `.panel/review/quality-dimensions.md`, both explicitly
> scoped as "re-review after the Gate-8 v2 route-back, IMPL-064").

### 1. Traceability consistency (`sh .sdlc/trace .sdlc/features/001-remote-workflow-engine`, regenerated 2026-07-04)
- `✓ 掃描 242 個工作項，偵測 3 個缺口`. `--check`: **3 gaps**, byte-identical to every prior round's
  baseline:
  - `mid` **REQ-012 未實作** — REQ-012 (v3 OAuth 2.0/OIDC, `01-requirements.md:194-200`, `iter: v3`,
    explicitly "deferred by user decision D5") has no IMPL tracing to it.
  - `mid` **REQ-012 未驗證** — same REQ, no UT/IT/VAL tracing to it.
  - `low` **TASK-018 未實作** — TASK-018 (`03-tasks.md:124-128`, the v3 auth-middleware seam task,
    `iter: v3`, `traces: ARCH-009`) has no IMPL.
  - **0** broken-link (斷鏈), **0** orphan (孤兒), **0** doc↔code iteration-drift (漂移), **0**
    未真實驗證 (mock-only), **0** unverified in-scope (v1 or v2) REQ.
  - **gaps_high = 0, gaps_mid = 2, gaps_low = 1.** All 3 are known, accepted, out-of-scope (v3)
    tech debt — recorded here per Exit-Gate criterion 1, not accidental.
- **Doc↔code iteration drift**: none. Every v2 REQ (`REQ-008..011,015`, `iter: v2`) chains through
  `ARCH-010..014` → `TASK-019..027` (v2, except v3 `TASK-018`) → `DES-016..023` → `IMPL-052..066` →
  `UT-027..041`/`IT-031..037`/`E2E-004..005`/`VAL-008..011,016,017,018` all consistently `iter: v2`.
  The Gate-8-route-back items (UT-039/040/041, IT-037, IMPL-064/065/066) all carry `iter: v2` and
  trace to `ARCH-002/005/007` (pre-existing v1 ARCH items the v2 fix touches) — no DES/UT left
  stamped with a stale iteration while its IMPL moved on. Exit-Gate criterion 2 satisfied.

### 2. Architecture consistency (vs Gate 2 `02-architecture.md`) — post-route-back re-review
Consolidated from the 2 **already-run** expert reports (not re-spawned, per instruction) at
`.sdlc/features/001-remote-workflow-engine/.panel/review/`, both explicitly re-reviewing the
IMPL-064-fixed source, not the pre-fix snapshot:
- `adversarial.md` — security / scalability-consistency / testability (opus-4-8).
- `quality-dimensions.md` — observability / replaceability / consumability / self-sustainability
  (sonnet-4-6/5), each re-verifying every prior "resolved" claim against current source directly
  (grep/read), not taken on the log's narrative.

**Verdict: NOT (fully) consistent — but 0 HIGH remain.** The prior HIGH (V3) was **downgraded to
MEDIUM**: IMPL-064 closed the *default* agent-CLI attack surface (`permissionMode:'default'`,
`Bash` dropped from the default tool set, a `canUseTool` workspace-boundary callback) — confirmed
genuinely fixed, not a paper patch. **11 findings remain open**, all MEDIUM/MEDIUM-HIGH/LOW, none HIGH:

| # | ID | Lens | Severity | Finding (ARCH violated) | Evidence | Status |
|---|----|------|----------|-------------------------|----------|--------|
| 1 | V1 | adversarial | MEDIUM | ARCH-009 auth-middleware no-op seam still doesn't exist in `src/server.ts` — now *more* exposed (v2 added `/dashboard`, `/api/runs*`, RCE-capable `asset_push` on the same open unauthenticated listener) | `src/server.ts:471-521` | carried, worse than v1 |
| 2 | V2 | adversarial | MEDIUM | `RunGuard`'s concurrency gate (`min(16,cores-2)`) and the ARCH-002 "global" agent counter (`≤1000`) are enforced **per-run** (fresh `RunGuard` per run) — K runs multiply both host caps by K, unbounded | `src/run-guard.ts:5,13,17-18,26-52`; `src/run-manager.ts:92,127` | open, newly precise this round |
| 3 | V3 | adversarial | MEDIUM (↓ from HIGH) | Workspace confinement (`canUseTool`) covers only `Read`/`Write`'s `file_path`, lexically (not `realpath`) — an agentType opting into `Bash` (still fully supported), a symlink, or `Edit`/`Glob`/`Grep`/`NotebookEdit` bypasses it | `src/gateway/claude-agent-sdk-client.ts:118,124-128,140-148,233-236` | residual, downgraded |
| 4 | V4 | adversarial | LOW (↓ from MEDIUM) | Flat `total/2` per-call budget reservation caps `parallel()` at 2 concurrent calls under a tight budget; `run-manager.ts:332-337`'s own comment still says "reserves the entire remaining budget" — stale, contradicts the code | `src/run-guard.ts:92-98`; `src/run-manager.ts:332-338` | residual, downgraded |
| 5 | V5 | adversarial | LOW | Determinism guards (`Date.now`/`Math.random`) bypassable via VM host-realm `Function` escape; not a process-boundary property | `src/sandbox/guards.ts:163-175` | carried, unchanged |
| 6 | O-2 | quality-dims | Medium-High | Both `RunStore` impls drop `recordTransition`'s `from`/`ts` — no transition-history audit trail despite ARCH-006's "one writer of every state transition (timestamp+runId)" | `src/run-store.ts:116-120`, `src/store/sqlite-run-store.ts:114-116` | carried, unchanged since v1 |
| 7 | R-1 | quality-dims | Medium | 3 independently-maintained `DEFAULT_ALIASES` tables drifted (`run-manager.ts`/`main.ts` agree; `submission-validator.ts` differs) — ARCH-005 "config, singular" broken | `src/run-manager.ts:26-31`, `src/main.ts:40-45`, `src/submission-validator.ts:12-17` | carried, unchanged |
| 8 | R-3 | quality-dims | Medium | `workflow_artifacts` bypasses `RunStore`, calls `readdirSync` directly on the workspace path — ARCH-001 "no direct persistence (reads via ARCH-006)" | `src/mcp-facade.ts:149-163` | carried, unchanged |
| 9 | C-2 | quality-dims | Medium-High | Sandbox IPC boundary collapses every `agent()`/`workflow()` error into 1 of 2 generic codes (`AGENT_ERROR`/`NESTING_ERROR`) — ARCH-001 uniform-envelope/branch-identically promise broken | `src/sandbox/host.ts:74-104` | carried, unchanged |
| 10 | C-3 | quality-dims | Low-Medium | `workflow_status` spreads extra top-level fields (`phases`/`agents`/`scriptVersion`), not uniform with the other 15 tools | `src/mcp-facade.ts:87-92` | carried, unchanged |
| 11 | S-2 | quality-dims | Medium | `LiteLLMProxyManager` has no post-start liveness/restart supervision — a mid-run crash of the now-default gateway's always-on subprocess is permanent for the process's life | `src/gateway/litellm-proxy.ts` | carried, unchanged |

**What the route-back genuinely fixed** (both lenses agree): no `bypassPermissions`, curated default
tools (`Bash` off by default), a real `canUseTool` deny-callback, explicit proxy env custody
(`ENV_ALLOWLIST`/`buildSubprocessEnv`), and atomic budget reservation replacing the prior
stale-pre-check TOCTOU — all independently re-verified against current source, not trusted from
`06-impl-log.md`'s narrative. **0 new violations were introduced by IMPL-064..066** within either
lens's dimensions (quality-dimensions explicitly re-checked and confirms this).

**Exit-Gate criterion 3**: architecture consistency is consolidated above; the residual
inconsistency (11 MEDIUM/MEDIUM-HIGH/LOW findings, 0 HIGH) is reflected in the conclusion below.
Unlike the pre-route-back finding (V3 at HIGH, which blocked closing and correctly routed back to
Gate 6), none of the 11 residual findings rises to HIGH, and 2 of them (V3, V4) are the *same*
findings already substantively fixed this round and merely downgraded, not new defects — consistent
with the precedent set at v1's own Gate 8 close (7 MEDIUM/LOW backlogged, not blocking). Recorded as
**v2.1 backlog** below rather than a further route-back.

### 3. Validation & handover (Gate 7.5)
- `gates.validation.passed` = **true** — v2 **ROUND 3** (2026-07-04 19:15), a fresh independent
  validator dispatch (not trusting Round 2's narrative): re-ran the full boot from documented steps
  only, fresh real `ps aux`-inspected agent-CLI argv, fresh real materialized `SKILL.md`, fresh real
  `GET /dashboard` HTML + live-update-without-reload, fresh real `claude mcp list` recognition, fresh
  real SIGTERM orphan-reap. Found + fixed 1 genuine doc drift (README/DEPLOY's stale claim that the
  litellm port is fixed at 4000 and shutdown doesn't reap it — both false since TASK-027; corrected
  in the same round).
- `trace.py --check` confirms **0 未真實驗證 (mock-only)** and **0 in-scope 未驗證** gaps — the only
  2 "未驗證" cards are REQ-012 (v3, explicitly out of scope).
- `08-validation.md` exists (1906 lines), frontmatter `status: passed`, with a "v2 ROUND 3" section
  (current head) containing fresh real-process evidence, superseding but preserving ROUND 1/2 for
  history.
- Handover docs present at `state.yaml layout.readme`/`layout.deploy`: `README.md` and `DEPLOY.md`
  (product root), both step-by-step (numbered quickstart/deploy steps, health-check, rollback,
  troubleshooting table, known-limitations sections in Traditional Chinese), both updated in ROUND 3
  with the corrected litellm-port/shutdown claims.
- **No REQ closed on mock-only evidence. No missing handover doc.** Exit-Gate criterion 4 satisfied.

### Retro (v2 iteration, closing pass)
- **What went well**: the Gate-8 route-back loop worked exactly as designed — a genuine HIGH
  security finding (V3) was found by the architecture-consistency lens (not by Gate 7.5's
  REQ-acceptance testing, which structurally couldn't reach it since no round tried an
  adversarial/cross-workspace script), routed to Gate 6 with an explicit new decision (D-V2G8-1/2)
  rather than a silent patch, RED-tested first (UT-039/040/041, IT-037), fixed, and **re-verified by
  re-running the same 2 architecture experts against the fixed source** rather than trusting the
  implementer's own claim — this is what caught that V3 is downgraded-but-not-eliminated (Bash
  opt-in/symlink/other-file-tool gaps remain) instead of naively marking it "fixed."
- **What to change next iteration**: (1) Gate 5's test matrix should include an adversarial-script
  acceptance test ("agent() with Bash cannot read another run's workspace or the proxy's config")
  from the start, not only after a Gate 8 finding forces it — the residual V3 gap (Bash opt-in path)
  is exactly what such a test would keep pinned red until genuinely closed; (2) the 3-copy
  `DEFAULT_ALIASES` drift (R-1) and the 2-generic-error-code IPC collapse (C-2) have now survived 2
  full Gate-8 reviews (v1 and v2) unaddressed — should be scheduled explicitly in v2.1/v3, not
  deferred a third time; (3) `RunGuard`'s global-vs-per-run cap question (V2) and its budget
  reservation constant (V4) both point at the same underlying gap — a process-global concurrency/
  agent-count semaphore plus a per-call budget *estimate* (reconciled in `capture()`) would fix both
  in one coherent redesign instead of two separate constants.
- **Known tech debt (recorded as known gaps, not silently dropped)**:
  - v3-out-of-scope trace gaps (REQ-012, TASK-018) — deferred by the requirements Gate itself.
  - v1.1 backlog (carried unfixed from the v1 Gate 8 review, unchanged by v2): O-2, R-1, R-3, C-2,
    S-2, V1 (auth no-op seam — now worse, see above), C-3, V5(LOW, doc-wording).
  - **v2.1 architecture backlog (this round)**: V2 (global-vs-per-run RunGuard caps), V3-residual
    (Bash opt-in/symlink/other-tool workspace-confinement gaps — MEDIUM, not HIGH, since the
    *default* surface is now safe), V4-residual (`total/2` budget-reservation magic constant + its
    stale code comment).
  - v2.1 non-architecture backlog (from `08-validation.md`): aborted-`AgentRecord` cosmetic state,
    litellm port-4000 collision hazard (mitigated but not eliminated by TASK-027), tool-use re-test
    against a larger local model/paid provider, latent `cwd`-not-per-run-workspace gap, `mkdtemp()`
    temp-dir cleanup, D-V2V-3 docker/sudo environment gap (accepted, non-blocking).

### Report (v2 Gate 8 CLOSING RE-REVIEW, 2026-07-04 20:05 — CURRENT / AUTHORITATIVE)
```
Gaps: high=0 mid=2 low=1 (REQ-012+TASK-018, v3-out-of-scope, recorded as known tech debt above)
Drift: none (trace.py 0 漂移 gaps; every v2 REQ/ARCH/TASK/DES/IMPL/UT/route-back-test chain
  consistently iter:v2, incl. the Gate-8 route-back items UT-039..041/IT-037/IMPL-064..066)
Architecture consistent: no — 11 residual findings, 0 HIGH (down from 1 HIGH pre-route-back): 5
  MEDIUM/LOW from the adversarial lens (V1, V2, V3-downgraded, V4-downgraded, V5) + 6 Medium/
  Medium-High/Low-Medium from quality-dimensions (O-2, R-1, R-3, C-2, C-3, S-2) — see table above.
  The prior blocking HIGH (V3, agent-CLI Bash escaping the trust boundary) is confirmed fixed at the
  default-surface level (D-V2G8-1/IMPL-064) and downgraded to MEDIUM for its residual (opt-in
  Bash/symlink/other-file-tool) scope.
Validation: real-tier all-green? yes (Gate 7.5 v2 ROUND 3, fresh independent validator dispatch,
  CONVERGENCE RULE satisfied, 0 mock-only/未驗證 among v1/v2 in-scope REQs) · README+DEPLOY present?
  yes, step-by-step, updated ROUND 3 (1 doc-drift found+fixed: litellm port/shutdown claims)
Conclusion: iteration can close. The 1 HIGH finding that blocked the prior (pre-route-back) Gate 8
  pass is fixed and re-verified for real by re-running both architecture experts against the fixed
  source (not trusted from the implementer's log). 11 residual MEDIUM/MEDIUM-HIGH/LOW
  architecture-consistency findings (5 adversarial + 6 quality-dimensions) are recorded above as
  v1.1/v2.1 backlog per the same binding-deferral precedent set at v1's own Gate 8 close — real,
  confirmed, not silently dropped, but none blocking. gates.review.passed -> true.
```

---

## v2 GATE 8 REVIEW (2026-07-04, iteration v2 — SUPERSEDED, see "CLOSING RE-REVIEW" above)

> **Superseded 2026-07-04 20:05**: this section is the **as-found, pre-route-back** Gate 8 pass. It
> correctly found 1 HIGH (V3) + 2 related MEDIUM (V2, V4) and recommended a Gate 6 route-back. That
> route-back happened (D-V2G8-1/2, IMPL-064, re-verified at Gate 6.5/7/7.5 ROUND 3) — see the
> "CLOSING RE-REVIEW" section above for the current, authoritative state. Preserved below UNCHANGED
> for history; do not edit it to retroactively mark items fixed.

> Everything below this section (down to "## v1 Gate 8 review — historical record") is the **v1**
> Gate 8 pass (closed 2026-07-03). It is preserved unchanged for history. This new section is the
> review of the **v2** iteration (TASK-019..027 / DES-016..023 / IMPL-052..063, scheduler + dashboard
> + asset-sync + client plugin + deploy hardening), performed after Gate 7.5 v2 Round 2 flipped
> `gates.validation.passed` to `true`.

### 1. Traceability consistency (`sh .sdlc/trace .sdlc/features/001-remote-workflow-engine`, regenerated 2026-07-04 10:10)
- Total work items: **235**. `trace.py --check`: **3 gaps**, all on the identical pre-existing,
  binding-decision v3-out-of-scope baseline:
  - `mid` **REQ-012 未實作** — REQ-012 (v3 OAuth/OIDC) has no IMPL tracing to it.
  - `mid` **REQ-012 未驗證** — REQ-012 has no UT/IT/VAL tracing to it.
  - `low` **TASK-018 未實作** — TASK-018 (v3 auth middleware task) has no IMPL.
  - **0** broken-link (斷鏈), **0** orphan (孤兒), **0** doc↔code iteration-drift (漂移) gaps, **0**
    未真實驗證 (mock-only) gaps, **0** unverified in-scope (v1 or v2) REQ.
  - **gaps_high = 0, gaps_mid = 2, gaps_low = 1.** All 3 are explicitly recorded here as **known,
    accepted, out-of-v2-scope tech debt** (REQ-012/TASK-018 are `iter: v3`, deferred since Gate 1.5's
    own requirements-slice decision, reconfirmed unchanged at every gate since) — not accidental.
    Exit-gate criterion 1 satisfied.
- **Doc↔code iteration drift**: none. `trace.py`'s own drift check (comparing each item's `iter:`
  against its downstream/upstream neighbors' `iter:`) produced 0 findings. Spot-verified manually:
  every v2 REQ (`REQ-008..011,015`, `iter: v2`) traces to `ARCH-010..014` (`iter: v2`) → `TASK-019..027`
  (`iter: v2`, except `TASK-018` which is `iter: v3`) → `DES-016..023` (`iter: v2`) → `IMPL-052..063`
  (`iter: v2`) → `UT-027..033`/`IT-031..036`/`E2E-004..005`/`VAL-008..011,016,017,018` (`iter: v2`) —
  no DES/UT left at a stale `iter` while its IMPL moved on. Exit-gate criterion 2 satisfied.

### 2. Architecture consistency (vs Gate 2 `02-architecture.md`)
Consolidated from the 2 pre-run expert reports at `.sdlc/features/001-remote-workflow-engine/.panel/review/`
(already present, not re-spawned, per instruction):
- `adversarial.md` — security / scalability-consistency / testability (opus), scoped to the files each
  touched `IMPL-*` lists plus directly-referenced module boundaries.
- `quality-dimensions.md` — observability / replaceability / consumability / self-sustainability
  (sonnet), same scoping; explicitly re-verifies (not trusts) each prior-round finding against the
  current source tree.

**Verdict: NOT consistent.** Of the v1 Gate-8 closing round's 10 architecture-consistency findings,
**4 are now genuinely RESOLVED** (re-verified against current source, not taken on faith): O-1
(transcript stream now captured, `claude-agent-sdk-client.ts:150-164,272-295` + `agent-executor.ts:108-113`),
C-1 (`tools/list` real per-tool schemas, `server.ts:121-264`), S-1 (default `timeoutMs` fallback,
`main.ts:100,145`), R-2 (`ENV_ALLOWLIST`, `claude-agent-sdk-client.ts:129-148`).

**11 violations remain open or newly found** — 1 HIGH, 8 MEDIUM(-ish), 2 LOW:

| # | ID | Severity | Finding | ARCH violated | Evidence | Status |
|---|----|----------|---------|----------------|----------|--------|
| 1 | V3 | **HIGH (NEW)** | The untrusted script's `agent()` call reaches a fully-privileged, `Bash`-capable CLI in the parent trust zone (`permissionMode:'bypassPermissions'`, default tools include `Bash`, the only fs confinement is `cwd`) — a script can have the agent `cat` the LiteLLM proxy's on-disk config (real provider API keys) or another run's workspace/journal and return it as the `agent()` result, exfiltrating host secrets and cross-run data straight through the trust boundary the architecture's whole security story rests on. | ARCH-007 (fs confinement to the run workspace), ARCH-005 (sole parent-only key custody), rationale D6/C1 (trust split removes keys/network/fs from blast radius) | `src/gateway/claude-agent-sdk-client.ts:222` (`bypassPermissions`), `:115` (`BUILT_IN_CORE_TOOLS` incl. `Bash`), `:219` (`cwd`-only confinement) | Open |
| 2 | V2 | MEDIUM (NEW — corrects a prior round's mis-classification) | `RunGuard`'s concurrency gate (`min(16,cores-2)`) and the agent counter ARCH-002 explicitly calls **global** (`≤1000`) are both enforced **per-run** (`run-guard.ts:5,13,17-18,46-52`; a fresh `RunGuard` built per run at `run-manager.ts:127,226`) — K concurrent runs multiply both host-protection caps by K, unbounded, on the single node. | ARCH-002 | `src/run-guard.ts:5,13,17-18,26-44,46-52`; `src/run-manager.ts:92,127,226` | Open |
| 3 | V4 | MEDIUM (NEW — side effect of the v1 Gate-8 fix for the prior V2) | The D-G8-6 budget-reservation fix (`reserve()`) reserves **100% of currently-remaining budget** per call, held for the whole call; under any bounded budget, `parallel([a,b,c])` has the first call reserve everything and the rest immediately throw `BudgetExceededError` (swallowed to `null` by `makeParallel`) — every bounded-budget run silently loses ALL concurrency, contradicting `parallel()`'s own concurrent semantics. | ARCH-002 ⟂ ARCH-003 | `src/run-guard.ts:79-84`; `src/run-manager.ts:338,378`; `src/sandbox/guards.ts:78-85` | Open |
| 4 | O-2 | MEDIUM-HIGH (carried) | Both `RunStore` impls drop `recordTransition`'s `from`/`ts` params — no transition-history/audit trail exists despite ARCH-006's "one writer of every state transition (timestamp+runId)" promise. | ARCH-006 | `src/run-store.ts:116-120`, `src/store/sqlite-run-store.ts:114-116` | Open, unchanged since v1 |
| 5 | C-2 | MEDIUM-HIGH (carried) | Sandbox IPC boundary collapses every distinct `agent()`/`workflow()` failure into 1 of 2 generic codes (`AGENT_ERROR`/`NESTING_ERROR`), discarding real error identity. | ARCH-001 (uniform envelope, branch identically) | `src/sandbox/host.ts:74-104` | Open, unchanged since v1 |
| 6 | V1 | MEDIUM (carried) | ARCH-009's promised zero-v1-rework auth-middleware no-op seam still does not exist in `src/server.ts` — now MORE exposed (v2 added unauthenticated `/dashboard`, `/api/runs*`, and the RCE-capable `asset_push` on the same open listener). | ARCH-001, ARCH-009, rationale C4/D5 | `src/server.ts:471-521` | Open, worse than v1 |
| 7 | R-1 | MEDIUM (carried) | 3 independently hand-maintained `DEFAULT_ALIASES` tables have drifted to different model-id values for the same alias names (`run-manager.ts`/`main.ts` agree; `submission-validator.ts` differs). | ARCH-005 (config as single source of truth), ARCH-008 | `src/run-manager.ts:26-31`, `src/main.ts:40-45`, `src/submission-validator.ts:12-17` | Open, unchanged since v1 |
| 8 | R-3 | MEDIUM (carried) | `workflow_artifacts` bypasses `RunStore` entirely, calls `readdirSync` directly on the workspace path. | ARCH-001 (no direct persistence, reads via ARCH-006) | `src/mcp-facade.ts:149-163` | Open, unchanged since v1 |
| 9 | S-2 | MEDIUM (carried) | `LiteLLMProxyManager` has no post-start liveness/restart supervision — a mid-run subprocess crash of the now-default gateway's always-on dependency is permanent for the server process's life. | ARCH-014 (self-healing framing) | `src/gateway/litellm-proxy.ts` | Open, unchanged since v1 |
| 10 | C-3 | LOW-MEDIUM (carried) | `workflow_status`'s envelope spreads extra top-level fields (`phases`/`agents`/`scriptVersion`), not uniform with the other 9 (now 15, incl. v2) tools. | ARCH-001 (uniform envelope) | `src/mcp-facade.ts:87-92` | Open, unchanged since v1 |
| 11 | V5 | LOW (carried) | Determinism guards (`Date.now`/`Math.random`) are advisory only, bypassable via the VM's host-realm `Function` constructor escape. | ARCH-003 | `src/sandbox/guards.ts:163-174` | Open, unchanged since v1 (correctly judged LOW — non-adversarial script threat model) |

**What the impl got right this round** (both lenses, for balance): the prior v1 Gate-8 HIGH fixes hold
under re-verification (env-allowlist, nested-`callSeq` namespacing, real `tools/list` schemas, default
`timeoutMs`); all core seams (gateway/store/spawner/clock, `queryImpl`/`fetchImpl`/`mcpProbe`/
`proxyManager`) remain constructor-injected; bind default and the fail-fast validator's ownership model
are unchanged/compliant; the v2 scheduler/dashboard/asset-sync/plugin/deploy work introduces **0 new
violations of its own** within either lens's dimensions — all 11 open findings are either carried
unchanged from v1 or are newly-surfaced consequences of the v1 Gate-8 fixes themselves (V2, V4), not
defects in the new v2 feature code.

**Exit-gate criterion 3**: architecture consistency is consolidated above; the inconsistency is real
and reflected in the conclusion below. **V3 (HIGH) is a genuine security-boundary violation that
contradicts explicit Gate-2 rationale (D6/C1's blast-radius claim) and was not present/flagged in the
v1 review** — it is newly surfaced now because `Bash`-capable tool-use against a real local model was
only exercised for real starting in v2's validation rounds. This is not a "decision not honored, cheap
fix" item like the v1 HIGH batch; it requires an actual architecture decision (jail/chroot the CLI
subprocess's fs, or drop `Bash` from the default tool set, or move provider-key storage off any path
the agent's fs access can reach) before a route-back implementation is dispatched — **recommend
routing to Gate 2 (or at minimum Gate 6 with an explicit new ARCH decision, not a silent code patch)**
for V3 specifically. V2 and V4 are consequences of a single v1 fix (D-G8-6) trading a real overshoot
bug for a real concurrency-collapse bug — these should route back to Gate 6 together (a shared
estimate-then-reconcile budget-reservation redesign fixes both without a new Gate-2 decision). The 7
remaining MEDIUM/LOW carried items (O-2, C-2, V1, R-1, R-3, S-2, C-3, V5) may continue to be recorded
as backlog (as they were after v1's Gate 8) if the team elects not to fix them this cycle, but they
must stay recorded, not silently dropped.

### 3. Validation & handover (Gate 7.5)
- `gates.validation.passed` = **true** — v2 Round 2 (2026-07-04), CONVERGENCE RULE satisfied: all 5 v2
  REQs (`REQ-008/009/010/011/015`) have real, fresh `real:true` green VAL/E2E evidence (`VAL-008..011,
  016,017,018`), including round-2's re-verification of the 2 fixes (D-V2V-1 asset wiring via `ps aux`
  argv inspection + on-disk skill materialization; D-V2V-2 real `GET /dashboard` HTML + live-update
  demonstration) and no-regression smoke on REQ-010/011/015.
- `trace.py --check` confirms **0 未真實驗證 (mock-only)** and **0 in-scope 未驗證** gaps — the only
  2 "未驗證" cards are REQ-012, explicitly v3-out-of-scope.
- `08-validation.md` exists (frontmatter `status: passed`), with a "v2 ROUND 2" section (current head)
  containing real-process evidence (real spawned `claude` CLI argv via `ps aux`, real materialized
  `SKILL.md` on disk, real `GET /dashboard` HTTP response, real `claude mcp list` recognition, real
  `scripts/smoke.sh` pass + orphan-reap confirmation).
- Handover docs present at `state.yaml layout.readme`/`layout.deploy`: `README.md` (372 lines) and
  `DEPLOY.md` (465 lines), both step-by-step (numbered quickstart/deploy steps, health-check section,
  rollback section, troubleshooting table, known-limitations section), both updated in v2 Round 2 with
  fresh evidence (v2 status header flipped to GATE PASSED).
- **No REQ closed on mock-only evidence. No missing handover doc.** Exit-gate criterion 4 satisfied at
  the REQ-acceptance level.
- **Caveat (same class as the v1 review's caveat)**: this Gate-8 architecture-consistency pass surfaced
  V3 (HIGH), a real security exposure that Gate 7.5's 2 v2 rounds never exercised (both rounds' agent
  tool-use tests used benign scripts, never a script attempting cross-workspace/secret-file access).
  This is not a Gate 7.5 process failure — it tested every documented REQ acceptance clause — it is a
  gap in what was tested, now found by this Gate 8 review, and should be added to Gate 7.5's test
  matrix on the route-back (an adversarial-script acceptance test: "a workflow script's `agent()` call
  cannot read another run's workspace or the litellm proxy's config file").

### Retro (v2 iteration)
- **What went well**: the v2 slice (scheduler + dashboard + asset-sync + plugin + deploy hardening) was
  delivered with 0 new architecture-consistency violations of its own; Gate 7.5 found and route-backed
  2 real defects (REQ-009 asset wiring never reaching any `agent()` call; REQ-008's dashboard not
  actually being a browser page) rather than accepting weaker acceptance criteria, and both were
  re-verified for real (not just re-tested) in Round 2 before `gates.validation.passed` flipped; the
  quality-dimensions expert this round explicitly re-verified every prior "resolved" claim against
  current source instead of trusting `06-impl-log.md`'s own narrative, catching that the process/data
  is genuinely fixed for 4 of 10 prior findings.
- **What to change next iteration**: (1) the architecture-consistency review should run **during**
  implementation once real Bash-tool-use against a real local model is exercised for the first time —
  V3 (the HIGH finding) was structurally invisible until an actual agent()-with-tools call was made for
  real, which only happened in v2's validation rounds; a scoped adversarial-script test belongs in the
  Gate 5 test matrix from now on, not discovered post-hoc at Gate 8; (2) a single-fix-at-a-time approach
  to `RunGuard` (v1's D-G8-6 fixed one bug and introduced another, V4) suggests budget/concurrency
  invariants need one coherent redesign (estimate-reserve + reconcile) rather than incremental patches;
  (3) the 3-copy `DEFAULT_ALIASES` drift (R-1) and the 2-generic-error-code IPC collapse (C-2) have now
  survived 2 full Gate-8 reviews unaddressed — recommend scheduling both explicitly in the v1.1/v2.1
  backlog pass rather than leaving them permanently deferred.
- **Known tech debt (recorded as known gaps)**:
  - v3-out-of-scope trace gaps (REQ-012, TASK-018) — deferred by the requirements Gate itself.
  - v1.1 backlog (carried unfixed from the v1 Gate 8 review): O-2 (transition audit trail), R-1
    (duplicated `DEFAULT_ALIASES`), R-3 (`workflow_artifacts` bypasses `RunStore`), C-2 (collapsed
    sandbox IPC error codes), S-2 (no litellm-proxy liveness supervision), V1 (auth no-op seam), C-3
    (non-uniform `workflow_status` envelope), V5 (advisory-only determinism guards, LOW, doc-wording).
  - v2.1 backlog (non-REQ improvement ideas, from `08-validation.md`): aborted-`AgentRecord` cosmetic
    state, litellm port-4000 collision hazard, tool-use re-test against a larger local model / paid
    provider, latent `cwd`-not-per-run-workspace gap, `mkdtemp()` temp-dir cleanup, D-V2V-3
    docker/sudo environment gap (accepted).
  - **NEW this round, NOT backlog-eligible — blocking**: V3 (HIGH, agent-CLI Bash escapes the trust
    boundary to host secrets/other-run workspaces) and its close relatives V2/V4 (global-vs-per-run
    resource caps; budget-reservation collapses `parallel()` concurrency) require a Gate 6 route-back
    before this iteration can close, per the exit-gate contract ("any inconsistency reflected in the
    conclusion, may send back to Gate 2/6").

### Report (v2 Gate 8, 2026-07-04 — CURRENT / AUTHORITATIVE)
```
Gaps: high=0 mid=2 low=1 (REQ-012+TASK-018, v3-out-of-scope, recorded as known tech debt above)
Drift: none (trace.py 0 漂移 gaps; all v2 REQ/ARCH/TASK/DES/IMPL/UT chains consistently iter:v2)
Architecture consistent: no — 11 violations (1 HIGH: V3 agent-CLI Bash escapes trust boundary to host
  secrets/other-run workspaces, NEW this round; 2 MEDIUM NEW: V2 global-vs-per-run RunGuard caps, V4
  budget-reservation collapses parallel() concurrency; 8 MEDIUM/LOW carried unchanged from v1: O-2,
  C-2, V1, R-1, R-3, S-2, C-3, V5) — see table above
Validation: real-tier all-green? yes (Gate 7.5 v2 Round 2, CONVERGENCE RULE satisfied, 0 mock-only/
  未驗證 among v1/v2 in-scope REQs) · README+DEPLOY present? yes, step-by-step, updated Round 2
Conclusion: send back to Gate 6 (implementation route-back) for the 1 HIGH architecture-consistency
  finding (V3 — jail/jail-equivalent the agent CLI's fs reach, or drop Bash from the default tool set,
  or move provider-key storage off any agent-reachable path; needs an explicit new decision, not a
  silent patch, so Gate 2 should bless the chosen fix) plus its 2 closely-related MEDIUM
  consequences (V2, V4, both stemming from the same RunGuard area and cheapest fixed together via a
  coherent estimate-reserve+reconcile redesign). The 8 remaining MEDIUM/LOW findings and the 3
  pre-existing v3-out-of-scope trace gaps may be carried as known tech debt (as recorded above) if the
  team elects not to fix them this cycle, but must stay recorded rather than silently dropped.
  gates.review.passed stays false pending the Gate 6 route-back.
```

---

## v1 Gate 8 review — historical record (2026-07-03, superseded by the v2 section above)

> **Gate 8 closing-fixes update (IMPL-051, 2026-07-03):** the 4 HIGH architecture-consistency
> findings below (V3, O-1, C-1, S-1) plus 2 of the 9 MEDIUM findings (V2, V5) are now FIXED per the
> binding decisions D-G8-1..6 — see `06-impl-log.md` IMPL-051 and the `04-design.md` D-G8-* route-back
> notes for exactly what changed and why. The remaining MEDIUM/LOW findings (V1 auth no-op seam, O-2
> transition audit trail, R-1 duplicated `DEFAULT_ALIASES`, R-2, R-3, C-2, S-2, V4, C-3) are formally
> RECORDED below as a **v1.1 backlog** — a binding decision NOT to fix them this round, not an
> oversight. The narrative below (violations list, retro, report) is preserved UNCHANGED as the
> as-found record from the original Gate 8 review pass; do not edit it to retroactively mark items
> fixed — the "Gate 8 closing-fixes update" callouts (this one, and inline ones below) carry the
> current status instead.

> **GATE 8 CLOSING RE-REVIEW (2026-07-03 22:05, this pass — `gates.review.passed` now flips to
> `true`):** independently re-verified all 6 D-G8-1..6 fixes directly against the current source tree
> (not just trusted `06-impl-log.md`'s own narrative), their forcing tests, and the Gate 7.5 round-7
> spot re-validation evidence in `08-validation.md`. All 6 CONFIRMED RESOLVED:
> | # | Decision | Finding fixed | Code evidence | Test evidence | Real-process evidence |
> |---|---|---|---|---|---|
> | 1 | D-G8-1 | V3 (HIGH) — nested `workflow()` callSeq collision | `src/run-manager.ts:272` `RunManager._nestedCallSeq(parentCallSeq, nestedCallSeq)`, called at `src/run-manager.ts:311` | `tests/integration/nested-workflow-callseq-resume.test.ts` green | 08-validation.md round 7: regression-suite + source-confirmed call site (not independently re-booted this round, per its own scoping) |
> | 2 | D-G8-2 | O-1 (HIGH) — transcript black-box | `src/gateway/claude-agent-sdk-client.ts:91` `extractEvents()`, forwarded at `:200`; `AgentTranscriptSink.capture()` emits `result.events` before the terminal usage event | `IT-026/IT-027` green | 08-validation.md round 7: real Ollama `agent('...PONG')` — `workflow_agent_log` returned a real ordered `message` event followed by the terminal `usage` event |
> | 3 | D-G8-3 | C-1 (HIGH) — placeholder `tools/list` | `src/server.ts:91` `TOOL_METADATA` (real description + real `inputSchema.properties`/`required` per tool), served at `:238` | `IT-028` — 3 of 4 sub-cases green, 1 sub-case a confirmed test defect (see below) | 08-validation.md round 7: real HTTP `tools/list` returned real descriptions/schemas for all 10 tools |
> | 4 | D-G8-4 | S-1 (HIGH) — no default `timeoutMs` on zero-config default gateway path | `src/main.ts:98` `timeoutMs: fileConfig.timeoutMs ?? 15000`, resolved value forwarded at `:122` (fixes the 2nd bug found while verifying: the SDK client ctor was reading the raw `fileConfig.timeoutMs`, not the resolved one) | `IT-029` green | 08-validation.md round 7: booted with NO config file, real unresponsive TCP peer — `agent()` resolved `result:null`, run `completed` in 5.2s, never hung; direct composition-root probe confirmed resolved `timeoutMs=15000` and a 15014ms-bounded forced-hang |
> | 5 | D-G8-5 | V5 (MEDIUM) — full `process.env` forwarded to spawned CLI | `src/gateway/claude-agent-sdk-client.ts:71` `ENV_ALLOWLIST`, `:76` `buildSubprocessEnv()`, applied at `:167` | `tests/unit/claude-agent-sdk-gateway-env-allowlist.test.ts` green | 08-validation.md round 7: regression-suite + source-confirmed call site |
> | 6 | D-G8-6 | V2 (MEDIUM) — stale pre-dispatch budget check under `parallel()` | `src/run-guard.ts:79` `reserve()`/`:88` `releaseReserved()`, called atomically (no `await` between) at `src/run-manager.ts:338`/`:378` | `tests/integration/parallel-budget-concurrency.test.ts` green | 08-validation.md round 7: regression-suite + source-confirmed call site |
>
> Full suite re-run fresh this pass: `npx vitest run` = 69 files/217 tests, 214 pass/3 fail — all 3
> fails are pre-existing, individually root-caused, documented `test_defect`s, re-confirmed here, none
> a product regression from D-G8-1..6:
> - `IT-015` (`tests/integration/claude-agent-sdk-session.test.ts`) — pre-existing, environment-specific
>   (this sandbox is itself a nested Claude Code host that intercepts `query()`), unrelated to this
>   round, unchanged since round 4.
> - `IT-024` (`tests/integration/in-flight-agent-state.test.ts`) — the documented ~1-in-6 real-
>   subprocess IPC-delivery race; re-confirmed the exact flake pattern this pass (failed on 2
>   consecutive standalone runs, then passed on the next 3 consecutive standalone runs) — matches
>   `vitest.config.ts`'s own documented/accepted flake class for real-child-process integration tests,
>   not a regression.
> - `IT-028` (`tests/integration/mcp-tools-list-schema.test.ts`) — 3 of 4 sub-cases green; the 4th
>   sub-case ("every tool has non-empty `inputSchema.properties`") wrongly applies to `workflow_list`,
>   which `04-design.md:45`'s own signature (`workflow_list(a?: {})`) documents as genuinely zero-
>   parameter — it correctly has real, honest, empty `properties:{}`, not a placeholder. This is the
>   SAME test defect the Gate-6 implementer flagged in IMPL-051's own narrative and Gate 7.5 round 7
>   independently re-confirmed; re-confirmed a third time here. Not a product defect, not fudged.
>
> `sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check`: 187 items, 18 gaps — identical
> pre-existing v2/v3-out-of-scope baseline (`REQ-008..012/015`, `TASK-018..023`), 0 orphan/broken-link,
> 0 new gaps. **Doc↔code iteration drift: none** — `04-design.md` DES-001/002/004/008/009 each carry a
> D-G8-* route-back note matching IMPL-051 in the same round; `README.md`/`DEPLOY.md` were rewritten in
> the same round (Gate 7.5 round 7) that produced the real-process evidence confirming these fixes.
> **Remaining architecture-consistency violations after this closing round: 0 HIGH** (all 4 fixed and
> re-confirmed); **7 MEDIUM/LOW remain**, all correctly recorded in the "v1.1 backlog" section below per
> the binding user decision to defer them, not silently dropped. **Exit-gate criteria 1-4 (see gate
> contract) are now all satisfied — this iteration can close.**

## Consistency conclusion

### Traceability (`trace.py --check`, regenerated 2026-07-03)
- Total work items: **180**
- Requirements: 15 (v1 slice: REQ-001..007,013,014; v2: REQ-008..011; v3: REQ-012,015)
- Gaps: **high=0, mid=12, low=6** (18 total)
  - **mid (12)** = REQ-008/009/010/011/012/015 each with 2 gaps (未實作 + 未驗證) — all **v2/v3, explicitly out of v1 scope** per `state.yaml notes` and every Gate's own note since Gate 3.
  - **low (6)** = TASK-018..023, the coarse v2/v3 placeholder tasks with no v1 implementation — same out-of-scope set.
  - **high = 0**: 0 broken links, 0 orphans, 0 mock-only (`僅 mock 驗證` card = 0), 0 v1-REQ 未驗證/未真實驗證. This matches the identical baseline every round from Gate 5 through Gate 7.5 round 6 independently reconfirmed (18 gaps, same IDs, 0 new).
  - **All 18 remaining gaps are recorded here as known, accepted, out-of-v1-scope tech debt** (v2/v3 slice deferred by the requirements Gate itself), not accidental drift. Exit-gate criterion 1 satisfied.
- Doc↔code iteration drift: **none found.** Every DES-* item in `04-design.md`, every IMPL-* item in `06-impl-log.md`, and every v1 REQ carry `iter: v1` consistently; no DES/UT left at a stale iter while its IMPL moved on. `state.yaml`'s dense route-back history (rounds D-R1..D-R5, D-F1..D-F13, D-V1..D-V7) shows each round's design/doc updates (04-design.md route-back notes, README.md/DEPLOY.md rewrites) were applied in the SAME round as the corresponding IMPL change, not deferred. Exit-gate criterion 2 satisfied.

### Architecture consistency (vs Gate 2 `02-architecture.md`)
Consolidated from the 2 pre-run expert reports at `.sdlc/features/001-remote-workflow-engine/.panel/review/` (not re-spawned, per instruction):
- `adversarial.md` — security / scalability-consistency / testability (opus)
- `quality-dimensions.md` — observability / replaceability / consumability / self-sustainability (sonnet)

**Verdict: NOT fully consistent.** 15 violations found across the two reports (0 counted as violations for the 1 advisory-only note). None of these were caught by Gate 7.5's REQ-acceptance-clause validation because they are architecture-invariant-level findings (module-boundary/seam/observability promises in `02-architecture.md`'s rationale text), not REQ-acceptance-clause-level findings — this is exactly the class of drift Gate 8's architecture-consistency check exists to catch that Gate 7.5 structurally cannot.

**HIGH severity (4)** — directly contradict explicit `02-architecture.md` rationale text, not just under-building a nice-to-have:
1. **V3 (adversarial)** — nested `workflow()` reuses the parent `runId`'s journal but the nested child process's own `callSeq` counter restarts at 0 (`src/sandbox/child-entry.ts:29`), so colliding `callSeq` values corrupt `ResumeCache`'s longest-unchanged-prefix matching (`src/run-manager.ts:309-311`) — violates ARCH-002 (serialized journal-append ordering) and ARCH-006, breaks REQ-006 resume determinism for any nested-workflow run. `src/run-manager.ts:294`, `src/sandbox/child-entry.ts:29,81`.
2. **O-1 (quality-dims)** — `AgentTranscriptSink` never captures `message`/`tool_call`/`tool_result` events, only a terminal `usage` summary; `ClaudeAgentSdkGatewayClient._drain` explicitly discards every SDK message except the final `result` (`src/gateway/claude-agent-sdk-client.ts:158-172`, `if (msg.type !== 'result') continue`). Violates ARCH-004's own "one capture path taps the SDK message/event stream" rationale — `workflow_agent_log` can never show a real reasoning/tool-call trace, only one line per call.
3. **C-1 (quality-dims)** — `tools/list` serves placeholder metadata for all 10 tools (`description: name`, `inputSchema: {type:'object'}`, no properties/required) — `src/server.ts:147-149`. Violates ARCH-001's "uniform result envelope so callers branch identically" consumability rationale; a caller cannot learn any tool's real parameter contract from the served schema.
4. **S-1 (quality-dims)** — the new *default* production gateway path (`ClaudeAgentSdkGatewayClient`, selected by `src/main.ts composeConfig()` whenever no config file exists — the exact zero-config "just run it" deployment `main.ts` was built to support) has **no hardcoded `timeoutMs` fallback** (contrast `bind`/`port`, which do have real defaults). Violates decision D-G, explicitly **user-reconfirmed on 2026-07-03** ("keep the minimal breaker in v1... so a dead/hung provider cannot hang a whole run"). A dead local Ollama hangs `agent()` — and the whole run, since the concurrency slot stays held — indefinitely with zero automatic recovery, in the exact zero-config scenario the entrypoint exists for. **This is a genuine new finding this validation rounds did not test** (every Gate 7.5 round used an explicit config file with `timeoutMs` set), not previously flagged.

**MEDIUM / MEDIUM-HIGH (9)**:
5. V1 (adversarial, MEDIUM) — the ARCH-009 auth-middleware no-op seam (promised "zero v1 rework" extension point for v3 OIDC) does not exist in `src/server.ts:133-166`; the transport→facade path has no wrapper/hook point.
6. V2 (adversarial, MEDIUM) — `RunGuard.assertBudget()` is a stale pre-dispatch check (tokens added only post-invoke in `capture()`); under `parallel()`, all N concurrent calls can pass the gate before any spend is recorded, allowing large budget overshoot. `src/run-manager.ts:314`, `src/agent-executor.ts:103,192`.
7. V5 (adversarial, LOW-MEDIUM) — `ClaudeAgentSdkGatewayClient` forwards the **entire** `process.env` (`env: {...process.env, ...}`) to the spawned CLI subprocess, contradicting the file's own D-R2 "never forwards a real host credential" comment — only `ANTHROPIC_API_KEY` is actually overridden. `src/gateway/claude-agent-sdk-client.ts:129-133`.
8. O-2 (quality-dims, MEDIUM-HIGH) — both `RunStore` implementations drop `recordTransition`'s `from`/`ts` params (`src/run-store.ts:116-120`, `src/store/sqlite-run-store.ts:114-116`) — no transition-history/audit trail exists despite ARCH-006's "one writer of every state transition (timestamp + runId)" promise.
9. R-1 (quality-dims, MEDIUM) — 3 independently-maintained `DEFAULT_ALIASES` tables have drifted (`src/run-manager.ts:26-31`/`src/main.ts:39-44` vs `src/submission-validator.ts:12-17` use different model-id strings for the same alias names) — the fail-fast validator (ARCH-008) validates against a table the gateway doesn't actually route with.
10. R-2 (quality-dims, MEDIUM) — the two `GatewayClient` impls silently diverge on secret custody (same root cause as V5 above), breaking ARCH-005's "swap without side effects" replaceability promise.
11. R-3 (quality-dims, MEDIUM) — `workflow_artifacts` bypasses the `RunStore` port and calls `readdirSync` directly on the workspace path (`src/mcp-facade.ts:149-163`) — violates ARCH-001's "no direct persistence (reads via ARCH-006)".
12. C-2 (quality-dims, MEDIUM-HIGH) — the sandbox IPC boundary collapses every `agent()`/`workflow()` error into one of 2 generic codes (`AGENT_ERROR`/`NESTING_ERROR`), discarding the real error identity (`BudgetExceededError`, `CatalogNotFoundError`, etc.) — `src/sandbox/host.ts:74-104`.
13. S-2 (quality-dims, MEDIUM) — `LiteLLMProxyManager` has no post-start liveness/restart supervision; a mid-run subprocess crash is permanent for the server process's life. `src/gateway/litellm-proxy.ts`.

**LOW (2)**:
14. V4 (adversarial, LOW) — determinism guards (`Date.now`/`Math.random`) are advisory only, bypassable via the VM's host-realm `Function` constructor escape — correctly judged LOW since the threat model is non-adversarial Claude-generated scripts, but ARCH-003's text should stop implying the guard is enforced.
15. C-3 (quality-dims, LOW-MEDIUM) — `workflow_status`'s response envelope spreads extra top-level fields (`phases`/`agents`/`scriptVersion`) not present on the other 9 tools' uniform envelope.

**Advisory, not counted as a violation**: gateway path proliferation (3 near-identical abort/timeout/retry races across `LiteLLMGatewayClient` direct-fetch, its LiteLLM-proxy path, and `ClaudeAgentSdkGatewayClient`) — legitimately driven by explicit user decisions D1/route-backs, flagged only for future consolidation.

> **Gate 8 closing-fixes status (IMPL-051):** items 1-4 (all HIGH) FIXED via D-G8-1 (nested `callSeq`
> namespacing), D-G8-2 (transcript event forwarding), D-G8-3 (real `tools/list` schemas), D-G8-4
> (hardcoded `timeoutMs` fallback). Item 6 (V2) FIXED via D-G8-6 (`RunGuard.reserve()`/
> `releaseReserved()` atomic budget gate). Item 7 (V5) FIXED via D-G8-5 (`ENV_ALLOWLIST` on the spawned
> CLI subprocess). Items 5, 8-15 (V1, O-2, R-1, R-2, R-3, C-2, S-2, V4, C-3) are DEFERRED — see the
> "v1.1 backlog" section below for the binding decision recording each as known, accepted tech debt
> for this round, not silently dropped.

## v1.1 backlog (Gate 8 MEDIUM/LOW findings, deferred per binding decision — recorded, not fixed this round)

The following review findings are **binding-decision-deferred**, not overlooked. Each remains a real,
confirmed architecture-consistency gap; none blocks this round's Gate 8 exit (only the 4 HIGH items
were required to be fixed this round, per the binding instruction that dispatched this closing-fixes
pass).

| # | ID | Severity | Finding | Evidence |
|---|----|----------|---------|----------|
| 1 | V1 | MEDIUM | ARCH-009's promised "zero v1 rework" auth-middleware no-op seam does not exist — the transport→facade path (`src/server.ts`) has no wrapper/hook point at all. A v3 OIDC resource-server swap will require touching `server.ts` itself, not just plugging in a new middleware. | `src/server.ts:133-166` |
| 2 | O-2 | MEDIUM-HIGH | Both `RunStore` implementations drop `recordTransition`'s `from`/`ts` params — no transition-history/audit trail exists despite ARCH-006's "one writer of every state transition (timestamp + runId)" promise. Every transition is overwritten in place; there is no way to reconstruct a run's full lifecycle history after the fact. | `src/run-store.ts:116-120`, `src/store/sqlite-run-store.ts:114-116` |
| 3 | R-1 | MEDIUM | 3 independently-maintained `DEFAULT_ALIASES` tables (`run-manager.ts`, `main.ts`, `submission-validator.ts`) have drifted to different model-id strings for the same alias names — the fail-fast validator (ARCH-008) can validate against a table the gateway doesn't actually route with. A single shared exported constant would remove the drift risk entirely. | `src/run-manager.ts:26-31`, `src/main.ts:39-44`, `src/submission-validator.ts:12-17` |
| 4 | R-2 | MEDIUM | The two `GatewayClient` implementations diverge on secret custody conventions (same root cause class as V5, though D-G8-5 only fixed `ClaudeAgentSdkGatewayClient`'s specific env-forwarding instance of it) — breaks ARCH-005's "swap without side effects" replaceability promise; a caller cannot assume both impls handle credentials identically. | `src/gateway/client.ts`, `src/gateway/claude-agent-sdk-client.ts` |
| 5 | R-3 | MEDIUM | `workflow_artifacts` bypasses the `RunStore` port entirely and calls `readdirSync` directly on the workspace path — violates ARCH-001's "no direct persistence (reads via ARCH-006)" boundary rule. | `src/mcp-facade.ts:149-163` |
| 6 | C-2 | MEDIUM-HIGH | The sandbox IPC boundary collapses every `agent()`/`workflow()` error into one of 2 generic codes (`AGENT_ERROR`/`NESTING_ERROR`), discarding the real error identity (`BudgetExceededError`, `CatalogNotFoundError`, etc.) — a script's own `catch(e){ e.code }` handling can't distinguish error causes it otherwise could. | `src/sandbox/host.ts:74-104` |
| 7 | S-2 | MEDIUM | `LiteLLMProxyManager` has no post-start liveness/restart supervision — a mid-run subprocess crash is permanent for the server process's life (no auto-restart, no health re-check). | `src/gateway/litellm-proxy.ts` |
| 8 | V4 | LOW | Determinism guards (`Date.now`/`Math.random`) are advisory only, bypassable via the VM's host-realm `Function` constructor escape — correctly judged LOW (non-adversarial Claude-generated script threat model), but `02-architecture.md` ARCH-003's text should stop implying the guard is fully enforced. | n/a (doc-wording nit) |
| 9 | C-3 | LOW-MEDIUM | `workflow_status`'s response envelope spreads extra top-level fields (`phases`/`agents`/`scriptVersion`) not present on the other 9 tools' uniform envelope — a minor consumability inconsistency. | `src/mcp-facade.ts` |

Recommended prioritization for a future v1.1 pass (not binding, advisory only): O-2 (audit trail) and
R-1 (alias-table drift) are the cheapest fixes with the clearest correctness payoff; V1 (auth seam)
should be scheduled ahead of any actual v3 OIDC work, not deferred indefinitely.

**What the architecture got right** (adversarial lens, for balance): the process-boundary trust split (D6/C1) genuinely contains the secrets/network/fs blast radius; all core seams (gateway/store/spawner/clock) are constructor-injected exactly as C3 specified; bind default, concurrency/agent caps, and the fail-fast validator's ownership model all match spec.

Exit-gate criterion 3: architecture consistency is consolidated above; **the inconsistency is real and is reflected in the conclusion below** — this does not require a Gate 2 redesign (the architecture text/decisions themselves are sound; #5's ARCH-009 seam and #4's D-G default are the only 2 that are "decision not honored" rather than "under-specified"), but does require a **Gate 6 implementation route-back**, prioritizing the 4 HIGH items (especially S-1, which contradicts a decision the user re-confirmed today, and V3, which corrupts resume determinism — REQ-006's own core promise).

### Validation & handover (Gate 7.5)
- Gate 7.5 (`gates.validation.passed`) = **true**, round 6, CONVERGENCE RULE satisfied: every v1 REQ acceptance clause has real, fresh `real:true` green VAL evidence, or is covered by a binding accepted-gap decision (D-V3 paid-provider credentials gap; D-F11 model-capability-tier tool-use gap). All 10 VAL-* items in `08-validation.md` are `tier: acceptance`, `real: true`.
- `trace.py --check` confirms **0 未真實驗證(mock-only)** and **0 v1-REQ 未驗證** gaps — the 6 "未驗證需求" the dashboard's overview card shows are exactly REQ-008/009/010/011/012/015, all v2/v3-out-of-scope, not mock-only v1 items.
- `08-validation.md` exists (870 lines), frontmatter `status: passed`, with 6 rounds of real-process evidence (real Ollama, real litellm[proxy] subprocess, real `@anthropic-ai/claude-agent-sdk` sessions, `ps aux`/`ss -tlnp`/`curl` repros).
- Handover docs present at `state.yaml layout.readme`/`layout.deploy`: `README.md` (210 lines) and `DEPLOY.md` (278 lines), both step-by-step (numbered quickstart/deploy steps, health-check section, rollback section, troubleshooting table, known-limitations section), both rewritten in round 6 with fresh evidence.
- **No REQ closed on mock-only evidence. No missing handover doc.** Exit-gate criterion 4 satisfied at the REQ-acceptance level.
- **Caveat**: the architecture-consistency review above (S-1 specifically) surfaced a real production defect (no default `timeoutMs` in the zero-config default-gateway deployment path) that Gate 7.5's own 6 rounds never exercised, because every round used an explicit config file. This is not a Gate 7.5 process failure (it tested every documented REQ acceptance clause thoroughly) — it is a gap in what was tested, now found by this Gate 8 review. It should be added to Gate 7.5's test matrix on the route-back.

## Retro
- **What went well this iteration**: exceptionally disciplined validation practice — 7 full/scoped real-process Gate 7.5 rounds, each independently re-confirming prior fixes with fresh repros rather than trusting narrative; every route-back closeout re-ran the full suite and `tsc --noEmit` from scratch; honest handling of the D-F11 model-capability-tier finding (didn't force a fake fix, recorded the real boundary); 0 orphan/broken-link/mock-only gaps across the entire 187-item ledger; docs (README/DEPLOY) kept in lockstep with every round's findings, not deferred to the end; the Gate 8 closing-fixes round itself was disciplined too — all 4 HIGH + 2 MEDIUM fixed with forcing tests written red-first (gap-tests-9), one genuine test defect (IT-028's `workflow_list` sub-case) found and reported rather than papered over, and a scoped Gate 7.5 round 7 re-validated the 3 most operationally-critical fixes (S-1/O-1/C-1) against a real, independent, unmocked process rather than trusting the unit/integration suite alone.
- **What to change next iteration**: (1) architecture-consistency review (this Gate 8 lens) should run at least once mid-implementation, not only at the very end — 4 HIGH findings (esp. S-1's default-timeout gap and V3's nested-journal collision) would have been cheaper to catch before 6 validation rounds' worth of code accreted around the gap; (2) the 3 independently-maintained alias tables (R-1) and the duplicated abort/timeout/retry logic across 3 gateway paths (adversarial advisory) suggest a "single source of truth" consolidation pass should be scheduled explicitly, not left implicit; (3) `tools/list` (C-1) should be test-driven from the start — an IT/E2E test asserting `inputSchema.properties` is non-empty per tool would have caught this at Gate 5, not Gate 8 (and, per IT-028's own test defect, the forcing test itself should special-case genuinely zero-parameter tools from the start rather than needing a round-7 re-confirmation of the same defect).
- **Known tech debt (recorded as known gaps)**:
  - v2/v3 scope (18 trace gaps: REQ-008..012/015, TASK-018..023) — explicitly deferred by the requirements Gate itself, not implementation debt.
  - v1.1 backlog already filed in `08-validation.md` (5 items): aborted-`AgentRecord` cosmetic state, litellm port-4000 collision hazard, tool-use re-test against a larger local model / paid provider, latent `cwd`-not-per-run-workspace gap, `mkdtemp()` temp-dir cleanup.
  - **v1.1 backlog from the Gate 8 architecture-consistency review** (7 MEDIUM/LOW items remaining after this closing round's 6 fixes — full detail + evidence in the "v1.1 backlog" section above): V1 (auth no-op seam), O-2 (transition audit trail), R-1 (duplicated `DEFAULT_ALIASES`), R-2 (gateway secret-custody divergence), R-3 (`workflow_artifacts` bypasses `RunStore`), C-2 (collapsed sandbox IPC error codes), S-2 (no litellm-proxy liveness supervision); V4 and C-3 (LOW) accepted as-is for v1, doc-wording-only.
  - Known test defect (not product debt, recorded for future test-suite hygiene): `IT-028`'s "every tool has non-empty `inputSchema.properties`" sub-assertion should exempt genuinely zero-parameter tools (`workflow_list`) rather than being re-flagged every round.
- **Gate 8 closure (this pass)**: all 6 D-G8-1..6 binding fixes independently re-verified against the current source tree, their tests, and Gate 7.5 round-7's real-process evidence — see "GATE 8 CLOSING RE-REVIEW" callout above. 0 remaining unfixed HIGH architecture-consistency findings. `gates.review.passed` set to `true`; iteration closes.

## Report (as-found, original Gate 8 pass — SUPERSEDED, see below)
```
Gaps: high=0 mid=12 low=6 (all remaining recorded as known v2/v3-out-of-scope tech debt above)
Drift: none
Architecture consistent: no — 15 violations (4 HIGH: V3 nested-journal callSeq collision / O-1 transcript black-box / C-1 tools/list placeholder schemas / S-1 no default timeoutMs on default gateway path contradicting user-reconfirmed D-G; 9 MEDIUM; 2 LOW) — see full list above
Validation: real-tier all-green? yes (Gate 7.5 round 6, CONVERGENCE RULE satisfied, 0 mock-only/未驗證 among v1 REQs) · README+DEPLOY present? yes, step-by-step
Conclusion: send back to Gate 6 (implementation route-back) for the 4 HIGH architecture-consistency findings — prioritize S-1 (contradicts today's user-reconfirmed D-G decision, real hang risk in the documented zero-config default deployment) and V3 (breaks REQ-006 resume determinism for nested workflows); re-run the affected Gate 7.5 acceptance clauses (REQ-004's bounded-timeout clause under zero-config; REQ-006's resume-determinism clause under nesting) after the fix. The 9 MEDIUM + 2 LOW findings and the pre-existing v2/v3 trace gaps may be carried as known tech debt if the team elects not to fix them this cycle, but must stay recorded (as they are here) rather than silently dropped.
```

## Report (Gate 8 CLOSING RE-REVIEW, 2026-07-03 22:05 — CURRENT / AUTHORITATIVE)
```
Gaps: high=0 mid=12 low=6 (all remaining recorded as known v2/v3-out-of-scope tech debt above; identical baseline, 0 new gaps from IMPL-051)
Drift: none (04-design.md D-G8-* route-back notes match IMPL-051 in the same round; README.md/DEPLOY.md rewritten in the same round as the Gate 7.5 round-7 real-process evidence)
Architecture consistent: yes for all previously-HIGH findings — 0 remaining unfixed HIGH (V3/O-1/C-1/S-1 all fixed + re-verified this round, evidence table above). 7 MEDIUM/LOW findings (V1, O-2, R-1, R-2, R-3, C-2, S-2) plus 2 LOW (V4, C-3) remain, formally recorded as v1.1 backlog per binding user decision, not fixed this round.
Validation: real-tier all-green? yes (Gate 7.5 round 6 CONVERGENCE RULE + round 7 scoped real-process re-confirmation of the 3 most operationally-critical D-G8 fixes) · README+DEPLOY present? yes, step-by-step, updated in round 7
Conclusion: iteration can close. All 4 HIGH + 2 MEDIUM binding Gate-8 fixes (D-G8-1..6) confirmed resolved at the code/test tier and re-confirmed via Gate 7.5 round-7 real-process evidence for the 3 highest-risk ones (S-1 zero-config hang, O-1 transcript black-box, C-1 tools/list placeholders). 7 remaining MEDIUM/LOW architecture-consistency findings correctly recorded as v1.1 backlog, not silently dropped. gates.review.passed=true.
```

---

## GATE 8 — v21 CLOSED BY OWNER DECISION (2026-09-01)

**Decision, and who made it.** After Gate 8 re-review #6, the owner was shown every open finding with
what each actually allows, who can trigger it, and the cost to fix, and chose: **land P6-1 and its five
riders, do not run a seventh review pass, close v21, and carry the remainder as named debt into v22.**
This closure is that decision, not a reviewer's `arch_consistent=true`. Recording it as an owner call
rather than a passing gate is the honest form.

**State at close** (commit `2c08719`): suite **1582/1582**, `tsc` clean, coverage **95.31%**, trace
**824 items / 14 gaps — 0 severe, 0 unverified REQs, 0 mock-only**, rtm **95/95 real:true**. Gate 7.5
ROUND 5 booted from the docs alone and confirmed every REQ live, including the P6-1 variants and P6-2's
enforcement point.

### What v21 delivered
REQ-090..095: a declared parameter contract an author writes and the engine enforces; per-run overrides
validated against it with `PARAM_LOCKED` / `PARAM_OUT_OF_RANGE` refused before any durable work; the
repair of two pre-existing defects that made REQ-088's promise hollow (`resolveHarnessParams` had zero
callers; `effort` was a documented no-op); `appendPrompt` fixed after the author-controlled segment; and
problem reports bound to a workflow and version.

### Debt carried into v22 — named, not assumed

| item | what it is | why it was left |
|---|---|---|
| **P6-2 (partial)** | An author-declared `defaults.appendPrompt` carrying a forged frame delimiter is **not** refused at registration. It **is** refused at dispatch admission (verified live, ROUND 5), so no forged frame reaches a model. | Author-scoped, and the enforcing rung holds. Closing the registration door is a v22 one-liner. |
| **S-1** | A `WorkflowCatalog` built with no `ceilings` enforces no registration ceiling. Production always passes the shared object. | Its recorded rationale is now **stale**: it cited "would need a third copy of `DEFAULT_CEILINGS`", and P6-5's shared export dissolved that. Cheap in v22. |
| **`deploy.sh` re-run trap** | `rwe.config.json` stores the template's raw `workRoot`; `deploy.sh` exports a writable default only for the invocation that creates the config. Stopping the service and re-running in a fresh shell hits `EACCES`. | Pre-existing; the fresh-checkout quickstart is always a first invocation, and touching that file would have invalidated the boot-from-docs evidence. |
| **DEPLOY.md rows** | `maxAppendPromptBytes` / `maxEffort` name only the `overrides.*` rung. Incomplete since G-1, but they assert no falsehood. | Doc completeness, not a false claim. |
| **`state.yaml` line 73** | Not strict-YAML-parseable (an unescaped quote in a v20-era note). `trace.py` does not strict-parse, which is why 21 iterations never noticed. | Pre-existing; anything that `yaml.safe_load`s this file will choke. |
| **14 trace gaps** | 1 MID (IMPL-082, TDD label), 1 LOW (TASK-018 unimplemented), 12 LOW iter-drift — including 3 minted by IMPL-145/146 tracing v15 designs honestly. | All disclosed. The alternatives to holding the count down were dropping real relationships or falsifying an `iter:` origin. |
| **81-function coverage debt** | Pre-existing functions below the per-function bar, first measured this iteration. Whole-tree coverage is 95.31%. | Recorded with a Decision-rationale at first measurement; never re-litigated per pass. |
| **Three unwired modules** | `session-options-builder`, `cli-lifecycle`, `timeout-race` still have zero importers in `src/`. | Not a v21 concern; belongs to the security-hardening iteration. |
| **`trace --rtm`** | The role contract calls a flag this project's `trace.py` does not have — a plugin/project version mismatch. `rtm.md` is generated via the module functions instead. | Reconcile upstream in the plugin, not by teaching the local tool a flag it never had. |

### The lesson worth carrying forward
Six review passes found, in order: a dead alias parameter; a secret-marker dereference; an `effort`
parameter sent at the wrong level of the request body while the descriptor claimed success; a poisoned
registration that could brick workflow discovery; a quadratic truncation that could block the event loop
for an hour; a forgeable trust frame; and that frame's fix missing four of six variants.

**Four of those survived earlier test tiers for the same reason: the test's oracle was the code under
test.** "Low and max produce different bytes" passes when both are wrong. "The wrapping is applied" passes
when the wrapping is forgeable. `not.toContain(wholeString)` passes when a fragment leaks. A comment
asserting a guarantee is not a control. **Where a clause names an external contract or a security
property, assert against that property — never derive the expectation from the implementation.**
