# Gate 8 review — Quality-dimensions lens (v23) — **ROUND 2**, HEAD `41e6382`

**What changed since round 1.** This lens's round-1 file (7 findings) triggered the Gate 2 re-run
(`d294880`, amendments A1–A10 / V-A–V-D / ADJ-A1), then Gate 6 shipped `a39c0e7`, Gate 6.5+7 round 4
shipped IMPL-175/176, and Gate 7.5 round 4 passed. **The amended architecture is the authoritative
text for this round**, so nothing the amendments absorbed (`phases` on the describe list, `gateFail`
as a tenth field, the allowlist membership, the struck prune clause) is re-filed. The spine of round 2
is *disposition of those amendments*, plus the four dimensions re-walked at HEAD.

**Scope.** Gate 2 decisions `ARCH-077..086` / `ADR-015..022` / the v23 interface & API table
(`02-architecture.md:1357-1710`) vs `06-impl-log.md` `IMPL-159..176` (TASK-113..130 + adjudications
#6/#7). Code read: only the files on those IMPLs' `files:` lines plus direct module-boundary
references — `src/diagram-gate.ts`, `src/trigger-bindings.ts`, `src/graph-analyzer.ts`,
`src/workflow-view.ts`, `src/mcp-facade.ts`, `src/server.ts`, `src/main.ts`, `src/dashboard-page.ts`,
`src/gateway/claude-agent-sdk-client.ts`, `src/gateway/litellm-proxy.ts`, `rwe.config.example.json`,
`DEPLOY.md`, `README.md`, `docs/AUTHORING.md`, and the named guard tests. **Every line number below
was re-verified against HEAD `41e6382`**, never taken from an IMPL note or from the architecture
doc's own citations — this iteration has seven recorded ledger-honesty gaps, including a commit
subject (`a39c0e7`) claiming A4 landed when it had not.

**Residuals NOT filed** (recorded decisions, not deviations): `owner` served to every principal;
no analyzer rate limiter / S-1 cost risk; a secret in a phase name passing the gate; the dashboard's
remote-browser diagram going dark under `auth.enabled:true` (ADJ-A1's named cost); `/skeleton` as a
breaking change; ADR-017's stated `regenerate → crash → boot sweep` window (A10 decided that stating
it *is* the fix, no schema change); IMPL-173's two named debts (the 13 fake-`ChildProcess` builders,
`_doStart`'s `_startPromise` reset).

**Verdict: NOT consistent — 8 deviations (1 HIGH, 3 MEDIUM, 4 LOW).**

| id | dimension | ARCH/ADR violated | severity |
|---|---|---|---|
| SUS-1 | Self-sustainability | ARCH-079 inv 2 (amended, A3/V-C), inv 5, ADR-017 | **HIGH** |
| OBS-1 | Observability | ARCH-079 inv 5 (amended), ADR-016 (amended), interface table `:1708` | MEDIUM |
| OBS-2 | Observability | ARCH-079 inv 5 (amended) | MEDIUM |
| SUS-2 | Self-sustainability | ADR-020, interface table `:1707` | MEDIUM |
| OBS-3 | Observability | ARCH-085 DoD + ARCH-079 inv 5 (DEPLOY text falsified by the inv-5 fix) | LOW |
| REP-1 | Replaceability | ARCH-079 inv 11 (amended, A2) — placement only | LOW |
| REP-2 | Replaceability | ARCH-080 `api:` (amended, A5) — the struck clause survives in a fourth site | LOW |
| CONS-1 | Consumability | ARCH-085 `api:`, interface table `:1707` | LOW |

---

## Disposition of round 1's seven findings

| round-1 id | sev | disposition at HEAD `41e6382` | evidence |
|---|---|---|---|
| SUS-1 — `enabled:false` did not stop the boot sweep making a model call | HIGH | **FIXED.** The guard runs in `enqueue()` *before* `putDiagramPending` (so a prior `ready` row is not clobbered to NULL ahead of the ready-check) and on `sweepAtBoot`'s never-stamped branch; both settle rather than return. `regenerate()` reaches the gateway only via `enqueue`. | `src/graph-analyzer.ts:138-141`, `:181-184`; UT-124's four cases incl. the prior-ready clobber trap. *Placement residual → REP-1.* |
| SUS-2 — an exception in a scheduled job wedges the concurrency-1 slot | HIGH | **PARTIALLY fixed — re-filed as SUS-1 (round 2).** Only the `await scriptPromise` throw is caught; `_runJob` is still outside the `try`, there is no `finally`, and the catch neither settles nor journals. | `src/graph-analyzer.ts:255-264`, `:352-389` |
| REP-1 — `DIAGRAM_CODEPOINTS` had one consumer, the glyphs hand-copied at three sites | MED | **FIXED.** `VOCAB_GLYPHS` is the one declaration, destructured and interpolated into the shipped default prompt; UT-127 asserts membership over the prompt **and** reads `rwe.config.example.json` from disk. | `src/diagram-gate.ts:8`; `src/server.ts:56/305/306`; `tests/unit/diagram-vocabulary-consistency.test.ts:31-42`. *Stale-comment residual → REP-2.* |
| CONS-1 — neither v23 tool joined ARCH-051's drift-lock; REQ-101's last clause asserted nowhere | MED | **FIXED, all three owed items.** Sorted-name **set equality** against a literal 39-name list; per-tool rows for both v23 tools; a **literal** assertion on the script-absence sentence. | `tests/integration/mcp-tools-list-schema.test.ts:185`, `:216-217`, `:220-244`, `:246-249` |
| SUS-3 — the home-card mini-preview still fetched `/describe` per card per 3 s tick | MED | **FIXED (IMPL-176).** `renderMiniPreviewAsync` and its call site are **deleted**, not re-pointed; exactly one `/describe` fetch survives, the workflow-detail view's. `setInterval(render,3000)` correctly left alone (`:491`). | `src/dashboard-page.ts:214` (sole fetch), `:225` (comment states the absence); no `renderMiniPreviewAsync` anywhere in `src/` |
| OBS-1 — the allowlist / describe field lists were never amended for adjudications #1 and #7 | LOW | **FIXED in the doc.** ARCH-079 inv 6 now enumerates `meta.phases[].title` / `'default'` / `'model:param'` / `UNBOUND_ENTRY_LABEL`, removes `DIAGRAM_CODEPOINTS` (never a label member), and records the per-member ADR-015 re-audit; ARCH-081 and the interface table gained `phases`. | `02-architecture.md:1403` (inv 6), `:1420`, `:1699` |
| OBS-2 — ARCH-077 / ADR-021 asserted a deletion path (prune) that does not exist | LOW | **FIXED.** Both rows struck the prune clause and record `deregister()` as the single deletion path; the growth consequence is named rather than promised away. | `02-architecture.md:1384-1385`, `:1508` |

---

## 1. Observability — transparency of internal state (incl. traceability)

### What was checked and is CLEAN

- **No raw provider or model text on any channel (ADR-016).** `_attempt`'s `catch`
  (`graph-analyzer.ts:315-319`) discards the thrown error entirely and synthesizes
  `{ok:false, provider:'unknown', reason:'terminal'}` — it never reads `.message`. Pinned by a
  secret-bearing upstream error at `tests/unit/graph-analyzer.test.ts:369`.
- **`noteCode` is a closed engine-authored enum end to end.** 10 values typed at
  `graph-analyzer.ts:17-21`, the 8 persistable ones re-asserted as a SQL `CHECK`; user-facing text
  comes only from `NOTE_TEXT` (`:51-62`); `DISABLED`/`NOT_GENERATED` are read-synthesized only and
  the declaration at `:14-16` still says so truthfully.
- **V-D landed and is total.** `projectWorkflowDescribe`'s note precedence is now
  `ready → '' | !analyzerEnabled → DISABLED | null row → NOT_GENERATED | row's own note | ''`
  (`workflow-view.ts:133-146`) — `analyzerEnabled` wins **before** any persisted code is consulted,
  so an operator who switched the analyzer off no longer reads "exhausted its retries" for a
  subsystem that made zero attempts. This is the prerequisite ARCH-079 inv 11 named, and it shipped.
- **`diagramStale` / `diagramGeneratedAt` honesty (ADR-019, DES-127 B3).** Staleness is one `sha256`
  compare against the **live** recomputed fingerprint (`workflow-view.ts:167`), and is `false` unless
  the row is `ready`, so absence never reads as staleness; `diagramGeneratedAt` is non-null only for
  `ready`, so the boot sweep's attempt marker cannot leak as a generation timestamp (`:166`).
- **Zero-model-call settles are now observable at all** — the inv-5 half that did land.
  `_settleUnavailable` emits its own line (`graph-analyzer.ts:212-216`), and UT-128 pins
  `toHaveBeenCalledTimes(1)` on all five zero-call paths (`MODEL_UNMAPPED`, `QUEUE_FULL`, the two
  `enabled:false` guards, the boot-sweep stale-stamp settle). `MODEL_UNMAPPED` — this repo's
  `composeConfig`-forwarding-gap signature — is no longer silent.
- **Boot-time discoverability at zero model calls (DES-127 B1).** `server.ts:1523` prints the
  missing-diagram count **and the exact recovery command**, unconditionally.
- **Prompt-side secret closure is structural, not procedural.** `describeTriggerBindings` renders
  from the same projection `bindingsFp` hashes, and `TriggerPorts.webhooks` pins `secret`/`id` to
  `never` in the return type (`trigger-bindings.ts:13`) — so the prompt cannot carry what the
  projection cannot hold. The rendering also instructs the trigger **kind**, never the raw cron
  expression, matching what `_buildAllowlist` admits (`:68-71`, `:86`). **Verified at the composition
  site, not taken from IMPL-171's note:** `server.ts:1459` maps each `WebhookView` into a **fresh
  `{enabled}` object literal** (`.map((w) => ({ enabled: w.enabled }))`) rather than passing the view
  through — the half that matters, since a method-return position gets no excess-property check and
  `id`/`secretFingerprint` would otherwise ride into the analyzer prompt at runtime.

### OBS-1 — MEDIUM — the journal line ships **ten** fields; ARCH-079 inv 5 and ADR-016 pin **eleven**, and the missing one is `cause`, whose whole job is the overload the amendment named

**Violated:** ARCH-079 invariant 5 as amended (`02-architecture.md:1403`), ADR-016's true-up
(`:1478`), and the v23 interface table's journal row (`:1708`) — all three state the field list as
`{name, version, principal, model, promptTokens, completionTokens, durationMs, outcome, noteCode,
gateFail, cause}`, and all three describe `cause` identically: *"an engine-classified string that
carries the **distinct** reason on paths where the persisted `noteCode` is overloaded."*

**Evidence.** `src/graph-analyzer.ts:223-233` — `_journal`'s parameter type and the emitted
`JSON.stringify` literal both carry exactly ten keys; `cause` exists nowhere in `src/`.

*(Noted in passing, not a ninth finding — the code is correct here: the interface table row at
`:1708` contradicts itself, declaring "+ provider HTTP status" **STRUCK** and then closing with
"Engine-classified error class **+ provider HTTP status** only". A5's own "struck in one of four
places" class, firing inside the amendment that repaired it. Doc-internal; the shipped line carries
no provider status, correctly.)*

**Why it matters, concretely.** The amendment paid for `RETRIES_EXHAUSTED`'s overload with `cause`
rather than with a ninth persisted code plus a `CHECK` migration — it says so in the same breath
("**Named debt, not smuggled:** `RETRIES_EXHAUSTED` becomes an overloaded 'the engine gave up' code…
un-overloading it costs a ninth persisted code plus a `CHECK` migration on a shipped store, which is
scheduled rather than paid here"). With `cause` absent, the debt is not deferred — it is **unpaid**.
Three structurally different settles now emit byte-identical lines:

| operator-visible line | actual cause | site |
|---|---|---|
| `noteCode:"RETRIES_EXHAUSTED", durationMs:0, promptTokens:null` | the operator set `graphAnalyzer.enabled:false` | `graph-analyzer.ts:139` |
| *identical* | `enabled:false` met a never-stamped pending row at boot | `:182` |
| *identical* | a previous process died mid-generation and the engine gave up | `:196` |

The first is a *configuration state the operator chose*; the third is a *failure*. Distinguishing
them is the single thing the eleventh field was added for. Nothing else in the system distinguishes
them either: the persisted `note_code` is the same eight-value enum, and V-D deliberately masks the
persisted code behind `DISABLED` on the read surface while the analyzer is off.

**Remedy (small, no migration):** add `cause` to `_journal`'s field type and literal, and pass a
distinct string from each of the three `_settleUnavailable` call sites (e.g. `'analyzer-disabled'`,
`'analyzer-disabled-boot'`, `'prior-process-abandoned'`), `null` on the model-call path. Extend
UT-128's five cases from `toHaveBeenCalledTimes(1)` to also assert the distinct `cause` value.

### OBS-2 — MEDIUM — the emitter is still inside `_attempt`, so "exactly one journal line per SETTLE" is neither true nor tested on the model-call path, and the DES-127 B5 restore emits a line that contradicts the row it settles

**Violated:** ARCH-079 invariant 5 as amended (`02-architecture.md:1403`), whose operative sentence
is *"The emitter lives at the **settle choke point, not inside `_attempt`**"* and whose invariant is
*"exactly one journal line is emitted per **settle**, on every path that writes a terminal
`workflow_diagrams` row."*

**Evidence.** `src/graph-analyzer.ts:339-347` — the second `_journal` call sits inside `_attempt`,
i.e. **per attempt**. `_runJob` (`:352-389`) is the settle choke point for the model-call path and
emits nothing of its own; it relies on whatever the last attempt happened to log.

Two distinct consequences, both real at HEAD:

1. **N lines per settle whenever `graphAnalyzer.retries > 0`.** The retry loop at `:369-373` calls
   `_attempt` up to `1 + retries` times and each iteration logs, while `:376-386` writes exactly one
   terminal row. The shipped default is `retries: 0` (`server.ts:1480`), which is why nothing caught
   this — but `retries` is an operator knob DEPLOY §1b documents with a worst-case call formula, so
   the invariant is false on any deployment that uses it.
2. **The B5-restore branch emits a line that misdescribes its own settle**, at *any* retry setting.
   When the final attempt fails but `priorRow?.status === 'ready'`, `:378-383` persists
   `status:'ready'` (restoring the prior good diagram) — while the only line emitted for that job
   says `outcome:"unavailable"` with a failure `noteCode`. An operator reading the journal concludes
   the version has no diagram; `workflow_describe` serves one. That is not a retry-count artifact; it
   is the journal describing an attempt where the architecture asked it to describe a settle.

**Not tested.** UT-128's five cases all run through `_settleUnavailable`; the describe block's own
scope note (`tests/unit/graph-analyzer.test.ts:497-505`) records the model-call/V-C half as
deliberately deferred debt, and Gate 6.5+7 round 4 did not pick it up. So the invariant's own name
("per SETTLE") is asserted nowhere on the path that actually settles.

**Honest counter-argument, recorded rather than suppressed:** ADR-016 also says the line "doubles as
the cost attribution S-1 needs", and per-attempt token counts are strictly better cost data than one
folded line. If the panel wants to keep per-attempt lines, the fix is to *amend inv 5 to say so* and
add a settle line alongside — not to leave a document and a code base disagreeing about how many
lines one job emits. Either way, consequence (2) is a defect under both readings.

### OBS-3 — LOW — `DEPLOY.md` still tells the operator the disabled path is silent, which the inv-5 fix falsified in the same round

**Violated:** ARCH-085's definition of done (DEPLOY.md documents the block truthfully) read together
with ARCH-079 inv 5 as amended.

**Evidence.** `DEPLOY.md:743-744`: 「`graphAnalyzer.enabled:false` 當下實際會發生什麼：註冊照樣成功
（永遠不是錯誤）、完全不呼叫模型、**也不會多出任何一行上面那種 log**」 — "no extra line of that kind of
log". Since IMPL-175's inv-5 fix, `enabled:false` emits **exactly one such line per registration**
(`graph-analyzer.ts:139 → :212-216`), which is the point of the fix. `DEPLOY.md:359` carries the
matching older claim that `enabled:false` 「不寫入診斷圖列」 (writes no diagram row) — also falsified:
inv 11 requires the guard to **settle**, so a row is written (`unavailable`).

This compounds OBS-1: the operator is told a line does not exist, and when they see it, it reads as
`RETRIES_EXHAUSTED` — a failure — with no field distinguishing it from one. Same defect class the
send-back exists to repair ("a clause struck in one of four places"): the amendment corrected
ARCH-079, ADR-016 and the interface table, and DEPLOY was the fourth site.

**Remedy:** two sentences in `DEPLOY.md` — the disabled path emits one line per registration with
`durationMs:0`/`tokens:null`, and it settles the row rather than skipping it.

---

## 2. Replaceability — decoupling & pluggability

### What was checked and is CLEAN

- **The analyzer's model backend is a config change, not a rewrite.** `GraphAnalyzer` takes an
  injected `GatewayClient` (`graph-analyzer.ts:109-119`) and never names a provider; the composition
  root falls back to a **real** `LiteLLMGatewayClient` on the zero-config path rather than a narrower
  ad hoc shape (`server.ts:1492-1493`, DES-131). `graphAnalyzer.model` is an alias from the same
  table `agent()` uses, validated once with the shared `isKnownAlias` — a swap is a config edit.
- **A latent lock-in bug was closed at the right depth.** `curateToolsForProvider` returns `[]` for
  an intentionally-empty set *before* the non-Anthropic `Bash` augmentation
  (`gateway/claude-agent-sdk-client.ts:225`) — so ADR-020's `tools: []` default survives a provider
  swap instead of silently becoming `Bash` on every non-Anthropic backend. Fixed at the gateway, not
  special-cased at the analyzer call site.
- **`gateDiagram` is pure and provider-agnostic** (`diagram-gate.ts`, zero imports beyond `Buffer`),
  with `limits` a required parameter fed from config — a model class needing a bigger diagram is a
  config edit, not a redeploy, which is REQ-104's own clause.
- **The single-declaration rule held twice more.** `UNBOUND_ENTRY_LABEL`
  (`trigger-bindings.ts:29`, consumed by both `describeTriggerBindings` and `_buildAllowlist`) and
  `ANALYZER_SCRATCH_SUBDIR` (`graph-analyzer.ts:73`, consumed by `main.ts` and `server.ts:1511`) each
  have one declaration and two importers — the class ARCH-080's A5 amendment named.
- **Both `McpFacadeDeps` seams are required**, with `NO_TRIGGER_PORTS`/`NO_GRAPH_ANALYZER` as
  explicit opt-outs (`mcp-facade.ts:23-34`, `:71-79`) — an unwired facade is a `tsc` error, not a
  silent degrade to "no triggers exist".

### REP-1 — LOW — inv 11's guard sits at the callers, not at the `_startJob` choke point the amendment names and argues for

**Violated:** ARCH-079 invariant 11 as amended (`02-architecture.md:1403`): *"`_startJob` is the
single choke point at which this subsystem decides to spend a model call — reached from all three
callers — and it is the site of **both** claims… The `enabled` guard is the first statement, before
either claim."* The amendment's own one-sentence rationale is *"three callers each carrying the
check, two remembered, one forgot — which is the argument for the choke point in one sentence."*

**Evidence.** The guard is at `graph-analyzer.ts:138-141` (`enqueue`) and `:181-184`
(`sweepAtBoot`); `_startJob` (`:250-271`) reads `this._config.enabled` nowhere. IMPL-175's own note
concedes the shape: *"`regenerate()` reaches the gateway only through `enqueue`, so all three
`_startJob` callers are covered by two checks."*

**Why LOW and not MEDIUM.** The *substance* is closed and re-verified: no path reaches `this._gateway`
with `enabled:false` (UT-124 asserts it on all three entry points), the durable `putDiagramPending`
write really is behind the guard (the prior-`ready` clobber case passes), and both guards settle
rather than return. The amendment also names a **weaker** fallback as acceptable at a send-back gate
("QD-S1's requeue-branch-only `if`, which closes the shipped hole but does not cover a fourth
caller"), and what shipped is strictly stronger than that fallback. Filed anyway because the
architecture is prescriptive about placement for a stated structural reason, and the shipped shape
re-creates exactly the enumerated-callers condition the reason describes: a fourth `_startJob` caller
added later is a `tsc`-clean script-egress leak past the operator's only egress control.

**Remedy — either is acceptable, but one of them:** move the guard into `_startJob` and pass the
boot sweep's attempt stamp as a parameter (the amendment's shape); **or** amend inv 11 to ratify the
two-caller placement and say why, so the document stops prescribing a site the code does not use.

### REP-2 — LOW — A5's struck "three consumers" claim survives inside `diagram-gate.ts` itself

**Violated:** ARCH-080 `api:` as amended (`02-architecture.md:1411`), which established that
`DIAGRAM_CODEPOINTS` has **ONE** consumer, that the other two were hand-typed copies, that the named
third consumer (AUTHORING / tool-description text) is **absent** rather than duplicated, and that
"the false comment at `server.ts:299-300` is deleted".

**Evidence.** `src/diagram-gate.ts:22-24` still reads: *"Printable ASCII … **Three consumers,
elsewhere: this gate, the shipped default graphAnalyzer.systemPrompt, and the AUTHORING/tool-description
text.**"* IMPL-175 correctly deleted the `server.ts` copy of this claim; the copy inside the module
that owns the constant survived. Confirmed absent from the third site:
`grep '◇\|╭\|vocabulary' docs/AUTHORING.md` returns nothing, so the doc still is not a consumer.
(`04-design.md:4045` repeats the same struck sentence in DES-124.)

**Why it is more than a typo:** this comment is the first thing a future engineer reads before
touching the vocabulary, and it tells them two other places already carry a copy — the exact
invitation to transcribe that A5 recorded as a *class* with three prior firings (`UNBOUND_ENTRY_LABEL`
losing every first diagram being the most expensive). One-line fix: state that `VOCAB_GLYPHS` is the
sole declaration and every other site interpolates it.

---

## 3. Consumability — ease of use & low integration cost

### What was checked and is CLEAN

- **REQ-101's last clause is now a test, not a hope (round-1 CONS-1 closed).**
  `tests/integration/mcp-tools-list-schema.test.ts` gained sorted-name **set equality** against a
  literal 39-name list (`:216-217` — a rename of any tool now fails, where the old length floor could
  not), per-tool assertion rows for both v23 tools (`:220-244`), and a **literal** assertion on
  `workflow_describe`'s script-absence sentence (`:246-249`).
- **Error-code parity with a run is structural, not documented.** `workflow_describe` resolves through
  `catalog.resolveDetail` + the same `resolveVersionRequest` truth table admission uses
  (`mcp-facade.ts:11`, `:410-421`), so `UNKNOWN_VERSION` / `CHANNEL_UNPUBLISHED` /
  `INVALID_CHANNEL` / `DANGLING_CHANNEL` cannot drift from a run's for the same selector.
- **One projection, two transports.** The HTTP route hands the request to the same
  `facade.workflow_describe` (`server.ts:1175-1183`) and the A1 gate is at the transport
  (`:1898-1907`), so there is no second masking rule and no owner branch — DES-125/DES-132 intact.
- **Typed, two-sided response contract.** `WorkflowDescribeView` has **no `script` field at all**, so
  a leak is a `tsc` error (`workflow-view.ts:87-105`), and `EXPECTED_DESCRIBE_KEYS` is transcribed
  literally from the interface (`:110-117`) — a newly leaked field *and* a dropped `lockedKeys` both
  fail. `lockedKeys` is `LOCKED_KEYS` imported, never re-typed (`:157`).
- **The cold-client path is real.** `docs/AUTHORING.md` carries the `{knobs, args}` shape, states that
  a mis-shaped `params` block is **ignored, not rejected**, and tells the author to read the workflow
  back with `workflow_describe` (`:9-30`); UT-117 pins the doc and the `workflow_register.script`
  description together.
- **A1's contingent doc edits landed in the same round** — `README.md:187-191` now states the 401 +
  `WWW-Authenticate` and that an unauthorized caller cannot even learn whether a name exists;
  `DEPLOY.md:400` lists the describe route in the D-BIND set.

### CONS-1 — LOW — the architecture advertises a six-key `graphAnalyzer` block; the shipped, documented and exemplified block has nine

**Violated:** ARCH-085 `api:` (`02-architecture.md:1456`) —
`FileConfig.graphAnalyzer?: {enabled?, model?, systemPrompt?, tools?, timeoutMs?, retries?}` — and the
v23 interface table's `rwe.config.json` row (`:1707`), which lists the same six.

**Evidence.** The shipped block has **nine**: `maxBytes`, `maxLines`, `maxQueueDepth` are also
operator-tunable (`src/graph-analyzer.ts:82-84`, defaulted at `server.ts:1481-1483`), present in
`rwe.config.example.json`, and documented as nine keys in `DEPLOY.md:365-367` and `:418`
(「九個鍵」). They are ratified in writing by DES-134 (`04-design.md:4197-4198`), which explains
*why* they had to move into config: REQ-104's second clause forbids hard-coding an analyzer harness
value in engine source, and a cap on model-authored text is one.

**Severity LOW** by this lens's own round-1 filing discipline — a code/ARCH mismatch a DES row
ratifies is doc-sync, not a design deviation. Filed because this is precisely the class the Gate 2
re-run just spent A7/A8/A9/A10 repairing (an ARCH row that never caught up with its DES row), the
row is the config contract an integrator reads first, and the three absent keys are the ones REQ-104
compliance forced into the block. **Remedy:** three key names in two lines of
`02-architecture.md`; no code change.

---

## 4. Self-sustainability — closed-loop autonomy & lifecycle management

### What was checked and is CLEAN

- **The zero-config fail-closed jail guard exists and is keyed off the right value** (IMPL-172,
  DES-122): `graphAnalyzerNoJail = enabled && config?.workRoot === undefined` forces `tools: []`
  regardless of configuration, with a boot line naming the downgrade and its reason
  (`server.ts:1473`, `:1478`, `:1485-1487`). Keying off the operator-configured `workRoot` rather
  than `createServer`'s internal `mkdtemp` fallback is the distinction that makes it correct.
- **A boot-time misconfiguration degrades, it does not kill the engine.** A non-alias
  `graphAnalyzer.model` warns and boots (`server.ts:1494-1498`), because `enqueue()` already settles
  every diagram `MODEL_UNMAPPED` with zero model calls until corrected — REQ-104's "never an error".
- **The spawn race that could kill the process is closed (V-2).** `LiteLLMProxyManager.start()`
  attaches `proc.once('error', …)` immediately after the spawn — *before* the first health poll, the
  actually-vulnerable window — and the poll loop converts a recorded spawn error into a normal
  rejection (`gateway/litellm-proxy.ts:178-188`). v23 made this reachable from `workflow_register`.
- **At-most-once requeue across restarts (inv 9).** `sweepAtBoot` stamps via `putDiagramPending(name,
  version, stamp)` **before** `_startJob` (`graph-analyzer.ts:186-193`), which is what bounds a
  crash-loop to one extra attempt under `Restart=on-failure` rather than a restart-driven billing
  loop; the three restart shapes are distinguished by `generated_at` alone, no new column.
- **A failure does not clobber a prior good diagram within a process lifetime (B5).** Both
  `_settleUnavailable`'s ready-check (`:206-207`) and `_runJob`'s `priorRow` restore (`:378-383`)
  enforce it. ADR-017's A10 amendment correctly states the durable window this does *not* cover, and
  the false in-line comment that denied it is gone.
- **The derived store cannot outlive its source.** PK `(name, version)`; `deregister()`'s existing
  transaction is the single deletion path; `putDiagramResult`'s `.immediate()` late-write guard stops
  `enqueue → deregister commits → result lands` creating an immortal orphan (IMPL-160, IT-096).

### SUS-1 — HIGH — the `try/catch/finally` inv 2 requires wraps only the script `await`; `_runJob` is outside it, so a throw there still leaks the slot permanently — and the covered path settles nothing and journals nothing

**Violated:** ARCH-079 invariant 2 as amended (`02-architecture.md:1403`), verbatim: *"the invariant
is therefore: the `try { … } catch { settle + journal } finally { release + drain }` **wraps the
scheduled closure**, so the closure never rejects and every scheduler … inherits termination by
construction."* Also ARCH-079 inv 5's enumerated path *"the exceptional exit of inv 2's closure"*,
ARCH-079 inv 8's V-C clause (*"a seam added for happy-path determinism must also admit the failure the
invariant claims to survive… a throwing `putDiagramResult` must still produce exactly one journal
line"*), and ADR-017's *"`pending` always settles"*.

**Evidence — `src/graph-analyzer.ts:255-264`:**

```ts
const job = async (): Promise<void> => {
  let script: string;
  try {
    script = await scriptPromise;
  } catch {
    this._release(key);      // release only — no settle, no journal
    return;
  }
  await this._runJob(name, version, script, principal, key, priorRow);   // OUTSIDE the try
};
```

There is no `finally`. `_release` is otherwise reached only at `_runJob`'s **tail** (`:388`).

**Two failure scenarios, both reachable at HEAD:**

1. **Any throw inside `_runJob` leaks the concurrency-1 slot permanently.** `_runJob` calls
   `getTriggerBindings` (`:355`), which synchronously reads **three separate SQLite files** through
   the injected ports, then `_buildAllowlist` → `parseMeta`/`parseWorkflowSkeleton` over
   author-controlled script text (`:356`), then `putDiagramResult` (`:377`/`:380`/`:385`), which takes
   an `.immediate()` write lock a second process or a busy handle can refuse. Any of those throwing
   propagates out of `job`, which the production scheduler invokes as `void job()`
   (`:127`) — an **unhandled rejection**, with `_runningCount` never decremented and `key` never
   cleared. Every subsequent registration then settles `QUEUE_FULL` for the life of the process.
   The architecture states the consequence itself: *"`QUEUE_FULL`'s honesty is conditional on this
   release — a wedged slot reports itself with the same string, so a lost release is
   indistinguishable from correct operation at the surface."* This is round-1 **SUS-2** in its general
   form; the amendment was written to close it and the shipped `try` is narrower than the closure.
2. **Even the covered path violates its own contract.** The `catch` at `:259-262` releases but does
   **not** settle and does **not** journal. The orphan `pending` row therefore survives until the
   *next* boot sweep, contradicting ADR-017's "`pending` always settles", and the exit is invisible —
   contradicting inv 5's explicit inclusion of "the exceptional exit of inv 2's closure" in the
   per-settle emission list.

**Not tested, and the ledger says so in its own words.** UT-125 covers exactly one throw — the
`scriptPromise` rejection — and its header calls it *"the one reachable throw"*
(`tests/unit/graph-analyzer.test.ts:681-703`). UT-128's scope note
(`:497-501`) records V-C's throwing-`putDiagramResult` case as *"deliberately NOT encoded here …
named debt for a Gate 6.5+7 coverage-gate addition"*. Gate 6.5+7 round 4 did not add it. So the one
oracle Gate 2 wrote specifically to make inv 2 falsifiable was deferred at Gate 5 and dropped at
Gate 7 — which is why the narrower `try` passed both.

**Remedy (the amendment's own shape, ~8 lines):**

```ts
const job = async (): Promise<void> => {
  try {
    const script = await scriptPromise;
    await this._runJob(name, version, script, principal, key, priorRow);
  } catch {
    this._settleUnavailable(name, version, 'RETRIES_EXHAUSTED', principal); // settle + journal
  } finally {
    this._release(key);                                                     // release + drain
  }
};
```
with `_runJob`'s tail `_release` removed (the `finally` owns it), plus the two V-C oracles the seam
already admits at zero cost: a throwing `putDiagramResult` and a throwing `schedules.listByWorkflow`
must each leave (a) no unhandled rejection, (b) a settled row, (c) exactly one journal line, and
(d) the next enqueued job running.

### SUS-2 — MEDIUM — ADR-020's "loud boot warning when `tools` is non-empty" was never built; the risky configuration and the safe one print the same line

**Violated:** ADR-020 (`02-architecture.md:1502`) — decision (c) is *"mandate the key, default it to
`[]`, **warn loudly at boot when it is non-empty**, and record non-empty as an accepted operator
risk"* — and the v23 interface table's config row (`:1707`): *"`tools` defaults to `[]` **with a loud
boot warning when non-empty**"*.

**Evidence.** `src/server.ts:1512` is the only line that mentions the analyzer's tools:

```ts
console.log(`[remote-workflow-engine] graph-analyzer effective tools=${JSON.stringify(analyzerEffectiveTools)} jail=${analyzerJailDir}`);
```

Unconditional, `console.log`, byte-identical in form for `tools=[]` and for `tools=["Bash","Write"]`,
with no severity marker and no statement of the risk. `grep -n 'console.warn' src/server.ts src/main.ts`
returns exactly one analyzer-related hit — the unknown-alias warning at `:1497` — and none for a
non-empty tool surface. The zero-config downgrade **does** get its own dedicated line (`:1486`), so
the loud-line pattern exists in this very block; only the accepted-risk case lacks it.

**Why MEDIUM rather than LOW.** ADR-020 is the decision that *permits* the key at all. Its own text
describes the hazard as an execution primitive reachable by `workflow_register`, on attacker-authored
prompt input, in a process that may hold `Read`/`Write`/`Bash`; two of the three mitigations shipped
(the `[]` default survives provider curation, and the no-jail path fail-closes), but the third —
the one that converts a silent hazard into an **operator-accepted** one — did not. A risk an operator
was never told about is not accepted, and the only trace of it is an informational line that reads
identically in the safe case. This is precisely the "a silent/opaque failure is a design defect"
rule applied to a configuration rather than a runtime failure.

**Remedy:** one conditional `console.warn` beside `:1512` when `analyzerEffectiveTools.length > 0`,
naming the tool set, the jail, and that the prompt carries author-controlled script text; plus one
row in `graph-analyzer-composition-root.test.ts` (which already has the mirror-image case for the
forced-`[]` downgrade at `:112`).

### Long-horizon note, NOT filed as a deviation

ADR-021's amendment already records the memory-metabolism gap in this lens's own words — diagram
rows are **bounded** per name by `maxWorkflowVersions` but **never reclaimed**, so a long-running
deployment eventually needs a human to `deregister`. It is named, costed and consciously not built
(no GC sweep, no TTL, no orphan reaper). Consistent between architecture and code; recorded here so a
future round does not re-file it as new.

---

## Summary for the integrator

**8 deviations: 1 HIGH, 3 MEDIUM, 4 LOW.**

| id | dim | one-line | file:line | severity |
|---|---|---|---|---|
| SUS-1 | Sus | inv 2's `try/catch/finally` wraps only the script `await`; `_runJob` throws leak the slot permanently, and the covered path neither settles nor journals | `src/graph-analyzer.ts:255-264`, `:388` | **HIGH** |
| OBS-1 | Obs | journal line ships 10 fields, not inv 5's 11 — `cause` absent, so three structurally different settles are byte-identical | `src/graph-analyzer.ts:223-233` vs `02-architecture.md:1403/1478/1708` | MEDIUM |
| OBS-2 | Obs | emitter still inside `_attempt`: N lines per settle at `retries>0`, and the B5 restore logs `unavailable` for a row it settles `ready` | `src/graph-analyzer.ts:339-347`, `:369-386` | MEDIUM |
| SUS-2 | Sus | ADR-020's loud non-empty-`tools` boot warning was never built; risky and safe configs print the same line | `src/server.ts:1512` vs `02-architecture.md:1502/1707` | MEDIUM |
| OBS-3 | Obs | DEPLOY still says the `enabled:false` path emits no log line and writes no row; the inv-5/inv-11 fixes falsified both | `DEPLOY.md:743-744`, `:359` | LOW |
| REP-1 | Rep | inv 11's guard is at two callers, not at the `_startJob` choke point the amendment prescribes and argues for | `src/graph-analyzer.ts:138-141/181-184`, `_startJob:250-271` | LOW |
| REP-2 | Rep | A5's struck "three consumers of `DIAGRAM_CODEPOINTS`" claim survives in the gate module's own docblock | `src/diagram-gate.ts:22-24` | LOW |
| CONS-1 | Cons | ARCH-085 + interface table advertise 6 `graphAnalyzer` keys; code, example config, DEPLOY and DES-134 all carry 9 | `02-architecture.md:1456/1707` | LOW |

**Cheapest correct order:** SUS-1 (code, ~8 lines + 2 oracles the `schedule`/ports seams already
admit) → OBS-1 (`cause` field + 5 UT-128 assertions, no migration) → OBS-2 (decide: move the emitter,
or amend inv 5 — but fix the B5-restore mismatch either way) → SUS-2 (one `console.warn` + one test
row) → REP-1 (a decision, not a defect: move the guard into `_startJob`, **or** amend inv 11 to
ratify the two-caller placement — but stop leaving the two disagreeing) → OBS-3 / REP-2 / CONS-1
(doc-only, ~6 lines total across `DEPLOY.md`, `diagram-gate.ts`'s comment and `02-architecture.md`).

**One structural observation for the panel, not a finding.** Four of these eight are the *same shape
as the round-1 seven*: an invariant amended in the document in one round, implemented in the next
round to the letter of its most convenient clause, with the falsifying oracle deferred by name and
then never picked up (UT-128's own scope note names both of the two items that would have caught
SUS-1 and OBS-2). The Gate-2 re-run added V-C specifically to stop this — a seam must admit the
failure the invariant claims to survive. V-C's seams exist in the code; nothing uses them yet. That
is the one thing worth carrying into v24 as a rule rather than as a finding.
