---
stage: design
lens: quality-dimensions
iteration: v27 — Gate 8 SEND-BACK REPAIR, the DESIGN half (v27j)
round: 2 (responses to the adversarial lens's r1 + final position)
responds_to: `.panel/design/adversarial.r1.md` (this round's, dated 2026-09-13 — NOT the v27c CSS-ownership r1 it replaced on disk)
supersedes_on_disk: the file previously at this path was the **v27b delta round's** r2 (`git show c7447d0:.sdlc/features/001-remote-workflow-engine/.panel/design/quality-dimensions.r2.md`); same for `adversarial.r2.md`. Read history with `git show`, never `checkout` / `restore` / `stash` (CLAUDE.md).
builds_on: my r1 at `quality-dimensions.r1.md` (HEAD `586dafd`). Everything it settled that this round does not name stands unchanged; this file records only what moved after reading the adversarial r1 and what round 2 measured.
verified_this_round (HEAD `586dafd` unchanged; `src/`+`tests/` byte-identical to `eb387a1`): `05-tests.md:12062` (UT-240 = `static-assets.test.ts`) and `:12075` (UT-241 = the `dashboard-page-source.test.ts` v27 extension); `04-design.md:6856` (DES-208's STAYS bucket names `draggable="false"`, and its `[v27c]` sentence 「`draggable="false"` is markup and stays」), `:3399-3417` (DES-111's signature block: `register(name, script, defaults?, principal?) … // signature unchanged`, `deregister(...): Promise<{ removed: boolean }>`), `:3329` (the `Scheduler` one-liner — the adversarial's `:3328` is off by one), `:4908` (a second one-line class body in a later block); `src/workflow-catalog.ts:649-656` (the positional-form throw naming ADR-035 / DES-148) and `:664` (`deregister` → `{removed, claimedTriggers}`); `grep -rn WorkflowRow src/` → 0; `tests/unit/dashboard-page-source.test.ts:43` (UT-224 re-pointed), `:51` (the `UT-240` mislabel), `:95` (UT-241's live `draggable` pin over `DASHBOARD_HTML`); `03-tasks.md:124-128` (TASK-018: **no** `des:`), `:1214-1221` (TASK-153: `des: DES-138, DES-142`), `:1620` (header `TASK-196..213`), `:1626-1645` (the preamble's ordering rules — no `des:` rule); `.sdlc/trace.py:108-109` (only `traces:`/`trace:` becomes an edge — `des:` is never read), `:256-258` (TASK 未實作 = no IMPL reaches it); `02-architecture.md:3827` (「beside the `.sdlc/` tooling」) vs `:3841` (`scripts/mermaid-parse-check.mjs`); `06-impl-log.md:6338` (IMPL-270 cites `app.js:427`; the live body-level `replaceChildren` is `:455`); `src/diagram-render.ts:134-138, 154-179` (the engine's own `mmdc` wrapper); `node_modules/mermaid/dist/chunks/mermaid.esm/chunk-AHS5MEEA.mjs:7412-7444` (`parseGenericTypes` / `shouldCombineSets` / `processSet`), `chunk-AEUN2JU2.mjs:1125` (`methodRegEx`).
measured_this_round: **the adversarial lens's own pipeline** — `node_modules/.bin/mmdc` 11.17.0 over mermaid 11.17.2, the cached Chrome, `-p` carrying the engine's puppeteer args — so the two r1s finally share a basis. Rendered: the control, my entity form, their option C, the `Scheduler` one-liner, and ten root-cause probes; each candidate also re-rendered under `trace.py:687`'s exact `{theme:'dark', securityLevel:'loose'}`. SVG text extracted and counted (verbatim `~` / raw `#nn;` / literal `%%`). `mmdc` without `-p` was run twice (with and without stdin from `/dev/null`).
---
# Quality-dimensions — v27j DESIGN r2: converged on the repair, the coupling, the oracle and the two tasks; both round-1 root causes were wrong and are replaced by a measured one; the only live disagreement left is the spelling of three members — and it is not blocking either way

## summary

**Where the two r1s disagreed on facts, round 2 measured them through the adversarial lens's own `mmdc` pipeline, and the result corrects both of us.** Their reason for rejecting entities inside the generic — 「entity + comma together is what breaks」 — is refuted by a direct probe (`Promise~#123;a,b#125;~` renders `Promise<{a,b}>`); my r1 rule (b) — 「a `,` inside `~…~` disables the conversion」 — is over-broad (`Promise~A,B~` renders `Promise<A,B>`). The mechanism is in the vendored source: `parseGenericTypes` splits the return type on every literal `,` and re-joins **exactly one** pair whose halves each carry one `~`; a third part leaves the tildes verbatim. So the rule is *two or more literal commas inside one `~…~`*, and `#44;` — which they did not test — never enters the split. My form therefore renders `Promise<{version}>`, `Promise<{channel, version, from}>`, `Promise<{removed}>` through their pipeline, under both mmdc's default config and `trace.py`'s dark+loose, with 0 verbatim tildes, 0 raw entities, 0 `%%`. Their option C renders `Promise of {…}` under the same conditions with the same zeros. **Both are correct repairs; I hold on mine for fidelity (the render is the author's notation and the same angle-bracket form as the block's five other generics), and I state plainly that C is an acceptable fallback whose only cost — their own R-2, losing the generic notation — is the cost my form does not pay.**

**Conceded and integrated from the adversarial r1 (with reasons in §1):** the `Scheduler` collapsed row (one-line split, same edit); **DES-208** as the third row carrying the dead `draggable` clause (I missed it — the amendment now has two halves, MOVES for UT-224's pin already re-pointed at v27g and RETIRES for UT-241's `:95` duplicate under TASK-215); the coupling framing (Rider A's clause edit and TASK-215 are one repair — it is my QD-R7 stated better); no **new** DES rows for either task, and `des:` is optional (trace.py never reads it; TASK-018 has none) — so my DES-191 sentence drops from MUST to SHOULD and TASK-216 is no longer conditional on it; the stale positional `register` signature as a SHOULD-ranked DES-111 marker rather than a member rewrite — into which I fold two more stale facts they and I each half-saw (`deregister`'s `claimedTriggers`, and the phantom `WorkflowRow` the block already names, which was a hole in my own R-3 principle); the oracle's placement (`.sdlc/`), its rename (`mermaid-render-check`), and that it is never a Gate 6 blocker.

**Held with evidence:** UT-**241**, not UT-240, is the page-source extension (`05-tests.md:12062/12075`); every place the adversarial text says 「UT-240」 for the `:95` case must read UT-241, and TASK-215 fixes the `:51` comment in the same commit. Held on reasons: the six-row design/task sweep (each a contradiction the tree makes, none a caveat; the architect applied the identical rule to `02` at v27h) and the pre-boot literal (unaddressed by their r1; the `…` fallback stays recorded with its cost).

**Not reproduced, reported honestly:** `mmdc` without `-p` exits **1** on this box (browser launch failure, no SVG) under both stdin shapes — not 0. Their box may differ; the oracle spec is exit-code-independent either way (assert the SVG exists and every expected member string is in its text).

## Altitude call

Unchanged from r1 and in agreement with the adversarial §0: this round's artifacts are ledger rows, a server-emitted shell, and tooling — **system altitude throughout**. The agent altitude enters at exactly one hop (the ledger's consumers are agents) and is otherwise marked N/A per dimension rather than manufactured.

---

## 0. Round-2 measurement — the shared basis

### 0.1 Candidates, through `mmdc` (default config) and again under `trace.py`'s `{theme:'dark', securityLevel:'loose'}`

| Form | default config | dark + loose | SVG member text (identical under both) |
|---|---|---|---|
| Control (`Promise~{version}~` …) | **parse FAIL** line 3, `OPEN_IN_STRUCT` | same | — (the finding, reproduced byte-for-byte) |
| **QD entity-in-generic** `Promise~#123;version#125;~` · `Promise~#123;channel#44; version#44; from#125;~` · `Promise~#123;removed#125;~` + own-line `%%` key + `Scheduler` split | ok | ok | `Promise<{version}>` · `Promise<{channel, version, from}>` · `Promise<{removed}>`; all 8 members; `Scheduler` two rows; **0 `~` · 0 raw `#nn;` · 0 `%%`** |
| **ADV option C** `Promise of #123;version#125;` · `Promise of #123;channel, version, from#125;` · `Promise of #123;removed#125;` + `Scheduler` split | ok | ok | `Promise of {version}` · `Promise of {channel, version, from}` · `Promise of {removed}`; all 8 members; **0 · 0 · 0** |
| `class Scheduler { +markFired() +markFailed() }` (`:3329`, as-is) | ok | ok | **one** row `+markFired() +markFailed()` — the adversarial KP-3 finding, confirmed |

Both candidate forms leave every untouched member (`string[]`, `WorkflowRow[]`, the three `«pure fn»` stereotypes, all edges and labels) byte-identical in the SVG. **The config axis of the adversarial's R-1 is discharged**: neither `theme` nor `securityLevel` changes a single character of either candidate's render. The **version** axis (`trace.py:623` loads a floating `mermaid@11` from jsDelivr; egress is blackholed from this sandbox) stays open — §1 A-10.

### 0.2 Root-cause probes (mmdc default config)

| Member as written | Rendered | What it decides |
|---|---|---|
| `Promise~A,B~` | `Promise<A,B>` | one comma is fine — **my r1 rule (b) was over-broad** |
| `Promise~A,B,C~` | `Promise~A,B,C~` verbatim | two commas break it |
| `Promise~#123;a,b#125;~` | `Promise<{a,b}>` | **entity + one comma renders — refutes the adversarial's 「entity + comma together」** |
| `Promise~#123;a,b,c#125;~` | `Promise~{a,b,c}~` verbatim | their option-B failure, reproduced — it was the second comma, not the entity |
| `Promise~#123;a#44; b#44; c#125;~` | `Promise<{a, b, c}>` | `#44;` never enters the split — the form I proposed |
| `Result~A, B~` | `Result<A, B>` | space after the comma survives |
| `Promise~(version)~` | member renders as `+a() Promise~(version) : ~` | the `(` is re-parsed as the method's parameter list — my r1's 「parens break the member」, now with its mechanism |
| `Promise~#40;version#41;~` | `Promise<(version)>` | `#40;`/`#41;` is the escape |
| `Promise~Map~K,V~~` | `Promise<Map>K,V<>` | nested generics are not supported by mermaid — not this block's case, named so nobody tries it |

**Mechanism, cited not inferred:** `chunk-AHS5MEEA.mjs:7412-7444` — `parseGenericTypes` does `input.split(/(,)/)`, and at each `,` calls `shouldCombineSets(prev, next)`, which is true only when **both** neighbours contain exactly one `~`; a combined pair is pushed once, and `processSet` returns any set with ≤ 1 tilde **unchanged** (`:7441-7443`). With three parts the first `,` sees `Promise~#123;channel` (1 tilde) beside `version` (0 tildes), refuses to combine, and every part keeps its tildes. `chunk-AEUN2JU2.mjs:1125` — `methodRegEx = /([#+~-])?(.+)\((.*)\)([\s$*])?(.*)([$*])?/`: the greedy `(.+)\(` matches up to the **last** `(` on the line, so any parenthesis in the return type becomes the parameter list.

### 0.3 The corrected classDiagram authoring rules (replace r1 §0 rule (b) and the adversarial KP-1 discriminator; belong beside v27h's sequenceDiagram rule at `02-architecture.md:3782+`, Gate 2's to record)

*(a) Inside a class member, `{` opens a struct and `}` closes it — a literal brace is `#123;` / `#125;`. (b) Inside one `~…~` generic, **two or more literal commas** defeat the angle-bracket conversion and the tildes render verbatim (parse-clean); one comma is fine; a literal comma that must not split is `#44;`. (c) A `(` anywhere after the method's own parameter list is re-parsed as that list — a literal parenthesis is `#40;` / `#41;`. (d) A class body written on one line renders as one member row. The falsifier for all four is the same: parse, render, then read the member text out of the SVG.*

### 0.4 Three facts that change positions taken in the r1s

- **`.sdlc/trace.py` never reads `des:`** (`:108-109` — only `traces:`/`trace:` produce edges; no gap type mentions a design parent). TASK-018 (`03-tasks.md:124-128`) has no `des:`; TASK-153 (`:1214-1221`) has one. The v27 preamble (`:1626-1645`) mandates **ordering**, not `des:`. So `des:` is a human-facing field, optional at both the tool and the convention level → §1 A-6.
- **`mmdc` without `-p` exits 1 here** (`Failed to launch the browser process … No usable sandbox`), no SVG written, under both stdin shapes → §1 A-9.
- **The engine already wraps `mmdc`:** `src/diagram-render.ts:167` `renderWithMmdc()` writes the same puppeteer args the adversarial used (`:138`), a hard-coded `MERMAID_CONFIG = { htmlLabels:false, securityLevel:'strict' }` (`:134`), and returns a **typed** `RENDERER_MISSING` / `RENDER_FAILED` outcome — the loud-failure shape the oracle wants. Its config is the product's, not the trace dashboard's, and `MmdcOpts` exposes no override → §1 A-9 says what to take from it and what not to.

---

## 1. Responses to the adversarial lens — rebut / concede / hold

**A-1 · DASH-2's spelling — HOLD (entity-in-generic with `#44;`), with C recorded as an acceptable fallback.** Their KP-1 rejected 「escape inside the generic」 on the strength of option B (`Promise~#123;channel,version,from#125;~` → raw). §0.2 shows B failed on its **second comma**, not on the entity, and that `#44;` — untested in their table — renders `Promise<{channel, version, from}>` exactly. With that, the discriminator between the two surviving forms is fidelity: mine renders the author's own notation and the same `Promise<…>` shape as the block's five other generics; C renders prose for three members and generics for five, and their R-2 already concedes the loss. Both parse, both render under both configs, both invent nothing, both cost four lines. If the synthesis prefers C, I do not contest it — but the reason to pay R-2 is gone. Either way the falsifier is identical (§0.3) and the `%%` key line names whichever entities are used.

**A-2 · The root cause — CONCEDE-IN-PART on both sides.** Their 「entity + comma together」 is refuted by probe three; my 「a `,` or `(` inside `~…~` disables the conversion」 is over-broad on the comma and mechanism-free on the parenthesis. §0.3 is the joint replacement and cites the source. I would ask the synthesis to record the rule in that form and neither r1's.

**A-3 · `Scheduler`'s collapsed row (KP-3) — CONCEDE, integrated.** Confirmed at `:3329` (their `:3328` is one line off — the edit map below carries the right line). One-line split, same block, same edit, zero semantic content. Their 「not a licence to sweep the other 44 blocks」 — agreed; but the sweep for *this* class is one grep, and it finds a second instance at `04-design.md:4908` (`class Scheduler { +claim(id,wf) +release(id,wf) +ownerOf(id) +markRefused(f,reason) }`, a later slice). Named for the next touch of that block, the way `02-architecture.md:3845` names the eight `%%` literals; not taken here.

**A-4 · DES-208 as the third row (KP-4) — CONCEDE, integrated; the disposition has two halves.** I attributed the `draggable` clauses to DES-200 and TASK-205 only; `04-design.md:6856`'s STAYS bucket lists `draggable="false"` and its `[v27c]` sentence says 「is markup and stays」 outright. But 「STAYS → MOVES」 alone leaves `:95` undisposed, because two assertions carried the pin: UT-224's (**already MOVED** to `clientFile('ui/workflow.js')` at v27g, IMPL-270, `:43`) and UT-241's duplicate at `:95` (**RETIRES** under TASK-215, ARCH-122's v27h disposition). The DES-208 amendment must say both — one moved sentence and one retired sentence — or the row still authorises a green over dead bytes.

