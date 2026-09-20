# Quality-dimensions expert — Architecture round 2

Round 1 (mine) covered the four dimensions independently. I have now read
`adversarial.r1.md` in full. It is materially stronger on two fronts I under-specified: a named,
testable invariant for what v34 is actually retiring (INV-NOADD), and one concrete inter-REQ gap
(`defaults.tools`) that makes REQ-203's own advertised claim false for legacy rows. I integrate
both. In exchange I bring one thing neither round-1 doc caught: a **dispatch-time silent-degradation
path for old pinned catalog versions**, verified against the same scan code adversarial cited, which
belongs under Self-sustainability and Observability together.

---

## Responses to `adversarial.r1.md`

### 1. INV-NOADD ("no invisible determinants") — **concede, and adopt across my own dimensions**

Adversarial's §2 names the real invariant better than either of us had it: a deployment-side
determinant survives iff it is *restrictive* (narrows, never adds/redirects) **or** *readable* by
the calling principal. I was circling this in r1 (Consumability: "an author's `agent()` call plus
the registered param contract is now the complete, portable description of what runs") but never
made it a named, two-pronged test. I adopt INV-NOADD as the frame for round 2 and map it onto my
own four dimensions rather than treating it as a security-only artifact:

- **Observability** owns the *readable* prong — a determinant that isn't restrictive must be
  disclosed somewhere a principal can read it (`workflow_describe`, the guide, or — my addition
  below — the run's own harness record).
- **Replaceability** owns the *restrictive* prong — a determinant that can only narrow a ceiling or
  tool set is exactly the "swap without rewrite" property this dimension names one layer down from
  provider swapping: an author's script is portable across any deployment that shares the same
  advertised ceilings, because the deployment cannot silently redirect or expand what the author
  wrote.

This is a genuine strengthening of my r1 position, not a restatement — r1 asserted the two-layer
tool resolution is "more replaceable" without a test for *why*; INV-NOADD gives the test.

### 2. `defaultAllowedTools` as the last INV-NOADD violator (§2, R5) — **concede fully (self-correction below)**

I initially drafted a proposal here arguing the executed tool set is never recorded post-hoc,
symmetric to how `systemPrompt:{agentType,bytes}` used to record the prompt case, and asked for a
new `allowedTools` field on `HarnessDescriptor`. **That claim was wrong and I am retracting it
before it goes to round 3**, not softening it: I first searched with
`grep -n "tools" src/types.ts | grep -i harness`, which only matches lines containing *both*
substrings — an interface field like `tools: string[]` has no line containing "harness," so the
grep returning nothing proved nothing. Reading the actual interface:

```
src/types.ts:488  export interface HarnessDescriptor {
src/types.ts:506    tools: string[];
```

— non-optional, always present — and tracing where it's populated,
`src/gateway/claude-agent-sdk-client.ts` builds the descriptor literal at the session-build-time
`onHarness` call with `curatedTools` (the resolved `req.opts.allowedTools ?? this._config.
defaultAllowedTools ?? …` result) assigned directly onto it. **The post-hoc, this-run half of
Observability I was asking for already exists and already covers `defaultAllowedTools`**: whichever
value won at dispatch — per-call, the (pre-v34) `agentType.tools` rung, or the deployment default —
lands in `descriptor.tools`, persisted the same way `systemPrompt` was, reachable through the same
`workflow_agent_log` / harness-detail panel REQ-073 already built. There is no gap here, before or
after v34.

This sharpens rather than weakens adversarial's R5: the *readable* prong of INV-NOADD for
`defaultAllowedTools` is fully satisfied **post-hoc**, for the run's own owner, today. What remains
genuinely absent — and what R5 correctly declines to fix in v34 — is only the **pre-hoc** half:
`workflow_describe` doesn't let a cold caller learn the deployment's tool floor *before* their first
call the way REQ-202 makes it learn the `appendPrompt` ceiling before its first call. I agree with
adversarial's Karpathy tie-break that closing that pre-hoc gap is out of scope for v34 (no incident,
and it would hand every caller the exact floor value, which is a bigger disclosure than anyone has
asked for) — so on the substance, R5's "named, bounded residual, not a miss" stands as written, and
I no longer have anything to add to it. I'm leaving the retraction visible rather than quietly
deleting the wrong draft, since catching my own unverified claim before it entered the debate is
exactly the discipline this ledger's CLAUDE.md exists to enforce elsewhere (verify against the
working tree, not against a search that only looks like it checked).

