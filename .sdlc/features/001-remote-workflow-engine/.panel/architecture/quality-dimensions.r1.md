# Quality-Dimensions Panel — Architecture, **Gate 2 RE-RUN #2**, Round 1 (v23)

> **This file replaces the previous Gate-2-re-run content of the same name** (written for the
> `d294880` send-back; preserved in git at `41e6382`). This round is the **Gate 2 re-run demanded by
> `07-review.md` §"v23 GATE 8 RE-REVIEW #1" (2026-09-03, HEAD `41e6382`)**, which returned
> `send_back = ["architecture","tests","impl"]`, `arch_consistent: false`, **1 HIGH · 4 MED · 4 LOW**.
>
> **Scope discipline, taken from the reviewer's own rule and binding on this panel too:** *"Scope:
> verify the fixes, not re-open v23 — every item previously dispositioned and unchanged is left as it
> was ruled."* Therefore **new content in this proposal = §8's Gate-2 line only** — **R-3**, **R-2b /
> OBS-2**, **R-6**, **CONS-1**, and the interface-table journal row's self-contradiction — plus the
> architecture-side ruling each of them needs so Gates 5 and 6 inherit a decision instead of
> re-deriving one. Everything else previously dispositioned is listed in §6 as *holds, unchanged*, in
> one line each, and is **not** re-litigated.
>
> **Round**: 1 (independent proposal — written without reading this round's sibling `adversarial.r1`).

**Lens**: Observability · Replaceability · Consumability · Self-sustainability. All four sections are
present and carry substance; §5's "holds unchanged" items are stated as findings, not as an excuse for
an empty section.

**Citation provenance.** Every `file:line` below was re-read against the working tree **this round**:
`src/graph-analyzer.ts:100-400` (whole class), `src/server.ts:945-960`, `:1464-1516`,
`src/main.ts:184`, `tests/unit/compose-config-v2-wiring.test.ts:196`;
`02-architecture.md:555`, `:1403` (ARCH-079's note, all eleven invariants, read in full), `:1451-1457`
(ARCH-085), `:1611` (process-view mermaid note), `:1708` (interface table journal row);
`07-review.md:7-286`. **Carried, not re-read this round** (taken from the Gate 8 review, which states it
re-verified each at HEAD `41e6382`): the test-file internals — UT-125's shipped assertions (a)/(c) at
`tests/unit/graph-analyzer.test.ts:703-743`, UT-124's three-entry-point coverage, UT-128's named debt at
`:497-501` — and `workflow-view.ts:133-146`.

---

## 0. Altitude determination (answered before anything else, as instructed)

**Both — and for every item this re-run owns, the AI-agent altitude is the operative one.**

- **Plain-system substrate** (from `state.yaml.tech_stack`): Node 22.6+ / TypeScript strict ESM;
  hand-rolled JSON-RPC-over-HTTP MCP server (`src/server.ts`, deliberately **not**
  `@modelcontextprotocol/sdk`); SQLite via `better-sqlite3` (RunStore, WorkflowCatalog, and v23's
  `workflow_diagrams`); a browser dashboard; OAuth2 authorization-server; systemd deployment. System
  altitude applies to all four dimensions here.
- **Agent altitude, user-workload tier** (REQ-001..020): `agent()` calls inside user-authored
  workflow JS, behind two interchangeable `GatewayClient` implementations
  (`LiteLLMGatewayClient`, `ClaudeAgentSdkGatewayClient`) fronting Anthropic / OpenAI / Gemini /
  Ollama. This is the textbook replaceability case and it is already solved.
- **Agent altitude, engine-internal tier — new in v23 and the reason this altitude dominates**:
  REQ-102/104 put an **LLM agent inside the engine's own control plane**. `GraphAnalyzer`
  (`src/graph-analyzer.ts`) is invoked from the *registration request path* (`server.ts:955-957`) and
  from the *boot path* (`server.ts:1507` `sweepAtBoot()`). It is deliberately **transcript-less**
  (ADR-016: it never goes through `AgentExecutor`, so REQ-100's script mask cannot be side-stepped
  through `workflow_agent_log`).

That last bullet is the ruling that drives §1: **the engine's own agent is, by design, exempt from the
per-agent observability surface every other agent in this product enjoys (REQ-007).** Its *only*
observable seam is the single journal line pinned by ARCH-079 inv 5. When a lens whose first rule is
"a silent/opaque failure is a design defect" meets a subsystem whose transcript was removed on purpose
for a good security reason, the consequence is not "add the transcript back" — it is that **the one
remaining seam is load-bearing and must be structural, not disciplinary**. Every observability finding
below is an application of that single sentence.

---

## 1. OBSERVABILITY — transparency of internal state (incl. traceability)

### QD-O1 — **R-2b / OBS-2 DECISION: keep inv 5's "one line per SETTLE"; make it structural by fusing the terminal-row write and the journal emit into ONE seam; delete the `_attempt` emitter.** (MED, the item Gate 2 owes)

The reviewer put the choice honestly: *move the emitter, or amend inv 5 to ratify per-attempt lines
plus a settle line*. **This lens proposes the first, and would be contradicting its own ratified
position to propose the second** — "one line per settle" is this lens's r2 §1.1 text, adopted over
adversarial §5.4 by referee call R-1 (`02-architecture.md:1883`) one round ago. Nothing found this
round weakens it; what was found is that the *implementation* kept the old emitter and added no new
one.

**Verified state at HEAD**: `_journal` is called from `_settleUnavailable:212` **and `_attempt:339`**.
Terminal `workflow_diagrams` rows are written at **four** sites — `_settleUnavailable:206` and
`_runJob:376` (ready) / `:378-383` (B5 prior-ready restore) / `:385` (unavailable). Three of those four
row-writes are not co-located with any emit; the one emitter that does fire on the `_runJob` paths
fires *inside the attempt*, before the row is chosen.

**Proposed amendment to inv 5 (text, for the amending editor):**

> The emitter and the terminal-row write are **the same operation**. `GraphAnalyzer` exposes one
> private settle seam — `_settle(name, version, row, journalFields)` — which performs
> `catalog.putDiagramResult(...)` and then `_journal(...)`, in that order, and it is the **only** place
> either call appears. `_attempt` returns its outcome and emits nothing. "Exactly one journal line per
> settle" is then a property of the call graph (one caller of `putDiagramResult`, one caller of
> `_journal`), not a discipline four sites must remember — the same reason `VOCAB_GLYPHS`,
> `UNBOUND_ENTRY_LABEL` and `ANALYZER_SCRATCH_SUBDIR` each have exactly one declaration.

Two sub-decisions, settled here so Gate 6 does not have to guess:

- **(a) Fields under `retries > 0`.** The four model-call-only fields aggregate across the attempts of
  the settle: `promptTokens` / `completionTokens` are **sums**, `durationMs` is the **total** wall
  clock of all attempts, `gateFail` is the **last** attempt's. Aggregation is the honest answer to the
  S-1 cost risk ARCH-079's closing paragraph records — one line per settle whose token numbers are one
  attempt's is a cost report that under-reports by design. `cause` carries the attempt count
  (`"attempts=2; last=gateway_terminal"`). *Fallback for the referee, named because it is defensible:*
  a twelfth field `attempts:number` instead of encoding it in `cause`. This lens prefers eleven
  fields — the list was amended one round ago and a twelfth field is a fresh doc-churn — but has no
  strong objection if adversarial argues machine-parseability.
- **(b) Key order.** `cause` is appended **last**. `_journal`'s own docblock (`:233`) declares *"the
  key order below IS the line's wire format; keep it."* Inserting a field mid-list silently breaks
  every operator's `jq`/`cut` and is the consumability half of this same change (§3, QD-C4).

### QD-O2 — the **B5 mismatch is a defect under either ruling, and R-2's `cause` field is what fixes it** (the interlock, and the strongest single point in this proposal)

At `:378-383` the DES-127 B5 restore writes the terminal row as `status:'ready'` (the prior good
diagram, untouched), while the only line emitted for that settle — from `_attempt` — says
`outcome:'unavailable'`. **The store and the log disagree about the same event.** A monitor counting
`outcome:'ready'` under-counts ready diagrams; an operator asking "why is this diagram stale?" reads a
failure the store denies; and `diagramStale` (ARCH-081) is precisely the field a human would go check
next, so the two signals collide at the surface the requirement cares about.

Under QD-O1's seam the line becomes `outcome:'ready'`, `noteCode:null`, and
`cause:'prior_ready_restored:<lastNoteCode>'`. **Note what that requires**: keeping one line per settle
*and* not losing the attempt's failure reason is possible **only because R-2 adds `cause`**. The two
findings the reviewer filed separately close each other — R-2's eleventh field is not decoration, it is
the mechanism that makes R-2b's ruling implementable without a second line. Gate 2 should record that
dependency in inv 5's text, so a future round cannot drop `cause` as "cosmetic" and silently re-open
the mismatch.

### QD-O3 — **R-2 / OBS-1: the eleven-field list stands; build `cause`, and pin its value domain now** (MED)

Filed on the reviewer's **corrected** ground only — the doc↔code field-count mismatch (`_journal`
`:223-233` emits exactly ten keys; `cause` exists nowhere in `src/`), *not* the "three byte-identical
lines" table, whose third row the reviewer refuted on primary evidence. **This lens does not re-file
OBS-3** either: `server.ts:955` guards `graphAnalyzer.enabled` before `enqueue`, so DEPLOY's
registration-scoped sentence is accurate. Overruled means overruled.

