# Design panel — Adversarial group (interface-contract · boundary/error · testability), round 2

- **stage:** Design (Gate 3/4), v27 Gate 8 send-back, design half. Round **2 — convergence**, written after reading `quality-dimensions.r1.md` in full.
- **read this round:** `quality-dimensions.r1.md` (229 lines, all six sections + its 11 risks + its 6 expected disagreements); my own `adversarial.r1.md`.
- **supersedes:** this path held the v27b/v27c round-2 proposal. Preserved at `git show c7447d0:.sdlc/features/001-remote-workflow-engine/.panel/design/adversarial.r2.md` (never `git checkout` / `git restore` / `git stash` — CLAUDE.md).
- **measured this round** (mermaid 11.17.2 from `node_modules`, Chrome from `~/.cache/puppeteer`, `mmdc -p pptr.json`, SVG text read out of `<foreignObject>`): seven renders — QD's entity form with and without a space after `#44;`, my r1 option C, the Scheduler split, the full proposed edit, the full edit again under **trace.py's own `theme:'dark', securityLevel:'loose'`**, and a four-member arity probe that settles the comma rule (§6).
- **I did not touch `04-design.md` or `03-tasks.md`.** This file only.

---

## §0 Scoreboard — every disagreement, adjudicated

| # | Item | QD r1 | My r1 | **Verdict** | Basis |
|---|---|---|---|---|---|
| D-1 | DASH-2 fix form | entity codes **inside** the generic, `#44;` for commas | option C: shape out of the generic into trailing prose | **CONCEDE to QD** (one refinement, D-2) | measured: QD's form keeps `Promise<…>` *and* the brace shape; mine degrades a generic to prose |
| D-2 | `#44;` followed by a space | `#123;channel#44; version#44; from#125;` → `{channel, version, from}` | — | **REBUT (partial): drop the space** | source is `{channel,version,from}`; the space-form adds characters the author did not write, against QD's own zero-meaning-change standard |
| D-3 | `%%` own-line comment in the block | take it (C-4, mitigates QD-R10) | not proposed | **CONCEDE** | rendered this round: parses, 0 `%%` in SVG |
| D-4 | Scheduler `{ +markFired() +markFailed() }` | not seen | split the line | **HOLD — confirmed by measurement** | 31 rendered rows vs **32** after the split; it parses, so QD's sweep could not see it |
| D-5 | Induced-drift sweep breadth | six rows (DES-199/200/202, TASK-205/206) | three rows (DES-200 ×2, DES-208, TASK-205) | **CONCEDE to QD** | verified DES-202 and DES-199 at file:line against the shipped code |
| D-6 | Which drift row ranks highest | DES-202 HIGH (QD-R2) | my Rider A | **CONCEDE — DES-202 outranks my Rider A** | DES-202 `:6809` is an instruction to *reintroduce* a repaired bug, not a stale note |
| D-7 | `UT-240` vs `UT-241` on the `draggable` pin | ledger says UT-241; ARCH-122 copied the test file's mislabel | I wrote UT-240 | **CONCEDE — my r1 was wrong** | `05-tests.md:12062` / `:12075`; both ids resolve, so trace stays green |
| D-8 | TASK-216 needs a `des:` parent | yes — amend DES-191 | no — TASK-018/TASK-153 precedent | **CONCEDE the direction, NARROW the content** (§3) — **and my r1's TASK-153 citation was false** | `TASK-153` carries `des: DES-138, DES-142`. Real precedent: TASK-018 (none) and 96 of 214 rows |
| D-9 | Pre-boot literal: sentence or `…` | a sentence naming the asset | (not covered; QD expected me to object on REQ-131) | **CONCEDE + REBUT (partial): the sentence, two narrowings** (§4) | REQ-131:1728's clause is scoped to the *language-toggle* Given; and my own v27h "not a seam" objection binds me |
| D-10 | Task ids / header range / next UT | TASK-215, TASK-216, header `..216`, UT-258 | TASK-A / TASK-B | **CONCEDE** | TASK-214 is last; `03-tasks.md:1620` says `..213`; UT-257 is last |
| D-11 | Ordering: clauses vs task rows | DES parents amended **first** (§5.2) | mint TASK-A **first** (KP-4) | **DISSOLVED — not a dispute** (§5) | both of us require ONE batch; intra-batch order is moot. QD's DES-first is fine |
| D-12 | Render check: where it lives | §9 tooling row beside TOOL-FORK, spec attached, manual until upstream | `.sdlc/`, renamed `mermaid-render-check.mjs`, never `tests/`, never a Gate 6 blocker | **CONVERGED** — same routing; three constraints added (§6) | — |
| D-13 | Stale positional `register(...)` signature | `claimedTriggers` "seen, not taken" (R-3) | SHOULD, deferred, **must be recorded** | **HOLD — agree in kind, and hold the recording clause** (§7) | `workflow-catalog.ts:653` throws by name; DES-111 carries the same stale shape 12 lines below |

