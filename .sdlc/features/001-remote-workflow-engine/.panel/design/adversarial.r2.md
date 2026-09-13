---
stage: design (Gate 3/4), v27 Gate 8 RE-REVIEW #4 send-back — the design half, **BF-8**.
lens: adversarial group — (a) interface-contract · (b) boundary/error · (c) testability, Karpathy simplicity-first as the tie-break.
round: 2 — written AFTER reading `quality-dimensions.r1.md` (276 lines, this round's file, mtime 17:42) in full, and my own `adversarial.r1.md` (230 lines, mtime 17:44).
head: `2a738bd`; `src/` and `tests/` clean. Every `file:line` and count in this file was opened or grepped by me at that sha on 2026-09-14 — including the refs I could have carried from the two r1s; the commands sit inline at the point of use, not in an appendix.
verified_this_round (opened or grepped, not inherited): `ui/app.js:65-80, 372-388, 420-434, 452`; `ui/home.js:145-165, 198-235`; `ui/run.js:192-235, 300-320, 345-380, 465-520`; `ui/workflow.js:60-76, 310-375`; `ui/system.js:60-95`; `ui/models.js:50-60`; `ui/issues.js:76-84, 98-108`; `ui/agent-panel.js:228-250`; `lib/connection.js:35-50`; `lib/strings.js:33-34`; `tests/acceptance/val-198-shell-and-home.test.ts:262`, `val-199:265-300`, `val-200:215`, `val-202:125-170`, `val-193:114-144`; `tests/helpers/client-corpus.ts:25-33`; `tests/fixtures/dashboard-classes.ts:26-30`; `tests/unit/dashboard-diagram-render.test.ts:110-118`; `src/server.ts:590-598`; `07-review.md:278-391` (§8 whole); `04-design.md:7284-7286`; `01-requirements.md:1872-1876`. Executed: `classifyResponse(200,{degraded:null})` → `degraded`; `t('zh'|'en','unavailable')` → `undefined`; the four greps quoted in §1/§4/§5.
supersedes_on_disk: TWO files, and I name both so this is not read as a silent rewrite. (1) the committed v27l round-2 file — `git show 24797c5:.sdlc/features/001-remote-workflow-engine/.panel/design/adversarial.r2.md`. (2) an **uncommitted earlier draft of THIS round's r2** (mtime 2026-09-13 17:54) that was on disk when I started. I re-derived it rather than trusting it and it was wrong in five places, all corrected here and flagged at the point of correction: **§R4 was cited three times and had no body**; `renderLegend`'s `replaceChildren` is `run.js:354`, not `:353`; `val-199`'s `not.toContain('undefined')` assertions are `:282`/`:297`, not `:280`/`:296`, and its title line is `:272`, not `:271`; **its proposed remedy `expect(after?.textContent).toBe(before)` is broken** — `page.$()` returns an ElementHandle with no `textContent` property, so that assertion is red on every path (§R5); and 「split the element」 was offered as the remedy for five sites when it reaches only three (§R2). Read history with `git show` — never `checkout` / `restore` / `stash` (CLAUDE.md).
touched: this file only. `04-design.md`, `03-tasks.md`, `src/`, `tests/` untouched by me.
position_changes_from_my_r1: **three, all against me** — §R2 (`run.js:512` is NOT exempt; my r1 was internally inconsistent), §R2b (my 「split the element」 does not reach `run.js:502`/`workflow.js:327`), §M1 (my r1's tripwire measurement was wrong about comment lines).
---

# Adversarial — round 2: we converge on almost the whole rule. Three forks left, one of QD's 「clean」 sites is falsified at file:line, and the review itself uses a term no row defines.

## §0 Where we ended up

QD's r1 and mine are the same rule written twice. Both: a positive rule on DES-206 keyed on the
classifier's verdict; KEEP on a tick with the subject unchanged; clear + ONE Unavailable component on
a first paint or a subject change; no view-constructed payload; one string key in both languages; no
`okBody` helper; no seam change; no new DES/TASK id; no ARCH edit; DES-205 inherits; the ported tabs
disclosed as LOW debt rather than carved out. I concede QD's better wording in eleven places and my
own r1 in three.

**What is left: one hard rebuttal, one gap the review itself left, and three forks the synthesizer must pick:**

1. **QD's 「`home.js` is fully conforming today and the clause must keep it so」 is false** (§R1).
   It is the one error in either r1 that would ship a silently-false clause on the product's primary
   page. Falsified at `file:line`. It also exposes something bigger than a severity call: **the review's
   own BF-7 branch (a) turns on 「`state.selectedRunId` unchanged since the last successful paint」 —
   paint memory — and NO row in the tree defines what sets it.** That is a gap the review left, not a
   quarrel with QD, and the clause must close it or BF-7's implementer invents the definition.
2. **The composed-element remedy** (§R2): split the element (mine) vs cache the last-known body (QD's
   `state.lastView`). I concede first that my r1 wrongly ratified `run.js:512`, and second that **split
   reaches three of the five sites and not the other two** — for `run.js:502` / `workflow.js:327` the
   honest comparison is skip-the-composite vs QD's cache, and that is where QD's remedy is strongest.
3. **QD's 「an `ok` result ALWAYS repaints」 as an absolute** (§R3) — BF-7's own mandated guard
   violates it.
4. **The interim predicate's wording** (§R4 — the section the earlier draft of this file cited three
   times and never wrote). Measured, QD's own wording marks QD's own three 「clean」 sites
   non-conforming; mine does not. This is the fork with a decisive measurement.

Everything else is rebut/concede/hold in §1, then the merged rule (§3), the merged disclosure table
(§4) and the merged `tests:` line (§5).

---

## §1 Responses to `quality-dimensions.r1.md`, in its own order

Their risk rows are written `QD-R1`…`QD-R6` here so they are never confused with my section numbers
`§R1`…`§R5`.

| # | QD's claim | my call | reason (measured this round) |
|---|---|---|---|
| QD ¶1.4 | 「One view is fully conforming today and the clause must keep it so: `home.js:226-231` … `render()` paints from the `#rwe-init` island (`home.js:205`), so its first tick is never a first paint.」 | **REBUT — falsified** | §R1. `app.js:429` first-paints `renderHome(workflowsPanel, { cards: [], lang: prefs.lang }, handlers)`. `readIsland()` (`app.js:71-72`) is consumed at **`app.js:452` only**, for the update panel (`grep -rn "readIsland\|rwe-init" src/dashboard/` → `app.js:2,71,72,452`, `lib/status.js:3`, `dashboard-page.ts:153`). No island feeds home cards. |
| QD ¶2, key_point 3 | 「no DOM write at all」 is over-broad — `app.js:383-386` and `workflow.js:369` write from `ok` routes on the same tick | **CONCEDE (substance), HOLD (wording)** | Correct, and measured: `workflow.js:369` is `renderChipsAndTable(...)`, fed by the `ok` `describe`/`/api/runs`, and it runs before `paintSelected` at `:370`. My r1's (K) already scopes it — 「no DOM write **derived from the non-`ok` resource**」 — and that phrase does the whole job without minting 「region」 as rule vocabulary. I adopt QD's route→region enumeration as **table B, non-normative** (§3). |
| QD ¶1.3 | `run.js:512`'s `null` erases `.run-summary`; the clause must not exempt it | **CONCEDE — against my own r1** | §R2. `renderLegend` runs `legendEl.replaceChildren()` at **`run.js:354`** (the earlier draft of this file said `:353` — wrong) and `if (!view) return` at `:360`. My r1 called `:512` 「the (O) omission form and correct」 while my own (O) text forbade omitting 「a count, a total, a state word or a money figure」 — and `.run-summary` is `view.status` + nodeCount + tok + cost (`run.js:367`), all four. QD is right; my r1 was internally inconsistent. |
| QD row 4 / `state.lastView` | feed the paint function the LAST-KNOWN body of the non-`ok` route | **REBUT (remedy) for the legend · CONCEDE (the problem) · CONCEDE (QD's remedy is the stronger one at two sites)** | §R2. A remembered body handed to a paint function **in the slot of this tick's value** is (N) aged instead of invented. But my 「split」 reaches `run.js:512`/`:513`/`workflow.js:329` only — **not** `run.js:502`/`workflow.js:327`, where row 2 lives inside each cell and `paintSwimlane` `replaceChildren()`s the svg and the cell layer (`run.js:219`/`:222`), so there is no subtree to leave unwritten. §R2b states the real fork there. |
| QD row 3 | 「an `ok` result ALWAYS repaints」 | **REBUT as an absolute** | §R3. BF-7's mandated branch (a) — 「bail before any DOM write … placed ahead of `:328`」 — means a degraded `/dag` with an `ok` `/api/runs/:id` does **not** repaint the `ok`-sourced summary. A design clause that contradicts the impl row it specifies is the BF-3 class. |
| QD ¶2.1 / QD-R3 | the interim predicate: the classifier's own predicate on the body, shape check 「permitted as a fail-closed ADDITION, never as the sole test」 | **HOLD — and QD's wording is falsified on QD's own three sites** | §R4. `classifyResponse`'s predicate is `'degraded' in body` — **presence** (`connection.js:48`). All three `bodies`-fed sites test `body.degraded` — **truthiness** (`home.js:231`, `run.js:475`, `workflow.js:357`). Measured: `classifyResponse(200,{degraded:null})` → `degraded`, while `({degraded:null}).degraded` → `null`, falsy. What actually keeps those three sites fail-closed is the **positive shape test**, which is my form. |
| QD ¶1.4 / QD-R4, ported tabs | not admissible; `system.js:78-79`, `models.js:55-56`, `issues.js:101-104` are LOW debt, no DES-207 carve-out, BF-4 stays closed, fix = a `painted` flag | **CONCEDE — we already agreed** | My r1 said 「the rule does **not** carve an exception for them」 and rated them LOW. QD's word 「disclosed」 is better than my 「declared DEVIATION」 (which reads as a granted exception) and I adopt it. **Verified QD's fix shape is safe:** `val-202`'s interception is installed at `:137`, **before** `goto` at `:145`, so `system.js` never has a successful paint in that case and a `painted` flag leaves the assertion at `:154` green. |
| QD ¶3.2 / key_point 7 | `t('zh','unavailable')` is `undefined`; the key must land in BOTH languages in the same commit | **CONCEDE + adopt** | Re-measured: `zh: undefined`, `en: undefined`; `t()` is `STR[lang][key]` with no fallback (`strings.js:33-34`). A one-language key renders the literal string `undefined` under a test that asserts `.empty` exists — the BF-5/BF-6 class **inside the repair for it**. The sharpest catch in QD's file; my r1 missed it. We already agreed the zh value is `'無法取樣'` (QD from REQ-138 `01-requirements.md:1874`, me from `val-202:154`'s `toContain('無法取樣')` — same string, two independent reasons). |
| QD ¶1.2 / key_point 8 | the marker-literal count is **four** families | **CONCEDE — my r1 said five** | Measured: `system.js:29` (zh-only), `models.js:56` (en-only), `app.js:198`, `app.js:414`. My r1 counted `issues.js:103-104` as a fifth; it is not — it renders the **wire's** `degraded` value, which is (S)'s second clause, a different question. QD's categorisation is correct. |
| QD ¶1.5 | DES-205's inherited clause: `panelModel` not called; header label/id only; no tags, no stat cards, no system-prompt sentence, no count tags; the ONE component; the `error` text in the red block via `textContent` | **CONCEDE + adopt QD's text** | More concrete than my r1's one-sentence inheritance and right about the failure mode. Confirmed at HEAD: `agent-panel.js:234` `const body = res.body || {}`, `:238` `body.record || { …, tokens: { input: 0, output: 0 } }` — `res.status` is never read. FIX stays `QD-O5` debt; CLAUSE lands now. |
| QD ¶3.3 | one sentence on DES-207: 「section」 is not 「route」 | **CONCEDE + adopt** | It is the sentence that scoped BF-4 wrong — `system.js:74`'s `!res.body` was written by someone reading a row about per-field `{reason}` sections. Eleven words against a repeat. |
| QD-R5 | 「clear the region's CHILDREN, never the anchors」 (`#dag-fit`, `#dag-graph`, `#dag-zoom` are asserted by val-193/197) | **CONCEDE + adopt verbatim** | A real boundary condition my r1 missed: a (U) arm written as 「clear the surface」 would regress REQ-129's real-tier locks. Belongs in the rule text, not in a risks list. |
| QD ¶5 「where task-splitting affects this lens」 | when the disclosed sites are dispatched: **ONE task whose DoD is the greps reaching their expected counts**, split by LANE (DES-206 sweep / DES-205 panel), never by site | **CONCEDE — the best process point in either file** | 「the repair scope must be the grep, not the line」 is exactly why six sites survived by letter across six rounds. BF-8 forbids minting a task id this round, so this lands as a recorded recommendation for the next dispatch, not a row. |
| QD ¶2.2 (`okBody`), ¶2.1 (seam `D3-5` out of scope), ARCH-125 pointer-not-copy, no new ids, P2's exemption for `predictedPayload(describe)` | **CONCEDE / already agreed** | Identical positions reached independently. Nothing to argue. |
| QD ¶4.3 / `D3-4` | (K) makes `app.js:386`'s footer stamp knowingly false; say so in a clause rather than pretend | **CONCEDE** | My r1 recorded A-9 and declined a remedy. QD's framing is better: the clause should *acknowledge* that it makes an existing debt item knowingly false. Still no remedy this round. |

**Unaddressed by QD, so I hold them as filed:** **A-2** (BF-7's guard turns `val-199:294-295` RED —
§R5, the finding most likely to cost a round), **A-7** (`workflow.js:367`'s `onPick` calls
`paintSelected` without `await` and discards its return; `system.js:90`, `models.js:68`, `issues.js:119`
discard `onTick`'s statuses → the (R) clause), **A-8** (`issues.js:102` takes the degraded branch on a
**non-2xx** body carrying a `degraded` key, which `connection.js:46` classifies `fail` — one instance of
the re-derivation (V) forbids).

---

## §2 The four live arguments

### §R1 — `home.js` is a first-paint site; and the review itself uses 「paint memory」 with no defining row

QD's disclosure list marks `home.js:226-231` **fully conforming**, on the ground that `render()` always
painted first. Measured at `2a738bd`:

```
src/dashboard/ui/app.js:429   renderHome(workflowsPanel, { cards: [], lang: prefs.lang }, handlers);
src/dashboard/ui/app.js:432   scheduleTick(); // fires the first tick immediately — the initial data-island render above is
                              //                 empty, so this is what puts real cards on screen before `networkidle0`.
src/dashboard/ui/app.js:452   const island = readIsland();      ← the ONLY consumer; the UPDATE panel, not home cards
src/dashboard/ui/home.js:153-157   updateCounts(): btn.textContent = `${L(state.lang, seg)} (${counts[seg]})`   ← from state.cards
src/dashboard/ui/home.js:231       if (!body || body.degraded || !Array.isArray(body.running)) return;         ← bails EVERY tick
```

`render()` does paint — with `cards: []`, and `app.js`'s own comment says the render is empty. So the
first tick **is** the first paint of real data, and if `/api/home` is degraded or failing when it
arrives, `home.js:231` bails on every subsequent tick and the segment tabs read
**「全部 (0) · 執行中 (0) · 已註冊 (0)」** indefinitely, beside a truthful `degraded` tag, for a
deployment that may have twelve workflows. Three fabricated quantities in the real tabs' own styling —
**the same predicate BF-7 is blocking on** (`07-review.md` §8: 「a fabricated quantity in the same
sentence and styling as two real ones」), on a bigger surface.

**Why this outranks a severity argument — the review's own text needs the sentence.** BF-7 branch (a)
reads, verbatim: 「**poll tick, `state.selectedRunId` unchanged since the last successful paint** → bail
before any DOM write」. 「Last successful paint」 is paint memory, and **no ARCH or DES row defines what
sets it.** `workflow.js:338`'s state carries `selectedRunId`, `diagramKey`, `diagramUrl` — nothing that
records which run's figure is actually on screen (`grep -n "stateByContainer.set" src/dashboard/ui/workflow.js`
→ `:338`). So BF-7's implementer must invent the definition tonight, and the cheapest invention is a
flag set in `render()` — which every view calls, and which paints a skeleton. Under that reading the (U)
arm never fires anywhere, on any view, and this round's rule is decorative on the arm it was written for.

