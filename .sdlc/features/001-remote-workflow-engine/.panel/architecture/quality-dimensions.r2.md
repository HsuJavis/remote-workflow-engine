# Quality-dimensions expert — Architecture round 2 (post send-back)

**This file supersedes the pre-send-back round 2** written at 16:12 on 2026-09-20; that version is
still recoverable with `git show 21ad773:.sdlc/features/001-remote-workflow-engine/.panel/architecture/quality-dimensions.r2.md`
(committed; the only dirty state on this path before this write was this write itself, verified
with `git status --porcelain -- <path>`).

**Context this round inherits, stated once so the four sections below don't repeat it.** This is
not a continuation of the original v34 round 2 debate (my prior `quality-dimensions.r2.md`, written
16:12 today, and `adversarial.r2.md`, 16:11 — both from the pass Gate 8 already reviewed and
accepted, per `07-review.md`'s INV-V34-2/3/4 + ADR-061..064 acceptance). Gate 8 sent architecture
back for exactly two MED findings — `AC-1` and `AC-2` — and `adversarial.r1.md` was rewritten at
23:33 to scope to them alone, superseding its pre-send-back text. I adopt the same scope
discipline: I do not re-argue INV-V34-2/3/4, the deletion set, or the fail-closed refusal sites.
I also do not re-count `AC-3` (`harness-defaults.ts` writer half) or the `toErr()`/`.detail` gap
(quality-dimensions finding #2 from the separate Gate-8 review-lens report,
`.panel/review/quality-dimensions.md`) — both are already disclosed and routed to v35
(`06-impl-log.md` IMPL-340, TASK-229 DoD item 4). Re-opening either here to inflate this round's
finding count would be the exact double-counting `adversarial.r1.md` §D4 correctly refuses.

One more scope note, because it's easy to conflate: the *other* quality-dimensions MEDIUM from Gate
8 (`.panel/review/quality-dimensions.md` finding #1 — ADR-064's missing `workflow_describe`-side
legacy-row test) is real and is mine, but `07-review.md`'s `send_back` routes it to **tests**, not
architecture. Nothing in `02-architecture.md`/ARCH-137/ARCH-140 needs to change to fix it — the gap
is a missing test file, not a wrong architecture sentence. I flag it here only so a reader of this
round doesn't wonder why I dropped it; it is carried, just not by this document.

**What is actually open here, restated from my own read of `07-review.md:11200-11205`:**
`AC-2` (`02-architecture.md` `INV-V34-1`/`ARCH-137` note — architecture's own file, mine to fix in
substance even though `adversarial.r1.md` drafted the wording) and `AC-1`
(`src/authoring-guide.ts`/`docs/AUTHORING.md` — an impl-owned file, but the *choice* between the
review's two offered remedies is an architecture call adversarial already made and I now review).

---

## Responses to `adversarial.r1.md` (rebut / concede / hold)

### AC-2's corrected wording (§2.2) — **concede in full, one integration note**

The contradiction is real and I verified it independently before reading their fix: `INV-V34-1`
(`02-architecture.md:4190`) says `defaultAllowedTools` "survives v34... because removing an
operator's tool floor would be a security regression," and `ARCH-137`'s note (`:4079`) calls it
"the surviving operator-owned restriction layer" — both read `??` as an operator-side floor, and
`claude-agent-sdk-client.ts:544-547` is unambiguous that it is not one:

```
const baseTools = req.opts.allowedTools ?? this._config.defaultAllowedTools ?? BUILT_IN_CORE_TOOLS;
```

A per-call array replaces the operator's value wholesale; there is no intersection anywhere in the
resolution chain and (confirmed by adversarial's `grep -rn disallowedTools src/` → zero hits, which
I re-ran and got the same empty result) no clamp exists at any other point either. §2.2's
replacement text is correct and I have nothing to add to its substance.

**Integration note, offered, not insisted on — I talked myself out of half of it while checking it.**
`INV-V34-1` is my own dimension's invariant as much as security's — it is the joint one we named
`INV-NOADD` in the pre-send-back round and the owner promoted into `02-architecture.md` as
`INV-V34-1`'s own parenthetical. My first instinct was to add a clause naming which prong
(*restrictive* / *readable*) `defaultAllowedTools` satisfies, on the theory that a "residual" needs
to say why it's exempt from the rule everything else in the paragraph follows. Checking that against
`INV-V34-1`'s own text before proposing it: the alias table, two sentences earlier in the same
invariant, "passes on the readable prong... because the redirect's outcome is persisted as
`descriptor.model`/`provider`" — which is *also* a post-hoc-only readable prong, exactly like
`HarnessDescriptor.tools` for tools, and it is not called a residual anywhere. So a prong-attribution
clause on `defaultAllowedTools` alone would invite a question the send-back never asked and
`INV-V34-1` doesn't currently answer for its own other example: why is post-hoc-readable enough to
avoid "residual" status for one entry and not the other. I don't have a clean answer, and manufacturing
one now, under a two-finding send-back, is exactly the scope creep adversarial's §6.1 tie-break
argues against. So: **optional, not part of what I'm asking Gate 3+ to carry.** If a future round
wants the general "what counts as readable enough" question answered, that's a `INV-V34-1` design
question in its own right, not a rider on this fix.

### §2.3's revisit trigger ("no operator ceiling exists, today 0 of 27") — **concede "build nothing," add one self-sustainability clause**

Security's real finding, Karpathy's tie-break to record-not-build (§6.1): I agree with the
conclusion for the reason my own dimension would reach it independently. Self-sustainability's test
for a *recorded* gap is that the record be honest about what actually re-checks it — and here I have
to correct myself before this ships, not after: `workflow-meta.ts:481-493` parses every literal
`allowedTools` array at registration, but that parse never compares the result against
`defaultAllowedTools` (server-side deployment config, not visible to a pure script-source parse) —
nothing fires today, and the values it produces just sit there until a human reads them. That is
*exactly* the defect class my r1 named under Self-sustainability for the other one-time hand-check
this iteration made ("catalog 目前 22 個版本,0 個使用 agentType" — an assertion, not a monitored
invariant), and I nearly reintroduced the same defect with different wording by calling this trigger
"self-checking" when it is not. Corrected ask, one clause, still text-only:

> …trigger = any future workflow registration whose parsed `allowedTools` (already computed at
> `workflow-meta.ts:481-493`) requests a tool outside the deployment default. The values needed for
> this comparison already exist at registration time; the comparison itself is not performed today,
> so until someone adds the one-line check, this remains a periodic hand-check, not an automatic
> one — recorded as such rather than overstated.

This is honestly weaker than what I first drafted, and I'd rather ship the honest version: it names
where the future work is cheapest (the inputs already exist) without claiming a mechanism runs that
doesn't.

### D1 (project the resolved tool list into `workflow_describe`) — **concede their landing zone in full**

This was going to be my ask, and their pre-emptive rebuttal is the correct one, not a compromise I'm
grudgingly accepting. The decisive point is (i): `allowedTools` is in `LOCKED_KEYS`
(`params/contract.ts:25`), so a caller reading a resolved value cannot act on it — no branch, no
retry, no different call shape follows from knowing it. My dimension's actual test for a
consumability defect is *not* "is a fact hidden," it's "does hiding it cost the caller a decision
they could otherwise make correctly." A caller here has no decision to make either way; an author
does, and AC-1 already puts the real list in front of them. Verified independently:
`mcp-facade.ts:492` states the field's own contract ("Names only — never a resolved list, never
prompt text") before adversarial's argument even needs it — resolving `'default'` there doesn't just
add a field, it contradicts a boundary the projection already states about itself. I'll take their
compromise as stated: define the sentinel in `tool-specs.ts`'s `workflow_describe` description
(one sentence: `'default'` means this deployment's `defaultAllowedTools`, else `BUILT_IN_CORE_TOOLS`
— the same fact AC-1's guide clause states for authors). That sentence is genuinely mine to ask for
under this dimension even though I'm conceding the bigger ask: a served sentinel with no definition
anywhere on the served surface is a real, small consumability gap on its own, independent of whether
the resolved value would ever be actionable.

### D2 (delete `defaultAllowedTools` outright) — **not my position; concur it's wrong**

I didn't propose this in r1 and don't now. Adversarial is rebutting a Karpathy-flavored move they
expect from *someone*, not from me — my r1's Replaceability section argued the opposite direction
(collapsing three tool-resolution layers to two is a replaceability *gain*, precisely because the
absent-default case stays real and configurable). No disagreement to resolve here.

### D3 (reopen REQ-203's disclosure-loss register) — **not my position; concur on process grounds**

Same: my r1 asked the *design pass* (pre-Gate-8) to confirm the two-segment `prompt`/`appendPrompt`
view stays visible after `systemPrompt` is deleted — a request Gate 8 already checked and accepted
(`INV-V34-3`'s totality property, the retirement register's predicted-diff framing). I'm not asking
to reopen an accepted row in a send-back round any more than adversarial is; re-litigating it now
would mint a trace delta for zero code change, the same objection I'd raise against anyone else
doing it.

### D4 (`toErr()`/`.detail`, AC-3) — **concur, already routed, not re-counted here**

Covered in the scope note above. Same disposition adversarial gives it; no daylight between us.

### D5 (compile-time inventory test: guide layer-count == code rung-count) — **concede, and I want to be on record for why**

I want to concede this cleanly rather than hedge, because the counter-evidence is embarrassing to
my own dimension's instincts and adversarial names it precisely:
`tests/unit/authoring-guide.test.ts:357` already *is* that class of test
(`toMatch(/two layers/i)`) and it is green today while pinning the exact sentence `AC-1` proves
false. A prose-matching test doesn't catch drift, it certifies whatever prose existed when it was
written — the false confidence is the defect, not the missing coverage. Self-sustainability's
proper tool for "does this fact stay true as the system evolves" is a structural guard
(`INV-V34-4`'s compiler-pinned key sets are the right shape: absence a `tsc` error can't be
forgotten into) or a behavior test against the actual resolution code
(§4.1's `it`, which I also don't need to add anything to). A sentence about a sentence is neither.
Filed as a self-correction, not a hold: if I'd been asked in r1 whether an inventory test belongs
under Self-sustainability, I'd have said yes; I now think that instinct was wrong, and
`authoring-guide.test.ts:357`'s own history is the proof.

---

## The four dimensions, current state (short — most of the substance is already above)

### 1. Observability
`AC-2`'s fix is squarely mine to own the correctness of, not just adversarial's: the corrected
`INV-V34-1` sentence is *itself* an observability artifact — the promise a future auditor reads to
know what's checkable and how. Getting it right this round matters more than the original wording
being wrong did: `07-review.md`'s own retro names "shipped a sentence the code doesn't support" as
this iteration's recurring pattern, hit twice in the same pass (AC-1/AC-2, and separately the
DEPLOY.md history-carrying finding). A second wrong version of the same `INV-V34-1` sentence,
caught only at a third Gate 8 pass, would be that pattern a third time in one iteration — reason
enough to get the correction itself right rather than fast.

No other observability item is open this round. `HarnessDescriptor.tools`'s post-hoc coverage
(non-optional field, `types.ts:506`) is unchanged by either fix and remains the right seam for
"what actually ran" — nothing here asks it to do more.

### 2. Replaceability
Unaffected in mechanism — no `GatewayClient` change, no new config key, no new module (I re-confirm
adversarial's §2.4 count: prose, one guide string, one unit test). `INV-V34-1`'s two-prong test
(*restrictive* or *readable*) is still what makes an author's script portable across deployments
sharing an advertised ceiling, and that property is untouched by AC-2's wording fix either way —
the code doesn't change, only the sentence describing it does. I raised, then withdrew, a request to
make the corrected sentence name which prong each residual satisfies (see the AC-2 response above);
withdrawing it means Replaceability has no separate ask this round beyond confirming the mechanism
itself is unaffected.

### 3. Consumability
`AC-1`: I concur with Remedy A (text) over Remedy B (default `defaultAllowedTools` to
`BUILT_IN_CORE_TOOLS` inside `composeConfig`) — the `composeConfig` forwarding-bug class and the
`compose-config-v2-wiring` guard are adversarial's §3 citation, not mine, and I'm not going to
launder it into a false self-citation to make my agreement look more independent than it is. What
*is* mine from r1: the byte-lock discipline (`docs/AUTHORING.md`/`buildAuthoringGuide()`, UT-160)
is the one hard constraint on landing Remedy A, already flagged there as a hard constraint on this
exact surface, now directly load-bearing for this fix's execution rather than background risk. On
the merits I agree with adversarial's reasoning as given — Remedy B adds a new forwarding default to
a config-composition path this project has a standing guard against precisely because that class of
default has gone missing silently before; Remedy A touches zero config plumbing and needs only the
byte-lock regeneration to land clean.

D1's landing zone (sentinel definition in `tool-specs.ts`) is this round's other Consumability item,
conceded above.

### 4. Self-sustainability
Two items: §2.3's revisit trigger gets one clause naming what data already exists for the future
comparison, stated honestly as a hand-check until someone adds the one-line comparison (not
"self-checking" — I overclaimed that once above and corrected it); and D5's inventory-test ask is
withdrawn on my own dimension's authority, not just deferred to Karpathy. Nothing else in this
iteration's touched surface bears on memory metabolism, tool-liveness, or prompt self-calibration —
the engine has no per-agent long-term memory to metabolize and this send-back changes no
periodic-sweep code, same as I found in r1.

---

## Remaining disagreements

None that block. The prong-attribution clause (AC-2 integration note) is offered, not asked for —
I found a reason against it (the alias table's own symmetric case) while checking it, and I'm
leaving that as a question for whoever next touches `INV-V34-1`'s general wording, not a rider on
this send-back.

## Handoff (delta on top of `adversarial.r1.md` §8)

1. `02-architecture.md:4190` (`INV-V34-1`) — adversarial's §2.2 text, unchanged. (Optional, not
   requested: the prong-attribution clause discussed above, if a future round wants it.)
2. `02-architecture.md:4079` (`ARCH-137` note) — adversarial's §2.2 text, **plus** the corrected
   revisit-trigger clause above (names `workflow-meta.ts:481-493` as where the comparison's inputs
   already exist, and states plainly that the comparison itself does not run today).
3. `src/tool-specs.ts` (`workflow_describe` tool description) — **new, one sentence**: define the
   `'default'` sentinel `mcp-facade.ts:493-498` serves in `toolSurface` (this deployment's
   `defaultAllowedTools`, else `BUILT_IN_CORE_TOOLS`). Not a resolved-value field; a definition of
   the word already on the wire.
4. `src/authoring-guide.ts:534-537` / `docs/AUTHORING.md` — adversarial's §3 Remedy A clause,
   regenerated in the same commit (UT-160 byte-lock).
5. `tests/unit/authoring-guide.test.ts:357` — strengthen per adversarial's §4.2/item 4 (assert the
   built-in core set and its six tools by name); the existing `/two layers/i` match is not the
   guard and stays as-is.
6. `tests/unit/claude-agent-sdk-gateway-allowed-tools.test.ts` — adversarial's §4.1 single `it`.

No new ARCH row, no new ADR, no new config key, no new module, no inventory test. Six edits total —
adversarial's five (items 1, 2, 4, 5, 6 above) plus one new one (item 3, the sentinel definition),
none of them behavior changes. Converged.

ARCHCHECK: lens=quality-dimensions, file=/home/user/Documents/remote-workflow/.sdlc/features/001-remote-workflow-engine/.panel/architecture/quality-dimensions.r2.md, round=2
