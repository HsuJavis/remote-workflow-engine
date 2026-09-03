# Gate 8 review — Quality-dimensions lens (v23)

**Scope.** Gate 2 decisions `ARCH-077..086` / `ADR-015..022` (`02-architecture.md:1356-1838`) vs the
implementation recorded in `06-impl-log.md` `IMPL-159..174` (TASK-113..127). Code read: only the files
named on those IMPLs' `files:` lines plus their direct module-boundary references —
`src/diagram-gate.ts`, `src/trigger-bindings.ts`, `src/graph-analyzer.ts`, `src/workflow-catalog.ts`,
`src/workflow-view.ts`, `src/mcp-facade.ts`, `src/server.ts`, `src/main.ts`, `src/dashboard-page.ts`,
`src/gateway/claude-agent-sdk-client.ts`, `src/gateway/litellm-proxy.ts`, `rwe.config.example.json`,
`DEPLOY.md`, `docs/AUTHORING.md`, and the guard tests. Line numbers were re-verified against HEAD
(`d294880`), not taken from the architecture doc's own citations.

**Residuals NOT filed as findings** (recorded decisions, not deviations): `owner` served to every
principal; no analyzer rate limiter / S-1 cost risk; a secret in a phase name passing the gate; the
dashboard losing its predicted-DAG preview until a diagram is `ready`; `/skeleton` disappearing as a
breaking change; `gateFail` as a 10th journal field and the struck "provider HTTP status" clause
(both explicitly ratified by DES-129, which overrides ARCH-079 invariant 4/5 in writing).

**Verdict: NOT consistent — 7 deviations (2 HIGH, 3 MEDIUM, 2 LOW).**

| id | dimension | ARCH/ADR | severity |
|---|---|---|---|
| SUS-1 | Self-sustainability | ARCH-085, DES-134 | HIGH |
| SUS-2 | Self-sustainability | ARCH-079 inv 2, ADR-017 | HIGH |
| REP-1 | Replaceability | ARCH-080 | MEDIUM |
| CONS-1 | Consumability | ARCH-082, ARCH-051 | MEDIUM |
| SUS-3 | Self-sustainability | ARCH-084 | MEDIUM |
| OBS-1 | Observability | ARCH-079 inv 6, ARCH-081 | LOW |
| OBS-2 | Observability | ARCH-077 inv 7, ADR-021 | LOW |

---

## 1. Observability — transparency of internal state (incl. traceability)

### What was checked and is CLEAN

- **The journal line** (`graph-analyzer.ts:287-296`) carries ARCH-079 invariant 5's nine pinned fields
  plus `gateFail`. `gateFail` is a closed engine enum (`diagram-gate.ts:26`), and DES-129
  (`04-design.md:4123`) ratifies both its addition and the striking of the "provider HTTP status"
  clause — so neither is a deviation. **No raw provider or model text reaches the line**: the
  `catch` at `graph-analyzer.ts:263-267` deliberately discards the thrown error rather than reading
  `.message` (ADR-016), and `tests/unit/graph-analyzer.test.ts:369` pins that with a secret-bearing
  upstream error.
