# Design panel — Adversarial group (interface-contract · boundary/error · testability), round 1

- **stage:** Design (Gate 3/4), acting on the **v27 Gate 8 send-back**. I label this round **v27j** for reference only; the synthesizer coins the real id.
- **round:** 1 — independent proposal, written without reading this round's `quality-dimensions.r1`.
- **scope routed to this gate** (three items, all traceable to a document that already names them):
  1. **DASH-2** — the one design-owned blocking finding, `07-review.md:399` / `:247`, subject `04-design.md:3306`.
  2. **Rider A** — `02-architecture.md:3839` housekeeping (2), *"Owed to design/tasks, recorded not taken"*: DES-200's `draggable="false"` / 「markup and CSS only」 clauses and TASK-205's matching `dod:` went false at the v27g AC-3b repair.
  3. **Rider B** — `02-architecture.md:3835` housekeeping (1): **TASK-A** / **TASK-B** are owed an id and a row, and 「the tasks/design gate is already in this send-back's `send_back` list and is the right place to mint them」.
- **supersedes:** this path held the v27c CSS-ownership round-1 proposal. Preserved in git at `git show 3a1c58d:.sdlc/features/001-remote-workflow-engine/.panel/design/adversarial.r1.md` (never `git checkout` / `git restore` / `git stash` — CLAUDE.md).
- **stale prompt clause, flagged so the synthesizer is not misled:** the dispatch said 「`03-tasks.md` does NOT exist yet」. It does — 240 KB, 1662+ rows, `TASK-205` at `:1747`. Rider B is an *amendment* to a living file, not a first authoring.
- **I did not touch `04-design.md` or `03-tasks.md`.** Round 1 writes only this file.

---

## §0 Altitude judgement — which system, and does my lens read differently?

`state.yaml` `tech_stack`: Node 22.6 / TS strict ESM / vitest / better-sqlite3 / hand-rolled JSON-RPC MCP server / **two `GatewayClient`s driving real LLM sessions** / `node:vm`+`child_process` sandbox / ajv retry-on-mismatch. The *project* is **both** altitudes.

**This round's delta is single-altitude, and it is the conventional-system one.** The three artifacts under design are a Mermaid block in a ledger `.md`, four prose clauses in two ledger `.md`s, and two task rows. No agent reads them, no model is replaced by them, no loop sustains itself on them. Applying an agent-altitude reading here (「replaceability of the model」, 「self-sustainability of the loop」) would be forcing the irrelevant one, and I do not.

**But the *quality* at stake is agent-altitude consumability, one hop out.** The subject of DASH-2 is a document rendered into `dashboard.html` (8.8 MB, 45 `class="mermaid"` blocks) whose sole audience is the next agent or human picking up this ledger. I measured the blast radius rather than assuming it:

```
$ grep -c "Promise~{version}~" dashboard.html   → 2
```

The broken source is embedded **twice** in the shipped dashboard, and `trace.py:697-698` catches the render error per block and paints `圖渲染失敗：<message>` in its place. So the failure is not 「a diagram looks odd」 — it is **two panels of red error text where the v22 catalog decomposition should be**, in the one artifact this SDLC produces for visual consistency review. That is why I rank it blocking rather than cosmetic, and it is the only place the agent altitude enters my reasoning this round.

---

## §1 Summary

DASH-2 is real, reproduced, and closed by a **four-character-class edit with zero meaning change** — but *not* by either of the two routes the review named, and the measurement says why. I ran the control and four candidate fixes through the repo's own renderer (`node_modules/.bin/mmdc`, mermaid 11.17.2, the cached `~/.cache/puppeteer` Chrome, the engine's own `PUPPETEER_CONFIG`), and extracted the rendered `<text>` from each SVG rather than trusting exit codes.

The result overturns the review's first suggestion and disqualifies the obvious escape:

