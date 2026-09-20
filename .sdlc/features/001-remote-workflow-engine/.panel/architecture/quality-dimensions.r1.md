# Quality-dimensions expert — Architecture round 1 (independent proposal)

**Scope of this proposal.** `state.yaml` still shows `iteration: v33 / current_stage: review`
(v33 closed), but `01-requirements.md` ends with **v34, REQ-201..204, status: draft**, and HEAD
(`a98b469`) is `docs(v34): REQ-202/203/204`. This architecture round exists *because* v34 is not a
small fix: it removes a whole mechanism (`agentType` — the composition-root loader in
`src/agent-definitions.ts`, the `agentDefinitionsDir` config key, the `systemPrompt` segment of
`composePrompt`, the five-rung → simplified precedence, the three-layer tool resolution) and
touches disclosure surfaces the ledger already treats as load-bearing (ARCH-129, DES-102, DES-195,
REQ-094, REQ-136). Everything below evaluates **that v34 delta**, not a general audit of the
204-REQ system. Pre-v34 REQs (007, 020, 026, 079, 117, 136) are cited only as seams v34 must
preserve or as precedent for how to record a retirement.

**Altitude judgment.** tech_stack + requirements show this project is **both** a system and an
AI-agent system, at two different places: the *engine* (MCP-over-HTTP server, SQLite
RunStore/WorkflowCatalog, OAuth authorization server, systemd self-updater, dashboard) is a
conventional system — system-altitude applies to it directly. The engine also *hosts* agents via
two `GatewayClient` implementations (LiteLLM-managed subprocess, Claude Agent SDK) — agent-altitude
applies to what those hosted agents do (their composed prompt, their transcript, their tool
surface), not to the engine's own reasoning, because the engine itself has no LLM-driven
decision-making of its own. I apply both altitudes per dimension below, and say explicitly where
one is thin or not applicable for v34 rather than padding it in.

---

## 1. Observability

**System altitude (engine).** REQ-203 deletes the `harness.systemPrompt` field from the
descriptor and the corresponding dashboard disclosure panel (the surface REQ-136/ARCH-129/DES-195
built). That is a net observability *loss* unless something replaces it: an operator today can see
which `agentDefinitionsDir/*.md` produced an agent's system prompt; after v34 there is no
`agentType` and no separate system-prompt segment, but the operator still needs to see the
**effective prompt** an agent actually received. Proposal: the harness descriptor keeps exactly two
visible segments post-v34 — `harness.prompt` (script-authored) and `harness.appendPrompt` (with its
`<user-instructions untrusted="true">…</user-instructions>` framing shown verbatim, not just its
raw text) — so `workflow_agent_log` / the dashboard's harness-detail panel (REQ-073) still lets a
human reconstruct exactly what the model saw, just from two segments instead of four. Losing a
segment is fine; losing the ability to see the composed result is not, and REQ-203's acceptance
text already implies this ("harness descriptor 不再有 systemPrompt 欄位") without saying what
replaces it for debugging.

Two concrete gaps I'd want the design pass to close:
- **Rejection observability for the removed key.** REQ-203 says a script with `agentType` in
  `workflow_register` is refused with a message pointing at `workflow_authoring_guide` — that
  needs a *typed* error code (following the `DEFAULTS_RETIRED`/`LEGACY_REREGISTER` convention at
  `04-design.md:5002`), e.g. `AGENTTYPE_RETIRED`, not a prose-only message. A cold client
  programmatically distinguishing "removed feature" from "malformed script" needs the code, not the
  hint string — this is the same self-description bar REQ-079 already set for every MCP tool
  schema, and a removed *script-level* option key should meet it too.
- **Startup-path observability for the removed config key.** REQ-203's acceptance says a lingering
  `agentDefinitionsDir` in `rwe.config.json` goes through the existing unrecognized-key warning path
  (no fail-fast). That path needs to actually name the key and say "retired in v34, see
  workflow_authoring_guide" in the log line — an operator staring at "unrecognized key:
  agentDefinitionsDir" six months from now has no seam back to *why*, unless the retirement is
  observable at the point it's ignored, not only in a changelog.

**Agent altitude (hosted agents).** REQ-202's whole point is prompt-composition observability
*before* the first call, for a cold MCP client that only reads `tools/list` +
`workflow_describe` — never a black box even at design time, not just at runtime. Concretely
`workflow_describe`'s per-agent `appendPrompt` projection must carry, as data the client can act on
without trial-and-error: `unit: "bytes"`, the effective cap already `min()`-ed (author declared ∧
engine `maxAppendPromptBytes`), and the framing string the model will see. This is observability of
the *contract*, which matters as much as observability of a completed run's transcript — REQ-007's
transcript-inspection goal is satisfied post-hoc; REQ-202 is asking for the pre-hoc version so a
cold author's first call is correct instead of discovered-by-error (REQ-117's "every client
mis-step is a documentation defect" standard, cited directly in REQ-201's own rationale and
equally applicable here).

