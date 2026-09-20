# Architecture panel — Adversarial (security / scalability / testability), round 1

**Iteration:** v34, **re-opened architecture stage** after the Gate 8 send-back
(`07-review.md` tail: `send_back: ["architecture","impl","tests","validation"]`).
**This file supersedes the pre-send-back round 1** written at 16:02 on 2026-09-20; that version is
still recoverable with `git show HEAD:.sdlc/features/001-remote-workflow-engine/.panel/architecture/adversarial.r1.md`
(committed at `21ad773`; the only dirty state on that path is this write itself — verified with
`git log -1 --oneline -- <path>` and `git status --porcelain`), and a byte copy of all four pre-send-back panel files was taken to the
session scratchpad before this write.
**Lens:** three internal lenses in tension — (a) security, (b) scalability/performance,
(c) testability — with Karpathy simplicity-first as the tie-breaker.
**Round:** 1, independent. Every claim is anchored at `file:line` in the working tree at `48f90b4`
(plus uncommitted `07-review.md`); nothing here was read from a sibling panel file.

---

## 0. What is actually open (scope discipline)

The Gate 8 reviewer accepted INV-V34-2/3/4, the ADR-061..064 rulings, the deletion set, and the
fail-closed refusal sites. **I do not re-argue any of them.** Re-litigating settled rows in a
send-back round is how a 33 KB document buries the one sentence that has to change.

Open to *this* stage, from the review's own `blocking_findings`:

| id | what the review sent back to architecture | my verdict after re-deriving it |
|---|---|---|
| **AC-2** | `INV-V34-1` (`02-architecture.md:4190`) and the `ARCH-137` **note** (`:4079`) call `defaultAllowedTools` an "operator-owned restriction layer" / "tool floor" while `claude-agent-sdk-client.ts:544-547` uses `??` (override, never intersection). | **Confirmed, and worse than the review states** — see §2.1. Text-only fix, exact wording in §2.2. |
| **AC-1** | `authoring-guide.ts:534-537` / `docs/AUTHORING.md:60` advertise **two** layers; the applied-when-both-absent `BUILT_IN_CORE_TOOLS` (`claude-agent-sdk-client.ts:190`, **contains `Bash`**) is a third and is unmentioned. | **Confirmed.** Belongs to impl, but the *choice between the two remedies the review offered* is an architecture call, and I rule against the code remedy — §3. |

Two things the send-back did **not** say that this round has to record — §2.3 (there is no operator
ceiling on an author's tool surface, at all) and §4.1 (nothing in the suite pins the
override-vs-intersection semantics, so the corrected sentence has no guard in code).

## 0.1 Altitude call (asked for before anything else)

**Both, and the split is clean for the open items.**

- *System altitude*: config forwarding through `composeConfig()` (`main.ts:354`), a constructor
  default in one gateway module, test placement. Ordinary service plumbing.
- *Agent altitude*: the subject is **what capability a model actually holds in a session, and who
  can read that before the call** — `options.allowedTools` (`claude-agent-sdk-client.ts:544-547`),
  the `canUseTool` arbiter (`:638`) and the `PreToolUse` realpath jail (`:670`), the post-hoc
  `HarnessDescriptor.tools` (`types.ts:506`, **non-optional** — verified, ARCH-137's post-hoc prong
  really is carried by a required field).

Per dimension, at the altitude that bites:

| dimension | altitude | what is open |
|---|---|---|
| consumability | **agent** | AC-1: an author reading the guide is told two layers; the deployment manual (`DEPLOY.md:517,632`) correctly says three. One fact, two surfaces, two different answers. |
| observability | **agent** | `HarnessDescriptor.tools` already records what won. Post-hoc is fine; *pre-hoc* is the residual (§5.1). |
| replaceability | system | untouched this round. |
| self-sustainability | **system** | AC-2 is a ledger sentence that a future audit will read as a security property the code does not have. That is exactly the debt class v34 opened to remove. |

I do not force a conventional-system reading onto the tool-surface question, and I invent no
agent-altitude story for `composeConfig` forwarding.

## 0.2 Honest translation of my own lens text

My lens names "brute force, JWT forgery, timing attacks, concurrency & consistency of failure
counting". **None of those is on the table in this send-back and I will not manufacture them.**
The engine's auth surface (`auth-tokens.db`, principals, REQ-087/REQ-015) is untouched by every
open item here. Translated to what is real:

- *authn/authz correctness* → **who may widen a session's capability, and can a deployment-side
  actor stop them** (§2.3).
- *secret protection* → what the advertised surface tells an author about what is exposed
  (`harness.prompt` echo, already handled by the validation-side send-back — not mine).
- *attack surface* → the tool set handed to the model, and the two jail seams that actually bound
  it (`canUseTool` / `PreToolUse`).
- *concurrency / failure counting* → **nothing. Stated, not invented** (§2.4).

---

## 1. Summary

The architecture-side send-back is **one sentence in two rows, and I agree it is text-only** — but
the reviewer's framing undersells it. `defaultAllowedTools` is not a weakened floor; it is **not a
restriction mechanism of any kind**. It is a *default for the absent case*, its documented purpose
is operational (stop a 7B local model drowning in the SDK CLI's uncurated surface —
`claude-agent-sdk-client.ts:51-56`, `08-validation.md` round-5 VAL-003), not defensive, and a
read-only scan of the live catalog shows **it is currently reached by zero registered calls**.
Calling it a "tool floor" in `INV-V34-1` does two kinds of damage: it books a security property the
engine does not have, and it supplies a false reason ("removing it would be a security regression")
for keeping a residual that has a perfectly good true reason (the absent case is real, and an unset
`options.allowedTools` is the VAL-003 footgun).

Fix: replace the wording in both rows with what the code does (§2.2), and **record, without
building, the consequence** — this deployment has **no operator-side ceiling** on an author's tool
surface; `LOCKED_KEYS` (`contract.ts:25`) locks `allowedTools` against *users*, not against
*authors*, and no `disallowedTools` exists anywhere in `src/` (verified: zero hits). Containment is
the jail, not the list.

On AC-1 I rule **text, not code**: copy the already-correct three-layer sentence from `DEPLOY.md`
into `authoring-guide.ts`. The code remedy the reviewer floated (default `defaultAllowedTools` to
`BUILT_IN_CORE_TOOLS` in `composeConfig`) only makes "two layers" true if the gateway's own `??`
fallback is *also* deleted, which re-arms the exact VAL-003 failure for every direct construction of
the client — more change, new hazard, same sentence needed anyway.

Testability adds exactly **one** ask, and I hold it to one: no test in the tree pins
*per-call replaces the configured default* (§4.1). The corrected architecture sentence deserves one
unit test so it cannot drift back into "floor" the way the prose drifted in the first place.

## 2. Key points

### 2.1 AC-2 confirmed, and sharper than the review put it

Code, verbatim (`src/gateway/claude-agent-sdk-client.ts:544-547`):

```ts
const baseTools =
  req.opts.allowedTools ??
  this._config.defaultAllowedTools ??
  BUILT_IN_CORE_TOOLS;
```

Three properties follow, none of them compatible with the word *floor*:

1. **Override, not intersection.** A per-call list replaces the operator's list wholesale. A call
   asking for `['WebFetch']` gets `['WebFetch']` even where the operator configured
   `['Read','Grep']`. `??` is deliberate for `[]` (an empty surface is an answer, not an absence) —
   that part is right and should stay.
2. **Additive, not restrictive.** The per-call rung can name tools the operator's list never
   contained. There is no clamp anywhere. Swept all eleven files in
   `grep -rln allowedTools src/` (`main.ts`, `types.ts`, `errors.ts`, `workflow-meta.ts`,
   `tool-specs.ts`, `authoring-guide.ts`, `skeleton-graph.ts`, `mcp-facade.ts`,
   `params/contract.ts`, `agent-executor.ts`, `gateway/claude-agent-sdk-client.ts`; `run-manager.ts`
   and `server.ts` return **zero** hits) — `workflow-meta.ts:481-493` records the literal array
   verbatim at registration and validates the *key*, never the *values*; `skeleton-graph.ts:66` and
   `mcp-facade.ts:493-498` only *project* it; `params/contract.ts:25` locks the key against callers.
   The one registration-time check that touches tool names, `TOOLS_MISMATCH` (`errors.ts:63`),
   compares the diagram's `tools:` line against the script's own `allowedTools` — a self-consistency
   check between two author-written artifacts, with no deployment-side list on either side of the
   comparison. And `grep -rn disallowedTools src/` → **zero hits**.
