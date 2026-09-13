---
stage: design
lens: quality-dimensions
iteration: v27 — Gate 8 SEND-BACK REPAIR, the DESIGN half (v27j). The dispatch text says "round 1, 03-tasks.md does not exist yet"; the tree says otherwise — `03-tasks.md` has TASK-196..214, `04-design.md` has DES-191..209, `current_stage: review`, and Gate 8's `send_back = [impl, architecture, validation, design]` has three of four halves closed (v27g impl, v27h arch, v27i validation). What is routed HERE is exactly (a) **DASH-2** (`04-design.md:3306`, the v22 `classDiagram` that fails to render), (b) **minting TASK-A / TASK-B** (the two follow-up impl items ARCH-122 / ADR-049 owe an id and a row — `02-architecture.md:3835-3836`), (c) the design/task sentences the v27g repairs made false (v27h item 2 names DES-200 + TASK-205; this round measured four more), and (d) the pre-boot literal v27h assigned to Gate 4 by name.
round: 1 (independent proposal)
closure: REQ-131..136, REQ-140, REQ-141 (unchanged); REQ-137/138/139/142/143 stay out
builds_on: my closure-re-opened design r1 (`git show 3a1c58d:.sdlc/features/001-remote-workflow-engine/.panel/design/quality-dimensions.r1.md`) and my Gate 8 review stance (`.panel/review/quality-dimensions.md`, QD-O1..S2) — everything those settled stands; this round argues only from what the v27g/v27h/v27i trees changed.
verified_this_round (HEAD `586dafd`; `src/`+`tests/` byte-identical to `eb387a1`, the tree v27h measured at — `git diff --stat eb387a1..HEAD -- src/ tests/` is empty): `04-design.md:3305-3336` (the block), `:6788-6795` (DES-200), `:6780-6787` (DES-199), `:6804-6811` (DES-202), `:6716-6723` (DES-191); `03-tasks.md:1620` (section header), `:1747-1755` (TASK-205), `:1756-1764` (TASK-206), `:1819-1835` (TASK-213/214 as row templates); `02-architecture.md:3341-3343` (ARCH-122 as amended), `:3356-3367` (ARCH-124 + `owner_decision: pending`), `:3439-3446` (ADR-049 + TASK-B DoD), `:3782-3850` (v27h rationale); `05-tests.md:12062` (UT-240 = `static-assets.test.ts`), `:12075` (UT-241 = `dashboard-page-source.test.ts` v27 extension), `:12159` (UT-245); `src/dashboard/lib/connection.js:9-45`; `tests/unit/dashboard-lib-connection.test.js:23-42`; `src/static-assets.ts:28-49`; `src/dashboard-page.ts:84-160` (the fossil body, `draggable="false"` at `:128`); `src/dashboard/ui/app.js:331-333, 451-457`; `src/dashboard/dashboard.css:137` (`.empty`); `tests/fixtures/dashboard-classes.ts:28`; `tests/unit/dashboard-page-source.test.ts:42-43, 51, 92-96`; `src/workflow-catalog.ts:649, 664, 787`; `.sdlc/trace.py:301-330, 623, 687-698`; `07-review.md` §3 (DASH table), §8 item 13, §9.
measured_this_round (real Chromium, mermaid 11.17.2 from `node_modules`, puppeteer from the repo's own deps — `mermaid.parse` THEN `mermaid.render` per block): full sweep of every ```mermaid block in `01`–`05` → **40 blocks, 1 failing (`04-design.md:3306`), 8 literal `%%` strings** (`02-architecture.md:1156` ×3, `:1595` ×3, `:3036` ×2 — they parse; fidelity defects v27h item 5 already names) — byte-for-byte the architect's result. Six repair forms for DASH-2 rendered and compared (§0). The candidate run — browser launch plus seven renders — took 2.1 s wall; the sweep was not timed.
---
# Quality-dimensions — v27j DESIGN r1 (Gate 8 send-back, design half): three characters of entity code close DASH-2 without changing what the diagram says; four design rows and two task rows still describe the pre-v27g tree; and the two owed tasks carry a wrong test id and a missing design parent

## summary

**DASH-2 closes with the same principle DASH-1 closed under — the zero-meaning-change edit — and the measurement says which edit that is.** The block at `04-design.md:3306` fails because a `classDiagram` member cannot carry `{` (mermaid opens a struct — the parse failure at line 3 is reproduced here; the token text `Expecting 'STRUCT_STOP','MEMBER', got 'OPEN_IN_STRUCT'` is the review's §3 quotation). Three of the eight `WorkflowCatalog` members carry braces. Of the six forms I rendered, **HTML entity codes** — `#123;` `#125;` for the braces and `#44;` for the commas inside the second one — are the only form that (a) parses, (b) renders **exactly** the shape the author wrote (`Promise<{version}>`, `Promise<{channel, version, from}>`, `Promise<{removed}>` in the SVG text, all eight members present, 0 literal `%%`), and (c) names nothing the code does not name. The finding's own suggestion, `Promise~VersionResult~`, renders but **invents types**: `src/workflow-catalog.ts:649/787/664` return inline object literals (`Promise<{ version: string }>`, `Promise<{ channel; version; from }>`, `Promise<{ removed: boolean; claimedTriggers: string[] }>`) and no `RegisterResult`/`PublishResult`/`DeregisterResult` exists anywhere in `src/`. A diagram that is the design's interface view may not name types the interface does not have. The edit is +32 characters on three lines (`:3308`, `:3309`, `:3315`), plus one own-line `%%` comment at the top of the block telling a human reader what the entities are (measured: parses, and leaves no `%%` in the SVG). Two classDiagram authoring rules fall out of the measurement and belong beside v27h's sequenceDiagram rule (§0).

**The design half of "rows the tree contradicts" was never swept, and it is larger than the two sentences v27h named.** v27h closed the architecture side of the v27g-induced drift (ARCH-124's `any ok → live`, ARCH-123's `cache` literal) and named DES-200's `draggable` sentence and TASK-205's matching DoD as "owed to design". Applying the architect's own rule — *repair claims the tree contradicts; add no missing caveats* — to every v27 design and task row against `src/` at HEAD finds **six rows with contradicted sentences**, four of them unnamed until now: **DES-202** carries the struck clause verbatim (`:6808` "any `ok` in the tick → `live`") AND a tests line that names the case IMPL-271 inverted (`:6809` "`live→live` on a degraded-plus-ok tick" — the test at `dashboard-lib-connection.test.js:30-35` now asserts `degraded`); **DES-199** carries the pre-AC-8 type literal (`:6783` `cache: 'immutable' | 'no-store'` vs `static-assets.ts:33`'s full directive); **DES-200** carries three (`:6791` `server.ts:1251-1257` — it is `:1334`; "holds **markup and CSS only**" — it holds a dead pre-v27 body that `app.js:455` discards; `:6792` "`draggable="false"` … stays on `DASHBOARD_HTML`" — IMPL-270 moved the guard to `clientFile('ui/workflow.js')` and the assertion still standing at `dashboard-page-source.test.ts:95` pins bytes at `dashboard-page.ts:128` that no browser ever paints); **TASK-205** `:1752` and **TASK-206** `:1761` repeat the DES-200 and DES-202 sentences in their DoDs. Each is a one-clause amendment in the ledger's `amended (v27j …)` house style; none adds a caveat. DES-202's amendment must be written the way ARCH-124's was — one overturnable sentence that inherits ARCH-124's `owner_decision: pending` — so that if the owner restores REQ-131's literal reading, four places flip together (§2 R-2).

**The two owed task rows have two defects the trace tool cannot see.** (1) ARCH-122's TASK-A text says "UT-240's `draggable` case retires" and "add UT-240 one POSITIVE case"; in the ledger **UT-240 is `static-assets.test.ts`** (`05-tests.md:12062`, traces DES-199/TASK-204) and the page-source extension is **UT-241** (`:12075`, traces DES-200/TASK-205). The architect copied the test file's own mislabel (`dashboard-page-source.test.ts:51` says `UT-240`). Both ids exist, so `sh .sdlc/trace` reports nothing; a TASK row citing UT-240 would send the implementer to the wrong test. TASK-215's DoD cites UT-241 and fixes the comment in the same commit. (2) TASK-B has **no design parent**: no DES row mentions a second `tsc` program, and a TASK's `des:` must resolve. DES-191 (the guard tier) is the right home — one sentence: *the server tree is a complete program without the client tree and without DOM, proven by `tsconfig.server.json` on every `build`*. Without it the synthesizer either mints a DES nobody argued for or leaves `des:` dangling.

**The pre-boot literal is this gate's to fix, and my lens has a position on it.** v27h: "static pre-boot text in the existing `empty` hook and no `id` … the exact bilingual literal is Gate 4's to fix, with a language-neutral 「…」 recorded as the zero-exception fallback." The text exists for one reason — on a module 404, a CSP block or a syntax error `app.js:455`'s `replaceChildren` never runs and the operator sees whatever the shell shipped. A neutral `…` cannot distinguish dead from slow; it is a blank page with one glyph. The text should say the client did not start and name the one asset to check (§1 O-2 gives the literal). It lives in `dashboard-page.ts` (server TS — outside the `src/dashboard/**/*.js` string guards and, by construction, before any string table can load), in the `.empty` hook that `dashboard.css:137` already styles and `STYLE_HOOKS:28` already lists, so the class-lock is untouched.

**The standing control for the DASH class is a design-owned seam, and it does not exist.** The class has recurred three times (v26 mis-recorded `:2531` as a checker false positive; v27 shipped `:3561` broken; the send-back's own DASH-1 instruction named two of four sites). The only oracle today is a human opening the trace dashboard's 圖 tab and reading `圖渲染失敗：…` (`trace.py:698`), or the Gate 8 reviewer's out-of-band render; `dashboard_check` is a lexical bracket count that is wrong in both directions (review §3). v27h item 3 named the fix (`scripts/mermaid-parse-check.mjs`) and routed it to §9 beside TOOL-FORK, and I agree with the routing — a `.md` is not the product and Gate 4 makes no code changes — but the spec must be written down THIS round or the prototype I ran dies with this session. §1 O-1 is that spec, with the measured behaviour attached.

## Altitude call

This project is both a conventional system (an HTTP/MCP server with a browser dashboard) and an AI-agent system (it runs LLM agents through a gateway). **This round's subject is ledger rows, a shell served before any script runs, and tooling — system altitude throughout.** The agent altitude is named where it genuinely applies (§1: the agent panel's swallowed error is §9 debt QD-O5, not this round; §4: the owner decision loop) and is otherwise marked N/A rather than manufactured.

## 0. What was measured — so the four sections argue from the same facts

**The block.** `04-design.md:3305` is the fence; `:3306` `classDiagram`; `:3307` `class WorkflowCatalog {`; `:3308` `+register(…) Promise~{version}~`; `:3309` `+publish(…) Promise~{channel,version,from}~`; `:3315` `+deregister(…) Promise~{removed}~`; 31 body lines; closing fence `:3337`.

**Six forms, rendered (mermaid 11.17.2, `parse` then `render`, SVG text extracted):**

| Form | parse | render | What the SVG shows for the three members | Verdict |
|---|---|---|---|---|
| as-is | FAIL line 3 | FAIL | — | the finding, reproduced |
| named types `Promise~RegisterResult~` (the finding's suggestion) | ok | ok | `Promise<RegisterResult>` … | **invents three type names absent from `src/`** (`workflow-catalog.ts:649/787/664` return inline literals) |
| braces dropped, commas kept `Promise~channel,version,from~` | ok | ok | `Promise<version>` but **`Promise~channel,version,from~` verbatim with tildes** | a comma inside `~…~` disables the generic conversion; shape lost |
| parentheses `Promise~(version)~` | ok | ok | `Promise~(version) : ~` | parens break the member render |
| named types + `note for WorkflowCatalog "RegisterResult = {version} · …"` | ok | ok | names + a visible note box carrying the shapes | renders, but adds a box (changes what the diagram shows) AND still invents names |
| **entity codes** `Promise~#123;version#125;~`, `Promise~#123;channel#44; version#44; from#125;~`, `Promise~#123;removed#125;~` | ok | ok | **`Promise<{version}>`, `Promise<{channel, version, from}>`, `Promise<{removed}>`** — all 8 members present, 0 literal `%%` | **taken** — zero meaning change, +32 chars |

Also measured: an own-line `%% …` comment as the block's second line parses in `classDiagram` and leaves no `%%` in the SVG; `#44;` renders as `,` and the space after it survives.

**Two classDiagram authoring rules, to sit beside v27h's sequenceDiagram rule** (`02-architecture.md:3782+`, "The diagram authoring rule"): *(a) inside a class member, `{` opens a struct and `}` closes it — a literal brace is `#123;` / `#125;`; (b) inside a `~…~` generic, a `,` or `(` disables the generic-to-angle-bracket conversion and the tildes render verbatim — a literal comma is `#44;`. The falsifier is the same: parse AND render, then read the member text out of the SVG.*

**The sweep** (every ```mermaid block in `01`–`05`, by file: 01 ×1, 02 ×27, 03 ×0, 04 ×12, 05 ×0): 40 blocks, 1 failing (this one), 8 literal `%%` in `02-architecture.md:1156` (×3), `:1595` (×3), `:3036` (×2) — parse-clean, fidelity defects, out of this round per v27h item 5.

**The connection reducer at HEAD** (`connection.js:24-37`): `worstOf(tick.results) === 'ok'` → `live`, `consecutiveFails: 0`; any mix short of unanimous `fail` → `degraded`, counter reset; unanimous `fail` → counter +1, `offline` at ≥ 2. UT-245's cases (`:30-35` describe ok + runs degraded → `degraded`; `:37-42` ok + fail → `degraded`, not counted). DES-202 `:6808` says the opposite for the first case.

**The static-asset cache type at HEAD** (`static-assets.ts:33`): `'public, max-age=31536000, immutable' | 'no-store'`. DES-199 `:6783` says `'immutable' | 'no-store'`.

**The shell at HEAD** (`dashboard-page.ts:84-160`): `<head>` with the three asset references; `<body>` = a pre-v27 `<header>` + `<main>` with `<section id="home">` … `<section>` blocks (`:92-152`, `draggable="false"` at `:128`) + the island + the module script. `app.js:455` `document.body.replaceChildren(nav, routeMount, buildFooter())` discards all of it before first paint; `routeMount` is `<main id="app-view">` created at `:331-332`. No test constrains `<main`/`<section`/`<header` in `DASHBOARD_HTML` today (grep over the three page-source suites → 0), so the TASK-215 positive is genuinely new.

**The UT id slip.** `tests/unit/dashboard-page-source.test.ts:51` comment: `// v27 (UT-240, DES-200/201, ARCH-122, TASK-205, REQ-131)`. Ledger: UT-240 = `static-assets.test.ts` (`05-tests.md:12062`), UT-241 = `dashboard-page-source.test.ts` extended (`:12075`). ARCH-122 `:3343` says UT-240 twice. No test file carries the string `UT-241` except `val-198` and `update-outcome-config-check.test.ts` (cross-references).

---

## 1. Observability

### System altitude

**O-1 — The standing render check (the seam DASH-1/DASH-2 lacked), specified so it survives this session.** Route: §9 beside TOOL-FORK (v27h item 3), not a TASK (no ARCH parent; a `.md` is not the product; Gate 4 makes no code changes). What it must assert, in the form the review's Retro item 4 asked for — "render it, don't lint it":

- **Inputs:** every ```mermaid fence in `01`–`05` (the extractor is 12 lines; `trace.py:301-330` already has the regex and the SoT convention — report `file:line` as the fence line + 1, i.e. `04-design.md:3306`, matching how the ledger cites blocks).
- **Oracle, per block:** `mermaid.parse(src)` THEN `mermaid.render(id, src)` in a real Chromium (puppeteer is already a repo dependency; `mermaid.min.js` loaded from `node_modules/mermaid/dist/` via `page.addScriptTag({path})` on `about:blank`, so no CDN and no network — the offline stance the product enforces); THEN over the SVG: `/%%/` must not match (v27h's fidelity rule), and — new from this round — for a `classDiagram`, the member text read back from the SVG must not contain a literal `~` (the tildes-render-verbatim failure mode, which parses clean).
- **Output:** one line per failing block, `FAIL <file>:<line> <header> parse=<msg|ok> render=<msg|ok> literal%%=<n>`, a `warn` line for fidelity-only hits, a one-line summary (`N blocks, F failing, P literal %%`), exit 1 on any FAIL, exit 0 with warnings. **Loud skip:** when no browser can launch, print `SKIP: no Chromium — run with a browser before Gate 8` and exit 2, never 0 — a silent skip is exactly the false green that shipped `:3561`.
- **When it runs:** after any ledger diagram edit and before Gate 8's render check (v27h's wording). It is a human-invoked control until the plugin's `dashboard_check` grows a real-render arm (TOOL-FORK's owner) — say so in the §9 row so nobody records it as closed-loop.
- **Measured reference:** the 40-block sweep and the candidate comparison in §0 were produced by exactly this shape; browser launch + 7 renders = 2.1 s wall.
- **A check to keep, not a risk:** the trace dashboard loads `mermaid@11` **floating** from jsDelivr (`trace.py:623`) while this control pins the vendored 11.17.2; the Gate 8 reviewer's real render of `dashboard.html` is the confirmation that the two agree.

**O-2 — The pre-boot literal IS the observable seam for a dead client, so it must say so.** Proposed shell body (TASK-215, DES-200's Layer-1 shape):

```html
<main class="empty">載入中… Loading… — 若此行持續顯示，表示 dashboard client 未啟動：請檢查 /static/dashboard/ui/app.js 是否可載入（404 / CSP / 語法錯誤）。 If this line stays, the dashboard client did not start: check that /static/dashboard/ui/app.js loads (404 / CSP / syntax error).</main>
```

Why this and not `…`: the three ways the client dies before `app.js:455` (a 404 on the module, a CSP refusal, a parse error in any imported module) all leave the shell's body on screen and log nothing an operator sees. A sentence that names the asset turns a blank page into a diagnosis; a `…` does not. Why it may be a literal: REQ-131's string-table clause (`01-requirements.md:1728`) scopes itself to nav / tab / 欄位標題 painted by the client; this text is painted by the server BEFORE any table can load and is destroyed on a healthy boot. Why bilingual and not per-`lang`: the shell has no language knowledge (`theme-init.js` restamps `lang` from `localStorage` before paint); two short sentences cost less than a server-side language branch. Fallback recorded: the neutral `…` (zero literals, zero diagnosis) — if the synthesizer holds the no-literal line, record what it costs in the same sentence. No `id` (ARCH-122: `#app-view` stays single-emitter at `app.js:332`), no `<noscript>` (the text covers no-JS too), no timer (v27h dissolved the watchdog). Accepted and stated: on a healthy boot the literal is painted for at most the one frame before `app.js:455` replaces the body — muted 12.5px `.empty` text, gone before the first poll — which is the same one-frame cost the empty mount would have paid as blank.

**O-3 — DES-202's transition table must describe the reducer that ships, and name the case that changed.** Strike `:6808` "any `ok` in the tick → `live` with `consecutiveFails: 0`"; write: *`worstOf(tick.results) === 'ok'` — every route of the VISIBLE view `ok` — → `live`, counter 0; any mix short of unanimous `fail` (a `degraded`, or a `fail` beside something better) → `degraded` immediately, counter 0, never counted toward the offline streak; unanimous `fail` → counter +1, `offline` at ≥ 2* (`connection.js:24-37`). In the tests line (`:6809`) replace "`live→live` on a degraded-plus-ok tick" with "`live→degraded` on a degraded-plus-ok tick (`describe` ok + `/api/runs` degraded — the workflow view's own tick, UT-245 `:30-35`) and `live→degraded` on an ok-plus-fail tick, not counted (`:37-42`)". This is the observability defect QD-O1 named — a tag that says 連線中 over a degraded table — closed in code at v27g and still open in the design text.

**O-4 — Two rows point their reader at the wrong place.** DES-200 `:6791` `server.ts:1251-1257` → `:1334` (ARCH-122 fixed its copy at v27h). Optional, additive: DES-200's tests line names `update-outcome-config-check.test.ts` as the INV-V27-5 lock; the rendered-page lock IMPL-273 added lives at `val-198-shell-and-home.test.ts:287` — one parenthesis, not a contradiction, so COULD.

### Agent altitude

N/A for this round's edits. The one agent-inspectability defect in the closure — the agent panel discards `res.status` and the server's error text, so a 404 renders six 「—」 cards (QD-O5, `agent-panel.js:233-241`) — is §9 debt and stays there; nothing here touches it.

---

## 2. Replaceability

### System altitude

**R-1 — TASK-216 is a replaceability control, and its design parent must say what property it re-proves.** ADR-049's amended property — *the server tree is a complete program without the client tree and without DOM* — is the sentence that lets the dashboard client be rewritten, replaced or deleted without the server noticing at compile time. Today it is UNGUARDED (`tsconfig.json:7-8` carries `DOM`/`allowJs`; `package.json:8,11` `typecheck`/`build` are a bare `tsc --noEmit`) and ADR-049 says so in as many words. **DES-191 gains one amendment sentence** (it is the guard tier — `vitest.config.ts` include, the walkers, the browser tier that can FAIL — and this is one more guard of the same kind): *the compile-time server/client boundary is a SECOND program, `tsconfig.server.json` (`extends` root; `lib: ["ES2022"]`, `allowJs: false`; `include: ["src"]`, `exclude: ["src/dashboard"]`), run beside the root in both `typecheck` and `build`; both programs are load-bearing (the root carries the `satisfies` wire lock, the inverse carries the boundary) and one UT pins both script strings so neither can be "simplified" away.* Falsifiers (from ADR-049 `:3444`, measured there): planted `document.title` in a server `.ts` → TS2584; planted `import { worstOf } from './dashboard/lib/connection.js'` → TS7016; and the parse coverage that must NOT be traded away — a planted stray token in `ui/app.js` still fails the root program (TS1109). The accepted limit is stated, not discovered: editors resolve the nearest `tsconfig.json`, which keeps DOM — a CI/build property, not an in-editor one.

**R-2 — DES-202's narrowing must be as replaceable as ARCH-124's: one sentence, one owner decision, four places that flip together.** ARCH-124 `:3365` wrote the REQ-131 narrowing as ONE overturnable sentence and marked `owner_decision: pending`. DES-202's amendment (O-3) must reference that decision explicitly and enumerate the flip set — *if the owner restores 「任一 `/api/*` 取得成功 → Live」: ARCH-124's sentence, this row's sentence, `connection.js:26-31`'s `worst === 'ok'` branch, and UT-245's two v27g cases (`:30-42`) change together; none changes alone.* A panel may not amend an acceptance clause; a design row that silently agrees with one reading makes the owner's overturn a four-file hunt instead of a listed flip.

**R-3 — A diagram that is the interface view may only name what the interface names.** The named-types form (`RegisterResult` …) was refused in §0 on this ground: `src/workflow-catalog.ts` returns inline literals, and a reader who greps the codebase for the diagram's type finds nothing. The entity form keeps the diagram a projection of the code. Seen, not taken (a missing caveat, not a contradiction): `deregister` at `:664` now also returns `claimedTriggers: string[]`; the v22 diagram says `{removed}`. Name it for the next v22-slice touch.

**R-4 — The `cache` type literal is the DES-199 mirror of the ARCH-123 drift v27h fixed.** `:6783` `cache: 'immutable' | 'no-store'` → `'public, max-age=31536000, immutable' | 'no-store'` (`static-assets.ts:33`, IMPL-275). One token. TASK-204's DoD `:1743` "cache policy is `immutable` for woff2" is imprecise, not false (the value contains the word) — COULD, one word.

**R-5 — The pre-boot literal is deliberately outside the string table, and the row must say why.** QD-R3 (strings scattered across nine files) is a real debt; this literal is not an instance of it — it exists in the one place a table cannot reach (server-emitted, pre-script). DES-200's amendment states that in one clause so the next reader does not "fix" it into `strings.js` (where it could never be read in time).

### Agent altitude

N/A: no gateway, model or tool seam is touched by this round.

---

## 3. Consumability

### System altitude

**C-1 — The ledger's consumers are agents, and two of this round's defects are consumability defects of the ledger itself.** ~20 implementer agents and the Gate 8 reviewer read these rows as an API: ids must resolve to the row they mean, `file:line` must be current, diagrams must render. The **UT-240 → UT-241** slip (§0) sends an implementer to `static-assets.test.ts` to retire a `draggable` case that is not there; the stale `server.ts:1251-1257` sends a reader to the wrong function; a block that shows `圖渲染失敗` in the 圖 tab makes every reader re-derive the class relationships from prose. All three are cheap to fix and expensive to leave.

**C-2 — TASK-215's DoD in TASK-213's table form, so the re-review can check it row by row.** ARCH-122 `:3343` wrote the five dispositions as prose; the row should carry them as the STAYS / MOVES / RETIRES table TASK-213 set as precedent (`:1824`, "one disposition per assertion"):

| Assertion (at HEAD) | Disposition |
|---|---|
| `dashboard-page-source.test.ts:95` `expect(DASHBOARD_HTML).toMatch(/draggable="false"/)` | **RETIRES** — UT-224's v27g re-pointed case at `:42-43` already guards the element on `clientFile('ui/workflow.js')` |
| `dashboard-zoom-source.test.ts:19,23` `.zoomable` / `fit` over `DASHBOARD_HTML` | **MOVE** → `clientFile('ui/run.js')` |
| `workflow-page-harness-table.test.ts:15` harness-table marker | **RETIRES with reason** (the table's role is REQ-135's panel, real-tier proven by val-201) — or MOVES → `clientFile('ui/agent-panel.js')` |
| `dashboard-diagram-render.test.ts:60` positive | **MOVES** → `clientFile('ui/workflow.js')`; its two negatives → `clientCorpus()` (over `DASHBOARD_HTML` they pass vacuously — DES-208's 「dangerous green」) |
| `dashboard-no-design-values.test.ts:44,50` | **STAYS** — measured at `eb387a1`: 0 of 104 `STYLE_HOOKS` and 0 of 23 `TEST_ANCHORS` are emitted only by the shell |
| **NEW** UT-241 positive | `<body>` holds `<main class="empty">`, the island and the module script, and **no `<section`/`<header`** — the assertion that fails if the fossil returns |

DoD command, TASK-213-style, naming every file the row touches: `npx vitest run tests/unit/dashboard-page-source.test.ts tests/unit/dashboard-zoom-source.test.ts tests/unit/workflow-page-harness-table.test.ts tests/unit/dashboard-diagram-render.test.ts tests/unit/dashboard-no-design-values.test.ts` → green with the table above applied, and RED beforehand on exactly the NEW UT-241 positive (the F-pattern proof). Plus, same commit: delete `dashboard-page.ts:92-152`; strike ARCH-122's two tree-state clauses (`api:` 「removed by the TASK-A follow-up」, `note:` 「(after TASK-A)」); strike DES-200's v27j 「until TASK-215 lands」 sentence; fix `dashboard-page-source.test.ts:51` `UT-240` → `UT-241`.

**C-3 — TASK-216's DoD, verbatim from ADR-049 `:3444`, with the exit codes as the evidence form.** Both programs exit 0 on the tree (paste both codes; the inverse program compiled 76 `src/` files, 0 under `src/dashboard/`, at `eb387a1`); the two planted violations go red (TS2584 + TS2304 ×2; TS7016) and are reverted; `npm run typecheck` still fails on a planted syntax error under `src/dashboard/**/*.js` (TS1109); one UT asserts both `scripts.typecheck` and `scripts.build` contain `tsconfig.server.json`; `deploy/rwe-update.sh` unchanged (`:147` already reverts on a failed `npm run build`); same commit: strike ADR-049's 「has NOT landed」 sentence and ARCH-124's 「UNGUARDED until TASK-B lands」, update ARCH-124's 「`npm run build` is `tsc --noEmit`」 and the v27 deployment view's `npm ci · tsc --noEmit · vitest run` label to name both programs.

**C-4 — The entity form costs `.md` readability, and the block should pay for it in one line.** `Promise~#123;version#125;~` is harder to read in source than `Promise~{version}~`. The own-line comment (measured, §0) carries the key: `%% #123; #125; #44; are { } , — a classDiagram member cannot carry them literally (DASH-2, v27j)`. One line, invisible in the render, self-explaining in the source.

**C-5 — The pre-boot literal names the check an operator can perform without reading code** (O-2): the asset path and the three causes. That is the whole consumability argument for a sentence over a glyph.

### Agent altitude

N/A: no MCP/HTTP surface changes. (QD-C2/C3 — the uncapped `limit` and the truncated tool-surface doc — stay §9.)

---

## 4. Self-sustainability

### System altitude

**S-1 — Without O-1 the DASH class will recur, because the only oracle is a human at Gate 8.** Three recurrences on record. `dashboard_check`'s bracket heuristic reported the same `0 high / 7 mid / 1 low` before and after v27h's DASH-1 repair (v27h item 8) — it cannot see a render failure. The render check is the minimum control that turns "someone opened the 圖 tab" into a command with an exit code. It is human-invoked until the plugin grows the arm; the §9 row must say "manual until upstream" so it is never counted as closed-loop.

**S-2 — TASK-216 re-proves the boundary with no human in the loop, and the UT keeps it from being simplified away.** `deploy/rwe-update.sh:147` reverts a self-update whose `npm run build` fails; once `build` runs both programs, a `document.` leak into server code or a server import of `src/dashboard/lib` reverts itself on the next release. The pinning UT exists because "two programs in one script string" is exactly the shape a later 「simplification」 pass collapses to one — and the property dies silently. Both programs are load-bearing (R-1); the UT says so.

**S-3 — The pending owner decision must not stall the loop, and the design row must not pre-empt it.** ARCH-124's `owner_decision` blocks Gate 8, not this stage. DES-202 is written for either outcome (R-2's flip set); the current tree's behaviour is recorded as what ships, the overturn as a listed one-line change per place. No stall, no pre-emption.

**S-4 — Recommend the v27j impl micro-dispatch before the re-review; state the cost of declining.** Both v27h lenses recommended it; I do too. TASK-215/216 are S-sized, their DoDs are verbatim, and their falsifiers are already measured. If the orchestrator declines: **+2 LOW `未實作` trace rows**, ADR-049's 「the split has NOT landed … UNGUARDED」 stands into Gate 8, and `dashboard-page-source.test.ts:95` keeps guarding dead bytes.

**S-5 — Unchanged and out of scope, named so they are not mistaken for omissions:** DES-200's accepted limitation (the island is read once; a tab open across a self-update shows the outcome current at load — v28's `/api/status` poll); F-7/QD-S2 (listeners never released, blob URL revoked only on replace); REQ-142's visibility gate (attaches to the one scheduler at `app.js:396`, still one timer — TASK-208's `[v27c]` grep is TRUE at HEAD: `setTimeout` appears in `app.js` only).