## 2. Replaceability

**System altitude.** v34 does not touch either `GatewayClient` implementation or the
alias→provider mapping (REQ-004), so the goal already met there (LLM backend swap = config change,
not code change) is unaffected — I flag this only to confirm the round doesn't regress it, per the
advisor's caution not to re-litigate a settled point.

The actual replaceability move in v34 is different: **removing a per-deployment coupling the
remote author could never reach.** `agentType` let a *server operator* bind systemPrompt+model+tools
via `agentDefinitionsDir/*.md`, invisible to and unreachable by the remote workflow author (v34's
own stated rationale — "遠端作者寫不到、卻會改變執行結果" applies to all three of its layers, not
just the prompt one). Removing it is a replaceability improvement in the sense that mirrors the
LLM-backend goal one level down: an author's `agent()` call plus the registered param contract
(REQ-088/090/092) is now the *complete*, portable description of what runs — nothing an operator
configured out-of-band can silently change the outcome. This is worth stating explicitly as the
architectural motivation, because it's the same "no single point of undeclared coupling" instinct
this dimension names for infra swaps, just applied to the harness-composition layer instead of the
provider layer.

One thing the design pass must verify, not assume: **confirm nothing else still depends on
`agentType` for model binding.** `04-design.md:735` documents a five-rung precedence where "agentType
definition frontmatter" sits between per-call opts and per-run overrides; deleting the rung
changes precedence to four rungs and must be checked against every existing registered workflow
(the "0 of 22 catalog versions use `agentType`" evidence cited in the iteration rationale is a
one-time hand-check — see Self-sustainability below for why that's not enough on its own).

**Agent altitude.** Tool-surface resolution collapses from three layers to two (per-call
`allowedTools` → deployment `defaultAllowedTools`, per REQ-203's acceptance and confirmed live in
`src/main.ts:59-63`, which already documents `defaultAllowedTools` as "applied to every call that
doesn't carry its own agentType-derived opts.allowedTools" — i.e. the code comment itself is now
stale the moment agentType is deleted and needs to be rewritten, not just the behavior). Two layers
instead of three is *more* replaceable, not less: fewer places a tool-surface override can live
means fewer places an author or operator has to check when reasoning about "which tools can this
agent actually call," which is itself a replaceability/portability property (a workflow's tool
surface is fully determined by the script + one deployment default, portable across deployments
that share the default).

## 3. Consumability

This is where v34's REQ-202 sits squarely, and it is the strongest dimension for this round.

**Agent-altitude (structured, well-typed I/O for the calling side).** The acceptance text already
specifies the right shape: before a cold client sends its first `appendPrompt`, it must be able to
learn, purely from `tools/list` + `workflow_describe` (no guidance skill, no docs — REQ-090's
"reachable from the MCP surface itself" bar): (a) the key must be pre-declared per-label in
`meta.params.agents.<label>` or `PARAM_UNKNOWN`; (b) the untrusted-framing wrapper is applied,
stated as fact not left implicit; (c) the effective byte cap is `min(author, engine)`, with the unit
explicit — "not guessed from a bare `range` number," which is exactly the class of integration
friction this dimension exists to eliminate (a caller currently has to trial-and-error discover
units and effective ceilings, which is precisely the "high learning curve" this quality dimension
flags as a defect). I'd add one thing not fully spelled out in the acceptance: the error payload for
`PARAM_OUT_OF_RANGE` on `appendPrompt` should carry the *computed* effective max as a field (not
just as prose in the `hint`), symmetric with how `workflow_describe` exposes it up front — an error
a client can parse without re-deriving the min() itself.

**REQ-204's `DEFAULTS_RETIRED` retention is a consumability-preserving move, correctly kept.**
Silently accepting a retired `defaults` key would be *worse* consumability than a typed rejection,
even though it looks more "permissive" — a caller who thinks a setting took effect when it silently
didn't is the exact failure mode `DEFAULTS_RETIRED` exists to prevent (04-design.md:5279/5683
documents this was already fought for once; REQ-204 is right to refuse to relitigate it).

**System altitude — the drift-lock constraint.** `docs/AUTHORING.md` and
`buildAuthoringGuide()`'s output are byte-equal under UT-160 (state.yaml's F6 finding shows this
lock is actively enforced and has already caused one measured regression this iteration — DES-157's
iter bump). Any v34 rewrite of the "Registration and versioning" / prompt-layering guide sections
must keep this generator/output pair in lockstep; this is infrastructure for consumability itself
(a docs/schema drift is a consumability regression nobody notices until a cold client hits it), so
I'd flag it as a hard constraint on the design/task breakdown, not an incidental test detail.

## 4. Self-sustainability