- **Renaming to `Promise~VersionResult~` renders clean but is a contract lie.** No such type exists. Worse, `grep -rn "WorkflowRow" src/` → **0 hits**: the block *already* carries one phantom type name. Fix A would add three more to a block already failing the interface-contract lens.
- **Escaping inside the generic (`Promise~#123;version#125;~`) is content-fragile and fails silently.** It renders correctly for `{version}` and `{removed}` and leaves `Promise~{channel,version,from}~` **raw, tildes and all**, because a comma inside the escape defeats mermaid's generic split. Parses green, renders wrong — precisely the DASH-1-second-half class this ledger has now been bitten by three times.
- **Option C — move the shape out of the generic into the member's trailing text, entity-escaping the braces (`Promise of #123;version#125;`) — is the review's own second route, made render-safe.** It renders all three shapes verbatim, commas intact, with zero `~` and zero `#123;` leaking into the SVG, and it preserves the anonymous-shape semantics exactly. It invents nothing.

Beyond the named finding I found **two things in the same block that no gate has recorded**, both closed in the same edit at no extra risk:

- `class Scheduler { +markFired() +markFailed() }` (`:3328`) parses, but renders as **one** member row `+markFired() +markFailed()`. A one-line split fixes it. Same fidelity class as DASH-1's `%%` literals.
- The v27g AC-3b repair moved **one** of two identical pins. `tests/unit/dashboard-page-source.test.ts:43` (UT-224) now correctly pins `clientFile('ui/workflow.js')`; `:95` (UT-240) still asserts `expect(DASHBOARD_HTML).toMatch(/draggable="false"/)` against bytes `app.js:455` `replaceChildren`s away before first paint. ARCH-122's v27h amendment **already disposes of `:95`** — but only inside TASK-A, which Rider B has not minted. So **four design clauses across three rows are authorizing a live vacuous test whose scheduled removal has no task row to close against**, and Riders A and B turn out to be one repair, not two.

And one finding I deliberately rank **SHOULD, not blocking**, because taking it inside a render-only send-back would widen: the block's `register(name, script, defaults, principal)` is the **retired positional form the running code throws on** (`workflow-catalog.ts:653`). The discriminator the boundary lens demanded settles it — see §4.

---

## §2 key_points

### KP-1 — The measured option table (the deliverable of this proposal)

Control and candidates, all rendered by this panel, not quoted from the review. Reproduce with:

```
cd <scratch>
echo '{"args":["--no-sandbox","--disable-setuid-sandbox","--disable-gpu","--proxy-server=127.0.0.1:9"]}' > pptr.json
sed -n '3306,3400p' 04-design.md | sed '/^```$/,$d' > dash2-control.mmd
node_modules/.bin/mmdc -i dash2-control.mmd -o out.svg -p pptr.json
```
(`-p pptr.json` is **required** — without it `mmdc` dies in `JSON.parse` on `/dev/null` and exits **0**, which is itself a trap for anyone building the oracle in §KP-6.)

| # | Notation | Parses | Renders as | Verdict |
|---|---|---|---|---|
| **Control** | `Promise~{version}~` | ✗ | `Parse error on line 3 … Expecting 'STRUCT_STOP','MEMBER', got 'OPEN_IN_STRUCT'` | the bug, reproduced byte-for-byte as `07-review.md:399` states |
| **A** rename | `Promise~RegisterResult~` | ✓ | `Promise<RegisterResult>` | renders clean; **names three types that do not exist in `src/`** → contract lie, and the block already has one (`WorkflowRow`) |
| **B** escape inside generic | `Promise~#123;version#125;~` | ✓ | `Promise<{version}>` ✓ · `Promise<{removed}>` ✓ · **`Promise~{channel,version,from}~` RAW** ✗ | **rejected** — comma-fragile, degrades silently, parse-green/render-red |
| **C** escape in trailing text | `Promise of #123;version#125;` | ✓ | `Promise of {version}` · `Promise of {channel, version, from}` · `Promise of {removed}` — all three, commas intact | **RECOMMENDED** |
| D | bare `{` anywhere in a member (not only in a generic) | ✗ | same `OPEN_IN_STRUCT` | corrects the review's framing: it is not the *generic*, it is `{` in a **member** |

