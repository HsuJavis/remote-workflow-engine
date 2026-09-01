# Design panel — Adversarial group (interface-contract / boundary-error / testability), round 2

**Feature:** 001-remote-workflow-engine · **Iteration:** v21 (REQ-090..095 → ARCH-064..070, ADR-001..008)
**Stage:** Gate 3+4, debate round 2 — response to `quality-dimensions.r1.md`, final position, residual disputes.
**Read:** `quality-dimensions.r1.md` (full), my own `adversarial.r1.md`. This document is the **delta** —
r1 items not mentioned here stand unchanged and are restated by ID in §5 for the synthesizer.
**Tie-breaker unchanged:** Karpathy simplicity-first — minimum design that solves the problem.

Round 2 produced **three primary-source findings** that were not available to either lens in r1. Two of
them **overturn a position I took in r1**; one overturns a position quality took. They are §1.

---

## 1. New primary-source findings (these decide three open items)

### N-1 — nested `workflow()` is the **same run**, and child `defaults` are **already inert today**.
`run-manager.ts:652–700` (`_handleWorkflowRequest`): the nested workflow shares the parent's `runId`,
`RunGuard` (one budget for the whole graph), workspace and journal; the nested `SandboxHost` is wired with
`onAgentRequest: (…) => this._handleAgentRequest(runId, …)` — **the parent run's agent handler**. And the
catalog read at `:676` is `const registered = await this._catalog.get(name)` followed by **`registered.script`
only** — `defaults` is never read on the nested path.

Three consequences:
1. REQ-094's literal "any `agent()` in that run" **does** include nested frames — there is one run.
2. Per-child harness params would require threading a per-frame param set through `_handleAgentRequest`
   — **new machinery**, for a hole that predates v21 (child `defaults` are inert *today*, before any of
   this slice lands).
3. Therefore **params are run-scoped**: one `effectiveParams` snapshot per run, applied to every `agent()`
   in the whole frame tree. Zero per-frame threading, zero new state, and it is what the requirement text
   literally says.

**I reverse my r1 I-2 recommendation at the knob level.** r1 argued `model`/`effort`/`timeoutMs` must not
propagate into nested frames for child-contract integrity. That was reasoned from architecture prose; the
source says containment is not "don't propagate", it is "build a per-frame param path that has never
existed". Karpathy tie-break rejects it. **Final position: run-scoped params — all four knobs, including
`appendPrompt`, apply to every `agent()` in the tree.** My r1 §5 conflict 5 is hereby resolved, not deferred.

**Residual this creates (record it, do not design around it):** a caller's overrides, validated against the
**parent's** contract, reach agent calls inside a **child** workflow whose author declared different bounds.
This is REQ-091-shaped, but it is *inherited*, not introduced: the child's `defaults` and (post-v21) its
`params` are not honored per-frame today either. One DES line + one residual entry + v22 candidate
("per-frame contract resolution for composed runs"). One test pins the current semantics so the choice is
visible rather than emergent.

**Re-scoping of my own r1 R-5:** the sentence "REQ-092 silently fails under composition" is **withdrawn** —
under run-scoped params REQ-092 is satisfied once at admission for the whole tree. **I-1 (`catalog.get()`
widening) still stands unchanged**, but on its remaining load: `start()` (`:349`) and `resume()` (`:523`)
both need `defaults` + `params` from the row they already read, and pointing only `start()` at `getFull()`
still leaves resume narrow. The nested call site is no longer the justification.

### N-2 — `parallel()` swallows **every** exception into `null` (`sandbox/guards.ts:143–148`).
```
try { return await thunk(); } catch { return null; }
```
This **rebuts quality's O-6 in its second half**. O-6 proposes: script-supplied invalid `effort` ⇒ catchable
throw, **"no harness event is written (the call never dispatched)"**. Inside `parallel()` — the dominant
call shape in this engine — that throw becomes an untyped `null`, byte-indistinguishable from a gateway
failure, with **nothing** in the journal, descriptor or `workflow_status` explaining why. A 10-way
`parallel()` with one typo'd `effort` returns ten values, one of them silently null. That is precisely the
silent-failure class v21 exists to close, recreated by the design meant to close it.

