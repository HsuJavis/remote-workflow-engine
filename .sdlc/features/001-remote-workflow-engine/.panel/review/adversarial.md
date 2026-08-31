# Gate 8 re-review — Adversarial architecture group (security ⟂ scalability/perf ⟂ testability, Karpathy tie-break)

- **iteration:** v21 (tunable-parameter contract, REQ-090..095 → ARCH-064..070 + ADR-001..008)
- **pass:** **RE-REVIEW after the Gate 8 send-back closeout (IMPL-139).** The prior pass on this file
  covered IMPL-129..138 at `59d1614` and filed F1..F10; `07-review.md` §4 routed F1/F2/F3/QD-3/F8 as
  blocking B1..B5 and dispositioned F4..F10/QD-4 as recorded debt.
- **compared:** `02-architecture.md` (ARCH-064..070, ADR-001..008, ARCH-056, the v21 interface table,
  the v21 decision rationale) vs `06-impl-log.md` IMPL-129..**139** and the files those entries name.
- **scope discipline:** the `files:` of IMPL-129..139 only, plus three module-boundary neighbours they
  directly reference (`src/secret-resolver.ts` `redact()`, `src/submission-validator.ts`,
  `src/default-aliases.ts`). The *new* code surface is exactly two commits — `git diff
  59d1614..HEAD -- src/ tests/` (`5ff0bf2`, `e6077e0`; `59d1614` was docs-only) — read in full. No
  full-tree scan.
- **adjudications honoured as design, not drift:** A-1..A-9, B-1..B-8, C-1..C-2, D-1..D-3
  (`04-design.md`:2724-2948) and the §4 non-blocking debt table. Nothing settled there is
  re-litigated; carried-forward debt is listed at the end and is **not** counted as a violation.
- **verdict:** **NOT consistent — 10 findings (2 HIGH, 4 MEDIUM, 4 LOW).**

---

## Headline

**Three of the five send-back items closed cleanly. One (B1) closed only its narrowest half. One
(B2) closed the reported symptom by introducing a worse primitive than the one it removed.**

Verified closed on disk, not from the log:

| item | claim | verified |
|---|---|---|
| B3 | `redact()` at the `kind:'harness'` decoration site before `appendTranscript` | ✅ `agent-executor.ts:415-422`; both gateways emit only via `onHarness` (`client.ts:330-338`, `claude-agent-sdk-client.ts:583-596`) — no `kind:'harness'` producer reaches `onEvent`/`_emit` |
| B4 | one `isKnownAlias` predicate, passthrough-aware + empty-table-skipping, used at **both** rungs | ✅ `contract.ts:71-75`, used at `:175` (registration) and `:284` (admission); parity with `harness-defaults.ts:70` restored |
| B5 | four stale ARCH lines amended | ✅ nesting-depth bound dropped (`:725`), `composePrompt` 4-arg + wired `mapEffort` named (`:733-734`), `promptTruncated`/`appendPromptBytes` dropped (`:759`,`:761`,`:961`), ARCH-070 note (1) restated (`:779`) — plus DES-104's admission-order line |
| B1 | effective post-merge model alias-checked at submission | ⚠️ **half** — see G2/G3 |
| B2 | resume no longer dispatches the redacted snapshot | ⚠️ **regressed** — see G1/G4/G5/G6 |

Re-affirmed unchanged since `59d1614` (verified by diff, not re-derived): `CallKey` byte-identical
(ADR-002 — zero `CallKey` hunks in the delta), the run-immutable snapshot written once at
`createRun` and never re-persisted (`saveSnapshot` at `run-manager.ts:696` carries
phases/agents/workflowNodes only), the admission rung's insertion point with no existing rung moved,
`additionalProperties:false` on `overrides`, ceilings refuse-never-clamp, `composeConfig()`
forwarding of all three ceiling keys, required `runParams` as the `tsc` lever, `thinkingFor` as sole
writer of `options.thinking`, ADR-006's fence (zero `session-options-builder` importers).

