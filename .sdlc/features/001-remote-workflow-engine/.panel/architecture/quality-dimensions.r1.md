# Quality-dimensions lens — Architecture round 1 (independent proposal)

**Scope:** REQ-218 (Bash workspace confinement) + REQ-219 (wire-or-delete dead security modules),
iteration v37. Four dimensions, one section each, all required.

## Summary

This project is both a plain system and an AI-agent system, and REQ-218/219 sit on the seam between
them, so most sections below carry both altitudes rather than picking one. Recommendation on REQ-218:
option (c) — OS-level confinement (bwrap/unshare/namespaces) as the kernel-enforced floor, plus
`allowHostPaths` as a declared, audited exception path — because Self-sustainability and Consumability
pull in opposite directions on (a) vs (b) alone, and (c) is the only option that satisfies both. The
observable seam a confinement denial produces is mechanism-specific and must be named per option, not
assumed to still be the PreToolUse hook the requirement already ruled out as insufficient. On REQ-219,
`timeout-race.ts`'s fit should be checked against the current gateway code before deciding wire vs
delete: tech_stack's Gate-7.5-round-3 note about an unbounded SDK-gateway wait appears to have already
been superseded by a `timeoutMs`/`AbortController` race (D-F7/D-F9a) landed since — this needs
confirming in-session by whoever owns REQ-219, not carried forward from a stale snapshot.

## Key points

- **Observability**: the two contradictory comments in `claude-agent-sdk-client.ts` and the
  unactionable `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` warning are the failure mode this dimension exists to
  catch; whichever option ships needs a *mechanism-appropriate* denial trace joined to the existing
  per-run journal/dashboard seam, not a generic "log the hook decision."
- **Replaceability**: put OS-level confinement behind a narrow interface
  (`WorkspaceConfinement.spawn(cmd, policy)`-shaped) so a host without usable namespaces can fall back
  to declaration-only, the same pattern already proven by the swappable `GatewayClient` (D2).
- **Consumability**: `allowHostPaths` is new workflow-authoring surface and must get the REQ-130-style
  schema + guidance treatment, not just an ADR line; pure OS-enforcement alone is zero-new-surface but
  gives an author no way to declare a legitimate exception.
- **Self-sustainability**: `allowHostPaths`-only requires a human to keep declaring paths forever;
  kernel-enforced confinement needs no per-workflow upkeep — this is the main argument for (c) over (b)
  alone. REQ-219's `timeout-race.ts`/`session-options-builder.ts` are the same failure mode (green
  tests, zero runtime tie) aimed at the module graph instead of the sandbox boundary.
- **Recommendation**: (c) for REQ-218, with the observable seam specified per sub-mechanism; REQ-219
  decided per-module against the *current* call sites, re-verifying the timeout-gap claim first.

## Altitude call

This project is **both** a plain system and an AI-agent system, and REQ-218/219 sit exactly on the
seam between them. Plain-system altitude: MCP-over-HTTP server, SQLite stores, a Node
child-process/VM sandbox, a web dashboard (D6/D7/D9). Agent altitude: Claude Agent SDK `query()`
sessions, a LiteLLM multi-provider gateway, per-agentType prompts/tools/skills (D1/D2/D8, tech_stack).
REQ-218 is specifically about the agent altitude's Bash tool escaping the plain-system altitude's
process/workspace boundary — so both altitudes apply to Observability and Self-sustainability below,
while Replaceability and Consumability split cleanly by altitude. I have not forced an agent-only
reading where the requirement is plain-system engineering (e.g. bwrap/namespaces are OS mechanism,
not agent behavior).

## 1. Observability

**System altitude.** The evidence trail behind REQ-218 already shows the failure mode this dimension
exists to prevent: `BUILT_IN_CORE_TOOLS`'s comment claims Bash is workspace-confined, a second
V3-residual comment in the same file admits it's "best-effort", and the only real signal an operator
gets is `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` printed 70 times to the production journal with no
severity, no correlation to a run/agent id in the acceptance text, and — per the requirement itself —
no resolution path today. A log line that fires 70 times and that nobody acts on is not observability,
it's noise the dashboard has taught operators to ignore.