Root cause isolated to a single discriminator, measured on a minimal probe — commas alone are fine (`Promise~A,B~` → `Promise<A,B>` ✓), entities alone are fine (`Promise~#123;version#125;~` ✓); **entity + comma together** is what breaks (mermaid splits the generic before decoding the entity). That precision is what disqualifies B, and it is why I would not accept 「just escape the braces」 as the synthesis instruction.

### KP-2 — The exact edit, and its falsifier run on the edit itself

Four lines change in the block at `04-design.md:3307-3335`:

```
-        +register(name, script, defaults, principal) Promise~{version}~
+        +register(name, script, defaults, principal) Promise of #123;version#125;
-        +publish(name, version, channel, principal) Promise~{channel,version,from}~
+        +publish(name, version, channel, principal) Promise of #123;channel, version, from#125;
-        +deregister(name, principal) Promise~{removed}~
+        +deregister(name, principal) Promise of #123;removed#125;
-    class Scheduler { +markFired() +markFailed() }
+    class Scheduler {
+        +markFired()
+        +markFailed()
+    }
```

Rendered-text extraction from the resulting SVG (every member, verbatim):

```
+register(name, script, defaults, principal) : Promise of {version}
+publish(name, version, channel, principal) : Promise of {channel, version, from}
+resolve(name, sel) : Promise<VersionEntry>
+resolveDetail(name, sel) : Promise<WorkflowDetail>
+exists(name) : Promise<boolean>
+listVersions(name) : Promise<string[]>
+list() : Promise<WorkflowRow[]>
+deregister(name, principal) : Promise of {removed}
Scheduler → +markFired()   (row 1)
           +markFailed()   (row 2)
tilde-generics left in SVG: 0    raw-entity left in SVG: 0
```

Every untouched member (`string[]`, `WorkflowRow[]`, the three `«pure fn»` stereotypes, all seven edges and their labels) survives byte-identical. **The falsifier is the render, not a lint** — that is the authoring rule `02-architecture.md:3826` recorded for DASH-1, and this round obeys it.

### KP-3 — `Scheduler`'s collapsed row: a second fidelity defect, free to fix here

`class Scheduler { +markFired() +markFailed() }` parses, so no checker sees it; it renders as a single row. Two methods become one. It is the same *parse-green/render-wrong* class as DASH-1's `%%`, it lives in the block we are already opening, and the fix is a line split with no semantic content. Taking it is cheaper than filing it. **Not** a licence to sweep the other 44 blocks this round — see §KP-6 for where that belongs.

### KP-4 — Rider A's clause edit is what authorizes a disposition TASK-A already carries — and TASK-A does not exist yet

`02-architecture.md:3839` recorded this as 「owed, recorded not taken」, and after measuring it I **accept that ranking** rather than raising it. What the measurement adds is not severity, it is **coupling**: the design clause edit and Rider B's TASK-A are two halves of one repair, and neither is complete alone. Current tree:

