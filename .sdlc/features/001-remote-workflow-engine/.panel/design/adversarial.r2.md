# Design panel — Adversarial group (r2, debate)

**Stage:** Detailed Design (Gate 3/4 merged), iteration **v3** — ARCH-015..019 / REQ-016..021, plus D-DOS / D-BIND / D-PROC.
**Lenses (traded off explicitly):** (a) Interface-contract; (b) Boundary/error; (c) Testability. **Tie-break:** Karpathy simplicity-first.
**Round:** 2 — I read `adversarial.r1.md` (mine), `quality-dimensions.r1.md` (v3 refresh, my sparring partner), and the superseded `quality-dimensions.v2.r1.md` for context. For every cross-lens point below I state **rebut / concede / hold** with an engineering reason and integrate where I can.

## Headline
This is a **high-convergence** round. My boundary/error lens and the quality lens independently landed on the *same* structural spine for v3 — pure builder as master seam, capture-time `redact`, single idempotent slot release, one `ReasonCode` union, `realpath`-then-ancestor-walk workRoot guard, fail-safe ProviderProfile. Almost nothing is genuinely disputed. The round's real work is **three integrations** (I move toward them) and **one held item** (I hold, but narrow it to a decidable form):

- **Integrate S-2 (process-group / grandchild reap):** I **concede** the threat and **sharpen the mechanism** — the SDK owns the CLI spawn; `Options.abortController` is our *only* handle (verified in code), so a naive `process.kill(-pgid)` is not available to us. This changes my Risk R1 and needs one empirical check.
- **Integrate O-3 / O-4 / O-7 (aborted state, semaphore gauge, partial-token attribution):** I **endorse** — they make my #1 release invariant *observable and testable*, which is exactly what my boundary lens could not supply on its own.
- **Integrate C-1 (one `ReasonCode` union):** I **concede** the single-owner union and reconcile it with my C2 by annotating each code's *axis* (boot / submission / run) rather than forking the enum.
- **Hold #3 (session-init re-walk):** I **hold**, but reframe it as serving *their* self-sustainability lens (a runtime-reopened silent leak is their canonical nightmare, not scope creep) and gate it on **one empirical repro** so the synthesizer decides on evidence, not faith.

---

## Point-by-point responses to quality-dimensions.r1

