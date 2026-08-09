---
lens: quality-dimensions
round: 1 (independent proposal)
author: quality-dimensions expert
scope: v11 Sprint 3 — REQ-071, REQ-072, REQ-073 (n8n-style graph dashboard, Morandi theme)
date: 2026-08-09
---

# Quality-Dimensions Architecture Review — v11 Sprint 3 (REQ-071..073)

## Project Altitude Classification

This slice is a **system-altitude UI** whose *subject* is **agent-altitude observability**. The
engine itself is both a conventional distributed system (MCP HTTP server, SQLite/journal persistence,
scheduled/webhook-triggered jobs, sandboxed child processes) and an AI-agent system (Claude Agent
SDK, LiteLLM proxy, per-agent harness with tools/skills/MCP injection). For Sprint 3 specifically:

- **System altitude** applies to the graph-rendering pipeline, the new `startedBy` provenance field,
  the harness descriptor capture, the HTTP/API shape of the DAG endpoint, and the dashboard server.
- **Agent altitude** applies to the harness detail panel (REQ-073 — model, prompt, tools, skills of
  each spawned agent), the live agent state machine (`queued/running/done/failed`), and the no-secret
  rule on every observable surface.

Both altitudes are active and I apply them simultaneously below.

---

## Summary

Sprint 3 introduces the first *spatial* representation of a workflow run: nodes, edges, colored
frames, and a clickable detail panel. Four quality concerns are architectural (not implementable as
afterthoughts):

1. **Observability**: two missing data fields — trigger provenance (`startedBy`) and the per-agent
   harness descriptor (prompt/tools/skills) — are NOT currently on `RunStatusView` or `AgentRecord`.
   Without capturing them at run-start and dispatch time respectively, the graph will be missing its
   trigger source node and REQ-073's detail panel will be empty. Capturing them IS an architecture
   decision (where persisted, what sized-capped, how secret-safe).

2. **Replaceability**: `buildDagModel` (REQ-048) is already pure and renderer-agnostic — a genuine
   strength to preserve. The gap is a unified `GraphPayload` type bridging the live-run DAG
   (`buildDagModel`) and the pre-run skeleton (`parseWorkflowSkeleton` REQ-062), so the graph
   renderer is written once. Morandi palette must be CSS custom properties, not hardcoded hex.

3. **Consumability**: the harness descriptor and trigger source must appear in the MCP/HTTP API
   surface (not dashboard-HTML-only), so a programmatic caller can inspect an agent's harness
   configuration — otherwise this is an observability regression for non-browser consumers.

4. **Self-sustainability**: two bounded-load decisions must be made now — the detail panel transcript
   fetch is on-click-only (never auto-loaded on the 3s poll), and the frame-to-Morandi-color
   assignment is deterministically hash-based (never random at render time).

