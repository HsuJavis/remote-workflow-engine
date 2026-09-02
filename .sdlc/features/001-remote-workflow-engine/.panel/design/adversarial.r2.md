# Design panel — Adversarial group (Interface-contract × Boundary/error × Testability), round 2

**Iteration**: v23 (REQ-101..106), Gate 3+4 merged.
**Read for this round**: `.panel/design/quality-dimensions.r1.md` (in full), my own `adversarial.r1.md`,
and — because two of their findings and three of mine turn on facts, not preferences — a fresh
primary-source pass over `src/main.ts`, `src/server.ts`, `src/session-options-builder.ts`,
`src/params/contract.ts`, `src/gateway/claude-agent-sdk-client.ts`, `src/dashboard-page.ts`.
**Line numbers below were re-read today**; where I quote r1 (mine or theirs) I say so.

**Headline**: I concede more than I hold. The scratch-`cwd` disagreement — which both lenses' r1 files
predicted would be the round's fight — **dissolves on a fact neither of us had checked**, and I concede
it outright in QD's cheapest form. Two of my own r1 positions are reversed here (the `MALFORMED_COMPLETION`
enum member, and my §8.2 "store the rejected token" compromise), both under pressure from QD's lens, both
producing a *smaller* design. What remains genuinely open is two items, and one of them is an escalation
to the owner rather than a disagreement between us.

---

## 0. Scoreboard (every point of contact, with the verdict)

| # | QD r1 claim | Verdict | Where |
|---|---|---|---|
| Q1 | Journal line goes to `console.log('[remote-workflow-engine] …')`, no second sink | **CONCEDE** (fully; I never pinned a sink) | §1 |
| Q2 | `outcome`/`noteCode` is a closed literally-written enum; theirs has 7 values | **CONCEDE the discipline, MERGE the sets** → 10 values | §2 |
| Q3 | The CONTENT/SHAPE split must survive per-run, not only in the latest table row | **CONCEDE** (already implied by my DES-129; now explicit) | §1 |
| Q4 | `GraphAnalyzer` ctor takes `gateway: GatewayClient`, the existing interface, not a narrower shape | **CONCEDE, with one non-negotiable rider** | §3 |
| Q5 | `graphAnalyzer.model` resolves through the same `AliasMap`; must be said in the design | **CONCEDE** (verified) | §4 |
| Q6 | Dashboard `pending→ready` needs no new mechanism (one 3s poll drives everything) | **CONCEDE** (verified: `dashboard-page.ts:505`) | §5 |
| Q7 | `EXPECTED_DESCRIBE_KEYS` needs one home, not a copy per test file | **AGREE — already my DES-125**; converged, naming the module | §5 |
| Q8 | Analyzer needs an explicit scratch `cwd`; `this._config.cwd` is unpinned and load-bearing | **CONCEDE** — and my r1 §5.1 tie-break is **withdrawn** on new evidence | §6 |
| Q9 | `MODEL_UNMAPPED` note code + boot warning, warn-don't-fail-boot | **CONCEDE the code and the posture; CORRECT the rationale; PIN the mechanism** | §4 |
| Q10 | Nothing to add on ADR-017 recovery | Agreed, nothing from me either | — |
| Q11 | Task-splitting: ARCH-085 as one task; grep guard before deletions; `gateDiagram` first; parity test undivided | **AGREE on all four** — identical to my r1 §6 | §8 |

| # | My r1 position | This round | Why |
|---|---|---|---|
| A1 | `MALFORMED_COMPLETION` is its own code and "must not fall into `GATE_REJECTED_SHAPE`" | **SELF-REVERSED** | §2.2 |
| A2 | Compromise: store the rejected token for `GATE_REJECTED_SHAPE` | **WITHDRAWN**, replaced by a closed 3+1-value `gateFail` sub-field | §7 |
| A3 | Predicted QD would demand a boot backfill; I would oppose | **Prediction did not materialise.** I concede the cheap half unprompted | §8 |
| A4 | `cwd` on `invoke()` rejected; omission wins (r1 §5.1) | **Conclusion held, tie-break re-derived** — the rejection was right for the *wrong* reason | §6 |
| A5 | DES-120 (`curateToolsForProvider([]) → ['Bash']`), DES-121 (retries), DES-124..129, §3.1/§3.3 corrections | **HOLD, unchallenged** | §9 |

