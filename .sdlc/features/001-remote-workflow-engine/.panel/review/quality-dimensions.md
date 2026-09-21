# Quality-dimensions review — Gate 2 architecture vs. implementation (v36 slice, REQ-211..216)

**Lens:** Quality-dimensions expert (Observability / Replaceability / Consumability / Self-sustainability)
**Scope:** ARCH-155..173, ADR-072..079, INV-V36-1..6 (`02-architecture.md`) vs. the code reached from IMPL-358..366's `files:` lists in `06-impl-log.md` (`src/event-log.ts`, `src/server.ts`, `src/mcp-facade.ts`, `src/workflow-catalog.ts`, `src/errors.ts`, `src/run-manager.ts`, `src/run-store.ts`, `src/store/sqlite-run-store.ts`, `src/sandbox/{guards,child-entry,host}.ts`, `src/gateway/{client,claude-agent-sdk-client}.ts`, `src/authoring-guide.ts`, `src/tool-specs.ts`, `deploy.sh`), plus the tests these IMPL rows name where they settle a dispute (empirically re-grepped, not assumed).

**Counting rule:** a violation is counted when code contradicts a stated ARCH/ADR/INV row, or a deliverable the architecture explicitly promised is absent from the diff. Staleness in the architecture doc's own cross-references, where the underlying behaviour is correct and the fix is well documented elsewhere in `06-impl-log.md`, is listed but not counted separately from the finding it belongs to.

---

## 1. Observability

### Finding O-1 (MEDIUM-HIGH) — INV-V36-6's sibling invariant, INV-V36-4, is false on disk and has no guard
**Cites:** INV-V36-4 ("Every structured operational line leaves the engine through `src/event-log.ts`'s sink... No module writes an operational line with `console.log` after this slice; a second path would be a second redaction posture.")
**Evidence:** operational `console.log`/`console.warn` lines remain outside the sink after this slice:
- `src/run-manager.ts:1083` — `run.legacySubstitution: ${JSON.stringify({runId, name, ...sub})}` — the exact `"<prefix>: <json>"` shape ARCH-161 specifically moved for `catalog.publish`, left behind in the same module the sink was wired into.
- `src/run-manager.ts:1337` — `console.log(JSON.stringify({event:'run_settle_failed', runId, error: String(e)}))` — writes a raw caught-error string with **no `redact()` call**, on a path immediately adjacent (same function, `_runLive`) to the `entry.resultError = refusalHit ?? captureFailure(...)` line this very slice hardened for exactly this hazard (K1/K2, ARCH-169/170). `String(e)` here can carry the same class of secret-bearing text C-1/K2 were opened to fix.
- `src/workflow-catalog.ts:261, :299` (`auth.migrate`, `catalog.migrate` boot lines) and `src/server.ts:444,530,570,578,628,1030,1144` (dashboard-degraded / asset-migrate lines) — none route through `createEventSink`.
- `src/run-manager.ts:366`'s `onWarning` default (`deps.onWarning ?? ((w) => console.warn(...))`) is a third, independently-configurable console path.

