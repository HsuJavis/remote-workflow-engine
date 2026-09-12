---
stage: architecture (Gate 2) — v27 Gate 8 SEND-BACK repair round
lens: adversarial group — (a) security, (b) scalability/performance, (c) testability;
      Karpathy simplicity-first as the tie-breaker
round: 2 (debate — written AFTER reading `quality-dimensions.r1.md` in the working tree at eb387a1)
read this round: `quality-dimensions.r1.md` (working tree, NOT the body at `git show eb387a1:…` —
      both r1 files are uncommitted edits at this HEAD; the committed bodies there are the v27b delta)
baseline: HEAD **eb387a1**, unchanged since round 1. Every `file:line` re-opened at this tree.
prior round preserved: this file REPLACES the Sprint A r2 body, which is committed and readable at
      `git show eb387a1:.sdlc/features/001-remote-workflow-engine/.panel/architecture/adversarial.r2.md`.
      My round-1 body for THIS round is `adversarial.r1.md` in the working tree.
method: nine NEW executions this round (E1–E9 in §3), run against a clean `git archive HEAD` copy in
      the scratchpad with `node_modules` symlinked — never against the working tree, per CLAUDE.md.
      One of them refutes a load-bearing claim in QD's O-1; one (E9) refutes a REASON I had drafted for
      my own concession. The concession stands; the reason did not survive its own test and is gone.
---

# Adversarial architecture — round 2: one concession that reverses my own proposal, one rebuttal from a rendered SVG, and one item that needs an owner

## 0. Bottom line in seven lines

