---
stage: architecture
iteration: v36
panel: architecture
lens: adversarial (security / scalability-performance / testability, Karpathy simplicity tie-break)
round: 1 (independent proposal)
scope: REQ-211..REQ-216
---

# Adversarial architecture group — round 1

## 0. Altitude judgment (done first, as instructed)

`tech_stack` (state.yaml:15-40) is a **single-node, self-hosted Node 22 + TypeScript service**:
better-sqlite3 files on local disk (`store/index.db`, `catalog.db`, `webhooks.db`, `schedules.db`,
`auth-tokens.db` — server.ts:658/709/784/792/844-845/1002), a hand-rolled JSON-RPC-over-HTTP MCP
server, and two `GatewayClient` implementations driving LLM agents through a managed LiteLLM proxy.

**This project is BOTH altitudes, and v36 splits cleanly across them:**

| REQ | Altitude | Why |
|---|---|---|
| REQ-211 (per-version deregister) | system | catalog CRUD + transaction scope |
| REQ-212 (audit identity / bypass) | **both** — system authz, agent-altitude provenance | the "caller" is frequently an agent acting over MCP; the audit trail is the only place an agent's action is attributable |
| REQ-213 catalog half (`lastRunAt`, purpose) | system | one read projection |
| REQ-213 log half (register / run-terminal lines) | **agent** | this is *observability at agent altitude*: "which agent run ended how, for whom" is the only signal a remote operator has |
| REQ-214 (control files per instance) | system | deployment/ops |
| REQ-215 (refusal marker through sandbox) | **agent** | per-agent engine-refusal reason reaching the run layer; a plain system would call this "error propagation", an agent system calls it *replaceability + observability* — the author must be able to tell "the engine refused my agent" from "my script threw" |
| REQ-216 K1-K8 | system (K2 security, K5 scalability) | internal hygiene |

**The lens brief is a templated login-system lens; I translate rather than force it:**

- *Brute force* → **N/A this iteration.** No credential-verification surface changes. The live
  surface is the OAuth2/Google verifier (`src/auth/google-verifier.ts`) and the `auth-disabled`
  mode, neither touched by REQ-211..216.
- *JWT forgery* → **translated, and it is real**: the forgeable token in v36 is not a JWT, it is
  (a) the `principal: string | null` **null-token** that means "bypass" in the catalog
  (mcp-facade.ts:193-195, workflow-catalog.ts:789), and (b) a **script-minted error object** that
  is shape-identical to an engine-minted one (errors.ts:257 `toErr` accepts any `{code,message}`;
  child-entry.ts:82 hands script land exactly such an object). REQ-212 and REQ-215 are both
  forgery problems.
- *Timing attacks* → **N/A.** No secret comparison is added; nothing in v36 branches on a secret.
- *Horizontal scaling / distributed consistency of failure counting* → **N/A.** Single process,
  single-writer SQLite, per-instance DB files. Inventing a distributed story here would be
  precisely the speculative architecture the Karpathy tie-break forbids. The scalability lens's
  **honest** contribution to v36 is exactly two things: the K5 list-path cliff and the shape of the
  `lastRunAt` query. I hold it to those.

## 1. summary

Five of the six REQs are corrections to existing behaviour and need **no new subsystem**. One
(REQ-215) widens an IPC contract and is the only place this iteration can create a new security
boundary. My proposal:

1. **REQ-212**: replace the overloaded `principal: string | null` on the catalog's mutating methods
   with a 4-field `Actor` value (`id`, `kind`, `bypass`, `idSource`). The bypass fact is recorded
   *where the write commits*, and `auth-disabled`'s caller-supplied id is logged as **claimed, not
   authenticated** — otherwise the fix manufactures false audit integrity.
2. **REQ-213**: one injectable `EventSink` (a function, not a logger framework), one grouped
   `MAX(createdAt) GROUP BY name` query merged in the facade — **no cross-DB column, no N+1**.
