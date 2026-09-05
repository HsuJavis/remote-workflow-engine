---
stage: architecture
lens: quality-dimensions
iteration: v24
round: 1 (independent proposal)
---
# Quality-dimensions proposal — v24 (Observability / Replaceability / Consumability / Self-sustainability)

## summary

v24 is mostly well-specified; four cross-cutting gaps decide whether it holds up. (a) **Every new
"…and it is recorded" clause needs a named read-back seam** — REQ-114 already shows the shape (write
`pushedBy`, read it back through `workspace_list`), while REQ-109's admin audit and REQ-115's
unclaimed-trigger refusal specify only the write half; this project has already graded
write-without-readback as debt (AC-2 / ARCH-085). (b) **Role enforcement belongs in one table
consulted before dispatch**, not inside 40 switch arms — that is the `mcp_provision` bug class at
36x scale. (c) **REQ-111's "does not render" should be satisfied by a restricted-grammar parser over
REQ-112's fixed vocabulary**, not a real Mermaid renderer: the server has three runtime dependencies
and a grammar-valid diagram renders by construction. (d) **The authoring guide must be rendered from
the enforcement modules**, because REQ-117's "first try, no trial and error" has no margin for a
stale ceiling in prose. Three HIGH risks: unbounded refusal records from an unclaimed cron (QD-R1),
a silently-unwired `principals` config block (QD-R2, this project's twice-bitten `composeConfig`
class), and taking "renders" literally (QD-R3).

## Altitude call (which system is this?)

**Both altitudes apply, and v24 splits cleanly between them** — so I apply both, but per dimension,
not globally.

Evidence from `state.yaml.tech_stack` + requirements: this is a Node 22 / TypeScript ESM **service**
(hand-rolled JSON-RPC-over-HTTP MCP server at `src/server.ts`, SQLite via better-sqlite3, filesystem
journal, web dashboard, systemd self-update) — that is a conventional system, and REQ-107/108/109/114/
115/118 are conventional-system requirements (naming, authz, audit, resource lifecycle, interface
conformance). It is *also* an **agent-orchestration runtime**: `agent()` dispatches a Claude Agent SDK
headless session through a LiteLLM gateway with pluggable providers, and REQ-110 (per-agent model /
effort / timeoutMs / appendPrompt / skills / mcp) and REQ-113 (per-agent selective asset materialization)
are agent-altitude requirements. REQ-111 is agent-altitude in the *negative*: it deletes an autonomous
LLM subsystem (ARCH-079 `GraphAnalyzer`) and replaces it with a static check.

One agent-altitude sub-topic I deliberately do **not** force onto v24: **memory metabolism and
self-reflection / prompt calibration**. Runs here are bounded and journalled, not long-lived resident
memories; nothing in REQ-107..118 asks for context compression or self-calibration, and inventing it
would be scope invention. Named once, then dropped.

---

## 1. Observability

**The discriminating principle this project has already paid for: a write with no read-back seam is
unobservable.** That is precisely why v23's AC-2 (ARCH-085 read-back seam) and the "B5 early-return
swallows every zero-model-call settle silently" finding were graded as debt rather than as working
code. v24 introduces **three new "…and it is recorded" clauses**, and each one is a place that bug
class re-enters unless the read-back seam is designed now.

### System altitude

**O-0 — REQ-114 is the exemplar the other two must match, and it is also the traceability fold this
lens carries.** v24 has *three* "recorded" clauses, and REQ-114 is the only one that specifies both
halves: `pushedBy`/`pushedAt` are written on every asset and MCP config, **and** the requirement names
the reader (`workspace_list` returns `pushedBy`), to the point that REQ-113's widened author-push
permission is explicitly conditional on being able to read it back. That is the correct shape, and it
is the traceability answer to the pre-v24 hole where "a violation could be traced to the workflow that
used a config but never to whoever installed it". O-1 and O-2 below are the two clauses that specify
only the write half; they should be brought up to REQ-114's standard rather than treated as new
inventions.

