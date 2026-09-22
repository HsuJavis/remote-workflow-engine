# Gate 8 review — Adversarial architecture group (security / scalability / testability, Karpathy tie-break)

**Iteration:** v37 (REQ-218 Bash confinement posture C, REQ-219 dead-security-module cleanup)
**Compared:** `02-architecture.md` ARCH-175..181 + ADR-082..085 + INV-V37-1..3 (including every dated
Gate-4/Gate-6 amendment in place) **against** the code named on `06-impl-log.md`'s IMPL-371..379
`files:` lines, plus the modules those files touch at a module boundary
(`webhook-registry.ts`, `scheduler.ts`, `workflow-catalog.ts`, `asset-sync.ts`, `net-guard.ts`).
**Verdict:** `consistent: no` — **8 findings** (2 HIGH, 3 MED, 3 LOW).

Two of the three lens headings in this group's charter have no purchase on this slice and are
reported as such rather than invented: there is **no authn/authz change, no credential verification
loop, no token issuance and no failure counter** in v37's diff, so *brute force / JWT forgery /
timing attacks / concurrency of failure counting* are **N/A this iteration**. The security lens
lands entirely on attack surface and secret protection; the scalability lens lands on one boot-time
`spawnSync` and on the concurrency argument ARCH-175 already made for itself; the testability lens
lands on one missing wiring lock. The lens conflicts that are real are stated at the end, not
smoothed over.

---

## A1 — HIGH — the remote-submission door is bypassed by webhook and scheduler run admission