| Where | State |
|---|---|
| `src/dashboard-page.ts:128` | still emits `<img id="diagram-img" alt="workflow diagram" draggable="false">` |
| `src/dashboard/ui/app.js:455` | `document.body.replaceChildren(nav, routeMount, buildFooter())` — the emitted body is discarded before first paint (the site ARCH-122's v27h amendment names). Three `replaceChildren` calls exist (`:404`, `:423`, `:455`); only `:455` is body-level, and it is the one that kills the `<img>`. **IMPL-270 cites `app.js:427` — stale by 28 lines against today's tree**, worth correcting when the entry is next touched |
| `src/dashboard/ui/workflow.js:154` | `img.draggable = false;` — the real, live behaviour |
| `tests/…/dashboard-page-source.test.ts:43` (**UT-224**) | ✅ genuinely re-pointed at v27g: `clientFile('ui/workflow.js')` matched against `img.id = 'diagram-img'` … `img.draggable = false` |
| `tests/…/dashboard-page-source.test.ts:95` (**UT-240**, 「the C1 page-source pins … survive the rebuild」) | ❌ **still live:** `expect(DASHBOARD_HTML).toMatch(/draggable="false"/)` — dead bytes |

**Attribution, checked rather than assumed** (`awk 'NR<=6856 && /^### DES-/' 04-design.md | tail -1`) — the four clauses belong to **three** rows, not one:

- `04-design.md:6791` — **DES-200** signature 「markup and CSS only」
- `04-design.md:6792` — **DES-200** boundary 「`draggable="false"` is markup and stays on `DASHBOARD_HTML`」
- `04-design.md:6856` — **DES-208** (*「`clientCorpus()`: re-point every source-grep, and make a vacuous green impossible」*), whose **STAYS** bucket lists `draggable="false"` as assertable against `DASHBOARD_HTML`
- `03-tasks.md:1752` — **TASK-205** `dod:` repeats DES-200's sentence

Two corrections to what I first wrote, both from reading rather than inferring:

1. **The v27g repair did not merely "add".** IMPL-270 (`06-impl-log.md:6329`) genuinely **moved** UT-224's pin and falsified it by reverting to the old regex to watch it pass vacuously. `:95` is a **second, independent occurrence** of the same regex in the same file, belonging to **UT-240**'s case — untouched at v27g and **unmentioned** in IMPL-270. Left in place, unrecorded; not a repair that stopped halfway.
2. **`:95` is already disposed of — by a task that has not been minted.** ARCH-122's v27h amendment (`02-architecture.md:3343`) enumerates TASK-A's dispositions and names this one outright: 「dispose of the five now-dead page-source pins, each verified at `eb387a1` — `dashboard-page-source.test.ts` **UT-240's `draggable` case RETIRES**」. So proposing 「delete `:95` in the design clause commit」 would **double-assign one line to two owners**. I withdraw that.

**Revised proposal — the clause edit removes the *authority*, TASK-A removes the *line*:** move `draggable="false"` from DES-208's **STAYS** bucket to its **MOVES** bucket; re-word DES-200's signature line to ARCH-122's v27h shape (`<head>` + island + asset refs + one mount element) and strike its 「stays on `DASHBOARD_HTML`」 sentence; amend TASK-205's `dod:` to match. Each edit carries a dated marker naming the v27g AC-3b re-point as the cause — note that, unlike DES-111, **DES-200 carries no prior amendment marker**, so this introduces the convention to that row rather than following it there. None of the three edits touches a test.

**The coupling, which is the actual finding:** until Rider B mints TASK-A, UT-240's retirement lives only inside an ARCH amendment paragraph with **no TASK row for an IMPL to close against** — the precise gap `02-architecture.md:3835` opens with (「the ledger's chain needs a TASK for an IMPL to close against」). So Rider A and Rider B are **not** independent items to be taken or dropped separately: taking A alone leaves a design clause that forbids a test the tree still runs, with nothing scheduled to remove it. My ordering recommendation to the synthesizer: **mint TASK-A first, then edit the clauses in the same batch**, so the disposition and its authority land together. DES-208's own sentence is what makes this non-optional — 「the dangerous half is not the reds — it is the **greens**」 — and `:95` is green today.

### KP-5 — Rider B: mint TASK-A and TASK-B as **two** rows, with **no** DES rows

**Two, not one.** They share nothing a task boundary cares about: different files, different oracles, different failure modes.

| | TASK-A | TASK-B |
|---|---|---|
| traces | ARCH-122 (v27h amendment, `02-architecture.md:3343`) | ADR-049 (v27h amendment, `:3444`) |
| files | `src/dashboard-page.ts`, `tests/unit/dashboard-page-source.test.ts` | `tsconfig.server.json` (new), `package.json` (`typecheck`/`build` strings), a new pinning UT |
| oracle | UT-240's new positive + the five pin dispositions | both programs exit 0; planted-violation falsifiers go red |
| DoD source | **already written verbatim** in the ARCH amendment | **already written verbatim** in the ADR amendment |