**A-5 · UT-240 vs UT-241 — HOLD; this is a fact, not a stance.** `05-tests.md:12062`: UT-240 is `static-assets.test.ts` (traces DES-199 / TASK-204). `:12075`: UT-241 is the `dashboard-page-source.test.ts` v27 extension. The adversarial r1 says 「UT-240's `draggable` case」 throughout, copied — as ARCH-122 `:3343` was — from the test file's own mislabel at `:51`. Every integration below reads UT-241; TASK-215's DoD fixes `:51` in its commit; ARCH-122's two 「UT-240」 are named for Gate 2's next touch. Both ids exist, so `sh .sdlc/trace` will never see this — which is why it has to be written down.

**A-6 · No DES rows for the two tasks; `des:` optional (KP-5) — CONCEDE, and it moves my R-1.** We already agreed no **new** DES row. The residual claim in my r1 — 「a TASK's `des:` must resolve」 — was true only *if present*: `trace.py` never reads the field (§0.4) and TASK-018 ships without one. Their precedent is half a precedent (TASK-153 **does** carry `des:`), but half is enough. So: TASK-216 may be minted with `traces: ADR-049, ARCH-124, REQ-131, REQ-134` and no `des:`, and is **no longer conditional** on the DES-191 sentence. The sentence itself I keep as **SHOULD** for a design-quality reason, not a chain reason: DES-191 is the guard tier, the server/client compile boundary is one more guard of that tier, and a guard with no design sentence is the shape a later 「simplification」 collapses first (R-1 in r1, unchanged). One sentence, additive, no new id.

