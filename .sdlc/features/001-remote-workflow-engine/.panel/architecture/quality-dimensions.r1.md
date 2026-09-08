---
stage: architecture
lens: quality-dimensions
iteration: v26
round: 1 (independent proposal)
---
# Quality-dimensions proposal — v26 (Observability / Replaceability / Consumability / Self-sustainability)

## summary

v26's ten requirements come from twelve issues filed by an agent that cold-ran five workflows — and
**five of the ten describe the same structural defect at five different seams: a narrow projection of
an external payload, with a silent drop for everything the projection did not name.**
`contentB64 ?? ''` drops a seed's missing content and writes a 0-byte file (REQ-121);
`extractEvents` returns `[]` for any SDK message without a `message.content` array, so `system/api_retry`
vanishes and a 401 costs four minutes of silence (REQ-122); `msg.usage.input_tokens ?? 0` /
`output_tokens ?? 0` drops the two cache columns (REQ-127); `markDone` overwrites the resolved provider with the
transport's name (REQ-125); `markQueued(…, key.opts.phase, …)` reads a field no writer ever sets, so
every agent lands in column zero (REQ-124). Each requirement patches its own seam. **My proposal is
that Gate 2 name the class once and design the counter-measure once: a projection may not drop
silently — unmapped input becomes a typed, bounded, redacted record plus a counter, and every counter
has one named reader.** That single principle is the whole of my Observability section and half of
Self-sustainability.

Three further calls, in descending confidence. **(a) REQ-124's obvious fix is the dangerous one.**
`opts.phase` already exists in the type, so the natural move is to have the sandbox child stamp the
current phase into `opts` — but `opts` *is* the resume CallKey (`sameKey` = `prompt` +
`JSON.stringify(opts)`), so every journal written before the upgrade would miss at callSeq 0 and every
interrupted run would re-run from scratch, at real cost, the moment v26 deploys. The safe seam is
parent-side and I verified it is exact: `_handleAgentRequest` reaches `markQueued` with **no await**
after entering, and `phase`/`agent` share one ordered IPC `message` handler, so
`entry.phases.at(-1)?.title` read at that point is the phase the script was in when it called.
**(b) REQ-127 does not change a formula, it changes the *unit* of a number that is already persisted
in SQLite and already bound into scheduled and webhook triggers.** That is a data migration. Take the
requirement's option (ii) — an object-shaped budget — because it is the only option under which a
stored bare number is *detectable* as old-token semantics instead of being silently reinterpreted as
dollars. **(c) The provider set shrinks by owner ruling (REQ-123); the provider *mechanism* should
shrink with it into one descriptor table**, because REQ-123's fail-closed boot check, REQ-126's effort
mapping and declared flags, REQ-127's four-column pricing and REQ-130(d)'s alias table are four
requirements that each need the same per-provider row, and today that row is spread over at least six
places.

Five HIGH risks: the budget-unit migration crossing durable state (QD-R1), the CallKey hazard if
anyone stamps phase into `opts` (QD-R2), a USD budget that can never stop a zero-priced local run
(QD-R3), pricing liveness — an OpenRouter catalog outage silently turns the money cap off (QD-R4) —
and **QD-R14, found while verifying QD-R1: no trigger-started run carries a budget at all** — and
`04-design.md:832/1156` (D-V2h) already decided it should, marked it "Resolved", and left it unbuilt,
so v26's money cap covers the attended runs, misses every unattended one, and contradicts a design row
in the same ledger.

## Altitude call (which system is this?)

**Both altitudes apply, and v26 splits along a clean line** — so I apply both, per dimension.

From `state.yaml.tech_stack` and the requirements: this is a Node 22 / TypeScript ESM **service** —
hand-rolled JSON-RPC-over-HTTP MCP server (`src/server.ts`), SQLite via better-sqlite3, a filesystem
journal, a server-side Mermaid renderer with an in-process cache, a web dashboard, systemd
self-update. REQ-121 (schema/validation), REQ-124 (a view-layer join), REQ-128 (a static checker),
REQ-129 (SVG viewport) and REQ-130 (generated documentation) are conventional-system requirements and
I read them at that altitude.

It is *also* an **agent-execution runtime**: `agent()` dispatches a genuine
`@anthropic-ai/claude-agent-sdk` headless session through a managed LiteLLM proxy to one of several
model providers, streams that session's own reasoning/tool-call turns into a transcript, and meters
it. REQ-122 (a provider auth failure reaching the caller as a real error instead of a timeout),
REQ-125 (which model actually answered), REQ-126 (the reasoning dial) and REQ-127 (four-column tokens
and real money) are agent-altitude requirements about **an LLM call's inspectability, substitutability
and cost**, and forcing them into a system reading would lose exactly what makes them hard.

REQ-123 is genuinely both: deleting two providers is a system-level dependency and configuration
change, while "all three paths get the full tool surface" is an agent-altitude statement about
harness capability parity.

**What I deliberately do not force onto v26:** *memory metabolism* and *self-reflection / prompt
calibration*, the two agent-altitude self-sustainability sub-topics. Runs here are bounded and
journalled; no requirement asks for long-term context compression, and inventing it would be scope
invention. Named once, dropped. The *third* sub-topic — **tool/dependency liveness** — I do keep, but
narrowly: issue #73's weekly OpenRouter probe is explicitly deferred, and v26 adds only *declared*
fields (REQ-126). The design obligation that survives is therefore small and real: the declared
fields must be honest about being declarations, and must have the shape the deferred probe will later
write into.

---

## 1. Observability

**The v26 principle: a projection that drops silently is a design defect, and v26 contains five of
them.** This lens's usual formulation — "a write with no read-back seam is unobservable" (v24's AC-2 /
ARCH-085) — still holds, but v26's failures are one step earlier: the value was never *captured*, so
there is nothing for a reader to read. Five of the ten requirements are that. I want Gate 2 to fix the
class, not five instances.

### System altitude