---

## 1. CONCEDE Q1/Q3 — the journal sink is the existing prefixed stdout line, and I was under-specified

QD is right and I have nothing to trade. My DES-129 pinned the *record* and said nothing about where it
goes, which is exactly the gap that lets an implementer reach for a logger. Verified: this repo has
**seven** log-emitting sites in `src/`, all `[remote-workflow-engine] …` on `console.log`/`console.error`
(`main.ts:249,252,255,266,283`, `server.ts:1420,1450`), matching `DEPLOY.md §6`. There is no logging
utility to reach for, which makes the drift risk lower than QD feared and the concession free.

**Integrated position (amends DES-129):**

```ts
// eslint-disable-next-line no-console   // the convention at every existing site
console.log('[remote-workflow-engine] graph-analyzer ' + JSON.stringify(rec));
```

with one contract note my lens adds on top of QD's: **the secret-absence UT asserts against the emitted
string, not against `rec`.** The prefix is a concatenation, and a concatenation is where an implementer
appends `res.detail` "for debugging" — a `JSON.stringify(rec)`-only oracle would stay green through
exactly that edit. This is the ADR-016 test from my r1 §2.10, retargeted one layer out.

**Q3** (per-run `noteCode` in the line, table row is latest-only) is correct and is the reason the
journal line — not the table — is the rate signal. Stated in the design in those words so nobody
implements "log the outcome" as "read back the row we just wrote".

---

## 2. Q2 — the enum: I merge, and I delete one of my own members

### 2.1 The merge

QD's 7 and my 10 overlap on 6. Neither set is a superset. Merged, with the source of each member:

```ts
export type DiagramNoteCode =
  | 'TIMEOUT'               // both
  | 'PROVIDER_UNREACHABLE'  // mine — GatewayResult.reason 'unreachable'
  | 'PROVIDER_ERROR'        // mine — GatewayResult.reason 'terminal'
  | 'GATE_REJECTED_CONTENT' // both — security event
  | 'GATE_REJECTED_SHAPE'   // both — replaceability event (now also absorbs non-string content, §2.2)
  | 'QUEUE_FULL'            // both
  | 'RETRIES_EXHAUSTED'     // both
  | 'DISABLED'              // both — read-synthesized
  | 'MODEL_UNMAPPED'        // QD's — conceded, §4
  | 'NOT_GENERATED';        // mine — read-synthesized, pre-v23 rows (DES-127 B1)
```

Ten. I keep the `unreachable`/`terminal` split against a possible "collapse to `PROVIDER_ERROR`" push,
because `GatewayResult` already carries the distinction on the wire (`gateway/client.ts:61-79`) and
collapsing it *discards* information the caller was handed for free — "my Ollama is down" and "my model
rejected the request" are different operator actions. Collapsing is work that loses signal; that is the
one shape of simplification Karpathy's rule does not endorse.

