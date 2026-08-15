# Design panel — Adversarial design group (r1, independent)

**Scope:** v13 / REQ-080 (`seedRef:{repoUrl,sha}` engine-pull behind a fail-closed egress allowlist), decomposed at Gate 2 into **ARCH-052** (pure egress gate + seed-source mutual-exclusion, reject-before-network, pre-`createRun`) and **ARCH-053** (`SeedRefFetcher` port: hardened git → sha-verify → CAS-assemble via `materializeManifest`, post-`createRun`). Design stage produces the DES units + shapes the TASK split (03-tasks.md not yet written).

**Lenses carried (traded off explicitly below):** (a) interface-contract, (b) boundary/error, (c) testability. Karpathy simplicity-first is the tie-break.

## Altitude judgment (system vs agent)

REQ-080 is **primarily a system-altitude** feature: network egress, a git subprocess, byte transport, config validation, SSRF containment — none of it is LLM-shaped. But it carries **one load-bearing agent-altitude invariant**: the pulled tree becomes the *agent workspace*, so (1) sha==tree is the **provenance/replay anchor** that makes a seeded agent run reproducible/auditable (ARCH-053 K3), and (2) the agent-visible surface must be **byte-identical** whether seeded via `seed` / `seedManifest` / `seedRef` (guard-parity). I therefore apply system altitude to the transport and hold the design to the two agent-altitude invariants where they bite (sha-verify, guard-parity via the shared `materializeManifest` writer). No AI-specific quality dimension is stretched onto a plain fetch.

## Summary

The Gate-2 decomposition is sound and I endorse its spine: a **pure `isEgressAllowed`** (zero-I/O → the whole SSRF matrix is a table UT) + a **single injected `SeedRefFetcher` port** (RunManager tests stay network-free) + **reuse of `materializeManifest`** as the un-forkable single writer (guard-parity is structural, not asserted). My design tightens three things the ARCH left implicit and that my three lenses collectively demand:

1. **Interface contract — collapse `seedRef` onto the existing `seedManifest` code path.** The fetcher's job is *not* to materialize a workspace; it is to (a) verify sha, (b) `putBlob` each tree blob into the `CasStore` under `seedNamespace`, and (c) return a `ManifestEntry[]`. RunManager then runs the **exact existing `seedManifest` branch** (`materializeManifest(ws, entries, readBlobSync)` + `initGitBaseline`). This makes REQ-080's "SAME per-path guards" a *code identity*, not a parallel implementation, and `CasStore.putBlob`'s store-under-computed-hash gives blob-poisoning safety for free.
2. **Boundary — pin the error taxonomy AND its precedence.** Five run-visible codes + one config-load code, with a **deterministic precedence order** (below) so the same malformed request always yields the same code (interface-contract depends on this being total and ordered).
3. **Testability — extract a pure `buildGitInvocation()` so the K2 security flags are UNIT-asserted**, and pin the one real-tier IT as a *skippable network pull of a pinned public repo* (not a local `file://` repo — which the hardening itself forbids).

## key_points

### (a) Interface-contract

- **ARCH-052 pure gate — `src/seedref-egress.ts`:**
  ```ts
  export type EgressVerdict =
    | { ok: true; url: URL }
    | { ok: false; code: 'SEEDREF_DISABLED' | 'SEEDREF_EGRESS_DENIED'; reason: string };
  export function isEgressAllowed(repoUrl: string, allowlist: readonly string[]): EgressVerdict;
  ```
  Deny-by-default. Empty/absent allowlist → `SEEDREF_DISABLED`. Otherwise `new URL(repoUrl)`; reject (→`SEEDREF_EGRESS_DENIED`) on: any non-`https:` scheme, any `userinfo`, any parse throw, any non-prefix-match. Match = `origin + pathname` path-prefix against a **normalized entry with an enforced trailing `/`** (kills `github.com/HsuJavis/` ⊄ `github.com/HsuJavisEvil/`).