1. **AC-2: I concede the mechanism to QD's `tsconfig.server.json` (the inverse program) and withdraw
   my r1 A1(b) entirely.** The two shapes turn out to be equivalent on every property either panel
   measured — including the one I first thought discriminated (**E9**: my narrow-root shape's tests
   program also pulls in all 20 client `.js` files, so no parse coverage is lost either way. I drafted
   that argument, tested it, and it failed; it is not in this file's final position). The concession
   rests on three plain engineering reasons: QD's shape is **purely additive** — it leaves untouched
   the `tsconfig.json` that editors, `tsx`, vitest plugins and any future tool resolve **by name**,
   which my own r1 risk #1 already flagged as my shape's weak point; it is the shape both panels
   measured with `-p` (E4–E6), while the narrow-root form never was; and Karpathy says add eight
   lines, rewrite nothing. **The honest cost of conceding, stated:** a narrow root would have enforced
   the DOM guard **in the editor** as well as in CI. QD's shape gives that up (their QD-R8). Accepted
   — `typecheck`/`build` enforce it and `deploy/rwe-update.sh:147` reverts on it.
2. **AC-2, the reason recorded must be corrected.** QD's ADR text says a tests-only DOM config is
   *「infeasible」*. It is not — my r1's form (narrow root + `tsconfig.tests.json`) is feasible, and E9
   shows it preserves the client parse coverage too; it is merely **worse on the three counts above**.
   Writing a false impossibility into ADR-049 is the defect class this send-back exists to repair, and
   I concede on merits precisely so the ADR can record merits.
3. **NB-1 (`node --check` over `src/dashboard/**/*.js`): rebutted, and dissolved into one sentence.**
   `npm run typecheck` / `npm run build` already parse every client `.js` file today: a planted stray
   token in `ui/app.js` produces `TS1109` and **tsc exit 2** (E2), and `deploy/rwe-update.sh:147`
   reverts the self-update on a failed `npm run build` (E7). QD's premise 「no tier parses `ui/*.js`」
   is true of the *test* tiers and false of the *ship* path. The right repair is zero new mechanism:
   record `allowJs:true`'s parse coverage as a **load-bearing consequence** in ADR-049.
4. **DASH-1: converged on four semicolon sites** (two independent executions, same four lines).
   **I hold on the `%%` half** — QD's authoring rule calls `:3574` a 「trailing `%%` comment」; the
   rendered SVG proves mermaid treats mid-line `%%` as message text, so their replacement produces a
   diagram that parses and still reads as junk. This is the only place we still disagree on a fact.
5. **AC-3a: converged.** I adopt QD's two-layer shape, their pin-disposition table and their
   `TASK-A`/`TASK-B` naming over my `IMPL-nnn` placeholders. Their ED-5 mis-predicted me: I also want
   the fossil deleted, and for the same reason. **ED-2 (the boot watchdog) I dissolve rather than
   fight**: a pre-boot line that names its own failure needs no timer.
6. **A3 (`worstOf` vs. ARCH-124 and REQ-131) and A4 (the `cache` type literal) are uncontested —
   QD's r1 covers neither.** I hold both at MUST. **A3 needs an owner ruling, not a panel consensus**:
   two lenses declining to dispute a REQ-acceptance narrowing is not the same as the owner accepting
   it. (Correction to my own r1: the `cache` literal is at `:3345`, not `:3346`.)
7. **Dispatch: I back QD's v27h micro-dispatch.** TASK-B is 8 lines of JSON + 2 script words and I
   have now verified it green on the tree and **red on three separate planted violations** (E4–E6).
   An amended ADR beside an unchanged `tsconfig.json` is the failure the review pre-named.

---

## 1. Disagreement ledger — rebut / concede / hold

| # | Item | QD's r1 | My r1 | This round |
|---|---|---|---|---|
| D1 | AC-2 guard **mechanism** | `tsconfig.server.json` (inverse program) | narrow root + `tsconfig.tests.json` | **CONCEDE** — theirs; I withdraw mine on additivity (E4–E6 measured; E9 killed my first reason) |
| D2 | AC-2 guard **recorded reason** | 「tests-only DOM config is infeasible」 | — | **REBUT** — feasible but worse; record the real reason |
| D3 | NB-1 `node --check` guard | fold into TASK-A if allowed | not proposed | **REBUT** — already covered by `tsc`; one ADR sentence instead (E2, E7) |
| D4 | DASH-1 semicolon count | four sites | four sites | **CONVERGED** (independent executions agree) |
| D5 | DASH-1 `%%` annotations | 「trailing `%%` comment」, keep them mid-line | message text, move all seven | **HOLD** — rendered-SVG evidence, §2.3 |
| D6 | AC-3a shell contract | two layers + pin table | same shape, less detail | **CONCEDE/adopt theirs** |
| D7 | ED-2 boot watchdog | 6 lines in `theme-init.js` | (predicted: refuse) | **DISSOLVE** — self-describing static text, zero mechanism |
| D8 | ED-5 delete the fossil | yes | yes | **CONVERGED** — their prediction of my position was wrong |
| D9 | ED-4 `:2547` spelling | `→` or `#59;` | any non-`;` | **CONCEDE `→`** — stop bikeshedding, it is verified |
| D10 | ED-6 v27h micro dispatch | dispatch | (silent) | **AGREE** — TASK-B especially |
| D11 | ED-7 DES-200 / TASK-205 | record + route, marker not rewrite | (silent) | **AGREE** — v27b precedent |
| D12 | S1 / NB-3 mermaid oracle | `.sdlc/` tooling, TOOL debt | `.sdlc/` tooling, not a CI test | **CONVERGED** — identical conclusion, independent routes |
| D13 | QD-R2 coverage denominator | not escalated | parked | **PARKED by both** — first candidate for the next full round |
| D14 | A3 `worstOf` / REQ-131 narrowing | not covered | MUST | **HOLD, uncontested — owner ruling owed** |
| D15 | A4 `cache` type literal | not covered | MUST | **HOLD, uncontested** (line is `:3345`) |
| D16 | S2 ARCH-128 single-writer sentence | not covered | SHOULD | **HOLD** — zero cost, closes a re-derived finding |

---

## 2. The three items that moved, argued

### 2.1 D1/D2 — AC-2: I withdraw my own option, and I correct the reason theirs wins

**What I executed (E4–E6).** QD's `tsconfig.server.json`, written verbatim from their r1, run with `-p`
against a clean copy of HEAD:

- clean tree → **exit 0, 76 files in the program, 0 files under `src/dashboard/`** (E4). Their M1 reproduces exactly.
- planted `document.title` / `window.location.href` / `(el: HTMLElement)` in `src/dashboard-page.ts`
  → **exit 2, TS2584 + TS2304 ×2**; the same probe under today's root config → **exit 0** (E5).
- planted `import { worstOf } from './dashboard/lib/connection.js'` in a server `.ts`
  → **exit 2, TS7016**; under the root config → **exit 0** (E6).

E6 is new — neither r1 measured it — and it is the strongest single argument for the inverse program:
it makes 「the server tree is a complete program **without the client tree**」 an enforced property, not
a slogan. A grep guard (my r1's option (a)) sees none of it, and I drop option (a) with it.

**Why I withdraw my r1 A1(b), and the argument I killed on the way.** My first draft of this section
said the narrow-root shape would delete the client parse coverage that E1/E2 establish. **I tested it
and it is false (E9):** my shape's `tsconfig.tests.json` (`allowJs:true`, `include:["src","tests",…]`)
pulls in the same **20** client `.js` files, so both shapes run one wide program that parses the
client and one narrow program that guards the server. E1–E3 therefore describe a property **both**
shapes must preserve — which is why it belongs in TASK-B's DoD (§4.7) rather than in the choice.

What actually decides it is the thing my own r1 risk #1 named: **`tsconfig.json` is resolved by
name** — by editors, by `tsx`, by vitest's type plugins, by anything added later — so the shape that
rewrites it inherits every one of those interactions, and the shape that only adds a file inherits
none. QD's is additive, is the one measured with `-p` end to end (E4–E6), and is eight lines. Mine
rewrites the default config to buy in-editor enforcement of a **latent** risk (E5's probe: nothing in
`src/` references a DOM global today). Karpathy tie-break: add, don't rewrite. Conceded.

**What I refuse to let into ADR-049.** QD's amendment text says 「a tests-only DOM config is
infeasible (tests import `src`; one program)」. That is not why theirs wins. One program per config is
true; it does not make a tests config infeasible — you narrow the ROOT and let the tests config be
the wide one, which is exactly what my r1 proposed and what **E9 shows works** (same 20 client files
in the program, same guard in the narrow one). Theirs wins on additivity, not on feasibility.
An ADR that records a false impossibility invites the next contributor to "discover" it is possible
and re-open a closed decision. **Replacement clause (lift this instead):**

> 「Two shapes were available and **both are feasible** (each runs two programs; each keeps one wide
> program over `src`+`tests` and one narrow program over `src` alone): (i) narrow the ROOT and add a
> wide `tsconfig.tests.json`, or (ii) keep the root as IMPL-229 left it and add the narrow inverse
> program `tsconfig.server.json`. **(ii) is chosen because it is additive** — `tsconfig.json` is the
> config editors, `tsx` and the test tooling resolve by name, and (ii) does not touch it — and because
> it is the shape measured end to end (`-p`, exit 0 on 76 files; red with `TS2584`/`TS2304` on a
> planted DOM global and `TS7016` on a planted `src/dashboard/**` import). **Accepted limit of (ii):**
> editors keep DOM in server files, so the guard is a CI/build property, not an in-editor one.」

**Plus one sentence QD's text is missing and the guard needs (D3's dissolution):**

> 「`allowJs:true` is load-bearing twice: `.js` exports are readable to `.ts` tests, **and** every
> served client file is parse-checked by `npm run build`, which `deploy/rwe-update.sh:147` reverts on.
> `checkJs` stays off — semantic errors in client `.js` are NOT seen (a planted
> `noSuchFunction(undeclaredIdentifier)` compiles clean, exit 0). The gap is semantic, not syntactic.」

Everything else in QD's ADR-049 / ARCH-124 edit I take as written, including amending the **title**
(「no tsconfig change」 is the false part) and the 「unguarded until TASK-B lands」 sentence — that
sentence is the one thing standing between this repair and a repeat finding.

### 2.2 D3 — NB-1 is rebutted, not merely descoped

QD's O-1 argues the ghost page's realistic cause is a stray token in one of seven unit-tierless
`ui/*.js` files, and proposes a `node --check` unit test. **The realistic cause is already caught**
(E2: `TS1109`, exit 2, on the current config) and **cannot ship through the self-update path** (E7:
`revert_and_fail "npm run build failed"`). Their claim is precisely true of the *test* tiers — no
vitest tier parses those files — and that phrasing should survive into the ledger; the operational
conclusion drawn from it should not. Adding a second parser to catch what the first parser catches is
the "control's form without its subject" pattern the retro named, one level up.

**Limits I state so the rebuttal is honest, not triumphant — and measured (E8).** `tsc`'s parse is
not node's: a module that parses but cannot RESOLVE fails in neither. Executed: appending
`import { nope } from './nope-missing.js'` to `src/dashboard/ui/app.js` leaves `npm run typecheck`
at **exit 0, no diagnostic** (`allowJs` without `checkJs` does not report it), and `node --check`
would not catch it either — it is a syntactically valid import. **The only oracle for "the client actually
boots" is the real-Chromium tier (ADR-053), which is conditional on a browser.** That is the true
residual risk behind the ghost page, it is unaffected by either guard, and it is why QD's Layer 2
(an honest pre-boot line) — not NB-1 — is the repair that matters. I support Layer 2 at MUST.

### 2.3 D5 — DASH-1: I hold on `%%`, with the rendered SVG as the discriminator

We converge on the count (four sites: `:2539`, `:2547`, `:3574`, `:3576`) by two independent
executions, which is the strongest form this ledger has. We disagree on one fact inside it.

QD's authoring rule: 「`;` is a statement terminator inside message text, inside `Note` text and
inside a *trailing* `%%` comment; only a `%%` comment on its own line tolerates it」, and their
`:3574` fix keeps `%% never a 500 — a fault is …` on the message line.

**There is no trailing comment.** Mermaid honours `%%` as a comment **only at line start**; mid-line
it is ordinary message text, which is why the `;` breaks the parse in the first place. My r1 §5.2
`grep -o "%%[^<]*"` over the **rendered** SVG returns all four annotations of that diagram as literal
label text — e.g. `%% never a 500 · a fault is 200 {degraded} + dashboard_api_degraded` — and three
more in the v24 diagram. Apply QD's replacement and the diagram parses and then renders
`… %% never a 500 — a fault is …` inside the message box, in a document whose whole purpose this
round is that its diagrams read correctly.

**Prescription (unchanged from r1, now with the discriminator named):** replace the four `;`, and
move all seven `%% …` annotations to their own line as real comments, or promote to `Note over X:`
where the reader needs to see them. **Falsifier either of us can run in 30 seconds:**
`grep -o "%%[^<]*"` on the rendered SVG must return **nothing** after the edit. If it returns
nothing under QD's spelling, I am wrong and I take it.

Their `:2547` `→` spelling I accept over `#59;` (D9): the arrow reads as the transaction's order and
does not park an HTML entity in a diagram that a future editor will "fix".

### 2.4 D6/D7/D8 — AC-3a: adopted, with one simplification that ends the watchdog argument

I adopt QD's Layer 1 / Layer 2 split, their five-row pin-disposition table (it is strictly more
complete than my r1's single surviving pin at `dashboard-page-source.test.ts:95`, which is their
first row), their measured class-lock safety (0/104 `STYLE_HOOKS`, 0/23 `TEST_ANCHORS` shell-only)
as TASK-A's falsifier, and the `empty` hook for the mount element (verified present:
`tests/fixtures/dashboard-classes.ts:28`). My r1's ARCH-122 amendment text and theirs say the same
thing; take theirs, and keep two clauses of mine they did not write: (i) the struck 「still assertable
here」 must be struck **as a sentence**, not softened, and (ii) the `<style>`-is-gone correction
belongs in the same edit as the markup correction, because one sentence carries both false halves.

