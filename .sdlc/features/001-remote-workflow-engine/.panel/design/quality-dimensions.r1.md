# Quality-Dimensions — Design Panel r1
**feature:** 001-remote-workflow-engine
**iteration:** v13
**stage:** design (Gate 4 input)
**lens:** Quality-dimensions (Observability / Replaceability / Consumability / Self-sustainability)
**altitudes:** System + Agent (both apply — see classification below)
**round:** 1 (independent proposal)
**date:** 2026-08-15
**author:** quality-dimensions subagent (sonnet)

---

## Summary

This review is scoped to v13 (REQ-080, ARCH-052, ARCH-053). The architecture panel
already resolved the v13-specific quality asks — fetch timeout (R4 from the arch review),
fetch-outcome observability (arch gap #4), and consumability docs (arch gap #16) — by
folding them into ARCH-052/053 and decisions D-v13-E/F. The architecture is sound as
specified. This design review goes one level deeper: it binds concrete type signatures,
surfaces design-seam gaps that the implementation will hit if left unresolved, and flags
unresolved choices that could cause quality regression when tasks are written.

The pre-existing cross-cutting gaps (trace-ID R1, RunStorePort R2, circuit-breaker R3,
/health R6, journal archival R7) are carried as one-line noted-deferred items per the
Gate 2 ruling — they are NOT re-escalated here.

**Project classification.** The RWE is both a conventional Node.js/TypeScript service
(system altitude) and an AI-agent orchestration runtime (agent altitude). Both altitudes
apply to all four dimensions, same as the architecture review. Nothing in v13 changes
this classification.

---

## Key Points

### Dimension 1 — Observability

#### System altitude

**O-S1 — Fetch-outcome shape must be pinned to `RunStatusView`, not left to a log line.**

ARCH-053 commits to "fetch-outcome observability [resolved sha, bytes, latency]" but
does not specify WHERE it lands. A log line is insufficient: a caller polling
`workflow_status` (MCP) or `GET /api/runs/:id` (HTTP) has no access to an internal
log, and a failed or slow seedRef fetch is invisible to them without a structured field.

**Design proposal:** Add an optional `seedRef` field to `RunStatusView`:

```typescript
interface RunStatusView {
  // ... existing fields ...
  seedRef?: {
    resolvedSha: string;
    bytes: number;
    elapsedMs: number;
    fetchedAt: string;         // ISO-8601
    failCode?: 'SEEDREF_FETCH_FAILED' | 'SEEDREF_SHA_MISMATCH';
    failDetail?: string;       // truncated at 200 chars; no secrets
  };
}
```

The `failCode` + `failDetail` fields survive on a failed run so an operator can
distinguish "network unreachable" from "sha mismatch" without reading the engine log.
`failDetail` must be truncated and must not include any credential or resolved secret.

**O-S2 — `isEgressAllowed` denial must not enumerate the allowlist in the error.**

The denial error is observable (returned to the MCP caller). It must carry the
attempted-scheme and authority for operator diagnosis without listing the configured
allowlist prefixes (which would make the allowlist a discovery oracle on the no-auth
plane — consistent with D-REDACT precedent).

Design proposal: `SEEDREF_EGRESS_DENIED` error payload includes `attempted: { scheme,
host }` (NOT the full URL, NOT the allowlist contents); `SEEDREF_DISABLED` payload
carries `hint: "configure seedRefAllowlist in engine config"` naming the config key.

**O-S3 — `seedSource` field on the durable run record.**

The run record today does not distinguish how a run was seeded (`seed` / `seedManifest`
/ `seedRef` / inline). Adding `seedSource: 'inline' | 'seed' | 'seedManifest' |
'seedRef'` (mirroring `startedBy` from ARCH-041) to `RunSpec` / the `runs` table makes
`GET /api/runs/:id` self-describing for seedRef runs. This is additive and costs one
column.

Carried from arch review: R1 (trace-ID), R2 (RunStorePort), R3 (circuit-breaker) — all
remain deferred-future-REQ candidates; not escalated here.

#### Agent altitude

**O-A1 — `resolvedSha` should appear on the per-run observable record, not only the
fetch-outcome log.**

The unconditional sha-verify in ARCH-053 makes a seedRef run deterministic: agent
behaviour is reproducible iff the workspace is the same tree. For an operator to
re-trigger a run at the same commit, they need the `resolvedSha` from `workflow_status`,
not from a log.

`O-S1`'s `seedRef.resolvedSha` on `RunStatusView` satisfies this — no separate
agent-level capture is needed. Note: `resolvedSha` belongs on the RUN record (per run,
set by the fetcher), NOT on `AgentRecord` or `kind:'harness'` transcript events. This
preempts a design drift where the sha is written once per agent instead of once per run.

---

### Dimension 2 — Replaceability

#### System altitude

**R-S1 (HIGH) — `SeedRefFetcher` port interface must be specified at design time.**

ARCH-053 introduces `SeedRefFetcher` as an "injected port" but does not define the
interface. Without a concrete TypeScript `interface`, the fake used in RunManager unit
tests and the real git-subprocess impl can drift independently. Design time is the right
place to pin this — it is the contract the test fake is written against.

**Design proposal:**

```typescript
// src/seedref-fetcher.ts

export interface SeedRefFetcher {
  fetch(
    repoUrl: string,
    sha: string,
    opts: {
      timeoutMs: number;
      namespace: string;    // CAS namespace; mirrors CasStore.seedNamespace
    }
  ): Promise<SeedFetchOutcome>;
}

export type SeedFetchOutcome =
  | { ok: true;  resolvedSha: string; bytes: number; elapsedMs: number }
  | { ok: false; code: 'SEEDREF_FETCH_FAILED' | 'SEEDREF_SHA_MISMATCH'; detail: string };
```

The `opts` bag (not positional args) allows a future `authToken?: string` (D-v13-F
future slice) to be added without breaking any injected fake. This is the minimum
future-compatibility guard the deferred private-repo path needs.

**R-S2 — `isEgressAllowed` return-type contract must also be pinned.**

ARCH-052 says "exported pure function" but leaves the return type open. Locking it
prevents the error code from drifting between callers:

```typescript
// src/seedref-egress.ts  (or seed-validator module)

export type EgressVerdict =
  | { allowed: true }
  | { allowed: false; code: 'SEEDREF_DISABLED' | 'SEEDREF_EGRESS_DENIED' };

export function isEgressAllowed(
  repoUrl: string,
  allowlist: readonly string[]
): EgressVerdict { ... }
```

The typed `code` in the verdict routes directly into the pre-createRun error path
without a string-comparison branch.

#### Agent altitude

**R-A1 — No new replaceability concerns at agent altitude from v13.**

D-v13-F defers private-repo/secrets. The `SeedRefFetcher.opts` bag (R-S1) is the only
forward-compatibility surface needed. SDK coupling (arch R5) remains deferred.

---

### Dimension 3 — Consumability

#### System altitude

**C-S1 (MEDIUM) — `seedRef` parameter must appear in `workflow_run` TOOL_DEFS with
explicit schema and must be covered by the schema drift-lock test.**

ARCH-051/TASK-076 established the `schema-drift.test.ts` pattern: every new/changed MCP
tool parameter must have `type`, `default`/`required` status, enumeration/range, and
effect documented. REQ-080's `seedRef` is a new `workflow_run` parameter. The drift-lock
test must be extended for v13.

Minimum TOOL_DEFS entry for `seedRef`:

```typescript
seedRef: {
  type: 'object',
  description:
    'Engine-pull seed: fetch the repo AT the exact sha over HTTPS and assemble ' +
    'the workspace. Requires seedRefAllowlist in engine config (SEEDREF_DISABLED if ' +
    'absent). Mutually exclusive with seed and seedManifest (SEED_SOURCE_CONFLICT). ' +
    'Returns runId immediately; fetch runs post-admission and may fail the run typed ' +
    '(SEEDREF_FETCH_FAILED, SEEDREF_SHA_MISMATCH).',
  properties: {
    repoUrl: {
      type: 'string',
      description: 'https:// URL of the repository. Must match an allowlist prefix.'
    },
    sha: {
      type: 'string',
      description: 'Full 40-hex-char commit sha to fetch. Verified unconditionally after fetch.'
    }
  },
  required: ['repoUrl', 'sha']
}
```

Drift-lock assertions to add to `schema-drift.test.ts`:
- `seedRef` parameter present in `workflow_run` schema
- `seedRef.properties.repoUrl` present
- `seedRef.properties.sha` present
- Tool description includes the string `"SEEDREF_DISABLED"` (names the error code)
- Tool description includes the string `"seedRefAllowlist"` (names the config key)
- Tool description includes the string `"mutually exclusive"` (names the constraint)

**C-S2 (MEDIUM) — Pre-run vs post-run error split must be explicit in the tool
description.**

The five v13 error codes fall into two tiers:

| Tier | Codes | `runId` present? | Observable via |
|------|-------|-----------------|----------------|
| Pre-run (pre-createRun) | `SEEDREF_DISABLED`, `SEEDREF_EGRESS_DENIED`, `SEED_SOURCE_CONFLICT` | No | `workflow_run` response directly |
| Post-run (post-createRun) | `SEEDREF_FETCH_FAILED`, `SEEDREF_SHA_MISMATCH` | Yes | `workflow_status` after polling |

A caller who does not understand this split will poll for a `runId` that never existed
(for pre-run errors) or fail to poll (for post-run errors). The tool description for
`workflow_run` must make this split explicit — not bury it in five error codes listed
without context. One sentence is sufficient: "Pre-admission rejections return no runId;
fetch failures fail the run after it is created and are visible in workflow_status."

**C-S3 — `SEEDREF_DISABLED` error must carry a config-key hint.**

Per REQ-079 convention (precedent: ARCH-051/TASK-076): an actionable error names what
to configure. `SEEDREF_DISABLED` should carry `{ code: 'SEEDREF_DISABLED', hint:
'add seedRefAllowlist: [\"https://...\"] to engine config to enable seedRef' }`. This
is the only error code where the operator can self-recover with a config change; the
others (EGRESS_DENIED, CONFLICT, FETCH_FAILED, SHA_MISMATCH) are call-site errors.

#### Agent altitude

**C-A1 — Allowlist non-disclosure: `SEEDREF_EGRESS_DENIED` must not enumerate allowlist
prefixes.**

A workflow script author invoking seedRef cannot discover the allowlist. Per D-REDACT
(no discovery on the no-auth plane), the `SEEDREF_EGRESS_DENIED` error should carry a
non-enumeration hint: "repoUrl not in configured allowlist — contact operator" rather
than listing entries. Design must confirm this form for the error payload.

---

### Dimension 4 — Self-sustainability

#### System altitude

**S-S1 (MEDIUM) — `timeoutMs` default and config key must be named at design time.**

D-v13-E commits "timeout decided at architecture time, not deferred" but names neither
the default value nor the config key. Leaving both to the implementation task creates
the same foot-gun as the SDK-gateway timeout gap (the D-F5 late fix cited in D-v13-E).

**Design proposal:**
- Config key: `seedRefTimeoutMs`
- Default: `30_000` (30 s) — consistent with the gateway timeout convention
- Minimum: `5_000` (5 s, enforced at config-load with an actionable error message)
- Validated at config-load (same convention as `maxConcurrentRuns`, `maxWorkflowDepth`)

Any task writing the ARCH-053 fetcher must carry these three values. The config-load
validator rejects `seedRefTimeoutMs < 5000` with: "seedRefTimeoutMs must be >= 5000ms;
received <value>."

**S-S2 (MEDIUM) — Subprocess kill on timeout must be explicitly required in the fetcher
design, not left implicit.**

ARCH-053 says `timeoutMs` enforces a wall-clock bound, but does not specify HOW. If the
implementation uses `Promise.race` without killing the child process, a timed-out git
fetch continues running in the background: it holds system resources, potentially
completes the fetch (wasting bandwidth), and — critically — may still hold the
run-admission slot counter in an inconsistent state.

**Design requirement:** The fetcher must `Promise.race([gitFetchPromise,
timeoutReject(timeoutMs)])` AND call `child.kill('SIGTERM')` (with a SIGKILL fallback)
on timeout unconditionally — the same "D-KILL orphan-prevention" pattern as the SDK CLI
subprocess. This must be stated in the fetcher's design note (DES-NNN), not left to the
implementer's judgment.

**S-S3 — D-v13-D residual: fetch-holds-slot must be documented for operator sizing.**

D-v13-D (no fetch worker pool) is accepted. The design consequence: concurrent seedRef
runs hold run-admission slots for the duration of the fetch. A burst of seedRef calls
against a slow forge can exhaust `maxConcurrentRuns` and block non-seedRef runs for up
to `seedRefTimeoutMs`.

This residual is bounded: at most `maxConcurrentRuns` concurrent fetches, each bounded
at `seedRefTimeoutMs`. Worst case: `maxConcurrentRuns × seedRefTimeoutMs` of total slot
occupancy. The DEPLOY documentation (or the config-load validator comment) should note
this pairing so operators can size them together (e.g. "to allow seedRef without
starving interactive runs, set maxConcurrentRuns > expected concurrent seedRef
callers").

**S-S4 — Env isolation requirement must be stated as a design invariant, not a comment.**

ARCH-053 lists the required git env flags (`GIT_CONFIG_NOSYSTEM=1`, isolated HOME,
`GIT_ALLOW_PROTOCOL=https`, `-c http.followRedirects=false`, `-c
submodule.recurse=false`, `GIT_TERMINAL_PROMPT=0`) and explicitly says the fetcher
"MUST NOT reuse `workspace-git.ts`'s un-isolated `...process.env`." This is the
self-protection against config injection bypassing the egress gate.

The design note must state this as a testable invariant: the fake-git test helper in
the integration test MUST assert that the subprocess receives NONE of the ambient
`process.env` keys that could carry git credential helpers or `insteadOf` rewrites (at
minimum: `GIT_CONFIG_GLOBAL`, `HOME`, `GIT_CONFIG_NOSYSTEM` must be overridden, not
inherited). A unit test that passes an `insteadOf`-bearing env to the real impl and
confirms `SEEDREF_EGRESS_DENIED` (the gate fires before the subprocess) is the
adversarial test; the env-isolation test confirms what the subprocess WOULD do if it ran.

#### Agent altitude

**S-A1 — sha-verify algorithm must be specified in the design.**

ARCH-053 mandates "unconditional sha-verify" after `--depth 1` fetch. With a shallow
clone, the full commit chain is absent; the verify must therefore confirm the fetched
commit IS the requested sha WITHOUT traversing ancestors.

**Design proposal for the verify step:**

1. `git rev-parse HEAD` after `git checkout <sha>` — must equal the requested `sha`
   exactly (40-hex).
2. `git cat-file -t <sha>` — must return `commit` (rejects tag objects, blob objects,
   and any sha that is not a commit).
3. Any deviation → `SEEDREF_SHA_MISMATCH`.

Step 2 is the guard against a forge returning a sha that is a different object type
(a blob or tree) that still matches the hex string — a confused-deputy path the
allowlist gate cannot see. Both steps run inside the hardened env.

---

## Risks

| ID | Title | Sev | Dimension | Altitude | Addressed by |
|----|-------|-----|-----------|---------|--------------|
| D-R1 | `SeedRefFetcher` port has no defined TypeScript interface — fake and impl can drift silently | HIGH | Replaceability | System | R-S1 above; must be in the fetcher task's definition-of-done |
| D-R2 | Fetch outcome not bound to `RunStatusView` — observable only in internal logs, invisible to MCP callers | HIGH | Observability | System | O-S1 above; must ride IN the fetcher task, not a follow-up |
| D-R3 | `timeoutMs` default + config key unspecified — leaves a foot-gun identical to the D-F5 gap | MEDIUM | Self-sustainability | System | S-S1 above; must be in the fetcher task |
| D-R4 | Subprocess kill on timeout not required — orphan git process possible | MEDIUM | Self-sustainability | System | S-S2 above; must be stated in DES-NNN for the fetcher |
| D-R5 | Pre-run vs post-run error split not in tool description — callers may poll for a run that was never created | MEDIUM | Consumability | System | C-S2 above; rides the schema/TOOL_DEFS task |
| D-R6 | `seedRef` not covered by schema drift-lock — REQ-079 compliance gap | MEDIUM | Consumability | System | C-S1 above; extend `schema-drift.test.ts` in a dedicated task |
| D-R7 | `isEgressAllowed` return type not pinned — error code naming can drift between gate and RunManager | LOW-MEDIUM | Replaceability | System | R-S2 above |
| D-R8 | sha-verify algorithm unspecified — shallow clone leaves an alternative-object-type confused-deputy path open | LOW-MEDIUM | Self-sustainability | Agent | S-A1 above; must be in fetcher design note |
| D-R9 | D-v13-D residual undocumented — operators cannot size `maxConcurrentRuns` + `seedRefTimeoutMs` together | LOW | Self-sustainability | System | S-S3 above; DEPLOY or config comment |

### Carried from architecture review (deferred, not re-escalated)

- R1 (HIGH): No end-to-end trace ID — pre-existing, future-REQ candidate
- R2 (HIGH): RunStore/Catalog without port interface — pre-existing, future-REQ candidate
- R3 (HIGH): No stateful circuit-breaker — pre-existing, future-REQ candidate
- R5 (MEDIUM): SDK coupling non-abstract — pre-existing, future-REQ candidate
- R6 (MEDIUM): No `GET /health` — pre-existing, future-REQ candidate
- R7 (MEDIUM): Journal/SQLite unbounded growth — pre-existing, future-REQ candidate

---

## Task-Splitting Advice

TASK-077+ do not yet exist (03-tasks.md ends at TASK-076 for v12). The following
splitting is advised from a quality-dimensions perspective:

**Recommended task boundary split:**

1. **TASK-077: `isEgressAllowed` + seed-source mutual exclusion + config-load validation
   (ARCH-052)** — pure, zero I/O, all SSRF edge-case unit tests land here. Should
   include the `EgressVerdict` typed return, `seedRefAllowlist` config-load validator
   with actionable errors, the `SEEDREF_DISABLED` hint payload, and `SEED_SOURCE_CONFLICT`
   in the submission validator. The drift-lock test extension (C-S1) MAY ride here as
   the schema change to `workflow_run` TOOL_DEFS is part of this task's surface. If not,
   it must be a SEPARATE task (see below).

2. **TASK-078: `SeedRefFetcher` port interface + hardened git impl + sha-verify +
   CAS-assemble + fetch-outcome on `RunStatusView` (ARCH-053)** — this is the network
   task. Quality-dimensions constraint: the fetch-outcome observability (O-S1) MUST ride
   IN this task, not be deferred to a later "observability" task. The definition-of-done
   must include: `RunStatusView.seedRef` is populated on success AND on failure, visible
   via `workflow_status`. `timeoutMs` default + subprocess kill (S-S1/S-S2) must be in
   this task's design note.

3. **TASK-079: `workflow_run` TOOL_DEFS `seedRef` parameter schema + schema drift-lock
   extension (C-S1)** — if not already in TASK-077. This is the REQ-079 compliance
   task for v13; should reuse the TASK-076 pattern. May be folded into TASK-077 if the
   schema change is small.

The critical dependency: TASK-078 depends on TASK-077 (the gate fires before the
fetcher runs; the fetcher must never be invoked without a passing `isEgressAllowed`
verdict). The `SeedRefFetcher` INTERFACE (R-S1) must be defined before TASK-078 writes
the fake. Suggest: define the interface in TASK-077 (it has no I/O dependency) and have
TASK-078 implement it.

---

## Expected Disagreements with Other Lenses

**With the adversarial lens:**

1. **R-S1 (`SeedRefFetcher` interface)**: The adversarial lens may argue the injection
   seam "implies" the interface and explicit TypeScript types are over-specification. This
   review holds: without an interface, the test fake and real impl have no shared contract
   to enforce; the typed `SeedFetchOutcome` discriminated union is the minimum that makes
   the fake compile-time-verifiable.

2. **S-A1 (sha-verify algorithm)**: The adversarial lens may already have specified
   the verify algorithm in its r1 (security emphasis). If so, the adversarial and quality
   stances converge; the design note just needs to confirm the algorithm handles the
   shallow-clone/object-type case. If not, this is genuinely unspecified at architecture
   level and the design must close it.

3. **O-S1 (`RunStatusView.seedRef` field)**: The adversarial lens may classify fetch
   observability as a "nice-to-have log line," not a structural field on the run record.
   Quality-dimensions holds: a caller polling `workflow_status` cannot access internal
   logs; the field is the MCP-observable surface. The precedent is `startedBy` (ARCH-041)
   — similarly "nice to have" operationally but promoted to a durable field because the
   dashboard is not the only consumer.

**With the synthesizer (if these findings cause scope-creep concern):**

4. **`seedSource` field (O-S3)**: May be seen as out of v13 scope. This review
   accepts it could be deferred if the synthesizer rules it a follow-on; the
   `RunStatusView.seedRef` (O-S1) already implies a seedRef run, so `seedSource` is
   low-priority. It is noted here for completeness.

5. **`SEEDREF_DISABLED` config-key hint (C-S3)**: The adversarial lens or synthesizer
   may find "hint in error payload" overengineering for a config error. Quality-dimensions
   holds: this follows the REQ-079/ARCH-051 pattern already established by TASK-076 for
   `system_info.topN`; the config key is NOT discoverable from the error code alone.

**No conflict anticipated with the adversarial lens on:**
- D-v13-B (no blanket private-IP ban) — both lenses converged at architecture; not
  re-opened here.
- D-v13-C (DNS-rebind accepted residual) — same; not re-opened here.
- Env isolation (S-S4) — quality and adversarial both held this; the design note just
  needs to make it testable.
- Subprocess kill on timeout (S-S2) — consistent with the existing D-KILL pattern;
  the adversarial lens should hold the same.