No test enforces INV-V36-4: `grep -rln 'console\.log\|console\.warn' tests/` turns up nothing that asserts these call sites are absent or redacted (compose-config-v2-wiring.test.ts's own `console.warn` hits are unrelated config-typo warnings, not a drift guard on this invariant).
**Remedy:** either narrow INV-V36-4's text to the four `EngineEvent` kinds it actually governs (and say so, since the row currently reads as an engine-wide claim), or route `run.legacySubstitution` and `run_settle_failed` through the sink — the latter is the one line that shares the exact hazard this slice was cleaning up.

### Finding O-2 (MEDIUM) — `refusalsDropped` is written but never read anywhere
**Cites:** ARCH-168 ("a silent cap is the thing this iteration exists to delete... Eight plus a dropped counter").
**Evidence:** `grep -rn refusalsDropped src/ tests/` shows only the declaration (`run-manager.ts:210`), two initializations (`:776`, `:1179`) and one increment (`:1575`) — no projection reaches `run_status`, `run_result`, the dashboard, or the operational log. `tests/integration/refusal-marker-real-child.test.ts:108` itself carries the comment "`refusalsDropped` has NO read surface anywhere" — the implementer already noticed and left it unaddressed.
**Consequence:** the counter ARCH-168 introduced specifically so an operator is not silently blind past 8 refusals is itself silent — REQ-216's own framing ("不得再以『目前沒有需求要求』帶過") applies here almost verbatim: the field exists but answers no question anyone can ask the running engine.
**Remedy:** surface `refusalsDropped` on `run_status`/`run_result` when non-zero, or on the `run.terminal` event line — a one-field addition to the closed `EngineEvent` union.

### Note (not counted) — ARCH-159 names the wrong composition root
ARCH-159's api line says "Composed **once** in `src/main.ts`"; the real (and, per IMPL-358, the only) production composition root is `src/server.ts:724` (`createServer()`), which is where `main.ts`'s config actually reaches `new WorkflowCatalog`/`new RunManager`. IMPL-358 documents the fix precisely and explains the misattribution; ARCH-159 itself was never amended in place. Listed here because it is the same class of drift as O-1/O-2 (the architecture doc's own account of where observability plumbing lives is inaccurate), not because the code is wrong.

---

## 2. Replaceability

### Finding R-1 (LOW-MEDIUM) — `Actor` ships as 3 fields; ARCH-157 and ADR-076 both specify 4
**Cites:** ARCH-157 api: `export interface Actor { id: string | null; kind: PrincipalKind; bypass: boolean; idSource: 'authenticated' | 'claimed' | 'none' }`; ADR-076: "a 4-field `Actor` (`id`, `kind`, `bypass`, `idSource`)".
**Evidence:** `src/workflow-catalog.ts:158` — `export interface Actor { id: string | null; bypass: boolean; idSource: 'authenticated' | 'claimed' | 'none' }`. No `kind` field; `PrincipalKind` is not an exported type anywhere in `src/` (`Principal`'s own discriminant lives in `src/authz.ts` and is never re-exported onto `Actor`). `06-impl-log.md` has no mention of `PrincipalKind`/`Actor.kind` anywhere — the drop is undocumented.
**Why this belongs under Replaceability, not just a type mismatch:** ARCH-157's own note gives the reason `kind` was designed in — "keeps a future auth mechanism (a fourth `idSource`, a new principal kind) a value addition **at the facade** instead of a catalog rewrite." Without `kind` on `Actor`, a future principal kind is still a facade-only change in practice (nothing in the current code branches on `Actor.kind`), so the *decoupling property* the row wanted is not actually lost — but the row's own literal contract is unfulfilled, and a v37 reader trusting 02-architecture.md's `Actor` signature to write against will hit a compile error.
**Remedy:** amend ARCH-157/ADR-076 in place to record the 3-field shape actually shipped, or add the field if a future auth mechanism is imminent enough to want it typed now.

### Verified consistent
- ADR-075's boundary holds: `workflow-catalog.ts`'s import list has no `RunStore`/`run-store` edge — the catalog stays run-ignorant exactly as decided, and the pinned-run probe lives at the facade (`mcp-facade.ts:405-420`) as specified.
- `GatewayClient` port: `attemptsFor(retries, timeoutMs)` is exported once from `src/gateway/client.ts:182` and both conformers (`claude-agent-sdk-client.ts:507`, `client.ts:523`) call it — no private per-transport retry rule survives, matching ARCH-171 exactly.
- `RunStore` port: `lastRunAtByName()` is implemented on both `SqliteRunStore` (`store/sqlite-run-store.ts:398`, one grouped `MAX(createdAt) GROUP BY name`) and `InMemoryRunStore` (`run-store.ts:439`, an equivalent fold) — the both-implementations-conform requirement (ARCH-162) holds.
- `RECORDED_REFUSAL_CODES` (`run-manager.ts:216`) is a forced duplicate of `guards.ts`'s inlined `ENGINE_REFUSAL_CODES`, exactly as ADR-072/ARCH-165 accepted (the sandbox child cannot value-import the parent's `.ts`), and is drift-pinned by a dedicated test — not a hidden divergence.
- `EventSink`'s closed 4-kind union (`event-log.ts`'s `EngineEvent`) is narrower than ARCH-159's own api line (`Record<string, unknown>`), but this is TASK-241's own DoD item 1 — a deliberate Gate-3 tightening, not a violation. Noted because it is the structural reason O-1's remedy ("route more lines through the sink") is a type edit, not a config change: the union does not extend itself.

---

## 3. Consumability

### Finding C-1 (LOW-MEDIUM) — the operational log has two incompatible shapes, and the architecture's own contract table promises a third
**Cites:** the "v36 interface & API contracts (delta)" table's "operator log stream" row: `{kind, name, version?, principal, bypass?, idSource?, runId?, outcome?, code?, at}` — one flat shape for every line.
**Evidence:** `event-log.ts`'s actual `EngineEvent` union has two incompatible shapes: the three `catalog.*` kinds carry a nested `actor: AuditActor` object (`{id, bypass, idSource}`), while `run.terminal` carries a flat `principal: string | null` with no `bypass`/`idSource` at all (consistent with ARCH-160, which never asks `run.terminal` to carry them). A consumer of `.rwe.<instance>.log` — exactly the "70-minute remote session" scenario this whole slice was built to serve (see the slice's own opening paragraph) — cannot `jq '.principal'` uniformly across every line; catalog lines need `.actor.id`, run lines need `.principal`.
**Assessment:** this is a real ergonomics gap for the log's own stated audience (an operator reading `.rwe.log` by hand or with `jq`), and the architecture's interface-contract table describes a shape that was never built. Whether the fix is "flatten the catalog lines" or "amend the contract table to show two shapes" is a call for the next gate, not this review — but the current state matches neither the table nor a self-consistent single shape.
**Remedy:** flatten `catalog.*`'s `actor` object onto the event root (drops one nesting level, keeps every field), or split the contract-table row into two documented shapes.

