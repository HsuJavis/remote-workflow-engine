# Design panel — Adversarial group (r1, independent) · v11 Sprint 3 (REQ-071..073 / ARCH-041..045)

> Lens: three sub-lenses that trade off — **(a) Interface-contract** (signatures, I/O types, compatibility),
> **(b) Boundary/error** (failure modes, error codes, boundary completeness), **(c) Testability** (every DES
> a UT can cover; clock/storage injectable). Tie-breaker = **Karpathy simplicity-first**. Internal conflicts
> between the three are surfaced explicitly, not smoothed.
>
> **Altitude read (from tech_stack + REQs).** This is *both*: the **subject observed is agent-altitude**
> (each agent's harness — model/prompt/tools/skills/live-state), the **delivery is system-altitude** (HTTP
> routes, DOM render, payload bounds, an **unauthenticated, reverse-proxy-forwardable** read plane — D5/REQ-070).
> So I apply consumability+observability at the agent altitude (the harness must be truthful and complete) and
> the system altitude (bounded payloads, XSS/secret controls on the no-auth listener). Safety class QM.
>
> **Scope read.** ARCH itself calls this "90% render over data that already exists + 10% two security-load-bearing
> data additions." My lens agrees, and it re-prioritizes: the *interface/boundary/test* weight is almost entirely
> on the **two data additions** (ARCH-041 `startedBy`, ARCH-044 harness capture) and their **restart/secret
> boundaries** — the SVG pixels are the low-risk part. Proposed DES ids DES-063..DES-068 (synthesizer owns final numbering).

## Summary

The architecture is sound and I do not reopen its converged decisions (journaled `kind:'harness'` over a new
column; explicit-coordinate SVG over flexbox; server-authoritative recompute over client cache; capture-time
names-only redaction + two-tier proof). My contribution is **at the DES seam-contract level**, where five
concrete hazards the ARCH text leaves under-specified will bite implementation and testing:

1. **The harness *emission point* fights the deliberately-narrow `GatewayClient.invoke` contract** — and the
   two obvious fixes (re-derive in the executor / ride settle-time `result.events`) each break a stated
   invariant. I propose the one seam that satisfies all three lenses.
