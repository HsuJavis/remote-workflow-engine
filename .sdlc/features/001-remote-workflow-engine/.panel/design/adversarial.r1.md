# Design panel — Adversarial group, round 1 (independent proposal)

**Gate:** 3/4 merged (Tasks + Detailed Design), iteration v36, REQ-211..216 / ARCH-155..173 / ADR-072..079.
**Lenses carried:** (a) interface-contract · (b) boundary & error · (c) testability. **Tie-break:** Karpathy
simplicity-first — the minimum design that solves the stated problem, no speculative flexibility.
**Method:** every claim below was checked against the working tree (file:line cited). Nothing here is
argued from the architecture document alone; where the architecture and the code disagree, the code wins
and the disagreement is listed as a finding.

---

## Altitude judgment (asked for explicitly by the brief)

`state.yaml` `tech_stack`: Node 22 / TypeScript ESM / vitest / better-sqlite3 / hand-rolled JSON-RPC MCP
server / two `GatewayClient` implementations (LiteLLM proxy subprocess, `@anthropic-ai/claude-agent-sdk`).
So the project is **both**: it is an ordinary single-node service *and* an AI-agent runtime that executes
untrusted author-written scripts which call `agent()`.

The v36 slice is **almost entirely system-altitude**. REQ-211 (per-version delete), REQ-212 (audit
identity), REQ-213 (`lastRunAt` + operational log), REQ-214 (control files) and REQ-216/K1–K8 are plain
service concerns: SQL, projections, a shell script, a pure function, a port contract. I apply the system
altitude to all of them and do **not** force an agent reading onto them.

**Exactly one requirement is agent-altitude: REQ-215.** Its subject is what an untrusted script can push
out of a sandbox and into a persisted engine record, and its acceptance text says so (clause (c): 「腳本可
控物件寫進磁碟」). For REQ-215 only, my boundary lens asks the agent-system questions — who authored the
value, what can a hostile script forge, what does the engine *attest* to when it prints a code — and my
testability lens accepts the requirement's own ban on mocking the IPC seam. Applying the agent altitude to
REQ-213's log or REQ-211's delete would manufacture threat models nobody has.

Consumability has an agent altitude here too, in one narrow place: `workflow_list`, `workflow_deregister`
and `workflow_authoring_guide` are read by **cold AI clients**, not only humans. That is why finding A3
(version string format) and A6 (error hints naming a callable shape) are rated higher than their size
suggests: a wrong format in a hint costs a cold client a failed tool call, not a raised eyebrow.

---

## Summary

The v36 architecture is unusually well-evidenced and I agree with its five big rulings (sibling
`deregisterVersion`, `Actor`, derived `lastRunAt`, `refusalRef` over a payload, no LIMIT on `listRuns()`).
My proposal does not reopen any of them. What I found instead is that **four ARCH rows name interfaces
that do not exist in the tree as described**, and one of them (`Actor`, ARCH-157/158) would, if
implemented literally, **silently widen admin privilege on the registration path** — a security regression
delivered by a row whose stated purpose is to improve audit integrity, and one that Gate 5 would catch only
if someone writes the exact test constraint 10 promises and nobody has written yet.

The five structural findings, in the order I would fix them:

1. **A1 (HIGH, security):** ARCH-157/158's one-`Actor`-per-`Principal` mapping changes ownership semantics
   on `register`, because `register`/`insertVersion` are gated with `attributionWithArg()` while
   `deregister`/`publish` are gated with `bypassWithArg()` — two different rules today. A single mint
   function cannot reproduce both. Proposed fix below is three lines and provably behaviour-preserving.
2. **A2 (HIGH, correctness):** ARCH-160 emits `entry.principal`; `RunEntry` has no such field.
   REQ-213's 「含 principal」 clause is unimplementable as written, and the field's real source
   (`RunSpec.principal`) is absent on the resume path.
3. **A3 (MEDIUM, consumability + a silent security gate):** three representations of 「version」 collide
   (`RunEntry.scriptVersion: number`, `RunSummary.scriptVersion: 'v3'`, catalog `version TEXT`, free-form
   enough that the code strips a `v` prefix defensively). ARCH-156's pinned-run probe compares a
   *normalized* value against a raw caller argument, so for an unprefixed catalog row the gate silently
   never fires; ARCH-160's log line emits a number where every other line emits a string.
4. **B4 (MEDIUM, security-adjacent):** ARCH-164's `: > "$LOG"` **truncates the previous instance's log**
   before every start — the slice that exists to create operational evidence begins by destroying it —
   and `create-then-chmod` leaves a umask-wide window on a file REQ-212 has just made PII-bearing.
5. **C1 (MEDIUM, testability):** the guard chosen for ARCH-159's composition-root wiring
   (`compose-config-v2-wiring.test.ts`) is a **FileConfig→ServerConfig** sweep. `eventSink` is not a file
   config key, so the probe as specified cannot fail for the reason it is meant to catch.

Everything else is smaller: six enumerated boundaries `deregisterVersion` owes its caller, one dead field
on `Actor`, one non-injectable clock, one untestable shell seam, and the nested-`workflow()` hole in
REQ-215 that should be scoped out **by name** rather than discovered at Gate 8.