`cause` is an **engine-classified, closed enum-shaped string** (ADR-016 forbids provider or model
text on this channel). Proposed domain, written into inv 5 so Gate 5 can assert *values* rather than
presence:

| path | `noteCode` (persisted) | `cause` |
|---|---|---|
| ready | `null` | `null` (or `attempts=N` when `N>1`) |
| B5 prior-ready restore | `null` | `prior_ready_restored:<lastNoteCode>` |
| `enabled:false` guard (inv 11) | `RETRIES_EXHAUSTED` | `analyzer_disabled` |
| boot sweep, abandoned by a dead process | `RETRIES_EXHAUSTED` | `boot_abandoned` |
| model alias unmapped | `MODEL_UNMAPPED` | `model_unmapped` |
| queue full | `QUEUE_FULL` | `queue_full` |
| gateway terminal / timeout | (existing) | `gateway_terminal` \| `gateway_timeout` |
| gate rejection | (existing) | `gate_reject:<gateFail>` |
| exceptional exit of inv 2's closure | `RETRIES_EXHAUSTED` | `job_exception` |

**Why the value domain, not just the field:** inv 5's own amendment accepted `RETRIES_EXHAUSTED`
becoming an overloaded "the engine gave up" code, *on the stated condition* that the distinct cause
rides the journal field. A `cause:null` on those three zero-attempt paths would satisfy an
`Object.keys` assertion and leave the overload exactly as opaque as before. **Gate 5's oracle must
assert the value on each of the five zero-model-call paths** — the reviewer already listed this ask;
this row is the architecture giving it a table to assert against.

