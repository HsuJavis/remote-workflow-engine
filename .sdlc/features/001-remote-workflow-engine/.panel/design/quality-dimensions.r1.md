---
panel: design
lens: quality-dimensions
round: 1
scope: v11 Sprint 2 — tag-triggered privilege-separated self-update (REQ-068..070 / ARCH-038..040)
---

# Quality-Dimensions Design Review — Round 1

## Summary

This review applies the four cross-cutting quality dimensions to the **detailed design** of ARCH-038
(in-engine HMAC verifier + flag-writer), ARCH-039 (out-of-engine privileged helper), and ARCH-040
(version/outcome observability). The gate-2 architecture is accepted and settled; this review works
within that boundary.

**Altitude determination.** This slice is **system-altitude** self-sustainability machinery — the
engine updating itself, not an agent system designing itself. Agent altitude enters at exactly two
seams: (a) the flag file must live outside any workRoot because an untrusted agent that can write
it gains host RCE via the privileged helper; (b) in-flight agent runs across the update restart are
interrupted and must be manually resumed (ARCH-034 / REQ-059-060 — not automatic). The agent-altitude
reading of each dimension is therefore narrow and noted explicitly where it applies, rather than
forced across all four.

---

## Key Points by Dimension

### 1. Observability

**Canonical gap: the "armed-but-stuck" state is invisible.**

ARCH-038 writes the flag atomically and returns 202. ARCH-040 reads the result file at boot or on
`/api/status` query. But between flag-write and result-file-write the system is in a state where an
update has been requested and not yet executed — and nothing surfaces this. If the systemd `.path`
unit is missing, not enabled, or misfires, or if the helper dies before writing a result file (e.g.
during `git fetch`), the operator sees: flag file on disk, `/api/status` with no update record, no
error. Silent pending state is an observability defect.

**Proposed design remedy (minimal):** At flag-write time (ARCH-038, inside the engine), upsert a
`pending` row in the side table — `{tag: T, status: 'pending', ts: now}` — using the same SQLite
side-table convention as continuations/webhook-registry. The helper's result-file write, ingested at
boot or lazily, overwrites this with `applied` or `failed`. The dashboard update panel (ARCH-040)
reads from the side table, not only the result file, so it always shows the in-progress state.

This is a single `INSERT OR REPLACE` on an existing pattern, not a new subsystem. The canonical
test: trigger a valid webhook + kill the helper before it writes a result → `/api/status` shows
`pending` for that tag, not a silent gap.

**`detail` field bounding.** The helper may produce verbose npm output. ARCH-040 stores the outcome
in a SQLite row. Design must specify a cap on the `detail` field (suggest 4 KB, truncate
head+tail), not unbounded npm stdout. The full log belongs to journald / the helper's own stdout,
not to the side table.

