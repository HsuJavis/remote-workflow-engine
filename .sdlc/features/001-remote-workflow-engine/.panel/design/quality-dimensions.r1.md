# Quality-dimensions expert — Design round 1 (independent proposal)

## Summary

Four dimensions, one shared thread: v34 deletes a mechanism cleanly at the architecture level, but
three of the concrete closure sites — the dispatch-time refusal, one untyped dashboard file, and
the traceability rows the Design synthesizer must mint — depend on discipline the ARCH rows state
but don't yet pin to a task. All four findings below are source-verified against `a98b469`, not
inferred from the ARCH prose alone.

## Altitude call

Both altitudes apply, not just one. This is a conventional system (Node/TS/SQLite/hand-rolled
MCP-over-HTTP server) whose core payload is an AI-agent runtime: prompts are composed and shipped
to two swappable `GatewayClient` backends (LiteLLM direct-fetch, Claude Agent SDK), models are
resolved through an alias/effort table, and tool execution is sandboxed. REQ-202/203/204 sit
exactly at the seam between the two altitudes — they delete a layer whose subject is
prompt/model/tools (agent altitude) but whose mechanism is ordinary TypeScript
types-and-refusal-codes plumbing (system altitude). I apply both below, dimension by dimension,
and say which altitude is doing the work in each point.

This is a **Design-stage** review of ARCH-136..140 / ADR-061..064 (03-tasks.md does not exist yet).
Everything below is either (a) a design-level gap the architecture rows leave open, verified
against the actual source at `a98b469`, or (b) a task-splitting risk that follows from how those
five ARCH rows will likely be sliced into implementer tasks.

---

## 1. Observability

**(a) The dispatch-time retirement refusal (ADR-063) is not committed to the coded-error path, in
a file that already demonstrates the correct pattern one line away.** `agent-executor.ts:550`
today throws a bare `new Error(\`Unknown agentType: ...\`)` — but line 540, four lines above it in
the SAME function, already does `throw codedError('PARAM_OUT_OF_RANGE', detail)`. `codedError` is
imported at the top of this exact file. ADR-063 replaces the bare throw with a structural
`Object.hasOwn(req.opts, 'agentType')` refusal but its own text only says "throw, naming the v34
retirement and the guide" — it does not say *coded* throw. ADR-062 explicitly decided the OTHER
two retirement paths (script-scan refusal, config boot warning) must be coded, for exactly the
reason that a cold caller needs to tell "removed feature" from "malformed input" programmatically.
The dispatch-time path is the third retirement surface this same slice creates and it is not
mentioned in ADR-062's decision at all — it risks shipping as the one uncoded arm, in the one file
where the local convention already argues against that. **Precise shape, so this doesn't re-litigate
ADR-062:** `AGENT_OPT_RETIRED` is an inner `AgentCallViolationCode` arm, not a top-level `ErrorCode`
— `codedError`'s first argument is the top-level code, and ADR-062 already rejected minting a new
top-level `AGENTTYPE_RETIRED`. The consistent move is `codedError(<the existing top-level code this
throw's call site already reports under>, …, { violation: 'AGENT_OPT_RETIRED' })` — the identical
`detail.violation` pattern ARCH-138 adds at `workflow-catalog.ts:490`, a third producer of the same
closed-union field, not a fourth top-level code. Design/task action: ARCH-137's task should state
this exact shape rather than leaving "coded" to be resolved ad hoc by whoever picks up the task.

**(b) `src/dashboard/lib/agent.js` is the one deletion site in ARCH-137's list that the type system
cannot pin.** `tsconfig.json` has `allowJs: true` but no `checkJs`, so this file is included in the
build but never type-checked. ARCH-137's own note claims "**Absence is pinned by the type system,
not by inventory tests**" as the reason stale references can't survive — true for
`AGENT_OPT_KEYS`/`KNOWN_FILE_CONFIG_KEYS` (both `Record<keyof T, true>`), **false** for this one
file. I read the actual function:

```js
function systemPromptNote(harness, lang) {
  const sp = harness?.systemPrompt;
  if (sp) { return /* "applied (agentType X, N bytes) — not shown" */ }
  return lang === 'zh' ? '無 system prompt 紀錄' : 'no system-prompt record';
}
```

