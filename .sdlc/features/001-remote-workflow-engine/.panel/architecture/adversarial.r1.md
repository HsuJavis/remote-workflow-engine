# Architecture panel — Adversarial group (Security × Scalability × Testability), round 1

**Iteration**: v23 (REQ-101..106) — `workflow_describe`, agent-drawn diagram, config-separated analyzer,
skeleton retirement, AUTHORING.md.
**Lens**: adversarial trio. Each section argues its own lens; §6 states where the three lenses fight
each other and how I break the tie. Karpathy simplicity-first is the tie-breaker: minimum architecture
that closes the requirement, nothing speculative.

---

## 0. Altitude call (do this first, per the panel brief)

`tech_stack` describes a Node/TS HTTP+JSON-RPC server, SQLite (WAL, better-sqlite3), an auth subsystem,
a sandbox, a scheduler — **a conventional system**. It *also* describes `agent()` dispatch through two
GatewayClients into real LLMs, a curated tool surface, prompt/harness records — **an AI-agent system**.
So both altitudes apply, and they apply to *different parts* of v23.

The thing that makes v23 architecturally novel, and which every lens below turns on:

> **v23 is the first iteration where the engine itself is an LLM consumer for an internal control
> surface.** Until now every agent call was *the user's workflow* running *the user's prompt*, and the
> engine was the referee. The analyzer (REQ-102/104) is the engine calling a model **on attacker-
> influenced input** (an author's script) and then **publishing the model's output to other
> principals** (REQ-101) as if it were engine-authored fact.

That inverts the trust direction the whole codebase is built around. Concretely, at agent altitude:
non-determinism, prompt injection, honest absence, cost, and model replaceability are now *engine*
properties, not workflow properties. At system altitude: a new async job, a new table, a new read
projection, a new config block — all of which land in this ledger's two best-documented defect classes
(the `composeConfig()` wiring gap; the "deletion isn't finished while something still describes the
deleted thing" gap).

Everything in the lens template about JWT forgery / brute force / distributed failure counters is
**not** this iteration's surface and I do not force it. The real v23 attack surface is: prompt injection
via author scripts, the diagram as an exfiltration channel around REQ-100's mask, cost amplification via
registration, and injection-into-renderer (ANSI/terminal escapes, DOM) via a model-authored string.

---

## 1. Summary

Six components, one new table, one new config block, no new subsystems.

1. **`DiagramStore`** — `workflow_diagrams(name, version, status, diagram, note_code, generated_at,
   inputs_fp, PRIMARY KEY(name, version))`, in the existing `catalog.db`. `workflow_versions` stays
   append-only/immutable (ADR-009); the diagram is *derived*, mutable, and therefore must not live in
   the immutable row. Keyed by `(name, version)` so REQ-102's "never served against a different
   version" is a **schema property**, not a code discipline.
2. **`TriggerBindings` aggregator** — one pure-ish reader `getTriggerBindings(name)` over the existing
   schedules / webhooks / continuations tables, returning a normalized snapshot + a `bindingsFp`
   fingerprint. **Two call sites, one function**: it feeds the analyzer at generation time and serves
   the live-bindings field at describe time. One function is what stops the generated view and the
   served view of triggers from drifting (the same anti-drift argument REQ-101 makes for the mask).
3. **`GraphAnalyzer`** — a *dedicated internal invocation path* straight onto `GatewayClient.invoke`
   (not `AgentExecutor`, see §2.4), bounded by its own `timeoutMs`/`retries` from config, single-flight
   with concurrency 1, no secret resolution, no seeded workspace, empty tool surface by default.
4. **`diagram-gate.ts`** — a **pure** function
   `gateDiagram(raw, allowedLabels, limits) -> {ok:true, diagram} | {ok:false, reason: GateReason}`.
   This is the security control. Everything the model authored passes through it; nothing else does.
5. **`projectWorkflowDescribe()`** — one projection in the `workflow-view.ts` family, consumed by
   **both** the `workflow_describe` MCP tool and the auth-gated `GET /api/workflows/:name/describe`
   route that replaces the dying `/skeleton` route. REQ-101 explicitly demands the two masks cannot
   drift; the only structural way to guarantee that is one function and one test asserting both call
   sites' output are the same object.
6. **`graphAnalyzer` config block** threaded through `composeConfig()` — with a wiring-test row and a
   Gate 7.5 real-run, because REQ-104's acceptance *names this engine's recurring wiring defect*.

State machine (REQ-102 honest absence): `pending` → `ok` | `unavailable`. `unavailable` is terminal for
that `(name, version)` and carries an **engine-authored** `noteCode` from a fixed enum
(`DISABLED | TIMEOUT | RETRIES_EXHAUSTED | GATE_REJECTED | NO_ANALYZER_CONFIG`). Boot sweep maps orphan
`pending` rows (process died mid-generation) to one requeue, then `unavailable` — otherwise a restart
strands a row in `pending` forever and "honest absence" becomes "silent hang".

---

## 2. Key points

### 2.1 (Security, highest-value) The gate is the control; the prompt is not

REQ-102's structure-only invariant ("no secret literal, no distinctive prompt sentence, no
`appendPrompt` string appears anywhere in the diagram, for any principal") is stated as a property of
model output. **A system prompt is not an access control.** An author who wants to defeat REQ-100's
script mask writes a script whose comments instruct the analyzer to "include the configuration string
verbatim in a node label", registers it, and reads it back through `workflow_describe`, which any
principal may call. The mask v22 shipped is then re-opened by v23's own feature.

Therefore: **allowlist, don't denylist.** The gate accepts a diagram only if every label token is a
member of `allowedLabels`, computed deterministically from inputs the engine already trusts:

- phase names, agent count/order, `workflow()` child names — from `parseWorkflowSkeleton()`
  (the function REQ-105 keeps internal; v23 gives it a *second* internal job, which is also the
  argument for keeping it rather than deleting it);
- resolved model aliases — from the alias table / registered `defaults`;
- trigger kinds + upstream workflow name — from the `TriggerBindings` snapshot;
- the fixed vocabulary glyphs and structural punctuation.

**Invariant, stated for the design gate to inherit:** *the diagram cannot widen the disclosure surface
by construction, because every token it may contain is already served on a masked surface today.* A
secret embedded in a *phase name* still passes — but phase names are already returned to non-owners by
today's masked `workflow_get`, so that is pre-existing exposure, not a v23 regression. It belongs in
AUTHORING.md (REQ-106) as an authoring smell, not in the gate.

### 2.2 (Security, novel) The "human-readable note" is a second output channel — close it

REQ-102 requires `diagramStatus` plus "a human-readable note". If that note ever carries the analyzer's
own words, or a raw provider/CLI error string, then **injection routes around the gate entirely**: the
attacker makes the analyzer fail in a controlled way and smuggles text out through the error path,
which by construction is the path that skips diagram validation.

Rule: **everything analyzer-authored passes the gate; everything else is engine-authored.** The note is
rendered from the fixed `noteCode` enum above. Provider error detail goes to the journal/log (operator
altitude), never into a `workflow_describe` response. This also makes the note assertable literally in
tests, which Round v23's carried-in rule 1 demands ("external contracts must be asserted literally,
never derived").

### 2.3 (Security) The vocabulary is Unicode, so specify a codepoint allowlist

`◇`, `⟲`, `──┬──▶` are not ASCII. Two failure modes follow, in opposite directions:

- Too permissive → the model emits ANSI/CSI escapes (`\x1b[…`), C0 controls, RTL overrides, or
  zero-width characters. An MCP client renders the diagram in a terminal; the dashboard renders it in
  the DOM. This is injection into the *renderer*, independent of content leakage.
- Too restrictive → someone "fixes" it later with a naive strip-non-ASCII and destroys the vocabulary.

So define **one exported constant** `DIAGRAM_CODEPOINTS` (printable ASCII + the named box-drawing /
vocabulary glyphs + newline) used by three consumers: the gate, the *default* `graphAnalyzer.systemPrompt`,
and the AUTHORING/tool-description text. Plus hard `maxBytes` and `maxLines` caps (an unbounded
model-authored string is stored, served on every describe, and rendered in every home card).

Dashboard rendering must stay `textContent` into a `<pre>` — `dashboard-page.ts` is already
textContent-only by convention (KP-12) but has `innerHTML=''` clear patterns nearby; the diagram is the
first *model-authored* string to reach that renderer, so this needs an explicit design line and a test.

### 2.4 (Scalability + observability) A dedicated internal path, not the run pipeline

Tempting reuse: run the analyzer through `AgentExecutor` and get budget, redaction, and transcript for
free. **Reject** — for a concrete product reason, not purity:

- analyzer invocations would appear in run listings and **corrupt REQ-075's per-workflow success-rate
  and average-execution-time card metrics**, and pollute `workflow_status`;
- they would consume `maxConcurrentRuns` admission slots (REQ-054) meant for user work;
- they have no owner principal, no workspace seed, and no params contract — every `AgentExecutor`
  concept is inapplicable.

Instead: `GatewayClient.invoke()` directly, with the analyzer's **own** bounds (REQ-104 supplies
`timeoutMs` and `retries`), its own single-flight queue (`concurrency 1` default), and **one journal
line per analyzer run** so the engine's own LLM spend is observable rather than invisible. Invisible
engine-initiated model spend is a self-sustainability defect at agent altitude, and this engine already
has the scar (D-G8-4: a default gateway path with no bound of its own).

Isolation, non-negotiable: no `SecretValueProvider`, no provisioned secrets in env, no seeded workspace,
no CLAUDE.md-reachable cwd (the workroot-guard hazard already recorded in memory), tools `[]` by default.

### 2.5 (Scalability + REQ-104) Fingerprint = script ‖ bindings ‖ analyzer config

`inputs_fp = sha256(script ‖ bindingsSnapshot ‖ analyzerFingerprint)` where `analyzerFingerprint`
covers `model`, `systemPrompt`, `tools`, and the vocabulary constant.

This single field does three jobs and adds no machinery:
- **REQ-104's acceptance survives caching.** A cache keyed on script alone would return the pre-edit
  diagram after an operator changes `systemPrompt`/`model` — i.e. the acceptance ("re-register → the
  diagram visibly changes with no redeploy") would fail *because of* an optimization. Including the
  analyzer fingerprint makes the config edit a cache miss by construction.
- **REQ-103 staleness.** At describe time, recompute `bindingsFp` and compare: mismatch → serve the
  diagram with `generatedAt` + `diagramStale: true` alongside the **live** bindings field. This takes
  REQ-103's explicitly-offered second branch, and it is the minimum design: the alternative (regenerate
  on every schedule/webhook/chain mutation) couples three subsystems to the analyzer, multiplies LLM
  cost by trigger-churn, and buys nothing the stale flag doesn't.
- **Idempotence.** Re-registering byte-identical inputs under the same `name` reuses the stored result
  instead of making a second model call. Note the tension with REQ-102's letter ("a new version → its
  diagram is generated fresh"): the new version still gets **its own** `workflow_diagrams` row and the
  prior version's row is untouched, so the served-per-version guarantee holds either way. If the panel
  reads "generated fresh" as *must re-invoke the model*, **drop the skip** — it saves one call on a rare
  path, while the fingerprint's other two jobs (REQ-104 cache-bust, REQ-103 staleness) are the load-
  bearing ones.

**Explicitly rejected (Karpathy):** cross-workflow content-addressed dedupe by script hash. It saves
one model call in a scenario that barely occurs (registrations are rare, one call each), and it creates
a cross-principal oracle — principal B learns their script is byte-identical to principal A's by
observing an instant `ok`. Scalability lost this one to security, and simplicity agreed. See §6.

### 2.6 (Testability) Three seams, and the two tests that actually protect the iteration

Seams, all matching existing convention (`ServerConfig.proxyManager`, `queryImpl`, `Clock`):
`GatewayClient` injected into `GraphAnalyzer`; `Clock` injected for timeout/`generatedAt`; and a
`schedule` seam so tests run the job **inline/deterministically** instead of racing an async worker.
An async-by-default job with no run-now seam produces flaky tests, and flaky tests get deleted.

The two tests that carry the iteration:

- **`gateDiagram` is pure** → the security invariant (REQ-102/A3) is unit-testable with *zero* model
  involvement: feed a hostile "diagram" containing the secret, assert rejection. The acceptance test
  that registers a secret-bearing script and calls the real analyzer still exists, but it is not the
  only line of defense — and it must assert the *literal* absence string, per carried-in rule 1.
- **A mechanical REQ-105 guard.** REQ-105's real risk is the ledger's most-repeated defect (nine
  instances): the code is deleted, the *descriptions* survive. Make it executable — a test that greps
  `src/` for `skeleton` and fails on any occurrence outside an explicit internal allowlist
  (`workflow-meta.ts`, `dashboard.ts` layout, the auth-gated `/api/runs/:id/dag` path), plus an
  assertion that no MCP tool description or JSON schema string in the server's tool list contains the
  word. That converts a review-discipline problem into a CI failure.

Third: the **`composeConfig()` wiring row**. `graphAnalyzer` must be forwarded in the object literal and
asserted in `compose-config-v2-wiring.test.ts`. REQ-104 additionally (and correctly) refuses to accept a
unit test as proof and demands a Gate 7.5 real run — keep that, because the wiring defect class is
precisely one that passes unit tests.

### 2.7 (Lifecycle) The new table must not become the next stale second source

Delete `workflow_diagrams` rows on `workflow_deregister` and on `maxWorkflowVersions` pruning (v22
ARCH-071 already prunes versions). Otherwise v23 ships a derived store that outlives its source — the
exact defect class this ledger keeps re-recording. Cheapest correct form: `ON DELETE`-equivalent cleanup
inside the same transaction as the version prune, or a foreign key with cascade if the existing
migration tolerates it.

---

## 3. Risks

**R1 (HIGH, security).** *Analyzer output is a mask bypass.* Without §2.1's allowlist gate, REQ-100's
v22 script mask is re-opened by v23's own feature, via author-controlled injection. Mitigation is the
gate; residual risk is a secret placed in a phase name (already exposed today — document, don't enforce).

**R2 (HIGH, security).** *The status note is an ungated output channel* (§2.2). If any provider/model
text reaches `workflow_describe`, the gate is decorative.

**R3 (MEDIUM-HIGH, security×requirement conflict).** *`graphAnalyzer.tools` is admin-tunable by
REQ-104's letter.* A tool-enabled agent whose input is attacker-authored script text is an execution
primitive — with this engine's `defaultAllowedTools` including `Read`/`Write`/`Bash` in some configs,
that is arbitrary read/write in the engine's own process context, reached by registering a workflow.
I do **not** unilaterally forbid it (the requirement mandates the key). Proposal: **default `[]`**, a
loud boot warning when non-empty, and an ADR recording that a non-empty analyzer tool surface is an
accepted-risk operator decision. Flagged for owner ratification.

**R4 (MEDIUM, security).** *Cost / DoS amplification.* Registration now triggers a model call. Even
authenticated, a principal can drive unbounded LLM spend by re-registering versions. Mitigations, all
already-owned mechanisms: concurrency 1 + queue depth cap, the `inputs_fp` no-op on identical inputs,
`maxWorkflowVersions` as the natural per-workflow ceiling, and the analyzer's own `timeoutMs`. No new
rate-limiter subsystem — that would be speculative.

**R5 (MEDIUM, security, ESCALATED TO OWNER — not decided here).** REQ-101 lists **the owner** in a
response any principal may call. Owner is an email (`BOOT_BACKFILL_EMAIL` convention), so
`workflow_describe` becomes a PII/principal-enumeration surface. Masking it would contradict the
requirement as written, so I raise it rather than architect around it: *should the owner field be
full-value for all principals, or full for owner/admin and an opaque handle otherwise?* Same posture for
webhook identifiers in the live-bindings field: per REQ-058 the `/hooks/:id` id is not itself a
credential (the HMAC secret is), and `webhook_list` returns it — but that is an admin surface, whereas
describe is universal. Proposal for debate: show trigger **kind** always, and the webhook id masked
(`****3f2`, reusing the existing `secretFingerprint` idiom) unless caller is owner/admin.

**R6 (MEDIUM, renderer injection).** Model-authored text reaching a terminal and the DOM (§2.3).
Bounded by the codepoint allowlist + size caps; needs an explicit test, not a convention.

**R7 (MEDIUM, correctness/observability).** *Orphan `pending` after a crash.* Async generation with no
boot sweep converts "honest absence" into an indefinite hang that looks identical to "still working".
Boot sweep + a single requeue.

**R8 (MEDIUM, agent-altitude replaceability).** The default `systemPrompt` shipped in
`rwe.config.example.json` is tuned against one model. Swap `graphAnalyzer.model` to a weaker/local one
(this deployment's real case — Ollama `qwen2.5:7b`) and the gate rejection rate rises, so the honest-
absence path becomes the *common* path, not the exceptional one. That is not a bug, but it must be
observable: count gate rejections in the journal, and DEPLOY.md must say which model class the shipped
prompt assumes.

**R9 (LOW-MEDIUM, scalability).** `workflow_describe` aggregates catalog + versions + channels + params
+ diagram + three binding tables. The dashboard home view calls it per card. All reads are local SQLite
and the engine is single-process by design (no horizontal-scaling requirement exists in this ledger, and
I will not invent one), but the bindings aggregator should be a single batched read per call, and the
response needs a size bound. If home-card load ever bites, the fix is a `describe({brief:true})`
projection — noted, not built.

**R10 (LOW, requirement interaction).** REQ-103's "trigger bindings" depends on `chain_create`, which
per v22's own review (§8.2) *validates no workflow at all*. A chain binding may reference a
non-existent upstream workflow, and the diagram will faithfully draw a trigger to nothing. Carried debt,
not v23 scope — but the analyzer must render it verbatim rather than "correcting" it.

---

## 4. Expected disagreements with other lenses

**vs. the quality-dimensions lens (consumability / observability), predicted, four fights:**

1. *Richer diagrams vs. A3 structure-only.* They will want the diagram to summarize what each agent
   *does* (a label like "reviews the PR diff") because that is what makes it consumable. I oppose: any
   summarization capability is an exfiltration channel from a script the caller is forbidden to read,
   and A3 pinned structure-only for exactly that reason. My gate makes their version *impossible* by
   construction, which is the point of contention, not an accident. If the owner overrules A3, the
   architecture changes materially (the allowlist gate collapses to a denylist and R1 goes unmitigated).
2. *A prettier render vs. A2 one-artifact.* They will want Mermaid/SVG in the browser and ASCII for MCP.
   I hold A2: two render paths can disagree, and disagreement between two views of the same masked
   object is precisely the drift REQ-101 was written to prevent.
3. *A fallback vs. A1 honest absence.* When the analyzer fails, they will want *something* on screen —
   and the nearest something is the retired skeleton. That resurrects the artifact the owner asked to
   retire, on exactly the failure path, and would also re-open the REQ-105 surface. Hold A1.
4. *Analyzer `tools` for fidelity vs. my empty default* (R3). They will argue a `Read`-capable analyzer
   produces better diagrams for composed workflows. I argue that is an execution primitive reachable by
   registering a workflow.

**vs. a simplicity-purist reading of my own proposal:** someone will say the gate, the fingerprint, the
new table, and the boot sweep are four mechanisms where "just call the model and store the string"
would do. My answer: three of the four are *forced by requirement text* (versioned storage by REQ-102's
never-serve-across-versions; the fingerprint by REQ-104's no-redeploy acceptance; the sweep by REQ-102's
honest-absence promise), and the fourth (the gate) is the only thing standing between v23 and undoing
v22. Nothing here is speculative infrastructure: no queue service, no cache tier, no distributed
anything, no second render path.

**My own internal conflicts, resolved:**

- *Scalability vs. security:* cross-workflow diagram dedupe by script hash — **security wins** (§2.5),
  and simplicity concurred; the load it optimizes does not exist.
- *Scalability vs. observability:* the analyzer skips `AgentExecutor`, so it also skips the transcript
  machinery — **resolved by adding one journal line**, not by re-entering the run pipeline (§2.4).
- *Security vs. testability:* an allowlist gate needs the label set, which needs `parseWorkflowSkeleton`
  — the function REQ-105 is retiring from user surfaces. **No conflict in the end**: REQ-105 retires the
  *surface*, and v23 gives the *function* a second internal consumer, which strengthens the case for the
  orchestrator's recorded boundary call rather than weakening it.
- *Security vs. consumability:* owner email and webhook ids in a universally-callable response —
  **not resolved by me**; escalated as R5, because deciding it unilaterally would contradict REQ-101's
  own acceptance text.
