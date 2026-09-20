# Architecture panel — Adversarial (security / scalability / testability), round 1

**Iteration:** v34 — REQ-202 / REQ-203 / REQ-204 (移除遠端寫不到卻會影響執行結果的提示層)
**Lens:** three internal lenses in tension — (a) security, (b) scalability/performance,
(c) testability — with Karpathy simplicity-first as the tie-breaker.
**Round:** 1, independent. Every claim below is anchored at `file:line` in the working tree at
`a98b469`; nothing here was read from a sibling panel file.

---

## 0. Altitude call (asked for before anything else)

**This project is BOTH, and the two altitudes split cleanly across this iteration's three REQs.**

- *System altitude*: the engine is an ordinary long-lived service — hand-rolled JSON-RPC-over-HTTP
  MCP server (`src/server.ts`), SQLite via better-sqlite3 (RunStore + WorkflowCatalog), Node 22.6
  ESM/TS strict, vitest (state.yaml `tech_stack`, lines 12–51). Ordinary system properties apply:
  config wiring, persisted-row compatibility, boot-time I/O.
- *Agent altitude*: the thing being changed is **what text reaches a model and who wrote it**.
  `composePrompt()` (`src/params/resolve.ts:175`), the untrusted frame constants at
  `resolve.ts:167-168`, `FRAME_CLOSE_FORGERY` (`src/params/contract.ts:141`), the harness
  descriptor's `systemPrompt:{agentType,bytes}` disclosure (`src/agent-executor.ts:671`).

Mapping to the four quality dimensions, at the altitude that actually applies:

| dimension | altitude that bites in v34 | what v34 does to it |
|---|---|---|
| consumability | **agent** | REQ-202: a cold MCP client must learn appendPrompt's admission rule, framing and byte ceiling from `tools/list` + `workflow_describe` alone, before its first call. |
| observability | **agent** | REQ-203: the harness `systemPrompt` disclosure surface *disappears with its mechanism*. Not a regression — see §4.3, this distinction must be written down or Gate 8 will misread it. |
| replaceability | **system** | REQ-203 deletes a whole composition-root module (`src/agent-definitions.ts`) and its config key. |
| self-sustainability | **system** | REQ-204 keeps the `DEFAULTS_RETIRED` refusal code alive after the pipeline behind it is gone — the refusal outlives the feature on purpose. |

I do **not** force the conventional-system reading onto REQ-202/203; and I do not invent an
agent-altitude story for the config wiring. Both are real here.

## 0.1 Honest translation of my own lens

The lens text I carry names "brute force, JWT forgery, timing attacks, concurrency & consistency
of failure counting". **None of those exist in this iteration and I will not manufacture them.**
Translated to what is actually on the table:

- **(a) Security** → *prompt-layer provenance*: which principal can write each byte the model sees,
  and whether the engine's own labels about that provenance are honest. This is the entire
  substance of v34 and where my lens has the most to say.
- **(b) Scalability/performance** → **essentially nothing**, and I say so rather than fake a
  finding: v34 deletes one boot-time `readdirSync` (`src/agent-definitions.ts:34`) and one
  registry lookup + string concat per `agent()` dispatch. There is exactly **one** genuine
  (b)-class argument in this iteration and it is not about speed — it is about *node-local state*
  (§3). Everywhere else, (b) yields to the tie-breaker.
- **(c) Testability** → module boundaries and injectable seams. v34 is a *deletion* iteration, so
  the testability question inverts: not "can we test the new thing" but **"what pins the absence,
  and what pins the byte-identity of what survives"**.

---

## 1. Summary

v34 is a **subtractive** architecture change and should be designed as one: the correct output is
*less* engine, not a new mechanism with a deprecation framework bolted on. The owner's ruling
(remove `agentType` whole, rather than only its prompt layer) is architecturally right for a
reason the requirement states only in passing and that I want promoted to a named, testable
invariant — see §2.

My position in one line: **adopt all three REQs, implement them with zero new machinery by
extending three mechanisms that already exist in the tree, and fix one inter-REQ gap
(`defaults.tools`) that would otherwise leave REQ-203's headline claim literally false.**

