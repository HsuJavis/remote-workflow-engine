# Quality-dimensions expert — round 1 (independent proposal)

**Gate context**: this is v36, a Gate 8 send-back, not a greenfield architecture gate. Scope is
REQ-211..216 (ARCH-155..173, ADR-072..079) plus landing the owner ruling on ARCH-172's pending
marker. This proposal is scoped to that — deltas against existing ARCH IDs, not a re-architecture.

**Altitude verdict**: this project is **both**. The system altitude applies fully — MCP
Streamable-HTTP server (hand-rolled JSON-RPC, `src/server.ts`), SQLite persistence
(`better-sqlite3`), process-level sandbox. The agent altitude also applies fully — `agent()` calls
dispatch through a `GatewayClient` port to the Claude Agent SDK / LiteLLM proxy, with real
multi-provider routing (Anthropic/OpenAI/Gemini/Ollama). Each dimension below is scored at
whichever altitude(s) the v36 evidence actually touches; I don't force the other one where v36 has
nothing to say.

---

## 1. Observability

**System altitude — strong and the direct subject of this gate.** REQ-213 is literally "the engine
must be able to say what it's doing" and REQ-212 is literally audit-identity observability.
`src/event-log.ts` (ARCH-159) is one injectable `EventSink`, redaction applied once inside it
(never in emitters), currently a closed union of exactly 4 event kinds
(`catalog.register/publish/deregister`, `run.terminal`). ARCH-159's amendment moves `publish`'s
bare `console.log` (`:803`) onto this sink and adds REQ-212's `bypass`/`idSource` audit fields —
this is the load-bearing fix for the "7 anonymous publishes on 2026-09-20" defect in REQ-212's
acceptance text. ARCH-162 adds `lastRunAtByName()` as a read-only grouped query so `workflow_list`
stops hiding which of 20 registered names are one-off probes worth deleting.

**Gaps recorded as architecture debt, not silently dropped** (state.yaml's own v36 tail names
these, so I'm not inventing them): `refusalsDropped` has no read surface; three pre-v36 unredacted
`console.log` lines remain outside the sink (filed v37); the per-run refusal ledger is capped at 8
entries + a dropped counter (ARCH-168) — a real bound on observability under a pathological run,
correctly named as a limit rather than hidden.

**Agent altitude — thinner, and the seam is contested, which is REQ-215's whole point.** A
structured engine-refusal marker (e.g. `AGENT_OPT_RETIRED`) is dropped **three times** crossing the
sandbox boundary before it reaches `toErr`: `sandbox/guards.ts:322-335` rebuilds every failure into
a bare `{code,message}` and flattens `code` to `SCRIPT_ERROR`; `sandbox/host.ts:147/166` rebuilds
again relaying it; `child-entry.ts:36`'s wire type has no field for it at all. REQ-215 is exactly
"design the observable seam" for this — and it is *not* closed this iteration by architecture alone:
the acceptance text demands (a) the 4-file IPC contract change, (b) a policy ruling on which engine
refusal codes may cross the sandbox catch (a security question, not an implementation detail), (c)
an explicit security assessment, because a refusal code crossing the boundary is a new
script-controlled-object-reaches-disk channel, grouped with v37's Bash jail work. Separately:
`claude-agent-sdk-client.ts:435` already passes through SDK session events including
`compact_boundary` and `status` — whether those reach a durable per-agent record or are silently
dropped at the sandbox boundary the same way REQ-215's refusal marker is, is unverified and worth
one line item in tests, since it's the same class of failure REQ-215 documents for a different
signal.

**Risk to this gate closing**: REQ-215 is scoped as "must go through full Gate 2→8 including
architecture" specifically *because* of (b)+(c) above — if this round's architecture output settles
(a) the wire contract without an explicit, owner-visible ruling on (b), the send-back repeats.

## 2. Replaceability

**Agent altitude — real and already built, not aspirational.** `GatewayClient`
(`src/gateway/client.ts:186`) is a genuine port with two conformers —
`LiteLLMGatewayClient` (managed `litellm[proxy]` subprocess, ARCH/DES-009) and
`ClaudeAgentSdkGatewayClient` (`ANTHROPIC_BASE_URL` pointed at the same proxy) — selected by one
config key (`"gateway":"sdk"|"direct-fetch"`), and D2's design goal (route cheap models to
mechanical agents, expensive ones to critical agents, no Anthropic billing when routed elsewhere) is
live infrastructure via LiteLLM, not a stated intent with nothing behind it.