### QD-O4 — **R-1: inv 2 is reaffirmed verbatim; the only architecture-side addition is that its exceptional exit must route through QD-O1's seam** (HIGH, owned by Gates 5/6)

R-1 is not this gate's to fix and this lens does not soften a word of inv 2 as amended. Two
observations that belong in the architecture record rather than in a test file:

1. **The exceptional exit is a settle.** inv 2 says `catch { settle + journal }`. Under QD-O1 that is
   not a bespoke catch-and-log: it calls `_settle(...)` with `noteCode: RETRIES_EXHAUSTED`,
   `cause:'job_exception'`, the four model-call fields `null`. Writing it as its own log statement
   would recreate the second emitter this round is removing.
2. **The oracle's dropped assertion is the finding.** Gate 2's RED oracle ordered *(a) no unhandled
   rejection, (b) the row settles, (c) the next enqueued job still runs*; UT-125 shipped (a) and (c).
   That is how a **33/33 green** `graph-analyzer.test.ts` coexists with a permanently leaking slot. The
   architecture cannot fix a test, but it can state the rule that generated the failure: **an invariant
   whose oracle is enumerated in this document is satisfied only when every enumerated assertion is
   present; dropping one is a send-back item, not a judgement call.** This lens asks Gate 2 to write
   that sentence into inv 8 (the falsifiability invariant), where V-C already lives.

### QD-O5 — **SUS-2's observability half: the missing boot warning must key off the EFFECTIVE tool set** (MED, impl-owned; one architectural clarification owed here)