**A-7 · The coupling and the ordering (KP-4 / R-3) — CONCEDE the framing; converge on one commit.** 「Rider A removes the authority, TASK-A removes the line; taking A alone is strictly worse than leaving both」 is my QD-R7 said better, and I adopt their words. On ordering we differed only in emphasis (they: mint the task first; I: amend the `des:` parents first). Both land in **one batch**; within one commit the order is moot. The one thing we both require — and I would ask the synthesis to make explicit — is the fallback if the orchestrator declines TASK-215: every amended clause carries a 「pending TASK-215」 sentence in ARCH-124's 「UNGUARDED until TASK-B lands」 shape, so no row silently disagrees with the tree. My r1's DES-200 clause 「until TASK-215 lands the fossil body stands and is not a test subject」 is that sentence; DES-208 and TASK-205 get its twin.

**A-8 · The stale positional signature (§3 conflict 1) — CONCEDE theirs is the larger finding; integrate mine into one marker.** I noted only `deregister`'s missing `claimedTriggers` (COULD). They found `register(name, script, defaults, principal)` is the form `workflow-catalog.ts:653` **throws on by name** (retired by ADR-035 / DES-148), and that DES-111 twelve lines below carries the identical stale pair — so the diagram is consistent with its slice and the pair is stale together. Their disposition is right: **one dated marker on DES-111**, SHOULD, member texts untouched, recorded even if deferred (their R-4). I add one fact they measured and I under-weighted: `grep -rn WorkflowRow src/` → 0 — the block **already** names a type the interface does not have, which is a hole in my own R-3 principle (「a diagram that is the interface view may only name what the interface names」). I do not apply that principle to `WorkflowRow` in a render-only edit either; consistency says it goes in the same DES-111 marker. **One marker, three stale facts:** positional `register` retired (ADR-035 / DES-148, `:649-656`); `deregister` returns `{removed, claimedTriggers}` (`:664`); `list()`'s `WorkflowRow` names no `src/` type. Take it or defer it — but write it in the rationale, because `07-review.md:247` has read past it once already.

