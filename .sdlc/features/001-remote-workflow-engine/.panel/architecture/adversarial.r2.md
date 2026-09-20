# Architecture panel — Adversarial (security / scalability / testability), round 2

**Iteration:** v34, **re-opened architecture stage** after the Gate 8 send-back
(`07-review.md` tail: `send_back: ["architecture","impl","tests","validation"]`).
**Tie-breaker:** Karpathy simplicity-first, as in round 1.

**This file supersedes the pre-send-back round 2** written at 16:11 on 2026-09-20 (committed at
`21ad773`; recoverable with
`git show 21ad773:.sdlc/features/001-remote-workflow-engine/.panel/architecture/adversarial.r2.md`).
A byte copy of all four panel files was taken to the session scratchpad before this write. No
`git checkout`/`restore`/`stash` was used on any ledger path (CLAUDE.md).

**What I read before writing, with provenance (this matters this round):**

| file | mtime | what it is |
|---|---|---|
| `.panel/architecture/adversarial.r1.md` | 23:33 today, uncommitted | **my own post-send-back r1** — the round this file answers |
| `.panel/architecture/quality-dimensions.r1.md` | 15:57 today, committed `21ad773` | QD's **pre**-send-back r1. No post-send-back QD r1 exists on disk; re-checked immediately before this write |
| `.panel/architecture/quality-dimensions.r2.md` | 16:12 today, committed | QD's pre-send-back r2 (the convergence round that Gate 8 then reviewed) |
| `.panel/review/quality-dimensions.md` | 23:00 today, untracked | **QD's freshest position** — the Gate 8 review-stage panel that produced blocking finding #1 |
| `07-review.md` tail (uncommitted) | — | the four send-back items |

Because the sibling's newest thinking lives in the *review* panel rather than in an
`architecture/*.r1.md`, I answer that file as this round's sibling proposal and also close out the
pre-send-back r2 items that Gate 8 has since settled, so round 3 does not re-litigate them.

**Net movement:** I **concede QD review finding #1 in substance** (the test is genuinely missing and
the coverage hole behind it is worse than QD found), while **rebutting its specification** — the
test as ADR-064 words it cannot be written, because the surface it names resolves nothing. §1 is
the load-bearing section and is the only new architecture work this round. Everything else is
**hold** (pointing at r1, not re-arguing) or **closed**.

---

## 0. Disposition table

