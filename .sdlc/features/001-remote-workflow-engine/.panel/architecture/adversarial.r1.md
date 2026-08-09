# Architecture — Adversarial group (Security / Scalability / Testability) — Round 1 (independent)

**Scope under review:** v11 Sprint 2 — **REQ-068 / REQ-069 / REQ-070**: a GitHub *tag* webhook
(HMAC-verified) that drives a **privilege-separated, fully-automatic self-update** (engine writes a
flag → a systemd path-unit + oneshot helper does `git fetch/checkout` + `npm ci && build` +
`systemctl restart`), with `/api/version` + dashboard reporting and safe-fail on build failure.

**Altitude judgment (system vs agent):** For THIS slice I apply the **plain-system** altitude. The
update path contains **no agent execution** — it is deployment/CI-webhook infrastructure. The wider
product is an AI-agent system (agent altitude applies to the run/gateway path), but observability /
replaceability / consumability / self-sustainability here read as *system* concerns: this feature
*is* the system's own **self-sustainability** (a service updating its own code) at the **system**
altitude, not agent self-sustainability. I deliberately do **not** force the agent lens onto it.

**One-sentence framing of the threat model:** this feature is **RCE-by-design** — a network event
causes the host to *fetch and execute new code and restart the service*. Every architectural choice
must be judged as "how much does this widen, or bound, an attacker's path to arbitrary code on the
host." The entire feature's integrity reduces to a single question: **is the checked-out tag
trustworthy?** — because `npm ci && npm run build` on freshly-fetched code *is already arbitrary
code execution*, before the restart ever happens.

---

## Summary

I endorse the **privilege-separation shape** (engine unprivileged, writes a flag; a separate
privileged systemd unit does the git/build/restart) as the correct, blast-radius-minimizing design —
it is the one part of REQ-069 that must **not** be negotiated away. The engine runs untrusted agent
code and (per this feature) becomes reachable from an inbound webhook; granting it sudo/restart
rights would collapse the whole VM-sandbox threat model.

But I raise **three first-order architectural tensions** the requirement text under-specifies:

1. **Public-exposure contradiction.** An inbound GitHub webhook *requires a publicly reachable
   endpoint*, which directly contradicts the product's standing hard boundary ("bind 127.0.0.1 only
   + SSH-tunnel/VPN until OIDC lands," v3 scope decision). The design must either (a) treat this one
   HMAC-gated path as the deliberate, documented public hole (GitHub's own security model: the HMAC
   *is* the auth), or (b) — my preferred, simpler, zero-attack-surface alternative — **poll instead
   of receive** (`git ls-remote --tags` the official remote on an interval), needing no public port
   and no HMAC endpoint at all.

2. **The trust boundary moved to a *file*.** With privsep, the **flag file is the new privilege
   boundary**: anyone who can write it gets RCE via the helper. Its path, ownership, and permissions
   are now *security controls* — it must live outside any run workspace, be engine-user-owned, and
   be non-group/world-writable. The helper must treat the flag's contents (the tag string, which is
   attacker-influenced via the webhook body) as **untrusted data**, never shell-interpolated.

3. **Auto-build = auto-RCE-on-whatever-you-check-out.** "Safe-fail never leaves the service down"
   (REQ-070) protects *availability*, not *integrity*. A malicious tag whose build **succeeds** is
   not caught by safe-fail. The only real integrity defenses are upstream of the build:
   official-remote pinning + tag-pattern + existing-tag check (cheap, ship now) and, as
   defense-in-depth, **GPG-signed-tag verification** (`git tag -v`, defer as documented hardening).

Karpathy tie-breaker throughout: build the **minimum** — HMAC-verify (reuse the existing tested
raw-body path) → write flag → a *dumb* helper that checks out + builds + restarts with safe-fail.
No rollback-history DB, no multi-version manager, no canary, no human-approval workflow beyond what
REQ-070 (full-auto) mandates. The last-outcome record is a single row, not an audit system.

