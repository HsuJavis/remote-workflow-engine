# Gate-2-vs-implementation review — lens: Quality-dimensions expert (Observability / Replaceability / Consumability / Self-sustainability)

Scope: v37 slice only (REQ-218 Bash confinement, REQ-219 dead-code deletion), per `06-impl-log.md`
IMPL-371..379 `files:` lists. Compared against `02-architecture.md` ARCH-175..181,
ADR-082/083/084/085, INV-V37-1/2/3.

Files read: `src/gateway/bash-confinement.ts`, `src/gateway/confinement-probe.ts`,
`src/gateway/claude-agent-sdk-client.ts`, `src/gateway/client.ts`, `src/main.ts`, `src/call-tool.ts`,
`src/server.ts`, `src/workroot-guard.ts`, `src/event-log.ts`, `src/authoring-guide.ts`,
`src/mcp-facade.ts`, `src/errors.ts`, `src/tool-specs.ts`, `src/path-containment.ts`, `src/net-guard.ts`,
`DEPLOY.md`, `rwe.config.example.json`, `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`
(schema ground-truth), `tests/unit/compose-config-v2-wiring.test.ts`,
`tests/unit/error-catalog-closed.test.ts`.

---

## 1. Observability

**Finding O-1 (MEDIUM) — `agent.confinement_denied` is architecturally due, spike-confirmed, and not built; the ADR's own conditional was never revised to say "no longer applies."**

ARCH-178's `api:` clause is written as a conditional, not a wish: *"emitted from a `PostToolUseFailure`
hook … **if and only if spike S4 shows that hook fires for a sandbox-denied command**. If it does not,
this second event is **not built** and the ADR says so."* TASK-250's spike answered the condition:
`evidence/v37-spike/S4.md` — **S4 POSITIVE**, `PostToolUseFailure` fires for a sandbox-caused Bash
failure with `tool_name`/`tool_input.command`/`error` (06-impl-log.md IMPL-371). Per ARCH-178's own
stated rule, a positive S4 is the condition under which the row says the event **should** exist.