### 3. D2 — `defaults.tools` survives and contradicts REQ-203's "只剩兩層" (HIGH) — **concede fully**

Verified independently:

```
agent-executor.ts:578-579   // per-call allowedTools > agentType tools > defaults.tools.
                             effectiveOpts = { ...effectiveOpts, allowedTools: eff.tools };
```

and the requirements text itself, `01-requirements.md:2705-2707`:

> **Given** 工具解析 **Then** 只剩兩層:per-call `allowedTools` → 部署 `defaultAllowedTools`

with REQ-204 (`:2720-2730`) naming only `runParams.prompt`/`authorPrompt` for removal, silent on
`defaults.tools`. Adversarial is right that this is not a hypothetical: `HarnessDefaults` declares
`prompt` and `tools` side by side (`harness-defaults.ts:17,20`, same `KNOWN_KEYS` set at `:39`), so
retiring one and not the other splits one retired object down the middle. Under my own charter this
is a **Consumability defect of the worst kind for this dimension**: it is exactly the "docs/schema
drift nobody notices until a cold client hits it" risk I flagged generically in r1 about the
`UT-160` AUTHORING.md lock, except adversarial found a *specific, load-bearing instance of it* —
the guide's own new "only two layers" sentence would be false for any run whose params snapshot
still carries a legacy `HarnessDefaults.tools`. I add one requirement to adversarial's two options
(retire `RunParams.tools` with `.prompt` in the same commit, or amend REQ-203's text to say three
layers for legacy rows): **whichever is chosen, `workflow_describe`'s advertised claim and the
guide's prose must be the single source and must be tested for the legacy-row case specifically**,
not just the new-registration case — `tests/integration/resume-legacy-params.test.ts` (already cited
by adversarial) is the right anchor; I'd add a `workflow_describe`-side assertion alongside it so
the *advertised* text is checked against a legacy row's actual resolved layer count, not only the
dispatch behavior.

### 4. B4 — legacy-row read path must stay TOTAL — **concede the "must not crash" half; the "must still render the old field" half is my own amendment proposal, not agreement, and it conflicts with REQ-203's own text**

Agree without qualification on the narrower claim: the record-rebuild + dashboard must not crash on
a pre-v34 row carrying `systemPrompt` or `provenance:'agentType'`. That part is uncontested.

I then want more — "renders something a human can place in time," specifically that a legacy row
with a non-empty stored `systemPrompt` keep showing its byte count/agentType label — and I need to
be honest that this is **not** just a bar-raise on B4, it is in direct tension with REQ-203's own
acceptance text (`01-requirements.md:2710`): "harness descriptor 不再有 `systemPrompt` 欄位,
**dashboard 不再有對應的揭露面**" — no legacy exception stated. Adversarial's own deletion list
(`agent.js:76-81,139` / `agent-panel.js:200`, the `systemPromptNote()` viewer) removes exactly the
rendering code my ask would need to keep, *because the requirement says to*. If I ask for the
viewer to survive for legacy rows, I am proposing an amendment to REQ-203's dashboard clause, not
interpreting it — and I say so explicitly rather than let it read as a quiet agreement with B4 while
actually disputing the requirement text underneath it. My reasoning for wanting the amendment: a
bare disappearance of the line on old rows reads as "this old run apparently had no system prompt,"
a **false** historical statement, versus a neutral absence — and REQ-203 itself asks the *ledger* to
preserve exactly this distinction ("隨機制消失" vs. "回歸", §4.3/C1); I want the **dashboard**, not
only the ledger, to preserve it for a human looking at one old run. But this is a requirements-level
disagreement I'm surfacing for the design stage / requirements owner to adjudicate, not something an
architecture round gets to overrule by fiat — see "Remaining disagreements" item 1 below for the two
concrete options.

### 5. B2/B3 — retirement messaging via `RETIRED_AGENT_OPT_KEYS` / `RETIRED_CONFIG_KEYS` maps — **concede the mechanism, synthesize on the code question**