ADR-020 mandate (c) — *"warn loudly at boot when it is non-empty"* — was never built;
`server.ts:1512` is one unconditional `console.log`, identical for `tools:[]` and `tools:["Bash"]`.
The clarification this gate owes: `:1511` computes
`analyzerEffectiveTools = curateToolsForProvider(graphAnalyzerConfig.tools, analyzerProvider)`, and
`:1478` already forces `tools:[]` when no `workRoot` resolves (`graphAnalyzerNoJail`, fail-closed,
DES-122). So there are **three** tool sets in play — configured, fail-closed-forced, and
provider-curated — and the operator-risk statement must describe the one that actually reaches the
model. **Proposal:** keep the existing unconditional effective-tools log (ARCH-085 leans on it as the
effective-config readback), and **add** a `console.warn`, emitted only when
`analyzerEffectiveTools.length > 0`, naming both the configured and the effective set and stating the
accepted risk in the operator's words. Two lines, not one replacing the other — the risk line and the
readback line answer different questions.

---

## 2. REPLACEABILITY — decoupling & pluggability

### QD-R1 — **R-3 DECISION: build inv 11's choke point. Do not ratify the caller placement.** (MED, the item Gate 2 owes)

The reviewer's counterweight is real and this lens records it in full: there is **no live hole** (all
three `_startJob` callers are covered; UT-124 pins them plus the clobber trap), the
guard-before-`putDiagramPending` ordering holds at both sites, and the architecture pre-authorised a
weaker fallback that the shipped shape exceeds. The adjudicated ground is narrow — *nothing records
taking the fallback*. So the honest question is: **is the choke point still the right structure, or is
ratifying-plus-recording now cheaper?**

At this lens's altitude, `graphAnalyzer.enabled:false` is not a feature flag. It is **the operator's
only documented script-egress kill switch for an LLM backend** — the concrete replaceability control
this subsystem exposes (`server.ts:298`'s own tool description tells the operator so, and DEPLOY §1b
repeats it). A kill switch enforced at *N* call sites is not a switch; it is a convention that happens
to hold at N. inv 11's own rationale says it in one line: *"three callers each carrying the check, two
remembered, one forgot."* Counting the sites today: `server.ts:955`, `mcp-facade.ts:462`,
`graph-analyzer.ts:138`, `:181` — **four, across three modules**. The count went *up* in the round that
was supposed to consolidate it.

**The discriminator that decides it this round is new**: R-1's fix rewrites `_startJob`'s scheduled
closure (wrap, `catch → settle+journal`, `finally → release+drain`, drop `_runJob:388`'s release). The
"don't make structural changes at a send-back gate" argument that made the fallback attractive last
round **evaporates** — the guard hoist and the wrap edit the same ~20 lines, in the same commit, under
the same tests. Deferring now costs a *second* future edit of the same block.

**Amendment text (unchanged prescription, plus the clause that was missing):** inv 11 stands as
written — the `enabled` guard is `_startJob`'s first statement, before either claim, and it settles;
`putDiagramPending`'s durable write moves behind it with `sweepAtBoot` passing its attempt stamp as a
parameter (this ordering is *not* optional — with the `ON CONFLICT … SET diagram=NULL` write still
ahead of the guard, a `_startJob` guard trades a known bug for the latent clobber UT-124's fourth case
pins). `mcp-facade.ts:462` and `server.ts:955` **stay** as defence-in-depth and are re-labelled as such
in the ARCH text, so their presence is no longer evidence of a missing choke point.

**Fallback, named for the referee exactly as inv 11 named its own** — if Gate 6 or the owner prefers
zero structural change: amend inv 11 to ratify the two-caller placement, **and pair it with a
mechanical caller-set lock** — a test that greps `src/` for `_startJob(` and asserts the call-site set
equals a pinned literal, the repo's own ADR-022 / `TOOL_NAMES` set-equality pattern. **A bare amendment
without that lock is renamed debt**: it converts "the doc is wrong" into "the doc is right and the
fourth caller will still forget", which is the failure inv 11 was written to prevent. Whichever way the
referee rules, **IMPL must name which was taken** — the adjudicated defect is the silence, and a
ratification that is not recorded in the ledger reproduces it verbatim.

### QD-R2 — inv 8's seams are the replaceability property that makes inv 2 falsifiable — reaffirmed, no new seam needed

`schedule` (injectable, default `setImmediate`, `:127`) plus V-C's injectable throwing `ports`/`catalog`
are already sufficient to write every RED case R-1 needs; `ports` and `catalog` are constructor-injected
today (`:109-115`), so cost is zero. Gate 5 owes the throwing-`putDiagramResult` and
throwing-`getTriggerBindings` cases — named debt in UT-128's own docblock (`:497-501`) and still open.
**Architecture asks for nothing new here**, and that is the finding: when a subsystem's failure modes
are untested it is usually a missing seam; here it is not, so no seam may be proposed as the remedy.

### QD-R3 — backend swap for the engine's own agent: holds, with one coupling worth a sentence

The analyzer rides the same `GatewayClient` interface as user agents, including the zero-config
fallback construction at `server.ts:1493`, so Anthropic ↔ OpenAI ↔ Gemini ↔ local Ollama remains a
config change for the *internal* agent too — the agent-altitude replaceability goal, met. The coupling
already recorded in ARCH-085 (the shipped default `systemPrompt` assumes a model class that can obey a
vocabulary allowlist; a weaker local model degrades into `GATE_REJECTED_SHAPE`, ARCH-080) is correct as
written and needs no amendment; this lens re-checked it because a swap-by-config claim whose quality
silently collapses on swap is the classic false replaceability. It does not silently collapse — the
gate makes the degradation loud, and `GATE_REJECTED_SHAPE` is the operator's signal.

### QD-R4 — inv 10 (per-process bounds) holds unchanged

`_runningCount`/`_queue`/`_pendingKeys` are in-memory; `workflow_diagrams` is durable and shared and
takes no distributed lock. Written down last round, nothing new. **No distributed lock is proposed and
none is wanted.**

---

## 3. CONSUMABILITY — ease of use & integration cost

### QD-C1 — **R-6: delete the literal tool count from `02-architecture.md:555`; do not write "40"** (LOW, the item Gate 2 owes)

Verified: `TOOL_NAMES` declares **40**; `:555` says **39**, and the claim repeats. The reviewer's own
observation is the argument — *"the wrong count sits inside the amendment written to replace a
count-based drift-lock with a set equality."* Writing `40` re-arms the trap A6 existed to disarm: the
number is stale again at v24's first new tool, and the row's authority competes with IT-102's two-sided
set equality, which is the actual source of truth. **Proposal:** the row states the *mechanism* — a
sorted set equality against a hand-written literal never imported from `server.ts`, plus per-tool rows —
and cites IT-102 for membership. No integer anywhere in the ARCH text. If the referee insists on a
number for readability, it must be phrased as a non-normative "currently 40 (see IT-102 for the
authoritative set)".

