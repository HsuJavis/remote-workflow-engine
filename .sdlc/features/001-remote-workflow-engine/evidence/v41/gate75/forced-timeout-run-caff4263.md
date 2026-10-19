# REQ-227 (v41 delta) / REQ-231 real-tier forced-timeout run — raw tool responses

`runId caff4263-14cb-4eb7-9eb1-f183b03ff999`, live instance on port 8821 (a663a13), real
`openrouter/typesafe/jev-1.13`, `run_start` `overrides:{"decisions":{"a":{"timeoutMs":50,"retries":1}}}`,
`args:{"n":8}`. Captured verbatim from the real `tools/call` responses (VAL-293/294 cite this file).

## run_agent_log({runId, label:"a"}) — one representative agent (agent-1)

```json
{
 "runId": "caff4263-14cb-4eb7-9eb1-f183b03ff999",
 "status": "completed",
 "harness": null,
 "events": [
  {
   "ts": "2026-10-19T07:44:32.420Z",
   "kind": "usage",
   "data": {
    "primitive": "decide",
    "label": "a",
    "agentKey": "a",
    "phase": "burst",
    "phaseIndex": 0,
    "frame": "",
    "startedAt": "2026-10-19T07:44:32.065Z",
    "provider": "openrouter",
    "model": "typesafe/jev-1.13",
    "costUSD": 0,
    "unpriced": true,
    "reason": "timeout",
    "detail": "decide 'a' failed: timeout after 2 attempts"
   }
  }
 ],
 "result": [ "... same event, omitted for brevity ..." ],
 "hasMore": false,
 "record": {
  "agentId": "agent-1",
  "kind": "decide",
  "label": "a",
  "agentKey": "a",
  "phase": "burst",
  "phaseIndex": 0,
  "frame": "",
  "startedAt": "2026-10-19T07:44:32.065Z",
  "endedAt": "2026-10-19T07:44:32.420Z",
  "state": "failed",
  "provider": "openrouter",
  "model": "typesafe/jev-1.13",
  "costUSD": 0,
  "unpriced": true,
  "failReason": "timeout",
  "detail": "decide 'a' failed: timeout after 2 attempts"
 }
}
```

## run_status({runId}) — agentFailures (all 8 failed `a` calls)

```json
"failedAgentCount": 8,
"agentFailures": [
  {"label":"a","agentId":"agent-1","reason":"timeout","message":"decide 'a' failed: timeout after 2 attempts"},
  {"label":"a","agentId":"agent-3","reason":"timeout","message":"decide 'a' failed: timeout after 2 attempts"},
  {"label":"a","agentId":"agent-5","reason":"timeout","message":"decide 'a' failed: timeout after 2 attempts"},
  {"label":"a","agentId":"agent-7","reason":"timeout","message":"decide 'a' failed: timeout after 2 attempts"},
  {"label":"a","agentId":"agent-9","reason":"timeout","message":"decide 'a' failed: timeout after 2 attempts"},
  {"label":"a","agentId":"agent-11","reason":"timeout","message":"decide 'a' failed: timeout after 2 attempts"},
  {"label":"a","agentId":"agent-13","reason":"timeout","message":"decide 'a' failed: timeout after 2 attempts"},
  {"label":"a","agentId":"agent-15","reason":"timeout","message":"decide 'a' failed: timeout after 2 attempts"}
]
```
Each `a` agent record (full `run_status.result.agents[]`, all 8) carries identical
`startedAt`→`endedAt` deltas of ≈0.35–0.44s (e.g. `agent-1`: `07:44:32.065Z`→`07:44:32.420Z` = 355ms),
all well inside the `(retries+1)×timeoutMs + retries×10s` ≈ 10.1s bound. Interleaved `w`/`b` agents in
the same run (16 total) all `state:"done"`, unaffected by `a`'s override (per-label override scoping).

## run_result({runId}) — script-caught fails[] (all 8)

```json
{
 "result": {
  "n": 8, "decides": 16, "failed": 8,
  "fails": [
   {"i":0,"which":"a","name":"PRIMITIVE_FAILED","code":"PRIMITIVE_FAILED","msg":"decide 'a' failed: timeout after 2 attempts"},
   {"i":1,"which":"a","name":"PRIMITIVE_FAILED","code":"PRIMITIVE_FAILED","msg":"decide 'a' failed: timeout after 2 attempts"},
   {"i":2,"which":"a","name":"PRIMITIVE_FAILED","code":"PRIMITIVE_FAILED","msg":"decide 'a' failed: timeout after 2 attempts"},
   {"i":3,"which":"a","name":"PRIMITIVE_FAILED","code":"PRIMITIVE_FAILED","msg":"decide 'a' failed: timeout after 2 attempts"},
   {"i":4,"which":"a","name":"PRIMITIVE_FAILED","code":"PRIMITIVE_FAILED","msg":"decide 'a' failed: timeout after 2 attempts"},
   {"i":5,"which":"a","name":"PRIMITIVE_FAILED","code":"PRIMITIVE_FAILED","msg":"decide 'a' failed: timeout after 2 attempts"},
   {"i":6,"which":"a","name":"PRIMITIVE_FAILED","code":"PRIMITIVE_FAILED","msg":"decide 'a' failed: timeout after 2 attempts"},
   {"i":7,"which":"a","name":"PRIMITIVE_FAILED","code":"PRIMITIVE_FAILED","msg":"decide 'a' failed: timeout after 2 attempts"}
  ]
 },
 "meta": {
  "usage": {"costUSD": 0.000490542, "unpricedCalls": 8},
  "warnings": [{"code":"AGENT_FAILED","message":"8 agent(s) failed; see run_status.agentFailures for detail"}]
 }
}
```

**Three-surface byte comparison (REQ-231)**: script `fails[].msg` === `run_agent_log.record.detail`
=== `run_status.result.agentFailures[].message` === `"decide 'a' failed: timeout after 2 attempts"`
for all 8 calls; `reason`/`failReason` === `"timeout"` in both of the latter two. No provider response
text, no host path, in any of the three.

See `forced-timeout-primitive-call-lines.jsonl` (same dir) for the server's own operator-log
`primitive.call` events for this run: 8× `outcome:"retry" attempt:1 reason:"timeout"` + 8×
`outcome:"failed" attempt:2 reason:"timeout"`.