The parallel-group marker gap (deferred repeatedly since v8 Slice 2c) intersects REQ-071 ("edges
connect in parallel-group order") and a concrete recommendation is given: use the static skeleton
as the graph topology overlay rather than a sandbox-IPC protocol change.

---

## (1) Observability

### What exists (and what Sprint 3 builds on)

- `buildDagModel` (REQ-048/pure) constructs a composite call tree from `agents` (frame-tagged) and
  `workflowNodes` (composite boundaries) — both in `workflow_status` and `GET /api/runs/:id`.
- `parseWorkflowSkeleton` (REQ-062) produces a predicted DAG node list (phase/agent/parallel/workflow
  nodes) from a static script scan.
- REQ-050/051: phase timestamps and per-agent `startedAt`/`endedAt`/`durationMs`.
- REQ-055: cross-restart snapshot persists agents/phases/workflowNodes at terminal transition.
- REQ-073's acceptance test lists "trigger source node labeled by how the run started —
  `client` / `webhook` / `schedule`" as an observable UI element.

### System-altitude gaps

**G1 — Trigger provenance (`startedBy`) is not captured.** The trigger source node in REQ-071
requires knowing HOW a run was started: a direct MCP `workflow_run` (client), a
`WebhookRegistry.deliver` (webhook + webhook ID), a `SchedulerEngine` firing (schedule + schedule
ID), or a `ContinuationStore.fire` (chain + parent run ID). None of these write a `startedBy` field
onto the run record today. This data exists only in the call path at `RunManager.start()` time.
Architecture decision required: add `startedBy: { type: 'client'|'webhook'|'schedule'|'chain',
id?: string }` to `RunSpec` and persist it in the `runs` table (not only the terminal snapshot,
since the source node must render even for runs that did not reach terminal). The REQ-055
`run_snapshots` path is insufficient here — it fires at terminal, too late for an in-progress graph.

**G2 — Parallel-group markers on the live run DAG remain absent.** REQ-071's acceptance says "a
`parallel()` of 2 drafting agents → a Verify agent box, connected by edges." Without live
parallel-group markers (deferred since v8 Slice 2c, requires a sandbox-IPC protocol change), the
graph cannot distinguish agents that ran concurrently from agents that ran sequentially. Two
approaches avoid the IPC change:
- *Option A — Skeleton overlay*: use `parseWorkflowSkeleton`'s node list as the graph topology
  (phase/parallel-group/agent structure); populate each node with the matching live agent state by
  `label+phase` key. This is clean data composition reusing REQ-062's existing output.
- *Option B — Timing overlap heuristic*: group agents whose `startedAt`/`endedAt` intervals overlap
  (from REQ-051) as de-facto parallel. This is approximation-only and breaks if concurrency cap
  serialises agents that the script launched in a `parallel()`.
**Recommendation: Option A (skeleton overlay)**. The skeleton is already computed and cached per
workflow registration. The graph renderer treats the skeleton as structural truth and live agent
records as state annotations. The IPC protocol change stays deferred.

**G3 — No structured log for dashboard-render errors.** If `buildDagModel` receives a malformed
`RunStatusView` (e.g., an agent with a frame that has no matching `workflowNode`), REQ-048 says
"never throws, never drops an agent (an agent whose frame has no matching node attaches to root)."
This silent-absorb is correct for runtime but invisible to operators. The dashboard should expose a
`warnings` array in the DAG response for unattached agents, so an operator can diagnose a data
anomaly without reading server logs.

### Agent-altitude gaps

**G4 — Harness descriptor is not captured at agent dispatch time.** REQ-073 requires a detail panel
showing "model name, the prompt it ran, its tool list and skill list (from the resolved harness /
`AgentOpts.mcp` + agent definition), and its current status." None of these fields (except model and
state) are currently on `AgentRecord`. They must be captured at the moment
`ClaudeAgentSdkGatewayClient.runAgent()` builds its SDK session — BEFORE the session completes —
because the detail panel must show `idle` status for queued-but-not-yet-dispatched agents (which
have no result yet). Architecture decision: add an optional `harness` sub-object to `AgentRecord`:

```
harness?: {
  prompt: string;          // size-capped (see G4a below)
  tools: string[];         // names only, no configs
  skills: string[];        // skill dir names
  mcpServers: string[];    // provisioned MCP server names, NOT configs
}
```

Written via a new `RunStore.setAgentHarness(runId, agentId, harness)` call immediately after the
SDK session is constructed, before `sdk.query()` is awaited.