### CONVERGED already in r1 (no action, recording for the synthesizer)
- **Pure builder purity as a stated invariant + determinism UT** (their R-5, my IC-lens). Identical asks. **Concede/merge** — one shared invariant: builder imports no `fs`/`net`/`process`; a frozen-input determinism UT enforces it in CI, not review convention.
- **Capture-time `redact(event, secretValues)` at the `AgentTranscriptSink` boundary; handle-names-only records** (their O-8, my #2). Independently identical, including "not redundant with the ARCH-016 filesystem callback — both needed." **Concede/merge.**
- **Atomic secret resolution** (my #7) and **`SecretResolver` synchronous over a pre-loaded map** (their R-1). Compatible and reinforcing: resolution is a pure, synchronous, all-or-nothing `resolveConfig(config, sourceMap)`; the env/`LoadCredential` load is a separate startup step. **Concede/merge.** An async resolver signature is banned by both lenses (it invites a vault call into the hot session-build).
- **`realpath` before the ancestor walk** (my #5). Their S-4 already specifies `realpath(workRoot)` then walk. The *realized* code still does `let dir = resolve(workRoot)` (`src/workroot-guard.ts`) — so the ask stands as a fix, but the lenses agree on it. **Converged.**
- **Discovery endpoints stay cut until auth** (my D-REDACT line, their "vs consumability-maximalists"). Quality explicitly holds the line "even though it is my dimension being curtailed." **Converged** — clear typed errors to the trusted-behind-tunnel caller, no `secret_list`/`mcp_list` enumeration on the no-auth listener until REQ-012.
- **`mcp_provision` gets a real JSON schema day one** (their C-4). Endorse; it also carries my IC-lens ask that the tool's admin-only precondition be stated in-contract (see R10 below).
- **No background re-probe; provision-time + optional submission-time only** (their S-5/S-7, D-PROBE). Endorse — matches my boundary line that runtime-dead MCP is a `FailureEnvelope{kind:tool_error}`, not a new poller.

### INTEGRATE — I move toward their finding

**S-2 (process-group kill / stdio-MCP grandchild reap) — CONCEDE the threat, SHARPEN the mechanism.**
Their finding is correct and it is *my own orphan threat model one level down*: the SDK CLI subprocess spawns N stdio-MCP children per session; killing only the CLI orphans those grandchildren, recreating the D-PROC orphan-litellm pathology at higher volume under the v3 scheduler. I had under-specified this in r1 (I only said "abort the CLI child via `abortController`"). **Concede.**

But the mechanism they propose — "spawn the CLI `detached:true`, `process.kill(-pgid, SIGTERM)`" — **is not available to us as written**, and this is a load-bearing boundary correction: the **SDK owns the CLI spawn**. In `claude-agent-sdk-client.ts` the *only* cancellation handle we hold is `Options.abortController` (`abortController: controller`, line ~400; the timer/external-abort wiring at 324-326). We never call `child_process.spawn` for the CLI ourselves, so we cannot pass `detached:true` and we have no pgid to signal. **Sharpened design requirement:**
1. **Empirically determine** (one real check, cheap) whether `abortController.abort()` causes the SDK's CLI to reap its own stdio-MCP children. If yes, the threat is already handled by the SDK and the design records that as a *verified precondition* (not an assumption).
2. **If not**, the process-group kill must sit at the *one process boundary we own*. Options, cheapest first: (a) confirm the SDK exposes a spawn/executable seam we can wrap to inject `detached:true`; (b) failing that, a bounded post-abort reap that finds and SIGKILLs surviving children of the CLI pid after a grace period. This is D-PROC's SIGTERM→SIGKILL escalation applied to the SDK's child tree, **owned in-process, restart still on systemd** — it does *not* cross the line into a watchdog subsystem.
This is strictly more correct than r1 and I fold it into R1's teardown `finally`: the same single release site that frees the slot must also ensure the child tree is reaped, or the slot-free is a lie (freed slot, live grandchildren still burning tokens/ports).

**O-3 / O-4 / O-7 (aborted terminal state, semaphore gauge, partial-token attribution) — ENDORSE; they make my #1 testable.**
My r1's single highest risk (R1: slot free-exactly-once on the kill path) is a *boundary* claim my lens could assert but not *observe*. Their three observability asks are exactly the instrumentation that turns it into a passing/failing test:
- **`semaphoreGauge {total,inUse,queued}` (O-4)** is the assertion target for "count returns to baseline after a timeout-kill" — without it, a missed release is the textbook silent hang. **Endorse.** It rides an existing status response, so it is not speculative metrics; it is the *only* observable for the new global resource D-DOS mints.
- **`aborted` state + `PROVIDER_TIMEOUT → failed` transition (O-3)** — with D-KILL making kill a *designed, frequent* path under the scheduler, a phantom `running` record is no longer cosmetic; it is REQ-020's "bound observably applied" being unverifiable. 1 enum value + 2 transitions. **Endorse.**
- **Partial-token attribution on kill (O-7)** — already in my C3 lifecycle list ("attribute partial tokens"). **Endorse/merge**: usage deltas stream before final settlement so a killed attempt's spend still posts. Closes "REQ-020 passes while budget silently rots."

**C-1 (single `ReasonCode` union, one owner) — CONCEDE, reconciled with my C2.**
My r1 C2 worried a per-mode public code would bloat the client enum. Their C-1 (one exported union in one module, contract-tested, consumed by ARCH-008 / ARCH-017 / ARCH-001) does *not* conflict with that — it prevents *three copies* of the enum, which is a strictly better position than mine. **Concede the single owner.** Reconciliation on my one residual concern (I argued `WORKROOT_INSIDE_PROJECT` is boot-only, not a per-run client code; they list it in the union): **one union type, but each member annotated by its axis** — boot/entrypoint (`WORKROOT_INSIDE_PROJECT`, `CONFIG_SCHEMA_ERROR`), submission (`MCP_NOT_PROVISIONED`, `SECRET_MISSING`, `SECRET_HANDLE_INVALID`, `ALIAS_PROFILE_MISSING`), run (`PROVIDER_TIMEOUT`, `HOOKS_UNSUPPORTED`, `MCP_PROBE_FAILED`). The type is single-owner; the *invariant* that a boot code never appears in a per-run `ResultEnvelope` is a contract test over the axis annotation. This gives them their one-owner union and gives my boundary lens its "boot errors never reach a workflow caller" guarantee — no fork.

**R-4 additions (ajv boot-validation of ProviderProfile → `CONFIG_SCHEMA_ERROR`; cut `supportsToolUse`) — CONCEDE both.**
- Boot-validating the profile table with ajv (already in-tree) and failing boot with a clear `CONFIG_SCHEMA_ERROR` on a typo'd field is a strict improvement on my "single source of truth" ask — it makes the source of truth *fail-loud*. **Concede/merge**; add `CONFIG_SCHEMA_ERROR` to the union (boot axis).
- **`supportsToolUse`: concede the cut.** I listed it in r1's field set; they correctly note the curated allowlist applies regardless of provider class, so no consumer reads it. Karpathy: a field with no consumer is speculative flexibility. **Cut it** — unless ARCH-008 wants it purely to emit a submission-time *warning* ("alias profiled non-tool-use but workflow uses tools"); that is a nice-to-have, not a blocker, so default to cutting and re-add only if that warning is actually specified. Final field set: `{supportsExtendedThinking, timeoutMs, retries, effortMapping}`.

**O-1 SessionInitRecord fields — CONCEDE their field set, ADD two for REQ-021 auditability.**
Their `{resolvedAlias→provider+modelId, thinkingMode, allowedToolNames, injectedMcpNames, secretHandleNames (names, NEVER values), cwd, timestamp}` is exactly my r1 "record the decision, never the secret." **Concede/merge.** My one addition, which *their* lens should welcome because it makes REQ-021 confinement auditable from the store: add **`settingSources: string[]`** and **`resolvedProjectRoot: string | null`** (the marker-ancestor decision, or null when clean). Then the fact that the CLI was rooted at the run workspace with `['project']` and *no* higher project root is a stored, queryable fact — not a live-only inference. Persist it as the first line of `agent-<id>.jsonl` via the existing sink (their O-1 mechanism). No new file kind.

### HOLD — I hold, narrowed to a decidable form

**#3 (session-init project-marker re-walk) — HOLD, reframed as their lens, gated on one repro.**
This is the one place I anticipated being read as scope creep against D-WORKROOT's "one boot check + a cwd invariant, no new subsystem." I hold, on three grounds:
1. **It is not a subsystem.** It is the *same pure predicate* (`findProjectMarkerAncestor(path, existsImpl, realpathImpl) → string|null`, the refactor underneath `assertWorkRootIsolated`) called at a *second site* — session-build, walking from the run-workspace `cwd` up to (excluding) `workRoot`. Zero new runtime machinery; one function reused. That is the opposite of the OS-jail I already conceded stays cut (D-SEC).
2. **It is quality-dim's own nightmare, not mine alone.** The realized code sets `cwd: req.workspace` with `settingSources: ['project']` (line ~357/391) and re-runs *no* isolation check. An agent processing untrusted data writes `./CLAUDE.md` or a `.git` dir into its run workspace; the *next* `agent()` in the same run is spawned with `cwd` there and the CLI loads the agent-authored marker into agent B's context — the exact REQ-021 leak, at session-init, *below every tool-call jail*, re-opened after boot. A boot-only guard that is true only at one instant against a runtime-mutable tree is precisely the "silent systemic failure nobody sees until too late" their self-sustainability lens exists to catch. Framed that way this is *convergent*, not adversarial-vs-quality.
3. **I gate it on evidence, not faith.** REQ-021 itself was found empirically; this variant deserves the same. **Decidable form for the synthesizer:** run one real repro — an agent writes `CLAUDE.md` into its run workspace, a second same-run `agent()` is spawned, assert whether the CLI loads it. If it loads → the re-walk ships (MED-HIGH, one function, one call site). If the CLI does *not* load a marker at/inside `cwd` (only strictly-above) → the boot check already covers it and #3 is dropped. Either way the decision is made on a repro, and the fix if needed is one predicate at one call site.
**Cross-run persistence** is separately blocked *iff* ARCH-016 confinement truly prevents an agent writing above its run workspace into the shared per-workflow work folder (REQ-013 roots agent I/O at the run workspace, so it should hold) — the design must state that as the load-bearing precondition; if the per-workflow folder is writable by runs, R3 escalates to HIGH (cross-run leak).

**#8 (`settingSources` never widens past `['project']`) — HOLD, one-line regression UT.**
The realized `settingSources: req.workspace !== undefined ? ['project'] : []` is the *only* thing keeping the operator's global `~/.claude/CLAUDE.md` out of every agent's context, and the workRoot guard *cannot* catch a global-memory leak (it only walks the project ancestry). It is enforced by a ternary, not a test. **Hold:** a regression UT asserting the built `SDKOptions.settingSources` never contains `'user'`/`'local'` on any path. LOW severity today, one-line invariant guarding a whole leak class. Quality-dim did not object; this is uncontested, recorded so the synthesizer doesn't drop it as "obvious."

### Reconciled internal tension inside their doc (a small contribution)
Their S-4 says the guard "must not short-circuit on non-existent dirs (a path that doesn't exist yet should not bypass the check)"; their "vs adversarial (d)" says "a newly provisioned server should be able to boot before the workRoot dir is created, with a warning rather than a hard fail on a non-existent path." These are in mild tension. **Resolution I offer:** the `realpath`-then-ancestor-walk checks *existing ancestors* even when `workRoot` itself does not yet exist — walk up from the resolved (canonicalized as far as it resolves) path; every ancestor that exists is checked for `.git`/`CLAUDE.md`. Non-existence of `workRoot` itself → no marker found on existing ancestors → **warn + proceed** (their disagreement-(d) position). Non-existence must **not** early-return and bypass the ancestor check (their S-4 position). Both satisfied: existence is not a precondition of the walk; a *marker on an existing ancestor* is the only fail condition. I do **not** ask for fail-on-missing-dir (I never did — that was their (d) mis-attribution to me).

---

## My final position (v3 design contracts, integrated)

**Interface-contract**
- Pure builder `(providerClass, alias, config, provisionedRefs, resolvedSecrets) → SDKOptions`; no `fs`/`net`/`process`; determinism UT. `GatewayClient.invoke(prompt,opts)` frozen — no SDK-specific field leaks up into ARCH-004.
- `resolveConfig(config, sourceMap) → resolvedConfig` pure/synchronous/atomic; typed `SECRET_MISSING`/`SECRET_HANDLE_INVALID`.
- One `ProviderProfile` table, ajv-boot-validated (`CONFIG_SCHEMA_ERROR`), single-sourced with the ARCH-008 validator. Fields `{supportsExtendedThinking, timeoutMs, retries, effortMapping}` (`supportsToolUse` cut). Unprofiled alias → fail-safe `supportsExtendedThinking:false` + submission-time `ALIAS_PROFILE_MISSING`.
- One exported `ReasonCode` union, one owner, contract-tested, **members annotated by axis** (boot/submission/run); invariant test that a boot code never appears in a per-run `ResultEnvelope`.
- `findProjectMarkerAncestor(path, existsImpl, realpathImpl) → string|null` extracted as the pure predicate; `assertWorkRootIsolated` is the throwing boot wrapper over it. `mcp_provision` states its admin-only precondition in-contract and refuses when `bind != loopback` even under `insecureNoAuth`.
- `SessionInitRecord` = their O-1 fields **+ `settingSources` + `resolvedProjectRoot`**, handle-names-only, persisted as the head of `agent-<id>.jsonl`.

**Boundary/error**
- **R1 (HIGH):** single idempotent slot-release site keyed to race outcome, in one `finally`, covering success / schema-retry-exhausted / provider-error / timeout-abort / stop / suspend — *and* teardown of the timer + external-abort listener in the same `finally` *and* reap of the CLI child tree (S-2, mechanism sharpened above). Gauge (O-4) is the count-returns-to-baseline assertion.
- Capture-time `redact`; secrets never in transcript/init-record; both the redact choke point and the ARCH-016 filesystem callback (neither substitutes).
- `realpath` before the ancestor walk (fix the realized `resolve`); `isLoopback(bind)` predicate over `127.0.0.0/8` + `::1`, not string equality.
- `WORKROOT_INSIDE_PROJECT` boot fail-closed, naming the offending ancestor + remedy (already realized).
- **#3 (MED-HIGH, gated on one repro):** session-init re-walk from run-workspace `cwd` up to `workRoot`, same predicate; state the ARCH-016 cross-run precondition.
- **#8 (LOW):** `settingSources` never `'user'`/`'local'` — regression UT.

**Testability**
- Timeout rides the injected Clock (DES-016); kill routes through the injected spawn/abort seam, asserted once. `McpProbe` injected into `mcp_provision`. The semaphore is **one instance built at the composition root, passed by reference** — never a module `static`; UT builds max=1 and asserts the gauge returns to 0 on every exit branch (success/timeout-kill/stop/suspend). ARCH-019 truth table (marker at workRoot / mid-ancestor / `.git`-as-file vs dir / clean-to-root no-false-positive / `~/.claude`-alone-does-not-trip / symlink-into-project trips only with `realpath`). `#3`/`#8` are pure UTs over the predicate and the built `SDKOptions` — no live model.

**Task-split (feeds 03-tasks, unchanged from r1 + S-2 folded into the impure half):** ARCH-017 → (a) pure builder + profile + validator + `#3` re-check + `#8` invariant; (b) impure timeout-race + abort + **child-tree reap** + slot-free-exactly-once + timer/listener teardown over injected clock/spawn/semaphore/gauge; (c) one real Ollama `tool_use` round-trip. ARCH-015/016/019 and D-DOS/D-BIND/D-PROC as in r1 (each amendment its own task + test).

---

## Remaining disagreements (post-round-2)

1. **#3 session-init re-walk — narrowed, not closed.** Quality-dim may still read it as beyond D-WORKROOT's sanctioned minimum. I hold, but I have (a) reframed it as serving *their* lens and (b) reduced it to a coin-flip on one empirical repro. If the repro shows the CLI loads an at-`cwd` marker, I expect convergence; if not, I drop it. This is the only item where the synthesizer must actually arbitrate, and I have made it arbitrable on evidence rather than principle.
2. **S-2 mechanism.** We agree grandchildren must not orphan. We may still differ on *how*: they wrote `process.kill(-pgid)`; I showed we don't own the spawn, so it is either "SDK already reaps (verify)" or "wrap the one boundary we own." This is a mechanism refinement, not a values disagreement — it resolves as soon as the empirical SDK-reap check is run.
3. **`supportsToolUse`** — I conceded the cut; the only residual is whether ARCH-008 wants it for a submission warning. Trivial, synthesizer's call.

## Internal conflicts within my own group (updated for r2)
- **C1 (contract ⟂ testability, global semaphore):** resolved r1 — one composition-root instance, passed by reference. Unchanged.
- **C2 (boundary ⟂ contract, reason-code granularity):** now resolved *with* quality-dim's C-1 — one union, axis-annotated members, small client-facing surface. Upgraded from "my internal resolution" to "cross-lens agreed."
- **C3 (boundary ⟂ simplicity, kill lifecycle) — GREW this round.** Conceding S-2 (child-tree reap) enlarges the teardown surface: interface-contract wants the spawn/abort seam to stay a thin injected function; boundary wants full reap (abort + slot-free + timer/listener teardown + child-tree kill + partial-token post + temp-dir rm); testability needs the injected spawn to *model a child tree* so the reap is UT-able without real grandchildren. **Karpathy resolution:** all of it is still "one agent's own resources" (in-process), not "the process" (supervisor) — the line D-PROC drew holds; the reap is incurred debt (an orphan burns tokens/ports/a slot), not speculative flexibility. The injected spawn seam models a fake child tree; the reap is asserted against it. Restart/self-heal stays on systemd.
- **C4 (testability ⟂ contract, redaction):** resolved r1 and now cross-lens agreed (O-8) — pure `redact(event, secretValues)` in the tap.
- **C5 (boundary ⟂ Karpathy, ARCH-019 second call site):** unchanged stance, now expressed as the gated repro (see Remaining #1). Boot check is correctly minimal for the empirically-reproduced primary case; the re-walk is the same predicate at a second site, shipped only if the repro shows the runtime leak is real.