**Proposal (P-1): a pre-dispatch param rejection must leave an observable record before it throws.** Reuse
the D-F12 precedent at `run-manager.ts:_handleAgentRequest` (allocate `agentId` + `markQueued` *before* the
concurrency slot, so a blocked call is observable immediately): a rejected call is recorded terminally with
its coded reason, then the throw propagates. Two shaping constraints:
- The record is shaped as a **rejection**, not a pseudo-descriptor: `{code:'PARAM_OUT_OF_RANGE', param,
  allowed}`, and it carries **no `effortApplied` field** — a call that never reached the wire must not
  appear in the channel REQ-093 uses to distinguish wire from echo.
- `markQueued` is guarded by `entry.spawner instanceof AgentExecutor` (`run-manager.ts:~712`), so the
  record must also be emitted under `_spawnerOverride`. Same one-word-omission class as my T-1 — call it
  out in DES or the observability is absent in exactly the tests that would catch its absence.

**Fallback if the synthesizer judges P-1 out of slice:** then the throw stands and DES must carry (a) a test
that *documents* the `parallel()` null, and (b) an explicit residual. Note `Unknown agentType`
(`agent-executor.ts:289`) has the identical hole today, so this is a pre-existing class — which is an
argument for cheapness, not for silence. **The one unacceptable outcome is shipping it undecided.**

### N-3 — `redact()` is available at admission, and that is exactly why F-2 must **not** be resolved by refusal.
`redact(event, secrets)` (`secret-resolver.ts:95`) is a pure value-exact substring replace; `RunManager`
already holds a `SecretValueProvider` (`run-manager.ts:771`). So a tempting third option exists — *refuse at
admission any `appendPrompt` whose `redact()` output differs from its input*, making quality's F-2 divergence
impossible by construction. **I raise it and kill it:** accept-vs-refuse is a **1-bit secret-value oracle**.
A non-owner principal (open-by-default, ADR-005) could binary-search server secret values by submitting
candidate strings and observing which are refused. Masking-on-persist leaks nothing; refusing leaks a bit
per submission. The security argument runs opposite to the boundary instinct here, and it wins.

---

## 2. Item-by-item response to `quality-dimensions.r1.md`