| # | item, and whose | my call | one-line reason |
|---|---|---|---|
| 1 | **QD review #1 (MED, undisclosed):** the `workflow_describe`-side assertion ADR-064 / Gate-5 constraint 9 required "beside" the resume test was never written | **concede the gap, rebut the spec, re-spec it** | describe **resolves no tool layers at all** — a "layer count read through describe" has no referent; the writable, non-vacuous version is §1.3, and `toolSurface` turns out to have **zero** test references anywhere in `tests/` |
| 2 | **QD review #2 (LOW):** `toErr()` drops `.detail`, so `ARCH-138`'s field-level parity claim is prose-only at dispatch | **hold — already routed** | disclosed at TASK-229 DoD (4) / IMPL-340, routed to v35. My r1 D4 said I would object to it being re-counted as a finding of this round; QD itself marks it "disclosed and tracked", so there is nothing between us |
| 3 | **AC-2** (INV-V34-1 / ARCH-137 call `defaultAllowedTools` a floor) | **hold r1 §2.2 verbatim** | QD's review independently found no other consumer of the sentence; the fix stays two prose replacements, no code |
| 4 | **AC-1** (guide advertises two layers, `BUILT_IN_CORE_TOOLS` is a third) | **hold r1 §3 — text, not code** | QD review §3 confirms `authoring-guide.ts:530-536` currently says "exactly two layers"; the clause in r1 §3 keeps the count true by one word (**settable**) |
| 5 | QD r2 §3 "dispatch-time silent degradation for old pinned versions" (their strongest carried item) | **close — implemented** | `agent-executor.ts:537-547` now refuses `Object.hasOwn(req.opts,'agentType')` with `PARAM_UNKNOWN` + `detail.violation:'AGENT_OPT_RETIRED'`, **and captures to `_sink` before throwing** so a `parallel()`-swallowed refusal is still visible. That is QD's option (a), verbatim |
| 6 | QD r2 remaining #1: amend REQ-203 so a pre-v34 row still renders a marker in the dashboard | **rebut on process (unchanged from r1 D3)** | Gate 8 accepted INV-V34-3 with "dashboard line simply absent" and the `HARNESS_LEGACY_PRE_V34` fixture proving no crash. A send-back round is not a second bite at an accepted row; if QD still wants it, it is a v35 REQ |
| 7 | QD r2 remaining #2: the `defaults.tools` remedy choice | **close — decided** | ADR-064 owner ruling (A): `RunParams.tools` retired with `.prompt`; `run-manager.ts:1040` refuses a stored snapshot carrying either. My own stale r2 headline ("one HIGH unresolved") is therefore dead and should not be carried forward |
| 8 | QD r2 remaining #3: fail-closed at dispatch **vs** catalog scan at startup | **close — (a) shipped, (b) correctly not built** | dispatch refusal exists (row 5). A startup scan would re-read every stored script on every boot to find a population measured at 0; Karpathy: the cheap check at the exact moment of failure already runs |
| 9 | QD r2 §5 synthesis: `detail.retired` / machine-parseable marker instead of a new top-level code | **concede, already shipped in the equivalent shape** | the dispatch throw carries `{ param, agent, violation:'AGENT_OPT_RETIRED' }` and registration carries `violation: v.code` (`workflow-catalog.ts:490`) — one branch, both halves, no new code minted. Caveat: at dispatch the *field* is currently lost by `toErr()` (row 2, v35) |
| 10 | QD r1 Observability asks (typed retirement code, named config-key warning) | **close — shipped** | `main.ts:100-104` `RETIRED_CONFIG_KEYS` names the key and boots (`compose-config-v2-wiring.test.ts:247-265`) |
| 11 | My r1's own §2.3 record ("no operator ceiling exists on an author's tool surface") | **hold, with the trigger** | unopposed by QD in any round. Record the revisit trigger, build nothing (§4.1) |

---

## 1. The one piece of new architecture work: QD finding #1 is real, and its spec is unwritable

### 1.1 Concede the gap

ADR-064's note and `02-architecture.md`'s Gate-5 constraint 9 required **two** tests. One landed
(`tests/integration/resume-legacy-params.test.ts:97-119`, IT-177 — a legacy `tools` key refused on
resume). The other did not, and nothing in `05-tests.md` / `06-impl-log.md` / `journal.md`
dispositions the omission. QD is right on both halves (missing **and** undisclosed), and an
architecture row that demands a test which is then silently not written is exactly the
"ship a sentence the code does not support" defect this iteration exists to delete — applied to our
own ledger this time. I do not soften that.

### 1.2 Rebut the spec: `workflow_describe` resolves no tool layers, so there is no layer count to read

Constraint 9 asks for an assertion that "the advertised layer count is checked against a legacy
row's **actual resolved layers**" via `workflow_describe` / `projectWorkflowDescribe`. Verified in
the tree at `48f90b4`:

- `projectWorkflowDescribe` (`src/workflow-view.ts:175-211`) reads exactly `full.params.agents` and
  `full.params.args`, and `projectAgentParams` (`:147-169`, the key loop at `:155`) projects exactly four keys —
  `model`, `effort`, `timeoutMs`, `appendPrompt`. **`tools` is not among them and never was.**
- The only tool fact on the whole describe response is `toolSurface`, minted one layer up in the
  facade (`src/mcp-facade.ts:493-498`) from `scanAgentCalls(full.script)` — the literal per-call
  `allowedTools` array, or the string `'default'` when the call declares none. Its own boundary
  comment (`:492`) says it: *"Names only — never a resolved list, never prompt text."*