**Net:** eight concessions (three of them corrections to my own r1), two holds, three partial rebuts, one dissolved, one converged. Nothing in QD r1 survives this round as a live dispute except D-2, D-4 and the §7 recording clause — all three are additive, none contradicts QD.

---

## §1 D-1/D-2/D-3 — the DASH-2 edit, measured end to end

**I withdraw option C.** My r1 measured that entity-escaped braces beside a **bare** comma render the tildes verbatim, and stopped there — concluding the generic was unsalvageable for the comma case. `#44;` was the case I never tested; QD tested it, and it works. My conclusion was overturned by their measurement: my r1's option table had a hole in it, not their form a flaw.

The difference matters to the interface-contract lens, which is why I concede rather than split the difference: QD's form renders `Promise<{version}>` — still a **generic**, angle brackets intact, consistent with the five untouched `Promise~VersionEntry~`-class members in the same class body. Option C renders `Promise of {version}` — prose, inconsistent with its five neighbours. **My r1's R-2 ("the three members stop being machine-readable as generics — accepted deliberately") is retired**: it was the price of a form that is no longer on the table, and QD's form does not charge it.

**D-2 — the one partial rebut of QD's form.** QD writes `#123;channel#44; version#44; from#125;` — a space after each comma entity. Measured, both forms render:

| form | rendered member text |
|---|---|
| QD's, with space | `+publish(name, version, channel, principal) : Promise<{channel, version, from}>` |
| **no space (proposed)** | `+publish(name, version, channel, principal) : Promise<{channel,version,from}>` |

The v22 source is `Promise~{channel,version,from}~` — no spaces. QD's summary claims the entity form "renders **exactly** the shape the author wrote"; with the space it renders a shape the author did not write. Three characters, zero argument value, and it is the standard QD themselves set. Take the no-space form.

**D-3, conceded and verified.** QD's C-4 comment line was not in my r1 and I had not rendered it. Rendered this round as line 2 of the block: parses, contributes nothing to the SVG (`%%: 0`). It is the mitigation for QD-R10 (a later reader "restores" the braces and the failure returns, still parse-clean), and DASH-1's authoring rule already chose own-line comments over `note for`. No trim: the line is one line and every token in it is load-bearing.

**D-4, the finding QD's sweep structurally could not see.** `class Scheduler { +markFired() +markFailed() }` (`:3328`) parses, so a 40-block parse+render sweep reports it green; QD's fidelity count ("all 8 members present") was taken over `WorkflowCatalog`. Measured on the taken form:

```
rows: 31   …   |Scheduler|   |+markFired() +markFailed()|      ← two methods, ONE row
rows: 32   …   |Scheduler|   |+markFired()|  |+markFailed()|   ← after the line split
```

Same parse-green/render-wrong class as DASH-1's `%%` literals, inside the block already being opened, one line. Take it.