| Their ID | My call | Position |
|---|---|---|
| O-1 same-object provenance | **CONVERGE** (with a distinction) | See §3.1 — two objects, two sites, one direction of flow |
| O-2 snapshot sink = one DES item | **AGREE** | Identical to my T-D; merged in §5 |
| O-3 no rejection counter | **AGREE** | ADR-008 stands; I do not reintroduce it |
| O-4 / F-1 per-client effort seam | **CONVERGED — identical finding** | ≡ my B-6/R-1. `thinkingFor` sole writer, takes effort as **input**; non-Anthropic ⇒ explicit `{applied:false, reason}`; byte-identical-`thinking` regression test |
| O-5 descriptor schema pin | **CONCEDE, with the I-3 resolution** | Pin their exact shape; required at the **decoration site's output type**, optional on the **gateway-emitted DTO** (historical records lack the fields) |
| O-6 script-supplied invalid effort | **HALF-CONVERGE / HALF-REBUT** | Throw-not-null: converged. "No harness event is written": **rebutted by N-2** |
| R-1 `ProviderEffortProfile` typed apart + zero-importer fence test | **CONCEDE (narrowed)** | Fence test accepted, same shape as the existing drift-lock. Narrowing: for `resolveHarnessParams` the answer is **deletion**, not a fence — a fence around a *revivable* dead function is weaker than removing the shape |
| R-2 ARCH-064 sole owner of key lists | **AGREE** | ≡ my T-B |
| R-3 alias-name enum, validated at registration | **AGREE** | Composes with my B-2 (default cross-validation at the same moment) |
| R-4 both clients, one mapper | **CONVERGE + supply the transport** | They specify "handed back, not recomputed" but name no channel; my I-4 `onHarness(descriptor, applied?)` is it |
| C-1 `source:'contract'\|'engine_ceiling'` | **CONCEDE (narrowed)** | One string, zero branching. Narrowing: it must be **derived from the same comparison that computed the effective bound** (B-3), never a second lookup — same-object discipline applied to the error payload |
| C-2 `workflow_get` never serves null | **AGREE on "never null", REBUT the payload** | See §3.2 — "no bounds" is a discoverability lie under B-3 |
| C-3 generated schema/descriptions under the drift-lock | **AGREE** | ≡ my T-C DoD |
| C-4 cap on raw bytes pre-frame | **AGREE** | ≡ my B-1a + B-10; refusal reports bytes, never content |
| C-5 reuse the registration-name predicate | **AGREE** | ≡ my "transcription is drift" |
| C-6 plugin note | **AGREE (drop from v21)** | They pre-conceded; I accept the pre-concession |
| S-1 byte-identity pins | **AGREE, and extend** | Add the CallKey pin, §3.3 |
| S-2 legacy NULL snapshot resume | **CONCEDE — adopt as mine** | I missed it. Pair with my T-5 pre-v21 `catalog.db` ⇒ `params = NULL` case: **one upgrade-day story, one task, two tests** |
| S-3 composeConfig same-task | **AGREE — same evidence, same four precedents** | ≡ my T-D |
| S-4 fail-closed defaults + one ordering table | **AGREE** | ≡ my B-4 `EFFORT_RANK` in `contract.ts` |
| S-5 lifecycle untouched | **AGREE** | |
| S-6 appendPrompt charged to budget | **AGREE — adopt** | Not in my r1; the fan-out free-rider test is worth its line |
| S-7 provenance as standing tripwire | **AGREE** | ≡ my T-6; their "name the Gate-7.5 assertions" is the right addition |
| F-2 redacted snapshot read back on resume | **CONCEDE — accept-and-pin**, with a better reason and a tighter bound | §3.4 |
| Their expected-disagreement 1 (ADR-007 screening) | **NO CONTEST** | I never asked for screening; r1 §4 lists it as accepted-not-mitigated |
| Their expected-disagreement 2 (ADR-008 masking) | **NO CONTEST** | Same; and I did **not** propose surfacing `effectiveParams` on `workflow_status` |

---

## 3. The five items that needed integration, resolved

### 3.1 O-1 vs I-4 — **two objects, not one construction site**
Quality's O-1 ("`resolveCallParams` is the *single construction site*") and my I-4 (provider is only
resolvable inside the gateway — `gateway/client.ts:281`, `claude-agent-sdk-client.ts:527`) are both right
about different objects. Converged formulation for DES:

- **`EffectiveCallParams` = `{model, effort, timeoutMs, appendPrompt, provenance}`** — built **once**, in
  `resolveCallParams`, upstream. The descriptor writer receives *this object*, never the pre-resolution
  inputs. Quality's O-1 invariant, unmodified.
- **`effortApplied` = `{param, value} | {reason}`** — the **wire translation**, computed by the shared pure
  `mapEffort` **inside the gateway** (the only place the provider is known), and returned upward via
  `onHarness(descriptor, applied?)`.

One direction of flow, no re-lookup anywhere, and the invariant that actually matters (**recorded ≡ applied**)
holds on both. No new `GatewayClient` interface method (`resolveTarget` stays uninvented — Karpathy).
Testability: the applied object is asserted at the injected seam (`fetchImpl` body / `queryImpl` `Options`)
**and** in the persisted descriptor, and the test asserts they are the same value.

### 3.2 C-2 ∩ B-3 — **REBUT: the canonical contract is ceiling-bounded, not unbounded**
Quality's C-2 (a NULL `params` row reads back as "four knobs, **no bounds**, no declared args") collides with
my B-3 (`workflow_get` must advertise the **effective** bound = `min(author, engine ceiling)`). Under C-2 as
written, the most common case — every pre-v21 workflow and every author who declared nothing — advertises
unbounded `timeoutMs` and `effort:'max'` while admission refuses both. That is the exact docs/behaviour split
REQ-093 exists to repair, reintroduced at the discoverability surface.

