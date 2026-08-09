---
lens: quality-dimensions
round: 2 (debate — cross-lens response + updated positions)
author: quality-dimensions expert
scope: v11 Sprint 3 — REQ-071, REQ-072, REQ-073 (n8n-style graph dashboard, Morandi theme)
date: 2026-08-09
---

# Quality-Dimensions Architecture — Round 2

## Cross-Lens Summary

The adversarial lens's r1 proposes 7 key points (K1–K7). After inspecting the relevant source code,
my concede/hold/rebut decisions are as follows:

| Adversarial point | Decision | Basis |
|---|---|---|
| K1 — pure `layoutGraph` function with explicit positions | **CONCEDE** | edges + pan/zoom require explicit coordinates (see §2 below) |
| K2 — derive harness from transcript; never duplicate prompt into `AgentRecord` | **REBUT** | code evidence: transcript lacks prompt, tool surface, skills, MCP names (see §1) |
| K3 — two-tier redaction proof (unit test + headless DOM assertion) | **CONCEDE** | capture-time control is primary; whole-path proof is complementary and correct |
| K4 — textContent-only, even inside SVG | **CONCEDE** | r1 did not name this invariant explicitly; adversarial is right to demand it |
| K5 — bound payloads; cap display at N nodes + "N more"; keep 3s poll, no SSE | **CONVERGE** | already aligned; transcript display cap maps to adversarial intent |
| K6 — trigger enum has a `chain` hole | **CONVERGE** | r1 listed `chain` as a type; adversarial formally flags it as a gate decision — both agree |
| K7 — layered pure functions as module seams | **CONVERGE** | already aligned in r1; now formally naming the seams |

The one factual dispute is K2. Everything else converges or complements.

---

## (1) Observability — updated position after code inspection

### Rebuttal of adversarial K2: the transcript does NOT carry the harness fields

The adversarial lens proposed a "decide at the gate" rule: "if the journaled transcript carries the
session-init tool/skill surface + the prompt, derive; capture names-only only as a fallback." This is
the right rule shape. Applying it to the actual code:

`TranscriptEvent.kind` ∈ `{ 'message' | 'tool_call' | 'tool_result' | 'usage' }` (src/types.ts:152).
`extractEvents()` in `claude-agent-sdk-client.ts:373` only captures what the SDK *outputs*
(assistant text, tool_use, tool_result blocks from `msg.message.content`). The input side —
the initial `req.prompt` passed to `this._query({prompt: req.prompt, options})` at line 559,
the curated `options.tools` list at line 534, skills materialized from assets, and the MCP names
from `Object.keys(mergedMcp)` — never appears in any transcript event. The decision rule yields:
**the transcript does not carry any of the four fields REQ-073 requires; capture is mandatory**.

The journal (`JournalEntry.key = {prompt: string, opts: AgentOpts}` in src/types.ts:130–132) does
carry the prompt and `opts.mcp` names. But the journal is a per-run resume artifact. There is no
`agentId → callSeq` mapping, so recovering a specific agent's prompt from the journal requires a
scan by sequence — a fragile coupling of an observability surface to an internal replay structure.
The journal also does not carry the resolved tool surface (`curatedTools` is computed at gateway
invoke time, not stored anywhere today).

Therefore the fallback path of the adversarial's own rule applies to all four fields:

```
harness?: {
  prompt: string;         // 4 KB cap with "…(truncated)" suffix — addresses r1 inflation concern
  tools: string[];        // curated tool names (e.g. "Read", "Bash") — NOT the full built-in surface
  skills: string[];       // skill directory names
  mcpServers: string[];   // opts.mcp names only — never resolved configs, never secret values
}
```

The four fields are simultaneously available at one point: after `curatedTools` is resolved and
before `this._query()` is awaited in `_invokeOnce()` (src/gateway/claude-agent-sdk-client.ts:559).
However, `ClaudeAgentSdkGatewayClient` currently holds no `RunStore` reference, and DES-008
(`agent-executor.ts:100`) declares `AgentTranscriptSink` "the single capture path from a gateway
call to `agent-<id>.jsonl` — never three separate paths." The exact plumbing is left to the design
stage, but the architectural constraint is: capture MUST flow through the DES-008 sink, not be a
direct gateway→store write. One viable reconciliation path (offered to the design gate, not mandated
here): emit the harness descriptor as a dispatch-time `TranscriptEvent` (`kind:'harness'`) before
any model output arrives — this makes the adversarial's "derive from transcript" premise true by
construction for future agents, eliminates the DES-008 violation, and adds negligible storage
overhead at the bounded cap. The descriptor MUST also ride the REQ-055 snapshot so REQ-073's
"clicking a finished agent" observable survives an engine restart.

