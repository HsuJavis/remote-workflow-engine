---
stage: design
lens: quality-dimensions
iteration: v27 — Sprint A closure RE-OPENED at the design gate (invocation `gates:[design,impl,verify,validation,review]`, journal 2026-09-12 「Gate 6 partial」): the one item routed back is the unowned `dashboard.css`
round: 1 (independent proposal)
closure: REQ-131..136, REQ-140, REQ-141 (unchanged); REQ-137/138/139/142/143 stay out and are only named where an attachment point is decided here
builds_on: my Sprint A design r1 (`git show 07266be:.sdlc/features/001-remote-workflow-engine/.panel/design/quality-dimensions.r1.md`) and the v27b delta r1/r2 (`git show c7447d0:…/.panel/design/quality-dimensions.r{1,2}.md`) — everything those settled and 04-design.md's two rationales adopted (the CSS-native ramp, `REQUIRED ⊆ keys ⊆ ALLOWED`, `stripFirstSegment` fail-closed, the settle-then-reschedule timer, `warningText`, the four deletions) is CITED, not re-argued. This file overwrites the v27b delta r1; that file stays readable at the commit above.
what_changed_since: Gate 6 ran (commit `f86ea25` + repair `8b07ed7`/`7737ce1`); the client tree EXISTS on disk now (23 files under `src/dashboard/`), so this round measures the implementation instead of predicting it.
verified_this_round (file:line, all re-read at the working tree, HEAD 4e7412c): src/dashboard/dashboard.css :1-7 (served AND inlined, "one source, two destinations"), :13-51 (tokens), :56-60 (@font-face), :62-67 (the implementer's own "NOT built here: swimlane/agent-panel/ported-tab component CSS … no other owner" note), :68-126 (the pre-v27 port; `.st-failed{color:#B0776E}` :79); 44 class selectors total (measured); src/dashboard-page.ts :65-68 (`readFileSync` of the css at module load), :87-88 (`<link>` AND `<style>${DASHBOARD_CSS}`), :100-146 (shell markup classes: back cards fit-btn issue-detail mdl pill zoomable — all styled); src/dashboard/ui/run.js :1-15 (header: "this module owns a second, self-rescheduling fetch+repaint loop … flagged to the orchestrator"), :85-93 (1 svg unit === 1 CSS px; `viewBox`, `width=100%`, `preserveAspectRatio`), :89 (wrapper sized in px from `svgBox`), :106-112 (hairline `stroke #34363c`), :114-125 (lane head `font-size 13` / `font-weight 600` / `style="letter-spacing:.04em"` / `fill #9fb8d6|#8e97a3` / `.toUpperCase()` in JS), :132-141 (edge `stroke-width 1.2`, `#5b6068|#8e97a3`, `stroke-dasharray 4 4`), :146-153 (trigger rect), :157-167 (agent `<rect>`: `STATE_FILL`, `FAILED_COLOR`, `#34363c`, `#4a4d55`, `opacity .65`, `rect.style.cursor`), :171-174 (dot `r=4`), :178-183 (label `13.5`/`600`/`#e7e9ec`), :187-193 (usage `10.5`/`#8e97a3`), :217 (`summary.style.float`), :260-262 / :279 (container `420px`/margin/minHeight in JS), :281 (`svgEl.id = 'dag-graph'`), :297 (`render`), :304-315 (the view's own `getJSON` ×2 + `setTimeout(tick, 3000)`); 12 hex literals in run.js, 1 in agent-panel.js (measured); src/dashboard/ui/agent-panel.js :104 (backdrop `cssText` with `rgba(8,12,9,.5)`), :110 (panel `cssText`, `width:420px`), :180 (detail block `cssText` with `oklch(0.3 0.12 25)`), :207-209 (`openAgentPanel`, `?limit=500`); src/dashboard/ui/workflow.js :11-14 (same own-loop caveat), :72 (`desc.style.maxWidth = '720px'`), :84-89 (container px in JS), :178 (`dot.style.fontSize = '7px'`), :189 (selected row `rgba(159,184,214,.07)` — a LITERAL, not the accent), :195, :205 (`render`), :211/:274-280 (`selectedRunId` is view-local; the DAG + detail of the selected run are fetched by the view), :293/:305 (own `setTimeout`); src/dashboard/ui/home.js :66 (concatenated modifiers `'card' + ' running'|' other'`), :70-173 (class names set), 0 inline styles; src/dashboard/ui/app.js :23-24, :252-272 (`tick()` fetches `endpointsFor(view)`, keeps ONLY `primaryBody`, renders it ONLY for `home`, discards the rest), :280-282 (the one settle-then-reschedule timer), :294 (`mod.render(container, {}, {})` — an EMPTY vm), :130-132 (tab modules mounted once with `{}`); src/dashboard/ui/{system,issues,models}.js :82/:102/:65 (three more own `setTimeout(tick, 3000)` loops) — SIX timers in `ui/` (measured: `grep -n setTimeout src/dashboard/ui/*.js`); src/dashboard/ui/poll.js :15-26 (`ROUTES`: workflow → describe + `/api/runs`; run → `/dag` only), :32-35; tests/acceptance/val-198-shell-and-home.test.ts :82/:99/:113 (the ONLY three `getComputedStyle` reads in the acceptance tier — all three read a token on `documentElement`), val-200-swimlane.test.ts :87/:101/:109 (lane header existence + one 216×74 box; nothing else), val-199/val-201/val-202 (0 computed-style reads — measured); tests/unit/dashboard-page-source.test.ts :23/:35/:72-74/:78 (five CSS assertions whose SUBJECT is `DASHBOARD_HTML` — the reason the inline copy exists); tests/helpers/client-corpus.ts :18 (`.js` only), :33 (`clientFile(rel)`); tests/unit/dashboard-no-external-host.test.ts :27 (walks `.css` + `.js` — DES-191 landed); 03-tasks.md :1734-1741 (TASK-205: files `dashboard-page.ts` + `dashboard.css`; DoD = tokens + C1 pins ONLY), :1752-1759 (TASK-207), :1779-1786 (TASK-210: pixel DoD, no `.css` file), :1788-1795 (TASK-211), :1797-1804 (TASK-212), :1641-1647 (ordering rule 5); 04-design.md :6788-6794 (DES-200: `<link rel="stylesheet">`), :6836-6842 (DES-206: `render(container, vm, handlers)`, "app.js … owns ONE timer", VMs in / DOM out), :6852-6858 (DES-208: STAYS pins "still assertable against `DASHBOARD_HTML` or against `dashboard.css` bytes"); 02-architecture.md :3336 (ARCH-122 api: the `rwePulse/rweSweep/rweGlow/rweRing` keyframes and the `.card/.t/.tag/.btn` component classes live in the shell CSS), :3364 (ARCH-125 api: swimlane "built with `createElementNS` + `textContent` inside `#dag-graph`"), :3461 (ADR-053: "a table-driven `getComputedStyle` check … one row per delivery-README spec line"), :2927-2933 (ADR-044); 01-requirements.md :1613-1620 (the handoff: project `38fc8181-…`, `design_handoff_workflow_dashboard/{README.md, Workflow Dashboard.dc.html, rwe-data.js}` — NOT on disk in this checkout, `find` measured), :1665-1669 (C4), :1716-1736 (REQ-131), :1738-1754 (REQ-132), :1756-1772 (REQ-133), :1774-1797 (REQ-134 — node rows ①②③ at :1784-1786, running/failed/queued at :1787-1789), :1799-1817 (REQ-135); journal.md :3819-3827 (the routing sentence).
---
# Quality-dimensions — v27 DESIGN r1 (closure re-opened): the unowned stylesheet is a CLASS CONTRACT nobody wrote, the 99% oracle is a table Gate 5 never built, and the "one timer" is six