Config-side (`agentDefinitionsDir` warn-and-boot via a `RETIRED_CONFIG_KEYS` map replacing the
`graphAnalyzer` ad-hoc `if`): this fully satisfies my r1 ask ("the log line must name the key and
say retired in v34, see guide") — no remaining disagreement, and it's a strict improvement (deletes
a special case instead of adding one).

Script-side (`agentType` refused via the existing `SCAN_VIOLATION: PARAM_UNKNOWN` code plus a
near-miss hint, verified at `workflow-meta.ts:489-501` and `authoring-guide.ts:512` — the whole
`tools`/`system`/`systemPrompt`/`timeout` family already rides this one code): my r1 asked for a
*distinct typed code* (`AGENTTYPE_RETIRED`) so a cold client could distinguish "removed feature"
from "malformed script" **programmatically**, not by parsing a hint string. Adversarial's proposal
is more consistent with the codebase's existing convention — every other rename/retirement in
`AGENT_OPT_NEAR_MISSES` already shares one code, and minting a new code for exactly one entry breaks
that symmetry for no structural reason. I don't think either position should simply win: **the
consumability requirement I actually care about is "machine-parseable," not "a distinct top-level
code."** Synthesis: keep `SCAN_VIOLATION: PARAM_UNKNOWN` (adversarial's consistency point stands),
but the refusal's `detail` object should carry a structured marker for the retired case specifically
— e.g. `detail: { param: 'agentType', reason, retired: true }` — so a cold client can branch on
`detail.retired` without string-matching the hint. This costs nothing extra over B2/B3's map lookup
(the map already knows which keys are retired vs. merely renamed) and gives me the machine-actionable
signal without adding a code to the closed `AUTHZ_ERROR_CODES`-style set. I consider this converged,
not a live dispute — flagging the exact shape for the design stage to pick up.

### 6. C1 — enumerate retiring ids and predict `sh .sdlc/trace` deltas before Gate 8 — **concede fully, this operationalizes my own Risk item**

My r1 Risks section named the same failure mode in the abstract ("docs/schema drift risk," citing
the F6-1 iter-bump precedent) without a mechanism. C1's proposal — state the expected item/gap
delta for ARCH-004/DES-007/DES-102/REQ-094/ARCH-129/DES-195/REQ-136 *before* running Gate 8, using
a `git archive HEAD | tar -x` baseline per CLAUDE.md (never `git checkout`/`restore`/`stash` on the
ledger, which is the exact incident CLAUDE.md documents) — is the concrete version of what I was
gesturing at. No disagreement; I'd only add that the predicted-delta note should live next to the
architecture doc's retirement list itself (not only in a Gate-8 runbook comment), since that's what
a reviewer six months from now will actually open.

### 7. D1 (keep `composePrompt` as a named seam) / D3 (golden-string byte-identity test) — **hold, no objection, outside my lens's center of mass**

Both are testability/simplicity calls I have no dimension-specific stake in disputing. D1's
reasoning (the seam is where `FRAME_CLOSE_FORGERY`'s constants live and is unit-testable without a
gateway) is sound and I'd only note it also serves Observability indirectly: a named seam is what
makes the *composition* step traceable in a stack trace / test failure, versus an inlined three-liner
that fails only inside a full gateway invocation.

### 8. §6.1 tombstone strawman — **clarify, not actually a disagreement**

Adversarial pre-rebuts "keep `systemPrompt: null` on every future row for audit continuity." That
was never my r1 position — I asked for the two **surviving** segments (`harness.prompt`,
`harness.appendPrompt`) to stay visible going forward, not for a permanently-null ghost field marking
the deleted one. On the actual overlap (legacy rows must render truthfully, not crash or lie), we
already agree per §4 above. No open disagreement here; I'm noting it so round 3 doesn't spend time
on a fight neither side is having.

---

## New contribution: dispatch-time silent degradation for old pinned catalog versions

Neither r1 document fully closes this, and it's a genuine gap under **Self-sustainability +
Observability together**, not just the abstract "0/22 is a one-time hand-check" concern I raised in
r1. I traced where `AGENT_OPT_KEYS` is actually consulted:

```
grep -n "AGENT_OPT_KEYS\b" src/*.ts
  workflow-meta.ts:205   (definition)
  workflow-meta.ts:489   if (!Object.hasOwn(AGENT_OPT_KEYS, key)) { … }   ← the ONLY call site
```

That call site is inside the **static script scan** run at `workflow_register` time
(`workflow-meta.ts`'s scan function, the same one producing `SCAN_VIOLATION`). It is **not**
consulted at dispatch. That means: a workflow version registered *before* v34, whose stored script
text calls `agent(label, prompt, { agentType: 'reviewer', ... })`, was accepted once, at
registration, under the pre-v34 `AGENT_OPT_KEYS` that included `agentType`. After v34 ships, if that
exact pinned version is later `run_start`'ed by version or channel (REQ-096 keeps version history;
this is a supported, expected path, not an edge case someone invented), the sandbox executes the
*stored* script text verbatim. It calls `agent()` with an options object that — at runtime, in
plain JS — still has an `agentType` property. Nothing re-validates that object against the (now
`agentType`-less) `AGENT_OPT_KEYS` at dispatch time; TypeScript's compile-time narrowing of
`AgentOpts` protects only newly-authored/newly-registered code, not a previously-accepted stored
script executing against the new binary. I checked both crossings this property passes through
rather than assume: the sandbox boundary types the whole parameter opaquely
(`src/sandbox/guards.ts:71`, `agent(prompt: string, opts?: unknown)` — no field-level allowlist), and
the far side of the IPC hop only casts it (`run-manager.ts:1330`,
`(opts ?? {}) as AgentOpts & { prompt?: unknown }` — a type assertion, not a runtime filter). Neither
crossing strips unknown keys. With `agentTypes`/`AgentTypeDef` resolution deleted (adversarial's own
deletion list, `agent-executor.ts:464-465,496,507,543-552`), the `agentType` property survives both
crossings and is simply an inert extra field on the options object by the time it would have been
read — **no error, no warning, just a different result**: the run silently gets plain per-call
params instead of whatever `systemPrompt`/`model`/`tools` override the operator's `agents/*.md`
frontmatter used to apply.

This is precisely the silent-degradation shape both experts' dimensions independently warn against
— my Observability ("a silent/opaque failure is a design defect") and adversarial's own INV-NOADD
("must be readable," restated for *change over time* rather than a single point in time). It is
evidence-bounded today (0/22 current catalog versions use `agentType`, per the iteration's own
audit), which is exactly why r1 called it "an assertion, not a monitored invariant" — this trace
confirms there is no code path that would catch a stale pinned version reintroducing the pattern,
now or after future re-registrations under a different key name.

**Decision needed at design stage (I don't resolve it here, per my own r1 caution against
overreaching from requirements text alone):**
- (a) dispatch-time fail-closed: if the marshaled call options carry an `agentType` key at all
  (structural check, not type-level — `Object.hasOwn(opts, 'agentType')`), refuse the call with a
  typed error rather than silently dropping the field, or
- (b) a startup/periodic scan of the *stored* catalog (not just new registrations) for scripts whose
  text still references `agentType`, surfaced the same way the config-key retirement is surfaced.

(a) is cheaper and catches the failure at the exact moment it would occur; (b) is closer to what
REQ-203's `agentDefinitionsDir` warn-and-boot path already does for the config case and gives an
operator advance notice before anyone hits `run_start`. Either is acceptable under INV-NOADD and
under my own Self-sustainability dimension; **silence is not**, because it ships REQ-203 with an
implicit claim ("agentType is gone") that is false for exactly the population of rows this
dimension exists to protect: the ones nobody is looking at because they aren't new.

---

## Updated final position, per dimension

### Observability

Converged with adversarial: two-segment prompt disclosure survives going forward (no dispute);
the retired-key refusal needs a machine-parseable marker, achieved via `detail.retired` without a
new top-level code (§5, synthesis); the executed tool set is already fully recorded post-hoc via
`HarnessDescriptor.tools` (§2 — my initial claim that it wasn't was wrong and I retracted it after
reading the actual interface, not just grepping it), so `defaultAllowedTools` needs no new v34
observability work. The one place I raise the bar past round 1: legacy rows must render
*truthfully*, not just avoid crashing (§4) — see the explicit REQ-203 tension called out below,
which I'm not allowed to paper over as a quiet agreement.

