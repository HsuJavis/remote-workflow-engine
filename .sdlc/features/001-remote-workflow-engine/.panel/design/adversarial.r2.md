# Design panel — Adversarial group, round 2 (responses, final position, residual disagreement)

**Gate:** 3/4 merged (Tasks + Detailed Design), v36, REQ-211..216 / ARCH-155..173 / ADR-072..079.
**Lenses:** (a) interface-contract · (b) boundary & error · (c) testability. **Tie-break:** Karpathy.
**Read this round:** `quality-dimensions.r1.md` in full, then re-checked the four claims of theirs that bear on
my r1 against the tree. Findings are referenced by their r1 IDs (A1..C6, R-1..R-13); I reproduce text only
where the **ask changed**. Two new findings (D1, D2) came out of checking *their* claims, not mine.

**No ARCH ruling is reopened.** ADR-072 (`refusalRef`), ADR-073, ADR-076 (durable audit deferred), ADR-079
(no LIMIT) all stand. B2 remains a *guard* ask, never a design ask.

---

## 1. Verdicts on quality-dimensions' r1

| # | Their claim | Verdict | Discriminating reason |
|---|---|---|---|
| QD-1 | REQ-215's 4 files (ARCH-165..168) are **one task**, real-child IT written RED first | **concede — already my position, plus one case of theirs I did not have** | identical to my r1 task-splitting section (a half-landed IPC field is dead code by construction); I adopt their second named case: **a 9th refusal in one run increments `refusalsDropped` and evicts nothing** — ARCH-168's cap needs its own assertion, and my C3 only covered their first case (`parallel()` same-object) |
| QD-2 | ARCH-169/170 contradict each other on K1/K2 order; design must pick a reading | **concede the finding, and pick** | my B6 forces the answer: ARCH-170's `api:` line is only writable if `captureFailure` already exists → §2.4 fixes a 3-commit order |
| QD-3 | `EventSink` module + its call sites + its wiring guard = **one task** | **concede the pairing, rebut the instrument** | pairing matches the repo's own named bug class; but their guard (a row in `compose-config-v2-wiring.test.ts`) cannot fail — C1, line-cited. §2.2 |
| QD-4 | Typed `EngineEvent` discriminated union replaces `Record<string, unknown>`; required `actor:{id,bypass,idSource}` on every audit kind | **concede the union (trimmed); concede `catalog.deregister` outright; rebut "every kind"** | §2.1 — my own r1 criterion (multiple emit sites ⇒ union) decides it against me; `bypass` is *unreachable*, not merely unused, on `run.terminal` (D2) |
| QD-5 | Cross-conformer contract test for `attemptsFor` across both `GatewayClient`s | **partial concede, redirected** | their principle is right and their target is the wrong one; the real twin divergence is `getSpec` (D1). §2.3 |
| QD-6 | ARCH-171 + ARCH-173 + `docs/AUTHORING.md` = one task, one commit | **concede** | plus their point I did not make: on a ~20-agent shared tree a momentarily-red guide-diff test is ambiguous between "known WIP" and "someone broke it" — that is a better argument for the pairing than mine |
| QD-7 | REQ-211's hint-text rewrite is the SAFE-to-split calibration example | **concede** | no cross-file runtime coupling; use it as 03-tasks.md's contrast case. Note it must still carry A6's refusal-code additions, which are *not* hint-only |
| QD-8 | `lastRunAt: null` for a never-run workflow gets its own assertion | **concede — same test as my C6** | merge into one case: never-run name **absent from the map**, `null` produced by the facade's `?? null`, asserted on **both** stores |
| QD-9 | `deploy.sh --dry-run` harness = vitest shelling out, pinned once at design time | **concede, with C4 as its precondition** | their harness is only *reachable* if `--dry-run` precedes step 1 (`npm install` / `uv python install`). §2.5 |
| QD-10 | ARCH-172's `owner_decision` carried forward, non-blocking, not silently resolved | **concede — identical to my r1** | REQ-216/K5 is discharged by ADR-079; the residue is an owner-visible semantic question |
| QD-11 | `client.ts` + `claude-agent-sdk-client.ts` + shared helper = one task | **concede** | a split invites a third free-handed formula; ARCH-171 already unified it |
| QD-12 | Untyped sink is also a *replaceability* gap | **concede, no separate action** | same edit as QD-4; noted so the synthesizer does not count it twice |

