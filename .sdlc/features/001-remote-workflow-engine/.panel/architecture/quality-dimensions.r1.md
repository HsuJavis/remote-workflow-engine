---
stage: architecture
lens: quality-dimensions
iteration: v27 — Gate 8 SEND-BACK REPAIR, architecture half (07-review.md "v27 GATE 8 REVIEW" §8 items 9–11: AC-2 / AC-3a / DASH-1)
round: 1 (independent proposal)
supersedes: this path's two prior bodies ONLY for the send-back repair scope. Sprint A r1 (the full v27 proposal) is at `git show 07266be:.sdlc/features/001-remote-workflow-engine/.panel/architecture/quality-dimensions.r1.md`; the v27b delta r1 (the predicted-overlay reversal) is at `git show c7447d0:…/quality-dimensions.r1.md`. Both stand unchanged for everything they decided; neither is pasted back in here — the synthesizer needs the repair, not the archive.
inputs: 07-review.md §2 AC-2 / AC-3 / §3 DASH-1 / §8 items 9–11 / §9 / §10 retro; state.yaml tech_stack + current_stage note (v27g); journal.md :4415-4540; 01-requirements.md §Round v27 (C1–C4, D1–D4), REQ-131, REQ-134, REQ-135, REQ-136, REQ-142; 02-architecture.md ARCH-122 (:3331-3338), ARCH-123 (:3340), ARCH-124 (:3349-3357), ARCH-125 (:3359-3369), ADR-049 (:3430-3435), ADR-053 (:3458), INV-V27-3/5/8 (:3648-3661), the v24 process view (:2530-2568), the v27 process view (:3560-3582), Decision rationale v27 (:3662) and v27b (:3678); 04-design.md DES-200 (:6788), DES-201 (:6796), DES-208 (:6852), DES-209 (:6860); 03-tasks.md TASK-205 (:1747); 06-impl-log.md IMPL-229 (:4481-4547); tsconfig.json; vitest.config.ts; package.json scripts; deploy/rwe-update.sh :132-147; src/dashboard-page.ts :80-175; src/dashboard/ui/app.js :60-80, :395-465; src/dashboard/ui/theme-init.js; tests/unit/dashboard-page-source.test.ts; tests/unit/dashboard-zoom-source.test.ts; tests/unit/workflow-page-harness-table.test.ts; tests/unit/dashboard-diagram-render.test.ts; tests/unit/dashboard-no-design-values.test.ts; tests/fixtures/dashboard-classes.ts; .panel/review/quality-dimensions.md (the pre-run Gate 8 panel, QD-R5)
verified_this_round (working tree at HEAD `eb387a1`, i.e. AFTER the v27g impl repair): every `file:line` below was re-opened at this tree; line numbers that moved since the review tree `ef0a400` are given in both forms.
measured_this_round (three experiments, all in the scratchpad, zero edits to the tree):
  (M1) `tsc --noEmit -p <scratch tsconfig.server.json>` — extends the root tsconfig, `lib:["ES2022"]`, `allowJs:false`, include `src`, exclude `src/dashboard` (+ the existing `src/sandbox/child-entry.ts`) → **exit 0, 76 `src/` files in the program incl. `src/dashboard-page.ts` and `src/dashboard.ts`, zero `src/dashboard/**`, 3.7 s wall**.
  (M2) a planted probe (`document.title`, `window.location.href`, `HTMLElement`) under the SAME settings → **TS2584 + 2×TS2304, exit 2**; under the root's current `lib` (DOM present) → **exit 0**. The root config has no DOM guard today; the inverse program restores it.
  (M3) `mermaid.parse()` in the repo's cached headless Chrome (puppeteer) with `https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js` — the exact URL `dashboard.html` loads (the bundle exposes no `mermaid.version` string, so the oracle is cited by URL/major, not by patch) — over both broken sequence diagrams and candidate fixes: **each diagram carries a SECOND `;` the review's "two semicolons" instruction leaves in place; fixing only the review's two leaves BOTH diagrams failing** (detail in §1 O-2).
---
# Quality-dimensions proposal — the send-back's architecture half: four semicolons not two, a guard that exists only on paper, and a shell whose fallback impersonates the old page

## summary

**Three findings, three measured facts, and one pattern.** The review routed AC-2, AC-3a and DASH-1 to Gate 2 under its own rule — "the architecture body asserts something the tree contradicts" — and all three are instances of the retro's meta-pattern: a control's *form* shipped without its *subject*. ADR-049 asserts a compile-time guard (`lib:["ES2022"]` keeps `document` out of server code) that IMPL-229 removed repo-wide; ARCH-122 attributes the nav, tab shells, anchors and panel container to a shell that `app.js:455` (`:427` at `ef0a400`) `replaceChildren`s away before first paint; DASH-1's two process views fail in the very browser the ledger's dashboard is read in. Gate 2 fixes documents, not code, so every proposal below is an ADR/ARCH amendment plus a named TASK with a DoD whose subject is stated — retro lesson 1, applied to the repair itself.

