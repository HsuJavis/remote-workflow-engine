# Design panel — Adversarial group (Interface-contract × Boundary/error × Testability), round 2

**Iteration**: v23 (REQ-101..106), Gate 3+4 merged.

**Read this round**: `quality-dimensions.r1.md` (the dispatch's named target) **and**
`quality-dimensions.r2.md` (their operative stance — see the disclosure below); my own
`adversarial.r1.md`; the **superseded** `adversarial.r2.md` at this path before I overwrote it; and the
**shipped** `04-design.md §v23` (DES-120..135) plus `REQ-104`'s literal acceptance text. New primary
source verified today: `src/main.ts:89-94,128,207,227`, `src/gateway/claude-agent-sdk-client.ts:47,
453,495,535,549,573,581`, `src/gateway/client.ts:63,192,212,233,249`, `src/params/contract.ts:76,94`,
`src/server.ts:1264-1282,1316-1330`, `src/types.ts:44-63`, `src/dashboard-page.ts:505`, and a census of
every `console.*` site in `src/`.

## Disclosure — three things the dispatch template did not say, and they change what round 2 *is*

1. **This file replaces a committed round-2 document** written at 16:08 by the pre-adjudication panel
   (recoverable at `git show ba3db17:<this path>`; nothing was `git checkout`-ed — CLAUDE.md observed).
   Its non-obsolete findings are carried forward **by name** in §0 and §3.6 so the overwrite loses
   nothing.
2. **The quality-dimensions panelist did not re-run.** `quality-dimensions.r1.md` and `.r2.md` are both
   unchanged from HEAD; only `adversarial.r1.md` is modified in the working tree. So QD's *latest*
   position (`.r2.md`) responds to a **superseded** adversarial r1 (DES-120..134), not to mine. I
   therefore answer **both** their documents and label which one each response targets. A synthesizer
   who reads only the dispatch's "*.r1.md" instruction would otherwise mis-attach QD's concessions.
3. **Gate 3+4 already passed; `04-design.md` carries DES-120..135**, written from the *pre-adjudication*
   panel. This is decisive for what round 2 should produce: the shipped design **already absorbed most
   of the prior convergence**, so the useful output is not a fresh proposal set but a **crosswalk plus a
   short list of amendments** — chiefly the one adjudication #1 leaves broken. Several of my own r1
   items are, measured against shipped text, either already-shipped or a **regression**, and I say so
   rather than re-proposing them.

**Headline**: I withdraw four of my own r1 positions (one of them a security *regression* against shipped
text), concede both of QD's open items closed, and end with **seven amendments** to the shipped design —
one of which (`phases` missing from `WorkflowDescribeView`) is the defect that adjudication #1 created and
that this re-dispatch exists to catch.

---

## 0. Crosswalk — shipped DES → my r1 item → verdict

The spine of this round. "Shipped" = present and correct in `04-design.md §v23` today.

| Shipped | My r1 | Verdict |
|---|---|---|
| DES-120 empty tool set preserved; `opts.allowedTools` declared | F1, F2, DES-A1 | **shipped, converged** — my r1 re-derived it independently; nothing to add |
| DES-121 analyzer owns the only retry loop | (r1 gap) | **shipped; my r1 variance withdrawn** — see §1.3 |
| DES-122 isolation by omission **+ constructed scratch `cwd`** | F3, DES-A3 | **my r1 is a REGRESSION — withdrawn outright**, §1.1 |
| DES-123 `DiagramNoteCode` ×10, no `MALFORMED_COMPLETION` | F13, DES-A6 | **my r1 reversed on my own new evidence**, §1.2 |
| DES-124 `gateDiagram` four passes, token membership | F11, DES-A4, T2 | **whole-label reading withdrawn → recorded residual**, §1.4; one rationale amendment, §3.7 |
| DES-125 `WorkflowDescribeView` / `EXPECTED_DESCRIBE_KEYS` | F5, DES-A5 | **AMEND — `phases` missing. This round's HIGH**, §3.1 |
| DES-126 resolve ladder, all four codes, `ANALYZER_DISABLED` | F14, C2, DES-B3/B4 | **shipped, converged**; my C2 withdrawal of `ANALYZER_DISABLED` **reversed**, §1.5 |
| DES-127 B1–B5 boundary states | F9, DES-B2/B7 | **shipped, converged** — B5 and the B1 boot line are already in the text; my r1 omitted both |
| DES-128 `TriggerPorts`, canonical fingerprint | DES-B6 | **shipped, converged** |
| DES-129 journal record + sink | F4, DES-A7, T5 | **shipped, converged**; premise correction + two field notes, §3.5/§3.7 |
| DES-130 `workflow_diagrams`, single deletion path | F7, F8, DES-A8 | **F7 shipped**; **F8 not addressed — AMEND**, §3.2 |
| DES-131 `GraphAnalyzer` API, single-flight, `MODEL_UNMAPPED` | F10, F12, DES-A2/A3, C5 | **mostly shipped**; **three amendments**: F10 §3.3, C5 §3.4, F12 §3.7 |
| DES-132 server wire, enumerated deletion, grep guard | F6, T9, T10 | **guard shipped**; **"auth-gated" phrasing wrong — AMEND**, §3.5 |
| DES-133 dashboard `<pre>`/`textContent`, 3s poll | (r1 silent) | **shipped, converged** — QD's Consumability §1, verified `:505` |
| DES-134 `graphAnalyzer` config block, 3-part DoD | DES-A2, C5 | **shipped**; caps missing from the block — §3.4 |
| DES-135 `AUTHORING.md`, rule (4), the escalation | F5 second half, F15 | **AMEND — the escalation is now RESOLVED** by ba3db17, §3.1; one DEPLOY line, §3.7 |

**Carried forward from the superseded r2 so it is not lost**: the zero-config `cwd: undefined` finding
(now shipped inside DES-122's fail-closed rule — I re-verified `main.ts:207` unguarded and `:89-94`
optional); the `isKnownAlias` mechanism (shipped in DES-131 — but its stated *justification* is stale,
§3.6); and its **D4 escalation**, which is **closed**: the owner ruled 一律公開 at `ba3db17`. No phantom
escalation should survive into Gate 4.

---

## 1. What I withdraw from my own r1 (the honest half, before anything else)

### 1.1 F3 / DES-A3 — "the analyzer passes `workspace: <scratchDir>`" is **wrong and dangerous**. Withdrawn.

My r1 proposed the analyzer pass `workspace: <scratchDir>` and called that "the scratch cwd". Verified at
`claude-agent-sdk-client.ts:573`:

```
settingSources: req.workspace !== undefined ? ['project'] : [],
```

Passing `workspace` **turns `settingSources:['project']` ON** — which is the mechanism that loads
`CLAUDE.md`/settings from the directory's project chain, i.e. precisely this repo's recorded
MEMORY.md workspace-memory-leak class. My r1 would have re-opened the leak it was written to close, and
would additionally have triggered `materializeAssets` (`:495`, gated on `workspace !== undefined`) — a
consequence my own r1 spotted and then *accepted as inert* rather than treating as the signal that the
mechanism was wrong.

**QD had this right in r1 (Self-sustainability §1) and r2 (§2.4), and the shipped DES-122 has it right**:
the scratch `cwd` is achieved at **construction** (`main.ts:207` → `join(workRoot, '.graph-analyzer-scratch')`),
`invoke()` is not widened, and `workspace` stays omitted. I re-verified the three facts DES-122 rests on:
`cwd`'s three uses are all `req.workspace ?? this._config.cwd` (`:535`, `:549`, `:581`); `main.ts:207`
passes `cwd: config.workRoot` **unguarded** while `workRoot` is legitimately optional (`:89-94`, `:128`,
`:227` all guard it) — so DES-122's zero-config forced-`tools:[]` rule is load-bearing, not decorative.

This is the one place my r1 was not merely less complete than the shipped design but **actively worse**.
Recorded plainly so the synthesizer does not merge any part of DES-A3's request shape.

*(One nit while here: DES-122 cites `:493-499` for the `settingSources` fact; the line is `:573`. `:495`
is the `materializeAssets` guard. Both facts are true, the citation is crossed.)*

### 1.2 F13 / DES-A6 — `MALFORMED_COMPLETION` withdrawn. My r1's rationale is falsified by evidence I gathered this round.

My r1 said a non-string completion "must **not** be folded into `GATE_REJECTED_SHAPE`" because it is a
*plumbing defect*, not model degradation, and folding it "corrupts the one counter ARCH-080 built for
replaceability". The shipped DES-123 folds it (gate takes `raw: unknown`, pass 1 is the type check,
`gateFail:'type'` on the journal line). **The shipped design is right and my r1 was wrong on the facts.**