**Predictions of mine that did not materialize — closed, not padded.** QD did not ask for durable
`appendAudit` against ADR-076, did not object to the unbounded `listRuns()` scan, and did not propose
resolving ARCH-172. My r1 disagreements 3, 4 and 5-on-ARCH-172 are therefore **withdrawn as moot**.

**I also withdraw my own pre-offered concession.** r1 offered `run.start` as a paired line "if
quality-dimensions pushes on observability." Nobody pushed. A2 + D1 give resumed-run identity without a new
line kind, so `run.start` is **dropped** — an unrequested event kind is exactly the speculative flexibility
the tie-break exists to refuse.

---

## 2. The five rulings that needed more than a row

### 2.1 `EngineEvent` — concede the union, on my own stated criterion, trimmed by new evidence

My r1 ruled `Actor` a flat struct over a discriminated union and wrote the criterion down: *"if a second
mint site ever appears, the union becomes correct."* Events have **four** emit sites across two modules
(`_transition`, `deregisterVersion`, `insertVersion`, `publish`). Applying my own rule honestly, the union
wins here for the same reason the flat struct won there — and QD supplies the empirical clincher I cannot
argue past: the untyped `Record<string, unknown>` **already** shipped an inconsistency *inside the
architecture round*, before any code exists. A test catches today's three kinds; the type prevents kind four.
So: **concede**.

Two trims, both evidence-driven, and the second is a new finding.

**Trim 1 — `catalog.deregister` gets the full actor, no argument.** QD is right that the one new destructive
action carrying no actor fields is an interface-contract miss, and it is *my* miss: A1's
`actorFor(p, a, gate)` makes a fully-populated `Actor` available at exactly that call site, so omitting it
costs nothing. Conceded outright.

**Trim 2 (NEW, D2) — `run.terminal` must NOT carry the triple, because two thirds of it are unreachable
there, not merely unused.** Checked this round:

- `mcp-facade.ts:625` — `runStart` mints identity with `attributionPrincipal(principal)`, **not**
  `attributionWithArg(...)`; and `run_start`'s schema is `additionalProperties:false` (facade comment,
  `:613`), so `args.principal` cannot reach the run path at all.
- The other two admission paths never supply one either: `scheduler.ts:363` and `webhook-registry.ts:305`
  pass `startedBy` only.

Therefore on the run path `idSource:'claimed'` is **structurally unreachable** and `bypass` has no meaning —
no ownership gate runs at run admission. QD's "shared required `actor` on every audit-bearing kind" would
stamp a permanently-`false` `bypass` and a derived-not-observed `idSource` on every `run.terminal` line: a
field that looks attested and is not, which is the same class of defect as B3.

**Proposed DES (AMENDED from r1's A2 / QD-4):**

```ts
type AuditActor = { id: string | null; bypass: boolean; idSource: 'authenticated' | 'claimed' | 'none' };
export type EngineEvent =
  | { kind: 'catalog.register';   name: string; version: string; actor: AuditActor }
  | { kind: 'catalog.publish';    name: string; version: string; channel: string; actor: AuditActor }
  | { kind: 'catalog.deregister'; name: string; version: string; actor: AuditActor }
  | { kind: 'run.terminal'; runId: string; name: string | null; version: string; status: string;
      principal: string | null };
```

Exactly the kinds v36 emits — **not** extensible-by-design; a v37 kind is a v37 edit, which is the point.
`AuditActor` is A1's `Actor` reused, so the mint function and the audit line cannot disagree by construction.
`version` is **required** on `catalog.deregister`: ARCH-161's `api:` line wires `publish`, `insertVersion` and
`deregisterVersion` only — the legacy whole-name `deregister()` is **not** an emit site this round, so the kind
cannot occur without a version and §2.2's ordering (this emit waits for REQ-211's task) stands as written.
`run.terminal.principal` is deliberately a different field name from the catalog kinds' `actor.id` so no
operator reads across them as equivalent.