- **Config normalize is a *separate* pure function**, `normalizeSeedRefAllowlist(raw: unknown): string[]`, run at config load (`main.ts`, beside `maxWorkflowDepth`/`maxConcurrentRuns`): each entry must parse as an `https:` origin+path; a bare host / missing trailing `/` is normalized (append `/`); a non-`https`/garbage entry is **rejected** with a coded, entry-naming message (`SEEDREF_ALLOWLIST_INVALID`). Reject, not clamp — an allowlist entry has no meaningful clamp.
- **`isEgressAllowed` normalizes idempotently *inside* too** (append-trailing-`/` is a no-op on an already-normal entry). So the matcher is **total on any `string[]`** and its unit tests need no config loader. See internal-conflict #1 — this small redundancy is the deliberate resolution.
- **Mutual exclusion lives in the pure spec validator** (`submission-validator.ts` / `seedPathVerdict` module), not scattered in RunManager: `seedSourceCount(spec) = count(seed?, seedManifest?, seedRef?)`; `> 1` → `SEED_SOURCE_CONFLICT`. **Convention pinned:** a source "counts" iff it is a non-empty presence — matching the existing materialize condition (`seed && seed.length > 0`, `seedManifest && length > 0`) — so `seed: []` + `seedRef` is NOT a conflict (the empty array is inert), consistent with how the current branch-picker already treats an empty seed as absent. `seedRef` is additive; the inline/`seedManifest` byte paths are unchanged.
- **ARCH-053 fetcher port — `src/seedref-fetcher.ts`:**
  ```ts
  export interface SeedRefRequest { repoUrl: string; sha: string;
    timeoutMs: number; maxTotalBytes: number; maxFileBytes: number; }
  export interface SeedRefResult { resolvedSha: string; bytesTransferred: number;
    entries: ManifestEntry[];      // {path, sha256, exec?} — feeds the EXISTING seedManifest branch
    dropped: string[]; }           // symlink/gitlink modes skipped (observability parity, see boundary)
  export interface SeedRefFetcher {
    fetch(req: SeedRefRequest, putBlob: (sha: string, bytes: Buffer) => Promise<void>): Promise<SeedRefResult>;
  }
  ```
  The `putBlob` callback is `CasStore.putBlob(seedNamespace, sha, bytes)` bound by RunManager, so the fetcher never holds the store handle and CAS custody stays with the parent. **The callback is `Promise`-returning and the fetcher `await`s it** — `CasStore.putBlob` is async, and although its body is currently synchronous (`writeFileSync`/`renameSync`) the port contract must not silently depend on that, or a later `materializeManifest` `readBlobSync` could race a still-pending write. **`latencyMs` is stamped by RunManager** (it owns the injected `Clock`), not by the fetcher → the fetcher takes no clock dep (Karpathy) and the field is deterministic under a fake clock.
- **RunManager wiring is minimal:** the fetch is an `await` in the **post-`createRun` materialization block** (run-manager.ts ~L244) that produces `(entries, seedNamespace)`, which then falls into the *existing* `materializeManifest` branch. `workflow_run` still returns `runId` immediately (REQ-005) — the fetch runs inside the async run body, not in the tool call.

### (b) Boundary / error — the complete taxonomy + precedence

Pre-network, **pre-`createRun`, no run created** (pure, in the ARCH-052 tier next to `INVALID_SEED_SPEC`):
- `SEED_SOURCE_CONFLICT` — more than one of seed/seedManifest/seedRef.
- `SEEDREF_DISABLED` — seedRef given, allowlist absent/empty.
- `INVALID_SEED_SPEC` — **new boundary the ARCH left open:** `sha` must be a **full 40-hex (or 64-hex) commit id**; a branch name / short sha / ref is rejected here. A mutable ref would break the provenance anchor (a "reproducible" run that silently drifts) — this is a genuine gap, not gold-plating. `repoUrl` must be a non-empty string.
- `SEEDREF_EGRESS_DENIED` — URL fails `isEgressAllowed`.

**Precedence (pinned, deterministic):** `SEED_SOURCE_CONFLICT` → `SEEDREF_DISABLED` → `INVALID_SEED_SPEC (sha/url shape)` → `SEEDREF_EGRESS_DENIED`. Conflict is a structural input error and wins regardless of allowlist; DISABLED (transport off) precedes shape/allow checks because there is nothing to validate against. Interface-contract *requires* this order be fixed or tests are ambiguous.