**The sharper half, and the one I'd lead with:** ARCH-137 keeps the read path **TOTAL** over
pre-v34 rows on purpose — a legacy row's persisted `harness.systemPrompt` is not migrated away, it
stays on disk, and `deriveAgentRecords` still rebuilds it after a restart. If the type-level field
is deleted but this untyped function is not, nothing stops it from being called with a real legacy
record whose `systemPrompt` is still truthy, and it renders exactly the branch that's already
written: `"applied (agentType X, N bytes) — not shown"`. That is ADR-061's **rejected** option (d)
— "keep the dashboard's retired viewer alive for pre-v34 rows" — shipping by accident, not by
decision, purely because nothing forces this one file to be deleted in step with the type. The
milder half (new rows silently rendering "no system-prompt record" forever, once the branch above
is dead) is real too but is at worst a stale-but-true string, not a resurrected rejected option.
ARCH-137 does list this file plus `tests/unit/dashboard-lib-agent.test.js` for retirement, so the
fix is already scoped correctly — the risk is purely a **task-splitting** one: if the backend-type
deletion and the dashboard-surface deletion land as two separate implementer tasks (plausible,
given they're different modules/languages), only a test catches the drift, and only if that
specific test runs against a **legacy-shaped fixture with `systemPrompt` still populated**, not
just a fresh one where the field is already absent. Design action: pin the backend-type deletion
and the dashboard-surface deletion to the **same** 03-tasks.md task, not just the same ARCH row,
and word the test's assertion as "the field/note is
absent," not "the field/note says something different."

**(c) Agent altitude — chain-of-thought/tool-call inspectability is unaffected by this slice**, and
that is itself worth stating rather than skipping: v34 touches disclosure of *what the engine fed
the model*, not the model's own reasoning trace or tool-call sequence, which this codebase already
surfaces via `HarnessDescriptor`/`workflow_agent_log` untouched by REQ-202/203/204. No new
agent-altitude observability work is created or removed here.

**(d) Traceability (this dimension folds it in) is a task-splitting-shaped constraint on the Design
synthesizer, not just an architecture-stage fact to note in passing.** `state.yaml` gives the
measured reason: `trace.py` computes implemented/verified as the transitive upstream closure of
every IMPL/test, which is why v34 minted ARCH-136..140 as five NEW rows instead of widening
ARCH-087/094/etc.'s existing traces — appending REQ-203 there would make every v24-v33
implementation under those rows read as implementing REQ-203 (the exact v28-recorded false-green
class this project has hit before). The **same rule binds the Design stage now being synthesized**:
DES rows for this slice must be new rows tracing to ARCH-136..140, and the two DES rows the deleted
mechanism used to satisfy — DES-102 (five-segment composition) and DES-195 (the disclosure surface)
— must be marked retired **without** REQ-203 appended to their traces, for the identical reason.
Second half, and the one most likely to be missed under task-splitting: ARCH-137 retires whole test
files (`strip-first-segment`, `agent-type-composition-root`, `main-composition-root-agent-types`)
plus cases inside three more. If any surviving (non-retired) DES/ARCH row's *only* verifying test
lived inside one of those files or cases, deleting it opens a **new, unintended trace gap** — the
Gate 2 note states the 83-gap baseline stayed byte-identical pre-cut; whichever task actually
deletes those test files is the one that can silently break that invariant, and it should be the
task that re-runs the gap count, not a later gate discovering drift.

---

## 2. Replaceability

**(a) I checked the cross-gateway tool-floor question and it is NOT a defect — worth recording so
a later reviewer doesn't re-open it.** `defaultAllowedTools` enforcement lives only in
`claude-agent-sdk-client.ts:546`, with zero matches in `src/gateway/client.ts`
(`LiteLLMGatewayClient`). That looks like an INV-NOADD asymmetry at first read, but the direct-fetch
transport has **no tool surface at all** (`surfaceType: 'none'`, `curatedTools: []`, by design per
DES-066) — there is nothing for a floor to restrict there, so the two-layer tool model isn't
violated, it's vacuous on that transport. This is pre-existing and untouched by v34.

**(b) The consequence of (a) that IS design-relevant: REQ-203's "只剩兩層" (only two layers remain)
claim, and the guide rewrite it mandates, need to say *which transport* that's true of.** Read
literally, "per-call allowedTools → deployment defaultAllowedTools" as a universal engine property
is true for the SDK gateway and vacuous-but-differently-true for direct-fetch (zero layers, no
tool-calling at all). A cold client picking `gateway:"direct-fetch"` off the advertised two-layer
sentence could reasonably expect curated tool-calling to exist there and not find it. This is a
Consumability-flavored Replaceability point: **swapping the pluggable backend must not silently
change what a documented guarantee means**, so the guide's rewritten tool-layer section should
scope the two-layer claim to the tool-calling (SDK) path explicitly, not leave it to be inferred
from a separate paragraph about transports.

**(c) ADR-064 (pending) — I recommend option (A), retire `RunParams.tools` with `RunParams.prompt`,
primarily on Consumability grounds already named in the ADR, with one Replaceability note added:**
I traced `RunParams.tools`' one consumption site (`agent-executor.ts:576-580`) and confirmed it
resolves to `effectiveOpts.allowedTools` **above** the `GatewayClient` interface boundary, before
either backend is chosen — so keeping it (option B) does NOT create the cross-gateway asymmetry I
worried about in (a); it would be applied uniformly regardless of which `GatewayClient` runs. That
removes the strongest Replaceability objection to option B. The Consumability objection ADR-064
already states (the advertised "two layers" sentence becomes conditionally false for a legacy row)
stands on its own and is sufficient — I'm noting this only so the panel doesn't manufacture a
second, unverified reason for the recommendation.

---

## 3. Consumability

**(a) ARCH-136/REQ-202 (the `unit`/`ceiling` disclosure) is a clean, low-risk design — it's a
stop-dropping of numbers already computed, not new surface. No objection.**

**(b) The guide (`src/authoring-guide.ts`) is hand-written prose, not generated from the retirement
maps** — I confirmed `RETIRED_AGENT_OPT_KEYS`/`RETIRED_CONFIG_KEYS` (ARCH-138/139) and the guide
text are two independent artifacts with no mechanical link between them, the same way
`AGENT_OPT_NEAR_MISSES` already is. There is an existing test
(`tests/unit/authoring-guide.test.ts:210`, "disambiguates the three layers by their real names")
that currently pins the OLD three-layer story and must be rewritten to two — this is already
implied by REQ-203's acceptance text, so it isn't a new finding, but it's worth making an explicit
03-tasks.md line item bound to ARCH-137/140 rather than something an implementer has to notice by
running the existing suite and seeing it fail. The single existing prose reference to `agentType`
in the guide (`authoring-guide.ts:531`, teaching the frontmatter `tools:` field) also needs to go
in the same task — it's the kind of stale-prose-not-caught-by-tsc case adjacent to finding (1b).

**(c) `AGENT_OPT_NEAR_MISSES.system`/`.systemPrompt` re-pointing (ARCH-138) is the right call** —
teaching a caller to spell a key that no longer exists would be worse than todays's message.

---

## 4. Self-sustainability

**(a) System altitude — ARCH-139's warn-and-boot (not fail-fast) for a lingering
`agentDefinitionsDir` is the right tradeoff for uptime, but its only delivery channel is a
transient boot-time `console.warn`.** I checked `composeConfig` (`main.ts:145-155`): the existing
`graphAnalyzer` precedent (v24) already has this property — the warning fires once, at process
start, to stdout/stderr, with no persisted or queryable trace afterward. v34 adds a second retired
key to the same weak channel rather than introducing a new gap, so this is a **compounding**
observation, not a new defect, and likely out of this iteration's scope — but I'm naming it because
"self-healing needs a durable, queryable signal, not a transient log line" is exactly this
dimension's own standard, and a long-running server whose boot log nobody tails can carry a
retired, inert key for many iterations with zero ongoing signal that anything is wrong. If the
panel wants a minimal v34-scoped fix: extending whatever deployment-level queryable surface this
engine already exposes (not `workflow_describe`, which is per-workflow) to also report "retired
keys present at last boot" would close it at low cost; if that's judged out of scope, I'd rather it
be an explicit deferral than a silent one.

**(b) Agent altitude — memory metabolism / tool-liveness / self-reflection are not implicated by
this slice** and I'm saying so explicitly rather than skipping the sub-point: REQ-202/203/204
delete a static, registration-time-resolved layer; nothing here touches long-running context,
periodic compression, or live-probing an external tool/API. The one adjacent self-sustainability
property this slice DOES touch is the fail-closed dispatch refusal in finding (1a)/ADR-063, which
is a "detect environment drift (an old pinned script hitting a retired capability) and fail loud
with an actionable, typed signal" property — which is why I filed it under Observability but it is
equally a Self-sustainability point: an uncoded throw there is a signal a self-healing/alerting
process cannot act on any better than a bare crash.

---

## Risks (if unaddressed)

1. **Medium** — ADR-063's dispatch refusal ships as a bare `Error`, leaving one of three v34
   retirement paths unclassified while the other two are coded; an operator/monitor sees an
   unstructured crash instead of an actionable "your pinned script used a v34-retired option."
2. **Medium, task-splitting-shaped** — `dashboard/lib/agent.js`'s system-prompt disclosure survives
   past the type deletion because nothing forces the two tasks together, and it fails silently
   (wrong-but-plausible UI text forever) rather than loudly.
3. **Low** — the guide's two-layer tool-resolution claim reads as universal when it is scoped to
   the SDK-gateway transport; a direct-fetch deployer could read a promise that doesn't apply to
   them.
4. **Low, pre-existing/compounding** — retired-config-key warnings remain boot-log-only; v34 adds a
   second key to a channel that already had this property.

## Expected disagreements with other lenses

- **Adversarial lens**, if present at Design as it was at Architecture, will likely push back on
  (Self-sustainability 4a) as out-of-scope scope-creep for a REQ slice that is explicitly about
  deleting a layer, not building new operator-facing surfaces — I've pre-conceded that framing by
  calling it "likely out of scope" and offering the deferral-not-silence framing as the minimum
  bar, rather than proposing new machinery.
- I expect agreement, not disagreement, on (1a)/(1b): both are concrete, source-verified,
  cheap-to-fix gaps in what the architecture already committed to (coded retirement messages;
  type-system-pinned absence), not new requirements — the disagreement if any will be about whether
  they need an explicit 03-tasks.md line or are "obviously" covered by ARCH-137/138's existing text.
- On ADR-064 I've converged toward the architecture's own stated recommendation (option A) rather
  than opened new ground, but for a different primary reason path (I ruled out the cross-gateway
  asymmetry I initially suspected) — another lens re-deriving the same asymmetry concern without
  checking the resolution site (`agent-executor.ts:576-580`) is the likely source of any
  Replaceability-flavored disagreement here.