- **`noteCode` is a closed, engine-authored enum end to end**: 10 values typed at
  `graph-analyzer.ts:17-21`, the 8 persisted ones re-asserted as a SQL `CHECK` at
  `workflow-catalog.ts:240-241`, and user-facing text rendered only from `NOTE_TEXT`
  (`graph-analyzer.ts:51-66`). `GATE_REJECTED_CONTENT` and `GATE_REJECTED_SHAPE` remain distinct
  (ARCH-080's split reason code), and `gateFail` gives the sub-reason without ever naming the
  rejected token.
- **`enabled:false` → honest absence, never an error**: `projectWorkflowDescribe`
  (`workflow-view.ts:130-138`) synthesizes `DISABLED` vs `NOT_GENERATED` at read time and never
  persists either; boot emits the missing-diagram count plus the exact recovery command
  (`server.ts:1521`).
- **`diagramStale`** is the one `sha256` compare ARCH-081/ADR-019 promised (`workflow-view.ts:159`),
  fed by the *live* snapshot recomputed per describe call (`mcp-facade.ts:435`), and it is `false`
  unless the row is `ready` (`workflow-view.ts:127/159`) so absence never reads as staleness.
- **The wiring-gap signal exists**: `graphAnalyzer.model` is on the journal line per run, which is
  ARCH-085's substitute for the effective-config readback surface it deliberately did not build.

### OBS-1 — LOW — the architecture's allowlist and describe field lists were never amended for adjudications #1 and #7

**Violated:** ARCH-079 invariant 6 (`02-architecture.md:1402`), ARCH-081 `api:`
(`02-architecture.md:1425`), and the v23 interface & API contracts table
(`02-architecture.md:1692`).

ARCH-079 inv 6 states the allowlist is `parseWorkflowSkeleton(script)` ∪ resolved model aliases ∪
ARCH-078's trigger kinds/upstream ∪ `DIAGRAM_CODEPOINTS`. The implemented `_buildAllowlist`
(`src/graph-analyzer.ts:225-247`) adds **four members ARCH-079 does not name** — `meta.phases[].title`
(`:231`), the literal `'default'` (`:233`), the sentinel `'model:param'` (`:234`), and
`UNBOUND_ENTRY_LABEL` (`:241`) — and **omits `DIAGRAM_CODEPOINTS`**, which the gate checks in its own
separate pass (`diagram-gate.ts:39-43`) and which is not a label token at all.

Likewise ARCH-081 pins `projectWorkflowDescribe` as "emitting exactly {name, version, resolvedBy,
channels, versions, description, params, lockedKeys, owner, reportProblem, triggers, diagram,
diagramStatus, diagramNote, diagramGeneratedAt, diagramStale}" — with no `phases`. The implementation
emits `phases` (`src/workflow-view.ts:94`, `:147`; `EXPECTED_DESCRIBE_KEYS` `:113`) per adjudication #1
/ DES-136 / IMPL-170. The interface table row for `workflow_describe` omits it too.

Both deltas are correct in code and correctly recorded in `04-design.md` (DES-131, DES-125:4078) — the
defect is that `02-architecture.md` still describes the pre-adjudication shape. This matters more than
ordinary doc drift **because ADR-015's whole security claim is "every token the diagram may contain is
already served on a masked surface today"**, and ARCH-079 inv 6 is where a future reader checks that
claim's membership list. A reader auditing the gate against the architecture would conclude the engine
admits four tokens it is not architecturally permitted to admit.

**Remedy:** amend ARCH-079 inv 6 and ARCH-081/the interface table in place, citing adjudications #1
and #7. No code change.

### OBS-2 — LOW — ARCH-077/ADR-021 still assert a deletion path that does not exist

**Violated:** ARCH-077 `api:`/invariant 7 (`02-architecture.md:1383/1384`), ADR-021
(`02-architecture.md:1508`).

ARCH-077 states "`deregister()` **and the `maxWorkflowVersions` prune** each delete this
name's/version's diagram rows inside their existing `db.transaction()`", and ADR-021 repeats "must be
deleted when its version is **pruned** or the workflow deregistered".

There is no prune. `maxWorkflowVersions` *refuses* the registration
(`src/workflow-catalog.ts:445`, `VERSION_CEILING_EXCEEDED`; ADR-014), and the implementation says so
explicitly at `src/workflow-catalog.ts:231-233`: "no prune hook, sweep, GC or orphan-reaper exists
(ARCH-077's `maxWorkflowVersions` prune does not exist — the ceiling refuses registration, ADR-014)".
DES-130 (`04-design.md:4152`) already struck the clause at design level; ARCH-077/ADR-021 were never
amended.

The code is right and the derived-store invariant is genuinely enforced (single deletion path at
`workflow-catalog.ts:488-490`, inside the same `db.transaction()`; plus the late-write guard at
`:265-289`). Only the architecture text is wrong.

**Remedy:** strike the prune clause from ARCH-077 and ADR-021. No code change.

---

## 2. Replaceability — decoupling & pluggability

### What was checked and is CLEAN

- **ARCH-085's definition of done, items (1) and (2), both present.** `graphAnalyzer` is forwarded as
  a whole object in the `composeConfig()` literal (`src/main.ts:184`) and three rows were added to
  `tests/unit/compose-config-v2-wiring.test.ts:193/202/207` — including the `enabled:false` and
  omitted-block cases. This is the repo's signature bug class (v11 `updateFlagPath`, v15 `auth`,
  v16 `workspaceTtlMs`) and it is closed on both halves; item (3) is the Gate 7.5 real run.