**What I measured changes the repair text in two places.**
1. **DASH-1 is four characters, not two (M3).** The v24 diagram (`:2530-2568`) fails first at `:2539` (`minRole author; ownership`) and, once that is fixed, at `:2547` (`BEGIN IMMEDIATE; INSERT …; COMMIT`); the v27 diagram (`:3560-3582`) fails first at `:3574` (the trailing `%%` comment) and then at `:3576` (`Note over B: … pure functions; transform …`). The review's instruction — "replace those two semicolons" — produces two diagrams that still render 「圖渲染失敗」 at the re-review. Exact, parse-verified replacements are in §1 O-2 and the ledger-edit table.
2. **AC-2's "tests-only DOM config" is infeasible, and the finding's option (i) has a real guard available (M1/M2).** Tests import `src`, so one program types both; IMPL-229 said so ("no per-tree override available"). The property ADR-049 named — *the server compiles without DOM* — is restored not by scoping DOM *out of* a tests config but by adding the **inverse program**: `tsconfig.server.json` (src minus `src/dashboard`, `lib:["ES2022"]`, no `allowJs`) run beside the root config in `typecheck` **and** `build`. It compiles clean on today's tree and goes red on a planted `document`. This is option (i) — record what shipped and why, with the replacement guard named — not option (ii).

**AC-3a needs two layers or the re-review finds the same contradiction.** Layer 1 (contractual now, matches the tree): the shell is `<head>` + the island + the module script; everything between `<body>` and the island (`dashboard-page.ts:92-152`) is legacy markup that `app.js` discards, non-contractual, not a test subject. Layer 2 (target, a named TASK): the body becomes one mount point carrying static pre-boot text, so a module that fails to boot leaves an honest 「載入中」 on screen instead of a ghost of the pre-v27 page with empty "Running / Registered / Other" headings — today's fallback is byte-identical to "the engine has nothing registered", which is the silent-failure class this lens exists to design a seam for. Five dead pins, DES-200's and TASK-205's stale clauses, and the class-lock's safety (verified: 0 of 104 `STYLE_HOOKS`, 0 of 23 `TEST_ANCHORS` are emitted only by the shell) are enumerated so Gate 6 has the blast radius in hand.

**Scope discipline.** The repair text is §8 items 9–11 verbatim. Three things this lens would normally push — a syntax guard over the unit-tierless `ui/*.js`, a boot watchdog, a render-based diagram oracle — are fenced in a "recorded, non-blocking" subsection with their cost stated, because the routing rule and the Karpathy tie-breaker apply to what a repair adds as much as to what it fixes.

## Altitude call