> **The clause must say: paint memory is set ONLY by an `ok` route result reaching a paint function —
> never by `render()`, never by the `#rwe-init` island, never by an empty-shell or `{cards: []}`
> default. A skeleton is not a paint.**

That one sentence converts a disagreement with QD into the definition the review presupposes, makes
`home.js:231` first-paint non-conformance follow by construction rather than by severity argument, and
gives BF-7's branch (a) its precondition in writing.

**Routing — deliberately not a scope grab.** The review says BF-7's 「scope is exactly this」 (one site),
and my r1's 「nominated for BF-7's commit」 contradicted that. Corrected: what this round owes is that
**the review's §8 population row for `home.js:231` — 「clean (BF-2)」 — is falsified on the first-paint
arm and must be corrected in the disclosure list**, at **MID**. Whether the repair rides BF-7's commit
or heads the next dispatch is the synthesizer's call, not mine.

**Honesty caveat, unchanged:** derived at `file:line`, not observed in Chromium — no browser in this
session. §5 gives the six-line case that settles it either way; if it shows the counts are repainted from
a path I did not find, this drops to LOW and nothing else in §3 moves.

### §R2 — the composed-element fork, part 1: `run.js:512` is not exempt, and split beats cache *for the legend*

**What I concede first.** `renderLegend(legendEl, payload, view, lang)` sets `className` at `run.js:353`,
`legendEl.replaceChildren()` at **`:354`**, repaints the `/dag`-sourced warnings at `:355-359`, then
`if (!view) return` at `:360` — so on a degraded `/api/runs/:id` the `.run-summary` span (`:365-368`) is
**erased**. My r1 ratified `:512` as 「the (O) omission form, correct, refuse to touch」 while my own (O)
text said omission is permitted 「only where the member's absence states nothing; a count, a total, a
state word or a money figure may not be omitted」. `.run-summary` is a state word **and** a count **and** a
token total **and** a money figure (`:367`). QD's §1.3 exposed the inconsistency and I withdraw the
ratification. **BF-5 stays CLOSED** — its finding was the literal `undefined` text, which the `null` did
fix; the erased summary is *new*, LOW, disclosed debt.