- **No analyzer harness value is hard-coded in engine source** (REQ-104): all nine keys default at
  exactly one site (`src/server.ts:1472-1482`) and every one is operator-overridable, including
  `maxBytes`/`maxLines`/`maxQueueDepth`, which the gate takes as a required `limits` parameter
  (`diagram-gate.ts:31`) rather than owning defaults of its own.
- **The LLM backend is a config change, not a rewrite.** The analyzer takes the existing
  `GatewayClient` interface (`graph-analyzer.ts:94`), `graphAnalyzer.model` is an alias from the same
  table `agent()` uses and is validated with the shared `isKnownAlias` (`server.ts:1492`), and the
  composition root falls back to a real `LiteLLMGatewayClient` on the zero-config path
  (`server.ts:1493-1494`) rather than a narrower ad hoc shape.
- **IMPL-162 holds:** `curateToolsForProvider` returns `[]` for an intentionally-empty set instead of
  Bash-augmenting it (`src/gateway/claude-agent-sdk-client.ts:225`).
- **IMPL-174 holds:** `UNBOUND_ENTRY_LABEL` has exactly one declaration
  (`src/trigger-bindings.ts:29`), consumed by both `describeTriggerBindings` (`:74`) and
  `_buildAllowlist` (`graph-analyzer.ts:241`).

### REP-1 — MEDIUM — `DIAGRAM_CODEPOINTS` has one consumer, not the three ARCH-080 makes load-bearing; the glyph vocabulary is hand-copied at three sites

**Violated:** ARCH-080 `api:` and note (`02-architecture.md:1409/1411`).

ARCH-080 specifies `DIAGRAM_CODEPOINTS` as an "exported constant … with **exactly three consumers** —
this gate, the shipped default `graphAnalyzer.systemPrompt`, and the AUTHORING/tool-description text",
and names that single-declaration rule as the control over both failure directions: "too restrictive
and someone later 'fixes' it with a naive strip-non-ASCII that destroys the vocabulary. **One exported
constant with three named consumers is what stops both.**"

In the implementation the constant has **one** consumer — its own gate:

- `src/diagram-gate.ts:5` declares `VOCAB_GLYPHS` (13 glyphs) and `:22` exports
  `DIAGRAM_CODEPOINTS` built from it.
- `grep -rn DIAGRAM_CODEPOINTS src/` returns hits only inside `diagram-gate.ts` plus a **comment** at
  `src/server.ts:300` that claims to be a consumer: *"the shipped default `graphAnalyzer.systemPrompt`
  — the third consumer of DIAGRAM_CODEPOINTS"*. Nothing is imported.
- The shipped default prompt re-types all 13 glyphs as prose literals
  (`src/server.ts:306-311`: `╭ ╮ ╰ ╯`, `◇`, `⟲`, `─ │ ┬ ┴ ├ ┤ ▶`).
- `rwe.config.example.json:59` re-types the same 13 glyphs a **third** time, in an operator-facing
  file ARCH-080 does not even enumerate as a consumer.
- The tool-description/AUTHORING text (`src/server.ts:296`, `docs/AUTHORING.md`) carries no glyph
  vocabulary at all — `grep` for the glyphs in `docs/AUTHORING.md` returns nothing — so the third
  named consumer is absent rather than duplicated.