### QD-C2 — **CONS-1: ARCH-085's `api:` row lists all nine `graphAnalyzer` keys — and record that this was verified doc-only** (LOW, the item Gate 2 owes)

`02-architecture.md:1456` advertises six keys; the shipped block has nine
(`maxBytes`/`maxLines`/`maxQueueDepth` missing from the doc). **This lens checked whether CONS-1 is
actually this repo's `composeConfig` forwarding-gap class in disguise — it is not:** `main.ts:184`
forwards `fileConfig.graphAnalyzer` **as a whole**, all nine keys default at the single site
`server.ts:1474-1483`, and `tests/unit/compose-config-v2-wiring.test.ts:196` pins the three missing
keys explicitly. **Doc-only, confirmed.** Amend the `api:` row to
`{enabled?, model?, systemPrompt?, tools?, timeoutMs?, retries?, maxBytes?, maxLines?, maxQueueDepth?}`
with a pointer to the one defaulting site — **and record the verification in the row itself**, so the
next reader does not spend a round re-establishing that the wiring is sound. (An engine whose config
block is nine keys in `rwe.config.example.json` and DEPLOY's 設定總表, but six in the architecture of
record, costs an integrator exactly the debugging session this dimension exists to prevent.)

### QD-C3 — **the interface table's journal row contradicts itself in its own closing clause** (LOW, the item the reviewer asked Gate 2 to re-state)

`02-architecture.md:1708` declares **`"+ provider HTTP status" STRUCK`** (A8) and then closes with
*"Engine-classified error class **+ provider HTTP status** only; never transcript text, raw provider
text, or the script."* One sentence apart. Proposed replacement for the closing clause:

> Engine-classified error class only; **never** transcript text, raw provider text, **a provider HTTP
> status**, or the script.

Cross-checked this round: the process-view mermaid note at `:1611` already reads *"never provider text,
never a provider HTTP status"* — **correct, leave it**. The row at `:1708` is the last surviving site,
which is precisely A8's own defect class ("a clause struck in one of four places") caught one site
short.

### QD-C4 — the journal line is a **consumed interface**, so pin it two-sidedly

