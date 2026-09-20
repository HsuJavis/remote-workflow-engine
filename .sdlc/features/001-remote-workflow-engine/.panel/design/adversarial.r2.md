# Design panel — adversarial group (interface-contract / boundary-error / testability), round 2

**Read this round:** `quality-dimensions.r1.md` (all five gaps + their five risks), my own `adversarial.r1.md`.
**Verified in this gate, not reasoned about:** `src/store/sqlite-run-store.ts:217-241`, `src/run-manager.ts:150-156`, `src/types.ts:214-296` and `:318-321`, `src/run-view.ts:11-14`, `src/secret-resolver.ts:95-130`, `src/agent-executor.ts:22-53`, `:662-671`, `src/sandbox/{guards,host,child-entry}.ts`, `01-requirements.md:2776-2794` (REQ-207's acceptance text), `02-architecture.md` INV-V26-5 (`:3174`) and the R-G9 clauses (`:638`, `:768`, `:3438`).
**Tie-breaker unchanged:** Karpathy simplicity-first.

---

## 0. State of the debate

**Most of the conflict I braced for in r1 §8 did not happen.** The quality-dimensions lens did not contest count-vs-text, presence-vs-omission (C4), `structuredContent`-now-vs-v36, D4's resolution, D2's fix, or C2 — it either agreed explicitly or did not raise them. Its five gaps are orthogonal to my eleven findings, not opposed to them. So round 2 is short by design: **five responses, two new findings, eleven holds.** The one place we genuinely disagree is narrow and I name it in §4.

Two of my own r1 positions do not survive this round's verification and I retract them in §1 (QD-2) and §2 (QD-1) rather than defend them.

---

## 1. Responses to quality-dimensions r1

### QD-1 — "write ordering inside `recordError` is unstated; add a kill-between-writes test"

**Concede the concern. Rebut the test. Relocate the defect — it is real, and it is not the ordering.**

They correctly anticipated my likely rebuttal ("Node is single-threaded, the two writes are synchronous") and correctly pre-empted it: a SIGKILL lands between two synchronous statements just as readily as between two asynchronous ones. That half is right and I concede it without reservation.

But the ordering itself is not an open question. `recordResult` (`sqlite-run-store.ts:233-238`) already fixes the convention — `UPDATE runs SET result = ?` first, `appendFileSync(journal.jsonl, {type:'result',…})` second — and `recordTransition` (`:217-221`) carries the repo's O-2 comment for the same family. ARCH-143's own word is 「mirrors `recordResult`」. One clause in the design ("column first, journal second, as `recordResult`") states it at zero cost, and I support adding it.

**What the crash window actually exposes is a bug in ARCH-142, not a missing test.** ARCH-142's new resolution step in `result()` is **ungated**:

```ts
const stored = await this._store.getError(runId); if (stored) return { ok: false, error: stored };
```

— while the pre-v35 fallback three lines below *is* gated (`if (view?.status === 'failed')`). Compose that with the crash window: the column is written, the process dies before `_transition(…, 'failed')`, the row is still `running`, and REQ-060's restart reclassification makes it **`interrupted`** — a resumable, non-terminal state. After restart, `run_status` says `interrupted` and `run_result` says `{ok:false, error}`. Two surfaces, one run, one instant, contradicting — which is D3's defect class reproduced inside the fix for REQ-205, and it is exactly the 「`result()` stops lying after a restart」 property ARCH-142 exists to establish.

**Fix, and it is a guard, not a test:** gate the new step the same way as its neighbour — `if (view?.status === 'failed') { const stored = await this._store.getError(runId); if (stored) return …; }`. The `view` is already in scope for the pre-v35 fallback, so this is one condition, not a new fetch.

**Why the kill test then comes off the list (Karpathy):** once `getError` is gated on the status, no served surface can distinguish the two write orders — a crash before the transition yields `interrupted` on both surfaces with a column nobody reads, and a crash between the two writes inside `recordError` yields a column and a journal that differ only in an audit line. There is no seam between two statements inside one store method, so testing it needs process-level fault injection: a new harness, for a microsecond window, on the diagnostic path, whose worst outcome is an incomplete audit trail. **Buy the cheaper assertion instead** — a UT that calls `recordError` once and asserts the column and the journal line carry the **same already-redacted value**, which is what ARCH-143's 「ONE method writing both surfaces」 claim actually promises and what currently has no test at all.

**I take their real payload, which is better than the test they asked for:** the design must name which surface a reader trusts. `runs.error` is **authoritative** (it is what `getError`/`run_result` read); the journal line is the **audit trail**, matching `recordResult`'s existing D-I2 wording verbatim. That is the one sentence that makes a disagreement between the two surfaces interpretable instead of alarming.

### QD-2 — "per-agent failure has no code/message surface parallel to the new run-level one"

**Concede, with the citation they asked for — and it retracts one of my own r1 arguments.**

They asked for one line confirming this is pre-existing machinery. It is, and here it is with line numbers: `AgentRecord.detail?: string` (`types.ts:269-276`, v26 H-3 / ARCH-111 / DES-171 / INV-V26-5) is the provider-authored error detail from a `state:'failed'` call, **redacted then capped at 1024 bytes**, present on `run_status.agents[]` and the dashboard agent detail; `reasonCode?: ErrorCode` (`:285-287`) carries the named reason on a `refused` record. v35 touches neither. ARCH-146 should say so in one clause.

**Their gap exposes a false statement in ARCH-153, which I raise as D13 (MED) in §3** — and it costs me my own r1 R8 rationale. I argued that run-level narrative text must stay out because 「`/api/runs*` are unauthenticated reads and per-agent error text is gated differently」. **That premise is wrong on the facts.** `toPublicRunView` (`run-view.ts:11-14`) strips exactly one field, `principal`; `RunStatusView.agents: AgentRecord[]` (`types.ts:318-321`) goes out whole on the ungated `/api/runs/:id` (`server.ts:604-611`). Per-agent narrative error text has been on the run-level view since v26.

**The conclusion survives; the reason changes.** `failedAgentCount` stays a count because REQ-207's acceptance asks for 「失敗 agent 數/比例,或一個明確的健康欄位」 — a number is literally what was requested — and because a second text channel at the run level is a second thing to bound, redact and sweep for no requirement. Simplicity and the REQ text, not an authorization asymmetry that does not exist.

**One residual I hold rather than concede:** `detail` is absent on a `failed` record whose gateway reported none, and a `failed` record carries no `code` at all (only `refused` gets `reasonCode`). So "timeout vs. schema-retry-exhaustion vs. provider error" is **not** answerable from the record alone for every failure — their diagnosis is right. I hold it **out of REQ-207's closure line** (the REQ's run-level clause is discharged by the count; its other two clauses are guide/describe items) and file it as a v36 candidate with these line numbers attached — the same move they used for their own #4, applied consistently.