**Converged:** `params` is never served as null; the canonical contract for a NULL row is **four knobs bounded
by the engine ceilings** (`effort ≤ maxEffort`, `timeoutMs ≤ ceiling`, `appendPrompt ≤ maxAppendPromptBytes`),
**computed at read time** so a config change is reflected immediately and nothing stale-caches. The stored
column keeps the author's raw declaration (or NULL). Callers still write zero special-casing — quality's
actual goal — and the advertised number is now the true one. Test: NULL-`params` row + lowered ceiling config
⇒ `workflow_get` reflects the lowered bound without a re-register.

### 3.3 New invariant neither lens pinned — **params compose downstream of `CallKey`**
`CallKey` is built at `run-manager.ts:~706` from the **raw** sandbox-supplied `{prompt, opts}`, before any
resolution or prompt composition. Two separate promises silently depend on this:
- ADR-002's zero-cache-invalidation (a v21 deploy must not miss on any pre-v21 journal), and
- my F-2 blast-radius bound (§3.4).

An implementer who composes `appendPrompt` into the prompt **before** the cache key breaks both, silently and
simultaneously. **Pin as a DES invariant + test: an overridden run's `CallKey`s are byte-identical to a
non-overridden run's.** This is the cheapest test in the slice and it guards two ADRs.

### 3.4 F-2 — **CONCEDE accept-and-pin**, with a stronger reason and a tighter bound
I accept quality's option (a). Three additions:
1. **Refusal-at-admission is the wrong alternative** — it is a secret-value oracle (N-3). This makes
   accept-and-pin *correct*, not merely *cheaper*; the ADR should carry the oracle reasoning, because it is
   the argument that survives review.
2. **They asked for a non-pathological trigger; here is one, and it does not change the verdict.**
   `redact()` is value-exact **substring** replacement, so a *short* secret value collides with ordinary
   prose — the divergence does not require the caller to know a secret. But this property is pre-existing
   across every transcript sink (DES-088), not introduced by v21; the fix belongs to the secret-hardening
   track (minimum-length or word-boundary policy), not this slice.
3. **Blast radius is smaller than stated:** resume replays *settled* calls from the journal cache
   (`run-manager.ts:527`), so already-completed dispatches never recompose. The divergence can only affect
   calls issued **after** the resume point. One test, one invariant-table row.
4. Scope note: `appendPrompt` is the **only** free-text override; `model`/`effort`/`timeoutMs` are
   enum/numeric and cannot contain a secret value. The pinned test needs exactly one case.

### 3.5 O-6 / I-5 — converged on the mechanism, disputed on the record
**Converged:** an invalid *script-supplied* param is a **throw**, not a resolve-null — matching the
`Unknown agentType` precedent; the script may catch it; pre-dispatch, so `CallKey` and ADR-002 are untouched.
**Disputed:** quality's "no harness event is written". See N-2 / P-1. This is my one substantive open
disagreement with quality and it is decidable by the synthesizer in one line.

---

## 4. My own three lenses, re-adjudicated after round 2

- **Boundary vs security (new, and it went against boundary).** The boundary lens wanted the F-2 divergence
  *eliminated* (refuse at admission); the security reading says elimination is an oracle. Resolution: mask,
  don't refuse. Recorded because it is the only place this round where my strongest instinct was wrong.
- **Testability vs simplicity (N-2).** The simplicity lens says "a throw is enough, `Unknown agentType`
  already behaves this way"; the testability lens says an assertion cannot exist for a state that leaves no
  trace. Resolution: one record at one site (P-1) — cheaper than the residual it retires; explicit fallback
  offered so the synthesizer decides rather than inherits.
- **Interface honesty vs blast radius (I-3/T-1)** — unchanged from r1, now reconciled with quality's O-5:
  required-ness at the decoration site's output type, optional on the persisted DTO, `tsc` lever on
  `AgentReq` **and** `_spawnerOverride`.

---

## 5. Final position — what the synthesizer should carry

**Merged task split** (my r1 §3 ∩ quality's §"task-splitting constraints" — the two are compatible; their
"ARCH-066 is ONE task" ≡ my T-D):