**No DES rows for either, and the precedent is named, not asserted.** `grep -n "TASK-018\|TASK-153" 04-design.md` returns six hits, none of them a `### DES-` row — both are prose mentions only, and `04-design.md:6684` states outright 「The remaining 3 gaps are not drift: TASK-018 / TASK-153 (task with no implementation)」. A TASK may trace straight to ARCH/ADR with no DES and settle as a LOW `未實作` trace row. Minting two DES rows here would transcribe a DoD that is already verbatim in two places into a third — pure duplication, and the Karpathy tie-break refuses it.

**Coupling to Rider A (see §KP-4):** TASK-A is not optional bookkeeping — it is the only home for UT-240's `draggable` retirement, which Rider A's clause edit otherwise forbids with nothing scheduled to act on it. If exactly one row is minted this round, mint **TASK-A**.

**Where task-splitting affects my lens, stated because the dispatch asked:** TASK-B is the only row in this round that can go **red in another task's commit**. It rewrites `package.json`'s `typecheck`/`build` to run two programs; anything landing between the ADR amendment and TASK-B sees ARCH-124's 「UNGUARDED until TASK-B lands」 sentence as the only thing keeping the ledger honest — and that sentence is **already in the tree** (`:3444`), which is what makes deferral safe. TASK-A carries no such window: its pin dispositions and UT-240's positive land together. So if the orchestrator takes only one, take **TASK-A**; if it takes neither, the recorded cost is exactly what `02-architecture.md:3836` already priced — **+2 LOW `未實作` trace rows**, with both 「has NOT landed / UNGUARDED until」 sentences standing.

### KP-6 — Testability: the oracle this round owes, and honestly what it costs

The class has now bitten **three times** (v26 mis-recorded `:2531` as a checker false positive; v27 shipped `:3561` broken; DASH-2 is the third), across 45 rendered blocks, with **no automated check anywhere**. `.sdlc/trace.py` has `DIAGRAM_RE` at `:301` and embeds every block into the dashboard — but it has **no JSON/dump mode** (`argparse` at `:956-962` exposes only `sdlc_dir`, `-o`, `--check`, `--impact`, `--features`), so the honest claim is **not** 「reuse trace.py's output」. It is: *the extraction regex is one line; the script is ~30 lines around `mmdc`.*

Proposed shape (existence is **not** mine to propose — `02-architecture.md:3841` housekeeping (3) already recorded it as a follow-up; I am proposing its **shape** and correcting one assumption in it):

- **not** in `tests/` — both lenses in the v27h round already agreed 「a `.md` file is not the product」 (`:3827`), and I concur without reservation. **One placement inconsistency to settle, not to inherit:** `:3827` says 「beside the `.sdlc/` tooling」 while `:3841` names `scripts/mermaid-parse-check.mjs` — `scripts/` is a product dir (`bench-run-list.ts`, `gen-authoring-md.ts`, `smoke.sh`), `.sdlc/` is the ledger's. The subject is a ledger `.md`, so I propose `.sdlc/`; either is defensible, but the synthesis should pick one rather than carry both;
- **rename it.** `mermaid-parse-check.mjs` bakes the wrong oracle into the filename — §KP-1 measured that option B **parses** and still renders a raw member. `mermaid-render-check.mjs`;
- `mermaid` + Chrome from `node_modules` / `~/.cache/puppeteer`, **`-p` puppeteer config mandatory** (see §KP-1: omitting it exits 0 on a crash — an oracle with this bug is worse than none);
- **the assertion is the render, then the SVG text** — parse-only would have passed option B and shipped the raw-tilde row;
- **loud skip** when no browser is present, never a silent pass;
- run after any ledger diagram edit and before Gate 8's render check.

### KP-7 — Karpathy check on my own proposal

Four member lines and one class-body split for DASH-2. Four prose clauses re-pointed and one test line deleted for Rider A. Two task rows transcribed from DoDs that already exist verbatim, with **zero** new DES ids for Rider B. One ~30-line script whose existence was already decided. **No** new module, **no** new parser, **no** projection layer, **no** vitest test over a `.md` file, **no** type minted in `src/` to satisfy a diagram. Where two candidates delivered equal value (A vs C), the one that invents nothing won.

---

## §3 The two internal conflicts between my own lenses (named, then decided)

**Conflict 1 — interface-contract vs boundary/error, on the stale signature.**