**O-1 — REQ-121: refuse at the schema, and make the refusal name the alternative.** The defect is
`workspace-seed.ts:46`'s `contentB64 ?? ''` under a schema (`tool-specs.ts:378`) that says only
`seed: {type:'array'}`. Five runs executed against empty workspaces and nobody was told. Two design
properties, beyond the requirement's own wording: (i) the three seed shapes are *discriminated in the
schema*, each `items` shape carrying its own description **and the code it raises** — a caller reading
`tools/list` should be able to tell the shapes apart without a round trip; (ii) `INVALID_SEED_SPEC`'s
message names the offending `path` **and** points at `seedManifest`, because "your input was wrong" and
"here is the input you meant" are different products. Note the cross-repo hazard the requirement
itself flags: `additionalProperties:false` on the items can only land after checking the plugin's
`push_workspace.py`, and the plugin is a **separate repo with no SDLC ledger** — that check is a named
Gate 7.5 step, not an assumption. (Recorded, not solved here.)

**O-2 — REQ-124: one `phaseAt()` function, called at two times, and never through the CallKey.**
Evidence: `run-manager.ts:1065` passes `key.opts.phase`, which no script and no engine path sets;
`dashboard.ts:285` then groups by `a.phase ?? ''`, so every agent falls into one column, on 100% of runs.

- **Live stamp (new runs):** the phase current when the child sent the message — **snapshotted in
  `host.ts`'s `case 'agent'` and passed to the handler as its own argument, beside `opts` and never
  inside it.** The precision matters. `host.ts` does have one ordered `child.on('message')` switch, but
  the `phase` case calls `onPhase` **synchronously** while the `agent` case defers the handler through
  `Promise.resolve().then(…)`. Node delivers each parsed IPC message on a `nextTick`, and nextTicks drain
  ahead of promise microtasks — so a non-awaited `agent()` followed by `phase()`, arriving in one chunk,
  would push the *later* phase before the deferred handler ever read the tail. Reading
  `entry.phases.at(-1)?.title` inside `_handleAgentRequest` is therefore exact for awaited calls and
  wrong in that one window; snapshotting at the message boundary is exact unconditionally and costs one
  argument. (`_handleAgentRequest` does reach `markQueued` with no intervening `await`, so nothing else
  in the parent can reorder it.) The requirement's own nested-frame approximation ("nested `workflow()`
  frames share one phase timeline") stands unchanged.
- **Carry the ordinal, not only the title.** REQ-124 aligns dynamic phase titles (`phase('fork:'+tier)`)
  to the skeleton by **order**, not string equality — so `phaseAt()` should return `{title, index}` and
  the record should carry both. The order-join then has something to join on, instead of the layout code
  re-deriving an index from a title that may repeat or vary between runs.
- **Backfill (existing runs):** the same predicate applied post-hoc — "the last phase whose `ts` precedes
  this record's `startedAt`". Write it **once**, as a pure `phaseAt(phases, ts)`, and have both the live
  stamp and `layoutGraph` call it, so the dashboard and `/api/runs/:id/dag` cannot disagree about which
  column an agent is in.
- **Not through `opts`.** See QD-R2 — this is the sharpest hazard in v26 and it is invisible unless
  someone opens `resume-cache.ts`.

**O-3 — Every new counter needs one named reader, and I propose one home for all of them.** v26 mints
at least four run-level facts that are currently homeless: unpriced calls (REQ-127 says explicitly they
must not be silently zero), unmapped session messages (O-4), a legacy-unit budget (QD-R1), and a v1-contract
diagram (REQ-128). Four requirements each inventing a field is the shape that produced this iteration's
issue list. Propose a single `run_result.meta.warnings: {code, count, detail?}[]`, closed-catalog codes,
surfaced in `run_status`, on the dashboard run page, and in `run_result` — one reader, one drift-lock,
and the next warning is a row rather than a schema negotiation. **REQ-127 names `meta.unpricedCalls`
literally, so that field stays exactly as written** — `warnings[]` is the umbrella beside it, not a
replacement, and the acceptance clause remains satisfiable word for word.

### Agent altitude

**O-4 — REQ-122's root cause is not "`api_retry` is unhandled"; it is that `extractEvents` is an
allowlist with a silent default.** `claude-agent-sdk-client.ts:379-389` reads
`msg.message.content`, returns `[]` when it is not an array, and maps exactly three item types. Every
`system` message — `init`, `api_retry`, anything the SDK adds next — produces no event, no counter, and
no trace. That is why a 401 presents as a four-minute timeout with `events: []`. **Invert the default:**
an unmapped message becomes a typed `system` transcript event carrying its `subtype` and a **bounded**
payload, and increments `meta.unmappedMessages`. REQ-122's classification (401/403/404 → terminal;
429/5xx → let the CLI retry) then becomes a *policy over an event that exists*, and the next unknown
message type is a visible row instead of another silent four minutes.

Two constraints on that inversion, both load-bearing:

- **It must go through the REQ-083 redact-at-capture seam.** `api_retry`'s `error` string is a provider
  response body and can carry credentials or echoed headers. Widening capture without widening redaction
  is designing a leak. This project has already shipped a `redact()` that was written and left unwired —
  so the acceptance is "the new event kind is redacted **and** a test proves it", not "we will remember".
- **It must be bounded.** A retry storm is exactly the case that generates the most unmapped messages;
  per-run cap plus a counter, never an unbounded transcript.

**O-5 — REQ-122 needs a `retryable` discriminator, and it fixes a second latent bug the requirement does
not mention.** Today's failure reasons are `'timeout' | 'unreachable' | 'terminal'`, and **both** clients
loop `for (…attempts…) { … if (last.ok) return last; }` — `client.ts:362-369` and
`claude-agent-sdk-client.ts:444-446`. Non-ok of *any* kind is retried, so `'terminal'` does not stop
anything. Put an explicit `retryable: boolean` on the shared `AttemptFailure`/`GatewayResult` type in
`client.ts` and make both loops consult it. That satisfies REQ-122's "a terminal marked non-retryable is
not run again" clause **and** removes the same waste on the direct-fetch path, which already classifies
4xx as `terminal` and retries it anyway — a bug the requirement's SDK-only framing hides.