**Boundary note the implementer needs, or the SQLite CHECK will be written wrong:** `DISABLED` and
`NOT_GENERATED` are **read-synthesized only and never persisted** (DES-127 B1/B2 — "the row is written
only by an attempt"). So the `putDiagramResult` discriminated union's `noteCode` field is typed as
`Exclude<DiagramNoteCode, 'DISABLED' | 'NOT_GENERATED'>`, and the table's CHECK enumerates eight, not
ten. Without this sentence someone writes the ten-value CHECK and a later reader concludes the row can
carry `DISABLED`, which is the persisted lie B2 exists to prevent.

### 2.2 Self-reversal: `MALFORMED_COMPLETION` is deleted and folded into `GATE_REJECTED_SHAPE`

**My r1 §2.4 said the opposite in so many words** ("it must not fall into `GATE_REJECTED_SHAPE` — that
code is defined as the *replaceability* signal for a degraded model"). I am reversing it, and marking the
reversal rather than quietly shipping a different enum, because the synthesizer reads both rounds.

QD's pressure for a small closed set made me re-examine why I needed an eleventh member, and the answer
was an interface accident: `GatewayResult.ok:true` carries `content: unknown`, so *somebody* has to
narrow it, and in r1 I put that narrowing in the analyzer and gave its failure its own code. Better:

**`gateDiagram(raw: unknown, allowed: readonly string[], limits: GateLimits)` takes `unknown` and its
first pass is the type check.** A non-string (or empty string) completion is `GATE_REJECTED_SHAPE`.

Three things get better at once, which is how I know it is the right call rather than a concession:

1. The gate becomes **total over the gateway's actual return type**. In r1 the gate's signature was
   `string`, meaning the analyzer had to narrow first and the gate was total over a type the system never
   produces — a contract that quietly relies on its one caller.
2. One fewer enum member, one fewer branch in `noteCodeFor`, one fewer row in `NOTE_TEXT`.
3. The operator reading `GATE_REJECTED_SHAPE` gets the *correct* action either way: **swap or re-prompt
   the model.** My r1 distinction was real in the code and meaningless at the operator's altitude, which
   is the definition of a member that should not exist.

The residual I accept: a gateway-contract regression (a client that starts returning objects) now looks
like a bad model. `gateFail: 'type'` (§7) restores that distinction on the journal line without an enum
member, which is the right altitude for it.

---

## 3. CONCEDE Q4, with one rider that is not negotiable

QD: `GraphAnalyzer`'s constructor takes `gateway: GatewayClient` — the existing interface type, not a
narrower ad hoc shape — so a third backend needs no analyzer-specific path. Agreed without reservation;
it is also exactly the seam my r1 §4 testability table already assumed.

**Rider (my r1 §5.2, unchanged and load-bearing):** taking the interface makes the analyzer trivially
stubbable, and **a suite of stub-gateway tests will ship DES-120's Bash bug green.** The bug lives
entirely inside `ClaudeAgentSdkGatewayClient`'s `options` builder (`:478-487, :535-581`); no stub can see
it. So the design records both, as a pair:

- **many** fast tests on a hand-written `GatewayClient` stub → the whole `noteCodeFor` mapping, the queue,
  single-flight, status transitions, journal record;
- **exactly one** test at `queryImpl` level (UT-024's existing `vi.mock` pattern) → the literal built
  `options` object, with a **non-Anthropic alias**, asserting `tools: []`, `allowedTools: []`,
  `settingSources: []`, `strictMcpConfig`, empty `mcpServers`, thinking disabled.

Neither is optional. QD's replaceability argument and my interface-contract argument want the same
constructor for opposite reasons and both are satisfied; the only thing that would break the pair is a
design doc that lists the stub tier alone.

---

## 4. Q9 — `MODEL_UNMAPPED`: concede the code, **correct the rationale**, pin the mechanism

I owe QD the code. But their stated reason is not what the code does, and since their reason is what an
implementer would design against, correcting it matters more than agreeing.

**QD r1 Self-sustainability §2 says** an unmapped `graphAnalyzer.model` means "every single registration's
analyzer call silently degrades (wrong thinking-policy default, or a provider mismatch)" and "fails
silently forever". **Verified, that is not the failure.** `providerOf` returns `aliases?.[model]?.provider`
(`claude-agent-sdk-client.ts:201-202`) → `undefined`. Then:

- `thinkingFor` → disabled (`:325-326`). Harmless: disabled is already the non-Anthropic default and this
  deployment's real state.
- `curateToolsForProvider(tools, undefined)` returns `tools` **unchanged** (`:223-227`, the
  `provider === undefined` early return). Note the irony this creates for my DES-120: an **unmapped**
  alias is the one case where `[]` survives curation today. The Bash injection is a *known-non-Anthropic*
  behaviour, not an unknown-provider one.
- Dispatch is not Anthropic-direct (`:513, :525`), so the literal string goes to the LiteLLM proxy, which
  has no such model → HTTP error → `ok:false, reason:'terminal'`.

So today's behaviour is **loud but misattributed**, not silent: every diagram lands
`unavailable/PROVIDER_ERROR`, and the operator debugs their provider instead of their config file.
QD's *conclusion* is right and their argument understates their own case in one way and overstates it in
another: there is no wrong-model dispatch to fear, and there is a real, repeated, wasted provider call per
registration to stop.

**Pinned mechanism (this is the part that keeps it from being new machinery):** use the **same predicate
and the same set** run admission uses — `isKnownAlias` from `src/params/contract.ts:94`, against
`new Set(Object.keys(config?.aliases ?? DEFAULT_ALIASES))` as built at `server.ts:1327`. Explicitly
**not** the catalog's `aliasNames`, which is deliberately empty on the default deployment (D-AUTH-5-B,
`server.ts:1322-1326`) and therefore accepts everything — a boot check wired to that set is inert, which
is this ledger's own recurring defect shape.

Using `isKnownAlias` also resolves an edge QD did not reach: **`openrouter/<id>` passthrough models
(REQ-038) are dispatchable but are not configured aliases**, and `isKnownAlias` already accepts them via
`OPENROUTER_PASSTHROUGH` (`contract.ts:73-94`). A hand-rolled `Object.hasOwn(aliases, model)` check would
reject a valid analyzer config. This is my own DES-126 "one truth table, two call sites" argument applied
to config validation rather than version resolution.

**Behaviour**: evaluate once at boot → warn on the §1 stdout line naming the offending alias and the
allowed set → and `enqueue()` **short-circuits to `unavailable/MODEL_UNMAPPED` with zero model calls**.
That last clause is mine and it is why the code earns its place: it does not merely relabel a failure, it
deletes `N` doomed provider round-trips per registration.

**Boot posture**: warn, never fail. QD's REQ-104 "never an error" reading is correct; extending REQ-021's
fail-fast posture here would let a config typo block a boot for a feature whose own requirement forbids it
from blocking a registration. No disagreement between us — recording agreement so the synthesizer does not
re-open it.

**Also conceded from Q5**: the design must state in words that `graphAnalyzer.model` is an *alias name*
from the same table `agent()` uses, not a provider:model string. Verified as QD described.

---

## 5. Q6/Q7 — no conflict, converging on the concrete names

**Q6 verified**: `dashboard-page.ts:505` is a single `setInterval(render, 3000)`. `pending → ready`
appears within 3s with no new code provided the `/describe` fetch sits in the ticked `render()` path.
Agreed; nothing from my lenses to add except that this makes the dashboard's `<pre>`/`textContent`
assertion (my r1 §6.7) a pure-rendering test with no timing dimension, which is the easy case.

**Q7 was already my DES-125** — we independently converged, so the only thing left is to stop describing
it and name it: **`EXPECTED_DESCRIBE_KEYS` is exported from `src/workflow-view.ts`, next to the existing
`EXPECTED_NON_OWNER_KEYS`**, and imported by the MCP-facade test and the `/api/workflows/:name/describe`
route test. One more thing my boundary lens adds to QD's anti-drift point: the key oracle is **not** the
anti-drift test. Two surfaces can agree on a key list and disagree on values. The anti-drift guarantee is
my r1 §2.6 oracle 2 — the four-surface table asserting the exact secret literal is absent from
`JSON.stringify` of `workflow_get` (non-owner), `workflow_describe`, `GET /api/workflows/:name`, and
`GET …/describe`. Both oracles, different jobs.

---

## 6. Q8 — **CONCEDE**, and my r1 §5.1 tie-break is withdrawn on evidence

This was forecast by *both* r1 files as the round's disagreement. It is not one. Here is the honest
account of why my r1 position was wrong.

**My r1 §5.1** rejected an explicit `cwd` and closed with: "with `tools: []` there is no tool that could
read anything, so `cwd`'s remaining job is a belt whose suspenders are already on." **QD r1
Self-sustainability §1** said the opposite: `this._config.cwd` is load-bearing for exactly the case
ADR-020 names as accepted (`graphAnalyzer.tools` non-empty), and unpinned.

I rejected the wrong thing. My argument was against **widening `invoke()` with `cwd?: string`** — an
optional parameter with a silent fallback, this repo's documented bug class — and that rejection still
stands. **QD never proposed that.** They proposed changing the value the analyzer's gateway is
*constructed* with, which is a different change with none of the properties I objected to. I argued
against a proposal that was not on the table. Withdrawn.

**Three facts checked this round that settle it, none of which either r1 file had:**

1. **`main.ts:207` already passes `cwd: config.workRoot`.** QD's worst case (defaulting to `process.cwd()`,
   which for this repo *is* a Claude project) does not occur on the boot path. Their risk framing is
   over-stated for the configured deployment — good news for the design, and I say so rather than let a
   concession carry a wrong premise forward.
2. **`this._config.cwd` has exactly three uses, all `req.workspace ?? this._config.cwd`** (`:535` session
   `cwd`, `:549` `canUseTool` jail, `:581` the `PreToolUse` belt-and-suspenders hook). Every user-facing
   `agent()` call supplies `workspace`, so **repointing the constructed `cwd` changes the analyzer's jail
   and nothing else.** QD's cheap form — edit one line in `main.ts`, `mkdir` once — is genuinely cheap:
   no second gateway instance (which would duplicate the whole `aliases`/`secretSource`/`anthropicAuth`/
   `assetRoot`/`mcpRegistryDbPath` forwarding block and create a second `composeConfig` drift surface),
   and no per-call mutation of instance state (which would race concurrent runs). I had both of those
   expensive forms in my head as "QD's proposal" and neither is what they wrote.
3. **`buildSessionOptions`'s `WORKROOT_INSIDE_PROJECT` re-walk (`session-options-builder.ts:58,77,92`),
   which checks between `config.cwd` and `config.workRoot`, is not wired to this client** — `grep` for
   `buildSessionOptions` across `src/` returns its own definition and one doc reference in
   `params/resolve.ts:152`, nothing else. So repointing `cwd` cannot perturb that guard's semantics,
   because that guard does not read this value. (This is the known unwired-security-module debt, not a
   v23 problem; noted so a later reader who *does* wire it knows the scratch dir must stay under
   `workRoot` — which it does, so the re-walk would pass.)

**Converged position (DES-122, revised — supersedes r1 §2.3/§5.1):**

- **Isolation by omission stays the primary control** and the omission table stays: no `workspace` ⇒
  `settingSources: []` (the actual guard against the recorded CLAUDE.md/MEMORY.md leak class, and QD's own
  Self-sustainability §1 second bullet says the same); no `onEvent`/`onHarness` ⇒ no transcript to persist;
  synthetic `runId`/`agentId`; no `SecretValueProvider`.
- **DES-120 (`curateToolsForProvider` preserves an explicitly empty set) stays the control for the
  default path.** With `tools: []` there is no tool surface and the jail is moot.
- **QD's repointed `cwd` is accepted as the belt for ADR-020's non-empty case**: `main.ts:207` becomes
  a fixed `join(workRoot, '.graph-analyzer-scratch')`, created once, never written by any run.
  `workRoot` is already boot-certified by `assertWorkRootIsolated` (`main.ts:94`, REQ-021) to be outside
  any project, so "not project-reachable" is **inherited**, not re-derived — QD's argument, and it is a
  good one. Cost: one changed line plus one `mkdirSync(..., {recursive:true})`.
- **`invoke()` is NOT widened.** Both lenses agree; recording it so it stays closed.

**And one thing neither r1 file caught, which is this round's new finding and the reason the concession is
not merely tidy:**

> **Zero-config divergence — `cwd` can be `undefined` on a real deployment.**
> `main.ts:89-94` reads `workRoot` from env/file config and it is legitimately optional (`:94` guards
> `if (workRoot !== undefined)`; `:227` guards `config.workRoot ? … : undefined`). `main.ts:207` passes
> `cwd: config.workRoot` **unguarded**, so on a zero-config install it passes `undefined`. Meanwhile
> `server.ts:1194` independently defaults `const workRoot = config?.workRoot ?? mkdtempSync(join(tmpdir(),
> 'rwe-'))` — the two files disagree about what workRoot is. And the client's own docblock (`:246-248`)
> records the consequence: "No workspace root known at all (e.g. a direct unit-tier call with neither
> `req.workspace` nor a configured `cwd`) -> nothing to enforce against, allow."
>
> That branch is documented as *unit-tier*. **v23 makes it production**, because `GraphAnalyzer` is the
> first production caller that omits `workspace`. Zero-config + `gateway:"sdk"` + non-Anthropic alias +
> `graphAnalyzer.tools` non-empty ⇒ Bash (DES-120) with **no path enforcement at all**. Every one of those
> four is a documented, supported configuration.