**The whole edit, rendered under trace.py's own config** (`theme:'dark', securityLevel:'loose'` — `trace.py:687`), i.e. the three entity members + QD's `%%` line + the Scheduler split, together:

```
+register(name, script, defaults, principal) : Promise<{version}>
+publish(name, version, channel, principal) : Promise<{channel,version,from}>
+deregister(name, principal) : Promise<{removed}>
+markFired()      +markFailed()      (two rows)
rows: 32 | tilde: 0 | raw-entity: 0 | %%: 0
```

**This narrows my r1's R-1.** I had ranked the two-environment skew MID across two axes — config and mermaid version. The config axis is now closed by measurement: `securityLevel:'loose'` + `theme:'dark'` produces byte-identical member text. What remains is only the **floating `mermaid@11`** at `trace.py:623` against the pinned 11.17.2. R-1 drops to **LOW-MID**, its discharge check is unchanged (regenerate `dashboard.html` on a `git archive` copy, assert no `圖渲染失敗`), and pinning the CDN is still **TOOL-FORK's owner's**, not this gate's.

---

## §2 D-5/D-6 — I conceded the sweep, and I rank one of QD's rows above my own

I expected to resist this widening on the Karpathy tie-break and I do not, because I verified both unnamed rows at file:line and they are contradictions, not caveats:

| Row | What it says | What ships | |
|---|---|---|---|
| **DES-202** `:6808` | "any `ok` in the tick → `live` with `consecutiveFails: 0`" | `connection.js:26` `worstOf(tick.results) === 'ok'` → live; any mix short of unanimous fail → `degraded` | contradiction |
| **DES-202** `:6809` tests | "`live→live` on a degraded-plus-ok tick" | `dashboard-lib-connection.test.js:30-35` asserts **`degraded`** | **inverted** |
| **DES-199** `:6783` | `cache: 'immutable' \| 'no-store'` | `static-assets.ts:33` `'public, max-age=31536000, immutable' \| 'no-store'` | contradiction, one token |

**D-6 — I rank DES-202 above my own Rider A, and the boundary lens is why.** My Rider A is a design clause authorising a test that asserts dead bytes: a live vacuous green, bad. DES-202 `:6809` is worse in kind. A design row's `tests:` line is read as a *specification for the test to write*; this one names the exact case that `v27c AC-4` repaired and states the pre-repair expectation. An implementer handed DES-202 verbatim writes an assertion that **re-introduces** the bug — the tag reading 連線中 over a degraded visible table, the thing `val-199-workflow-detail.test.ts` crashed on. That is not documentation drift; it is a defect generator, and it is the top design-owned finding of this round. QD-R2's HIGH is correct and I endorse it over my own.

One constraint I add to QD's O-3/R-2, from the boundary lens: the amendment inherits `ARCH-124`'s `owner_decision: pending` (`02-architecture.md:3365`) and **enumerates the flip set** — ARCH-124's sentence, DES-202's sentence, `connection.js:26-31`, UT-245 `:30-42`. QD already proposed exactly this. Agreed without reservation; naming it here so the synthesizer sees both lenses require it, not one.

---

## §3 D-7/D-8 — two corrections to my own round 1

**D-7. My r1 labelled `dashboard-page-source.test.ts:95` "UT-240". It is UT-241.** `05-tests.md:12062` = UT-240 = `static-assets.test.ts` (traces DES-199/TASK-204); `:12075` = UT-241 = `dashboard-page-source.test.ts` extended (traces DES-200/TASK-205). I copied the test file's own mislabel at `:51` — the same way ARCH-122 `:3343` did, twice. My `:43` label (UT-224) was right; the `:95` one was not.

This correction **sharpens** my KP-4 rather than softening it, and it is a textbook interface-contract defect: both ids exist, so `sh .sdlc/trace` is green in every direction, while an implementer handed ARCH-122's TASK-A text opens `static-assets.test.ts` looking for a `draggable` case that was never there. A reference that resolves to the wrong thing is worse than a dangling one — the dangling one has a checker. QD's TASK-215 DoD fixing `:51` in the same commit is the right closure.

