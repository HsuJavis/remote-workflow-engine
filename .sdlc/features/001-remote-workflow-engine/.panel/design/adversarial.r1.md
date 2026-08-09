# Design panel — Adversarial group (r1, independent proposal)

**Slice:** v11 Sprint 2 — tag-triggered, privilege-separated, fully-automatic self-update
**Scope:** REQ-068..070 → ARCH-038 (unprivileged verifier + flag-writer), ARCH-039 (privileged updater helper + systemd units), ARCH-040 (observable version + last-update outcome).
**Lenses carried (they trade off — conflicts surfaced explicitly):** (a) Interface-contract, (b) Boundary/error, (c) Testability. **Tie-breaker:** Karpathy simplicity-first.

## Altitude judgement
tech_stack = Node 22 / TypeScript system; the *product* is both a plain system and an AI-agent system. **This slice is system-altitude infra** (webhook ingress, HMAC, git/systemd, self-update) — it contains no `agent()` semantics. The **only** agent-altitude touchpoint is *confinement*: the engine hosts untrusted agent code, so the update-flag file (which the privileged helper trusts) must be unreachable from any run workspace. I therefore apply the **system altitude** throughout, with a single agent-altitude confinement invariant (flag path outside every `workRoot`, mirroring the ARCH-019 workroot-guard pattern).

---

## Summary

The architecture is sound and the three units are already the right injectable seams; my job at design altitude is to pin the **contracts, the failure taxonomy, and the test seams** so the synthesizer's DES/tasks can't leave a boundary implicit. The self-update path is RCE-by-design, so an *unpinned* boundary is a defect, not a nicety. Five contracts are genuinely under-specified by the ARCH text and must be nailed in design: (1) the **secret-missing fail-closed** behaviour of the webhook route; (2) the **event-shape divergence** of GitHub `create` vs `push` (plus `ping`/tag-delete no-ops); (3) the **flag-file lifecycle contract** (atomic write **and** consume-on-read, because the systemd trigger drops overlapping arms — a race the flock alone does not close); (4) the **result-file schema + write-ordering**, owned in exactly one place so the bash-writer and TS-reader can't drift; (5) the **route-dispatch collision** with the existing `/hooks/:id` registry. The central internal conflict my three lenses expose: **testability wants the updater logic in typed TS; the privilege-separation seam forces it into an out-of-process bash helper.** I resolve for bash-but-seamed (privsep is non-negotiable), tested via a child-process integration harness against a throwaway git repo — never via the systemd unit files, which must stay logic-free.

---

## Key points (design contracts, per lens)

### ARCH-038 — unprivileged verifier + flag-writer

**(a) Interface-contract.** Split the ARCH's one unit into three DES-level seams so the pure part is a clean UT and the stateful/FS parts are injected:

- **DES — pure verifier** (no I/O, injectable clock):
  `verifyTagWebhook(input, deps) → TagVerdict`
  - `input: { event: string /* X-GitHub-Event */, signatureHeader?: string /* X-Hub-Signature-256 */, deliveryId?: string, rawBody: Buffer }`
  - `deps: { secret: string | undefined, tagPattern: RegExp }`
  - `type TagVerdict = { arm: true; tag: string; deliveryId?: string } | { arm: false; httpStatus: 200 | 401 | 503; code?: string; reason: string }`
  - HMAC is computed **over the raw `Buffer`** with `createHmac('sha256', secret).update(rawBody)`, compared to the hex after stripping the `sha256=` prefix in **constant time** (reuse the `timingSafeEqual` helper already proven in `src/webhook-registry.ts:143`). **Never** `rawBody.toString('utf8')` before HMAC, and the route **must** read via `readBodyBuffer` (server.ts:529) — **not** `readBodyDecoded` (server.ts:558): GitHub signs the wire bytes, so the REQ-063 `Content-Encoding` decode path would silently break verification. A raw-`Buffer` assertion is a required regression test.
- **DES — flag writer seam** (injectable): `writeUpdateFlag(tag: string): void` — atomic `temp + rename`, mode `0600`, at a path resolved **outside every workRoot** (see boundary invariant below). The verifier core calls a supplied `FlagSink` so the unit test asserts *sink-called-with-T* vs *sink-not-called* without touching the FS.
- **DES — delivery dedup seam**: reuse the `webhook_deliveries`-style table (`INSERT OR IGNORE` on `deliveryId`, engine-owned SQLite side table, `:memory:` in tests). A replayed valid delivery must **not** re-arm.
- **Route:** a **distinct fixed path** (recommend `POST /github/webhook` — see the collision hazard in risks; do **not** nest under `/hooks/`). Provisioned shared secret `RWE_SECRET_GITHUB_WEBHOOK_SECRET` via `loadSecretSourceFromEnv()` (server-side only; never workspace/sandbox-reachable; never logged; never on the dashboard — extends REQ-018/D-R2). This is the *sender-provided* model, **not** the registry's generate-and-return.