**One guard keeps D2's derivation honest (NEW):** a test asserting `run_start` refuses a caller-supplied
`principal` argument. If a future iteration makes run admission honor `args.principal`, that test goes red
and forces `run.terminal` to grow an `idSource` at the same moment — instead of the line silently becoming a
lie. This is the cheapest possible substitute for the field QD wants, and it fails for the right reason.

### 2.2 The wiring guard — same task boundary as QD asks, different instrument

I concede QD-3's task rule in their own words: the sink, its call sites and its guard are one task, because
`composeconfig-wiring-bug-class` records this exact split producing the bug twice (v11, v15). What I hold is
C1: `compose-config-v2-wiring.test.ts:53-70` asserts `composeConfig(fileConfig, deps)[key]` — a
**FileConfig→ServerConfig** sweep — and `eventSink` is not a file config key (`main.ts:84-96` is the closed
list) and must not become one just to make the guard writable. A probe row there either asserts a key nobody
sets or shapes production to fit a test. **Guard = the composition-root integration case** (C1): boot the
real root with an injected `write`, do one `catalog.publish`, drive one run terminal, assert two lines with
the expected `kind`s.

**Dependency wrinkle QD's "one task" cannot absorb, resolved by ordering rather than splitting.** ARCH-155
`deps: ARCH-159` — `deregisterVersion` emits `catalog.deregister`, but `deregisterVersion` does not exist
until REQ-211's task. So the third call site *cannot* land in the sink's task. The rule that survives both
constraints: **capability + guard ship together, and the guard grows with each call site in the same commit
that adds it.** Sink task (module + `publish` + `run.terminal` + 2-line IT) lands **before** REQ-211; REQ-211's
task adds `catalog.deregister` **and its third assertion in the same commit**. This replaces r1's `13a/13b`
split, which QD is right to dislike as stated.

### 2.3 `attemptsFor` — their principle is correct; their target is not where it bites

I withdraw the "tautological" objection I flagged in r1. QD's point is sharper than I credited: the shared
export removes the *source* of drift but nothing asserts the *import* happened, and a free-handed local fix
is exactly the failure mode. What I refuse is the **full behavioral** cross-conformer test — asserting real
retry counts through both conformers means mocking `fetch` **and** the Agent SDK, the two most expensive
harnesses in this repo, to prove an import. **Cheapest honest form (AMENDED C1):** one table test on the pure
`attemptsFor()`, plus a per-conformer assertion that each calls the export (spy, or the source-text technique
I already accept in B2). Two cheap instruments, same coverage, no SDK mock.

**And here is the twin divergence their instrument should actually be aimed at — NEW, D1, HIGH:**

- `store/sqlite-run-store.ts:115-116` **persists** `spec.principal` into the runs table's `principal` column.
- `store/sqlite-run-store.ts:149` — `getSpec()` reads `SELECT name, script, args, budget, started_by` —
  **`principal` is not selected**, and `:153-159` does not return it.
- `run-store.ts:314-317` — the in-memory twin returns `run.spec` **whole**, principal included.