**ED-2, dissolved rather than won.** QD offers a 6-line `setTimeout(8000)` watchdog in
`theme-init.js` to distinguish 「slow」 from 「dead」; they said they would concede it on request.
I do not need them to: **the distinction is free if the static text makes it itself.**

> `<main><p class="empty">儀表板載入中… 若此訊息持續顯示，表示前端未能載入（請開瀏覽器主控台）<br>
> Loading dashboard… if this message stays, the client failed to load — check the browser console</p>
> <noscript>…</noscript></main>`

No timer, no listener, no new attribute, nothing to leak on a long-lived tab, and — the reason my
testability lens prefers it — it is **assertable in a unit test as one of the shell's own four
facts**, which a timer's behaviour is not. A watchdog is mechanism that exists to tell the operator
something the sentence can just say. If the panel wants the watchdog anyway, it is 6 lines and I will
not block it; I simply do not think it should be written.

I also confirm their ED-5 prediction was wrong: I am not defending the fossil. My r1 called it a
**failure mask** for the same reason their O-1 calls it a ghost — an operator reading 「Running /
Registered / Other」 over empty containers reads 「healthy engine, nothing running」, which is the most
dangerous false statement an operator console can make. Two lenses, one conclusion, no compromise
needed.

### 2.5 D14/D15/D16 — the three items only I raised