**A-9 · The render oracle (KP-6, R-5) — CONVERGE on everything, with two additions and one non-reproduction.** Agreed: it lives beside `.sdlc/` (`:3827`'s wording wins over `:3841`'s `scripts/` — the subject is a ledger `.md`, and `scripts/` is a product directory); it is renamed `mermaid-render-check` (a parse-only oracle would have passed option B); the assertion is the render **then the SVG text**; it is human-invoked until the plugin's `dashboard_check` grows a render arm (TOOL-FORK's owner), never a Gate 6 blocker, never coupled to the lexical `dashboard_check` (one property, one script); loud skip when no browser launches. Additions from this round: (i) **for a `classDiagram`, assert no verbatim `~` in member text** — §0.2's parse-clean failure, which no parse step sees; (ii) **render with `htmlLabels:false`** so label text is SVG `<text>`, not a `<foreignObject>` HTML blob, and extraction is deterministic — stated as a **deliberate deviation** from the dashboard's config, not as that config: for `classDiagram` it changes nothing (member labels are SVG text in mermaid 11 either way, which is why §0.1's results are identical), but for the flowchart blocks in the sweep it moves labels out of `<foreignObject>`, so the oracle is checking *text fidelity*, not pixel parity with the dashboard; (iii) **do not trust exit codes at all** — assert the output SVG exists and that every member string the block declares appears in its text. On R-5: `mmdc` without `-p` **exits 1 on this box, no SVG** (§0.4) — reported as not reproduced, not as wrong; (iii) covers both boxes. On `src/diagram-render.ts`: the seam exists and its typed `RENDERER_MISSING` is exactly the loud-failure shape; but its config is hard-coded to the product's `strict` / `htmlLabels:false` with no `MmdcOpts` override, and adding one is a `src/` change Gate 4 cannot make. So the oracle **calls `mmdc -c` with `trace.py`'s config directly** (§0.1 shows the two configs agree for this class; the oracle should still render the dashboard's, since that is where `圖渲染失敗` appears) and borrows the engine's puppeteer args verbatim from `:138`. Named in the §9 row so a later reader knows the seam was seen and why it was not reused.