**G4a — Prompt size cap.** A workflow may embed a large document as an agent prompt (e.g., a seeded
file's content). Recording the full prompt in `AgentRecord` would bloat the journal and SQLite index
unboundedly. Architecture decision: cap the stored prompt at **4 KB** (same cap used for the update
result file in Sprint 2), truncating with a `…(truncated)` suffix. The detail panel displays this
truncated form; the full prompt is not separately retrievable without re-running the workflow.

**G4b — No-secret rule on harness descriptor.** `mcpServers` MUST store name-strings only (e.g.,
`"github"`, `"filesystem"`), not the provisioned MCP configs (which may contain secret refs
`${secret:...}`). `tools` stores tool names (e.g., `"Read"`, `"Bash"`). `skills` stores skill
directory names. This ensures REQ-073's "NO secret/token VALUE is ever shown" is enforced at
capture time, not at render time (redaction at render is fragile and bypassed if the API is called
directly).

### Key design decisions

1. Add `startedBy` to `RunSpec` and the `runs` table; all four callers of `RunManager.start()`
   pass it (MCP facade, webhook registry, scheduler, continuation store). Surface in `RunStatusView`
   and `GET /api/runs/:id`.
2. Choose Option A (skeleton overlay) as the parallel-group strategy for Sprint 3; document the
   skeleton-as-topology decision in `02-architecture.md` alongside the existing parallel-group-marker
   deferral note.
3. Add `harness` to `AgentRecord` with a 4 KB prompt cap and name-only arrays; written at SDK
   session construction, not at completion.
4. Add `warnings: string[]` to the DAG API response for unattached-frame agents.

---

## (2) Replaceability

### What exists

- `buildDagModel` (REQ-048) is **already pure** (no I/O, no state mutation, no throws) and
  `AgentRecord`-agnostic (takes a `RunStatusView`, returns a `DagModel`). This is a genuine design
  strength and the architecture must preserve it: the renderer MUST NOT be entangled with data
  fetching.
- `ClaudeAgentSdkGatewayClient` / `LiteLLMGatewayClient` are behind the `GatewayClient` interface;
  swapping the LLM backend is already a config change (`"gateway":"sdk"|"direct-fetch"`).
- `parseWorkflowSkeleton` (REQ-062) is also pure (no I/O, no throws, static scan only).

### System-altitude gaps

**G5 — Skeleton and live-run DAG produce different shapes; the renderer cannot be shared.** Sprint 3
needs one graph renderer that handles both the registered-workflow skeleton view (REQ-062, a
`SkeletonNode[]`) and the live-run graph (REQ-048, a `DagModel` tree). These are currently
structurally different. Architecture decision: define a `GraphPayload` union type:

```typescript
type GraphPayload =
  | { kind: 'skeleton'; nodes: SkeletonNode[]; name: string }
  | { kind: 'run';      dag: DagModel;         runId: string; startedBy: StartedBy };
```

Both `GET /api/workflows/:name/skeleton` and `GET /api/runs/:id/dag` return this type (or the
renderer accepts it). A single `renderGraph(payload: GraphPayload): SVGElement` function handles
both cases.

**G6 — Morandi palette is at risk of being hardcoded.** REQ-072 specifies "Morandi hue assigned per
frame" and "softly-tinted background container." Without a palette contract, every reviewer of
dashboard-page.ts will see scattered hex strings. Architecture decision: define the palette as CSS
custom properties on `:root` (or a `.rwe-graph` scoping class):

```css
:root {
  --graph-frame-hues: 210, 150, 30, 300, 60, 180; /* Morandi H values */
  --graph-frame-s: 18%;
  --graph-frame-l-bg: 92%;   /* tint for frame background */
  --graph-frame-l-border: 60%;
  --graph-node-running: #a8c4a2;   /* Morandi sage */
  --graph-node-done: #c2bfb0;      /* Morandi stone */
  --graph-node-failed: #c4a2a2;    /* Morandi rose */
  --graph-node-queued: #b0bec5;    /* Morandi blue-grey */
}
```

Frame colors are assigned by `frameIndex % hueCount` (derived from the `workflowNodes` order),
never random. This makes a palette swap a one-file CSS change.

**G7 — No external graph layout library; the constraint must be stated.** The dashboard's strict
CSP (no external host requests, inline-all-JS) prohibits Cytoscape, D3, or Dagre via CDN. The
architecture must state: graph layout is handled by one of (a) CSS flexbox/grid (adequate for
top-down tree DAGs, which is all we have today — no back-edges, no cycles), or (b) inline SVG with
manually computed positions (simple for trees, avoids a bundled algo). Recommendation: **CSS
flexbox tree** for Sprint 3 (each composite frame is a flex column; parallel groups are flex rows
within a phase column). This is far simpler than a generic graph layout algorithm and sufficient for
the DAG shapes the engine produces. Reserve a proper layout engine (bundled, inlined) as a future
replacement if the graph shapes become genuinely complex.

### Agent-altitude gaps

**G8 — Harness descriptor shape is not yet an interface.** If the `harness` sub-object on
`AgentRecord` is defined only in one file, it cannot be replaced (e.g., a future harness that
captures tool-call round counts). Define it as a `HarnessDescriptor` exported interface from
`src/types.ts` (or `agent-record.ts`), so both the capture site and the API endpoint share one
definition.

### Key design decisions

1. Define `GraphPayload` union type consumed by the renderer; both skeleton and run DAG endpoints
   return it.
2. Morandi palette as CSS custom properties on a scoped selector; frame-color assignment is
   `frameIndex % len(hues)`, deterministic.
3. CSS flexbox tree layout for Sprint 3; no external library; document as the chosen approach in
   `02-architecture.md`.
4. Export `HarnessDescriptor` as a named interface; co-locate with `AgentRecord`.

---

## (3) Consumability

### What exists

- MCP tools `workflow_status` / `workflow_agent_log` expose run state and per-agent transcript.
- `GET /api/runs/:id/dag` (REQ-047) exposes the `buildDagModel` result over HTTP.
- `GET /api/workflows/:name/skeleton` (REQ-062) exposes the static skeleton.
- The client plugin (REQ-010) reduces integration cost to a single install.
- `models_list` (REQ-039) and `workflow_get` (REQ-061) are discovery surfaces.

### System-altitude gaps

**G9 — Harness detail is dashboard-only; programmatic callers are excluded.** REQ-073 says "a
detail panel shows that agent's HARNESS." If the `harness` sub-object is accessible only through
the dashboard HTML, an MCP-connected agent (e.g., a CI workflow that wants to inspect why a
sub-agent used the wrong tool) cannot read it. The harness descriptor MUST be part of the
`workflow_agent_log` MCP tool response (or a new `workflow_agent_harness` tool). Minimum: extend
the `workflow_agent_log` response schema to include the `harness` field alongside the transcript,
so the existing MCP surface grows, not proliferates.

**G10 — `startedBy` provenance must be in the HTTP/MCP API, not only in the graph HTML.** An
automation that wants to know "was this run triggered by a webhook or a schedule?" cannot get the
answer from the dashboard. `workflow_status` response must include `startedBy`; `GET /api/runs/:id`
must include it. This flows naturally from the G1 decision to persist it in the `runs` table.

**G11 — No guidance on rendering the graph outside the dashboard.** The `GraphPayload` type (G5)
should be the schema that `GET /api/runs/:id/dag` returns, so a custom UI can render the same
graph without reverse-engineering the dashboard's internal DOM structure. The API contract here
matters: if `GET /api/runs/:id/dag` currently returns the raw `DagModel` type, Sprint 3 should
migrate it to `GraphPayload` (or ensure `DagModel` IS the agreed contract type and rename it
`GraphPayload` at the API boundary).

**G12 — No polling guidance for live graph updates.** The 3s poll is the mechanism; callers must
implement it themselves. The `workflow_status` response should include a `terminalAt?: string` field
so a caller can stop polling once it's set — avoiding perpetual polling on completed runs. This is
a tiny consumability improvement with no API-shape cost (it's an optional field on an existing
response).

### Agent-altitude gaps

**G13 — Agent state label mismatch between API and REQ-073 acceptance test.** REQ-073 uses the
term `idle` for a queued-but-not-dispatched agent. The existing `AgentRecord.state` enum uses
`queued`. While the dashboard can rename the display label, the architecture should confirm the
canonical enum value is `queued` (not `idle`) and that the dashboard maps `queued → "idle"` only at
render time, so MCP/API callers get the canonical `queued` string and do not depend on the
display-layer alias.

### Key design decisions

1. Extend `workflow_agent_log` response (MCP tool + HTTP endpoint) to include `harness:
   HarnessDescriptor | null` alongside the transcript array.
2. Add `startedBy` to `workflow_status` response and `GET /api/runs/:id`.
3. Define `GET /api/runs/:id/dag` to return `GraphPayload` as the stable API contract type.
4. Add `terminalAt?: string` to `RunStatusView` and the MCP status response.
5. Confirm `AgentRecord.state = 'queued'|'running'|'done'|'failed'`; map to display labels at
   render time only.

---

## (4) Self-Sustainability

### What exists (and what is genuinely strong)

- REQ-059/060 crash durability (journal replay on restart) is the dominant self-sustainability
  feature of the engine and is unaffected by Sprint 3.
- The 3s dashboard poll is self-limiting (each poll replaces the prior; no queue builds up).
- `buildDagModel` is already pure and stateless — no memory growth from repeated renders.
- REQ-026 workspace TTL GC, REQ-054 admission counter, REQ-024/063 body caps are all standing.

The self-sustainability burden of Sprint 3 is **low by design**: the graph dashboard is additive
UI on top of an already-durable data layer. The two specific concerns are payload bounding and
color-assignment determinism.

### System-altitude gaps

**G14 — Detail panel transcript fetch is unbounded without a design decision.** `workflow_agent_log`
returns the full agent transcript. A long-running agent with 50 tool-call rounds produces a
multi-hundred-KB JSON response. If the graph detail panel fetches this on every poll cycle (or on
click without a size cap), the browser can OOM on large runs and the engine serves unnecessary
payload. Architecture decision: the detail panel fetches the transcript **once, on click** (not
on poll); additionally, the dashboard caps the transcript display to the first 50 message entries
(a "show full log" link opens `workflow_agent_log` directly). The HTTP endpoint for agent transcript
should accept an optional `?limit=N&offset=M` query param (consistent with the REQ-023 pattern for
workspace file windows) so a future client can page through large transcripts.

**G15 — N open run tabs × 3s poll = N × (dag request + per-run agent status) requests.** The
3s poll hits `GET /api/runs/:id/dag` for every open tab. For a developer with 5 run tabs open, this
is 5 × 20 req/min = 100 req/min to the engine (loopback, so not a network cost, but a CPU/SQLite
cost). Architecture decision: the poll should call only `workflow_status` (MCP or HTTP, which is
already lean) and recompute the client-side `buildDagModel` in the browser from the cached
`GraphPayload` topology. The topology (dag structure) does not change for a completed run; only
agent states change while running. Store the topology once in the browser on first load; update only
the state overlays on subsequent polls.

### Agent-altitude gaps

**G16 — Frame-to-Morandi-color mapping must be deterministic across polls.** If the color
assignment is computed at render time from a non-stable order (e.g., `Object.keys(workflowNodes)`
iteration order or insertion order from a live in-progress run), the frame colors may change between
the 3s polls while a run is in progress, creating a disorienting color-flicker effect. Architecture
decision: assign frame colors based on a deterministic hash of the `frame` string (or the
`workflowNode.name + depth`), not on iteration order. A simple string hash modulo the palette length
is sufficient.

**G17 — Harness descriptor must not contain prompt content that could embed an unexpanded secret
handle.** A workflow author could write `agent(\`Here is the API key: \${config.MY_SECRET}\`)`.
If `config.MY_SECRET` is resolved from the workflow script's own runtime scope (not from the
REQ-018 secret store), it will appear as a plaintext value in the harness descriptor's `prompt`
field. Architecture decision: the harness `prompt` field is captured from `AgentOpts.prompt`
(the string value at the time `agent()` is called inside the sandbox child process), which is
already inside the VM-restricted execution context. The REAL security boundary is the REQ-018
server-side secret store (secrets in MCP configs are refs, never substituted into agent prompts by
the engine). The 4 KB prompt cap (G4a) already limits exposure surface. Document this scope
boundary explicitly: the harness descriptor captures what the **workflow script** passed as the
prompt, and secrets injected via the REQ-018 path are never in that string.