### Finding C-2 (LOW) — ARCH-168's ledger entry type promises a field (`detail?: unknown`) that ADR-072, in the same gate, rules out ever populating
**Cites:** ARCH-168 api: `RunEntry` gains `refusals: Map<number, {code:string; message:string; detail?: unknown}>`; ADR-072's Decision (C) explicitly drops "the allowlist table, the per-value byte bound, the redact-then-cap ordering hazard on a new field" — i.e., no structured detail crosses the sandbox seam at all under the design this gate actually chose.
**Evidence:** the shipped type has no `detail` slot: `run-manager.ts:209` — `refusals: Map<number, { code: string; message: string }>`; `captureFailure` (ARCH-169, `errors.ts:334-340`) returns exactly `{code, message}` and cannot produce one, consistent with `toErr`'s own (pre-existing, v35) documented decision to forward no detail (`errors.ts:255-259`, citing DES-230's `owner_decision`).
**Assessment:** the implementation is *correct* relative to ADR-072 and to the pre-existing `toErr` contract; the type promised in ARCH-168's own api line is simply stale relative to the fork this same gate resolved (see Decision rationale — v36's own account of the panel's r1→r2 crossing). A future reader who designs against ARCH-168's literal signature and expects `refusals.get(n).detail` will be wrong.
**Remedy:** drop `detail?: unknown` from ARCH-168's api line on amendment (it was very likely inherited from adversarial's abandoned r1 primary and never scrubbed after ADR-072 settled on the smaller design).

### Note (not counted) — `refusalRef` nests inside `error` internally, sits beside it on the wire
`guards.ts:66`'s `evaluateScript` result type nests `refusalRef` inside `error` (`error?: {code; message; refusalRef?}`), while `child-entry.ts:154` hoists it to a **sibling** of `error` on the outbound wire message, matching ARCH-166's contract-table row exactly. IMPL-365 documents the hoist explicitly. Internal-shape-vs-wire-shape difference, not a contract violation — listed for completeness since ARCH-165's own api line only shows the nested internal shape and a reader could otherwise expect the wire to match it verbatim.