**The through-line of this pass.** The prior review's retro named the defect class exactly: *"the
invariant was implemented where the diagram drew it, and not where the system actually flows."*
IMPL-139 repeated it one level up. B2's fix restores ARCH-066 inv-5 **where the review's sentence
pointed** (the resume dispatch site) by inverting a transform ARCH-056 designed to be one-way —
and the inverse is reachable from caller-controlled text. B1's fix implements **the literal words of
the finding's evidence line** (`overrides.model`) rather than the words of the decision it was filed
against (*"the **effective** (post-merge) model"*, `02-architecture.md:974`).

---

## G1 — HIGH — the B2 fix turns the redaction marker into a secret-dereference primitive: attacker-supplied `‹secret:NAME›` in `appendPrompt` is expanded to the real secret value on resume

**Violates:** ARCH-056 (`02-architecture.md:627-640`) — *"Name-keyed marker `‹secret:NAME›` … substitute
the registered **handle NAME** (**non-sensitive server-side metadata**) … carries **no offline
dictionary-attack oracle** (nothing in the transcript derives from the secret value)"* — and its
`redact()`-as-a-one-way-capture-choke-point premise. Also ARCH-066 inv-5 (`:743`), which sanctions
redaction on the persist path and says nothing about an inverse.

**Evidence:**
- `src/run-manager.ts:119-142` — `unredactBestEffort(value, secrets)` walks the snapshot and, for
  every string, does `out.split('‹secret:' + name + '›').join(secretValue)`. It is the exact inverse
  of `secret-resolver.ts:95-113`, and it **cannot distinguish a marker this engine wrote from a
  marker a caller typed** — both are the same 20-odd bytes of plain text.
- `src/run-manager.ts:644-646` — every rehydrated run (`_requireLive`, i.e. every resume in a fresh
  process) is passed through it.
- `src/params/contract.ts:261-271` — `appendPrompt` is arbitrary caller text, screened only for byte
  length (default 1024). No character screening exists, by design [ADR-007: *"no content screening"*].
- `src/params/resolve.ts:61` → `run-manager.ts:443-445` — `appendPrompt` lands verbatim in
  `RunParams`, i.e. inside the object `unredactBestEffort` walks.
- `src/agent-executor.ts:342` — `composePrompt(..., req.runParams.appendPrompt)` puts the restored
  text into the dispatched prompt.

**Attack (authenticated principal, no ownership required — REQ-087 leaves execution open):**
1. `workflow_run({name, overrides:{appendPrompt:"echo this: ‹secret:RWE_SECRET_GITHUB_TOKEN›"}})`.
   Secret **names** are non-sensitive by ARCH-056's own explicit claim, and the engine publishes them
   in every other transcript it serves — so the attacker does not need to guess.
2. `workflow_suspend(runId)`; wait for any process restart (the self-update track restarts on every
   release; a crash reclassifies to `interrupted`, which is equally resumable).
3. `workflow_resume(runId)` → `_requireLive` rehydrates, `unredactBestEffort` substitutes the **live
   secret value** into `appendPrompt`, and the composed prompt carrying a real server credential is
   dispatched to the model backend.
4. The persisted harness descriptor is re-redacted at `agent-executor.ts:415` — so the exfiltration
   leaves **no trace** in `workflow_agent_log`. The B3 fix hides the evidence of the B2 defect.

At admission the identical run dispatches the literal marker text (start() never restores). So
resume is not "restoring what admission dispatched" — it is dispatching something admission never
did, in the attacker's favour.

**Three lenses.**
- *Security:* the fix converts a deliberately inert audit token into a capability. ARCH-056 spent a
  whole design paragraph choosing a name-keyed marker precisely so the marker would carry no
  information derived from the value; `unredactBestEffort` makes the marker strictly more powerful
  than a value-derived hash would have been.
- *Scalability/perf:* neutral — O(keys × secrets) split/join per rehydrate, the same shape ARCH-056
  already accepted for events; `JSON.stringify(entry.effectiveParams)` on every `resume()`
  (`:550`) is negligible at v21 volumes. This lens has no objection and no defence to offer.