So the describe surface performs **no** resolution: it cannot show two layers, three layers, or any
layers. A test shaped literally like constraint 9's sentence would have to either (i) assert against
a field that does not exist, or (ii) degrade into asserting that the guide *string* says "two" —
which is `tests/unit/authoring-guide.test.ts:357` again: a green assertion pinning prose, the exact
anti-pattern my r1 §6.2 refused to reproduce. **Architecture wrote a test spec it cannot cash, and
architecture — not the tests stage — owes the correction.**

### 1.3 Re-spec: what the read boundary *can* prove, and why it is the same guarantee

The guarantee ADR-064 actually wanted is *"no row anywhere can exhibit a third tool layer."* That is
provable, and it is a **population** argument plus one **structural** assertion, not a count:

1. **Any stored `defaults.tools` implies a pre-v24 row.** `meta.defaults` has been refused at
   registration since ADR-035 — `params/contract.ts:385` (`retiredDefaults('meta.defaults')`),
   `workflow-meta.ts:83` (the same check, on the one path the whole registration funnels through),
   and the workflow-wide `defaults` *argument* is refused at the facade (`mcp-facade.ts:321`,
   `DEFAULTS_RETIRED`). There is no v24+ path that writes one.
2. **Every pre-v24 row already reads as un-runnable.** `isLegacyParamsShape`
   (`workflow-view.ts:138-143`) is true for the flat `{knobs}` contract and for a missing contract;
   `:183` maps it to `runnableReason:'LEGACY_REREGISTER'`, and `run-manager.ts:547-554` refuses
   `run_start` with the same code, so the read surface and the run path agree by construction.
3. **The run-snapshot half is closed separately** by ruling (A): `RunParams.tools` is gone
   (`params/resolve.ts:49-52`) and a stored snapshot carrying `tools`/`prompt` is refused on resume
   (`run-manager.ts:1040`, IT-177).

⇒ **The population that could exhibit three layers is exactly the population that can never
execute.** The advertised sentence is true for every runnable row, and vacuous — not false — for the
rest. That is a stronger statement than a layer count, and it is testable at the read boundary in
one case.