Three concrete design claims, each already grounded in existing code:

1. REQ-202's missing facts are *already computed and then discarded* at the projection boundary.
   `effectiveAgentBounds()` computes `ceilingKey` (`contract.ts:178-184`) and
   `projectAgentParams()` drops it (`workflow-view.ts:153-162`, projecting only `{type, default,
   range}` per `DescribeAgentParamKey`, `workflow-view.ts:88-92`). The minimum fix is two optional
   fields on one interface, not a new disclosure subsystem.
2. REQ-203's two "must say it was removed in v34" messages both have an existing precedent to
   extend: the script-side `AGENT_OPT_NEAR_MISSES` table (`workflow-meta.ts:219-232`) and the
   config-side `graphAnalyzerNote` special case (`main.ts:150-152`). One tiny retired-names map on
   each side; on the config side this *removes* an ad-hoc `if` rather than adding one.
3. Both "closed set" types — `AGENT_OPT_KEYS: Record<keyof AgentOpts|'prompt', true>`
   (`workflow-meta.ts:205-208`) and `KNOWN_FILE_CONFIG_KEYS: Record<keyof FileConfig, true>`
   (`main.ts:84-97`) — make the deletion **compile-enforced**. Removing `agentType` from
   `AgentOpts` and `agentDefinitionsDir` from `FileConfig` cannot leave a stale admission entry or
   a stale config key behind: `tsc` fails until both maps are updated. That is the single best
   testability property available in this iteration and the design should lean on it instead of
   writing "did we remove everything?" checklist tests.

---

## 2. The invariant this iteration is really about (and the trap in stating it naively)

The requirement's own principle is *"遠端作者寫不到、卻會改變執行結果"* — a layer the remote
principal cannot write but which changes the outcome. **Stated that literally, the invariant is
violated by things v34 deliberately keeps**, and an implementer who takes it literally will either
over-delete or quietly declare the invariant satisfied when it is not. After `agentType` is gone,
the following are still server-side, remote-unwritable and execution-determining:

- `defaultAllowedTools` (`main.ts:63`, `claude-agent-sdk-client.ts:546`)
- the model alias table (`aliases`, `isKnownAlias` at `contract.ts:146`)
- the three ceilings `maxTimeoutMs` / `maxAppendPromptBytes` / `maxEffort` (`contract.ts:88`)
- the gateway choice `sdk` | `direct-fetch` (`main.ts`, state.yaml tech_stack lines 22–24)

**The distinction that actually separates the legitimate from the illegitimate is not
writability — it is `additive` vs `restrictive`, plus readability.** I propose the architecture
doc state it as a named invariant so future features are tested against it:

> **INV-NOADD ("no invisible determinants").** A deployment-side input to a run may only
> *restrict* (lower a ceiling, narrow a tool set, refuse an alias) and must be *readable* by the
> calling principal through `workflow_describe` / `workflow_authoring_guide`. It may never *add*
> content the model sees, nor *expand or redirect* capability, invisibly.

Under INV-NOADD, `agentType` fails on all three of its layers — `systemPrompt` added content,
`model` redirected capability, `tools` (`agent-executor.ts:571-575`) could *expand* the tool set —
which is exactly why the owner's "remove all three layers, not just the prompt" ruling is correct
and not merely tidy.

Note the invariant has **two prongs, and a survivor need satisfy only one**: *restrictive*, or
*visibly recorded*. The three ceilings pass on the first (they can only lower a bound, and are
already readable — `authoring-guide.ts:559-560`). The **alias table passes on the second, not the
first**, and I state that explicitly because a round-2 opponent will otherwise point out — 
correctly — that an alias *redirects* (`sonnet` → whatever the deployment maps it to), which is
structurally the same move `agentType.model` made. The difference is that the alias resolution is
**recorded**: the gateway's own `descriptor.model`/`provider` is the record of what was actually
dispatched and the one-descriptor-decoration site never overwrites it (`agent-executor.ts`, the
`onHarness` comment at :~660), and the alias table is queryable. `agentType`'s redirect left no
such record. A determinant that redirects is acceptable **iff** the redirect's outcome is
persisted where the principal can read it.

