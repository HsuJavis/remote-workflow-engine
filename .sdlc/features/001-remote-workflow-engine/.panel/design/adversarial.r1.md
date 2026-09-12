# Design panel — Adversarial group (interface-contract · boundary/error · testability), round 1

- **stage:** Design (Gate 3+4 delta). Iteration label per the synthesizer — `state.yaml` reads `v27` with the
  last delta at `v27b`; I refer to this round as **the CSS-ownership delta** rather than coining an id.
- **round:** 1 (independent proposal — written without reading this round's quality-dimensions r1)
- **scope routed to this panel:** `state.yaml` `pending[0]` (2026-09-12) — `src/dashboard/dashboard.css` is
  owned by **TASK-205 only**, whose scope was porting the *pre-v27* component CSS onto the new token set;
  TASK-205 is done, and the four tasks that build the new surfaces (TASK-207, TASK-210, TASK-211, TASK-212)
  carry pixel-precise DoD clauses with **no `.css` file in `files:` and no CSS-bearing DES row**.
- **supersedes:** this path previously held the v27b round-1 adversarial proposal (ADR-051 overlay reversal).
  Preserved in git: `git show 4e7412c:.sdlc/features/001-remote-workflow-engine/.panel/design/adversarial.r1.md`
  (never `git checkout`/`git restore` — CLAUDE.md).

---

## 0. Altitude judgement — which system is this, and does my lens read differently?

`state.yaml` `tech_stack` is unambiguous: Node 22.6 / TypeScript ESM / vitest / better-sqlite3 / a
hand-rolled JSON-RPC-over-HTTP MCP server / **two `GatewayClient` implementations driving real LLM agent
sessions** (`LiteLLMGatewayClient`, `ClaudeAgentSdkGatewayClient` over `@anthropic-ai/claude-agent-sdk`) /
a `node:vm` + `child_process` sandbox / ajv schema-validated agent retries.

**Verdict: both altitudes, and they split cleanly along this delta's seam.**

- The **artifact under design** (a stylesheet, a class inventory, `getComputedStyle` assertions) is
  *conventional system* work. There is no agent in `dashboard.css`. Applying an agent-altitude
  "replaceability of the model" or "self-sustainability of the loop" reading here would be forcing the
  irrelevant one, and I do not.
- The **thing the artifact makes observable** is squarely *agent altitude*. REQ-134's own acceptance
  sentence is 「5 lane、9 agent 一眼看出卡在哪」 and Round-1 Q1's owner answer was 「以觀測性為主」 — the
  first-ranked goal of the iteration. REQ-135 is a per-agent post-mortem surface (model, effort, timeout,
  four token columns, cost, the user prompt, the event stream, the failure `detail`).

**Consequence that drives the whole proposal.** At the system altitude CSS is presentation and a missing
rule is cosmetic. At the agent altitude, in *this* design, CSS is **the state channel**: `running`, `done`,
`failed`, `queued/pending` and `predicted` are distinguished from one another **only** by
`rweGlow`/`rweRing`, `oklch(0.55 0.16 25)`, a dashed border with `opacity .65` and a hollow dot — REQ-134
encodes agent state in style and never in text. An unstyled swimlane therefore does not render "an ugly
graph"; it renders **nine identical rectangles**, and the observability the owner ranked first is gone
while every structural assertion still passes. That is why I treat this as blocking rather than as polish
backlog, and it is the tie-breaker I apply whenever simplicity-first would otherwise say "ship it unstyled
and iterate".

---

## 1. Summary

The routed gap is real, is **materially larger than the pending note states**, and its root cause is an
**architecture-level ambiguity about where CSS lives** that TASK-205 resolved one way and TASK-207/210/211/212
were written assuming the other.

The single most useful thing I did this round was **stop treating the ledger as the source of truth and go
read the actual design handoff** (§KP-0). It is retrievable, it answers the question the pending note
flagged as unanswerable, and it immediately exposed a **shipped, committed fidelity defect in a task that
is already marked done** (§KP-3) that no lens working from the ledger alone could have seen.

Verified on disk and against the handoff, this pass:

| fact | measured |
|---|---|
| `src/dashboard/dashboard.css` | **126 lines / 9 308 bytes** |
| `grep -c '@keyframes' src/dashboard/dashboard.css` | **0** — the handoff specifies **seven** |
| client-emitted class names with **no rule at all** in the stylesheet | **29** |
| **the dark `--accent-100…900` ramp on disk is INVERTED vs the handoff** | committed `100 = L .93 … 900 = L .30`; handoff `100 = L .30 … 900 = L .93` |
| `--shadow-md`, `--neutral-500`, `--radius-md/sm`, the spacing scale | **0 occurrences each** — all four are named by REQ-134 / ARCH-122 / the handoff |
| `grep -c 'transition\|translateX\|cubic-bezier' src/dashboard/ui/agent-panel.js` | **0** — REQ-135's slide-in does not exist |
| agent panel width | on disk `420px` (`agent-panel.js:110`); handoff `min(760px, 100vw)` |
| hard-coded literals already inlined in `ui/*.js` | `agent-panel.js:104` `rgba(8,12,9,.5)`, `:180` `oklch(0.3 0.12 25)`; `workflow.js` 26 `style` sites; `run.js` 8 |
| `grep -n 'rweGlow\|rweRing\|rweSweep\|rwePulse\|keyframes\|getComputedStyle\|animation' 05-tests.md` | **0 hits across 12 227 lines** |

My three lenses agree on the diagnosis and disagree on the shape of the fix; the disagreements are in §6
rather than smoothed over. The converged proposal:

> **(a) Commit the handoff package into the repo as the fidelity fixture; (b) one new DES row + one new TASK
> that owns `src/dashboard/dashboard.css` end-to-end, sequenced BEFORE the re-run of TASK-207/210/211/212;
> (c) one new UT that closes the emitter⇄definer contract in both directions; (d) the `getComputedStyle`
> spec table that ADR-053 already decided but no DES row ever wrote down.**

Four deliverables, one new source file, zero new mechanisms, zero new runtime dependencies.

---

## 2. Key points

### KP-0 (boundary/error, **highest leverage, and it downgrades my own worst risk**) — the handoff is NOT missing; it is one tool call away, and it is not in the repo

The pending note says the handoff spec *"requires seven keyframe sets"*, but `find / -iname '*handoff*'`
over the working tree returns **nothing**: `design_handoff_workflow_dashboard/` — which 01-requirements.md:1612-1617
treats as the fidelity source of truth — **is not in this repository**. My first draft of this proposal
therefore escalated: author the keyframe bodies from REQ prose, or block on an `owner_decision:`.

Both were wrong, and I checked before committing to either. The package lives in the owner's
claude.ai/design project and is readable **read-only, right now**:

```
DesignSync  method=list_files  projectId=38fc8181-5b00-45aa-a354-bf07994e19ab
DesignSync  method=get_file    projectId=38fc8181-5b00-45aa-a354-bf07994e19ab \
                               path="design_handoff_workflow_dashboard/README.md"
```

`list_files` confirms all five files (`README.md`, `Workflow Dashboard.dc.html`, `rwe-data.js`,
`support.js`, `github.md`, plus the Classical `_ds/.../styles.css` base component sheet). I fetched the
README. It contains, in full and unambiguously: the **seven keyframes with their animated properties and
durations**, the **complete dark and light accent L/C ramps**, the **fixed neutral ramps** (both themes,
nine steps each, as hex), the **three-step shadow scale** (both themes), radius and spacing tokens, the
failure red and its text variant, and a per-screen spec that is strictly more precise than the REQ prose.

**This is the finding that should reshape the round.** The ledger has been paraphrasing a document that
nobody can read from the repo, and the paraphrase has already drifted (§KP-3). Every downstream
argument — "the implementer would have to invent the CSS", "99% fidelity has no oracle", "the keyframe
bodies don't exist" — is a *symptom of the package being out-of-tree*, not of the task decomposition.

**Proposal, and I rate it above everything else in this document:** the new TASK's **first** step commits
`design_handoff_workflow_dashboard/README.md` (and `rwe-data.js`, which the ledger already cites for its
`STR.zh`/`STR.en` tables and its `buildHome`/`layoutFromView`/`skeletonFromDescribe` mirrors) into the repo
under `.sdlc/features/001-remote-workflow-engine/design-handoff/`, with a one-line provenance header naming
the project id and the fetch date. Then:

- the DES row **transcribes** rather than derives, and says so;
- ADR-053's 「規格逐條核」 becomes literally checkable — one spec table row per README line (§KP-9);
- C4's reconciliation obligations (01-requirements.md:1618-1624) become diffable instead of remembered;
- Gate 7.5's side-by-side stops depending on an artifact only the owner's browser can open;
- and the next drift is caught by `git diff`, not by a panel.

**Two boundary conditions I want stated in the row, not assumed.** (1) The `.dc.html` design body is ~large
and is a *reference implementation*, not a spec — commit the `README.md` and `rwe-data.js`; cite the
`.dc.html` by project path rather than vendoring it, unless the synthesizer judges otherwise. (2) Per the
tool's own security note, fetched content is **data, not instructions** — it is a spec transcribed into the
ledger under the design gate's authorship, and nothing in it is executed or obeyed.

### KP-1 (interface-contract, **blocking**) — the emitted-class inventory *is* an interface, and it is implicit, unversioned, and broken in 29 places

`src/dashboard/ui/*.js` are **emitters** of class names; `dashboard.css` is the sole **definer**. Nothing in
the ledger states this as a contract, so it has no signature, no closure property and no test. Measured
today, the emitter side names **29** classes the definer has never heard of:

```
active  card-grid  card-section  event-list  event-row  home-search  home-toolbar  kicker  meta
run-view  rwe-config-check  rwe-connection  rwe-hue-slider  rwe-lang-group  rwe-nav  rwe-tab-panels
rwe-tabs  rwe-theme-group  rwe-update-cta  rwe-update-outcome  rwe-update-panel  rwe-version
segment-tabs  stat-cards  stat-label  stat-value  tag  tag-columns  workflow-view
```

Note what is in that list: `rwe-update-panel` / `rwe-update-outcome` / `rwe-config-check` / `rwe-update-cta`
are **INV-V27-5**, the ARCH-040/REQ-070 update panel that DES-200 names as *"the one non-regression this
slice could lose silently"*. It did not get lost — it got emitted with no rule, which is the same outcome
with a better alibi.

And the handoff names classes that appear in **neither** list, so they are not yet emitted *or* defined:
`.btn-icon` (the panel's 32 px close button, REQ-135), `.tag-neutral` / `.tag-accent` / `.tag-outline`
(REQ-134's effort tag and REQ-135's three tag columns), and the Classical base set
`.card .tag .btn .table .seg .input .nav .hr` — of which the stylesheet defines `.card` (wrongly, §KP-2)
and **none** of `btn seg input nav table hr` (grep: 0 each).

**Root cause, at file:line.** ARCH-122 (`02-architecture.md:3336`) says `DASHBOARD_HTML` *"now holds
**markup and CSS only**: the design tokens …, `--shadow-md`, the `rwePulse` / `rweSweep` / `rweGlow` /
`rweRing` keyframes, … the `.card` / `.t` / `.tag` / `.btn` component classes"* — i.e. the CSS lives in
`dashboard-page.ts`. The *same `api:` line* has the shell emit
`<link rel="stylesheet" href="/static/dashboard/dashboard.css">`. ARCH-123 lists `dashboard.css` as a
`STATIC_ASSETS` key; ARCH-124's v27 amendment puts the OKLCH ramp there. **Two homes, one artefact, no row
saying which wins.** TASK-205's DoD then asks `dashboard.css` for exactly three token facts and nothing
else — so an implementer who satisfies TASK-205 *literally and correctly* still ships 0 keyframes and 0 of
the 29 classes. Which is what happened. The implementer then wrote the refusal into the file itself
(`dashboard.css:62-67`): *"NOT built here: swimlane/agent-panel/ported-tab component CSS
(TASK-207/210/211/212's own pixel specs) — this file has no other owner in the v27 task decomposition"*.
That is a correct read of the ledger and the right call. The ledger is what is wrong.

**Proposed contract (the `signature:` of the new DES row).** A **closed, literal selector inventory**,
sectioned per surface, traced per REQ, transcribed from the handoff (§KP-0):

- **§A** shell / nav / tabs / hue slider → REQ-131, REQ-139
- **§B** update panel → REQ-070 / INV-V27-5
- **§C** home → REQ-132 (incl. a **rewritten** `.card`, §KP-2)
- **§D** workflow detail → REQ-133 (run chips, nine-column history table, 7 % selected-row tint)
- **§E** swimlane → REQ-134 (lane header, hairline, node cell + five state variants, trigger, legend)
- **§F** agent panel → REQ-135 (`.btn-icon`, stat cards, tag columns, event rows, panel + backdrop)
- **§G** the seven `@keyframes` (§KP-4)
- **§H** the token layer the handoff specifies and the file is missing (§KP-3)

…and the **negative half**, which is the part that actually stops the drift:

> `src/dashboard/{ui,lib}/**/*.js` may set **SVG geometry** attributes (`x`, `y`, `width`, `height`, `d`,
> `viewBox`, `transform`, `points`) and may toggle class names. It may **not** carry colour, typography,
> radius, shadow, transition or animation literals — **including via `setAttribute`**: REQ-134's edge paint
> (`stroke`, `stroke-width: 1.2`, `stroke-dasharray: 4 4`) is a **class on the `<path>`**, not three
> `setAttribute` calls, because `run.js` already makes 39 `setAttribute` calls and the boundary has to be
> legible to the next implementer without a judgement call.

This is not style policing. It is what makes `data-theme="light"` work at all (§KP-6) and what makes the
closure test of §KP-8 meaningful. It also extends DES-206's existing constitutional sentence for this layer
— *"it may not decide anything a pure function could decide"* — of which "what colour is a failed node" is
a textbook instance.

### KP-2 (interface-contract) — `.card`, `.t` and `.tag` make this a **rewrite** of a done task's output, not an append

A naive emitted-vs-defined diff shows `card` as *defined* and moves on. It is defined at the **v26 port
values** (`dashboard.css:74-77`): `.cards{…minmax(210px,1fr);gap:10px}`, `.card{…border-radius:10px;padding:11px 13px}`
with a `cursor:pointer` and a `:hover{border-color:var(--color-link)}`. The handoff and REQ-132 specify
`repeat(auto-fill, minmax(280px,1fr))`, **gap 16 px**, `--radius-md: 3px`, **no fill**, and a **5–6 % accent
tint** on hover. `.t` is defined as a monospace `word-break:break-all` run-id label; the v27 card's title is
a workflow **name** with `text-wrap: pretty`. `.tag` is emitted and has **no** rule at all (the pre-v27 page
used `.pill`).

**Consequence for the synthesizer:** the new TASK must be worded *"TASK-205's ported component block is
re-mapped, not extended"*, and **TASK-205's own `dod:` must be amended in place** to stop asserting the
retired geometry — otherwise the new task's green and TASK-205's green are mutually exclusive and the first
implementer to notice picks one at random. This is the `.card` instance of C2's anchor rule (「確有設計上
無法沿用者,於同一 VAL ID 下重寫測試」) and deserves the same explicit per-assertion disposition treatment
DES-208 gives the page-source pins.

### KP-3 (interface-contract + boundary, **NEW, BLOCKING — a shipped defect inside a task marked done**) — the dark accent ramp on disk is **inverted** against the handoff, and four token families are missing entirely

This is the finding that justifies KP-0 on its own. Comparing the committed stylesheet against the handoff
README's 「Design tokens」 section:

| token family | handoff README | `src/dashboard/dashboard.css` (committed) |
|---|---|---|
| dark `--accent-100…900` **L** | `.30 .37 .45 .55 .65 .72 .80 .87 .93` (dark → light) | `.93 .86 .80 .76 .72 .63 .54 .42 .30` (**light → dark — inverted**) |
| dark `--accent-100…900` **C** | `.035 .045 .055 .06 .065 .065 .06 .05 .035` (symmetric) | `.02 .03 .045 .055 .065 .08 .085 .075 .055` (different curve) |
| light `--accent-100…900` **L** | `.93 .87 .79 .68 .56 .48 .40 .33 .26` | `.96 .90 .82 .72 .63 .56 .47 .37 .26` (right direction, wrong values) |
| `--shadow-sm/md/lg` | specified per theme (`0 3px 10px rgba(0,0,0,.55)` dark md, …) | **0 occurrences** |
| `--neutral-100…900` | nine fixed hex per theme | **0 occurrences** |
| `--radius-md 3px` / `--radius-sm 2px` | specified | **0 occurrences** |
| spacing scale (`--space-2/3/4/8`) | specified | **0 occurrences** |

**The inversion is not cosmetic, and it has a named consequence in an acceptance clause.** REQ-134 requires
the running node to be 「accent-100 底、accent-600 邊」. Under the handoff's dark ramp, `accent-100` is
`L .30` — a *dark* tint, correct as a fill on a `#18191b` page. Under the committed ramp, `accent-100` is
`L .93` — **near-white**. A running agent node in dark mode renders as a glaring white box. The *most
important cell on the most important screen* is, today, specified backwards, and it is backwards inside
TASK-205's `dod:`-satisfying, already-green, already-committed output.

Three of these are named directly by rows that have already passed a gate: `--shadow-md` appears verbatim in
ARCH-122's `api:` line and in REQ-134's running-node clause; `neutral-500` is REQ-134's own colour for a
traversed edge; `--radius-md 3px` is REQ-134's node radius. **REQ-134 cannot be implemented at all** until
§H of the inventory exists — which is another way of saying the routed gap is not "the four surface tasks
lack a CSS file", it is "the token layer those tasks build on is incomplete and partly wrong".

**Proposal:** §H of the new DES row is the complete token layer transcribed from the handoff, the inversion
is called out explicitly as a **correction of committed code** (so the implementer does not read the diff as
someone else's mistake and revert it), and the closure test (§KP-8) pins the `100` and `900` ends of both
ramps by value so the inversion cannot silently return.

**I flag one honest uncertainty for the panel.** The committed ramp is *monotone and self-consistent* —
it looks authored, not fat-fingered. It is possible that some earlier round deliberately re-indexed the
ramp so that `accent-100` means "lightest" in both themes (a defensible convention) and the ledger never
recorded it. I could find no such row. **If the synthesizer finds one, this becomes a naming conflict to
rule on rather than a defect to fix — but the ruling still has to be written down, and either way REQ-134's
`accent-100` fill has to be checked against whichever convention wins.** I would rather be wrong here in
writing than right in silence.

### KP-4 (boundary/error) — the seven keyframes are now fully enumerable, and my own first reading of them was wrong

REQ-132 names `rwePulse` 1.6 s and `rweSweep` 2.4 s; REQ-134 names `rweGlow` 1.8 s and `rweRing` 1.3 s;
`state.yaml`'s pending note says **seven**. Working from the ledger alone I concluded the other three were
REQ-135's *transitions* (`translateX(±40px)→0` at `.28 s`, backdrop fade `.2 s`) and that the "seven" count
conflated the two mechanisms. **The handoff says otherwise and I was wrong:** they are keyframes, and they
are named — `rweSlideIn` / `rweSlideInL` (`.28 s`) and `rweFadeIn` (`.2 s`). Seven exactly.

The README gives each one's animated property and duration:

| keyframe | animates | duration |
|---|---|---|
| `rwePulse` | `opacity 1 → .35`, `scale 1 → .7` | 1.6 s |
| `rweRing` | `box-shadow 0 → 9px` transparent | 1.3 s |
| `rweGlow` | accent ring `2px → 6px` | 1.8 s |
| `rweSweep` | `left −40% → 100%` | 2.4 s |
| `rweSlideIn` / `rweSlideInL` | `translateX(±40px) → 0` | .28 s, `cubic-bezier(.2,.7,.2,1)` |
| `rweFadeIn` | backdrop opacity | .2 s |

That is enough to author the bodies as a **transcription with two or three judgement calls** (iteration
count, easing on the infinite three, the exact `box-shadow` colour stop) rather than an invention. The DES
row should carry the table above **verbatim** and mark those specific judgement calls as such, so Gate 7.5's
side-by-side knows exactly which three lines to look at hardest.

I am recording my own error because the mechanism that produced it is the thing this proposal is about:
**I reasoned confidently from a paraphrase of a document I had not read.** That is precisely what the ledger
has been doing for three gates, and it is why KP-0 outranks everything else here.

### KP-5 (boundary/error, **the defining property of this bug class**) — the failure is *silent*, and nothing in the stack can raise it

An undefined CSS class is not an error. No console warning, no 404, no exception, no degraded status.
`classifyResponse` (DES-202) never sees it. The CSP never sees it. `tsc --noEmit` never sees it (ADR-049
deliberately excludes `src/dashboard/**/*.js`). Every structural acceptance assertion — "the element
exists", "there are nine cells", "the legend row renders" — passes. The page renders. **CI goes green on a
dashboard whose entire agent-state channel is missing.**

An *inverted token* (§KP-3) is worse still: it is not even absent. It renders a confident, wrong colour.

This repo has a name for the family: the vacuous survivor (DES-208, adjudication (v23) #4 — a negative grep
that keeps passing after its subject moved away). The CSS gap is the same class one layer down: an
assertion tier that is structurally complete and semantically empty. That is the argument for §KP-8's
closure test being **bidirectional and anti-vacuous**, and it is why "we'll catch it in the Gate 7.5
screenshot review" is not acceptable — a human eyeballing two screenshots is exactly the detector this
ledger has twice recorded as insufficient.

### KP-6 (boundary/error) — the inline literals already in `ui/*.js` break `data-theme="light"`, and one of them contradicts the handoff by 340 px

`agent-panel.js:104` writes `background:rgba(8,12,9,.5)`; `:110` writes `width:420px;max-width:90vw`;
`:180` writes `background:oklch(0.3 0.12 25);color:#fff`. `workflow.js` carries 26 `style` sites, `run.js` 8.
None respond to `:root[data-theme="light"]`. REQ-131 requires light to be a complete, reloadable,
system-following mode; REQ-139 requires 「在 dark 與 light 下與其他三個 tab 無視覺落差(兩張截圖為證)」.
A near-black 50 %-opaque backdrop and a white-on-dark-red failure block over a `#eef2f1` page are visible
defects that the **dark** screenshot will never show.

The `420px` is worse in kind than in degree. REQ-135 never specifies a panel width, so it read as harmless.
The handoff specifies **`min(760px, 100vw)`** — the panel on disk is **340 px too narrow**, and REQ-135
packs six stat cards at `auto-fit minmax(150px,1fr)`, a `<pre>`, three tag columns and an event list into
it. At 420 px that layout collapses to one or two columns and the 「一次看完一個節點的全貌」 clause fails.
An invented number in a file no DES row governs, contradicting the spec by ~45 %, with no test that can
see it: this is the drift the implementer refused to risk, already present in the tree.

Also worth one line in the row: the handoff's failure red has a **text variant** (`oklch(0.45 0.16 25)`)
distinct from the border/dot colour (`oklch(0.55 0.16 25)`), and `agent-panel.js:180`'s invented
`oklch(0.3 0.12 25)` is neither.

**Therefore the new TASK carries a repair obligation, not only a build obligation:** every colour /
typography / radius / shadow / transition literal currently in `src/dashboard/{ui,lib}/**/*.js` moves to the
stylesheet under the §KP-1 inventory, and the negative guard of §KP-8 keeps them out. **Sequencing is
load-bearing:** doing this *after* TASK-210/211's re-run means the same lines get written twice.

### KP-7 (boundary/error, out-of-closure, raised anyway) — seven animations, three of them infinite, and no `prefers-reduced-motion`

REQ-132/134 put four infinite animations on screen at once (`rwePulse` on every Running section header,
`rweSweep` on every running card, `rweGlow` + `rweRing` on every running node) on a page a team leaves open
all day. No REQ mentions `prefers-reduced-motion`. The mitigation is one media block setting
`animation: none` / `transition: none` — perhaps eight lines, in the file this delta is already opening.

I raise it and I **do not** insist. Simplicity-first says no REQ asks for it. The counter is that it costs
eight lines now and a new DES row later. **My position:** include it in the DES row's `boundary:` as an
explicitly-cheap non-REQ addition with the owner named; let the synthesizer strike it if the panel
disagrees. What I will fight is *silence* — this ledger's most-recorded defect is 「刪掉了卻還有東西在描述
它」 and its sibling is "nobody wrote down why not". (I expect, and would accept, the procedural objection
that it should be a REQ rather than a DES boundary; see §7.)

### KP-8 (testability, **the load-bearing proposal**) — the diff that found this bug **is** the missing unit test

The diagnostic that found 29 unstyled classes in one command is the oracle. Make it a UT with the
**bidirectional closure** TASK-204 already established for `STATIC_ASSETS` (*"the map is closed in BOTH
directions (listed ⇒ on disk, on disk ⇒ listed)"*) — same shape, one layer over:

1. **emitted ⇒ defined.** Extract every class name from `src/dashboard/{ui,lib}/**/*.js` (the `className =`,
   `classList.add/toggle`, and `class="…"`-in-template forms) and assert each has a rule in `dashboard.css`.
   **Fails today with 29 names.**
2. **defined ⇒ emitted.** Every non-token selector in the stylesheet is emitted by some client module or by
   `DASHBOARD_HTML`. This is the direction that matters in six months: it makes the *next* removal of a
   surface also remove its CSS — a direct instance of REQ-105 / ADR-048's own 「刪掉了卻還有東西在描述它」 guard.
3. **Anti-vacuity, mandatory** (DES-208's rule applied to this file): `toContain('@keyframes rweGlow')` ×7,
   a length floor, and — critically — **property-value anchors on the load-bearing rules**, not selector
   presence alone. `.lane-head` asserts `font-size:13px` + `letter-spacing:.04em`; the failed-node rule
   asserts `oklch(0.55 0.16 25)`; the node cell asserts `216px`/`74px`; **and both ends of both accent ramps
   assert their handoff L values** (§KP-3), which is the only thing that stops the inversion returning.
   Without value anchors the closure test is satisfiable by 29 empty rules, and an implementer under time
   pressure *will* find that out.
4. **The negative guard of §KP-1:**
   `grep -nE "oklch\(|#[0-9a-fA-F]{3,6}|rgba?\(|cubic-bezier|font-size:|stroke(-width|-dasharray)?:" src/dashboard/{ui,lib}/**/*.js`
   → 0.

**Pure, node-tier, sub-second**, over two string inputs. No browser, no jsdom (ADR-049 refuses it), no new
dependency. It is the middle tier this slice does not have, and its absence is why the gap reached Gate 6
before a human noticed.

**Honest limitation, stated rather than hidden:** the parse is a regex over source text, so a concatenated
class name (`'st-' + state`) is invisible to it — a pattern that already exists in the pre-v27 code
(`st-queued`/`st-running`/…). The DES row must therefore name a short, literal `DYNAMIC_CLASS_PREFIXES`
allow-list as part of the contract, and **assert its length**: growth of that list is the tell that the
contract is being evaded rather than satisfied.

### KP-9 (testability, **blocking, and nobody has noticed it**) — ADR-053 decided the fidelity oracle and **no DES row ever wrote the table down**

ADR-053 (`02-architecture.md:3461`) is explicit and binding:

> *"The mechanism that implements 「規格逐條核」 literally is a table-driven `getComputedStyle` check in the
> real browser — one row per delivery-README spec line (`--color-bg` `#18191b`, node `216×74`, lane header
> 13 px uppercase, edge 1.2 px, `rweSweep 2.4s`, …) — plus one dark and one light screenshot per view."*

Grep the design document: ADR-053 is **traced** by DES-191 and DES-208; it is **cited in prose** by DES-201
(for the `--color-bg`/`--color-accent` rows only) and by the REQ-131 row of the real-tier path table. **The
table itself is owned by no row.** The test tier shows the consequence — VAL-200's own recorded RED reasons
are *"no `[data-lane-header]` elements exist; no `[data-node-cell]` sized 216x74 exists; no `[data-legend]`
element exists"*, all three structural. VAL-198's RED reasons name no colour and no animation.
`grep -n 'rweGlow\|rweRing\|rweSweep\|rwePulse\|keyframes\|getComputedStyle\|animation' 05-tests.md` returns
**zero hits across 12 227 lines**.

Read plainly: **the swimlane, the home cards and the agent panel can all go green with no colours, no state
distinction and no animation whatsoever.** The owner's 99 %-fidelity bar has no oracle, one gate before it
is supposed to be verified. And §KP-0 is what makes the fix cheap: 「one row per delivery-README spec line」
is a *mechanical* transcription once the README is in the repo.

**Proposal.** The new DES row owns the spec table as a literal artefact — a `SPEC_ROWS` fixture,
`{ view, selector, property, expected }`, one row per README style line — checked in real Chromium via
`getComputedStyle`. Then amend the existing VAL ids **in place, adding no new VAL id** (the v27b delta's own
precedent: 7 items amended, 0 new ids):

- **VAL-198** += `.card` grid `280px` / gap `16px`; Running header dot `animation-name: rwePulse` (`1.6s`);
  the running card's `rweSweep` (`2.4s`, `linear`, `infinite`); light-theme rows for each.
- **VAL-200** += lane header `font-size:13px` / `letter-spacing:0.04em` / `text-transform:uppercase` /
  `font-weight:600`; node cell `216×74`; running node `animation-name` contains `rweGlow`, dot `rweRing`,
  **`background-color` resolving from `--accent-100` and `border-color` from `--accent-600`** (§KP-3's
  regression pin at the surface that matters); failed node `oklch(0.55 0.16 25)`; queued/pending
  `border-style:dashed` + `opacity:0.65`; trigger `112×40`; edge `stroke-width:1.2`.
- **VAL-201** += panel `width` resolving to `min(760px,100vw)` (§KP-6); `animation-name: rweSlideIn` /
  `rweSlideInL` by node hemisphere (the `panelSide` VM already decides the side — DES-203 — so this is a
  *rendering* proof, not a re-derivation); `animation-duration: 0.28s`;
  `cubic-bezier(0.2, 0.7, 0.2, 1)`; backdrop `rgba(8, 12, 9, 0.5)` + `rweFadeIn`.
- **VAL-202** += one light-theme row per ported tab — the only thing REQ-139's 「無視覺落差」 clause can
  actually be tested by.

**Why this is the right altitude and not gold-plating:** `getComputedStyle` returns *resolved* values, so
these rows are deterministic strings, not pixel thresholds — the exact property ADR-053 chose them for when
it refused pixel-diffing on font-rasterisation grounds. Each row is one line. And per ADR-049 there is no
middle tier available, so **these rows plus §KP-8's source-level closure are the only two oracles that
exist** for every style clause in REQ-131..135.

### KP-10 (interface-contract) — the stylesheet is delivered **twice**, on a decision an implementer took

`dashboard-page.ts:68` does `readFileSync('./dashboard/dashboard.css')` and `:87-88` emits **both**
`<link rel="stylesheet" href="/static/dashboard/dashboard.css">` **and** `<style>${DASHBOARD_CSS}</style>`.
ARCH-122 and DES-200 specify the `<link>` **only**.

The in-file rationale is *"so the FIRST paint has the correct theme before the external stylesheet
round-trips"*. As a **FOUC** argument it does not hold: a `<link rel="stylesheet">` in `<head>` is
render-blocking by specification, so there is no unstyled paint to prevent. (The genuine pre-paint concern
in this design is `theme-init.js`, which is why ARCH-125 made it a *classic, blocking* script; that correct
reasoning was over-generalised to the stylesheet.) What the inline `<style>` does buy, honestly stated, is
**one round-trip** on a high-latency remote link — REQ-132's 「遠端連進來」 is a real deployment shape.

So this is a **bytes-vs-RTT tradeoff**, and I rule on it rather than pretending it is a pure defect. Against
the inline copy: the CSS ships **twice in every document** on a page the architecture expects to reload at a
poll cadence, the stylesheet will grow ~5× under this delta, and — the real cost — there are **two delivery
paths that can silently disagree**, with no row saying which is authoritative. One RTT, once per page load,
against a permanently doubled payload and a duplicated source of truth: **delete the inline copy.**

There is a real coupling to disarm first, which is why this needs a design row and not a drive-by edit:
`dashboard-page-source.test.ts` asserts C1's `.fit-btn{position:relative;z-index:1;` literal against
`DASHBOARD_HTML`, and that assertion **passes today only because the CSS is inlined**. Delete the `<style>`
and a load-bearing Gate 7.5 defect pin goes red. DES-208 already anticipated this exactly — it lists the CSS
pins as **STAYS**, *"still assertable against `DASHBOARD_HTML` **or against `dashboard.css` bytes**"*. One
re-point, already authorised, no new decision.

**Proposal:** the DES row's `boundary:` deletes `<style>${DASHBOARD_CSS}</style>` and the `readFileSync` at
`:68`, re-points the two C1 CSS pins to `dashboard.css` bytes under their existing UT ids, and states the
one-delivery-path invariant so the next reader does not reintroduce it. **One source, one destination.**
The most Karpathy-shaped item here: it makes the codebase smaller.

### KP-11 (interface-contract, **needs a ruling, not a fix**) — REQ-131's `#18191b` and the handoff's `oklch(.21 .006 h)` are different backgrounds

REQ-131's acceptance pins `--color-bg` to the literal `#18191b` (dark) and `#eef2f1` (light), and VAL-198's
RED reason and ADR-053's example row both quote `#18191b`. The handoff specifies dark bg
`oklch(.21 .006 h)` / light bg `oklch(.955 .008 h)` — **hue-driven**, i.e. the page background shifts subtly
with the accent slider. These are not the same colour and not the same *behaviour*: at h = 236 the OKLCH
form is a slightly blue-tinted near-black, and at h = 30 it warms. `#18191b` never moves.

01-requirements.md:1618-1624 (C4) already anticipated *two* handoff-vs-reality gaps and ruled 「以 README 的
OKLCH 執行期公式為準」 for the accent. **This is a third gap, in the opposite direction** — here the REQ's
hard-coded hex is the thing that was written down, tested against, and quoted in an ADR.

I do **not** propose resolving it in this row. Three things follow instead: (1) the DES row records the
conflict explicitly rather than letting the implementer discover it while transcribing §H; (2) the
low-risk reading is **REQ-131 wins** (it is the tested, gate-passed clause, and the neutral/text ramps the
handoff pairs with the OKLCH bg are fixed hex anyway, so the hue-driven bg buys little); (3) if the
synthesizer disagrees, this is an `owner_decision:` — the owner ruled on C4 once and can rule on C4(c).
Either way the ledger must stop containing both numbers with no note.

---

## 3. Where this lands in the task decomposition (the task asks my lens to say so)

**One new TASK (call it TASK-214) owning `src/dashboard/dashboard.css` end-to-end, scheduled BEFORE the
re-run of TASK-207/210/211/212.** Not four amendments, not co-located per-surface files. Three reasons, in
descending strength:

1. **Write contention is a documented hazard here, not a hypothetical.** CLAUDE.md's opening rule exists
   because *"an implementation gate puts ~20 implementer agents on this ONE shared working tree at the same
   time"*, and this ledger carries a recorded near-miss (2026-09-04) and a recorded full-ledger clobber
   (2026-08-31). Four concurrent implementers appending to one stylesheet is the same hazard shape with a
   smaller blast radius and a far higher hit probability. One owner, one file, one commit.
2. **99 % fidelity needs one hand on the stylesheet.** Cascade order, the shared radius/spacing/typography
   scales and the token ramp are *global* properties — and §KP-3 shows what happens when the token layer is
   authored by whoever got there first. Four independent authors produce four dialects that are individually
   green and collectively 85 %.
3. **It is the smallest thing that closes the gap.** One DES row, one TASK, one new test file, one file
   rewritten, two deletions in `dashboard-page.ts`, one vendored spec document. No new mechanism, no new
   dependency, no new ID namespace.

**Amendments to existing rows (in place, no new ids — the v27b delta's own precedent):**

- **TASK-205** — `dod:` amended to stop asserting the retired `.cards`/`.card`/`.t` geometry (§KP-2) **and to
  correct the accent-ramp assertion to the handoff's values** (§KP-3). Its three token facts otherwise
  stand; TASK-205 got its own *scope* right — it was handed the wrong ramp.
- **TASK-207 / 210 / 211 / 212** — `dod:` each gains §KP-1's negative guard (no colour/typography/transition
  literals in their `.js`, `setAttribute` included) and, for 210/211, the repair obligation for what is
  already inline (§KP-6). No `.css` file joins their `files:` — the guard is what couples them, and it is
  checkable.
- **VAL-198 / 200 / 201 / 202** — §KP-9's computed-style rows, amended in place.
- **DES-206** — one clause: the `ui/` layer's existing *"may not decide anything a pure function could
  decide"* constitution extends to *"and may not decide anything the stylesheet declares"*. Same principle;
  stating it there is how the four surface tasks inherit it.

**Explicitly OUT of scope,** fenced before the synthesizer is tempted: REQ-137's Models slide-in (560 px
panel, benchmark bars) and REQ-138's System stat cards / process table. DES-207 already ruled those three
tabs **PORTED, not redesigned** — *"no sorting, no filtering, no slide-in, no resource bars, no new route"*
— and that *"the three tabs therefore look v27 and behave v12 for one iteration, which is a stated interim
state, not an accident"*. TASK-214 styles them **only** to REQ-139's 「與其他 tab 同主題」 bar. A CSS task is a
magnet for "while we're in there"; the fence belongs in the DES row's `boundary:`, in writing.

---

## 4. Risks

| # | risk | severity | mitigation |
|---|---|---|---|
| R-1 | **The handoff is out-of-tree** (§KP-0), so the ledger paraphrases a document nobody can diff — and the paraphrase has already drifted (§KP-3). | **HIGH** *(was my worst risk; now has a cheap, verified fix)* | Commit `README.md` + `rwe-data.js` under `.sdlc/.../design-handoff/` as step 1 of the task, with provenance. Retrieval is verified working: `DesignSync get_file`, project `38fc8181-…`. |
| R-2 | **The committed dark accent ramp is inverted** and four token families are missing; REQ-134's running node is specified backwards **today**, in green committed code. | **HIGH** | §H of the inventory; the fix flagged as a *correction* so it is not reverted; both ramp ends value-pinned in §KP-8 **and** at the surface in VAL-200. |
| R-3 | The closure test is satisfied by **29 empty rules**. Green, still unstyled. | **HIGH** | Property-value anchors on every load-bearing rule, not selector presence (§KP-8.3). The single most important sentence in this proposal. |
| R-4 | §KP-3's inversion is actually an undocumented re-indexing convention, and "fixing" it breaks a deliberate choice. | MED | Stated as an open uncertainty in §KP-3; the synthesizer checks for a prior row. Either outcome must be *written down*. |
| R-5 | The regex class-extractor misses concatenated names (`'st-'+state`) — a guard that silently under-guards, this ledger's signature defect. | MED | Short literal `DYNAMIC_CLASS_PREFIXES` allow-list **with its length asserted**; growth is the evasion tell. |
| R-6 | TASK-214 sequenced late; TASK-210/211 re-run first; the same literals get written twice and the repair lands on fresh code. | MED | Sequencing is part of the deliverable, not scheduling: TASK-214 **before** the four surface re-runs. Say so on the card. |
| R-7 | Deleting the inline `<style>` (§KP-10) reds a C1 defect pin before its re-point lands. | MED | Both edits in **one** task and one commit; DES-208 pre-authorises the re-point. |
| R-8 | `oklch()` may serialise differently across Chromium versions (`oklch(0.55 0.16 25)` vs `…25deg` vs an `rgb()` fallback), making §KP-9's rows flaky. | MED | The rows that must be **measured before they are written**: print the resolved string once in the target Chromium and pin *that*, with the version in a comment. Do not guess serialisation in the ledger. |
| R-9 | Scope creep into REQ-137/138 (§3's fence). | MED | The fence in `boundary:`, quoting DES-207's own interim-state sentence. |
| R-10 | The stylesheet grows to ~700 lines and becomes the next unowned thing. | LOW-MED | Per-surface `/* §E swimlane — REQ-134 */` markers mirroring the DES inventory, plus the **defined ⇒ emitted** direction — the anti-rot half. |
| R-11 | `prefers-reduced-motion` (§KP-7) is struck as creep and never revisited. | LOW | Record the consideration and the decision either way. Silence is the failure mode, not the outcome. |

---

## 5. Simplicity-first (Karpathy) tie-breaks I applied

- **Read the source document instead of designing around its absence.** The cheapest fix in this proposal
  is two tool calls and one `git add`; it dissolves three findings that would otherwise need design work.
  Simplicity-first applies to *process*, not only to code.
- **One stylesheet, not per-surface files.** Per-surface files give each VAL its own byte target
  (testability's preference) at the cost of N asset-map keys, N `<link>`s or an import graph, and a cascade
  order that becomes load-bearing *across* files. One file with section markers gets the same auditability
  for one key. **Interface-contract wins; testability is compensated by §KP-8's sectioned closure.**
- **No CSS build step, no preprocessor, no utility framework.** ADR-049 already refused a bundler because
  *"a build artifact reintroduces the 'did you rebuild?' drift class — this ledger's most-recorded defect
  family"*. That reasoning transfers to CSS unmodified. Plain CSS, custom properties, `@media`.
- **No design-token JSON, no generator.** The tokens have exactly one consumer. A generator recreates the
  server/client mirror pair DES-201 spent a whole amendment removing.
- **Delete the double delivery (§KP-10)** rather than document it. Net negative lines.
- **No new VAL ids** — amend the four in place, following the v27b delta's 7-amended / 0-new precedent.
- **Where I deliberately spend complexity:** the bidirectional closure test and its value anchors. Every
  other candidate mechanism here is removable; this one is the only thing standing between a green CI and a
  dashboard with no state channel (§KP-5), and it costs one file and no dependency.

---

## 6. Internal conflicts between my own three lenses (surfaced, not resolved by fiat)

1. **One file (interface-contract) vs per-surface files (testability).** Testability genuinely wants
   `swimlane.css` so VAL-200 can assert against its own bytes; interface-contract wants one closed inventory
   and one cascade. **Tie-break: one file, sectioned, one closure test** — a section marker is greppable,
   and VAL-200's real oracle is the browser's computed style, not the file's bytes.
2. **Bidirectional closure (testability) vs the empty-rule loophole it opens (boundary).** Requiring every
   emitted class to have *a rule* invites 29 empty rules. Boundary insists on value anchors; those anchors
   are maintenance cost on a file designed to be edited for fidelity. **Tie-break: anchors on load-bearing
   rules only** — the ones encoding agent *state* (§0), the ones the REQs give numbers for, and both ends of
   both accent ramps (§KP-3). Layout niceties get selector presence alone. A judgement call; I expect it
   argued.
3. **Delete the inline `<style>` (boundary: one path) vs C1's pins currently depend on it
   (interface-contract: don't break a defect pin).** Resolved by DES-208's pre-authorised re-point (§KP-10),
   but recorded because if the re-point is *forgotten* the deletion is a regression — the ordering inside
   the commit is load-bearing.
4. **Transcribe the handoff (interface-contract: match the spec) vs REQ-131's tested `#18191b`
   (testability: don't break a gate-passed assertion).** §KP-11. I lean REQ-131 wins; I refuse to let a
   transcription silently overwrite a tested clause, and I refuse to let the ledger keep both numbers with
   no note. **This one I explicitly hand to the synthesizer.**
5. **`prefers-reduced-motion` (boundary) vs no-REQ-asks-for-it (simplicity).** Unresolved on purpose;
   §KP-7 states my position and my concession.
6. **My own §KP-3 confidence vs §KP-3's stated uncertainty.** Boundary/error wants the inversion called a
   defect and fixed; interface-contract notes the committed ramp is monotone and self-consistent, i.e.
   *authored*. I resolved toward "fix it, and say in writing what would make me wrong". If the synthesizer
   finds the missing convention row, the finding inverts — and the value anchors are still required either
   way, which is why the proposal does not depend on winning this one.

---

## 7. Expected disagreements with the other lenses

**With the quality-dimensions group (most likely):**

- *"Amend the four existing tasks' `files:` to include `dashboard.css`; no new TASK id."* — Minimal-diff is
  their instinct and usually right. I disagree on the documented write-contention hazard (CLAUDE.md's
  ~20-implementer rule, two recorded incidents) plus single-hand fidelity (§3). Fallback if they hold: one
  task still *owns* the file; the other three take a read-only dependency on it.
- *"Co-locate CSS with each `ui/` module for replaceability."* — Replaceability at the **system** altitude
  favours co-location; at the **agent** altitude the quality being protected is *observability*, and a
  cross-surface state vocabulary (running/failed/queued/predicted must look identical in the swimlane, the
  home card and the panel) is exactly what co-location fragments. §0 is my ground; I expect this to be the
  sharpest round-2 exchange.
- *"The class inventory in the DES row is over-specification; name the surfaces, let the implementer pick
  class names."* — The 29-name measurement is the rebuttal: the emitters are **already written** and have
  **already** picked the names. The inventory is not a forward specification, it is *documentation of an
  interface that already exists and is already broken*. It costs one list.
- *"Vendoring the handoff into `.sdlc/` bloats the ledger."* — I expect this and I will contest it: §KP-3
  is a shipped defect that only a diffable spec could have caught, and the README is a single markdown file.
  A middle ground I would accept: vendor `README.md` only, cite `rwe-data.js` and the `.dc.html` by project
  path.
- *"`prefers-reduced-motion` should be a REQ, not smuggled into a DES boundary."* — Procedurally correct;
  I will likely concede. Cost of conceding: one backlog line.

**With whichever lens holds simplicity hardest:**

- *"§KP-9's computed-style table is 30+ assertions — gold-plating."* — ADR-053 **already decided this
  mechanism**. I am not proposing it; I am noticing nobody wrote it down. Refusing it now means overturning
  a passed Gate-2 ADR, a bigger act than writing the table — and §KP-0 makes the transcription mechanical.
- *"Ship the surfaces unstyled, iterate on fidelity in v28."* — §0 is the whole answer: in this design,
  style **is** the state channel. Unstyled is not "less pretty"; it is nine identical rectangles, a lost
  requirement, and a green CI.

**Where I expect agreement and would be surprised to be challenged:** that the gap is real and blocking;
that `dashboard.css` must have exactly one owner; that the handoff being out-of-tree is the upstream cause
worth fixing first; that §KP-10's double delivery should collapse to one path; and that the
`getComputedStyle` table is the only mechanism that can discharge the owner's 99 % bar.