### Verified consistent
- `workflow_deregister`'s schema (`tool-specs.ts:291-303`) advertises the optional `version`, all four version-only error codes gated behind "only reachable when `version` is supplied", and both `VERSION_CEILING_EXCEEDED` message copies (`workflow-catalog.ts:610`, `:656`) name the real call shape `workflow_deregister({name, version})` — matches ARCH-155's note precisely.
- `workflow_list`'s `description`/`lastRunAt` fields and their documented semantics (`mcp-facade.ts:629-648`, `tool-specs.ts`) match ARCH-163 exactly, including the "absent from the map, never `null`-valued" contract that makes the `?? null` honest.
- The attestation-boundary sentences ARCH-171/173 require ("`error.code` alone is not engine-attested... a script can forge one") are present verbatim on `run_status`/`run_result`'s tool descriptions (`tool-specs.ts:545,559`) and in the authoring guide, byte-locked with `docs/AUTHORING.md` per TASK-247's own DoD.

---

## 4. Self-sustainability

### Finding S-1 (LOW) — the `RWE_START_CMD` test seam ARCH-164 specifies does not exist
**Cites:** ARCH-164 api: "Test seam, ~3 lines: `start_cmd` is overridable via `RWE_START_CMD`, and `--dry-run` prints the two resolved paths and exits before step 4." ADR-078's Decision repeats it: "a ~3-line `--dry-run`/`RWE_START_CMD` seam."
**Evidence:** `deploy.sh:80` — `start_cmd=(node node_modules/tsx/dist/cli.mjs src/main.ts)`, hardcoded, no environment-variable override anywhere in the file. `grep -rn RWE_START_CMD .` (excluding `node_modules`) returns nothing in `deploy.sh`, `tests/`, or `DEPLOY.md`. `tests/integration/deploy-control-files.test.ts` (IT-293, the regression this seam was supposedly for) exercises only `--dry-run`, never `RWE_START_CMD` — the `--dry-run` half alone happens to satisfy Gate 2's own "Constraints for Gate 3/4/5" item 7 ("run `deploy.sh --dry-run` against two config paths in one directory..."), so the gap is invisible to the test suite.
**Assessment:** functionally harmless today (`--dry-run` covers the one regression case Gate 2 actually specified), but it is an undocumented deletion of a spec'd deliverable — IMPL-361 describes everything else ARCH-164 asked for and is silent on `RWE_START_CMD`.
**Remedy:** amend ARCH-164/ADR-078 to drop the `RWE_START_CMD` clause, or add the override if a future test needs to assert something about the actual start command without booting a real engine.