**O-6 — REQ-125: provider identity is three facts, so give it three fields and make clobbering
impossible.** `agent-executor.ts:259-274` overwrites `markHarness`'s resolved values with the gateway
result's `provider: 'claude-agent-sdk'` (a transport) and the caller's alias (not a model). Rather than
ordering the writes carefully, change the shape so the mistake cannot recur: `GatewayResult` carries
`{transport, provider, model, proxyModel?}` as distinct fields, and `markDone` writes only the fields
`markHarness` does not own. Read-back seams, named: `run_status.agents[]`, the `usage` transcript event
(the requirement already says so), and REQ-128's new per-agent harness table on the dashboard workflow
page. This is also what makes REQ-122's post-mortem question — *which of the three paths broke?* —
answerable, which is why REQ-122's acceptance depends on REQ-125's.

**O-7 — REQ-126: record the wire position and value, not just `applied: true`.** The effort dial now
crosses a translation layer (`thinking.budget_tokens` → LiteLLM → upstream `reasoning_effort`); the
requirement is right to demand the wire location be recorded, and the reason is worth stating in the
architecture: **a LiteLLM upgrade that changes that translation is otherwise undetectable** — the field
would still say `applied: true` while nothing reaches the model. `effortApplied` belongs on the agent
record and on the dashboard harness table, not only in a computed return value.

**O-8 — REQ-127: the transcript is where cost becomes auditable, so pin the price at capture. This is
also where this lens's traceability fold lands in v26**, together with R-3's ADR: pinned prices make a
run's spend re-derivable from its own journal years later, and the ADR keeps REQ-123's deletion traceable
to the evidence that overturned commit 0f79f04. Those are the two places v26 either keeps or loses the
chain from a recorded number back to the decision that produced it. The
`usage` event should carry the four token columns, the resolved provider/model, **the unit prices used**,
and the computed `costUSD`. Pinning the prices makes the arithmetic reproducible from the journal alone,
and it is what lets the resume fold (S-2) sum stored costs instead of re-deriving them from a catalog
that may have changed. `costUSD: null` plus the `unpricedCalls` counter is the honest missing-price
representation the requirement demands; the counter's home is O-3.

---

## 2. Replaceability

**The owner ruled the provider set down to three. That ruling is not in question here.** What
architecture decides is whether the *mechanism* shrinks with the set or whether v26 deletes two branches
from six places and leaves the six places.

### System altitude

**R-1 — the per-provider knowledge is currently spread over at least six sites**, all of which REQ-123,
REQ-126, REQ-127 and REQ-130(d) touch in the same iteration:

| # | Site | What it knows |
|---|---|---|
| 1 | `gateway/client.ts:10` — `AliasMap` provider union | the legal set |
| 2 | `gateway/client.ts:41` — `EFFORT_PROFILES` | the reasoning dial |
| 3 | `gateway/client.ts:164+` — `switch (target.provider)` | endpoint, key env, request/response shape |
| 4 | `gateway/litellm-proxy.ts` — config emitter | LiteLLM prefix, key env |
| 5 | `models/model-catalog.ts` | static rows, per-provider fetchers, price parsing, cost bands |
| 6 | `gateway/claude-agent-sdk-client.ts:322` — `thinkingFor` | thinking policy per provider |
| (7) | `claude-agent-sdk-client.ts:193/219` — `NON_ANTHROPIC_EXCLUDED_TOOLS` / `curateToolsForProvider` | tool surface — **deleted by REQ-123** |
| (8) | `default-aliases.ts` — `DEFAULT_ALIASES` | the shipped table |

**R-2 — propose one `PROVIDERS` descriptor table, and let the four requirements read it.** One row per
provider: `{ id, keyEnv, litellmPrefix, effort: EffortProfile | null, thinkingPolicy, pricing: <static
4-column table | catalog field | zero>, catalogSource, toolSurface: 'full' }`. Then:

- **REQ-123's fail-closed boot check** is `alias.provider ∉ keys(PROVIDERS)` → refuse, and the message
  that names the offending rows and lists the legal values is *generated from the table*, so it cannot go
  stale the way this project's hand-copied lists repeatedly have.
- **REQ-130(d)'s alias table** — "產生自同一來源" — is satisfied by construction: `authoring-guide.ts`
  already imports `LOCKED_KEYS`, `TUNABLE_KEYS`, `ERROR_CATALOG`, `WRITABLE_AGENT_OPT_KEYS`, `SHAPES`
  and `EDGE_FORMS` from the modules that enforce them (ADR-032). One more import, same rule.
- **REQ-127's pricing** and **REQ-126's effort/declared flags** stop being new parallel lookups.

I want to pre-empt the obvious objection (see *expected disagreements*): a table of **three rows**
replacing branches in **six files** is not abstraction for its own sake — it is smaller than what it
replaces, and the alternative is that the next provider change touches six files again.

**R-3 — REQ-123's deletion has a deployment consequence that belongs in its ADR.** The requirement
already mandates an ADR recording commit 0f79f04's original decision, today's re-test and the
reversal. Extend it by one line: removing the `openai` provider also removes DEPLOY.md's
**self-hosted OpenAI-compatible endpoint** path (vLLM / TGI / llama.cpp via `OPENAI_API_BASE`), which
is a *capability* loss, not only a config cleanup. The owner has ruled and the replacement is stated
(local → Ollama, cloud → OpenRouter); the ADR should say so explicitly so the next operator who wants
vLLM finds the reasoning rather than re-deriving it. Recorded as QD-R7, not disputed.

**R-4 — one ordering constraint is an acceptance item, not an ops note.** REQ-123 says the four
production `gpt*` alias rows must be removed **before** the restart, because the boot check is
fail-closed and the self-update path restarts automatically after a release. That makes the config edit
and the release **one ordered operation**; if it can be got wrong by a human under time pressure, it
should at minimum be a numbered step in DEPLOY.md with the failure mode spelled out ("service will not
boot"), and Gate 7.5 should observe the ordering rather than only the end state.

### Agent altitude

**R-5 — the LLM backend stays swappable, but the swap surface moves from "provider" to "OpenRouter
model id".** v26 narrows direct provider integrations to three while keeping OpenRouter as a
many-models front door — this is a *concentration* of the pluggability seam, not its loss, and it is
worth stating plainly in the architecture so nobody later reads REQ-123 as "we gave up on
multi-vendor". The descriptor table keeps re-adding a provider a one-row change if the owner ever
reverses.

**R-6 — REQ-126 changes the *shape* of effort resolution, not just its table.** `EFFORT_PROFILES` is
keyed by **provider**, but OpenRouter's reasoning support is per **model** (`supported_parameters`
contains `reasoning`). So effort resolution becomes `provider profile × model capability`, and
`profileFor(provider)` alone can no longer answer it. Say this at Gate 2, or the design will bolt a
model-level check onto a provider-level lookup and produce a third place that knows about reasoning.
The requirement's own three-way split is the specification: declared-reasoning OpenRouter rows get the
budget mapping; non-declaring OpenRouter rows and Ollama keep `thinking: disabled` on the wire (the v3
harness spike is unambiguous that qwen2.5:7b only works with thinking off); Anthropic's
`output_config.effort` path stays byte-identical.