**What I rebut: the remedy, at this site.** QD's row 4 says feed the paint function `state.lastView` —
the last-known body of the non-`ok` route.

My objection is **not** 「no view state」, and I want that reading dead before it starts: the tree already
caches an `ok` body's field in view state — `run.js:496`'s `state.pAgents = describeRes.body.params.agents`,
kept across ticks — and it is fine. The distinction that matters:

> A remembered value may be rendered **as what it is**. It may never be handed to a paint function **in
> the slot of the current tick's value**.

`pAgents` passes because `run.js:312-313` renders it as the **DECLARED** default and the row says so.
`lastView.agents` fails because `:313`'s expression `(rec && rec.model) || (declared.model && declared.model.default)`
would render it as the **APPLIED** model, for cells that just repainted from a fresh `ok` `/dag`, in
identical styling, with no way for the operator to tell which tick it came from. That is (N) with an
older number instead of an invented one. And a cache opens three questions this round would have to
answer and does not: which subject was it for, how stale is too stale, what clears it.

**The remedy that needs no cache: make the element's granularity match the route's.** `legendEl` would
hold `<span data-warnings>` (fed by `/dag`) and `<span class="run-summary">` (fed by `/api/runs/:id`) —
`data-warnings` is a PROPOSED attribute, not one that exists: today the legend carries only
`[data-legend]` on its container (`workflow.js:122`, `run.js:430`, asserted at `val-199:296`), and the
warnings are bare `<span>`s appended at `:355-359`. On a
degraded `/api/runs/:id` the warnings subtree repaints and the summary subtree is **not written**.
~4 lines inside `renderLegend`, zero new state, zero staleness policy. It closes `run.js:512`, `:513`
and `workflow.js:329` as one item.

