# Gate 8 RE-REVIEW — Adversarial architecture group (security / scalability / testability, Karpathy tie-break)

**Iteration:** v37 (REQ-218 Bash confinement posture C, REQ-219 dead-security-module cleanup)
**Round:** 2 — this file REPLACES the 2026-09-22 round-1 review (A1–A8 + C-1 + O-1). Round 1's
findings were sent back and repaired by IMPL-380..384 and by the architect's in-place amendments;
this round (a) closes out each round-1 finding against the code now on disk, and (b) reviews the
**repair itself**, which added a new architecture row (ARCH-182), a new ADR (ADR-086 + its
2026-09-23 owner ruling), two persisted columns and a required `RunSpec` field. Round 1's full
text is superseded, not lost — it is recoverable verbatim at
`git show 045bd6e:.sdlc/features/001-remote-workflow-engine/.panel/review/adversarial.md`, and
every one of its findings is enumerated with a disposition in Part 1 below.
**Compared:** `02-architecture.md` ARCH-175..182 + ADR-082..086 + INV-V37-1..5 (every dated
amendment in place) **against** the code named on `06-impl-log.md`'s IMPL-371..384 `files:` lines,
plus the modules those files touch at a module boundary (`webhook-registry.ts`, `scheduler.ts`,
`mcp-facade.ts`, `workflow-catalog.ts`, `net-guard.ts`, `errors.ts`, `tool-specs.ts`).
**Verdict:** `consistent: no` — **9 open findings** (2 HIGH, 2 MED, 5 LOW; 2 of the LOWs carried
forward unrepaired from round 1).

Two of this group's three charter lenses still have no purchase on this slice and are reported as
such rather than invented: there is **no authn/authz change, no credential verification loop, no
token issuance and no failure counter** in v37's diff, so *brute force / JWT forgery / timing
attacks / concurrency of failure counting* remain **N/A this iteration**. The security lens lands on
attack surface, provenance integrity and secret protection; the scalability lens lands on one
boot-time `spawnSync` (prescribed, accepted) and on the re-fire behaviour of a permanent refusal;
the testability lens lands on two missing wiring locks. The one place this round's lenses genuinely
pull apart is recorded at the end, not smoothed over.

---

## Part 1 — round-1 closure (verified on disk, not inherited from the impl log)