---

## Key points

### Security (authn / secret / attack surface)

- **S1 — Reuse the proven HMAC-over-raw-body verifier; do not rebuild.** `src/webhook-registry.ts`
  already does constant-time `timingSafeEqual` HMAC-SHA256 over the **raw** body (length-short-circuit
  then `timingSafeEqual`). GitHub's `X-Hub-Signature-256: sha256=<hex>` matches this exactly after
  `.replace(/^sha256=/,'')`. **Extract the shared constant-time verifier**; the tag webhook is a
  *specialization*, not a copy.
- **S2 — HMAC MUST be over the raw delivered bytes, captured BEFORE JSON parse and BEFORE any
  gzip decode.** REQ-063 added `Content-Encoding` decoding to `/mcp`; the tag-webhook route must use
  `readBodyBuffer` (raw), *never* the decoded path — GitHub signs the wire bytes. A regression that
  HMACs the decoded body silently breaks verification (or, worse, creates a mismatch an attacker can
  steer). Assert raw-body in a test.
- **S3 — The secret is a *provisioned* shared secret, NOT the registry's generate-and-return
  model.** GitHub is the sender; the same secret is configured in GitHub's webhook UI and in the
  engine's server-side store (`RWE_SECRET_GITHUB_WEBHOOK_SECRET` via `loadSecretSourceFromEnv`,
  `RWE_SECRET_*` prefix). This is a real divergence from `WebhookRegistry.create()` (which *generates*
  a secret) and must be designed explicitly. Secret is never workspace/sandbox-reachable, never
  logged, never on the dashboard (extends REQ-018 / D-R2).