`GatewayResult.content` is populated by optional chaining over a *parsed provider body*:

```
client.ts:192  content: data.choices?.[0]?.message?.content
client.ts:212  content: data.choices?.[0]?.message?.content
client.ts:233  content: data.candidates?.[0]?.content?.parts?.map(...).join('')
client.ts:249  content: data.response
```

So `ok:true` with `content: undefined` is a **live path today**, and its dominant cause is a provider
returning an unexpected 200-shape — a LiteLLM proxy in front of Ollama being exactly this deployment's
documented case. That is a **provider/replaceability** signal, which is the counter
`GATE_REJECTED_SHAPE` exists to feed. My "plumbing defect" premise described a rare future regression,
not the common cause.

Two supporting points, so this reads as a decision rather than a fold: an enum member costs a SQLite
`CHECK` value, a `NOTE_TEXT` row, a `noteCodeFor` branch and a persisted surface, whereas `gateFail:'type'`
costs a journal field that already exists and lands where both lenses agreed the rate signal lives. And
**QD's support for an 11th member is not independent** — their r2 §1.4 adopted `MALFORMED_COMPLETION`
*from* the adversarial r1 that later withdrew it, so "two of three want it" was an artifact of the
panel's own echo, not corroboration. **Final enum = the shipped 10, verbatim.** I answer QD's merged-11
directly in §2.4.