**O-1 — REQ-109's audited admin cross-principal read needs a table and a reader, not a log line.**
The requirement's own justification is "a permission that leaves no trace cannot be reviewed". A
`console.log` is a trace nobody reviews. Proposal: a durable row in the run store's existing SQLite
database (`admin_reads`: principal, targetPrincipal, runId, tool, paths, at), written **before the bytes are
returned** (a filesystem read is not transactional, so the ordering is the guarantee), with **two
read-back seams**: the dashboard (ARCH-011) and the
run's own `run_status` response as an `adminReads[]` array. Note the deliberate tension: v24's tool
count goes 40→36, so I am proposing **no new MCP tool** for this — the seam rides existing responses.
Acceptance should be "an admin reads another principal's workspace, then a subsequent `run_status`
shows the read", not "a row exists in the DB".

**O-2 — REQ-115's "a trigger that fires while unclaimed is REFUSED and the refusal is recorded".**
Same seam question. Recorded *where*, readable by *whom*? The trigger is the user's own resource, so
the refusal belongs on the trigger's own record (`lastRefusedAt`, `refusalCount`, `lastRefusalReason`)
and must be read back through the trigger's own listing surface — verified present as
`case 'schedule_list'` and `case 'webhook_list'` in `src/server.ts`. **ARCH-078 `getTriggerBindings`
cannot be that seam**: it is keyed by workflow name, and an unclaimed trigger has no workflow by
definition — ARCH-078 takes over only once the trigger is claimed at registration. Without a seam on
the listing surface the failure mode is exactly the silent one: a webhook the author believes is wired
fires into nothing for a week.

**O-3 — REQ-118 is an observability artifact, not only a test.** "A table records tool, arguments,
observed response and pass/fail, and a tool that cannot be exercised is listed as UNVERIFIED with the
reason, never quietly omitted." The architectural ask is that this table be **generated** from the
fixture list and drift-locked against `tools/list`, so a tool added later cannot be absent from the
table — the same drift-lock shape ARCH-051 already established for tool schemas. A hand-maintained
table decays by the next iteration.

### Agent altitude

**O-4 — the harness descriptor must go per-agent, or REQ-110 + REQ-113 create a new black box.**
ARCH-044 captures a `kind:'harness'` transcript event at dispatch and ARCH-068 extended it for v21's
resolved params. v24 changes the unit of resolution: parameters are now per-`label`, and **only the
skills/MCP declared at `meta.params.agents.<label>` are materialized** (REQ-113). The two questions a
user will ask are "which model/effort/timeout did *this* agent actually get, and from whose default or
override?" and "why did skill X not load for this agent?". Both are answerable only if the per-agent
harness descriptor records **resolved values with their provenance** (author default / user override /
engine ceiling) *and* the **materialized asset list actually copied into the workspace for that agent**
— not the declared list, the materialized one. Declared-vs-materialized divergence is the whole point
of selective materialization, so observing only the declaration observes the wrong thing.

**O-5 — REQ-111's bidirectional refusal must name both directions explicitly.** "Diagram mismatch" is
an opaque failure. The refusal should say *which* labels are in the script but not the diagram and
*which* nodes are in the diagram but not the script — the check is statically decidable, so both sets
are in hand at refusal time and withholding them is a pure loss.

**O-6 — a gain worth recording: removing ARCH-079 removes an opaque agent.** The v23 analyzer was an
async, single-flight, **transcript-less** internal LLM call — by construction the one agent in this
system whose reasoning was not inspectable, and the source of the `diagramStatus` pending/unavailable
states. REQ-111 deletes it. That is a net observability improvement and the proposal should claim it.

---

## 2. Replaceability

### System altitude