**K6/K7 (ARCH-151, this gate) is a replaceability regression being closed, not opened**: the two
conformers had *private* retry semantics — `client.ts:515` retried even an untimed call
(`1 + Math.max(0, retries)` unconditionally) while `claude-agent-sdk-client.ts:507` did not. Two
implementations of one port disagreeing on retry-under-timeout is exactly the failure mode
replaceability exists to prevent: a caller can no longer treat the two as interchangeable. ARCH's
fix — `attemptsFor()` homed on the port, both conformers call it — is the correct place to put it:
a shared pure function makes "both gateways answer the same" a compile-time fact, and K8's ~3-line
probe in `compose-config-v2-wiring.test.ts` is this repo's standing guard against exactly this class
of two-implementations-drift (the same guard class that already caught two prior composeConfig
wiring bugs per project memory).

**System altitude — mixed, and I want to flag rather than claim.** `RunStore` (`src/run-store.ts:185`)
is a real interface with `InMemoryRunStore` and a SQLite conformer, so persistence *is* behind a
port for run storage — that part of D9 held. Two counter-facts temper any broader replaceability
claim: (1) tech_stack's own history records the MCP transport drifted from the Gate 2/3 sketch —
hand-rolled JSON-RPC-over-HTTP in `src/server.ts`, not `@modelcontextprotocol/sdk` — functionally
equivalent but not the originally-designed swap point; (2) `better-sqlite3` is a concrete, synchronous,
single-process dependency baked into the `RunStore` conformer — the port exists, but nothing in this
gate's scope exercises "swap SQLite for Postgres" the way D2 exercises "swap Anthropic for Ollama."
I'm not claiming a gap here since nothing in REQ-211..216 asks for it — just noting the asymmetry:
this project's replaceability investment is real but concentrated on the LLM-gateway seam, not
symmetric across every persistence seam.

## 3. Consumability