The adversarial lens's stated concern — "persisting the full prompt inflates every journal +
REQ-055 snapshot" — is directly addressed by the 4 KB cap. At REQ-002's ceiling of 1000 agents
per run, worst-case storage impact is 4 KB × 1000 = ~4 MB per run snapshot — bounded and
proportionate for an observability feature.
Without capture, REQ-073's acceptance test ("clicking a finished agent shows its model, prompt text,
tool/skill lists") is unachievable.

**Concede from adversarial K2**: the goal of not duplicating large data is correct. Resolution: the
4 KB cap enforces it. I concede on "prefer derive" as a principle but rebut the premise that the
transcript provides a derivation path.

### Retained observability gaps (unchanged from r1)

**G1 — `startedBy` (trigger provenance)**: add `startedBy: {type: 'client'|'webhook'|'schedule'|'chain', id?: string}` to `RunSpec` and persist it to the `runs` table at `RunManager.start()` time. All four callers (MCP facade, webhook registry, scheduler, continuation store) pass it. The `id?` sub-field links to the originating webhook ID, schedule name, or parent run ID — enabling future drill-down from the graph's source node. The adversarial's K6 formally confirms `chain` belongs in the enum; I hold that `id?` belongs alongside it.

**G2 — Parallel-group markers via skeleton overlay**: `parseWorkflowSkeleton` (REQ-062) as topology
truth; live agent records as state annotations keyed by `label+phase`. IPC protocol change stays
deferred. No change from r1.

**G3 — `warnings: string[]` in DAG response**: unattached-frame agents produce a structured warning
at the API layer, not a silent absorb. Adversarial lens did not challenge this; it stands.

**G4b/G17 — No-secret rule**: `mcpServers` stores name-strings only; secrets are excluded at capture
time, not filtered at render time. Adversarial K3 adds a two-tier proof requirement (see §2 below)
that strengthens this position.

**Key observability decisions (r2 consolidated):**
1. Capture `harness` at dispatch time with 4 KB prompt cap and names-only arrays; no derive path.
2. Add `startedBy` with `chain` enum value and optional `id?` to `RunSpec` + `runs` table.
3. Extend `GET /api/runs/:id/dag` with `startedBy` in the response (not a new endpoint — see §3).
4. Add `warnings[]` to DAG response for unattached-frame agents.

---

## (2) Replaceability — updated position

### Concede: pure `layoutGraph` over CSS flexbox (adversarial K1)

R1 proposed CSS flexbox tree layout. The adversarial lens proposes a pure function:
`layoutGraph(dagModel, trigger) → {nodes:[{id, x, y, kind, ...}], edges}`.

CONCEDE. Two engineering reasons beyond edges:

1. **Edges require explicit coordinates.** REQ-071's "edges connect nodes in phase → parallel-group →
   nesting order" means SVG lines or arcs from one node's anchor point to another's. CSS flexbox
   positions are only discoverable via `getBoundingClientRect()` at runtime (DOM query), making the
   layout non-testable without a browser. A pure function returning `{x, y, width, height}` per
   node enables unit tests with no DOM and lets the renderer be a dumb consumer of coordinates.

2. **REQ-071's pan/zoom requirement.** Pan/zoom over an SVG viewport with explicit coordinates is
   natural (transform on the root `<g>`). Pan/zoom over a CSS flexbox tree requires DOM manipulation
   of `transform` on a wrapper div and breaks CSS flow — more complex for no gain.

The layout algorithm intent from r1 (phase columns, parallel groups as rows within a column) maps
directly to explicit x/y positions. The seam change is purely about representation, not topology.

### Retained replaceability positions

**G5 — `GraphPayload` union type**: the adversarial lens said "extend the existing /dag shape."
This is about endpoints, not types. A named TypeScript type is zero-cost and enables the renderer
to accept both skeleton and run DAG without branching on shape. I concede on the endpoint decision
(no new `/graph` route; extend `/api/runs/:id/dag`). I hold on the type:

```typescript
type GraphPayload =
  | { kind: 'skeleton'; nodes: SkeletonNode[]; name: string }
  | { kind: 'run'; layout: GraphLayout; startedBy: StartedBy };

type GraphLayout = { nodes: LayoutNode[]; edges: LayoutEdge[] };
// where LayoutNode = { id, x, y, width, height, kind, state?, label, ... }
```

The existing `/api/runs/:id/dag` response is additive: the current `DagModel` tree becomes `layout`
inside the `kind: 'run'` envelope. Since the dashboard is the only consumer today and it must
be rewritten for Sprint 3's graph rendering anyway, there is no breakage cost.

**G6 — Morandi CSS custom properties**: unchanged from r1. Not challenged.