*Contract lens:* the block publishes `+register(name, script, defaults, principal)`. The running code is `register(req: {name, script, mermaid, triggers?, principal?})` and `workflow-catalog.ts:653` **throws by name** on the positional form: 「the pre-v24 positional (name, script, defaults, principal) shape is retired (ADR-035)」. `deregister` returns `{removed, claimedTriggers}`, the diagram says `{removed}`. A published contract the implementation refuses is the single worst thing this lens can find. Rewrite the members.

*Boundary lens:* `## v22 —` is a dated slice. Rewriting a v22 member to the v24 shape destroys the record of what v22 decided, and 「the tree is the truth」 does not license retconning a slice.

**The discriminator, measured, not argued:** does the diagram disagree with its own neighbours, or with the tree? `04-design.md:3399` — **DES-111, twelve lines below the diagram, carries the identical stale shape**: `register(name, script, defaults?, principal?)` annotated `// signature unchanged`, and `deregister(...): Promise<{ removed: boolean }>`. The diagram is **consistent with its own slice** and the pair is stale together.

**Decision — boundary wins, with a cost the contract lens is paid in full:** DASH-2's edit stays **render-only, zero meaning change**. The staleness is a **separate SHOULD-ranked finding spanning the diagram *and* DES-111's signature block**, and if taken it must touch **both together or neither** — repairing the member alone would make the diagram contradict the DES row twelve lines below it, converting one honest staleness into a fresh inconsistency. My recommendation: take it as **one dated amendment marker on DES-111** (the row already carries two: a v26 amendment and a v27b `superseded_in_part`) naming the ADR-035 retirement, leaving both member texts alone. If the synthesis judges even that as widening past a render-only send-back, I do not contest it — but it must then be **recorded**, because `07-review.md:247` will otherwise read the next reviewer straight past it a second time.

**Conflict 2 — testability vs simplicity, on whether an oracle is owed this round.**

*Testability lens:* three recurrences, 45 blocks, zero checks, and this round's own fix is unverifiable by any committed artifact. Without the oracle the synthesis's 「it renders now」 is a claim, not a property.

*Simplicity lens:* a `.md` file is not the product; a doc-lint is exactly the ceremony this project's Karpathy discipline exists to refuse; and the existing `dashboard_check` already emits `0 high / 7 mid / 1 low` that nobody acts on.

**Decision — testability wins narrowly, and only because the decision was already made.** `02-architecture.md:3841` recorded the script as a follow-up in the v27h synthesis. Re-litigating a recorded decision costs more than the 30 lines. So I propose **shape, not existence** — and I hold one simplicity line hard: it goes beside `.sdlc/`, never into `tests/`, and it is **never** a Gate 6 blocker.

---

## §4 risks