**R-7 — keep transport-specific handling behind the transport boundary.** REQ-122's `api_retry`
classification is a fact about the Claude-Agent-SDK session stream; the direct-fetch path has its own
bounded race and its own status codes. The shared artifact is the **classification** (`retryable`,
the terminal reasons) on the common `GatewayResult` type; the *detection* stays in each client. Two
GatewayClient implementations is this project's real replaceability asset — the fix must not grow a
copy of the SDK's message vocabulary into the direct-fetch client.

---

## 3. Consumability

**v26's consumability requirements exist because a cold client — an actual agent, on another machine,
with only `tools/list` and the guide — got five things wrong and was told about none of them.** That
is the strongest possible evidence for this dimension, and it sets the bar: the interface must make
the wrong call *impossible to make silently*, not merely documented.

**C-1 — REQ-121 is the flagship, and the lesson generalizes: a `{type:'array'}` schema is not an
interface.** The three seed shapes differ in *where the bytes come from* (inline content / a CAS
manifest / a manifest ref), which is precisely what a caller cannot guess. Each shape gets an `items`
definition, a description naming its transport, and the refusal code it raises. `run_start`'s tool
description carries the same three-shape summary (the requirement says so) — and the same is true of
REQ-127's unit change: **the description must state the unit, because there is no other way for a
caller to learn that `budget: 5` stopped meaning tokens.**

**C-2 — make "every refusal points at the guide" a test, not a discipline.** v24's Gate 7.5 round 2
failed on exactly one clause: two trigger-claim refusals carried `see: null` (an `ERROR_CATALOG` miss
at `errors.ts:74-75`). v26 mints at least five codes — `INVALID_SEED_SPEC` (exists), and REQ-128's
`DIAGRAM_DIRECTION` / `LANE_MISMATCH` / `TOOLS_MISMATCH` / `EDGE_MISMATCH`. Assert it structurally:
**every code any validator emits appears in `ERROR_CATALOG`, and every authoring-side code has
`see: 'workflow_authoring_guide'`.** That is a unit test over the catalog and the emitters, and it
retires a whole class of Gate 7.5 round-trips.

**C-3 — REQ-128 + REQ-130: the guide must teach exactly what the checker enforces, and the coupling
should be mechanical.** Today `check-mermaid.ts` compares label sets, `&`-forms, undeclared ids and
cycle labels, while the guide claims edge-by-edge comparison — the requirement calls this "the 22nd
description that does not match". Two locks: (i) the rule text is rendered from the checker's own
constants, as `SHAPES`/`EDGE_FORMS` already are; (ii) **every rule the checker enforces has at least
one `GUIDE_EXAMPLE` that demonstrates it**, and all ten examples are re-registered against a booted
engine — that integration test already exists and becomes the acceptance evidence when REQ-128 rewrites
the examples to LR swimlanes. A guide example that no longer registers is then a red test, not a
Gate 7.5 discovery.

**C-4 — REQ-130's determinism section must be interpolated from the guard, and must give the reason.**
The requirement asks for the denylist, the reason, and the substitute. The reason is the interesting
part and it is architecturally load-bearing: `Date.now()` / `new Date()` / `Math.random()` are refused
**because resume replays by `prompt` + `opts`** (`resume-cache.ts:14`), so a script whose next call
depends on wall-clock or entropy cannot be replayed. Stating that once in the guide makes three
separate rules — the determinism guard, the `args`-only escape hatch, and (C-5) the advisory status of
`budget.spent()` — one comprehensible idea instead of three arbitrary prohibitions. The denied
identifier list itself must be interpolated from the guard, not re-typed.

**C-5 — one honesty item REQ-130 should carry: `budget.spent()` is live but not resume-stable.** I
checked both ends of the wire, because this project's recurring bug class is a seam that exists with
nothing supplying it: `child-entry.ts:35/44/99` updates `spentSoFar` from `msg.spent`, `host.ts:52/109`
piggybacks `spent: onBudgetSnapshot?.()` on every `agentResult`, **and `run-manager.ts:925` really does
supply that callback** (`guard.budgetView().spent()`). It is *not* a stub, and the `tech_stack` note
calling these accessors hard-coded stubs is **stale**. But a script that *branches* on it is not replayable:
the value is not part of the CallKey, so on resume a different branch produces a different prompt, the
key mismatches, and the run re-executes from that point. That is resume-**safe** (it degrades to a
miss, never to a wrong replay) but not resume-**efficient**, and under REQ-127 the re-execution costs
real money. The guide should say "read it for logging, do not branch on it", in the same section as
C-4, for the same reason.

**C-6 — REQ-129 is dashboard consumability and the fix belongs at the view layer.** `viewBox` +
`width=100%` + `preserveAspectRatio` on the generated run DAG (today `dashboard-page.ts:394-403` emits
absolute pixel `width`/`height`), and wheel-zoom / drag-pan / "fit" applied to **both** figures. Doing
it in the view layer is what gives pre-v26 `graph TD` diagrams the same treatment without touching a
single stored diagram, which is what REQ-129 requires. *(Checked and not a risk: the server-side render
cache is an in-memory `Map` keyed by name+version, so a deploy clears it — no stale-SVG concern from the
render side.)*

**C-7 — REQ-126's declared flags must say "declared" in the data, not only in the prose.** A caller
choosing a model from `models_list` cannot distinguish "we probed this and it works" from "the upstream
list claims this". Carry provenance as a field — `source: 'upstream' | 'static' | 'unknown'` — beside
`toolUseDeclared` / `effortDeclared`. This costs nothing now and is the slot issue #73's deferred weekly
probe writes into later (S-5).