**Rule this produces (fail-closed on the dangerous combination only, ~3 lines, no new mechanism):** when
`graphAnalyzer.enabled` and the analyzer's jail root is not resolvable (no `workRoot`), the analyzer's
`tools` is **forced to `[]`** and the boot line says so. Combined with the ADR-020 warning amendment from
my r1 §2.1 — the warning names the **effective post-curation** set, not the configured one — the operator
is told what they are actually accepting in both branches. Non-empty tools remain possible exactly where
they are safe to be.

---

## 7. Withdrawing my own §8.2 compromise — QD's stricter line wins, and here is what replaces it

My r1 §8.2 predicted QD would want a diagnostics store for `GATE_REJECTED_SHAPE` and pre-offered a
compromise: persist the single rejected token. **QD went the other way** — their Observability §1 says
"do not invent a second sink … that would fork this project's one logging convention in two", which is
*stricter* than my compromise. Their line is better and I withdraw mine: the rejected token is a substring
of a model completion derived from a masked script, and any store for it is a second surface to mask
(ADR-016), for a debugging convenience.

But QD still needs the degradation signal their lens exists to protect, and `noteCode` alone cannot say
*which* pass rejected. So the replacement carries **no model-derived bytes at all**:

```ts
gateFail?: 'type' | 'codepoint' | 'size' | 'token'   // closed, engine-authored, never a value
```