### Replaceability

Converged: INV-NOADD's restrictive/readable split is the right test, and I now use it explicitly
rather than the looser "no single point of undeclared coupling" language from r1.
`defaultAllowedTools` is the one accepted residual violator, correctly not touched in v34, and its
readable prong is already satisfied post-hoc (see Observability above).

### Consumability

Sharpened by conceding D2 in full: REQ-203's "only two layers" claim is currently false for legacy
rows carrying `defaults.tools`, and this must be settled this round (design-stage decision, not
deferred) — a guide that contradicts the code it describes is the exact failure class REQ-202/203
exist to eliminate. Everything else from r1 stands: the projection-boundary fix (`unit`/`boundBy`
on `DescribeAgentParamKey`) is unopposed and cheap (adversarial's own A1 proposal, which I did not
have specifics for in r1 and now adopt as the concrete shape).

### Self-sustainability

Strengthened, not just re-asserted: r1's "0/22 is an assertion, not a monitored invariant" now has
a traced mechanism showing exactly how it would fail silently (dispatch never re-validates a stored
script's options against the current `AGENT_OPT_KEYS` — the only call site is the registration-time
static scan, `workflow-meta.ts:489`; `run-manager.ts:1330`'s `(opts ?? {}) as AgentOpts &
{prompt?: unknown}` is a type-cast, not a runtime whitelist, so an old script's `agentType` property
is neither validated nor stripped at dispatch — it is carried inert, and nothing downstream reads
or reports it once the resolution code is deleted). This is the strongest unresolved item I'm
carrying into round 3/design — stronger than my r1 framing because it's no longer
hypothetical-shaped, it's grep-verified.

## Remaining disagreements / open decisions for design stage (not resolved here on purpose)

1. **§4, and this is a real amendment to REQ-203's text, not a quiet gloss on B4:** REQ-203's own
   acceptance says "dashboard 不再有對應的揭露面" (the dashboard disclosure surface goes away with
   the mechanism) — full stop, no legacy carve-out. My §4 ask (a pre-v34 row should still render a
   truthful history, e.g. a byte count / agentType label, not silently show nothing) is in tension
   with that sentence as written, not a mere elaboration of adversarial's B4 (which only requires
   "doesn't crash," and is silent on what a legacy row *shows*). I am not going to pretend this is
   settled: either (a) REQ-203's dashboard clause is amended to read "no disclosure surface for new
   rows; a legacy row keeps a minimal, generic marker (e.g. a 'fields retired at v34' note, not the
   full retired viewer)," which stays inside the spirit of "隨機制消失" while not lying to a viewer
   of an old run, or (b) REQ-203's text is left as-is and I concede the dashboard shows nothing for
   legacy rows too, accepting that a viewer of a six-month-old run sees an unexplained gap rather
   than a mislabeled absence. I lean (a) but I'm flagging this as an open amendment proposal for the
   design stage / requirements owner, not something I can resolve unilaterally in an architecture
   round.
2. D2's remedy choice — retire `RunParams.tools` alongside `.prompt` in this same iteration, vs.
   amend REQ-203's text to say three layers for legacy rows. Both experts agree it must be decided
   *in this round*; neither has picked one, and I don't think requirements text alone settles it —
   it's a design-stage call between "smaller diff, textually accurate" and "fully closes the
   retirement now."
3. The old-pinned-version dispatch gap (new, this round): fail-closed at dispatch vs. catalog scan
   at startup/registration-adjacent time. Both acceptable under INV-NOADD; needs an explicit pick,
   not a default.

Everything else raised across both round-1 documents — INV-NOADD itself, the `RETIRED_CONFIG_KEYS`/
`RETIRED_AGENT_OPT_KEYS` mechanism, the predicted-trace-delta discipline (C1), the legacy-row
TOTAL-read-path requirement (B4), keeping `composePrompt` as a seam (D1), and the golden-string test
(D3) — I consider converged.