**A-10 · R-1's two-environment skew — CONCEDE the discharge check; half discharged this round.** The **config** axis is closed by §0.1 (dark+loose renders both candidates identically). The **version** axis — jsDelivr's floating `mermaid@11` — cannot be checked from this sandbox (egress blackholed) and stays the Gate 8 reviewer's check on a `git archive HEAD | tar -x -C <scratch>` copy, never in place; pinning the CDN is `trace.py`'s owner's (TOOL-FORK), not this gate's. Agreed and recorded, not closed.

**A-11 · Their §5 expected disagreements with my lens — three did not materialise, stated so the synthesis does not hunt for them.** (i) 「Rider A is documentation drift, MID at most」 — I rank it exactly as they do (a live green over dead bytes is a guard that stopped guarding), and I went the other way on breadth, not depth. (ii) 「The oracle should gate `dashboard_check`'s 7 MIDs」 — never proposed; r1 S-1 says the lexical count cannot see a render failure, which is the argument *against* coupling. (iii) 「Consumability wants the current signature in the diagram」 — r1 R-3 said name it for the next v22-slice touch, not rewrite; A-8 is where we land together.

**A-12 · Breadth of the design/task sweep — HOLD (six rows, now seven places).** Their r1 took three rows (DES-200, DES-208, TASK-205); mine took DES-202, DES-199, DES-200, TASK-205, TASK-206 and now DES-208. Each of the three they did not take is a sentence the tree contradicts, not a caveat: DES-202 `:6808` 「any `ok` in the tick → `live`」 is the very clause ARCH-124 struck at v27h — leaving it makes design, architecture and code disagree three ways **during** the pending owner decision that asks which reading holds; DES-202 `:6809` names a test case (`live→live` on degraded-plus-ok) that UT-245 `:30-35` now asserts the opposite of; DES-199 `:6783`'s `cache` literal is the DES mirror of the ARCH-123 drift v27h already repaired; TASK-206 `:1761` repeats DES-202's struck clause in a DoD. The architect applied this exact rule to `02`; leaving `04`/`03` unswept is the asymmetry the re-review files next. They have not yet objected — their r1 did not sweep — so this is 「unreconciled」 rather than 「contested」; if they object on scope in synthesis, the answer is the one-clause size of each edit and the fact that none adds a caveat.

**A-13 · The pre-boot literal — HOLD; unaddressed by their r1.** v27h assigned it to Gate 4 by name. r1 O-2's bilingual diagnostic (names `/static/dashboard/ui/app.js` and the three ways a client dies before `app.js:455`) stands, in the `.empty` hook, no `id`, no timer, no `<noscript>`, outside the string table by construction. The `…` fallback stays recorded with its cost (a dead client is a blank page with one glyph). If they raise REQ-131's 「散落字面值」 in synthesis, the scope answer is in r1 O-2 and R-5 and I will not repeat it here.

**A-14 · Two small notes of theirs, accepted:** IMPL-270's `app.js:427` is stale by 28 lines (`:455` is the body-level `replaceChildren`) — Gate 6's to correct at the next touch of that entry, COULD; and their KP-7 Karpathy line — no new module, no new parser, no vitest over a `.md`, no type minted to satisfy a diagram — is a constraint I accept for the whole edit map below.

---

## 2. Final position — the four dimensions

### 2.1 Observability