- **S4 — The flag file is a privilege boundary (see tension #2).** Path outside any run workspace,
  engine-user-owned, mode `0600`/`0640`, **written atomically** (temp + `rename`) so the helper never
  reads a half-written tag. This is the load-bearing control — its permissions ARE the authz on the
  privileged helper.
- **S5 — Tag string is untrusted; the helper validates and never shells it in.** (a) validate T
  against the tag pattern (`^v[0-9][0-9A-Za-z.\-+]*$`) at *both* engine (before writing the flag) and
  helper (before acting); (b) `git fetch --tags` then confirm **T resolves to an existing tag on the
  OFFICIAL remote** (reject a rewritten `origin`, reject any ref that is not that exact tag);
  (c) check out by the **resolved SHA**, via `execFile`/array-args — **never** `sh -c "git checkout
  $T"`. Blocks `v1.0.0; rm -rf /`, `--upload-pack=…`, `--exec`, ref-injection.
- **S6 — Replay / restart-storm.** GitHub sends `X-GitHub-Delivery` (UUID) but **no signed
  timestamp** — so the RWE webhook's `±300s` window does **not** apply here; rely instead on
  **delivery-id dedup** (reuse the `webhook_deliveries`-style table) **plus idempotent apply** (helper
  no-ops / skips the restart if already on T). Without this, a replayed valid delivery = a forced
  restart loop (availability DoS).
- **S7 — Brute force is a non-threat, flooding is the real one.** Guessing a 256-bit HMAC secret is
  infeasible; the practical concern is an attacker POSTing many bad-signature bodies (each costs one
  HMAC compute). The constant-time compare is cheap and the path does no work before verify — a basic
  per-source rate limit is sufficient; do not over-engineer.
- **S8 — Residual risks to state, not hide:** a moved/force-pushed tag or a compromised repo/webhook
  secret = full RCE — *out of the webhook's control, inherent to trusting the repo*. GPG-signed-tag
  verification is the only mitigation and is deferred (see D3). `npm ci --ignore-scripts` narrows
  (does not close) the build-time RCE window.

### Scalability / performance / concurrency

- **P1 — Throughput is a non-problem; consistency of the update flow is the real one.** Tag pushes
  are rare — do **not** build for scale. But the *single-writer* invariant on "which version are we
  on" and the update record must hold.
- **P2 — Two state representations, each with one job:** (i) the **flag file** = IPC to the
  privileged helper (mandated by privsep); (ii) a **durable last-outcome record** (one SQLite row:
  `{tag, status: applied|failed, ts, detail}`) for REQ-070's dashboard observability. The helper
  writes its outcome back across the boundary (a result file the engine reads). Don't conflate the
  two; don't grow the record into an audit log (Karpathy).
- **P3 — Overlapping tags / serialization.** v1.4.0 then v1.4.1 arriving close together must not
  interleave a checkout/build. The helper serializes with a **lockfile (`flock`)**; "latest tag
  wins" (or FIFO) is a documented, simple policy. Atomic flag write (S4) prevents torn reads.
- **P4 — A self-update restart == a crash; lean on existing durability.** The restart kills
  in-flight runs, but REQ-059/060 (persisted-journal read-back + interrupted→resumable) already make
  an interrupted run resumable via journal replay. **Reuse it** — the self-update path needs no new
  in-flight-drain machinery; document that an update behaves like a controlled restart and runs
  resume. (Nice synergy; call it out so the panel doesn't invent a drain protocol.)
- **P5 — Single-instance ceiling (state honestly).** The engine is a single-host stateful service
  (SQLite, local workspaces, local child processes) and self-update is inherently host-local (it
  updates *this* checkout). It is **fundamentally incompatible with a multi-replica deployment**
  (split-brain versions). Fine for now — document the ceiling; do not pretend horizontal scale.
- **P6 — Build contends with live runs.** `npm ci && npm run build` is CPU/IO-heavy and runs
  alongside agent execution until the restart. Minor; note as a known cost, not worth mitigating in v1.

### Testability

- **T1 — Three clean, injectable units** (this is the payoff of privsep):
  1. **Verifier + flag-writer** (in-engine, unprivileged): inject the `SecretSource`, a `Clock`, and a
     **flag-sink seam** (a function that writes the flag). Unit tests assert: valid signed tag event →
     sink called with T; bad signature → 401, sink **not** called; non-tag / non-matching ref → 200
     no-op, no flag; replayed delivery-id → no second flag. Mirrors the already-tested
     `WebhookRegistry.deliver` shape exactly.
  2. **Updater helper** (out-of-engine script): integration-test against a **throwaway git repo**
     (REQ-069 says so). Inject `git` / `systemctl` via a command-prefix / env seam so tests substitute
     fakes. Cases: valid tag → checks out that SHA + issues restart (mocked); foreign/nonexistent ref →
     refuses, changes nothing; **build fails → restart NOT called + prior checkout intact + failure
     recorded** (the single most important test — its failure mode is "service left down").
  3. **Version reporter** (`/api/version`, `/api/status`): already `resolveEngineVersion(exec?)` with
     an injectable `exec`. Reuse.
- **T2 — Keep ALL logic in the helper SCRIPT; make the systemd `.path`/`.service` units trivial.**
  Declarative unit files are essentially untestable in CI. The `.path` unit = "on flag change, run the
  script"; the `.service` = "run the script." Zero decision logic in unit directives → everything
  meaningful is a unit/integration test.
- **T3 — Safe-fail is a *tested branch*, not a hope.** Structure the helper so "abort before
  `systemctl restart` on any checkout/build failure" is a single injectable branch (inject a failing
  build command → assert restart not called + outcome=failed). Real-run (Gate 7.5): a real signed
  webhook → real flag → helper on a throwaway checkout → real restart → `/api/version` shows the new
  tag; and a tag whose build fails → service stays up on the prior version, dashboard shows the failed
  outcome (mock-hard-rule: needs a real green, not mock-only).

---

## Risks (ranked)

- **R1 (critical) — Public exposure vs the 127.0.0.1-only boundary.** Receiving a GitHub webhook
  breaks the product's own security posture. If not resolved (poll instead, or explicitly document +
  isolate the one HMAC-gated public path and add the public Host to the REQ-056 allowlist so GitHub
  isn't 403'd), this feature silently punches a hole in the deployment model. **This is the decision
  the panel must make first.**