Uncontested is not the same as agreed; QD's r1 simply scoped to §8 items 9–11. All three stay MUST/SHOULD:

- **A3 (MUST).** `src/dashboard/lib/connection.js:9-15,:24-38` wires `worstOf`; `02-architecture.md:3354`
  still reads 「any `ok` → `live` immediately」; `grep -c worstOf 02-architecture.md` → **0**. The
  Gate 6 repair is right on the merits (a tag saying 連線中 while the visible table's route is
  degraded is a false statement) and the text must be amended to `worstOf(perRoute)` over the visible
  view's routes. **The part that needs the owner, not the panel:** REQ-131's acceptance
  (`01-requirements.md:1729`) says 「任一 `/api/*` 取得成功 → Live」, and the repair narrows it to
  「visible-view routes ALL ok → Live」. Gate 7.5 validates REQ-131 against the requirement's own
  text. Record the narrowing as one overturnable sentence in ARCH-124 **and raise it to the owner**;
  if the literal reading stands, the Gate 6 repair is what changes, not the prose.
- **A4 (MUST).** `src/static-assets.ts:33` is
  `'public, max-age=31536000, immutable' | 'no-store'`; `02-architecture.md:3345` still types it
  `'immutable' | 'no-store'`. One-line amendment, verbatim text in my r1 §2.A4. Left at MUST because
  the re-review's routing rule is mechanical.