The three copies agree today; nothing keeps them agreeing. **This is the exact defect class
adjudication #7 / IMPL-174 just paid to fix one file away**: two independently-typed copies of the
unbound entry label disagreed, the engine instructed a token its own gate refused, and every first
diagram was lost. The vocabulary is the *same* engine-instructs / engine-validates pair, with three
copies instead of two — and `08-validation.md`'s round-3 table shows the live failure mode is precisely
`GATE_REJECTED_SHAPE`/`gateFail:"codepoint"`, i.e. prompt-vocabulary vs gate-vocabulary disagreement.
Replaceability cost: swapping to a model class that needs a vocabulary edit (ARCH-085's own documented
`qwen2.5:7b` case) is a three-place hand-synchronised change with no test tying them together.

**Remedy (small):** export the ordered glyph list from `diagram-gate.ts` (e.g.
`export const DIAGRAM_VOCABULARY = VOCAB_GLYPHS`), interpolate it into
`DEFAULT_GRAPH_ANALYZER_SYSTEM_PROMPT`, and add one assertion that every glyph named in the shipped
prompt and in `rwe.config.example.json`'s `systemPrompt` is a member of `DIAGRAM_CODEPOINTS` — the
same shape as the `ANALYZER_SCRATCH_SUBDIR` / `UNBOUND_ENTRY_LABEL` one-declaration rule this file
already applies twice. Then correct or delete `server.ts:299-300`'s false "third consumer" comment.

---

## 3. Consumability — ease of use & low integration cost

### What was checked and is CLEAN

- **`script` is absent from the type, so a leak is a `tsc` error**: `WorkflowDescribeView`
  (`src/workflow-view.ts:87-105`) has no `script` field, and the projection is constructed field by
  field (`:140-160`), never a `delete` over a full row.
- **The two-sided oracle exists**: `EXPECTED_DESCRIBE_KEYS` (`workflow-view.ts:110-117`) is
  transcribed from the type in the module under test, so both a leaked field and a dropped
  `lockedKeys`/`diagramStatus` fail. `lockedKeys` is imported from `params/contract.js` (`:149`),
  never re-typed.
- **One projection, two call sites** (ARCH-081/083): the MCP tool (`mcp-facade.ts:437`) and
  `GET /api/workflows/:name/describe` (`server.ts:1173-1183`) return the identical object, the route
  unwrapping to `result`. Version resolution reuses `resolveVersionRequest` via `catalog.resolveDetail`
  (`mcp-facade.ts:415/421`), so `CHANNEL_UNPUBLISHED`/`UNKNOWN_VERSION` are byte-identical with
  run-admission's.
- **`workflow_regenerate_diagram` is the fourth call site of the shared helper**, not a
  re-implementation: `resolveWritePrincipal` + `principalRequiredEnvelope()` at
  `src/server.ts:979-982`, matching register/deregister/publish exactly, with `NOT_WORKFLOW_OWNER` and
  `ANALYZER_DISABLED` in the facade (`mcp-facade.ts:459-465`).