### Agent altitude

N/A: memory metabolism, tool-liveness probing and prompt calibration are gateway/executor concerns; nothing here touches `src/gateway/` or `src/agent-executor.ts`.

---

## 5. Where task-splitting decides whether a property survives (for the synthesizer)

1. **Mint TASK-215 (A) and TASK-216 (B)** with `status: draft` (the ledger's word for unlanded — 27 rows carry it), `iter: v27j`, `estimate: S`. TASK-215: `traces: ARCH-122, ARCH-125, ADR-049, REQ-131`; `files: src/dashboard-page.ts, tests/unit/dashboard-page-source.test.ts, tests/unit/dashboard-zoom-source.test.ts, tests/unit/workflow-page-harness-table.test.ts, tests/unit/dashboard-diagram-render.test.ts`; `des: DES-200`; `dod:` C-2's table. TASK-216: `traces: ADR-049, ARCH-124, REQ-131, REQ-134`; `files: tsconfig.server.json (new), package.json, tests/unit/tsconfig-server-program.test.ts (new)`; `des: DES-191`; `dod:` C-3.
2. **Both `des:` parents need the amendment first** — DES-200 (Layer-1 shape + the literal + the three struck clauses) and DES-191 (R-1's sentence). A TASK whose `des:` names a row that does not describe it is the drift the trace tool flags next iteration.
3. **The tests this loop implies have no gate.** TASK-215 adds a UT-241 positive; TASK-216 adds a new UT (next free id UT-258). Either the orchestrator adds `tests` to the micro-dispatch, or both DoDs carry the red-first clause in as many words: *write the assertion FIRST, run it red against HEAD (the fossil is present / the script strings lack the program), then green* — the `/sdlc-fix` F-pattern. Same point as my closure-re-opened r1 §5.5; it applied then and it applies now.
4. **Ordering, same rule as preamble rule 3 (`03-tasks.md:1631-1633`):** TASK-215's body deletion and its five dispositions land in ONE commit. Deletion first turns five assertions red; dispositions first leaves them green over dead bytes.
5. **Section header `03-tasks.md:1620` says `TASK-196..213`** while TASK-214 exists under it; make it `..216` in the same edit.
6. **The render check is NOT a task.** No ARCH parent exists for ledger tooling and Gate 4 makes no code changes; it goes to §9 beside TOOL-FORK with O-1's spec attached. If the orchestrator wants it in the chain, that is a Gate 2 touch this loop forbids — say so rather than mint an orphan.
7. **The rationale section** goes at file end as `## Decision rationale — v27j (Gate 8 send-back repair, design half)`, after v27c's (`:7141`), in the ledger's who-conceded-and-why form.

## 6. Ledger edit map (proposed)

| Where | Edit |
|---|---|
| `04-design.md:3306` block | line 2 (new, own-line): `%% #123; #125; #44; are { } , — a classDiagram member cannot carry them literally (DASH-2, v27j)`; `:3308` `Promise~{version}~` → `Promise~#123;version#125;~`; `:3309` `Promise~{channel,version,from}~` → `Promise~#123;channel#44; version#44; from#125;~`; `:3315` `Promise~{removed}~` → `Promise~#123;removed#125;~`. Falsify by render (§0). |
| DES-202 `:6808-6809` | `amended (v27j)`: strike "any `ok` … → `live`"; O-3's rule; the tests-line case flipped; R-2's flip set + reference to ARCH-124's `owner_decision: pending` |
| DES-199 `:6783` | `amended (v27j)`: `cache:` type literal → the full directive (`static-assets.ts:33`) |
| DES-200 `:6791-6793` | `amended (v27j)`: `server.ts:1251-1257` → `:1334`; strike "markup and CSS only" and "`draggable="false"` … stays on `DASHBOARD_HTML`" (IMPL-270; `dashboard-page-source.test.ts:42-43`); Layer-1 shape per ARCH-122's amended `api:` + `<main class="empty">` + O-2's literal (fallback `…` recorded); R-5's why-outside-the-table clause; tests line gains the UT-241 positive; 「until TASK-215 lands the fossil body stands and is not a test subject」 |
| DES-191 `:6719-6722` | `amended (v27j)`: R-1's second-program sentence + the two falsifiers + the accepted editor limit |
| TASK-205 `:1752` | `[v27j]` strike "and `DASHBOARD_HTML` still contains `draggable="false"`" (same strike style as its `[v27c]` one) |
| TASK-206 `:1761` | `[v27j]` "any `ok` → `live`" → O-3's rule |
| TASK-215 (new, after `:1835`) | per §5.1 / C-2 |
| TASK-216 (new) | per §5.1 / C-3 |
| `03-tasks.md:1620` | header range `TASK-196..213` → `..216` |
| `04-design.md` end | `## Decision rationale — v27j` |
| `07-review.md` §9 (orchestrator / next Gate 8 pass) | new row beside TOOL-FORK: the render check, O-1's spec, "manual until upstream `dashboard_check` renders" |
| `02-architecture.md:3782+` (Gate 2's, recorded not taken here) | the two classDiagram authoring rules from §0, beside the sequenceDiagram rule |
| COULD (one token each, caveats not contradictions) | TASK-204 `:1743` "`immutable`" → the directive; DES-198 `:6777` "woff2 `immutable`" → the directive; DES-200 tests line names `val-198:287` as the rendered-page INV-V27-5 lock; `deregister`'s `claimedTriggers` in the v22 diagram |

---

## key_points

1. **DASH-2 = entity codes, +32 chars, zero meaning change** — `#123;`/`#125;` for the braces, `#44;` for the commas; measured to render all eight members as written (`Promise<{version}>`, `Promise<{channel, version, from}>`, `Promise<{removed}>`), 0 literal `%%`. The finding's `Promise~VersionResult~` is refused because it names types `src/workflow-catalog.ts` does not have; `note for` is the runner-up (adds a box). One own-line `%%` comment explains the entities to a human reader.
2. **Two classDiagram authoring rules from the measurement**: braces open a struct inside a member; a `,` or `(` inside `~…~` disables the generic conversion and renders the tildes verbatim (a parse-clean failure). They belong beside v27h's sequenceDiagram rule.
3. **Six rows still describe the pre-v27g tree** — DES-202 (`any ok → live` + the inverted test case), DES-199 (`cache` literal), DES-200 (stale caller line; "markup and CSS only"; `draggable` on `DASHBOARD_HTML`), TASK-205, TASK-206. Each is a one-clause `amended (v27j)` under the architect's rule: repair contradictions, add no caveats.
4. **DES-202's narrowing is written like ARCH-124's** — one overturnable sentence inheriting `owner_decision: pending`, with the four-place flip set enumerated, so the owner's ruling is a listed change, not a hunt.
5. **UT-240 → UT-241.** ARCH-122's TASK-A text copied the test file's mislabel; the ledger's UT-240 is `static-assets.test.ts`. TASK-215 cites UT-241 and fixes `dashboard-page-source.test.ts:51` in the same commit. The trace tool cannot see this (both ids exist).
6. **TASK-216 has no design parent until DES-191 gains one sentence** — the guard tier grows the inverse `tsc` program; both programs load-bearing; one UT pins the script strings.
7. **The pre-boot literal says the client did not start and names `/static/dashboard/ui/app.js`** (bilingual, in the `.empty` hook, no `id`, no timer, no `<noscript>`); `…` is the recorded fallback and it costs the diagnosis. It is outside the string table by construction, and the row says why.
8. **TASK-215's DoD as TASK-213's STAYS/MOVES/RETIRES table**, plus the UT-241 positive (`<main class="empty">` + island + module script, no `<section`/`<header`) that fails if the fossil returns.
9. **The render check is a §9 tooling row with a spec, not a task** — parse AND render per block in real Chromium from `node_modules`, no literal `%%` in the SVG, no verbatim `~` in classDiagram member text, `file:line` per failure, exit 1 on FAIL, loud exit-2 SKIP without a browser; manual until the plugin's `dashboard_check` renders.
10. **Micro-dispatch before the re-review**; declining costs +2 LOW `未實作` and leaves ADR-049's boundary UNGUARDED into Gate 8. **No tests gate in the loop** → the F-pattern clause in both DoDs, or add `tests`.

## risks

| # | Risk | Severity | Where it lands |
|---|---|---|---|
| QD-R1 | **DASH-2 is closed with the finding's literal suggestion** (`Promise~VersionResult~`): the diagram renders and names three types that do not exist in `src/`; the next reader greps for them and finds nothing — a rendered lie replaces a rendering failure. | HIGH | §0, R-3 |
| QD-R2 | **DES-202 keeps "any `ok` → `live`"** while `connection.js:26-31` ships `worstOf`: the design text, the architecture text and the code disagree three ways during the very owner decision that asks which reading holds. | HIGH | O-3, R-2 |
| QD-R3 | **TASK-215 cites UT-240**: the implementer opens `static-assets.test.ts`, finds no `draggable` case, and either invents one or retires the wrong thing; trace stays green throughout. | HIGH | C-1, §5.1 |
| QD-R4 | **TASK-216 minted with a dangling or invented `des:`**: either the trace tool flags a broken link next pass or a DES row appears that no lens argued for. | MID | R-1, §5.2 |
| QD-R5 | **The pre-boot literal lands as `…`**: a module 404 / CSP block / syntax error is a page with one glyph; the adversarial lens's own "not a seam" objection to the empty mount applies to it unchanged. | MID | O-2 |
| QD-R6 | **The render-check spec is not written into the ledger this round**: the prototype dies with this session, the §9 row says "a script" with no oracle named, and the fourth DASH recurrence is found by a human again. | MID | O-1, §5.6 |
| QD-R7 | **Body deletion and the five dispositions land in two commits**: five assertions red (or, worse, left green over dead bytes) between them; the cheapest wrong fix is deletion. | MID | §5.4 |
| QD-R8 | **No tests gate and no F-pattern clause**: UT-241's positive and the TASK-216 pin land as prose in a DoD, never as a red-then-green test; the properties have no proof. | MID | §5.3 |
| QD-R9 | **The micro-dispatch is declined silently**: +2 LOW `未實作`, ADR-049's UNGUARDED sentence stands into the re-review, and `dashboard-page-source.test.ts:95` keeps guarding bytes no browser paints. | LOW (cost) / MID (if unrecorded) | S-4 |
| QD-R10 | **The entity form is "cleaned up" by a later reader** who does not know why `#123;` is there and restores the braces — the failure returns, still parse-clean in `dashboard_check`. | LOW | C-4 (the own-line comment is the mitigation) |
| QD-R11 | **DES-202 is amended to the shipped reading without the flip set**: the owner overturns, ARCH-124 flips, DES-202 does not, and the next Gate 8 finds the drift this round created. | LOW | R-2 |

## expected disagreements with other lenses

- **vs. the adversarial lens — on the pre-boot literal as "a scattered string".** They will cite REQ-131's 「畫面不得散落字面值」 and QD-R3. My position: the clause scopes itself to nav / tab / 欄位標題 painted by the client; this text is server-emitted before any table exists and is destroyed on every healthy boot. If they hold the line, the `…` fallback is recorded — with its cost: a dead client is a blank page, which is the objection THEY raised against the empty mount in v27h. They cannot have both.
- **vs. the adversarial lens — on the entity form as "unreadable source".** Agreed that `#123;` costs readability; the own-line comment is the price, and it is one line. The alternatives are a rendered lie (named types), a lost shape (braces dropped — and commas still break it), or a visible box (`note for`) in a repair whose subject is that the diagram must show the right thing — the same reasoning that chose own-line comments over Notes for DASH-1.
- **vs. the design synthesizer — on the induced-drift sweep as scope creep.** The dispatch names DASH-2 and the two tasks; I am proposing six row amendments. The architect applied exactly this sweep to `02` at v27h and called it the same defect class; leaving the design half unswept while amending the architecture half is the asymmetry the next Gate 8 will file as drift. Every amendment is a contradiction repair, none a caveat, and I have marked the caveats COULD.
- **vs. a simplicity reading — on the UT that pins two script strings (TASK-216).** "A test that greps `package.json`" looks like ceremony. It is the only thing that stops a later simplification from collapsing `tsc --noEmit && tsc --noEmit -p tsconfig.server.json` back to one program — the exact shape in which the property died the first time (D-ADV-5 refused the second config as ceremony; IMPL-229 then measured its cost). Both programs are load-bearing; a two-line UT is cheaper than re-learning that.
- **vs. whoever wants the render check as a vitest test.** Both v27h lenses agreed a `.md` is not the product; I hold that. The disagreement I expect is the opposite one — "then it is not design's business". It is: the design gate owns the diagrams that fail, the authoring rules that prevent it, and the sentence in §9 that says the control is manual until upstream renders. What Gate 4 may not do is commit the script.
- **vs. the architect — on the UT-240 label.** Not a disagreement, a correction: ARCH-122 `:3343` says UT-240 twice; the ledger says UT-241. The TASK row is the place to get it right; ARCH-122's text can be fixed at the next Gate 2 touch and is named here so it is.
