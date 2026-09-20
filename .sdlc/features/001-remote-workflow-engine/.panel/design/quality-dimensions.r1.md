# Quality-dimensions lens — Design stage, round 1 (independent proposal)

**Scope:** detailed design for v35 (ARCH-141..154, ADR-065..071, closing REQ-205..210 — "this engine
fails silently"), plus the ten in-place-amended rows. Read: 01-requirements.md (REQ-205..210 and the
surrounding acceptance text), 02-architecture.md (the full v35 slice, lines 4369-4552), state.yaml
`tech_stack`. 03-tasks.md does not exist yet.

## System-shape call

Both altitudes apply, and neither can be skipped. This is a conventional backend (Node 22.6+/TS
strict/ESM, hand-rolled JSON-RPC-over-HTTP, SQLite via better-sqlite3, a dashboard SPA polling a
REST-shaped `/api/*`) **and** an AI-agent system (a workflow engine whose unit of work is a headless
`agent()` call routed through two swappable `GatewayClient` implementations — LiteLLM-proxy and the
Claude Agent SDK — over three provider lanes). v35 itself sits mostly at the agent altitude: five of
its six REQs (205, 206, 207, 209, 210) exist because a *cold LLM caller* (not a human operator) hit a
silent failure, a `null`-as-data corruption, or an undocumented envelope. REQ-208 is the one system-
altitude item (a registration-time static-analysis defect). I apply both below, per dimension, and
say explicitly where one altitude is N/A rather than forcing it.

## (1) Observability

**What this slice gets right, and why it's worth naming as exemplary rather than re-litigating:**
ARCH-141/142/143 turn a value that only ever lived in `RunManager`'s process memory into three durable
surfaces from ONE write (`recordError`), redacted at a single capture point (ADR-066) rather than at
each of the three sinks — that is the dimension's "observable seam" principle applied correctly, and
it is explicitly modeled on this repo's own named anti-pattern (the `composeConfig`/v31-`costUSD`
wiring-gap class: a signal fixed in one place and forgotten in the others). ARCH-148's fail-closed
valve (`SCRIPT_UNSCANNABLE` on acorn↔V8 grammar drift) is the same principle at the *registration*
gate: a guard that cannot confirm it ran refuses rather than degrading quietly. ARCH-147 makes a
previously-invisible multiplier (`retries`) a computed, advertised number instead of leaving the
caller to discover it empirically, which is the tool-call-sequence-inspectability half of the agent
altitude working as intended.

**Gaps worth raising at Design stage:**

1. **Write ordering between the two `recordError` sinks is unstated.** ARCH-142 pins the ordering
   between "reason persisted" and "status flips to `failed`" (reason first, mirroring
   `recordTransition`). ARCH-143 folds the SQLite `UPDATE runs SET error=?` and the
   `appendFileSync(journal.jsonl, {type:'error',...})` into "one method" but does not say which of
   the two writes happens first inside that method, nor what a crash between them means for a reader
   who trusts one surface over the other. Given this repo's crash-durability history (REQ-055/060,
   ARCH-034), I'd want detailed design to state the order and add a crash-window test (kill the
   process between the two writes, assert `run_result` and the journal don't disagree) — small cost,
   and it closes the exact class of bug this iteration exists to remove, one level deeper.