| # (r1) | Status | Evidence now on disk |
|---|---|---|
| **A1** HIGH — the door covers 1 of 4 admissions | **CLOSED** | `admissionRefusal()` is the literal first statement of `RunManager.start()` (`src/run-manager.ts:167-172`, `:473`); all four `.start(` sites stamp `origin` (`src/mcp-facade.ts:718`, `src/webhook-registry.ts:320`, `src/scheduler.ts:388`, `src/server.ts:1025`); `RunSpec.origin` is REQUIRED (`src/types.ts:478`) and BOTH structural ports were widened so the bivariance hole is shut (`src/webhook-registry.ts:26`, `src/scheduler.ts:92`). Real-tier proof through the REAL ticker and the REAL `POST /hooks/:id` exists (VAL-256, four cells). Independent re-census this round (`runManager.start(`/`_runManager.start(` over `src/`): still exactly four, no fifth. |
| **A2** HIGH — `protectedFiles` evaporates when `workRoot` is unset | **CLOSED** | `const workRoot = explicitWorkRoot ?? deps.workRootDefault` (`src/main.ts:257`); the `if (workRoot)` guard on the gateway's `confinement` block is gone — forwarded unconditionally (`src/main.ts:480`). One residual, LOW, see **B6**. |
| **A3** MED — `ENGINE_STATE_DENY` is an incomplete hand census | **CLOSED** | `ENGINE_STATE_DENY` is now the five knob-less literals (`src/gateway/bash-confinement.ts:38-40`, `mcp-registry.db`/`_global_assets` added, `continuations.db` removed); every overridable path is resolved at the composition root and handed in as `protectedFiles` (`src/main.ts:271-283`). The builder stayed pure. |
| **A4** MED — invariants worded as if fail-closed shipped | **CLOSED** | `INV-V37-1`/`INV-V37-2` are posture-conditional with both arms written out (`02-architecture.md:5763-5783`); `rtm.md`'s REQ-218 row cites ARCH-181/182 and names its two uncovered gaps. |
| **A5** MED — no hop lock on `confinementPosture` | **PARTLY CLOSED — see B1** | UT-328 (`tests/unit/compose-config-v2-wiring.test.ts`) locks `composeConfig()`'s two spreads. The hops *downstream* of `ServerConfig` — and the whole of `isRemoteSubmission` — remain unlocked. |
| **A6** LOW — spike-blocked arms ship as dead code | **OPEN, unrepaired** | `DENY_READ_MODE` (`src/gateway/bash-confinement.ts:17`) still carries the unexercised `'workroot'` branch at `:66-69`; `MASK_PROVIDER_ENV = false` (`:21`) still guards a statically unreachable `credentials.envVars` branch at `:85-87`. No IMPL in 380..384 touches either. Carried forward unchanged. |
| **A7** LOW — v37 comments contradict v37 code | **OPEN, and now THREE copies — see B5** | |
| **A8** LOW — ARCH-175 `allowRead` vs ARCH-176's "the CLI keeps its own paths" | **OPEN, unrepaired** | `src/gateway/bash-confinement.ts:77` still sets `allowRead: allowPaths` (workspace + grants only); no `~/.claude`, no CLI install prefix. Unmeasurable until a host measures `confined` (S1/S9 blocked). Carried forward unchanged, LOW severity / HIGH value at the posture flip. |
| **C-1** blocking — `CONFINEMENT_UNAVAILABLE` uncatalogued | **CLOSED** | `src/errors.ts:91` (with `see: 'workflow_authoring_guide'`), `src/tool-specs.ts:532` + `:599`, `refusalEnvelope(code: ErrorCode, …)` (`src/call-tool.ts:80`), `docs/AUTHORING.md:239` regenerated. One surface still does NOT carry the code — see **B4**. |
| **O-1** — `agent.confinement_denied` claimed but not built | **CLOSED** | ARCH-178 now states the DEFER to v38 despite a positive S4, with an event-shaped trigger (`02-architecture.md:5588-5603`). |

Also verified good and worth crediting, because they were the expensive parts: `bindEventSink` is
wired at the real composition root (`src/server.ts:1686`); the `agent.confinement` event's `posture`
ternary now mirrors the `sandbox` ternary instead of reading the same field with the opposite
default (`src/gateway/claude-agent-sdk-client.ts:842` vs `:748`); `SqliteRunStore.getSpec()`'s
tolerant `origin:'local'` read is in exactly one place, named (`src/store/sqlite-run-store.ts:175`);
and VAL-256 made "remote" true by a tunnel header over a loopback socket, then delivered *without*
it — which is the only construction that actually proves delivery-peer-blindness.

---

## B1 — HIGH — INV-V37-5 was minted naming TWO values and implemented for ONE; `isRemoteSubmission` has no hop lock anywhere, and its failure direction is silently insecure

**Violates:** INV-V37-5 verbatim (`02-architecture.md:5796-5804`), ARCH-177's mandatory
`composeConfig()`-wiring sentence as generalised by that invariant, ARCH-182's persistence design.

**What the invariant says.** *"`confinementPosture` crosses two hops … and `isRemoteSubmission`
crosses one (`server.ts:1168` → `ToolDeps` → the door **and the two trigger-create stamps**). Both
failure directions are silently INSECURE, not silently inert — drop the first and every remote
submission is admitted; drop the second and every run ships unconfined — so **each hop** needs an
assertion that fails when the forward is dropped."*

**What shipped.** IMPL-381 added exactly one lock, UT-328, for `confinementPosture`'s two
`composeConfig()` spreads. Census of the suite this round:

- `grep -rln isRemoteSubmission tests/` → **one file**, `tests/unit/call-tool-confinement-door.test.ts`,
  which hands `deps` to `callTool()` directly. It locks the door's *predicate*, not any forward.
- `grep -rn createdRemote tests/` → `tests/integration/scheduler-migration.test.ts:184` (a row-shape
  assertion) and the two v37 integration files, both of which construct the row by calling
  `port.create({createdRemote:true})` / `reg.create({createdRemote:true})` **directly**
  (`tests/integration/scheduler-remote-origin.test.ts:39`,
  `tests/integration/webhook-remote-origin.test.ts:62`) — bypassing `call-tool.ts` entirely.

