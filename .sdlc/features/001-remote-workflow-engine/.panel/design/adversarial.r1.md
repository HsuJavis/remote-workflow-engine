# Design panel — Adversarial group (Interface-contract × Boundary/error × Testability), round 1

**Iteration**: v23 (REQ-101..106), Gate 3+4 merged (Tasks + Detailed Design).

**Dispatch disclosure — read this first.** This file **replaces** the committed pre-run v23 archive at
the same path; the prior content is recoverable at `git show ba3db17:<this path>` (nothing was
`git checkout`-ed or restored into the tree — CLAUDE.md's prohibition observed). Repo state at the
moment of writing, which the dispatch template did not describe: **Gate 3+4 already passed for v23**
(`state.yaml current_stage: tests`), `03-tasks.md` **does** exist and carries `TASK-113..124`,
`04-design.md` carries `DES-120..135`. The re-dispatch is consistent with commit `ba3db17`
("adjudication #1 — phase names go public on every surface, owner-ruled", 19:21, *after* the 15:58/16:08
panel files), whose own message records: *"Scope consequence recorded for the design re-run."* I have
therefore written this as a **fresh round-1 proposal that incorporates adjudication #1**, not as a
re-issue of the superseded file.

**Independence discipline, stated honestly.** "Independent" means independent of the other panelist and
of the synthesis. I did **not** read the bodies of `04-design.md §v23` or `03-tasks.md §v23`; I did see
their **section headings**, and I read the **tail of `journal.md`**, while establishing repo state
(unavoidable — that is how I learned Gate 3+4 had run). Both exposed me to prior conclusions: the
headings telegraphed `curateToolsForProvider` and the scratch-`cwd` nuance, and the journal tail
summarised four corrections the earlier panel had made, which overlap my F1/F3/F5/F7. Stating that
plainly rather than claiming a purity I do not have. What I *can* claim: **every one of those four was
re-derived from `src/` today**, and the line numbers below are ones I read myself, not ones I copied —
so the findings are independently evidenced even where they are not independently discovered. F2, F4,
F6, F8–F15 had no such exposure. I did not read `.panel/design/quality-dimensions.*`.

**Primary source read for this proposal, line numbers verified today:** `src/gateway/client.ts`,
`src/gateway/claude-agent-sdk-client.ts`, `src/types.ts`, `src/clock.ts`, `src/errors.ts`,
`src/workflow-view.ts`, `src/workflow-catalog.ts`, `src/mcp-facade.ts`, `src/workflow-meta.ts`,
`src/run-store.ts`, `src/store/sqlite-run-store.ts`, `src/server.ts`, `src/dashboard-page.ts`,
`src/agent-executor.ts`, `tests/integration/schema-drift.test.ts`.

**Proposed DES numbering**: I propose `DES-1xx` slots for the items in §3–§4 (eight interface-contract,
eight boundary/error), each with its coverage named in §5. The synthesizer
owns the final numbers and the merge with whatever already exists; the *content* of each item is what I
am proposing.

---

## 0. Altitude judgment (required before the lenses are applied)

`tech_stack` + REQ-101..106 make this **both** altitudes, and the split is not even:

- **Plain-system altitude (the majority of the surface).** A SQLite table, a pure projection, two MCP
  tool schemas, one HTTP route swapped for another, one config block, one enumerated deletion. Every one
  of my three lenses applies unchanged: literal signatures, a closed error set, pure functions under
  unit test with an injected `Clock`.
- **AI-agent-system altitude (where the risk concentrates, and it is new).** ARCH-079 makes the engine
  itself an LLM **consumer** for an internal control surface: the input is attacker-influenced (an
  author's script), and the output is republished as engine-authored fact to principals REQ-100 forbids
  from reading that input. At this altitude my lenses re-read as: *interface-contract* = what exactly is
  a "label" and what exactly is in the allowlist (a fuzzy contract here is a security hole, not a style
  nit); *boundary/error* = the model is a boundary that fails in shapes an HTTP client does not (empty,
  prose, oversized, non-string, hostile-but-well-formed); *testability* = the security property must be
  provable **with zero model involvement**, because an assertion that depends on a live model is an
  assertion that will be deleted the first time it flakes.

The two altitudes **conflict once**, and I resolve it in §6/C1: the plain-system instinct is to keep
`AgentOpts` stable; the agent-system instinct is that an untyped widening cast on the tool field is the
single most dangerous line in this slice.

I do **not** apply a functional-safety or cybersecurity-lifecycle altitude: `safety_class: QM`.

---

## 1. Summary

The architecture is, in my judgment, unusually well-argued and I attack it in exactly the places where it
is *specific enough to be wrong*. I propose no new component beyond the three ARCH already names, and I
delete none. What I bring to Gate 3+4 is **fifteen findings against primary source**, of which four are
"the architecture describes a mechanism that does not exist in this codebase", three are "the contract is
ambiguous in a way that decides a security property", and the rest are the boundary states ARCH left
open. Five of them are, in my reading, **blocking for design** — they cannot be discovered at Gate 6
without rework:

| # | finding | severity | why it cannot wait |
|---|---|---|---|
| F1+F2 | `curateToolsForProvider([], <non-anthropic>) === ['Bash']`, and the analyzer's tool field is an **untyped cast** that **fails open** to the deployment's default tool set | **HIGH** | ADR-020's "the default blast radius is nil" is false on this deployment's own default path |
| F4 | the analyzer journal line **has no sink**: one store silently drops it, the other writes an unreadable orphan directory | **HIGH** | ADR-016's entire observability buy-back and ARCH-085's wiring-gap signature are absent-by-construction, and the two tiers fail *differently*, so no unit test can catch it |
| F8 | a generation job in flight across a `deregister` **re-creates an orphan diagram row** | **HIGH** | ADR-021's "an orphan is unrepresentable" is the slice's own claim; a same-transaction delete cannot cover a write that has not happened yet |
| F11 | ARCH-080's "every label **token**" is ambiguous, and the word-level reading is bypassable | **HIGH** | it is the definition of the security control; picking it at Gate 6 means picking it without a test |
| F5 | adjudication #1's `phases` ruling reaches `WorkflowPublicView` but ARCH-081's `WorkflowDescribeView` **still omits `phases`** | **MEDIUM-HIGH** | the two-sided key oracle would then *forbid* on describe what the diagram inside describe renders — the exact drift REQ-101 exists to prevent |

Everything else I propose is small, and my Karpathy tie-break kills more than it adds: I decline a status
surface, a retry daemon, a cache, a second projection, a new store, and an `ANALYZER_DISABLED` error code
I myself proposed and then withdrew (§6/C2).

---

## 2. Findings against primary source (the evidence half)

Each finding names the file and line I read today, the architectural sentence it contradicts, and the
cheapest correct design response. The design items in §3–§5 are downstream of these.

### F1 — `graphAnalyzer.tools: []` does not produce a tool-less session (`claude-agent-sdk-client.ts:223-227`)

```
export function curateToolsForProvider(tools: string[], provider: string | undefined): string[] {
  if (provider === undefined || provider === 'anthropic') return tools;
  const filtered = tools.filter((t) => !NON_ANTHROPIC_EXCLUDED_TOOLS.has(t));
  return filtered.includes('Bash') ? filtered : [...filtered, 'Bash'];
}
```

For any **known non-Anthropic** provider — which is this deployment's documented real case (Ollama via
LiteLLM, per `state.yaml tech_stack`) — an explicitly-empty tool set is curated **up** to `['Bash']`.
ADR-020's decision ("`tools` defaults to `[]`… the default blast radius is nil") is therefore
**falsified on the default path**: the analyzer's session, whose prompt is attacker-authored script text,
would ship Bash-enabled. Note the asymmetry that makes this easy to miss: an **unknown** provider
(`provider === undefined`) returns the empty set unchanged, so a test that invokes with no alias
configured passes while the real deployment does not.

**Response**: an explicitly-empty tool set is an intentional statement and must survive curation —
`if (tools.length === 0) return tools;` ahead of the curation branch. This is a **latent fix to a shared
function that predates v23**, so it is proposed as its own design item and its own task (§7), landing
strictly before the analyzer, with a **gateway-level** test (`curateToolsForProvider([], 'ollama')`)
because an analyzer-level test cannot see it.

### F2 — the analyzer's tool field is an untyped cast that **fails open** (`claude-agent-sdk-client.ts:478-481`, `types.ts:44-63`)

```
const baseTools =
  (req.opts as AgentOpts & { allowedTools?: string[] }).allowedTools ??
  this._config.defaultAllowedTools ??
  BUILT_IN_CORE_TOOLS;
```

Two facts compose badly. (i) The field is **`opts.allowedTools`**, not `opts.tools` — `GraphAnalyzerConfig`
calls the key `tools` (REQ-104's word), so the analyzer must *map* it, and the mapping is the kind of
one-liner that gets written wrong. (ii) `AgentOpts` (`types.ts:44`) **does not declare `allowedTools`**;
the call site widens it with a cast. So a mis-mapped key is **not a type error** — it silently falls
through to `defaultAllowedTools`, which `state.yaml` records as including `Read`/`Write`/`Bash` in real
configs. The failure direction is *open*, and it is invisible to `tsc`.

**Response**: declare `allowedTools?: string[]` on `AgentOpts` and delete the cast. This does not widen
the contract — the cast already treats the field as part of it; declaring it removes a lie. Then the
analyzer's `cfg.tools → opts.allowedTools` mapping is type-checked, and the analyzer keeps an assertion
on the **built options object** (below, §5/T4), because a gateway-level test cannot see a mis-map and a
mapping test cannot see F1.

### F3 — ARCH-079's "explicit scratch `cwd`" is not expressible through `invoke()` (`client.ts:93-97`, `claude-agent-sdk-client.ts:535/549/581/494`)

`invoke()`'s parameter object is `{prompt, opts, runId, agentId, signal?, workspace?, onHarness?, onEvent?}`
— **there is no `cwd`**. The SDK client computes `cwd: req.workspace ?? this._config.cwd` (`:535`), and
uses the same expression to root `canUseTool` (`:549`) and the `PreToolUse` hook (`:581`). So ARCH-079's
pairing — "**no `workspace`**, and an explicit scratch `cwd`" — is not merely unimplemented, it is
**self-cancelling**: omitting `workspace` is exactly what makes `cwd` fall back to the gateway's
configured cwd, which is the engine's own process directory. That is this repo's recorded
MEMORY.md/CLAUDE.md workroot-leak class, arrived at from the opposite direction.

**Response**: the analyzer passes `workspace: <scratchDir>`, a per-job empty directory under `workRoot`,
and that *is* the scratch cwd. One consequence to record rather than engineer around: `materializeAssets`
(`:494`) fires whenever `workspace` is set **and** `assetRoot` is configured, so the analyzer's scratch
dir would receive a copy of the server's `.claude/skills|hooks`. With `allowedTools: []` (F1/F2) the
session makes no tool calls, so hooks never fire and skills are never read — the copy is **inert**.
Adding an `assets:false` flag to `invoke()` to suppress it would be new contract surface for a
zero-consequence copy: **declined** (Karpathy), recorded as a reasoned residual, with a cleanup of the
scratch dir in a `finally`.

### F4 — the analyzer journal line has **no sink** (`run-store.ts:190-194`, `store/sqlite-run-store.ts:114-117`, `:266-273`)

ARCH-079 invariant 5 and ADR-016 both rest on "**one journal line per analyzer run**" — it is the entire
observability the design buys back after refusing transcripts, *and* it is ARCH-085's stated wiring-gap
signature for REQ-104 ("an operator who edits `graphAnalyzer.model` sees the new model on the very next
line"). The engine's only journal API is `RunStore.appendJournal(runId, entry)`, and the analyzer has no
run — ARCH-079 gives it a **synthetic** `runId`. What actually happens:

- `InMemoryRunStore.appendJournal` (`run-store.ts:190-194`): `const run = this._runs.get(runId); if (!run) return;`
  — **silently drops** every analyzer line. This is the unit tier.
- `SqliteRunStore.appendJournal` (`sqlite-run-store.ts:114-117`): `mkdirSync(this._runDir(runId))` +
  `appendFileSync(.../journal.jsonl)` — **creates an orphan run directory** per analyzer invocation. The
  index table is never written, and `listRuns()`/`hydrateAll()` read the index (`:266-273`), so the line
  is unreadable by any surface that exists. This is the real tier.

So the observability is **absent by construction on both tiers, and absent differently**, which means no
unit test can catch it and a real run would only show the *absence* of something nobody is looking for.
This is the `composeConfig` wiring-bug class the requirement itself names (REQ-104), relocated into the
observability channel — and REQ-104's Gate 7.5 acceptance would still pass via the *diagram* changing,
so the gap would ship.

**Response**: give the analyzer its **own** one-method sink rather than borrowing a run-scoped one.
`interface AnalyzerLogSink { record(line: AnalyzerLogLine): void }`, default implementation = a single
structured `console.log('[GraphAnalyzer] …')` line — the process already logs exactly this way
(`[RunStore] hydrateAll: …`, `sqlite-run-store.ts:271`), so this adds no mechanism, and it is injectable,
which makes the line **assertable** (§5/T5). No new table, no new store, no new route. Cheapest thing
that is actually true.

### F5 — adjudication #1 reaches two key sets and misses the third (`workflow-view.ts:33-52`, requirements §REQ-100 AMENDED)

Verified: `WorkflowPublicView` (`:33-44`) has **no `phases`**, and `EXPECTED_NON_OWNER_KEYS` (`:48-52`)
does not list it — which independently confirms the premise of adjudication #1 (ADR-015's "phase names
are already served to non-owners by v22's masked `workflow_get`" was **false**). The owner ruled
一律公開. But ARCH-081's enumerated `WorkflowDescribeView` — written before the adjudication — **also has
no `phases` field**. Left as-is, the outcome is precisely the drift REQ-101 exists to forbid: the
describe response's own two-sided oracle (`EXPECTED_DESCRIBE_KEYS`) would **reject** `phases` as a leaked
field, while the `diagram` string *inside that same response* renders the phase titles.

Second half, easy to miss: the amendment's text names `/api/workflows/:name/skeleton` as a surface that
must stop masking phases — but **REQ-105 deletes that route**. The amendment's second surface is
therefore its successor, `/api/workflows/:name/describe`. Design must say this in one sentence so nobody
"restores" masking on a route that no longer exists, and so nobody reads the deletion as a way to dodge
the ruling.

**Response**: `phases: Array<{title: string}>` joins **three** key sets in one change —
`WorkflowPublicView` + `EXPECTED_NON_OWNER_KEYS`, and `WorkflowDescribeView` + `EXPECTED_DESCRIBE_KEYS` —
plus the unmasking at `server.ts:1079`. One adjudication, one task (§7), three literal oracles.

### F6 — the `/api/*` routes are **not** auth-gated; they are unauthenticated and self-masking (`server.ts:1025`, `:1080`, `:1140`)

ARCH-083 and ARCH-084 both say `/describe` is "auth-gated exactly as the route it replaces". The route it
replaces is not auth-gated. `server.ts:1025` and `:1080` say it plainly — *"this route carries no
bearer/identity"* — and the handler branches on `authEnabled` to choose **what to disclose**, not whether
to answer. (The same is true of the `/api/runs/:id/dag` path at `:1140`, which is why v22's H2 fix took
the shape it did.) An implementer reading "auth-gated" will look for a bearer check that is not there, or
worse, add one and break the dashboard.

**Response**: state it correctly in DES — `/api/workflows/:name/describe` is **unauthenticated and
therefore pinned to the non-owner projection unconditionally** (`viewerIsOwner` is not a parameter it
can vary). The "one projection, both call sites emit the identical object" test must compare the route's
body against the MCP tool invoked with `ctx = {authEnabled: true, principal: null}` — comparing against
an owner call would pass for the wrong reason and hide a divergence.

### F7 — the `maxWorkflowVersions` **prune** does not exist (`workflow-catalog.ts:342-346`, `:389-391`)

ARCH-077 says diagram rows are deleted "inside their existing `db.transaction()`" by `deregister()` **and
the `maxWorkflowVersions` prune**. The ceiling is a **refusal**, not a prune:

```
if (maxWorkflowVersions !== undefined && count >= maxWorkflowVersions)
  → codedError('VERSION_CEILING_EXCEEDED', …)
```

There is no per-version deletion path anywhere in the catalog. The only deletion is `deregister()`
(`:389-391`), which drops **all** versions of a name in one transaction. Building against ARCH-077 as
written means writing a hook into a function that does not exist.

**Response**: DES names **one** deletion site — `deregister()`'s existing transaction gains
`DELETE FROM workflow_diagrams WHERE name = ?` — and states explicitly that no per-version prune exists,
so ADR-021's growth bound holds *through the refusal ceiling*, not through eviction. One site is also
what makes F8 tractable.

### F8 — the late write: an in-flight job re-creates a row for a deregistered workflow

ARCH-077/ADR-021's load-bearing claim is that "an orphan row is unrepresentable" because the delete rides
the same transaction as the version row. That covers rows that **already exist**. It does not cover the
write that has not happened yet: `enqueue` → (job in flight) → `deregister(name)` commits →
`putDiagramResult(name, version, …)` lands afterwards and **inserts a diagram row for a workflow that no
longer exists**. There is no foreign key (`workflow_diagrams` is a fresh `CREATE TABLE IF NOT EXISTS` in
the same file, and the existing tables at `:144`/`:177` carry none), so nothing at the storage layer
refuses it. The row then never dies: the only deletion path (F7) is keyed on a name that is already gone.

**Response**, cheapest-first and structural rather than swept: `putDiagramResult` performs its write
**inside a transaction with an existence guard** — write only where a `workflow_versions` row for
`(name, version)` still exists; otherwise no-op. Then the orphan is unrepresentable in the sense ADR-021
actually claims, for both orderings. A job-level cancellation check is *not* proposed on top: it is a
race that the guard already settles, and a second mechanism would be two things to keep correct.
Boundary test in §5/T6.

### F9 — the states ARCH-082's `regenerate()` leaves open

Four, and each needs one sentence in DES rather than an implementer's guess:

1. **Regenerate while a job for the same `(name, version)` is already queued or in flight.** ARCH-079
   says "single-flight, concurrency 1", which bounds *parallelism*; it does not say the queue de-dupes.
   Without de-dup, an owner clicking twice queues two model calls for one row. **Single-flight must be
   keyed on `(name, version)`**: an enqueue for a key already present is a no-op returning the current
   status.
2. **Regenerate on a version that was never enqueued** (registered while `enabled:false`, or predating
   v23): permitted, flips `pending`. This is the migration path for every existing workflow and it is
   otherwise unspecified — without it, every pre-v23 version is permanently diagram-less with no recovery.
3. **Regenerate while `graphAnalyzer.enabled:false`**: see §6/C2 — resolved as a *successful* envelope
   reporting `unavailable`/`DISABLED`, not an error.
4. **Regenerate on an unknown `version` of a known name**: `UNKNOWN_VERSION` (the catalog's own code,
   `:485`), never `WORKFLOW_NOT_FOUND`.

### F10 — `sweepAtBoot`'s "one requeue, then unavailable" has no persisted attempt marker

A process that dies mid-generation leaves `status='pending'`. The sweep requeues it once. If the process
dies again — the *likely* case, since a crash mid-generation is often caused by the generation — the next
boot sees the identical row and requeues again: an unbounded crash-loop amplifier, and "one requeue" is
unrepresentable in the schema as ARCH-077 defines it.

**Response**, with no new column: the sweep **writes `generated_at` when it requeues** (the column is
already NULLable and is only meaningful for `ready` rows today). A boot then sees three distinguishable
shapes — `pending` + `generated_at IS NULL` = never swept, requeue once; `pending` +
`generated_at` older than this process's boot time = already swept by a previous life, settle
`unavailable/RETRIES_EXHAUSTED`; `pending` + a stamp from this boot = a live job, leave alone. Boot time
comes from the injected `Clock`, so the whole rule is unit-testable with `FixedClock`.

### F11 — "every label **token**" is the security definition, and the word-level reading is bypassable

ARCH-080 accepts a diagram iff "every label token is a member of `allowedLabels`". The phrase has two
readings and they are not equally safe:

- **Word-level** (split the diagram on whitespace, test each word): a multi-word phase title —
  `phase("rotate the production signing key")` — puts six **individual words** into the allowlist. The
  model may then recombine them into a sentence that was never in any source, inside a node label. A
  content-*absence* claim (ADR-015's whole point) does not survive this, and the more prose an author
  writes into phase titles, the wider the vocabulary gets.
- **Whole-label** (parse the diagram by its own grammar; a *label* is the text inside a box or after a
  fixed annotation prefix; each extracted label, whitespace-normalized, must be an **exact member** of
  `allowedLabels`; every character outside a label position must be a `DIAGRAM_CODEPOINTS` structure
  glyph or whitespace): recombination is impossible, because a label is compared as a unit.

**Response**: DES pins the **whole-label** reading, with the extraction grammar written out (it is a
handful of regexes over a fixed vocabulary, and it is pure). This also gives `GATE_REJECTED_SHAPE` its
precise meaning — a diagram whose glyphs do not parse into label positions is a *shape* failure, and a
diagram that parses but whose label is not a member is a *content* failure, which is exactly the
security/degradation split ARCH-080 wants the reason code to carry. Without this, the two codes are
assigned by feel.

### F12 — "resolved model per agent" is not statically derivable (`workflow-meta.ts:135-160`)

`SkeletonNode` carries `{kind, title?, workflow?, parallel?, dynamic?}` — **no model**. An agent's model
can come from an options literal in the script, from an `agentType`'s frontmatter (resolved at server
startup, `src/agent-definitions.ts`), or — since v21 — from a **tunable param** supplied per run. So the
engine cannot compute the value REQ-102 asks the diagram to show, and the *model* (which reads the raw
script) can only guess it.

**Response**: the allowlist's model component is exactly *the configured alias names* ∪ `default` ∪ one
literal sentinel (`⟨param⟩`). A diagram naming anything else is `GATE_REJECTED_CONTENT` — which is the
correct classification, since an invented model name is model-authored text that is not in any engine
source. And REQ-102's clause is honoured as: *the model named in the script or its agentType, or the
sentinel when it is run-time-determined* — **never an invented resolution**. One sentence in the shipped
`systemPrompt`, one clause in DES, zero new machinery.

### F13 — `GatewayResult`'s failure branch carries no tokens, and `content` is `unknown` (`client.ts:61-79`)

Success is `{ok:true, provider, model, tokens:{input,output}, content: unknown, events?}`; failure is
`{ok:false, provider, reason:'timeout'|'unreachable'|'terminal', detail?, events?}` — **no tokens**. Two
consequences for the contract:

1. The journal line's `promptTokens`/`completionTokens` are `number | null`, not `number`; the S-1 cost
   attribution ADR-016 promises holds on the **success** path only. Say so, rather than shipping a line
   whose zeros are indistinguishable from a real zero.
2. `content` is `unknown`. The engine's existing habit is `String(result.content)`
   (`agent-executor.ts:391`), which turns an object into `"[object Object]"` — that string would reach
   `gateDiagram`, fail as `GATE_REJECTED_SHAPE`, and thereby **misreport a plumbing bug as a
   model-degradation signal**, corrupting the one counter ARCH-080 built for replaceability.
   **Response**: the analyzer requires `typeof content === 'string'`; anything else settles
   `unavailable` with its own note code. A non-string completion is a *defect*, not a degradation, and
   the two must not share a counter.
   `detail` on the failure branch is provider text and, per ADR-016, **must not** reach the note, the
   response, or the log line — only an engine-classified error class derived from `reason`.

### F14 — the advertised error set omits a code the resolver actually returns (`workflow-catalog.ts:59`, `mcp-facade.ts:268-279`)

`ResolveErrorCode = 'INVALID_CHANNEL' | 'UNKNOWN_VERSION' | 'CHANNEL_UNPUBLISHED' | 'DANGLING_CHANNEL'`.
The v23 interface table lists the first three for `workflow_describe` and omits **`DANGLING_CHANNEL`** —
a code the shared resolver can genuinely produce. A closed error set that omits a reachable code is
precisely the drift the drift-lock exists to catch, and it will be caught by the *user*, not the test.

Also: `workflow_get` already establishes the correct ladder (`mcp-facade.ts:268-279`) — unknown **name**
→ `WORKFLOW_NOT_FOUND`; a **known** name with an unresolvable selector surfaces the real typed code
rather than being swallowed. `workflow_describe` must reproduce it **by extracting the shared shaper**,
not by hand-rolling a third copy (`errors.ts:52-60` records that this project already paid for exactly
that lesson once, for the create-time ingress ladder).

### F15 — the script leaves the process on every registration

The deployment view says "registration now performs an outbound LLM call". The sharper statement, which
DEPLOY.md owes an operator and which I did not find made anywhere: **the payload of that call is the
workflow script itself** — the artifact v22 spent an iteration masking from other principals. Against
engine principals the mask holds; against the configured provider it does not exist. For a
`graphAnalyzer.model` that resolves to a hosted provider, every `workflow_register` ships the author's
script off-host. This is not a defect — it is inherent to the feature the owner asked for — but it is an
operator-visible property with an existing control (`enabled:false`) and it belongs in DEPLOY.md and
AUTHORING.md as one sentence each, not discovered later.

---

## 3. Lens (a) — Interface-contract: the signatures I propose, literally

**DES-A1 — `AgentOpts` declares `allowedTools`; `curateToolsForProvider` preserves an intentional empty set.**
`types.ts`: `allowedTools?: string[]` added to `AgentOpts`, and the widening cast at
`claude-agent-sdk-client.ts:478` deleted. `curateToolsForProvider` gains one leading line:
`if (tools.length === 0) return tools;`. Compatibility: additive to an interface whose only consumers are
in-repo; the cast already treated the field as present. (F1, F2.)

**DES-A2 — `GraphAnalyzerConfig`, its defaults, and the one mapping.**

```ts
export interface GraphAnalyzerConfig {
  enabled: boolean;      // default true
  model: string;         // default 'default' (the alias map's own default entry)
  systemPrompt: string;  // default = the shipped vocabulary prompt, exported as a named constant
  tools: string[];       // default []  — ADR-020
  timeoutMs: number;     // default 60_000
  retries: number;       // default 1
  maxQueueDepth: number; // default 16 — ARCH-079's "bounded queue depth", named so it is tunable
  maxBytes: number;      // default 8_192  — ARCH-080's caps, config-visible for the same reason
  maxLines: number;      // default 120
}
```

Every field is **required** on the internal type and defaulted **at exactly one place** (`main.ts`'s
`composeConfig`), never at the read site — a second default site is how two callers come to disagree.
The mapping to the gateway is one line and is now type-checked: `opts.allowedTools = cfg.tools`.
`maxQueueDepth/maxBytes/maxLines` are lifted into config rather than hard-coded because REQ-104's rule is
"**no analyzer harness value is hard-coded in engine source**", and a cap is a harness value.

**DES-A3 — `GraphAnalyzer`'s class API, with the seams in the constructor.**

```ts
class GraphAnalyzer {
  constructor(deps: {
    gateway: GatewayClient;
    catalog: WorkflowCatalog;
    triggerBindings: (name: string) => Promise<{bindings: TriggerBinding[]; bindingsFp: string}>;
    clock: Clock;
    log: AnalyzerLogSink;
    config: GraphAnalyzerConfig;
    scratchRoot: string;
    schedule?: (fn: () => void) => void;   // default setImmediate — the run-now seam
  });
  enqueue(name: string, version: string, script: string): void;      // returns after the pending write
  regenerate(name: string, version: string): Promise<DiagramRow>;    // same job path, de-duped
  sweepAtBoot(): Promise<void>;
}
```

`triggerBindings` is injected **as a function**, not as a module import: it is the only way the analyzer
is unit-testable without three SQLite files, and it keeps ARCH-078's "two call sites" honest.

**DES-A4 — `gateDiagram`, unchanged in shape, sharpened in contract.**

```ts
export function gateDiagram(
  raw: string,
  allowedLabels: ReadonlySet<string>,
  limits: {maxBytes: number; maxLines: number},
): {ok: true; diagram: string} | {ok: false; reason: 'GATE_REJECTED_CONTENT' | 'GATE_REJECTED_SHAPE'};
```

Pure, no clock, no I/O, no logging (a gate that logs is a gate that leaks). Order of the four checks is
part of the contract because it decides the reason code: **size caps → codepoint membership → grammar
parse → label membership**; the first three fail `SHAPE`, the last fails `CONTENT`. Returns the input
**verbatim** on success — no trimming, no normalization — so what is stored is what was gated. (F11.)

**DES-A5 — `WorkflowDescribeView` + `EXPECTED_DESCRIBE_KEYS`, with `phases`.**
ARCH-081's field list, **plus `phases: Array<{title: string}>`** (F5), and with no `script` member in the
type at all so a leak is a `tsc` error. `EXPECTED_DESCRIBE_KEYS` is a flattened, sorted, literal array
living **in the module under test** (the `workflow-view.ts` precedent at `:48-52`), never re-declared at
a call site. `diagramStatus` is the literal union `'ready' | 'pending' | 'unavailable'`.

**DES-A6 — `DiagramNoteCode`: a closed enum with a *total* renderer.**

```ts
export type DiagramNoteCode =
  | 'PENDING' | 'DISABLED' | 'TIMEOUT' | 'PROVIDER_UNREACHABLE' | 'PROVIDER_ERROR'
  | 'RETRIES_EXHAUSTED' | 'QUEUE_FULL' | 'GATE_REJECTED_CONTENT' | 'GATE_REJECTED_SHAPE'
  | 'MALFORMED_COMPLETION';
export function noteTextFor(code: DiagramNoteCode): string;   // total: a `Record<DiagramNoteCode, string>`
```

Implemented as an exhaustive `Record`, not a `switch` with a `default` — a `default` arm is what lets a
new member ship with no text. `MALFORMED_COMPLETION` exists because of F13 and must **not** be folded
into `GATE_REJECTED_SHAPE`.

**DES-A7 — `AnalyzerLogLine` and its sink.** (F4.)

```ts
export interface AnalyzerLogLine {
  name: string; version: string; principal: string | null; model: string;
  promptTokens: number | null; completionTokens: number | null;   // null on every failure branch
  durationMs: number; outcome: 'ready' | 'unavailable'; noteCode: DiagramNoteCode | null;
  errorClass?: 'timeout' | 'unreachable' | 'terminal';            // engine-classified, from `reason`
}
export interface AnalyzerLogSink { record(line: AnalyzerLogLine): void }
```

Default: one `console.log('[GraphAnalyzer] ' + JSON.stringify(line))`. **No provider text, no `detail`,
no prompt, no script fragment** — the type has no field that could carry one, which is the enforcement.

**DES-A8 — catalog accessors and the guarded write.** (F7, F8.)
`putDiagramPending`, `putDiagramResult`, `getDiagram`, `listPendingDiagrams` as ARCH-077 names them, with
two contract corrections: `putDiagramResult` is a **guarded** write (no-op when the `(name, version)`
version row is gone), and the deletion story is **one site** — `deregister()`'s existing transaction —
with the DES stating in terms that no per-version prune exists in this codebase.

---

## 4. Lens (b) — Boundary/error: the states, and what each returns

**DES-B1 — the settle table.** Every terminal state of a generation job, written as a table so that the
implementer has nothing to invent and the test has something literal to iterate:

| trigger | `status` | `note_code` | `diagram` | log `outcome` |
|---|---|---|---|---|
| gate passes | `ready` | `null` | the verbatim gated string | `ready` |
| `enabled:false` at enqueue | `unavailable` | `DISABLED` | `null` | `unavailable` |
| queue at `maxQueueDepth` | `unavailable` | `QUEUE_FULL` | `null` | `unavailable` |
| `timeoutMs` elapsed on the last attempt | `unavailable` | `TIMEOUT` | `null` | `unavailable` |
| `ok:false, reason:'unreachable'` | `unavailable` | `PROVIDER_UNREACHABLE` | `null` | `unavailable` |
| `ok:false, reason:'terminal'` | `unavailable` | `PROVIDER_ERROR` | `null` | `unavailable` |
| retries exhausted / swept twice | `unavailable` | `RETRIES_EXHAUSTED` | `null` | `unavailable` |
| `content` not a string | `unavailable` | `MALFORMED_COMPLETION` | `null` | `unavailable` |
| gate rejects, label not a member | `unavailable` | `GATE_REJECTED_CONTENT` | `null` | `unavailable` |
| gate rejects, caps/codepoints/grammar | `unavailable` | `GATE_REJECTED_SHAPE` | `null` | `unavailable` |
| row written at enqueue, job not yet run | `pending` | `PENDING` | `null` | — |

Invariant restated as a check, not a hope: **`diagram IS NOT NULL` iff `status = 'ready'`**, asserted
directly against the table in a test, not only through the accessor.

**DES-B2 — single-flight is keyed on `(name, version)`; a duplicate enqueue is a no-op.** (F9.1.)

**DES-B3 — `workflow_regenerate_diagram`'s contract.** Owner-gated through the **existing**
`resolveWritePrincipal` + `principalRequiredEnvelope` helpers (`server.ts:812`/`:821`, already three call
sites at `:874`/`:880`/`:887` — this becomes the fourth, and that shared-helper reuse is the point).
Errors: `NOT_WORKFLOW_OWNER`, `PRINCIPAL_REQUIRED`, `UNKNOWN_VERSION`, `WORKFLOW_NOT_FOUND`. Disabled
analyzer → **success envelope** reporting `unavailable`/`DISABLED` (§6/C2). Permitted on a version that
was never enqueued (F9.2) — this is the only migration path for pre-v23 versions and it must be named.

**DES-B4 — `workflow_describe`'s error ladder, extracted not copied.** (F14.) Unknown name →
`WORKFLOW_NOT_FOUND`; known name + bad selector → the resolver's own code, **including
`DANGLING_CHANNEL`** in the advertised set. Extract the shaper `workflow_get` already implements at
`mcp-facade.ts:268-279` and call it from both, so the two cannot drift.

**DES-B5 — the boot sweep's three shapes.** (F10.) Stated as the `generated_at`-as-attempt-marker rule
above, with the boot instant taken from the injected `Clock`.

**DES-B6 — trigger-binding boundary values.** From ARCH-078's own corrections, restated as required
render rules so they are testable: a chain whose upstream run has been purged is
`{kind:'chain', upstreamWorkflow: null}` and renders as an **unnamed** chain — never an invented name,
and never omitted (omission would read as "no trigger"); a workflow with **no** binding renders an entry
node that reads as a direct `workflow_run` invocation; `webhooks.secret` and the webhook `id` are absent
from the projected type **by construction**, so no masking step exists to forget.

**DES-B7 — `diagramStale` is defined on every branch.** When `status !== 'ready'` there is no
`bindings_fp` to compare. `diagramStale` is `false` in that case (there is no diagram to contradict the
live bindings) — and *this must be written down*, because the alternative reading (`true`, "we don't
know") is equally defensible and two implementers will choose differently.

**DES-B8 — the empty diagram.** A model that returns `""` or only whitespace passes a naive codepoint
check. Explicitly `GATE_REJECTED_SHAPE`: a zero-label diagram is not a diagram, and honest absence must
be reported as absence rather than as a blank `ready`.

---

## 5. Lens (c) — Testability: every DES coverable, every seam named

**T1 — the seams, enumerated.** `Clock` (injected everywhere the analyzer reads time: `generated_at`,
`durationMs`, the boot instant for F10); `GatewayClient` (an interface already — a fake returning a
canned `GatewayResult` needs no HTTP); `schedule` (default `setImmediate`, overridden to a synchronous
runner so the job settles inline); `AnalyzerLogSink` (an array-collector in tests); `triggerBindings` as
a function (no SQLite in a unit test); `catalog` (a real `better-sqlite3` on a temp dir — it is fast and
mocking the transaction would mock the thing under test).

**T2 — `gateDiagram` is the security test, at the unit tier, with zero model involvement.** Fixtures:
(a) a hostile hand-written "diagram" containing a secret literal in a node label → `GATE_REJECTED_CONTENT`;
(b) the **recombination** fixture that F11 exists for — a diagram whose every *word* appears in
`allowedLabels` but whose *label* does not → must be `GATE_REJECTED_CONTENT` (this fixture is red under
the word-level reading and green under whole-label, which is exactly what makes the choice testable);
(c) ANSI/CSI escapes, C0 controls, RTL override, zero-width joiner → `SHAPE`; (d) `<pre>`-hostile `<`/`&`
→ `SHAPE`; (e) oversize by bytes and by lines → `SHAPE`; (f) empty/whitespace → `SHAPE` (DES-B8);
(g) the happy path → `ok`, returned **byte-identical** to the input.

**T3 — the acceptance test asserts literal absence, per carried-in rule 1.** The secret-bearing script
registers; the assertion is `expect(diagram).not.toContain('SEKRIT-9F2A')` on the **exact literal**, plus
the same for the distinctive prompt sentence and the `appendPrompt` string — never
`not.toContain(wholeScript)`, which passes when a fragment leaks (the recorded v21 defect). And per
adjudication #1, a **companion** test asserts the opposite direction for phase titles: a secret placed in
a phase title **does** appear, pinning the owner's 一律公開 ruling as a *documented* disclosure. If that
ruling is ever revisited, this test goes red and names the decision — which is the correct failure mode.

**T4 — the analyzer's isolation is asserted on the built options object, not on behaviour.** A fake
`GatewayClient` captures the `invoke()` argument; the test asserts literally:
`opts.allowedTools === []`, `workspace === <scratchDir>`, and that `onEvent`, `onHarness`, and `signal`
are **absent**. Behavioural assertions ("no transcript appeared") pass vacuously when the call never
happened; a literal argument assertion does not. Paired with the **gateway-level** test
`curateToolsForProvider([], 'ollama')` → `[]` (F1), because neither test can see the other's failure.

**T5 — the journal line is asserted by read-back, never by a call-spy.** (F4.) The injected sink collects
lines; the test asserts one line per generation with the **exact** model string from config, and
`promptTokens === null` on a failure fixture. A spy on `appendJournal` would have passed today against a
sink that drops the line — which is precisely how this gap survives.

**T6 — the late-write race gets a real integration test, not a seam test.** (F8, and this is where my own
lenses conflict — §6/C4.) Enqueue with a gateway fake that resolves on a released promise; `deregister`;
release; assert `getDiagram()` is `null` **and** `SELECT COUNT(*) FROM workflow_diagrams` is 0. Run this
one through the **real** `setImmediate` path, so the production scheduling is exercised at least once.

**T7 — the two call sites emit the identical object.** `expect(httpBody).toEqual(await facade.workflow_describe(args, {authEnabled: true, principal: null}))`
— against the **non-owner** context (F6), which is the only context the route can produce.

**T8 — the two-sided key oracle.** `expect(Object.keys(deepFlatten(resp)).sort()).toEqual(EXPECTED_DESCRIBE_KEYS)`
catches a leaked field **and** a dropped `lockedKeys`/`diagramStatus`/`phases`. Plus the three status
values asserted **literally** as a set, never inferred from the two absence branches (rule 1).

**T9 — the deletion guard is mechanical and its allowlist is literal.** A test greps `src/` for
`skeleton` case-insensitively and fails on any hit outside a three-entry allowlist written **in the test
as literal paths** (`workflow-meta.ts`, `dashboard.ts`, the auth-gated dag path in `server.ts`); a second
assertion walks the **served** `tools/list` (the surface, not the `TOOL_DEFS` object — the precedent is
`tests/integration/schema-drift.test.ts:5`) and asserts the word appears in no description and no
input-schema string.

**T10 — both new tool schemas join the served-`tools/list` drift-lock**, asserting structured facts
(every param named with type and default; the description states outright that the script is
deliberately not returned) rather than a golden string — same policy as the existing lock, so a doc tweak
does not red the build but a dropped field does.

**T11 — `noteTextFor` totality**: a test iterates the `DiagramNoteCode` union and asserts a distinct,
non-empty text for each member. Adding a member without text is red at the tier that costs nothing.

**T12 — REQ-104's real run is a Gate 7.5 task with a written procedure**, not a unit test: edit
`systemPrompt`, re-register, **no redeploy**, diagram visibly changes, and the `[GraphAnalyzer]` log line
names the **new** model. The old model still appearing is the wiring-gap signature — which only exists at
all if F4 is fixed.

---

## 6. The internal conflicts between my own three lenses (as required, argued not smoothed)

**C1 — Interface-contract *vs.* Testability, on `AgentOpts.allowedTools` (F2).**
Testability wants the field declared so a mis-map is a `tsc` error. Interface-contract objects that
`AgentOpts` is a widely-shared type that crosses the sandbox IPC boundary as opaque JSON, and widening a
stable type to serve one internal caller is how types rot. **Resolution: declare it.** The cast at
`:478` already treats the field as part of the contract; the type is currently *lying about a field that
exists*. Declaring it removes a lie rather than adding surface, and the IPC boundary carries `opts`
opaquely, so nothing downstream changes. Karpathy: fewer distinct concepts afterwards than before.

**C2 — Boundary/error *vs.* Karpathy, on `ANALYZER_DISABLED` (F9.3).**
My boundary lens wants an owner who calls a recovery action against a disabled analyzer to receive a
*distinguishable* answer, and drafted an `ANALYZER_DISABLED` error code. Simplicity objects that REQ-104
says `enabled:false` is "never an error", and that a new error member for a state the response body
already describes is a second way to say one thing. **Resolution: withdraw the code.** `regenerate`
returns a **successful** envelope whose body is `{diagramStatus:'unavailable', diagramNote: noteTextFor('DISABLED')}`.
The owner learns exactly why, REQ-104's clause is honoured at its literal reading, and the closed error
set stays at four members. I record this as a concession my own boundary lens lost.

**C3 — Interface-contract *vs.* consumability-flavoured simplicity, on `DANGLING_CHANNEL` (F14).**
Simplicity says: do not advertise an error a user can neither trigger deliberately nor act on.
Interface-contract says: the advertised set must equal the set the shared resolver can return, or the
drift-lock is comparing against a fiction. **Resolution: advertise it.** One enum entry versus a
documented lie; the lie is more expensive, and the drift-lock is the mechanism that would otherwise be
asserting the wrong union.

**C4 — Testability *vs.* Boundary/error, on the `schedule` seam (T1 vs. T6).**
The `schedule` seam is what makes the analyzer deterministic — and it is also what guarantees that the
**production** scheduling path is never exercised. F8's late-write race lives precisely in the real async
path; a suite that always runs the job inline can never see it. **Resolution: the seam is the default for
unit tests and is explicitly *not* used by one integration test** (T6), which lets the job actually race a
`deregister`. Stated as a rule so a later "let's make the suite faster" pass cannot quietly convert the
last real-path test into a seamed one.

**C5 — Interface-contract *vs.* Boundary/error, on `maxBytes`/`maxLines`/`maxQueueDepth` in config (DES-A2).**
Interface-contract wants a small config surface — six keys is what REQ-104 names, and every added key is
a key an operator can set wrong. Boundary/error notes that REQ-104's actual words are "**no** analyzer
harness value is hard-coded in engine source", and a cap on model-authored text is a harness value; a
hard-coded 8 KB is a value an operator with a different model class cannot fix without a redeploy —
which is the exact failure REQ-104 exists to prevent. **Resolution: lift them into config with defaults.**
The requirement's word is "at minimum", so this is inside its bounds, and the marginal cost is three
defaulted numbers in one place.

---

## 7. Karpathy tie-break: what I decline to build, and task-splitting guidance

**Declined** (each with the reason, so a later reader does not re-propose it): a status/effective-config
readback surface (F4's one log line is the same signal and needs no route or trust tier — and this
codebase has **no admin tier**, verified: authorization is owner-vs-non-owner); automatic retry with
backoff (`retries` already exists; a second loop against a failing provider is unbounded spend); lazy
regeneration on describe (turns a universally-callable read into a spend primitive); any diagram cache /
`inputs_fp` (ADR-018 is right, and my F8 guarded write is cheaper than the cache would have been); a
standalone `DiagramStore` (ADR-021's transaction argument is correct — I verified the idiom at
`workflow-catalog.ts:193/333/389/489`); a diagram GC/TTL/orphan reaper (F8's guard makes the orphan
unrepresentable, which is strictly better than reaping it); an `assets:false` flag on `invoke()` (F3 —
the copy is inert with `allowedTools: []`); a job-level cancellation check on top of F8's guard; a second
render path (A2); a `describe({brief:true})` projection for home cards (noted in ARCH, not needed until
measured — and a second projection is the drift REQ-101 forbids).

**Task-splitting guidance** (the synthesizer owns `03-tasks.md`; these four splits are load-bearing for
my lenses and I would call a merge of any of them a defect):

1. **The `curateToolsForProvider` + `AgentOpts.allowedTools` fix is its own task, landing strictly
   before the analyzer task.** It is a latent security fix to a shared function that predates v23; buried
   inside the analyzer's task it becomes invisible in review and it does not land if the analyzer slips.
   Its test is gateway-level and cannot live in the analyzer's test file.
2. **Adjudication #1 (`phases` public) is its own TASK/DES pair**, amending v22's shipped surface
   (`workflow-view.ts` + `EXPECTED_NON_OWNER_KEYS` + `server.ts:1079` + `workflow_get`), landing **before**
   the diagram task — the diagram's allowlist should point at a field that is already public, not
   anticipate one.
3. **`diagram-gate.ts` first among the new files.** It is pure, it is the security control, it is
   testable with zero infrastructure, and every later task's fixtures depend on its grammar.
4. **The skeleton deletion + CI grep guard is one task, not distributed across the six modules that lose
   it.** Split by module, a partial deletion passes every module's own test — which is the ledger's
   nine-instance defect class reproduced by the task breakdown itself.

---

## 8. Risks

- **R1 (high, mine to own).** If F11 is resolved word-level, the slice ships a security control that does
  not hold, with a green test suite — the worst available outcome, because ADR-015 will be *cited* as the
  control.
- **R2 (high).** If F4 is not fixed, REQ-104's Gate 7.5 run still passes (the diagram visibly changes),
  so the missing observability ships **and** the wiring-gap signature the design relies on for future
  config work does not exist. A gap that survives its own acceptance test is the expensive kind.
- **R3 (medium).** F1+F2 compose into a Bash-enabled session whose prompt is attacker-authored text. Both
  halves must land; either alone leaves the other's failure reachable.
- **R4 (medium).** The shipped `systemPrompt` assumes a model class. On this deployment's real case
  (`qwen2.5:7b`) vocabulary compliance degrades first, so **honest absence may be the common path** and
  `GATE_REJECTED_SHAPE` may be the common code. That is correct behaviour and a poor first impression;
  DEPLOY.md must say so, and F13's `MALFORMED_COMPLETION` must stay separate or the counter that would
  tell an operator this is happening gets polluted by plumbing bugs.
- **R5 (medium).** F15: every registration ships the script to the configured provider. Inherent, not a
  defect — but undocumented it is a surprise, and the control (`enabled:false`) is one an operator can
  only choose if they know.
- **R6 (low).** v22 debt: `chain_create` validates no workflow at all, so a diagram may faithfully draw a
  trigger from a non-existent upstream. **Render it verbatim, never "correct" it** — a diagram that
  silently fixes reality is worse than one that shows it.

---

## 9. Expected disagreements with the quality-dimensions lens

I have not read their file. Predicting from their dimensions:

1. **Observability — they will want more than one log line.** Likely: an effective-config readback, a
   diagram-generation metrics surface, or the analyzer enrolled in per-agent observability with masking.
   **I hold**: ADR-016 is right that a second implementation of a mask is a drift bug, and my F4 shows the
   *existing* single line does not even work yet. Fix the one line before adding a second surface. I
   expect to concede nothing here beyond agreeing the line must be **readable**, which is my own finding.
2. **Self-sustainability — they will want automatic recovery.** Likely: retry-with-backoff, or a periodic
   sweep for `unavailable` rows. **I hold** ADR-017's owner-gated regenerate, and offer F10's
   `generated_at`-as-attempt-marker as the *bounded* form of the closed-loop concern they are right to
   raise. If they push, the concession I am willing to make is F9.2 (regenerate permitted on a
   never-enqueued version), which I already propose and which covers their migration case.
3. **Replaceability — they may want a vocabulary-conformance checker.** **I agree it is already built**:
   `GATE_REJECTED_SHAPE` is that predicate, run on every generation rather than at audit time. I expect
   agreement here.
4. **Consumability — on `phases`, we may split.** They may argue for masking phase titles, or for a
   `brief` describe projection for the home cards. **I hold**: the owner ruled 一律公開 at `ba3db17` and
   re-litigating it is out of the panel's remit; and a second projection re-opens the drift REQ-101
   exists to close. Where I expect them to be **right** and me to concede: they will likely notice that
   the *dashboard home card* now fetches a full describe per card (ARCH's own note), and if they propose
   the projection be `brief` **only after a measurement**, that matches my Karpathy position exactly.
5. **The likeliest genuine fight: F11's cost.** Whole-label matching makes the gate stricter, which means
   more `GATE_REJECTED_CONTENT` on legitimate diagrams from a weak local model, which reads as a
   *consumability/replaceability* regression from their lens ("the feature mostly shows honest absence").
   My answer is that a control that fails **closed** and is noisy is a control; one that fails open and is
   quiet is decoration — and R4 means the shipped default prompt, not the gate, is where that noise
   should be tuned.
6. **Where I expect them to catch me**: I have deliberately not designed the `systemPrompt`'s content
   beyond naming `DIAGRAM_CODEPOINTS` as its shared constant. If their lens produces a concrete prompt
   whose output shape matches my grammar in F11, that is strictly better than what I brought, and I will
   take it.