**System altitude.**
- **O-1 (the render oracle) — converged, spec as amended in A-9.** Inputs: every ```mermaid fence in `01`–`05` (`trace.py:301-330`'s regex; cite `file:line` as fence + 1). Per block: `mmdc -i … -o … -c <trace.py's config + htmlLabels:false> -p <the engine's args from diagram-render.ts:138>`; then read the SVG: FAIL if it does not exist, if any declared member string is absent, if `/%%/` matches, or (classDiagram) if member text contains a verbatim `~`. One `FAIL <file>:<line> …` line per failure, a one-line summary, exit 1 on any FAIL, **exit 2 with `SKIP: no Chromium`** when the browser cannot launch — never 0. Placement `.sdlc/mermaid-render-check.mjs`; §9 row says 「manual until upstream `dashboard_check` renders」. Measured reference: r1's puppeteer-direct run (one browser launch, 7 renders, 2.1 s wall). Round 2's `mmdc` runs were **not timed**, and `mmdc` launches a fresh Chrome per input file — so if wall time over 40 blocks matters, the oracle should batch every block through one launch (r1's shape) rather than shell out per block.
- **O-2 (the pre-boot literal) — unchanged from r1** (A-13).
- **O-3 (DES-202's transition table) — unchanged from r1**; it is the observability defect QD-O1 named (a 連線中 tag over a degraded table), closed in code at v27g, still open in the design text. Written as one overturnable sentence inheriting ARCH-124's `owner_decision: pending` (R-2 below).
- **O-4 (stale pointers) — unchanged**: DES-200 `server.ts:1251-1257` → `:1334`; plus, integrated from A-14, IMPL-270's `:427` named for Gate 6.
- **New this round — the corrected authoring rules (§0.3)** are themselves an observability control: a rule that names the wrong discriminator (either r1's) makes the next author escape the wrong thing and ship a parse-green/render-wrong member.

**Agent altitude.** N/A for this round's edits. The one hop that matters: `src/diagram-render.ts` already treats an author's render failure as a **typed outcome** (`RENDER_FAILED` with detail) — the product holds its own diagrams to a standard the ledger tooling does not yet meet, which is the whole case for O-1. The agent panel's swallowed error (QD-O5) stays §9.

### 2.2 Replaceability

**System altitude.**
- **R-1 (TASK-216 / the second `tsc` program) — the design sentence moves from MUST to SHOULD (A-6); the property does not move.** *The server tree is a complete program without the client tree and without DOM*, proven by `tsconfig.server.json` on every `build`, with one UT pinning both script strings so the two programs cannot be collapsed to one. If DES-191 gains the sentence, TASK-216 carries `des: DES-191`; if not, TASK-216 carries `traces:` only, trace-neutral, and the property lives in ADR-049 `:3444` alone.
- **R-2 (DES-202's flip set) — unchanged**: one sentence, one owner decision, four places that flip together (ARCH-124's sentence, DES-202's, `connection.js:26-31`, UT-245 `:30-42`).
- **R-3 (the interface view names only what the interface has) — applied consistently after A-8.** The render-only edit invents nothing (both surviving forms). The three facts where the v22 block *already* diverges from `src/` — positional `register`, `{removed}` without `claimedTriggers`, and `WorkflowRow` — go together into one dated DES-111 marker, SHOULD; the member texts stay v22's, because rewriting a dated slice to the v24 shape destroys the record of what v22 decided (the adversarial's boundary argument, which I accept).
- **R-4 (DES-199's `cache` literal) and R-5 (the literal is outside the string table by construction) — unchanged.**

**Agent altitude.** N/A: no gateway, model or tool seam is touched.

### 2.3 Consumability

**System altitude.**
- **C-1 — the ledger's consumers are agents; three id/pointer defects, one of them now shared with the adversarial text.** UT-240 → UT-241 (A-5), `server.ts:1251-1257` → `:1334`, and a block that renders `圖渲染失敗` twice in the shipped dashboard (their measurement: `grep -c "Promise~{version}~" dashboard.html` → 2). All cheap to fix, expensive to leave.
- **C-2 — TASK-215's DoD as TASK-213's STAYS / MOVES / RETIRES table — unchanged from r1, with the `:95` row now reading 「UT-241's duplicate — RETIRES (UT-224's re-pointed case at `:43` already guards the element)」 and the row's `des:` naming **DES-200 and DES-208** (DES-208 owns the disposition table; A-4).**
- **C-3 — TASK-216's DoD verbatim from ADR-049 `:3444` — unchanged.**
- **C-4 — the entity form's source-readability cost is paid by the own-line `%%` key** (measured invisible in the render, §0.1). If C is chosen, the key line names `#123;`/`#125;` only. Either way the line is what stops a later reader from 「cleaning up」 the entities back into braces (QD-R10).
- **C-5 — the §0.3 rules are the consumable artifact of this round for the next author**: four rules, one falsifier, and — new — the source lines that make them mechanisms rather than folklore.

**Agent altitude.** N/A: no MCP/HTTP surface changes (QD-C2/C3 stay §9).

### 2.4 Self-sustainability

**System altitude.**
- **S-1 — without O-1 the class recurs**: three recurrences, 45 rendered blocks, a lexical `dashboard_check` byte-identical before and after DASH-1's repair. Converged with the adversarial on the control; the §9 row must say 「manual until upstream」 so no one records it as closed-loop.
- **S-2 — TASK-216 re-proves the boundary with no human in the loop** (`deploy/rwe-update.sh:147` reverts a failed `build`), and the pinning UT keeps the two programs from being simplified into one — unchanged.
- **S-3 — the pending owner decision must not stall the loop and no design row may pre-empt it** — unchanged; DES-202 is written for either outcome.
- **S-4 — the micro-dispatch before the re-review; the cost of declining** — converged with the adversarial: **+2 LOW `未實作`**, ADR-049's 「UNGUARDED until」 stands into Gate 8, `:95` keeps guarding dead bytes, and every amended clause carries its 「pending TASK-215」 sentence (A-7). If exactly one task is taken, take TASK-215 — the adversarial's KP-5 reason (only TASK-216 has a red window between the ADR amendment and its landing, and that window is already disclosed in-tree) is correct and I adopt it.
- **S-5 — unchanged, out of scope, named**: DES-200's read-once island, F-7/QD-S2 listener release, REQ-142's single timer.

**Agent altitude.** N/A: memory metabolism, tool-liveness probing and prompt calibration are gateway/executor concerns; nothing here touches `src/gateway/` or `src/agent-executor.ts`.

---

## 3. Consolidated edit map (r2 — supersedes r1 §6; integrations marked ⊕)