**The three unlocked forwards, each with the mutation that no test catches:**

1. `src/server.ts:1178` → `buildToolDeps(webhookBaseUrl, isRemoteSubmission)` at `:1334` and `:1593`.
   Drop the second argument at either call site and it defaults to `false` (`src/server.ts:901`):
   every remote submission is admitted at the door **and** every remotely created trigger is stamped
   `createdRemote = 0` forever. Suite stays green.
2. `src/call-tool.ts:262` — `createdRemote: deps.isRemoteSubmission === true` on `schedule_create`.
   Delete that property: ARCH-182 is defeated for every future schedule. Suite stays green.
3. `src/call-tool.ts:271` — the same property on `webhook_create`. Same. Suite stays green.

Two further downstream hops of `confinementPosture` are also unlocked **in the only direction that
can fail**, and they are the ones ARCH-182 actually depends on: `src/server.ts:813` (`ServerConfig`
→ `RunManager`, which is what makes `admissionRefusal()` non-vacuous) and `src/server.ts:902`
(`ServerConfig` → `ToolDeps`). One test does boot a real composition root with this field —
`tests/acceptance/val-253-bash-confinement.test.ts:38-52`, `createServer({… confinementPosture:
'confined'})` — but `'confined'` is precisely the NON-gating value: `admissionRefusal()` returns
`null` for it and the door never fires, so val-253 passes unchanged if both forwards are deleted.
No test anywhere constructs `createServer({confinementPosture:'unconfined'})` and asserts a
`origin:'remote'` submission is refused.

**Why this is not answered by VAL-256.** VAL-256 is a one-time manual real-tier run and it is
excellent evidence that the wiring is correct *today*. INV-V37-5 asks for something categorically
different — a standing assertion that **fails on the next commit** that drops a forward. That is the
invariant's own stated reason for existing: *"This repo's memory now names this bug class three times
(v11 `updateFlagPath`, v15 auth, v37 A5), and a hop lock is the only thing that has ever caught it."*
A manual validation cell cannot be that, and IMPL-381's own note is explicit that the A5 finding
**was the missing test, not a code defect** — the identical situation here got no test at all.

**Simplest fix consistent with the slice's minimalism:** one `it()` per stamp beside the existing
`call-tool-confinement-door` cases — `callTool({...deps, isRemoteSubmission:true}, 'webhook_create',
{})` then read the row back and assert `createdRemote === 1`, and the twin for `schedule_create`
(both stores accept `':memory:'`, so no server is needed) — plus one integration assertion that a
real `createServer({confinementPosture:'unconfined'})` refuses a `RunSpec` with `origin:'remote'`.
Three cases, no production change.

---

## B2 — HIGH — ARCH-182 keys the predicate on who CREATED the trigger row, while its own rationale (and ADR-086's owner ruling) argues from who ATTACHED it; in this repo's v24 claim model those are different, later, re-assignable acts