## summary

**The answer to the question the gate asked, first.** `dashboard.css` gets ONE owner — a new task (call it
TASK-214) whose deliverable is the whole component + view stylesheet to the REQ-131..135 constants, ordered
BEFORE val-198..201 are judged — and TASK-207/210/211/212 keep their pixel DoDs but gain one sentence each:
*this task adds no `.css`; the rules it needs are TASK-214's*. That is a TASK/DES repair, not an ARCH change:
ARCH-122's `api:` line already puts the four keyframes and the `.card/.tag/.btn` component classes in the shell
CSS (`02-architecture.md:3336`); TASK-205 simply scoped itself to "tokens + the pre-v27 port"
(`03-tasks.md:1734-1741`), and the implementer said so in the file (`dashboard.css:62-67`). Measured size of
the hole: **29 of the 40 class names `ui/*.js` sets have no rule at all** (`card-grid card-section event-list
event-row home-search home-toolbar kicker meta run-view rwe-connection rwe-hue-slider rwe-nav rwe-tabs
segment-tabs stat-cards stat-label stat-value tag tag-columns workflow-view …`), and my extractor UNDER-counts
— it misses `home.js:66`'s concatenated modifiers and every SVG attribute in `run.js`.

**But "assign the CSS" is not enough, for three reasons this round measured rather than predicted:**

1. **The design values are not waiting in a stylesheet to be written; they are already in JS, as the wrong
   values.** `run.js` paints the swimlane with **12 hex literals as SVG attributes** — dark-theme hairlines
   (`#34363c`), the "accent" lane header as the OLD Morandi link colour (`#9fb8d6`), edges, fills, dots — plus
   font sizes and `letter-spacing` as attributes; `agent-panel.js` styles the backdrop, the panel and the red
   detail block through `cssText`; `workflow.js` hard-codes `maxWidth = '720px'`, a 7px dot and the selected
   row as `rgba(159,184,214,.07)` (a literal — REQ-133 says 7% *accent*). Consequences: the run view does
   not follow the light theme or the hue slider at all, and **VAL-198 cannot see it** — its three
   `getComputedStyle` reads are all tokens on `documentElement`. A CSS task that only writes rules leaves
   every one of those values where the stylesheet cannot reach them. The task must also RELOCATE them
   (§2 R-3), and the design must say what may stay in `ui/` (`display`, the zoom `transform`, `--rwe-hue`,
   the wrapper's px size from `svgBox`) — which is a one-line allowlist, not a style guide.
2. **REQ-134's node cannot be drawn on the substrate `run.js` chose.** Row ① wants 溢出省略 (an ellipsis —
   SVG `<text>` has no `text-overflow`), row ② wants a `.tag-neutral` *component* inside the node (an HTML
   element cannot live inside a `<rect>`), the running node wants `--shadow-md` (no `box-shadow` on SVG
   elements). So a CSS author handed the painter as written cannot deliver REQ-134's node against it. The
   design must decide the substrate first: **HTML node layer positioned by the SAME `cellRect` over the SVG
   edge layer, both children of `#dag-zoom`** (INV-V27-6 and ADR-044's "client-constructed DOM + `textContent`"
   both survive; `#dag-graph` stays the SVG and keeps its C2/UT-253 pins), with `foreignObject` as the recorded
   runner-up (§2 R-4). Left undecided, the CSS implementer invents it.
3. **ADR-053's oracle for 「99% 相似」 does not exist.** The ADR promises "a table-driven `getComputedStyle`
   check, one row per delivery-README spec line"; Gate 5 wrote three token reads (val-198) and one 216×74 box
   (val-200). Nothing on disk can fail when a lane header is 12px, an edge is 1px, a running node has no
   `rweGlow`, or the swimlane stays dark on the light theme. This is the observability seam for the owner's
   first-ranked success criterion, and it is missing — not as new scope, as the row the ADR already named
   (§1 O-1). The rows must be RELATIONAL (element ↔ token on the same page, both themes, after a hue move),
   not literal `oklch(…)` strings.

**Two further findings, sized and made optional so the synthesizer can rule without me:**