**R-1 — REQ-109 "enforced at every tool" must NOT be enforced inside the 40-case dispatch switch.**
Verified: `src/server.ts` carries 40 `case '…'` arms and the string `principals` appears nowhere in
`src/`. Enforcing a role check per arm reproduces exactly the bug class REQ-109 itself cites — the
`mcp_provision` description advertised "Admin tool" while `case 'mcp_provision'` checked nothing.
Proposal: **one table-driven policy** `tool → { minRole, ownershipPredicate }`, consulted **once** at
the facade before dispatch, plus a drift-lock test asserting **every name in `tools/list` has a policy
row** (an unmapped tool fails the build, it does not default open). This makes the role model a
replaceable component: a future OIDC group mapping or an external policy engine swaps the table, not
40 call sites.

**R-2 — REQ-108's "single shared path-verdict with per-destination rules" is the same shape, and
saying so is load-bearing.** Nine file-moving tools collapse to six; the requirement already demands
one verdict function with per-destination rule sets so "the two rule sets cannot drift apart". R-1 and
R-2 are one architectural pattern applied twice (one decision point, table of rules, drift-lock). They
should be designed as siblings, not independently.

**R-3 — REQ-111 "a `mermaid` that does not render is refused" is a replaceability trap. Do not take it
literally.** Verified: `package.json` has **three runtime dependencies** (`@anthropic-ai/claude-agent-sdk`,
`ajv`, `better-sqlite3`) and no mermaid. Literal render-checking means pulling mermaid + a DOM shim
(jsdom/headless browser) into a server whose entire dependency budget is currently three packages —
a large new supply-chain surface, boot cost, and a vendor lock to one renderer's parser quirks, in a
service whose deploy story is a systemd unit. But REQ-112 **fixes the vocabulary** to a closed set of
shapes, edges and label forms. A **restricted-grammar parser over that fixed vocabulary** is statically
decidable with zero new dependencies, and it is *stricter* than "mermaid renders it" (mermaid happily
renders diagrams that violate REQ-112's collapsed-edge and shape rules). `diagram-gate.ts` is already
the right home: it is today a pure four-pass validator over a canonical exported vocabulary
(`VOCAB_GLYPHS`, `DIAGRAM_CODEPOINTS`) and REQ-111 already says it is repurposed.

**The entailment matters, and I am not reinterpreting an owner-ratified clause:** if the REQ-112
grammar is a strict subset of valid Mermaid, then grammar-valid **implies** renders, so the acceptance
"a `mermaid` that does not render is refused" is satisfied *by construction* — every diagram the
grammar accepts renders, and the grammar additionally refuses diagrams a renderer would accept
(collapsed `A --> B & C & D` edges, author-invented shapes). Keeping the subset property true is
therefore a design obligation on the grammar, and should be stated as one.

**R-3b — where the diagram is DISPLAYED is unaddressed by REQ-107..118, and I flag it rather than
solve it.** Verified: no mermaid renderer exists anywhere in `src/` or the dashboard (the only hits in
the repo are fenced blocks in `docs/v8-trigger-architecture.md`). ARCH-084 renders v23's ASCII via
`textContent` into `<pre>`, never `innerHTML` — a deliberate security decision, and it worked because
ASCII *is* the rendered form. Author-supplied Mermaid is source, not a picture: through the ARCH-084
path a user sees raw `flowchart` text, which is a consumability regression against the original v21 ask
for "a workflow diagram a human can actually follow". The alternative is a client-side renderer in the
dashboard — a new third-party surface, and REQ-112's node labels legitimately contain `<br/>`, so
author-controlled text would reach an HTML renderer. Neither branch is chosen by any v24 requirement.
Raised as QD-R10.

### Agent altitude

**R-4 — REQ-110 stripping model names out of scripts IS the LLM-decoupling win, and should be argued
as such.** The requirement's stated reason is "a script carries no model name and stays usable when a
model becomes unavailable". In quality-dimension terms: model binding moves entirely into
`meta.params.agents.<label>` defaults plus the alias→provider map (ARCH-005/025), so
Claude↔GPT↔Gemini↔Ollama becomes a registration-data or config change, never a script rewrite. This
completes D2's original "gateway interface abstracted so it can be replaced later" at the *authoring*
layer, which was the last place a provider name could hide.

**R-5 — per-agent `skills`/`mcp` (REQ-110/113) are author-owned and locked, which keeps the agent
harness replaceable per agent rather than per workflow.** Combined with R-4, swapping one expensive
agent to a local model becomes a single declared default change — which is exactly D2's stated cost
goal, finally actionable at agent granularity.

---

## 3. Consumability

This is v24's spine (REQ-107 naming, REQ-108 surface collapse, REQ-116 guide, REQ-117 cold-model
first-try, REQ-118 interface conformance). Most of it is already well specified. **The one
architectural point that is not yet in the requirements and that I think decides whether REQ-117
passes:**