### Key design decisions

1. Detail panel fetches transcript on-click only; caps display at 50 messages; `workflow_agent_log`
   HTTP endpoint gains optional `?limit=N&offset=M` pagination.
2. Dashboard poll updates agent states only (not the full topology); topology is cached in the
   browser on first load for a completed or in-progress run.
3. Frame color assignment: `stableHash(frame) % paletteLength`; pure function, same input → same
   color always.
4. Document the harness `prompt` capture scope: script-computed prompt string, bounded, never a
   REQ-018 secret substitution.

---

## Risks

| # | Dimension | Risk | Severity |
|---|-----------|------|----------|
| R1 | Observability | `startedBy` not persisted — trigger source node cannot be rendered; added mid-sprint requires a migration on the `runs` table | High |
| R2 | Observability | Harness descriptor not captured at dispatch time — REQ-073 detail panel is empty for any completed run before the architecture decision lands | High |
| R3 | Observability | Parallel-group markers absent from live DAG — graph must approximate via skeleton overlay (Option A); if skeleton is missing for inline scripts, parallel groups are invisible | Medium |
| R4 | Replaceability | Morandi hex values hardcoded — a palette change requires grep-and-replace across dashboard-page.ts | Medium |
| R5 | Replaceability | `GraphPayload` type not defined — skeleton and live-run renderers diverge, doubling maintenance cost | Medium |
| R6 | Consumability | Harness detail dashboard-only — CI/automation cannot inspect agent harness config via MCP | Medium |
| R7 | Consumability | `startedBy` absent from MCP/HTTP API — programmatic callers cannot determine trigger source | Medium |
| R8 | Self-sustainability | Detail panel auto-fetches transcript on poll — large runs cause browser OOM and amplified engine load | High |
| R9 | Self-sustainability | Color assignment non-deterministic — frame colors flicker between polls, degrading the UX and breaking the "colored frame = named workflow" mental model | Low |

