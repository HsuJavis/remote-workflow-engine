# Gate 3+4 panel — Quality-dimensions group (observability / replaceability / consumability / self-sustainability)

> Model contract: claude-sonnet-5 (user override of sonnet-4-6). **Provenance note:** no Agent/Task tool on
> this host → designer ran this lens group itself (degraded fallback). Altitude judged from state.yaml
> tech_stack: this is **both** a conventional system (MCP HTTP service, store, gateway subprocess) **and**
> an AI-agent host (Claude Agent SDK sessions, LLM backends). Both altitudes applied below.

## observability (system logs/metrics/traces + agent chain-of-thought/tool-calls, folds in traceability)
- System: RunRecorder writes one line per state transition (timestamp+runId); boot-recovery emits one line
  enumerating re-hydrated runs; GatewayClient tags every call with `(runId,agentId)` so the LiteLLM request
  log joins back to the store (this is what makes REQ-004 "local backend only" verifiable).
- Agent: AgentTranscriptSink is the SINGLE capture path → `agent-<id>.jsonl` holds the full message/tool-call
  transcript (feeds `workflow_agent_log`, dashboard, AND resume cache — one path, not three). No black box:
  every `agent()` record carries label/phase/state/provider/real-model-id/token-usage.
- DES must make the per-agent record schema explicit so `workflow_status`/`workflow_agent_log` are trivially
  serializable and the dashboard (v2) is pure read-over-store.

## replaceability (swap impl via interface/DI; agent LLM backend swappable by config)
- Three injected ports carry all replaceability we actually need: RunStore (in-mem fake for tests),
  GatewayClient (`LiteLLMGatewayClient` today, replaceable per D2), AgentSpawner (stub for dry-runs).
  DES should type these as interfaces, constructor-injected. NOT built: pluggable DB backend, pluggable
  sandbox strategy, pluggable agent engine (D1 fixes the SDK) — Karpathy: no speculative flexibility.
- LLM backend swap = pure config (alias→provider map in ARCH-005); no code change. DES pins the map shape.

## consumability (standard API + docs; agent structured JSON I/O callable like a function)
- The uniform `{runId,status,result,error?}` envelope + async submit→poll→fetch pattern is the whole
  consumability story for MCP callers; DES must state it once and every tool obeys it.
- Submission Validator collapses three ad-hoc entry checks into ONE error shape returned at submission
  (not mid-run) — DES pins `{ok:false, errors:[{code,field,message}]}` so callers branch once.
- Agent I/O: `schema` → StructuredOutput forces a validated JSON object return (callable like a typed
  function); without schema → final text string. DES states both return shapes precisely.

## self-sustainability (closed-loop autonomy: circuit-breaker; agent tool-liveness/self-reflection)
- The ONE self-healing seam v1 needs is the provider-down breaker: bounded timeout→retry→null (D-G,
  user-confirmed). It reuses REQ-003 null semantics → no new run-state. DES must define timeout/retry
  budget as config with sane defaults so a hung Ollama cannot wedge a run.
- RunGuard is the self-limiting bound: concurrency gate + 1000-agent backstop + budget ceiling stop
  runaway loops without operator intervention. Deploy restart policy (`Restart=on-failure`, ARCH-014) is
  the process-level self-heal — no custom watchdog. NOT built: autoscaling, cross-run memory, prompt
  self-calibration (speculative for a single-node QM tool).

## Headline
One transcript-sink path, one record schema, three injected ports, one config-driven alias map, one
minimal timeout→retry→null breaker, and RunGuard as the runaway backstop — cross-cutting concerns each
land at exactly one seam already present in the architecture; nothing speculative added.