- **REQ-105's deletion is mechanically guarded**: `tests/unit/no-skeleton-surface.test.ts:36` pins an
  exactly-four allowlist (`workflow-meta.ts`, `dashboard.ts`, `server.ts`, `graph-analyzer.ts` — the
  fourth added by adjudication #3), `:61` fails a fifth entry, and `:64-75` asserts the word appears in
  no advertised tool description or input schema. `/api/runs/:id/dag` keeps its auth-gated skeleton
  spine untouched (`server.ts:1219-1224`), so v22 finding H2 stays closed.
- **`phases` is public on the describe surface** per adjudication #1 (`workflow-view.ts:94/147`).

### CONS-1 — MEDIUM — neither new tool joined ARCH-051's structured drift-lock, and REQ-101's last clause is asserted nowhere

**Violated:** ARCH-082 note (`02-architecture.md:1429`) — "**Both new tool schemas join ARCH-051's
structured drift-lock test.** REQ-101's last clause — a schema-only MCP client must learn from the
description alone what the tool returns *and that the script is deliberately not among it* — is a
property of the advertised schema, **and the drift-lock is where that becomes a test rather than a
hope**." Also ARCH-086 (`:1465`) for the same test.

The advertised schemas themselves are good: `workflow_describe`'s description (`src/server.ts:493`)
enumerates every returned field and states "The raw workflow script is deliberately NOT part of this
response, on any principal"; `workflow_regenerate_diagram`'s (`:507`) names its errors.

The **test** does not exist:

- `tests/integration/mcp-tools-list-schema.test.ts:28-39` — the ARCH-051 drift-lock's named-tool list
  (`REQUIRED_TOOLS`) contains ten tools and **neither** `workflow_describe` nor
  `workflow_regenerate_diagram`. The only per-tool assertions that reach them are the two generic
  loops ("description is not just the tool's own name", "inputSchema has non-empty properties"), which
  a one-word description would pass.
- `tests/integration/v14-schema-drift.test.ts` and `tests/integration/seedref-schema-drift.test.ts`
  do not mention either tool.
- `grep -rn "deliberately NOT" tests/` returns no hit against `workflow_describe` — the single
  sentence that carries REQ-101's last clause is unpinned. Deleting it from `server.ts:493` turns
  nothing red.
- `tests/unit/no-skeleton-surface.test.ts:64` asserts what the schema must **not** say ("skeleton");
  nothing asserts what it **must** say.

So the one architectural guarantee for a schema-only cold client — the premise ARCH-086 calls "the
load-bearing half" — rests on review discipline, which is the exact thing ADR-022 records as having
failed nine times in this ledger.

**Remedy:** add both tools to `REQUIRED_TOOLS`, plus one assertion that `workflow_describe`'s served
description contains the script-absence sentence and names `diagramStatus`/`triggers`/`lockedKeys`
(the same shape as the existing `workflow_register.script` DSL-contract row at `:62-84`).

---

## 4. Self-sustainability — closed-loop autonomy & lifecycle management

### What was checked and is CLEAN

- **The derived store cannot outlive its source**: `deregister()` deletes `workflow_diagrams` rows
  inside its existing transaction (`src/workflow-catalog.ts:488-490`), and the late-write guard
  (`:265-289`, `.immediate()`) makes the reverse ordering — a job settling after deregister commits —
  a silent no-op instead of an immortal orphan. Schema `CHECK`s make "unavailable with a diagram
  present" unrepresentable (`:239`).
- **Registration never blocks and never fails on the analyzer**: `enqueue` returns after the pending
  write (`graph-analyzer.ts:131-146`) and the `callTool` seam ignores its outcome entirely
  (`server.ts:953-956`). Single-flight is keyed `name@version` (`:132-133`), and a full queue settles
  `QUEUE_FULL` rather than erroring (`:139-142`).
- **A failure never clobbers a prior `ready` row** (DES-127 B5): both the settle path (`:196-197`) and
  the job path (`:327-332`) restore the prior row.
- **IMPL-172's zero-config fail-closed guard is real**: with no resolvable `workRoot` the analyzer's
  `tools` is forced to `[]` regardless of config, with a boot line saying why
  (`src/server.ts:1471/1476/1483-1485`) — ADR-020's blast-radius default holds even on the path where
  `main.ts:216` leaves the SDK gateway's `cwd` unset.
- **The renderer is safe for model-authored text** (ARCH-084): the diagram goes into a `<pre>`
  (`src/dashboard-page.ts:175`) via `pre.textContent = s.diagram` (`:219`), never `innerHTML`, with
  `<`/`>`/`&` additionally subtracted from `DIAGRAM_CODEPOINTS` upstream (`diagram-gate.ts:11`).
- **Adjudication #6 V-2 is fixed** in `src/gateway/litellm-proxy.ts:171-188`: the spawn `'error'`
  listener is attached before the health poll so a missing `litellm` binary can no longer take the
  engine down.

### SUS-1 — HIGH — `graphAnalyzer.enabled:false` does not stop the boot sweep from making a model call, so the operator's only script-egress control leaks on the restart path

**Violated:** ARCH-085 (`02-architecture.md:1456`) — "**`enabled: false` is a first-class, tested
state**" — and DES-134 (`04-design.md:4198`), which names `enabled:false` as **the existing control**
for the fact that "registration now performs an outbound LLM call whose payload is the workflow script
itself … an operator can only choose it if told".

`GraphAnalyzer.sweepAtBoot()` (`src/graph-analyzer.ts:165-192`) never reads `this._config.enabled`.
Its first branch — a `pending` row with `generated_at IS NULL`, i.e. a crash mid-generation — calls
`_startJob` (`:175-179`), which schedules a **real `gateway.invoke()`** carrying the workflow script
(`:256-262`, `:310-311`). `server.ts:1505` calls it unconditionally, and the comment there
(`:1502-1504`) states the intent explicitly: "unconditional … `enabled:false` only gates the two call
sites below that would otherwise start a NEW job". But the sweep's requeue *is* a new job with a new
model call; only the sweep's **second** branch (`:180-188`) is the zero-model-call settle.

Concrete failure: an operator running with the analyzer enabled accumulates a `pending` row (a crash,
a SIGTERM while a job is queued). They then set `graphAnalyzer.enabled:false` — plausibly *because*
they have just learned from DEPLOY.md that registration ships the script to the provider — and
restart. Boot sweeps the row, sends that script to the configured provider anyway, and the operator's
one documented control silently did not apply. On the shipped zero-config path the provider is a local
LiteLLM/Ollama, but nothing in the design assumes that, and the whole point of the DES-134 sentence is
the deployment where it is not.

Secondary effect, same root: with `enabled:false` the facade refuses `workflow_regenerate_diagram`
(`mcp-facade.ts:462-464`), so the row the sweep just started a job for has no owner-facing recovery
action if that job then fails — ADR-017's closed loop is open in exactly this configuration.

**Remedy:** gate only the requeue branch on `enabled`. Keep the sweep unconditional (a prior life's
pending row must still settle), but when `!this._config.enabled`, settle the `generated_at IS NULL`
branch to `unavailable/RETRIES_EXHAUSTED` with zero model calls instead of calling `_startJob` — the
same treatment the second branch already gets. One `if`, plus a unit row asserting the gateway is
never invoked when `enabled:false`.

### SUS-2 — HIGH — an exception inside a scheduled job escapes as an unhandled rejection and permanently wedges the concurrency-1 slot

**Violated:** ARCH-079 invariant 2 (`02-architecture.md:1402`) — "Single-flight, `concurrency: 1`,
with a bounded queue depth … when the queue is full the job is not run and the row settles
`unavailable/QUEUE_FULL`, which is honest absence working as designed" — and ADR-017's closed-loop
claim that `pending` always settles. Also this lens's own rule: a silent, opaque failure is a design
defect.

There is **no `try`/`catch`/`finally` anywhere on the job path.** The job closure
(`src/graph-analyzer.ts:209-212`) is `async () => { const script = await scriptPromise; await
this._runJob(...) }`, and the production scheduler discards its promise:
`setImmediate(() => { void job(); })` (`:127`). The slot and single-flight key are released only on
the *normal* fall-through at `:337-338` — which does cover all three handled settle branches (ready /
prior-restore / unavailable), but sits after every statement that can throw, so an exception skips it
entirely.

Two reachable throw sources, neither covered:

1. **A rejected `scriptPromise`.** `sweepAtBoot` builds it as
   `this._catalog.resolve(name, { version }).then((e) => e.script)` (`:177`); `resolve` throws for a
   missing name/version. `putDiagramPending` (`workflow-catalog.ts:249-258`) has **no** version-
   existence guard (unlike `putDiagramResult`), so an `enqueue` racing a `deregister` leaves a
   `pending` row whose version row is gone — and that row is exactly what the next boot sweeps.
   Note the author *did* guard the analogous path in `regenerate` (`:160`, `.catch(...)`) and did not
   guard this one. When more than one row is swept, the surplus jobs are queued (`:214`) with their
   rejected promises unattended, so the rejection surfaces with no handler at all.
2. **A throw from `_runJob`'s own store calls** — `getTriggerBindings` (`:304`) reads three separate
   SQLite files, and `putDiagramResult` (`:326/329/334`) takes a write lock with `.immediate()` on a
   database the design itself notes two processes can contend for.

Consequences, in order of severity:

- **Process death.** `void job()` leaves the rejection unhandled; Node's default
  `--unhandled-rejections=throw` terminates the process, and `grep -rn "unhandledRejection" src/`
  returns nothing. This is the same class as adjudication #6 V-2, which was filed and fixed one
  iteration ago for `litellm-proxy.ts` with the words "takes the ENGINE down" — the analyzer's own
  scheduler carries the identical unguarded shape.
- **Permanent subsystem wedge if the process survives** (a host with a rejection handler, or a throw
  that happens to be swallowed): `_runningCount` stays at 1 and the key stays in `_pendingKeys`
  forever. Every later `enqueue` is queued (`:213-214`) and never drained; after `maxQueueDepth`
  (default 8) all further registrations settle `QUEUE_FULL` (`:139-142`) — an "honest absence" note
  that is a *lie*, because the queue is not full, it is dead. The 8 queued rows stay `pending`
  forever, and the only recovery is a restart.
- **No observability of either.** `_attempt`'s journal line is the analyzer's only signal and it is
  never reached on this path: no journal line, no `noteCode`, no boot line — the exact opaque failure
  ARCH-079 invariant 4/5 built the journal line to prevent.

**Remedy:** wrap the job body in `try { … } catch { settle unavailable + emit the journal line with
an engine-classified code } finally { release the key, decrement the slot, drain the queue }`, and
attach a `.catch()` at the `setImmediate` site (`:127`) so the default scheduler can never produce an
unhandled rejection. Move the `:337-343` release block into the `finally`. Add a unit row where
`putDiagramResult` throws and assert the *next* enqueued job still runs.

### SUS-3 — MEDIUM — the home-card mini-preview was not removed; it still fetches `/describe` per card per 3s tick and discards the response

**Violated:** ARCH-084 (`02-architecture.md:1447`) and the v23 interface table's dashboard row
(`:1699`) — "the home-card skeleton mini-preview is **removed**, with no substitute drawing";
DES-133 (`04-design.md`) — "drops its skeleton fetch and renders **nothing**".

`renderMiniPreviewAsync` (`src/dashboard-page.ts:227-231`) survives as a function whose entire body is
a fetch whose callback returns immediately:

```js
function renderMiniPreviewAsync(card,name){
  getJSON('/api/workflows/'+encodeURIComponent(name)+'/describe').then(function(s){
    if(!s||!s.diagram) return;
  });
}
```

It is still called per card (`:243`), inside `renderHomeGroup`, which `loadHome` re-runs for all three
groups (`:298-300`) on every tick of the single `setInterval(render, 3000)` (`:496`, via `:492`'s
else-branch). So an open dashboard on the home view issues **one `/api/workflows/:name/describe`
request per registered workflow every 3 seconds — 20N requests per minute — and throws every response
away.** That route is not cheap: each call runs `catalog.resolveDetail`, `parseMeta`,
`validateCurrent`, `getDiagram`, and `getTriggerBindings` across three separate SQLite files plus a
`RunStore` join per pending continuation (`mcp-facade.ts:411-437`, `trigger-bindings.ts:45-59`).

The comment at `:224-226` documents the intent honestly ("renders nothing, whether or not a diagram
exists") but the deletion was left half-done — the ledger's single most-repeated defect class, which
ADR-022 built a CI grep guard for on the *skeleton* word specifically; that guard does not catch a
dead call site whose name no longer contains it.

**Remedy:** delete `renderMiniPreviewAsync` and its call at `:243`. Nothing else reads it.

---

## Summary for the integrator

- **Fix before Gate 8 closes:** SUS-1 (one `if` in `sweepAtBoot` + a unit row), SUS-2
  (`try/catch/finally` + a `.catch()` at the scheduler, + a unit row), SUS-3 (delete two lines).
- **Fix in this iteration:** REP-1 (export the vocabulary, one membership assertion, correct the false
  comment at `server.ts:299-300`), CONS-1 (two names in `REQUIRED_TOOLS` + one description assertion).
- **Doc-only amendments:** OBS-1, OBS-2 — both are ARCH text that DES and code already corrected;
  amend in place with the adjudication citation, no code change.
