---
name: rwe-remote-workflow
description: Guidance for calling the Remote Workflow Engine MCP tools (async submit/poll contract, envelope-not-exception error handling, and when to use the remote service vs the built-in local Workflow tool).
---

# Remote Workflow Engine — usage guide

This skill teaches how to correctly drive the `remote-workflow-engine` MCP server
(configured in this plugin's `.mcp.json`). Read this before calling any of its tools.

## 1. The async submit → poll → fetch contract

`workflow_run` is **asynchronous**: it returns a `runId` immediately and does **not** block
until the workflow finishes. To get the outcome:

1. Call `workflow_run` → receive `{ runId }`.
2. Poll `workflow_status(runId)` until the run's status is `completed` (or `failed`/`stopped`).
3. Call `workflow_result(runId)` to fetch the final result value.

Do not assume `workflow_run`'s return value is the workflow's result — it is only the `runId`.
Similarly, `workflow_trigger` on a scheduled workflow starts a run and returns immediately;
use the same poll-then-fetch sequence to observe its outcome.

## 2. Envelope, not exception

Every tool in this server returns a **result envelope**, not a thrown error, for expected
failure conditions. For example:

- `workflow_trigger` against a disabled resident schedule returns
  `{ error: { code: 'SCHEDULE_DISABLED', ... } }`, it does not throw.
- `asset_push` reports rejected/self-referential files in `excluded[]` rather than throwing.

Always check the response for an `error`/`excluded` field before assuming success — do not
rely on try/catch alone to detect these expected failure modes.

## 3. Remote service vs. the local dynamic Workflow tool

This plugin's MCP tools (namespaced under `remote-workflow-engine`, e.g.
`remote-workflow-engine__workflow_run`) run workflows on the **remote** server. The built-in
local dynamic `Workflow` tool runs scripts **in this session**. Both coexist without
collision — the plugin intentionally does not use the name `workflow` for its MCP server so
it never shadows the local tool. Use the remote service when you need durable/long-running
execution, scheduling, or multi-agent orchestration on shared infrastructure; use the local
tool for quick in-session scripting.