- **DES-206's "ONE timer" is six on disk.** `app.js`'s tick fetches the visible view's endpoints, keeps ONLY
  `primaryBody`, renders it ONLY for `home`, and calls every other view with `render(container, {}, {})`
  (`app.js:252-272`, `:294`) — so `run.js`, `workflow.js`, `system.js`, `issues.js` and `models.js` each
  built their own `setTimeout(tick, 3000)` loop, and `run.js` flagged it (`:1-15`). The run view now fetches
  `/api/runs/:id/dag` TWICE per tick (once for the connection tag, once to paint), the connection reducer
  never sees the view loops' failures, and REQ-142's later visibility gate would attach to one loop of six.
  This is in closure (it is DES-206/TASK-208's own contract) and it does NOT block the CSS task; the fix is
  one `onTick(container, bodies, ctx)` hook and five deletions (§4 S-1), with the deferral form and its
  recorded consequence stated so deferring is a decision, not an oversight.
- **The handoff is not in this repository.** The spec of record inside the repo is the constants REQ-131..135
  enumerate (tabled in §3 C-1 as the fixture seed); everything the REQ prose does NOT enumerate — the nav,
  tabs, tables, tag paddings, the Classical component look — is unverifiable here until
  `design_handoff_workflow_dashboard/README.md` is vendored under `.sdlc/…` (the README ONLY —
  `rwe-data.js` carries the C3 word and is a Gate 8 finding anywhere in the repo). That is an
  orchestrator/owner action; the DES should say what
  "99%" can mean until it happens.

One decision line, low priority: the shell delivers the stylesheet TWICE (`<link>` + an inline copy read at
boot, `dashboard-page.ts:65-68, :87-88`) because UT-241's five CSS assertions take `DASHBOARD_HTML` as their
subject; keep one path (§2 R-5).

## Altitude call

**Both, and the split is unchanged from Gate 2 and my two prior rounds.** *System altitude* — REQ-131 (shell,
tokens, fonts, i18n, connection tag), REQ-132/133 (views), REQ-134 (swimlane), REQ-140/141 (wire, untouched
this round). *Agent altitude* — REQ-135 (the slide-in panel IS the agent's inspectability) and REQ-136 (already
built at the decoration site; nothing here reopens it). This round's subject — a stylesheet and a poll loop —
is almost entirely system-altitude; the agent-altitude reading enters exactly where the panel's styling is
what makes `record`/`harness`/`events` LEGIBLE (§1 agent altitude) and nowhere else. Memory metabolism, tool
liveness and prompt calibration have no seam in this closure; each dimension says so in one line.

---

## 0. What Gate 6 left on disk — measured, so the four sections argue from the same facts

| # | Fact | Where | Why it matters to this round |
|---|---|---|---|
| F-1 | `dashboard.css` = tokens (:13-51) + fonts (:56-60) + the pre-v27 port re-mapped onto the tokens (:68-126); 44 class selectors; the implementer's own note that swimlane/panel/tab CSS is unowned (:62-67) | `src/dashboard/dashboard.css` | the routed gap, confirmed at the source, with the implementer's reason |
| F-2 | 40 class names set by `ui/*.js` (under-count: `home.js:66` concatenates modifiers; SVG uses attributes); 11 have a rule, **29 do not** | `ui/*.js` vs `dashboard.css` (comm) | the CSS gap is a VOCABULARY gap first — nobody wrote the contract both sides read |
| F-3 | 12 hex literals as SVG attributes in `run.js` (:108, :121, :139-140, :151-152, :162-163, :172-173, :181, :190); `letter-spacing` as a `style` attr (:119); `.toUpperCase()` in JS (:122); `cssText` ×3 in `agent-panel.js` (:104, :110, :180); `maxWidth`/`fontSize`/`background` literals in `workflow.js` (:72, :178, :189); container px in JS (`run.js:260-262, :279`, `workflow.js:84-89`) | `src/dashboard/ui/` | design values live where no stylesheet reaches them; the swimlane is theme- and hue-blind |
| F-4 | The acceptance tier reads computed style THREE times, all tokens on `documentElement` (val-198 :82/:99/:113); val-200 asserts one 216×74 box (:109); val-199/201/202 read no style | `tests/acceptance/` | ADR-053's table is not built; 「99%」 has no mechanical oracle |
| F-5 | Six `setTimeout(tick, 3000)` loops in `ui/` (`app.js:282`, `run.js:315`, `workflow.js:293/:305`, `system.js:82`, `issues.js:102`, `models.js:65`); `app.js` discards every body but the first and renders only `home` (:252-272, :294) | `src/dashboard/ui/` | DES-206's contract (`render(container, vm, handlers)`, one timer, VMs in) is not implementable as `app.js` was written, so every view worked around it |
| F-6 | The stylesheet is delivered twice: `<link>` (:87) AND `<style>${DASHBOARD_CSS}` read at module load (:65-68, :88); UT-241's five CSS pins take `DASHBOARD_HTML` as subject (`dashboard-page-source.test.ts:23/:35/:72-74/:78`) | `src/dashboard-page.ts` | "one source, two destinations" cannot drift, but it is two delivery paths for one byte stream |
| F-7 | No `design_handoff_workflow_dashboard/`, `*.dc.html` or `rwe-data.js` anywhere under the checkout or the home tree | `find` (measured) | the spec of record in-repo is REQ-131..135's constants and nothing else |
| F-8 | The guards already walk `.css` (`dashboard-no-external-host.test.ts:27`; DES-191 landed); `clientCorpus()` is `.js`-only (`client-corpus.ts:18`) but `clientFile('dashboard.css')` reads the file (:33) | `tests/` | the offline stance is safe; the pin subject for CSS bytes already exists |
| F-9 | `run.js:85-93`: the SVG is native-scale (1 unit = 1 px; wrapper sized from `svgBox` in px; `viewBox` + `width=100%` + `preserveAspectRatio` — UT-253's pins) | `src/dashboard/ui/run.js` | an HTML node layer positioned in the same px coordinates lines up with the SVG edge layer by construction |
| F-10 | `ROUTES.workflow(ctx)` = describe + `/api/runs`; the selected run's `/dag` + detail are fetched by the view against a view-local `selectedRunId` (`poll.js:15-26`, `workflow.js:211, :274-280`) | `src/dashboard/ui/` | the poller fix must let a view chain a state-dependent fetch INSIDE the tick, not carry UI state in `ROUTES` |

---

## 1. Observability

**Design question for this round: when the page is 1% off the design, or dark on the light theme, or polling
twice, what goes red — and when nothing does, is that a decision?**

### System altitude

**O-1 — Build ADR-053's table, and make its rows relational.** ADR-053 (`02-architecture.md:3461`) is explicit:
「a table-driven `getComputedStyle` check in the real browser — one row per delivery-README spec line」. F-4
shows the table was never written — and the omission is THIS gate's own, not Gate 5's: DES-201's `tests:` line
(`04-design.md:6801`) scoped 「the computed-style table」 to REQ-131's tokens, and DES-203/DES-206 asked the
browser tier for geometry and existence only, so Gate 5 wrote exactly what Gate 4 asked for. Proposal, at the
design altitude: `tests/fixtures/dashboard-spec.ts` exports
`SPEC_ROWS: ReadonlyArray<{ req: 'REQ-131'|…|'REQ-135'; view: 'home'|'workflow'|'run'|'panel'; anchor: string;
prop: string; expect: { literal: string } | { token: string } | { animation: [name, duration] } }>` — one row
per REQ constant (the seed table is §3 C-1), and val-198/199/200/201 each iterate the rows of their view under
BOTH `data-theme` values and once more after moving the hue slider. Three row kinds, because three kinds of
value exist:
- **literal** — a size or timing the REQ states as a number: `getComputedStyle(el)[prop] === literal`
  (`'216px'`, `'1.2px'`, `'0.04em'`, `'uppercase'`, `'ellipsis'`, `'0.65'`).
- **token** — a colour the REQ states as a token name (accent, accent-100/600, divider, neutral-500, text
  colour): compare the ELEMENT's computed value to the computed value of a probe element styled
  `color: var(--<token>)` on the SAME page. Never a literal `oklch(0.72 0.065 236)` string: that hard-codes
  Chromium's serialization and is false for every hue but the default. The relational row is the one that
  catches F-3 — under `data-theme="light"` a node's `stroke` must equal `var(--color-line)`'s light value,
  and after the slider moves the current lane header must equal the new `--color-accent` — and it holds
  for any hue and any future palette edit without touching the test.
- **animation** — `animationName`/`animationDuration` on the element (`['rweGlow','1.8s']`,
  `['rweRing','1.3s']`, `['rweSweep','2.4s']`, `['rwePulse','1.6s']`) and the panel's `transition`
  (`'.28s cubic-bezier(.2,.7,.2,1)'`).
The screenshots to `evidence/v27/` stay as the owner's side-by-side (Q10); the table is what CI can fail on.
Anti-vacuity: `SPEC_ROWS.length ≥ 40` and every `anchor` must match ≥ 1 element or the row FAILS (a row that
matches nothing is the vacuous green DES-208 warned about).

**O-2 — The theme-blind swimlane is a silent failure today; name the row that ends it.** F-3 + F-4 together:
switching to light repaints the page chrome and leaves the graph painted in dark-theme hex; the hue slider
moves `--color-accent` and the "accent" lane header stays `#9fb8d6`. VAL-198's light case passes (it reads
`--color-bg`). The fix is R-3 (values out of JS) plus ONE relational row per view per theme in O-1's table —
the cheapest observable seam there is, and it is the seam that makes REQ-131's 「版面隨之改變」 mean the whole
page rather than the token it samples.

**O-3 — Six pollers make the connection tag a partial truth.** `nextConnection` is fed by `app.js`'s tick only
(`app.js:264`); `run.js`/`workflow.js`/the three tabs fetch on their own loops and their outcomes never reach
the reducer. So the nav can read 「連線中 / Live」 while the run view's own loop is failing (or the reverse:
the tag goes Offline on the connection loop while the view keeps painting from its own). One reducer, one tick,
every fetch — that is DES-202's whole design and it is bypassed by construction. The remedy is §4 S-1; the
observability consequence is why it belongs in this closure rather than in v28.