on the journal record, set only for `GATE_REJECTED_SHAPE` and `GATE_REJECTED_CONTENT`, one member per
gate pass — `'type'` for the non-string branch folded in at §2.2 (without it the set is incomplete on day
one), `'codepoint'`/`'size'`/`'token'` for the three passes of DES-124. An operator greps
`gateFail:"codepoint"` or `"token"` rising after a model swap and has the degradation signal; nobody ever
learns what the rejected token was. Same sink, same line, four literals.

**This adds one field to ARCH-079 invariant (5)'s pinned list, so it needs the synthesizer's assent —
flagged, not assumed.** If it is refused, the fallback is the enum alone, and the design should say
plainly that a `SHAPE` storm is then diagnosed by re-running with a known-good model rather than from
logs. I would rather have that written down than have an implementer invent a store later.

---

## 8. Task-splitting — merged list (QD's four and my eight, deduplicated)

We agreed independently on four; the union has no conflicts. Numbered for the synthesizer:

1. **`gateDiagram` / `diagram-gate.ts` first, alone.** Pure, `deps: —`, carries REQ-102/A3's security
   invariant, green before `GraphAnalyzer` exists. *(both r1 files)* — now typed `raw: unknown` (§2.2).
2. **ADR-022's CI grep guard lands before or with the ARCH-083 deletions, allowlist populated at
   creation.** *(both)*