**D-8. My r1 cited TASK-018 *and TASK-153* as tasks tracing to ARCH with no DES row. TASK-153 carries `des: DES-138, DES-142`.** I asserted "both are prose mentions only" from a grep over `04-design.md` for `### DES-` rows and did not check the task rows' own `des:` fields. The precedent survives on the real numbers — **TASK-018 has no `des:`, and 96 of 214 task rows carry none** — so QD's "a TASK's `des:` must resolve" is too strong as stated. But QD's *direction* is right and I concede it: a compile-time guard belongs to a design row, and DES-191 is literally titled "the guard tier".

**The narrowing — exactly what stays and what goes from QD's R-1 sentence:**

- **KEEP** (this is design-layer content DES-191 already owns — its `tests:` line is "the planted-violation case per guard"): the three falsifiers — planted `document.title` in a server `.ts` → **TS2584**; planted `import … from './dashboard/lib/connection.js'` → **TS7016**; a planted stray token in `ui/app.js` still fails the **ROOT** program → **TS1109** (the coverage that must not be traded away); **one UT pins both `package.json` script strings**; the accepted limit (editors resolve the nearest `tsconfig.json`, which keeps DOM — a CI/build property, not an in-editor one).
- **CUT**: the transcribed config shape (`extends` / `lib:["ES2022"]` / `allowJs:false` / `include:["src"]` / `exclude:["src/dashboard"]`). Replace with **"shape per ADR-049 as amended, `02-architecture.md:3444`"**.
- **Why:** that literal is already written verbatim in ADR-049's amendment and again in TASK-216's DoD. A third copy is three places to drift, and the Karpathy tie-break refuses it. The falsifiers are not duplication — they are the seam that makes the property testable, which is the design gate's job and not the ADR's.

---

## §4 D-9 — the pre-boot literal: conceded, twice narrowed

QD predicted I would invoke REQ-131's 「畫面不得散落字面值」. I read the requirement rather than the quotation. `01-requirements.md:1727-1728` puts the clause inside the **language-toggle** Given — 「語言分段設 EN **Then** nav/tab/欄位標題全英文… 兩種語言的字串同源於單一字串表,畫面不得散落字面值。」 It governs strings that must *switch language*. A string emitted by the server before any module can load is not one of those, by construction. QD's reading is correct.

And my lens is bound by its own record, which I checked rather than took from QD's characterisation: `02-architecture.md:3807` — 「Adversarial adopted the static text (an empty mount is a blank page on a module 404: not false, but **not a seam either**)」. A `…` glyph is that same objection with one character added. So this is not really a concession, it is consistency: **a sentence, in the `.empty` hook, no `id`, no `<noscript>`, no timer** — the shape adversarial already adopted at v27h, now with the literal filled in.

Two partial rebuts of QD's proposed literal, both from the lenses that are mine:

1. **Cut the parenthetical cause list.** QD's literal enumerates 「404 / CSP / 語法錯誤」. From the operator's seat those three are one condition — the module did not load — and the action is identical for all three. The actionable content is *the client did not start* plus *the one path to check*. Boundary lens: enumerating causes in a static string is a promise the string cannot keep (it cannot tell which of the three occurred), and a fourth cause added later makes it wrong. Drop the parenthetical; keep the path.
2. **The path in the literal must be pinned equal to the module `<script src>`, in UT-241's positive — one assertion.** This is the testability lens's whole contribution here. QD's literal names `/static/dashboard/ui/app.js`; that prefix is owned by `STATIC_ASSETS` / the `<script src>` the same page emits. Two copies of one path, one of them unguarded, is exactly how a diagnostic starts lying silently — and this one lies precisely when it is the only thing on screen. Assert the diagnostic text contains the same path the shell's module `<script src>` carries, in the same UT-241 positive QD already proposes (`<main class="empty">` + island + module script + no `<section`/`<header`). One line, and it makes the seam falsifiable instead of asserted.