3. **REQ-211**: three refusal cases, not one. The missing one (a non-terminal run pinned to the
   version) is a correctness hole the acceptance text does not name.
4. **REQ-215**: engine-minted-error provenance via a **`WeakMap` that carries the payload** (module
   scope in the child, unreachable from the vm context — a `WeakSet` membership test is not enough,
   because the error object handed to script land is mutable), with the closed allowlist, byte
   bounds and `redact`-before-cap applied **host-side**, where `errors.ts` can actually be imported
   (guards.ts cannot take a value import). A narrower host-ledger fallback is recorded in §2.4.
5. **REQ-214**: derive PID/log path from the already-resolved `RWE_CONFIG_PATH` (deploy.sh:23), plus
   a 3-line `--dry-run` seam so a shell regression is testable at all.
6. **REQ-216**: K2 and K1 first (no new surface); **K5 adjudicated as "no LIMIT on `listRuns`"** —
   the reflex the requirement invites is the wrong fix and would break boot recovery.

**Ordering** (dependency-driven, not preference): K2 → K1 → REQ-212 → REQ-211 → REQ-214 → REQ-213 →
REQ-215. REQ-214 precedes REQ-213 because REQ-213 makes the log stream real for the first time; if
the path is still repo-global, two instances now interleave structured lines into one file and the
new observability is born corrupted.

## 2. key_points

Each point is argued as **three stances → the conflict between them → my resolution → the
simplicity tie-break.**

### 2.1 REQ-212 — audit identity and the bypass token

**Evidence.** `bypassPrincipal()` (mcp-facade.ts:193-195) returns `null` for `admin`,
`auth-disabled` and `loopback-exempt`. `catalog.publish` (workflow-catalog.ts:788-803) uses
`principal !== null` as the *ownership check* and then logs that same `principal` as the *audit
identity*. One string carries three meanings: who you are, whether you are bypassing, and (via
`bypassWithArg`, mcp-facade.ts:236-240) a caller-**supplied** string accepted verbatim in
`auth-disabled` mode.