### 1.3 Retries and queue depth — my r1 numbers withdrawn

My r1 defaulted `retries: 1` and `maxQueueDepth: 16`. Shipped: `retries: 0` (DES-134) and
`maxQueueDepth: 8` (DES-131). Verified `claude-agent-sdk-client.ts:47,453`: the **gateway** already
retries (`attempts = 1 + Math.max(0, this._config.retries ?? 0)`) whenever a timeout is set — and the
analyzer always sets one. So analyzer retries **multiply** with gateway retries; a default of 1 doubles
worst-case spend for no stated benefit. **Concede 0 and 8.** (This is DES-121/QD r2 §1.2's converged
position; my r1 simply had not checked `:453`.) The `(1+a)×(1+g)` DEPLOY formula stands.

### 1.4 F11 — the whole-label reading is withdrawn; recorded as a residual instead

My r1 argued `gateDiagram` must parse the diagram's grammar and match **whole labels**, because
word-level matching lets the model recombine individually-allowed words into a sentence that was in no
source. Two things kill it:

- **Adjudication #1 moved the threat model.** The words a recombination attack would rearrange are phase
  titles, which the owner has now ruled public on every surface. A **secret literal** is a single token
  absent from `allowedLabels` and is rejected under *either* reading. What word-level admits is the
  rearrangement of **already-public** words into a misleading-but-leak-free sentence. That is a
  correctness annoyance, not the content-absence breach my r1 claimed.
- **My Karpathy tie-breaker refuses it.** A grammar parser plus an extraction spec, to prevent
  rearrangement of public words, is precisely the "needless flexibility" my own lens declines elsewhere —
  and DES-124's pass 4 already forecloses the cheap bypass I actually feared, by splitting on
  `/[^A-Za-z0-9_.:@\/-]+/` and matching **exactly and case-sensitively**, so `api_key=sk-abc123` does not
  lose a token to a punctuation run.

**Consequence I must own**: my r1's **T2(b) recombination fixture is dropped**. It is red against the
shipped gate, and keeping a fixture while conceding the design it tests would be a contradiction that
ships as a broken test. Residual recorded in §7.

### 1.5 C2 — my withdrawal of `ANALYZER_DISABLED` is itself withdrawn

My r1 §6/C2 withdrew an `ANALYZER_DISABLED` code on the grounds that REQ-104 says `enabled:false` is
"never an error". **I read the requirement this round and my r1 over-read it.** REQ-104's literal clause
is scoped: *"Given `graphAnalyzer.enabled:false` Then **registration** still succeeds and
**`workflow_describe`** reports `diagramStatus:'unavailable'` … never an error."* It constrains
registration and describe. `workflow_regenerate_diagram` is neither — it is an explicit owner action, and
shipped DES-126's argument is better than mine: *"returning success for a no-op is exactly the dishonesty
owner decision A1 forbids."* **Accept the shipped `ANALYZER_DISABLED`.** My r1's success-envelope
compromise is withdrawn.

Same paragraph, same discipline: my r1's `'PENDING'` enum member is withdrawn — `status:'pending'` already
carries it and `note_code` is NULLable (DES-130), so a pending row is `note_code IS NULL`.

---

## 2. Response to quality-dimensions (r1 = dispatch target, r2 = their operative stance)

### 2.1 QD r1 Observability §1 — the sink. **Concede the conclusion, correct the premise.**

**Concede**: one line, on stdout, no new sink, no log file, no DB table, no metrics surface. My r1's
`AnalyzerLogSink` *interface* is withdrawn — shipped DES-129's `console.log` + a spy on the **emitted
string** is the same seam at zero interface cost, and it satisfies my T5 read-back discipline exactly.

**Correct**: QD r1 asserts "this project has exactly **one** logging convention", and shipped DES-129
repeats it as "**seven** log-emitting sites in `src/`, all `[remote-workflow-engine]`". **Census taken
today: 17 `console.*` sites in `src/`, of which 6 carry that prefix.** The rest are
`[ContinuationStore]`, `[RunStore]`, `[rwe]`, and — the group that matters — **bare dotted-subsystem
structured records**: `catalog.publish: ${JSON.stringify({...})}` (`workflow-catalog.ts:494`),
`auth.migrate:` (`:171`), `catalog.migrate:` (`:209`), `run.legacySubstitution:` (`run-manager.ts:651`).