Bilingual-both-at-once, with no per-`lang` branch: accepted, for QD's reason (the shell has no language knowledge; `theme-init.js` restamps `lang` before paint) and because the audience is an operator staring at a dead page, not a user exercising the toggle.

---

## §5 D-11 — the ordering "dispute" is not one, and the synthesizer should not read it as one

My r1: "mint TASK-A first, then edit the clauses in the same batch." QD §5.2: "Both `des:` parents need the amendment first." Opposite words, identical requirement — **neither artifact may land alone**. Inside one batch the intra-batch order is invisible to every consumer: the trace tool reads the committed tree, not the edit sequence. QD's DES-first is fine and I adopt it.

What both of us actually mean, stated once so it survives into the synthesis: **a design clause that forbids an assertion the tree still runs, with no task row scheduled to remove it, is strictly worse than leaving both alone.** QD's proposed DES-200 sentence 「until TASK-215 lands the fossil body stands and is not a test subject」 is the mechanism, and it is the same shape ARCH-124 already uses (「UNGUARDED until TASK-B lands」). If the orchestrator declines the micro-dispatch, that sentence is what keeps the round honest — and the priced cost stands: **+2 LOW `未實作` trace rows** (`02-architecture.md:3836`), ADR-049's UNGUARDED sentence into Gate 8, and `dashboard-page-source.test.ts:95` still green over bytes `app.js:455` discards.

QD §5.4's commit rule is the one I would elevate: TASK-215's body deletion and its five dispositions in **one** commit. Deletion first turns five assertions red; dispositions first leaves them green over dead bytes — and DES-208's own sentence says which of those is the dangerous one.

---

## §6 D-12 — the oracle: converged, plus three constraints from this session's measurements

Routing agreed with QD: **§9 beside TOOL-FORK, not a TASK, not in `tests/`, manual until the plugin's `dashboard_check` grows a real-render arm.** I drop my r1's `.sdlc/` vs `scripts/` placement argument — QD's §9-row-with-spec makes the path the tooling owner's call, and that is the right owner. I keep the rename: the oracle is a **render** check, not a parse check, and the filename must not bake in the weaker oracle.

QD's O-1 spec is adopted whole. Three constraints to add, each one a silent-always-pass I hit empirically this session:

1. **`-p <puppeteer config>` is mandatory.** Without it `mmdc` dies inside `JSON.parse` on `/dev/null` and **exits 0**. An oracle built naively is a green light wired to nothing.
2. **The extractor must read `<foreignObject>` / `<span>`, not `<text>` / `<tspan>`.** A classDiagram renders every member into an HTML `foreignObject`; my first extractor was written against `<text>` and returned **zero rows for every candidate**, reporting `tilde: 0 | raw-entity: 0 | %%: 0` — a perfect score on four files it had not read. QD's sweep already reads foreignObject (they counted all 8 members), so this is a spec constraint for whoever writes the script next, not a defect in their result. Name the element in the spec, and make an **empty extraction a FAIL, never a pass** — the zero-row case is the bug, not a clean block.
3. **Keep QD's "no verbatim `~` in classDiagram member text."** It is the assertion that catches the raw-tilde failure, which parses clean and is invisible to every lexical check.

**A correction to QD's authoring rule (b), and to my own r1's root cause — the discriminator is the comma COUNT, not the comma.** Both r1s reported a comma result and they looked incompatible: mine had `Promise~A,B~` → `Promise<A,B>` ✓, QD's had `Promise~channel,version,from~` → raw. Probed this round:

| member | renders |
|---|---|
| `Promise~A,B~` (one comma) | `Promise<A,B>` ✓ |
| `Promise~A,B,C~` (**two** commas) | **`Promise~A,B,C~` raw** ✗ |
| `Promise~#123;A#44;B#125;~` | `Promise<{A,B}>` ✓ |
| `Promise~A(B)~` | **`Promise~A(B) : ~`** ✗ |