- **S2 (SHOULD).** One sentence in ARCH-128 naming the single-synchronous-writer assumption behind
  「Convergence: in either order the row ends identical」 (`src/store/sqlite-run-store.ts:310`,
  untransacted read-modify-write, safe only because better-sqlite3 is synchronous and the body has
  no `await`; two engine processes on one file break it). Zero code; closes a finding that is
  otherwise re-derived every review.

---

## 3. Evidence appendix — this round's nine executions

All run in `…/scratchpad/tree`, a `git archive HEAD | tar -x` copy with `node_modules` symlinked from
the repo. **Zero writes to the working tree** (CLAUDE.md: no `checkout`, no `stash`, no restore).

| # | Command (abridged) | Result |
|---|---|---|
| E1 | `tsc --noEmit -p tsconfig.json --listFiles \| grep -c src/dashboard/` | **20** — every served client `.js` is in today's root program |
| E2 | append `const broken = = 1;` to `src/dashboard/ui/app.js`, `tsc --noEmit -p tsconfig.json` | `src/dashboard/ui/app.js(467,16): error TS1109: Expression expected.` — **exit 2** |
| E3 | append `noSuchFunction(undeclaredIdentifier);`, same command | **no output, exit 0** — `checkJs` off: the gap is semantic, not syntactic |
| E4 | QD's `tsconfig.server.json` verbatim, `tsc --noEmit -p` on the clean tree | **exit 0**, 76 `src/` files, **0** under `src/dashboard/` (their M1 reproduced) |
| E5 | plant `document.title`, `window.location.href`, `(el: HTMLElement)` in `src/dashboard-page.ts` | server program **exit 2** (`TS2584`, `TS2304` ×2); root program **exit 0** |
| E6 | plant `import { worstOf } from './dashboard/lib/connection.js'` in the same server file | server program **exit 2** (`TS7016`); root program **exit 0** — the client-boundary property, newly measured |
| E7 | `grep -n` `deploy/rwe-update.sh` | `:143 revert_and_fail "npm ci failed"`, **`:147 revert_and_fail "npm run build failed"`** — the syntax guard is on the ship path |
| E8 | append `import { nope } from './nope-missing.js';` to `ui/app.js`, root `tsc` | **exit 0, no diagnostic** — the resolution gap in §2.2, now measured rather than asserted |
| E9 | build my r1 A1(b) shape (narrow root + wide `tsconfig.tests.json`) and `--listFiles \| grep -c src/dashboard/` | **20** — the narrow-root shape parses the client too; **this refutes the reason I had drafted for my own concession** (the concession survives on additivity) |

Re-verified at HEAD in the real tree (read-only): `grep -c worstOf 02-architecture.md` → 0;
`02-architecture.md:3354` still carries 「any `ok` → `live` immediately」; `:3345` still types
`cache: 'immutable' | 'no-store'`; `tests/unit/dashboard-page-source.test.ts:95` still asserts
`expect(DASHBOARD_HTML).toMatch(/draggable="false"/)`; `src/dashboard/ui/app.js:455` is the
`replaceChildren`; `tests/fixtures/dashboard-classes.ts:28` contains `'empty'`;
`src/dashboard/` contains **no `.ts` files** (so QD's `exclude: ["src/dashboard"]` is belt-and-braces
beside `allowJs:false` — keep it, it documents the intent).

---

## 4. Final position — what the synthesizer should lift

**Five ledger rows + four diagram sites + two tasks.** Where QD's r1 has verbatim-ready text, take
theirs; my deltas are named, not re-pasted.