Post-`createRun`, **run fails typed, never hangs, never starts against an empty tree** (R3):
- `SEEDREF_TOO_LARGE` — total-bytes/per-file cap exceeded, computed from `git ls-tree -l` sizes **before reading any blob**. **I keep this distinct** from FETCH_FAILED (see internal-conflict #2): the remediation is caller-actionable and different ("shrink the repo" vs "retry"), and it is a deterministic size check → a clean unit test.
- `SEEDREF_SHA_MISMATCH` — materialized tree's commit ≠ requested `sha` (unconditional; do not assume `allowAnySHA1InWant`).
- `SEEDREF_FETCH_FAILED` — **folds** git-absent / unreachable / non-2xx / **timeout** into one code with a `reason` detail (mirrors the existing `GITHUB_API_ERROR` convention — do NOT mint `SEEDREF_TIMEOUT`).

Config-load: `SEEDREF_ALLOWLIST_INVALID` (fail fast at boot, entry-named).

Two boundary refinements the ARCH glossed:
- **Symlink/gitlink modes (`120000`/`160000`) are dropped at `ls-tree`, but MUST be reported.** `ManifestEntry` cannot represent a symlink, so an unreported drop = silent surprise + observability hole. The fetcher lists them in `SeedRefResult.dropped`, which RunManager merges into the run's `SeedResult.rejected` — so `workflow_artifacts` / the run record show *exactly* what the guard skipped, byte-parity with how `seed`/`seedManifest` surface a rejected path. (Guard-parity = **skip-and-continue**, not fail-the-run, matching `materializeSeed`/`materializeManifest` semantics — a symlink escape does NOT abort the run.)
- **The git child must be KILLABLE.** `timeoutMs` is meaningless if the fetch uses `execFileSync` (uninterruptible — the exact `workspace-git.ts` pattern ARCH-053 already warns not to reuse). Use `spawn`/`execFile` + kill-on-timeout + temp-dir cleanup on every exit path (success/fail/timeout). This is the D-KILL lesson (an abandoned child burns work and leaks a temp dir) applied to the fetch — a concrete, non-optional impl shape, not a runtime subsystem.

### (c) Testability

- **ARCH-052 is 100% pure UT.** One table drives the whole SSRF matrix — each REQ-080 acceptance example is one row: `169.254.169.254`, `localhost`, a private-range IP, `file://`, `ssh://`, `git://`, `http://`, `user:pass@host`, `github.com/HsuJavisEvil/` over-match, empty allowlist (→DISABLED), foreign host, and the happy `github.com/HsuJavis/foo` match. Zero network, zero clock.
- **K2 hardening is UNIT-asserted via a pure builder** — `buildGitInvocation(req) → { args: string[]; env: Record<string,string> }`. A table UT proves `GIT_CONFIG_NOSYSTEM=1`, isolated `HOME`/`GIT_CONFIG_GLOBAL`, `GIT_ALLOW_PROTOCOL=https`, `-c http.followRedirects=false`, `submodule.recurse=false`, `GIT_TERMINAL_PROMPT=0`, `--depth 1`, and that it does **not** inherit `...process.env`. This lets the security-critical flags be verified **without spawning git** — the injection seam for RunManager stays the single `SeedRefFetcher` port (internal-conflict #3).
- **RunManager stays network-free:** inject a fake `SeedRefFetcher`. Cases: (i) fake returns entries → run assembles via the seedManifest branch, artifacts match; (ii) fake throws `SEEDREF_FETCH_FAILED` → run status failed, workspace NOT started, empty-tree guard holds; (iii) fake throws `SEEDREF_SHA_MISMATCH` → typed fail; (iv) fake returns `dropped` → merged into the run record. `latencyMs` deterministic via the run's fake `Clock`.
- **The "BEFORE any network call, creates no run" clause is its OWN assertion** (REQ-080's strongest security claim — otherwise it is structural-by-claim, not tested): for a `SEED_SOURCE_CONFLICT` / `SEEDREF_DISABLED` / `SEEDREF_EGRESS_DENIED` / sha-shape spec, assert the fake fetcher's `fetch` is **never invoked** AND `store.createRun` is **never invoked**. This is the cheap UT that makes "zero outbound connection" a checked property, not a hope.
- **The one real-tier IT = a skippable network pull of a pinned public repo** (`github.com/HsuJavis/<tiny>` at a fixed sha), gated/skipped when offline — mirroring how the real-tier LLM VALs skip without a key. **NOT a local `file://` repo:** the production hardening (`GIT_ALLOW_PROTOCOL=https` + https-only gate) forbids `file://`, so a local-file IT would either not exercise the real path or require weakening the default. Pin the real path in the one real-tier test; keep everything else pure/faked.

### Task-split shaping (03-tasks.md guidance)

Split the TASKs on the **same seam as the ARCH = the test seam**: **TASK-α** = ARCH-052 (pure `isEgressAllowed` + `normalizeSeedRefAllowlist` + sha/url shape validation + mutual-exclusion) — a fully deterministic test-first RED slice, zero network in RED or GREEN. **TASK-β** = ARCH-053 (`SeedRefFetcher` port + `buildGitInvocation` pure helper + hardened-git impl + `putBlob`→`materializeManifest` wiring + RunManager post-`createRun` step + observability + kill/cleanup), whose *only* network touch is one skippable IT. Do **not** fuse them: fusing drags a network dependency into the pure gate's RED tests.

## risks

- **R1 — real-tier IT vs the hardening (testability ⟂ security).** The ARCH cites "a throwaway local repo" as the IT model, but https-only + allowlist blocks `file://`/local. Mitigation above (pinned public-repo pull, skippable). If offline CI is a hard constraint, the fallback is a local `git http-backend` over `https://127.0.0.1` with a test-only self-signed cert + `127.0.0.1` allowlisted — heavier; prefer the skippable public pull.
- **R2 — timeout that doesn't kill (boundary).** If impl reuses `execFileSync`, `timeoutMs` is cosmetic and a slow forge holds an admission slot + leaks a temp dir. The killable-child + cleanup-on-all-paths requirement is load-bearing, not polish.
- **R3 — mutable ref masquerading as sha.** Without the full-hex `sha` check, a caller passing a branch name gets a *non-reproducible* run that looks pinned — silently defeats the K3 provenance anchor. Closed by the `INVALID_SEED_SPEC` sha-shape boundary above.
- **R4 — silent symlink→text conversion.** `materializeManifest` writes every entry as a regular file; a git symlink entry would become a text file holding the target path if not dropped at `ls-tree`. Closed by drop-at-enumeration + `dropped[]` reporting.
- **R5 (accepted residual, per D-v13-C).** DNS-rebind of an allowlisted host to a private IP is not closed (no connect-IP-pin). I concur it stays an accepted residual on an explicit operator trust grant — building the pin now is speculative.

## Internal conflicts among my own three lenses (surfaced, as required)

1. **`isEgressAllowed` input contract — interface-contract ⟂ testability.** Interface-contract prefers a crisp "input is pre-normalized (config-load's job)" precondition; testability prefers a self-sufficient pure function that needs no config loader wired in. **Resolution:** normalize idempotently *inside* the matcher **and** validate/reject at config load. The redundancy is one `if`—Karpathy-cheap—and buys total-function robustness + loader-free unit tests. Both lenses win.
2. **Error granularity — boundary ⟂ Karpathy-simplicity.** Boundary wants distinct codes for every failure (TOO_LARGE, TIMEOUT, UNREACHABLE, GIT_ABSENT); simplicity wants one `SEEDREF_FETCH_FAILED` + reason (the `GITHUB_API_ERROR` precedent). **Resolution (principled split, not blanket):** keep `SEEDREF_TOO_LARGE` distinct (deterministic pre-download size check, *different* caller remediation, cheap UT) and `SEEDREF_SHA_MISMATCH` distinct (provenance); **fold** timeout/unreachable/git-absent into `SEEDREF_FETCH_FAILED`+reason. Distinctness earns its keep only when the remediation and the test tier differ.
3. **Seam granularity — testability ⟂ interface-contract/Karpathy.** Testability could want to also inject the raw git-exec fn (to unit-test the hardened env); interface-contract + Karpathy want a *single* `SeedRefFetcher` seam. **Resolution:** one port seam for RunManager, plus a pure `buildGitInvocation()` helper that makes the security flags UNIT-testable *without* a second injection point. The security assertions move from an opaque integration into a table UT — the strongest lever in this whole design.

## expected disagreements with the quality-dimensions lens

- **Observability depth.** Quality will likely push a structured fetch-event / trace-ID / `GET /health` surface. I hold to the three fields the ARCH committed (`resolvedSha`, `bytesTransferred`, `latencyMs`) + the typed failure code, and back the ledger's decision to keep trace-ID/health as pre-existing *deferred* cross-cutting REQs — not seeded by a single seed-source feature (Karpathy; matches D-v13 rationale).
- **Replaceability / transport SPI.** Quality may want a `SeedRefFetcher` *registry* for future non-git transports (tarball URL, svn). I resist: one git impl behind one port. A registry/SPI is the speculative-flexibility Karpathy cuts; adding a second transport later is a config row + a second impl, not a plugin framework now (consistent with D-v13-D cutting the worker pool).
- **Consumability — likely AGREEMENT.** Quality's ask that `workflow_run`'s description state the mutual-exclusion rule + the `seedRef`-needs-allowlist hint (so `SEEDREF_DISABLED` isn't a silent dead-end) overlaps my boundary lens. Low conflict; I co-sign it.
- **Circuit-breaker on repeated fetch failures.** Quality may want stateful backoff; I defer (D-v13 R3) — the admission counter + per-fetch timeout already bound the blast radius on a single node.
- **Config surface.** Quality might want per-allowlist-entry caps (size per source); I keep global `maxTotalBytes`/`maxFileBytes` (one knob, used one way).