- **R2 (critical) — Flag-file write access = RCE.** If any agent / run workspace / group-writable
  path can reach the flag file, an untrusted agent escalates to host RCE through the privileged
  helper. Permissions + location are non-negotiable controls, not hygiene.
- **R3 (high) — Tag/ref injection into the helper.** Shell-interpolating T, or trusting a rewritten
  `origin`, turns a signed webhook into arbitrary-command execution. Mitigated by S5 (pattern +
  official-remote + resolve-to-SHA + `execFile`).
- **R4 (high) — Auto-apply of a build-succeeding malicious tag.** Safe-fail does not catch it; only
  repo/secret integrity + (deferred) signed-tag verification do. Must be stated as accepted residual
  risk of choosing full-auto (REQ-070) over a human gate.
- **R5 (medium) — Restart storm via replay / rapid tags.** Delivery-id dedup + idempotent apply +
  lockfile serialization required (S6/P3), else availability DoS.
- **R6 (medium) — Half-written flag / interleaved builds.** Atomic write + `flock` (S4/P3).
- **R7 (low) — Single-instance-only ceiling** (P5): document, don't fix.

---

## Expected disagreements

### With other panel lenses

- **vs a simplicity/pragmatist lens:** they will likely argue "self-hosted single-user box — just
  shell out from the engine with a sudoers entry; privsep is over-engineering." **I strongly
  disagree:** the engine executes untrusted agent code and is (per this feature) webhook-reachable;
  giving it restart/sudo rights collapses the sandbox. Privsep stays. We *will* agree the helper
  should be as dumb and small as possible.
- **vs a feature/velocity lens:** they will want the inbound webhook + full-auto exactly as written.
  I push back on R1 and prefer the **poll model** (no public surface at all) or, failing that, an
  explicitly-documented single HMAC-gated public path. Genuine fork the panel must resolve.
- **vs a compatibility/consistency lens:** they may want to reuse `WebhookRegistry.create()`
  wholesale. I disagree on the secret model (S3): GitHub tag webhook needs a *provisioned* shared
  secret, not generate-and-return, and has *no* `X-RWE-Timestamp` — so the RWE replay-window logic
  doesn't transfer. Reuse the *verifier*, specialize the *policy*.

### Internal conflicts *within* my own three lenses (surfaced deliberately)

- **Security vs Testability:** strong security wants GPG-signed-tag verification + `--ignore-scripts`;
  both add moving parts a test must fixture (a keyring; a build that tolerates no scripts).
  **Tie-break (Karpathy):** ship official-remote-pin + tag-pattern + existing-tag check now (all cheap
  and directly testable); **defer** signed-tag verification + `--ignore-scripts` as documented
  hardening, not v1 blockers.
- **Security vs Availability(Scalability):** security prefers **fail-closed** ("any doubt → do not
  update"); REQ-070 mandates **safe-fail / never-down** (keep the old version running). They *agree*
  on "never restart onto a broken build." They *conflict* on **auto-apply with no human gate** — a
  security lens would add a manual approval step on an RCE-grade action; the requirement chose
  full-auto. **Tie-break:** accept full-auto *because* privsep + official-remote-pin bound the blast
  radius, and record R4 as the explicit residual risk of that choice.
- **Scalability vs Testability:** the single-writer/lockfile serialization (P3) adds concurrency code
  that is fiddly to test deterministically; a stateless helper would test more cleanly. **Tie-break:**
  a plain `flock` on an injectable lock-path is *both* adequately safe *and* testable — no
  distributed-lock machinery.