`getSpec()` is the resume-path rebuild (its own comment: *"lets RunManager reconstruct a live RunEntry for a
suspended/stopped run after a process restart (REQ-006)"*). So R-2 is worse than r1 stated, and in the worst
possible way for Gate 5: **a resumed-run identity test written against the in-memory store passes, while
production on SQLite emits `principal: null`.** This is the ADR-067 SQL/TS-twin class, exactly the shape QD's
contract-test principle is for.

**Proposed DES (AMENDS A2 / R-2):** add `principal` to `getSpec()`'s SELECT and to its returned `RunSpec`
(two lines, no schema change — the `principal` column is already written at `:115-116` and read by the
  status-view query at `:305`); `RunEntry.principal` assigned from
`spec.principal` at admission **and** on rehydrate; **a both-stores `getSpec` agreement test** (same precedent
and fixture shape as C6): one run started with a principal, round-tripped through each store, same
`spec.principal` out. Without this, REQ-213's 「含 principal」 clause is satisfied only for runs that never
restarted — the resumed-run half of the audit trail is the half an incident investigation reads.

### 2.4 K1/K2 — QD found the contradiction; here is the order, because the synthesizer needs one

ARCH-170 says K2 lands first, but its own `api:` line calls `captureFailure`, which ARCH-169 introduces. QD
correctly refuses to let an implementer resolve that by reading order. My B5/B6 determine the answer, and
ARCH-170's **prose** ("`seedRefFail`'s `{code, message}` takes the same envelope") must lose to its **`api:`
line** (`.message`), because B6 shows the prose reading regresses `failCode` from `SEEDREF_FETCH_FAILED` to
`TypeError` via `toErr`'s name fallback (`errors.ts:257-264`).

**One task, three commits, this order:**

1. `captureFailure(err, secrets, boundBytes)` as a **pure function with no call-site change** + K3's
   byte-exact test (B5: bounded to 200 **bytes**, may extend to at most 995 to complete a `‹secret:NAME›`
   marker). Smallest reviewable unit; nothing observable changes.
2. **K2's security fix**, as `{ code, message: captureFailure(err, secrets, 200).message }` at the seedRef
   site, with the outcome-asserted test from my r1 (inject a `SecretValueProvider` whose value appears in the
   error message; assert `failDetail` contains `‹secret:NAME›`, not the raw value, with the message long
   enough that the bound actually cuts) — and the secrets argument pinned as
   `this._secretValueProvider?.entries() ?? []`, because `redact()` on an empty list is a silent no-op and
   this site sits inside admission where the provider is optional.
3. K1 collapses the **other** capture site onto the same function.

This preserves QD's reviewability goal (the security fix is its own commit, no refactor wrapped around it)
and ARCH-170's `api:` line simultaneously.

### 2.5 `deploy.sh` — their harness, my precondition, one test

Concede QD-9's choice (vitest shelling out via `node:child_process`, keeping the coverage inside `npm test`);
I drop nothing for the standalone-shell alternative. But their harness is unreachable as ARCH-164 places the
flag: `--dry-run` "before step 4" still sits behind `npm install` and a possible `uv python install` +
venv build (`deploy.sh:18,27-54`). **C4 is the precondition**, not a competing proposal: move the
`RWE_CONFIG_PATH` export and the path derivation **above step 1** and handle `--dry-run` immediately after —
which only moves the D14 ordering constraint *earlier*, so it stays satisfied.

One test, carrying B4's assertions too: run `deploy.sh --dry-run` twice against two `RWE_CONFIG_PATH` values
in one directory; assert (i) two distinct pid paths and two distinct log paths, (ii) the created log is
**0600**, (iii) **a pre-existing line in the log survives a second start** (B4: `: >` truncates, and ADR-076
makes this file the only audit record that exists). B4's `(umask 077; touch …)` subshell stays mandatory —
a bare `umask 077` is inherited by the engine and turns every SQLite DB, workspace and CAS blob 0600, which
is a fleet-wide permission change smuggled in by a requirement about pid files.

---

## 3. Consolidated DES asks for the synthesizer

**NEW this round**

- **D1** — `getSpec()` returns `principal` (SQLite SELECT + return, 2 lines); both-stores `getSpec` agreement
  test. *Amends A2/R-2 from "field missing on the entry" to "field silently dropped by one store only."*
- **D2** — `EngineEvent` union per §2.1: full `AuditActor` on the three `catalog.*` kinds (incl.
  `deregister`), `principal: string | null` on `run.terminal`; plus the guard test that `run_start` refuses a
  caller-supplied `principal`.

**AMENDED**

- **A2** — now includes D1; rehydration source named (`runs.principal`, written at `sqlite-run-store.ts:115-116`, read at `:305`, absent only from `getSpec`).
- **C1** — sink guard = composition-root IT (unchanged); `attemptsFor` guard = pure table test **+
  per-conformer import assertion** (was: pure unit test only). No `attempts` config key exists;
  `retries`/`timeoutMs` are the keys (`main.ts:85-86`).
- **C6** — merged with QD-8 into one never-run-workflow case asserted on both stores.
- **C4** — restated as the *precondition* of QD's vitest harness, with B4's three assertions folded in.
- **Task order** — r1's `13a/13b` split withdrawn; replaced by §2.2's "sink task first, guard grows with each
  call site in its own commit."
- **K1/K2** — three-commit order fixed in §2.4; ARCH-170's prose loses to its `api:` line.
- **Dropped:** `run.start` (unrequested).

**UNCHANGED from r1** (no counter-argument was offered against any of these)

A1 `actorFor(p, a, gate)` + R-1 — still the highest-severity finding in the slice: ARCH-158's
one-`Actor`-per-`Principal` mapping widens admin privilege on `register`, because register/insertVersion are
gated by `attributionWithArg` (`mcp-facade.ts:350,360`) while deregister/publish are gated by
`bypassWithArg` (`:390,437`). · A3 normalize **both** sides of the pinned-run probe (`replace(/^v/, '')`),
no schema pattern. · A4 `RunOutcome` is the real type (`sandbox/host.ts:75`), unexported, `refusalRef?`
added there. · A5 drop `Actor.kind`. · A6 six enumerated `deregisterVersion` outcomes, refusal order
ownership → not-found → channel → last-remaining → pinned-run. · A7 the DES must **answer** the
non-channel-version trigger-claim question with line numbers, not inherit it. · B1 scope REQ-215 to the
top-level frame **by name**, record only when `framePath === ''`, one negative case. · B2 3-line refusal-set
drift test (the duplication is *forced* by the sandbox value-import constraint, so it can never be
refactored away — the one condition under which a constant-watching test earns its keep). · B3 one
attestation sentence + forgery case (`refusalCode()` matches `e.name`, `guards.ts:185`). · B4 (folded into
the deploy test above). · B5/B6 (sequenced in §2.4). · B7 export the existing `TERMINAL` set, do not write a
sixth copy. · C3 four pure UTs on the provenance policy + **one** real-child IT for the seam, + the `refusalsDropped` cap case adopted from QD-1. · C5 the
16-row `canMutate` table test, `!owner` form, `owner ∈ {null, '', 'alice'}` — R-3b (truthiness vs
`=== null`) fires in the *restrictive* direction on legacy installs and is otherwise invisible.

---

## 4. Internal three-lens conflicts — only what changed

- **Conflict 1 (`Actor` flat vs union) — outcome split, and the split is principled.** The *mint* stays flat
  (one site, exhaustively covered by C5's table). The *event* becomes a union (four emit sites, two modules).
  Same criterion, different site count, opposite answers; r1 stated the criterion and this round applies it
  against my own prior instinct.
- **Conflict 6 (NEW, (a) vs (b) on `run.terminal`'s identity).** (a) wants one uniform actor shape across all
  four kinds so consumers parse once. (b) refuses to emit a `bypass` that no code path can ever set true and
  an `idSource` that is derived rather than observed. **Ruling for (b)**, with (c) supplying the mitigation
  that makes the asymmetry safe rather than merely tolerated: the `run_start`-refuses-`principal` guard test
  (§2.1) converts "derivation is currently sound" into "the derivation cannot rot silently."
- Conflicts 2–5 from r1 stand unchanged; none were contested.

---

## 5. Remaining disagreement (one, genuinely open)

**Whether the `attemptsFor` guard must be behavioral across both conformers.** I concede the principle and
propose pure-table-test + per-conformer import assertion (§2.3). If quality-dimensions holds for a real
behavioral test — same `(retries, timeoutMs)` table, assert the actual transport-call count through each
conformer — that requires mocking `fetch` and the Agent SDK, and I refuse it on the tie-break: the added
coverage over "both call the shared export" is the possibility that a conformer calls the right function and
then ignores its answer, which is a different defect from the one K6/K7 closes. **Gate-visible framing for
the synthesizer:** my form is ~15 lines and lands inside K7's stated sizing; theirs is a new test harness. If
the gate prefers theirs, it should say so as a deliberate scope increase on K7, not fold it in silently.

Everything else in this round converges.

*Round 2. Written after reading `quality-dimensions.r1.md` in full; D1 and D2 were found while checking
their claims, and both strengthen their position, not mine.*