### QD-3 — "`failedAgentCount` has no dashboard rendering item, asymmetric with `error`"

**Rebut on closure. The asymmetry is explained by the requirement text, not by an oversight — and I checked before answering.**

REQ-205 names the dashboard in as many words (「`run_status` / `run_list` / dashboard 則失敗原因是可見欄位,不必翻 sqlite」), which is why ARCH-153 exists. **REQ-207 does not.** Its acceptance (`01-requirements.md:2780-2784`) is written entirely about 呼叫端 — the *caller* — and its stated defect is 「現況需要呼叫端自己去讀 `agents[]` 才發現」. On the dashboard a human is not the caller and `agents[]` is not a JSON field to be read: the run detail pane already renders per-agent records with their `state`, so three dead agents are visible by eye. The requirement's gap is at the machine-readable surface, and that is precisely where ARCH-143/146 put the fix.

**Conditional concession, because if it lands anyway the placement matters and their proposal has it wrong.** They proposed it ride 「the same 'no new endpoint, no new fetch' property ARCH-153 already established」, i.e. the list row. Under D3 that is the one place it must **not** go: `run_list`'s SQL fold is omitted for every non-terminal run, so a list column would be blank for exactly the run an operator is watching. If a designer takes it, it belongs on the **run detail pane**, which reads `run_status` → `_mergeLive` → the live spawner records and is therefore correct while the run is running. Detail pane yes, list row no.

### QD-4 — "authoring-guide growth is a self-sustainability / memory-metabolism risk, keep the framing on the v36 filing"

**Concede fully, one sentence, no cost — with one refinement that makes it testable.**

The v36 filing should carry the **number ARCH-152 now computes at runtime**, so the next iteration opens with a trend rather than a re-measurement, and the trigger is stated as 「the computed size crosses a declared budget」 rather than 「it feels big」. ADR-070's evidence bar was right to reject (c) for v35; this turns the deferral into something that can actually fire. It costs the filing one number and one threshold.

### QD-5 — "`run_result`/`run_status` descriptions don't document the two new response fields; REQ-079's closure is thin"

**Concede — and they predicted I would call this scope creep, so I record that I was going to and changed position for a reason, not a mood.**

My own r1 agent-altitude rule decides it against me: 「*consumability* = the advertised surface states the failure mode **before** the caller can hit it (not after, in an error message)」. A field a cold client can only discover by parsing `content[0].text` and getting lucky is that failure, one level out, in a slice whose evidence is a cold caller defeated by an unstated contract.