**O-4 — A class with no rule is the most silent failure on this page, and it needs a node-tier lock.** F-2:
29 of 40 hooks render unstyled today and every unit test is green, because nothing reads the vocabulary from
both sides. Proposal (the lock's shape matters more than its existence): the class contract is a DECLARED
list in a fixture (`tests/fixtures/dashboard-classes.ts` — `STYLE_HOOKS` and `TEST_ANCHORS`, the two columns
of §2 R-2's table), and one `.ts` unit test asserts every `STYLE_HOOKS` entry appears as a selector in
`clientFile('dashboard.css')` and every `TEST_ANCHORS` entry appears in `clientCorpus()` or `DASHBOARD_HTML`.
**Not** a test that re-derives the vocabulary from `ui/*.js` by regex — my own extractor missed
`home.js:66`'s concatenation and every SVG attribute, so a regex-derived list is exactly the vacuous green
this lock exists to prevent. The reverse direction (every CSS selector used in JS) is NOT asserted: a
stylesheet may carry states and helpers the JS reaches by cascade.

**O-5 — The inline copy of the stylesheet is not a mirror pair, but it is two delivery paths.** F-6: the
bytes are read once at boot and emitted twice, so they cannot drift; what is lost is one truth about which
path served the page (a `no-store` `<link>` that 404s is invisible because the inline copy paints anyway).
Decision line in §2 R-5.

### Agent altitude

**O-6 — The panel's styling is what makes the agent's record LEGIBLE; the values are in `cssText` today.**
REQ-135's panel is the only surface that joins `record` (state, provider · transport · proxyModel, four token
columns, cost, `detail`) to `harness` (prompt, tools, MCP, skills) and to the event stream. On disk the
backdrop, the panel box and the red `detail` block are `cssText` literals (`agent-panel.js:104, :110, :180`)
and the six stat cards / tag columns / event rows carry classes with no rule (F-2: `stat-cards stat-label
stat-value tag-columns event-list event-row tag`). The panel therefore renders its facts as an unstyled list;
a failure `detail` is not a red block, a kind tag is not a tag. Nothing about the agent's inspectability
changes in this round except that it becomes visible — the `data-agent-panel` anchor VAL-201 keys on stays,
the wire is untouched, and chain-of-thought / token / tool-call inspection are exactly as REQ-135/140 built
them. One row per stat card and one per event-kind tag in O-1's table is the whole obligation.

---

## 2. Replaceability

**Design question for this round: is every design value in exactly one home (the stylesheet), is the contract
between the DOM layer and that home written down, and can the swimlane be restyled without touching a
formula — or the painter rewritten without touching a colour?**

### System altitude

**R-1 — Ownership: one stylesheet, one owner, ordered before the views are judged.** Proposal: **TASK-214 —
`dashboard.css`: the component and view sections to the REQ-131..135 constants, and the class hooks that
reach them** — `files:` `src/dashboard/dashboard.css`, `src/dashboard/ui/{run,agent-panel,workflow,home,app}.js`
(hook edits only), `tests/fixtures/dashboard-classes.ts`, `tests/fixtures/dashboard-spec.ts`, the two
node-tier tests (O-4, R-3); `des:` a new DES-209; `estimate:` L. The file keeps its ONE `STATIC_ASSETS` key and
is organised in **sections headed by the REQ they implement** (`/* == REQ-131 shell: nav · tabs · connection
tag · controls == */`, `/* == REQ-132 home == */`, `/* == REQ-133 workflow detail == */`, `/* == REQ-134
swimlane == */`, `/* == REQ-135 agent panel == */`, `/* == components (Classical borrow): .card .tag .btn
.table .seg .input .nav .hr == */`) so a reader and the trace chain find a rule by its requirement. Runner-up,
recorded and refused: **per-view CSS files** (`ui/home.css`, `ui/run.css`, …) each owned by its view task —
it needs new map keys (closed both ways: DES-199), extra `<link>`s in the shell, and above all it makes FOUR
authors spell one vocabulary; and **CSS inside the view tasks** on one shared file is four implementers
writing one file on one working tree in the same gate (the CLAUDE.md hazard) with no arbiter for the class
names. One file, one author, one table is the smallest form that keeps the vocabulary in one head.

**R-2 — The class contract is the design artifact, and it has two columns that must not be confused.**
The DES row carries a table: *REQ clause · style hook (class) · test anchor (`data-*` / C2 id) · set by*.
The two hook kinds have different owners and different stability: **style hooks** (classes) belong to the
CSS author and may be renamed by TASK-214 as long as the JS edit travels in the same commit; **test anchors**
(`data-lane-header`, `data-node-cell`, `data-legend`, `data-agent-panel`, `data-tab`, `data-section`,
`data-run-chip`, `data-history-table`, and the C2 ids `#dag-fit #dag-graph #dag-zoom #run-usage #diagram-img
#diagram-zoom` + `.card .t`) belong to the tests and are FROZEN — VAL-200/201/202 already key on the first
five (`05-tests.md:12149-12150, :12161-12162, :12174`). One instance of the hazard is already on disk:
`val-200-swimlane.test.ts:94` accepts `[class*="lane-head"]` as an alternative to `[data-lane-header]` — a
style class as a test anchor; the synthesizer should freeze `data-lane-header` and drop the class form in the
same edit that moves the headers (R-4). A test keyed on a style class is the C2 problem reborn;
a style keyed on a `data-*` anchor couples the design to the test. Seed of the table (the on-disk names are
ADOPTED, not renamed — a rename costs a JS edit for no property; only the MISSING hooks are new):

| REQ clause | style hook(s) | test anchor | set by |
|---|---|---|---|
| REQ-131 nav, tabs, source tag, theme/lang groups, hue slider, version, update panel | `.rwe-nav .rwe-tabs .rwe-tab-panels .rwe-connection.is-live/.is-degraded/.is-offline .rwe-theme-group .rwe-lang-group .rwe-hue-slider .rwe-version .rwe-update-panel .rwe-update-outcome .rwe-update-cta .rwe-config-check` (all exist in `app.js`) | `data-tab` (VAL-202) | app.js |
| REQ-132 sections, running dot, other opacity, grid, card, kicker, meta, running sweep, hover | `.card-section .card-section.other .card-grid .cards .card .card.running .card.other .kicker .meta` (`home.js:66, :119-173`) + NEW `.card.running::before` (sweep) and the section title dot | `.card .t` (C2), NEW `data-section` | home.js |
| REQ-132 toolbar, search, segment filter | `.home-toolbar .home-search .segment-tabs .seg .active` | — | home.js |
| REQ-133 tags, description width, triggers | `.tag .tag-outline .tag-accent .tag-neutral` (NEW rules; `tag` exists in JS) + NEW `.wf-desc` (replaces `maxWidth` in JS) | — | workflow.js |
| REQ-133 run chips, selected, dot | NEW `.run-chip .run-chip.is-selected .status-dot` (replaces `dataset.selected` + `fontSize='7px'`) | NEW `data-run-chip` | workflow.js |
| REQ-133 history table, live row, selected row | `.table` + NEW `tr.is-selected` (replaces the `rgba` literal) + `.mono` | NEW `data-history-table` | workflow.js |
| REQ-134 lane header, current, hairline | NEW `.lane-head .lane-head.is-current .lane-hairline` | `data-lane-header` (VAL-200) | run.js |
| REQ-134 edges | NEW `.edge .edge.is-active .edge.is-walked .edge.is-pending` | — | run.js |
| REQ-134 nodes (rows ①②③), states, predicted | NEW `.cell .cell.is-running/.is-done/.is-failed/.is-queued/.is-predicted .cell-dot .cell-label .cell-model .cell-effort .cell-usage` | `data-node-cell` (VAL-200) | run.js |
| REQ-134 trigger, legend, summary | NEW `.cell-trigger .legend .run-summary` (replaces `float`) | `data-legend` (VAL-200) | run.js |
| REQ-135 backdrop, panel, side, header, stat cards, prompt, tag columns, events, detail | `.stat-cards .stat-label .stat-value .tag-columns .event-list .event-row` (exist) + NEW `.agent-backdrop .agent-panel .agent-panel.from-left .btn-icon .prompt-pre .event-kind.is-tool/.is-message/.is-log .detail-block` (replace the three `cssText`s) | `data-agent-panel` (VAL-201) | agent-panel.js |
| shell (C1) | `.fit-btn .zoomable #diagram-img` (exist) | C2 ids | dashboard-page.ts |

The synthesizer owns the final spelling; the lens's requirement is only that the table exists, that both
columns are declared in a fixture (O-4), and that a name appears in it BEFORE it appears in code.

**R-3 — No design value in JS: the allowlist is one line, and the guard is a grep with named exceptions.**
After TASK-214, `ui/*.js` may write exactly: `style.display` (state), `style.transform` on `#dag-zoom` /
`#diagram-zoom` (the zoom, INV-V27-6), `style.setProperty('--rwe-hue', …)` (the one theme write, DES-201), and
the wrapper's `style.width/height` from `svgBox` (geometry from DATA, `run.js:89`). Everything else in F-3
moves to a class: fills, strokes, font sizes, weights, `letter-spacing`, dasharrays, opacity, `cursor`, the
container heights, the `float`, the `maxWidth`, the three `cssText`s, the `rgba` row, the 7px dot.
`.toUpperCase()` becomes `text-transform: uppercase` on the HTML `.lane-head` (R-4 moves the headers out of
SVG, so this is plain CSS; the JS call at `run.js:122` is a design rule executed in the wrong layer; the row
in O-1 reads `textTransform`). Node-tier guard (`.ts`,
over `clientCorpus()`): zero matches for `#[0-9a-fA-F]{3,6}\b`, `oklch(`, `rgba(`, `cssText`,
`setAttribute('fill'|'stroke'|'font-size'|'font-weight'|'opacity'|'stroke-dasharray'|'style'`, and
`\.style\.(?!display|transform)` — the ONE geometry exemption (`run.js:89`'s wrapper `width`/`height`
from `svgBox`) carried by a `// rwe-allow-style: svgBox` marker on that line and honoured by the guard as its
sole `width|height` exception, because a bare `(?!…|width|height)` would also admit the container heights at
`run.js:260-262/:279` and `workflow.js:84-89` that this same paragraph says must MOVE — the allowed forms
listed in the test as the exceptions and a positive anchor beside the negatives (`expect(corpus).toContain("style.transform")`), per
DES-208's anti-vacuity rule. Geometry attributes (`x y width height d cx cy r rx`) stay attributes: they are
data from `lib/swimlane.js`, not design.

**R-4 — Substrate: HTML nodes over an SVG edge layer, both inside `#dag-zoom`.** REQ-134 rows ①②③
(`01-requirements.md:1784-1786`) and the running-node spec (:1787) need three things SVG elements do not
have: `text-overflow: ellipsis` on the label, an HTML `.tag-neutral` (a *component*) inside the node, and
`--shadow-md` (`box-shadow`; SVG needs a `filter: drop-shadow()` approximation that does not read the
token). The painter on disk is pure SVG (`run.js:143-193`), so a CSS task alone cannot deliver the node.
Proposal: `paintSwimlane` keeps `#dag-graph` as the SVG for **hairlines and edges ONLY** (geometry +
`viewBox` unchanged, F-9 — UT-253's pins and val-193's fit/zoom proof are untouched) and adds a SIBLING
`<div class="cell-layer">` inside `#dag-zoom` holding, absolutely positioned by the SAME
`laneX`/`cellRect`/`triggerRect` px (1 unit = 1 px by construction, F-9): the **lane headers** (REQ-134
`:1779-1781` wants a `目前` `.tag` component and an accent underline INSIDE the header — the same two things
SVG `<text>` cannot carry, so `run.js:114-125`'s SVG headers move with the nodes, which also makes any
`text-transform`-on-SVG question moot), the **trigger**, one `<div class="cell …" data-node-cell>` per agent
cell, and the **legend / summary** row — each built with `createElement` + `textContent` (D5) with delegated
click on the layer (DES-206's listener rule). The wrapper transform scales both layers together (INV-V27-6). Why this and
not `foreignObject`: `foreignObject` is the same HTML wrapped in an SVG element per node, with Chromium's
known transform/filter/z-order quirks and nothing gained; the two-layer form is the standard node-graph
shape (n8n's own), and it keeps SVG for the only thing SVG is good at here — curves. Cost: ARCH-125's `api:`
clause 「built with `createElementNS` + `textContent` inside `#dag-graph`」 takes a one-clause amendment in
the house style (edges in `#dag-graph`, nodes in the sibling layer, one geometry). VAL-200 measures with
`getBoundingClientRect` (`val-200-swimlane.test.ts:108`), so a `<div>` measures the same — but its selector is
`'#dag-graph [data-node-cell]'`, scoped INSIDE the SVG, and matches nothing once nodes live in the sibling
layer: ONE edit, `'#dag-zoom [data-node-cell]'`, or the case goes red for a non-defect reason (the exact
failure mode R-4 exists to avoid). Runner-up
recorded: keep pure SVG and DROP rows ①-② and the shadow — refused because it is the 99% bar the owner set,
not a preference. Not built: a layout library, a canvas, a virtual DOM.

**R-5 — One delivery path for the stylesheet.** F-6. Either **(i)** keep the `<link>`, delete the
`readFileSync` + `<style>` copy (`dashboard-page.ts:65-68, :88`), and re-point UT-241's five CSS assertions
(`:23, :35, :72-74, :78`) plus TASK-205's DoD sentence to `clientFile('dashboard.css')` — DES-208 already
allows exactly this ("or against `dashboard.css` bytes", `04-design.md:6856`); the `draggable="false"` pin is
markup and stays on `DASHBOARD_HTML`; or **(ii)** ratify the inline copy as the delivery path, delete the
`<link>`, and record that `/static/dashboard/dashboard.css` is served for the guards and the corpus only.
I hold (i), weakly: INV-V27-3's sentence is "every byte of JS, CSS and font comes from ARCH-123's map";
the implementer's stated reason for the copy (first paint before the stylesheet round-trips,
`dashboard.css:3-4`) does not hold — a `<link rel="stylesheet">` in `<head>` is render-blocking, so there is
no unstyled paint to prevent, only the same RTT `theme-init.js` already costs; and the stylesheet is about
to grow several-fold, which makes "twice per navigation" real bytes. Equal cost either way (five re-points
vs. one deleted tag); the property is one path.

**R-6 — The class contract is what makes the painter and the stylesheet independently replaceable.** With
R-2..R-4 in place a restyle is a CSS-only commit (the table's names are the seam) and a painter rewrite is a
JS-only commit (it must set the same names). Today neither is true: the painter carries the palette and the
stylesheet does not know the painter exists.

### Agent altitude

**R-7 — Provider / transport / model seams are untouched.** No file under `src/` outside `src/dashboard/`
and `src/dashboard-page.ts` changes in this delta; the gateways, the executor's decoration site and the
facade are as the closure left them. One line.

---

## 3. Consumability

**Design question for this round: what does the CSS implementer READ, what does the next author (Sprint B:
REQ-137/138/139) reuse, and what does the view-module contract promise a view author?**

**C-1 — The spec of record, stated, because the handoff is not here.** F-7. REQ-131..135 enumerate the
constants below; they are the ONLY spec a TASK-214 implementer can read in this checkout, and they are also
the seed of O-1's `SPEC_ROWS`. The DES must say two things: (a) this table IS the acceptance for everything
it lists; (b) everything it does NOT list — the nav/tab/table/tag/button/input/segmented-control look
(the Classical borrow), row heights, paddings, the panel's width, the legend's typography — is **unverifiable
in this repository until `design_handoff_workflow_dashboard/README.md` is vendored under
`.sdlc/features/001-remote-workflow-engine/design-handoff/`** — the README ONLY: `rwe-data.js` carries the C3
key `skeleton: '預測結構(尚無執行)'` (`01-requirements.md:1662-1664`), and a copy of it ANYWHERE in the repo —
`src/` or `.sdlc/` — is a file that 「still describes the deleted thing」 under REQ-105's closing clause
(`:1093-1094`), which Gate 8 verifies; the string table it would have supplied already lives in
`lib/strings.js`, and the demo dataset it carries is REQ-143's, out of closure. Vendoring is an orchestrator/owner action (the REQ names the project id and the three paths,
`:1613-1620`); until it happens, 「99%」 for the unlisted surfaces rests on the owner's Q10 side-by-side alone,
and the DES should say so rather than let an implementer invent Classical from memory.

| REQ | constant (verbatim from the acceptance) | O-1 row kind |
|---|---|---|
| 131 | `--color-bg` `#18191b` dark / `#eef2f1` light; accent `oklch(.72 .065 h)` / `oklch(.56 .065 h)`; ramp 100–900 per README L/C; Live tag = accent tint, Offline = red outline; fonts Archivo / JetBrains Mono from `/static/dashboard/fonts/` | literal · token · literal |
| 132 | Running section title dot `rwePulse` 1.6s; Other section opacity .75; grid `repeat(auto-fill, minmax(280px,1fr))` gap 16px; kicker `ACTIVE · <8>` / `LAST RUN · <M/D HH:MM>`; meta line tabular figures, 成功率 `white-space:nowrap`; running card accent border + top 2px `rweSweep` 2.4s linear infinite; hover 5–6% accent | animation · literal · literal · token |
| 133 | h2 name; `版本 vN` tag; runnable tag; description `max-width 720px`; TRIGGERS outline tags; ≤ 6 run chips = outline `.btn` + 7px status dot + 8-char id, selected = accent border + accent-100 fill; nine-column table, 執行ID monospace, live row `4m 12s 進行中`, selected row 7% accent | literal · token |
| 134 | `PAD 16 / TRIG_W 112 / LANE_W 216 / LANE_GAP 40 / HEAD_H 48 / CELL_H 74 / GAP_Y 14`; lane header uppercase 13px, letter-spacing .04em, semibold; current = accent + accent underline + `目前` tag; hairline per lane; edge = cubic 1.2px, active target accent, walked neutral-500, else divider, pending/queued `4 4` dashed; node 216×74 radius 3 surface fill 1px divider border padding 8/12; ① 9px dot + label 13.5px semibold ellipsis; ② model 11px @70% + effort `.tag-neutral` 10px; ③ `52k tok · $0.31 · 2m 10s` 10.5px @55%; running = accent-100 fill, accent-600 border, `--shadow-md`, `rweGlow` 1.8s, dot `rweRing` 1.3s; done dot = text colour; failed border+dot `oklch(0.55 0.16 25)`; queued/pending dashed border, opacity .65, hollow dot; trigger 112×40 transparent; legend row + right-aligned summary | literal · token · animation |
| 135 | slide `translateX(40px)→0` .28s `cubic-bezier(.2,.7,.2,1)`, from the left when the node centre is in the right half; backdrop `rgba(8,12,9,.5)` .2s; header 32px `.btn-icon` + h2 + state tag + phase tag + monospace id; six stat cards `auto-fit minmax(150px,1fr)`; `<pre>` 13.5px/1.6 pre-wrap max-height 420 with border; three tag columns `.tag-neutral` / `.tag-accent` / `.tag-outline`; event list max-height 420, `HH:MM:SS` + kind tag (tool call accent tint, message neutral, log red outline, else outline) + monospace content; failed `detail` red-bordered block; Esc / backdrop close | literal · token |

**C-2 — What the CSS implementer reads is three artifacts, and the DoD names them.** (1) C-1's table (the
values); (2) R-2's class table (the names); (3) the section-header format (where each rule goes). A DoD
that says 「pixel-precise CSS」 without those three is what produced F-1. The DoD's mechanical lines: the
O-4 lock green; the R-3 guard green; `SPEC_ROWS` ≥ 40 with every anchor matching; val-198..201's table
cases green under both themes and after a hue move; the `evidence/v27/` screenshots written; the
no-external-host guard and the `.css` walkers unchanged and green.

**C-3 — Sprint B reuses the component layer, so it must be COMPLETE now, not view-shaped.** REQ-137 (a
sortable table with a 560px slide-in), REQ-138 (stat cards with 2px track + 4px bar, a process table), REQ-139
(the Issues tab re-themed) are out of closure and will attach as view sections (ARCH-125's scope paragraph).
They reuse `.table`, `.tag-*`, `.btn`, `.seg`, `.input`, `.stat-cards`, the slide-in panel shell and the
sortable-header affordance. TASK-214's component section must therefore be written as the Classical borrow
in full (`.card .tag .btn .table .seg .input .nav .hr` + the panel shell), not as "whatever REQ-132..135
happen to touch" — otherwise Sprint B's first task is a second CSS ownership dispute over the same file.
This is the one place this round is allowed to build for a requirement outside the closure, and it is
allowed because the REQ text names the classes (:1619) and TASK-212 already ports the three tabs onto them.

**C-4 — The view-module contract, as it must read for a view author (and for REQ-142 later).** F-5/F-10.
DES-206's `render(container, vm, handlers)` cannot be honoured by `app.js` as written (it has no vm to pass
on tick). Proposal, the minimal change: every view module exports `render(container, ctx, handlers)` (mount:
build the shell once) and `onTick(container, bodies, ctx) → Promise<Record<url, 'ok'|'degraded'|'fail'>> |
void` (data: `bodies` is `{ [url]: body }` for `endpointsFor(view, ctx)`); `app.js`'s tick keeps EVERY body,
calls the mounted module's `onTick`, merges any statuses it returns into `results`, and THEN reduces
`nextConnection` — one timer, one reducer, every fetch. A view that needs a state-dependent extra fetch
(the workflow page's selected run, F-10) performs it INSIDE `onTick` with `getJSON` and returns its statuses;
`ROUTES` stays exactly as `poll.js:15-26` has it (UI state never enters `ROUTES`). The five own-loops are
deleted (`run.js:304-315`, `workflow.js:288-305`, `system.js:82`, `issues.js:102`, `models.js:65`) and
`app.js:294`'s `render(container, {}, {})` becomes `render(container, ctx, handlers)`. REQ-142's gate then
has ONE place to attach (skip arming while hidden; one immediate tick on visible), which is the sentence
ARCH-125 wrote for it. Deferral form, if the synthesizer rules it out of this delta: DES-206's 「one timer」
clause is marked `not-yet-true-on-disk` with the six sites listed, the run view's double fetch is recorded
as a KNOWN cost in ADR-052's N=1000 measurement (it inflates the number that decides v28's scope), and
REQ-142's attachment point is re-stated as "after the pollers are unified" — so the deferral is a decision
with a consequence, not an oversight.

**C-5 — The MCP surface is unchanged by this round.** No wire field, no tool description, no README API row
moves; the cross-repo `rwe-mcp` check and the tool-surface regeneration TASK-200/202 carry are untouched.
One line.

---

## 4. Self-sustainability

**Design question for this round: a team leaves the page open for days, the engine restarts itself on a
release tag, somebody "cleans up" the stylesheet in v29 — does the page keep matching the design without a
human noticing it stopped?**

### System altitude

**S-1 — One timer, or REQ-142 attaches to one loop of six and the run view polls twice forever.** F-5. The
remedy is C-4 (one hook, five deletions, no new module); the reason it is self-sustainability and not only
observability: a tab left open on a run page today issues two `/dag` fetches every 3 s per viewer, the
visibility gate REQ-142 will add pauses one of them, and the client is then the load ADR-052's measurement
is supposed to attribute to the server. The fix costs less than the workaround it replaces (five loops
deleted, one hook added).

**S-2 — Two locks so the stylesheet cannot decay green.** O-4's class lock fails the day a class is
renamed on one side; O-1's spec table fails the day a rule is "simplified" away. Both are node-tier
(vitest, no browser) except the table's browser rows, which run under `RWE_REQUIRE_BROWSER=1` (DES-191) so a
missing Chrome FAILS rather than skips. Between them, "the page drifted from the design" becomes a red CI
run instead of an owner noticing a month later.

**S-3 — Theme-following by construction, once the values leave JS.** With R-3 done, every colour on the
page is a token reference, so the light theme, the hue slider and a future palette change are one CSS edit
with zero JS. Today (F-3) a palette change is a CSS edit PLUS twelve attribute literals in a painter, and the
light theme is already wrong on the run view.

**S-4 — `no-store` on the stylesheet + the self-update: already right, keep it.** ARCH-123's cache split
means a release-tag restart never serves an old `dashboard.css` against new markup; R-5's single delivery
path keeps that guarantee from being half-true (an inline copy is by definition the version baked into the
page that served it — which is fine, and is the same version, but only while both paths exist together).

**S-5 — Order, so the locks exist before the surfaces they lock.** TASK-214 lands (contract fixture → CSS →
hook edits → guards green) BEFORE val-198..201 are judged; the pollers (C-4) land before or with TASK-208's
re-verification; the handoff is vendored (C-1) before TASK-214 starts if at all possible — an implementer who
starts from REQ prose and later receives the README re-does the component section. The guards that must
precede any of this (`.css` walkers, no-external-host) already landed (F-8).

### Agent altitude

**S-6 — Nothing to metabolize, probe or calibrate.** The panel reads what the engine journaled; the event
window and 2 KB row clip are already built. One line, honestly.

---

## 5. Where task-splitting decides whether a property survives (for the synthesizer)

1. **TASK-214 (new): the stylesheet + the class contract + the two locks.** One owner. `files:` per R-1;
   `des:` DES-209 (new: the class table, the section format, the substrate decision R-4, the allowlist R-3,
   the delivery-path decision R-5); `dod:` per C-2. Ordering rule 6 in the section preamble: 214 before
   208/209/210/211's acceptance is judged.
2. **TASK-207/210/211/212: one sentence each, no other change.** "This task adds no `.css`; the rules its
   DoD needs are TASK-214's, and it sets only class names that appear in DES-209's table." TASK-205's DoD
   loses its `DASHBOARD_HTML`-subject CSS sentence if R-5(i) is taken.
3. **The poller unification (C-4/S-1): either a DoD amendment on TASK-208 (`app.js`, `poll.js`) with the five
   deletions listed by file:line, or an explicit deferral with the three recorded consequences.** Not a new
   module either way.
4. **ARCH-125: one amendment clause** (R-4's node layer; the substrate is an ARCH `api:` word, and
   implementers grep `api:` lines). No new ARCH/ADR id.
5. **The tests this delta implies have no gate in the announced invocation.** `gates:[design,impl,verify,
   validation,review]` skips Gate 5, yet DES-209 creates RED-first obligations — the class lock, the
   no-design-values guard, `SPEC_ROWS`, and val-198..201's table cases. Either the orchestrator adds `tests`
   to the invocation, or TASK-214's DoD carries "writes UT-25x / the VAL amendments FIRST, runs them red,
   then green" (the `/sdlc-fix` F-pattern), and 05-tests.md is amended by the verify gate. Left unsaid, the
   locks in §1/§4 land as nothing, and the whole reason this round argues for them is lost.
6. **Vendoring the handoff is not a task; it is a precondition, and it is the orchestrator's.** Record it
   in DES-209's boundary as "spec of record = C-1's table until `design-handoff/README.md` is present"; do
   not make TASK-214 wait on it silently.

## 6. Ledger edit map (proposed)

| Item | Edit |
|---|---|
| DES-209 (new) | the class contract table (R-2, two columns); the section format (R-1); the substrate (R-4: SVG edges in `#dag-graph`, HTML nodes in a sibling layer, one `cellRect`); the `ui/` style allowlist (R-3); the delivery-path decision (R-5); the spec-of-record statement and the vendoring precondition (C-1); the component layer written in full for Sprint B (C-3); tests: the class lock, the no-design-values guard, `SPEC_ROWS` + the relational rows per view per theme (O-1/O-4/R-3) |
| DES-206 | either the `onTick` contract (C-4) or the `not-yet-true-on-disk` marker with the six sites and the three consequences |
| DES-200 | R-5's outcome: `<link>` only (and the C1 CSS pins re-pointed to `clientFile('dashboard.css')`), or the inline copy ratified with the `<link>` removed |
| DES-203 | `cellRect`/`triggerRect` now position HTML nodes as well as SVG edges (same numbers; one sentence) |
| ARCH-125 | one `amended (v27 Gate 4 re-run)` clause: nodes are HTML in a sibling layer inside `#dag-zoom`, edges stay SVG in `#dag-graph`, both from one geometry |
| TASK-214 (new) | per §5.1 |
| TASK-205 / 207 / 210 / 211 / 212 `dod:` | per §5.2 |
| TASK-208 `dod:` | per §5.3 (or the deferral marker) |
| 03-tasks preamble | ordering rule 6: 214 before the view acceptance; pollers before 208's re-verification |
| UT-241 | subject of the five CSS assertions → `clientFile('dashboard.css')` (if R-5(i)) |
| VAL-198..201 | gain the `SPEC_ROWS` iteration for their view under both themes + after a hue move (needs a tests gate or the F-pattern, §5.5) |
| new UT ids | the class lock; the no-design-values guard; `SPEC_ROWS` anti-vacuity |
| `.sdlc/…/design-handoff/` | orchestrator: vendor `README.md` ONLY (not `rwe-data.js` — C3 / REQ-105's closing clause, a Gate 8 finding anywhere in the repo) |

---

## key_points

1. **CSS ownership: one stylesheet, one new task (TASK-214), sections headed by REQ, ordered before
   val-198..201 are judged;** the four view tasks gain one sentence each. TASK/DES repair, no ARCH change
   for ownership itself (ARCH-122 already places keyframes + components in the shell CSS).
2. **Measured hole: 29 of 40 class names set by `ui/*.js` have no rule** — the gap is a vocabulary nobody
   wrote; the design artifact is a two-column class table (style hooks vs. frozen `data-*`/C2 test anchors),
   declared in a fixture, locked by a node-tier test that walks the DECLARED list (never a regex over JS).
3. **The design values are already in JS as the wrong values:** 12 hex literals as SVG attributes in `run.js`,
   three `cssText`s in `agent-panel.js`, `maxWidth`/`fontSize`/`rgba` literals in `workflow.js` — the run
   view is theme- and hue-blind and VAL-198 cannot see it. TASK-214 relocates them; a one-line allowlist
   (`display`, the zoom `transform`, `--rwe-hue`, the wrapper px from `svgBox`) plus a grep guard with a
   positive anchor keeps them out.
4. **REQ-134's node is undeliverable on pure SVG** (ellipsis, an HTML `.tag-neutral` inside the node,
   `--shadow-md`): decide the substrate BEFORE assigning CSS — HTML nodes positioned by the same `cellRect`
   in a sibling layer inside `#dag-zoom`, SVG edges stay in `#dag-graph`; INV-V27-6, ADR-044, UT-253 and
   VAL-200's anchor all survive; one ARCH-125 clause; `foreignObject` recorded as runner-up.
5. **ADR-053's computed-style table does not exist** (3 token reads + 1 box on disk). Build `SPEC_ROWS`
   from REQ-131..135's constants with RELATIONAL colour rows (element ↔ `var(--token)` probe on the same
   page, both themes, after a hue move), animation rows (`animationName`/`Duration`), and anti-vacuity.