`src/event-log.ts:21` shows the `TranscriptEvent` union carries exactly one confinement-related kind,
`agent.confinement` — `agent.confinement_denied` does not exist anywhere in `src/`. IMPL-374 records
this explicitly ("`agent.confinement_denied` (S4-gated) is also NOT built — S4 fired positive but no
Gate-5 red test asks for it … named as an open gap"), which is honest about the gap but does not
constitute an architecture revision: ARCH-178's own text, unedited, still reads as if a positive S4
means the event ships. The row was not amended to say "deferred to v38 despite S4" — it simply
wasn't finished, and the ledger's own convention (ADR text = the standing decision) means a reader of
`02-architecture.md` alone would believe this event exists.

Consequence under this lens: on a `confined` deployment, a real kernel-level Bash denial reaches the
operator only as the agent's own failed tool result — an ordinary tool-call failure indistinguishable
from any other Bash error, with no purpose-built audit line naming it as a *confinement* denial. This
is exactly the "silent/opaque failure is a design defect" case the lens exists to flag, and the
architecture itself already agrees (ARCH-178: "a denial must be a positively emitted fact or not
claimed at all") — the gap is that the *not claimed* half was never written back into the row once S4
turned positive.

Not counted as a violation but adjacent: INV-V37-3 (no VAL evidence against a zero-importer module) and
the "automated INV-V37-3 checker" are correctly filed as v38 candidates with a stated trigger — that
deferral pattern is done right elsewhere in this same file; O-1 is the one place a spike result
should have triggered either the build or an explicit row amendment and got neither.

**Finding O-2 (LOW) — `confinement-probe.ts`'s own doc comment overclaims where `reason` is visible.**

`src/gateway/confinement-probe.ts:17-18`: `reason` is documented as present "so an operator reading
the boot line (**or the confinement-posture ARCH-178 event**) sees WHY, not just THAT." But the actual
`agent.confinement` event shape (`src/event-log.ts:21`) is
`{runId, agentId, attempt, posture, root?, allowWrite, denyRead, enabled, failIfUnavailable, sdkVersion}`
— no `reason` field. `reason` only ever reaches `main.ts`'s boot-time `console.log` (main.ts:504-506,
:473) and `--check-config`'s stdout. This is the same "comment says X, the thing doesn't do X" bug
class ARCH-176 names and fixes elsewhere in this very iteration (the `extractCandidatePaths` comment
vs. its `PATH_ARG_FIELDS` reality) — recurring here in a doc comment rather than a security control, so
severity is low, but an operator/log-scraper who trusts this module's own comment and greps the
per-run event stream for `reason` will not find it there.

**Verified consistent:**
- `agent.confinement` fires once per attempt (not once per call), carries its own `attempt` counter
  distinct from `sys.attempt`, exactly as DES-256/ARCH-178's Gate-4 correction specifies
  (`claude-agent-sdk-client.ts:580-585, 821-843`).
- Every event line — including `agent.confinement` — passes through `redact()` unconditionally at the
  single sink (`event-log.ts:38`), so ARCH-056's redact-at-capture invariant holds for the new kind
  with no special-casing needed.
- The `posture`/`enabled` same-event-disagreement bug IMPL-374 found and fixed (two ternaries reading
  the same field with opposite implicit defaults) is fixed correctly in the shipped code: both
  `sandbox` (`:744`) and the event's `posture` (`:838`) now read `confinementPosture === 'confined'`
  with the same true/false branch, confirmed by direct read of both lines.
- The posture is printed at boot (`main.ts:504-506`) and via `--check-config` (`:473`), giving an
  operator a positive, dated fact rather than an inferred one — matching ARCH-181's "measured, never
  argued" framing.

---

## 2. Replaceability

**No violations found.**

- ARCH-175/176's central claim — confinement is a property that lives on the SDK-gateway class only,
  never on the `GatewayClient` port — holds in code: `src/gateway/client.ts:189`'s `GatewayClient`
  interface gains no confinement-related member, and `LiteLLMGatewayClient` (`:471`) has no
  `confinementPosture`/`sandbox` field anywhere. Swapping the gateway backend (the port's whole reason
  to exist) is unaffected by this iteration, exactly as ARCH-175's note argues ("a second
  implementation would have to spawn Bash itself, which nothing in this engine does").
- `buildBashConfinement()` stays pure (verified: only imports `node:path` and a type-only SDK import;
  no `fs`/`process`/`env`/clock access in `bash-confinement.ts`), while the host-specific *measurement*
  lives in the separate, explicitly-impure `confinement-probe.ts` — the module boundary ARCH-181's note
  argues for is real in the file layout, not just asserted in prose.
- The `SandboxSettings` object `buildBashConfinement()` returns was checked field-by-field against the
  SDK's own zod schema (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:2682-2736`):
  `enabled`/`failIfUnavailable`/`autoAllowBashIfSandboxed`/`allowUnsandboxedCommands`,
  `filesystem.{allowWrite,allowRead,denyRead,denyWrite}`, `credentials.files[].mode:'deny'` all match
  the installed SDK's actual schema, not a stale doc comment — the "one carrier, arm 1 wins" premise
  ADR-082 rests on is real against the current dependency version.

---

## 3. Consumability

**Finding C-1 (HIGH) — `CONFINEMENT_UNAVAILABLE` is a real, wire-reachable refusal on `run_start`/`run_resume` that is absent from the one place ARCH-087 says the tool surface lives, reproducing a bug class this codebase already paid to fix once.**

ARCH-087 (unchanged this iteration, still governing): *"`TOOL_SPECS`: one data array that **is** the
tool surface — names, schemas, descriptions, **`errors:`**, authorization row, REQ-118 fixture list."*
ARCH-051 promises *"precise self-describing tool schemas + a structured drift-lock test across
new/changed tools."*

ARCH-181/DES-262 (this iteration) adds a real refusal: `call-tool.ts:120-124` —

```
if ((spec.name === 'run_start' || spec.name === 'run_resume') &&
    deps.confinementPosture === 'unconfined' && deps.isRemoteSubmission === true) {
  return refusalEnvelope('CONFINEMENT_UNAVAILABLE', 'CONFINEMENT_UNAVAILABLE: Bash confinement is
  unavailable on this host … remote run submissions are refused …');
}
```

This is reachable in production (any remote-submitted `run_start`/`run_resume` on an `unconfined`
posture — the exact posture this very host measures per IMPL-371/ADR-083's owner_decision) and it is
even tested directly (`tests/unit/call-tool-confinement-door.test.ts:28,66`). But:

- `src/errors.ts`'s `ERROR_CATALOG` (the "closed `ErrorCode` union — every coded refusal this engine
  can throw is a key here", per that file's own header comment) has **no `CONFINEMENT_UNAVAILABLE`
  key** — `grep -n CONFINEMENT_UNAVAILABLE src/errors.ts` returns nothing.
- `refusalEnvelope(code: string, …)` (`call-tool.ts:76`) takes a bare `string`, not the `ErrorCode`
  type — so this call site is not even compiler-checked against the catalog, unlike every other coded
  refusal in the file.
- `src/tool-specs.ts:532` (`run_start`'s `errors:` array) and `:599` (`run_resume`'s `errors:` array)
  both omit `CONFINEMENT_UNAVAILABLE` — a client reading `tools/list` (the surface ARCH-091/ARCH-087
  exist to make authoritative) has no way to learn this refusal exists before hitting it.
- The implementer's own comment at the call site invokes the *correct* precedent and then does not
  follow it: *"same precedent as INLINE_SCRIPT_CLOSED below"* — but `INLINE_SCRIPT_CLOSED` **is**
  catalogued (`errors.ts:86`) **and** listed in `run_start`'s `errors:` array (confirmed at
  `tool-specs.ts:532`); `CONFINEMENT_UNAVAILABLE` received neither treatment.
- This is not a new bug class for this codebase — it is the *identical* defect
  `tests/unit/error-catalog-closed.test.ts` (UT-164, v24 Gate-8 AF-3) was written to prevent: *"A code
  a client really receives, with no `see` pointer, in no generated documentation, and invisible to the
  existing closure tests."* That test's own header names the gap in its own coverage: it locks
  `AUTHZ_ERROR_CODES` (authz.ts's derived union) against `ERROR_CATALOG`, and its comment says the
  *other* direction is "locked elsewhere" by `tool-specs.test.ts` — but that other lock only checks
  that a row's `errors[]`/fixtures don't cite codes outside the catalog, which is silent about an
  ad-hoc `refusalEnvelope()` call in `call-tool.ts` that names a code belonging to neither list. The
  same seam the codebase already found and fixed once (for `authz.ts`) reopened, this time via a
  pre-dispatch door in `call-tool.ts` rather than `authorize()`.

Under this lens specifically: Consumability's whole target is "structured, well-typed I/O… minimize the
caller's learning curve," and the stated mechanism for that in this codebase is precisely
`errors:` + `ERROR_CATALOG` + the `see: 'workflow_authoring_guide'` pointer. A cold MCP client — the
exact reader ARCH-051/ARCH-087 are written for — has no schema-level or catalog-level way to discover
that `run_start`/`run_resume` can fail this way; it will encounter the code only by making a remote
call from an unconfined host and reading the ad-hoc message string.

**Verified consistent:**
- `docs/AUTHORING.md` / `DEPLOY.md` (§1b, §1c(e), the `run_start`/`run_resume` refusal-table row) do
  document `CONFINEMENT_UNAVAILABLE` in prose, including the exact loopback-exemption and
  tunnel-header semantics — confirmed against `isLoopbackPeer`'s real implementation
  (`net-guard.ts:109-116`: any `TUNNEL_HEADERS` entry present ⇒ never loopback-exempt), so the
  *human-facing* documentation is accurate; the gap is specifically the machine-readable tool surface
  (`tools/list` / `ERROR_CATALOG`), which is the one this lens weighs most heavily for agent-to-agent
  consumability.
- `authoring-guide.ts`'s `hostPathGrantsBody(posture)` (IMPL-379) correctly threads the *measured*
  posture through `McpFacade` → `workflow_authoring_guide` (confirmed: `mcp-facade.ts:116-122,
  278-300, 680-683`, `server.ts:866-870`) rather than a hardcoded claim, and the static generated
  `docs/AUTHORING.md` correctly renders the dual-posture text because `scripts/gen-authoring-md.ts`
  passes no posture at generation time (build-time, not deploy-time) — this is the one place the
  slice's Consumability work is fully closed.
- ARCH-177's own named bug class (a new `FileConfig` key parsed but never forwarded) does **not**
  recur here: `compose-config-v2-wiring.test.ts:318` carries the `sandbox:` EXCLUDED row with its
  reason stated, and `:393-401` asserts the hop-2 forwarding into the constructed gateway's
  `_config.confinement.allowHostPaths` — the standing probe this repo's own memory
  ("composeConfig 佈線 bug class") flags as the only test that has ever caught this class does carry
  the new key, correctly.

---

## 4. Self-sustainability

**No violations found.**

- ADR-083's owner_decision (posture C) is implemented exactly as adjudicated: a host that cannot
  confine still runs **local** submissions unconfined (`claude-agent-sdk-client.ts:743-745` — the
  `sandbox` ternary depends only on `confinementPosture`, never on remoteness) while refusing
  **remote** `run_start`/`run_resume` at the door (`call-tool.ts:120`) — the "accepted cost" language
  in `DEPLOY.md:541` ("本機發起的 run 仍不受限制") matches the code, not just the prose.
  `failIfUnavailable: true` (ADR-083, the strict half) is a literal field in `buildBashConfinement()`'s
  output (`bash-confinement.ts:59`) and reachable failures are typed and distinguishable
  (`SANDBOX_UNAVAILABLE`, `claude-agent-sdk-client.ts:999-1022`, S10-confirmed distinguishable from an
  ordinary terminal failure) rather than silently degrading — the lens's "graceful degradation" concern
  is honored by refusing loudly, which is the posture this ADR explicitly chose over a quieter one.
- The posture is measured once, at boot, by a real subprocess probe (`confinement-probe.ts`) rather
  than trusted from a config flag or inferred from environment — `probeConfinement()`'s nested-`bwrap`
  command was independently re-run against this host during this review's own reading of the code path
  and its shape (`spawnSync('bwrap', NESTED_BWRAP_ARGS, {timeout:5000})`, exit-code/error/timeout →
  posture) matches ADR-083's owner_decision paragraph verbatim (single `bwrap` exit 0 vs. nested
  `bwrap … -- bwrap --unshare-user` → `No permissions to create a new namespace`). `--check-config`
  runs the identical probe read-only (`main.ts:470-473`), so an operator has a liveness check available
  on demand without booting the full server — the closest analogue this slice has to a "tool-liveness
  check," and it is wired.
- `validateHostPathGrants` (`bash-confinement.ts:98-135`) fails closed at boot on any malformed grant,
  checked in both containment directions via the repo's one existing `isPathContained` primitive
  (confirmed: `isPathContained(target, workRoot)` catches a grant nested inside `workRoot`,
  `isPathContained(workRoot, target)` catches a grant that is an ancestor of `workRoot`) — no
  degraded-but-running state is possible from a bad grant list; the engine does not start, exactly as
  ADR-028's fail-closed idiom this file reuses requires.
- INV-V37-2 ("the confined party cannot widen its own confinement") holds by construction:
  `grantedHostPaths`/`protectedFiles`/`workRoot` all arrive at `buildBashConfinement()` from
  `main.ts`'s composition root (`ComposeConfigDeps.confinementProbe` is a pre-computed **value**, never
  a callable the gateway or an agent-reachable path could re-invoke), and `denyWrite` on the
  workspace's own `.claude/settings*.json` (`bash-confinement.ts:66`) closes the one path an agent
  could otherwise use to edit its own sandbox settings — matching ARCH-175's note on this exactly.