The project is both a conventional system (an HTTP/MCP engine with a browser dashboard) and an AI-agent system (it runs LLM agents and must make their prompts, tool calls and usage inspectable). **This repair scope is system-altitude on all three findings** — a compiler configuration, an HTML shell, and two ledger diagrams. The agent altitude (REQ-135's panel, REQ-136's system-prompt fact, REQ-127's four-column usage) is untouched by §8 items 9–11 and was closed at v27g; I do not force it here. Where a dimension's agent reading would say nothing new, the section says so in one line rather than inventing a finding.

## The three findings, on disk at HEAD `eb387a1`

| Finding | The ledger asserts | The tree has | The subject the repair must name |
|---|---|---|---|
| AC-2 | ADR-049 title 「no tsconfig change」; Consequences 「`allowJs`/`checkJs` and a `DOM` lib are deliberately NOT added to the root tsconfig, because that would make `document` a known global in server code」; ARCH-124 note 「a root `tsconfig.json` whose `"lib":["ES2022"]` is what stops server code from thinking `document` exists」 | `tsconfig.json:7-8` `"lib":["ES2022","DOM","DOM.Iterable"]`, `"allowJs":true`, one program over `src`+`tests`+`vitest.config.ts` (IMPL-229, honest, 36→0 `tsc` errors); M2: a server file referencing `document` compiles clean today | the real compiler over the real server files: `tsc -p tsconfig.server.json` (M1) |
| AC-3a | ARCH-122 `api:` 「`DASHBOARD_HTML` … holds markup and CSS only: the design tokens … keyframes, the nav with the source tag, the four tab shells, the `#dag-zoom`/`#dag-graph`/`#dag-fit` anchors, `#run-usage`, `#diagram-zoom`/`#diagram-img[draggable="false"]`, the component classes, and the slide-in panel's empty container」; `note:` 「still assertable here」 | `dashboard-page.ts:91-155`: `<body>` = pre-v27 `<header>`+`<main>` (Runs/Issues links, `#home-*`, `#detail`, `#issues`) + island + module script; **no CSS at all** since v27c (DES-200); `app.js:455` `document.body.replaceChildren(nav, routeMount, buildFooter())`; nav/tabs/anchors/panel built in `ui/app.js`, `ui/run.js`, `ui/workflow.js`, `ui/agent-panel.js` | the bytes the browser keeps: `clientFile(...)` for every component pin; `DASHBOARD_HTML` only for the shell's own four facts |
| DASH-1 | two `sequenceDiagram`s are the v24 and v27 process views | M3: `:2539` **and** `:2547`; `:3574` **and** `:3576` each break `mermaid.parse` | a real render (mermaid@11 from the same URL `dashboard.html` loads), not a lexical checker |

---

## 1. Observability — transparency of internal state

*System altitude throughout. Agent altitude: no change — the agent seam (REQ-135 panel, `record`, `systemPrompt{agentType,bytes}`) is closed and not in this scope.*

### O-1 — AC-3a: the shell's fallback body impersonates a working dashboard

**What the operator sees when `app.js` does not boot.** `theme-init.js` runs (classic, in `<head>`), stamps the theme, and then nothing else happens: the browser keeps `dashboard-page.ts:92-152` on screen — `<h1>Remote Workflow Engine — Live Dashboard</h1>`, `Runs` / `Issues` links, and the headings `Running` / `Registered` / `Other` / `System` / `Models` above empty `<div class="cards">`s. That page is **visually indistinguishable from an engine with nothing registered and nothing running** — an operator over the tunnel reads "quiet", not "broken", and there is no nav tag (the tag is client-built) to say 離線. This is the design defect the lens definition names: a silent/opaque failure with no observable seam.

**Why the failure is realistic, not hypothetical.** There is no build step (ADR-049), `allowJs` without `checkJs` makes the client tree "readable to `tsc`, not checked by it" (IMPL-229's own limit statement), `ui/` has no unit tier by design (ADR-049 — decidable logic is in `lib/`), and the real-Chromium tier is conditional on a browser being present (ADR-053: puppeteer is an `optionalDependency` behind an existing Chrome probe; IMPL-229 had to force it with `RWE_REQUIRE_BROWSER=1`). Verified this round, stated narrowly: `lib/*.js` (and, since AC-7, `ui/clock.js`) are parsed whenever their `.test.js` importers load them, but **none of the `ui/*.js` modules `app.js` statically imports — `app.js`, `poll.js`, `home.js`, `workflow.js`, `run.js`, `agent-panel.js` — nor the classic `theme-init.js` (unit-tested as TEXT) is parsed by any tier except the real-browser one**; no test runs `node --check` or any other parser over them (`grep` over `tests/unit` for `--check` / `SourceTextModule` / `acorn` → 0). A stray token in any of those seven files ships with a green unit suite and produces exactly the ghost page above.

**Proposal (the repair — two layers, both in ARCH-122):**
- **Layer 1, contractual now and true of the tree:** the shell's `api:` names `<head>` (charset, viewport, title, the `dashboard.css` link, the classic `theme-init.js`) + `<body>` containing the JSON island `#rwe-init` and the module script `app.js`. Everything else in `<body>` is legacy pre-v27 markup that `app.js:455` replaces before first paint: **non-contractual, not a valid test subject, scheduled for deletion under TASK-A (below)**. The nav, source tag, tab shells, `#dag-*`/`#run-usage`/`#diagram-*` anchors, component classes and panel container are ARCH-125's (`ui/app.js`, `ui/run.js`, `ui/workflow.js`, `ui/agent-panel.js`). The shell carries **no CSS** (DES-200 v27c: one delivery path, `dashboard.css`).
- **Layer 2, the target shape (TASK-A, Gate 6):** `<body>` = one mount element carrying static pre-boot text + `<noscript>`, then the island and the module script. `app.js`'s existing `replaceChildren` already removes it on a successful boot — **zero change to `app.js`**. On a failed boot the operator sees 「儀表板載入中… / Loading dashboard…」 forever, which is honest ("did not start"), not a page that claims the engine is idle. Class: reuse the existing `empty` style hook (`STYLE_HOOKS` already declares it; no DES-209 contract change, no new `data-*` — DES-209 freezes those as test anchors). Text: a bilingual one-liner in the shell is a literal outside `lib/strings.js` — the shell is server-side TS and cannot import the table, and the text must exist before any JS runs; record it as a boundary exception of the same class as `theme-init.js`'s deliberate copy of `PREF_KEYS` (DES-201's "one surviving source pin"), or choose language-neutral text (`…`) if the panel prefers zero exceptions. I prefer the bilingual line: an ellipsis is not an explanation.

**Recorded, non-blocking (beyond §8 — cost stated, fold into TASK-A only if the orchestrator agrees):**
- **(NB-1) a syntax guard whose subject is the served bytes:** one unit test that spawns `node --check` over every `src/dashboard/**/*.js` (the package is `"type":"module"`, so the files parse as ESM exactly as the browser parses them; the `lib/` files are double-covered, harmlessly — the seven `ui/` files above are the ones that gain a parser). ~15 lines, no new dependency, falsified by a planted stray brace. It closes the gap between "readable" and "checked" at the cheapest level that matters for the ghost-page failure, without `checkJs`'s implicit-any flood.
- **(NB-2) a boot watchdog:** `theme-init.js` (already classic, already served, already CSP-allowed) arms one `setTimeout(8000)` that, if the pre-boot element is *still present*, swaps its text to 「儀表板未能啟動 — 請看瀏覽器主控台 / Dashboard failed to start — see the browser console」. Six lines; detection by element presence, not by a new attribute. I will not fight for it — the static text is the floor; the watchdog only distinguishes "slow" from "dead".

### O-2 — DASH-1: the ledger's own dashboard is an observability surface, and the review's instruction leaves it broken

**The measurement (M3), block-relative line numbers as `mermaid.parse` reports them:**

| Diagram | As on disk | Review's fix only | Both fixed |
|---|---|---|---|
| v24 process view `02-architecture.md:2530-2568` | FAIL line 9 (`:2539` `minRole author; ownership`) | **FAIL line 17** (`:2547` `BEGIN IMMEDIATE; INSERT …; COMMIT`) | **OK** (`diagramType: sequence`) |
| v27 process view `02-architecture.md:3560-3582` | FAIL line 14 (`:3574` trailing `%% never a 500; a fault …`) | **FAIL line 16** (`:3576` `Note over B: … pure functions; transform …`) | **OK** |
| control: v14 process view `:891-920` (line-start `%% … HarnessDescriptor; see …`) | OK | — | — |

**The exact replacements, each verified in combination:**
- `:2539` `Z-->>S: ok (minRole author; ownership workflow → owner or new)` → `… (minRole author · ownership workflow → owner or new)`
- `:2547` `C->>C: BEGIN IMMEDIATE; INSERT workflow_versions(mermaid, triggers, params); COMMIT` → `BEGIN IMMEDIATE → INSERT workflow_versions(mermaid, triggers, params) → COMMIT` — **or** `BEGIN IMMEDIATE#59; INSERT …#59; COMMIT` (the `#59;` entity renders as a literal `;`, also verified OK, if the SQL reading matters to the author)
- `:3574` `S-->>B: 200 [{…, costUSD?}]  %% never a 500; a fault is 200 {degraded} + dashboard_api_degraded` → `… %% never a 500 — a fault is 200 {degraded} + dashboard_api_degraded`
- `:3576` `Note over B: render from lib/* pure functions; transform stays on #dag-zoom` → `Note over B: render from lib/* pure functions · transform stays on #dag-zoom`

**The authoring rule the control block teaches** (one sentence for the ledger's house style, so this class does not recur): in a `sequenceDiagram`, `;` is a statement terminator inside message text, inside `Note` text and inside a *trailing* `%%` comment; only a `%%` comment on its own line tolerates it. The sweep over every ```mermaid block in 02/03/04/05 finds no other sequence-diagram text with a `;` — the remaining hits are quoted `erDiagram` attribute comments and quoted flowchart labels, which the review's browser pass rendered (40 of 43), and two `classDiagram` `<<…>>` annotations at `04-design.md:2036/2040` that were likewise not among the three failures (I did not parse those two myself; stated to what was measured).

**After the edit:** regenerate `dashboard.html` (`sh .sdlc/trace`) — it is generated from the ledger, and the re-review's §3 renders the generated file, not the markdown.

**Recorded, non-blocking (NB-3) — the closed loop the retro asked for (§10 item 4, "render it, don't lint it"):** the scratch script that produced M3 is ~30 lines — extract every ```mermaid block from the five ledger files, `mermaid.parse` each in the cached Chrome against the same CDN URL `dashboard.html` uses, print `file:line` per failure, skip loudly when the CDN is unreachable (the same soft dependency `dashboard.html` already has). It belongs beside the ledger tooling (`.sdlc/`), not in `src/` (the `no-retired-surface` guard forbids mermaid there) and not in `tests/`. Record it as TOOL debt beside TOOL-FORK; it is the only oracle that answers the question §3 asks, and the review already showed the lexical checker is wrong in both directions.

### O-3 — AC-2: what "readable, not checked" means for the operator

The `DOM` lib in the root is not itself an observability problem; the *absence of the promised guard* is, because it is invisible: nothing goes red, `npm run typecheck` says 0 errors, and the ADR keeps saying the guard exists. The proposal in §2 R-1 makes the guard a second `tsc` program whose exit code is the signal — visible in CI, visible in `deploy/rwe-update.sh:147` (`revert_and_fail "npm run build failed"`), and falsifiable in one line (M2).

**Verified consistent (Observability):** ARCH-123's `dashboard_asset_missing` log line (a missing key is server-observable at boot); ARCH-130's `dashboard_api_degraded`; the v27g repairs of AC-4/AC-5/AC-6 (worst-of tag, per-tab poll, INV-V27-5 rendered) — re-read, not re-litigated.

---

## 2. Replaceability — decoupling and pluggability

*System altitude. Agent altitude: no change — the LLM backend seam (three provider routes behind one `GatewayClient`) is untouched by this scope.*

### R-1 — AC-2: the server/client compile boundary is the replaceability property, and it is currently unenforced

**The property ADR-049 actually cares about** is not "which strings are in `lib`"; it is *the server tree is a complete program without the client tree*. That is what lets the client be rewritten (v27 did exactly this), deleted, or replaced by a different renderer without touching the server's compile — and what stops a server module from quietly growing a `window.` reference that only fails at runtime under Node. IMPL-229 traded that property for `tsc` readability of `.js` exports and DOM types in acceptance callbacks, both legitimate, and recorded the trade honestly; what it could not do (it is a Gate 6 entry) is amend the ADR.

**Why a tests-only DOM config cannot restore it.** `tests/**` import `src/**`; `tsc` types one program per config; a config that includes tests includes the server. IMPL-229: "one program, no per-tree override available". So the finding's option (ii) as literally worded has no implementation, and I do not propose it.

**What does restore it — the inverse program (M1, M2):**

```jsonc
// tsconfig.server.json — the SERVER must compile without the client and without DOM (ADR-049).
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "lib": ["ES2022"], "allowJs": false, "declaration": false },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "src/sandbox/child-entry.ts", "src/dashboard"]
}
```
```json
"typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.server.json",
"build":     "tsc --noEmit && tsc --noEmit -p tsconfig.server.json"
```

- **Compiles clean on today's tree**: 76 `src/` files, `src/dashboard-page.ts` and `src/dashboard.ts` (ARCH-126, a server module) included, zero `src/dashboard/**`, 3.7 s.
- **Goes red on the planted violation**: TS2584 (`document`), TS2304 (`window`, `HTMLElement`) — the same three the root config now accepts silently.
- **No allowlist**: `src/auth/auth-service.ts:273` contains `document.getElementById` inside an HTML *string* served to the browser — the compiler does not see a string as an identifier; a grep guard would need an allowlist entry for it on day one.
- **Sees types and transitive imports**: `HTMLElement` in a server signature, or a server file importing a `src/dashboard/lib/*.js` module, both fail; a grep over `document.|window.` sees neither.
- **The editor does not enforce it**: IDEs resolve the nearest `tsconfig.json`, which keeps DOM, so `document` autocompletes in server files. Stated as the accepted limit; CI (`typecheck`) and every self-update (`build`, `deploy/rwe-update.sh:132-147`) do enforce it.

**Lineage worth recording, because the retro pattern applies to Gate 2 itself.** Sprint A's adversarial lens proposed a second tsconfig (D-ADV-5, `tsconfig.client.json`); the v27 synthesis refused it as "ceremony" and took the cheaper half — no tsconfig change — arguing the fixture's `satisfies` lock delivered the same property. It did not: the cheap half shipped without the load-bearing property and IMPL-229 had to widen the root. The inverse program is that refused idea, pointed the right way (guard the server, not type the client), at eight lines of JSON.

**Ledger edits:** ADR-049 — the **title** ("no tsconfig change") is false and must carry the amendment marker, not only the Consequences; Consequences rewritten to what shipped and why (DOM + `allowJs` in the root for acceptance `page.evaluate` callbacks and `.js` export readability), with the replacement guard named as `tsconfig.server.json` in `typecheck`+`build` and its falsification stated; the `checkJs` limit recorded ("readable, not checked" — the opt-in path is a per-file `// @ts-check` in `lib/*.js`, non-blocking). ARCH-124 note — the sentence "without adding `DOM` to a root `tsconfig.json` whose `"lib":["ES2022"]` is what stops server code from thinking `document` exists" is replaced by "the server tree is compiled a second time without DOM and without the client (`tsconfig.server.json`, ADR-049 as amended)". Until TASK-B lands, both rows say **"guard restored by TASK-B; between this amendment and its landing the property is unguarded"** — no sentence the tree contradicts (the finding's own warning about "an amended ADR beside an unchanged `tsconfig.json`").

### R-2 — AC-3a: the shell's contract shrinks to what only the server can supply

Replaceability's reading of ARCH-122: the shell should own **only what the client cannot produce for itself** — the document root's attributes before first paint, the asset references, and the server→client data path (the island). Every element the client builds belongs to the client's row; attributing them to the shell creates a two-owner mirror pair (the class this ledger's `as-is §A` counts and ADR-049 was chosen to shrink), and the dead markup is that pair's fossil. Layer 1 of the ARCH-122 amendment says exactly this; Layer 2 removes the fossil.

**Pin rule for the row's `note:` (replaces "still assertable here"):** `DASHBOARD_HTML` is a valid test subject only for the shell's own facts — root attributes, the three asset references, exactly one inline `<script>` (the island), `<` escaped in the island, and after TASK-A the mount element with its pre-boot text. Every component-markup or CSS assertion takes `clientFile(...)` as its subject (DES-208's disposition table already says this for behaviour pins; v27c said it for the CSS pins; v27g said it for the `draggable` pin). **A component pin whose subject is `DASHBOARD_HTML` is dead by construction.**

**Blast radius, enumerated (TASK-A's DoD), all verified at HEAD:**
| Dead pin | Disposition (DES-208's three verbs) |
|---|---|
| `tests/unit/dashboard-page-source.test.ts` UT-240 last case `expect(DASHBOARD_HTML).toMatch(/draggable="false"/)` | RETIRE — UT-224's v27g re-pointed case (`clientFile('ui/workflow.js')`) already guards it; the leftover is a second dead pin AC-3b did not reach |
| `tests/unit/dashboard-zoom-source.test.ts:19` `/zoomable/`, `:23` `/fit/i` | MOVE → `clientFile('ui/run.js')` (the wrapper and `#dag-fit` are built there; INV-V27-6) |
| `tests/unit/workflow-page-harness-table.test.ts:15` `/harness[-_]?table\|harnessTable/i` | RETIRE with reason — the harness table's role is REQ-135's panel now, real-tier proven by val-201; or MOVE → `clientFile('ui/agent-panel.js')` |
| `tests/unit/dashboard-diagram-render.test.ts:60` `toContain('id="diagram-img"')`, `:61-62` `not.toContain('<object'/'<embed')` | MOVE → `clientFile('ui/workflow.js')` for the positive; the two negatives over `clientCorpus()` (over `DASHBOARD_HTML` they pass vacuously today — DES-208's "dangerous green") |
| `tests/unit/dashboard-no-design-values.test.ts:44,50` (class-lock emitter half, `clientCorpus() + DASHBOARD_HTML`) | **no change needed** — measured: 0 of 104 `STYLE_HOOKS` and 0 of 23 `TEST_ANCHORS` are emitted only by the shell |
| UT-240 gains one positive case | `<body>` contains the mount element, the island and the module script and **no `<section`/`<header`** — the assertion that fails if the fossil returns |

**Owed to other gates (record, route — design's re-run scope is DASH-2 only):** DES-200's boundary sentence 「`draggable="false"` STAYS in this file」 and TASK-205's `dod:` 「`DASHBOARD_HTML` still contains `draggable="false"`」 have been false since v27g AC-3b; both need the same re-point note (`clientFile('ui/workflow.js')`), and DES-200's signature line "holds markup and CSS only" needs the same Layer 1 shape.

### R-3 — DASH-1: nothing to swap, one rule to keep

No replaceability content beyond §1 O-2's authoring rule; a diagram is data the dashboard renders, and the rule keeps it renderable by the one renderer the ledger uses.

**Verified consistent (Replaceability):** ARCH-124's purity (post-v27g, `clock.js` is in `ui/`); ARCH-123's closed map; `solid_check` 0 cycles across the two-layer client (review §4) — nothing here widens a dependency.

---

## 3. Consumability — interface friendliness and integration cost

*System altitude. Agent altitude: no change — the MCP tool surface and `run_agent_log`'s shape are not in this scope (QD-C2/C3 remain §9 debt).*

### C-1 — AC-3a: the shell's contract becomes four lines an integrator can read

Whoever fronts the dashboard with a reverse proxy, embeds it, or one day server-renders a view needs to know exactly what the server supplies: (1) root attributes `data-theme="dark" lang="zh-Hant"` stamped before paint by `theme-init.js`; (2) three same-origin asset references under `/static/dashboard/*`; (3) one JSON island `#rwe-init` with schema `{version, lastUpdate?, interruptedRuns?}` — **the only server→client data path at load** (everything else is `/api/*`, key-set pinned by ADR-054); (4) one module entry `ui/app.js`. Layer 1 of the ARCH-122 amendment is that list; the pre-v27 body adds nothing to it and misleads anyone reading the served source. `DASHBOARD_HTML` stays exported (the page-source tests' subject; DES-200's signature).

### C-2 — AC-2: `npm run typecheck` gains one sentence of meaning, and the limit is stated where a contributor looks

One command, two programs: "the whole tree with DOM (tests and client readability), then the server alone without it". The one-line comment in `tsconfig.server.json` (above) and the amended ADR-049 are where a contributor learns why `document` is refused in `src/` but accepted in `tests/`. The `checkJs` limit — client internals are not type-checked — is recorded in the ADR rather than discovered the day someone assumes `tsc` covers `ui/*.js`.

### C-3 — DASH-1: the ledger is consumed by people through `dashboard.html`

A diagram that renders 「圖渲染失敗」 is a documentation defect at the point of consumption; the human reading the v27 process view is precisely the reviewer deciding whether the architecture matches the tree. The authoring rule (§1 O-2) is the one-sentence contract; the four replacements are the repair.

**Verified consistent (Consumability):** `buildDashboardHtml()`'s signature and one caller (`server.ts:1334`); the island's `<` escaping (UT-240); ADR-054's key-set lock now asserted against served bodies (v27g AC-1).

---

## 4. Self-sustainability — closed-loop autonomy and lifecycle

*System altitude. Agent altitude: no change — memory metabolism, tool-liveness probes and prompt calibration are not touched by three document repairs.*

### S-1 — AC-2: put the guard where the system rebuilds itself, or it decays

`deploy/rwe-update.sh:132-147` runs `npm ci` then `npm run build` and reverts on failure. Wiring the server-only program into `build` — not only `typecheck` — means every self-update re-proves the property with no human in the loop, and a regression is refused *before* the restart rather than found under Node at runtime. A guard that lives only in a developer-invoked script is a convention; one in the update path is a control. Cost: +3.7 s per build (M1).

### S-2 — AC-3a: the honest floor is zero mechanism

The static pre-boot text is self-sustaining in the strictest sense: it needs no timer, no listener, no state — the browser shows it until the module removes it, and if the module never runs, the truth stays on screen. NB-2's watchdog adds the one distinction (slow vs. dead) at six lines; NB-1's syntax guard prevents the commonest cause from shipping. Both are fenced as non-blocking; the floor is the repair.

### S-3 — DASH-1: a render oracle closes the loop the lexical checker cannot

The review proved the lexical checker produces false positives (6 `erDiagram` cardinalities) and false negatives (this pair, one of which was *re*-recorded as a false positive an iteration ago). A ledger that lints its diagrams will ship a broken one again; a ledger that renders them (NB-3) will not. The oracle is the repo's own cached Chrome plus the same CDN URL `dashboard.html` already depends on — no new dependency, and the offline case degrades to a loud skip exactly as the dashboard itself does.

### S-4 — the two follow-up TASKs and the trace baseline

Each TASK without an IMPL adds one `未實作` LOW to the 33-gap baseline the reviewer tracks (TASK-018/153 are the precedent). **Recommendation: a micro impl dispatch (v27h) before the re-review**, scoped to TASK-A (shell body + five pins) and TASK-B (`tsconfig.server.json` + two script lines) — together under 30 lines, B already verified to compile clean on this tree, A's blast radius enumerated above. If the orchestrator declines, the recorded cost is **+2 LOW** and both ADR/ARCH rows carry the "unguarded until it lands" sentence so no assertion contradicts the tree.

**Verified consistent (Self-sustainability):** ARCH-123's `no-store` on client bytes (a self-update cannot leave a stale client against a new API); the v27g AC-8 woff2 directive; INV-V27-5's panel now asserted in the rebuilt nav.

---

## Proposed ledger edits (verbatim-ready for the synthesizer)

| Row | Edit |
|---|---|
| **ADR-049** | Title gains `[amended v27g Gate 8 repair: the root tsconfig DID change — see Consequences]` (or `superseded_in_part:` on the title line). Consequences: replace 「`allowJs`/`checkJs` and a `DOM` lib are deliberately NOT added to the root tsconfig…」 with: 「IMPL-229 added `DOM`, `DOM.Iterable` and `allowJs:true` to the ONE root tsconfig so acceptance `page.evaluate` callbacks type-check and `.js` exports are readable to `.ts` tests; a tests-only DOM config is infeasible (tests import `src`; one program). The compile-time property this ADR named — the server compiles without DOM and without the client — is restored by the INVERSE program `tsconfig.server.json` (`src` minus `src/dashboard`, `lib:["ES2022"]`, no `allowJs`), run beside the root config in `typecheck` and `build` (TASK-B); falsification: a planted `document` reference fails TS2584. Editors keep DOM in server files; CI and every self-update do not. `checkJs` stays off: the client tree is readable to `tsc`, not checked by it (opt-in per-file `// @ts-check` in `lib/` is the non-blocking path). **Until TASK-B lands the property is unguarded.**」 |
| **ARCH-124 note** | Replace the `"lib":["ES2022"]` sentence with the inverse-program sentence above; keep everything else. |
| **ARCH-122 api** | Layer 1: `<html data-theme="dark" lang="zh-Hant">` + `<head>` (charset, viewport, title, `<link rel="stylesheet" href="/static/dashboard/dashboard.css">`, `<script src="/static/dashboard/ui/theme-init.js">` classic/blocking) + `<body>` containing `<script type="application/json" id="rwe-init">{version, lastUpdate?, interruptedRuns?}</script>` and `<script type="module" src="/static/dashboard/ui/app.js">`. **No CSS in the shell** (DES-200 v27c). The nav, source tag, tab shells, `#dag-zoom`/`#dag-graph`/`#dag-fit`, `#run-usage`, `#diagram-zoom`/`#diagram-img`, component classes and panel container are **client-built (ARCH-125)**. Legacy markup between `<body>` and the island (`dashboard-page.ts:92-152` at `eb387a1`) is discarded by `app.js:455` before first paint: non-contractual, not a test subject, removed by TASK-A. Layer 2 (TASK-A): `<body>` = `<main><p class="empty">儀表板載入中… / Loading dashboard…</p><noscript>…</noscript></main>` + island + module script. |
| **ARCH-122 note** | Strike 「still assertable here」 and the CSS-in-this-file clause; insert the pin rule (§2 R-2) and the boot-failure honesty sentence (§1 O-1); record the bilingual pre-boot literal as a boundary exception of DES-201's class. |
| **02-architecture.md `:2539`, `:2547`, `:3574`, `:3576`** | The four replacements in §1 O-2, then `sh .sdlc/trace` to regenerate `dashboard.html`. Add the one-sentence authoring rule to the file's diagram conventions. |
| **TASK-A (new, Gate 6)** — the shell body becomes a mount point | files: `src/dashboard-page.ts`, the four test files in §2 R-2; dod: `<body>` = mount + island + module script, UT-240's new negative (`no <section/<header`) green, the five pins re-pointed/retired per the table, full unit suite green, class-lock unchanged. |
| **TASK-B (new, Gate 6)** — the inverse program | files: `tsconfig.server.json`, `package.json`; dod: `npm run typecheck` runs both programs and exits 0 on the tree; a planted `document.title` in any `src/*.ts` outside `src/dashboard/` fails with TS2584 (falsified, then reverted, per v27g's practice); `deploy/rwe-update.sh` unchanged (it already calls `npm run build`). |
| **Owed, routed (not Gate 2's rows)** | DES-200 boundary + signature; TASK-205 `dod:`; UT-240's last case — all carry the v27g/AC-3a re-point. |
| **Recorded, non-blocking** | NB-1 `node --check` guard over `src/dashboard/**/*.js`; NB-2 `theme-init.js` boot watchdog by element presence; NB-3 render oracle beside `.sdlc/` tooling (TOOL debt, beside TOOL-FORK). |

## key_points

1. **DASH-1 has four semicolons, not two** — `:2539`+`:2547` and `:3574`+`:3576`; fixing only the review's two leaves both diagrams failing (M3, real mermaid@11 from `dashboard.html`'s own URL). Exact replacements verified; regenerate `dashboard.html` afterwards. Rule: only a line-start `%%` comment tolerates `;` in a `sequenceDiagram`.
2. **AC-2 is option (i) with a real guard, not option (ii)**: a tests-only DOM config is infeasible (one program), so record what shipped and restore the property with the inverse program `tsconfig.server.json` — compiles clean today (76 files, 3.7 s), red on a planted `document` (M1/M2), wired into `typecheck` **and** `build` so every self-update re-proves it. Amend ADR-049's *title*, not just its Consequences; state the editor limit; say "unguarded until TASK-B lands".
3. **The compiler is the right subject** for the boundary: no allowlist (`auth-service.ts:273`'s HTML string), sees types and transitive imports, already installed — versus a grep guard that sees none of these. Lineage: the refused Sprint A second-tsconfig idea, pointed the right way.
4. **AC-3a in two layers**: Layer 1 (contract = head + island + module script; body fossil non-contractual, discarded by `app.js:455`) is true of the tree now; Layer 2 (mount point + static pre-boot text, class `empty`, no `app.js` change) is TASK-A. Also fix the two other stale clauses in the same row (CSS left the shell at v27c; "still assertable here").
5. **The fossil is an observability defect, not tidiness**: a boot failure today paints a page indistinguishable from an idle engine; the realistic cause (a syntax error in unit-tierless `ui/*.js`, `checkJs` off, Chromium tier skipped) has no guard at all (verified).
6. **Blast radius enumerated**: five dead pins with DES-208 dispositions; class-lock verified safe (0/104 hooks, 0/23 anchors shell-only); DES-200 and TASK-205 carry the same stale `draggable` claim and are owed to design.
7. **Follow-ups cost trace gaps**: recommend a v27h micro dispatch (TASK-A + TASK-B, <30 lines, B pre-verified); otherwise +2 LOW recorded and both rows carry the "unguarded until" sentence so nothing contradicts the tree.
8. **Three extras fenced as non-blocking** (NB-1 syntax guard, NB-2 watchdog, NB-3 render oracle) with costs stated; none is in the repair text.

## risks

| # | Risk | Mitigation in this proposal |
|---|---|---|
| QD-G8-R1 | The synthesizer follows the review's "two semicolons" literally → both diagrams still fail at the re-review, DASH-1 re-opens as a repeat miss (blocking under the ledger's own rule) | §1 O-2's four verified replacements; regenerate `dashboard.html`; re-run `mermaid.parse` (NB-3's script is in the scratchpad, ~30 lines) |
| QD-G8-R2 | An amended ADR-049 beside an unchanged `tsconfig.json` — the finding's explicit warning | the rows say "guard restored by TASK-B; unguarded until it lands"; v27h dispatch recommended |
| QD-G8-R3 | ARCH-122 rewritten to the target shape while the fossil still ships → the same contradiction class at re-review | Layer 1 describes the tree; Layer 2 is a TASK with DoD |
| QD-G8-R4 | Removing the fossil goes red somewhere unlisted | five pins enumerated at HEAD; class-lock measured safe; UT-240's new negative pins the shape |
| QD-G8-R5 | DES-200 / TASK-205 keep the stale `draggable` clause because design's re-run is DASH-2 only | recorded as owed and routed to the orchestrator in the ledger-edit table |
| QD-G8-R6 | The second `tsc` pass drifts out of `build` (someone "simplifies" the script) | it is the ADR's named guard with a falsification; UT could pin `package.json`'s `build` script contains `tsconfig.server.json` (cheap, optional) |
| QD-G8-R7 | Bilingual pre-boot literal read as a REQ-131 string-table violation | recorded as a DES-201-class boundary exception; language-neutral fallback offered |
| QD-G8-R8 | IDE still offers DOM in server files | stated as the accepted limit; CI/build enforce |
| QD-G8-R9 | The panel treats NB-1/2/3 as scope creep and discards the repair with them | they are fenced and separable; the repair stands without them |

## expected disagreements with the adversarial lens (security × scalability × testability, Karpathy tie-breaker)

| # | Topic | My position | Their likely position | Tie-break I propose |
|---|---|---|---|---|
| ED-1 | AC-2 guard form | inverse-program tsconfig (8 lines JSON + 2 script lines) | (a) a grep guard with planted-violation self-case — INV-V27-8's house style; or (b) record-only, no guard ("the property was never load-bearing") | The subject decides (retro lesson 1): the compiler *is* the property; grep needs an allowlist on day one (`auth-service.ts:273`) and misses types. Against (b): ADR-049's own text called it the reason for `lib:["ES2022"]`; dropping it is a decision the ADR must state, not an omission. Note they proposed a second tsconfig first (D-ADV-5) — I expect agreement here more than dispute. |
| ED-2 | NB-2 boot watchdog | six lines, element-presence detection, non-blocking | mechanism for a case the static text already covers | I concede on request; the static text is the floor and is in the repair. |
| ED-3 | NB-1 `node --check` guard | fold into TASK-A if allowed; else §9 debt | beyond §8, a new test file for a hypothetical | The failure is not hypothetical — no tier parses `ui/*.js` and the Chromium tier skips without a browser; but it is outside §8 and I hold it as non-blocking. |
| ED-4 | `:2547` spelling | `→` (reads as the transaction's order) | `#59;` (keeps the SQL literal) | Both verified; the architect's call. Constraint: not `;`. |
| ED-5 | Whether the fossil must go at all | yes — it impersonates a working page on boot failure | leave it (harmless, discarded) and amend only the text | Layer 1 alone satisfies the routing rule; Layer 2 is the observability seam. If they hold, TASK-A shrinks to the pins + the UT-240 negative and the fossil is recorded as debt with the ghost-page consequence named. |
| ED-6 | v27h micro dispatch vs. +2 LOW | dispatch (both changes pre-scoped, B pre-verified) | accept the LOW rows; the re-review only needs consistency | Either is honest once the "unguarded until" sentence is in the rows; the dispatch removes the sentence. |
| ED-7 | Gate 2 touching DES-200 / TASK-205 | record and route, do not edit cross-gate | may say the architect should just fix the two clauses | The ledger's own precedent (v27b: "a supersession MARKER is owed wherever the mask is still described; a REWRITE is scope creep") — a one-line re-point note is a marker, so either reading is defensible; the synthesizer decides, the obligation must not be dropped. |