6. **"One timer" is six on disk** because `app.js` discards every body but the first and calls
   `render(container, {}, {})`; the run view fetches `/dag` twice per tick and the connection reducer sees
   one loop. Fix = `onTick(container, bodies, ctx)` returning statuses + five deletions, `ROUTES`
   untouched, UI state (`selectedRunId`) chained inside the tick; deferral form written with its three
   consequences (DES-206 marker, ADR-052's number inflated, REQ-142's attach point).
7. **The handoff is not on disk:** the spec of record is C-1's table; everything unlisted is unverifiable
   until `README.md` is vendored under `.sdlc/…/design-handoff/` (the README only — `rwe-data.js` carries
   the C3 word, a Gate 8 finding anywhere in the repo); the DES
   says so instead of letting 99% rest on prose.
8. **The component layer (Classical borrow) is written in full now** so Sprint B (REQ-137/138/139) adds view
   sections, not a second ownership dispute — the one deliberate out-of-closure build, justified by the REQ
   naming the classes and TASK-212 already porting onto them.
9. **One delivery path for the stylesheet** (hold (i): `<link>` only, five UT-241 re-points to
   `clientFile('dashboard.css')`; the "first paint" reason for the inline copy does not hold for a head
   stylesheet). Low priority, one decision line.
10. **The announced invocation has no tests gate**, and this delta implies red-first tests (locks, guard,
    `SPEC_ROWS`, VAL amendments): add `tests`, or put the F-pattern in TASK-214's DoD — otherwise §1/§4's
    locks land as nothing.