---

## Evidence gathered (what I actually read)

| Claim under test | File:line | Result |
|---|---|---|
| register's gate identity | `mcp-facade.ts:350,360` → `attributionWithArg` | admin is **gated** on register today |
| deregister/publish gate identity | `mcp-facade.ts:390,437` → `bypassWithArg` | admin **bypasses** today |
| the three gates themselves | `workflow-catalog.ts:575, 669, 789` | identical expression, different input |
| `RunEntry` fields | `run-manager.ts:150-197` | no `principal`; `scriptVersion: number` |
| run-facing version format | `run-manager.ts:1500`, `types.ts:370` | `RunSummary.scriptVersion = \`v${n}\`` (string) |
| catalog version format | `workflow-catalog.ts:229` | `version TEXT`, values `v<N>` |
| sandbox outcome type | `sandbox/host.ts:75` | `type RunOutcome` — **local, unexported**; no `SandboxRunOutcome` |
| host error relay | `sandbox/host.ts:176-178` | `settle({ error: msg.error })` |
| child terminal send | `sandbox/child-entry.ts:142-146` | `send({t:'error', runId, error})` |
| shared reject site | `sandbox/child-entry.ts:64-82` | one site serves **agent() and workflow()**; shared `callSeq` counter |
| nested frame rebasing | `run-manager.ts:1355-1356`, `_frameBaseFor:1254` | handler sees `frameBase + callSeq` |
| nested error rethrow | `run-manager.ts:1373-1380` | `toErr(outcome.error)` → fresh `codedError` (**identity lost**) |
| refusal gate | `sandbox/guards.ts:175-187` | `ENGINE_REFUSAL_CODES`, matched on `code` **or `name`** |
| `capErrorEnvelope` | `errors.ts:298` | takes **one** argument; bound is **bytes**; may extend past the bound |
| seedRef capture | `run-manager.ts:692-695` | `code` computed separately from `toErr`; `failDetail` sliced by **chars** |
| `catalog.list()` | `workflow-catalog.ts:807,828` | already returns `description` |
| `workflowList` projection | `mcp-facade.ts:571-578` | drops it |
| the wiring sweep | `tests/unit/compose-config-v2-wiring.test.ts:53-70` | asserts `composeConfig(FileConfig)[key]` |
| config keys | `main.ts:84-96` | `retries`, `timeoutMs` exist; **no** `attempts` key |
| deploy start block | `deploy.sh:60-65` | `nohup … > .rwe.log`, `echo $! > .rwe.pid`, after steps 1–3 |

---

## Lens (a) — Interface contract

### A1 — `Actor` must be minted **per call site**, not per `Principal` (HIGH, blocks REQ-212)

ARCH-158 specifies one mapping function keyed on `Principal.kind`: `admin → {bypass:true}`. But the three
mutating catalog methods are not fed the same identity today:

- `validateRegistration` / `insertVersion` ← `attributionWithArg(principal, a)` (`mcp-facade.ts:350,360`)
- `deregister` ← `bypassWithArg(principal, a)` (`:390`)
- `publish` ← `bypassWithArg(principal, a)` (`:437`)

`attributionPrincipal` returns `p.id` for an admin (`:208-210`); `bypassPrincipal` returns `null`
(`:202-204`). Feeding the catalog gate `admin.id` means the gate **applies**: today an admin who registers
a new version of someone else's workflow is refused `NOT_WORKFLOW_OWNER`. Under ARCH-158's mapping, the
same admin arrives with `bypass:true` and `canMutate` returns true. That is an unrequested privilege
expansion on the one path that *writes script bytes*, shipped by an audit-integrity requirement.

The mirror-image error is in the same row: `auth-disabled` **with** `args.principal` is mapped to
`bypass:true`. `bypassWithArg` returns the supplied string — non-null — so the gate applies today, and the
facade's own comment says so verbatim (`:232-235`: 「with an `args.principal` on a no-auth server there IS
an identity to compare, so the gate applies」). `bypass:true` opens ownership for every no-auth caller who
passes a `principal` argument. Both errors point the same direction: **more access than today**.

**Proposed DES (behaviour-preserving by construction):**

```ts
// src/mcp-facade.ts — one function, one extra argument, zero new rules.
type Gate = 'bypass' | 'attribution';           // which of the two existing rules gates this call
function actorFor(p: Principal, a: unknown, gate: Gate): Actor {
  const gateId = gate === 'bypass' ? bypassWithArg(p, a) : attributionWithArg(p, a);
  const id     = attributionWithArg(p, a);      // WHO — always the attribution rule
  return { id, bypass: gateId === null, idSource: idSourceOf(p, a) };
}
```

`bypass ≡ (today's gate value === null)` reproduces `owner && principal !== null && owner !== principal`
exactly, for all four principal kinds, at all three call sites, given `canMutate(owner, actor)` =
`!owner || actor.bypass || owner === actor.id` (the `!owner` form, not ARCH-157's `owner === null` — see
C5 for why the difference is load-bearing). Nothing else in the design changes. The single
genuine addition REQ-212 asks for is that `id` is now computed by the **attribution** rule even where the
**bypass** rule gates — which is precisely 「記錄呼叫者的真實身分,並以獨立欄位標示以 admin 身分繞過」.