### Finding S-2 (MEDIUM) — REQ-216/K8's systematic wiring-sweep probe for `attemptsFor` was never added
**Cites:** ARCH-171: "K8 rides the same commit: one `attempts` probe row (~3 lines) in `compose-config-v2-wiring.test.ts`'s sweep — the systematic guard for this repo's forwarding bug class, which a per-feature integration test does not replace — together with ARCH-159's `eventSink` probe." Gate 2's "Constraints for Gate 3/4/5" item 8: "The wiring sweep gets two rows, not one: `eventSink` (ARCH-159) and `attempts` (K8) both as probes in `compose-config-v2-wiring.test.ts`."
**Evidence:** `grep -n 'attemptsFor\|attempts\|K8' tests/unit/compose-config-v2-wiring.test.ts` returns nothing related (the only "retries" hit is an unrelated fixture value at `:321`). The `eventSink` half of the pair is legitimately absent too, but IMPL-358 explains why — DES-243 ruled that `eventSink` is composition-root-constructed, not a `FileConfig` key, and redirected its guard to the composition-root integration test (`main-composition-root-events.test.ts`) instead. **No equivalent note exists for `attempts`.** UT-305 (`tests/unit/gateway-attempts.test.ts`) is a real and correct test of the formula and of both conformers calling it, but it is a per-feature test, not the systematic sweep Gate 2 asked for — exactly the distinction ARCH-171's own sentence draws ("a per-feature integration test does not replace [the sweep]").
**Consequence:** this is precisely the bug class the sweep exists to catch — a value computed correctly, then never wired at the one place that matters — and it is the same class IMPL-358 had to send back as a P1 security blocker for `eventSink` earlier in this very gate. `attemptsFor`'s only two callers are hand-edited call sites in `client.ts`/`claude-agent-sdk-client.ts`; nothing regresses if a future refactor silently reintroduces a third, un-wired gateway conformer, or if one of the two existing call sites is edited back to the deviant formula, until an integration test happens to notice.
**Remedy:** add the ~3-line `attempts` probe to `compose-config-v2-wiring.test.ts` as specified, or record in an ADR amendment why it was judged unnecessary (by the same reasoning DES-243 gave for `eventSink`, if that reasoning actually applies here — it is not obvious that it does, since `attemptsFor` has nothing to do with `FileConfig` either way and the sweep's stated purpose is broader than config-key forwarding).

### Verified consistent (accepted gaps, checked rather than assumed)
- `listRuns()` stays unbounded with the ADR-079 ruling written into the port contract verbatim (`run-store.ts:206-211`) — no LIMIT introduced.
- Log rotation is genuinely not built (ADR-078); DEPLOY.md's two disclosure sentences and the 0600 permission (`deploy.sh:32-33`) are both present.
- `deploy.sh` uses `touch` + append (`>>`) rather than ARCH-164's literal `: > "$RWE_LOG_FILE"` (truncate) — a deliberate improvement over the row's own text, justified in `deploy.sh`'s own comment (line 31) by ADR-076 ("this log is the only existing audit record; a restart must not wash out an incident under investigation"). Better than the spec, and the spec is what's stale here — not counted as a violation.
- PID recycling remains explicitly out of scope, as ADR-078/ARCH-164 both record.

---

## Summary

| # | Finding | Dimension | Severity |
|---|---|---|---|
| O-1 | INV-V36-4 false on disk, unguarded (`run-manager.ts:1083,1337` etc.) | Observability | MEDIUM-HIGH |
| O-2 | `refusalsDropped` never surfaced to any read path | Observability | MEDIUM |
| R-1 | `Actor` missing `kind` field vs. ARCH-157/ADR-076 | Replaceability | LOW-MEDIUM |
| C-1 | Operational-log shape inconsistent across event kinds, vs. one contract-table shape | Consumability | LOW-MEDIUM |
| C-2 | ARCH-168's `detail?: unknown` unfulfilled, contradicts ADR-072 (same gate) | Consumability | LOW |
| S-1 | `RWE_START_CMD` seam specified, never implemented | Self-sustainability | LOW |
| S-2 | REQ-216/K8's `compose-config-v2-wiring.test.ts` `attempts` probe missing | Self-sustainability | MEDIUM |

**7 counted violations.** All are documentation-vs-implementation or missing-deliverable gaps at the margins of an otherwise unusually faithful build: every core mechanism this review checked line-by-line against its ARCH row — `deregisterVersion`'s six-outcome order and two-statement transaction (ARCH-155), the facade-side pinned-run probe (ARCH-156), `canMutate`/`actorFor`'s four-principal-kind mapping (ARCH-157/158), the `run.terminal` emission site and timing relative to `resultError` (ARCH-160/168), the `lastRunAtByName` SQL and its both-store agreement (ARCH-162), the `WeakMap`-keyed provenance and relay-only host (ARCH-165/166/167), K1/K2's redact-then-bound ordering including the two different byte bounds (ARCH-169/170), and `attemptsFor`'s single-formula port (ARCH-171) — matched the architecture decision exactly, including several places where the implementation is demonstrably *more* correct than the architecture row's own literal text (deploy.sh's append-not-truncate; the facade's version-string normalization before the pinned-run compare).