## risks

| # | Risk | Severity | Where it lands |
|---|---|---|---|
| QD-R1 | **The CSS task is assigned and the values stay in JS** — the stylesheet defines `.cell.is-running` while `run.js` keeps setting `fill="#292a2f"` as an attribute (attributes lose to CSS only for properties the CSS actually sets; fills set by attribute stay wherever no rule overrides), so the swimlane stays theme-blind with every rule "present" and the table rows for it either fail late or are never written. | HIGH | R-3, O-2 |
| QD-R2 | **No substrate decision; the CSS author discovers rows ①②/the shadow are undeliverable on SVG** and either drops them (not 99%) or invents `foreignObject`/HTML nodes against no DES, in the middle of the impl gate. | HIGH | R-4 |
| QD-R3 | **The class lock is written as a regex over `ui/*.js`** — it under-counts (measured), goes green on a partial vocabulary, and the first unstyled hook ships silently. | HIGH | O-4 |
| QD-R4 | **The spec table is written with literal `oklch(…)` strings** — false for every hue but 236, "fixed" by asserting the default hue only, and the hue-follow property is never observed. | HIGH | O-1 |
| QD-R5 | **The tests this delta implies have no gate** — the invocation skips Gate 5, TASK-214 ships CSS with no lock, and the round's observability seam exists only in this file. | HIGH | §5.5 |
| QD-R6 | **The handoff never arrives and nobody says so** — the component layer is invented from REQ prose, the owner's side-by-side fails on surfaces no table covers, and the failure is attributed to the implementer. | MID (certainty) / HIGH (cost) | C-1 |
| QD-R7 | **Pollers deferred silently** — REQ-142 later attaches to `app.js` only, five loops keep polling hidden tabs, the run view's double fetch inflates ADR-052's N=1000 number, and v28's scope is decided on a client-caused measurement. | MID | C-4, S-1 |
| QD-R8 | **Style hooks used as test anchors (or the reverse)** — a CSS rename breaks VAL-200/201, or a design change is blocked by a test id; the C2 problem reborn one layer down. | MID | R-2 |
| QD-R9 | **Per-view CSS files or CSS inside the view tasks** — four authors, one vocabulary, one shared file on one working tree; the contract is spelled four ways. | MID | R-1 |
| QD-R10 | **The component layer is written view-shaped** — Sprint B's first task is a second CSS ownership dispute over the same file. | MID | C-3 |
| QD-R11 | **Both stylesheet delivery paths survive** — a 404 on the `no-store` `<link>` is invisible, the stylesheet ships twice per navigation as it grows, and INV-V27-3's sentence is half-true. | LOW | R-5 |
| QD-R12 | **The node layer breaks the zoom contract** — nodes placed outside `#dag-zoom` or positioned in a different coordinate space than the SVG, so wheel-zoom moves edges and not nodes; val-193's real-mouse proof is the catch, if it is re-run. | LOW (cost) / MID (if unrun) | R-4, S-5 |