- **Security stance.** Two defects, not one. (i) The audit trail is anonymous exactly when it
  matters most (an admin acting on someone else's workflow). (ii) `bypassWithArg` reads
  `a.principal` **from tool arguments**. Once REQ-212 starts writing that value into an audit line
  as "the real identity", the engine will be attesting to a string the caller chose. That is audit
  spoofing introduced *by the fix*. The field must be `idSource: 'authenticated' | 'claimed' |
  'none'`.
- **Scalability stance.** Cost is nil (a struct per mutation). One consequence: the log stream now
  carries **user emails**. `.rwe.log` becomes PII-bearing. `redact()` will not remove it (an email
  is not a configured secret value, and must not be — removing it defeats the audit). Therefore
  REQ-214's control-file work must give the log file restrictive permissions, and DEPLOY.md must
  say the log is PII-bearing.
- **Testability stance.** The struct lets the ownership rule become a **pure function**
  `canMutate(owner: string | null, actor: Actor): boolean`, unit-testable with no DB and no facade.
  Today the rule is three inline comparisons inside SQL-bearing methods (publish:789,
  deregister:664, register).

**Conflict.** Security wants catalog mutations in the **durable** audit store (`appendAudit`,
run-store.ts:487 — which already exists for workspace cross-reads, mcp-facade.ts:668/722/800);
the REQ asks only for a log line; scalability mildly prefers not adding a write to a mutation path.
Second conflict: a consistency lens will resist changing a signature used at 4+ call sites.

**Resolution.** Structured stdout line now, through the **same single sink as REQ-213** (§2.2) — not
a second log path. Durable catalog audit is recorded as a deferred risk (R-6), not smuggled in. On
the signature: the bypass fact exists **only at the facade** and must reach the code that commits
the write; an out-of-band audit call from the facade would be a *second writer* that can disagree
with the transaction — the exact twin-divergence class K1 is cleaning up (C-1's unredacted twin).

**Simplicity tie-break.** One value type, one pure predicate, zero new modules, and explicitly **no
role engine inside the catalog** — the catalog still knows nothing about roles; it is told
`bypass: true`, it does not infer it.

### 2.2 REQ-213 — a catalog you can prune, an engine that says what it did

**Evidence.** Runs and workflows live in **different SQLite files** (`store/index.db` vs
`catalog.db`, server.ts:844-845) — **no JOIN is available**. `catalog.list()` already parses and
returns `description` from script meta (workflow-catalog.ts:807+). The only structured log line in
the product today is `catalog.publish`'s bare `console.log` (workflow-catalog.ts:803).

- **Scalability stance.** Three candidate shapes for `lastRunAt`: (a) N+1 (one query per workflow)
  — rejected; (b) a denormalized `last_run_at` column on `workflows`, written at run admission —
  rejected: it puts a **catalog write on the run hot path** and couples two modules that currently
  share nothing but a name; (c) **one grouped query** `SELECT name, MAX(createdAt) FROM runs GROUP
  BY name` against the runs DB, merged in memory by the facade, which already holds both handles.
  Index `runs_name_status_created ON runs(name, status, createdAt DESC)` (sqlite-run-store.ts:91) leads with `name`, so (c) is an
  index-ordered scan, O(workflows) rows out, one round trip.
- **Security stance.** The log must go through the existing `redact()` path and be pinned by a test
  (the REQ says so, correctly). Note the ordering rule the codebase already learned the hard way:
  **redact before any truncation** (errors.ts:282-297, agent-executor.ts:22-26, INV-V26-5).
- **Testability stance.** A sink of type `(event: Record<string, unknown>) => void` injected at
  composition is trivially assertable (`const lines: unknown[] = []`). `console.log` is not, and
  spying on it globally is the kind of test that fails under parallel vitest workers.

**Conflict — checked, and it does not exist.** The obvious objection to (c) is "GC deletes runs, so
a derived value regresses to `null` while a stored column survives". Verified on disk: **run rows
are never deleted.** There is no `DELETE FROM runs` anywhere; the TTL sweep (server.ts:1034-1040)
reclaims *workspaces*, `workspace_purge` deletes workspace bytes, and `gcExpired` (server.ts:1029)
collects auth tokens. So (c) is not merely cheaper — it is **exactly as durable as (b)** and (b)
buys nothing at all for its cross-module write.

**Resolution.** Take (c), and state the semantics in the tool contract anyway (`lastRunAt` = "the
most recent run on record"; `null` = never run) so the field stays honest if a retention policy is
ever added. Note the corollary, which belongs to K5 rather than here: the same "runs are never
deleted" fact is what makes `listSummaries()`'s full scan a genuine cliff (§2.6).

**Wiring check demanded of Gate 3/4** (this repo's documented bug class, MEMORY:
`composeconfig-wiring-bug-class`): `catalog.list()` produces `description`, but the `workflow_list`
facade projection must be verified to forward it. If it is dropped, the "purpose summary" half of
REQ-213 is a **one-line wiring fix, not a feature** — and the design must say so rather than
re-implement a parser.

**Simplicity tie-break.** One function type as the sink. **No levels, no transports, no correlation
ids, no logger library.** `catalog.publish`'s existing `console.log` moves onto the same sink so the
product ends with one log path, not two.

### 2.3 REQ-211 — deleting one version without deleting the tenant

**Evidence.** `workflow_versions` PK `(name, version)` (workflow-catalog.ts:228-231);
`workflow_diagrams` PK `(name, version)` (269-276); `assets` PK `(workflow, kind, name)` —
**name-scoped, shared across versions** (295-298). `deregister()` (664-684) deletes all four by
name in one transaction. ADR-014 records "deregister still removes everything".

- **Security stance.** The new path must be ownership-gated **identically** (`canMutate` from
  §2.1 — one predicate, not a second copy). A per-version delete is also a *destructive* operation
  on a version other principals may be running, so it belongs in the audit line from day one.
- **Correctness/adversarial stance — the hole the acceptance text misses.** The REQ names **one**
  refusal case (a channel points at the version). There are **three**:
  1. a channel (`beta`/`release`) points at it — stated;
  2. it is the **last remaining version** — deleting it leaves an orphan `workflows` row with no
     runnable version, a state no other code path can produce. Refuse, and point at whole-name
     `workflow_deregister({name})`; do not let two paths silently alias;
  3. **a non-terminal run is pinned to it.** Read, not inferred: run-manager.ts:1049-1060 resolves
     a resumed run through `view.scriptVersion` — the **pin**, per ADR-010 — and **catches**
     `VERSION_NOT_FOUND`, re-resolving through `release` and recording
     `recordLegacySubstitution`. That fallback exists for the *legacy cohort* (a
     deregister/re-register that restarted the lineage). A per-version delete would route an
     ordinary, healthy run down it: the run does not fail, it **resumes on a different version**,
     announced by exactly one `run.legacySubstitution` log line and nothing the caller ever sees.
     That is the worst available outcome and it is not in the acceptance criteria.
- **Scalability stance.** Nothing. Two DELETEs in a transaction.
- **Testability stance.** Refusal case 3 needs a run in a non-terminal state pinned to the target
  version — a store-level fixture, not a mock. Cheap, and it is the case most likely to rot.

**Second trap.** workflow-catalog.ts:~409 documents a guard against
`enqueue → deregister commits → putDiagramResult lands` creating an **immortal diagram row**. That
guard is **name-keyed**. A version-scoped delete needs the guard version-keyed too, or REQ-211
re-creates the exact bug the guard was written to prevent.

**Resolution.** `deregisterVersion(name, version, actor)` — a sibling method, one transaction over
`workflow_versions` + `workflow_diagrams` at `(name, version)`, **never** touching `assets` or the
`workflows` row; three refusals; the existing whole-name path and its error codes untouched. The
`VERSION_CEILING_EXCEEDED` hint (570/614) is rewritten to carry the **exact call shape**
`workflow_deregister({name, version})` — telling a caller to do a thing the tool cannot do is the
whole reason this REQ exists.

**Architecture-doc obligation.** This **amends ADR-014**. 02-architecture.md must record the
amendment; a silently diverging ADR is how a ledger stops being worth reading.

**Simplicity tie-break.** A sibling method, not a mode flag on `deregister()`. One extra optional
argument that silently changes the blast radius from "one version" to "everything" is a footgun,
and it makes the audit line ambiguous.

### 2.4 REQ-215 — the structured refusal marker (the only new boundary in v36)

**Evidence chain, verified on disk.** The marker is minted **on the host/parent side**:
`agent-executor.ts:547` throws `codedError('PARAM_UNKNOWN', detail, { param:'agentType', agent:…,
violation:'AGENT_OPT_RETIRED' })`. It is flattened to `{code,message}` at host.ts:147, arrives in
the child as `{t:'agentThrow', error:{code,message}}` (child-entry.ts:36), is rejected into script
land at **child-entry.ts:82** as `Object.assign(new Error(msg.error.message), {name: code, code})`,
and is flattened a third time at guards.ts:322-335 — where a non-allowlisted code is additionally
crushed to `SCRIPT_ERROR` (`ENGINE_REFUSAL_CODES = new Set(['BUDGET_EXCEEDED'])`, guards.ts:175).

- **Security stance — the core finding.** The object the script receives is an **ordinary `Error`
  with `code` assigned**. `errors.ts:257 toErr` accepts *any* `{code,message}`-shaped value. So a
  script can already mint a perfect counterfeit today; it simply gains nothing by it, because
  everything is flattened. The moment `detail` is forwarded, the counterfeit becomes **a
  script-controlled object written to disk wearing engine authorship**. `instanceof` cannot fix
  this: the constructor is reachable from script land, and the vm boundary makes cross-realm
  `instanceof` unreliable anyway. The REQ's own clause (c) is therefore correct to demand a
  security assessment, and the assessment's answer is: **provenance must not be inferable from the
  object's shape.**
- **Scalability stance.** One optional bounded field on an existing message. Irrelevant.
- **Testability stance.** The REQ forbids mocking IPC — correctly, because a mocked seam is exactly
  the seam an attacker would use, and v35 already refused to ship "dead code plus a test that can
  never fail". But a real-child test is slow and is the classic CI-flake source, so it must be
  **one** test, not a matrix.

**Proposed design (primary).**
1. **Provenance must carry the payload, not merely vouch for the object — a `WeakMap`, not a
   `WeakSet`.** The error handed to script land at child-entry.ts:82 is an ordinary, **mutable**
   object: a script can `catch (e) { e.detail = {violation:'…'}; throw e }` and a set-membership
   test still says "engine-minted". So: a module-scope `WeakMap<Error, {code, detail}>` in
   `child-entry.ts`, populated at the reject site (82), and guards.ts forwards **the map's value**,
   never `err.code`/`err.detail` read off the object. Module scope is unreachable from the vm
   context (guards.ts builds the context explicitly at 290-309 and exposes nothing else), so the
   strongest thing a script can do is re-throw an error the engine really minted **for that call** —
   which is exactly the fallback design's security property, obtained without a host ledger.
2. **Validation happens on the HOST side, not in guards.ts.** Hard constraint, verified:
   `src/sandbox/guards.ts` imports only `node:vm` and a **type** from `../types.js` (guards.ts:4-5)
   — the child process does not resolve `.js → .ts` value imports, which is why
   `ENGINE_REFUSAL_CODES` is *inlined* at guards.ts:175 instead of imported. Putting the allowlist
   in `errors.ts` and importing it from guards.ts would not run. Therefore: the child does only
   WeakMap-gated forwarding of a raw `{code, detail}`; `host.ts`'s `case 'done'` receipt (~166)
   applies the closed `code → permitted detail keys` allowlist, the per-value byte bound (the
   `MAX_SECRET_NAME_CHARS` style, errors.ts:280) and **`redact` then cap** (K2's ordering, never the
   reverse) — all as pure functions in `errors.ts`, which the host can import freely. This is also
   the better security posture: **the untrusted side never validates itself.**
3. **Adjudication of clause (b) — which refusal codes may cross.** Exactly the codes the engine
   mints on the agent path, i.e. `ENGINE_REFUSAL_CODES` grows from `{BUDGET_EXCEEDED}` to
   `{BUDGET_EXCEEDED, PARAM_UNKNOWN(+violation)}` — **one** addition, in the **one** place that list
   already lives (guards.ts:175). No wildcard, no "all engine codes", no per-call opt-in.
4. **Tests**: allowlist + bound + redact-order as unit tests on pure functions; **exactly one**
   real-child integration test proving the marker reaches the run-level envelope through a live
   sandbox round trip.

**Fallback design (weakened by the WeakMap above, kept for the record).** Record the refusal **host-side at the
mint site**, keyed by `callSeq`, and let the wire carry only an **integer `refusalRef`**; the run
layer joins the marker in from the host's own ledger. No script-adjacent string ever travels upward,
so clause (c)'s "new script-controlled-object-to-disk channel" does not exist at all. Cost: a
per-run ledger in the host, a correlation rule, and the REQ's test clause becomes "the run envelope
carries it after a real child round trip" rather than "the marker crossed". Once provenance is a
**WeakMap** and validation runs host-side, the fallback's only remaining advantage is that no
engine-authored string rides the wire at all — a marginal gain for a per-run ledger plus a
correlation rule. **I propose the primary design** and record the fallback as the answer if the
panel rules that *nothing* may cross upward.

**Cross-iteration note the REQ itself raises**: this shares a boundary with v37's Bash jail — "what
can a script push out of the sandbox". The allowlist in step 2 is the artifact both iterations
should share; it must therefore live in `errors.ts`, not in `guards.ts`.

**Simplicity tie-break.** One WeakMap, one allowlist table, one new wire field, one integration
test. No generic "structured failure envelope" subsystem — see §4.1.

### 2.5 REQ-214 — control files follow the instance

**Evidence.** deploy.sh:23 already resolves `RWE_CONFIG_PATH` **before** use (with a comment
explaining why that ordering was necessary); but 63/65 hardcode `.rwe.log` / `.rwe.pid` in the repo
root, and 97/99 tell the operator to `kill $(cat .rwe.pid)`.

- **Security stance.** Two: (i) a PID file in a shared repo root plus **PID recycling** means
  `kill $(cat .rwe.pid)` can kill an unrelated process — the exact failure the REQ describes,
  upgraded from "kills the wrong engine" to "kills whatever now owns that PID"; (ii) after REQ-212
  the log file is PID-bearing *and* PII-bearing, so it wants restrictive permissions (0600).
- **Scalability stance.** N/A.
- **Testability stance — the real problem.** A shell script has no seam. Gate 7.5's real run *can*
  catch this, but only by actually starting two engines, which is exactly why v34 fixed the
  DEPLOY.md workaround and left the script broken.

**Resolution.** Derive both paths from the resolved config path (sibling files, or a short hash
suffix — Gate 4's choice), and add a **`--dry-run`/`RWE_START_CMD` override (~3 lines)** so a test
can run deploy.sh against two config paths and assert two distinct pid/log paths **without booting
the engine**. Simplicity says "Gate 7.5 covers it"; I disagree here and accept the 3 lines, because
the defect being fixed is precisely one that stayed invisible for a whole iteration. PID-recycling
hardening is **out of scope** — recorded as R-8, not smuggled in.

### 2.6 REQ-216 — K1-K8

- **K2 (security, first).** `run-manager.ts:695` writes `failDetail: rawMessage.slice(0, 200)` with
  no `redact()` — the unredacted twin of the message C-1 just fixed. Fix = redact, **then** slice.
  Do it before K1 touches anything, so the fix is not entangled with a refactor.
- **K1 — with a warning.** `captureFailure = capErrorEnvelope ∘ redact ∘ toErr` is right, but the
  two sites do **not** share a bound: the envelope bound is 4096 bytes (errors.ts:270), the seedRef
  view's is **200 chars** (run-manager.ts:695). A careless unification silently widens `failDetail`
  by 20x or narrows the envelope by 20x. `captureFailure` must take the bound as a parameter (or
  leave the 200-slice as a separate, explicitly after-redact step). **K1 done carelessly regresses
  K2** — that is the one real coupling in this REQ.
- **K5 — my adjudication: NO LIMIT on `listRuns()`, but a carve-out its framing hides.** There are
  **four** callers, not three. Three are sweeps that legitimately need every row: boot
  (server.ts:815), `hydrateAll` (sqlite-run-store.ts:444, which reclassifies stale `running` rows),
  and the workspace-reclaim sweep (server.ts:1037). A LIMIT there would silently stop recovering
  and stop reclaiming beyond the limit — a **data-loss bug sold as a scalability fix**.
  The fourth is the one K5's own wording does not mention and the one that actually matters:
  **`RunManager.listSummaries()` (run-manager.ts:862) calls `listRuns()` and is the single accessor
  behind `/api/runs` and `/api/home` (server.ts:357, 388)** — a **per-request full scan of every run
  ever recorded**, and nothing in this codebase ever deletes a run row (no `DELETE FROM runs`;
  `workspace_purge` and the TTL GC reclaim *workspaces*, i.e. filesystem, and
  `authTokenStore.gcExpired()` at server.ts:1029 collects auth tokens). The runs table grows
  monotonically for the life of a deployment, and the dashboard scans all of it on every load.
  **Proposal:** (1) document `listRuns` in the port as a deliberately unbounded sweep API;
  (2) move `listSummaries()` onto the paginated `list()` (limit 50 / cap 500,
  sqlite-run-store.ts:393) — this is the carve-out, and it is the only place a bound belongs;
  (3) replace boot's `ownerlessRuns` with a COUNT query instead of `Promise.all(getRun)` over every
  run (server.ts:815-817), and give recovery a non-terminal-only read;
  (4) **add no pagination anywhere else until something is measured.**
  Note the precedent for (2)'s shape already exists in the same method: `BACKFILL_PER_TICK`
  (run-manager.ts:273) already bounds the healing work per call — the row scan simply never got the
  same treatment. This is the scalability lens's deliverable for v36, and three quarters of it is
  the *opposite* of the reflex the requirement invites.
- **K3/K4.** Endorsed as written; no architectural impact. K3's byte-exact worst case (~4.8KB from
  256 multi-byte codepoints) is the right shape — an offset scan cannot catch a bound expressed in
  bytes over a string measured in codepoints.
- **K6/K7.** One `attempts` formula on the `GatewayClient` port, both implementations conformant,
  plus the guide's missing sentence ("a call with no timeout runs once"). Port-level, not
  per-implementation — two implementations with private retry semantics is a divergence waiting to
  become a C-1.
- **K8.** Strongly endorsed. `compose-config-v2-wiring.test.ts` is this repo's **systematic guard**
  for its own documented bug class (a new config block never forwarded in `composeConfig()`; v11
  and v15 each lost a feature to it silently). Three lines to extend the scanner to `attempts` is
  the highest value-per-line item in v36.

## 3. risks

| # | Risk | Lens | Severity | Mitigation |
|---|---|---|---|---|
| R-1 | REQ-211 deletes a version a **non-terminal run is pinned to** → resume's `VERSION_NOT_FOUND` **catch** (run-manager.ts:1053-1060) routes a normal run into the legacy-cohort fallback: it re-resolves through `release` and continues on **different code**, visible only as one `run.legacySubstitution` log line, never to the caller | security/correctness | **HIGH** | third refusal case; fixture test with a suspended run |
| R-2 | REQ-215 forwards `detail` from a **script-forged — or script-mutated** `{code,message,detail}` (errors.ts:257 + child-entry.ts:82; the error object is mutable, so a membership test alone is not enough) → script-controlled bytes on disk with engine authorship | security | **HIGH** | `WeakMap` payload (not `WeakSet` membership) + **host-side** allowlist/bound/redact-then-cap |
| R-3 | REQ-212 writes `bypassWithArg`'s **caller-supplied** id as "real identity" in `auth-disabled` mode → the fix manufactures false audit integrity | security | **HIGH** | `idSource: authenticated \| claimed \| none` in the audit record |
| R-4 | K1 unifies two **different bounds** (4096 bytes vs 200 chars) and regresses K2 | security | MED | bound as a parameter; K2 lands first, separately |
| R-5 | K5 "fixed" by adding a LIMIT to `listRuns()` → boot recovery and GC silently stop seeing older runs | scalability/correctness | MED | adjudicate NO; fix the boot fan-out instead |
| R-6 | Catalog mutation audit lives only in **stdout**; log loss = audit loss, and nothing enforces retention | security | MED | accepted for v36, recorded as deferred: durable `appendAudit` for catalog mutations |
| R-7 | REQ-213's log stream now carries **emails** (PII) into `.rwe.log`, which `redact()` will not and must not remove | security/privacy | MED | 0600 on the log file (with REQ-214); DEPLOY.md states the log is PII-bearing |
| R-8 | PID recycling: `kill $(cat <pidfile>)` can kill an unrelated process even after REQ-214 | security | LOW | out of scope; recorded |
| R-9 | REQ-211 re-creates the **immortal diagram row** (workflow-catalog.ts:~409) because that guard is name-keyed, not version-keyed | correctness | MED | version-key the guard in the same change |
| R-10 | The one real-child integration test for REQ-215 becomes a CI flake source | testability | LOW | exactly one test, generous timeout, no matrix |
| R-11 | The `runs` table grows **without bound** (nothing deletes a run row) while `/api/runs` and `/api/home` full-scan it per request | scalability | MED | K5 carve-out (§2.6): `listSummaries()` → `list()`; retention policy is a v37 question, not a v36 one |

## 4. expected disagreements with other lenses

**4.1 vs. an observability / product lens on REQ-215.** They will want the generic thing: a
structured failure envelope with a free-form `detail` bag, log levels, and correlation ids "while we
are in there". I will hold the narrow line: **one** new refusal code, a closed allowlist, one sink
function, no levels. The v35 ledger already contains the counter-example this repo paid for — dead
code plus a test that can never fail — and a free-form `detail` bag is exactly the shape that makes
the security assessment in clause (c) unanswerable. Expect this to be the sharpest fight.

**4.2 vs. a consistency / minimal-diff lens on REQ-212.** They will resist changing
`principal: string | null` to a struct across 4+ call sites, and propose an out-of-band audit call
from the facade instead. My counter: the bypass fact is **only** knowable at the facade and must be
recorded **where the write commits**; a second writer that can disagree with the transaction is the
C-1 twin-divergence pattern K1 exists to delete. I would rather change one signature than create a
second source of truth about who did what.

**4.3 vs. a durability lens on REQ-213's `lastRunAt`.** They will want the denormalized column on
the grounds that a derived value regresses when runs are collected. I checked before arguing: **run
rows are never deleted in this codebase**, so the objection is empty and the derived query dominates
outright. If someone wants the column anyway, they are buying a catalog write on the run-admission
path, across two separate SQLite files, for a field whose consumer is a human deciding which probe
to delete. Karpathy tie-break: a grouped query is free; a cross-module write is forever.

**4.4 vs. the scalability lens (i.e. internally, against my own brief) on K5.** The brief says
"state storage, horizontal scaling, concurrency & consistency of failure counting". Applied
literally here it produces the wrong answer twice: a LIMIT that breaks recovery, and a
distributed-consistency story for a single-writer SQLite process. **I am deliberately under-serving
my own scalability lens** and saying so out loud: for a self-hosted single-node tool the honest
scalability work in v36 is a COUNT query and a documented sweep API.

**4.5 vs. a testability-maximalist lens on REQ-215.** They will want an injectable IPC seam so the
test is fast and hermetic. That seam is the forgery seam; it is what makes the real-child test the
only test that proves anything. I accept one slow test over a fast test of a mock. Conversely, on
**REQ-214** I take the testability side against simplicity: 3 lines of `--dry-run` seam for a shell
script, because "Gate 7.5 will catch it" demonstrably did not catch it in v34.

**4.6 vs. a scope-discipline lens on REQ-211.** They will say the three refusal cases exceed the
acceptance criteria and belong in v37. I disagree on exactly one of them: refusal case 3 (pinned
non-terminal run) is not an enhancement, it is the difference between a delete and **silent code
substitution under a running workload**. Cases 1 and 2 I would defend; case 3 I would escalate.

**4.7 Internal conflict I cannot resolve alone (for round 2).** REQ-215's primary vs. fallback
design (§2.4) is a genuine security/simplicity trade with no dominant answer: the primary is the
smaller diff and matches the REQ's literal test clause; the fallback makes clause (c)'s security
assessment trivially "no new channel" at the cost of a host-side ledger. I have stated a preference;
I want the panel to decide it explicitly rather than let the smaller diff win by default.