**Seeding, checked before claiming the test is writable — and it sharpens §1.3 further.** The row
cannot be produced through any public path (that is the point of bullet 1), so it is planted the way
this repo already plants legacy rows: a direct `better-sqlite3` write into `catalog.db`, exactly the
mechanism `tests/integration/resume-legacy-params.test.ts` uses at `:172-173`
(`UPDATE workflow_versions SET script = ?`) and `:58` (`UPDATE runs SET effective_params = ?`). One
extra column in the same statement (`defaults = ?`) is the whole fixture. **And the stronger fact
that turned up while checking it:** `resolveDetail` deliberately does **not** select that column —
`workflow-catalog.ts:721-728` selects `script, mermaid, params, triggers, diagram_contract` and its
own comment records why ("`defaults` is NOT selected … reading a retired column kept a dead value
flowing through the whole admission path"). So a stored `defaults.tools` is not merely refused, it
is **unreadable by construction**, and the assertion below is the regression guard for exactly that
deliberate non-read — the failure mode it catches is someone re-adding `defaults` to that SELECT.

**Exact spec of the missing test (one `it`). Home: `tests/unit/workflow-describe-facade.test.ts`
(UT-114), which already stands up a real on-disk `WorkflowCatalog` + real `RunManager` + real
`McpFacade` in a tmpdir — so the raw-SQL plant and the facade call are three lines apart. IT-130
(`advertised-surface-truth.test.ts`) has the nicer charter but boots real HTTP via `createServer()`,
which buys nothing here and costs a boot-order dance around the same SQLite file; if the tests stage
prefers IT-130 for charter reasons, the assertions are unchanged.**

> Register (or seed) a legacy-shaped row whose stored registration carries
> `defaults: { tools: ['WebFetch'] }` — `WebFetch` chosen because it is **not** in
> `BUILT_IN_CORE_TOOLS` and not requested by any of the 27 live catalog versions, so it can only
> appear in the response if a deployment/legacy rung leaked into it — and whose script declares
> `allowedTools` on one label and omits it on another. Then assert, in one case:
> 1. `result.runnable === false` and `result.runnableReason === 'LEGACY_REREGISTER'` — the row
>    cannot run, so no layer resolution will ever happen for it (behaviour half);
> 2. `result.toolSurface` deep-equals `{ a: ['Read'], b: 'default' }` — script-derived names for the
>    declaring label, the **sentinel** for the bare one;
> 3. **(the leak assertion, named honestly — it reads no advertisement)** `JSON.stringify(result)`
>    does not contain `'WebFetch'`: no deployment-side or legacy-side tool value reaches the read
>    surface. This is what makes the case a *guard* rather than a restatement — it fails the day
>    `resolveDetail`'s SELECT or the facade's projection starts resolving a tool value.
>
> I deliberately do **not** add a fourth assertion reading the advertisement text out of
> `TOOL_SPECS` or the guide. That would be a prose match, and §4.2 is where I refuse those — the
> sentinel sentence (§3) is checked by assertion 2 *behaving* like the description says, not by
> grepping the description.

Cost: one case, one extra column in an `UPDATE` this repo already writes, no new fixture, no new seam. It registers under DES-228 in
`05-tests.md` as the second half of ADR-064's pair.

### 1.4 The fact that makes this worth doing rather than merely owed

`grep -rn toolSurface tests/` → **zero hits.** The field `workflow_describe` serves for tool
facts — added at v26 for REQ-128, consumed by the dashboard's tools column — has **no test
anywhere**, unit or integration. So QD's finding #1 is not a bookkeeping debt: it is the only
proposed assertion in this entire send-back that closes a live, zero-coverage surface. This
materially changes my Karpathy arithmetic from r1 §6.2 (where I capped testability at one test):
the third test is not prose-pinning, it is first coverage of a served field, and it is **QD's
send-back item owned by the tests stage**, not an architecture-originated ask. I am not growing my
own count; I am making someone else's item writable.

### 1.5 Ledger correction this implies (architecture's own row, same class as AC-2)

`ADR-064`'s note and Gate-5 constraint 9 must be reworded from *"assert the resolved layer count
through `workflow_describe`"* to §1.3's shape: *"assert, at the read boundary, that a legacy-shaped
row reads `runnable:false / LEGACY_REREGISTER` and that its `toolSurface` carries only
script-derived names or the `'default'` sentinel — no deployment- or legacy-resolved tool value
appears on the response."* Prose inside rows already carrying `iter: v34`; no new ARCH row, no new
ADR, **no trace delta** (same precedent as AC-2, and as v33's F6-1 lesson about minting deltas for
text).

---

## 2. AC-2 and AC-1 — hold, do not re-argue

**AC-2:** r1 §2.2 carries the exact replacement text for `02-architecture.md:4190` (INV-V34-1) and
`:4079` (ARCH-137 note). Nothing in QD's review or either QD round disputes the substance — QD r2 §2
explicitly retracted its own competing claim after reading `types.ts:506` and agreed the post-hoc
prong is satisfied by `HarnessDescriptor.tools`. **Converged; ship the wording.**

**AC-1:** r1 §3 rules text over code, with the drop-in clause and the reason Remedy B is worse
(deleting the client's own `?? BUILT_IN_CORE_TOOLS` re-arms VAL-003 for every construction that does
not come through `main.ts`; keeping both duplicates the constant across a module boundary, into the
very `composeConfig` forwarding class this repo already has a dedicated regression test for).
QD's review §3 independently read `authoring-guide.ts:530-536` and confirmed the sentence as it
stands. **Converged; ship the clause and regenerate `docs/AUTHORING.md` in the same commit
(byte-lock).**

---

## 3. One position I upgrade because of §1: define the `'default'` sentinel where it is served

In the pre-send-back round I offered this as a landing zone I *would accept* (r1 D1). §1.3 promotes
it to something I now **ask for**, because assertion 2 of the new test pins `'default'` as a served
value while the value still has **no definition anywhere on the caller's surface**: a cold client
reading `toolSurface: { b: 'default' }` cannot learn what "default" resolves to.

One sentence in `tool-specs.ts`'s `workflow_describe` description: *"`toolSurface` gives each
label's declared `allowedTools`, or the string `'default'` when the call declares none — meaning
this deployment's configured `defaultAllowedTools`, else the engine's built-in core set."* Same fact
AC-1's guide clause states, on the surface that serves the sentinel.

I **still refuse** to resolve the sentinel into an actual list on the projection: `mcp-facade.ts:492`
declares that boundary ("Names only — never a resolved list"), resolving it would make a
script-derived projection config-dependent, and `allowedTools` is in `LOCKED_KEYS`
(`params/contract.ts:25`) so no caller can act on the value anyway. **Define the word; do not
resolve the value.** Defining costs one sentence and makes the new test's sentinel assertion
meaningful; resolving costs a config-dependent field on a projection that promises not to be one.

---

## 4. Where my three lenses conflict this round

### 4.1 Security vs Karpathy — unchanged, Karpathy still wins, and the trigger is the concession

`defaultAllowedTools` is a default, not a ceiling; there is no operator-side cap on an author's tool
surface anywhere in `src/` (`disallowedTools`: zero hits). Security's honest position is that this is
a missing knob. It stays missing this round: zero escalating scripts (0 of 166 registered `agent()`
calls request anything outside `BUILT_IN_CORE_TOOLS`), zero operator requests in requirements, and
every call is arbitrated by `canUseTool` + the `PreToolUse` realpath jail regardless of the list.
**Record the gap with a measurable revisit trigger** (any registered version requesting a tool
outside the deployment default; today 0 of 27 versions), build nothing. If the trigger fires,
security wins the rematch and the refusal belongs at *registration* — the seam already exists
(`TOOLS_MISMATCH`, `errors.ts:63`, already reasons about tool names at registration time) — never as
a silent dispatch trim, which is the defect class v34 was opened to delete.

### 4.2 Testability vs Karpathy — I move, and I say why

r1 capped this at one test (the override-semantics UT in r1 §4.1). This round the honest count is
**three**, and I state the ownership so the number is not mistaken for scope creep:
(1) r1 §4.1's `it` — architecture's own guard for the corrected AC-2 sentence — **mine**;
(2) strengthening UT-276 so the AC-1 clause has a red-before-green — **mine, and it is the same
edit as AC-1, not an extra ask**;
(3) §1.3's case — **QD's send-back item**, owned by the tests stage; architecture's contribution is
only making it writable.
The Karpathy line I still hold: no *fourth* test that matches guide prose against a code constant.
`authoring-guide.test.ts:357` is that test, it is green today, and it is guarding a sentence AC-1
says is incomplete — which is the whole argument against the genre.

### 4.3 Security vs Testability — one mild trade, resolved in security's favour this time

Security wants §1.3's assertion 3 (`WebFetch` must appear nowhere) because it is the only assertion
in the set that would catch a *leak* rather than a *shape* — a future refactor that starts resolving
deployment tool values into the read surface fails exactly there. Testability objects that a
`JSON.stringify().not.toContain()` assertion is blunt and fails with an unhelpful message.
Resolution: keep it, with the sentinel value chosen so the failure is self-explaining (`WebFetch`
appears in no live script and in no built-in set, so a hit means precisely "a non-script tool value
reached the read surface"), and pair it with assertion 2's deep-equal, which gives the precise diff
when the shape rather than the leak is what broke.

### 4.4 Scalability / performance — abstains again, stated not invented

Every item in this send-back is prose, one guide string, and three test cases. No state storage, no
shared counter, no new per-dispatch work, no schema change. `toolSurface` already runs
`scanAgentCalls` on every `workflow_describe` — the new test adds no call site. Horizontal scaling,
consistency of failure counting, contention: **not applicable**, and I decline to manufacture a
paragraph for lens symmetry.

---

## 5. Remaining disagreements (two, both small, neither blocks Gate 3)

1. **QD r2 remaining #1 — the legacy-row dashboard marker.** QD wants a pre-v34 row to render a
   minimal "fields retired at v34" marker rather than a bare absence; REQ-203's accepted text says
   the disclosure surface goes away, full stop, and Gate 8 accepted INV-V34-3 on exactly that
   reading with the `HARNESS_LEGACY_PRE_V34` fixture proving totality. **I rebut on process, not on
   taste** — QD's reasoning (a silent absence reads as "this run had no system prompt", a false
   historical statement) is a fair point and I would not oppose it as a v35 REQ. I oppose amending an
   accepted requirement inside a send-back round convened for four named text fixes.
2. **Whether §1.3's re-spec is accepted as the discharge of constraint 9.** If the tests stage
   insists on the literal wording ("assert the resolved layer count through describe"), it will
   write either a vacuous case or a prose-matching one. Architecture's position is that the literal
   spec has no referent (§1.2, `workflow-view.ts:147-169` + `mcp-facade.ts:492-498`) and the
   constraint text must be corrected with the test, not around it. If a reviewer disagrees, the
   disagreement is about **the constraint's wording**, which is an architecture row — so it comes
   back here, not to tests.

Everything else across all four panel documents I consider **converged or closed**: INV-NOADD and
its restrictive/readable split, the `RETIRED_CONFIG_KEYS` / retirement-message mechanism, the
dispatch-time fail-closed refusal (QD's carried item, shipped), the `defaults.tools` remedy (ruling
A), the `detail.violation` marker shape, `composePrompt` as a named seam, the predicted-trace-delta
discipline, and the legacy-row TOTAL read path.

---

## 6. Handoff list (what this round asks Gate 3+ to carry — five ledger/code edits, four of them one sentence, plus three test cases and a debt line)

1. `02-architecture.md:4190` (INV-V34-1) — replace the residual sentence with r1 §2.2's text. *(AC-2)*
2. `02-architecture.md:4079` (ARCH-137 note) — replace the tradeoff clause with r1 §2.2's text, and
   add the §4.1 revisit trigger in one sentence (*no operator ceiling exists; trigger = any
   registered version requesting a tool outside the deployment default; today 0 of 27*). *(AC-2)*
3. `02-architecture.md` — **new this round:** correct ADR-064's note and Gate-5 constraint 9 to
   §1.5's wording, so the required second test names something the surface can prove. Prose inside
   `iter: v34` rows; no trace delta.
4. `src/authoring-guide.ts:530-536` — r1 §3's clause ("Two layers are **settable** … built-in core
   set: `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`"); regenerate `docs/AUTHORING.md` in the same
   commit (byte-lock). *(AC-1)*
5. `src/tool-specs.ts` (`workflow_describe` description) — **new this round:** §3's one-sentence
   definition of the `'default'` sentinel.
6. Tests: (a) strengthen `tests/unit/authoring-guide.test.ts:357` (UT-276) to assert the section
   names the built-in core set — red until item 4 lands; (b) add r1 §4.1's single `it` to
   `tests/unit/claude-agent-sdk-gateway-allowed-tools.test.ts`; (c) add §1.3's case to
   `tests/unit/workflow-describe-facade.test.ts` (UT-114 — real catalog + real facade already
   stood up there; the legacy row is planted with the raw-SQL `UPDATE` precedent from
   `resume-legacy-params.test.ts:172-173`) and register it under DES-228 in `05-tests.md`
   *(QD finding #1 — the tests stage owns it; architecture only makes it writable)*.
7. Debt, not this round: the stale `(agentType-derived curation)` test title
   (`claude-agent-sdk-gateway-allowed-tools.test.ts:57`); `DEPLOY.md:632`'s "只有兩層" counting word
   (fold into the validation-side rewrite already sent back — same one-word remedy as item 4);
   `toErr()`'s `.detail` loss (already routed to v35, do not re-count).

No new ARCH row, no new ADR, no new config key, no new module, no new projection field.