- **T-A** `catalog.get()` widening — first, alone (I-1; rationale now start+resume, not nesting).
- **T-B** pure `src/params/{contract,resolve}.ts`: total rejection table (B-1), `EFFORT_RANK` (B-4),
  post-eval structural guard (T-4ii), `source` derivation (C-1). All UT, test-first, no I/O.
- **T-C** catalog column + registration: migration, **`params = excluded.params` in `ON CONFLICT`** (T-5),
  default cross-validation (B-2), pre-eval source-size guard (T-4i), `workflow_get`/`workflow_list` with
  **ceiling-bounded** effective bounds (B-3 ∩ C-2), pre-v21 `params = NULL` read-back (T-5 ∩ S-2).
- **T-D** admission + snapshot + resume: `start(spec, overrides?)` (I-6), ceilings, redaction sink + REQ-083
  sweep row (O-2), `defaultRunParams` factory (B-9), resume refuses the `overrides` field outright (B-5),
  **legacy NULL-snapshot fallback** (S-2), **and the three `composeConfig()` keys + their
  `compose-config-v2-wiring.test.ts` rows in THIS task** (S-3 — fifth instance of that bug class otherwise).
- **T-E** dispatch + descriptor: required field on `AgentReq` **and** `_spawnerOverride` (T-1), single-site
  `onHarness` decoration (I-3 ∩ O-5), `composePrompt` incl. `defaults.prompt` (T-8), **four-segment prompt
  order pin** (B-7), CallKey byte-identity pin (§3.3), run-scoped params across nested frames (N-1).
- **T-F** gateway effort: shared `mapEffort`, two import sites, `onHarness(descriptor, applied)` (I-4 ∩ R-4),
  **`thinkingFor` sole-writer regression** (B-6 ≡ F-1), zero-importer fence test (R-1).
- **T-G** issue binding incl. absent-`workflow` fingerprint byte-identity (T-7), name predicate reused (C-5).
- **Cleanup task:** delete `resolveHarnessParams` after T-8's author-side path exists.

**Holds where quality was silent** (silence ≠ concession; restated by ID only, not re-argued):
**I-1** widened `get()`; **B-2** one source of truth for a knob default (derive from `defaults`);
**B-7** four-segment order (system / script / user / engine-protocol) — REQ-094's literal "last" is already
false at `agent-executor.ts:312,320`; **B-8** declared-args validation now applies to webhook/schedule/chained
triggers (4 of 5 `start()` callers bypass `SubmissionValidator`) — intended, one test + DEPLOY note;
**B-9** single `RunParams` factory, chained runs never inherit run A's snapshot; **B-10** concrete numbers
(4 KB / 32 knobs / 32 enum members / depth 4); **T-3** pre-commit REQ-093's real-tier evidence plan now
(Ollama has no reasoning dial ⇒ no-op branch real-tier **plus** mapped-value at the injected seam);
**T-5** `ON CONFLICT` staleness; **T-8** the unplaced REQ-092 locked trio (`defaults.prompt/tools/skills`).

**Accepted residuals (no contest):** ADR-005 cost amplification; ADR-007 appendPrompt injection;
ADR-008 no rejection telemetry / no non-owner masking before v22; **new:** per-frame child-contract
resolution for composed runs (N-1), inherited not introduced; `redact()` short-secret substring collisions
(§3.4.2), owned by the secret-hardening track.

## 6. Remaining disagreements (for the synthesizer to decide — two, both one-line)

1. **Observable rejection record vs silent `parallel()` null (N-2 / P-1 vs quality O-6).** My position:
   record then throw, shaped as a rejection, surviving `_spawnerOverride`. Fallback I will accept: throw
   only, **plus** a test documenting the null **plus** an explicit residual. Not acceptable: undecided.
2. **Run-scoped params across nested frames (N-1).** Decided here on primary source and it reverses my own
   r1 recommendation, so quality has not yet had a chance to react. If it disputes, it should do so with a
   line number showing a per-frame param path that already exists — I could not find one.

Everything else in this panel is converged.