It is consumed by operators (`grep`/`jq` over stdout — there is no other analyzer surface) *and* by
ARCH-085, which leans on it as the effective-config readback. Two consumability consequences of QD-O1:
(a) `cause` appends **last**, per `_journal`'s own declared wire-format rule; (b) the eleven-field list
must be pinned by an assertion on `Object.keys(JSON.parse(line)).sort()` **set equality**, never
`toContain` — a one-sided check lets a twelfth field grow silently, which is the exact thing inv 5's
pinned field list exists to prevent (and the same shape as A6's set-equality ruling for `TOOL_NAMES`).
Gate 5 ask, arising from the architecture text.

### QD-C5 — the client-facing failure surface holds unchanged

`diagramStatus` (closed three-value enum) + `diagramNote` rendered from the engine's `noteCode` enum +
V-D's note precedence (`analyzerEnabled:false → DISABLED` before any persisted code) are confirmed
CLOSED by the reviewer at `workflow-view.ts:133-146`. No re-litigation.

---

## 4. SELF-SUSTAINABILITY — closed-loop autonomy & lifecycle

### QD-S1 — **R-1's blast radius is larger than a leaked slot: with no `unhandledRejection` backstop, an unwrapped void job is a process-exit vector** (HIGH, Gates 5/6; recorded here because it changes how the risk reads, not the fix)

The reviewer names the two consequences: a permanently leaked concurrency slot (after which every later
registration settles a designed-looking `QUEUE_FULL` that inv 2's own text calls indistinguishable from
correct operation), and an escaping unhandled rejection. This lens adds the operational half:

- `grep -rn "unhandledRejection" src/` → **no match** (re-verified). Under Node's default
  `--unhandled-rejections=throw` (the default since Node 15; this project pins **Node 22.6+**), an
  escaped rejection **terminates the engine process**.
- Both entry paths reach it. **Boot**: `sweepAtBoot()` at `server.ts:1507`, whose requeue branch
  schedules a job whose `_runJob` can throw at `getTriggerBindings:355` or
  `putDiagramResult:377/:380/:385`. **Request**: `server.ts:957` calls `enqueue` synchronously after
  `facade.workflow_register` has already committed.
- **What bounds the boot path is inv 9, and only inv 9** — the sweep stamps `putDiagramPending(…,
  stamp)` *before* it schedules, so a crash-before-settle leaves a stamped row that the next boot takes
  down the zero-call `generatedAt < bootInstant` branch. One crash per pending row, not a restart loop
  under systemd `Restart=on-failure`. This is the clearest evidence in the ledger that writing an
  unwritten invariant down was load-bearing work: inv 9 is the reason the HIGH is a crash and not an
  outage. Worth one sentence in inv 2's text, because a future round that "simplifies" the sweep's
  stamp ordering would silently convert this failure mode.

**Nothing new is proposed** — the remedy is exactly inv 2's shape as already amended (wrap the closure,
`catch → settle+journal` through QD-O1's seam, `finally → release+drain`, drop `_runJob:388`'s release,
`.catch()` at `:127` as belt-and-braces). What this section asks Gate 2 for is one clause in inv 2
recording *why* the bound is load-bearing at this severity, so a third consecutive round cannot read it
as a tidiness item.

### QD-S2 — **R-4: a committed registration must not become a failed tool response** (LOW, owner's call — this lens supports the two-line catch)

`server.ts:957` runs `enqueue`'s synchronous store I/O on the request path *after* the registration
transaction has committed. A throw there returns an error for an operation that **succeeded**, and
(per QD-S1) an *async* throw further down the same path exits the process. The fix is a
`try { … } catch { one engine-classified line; leave the registration successful }` at the call site.
Anticipating the obvious objection (a catch turns a loud failure into a swallowed one): it does not
here, because the diagram row is `pending` and **`sweepAtBoot` will settle it on the next boot** — the
self-healing path already exists, and the catch is what lets it be reached instead of being pre-empted
by a lie to the caller. LOW; `better-sqlite3` is single-process-synchronous and inv 10 rules contention
out of scope.

### QD-S3 — **SUS-2: ADR-020's third mitigation is the one that converts a silent hazard into an accepted one** (MED, impl)