**Violates:** ARCH-181 (note: *"both are the only two tool calls that admit NEW Bash-capable
`agent()` work into the engine"*), ADR-083 `owner_decision` reason (1)
(*「(C) 擋的位置與事故發生的位置重合」*), INV-V37-1 (as it survives under posture C).

**Evidence**

- `src/call-tool.ts:120` — the door is `if ((spec.name === 'run_start' || spec.name === 'run_resume')
  && deps.confinementPosture === 'unconfined' && deps.isRemoteSubmission === true)`. It lives
  **inside `callTool()`**, so it can only see work that arrives as an MCP `tools/call`.
- `src/webhook-registry.ts:305` — `const runId = await this._runManager.start({ name: row.workflow,
  args: { event: req.parsedBody }, startedBy: { type: 'webhook', id } });` — reached from
  `src/server.ts:1453-1472` (`POST /hooks/:id` → `webhooks.deliver(...)`), a route that never calls
  `callTool` and for which `isRemoteSubmission` (computed at `src/server.ts:1168`) is never read.
- `src/scheduler.ts:363` — `const runId = await this._runManager.start({ name: workflow, args,
  startedBy: { type: 'schedule', id: workflow } });` — fired by the engine's own ticker, same bypass.
- The tools that *create* those triggers are themselves ungated: `webhook_create`,
  `schedule_create` and `workflow_register` are not in the door's name list (`src/call-tool.ts:120`),
  and the only refusals they carry are the v24 `workflow`-argument doors at `src/call-tool.ts:176`.

**Attack path, end to end, under the posture this host actually measures (`unconfined`):** a remote
caller does `workflow_register({name, script, mermaid, triggers:[id]})` (allowed), `webhook_create`
(allowed), then `POST /hooks/<id>` with a valid HMAC (allowed, and *not* a `tools/call`). A run
starts, `agent()` dispatches, `options.sandbox = { enabled:false }`
(`src/gateway/claude-agent-sdk-client.ts:743-753`), and Bash writes `$HOME` — the exact 2026-09-20
incident ADR-083's ruling says (C) was chosen to intercept. The door refuses the *front* door only.

**Why this is an architecture deviation and not a scope call:** ARCH-181's own justification for
gating exactly two names is a factual claim about run admission ("the only two tool calls that admit
NEW Bash-capable `agent()` work"), and that claim is false for the engine as built. Recursive census
(`grep -rn "runManager\.start(\|_runManager\.start(\|\.start({ name" src/`) — **four** run-admission
call sites, only one of which is the tool path: `src/mcp-facade.ts:710` (the `run_start` door's own
target), `src/webhook-registry.ts:305`, `src/scheduler.ts:363`, and a second scheduler dispatch at
`src/server.ts:1015`. Either the claim or the door is wrong; the ledger currently ships both.

**Simplest fix consistent with the slice's own minimalism:** the check belongs at the one place all
four admissions converge — `RunManager.start()` — keyed on an explicit `startedBy`-derived
remoteness, rather than duplicated at four ingresses. `startedBy: {type:'webhook'|'schedule'|…}` is
already threaded (`webhook-registry.ts:305`, `scheduler.ts:363`), so the signal exists.

---

## A2 — HIGH — ARCH-177's `protectedFiles` / `denyRead` silently evaporate on the documented default deployment

**Violates:** ARCH-177 (`protectedFiles = [resolve(RWE_CONFIG_PATH ?? 'rwe.config.json'),
join(workRoot,'auth-tokens.db')]`, "resolved once at the composition root"), the ARCH-007 catalog
row's own v37 amendment (*"REQ-018's invariant gains its first **enforced** expression"*), REQ-218
風險面 item 1, and — as a side effect — ARCH-180/DES-257's brand-new REQ-021 re-walk.

**Evidence**

- `src/main.ts:252` computes the list unconditionally:
  `const protectedFiles = [deps.configPath, workRoot ? join(workRoot,'auth-tokens.db') : undefined].filter(isNonEmptyString);`
  — so `deps.configPath` is known even when `workRoot` is not.
- `src/main.ts:439` forwards it **all-or-nothing**:
  `...(workRoot ? { confinement: { allowHostPaths: resolvedGrants, protectedFiles, workRoot } } : {})`.
- The shape that forced this is a type: `src/gateway/claude-agent-sdk-client.ts:120` declares
  `confinement?: { allowHostPaths: readonly string[]; protectedFiles: readonly string[]; workRoot: string }`
  — `workRoot` is **non-optional**, so an unknown `workRoot` cannot carry a known `protectedFiles`.
- Consequence at the builder: `src/gateway/claude-agent-sdk-client.ts:747-750` passes
  `protectedFiles: []`, `workRoot: undefined`; `src/gateway/bash-confinement.ts:53-56` then yields
  `denyRead: []` and `:69` yields `credentials.files: []`. `denyWrite` keeps only the workspace's own
  `.claude/settings*.json` (`:66`).
- This is a **supported** boot, not a misconfiguration: `DEPLOY.md:521` lists `workRoot` as
  必須 = 否 with 「系統暫存目錄自動建立」, and `src/server.ts:655` implements that default
  (`config?.workRoot ?? mkdtempSync(join(tmpdir(),'rwe-'))`).

**Net effect:** on a host where the probe measures `confined` — the arm this whole iteration exists
to build — an operator who never set `workRoot` gets a sandbox that confines writes but leaves
`rwe.config.json` (REQ-218 名指的 Google client secret) and `auth-tokens.db` fully readable by the
agent's Bash. The control the architecture describes as REQ-018's *first enforced expression* is not
enforced at all on the default config, and nothing at boot says so.

**Why HIGH despite being latent today:** on every host this ledger has measured, the `confined` arm
cannot execute at all (A4; `08-validation.md:12358-12364`), so this hole is currently dormant. It is
rated HIGH because ADR-083's own 升級路徑 arms it without review — *「上游 CLI 不再需要巢狀 userns、
或業主決定改政策時,翻回 (A) 的完整監牢,**不需重新辯論**」*. The ledger explicitly expects the
posture to flip with no further gate, and the flip is a one-line probe outcome on a host the
operator never touches. A defect that ships pre-installed behind a deliberately re-review-free
switch is worth fixing while the switch is still off; two lines in `main.ts` close it now, versus a
silent secret exposure the day a CLI upgrade makes nested userns work.

**Second casualty, same line:** `src/gateway/claude-agent-sdk-client.ts:705` gates the
intra-run re-walk on `this._config.confinement?.workRoot !== undefined`. Because the `confinement`
block is the only carrier of `workRoot`, the REQ-021 re-walk that IMPL-377 just created — the rider
that ARCH-180/ADR-085 say is the whole reason 「delete」 was the right ending — is **inert on the same
default deployment**. The code comment at `:702-704` calls this "DES-257's sixth arm" (skip, neither
fail-open nor fail-closed), which is defensible for an unknowable `workRoot`; it is not defensible
that `workRoot` is *knowable* (server.ts computes it) and simply never reaches the gateway.

**Fix shape:** make `confinement.workRoot` optional and forward `protectedFiles` unconditionally, or
resolve the tmpdir default in `composeConfig()` so hop 2 always carries a real `workRoot`. The second
is smaller and removes the divergence between what `main.ts` knows and what `server.ts` computes.

---

## A3 — MED — `ENGINE_STATE_DENY` is a hand-maintained enumeration that is already stale and blind to operator path overrides

**Violates:** ARCH-175's own stated rationale (*"an enumerated sibling list is stale before it is
used"* — the argument that justified `denyRead` naming an ancestor rather than a list), INV-V37-1's
spirit, REQ-218 風險面 items 2/3.

**Evidence**

- `src/gateway/bash-confinement.ts:25-27`:
  `ENGINE_STATE_DENY = ['store','catalog.db','auth-tokens.db','cas','assets','webhooks.db','continuations.db','schedules.db']`,
  applied as `ENGINE_STATE_DENY.map((p) => join(workRoot, p))` (`:56`).
- Engine state that lives under `workRoot` and is **not** in the list:
  - `mcp-registry.db` — `src/workflow-catalog.ts:398` (`join(this._workRoot,'mcp-registry.db')`)
  - `self-update.db` — `src/server.ts:672` (`join(workRoot,'self-update.db')`)
  - `_global_assets` — `src/asset-sync.ts:145` (`join(workRoot,'_global_assets')`) — the global
    skill/MCP asset tree, deliberately outside the GC-scanned `assets/` the list *does* cover
- Worse than staleness: the list is built from `join(workRoot, <literal>)` and therefore **ignores
  every operator override of those same paths**, all of which `DEPLOY.md` documents as supported
  (`src/server.ts:105-154`): `casDir` (DEPLOY.md:550), `webhookDbPath` (:549), `schedulerDbPath`
  (:532), `continuationDbPath` (:548), `assetRoot` (:533), `selfUpdateDbPath` (:553). An operator who
  relocates `webhooks.db` — which DEPLOY.md:549 states stores HMAC secrets **明文** — silently drops
  it out of `denyRead` with no boot warning and no test failure.
- No test ties the constant to the real set — verified: `grep -rn "ENGINE_STATE_DENY" tests/`
  returns exactly two hits, both in `tests/unit/bash-confinement.test.ts` (`:13` the import, `:30`
  `expect(s.filesystem?.denyRead).toEqual([...ENGINE_STATE_DENY.map((p) => join(WORKROOT, p)),
  ...PROTECTED])`). That assertion is **tautological against the constant** — it re-derives the
  expected value from the same list the SUT reads, so it can never fail for an omitted path and
  never sees `server.ts`'s own path computation at all.

**Honest framing (this is where the lens must not overclaim):** the implementation reproduces
ARCH-175's Gate-4 correction *faithfully* — the architecture text names the same eight paths. So
architecture and implementation **agree**, on a list neither of them verified against the tree. That
makes it an architecture-quality defect the review stage is the right place to catch, not an
implementer deviation. Cross-run *workspace* reads (`workflows/`, `_runs/`) remain the **named
residual** ARCH-175 already accepted — including the `_runs/<runId>` workspace fallback
(`src/workflow-catalog.ts:956`), which is a run workspace, not engine state, and is therefore
deliberately excluded from the bullet list above. They are recorded as accepted, not counted.

---

## A4 — MED — INV-V37-1/INV-V37-2 were never made posture-conditional, and REQ-218's RTM row omits the mechanism that actually ships

**Violates:** `02-architecture.md:5588-5595` (the invariant block) as against ARCH-176/177/178's own
dated Gate-6 amendments; INV-V37-3's spirit; `rtm.md:240`.

**Evidence**

- `02-architecture.md:5588-5591` still reads, unconditionally: *"INV-V37-1 (the confinement is
  enforced, never argued). No agent Bash write may land outside {the run workspace} ∪ {the
  operator-granted host paths}, and the enforcement is the kernel's."* `:5592-5595` likewise for
  INV-V37-2. ARCH-176, ARCH-177 and ARCH-178 each carry an explicit, dated *"v37 Gate-6 amendment
  … ADR-083 owner_decision posture C"* block; the invariant section received none.
- Under the shipped default (`src/gateway/claude-agent-sdk-client.ts:744`, `confinementPosture`
  omitted ⇒ `'unconfined'` ⇒ `{ enabled:false }`) INV-V37-1 is **false for every local run**, by
  design and with the owner's recorded consent. An invariant that is conditional must say so; this
  one reads as an enforced global.
- The `confined` arm has **no real-tier evidence anywhere in the ledger**:
  `08-validation.md:12358-12364` records the nested-bwrap probe failing on this host and marks
  REQ-218's confined-write clause an explicit `unreachable-dep`. So the clause INV-V37-1 asserts is,
  today, exactly what the invariant forbids — *argued, not enforced*. (Validation is commendably
  explicit about this; the architecture's invariant text is not.)
- `rtm.md:240`'s REQ-218 row traces `ARCH-175, ARCH-176, ARCH-177, ARCH-178` /
  `DES-252..256, 258, 259` / `TASK-250..253, 256` / `UT-309..315, 322, VAL-253` — and **flips ✅**.
  It does **not** cite ARCH-181, DES-261, DES-262, TASK-257, UT-323, UT-324, UT-326, UT-327,
  IMPL-375 or IMPL-376. The boot probe and the remote-submission door are the *only* controls that
  close anything on the only host this project has measured, and they are absent from the trace
  chain that carries the requirement's green. The single pointer to them is prose in
  `08-validation.md`.

**Why this matters beyond bookkeeping:** INV-V37-3 exists precisely to stop a requirement's evidence
from pointing at something other than the mechanism that runs. REQ-218's row now points at the
mechanism that *doesn't* run on this host, and omits the one that does.

---

## A5 — MED — the `confinementPosture` hop-2 forward has no wiring lock, and its failure mode is silently *open*

**Violates:** ARCH-177 (the mandatory `compose-config-v2-wiring.test.ts` treatment: *"an `EXCLUDED`
row alone would leave hop 2 unlocked"*), and the repo's own documented `composeConfig` 佈線 bug class.

**Evidence**

- The *grant* hop is correctly locked, exactly as ARCH-177 demands:
  `tests/unit/compose-config-v2-wiring.test.ts:318` (the `EXCLUDED` row with its reason) and
  `:393` (*"sdk branch: composeConfig() forwards sandbox.allowHostPaths into the constructed
  gateway's confinement (REQ-218/ARCH-177)"*).
- The *posture* hop has no lock at all:
  `grep -n "confinementPosture\|confinementProbe" tests/unit/compose-config-v2-wiring.test.ts
  tests/unit/sandbox-config-wiring.test.ts` → **no matches**. The only test in the tree that mentions
  `confinementProbe` is `tests/integration/main-composition-root-events.test.ts:278`, and it asserts
  the *absence* path (`this composition root sets no confinementProbe → gateway default (unconfined)`).
- Both forwards are conditional spreads that vanish without a type error:
  `src/main.ts:368` (`...(deps.confinementProbe ? { confinementPosture: deps.confinementProbe.posture } : {})`
  → `ServerConfig`, read by the door at `src/call-tool.ts:120`) and `src/main.ts:443` (same spread →
  the gateway constructor).
- **Direction of failure is the aggravating factor.** The bug class this repo keeps hitting is
  "feature silently inert". Here, dropping `main.ts:368` leaves `deps.confinementPosture ===
  undefined` at the door — which `src/call-tool.ts:52-56` documents as *"don't gate"* — so every
  remote submission is admitted. Dropping `main.ts:443` leaves the gateway at `'unconfined'`
  (`claude-agent-sdk-client.ts:744`), so no sandbox is ever sent. A silent regression in either
  direction is **silently insecure**, not silently inert, and ARCH-177's note says the only thing
  that has ever caught this class is this test file.

**Also missing:** a lock that the *door's* two `ToolDeps` construction sites keep receiving
`isRemoteSubmission`. `src/server.ts:898` defaults it to `false`; `:1324` and `:1583` pass it, `:906`
(authoring guide, a read tool) correctly does not. A third `tools/call` site added later would
default-open with no test failing.

---

## A6 — LOW — two spike-blocked arms ship as compiled-in dead code (Karpathy tie-break)

**Violates:** ARCH-175's own instruction (*"A positive S7 flips this constant and **deletes** the
'enumerated' arm + ENGINE_STATE_DENY in the same change"*), and the slice's own thesis in REQ-219 /
ADR-085 (code the product never runs is a coverage lie).

**Evidence**

- `src/gateway/bash-confinement.ts:17` — `export const DENY_READ_MODE: 'enumerated' | 'workroot' =
  'enumerated';` with the unused `'workroot'` branch at `:55`.
- `:21` — `export const MASK_PROVIDER_ENV = false;`, making the `credentials.envVars` branch at
  `:72-74` **statically unreachable** for the shipped configuration.
- Both arms exist for spikes (S7, S8) that TASK-250 could not measure
  (`06-impl-log.md` IMPL-371: *"S7/S8 could not measure (same S1 blocker)"*).

**Assessment:** the conservative *defaults* are right and well argued — this is not a request to flip
them. The finding is that the losing branches were kept rather than deleted, in an iteration whose
own ADR-085 deleted two modules for exactly this shape. The Karpathy tie-break says: keep the
constant (it is one line of documented posture), delete the dead branch; a comment naming the spike
carries the same information at zero executable cost. LOW because the branches are small, typed and
honestly labelled.

---

## A7 — LOW — two comments in the v37 files contradict the v37 code, in the file REQ-218 exists to de-contradict

**Violates:** REQ-218 acceptance clause *「互相矛盾的兩段註解改成事實」*, ARCH-176's named bug class.

**Evidence**

- `src/gateway/claude-agent-sdk-client.ts:824` — *"A call that is refused before reaching here (this
  class has no such refusal path today) would emit ZERO lines"*. IMPL-377 added exactly such a
  refusal path **in this same iteration**, at `:705-720` (`WORKROOT_INSIDE_PROJECT`), and it sits
  *ahead* of this emit in the pinned order the code's own comment at `:702-704` states. So the
  parenthetical is false as written, and the behaviour it disclaims (a re-walk refusal produces no
  `agent.confinement` line) is now real and undocumented.
- `src/main.ts:442` — *"every existing test call site omits it, so the gateway falls back to its OWN
  'confined' default unchanged"*. The gateway's default is `'unconfined'`
  (`src/gateway/claude-agent-sdk-client.ts:744`, and its own field doc at `:129-135`, and ARCH-176's
  Gate-6 amendment). The adjacent comment at `src/main.ts:364-367` gets it right, so the two
  comments in one function disagree — the precise shape (`BUILT_IN_CORE_TOOLS` vs `V3-residual`)
  that produced REQ-218.

The two *big* comments REQ-218 actually names were fixed correctly and posture-conditionally
(`:230-244`, `:300-309`) — verified, and credited.

---

## A8 — LOW — ARCH-175's `allowRead` and ARCH-176's note disagree about whether the CLI's own paths survive confinement

**Violates:** internal consistency between ARCH-175 (api) and ARCH-176 (note); unverifiable today.

**Evidence**

- ARCH-175 api: `filesystem.allowRead = root ? [root, ...grantedHostPaths] : []`. Implemented
  verbatim — `src/gateway/bash-confinement.ts:63-64` (`allowRead: allowPaths`, the same array as
  `allowWrite`).
- ARCH-176 note: *"the CLI process itself must reach `~/.claude` and its own executable, so
  「Bash 寫 `$HOME` 被拒」 must never be implemented as 「nothing under `$HOME` is reachable」 —
  `allowRead` keeps the CLI's own paths."* No `~/.claude`, no CLI install prefix and no grant of the
  bundled binary's directory appears in the built object.

**Assessment:** this may be entirely fine — the SDK's own sandbox presumably keeps its host process
reachable regardless of `allowRead` — but *this ledger does not know that*, because S1/S9 could not
execute a single Bash call under `enabled:true` (`06-impl-log.md` IMPL-371). It is recorded here so
that the first host on which `confined` engages is not surprised by a CLI that cannot read its own
config, and so that the two rows are reconciled by measurement rather than by whichever one the next
reader opens first. LOW severity, HIGH value if the posture ever flips.

---

## Explicit lens conflicts (this group carries three lenses; here is where they pull apart)

1. **Security vs. availability — resolved against security, with the owner's signature.** ADR-083
   decided (A) fail-closed; the owner overruled to (C) after S1/S9 showed (A) means the engine stops.
   The trade is recorded properly and I do **not** re-litigate it. What I do object to is the *residue*:
   A4 (invariants still worded as if (A) shipped) and A1 (the compensating control does not cover the
   ingress the incident actually used). Accepting a weaker posture is a decision; describing it as the
   stronger one is a defect.

2. **Security vs. availability, second instance — `denyRead: [workRoot]` vs. the enumerated list.**
   The Gate-4 correction is right (whole-`workRoot` deny would have made every agent unable to read
   its own workspace — a production-discovered outage, not a posture). The cost is A3: an enumerated
   list that drifts and ignores operator overrides. Security wants the ancestor deny; availability
   forbids it; the resolution is correct but **owes a completeness test**, which does not exist.

3. **Testability vs. fail-closed defaults — the conflict I judge was resolved the right way for the
   wrong reason.** `confinementPosture` defaults to `'unconfined'` (`claude-agent-sdk-client.ts:744`)
   because a `'confined'` default broke every real-CLI-spawning test on this host. The philosophical
   justification offered ("never claim confinement without evidence applies to the caller too") is
   genuinely sound. But the *engineering* cost is A5: a default-open security field with no wiring
   lock. Testability won on ergonomics and left security without its guard rail. The cheap resolution
   is not to flip the default — it is to add the hop-2 lock ARCH-177 already mandates for the
   sibling field.

4. **Karpathy vs. optionality.** The tie-break was applied well at the big decisions (one pure
   function instead of a `WorkspaceConfinement` interface; one options field; no read-back endpoint;
   `probeConfinement` kept impure and separate so the pure builder stays host-independent — that last
   split is genuinely good architecture and the report should say so). It was *not* applied at A6,
   where two spike-losing branches were carried rather than deleted. Small, but the slice's own
   ADR-085 sets the standard.

## Scalability / performance notes (no violations found)

- `probeConfinement()` runs once per boot with a 5 s `spawnSync` timeout
  (`src/gateway/confinement-probe.ts:38`), on the `main()` path before `composeConfig()`
  (`src/main.ts:492`) — a bounded, one-shot boot cost, not a per-run one. Correct placement.
- `agent.confinement` is emitted **once per attempt** (`claude-agent-sdk-client.ts:826-844`), which
  is what DES-256 corrected it to and what the retry loop's structure can actually hold. Volume is
  per-`agent()`-attempt, not per-tool-call; ADR-078 still owns rotation. No objection.
- `buildBashConfinement()` is pure and allocation-only; nothing on the hot path does I/O. The
  concurrency argument ARCH-175 makes (why `denyRead` must not enumerate sibling run directories) is
  correct and the implementation honours it.
- Horizontal scaling and shared-state concerns are unchanged by this slice; the one new shared-state
  hazard (a granted host path mutated by up to 32 concurrent agent slots) is already filed as a v38
  candidate with a trigger (`02-architecture.md:5606-5608`). Accepted, not re-raised.

## Testability notes beyond A5

- `probeConfinement(spawn = REAL_SPAWN)` with an injected `SpawnImpl` and
  `ComposeConfigDeps.confinementProbe` as a **pre-computed value rather than a callable** (the
  `vi.mock('node:child_process')` hazard, `06-impl-log.md` IMPL-373 note) is the right seam and is
  well reasoned. Credited.
- `buildBashConfinement`'s `denyReadMode` as a *parameter* rather than an import-time read of
  `DENY_READ_MODE` keeps the pure module test-controllable. Credited.
- `validateHostPathGrants(..., realpathImpl)` injects realpath and returns **all** refusals rather
  than the first. Credited.
- The IT-301 composition-root guard added at Gate 6.5+7 (a real `createServer()` asserting an
  `agent.confinement` line reaches the sink, with the regression confirmed by commenting the wiring
  out) is exactly the right shape and is the reason A5 is MED and not HIGH — the *event* seam is
  locked even though the *posture* seam is not.

---

## Summary table

| # | Severity | ARCH/INV violated | Evidence | Lens |
|---|---|---|---|---|
| A1 | HIGH | ARCH-181, ADR-083 reason (1), INV-V37-1 | `src/call-tool.ts:120` vs `src/webhook-registry.ts:305`, `src/scheduler.ts:363`, `src/server.ts:1453` | security |
| A2 | HIGH | ARCH-177, ARCH-007 v37 amendment, ARCH-180/DES-257 | `src/main.ts:252` vs `:439`; `src/gateway/claude-agent-sdk-client.ts:120,705,747-750`; `src/gateway/bash-confinement.ts:53-56,69`; `DEPLOY.md:521`; `src/server.ts:655` | security |
| A3 | MED | ARCH-175 (own rationale), INV-V37-1 | `src/gateway/bash-confinement.ts:25-27,56` vs `src/workflow-catalog.ts:398`, `src/server.ts:672,105-154`, `src/asset-sync.ts:145`, `DEPLOY.md:549` | security / testability |
| A4 | MED | INV-V37-1, INV-V37-2, INV-V37-3 (spirit) | `02-architecture.md:5588-5595`; `rtm.md:240`; `08-validation.md:12358-12364`; `src/gateway/claude-agent-sdk-client.ts:744` | security / ledger |
| A5 | MED | ARCH-177 (hop-2 lock mandate) | `tests/unit/compose-config-v2-wiring.test.ts:318,393` (grant locked) vs no `confinementPosture` match in that file or `sandbox-config-wiring.test.ts`; `src/main.ts:368,443`; `src/server.ts:898` | testability / security |
| A6 | LOW | ARCH-175 ("deletes the losing arm"), ADR-085 thesis | `src/gateway/bash-confinement.ts:17,21,55,72-74` | Karpathy |
| A7 | LOW | REQ-218 acceptance (註解改成事實), ARCH-176 bug class | `src/gateway/claude-agent-sdk-client.ts:824`; `src/main.ts:442` | security hygiene |
| A8 | LOW | ARCH-175 api vs ARCH-176 note | `src/gateway/bash-confinement.ts:63-64`; ARCH-176 note | security (latent) |

**Recommended blocking set for Gate 8:** A1 and A2. A1 leaves the incident's own ingress open under
the posture this host runs; A2 removes the secret-file protection on the documented default config.
A3/A4/A5 are send-back-with-fix items (a completeness test, an invariant re-wording plus RTM trace
edit, one wiring lock). A6/A7/A8 are cleanup that can ride the same commit.

*Reviewer: adversarial architecture group (security / scalability / testability + Karpathy
tie-break), Gate 8, 2026-09-22.*