1. **ADR-049** — QD's edit, **minus** the 「tests-only DOM config is infeasible」 clause, **plus** the
   two replacement clauses in §2.1 (both shapes feasible, (ii) chosen for additivity and because it
   is the measured one, with the editor limit stated; and `allowJs:true`
   as a doubly load-bearing consequence with the semantic limit stated). Amend the **title**. Keep
   「unguarded until TASK-B lands」.
2. **ARCH-124 (tsconfig note)** — QD's inverse-program sentence, as written.
3. **ARCH-124 (`api:`, connection clause)** — **mine (r1 §2.A3)**: strike 「any `ok` → `live`
   immediately」, record `worstOf`, record the REQ-131 narrowing as one overturnable sentence.
   Not covered by QD; blocking on a mechanical re-review.
4. **ARCH-122 (`api:` + `note:`)** — QD's Layer 1 / Layer 2 + pin rule, with my two clauses
   (strike 「still assertable here」 outright; correct the CSS half in the same sentence) and the
   self-describing pre-boot line from §2.4 in place of NB-2.
5. **ARCH-123 (`api:`)** — **mine (r1 §2.A4)**, one line, at `:3345`.
6. **`02-architecture.md:2539/2547/3574/3576`** — the four replacements (`·`, `→`, and the two Note/
   message fixes) **plus** the seven `%% …` annotations moved to line start or promoted to
   `Note over`; then `sh .sdlc/trace` to regenerate `dashboard.html`; then the render falsifier
   (`grep -o "%%[^<]*"` on the SVG returns nothing, and all 40 blocks parse — my r1 §5.4 script).
7. **TASK-A** (shell body → mount point + the five pin dispositions + UT-240's new negative) and
   **TASK-B** (`tsconfig.server.json` + `typecheck`/`build`) — QD's names, QD's DoDs, with TASK-B's
   DoD extended by E5 **and E6** (both planted violations must go red, then be reverted) and by
   「`npm run typecheck` still fails on a planted syntax error in `src/dashboard/**/*.js`」 — the
   property TASK-B must not accidentally trade away.
8. **ARCH-128** — S2's single-writer sentence (SHOULD).
9. **Tooling, not tests:** the mermaid render oracle beside `.sdlc/` as TOOL debt (my S1 = their NB-3;
   we agree on both the mechanism and the home). **NB-1 is dropped**, replaced by ADR-049's sentence.
10. **Dispatch v27h** for TASK-A + TASK-B before the re-review. If the orchestrator declines, the
    「unguarded until」 sentences are mandatory and the cost is +2 LOW trace gaps.

---

## 5. Remaining disagreements after this round

1. **D5, `%%` annotations (QD vs. me, a factual disagreement with a cheap falsifier).** They call
   `:3574` a trailing comment; my rendered SVG says it is message text. Settle it by rendering, not
   by reading: `grep -o "%%[^<]*"` on the output SVG. Cost of getting it wrong: two diagrams that
   parse and read as junk, i.e. DASH-1 half-closed for the second consecutive round.
2. **D14, REQ-131's 「任一…成功 → Live」 — needs the OWNER, not the panel.** Both lenses would let the
   `worstOf` narrowing stand; neither of us may amend a requirement's acceptance. Raise it
   explicitly at synthesis. This is the single item I would not let the two panels "agree" their way
   past.
3. **D2, the recorded reason for AC-2.** I expect QD to accept the correction (it strengthens their
   own mechanism), but if the synthesizer takes their text verbatim, ADR-049 ships a false
   impossibility claim and the ADR's own credibility is what pays.
4. **D7, the watchdog.** Not a disagreement about facts — about whether to add 6 lines of mechanism
   for something a sentence can say. I will not block it.
5. **D13, the `ui/*.js` coverage denominator (QD-R2).** Neither lens escalated it this round and both
   of us named it as owed. It should be the first item of the next full round, with AC-4's crash
   cited as the evidence that its premise is already falsified.

---

**consistent: no.** Five architecture rows still require amendment before the re-review (ADR-049,
ARCH-124 ×2, ARCH-122, ARCH-123) and two of them (the connection clause, the `cache` literal) were
created by this round's own Gate 6 repair and are covered by only one lens. Converged this round:
the AC-2 mechanism (I withdrew my own), the AC-3a two-layer shape and pin table, DASH-1's four
semicolon sites, the mermaid oracle's home, and the v27h dispatch. Still open: the `%%` annotations
(falsifiable in 30 s), and REQ-131's acceptance reading (owner ruling owed).
