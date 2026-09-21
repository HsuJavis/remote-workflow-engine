# Quality-dimensions lens — v36 architecture, round 1 (independent proposal)

## Altitude check (tech_stack + requirements)

`state.yaml`'s `tech_stack` and `01-requirements.md`'s product line put this project in **both**
buckets, not one: it is a conventional system (hand-rolled MCP-over-HTTP server, SQLite catalog/run
store, a shell-scripted deploy/lifecycle layer) whose PAYLOAD is an AI-agent execution engine —
workflow scripts run inside a sandboxed child process and make `agent()` calls that are dispatched
through a pluggable `GatewayClient` port (`LiteLLMGatewayClient` direct-fetch vs.
`ClaudeAgentSdkGatewayClient`, config-selected). v35's own synthesis already applied both altitudes
per dimension and I do the same here — a dimension is skipped only where a requirement genuinely
doesn't reach that altitude (none of REQ-211..216 is agent-only or system-only).

Of the six v36 requirements, **REQ-215 is the only one routed through a full architecture gate**
(IPC contract change + a named policy decision + a named security assessment); REQ-211..214/216 are
fix-mode and riding this round only because the orchestrator merged them. This proposal weights
REQ-215 accordingly — it is roughly half the document below.

## Summary

The six requirements read, dimension by dimension, as: an IPC contract that currently makes an
agent's structured refusal reason unobservable past three flattening sites (REQ-215, observability +
security, agent altitude); an audit trail that silently anonymizes exactly the calls that most need
attribution (REQ-212, observability, system altitude, overloaded with a replaceability defect at the
same call site); one port (`GatewayClient`) whose two conformers have already drifted on a formula
its own guide promises is singular (REQ-216/K7, replaceability); a directory and a log stream that
give an operator no way to tell what's safe to delete or what happened without opening sqlite
(REQ-213, observability + self-sustainability, system altitude); a multi-instance lifecycle script
that clobbers PID/log state across instances (REQ-214, self-sustainability); an error message that
promises an action the tool cannot perform (REQ-211, consumability); and six named-but-deferred
architecture debts from v35 (REQ-216/K1-K8) that this round either closes or re-files with a reason,
not silently.

## Key points

### (1) Observability

**REQ-215 — the IPC contract's missing seam, and where the fix actually has to live.**
The requirement's own three-flattening trace (`guards.ts:322-335` → `host.ts:147/166` → the
`child-entry.ts` wire type) is accurate but names only the SYMPTOM sites. Two designs close it, and
they are not equivalent:

- **Design A — widen the wire, trust the child less.** Grow `guards.ts`'s `ENGINE_REFUSAL_CODES`
  (today just `{BUDGET_EXCEEDED}`) to the policy-approved set, thread it through `child-entry.ts`'s
  `AgentThrowMsg`/error shape unchanged in kind (still `{code, message}`, just a richer `code`
  vocabulary), and — this is the part REQ-215(c)'s security ask actually requires — **validate at
  the PARENT side of the boundary, at receipt**, not just at the child's throw site. `host.ts`'s
  `case 'error': settle({ error: msg.error })` currently does zero validation of `msg.error.code`;
  a child-side filter is a courtesy the parent cannot rely on (a compromised or buggy child can put
  any string on the wire). The guarantee has to be: **parent collapses any code not in the allowlist
  to `SCRIPT_ERROR` on receipt**, symmetrically for `agentThrow`/`workflowThrow`/`error`. This is the
  literal shape of REQ-209's precedent (ADR-069: required parameter, fail-closed, no opt-out) applied
  to an IPC boundary instead of a function signature.