**401/dedup counts.** Invalid-signature rejections and delivery-dedup hits are currently returned as
HTTP status codes with no persistent record. For operator security monitoring these are relevant
signals. They do not need a full audit table — a single in-memory gauge or a counter in the status
endpoint is sufficient. Flag as a design choice to make explicit (even if the choice is "log only,
no counter").

**Distributed trace-ID across the four-process boundary.** The engine, LiteLLM proxy, Claude SDK
CLI subprocess, and now the helper script form a four-process chain. No trace-ID spans the
engine-to-helper boundary. This gap was acknowledged in the ARCH-040 rationale as an out-of-scope
deferred item, and this review endorses that deferral. One sentence in DEPLOY ("the self-update
path does not carry a trace-ID; diagnose failures via journald + the result file") closes the
documentation gap without opening scope.

**Agent-altitude seam (informational).** The flag file on disk is the only cross-process signal
agents cannot tamper with (it lives outside workRoot by construction). This means the observability
of the flag's existence is an operator-only signal — no agent session will ever report it, which
is correct. The update panel (ARCH-040) is the agent-consumable surface.

---

### 2. Replaceability

**ARCH-039 is systemd-only; ARCH-014 ships docker-compose too.**

ARCH-014 documents two deployment paths (systemd and docker-compose). ARCH-039 is structurally a
systemd `.path` + `.service` unit. Docker has no native equivalent of a path-unit trigger. If an
operator runs the engine via docker-compose, the self-update feature is silently absent.

Design must make one of two choices — both acceptable, neither should be left as a gap:

- **Option A (systemd-scoped):** Document explicitly in DEPLOY that self-update requires the
  systemd deployment path. The docker-compose path keeps running but does not self-update. Operators
  on docker-compose must update manually. This is the simplest option and respects Karpathy.

- **Option B (docker-compatible helper):** The privileged helper is a standalone script (not a
  systemd unit); the `.path` unit invokes it, but a cron/inotify/entrypoint sidecar can invoke
  the same script in a docker context. The DEPLOY doc explains both wiring patterns. The helper
  itself is unchanged. This is compatible with the existing command-prefix/env seam.

Either option closes the replaceability gap. Leaving it unresolved means the docker path silently
lacks a feature its DEPLOY doc implies it has.

**Flag and result paths must be config-injectable.** If `updateFlagPath` and `updateResultPath` are
hardcoded in the engine and helper, a docker volume-mount or a non-default install path requires
code changes. Both paths should be `ServerConfig` fields (with documented defaults) so an operator
can adjust them without a fork. This also satisfies the helper's testability seam: the integration
test injects a temp-dir flag/result path, not a production one.

**Command-prefix/env seam (already planned in ARCH-039).** The proposed seam for `git`,
`npm`, and `systemctl` is the replaceability seam for the deployment substrate. Ensure the
seam is config-injectable (via `env` substitution or a wrapper path) and not only a test-time
injection. This matters when an operator runs NVM-managed Node or system-managed npm via a different
path.

**Secret model.** `RWE_SECRET_GITHUB_WEBHOOK_SECRET` via `loadSecretSourceFromEnv` is consistent
with the existing resolver port. Swapping to a vault backend in a future iteration requires no
helper-script change. Good.

---

### 3. Consumability

**The GitHub webhook configuration screen is the primary integration surface — design it explicitly.**

The operator's integration cost is highest at GitHub webhook setup. DEPLOY must specify all of the
following; missing any one produces a hard-to-diagnose failure:

1. **Content type: `application/json`** (not the GitHub default `application/x-www-form-urlencoded`).
   If left at default, GitHub delivers a form-encoded body; the HMAC verifies (it is computed over
   the raw delivered bytes regardless), but the JSON parse after verification fails — or worse,
   silently produces `args.event = {}`. This is the highest-severity omission: the webhook appears
   to work (202, no error) but fires the workflow with wrong args.

2. **Which events to subscribe.** The `create` event fires for tag creation; `push` events with a
   `ref` starting `refs/tags/` also cover some tag scenarios. Design must specify which GitHub
   event types the engine's handler accepts and the DEPLOY must match.

3. **Secret env var:** `RWE_SECRET_GITHUB_WEBHOOK_SECRET` — name it in DEPLOY with the
   `loadSecretSourceFromEnv` sourcing instruction (same as `RWE_SECRET_GITHUB_TOKEN`).

4. **Reverse-proxy forwarding.** The engine stays loopback-bound. DEPLOY must give a concrete
   nginx/caddy snippet forwarding only `POST /hooks/<self-update-id>` (or a dedicated path for the
   GitHub tag webhook) to `127.0.0.1:8787`. This is the deployment decision the architecture
   explicitly delegated to the operator.

**Host allowlist interaction with the forwarded webhook.**

ARCH-038 notes: "this route is either allowlisted or exempted, HMAC being its auth." The design
must close "either." For a GitHub-forwarded request, the `Host` header arriving at the engine is
the operator's public domain — not `127.0.0.1`. Two concrete options:

- **Exempt the GitHub-webhook path from the Host check** (ARCH-033's `isAllowedHost` skips this
  route). HMAC verification is the auth on this path — it is strictly stronger than the Host
  allowlist. This is the recommended option: the allowlist defends against DNS-rebinding browser
  attacks, not against a server-to-server GitHub POST.

- **Require the reverse proxy to rewrite `Host: 127.0.0.1:8787`** before forwarding. This is
  operationally fragile (one misconfigured proxy = 403 on every webhook) and forces the operator
  to understand the guard.

**Pick Option A (exempt) in design; document it in DEPLOY.** The exemption is one `if (path ===
'/hooks/github-update')` before the allowlist check — not a structural change.

**In-flight runs are interrupted on update restart.** After a self-update restart, in-flight runs
become `interrupted` (ARCH-034). The only path to resume them is `workflow_resume(runId)` — a
manual operator action. From a consumer's standpoint, the update panel (ARCH-040) must surface the
count of interrupted runs at the time of the restart, with a clear call-to-action (e.g. "2 runs
were interrupted by the update; use `workflow_resume` to restart them"). Without this, an
operator who just updated the engine has no signal that work was dropped, and no prompt to act.

**`GET /api/version` shape.** The endpoint already exists (ARCH-040). Ensure the response schema
is documented in DEPLOY (suggest `{version: string, gitTag?: string}`) so callers can parse it
programmatically, not just display it.

---

### 4. Self-sustainability

**This is the central dimension for this slice — the system managing its own lifecycle.**

**The REQ-070 "fully automatic" claim hides a manual step for interrupted runs.**

REQ-070 mandates full-auto apply. ARCH-039 says "in-flight runs resume via REQ-059/060 journal
replay." ARCH-034 (crash durability) makes interrupted runs resumable — but via `workflow_resume`,
a manual MCP tool call. A self-update restart is operationally identical to a crash from the
engine's perspective; the same journal-replay machinery applies. The result is: a fully-automatic
update that leaves in-flight runs silently parked as `interrupted`.

Design-level resolution:

- **Minimum (this slice):** The update outcome row (ARCH-040) must include a count of runs that
  were in the `running` state when the restart occurred (available from `hydrateAll`'s
  "reclassified running→interrupted" log). Surface this count in the update panel.

- **Open design question (NOT a proposal for this slice):** Should `config.autoResumeOnUpdate:
  boolean` (default false) trigger automatic `workflow_resume` for all interrupted runs immediately
  after boot? Flag as an open question for the Sprint-2 design iteration. Auto-resume is NOT
  proposed here — it has non-trivial implications for runs that were intentionally stopped mid-run,
  and for runs with expensive retried agents. Flagging it is the minimal self-sustainability
  design note.

**Budget-on-crash-resume gap (real defect candidate, inherited from ARCH-034 + ARCH-040 rationale).**

After a self-update restart, a resumed `interrupted` run's in-memory `RunGuard.spent` is
reconstructed from the journal. ARCH-034 populates the ResumeCache from the journal but does NOT
re-derive `budget.spent()` from the journaled agent usage events. This means a resumed run may
have `budget.spent() = 0` even if pre-crash agents consumed tokens, and subsequent `agent()` calls
can exceed the budget silently. This was flagged in the ARCH-040 rationale as "one worth carrying
forward as a real defect candidate."

Detail design for ARCH-038/039/040 does not own this fix — it lives in ARCH-034's
`_requireLive` path. But the self-update slice is what makes the scenario operationally common
(every update = a controlled crash). Design should add a task: re-derive `budget.spent()` from
the `agent-<id>.jsonl` usage events on `_requireLive` rehydration, before flagging runs as
`interrupted`. This closes the gap at the right seam.

**Flag file consumption after helper reads it.**

If the helper does not rename/remove/zero the flag file after consuming it, the systemd `.path`
unit may re-trigger on the next filesystem event and fire the helper again. ARCH-039 specifies
"idempotent apply" (no-op if already on T) which makes repeated triggers safe — but it is wasteful
(git fetch on every trigger). Design should specify the flag lifecycle: the helper renames the flag
to `<flagpath>.consumed` or removes it after a successful or failed update, so the `.path` unit
does not re-arm from a stale flag. The `pending` row (Observability section) handles the case
where the operator wants to know about in-progress state before the flag is consumed.

**Safe-fail is the highest-priority test in the slice.**

ARCH-039's claim "safe-fail is a TESTED branch" is correct and load-bearing. Design should specify
the concrete test fixture for the task decomposition:

1. Inject a fake `npm run build` that returns exit code 1.
2. Assert `systemctl restart` is NOT called.
3. Assert the checkout directory still contains the prior tag's HEAD.
4. Assert the result file records `{status: 'failed', tag: T, detail: <truncated>}`.
5. Assert the engine's update panel shows `failed` for T without interrupting the running engine.

This test must run in CI against a throwaway git repo (not production) — the command-prefix/env
seam is the instrument.

**flock serialization and latest-tag-wins.**

Close tags (v1.4.0 then v1.4.1) can produce two flag writes in rapid succession. The `.path` unit
may trigger the helper twice. flock prevents interleaving a checkout/build, but design must specify
that the helper reads the flag value WITHIN the flock (after acquiring the lock), not before.
Otherwise latest-tag-wins may silently apply v1.4.0 while v1.4.1's flag is on disk. This is a
one-line ordering requirement for the helper script but load-bearing for the correctness of
rapid-tag scenarios.

**Global RunGuard semaphore across restart.**

When the engine restarts (self-update or crash), the in-memory global RunGuard semaphore starts
fresh. Interrupted runs are NOT holding semaphore slots — they are correctly excluded by the
`interrupted` status check in the slot-claim logic. This is the expected behavior (and consistent
with ARCH-034's design), but design should confirm this invariant explicitly as a test case so it
cannot regress: boot with N interrupted runs → all N are available for `workflow_resume` without
hitting a spurious `RUN_ADMISSION_LIMIT`.

**Agent-altitude note (informational).**

The agent altitude of self-sustainability — memory metabolism, tool-liveness checks, prompt
self-calibration — is not applicable to this slice. The engine's agents do not manage the engine
itself; the engine manages itself through ARCH-038/039/040. The relevant agent-altitude gap
(journal archival to avoid unbounded disk growth as agent transcripts accumulate) was noted in the
Gate-2 rationale as out-of-scope; this review endorses that deferral.

---

## Risks

| ID | Risk | Severity | Notes |
|----|------|----------|-------|
| R1 | GitHub webhook `content-type` misconfiguration → webhook appears to work but fires with wrong args | HIGH | DEPLOY must be explicit; no runtime check catches this |
| R2 | "armed-but-stuck" state invisible to operator if helper never runs | HIGH | Pending row at flag-write is the remedy |
| R3 | In-flight runs interrupted on auto-update with no prompt to resume | MEDIUM | Update panel must surface interrupted-run count |
| R4 | Budget-on-crash-resume: `spent()` reset to 0 on rehydration | MEDIUM | Inherited from ARCH-034; self-update makes it operationally common |
| R5 | Helper reads flag before flock → latest-tag-wins fails under rapid tags | MEDIUM | One ordering requirement in the helper script |
| R6 | Docker-compose path silently lacks self-update, no DEPLOY documentation | LOW | Silence creates false expectations; document scope explicitly |
| R7 | `detail` field unbounded in SQLite row | LOW | 4 KB cap; full log to journald |

---

## Task-Splitting Notes (where dimension concerns affect decomposition)

These are not task proposals — design-synthesis writes tasks. These are dimension-driven constraints
on how the three ARCH units should be split:

- **ARCH-038** (flag-writer) is independently testable via a fake flag-sink seam. One task. The
  Host allowlist decision (exempt vs allowlist for this route) should be locked in this task before
  ARCH-033 integration work begins.

- **ARCH-039** (helper script) needs its own integration-test harness: a throwaway git repo +
  fake `npm run build` + fake `systemctl`. The safe-fail branch test must be a first-class test
  case, not an afterthought. Flag/result-path seams and command-prefix/env seam should be
  config-injectable — wired in this task, not only test-time.

- **ARCH-040** (version/outcome surface) has two distinct read points — boot read and lazy read
  — that should be separate test cases. The pending-row upsert at flag-write (proposed in
  Observability) belongs to this task's side-table definition. The interrupted-run count in the
  update outcome belongs here too, cross-referencing ARCH-034's `hydrateAll` count.

- **DEPLOY doc** must be its own task with explicit acceptance criteria: GitHub webhook content-type
  instruction, secret env var name, reverse-proxy config snippet, Host-allowlist exemption
  documentation, flag/result path convention, and self-update scope (systemd-only vs docker
  replaceability choice).

- **Budget-on-crash-resume fix** belongs to ARCH-034's rehydration path, not ARCH-038/039/040.
  Flag as a dependency: the self-update design should reference ARCH-034 for this gap so it is
  not treated as someone else's problem.

---

## Expected Disagreements with Other Lenses

**Adversarial lens** will likely re-push GPG `git tag -v` signed-tag verification (deferred in
ARCH-040 rationale). This dimension does not propose building it — the Gate-2 rationale ruled it
a Karpathy defer. The scope boundary holds: the risk (a malicious tag whose build succeeds) is
accepted, bounded by repo/secret integrity + the official-remote-pin. I will not re-open this.

**Simplicity/Karpathy lens** will read the pending-row suggestion (Observability) as scope creep.
Counter: it is a single `INSERT OR REPLACE` on an existing side-table pattern — smaller than the
dedup row in WebhookRegistry — and it closes a load-bearing observability gap (silent pending
state). Not a new subsystem.

**Simplicity lens** may also resist the docker-compose gap documentation (Replaceability) as
out-of-scope. Counter: failing to document it is not simpler — it creates operator confusion
when docker-compose users discover self-update silently does nothing. One paragraph in DEPLOY
is the minimum.

**Adversarial lens** may propose auto-resume of interrupted runs on boot as a security concern
(auto-resuming a run that was intentionally stopped mid-flight for security review). This dimension
explicitly does NOT propose auto-resume — it proposes surfacing the interrupted count and flagging
auto-resume as an open question. The adversarial concern is valid and reinforces the "flag but don't
build" stance.