Why this matters beyond pedantry: the 6 bracket-prefixed sites are **boot/lifecycle** lines, and the
closest structural precedent for what the analyzer emits — a *per-event structured audit record* — is
`catalog.publish: {json}`, which the design's own uniformity claim does not acknowledge exists. An
operator who greps `[remote-workflow-engine]` as a filter already misses `catalog.publish` today, so the
stated operational benefit is weaker than claimed.

**I do not propose renaming a shipped log line.** The choice between
`[remote-workflow-engine] graph-analyzer {json}` and `graphAnalyzer.generate: {json}` is low-stakes and
the synthesizer's to make; what must change is the **false factual claim inside DES-129's boundary
paragraph**, because a rationale that a reader can disprove in one grep stops protecting the decision it
justifies.

### 2.2 QD r1 Observability §2/§3 (closed enum; CONTENT/SHAPE split per-run) — **concede, shipped**

Both are in shipped DES-123/DES-129 and both were independently in my r1. The per-run journal line, not
the table row, is the rate signal — full convergence, no residue.

### 2.3 QD r1 Replaceability §1/§2, Consumability §1/§2 — **concede, all four shipped**

`GraphAnalyzer` takes the existing `GatewayClient` (DES-131); `graphAnalyzer.model` is an alias name
through the shared `AliasMap` (DES-131, and I re-verified `providerOf` at `:201`); the dashboard needs no
new mechanism (DES-133, `dashboard-page.ts:505` verified); `EXPECTED_DESCRIBE_KEYS` has one exported home
next to `EXPECTED_NON_OWNER_KEYS` (DES-125). My r1 reached the last two independently. Nothing open.

**One rider I keep from my r1 (it is not a disagreement with QD, it is an addition their lens does not
cover)**: the key-set oracle is **not** the anti-drift test — two surfaces can agree on a key list and
disagree on values. Shipped DES-125 already says this and pairs it with the four-surface literal-secret
table. Both oracles, different jobs.

### 2.4 QD r2 §1.4 — the merged **11**-value enum. **Rebut, on the evidence in §1.2.**

This is my only substantive rebuttal of QD this round. Their 11 = shipped 10 + `MALFORMED_COMPLETION`.
The member's provenance is the adversarial r1 that subsequently withdrew it, so QD is not defending an
independently-derived position; and `content: undefined` is (per `client.ts:192/212/233`) dominantly a
*provider-shape* fault, which belongs in the same counter as other provider-shape degradation, with
`gateFail:'type'` carrying the finer diagnosis on the line where QD's own rate signal lives. **Enum stays
at 10.**

I concede the half of QD r2 §1.4 that is right and is already shipped: `NOT_GENERATED`/`DISABLED` are
read-synthesized and never persisted, so the SQLite `CHECK` enumerates **eight** — DES-130 has this
exactly.

### 2.5 QD r2 §1.10 (diagnostic residue) — **concede their correction; it is shipped**

QD corrected the superseded r2's "store the rejected token" offer to "engine-classified failure metric on
SHAPE only, nothing ever on CONTENT". Shipped DES-129's `gateFail` is closed, engine-authored, and
**never a value**, which satisfies them. One precision note for the synthesizer: `gateFail:'token'` is set
on `GATE_REJECTED_CONTENT`, so the field is not literally SHAPE-only — but it carries **no model-derived
bytes** in either case, which is the property QD's rule was protecting. No change requested.

### 2.6 QD r2 §3 — **both of their open items close here**

- **Tokens naming.** QD flagged `promptTokens`/`completionTokens` vs `tokens.{input,output}` as needing an
  ARCH amendment rather than a silent design substitution. **Conceded and closed**: keep ARCH-079
  invariant 5's **ratified** names and map at the call site — which is what shipped DES-129 does. No ARCH
  amendment needed. My substantive point survives independently (§3.7: the two fields are `number | null`).
- **Scratch `cwd`.** **Conceded outright** (§1.1), and on stronger evidence than QD had: their case was
  "unpinned and load-bearing if `tools` is non-empty"; the actual case is that the alternative mechanism
  *enables* `settingSources:['project']`. Their position was right for a reason they did not state.

**Net: no disagreement between the two lenses remains open.** §7's open items are amendments to shipped
text and one owner-level residual — none of them is a lens-vs-lens conflict.

---

## 3. What survives: amendments to the shipped design, ranked

### 3.1 **HIGH — DES-125 has no `phases`; adjudication #1 leaves the shipped design self-contradictory**

This is the defect the re-dispatch exists to catch, and it is a two-sided-oracle failure, not a cosmetic
gap.

