# Quality-dimensions review — Gate 2 architecture (v37 slice) vs. implementation

Scope: v37 slice only (REQ-218/219, ARCH-175..182, ADR-082..086, INV-V37-1..5), IMPL-371..384.
Files read: everything on IMPL-372..384's `files:` lines (production `src/` only; the ~30
mechanical `origin:'local'` test edits from IMPL-384 were not individually read) plus the three
wiring-lock test files ARCH-182/INV-V37-5 names.

Four dimensions below, each headed, each stating what was checked whether or not it found a
defect.

---

## 1. Observability

**Checked and consistent:**
- `agent.confinement` event (`src/gateway/claude-agent-sdk-client.ts:816-846`) carries exactly the
  field set ARCH-178 + its Gate-4/Gate-6 amendments specify (`attempt`, `posture`, `root`,
  `allowWrite`, `denyRead`, `enabled`, `failIfUnavailable`, `sdkVersion`), and the `posture` ternary
  now mirrors the `sandbox` ternary (the Gate-6.5 fix for the "two different reasons must not read
  the same" bug class) — verified, both read the same default.
- `agent.confinement_denied` / `PostToolUseFailure` is correctly NOT registered anywhere in
  `claude-agent-sdk-client.ts` — matches ARCH-178's Gate-8 deferral-to-v38 (O-1).
- `main.ts`'s real boot path (`main.ts:557-560`) logs the measured posture on EVERY boot, both arms
  written out loud (`CONFINED` / `UNCONFINED (<reason>)`) — satisfies INV-V37-1's "never inferred
  from the absence of a sentence."
- `ENGINE_STATE_DENY` in `src/gateway/bash-confinement.ts:38-40` is exactly the 5-entry set ARCH-175's
  Gate-8 amendment (finding A3) prescribes (`store`, `catalog.db`, `auth-tokens.db`,
  `mcp-registry.db`, `_global_assets`) — the two previously-missing entries are present, the three
  operator-overridable ones and the `continuations.db` phantom are correctly absent.

**Violation found — INV-V37-5 is reported closed but two of its three named consumers have no wiring lock.**

- **file:** `tests/unit/compose-config-v2-wiring.test.ts:406-418` (the IMPL-381/UT-328 lock,
  reported as closing "finding A5, INV-V37-5")
- **also:** `src/server.ts:813` (RunManager construction) and `src/server.ts:902` (`buildToolDeps`,
  the door's read)
- **which ARCH/INV:** INV-V37-5 — "`confinementPosture` crosses two hops (`main.ts:368` →
  `ServerConfig` → **the door and RunManager's predicate**; `main.ts:443` → the gateway) ... each hop
  needs an assertion that fails when the forward is dropped."
- **evidence:** the test's own comment (lines 406-411) names all three consumers — "the door's own
  read in call-tool.ts and RunManager's predicate" plus "the constructed gateway's own config" — and
  claims "Mirrors the `allowHostPaths` lock's shape exactly, one probe result in, **both hops
  checked**." The assertions that follow (lines 415-418) check only `cfg.confinementPosture` (the
  `ServerConfig` field `composeConfig()` itself returns) and `cfg.gateway._config.confinementPosture`
  (the gateway hop). Neither `RunManager`'s `_confinementPosture` nor `ToolDeps.confinementPosture`
  is touched anywhere in this test, because both live inside `src/server.ts`'s `createServer()`, a
  function `composeConfig()` (`src/main.ts`) never calls and this test never invokes. Confirmed by
  `grep -rn "confinementPosture" tests/` (full search, this session): the only test that constructs
  a real `RunManager`/door pair with `confinementPosture` set is `run-manager-admission-order.test.ts`
  and `call-tool-confinement-door.test.ts`, and both pass `confinementPosture` as a **direct
  constructor argument**, never through `createServer()`/`composeConfig()` — neither locks the
  `server.ts:813`/`server.ts:902` forward. `tests/integration/scheduler-remote-origin.test.ts` and
  `webhook-remote-origin.test.ts` (IT-302/303) use a fake `RunManagerPort` that re-implements the
  predicate itself (by design, per DES-263's own testability note) and so cannot catch this either.
- **failure scenario:** a future edit that drops `confinementPosture: config?.confinementPosture`
  from either `src/server.ts:813` or `:902` (e.g. during an unrelated refactor of the `RunManager`/
  `McpFacade` constructor argument lists — exactly the shape of edit v11's `updateFlagPath` and v15's
  auth regression were) compiles clean and every existing test — including the one that claims to be
  this exact hop's lock — stays green. `RunManager._confinementPosture`/`ToolDeps.confinementPosture`
  silently become `undefined`; `admissionRefusal()`'s own documented convention treats `undefined` as
  "never measured ⇒ do not gate" (`src/run-manager.ts:170-171`). Result: on a host the boot probe
  measured `unconfined`, every remote `run_start`/`run_resume` AND every remote-created webhook/
  schedule delivery is silently ADMITTED instead of refused — the exact "silently INSECURE, not
  silently inert" failure class INV-V37-5 states by name, in the one slice built specifically to stop
  it, reopened by the very repair commit (IMPL-381) whose own note claims it closed.
- **severity:** HIGH. This is not a hypothetical edge case — it is the two load-bearing consumers of
  the security-relevant value the entire v37 slice exists to protect, left with a test that reads as
  covering them (same file, same shape, comment names them explicitly) but does not.

---

## 2. Replaceability

**Checked and consistent — no violations found.**
- `src/gateway/client.ts` (the `GatewayClient` port `LiteLLMGatewayClient` also implements) gained no
  `sandbox`/`confinement` member; `sandbox`/`confinementPosture` live only on
  `ClaudeAgentSdkGatewayConfig`, exactly as ARCH-176 decided ("not added to the `GatewayClient` port
  ... the other implementation has no subprocess and would have to stub it"). A provider swap
  (`gateway: 'direct-fetch'` vs `'sdk'`) still needs zero confinement-aware code in the non-SDK
  backend.
- `src/run-manager.ts` imports no confinement module (`grep "confine\|sandbox"` on its imports finds
  only the pre-existing, unrelated `./sandbox/host.js` script sandbox) — `RunManager` depends only on
  the pure `admissionRefusal()` predicate it owns, and the posture arrives as an opaque
  `'confined'|'unconfined'|undefined` string, not a `ClaudeAgentSdkGatewayConfig`-shaped object. The
  admission control is gateway-implementation-agnostic, matching ARCH-182's placement rationale ("the
  point all four admissions already converge on").
- `buildBashConfinement()` (`src/gateway/bash-confinement.ts`) imports only the SDK's `SandboxSettings`
  **type** (type-only import, line 8) plus one local pure helper (`isPathContained`) — no fs/process/
  env/clock — matching ARCH-175's contract verbatim; swapping the CLI's sandbox schema for a future
  SDK version only requires touching this one function's return shape, never its callers.
- `ComposeConfigDeps.workRootDefault`/`confinementProbe` being pre-computed VALUES rather than
  callables (both flagged as deliberate in the ledger, both confirmed at their two production call
  sites in `main.ts:518,547`) keeps `composeConfig()` swappable/testable without a `vi.mock` collision
  — consistent with the DES-255 seam rule the architecture states.

---

## 3. Consumability

**Checked and consistent:**
- `CONFINEMENT_UNAVAILABLE` is in `ERROR_CATALOG` (`src/errors.ts:91`) with a `see` pointer, and in
  both `run_start`'s (`tool-specs.ts:532`) and `run_resume`'s (`tool-specs.ts:599`) advertised
  `errors:` arrays — closes the C-1 finding as claimed.
- `refusalEnvelope`'s `code` parameter is typed `ErrorCode` in `src/call-tool.ts` (verified import/
  usage), closing the class rather than one instance, as ARCH-181's amendment specifies.
- `rwe.config.example.json` documents `sandbox.allowHostPaths`; `KNOWN_FILE_CONFIG_KEYS` in
  `src/main.ts:110` includes `sandbox` — the compiler-enforced forwarding discipline ARCH-177 asks
  for is in place.

**Violation found — the authoring guide's confinement explanation was not updated for ARCH-182's widened admission surface.**

- **file:** `src/authoring-guide.ts:363-369` (`HOST_PATH_GRANTS_UNCONFINED`), reachable from the live
  `workflow_authoring_guide` tool and from `docs/AUTHORING.md`
- **which ARCH violated:** ARCH-107 amendment / REQ-117 (this is the one documented read-path for
  「what may this agent touch / when is Bash refused」 — ARCH-177's own note: "No read-back endpoint
  is added ... a third surface would be a second thing describing the same fact," making this text
  the authoritative, sole explanation) against ARCH-182, which was landed one gate later (IMPL-384)
  and never touched `src/authoring-guide.ts` (absent from IMPL-384's `files:` list).
- **evidence:** the text reads, verbatim: *"A remote submission is refused before it ever reaches an
  agent — `run_start`/`run_resume` return a refusal instead of admitting Bash-capable work."* This
  was accurate when IMPL-379 wrote it (ARCH-181's door was, at that point, the only admission
  control). ARCH-182/IMPL-384 subsequently added a SECOND, independent admission control — the
  `admissionRefusal()` predicate at `RunManager.start()` — specifically because ARCH-181's door
  "covers ONE of four admission sites" (the Gate-8 finding A1 that produced ARCH-182). A remotely-
  created webhook or resident schedule on an `unconfined` host is now also refused, but NOT via
  `run_start`/`run_resume` — it is refused at webhook delivery (`POST /hooks/:id`'s response body) or
  surfaces as the schedule's `lastError` (`schedule_list`), mechanisms the guide text names nowhere
  and which do not match the sentence's own claim that only `run_start`/`run_resume` "return a
  refusal." `errors.ts:91`'s `CONFINEMENT_UNAVAILABLE.see: 'workflow_authoring_guide'` pointer means
  this is exactly the text a remote author debugging a silently-refused webhook/schedule is directed
  to, and it will not explain what they are seeing.
- **failure scenario:** a remote party registers a workflow and a webhook against it on a host whose
  boot probe measured `unconfined`. The webhook fires; delivery returns `CONFINEMENT_UNAVAILABLE`.
  The author reads `workflow_authoring_guide` (the only surface the error's `see` field points them
  to) expecting an explanation, and reads a sentence that describes `run_start`/`run_resume` — a tool
  call they never made — leaving them unable to connect the refusal to their webhook at all.
- **severity:** MEDIUM. Not a security gap (the refusal itself is correctly enforced, per Section 1's
  caveat about the wiring lock) — it is a documentation/consumability gap: the one designated
  explanation surface for a wire-reachable error code describes a narrower mechanism than what
  actually ships, for the exact audience (a remote author) the error is aimed at.
- **secondary instance, same root cause, lower severity:** `src/errors.ts:91`'s own `hint` string
  ("a remotely-submitted run is refused") and `src/main.ts:560`'s boot banner ("remote run
  submissions will be refused") use the same pre-ARCH-182 framing; both are generic enough to be read
  as covering webhook/schedule too (unlike the guide, they don't name `run_start`/`run_resume`
  specifically), so they are noted but not counted as a separate violation.

---

## 4. Self-sustainability

**Checked and consistent — no violations found.**
- Refused remote schedule/webhook admissions do not tight-loop: `scheduler.ts`'s ticker driver
  (`server.ts:1015-1029`) routes the thrown `CONFINEMENT_UNAVAILABLE` into the SAME generic
  `.catch()` → `markFailed()` path every other dispatch failure uses — this is not an omission, it is
  what ARCH-182's own contract table prescribes verbatim ("`markFailed` at the ticker driver
  (`server.ts:1017-1025` already routes `err.code` there)"). `markFailed` (`scheduler.ts:570-579`)
  already advances a `cron` schedule's `nextFire` independently of outcome and auto-disables a
  `once` schedule — no new infinite-retry surface is introduced. (`Scheduler.trigger()`'s own
  try/catch, `scheduler.ts:378-390`, and `webhook-registry.ts`'s equivalent at `:316-321`, both exist
  as IMPL-384 claims; verified present.)
- The confinement posture is measured exactly once per process lifetime, at boot
  (`src/gateway/confinement-probe.ts`, called once from `main.ts:539`), never re-probed mid-run — this
  is architecture-as-designed (ADR-083's revisit trigger is explicitly an operator/upstream event,
  not a runtime retry loop), not a gap: a host whose nested-userns support changes requires a
  restart, which is documented behavior, not silent drift.
- `admissionRefusal()` (`src/run-manager.ts:167-171`) is a total, pure function over its three-value
  input domain (`'confined'|'unconfined'|undefined' × 'local'|'remote'`) with no unhandled branch —
  no path can throw an unexpected shape into a caller that isn't already prepared for a coded error.
- Legacy persisted `RunSpec` rows (`sqlite-run-store.ts`'s `getSpec()`) backfill `origin: 'local'` on
  read rather than leaving the field `undefined`/throwing — a pre-v37 run's resume path degrades to
  "not gated" rather than crashing, matching ARCH-182's own stated rationale ("harmless because a
  resume is gated by ARCH-181's door, not by this predicate").

---

## Summary

| Dimension | Violations | Notes |
|---|---|---|
| Observability | 1 (HIGH) | INV-V37-5's own wiring lock does not cover the two consumers it names |
| Replaceability | 0 | — |
| Consumability | 1 (MEDIUM) | Authoring guide's confinement text stale after ARCH-182 widened admission |
| Self-sustainability | 0 | — |

**Total violations: 2** (1 HIGH, 1 MEDIUM). Both are drift introduced by the LATER of two Gate-8
send-back repairs not reaching back into an EARLIER repair's artifacts (IMPL-381's test, IMPL-379's
guide text) once IMPL-384/ARCH-182 changed what those artifacts needed to say — not deviations from
the original v37 design intent, but real, currently-unclosed gaps between what the architecture's
own invariants (INV-V37-5) and rationale (ARCH-177's "no read-back endpoint... a third surface would
be a second thing describing the same fact") require and what ships today.