**G7 — No external graph library**: updated to pure `layoutGraph` function (concession above);
otherwise unchanged.

**G8 — `HarnessDescriptor` exported interface**: not challenged; stands.

**Key replaceability decisions (r2 consolidated):**
1. Pure `layoutGraph(dagModel, trigger) → GraphLayout` function; renderer is dumb consumer of positions + edges.
2. `GraphPayload` union type for the renderer (and as the extended `/dag` response shape); no new endpoint.
3. Morandi palette as CSS custom properties; frame color by `stableHash(frame) % paletteLength`.
4. `HarnessDescriptor` exported from `src/types.ts`; co-located with `AgentRecord`.

---

## (3) Consumability — updated position

### Concede: no new endpoint (adversarial implicit position)

The adversarial lens prefers "extend the existing `/dag` shape" over adding a `/graph` route.
CONCEDE. The harness endpoint is the same question: rather than a new `/api/runs/:id/harness` route,
extend the `workflow_agent_log` MCP tool + its HTTP endpoint to include `harness: HarnessDescriptor | null`
alongside the transcript array. One surface grows, not proliferates. The adversarial didn't explicitly
state this about harness, but it follows from their minimum-surface principle and I adopt it.

### Concede: textContent invariant (adversarial K4 — missing from r1)

R1 did not explicitly name this. CONCEDE: **no `innerHTML` of any run-derived string anywhere in
the graph render path**, including SVG `<text>` elements and detail-panel content. Agent labels,
model IDs, workflow names, tool names, skill names, and especially the harness `prompt` field are
attacker-influenceable. Setting these via `textContent` is the concrete resolution of the XSS
surface. This invariant extends REQ-067's existing dashboard convention to the new graph and
detail-panel components. Add it as an explicit acceptance criterion on REQ-073's implementation.

### Concede: two-tier redaction proof (adversarial K3)

R1 argued that capture-time control (names-only, no secret values in `HarnessDescriptor`) means
"there is nothing to scrub." The adversarial lens correctly notes that a unit test on the
redactor function doesn't prove the whole path. CONCEDE: accept both tiers:

1. Unit test: given a harness build that received a provisioned MCP config carrying a resolved
   secret value, the `HarnessDescriptor` output contains the MCP server NAME only, never the
   config or secret value.
2. Headless real-run: after a run whose agent's MCP config contained a `${secret:NAME}` handle
   resolved to a plaintext secret, the rendered DOM of the detail panel contains the handle string
   (or the server name) but NOT the plaintext secret.

Tier 1 is fast and always runs in CI. Tier 2 is slow and runs at Gate 7.5.

### Retained consumability positions

**G9 — Harness via MCP, not dashboard-only**: unchanged; now clarified as extending
`workflow_agent_log` rather than adding a new tool.

**G10 — `startedBy` in `workflow_status` and HTTP API**: unchanged.

**G11 — `GET /api/runs/:id/dag` returns `GraphPayload`**: updated to reflect concession on
endpoint (extend /dag, not new /graph); type contract is the same.

**G12 — `terminalAt?` on `RunStatusView`**: not challenged; stands.

**G13 — Canonical enum `queued`, display alias `idle`**: not challenged; stands. The API always
returns `'queued'`; the detail panel maps `queued → "idle"` at render time.

**Key consumability decisions (r2 consolidated):**
1. Extend `workflow_agent_log` response (MCP + HTTP) with `harness: HarnessDescriptor | null`.
2. `startedBy` in `workflow_status` response and `GET /api/runs/:id`.
3. `GET /api/runs/:id/dag` returns `GraphPayload` (additive envelope on existing DagModel output).
4. `terminalAt?` on `RunStatusView` to let pollers terminate.
5. `textContent`-only invariant as an explicit REQ-073 implementation constraint; no `innerHTML`.
6. Two-tier redaction proof: unit test (fast, CI) + headless DOM real-run (Gate 7.5).

---

## (4) Self-Sustainability — no rebuttal required; positions stand and are reinforced

The adversarial lens's self-sustainability-relevant points (K5, K7) align with r1 positions.

**K5 (payload bounding) vs r1 G14/G15:**
Adversarial says "window/cap the prompt; cap rendered nodes with 'N more.'" This is consistent
with r1's "transcript fetch on-click only; display capped at 50 messages." I note the adversarial's
"fetch from transcript" instruction for the prompt is moot (transcript doesn't have it; prompt is
in `AgentRecord.harness.prompt`, capped at 4 KB). The "N more" node cap is additive to r1 and
correct — adopt it.

**K7 (deterministic palette) vs r1 G16:**
Both agree: `morandiFrameHue` must be a pure deterministic function of the frame string. No change.

