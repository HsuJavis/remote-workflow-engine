---
stage: design
lens: quality-dimensions
iteration: v27 — Round v27b delta (scoped run: gates architecture+design+tests, impactIds REQ-133 / REQ-134 / REQ-140)
round: 1 (independent proposal — design altitude for the v27b amendment pass)
builds_on: .panel/architecture/quality-dimensions.r2.md (my converged architecture stance for this delta; everything it settled is CITED here, not re-argued). The Sprint A design r1 this file overwrites stands unchanged for the rest of the closure at `git show 07266be:.sdlc/features/001-remote-workflow-engine/.panel/design/quality-dimensions.r1.md` — except its C-4, which is withdrawn below by its author.
verified_this_round (file:line, all re-read at the working tree): src/server.ts :331-334, :350, :402, :490-552 (resolve chain :497-508, `if (!authEnabled)` :520, catch :540-542, layoutGraph :544, payload :546-551), :563, :582-585, :819, :1064-1071, :440; src/run-manager.ts :893-909; src/types.ts :6-9 (StartedBy), :345, :351, :363; src/run-view.ts :11-14; src/mcp-facade.ts :590; src/workflow-catalog.ts :228-231 (workflow_versions.createdAt), :583, :604-626 (version = v<max+1> over the name's OWN rows), :709-715; src/dashboard.ts :325-345, :390-445; src/dashboard-page.ts :601-607; tests/integration/dag-masking-auth.test.ts (whole); tests/unit/dashboard-derive-lanes.test.ts (whole); tests/integration/dashboard-http.test.ts :139-152, :205-222, :222-276; tests/integration/dashboard-disclosure.test.ts :1-50; tests/fixtures/dashboard-wire.ts :71-113; tests/helpers/workflow-fixtures.ts :133-143, :286-310; 01-requirements.md :1655-1690, :1730-1770, :1857-1866, :1070; 02-architecture.md ARCH-125 :3359, ARCH-126 :3370, ARCH-130 :3407, ARCH-131 :3417, ADR-051 :3441, ADR-054 :3462, ADR-055 :3470, INV-V27-9 :3657, Decision rationale v27b :3675-3763; 04-design.md DES-196 :6745, DES-197 :6753, DES-198 :6761, DES-201 :6785, DES-206 :6825, real-tier table :6849-6866, mock policy :6867-6871, Decision rationale v27 point 11; 03-tasks.md TASK-197/201/202/203/206/209/210 :1690-1780; 05-tests.md UT-238 :11772, UT-244 :11887, IT-168 :11797, IT-169 :11812, IT-092 :6324, VAL-199 :12004, VAL-204 :12067; README.md :312-313, :368-375
---
# Quality-dimensions — v27b DESIGN r1: one fixture locks the warning vocabulary, one cohort transition is written down, one of my own rows is withdrawn

## summary

**What this stage is.** The dispatch text says 03-tasks.md does not exist; it does (TASK-196..213), and so does
04-design.md (DES-191..208). The design half of the v27b delta is therefore an **amendment pass over rows that
already exist** — DES-196, DES-197, DES-198, DES-206 (and one line of DES-201), TASK-201/202/203/206/210 `dod:`
lines, TASK-197's fixture, UT-238, IT-168, IT-169, IT-092, VAL-199, VAL-204 — exactly the list the architect
left at the end of `Decision rationale — v27b` (02-architecture.md:3675). Zero new DES ids, zero new modules,
zero new wire fields, zero `owner_decision`s: the owner already ruled (01-requirements.md:1655-1690).

**What the architecture settled and this proposal does not reopen** (cite, don't re-litigate): delete the axis
rather than default it (`if (!authEnabled)`, `McpFacadeDeps.maskPredictedOverlay`, `deriveLanes`'s `masked`,
`handleDashboardRequest`'s `authEnabled` + `!!authCfg`); `TOKEN: detail` warnings pushed at the route, never in
`layoutGraph`; the observed-wins join rule with NO title-conflict detector; the version resolution reading
`legacySubstitution.resolved`; parity in EXCLUSION form plus one positive anchor (INV-V27-9); the key-set budget
rule; the sweep boundary; a bounded pre-approved memo after a measured p95.

**What is left for the design altitude — my contribution, one item per dimension:**

1. **Observability — the warning vocabulary needs a LOCK, and the only legal place for it is the fixture.**
   Under the v27 mock policy a `.js` client test may import only `src/dashboard/{lib,ui}/*.js` plus the `.ts`
   fixture, and a `.test.ts` cannot import a `.js` client module (TS7016, ADR-049). So "the route emits this
   prefix" and "the client maps this prefix" share exactly one surface: `tests/fixtures/dashboard-wire.ts`.
   The DAG literal must carry example warnings (one FALLBACK, one UNAVAILABLE, one existing `layoutGraph`
   prose line) that IT-169 asserts as prefixes on the wire and UT-244 maps through the string table. And the
   `detail` grammar has to be fixed NOW — space-separated `key=value`, a closed reason enum — or `ui/run.js`
   cannot extract `resolved` for 「預測結構來自替代版本 vN」 (§1 O-1, O-2).
2. **Replaceability — withdraw C-4.** 04-design.md's `Decision rationale — v27` point 11 credits this lens for
   the fail-closed `maskPredictedOverlay` dep. It is withdrawn by its author: after the ruling its fail-closed
   default fails closed to the behaviour the owner refused, silently and only under auth. DES-197's UT line
   ("a facade constructed with no `maskPredictedOverlay` omits `agents`") is DELETED, not amended (§2 R-1).
3. **Consumability — the FALLBACK cohort has a transition the contract must state.** `legacySubstitution` is
   written only on RESUME (`run-manager.ts:903-909`), so a run whose pin was purged carries the
   `PREDICTED_FROM_FALLBACK_VERSION` warning before a resume and none after (the route's arm (i) then reads
   the recorded `resolved` and resolves cleanly). That is what makes "the DAG warning is the authority for
   this read" load-bearing rather than decorative — and it is why no test may assert the warning persists
   (§3 C-2).
4. **Self-sustainability — an honest limit on what the new witness can see.** `register()` mints
   `v<max+1>` over the name's OWN rows (`workflow-catalog.ts:583, :621`), so deregister → re-register restarts
   the lineage at `v1`, and a run pinned to the OLD `v1` resolves the NEW `v1` with no throw, no warning and
   a wrong overlay. The FALLBACK arm witnesses an ABSENT pin, never a REUSED one. Out of closure to fix (it is
   DES-113's resume path too), but the design row must say it, and the one-comparison v28 check is named
   (`workflow_versions.createdAt > view.createdAt`) so it is not rediscovered as a Gate 7.5 surprise (§4 S-4).

## Altitude call

Both altitudes exist in this project — an HTTP/MCP server (system) that dispatches LLM agents (agent). This
delta is **predominantly system-altitude**: what an anonymous `GET /api/runs/:id/dag` and a `workflow_describe`
serialize, on every deployment. The **agent-altitude** reading is the owner's reason for ranking it: the run
page is the only surface that joins an agent workflow's *plan* (the predicted lanes and slots) to its
*progress* (the observed phases and live records), and after this delta it is also the surface where "the
plan shown is not the plan that ran" is stated. Memory metabolism, tool-liveness probing and prompt
calibration have **no seam in this closure**; each dimension below says so in one line rather than padding.

---

## 0. Withdrawn and converged — stated once so the synthesizer does not re-derive it

| # | Item | Status | Where |
|---|---|---|---|
| W-1 | **C-4 (fail-closed `maskPredictedOverlay`) — withdrawn by its author.** The dep was specified at Gate 4, credited to this lens (rationale v27 #11), and never implemented (`grep -rn maskPredictedOverlay src tests` → 0 hits). Deleting design text, not code. | withdrawn | DES-197 signature + boundary paragraph; TASK-202 `dod:` first clause |
| W-2 | The fail-closed reasoning survives in ONE place only: a seam whose only correct value is constant is an unexercised branch that decays — that sentence is already in ADR-051 and ARCH-126; the DES rows cite it, they do not restate it. | converged | ADR-051 :3441, ARCH-126 :3370 |
| W-3 | `deriveLanes(phases, expected \| undefined, { status })` — UT-238's cast (`dashboard-derive-lanes.test.ts:33-35`) is reconciled here, not at Gate 6. | converged | DES-196 |
| W-4 | The four deletions in `server.ts` (`:520` branch, `:334` param with its `= false` default, `:1068` argument, comments `:331-334`/`:350`/`:1064`); the comment at `:819` is about ARCH-088's peer shapes and STAYS. | converged | DES-198, TASK-203 `dod:` |
| W-5 | Three-member vocabulary, pushed at the route (`warnings: [...layout.warnings, ...routeWarnings]`); the v1 re-derive and the inline-script path stay silent; grandfather `warnings: []` pins untouched. | converged | DES-198 (2) |
| W-6 | Parity (exclusion form) + one positive anchor on the auth server + `SCRIPT_PHASED`; `startedBy: { type: 'client' }` carries no `id` (`mcp-facade.ts:590`, `types.ts:6-9`), so parity is safe on it. | converged | IT-168 |
| W-7 | REQ-105's `[PARTIALLY SUPERSEDED v27b]` marker at `01-requirements.md:1070` — orchestrator housekeeping, named twice already; not headlined here. | recorded | — |

---

## 1. Observability

**The design question: when the route serves the overlay from another version, or cannot serve it at all,
is that fact (a) on the payload in a form the rebuilt client can render in two languages, (b) in the
journal in a form an operator can correlate with the payload, and (c) locked by a test that cannot drift
between the server that emits it and the client that reads it.**

### System altitude

**O-1 — The token lock lives in the fixture, because nothing else may be shared.** The constraints, each
verified rather than assumed: a `.js` test imports only `src/dashboard/{lib,ui}/*.js` and the `.ts` fixture
(mock policy v27, 04-design.md:6869); a `.test.ts` importing a `.js` client module fails `tsc` with TS7016
absent `allowJs`, which ADR-049 refuses; `tests/fixtures/dashboard-wire.ts` is `.ts`, `satisfies`-checked, and
already the one literal both tiers read (DES-192). So the lock is:

- `dashboard-wire.ts`: the DAG literal gains a populated `warnings` — exactly three strings:
  `'PREDICTED_FROM_FALLBACK_VERSION: pinned=v3 resolved=v2'` (`resolved` LOWER than `pinned` — the only ordering deregister/re-register can produce, S-4),
  `'PREDICTED_OVERLAY_UNAVAILABLE: catalog-resolve-failed'`, and one existing `layoutGraph` prose line
  verbatim (`'lane 2 (review) is dynamic: agents cannot be statically slotted'`, `dashboard.ts:393`). Plus
  `export const DAG_WARNING_TOKENS = ['PREDICTED_FROM_FALLBACK_VERSION', 'PREDICTED_OVERLAY_UNAVAILABLE'] as const`.
  `warnings` is already in `ALLOWED_DAG_KEYS` (`:88`) — no key-set shape change; only the rename in O-5.
- Server side (`.ts`): `dashboard.ts` — allowlisted, pure — exports the same two tokens as a `const` object
  and one formatter `dagWarning(token, detail: Record<string, string>) → string` producing
  `TOKEN: k=v k=v` in key order given. IT-169 asserts (i) `dagWarning(...)` over the fixture's inputs equals
  the fixture's literal byte-for-byte, and (ii) the wire `warnings[]` from the real producers (O-3) `startsWith`
  the fixture's prefixes. The route imports the formatter; it never spells a token as a string literal
  (`grep -c PREDICTED_ src/server.ts` → 0 is the cheap guard, and it is what keeps the vocabulary in one file).
- Client side (`.js`): `lib/strings.js` — the string-table module DES-201 already owns — gains
  `parseDagWarning(w) → { token: string | null; detail: Record<string, string>; raw: string }` and
  `warningText(w, lang) → string`. UT-244 (`dashboard-lib-strings.test.js`) maps each fixture literal:
  FALLBACK → 「預測結構來自替代版本 v2」/`predicted layout from substitute version v2`; UNAVAILABLE →
  「預測結構不可用」/`predicted layout unavailable`; the prose line → its RAW string, unchanged.

Two mirror halves (format ↔ parse) and one literal both read — the same "one fixture, two readers" pattern
DES-192 already uses for key sets. Without this the token is a string in `server.ts`, a different string in
`strings.js`, and the day one is edited the legend row silently shows an English enum to a zh-TW viewer.

**O-2 — Fix the `detail` grammar now, not at Gate 6.** `TOKEN: detail` is settled; what is open is what
`detail` may contain, and the client cannot be written until it is closed:

| Token | `detail` grammar | Closed set |
|---|---|---|
| `PREDICTED_FROM_FALLBACK_VERSION` | `pinned=<version> resolved=<version>` — two `key=value` pairs, space-separated, this order | keys `{pinned, resolved}`; values match `/^v\d+$/` (the catalog's own shape, `workflow-catalog.ts:621`) |
| `PREDICTED_OVERLAY_UNAVAILABLE` | one bare reason token | `{catalog-resolve-failed, derivation-failed}` |

Split rule for the client: on the FIRST `': '` only. The prose warnings `layoutGraph` already emits contain
`': '` too (`lane 2 is dynamic: agents cannot…`, `agent x unmatched to the predicted layout: frame-grouped`,
`dashboard.ts:393-436`), so the leading segment must be matched against the CLOSED token set and an unmatched
token must fall back to the **raw string** — never to the detail half, which for a prose line would drop its
subject. The grammar carries version strings and an enum only — never script text — so the IT-092 sentinel
(§4 S-2) guards this channel as well. `graph-layout.test.ts:165` asserts no `layoutGraph` warning matches
`/skeleton/i`; the route-pushed strings need the same assertion once, in IT-169, because they are served bytes.

**O-3 — The producers, and which of them a real test can reach.** Enumerated so the tests are written
against producers that exist:

| Arm (ARCH-130) | Producer | Reachable at the integration tier? |
|---|---|---|
| (i) pin resolves | any healthy run | yes — every existing DAG case |
| (ii) pin absent, `release` resolves → FALLBACK | `registerPublishedVia` **twice** (release = `v2`) → `run_start` (pins `v2`) → `workflow_deregister` → `registerPublishedVia` **once** (new lineage = `v1` only) → DAG read: `resolve({version:'v2'})` throws `VERSION_NOT_FOUND`, `release` = `v1` → `PREDICTED_FROM_FALLBACK_VERSION: pinned=v2 resolved=v1`. **Rule: the run's pin must be numerically HIGHER than the re-registered lineage's count**, or arm (i) finds a same-numbered new row and the collision in §4 S-4 greens the test | yes — real calls, in that order |
| (iii) both throw → UNAVAILABLE `catalog-resolve-failed` | register → `run_start` → `workflow_deregister` — the exact producer `dashboard-http.test.ts:205-222` already builds | yes — extend THAT case |
| (iv) derivation throws / v1 re-derive refuses → UNAVAILABLE `derivation-failed` | none with a registered script: registration ran the SAME derivation (INV-V26-3), and `contract:'v1'` never refuses today (`skeleton-graph.ts:129-137`) | **no** — defensive; do not add an injection seam to test it (see O-4) |

**O-4 — Say `derivation-failed` is defensive; do not build a seam for it.** Its coverage is
`deriveLanes(phases, undefined, …)` never throwing (UT-238 row (ii)) plus the `try/catch` at `:540-542`
staying in the route. A mockable `derive` parameter on the route would be a seam whose only production value
is constant — the class this delta is deleting. DES-198's `tests:` line says so in one sentence.

**O-5 — Journal ↔ payload correlation is a design rule, not a coincidence.** The line
`{event:'dashboard_api_degraded', route:'dag', runId, reason}` on the two UNAVAILABLE arms must use, as
`reason`, the SAME enum string the warning's `detail` carries (`catalog-resolve-failed` / `derivation-failed`),
so an operator whose team reports 「預測結構不可用」 can `grep <runId>` the journal and match the payload 1:1.
Test: a `console.warn` spy in the deregister case (O-3 (iii)) parsing exactly one line and asserting
`reason === warnings[k].split(': ')[1]`. FALLBACK is NOT logged (a state, on every read; its durable record is
`legacySubstitution`, which already writes `run.legacySubstitution: {…}` to the journal at
`run-manager.ts:909` the moment a resume makes it durable). The flood memo the architect pre-approved is
**documented in DES-198 as a shape, not built**: `dedupeKey = runId + ':' + reason`, a per-process `Set`,
triggered only if Gate 7.5 records it drowning the journal.

**O-6 — The fixture's stale qualifier.** `DAG_PAYLOAD_OPEN` (`dashboard-wire.ts:84`) and the row label
`GET /api/runs/:id/dag (open)` (`:112`) become `DAG_PAYLOAD` / `GET /api/runs/:id/dag` — "(open)" implies a
second, masked shape that no longer exists. One identifier, TASK-197's file, no allowed-set change.

**O-7 — DES-206 / `ui/run.js` renders the text, not the count.** `dashboard-page.ts:601-607` emits `N
warning(s)` today; the rebuilt legend row renders `warningText(w, lang)` per entry via `textContent` (D5) and,
for a FALLBACK entry, ALSO paints the predicted cells (`agentId === undefined`, `dashboard.ts:330-331`) at the
greyed style REQ-134 already defines for `queued/pending` (dashed border, opacity .65) — one class reused, no
new CSS rule. The DAG warning is the authority for greying THIS read; the client never reads
`legacySubstitution` off `/api/runs/:id` to decide it (C-2).

### Agent altitude

**O-8.** After this delta the run page distinguishes three states an operator watching agents needs:
"this agent has not been dispatched yet" (inert cell, `agentId === undefined`), "this agent does not exist in
the plan" (no cell), and "the plan shown is not the plan that ran" (FALLBACK). Chain-of-thought, token and
tool-call inspection (REQ-135/140/141) are untouched by this delta; no memory or prompt seam moves.

---

## 2. Replaceability

**The delta removes a seam. The design's job is to remove it completely — including from its own prior
text — and to keep the derivation single.**

### System altitude

**R-1 — C-4 withdrawn; DES-197 loses a sentence and a paragraph, not gains a default.** Delete from DES-197:
the signature clause `McpFacadeDeps.maskPredictedOverlay?: boolean — absent ⇒ true (masked)` and `server.ts
forwards maskPredictedOverlay: !!authCfg`; the whole boundary paragraph from "The masking predicate must
arrive through the dep" to "rather than over-disclosing"; and the UT line "a facade constructed with no
`maskPredictedOverlay` omits `agents`". What REPLACES the paragraph is one sentence, not a mechanism: *the
synthetic `{kind:'auth-disabled'}` principal the dashboard's describe and agent routes pass (`server.ts:402`,
`:563`) means any future principal-dependent facade projection would silently take the auth-disabled branch
on exactly the paths REQ-133/135 render; there is no such projection today, and INV-V27-9's parity is the
empirical guard.* ARCH-131 already says this; the DES cites it.

**R-2 — `expected: ExpectedGraph | undefined` stays, for the right reason.** DES-196's signature sentence
(`server.ts:519-520 populates it only if (!authEnabled)`) is the one that must be REWRITTEN, or the next
reader restores the auth reading from the type alone: *`undefined` means the derivation failed, and it is the
only reason.* The signature becomes `deriveLanes(phases: PhaseView[], expected: ExpectedGraph | undefined,
opts: { status: RunStatus })`. DES-196's own refinement of `current` over all seven `RunStatus` members
(`running | suspended | interrupted` → last observed index; `queued` and the three terminal states → `null`;
empty `phases` → `null` everywhere) STANDS — it is one altitude below ARCH-126's `status === 'running'` line
and was recorded at Gate 4; the v27b amendment did not touch it.

**R-3 — The route's version resolution is three lines in the route, not a helper.** ARCH-130 (i)-(iv) is
`catalog.resolve(spec.name, { version: view.legacySubstitution?.resolved ?? view.scriptVersion })`, a second
`resolve(spec.name, {})` on throw with the FALLBACK push, and the UNAVAILABLE push on a second throw. Extracting
`resolvePredictedOverlay(...)` would buy a unit tier for arm (iv) only (O-4 refuses that) and would move code
the trace chain cites by `server.ts:line`. Karpathy: the minimum that satisfies the ruling is a
`??` inside an expression that already exists.

**R-4 — The deletion is type-safe and the DoD must say which deletions.** `handleDashboardRequest`'s
`authEnabled = false` (`:334`) is positional; the two trailing parameters are `authAnnounce: {…}` and
`diagrams: DiagramRenderer` (`:336-338`) — disjoint types, so a mis-shift at the one call site (`:1068`,
v23 one-dispatch rule) is a `tsc --noEmit` error, not a runtime surprise. `authAnnounce` STAYS (`/api/system`'s
`auth` key, ARCH-090, is how an operator learns auth is on — a different fact). TASK-203's `dod:` lists the
four deletions by line, because a deletion that is not a DoD line is the thing left behind.

**R-5 — No new config key.** Nothing for the twice-bitten `composeConfig()` class to bite; worth the one
positive sentence in DES-198 so the next author does not add a `dashboard.predictedOverlay` knob "for
safety" — ADR-051 names where a future withholding policy lives (a principal-aware projection), and it is
not a config key.

### Agent altitude

**R-6.** Provider, transport and model seams do not move; the overlay is script-derived and provider-agnostic.
Recorded so the section is honest rather than padded.

---

## 3. Consumability

**Two consumers, one wire shape regardless of auth. What the design adds is the exact sentence each contract
row and each `dod:` needs, and the cohort transition a client would otherwise get wrong.**

### System altitude

**C-1 — Contract sentences (final, for README `:368-375` and the ARCH contract rows).**
`GET /api/runs/:id/dag`: *gains `lanes` (the observed phases extended by every unreached expected lane —
regardless of auth, Round v27b) and `current`; `warnings[]` may carry `PREDICTED_OVERLAY_UNAVAILABLE:
<reason>` (lanes observed-only) or `PREDICTED_FROM_FALLBACK_VERSION: pinned=vN resolved=vM` (overlay derived
from a substitute version — the client greys it).* `describe.phases[]`: *`agents?: string[]` — the predicted
lane membership, served to every caller regardless of auth; absent only when the engine could not derive the
predicted layout for this version.* TASK-202's `dod:` (`03-tasks.md:1704`) currently asks for the README
describe row "with its masking sentence" — that clause is deleted; the row is added WITHOUT one. README
`:312-313`'s existing sentence (the dashboard never contained script text) is unchanged and still true.

**C-2 — The one client rule, and the cohort transition behind it.** *The DAG `warnings[]` entry is the
authority for greying the overlay on this read; `legacySubstitution` on `/api/runs/:id` is the durable record
that an EXECUTION resumed on a substitute.* They do not coincide, and the design must say why so no test
asserts the wrong thing: `legacySubstitution` is written only by `_requireLive` on RESUME
(`run-manager.ts:903-909`); a run whose pin was purged after it started carries the FALLBACK warning on every
DAG read and NO field — until a resume records the substitution, after which arm (i) reads `resolved`
directly and the warning disappears. Same run, two honest answers at two times. A test that asserts the
warning PERSISTS across a resume is asserting a defect.

**C-3 — MCP consumer.** `phases[].agents` is additive for every `workflow_describe` caller. `tool-specs.ts:332`'s
description ("per-agent parameters, agent labels, live triggers, and its author-supplied diagram") gains
"and the predicted lane membership (`phases[].agents`)" — REQ-106's precedent that a cold, schema-only client
learns the field without fetching anything. One clause; a `dod:` line on TASK-202.

**C-4 — Inert-cell detection.** The client detects a predicted cell by `agentId === undefined`
(`dashboard.ts:330-331`), never by the `__skel_` id prefix; the engine's own tests may key on the prefix
(IT-092, IT-168, `dashboard-http.test.ts:220`) because that is the wire id asserted where it is produced.
DES-206 states the client half; unchanged from Sprint A, cited for completeness.

**C-5 — Timing on the positive anchor.** `lanes.map(l => l.title)` and `describe.phases[].agents` are
timing-independent on `SCRIPT_PHASED` (every lane is an expected lane whether entered or not; describe
involves no run). `current` is NOT: the harness reads the DAG immediately after `run_start`, and whether
`phase('one')` has fired `onPhase` at that instant is unverified — assert `current ∈ {null, 0}`, or poll
`/api/runs/:id` until `phases.length ≥ 1`. The full `current` table is UT-238's job.

**C-6 — A `null` lane title.** `lanes[].title: string | null` is on the wire (a `phase()` whose first argument
is not a string literal). `lib/strings.js` needs one key (`laneUntitled` → 「未命名 lane」/`untitled lane`) or
`ui/run.js` renders the literal `null`. Small, but it is a string in a view, which REQ-131 forbids.

### Agent altitude

**C-7.** A cold model calling `workflow_describe` gets one shape on every deployment and can draw the
predicted layout from `phases[].agents` without parsing `mermaid` — the reuse REQ-133's data buys beyond the
page.

---

## 4. Self-sustainability

**Will the ruling still be in force three iterations from now with nobody watching, will the tests that
guard it be able to fail, and what can they NOT see?**

### System altitude

**S-1 — The parity oracle, as a test row.** IT-168's harness already boots both servers
(`dag-masking-auth.test.ts:46-64`). The new case: register `SCRIPT_PHASED` on both, `run_start` on both, read
`/api/runs/:id/dag` anonymously on both, and deep-equal the two payloads MINUS `terminalAt` (there is no
`runId` on the DAG payload — `ALLOWED_DAG_KEYS`, `:88`; the exclusion list is written against the fixture's
key tuple so a new key is compared by default). The describe half runs over HTTP
`GET /api/workflows/:name/describe` on BOTH servers — anonymous on both, synthetic principal on both
(`server.ts:402`) — so the only bearer asymmetry in the whole test is setup (`mintBearer`, `:76-84`). Plus the
positive anchor on the AUTH server (`['one','two','three']`, `[['p-1'],['p-2'],['p-3']]`, `current ∈ {null,0}`),
because parity is vacuous when both engines degrade identically. **Precondition, asserted BEFORE the parity
assertion on both servers:** `cells.every(c => c.agentId === undefined)` — a live `AgentRecord` carries a
runtime `agentId`, so if either server dispatched its first `agent()` before the anonymous GET landed,
`cells`/`edges` would differ by a random string and parity would fail as an illegible diff. IT-092 has relied
on "no live record yet" since v22 (sandbox boot ≫ one GET); the precondition makes a timing shift fail
legibly instead — the same hazard C-5 names for `current`. `SCRIPT_PHASED` is one constant:
`registerPublishedVia` wraps a phase-less script in a single synthesized `main` lane
(`workflow-fixtures.ts:139-143`, `:302`) on which no lane is ever unreached, so the DES-196 join — the clause
REQ-134's dashed edges depend on — cannot be anchored on IT-092's `SCRIPT`.

**S-2 — Red versus guard, labelled, or Gate 5 records a false red.** RED today: IT-168's flipped cases
(`describe.phases[].agents` is not projected; the auth server answers 1 cell where the open server answers 4,
`:520`) and the parity case. GREEN before and after: IT-092 re-traced as a REQ-100 **guard** — 「the DAG
payload carries no script bytes」 — with a sentinel line in the script (`const IT092_SENTINEL =
'never-leaves-the-engine';`, matching neither `CALL_RE` nor `AGENT_CALL_RE`) asserted absent on
`await res.text()`, not on parsed fields, so a future field cannot smuggle it past a key-set. House precedent:
`dashboard-disclosure.test.ts:50`'s `MARKER`. The file's header comment (`:1-15`) and the IT-168 block comment
(`:130-139`) still state decision (a) and the mask — both are rewritten with the test, or the file lies about
itself to the next reader.

**S-3 — UT-238 after this delta.** 7 × 2 (status × phases empty/non-empty) for `current`, plus three join
rows: (i) unreached expected lanes extend the observed list (index 2 `three`); (ii) `expected: undefined` →
observed-only, never throws; (iii) **new** — observed longer than expected (the loop-body `phase()` case,
`run-manager.ts:1075` vs `skeleton-graph.ts:111-112`) → `lanes` IS the observed list, no conflict output.
Row (iii) is what retires the rejected detector permanently: a future author who adds one turns it red.

**S-4 — The honest limit of the new witness: a REUSED pin is invisible.** `register()` assigns
`v<max+1>` over the name's own rows (`workflow-catalog.ts:583`, `:621`); `workflow_deregister` removes every
row; a re-register under the same name starts again at `v1`. A run pinned to the OLD `v1` then resolves the
NEW `v1` on arm (i) — no throw, no FALLBACK, a predicted overlay from a script the run never executed, and
`legacySubstitution` never set because resume resolves the same way (`run-manager.ts:899-901`, DES-113). The
FALLBACK arm witnesses an ABSENT pin, never a reused one. Two consequences for this delta: **(a)** the FALLBACK
integration producer (O-3 (ii)) must pin the run to a version number HIGHER than the re-registered lineage
will reach — register twice BEFORE the run (pin `v2`), re-register once AFTER the deregister (lineage `v1`) —
because any recipe where old pin ≤ new lineage count produces the collision and a green test that proves
nothing; **(b)** DES-198's boundary states the limit in one sentence and names the v28 check that closes it — the
version row's `createdAt` (`workflow_versions.createdAt`, `:230`) later than the run's `createdAt`
(`types.ts:363`) ⇒ the pin was reused — as a catalog-lineage item OUT of this closure (ADR-051's sweep
boundary: REQ-100's masking, DES-113's resume path and the catalog are untouched here). Named now so it is a
requirement later, not a Gate 7.5 surprise.

**S-5 — Gate 7.5 rows.** VAL-199 gains one Chromium case with `auth.enabled:true`: a never-run workflow
renders its predicted lanes on the auth-enabled engine (no gateway needed), with the `mintBearer` trap named
in the row (registration needs the bearer; the page and `/api/*` GETs need none) so the case cannot pass
vacuously on 「找不到」. VAL-204 gains the p95: a VAL-side wall-clock loop (200 sequential `GET
/api/runs/:id/dag`, auth on, the largest corpus script), one number recorded, no product timing seam. The
bounded memo (LRU 64 or evict on catalog GC, keyed `${name}@${version}`, per process) is pre-approved on that
number and not built before it. The v27 real-tier table rows for REQ-133 ("…rendering its predicted lanes")
and REQ-140 ("`lanes` present in BOTH") gain the words "on the auth-enabled engine" and "the unreached
predicted lanes and `describe.phases[].agents` present in BOTH".

**S-6 — Self-healing unchanged; journal noise bounded by design, not by hope.** Every fault still degrades
to an empty overlay and a 200 (`:540-542`, `:582-585`). The two fault-arm log lines are the closed loop the
dashboard's "never a 500" contract opens; the dedupe shape is documented (O-5) so that if k viewers at a 3 s
poll drown the journal on a deregistered workflow's old run, the fix is a five-line bounded `Set`, not a
debate.

### Agent altitude

**S-7.** No memory to metabolize (the overlay is derived from stored script text on every read until a
measured number says otherwise), no tool probed, no prompt calibrated. One line, honestly.

---

## 5. Task-splitting — where the order decides whether a property survives (for the design synthesizer)

The dispatch asked for this explicitly; 03-tasks.md exists, so these are `dod:` and ORDER amendments, not new
tasks.

1. **TASK-201 (`deriveLanes` signature) before TASK-203 (route) before TASK-202 (facade).** The route calls
   the new signature; the facade's `phases[].agents` reuses `predictedLanes` from the same file. Reversed,
   Gate 6 writes the cast UT-238 already carries.
2. **TASK-197 (fixture: rename + `warnings` literals + `DAG_WARNING_TOKENS`) before IT-165/168/169 and before
   TASK-206.** The fixture is the lock (O-1); every reader lands after it.
3. **TASK-206 (`lib/strings.js`: `parseDagWarning`, `warningText`, the two token keys and `laneUntitled`)
   before TASK-210 (`ui/run.js` renders the text).** UT-244's key-parity case covers the new keys for free.
4. **TASK-203's `dod:` enumerates the four deletions by line** (`:520` branch, `:334` param + default, `:1068`
   argument, comments `:331-334`/`:350`/`:1064`; `:819` stays) and the two producer cases in IT-169 (deregister →
   UNAVAILABLE + one log line; register×2 → run pinned `v2` → deregister → register×1 → FALLBACK
   `pinned=v2 resolved=v1` + no log line).
5. **TASK-202's `dod:`** loses "a facade constructed with NO `maskPredictedOverlay` omits `phases[].agents`"
   and "with its masking sentence"; gains "both servers answer `phases[].agents` present with labels; HTTP
   describe parity across the two servers; `tool-specs.ts:332` names the field".
6. **IT-092's row is re-traced (REQ-100, guard, green) in the same edit as IT-168's flip** — two rows in one
   file, two different statuses, both stated.

---

## key_points

1. **Amendment pass, not authorship:** DES-196/197/198/206 (+ one DES-201 line), TASK-197/201/202/203/206/210
   `dod:`, UT-238, IT-092/168/169, VAL-199/204, the fixture. Zero new ids, zero `owner_decision`s.
2. **C-4 withdrawn by its author** (§0 W-1): DES-197's `maskPredictedOverlay` signature clause, its fail-closed
   paragraph and its UT line are deleted; the synthetic-principal hazard survives as one cited sentence with
   INV-V27-9 as the guard.
3. **The warning vocabulary is locked by the fixture** (O-1): three literal `warnings` in `dashboard-wire.ts`
   + `DAG_WARNING_TOKENS`; `dagWarning()` formatter in `dashboard.ts` (route spells no token literal);
   `parseDagWarning`/`warningText` in `lib/strings.js`; IT-169 asserts the format, UT-244 asserts the map.
4. **`detail` grammar closed now** (O-2): FALLBACK = `pinned=vN resolved=vM`; UNAVAILABLE = one reason from
   `{catalog-resolve-failed, derivation-failed}`; split on the first `': '`; unknown token → RAW string;
   `/skeleton/i` asserted absent on the served bytes once.
5. **Producers named per arm** (O-3): deregister → UNAVAILABLE (extend `dashboard-http.test.ts:205-222`);
   register×2 → run pinned `v2` → deregister → register×1 → FALLBACK `pinned=v2 resolved=v1` (the pin must
   outnumber the new lineage); `derivation-failed` is defensive, tested by `deriveLanes(…, undefined)` + the
   kept `try/catch`, no injection seam (O-4).
6. **Journal `reason` = warning `detail`, verbatim** (O-5), asserted by a `console.warn` spy; FALLBACK not
   logged; dedupe shape documented, not built.
7. **The cohort transition is a contract sentence** (C-2): FALLBACK warning before a resume, none after;
   no test may assert persistence; the DAG warning is the authority for this read.
8. **`deriveLanes(phases, expected | undefined, { status })`** (R-2, S-3): `undefined` = derivation failed,
   the `server.ts:519-520` sentence rewritten; UT-238 = 7×2 + three join rows incl. observed-longer-than-expected.
9. **Deletions are `dod:` lines by `server.ts` line number** (R-4, §5.4); `authAnnounce` and the `:819` comment
   stay; no new config key (R-5).
10. **Parity + anchor as written rows** (S-1): exclusion against the fixture's key tuple minus `terminalAt`;
    describe half over anonymous HTTP on both servers; `SCRIPT_PHASED`; `current ∈ {null, 0}`.
11. **Red-vs-guard labels** (S-2): IT-168 + parity red; IT-092 sentinel on `res.text()` green under REQ-100;
    both header comments rewritten with the tests.
12. **The reused-pin blind spot is stated, and the v28 check named** (S-4): `workflow_versions.createdAt >
    run.createdAt` ⇒ pin reused; out of closure; the FALLBACK test recipe pins the run ABOVE the
    re-registered lineage's count (old pin `v2`, new lineage `v1`) so it does not green on the collision.
13. **Gate 7.5** (S-5): one auth-ON Chromium case in VAL-199 with the `mintBearer` trap named; VAL-204's
    VAL-side p95; the real-tier table rows for REQ-133/140 amended in words.
14. **Order** (§5): 201 → 203 → 202; 197 before every reader; 206 before 210; IT-092 re-trace in the same
    edit as IT-168's flip.

## risks

| # | Risk | Severity | Where it lands |
|---|---|---|---|
| QD-Δ-D1 | **The token is spelled in two files with no shared literal** — the fixture carries no `warnings` example, so the server test pins one string and the client test another; a rename on either side ships an English enum into the zh-TW legend with CI green. | HIGH | O-1, TASK-197/206, IT-169, UT-244 |
| QD-Δ-D2 | **The FALLBACK integration case greens on the reused-pin collision**: whenever the run's old pin number ≤ the re-registered lineage's count (e.g. pin `v1`, then any number of re-registers), arm (i) FINDS a same-numbered new row, resolves the NEW script, pushes no warning, and a test that "proves" FALLBACK passes only because it asserted nothing about `warnings`. The producing recipe is the inverse: pin HIGH, re-register LOW. | HIGH (certainty under the natural recipe) | O-3 (ii), S-4, IT-169 |
| QD-Δ-D3 | **A test asserts the FALLBACK warning persists across a resume** — it disappears by design once `legacySubstitution` is recorded; the "fix" would be to log or persist the warning, inventing a second durable record. | MID | C-2, DES-198 boundary |
| QD-Δ-D4 | **`derivation-failed` grows an injection seam** (a `derive` parameter on the route or a `predictedOverlayFor()` helper) to make an unreachable arm unit-testable — a constant-valued seam of the class this delta deletes. | MID | O-4, R-3 |
| QD-Δ-D5 | **The client splits on every `': '`** or falls back to the detail half, so `layoutGraph`'s prose warnings render as `agents cannot be statically slotted` with their subject dropped. | MID | O-2, DES-206 |
| QD-Δ-D6 | **The journal `reason` and the warning `detail` drift** (`catalog_resolve_failed` vs `catalog-resolve-failed`); the operator's `grep` matches nothing and the correlation the log line exists for is gone. | MID | O-5, IT-169 |
| QD-Δ-D7 | **DES-197's masking paragraph is "amended" rather than deleted** — a fail-closed sentence survives in design text after the ruling, and a Gate 6 reader restores the dep from it. | MID | R-1, W-1 |
| QD-Δ-D8 | **The parity case is written as a pick-list** (`cells`, `edges`, `lanes`) and the likeliest future leak — a new sibling field via `...view` — is never compared. | MID | S-1 |
| QD-Δ-D9 | **`dag-masking-auth.test.ts`'s header comments still describe the mask** after the cases flip; the next reader trusts the comment over the assertions. | LOW | S-2 |
| QD-Δ-D10 | **A `null` lane title renders as the literal `null`** in the swimlane header for a `phase()` with a non-literal argument. | LOW | C-6 |
| QD-Δ-D11 | **The reused-pin blind spot surfaces at Gate 7.5 as "the overlay is wrong under auth"** and is misattributed to the reversal instead of to the catalog lineage. | LOW (cost) / MID (confusion) | S-4 |

## expected disagreements with other lenses

- **vs. the adversarial lens — on O-1's `dagWarning()` formatter in `dashboard.ts`.** They will call a
  formatter for two strings machinery. It is one function with one home and one caller file, and it is
  what lets `grep -c PREDICTED_ src/server.ts` be zero; the alternative is two string literals in the route
  and a third in the test. If they win, the fixture literal + the `startsWith` assertion in IT-169 is the
  floor I hold — the lock is the fixture, not the formatter.
- **vs. the adversarial lens — on S-4 (the reused-pin blind spot).** They may say it is out of closure and
  should not appear. Out of closure to FIX, agreed; but a warning that implies completeness it does not
  have is an observability defect in THIS delta's row, and the double-register recipe is needed for THIS
  delta's test to be non-vacuous. One sentence in DES-198 and one v28 line.
- **vs. a security/testability lens — on parity over HTTP describe instead of MCP `workflow_describe`.**
  They may want the MCP surface compared. The HTTP route IS the MCP projection unwrapped (`server.ts:395-410`,
  DES-132's parity guarantee), it takes no bearer on either server, and it is the surface REQ-133 renders;
  comparing MCP would add the bearer asymmetry to the assertion itself.
- **vs. the design synthesizer — on R-3 (no helper for the resolve chain).** They may prefer a named
  function for readability. The chain is three lines the trace chain already cites by `server.ts:line`; a
  helper buys a unit tier only for the arm O-4 declines to test. If they extract it anyway, it must stay in
  `server.ts` (it is async I/O; `dashboard.ts` is pure) and must not take a `derive` parameter.
- **vs. a UX lens — on O-7 reusing the `queued/pending` greyed style for a FALLBACK overlay.** They may
  want a distinct treatment. The legend text already says 「預測結構來自替代版本 vN」; a third node style is
  a new CSS rule and a new computed-style row for a state that is rare by construction after ARCH-130 (i).
- **vs. whoever writes DES-197 — on W-1's wording.** Expected uncontested once stated: the withdrawal is
  mine to make, and the sentence that replaces the paragraph cites ARCH-131 rather than restating it.

## Ledger edit map — one row per item the synthesizer touches

| Item | Edit |
|---|---|
| DES-196 | signature `opts: { status: RunStatus }`, `expected \| undefined` = derivation failed (rewrite the `:519-520` sentence); boundary: observed wins / predicted fills the tail / no conflict output; `current` seven-member rule STANDS; tests: 7×2 + three join rows |
| DES-197 | DELETE the `maskPredictedOverlay` signature clause, the fail-closed boundary paragraph and the UT line; `phases[].agents` unconditional, absent ⇔ derivation failed; one cited sentence on the synthetic principal + INV-V27-9; tests: both servers `agents` present, HTTP describe parity, `record` unchanged |
| DES-198 | (2) `deriveLanes(view.phases, expectedGraph, { status: view.status })`; the four deletions by line; resolution (i)-(iv) with `legacySubstitution?.resolved ?? scriptVersion`; `dagWarning()` imported, no token literal in the route; (4) `{event, route:'dag', runId, reason}` on the two UNAVAILABLE arms, `reason` = detail enum; dedupe shape documented; boundary: the cohort transition (C-2), the reused-pin limit + v28 check (S-4), `derivation-failed` defensive (O-4), no new config key; tests: deregister → UNAVAILABLE + one parsed log line; register×2 → run pinned `v2` → deregister → register×1 → FALLBACK `pinned=v2 resolved=v1` + no line; `/skeleton/i` absent on served bytes |
| DES-201 | `lib/strings.js` gains `parseDagWarning`, `warningText`, keys `predictedUnavailable`, `predictedFromFallback` (takes `resolved`), `laneUntitled`; key parity covers them |
| DES-206 | `ui/run.js` renders `warningText(w, lang)` per entry (text, not a count); FALLBACK greys the inert cells with the existing pending style; the DAG warning is the authority, never `legacySubstitution` |
| TASK-197 | `DAG_PAYLOAD_OPEN` → `DAG_PAYLOAD`, row label without "(open)", three `warnings` literals, `DAG_WARNING_TOKENS` |
| TASK-201 / 202 / 203 / 206 / 210 `dod:` | per §5 |
| UT-238 | `masked` cases out; 7×2 `status` table; join rows (i)(ii)(iii) |
| UT-244 | + the map over the fixture literals; + `laneUntitled` in parity |
| IT-168 | flipped positive on both servers; precondition `cells.every(c => c.agentId === undefined)` on both, THEN parity (exclusion vs the fixture tuple minus `terminalAt`) + describe parity over HTTP; positive anchor on the auth server; `SCRIPT_PHASED`; header comments rewritten |
| IT-169 | the deregister case gains the UNAVAILABLE warning + the log-line spy; new FALLBACK case with the pin-HIGH / re-register-LOW recipe (`pinned=v2 resolved=v1`); `dagWarning()` equals the fixture literal; no `/skeleton/i` |
| IT-092 | re-traced to REQ-100 as a green GUARD: sentinel absent on `res.text()`; `['__trigger__']` assertion deleted |
| VAL-199 / VAL-204 | one auth-ON Chromium never-run case with the `mintBearer` trap named; VAL-side p95 loop; bounded memo pre-approved on the number |
| Real-tier table (04-design.md:6849) | REQ-133 row + "on the auth-enabled engine"; REQ-140 row + "the unreached predicted lanes and `describe.phases[].agents` present in BOTH" |
| README `:368-375`, `tool-specs.ts:332` | the two C-1 sentences; the describe row WITHOUT a masking sentence; the tool description names `phases[].agents` |
| REQ-105 `:1070` | orchestrator: `[PARTIALLY SUPERSEDED v27b, Round v27b]` on the auth-gate clause only (W-7) |