Verified: `WorkflowPublicView` (`workflow-view.ts:33-44`) has no `phases` and `EXPECTED_NON_OWNER_KEYS`
(`:48-52`) does not list it — which independently confirms that ADR-015/ARCH-080's premise ("phase names
are already served to non-owners") was **false**, exactly as shipped DES-135 records. The owner then ruled
**一律公開** at `ba3db17`. But **DES-125's `WorkflowDescribeView` was written before the adjudication and
still has no `phases` field**.

Left as-is the slice ships the precise drift REQ-101 exists to forbid: `EXPECTED_DESCRIBE_KEYS` —
generated from a type with no `phases` — would **reject `phases` as a leaked field**, while the `diagram`
string *inside that same response* renders the phase titles, because DES-131 puts phase names into
`allowedLabels`. One response, two contradictory disclosure rules, with the stricter one enforced by a
test that fails for the wrong reason.

**Amendment — one adjudication, four key sets, one task:**

- `WorkflowDescribeView` gains `phases: Array<{title: string}>`; `EXPECTED_DESCRIBE_KEYS` gains its
  flattened keys.
- `WorkflowPublicView` gains the same; `EXPECTED_NON_OWNER_KEYS` gains it; `server.ts:1079` stops masking.
- **DES-135's escalation is marked RESOLVED** (`ba3db17`), and its rule (4) — "keep secrets and
  distinctive prose out of phase names" — is **strengthened, not deleted**: it stops being advice
  pending an escalation and becomes the sole standing control over a now-owner-authorised disclosure.
- **The second half nobody has written down**: the adjudication's text names
  `/api/workflows/:name/skeleton` as a surface that must stop masking phases — but **REQ-105/DES-132
  deletes that route**. Its successor is `/api/workflows/:name/describe`. One sentence in DES-132, so that
  nobody "restores" masking on a route that no longer exists, and nobody reads the deletion as a way to
  dodge the ruling.
- **Test, both directions**: the existing DES-135 pin (a secret in a phase name **does** appear in the
  diagram) is joined by the key oracle now *requiring* `phases`. If the ruling is ever revisited, both go
  red and name the decision — the correct failure mode.

### 3.2 **MEDIUM-HIGH — DES-130: the late write. An in-flight job re-creates a row for a deregistered workflow.**

ADR-021/DES-130's load-bearing claim is that an orphan row is unrepresentable because the delete rides
`deregister()`'s existing transaction. That covers rows that **already exist**. It does not cover the write
that has not happened yet:

```
enqueue → (job in flight) → deregister(name) commits → putDiagramResult(name, version, …) lands
```

`workflow_diagrams` has **no foreign key** (it is a fresh `CREATE TABLE IF NOT EXISTS` and the existing
tables at `:144`/`:177` carry none), so nothing at the storage layer refuses it. The row then never dies:
DES-130 states — correctly — that `deregister()` is the **only** deletion path, and it is keyed on a name
that is already gone. So the single-deletion-path decision, which is right, is exactly what makes this
row immortal.

**Amendment, cheapest correct form**: `putDiagramResult` writes **inside a transaction with an existence
guard** — write only where a `workflow_versions` row for `(name, version)` still exists; otherwise no-op.
Then ADR-021's claim holds for **both** orderings. Explicitly **not** proposed on top: a job-level
cancellation check (a second mechanism for a race the guard already settles) or an orphan reaper (DES-130
rightly forbids one).

**Test**: this is the one place my testability lens overrides its own seam. The `schedule` seam makes
every other analyzer test deterministic and would make this test vacuous. So: one **integration** test on
the real `setImmediate` path — gateway fake resolving on a released promise, `deregister`, release, then
assert `getDiagram()` is `null` **and** `SELECT COUNT(*) FROM workflow_diagrams` is 0. Written as a rule
so a later "make the suite faster" pass cannot quietly seam the last real-path test.

### 3.3 **MEDIUM — DES-131's `sweepAtBoot` has no persisted attempt marker, so "one requeue" is unrepresentable**

DES-131 specifies "one requeue per pending row, then `unavailable/RETRIES_EXHAUSTED`". Across a **process
restart** there is no state distinguishing "swept once" from "never swept": a process that dies
mid-generation leaves `status='pending'`; the next boot requeues; if it dies again — the *likely* case,
since a crash mid-generation is often caused by the generation — the boot after that sees an identical row
and requeues again. An unbounded crash-loop amplifier, and the amplifier is the model-call path.

**Amendment with no new column** (DES-130's `generated_at` is already NULLable and today only meaningful
for `ready`): the sweep **stamps `generated_at` when it requeues**. Three distinguishable shapes:

| row | meaning | action |
|---|---|---|
| `pending`, `generated_at IS NULL` | never swept | requeue once, stamp |
| `pending`, `generated_at` < this process's boot instant | swept by a previous life | settle `unavailable/RETRIES_EXHAUSTED` |
| `pending`, `generated_at` ≥ boot instant | a live job in this process | leave alone |