## expected disagreements with other lenses

- **vs. the adversarial / simplicity lens — on C-4 (the poller unification) as scope creep.** They will say
  the routed item was the stylesheet and six loops that work are not a defect. My position: DES-206's
  contract is on disk as text and false as code, `run.js` itself flagged it, the run view fetches twice per
  tick, and the remedy DELETES more than it adds (five loops out, one hook in, no module). I have written the
  deferral form with its consequences so they can win without silence; what I will not concede is that the
  double fetch goes unrecorded into ADR-052's measurement.
- **vs. the adversarial lens — on the class-contract fixture as "machinery".** A `STYLE_HOOKS` array and a
  30-line test are the minimum that makes 29 unstyled hooks red; the alternative they may offer (a regex over
  `ui/*.js`) is the vacuous green my own extractor demonstrated. If they hold that ANY lock is machinery,
  the table still belongs in the DES — a name must exist before code, and that costs no test.
- **vs. the design synthesizer / architect — on R-4 (HTML nodes over SVG edges).** They may read ADR-044's
  「client-constructed DOM (`createElementNS` + `textContent`)」 as binding the painter to SVG. `createElement`
  + `textContent` is the same rule at the same layer; ADR-044's property was "box math server-side, DOM
  client-side, no `innerHTML`", and it survives whole. If they hold pure SVG, REQ-134 rows ①-② and the
  running shadow must be marked as consciously not built, in the REQ's own house style, before Gate 7.5
  photographs their absence.
- **vs. a testability lens — on relational colour rows.** They may prefer exact literals as the stronger
  oracle. A literal is stronger on one hue and false on every other; the relational row pins the property
  REQ-131 states (「依 OKLCH 公式重算」) and stays true after a palette edit. Where a value IS a literal in the
  REQ (sizes, timings, `oklch(0.55 0.16 25)` for failed), the row is literal.
- **vs. whoever wants the CSS inside TASK-210/211 "because the painter is there".** The painter and the
  stylesheet are two seams with one contract between them; putting the rules in the painter's task puts the
  palette back in JS (F-3 is exactly what that produces). One author for the vocabulary, then anyone may
  restyle.
- **vs. the orchestrator — on §5.5.** The announced gate list is theirs to set; I only note that the locks
  in this proposal are tests, and a design delta whose tests have no gate is a design delta whose properties
  have no proof.