Two of ADR-020's three mitigations shipped (mandate the key, default `[]`); the third — *warn loudly at
boot when it is non-empty, and record non-empty as an accepted operator risk* — did not. The
"accepted risk" half is the whole point of the decision: a hazard nobody is told about is not accepted,
it is merely unnoticed, and this is the config key that hands the engine's own internal agent a tool
surface. Content and placement per QD-O5. The loud-line pattern already exists eight lines above
(`:1486`, the fail-closed no-jail downgrade), so this is a copy of a pattern, not a new one.

### QD-S4 — the analyzer's long-run metabolism: holds unchanged, stated so it is not mistaken for unexamined

At agent altitude this dimension asks about memory metabolism, tool liveness and bounded growth. All
four already settle without new machinery, re-verified this round: the analyzer keeps **no memory across
runs** (ADR-018 deliberately stores no `inputs_fp`, so there is no cache to grow or invalidate);
`_pendingKeys`/`_queue` are bounded by `maxQueueDepth` (`:82-84`, defaulted `server.ts:1481-1483`);
diagram rows are bounded per name by `maxWorkflowVersions` and deleted in the **same transaction** as
their version row (ARCH-077 inv 7 as corrected by A8 — no sweep, no GC, no orphan reaper); tool
liveness for the model backend is the boot alias check (`:1497`) plus per-call `timeoutMs` enforced by
both gateway implementations with a real `AbortController`. **The one live self-sustainability defect in
this subsystem is R-1**, and it is the one that breaks the drain loop — which is why §4 spends its
length there and not here.

### QD-S5 — S-1 (every registration costs an LLM call) — unchanged, but QD-O1(a) is what makes it measurable

No rate limiter is proposed (unchanged: `maxWorkflowVersions` is the per-name front door; concurrency 1
+ queue cap + `timeoutMs` bound the rest). The addition this round is only that **aggregated** token
fields on the settle line turn S-1 from a recorded worry into a countable number, from an existing seam,
at zero cost.

---

## 5. Summary

**Both altitudes apply; the agent altitude decides every item, because v23 put a deliberately
transcript-less LLM agent on the engine's registration and boot paths, leaving ONE journal line as its
entire observable surface.** Four Gate-2 items plus the reviewer's fifth ask, one ruling each; R-1 is
reaffirmed unsoftened and re-severity-ed as a process-exit risk.

### Key points

1. **R-2b — keep "one line per settle"** (this lens's own ratified invariant); make it structural by
   fusing `putDiagramResult` + `_journal` into one private settle seam and deleting `_attempt`'s
   emitter. **R-2's `cause` field is the mechanism that makes this implementable** — together they fix
   the B5 mismatch (a row written `ready` whose only log line says `unavailable`), which is a defect
   under either ruling.
2. **R-3 — build inv 11's choke point.** `enabled:false` is a script-egress kill switch, and a kill
   switch enforced at four sites across three modules is a convention. The churn argument that favoured
   ratifying died this round: R-1's fix already rewrites the same closure. Fallback (ratify + a
   mechanical `_startJob(` caller-set lock) named for the referee; **a bare ratification is renamed
   debt**, and either way IMPL must record which was taken.
3. **R-6 — delete the count**, don't correct it to 40; IT-102's set equality is the source of truth and
   a fresh integer re-arms the trap A6 disarmed.
4. **CONS-1 — nine keys in ARCH-085's `api:` row**, plus the recorded verification that this is
   doc-only and *not* the `composeConfig` forwarding class (`main.ts:184` forwards wholesale;
   `compose-config-v2-wiring.test.ts:196` pins the three).
5. Plus the reviewer's fifth ask: **`:1708`'s closing clause contradicts its own STRUCK note** — strike
   "+ provider HTTP status" there too; `:1611` is already correct.

R-1 is reaffirmed **verbatim, unsoftened**, with two architecture-side additions: its exceptional exit
settles through the same seam, and its blast radius includes **engine process termination** (Node 22's
default unhandled-rejection policy, no backstop in `src/`), bounded to one crash per pending row by
inv 9 alone.

## 6. Previously dispositioned — holds, unchanged (not re-litigated)

