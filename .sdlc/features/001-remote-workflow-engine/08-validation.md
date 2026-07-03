---
stage: validation
status: passed
---
# 08 Validation (Gate 7.5 — real run & handover)

> Verification (Gate 7) proves the test suite is green; **Validation proves the real system works
> under real operating conditions** — the un-fakeable signal mocks cannot produce.

## ROUND 7 (this round) — scoped spot re-validation of the Gate-8 closing fixes (D-G8-1..6)

Dispatched as a SCOPED re-validation (not a full REQ matrix re-run — round 6 already passed the full
matrix and those clauses are unchanged; the automated regression suite covers the rest) specifically
to real-verify the 6 Gate-8 closing fixes (IMPL-051, 07-review.md) that were implemented but explicitly
flagged in DEPLOY.md/state.yaml as "code/test-tier-fixed, NOT YET re-confirmed via an independent
real-process boot": **D-G8-1** (nested `workflow()` journal `callSeq` namespacing, REQ-006),
**D-G8-2** (`AgentTranscriptSink`/`ClaudeAgentSdkGatewayClient` captures the real message/tool event
stream, not just the terminal result, REQ-007/ARCH-004), **D-G8-3** (`tools/list` serves real
descriptions + real JSON `inputSchema`s, ARCH-001), **D-G8-4** (the zero-config default gateway path
gets a hardcoded `timeoutMs` fallback so a dead provider can never hang a zero-config run, enforces
D-G), **D-G8-5** (the spawned CLI subprocess gets an explicit env ALLOWLIST, never the full
`process.env`, D-R2), **D-G8-6** (concurrent `agent()` dispatches reserve-at-dispatch so `parallel()`
can't materially overshoot the hard budget, REQ-002).

**Mandated real-verify targets (per this round's dispatch instruction), all 3 CONFIRMED via a genuine
zero-config real process this round:**

1. **D-G8-4 (zero-config timeout fallback) — CONFIRMED, dead provider never hangs.** Booted the real
   product **with no `rwe.config.json` present at all** (`ls rwe.config.json` → "No such file or
   directory", confirmed before boot) and no `timeoutMs`/`RWE_CONFIG_PATH` env override — the exact
   "just run it" zero-config shape D-G8-4 targets. Constructed a genuinely unresponsive real network
   peer (a throwaway raw TCP listener on `127.0.0.1:9599` that accepts the connection and never writes
   a single byte back — confirmed hanging indefinitely via a direct `curl -m 30` against it, and via a
   direct `curl` to the product's own real `litellm` proxy on port 4000 configured to route through it,
   which also hung the full 18s `curl` timeout with zero bytes received) and pointed the managed
   `litellm` proxy subprocess's own outbound Anthropic routing at it via `ANTHROPIC_BASE_URL` (the
   `litellm` subprocess inherits `process.env` from `main.ts`'s own process — confirmed via
   `/proc/<pid>/environ`showing `ANTHROPIC_BASE_URL=http://127.0.0.1:9599` on the real spawned
   `litellm` process). Real `workflow_run {script:"return agent(\"say hi\",{model:\"sonnet\"});"}`
   against this zero-config server: **run reached `status:"completed"` in 5.2s real wall-clock**
   (`createdAt` 13:46:15.313Z → transcript terminal-usage event 13:46:20.528Z), `workflow_result.result
   === null` (real failure correctly resolved to `null`, never smuggled as fake success), **never
   hung**. This resolved faster than the 15000ms ceiling (the CLI subprocess's own layer evidently
   fails faster than the outer bound against a raw-TCP-accept-no-response peer — a safe outcome, even
   faster than the guaranteed ceiling) so to also directly pin down the specific `composeConfig()`
   zero-config mechanism itself (not just the aggregate outcome), additionally ran the real,
   unmodified `composeConfig()` + real `ClaudeAgentSdkGatewayClient` class (same composition-root code
   `main.ts` calls, only the SDK's own `query()` call faked at that one seam — the same seaming
   convention this codebase's own IT-021/IT-022 use — to force a session that hangs forever) with
   `RWE_CONFIG_PATH` pointed at a nonexistent file (so `fileConfig.timeoutMs` is genuinely `undefined`,
   the exact zero-config shape): `composeConfig()`'s own resolved config shows `"timeoutMs":15000` (the
   D-G8-4 hardcoded fallback, not `undefined`), and `invoke()` against the permanently-hung fake session
   resolved at **15014ms real elapsed**, `{ok:false, reason:'timeout'}` — directly confirming the
   fallback value is wired all the way into the constructed gateway client and the bounded race
   genuinely activates. Together: the real end-to-end system never hangs on a dead provider in the
   zero-config shape (aggregate proof), and the specific `composeConfig()` fallback + bounded-race
   mechanism is independently confirmed correct (mechanism proof). **REQ-004's bounded-timeout clause
   now holds for the zero-config path too, not just an explicit-`timeoutMs`-in-config deployment.**

2. **D-G8-2 (transcript captures real message/tool events) — CONFIRMED, `workflow_agent_log` returns a
   real reasoning trace, not just the terminal result.** Real config boot (`cp
   rwe.config.example.json rwe.config.json`, unmodified, `gateway:"sdk"`, real local Ollama
   `qwen2.5:7b` via the `local` alias — the documented deploy flow, real independent process). Real
   `agent("Reply with only the word: PONG", {model:"local"})` → completed in 7s real wall-clock
   (`tokens:{input:1553,output:8}`). `workflow_agent_log` for that `agentId` now returns **2 real
   events in order**: `{"kind":"message","data":{"type":"text","text":"{\"name\": \"PONG\"}"}}`
   followed by the terminal `{"kind":"usage",...}` — previously (pre-D-G8-2, per the round-5/6
   narrative) only the terminal `usage` event was ever captured, the entire intermediate
   message/tool-call/tool-result stream was silently discarded by `_drain`'s own
   `if (msg.type !== 'result') continue`. Ran a 2nd real repro with a tool-shaped prompt
   (`"Use the Write tool to write the text HELLO to a file named out.txt"`, `model:"local"`) — again a
   real `"message"` event was captured (`{"type":"text","text":"{\"name\": \"Write\",
   \"arguments\":...}"}`); consistent with the already-accepted D-F11 model-capability-tier gap
   (`qwen2.5:7b` never actually emits a genuine SDK `tool_use` message even with the curated tool
   surface — not re-litigated here per this round's own instruction), so no `"tool_call"`/`"tool_result"`
   kind event was observed in this environment — the model simply never produces the message shape
   `extractEvents()` would classify as one; the capture pipeline itself (message events, in order, with
   real timestamps) is confirmed genuinely wired end-to-end for real. Closes REQ-007's
   "`workflow_agent_log` returns the agent's reasoning/tool trace" acceptance clause for the message
   half; the tool_call/tool_result half remains gated on the same accepted model-capability finding as
   REQ-003 (VAL-003).

3. **D-G8-3 (real `tools/list` schemas) — CONFIRMED, real HTTP round trip.** Same zero-config server
   from finding 1 above (no `rwe.config.json`), real `curl -X POST .../mcp
   {"method":"tools/list"}` → HTTP 200, `result.tools` has all **10** tools, and — unlike the
   pre-D-G8-3 placeholder (`description: name`, `inputSchema:{type:'object'}` with no `properties`)
   this review finding (07-review.md C-1) documented — every tool now has a real, tool-specific
   `description` string and a real `inputSchema.properties`/`required` shape, e.g. `workflow_run`
   documents `name`/`script`/`args`/`budget` with real per-field descriptions,
   `workflow_agent_log` documents `required:["runId","agentId"]`, `workflow_list` correctly documents
   an honest empty `properties:{}` (it is genuinely zero-parameter per `04-design.md:45`'s own
   `workflow_list(a?: {})` signature — not a placeholder, a correct empty schema; this is also why
   `IT-028`'s "every tool has non-empty properties" sub-assertion is a test defect, not a product
   defect — see Regression section below). An MCP client reading this real response can now learn a
   tool's real argument shape without out-of-band documentation. Closes the ARCH-001 consumability gap
   D-G8-3 targets.

**Regression suite (fresh, this round, not trusted from narrative alone):** `npx vitest run` → 69
files / 217 tests, **214 pass / 3 fail**, all 3 pre-existing/expected, none a new regression from
D-G8-1..6:
- `IT-015` (`tests/integration/claude-agent-sdk-session.test.ts`): same pre-existing, documented,
  environment-specific nested-Claude-Code-host interception red carried unchanged from every prior
  round (unrelated to this round's scope).
- `IT-024` (`tests/integration/in-flight-agent-state.test.ts`, D-F12, not this round's own target but
  in the shared real-subprocess-IPC-race-flake class): flaked once in a 3-run sample (2/3 pass,
  re-run individually) — the same documented ~1-in-6 real-child-process IPC-delivery-race class
  `vitest.config.ts`'s own comment already accepts for this codebase, re-confirmed by immediately
  re-running it standalone twice more (both green).
- `IT-028` (`tests/integration/mcp-tools-list-schema.test.ts`, D-G8-3's own test): "every tool has an
  inputSchema with real (non-empty) properties" sub-assertion fails specifically for `workflow_list`
  — **this is the SAME test defect the Gate-6 implementer already identified and reported (IMPL-051's
  own narrative in state.yaml), independently re-confirmed here**: `workflow_list` is genuinely
  zero-parameter per `04-design.md:45`'s own documented signature (`workflow_list(a?: {})`), so
  `server.ts`'s real `properties:{}` for it is a correct, honest empty schema, not a placeholder — the
  test's blanket "every tool, no exceptions" assertion is the thing that's wrong, not the product code.
  Reported as `test_defects` below (not fudged, not silently reclassified as a product gap).
`npx tsc --noEmit`: 0 errors.

**Nested-resume (D-G8-1) and budget-reservation (D-G8-6) and env-allowlist (D-G8-5) — per this round's
own scoping instruction, covered by the automated regression suite (not independently re-run against a
real process this round) plus a direct source read confirming each fix is genuinely wired at its call
site**, since the dispatch instruction explicitly named only the 3 findings above as this round's real-
verify mandate and stated "the regression suite covers the rest":
- **D-G8-1**: `tests/integration/nested-workflow-callseq-resume.test.ts` green in the fresh regression
  run above; source-confirmed `src/run-manager.ts`'s `_nestedCallSeq(parentCallSeq, nestedCallSeq) =
  (parentCallSeq+1)*1_000_000 + nestedCallSeq` is genuinely called at the nested `workflow()` dispatch
  site (line ~311), not merely defined-but-unused.
- **D-G8-6**: `tests/integration/parallel-budget-concurrency.test.ts` green; source-confirmed
  `src/run-guard.ts`'s `reserve()`/`releaseReserved()` are genuinely called synchronously (no `await`
  between `assertBudget()` and `reserve()`) inside `src/run-manager.ts`'s `_handleAgentRequest`, with a
  `finally`-guarded `releaseReserved()`.
- **D-G8-5**: `tests/unit/claude-agent-sdk-gateway-env-allowlist.test.ts` green; source-confirmed
  `src/gateway/claude-agent-sdk-client.ts`'s `ENV_ALLOWLIST` (`PATH`/`HOME`/`SHELL`/`LANG`/`LC_ALL`/
  `TMPDIR`/`TERM`) + `buildSubprocessEnv()` is genuinely passed as `options.env` on every real
  `query()` call (confirmed in the same source read used for the D-G8-4/D-G8-2 findings above) —
  replacing the prior full-`process.env` spread. Not independently re-probed via a real subprocess
  `/proc/<pid>/environ` dump this round (time-boxed, low risk given the unit test's own direct
  assertion on the constructed `options.env` object plus the direct source confirmation above).

**Doc gaps this round: none.** README.md/DEPLOY.md's documented zero-config (`npm run start`, no
`rwe.config.json`) and standard (`cp rwe.config.example.json rwe.config.json` + `npm run start`) boot
flows both remained sufficient with zero undocumented manual steps beyond the already-documented
pre-launch orphan-`litellm`-process cleanup hygiene (unchanged known limitation, not a new gap).

**Config-file sync check (per Gate 7.5 §4b):** none of D-G8-1..6 add, rename, or change the meaning of
any config-file key — `rwe.config.example.json` unchanged and re-confirmed correct as-is. D-G8-4's
fallback and D-G8-5's allowlist are both purely internal/code-level defaults with no new config
surface. No `.env`/other config files exist in this repo. **No config-doc drift found this round.**

**Gate self-check:** `sh .sdlc/trace .sdlc/features/001-remote-workflow-engine --check` → 187 items
scanned, 18 gaps, identical pre-existing v2/v3-out-of-scope baseline (`REQ-008..012/015`,
`TASK-018..023`), **0 orphan/broken-link, 0 未真實驗證 (mock-only), 0 v1-REQ 未驗證 gaps** — same clean
baseline round 6 left, no new gaps introduced by this round's D-G8-1..6 evidence additions.

`gates.validation.passed` **remains `true`** (already flipped at round 6, per the binding CONVERGENCE
RULE, once every v1 REQ acceptance clause had real or accepted-gap evidence) — this round adds fresh
real evidence specifically closing the "code/test-tier-fixed, not yet re-confirmed" caveat the Gate-8
closing fixes carried in DEPLOY.md/state.yaml, it does not newly flip the gate.

### Round 7 test defect (reported, not fudged)
`IT-028` (`tests/integration/mcp-tools-list-schema.test.ts`, D-G8-3's own test) — sub-test "every tool
has an inputSchema with real (non-empty) properties" fails for `workflow_list` specifically.
**Judged: the test is wrong, not the product.** `workflow_list` is genuinely zero-parameter per
`04-design.md:45`'s own documented signature (`workflow_list(a?: {})`), independently confirmed via a
real HTTP `tools/list` call this round returning `workflow_list`'s `inputSchema:{type:'object',
properties:{}}` — an honest, correct empty schema for a tool that really does take no arguments, not
a leftover placeholder (the other 9 tools all show real non-empty `properties`). The test's own
blanket "every tool, no exceptions" assertion doesn't account for a legitimately zero-parameter tool.
**Fix**: either exempt `workflow_list` from this specific sub-assertion (assert its `properties` is
exactly `{}` rather than non-empty) or split the sub-test into "every tool with real parameters has
non-empty properties" + a separate explicit assertion that `workflow_list`'s is intentionally empty.
This was first identified by the Gate-6 implementer (IMPL-051, see state.yaml's own round narrative)
and is independently re-confirmed, not newly discovered, by this validation round.

## Superseded note (round 6, preserved for history)

Dispatched specifically to re-verify the D-F11 (allowedTools curation)/D-F12 (in-flight state)/D-F13
(resume-after-abort fidelity) route-back against a genuine independent process + real local Ollama,
per the binding CONVERGENCE RULE. **All 3 are CONFIRMED FIXED FOR REAL, with one honest caveat on
D-F11 anticipated by its own two-stage instruction** (see below). This round also closed 2
acceptance clauses that had gone unverified-live for several rounds (REQ-005's `bind:0.0.0.0` clause;
REQ-006's 3rd clause, `workflow_stop` + cached-prefix resume with an edited script) with fresh real
repros, and re-confirmed every other v1 REQ clause with fresh evidence this round (not merely carried
forward). **Every v1 REQ acceptance clause now has real, fresh (or D-V3/D-F11-accepted-gap) evidence
— per the binding CONVERGENCE RULE, `gates.validation.passed` flips to `true` this round.**

1. **D-F12 (in-flight `queued`/`running` state) — CONFIRMED FIXED FOR REAL.** Real repro: a real
   3-agent `parallel()` of Ollama `agent()` calls, polled via real HTTP `workflow_status` at t≈1.5s
   and t≈2.5s while the run was still `"status":"running"` → **all 3 agents showed
   `"state":"running"`** (previously `agents:[]`, empty, per round-5's finding). Once complete, all 3
   correctly show `"state":"done"`. Closes REQ-002's 2nd clause's observability half and REQ-007's
   1st clause. (Automated `IT-024` flakes under this session's heavy host load — same accepted flake
   class documented since the D-F12 route-back, not a product defect; see below.)

2. **D-F13 (resume-after-abort re-runs live) — CONFIRMED FIXED FOR REAL.** Real repro: started a real
   ~57s essay-generation `agent()` call, confirmed the spawned `claude` CLI subprocess alive via
   `ps aux`, suspended at t≈2s (subprocess dead within ~2s, re-confirming D-F10c unchanged), then
   `workflow_resume` → a **NEW** subprocess PID was spawned (not an instant cache replay) and the run
   took **27s wall-clock** to complete with a **real 940-output-token essay**, not the instant `null`
   round-5 found. Closes REQ-006's 1st clause's "same final result as an uninterrupted run" promise.

3. **D-F11 (allowedTools curation) — code fix CONFIRMED WORKING; tool-use itself CONFIRMED a
   documented model-capability-tier gap, not a code gap, per D-F11's own binding two-stage
   instruction.** `ps aux` on a real spawned CLI subprocess confirms the curated flags are genuinely
   on the wire: `--allowedTools Read,Write,Bash --tools Read,Write,Bash --setting-sources=
   --strict-mcp-config`; real token usage dropped from round-5's ~4095 input tokens to ~1550-2016 —
   the curated payload is real and effective. **Re-ran round-5's exact write/read tool-use repros with
   this fix live**: a file-write prompt still produced no file anywhere on disk (model emitted
   fabricated JSON-shaped prose describing a `Write` call, never a real one); a file-read prompt
   against a real pre-placed file still returned fabricated content. A direct, read-only SDK `query()`
   probe (same curated options, bypassing the product's own gateway wrapper) confirms `num_turns:1`,
   no `tool_use` message ever emitted. This environment has no local Ollama model larger than 7B
   (`qwen2.5:7b`, `qwen2.5vl:7b`, `bge-m3` embedder — confirmed via `ollama list`/`/api/tags`) to try
   a more capable one against. **Per D-F11's own binding text**: "if a 7B-class model still cannot
   tool-use with a curated surface, record it HONESTLY... as a model-capability tier... a documented
   capability tier, NOT a code gap, and NOT a blocker." Recorded as exactly that below (VAL-003) —
   does not block the gate.

4. **New real evidence closing 2 previously-unverified-live clauses**: REQ-005's `bind:"0.0.0.0"`
   clause (unchanged since round 1, never independently re-run live in rounds 2-5) — freshly booted a
   dedicated instance with `RWE_BIND=0.0.0.0`, `ss -tlnp` confirmed `0.0.0.0:8799` listening, a real
   `curl` got HTTP 200. REQ-006's 3rd clause (`workflow_stop` + cached-prefix resume with an *edited*
   script) — no round since round 1 had re-demonstrated this live; fresh repro: `workflow_stop` on a
   run with a real in-flight `agent()` call killed the subprocess (~3-4s, confirmed via `ps -p`) and
   set status to `stopped`; `workflow_resume` with an edited script (2nd `agent()` prompt changed)
   correctly replayed the UNCHANGED 1st call from cache (identical token count, no new subprocess) and
   RE-RAN the changed 2nd call live (new `agentId`, new subprocess, real new content) — final result
   `{"a":"ALPHA","b":"GAMMA-EDITED"}`, genuinely reflecting the edited script.

5. **Re-confirmed unchanged this round, all with fresh repros against this round's own independent
   processes (not merely carried forward from round 5's narrative)**: D-F10a (bounded timeout, dedicated
   tight instance, 1.677s), D-F10b (agentType resolution), D-F10c (suspend kills subprocess), D-F5
   (alias/model forwarding, `is_error` handling), D-F6 (alias-aware thinking), D-F8 (live budget IPC),
   D-F9b/D-V2 (restart survival of agent records + named-workflow registry + suspended-run
   resumability), REQ-001 (return-value passthrough, determinism guard), REQ-002 (1-level nesting
   allowed / 2-level rejected, live budget accounting), REQ-004 (alias routing, no-paid-egress,
   unknown-alias validation-time rejection), REQ-013 (workspace isolation + `workflow_artifacts`,
   survives restart), REQ-014 (register/list/run-by-name, unknown-name error, version-update — a
   workflow updated mid-flight: prior run keeps `scriptVersion:"v1"`, new run picks up `"v2"`).

6. **Re-confirmed still open (unchanged, NOT REQ-blocking, both re-triggered live again this round)**:
   (a) `LiteLLMProxyManager`'s hard-coded port-4000 collision hazard — reproduced twice this round (a
   2nd/3rd server instance each spawned their own `litellm` subprocess with a *different* alias config,
   but `ss -tlnp` showed port 4000 was still held by the FIRST instance's orphan the whole time, i.e.
   every later instance's own health check silently passed against a stale proxy it never actually
   uses); (b) `main.ts`'s `SIGTERM`/`SIGINT` shutdown never stops the managed `litellm` subprocess
   (orphan re-confirmed after every one of this round's ~4 server instances, manually cleaned up).

7. **New minor (non-REQ-blocking) observation, logged for the v1.1 backlog**: an `AgentRecord` whose
   call was cut short by `workflow_suspend`/`workflow_stop` (D-F9a/D-F10c's abort path) never
   transitions to a terminal state of its own — it stays `"state":"running"` forever in
   `workflow_status`, alongside the NEW record for the live re-run that resume/a later call creates.
   This is cosmetic (the run's own final `result` is correct per D-F13 above, and no REQ acceptance
   clause requires an "aborted" state value) but could confuse a caller polling `workflow_status`
   post-abort. Not filed as a REQ-blocking red — see "v1.1 backlog" section below.

8. **Config-drift found and fixed this round (Gate 7.5 §4b)**: `rwe.config.example.json` already had
   the `defaultAllowedTools` key (added by the D-F11 implementation), but `DEPLOY.md`'s own §1b
   documented config table/JSON snippet never mentioned it — a real code-expects-a-key-docs-don't-
   mention gap. Fixed in this round's `DEPLOY.md` rewrite (see below).

### Real wiring used this round
Genuinely independent OS processes (`npm run start` / `npx tsx src/main.ts`, confirmed via
`ps aux`/`ss -tlnp`, reached by real HTTP `curl` from a separate shell, never the vitest in-process
harness), a real local Ollama (`qwen2.5:7b`, `http://localhost:11434`, no
`ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY` in this environment — same accepted gap as all
prior rounds, D-V3), a real `litellm[proxy]` Python subprocess under a pinned Python 3.12 `uv` venv
(D-R3, reused prior venv, re-confirmed healthy standalone), and a real
`@anthropic-ai/claude-agent-sdk` headless session spawning the real bundled `claude` CLI as its own
independent OS subprocess (`ps aux`: `.../claude-agent-sdk-linux-x64/claude --output-format
stream-json --verbose --input-format stream-json --thinking disabled --model local --allowedTools
Read,Write,Bash --tools Read,Write,Bash --setting-sources= --strict-mcp-config --permission-mode
bypassPermissions`). 5 separate server instances launched across this round (1 "normal" generous-
timeout config used for the bulk of functional evidence incl. 2 genuine `SIGTERM`+restart cycles on
the same workRoot, 1 dedicated tight-`timeoutMs` config on a separate port, 1 dedicated `bind:0.0.0.0`
config, 1 throwaway duplicate-alias-config instance used specifically to reproduce the port-4000
collision hazard). A direct SDK `query()` probe (bypassing the product's own gateway wrapper) was used
once, read-only, with the SAME curated `allowedTools`/`tools`/`settingSources`/`strictMcpConfig`
options the product itself now sets, to root-cause-confirm D-F11's tool-use finding — not shipped,
deleted after use, same convention as prior rounds' own throwaway probes.

## Superseded note (round 5, preserved for history)

Dispatched specifically to re-verify the D-F10 route-back (3 composition-root wiring gaps found at
round 4: `aliases`/`timeoutMs`/`retries` never forwarded into `ClaudeAgentSdkGatewayClient`;
`AbortController` never wired to the SDK's real cancellation hook; `agentDefinitionsDir` never
forwarded) against a genuine independent process. **All 3 D-F10 fixes are CONFIRMED FIXED FOR REAL
this round** (fresh repros below). Re-confirmed D-F6/D-F8/D-F9b/D-V2/D-V4/D-F5/D-F2 unchanged.

**This round also found 4 NEW real defects**, none previously flagged/raised in any prior round or
binding decision, all reproduced against fully real wiring (no SUT-boundary mocks):

1. **Tool-use loop never actually fires against the real local Ollama model (`qwen2.5:7b`) through
   the SDK-default gateway** — REQ-003's 1st (and most central) acceptance clause has never actually
   been demonstrated real, in any of the 5 validation rounds, on the only LLM backend available in
   this environment. Full repro/root-cause below (VAL-003). This directly touches the core rationale
   for D-F1/D1 (real SDK sessions over raw fetch specifically for tool-use capability).
2. **Per-agent `state` is never anything but `"done"`/`"failed"`** — `"queued"`/`"running"` (both
   part of the documented `AgentRecord.state` type) are never produced by any code path, so an
   in-flight agent is invisible in `workflow_status`/`workflow_agent_log` until it finishes. This
   breaks REQ-007's 1st acceptance clause literally (state should show queued/running/done/failed)
   and REQ-002's 2nd acceptance clause ("at most N agents run simultaneously, **observable via run
   status**" — there is nothing to observe mid-flight).
3. **`workflow_resume` after a `workflow_suspend` that aborted an in-flight `agent()` call replays
   the aborted `null` outcome from the journal cache instead of re-running the call live** — because
   the abort path journals `{value:null}` indistinguishably from a genuinely-completed
   terminal-error `null`, the resume-cache (correctly, per its own contract) treats it as a completed
   cache hit. This means resuming a suspended run can never actually recover the real result an
   uninterrupted run would have produced for the call that was in flight at suspend time — directly
   violating REQ-006's 1st acceptance clause's own promise ("only unfinished calls run live,
   producing the same final result as an uninterrupted run"). This is a new interaction surfaced
   specifically because D-F10(c)'s abort fix now genuinely kills the subprocess early (previously the
   real subprocess ran to natural completion in the background, so this exact interaction was
   unreachable before this round).
4. **Operational hazard, not REQ-blocking**: `LiteLLMProxyManager` always binds port 4000
   (hard-coded default, not derived from `ServerConfig`/`FileConfig`). Combined with the already-known
   orphan-litellm-on-shutdown limitation, a second server instance started while an orphan from a
   prior instance is still alive on port 4000 gets a **false-positive healthy boot**: its own
   `LiteLLMProxyManager.start()` health-checks `http://127.0.0.1:4000/health/liveliness`, which the
   **stale orphan** answers successfully, so the new instance silently proceeds believing its own
   freshly-generated alias config (`model_list` from its own current `aliases`) is in effect when it
   is actually talking to a different, possibly-differently-configured proxy process. Confirmed by
   direct repro this round (documented below).

Given (1)-(3) above, `gates.validation.passed` **stays `false`** this round — a 6th route-back is
recommended, this time scoped to the agent SDK's tool surface (restricting/verifying tool-calling
actually works against the local model, or documenting it as a real backend-capability gap), the
`AgentRecord` in-flight state gap, and the resume/journal distinguishability gap.

### Real wiring used this round
Genuinely independent OS processes (`npm run start` / `npx tsx src/main.ts`, confirmed via
`ps aux`/`ss -tlnp`, reached by a real HTTP client — `node` `fetch()`/`curl` from a separate shell,
never the vitest in-process harness), a real local Ollama (`qwen2.5:7b`, `http://localhost:11434`,
no `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GEMINI_API_KEY` in this environment — same accepted gap as
all prior rounds, D-V3), a real `litellm[proxy]` Python subprocess under a pinned Python 3.12 `uv`
venv (D-R3, reused prior venv, re-confirmed healthy standalone), and a real
`@anthropic-ai/claude-agent-sdk` headless session spawning the real bundled `claude` CLI as its own
independent OS subprocess (`ps aux`: `.../claude-agent-sdk-linux-x64/claude --output-format
stream-json --verbose --input-format stream-json --thinking disabled --model local
--permission-mode bypassPermissions`). 4 separate server instances launched across this round
(2 on the "normal" config incl. one genuine `SIGTERM`+restart cycle, 1 dedicated tight-`timeoutMs`
config, 1 throwaway `--detailed_debug` litellm instance for root-causing finding 1). A direct SDK
`query()` probe (bypassing the product's own gateway wrapper) was used once, read-only, to inspect
the raw message stream for root-causing finding 1 (not shipped, deleted after use, same convention
as rounds 3/4's own throwaway probes).

## Boot (round 6, documented steps only — this IS the Gate self-run; folded into DEPLOY.md §1/§2)

```bash
# 1. install deps (already present, confirmed up to date)
npm install

# 2. typecheck (sanity) — clean, 0 errors
npm run typecheck

# 3. pinned Python 3.12 for the litellm[proxy] subprocess (D-R3) — reused round-5's already-
#    provisioned venv (~/.rwe-litellm-venv), re-confirmed healthy standalone (litellm --version ->
#    1.90.2; /health/liveliness -> 200)
export PATH="$HOME/.rwe-litellm-venv/bin:$PATH"

# 4. config file (copied from the committed rwe.config.example.json, gateway defaults to "sdk" per
#    D1/D-F4/D-F5 — the MANDATED production default; no opt-out used for any of this round's
#    REQ-verifying evidence)
cp rwe.config.example.json rwe.config.json
# edited workRoot/port/timeoutMs per-instance for this round's specific repros (see below); all other
# keys (bind/gateway/agentDefinitionsDir/defaultAllowedTools/aliases) used exactly as shipped

# 5. start (real, independent OS process)
RWE_CONFIG_PATH=./rwe.config.json npm run start
# -> "[RunStore] hydrateAll: re-hydrated N run(s), ..."
# -> "[remote-workflow-engine] listening on http://127.0.0.1:8787/mcp (workRoot=...)"
# -> "[remote-workflow-engine] ready"
```
Healthcheck used throughout:
```bash
curl -s -X POST http://127.0.0.1:8787/mcp -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```
→ HTTP 200, `result.tools` lists **10** tools — confirmed on every one of this round's 5 independent
server instances.

**Doc gaps this round: none.** README.md/DEPLOY.md's documented steps remained sufficient to boot
with zero undocumented manual steps beyond ordinary test-harness hygiene (killing orphaned
`litellm`/`node` processes accumulated by this round's own repeated boot/kill/restart cycles — already
documented as the known orphan-process limitation, not a new doc gap). **One real config-DOC gap WAS
found and fixed this round** (not a boot blocker, but a real drift): `rwe.config.example.json` already
shipped `defaultAllowedTools` (from the D-F11 implementation) but `DEPLOY.md` §1b's own documented
config table/JSON snippet never mentioned this key — fixed in this round's DEPLOY.md rewrite (§4b
below has the full config-sync note).

**Instances launched this round**: 1 "normal" generous-timeout instance (`timeoutMs:120000`, port
8787) used for the bulk of functional evidence, including 2 genuine `SIGTERM`+restart cycles on the
same `workRoot` (one with a run mid-suspend to prove suspended-run-survives-restart, D-F13's context);
1 dedicated tight-timeout instance (`timeoutMs:1500,retries:0`, port 8788) for the D-F10a/REQ-004
4th-clause bound-enforcement repro; 1 dedicated `bind:0.0.0.0` instance (port 8799) for REQ-005's
2nd clause; 1 throwaway duplicate-alias-config instance used specifically to reproduce (twice) the
port-4000 collision operational hazard.

## Regression (automated suite, re-run this round, fresh — not trusted from narrative alone)
`npx vitest run`: 63 files / 206 tests — **204 pass / 2 fail**:
- `IT-015` (`tests/integration/claude-agent-sdk-session.test.ts`): the same pre-existing, documented,
  environment-specific nested-agent-host interception red carried unchanged from every prior round —
  this validator sandbox is itself a nested Claude Code host for that specific automated in-process
  test-harness shape; distinct from all real-process findings below, which reproduce via the actual
  product's own `main.ts` composition root, a different code path proven to work in this same
  environment (e.g. VAL-003/004/006's own real SDK sessions below).
- `IT-024` (`tests/integration/in-flight-agent-state.test.ts`, D-F12): flaked in this session — 5/6
  fails in one batch of runs, 2/3 passes in a smaller follow-up batch — a materially higher rate than
  the "~1-in-6" the D-F12 route-back documented, most likely because this session's own repeated
  concurrent `litellm`/`tsx` server instances (5 across this round) put unusually heavy load on the
  same host the test's real-subprocess IPC race is timing-sensitive to. **Overridden by direct
  production evidence**: item 1 above is a real HTTP + real subprocess + real Ollama repro of the
  EXACT behavior this test asserts (`"running"` observable mid-flight via `workflow_status`), run
  successfully multiple times this round with zero ambiguity. Treated as the same accepted
  IPC-delivery-race flake class `vitest.config.ts`'s own top-of-file comment documents for this
  codebase's real-child-process integration tests — not a product defect, not re-opened as a gap.
`npx tsc --noEmit`: 0 errors.

## Real-tier validation per REQ

### VAL-001 — real-run acceptance for REQ-001 (100% workflow JS API compatibility)
- **status:** green
- **traces:** REQ-001
- **tier:** acceptance
- **real:** true
- **result:** pass
- **iter:** v1
- **round-6:** re-confirmed unchanged, fresh repros against this round's own independent server
  process (`gateway:"sdk"`, port 8787):
  - `workflow_run {script:"return {answer:42, tags:['a','b']};"}` → `result` deep-equals
    `{"answer":42,"tags":["a","b"]}`.
  - `workflow_run {script:"return Date.now();"}` → `status:"failed"`,
    `error.code:"DETERMINISM_GUARD"`, `"Date.now() is not allowed inside a workflow script"`.
- **round-5:** re-confirmed unchanged, fresh repros against a genuinely independent server process
  (`gateway:"sdk"`, port 8787, real Ollama available but not needed for these clauses):
  - `workflow_run {script:"return {answer:42, tags:['a','b']};"}` → `result` deep-equals
    `{"answer":42,"tags":["a","b"]}`.
  - `args.name` reflected: `return args.name + ' says hi';` with `args:{name:'world'}` →
    `"world says hi"`.
  - `Date.now()` / `Math.random()` inside script → `status:"failed"`, `error.code:"DETERMINISM_GUARD"`.
  - `pipeline(['good','bad','also-good'], stage)` (stage throws on `'bad'`) →
    `["ok:good", null, "ok:also-good"]`, all 3 items complete.
  - `parallel([...])` with one throwing thunk → `["ok-1", null, "ok-3"]`, call itself never rejects.

### VAL-002 — real-run acceptance for REQ-002 (nesting / concurrency / budget)
- **status:** green
- **traces:** REQ-002
- **tier:** acceptance
- **real:** true
- **result:** pass
- **iter:** v1
- **round-7 (D-G8-6, budget-reservation concurrency): covered by the regression suite per this
  round's own scoping instruction, not independently re-run against a real process this round** —
  `tests/integration/parallel-budget-concurrency.test.ts` green in the fresh round-7 regression run;
  source-confirmed `src/run-guard.ts`'s `reserve()`/`releaseReserved()` (atomic full-remaining-budget
  reservation, no `await` between `assertBudget()` and `reserve()`) is genuinely called from
  `src/run-manager.ts`'s `_handleAgentRequest` around every real dispatch, `finally`-released. Not
  reclassified, not silently dropped — see ROUND 7 section above for the full scoping rationale.
- **round-6: 2nd clause (concurrency observability) — D-F12 CONFIRMED FIXED FOR REAL, flips VAL-002
  fully green.** Fresh repro, genuinely independent server process, real Ollama:
  `parallel([1,2,3].map(i=>async()=>{await agent('Reply with the single word OK',
  {model:'local',label:String(i)}); return i;}))` — polled `workflow_status` via real `curl` at
  t≈1.5s and t≈2.5s while `status:"running"` → **all 3 agents show `agentId:"agent-N"`,
  `label:"1"/"2"/"3"`, `state:"running"`** (previously `agents:[]`, empty, round-5's finding). Once
  the run completed, all 3 correctly show `state:"done"` with real per-agent token counts
  (`input:1550,output:12` each). Root cause confirmed fixed by code review
  (`src/run-manager.ts` `_handleAgentRequest`): the agentId is now allocated and
  `spawner.markQueued(...)` called BEFORE `entry.guard.acquireSlot()`, then `spawner.markRunning(...)`
  right after the slot is acquired — closing the gap where a record only ever appeared at
  call-resolution time. This closes REQ-002's own acceptance text ("at most N agents run
  simultaneously... **observable via run status**") for real. (Automated `IT-024`, which asserts this
  exact behavior with a concurrency:1 fake-gateway harness, flaked under this session's heavy host
  load — see Regression section above; overridden by this direct real-process repro.)
- **round-5: nesting and budget clauses CONFIRMED GREEN, real, fresh repros:**
  - 1-level nesting (allowed): registered `greet-child` (`return 'hello '+args.name`), ran
    `workflow('greet-child',{name:'nest-r5'})` from a top-level script → `"hello nest-r5"`.
  - 2-level nesting (rejected): registered `lvl2-child`/`lvl1-child` (`lvl1-child` itself calls
    `workflow('lvl2-child')`); running `workflow('lvl1-child')` from a top-level script →
    `error.code:"NESTING_ERROR"`, `"workflow() nesting is limited to one level"` — `lvl2-child` never
    reached (`lvl1-child`'s own return value never produced).
  - Budget (re-confirms D-F8 live IPC accounting yet again, unchanged): `budget:50`, script does
    `before={t:budget.total,s:budget.spent(),r:budget.remaining()}` then 2x real `agent()` calls
    against `model:'local'` → 1st call succeeds (consumes 4113 real tokens), 2nd call throws
    in-script: `"AGENT_ERROR: Budget exceeded: spent 4113 >= total 50"`; `after:{s:4113,r:-4063}` —
    live, real, server-side-accurate numbers, not a stub.
- **round-5 finding (2nd acceptance clause, concurrency observability) — FIXED, see round-6 note
  above. Original finding preserved for history:** launched
  `parallel([1,2,3].map(i=>async()=>{await agent('Reply with the single word OK',{model:'local'});
  return i;}))` (3 real concurrent Ollama `agent()` calls) and polled `workflow_status` at t≈2s
  while the run was still `"status":"running"` → `agents:[]` (empty). Only once the run reached
  `"completed"` did all 3 agent records appear, and every one of them had `"state":"done"` — never
  `"queued"` or `"running"` at any point during polling. Root cause confirmed by code
  (`src/agent-executor.ts` `AgentTranscriptSink.capture()`): a record is created for an `agentId`
  **only** at `capture()` time, i.e. only after the gateway call has already resolved (success or
  failure) — there is no code path that ever inserts a `"queued"`/`"running"` record when an
  `agent()` call is dispatched or in flight, even though `AgentRecord.state` (`src/types.ts`) is
  typed as `'queued' | 'running' | 'done' | 'failed'`. This means REQ-002's own acceptance text ("at
  most N agents run simultaneously... **observable via run status**") cannot actually be observed —
  there is no way to see how many agents are concurrently in flight from `workflow_status`, only how
  many have finished so far. (Concurrency itself IS enforced under the hood by `RunGuard`'s semaphore
  — the 3 calls above did all complete correctly and did not exceed any cap — but the ENFORCEMENT
  being correct is a different claim from the CAP being OBSERVABLE, which this acceptance clause also
  requires.)
- **Not independently re-verified this round (unchanged code, time-bounded):** the full N=14
  (`min(16, cpuCores-2)` on this 16-core sandbox)/1000-agent-cap stress values — round 1's own real
  repro of this remains the only direct evidence; not re-run this round given the concurrency
  *enforcement* itself isn't in question, only its *observability* (the new finding above).
- **Files/root cause:** `src/agent-executor.ts` `AgentTranscriptSink` — no `capture`-time-equivalent
  hook exists for "call dispatched"/"call in flight", only for "call resolved".

### VAL-003 — real-run acceptance for REQ-003 (real agent execution via Claude Agent SDK)
- **status:** green
- **traces:** REQ-003
- **tier:** acceptance
- **real:** true
- **result:** pass
- **iter:** v1
- **round-6: 1st clause (tool-use) — D-F11 code fix CONFIRMED WORKING; re-classified as an ACCEPTED
  MODEL-CAPABILITY-TIER GAP per D-F11's own binding two-stage instruction, not a code defect, does
  NOT block the gate.** `ps aux` on a real spawned CLI subprocess this round shows the curated flags
  genuinely on the wire: `--allowedTools Read,Write,Bash --tools Read,Write,Bash --setting-sources=
  --strict-mcp-config --permission-mode bypassPermissions`; real per-call input-token usage dropped
  from round-5's ~4095 to ~1550-2016 — the curated payload (previously dozens of tools incl. this
  shared host's own unrelated MCP plugin tools) is real, effective, and confirmed live in production.
  **Re-ran round-5's exact write/read probes against this fix, live:**
  - Write probe (`cwd-probe-r6.txt`, marker `ROUND6-MARKER`): completed with `result` =
    `{"name":"Write","arguments":{"file_path":"/cwd-probe-r6.txt","content":"ROUND6-MAKER"}}` — a
    filesystem-wide `find` still found **no such file anywhere**. Real per-call token usage this round
    (`input:1580,output:31`) confirms the curated (smaller) payload was genuinely used, yet the model
    still only emits fabricated JSON-shaped prose, never a real tool call.
  - Read probe (real file `probe-read-r6.txt` placed in the SDK session's own `cwd`, content
    `ROUND6-SECRET-VALUE-7734`): a direct, read-only SDK `query()` probe (same curated
    `allowedTools`/`tools`/`settingSources`/`strictMcpConfig` options the product itself now sets,
    bypassing only the product's own gateway wrapper) confirms `num_turns:1`, exactly one `assistant`
    message containing fabricated JSON text (`{"name":"Read","arguments":{"file_path":"/path/to/
    probe-read-r6.txt"}}`) — **no `tool_use` message of any kind is ever emitted**, identical to
    round 5's finding, now proven to persist even with the curated tool surface live.
  - This environment has no local Ollama model larger than 7B to try instead — confirmed via
    `ollama list`/`curl localhost:11434/api/tags`: only `qwen2.5:7b` (7.6B), `qwen2.5vl:7b` (8.3B,
    vision variant, same underlying capacity class), and `bge-m3` (an embedding model, not
    chat/tool-capable) are installed.
  - **Per D-F11's own binding text**: "FIX the fixable part... THEN re-test tool-use against the local
    model: if it fires, REQ-003 tool acceptance is real-verified; if a 7B-class model still cannot
    tool-use with a curated surface, record it HONESTLY in `08-validation.md` as a model-capability
    tier... a documented capability tier, NOT a code gap, and NOT a blocker." This is exactly that
    outcome. **Recommendation for the next real capability check**: try a local model specifically
    tuned/benchmarked for tool-calling reliability at a larger parameter count (e.g. `qwen2.5:32b`,
    `qwen2.5-coder:32b`, or `llama3.1:70b`-class if hardware allows), or verify against a paid
    Anthropic/OpenAI/Gemini model once credentials are available (D-V3's already-accepted gap — this
    finding is a DIFFERENT, additional capability question specific to tool-use, not yet answered for
    any paid provider either).
- **round-5: 2nd acceptance clause (agentType) — D-F10(b) CONFIRMED FIXED FOR REAL.** Fresh repro,
  genuinely independent server, `agentDefinitionsDir:"./agents"` (the committed example dir,
  `researcher.md`/`writer.md`):
  - Unknown type: `agent('hi',{agentType:'nonexistent_type_xyz',model:'local'})` → fails fast,
    `error.code:"SCRIPT_ERROR"`, `"Unknown agentType: nonexistent_type_xyz"` — no hang, resolved in
    well under 1s (the check happens before any gateway dispatch).
  - Known type: `agent('hi',{agentType:'researcher'})` (frontmatter `model: default` → anthropic, no
    credentials in this environment) → run **completes** (does NOT throw "Unknown agentType") with
    the agent resolving to `null` via the credential-less D-G terminal path (D-V3's accepted gap) —
    proving the definition genuinely resolved and reached the gateway, unlike round 4's repro where
    EVERY name (known or not) failed identically with "Unknown agentType". Confirms `main.ts`'s new
    `composeConfig()` now genuinely forwards `agentDefinitionsDir` into `createServer()`.
- **1st acceptance clause (tool-use) — round-5 finding, RE-CLASSIFIED round-6 as an accepted
  model-capability-tier gap per D-F11 (see round-6 note above). Original round-5 finding preserved for
  history, confirmed via 3 independent real repros against the real local Ollama model, in every prior
  round left as "not independently re-exercised" and never actually shown working on this backend:**
  1. **Write probe**: `agent("Write a file named cwd-probe-B.txt with the exact single-line content
     BETA-MARKER using your file write tool. After writing, reply with the word DONE.",
     {model:'local'})` → completed (`state:"done"`, real tokens `input:4095,output:34`) with
     `result` = `{"command":"write_file","file_path":"./cwd-probe-B.txt","content":"BETA-MARKER"}` —
     but `find` across the entire filesystem (workroot, repo, /tmp) found **no such file anywhere**.
     The model's final text merely *describes* a plausible tool invocation as JSON prose; no real
     `Write` tool call ever executed.
  2. **Read probe**: placed a real file `probe-read.txt` (content `GAMMA-SECRET-VALUE-9182`) directly
     in the SDK session's own `cwd`, then `agent("There is a file named probe-read.txt in your
     current working directory. Use your file read tool to read it, then reply with ONLY the exact
     contents of that file, nothing else.", {model:'local'})` → completed with `result` =
     `{"filename":"probe-read.txt","content":"This is some sample text used for probing the file
     reading functionality."}` — a **hallucinated, entirely fabricated** content string, not the real
     `GAMMA-SECRET-VALUE-9182` on disk. Conclusively proves no real file read occurred.
  3. **Root-caused via a direct, read-only SDK `query()` probe** (bypassing the product's own gateway
     wrapper entirely, same prompt as (2)): the raw message stream shows `num_turns:1` and exactly one
     `assistant` message (the same fabricated JSON text) — **no `tool_use` message of any kind is
     ever emitted** by the model. Separately confirmed the underlying model itself IS tool-calling
     capable: a direct `curl` to Ollama's own native `/api/chat` with a single simple `read_file` tool
     definition against the identical `qwen2.5:7b` correctly returned a real `tool_calls` response
     (`{"name":"read_file","arguments":{"path":"probe-read.txt"}}`). Root cause is therefore in the
     SDK-CLI-to-LiteLLM-to-Ollama integration specifically for THIS product's usage shape, most
     likely the sheer size/complexity of the full Claude Code CLI tool surface sent on every call
     (confirmed via LiteLLM's own `--detailed_debug` log: the outbound request legitimately includes a
     `tools` array covering dozens of tools — `Task`, `Bash`, `Read`, `Write`, `Edit`, `WebFetch`,
     several MCP plugin tools inherited from this **host** environment's own Claude Code
     configuration, etc. — a payload the SDK does not let the product's own gateway code restrict via
     any `allowedTools`/`disallowedTools` option today) overwhelming a 7B local model's tool-selection
     ability enough that it never attempts a call and instead free-associates a plausible-looking
     answer. Whether the fix is restricting `options.allowedTools` to a minimal per-agent-type set,
     or documenting this as a genuine local-small-model capability limitation, is a product decision
     for the next route-back — Gate 7.5 observes and reports, does not implement.
  - **This defect was never actually closed by any prior round** — rounds 2-4 all deferred this exact
    clause with variations of "not independently re-exercised this round, relies on round 1/2's own
    real proof" but no round's `08-validation.md`/journal entry ever actually contains a real,
    successful repro of tool-use file I/O against the real local Ollama backend (the only backend
    available in this environment); the only automated-test attempt at this (`IT-015`) targets a
    LOCAL STUB `/v1/messages` server, not a real model, and is itself the pre-existing
    environment-specific red in every regression run to date.
- **3rd acceptance clause (terminal error → null) — unchanged, confirmed still correct** (D-F5,
  re-confirmed rounds 3/4, code untouched, and independently exercised again this round via the
  agentType/no-credentials repro above, which also resolves to `null` on the terminal path).
- **Files/root cause (1st clause):** `src/gateway/claude-agent-sdk-client.ts` — `options` passed to
  `query()` never restricts the tool surface (no `allowedTools`/`disallowedTools`); likely compounded
  by this being a shared host environment whose own Claude Code config injects irrelevant
  plugin/MCP tools into every session regardless of product need.

### VAL-004 — real-run acceptance for REQ-004 (multi-model routing via alias/gateway)
- **status:** green
- **traces:** REQ-004
- **tier:** acceptance
- **real:** true
- **result:** pass
- **iter:** v1
- **round-7 (D-G8-4, zero-config timeout fallback) — CONFIRMED, extends the 4th clause (bounded
  timeout) to the zero-config deployment shape for the first time.** Prior rounds (round 5/6 above)
  only proved the bound with an EXPLICIT `timeoutMs` in `rwe.config.json`; this round specifically
  targeted the "no config file at all" default `main.ts` path, which — before D-G8-4 — had NO bound of
  its own on this path and could hang forever against a dead provider. Real zero-config server (no
  `rwe.config.json` present) against a genuinely unresponsive raw-TCP peer (see ROUND 7 section above
  for the full construction/evidence) → real `agent()` call resolved (`result:null`, never smuggled
  success) in 5.2s real wall-clock, run reached `status:"completed"`, **never hung**; a direct
  mechanism-level check of the real (unmocked) `composeConfig()` + `ClaudeAgentSdkGatewayClient`
  composition-root code confirms the resolved `timeoutMs` is genuinely `15000` (not `undefined`) in
  this exact zero-config shape, and a forced-hung session is bounded to 15014ms real elapsed via that
  same real code. Full detail in the ROUND 7 section above.
- **round-6:** re-confirmed unchanged, fresh repros against this round's own independent processes:
  - 4th clause (bounded timeout), dedicated tight instance (port 8788, `timeoutMs:1500,retries:0`,
    copied verbatim from `rwe.config.example.json` with only `port`/`workRoot`/`timeoutMs`/`retries`
    edited): `agent('Write a two sentence description of the color blue.',{model:'local'})` measured
    via shell `time` → **1.677s wall-clock**, `state:"failed"`, `result:null` — consistent with
    round-5's 1.74s.
  - 3rd clause: `agent(prompt,{model:'nonexistent-alias-xyz'})` → rejected at submission,
    `error.code:"UNKNOWN_ALIAS"`.
  - 1st/2nd clauses: `agent(prompt,{model:'local'})` → `workflow_status.agents[0]` =
    `{provider:"claude-agent-sdk",model:"local",tokens:{input:1547,output:12}}` (real nonzero Ollama
    token usage, curated-tool-surface-reduced input size vs round 5's 4095, consistent with D-F11).
  - **New this round**: while starting the tight-timeout instance, reproduced the port-4000 collision
    operational hazard live (see round-6 summary item 6a) — not a REQ-004-blocking finding (the
    `local` alias resolved identically either way in this repro since both proxy instances had the
    same alias mapping), but confirms the hazard is real and unrelated to gateway-client-level
    correctness.
- **round-5: 4th acceptance clause (bounded timeout+retry) — D-F10(a) CONFIRMED FIXED FOR REAL. This
  flips VAL-004 to fully green for the first time.** Dedicated fresh server instance (port 8788,
  `timeoutMs:1500, retries:0` in `rwe.config.json`, read via the documented `composeConfig()` path),
  real Ollama: `agent('Write a two sentence description of the color blue.',{model:'local'})` →
  completed in **1.74s wall-clock** (measured via shell `time`) with `state:"failed"`, `result:null`
  — correctly bounded to ~the configured 1.5s, not the ~16-57s a real completion takes (see VAL-003's
  essay-generation timings for comparison). This is the same class of repro that found the bug in
  round 4 (16.32s, 10x over bound) — now genuinely fixed via `main.ts`'s `composeConfig()` forwarding
  `timeoutMs`/`retries` into the constructed `ClaudeAgentSdkGatewayClient`.
- **1st/2nd clauses (alias→provider routing observable; local-only, no paid egress, budget
  accounted) — re-confirmed unchanged:** `agent(prompt,{model:'local'})` → `workflow_status.agents[0]`
  = `{provider:"claude-agent-sdk", model:"local", tokens:{input:4095,output:...}}`, real nonzero
  Ollama-sourced token usage, no paid-provider traffic for a local alias (confirmed via the same
  litellm access pattern as prior rounds — only Ollama backend hit).
- **3rd clause (default alias fallback; unknown alias validation-time error) — re-confirmed, fresh
  repro:** `workflow_run{script:"agent(prompt,{model:'nonexistent-alias-xyz'})"}` → rejected
  **at submission**, before any run starts: `runId:""`, `error.code:"UNKNOWN_ALIAS"`,
  `"Unknown model alias: nonexistent-alias-xyz"` — never a mid-run failure.
- **Per D-V3 (carried forward, not re-raised):** paid-provider success path remains real-unverified
  (no credentials in this environment) — not the reason any clause is red; there are none red this
  round.

### VAL-005 — real-run acceptance for REQ-005 (MCP Streamable HTTP interface)
- **status:** green
- **traces:** REQ-005
- **tier:** acceptance
- **real:** true
- **result:** pass
- **iter:** v1
- **round-7 (D-G8-3, real `tools/list` metadata) — CONFIRMED, real HTTP round trip against a real
  zero-config server.** `curl -X POST .../mcp {"method":"tools/list"}` → HTTP 200, all 10 tools now
  carry real per-tool `description` strings (not the tool's own name repeated) and real
  `inputSchema.properties`/`required` mirroring each tool's actual argument shape (e.g.
  `workflow_agent_log` documents `required:["runId","agentId"]`, `workflow_run` documents
  `name`/`script`/`args`/`budget`). `workflow_list`'s correctly-empty `properties:{}` (genuinely
  zero-parameter, `04-design.md:45`) is honest, not a placeholder — see ROUND 7 section above and the
  Regression section's `IT-028` test-defect note. Closes the ARCH-001 consumability finding (07-
  review.md C-1) an MCP client previously could not learn a tool's real argument shape from.
- **round-6: `bind:"0.0.0.0"` clause — freshly real-verified live for the first time since round 1**
  (rounds 2-5 all left it as "unchanged since round 1, not independently re-run this round"). Fresh
  dedicated instance: `RWE_BIND=0.0.0.0 RWE_PORT=8799 npx tsx src/main.ts` → log confirms
  `"listening on http://0.0.0.0:8799/mcp"`; `ss -tlnp` confirms `LISTEN ... 0.0.0.0:8799`; a real
  `curl -X POST http://127.0.0.1:8799/mcp` (`tools/list`) → HTTP `200`. Also re-confirmed
  `bind:"127.0.0.1"` (default) loopback-only on all 5 of this round's other instances; `workflow_run`→
  `workflow_result` async round trips exercised dozens of times this round (see VAL-001/002/003/004/
  006/013/014 evidence, all against this same real HTTP surface, real `tools/call` JSON-RPC dispatch,
  the same 10-tool `tools/list` on every instance).
- **round-5:** re-confirmed unchanged — `tools/list` returned the same 10 tools on all 4 independent
  server instances this round; `bind:"127.0.0.1"` (default) confirmed loopback-only on every instance;
  `workflow_run`→`workflow_result` async round trips exercised dozens of times this round (see
  VAL-001/002/003/004 evidence, all against this same real HTTP surface, real `tools/call` JSON-RPC
  dispatch). `0.0.0.0` remote-reachability unchanged since round 1 (code untouched), not
  independently re-run live this round (time-bounded).

### VAL-006 — real-run acceptance for REQ-006 (suspend / resume / stop lifecycle)
- **status:** green
- **traces:** REQ-006
- **tier:** acceptance
- **real:** true
- **result:** pass
- **iter:** v1
- **round-6: 1st clause's resume-after-abort half — D-F13 CONFIRMED FIXED FOR REAL. This flips VAL-006
  fully green.** Real repro, continuing round-5's exact scenario:
  1. Started a real ~57s-class essay-generation `agent()` call (`"history of tea..."`, `model:'local'`)
     via the SDK-default gateway. `ps aux` confirmed the spawned `claude` CLI subprocess alive
     (PID recorded), curated flags visible (`--allowedTools Read,Write,Bash ...`).
  2. `workflow_suspend(runId)` at t≈2s → `{"status":"suspended"}` in ~0.04s. `ps -p <pid>` confirmed
     the subprocess dead by t≈4s (within ~2s of suspend) — re-confirms D-F10(c) unchanged.
  3. `workflow_resume(runId)` → `{"status":"running"}`. **A NEW subprocess PID was spawned within ~2s**
     (confirmed via `ps aux` — a genuinely different PID from the aborted call's), proving this is a
     live re-run, not a cache replay.
  4. Polled to completion: **27s wall-clock** elapsed from resume to `"status":"completed"`, with
     `agents:[...,{state:"done",tokens:{input:1574,output:940}}]` — a real 940-output-token essay
     (full text captured in this round's raw evidence, a genuine multi-paragraph history-of-tea essay,
     not a fabrication/placeholder), **not** the instant `null` round-5's finding produced.
  5. Root cause of the fix confirmed by code (`src/run-manager.ts` `_handleAgentRequest` /
     `src/resume-cache.ts`): `JournalEntry` now carries `aborted:boolean`, set only when
     `outcome.kind==='null' && outcome.aborted===true` (the 2 real abort-return sites in
     `AgentExecutor.run()`) — never for a genuine terminal/schema-exhaustion null. `ResumeCache.Plan
     .replay()` now treats an `aborted` entry as a cache MISS exactly like a missing/changed-key entry,
     forcing the genuine live re-run observed above.
  - **Minor cosmetic observation (not REQ-blocking, v1.1 backlog)**: the ABORTED call's own
    `AgentRecord` (`agent-1` in this repro) never transitions out of `"state":"running"` — it stays
    stuck forever in `workflow_status.agents[]` alongside the NEW record the live re-run creates
    (`agent-2`). The run's own final `result` is correct (per step 4 above) and no REQ acceptance
    clause requires an "aborted" state value, but this could visually confuse a caller polling
    `workflow_status` post-abort. See "v1.1 backlog" section below.
- **round-6: 3rd clause (`workflow_stop` + cached-prefix resume with an EDITED script) — freshly
  real-verified for the first time since round 1** (rounds 2-5 all left this as "not independently
  re-exercised, time-bounded"). Fresh repro, genuinely independent server process:
  1. `workflow_run` with a 2-call script: `a=agent('...ALPHA...',{label:'a'})` then
     `b=agent('...400-word chocolate essay...',{label:'b'})`. Polled until `a` shows `state:"done"`
     and `b` shows `state:"running"` (genuinely in flight, confirmed via `ps aux` for the spawned
     subprocess).
  2. `workflow_stop(runId)` → `{"status":"stopped"}`. Polled `ps -p <pid>`: the subprocess died ~3-4s
     after the stop call (not instantly like suspend, but conclusively an early cancellation — a real
     400-word essay generation naturally takes far longer than 3-4s, consistent with this round's own
     essay-generation timings elsewhere in this document).
  3. `workflow_resume(runId, {script: <EDITED: same 'a' prompt, DIFFERENT 'b' prompt ("...GAMMA-
     EDITED...")>})` → the unchanged `a` call replayed from cache (identical `agentId:"agent-1"`,
     identical token count `input:1550,output:8`, no new subprocess spawned for it) while the changed
     `b` call re-ran LIVE (**new** `agentId:"agent-3"`, new subprocess, real new tokens
     `input:1554,output:12`). Final `workflow_result.result` =
     `{"a":"{\"name\":\"ALPHA\"}","b":"{\"name\":\"GAMMA-EDITED\"}"}` — genuinely reflects the edited
     script's new content for `b`, while `a`'s value is unchanged from the original run. This is
     conclusive real evidence of cached-prefix resume semantics (unchanged prefix replays, changed
     call + everything after runs live).
  - Same minor cosmetic finding as above: the original interrupted `b` call's own record
    (`agent-2`) stays stuck at `"state":"running"` forever (v1.1 backlog, not blocking).
- **round-6: 2nd clause (suspended run survives restart) — re-confirmed with a fresh, genuinely
  independent restart this round** (distinct from round-5's own restart, and from VAL-015's separate
  restart below): started a real ~57s essay-generation call, suspended it at t≈2s (subprocess
  confirmed dead), sent a real `SIGTERM` to the whole server process, confirmed clean shutdown via the
  log line + `ps aux` (no `node`/`tsx` remained), started a genuinely fresh `npm run start` on the
  SAME `workRoot` → `workflow_status` for the run still returned `"status":"suspended"`. Called
  `workflow_resume` post-restart → a real live re-run occurred (new subprocess, 614 real output
  tokens over the following poll cycle) and completed successfully — confirms D-F13's fix (journaled
  `aborted:true`) itself survives a restart via the persisted journal, not just in-process state.
- **round-5: 1st clause ("in-flight agents are stopped") — D-F10(c) CONFIRMED FIXED FOR REAL, closes
  the round-4 finding.** Real repro:
  1. Started a real, slow generation (`"Write a very detailed 500 word essay about the history of
     tea..."`, `model:'local'`) via the SDK-default gateway. `ps aux` at t≈2s confirmed the spawned
     `claude` CLI subprocess (PID recorded) alive, `--thinking disabled --model local` flags visible.
  2. Called `workflow_suspend(runId)` at t≈2s → `{"status":"suspended"}`, returned in 0.109s.
  3. Polled `ps -p <pid>` every 2s: the subprocess was **already gone by the very next check
     (t≈4s from launch, i.e. within ~2s of the suspend call)** and stayed gone for the remaining
     14s of polling.
  4. **Control run** (identical prompt, no suspend, same server instance): natural completion
     measured at **56.79s wall-clock**. The suspended run's subprocess died at roughly 1/25th of the
     natural completion time — conclusively an actual early cancellation, not natural completion
     (contrast with round 4's finding, where the subprocess lifetime matched the natural ~16s
     completion almost exactly, proving it was NOT cancelled).
  - Confirms `ClaudeAgentSdkGatewayClient._invokeOnce` now genuinely assigns its `AbortController` to
    the SDK's real `Options.abortController` (D-F10(c)/IMPL-046), and that this wiring survives
    unchanged through to the real product entrypoint.
- **round-5 finding — FIXED round-6 (D-F13), see round-6 note above. Original finding preserved for
  history:** only reachable now that finding 1 above is fixed (previously the
  subprocess ran to natural completion in the background regardless, masking this): `workflow_resume`
  on a run whose in-flight `agent()` call was aborted by suspend replays the journaled `null` from the
  cache instead of re-running the call live. Real repro (continuing from the same suspended run
  above): `workflow_resume(runId)` → returns `{"status":"running"}` then **immediately**
  `{"status":"completed"}` (well under 1s, no real inference time elapsed) with
  `workflow_result.result === null`. Root cause confirmed via the run's own on-disk `journal.jsonl`:
  the abort path journals `{"callSeq":0,"key":{"prompt":"...","opts":{"model":"local"}},"value":null,
  ...}` — indistinguishable, in the journal's own schema, from a genuinely-completed
  terminal-provider-error `null` (REQ-003's 3rd acceptance clause's own legitimate `null`). The
  resume-cache correctly (per its own documented contract: "same script + same args → 100% cache
  hit") treats ANY journaled entry for that `(prompt,opts)` key as a completed result and replays it,
  with no way to know this particular one was actually cut short mid-flight and never really ran.
  This means the resumed run's final result is **permanently `null`**, never the real essay text an
  uninterrupted run produces (see VAL-003/004's own real completions for comparison) — directly
  contradicts REQ-006's own acceptance text: "only unfinished calls run live, producing the **same
  final result as an uninterrupted run**."
- **evidence (what still works, real, unchanged):** suspend/resume/stop status transitions themselves
  are correct and durable (`running`→`suspended`→`running`→`completed` all observed); a suspended run
  can be resumed and reaches a terminal state without hanging.
- **round-5 note, both items closed round-6 (see round-6 notes above), preserved for history — "Not
  independently re-exercised this round (unchanged since round 1, time-bounded)":**
  suspended-run-survives-a-real-restart; `workflow_stop` + cached-prefix resume with an edited
  script.
- **direct-fetch path's identical, previously-known suspend-cancel gap**: unit-tested fixed
  (`UT-023`) per D-F10(c)'s own scope, but not independently re-run live this round (no real
  paid-provider or reachable non-Ollama-fetch target available to reproduce against; time-bounded,
  same boundary as prior rounds).
- **Files/root cause:** `src/gateway/claude-agent-sdk-client.ts` (finding 1, now fixed); the
  resume-cache/journal schema (`src/resume-cache.ts` / `src/run-store.ts` journal writer, likely
  `src/agent-executor.ts`'s abort-outcome handling) — no field distinguishes "genuinely completed
  with null" from "aborted before completion", finding 2 (new).

### VAL-007 — real-run acceptance for REQ-007 (per-agent observability)
- **status:** green
- **traces:** REQ-007
- **tier:** acceptance
- **real:** true
- **result:** pass
- **iter:** v1
- **round-7 (D-G8-2, real message/tool event capture) — CONFIRMED, `workflow_agent_log` now returns a
  real reasoning trace, not just the terminal `usage` summary.** Real config boot (documented deploy
  flow, real local Ollama `qwen2.5:7b` via `local` alias). Real `agent("Reply with only the word:
  PONG", {model:"local"})` → `workflow_agent_log` returned **2 real, ordered events**: a `"message"`
  kind event (`{"type":"text","text":"{\"name\": \"PONG\"}"}`) followed by the terminal `"usage"`
  event — previously (per round-5/6's own narrative) `_drain` discarded every non-terminal message,
  only the final `usage` summary was ever visible. A 2nd real repro with a tool-shaped prompt again
  captured a real `"message"` event; no `"tool_call"`/`"tool_result"` kind was observed, consistent
  with (not a re-litigation of) the already-accepted D-F11 model-capability-tier gap — `qwen2.5:7b`
  never emits a genuine SDK `tool_use` message even with the curated tool surface, so
  `extractEvents()` never has one to classify. Full detail in the ROUND 7 section above (this section
  also referenced from VAL-003's D-F11 discussion). Closes REQ-007's "returns the agent's real
  reasoning/tool trace" half of the 2nd (transcript readback) clause.
- **round-6: 1st clause ("state (queued/running/done/failed)") — D-F12 CONFIRMED FIXED FOR REAL. This
  flips VAL-007 fully green.** See VAL-002's full round-6 repro above (same underlying fix, both REQs'
  acceptance text reference the same `workflow_status.agents[].state` field) — a real 3-agent
  `parallel()` against real Ollama showed `"state":"running"` for all 3 agents while genuinely
  in-flight, transitioning correctly to `"done"` on completion.
- **round-6: 2nd clause (transcript readback) — re-confirmed, fresh, including across this round's own
  genuine restart**: `workflow_agent_log` for a pre-restart real agent (`agent-1`, from the
  tool-use write-probe run) returned its real persisted usage transcript event
  (`{"kind":"usage","data":{"tokens":{"input":1580,"output":31},"provider":"claude-agent-sdk",
  "model":"local"}}`) both before AND after this round's server restart, unchanged.
- **round-5: 2nd clause (transcript for a completed agent) — re-confirmed green, real, including
  across a genuine restart** (see VAL-015 restart repro — pre-restart `agent-1`'s transcript
  correctly returned post-restart, unchanged from round 4's own proof, re-verified fresh this round).
- **round-5 finding — FIXED round-6 (D-F12), see round-6 note above. Original finding preserved for
  history — 1st clause ("state (queued/running/done/failed)")**: see VAL-002's full round-5
  repro/root-cause above (same underlying gap, both REQs' acceptance text reference the same
  `workflow_status.agents[].state` field) — only `"done"`/`"failed"` are ever actually produced;
  `"queued"`/`"running"` are declared in the type (`src/types.ts` `AgentRecord.state`) but no code
  path ever emits them, so an in-flight agent is invisible until it finishes.
- **Files/root cause (now fixed):** `src/agent-executor.ts` `AgentTranscriptSink` (same as VAL-002),
  `src/run-manager.ts` `_handleAgentRequest` (the fix).

### VAL-013 — real-run acceptance for REQ-013 (per-workflow work folder / per-run workspace)
- **status:** green
- **traces:** REQ-013
- **tier:** acceptance
- **real:** true
- **result:** pass
- **iter:** v1
- **round-6:** re-confirmed via the real HTTP `workflow_artifacts` MCP tool: a completed run's real
  on-disk workspace directory (`$workRoot/workflows/_adhoc/runs/<runId>/`) was located, a file
  (`manual-r6.txt`) placed directly into it → `workflow_artifacts{runId}` → `["manual-r6.txt"]`. Also
  re-confirmed this survives a genuine restart this round (same repro as VAL-015 below, plus a direct
  `workflow_artifacts` call post-restart on a pre-restart run → still returns the correct listing).
- **Latent gap flagged by VAL-003 (round 5), status unchanged this round — still masked, NOT
  independently re-verified as fixed or unfixed** (VAL-003's 1st clause remains a real gap that was
  RE-CLASSIFIED round-6 as an accepted model-capability-tier limitation, not a code fix — so this
  latent interaction is still masked exactly as round 5 described, not resolved): `Claude
  AgentSdkGatewayClient`'s own `cwd` is fixed once at construction from `config.workRoot`, not the
  per-run workspace directory. If/when a more tool-use-capable model is used, this would need
  re-checking before relying on REQ-013's per-run isolation guarantee for agent-performed file I/O
  specifically (manually-placed/`workflow_artifacts`-listed files, which don't go through the SDK's
  own tool loop, are unaffected and correctly isolated per the round-6 repro above).
- **round-5:** re-confirmed via the real HTTP `workflow_artifacts` MCP tool (present in the live
  10-tool `tools/list`, dispatched via real `tools/call`): a completed run's real on-disk workspace
  directory (`$workRoot/workflows/_adhoc/runs/<runId>/`) was located, a file (`manual.txt`) placed
  directly into it → `workflow_artifacts{runId}` → `["manual.txt"]`, genuinely reflecting on-disk
  state; a run that never wrote anything → `[]`. Distinct workflows/runs get distinct, non-overlapping
  workspace paths (confirmed by directory listing across the ~25 runs created this round, one
  subdirectory per `runId`, none shared).
- **Related latent gap surfaced by this round's VAL-003 finding (not independently REQ-blocking today
  because it's currently masked, but flagged for transparency):** `ClaudeAgentSdkGatewayClient`'s own
  `cwd` (the directory its real SDK session's file tools would be rooted in, if tool-use worked) is
  fixed **once at construction** from `config.workRoot` — the server-wide root — not the per-run
  workspace directory `RunManager` computes via `this._catalog.runWorkspace(...)`. Confirmed by code
  review: `AgentReq.workspace` (`src/agent-executor.ts`) is computed per-call but never passed into
  `gateway.invoke(req)` (`src/agent-executor.ts` around the `invokePromise` call site), and
  `main.ts`/`server.ts` construct exactly one shared `GatewayClient` instance for the whole process,
  not one per run. Today this has **no observable effect** because VAL-003's finding means the SDK's
  file tools never actually execute at all — but if/when tool-use is fixed, agent-performed file I/O
  would land in the shared server work root, not the isolated per-run workspace REQ-013's 1st
  acceptance clause requires ("a file written by run A is not visible to a concurrently running run
  B's workspace" — they'd actually share a directory). Recommended to fix alongside VAL-003's finding
  in the next route-back, not filed as its own separate REQ-blocking red since it produces no
  currently-observable acceptance failure (masked by VAL-003).

### VAL-014 — real-run acceptance for REQ-014 (named workflow registry)
- **status:** green
- **traces:** REQ-014
- **tier:** acceptance
- **real:** true
- **result:** pass
- **iter:** v1
- **round-6:** re-confirmed with fresh repros, including the version-update clause (not independently
  re-exercised live in rounds 2-5): `workflow_register{name:"ver-test-r6",script:"return
  'v1-content';"}` → `version:"v1"`; ran it → `result === "v1-content"`,
  `workflow_status.scriptVersion === "v1"`. Re-registered the SAME name with different content →
  `version:"v2"`; ran it again → `result === "v2-content"`, new run's `scriptVersion === "v2"`, while
  the FIRST (pre-update) run's own `workflow_status.scriptVersion` **stayed `"v1"`** — confirms
  "prior runs' journals still reference the version they ran with". Also re-confirmed 1-level
  nesting/2-level rejection (see VAL-002 above), unknown-name error
  (`workflow('does-not-exist-r6')` → `error.code:"NESTING_ERROR"`,
  `"Workflow not found in catalog: does-not-exist-r6"`).
- **round-5:** re-confirmed with fresh repros — `workflow_register{name:"greet2",script:"return
  'hi';"}` → real registration (`version:"v1"`); `workflow_list` shows it (`kind:"workflow"`)
  alongside run summaries (`kind:"run"`), visible **before** any run of it, per D-I9's flat
  kind-discriminated array; `workflow_run{name:"greet2"}` → `result === "hi"`; unknown name
  (`workflow('does-not-exist-xyz')` from inside a script) → catchable error,
  `error.code:"NESTING_ERROR"`, `"Workflow not found in catalog: does-not-exist-xyz"`.

### VAL-015 — real-run acceptance for REQ-014 (registry survives a real server restart, D-V2)
- **status:** green
- **traces:** REQ-014
- **tier:** acceptance
- **real:** true
- **result:** pass
- **iter:** v1
- **round-6:** re-confirmed with a fresh, genuinely independent restart this round (2 separate real
  restarts, in fact — one general, one specifically with a suspended run in flight, see VAL-006 above).
  General restart: pre-restart state 12 runs + 3 registered workflows (`greet-child-r6`,
  `lvl2-child-r6`, `lvl1-child-r6`) on one server instance (port 8787). Sent `SIGTERM`; confirmed via
  log line (`received SIGTERM, shutting down...`) + `ps aux` (no `node`/`tsx` remained, though the
  managed `litellm` subprocess DID remain — known orphan limitation, unchanged, re-confirmed). Started
  a genuinely fresh `npm run start` on the SAME `workRoot` → log: `hydrateAll: re-hydrated 12 run(s)`.
  Post-restart: `workflow_list` still showed all 3 workflows; `workflow_run{name:"greet-child-r6",
  args:{name:"post-restart-r6"}}` → `result === "hello post-restart-r6"` (genuinely resolved by name
  from the SQLite-persisted catalog, not a re-registration); pre-restart real agent run's
  `workflow_status`/`workflow_agent_log` both still correct (see VAL-007 above).
- **round-5:** re-confirmed with a fresh, genuinely independent restart this round. Pre-restart state:
  20 runs + 4 registered workflows (`lvl2-child`, `lvl1-child`, `greet-child`, `greet2`) on one server
  instance (port 8787). Sent `SIGTERM`; confirmed via `ps aux`/log line
  (`[remote-workflow-engine] received SIGTERM, shutting down...`) the process shut down gracefully;
  confirmed via `ps aux` no `node`/`tsx` process remained (the managed `litellm` subprocess DID remain
  — the known, unchanged orphan-process limitation, see below). Started a genuinely fresh
  `npm run start` on the SAME `workRoot` → log: `hydrateAll: re-hydrated 20 run(s)`. Post-restart:
  - `workflow_status` for a pre-restart real agent run → `agents:[{agentId:"agent-1",state:"done",
    provider:"claude-agent-sdk",model:"local",tokens:{input:4095,output:34}}]` — still correct.
  - `workflow_agent_log` for that same agent → real transcript event, not `AGENT_NOT_FOUND`.
  - `workflow_list` → all 4 pre-restart workflows still present.
  - `workflow_run{name:"greet2"}` (post-restart) → `result === "hi"` — genuinely resolved by name
    from the SQLite-persisted catalog after restart, not a re-registration.

## D-F11/D-F12/D-F13 route-back (this round's mandate) — outcome

- **D-F12 (in-flight state) — CONFIRMED FIXED FOR REAL.** See VAL-002/VAL-007 above. `queued`/
  `running` states are now genuinely observable via `workflow_status` mid-flight against a real
  process + real Ollama.
- **D-F13 (resume-after-abort fidelity) — CONFIRMED FIXED FOR REAL.** See VAL-006 above. A suspended
  run's aborted call now genuinely re-runs live on resume (27s wall-clock, real 940-token essay),
  not an instant `null` replay.
- **D-F11 (allowedTools curation) — code fix CONFIRMED WORKING; outcome is the documented
  model-capability-tier finding the instruction's own two-stage judgment anticipated, NOT a code gap,
  NOT a blocker.** See VAL-003 above. The curated tool surface is genuinely on the wire (confirmed via
  `ps aux` + reduced real token usage) but `qwen2.5:7b` still never emits a `tool_use` message through
  this SDK-CLI-to-LiteLLM-to-Ollama integration path, even with the curated surface. No larger local
  model is available in this environment to try instead.

Per the binding CONVERGENCE RULE, with all 3 of this round's mandated findings resolved (2 code-fixed
+ re-verified real, 1 correctly reclassified as an accepted capability-tier gap) and every other v1
REQ acceptance clause holding fresh real evidence this round, **`gates.validation.passed` flips to
`true`**.

## D-F10 route-back (prior round) — all 3 findings re-confirmed unchanged this round
See VAL-003 (agentType/finding b), VAL-004 (timeout/finding a), VAL-006 (abort/finding c) above for
full repro detail. Summary: `src/main.ts`'s `composeConfig()` now genuinely forwards
`aliases`/`timeoutMs`/`retries` into the constructed `ClaudeAgentSdkGatewayClient` (real 1.74s-bounded
repro, was 16.32s/unbounded), and `agentDefinitionsDir` into `createServer()` (real agentType
resolution repro, was permanently "Unknown agentType"); both `ClaudeAgentSdkGatewayClient` and
`LiteLLMGatewayClient` now wire their local `AbortController` to their real cancellation hook (real
sub-2s subprocess death on suspend, was running to the full ~16-57s natural completion).

## Previously-confirmed-fixed, re-confirmed unchanged this round
D-F10a/b/c (timeout binding, agentType resolution, suspend-kills-subprocess — all re-confirmed via
fresh repros on this round's own instances, see VAL-003/004/006 above), D-V4 (Ajv schema validation —
not independently re-exercised with a real schema this round, time-bounded; unchanged code, confirmed
green at unit tier in the regression run), D-V6 (real transcript read-back — re-confirmed via
VAL-007/015 above), D-V7/D-R4 (`workflow_artifacts` real MCP tool + `scriptVersion` fidelity —
re-confirmed via VAL-013/014 above, incl. a fresh version-update repro this round), D-V2 (SQLite
catalog persistence — re-confirmed via VAL-015), D-F5 (SDK alias/model forwarding + `is_error`
handling — re-confirmed via VAL-004's alias-routing evidence and every successful/failed real Ollama
round trip this round), D-F6 (alias-aware thinking policy — every real SDK subprocess this round
showed the live `--thinking disabled` flag for the `local` alias, no 400 errors from Ollama), D-F8
(live budget IPC — re-confirmed via VAL-002's budget repro), D-F9b (per-agent records survive
restart — re-confirmed via VAL-007/015).

## Round-5 findings, this round's outcome (see VAL-002/003/006/007 above for full repro/root cause)
1. Tool-use (Read/Write) never actually fires against the real local Ollama model through the
   SDK-default gateway (REQ-003 1st clause) — **RE-CLASSIFIED this round as an accepted
   model-capability-tier gap per D-F11's binding two-stage instruction** (the code fix — curated
   `allowedTools`/`tools`/`settingSources`/`strictMcpConfig` — is confirmed genuinely on the wire and
   effective at reducing payload size; the model still doesn't tool-use even with it). Not a code gap,
   not a blocker. See VAL-003.
2. `AgentRecord.state` never produced `"queued"`/`"running"`, only `"done"`/`"failed"` — **FIXED this
   round (D-F12), confirmed via a real 3-agent `parallel()` repro showing live `"running"` states.**
   See VAL-002/VAL-007.
3. `workflow_resume` after an abort-during-suspend replayed the journaled `null` instead of re-running
   the call live — **FIXED this round (D-F13), confirmed via a real suspend-mid-essay + resume repro
   producing a genuine 27s/940-token live re-run.** See VAL-006.
4. Operational hazard: `LiteLLMProxyManager`'s hard-coded port 4000, combined with the known orphan-
   process-on-shutdown limitation — **RE-CONFIRMED STILL OPEN this round, reproduced live twice**
   (starting a 2nd/3rd server instance with a different alias config each time; `ss -tlnp` confirmed
   port 4000 was held by the FIRST instance's orphan the entire time, i.e. every later instance's own
   health check silently passed against a proxy it never actually uses). Not REQ-blocking (no v1 REQ
   acceptance clause depends on which specific `litellm` process answers when aliases are identical
   across instances, which they were in both of this round's repros) but a genuine operational risk if
   aliases differ across instances — documented in DEPLOY.md, unfixed, carried to the v1.1 backlog.

## New this round: 1 minor cosmetic finding, non-REQ-blocking (v1.1 backlog, see below)
An `AgentRecord` whose call was cut short by `workflow_suspend`/`workflow_stop` never transitions out
of `"state":"running"` — it stays stuck forever in `workflow_status.agents[]`, alongside the NEW
record the live re-run (post D-F13) creates. The run's own final `result` is correct; no REQ
acceptance clause requires an "aborted" state value; but this could visually confuse a caller polling
`workflow_status` after an abort. See VAL-006 for the two repros that surfaced this (suspend+resume,
and stop+cached-prefix-resume).

## Minor operational gaps (not REQ-blocking, documented in DEPLOY.md) — re-confirmed unchanged
1. `main.ts`'s `SIGTERM`/`SIGINT` shutdown never stops the managed `LiteLLMProxyManager` subprocess —
   re-confirmed this round (orphans accumulated across all 5 of this round's server instances,
   manually cleaned up between test phases; this is also the direct cause of the port-4000 collision
   hazard above).
2. `LiteLLMProxyManager.start()`'s `mkdtemp()` temp config dirs are never cleaned up — re-confirmed
   (`/tmp/rwe-litellm-*` accumulated further this round, manually cleaned up).

## v1.1 backlog (non-REQ improvement ideas — per the CONVERGENCE RULE, NOT gate blockers)
1. Give an aborted `AgentRecord` its own terminal-ish state (e.g. `"aborted"`) instead of leaving it
   stuck at `"running"` forever post-suspend/stop (cosmetic; see "New this round" above).
2. Fix the `LiteLLMProxyManager` port-4000 collision hazard: derive the port from `ServerConfig`/
   `FileConfig` (or pick a free port dynamically) instead of hard-coding 4000, and/or have
   `main.ts`'s shutdown handler also stop the managed `litellm` subprocess so orphans (the direct
   cause of the collision risk) stop accumulating.
3. Re-run VAL-003's 1st clause (tool-use) against a larger/more tool-calling-capable local model
   (e.g. `qwen2.5:32b`, `qwen2.5-coder:32b`) or a paid provider with sandbox credentials, to determine
   whether the model-capability-tier finding is specific to 7B-class models or a broader integration
   issue.
4. Once VAL-003's tool-use gap is resolved on some model, re-check the latent `cwd`-not-per-run-
   workspace gap flagged under VAL-013 (currently masked, no observable effect while tool-use itself
   doesn't fire).
5. `LiteLLMProxyManager.start()`'s `mkdtemp()` temp config dirs cleanup (cosmetic `/tmp` accumulation).

## Config-file sync check (per Gate 7.5 §4b)
`rwe.config.example.json`'s documented keys (`bind`/`port`/`workRoot`/`timeoutMs`/`retries`/`gateway`/
`agentDefinitionsDir`/`defaultAllowedTools`/`aliases`) are all confirmed correct and genuinely
effective in production this round (`defaultAllowedTools` specifically confirmed via `ps aux` showing
the curated `--allowedTools Read,Write,Bash --tools Read,Write,Bash` flags on the real spawned CLI
subprocess). The shipped example `agents/` directory (`researcher.md`/`writer.md`) is confirmed
present, real, and genuinely loadable.

**One real config-DOC gap WAS found and fixed this round**: `rwe.config.example.json` already shipped
`defaultAllowedTools` (added by a prior round's D-F11 implementation, confirmed present via `cat`
before this round started), but `DEPLOY.md` §1b's own documented config table + example JSON snippet
never mentioned this key anywhere — a genuine "code/config expects a key the docs don't mention" drift
per Gate 7.5 §4b's own definition. **Fixed in this round's DEPLOY.md rewrite**: §1b's JSON example now
includes `defaultAllowedTools`, and its prose explains the key's purpose/default/precedence rule.

No other config-schema change needed this round — none of this round's findings (D-F11/D-F12/D-F13
outcomes, or the re-confirmed port-4000 hazard) require a NEW key; the only gap was the pre-existing
key never having been documented. No other config/settings files exist in this repo (`.env`
deliberately absent — credentials read straight from `process.env`, unchanged).

### Round 7 addendum
Re-checked specifically for D-G8-1..6: none of the 6 Gate-8 closing fixes add, rename, remove, or
change the meaning of any config-file key. `rwe.config.example.json` re-confirmed unchanged and
correct as-is (`bind`/`port`/`workRoot`/`timeoutMs`/`retries`/`gateway`/`agentDefinitionsDir`/
`defaultAllowedTools`/`aliases`, byte-identical to round 6). D-G8-4's `timeoutMs` fallback (`?? 15000`)
and D-G8-5's env `ALLOWLIST` are both purely internal defaults/constants with no config-file surface
at all — there is no new key for a deployer to set, and nothing to document beyond what DEPLOY.md's
existing Gate-8 blockquote/§1b/§5/§6 already say (this round's own re-verification just confirms that
prose is now backed by real evidence, not a doc change). **No config-doc drift found this round.**
