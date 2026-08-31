# Architecture panel — Quality-dimensions lens, round 1 (independent proposal)

**Scope**: v21 slice, REQ-090..095 (parameter contract: declaration, validation, wiring repair,
effort end-to-end, appendPrompt composition, workflow-bound issue reports). Deliberately
slice-scoped: whole-system gaps (metrics endpoint, streaming, healthz, OpenAPI) were adjudicated
out-of-slice in v15 and are NOT re-raised here.

**System-vs-agent determination (required first)**: this project is **both**. The engine itself is a
conventional system (hand-rolled JSON-RPC-over-HTTP server, SQLite RunStore/Catalog, sandbox child
processes, LiteLLM gateway) — the *system* altitude applies to the contract validator, error
taxonomy, and catalog. But v21's subject matter — `model`, `effort`, `timeoutMs`, `appendPrompt`,
harness descriptors, per-agent transcripts — is configuration OF spawned Claude-Agent-SDK agents, so
the *agent* altitude applies with equal force: prompt composition order, provider mapping of effort,
and the inspectability of what each agent actually dispatched with. Each dimension below states
which altitude carries the point.

## Summary

v21 is, at its core, an **observability-debt repayment iteration wearing a feature's clothes**: both
live defects being repaired (resolveHarnessParams zero callers; `effort` advertised-but-unread) are
instances of the *silent no-op* class — the engine claimed a behavior, echoed it back on query
surfaces, and never applied it, and nothing in the run record could reveal the lie. The architecture
must therefore not merely wire the two gaps but design the seam that makes this bug class
**structurally self-revealing**: the harness descriptor should record *per-key provenance* (which
precedence rung supplied each effective value), the contract must live in **one pure, reusable
validation module** (v22 channels and v23 `workflow_describe` both consume it), errors must be
**self-describing** (carry the violated bound so a caller self-corrects in one round-trip), and
registration-time validation must be paired with a **submission-time liveness recheck** (a stored
default can go stale when provider config changes). All four dimensions converge on the same
architectural object: a first-class, engine-owned **EffectiveHarnessParams resolution step** with
one entry point, one precedence algorithm, and one observable output.

## (1) Observability — transparency of internal state

*Altitude: primarily agent (what did the spawned agent actually run with?), with a system-altitude
point on rejected submissions.*

**O-1. Per-key provenance in the harness descriptor (the load-bearing proposal).**
REQ-092 pins a four-rung precedence chain: per-call `agent()` opts › per-run `overrides` ›
registered `defaults` › engine default alias. The repaired wiring bug is the **fourth** occurrence
of the composition-root silent-no-op class (v11 `updateFlagPath`, v15 `auth`, v16 `workspaceTtlMs`,
now `resolveHarnessParams` at `src/harness-defaults.ts:90` with zero `src/` callers). The existing
guard (`compose-config-v2-wiring.test.ts`) catches config forwarding; nothing catches *precedence
resolution* silently short-circuiting a rung. Proposal: the `HarnessDescriptor` already journaled
per agent (`agent-executor.ts:347`, surfaced top-level by `mcp-facade.ts:205`) gains a
`provenance: Record<key, 'call'|'override'|'default'|'engine'>` field written by the resolution
step itself. Then REQ-092's acceptance ("observable in the harness descriptor … not merely in
`workflow_get`'s echo") is checkable per-key at Gate 7.5, and a future fifth wiring miss surfaces
as `provenance.model:'engine'` where a test expects `'default'` — the defect class becomes
observable instead of dormant. Cost: one small object per agent record; no new surface.

**O-2. `effort` must be honest in both directions.** REQ-093 already demands the descriptor record
the *applied mapping* and explicitly record non-application on providers with no equivalent. Endorse
and sharpen: the descriptor field should be tri-state (`applied: {param, value}` | `notApplied:
{reason}` | absent-because-not-requested), never a boolean — "effort was silently dropped" and
"effort was never asked for" must be distinguishable in the transcript, or we rebuild the same
documented-no-op we are repairing.

**O-3. Rejected submissions currently vanish by design — decide, don't drift.** REQ-091 requires
`PARAM_LOCKED`/`PARAM_OUT_OF_RANGE` **before any durable work** (no run row, no workspace). Correct
for resource hygiene, but it means an author cannot see that users are repeatedly tripping over the
contract (exactly the feedback loop v21 exists to serve, and REQ-086 gives us a principal to
attribute). Proposal: a bounded, in-memory (or ring-buffer journal) rejection counter per
{workflow, errorCode}, exposed on the existing status surface — NOT a durable run row. If the panel
deems even this out-of-slice, the gap must be recorded as an accepted residual, not left implicit.