2. **`layoutGraph` must emit *logical* coordinates, not device pixels**, or its "pure UT" asserts brittle
   magic numbers and couples layout constants to topology logic (testability ⟂ the ARCH's literal `{x,y,width,height}`).
3. **The skeleton-overlay join key `(label+phase)` is not 1:1** — a parallel group is one `SkeletonNode` mapping
   to *N* live `AgentRecord`s that may share a label; the contract is phase→group→ordered-set, not a unique key.
4. **The harness is emitted twice** unless ARCH-045 projects it to a top-level field *and strips* `kind:'harness'`
   from the windowed transcript events (interface cleanliness + the 50-msg cap must never evict it).
5. **`startedBy` needs a nullable durable column + a *total* read-model fallback** — a closed union (interface
   purity) collides with pre-existing persisted rows and internal `start()` callers (boundary completeness).

Everything security-load-bearing (`redactHarness`, the trigger union, the state-alias map, the frame hue) is a
**pure function with an injected store/clock**, so the whole slice is UT-coverable except the two irreducible
DOM points, which the mandatory Gate-7.5 headless assertion covers.

## Key points (per ARCH module, three lenses + Karpathy tie-break)

### DES-063 — ARCH-041 `startedBy` provenance on the durable run record
- **Interface-contract.** `startedBy: { type: 'client'|'webhook'|'schedule'|'chain'; id?: string }` — a closed
  discriminated union. Surface it on `RunSpec`, `RunStatusView`, `RunSummary` (the card list needs it too), the
  `workflow_status` envelope, and `GET /api/runs/:id`. Set at `RunManager.start()` by each of the four callers
  (`mcp-facade.ts:89` → `client`; `webhook-registry.ts:137` → `webhook`+id; `scheduler-engine` → `schedule`+name;
  `continuation-store.ts:148` → `chain`+parentRunId). `id?` is stored opaquely — no source-registry, no drill-down
  machinery (Karpathy: it is a string, store the string).
- **Boundary/error.** Two boundary gaps: (i) **pre-existing persisted runs** (the `runs` table predates this
  column) and (ii) an **internal/test `start()` caller** that passes none. Both mean the field is *absent at read
  time*. The renderer's trigger-node contract must be **total** — so the read model coalesces absent →
  an explicit `{ type: 'unknown' }` sentinel (my recommendation over silently coercing to `client`, so a
  back-filled record is never mislabeled). SQLite column must be **nullable** (additive migration, no backfill
  job). Persist in the **`runs` table, not the REQ-055 terminal snapshot** (ARCH-041 is right — the source node
  must render for in-progress runs; the snapshot fires too late).
- **Testability.** Store port already injectable (`RunStore` fake). One UT per caller asserting the literal it
  sets; one persistence IT asserting `startedBy` survives a store round-trip/restart. No clock needed.
- **Internal conflict (a ⟂ b).** Interface-contract wants the union **required** (no `undefined` in the type);
  Boundary wants it **optional** (legacy rows, internal callers). **Resolved toward boundary-completeness:**
  nullable column + a total read-model coalesce to a defined sentinel. Under-labeling a real run beats a clean
  type that throws on a historical row. The `chain` display *label* stays deferred (REQ-071 enumerates only
  client/webhook/schedule) — but the enum value is **required now** so a chained run cannot crash the node builder.

### DES-064 — ARCH-042 `GraphPayload` + `layoutGraph` (pure model seam)
- **Interface-contract.** `GraphPayload = { kind:'skeleton'; nodes:SkeletonNode[]; name:string } | { kind:'run';
  layout:GraphLayout; startedBy }`; one `renderGraph` consumes both. **Keep `GET /api/runs/:id/dag` additive:
  wrap, don't reshape** — `kind:'run'.layout` should embed today's `DagModel`/`GraphLayout` shape *verbatim* so
  the only wire change is the envelope, not the tree. This makes the one-consumer breaking change (the dashboard
  is rewritten this sprint) as small as possible and keeps the seam **internal, not a frozen public contract**
  (I hold against elevating it — quality's G11). **Node-id stability is a contract invariant I pin here:** every
  node `id` is a *pure, deterministic function of node identity* (agent → `agentId`; trigger/phase/frame → a
  stable synthetic key), so pan/zoom state and click-selection survive the 3s re-render. An id that reshuffles
  per poll silently breaks selection — call it out in the DES.
- **Boundary/error.** `layoutGraph` is **total — never throws** (pure). Boundary cases the DES must name:
  empty run (trigger node only, zero agents), a live agent absent from the static skeleton (**never drop it** —
  fall back to frame-based `buildDagModel` grouping, ARCH-042's added check), an inert skeleton node (predicted,
  not-yet-run), and the 1000-agent ceiling (node cap handled downstream in ARCH-043, not here). Emit
  `warnings:string[]` for unattached-frame agents and `terminalAt?` on `RunStatusView` so pollers stop.
- **Testability.** The **master seam** — pure, no clock/store. Fixtures → assert nodes+edges deterministically;
  a dedicated UT for the divergence fallback (live agent not in skeleton still renders). This is where the
  slice's real coverage lives.
- **Internal conflict (c ⟂ a — sharpest here).** The ARCH literally specifies `nodes:[{id,x,y,width,height,...}]`
  — **device geometry**. If `layoutGraph` bakes pixels, its "pure UT" asserts `x===140` (brittle; couples the
  Morandi box-width constant into topology logic; a spacing tweak breaks a topology test). **Resolved (Karpathy +
  testability win):** `layoutGraph` emits **logical grid cells** `{col, row, laneSpan}` (col by phase→group→depth,
  row by index within a parallel group); a thin pixel-mapper in ARCH-043 turns cells→pixels. The UT asserts
  *topology and ordering* (`col===1, row===0`), never pixels. This also means a box-size restyle touches **zero**
  model tests. I recommend the DES change the ARCH's `x/y/width/height` to `col/row/laneSpan` + a documented
  cell→pixel mapper; if the panel insists on pixels in the model, the UT must assert *relative* ordering, not
  absolute values.
- **Internal conflict (a ⟂ b — the join key).** The skeleton overlay joins static `SkeletonNode`s to live
  `AgentRecord`s by `label+phase`, but **that key is not unique**: REQ-071's "2 parallel Draft agents" are one
  `SkeletonNode{kind:'parallel'}` mapping to *two* AgentRecords that may share the label `draft`. The contract is
  **phase → parallel-group → ordered set of agents** (order by `startedAt`/dispatch), *not* a 1:1 label lookup.
  The DES must state the join as a group-to-set fold and define the tie-order, else two same-label agents collapse
  into one box (a live agent silently vanishes — the exact failure ARCH-042's fallback exists to prevent).

### DES-065 — ARCH-043 Morandi SVG renderer (dumb browser projection)
- **Interface-contract.** Consumes `GraphLayout` cells + the cell→pixel mapper (DES-064). `morandiFrameHue(frame:
  string): string = palette[stableHash(frame) % palette.length]` — **pure**, so a frame never flickers hue across
  the poll. Palette as CSS custom properties on a scoped selector (one-file swap).
- **Boundary/error.** Node cap + "N more" affordance for the 1000-agent ceiling (**not** virtualization —
  Karpathy: typical runs are tiny). Page body never scrolls horizontally; a wide graph pans within its own
  `overflow` container. Empty/degraded payload renders an empty canvas, not a throw.
- **Testability.** This is the **least unit-testable module** (DOM/SVG). The adversarial move: **push all
  branching into the pure layout so the renderer is a near-branchless total projection** — mirrors the existing
  `buildDagModel`/`dashboard-page` split. Any `if node.kind===...` in the renderer is a testability liability;
  keep node-shape selection data-driven off `node.kind`. `morandiFrameHue` + the cell→pixel mapper are pure UTs;
  the render itself is Gate-7.5 headless only.
- **`textContent`-only invariant (b, security-load-bearing).** Every run-derived string — agent label, model id,
  workflow name, tool/skill names, **and text inside SVG `<text>`** — is set via `textContent`, never `innerHTML`.
  These strings are attacker-influenceable (workflow author, webhook `args`, agent output) on the **no-auth**
  plane. This extends REQ-067 verbatim and is an **explicit DES acceptance line**, not hygiene. Karpathy tie-break
  vs the n8n look: hand-rolled SVG, no vendored graph lib (a lib tempts `innerHTML`).

### DES-066 — ARCH-044 harness capture at dispatch (the security core) + `redactHarness`
- **Interface-contract.** `HarnessDescriptor = { model:string; prompt:string /*4KB cap, "…(truncated)"*/;
  tools:string[]; skills:string[]; mcpServers:string[] }`; new `TranscriptEvent.kind` value `'harness'` (extend
  the union at `types.ts:152`); `redactHarness(raw) → HarnessDescriptor` **pure** — names only, never a
  resolved MCP config, never a provider key, never a resolved `${secret:}` value.
- **THE emission-point contract problem (a ⟂ b, the headline finding).** REQ-073 wants the **resolved,
  post-curation** surface, which is computed *inside* `ClaudeAgentSdkGatewayClient` (`curatedTools` at
  `claude-agent-sdk-client.ts:463`, `mergedMcp` at :482, `modelName` at :499). But ARCH-044 mechanic (2) requires
  **eager** emission at dispatch (so clicking a *running* agent shows it and a crash preserves it) — which rules
  out riding the settle-time `result.events` array the sink already drains. Two tempting fixes each break a stated
  invariant:
  - **Re-derive the surface in the `AgentExecutor`** (it can call the already-exported pure `curateToolsForProvider`
    at :214). *Rejected:* `baseTools = allowedTools ?? defaultAllowedTools ?? BUILT_IN_CORE_TOOLS` — the last two
    live in gateway config the executor doesn't hold, so a re-derivation can show a surface **≠ the one actually
    used**. An observability panel that lies about the harness is a correctness defect, not a cosmetic one.
  - **Widen `GatewayClient.invoke` to return the harness in its result.** *Rejected:* that is settle-time, losing
    the running-agent + crash-safety property.
  - **Recommended seam:** inject a single **optional async hook** `onHarness?(h: HarnessDescriptor): Promise<void>`
    into the gateway invoke options; the client calls `onHarness(redactHarness({ model:modelName, prompt:req.prompt,
    tools:curatedTools, skills, mcp:Object.keys(mergedMcp) }))` **right after :483**, before the SDK `query()`. The
    executor wires `onHarness` to `sink.appendTranscript(runId, agentId, {kind:'harness', ...})`. `skills` = the
    materialized `.claude/skills/<name>` dirs `materializeAssets` writes into the run workspace at
    `claude-agent-sdk-client.ts:471` (the resolved skill surface the session loads via `settingSources:['project']`).
    This captures the
    **actual** resolved surface (no drift), emits **eagerly** (running-agent + restart-safe via the append-only
    journal), keeps `redactHarness` **pure/testable**, and does **not** violate ARCH-005/017's "SDK options never
    leak through ARCH-004" — a *redacted names-only projection* is exactly the observability data we intend to flow,
    not raw `Options`. One optional callback is the minimum contract widening that keeps the panel truthful.
  - **Reconcile with the existing `SessionInitRecord` (ARCH-017/DES-026).** That record already carries
    allowlist/injectedMcpNames/secretHandleNames/modelId at build time. The DES must **not emit two overlapping
    records** — either the `kind:'harness'` event *is* the SessionInitRecord-plus-prompt-plus-skills, or
    `redactHarness` projects from the same resolved values. I flag this as a required reconciliation (Karpathy:
    one event, not two).
- **`deriveAgentRecords` obligation (b — required, not optional).** `run-store.ts:18`'s `if (!usage) continue`
  drops any dispatched-but-unsettled agent on a snapshot-less restart. New total rule: **iterate an agent's
  events; a `harness` event with no later `usage` → yield a `running` record (it was dispatched), model/label from
  the harness; a `usage` event overrides → `done`/`failed` as today.** Precise boundary: `harness ⟹ running`,
  `usage ⟹ terminal`, `neither` (queued, never dispatched, no journal event) ⟹ absent (renders `idle` only while
  the run is in-process). This closes the current in-flight-agent-loss-on-restart bug as a side effect.
  **Crash-boundary wrinkle (my own boundary lens flags it):** after a kill-9 the run reclassifies
  `running → interrupted` (REQ-059/060), yet the raw `harness ⟹ running` rule would still paint its
  dispatched-but-unsettled agents `running` on a run where nothing runs. The derive rule must be
  **run-status-aware** — on an `interrupted`/`suspended` parent, a harness-without-usage agent reads `queued`
  (it re-dispatches on resume), not `running`; only an in-process run shows it `running`. State this so DES-066
  is airtight and the panel never shows a live spinner on a dead run.
- **Boundary/error, four mechanics pinned.** (1) capture point = post-curation (`:463..:483`); (2) eager write,
  not batched; (3) **latest-wins dedupe keyed on agentId** — the bounded schema-retry loop (`SCHEMA_RETRY_ATTEMPTS`)
  can build a session more than once, so a second `harness` event supersedes the first; (4) a queued agent has no
  harness event yet → panel shows `idle` (intended). Prompt **4KB-capped** (a DoS/observability bound on the
  no-auth plane, not just cosmetic). **Accepted VM-sandbox limit:** a script may pass a secret *value* as a prompt
  string — the harness captures whatever the script passed, at the transcript's trust level; the precise engine
  invariant is *"the engine never substitutes a `${secret:}` handle into a prompt"* — script-authored plaintext is
  the author's own boundary. Deferred (both lenses): whether the non-SDK direct-fetch gateway emits its own
  harness or renders harness-absent (model+status only) — one `onHarness` call site either way.
- **Testability.** `redactHarness` is the security-load-bearing transform → a **pure UT** (given a build that
  received a provisioned MCP config carrying a resolved secret, output has the server NAME only, never plaintext).
  `curateToolsForProvider` is already pure-tested. The one impure line (the `onHarness`→sink append) rides the
  already-injected `RunStore` + `_clock` seams — ts injectable. A **crash-resume IT** asserts a mid-run harness
  event replays and yields a `running` record post-restart.

### DES-067/068 — ARCH-045 harness detail panel (consumability + no-secret proof)
- **Interface-contract.** Extend the existing `workflow_agent_log` response (MCP tool + HTTP) with
  `harness: HarnessDescriptor | null` — **no new `/harness` route** (grow one surface). **Canonical
  `AgentRecord.state` stays `queued`/`running`/`done`/`failed`;** the `idle`/`completed` wording REQ-073 shows is a
  **pure render-time alias** (`queued→"idle"`, `done→"completed"`) so MCP/API callers keep the canonical strings —
  UT the alias map.
- **The double-send hazard (a — my finding #4).** The harness is a **transcript event** (`kind:'harness'`) that
  `getTranscript` already returns; adding a top-level `harness` field would send it **twice**. **Fix:** in the
  `workflow_agent_log` shaping, **project the `kind:'harness'` event to the top-level `harness` field and filter it
  out of the returned `events` window** — sent once, and (critical boundary) **never evicted by the 50-message
  display cap**, since the harness is the first event and a naive cap-last-50 would drop it. State this explicitly.
- **Boundary/error.** Transcript fetched **on-click only** (never on the 3s poll); display capped at 50 messages;
  `workflow_agent_log` HTTP gains optional `?limit=N&offset=M` (the REQ-023 windowing precedent) — bounds the
  browser-OOM / engine-amplification vector on the no-auth plane without SSE. Unknown agentId → the uniform typed
  error envelope (not a crash). `harness:null` for a queued agent or the non-SDK gateway.
- **`textContent`-only in the panel too (b, security).** The harness `prompt` is the **most attacker-influenceable
  field on the whole page**; set it and all names via `textContent`, no `innerHTML` (shared invariant with DES-065).
- **Two-tier no-secret PROOF (c — both tiers required, distinct reasons).** (1) fast **pure-mapper UT** on
  `redactHarness` (proves the function); (2) **one Gate-7.5 headless-browser assertion** that the rendered
  detail-panel DOM contains no secret plaintext (proves the *whole path* — catches a future `innerHTML` regression
  between payload and pixel that capture-time purity alone cannot). **Testability does not get to skip the real
  run** — capture-time purity is necessary but not sufficient; the DOM is where a regression lands.

## Task-splitting implications for this lens (03-tasks is unwritten — flagging where the split affects testability)

- **Split the pure model from the impure renderer**, mirroring the existing `buildDagModel`↔`dashboard-page`
  split: `layoutGraph` (pure UT) and `redactHarness` (pure UT) are their **own tasks**, distinct from the DOM
  render/panel tasks (Gate-7.5 headless only). This is the single most important split for coverage — it keeps
  every branch in a UT-able seam and leaves the DOM layer near-branchless.
- **Split harness *capture* from harness *display*.** The data addition + `deriveAgentRecords` change is
  **restart-safety-load-bearing** and needs a crash-resume IT; the panel needs only a render test. They must not
  be one task, or the restart IT gets skipped behind a UI review.
- **Split `startedBy` durability from its rendering.** The persistence path carries a survives-restart IT; the
  source-node render is part of the renderer task. Different test tiers → different tasks.
- **The `onHarness` gateway-hook wiring** (types + executor wire + client call site) should land *with* the
  capture task, not deferred — it is the seam the whole feature hangs on.

## Risks

- **R1 (HIGH) — the panel lies about the harness.** If capture re-derives the surface in the executor instead of
  reading the gateway's actual `curatedTools`/`mergedMcp`, the displayed tools/MCP set drifts from the set the model
  actually saw. An observability tool that misreports is worse than none. *Mitigation:* the `onHarness` hook at the
  real resolution site (DES-066).
- **R2 (HIGH) — a running agent renders empty / a crashed one loses its harness.** If the harness rides settle-time
  `result.events` or `deriveAgentRecords` isn't fixed, REQ-073's "clicking a running agent shows `running`" and the
  restart-safety both fail. *Mitigation:* eager `onHarness` append + the `harness ⟹ running` derive rule (DES-066).
- **R3 (HIGH) — secret plaintext reaches the DOM on the no-auth plane.** The richest, most sensitive payload the
  dashboard has ever carried (prompts + resolved harness) on a reverse-proxy-forwardable listener. *Mitigation:*
  capture-time names-only `redactHarness` **and** the mandatory Gate-7.5 headless DOM assertion (both tiers).
- **R4 (MED) — a live agent silently vanishes from the graph.** The non-unique `(label+phase)` join collapses two
  same-label parallel agents into one box. *Mitigation:* phase→group→ordered-set join + the divergence fallback
  (DES-064).
- **R5 (MED) — brittle layout tests / restyle breaks topology tests.** Pixel geometry baked into the pure model.
  *Mitigation:* logical `{col,row,laneSpan}` cells + a cell→pixel mapper (DES-064).
- **R6 (LOW) — double-sent harness / harness evicted by the 50-msg cap.** *Mitigation:* project-to-top-level +
  strip-from-events + exempt-from-cap (DES-067/068).
- **R7 (LOW) — `/api/runs/:id/dag` shape break for an out-of-tree consumer.** Only the (rewritten) dashboard
  consumes it, so accepted; minimized by wrapping today's tree as `layout` verbatim (DES-064).

## Expected disagreements with the other lens (Quality-dimensions group)

1. **Public `GraphPayload` contract (quality G11).** Quality will want `GraphPayload` elevated to a
   frozen/versioned public API with a migration note (replaceability/consumability). **I hold against it** — one
   in-tree consumer, rewritten this sprint; a frozen contract is speculative flexibility (Karpathy). Concede only
   that the *type is shared* internally. (Matches the ARCH-042 stance; I expect quality to re-press it.)
2. **`onHarness` hook vs a richer capture abstraction.** Quality may propose a first-class "harness provider" SPI
   or folding harness into a broader session-metadata subsystem (self-sustainability). **I hold for one optional
   callback** — the minimum that keeps the panel truthful; an SPI is the part Karpathy cuts. We likely *converge*
   on capture-at-dispatch (already converged at ARCH), but may split on the seam's shape.
3. **Logical cells vs the ARCH's literal pixels.** Quality endorsed the explicit-coordinate SVG at ARCH; it may
   read my `{col,row,laneSpan}` as under-specifying render fidelity. **I argue it is strictly a testability win with
   no fidelity loss** (the mapper is deterministic) — expect a short exchange, likely converge.
4. **Sentinel for absent `startedBy`.** Quality may prefer coalescing absent→`client` (fewer states) for
   consumability; **I prefer an explicit `unknown` sentinel** so a historical/internal run is never *mislabeled*.
   This is a genuine interface ⟂ observability tension worth a decision at the design gate.
5. **Non-SDK-gateway harness.** Quality (self-sustainability) may want the direct-fetch/LiteLLM gateway to emit a
   harness now for parity; **I defer it** (harness-absent = model+status only) as a non-blocking design-gate
   leftover — one `onHarness` call site either way, no REQ forces it this slice.
6. **Where the no-secret proof lives.** I expect *agreement* that both tiers are required; a possible split on
   whether the headless DOM assertion is "part of Gate 7.5 validation" (my view) vs "an extra UT-tier obligation"
   (quality may want it earlier). Minor.

Net: I expect **broad convergence** (the ARCH already reconciled the r1/r2 conflicts), with live disagreement
concentrated on (1) the public-contract elevation, (2) the exact capture seam shape, and (4) the `startedBy`
absent-value sentinel.