- **Design B — don't widen the wire at all.** REQ-215's own text says the marker "already lands in
  the per-agent record's detail string" when the parent's `onAgentRequest` handler throws
  `AGENT_OPT_RETIRED` — because the PARENT constructs that refusal itself, before it ever crosses
  into the child via `agentThrow`. If the parent records the refusal host-side, keyed by `callSeq`,
  and lifts it into the run-level error envelope when the run terminates as failed, (c) dissolves
  by construction: nothing new crosses the sandbox boundary, because the parent already had the
  answer. The trade-off is exact-vs-inferred causality: Design A can point at the literal
  `agent()` call that got refused; Design B can only assert "the run died after this refusal was
  issued," and a script that catches the throw and fails for an unrelated reason afterward would
  attribute wrongly under B.

  REQ-215(a) states flatly that "4 個檔的 sandbox IPC 契約修改" is one of the three things the
  requirement "必須包含,缺一不可" — so Design B does not discharge the requirement as written; I
  read this as the requirement already having decided A over B, with (c)'s security assessment
  existing precisely BECAUSE A was chosen. I'm not overriding that reading, but round 1 should say
  so explicitly for the adversarial lens to confirm or contest, since it's the single highest-value
  design fork in this round: **if the parent already has exact causality via Design B's mechanism
  for the one code the requirement's own example uses (`AGENT_OPT_RETIRED`), REQ-215(b)'s "which
  codes may cross" policy question may have very few members** — every refusal the PARENT itself
  raises (as opposed to the sandbox VM's own guards, e.g. `BUDGET_EXCEEDED`, `DETERMINISM_GUARD`)
  doesn't need to cross at all under B, and only the latter class needs A's allowlist widened.

**REQ-212 — audit identity collapsed by an ownership helper doing double duty.**
`bypassPrincipal()` (`mcp-facade.ts:202`) answers one question — "for OWNERSHIP-COMPARISON purposes,
does this principal's identity matter, or does it bypass?" — and its `null` return for
`admin`/`auth-disabled` is then reused, transitively, as if it also answered "what identity does the
audit row get?" Those are two different contracts sharing one function, and REQ-212's 7-anonymous-
publishes-in-one-day evidence is what happens when a system conflates them. The request path
"admin called X" stops being followable at exactly the row that most needs it followable — a bypass
of ownership is the highest-audit-value case, not a case audit is allowed to skip.

**REQ-213 — the engine doesn't narrate its own terminal events.**
`workflow_register` and any run reaching a terminal state currently produce nothing structured
(journal.jsonl carries 7 `catalog.publish` lines across 70 minutes of real testing; register and
run-terminal are silent). This is the system-altitude form of "internal state observable at any
time, feeding automated ops" — today it doesn't feed anything, a remote incident can only be
diagnosed by opening the sqlite file directly. Reuse REQ-205/REQ-142's already-established capture
seam (redact-at-capture, one line per terminal transition) rather than inventing a second logging
path — REQ-216/K1's proposed `captureFailure` collapse is the natural place to also emit the journal
line, since it already sits at the one point every failure funnels through.

**REQ-216/K1, K2 — close them this round, not defer a third time.** K1 (one pure
`captureFailure(err, secrets)` replacing two independently-evolving capture sites) and K2
(`seedRef.failDetail` served unredacted, three lines from the message its sibling already redacts)
were both named at Gate 8 and declined only for being outside that round's strict scope. REQ-216
explicitly lists K1-K8 as its own acceptance criteria, and REQ-215 already has to touch
`errors.ts`/`guards.ts`/`host.ts` for the IPC work — landing K1+K2 in the same PR is strictly cheaper
than a third round that re-opens the same files. K2 in particular is a live redaction gap (a secret
marker reaching an unredacted field is exactly the failure class ADR-066 exists to close) and should
not go a second iteration as "named debt."

**Agent altitude, what's already there:** the budget/spend piggyback (`ZERO_SPEND`,
`onBudgetSnapshot`, the `spent` field on `start`/`agentResult`) is a working observable seam for
"how much" — REQ-215 is the missing "why," not a duplicate mechanism.

**Out of scope, correctly:** no requirement in this round asks for cross-run correlation IDs beyond
`runId`/`agentId`, or an OpenAPI surface for `/api/*` — both were filed in v35 and stay filed.

### (2) Replaceability

**The `GatewayClient` port is the project's best example of this dimension done right** — two real
conformers (`LiteLLMGatewayClient` direct-fetch, `ClaudeAgentSdkGatewayClient`) behind one interface,
config-selected (`"gateway":"sdk"|"direct-fetch"`), LLM-backend swap as a config change rather than a
rewrite, exactly the agent-altitude goal this dimension names. **REQ-216/K7 is where that abstraction
is already leaking**: I traced both formulas —

- `claude-agent-sdk-client.ts:507`: `attempts = effTimeout !== undefined ? 1 + max(0,retries) : 1`
- `client.ts:515`: `attempts = 1 + Math.max(0, this._config.retries)` — **unconditional**, ignores
  whether a timeout is even configured.

REQ-216's own text says the promised guide sentence is "an untimed call gets ONE attempt." That
matches the SDK client and contradicts `client.ts`, which retries an untimed call `1+retries` times
regardless. **`client.ts:515` is the deviant implementation, not an equally-valid second formula.**
A port whose two conformers disagree on retry semantics means "swap the gateway" is no longer a pure
config change — it changes observed retry behavior too, which is exactly the kind of silent
divergence this dimension exists to prevent. Fix shape: one `attempts(effTimeout, retries)` helper
homed on the `GatewayClient` port module (not duplicated per client), both call it; ship the missing
guide sentence in the same change (ARCH-151(b) already named it as missing).