**Thin for v34 by design — noting this explicitly rather than padding it.** The engine has no
long-term per-agent memory to metabolize (each run's transcript is bounded by that run;
REQ-007/REQ-060 govern durability and resume, not memory growth), so the agent-altitude
"memory metabolism / prompt self-calibration" half of this dimension is **not applicable** to v34's
change set. Forcing it in would misread the lens per the task's own instruction to skip the
altitude that doesn't fit.

What *does* apply, at system altitude, and is already in place, unaffected by v34 (cite, don't
redesign): the periodic maintenance sweep already does self-healing/garbage-collection work
(`TokenStore.gcExpired()` for oauth_state/auth_codes/bearer_tokens, REQ-026's TTL GC for stale
run workspaces) — v34 introduces no new unbounded-growth surface, so no new sweep is needed.
REQ-020's bounded timeout+retry on the SDK gateway path is the existing circuit-breaker instance;
v34 doesn't touch it.

One place this dimension *does* bite, and isn't yet addressed: the iteration's own evidence for
"safe to remove `agentType`" is **"catalog 目前 22 個版本,0 個使用 agentType"** — a fact checked
once, by hand, at decision time. That's an assertion, not a monitored invariant, and it will go
stale the moment it's no longer re-derivable (once the field and its loader are gone, nothing
*proves* future re-registrations can't reintroduce the pattern under a different name, or that a
pre-v34 registered version pinned in the catalog — REQ-096 keeps version history, a run pins the
exact version it executed — doesn't still reference `agentType` and silently no-op it once the
loader is deleted). Two candidate self-sustaining checks for the design stage to pick between: (a)
`workflow_register`'s rejection (already specified) covers only *new* registrations — a startup or
periodic scan of the *existing* catalog for `agentType` in stored scripts would catch the case
where an old pinned version is later `run_start`'ed by version/channel and hits the now-absent
loader; (b) alternatively, if `resolveCallParams`/dispatch already fails closed on an unresolvable
`agentType` reference for old pinned versions (i.e. dispatch-time, not registration-time), that's
sufficient and (a) is unneeded — this is a design-stage decision, not one I can resolve from
requirements text alone, but it should be an explicit decision, not a silent gap.

---

## Risks

- **Observability regression risk:** if the design stage treats "delete `systemPrompt` from the
  descriptor" as the whole of REQ-203 without also confirming the two-segment
  `prompt`/`appendPrompt` view stays fully visible, an operator loses debugging capability that
  today's dashboard provides, and REQ-136's "disclosure面隨機制消失,非回歸" framing becomes
  wishful rather than verified.
- **Precedence-rewrite risk:** collapsing five rungs to four (removing the agentType frontmatter
  rung documented at `04-design.md:735`) is a behavior change for the theoretical case of an old
  pinned catalog version that used it — needs an explicit compatibility decision (reject at
  dispatch vs. scan at registration/startup), not an implicit "it'll just not match."
  Same underlying gap noted under Self-sustainability.
- **Docs/schema drift risk:** the UT-160 byte-equality lock between `buildAuthoringGuide()` and
  `docs/AUTHORING.md` is a proven regression trap this iteration (F6-1 in state.yaml). Any prose
  change for REQ-202/203 touching the authoring guide risks re-tripping it if the design/tasks split
  doesn't route both the generator and the checked-in doc through one edit.
- **Stale code comments risk:** `src/main.ts:59-63`'s own comment describes `defaultAllowedTools`
  in terms of "agentType-derived opts.allowedTools" — a small thing, but exactly the kind of
  leftover reference that undermines the "removed cleanly, not half-removed" claim REQ-203 makes;
  worth a design-stage checklist item (grep for `agentType` in comments, not just in logic).

## Expected disagreements with other lenses

- **A security/robustness lens** will likely argue `agentType` was a legitimate server-side control
  plane — an operator-owned defense-in-depth layer for per-agent tool/prompt restriction,
  independent of what a (possibly less-trusted) remote workflow author declares — and that removing
  it *weakens* operator-side constraint rather than closing a coupling bug. My counter: the
  two-layer tool resolution retains exactly one operator-owned layer (`defaultAllowedTools`
  deployment-wide), so the defense-in-depth property survives at the *deployment* granularity; what
  is lost is only the *per-agent-type* granularity within one deployment, which the iteration's own
  evidence (0/22 catalog versions using it) suggests was never exercised. I'd want that
  granularity-loss named explicitly as an accepted tradeoff in the architecture doc rather than
  left implicit.
- **A simplicity/YAGNI lens** will likely endorse the removal outright and may push back on my
  Observability section's request for a replacement two-segment disclosure view and a typed
  `AGENTTYPE_RETIRED` code, reading them as scope creep on a "just delete it" change. My friction
  point: REQ-203's own acceptance text already implies the dashboard/descriptor need to *change*
  shape (not just shrink to nothing), so specifying what replaces the deleted disclosure surface is
  completing REQ-203 as written, not adding new scope — the risk is a "clean" deletion that quietly
  drops an operator-facing seam nobody files as a regression because nothing pins it.