Boot instant comes from the **injected `Clock`** DES-131 already mandates, so the whole rule is unit-testable
with `FixedClock` and no restart harness.

**One clause this amendment owes, or it trades one dishonesty for another**: re-using `generated_at` as an
attempt marker means a swept `pending` row now carries a non-NULL stamp for a diagram that was never
generated. DES-125 must therefore project `diagramGeneratedAt` **only when `status === 'ready'`**, `null`
otherwise — the same shape as `diagramStale`'s B3 rule, and for the same reason. Without it, fixing an
honest-absence gap creates a small dishonest-presence one.

### 3.4 **MEDIUM — REQ-104 compliance: three analyzer harness values are hard-coded in engine source**

REQ-104's acceptance, read literally this round: *"a `graphAnalyzer` block sets **at minimum** `enabled`,
`model`, `systemPrompt`, `tools`, `timeoutMs` and `retries`, and **no analyzer harness value is
hard-coded in engine source**."*

Shipped, three are: `maxBytes: 8192` and `maxLines: 120` (DES-124 defaults) and `maxQueueDepth: 8`
(DES-131 constructor default). A cap on model-authored text **is** an analyzer harness value, and it is one
an operator with a different model class cannot change without a redeploy — the exact failure REQ-104 was
written to prevent. This is a requirement-compliance variance, not a preference: "at minimum" makes the
six-key list a floor, so lifting these is *inside* the requirement's bounds.

**Amendment**: `maxBytes`, `maxLines`, `maxQueueDepth` join the `graphAnalyzer` config block (DES-134),
defaulted at the single `composeConfig()` site with the shipped values (8192 / 120 / 8 — I concede the
numbers, §1.3), threaded to `gateDiagram`'s existing `limits` parameter and `GraphAnalyzer`'s existing
`maxQueueDepth`. **No new mechanism**: both call sites already take these as parameters; only the default's
*home* moves. Adds three rows to `compose-config-v2-wiring.test.ts` — which is the guard this ledger's own
`composeConfig` bug class requires anyway.

### 3.5 **MEDIUM — DES-132 says `/describe` is "auth-gated exactly as the route it replaces". The route it replaces is not auth-gated.**

`server.ts:1025` and `:1080` say so in their own comments — *"this route carries no bearer/identity"* — and
the handler branches on `authEnabled` to choose **what to disclose**, not whether to answer. (Same shape at
`:1140` for `/api/runs/:id/dag`, which is why v22's H2 fix took the form it did — and DES-132 already
protects that one.) An implementer reading "auth-gated" will look for a bearer check that is not there, or
add one and break the dashboard.

**Amendment — precision, and it changes a test**: state that `/api/workflows/:name/describe` is
**unauthenticated and therefore pinned to the non-owner projection unconditionally**. Note this composes
cleanly with DES-125's dropped `viewerIsOwner` (QD r2 §1.10, conceded by both lenses): the route *has* no
owner/non-owner branch to make. The parity test must compare the route body against the MCP tool invoked
with `ctx = {authEnabled: true, principal: null}` — comparing against an **owner** call would pass for the
wrong reason and hide exactly the divergence the test exists to catch.

### 3.6 **LOW-MEDIUM — two stale justifications inside shipped text**

Both conclusions are fine; both *reasons* are disprovable in one grep, and a rationale a reader can
disprove stops protecting its decision.

1. **DES-131's alias-set warning is stale.** It says to use `server.ts:1327`'s set "explicitly **not** the
   catalog's `aliasNames`, which is deliberately empty on the default deployment (D-AUTH-5-B,
   `server.ts:1322-1326`)". Verified: `server.ts:1276` now builds the catalog's set as
   `new Set(Object.keys(config?.aliases ?? DEFAULT_ALIASES))` — **the same expression**, changed by v21
   Gate 8 P-A2 for this exact reason. The "deliberately empty" description survives only in the *comment*
   at `:1321-1326`, which now misdescribes the line above it. The instruction is harmless (the sets are
   identical) but the stated hazard no longer exists. One sentence; **not** a scope-push to fix the stale
   comment.
2. **DES-129's log census** — see §2.1: 6 of 17, not 7 of 7.

### 3.7 **LOW — five one-line contract precisions**