### §R2b — the composed-element fork, part 2: split does NOT reach `run.js:502` / `workflow.js:327`, and I say so

This is the correction the earlier draft of this file needed most, and it is a concession to QD.

Row 2's model text is built **inside each cell** (`run.js:311-320`: `const rec = c.agentId ? agentsById.get(c.agentId) : null` → `modelEl.textContent`), and `paintSwimlane` `replaceChildren()`s the svg
(`run.js:219`) and the cell layer (`:222`) before appending anything. **There is no subtree to leave
unwritten.** So at `run.js:502` and `workflow.js:327` the honest comparison is not split-vs-cache; it is:

| remedy | what the operator sees on `ok` `/dag` + degraded `/api/runs/:id` | costs |
|---|---|---|
| **skip the composite whole under (K)** (my position) | the whole figure is last-known: true cells, true model labels, both stale, one tag saying so | the figure stops tracking a healthy `/dag` for as long as the *other* route is degraded |
| **QD's `state.lastView`** | fresh cells from the healthy `/dag`, model labels aged | a cache, a staleness policy, and the (N)-aged risk above |
| *(third option, named not argued)* render row 2's model as the absent glyph `'—'` — the form `run.js:320` already ships when neither source has a model | fresh cells, honest 「unknown」 model | loses the legitimate never-run DECLARED display unless the call site distinguishes the two; **not measured by me** |

**I hold skip** on the Karpathy tie-break: it needs no state, states no new policy, and is what BF-7
lands tonight at the sibling site. But QD's remedy delivers a fresher figure, and at *these two* sites
that is a real advantage my 「split」 does not have. The synthesizer should pick once, knowing the fix
shape differs by site — and whichever it picks, **both sites stay LOW disclosed debt this round**;
neither is repaired here.

### §R3 — QD's row 3 absolute must be softened, because the review already violates it

QD row 3: 「R `ok` → repaint the region from its body … an `ok` result ALWAYS repaints」, and QD's §4.2
correctly calls this the half a rule like this usually forgets. I agree it is load-bearing — it is what
makes the marker self-clearing and bounds (K)'s staleness. But as an **absolute** it bounces against
BF-7's own mandated branch (a): `if (dagRes.status !== 'ok') return { … };` placed ahead of `:328` means
that on a degraded `/dag` with an `ok` `/api/runs/:id`, the `ok`-sourced summary at `:329` **does not
repaint**. A design clause that contradicts the impl row it is the specification for is the BF-3 class
again, in the round convened to end it.

So the rule states it with its one bounded exception, and names which is which:

> **An `ok` result always repaints its own subtree — except where a composite paint is skipped whole
> under (K). Skipping is permitted only for a composite; it is bounded by the next tick on which every
> contributing route is `ok`, and it may never leave a substituted or remembered value on screen.**

Split is the fix shape the debt sites should eventually land where a subtree exists (§R2); skip is what
BF-7 lands tonight and is legitimate precisely because it writes nothing at all.

### §R4 — the interim predicate: QD's wording marks QD's own three 「clean」 sites non-conforming

*(The section the earlier draft of this file cited three times and never wrote. It is not a footnote:
it decides what the next implementer types at three sites the review calls clean.)*

Both r1s agree the `app.js` seam does not deliver the verdict to the `bodies`-fed views (`app.js:374-376`
builds `results` and `bodies`, `:379` passes only `bodies` — `D3-5`, out of scope by the review's ruling)
and that the clause therefore needs an interim sentence. We disagree on what it sanctions:

- **QD:** apply 「`classifyResponse`'s own predicate to the body (`absent` or `'degraded' in body`,
  `connection.js:48`); a view's top-level `Array.isArray` check is permitted only as a fail-closed
  ADDITION, never as the sole test」.
- **Mine:** a **positive test of the declared success shape, null-guarded** —
  `!body || !Array.isArray(body.running)` — and never a negative sniff for the degrade shape.