---

## 4. Self-sustainability

**v26's self-sustainability question is short: after this iteration, can the engine still stop itself
from spending money, and can it still recover a run written by the previous version?** Two of the four
HIGH risks live here.

### System altitude

**S-1 — REQ-127 crosses a durable-state boundary, and this is the requirement's real difficulty.**
The evidence, re-verified against the tree: `sqlite-run-store.ts:42/104-105` persists `budget` as JSON
in the `runs` table and `:127-138` rebuilds that spec so `RunManager` can reconstruct a run after a
restart (REQ-059/060's resume path). So a bare number written under **token** semantics is read back
under **USD** semantics by (a) any run resumed across the upgrade, and (b) every out-of-tree caller
that keeps sending the number the interface currently documents — `tool-specs.ts:352` says in so many
words *"Total token budget for the whole run"*, and the callers who read that line (the plugin repo,
saved client scripts, operator runbooks) are outside this ledger, exactly as in QD-R8. A run submitted
with `budget: 200000` does not get a $200k cap in any meaningful sense; it gets no cap.

**A correction to my own first draft, which turns into a finding.** I had written that triggers bind a
budget into a stored start-spec, citing `scheduler.ts:80` / `webhook-registry.ts:20`. Those two lines
are the **structural seam type** mirroring `RunManager.start()`, not a stored binding — and every real
firing path passes *no* budget at all: `server.ts:869-870` (cron / once, via the `tick()` driver),
`scheduler.ts:313` (resident `trigger()`) and `webhook-registry.ts:302` all call
`start({ name, args, startedBy })`. Only `mcp-facade.ts:570` (`run_start`) forwards `budget`. **So no
trigger-started run has ever had a spend ceiling, and REQ-127 does not give it one** — after v26 the
unattended, unobserved runs are exactly the ones with no money cap, while the interactive ones gain a
real one. That is the wrong way round for a service meant to survive unattended.

**And this is not an open question that Gate 2 gets to decide fresh — it was decided, the other way,
and never built.** `04-design.md:814-815` types every `Schedule` arm with `budget?: number | null`;
`:832` states the intent under the heading *"Cost containment (KP-9 / R1, agent-altitude
self-sustainability)"* — *"each `Schedule` arm carries an optional `budget` that flows into
`RunManager.start(spec)` exactly like a manual run's budget … absent → the server-level default cap
applies (no unbounded-spend-on-an-unattended-timer)"*; and `:1156` (D-V2h) records it **"Resolved"**,
answering an adversarial round-1 finding it calls *"the single highest-value gap the just-run panel
added — unattended cron/resident runs default to unbounded paid spend."* The shipped code has none of
it: the `schedules` table (`scheduler.ts:167+`) and `ScheduleRow` (`:99-116`) have **no `budget`
column**, no firing path passes one, and `grep` finds **no server-level default cap** anywhere in
`src/`. Worse, the same design row keeps overlap-allowed as an *explicit accepted risk* on the stated
grounds that it is *"mitigated by per-run budget"* — a compensating control that, for triggers, does
not exist. So D-V2h is a decision recorded as resolved whose implementation never landed, and an
accepted risk resting on it. **That is this lens's traceability fold, and it is the most concrete
instance of it in v26:** a ledger row that says "Resolved" is exactly as unobservable as a silent
projection drop unless something reads it back.

The v26 posture therefore is not "consider adding trigger budgets"; it is **"REQ-127 makes an already
unimplemented cost-containment decision acute, because the number it hardens is now money."** Gate 2
owes one of two answers, in writing: implement D-V2h as designed (a `budget` column threaded through
`markFired`'s start call — wiring, not new design, and precisely the `composeConfig` bug class this
project has hit twice), or **re-decide D-V2h explicitly and amend `04-design.md:832/1156` plus the
overlap accepted-risk that leans on it**. Silently shipping a money cap that misses every unattended
run, under a design row claiming the opposite, is the one outcome that must not happen.

**Therefore I take the requirement's option (ii) and add a reason it does not state.** REQ-127 leaves
the shape to Gate 2 and forbids silently choosing (i). Take **(ii): `budget` accepts an object with an
optional USD ceiling and an optional four-column token ceiling, either of which stops dispatch.** Beyond
the requirement's own justification (this deployment's `default` alias is zero-priced Ollama, so a
USD-only budget can never stop a local run — QD-R3), the object form makes the **legacy bare number
structurally detectable**: `typeof budget === 'number'` is unambiguously a pre-v26 value, and can be
refused with a named code, or explicitly honoured as a token ceiling, or migrated — a *decision*, taken
once, instead of a silent reinterpretation that nothing can ever detect. Option (i) forecloses that
forever.

