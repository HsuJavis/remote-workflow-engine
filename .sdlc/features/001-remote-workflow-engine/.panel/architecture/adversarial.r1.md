---
stage: architecture (Gate 2) — v27 Gate 8 SEND-BACK repair round
lens: adversarial group — (a) security, (b) scalability/performance, (c) testability;
      Karpathy simplicity-first as the tie-breaker
round: 1 (independent proposal — written without reading this round's quality-dimensions file)
scope: the three architecture-owned items of `07-review.md` §8 — AC-2, AC-3a, DASH-1 —
       plus two ARCH rows the Gate 6 send-back repair itself put out of date
baseline: HEAD **eb387a1** (`git rev-parse HEAD`). Every `file:line` below is a line number AT
          eb387a1, re-opened this round. The Gate 8 review's numbers are at `ef0a400` and several
          have MOVED (its `app.js:427` is `:455` here) — do not copy them forward.
method: five claims in this file were produced by EXECUTION, not by reading — a real mermaid parse
        of all 40 ledger diagrams, a real `mmdc` render of the two broken ones before and after
        candidate repairs, and a real `tsc` run over the server tree with the DOM lib removed.
        Commands and verbatim output are in §5 so round 2 can re-run them.
prior round preserved: this file REPLACES the v27b delta proposal (ADR-051 mask reversal, last
        written at c7447d0). Read it with `git show eb387a1:.sdlc/features/001-remote-workflow-engine/
        .panel/architecture/adversarial.r1.md`; the Sprint A proposal is untouched on disk at
        `adversarial.r1.sprintA.md`.
---

# Adversarial architecture — round 1, v27 Gate 8 send-back repair

## 0. Altitude call, and the lens boilerplate retired with evidence

**Is this a plain system or an AI-agent system?** Both, and the two altitudes separate cleanly here.
The product (`state.yaml` `tech_stack`) is an agent-execution engine: Claude Agent SDK sessions per
`agent()`, a LiteLLM gateway, per-agent transcripts, a harness descriptor. That is agent altitude.
**This repair round is entirely system altitude** — its four artefacts are a `tsconfig.json`, a
server-rendered HTML shell, two Markdown diagrams and two stale `api:` sentences. Nothing in the
send-back touches prompt composition, tool surface, model routing or agent lifecycle.

One agent-altitude thread runs through it and must not be cut: the dashboard is the **operator's
only console onto agent runs**, so its observability claims (the connection tag, the shell's degrade
behaviour) are agent-altitude *observability* delivered by system-altitude mechanism. I apply that
thread where it bites (A2's silent-degrade argument, A3's "a tag that lies") and nowhere else.

**Lens boilerplate that does not apply, stated once so nobody hunts for it.** My brief names brute
force, JWT forgery, timing attacks and the concurrency of failure counting. Checked at eb387a1, not
assumed:

- **No JWT is minted by this engine.** Bearer tokens are opaque random strings, sha256-at-rest,
  looked up by hash (`src/auth/token-store.ts:14-15`, `:91`, `:100`). There is no signature for an
  attacker to forge and no plaintext secret comparison to time. The engine *verifies* Google's
  `id_token` — inbound JWT verification, unchanged by this delta.
- **Timing:** the two places a secret is compared byte-wise already use `timingSafeEqual`
  (`src/webhook-registry.ts:315`, `src/self-update-webhook.ts:32`).
- **Brute force:** there is no rate limiter or lockout anywhere in `src/` (grep for
  `rateLimit|attempts|lockout` returns only retry counters and comments). That is a standing property
  of the loopback/tunnel deployment posture (D5), **not** something this delta created or can fix; it
  is out of the repair scope and I do not propose touching it.
- **Failure counting concurrency:** the only failure counter this delta owns is
  `consecutiveFails` in `src/dashboard/lib/connection.js:24-38`. It is per-browser-tab, in memory,
  never persisted, never shared, and authoritative for nothing but a coloured word in a nav bar. The
  lens's consistency question therefore has a real answer — **each viewer counts independently and
  they may legitimately disagree** — and that answer is harmless. It becomes interesting only in A3,
  where what the counter *reports* is currently a false statement.

---

## 1. Summary — my position in eight lines

1. **The send-back's architecture list is right but incomplete.** AC-2, AC-3a and DASH-1 are real and
   I confirm all three on disk. Two more architecture rows went stale **during the Gate 6 repair
   round itself** (A3: ARCH-124's connection clause now contradicts the shipped AC-4 fix; A4:
   ARCH-123's `cache` type literal now contradicts the shipped AC-8 fix). If round 2 amends only the
   three named rows, the re-review re-opens the other two — this time against repairs Gate 8 ordered.
2. **DASH-1's prescribed repair fixes half the defect.** Executed, not argued: each broken diagram
   contains a **second** semicolon that the parser never reaches, because it stops at the first
   error. Replacing "those two semicolons" leaves both diagrams still failing to render (§5.1).
3. **DASH-1's root cause is also mis-stated, and the mis-statement has a cost.** Mermaid treats `%%`
   as a comment **only at the start of a line**; mid-line it is message text. Proven: after the
   semicolons are fixed, all **seven** `%% …` annotations across the two diagrams render as literal
   visible junk inside the message labels (§5.2). "Renders" and "reads correctly" are not the same
   repair, and the second one is what the reader needs.
4. **AC-2 has a decisive number and it favours the scoped split.** The server tree — 76 `.ts` files —
   type-checks at **0 errors** today with `lib: ["ES2022"]` and no `allowJs` (§5.3). The guard ADR-049
   called load-bearing can be bought back for one config file and one `package.json` line, with zero
   `src/` changes. I am re-proposing something the v27 synthesis refused by name, and §2.A1 argues
   why the refusal's premise is falsified rather than pretending it was never made.
5. **AC-3a's obvious wording is ahead of the tree.** The review suggests "shell = head + island +
   asset refs + a mount point". There is no mount point: `#app-view` is client-built. Amend to what
   exists, and put the mount point in a *named follow-up impl item* — not into an `api:` line that
   would be false the moment it is written.
6. **AC-3b is half-repaired, and ARCH-122's unamended sentence is why.**
   `tests/unit/dashboard-page-source.test.ts:95` still asserts `draggable="false"` against
   `DASHBOARD_HTML`, with a comment saying "the markup pin stays on DASHBOARD_HTML" — a duplicate of
   the exact assertion the send-back ordered re-pointed (now `:42-43`; the review cited it at `:38`, at `ef0a400`). The architecture sentence that
   authorises it ("still assertable here") must go in the same edit, or the pin comes back.
7. **Gate 2 cannot close any of this alone, and the amendment text must say so.** AC-2 and AC-3a both
   require a code change Gate 2 may not make. Every amendment I propose therefore describes **the
   tree as it will be at re-review time** and names its follow-up impl item explicitly. The failure
   mode to avoid is the one the review named in advance: an amended ADR beside an unchanged
   `tsconfig.json`.
8. **Simplicity tie-break, applied honestly:** of the two SHOULD items I propose, one is a 30-line
   script using dependencies already in `package.json`, and the other is a single sentence. I propose
   no new module, no new layer, no new dependency, and I explicitly refuse six findings that are
   already recorded debt (§2.W).

---

## 2. Key points — amendment-ready text

Each item below is written so round 2 can lift it into `02-architecture.md` with minimal editing.
`MUST` = the repair does not close without it. `SHOULD` = cheap, closes a repeat-finding loop.
`WON'T` = stays §9 debt this round, named so round 2 does not re-derive it.

### A1 (MUST) — AC-2: ADR-049 / ARCH-124 vs. the root `tsconfig.json`

**Confirmed on disk.** `tsconfig.json:7` → `"lib": ["ES2022", "DOM", "DOM.Iterable"]`; `:8` →
`"allowJs": true`; one tsconfig, `include: ["src","tests","vitest.config.ts"]`, no project
references. ADR-049's Consequences (`02-architecture.md:3433`) still read 「`allowJs`/`checkJs` and a
`DOM` lib are **deliberately NOT added** to the root tsconfig, because that would make `document` a
known global in server code」.

**Measured before proposing** (this is the part the review did not have): the guard's loss is
**latent, not exploited**. No `src/**/*.ts` uses a DOM global as a value or a type today — every grep
hit for `document|window|localStorage|HTMLElement|getComputedStyle` in server TS is either the
English word "window" in a comment or a `<script>` string inside `src/auth/auth-service.ts:273`'s
HTML literal. So the repair is architecture + config only; no server code has to change.

**Two honest options.**

- **(a) Record what shipped, and name a replacement guard.** Amend ADR-049 and ARCH-124 to say the
  root config carries `DOM`/`DOM.Iterable`/`allowJs`, and add a unit guard that greps `src/**/*.ts`
  (the client tree is `.js`, so it is naturally out of scope) for DOM identifiers. Cost: one new
  test, forever. Weakness: a grep sees **identifiers**, not **types** — it cannot catch
  `function f(el: HTMLElement)`, a `Response` that silently resolves to DOM's, or a `Buffer` that
  stops assigning to `BodyInit` (the exact failure IMPL-229 itself hit at
  `val-091-seed-manifest-ref.test.ts`). It reinstates a weaker guard and calls it the same guard.
- **(b) Scope the DOM lib to the tests program.** Root `tsconfig.json` returns to
  `"lib": ["ES2022"]`, no `allowJs`, `include: ["src"]`; a new `tsconfig.tests.json` `extends` it with
  `"lib": ["ES2022","DOM","DOM.Iterable"]`, `"allowJs": true`, `include: ["src","tests","vitest.config.ts"]`;
  `typecheck`/`build` run both. Cost: one new file, one `package.json` line.

**Decision: (b).** Three reasons, in order.

1. **The number.** `tsc --noEmit` over the 76 server `.ts` files with `lib:["ES2022"]` and no
   `allowJs` is **0 errors at eb387a1** (§5.3). (b) is available today at zero `src/` cost. Nothing
   about (b) is speculative — it is the configuration the repo had before `ddc4409`, minus the 36
   errors, which were never server-tree errors at all: IMPL-229's own account attributes all 36 to
   four acceptance files' `page.evaluate` callbacks and to `.ts` tests importing client `.js`.
2. **The tie-breaker cuts toward (b), not away from it.** Karpathy-minimal is the smallest mechanism
   that solves the stated problem. The stated problem is "four acceptance files and a handful of
   `.ts` tests need DOM types". (b) is scoped to exactly that set. (a) leaves the widening
   repo-wide and then adds a *second* mechanism (a bespoke grep test) to partially undo it.
3. **This lens should not accept a guard downgrade dressed as a record-keeping fix.** ADR-054 was
   graded HIGH by this same panel at Gate 8 for precisely this move — choosing the cheap half of a
   pair on the argument that it "delivers the identical property", when it does not. (a) is that
   move again, one row over.

**The refusal I am overturning, named.** `02-architecture.md:3666` records that D-ADV-5's
`tsconfig.client.json` was 「refused as ceremony」 in the v27 synthesis. I am re-proposing its sibling
and I will not pretend otherwise. **Why the refusal's premise is gone:** it assumed keeping
`lib:["ES2022"]` was free, so a second config bought nothing. IMPL-229 proved it was not free — it
cost 36 errors — and the resolution actually taken (repo-wide `DOM`) is the option ADR-049 refused
*harder* than it refused the second config. A second config is ceremony when the first one already
holds; it is the price of the guard when the first one no longer does.

**Amendment text (lift verbatim, adjusting the IMPL id):**

> **amended (v27 Gate 8 send-back — AC-2):** ADR-049's Consequences sentence 「`allowJs`/`checkJs` and
> a `DOM` lib are deliberately NOT added to the root tsconfig」 is **superseded in part**, and
> ARCH-124's note repeating it is superseded with it. What shipped at `ddc4409` (IMPL-229) added
> `"DOM","DOM.Iterable"` and `"allowJs": true` to the single root `tsconfig.json`, repo-wide, to
> resolve 36 pre-existing `tsc` errors that all originate in the TEST tree. The decision recorded
> here is that the DOM lib is **scoped to the tests program**, not kept repo-wide: root
> `tsconfig.json` → `"lib":["ES2022"]`, no `allowJs`, `include:["src"]`; a new `tsconfig.tests.json`
> `extends: "./tsconfig.json"` with `"lib":["ES2022","DOM","DOM.Iterable"]`, `"allowJs": true`,
> `include:["src","tests","vitest.config.ts"]`; `npm run typecheck` and `npm run build` run **both**
> projects. Measured at eb387a1: the 76-file server tree type-checks at 0 errors under the narrowed
> root config, so no `src/` change is required. **State of the tree when this amendment is written:
> the split has NOT landed — `tsconfig.json` still carries `DOM`/`allowJs`. The config change is
> IMPL-nnn (Gate 6), and until it lands this ADR describes a decision, not the tree.** `checkJs`
> stays off (IMPL-229's "readable to `tsc`, not checked by it" limit is unchanged and still accurate
> for the tests program).

**What round 2 must not do:** write the amendment and leave the tree unchanged without the bolded
sentence. That is the failure the review pre-named, and it converts a MID into a repeat MID.

### A2 (MUST) — AC-3a: ARCH-122 describes a page that is deleted before first paint

**Confirmed on disk, and worse than the review states on one point.** `src/dashboard/ui/app.js:455`
is `document.body.replaceChildren(nav, routeMount, buildFooter())`. `src/dashboard-page.ts:91-150`
emits the **pre-v27 body** (`<h1>… Live Dashboard</h1>`, `Runs`/`Issues` links, `#home`/`#detail`/
`#issues` sections, `.cards`/`.pill`). ARCH-122's `api:` (`02-architecture.md:3336`) claims
`DASHBOARD_HTML` 「now holds **markup and CSS only** … the design tokens as custom properties on
`:root[data-theme=…]` … the nav with the source tag, the four tab shells, the `#dag-zoom`/
`#dag-graph`/`#dag-fit` anchors, `#run-usage`, `#diagram-zoom`/`#diagram-img[draggable="false"]`, the
`.card`/`.t`/`.tag`/`.btn` component classes, and the slide-in panel's empty container」.

**Both halves of that sentence are wrong, not one.** The markup half is dead bytes. The **CSS half is
also gone**: there is no `<style>` element in the shipped page at all (the single `<style` hit in
`src/dashboard-page.ts:69` is a comment recording its removal); the tokens live in
`src/dashboard/dashboard.css`, served by ARCH-123's map. The review's AC-3a text does not mention
this; an amendment that fixes only the markup half leaves a false CSS claim in the same sentence.

**Do not adopt the review's suggested wording as-is.** It proposes 「shell = `<head>` + island + asset
refs + **a mount point**」. There is no mount point in the shell — `#app-view` is created by the
client (`app.js:332`'s `routeMount.id = 'app-view'`, read back at `:403` and `:422`). Writing "a mount point" into an
`api:` line makes it false on the day it is written, which is the same defect class being repaired.

**Amendment text:**

> **amended (v27 Gate 8 send-back — AC-3a):** this item's `api:` over-claims what the shell emits.
> What `buildDashboardHtml` actually emits, normatively, is: `<html data-theme="dark" lang="zh-Hant">`
> + a `<head>` carrying `<link rel="stylesheet" href="/static/dashboard/dashboard.css">` and the
> blocking classic `<script src="/static/dashboard/ui/theme-init.js">` + a
> `<script type="application/json" id="rwe-init">` data island + a `<script type="module"
> src="/static/dashboard/ui/app.js">`. **The page's entire body is client-built**:
> `src/dashboard/ui/app.js:455` runs `document.body.replaceChildren(nav, routeMount, buildFooter())`
> on mount, so the nav and its source tag, the four tab shells, the route container (`#app-view`),
> the `#dag-zoom`/`#dag-graph`/`#dag-fit`/`#run-usage`/`#diagram-*` anchors, the `.card`/`.t`/`.tag`/
> `.btn` component classes and the slide-in panel container are **ARCH-125's**, not this module's.
> The design tokens are not here either — there is no `<style>` in the page; they are in
> `dashboard.css` (ARCH-123's map). The clause 「C1's three literal page-source pins … still
> assertable here」 is **STRUCK**: a pin on `DASHBOARD_HTML` proves a string the browser discards.
> C1 is satisfied where the bytes live — `clientFile('dashboard.css')` for the two CSS rules,
> `clientFile('ui/workflow.js')` for `img.draggable = false` — which is the shape v27c already used
> for the CSS pair and the AC-3b repair used for the `<img>`. **Pending in the tree (IMPL-nnn,
> Gate 6):** (i) `tests/unit/dashboard-page-source.test.ts:95` still asserts `DASHBOARD_HTML`
> matches `draggable="false"`, a surviving duplicate of the pin AC-3b re-pointed (now `:42-43`) — it must be
> re-pointed or deleted with the same reasoning; (ii) the dead pre-v27 body should be deleted and
> replaced by `<main id="app-view"></main>` plus a `<noscript>` line, per the decision below.
> Two guards this item carries are unchanged and still correct: the island is data, not script
> (no nonce, ARCH-040/INV-V27-5 survive a rebuild), and there is zero inline executable JS
> (what makes ARCH-130's CSP achievable).

**Decision to record alongside it (adversarial, observability at the agent altitude):** the dead body
is not inert — it is a **failure mask**. If `/static/dashboard/ui/app.js` 404s (ARCH-123's own
missing-file degrade path), is blocked, or throws on parse, `replaceChildren` never runs and the
operator is left looking at a fully rendered *retired* dashboard: headings "Running / Registered /
Other / System / Models" over empty containers. That reads as **a healthy engine with nothing
running** — the single most dangerous thing an operator console can say falsely, and the one the
connection tag cannot correct because the code that paints the tag is the code that failed to load.
Replacing the body with one empty mount point plus a `<noscript>`/fallback line is a net deletion of
roughly 60 lines and turns a silent mask into a visible error. Recorded as a decision with IMPL-nnn
named; Gate 2 does not make the change.

### A3 (MUST, NEW — induced by the AC-4 repair) — ARCH-124's connection clause now contradicts the shipped code, and narrows REQ-131

**What changed under the architecture.** The Gate 6 send-back repair wired `worstOf`
(`src/dashboard/lib/connection.js:9-15`) into `nextConnection` (`:24-38`): the tag is now the worst
status among the visible view's routes, and `live` requires **every** route `ok`. The unit tier was
rewritten to match — `tests/unit/dashboard-lib-connection.test.js:30-34` now asserts
`{describe: ok, /api/runs: degraded}` → `degraded`.

**The contradiction.** ARCH-124's `api:` (`02-architecture.md:3354`) still says 「**any `ok` → `live`
immediately**; a route answering 200 with a `degraded` string → `degraded` for that route and for the
tag when it is the worst state among the routes the visible view depends on」. Those two clauses
cannot both hold for a mixed tick; the repair implemented the second and left the first standing.
**A mechanical Gate 8 re-review will read the first clause and flag the AC-4 repair as an ARCH-124
violation.** Also: `worstOf` is now a live export with a caller and appears **nowhere** in
`02-architecture.md` (grep: 0 hits), while ARCH-124's `api:` opens 「Five files, every export pure and
total」 and enumerates the rest.

**The upstream half nobody has written down.** REQ-131's acceptance (`01-requirements.md:1729`) says
「**Given** 任一 `/api/*` 取得成功 **Then** nav 的來源 tag 顯示「連線中 / Live」…連續失敗 **Then**
顯示「離線 / Offline」」. Read literally, "any `/api/*` success → Live" is the behaviour the repair
removed. The requirement names only two states; `degraded` is an architecture-introduced third, so
narrowing is defensible — **but it is a narrowing of a REQ acceptance clause and must be recorded as
one**, not left for Gate 7.5 to trip over with REQ-131's text in hand.

**Why the repair is right on the merits and should stand** (my lens, not a deference): a tag reading
「連線中」 while the route feeding the visible table is degraded is a *false statement to the operator*,
and the whole point of REQ-131's tag is to tell the truth about connectivity. `worstOf` makes the tag
honest. Keep it; fix the text.

**Amendment text:**

> **amended (v27 Gate 8 send-back — AC-4's repair, ARCH-124 `api:`):** the `connection.js` clause is
> superseded in part. Strike 「any `ok` → `live` immediately」. The tag is
> **`worstOf(perRoute)`** over the routes the VISIBLE view depends on: `live` only when every one of
> them is `ok` (recovery is never debounced — a single all-`ok` tick restores `live` from any state);
> any mix containing a `degraded` or a `fail` beside a better sibling reports `degraded`; `offline`
> only after ≥ 2 consecutive **unanimous**-`fail` ticks (REQ-131's 連續失敗; one transient miss during
> a self-update restart must not paint the team's tabs red). `connection.js`'s exports are
> `worstOf(perRoute) → status`, `nextConnection(prev, tick) → State` and
> `classifyResponse(status, body) → status` — all pure and total. **Reading of REQ-131 recorded
> explicitly:** REQ-131's 「任一 `/api/*` 取得成功 → Live」 is narrowed to 「visible-view routes ALL ok
> → Live」, because the requirement enumerates only Live/Offline while this architecture introduces
> `degraded`, and a tag that says 連線中 while the table's own route is degraded misinforms the
> operator the tag exists to inform. Verified by `tests/unit/dashboard-lib-connection.test.js:30-34`.
> If the owner prefers the literal reading, this is the sentence to overturn — it is recorded here
> rather than left implicit so that overturning it is a one-line decision.

### A4 (MUST, NEW — induced by the AC-8 repair) — ARCH-123's `cache` type literal

`src/static-assets.ts:33` now declares
`export type StaticAssetCache = 'public, max-age=31536000, immutable' | 'no-store'` (the AC-8 repair:
the value IS the header, because bare `immutable` is a modifier with nothing to modify, RFC 8246).
ARCH-123's `api:` (`02-architecture.md:3346`) still types it `cache: 'immutable' | 'no-store'`. The
row's prose already states the correct policy; only the type literal is stale. One-line amendment:

> `STATIC_ASSETS: ReadonlyMap<string, { file: string; type: string; cache: 'public,
> max-age=31536000, immutable' | 'no-store' }>` — the `cache` value **is** the `Cache-Control`
> header written verbatim by the route (v27 Gate 8 AC-8 repair; a bare `immutable` is a modifier with
> nothing to modify, RFC 8246). Policy unchanged: woff2 → one year immutable, JS/CSS → `no-store`.

Left at MUST rather than SHOULD because the re-review's routing rule is mechanical — an `api:` clause
the tree contradicts is blocking regardless of how small the contradiction is, and skipping it turns
a one-line edit into a second blocking finding.

### A5 (MUST) — DASH-1: four semicolon sites, not two, and seven annotations that will render as junk

**Executed, not read** (§5.1, §5.2). Both `sequenceDiagram`s fail `mermaid.parse` at 11.17.2, as the
review says. The repair instruction is 「replace those two semicolons」. That is half the defect:

| Diagram | First stop (what the review found) | Second stop (only reachable after the first is fixed) |
|---|---|---|
| `02-architecture.md:2531` (registration/run process view) | `:2539` — `ok (minRole author; ownership …)` | `:2547` — `BEGIN IMMEDIATE; INSERT workflow_versions(…); COMMIT` (**two** semicolons) |
| `02-architecture.md:3561` (dashboard tick process view) | `:3574` — `%% never a 500; a fault is …` | `:3576` — `Note over B: … pure functions; transform stays on #dag-zoom` |

A `jison` parser reports the first error and stops, which is exactly why a "fix what the error says"
repair reports success while the diagram is still broken. Verified both directions: with only the
first site fixed, each diagram still fails (at the second site); with both fixed, each renders
(38 452-byte and 31 156-byte SVGs).

**The root cause in the review is also wrong, and the mis-statement costs fidelity.** The review
attributes `:3574` to 「a `;` inside a `%%` comment」. There is no comment there: mermaid honours `%%`
as a comment **only at the start of a line**; mid-line it is ordinary message text. Proof — the
rendered SVG of the repaired diagram contains the literal string `SD?}]  %% never a 500 · a fault is
200 {degraded} + dashboard_api_degraded`. **All seven** `%% …` annotations in the two diagrams (three
in the registration view, four in the tick view) are message text and will render as visible junk
inside the message labels once the diagrams parse. A repair that only removes semicolons produces
two diagrams that render and read badly.

**Prescription for round 2 / the editor:** (i) replace the four semicolon sites with `·`, `,` or a
line break (`·` verified to parse); (ii) move each of the seven `%% …` annotations onto its own line
as a real line-start comment, or convert it to a `Note over X: …` when the reader needs to see it;
(iii) re-run the parse check (§5.4) — not the eye — before declaring the item closed.

### S1 (SHOULD) — record the mermaid parse check as a decision + one follow-up item

This class has now bitten the ledger three times: v26's Gate 8 mis-recorded `:2531` as a checker
false positive, v27 shipped a **new** broken diagram (`:3561`) in its own process view, and the Gate 8
repair instruction for both is half-right. The vendored `.sdlc/trace.py` fork cannot catch it
(§9 TOOL-FORK: no offline mermaid fallback).

**The whole control is 30 lines and zero new dependencies** — `puppeteer` and `mermaid` are already
in `package.json`; the run takes about 12 seconds for all 40 blocks and it found exactly the three
known-bad ones and no false positives (§5.4). Script inline in §5.4 so nobody has to invent it.

Recorded as **a decision plus IMPL-nnn**, deliberately *not* as an architecture module: it is ledger
tooling, it asserts nothing about the product, and making it a permanent CI test is a call for the
next iteration to make with a full round of scope, not a send-back round to smuggle in. Round 2 may
disagree (§4) — the discriminator is whether a ledger-doc check belongs in the product's test
denominator.

### S2 (SHOULD) — one sentence in ARCH-128 naming the single-writer assumption

F-6 is LOW and stays LOW. But its defect is *dishonesty at zero cost*: ARCH-128's 「Convergence: in
either order the row ends identical」 is true only because better-sqlite3 is synchronous and
`backfillUsage` (`src/store/sqlite-run-store.ts:310`) contains no `await`, so nothing can
interleave **within one process**. Two engine processes on one database file break it. Add to the
note: 「Convergence rests on a single synchronous writer: `backfillUsage` (`sqlite-run-store.ts:310`) is an untransacted
read-modify-write, safe because better-sqlite3 is synchronous and the body has no `await`. Two engine
processes against one database file would violate it; the engine is single-process by deployment
(D9) and this is the assumption to revisit if that ever stops being true.」 Zero code, closes a
finding that will otherwise be re-derived every review.

### W (WON'T this round) — named so round 2 does not re-derive them

Staying as `07-review.md` §9 recorded debt, with my lens's reason for not escalating:

- **F-4** (`endpointsFor` is no longer the run view's whole fetch set) — disclosed in-code; REQ-142's
  future attachment point survives because the extra fetches ride the one scheduler.
- **F-5** (`BACKFILL_PER_TICK` bounds a call, not the process; `_usageBackfillChecked` unbounded) —
  correctness survives on idempotence; a bound is owed, but adding one in a repair round is new
  mechanism with no failing signal behind it.
- **F-7** (`initZoomable`'s three `window` listeners per shell build, never removed) — bounded by
  navigations, not by time.
- **F-8** (INV-V27-1's oracle substitutes a priced call for the terminally-failed one) — impl-owned
  (AC-9 in §8, already repaired this round); nothing for architecture to amend.
- **QD-R2** (decidable logic in `ui/*.js` excluded from the coverage denominator on ARCH-124's
  premise) — this is the one W I am least comfortable with, since AC-4's crash lived in exactly that
  layer. It is a coverage-policy question with a real cost either way, and a send-back repair round is
  the wrong place to re-open it. Flagging it as the first candidate for the next full round.
- **INV-V27-7's 「every `/api/*` response」 vs. ADR-054's v27b budget rule** — the two texts disagree
  on scope; the budget rule is later and more specific and wins today. Worth one reconciling sentence
  eventually; not blocking, and AC-1's repair already landed against the budget reading.
- **The `/api/*` auth posture** (dispatched before any auth check, Host/Origin allowlist + bind as the
  only perimeter) — a standing, recorded design property, out of this repair's scope entirely.

---

## 3. Risks in my own proposal

1. **A1(b) is a config change I cannot make or test end-to-end from Gate 2.** I measured that the
   server tree compiles clean under the narrowed root config (§5.3) by passing an explicit file list
   to `tsc`, which is *not* identical to running `-p tsconfig.json` with `include:["src"]` — resolution
   of `vitest.config.ts` and of any ambient type packages differs. **Mitigation:** the follow-up IMPL
   item must run both projects and paste both exit codes; if `tsconfig.tests.json` turns out to need
   `src` in its `include` (it does, for the `.js` client modules) and that re-widens anything, the
   fallback is A1(a) with the grep guard, recorded as such rather than silently.
2. **A2's body deletion could go red in tests I have not enumerated.** I found one surviving pin
   (`dashboard-page-source.test.ts:95`); there may be acceptance selectors that resolve against
   shell-rendered elements before `app.js` runs. **Mitigation:** the IMPL item is "delete the dead
   body **and** re-point what breaks", not "delete the dead body"; the C2 Chromium anchors all hit
   live client-built elements (the review verified `#dag-fit` and `#diagram-img` at the real tier), so
   the blast radius is expected to be small but must be measured, not assumed.
3. **A3 touches a REQ acceptance reading.** A panel cannot amend a requirement. If round 2 or the
   owner reads REQ-131's 「任一…成功」 literally, the correct outcome is to revert the AC-4 repair's
   `live` half — and then ARCH-124's text is right and my amendment is wrong. I have written the
   narrowing as an explicit, overturnable sentence for exactly that reason. **This is the item most
   likely to need an owner ruling**, and it should be raised as such rather than resolved by two
   panels agreeing with each other.
4. **A5's `%%` finding enlarges DASH-1's edit surface.** Seven annotation moves plus four semicolon
   replacements across two diagrams is more editing than "replace two semicolons", and every edit to
   a mermaid block is a chance to break another one. **Mitigation:** §5.4's check is the falsifier —
   run it after the edit, over all 40 blocks, and the risk is bounded to "did it still parse".
5. **Scope creep is the structural risk of this whole round.** I add two MUST items (A3, A4) to a
   three-item send-back. Both are drifts *created by the repair itself*, both are one-sentence edits,
   and neither requires code. If round 2 thinks any of my SHOULDs are creep, drop them — S1 and S2 are
   genuinely optional; A3 and A4 are not, because the re-review is mechanical.

---

## 4. Expected disagreements with the quality-dimensions lens

Written before reading their round-1 file; each names the discriminator that should settle it rather
than a preference.

1. **AC-2: they will likely prefer option (a), "record what shipped".** Their lens weights
   replaceability and self-sustainability, and a second tsconfig is a second thing to keep in sync —
   plus they can point at `02-architecture.md:3666`, where the v27 synthesis already refused a second
   config as ceremony, and say I am relitigating a closed decision. **Discriminator:** which mechanism
   actually keeps `HTMLElement` out of a server function signature. A `lib` is enforced by the type
   checker on types; a grep sees identifiers only. If they can produce a grep that catches a DOM type
   in a type position, (a) wins on their reasoning and I will take it.
2. **S1: they will want the mermaid parse check as a permanent CI test, not a follow-up item.**
   Self-sustainability says a class that has bitten three times gets a standing guard. I agree with
   the direction and disagree about the round: a send-back repair is not where a new permanent test
   enters a suite of 2 833. **Discriminator:** does a check whose subject is a `.md` ledger document
   belong in the product's test denominator, or in `.sdlc` tooling? If the answer is tooling, it is
   not a CI test this round either way.
3. **A2: they may want the dead pre-v27 body retained as a graceful fallback.** Consumability argues
   an operator with a broken client should still see *something*. **Discriminator:** what the
   something says. A retired dashboard rendering empty sections says "engine healthy, nothing
   running" — a false statement. A `<noscript>`/fallback line saying "the dashboard client failed to
   load" is a true one, and costs less markup. I expect this to converge once the claim is framed as
   true-vs-false rather than something-vs-nothing.
4. **A3: they may accept the mixed-tick narrowing without recording the REQ-131 reading**, on the
   grounds that `degraded` is architecture-level detail beneath the requirement. **Discriminator:**
   whether Gate 7.5 validates REQ-131 against the requirement's own text. It does — that is what the
   real tier is for — so the narrowing must be written where a validator will find it.
5. **QD-R2 (coverage denominator):** I expect them to escalate it this round and I am parking it.
   **Discriminator:** whether AC-4's crash counts as evidence that the premise ("nothing decidable
   lives in `ui/`") is already falsified. It probably does — I simply do not think a send-back round
   is where a coverage policy gets rewritten. If they escalate with a concrete, bounded proposal
   (name the files, name the threshold), I will drop my objection.
6. **Where I expect no disagreement:** A4 (a one-line type literal), A5's semicolon count and `%%`
   finding (both are executed results, not opinions — they should be checkable, and if their check
   disagrees with mine, mine is wrong and §5 says exactly how to re-run it), and S2.

---

## 5. Evidence appendix — commands and verbatim results (HEAD eb387a1)

### 5.1 DASH-1: each broken diagram has a second semicolon the parser never reaches

Blocks extracted to scratch, rendered with the repo's own `node_modules/.bin/mmdc` (mermaid 11.17.2)
under a `{"args":["--no-sandbox"]}` puppeteer config:

- `02-architecture.md:2531` as-is → `Parse error on line 9: …flow → owner or new)  S->>C: register(.`
- with `:2539`'s `;` → `·` → **still fails**: `Parse error on line 17:
  …low_versions(mermaid, triggers, params);` (that is `:2547`, which carries two semicolons)
- with both fixed → renders, `blockA3.svg`, 38 452 bytes.
- `02-architecture.md:3561` as-is → `Parse error on line 14: …t is 200 {degraded} + dashboard_api_degr`
- with `:3574`'s `;` → `·` → **still fails**: `Parse error on line 16:
  …m stays on #dag-zoom  B->>S: GET /api/r` (that is `:3576`, the `Note over` line)
- with both fixed → renders, `blockB2.svg`, 31 156 bytes.

### 5.2 DASH-1: mid-line `%%` is message text, not a comment

`grep -o "%%[^<]*" blockB2.svg` on the *rendered* SVG returns, verbatim:

```
%% ONE query, LEFT JOIN run_snapshots, json_extract usage
%% terminal + snapshot has no usage, ≤25 per call
%% never a 500 · a fault is 200 {degraded} + dashboard_api_degraded
%% wire UNCHANGED
```

and the same grep on `blockA3.svg` returns `%% nothing written`, `%% UPDATE … WHERE claimedBy IS NULL
OR claimedBy=name`, `%% BEFORE the read`. Seven annotations, all rendering as visible label text.

### 5.3 AC-2: the server tree needs neither `DOM` nor `allowJs`

```
npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --strict \
        --skipLibCheck --lib ES2022 $(find src -name "*.ts" ! -path "src/sandbox/child-entry.ts")
```
→ **76 files, zero output, exit 0.** (`src/sandbox/child-entry.ts` is excluded exactly as
`tsconfig.json:14` excludes it.) Companion check — DOM globals in server TS:
`grep -rn --include=*.ts -E "\b(document|window|localStorage|HTMLElement|getComputedStyle)\b" src/`
returns only the English word "window" in comments plus one `<script>` inside an HTML string literal
(`src/auth/auth-service.ts:273`). The guard's loss is latent; nothing has exploited it yet.

### 5.4 The 40-block parse check (the S1 control, inline)

Run from the repo root; the script must live where `puppeteer` resolves (I ran it from
`node_modules/.rwe-mmcheck.mjs` and deleted it afterwards — a permanent home would be `scripts/`).

```js
import fs from 'node:fs';
import puppeteer from 'puppeteer';
const blocks = [];
for (const doc of process.argv.slice(2)) {
  const lines = fs.readFileSync(doc, 'utf8').split('\n');
  let inBlock = false, start = 0, buf = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!inBlock && l.trim() === '```mermaid') { inBlock = true; start = i + 2; buf = []; continue; }
    if (inBlock && l.trim() === '```') { blocks.push({ doc, line: start, text: buf.join('\n') }); inBlock = false; continue; }
    if (inBlock) buf.push(l);
  }
}
const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
await page.addScriptTag({ path: 'node_modules/mermaid/dist/mermaid.min.js' });
await page.evaluate(() => window.mermaid.initialize({ startOnLoad: false }));
let bad = 0;
for (const b of blocks) {
  const res = await page.evaluate(async (t) => {
    try { await window.mermaid.parse(t); return 'OK'; }
    catch (e) { return 'FAIL: ' + String(e.message || e).split('\n').slice(0, 3).join(' | '); }
  }, b.text);
  if (res !== 'OK') { bad++; console.log(`${b.doc}:${b.line}  ${res}`); }
}
console.log(`\n${blocks.length} mermaid blocks checked, ${bad} fail to parse.`);
await browser.close();
```

Result over `01-requirements.md`, `02-architecture.md`, `04-design.md` at eb387a1:

```
02-architecture.md:2531  FAIL: Parse error on line 9 …
02-architecture.md:3561  FAIL: Parse error on line 14 …
04-design.md:3306        FAIL: Parse error on line 3 … Promise~{version}~ …

40 mermaid blocks checked, 3 fail to parse.
```

Exactly the review's three (DASH-1 ×2 + DASH-2), no false positives, ~12 s. It also independently
confirms the review's §3 claim that v26's other six `dashboard_check` rows were false positives.

### 5.5 AC-3b is half-repaired

`tests/unit/dashboard-page-source.test.ts:92-96` — the case titled "the C1 page-source pins … survive
the rebuild" still runs `expect(DASHBOARD_HTML).toMatch(/draggable="false"/)`, under a comment
reading 「the markup pin stays on DASHBOARD_HTML」. That pin — `:42-43` at eb387a1, the review's `:38` — was correctly re-pointed to
`clientFile('ui/workflow.js')` by the send-back repair; this duplicate was not. It guards bytes
`src/dashboard/ui/app.js:455` deletes before first paint.

### 5.6 The two induced drifts

- `src/dashboard/lib/connection.js:9-15` + `:24-38` (`worstOf` wired) and
  `tests/unit/dashboard-lib-connection.test.js:30-34` (`{ok, degraded}` → `degraded`) vs.
  `02-architecture.md:3354`'s 「any `ok` → `live` immediately」 and `01-requirements.md:1729`'s
  「任一 `/api/*` 取得成功 → Live」. `grep -n "worstOf" 02-architecture.md` → 0 hits.
- `src/static-assets.ts:33`'s `StaticAssetCache` vs. `02-architecture.md:3346`'s
  `cache: 'immutable' | 'no-store'`.

---

**consistent: no.** Five architecture rows require amendment before the re-review (ADR-049,
ARCH-124 ×2 — the tsconfig note and the connection clause —, ARCH-122, ARCH-123), two of them created
by this round's own repair; DASH-1's prescribed fix closes half the defect and mis-states its cause;
two SHOULD items and seven WON'Ts are named above so round 2 spends its budget on the five.