Measured, this is not a taste question:

```
classifyResponse: connection.js:46 non-2xx → 'fail' · :47 null/undefined → 'fail' · :48 'degraded' in body → 'degraded'
$ node -e "…classifyResponse(200,{degraded:null})"   → degraded      # PRESENCE
$ node -e "…({degraded:null}).degraded"              → null (falsy)  # TRUTHINESS
home.js:231      if (!body || body.degraded || !Array.isArray(body.running)) return;
run.js:475       if (!dagBody || dagBody.degraded || !Array.isArray(dagBody.cells)) return;
workflow.js:357  if (!describe || describe.degraded || !Array.isArray(bodies[runsUrl])) return {};
```

**All three sites test truthiness; the classifier tests presence.** So QD's wording, taken literally,
makes all three of QD's own 「fully conforming / clean」 sites non-conforming — the exact failure QD's
§0 item 1 warns the clause must avoid. They are saved only by the third clause of each guard, the
positive `Array.isArray` shape test, which is fail-closed for `degraded` (`{degraded:null}` has no
`running` array) **and** for `fail` (body `null`) — and which QD's wording demotes to 「an addition,
never the sole test」.

**So I hold my form, and I adopt QD's guard-rail inside it.** QD's real worry — that sanctioning a
hand-rolled predicate re-legitimises the habit that produced BF-4 and BF-6 — is answered by naming
*which* shape test is permitted, rather than by ranking two of them:

> Where only a `bodies[url]` entry is in scope (`D3-5`), the stand-in is a **positive test of the
> declared success shape, null-guarded** (`!body || !Array.isArray(body.running)`). Never a negative
> sniff for the degrade shape (`!res.body` alone, `body.degraded` alone) — that is the form that
> produced BF-4 and BF-6. An existing redundant `body.degraded` sniff beside a positive test is
> harmless and is **not** churn to remove. This sentence is struck when `D3-5` closes, and nothing
> else in the rule moves.

Consequence for the disclosure table: under my wording the three sites are conforming at HEAD and the
clause is true the day it lands. Under QD's, three rows join the table with no task — `04-design.md:7285`'s
own hazard. That, not elegance, is why I hold.

---

## §3 The merged rule — what I now propose for DES-206