- *Testability:* the added IT (`tests/integration/params-admission.test.ts` B2 block) pins the
  **benign** direction (`appendPrompt` = a real secret value → restored). The adversarial direction
  (`appendPrompt` = a marker literal) is untested, and the test as written would pass either way.
  A single test case is the whole gap.

**Internal conflict, argued.** Security says *refuse*; operability says a run whose `appendPrompt`
legitimately contained a secret value becomes unresumable. Operability loses on evidence: the case
requires a caller to have pasted a *server-side* secret into a *user* override, which the engine
already treats as misuse (ARCH-056's hermeticity contract makes exactly this a documented
non-obligation for the journal sink), and the failure mode is a loud typed `PARAM_SECRET_UNAVAILABLE`
— which the code already implements at `:550`.

**Karpathy tie-break — delete, don't add.** `07-review.md` §4 B2 offered two sanctioned branches
("byte-identical **or** refuses typed"); the implementer built both and shipped the dangerous one as
the primary. Deleting `unredactBestEffort` (24 lines) and letting the `:550` guard stand is *strictly
less code*, closes G1 and G4 together, needs no new mechanism, and the existing B2 test already
accepts that branch (`if (refusal !== undefined) …`). The minimum architecture that solves the
problem is the refusal alone.

---

## G2 — HIGH — B1 checks only the caller-supplied `overrides.model`, never the **effective** post-merge model; the "stale registered defaults" hole the decision was adopted to close is still open