**C-1 — the guide must be RENDERED FROM what the engine enforces, from a single source of truth.**
Carried-in rule 4 says it plainly: v23 shipped an `AUTHORING.md` example the engine refused, caught
only because Gate 7.5 ran it. REQ-116 answers this with "a test registers every example". That is a
detector, not a preventer, and REQ-116 itself warns the guide "will carry many more examples than that
file did". The structural answer is that the guide's *facts* — the REQ-112 vocabulary constants, the
ceilings (`maxTimeoutMs` 600000, `maxAppendPromptBytes` 1024, `maxEffort` high), the six locked keys,
the typed-error catalog, the tool list — are **read from the same modules the validators read**, and
interpolated into the guide text at build or serve time. `diagram-gate.ts` already demonstrates this
exact discipline for v23: `VOCAB_GLYPHS` is "the ONE canonical declaration… every other consumer must
build off THIS array by interpolation, never re-type it." v24 should generalize that rule from one
array to the whole enforced contract. The example-registration test then guards only prose and code
samples, which is what a test is good at.

**C-2 — one typed-error module so every refusal points at the guide by construction.** REQ-116 asks
that a failed registration "points at this tool"; REQ-110 names `PARAM_OUT_OF_RANGE` / `PARAM_LOCKED`;
REQ-118 names `CHANNEL_UNPUBLISHED` / `BLOB_HASH_MISMATCH`. Proposal: a single error catalog of
`{ code, message, guidePointer }` (`src/errors.ts` already exists as its home), so the pointer cannot be forgotten on the next error added, and so
REQ-118's error-path exercises can assert against the catalog rather than against string literals. This
is the consumability equivalent of R-1's policy table.

**C-3 — REQ-110's refuse-never-clamp is a consumability decision, and should be recorded as one.**
A silent clamp is the classic "the caller learns nothing" failure; `PARAM_OUT_OF_RANGE` teaches the
ceiling on the first attempt, which is directly what REQ-117 measures. Worth stating because a future
reviewer will be tempted to "be helpful" and clamp.

**C-4 — REQ-118's `runnable` / `onlyRunnable` on `workflow_list` is the same principle applied to
discovery**: a `user` who can only run published workflows should not be shown drafts that will refuse.
Generalize: **every list surface should be filterable by what the caller may actually do with the
result**, since the role model (REQ-109) now makes "visible but unusable" a common state.

---

## 4. Self-sustainability

### System altitude

**S-1 — REQ-115's unclaimed-trigger refusal is an unbounded-growth design gap.** Literal reading: a
cron trigger created but never claimed fires every minute and produces **1440 refusal records per day**,
forever, in a growing table, for a trigger nobody is watching. Two candidate designs: (a) the scheduler
entry **pauses** while unclaimed — record the first refusal plus a `refusalCount`/`lastRefusedAt`
counter, stop re-firing until claimed; or (b) refusal records **coalesce per trigger** (one row,
updated counter). I flag this explicitly as a **tension with the requirement's own "never silently
dropped"** clause and do **not** resolve it here — (a) changes observable behaviour and is an owner
decision, not an architect's. Whichever is chosen, the counter is the read-back seam from O-2.