One `amended (…)` bullet in the row's house style, `iter: v27m`. **No new DES id, no new TASK id, no
trace-link change, no ARCH edit, no code.** Where QD's r1 has better wording I use QD's. (The date in
the `amended (…)` stamp is the synthesizer's to set on the day it lands; the finding it cites is
RE-REVIEW #4 / `BF-8`.)

**(V) The verdict is the classifier's, never the body's shape.** A consumer holding a `getJSON` result
decides on `res.status !== 'ok'` and does not re-derive the classification at the call site.
Re-derivation is wrong in **both** directions: a 200 `{degraded:null}` is `degraded` at `connection.js:48`
but falsy at a call site, and a **non-2xx** body carrying a `degraded` key is `fail` at `:46` yet takes a
「degraded」 branch written against the body (`issues.js:102` at HEAD — A-8). Shape guards on an **`ok`**
body are unaffected: they run after the verdict, never instead of it. Where the body crosses `app.js`'s
tick seam without its status (`app.js:374-379` builds `results` and `bodies` and passes only `bodies` —
`D3-5`, deliberately out of scope), the stand-in is a **positive test of the declared success shape,
null-guarded** (`!body || !Array.isArray(body.running)`); never a negative sniff for the degrade shape.
An existing redundant sniff beside a positive test is harmless and is not churn to remove. Struck when
`D3-5` closes; nothing else moves (§R4).

**(K)/(U) One question decides the disposition: does this surface already hold a successful paint of the
CURRENT subject?** A subject is (view, route params, and the selection the surface is keyed to —
`state.selectedRunId` for the workflow figure, `agentId` for the agent panel).

> **Paint memory is set ONLY by an `ok` route result reaching a paint function.** Never by `render()`,
> never by the `#rwe-init` island, never by an empty-shell or `{cards: []}` default. **A skeleton is not
> a paint.** *(This is the definition BF-7 branch (a)'s 「unchanged since the last successful paint」
> presupposes and no row supplies — §R1.)*

- **yes → KEEP.** No DOM write **derived from the non-`ok` resource**: no `replaceChildren`, no
  `textContent`, no style, no further fetch. Subtrees fed by `ok` routes repaint as usual, and `app.js`'s
  own tag and footer are not the view's writes. The last-known render stays; the nav tag is the surface
  that reports the fault (ARCH-124).
- **no → UNAVAILABLE.** Clear **the children of** the part derived from that resource — never the
  structural anchors (`#dag-fit`, `#dag-graph`, `#dag-zoom`, asserted by val-193/197; QD-R5) — and paint
  the one Unavailable component. **This arm is mandatory, not an optimisation.** A view that bails on a
  first paint leaves whatever its skeleton wrote, and a skeleton is itself a constructed payload:
  `app.js:429` first-paints Workflows as `renderHome(panel, { cards: [], lang })`, which `home.js:153-157`
  renders as 「全部 (0) · 執行中 (0) · 已註冊 (0)」 — three fabricated counts that stand for as long as the
  degrade lasts. A blank is the least this arm may produce; **a zero is not blank**.
- Never the previous subject's content under a new subject: a bail on the tick after a run-switch leaves
  the previous run's graph under the newly-selected chip, a worse lie than a blank.

**(O) A composed element may OMIT a member only where the member's absence states nothing; it may never
SUBSTITUTE a value — invented or remembered.** Where one element is fed by several routes and a subtree
boundary exists, **split it so each route owns a subtree** and apply (K)/(U) per subtree (the legend splits into a
warnings subtree fed by `/dag` and the existing `.run-summary` span fed by `/api/runs/:id`; the
container's `[data-legend]` anchor is unchanged). Where no subtree boundary exists —
row 2's model text is built inside each cell and `paintSwimlane` erases the cell layer first
(`run.js:219`/`:222`) — **skip the composite paint whole under (K)**. A **count, a total, a state word or
a money figure** may not be omitted; those take KEEP or UNAVAILABLE. A remembered value may be rendered
**as what it is** (`run.js:496`'s `state.pAgents`, rendered at `:313` as the DECLARED default) and may
never be handed to a paint function **in the slot of the current tick's value**. **An `ok` result always
repaints its own subtree, except where a composite is skipped whole; that skip is bounded by the next
tick on which every contributing route is `ok`** (§R3).

**(N) A consumer may never construct a payload, record or row and hand it to a render function, a `lib/`
projection, or a geometry function.** Prohibited by name:
`dagRes.status === 'ok' ? dagRes.body : { cells: [], edges: [], warnings: [], lanes: [], current: null }`
(`workflow.js:326` — `paintSwimlane` erases before it appends, so the fabricated payload wipes the live
figure, and `renderLegend` computes `nodeCount` from the invented `cells` and prints 「0 個節點」 for a run
that has one); `((viewRes.body && viewRes.body.agents) || [])` (`run.js:502`, `workflow.js:327` — swaps
every node's APPLIED model for the DECLARED default at `:313`, rendered identically); `res.body || {}` →
`body.record || { …, tokens:{input:0,output:0} }` (`agent-panel.js:234`/`:238`). **Exempt:** a payload
PROJECTED from an `ok` body's own fields — `predictedPayload(describe)` (`workflow.js:62-75`), governed by
DES-206's own v27b clause (QD's exemption, adopted). **No helper of the `okBody(res, fallback)` kind may
be introduced** — its natural call at any of these sites is byte-for-byte the defect.

**(S) One component, one string source.** `el('div', 'empty', t(lang, 'unavailable'))` — the `.empty`
hook DES-209's STYLE_HOOKS already declares (`dashboard-classes.ts:28`, no CSS change), and **one key
added to `lib/strings.js` in BOTH languages in the same commit**. Measured at HEAD: `t('zh','unavailable')`
and `t('en','unavailable')` are both `undefined` and `t()` has no fallback (`strings.js:33-34`), so a
one-language key renders the literal string `undefined` under a test that asserts `.empty` exists — the
BF-5/BF-6 class inside the repair for it. The zh value is `'無法取樣'`, verbatim: it is REQ-138's own pair
(`01-requirements.md:1874`) **and** the string `val-202:154` asserts, so any other choice turns a blessed
test red. `system.js:29`'s `UNAVAILABLE` const is deleted in favour of the key when that site is repaired,
not before, or the two diverge. The wire's `degraded` value is **never** the marker; it is rendered only
in the two fields a REQ makes reason-content — the Issues lists (REQ-067) and the agent panel's red
`detail` block (REQ-135) — via `textContent`, pending `A4-2`'s architect-lane pin of the wire vocabulary.
(QD's P3, adopted whole.)

**(R) Every status observed reaches the reducer.** A KEEP or UNAVAILABLE disposition still returns the
statuses of the fetches it made (`return { [dagUrl]: dagRes.status, [viewUrl]: viewRes.status };`), or the
tick under-reports and, with `app.js:382`'s `Object.keys(results).length > 0` guard, a tick that observed
only failures can produce no observation at all. Callers that paint outside the tick (`workflow.js:367`'s
`onPick`, which calls `paintSelected` without `await` and discards its return; `system.js:90` /
`models.js:68` / `issues.js:119`'s `render()`) discard that return today — A-7, LOW; the tag lags such a
fault by at most one tick until they fold it.

**(section ≠ route).** An `ok` body carrying a degraded **section** (`{reason}` fields) is DES-207's
per-field component inside a normal repaint; a non-`ok` verdict for the whole **route** is this rule.
`system.js:74`'s `!res.body` was written by someone reading the section sentence — BF-4's miscope.
(QD's §3.3, adopted.)

**DES-205 inherits verbatim** — `openAgentPanel` is click-triggered, so every open is a first paint of a
new subject and the UNAVAILABLE arm always applies: `panelModel` is NOT called; the panel opens with the
header's `label`/`agentId` as the click supplied them, no state/phase/reasonCode tag, no stat cards, no
system-prompt sentence (「無 system prompt 紀錄」 asserts a fact about a record that was never fetched), no
`工具/技能/MCP` count tags, the ONE Unavailable component where the stat cards would be, and the body's
`error` text in the red `detail` block via `textContent` when present. The FIX is `QD-O5` debt; the CLAUSE
lands now. **DES-207 inherits** (V)/(K)/(S) and carries the section≠route sentence.

**Acknowledged, not remedied:** (K) makes `D3-4` (`app.js:386` stamps 「Updated HH:MM:SS」 on a tick whose
views deliberately wrote nothing) *knowingly* false rather than incidentally false. It stays debt this
round; the clause says so rather than pretending the footer is truthful. (QD's §4.3.)

**Table B, non-normative — the route→subtree map** (QD's region enumeration, kept as an implementer aid,
not as rule vocabulary): `/dag` → svg + cell layer + legend warnings · `/api/runs/:id` → `.run-summary`,
`#run-usage`, row-2's APPLIED model · `describe` + `/api/runs` → header, chips, history table ·
`/api/home` → the grid **and the segment counts** · a ported tab's route → its panel.

---

## §4 The merged disclosure table

Both r1s agree this is the part that must not be cut: a clause the tree violates *silently* is the BF-3
class, and `04-design.md:7285`'s standing rule is satisfied by **disclosure with an owner**, not by
omission. Merged from both files; the three corrections this round produced are in bold.

| site | arm | rule | HEAD | disposition |
|---|---|---|---|---|
| `workflow.js:326` | any | (N) | synthesizes the empty DAG payload, prints 「0 個節點」 | **BF-7 — blocking, impl, this round** |
| **`home.js:231` + `app.js:429` + `home.js:153-157`** | **first paint** | **(U)** | **bails → 「全部 (0) · 執行中 (0) · 已註冊 (0)」 stands indefinitely** | **MID — the review's §8 「clean (BF-2)」 row is falsified on this arm (§R1). Repair routing is the synthesizer's call.** |
| `agent-panel.js:234`/`:238` | first paint | (U),(N) | never reads `res.status`; synthesizes a zeroed record; false system-prompt sentence | MID — `QD-O5` ≡ `A4-3`, DES-205's lane |
| **`run.js:512` + `:513`** | **tick** | **(O)** | **`renderLegend(…, null)` erases `.run-summary` (state + count + tokens + cost, `:367`); `renderUsageBox` clears `#run-usage`** | **LOW — `QD3-O2`. NOT exempt (my r1 wrongly ratified `:512`). Fix shape: split the legend subtree (§R2). BF-5 stays closed.** |
| **`run.js:502`, `workflow.js:327`** | any | (N) | APPLIED model silently replaced by DECLARED (`:313`) | **LOW — `QD3-O2` class. Fix shape is NOT split (no subtree exists — `paintSwimlane` erases the cell layer): skip the composite under (K), or QD's `state.lastView`. Open fork, §R2b.** |
| `run.js:475`, `workflow.js:357` | first paint | (U) | bails → empty shell, no marker | LOW — (U)'s cost, disclosed so it is not rediscovered as an 「eighth site」 |
| `system.js:78`, `models.js:55`, `issues.js:102` | tick | (K) | no paint memory → last-known erased on every non-first non-`ok` tick | LOW, **disclosed, no carve-out**. Fix = one `painted` flag per tab (verified safe: `val-202` injects the fault at `:137`, before `goto` at `:145`). BF-4 stays closed. |
| `models.js:55`, `issues.js:80`/`:102` | — | (V) | verdict re-derived from body shape while `res.status` is in hand two lines above | LOW ×3 (A-8) |
| `issues.js:80` | subject change | (U) | hides the detail box silently | LOW |
| `system.js:29`, `models.js:56`, `app.js:198`, `app.js:414` | — | (S) | **four** literal families, two single-language | LOW — `QD-R3`, REQ-131 acceptance (my r1 said five; corrected) |
| `issues.js:103-104` | — | (S), 2nd clause | renders the wire's raw exception text | LOW — `A4-2`, architect's lane; REQ-067 keeps the text, (S) keeps it out of the marker |
| `workflow.js:367`, `system.js:90`, `models.js:68`, `issues.js:119` | — | (R) | observed statuses discarded | LOW (A-7) |
| `app.js:379` | — | (V) | drops the statuses at the seam | LOW — `D3-5`, out of scope by the review's ruling |
| `app.js:386` | — | — | stamps freshness on a tick (K) designed to skip | LOW — `D3-4`, now *knowingly* false |

---

## §5 Testability — the merged `tests:` line

**§M1 — correcting my own r1's measurement, before anything else.** My r1 §7 stated 「At `2a738bd` no
comment line matches, so the four-hit measurement below is unaffected either way.」 **That is false.**
Re-measured this round:

```
$ grep -rnE "([Rr]es\.(body|status))" src/dashboard/ui/*.js | grep -E "(\|\||: )[[:space:]]*[\{\[]"
src/dashboard/ui/agent-panel.js:234:  const body = res.body || {};
src/dashboard/ui/run.js:502:          const agentsById = new Map(((viewRes.body && viewRes.body.agents) || []).…
src/dashboard/ui/workflow.js:321:  // (server.ts's catch-all), truthy, so `dagRes.body || {defaults}` let …   ← COMMENT
src/dashboard/ui/workflow.js:326:  const payload = dagRes.status === 'ok' ? dagRes.body : { cells: [], … };
src/dashboard/ui/workflow.js:327:  const agentsById = new Map(((viewRes.body && viewRes.body.agents) || []).…
                                              5 hits raw · 4 after comment-stripping (measured)
```

The conclusion still stands and the hit *set* is unchanged — but comment-stripping is **load-bearing**,
not belt-and-braces, and a spec that said otherwise would have produced a test that fails on the day it
lands.

**The oracle, merged.** QD's §1.2 wants the population greps with expected counts in the `tests:` line;
I want them executable. Same artefact at two maturities, and the executable one costs ~12 lines in
`dashboard-diagram-render.test.ts`'s existing corpus block:

- **Regex:** mine, not QD's — QD's (`\.body[^;]*(\|\| *(\[\]|\{\})|\? *\w+ *: *\{)`) misses
  `workflow.js:326`, which QD's own file concedes it matched 「by eye」. Mine catches all four.
- **Mechanics the spec must name or it is not implementable:** the test strips comments itself (§M1);
  `clientCorpus()` (`tests/helpers/client-corpus.ts:27-31`) concatenates raw file text and loses file
  boundaries, so the allowlist is keyed on **(file, matched line text)** via a per-file walk over the
  same `listJsFiles` enumeration — **never on a line number**, which every repair shifts.
- **Anti-vacuity:** `expect(clientCorpus().length).toBeGreaterThan(5000)` beside it — DES-208's own rule,
  and this ledger's named vacuous-survivor class. After BF-7 the allowlist is three entries, each
  carrying its debt id, and it may only shrink (`toBe(3)` on the count).
- **Stated honestly:** a tripwire, not a proof. `const EMPTY_DAG = {…}` at module scope evades it. Its
  job is to make the class *visible* — the thing a sweep can grep FOR, which `07-review.md` §10 says was
  missing for six rounds.
- **Landing path (BF-8 forbids a new TASK id):** it rides BF-7's impl dispatch, which already edits test
  files; failing that, the `tests:` line names it **as owed**, in the 未實作 form with the measured hit set
  inline — never as if it exists (DES-208's 「dangerous green」).

**The per-arm cases.** The three pins cover one arm each and no case covers the other arm at any site:
`val-198:262` and `val-200:215` degrade **after** a healthy paint (KEEP arm); `val-202:130` degrades
**from load** (UNAVAILABLE arm). So: an assertion in this class is an **invariant across the fault**
(`toBe(before)` on a counted DOM property, never a bare `toBeNull()` or 「non-zero」), and a new case
targets the arm its site does not already pin. In severity order: `home` first-paint degrade (§R1 — six
lines: move `setRequestInterception` before `goto` in a copy of `val-198:262`, assert the segment tabs do
**not** read `(0)`); `system` tick (flip `val-202`'s handler behind a boolean so the first load succeeds,
then degrade); `run` / `workflow` first paint. QD's asymmetric-fault requirement (intercept ONE route of a
co-fetched pair and assert the OTHER route's subtree still repaints) is adopted — it is BF-7's own case
and it is what `val-199` lacks.

### §R5 — A-2: BF-7's prescribed fix, landed as written, turns `val-199:294-295` RED

Unaddressed by QD, and the finding most likely to cost a whole round. BF-7 branch (a) requires
`if (dagRes.status !== 'ok') return { … };` ahead of `workflow.js:328`. BF-6's own lock
(`val-199-workflow-detail.test.ts:272-299`) degrades `/api/runs/:id` **and** `/dag` together after a
healthy `.run-summary` (`:280-282`), with the selection unchanged — so branch (a)'s precondition is met,
the bail happens **before** `renderLegend`, the previous summary survives, and `:295`'s
`expect(after).toBeNull()` fails. The implementer then either weakens the new guard to keep the old
assertion green — re-opening BF-7 — or edits a blessed test without a mandate.

**The remedy, and it must travel with the finding.** Restate the assertion as the invariant:

```ts
const after = await page.$$eval('.run-summary', (els) => els.map((e) => e.textContent));
expect(after).toEqual([before]);            // exactly one element, text unchanged
```

Three mechanics matter and the earlier draft of this file got the first one wrong:

1. **Not `expect(after?.textContent).toBe(before)`.** `page.$()` returns a puppeteer `ElementHandle`,
   which has **no** `textContent` property — that expression evaluates to `undefined` on every path and
   the assertion is red whether the guard is right or wrong. `$$eval` also fails cleanly on absence,
   where `$eval` throws.
2. **It is RED at HEAD and GREEN after the guard.** At `2a738bd`, `renderLegend(…, null)` erases the
   summary, so `toEqual([before])` fails today. That is the correct lock shape — it falsifies the repair
   — but it means **the assertion change must land in BF-7's own commit**, never separately, or master
   carries a red test.
3. **It passes under both remedies of §R2/§R2b:** under BF-7's bail (both routes degraded → nothing
   written → summary unchanged) and under the legend split (only `/api/runs/:id` degraded → warnings
   repaint, summary subtree untouched). One assertion form, both arms.

**The test's title changes too:** it reads 「…**drops** the run-summary line rather than rendering
"undefined" (BF-6)」 (`:272`), so the erase reading is baked into the name, not only the assertion.
**BF-5/BF-6 stay closed either way** — their findings were the literal `undefined` text, which is what
the `not.toContain('undefined')` assertions at `:282` and `:297` actually pin, and those are untouched.

---

## §6 What I still refuse (Karpathy tie-break) — unchanged from r1, and QD refuses the same list

`renderable()` / `okBody(res, fallback)` in `lib/` (a helper cannot fix a site whose bug **is** the
fallback it returns; QD's §2.2 reaches this independently) · a new DES id · a new TASK id · any ARCH edit
(`D3-6` is the architect's lane; ARCH-125 should later carry a one-line pointer, not a second copy) · a
fourth connection state or a per-surface 「stale」 badge (the owner ruled three source tags on 2026-09-13;
the KEEP arm's staleness is reported by the tag that exists — QD did not propose one, so my r1's predicted
disagreement did not materialise) · closing the `app.js:379` seam (out of scope by the review's ruling,
and it cannot reach `workflow.js:326`, `agent-panel.js:234` or `system.js:72`, which hold their own
verdict) · a per-view split of the rule · **a per-site task split when the debt is dispatched** — QD's
point, adopted: one task, DoD = the greps reaching their expected counts, split by LANE (DES-206 sweep /
DES-205 panel) if at all.

---

## §7 Remaining disagreements, stated as such

1. **The composed-element remedy (§R2 / §R2b)** — the one genuine fork, and it is **two forks wearing one
   name.** For the legend (`run.js:512`/`:513`, `workflow.js:329`) I argue split (no state, no staleness
   policy) over QD's `state.lastView`. For row 2 (`run.js:502`, `workflow.js:327`) **split does not
   reach** — there is no subtree — so it is skip-the-composite (mine) vs `state.lastView` (QD's), and
   QD's buys a fresher figure at the cost of a cache and the (N)-aged risk. Both sites stay LOW disclosed
   debt this round whichever the synthesizer picks; it should pick per site, not once for both.
2. **The interim predicate's wording (§R4 / (V)).** Positive declared-success-shape test, null-guarded,
   as the single test (mine) vs the classifier's predicate with a shape check permitted only as a
   fail-closed addition (QD's). **This one has a measurement:** the classifier tests `'degraded' in body`
   (presence), all three `bodies`-fed sites test `body.degraded` (truthiness), so QD's wording marks its
   own three 「clean」 sites non-conforming and adds three untasked rows to the disclosure table —
   `04-design.md:7285`'s own hazard. I hold, with QD's guard-rail (name which shape test is permitted)
   adopted inside my form.
3. **`home.js:231`'s severity (§R1).** I hold MID; QD holds it clean. The *fact* (first paint with
   `cards: []`, counts rendered as `(0)`, bail every tick, `#rwe-init` consumed only at `app.js:452`) is
   measured and I do not expect it to survive as a disagreement. I have no browser, so if the synthesizer
   can run the six-line case in §5, that evidence outranks my derivation in either direction. **The rule
   sentence it produces — 「a skeleton is not a paint」 — stands regardless of the severity call**, because
   BF-7 branch (a) already depends on a definition of 「last successful paint」 that no row supplies.

Not disagreements any more, listed so the synthesizer does not go looking: the ported tabs, the string key
and its `undefined` hazard, the four literal families, DES-205's inherited text, the DES-207
cross-reference, the anchors-not-children clause, the seam, `okBody`, the ARCH pointer, task-by-lane, and
the disclosure table itself — **if the synthesizer trims anything, the disclosure table is the last thing
to cut**, because a clause the tree violates silently is the exact defect this round exists to stop
repeating.