3. **Currently unreached.** Read-only scan of a *copy* of the live catalog
   (`<workRoot>/catalog.db` + its WAL copied to the session scratchpad; the live DB and the running
   engine were not touched): **27 versions, 166 `agent(` source matches, 166 `allowedTools:` keys,
   0 versions where any call omits the key.** Tool names actually requested across 112 literal
   arrays: `Bash` 48, `Read` 39, `Glob` 9, `Grep` 7, `Write` 7, `Edit` 2 — a strict subset of
   `BUILT_IN_CORE_TOOLS`. Zero `WebFetch`/`WebSearch`/`Task`/`Agent`. Zero `agentType`.
   *Caveat, stated once*: this is a source-text regex scan with the same known limitation as the
   engine's own `scanAgentCalls` (`AGENT_CALL_RE` has no string-literal awareness, per the
   DEPLOY.md landmine already on record). The equality 166/166 is a strong signal, not a parse.

So the residual `INV-V34-1` names is **smaller than the row claims** (nothing reaches it today) and
**differently shaped** (a default for an absent case, not a restriction). Both halves of the
sentence — "operator's tool floor" and "removing it would be a security regression" — are false,
and the second one is the dangerous half: it is a *security justification* for a *usability
mechanism*, and the next audit will either trust it (and under-defend) or catch it (and re-open the
whole row).

### 2.2 Exact replacement wording (this is what a send-back round owes)

**`INV-V34-1`, `02-architecture.md:4190` — replace the final "single named residual" sentence with:**

> **The single named residual:** `defaultAllowedTools` is *additive* and not readable pre-hoc; it
> survives v34 as a known, bounded residual — NOT a miss. It is a **deployment-set default for the
> case where a call supplies no `allowedTools` of its own**, not a floor and not a ceiling:
> `claude-agent-sdk-client.ts:544-547` resolves `req.opts.allowedTools ?? defaultAllowedTools ??
> BUILT_IN_CORE_TOOLS`, so a per-call list *replaces* it wholesale and may name tools it never
> contained. It is kept because the absent case is real and an unset `options.allowedTools` hands
> the SDK CLI's full uncurated surface to the model (VAL-003) — an operational failure, not because
> it restricts anyone. Its post-hoc prong is satisfied by `HarnessDescriptor.tools`
> (`types.ts:506`, non-optional). What bounds an agent's capability is not this list but the
> per-call arbitration seams: `permissionMode:'default'` plus `canUseTool`
> (`claude-agent-sdk-client.ts:638`) and the `PreToolUse` realpath workspace jail (`:670`).

**`ARCH-137` note, `02-architecture.md:4079` — replace the "Accepted, named tradeoff" sentence's
first clause with:**

> **Accepted, named tradeoff (not a miss):** per-agent-type tool granularity within one deployment
> is lost deliberately. What survives is a deployment-wide **default**, `defaultAllowedTools` —
> applied only to calls that carry no `allowedTools` of their own, overridable upward by any script,
> and therefore *not* an operator-owned restriction layer. It is the single named `INV-V34-1`
> residual (additive, `claude-agent-sdk-client.ts:546`, not readable pre-hoc by a cold caller),
> explicitly NOT removed and NOT projected in v34: removing it would re-arm VAL-003's uncurated
> surface for the absent case, and projecting it is scope nobody asked for.