**G15 — Topology caching in browser:** not challenged. Stands: the 3s poll updates only agent
states (`AgentRecord.state` fields); the `GraphLayout` (node positions + edges) is computed once
on first load and reused on subsequent polls. This separates the expensive layout computation from
the cheap state overlay — the engine serves a lightweight status payload rather than recomputing
the full DAG topology on every poll.

**G17 — Prompt capture scope:** the harness `prompt` field captures what the workflow script passed
as `AgentOpts.prompt` at `agent()` call time (inside the sandbox VM). The REQ-018 secret resolution
path never substitutes a secret VALUE into a prompt string; it substitutes only into MCP server
configs. Document this scope boundary explicitly so the 4 KB cap is understood as covering
script-authored prompts, not as a defense against a class of injection that the architecture
already prevents at a deeper layer.

**Key self-sustainability decisions (r2 consolidated):**
1. Transcript fetch: on-click only; display cap 50 messages; `workflow_agent_log` HTTP gains
   optional `?limit=N&offset=M`.
2. Topology cache: browser caches `GraphLayout` on first load; subsequent polls update state overlays only.
3. Frame color: `stableHash(frame) % paletteLength`; same input → same color always.
4. Node cap: "N more" affordance for runs exceeding a display threshold (e.g., 200 agent nodes);
   no virtualization engine needed.
5. Prompt scope documented: script-authored string, 4 KB bounded; never a REQ-018 secret substitute.

---

## Remaining Disagreements

After the concessions above, one substantive disagreement remains and one is a nuance:

### Disagreement 1 (substantive): Prompt capture in `AgentRecord.harness`

The adversarial lens states "do NOT duplicate the full prompt into AgentRecord." This position
becomes architecturally impossible to hold once the empirical evidence (transcript lacks the prompt)
is accepted and REQ-073's acceptance test (showing "the prompt it ran" for a finished agent) is
taken seriously. The adversarial's own "derive from transcript" fallback does not apply here.

My position: the prompt MUST be captured. The 4 KB cap is the correct bound. If the adversarial
lens wants to hold "no prompt in AgentRecord," it must propose an alternative storage location that
(a) is accessible by agent ID, (b) survives a restart, and (c) does not couple the observability
path to the journal's internal sequence numbering. No such alternative exists in the current
architecture.

**Status: disputed; design gate must decide.** My recommendation is to capture with the 4 KB cap.

### Nuance: `GraphPayload` as a TypeScript type vs. informal schema extension

The adversarial lens may read my `GraphPayload` union type as proposing a new API surface. It is
not — it is a TypeScript interface that the extended `/api/runs/:id/dag` response satisfies. The
adversarial lens has no reason to object to a named type; their objection was to a new endpoint.
This is a terminology ambiguity, not a real disagreement.

---

## Converged Architecture (Sprint 3 gate-2 recommendations)

The following decisions are shared between both lenses after round 2:

1. **No new endpoints.** Extend `/api/runs/:id/dag` (returns `GraphPayload` envelope); extend
   `workflow_agent_log` (adds `harness` field); no `/graph`, no `/harness`, no SSE.
2. **Trigger provenance.** Add `startedBy: {type:'client'|'webhook'|'schedule'|'chain', id?:string}`
   to `RunSpec` → persisted in `runs` table → surfaced in `RunStatusView` + MCP `workflow_status`.
   The `chain` enum value is required (adversarial K6 confirmation).
3. **Harness descriptor.** Captured at dispatch time; `HarnessDescriptor = {prompt(4KB cap),
   tools:string[], skills:string[], mcpServers:string[]}`. No secret values; no resolved configs.
4. **Pure functions as seams.** `layoutGraph(dag, trigger) → GraphLayout` (pure, positions + edges);
   `morandiFrameHue(frame) → CSSColor` (pure, deterministic hash); `redactHarness(rawOpts) →
   HarnessDescriptor` (pure, names-only). Renderer is a dumb consumer of all three.
5. **textContent invariant.** No `innerHTML` of run-derived strings anywhere in the graph or
   detail-panel render path.
6. **Two-tier redaction proof.** Unit test on `redactHarness`; headless DOM assertion at Gate 7.5.
7. **Poll and topology cache.** Keep 3s poll; browser caches `GraphLayout` on first load; polls
   update state overlays only. No SSE.
8. **Skeleton overlay for parallel groups.** `parseWorkflowSkeleton` as topology truth; live
   agent records as state annotations. Sandbox-IPC protocol change stays deferred.
9. **Node cap + "N more"** for very large runs; no virtualization engine.
10. **`queued` is canonical**; `idle` is a render-time display alias only.