**S-2 — REQ-109 adds a `principals` config block, which walks straight into this project's documented
`composeConfig` wiring bug class.** The memory record is explicit: a new config block gets forgotten in
`composeConfig()`'s forward from `fileConfig`, the feature silently no-ops, and **only Gate 7.5's real
run catches it** — hit once in v11 (`updateFlagPath`) and once in v15 (auth). The guard is
`tests/unit/compose-config-v2-wiring.test.ts` (verified present). Requiring `principals` to be added to
that guard should be a **v24 acceptance item**, not a hope — and how the *missing* map is read is itself a
design decision that must be taken deliberately: an undefined `principals` map must resolve to
REQ-109's own `"*"` default of **`user`**, so an unwired block fails **closed and loud** — the operator
is locked out and notices in minutes — rather than open and silent, which is what "auth disabled means
everyone is `admin`" would produce if the two cases were conflated. The distinction matters because
`principals` absent (config never wired) and auth disabled (deliberate single-operator mode) are
different states that a naive read collapses into one.

**S-3 — REQ-113's per-workflow asset tree needs a migration plan, and it is not yet written.** Assets
move from a single global tree to `<workRoot>/<workflow>/assets/<kind>/<name>/`, owned by the
workflow's owner. Existing assets in the global tree are **owner-less**. Options: assign them to the
engine-level global tree as `builtin:true` (admin-owned), map them to workflows by usage, or delete.
ARCH-071 already set the precedent for how this project does migrations — **transactional and
idempotent**. I raise this as a risk to be decided at design, not as a decision.

**S-4 — a genuine self-sustainability gain: fewer autonomous moving parts.** Removing ARCH-079's
async single-flight analyzer, its `graphAnalyzer` config block (ARCH-085), the async generate/reconcile
machinery, the `diagramStatus` pending/unavailable states and `workflow_regenerate_diagram` removes a
subsystem that could fail asynchronously, cost money, and require its own reconciliation. Replacing a
model call in the registration path with a statically-decidable check makes registration **total** —
it always terminates with a verdict, needs no provider to be reachable, and cannot be degraded by a
gateway outage. That is a real reduction in the human-intervention surface and should be argued as a
v24 benefit, not just a deletion.

### Agent altitude

**S-5 — REQ-113's selective materialization is a self-sustainability fix disguised as a feature.** The
stated failure is that pre-v24 `materializeAssets` copied **every** skill in the tree into **every**
run, so "trigger-word collisions between unrelated skills grew with the number of authors" — i.e. agent
behaviour degrades monotonically as the system is used, with no human able to see why. Declared-only
materialization makes each agent's environment a function of its own declaration rather than of the
whole installation's history. This is the closest thing v24 has to "context hygiene", and it is worth
naming as such.

**S-6 — tool-liveness (probing that a provisioned MCP still works) is NOT in v24 scope.** REQ-113 gives
an author the ability to *discover* provisioned MCP servers for the first time, which is the
precondition for liveness checks, but nothing asks for probing. I name it as a future dimension gap
rather than smuggling it into this iteration's scope.

---

## key_points

1. **Every "…and it is recorded" clause in v24 needs a named read-back seam at design time.** REQ-114
   already does it right (write `pushedBy`, read it back via `workspace_list`) and is the standard for
   the other two: REQ-109 admin reads (durable row + `run_status` + dashboard) and REQ-115
   unclaimed-trigger refusals (counter on the trigger's own record, read back through `schedule_list` /
   `webhook_list` — **not** ARCH-078, which is keyed by workflow and cannot see an unclaimed trigger).
   This project has already graded write-without-readback as debt (AC-2 / ARCH-085).