3. **ARCH-085's three definition-of-done items are ONE task**: `composeConfig()` forward +
   `compose-config-v2-wiring.test.ts` row + `rwe.config.example.json`/DEPLOY.md. *(both)*
4. **The facade/route parity test is one task spanning both files.** *(QD; I concur — split by file it
   becomes two tests each proving half a property)*
5. **`curateToolsForProvider`'s empty-set fix + `opts.allowedTools` wiring + the `queryImpl` wire
   assertion are ONE task.** *(mine, unchallenged)*
6. **`getTriggerBindings` is its own task, before both consumers.** *(mine)*
7. **Dashboard (ARCH-084) depends on and is separate from the route task (ARCH-083).** *(mine)*
8. **`docs/AUTHORING.md` (ARCH-086) is not last** — per my §3.3 it is the sole control over a new
   disclosure. *(mine)*
9. **REQ-104's Gate 7.5 real run is its own task line.** *(mine)*
10. **The `cwd` repoint + the no-workRoot forced-`[]` downgrade + the effective-set boot warning land
    inside the ARCH-079 task**, not as follow-ups. *(QD's placement argument, my content)*

**Unprompted concession on the backfill (my r1 §8.1 predicted a fight that did not happen):** QD never
asked for one. I keep DES-127 B1 (no boot backfill — `N` model calls triggered by an upgrade, attributed
to no principal) and volunteer the consumability half anyway, because it is the cheap part and their lens
would be right to want it: **one boot line naming the count of versions with no diagram row and the exact
`workflow_regenerate_diagram` recovery command.** Zero model calls, all of the discoverability.

---

## 9. Held without change (unchallenged by QD, restated in one line each)

`DES-120` (empty tool set preserved; `['Bash']` on the sdk+non-Anthropic default path is verified and is
still the round's highest-severity finding) · `DES-121` (analyzer-owned retry loop — `AgentOpts` has no
`retries` channel; default `0`; the `(1+a)×(1+g)` formula in DEPLOY.md) · `DES-124` (four-pass tokeniser,
exact case-sensitive membership, verbatim return, hostile-input table) · `DES-125` (`projectWorkflowDescribe`
is a *different* projection, not a superset; `lockedKeys` imports `LOCKED_KEYS`; `channels` nullable; **no
`viewerIsOwner`** — QD did not contest it, so it is resolved by silence rather than argument) ·
`DES-126` (all four resolve codes surfaced, `DANGLING_CHANNEL` not collapsed; `ANALYZER_DISABLED` on
regenerate) · `DES-127` B1–B5 (pre-v23 rows, no row for `enabled:false`, `diagramStale` only when `ready`,
per-`(name,version)` single-flight, failed regenerate never destroys a working diagram) · `DES-128`
(`TriggerPorts` with no `secret`/`id` **in the type**; canonical `bindingsFp`; `upstreamWorkflow: null`
first-class) · **§3.1** (there is no `maxWorkflowVersions` prune — the ceiling *refuses*; one deletion
path, `deregister()`'s transaction) · **§4's anti-test rule** (no v23 test computes its expected value
with the function under test) · **§3.3** (the phase-name disclosure is *new*, not pre-existing; A3
authorises it; AUTHORING.md is its sole control).

---

## 10. Remaining disagreements

**D1 — none on the `cwd`.** Recording explicitly that the disagreement both r1 files predicted is
**closed by concession**, so the synthesizer does not carry a phantom conflict into Gate 4.

**D2 — the `gateFail` sub-field (§7).** I propose it partly *on QD's behalf* (their lens needs the
degradation signal; my withdrawn token-store was the wrong way to give it), and it amends ARCH-079's
pinned field list. QD may reasonably reject it as a second channel by another name. **Owner/synthesizer
call**, with the documented fallback in §7.

**D3 — enum size, narrowed to two members.** We converged on 8 of 10. Mine and unaddressed by QD:
`PROVIDER_UNREACHABLE`/`PROVIDER_ERROR` as a split (argued in §2.1), and `NOT_GENERATED` (which is
inseparable from DES-127 B1, so rejecting it means re-opening the backfill question).

**D4 — not a panel disagreement, an escalation neither lens can settle: §3.3.** ADR-015/ARCH-080's
"phase names are already served to non-owners" is **false** (`WorkflowPublicView`, `workflow-view.ts:33-43`,
has no `phases`; `server.ts:1079` calls them masked). `workflow_describe` is the **first** surface to serve
`meta.phases[].title` to a non-owner. The disclosure is owner-authorised by REQ-102/A3 — I am not
claiming a regression — but it was never *escalated*, precisely because the false "pre-existing" premise
made it look free. QD's lens did not touch it. **It needs the owner's confirmation at Gate 4 review**, and
either way the behaviour should be pinned by the secret-in-a-phase-name test case so that overruling it
turns a test red and names the decision, rather than silently changing an allowlist builder.