**(b) Boundary/error — the failure taxonomy the ARCH leaves implicit:**

| Condition | Result | Note |
|---|---|---|
| secret unconfigured (`RWE_SECRET_GITHUB_WEBHOOK_SECRET` absent) | **503 `UPDATE_WEBHOOK_UNCONFIGURED`**, no flag | **Fail-closed. Must NEVER 200, never treat unsigned as valid, never write a flag.** The single most important boundary; ARCH text does not pin it. |
| signature absent / malformed / mismatch | 401, no flag | constant-time compare; malformed header (not `sha256=<64 hex>`) is 401, not 500 |
| `event: 'ping'` | 200 no-op | GitHub pings on webhook creation — must not error |
| `create` with `ref_type:'branch'` | 200 no-op | branch create is not a tag |
| `create` with `ref_type:'tag'`, `ref` = tag name | arm if `ref` matches pattern | extractor path A |
| `push` with `ref: 'refs/tags/<t>'`, `deleted:false` | arm if `<t>` matches pattern | extractor path B — strip `refs/tags/` |
| `push` with `deleted:true` (tag deletion) | 200 no-op | same `refs/tags/` ref as a create — must reject by construction, not rely on downstream |
| `push` with `refs/heads/...` | 200 no-op | branch push |
| tag present but fails `tagPattern` (`^v[0-9][0-9A-Za-z.\-+]*$`) | 200 no-op | anchored; rejects `v1.0.0; rm -rf /` etc. by class |
| replayed `X-GitHub-Delivery` | 200, no second flag | dedup |
| `deliveryId` absent | process anyway (no dedup) | fail-open on dedup is acceptable **because** the helper's idempotent-apply (already-on-T → skip) covers a double-arm; state the reasoning |

The `create`-vs-`push` **ref-shape divergence** and the `ping`/tag-delete no-ops are a real boundary-completeness gap in the ARCH note ("a `create`/`push` whose ref matches a pattern" hides two different payload shapes). Pin a single `extractTag(event, body) → string | null` helper, unit-tested per row.

**(c) Testability.** Everything on this unit is a pure/in-memory UT: inject `{secret, tagPattern}`, a fake clock, an in-memory dedup, a `FlagSink` spy. Real-tier: one signed-payload fixture (a captured GitHub `create` body + its valid `X-Hub-Signature-256`) proving the constant-time path accepts a genuine delivery and the raw-`Buffer` HMAC matches.

**Agent-altitude confinement invariant (boot fail-fast, reuses the ARCH-019 pattern):** at boot, resolve the update-flag path and assert it is `realpath`-outside **every** configured `workRoot` and (recommended) owned `0700` by the engine user; else refuse to start with a typed `UPDATE_FLAG_INSIDE_WORKROOT`. Rationale: an untrusted agent that can write the flag gets host RCE through the privileged helper. This is the same fail-closed shape as `WorkRootInsideProjectError` and is a one-function pure UT.

### ARCH-039 — privileged updater (systemd path+oneshot + dumb helper)

**(a) Interface-contract — a bash script's "signature" is argv/env/exit-codes/files. Pin all four:**

- **Inputs (env, injectable seams):** `RWE_UPDATE_FLAG` (flag path), `RWE_UPDATE_LOCK` (flock path), `RWE_UPDATE_RESULT` (result path), `RWE_OFFICIAL_REMOTE` (pinned remote name/URL), and a **command-prefix seam** — `GIT`, `NPM`, `SYSTEMCTL` env vars defaulting to the real binaries so integration tests substitute fakes. No decision logic in the `.path`/`.service` units.
- **Exit codes (distinct, for the result `detail`):** `0` applied · `10` flag/tag validate-fail · `20` remote-resolve-fail (tag not on official remote) · `30` build/checkout-fail (safe-abort before restart) · `40` already-on-T skip.
- **Flag content contract:** the flag file holds **exactly the validated tag, one line, newline-terminated** — nothing else, nothing shell-interpolatable. The privileged (dumb) side does the *least* parsing; T is re-validated helper-side against the same anchored pattern (defence-in-depth) and only ever passed as an `execFile`/array-arg, **never** `sh -c "... $T"`.
- **Result file contract:** the helper writes `{ tag, status: 'applied'|'failed'|'skipped', ts, detail }` as JSON, **atomically (temp+rename)** — symmetric with the flag write — so the engine never reads a half-written record.