**REQ-215's wire protocol as a replaceability seam in its own right.** The child/parent split exists
so the VM-based sandbox host is swappable for a different isolation mechanism without touching
`RunManager` — but only if the wire stays a stable, additive contract. v26 already established the
right pattern for growing it (the `spent` field added as `?:` optional on `StartMsg`/`AgentResultMsg`
rather than reshaping the message). REQ-215's error-code widening should follow the same shape:
additive, not a breaking reshape of the existing `{code, message}` envelope.

**REQ-211, briefly:** the version→channel indirection (a channel points at a version, not a bare
name) is already a decoupling seam — callers depend on a channel, not a specific version — and the
acceptance correctly protects it (refuse to delete a version a channel still points at). This
requirement is mostly a consumability gap (below); flagged here only to confirm it doesn't regress
the existing seam.

### (3) Consumability

**REQ-211 — the interface's own error message is false.** `VERSION_CEILING_EXCEEDED`'s hint text
tells a caller to "deregister an old one," and no such call exists — `workflow_deregister` only
deletes an entire name. This is the textbook failure this dimension flags: structured, well-typed I/O
is only as trustworthy as the error text riding it, and an error message advertising a capability the
tool doesn't have is worse than no hint at all, because a caller who trusts it wastes a round trip
discovering the tool lied.

**REQ-213 — `workflow_list`'s missing decision-relevant fields.** A caller (human or another agent)
currently cannot tell, from the advertised surface, which of 20 registered names are safe to clean up
— no `lastRunAt`, no purpose summary, mixed permanent workflows and one-shot probes with identical
shape. REQ-206's precedent (explicit `null` over an ambiguous `0`/`''` default) is the right sentinel
convention to reuse here for "never run," and I'd apply it rather than inventing a second convention
for the same kind of absence.

**REQ-215, agent altitude.** For a workflow author, the engine's reasoning is invoked like a function
(`agent()`), and today a refusal returns an opaque, generically-worded run-level failure instead of
the same kind of structured `run_result.error.code` a `BUDGET_EXCEEDED` refusal already provides
(established at v25/REQ-120, `refusalCode()` in `guards.ts`). REQ-215 is best read as *extending an
existing consumability pattern* to a second class of engine refusal, not inventing a new one — reuse
`refusalCode()`'s enum-membership shape for whatever the REQ-215(b) allowlist becomes, so callers
learn one mechanism, not two.

**REQ-210's already-shipped lesson applies to REQ-213's new log lines too:** don't let the new
structured journal format become a second surface a cold client has to discover is large or
double-encoded. Keep each line small (name/version/principal/outcome, as specified) and don't route
it through the same double-JSON-encoding envelope REQ-210 exists because of.

### (4) Self-sustainability

**Scoping note, stated rather than silently assumed:** v35's synthesis already ruled — correctly,
and unchanged by anything in v36 — that full autoscaling/circuit-breaker self-healing at the system
altitude is out of scope for a single-operator QM tool, and that tool-liveness probing between runs
has no requirement asking for it. I'm not reopening either; no v36 requirement touches them.

**REQ-214 is a genuine self-sustainability defect, not a cosmetic one.** `deploy.sh` writes
`.rwe.pid`/`.rwe.log` at the repo root regardless of which config `RWE_CONFIG_PATH` points at, so a
second instance (a scratch verification instance is described as "常態" — the normal case, not an
edge case) silently shares lifecycle state with the first. `kill $(cat .rwe.pid)` killing the wrong
process is exactly the graceful-degradation failure this dimension flags: the mechanism meant to let
an operator manage instances without manual bookkeeping instead requires MORE manual bookkeeping (the
v34 DEPLOY.md workaround REQ-214 asks to retire). Three candidate homes for the PID/log files, in
order of preference: **(a) `dirname "$RWE_CONFIG_PATH"`** — the config already defines
per-instance state (`workRoot`) and colocating PID/log with the config file that identifies the
instance is the most debuggable (an operator who has the config path has the PID/log path, no lookup
table needed); (b) a hash of the resolved config path — works, but trades debuggability for a
filename an operator can't read at a glance; (c) inside `workRoot` itself — plausible since
`workRoot` is already the instance's own writable area, worth the architecture round confirming which
of (a)/(c) is intended, since both satisfy the acceptance criterion equally well.

**REQ-213's new journal lines and the ALREADY-FILED rotation gap must not be decided independently.**
`02-architecture.md`'s v36-candidates list already names `journal.jsonl` compaction/rotation as
unactioned debt for resident/cron workflows. REQ-213 adds a NEW line kind (register events) on top of
the existing per-agent traffic, which grows the unbounded-file problem rather than leaving it alone —
silently proceeding as if "the new lines are small so it's fine" is precisely the failure mode this
dimension exists to catch (per-line growth is bounded; CUMULATIVE growth across a long-lived resident
workflow's lifetime is not, and that's the axis rotation was filed against). This round should do one
of two things explicitly, not drift past the question a second time: state a stated growth bound the
new line kind stays under (and re-file rotation with that bound recorded as the reason it's still
tolerable), or pull minimal rotation into REQ-213's scope. I lean toward the former — REQ-213 doesn't
ask for rotation and growing scope to include it risks the same "no requirement asked for it" problem
this project's own trade-off discipline elsewhere refuses to do — but the coupling has to be named,
not left implicit.

