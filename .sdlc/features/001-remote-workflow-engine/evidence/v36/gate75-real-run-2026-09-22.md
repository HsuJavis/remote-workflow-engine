# v36 Gate 7.5 — raw real-run transcript excerpts (REQ-211..216)

Validator round, 2026-09-22. Full narrative + per-REQ writeup lives in `08-validation.md`'s "v36
round" section and `05-tests.md`'s `VAL-246..251`; this file is the raw command/output backing for
the load-bearing claims, kept for audit durability.

## Boot (documented steps only)

```
$ RWE_CONFIG_PATH="$(pwd)/scratch-a.config.json" RWE_BIND=127.0.0.1 RWE_PORT=8993 ./deploy.sh --background
...
健康檢查通過：{"agentSemaphore":{"total":32,"inUse":0,"queued":0},"version":"0.1.0 (v0.20.0-430-g967d890)"}
部署完成。服務位址：http://127.0.0.1:8993/mcp

$ RWE_CONFIG_PATH="$(pwd)/scratch-b.config.json" RWE_BIND=127.0.0.1 RWE_PORT=8994 ./deploy.sh --background
...
健康檢查通過：{"agentSemaphore":{"total":32,"inUse":0,"queued":0},"version":"0.1.0 (v0.20.0-430-g967d890)"}
部署完成。服務位址：http://127.0.0.1:8994/mcp

$ ls -a | grep '^\.rwe\.'
.rwe.scratch-a.config.log
.rwe.scratch-a.config.pid
.rwe.scratch-b.config.log
.rwe.scratch-b.config.pid

$ systemctl --user show rwe.service -p MainPID -p NRestarts -p ActiveState
ActiveState=active
MainPID=3553536
NRestarts=0
```

## REQ-211 — per-version deregister

```
workflow_deregister({name:"v36-req211", version:"v2"})   # published to release
-> {"code":"VERSION_PINNED_BY_CHANNEL","message":"VERSION_PINNED_BY_CHANNEL: 'v2' of 'v36-req211' is published to a channel — unpublish it first"}

workflow_deregister({name:"v36-req211", version:"v1"})   # not pinned
-> {"removed":true,"releasedTriggers":[],"result":{"remaining":["v2","v3"]}}

run_start({name:"v36-req211-run", version:"v3"})  -> runId 21837c0a-cd45-4c7d-9345-5badac5e8973
run_status(runId) while status=="running" (real Ollama dispatch in flight, provider:"ollama", model:"qwen2.5:7b")
workflow_deregister({name:"v36-req211-run", version:"v3"})
-> {"code":"VERSION_PINNED_BY_RUN","message":"VERSION_PINNED_BY_RUN: run 21837c0a-cd45-4c7d-9345-5badac5e8973 pins version 'v3' of 'v36-req211-run'"}

# the run then completed normally:
run_result(runId) -> {"result":{"r":"1  \n2  \n3  \n...\n50"},"meta":{"usage":{"tokens":{"input":48,"output":141,...}}}}
```

## REQ-212 — audit identity + bypass

```
# bob (author) registers
{"kind":"catalog.register","name":"v36-req212-bob","version":"v1","actor":{"id":"bob@example.com","bypass":false,"idSource":"authenticated"},"at":"2026-09-21T18:30:42.629Z"}

# alice (admin) attempts to overwrite bob's workflow by registering over it
workflow_register({name:"v36-req212-bob", ...}) as alice
-> {"code":"NOT_WORKFLOW_OWNER","message":"NOT_WORKFLOW_OWNER: workflow 'v36-req212-bob' is owned by bob@example.com"}

# alice (admin) publishes bob's workflow — bypass allowed, identity still real
{"kind":"catalog.publish","name":"v36-req212-bob","version":"v1","channel":"release","fromVersion":null,"actor":{"id":"alice@example.com","bypass":true,"idSource":"authenticated"},"at":"2026-09-21T18:30:46.482Z"}

# auth-disabled instance B, explicit {principal:"carol@example.com"}
{"kind":"catalog.register","name":"v36-req212-claimed","version":"v1","actor":{"id":"carol@example.com","bypass":false,"idSource":"claimed"},"at":"2026-09-21T18:35:52.967Z"}
```

## REQ-213 — workflow_list lastRunAt + structured log

```
workflow_list() before any run:
[{"name":"v36-req212-bob","owner":"bob@example.com",...,"description":"","lastRunAt":null}]

run_start({name:"v36-req212-bob"}) -> runId 8f22e8a5-c5bf-43a4-b6f6-3206d63d672d, poll to completed

workflow_list() after:
[{"name":"v36-req212-bob",...,"lastRunAt":"2026-09-21T18:30:57.632Z"}]

{"kind":"run.terminal","runId":"8f22e8a5-c5bf-43a4-b6f6-3206d63d672d","name":"v36-req212-bob","version":"v1","outcome":"completed","principal":"alice@example.com","at":"2026-09-21T18:30:57.759Z"}
```

## REQ-214 — two instances, no control-file clobber

```
$ kill $(cat .rwe.scratch-b.config.pid); sleep 1
$ curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8993/api/status   # instance A
200
$ curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8899/api/status   # production
200
$ systemctl --user show rwe.service -p MainPID -p NRestarts
MainPID=3553536
NRestarts=0
```

## REQ-215 — structured refusal marker crosses the sandbox