**S-2 — the resume fold must change with the unit, and must fold stored cost, not recompute it.**
`run-manager.ts:844` calls `guard.setSpent(sumUsageTokens(allEvents))`, and `run-store.ts:71-79` sums
`tokens.input + tokens.output` off `usage` events. Under REQ-127 this becomes a cost fold. Two
properties: (i) it sums the **`costUSD` stored on each event** (O-8's pinned prices), never a
recomputation against today's catalog — otherwise an OpenRouter price change silently rewrites the
accounting of a run in flight; (ii) legacy `usage` events (two token columns, no `costUSD`) must fold to
a *known-unpriced* contribution that raises the O-3 warning, not to zero. Folding old events to zero is
the same fail-open as S-1 wearing different clothes.

**S-3 — pricing has a liveness dependency, and the failure direction is fail-open on money.** Anthropic
prices are static rows, but OpenRouter's arrive from a live `/models` fetch (`model-catalog.ts:121-140`).
If that fetch fails, every OpenRouter call is unpriced; if unpriced contributes zero, the budget stops
nothing. Three properties: **last-known-good catalog with a TTL**, so a transient outage does not
un-price a run; **`costUSD: null` + `meta.unpricedCalls`**, never a silent zero (the requirement says
this — the architecture note is *why*: it is the money circuit breaker's own health signal); and a
recorded decision on whether crossing an unpriced-call threshold should **stop dispatching** (the
conservative reading of a spend cap) or merely warn. I lean warn-and-continue for v26, because
stop-on-unpriced turns a catalog outage into a total outage — but it is a decision that should be
written down, not defaulted into.

**S-4 — the price data model does not exist yet; this is a schema change, not a formula.**
`ModelEntry.price` is `{ in: string; out: string } | 'free' | 'unknown'` — **display strings**
(`'$5/1M'`), with no cache-read or cache-write columns at all, and `maxPricePerMOf` parses them back out
for filtering. REQ-127 needs four numeric per-token prices per model. Add a computation-shaped numeric
field beside the display field (keeping the display field for `models_list`'s existing consumers) rather
than re-parsing strings at billing time; the four-column numbers belong in the R-2 descriptor row for
Anthropic's static table and in the OpenRouter row mapping for
`pricing.prompt / completion / input_cache_read / input_cache_write`.

**S-5 — REQ-124's backfill and REQ-128's `diagramContract` are the same pattern: keep working for data
written before the rule.** Both are right, and one shape recommendation applies to both: **REQ-128's
contract version should be an explicit column on the version row, not inferred from `createdAt`.**
`createdAt` is a proxy — clock skew, restored rows and re-registration all break it — and when the
contract moves to v3 there is no third value to infer. `workflow_describe` already has to report
`diagramContract: 'v1' | 'v2'`; store what you report.

**S-6 — REQ-122 is a liveness property of the whole engine, not of one call.** A 401 currently costs
`timeoutMs × (1 + retries)` ≈ four minutes **while holding a run-concurrency slot**, so one bad key
degrades throughput for every workflow on the box, not just the one that owns the key. That is the
argument for terminal-fast beyond the reporting fix. A per-provider circuit breaker — open after N
consecutive terminal-auth failures, half-open probe — is the textbook next step, and I name it as a
**deferred candidate rather than v26 scope**: with terminal classification in place the per-call cost
drops from four minutes to one attempt, which removes most of the harm, and inventing a breaker here
would be scope invention against a requirement set the owner has already bounded.

### Agent altitude

**S-7 — tool-liveness is the one agent-altitude self-sustainability topic v26 legitimately touches, and
its obligation is small.** Issue #73's weekly OpenRouter probe is deferred; v26 adds declared fields
only. Two properties make the deferred job a drop-in instead of a re-design: **provenance** on each
declared flag (C-7's `source` field, plus a `declaredAt`), and **honesty** — the schema itself says
these are declarations, never probes, so a caller never mistakes an upstream claim for a verified
capability. Everything else about that probe belongs to the iteration that builds it.

**S-8 — memory metabolism and prompt self-calibration: not applicable, and I want that on the record
rather than silently absent.** Runs are bounded and journalled; there is no resident long-term agent
memory to compress, and no requirement asks for one. The nearest thing v26 does have is a *calibration
loop for the engine's own teaching* — REQ-130's generated guide plus REQ-117/REQ-128's "a cold model
reading only the guide gets it right first try", measured at Gate 7.5. That is a genuine closed loop and
it is already where it belongs; it should not be confused with agent self-reflection, and it should not
be extended into one.

---

## key_points

1. **Five of v26's ten requirements are one bug class: a projection that drops silently.** `contentB64
   ?? ''` (121), `extractEvents` returning `[]` for `system` messages (122), `usage.input_tokens ?? 0`
   (127), `markDone` clobbering the resolved provider (125), `markQueued(key.opts.phase)` with no writer
   (124). Name the class at Gate 2 and design the counter-measure once — unmapped input becomes a typed,
   bounded, redacted record plus a counter — instead of patching five seams independently.
2. **Invert `extractEvents`' default** (`claude-agent-sdk-client.ts:379-389`): unmapped SDK messages
   become typed `system` transcript events plus `meta.unmappedMessages`. REQ-122 then becomes a policy
   over an existing event rather than a special case, and the next unknown message type is visible.
   **Redact-at-capture (REQ-083) and a per-run bound are part of this, not follow-ups.**
3. **REQ-124's phase must be stamped parent-side, never into `opts`.** `sameKey` = `prompt` +
   `JSON.stringify(opts)`; stamping phase into `opts` invalidates every pre-upgrade journal at callSeq 0.
   Safe alternative: snapshot the phase in `host.ts`'s `case 'agent'` — *before* the
   `Promise.resolve().then(…)` that defers the handler, since a synchronous `onPhase` on a later
   nextTick can otherwise overtake it — and pass it as its own argument. One pure `phaseAt(phases, ts)`
   returning `{title, index}` serves both the live stamp and the legacy backfill, so
   `/api/runs/:id/dag` and the dashboard cannot disagree, and the skeleton's order-join (dynamic phase
   titles) has an ordinal to join on.
4. **Add `retryable: boolean` to the shared gateway failure type.** Both retry loops (`client.ts:362-369`,
   `claude-agent-sdk-client.ts:444-446`) retry any non-ok result, so today's `'terminal'` stops nothing.
   The discriminator satisfies REQ-122's non-retryable clause and removes the same waste on the
   direct-fetch path, which REQ-122's SDK-only framing does not mention.
5. **REQ-125: `{transport, provider, model, proxyModel?}` as distinct fields on `GatewayResult`**, with
   `markDone` writing only what `markHarness` does not own — a shape change that makes the clobber
   impossible, rather than a write-order convention that can regress.
6. **Execute REQ-123's provider shrink through one `PROVIDERS` descriptor table.** Per-provider knowledge
   is spread over ≥6 sites (R-1's table). One row per provider serves REQ-123's fail-closed boot refusal
   (message generated, not transcribed), REQ-126's effort, REQ-127's four-column pricing and REQ-130(d)'s
   同源 alias table. Three rows replacing six branch sites is a net reduction.
7. **REQ-126 changes the shape of effort resolution:** provider profile × **model** capability
   (`supported_parameters` contains `reasoning` per model), so `profileFor(provider)` alone cannot answer
   it. Record the wire position and value, so a LiteLLM translation change is detectable.
8. **REQ-127 is a durable-state unit migration, so take option (ii).** `budget` is persisted in
   `runs.budget` (`sqlite-run-store.ts:42/104-105`), rebuilt on resume (`:127-138`), and documented to
   every out-of-tree caller as *"Total token budget"* (`tool-specs.ts:352`). Only the object form makes
   a stored or incoming bare number *detectable* as legacy token semantics. The resume fold
   (`sumUsageTokens`, `run-store.ts:71` → `run-manager.ts:844`) becomes a cost fold that sums **stored**
   `costUSD` and must not fold legacy events to zero.
8b. **The coverage hole in the money cap, and it is an unimplemented design decision, not an open
   question.** No trigger-started run carries a budget: cron/once (`server.ts:869-870`), resident
   (`scheduler.ts:313`) and webhook (`webhook-registry.ts:302`) start runs with no `budget`, the
   `schedules` table has no such column, and no server-level default cap exists — while
   `04-design.md:814-815/832` specifies exactly that budget "so no unbounded-spend-on-an-unattended-
   timer" and `:1156` (D-V2h) marks it **Resolved**, with the overlap accepted-risk citing "per-run
   budget" as its compensating control. v26 turns that number into money, which makes it acute:
   implement D-V2h, or re-decide it and amend `:832`/`:1156` and the accepted risk. **A ledger row
   saying "Resolved" with nothing reading it back is the same defect class as key_point 1 —
   this is where this lens's traceability fold actually bites in v26.** QD-R14.
9. **Pin unit prices onto the `usage` event at capture**, with a TTL'd last-known-good catalog. Otherwise
   an OpenRouter catalog outage un-prices every call and the money cap fails open — and a price change
   rewrites the accounting of a run already in flight.
10. **Consumability is enforced by tests, not vigilance:** every emitted code in `ERROR_CATALOG` with a
    non-null `see` for authoring-side failures (v24's D-14 was exactly this miss), and every rule
    `check-mermaid` enforces demonstrated by ≥1 registering `GUIDE_EXAMPLE`. Both are unit/integration
    tests that retire a class of Gate 7.5 round-trips.
11. **Store `diagramContract` as an explicit version-row column, not a `createdAt` inference** — the
    proxy breaks on clock skew, restored rows and re-registration, and offers no third value when the
    contract moves again.
12. **One home for v26's new run-level facts:** `run_result.meta.warnings: {code, count, detail?}[]`
    covering unpriced calls, unmapped messages, legacy budget units and v1-contract diagrams. Four
    requirements each inventing a field is how this iteration's issue list was produced.
13. **Correction for the ledger:** `state.yaml.tech_stack` still says the sandbox `budget.spent()` /
    `remaining()` accessors are hard-coded stubs. They are not, and I verified the whole wire rather than
    the accessor alone — `child-entry.ts:35/44/99` ← `host.ts:52/109` ← `run-manager.ts:925`, which really
    does supply `onBudgetSnapshot`. The live caveat is different and
    belongs in the guide: branching on `spent()` is resume-safe but forces re-execution (C-5).

## risks

| # | Risk | Severity | Where it lands |
|---|---|---|---|
| QD-R1 | **The budget unit change crosses durable state.** `runs.budget` is persisted as JSON (`sqlite-run-store.ts:42/104-105`) and rebuilt on resume (`:127-138`); and the tool description callers integrate against (`tool-specs.ts:352`) says *"Total token budget"*, so out-of-tree callers (plugin repo, saved scripts, runbooks) keep sending token numbers after the meaning changes. A pre-v26 token number read as USD is not a smaller cap; it is effectively no cap, silently. Option (ii) is the only shape under which the legacy value is detectable. | HIGH | REQ-127 |
| QD-R2 | **Stamping REQ-124's phase into `opts` poisons the resume CallKey.** `sameKey` = `prompt` + `JSON.stringify(opts)` (`resume-cache.ts:14`); every journal written before the upgrade would miss at callSeq 0 and re-run in full, at real cost, exactly when REQ-127 starts charging for it. `opts.phase` already exists in the type, which makes this the *natural* implementation and therefore the dangerous one. | HIGH | REQ-124 (+ REQ-059/060, REQ-127) |
| QD-R3 | **A USD-only budget can never stop this deployment's default path.** The `default` alias is Ollama qwen2.5:7b at price zero, so a runaway local run has no ceiling at all. The requirement names this and forbids silently choosing (i); it must be answered, not inherited. | HIGH | REQ-127 |
| QD-R4 | **Pricing liveness fails open.** OpenRouter prices come from a live `/models` fetch (`model-catalog.ts:121-140`); an outage un-prices every call, and unpriced-as-zero means the money cap stops nothing. Needs TTL'd last-known-good + `unpricedCalls` + a recorded decision on stop-vs-warn. | HIGH | REQ-127 |
| QD-R14 | **No trigger-started run has a budget at all, and `04-design.md` says one should — D-V2h is an unimplemented "Resolved".** `server.ts:869-870` (cron/once), `scheduler.ts:313` (resident) and `webhook-registry.ts:302` all call `start({name, args, startedBy})`; only `mcp-facade.ts:570` forwards `budget`; the `schedules` table (`scheduler.ts:167+`) has no `budget` column and no server-level default cap exists. Yet `04-design.md:814-815/832` types and specifies a per-arm budget "so no unbounded-spend-on-an-unattended-timer", `:1156` marks it Resolved, and the overlap accepted-risk cites "per-run budget" as its compensating control. REQ-127 makes it acute by turning the number into money: after v26 the cap covers attended runs and misses every unattended one. Implement D-V2h, or re-decide it and amend `:832`/`:1156` **and** the accepted risk that leans on it. | HIGH | REQ-127 (+ REQ-015, REQ-057, DES-016/D-V2h) |
| QD-R5 | **Widened event capture without widened redaction is a credential leak.** `api_retry`'s `error` is a provider response body. The REQ-083 redact-at-capture seam has a history in this project of being built and left unwired — so redaction and a bound are acceptance clauses of O-4, not follow-ups. | MID | REQ-122 (+ REQ-083) |
| QD-R6 | **REQ-123's fail-closed boot check plus automatic self-update restart is an ordering trap.** The four production `gpt*` alias rows must be removed *before* the release-triggered restart, or the service will not boot. The requirement states it; it needs to be a numbered DEPLOY.md step with the failure mode named, and observed at Gate 7.5. | MID | REQ-123 |
| QD-R7 | **Removing the `openai` provider removes a capability, not only config.** DEPLOY.md's self-hosted OpenAI-compatible path (vLLM / TGI / llama.cpp via `OPENAI_API_BASE`) disappears; the stated replacement is Ollama locally and OpenRouter in the cloud. Owner-ruled, but the ADR REQ-123 already mandates should record the consequence so the next operator finds the reasoning. | MID | REQ-123 |
| QD-R8 | **`additionalProperties:false` on `seed` items is a cross-repo break.** The plugin client (`push_workspace.py`) lives in a separate repo with no SDLC ledger; if it sends an extra field, tightening the schema refuses uploads that work today. The requirement flags the check — it must be an explicit Gate 7.5 step against the real plugin, not an assumption. | MID | REQ-121 |
| QD-R9 | **Legacy `usage` events folding to zero on resume.** Pre-v26 events carry two token columns and no `costUSD`; folding them to zero silently under-reports spend on exactly the runs a deploy interrupts. They must fold to a known-unpriced contribution that raises a warning. | MID | REQ-127 (+ REQ-059) |
| QD-R10 | **The guide drifts from the four new diagram rules.** REQ-128 adds `DIAGRAM_DIRECTION` / `LANE_MISMATCH` / `TOOLS_MISMATCH` / `EDGE_MISMATCH` and rewrites all ten examples; prose-only coupling reproduces the "22nd description does not match" defect the requirement itself cites. Interpolate the rule text from the checker and require ≥1 registering example per rule. | MID | REQ-128 / REQ-130 |
| QD-R11 | **`effortApplied: true` can become a lie without any code change.** The dial crosses a LiteLLM translation (`thinking.budget_tokens` → upstream `reasoning_effort`); a proxy upgrade that changes the translation leaves the flag saying "applied" while nothing reaches the model. Recording the wire position and value is what makes it falsifiable — and Gate 7.5's observable low-vs-high difference is the only real test. | MID | REQ-126 |
| QD-R12 | **Per-agent phase attribution is exact only for the top-level frame.** Nested `workflow()` frames share one phase timeline (the requirement accepts this), and a `parallel()` whose members straddle a `phase()` call inherits the phase current at dispatch. Fine — but it must be *documented as an approximation* in `workflow_describe`/the dashboard, or the next issue report will be "the DAG put my agent in the wrong column". | LOW | REQ-124 |
| QD-R13 | **The zoom/pan layer is new client-side code on an anonymous route.** REQ-129's interaction lands on the same page that serves author-supplied diagram content; wheel/drag handlers and any transform must not become a second path for author-controlled strings into the DOM. Small, but it is new attack surface on a route that was deliberately de-authed. | LOW | REQ-129 |

## expected disagreements with other lenses

- **vs. a simplicity / YAGNI lens — on R-2 (the `PROVIDERS` descriptor table).** They will say: three
  providers do not justify a registry; delete the two branches and move on. My counter is the count, not
  the principle — the per-provider knowledge is in **six** places today (R-1), and v26 is simultaneously
  adding a seventh (four-column pricing) and an eighth (declared capability flags). A three-row table
  replacing six branch sites is less code, not more, and REQ-130(d)'s "generated from the same source"
  clause is otherwise satisfied by a hand-copied list — the exact failure this project has hit repeatedly.
  If they win, the fallback I would accept is: no table, but a single module that *owns* all
  per-provider constants, so the count goes from six to one without introducing an abstraction.
- **vs. a minimal-diff / "do what the issue says" lens — on O-4 (inverting `extractEvents`' default).**
  They will say REQ-122 asks for `api_retry` handling and nothing more; the red test passes either way.
  True. My counter: the cost is roughly fifteen lines and one counter, and the benefit is that the *next*
  unmapped message type costs a visible row instead of another four-minute silence and another issue
  report. This iteration exists because of silent drops; adding the sixth one while fixing five is the
  predictable mistake.
- **vs. an adversarial / security lens — on QD-R5, where I expect to be attacked and to agree.** Widening
  capture over provider payloads is a new exfiltration surface, and they are right. That is why redaction
  at the capture seam and a per-run bound are written as clauses of O-4 rather than as follow-ups. If they
  push further — "do not capture unknown payloads at all, only the subtype" — I would concede the payload
  and keep the subtype plus the counter: the *fact* that something was dropped is the irreducible part.
- **vs. a data-model / API-stability lens — on S-1 (option (ii), the object budget).** They will say
  changing a scalar field to an object breaks every existing caller and that a documented unit change is
  cheaper. My counter: the field's meaning changes either way; the only question is whether the change is
  **detectable**. A stored bare number reinterpreted as dollars is undetectable forever, including by the
  cron that fires it next week. If they win on the shape, I need the equivalent guarantee some other way —
  a `budgetUnit` discriminator, or refusing bare numbers written before a recorded cutoff.
- **vs. a performance lens — on O-8 (pinning unit prices onto every `usage` event).** They will say this
  bloats the journal on the hottest write path. It is four numbers per agent call, and the alternative is
  re-deriving cost against a catalog that has since changed — which corrupts the resume fold rather than
  slowing it.
- **vs. whoever proposes the child-side phase stamp (QD-R2).** I expect this collision specifically,
  because `opts.phase` already exists in the type and the sandbox child is where the phase is
  synchronously known — it looks like the *intended* design. The tie-breaker is `resume-cache.ts:14`, and
  it is not a matter of taste: `JSON.stringify(opts)` is the replay key, so any engine-injected `opts`
  field is a journal invalidation. If someone wants the child-side stamp anyway (e.g. for exactness under
  a future async model), it requires a key-normalisation projection that strips engine-injected fields
  before hashing — a strictly larger change, and one that must be *designed*, not discovered at Gate 7.5.
- **vs. a UX / dashboard lens — on C-6 and QD-R12.** They may want the phase columns to be exact for
  nested frames too, and to render the DAG client-side for smoother zoom. On the first, the requirement
  itself accepts the nested approximation and I would rather label it honestly than build a
  per-frame phase timeline this iteration. On the second, server-side rendering was chosen deliberately
  in v25 (REQ-119) and an anonymous route is not the place to reopen it.