**Helper sequence (all on untrusted T):** (1) consume the flag (read **then rename/delete it** — see the lifecycle contract in risks); (2) re-validate T against the pattern; (3) `flock` the lock; (4) `git fetch --tags` from the **pinned official remote**, confirm T resolves to an existing tag there, reject any other/rewritten ref; (5) if already on T's SHA → write `skipped`, exit 40; (6) `git checkout <resolved-SHA>` via array-args; (7) `npm ci && npm run build`; (8) on any failure in 4–7 → **abort before `systemctl restart`**, write `failed`, exit — *prior good checkout keeps running*; (9) write `applied` **then** `systemctl restart rwe`.

**(b) Boundary/error.** The **safe-fail branch is the single most important test** (its failure mode is "service left down"): inject a failing `NPM` → assert `SYSTEMCTL` **not** called, working tree still at the prior checkout, result = `failed`. Other boundaries: non-existent/foreign ref → exit 20, nothing changed; `git fetch` network failure → `failed`, service up; the restart on the applied path kills the engine mid-run — acceptable **because** ARCH-034 crash-durability replays in-flight runs from the journal (no new drain machinery), but the design must state the **write-ordering invariant**: `applied` result is flushed to disk **before** `systemctl restart`, so the restarted engine reads it at boot.

**(c) Testability — and the central internal conflict.** Testability wants this logic in typed TS (vitest-UT-able); the **privilege-separation seam forces it out-of-process into bash** (the privileged component must not live in the engine's Node process — that is the whole threat-model point). **I resolve for bash-but-seamed** (privsep non-negotiable): every meaningful step is in the *script*, exercised by a **child-process integration harness** (`execFile` the helper against a `mkdtemp` throwaway git repo, with `GIT/NPM/SYSTEMCTL` pointed at fake shims that record their argv). The `.path`/`.service` unit files carry **zero** logic (declarative units are untestable in CI) and are covered only by the Gate 7.5 real-run smoke check + documented in DEPLOY.

### ARCH-040 — observable version + last-update outcome

**(a) Interface-contract.**
- Reuse `resolveEngineVersion(exec?)` (issue-reporter.ts:19, injectable `exec`) — after a tag checkout, `git describe --tags` yields T.
- `GET /api/version → { version }`; `GET /api/status` gains `{ version, lastUpdate?: UpdateOutcome }`.
- `type UpdateOutcome = { tag: string; status: 'applied'|'failed'|'skipped'; ts: string; detail?: string }` — **this type is the shared cross-process contract with ARCH-039's helper; it must be owned in exactly ONE place** (a single `update-types.ts` the engine imports and the DEPLOY/helper doc references verbatim). If the tasks split "helper-writer" and "engine-reader" without this single home, the JSON schema drifts. (Task-splitting note — see below.)
- **Single durable row** for the last outcome (engine-owned SQLite side table, the schedules/webhooks/continuations convention). Name its home now — recommend the existing engine DB with a `update_outcome(id INTEGER PRIMARY KEY CHECK(id=1), json TEXT)` single-row table — so the split doesn't improvise two stores.

**(b) Boundary/error.** `readUpdateResult(path) → UpdateOutcome | null` is a **tolerant** parse: absent file → `null` (no update ever ran); malformed/half-written → `null` (never 500). Read points: **at boot** (covers the applied case — the restart makes the engine ingest the flushed result) **and lazily on `/api/status`/dashboard** (covers the failed case — the engine was never restarted, so it picks up `failed` on demand). No watcher daemon, no push channel (Karpathy).

**(c) Testability.** `readUpdateResult` pure UT (absent/valid/malformed). `/api/version` + `/api/status` field via the existing HTTP integration seam. Dashboard update-panel via the established Playwright-headless real-run pattern (as prior dashboard slices). This slice **is** system-altitude self-sustainability (a service updating/healing itself, never leaving itself down); the observability is deliberately scoped to *applied version + last outcome*, not a `/health`/trace-ID/metrics surface (out of scope, per the ARCH rationale — agreed).

---

## Risks

1. **Route-dispatch collision (interface-contract, HIGH).** The existing dispatcher matches `/^\/hooks\/([^/?]+)/` (server.ts:1036) and routes to `WebhookRegistry.deliver`. A path like `/hooks/github` would be captured there and 404 (unknown id) **before** the GitHub verifier ever runs. Use a **distinct prefix** (`/github/webhook`) rather than pin a fragile dispatch order.
2. **Host/Origin allowlist blocks the real forwarded webhook (boundary, HIGH).** REQ-056 rejects a foreign `Host` with 403 *before* HMAC runs. A forwarded GitHub delivery carries a public Host, so this **one route must be Host-exempted** (HMAC is its auth; Origin stays fail-open-on-absent). Without this the feature literally cannot receive a real delivery. The design must state the exemption explicitly (and DEPLOY documents the reverse-proxy that forwards only this path while the engine stays loopback-bound).
3. **Flag lifecycle / overlapping-arm race (boundary, MEDIUM-HIGH).** A `flock` alone does **not** close it: a systemd path-unit trigger that fires while the oneshot is already active is **dropped**, so a second tag arriving mid-build is lost at the *systemd* level regardless of flock mode. The pattern that closes both levels: **consume-the-flag** — the helper renames/deletes the flag immediately after reading, and the unit uses **`PathExists=`** so that if a new flag lands during the build, the unit re-fires when the oneshot deactivates (the file exists again). Design must **verify this against systemd path-unit semantics** (atomic-rename-into-place needs `PathExists=`/`PathChanged=`, **not** `PathModified=`, which watches writes-and-close that an atomic rename does not produce on the target). Policy = documented latest-tag-wins.
4. **Secret-missing fail-open (boundary, HIGH — already folded into ARCH-038 above).** If `verifyTagWebhook` treated an absent secret as "no signature required," any POST would arm an update = unauthenticated RCE. Pinned to **503 `UPDATE_WEBHOOK_UNCONFIGURED`**, no flag, plus its UT.
5. **Result/flag path misconfiguration → agent-writable = host RCE (boundary, HIGH).** Covered by the boot fail-fast `UPDATE_FLAG_INSIDE_WORKROOT` invariant; call it out as a deploy-doc requirement too (paths under `/var/lib/...`, engine-user-owned, `0700`).
6. **Residual (accepted per ARCH rationale, restated so design doesn't silently re-litigate):** a malicious tag whose build *succeeds* is not caught by safe-fail (which protects availability, not integrity) — bounded by privsep + official-remote-pin; the only real defence is repo/secret integrity + the deferred GPG signed-tag verify + `npm ci --ignore-scripts`. Single-instance ceiling (self-update is host-local, incompatible with multi-replica) documented, not fixed.

## Task-splitting notes (where the split affects my lens)

- **Keep the pure verifier (`verifyTagWebhook`/`extractTag`) a separate DES/task from the stateful dedup + FS flag-write.** The pure part is the clean UT surface; mixing FS/SQLite into it forfeits the cheap enumerable test matrix.
- **The `UpdateOutcome`/result-file schema must be owned in ONE file (`update-types.ts`) referenced by both the engine reader (ARCH-040) and the helper-writer doc (ARCH-039).** If "helper" and "reader" are split into two tasks without this single source, the JSON schema drifts — a cross-process interface silently breaks with no compiler to catch it. Same for the flag content contract (one-line tag) and the single-row DB table name.
- **The bash helper + systemd units are a distinct deploy-artifact task**, not folded into an engine-TS task; its test is a child-process integration harness (not a vitest UT), so tasks/estimates must reflect a different test tier.

## Expected disagreements with the other lens (quality-dimensions group)

1. **Single outcome row vs update *history* (self-sustainability/observability ⟂ my Karpathy simplicity).** Quality will likely want a durable update *audit log* / rollback-history table. I hold the ARCH line: one single-row `UpdateOutcome` — "last outcome" is what REQ-070 asks for; a history DB is speculative until a real requirement. Likely reconciled as: single row now, history a future-REQ candidate (not an ARCH).
2. **TS helper vs bash helper (their replaceability/consumability ⟂ my testability-under-privsep).** Quality may argue a typed TS helper is more replaceable/observable. I hold bash-but-seamed: the *privilege boundary* is the design's load-bearing security property, and putting the privileged logic back in a Node process (or a second Node process sharing the engine's supply chain) erodes exactly the seam privsep buys. Command-prefix seams give replaceability without crossing the boundary.
3. **Uniform Host/Origin policy vs my per-route exemption (their self-sustainability/uniformity ⟂ my boundary pragmatism).** Quality prizes a uniform allowlist across every route (REQ-056's stated invariant). I need one HMAC-authenticated exemption or the feature can't function. Reconcile: the exemption is *narrow and HMAC-gated*, documented as such — not a hole in the uniform policy but a second auth root for one route.
4. **Trace-ID across the four-process boundary (their observability ⟂ scope).** Quality's panel already raised distributed trace-ID / `/health` for the wider system; I expect them to want it threaded through flag→helper→result. I hold it out of REQ-068..070 scope (agreed in the ARCH rationale) — the flag/result files already carry the tag as the correlation key, which is sufficient for this slice.
5. **`skipped` as a first-class outcome (my boundary-completeness ⟂ possible "applied is enough").** I add `skipped` (already-on-T) as a third status; ARCH-040 named only `applied|failed`. Minor — I expect agreement once the idempotent-apply branch is acknowledged, but flag it so the synthesizer picks the 3-state enum deliberately.