**And it is not additive to my position — it is the carrier of D3's mitigation.** D3 requires `failedAgentCount` to be *omitted* on every non-terminal run. An omission that is not advertised is read as a zero, and a cold poller reading absence as health is REQ-207's defect exactly. So the sentence is load-bearing, not decorative, and it must state **omission semantics**, not merely that the field exists:

> `run_result` — on a failed run the response carries `error: {code, message, detail?}`; `detail` is absent when none was recorded.
> `run_status` / `run_list` — `failedAgentCount` counts terminal non-success agents (`failed`/`refused`). It is **omitted**, never `0`, when the run has no agent records; on `run_list` it is present only for a run that has reached a terminal state. Absence is not health — poll `run_status` for a live count.

I take their delivery mechanism as-is: **a 12th Gate-3/4/5 constraint on the existing list, not a new ARCH row.** It is prose on two existing tool descriptions — no schema change, no behaviour change, nothing for `trace.py` to close.

---

## 2. Positions held from r1, unchallenged — tabled, not re-argued

D1 (option 2: delete the dead `.detail` forwarding + its bound, keep the file move, defer REQ-205's fourth criterion with its four line numbers; contract lens dissents on the record) · D2 (scope `hasSecretMarker` to the dispatched fields; secret-in-args suspend/resume test) · D3 (snapshot-present predicate `row.agentCount != null && > 0`; terminal-only stated on the surface; the five-case matrix, case (iii) running) · D4 (`unscannable?: true` + one line at each of the four read callers) · D5 (materialize before `validateDeclaredArgs`; optional `checkValueAgainstSpec` on `.default` at registration) · D6 (the six typing/wiring gaps, including the fourth `getRun`/`RunStatusView` site and `toErr`'s second caller at `run-manager.ts:1306`) · D7 (`try/finally` + `.catch` backstop; serialization that cannot throw) · D8 (delete the dead middle term in the resume expression) · D9 (read `attempts` from the effective gateway; drop the SDK-only exception from the guide prose) · D10 (drop the module-scope memo) · D11 (order the meta check before the parse) · C1/C3/C4/C5 as resolved.

D7 now also **absorbs QD-1's residue**: the `try/finally` is what keeps a `recordError` failure from stranding the run, and with `getError` gated (§1) the crash window has no served contradiction left.

---

## 3. New this round

### D12 (MED-HIGH, boundary) — ARCH-141 bounds the field that cannot arrive and leaves unbounded the one that always does

Two halves, verified separately.

**(a) The `detail` bound's marker shape is underspecified — MED, and it evaporates under D1 option (2).** ARCH-141 applies `MAX_ERROR_DETAIL_BYTES` **inside** `toErr`; ARCH-142 then composes `redact(toErr(outcome.error), …)` — i.e. **cap first, redact second**. The repo has a named, twice-enforced rule against that order: R-G9 moved the 4KB cap out of `redactHarness` into `capPrompt` applied *after* `redact()` (`agent-executor.ts:662-671`, `02-architecture.md:638`/`:3438`), and INV-V26-5 (`:3174`) states it for every new provider-authored persisted string. I do **not** claim R-G9 bites as written: ARCH-141's truncation is a **wholesale replacement** (`detail` → `{truncated, bytes, note}`), and R-G9's concrete failure — half a credential surviving the seam so `redact()`'s value-exact match finds neither half — requires a *cut*. It bites only if an implementer builds `note` from head/tail bytes the way `capPrompt` does, which is the obvious thing to reach for. **Pin it either way, one clause:** the truncation marker carries **zero original bytes**, *or* the bound moves after `redact()`. Under D1 option (2) there is no forwarded detail and this half disappears with the constant.