**O-4. appendPrompt observability rides the transcript.** REQ-094's "observable in the captured
transcript prompt" is sufficient — the composed prompt already lands in the per-agent transcript
(`workflow_agent_log`). No new mechanism needed; the descriptor should simply carry
`appendPromptBytes` (length, not content) so a size-cap dispute is diagnosable without replaying the
transcript.

## (2) Replaceability — decoupling & pluggability

*Altitude: agent for R-1 (LLM-backend decoupling is the whole point of effort mapping); system for
R-2/R-3.*

**R-1. Effort mapping belongs in the provider profile seam, never in the executor.**
`ProviderProfile.effortMapping` already exists (`src/session-options-builder.ts:18`) and is unread —
the correct fix is to make *that* seam real, not to branch on provider names in `agent-executor.ts`.
Anthropic-mapped aliases get their native control; OpenAI/Gemini/Ollama get their profile's mapping
or an explicit no-op entry. Adding a provider with a new effort dial must be **config (a profile
entry), not code** — this is the agent-altitude replaceability invariant (GPT↔Claude↔local model is
a config change) applied to a single knob, and it is what keeps REQ-093's "provider-appropriate
mapping" from ossifying into a switch statement.

**R-2. One pure contract module with three consumers.** The params-contract validator (parse
`meta.params`, reject locked keys, merge precedence, range-check overrides and declared `args`) must
be a pure, dependency-free module — not logic braided into `server.ts` dispatch or
`submission-validator.ts` ad hoc. Known future consumers: v21 run submission, v22 registration-time
static checks (D14 moves them there when inline script closes), v23 `workflow_describe`. Design the
seam once: `contract.ts` exporting `parseParamsBlock`, `validateOverrides`,
`resolveEffectiveParams` — the last being the ONLY place the four-rung precedence lives, so REQ-092's
per-rung test pins one function.

**R-3. Locked-key list is data, not scattered literals.** `prompt|tools|skills|mcp|workdir|cwd`
(D12) will be checked at registration (REQ-090), at submission (REQ-091), and described read-only
(v23). One exported const, three consumers — otherwise v22/v23 drift is guaranteed.

## (3) Consumability — ease of use & low integration cost

*Altitude: both — the MCP tool surface is consumed by agents (Claude Code) as much as by humans.*

**C-1. REQ-090 IS the consumability requirement — return the contract as typed, structured data.**
The declared contract on `workflow_get`/`workflow_list` should be a stable JSON shape
(`{name, type, default, enum?|min?|max?, unit?}` per knob, plus the always-present four global
knobs) — effectively a mini JSON-Schema the *calling agent* can validate against locally before
submitting. This is the agent-altitude "invoke reasoning like a function" goal: an orchestrating
agent reads the contract and composes a valid `workflow_run` with zero trial-and-error.

**C-2. Self-describing rejections (one-round-trip repair).** `PARAM_OUT_OF_RANGE` must carry
`{param, supplied, allowed}` (the violated enum/range inline) and `PARAM_LOCKED` must carry
`{param, tunable:[...]}` — so a caller (human or agent) repairs the call from the error alone
instead of a second `workflow_get`. This matches the engine's established typed-error envelope
practice (REQ-027/030) and the shipped #24 self-description pattern. An error that only
names the code is a consumability defect for agent callers, who otherwise burn a tool-call round
trip per knob.