| Where | Edit |
|---|---|
| `04-design.md:3306` block | new line after `classDiagram`: `%% #123; #125; #44; are { } , — a classDiagram member cannot carry them literally (DASH-2, v27j)`; `:3308` `Promise~{version}~` → `Promise~#123;version#125;~`; `:3309` `Promise~{channel,version,from}~` → `Promise~#123;channel#44; version#44; from#125;~`; `:3315` `Promise~{removed}~` → `Promise~#123;removed#125;~`; ⊕ `:3329` `class Scheduler { +markFired() +markFailed() }` → a three-line body. **Fallback if the synthesis prefers C:** the three members become `Promise of #123;version#125;` / `Promise of #123;channel, version, from#125;` / `Promise of #123;removed#125;` and the key line drops `#44;`. Falsify by render, then SVG text (§0.1). |
| ⊕ DES-111 (`:3399`) | `amended (v27j, SHOULD — record even if deferred)`: one dated marker — the positional `register` form is retired (ADR-035 / DES-148; `workflow-catalog.ts:653` throws on it), `deregister` returns `{removed, claimedTriggers}` (`:664`), `list()`'s `WorkflowRow` names no `src/` type; the v22 member texts above and in the diagram are left as the slice wrote them. |
| DES-202 `:6808-6809` | `amended (v27j)`: strike 「any `ok` … → `live`」; O-3's `worstOf` rule; the tests-line case flipped to `live→degraded` (UT-245 `:30-35`, `:37-42`); R-2's four-place flip set naming ARCH-124's `owner_decision: pending`. |
| DES-199 `:6783` | `amended (v27j)`: `cache:` literal → `'public, max-age=31536000, immutable' \| 'no-store'` (`static-assets.ts:33`). |
| DES-200 `:6791-6793` | `amended (v27j)`: `server.ts:1251-1257` → `:1334`; strike 「markup and CSS only」 and 「`draggable="false"` … stays on `DASHBOARD_HTML`」 (IMPL-270; UT-224 at `:43`); Layer-1 shape per ARCH-122's amended `api:` + `<main class="empty">` + O-2's literal (fallback `…` recorded with its cost); R-5's why-outside-the-table clause; tests line gains the UT-241 positive; 「until TASK-215 lands, the fossil body stands and is not a test subject」. |
| ⊕ DES-208 `:6856` | `amended (v27j)`: `draggable="false"` leaves STAYS — **MOVED** for UT-224 (done at v27g, `clientFile('ui/workflow.js')`, IMPL-270) and **RETIRES** for UT-241's duplicate at `dashboard-page-source.test.ts:95` (TASK-215); the `[v27c]` sentence 「`draggable="false"` is markup and stays」 struck with the reason; 「pending TASK-215」 sentence. |
| DES-191 `:6719-6722` (SHOULD, A-6) | `amended (v27j)`: R-1's second-program sentence, its two planted-violation falsifiers, the accepted in-editor limit. |
| TASK-205 `:1752` | `[v27j]` strike 「and `DASHBOARD_HTML` still contains `draggable="false"`」 (same strike style as its `[v27c]`); 「pending TASK-215」 sentence. |
| TASK-206 `:1761` | `[v27j]` 「any `ok` → `live`」 → O-3's rule. |
| TASK-215 (new, after `:1835`) | `status: draft`, `iter: v27j`, `estimate: S`; `traces: ARCH-122, ADR-049, REQ-131`; `files:` `src/dashboard-page.ts`, the five page-source suites; ⊕ `des: DES-200, DES-208`; `dod:` r1 C-2's table with the `:95` row as UT-**241**; same commit deletes `dashboard-page.ts:92-152`, strikes ARCH-122's two tree-state clauses and DES-200/DES-208/TASK-205's 「pending」 sentences, fixes `dashboard-page-source.test.ts:51` `UT-240` → `UT-241`; F-pattern clause (red on the new UT-241 positive first). |
| TASK-216 (new) | `status: draft`, `iter: v27j`, `estimate: S`; `traces: ADR-049, ARCH-124, REQ-131, REQ-134`; `files: tsconfig.server.json (new), package.json, tests/unit/tsconfig-server-program.test.ts (new, next free UT id)`; `des: DES-191` **if** the sentence lands, else omitted (trace-neutral); `dod:` r1 C-3 (both exit codes, the three planted violations, the script-string pin; strike ADR-049's 「has NOT landed」 and ARCH-124's 「UNGUARDED until」). |
| `03-tasks.md:1620` | header `TASK-196..213` → `..216`. |
| `04-design.md` end (after `:7141`'s section) | `## Decision rationale — v27j (Gate 8 send-back repair, design half; who conceded, and why)` — including A-8's marker decision either way. |
| `07-review.md` §9 (orchestrator / next Gate 8 pass) | new row beside TOOL-FORK: `.sdlc/mermaid-render-check.mjs`, the A-9 spec, 「manual until upstream `dashboard_check` renders」, the `diagram-render.ts` seam seen and not reused (config is hard-coded to the product's), the CDN version axis as the reviewer's check. |
| `02-architecture.md:3782+` (Gate 2's, recorded not taken) | §0.3's four classDiagram rules beside the sequenceDiagram rule; ARCH-122 `:3343` `UT-240` ×2 → `UT-241`; `:3841` `scripts/mermaid-parse-check.mjs` → `.sdlc/mermaid-render-check.mjs`. |
| COULD (one token each) | TASK-204 `:1743` / DES-198 `:6777` 「`immutable`」 → the directive; DES-200 tests line names `val-198:287`; IMPL-270 `app.js:427` → `:455` (Gate 6); the second one-line class body at `04-design.md:4908` (next touch of that block). |

---

## 4. Remaining disagreements (honest)

1. **The spelling of three members** — entity-in-generic (`Promise<{…}>`) vs `Promise of {…}`. Both measured correct under both configs. I hold on fidelity; the adversarial's stated reason for preferring C (B's comma failure) is dissolved by `#44;`, but they have not yet seen that measurement. **Not blocking either way**; the synthesis picks one and the falsifier is identical.
2. **Breadth of the design/task sweep** (three rows vs seven places) — unreconciled rather than contested; my reasons in A-12, each edit one clause, none a caveat.
3. **The DES-191 sentence** — I now say SHOULD; if the adversarial reads any amendment sentence as 「a DES for TASK-B」 and refuses it as duplication, the disagreement is one additive sentence and I would not hold the task hostage to it.
4. **The pre-boot literal** — not yet argued by the adversarial this round; the `…` fallback is on the table with its cost.

Everything else — the render-only principle, the coupling, one commit, no new DES rows, the two-row split of the tasks, the oracle's shape and placement, the DES-111 marker, the CDN axis as the reviewer's check — is converged.

---

## 5. Risks — delta from r1's table (ids continue; r1's QD-R1..R11 stand except as noted)

| # | Risk | Severity | Note |
|---|---|---|---|
| QD-R1 (r1) | closed with the finding's `Promise~VersionResult~` | HIGH | unchanged — both lenses now refuse it on the same ground (phantom types; `WorkflowRow` shows the block already has one) |
| QD-R3 (r1) | TASK-215 cites UT-240 | HIGH | **raised in likelihood**: the adversarial r1 carries the mislabel in every mention; if their text is synthesised verbatim the wrong id lands in the ledger |
| QD-R4 (r1) | TASK-216 with a dangling/invented `des:` | ~~MID~~ → LOW | `des:` is optional (A-6); the risk collapses to 「omit it or point it at an amended DES-191」 |
| QD-R12 (new) | **the authoring rule is recorded from either r1** — 「entity + comma」 or 「any comma」 — and the next author escapes the wrong thing | MID | §0.3 is the only version with a cited mechanism; ask the synthesis to record that one |
| QD-R13 (new) | DES-208 is amended 「STAYS → MOVES」 only, leaving `:95` with no disposition | MID | A-4 — the amendment has two halves |
| QD-R14 (new) | the oracle is built on `renderWithMmdc` for convenience and inherits the product's `strict`/`htmlLabels:false` config instead of the dashboard's | LOW | A-9 — §0.1 shows no difference for this class, but the target is the dashboard; call `mmdc -c` with `trace.py`'s config and borrow only the puppeteer args |
| QD-R15 (new) | the adversarial's 「`mmdc` without `-p` exits 0」 is built into the oracle as its motivating assumption and turns out box-specific | LOW | irrelevant once the oracle asserts SVG existence + member text (A-9 iii) |

---

## key_points

1. **Both round-1 root causes were wrong; the replacement is measured and cited.** Two or more literal commas inside one `~…~` defeat mermaid's generic conversion (`parseGenericTypes` re-joins exactly one pair); one comma is fine; `#44;` never enters the split; a `(` in the return type is eaten by the greedy `methodRegEx`. Four rules, one falsifier — §0.3.
2. **DASH-2 has two correct repairs and one live preference.** Entity-in-generic renders `Promise<{version}>` / `Promise<{channel, version, from}>` / `Promise<{removed}>` through the adversarial's own `mmdc`, under both mmdc's default and `trace.py`'s dark+loose; option C renders `Promise of {…}` under the same. I hold on fidelity; C is an acceptable fallback; not blocking.
3. **Conceded and integrated:** the `Scheduler` split (`:3329`); DES-208 as the third `draggable` row, with a **two-half** disposition (MOVED for UT-224, RETIRES for UT-241's `:95`); the coupling framing (one commit, 「pending TASK-215」 sentences if declined); `des:` optional — DES-191's sentence is SHOULD and TASK-216 no longer waits on it; the DES-111 marker (positional `register`, `claimedTriggers`, `WorkflowRow`) as SHOULD with members untouched; oracle at `.sdlc/mermaid-render-check.mjs`, never a Gate 6 blocker, never coupled to `dashboard_check`.
4. **Held on evidence: UT-241, not UT-240** (`05-tests.md:12062/12075`) — every adversarial 「UT-240」 for the `:95` case must be re-read; TASK-215 fixes the `:51` comment.
5. **Held on reasons:** the seven-place sweep (each a contradiction; the architect's own rule, applied symmetrically) and the pre-boot diagnostic literal (fallback `…` recorded with its cost).
6. **The oracle spec gained three lines from this round:** classDiagram member text must contain no verbatim `~`; render with `htmlLabels:false`; trust the SVG's existence and text, never an exit code — `mmdc` without `-p` exited 1 here, not 0, and the spec must not depend on which.
7. **R-1's config axis is discharged; its version axis is the Gate 8 reviewer's** (floating CDN `mermaid@11`, unreachable from here), owner TOOL-FORK.
8. **The seam that was seen and not reused:** `src/diagram-render.ts` already wraps `mmdc` with the right puppeteer args and a typed loud failure, but its config is the product's and un-overridable from outside `src/` — borrow the args, not the function.
9. **Take TASK-215 if only one task is taken**; the cost of declining both is the same +2 LOW `未實作` both r1s priced, plus a `pending` sentence in every amended clause so the ledger never contradicts the tree while it waits.