| # | Risk | Severity | Evidence / owner |
|---|---|---|---|
| R-1 | **Two-environment skew makes the oracle green while the dashboard is red.** `trace.py:623` loads `mermaid@11` from `cdn.jsdelivr.net` — a **floating** major — and initialises it `theme:'dark'`, `securityLevel:'loose'` (`:687`); my measurements ran 11.17.2 from `node_modules` under mermaid's default `securityLevel:'strict'`. Entity decoding is core and should not differ across either axis, but 「should not」 is what DASH-1 already cost this ledger twice. | **MID** | `trace.py:623`/`:687` vs `node_modules/mermaid@11.17.2`. **Discharge check for the synthesis:** regenerate `dashboard.html` and open the v22 block in Chromium, asserting no `圖渲染失敗` — on a `git archive HEAD \| tar -x -C <scratch>` copy, **never in place** (CLAUDE.md). Pinning the CDN would close it properly, but `trace.py` is the **vendored fork** (§9 `TOOL-FORK`), owned by the tooling/plugin side, **not** by this gate: record with the owner named, do not edit it here. |
| R-2 | Option C changes `Promise~X~` to prose, so the three members stop being machine-readable as generics. | LOW | Accepted deliberately: they were never valid generics (they did not parse), and the five real generics in the block keep `~…~`. The alternative (A) buys machine-readability with a phantom type. |
| R-3 | Rider A's clause edit lands **without** TASK-A, leaving DES-208 forbidding a pin the tree still runs — the same contradiction-in-the-other-direction the send-back exists to close. | **MID** | This is why §KP-4 recommends minting TASK-A **first**, in the same batch. If the orchestrator declines TASK-A, the clause edits must carry an explicit 「pending TASK-A」 sentence rather than silently disagreeing with the tree — the shape ARCH-124's 「UNGUARDED until TASK-B lands」 already uses. |
| R-4 | The SHOULD-ranked staleness (§3 conflict 1) is deferred and forgotten a **second** time — `07-review.md:247` already read past it once. | MID | Mitigated only by recording it explicitly in the synthesis, whichever way it is decided. Silence is the failure mode here, not the deferral. |
| R-5 | `mmdc` without `-p` **exits 0 on a crash** (`JSON.parse` of `/dev/null`). An oracle built naively is a silent always-pass. | MID | Measured in §KP-1. Names the single most important line of §KP-6's script. |
| R-6 | The render sweep found **8 literal `%%` strings** in three other `02-architecture.md` blocks (v15/v21/v26 slices). They parse, so they are fidelity defects of DASH-1's second-half class. | LOW | `02-architecture.md:3845` already names them for the next touch. **Out of this round's scope** — naming them here is not taking them. |
| R-7 | Rider B's TASK-B is deferred and the `tsconfig` property stays unguarded. | LOW | Already priced at `02-architecture.md:3836` (+2 LOW `未實作` rows) and already disclosed in-tree by ARCH-124's 「UNGUARDED until TASK-B lands」. Honest, therefore debt. |

---

## §5 expected disagreements

**With the quality-dimensions lens:**

- *「Rider A's clauses are documentation drift — MID at most, not worth a blocking slot.」* I **accept the MID ranking** and contest the 「documentation」 half. `tests/…:95` is a **live green assertion over bytes deleted before first paint**; documentation drift does not keep CI green while a guard stops guarding. The part I will hold hard in round 2 is the **coupling**, not the severity: taking Rider A's clause edit without minting TASK-A produces a design row that forbids a test nothing is scheduled to remove — strictly worse than leaving both.
- *「The mermaid oracle should also gate `dashboard_check`'s 7 MIDs / assert no `%%` survives in any block.」* I will resist the widening and concede the direction. `02-architecture.md:3846` measured `dashboard_check` as byte-identical before and after the DASH-1 fix — the lexical heuristic is 「neither a proof nor a disproof of rendering」. Coupling the new oracle to it imports a known-noisy signal into a check whose whole value is that it is exact. One property, one script.
- *「Consumability says the diagram should carry the *current* signature; a reader does not care which slice it was written in.」* §3 conflict 1 is my whole answer, and the discriminator is DES-111's own stale line twelve rows below. I would rather be honestly out of date in two places than freshly inconsistent between them.

**With whichever lens holds simplicity hardest:**

- *「You measured five candidates for a bug the review already told you how to fix.」* The measurement **overturned** the review's first suggestion (fix A names three non-existent types) and **disqualified** the obvious escape (fix B renders one member raw). Neither was visible without rendering. The cost was four `mmdc` invocations.
- *「Splitting `Scheduler` is scope creep.」* It is one line, inside a block already being opened, closing a defect of the class this round exists to close. Filing it costs more than fixing it.
- *「Two task rows for two follow-ups is ceremony — fold them into one.」* Different files, different oracles, and **only TASK-B carries a red window**. One row would force both through one commit and destroy the orchestrator's option to take TASK-A alone. That optionality is the reason to split, not tidiness.

**Where I expect agreement, and would be surprised to be challenged:** that DASH-2 is real and blocking; that the fix must be verified by a **render**, never a parse or a bracket count; that TASK-A/TASK-B need **no** DES rows (TASK-018/TASK-153 is the named precedent, not an analogy); that the oracle belongs beside `.sdlc/` and never in `tests/`; and that R-1's CDN skew is real but **not this gate's to fix**.