Both edits are prose inside rows already carrying `iter: v34`; no new ARCH row, no ADR, no
`traces:` change. Per the v34 retirement-register precedent (and v33's F6-1 measured lesson), a text
correction inside an existing row mints no trace delta.

### 2.3 The consequence the send-back did not state — name it, do not build it

Once "floor" becomes "default", the missing control is visible: **no deployment-side actor can cap
what tools a registered workflow's agents may hold.** The author can opt into `WebFetch`,
`WebSearch`, `Task`/`Agent` — the three the built-in default deliberately excludes
(`claude-agent-sdk-client.ts:180-190`) — simply by writing them into a per-call array.

*Security lens position*: this is the one real finding under my (a) lens, and it is **currently
theoretical** (0/166 calls escalate). The trust model is coherent as-is: an author is an
authenticated owning principal who is already trusted to run arbitrary JS in a per-run sandbox; the
enforcement boundary is the jail + `permissionMode:'default'` arbitration, both of which apply to
`WebFetch` and `Task` exactly as to `Bash`. Therefore:

- **Record it** in `INV-V34-1`'s wording (done above — "not a floor and not a ceiling") and stop
  there for v34.
- **Do not build a ceiling this round.** A real ceiling is `effective = intersect(perCall,
  operatorCeiling)` plus decisions this round has no mandate for: is `[]` the empty set or "absent";
  does the built-in set participate; does an over-asking script get refused at *registration*
  (observable, fail-closed, breaks nothing today) or silently trimmed at *dispatch* (invisible
  capability loss — the exact defect class REQ-203 was opened to delete); what does
  `workflow_describe` then advertise. That is a new REQ with a config surface, not a send-back fix.
- **Cheap for later, if wanted**: 0/166 means an intersection would break **nothing in the current
  catalog**, and registration-time refusal is reachable — `workflow-meta.ts:481-493` already parses
  every literal array at registration. Worth one sentence in the ledger as a revisit trigger
  ("if a registered version ever requests a tool outside the deployment default, the ceiling
  question is live"), not worth a mechanism now. The seam is already there and already runs at
  registration — `TOOLS_MISMATCH` (`errors.ts:63`) proves the registration path can reason about
  tool names and refuse — so the future work is a comparison target, not new plumbing.

### 2.4 Scalability / performance: nothing. Stated, not invented.

Every open item is prose, one guide string, and one unit test. No state storage, no shared counter,
no concurrency primitive, no new per-dispatch work (the three-rung `??` chain is already the
cheapest thing in `invoke()` and stays byte-identical). The `sqlite`/`better-sqlite3` RunStore and
WorkflowCatalog are untouched. Horizontal scaling, consistency of failure counting, contention:
**not applicable to this send-back**, and I decline to manufacture a paragraph.

One measured non-finding worth a line, because a future round will ask: the guide text is built by
`buildAuthoringGuide(CEILINGS)` per call and is a byte-lock source for `docs/AUTHORING.md`; adding a
clause costs bytes on `tools/list`/`workflow_authoring_guide` responses, on the order of ~120 bytes
against a multi-KB document. Irrelevant.

## 3. AC-1: text, not code — and why that is the architecture call

The review offered two remedies. They are not equivalent.

**Remedy A (text).** Add one clause to `authoring-guide.ts:534-537` naming the built-in fallback and
its contents. `DEPLOY.md:517` and `:632` **already state it correctly** ("省略此鍵才落到內建預設",
and the literal `["Read","Write","Edit","Glob","Grep","Bash"]` with the `Bash`-is-jailed note). The
author-facing guide is the only surface that lies. Copying a sentence the operator manual already
got right is the minimum change that makes ARCH-137's own boundary claim — *three audiences, three
surfaces, **one set of facts*** — true.

Proposed clause (drop-in for the "Two layers" sentence):

> Two layers are settable, on the tool-calling (SDK gateway) path, and the first one present wins:
> the per-call `allowedTools` above, then this deployment's configured `defaultAllowedTools`. Only
> the first is settable from a script. If the deployment configures neither, the engine applies a
> built-in core set — `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash` — so a session is never handed
> the CLI's full uncurated tool list. (The direct-fetch transport has no tool surface at all — this
> section does not apply to it.)

**Remedy B (code): rejected.** Defaulting `defaultAllowedTools` to `BUILT_IN_CORE_TOOLS` inside
`composeConfig()` (`main.ts:354`) does **not** collapse the runtime to two layers unless the
client's own `?? BUILT_IN_CORE_TOOLS` is deleted too — and that fallback exists precisely for
constructions that do not come through `main.ts` (every unit-tier `new ClaudeAgentSdkGatewayClient({baseUrl})`,
and `server.ts`'s own composition root). Deleting it re-arms VAL-003 for exactly those paths. Keeping
both means the constant is now duplicated across a module boundary — `main.ts` importing a gateway
internal, or a copy that drifts. Karpathy: **B is more change, with a new hazard, and still needs
A's sentence** (a cold author cannot see `rwe.config.json`). Also relevant: this repo's own
`composeConfig` forwarding bug class (guarded by `tests/unit/compose-config-v2-wiring.test.ts`,
which already carries a `defaultAllowedTools` row at `:307`) says every new forwarding default is a
place the wiring can silently go missing. Do not add one to fix a documentation defect.

Supporting fact for either remedy: the **live** `rwe.config.json` sets
`defaultAllowedTools: ["Read","Write","Edit","Glob","Grep","Bash"]` — byte-identical to
`BUILT_IN_CORE_TOOLS`. So in *this* deployment the third rung is unreached as well, and Remedy B
would change no observable behaviour anywhere while costing a cross-module constant. (Same file
still carries the retired `agentDefinitionsDir` key — live confirmation that REQ-203's
unrecognized-key warning path, not fail-fast, is the one that runs.)

## 4. Testability

### 4.1 The one ask: pin the semantics, not the prose

`tests/unit/claude-agent-sdk-gateway-allowed-tools.test.ts` covers three cases — per-call forwarded
(`:57`), configured default applied when the call is bare (`:79`), built-in fallback when both are
absent (`:94`). **But the per-call case constructs the client with no `defaultAllowedTools` at all**
(`:59`), so nothing in the suite asserts that a per-call list *replaces* a configured one, and
nothing asserts that a per-call list may name a tool the configured list omits. The precise property
the corrected `INV-V34-1` sentence asserts is the one property untested.

Minimal guard (one `it`, same file, next to UT-024):

```ts
it('a per-call allowedTools REPLACES the configured default wholesale — it is a default, not a floor', async () => {
  const client = new ClaudeAgentSdkGatewayClient({
    baseUrl: 'http://127.0.0.1:4000',
    defaultAllowedTools: ['Read', 'Grep'],
  } as ClaudeAgentSdkGatewayConfig & { defaultAllowedTools?: string[] });
  await client.invoke({ prompt: 'hi', opts: { allowedTools: ['Bash'] }, runId: 'r1', agentId: 'a4' });
  const [[call]] = queryMock.mock.calls as [[{ options?: { allowedTools?: string[] } }]];
  expect(call.options?.allowedTools).toEqual(['Bash']); // NOT ['Read','Grep'], NOT an intersection ([])
});
```

This is architecture's *own* guard: if someone later "hardens" the rung into an intersection, the
test fails and the ledger sentence gets revisited deliberately instead of silently. Cost: 8 lines,
no new fixture, no new seam. I hold the testability lens to this one test — see §6.2 for where I
refuse to let it grow.

### 4.2 Two drift observations, recorded not escalated

- `tests/unit/authoring-guide.test.ts:357` asserts the guide *"states TWO layers"*
  (`toMatch(/two layers/i)`) — a green test today pinning a sentence AC-1 says is incomplete, while
  the gateway suite in the same run proves three rungs exist. Note the assertion does **not** block
  the fix: §3's clause still opens "Two layers are settable", so it stays green and **nothing goes
  red on its own**. That is exactly the point — **a prose assertion guards against drift, never
  against falsehood.** The TDD-correct move is to *strengthen* UT-276 first (add
  `expect(section).toMatch(/built-in core set/i)` and an assertion naming the six tools), which is
  red until the clause lands and green when it does.
- `tests/unit/claude-agent-sdk-gateway-allowed-tools.test.ts:57` still titles the per-call rung
  *"(agentType-derived curation)"* — stale after v34. One-word title fix; same defect class as AC-1
  (a sentence outliving its mechanism), zero behaviour. Debt, sweep with the next touch of that
  file.

### 4.3 Module boundaries: no change asked

The seam that matters is already injectable and already exercised: `queryImpl` is a constructor
dependency, the tool-resolution rung is three lines inside `invoke()`, and `HarnessDescriptor.tools`
gives every assertion a post-hoc anchor without booting anything. Nothing about the open items
justifies a new port, a new module, or a refactor. Anyone proposing one in round 2 is proposing
speculative architecture.

## 5. Risks

**R1 — the correction gets read as a capability regression (MED).** "It is not a floor" can be
misfiled by the next audit as *"v34 removed the operator's tool floor"*. It removed nothing; the
floor never existed. Mitigation: the §2.2 wording says *what it is* before saying what it is not,
and `ARCH-137`'s note already has the "隨機制消失 vs 回歸" distinction machinery for exactly this
misread — reuse the same phrasing discipline.

**R2 — the recorded gap (§2.3) turns into an un-owned open item (MED).** A sentence saying "no
operator ceiling exists" with no revisit trigger is how a finding becomes permanent. Mitigation: the
trigger is measurable and cheap — *any* registered version requesting a tool outside the deployment
default (today: 0 of 27). Write the trigger, not a promise.

**R3 — scope creep into a ceiling mechanism this round (MED→HIGH if it happens).** The intersection
looks like a two-character change (`??` → intersect) and is not: `[]` semantics, the built-in rung's
participation, refuse-at-registration vs trim-at-dispatch, and the describe projection all follow.
Trimming at dispatch would silently narrow capability — the precise defect class v34 exists to
delete. Mitigation: Karpathy tie-break, §6.1.

**R4 — the AC-1 sentence lands only in `authoring-guide.ts` and `docs/AUTHORING.md` drifts (LOW).**
The `.md` is a byte-lock output of the builder; the regeneration must run in the same commit or the
byte-lock test goes red (a real guard here — it will catch this).

**R5 — `DEPLOY.md:632`'s own phrasing is half-muddled (LOW).** It says "工具面只有兩層優先序" and
then names the built-in fallback in the same sentence. All the facts are present; what is missing is
the qualifier that makes the count true. §3's clause has the **same shape** and is saved only by one
word ("Two layers are **settable**") — so the fix here is that identical word
(「只有兩層**可設定**的優先序」), not a change to the count. Fold it into the validation-side
DEPLOY.md rewrite already sent back; do not open a separate item. If a reviewer rejects my clause's
shape it must reject this one too — same sentence, same remedy.

**R6 — the catalog scan is regex-based (LOW).** 166/166 rests on the same source-text matcher whose
prose-false-positive landmine is already on record. It supports "no registered call currently omits
`allowedTools`" as a strong signal; it must not be cited as a parse-verified invariant. Worded that
way in §2.1 on purpose.

## 6. Where my three lenses actually conflict (the part the lens brief demands)

### 6.1 Security vs Karpathy — the real fight, and Karpathy wins **this round**

Security's honest position: a deployment-side *default* that any author can override upward is not a
control, and an engine that hands out `Bash` by default and cannot say "never `WebFetch` on this
host" has a missing knob. Intersection is ~5 lines, and 0/166 proves it would break nothing today.

Karpathy's answer, and my tie-break: the knob has **no demand** (zero escalating scripts, zero
operator request in `01-requirements.md`), the threat it addresses is **already contained** by a
seam that arbitrates every single call regardless of the list (`canUseTool` + `PreToolUse` jail,
`permissionMode:'default'`), and the *review* asked for a sentence. Building a ceiling here would
mean shipping a mechanism to make a sentence true instead of making the sentence true — which is
the inverted version of v34's own thesis. **Verdict: correct the words, record the gap with a
measurable revisit trigger, build nothing.** I state plainly that if the trigger ever fires,
security wins the rematch and the refusal should be at *registration*, not a silent dispatch trim.

### 6.2 Testability vs Karpathy — I side against my own lens on the second test

Testability's natural ask is two tests: the override-semantics UT (§4.1) **and** an inventory test
that the guide text matches the code's rung count. I take the first and refuse the second: a
prose-matching test is what produced `authoring-guide.test.ts:357`, a green assertion pinning a
false claim. More prose tests generate more of that. `INV-V34-4`'s discipline already applies —
**absence and shape belong to the compiler, behaviour belongs to a behaviour test, and prose belongs
to a human reading it once.** One test.

### 6.3 Security vs Testability — mild, resolvable

Security would prefer the new UT also assert that `WebFetch` reaches `options.allowedTools`
unfiltered (proving "no ceiling" positively). Testability objects that this pins a *deficiency* as a
contract and makes the future ceiling work fail a test whose message says nothing about why.
Resolution: keep `['Bash']` (already in the built-in set, so the assertion is purely about the
*replace* semantics), and let the no-ceiling fact live in the ledger sentence where a revisit can
read its reasoning. If the ceiling REQ ever lands, this test changes deliberately with it.

### 6.4 Scalability vs everyone — abstains

Nothing to trade. Recorded in §2.4 rather than padded.

## 7. Expected disagreements with the other lens (quality-dimensions)

**D1 — "project the effective default into `tools/list` / `workflow_describe`" (consumability,
agent altitude). Expected, and I partly resist.**
Their case is real and I want its anchors exact, because a wrong citation loses an argument on
form: `INV-V34-1` itself concedes the residual is *not readable pre-hoc*, and `workflow_describe`
really does emit the sentinel — `mcp-facade.ts:493-498` computes a `toolSurface` map (per label: the
sorted literal array, or the **string `'default'`** when the call declares none) and serves it on the
result at `:512`. The same sentinel is the diagram's `tools:` node-label convention
(`skeleton-graph.ts:65-67`, documented for authors at `authoring-guide.ts:68-69` and `:737-738`).
So `'default'` is a *served value* with no definition anywhere on the caller's surface. Their fix:
resolve it to the actual list.
My counter: (i) a **caller cannot act on it** — `allowedTools` is in `LOCKED_KEYS`
(`contract.ts:25`), so pre-hoc knowledge changes no decision a caller can make; (ii) the **author**
who *can* act on it reads the guide, which AC-1 is already fixing with the real list in it;
(iii) empirically **0 of 166 registered calls** produce `default` at all, so the projection would
render a value nothing uses; (iv) post-hoc `HarnessDescriptor.tools` (non-optional) already tells
any principal what actually ran. Landing zone I will accept in round 2, conceded early rather than defended into a stalemate:
keep it a **named residual** with honest wording, and *define the sentinel where it is served* — one
clause in `tool-specs.ts`'s `workflow_describe` description saying `'default'` means "this
deployment's configured `defaultAllowedTools`, else the built-in core set", the same fact AC-1's
guide clause already states. **Defining a word costs one sentence; resolving a value adds a
config-dependent field to a script-derived projection** that says of itself "Names only — never a
resolved list" (`mcp-facade.ts:492`), so resolving it there crosses the projection's own stated
boundary. Not a new projection field.

**D2 — "deleting `defaultAllowedTools` outright is the truly simple answer" (a Karpathy-flavoured
move I expect *from* them, not from me). I oppose.**
0/166 argues it is *unreached*, not *useless*: the absent case is real for any future author who
omits the key, and an unset `options.allowedTools` is precisely VAL-003's uncurated surface. The
built-in fallback would still have to exist, so deletion removes the operator's ability to tune the
absent case while removing no code path. Simplicity means *fewest mechanisms that solve the
problem*, not fewest config keys.

**D3 — "REQ-203's disclosure loss should be revisited now that we are reopening these rows"
(observability). I oppose on process grounds.** The Gate 8 reviewer accepted the 「隨機制消失」
register. A send-back round is not a second bite at settled rows; re-opening it re-mints a trace
delta for zero code change. If they genuinely dispute it, it is a new REQ, not an amendment.

**D4 — the `toErr()`/`.detail` loss and the `harness-defaults.ts` dead writer half (AC-3).
No disagreement — both are already routed to v35** (`07-review.md` §2 disclosed list, IMPL-340,
TASK-229 DoD item 4). I will object if round 2 re-counts them as this round's findings; double
counting a routed item is how a "12 findings" headline gets manufactured out of four.

**D5 — "add a compile-time inventory test that the guide's layer count matches the code".**
Expected from a self-sustainability angle. I refuse per §6.2, and the counter-evidence is in the
tree: `authoring-guide.test.ts:357` is exactly that test, currently green, currently guarding a
false sentence.

---

## 8. Concrete handoff list (what this round asks Gate 3+ to carry)

1. `02-architecture.md:4190` (`INV-V34-1`) — replace the residual sentence with §2.2's text.
2. `02-architecture.md:4079` (`ARCH-137` note) — replace the tradeoff clause with §2.2's text, and
   add the §2.3 revisit trigger (one sentence: *no operator ceiling exists; trigger = any registered
   version requesting a tool outside the deployment default; today 0 of 27*).
3. `src/authoring-guide.ts:534-537` — §3's clause; regenerate `docs/AUTHORING.md` in the same commit
   (byte-lock).
4. `tests/unit/authoring-guide.test.ts:357` — **strengthen** UT-276 (assert the section names the
   built-in core set and its six tools). Written first it is red until item 3 lands; the existing
   `/two layers/i` assertion stays green throughout and is not the guard.
5. `tests/unit/claude-agent-sdk-gateway-allowed-tools.test.ts` — add §4.1's single `it`.
6. Debt, not this round: the stale `(agentType-derived curation)` test title (§4.2);
   `DEPLOY.md:632`'s "只有兩層" counting word (R5, fold into the validation send-back).

No new ARCH row, no new ADR, no new config key, no new module. **Six edits, five of them one
sentence long.**
