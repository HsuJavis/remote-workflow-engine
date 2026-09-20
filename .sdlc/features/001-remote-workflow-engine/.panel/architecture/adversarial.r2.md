# Architecture panel — Adversarial (security / scalability / testability), round 2

**Iteration:** v34 — REQ-202 / REQ-203 / REQ-204
**Read before writing:** `quality-dimensions.r1.md` (the only sibling proposal in `.panel/architecture/`)
and my own `adversarial.r1.md`. Every new claim below is re-verified at `file:line` in the working
tree at `a98b469`; I do not repeat r1's evidence except where a sibling disputed it.

**Net movement this round:** I *concede* three items to the quality-dimensions (QD) lens, *rebut*
three (two as already-implemented, one as stale), and *hold* two. One of QD's items exposed a real
gap my r1 missed and that QD itself resolved in the wrong direction — §1.6 is the most load-bearing
paragraph in this file. One HIGH (`defaults.tools`, my D2) is still unresolved and is now the only
item the panel cannot settle without the requirement owner.

---

## 0. Disposition table

| # | QD r1 item | my call | one-line reason |
|---|---|---|---|
| 1.1 | Replace the deleted `systemPrompt` disclosure with a two-segment `prompt` + `appendPrompt` view | **rebut (with a conceded obligation)** | deleting `stripFirstSegment` *makes* `harness.prompt` the honest verbatim echo; a second field duplicates caller bytes into persistence |
| 1.2 | Typed `AGENTTYPE_RETIRED` code, not prose | **concede (half) / rebut (half)** | closed-union arm on the existing scan path, yes; new top-level `ErrorCode`, no |
| 1.3 | Config warning must name the key + "retired at v34" | **concede — converged** | identical to my B2 config half |
| 1.4 | `PARAM_OUT_OF_RANGE` must carry the computed effective max as a field | **rebut (already true) → narrowed** | `detail.maxBytes` already is the min()-ed bound; the real gap is a dropped `ceiling` attribution |
| 1.5 | Five-rung → four-rung precedence is a behavior change needing a compatibility decision | **rebut (stale)** | the `agentType`/`call` *param* rungs were already retired at v24; v34 removes the tool rung + prompt segment |
| 1.6 | "0 of 22 catalog versions" is a hand-check, not a monitored invariant; pick (a) catalog scan or (b) dispatch fail-closed | **concede the gap / rebut both remedies / propose a third** | (b) is **false** after the deletion — I verified it; (a) is standing machinery for a set proven empty |
| 1.7 | Name the per-agent-type granularity loss as an accepted tradeoff | **concede — converged** | folds into my R5 residual; QD guessed my stance wrong, there was never a disagreement |
| 1.8 | UT-160 `buildAuthoringGuide()` ↔ `docs/AUTHORING.md` byte-lock is a hard design/task constraint | **concede — promote to a hard constraint** | three edit sites, one task; QD is right that this is infrastructure, not test trivia |
| 1.9 | `main.ts:59-63` stale comment | **converged** | already row 11 of my r1 deletion table |
| — | my D2 (`defaults.tools` leaves REQ-203's "two layers" false) | **hold — still open** | QD did not address it; with two panelists that is not a resolution |

---

## 1. Responses to `quality-dimensions.r1.md`

### 1.1 "REQ-203 is a net observability loss unless something replaces it" — **rebut**, with one conceded obligation

QD asks for a replacement view: two visible segments, `harness.prompt` + `harness.appendPrompt`,
the latter with its `<user-instructions untrusted="true">…</user-instructions>` framing shown
verbatim. I argue no new view is needed, because **v34 restores the honest echo by deletion**:

- Today `descriptor.prompt` is *not* what the model saw. `agent-executor.ts:652-659` runs
  `stripFirstSegment(descriptor.prompt, sys)` and persists the **stripped** string, precisely so
  the `agentType` systemPrompt never reaches the transcript (DES-195/ARCH-129's whole purpose).
  The `systemPrompt:{agentType,bytes}` field (`:671`) exists to tell a reader *that bytes were
  removed and how many*. It is a receipt for a redaction.
- With `agentType` gone there is nothing to strip, the strip call and its
  `harness_prompt_prefix_mismatch` warn go with it, and `descriptor.prompt` becomes the gateway's
  verbatim echo of `req.prompt` — body **plus** the framed appendPrompt, frame delimiters inline.
  QD's requirement ("a human can reconstruct exactly what the model saw", "framing shown verbatim,
  not just raw text") is then satisfied by **one existing field**, better than it is today.

So the receipt disappears because the redaction disappears. That is the literal content of
REQ-203's 「隨機制消失」 and it is the strongest form of the claim available: not "we removed a
panel", but "the panel described a transformation that no longer happens."

**Rebut the second field specifically, on my own lens's grounds.** A separate persisted
`harness.appendPrompt` would put a *second copy of caller-supplied text* into the durable harness
row. That row is the one place where `redact()` runs at persist-write and `capPrompt` is applied
**after** redaction (`agent-executor.ts:~690`, the v21 Gate 8 re-review note: cap used to run
upstream and could cut a secret at a 2048-char seam, defeating value-exact redaction). Adding a
duplicate text field means a second site that must get redact-then-cap ordering right, forever, for
zero information gain over `prompt`. Karpathy and security agree here for once.

**Conceded obligation (this is QD's real point and I accept it):** "the disclosure disappears" must
be *pinned*, not asserted. The deletion of `stripFirstSegment` silently changes what
`descriptor.prompt` contains, and nothing currently asserts the post-v34 value. Required test
(Gate 5, one integration test): dispatch with a script prompt + an `appendPrompt` override, and
assert the **persisted** `descriptor.prompt` equals `composePrompt`'s output byte-for-byte,
including both frame delimiters. **Fixture must stay under `capPrompt`'s 2048-char cap** (next
paragraph) — a long composed prompt would fail the byte-for-byte assertion for the wrong reason,
and an implementer who hits that will "fix" it by weakening the assertion. That test is the replacement for the deleted warn line, costs ~20
lines, and turns QD's worry into an executable claim. It also composes with my D3 goldens (same
matrix, one before-the-cut capture).

**Named, pre-existing bound (so nobody reads it as a v34 regression):** `capPrompt`'s 2048-char cap
means a long composed prompt is truncated in the persisted descriptor. That is v21 behavior, not
v34's, and it bounds reconstructability today exactly as it will after the cut. Worth one sentence
in the architecture doc's observability section so a Gate 8 reader does not attribute it to this
iteration.

### 1.2 Typed `AGENTTYPE_RETIRED` rejection code — **concede the "typed" half, rebut the "new top-level code" half**

QD is right and my r1's B2 was weaker: a cold client distinguishing "removed feature" from
"malformed script" needs a **code**, and my "retired-names map feeding a hint string" left it in
prose. I concede that. But the cheap, convention-following form is one union arm, not a new
`ErrorCode`:

- `AgentCallViolationCode` (`workflow-meta.ts:150-159`) is a **closed union** —
  `AGENT_LABEL_REQUIRED | AGENT_LABEL_NOT_LITERAL | AGENT_LABEL_FORMAT | AGENT_OPTS_NOT_LITERAL |
  PARAM_IN_SCRIPT | PARAM_UNKNOWN`. Adding `AGENT_OPT_RETIRED` is one arm plus one branch beside
  the existing `PARAM_UNKNOWN` emission (`workflow-meta.ts:490-503`), consulted from the same
  retired-names map my B2 proposed. The map survives; it now produces a code *and* a hint.
- A new **top-level** `ErrorCode` costs an `ERROR_CATALOG` row (`errors.ts:50-80`), an entry in
  `workflow_register`'s advertised `errors[]` and its fixture (`tool-specs.ts:255`, `:281`), guide
  text, and a branch every client is invited to implement — for a condition that, by the iteration's
  own evidence, has **zero** live producers. `errors.ts:66-74` records this project deleting
  `UNDECIDABLE_SHAPE` for exactly that reason ("advertising a code the checker can never emit is a
  branch a client may implement and never exercise"). I will not re-add the pattern the ledger
  already removed.
- **One structured-field gap I am adding to QD's ask** (verified, and it is what actually makes the
  code machine-readable): `workflow-catalog.ts:490` throws
  `codedError('SCAN_VIOLATION', \`${v.code}: ${v.hint} (line ${v.line})\`, { line: v.line, key: v.key })`
  — the inner code reaches the client **only inside the message string**. A client "programmatically
  distinguishing removed-feature from malformed-script" must string-match today. Add
  `violation: v.code` to that detail object (one field, one call site, benefits all six existing
  arms). QD's bar is met properly by this, not by minting a top-level code.

Net: `SCAN_VIOLATION` + `detail.violation = 'AGENT_OPT_RETIRED'` + `detail.key = 'agentType'` +
hint pointing at `workflow_authoring_guide`'s new prompt-layering section. Same shape my B3
re-pointing needs, so both land in one edit.

### 1.3 Config-side warning must name the key and say "retired at v34" — **concede, converged**

Identical to my B2 config half. Joint position: `composeConfig`'s single hardcoded
`graphAnalyzerNote` `if` (`main.ts:150-152`) becomes a `RETIRED_CONFIG_KEYS: Record<string,string>`
carrying `graphAnalyzer` **and** `agentDefinitionsDir`; the warn line names the key and the
retirement. This *deletes* a special case while satisfying a new requirement — the only item this
round where the code gets smaller and more capable at once. Owner's warn-don't-fail-fast ruling
stands (my r1 §6.2); QD did not contest it.

### 1.4 "`PARAM_OUT_OF_RANGE` should carry the computed effective max as a field" — **rebut: already true**; narrowed to the real asymmetry

Verified: `validateOneAgentOverride`'s docstring (`contract.ts:495-497`) states `spec` is already
the **effective** (author ∩ ceiling) bound via `effectiveAgentBounds`, and the appendPrompt branch
emits `detail: { param, agent, suppliedBytes, maxBytes: spec.max }` (`contract.ts:553-559`). A
client can already parse the effective max without re-deriving `min()`. QD's ask is satisfied by
code that predates this iteration; asserting otherwise in the architecture doc would mint a
requirement for work already done.

**The residual gap QD's instinct was pointing at, stated precisely:** the generic
`checkValueAgainstSpec` path carries the *attribution* — `detail.ceiling = spec.ceilingKey`, set
only when the engine ceiling is the bound that actually won (`contract.ts:478-484`, with `boundMax`
at `:178-184` refusing to blame a ceiling the caller could not have hit). The **appendPrompt-specific
branch drops it** (`contract.ts:553-559`). So on the one param REQ-202 is about, the caller learns
*what* the bound is but not *whose* it is.

**Consequence for my r1 A1 — I withdraw a name.** I proposed `boundBy?: 'engine'` on
`DescribeAgentParamKey`. The wire already spells this concept `ceiling` and already carries the
ceiling's *key name*. One vocabulary in both places is worth more than my field name:

- `workflow_describe` projection: `unit?: 'bytes'` and `ceiling?: 'maxAppendPromptBytes'`
  (set iff `eff.appendPrompt.ceilingKey` is present — the fact `projectAgentParams`
  currently computes and discards, `workflow-view.ts:145-165`).
- error detail on the appendPrompt branch: add the same `ceiling` field the generic branch emits.

A caller then sees the identical word before the call (describe) and after a rejection (error).
That is QD's pre-hoc/post-hoc symmetry argument, honored with one word instead of two.

### 1.5 "Five rungs → four is a behavior change needing a compatibility decision" — **rebut: stale**

QD cites `04-design.md:735`'s five-rung precedence with "agentType definition frontmatter" between
per-call opts and per-run overrides. That ladder is already gone: `agent-executor.ts:553-558` says
in-tree that *"the 'call' and 'agentType' rungs are RETIRED"* as of v24 (ARCH-095/DES-146,
TASK-145), `contract.ts:51` records the same, and the live `provenance` union is
`'override'|'default'|'engine'` (`resolve.ts:51`). There is no param-precedence rung left for v34
to remove and therefore no precedence compatibility decision to make.

What v34 *does* remove is different and narrower: (i) the **tool** rung
(`agent-executor.ts:571-575`), (ii) **segment 1 of the prompt composition** (`:582-585`), and (iii)
the executor's registry lookup + `Unknown agentType` throw (`:548-550`). **QD's line cite is also off, which matters for C1:** `04-design.md:735` in the working tree at
`a98b469` is a Gate 6 route-back note about SQLite catalog persistence. The five-rung text QD means
is at **`04-design.md:2610`** ("per-call `agent()` opts › agentType frontmatter › per-run
`overrides` › registered `defaults` › engine default"), with the stale `Rung =
'call'|'agentType'|'override'|'default'|'engine'` union at **`:2593`** — both **doc-lag from v24**,
neither matching the live 3-arm union. They belong on C1's retirement-id list (where a stale line is
a bookkeeping item), located by grep rather than by the cited line number, and **not** in the risk
register, where QD escalates it to "Precedence-rewrite risk" — an implementer who believes that will
go looking for a compatibility shim with no referent.

### 1.6 "0 of 22 is a hand-check" — **concede the gap (my r1 missed it); rebut both of QD's remedies; propose a third**

This is QD's best finding and it lands on a genuine inconsistency in my own r1: I praised
`DEFAULTS_RETIRED` for refusing rather than silently accepting a retired key (§4.4), while my
deletion plan makes a legacy `agentType:` **silently inert**. QD asked the right question and then
offered two options, of which it preferred (b) — "if dispatch already fails closed on an
unresolvable `agentType`, (a) is unneeded."

**(b) is false after the deletion, and I verified why.** Today it looks true: with no
`agentDefinitionsDir` the registry is `{}` (`agent-executor.ts:507`) and any `agentType` throws
`Unknown agentType` at `:550` — fail-closed. **That throw is one of the lines v34 deletes.** At
runtime nothing else checks option keys: `_handleAgentRequest` takes `opts: unknown` and spreads it
(`run-manager.ts:1316-1333`, `const rawOpts = (opts ?? {}) as AgentOpts & { prompt?: unknown }`) —
`AGENT_OPT_KEYS`'s closed set is a **registration-scan** control (`workflow-meta.ts:490-503`), and
`scanAgentCalls` runs at register (`workflow-catalog.ts:487`), never at `run_start` on a pinned
stored version. So post-v34 a pre-v34 pinned version carrying `agentType` runs **without** its
prompt, model or tools and reports success. Today that same run fails loudly. **v34 as specified
converts a fail-closed into a silent behavior change** — the exact defect class `DEFAULTS_RETIRED`
exists to prevent, arriving through the back door of a deletion.

**Rebut (a) too — a standing startup/periodic catalog scanner.** New permanent machinery, with its
own boot cost and its own failure modes, guarding a set the evidence says is empty. That is the
speculative-architecture move the tie-breaker forbids.

**Third option, which is what I propose the panel converge on — make the hand-check mechanical, once:**

> **Sweep-as-evidence, in two arms — and the arms are not interchangeable.**
> *(i) Pre-cut (Gate 5, the decision evidence):* iterate every stored catalog version's `script`
> column and match `/\bagentType\s*:/` textually. It must be a **text** sweep, because
> `scanAgentCalls` **cannot see `agentType` today**: the key is in `AGENT_OPT_KEYS`
> (`workflow-meta.ts:207`) so the `PARAM_UNKNOWN` branch never fires for it, and
> `AgentCallScan.calls` records only `allowedTools` among option keys (`workflow-meta.ts:170-186`).
> A pre-cut `scanAgentCalls` run would return zero **trivially** — the hand-check problem wearing a
> script, which is worse than the hand-check because it looks like evidence.
> *(ii) Post-cut (Gate 7.5, the regression pin):* re-run `scanAgentCalls` over the same set
> asserting zero `AGENT_OPT_RETIRED` violations — that arm works only **after** §1.2's union arm
> exists, and it is what keeps the set closed afterwards.
>
> Record the version count and both zeros in the validation ledger. This replaces "22 versions,
> 0 uses, checked by hand at decision time" with two reproducible commands and an artifact — QD's
> "assertion, not a monitored invariant" objection, answered without standing code. Registration
> refusal (§1.2) closes the **future**; arm (i) closes the **past**; arm (ii) keeps it closed.

**Stated honestly, because the argument is conditional:** the sweep's value is that it can fail. If
it returns **>0**, the set is not empty, silent-inert becomes reachable, and a dispatch-time
refusal (a `RETIRED_AGENT_OPT_KEYS` check in `_handleAgentRequest`, ~4 lines, throwing rather than
ignoring) becomes **required** — not optional. I am betting on the evidence, not assuming it. Which
also means this must run **before** the implementation gate closes, not as an afterthought at Gate 8.

### 1.7 "Name the per-agent-type granularity loss as an accepted tradeoff" — **concede, converged (QD guessed my stance wrong)**

QD's "expected disagreements" predicted a security lens would defend `agentType` as operator
defense-in-depth and oppose removal. It does not: my r1 §2 derives the *opposite* conclusion from
security grounds — under **INV-NOADD** (a deployment-side input may only *restrict*, and must be
*readable*, never *add* content or *expand/redirect* capability invisibly) `agentType` fails on all
three of its layers, which is why the owner's remove-all-three ruling is correct rather than merely
tidy. No disagreement to resolve.

I adopt QD's drafting ask verbatim: the architecture doc states explicitly that **per-agent-type
tool granularity within one deployment is lost, deliberately, and deployment-wide
`defaultAllowedTools` is the surviving operator-owned restriction layer.** This dovetails with my
R5: `defaultAllowedTools` is *also* the last remaining INV-NOADD violator (it is **additive** —
`claude-agent-sdk-client.ts:546` — and unreadable by the caller), recorded as a **named, bounded
residual**, explicitly **not** removed or projected in v34. One sentence covers both QD's tradeoff
and my residual; they are the same sentence seen from two lenses.

### 1.8 UT-160 drift lock — **concede, and promote from test detail to hard constraint**

QD is right that the `buildAuthoringGuide()` ↔ `docs/AUTHORING.md` byte-equality lock is
consumability infrastructure, and right that v33's F6-1 is the measured precedent for it biting.
Adding the third site my own proposals touch: **`tool-specs.ts:614`** currently advertises
*"An agentType's system prompt is never in harness.prompt; harness.systemPrompt:{agentType,bytes}…"*
— a `tools/list` string that becomes false the moment §1.1 lands. So the constraint is:

> `authoring-guide.ts:531-532` (three tool layers → two), `tool-specs.ts:614` (harness disclosure)
> and `docs/AUTHORING.md` are **one task, one commit**, with UT-160 green in that commit. My A2's
> `run_start.overrides` text (`tool-specs.ts:439-446`) rides the same edit.

Splitting these across tasks is how the byte-lock re-trips.

### 1.9 Stale comments — **concede, and QD's version is broader than mine**

`main.ts:59-63` was row 11 of my r1 deletion table, but QD asked for something larger — *"grep for
`agentType` in comments, not just in logic"* — and the grep run this round shows my table was a
**floor, not a ceiling**: live docstrings outside it include `types.ts:204` (the tool-precedence
comment, false after the cut), `agent-executor.ts:101` and `:464` (the `agentTypes` dep docs),
`contract.ts:17` and `:20` (the `allowedTools`-moved rationale, which narrates the agentType rung).
Design item, stated so it is checkable: **`grep -rn agentType src/ docs/` returns only intentional
historical references after the cut, and the grep output is the checklist** — not a
hand-enumerated table (mine included).

---

## 2. My r1 positions after this round

**Unchanged and unchallenged** (QD raised none of these; I restate them as the panel's standing
obligations, not to relitigate): B1 compile-closed key sets (`AGENT_OPT_KEYS`,
`KNOWN_FILE_CONFIG_KEYS`) as the primary absence-pin, with `compose-config-v2-wiring.test.ts`'s
exclusion list updated in the same commit (R6); **B4 read-path totality over pre-v34 persisted rows**
(`HarnessDescriptor.systemPrompt` at `types.ts:551` is persisted; `types.ts:530`'s wider
`provenance` union can hold `'agentType'` in stored rows) with one integration test feeding a
genuine legacy row through record-rebuild + dashboard projection; D1 keeping `composePrompt` as a
named seam at two arguments (the framing constants `FRAME_CLOSE_FORGERY` defends live behind it);
D3 golden-string capture **before** the cut; C1 enumerate retiring ids and **predict** the
`sh .sdlc/trace` deltas before Gate 8 (baseline via `git archive HEAD | tar -x` into a scratch dir
— never `checkout`/`restore`/`stash`, per CLAUDE.md).

**Amended this round:** A1's `boundBy` → `ceiling` (§1.4); B2 now emits a code, not only a hint
(§1.2); B3's near-miss re-pointing (`system`/`systemPrompt` → the guide's prompt-layering section,
`workflow-meta.ts:221-222`) merges into the same edit as §1.2's new violation arm.

**Added this round:** the composed-prompt persistence test (§1.1), `detail.violation` on
`SCAN_VIOLATION` (§1.2), the `ceiling` field on the appendPrompt error branch (§1.4), the two-arm
catalog sweep as Gate-5/7.5 evidence with its stated failure branch (§1.6), and the grep-is-the-
checklist rule for stale comments (§1.9).

---

## 3. Final position (v34 architecture, adversarial lens)

1. **Delete, do not deprecate.** The r1 deletion table stands unamended; absence is pinned by the
   two compile-closed key sets, not by inventory tests.
2. **INV-NOADD is the named invariant**, with `defaultAllowedTools` recorded as the single known,
   bounded residual and the per-agent-type granularity loss named as an accepted tradeoff (§1.7).
3. **Observability is restored by the deletion, and pinned by one test** (§1.1). No tombstone field,
   no second persisted text field; `capPrompt`'s pre-existing 2048-char bound named so Gate 8 does
   not misattribute it.
4. **Two retirement messages, both coded, both on existing paths** (§1.2, §1.3): script side
   `SCAN_VIOLATION` + `detail.violation='AGENT_OPT_RETIRED'` + `detail.key='agentType'`; config side
   `RETIRED_CONFIG_KEYS` replacing the `graphAnalyzer` special case, warn-not-fail-fast.
5. **REQ-202 = stop discarding computed facts**, in one vocabulary: `unit:'bytes'` and `ceiling` on
   the describe projection; the same `ceiling` word on the appendPrompt rejection; the *rules*
   (`PARAM_UNKNOWN` admission, untrusted framing, no frame-close forgery) on `tools/list` where a
   cold client reads first; the frame advertised as an **advisory label plus one enforced property**,
   never as an enforcement boundary (A3, R8).
6. **Legacy rows stay readable (B4); the legacy catalog is proven empty by the two-arm sweep —
   text pre-cut, `AGENT_OPT_RETIRED` post-cut (§1.6) — with dispatch-time refusal as the stated,
   mandatory fallback if arm (i) returns anything but zero.**
7. **Ledger retirement is a predicted diff, not prose** (C1), and the three advertised-text sites
   plus `docs/AUTHORING.md` move in one commit under the UT-160 lock (§1.8).

---

## 4. Remaining disagreements

1. **`defaults.tools` (my D2) — HIGH, unresolved, needs the requirement owner.** `RunParams.tools`
   (`resolve.ts:50`, populated `:87` from `defaults?.tools`) is still consumed as a tool rung
   (`agent-executor.ts:576-580`). With `agentType` gone, any run whose params snapshot carries a
   legacy `HarnessDefaults` has **three** tool layers, while REQ-203's advertised text says two.
   `prompt` and `tools` are the same author-only pair on the same retired object
   (`harness-defaults.ts:17`/`:20`, one `KNOWN_KEYS` set at `:39`); REQ-204 retires one and keeps
   the other. QD's replaceability section asserts the two-layer model without reaching this code, so
   the panel has not resolved it — it has one silent panelist and one objection. Two acceptable
   exits, either fine, **neither being silence**: extend REQ-204 to retire `RunParams.tools` with
   `.prompt` (same commit, same test, pinned at
   `tests/integration/resume-legacy-params.test.ts`), or amend REQ-203's wording to say three layers
   for legacy rows. Shipping a guide sentence the code contradicts is the defect class v34 exists to
   remove.
2. **Sweep result is a genuine open branch, not a formality** (§1.6). Zero hits → registration
   refusal suffices. Non-zero → dispatch-time refusal becomes required and the design changes. The
   architecture doc must carry both arms; picking the happy arm in advance is how the silent-inert
   path ships.
3. **Minor, recorded not escalated:** QD's implicit push toward richer disclosure (`unit` on every
   numeric param, a projected `defaultAllowedTools`). Tie-break unchanged: `unit:'bytes'` where
   REQ-202 asks and a measured confusion exists; nothing further. If round 3 or Gate 7.5 produces a
   caller confused by `timeoutMs`, it is a two-character change then.

**Where the panel is now agreed:** delete the mechanism whole rather than its prompt layer only;
keep `DEFAULTS_RETIRED` after its pipeline is gone; lean on the compile-closed key sets; coded
retirement messages on both sides; warn-not-fail-fast on the config key; the UT-160 byte-lock as a
hard one-commit constraint; the retirement recorded as a predicted trace diff; and no
deprecation/plugin framework to replace `agentType` — 0 of 22 registered versions used it, and a
remote-writable definition surface would bring its own authz, storage and injection questions with
no user behind them.