**Agent altitude — the strongest dimension in this codebase, and largely already shipped, not new
to v36.** `src/authoring-guide.ts` is a self-describing surface (declared-not-probed capability
labels, explicit worked examples with generated ASCII diagrams) rather than a caller learning the
DSL by trial and error — REQ-202 already demanded exactly this ("appendPrompt 的用法要在廣告介面上
完整,呼叫端不必試錯") and it's a v33 REQ, not new. REQ-201 (cold-client version-loop visibility),
REQ-209 (printed examples must actually register) and REQ-210 (response wrapping/size sized for a
cold client) are the standing consumability contract this gate inherits and must not regress.

**ARCH-172's pending owner decision is, at bottom, a consumability trade-off, and I'll take a
position on it since the gate must land it**: `listSummaries()` behind `/api/runs`/`/api/home`
currently full-scans an unbounded `runs` table per request. Option A (keep full-history semantics,
document the scaling cliff in the port contract — ARCH-172's current draft) preserves a caller's
mental model (`avgCostUSD`/`successRate` mean "all runs, always") at the cost of an unbounded
response a cold client must be able to consume (REQ-210 territory) as the table grows monotonically
(no `DELETE FROM runs` anywhere). Option B (paginate `listSummaries()` onto the already-paginated
`list()`, limit 50/cap 500) bounds the response but **silently redefines the number** — "average
cost over all runs" becomes "average cost over the last N" with no code-visible marker that the
semantics changed. From a pure consumability lens I'd favor **A, but only if REQ-210's response-size
contract is verified against this specific endpoint under a large `runs` table** — an unbounded
sweep query is exactly the kind of endpoint REQ-210 was written against, and the two REQs currently
document their bound only as declared, not measured, per K3's own methodology objection elsewhere in
this same gate (byte-accurate worst case, not offset-scanned). If A ships without that measurement,
it is a load-bearing assumption undocumented.

**System altitude**: no REST/GraphQL + generated-docs (OpenAPI/Swagger) surface exists or is being
proposed — the MCP tool surface (with `authoring-guide.ts` as its generated-docs equivalent) *is*
this project's consumability surface for both a human-driven client and an agent caller, which is
appropriate for an MCP-first product and not a gap against this gate's scope.

## 4. Self-sustainability

**System altitude — one real self-healing mechanism, correctly scoped.** `main.ts:314-320`: the
managed LiteLLM proxy subprocess is supervised with auto-restart and a restart budget, and — this is
the observability tie-in the requirement author clearly intended — a crash+restart is logged rather
than silent ("gateway is DOWN until restart" is an explicit terminal state, not an inferred one from
absence of logs). This is the one instance in the codebase of "restart a bad instance" from the task
framing's system definition, and it predates v36 (not this gate's work, but the standing asset this
gate should not regress).

**Runtime liveness is registration-time only, not continuous** — worth naming precisely rather than
generally: `mcp-probe.ts:1-5`'s explicit comment scopes it as "the one network probe for mcp
transports," exercised when an asset is registered/synced, not a recurring health check against a
provisioned MCP server while a run is executing. That's a correctly-scoped boundary for what
REQ-211..216 asks (none of the six REQs asks for runtime tool-liveness), not a defect of this gate —
flagging only so the panel doesn't read the registration-time probe as more than it is.

**Agent altitude — no memory-metabolism/compaction mechanism exists, and none should be invented in
this gate.** The only "compaction" I found is presentational, not agent-context management:
`agent-executor.ts:19-30` truncates a *logged* prompt at a 4KB head+tail cap for the operator-log
record, and `capErrorEnvelope` bounds an error envelope at ~4096 bytes (K3, this gate). Neither
touches what a long-running agent's own context window carries turn to turn. No REQ in this ledger
traces to periodic memory compression/archival or to self-reflection/prompt recalibration against
environment change — per the architecture stage's own discipline (every ARCH row traces to a REQ),
inventing that machinery here would be scope the gate cannot justify. **This is the one dimension of
the four where I'm recording a clean gap rather than grounding a claim in a REQ**: it belongs on the
v37 candidate list alongside the circuit-breaker gap noted above, explicitly out of scope for v36.

**K8's `attempts` wiring probe (ARCH-151/173, REQ-216/K6-K8) is this gate's concrete
self-sustainability item**, correctly sized: a shared retry-attempt formula plus a systematic guard
test against the specific bug class (`composeConfig` forwarding drift) that has already produced two
prior real incidents in this project per its own memory. It's small, it's the right shape, and per
this session's advisor review it's also where Gate 8's send-back places a live, unresolved risk (see
Risks).

---

## Summary

Both altitudes apply. Observability and consumability are this codebase's strongest dimensions and
are the direct subject of most of REQ-211..216; the gate's job is landing REQ-215's sandbox seam
correctly (including its required policy ruling, not just the wire fix) and closing REQ-213's
audit/log gaps without letting the named debt (refusalsDropped, 3 unredacted lines) silently
disappear from the record. Replaceability is real and concentrated specifically at the LLM-gateway
seam (D2/GatewayClient), with K6-K8 closing a real drift between the two conformers rather than
adding new abstraction; persistence and transport replaceability are present but asymmetric and out
of this gate's scope. Self-sustainability has one genuine mechanism (LiteLLM proxy supervised
restart) and one correctly-scoped absence (agent memory metabolism) that should be filed for v37,
not built here.

## Key points

- REQ-215 (sandbox refusal-marker seam) is the one item in this gate that is *architecture-shaped*,
  not just a wiring fix: it needs an explicit, owner-visible ruling on which engine refusal codes may
  cross the sandbox catch, plus a written security assessment, before the wire contract change lands.