- Deferred items (an automated INV-V37-3 checker, locking for a concurrently-shared granted path, the
  author-side `allowHostPaths` request contract) are each filed under "v38 candidates" with a named,
  event-shaped (not date-shaped) trigger — the self-sustainability-relevant property of "the next
  occurrence is a rule violation rather than a fresh discovery" is genuinely set up for the checker
  item, not just asserted.

---

## Summary

| # | Dimension | Severity | ARCH/INV | One-line |
|---|---|---|---|---|
| C-1 | Consumability | **HIGH** | ARCH-087, ARCH-051 | `CONFINEMENT_UNAVAILABLE` reachable on `run_start`/`run_resume`, absent from `ERROR_CATALOG` and both tools' `errors:` — reproduces the exact v24 Gate-8 AF-3 defect (UT-164) this codebase already paid to fix once |
| O-1 | Observability | MEDIUM | ARCH-178 | S4 fired positive; `agent.confinement_denied` still not built and the row's own conditional was never revised to say so |
| O-2 | Observability | LOW | ARCH-178 (adjacent) | `confinement-probe.ts` comment claims `reason` reaches the `agent.confinement` event; the event schema has no `reason` field |

Replaceability and Self-sustainability: no violations found in this slice; evidence recorded above.

ARCHCHECK: lens=quality-dimensions, file=/home/user/Documents/remote-workflow/.sdlc/features/001-remote-workflow-engine/.panel/review/quality-dimensions.md, consistent=no, violations=3