| item | status |
|---|---|
| A1 transport gate on `/describe` | CLOSED (`server.ts:1892-1907`), real-validated VAL-120. No comment. |
| A2 `enabled:false` never reaches the gateway | CLOSED behaviourally; the structural residue **is** R-3. |
| A4 mini-preview deleted / A5 one vocabulary declaration / A10 false comment | CLOSED; R-5's surviving `diagram-gate.ts:22-24` docblock is Gate 6's one-line item, not an ARCH amendment. |
| A6 `tools/list` drift-lock | CLOSED; residue is R-6 (§3). |
| V-D note precedence | CLOSED (`workflow-view.ts:133-146`). |
| inv 4 (no raw provider/model text) · inv 6 (allowlist membership) · inv 9 (sweep stamps before it schedules) · inv 10 (per-process bounds) | HOLD, unchanged. inv 9 is cited in §4 as load-bearing, not amended. |
| OBS-3 (DEPLOY `enabled:false` wording) | **Overruled on primary evidence last round; NOT re-filed.** |
| ARCH-085's repaired justification ("the journal line is an adequate config readback **because** inv 2 releases on every exit and inv 5 emits on every settle") | Holds — and note it **lapses by its own terms** until R-1 and R-2b land. That is the clause working as designed. |

## 7. Risks

1. **Edit collision (highest).** R-1's closure wrap and R-3's guard hoist touch the same ~20 lines of
   `_startJob`. **Prescribed ordering: R-1 first (it is the HIGH), then R-3.** Separate test flips —
   UT-125's dropped assertion (b) must go RED and green on the wrap *before* the guard moves — or one
   green suite masks whichever landed second. This is the same shape as the failure that produced two
   consecutive blocking rounds.
2. **`cause` lands untested.** Adding a field to a shared seam changes every existing journal
   assertion. If Gate 5 does not write the value-domain assertions (§1 QD-O3's table) **before** Gate 6
   adds the field, `cause` ships as `null` on the very paths it exists to disambiguate — a smaller copy
   of exactly how assertion (b) got dropped.
3. **The fused settle seam crosses the B5 restore path**, which Gate 7.5 round 4 validated. The ready-
   check ordering in `_settleUnavailable:206-210` must not move, and the row write must stay *inside*
   the seam — if a caller can still write a row without emitting, "one line per settle" is prose again.
4. **A ratified-without-lock R-3 recurs at v24's first new `_startJob` caller** — and by then the
   ledger will read as if the placement was designed.
5. **`cause`'s enum is engine-authored and must stay so.** The temptation on the gateway-terminal path
   is to interpolate the provider's reason. ADR-016 forbids it; the journal line is a concatenation
   site and the request contains the masked script.
6. **Recorded, not architected around** (deliberately *not* proposed for v23): a process-level
   `unhandledRejection` handler. It would blunt QD-S1's crash, but a global handler that swallows is its
   own hazard and it is not this iteration's decision to take at a send-back gate. Named so a future
   hardening iteration inherits it rather than rediscovering it.

## 8. Expected disagreements with the other lens (adversarial)

1. **inv 5, per-settle vs per-attempt** — the likeliest fight. Adversarial's r2 §5.4 argued per-attempt
   and lost the referee call; the B5 evidence gives it a fresh hook ("the attempt's outcome is real
   information"). **This lens's answer is that `cause` preserves it inside one line**, and that flipping
   a ratified invariant one round after ratifying it is how a document stops being an authority.
   Compromise this lens would accept: per-attempt lines *at debug verbosity only*, with the settle line
   unconditional and unchanged — never two lines at the same level for one event.
2. **R-3** — adversarial authored the refined A2 and will likely also want the choke point, so expect
   agreement on the ruling and disagreement on the **fallback**: this lens insists a ratification is
   worthless without the mechanical caller-set lock; adversarial may hold that UT-124's three-entry-
   point coverage is already the lock. (It is not: UT-124 pins today's callers, not tomorrow's fourth.)
3. **Field count** — adversarial may prefer a twelfth `attempts:number` field over encoding it in
   `cause` (machine-parseability). Named as fallback in §1; this lens will not block on it.
4. **R-6** — adversarial may want the count corrected to 40 rather than deleted. This lens holds that a
   correct integer in a document nobody re-counts is a defect with a longer fuse.
5. **R-4 severity** — this lens supports the two-line catch at `server.ts:957` and expects the "you are
   swallowing a failure" objection; the rebuttal is that `sweepAtBoot` already settles the pending row,
   so the catch reaches an existing self-healing path rather than hiding the fault.
6. **Scope** — adversarial may re-open items the reviewer marked CLOSED (its lens rewards finding more).
   This panel's rule is the reviewer's own: verify the fixes, do not re-open v23.