**(b) `message` is unbounded, script-controlled, newly written to disk, and served on the ungated route — HIGH within its half.** `toErr` (`run-manager.ts:150-156`) builds `message: String(err.message)` with no cap. Grepped the whole seam for one: `src/sandbox/{guards,host,child-entry}.ts` and `src/ipc/*.ts` contain no message truncation (the only cut there is `host.ts:122`'s `stderrTail.slice(-2000)`, a different value on a different path). **And the one ceiling that looks like it might cover this does not:** `MAX_SCRIPT_BYTES`/`SIZE_EXCEEDED` (`guards.ts:82`, `:287-288`) bounds the **script source** at 512KB before evaluation — it says nothing about the size of an error a script throws at runtime. So `throw new Error('x'.repeat(10_000_000))` in an author's script lands — verbatim, after v35 — in the `runs.error` TEXT column, in one `journal.jsonl` append, and out `/api/runs` and `/api/runs/:id` to an unauthenticated reader. ARCH-141's own justification for bounding `detail` (「an arbitrary object from call sites reachable by script-controlled input … REQ-205 turns it into a **disk** write」) is true word-for-word of `message`, and `message` is the field that actually arrives (D1).

**Fix, one bound at one site, and it collapses C1's tension rather than adding to it:** `toErr` stays **pure, total and unbounded** — a trivially-testable function of its input, which is the whole of ARCH-141's testability argument. A second pure export beside it bounds the **serialized envelope** and is applied at the single persist site **after** `redact()`, exactly as `capPrompt` is:

```ts
entry.resultError = capErrorEnvelope(this._secretValueProvider ? redact(toErr(outcome.error), this._secretValueProvider.entries()) : toErr(outcome.error));
```

Here the cut **is** a substring cut, so R-G9 applies for real and after-redact is mandatory, not stylistic. Two UTs, both able to fail: an oversize message is truncated with a visible marker; **a secret straddling the cut comes back as a marker, not as two halves** — that second one is the assertion that pins the ordering, and it is the only test in this slice that can catch the composition being rebuilt the wrong way round.

### D13 (MED, contract) — ARCH-153's note states a non-fact and will be quoted as an exposure guarantee

ARCH-153's note closes: 「What does **not** cross: per-agent narrative error text stays on the per-agent surfaces」. It does cross, and has since v26: `RunStatusView.agents: AgentRecord[]` (`types.ts:318-321`) carries `AgentRecord.detail` (`:269-276`, provider-authored, redacted, capped 1024B), `toPublicRunView` strips only `principal` (`run-view.ts:11-14`), and `server.ts:604-611` serves the result on the ungated `/api/runs/:id`.

This matters beyond pedantry for one reason: ARCH-153's note is the slice's **stated acceptance of an exposure**, and an accepted exposure is audited against the sentence that accepted it. Left standing, a later reviewer reads it as an invariant the design promised to hold and then finds v26 code breaking it. Correct it to what is true and still supports the same decision: *per-agent error detail already reaches this route (v26, redacted and capped); v35 adds no new text channel at the run level — `failedAgentCount` is a count.* Same conclusion, a premise that survives the next audit.

---

## 4. Remaining disagreement after round 2

**One, and it is narrow.** Per-agent failure-code taxonomy (QD-2's residual): they raise that a caller still cannot tell timeout from schema-retry-exhaustion from provider error at the per-agent record. I agree it is a real gap and hold it **out of v35** — REQ-207's run-level clause is discharged by the count, and closing the taxonomy means a new closed `ErrorCode` set on `failed` records plus a redaction/sweep obligation for each, which is a new advertised surface inside a slice whose thesis is 「deltas at known lines」. Filed for v36 with `types.ts:269-287` attached. If the synthesizer takes it into v35, it takes a new REQ trace edge with it, not a widened ARCH-146.

**Two conditional items for the synthesizer, not disagreements:** QD-3 lands only if a designer wants it beyond REQ-207 (detail pane, never the list row); D12(a) is moot if D1 resolves to option (2), while D12(b) stands under either option.

---

## 5. Revised risk table (delta only — r1's R1–R8 stand)

| R | Risk | Sev | Mitigation |
|---|---|---|---|
| R9 | Ungated `getError` makes `run_result` report a terminal failure for a run `run_status` calls `interrupted` (crash between the column write and the transition, then REQ-060 reclassification) | **HIGH** | §1/QD-1: gate the new step on `view?.status === 'failed'` — one condition, `view` already in scope |
| R10 | Script-authored `message` reaches disk and the ungated route unbounded; the slice's only byte bound guards a field that cannot arrive | **MED-HIGH** | D12(b): `capErrorEnvelope` at the one persist site, **after** `redact()`; secret-straddling-the-cut test |
| R11 | Truncation marker built from head/tail bytes re-opens R-G9's split-secret failure | MED | D12(a): marker carries zero original bytes, or bound after redact |
| R12 | ARCH-153's accepted-exposure note rests on a false premise and will fail its own audit | MED | D13: restate to the v26 fact; decision unchanged |
| R13 | Cold poller reads an omitted `failedAgentCount` as health | MED | QD-5, taken: omission semantics on the `run_status`/`run_list` descriptions — the carrier of D3's fix |
| R14 | `recordError`'s two surfaces drift or are redacted differently — the claim ARCH-143 makes and nothing tests | LOW | §1/QD-1: one-call/two-surfaces same-value UT; state column-authoritative, journal-audit |