- ARCH-172's pending owner_decision is a consumability trade-off (response-bound vs. semantic
  stability of `avgCostUSD`/`successRate`), not a pure scalability call — recommend Option A (keep
  unbounded, document the cliff) contingent on verifying REQ-210's response-size contract against
  this specific endpoint at real table size, not just declaring it.
- K6-K8's shared `attemptsFor()` + compose-config probe is simultaneously a replaceability fix
  (closes the two-conformer drift) and a self-sustainability item (systematic guard against a
  recurring bug class) — worth flagging to the referee as one piece of work serving two dimensions,
  not double-counted risk.
- Memory-metabolism / agent-context compaction and runtime tool-liveness / circuit-breaking are both
  genuinely absent and correctly out of scope for v36 (no REQ traces to either) — recommend filing
  both explicitly as v37 candidates in this gate's output rather than leaving them undiscoverable.
- REQ-213's `refusalsDropped`-has-no-read-surface gap and the 3 pre-v36 unredacted `console.log`
  lines are already-named debt (state.yaml v36 tail) that this proposal does not re-litigate but
  flags as still-open going into this gate's close.

## Risks

- **REQ-215 is the highest architectural risk to this gate closing cleanly**: it's the one REQ this
  round explicitly requires full Gate 2→8 (not the fix-mode path the other five take) because of its
  IPC contract + policy + security-assessment bundle. If the policy ruling (which refusal codes may
  cross the sandbox catch) is left implicit or deferred to implementation, the send-back pattern this
  gate is already in (v35→v36 for the same underlying issue class) is likely to repeat at Gate 8.
- **ARCH-172's owner_decision is a live blocker**, confirmed genuinely unanswered per state.yaml — if
  this round proposes a resolution without the actual owner ruling landing in the doc, the gate stays
  open on this item regardless of what the panel agrees on architecturally.
- **Asymmetric replaceability claims risk overclaiming**: it would be easy for a round-2 synthesis to
  generalize "the gateway is pluggable" into "the system is pluggable," which the JSON-RPC-vs-SDK
  drift and the SQLite-baked `RunStore` conformer don't support. Keep the claim scoped to the LLM
  gateway seam specifically.
- **Self-sustainability's clean gap (memory metabolism) is a legitimate v37 filing risk, not a v36
  defect** — but if another lens's round-1 proposal treats its absence as something this gate must
  fix, that's a scope disagreement worth surfacing explicitly in round 2 rather than silently
  resolving either direction.

## Expected disagreements

- **Simplicity/YAGNI lens** will likely resist framing K6-K8's shared `attemptsFor()` port function
  as anything beyond the minimal fix K7 requires, and may push back on this proposal's suggestion to
  explicitly file memory-metabolism/circuit-breaking as v37 candidates — arguing that naming future
  work in a send-back gate's output invites scope creep the gate doesn't need to carry.
- **Security lens** will likely push back hard on this proposal's observability framing of REQ-215
  (chain-of-thought/refusal-marker inspectability) — the requirement's own text already flags this as
  potentially opening "a channel for script-controlled objects to reach disk," grouped with v37's
  Bash-jail work, and given the REQ-136 system-prompt-leak precedent recorded in project memory, I'd
  expect security to argue for a narrower allowlist of refusal codes than an observability-first
  reading would prefer.
- **Performance/scalability lens** likely sides with this proposal on ARCH-172 (Option A, unbounded
  with documented cliff) — the existing ARCH-172 note already makes the data-loss argument against a
  naive LIMIT — but may diverge on how urgently the `listSummaries()` full-scan needs addressing
  versus deferring further, independent of the consumability semantics question raised here.
- **A minimalist/traceability-strict lens** may object to this proposal's dimension (2)/(4)
  discussion of `@modelcontextprotocol/sdk` drift and `RunStore`'s SQLite-coupling as out of this
  gate's REQ-211..216 scope entirely — my position is that noting an existing asymmetry without
  proposing new ARCH rows for it is within a quality-dimensions review's mandate, but I expect
  pushback on including it at all in a send-back round.