**Adversarial finding (security, MID):** under INV-NOADD, `defaultAllowedTools` is the **last
remaining violator**, and it survives v34. It is *additive* — when a call carries no
`allowedTools`, the deployment's configured list becomes the agent's tool set
(`claude-agent-sdk-client.ts:546`), which can grant tools the caller never asked for and whose
value a cold client cannot read anywhere. I am **not** proposing to remove or project it in v34
(Karpathy: out of scope, no incident, and removing it would be a security *regression* — the
floor exists for a reason). I propose it be recorded as the named residual under INV-NOADD so the
next audit reads it as *known and bounded*, not as a miss. This is the item I most expect a
consumability-purist lens to want to escalate into v34; see §6.

---

## 3. Lens (b): the one real scalability argument — deleting node-local state

`agentDefinitionsDir` was **hidden node-local state on the execution-determining path**. A run's
output depended on the contents of a directory on the filesystem of whichever engine instance
happened to serve it, loaded once at `createServer()` boot (`agent-definitions.ts:33-49`,
`main.ts:209-211`). Two consequences a purely "cleanup" framing misses:

- **Undeclared node affinity.** Horizontally scaling the engine required every instance to be
  deployed with a byte-identical `agentDefinitionsDir`, or the same registered workflow produced
  different prompts/models/tools per instance — with nothing in the registration, the contract, or
  `workflow_describe` recording which definition set was in play. There is no versioning,
  checksum or run-time capture of that directory anywhere.
- **Boot-time-pinned, never reloaded.** The registry is read once at startup; editing a definition
  file mid-life changes nothing until restart, so two instances started at different times diverge
  silently.