**Load-bearing case (matches the design table's illustrative script; discriminates the v36 fix).**
`agentType` is refused at registration by the v34 static scan for any NEW script, so this round
reproduced the real, only-reachable path (per IT-298's own header comment): stop a freshly-booted
scratch instance, use the SUT's own `WorkflowCatalog.insertVersion()` class against the real
`catalog.db` to insert a legacy-shaped version, restart via documented `./deploy.sh --background`
(idempotent, workRoot preserved), then dispatch over real MCP:

```
$ kill $(cat .rwe.scratch-c.config.pid); sleep 1   # stop before direct DB write
$ npx tsx ./.tmp-insert-legacy.mjs                  # SUT's own WorkflowCatalog.insertVersion(), real SystemClock, real catalog.db
inserted version: v1
published to release

$ RWE_CONFIG_PATH="$(pwd)/scratch-c.config.json" RWE_BIND=127.0.0.1 RWE_PORT=8995 ./deploy.sh --background
健康檢查通過 ...

run_start({name:"v36-req215-legacy"})  -> runId b0490f70-f7c8-4ab5-9161-dc0d711e04d1
run_result(runId) ->
{"status":"failed","error":{"code":"PARAM_UNKNOWN","message":"PARAM_UNKNOWN: 'agentType' was retired at v34 — the server-side agent-definition mechanism is gone; put the system prompt in your script's own prompt. See workflow_authoring_guide, 'prompt layering'."}}

{"kind":"run.terminal","runId":"b0490f70-...","name":"v36-req215-legacy","version":"v1","outcome":"failed","principal":null,"code":"PARAM_UNKNOWN","at":"2026-09-21T18:49:40.803Z"}

# parallel() variant, same insertVersion technique, workflow "v36-req215-legacy-par":
run_result(runId) -> {"status":"failed","error":{"code":"PARAM_UNKNOWN",...}}   # not swallowed to null
```

Pre-v36 this same runtime guard's catch flattened to `{"code":"SCRIPT_ERROR"}` (REQ-215's own
red-reason text; `guards.ts`'s `ENGINE_REFUSAL_CODES` held only `BUDGET_EXCEEDED` before this
iteration) — so `PARAM_UNKNOWN` reaching `run_result.error.code` is evidence that DISCRIMINATES the
fix, not merely a mechanism exercise.

**Secondary corroboration only (self-caught as non-discriminating, kept for the record).** First
attempt this round used `BUDGET_EXCEEDED` via an ordinary `workflow_register` + `run_start`:

```
run_start({name:"v36-req215-seq", version:"v1", budget:{tokens:0}})
-> run_result.error = {"code":"BUDGET_EXCEEDED","message":"Budget exceeded (tokens): spent 0 >= total 0"}

run_start({name:"v36-req215-par", version:"v1", budget:{tokens:0}})   # agent() called inside parallel([...])
-> run_result.error = {"code":"BUDGET_EXCEEDED","message":"Budget exceeded (tokens): spent 0 >= total 0"}
   (run FAILED — not swallowed to null)
```

This does NOT discriminate the v36 change — `BUDGET_EXCEEDED` already crossed the sandbox intact
before this iteration (IT-140/v25) — so it is recorded only as corroboration that the mechanism
generalizes across both `ENGINE_REFUSAL_CODES` members, not as the REQ-215 load-bearing evidence.

## REQ-216 K1/K2/K3/K4 — redact-then-truncate + cross-consistency

```
$ tr '\0' '\n' < /proc/<enginePID>/environ | grep RWE_SECRET
RWE_SECRET_REPO_TOKEN=sekrit-repo-credential-v36gate75

run_start({name:"v36-req216-k2-seed", version:"v1",
  seedRef:{repoUrl:"https://github.com/sekrit-repo-credential-v36gate75/v36-nonexistent-repo-xyz.git",
           sha:"0123456789abcdef0123456789abcdef01234567"}})

run_status(runId).seedRef.failDetail:
"git fetch failed: Command failed: git -c http.followRedirects=false -c submodule.recurse=false fetch
 --depth 1 --no-tags https://github.com/‹secret:REPO_TOKEN›/v36-nonexistent-repo-xyz.git 0123456…
 [truncated: 9 bytes omitted]"
run_status(runId).error.message: same redacted text (K1 — one captureFailure call, both sites agree)
run_status(runId).seedRef.failCode: "SEEDREF_FETCH_FAILED"

run_list({name:"v36-req216-k2-seed"}) -> same {code,message} error object as run_status (K4)
```

## REQ-216 K6/K7 — attempts formula, real untimed call

```
run_status(21837c0a-...).agents[0]: {"state":"done","provider":"ollama","model":"qwen2.5:7b",
  "startedAt":"2026-09-21T18:31:57.823Z","endedAt":"2026-09-21T18:32:26.644Z", ...}
  # one real round trip, ~29s, no retry — no per-call timeoutMs was set

workflow_authoring_guide() text (live, deployed):
"An agent() call with no timeoutMs set — neither on the call itself (timeoutMs) nor as this
deployment's own configured default — runs once: retries apply only to a call that has a bounded
timeout in effect."
```

## Cleanup

All scratch artifacts (`scratch-a.config.json`, `scratch-b.config.json`, `.rwe.scratch-*.config.
{pid,log}`, `/tmp/rwe-v36-a`, `/tmp/rwe-v36-b`, the temporary `TokenStore.issue()` mint script) were
deleted after this round; `git status --short` confirmed clean of them. Production `rwe.service`
(port 8899) was never stopped or restarted.