**Violates:** ARCH-182 `api`/`note` rationale (`02-architecture.md:5682`: *"The fact that decides is
who ATTACHED the trigger, written once, at creation, by the party that created it"*), ARCH-182's
closure claim (*"a remote `webhook_create`/`schedule_create` can no longer start Bash-capable
`agent()` work on a host measured `unconfined`"*), INV-V37-1's `unconfined` arm (*"no
**remotely-submitted** run's Bash write"*), ADR-086's `owner_decision` premise.

**Evidence — creation and attachment are two different events in this codebase.**

- `createdRemote` is written **once, at row creation**, and never again:
  `src/webhook-registry.ts:176` (`INSERT … createdRemote`), `src/scheduler.ts:294-307`. Neither
  `claim()` (`src/webhook-registry.ts:211`, `src/scheduler.ts:529`) nor `release()` nor
  `insertVersion()` re-stamps it — verified by reading all three.
- **Attachment happens later, at `workflow_register`**: `McpFacade.workflowRegister()` claims each
  declared trigger id onto the registering workflow (`src/mcp-facade.ts:383`), and a re-registration
  of a workflow that already holds the trigger returns `'held'` and proceeds (`:385`). **Two gates
  stand in the way, and both are identity facts, never locality facts**: the trigger row's own
  creator — `if (!isAdmin && owner !== actorId) throw NOT_TRIGGER_OWNER` (`src/mcp-facade.ts:371-377`),
  where `owner` is `createdBy` — and the workflow name's owner —
  `canMutate(owner, actor) = !owner || actor.bypass || owner === actor.id`
  (`src/workflow-catalog.ts:159-160`, enforced at `:616`, `:648`, `:715` as `NOT_WORKFLOW_OWNER`).
  Neither asks where the call came from.

**Attack path, end to end, requiring ZERO operator action, on this host's measured posture
(`unconfined`):** a remote caller holding the ordinary author/admin principal this deployment
already issues (the v24 Gate-1 record ADR-084 itself cites — *"the operator and the author are the
same person"*) calls `workflow_register({name: <an existing workflow>, script: <malicious>, mermaid,
triggers:[<that workflow's existing trigger id>]})`, then `workflow_publish(channel:'release')`. The
trigger row is untouched, so it still reads `createdRemote = 0`. Its next cron firing
(`src/server.ts:1025`) or its next webhook delivery (`src/webhook-registry.ts:320`) stamps
`origin:'local'`, `admissionRefusal()` returns `null`, `agent()` dispatches with
`options.sandbox = {enabled:false}` (`src/gateway/claude-agent-sdk-client.ts:748`), and Bash writes
`$HOME` — the 2026-09-20 incident, reproduced past both controls.

**Why this is not the residual ADR-086 already named.** ADR-086's stated residual is *"a remote party
able to call `workflow_register` can still have its script executed **if the OPERATOR later starts it
locally**"*, and the owner's 2026-09-23 ruling rests its acceptance squarely on that premise:
*「這條路徑需要操作者自己動手,不是遠端單方面就能完成」*. The path above needs no operator action at
all — a pre-existing cron or webhook supplies the start. The premise of the accepted cost does not
hold for any workflow that already owns a trigger.

**And on the production host, that is every trigger.** ADR-086 chose `DEFAULT 0` for the legacy
cohort deliberately (*"fail-closed would black out every pre-existing webhook and schedule at
upgrade"*) — a defensible availability call. But the owner's own ruling records that the production
catalog's workflows are **all** remotely registered (`owner=hsuhungjung@gmail.com`, including
`jev-haiku` v4's hourly health check). Those triggers predate this column, so they read `local`. The
control therefore ships with an empty domain on the one host it was built for: every trigger that
exists today is exempt, and the exemption is invisible (see **B3**).

**What this round is and is not claiming.** ADR-086's *decision* — key on the trigger, not on
`workflow_versions.origin` — is the owner's and this gate does not reverse it; option (B) was
declined for a reason (it would refuse a local `run_start` of a remotely-registered script, reversing
ADR-083's answered ruling). The finding is narrower and it is an architecture-vs-implementation
defect, not a re-litigation: **the row's own justifying sentence describes a fact the code does not
compute.** Either ARCH-182's rationale is re-worded to say "who created the trigger ROW" and the
re-attachment gap is filed as a *second* named residual with its own trigger, or the stamp follows
attachment (`claim()` writes `createdRemote` from the claiming call's own `isRemoteSubmission` —
one line in each store, reusing the flag `call-tool.ts` already holds at `workflow_register`). This
ledger has precedent for exactly this move: ADR-083's own reversal was argued as 「其前提已不成立」.
**Recommended handling: surface to the owner as a premise correction on ADR-086, with B3 as the
minimum mitigation if the ruling stands.**

---

## B3 — MED — ADR-086's own compensating control (an operator sweep of the `DEFAULT 0` cohort, "in `DEPLOY.md`") was never written, and for webhooks it is not even performable: `webhook_list` does not expose `createdRemote`

**Violates:** ADR-086 `note` (`02-architecture.md:5684`: *"the operator sweep belongs in `DEPLOY.md`,
not in a boot WARN seen once and lost"*), ARCH-182's advertised-surface discipline.

**Evidence**

- `grep -n "createdRemote|sweep|遠端建立|升級後" DEPLOY.md` → **nothing** about the cohort.
  `DEPLOY.md:540/541` document the grant key and the measured posture; `:882` documents the
  `run_start`/`run_resume` refusal only. `DEPLOY.md:901`, the upgrade section, currently tells the
  operator **「你要做的事:沒有」** — which is now false for exactly the cohort ADR-086 knowingly
  left open.
- `SqliteSchedulerPort` DOES surface the fact: `ScheduleStatus.createdRemote` (`src/scheduler.ts:151`),
  and VAL-256's own cells read it. `WebhookRegistry` does **not**: `WebhookView`
  (`src/webhook-registry.ts:50-64`) has no such field and `list()` (`:192-202`) does not project it.
  So `webhook_list` — the operator's only read path for webhook rows — cannot answer 「這個 webhook
  是遠端建的嗎」 at all. A sweep that the tool surface cannot express is not a deferred mitigation,
  it is an absent one. **This also gates B1's fix**: the webhook half of the hop lock B1 asks for
  has to read `createdRemote` back, and `webhook_list` cannot project it — so B3's one-field fix is
  what makes B1's webhook assertion writable without reaching into SQL from a test.
- The asymmetry also defeats the finding's own diagnosis path: an operator seeing a `403
  CONFINEMENT_UNAVAILABLE` from `POST /hooks/:id` has no way to confirm which of their webhooks are
  stamped remote.

**Note on the Karpathy tie-break, since ADR-086 invoked it here.** ADR-086 declined quality-dimensions'
tri-state `originConfirmed` surface as "a three-valued column plus two tool-output surfaces bought
for a one-time upgrade cohort" — a fair call. But it declined that *instead of* the DEPLOY.md
sentence it promised in the same paragraph, and the cheapest honest option (one existing field
projected onto `WebhookView`, plus one `DEPLOY.md` row) was never on the table. One boolean on a view
that already carries `createdBy` is not speculative architecture.

---

## B4 — MED — `WebhookRegistry.deliver()`'s new catch-all turns every `RunManager.start()` throw into an uncoded HTTP 403 and records nothing on the row, bypassing the v24 refusal accounting this exact route owns

**Violates:** ARCH-182 `api` (*"each of the four callers maps it into **the idiom it already has** —
… the refusal body at the webhook route"*), ARCH-181's C-1 rationale (a wire-reachable refusal code
must be discoverable and machine-readable), DES-150's fire-path refusal accounting.

**Evidence**

- Before v37 the webhook route had **no** try/catch around `start()`; a throw propagated to the route
  handler's `.catch()` and became `500 {"error":"webhook ingress error"}` (`src/server.ts:1477`).
  IMPL-384 added one (`src/webhook-registry.ts:319-323`), and it catches **everything**:
  ```ts
  } catch (err) {
    return { ok: false, httpStatus: 403, reason: toErrEnvelope(err).message };
  }
  ```
- **The code is dropped.** `DeliverResult`'s 409 variant already carries a machine-readable `code`
  (`src/webhook-registry.ts:68-71`); the 403 variant does not, and `toErrEnvelope(err).message` is
  flattened into `reason`. VAL-256 Cell 3 captures the shipped body verbatim
  (`08-validation.md:12617-12621`): `{"error":"CONFINEMENT_UNAVAILABLE: …"}` — a string, not a code
  field. C-1 was fixed for `tools/call` and reopened one route over, at the ingress ARCH-182 exists
  to cover. Widening `DeliverResult`'s 403 arm to `{reason, code}` is a one-line type change; the
  route already projects `out.reason`.
- **A retryable condition is rendered permanent.** `RUN_ADMISSION_LIMIT` (`src/run-manager.ts:495`,
  explicitly retryable), `INVALID_SEED_SPEC`, `SEED_SOURCE_CONFLICT`, `CAS_UNAVAILABLE` and every
  other `start()` throw now answer the sender **403 Forbidden**. ARCH-182's own justification for
  hoisting `admissionRefusal()` above `RUN_ADMISSION_LIMIT` is that *"a submission … must not be
  answered with the RETRYABLE limit refusal when the true condition is deterministic and permanent"* —
  this catch commits the inverse error on the same code path, in the same commit.
- **Nothing is recorded.** `_recordRefusal(id, reason)` — the v24 mechanism that maintains
  `refusalCount`/`lastRefusedAt`/`lastRefusalReason` on the webhook row, and which this same function
  calls for `UNCLAIMED`, `CLAIMED_WORKFLOW_MISSING`, `CHANNEL_UNPUBLISHED` and `NOT_IN_RELEASE`
  (`:283-308`) — is **not** called here. The scheduler side at least lands in `lastError` via
  `markFailed` (VAL-256 Cell 1: `lastError:{code:'CONFINEMENT_UNAVAILABLE'}`, `refusalCount:0`); the
  webhook side leaves **no durable trace at all**. Security consequence, stated plainly: a remote
  party hammering a remotely-created webhook on an `unconfined` host is refused correctly and
  **invisibly** — no counter, no timestamp, nothing for an operator or a later forensic read to find.
  This is the only purchase the charter's "failure counting" lens has on v37, and the answer is that
  the count this repo already maintains was not reused.

---

## B5 — LOW — round-1's A7 is unrepaired, and the false claim has now propagated to a THIRD site: two comments in `main.ts` and one in the gateway state the opposite of what the v37 code does

**Violates:** REQ-218 acceptance clause 「互相矛盾的兩段註解改成事實」, ARCH-176's named bug class,
INV-V37-1's closing rule (*"Any future claim that a tool is 「confined」 must name the mechanism …
**and the posture under which that mechanism runs**"*).

**Evidence**

- `src/main.ts:182-183` (**new this round — `ComposeConfigDeps.confinementProbe`'s doc comment**):
  *"…`ClaudeAgentSdkGatewayConfig`: 'confined', ARCH-176's own conservative default) — **never a
  silent 'unconfined' for a config that never asked the question**."* The gateway's default is
  `'unconfined'` — `src/gateway/claude-agent-sdk-client.ts:748` (`=== 'confined' ? build… :
  {enabled:false}`), its own field doc at `:129-140`, and ARCH-176's Gate-6 amendment
  (`02-architecture.md:5488-5497`), which records that the `'confined'` default was tried and
  reverted because it broke the real suite. The comment does not merely disagree with the code; it
  disclaims, word for word, the behaviour the code has.
- `src/main.ts:483` (round-1's A7, unchanged): *"the gateway falls back to its OWN 'confined' default
  unchanged."* Same error, same file, ~300 lines apart — and `src/main.ts:406`'s neighbouring comment
  gets it right, so one function's two comments disagree. This is the exact `BUILT_IN_CORE_TOOLS`
  vs `V3-residual` shape that produced REQ-218.
- `src/gateway/claude-agent-sdk-client.ts:826-828` (round-1's A7, unchanged): *"A call that is
  refused before reaching here (**this class has no such refusal path today**) would emit ZERO
  lines."* IMPL-377 added precisely such a refusal path in this same iteration, `WORKROOT_INSIDE_PROJECT`
  at `:709-728`, ahead of this emit in the pinned order the code's own comment at `:703-707` states.

Fixing all three is a three-line edit. It is LOW only by blast radius: a fail-open default documented
as fail-closed is the single most reliable way to get the next reader's threat model wrong, in the
iteration whose whole thesis is that a comment must be a measurement.

---

## B6 — LOW — ARCH-177's amendment states `ComposeConfigDeps` gains `workRootDefault: string`; the code ships it OPTIONAL, the implementer flagged the divergence, and the architecture row was never amended

**Violates:** ARCH-177 v37 Gate-8 amendment (`02-architecture.md:5539-5540`, *"**`ComposeConfigDeps`
gains `workRootDefault: string` — a PRE-COMPUTED VALUE, never a callable.**"*).

**Evidence:** `src/main.ts:197` — `workRootDefault?: string`. IMPL-380's own note reports the
divergence honestly and argues it well (a required field would force ~80 existing `composeConfig()`
call sites, 49 in one file, to supply a value the row never asked them for; the *security outcome*
holds because both production call sites always pass a real value). The engineering call is right by
the Karpathy tie-break. The defect is that **the ledger still says `string`** — a reader of
`02-architecture.md` alone believes the compiler enforces something it does not. One-word amendment
on the architecture row (`workRootDefault?: string`, "optional on the type, always supplied on the
production path"); no code change.

---

## B7 — LOW — a deterministic, permanent refusal is routed to `markFailed` at the ticker, so a remotely-created cron re-fires and re-refuses forever, with a stack trace per firing

**Violates:** nothing in the letter — ARCH-182 `api` explicitly prescribes *"`markFailed` at the
ticker driver"*. It contradicts ARCH-182's own reasoning, so it is reported as an **architecture +
implementation pair**, not as an implementer deviation.

**Evidence**

- `src/server.ts:1027-1038`: the generic `.catch()` calls `scheduler.markFailed(firing, code)` and
  `console.error(...)`. `markFailed` shares `markFired`'s advance, so a `cron` row gets a fresh
  `nextFire` and is due again next period — permanently, with one `console.error` (plus the raw error
  object) per firing, and `refusalCount` never incremented (VAL-256 Cell 1 confirms `refusalCount:0`).
- The seam for the correct treatment already exists one function up: `resolveScheduleTarget()`
  (`src/server.ts:972-1002`) is the v24 policy gate whose whole purpose is 「refused before dispatch」,
  it already reads `status.createdRemote` (`:981`), and `markRefused` already maintains the coalesced
  counter. Returning `{refused:'CONFINEMENT_UNAVAILABLE'}` from there instead of letting `start()`
  throw would cost one member on `RefusalReason` and would make the scheduler and the webhook routes
  agree — which also closes half of **B4**.
- Scalability note (the lens's only other purchase on this slice): the cost is bounded and small —
  two scalar comparisons per admission, zero new queries (both routes read a row they had already
  loaded; verified at `src/server.ts:981` and `src/webhook-registry.ts:320`), and the boot probe is
  one `spawnSync` with a 5 s cap, once (`src/gateway/confinement-probe.ts:38`). The only unbounded
  thing v37 adds is this log line.

---

## Carried forward from round 1, still open, unchanged

- **A6 — LOW (Karpathy):** `DENY_READ_MODE`'s `'workroot'` arm (`src/gateway/bash-confinement.ts:17`,
  `:66-69`) and `MASK_PROVIDER_ENV`'s `credentials.envVars` arm (`:21`, `:85-87`) are compiled-in
  branches no shipped configuration reaches, in the iteration whose ADR-085 deleted two modules for
  precisely that shape. ARCH-175's own instruction is to delete the losing arm at the flip; keeping
  both arms *before* the flip is the same debt one release early. The defaults are correct and are
  not being questioned.
- **A8 — LOW (latent, high value at the posture flip):** ARCH-175's `allowRead = [root, ...grants]`
  is implemented verbatim (`src/gateway/bash-confinement.ts:77`) while ARCH-176's note promises
  *"`allowRead` keeps the CLI's own paths"* (`~/.claude`, the bundled binary's prefix). Neither is
  falsifiable on any host this ledger has measured — S1/S9 could not complete one Bash call under
  `enabled:true`. Recorded so the first `confined` host reconciles the two rows by measurement rather
  than by whichever one the next reader opens first.

---

## Explicit lens conflicts (this group carries three lenses; here is where they pull apart)

1. **Security vs. availability — decided by the owner, twice, and both rulings are respected here.**
   ADR-083 chose posture (C) over fail-closed because (A) meant the engine stops; ADR-086 chose the
   trigger-row key over `workflow_versions.origin` because (B) would have reversed ADR-083's answered
   ruling and blacked out every existing production workflow. I re-litigate neither. **B2 is the
   residue, not the ruling**: the choices are sound, the sentence that justifies ARCH-182's key is
   factually wrong about this codebase's claim model, and the accepted-cost paragraph describes a
   narrower gap than the one that shipped. Accepting a weaker posture is a decision; describing it as
   a stronger one is a defect, and that is the only thing I am calling.
2. **Testability vs. surgical change — and here testability should have won, cheaply.** IMPL-380's
   refusal to make `ServerConfig.workRoot` required, and to make `workRootDefault` required, are both
   correct Karpathy calls on a tree ~20 implementers share (B6 is a doc fix, not a code fix). But the
   same "don't disturb the suite" instinct produced **B1**, and there the calculus inverts: the three
   missing assertions disturb nothing — two `':memory:'` unit cases and one integration case — and
   the value they buy is the only mechanism this repo has ever had for a bug class it has now hit
   three times. "Minimum architecture" is not "minimum test"; the Karpathy tie-break is about not
   building speculative *structure*, and a regression lock on a security forward is not speculative.
3. **Scalability vs. security, genuinely orthogonal this round — so I say so rather than manufacture
   tension.** v37 adds two scalar comparisons on a path that already does `INSERT INTO runs`, zero
   queries, two additive columns with `DEFAULT 0`, and one boot-time `spawnSync`. There is no state
   to shard, no counter to make consistent, and no horizontal-scaling question the slice opens. The
   only scale-shaped defect found is **B7**, and it is a log-volume and liveness nuisance, not a
   throughput one. The scalability lens's honest verdict on this slice is *nothing to report*, and
   reporting that is more useful than inventing a concern.

---

## Summary table

| # | Severity | ARCH/INV/ADR violated | Evidence | Lens |
|---|---|---|---|---|
| B1 | HIGH | INV-V37-5 (both clauses), ARCH-177 wiring rule | `src/server.ts:901,1178,1334,1593,813,902`; `src/call-tool.ts:262,271` vs the whole suite (`isRemoteSubmission` in 1 test file, `createdRemote` in 3, none exercising a forward) | testability / security |
| B2 | HIGH | ARCH-182 rationale + closure claim, INV-V37-1 (`unconfined` arm), ADR-086 `owner_decision` premise | `src/mcp-facade.ts:371-377,383` vs `src/webhook-registry.ts:176`, `src/scheduler.ts:294-307`; `src/server.ts:1025`; `src/gateway/claude-agent-sdk-client.ts:748` | security |
| B3 | MED | ADR-086 note (the promised DEPLOY.md sweep) | `DEPLOY.md:540,541,882,901` (no cohort row); `src/webhook-registry.ts:50-64,192-202` vs `src/scheduler.ts:151` | security / operability |
| B4 | MED | ARCH-182 api ("the idiom it already has"), ARCH-181 C-1, DES-150 | `src/webhook-registry.ts:319-323` vs `:68-71,283-308`; `08-validation.md:12617-12621` | security / observability |
| B5 | LOW | REQ-218 acceptance (註解改成事實), ARCH-176 bug class, INV-V37-1 | `src/main.ts:182-183`, `:483`; `src/gateway/claude-agent-sdk-client.ts:826-828` vs `:748`, `:709-728` | security hygiene |
| B6 | LOW | ARCH-177 Gate-8 amendment (stated type) | `src/main.ts:197` vs `02-architecture.md:5539-5540` | ledger accuracy |
| B7 | LOW | ARCH-182's own retryable-vs-permanent reasoning (arch+impl pair) | `src/server.ts:1027-1038`, `:972-1002` | scalability / operability |
| A6 | LOW | ARCH-175 ("deletes the losing arm"), ADR-085 thesis | `src/gateway/bash-confinement.ts:17,21,66-69,85-87` | Karpathy |
| A8 | LOW | ARCH-175 api vs ARCH-176 note | `src/gateway/bash-confinement.ts:77`; ARCH-176 note | security (latent) |

**Recommended blocking set for Gate 8: B1 and B2, for different reasons and with different owners.**
**B1 blocks on the implementer** — three test cases against an invariant this iteration wrote for
itself, whose failure direction is silently insecure. **B2 blocks pending an owner re-answer**: this
gate cannot close it (an architecture gate does not reverse an answered product ruling) and it
cannot pass it either, because ADR-086's `owner_decision` now stands on a premise this review shows
is false for the production host's entire trigger population. This ledger's own pattern is that an
`owner_decision` holds the gate until it is answered — ADR-083 and ADR-086 were both handled that
way — and re-answering it on the corrected premise is the same mechanism, not a new one. **B3 is the
floor if the ruling stands unchanged.**

**Why B2 is an OWNER item and not this gate's to decide.** ADR-086's
ruling was answered on 2026-09-23 on a premise that this review can show does not hold
(「需要操作者自己動手」 is false for any workflow that already owns a trigger, which on the
production host is all of them). The architecture gate does not reverse an answered ruling; it owes
the owner the corrected premise and the two options — re-stamp `createdRemote` at `claim()`, or keep
the key and accept a second, explicitly named residual — plus **B3** as the minimum mitigation if the
ruling stands unchanged.

**B4 is a send-back-with-fix** (widen the 403 arm to carry `code`, call `_recordRefusal`, and stop
flattening retryable throws into Forbidden). **B5/B6/B7/A6/A8** are cleanup and ledger edits that can
ride the same commit.

*Reviewer: adversarial architecture group (security / scalability / testability + Karpathy
tie-break), Gate 8 re-review, 2026-09-23.*