2. **Per-agent harness descriptor** (extend ARCH-044/068): resolved model/effort/timeoutMs/appendPrompt
   *with provenance*, plus the **materialized** (not declared) asset list per agent. Without it,
   REQ-110 + REQ-113 make "why did this agent behave that way" unanswerable.
3. **One table-driven role policy consulted once before dispatch**, with a drift-lock over `tools/list`
   — not a check inside 40 switch arms (verified: 40 `case '` arms in `src/server.ts`, zero occurrences
   of `principals` in `src/`). Same shape as REQ-108's single shared path-verdict.
4. **Read REQ-111's "renders" as "parses under the fixed REQ-112 grammar".** Verified: no mermaid
   dependency; three runtime deps total. A restricted-grammar parser in the repurposed
   `diagram-gate.ts` is zero-dependency, statically decidable, and *stricter* than a renderer.
5. **The authoring guide must be rendered from the enforcement modules** (vocabulary, ceilings, locked
   keys, error catalog), extending the `VOCAB_GLYPHS` "one canonical declaration, interpolate never
   re-type" rule already in `diagram-gate.ts`. Example-registration tests then guard prose, not facts.
6. **A typed-error catalog `{code, message, guidePointer}`**, so REQ-116's "the error points at the
   guide" holds by construction for errors added after v24.
7. **REQ-110's refuse-don't-clamp and REQ-118's `onlyRunnable`** are consumability decisions worth
   recording explicitly, and generalize: list surfaces should filter by what the caller may actually do.