**REQ-216/K5 — `listRuns()` has no LIMIT.** REQ-216's acceptance text is explicit that the
DELIVERABLE here is a ruling ("要裁決要不要加"), not an implementation mandate — I'm not upgrading it.
My input to that ruling: it's a real, already-identified scaling cliff on a list path a long-running
deployment will eventually hit, and REQ-213 touches `workflow_list`'s shape in the same round anyway,
which lowers the marginal cost of also bounding `listRuns()` if the ruling comes out "add it." I'd
lean toward adding a default LIMIT with an explicit override, but the ruling itself belongs to the
synthesis, not to one lens.

**Agent altitude — memory metabolism, read narrowly.** The catalog's 20-names/9-probes state (REQ-213
evidence) is a real instance of "unbounded accumulation with no compress/archive path," but at the
CATALOG altitude, not the per-agent-context altitude the canonical "memory metabolism" framing names.
REQ-213 as scoped gives the OBSERVABILITY a future GC would need (lastRunAt as a staleness signal); it
is not itself a closed self-sustainability loop, and I want that distinction on record so REQ-213
isn't later read as having closed a loop it only made visible.

## Risks

1. **Attention skew.** Five of six requirements this round are comparatively mechanical (REQ-211,
   212, 213, 214, and REQ-216's mostly-already-decided K3/K4/K6/K8); REQ-215 is the one item asking
   for genuine new architectural judgment (a policy ruling plus a security assessment) and is the one
   the orchestrator itself flagged as needing the full gate. A round that spends even attention across
   all six under-serves REQ-215 specifically.
2. **REQ-215 Design A vs. B is a real fork, not a rhetorical one.** If the synthesis picks A without
   registering that B would satisfy the requirement's INTENT (an observable refusal reason at the run
   layer) with a smaller security surface for a subset of codes, a later audit may ask why the wire
   was widened for codes the parent already knew about.
3. **REQ-213 × rotation coupling**, named above — the risk is proceeding on REQ-213 as if it were
   independent of the already-filed rotation debt, which would be exactly the kind of silent
   "it's fine because it's small" reasoning this lens exists to interrupt.
4. **REQ-212's fix, if implemented as "just stop returning null," could break the ownership-comparison
   semantics `bypassPrincipal()` also serves** (`:233-239` reuses it for the OWNERSHIP-COMPARISON
   check, where `null`-means-any is correct and must NOT change). The fix has to add a field, not
   repurpose the existing return value — conflating "fix the audit gap" with "change what null means"
   would be a regression risked by an implementer who reads only the requirement text and not the
   two call sites.

## Expected disagreements with other lenses

- **REQ-215 code selection.** I expect an adversarial/security-focused lens to argue for a narrower
  allowlist than I would (grow `ENGINE_REFUSAL_CODES` one code at a time, each gated by its own
  fixture, rather than admitting REQ-215's example code `AGENT_OPT_RETIRED` plus whatever else is
  "policy-approved" in one pass) — similar in shape to v35's REQ-209 convergence (fail-closed,
  required, no opt-out), but the SET itself is the likely point of friction, not the fail-closed
  mechanism.
- **Design A vs. B for REQ-215**, named above under risks — I read REQ-215(a)'s "4 個檔...缺一不可" as
  having already decided A, but I expect this to be explicitly contested or explicitly ratified in
  round 2 rather than silently assumed either way.
- **REQ-214's exact file location** — `dirname($RWE_CONFIG_PATH)` vs. inside `workRoot` vs. a hash —
  I don't expect disagreement on the PROBLEM, but I do expect a different lens to weight
  debuggability vs. "keep instance state entirely inside the already-gitignored workRoot" differently
  than I did.
- **Whether K1/K2 belong in THIS PR or a follow-up inside the same iteration** — I argue same PR
  (cheaper, same files); a testability-weighted lens may want the IPC change and the capture-pipeline
  collapse independently revertable, given REQ-215 explicitly demands real-sandbox-layer tests (not
  mocked IPC), which is a heavier test surface than K1 alone would need.
- **REQ-216/K5's ruling** — I lean toward adding a default LIMIT since REQ-213 already touches the
  same surface this round; a lens weighting "no requirement literally asks for this" more heavily than
  I do may prefer leaving it filed, consistent with v35's own precedent of declining to design debt
  items early.