**Violates:** `02-architecture.md:974` — *"**Quality S-1 (stale registered defaults) adopted in reduced
form.** … the **effective** (post-merge) model is checked at submission with the existing alias rule
… the evidence (`submission-validator.ts:106-112` only scans inline `spec.script`, so **a named run
never checks the registered default**) shows a real hole, so it stays"* — and the v21 interface table
`:959` (*"existing `UNKNOWN_ALIAS` for an unresolvable **effective** model — all **before** any
durable work"*).

**Evidence:**
- `src/params/contract.ts:241` — the check lives inside `for (const [key, val] of
  Object.entries(obj))`, a loop over the keys the **caller supplied**. A submission with no
  `overrides.model` never reaches `:284` at all.
- `src/params/contract.ts:284` — and even when supplied, the check is gated on
  `spec.enum === undefined`. An author who declared a `model` enum disables the submission-time
  check entirely; the comment justifies this by pointing at `checkValueAgainstSpec`, which compares
  against the **stored** enum — the very list that goes stale when the alias table changes.
- `src/run-manager.ts:437` runs `validateUserOverrides` **before** `mergeRunParams` at `:443-445`;
  `src/params/resolve.ts:58` shows the effective model is `overrides.model ?? defaults.model`. The
  post-merge value is computed two lines later and never re-examined.
- Registration-time cover does not close it: `harness-defaults.ts` validates `defaults.model` against
  the alias table *as it was at registration*. Staleness — the entire subject of S-1 — is by
  definition a later divergence.

**Consequence (unchanged from the F1/B1 filing):** a named run whose registered default no longer
resolves is admitted, burns a run row + workspace mkdir + sandbox fork + a global semaphore slot
(`ARCH-066`'s "before any durable work" defeated), and every `agent()` returns an opaque `null` at
`gateway/client.ts`. The blast radius is *larger* than the override case B1 fixed, because a stale
default hits **every** submission of that workflow from **every** caller, not one deliberate call.

**Fix shape (one line, same rung, no new mechanism):** move/duplicate the alias assertion onto
`effectiveParams.model` after `mergeRunParams` and before `createRun`. Karpathy-clean: the rung, the
predicate, the error code and the test harness all already exist.

---

## G3 — MEDIUM — the admission check is fed an **empty** alias table on the documented default deployment, while the rule it claims to "reuse" falls back to `DEFAULT_ALIASES`

**Violates:** `02-architecture.md:974` — *"**reuses the existing `UNKNOWN_ALIAS` code**"*. It does not
behave like the existing rule.

**Evidence:**
- `src/server.ts:1191` — `const aliasNames = config?.aliases ? new Set(Object.keys(config.aliases)) : undefined;`
- `src/run-manager.ts:266` — `this._aliasNames = deps.aliasNames ?? new Set();`
- `src/params/contract.ts:72` — `if (aliasNames.size === 0) return true;` → **every** model string
  is accepted.
- The rule being "reused": `src/submission-validator.ts:65` — `this._aliases = deps.aliases ?? DEFAULT_ALIASES;`
- The table actually used at dispatch: `src/run-manager.ts:48,242` —
  `DEFAULT_GATEWAY_CONFIG = { aliases: DEFAULT_ALIASES, … }`, used whenever `config.aliases` is absent.
- `src/main.ts:36-38` documents omitting `aliases` as the normal shape: *"the same anthropic-only
  default the rest of the system falls back to"*; `main.ts:180` likewise uses `aliases ?? DEFAULT_ALIASES`.

So on a stock deployment the engine **knows** the alias table it will dispatch against
(`DEFAULT_ALIASES`) and deliberately hands the new check an empty one, making the entire B1 control
inert exactly where most installs sit. D-AUTH-5-B's "empty table ⇒ skip" is a sound rule for a table
that is *genuinely unknown*; here it is known and one `?? DEFAULT_ALIASES` away.

**Cross-lens conflict, argued.** Scalability/perf has no stake (one `Set.has`). Testability mildly
prefers the injected-`undefined` shape (tests construct servers without an alias table — and indeed
the new B4 test at `harness-defaults-validation.test.ts` depends on the skip). Security says an
enforcement point that is off by default is not an enforcement point. Resolution: they do not
actually conflict — feeding `DEFAULT_ALIASES` keeps the predicate's empty-table branch for genuine
injection-free unit construction, and the B4 test's `whatever-alias` case is a *registration* case
that would then need a real alias name, which is the honest assertion anyway.

**Also here (drift shape, same line):** `server.ts:1141` and `server.ts:1191` compute the identical
`config?.aliases ? new Set(Object.keys(config.aliases)) : undefined` expression twice, ten lines
apart, with a comment at `:1189` claiming to use "the same aliasNames Set the catalog already builds
above". It builds a second one. This is F6's triplication pattern acquiring a fourth instance in the
fix filed to close a drift finding.

---

## G4 — MEDIUM — a rotated secret makes resume dispatch **different bytes** than admission did: silent substitution, the precise thing the restored invariant forbids

**Violates:** the invariant `07-review.md` §4 B2 states as the target — *"resume dispatches
byte-identical params to what admission dispatched, or refuses typed; **never silent
substitution**"* — and ARCH-066 inv-5 as amended in spirit by that send-back.

**Evidence:** `src/run-manager.ts:644-646` restores from `this._secretValueProvider.entries()`, i.e.
the **current** environment (`server.ts:1174-1179`, `loadSecretSourceFromEnv`). The marker names the
secret, not the value. A secret rotated between admission and resume — the normal operational
lifecycle, and `07-review.md` D-1 records that this very deployment has an expired
`RWE_SECRET_GITHUB_TOKEN` awaiting rotation — resolves to a **different** value. The `:550` guard
does not fire (the marker resolved), so the run resumes with silently altered parameters. This is
the same defect class ADR-005 calls *"the exact class v21 repairs"* (silent alteration), reintroduced
inside v21's own fix.

**Subsumed by G1's fix:** deleting the restore and keeping the typed refusal closes G1 and G4 with
one deletion. No separate work item.

---

## G5 — MEDIUM — the `‹secret:…›` marker grammar is now duplicated into `run-manager.ts`, breaking the module boundary that made `secret-resolver.ts` its single owner

**Violates:** ARCH-016 / ARCH-056's *"one chokepoint"* module split (`secret-resolver.ts` is the pure
owner of the redaction vocabulary; `RunManager` receives a `SecretValueProvider` and *"does not read
the secret source directly"*), and ARCH-066's own module scope (`module: src/run-manager.ts`).

**Evidence:** the literal now exists in three places, none of them shared:
- `src/secret-resolver.ts:101` — `‹secret:${name}›` (the only *writer*)
- `src/run-manager.ts:132` — `` `‹secret:${name}›` `` (the new reader/inverter)
- `src/run-manager.ts:550` — `'‹secret:'` (the resume residue guard, a third spelling of the same grammar)

**Failure mode (silent, both directions):** change the marker in `secret-resolver.ts` — a plausible
future edit, since ARCH-056 itself contemplates later stages ("PII scrubbing … slot in after") — and
(a) the restore silently no-ops, so resume starts dispatching markers again, and (b) the `:550`
guard silently stops firing, so nothing catches it. No test pins the grammar across the boundary;
`grep` across `src/` + `tests/` finds no shared constant.

**Testability lens vs simplicity lens, argued.** Testability wants an exported constant (or a
`unredact()` beside `redact()`) so the pair can be property-tested as inverses in one pure module.
Simplicity notes that the cleanest resolution is not to export anything: **delete the inverse** (G1),
and the duplication problem disappears with it — the `:550` guard then needs one exported prefix
constant, which is a strict reduction from three literals to one. Both lenses land on the same
deletion.

---

## G6 — MEDIUM — a new security-relevant mechanism and a new error code shipped with **zero** architecture record

**Violates:** the ledger's own living-document discipline, the precedent B5 was raised to enforce,
and `07-review.md` §7 retro item (3) — *"invariant wording like ARCH-066 inv-5 needs its **read-back**
direction enumerated, not just the write direction"* — which this closeout was the moment to close.

**Evidence:** `grep -c` over the ledger:
- `PARAM_SECRET_UNAVAILABLE` → **0** hits in `02-architecture.md`, **0** in `04-design.md`, **0** in
  `05-tests.md`. It is thrown at `run-manager.ts:551` and is a caller-visible typed error.
- `unredact` → **0** hits in the v21 sections of either doc (the only `02-architecture.md` hit is
  ARCH-056's v14 journal-sink sentence; the two `04-design.md` hits are DES-104's *"never persisted
  raw"* lines, which describe the opposite direction).
- The v21 interface table's `workflow_resume` row (`:960`) still reads *"typed refusal on changed
  overrides"* only — the new refusal condition is absent from the errors column.
- ARCH-066 inv-5 (`:743`) still describes only the write direction. The mechanism that *reverses* it
  lives in the module ARCH-066 owns, undeclared.

B5 amended five ARCH lines for retracted design and missed the one place a *new* mechanism was being
added. From the testability lens this is the load-bearing part: an undocumented inverse of a security
transform is the thing a future reviewer will not know to look for — G1 exists because nobody had to
write down what `unredactBestEffort` is.

---

## G7 — LOW — ARCH-064's `api:` line still declares the pre-B1 error set

**Violates:** `02-architecture.md:724` — `validateUserOverrides(contract, raw: unknown, aliasNames,
ceilings): Ok<UserOverrides> | Err<PARAM_LOCKED|PARAM_OUT_OF_RANGE|PARAM_UNKNOWN>`.

**Evidence:** `src/params/contract.ts:47` — the `Err` union is now
`PARAM_LOCKED | PARAM_OUT_OF_RANGE | PARAM_UNKNOWN | PARAM_CONTRACT_INVALID | UNKNOWN_ALIAS`, and
`:285-290` returns `UNKNOWN_ALIAS` from `validateUserOverrides` itself. The interface table at `:959`
*does* name `UNKNOWN_ALIAS`; the ARCH item's own api line does not.

Exactly the drift class B5 was filed to close, in the ARCH item B1 changed. Mechanical.

---

## G8 — LOW — ARCH-056's sink enumeration still asserts the premise B3 disproved

**Violates:** internal consistency between ARCH-056 and the v21 code it now governs.

**Evidence:** `02-architecture.md:633` still reads *"`kind:'harness'` is **already redacted**
(`redactHarness`, ARCH-044) — **leave it as a separate, unchanged stage**"*. IMPL-139's own note
states the opposite and the code agrees: `redactHarness` (`agent-executor.ts:17-45`) truncates and
redacts nothing, and `agent-executor.ts:415` now runs a real `redact()` on that sink. B5's amendment
list was scoped to ARCH-064/065/068/070 and never reached the ARCH item that carries the original
false sentence — so the enumeration that *defines* sink completeness still tells the next
implementer to leave sink (6) alone.

---

## G9 — LOW — truncate-before-redact leaves partial secret material in the persisted harness descriptor

**Violates:** ARCH-066 inv-5 sink-completeness (`:743`) — residually, not wholesale.

**Evidence:** `src/agent-executor.ts:26-32` (`redactHarness`, called **upstream** by each gateway to
build the descriptor) cuts the prompt to `slice(0,2048) + '…[truncated]…' + slice(-2048)`. The new
`redact()` at `:415` runs **after**, on the already-cut string, and matches by value-exact substring
(`secret-resolver.ts:101`). A secret value straddling either cut is split into two fragments, neither
of which equals the secret, so **both fragments persist** in the served transcript. Prompts over
4096 chars are routine once `defaults.prompt` + script prompt + framed `appendPrompt` compose
(`resolve.ts:131-142`).

**Fix shape:** redact first, truncate second (redaction shortens or lengthens the string but never
reintroduces the value), or run `redact()` on `resolved.prompt` inside `redactHarness`. Either is a
line-order change.

---

## G10 — LOW — the `kind !== 'harness'` redaction-skip guards survive with their justification deleted

**Violates:** the Karpathy minimum-architecture tie-break, and leaves an unenforced-convention bypass
where ARCH-056 promised *"impossible-by-construction rather than … machinery to detect them
afterwards"* (`:668`).

**Evidence:** `src/agent-executor.ts:159` and `:436` still read `ev.kind !== 'harness'` to *skip*
redaction. The rewritten comments (`:156-160`, `:429-433`) now concede the truth — `redactHarness`
"only truncates the prompt; it never redacts secret values" — and rest the guard's safety on a
convention: *"no gateway routes a harness descriptor through this sink"*. That is verified today
(`client.ts:330`, `claude-agent-sdk-client.ts:583`) and enforced by nothing: no type prevents a
third gateway, or a future streaming path, from emitting `kind:'harness'` through `onEvent`.

`redact()` is idempotent by construction — the marker `‹secret:NAME›` contains no secret value, so a
second pass is a no-op — which means DES-088 invariant (a) *"one redaction pass per event"* buys
nothing at these two sites. **Deleting both guards** (redact unconditionally) removes two conditions,
one convention, two paragraphs of comment explaining why the convention holds, and makes the bypass
unrepresentable. Strictly less code for strictly more safety; this is the tie-break's textbook case.
Filed LOW because no live bug exists today — the honesty repair IMPL-139 made was correct as far as
it went.

---

## Checked and clean (spot-verified this pass, not carried on trust)

- **B3 sink closure is real and complete for the enumerated producers.** Both gateway `invoke()`
  implementations construct the descriptor and call `req.onHarness(...)` only; `_invokeOnce`'s
  `onHarness` closure is the single decoration+persist site; `sink.markHarness` (`:408`) carries
  model/provider only.
- **B4 vocabulary parity.** `isKnownAlias` is the single predicate; the `openrouter/<id>` carve-out
  matches `submission-validator.ts`'s REQ-038 precedent; empty-table skip matches
  `harness-defaults.ts:70`. Registration on a default-alias server no longer fail-closes.
- **ADR-002 intact.** No `CallKey` hunk in the delta; `effectiveParams` is written exactly once
  (`createRun`, `sqlite-run-store.ts:82-83`) and never updated; `saveSnapshot` does not touch it, so
  the G1 in-memory restore never reaches a persist sink. Verified specifically because a fix that
  unredacts in memory is one careless write away from re-opening B3.
- **`workflow_status` / `GET /api/runs/:id` do not surface `effectiveParams`** — the restored
  unredacted snapshot has no HTTP read path (checked: `grep effectiveParams src/` shows no
  `RunStatusView` field). The unauthenticated `/api/*` surface is not a G1 amplifier.
- **`composeConfig()` forwards `aliases`** (`main.ts:88,100`) — the composeConfig bug class is not
  the cause of G3; the empty-Set default is a deliberate choice, which is why it is filed as a
  decision deviation rather than a wiring miss.
- **Scalability/perf:** nothing in the delta changes state storage, concurrency or failure-counting
  semantics. `unredactBestEffort` is O(fields × secrets) once per rehydrate and
  `JSON.stringify(effectiveParams)` once per `resume()` — both negligible, and the deployment view's
  single-process assumption (`:917`) is unchanged. This lens files **zero** findings this pass and
  contributes only the observation under G3 below.
- **Cross-lens observation worth recording:** ADR-008 declined rejection telemetry, so G2/G3's
  inertness is **operationally undetectable** — a check that never fires and a check that fires
  correctly are indistinguishable from outside the process. That was an acceptable residual when the
  check was believed wired; it is what let B1 ship half-closed twice. Not re-litigating ADR-008
  (Karpathy: no metrics subsystem for two codes), but the Gate 7.5 assertion for G2's fix must be a
  *negative* one (an unresolvable effective model is refused with zero durable work), not a positive
  smoke test.

## Carried forward from the prior pass — recorded debt, NOT counted as violations

Dispositioned in `07-review.md` §4's non-blocking table; re-verified as unchanged at `HEAD`:
**F4** (nested `workflow()` frames run under the parent's snapshot — deferred to v22 by design, must
enter the v22 Gate 1/2 intake); **F5/QD-2** (`resolve.ts:150` `mapEffort` still has zero production
callers — `grep` confirms both gateways import `client.ts`'s; the ARCH sentence was correctly
amended by B5, so the doc no longer lies, the code duplicate remains); **F6** (`DEFAULT_CEILINGS`
triplicated at `run-manager.ts:110` / `mcp-facade.ts:20` / `server.ts:1183-1187` — see G3 for the
fourth instance of the pattern); **F7** (`workflowLabel()` non-injective); **F9** (`ParamSpec` not
normalized at parse); **F10** (author/script effort rung unvalidated); **QD-4** (`gateway →
agent-executor` reverse edge for `redactHarness`).

---

## Verdict

**NOT consistent — 10 violations (2 HIGH, 4 MEDIUM, 4 LOW).**

**Minimum path to consistent, in dependency order:**
1. **Delete `unredactBestEffort`** (`run-manager.ts:119-142` + `:644-646`); keep the `:550` typed
   refusal, hoisting the marker prefix to an exported constant in `secret-resolver.ts`. Closes G1,
   G4, G5 with a net deletion. Add the one adversarial test case (`appendPrompt` containing a marker
   literal → resume must not produce the secret value).
2. **Check the effective post-merge model** at the same rung, after `mergeRunParams`, before
   `createRun`, ungated by `spec.enum`; feed the check `config?.aliases ?? DEFAULT_ALIASES` and hoist
   `server.ts`'s duplicated Set expression. Closes G2, G3.
3. **Amend the docs the fixes changed the meaning of**: ARCH-066 inv-5's read-back direction +
   the new refusal in the interface table (G6), ARCH-064's api error set (G7), ARCH-056's sink-(6)
   sentence (G8).
4. **Two line-order/deletion cleanups**: redact-before-truncate (G9), drop the two
   `kind !== 'harness'` skips (G10).

Steps 1, 2 and 4 together are a **net reduction** in source lines. That is the tie-break's own
signal that this iteration's remaining gap is not missing machinery — it is machinery that should
not have been added.