8. **`principals` must be added to `compose-config-v2-wiring.test.ts` as a v24 acceptance item**, and
   an undefined map must resolve to `user` (REQ-109's own `"*"` default) so an unwired block fails
   **closed and loud** — this config-forwarding bug class has bitten twice (v11, v15), and only a real
   run has ever caught it.
9. **Removing ARCH-079 is a double win** — one opaque agent gone (observability), one autonomous
   failure-prone subsystem gone and registration made total (self-sustainability).
10. **REQ-113's selective materialization is context hygiene**: it stops agent behaviour degrading as a
    function of unrelated authors' uploads.
11. **The client plugin's guidance skill (ARCH-013) is part of REQ-107's rename**, and where the
    diagram is *displayed* (ARCH-084) is unaddressed by any v24 requirement — both are named as risks
    below rather than solved here.

## risks

| # | Risk | Severity | Where it lands |
|---|---|---|---|
| QD-R1 | **Unbounded refusal records from an unclaimed recurring trigger** (1440/day for a cron). Literal REQ-115 has no bound. Pausing vs coalescing is an owner decision — it trades against "never silently dropped". | HIGH | REQ-115 |
| QD-R2 | **`principals` silently unwired in `composeConfig()`.** Same bug class as v11/v15, caught only by a real run. Whether it fails open (everyone admin) or closed (everyone `user`) is undecided because the code does not exist yet — it must be *designed* to fail closed via REQ-109's `"*"` default, and `principals` added to the wiring guard. | HIGH | REQ-109 |
| QD-R3 | **"Mermaid renders" taken literally** pulls a renderer + DOM shim into a 3-dependency server, adds boot cost and parser-quirk lock-in, and still under-enforces REQ-112 (a renderer accepts collapsed `A --> B & C` edges the vocabulary forbids). | HIGH | REQ-111/112 |
| QD-R4 | **Asset migration to per-workflow trees leaves existing global assets owner-less**; no migration plan yet. Precedent (ARCH-071) requires transactional + idempotent. | MID | REQ-113 |
| QD-R5 | **Role enforcement scattered across the dispatch switch** reproduces the `mcp_provision` "description says Admin, code checks nothing" bug at 36× scale, and a tool added later defaults open. | MID | REQ-109 |
| QD-R6 | **The guide drifts from the enforcement** as ceilings/vocabulary/errors evolve; REQ-116's example test catches invalid *examples*, not stale *facts* (a wrong `maxTimeoutMs` in prose registers fine). | MID | REQ-116/117 |
| QD-R7 | **Audit record with no reader.** If REQ-109's audit lands only in a log file, the requirement's own justification is unmet while the acceptance appears satisfiable. Tool-count pressure (40→36) actively discourages adding a reader tool. | MID | REQ-109 |
| QD-R8 | **REQ-118's conformance table decays** if hand-maintained; needs generation + drift-lock against `tools/list`, including UNVERIFIED rows. | LOW | REQ-118 |
| QD-R9 | **Declared-vs-materialized asset divergence becomes invisible** if the harness descriptor records the declaration instead of what was actually copied. | LOW | REQ-113 |
| QD-R10 | **No v24 requirement says where the author's Mermaid is DISPLAYED.** Verified: no renderer in `src/` or the dashboard. Via ARCH-084's `textContent`-into-`<pre>` path a user sees raw source (consumability regression vs the v21 ask); a client-side renderer is a new third-party surface fed author-controlled text containing `<br/>`. Owner decision, not an architect's. | MID | REQ-111/112, ARCH-084 |
| QD-R11 | **The client plugin's guidance skill (ARCH-013, separate repo) teaches the old tool names.** REQ-107 renames with no compat window, so a plugin still saying `workflow_run` hands a cold client unknown-tool errors — directly against REQ-117. Carried-in rule 3 applies to names, not only to checks: everything describing the old site moves with it. | MID | REQ-107/117 |

## expected disagreements with other lenses

- **vs. a simplicity / minimalism lens** — on QD-R3. They may argue "just shell out to mermaid-cli / add
  the dep, don't hand-write a parser; a bespoke grammar is new code to maintain." My counter: REQ-112
  already *fixes* the vocabulary, so the grammar is small and closed; a renderer accepts diagrams the
  requirement forbids, so it is the wrong oracle regardless of cost; and `diagram-gate.ts` already
  exists to be repurposed. Expect a real fight here — it is the sharpest disagreement I hold.
- **vs. a security lens** — on REQ-109 audit *placement*. Security will likely want the audit in a
  tamper-evident, append-only sink that the audited principal cannot read. I want it visible on
  `run_status` for the owner of the run being read. These are compatible (owner-visible ≠
  admin-writable) but the design must reconcile them rather than pick one.
- **vs. a data/persistence lens** — on QD-R1. They may prefer a retention/TTL sweep over refusal rows
  (this project already has ARCH-022 TTL GC) rather than changing scheduler behaviour. I think GC hides
  the design smell — an unclaimed trigger firing forever is the defect — but I concede GC is the lower-risk
  patch and the owner may prefer it.
- **vs. a delivery / scope lens** — on the guide-rendered-from-enforcement proposal (C-1). It will read
  as gold-plating against a requirement that already has a test. I argue it is the *only* structural
  answer to carried-in rule 4, and REQ-117's "first try, no trial and error" acceptance has no margin
  for a stale ceiling in prose.
- **vs. a testing lens** — they may claim REQ-118 already delivers the observability of the tool
  surface. I claim REQ-118 observes the *interface* and says nothing about run-time internal state
  (O-4's per-agent resolved params); the two are complementary and neither substitutes for the other.
- **vs. an integration / packaging lens** — on QD-R11. They may hold the plugin repo out of scope
  because it has no SDLC ledger of its own. I hold that REQ-117's acceptance is measured on what a cold
  client actually sees, and a cold client sees the plugin — so the rename is not finished at the engine
  boundary, and REQ-118's table should include at least one plugin-sourced call.
- **vs. any lens proposing agent self-reflection / memory compression** — I explicitly argue that
  altitude is out of scope for v24 (bounded, journalled runs; no resident memory) and that adding it
  would be scope invention rather than a quality improvement.