Neither measurement was wrong; they were different arities. **One comma converts, two do not** — which also retires my r1's stated root cause ("entity + comma *together* is what breaks"): the entity was never the variable, the comma count was. QD's paren finding is confirmed unchanged.

So rule **(b)** must not be recorded as *"a `,` inside `~…~` disables the conversion"* — that is false for the single-comma case a future author will hit first, and a rule that is wrong in the common case gets ignored in the uncommon one. Record it defensively instead:

> *(b) inside a `~…~` generic, a `(` always breaks the conversion and a comma breaks it from the **second** comma onward (`Promise~A,B~` converts; `Promise~A,B,C~` renders raw). Do not rely on the arity — write every literal comma as `#44;`.*

**What I do NOT propose, having considered it and refused it:** a rendered-row-count assertion to catch the Scheduler collapse (D-4). To know 32 is right the oracle would have to count visibility tokens per class-body line in the source — the lexical heuristic whose noisiness is the exact reason my r1 refused to couple this check to `dashboard_check`. One property, one script. The Scheduler class belongs to the **authoring rules** instead: a third rule beside QD's two —

> *(c) one member per line in a class body. Two visibility tokens on one line parse, and render as a single row.*

— with, at most, a lexical **`warn`** (never a FAIL) in the oracle's pre-pass. QD's (a) and (b) plus this (c) go beside v27h's sequenceDiagram rule at `02-architecture.md:3782+`, recorded by this gate, taken by Gate 2.

---

## §7 D-13 — the one thing I hold that QD did not raise

QD's R-3 names `deregister`'s `claimedTriggers` as "seen, not taken — name it for the next v22-slice touch." Agreed in kind. My r1's §3 conflict-1 finding is larger and I hold it at **SHOULD, deferred, recorded**:

- `+register(name, script, defaults, principal)` is the **retired positional form**. `src/workflow-catalog.ts:653` throws by name on it: 「the pre-v24 positional (name, script, defaults, principal) shape is retired (ADR-035)」.
- **It may not be repaired alone.** `04-design.md:3399` — DES-111, twelve lines below the diagram — carries the identical stale shape annotated `// signature unchanged`. Fixing the member would make the diagram contradict the DES row beneath it: one honest staleness converted into a fresh inconsistency. Both together, or neither.
- **Deferring is right** (the block is a dated v22 slice and this is a render-only send-back); **being silent is not.** `07-review.md:247` already read past this once. If the synthesis defers it, it must say so in a dated marker on DES-111 — a row that already carries two amendment markers, so the convention is established there. The failure mode here is not the deferral; it is the third silent pass.

---

## §8 Remaining disagreements after this round

Three, all narrow, none blocking:

1. **D-2 — the space after `#44;`.** Three characters. I hold no-space (byte-faithful to the v22 source, QD's own standard); if the synthesizer prefers QD's spaced form, take it and move on. Not worth a round 3.
2. **D-4 — the Scheduler split.** QD has not seen it yet; I expect agreement once the 31-vs-32 measurement is in front of them. If it is judged scope creep, note that it is one line inside a block being opened anyway, and filing it costs more than taking it.
3. **§7's recording clause.** QD may hold that any mention of the stale signature widens a render-only send-back. I do not contest the *deferral*; I contest only *silence*, and a dated marker is the cheapest form of not-silent there is.

**Where I now stand with QD, for the synthesizer:** we agree on the fix form, the sweep, the six drift rows, the two task rows and their ids, the pre-boot sentence, the oracle's routing and its oracle, the one-batch rule, and the micro-dispatch recommendation with its priced decline. The design half of this send-back does not need a third round; it needs the edit map from QD's §6 with D-2, D-4, §3's DES-191 cut, §4's two narrowings and §6's three oracle constraints folded in.