**Cost of getting this wrong is asymmetric**, which is why I rank it first: if the mapping is too strict a
test goes red; if it is too loose, little or nothing goes red. Checked:
`grep -rln NOT_WORKFLOW_OWNER tests/` returns ten files, of which four also mention `admin`
(`authz-enforcement-live`, `authz-owner-lookup`, `facade-refusal-arms`, `unit/authz`) — and those four
assert the **authz layer** (`authorize()`'s verdicts), not the catalog gate on the register path. I did not
find a case pinning 「an admin may NOT insertVersion over another owner's name」. I state that as what my
grep showed, not as proof of absence; either way the net that should catch R-1 is the one C5 proposes.

### A2 — `RunEntry.principal` does not exist (HIGH, blocks half of REQ-213)

ARCH-160's line is `principal: entry.principal ?? null`. `RunEntry` (`run-manager.ts:150-197`) has
`name`, `scriptVersion`, `resultError`, `effectiveParams` — no `principal`. The value exists on
`RunSpec.principal?: string` (`types.ts:72-73`) at admission and in the store's `started_by` column
(`RunSummary.startedBy`).

**Proposed DES:** add `principal?: string` to `RunEntry`, assigned in `_newEntry` from `spec.principal`,
**and on the resume path** (`_requireLive()` rehydration) from the persisted row — otherwise every resumed
run logs `principal: null`, which is the exact 「稽核軌跡與實際擁有權不一致」 defect REQ-212 exists to
delete, reintroduced one requirement later. A named Gate 5 case: *a resumed run's terminal line carries the
same principal as its start line.*

### A3 — pin one 「version」 representation across the slice (MEDIUM)

Three representations meet in v36:

- catalog: `workflow_versions.version TEXT`, values `v<N>` (`workflow-catalog.ts:229`)
- run view: `RunSummary.scriptVersion: string` = `` `v${n}` `` (`types.ts:370`, `run-manager.ts:1500`)
- run entry: `RunEntry.scriptVersion: number` (`run-manager.ts:169`)

The run pin is **normalized on both ends**: `entry.scriptVersion = Number(registered.version.replace(/^v/,
''))` (`run-manager.ts:533`, and again on resume at `:1145`), re-rendered as `` `v${n}` `` for the view
(`:1500`). That `replace(/^v/, '')` tolerance is there because the catalog's `version` column is free TEXT
and the codebase does not assume every row carries the prefix.

Consequences: (i) ARCH-156's probe `r.scriptVersion === version` is a raw **string** compare between a
value that has been through the normalizer and a caller-supplied one that has not. A catalog row stored as
`"3"` deletes cleanly while a live run pinned to it reports `"v3"` — the compare is false, the security
gate never fires, and a running workload loses its code. (ii) ARCH-160 emits `version:
entry.scriptVersion`, a **number**, on the same log stream where `catalog.register`/`publish` emit `"v3"` —
the first join an operator tries across the two line kinds fails.

**Proposed DES:** normalize **both sides inside the probe** —
`r.scriptVersion.replace(/^v/, '') === version.replace(/^v/, '')` — rather than pinning a schema pattern on
the argument. A `^v[0-9]+$` pattern would be worse than nothing here: it locks out deleting a legacy
unprefixed row *and* still leaves the two sides in different shapes. Malformed input is handled by A6's
`VERSION_NOT_FOUND` (the catalog lookup is the authority on which version strings exist), which is the
cheaper and more honest refusal. The `VERSION_CEILING_EXCEEDED` hint shows a literal
`workflow_deregister({name:"x", version:"v3"})`; the log line emits `` version: `v${entry.scriptVersion}` ``.
Two Gate 5 cases: (1) a catalog version stored **without** the `v` prefix, pinned by a genuinely
non-terminal run, is refused `VERSION_PINNED_BY_RUN`; (2) the run-terminal line's `version` and the
catalog line's `version` are the same string for one workflow.

### A4 — name the real sandbox outcome type (LOW, but it is a compile-time contract)

ARCH-167 widens `SandboxRunOutcome`. No such type exists. The real one is
`type RunOutcome = { result: unknown } | { error: unknown }` — **unexported**, `sandbox/host.ts:75`.

**Proposed DES:** `type RunOutcome = { result: unknown } | { error: unknown; refusalRef?: number }`,
keeping `'result' in outcome` as the discriminator (`run-manager.ts:1275`, `:1374` both use it). Do **not**
export it just for this; `run-manager` narrows structurally today and can read `outcome.refusalRef` inside
the `else` branch without an import.

### A5 — `Actor.kind` is a dead field; drop it (LOW, Karpathy)

ARCH-157 declares four fields. `canMutate` reads `owner`/`bypass`/`id`. ARCH-161's audit line writes
`{principal, bypass, idSource}`. `kind` is read by nothing. ARCH-157's own note says the catalog 「is
*told* `bypass`, it never infers it from `kind`」 — which is the argument for **removing** `kind`, not for
carrying it. Either drop it, or log it and say what a reader does with it. I propose dropping: three
fields, all read.

### A6 — `deregisterVersion` owes six enumerated outcomes, not three (MEDIUM)

ARCH-155 gives `Promise<{removed: boolean; remaining: string[]}>` and three refusal codes. `removed:false`
is unexplained: `deregister()`'s own contract says 「`removed:false` when the name was not present」
(`workflow-catalog.ts:660`). For the version path there are two absence cases, and they are not the same
answer to a caller:

| case | proposed answer | why |
|---|---|---|
| name absent | `{removed:false, remaining:[]}` | mirrors `deregister()`; a delete of nothing is not an error |
| name present, version absent | **`VERSION_NOT_FOUND`** | the code already exists (`:116`, `publish` uses it); silent success on a typo'd version is how an operator concludes a delete worked |
| version is a channel pointer | `VERSION_PINNED_BY_CHANNEL` | ARCH-155 |
| it is the last version | `VERSION_LAST_REMAINING` | ARCH-155 |
| a non-terminal run pins it | `VERSION_PINNED_BY_RUN` | ARCH-156 |
| caller is not the owner | `NOT_WORKFLOW_OWNER` | unchanged text |

Refusal **order** is part of the contract and must be pinned: ownership → not-found → channel →
last-remaining → pinned-run. Ownership first so a stranger cannot enumerate which versions exist by reading
which refusal comes back; pinned-run last because it is the only one that costs a cross-database read.

### A7 — triggers: the DES must **answer** this, not inherit it (LOW to write, MEDIUM if wrong)

`deregister()` returns `claimedTriggers` and the facade releases scheduler/webhook claims (`:390-397`).
`deregisterVersion` returns none. I cannot certify that as safe from the code I read, and I decline to
assert it: `deregister`'s own comment says `claimedTriggers` is 「the UNION of `triggers[]` over EVERY
version row (a beta-only claim is still a claim)」 (`workflow-catalog.ts:673-675`), so triggers **are**
claimed on non-release versions. The open question is whether a claim on a version pointed at by *no*
channel is live — `workflow-catalog.ts:140-141` says the `NOT_IN_RELEASE` check asks 「does the currently-
released version still list this trigger」, which suggests not, but 「not live」 and 「not claimed」 are
different states and only the second one leaks.

**The DES row must answer, with line numbers:** does anything release a non-channel version's `triggers[]`
when that version is deleted? If yes, `deregisterVersion` owes a `claimedTriggers` in its return and the
facade owes the same release call `:390-397` makes. If no, one sentence saying so, with the reader pointed
at both line numbers. What it must not do is stay silent — an orphaned scheduler claim on a deleted version
is the same class of defect as the v24 cron incident that comment was written for.

---

## Lens (b) — Boundary & error

### B1 — the marker dies in a nested `workflow()` frame; scope it out **by name** (MEDIUM)

Verified chain: the nested host settles its own outcome, and `run-manager.ts:1374-1380` does
`toErr(outcome.error)` then throws a **fresh** `codedError`. Object identity is gone, so ARCH-165's WeakMap
key is gone; the nested child's `refusalRef` is discarded at that line, and the nested child stamps its own
*local* `callSeq` while the parent's ledger would be keyed on `frameBase + callSeq`
(`run-manager.ts:1355`, `_frameBaseFor:1254`).

So: a `PARAM_UNKNOWN` refusal raised inside a nested frame reaches the run envelope with its **code** but
never with its **marker**. Two ways for that to bite silently: (i) an operator concludes the marker is
unreliable; (ii) someone "fixes" it later by widening the ledger key and collides two frames.

**Proposed DES:** scope REQ-215 to the **top-level frame**, explicitly, on the row; record refusals **only**
at the top-level wiring site (`run-manager.ts:1233`, where `framePath === ''`) so nested refusals cannot
consume the 8-entry ledger and evict the one that matters; and add one Gate 5 case asserting a nested
refusal still fails the run with its code and **no** marker — pinning the scope-out rather than leaving it
to be rediscovered. This is also the Karpathy answer: the alternative is threading refs through a
re-throw boundary that deliberately re-mints errors.

### B2 — the recorded set is a second copy of `ENGINE_REFUSAL_CODES` after all (MEDIUM)

ADR-072's rationale says `refusalRef` 「deletes the host-side table, so there is no second copy to guard」,
and on that basis the gate overruled quality-dimensions' drift-guard request. That is not quite right.
ARCH-168 defines a **recorded set** in `run-manager.ts` (「when the thrown code is in the recorded set」)
while `guards.ts:175` keeps its inlined `ENGINE_REFUSAL_CODES`. Two sets, two modules, one policy
(ADR-073). They are load-bearing in opposite directions: `guards.ts`'s decides what *propagates*,
`run-manager.ts`'s decides what is *recordable*. If they drift, a code that propagates but is not recorded
yields a ref that never validates (silent loss of the whole feature for that code), and a code that is
recorded but does not propagate yields a permanently dead ledger entry.

**Proposed DES:** keep both copies (the import direction genuinely forbids sharing — `guards.ts` cannot
value-import, per its own note at `:173-174` and the project's recorded sandbox-import constraint), and add
a **3-line drift test**: read the literal set out of `guards.ts` (it is a module-scope `Set` of string
literals — assert via a source-text regex, the same technique the repo already uses for byte-locked doc
pairs) and assert equality with the exported recorded set. The quality-dimensions lens asked for this guard
for a design that no longer exists; the ask survives its design.

### B3 — say precisely what the engine attests to (MEDIUM, agent altitude)

INV-V36-2 claims a script 「cannot mint, move or forge a refusal」. Precisely: it cannot forge a **ref**.
It *can* forge a **code**, and that is pre-existing, not new: `refusalCode()` (`guards.ts:183-186`) matches
on `e.code` **or `e.name`**, so `throw Object.assign(new Error('…'), {name:'PARAM_UNKNOWN'})` inside a
script propagates through `parallel()` and lands in the run envelope as `PARAM_UNKNOWN` with a
script-authored message and **no** ref. After ADR-073 that is now true for one more code than before.

**Proposed DES:** state the attestation boundary in the tool contract and the guide, in one sentence each —
*the run-level `error.detail` marker is engine-attested (lifted only against the parent's own ledger); the
`error.code` is not, and never has been.* And one Gate 5 negative case: a script forging
`name:'PARAM_UNKNOWN'` produces **no** `detail`. Without that case, the first reader of the new field will
reasonably assume the code is attested too, and the next security review will file it as a finding against
v36 rather than as the v25 inheritance it is.

### B4 — `deploy.sh` must not truncate the log it just made load-bearing (MEDIUM)

ARCH-164 specifies `: > "$RWE_LOG_FILE"; chmod 600 "$RWE_LOG_FILE"` before `nohup … >> …`. Two defects:

1. `: >` **truncates**. Today's script uses `>` too (`deploy.sh:63`), so this is inherited — but v36 is the
   iteration that makes this file the only place a register/publish/run-terminal record exists (ADR-076
   defers durable audit). Restarting the engine to investigate an incident would erase the evidence of the
   incident. The requirement's own motivation (「遠端出事只能翻 sqlite」) is void if the answer file is
   emptied by the restart.
2. create-then-`chmod` leaves a window at umask width on a file that REQ-212 has just filled with user
   emails. A concurrent reader during a two-instance start is not hypothetical here — two instances is the
   requirement's own scenario.

**Proposed DES:** `(umask 077; touch "$RWE_LOG_FILE")` — **the `umask` must be inside a subshell**, and
this is not a stylistic note: a bare `umask 077` before the `nohup` is inherited by the engine, and every
file it then creates (the SQLite databases, workspaces, CAS blobs) becomes 0600. That is a fleet-wide
permission change smuggled in by a requirement about pid files. Then `chmod 600 "$RWE_LOG_FILE"`
(idempotent; also repairs a pre-existing 0644 log from an older tree), and append with `>>`, never `:>`.
Four lines, no new concept, and it lets the Gate 5 assertion be *「the file created by `--dry-run` is 0600
**and** a pre-existing line survives a second start」*.

### B5 — `captureFailure`'s bound changes `failDetail`'s units and can exceed it (MEDIUM)

ARCH-169 makes the bound a parameter precisely so K1 does not regress K2 — correct, and it stops one step
short. `capErrorEnvelope` bounds **bytes** (`errors.ts:299-301`), while `failDetail` is
`rawMessage.slice(0, 200)` — **UTF-16 code units** (`run-manager.ts:695`). For the Chinese messages this
engine actually emits, 200 bytes ≈ 66 characters: a 3× narrowing of an operator-facing field. And
`capErrorEnvelope`'s documented forward extension to complete a `‹secret:NAME›` marker can push the result
**past** the bound by up to `MARKER_PREFIX.length + MAX_SECRET_NAME_CHARS` (`errors.ts:279-296`), so
`failDetail` is no longer 「200」 in any unit.

**Proposed DES:** keep the call, state the new contract on `RunStatusView.seedRef.failDetail` in one line
— *「redacted, then bounded to 200 bytes; may extend to at most 995 bytes to keep a redaction marker
intact」* — and assert both numbers in the K3 byte-exact case, which ARCH-169 already wants written
against `captureFailure` directly. If the owner wants 200 *characters* preserved, that is a second bound
parameter and I would refuse it on the Karpathy tie-break: the field is a diagnostic, and truncation units
are not worth a second code path.

### B6 — `captureFailure` must not swallow the seedRef `code` (MEDIUM)

ARCH-170 says 「`seedRefFail`'s `{code, message}` takes the same envelope」. Implemented literally as
`seedRefFail = captureFailure(err, secrets)`, the code changes: the site computes
`(err as {code?}).code ?? 'SEEDREF_FETCH_FAILED'` (`run-manager.ts:686`), whereas `toErr` falls back to
`err.name` — `'TypeError'`, `'FetchError'` — for exactly the network errors this path sees
(`errors.ts:257-264`). A view field that currently says `SEEDREF_FETCH_FAILED` would start saying
`TypeError`, and `failCode`'s three-value domain (`:694`) would stop matching it.

**Proposed DES:** `captureFailure` supplies the **message only** at this site:
`{ code, message: captureFailure(err, secrets, 200).message }`. Also pin the secrets argument shape —
`this._secretValueProvider?.entries() ?? []` — because `redact()` with an empty list is a silent no-op and
the seedRef site is *inside* admission, where the provider is optional.

### B7 — `TERMINAL` is about to be copied a sixth time (LOW, Karpathy)

ARCH-156 writes `TERMINAL.has(r.status)`. `run-manager.ts:140` defines `TERMINAL` as an **array**
(`.includes`), and four more private copies exist (`run-store.ts:376,409,441`, `workspace-gc.ts:11`,
`sqlite-run-store.ts:345`). The facade has none. **Proposed DES:** export the `Set` from `run-store.ts`
(where three of the copies already live, and which the facade already imports) and use it; do not create a
sixth literal. Zero new modules.

---

## Lens (c) — Testability

### C1 — the `eventSink` wiring probe is aimed at the wrong test (MEDIUM)

`compose-config-v2-wiring.test.ts` asserts `(await composeConfig(fileConfig, deps))[key]`
(`:53-70`) — it is a **FileConfig → ServerConfig** forwarding sweep. `eventSink` is not a file config key
(`main.ts:84-96` is the closed list) and never will be: it is an object the composition root constructs and
threads into two constructors. A probe row there either asserts a key nobody sets, or forces `eventSink`
into `ServerConfig` to make the test writable — shaping production to fit a guard.

**Proposed DES:** the guard for ARCH-159 is **one integration case in
`tests/integration/main-composition-root.test.ts`** (which the sweep's own comments already reference):
boot through the real composition root with an injected `write`, do one `catalog.publish` and drive one run
to a terminal state, assert exactly two lines arrive with the expected `kind`s. That fails for the real
reason (a forwarding that was never forwarded) and cannot pass vacuously.

I keep the sweep row for K8, with a correction: there is no `attempts` **config key**; the keys are
`retries` and `timeoutMs` (`main.ts:85-86`). The honest probe is that both reach the gateway config, plus a
pure unit test on `attemptsFor()` itself. If the intent was to probe the *derived* `attempts`, that value is
not in `ServerConfig` and the sweep cannot see it.

### C2 — the sink's timestamp must be injectable (LOW, 1 field)

ARCH-159's body is `{...event, at: <iso>}`. A non-injected `new Date()` makes every assertion on an emitted
line either time-blind or flaky, and this repo already owns `Clock`/`FixedClock` (used by the sweep itself,
`compose-config-v2-wiring.test.ts:16`). **Proposed DES:** `createEventSink(deps: {secrets?, write?, now?:
() => string})`, `now ?? (() => new Date().toISOString())`. One defaulted field; every emitted-line test
becomes exact.

### C3 — ARCH-165 is unit-testable without a child process, and should be (MEDIUM)

Constraint 2 rightly demands **one** real-child integration test for transport. But `evaluateScript` takes
an injected `SandboxApi` (`guards.ts`, `child-entry.ts:122-140`), so the provenance logic is reachable in a
plain unit test:

- positive: `api.agent()` rejects with an error passed through `markEngineRefusal(err, 7)`; the script
  rethrows; assert `{kind:'error', refusalRef:7}`.
- negative: the script catches and throws a **fresh** error; assert no `refusalRef`.
- forgery: the script sets `e.refusalRef = 99` on the caught error; assert **7** (the map wins).
- `parallel()` identity: the refusal is raised inside `parallel()`; assert the ref survives (this is
  constraint 3's pin, and it is cheaper here than through a real child).

That splits REQ-215's coverage the way the requirement asks: the IT proves the *seam* (unmockable), the UTs
prove the *policy* (pure). Four cases, no `fork()`, milliseconds.

### C4 — `--dry-run` as specified is not reachable from a test (MEDIUM)

ARCH-164 puts `--dry-run` 「before step 4」. Steps 1–3 run `npm install`, `cp` a config file into place when
missing, and can trigger `uv python install` + a venv build (`deploy.sh:18,27-54`). A seam whose cheapest
invocation installs a Python toolchain is not a regression test; it is a second Gate 7.5.

**Proposed DES:** handle `--dry-run` immediately after the `RWE_CONFIG_PATH` export, and **move that export
and the derivation block above step 1**. This keeps the D14 ordering constraint (resolution before the
step-2 config check, `deploy.sh:20-23`) strictly satisfied — it only moves earlier. The Gate 5 assertion is
then: run `deploy.sh --dry-run` twice against two config paths **in one directory**, assert two distinct
pid/log paths and 0600 on the created log. Two `sh` invocations, no engine, no npm.

### C5 — `canMutate` gets a 16-row table test, and it is the guard for A1 (MEDIUM)

Finding A1's fix is only safe if something pins it. The test that does it costs no database: for each
`(Principal.kind × args.principal present/absent × gate × owner)`, assert
`canMutate(owner, actorFor(p,a,gate))` equals the legacy expression
`!(owner && legacyId !== null && owner !== legacyId)` evaluated on the same inputs. Pure, exhaustive,
and it is *the* executable statement of constraint 10 — which today is written in prose and therefore
cannot fail.

**The `owner` axis is not decoration, and it exposes a second defect in ARCH-157.** The legacy gate tests
`row.owner` for **truthiness** (`workflow-catalog.ts:575, 669, 789`); `canMutate` as specified tests
`owner === null` for **strict equality**. They disagree on exactly one value: `owner === ''`, where the
legacy gate skips (falsy) and `canMutate` refuses. An empty-string owner is reachable — `attributionWithArg`
guards `supplied !== ''` (`mcp-facade.ts:228`) but the column is plain TEXT and pre-v15 rows were not
written through that path. **Specify `canMutate` as `!owner || actor.bypass || owner === actor.id`**, and
put `owner ∈ {null, '', 'alice'}` in the table. Constraint 10 says 「if a single existing test needs its
expectation changed, the refactor changed semantics and is wrong」 — an empty-string owner row is precisely
where that fires, and it fires in the *restrictive* direction, so it would surface as a mystery
`NOT_WORKFLOW_OWNER` on a legacy install rather than as a red test.

### C6 — `lastRunAtByName()` needs the both-implementations agreement case (LOW)

ARCH-162 adds a port method with a SQL implementation and an in-memory fold. This repo already has the
precedent for pinning SQL/TS twins with an agreement test (ADR-067). One case, both stores, same fixture:
two runs on one name, one workflow never run → the never-run name is **absent from the map** (so the
facade's `?? null` is what produces `null`, and `null` is not confusable with 「a run exists with a null
timestamp」).

---

## Internal conflicts between my three lenses (surfaced, then ruled)

1. **`Actor`: union vs flat struct.** (a) wants a discriminated union —
   `{id: string; idSource: 'authenticated'|'claimed'} | {id: null; idSource: 'none'}` — so the nonsense
   state `{id: null, idSource: 'authenticated'}` is unrepresentable. Karpathy wants the flat 3-field
   struct. **Ruling: flat struct**, because the mint is a single 5-line function with a table test (C5)
   covering every combination; a union would buy compile-time proof of something one test already proves
   exhaustively, at the cost of narrowing at every read site. I record the loss: if a second mint site ever
   appears, the union becomes correct.
2. **Nested-frame refusals: cover or scope out.** (b) wants them covered (a marker that works in 90% of
   frames is a trap). Karpathy says the plumbing crosses a boundary that deliberately re-mints errors
   (`run-manager.ts:1375`), and no requirement asks for it. (c) breaks the tie for Karpathy: covering it
   costs a second real-child IT with a nested workflow, which is the most expensive test shape in this
   codebase, and the scope-out is pinnable by one cheap negative case. **Ruling: scope out, pinned by
   name** (B1).
3. **`--dry-run`: shell seam vs 「Gate 7.5 will catch it」.** (c) wants the seam (v34's Gate 7.5 demonstrably
   did not catch it — it shipped a DEPLOY.md workaround instead). (b) objects that a seam in a script with
   three side-effecting steps in front of it is fragile. **Ruling: both are satisfied by moving the
   derivation to the top of the file** — the conflict is an artifact of the placement, not of the seam.
4. **`failDetail` units.** (a) wants a stable published contract (200 characters, as documented today);
   (b) wants redaction correctness (bytes, plus marker completion); Karpathy refuses a second bound path.
   **Ruling: bytes, and change the documented contract to match** (B5) — the field is a diagnostic, and
   the redaction property is the one the user's security posture depends on.
5. **The drift guard (B2) is a test for a *documented duplication*.** Karpathy dislikes tests that exist to
   watch constants. **Ruling: keep it**, because the duplication here is *forced* by a platform constraint
   (the sandbox child cannot value-import), so it can never be refactored away — which is exactly the
   condition under which a drift guard earns its keep. I would reject the same test if the duplication were
   merely convenient.

---

## Where task-splitting affects my lenses (the synthesizer writes `03-tasks.md`)

- **The declared ordering has a dependency inversion.** Constraint 1 orders REQ-211 (155/156) *before*
  REQ-213 (159..163). But ARCH-155 `deps: ARCH-159` and `deregisterVersion` emits `catalog.deregister`
  through `this._eventSink`. **Split REQ-213 in two:** `13a` = `src/event-log.ts` (type + factory +
  `now`/`write`/`secrets` injection) ships **first**, before REQ-211; `13b` = the emitters
  (`_transition`, catalog, `lastRunAt`, `workflow_list`) ship in their declared slot. The module has no
  dependencies of its own, so this costs nothing.
- **K2 (ARCH-170) as its own first commit is right, and its test must be real.** The assertion cannot be
  「the calls are in this order」 by inspection: inject a `SecretValueProvider` holding a value that appears
  in the seedRef error message, assert the emitted `failDetail` contains `‹secret:NAME›` and **not** the raw
  value, with the message long enough that the 200-bound actually cuts. Ordering asserted by outcome.
- **A1's fix belongs in the same task as ARCH-157/158, never split across them.** A task that lands
  `canMutate` + `Actor` and leaves the mint for a later task ships a window in which the catalog trusts a
  `bypass` field nobody computes correctly.
- **One task must own `deploy.sh` end to end** (derivation + dry-run + gitignore + DEPLOY.md). A split that
  puts the doc in a later task reproduces v34: the workaround text and the script disagreeing.
- **REQ-215 is one task, not four file-shaped tasks.** The four files (`guards`, `child-entry`, `host`,
  `run-manager`) have no independently testable intermediate state — a half-landed IPC field is dead code
  by construction, which is the failure mode v35 explicitly refused to manufacture.

---

## Risks

| # | Risk | Sev | Trigger / evidence | Mitigation I propose |
|---|---|---|---|---|
| R-1 | `Actor` mapping grants admin (and `args.principal` callers) ownership bypass on **register** | **HIGH** | `mcp-facade.ts:350/360` vs `:390/437` | A1's `actorFor(p,a,gate)` + C5's table test |
| R-2 | REQ-213's principal field lands as a literal `null` | **HIGH** | `RunEntry` has no `principal` (`run-manager.ts:150-197`) | A2: field at admission **and** on rehydrate; resumed-run case |
| R-3 | `VERSION_PINNED_BY_RUN` never fires because of a prefix mismatch | MED | pin is normalized (`run-manager.ts:533,1500`), the arg is not | A3: normalize both sides in the probe; unprefixed-row fixture with a real non-terminal run |
| R-3b | `canMutate` refuses where the legacy gate permitted (`owner === ''`) | MED | truthiness (`workflow-catalog.ts:575`) vs `=== null` (ARCH-157) | C5: `!owner` form + `owner ∈ {null,'', 'alice'}` in the table |
| R-4 | A restart erases the only audit trail the engine has | MED | `deploy.sh:63` `>`; ADR-076 defers durable audit | B4: `umask 077` + `touch` + `>>` |
| R-5 | The `eventSink` guard passes while the sink is unwired | MED | sweep asserts FileConfig keys only | C1: composition-root IT with an injected `write` |
| R-6 | Two refusal sets drift; the feature silently dies for one code | MED | `guards.ts:175` + ARCH-168's recorded set | B2: 3-line source-text drift test |
| R-7 | `failDetail` silently narrows ~3× on Chinese messages | MED | bytes vs UTF-16 units (`errors.ts:299` vs `run-manager.ts:695`) | B5: restate the contract, assert both bounds |
| R-8 | `seedRefFail.code` regresses to `TypeError` | MED | `toErr` name fallback (`errors.ts:261`) | B6: message-only substitution |
| R-9 | Nested-frame refusals look broken rather than out of scope | MED | `run-manager.ts:1375` re-mints the error | B1: scope out by name + negative case |
| R-10 | A reader believes `error.code` is engine-attested | MED | `refusalCode()` reads `e.name` (`guards.ts:185`) | B3: one contract sentence + forgery case |
| R-11 | `--dry-run` is never actually exercised because it costs an npm install | MED | `deploy.sh:18,27-54` | C4: move derivation above step 1 |
| R-12 | The 8-entry ledger is exhausted by nested-frame entries | LOW | shared `callSeq` rebasing (`:1355`) | B1: record only when `framePath === ''` |
| R-13 | A sixth `TERMINAL` literal | LOW | five copies today | B7: export the existing `Set` |

**Not a risk, deliberately:** ARCH-172's `owner_decision` (listSummaries pagination). It is a genuine
product question and I decline to pre-empt it. For task-splitting purposes both branches cost the same test
work (branch A: nothing; branch B: one pagination case plus one UI-copy string), so `03-tasks.md` can
proceed without the answer as long as no task is written that assumes either.

---

## Expected disagreements with the other lens (quality-dimensions)

1. **ADR-072 is settled; B2 is not.** I expect quality-dimensions to treat the `refusalRef` ruling as
   closed and to accept that its drift-guard ask was dissolved with the design. I am reopening **only the
   guard**, not the design: the second copy moved from `host.ts` to `run-manager.ts`, it did not disappear.
   Their ask was right for a reason that no longer applies, and still right for a reason that does.
2. **Observability altitude.** A quality-dimensions lens will likely want the log stream to carry more —
   correlation ids, levels, a `run.start` line to pair with `run.terminal`, agent-level events. I argue
   every one of those down on the Karpathy tie-break, with one I would **accept as an addition**:
   `run.start` is the line that makes a resumed run's identity auditable end to end, and it is cheap. It is
   **not** a substitute for A2 and I will not trade it for one: without rehydrating `principal`, the
   terminal line on a resumed run still emits `null`, which REQ-213's literal 「含 principal」 forbids.
   Rehydration is one field read in `_requireLive()`, not plumbing.
3. **Durable audit (`appendAudit`).** They may push to pull it into v36 against ADR-076. I side with the
   ADR — but I will hold them to it in one respect: my B4 says that deferral is only acceptable if the
   file stops being erased on restart. If B4 is rejected, I would rather re-open ADR-076 than ship an audit
   trail that a restart deletes.
4. **`listRuns()` in the delete probe.** They may object to an unbounded scan on a mutating path. I support
   ARCH-156/ADR-079 as written — a LIMIT there is a silently-open security gate — and I would rather add a
   comment than a bound.
5. **Where I expect to be told I over-reached:** A6's `VERSION_NOT_FOUND` and A3's schema pattern both add
   refusals the requirement did not name. I hold both: REQ-211's whole premise is 「錯誤提示不得叫人做工具
   做不到的事」, and a delete that silently succeeds on a version that does not exist is the same defect
   one layer down.

---

*Round 1, independent. Nothing above was written after reading the other lens's r1.*