2. **Per-agent failure has no code/message surface parallel to the new run-level one.** ARCH-146
   deliberately keeps the run-level signal a *count* (R8: narrative text must not cross into the
   run-level surface). That's the right call for the run level. But REQ-207's own title is "agent
   失敗的語意要說出口" (an agent's failure must be spoken), and after v35 a caller who sees
   `failedAgentCount:3` still has to fall back to raw per-agent transcripts to learn *why* each one
   died (timeout vs. schema-retry-exhaustion vs. provider error) — there's no code/message discipline
   at the per-agent record comparable to what ARCH-141 just gave the run level. This may already be
   satisfied by the existing `AgentTranscriptSink`/`workflow_agent_log` machinery (ARCH-004) predating
   v35; if so, Design should say so explicitly (one line, "per-agent failure detail already carries
   `{code,message}` via X, unaffected by this slice") so a reader doesn't assume REQ-207 was answered
   twice at different depths by accident.
3. **`failedAgentCount` has no dashboard rendering item.** ARCH-153 wires the new `error` field into
   the run detail/list view; I don't see an equivalent for `failedAgentCount` (ARCH-146). An operator
   staring at a `completed` run with `result:null` and three failed agents still has to know to check
   a field the UI doesn't surface. This is a one-line addition riding the same "no new endpoint, no
   new fetch" property ARCH-153 already established — worth a Gate-3 task even if it's small enough
   not to warrant its own ARCH row.

## (2) Replaceability

**System altitude — unaffected, and that's correct.** v35 touches no part of the `GatewayClient`
port, the provider-native routing split (ARCH-025), or the `RunStore`/`SecretResolver`/`SystemProbe`
port family. The one new production dependency, `acorn` (ARCH-148), is a **pure**, single-call-site
function (`workflow-meta.ts` is its only consumer) with `deps: —` — it does not need the injectable-
port treatment this codebase gives to every *impure* boundary (network fetchers, the sandbox, secrets,
the clock), and ADR-068 already names its own escape hatch (swap to the hand-mask option (b)) if the
dependency is overruled at review. I flag this only to say explicitly that I checked it against the
codebase's established pattern and it's a correct exception, not an oversight — a design-stage reader
auditing "why isn't this a port like everything else" should find the answer already written down
(possibly worth one sentence in ARCH-148 itself, since every other boundary in this document explains
its port-vs-not choice and this one currently doesn't).

**Agent altitude — unaffected.** No model/provider coupling is introduced or removed by this slice.

**One genuine replaceability-relevant move, correctly scoped:** ADR-145's reversal of the P6-3 ban on
`args.<k>.default` removes a policy that had nothing to do with mechanism (the ban existed only
because the default was served-but-not-applied) — this is the dimension's spirit even though it isn't
literally a swap-the-backend case: it un-couples a validation rule from an implementation gap that no
longer exists, rather than leaving dead policy debt in the contract module.

## (3) Consumability

This is where v35 does most of its work, and mostly does it well: ARCH-151 (guide teaches `null`-on-
failure + the self-protection idiom), ARCH-154 (`run_start`'s `args` description states the `{}`-on-
omission shape and where a default can come from), ARCH-152 (`instructions` field, computed guide
size, not transcribed), ARCH-147 (computed worst-case wait) are all "documentation-as-interface" fixes
answering a concretely measured integration failure (`jev-haiku` v2 dying on `args.url` against `null`;
a cold subject budgeting 60000ms against an actual 120000ms wait). ARCH-154's choice to export
`ENVELOPE_NOTE` as one constant consumed by both the guide and the handshake is exactly the single-
source-of-truth move the dimension asks for (one wording, not two chances to drift).

**Gap worth raising:** REQ-079 ("every new/changed MCP tool schema precisely self-describes params,
options, and effects") is in this slice's stated closure set. ARCH-154 updates `run_start`'s `args`
description. I don't see an equivalent update to `run_result`'s or `run_status`'s tool description
documenting the two **new response fields** this slice adds — `error: {code,message,detail?}` and
`failedAgentCount`. Since MCP tool schemas describe *input* JSON Schema and this system's
`structuredContent`/`outputSchema` is explicitly deferred to v36 (ADR-070), the *only* place a cold
caller can learn these two fields exist before parsing `content[0].text` and discovering them by luck
is prose on the tool description or the guide. Right now neither ARCH-151 nor ARCH-154 names them.
This is a small, closure-line-respecting addition (documentation only, no schema/behavior change,
same shape as ARCH-154's existing two sentences) — I'd propose it lands as an additional Gate-3/4/5
constraint (this slice already grew its constraint list from 10 to 11 items during self-review; this
would be a 12th) rather than a new ARCH row, to avoid relitigating scope.

**Agent altitude:** the double-JSON-encoding disclosure (ARCH-152/154) and the `null`-check idiom
(ARCH-151) are both textbook "structured, well-typed I/O + a clear SDK so other software can invoke
its reasoning like an ordinary function" fixes — no further gap here.

## (4) Self-sustainability

**System altitude — deliberately minimal, and v35 doesn't relitigate that stance (correctly).** This
codebase's standing decision (v3, reaffirmed through v12-v15) is "no in-process watchdog, no
autoscaling, no custom circuit breaker beyond the existing bounded timeout→retry→null fold; restart-
on-failure is the supervisor's job." v35 adds nothing that argues against this, and I'm not proposing
to reopen it. **One v35 item IS a self-sustainability improvement worth naming as such even though no
ARCH row labels it that way:** ARCH-142's restart-safe `result()` fix — a rehydrated `failed` run no
longer contradicts its own status field after a crash/restart — is exactly "recovering cleanly from a
disruption without losing operational integrity," the system-altitude half of this dimension, applied
to the diagnostic path rather than the execution path.

**Agent altitude — mostly N/A by system shape, and worth saying so explicitly rather than forcing
memory-metabolism language onto a system that doesn't have long-lived agent memory.** Each `agent()`
call is a fresh headless SDK session; there is no persistent cross-turn agent memory to compress or
archive, so "memory metabolism" in the literal sense doesn't apply here. **The one real analog is
already on the panel's radar and worth a second flag:** `workflow_authoring_guide` is the piece of
context every cold agent must ingest before authoring correctly, it is already ~39.5KB, and ARCH-152's
own note observes it's "assembled from constants that change every iteration" — i.e., it grows
monotonically across iterations by construction, with no segmentation or summary-access path (ADR-070
explicitly rejected that for v35 as under-evidenced, filing it as a v36 candidate). That's the shape
of a slow-motion context-blow-up problem — the same failure mode "memory metabolism" exists to prevent,
just at the authoring-guide layer instead of a conversation-memory layer. I'm not asking v35 to solve
it (ADR-070's evidence bar is right: one 39.5KB document isn't yet a measured cap being exceeded), but
I'd want the v36 filing to say explicitly that this is a self-sustainability/agent-memory-metabolism
concern, not just a "nice to have segmented accessor," so it isn't lost or under-prioritized against
purely functional v36 candidates when that iteration is scoped.

## Risks (summary, ranked)

1. **Medium** — write-ordering between the SQLite `error` column and the `journal.jsonl` error line
   inside `recordError` is unspecified; a crash between them reintroduces a smaller version of the
   exact "disk has nothing to check" symptom REQ-205 exists to remove. Ask for an explicit order +
   a kill-between-writes test.
2. **Low-medium** — `run_result`/`run_status` response-shape documentation gap for the two new fields
   (`error`, `failedAgentCount`); undermines REQ-079's closure claim for a cold client that hasn't
   read the architecture doc.
3. **Low** — no dashboard surface for `failedAgentCount`, asymmetric with the new `error` rendering.
4. **Low, filed not blocking** — authoring-guide size growth as a memory-metabolism-shaped risk;
   already tracked as a v36 candidate, flagged here so the self-sustainability framing isn't dropped.
5. **Informational** — per-agent failure code/message parity with the new run-level error channel
   should be confirmed as already-covered-elsewhere or explicitly out of REQ-207's closure line.

## Expected disagreements with other lenses

- **Adversarial/security lens** will likely push back on risk #2 and #3 as scope creep past this
  slice's closure discipline (both REQs' acceptance text is satisfied without them) — I'm framing both
  as *constraints on the existing Gate-3/4/5 list* rather than new ARCH rows for exactly that reason,
  but expect a round-2 argument over whether that list should grow again.
- **Adversarial lens** may consider the crash-ordering point (#1) already implicitly resolved by
  Node's single-threaded execution (no interleaving inside one synchronous method unless an `await`
  sits between the two writes) and treat my request for an explicit ordering statement + test as
  belt-and-suspenders; I'd want to see the actual method body before conceding that, since
  `appendFileSync` and a `better-sqlite3` statement are both synchronous but a crash (process kill,
  not a JS exception) can still land between two statements regardless of async-ness.
- I do **not** expect disagreement on the acorn-as-pure-function-not-a-port conclusion, or on leaving
  the system-altitude self-sustainability stance untouched — both match this document's own stated
  precedents closely enough that I'd be surprised if another lens reopened them.