The seam this needs is shaped differently per mechanism, and the requirement explicitly forbids
falling back to the PreToolUse-hook path-matching that motivated this section in the first place ("路徑
比對不是選項"), so the ADR cannot just say "log the hook's allow/deny" as if the hook still does the
enforcing:
- **Option (a) (OS-level):** there is no hook decision to log — the kernel denies with `EACCES`/similar
  inside the child process. The observable seam here is the *spawn wrapper*: it must journal the
  confinement policy it applied to that Bash invocation (workspace root, any extra mounts) at spawn
  time, and translate the child's syscall-denial exit into a typed tool-error event (not raw stderr)
  that reaches the same per-run journal/RunStore trail as every other tool result.
- **Option (b) (declared `allowHostPaths`):** the seam is two-sided — a *registration-time* validation
  result (which paths were declared, accepted, rejected) and a *runtime* denial event when a call tries
  a path outside the declared set — both need a run/agent id.
- **Option (c):** both of the above, since (c) is (a) as the enforced floor plus (b) as the declared
  exception.

Whichever is chosen, the resulting denial/policy event must join the dashboard's existing per-agent
panel (REQ-135/167's tool/MCP/skill visibility) as a first-class event type, not a side-channel only
visible via `strace` or manual repro — and `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` itself must either stop
firing under the new mechanism or get one line saying why it's now harmless. Leaving both contradictory
comments in place, or replacing one silent warning with another, is a repeat of the same defect the
requirement was raised to close.

**Agent altitude.** Bash is a tool call inside an otherwise-inspectable chain (the SDK session already
exposes tool-call sequence and token usage per D7/REQ-135). Today that chain has a hole exactly where
`toolUsePreCheck` runs: it decides, but the only externally visible trace is the SDK's own
shadowed-approval warning, which fires regardless of what the hook actually decided — the *decision*
itself is invisible. This is the same hole the option-specific seams above are meant to close; the
point at agent altitude is narrower: whatever event ends up representing "this Bash call was
allowed/denied and why" must sit in the *same* observable stream as every other tool call the agent
made (sequence, timing, token cost), so a reviewer reading one agent's transcript sees a security
denial in context instead of needing a separate log source to explain a gap in the tool sequence.

**REQ-219 as an observability defect in its own right.** A module with green tests and zero production
importers is a dashboard lying about coverage: it reports "this logic is tested" while the logic that
actually runs has none of it. That is exactly the "opaque failure" this dimension calls a design
defect, just aimed at the test dashboard instead of a request path. The acceptance criterion (wire with
proof, or delete with both test and module) is the correct fix and needs no amendment from this lens.

## 2. Replaceability

**System altitude.** REQ-218's option (a) — OS-level confinement via bwrap/unshare/user namespaces —
introduces a *new* enforcement mechanism, not a config toggle on an existing one. That has a
replaceability cost the ADR should name explicitly: unprivileged user namespaces are not uniformly
available across "self-hostable local or remote Linux" targets (D6/D9) — some shared VPS kernels and
some docker-in-docker CI runners disable or restrict them, and bwrap itself may not be installable
without root on a locked-down host. If (a) or (c) is chosen, the enforcement call should sit behind a
narrow interface (something like `WorkspaceConfinement.spawn(cmd, policy)`) so a host where
namespaces are unavailable can fall back to (b) alone without a rewrite — the same pattern this
codebase already uses successfully for the LLM backend (`GatewayClient`, D2, swapped via
`useLiteLLMProxy`/`"gateway":"sdk"|"direct-fetch"`). Hard-wiring bwrap calls directly into
`claude-agent-sdk-client.ts` next to `makePreToolUseHook` would recreate the coupling this project has
otherwise avoided.

**Agent altitude.** No new coupling risk here: whichever confinement mechanism wins, it constrains the
Bash tool's OS-level reach, not which model/provider answers the `agent()` call. The two are
orthogonal, and the ADR should say so explicitly so a future reader doesn't conflate "which LLM" with
"what Bash can touch."

## 3. Consumability

**Agent altitude (the one that actually matters here).** REQ-218's option (b), an explicit
`allowHostPaths` declaration, is a *contract change on the workflow-authoring surface* — it's new
surface a workflow author must understand, the same surface REQ-130 already had to patch five gaps in
for cold clients. If (b) or (c) ships, it needs the same treatment: declared in the schema the
`workflow_describe`/registration-time validation already enforces (D14's move of static checks to
registration time is the natural home), and explained in the guidance the client plugin ships (D8) —
not just an ADR note. An enforcement mechanism an author can't see or declare against (pure OS-level
confinement, option (a) alone) is *more* consumable in one sense — zero new surface, it just works or
fails — but *less* consumable in the sense that matters for the jev-haiku case in evidence: an author
with a legitimate reason to touch `$HOME/.cache/x` has no declarative way to ask for it, only a runtime
failure to reverse-engineer. That tension is real and belongs in the ADR, not resolved by silently
picking one side.

**System altitude.** The MCP surface itself is hand-rolled JSON-RPC-over-HTTP, not
`@modelcontextprotocol/sdk` (tech_stack, noted as drift since round 1) — functionally equivalent today,
but every future protocol change is manually tracked instead of upgraded. That's a pre-existing
consumability/maintenance risk, not created by REQ-218/219, but worth flagging once here since this
panel is the place architecture-level tech debt gets a hearing: if REQ-218 adds a new declared
capability (`allowHostPaths`), it's one more surface the hand-rolled layer must keep in hand-written
sync with docs, rather than getting it for free from a schema-driven SDK.

## 4. Self-sustainability

**System altitude — this is where REQ-219 lives.** `session-options-builder.ts` (4 green test files,
0 importers) and `timeout-race.ts` (2 green test files, 0 importers) are exactly the "self-sustainability"
failure mode this dimension warns about: code that survives in the tree because nothing forces the
question of whether it should. The acceptance criterion is right (wire-with-proof or delete-with-reason)
and this lens adds one caveat rather than a conclusion: tech_stack's Gate-7.5-round-3 snapshot records
an unbounded-wait defect on the SDK gateway path (the extended-thinking/Ollama `400` burning ~4 minutes
of retry/backoff, because "the gateway has no `timeoutMs`/`retries`-bounded race of its own") — but
reading the current `claude-agent-sdk-client.ts` in this same session shows that gap already closed
since that snapshot: `ClaudeAgentSdkGatewayConfig.timeoutMs`/`retries` plus an `AbortController` race
(D-F7/D-F9a) and an alias-driven thinking-disabled default (D-F6) are both present now. So the specific
call site this section originally pointed `timeout-race.ts` at may no longer be a gap — that claim
must be re-verified against the current tree, not carried forward from tech_stack's older narrative,
before it's used as a reason to wire (or not wire) that module. What still stands regardless: if any
*other* unbounded external call exists on the codepaths REQ-218/219 touch, `timeout-race.ts` is the
obvious candidate to check against it before deciding delete.

**Agent altitude.** The pattern that Gate-7.5-round-3 evidence illustrates — a stalled call silently
retrying for minutes instead of failing fast or degrading — is a missing "tool-liveness check" in the
terms this dimension uses: a gateway with no probe of whether its backend is actually answering before
committing an agent to a long wait. Whether that specific instance is still live needs the re-check
above; the general shape (no bound on an external call = no self-sustainability) is the thing worth
carrying into REQ-219's per-module decision, not the specific 4-minute figure.

**On the confinement decision itself.** Option (b) alone (`allowHostPaths` declarations with no OS
enforcement) requires a human to keep declaring paths correctly forever — every new legitimate need is
a manual edit, which is the opposite of "minimize human intervention." Option (a) (kernel-enforced) is
self-sustaining by construction: once configured, no per-workflow human upkeep is needed to keep the
boundary real. This pulls in the *opposite* direction from the Consumability section above (which
wants a declarable escape hatch), and I'm flagging that tension inside my own lens rather than
pretending it resolves cleanly — my recommendation is (c), OS-level confinement as the enforced floor
plus `allowHostPaths` as the declared, audited exception path, so self-sustainability gets the
kernel-enforced default and consumability gets the declarative override for the jev-haiku-shaped case.

## Risks

- Treating REQ-218's mechanism choice as purely a security question and skipping the deployability
  cost of option (a)/(c) (namespace availability across "self-hostable... Linux" hosts) risks an ADR
  that's correct in principle and unusable on part of the target fleet.
- Fixing `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` cosmetically (silencing it) without making the underlying
  allow/deny decision observable elsewhere would trade one opaque state for another.
- Wiring `timeout-race.ts` under REQ-219 without checking it against the already-confirmed
  4-minute-stall defect would be a missed no-cost win — and, conversely, force-fitting it there if it
  doesn't actually match the call site's needs would be worse than deleting it.
- `allowHostPaths` (option b/c) becoming a second authoring surface that REQ-130-style cold-client gaps
  reopen if the schema/guidance update is treated as optional rather than part of the acceptance.

## Expected disagreements with other lenses

- A security/threat-model lens will likely push for option (a) or (c) as non-negotiable and may treat
  the Replaceability concern (swappable confinement backend) as premature abstraction for a
  single-mechanism decision — I'd argue the swap point costs little now and a lot later given the
  namespace-availability risk above.
- A pragmatism/delivery-speed lens may favor option (b) alone as the cheapest correct-on-paper fix
  (declarative, no new OS dependency) — this lens's Self-sustainability section directly disputes that
  as pushing ongoing human cost into every future deployment rather than closing it.
- Whoever owns REQ-219 as a pure "dead code" cleanup may want to decide it independently of REQ-218;
  this proposal treats them as coupled specifically through `timeout-race.ts` and the confirmed stall
  defect, and through `session-options-builder`'s role changing if (a)/(c) wins (as the requirement
  text itself already flags) — expect pushback on scope-coupling two requirements the ledger otherwise
  treats as separable.
- The observability recommendation to journal PreToolUse allow/deny per-run may be seen by a
  performance-minded lens as unnecessary volume on a hot path; I'd weigh a denial event (rare, security-
  relevant) very differently from a per-call trace (frequent, already a known cost concern elsewhere in
  this ledger's token/cost accounting work).
