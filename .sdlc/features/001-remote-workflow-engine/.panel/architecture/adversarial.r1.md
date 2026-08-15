---
stage: architecture
feature: 001-remote-workflow-engine
iteration: v13
target_req: REQ-080  # engine-pull seedRef:{repoUrl,sha} behind a fail-closed egress allowlist (SSRF-safe)
lens: adversarial-architecture-group  # (a) security (b) scalability/perf (c) testability; Karpathy simplicity tie-breaker
round: r1  # independent proposal
---

# Adversarial architecture — v13 / REQ-080 (seedRef engine-pull, SSRF-safe)

## Scope note — reconciling the lens template with the real feature
The lens carries a generic security-attack-surface checklist ("brute force, JWT forgery, timing
attacks, failure counting, lockout"). **There is no auth feature in v13.** REQ-012 (OIDC) is still
DEFERRED in every gate summary; the only v13 requirement is **REQ-080**. So I map the generic
checklist onto REQ-080's real surface:

| generic lens item | REQ-080 real analogue |
|---|---|
| authn/authz correctness | egress **allowlist** correctness (deny-by-default, prefix-match soundness) |
| brute force / attack surface | **SSRF** (metadata endpoint, localhost, private ranges, `file://`), git protocol/redirect/`insteadOf`/submodule bypass |
| secret protection | server-side secrets stay out of the fetch subprocess env & out of the pulled tree |
| JWT forgery / integrity | **sha-pin integrity** — the materialized tree must equal the requested sha (supply-chain provenance) |
| failure counting concurrency | **fetch DoS / resource bounding** — one bounded git fetch per run, no unbounded download |

## System-vs-agent altitude judgment (required first)
The remote-workflow-engine is **both** a conventional system and an AI-agent system, but altitudes
split cleanly for this feature:
- **System altitude is PRIMARY.** REQ-080 is a plain network-egress + workspace-assembly feature. The
  dominant quality dimensions are *security* (SSRF, egress control) and *observability/replaceability*
  at the system level (a typed deny-before-network, an injectable fetch port).
- **Agent altitude is the SECONDARY, load-bearing lens.** The tree a `seedRef` pulls becomes the code
  and context the sandboxed agents Read/Edit/execute. So a poisoned or unpinned pull is a
  **supply-chain injection into agent context** (agent-altitude *consumability* + *self-sustainability*).
  Two controls live at this altitude and MUST NOT be bypassed by the new path: (1) the existing
  `.claude/settings*.json` + `.claude/hooks/**` strip (RCE gate, `isStrippedSeedPath`) has to fire on
  the pulled bytes exactly as it does on inline `seed`; (2) the `sha` is the *provenance/replay* anchor
  — it is what makes a seeded agent run reproducible and audit-able.

I do **not** force a login/session altitude — it is irrelevant here.

---

## Summary
Add `seedRef:{repoUrl, sha}` as a **third, additive** seed source, layered on the SAME
`seedPathVerdict` guardrail and (my recommendation) the SAME CAS-assemble substrate as
`seed`/`seedManifest`. The whole design reduces to four injectable/pure pieces:

1. **`isEgressAllowed(repoUrl, allowlist)` — a PURE function.** Deny-by-default. Empty/absent
   allowlist → `SEEDREF_DISABLED`. Non-matching / SSRF-shaped URL → `SEEDREF_EGRESS_DENIED`.
   This is where every SSRF test lands, with **zero network**.
2. **A `SeedRefFetcher` port (interface) injected into RunManager**, mirroring the existing
   optional-dependency pattern (`cas?`, `queryImpl`, `Clock`, `GatewayClient`). The real impl shells
   `git` in a hardened, config-isolated env; tests inject a fake or point it at a throwaway local repo.
3. **Placement split** (per the fail-fast convention already in `run-manager`): the *pure* rejects
   (`SEEDREF_DISABLED`, `SEEDREF_EGRESS_DENIED`, `SEED_SOURCE_CONFLICT`) happen **before**
   `store.createRun` — "creates no run" — right next to `INVALID_SEED_SPEC` / `MISSING_BLOBS`. The
   *network fetch* happens in the **post-`createRun` materialization step**, bounded by a timeout;
   a fetch failure fails the run **typed**, it never hangs. This keeps `workflow_run` returning a
   `runId` immediately (REQ-005) and keeps the SSRF-denial tests network-free.
4. **Materialize via the shared verdict**, never a raw checkout copy: fetch → enumerate tree
   (`git ls-tree`) → reject symlink/gitlink modes + enforce byte caps up front → stream blobs into
   the CAS under `seedNamespace` → `materializeManifest` (which already gives us `.claude`-strip,
   `.git`-reject, realpath-containment, exec-bit mask, and dedupe on repeat pulls for free).

Mutual exclusion (`seed` / `seedManifest` / `seedRef` — at most one) is a pure check in
`submission-validator.ts` → `SEED_SOURCE_CONFLICT`.

## Key points (architecture decisions)

- **K1 — Deny-by-default egress allowlist, matched on a NORMALIZED URL, not a raw string.**
  Parse with `new URL`; match `origin + pathname` against each allowlist entry as a **path-prefix on a
  normalized authority with an enforced trailing `/`** so `github.com/HsuJavis/` can never prefix-match
  `github.com/HsuJavisEvil/`. **Fail-closed on:** any non-`https:` scheme (`file://`, `ext::`, `ssh://`,
  `git://`, `http://`), any URL carrying **userinfo** (`user:pass@host`), any host that is an IP literal
  in a private/link-local/loopback range even if it were somehow allowlisted, and any parse failure.
  Every SSRF example in the acceptance criteria (`169.254.169.254`, `localhost`, private-range IP,
  `file://`) is rejected by construction because it cannot match an operator's forge prefix.

- **K2 — Harden the git subprocess against config/redirect/protocol/submodule bypass** (the URL the
  allowlist approves is NOT automatically the URL git dials). The real fetcher runs git with:
  `GIT_CONFIG_NOSYSTEM=1`, an **isolated `GIT_CONFIG_GLOBAL`/`HOME`** (defeats `url.<x>.insteadOf`
  rewrite in the operator's ambient gitconfig), `GIT_ALLOW_PROTOCOL=https` (no `file`/`ext`/`ssh`
  fallback), `-c http.followRedirects=false` (no cross-host 3xx pivot to an internal target),
  `-c submodule.recurse=false` / no `--recurse-submodules` (a submodule URL is attacker-controlled and
  bypasses the allowlist), and `GIT_TERMINAL_PROMPT=0` (an auth-required/private repo fails **typed**,
  never hangs the fetch timeout). NOTE: `workspace-git.ts` today spreads `...process.env` un-isolated —
  correct for local baseline init, **wrong** for egress; the new fetcher needs its own hardened env,
  it must not reuse the `workspace-git` env verbatim.

- **K3 — Verify the materialized tree == the requested sha, unconditionally.** Do not assume
  fetch-by-SHA (`allowAnySHA1InWant`) is enabled on every forge; the fetch may need "fetch the ref,
  then resolve+checkout the sha." Whatever the path, the integrity invariant is: the bytes we
  materialize hash to a tree whose commit is exactly `sha`, else `SEEDREF_SHA_MISMATCH` and the run
  fails. This is the agent-altitude provenance anchor (K1 of the "supply chain into agent context").

- **K4 — Bound the fetch (DoS / git-bomb).** Shallow (`--depth 1`) fetch of the single sha; a
  configured wall-clock **timeout** (reuse the same bounded-call convention the GitHub-issue client and
  REQ-020 gateway path already use); and **total-bytes + per-file byte caps enforced from
  `git ls-tree -l` sizes BEFORE reading any blob**, so a huge repo is rejected before it is downloaded
  into the workspace. The fetch runs inside the run's normal lifecycle, so the existing
  **run-admission counter (REQ-054, `maxConcurrentRuns`)** already bounds concurrent fetches — I do
  NOT build a separate fetch queue/worker pool (see Karpathy note).

- **K5 — CAS-assemble, not direct-write (explicit stance).** Two primary sources point here: the
  accepted `docs/seed-sync-architecture.md` says seedRef is "layered on the SAME CAS-assemble," and
  REQ-080's own signature carries `seedNamespace?`, which is only meaningful if fetched blobs land in
  the CAS under that namespace. Adopting it gives the `.claude`-strip / `.git`-reject / realpath /
  exec-mask guards **for free and un-forkable** (`materializeManifest` is the single writer) and dedupes
  repeat pulls of the same sha. Round-2 opponents who argue "just write the checkout into the
  workspace" must answer why they'd re-implement (and risk diverging) the four guardrails and drop the
  dedupe — and why they'd contradict the accepted architecture doc.

- **K6 — Secrets stay out of the fetch.** v1 scope is **public/allowlisted forges + air-gapped internal
  forges reachable without a token in the fetch env**. No provider/GitHub secret (REQ-018/028) is
  injected into the git subprocess, and none appears in the pulled tree (the tree is data the agents
  read). A private repo needing auth is explicitly out of scope for this slice (fails typed via
  `GIT_TERMINAL_PROMPT=0`) — a future slice can add a secret-referenced credential helper, but adding
  it now is speculative.

## Risks

- **R1 (HIGH, accepted residual) — DNS-rebinding of an *allowlisted* host.** My design matches the URL
  string/authority, then git resolves DNS and connects; a host the operator explicitly trusted whose
  DNS is later poisoned to a private IP would still be dialed. A connect-time IP re-pin (resolve →
  reject private ranges → connect to the pinned IP) would close it — but see the security-vs-consumability
  conflict below; I recommend **documenting this as an accepted residual**, not building the pin now,
  because the allowlist entry is an explicit operator trust grant to a specific forge.
- **R2 (MED) — fetch latency on the run's critical path.** The bounded fetch runs post-`createRun`
  before agents start; a slow forge delays the run (not the `workflow_run` return, which already has the
  `runId`). Mitigated by K4's timeout; observable as a run in `running`/`queued` with no agents yet.
- **R3 (MED) — `git` binary absence / version skew** across deploy hosts. `workspace-git` already
  degrades best-effort on missing git; the fetcher must instead fail the run **typed**
  (`SEEDREF_FETCH_FAILED`), because a seedRef run with no tree is not a run worth starting. Documented
  in DEPLOY as a hard dependency for the seedRef path only.
- **R4 (LOW) — symlink/gitlink in the pulled repo.** Closed by K1's no-worktree `ls-tree` enumeration
  (reject modes `120000` symlink / `160000` gitlink) *plus* the `seedPathVerdict` realpath check as
  defense-in-depth. A temp-checkout-then-copy design would reopen this (TOCTOU on symlink deref) —
  a reason to prefer the ls-tree path.
- **R5 (LOW) — allowlist config foot-gun.** An entry without a trailing `/`, or a bare host without a
  scheme, could over-match. Normalize + validate the allowlist **at config load** (reject/clamp with a
  clear message, same convention as `maxWorkflowDepth`/`maxConcurrentRuns`).

## Internal lens conflicts (surfaced deliberately)

- **CONFLICT-1 — Security vs Consumability (the real one).** A hard "deny all private-range IPs at
  connect time" floor is the textbook SSRF fix — but it **breaks the doc's stated air-gapped /
  internal-forge use case**, where the sanctioned forge legitimately lives on a private/LAN IP.
  *Resolution (Karpathy tie-break):* floor only **non-http(s) schemes and userinfo**; treat the
  operator's explicit allowlist prefix as the trust grant (it may name an internal IP host on purpose);
  log DNS-rebind-of-an-allowlisted-host as R1's accepted residual. Deny-by-default + prefix match
  already blocks every *unsanctioned* target; adding a blanket private-IP ban would be a *false*
  security win that removes a real feature.
- **CONFLICT-2 — Security depth (K2 hardening) vs Simplicity.** Every K2 flag is one more thing to get
  right. *Resolution:* K2 flags are **cheap, closed-form, and close git-specific holes the pure
  allowlist cannot see** (`insteadOf`, redirect pivot, submodule URL) — they stay. The connect-IP-pin
  (R1) is the speculative one — it goes to residual. Simplicity cuts the pin, not the env flags.
- **CONFLICT-3 — Testability ⟂ Security (synergy, not conflict).** REQ-080's "reject BEFORE any network
  call" is exactly what makes the SSRF matrix a set of **pure, deterministic unit tests** on
  `isEgressAllowed`. The one true integration test (real git fetch of a throwaway local repo) mirrors
  the existing self-update-helper test. Injecting the `SeedRefFetcher` port keeps RunManager unit tests
  network-free. Security and testability pull the SAME way here.
- **CONFLICT-4 — Perf (fetch worker pool) vs Simplicity.** Scalability instinct says "queue/pool the
  fetches." *Resolution:* the run-admission counter (REQ-054) already caps concurrent runs, hence
  concurrent fetches; a dedicated pool is speculative infrastructure for a load profile we have no
  evidence of. Cut it; revisit only if telemetry shows fetch contention.

## Expected disagreements with the other lenses

- **vs Quality-dimensions / simplicity lens:** they may argue seedRef is over-engineered vs just
  documenting "clone it yourself and use inline `seed`." My counter: the acceptance criteria and the
  accepted architecture doc already committed the feature; the *architecture* question is only how to
  add it minimally — and my four-piece decomposition IS the minimal shape (one pure fn + one port +
  reuse of two existing substrates). I expect agreement that K5 (reuse CAS/`materializeManifest`) is
  the simplicity win and disagreement on whether K3's sha-verify is "extra" (I hold it is the whole
  point of a `sha` field).
- **vs a "pull the whole checkout into the workspace, keep `.git`" proposal:** I will oppose keeping
  `.git` (breaks the `.git`-reject invariant, lets seed-borne git config/hooks in) and oppose
  temp-checkout-then-copy (reopens R4 symlink TOCTOU). Expect a fight over ls-tree-enumerate vs
  checkout; I stand on the no-worktree path.
- **vs anyone proposing to fold seedRef auth/secrets in now:** I defer it (K6). Expect disagreement on
  whether private-repo support is in-scope for v13; I say no — it is a clean future slice, and pulling
  it in now widens the secret-handling surface with no acceptance-criterion demanding it.
- **Likely CONVERGENCE:** deny-by-default + `SEEDREF_DISABLED` when unconfigured, fail-fast-before-run
  for the pure rejects, and reuse of `seedPathVerdict` — these are forced by the requirement text and I
  expect every lens to land on them.