---

## Expected Disagreements with Other Lenses

**vs adversarial / security lens**: that lens will likely press on REQ-073's "NO secret value shown"
harder than I do here, asking for explicit scrubbing at render time in addition to capture-time
boundaries. I agree with defense-in-depth but believe the architecture's strongest control is
at capture time (G4b, G17): storing name-strings rather than configs means there is nothing to
scrub. A render-time scrub of `${secret:...}` patterns is cheap to add and I expect it to be
raised; it is complementary, not contradictory, to this lens's position.

**vs adversarial lens on prompt capture**: the adversarial lens will note that a malicious workflow
script could pass a secret VALUE (not a handle) as the agent prompt to smuggle it into the harness
descriptor and then read it via `workflow_agent_log`. This is within scope of the VM sandbox threat
model: scripts CAN call `agent()` with any string. The 4 KB cap limits exfiltration volume. The
harness descriptor should be documented as having the same trust level as the agent transcript
(which already contains the full model output, including any secrets the model chose to echo). This
is an ACCEPTED limitation of the transparency / isolation tradeoff, not a novel gap.

**vs performance / scalability lens**: that lens will likely push back on the 3s poll and advocate
for SSE. I agree SSE is the right long-term answer and is explicitly deferred; for Sprint 3 the
poll is adequate. I expect disagreement on G15 (N-tab amplification) — the scalability lens may
quantify this more aggressively. The architecture decision in G15 (cache topology, poll state only)
is a good-faith mitigation; if the lens says 3s × N tabs is still too much, that is a gate-2
decision, not a disagreement on direction.

**vs extensibility / plugin lens** (if present): that lens may argue for a richer `AgentHarnessPort`
that can enumerate tools dynamically. I agree the interface belongs in `02-architecture.md` but
defer capability-enumeration beyond what the SDK session init already produces (which IS the tool
list for the curated allowlist path in REQ-016). The harness descriptor is a read-only snapshot,
not a control surface.

**On the standing deferred items**: distributed trace-ID, `RunStorePort`/`CatalogPort`, OpenAPI
spec, `/health` endpoint, circuit-breaker, and journal archival were all explicitly deferred at
Sprint 2 Gate 2 as future-REQ candidates. This lens does NOT re-propose them here. They are noted
only where they intersect Sprint 3 specifically:
- Trace-ID: would help diagnose slow graph loads; still deferred.
- SSE: still deferred; 3s poll + topology-caching (G15) is the mitigation.
- Budget-on-crash-resume (carried from Sprint 2): unrelated to Sprint 3, still deferred.