**C-3. Backward-compat defaults are load-bearing.** REQ-090 no-`params`-block ⇒ four global knobs;
REQ-091 no-`overrides` ⇒ byte-identical pre-v21 behavior; REQ-093 no-`effort` ⇒ byte-identical
composition. Endorse strongly: existing callers pay **zero** migration cost, which is the correct
consumability posture for a surface Claude Code agents already script against. The architecture
should add one drift-lock: the MCP tool descriptions (`server.ts:361/398`) must be regenerated from
the same contract-module types (the #24 self-description pattern), not hand-edited — advertised-but-
unread `effort` was exactly a docs/behavior split.

**C-4. REQ-095 closes the feedback loop cheaply.** `workflow:<name>` label + `name@version` in body
reuses the existing GithubIssueClient envelope — right-sized; the only consumability note is that
`issue_list({workflow})` filtering should tolerate the not-registered-name case symmetrically with
`issue_report` (report-then-list on a just-deregistered name must round-trip).

## (4) Self-sustainability — closed-loop autonomy & lifecycle

*Altitude: system for S-1/S-2; agent for S-3. Thinnest dimension for this slice — noted honestly;
no invented autoscaling asks.*

**S-1. Registration-time validation goes stale; submission needs a liveness recheck.** REQ-088/090
validate `model` aliases and tool allowlists at *registration*, but provider config (alias map,
LiteLLM backends) changes over the workflow's lifetime — a registered default can reference an
alias that no longer resolves. Without a recheck, the failure moves mid-run (agent → null after
gateway timeout) instead of failing typed at submission. Proposal: `resolveEffectiveParams` re-
validates the *effective* (post-merge) params against *current* engine config at submission and
refuses with the existing typed taxonomy (`PARAM_OUT_OF_RANGE` or a distinct `DEFAULT_STALE`) —
this is the tool-liveness-check idea applied to stored configuration, and it keeps long-lived
registered workflows self-consistent without human sweeps.

**S-2. Graceful degradation already in the REQs — endorse, don't duplicate.** REQ-093's
effort-degrades-to-no-op-with-honest-record and REQ-094's size-cap-refusal-not-truncation are the
slice's degradation surface, correctly specified. The one addition: the appendPrompt cap must be a
named config key (documented in DEPLOY §1 like every other bound), not a code literal — bounds that
operators can't see or tune are the seed of the next silent-behavior surprise.

**S-3. Context-budget note (agent altitude).** appendPrompt attaches to *every* `agent()` dispatch
in the run (REQ-094 "any agent() in that run"). For a 100-agent fan-out, one user knob multiplies
into N× prompt tokens against the run's REQ-002 budget. No new mechanism needed — budget accounting
already meters it — but the architecture should state explicitly that appendPrompt tokens are
charged to the run budget like any prompt tokens (closing a possible "free rider" ambiguity), and
the size cap default should be chosen with fan-out multiplication in mind, not single-agent
intuition.

## Key points (ranked)

1. **O-1/R-2 jointly**: one pure `resolveEffectiveParams` seam owning the four-rung precedence,
   emitting per-key provenance into the existing HarnessDescriptor — repairs REQ-092 in a way that
   makes the recurring silent-no-op wiring class self-revealing rather than re-fixable.
2. **R-1**: effort mapping realized through the existing `ProviderProfile.effortMapping` seam —
   new provider = config entry, never executor code.
3. **C-1/C-2**: contract returned as typed structured data; rejections carry the violated
   bound/lock inline (one-round-trip repair for agent callers).
4. **S-1**: submission-time recheck of merged params against current engine config (stale
   registered defaults fail typed, not mid-run).
5. **R-3/C-3**: locked-key list and MCP tool descriptions derived from the single contract module
   (drift-lock; the `effort` no-op was a docs/behavior split).
6. **O-3**: decide explicitly on rejected-submission visibility (bounded counter or recorded
   residual gap) — don't let it drift.

## Risks

- **R-risk-1 (highest)**: REQ-092's precedence chain is implemented as scattered `??` fallbacks in
  the executor rather than one function — untestable per-rung, and the fifth wiring miss of this
  class lands unobserved. Mitigation: key point 1.
- **R-risk-2**: effort mapping hard-codes provider branches; the next provider needs a code change
  and the agent-altitude replaceability goal quietly dies for this knob.
- **R-risk-3**: `PARAM_*` errors ship as bare codes; agent callers need an extra round-trip per
  violation, and v23's describe surface reinvents the bound-reporting the error should have carried.
- **R-risk-4**: registration-valid/submission-stale defaults surface as mid-run `agent()→null`
  (looks like a provider outage, is actually config drift) — a misdiagnosis trap for operators.
- **R-risk-5**: "before any durable work" is read as "leave no trace anywhere", and the author-
  feedback loop v21 exists for loses its only telemetry about contract friction.
- **R-risk-6**: appendPrompt cap chosen for one agent, blows up run token budgets under fan-out
  (S-3); or cap lives as a code literal invisible to operators (S-2).

## Expected disagreements with other lenses

- **appendPrompt as injection surface**: an adversarial lens will likely want more than REQ-094's
  "structurally enforced elsewhere" — e.g. content screening or author opt-out of appendPrompt
  entirely. My position: structural enforcement (locked keys unreachable at the options level) is
  the correct control; screening instruction *text* is both unenforceable and a consumability tax.
  Possible cheap concession: per-workflow `params` may declare `appendPrompt:{enabled:false}` as a
  *constraint* (REQ-090 already allows constraining the four globals).
- **Per-key provenance (O-1) called over-engineering**: I expect a "just fix the wiring" objection.
  Counter: this is the fourth instance of the class; the marginal cost is one small journaled
  object, and it converts a recurring Gate-8 archaeology exercise into a Gate-7.5 assertion.
- **Rejection telemetry (O-3) called scope creep**: acceptable outcome is an explicitly recorded
  residual gap; unacceptable is silence.
- **S-1 recheck called redundant** with existing submission validation: the distinction is *what*
  is validated (the post-merge effective params against *current* config, not the stored row
  against config-at-registration); if another lens shows submission validation already re-resolves
  aliases at run time, S-1 collapses to a test, not a design change — happy to concede to evidence.