- **DES-124 pass 1 gains its real rationale.** As written the type check reads as a type-system formality.
  Cite `client.ts:192/212/233`: `ok:true` with `content: undefined` is reachable **today** whenever a
  provider returns an unexpected 200-shape. Pass 1 is a live-path guard. *(This is the evidence that
  reversed my own §1.2 — it strengthens the shipped design's own justification.)*
- **`noteTextFor('GATE_REJECTED_SHAPE')` must be true for the no-completion case.** Since the fold, this
  one text covers both "the model emitted invalid vocabulary" and "the provider returned nothing". Word it
  as *"did not return a valid diagram"*, not *"the model's output violated the vocabulary"* — otherwise the
  persisted, user-facing note is a **false statement** in the empty-completion case.
- **`gateFail` needs the invariant-5 amendment recorded — the other half of QD's own §1.9 discipline.**
  I closed the tokens-naming half in §2.6, but the same rule cuts the other way here: verified today,
  **`gateFail` appears nowhere in `02-architecture.md`**, and ARCH-079 invariant 5 pins a **nine**-field
  list *"here so it cannot silently grow a transcript field later"*. Shipped DES-129 emits **ten**. The
  field is right (§2.5) and the superseded r2 flagged it as needing assent rather than assuming it — but
  the assent was never recorded, so as it stands this is exactly the silent drift between a pinned list
  and what ships that QD's discipline forbids, and a Gate 8 reviewer on this ledger *will* diff a pinned
  field list. Amend invariant 5 to ten fields, or drop `gateFail`. *(Same paragraph, one loose end in the
  other direction: invariant 4 promises the line carries "the provider HTTP status", and neither DES-129's
  record nor `GatewayResult`'s failure branch has such a field — reconcile or strike the clause.)*
- **DES-129: `promptTokens`/`completionTokens` are `number | null`.** `GatewayResult`'s failure branch
  (`client.ts:61-79`) carries **no tokens**. Shipped DES-129 does not say this, and a line whose zeros are
  indistinguishable from a real zero silently corrupts the cost attribution ADR-016 promises. Say
  `null` on every failure branch.
- **DES-131's allowlist model component**: "the resolved model aliases" is not statically derivable — an
  agent's model can come from a script literal, an `agentType`'s frontmatter, or (since v21) a **tunable
  param** supplied per run (`workflow-meta.ts:135-160`: `SkeletonNode` carries no model). Pin it as *the
  configured alias names ∪ `default` ∪ one literal sentinel* (`⟨param⟩`) for the run-time-determined case.
  Anything else the model names is `GATE_REJECTED_CONTENT` — correct, since an invented model name is
  model-authored text in no engine source. One clause in the shipped `systemPrompt`, zero new machinery.
- **DEPLOY.md/AUTHORING.md owe one sentence each (F15)**: registration now performs an outbound LLM call
  **whose payload is the workflow script itself** — the artifact v22 spent an iteration masking from other
  principals. Against engine principals the mask holds; against the configured provider it does not exist.
  Not a defect — inherent to the feature the owner asked for — but an operator-visible property with an
  existing control (`enabled:false`) that an operator can only choose if they know. DES-134's DEPLOY list
  and DES-135's four rules currently omit it.

---

## 4. The settle table, corrected post-concession

Replaces my r1 DES-B1 (which predates every concession above). Rows changed from my r1 are marked ▲.

| trigger | row written? | `status` | `note_code` | `diagram` |
|---|---|---|---|---|
| gate passes | yes | `ready` | `NULL` | the verbatim gated string |
| enqueued, job not yet run | yes | `pending` | `NULL` ▲ (no `PENDING` member) | `NULL` |
| `enabled:false` at registration | **no row** ▲ | — | `DISABLED` synthesized at read | — |
| version predates v23 | **no row** | — | `NOT_GENERATED` synthesized at read | — |
| `graphAnalyzer.model` unmapped | yes | `unavailable` | `MODEL_UNMAPPED` (zero model calls) | `NULL` |
| queue at `maxQueueDepth` | yes | `unavailable` | `QUEUE_FULL` | `NULL` |
| timeout on the last attempt | yes | `unavailable` | `TIMEOUT` | `NULL` |
| `ok:false reason:'unreachable'` | yes | `unavailable` | `PROVIDER_UNREACHABLE` | `NULL` |
| `ok:false reason:'terminal'` | yes | `unavailable` | `PROVIDER_ERROR` | `NULL` |
| retries exhausted / swept twice (§3.3) | yes | `unavailable` | `RETRIES_EXHAUSTED` | `NULL` |
| `content` not a string / empty ▲ | yes | `unavailable` | `GATE_REJECTED_SHAPE` + `gateFail:'type'` | `NULL` |
| gate: caps or codepoints | yes | `unavailable` | `GATE_REJECTED_SHAPE` + `'size'`/`'codepoint'` | `NULL` |
| gate: label not a member | yes | `unavailable` | `GATE_REJECTED_CONTENT` + `'token'` | `NULL` |
| **regenerate fails over an existing `ready` row** ▲ | **row unchanged** (DES-127 B5) | `ready` preserved | preserved | preserved |
| in-flight job settles after `deregister` ▲ | **no-op** (§3.2 guard) | — | — | — |

Two invariants asserted **directly against the table**, not through the accessor: `diagram IS NOT NULL`
**iff** `status='ready'` (DES-130's CHECK, plus a test), and `note_code` never takes `DISABLED` or
`NOT_GENERATED` (the CHECK enumerates eight). The last two rows are the ones a naive settle implementation
gets wrong: **a failed attempt is not always a write.**

---

## 5. Testability deltas against the shipped design

Only what changes; the shipped test discipline is otherwise right and I do not restate it.

- **T2(b) withdrawn** (§1.4). The remaining `gateDiagram` fixtures stand: hostile secret literal →
  `CONTENT`; ANSI/CSI, C0, RTL override, ZWJ → `SHAPE`/`'codepoint'`; `<`/`&` → `SHAPE`; oversize by bytes
  **and** by lines → `SHAPE`/`'size'`; empty/whitespace **and non-string** → `SHAPE`/`'type'`; happy path
  returned **byte-identical**.
- **New: the late-write integration test** (§3.2) — the one test that must *not* use the `schedule` seam.
- **New: the sweep's three shapes** (§3.3) under `FixedClock`, all three at the unit tier.
- **New: `phases` appears in `EXPECTED_DESCRIBE_KEYS` and in `EXPECTED_NON_OWNER_KEYS`** (§3.1),
  alongside the existing secret-in-a-phase-name pin, so the ruling is tested in both directions.
- **Changed: the parity test's context** is `{authEnabled: true, principal: null}` (§3.5), not an owner
  context.
- **Changed: three new rows in `compose-config-v2-wiring.test.ts`** for the lifted caps (§3.4).
- **Held from r1**: the secret-absence oracle asserts the **exact literal** (`not.toContain('SEKRIT-9F2A')`),
  never `not.toContain(wholeScript)` — the recorded v21 defect where a fragment leak passes; and the
  journal assertion runs against the **emitted string**, not the record object, because the prefix is a
  concatenation and a concatenation is where `res.detail` gets appended "for debugging".

---

## 6. Sequencing — one change to the shipped task order

The shipped four-way split (`gateDiagram` first; grep guard before the deletions; ARCH-085's three DoD
items as one task; parity test undivided) is right and both lenses reached it independently. One
amendment:

**The adjudication-#1 `phases` change (§3.1) is its own TASK/DES pair and lands *before* the diagram
task.** It amends v22's shipped surface (`workflow-view.ts` + `EXPECTED_NON_OWNER_KEYS` +
`server.ts:1079` + `workflow_get`) as well as v23's new one. The diagram's `allowedLabels` should point at
a field that is **already public**, not anticipate one — otherwise the two land in either order and the
window between them is the self-contradictory state §3.1 describes.

Everything else in the shipped ordering I endorse unchanged, including the two I would otherwise have
argued for: the `curateToolsForProvider` fix as its own task landing before the analyzer, and the
skeleton deletion as **one** task rather than distributed across the six modules that lose it (split by
module, a partial deletion passes every module's own test — the ledger's nine-instance defect class
reproduced by the task breakdown itself).

---

## 7. What remains genuinely open

**No lens-vs-lens disagreement remains.** Both of QD's r2 open items are closed (§2.6) and my only
rebuttal of them (§2.4) rests on primary source they had not seen. What is left is four items for the
synthesizer and one for the owner:

1. **§3.1 `phases` into `WorkflowDescribeView`** — the one item I would call **blocking**. Without it the
   shipped design is internally contradictory post-adjudication, and the contradiction is enforced by a
   test that fails for the wrong reason.
2. **§3.4 the three lifted caps** — a literal REQ-104 acceptance-clause variance. If the synthesizer
   disagrees, the disagreement should be recorded against REQ-104's words, not left implicit.
3. **§3.2/§3.3** — two boundary states the shipped text does not cover. Neither is discoverable at Gate 6
   without rework, which is why they belong to design rather than implementation.
4. **§3.5/§3.6/§3.7** — precision fixes; none changes a mechanism, one changes a test's context.

**Owner-level residual, recorded rather than resolved (§1.4)**: with the word-level gate, a model can
rearrange **already-public** phase-title words into a phrase that appears in no source. Post-adjudication
this leaks nothing, but a diagram is engine-authored text and a *misleading* engine-authored label is a
consumability defect the panel is choosing not to spend a grammar parser on. If a real diagram is ever
observed doing this, the fix is the `systemPrompt`, not the gate. **R4 stands and belongs in DEPLOY.md**:
on this deployment's real case (`qwen2.5:7b`) vocabulary compliance degrades first, so **honest absence may
be the common path** and a rising `GATE_REJECTED_SHAPE`/`gateFail:'codepoint'` rate is the expected early
signal — correct behaviour, and a poor first impression if an operator has not been told.