After v34 a run's behavior is a pure function of `(registered script, param contract, run
overrides, deployment ceilings/alias table)` — all of which are either stored in the SQLite catalog
or readable through the advertised surface. **That is the multi-instance property worth having,
and v34 gets it by deletion rather than by adding a sync mechanism.** This is the only place where
lens (b) has an opinion, and it agrees with (a) and with the tie-breaker. Cost side is a rounding
error: one fewer sync `readdirSync` at boot, one fewer map lookup and one fewer segment join per
dispatch. No storage, concurrency or consistency dimension is touched.

---

## 4. Key points (the proposal proper)

### 4.1 REQ-202 — stop discarding facts the engine already computed

Current state, verified: `projectAgentParams` (`workflow-view.ts:145-165`) calls
`effectiveAgentBounds(spec, ceilings)` — which already bounds `appendPrompt.max` to
`min(author, maxAppendPromptBytes)` and tags `ceilingKey:'maxAppendPromptBytes'` **only when the
engine ceiling is the bound that actually won** (`contract.ts:178-184`, and that conditional is
itself a good honesty control: it refuses to blame an engine ceiling the caller could not have
hit). The projection then emits `{type, default, range}` and throws `ceilingKey` away. So today a
cold client sees a bare number `max: 1024` with **no unit** and no way to tell whether it is the
author's bound or the engine's.

**Proposal A1 (minimal):** widen `DescribeAgentParamKey` (`workflow-view.ts:88-92`) by two optional
fields and stop dropping what is already computed:

```
unit?: 'bytes';        // set for appendPrompt only
boundBy?: 'engine';    // set iff eff.appendPrompt.ceilingKey is present
```

Nothing else changes; no new computation, no new call, no new module. REQ-202's "單位(bytes)與
有效上限是明寫的,不是靠 `range` 的裸數字猜" is then satisfied by a projection that stopped
losing information.

**Proposal A2:** REQ-202(a) and (c)'s *rules* (must be declared → `PARAM_UNKNOWN`; framed as
untrusted; must not contain the frame-close delimiter → `PARAM_OUT_OF_RANGE`) belong in
`tool-specs.ts`'s `run_start.overrides` description (`tool-specs.ts:439-446`, which already names
`PARAM_LOCKED`/`PARAM_UNKNOWN`/`UNKNOWN_AGENT_LABEL` for exactly this reason) — i.e. on
`tools/list`, reachable with **zero** workflow-specific calls. Per-workflow *values* go on
`workflow_describe` (A1). This split matters: a cold client reads `tools/list` first.
Verified: `PARAM_UNKNOWN` is the real code on the override path (`contract.ts:517/527/627`), and
the script-scan path has its own `SCAN_VIOLATION: PARAM_UNKNOWN` (`workflow-meta.ts:498`,
`authoring-guide.ts:512`) — the two must not be conflated in the advertised text.

**Proposal A3 (security, and this is the interesting one):** the guide's new "prompt layering"
section must describe the frame *as what it is*. After v34 the composed prompt is still delivered
**as a single user message** — there is no protocol-level system prompt anywhere in this engine
(that is fact (2) in the requirement's own source narrative). Therefore
`<user-instructions untrusted="true">` is an **advisory label inside a text stream, not an
enforcement boundary**. The one thing the engine genuinely enforces is that the caller cannot
*close* the frame early (`FRAME_CLOSE_FORGERY`, `contract.ts:141`, widened at v21 Gate 8 RE-REVIEW
#6 to tolerate case and whitespace around the `/`). The caller can still write a plausible-looking
*opening* tag, a fake trailer, or ordinary prose that argues with the author's instructions.
REQ-202's own third Given already says the right thing — 引擎不會替作者決定「授權覆寫」與
「外來注入」的分界 — and my lens wants that sentence to be **normative and duplicated into the
`workflow_describe` projection note**, not left only in the guide, because the guide is what an
author reads and `describe` is what a *caller* reads.

### 4.2 REQ-203 — deletion chain, and the two messages that need a home

**Deletion set (each verified present; this is also the ledger retirement list, see §4.3):**

| site | what goes |
|---|---|
| `src/agent-definitions.ts` | whole module (`loadAgentDefinitions`, `parseFrontmatter`) |
| `src/agent-executor.ts:464-465, 496, 507, 543-552` | `AgentTypeDef`, `agentTypes` dep, registry resolution + `Unknown agentType` throw |
| `src/agent-executor.ts:571-575` | the `def?.tools` tool rung |
| `src/agent-executor.ts:582-585` | segment 1 of the composition |
| `src/agent-executor.ts:652-658, 671` | `stripFirstSegment` call, `harness_prompt_prefix_mismatch` warn, `systemPrompt:{agentType,bytes}` |
| `src/params/resolve.ts:188-205` | `stripFirstSegment` + `tests/unit/strip-first-segment.test.ts` |
| `src/run-manager.ts:77, 299, 352, 715, 1077` | `agentTypes` plumbing (both construction sites) |
| `src/types.ts:193, 204-205, 551` | `AgentOpts.agentType`, its precedence comment, `HarnessDescriptor.systemPrompt` |
| `src/workflow-meta.ts:207` | `AGENT_OPT_KEYS.agentType` |
| `src/main.ts:87, 209-211` | `agentDefinitionsDir` in `KNOWN_FILE_CONFIG_KEYS` + its `composeConfig` forwarding |
| `src/main.ts:60` | comment-only: the `defaultAllowedTools` docstring's "its own agentType-derived opts.allowedTools" clause — stale prose, separate from the config-key deletion |
| `src/dashboard/lib/agent.js:76-81, 139` + `src/dashboard/ui/agent-panel.js:200` | `systemPromptNote()` (both zh/en strings), its view-model field and the panel line that renders it — **this is the disclosure surface REQ-203 says 「隨機制消失」** |
| `tests/fixtures/dashboard-wire.ts:31, 36-37` + `tests/unit/dashboard-lib-agent.test.js` | the fixture's `systemPrompt:{agentType,bytes}` row and its assertions |
| `src/harness-defaults.ts:17, 20, 39, 68-72, 96-97` | see D2 — `HarnessDefaults.prompt` **and** `.tools`, their `KNOWN_KEYS` entries and shape guards, are the same retired object |
| `src/server.ts:95, 732` | `ServerConfig.agentDefinitionsDir` and **the one `loadAgentDefinitions()` call site** (`const agentTypes = config?.agentDefinitionsDir ? … : undefined`) — the composition root that makes the whole chain live |
| `src/tool-specs.ts:614`, `src/authoring-guide.ts:531-532` | advertised text (three tool layers → two) |
| tests | `agent-type-composition-root`, `main-composition-root-agent-types`, `strip-first-segment`, plus the `agentType` cases inside `dashboard-disclosure` / `agent-executor-harness-descriptor` / `agent-log-harness-shape` |

**Proposal B1 — lean on the compile-closed sets, do not write inventory tests.**
`AGENT_OPT_KEYS` is deliberately typed `Record<keyof AgentOpts | 'prompt', true>` with a comment
explaining that this exact trick exists because "this ledger has now recorded one-directional
vocabulary drift four times" (`workflow-meta.ts:199-208`). `KNOWN_FILE_CONFIG_KEYS` is
`Record<keyof FileConfig, true>` for the same reason (`main.ts:80-97`). Deleting the fields from
the two interfaces makes every stale reference a `tsc` error. **Testability payoff: absence is
pinned by the type system, which no test can be forgotten into.** Corollary the implementer will
hit: `tests/unit/compose-config-v2-wiring.test.ts` sweeps `KNOWN_FILE_CONFIG_KEYS` mechanically
(main.ts:80-83 says so explicitly) — its exclusion list must lose `agentDefinitionsDir` in the
same commit or the sweep fails on a key that no longer exists.

**Proposal B2 — one retired-names idea, two call sites, ~10 lines total.**
REQ-203 needs two *specific* messages that the generic paths cannot produce:
- script side: `agentType` must be refused with "removed at v34 → see `workflow_authoring_guide`",
  not the generic unknown-key refusal. Add a `RETIRED_AGENT_OPT_KEYS: Record<string,string>`
  beside `AGENT_OPT_NEAR_MISSES` (`workflow-meta.ts:219-232`), consulted on the same refusal path.
- config side: `agentDefinitionsDir` must warn-and-boot (owner ruled: **not** fail-fast) with a
  retirement note. `composeConfig` already hardcodes exactly one such note for `graphAnalyzer`
  (`main.ts:150-152`). Replace that `if` with a `RETIRED_CONFIG_KEYS` map holding both entries —
  this **deletes a special case** while satisfying the new requirement.

**Proposal B3 — the dangling near-miss pointers (this is the one an implementer will miss).**
`AGENT_OPT_NEAR_MISSES` currently maps `system → 'agentType'` and `systemPrompt → 'agentType'`
(`workflow-meta.ts:221-222`). After v34 those point an author at a key that no longer exists —
a helpful message that teaches a removed feature, which is worse than no message. They must be
**re-pointed at REQ-202's new prompt-layering section of the guide**, not merely deleted: the
author writing `systemPrompt:` in an options literal has a real need, and the true answer after
v34 is "put it in your script's own `prompt`". REQ-203 does not name this; I am raising it as a
required design item.

**Proposal B4 — removal is forward-only; the read path stays TOTAL over pre-v34 rows.** This is my
main *security/correctness* objection to a naive implementation:
- `HarnessDescriptor.systemPrompt` (`types.ts:551`) is **persisted**, and `deriveAgentRecords`
  rebuilds agent records from persisted harness events after a restart (the mechanism is described
  at `agent-executor.ts:~600` for the `markQueued` lane, same reason). Rows written before v34
  carry the field. Deleting it from the type is fine for writers; the **dashboard and the record
  rebuild must not crash or mis-render on a legacy row**.
- `RunParams.provenance` is typed `Record<..., 'override'|'default'|'engine'>` at `resolve.ts:51`
  but `types.ts:530` still carries the wider `'call'|'agentType'|'override'|'default'|'engine'`
  union for the persisted shape. Pre-v24 stored rows can hold `'agentType'`. Narrowing that union
  without a read-side tolerance is precisely the failure class this codebase has already guarded
  twice — `boundMax`/`boundEffort` both carry comments about "a stored row that predates the
  parser's shape guard" staying TOTAL (`contract.ts:174-184`, :186-). Same discipline applies here.
- **Required test shape (testability lens):** one integration test that feeds a *pre-v34 persisted
  run row* (carrying `systemPrompt` on the harness event and/or `provenance:'agentType'`) through
  the record-rebuild + dashboard projection and asserts a clean render. Without it, "we removed the
  field" ships as "the engine cannot read its own history".

### 4.3 REQ-203's ledger clause — treat it as a *predictable diff*, not prose

REQ-203 requires that REQ-136/ARCH-129/DES-195's disclosure surface be recorded as
**「隨機制消失」** (disappeared with its mechanism) rather than **「揭露回歸」** (a disclosure
regression), "否則下一輪稽核會把它讀成回歸". My lens wants this made mechanical, because this
ledger has a *measured* precedent for exactly how cheaply trace bookkeeping goes wrong: at v33
F6-1, **one line** bumping `DES-157`'s iter from v24 to v33 cleared one design-lag row and minted
**seven phantom test-lag rows** (state.yaml, `current_stage` note). Prose in a doc does not stop
that; a predicted number does.

**Proposal C1:** the architecture doc must enumerate the retiring ids up front — ARCH-004,
DES-007, DES-102 (the five-segment composition), REQ-094's composition clause, ARCH-129/DES-195
(the strip/disclosure pair), REQ-136's disclosure surface, plus the named retiring tests — and
state the **expected `sh .sdlc/trace` item/gap deltas before Gate 8 runs**. A retirement that
lands on the predicted numbers is a retirement; one that does not is a regression, and nobody has
to argue about which it was. (Baseline must be captured per CLAUDE.md: `git archive HEAD | tar -x`
into a scratch dir, or captured earlier into a file — never `git checkout`/`restore`/`stash`.)

### 4.4 REQ-204 — and the inter-REQ gap that makes REQ-203's headline false

REQ-204 removes the `authorPrompt` segment, `runParams.prompt`, and the wiring — while **keeping**
the `DEFAULTS_RETIRED` refusal code (`contract.ts:212-217`), because dropping the code would
return old callers to "silently accepted, silently inert", which is the original defect. I agree
without reservation: **a refusal code should outlive the feature it refuses.** That is a
self-sustainability property, and it costs ~6 lines.

**Proposal D1 — keep `composePrompt` as a named seam even when it shrinks to two arguments.**
After v34 it is `body + optional framed segment` — three lines. Pure simplicity says inline it into
the executor. I argue against, and this is a genuine (a)+(c) vs Karpathy conflict resolved *against*
inlining: the untrusted-frame constants (`USER_INSTRUCTIONS_OPEN`/`_CLOSE`, `resolve.ts:167-168`)
are the exact strings `FRAME_CLOSE_FORGERY` defends, and the seam is the only reason the framing
invariant is unit-testable today without booting a gateway. Inlining converts a unit test into an
integration test and scatters a security-relevant constant. The seam is *not* speculative — it has
tests now. Keep it; delete the two dead parameters.

**Proposal D2 — GAP (HIGH): `defaults.tools` is left alive and contradicts REQ-203's
"只剩兩層".** Verified: `RunParams.tools?: string[]` exists at `resolve.ts:50`, populated from
`defaults?.tools` at `resolve.ts:87`, and consumed as a tool rung at `agent-executor.ts:576-580`
("defaults.tools sits directly BELOW agentType"). REQ-204 names **only** `runParams.prompt`;
REQ-203's tool-surface clause claims that after removing `agentType` the surface is exactly
`per-call allowedTools → defaultAllowedTools`. **Both cannot be true.** With `agentType` gone the
live surface for any run whose params snapshot carries a legacy `HarnessDefaults` is *three*
layers, not two. Reachability is legacy-only (new registrations carrying `defaults` are refused
`DEFAULTS_RETIRED`), which is precisely why it will not show up in a smoke test and precisely how
it survives an iteration. `prompt` and `tools` are the **same author-only pair on the same
retired object**: `HarnessDefaults` declares both side by side (`harness-defaults.ts:17` and `:20`),
both sit in the same `KNOWN_KEYS` set (`:39`) and get adjacent shape guards (`:68-72`), and
`RunParams` carries both off that one object (`resolve.ts:43-50`, populated at `:85-87`).
Removing one and keeping the other is arbitrary — it splits a type down the middle and leaves
half a retired feature wired to the executor.
**Recommendation:** extend REQ-204 to retire `RunParams.tools` with `RunParams.prompt` — one
requirement edit, same commit, same test — or, if the owner prefers to keep the legacy rung,
amend REQ-203's text to say *three* layers for legacy rows. Silence here is how REQ-203 ships with
a documented claim its own code contradicts. Existing `tests/integration/resume-legacy-params.test.ts`
is the place this is pinned.

**Proposal D3 (byte-identity guard).** The evidence base for "this changes nothing real" is strong
— 22 registered catalog versions, **0** using `agentType`; `defaults` already refused at
registration. Pin it with **one** cheap unit test rather than a suite — but note the
obvious phrasing is unimplementable: you cannot assert "new 2-arg ≡ old 4-arg" *after* the 4-arg
function is deleted. The executable form is a **golden-string** test: run today's
`composePrompt(undefined, undefined, p, a)` over the case matrix (script prompt only / with
appendPrompt / empty-string appendPrompt / appendPrompt containing newlines) **before** the cut,
freeze the outputs as literals in the test file, and have the post-cut 2-arg function reproduce
them byte-for-byte. Capture the goldens as the test-first (Gate 5) step, not afterwards. That is
the entire regression surface of the prompt change, and it is ~15 lines.

---

## 5. Risks

| # | risk | lens | sev | mitigation |
|---|---|---|---|---|
| R1 | `defaults.tools` left alive → REQ-203's advertised "two layers" is false for legacy rows; the guide teaches a model of the system that the code contradicts. | (a) + consumability | **HIGH** | D2: retire `RunParams.tools` with `.prompt`, or amend REQ-203's text. Decide in round 2; do not let it pass silently. |
| R2 | Deleting the persisted `systemPrompt` field / narrowing the `provenance` union breaks the read path for pre-v34 rows (`deriveAgentRecords`, dashboard). | (a) correctness + (c) | **HIGH** | B4: read path stays TOTAL over legacy shapes; one integration test feeding a genuine pre-v34 row. |
| R3 | `AGENT_OPT_NEAR_MISSES.system/systemPrompt` keep pointing at the removed `agentType` — the engine teaches a deleted feature. | consumability | MID | B3: re-point at the guide's new prompt-layering section. |
| R4 | The ledger retirement is read as a disclosure **regression** at Gate 8 (REQ-136/ARCH-129/DES-195). v33 F6-1 is the measured precedent: one iter-line change minted 7 phantom gaps. | self-sustainability | MID | C1: enumerate retiring ids and **predict the trace deltas** before Gate 8; baseline via `git archive`, never checkout/restore/stash (CLAUDE.md). |
| R5 | `defaultAllowedTools` remains an *additive*, unreadable deployment-side determinant — the last INV-NOADD violator, surviving an iteration whose stated principle condemns it. | (a) | MID | §2: record as a **named, bounded residual**, not a miss. Do **not** remove in v34 (removal would be a security regression; projection is scope creep). |
| R6 | `compose-config-v2-wiring.test.ts` sweeps `KNOWN_FILE_CONFIG_KEYS`; dropping `agentDefinitionsDir` without updating its exclusion list breaks the suite on a key that no longer exists. | (c) | LOW | Same commit. Named here so it is not discovered at Gate 6. |
| R7 | Over-correction: someone reads "remove what remote authors can't write" literally and proposes removing ceilings / alias table / `defaultAllowedTools`. | (a) | LOW | INV-NOADD's additive-vs-restrictive wording exists to make this argument un-winnable. |
| R8 | REQ-202's disclosure is written as a *guarantee* ("模型會被告知那一段不可信") and a caller relies on the frame as an enforcement boundary. | (a) agent-altitude | MID | A3: advertise it as an advisory label + one enforced property (no early frame close). The author owns the adoption rule. |
| R9 | Deletion sprawl: `types.ts:530`'s dead `'call'|'agentType'` provenance rungs invite an opportunistic cleanup that widens the diff and the trace delta. | Karpathy | LOW | Delete **only** if that union is being touched for R2 anyway; otherwise leave it and say so. |

---

## 6. Expected disagreements with the other lenses

1. **vs an observability lens — the `systemPrompt` tombstone.** I expect a proposal to keep
   `systemPrompt: null` (or a `retired` marker) on the harness descriptor for audit continuity.
   **I argue no.** A field that is *always* null on every future row is noise that every reader
   must learn to ignore, and it keeps a removed mechanism's vocabulary alive in a persisted schema
   — the precise opposite of "隨機制消失". The audit continuity belongs in the **ledger**
   (C1), which is durable and is where an auditor actually looks; not in every run row forever.
   I *do* concede the half of their concern that matters: R2's legacy-row read path must stay
   total, and that is a real obligation I am accepting, not dismissing.

2. **vs an ops/robustness lens — fail-fast on `agentDefinitionsDir`.** I expect "a stale config key
   that used to change model and tools should refuse to boot, not warn". The argument has force
   (the key's *former* effect was capability-granting). **The owner has already ruled: warn, don't
   fail-fast**, consistent with the existing `graphAnalyzer` precedent, and I support it — after
   v34 the key is *inert*, so booting with it present is not a security state, it is a tidiness
   state, and fail-fast would turn a doc-lag into an outage on upgrade. My B2 note text is the
   concession: the warning must say *retired at v34*, not merely *unrecognized*.

3. **vs a DX/consumability lens — how much to advertise.** I expect a push for `unit` on *every*
   numeric param (`timeoutMs: 'ms'`), a projected `defaultAllowedTools`, and a fuller
   disclosure block. **Karpathy tie-break: minimal.** `unit:'bytes'` on `appendPrompt` is
   required by REQ-202 and closes a measured confusion (a naked `1024` that could be ms, chars or
   tokens). `unit:'ms'` on `timeoutMs` is *consistent* but nothing reports anyone getting it wrong
   — `timeoutMs`'s own name carries the unit. I name the inconsistency openly rather than hide it:
   I am choosing "do what the requirement asked and no more" over symmetry, and if round 2 shows a
   real caller confused by `timeoutMs`, it is a two-character change then.

4. **vs a security-purist lens — obscurity of the frame tag.** I expect "REQ-202(b) publishes the
   exact string `<user-instructions untrusted="true">`, handing an attacker the tag to forge".
   **I argue disclosure wins, decisively.** `FRAME_CLOSE_FORGERY` (`contract.ts:141`) already
   refuses a forged close at *admission*, case-insensitively and tolerant of whitespace around the
   `/` — the control does not depend on the caller not knowing the string, and a caller who cannot
   learn the constraint just discovers it as an opaque `PARAM_OUT_OF_RANGE`. Obscurity buys
   nothing here and costs the cold client its first call.

5. **vs a scope-discipline lens — my D2.** I expect "`defaults.tools` is not in REQ-203/204's
   text; file it as a finding for a later iteration". **I argue it must be settled *in this
   round*,** because it is not an unrelated defect: it makes a sentence this iteration is
   *writing into the advertised guide* untrue. Shipping documentation that contradicts the code is
   the exact failure class v34 exists to remove. Settling it can legitimately mean amending
   REQ-203's wording rather than expanding REQ-204 — but it cannot mean silence.

6. **Where I expect no disagreement:** deleting the mechanism rather than only its prompt layer;
   keeping `DEFAULTS_RETIRED` after its pipeline is gone; leaning on the two compile-closed key
   sets. If a lens argues for a general-purpose deprecation/plugin framework to replace
   `agentType` ("authors should be able to *upload* agent definitions"), I oppose it outright for
   v34: that is a new remote-write surface with its own authz, storage and injection questions,
   the evidence says **0 of 22** registered versions ever used the feature being removed, and the
   requirement's own scope note already forecloses speculative additions. Remove first; if demand
   is real it will arrive as a requirement with a user behind it.
