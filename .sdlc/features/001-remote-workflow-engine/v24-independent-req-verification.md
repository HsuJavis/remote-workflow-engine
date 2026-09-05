# v24 REQ-107..118 — verification results

**Engine under test:** `http://127.0.0.1:8794/mcp` (dedicated instance, auth ON, three principals)
**Dashboard:** `http://127.0.0.1:8794/dashboard`
**Date:** 2026-09-05
**Principals used:** `admin@verify.local` (admin), `author@verify.local` (author), `user@verify.local` (user)

## How this was run

Every engine call below is a real MCP `tools/call` over HTTP against the booted engine, sent with
`Authorization: Bearer <token>` and `Accept: application/json, text/event-stream`. The session's
preconfigured `mcp__rwe__*` client points at a *different* engine (8899) and carries no token, so it
was not used; calls were made with the equivalent raw JSON-RPC. Browser checks used a real Chromium
via Playwright (the MCP Playwright server could not launch — it is pinned to a `chrome` channel that
is not installed on this host — so Chromium was installed and driven through the Playwright library
directly).

**Two standing caveats, stated up front:**

1. **There is one author, not two.** REQ-109's ownership refusals were proven with `admin` standing
   in as "a different principal" against author-owned resources and vice versa. I did **not** have
   two peer authors, so "author A cannot touch author B's workflow" is proven only in the
   author↔admin direction. The admin's own ownership *bypass* is itself part of REQ-109 and is
   verified separately.
2. **The deployment's model is a slow local model** (`local`/`default` → `rwe-proxy-local` via
   Ollama). Agents need `timeoutMs` in the hundreds of seconds; at the declared defaults they time
   out. This affects what a *run* can demonstrate, not what the *contract* enforces, and is called
   out wherever it matters.

---

## REQ-107 — one prefix per entity — **PASS**

**Tool inventory** (`tools/list`, 35 tools):

```
workflow (7): workflow_register workflow_deregister workflow_publish workflow_describe
              workflow_source workflow_list workflow_authoring_guide
run      (8): run_start run_status run_result run_suspend run_resume run_stop run_agent_log run_list
workspace(6): workspace_diff workspace_push workspace_pull workspace_list workspace_delete workspace_purge
schedule (4) | webhook (3) | issue (5) | models (1) | system (1)
```

**Keys match the prefix.** Every `workflow_*` tool is keyed by `name`; the seven run-scoped tools are
each keyed by `runId`; `workspace_*` is keyed by `runId` or by `workflow`/`kind`. No tool acts on a
run while carrying the `workflow_` prefix.

**The seven run-scoped tools are exactly the ones named:** `run_start`, `run_status`, `run_result`,
`run_suspend`, `run_resume`, `run_stop`, `run_agent_log` — all keyed by `runId`. `run_list` is an
eighth `run_*` tool but is the collection-level tool this same requirement mandates, keyed by
filters rather than a `runId`; it is not a violation of "the seven run-scoped tools".

**`run_list` has exactly the mandated signature** `{workflow?, status?, limit?}` and all three filters
work:

```
run_list {}                                   -> 1 row (author's own)
run_list {"workflow":"reqverify-main"}        -> filtered
run_list {"status":"completed"}               -> filtered
run_list {"limit":1}                          -> honoured
run_list {} as admin                          -> 4 rows, unfiltered (operator role)
```

**`workflow_list` returns workflows ONLY.** Union of row keys across all rows:

```
workflow_list rows: ['channels','name','owner','runnable','versions']
run_list rows     : ['createdAt','name','runId','scriptVersion','startedBy','status','terminalAt']
any row with kind=='run'? False
```

The pre-v24 flat array discriminated by `kind:'workflow'|'run'` is gone.

**`workflow_get` is renamed `workflow_source`** — `workflow_source` is present; `workflow_get` is absent.

**Every old name is absent and calling it is an unknown-tool error — no deprecation window:**

```
workflow_run                -> {"code":-32601,"message":"Unknown tool: workflow_run"}
workflow_get                -> {"code":-32601,"message":"Unknown tool: workflow_get"}
workflow_artifacts          -> {"code":-32601,"message":"Unknown tool: workflow_artifacts"}
workflow_artifact_get       -> {"code":-32601,"message":"Unknown tool: workflow_artifact_get"}
workflow_regenerate_diagram -> {"code":-32601,"message":"Unknown tool: workflow_regenerate_diagram"}
blob_put / seed_plan / asset_push / asset_list / asset_delete / mcp_provision -> same
```

---

## REQ-108 — six workspace tools with per-tool modes — **PASS**

**The surface is exactly six:** `workspace_diff`, `workspace_push`, `workspace_pull`,
`workspace_list`, `workspace_delete`, `workspace_purge`. All nine pre-v24 file-moving tools are gone
(verified above).

**`workspace_push` has exactly two modes, and `runId` is rejected:**

```
push {"sha256":"2cf24dba…b855","contentB64":"aGVsbG8="}
  -> {"status":"completed","result":{"sha256":"2cf24dba…b855","accepted":true}}
push {"sha256":"000…0","contentB64":"aGVsbG8="}
  -> {"code":"BLOB_HASH_MISMATCH","message":"declared sha256 000…0 != computed 2cf24dba…b855"}
push {"runId":"…","sha256":"…","contentB64":"…"}
  -> {"code":"INVALID_ARGUMENT","message":"INVALID_ARGUMENT: (root) must NOT have additional properties"}
push {sha256+contentB64 AND workflow+kind+name}   -> INVALID_ARGUMENT (modes are exclusive)
push {}                                            -> INVALID_ARGUMENT: must have required property 'sha256'
```

The CAS mode takes no path and no runId, exactly as required.

**`workspace_diff` takes no scope argument and compares against the caller's own CAS pool.** This is
the cleanest proof in the whole run — the *same* manifest gives different answers to different
principals, because the pool is namespaced by principal:

```
(author had previously pushed the blob 2cf24dba…b855)
author: diff {"manifest":[{"path":"hello.txt","sha256":"2cf24dba…b855"},{"path":"nope","sha256":"111…1"}]}
   -> {"missing":["1111…1"]}                      <- author HAS 2cf24dba
user  : diff {"manifest":[{"path":"hello.txt","sha256":"2cf24dba…b855"}]}
   -> {"missing":["2cf24dba…b855"]}               <- user does NOT
```

Its schema has only `manifest`. *Minor deviation:* an extra `runId` passed to `workspace_diff` is
silently ignored rather than refused, whereas `workspace_push` rejects unknown properties. The
requirement's "takes no scope argument at all" is met by the schema, but the two tools are
inconsistent about surplus arguments.

**`workspace_delete({runId, paths[]})` deletes named files and is refused while the run is live** —
proven in all three non-terminal states plus the terminal one:

```
run RUNNING   : delete {"runId":"af905f18…","paths":["a.txt"]}
   -> {"code":"RUN_NOT_TERMINAL","message":"run af905f18… is running, not terminal"}
run RUNNING   : purge  -> {"code":"RUN_NOT_TERMINAL", …}          (matches workspace_purge)
run SUSPENDED : delete -> {"code":"RUN_NOT_TERMINAL","message":"run ad08b182… is suspended, not terminal"}
run STOPPED   : delete {"paths":[".mcp.json"]}
   -> {"result":{"deleted":[".mcp.json"],"missing":[],"rejected":[]}}
run STOPPED   : purge  -> {"result":{"purged":true}}
```

**A single shared path-verdict with per-destination rules.** Seeded a run with seven hostile paths
and listed what actually landed:

```
run_start {"name":"reqverify-smoke","seed":[normal.txt, .claude/settings.json,
   .claude/settings.local.json, .claude/hooks/pre.sh, .claude/skills/keep/SKILL.md,
   .git/config, ../escape.txt]}
workspace_list {"runId":"db6c5ace…"} ->
    .claude/skills/keep/SKILL.md (23B)
    .mcp.json (22B)
    normal.txt (2B)
```

`.claude/settings.json` **and** `.claude/settings.local.json` (the `settings*.json` glob),
`.claude/hooks/**`, `.git/config` and `../escape.txt` were all kept out; a legitimate
`.claude/skills/**` file survived. On the asset-tree destination the reserved-name rule fires
instead:

```
push asset name "rwe-evil"            -> {"code":"RESERVED_PREFIX"}
push asset path segment "rwe-seg/f.md"-> {"code":"RESERVED_PREFIX"}
push asset path "../escape.md"        -> {"code":"WORKSPACE_ESCAPE"}
```

*Two nuances worth recording.* (a) `.git/config` and `../escape.txt` were **silently dropped** from
the seed rather than refusing the run; the requirement says "rejects", which reads like an error.
(b) On an *asset* tree, `.git/config` and `.claude/settings.json` are **accepted** — the requirement
scopes the strip/reject list to the run-workspace destination, so this is within spec, and the
selective-materialization rule (REQ-113) is what stops such a file reaching a run. I confirmed that
containment holds: see REQ-113.

`workspace_pull` range reads and escapes:

```
pull {"path":"normal.txt"}                   -> {"size":2,"offset":0,"length":2,"eof":true,"base64":"b2s="}
pull {"path":"normal.txt","offset":1,"length":1} -> {"offset":1,"length":1,"base64":"aw=="}
pull {"path":"../../etc/passwd"}             -> {"code":"WORKSPACE_ESCAPE","message":"… PATH_OUTSIDE_WORKSPACE"}
pull {"path":"nope.txt"}                     -> {"code":"NOT_FOUND","message":"… NOT_A_FILE (nope.txt)"}
```

---

## REQ-109 — three roles, enforced at every tool — **PASS**

Auth is on: a call with **no** token gets `HTTP 401 {"error":"unauthorized"}`.

**A `user` may** list, describe, start and observe their own runs:

```
user: workflow_list      -> completed, 26 rows
user: workflow_describe  -> completed (full params + diagram)
user: run_start          -> {"runId":"532ba7ed…","status":"running"}
user: run_status/run_result/run_agent_log on own run -> completed
user: run_list           -> only their own rows
user: workspace_list/pull/delete/purge on own run    -> completed
```

**A `user` is refused everything REQ-109 names:**

```
workflow_register   -> {"code":"FORBIDDEN_ROLE","message":"role 'user' is below the required 'author'"}
workflow_deregister -> FORBIDDEN_ROLE (same message)
workflow_publish    -> FORBIDDEN_ROLE
workflow_source     -> FORBIDDEN_ROLE
schedule_create     -> FORBIDDEN_ROLE
webhook_create      -> FORBIDDEN_ROLE
workspace_push (asset mode) -> {"code":"FORBIDDEN_ROLE", "detail":{"mode":"asset"}}
```

*Note:* a `user` **can** push a CAS blob (`{sha256,contentB64}`). That is deliberate and correct —
REQ-108 defines CAS push as principal-namespaced run seeding, and REQ-109 lets a user write their
own runs' workspaces. The engine distinguishes the two modes explicitly (`detail.mode:"asset"`), so
"asset pushes are refused" is satisfied in the sense the requirement means.

**An `author` may register and act on what they own, and is refused on what they do not:**

```
author registers reqverify-main                      -> v1
admin  registers reqverify-adminwf                   -> v1
author: workflow_deregister {"name":"reqverify-adminwf"}
   -> {"code":"NOT_WORKFLOW_OWNER","message":"owned by admin@verify.local, not author@verify.local"}
author: workflow_publish   on admin's wf             -> NOT_WORKFLOW_OWNER
author: workspace_push asset to admin's wf
   -> {"code":"NOT_WORKFLOW_OWNER", "detail":{"mode":"asset"}}
author: workflow_source    on admin's wf             -> completed BUT MASKED:
   keys=['channels','description','name','owner','params','phases','reportProblem',
         'scriptWithheld','validation','version']   scriptWithheld=True   script absent
author: workflow_source    on OWN wf                 -> script present (793 bytes)
```

**An `admin` passes every gate including ownership:**

```
admin: workflow_source on author's wf   -> completed, script present (793 bytes)
admin: workflow_publish author's wf     -> {"result":{"channel":"beta","version":"v2","from":"v1"}}
admin: run_list                         -> unfiltered, all principals' runs
```

**And the cross-principal workspace read writes an audit record.** Run `532ba7ed…` is owned by
`user@verify.local`:

```
author (peer): workspace_list {"runId":"532ba7ed…"}
   -> {"code":"NOT_RUN_OWNER","message":"owned by user@verify.local, not author@verify.local"}
admin        : workspace_list {"runId":"532ba7ed…"} -> completed
admin        : workspace_pull {"runId":"532ba7ed…","path":"result.json"} -> completed(NOT_FOUND file)
```

then, read back **by the run's owner**:

```
user: run_status {"runId":"532ba7ed…"} -> "adminReads": [
  {"ts":"2026-09-05T03:21:10.441Z","actor":"admin@verify.local","action":"workspace_pull",
   "runId":"532ba7ed…","owner":"user@verify.local","path":"result.json"},
  {"ts":"2026-09-05T03:21:10.439Z","actor":"admin@verify.local","action":"workspace_list",
   "runId":"532ba7ed…","owner":"user@verify.local"}
]
```

The record names the principal, the run and the time, exactly as the owner decision requires, and it
is surfaced to the person whose run was read. Note the *attempted* pull of a non-existent file was
still audited — the audit is on the access, not on its success.

**On `mcp_provision`:** REQ-109's last clause says its "Admin tool" claim must become true. The tool
**no longer exists in v24** (`Unknown tool: mcp_provision`); MCP configs now move through
`workspace_push {kind:"mcp"}`, which does enforce a role check (`stdio` configs are admin-only:
`{"code":"FORBIDDEN_ROLE","detail":{"mode":"stdio"}}`). The clause is satisfied by removal rather
than by fixing the string.

---

## REQ-110 — every tunable parameter declared and overridable PER AGENT — **PASS** (one code-name deviation)

**`agent()` refuses `model`/`effort`/`timeoutMs`, pointing at the right place:**

```
agent('w',{prompt:'hi', model:'opus'})
  -> {"code":"SCAN_VIOLATION","message":"PARAM_IN_SCRIPT: move 'model' to meta.params.agents.w.model.default (line 2)"}
agent('w',{prompt:'hi', effort:'high'})
  -> {"code":"SCAN_VIOLATION","message":"PARAM_IN_SCRIPT: move 'effort' to meta.params.agents.w.effort.default (line 2)"}
agent('w',{prompt:'hi', timeoutMs:120000})
  -> {"code":"SCAN_VIOLATION","message":"PARAM_IN_SCRIPT: move 'timeoutMs' to meta.params.agents.w.timeoutMs.default (line 2)"}
```

`label`, `phase` and `schema` remain accepted. A script therefore carries no model name.

**The retired workflow-wide `defaults` object (ADR-035) is refused, naming its replacement:**

```
meta.defaults      -> {"code":"DEFAULTS_RETIRED","message":"meta.defaults is retired (ADR-035) — declare meta.params.agents.<label>.<key>.default instead"}
meta.params.knobs  -> {"code":"DEFAULTS_RETIRED","message":"meta.params.knobs is retired (ADR-035) — declare meta.params.agents.<label>.<key>.default instead"}
```

Never accepted-and-ignored — refused at registration with the replacement path named, which is
precisely what the requirement asks for on behalf of a cold model working from a stale example.

**Declaration/script correspondence is bidirectional:**

```
script uses agent('w'), contract declares nothing
  -> {"code":"AGENT_UNDECLARED","message":"agent label \"w\" has no params.agents.w declaration"}
contract declares 'ghost', no agent() uses it
  -> {"code":"AGENT_DECLARED_NOT_IN_SCRIPT","message":"params.agents.ghost is declared but no agent() call in the script uses it"}
```

**Ceilings are refusals, never silent clamps** — at declaration time:

```
timeoutMs.default 600001    -> PARAM_CONTRACT_INVALID "default exceeds the engine ceiling 600000"
appendPrompt.default 1025B  -> PARAM_CONTRACT_INVALID "default is 1025 bytes, over the engine ceiling maxAppendPromptBytes 1024"
effort.default 'xhigh'      -> PARAM_CONTRACT_INVALID "default exceeds the engine ceiling high"
effort.default 'max'        -> PARAM_CONTRACT_INVALID "default exceeds the engine ceiling high"
```

and at override time, where the requirement's own error name appears:

```
overrides.agents.scout.timeoutMs = 700000
  -> {"code":"PARAM_OUT_OF_RANGE","message":"timeoutMs exceeds the engine ceiling maxTimeoutMs 600000",
      "detail":{"supplied":700000,"allowed":{"max":600000},"ceiling":"maxTimeoutMs","agent":"scout"}}
overrides.agents.scout.effort = 'max'
  -> {"code":"PARAM_OUT_OF_RANGE","detail":{"supplied":"max","allowed":{"enum":["low","medium","high"]},"agent":"scout"}}
```

All three named ceilings hold: `maxTimeoutMs` 600000, `maxAppendPromptBytes` 1024, `maxEffort` `high`.

> **Deviation (minor, reported):** the requirement names `PARAM_OUT_OF_RANGE` for "any tunable
> value". The engine returns `PARAM_OUT_OF_RANGE` for **caller overrides** but
> `PARAM_CONTRACT_INVALID` for a **declared default** that breaches the same ceiling. The behaviour
> the requirement actually cares about — refusal, never a silent clamp — holds in both cases, and
> the engine's own guide documents the two codes as distinct (`PARAM_CONTRACT_INVALID` = "the
> declared parameter contract itself is malformed or out of its own bounds"). Recorded as a naming
> mismatch, not a behavioural failure.

**The six locked keys are locked, all six:**

```
overrides.agents.scout.prompt  -> {"code":"PARAM_LOCKED","message":"\"prompt\" is a locked parameter and cannot be overridden",
                                   "detail":{"agent":"scout","tunable":["model","effort","timeoutMs","appendPrompt"]}}
… tools / skills / mcp / workdir / cwd -> PARAM_LOCKED, identical shape
```

`workflow_describe` reports `lockedKeys: ["prompt","tools","skills","mcp","workdir","cwd"]`.

**The pre-v24 flat override is gone**, and the error teaches the new spelling:

```
overrides {"model":"opus"}
  -> {"code":"PARAM_UNKNOWN","message":"\"model\" is a per-agent override in v24 — spell it as overrides.agents.<label>.model"}
overrides {"effort":…} / {"timeoutMs":…} -> same
overrides {"agents":{"nosuch":{…}}}
  -> {"code":"UNKNOWN_AGENT_LABEL","message":"\"nosuch\" is not a declared agent label","detail":{"known":["scout","synth"]}}
```

**Each agent is tuned independently — proven on a real run.** Started `reqverify-main` with
different values per label:

```
run_start {"overrides":{"agents":{"scout":{"effort":"low","timeoutMs":45000},
                                  "synth":{"effort":"high","timeoutMs":120000}}}}
run_agent_log {"label":"scout"} -> harness:
  {"effort":"low","timeoutMs":45000,
   "provenance":{"model":"default","effort":"override","timeoutMs":"override","appendPrompt":"engine"}}
```

The `provenance` map shows per-key origin, and scout's 45000 landed while synth kept its own 120000.

**`workflow_describe` reports params per agent** before anything is spent:

```
"params":{"agents":{
  "scout":{"model":{"type":"string","default":"local"},
           "effort":{"type":"enum","default":"low","range":["low","medium","high"]},
           "timeoutMs":{"type":"number","default":60000,"range":{"max":600000}}},
  "synth":{… "effort":{"default":"medium"…}, "timeoutMs":{"default":90000 …}}}}
```

*Observation (not a requirement breach):* the configured `timeoutMs` is applied **per attempt** and
the engine retries once, so an agent with `timeoutMs:45000` occupied 90s of wall clock and one with
`120000` occupied 240s. The value is honoured; the wall-clock budget is 2×.

---

## REQ-111 — the author supplies the diagram and the engine holds it to the script — **PASS**

**`mermaid` is required, with no exception:**

```
register without the key -> {"code":"MERMAID_REQUIRED","message":"MERMAID_REQUIRED: workflow 'reqverify-main' registration requires a non-empty mermaid diagram string (ADR-025)","see":"workflow_authoring_guide"}
register with ""         -> MERMAID_REQUIRED (same)
```

**A diagram that does not parse is refused and nothing is stored:**

```
register mermaid:"this is not a diagram <<<>>>"
  -> {"code":"MERMAID_INVALID","message":"MERMAID_INVALID: MERMAID_INVALID (line 1)","detail":{"rule":"MERMAID_INVALID","line":1}}
… after all eight refusals below: workflow_list -> {"result":[]}   (nothing stored)
```

**The agent sets must match EXACTLY IN BOTH DIRECTIONS**, and the error says which way it failed:

```
script has scout+synth, diagram has only scout
  -> {"code":"DIAGRAM_MISMATCH","detail":{"rule":"DIAGRAM_SCRIPT_MISMATCH","onlyInScript":["synth"],"onlyInDiagram":[]}}
diagram adds a stadium node 'auditor' the script never calls
  -> {"code":"DIAGRAM_MISMATCH","detail":{"rule":"DIAGRAM_SCRIPT_MISMATCH","onlyInScript":[],"onlyInDiagram":["auditor"]}}
```

This is statically decidable and needed no model. Happy path:

```
register {name:"reqverify-main", script, mermaid:<matching>} -> {"version":1,"result":{"version":"v1"}}
```

**A new version requires a fresh diagram:**

```
register v2 of the same name with no mermaid -> MERMAID_REQUIRED
register v2 with a fresh mermaid             -> {"version":2,"result":{"version":"v2"}}
```

**The analyzer subsystem is gone:** `workflow_regenerate_diagram` is `Unknown tool`; no
`diagramStatus` pending/unavailable state appears in `workflow_describe` (it serves
`mermaid` verbatim plus a `mermaidNote:null`); and the shipped dashboard source states the change
in-line: *"the author-supplied Mermaid source (stored verbatim, never rendered client-side — no
Mermaid library ships here, ADR-033) replaces the v23 analyzer-drawn ASCII diagram / its
ready-pending-unavailable polling."*

**Browser check — the diagram is served but CANNOT BE SEEN.** See the FAIL recorded under
"Browser findings" below: the dashboard's workflow-detail view, the only place the author's diagram
appears in the UI, never loads. The diagram is verified present over MCP; it is **not** verified
visible to a person.

---

## REQ-112 — the Mermaid vocabulary is fixed — **PASS**

Every shape in the fixed vocabulary was registered successfully in one diagram:

```
graph TD
trig[/"nightly trigger"/]                        <- trapezoid: trigger/output
scorer(["scorer"])                               <- stadium: agent
gate{"any score above threshold?"}               <- diamond: conditional
agg{{"pick the best score (no agent call)"}}     <- hexagon: NON-agent aggregation
box["workflow: reqverify-main (black box)"]      <- rectangle: another workflow
out[/"chosen candidate"/]
trig-->scorer
scorer-->gate
gate-->agg
gate-.->box                                      <- dashed: skipped/discarded path
agg-->out
  -> registered v1
```

**An author-invented shape is refused:** `s1>"scout"]` → `{"code":"MERMAID_INVALID","detail":{"rule":"MERMAID_INVALID","line":2}}`.

**The rectangle black box is excluded from the bidirectional agent diff** — this is the decisive
test, since including it would refuse a legitimate diagram:

```
script: const child = await workflow('reqverify-main', {}); … agent('summarizer', …)
mermaid: child["workflow: reqverify-main (black box)"]
         summarizer(["summarizer"])
         child-->summarizer
  -> registered v1   (the rectangle names another owner's workflow, not an agent, and did not
                      trigger DIAGRAM_MISMATCH)
```

**The agent node's value triple is held to the contract:**

```
s1(["scout<br/>opus · high · 999ms"])  (declared: local · low · 60000)
  -> {"code":"MERMAID_INVALID","message":"MERMAID_INVALID: VALUE_MISMATCH (line 2)","detail":{"rule":"VALUE_MISMATCH","line":2}}
s1(["scout<br/>local · low · 60000ms"]) (agreeing)  -> accepted
```

*Deviation (minor):* the requirement reads "Given an agent node Then its label **carries**
`label<br/>model · effort · timeoutMs`". The engine treats the triple as **optional** — a node with
no `<br/>` is simply not compared — and enforces agreement only once written. So "each agent's
tunable parameters are on the picture" is *enforceable* but not *enforced*; an author may omit them.

**Aggregation by an agent draws no hexagon:** the fan-in edges converge directly on the agent's
stadium node (`s1-->synth`, `s2-->synth`) and this registers; the hexagon is used only for the
script-level merge, as in the shapes diagram above.

> **Gap (reported):** this is the one vocabulary rule the engine does **not** check. The requirement
> closes with *"Given registration Then the shape/label/edge rules are checked mechanically"*, but a
> diagram that double-draws an agent's aggregation — a hexagon inserted in front of the synthesizer,
> which is exactly the owner's correction to the first draft — is accepted:
> ```
> script: parallel(scout×2) then agent('synth', …)
> mermaid: s1-->agg  s2-->agg  agg{{"combine"}}-->synth(["synth"])   -> registered (accepted)
> mermaid: s1-->synth  s2-->synth                                     -> registered (accepted)
> ```
> Both forms register, so "the shape itself answers whether a step costs a model call" is a
> convention here, not an enforced rule. Every *enumerated* mechanical rule — the five shapes, the
> three edge forms, `COLLAPSED_EDGE`, `LOOP_LABEL`, the quoted `subgraph` title, and `VALUE_MISMATCH`
> — is enforced, which is why this requirement is still marked PASS.

**Collapsed fan-out is refused:**

```
s1-->synth & s2
  -> {"code":"MERMAID_INVALID","message":"MERMAID_INVALID: COLLAPSED_EDGE (line 5)","detail":{"rule":"COLLAPSED_EDGE","line":5}}
```

**A subgraph must carry a quoted title, and a debate uses `<-->`:**

```
subgraph            (untitled) -> MERMAID_INVALID (line 2)
subgraph "debate"
proponent(["proponent"])
opponent(["opponent"])
proponent<-->opponent
end                            -> registered v1
```

**A loop must be a labelled back-edge:**

```
writer-->critic / critic-->writer  (unlabelled)
  -> {"code":"MERMAID_INVALID","message":"MERMAID_INVALID: LOOP_LABEL (line 4)","detail":{"rule":"LOOP_LABEL","line":4}}
writer-->|draft|critic / critic-->|revise|writer   -> registered v1
```

**Every violation names its rule and points at the guide:** each error above carries
`"see":"workflow_authoring_guide"` and a `detail.rule` plus `detail.line`.

---

## REQ-113 — assets belong to a workflow, declared per agent, materialized selectively — **PASS**

**Assets are per-workflow, so two authors' `review` no longer collide.** The same skill name was
pushed under two different workflows and both persist independently:

```
push {"workflow":"reqverify-main","kind":"skill","name":"tide-lookup",…} -> {"stored":"tide-lookup"}
push {"workflow":"reqverify-loop","kind":"skill","name":"tide-lookup",…} -> {"stored":"tide-lookup"}
(after deregistering reqverify-main, reqverify-loop's copy is untouched — see below)
```

**A global asset is engine-level, admin-only to add AND remove, and marked `builtin:true`:**

```
author: push {"scope":"global",…} -> {"code":"FORBIDDEN_ROLE","message":"role 'author' is below the required 'admin'","detail":{"mode":"global"}}
admin : push {"scope":"global","kind":"skill","name":"house-style",…} -> {"stored":"house-style"}
author: workspace_delete {"scope":"global",…} -> FORBIDDEN_ROLE (detail.mode "global")
admin : workspace_delete {"scope":"global",…} -> {"result":{"deleted":true}}
```

**`workspace_list({workflow,kind})` returns BOTH scopes, each marked with scope and `pushedBy`:**

```
workspace_list {"workflow":"reqverify-main","kind":"skill"} -> [
 {"scope":"global","builtin":true,"kind":"skill","name":"house-style",
  "pushedBy":"admin@verify.local","pushedAt":"2026-09-05T03:21:33.091Z"},
 {"scope":"workflow","workflow":"reqverify-main","builtin":false,"kind":"skill","name":"tide-lookup",
  "pushedBy":"author@verify.local","pushedAt":"2026-09-05T03:21:33.086Z"}]
```

An author can now discover a provisioned MCP, which pre-v24 was impossible: `workspace_list
{"workflow":"reqverify-loop","kind":"mcp"}` returns the stored config with its `config` body.

**Only the DECLARED skills are materialized — the headline test.** Three skills existed
(`house-style` global, `pathprobe`, `tide-lookup`); the agent declared exactly one:

```
meta.params.agents.m = { …, skills: ['tide-lookup'] }
run_agent_log {"label":"m"} -> harness:
  "skills":["tide-lookup"], "mcpServers":[],
  "materialized":{"skills":["tide-lookup"],"mcp":[],"missing":[]}
workspace_list {"runId":"760fe4da…"} ->
  .claude/skills/tide-lookup/SKILL.md (86B)
  .mcp.json (22B)
```

`pathprobe` and the global `house-style` were **not** copied in. The pre-v24 behaviour of copying
every skill in the tree into every run is gone, and with it the trigger-word collision problem.
This is also what contains the REQ-108 asset-tree nuance: the `pathprobe` skill I deliberately
loaded with `.claude/settings.json` and `.claude/hooks/pre.sh` never reached a run workspace.

**`workflow_deregister` deletes that workflow's assets with it:**

```
before: reqverify-main assets = [global house-style, workflow pathprobe, workflow tide-lookup]
workflow_deregister {"name":"reqverify-main"} -> {"removed":true,"releasedTriggers":[…]}
after : workspace_list {"workflow":"reqverify-main","kind":"skill"}
        -> {"code":"WORKFLOW_NOT_FOUND","message":"Unknown workflow: reqverify-main"}
        reqverify-loop's own tide-lookup and the global house-style both survive
```

*Scope limit:* I verified the assets are no longer reachable through the API and that sibling and
global assets survive. I did not inspect the engine's filesystem to confirm the bytes were unlinked.

**Assets are shared across all versions of a name (no asset versioning):**

```
reqverify-loop had assets pushed while at v1; registered v2:
  versions -> ["v1","v2"]
  workspace_list {"workflow":"reqverify-loop","kind":"skill"} -> ['house-style','tide-lookup']  (unchanged)
```

and the guide states the consequence: *"Assets (skills/mcp) registered under an owner are shared
across every version of that workflow name, not pinned to the version that first declared them."*

---

## REQ-114 — every upload records who did it — **PASS** (one sub-clause UNVERIFIED)

**Every stored asset carries `pushedBy` and `pushedAt`** — skill (above) and MCP config:

```
admin: workspace_push {"workflow":"reqverify-loop","kind":"mcp","name":"tracker",
        "config":{"type":"stdio","command":"npx","args":["-y","@playwright/mcp@latest","--isolated","--browser","chromium"]}}
  -> {"result":{"stored":"tracker"}}
author: workspace_list {"workflow":"reqverify-loop","kind":"mcp"} -> [{
  "scope":"workflow","workflow":"reqverify-loop","builtin":false,"kind":"mcp","name":"tracker",
  "pushedBy":"admin@verify.local","pushedAt":"2026-09-05T03:28:39.632Z",
  "config":{"type":"stdio","command":"npx","args":[…]}}]
```

The pre-v24 `mcp_provisions`-had-only-`provisionedAt` gap is closed: a config can now be traced to
whoever installed it, and `workspace_list` returns `pushedBy` so an admin can see who placed what.
Note the config was **probed before being stored** — a bogus command is refused
`{"code":"MCP_PROBE_FAILED"}` — so the record is only written for a config that actually works.

> **UNVERIFIED sub-clause.** REQ-114 conditions "let an `author` (not only an `admin`) push an MCP
> config" on this traceability, and says the acceptance for the widened permission includes reading
> `pushedBy` back. I could not exercise the **author** path in this deployment:
> ```
> author: push mcp {"type":"stdio",…}  -> {"code":"FORBIDDEN_ROLE","detail":{"mode":"stdio"}}   (admin-only)
> author: push mcp {"type":"http","url":"http://127.0.0.1:8899/mcp"} -> {"code":"EGRESS_DENIED"}
> admin : push mcp {"type":"http", …}  -> {"code":"EGRESS_DENIED"}   (same for admin)
> ```
> `stdio` is admin-only by design (it is arbitrary command execution) and **every** `http` MCP push
> is refused `EGRESS_DENIED` because this deployment has no egress allowlist configured. So the
> widened author permission is not reachable here at all. `pushedBy`/`pushedAt` — the thing the
> permission is conditioned on — is fully verified via the admin path.

---

## REQ-115 — triggers created first, claimed at registration — **FAIL**

Most of this requirement works, and works well. One clause does not, and it is the first one.

### What passes

**A trigger can be created unclaimed and returns its id:**

```
schedule_create {"kind":"cron","cron":"0 3 * * *","tz":"UTC"}
  -> {"result":{"kind":"cron","id":"cd2f14bf…","claimedBy":null,"createdBy":"author@verify.local","enabled":true}}
webhook_create {}
  -> {"result":{"webhookId":"e9bdc477…","url":"http://127.0.0.1:8794/hooks/e9bdc477…","secret":"e512c9e6…"}}
```

**`workflow_register({triggers:[…]})` claims them, and the claim is validated:**

```
register triggers:["00000000-0000-0000-0000-000000000000"]
  -> {"code":"TRIGGER_NOT_FOUND","message":"TRIGGER_NOT_FOUND: 00000000-…","see":"workflow_authoring_guide"}
register triggers:[<schedule id>,<webhook id>]  -> v1, and both now read claimedBy/workflow "reqverify-trig"
```

**A trigger is exclusive:**

```
second workflow claiming the same schedule id
  -> {"code":"TRIGGER_ALREADY_CLAIMED","message":"ALREADY_CLAIMED: b2d64b79…"}
```

**Only the trigger's creator may claim it:**

```
admin creates schedule dbce66cc…; author registers claiming it
  -> {"code":"NOT_TRIGGER_OWNER","message":"NOT_TRIGGER_OWNER: dbce66cc…"}
```

**Registration with no `triggers` leaves the workflow manually-run only** — `workflow_describe`
reports `"triggers":[]` for every workflow registered without them.

**A trigger firing while unclaimed is REFUSED and the refusal is recorded.** Two `once` schedules
were created to fire at the same instant; one was claimed by a registered, published workflow and
one was left unclaimed:

```
UNCLAIMED bea2349b…:
 {"id":"bea2349b…","kind":"once","claimedBy":null,"enabled":false,
  "at":"2026-09-05T03:21:38Z","nextFire":"2026-09-05T03:21:38.000Z",
  "refusalCount":1,"lastRefusedAt":"2026-09-05T03:21:38.338Z","lastRefusalReason":"UNCLAIMED"}
CLAIMED   6f755207…:
 {"claimedBy":"reqverify-sched","refusalCount":0,
  "lastFire":"2026-09-05T03:21:38.348Z","lastRunId":"dd23b584-4fc0-4ad5-a565-b70b7c0961d7"}
run dd23b584… -> startedBy {"type":"schedule","id":"reqverify-sched"}
```

Not silently dropped: a counter, a timestamp and a reason. The claimed one started a real run.

**`workflow_deregister` returns the triggers to UNCLAIMED without deleting them, and says so:**

```
workflow_deregister {"name":"reqverify-trig"} -> {
  "name":"reqverify-trig","removed":true,
  "releasedTriggers":["b2d64b79-906d-4682-9b93-1d7663f54f2c","1914b161-9c02-44c6-8b4e-6b63bcbdeae4"]}
after: schedule b2d64b79… still exists, claimedBy:null
       webhook  1914b161… still exists, workflow:null
```

### What FAILS

**`schedule_create` and `webhook_create` still accept a `workflow` argument and still self-claim.**
The requirement's first clause is explicit — they "create an UNCLAIMED trigger and return its id,
**without naming any workflow** — reversing the pre-v24 direction". Both tools still expose
`workflow` in their input schema and honour it:

```
schedule_create {"kind":"cron","cron":"0 4 * * *","workflow":"reqverify-main"}
  -> {"result":{"kind":"cron","id":"7a138925…","workflow":"reqverify-main",
                "claimedBy":"reqverify-main","createdBy":"author@verify.local","enabled":true}}
webhook_create  {"workflow":"reqverify-main"}
  -> {"result":{"webhookId":"193b7629…","url":"…","secret":"…"}}   (webhook_list shows workflow:"reqverify-main")
```

The pre-v24 direction — a trigger referencing a workflow by name and therefore running whatever
`release` happens to point at — is fully intact alongside the new one.

**It is worse than a leftover parameter: at that site the check has vanished.** The requirement says
`schedule_create`'s pre-v24 release-resolution check (v22 finding H4) *"MOVES to `workflow_register`
… the check does not disappear, it changes site"*. It **did** appear at the new site
(`TRIGGER_NOT_FOUND` above) but the old site was left validating nothing at all — it will claim a
workflow that does not exist:

```
schedule_create {"kind":"cron","cron":"0 5 * * *","workflow":"no-such-wf"}
  -> {"result":{"id":"5a602681…","workflow":"no-such-wf","claimedBy":"no-such-wf","enabled":true}}
webhook_create  {"workflow":"no-such-wf"}
  -> {"result":{"webhookId":"1d867de6…","url":"…","secret":"…"}}   (stored against a workflow that does not exist)
```

So a trigger can be created pointing at a non-existent workflow, bypassing both the old check and
the new one. `workflow_register` cannot then claim that id (it is already `claimedBy` a phantom),
and the reverse lookup the requirement wanted to eliminate is back.

**Verdict: FAIL.** Everything downstream of the claim — exclusivity, ownership, refusal recording,
release-on-deregister — is correct; the reversal of direction that the requirement is *about* was
not completed.

---

## REQ-116 — the engine teaches its own authoring contract — **PARTIAL**

**Discoverable from `tools/list` alone:** `workflow_authoring_guide` is present with the description
*"Return the authoring guide, rendered from the engine's own enforcement constants — parameter
ceilings, reserved names, and the agent-call scanning rules."*

**Every example the guide hands out registers against the real engine.** I parsed all ten
`### <name>` / ```js``` / `Mermaid:` blocks out of the guide text and registered each one verbatim:

| # | guide example | result |
|---|---|---|
| 1 | single agent | accepted v1 |
| 2 | three-stage pipeline | accepted v1 |
| 3 | fan-out/fan-in | accepted v1 |
| 4 | non-agent aggregation | accepted v1 |
| 5 | conditional | accepted v1 |
| 6 | labelled loop | accepted v1 |
| 7 | debate subgraph | accepted v1 |
| 8 | nested workflow() black box | accepted v1 |
| 9 | declared args | accepted v1 |
| 10 | skills and mcp | accepted v1 |

**10/10 accepted.** The v23 failure mode — shipping an `AUTHORING.md` example the engine refuses —
does not recur.

**The guide contains, in one response:** the full sandbox API (`agent`, `parallel`, `pipeline`,
`phase`, `log`, `args`, `budget`, `workflow`); the `meta` shape with a working `params.agents`
example; the authoring rules as a coded refusal list; the complete Mermaid vocabulary of REQ-112
including all five shapes, the three edge forms, the subgraph rule and the loop-label rule; the
engine ceilings as resolved values; the model alias table; and the note that assets are shared
across versions.

**Registration errors point back at this tool:**

```
PARSE_ERROR       -> "see":"workflow_authoring_guide"
MERMAID_*         -> "see":"workflow_authoring_guide"
DIAGRAM_MISMATCH  -> "see":"workflow_authoring_guide"
PARAM_*/DEFAULTS_RETIRED/AGENT_* -> "see":"workflow_authoring_guide"
TRIGGER_NOT_FOUND -> "see":"workflow_authoring_guide"
```

covering all four categories the requirement names (parse, contract, diagram, trigger).

### Where it falls short

**1. The one-level nesting limit and the FLATTEN instruction are not there — the guide says the
opposite.** The requirement asks the guide to carry *"the one-level nesting limit and the
instruction to FLATTEN when more depth is needed"*. The guide instead documents a configurable
depth and explicitly retires that teaching:

> "A `workflow()` call may itself call `workflow()` again, recursing up to this deployment's
> configured `maxWorkflowDepth` … **(An earlier one-level cap with a flatten-it instruction is what
> an older draft of this guide taught — that no longer matches what's shipped.)**"

The engine agrees with the guide, not with the requirement: I registered a three-level chain
(`depth3 → depth2 → depth1`) and all three were accepted. So this is a **stale requirement**, not a
documentation defect — but as written, REQ-116's acceptance is not met.

**2. `workflow_register`'s description does not tell a cold client to call the guide *first*.** The
requirement says *"`workflow_register`'s description tells it to call that first"*. What it actually
says is a bare cross-reference on the last line:

```
Register a new workflow version under a name; the caller becomes its owner.
Errors: SCRIPT_INVALID, PARSE_ERROR, … FORBIDDEN_ROLE
See also: workflow_authoring_guide
```

"See also" is a pointer, not an instruction to call it first.

**3. The tunable-versus-locked "table" is two sentences.** The requirement asks for the table *"with
where each is written and how a user changes it"*. The guide gives:

> "The six locked keys are engine-owned and can never be overridden by a caller: prompt, tools,
> skills, mcp, workdir, cwd. The four tunable keys an override may target, per declared agent label,
> are: model, effort, timeoutMs, appendPrompt."

Correct and complete as to *which* keys, but it does not say where each is written or how a user
changes it. (The information exists elsewhere in the guide; it is not in this passage.)

**Verdict: PARTIAL.** The load-bearing clause — every example registers — passes outright. Three
descriptive clauses do not match what ships, one of which is the requirement being stale rather than
the engine being wrong.

---
## REQ-117 — a cold model, given only the schema and the guide, gets it right the first time — **PASS on the authoring contract; the result readback is degraded**

### The subject, and its honest limits

REQ-117 disqualifies "anyone who has seen this project's development conversation — including the
orchestrator and any advisor". I have read `REQS.md` (the acceptance text) but not this project's
development conversation; regardless, I am the verifier and therefore not an eligible subject. The
subject was a **separate model instance with a fresh context**, spawned for this experiment and
handed nothing but the engine URL, an `author` bearer token, and the instruction to discover the
tool set and call `workflow_authoring_guide`. It was explicitly told not to read `REQS.md`,
`TASK.md`, or anything else on the filesystem.

**Three limits on this evidence, stated plainly:**

1. The subject is a fresh *context*, not an independently sourced model. It shares my model family
   and was launched by me. It is the coldest subject available in this environment; it is not the
   fully independent instance the requirement envisages.
2. **I gave it one hint the guide does not contain:** that this deployment's model is slow and every
   agent needs `timeoutMs` ≥ 300000. Without it, every agent would have timed out for reasons that
   have nothing to do with the documentation. This is deployment knowledge a real operator would
   have, but it is a departure from "handed only `tools/list` and `workflow_authoring_guide`" and it
   is material — the subject did not have to discover the timeout ceiling on its own.
3. A description review was not substituted for the run. The run is real and is quoted below.

### What it produced, first try

A genuinely multi-agent collaborating workflow — three researchers fanned out, a synthesizer merging
them, and a bounded critic/synthesizer revision loop — registered as `coldtest-research-brief`:

```
graph TD
topic[/"topic (run argument)"/]
r1(["researcher"])  r2(["researcher"])  r3(["researcher"])
synthesizer(["synthesizer"])
critic(["critic"])
out[/"approved briefing"/]
topic-->r1   topic-->r2   topic-->r3
r1-->synthesizer   r2-->synthesizer   r3-->synthesizer
synthesizer-->|draft|critic
critic-->|revise|synthesizer
critic-->out
```

(one edge per line, three distinct stadium ids all labelled `researcher`, a labelled back-edge for
the loop, trapezoids for the run argument and the output.)

### Verified independently from the engine, not just from its self-report

```
workflow_list -> {"name":"coldtest-research-brief","owner":"author@verify.local",
                  "versions":["v1"],"channels":{"release":"v1","beta":null},"runnable":true}
run_list      -> {"runId":"74c400ec-e3d0-4e99-8810-1d82b0002983","status":"completed",
                  "scriptVersion":"v1","startedBy":{"type":"client"}}
run_status    -> phases: research(03:27:40) -> synthesize(03:30:39) -> critique(03:33:55)
                 agents: researcher done, researcher done, researcher done,
                         synthesizer done, critic done, synthesizer done, critic done, synthesizer done
run_result    -> {"status":"completed","result":"…"}
```

Eight agent calls, all `done`, across the three phases the script declares, on version `v1` — there
is only one registered version, and the release pointer moved once.

**Its call log, which I asked it not to sanitise, reports zero errors and zero retries:** `tools/list`,
`workflow_authoring_guide`, then `workflow_register` → v1, `workflow_publish` → release,
`run_start` → running, 30 `run_status` polls, `run_result`, plus a `workflow_describe` and a
`run_agent_log`. Every call HTTP 200 with a `result` envelope; no JSON-RPC error and no engine error
code at any point. Register, publish and `run_start` each succeeded on the first attempt.

*(One discrepancy: it reported `tools/list` returning 34 tools; I measured 35 twice, directly. I
treat this as a miscount on its side, not an engine inconsistency.)*

### Where it falls short: "reads back a correct result"

The run completed and a result was read back, but the result is **not correct**. The local model
behind this deployment's aliases emits raw tool-call JSON instead of prose:

```
run_result -> "{\n  \"name\": \"Bash\",\n  \"arguments\": {\n    \"command\": \"cat /path/to/…
   | Grep -oP '(?s)^(Mechanical wristwatch escapement|^Origins|^History).*?' …\",\n
     \"description\": \"Extract relevant sections from documents about mechanical wristwatch
     escapement history, origins, and history.\"\n  }\n}"
```

The same degeneracy appeared in my own control run (`run_result` → `{"name":"Grep","arguments":…}`
for the prompt "Answer in one short sentence: What is 2+2?"). So this is a **model-quality property
of this deployment**, not an authoring or engine defect: the orchestration was correct, the critic
loop ran its full two iterations exactly as written because the critic never returned `APPROVED`,
and the degenerate text propagated to the return value.

**Verdict.** The clause this requirement exists to test — *authors a multi-agent workflow with its
Mermaid, registers it, publishes it, runs it, on the first attempt with no trial and error* — is
**met**. The trailing clause *"and reads back a correct result"* is **not** met, for a reason that
lies in the deployment's model rather than in the guide or the engine.

### Documentation defects the experiment surfaced

REQ-117 says a step the subject gets wrong is a defect in the documentation. It got no step wrong —
but it reported that it only succeeded by reading information out of the *worked examples* and the
*tool descriptions* that the guide's prose never states. Two of its six claims I verified myself
against the guide text, and both hold:

**1. The guide never mentions `workflow_publish` or the release pointer at all.** Verified: searching
the full 19,526-byte guide for `workflow_publish`, `publish`, `release pointer` or `release channel`
returns nothing; the one occurrence of the substring "release" is about *trigger* release. The guide
has a section literally titled "Registration and versioning" that never says a registered workflow
needs a release before `run_start` will run it. The subject avoided `CHANNEL_UNPUBLISHED` only
because `run_start`'s **tool description** carries the warning ("First-try traps: a just-registered
workflow has no release — call workflow_publish first"). A cold client reading the guide and not the
tool descriptions fails here. **This is the most serious gap, and it bears directly on REQ-116**,
which requires the guide to teach the authoring contract in one response.

**2. The guide never describes the default tool surface.** Verified: no occurrence of `tools:`,
`surfaceType`, `curated`, `Bash` or `Glob` outside the error table. `tools` is listed among the six
locked keys — so an author cannot set it — yet the guide never says what an agent actually gets.
`run_agent_log` shows the real surface is `["Write","Edit","Glob","Grep","Bash"]` with
`surfaceType:"curated"`. The subject notes this plausibly *caused* the degenerate output: a model
handed Bash in its tool surface emitted a Bash call instead of prose.

Its four further observations, which I did not independently confirm and record as reported:

3. The script body's *shape* is never specified — every example is `export const meta = {…}` followed
   by a bare top-level `return`, which is not valid at ES-module top level; nothing states that the
   body is wrapped in an async function.
4. "The stadium (agent) nodes MUST exactly match your script's `agent()` labels" is ambiguous between
   the node **id** and the node **text**; read alone it implies the id must be the label, which would
   make fan-out impossible since ids must be unique. Only the fan-out example reveals that the
   bracket text is what is diffed.
5. `parallel` is documented as returning `null` per failed thunk but never promises results come back
   in input order — which scripts that zip results against their inputs depend on.
6. `workflow_register` returns both `"version":1` (number) and `result.version:"v1"` (string); only
   `workflow_publish`'s field description disambiguates which to pass back.

---

## REQ-118 — every MCP tool's interface exercised once against a live engine — **PARTIAL**

Every one of the 35 tools was called at least once over real MCP HTTP against the booted engine with
its required arguments, and each response was asserted against that tool's own documented contract
rather than merely "did not error". 30 pass, 5 are UNVERIFIED for an environmental reason, and two
contract deviations are recorded.

| # | tool | arguments (representative) | observed response | verdict |
|---|---|---|---|---|
| 1 | `workflow_register` | `{name,script,mermaid}` | `{"version":1,"result":{"name":…,"version":"v1"}}` | PASS* |
| | | + 14 error paths | `MERMAID_REQUIRED`, `MERMAID_INVALID`, `DIAGRAM_MISMATCH`, `SCAN_VIOLATION`, `DEFAULTS_RETIRED`, `PARAM_CONTRACT_INVALID`, `AGENT_UNDECLARED`, `AGENT_DECLARED_NOT_IN_SCRIPT`, `PARSE_ERROR`, `TRIGGER_NOT_FOUND`, `TRIGGER_ALREADY_CLAIMED`, `NOT_TRIGGER_OWNER`, `NOT_WORKFLOW_OWNER`, `FORBIDDEN_ROLE` | |
| 2 | `workflow_deregister` | `{name:"reqverify-trig"}` | `{"removed":true,"releasedTriggers":["b2d64b79…","1914b161…"]}` | PASS |
| | | `{name:"reqverify-adminwf"}` as author | `NOT_WORKFLOW_OWNER` | |
| 3 | `workflow_publish` | `{name,version:"v2",channel:"release"}` | `{"channel":"release","version":"v2","from":null}` | PASS |
| | | `{version:"v99"}` | `VERSION_NOT_FOUND` | |
| 4 | `workflow_describe` | `{name:"reqverify-main"}` | full per-agent `params`, `lockedKeys`, `mermaid`, `triggers`, `runnable:true` | PASS |
| | | `{name:"no-such-wf"}` / `{version:"v9"}` / `{channel:"beta"}` | `WORKFLOW_NOT_FOUND` / `VERSION_NOT_FOUND` / `CHANNEL_UNPUBLISHED` | |
| 5 | `workflow_source` | `{name,version:"v2"}` as owner | `script` present, 793 B | PASS |
| | | as non-owner author | `scriptWithheld:true`, no `script` | |
| | | as `user` | `FORBIDDEN_ROLE` | |
| 6 | `workflow_list` | `{}` / `{onlyRunnable:true}` | 26 rows / 3 rows; every row carries `runnable`; every filtered row `runnable:true`; every excluded row `runnable:false` | PASS |
| 7 | `workflow_authoring_guide` | `{}` | full guide text; all 10 embedded examples register | PASS |
| 8 | `run_start` | `{name,args,overrides}` | `{"runId":"532ba7ed…","status":"running"}` | PASS |
| | | unpublished workflow | `CHANNEL_UNPUBLISHED: release (workflow 'reqverify-main')` | |
| | | + `WORKFLOW_NOT_FOUND`, `PARAM_LOCKED`, `PARAM_UNKNOWN`, `PARAM_OUT_OF_RANGE`, `UNKNOWN_AGENT_LABEL`, `UNKNOWN_ALIAS` | all as documented | |
| 9 | `run_status` | `{runId}` | terminal outcome + `phases` + per-agent states + `adminReads[]` | PASS |
| | | unknown id | `RUN_NOT_FOUND` | |
| 10 | `run_result` | `{runId:"af905f18…"}` | `{"status":"completed","result":"{…}"}` | PASS† |
| | | on a `stopped` run | `RUN_NOT_TERMINAL` | |
| 11 | `run_suspend` | `{runId}` | `{"status":"suspended"}` | PASS |
| | | on a terminal run | `ILLEGAL_TRANSITION: stopped → suspended` | |
| 12 | `run_resume` | `{runId}` | `{"status":"running"}` | PASS |
| 13 | `run_stop` | `{runId}` | `{"status":"stopped"}` | PASS |
| 14 | `run_agent_log` | `{runId,label:"scout"}` | `harness{model,provider,prompt,tools,skills,mcpServers,materialized,effort,timeoutMs,provenance}` + events | PASS |
| | | bad label / bad run | `AGENT_LOG_NOT_FOUND` / `RUN_NOT_FOUND` | |
| 15 | `run_list` | `{}`,`{workflow}`,`{status}`,`{limit}` | filters honoured; caller-scoped; unfiltered for admin | PASS |
| 16 | `workspace_diff` | `{manifest:[…]}` | `{"missing":["1111…1"]}`; per-principal pool proven | PASS |
| 17 | `workspace_push` | `{sha256,contentB64}` | `{"sha256":…,"accepted":true}` | PASS |
| | | mismatched hash | `BLOB_HASH_MISMATCH: declared … != computed …` | |
| | | + `INVALID_ARGUMENT`, `RESERVED_PREFIX`, `WORKSPACE_ESCAPE`, `FORBIDDEN_ROLE`, `NOT_WORKFLOW_OWNER`, `MCP_PROBE_FAILED`, `EGRESS_DENIED` | every documented error exercised | |
| 18 | `workspace_pull` | `{runId,path}` / `{offset,length}` | `{"size":2,"offset":1,"length":1,"base64":"aw=="}` | PASS |
| | | `../../etc/passwd` / missing / other's run | `WORKSPACE_ESCAPE` / `NOT_FOUND` / `NOT_RUN_OWNER` | |
| 19 | `workspace_list` | `{runId}` / `{workflow,kind}` | run files; assets with `scope`,`builtin`,`pushedBy`,`pushedAt` | PASS |
| | | deregistered wf / other's run | `WORKFLOW_NOT_FOUND` / `NOT_RUN_OWNER` | |
| 20 | `workspace_delete` | `{runId,paths}` terminal | `{"deleted":[".mcp.json"],"missing":[],"rejected":[]}` | PASS |
| | | while running/suspended; global as author | `RUN_NOT_TERMINAL` / `FORBIDDEN_ROLE` | |
| 21 | `workspace_purge` | `{runId}` terminal | `{"purged":true}` | PASS |
| | | while running | `RUN_NOT_TERMINAL` | |
| 22 | `schedule_create` | `{kind:"cron",cron:"0 3 * * *",tz:"UTC"}` | `{"id":"cd2f14bf…","claimedBy":null,"createdBy":"author@verify.local"}` | **FAIL** |
| | | `{…,workflow:"no-such-wf"}` | accepted, `claimedBy:"no-such-wf"` — see REQ-115 | |
| 23 | `schedule_list` | `{}` | rows with `claimedBy`,`createdBy`,`nextFire`,`refusalCount`,`lastRefusalReason` | PASS |
| 24 | `schedule_delete` | `{id}` | `{}` (empty result body) | PASS‡ |
| | | again | `TRIGGER_NOT_FOUND: Unknown schedule: …` | |
| 25 | `schedule_setEnabled` | `{id,enabled:false}` / `true` | `{}`; `schedule_list` reflects the change | PASS‡ |
| | | bad id | `TRIGGER_NOT_FOUND` | |
| 26 | `webhook_create` | `{}` | `{"webhookId":…,"url":…,"secret":…}` | **FAIL** |
| | | `{workflow:"no-such-wf"}` | accepted and bound — see REQ-115 | |
| 27 | `webhook_list` | `{}` | rows with `workflow`,`createdBy`,`secretFingerprint`,`refusalCount` | PASS |
| 28 | `webhook_delete` | `{id}` | `{"deleted":true}` | PASS |
| | | again | `TRIGGER_NOT_FOUND: Unknown webhook: …` | |
| 29 | `issue_report` | `{title,reproSteps,analysis}` | `GITHUB_TOKEN_MISSING` | **UNVERIFIED** |
| 30 | `issue_get` | `{number:1}` | `GITHUB_TOKEN_MISSING` | **UNVERIFIED** |
| 31 | `issue_list` | `{}` | `GITHUB_TOKEN_MISSING` | **UNVERIFIED** |
| 32 | `issue_get_comments` | `{number:1}` | `GITHUB_TOKEN_MISSING` | **UNVERIFIED** |
| 33 | `issue_comment_post` | `{number,body}` | `GITHUB_TOKEN_MISSING` | **UNVERIFIED** |
| 34 | `models_list` | `{provider:"ollama"}`, `{toolUse,limit}`, `{minContext}`, `{query}` | each filter correctly narrows the catalog | PASS |
| 35 | `system_info` | `{topN:1/5/50/999}` | `cpu`,`memory`,`disk`,`process`,`sampledAt`,`windowMs`; `topN=999` **clamped to 50** as documented | **FAIL** |

`*` `workflow_register` passes its documented contract but does **not** enforce the reserved-prefix
rule on the workflow name — recorded as a defect below.
`†` see the note below on `completed` runs whose agents all failed.
`‡` returns an empty result body where sibling tools return a confirmation payload — cosmetic.

**`workflow_list` reports `runnable` per workflow and accepts `onlyRunnable`** (the requirement's last
clause): 26 workflows total, 3 runnable; every row carries the field, every `onlyRunnable` row is
`runnable:true`, and every excluded row is `runnable:false`. A `user` is therefore not shown drafts
that would refuse.

### The five UNVERIFIED rows

All five `issue_*` tools return a clean typed error and nothing else, because this deployment has no
GitHub credential:

```
issue_list / issue_get / issue_get_comments / issue_report / issue_comment_post
  -> {"code":"GITHUB_TOKEN_MISSING","message":"GitHub token not configured (set RWE_SECRET_GITHUB_TOKEN)"}
```

Their *error* path is exercised and correct; their documented success contract (issue numbers,
bodies, comment payloads) cannot be asserted without a token, and creating one would mean writing to
a real GitHub repository. Listed as UNVERIFIED with the reason, not omitted.

### Contract deviations found by this requirement

**1. `system_info` omits the `auth` block entirely — FAIL against its own contract.** Its description
reads: *"Report engine system info: CPU, memory, disk, active processes, **and the auth summary**…
A block whose probe is unavailable on this host is served as null with a reason, **never omitted**."*
Observed, on an engine with auth ON and three principals configured:

```
system_info {"topN":2} as admin
  -> result keys: ['cpu','disk','memory','process','sampledAt','windowMs']
     "auth" in result -> False
```

The block is not `null`-with-a-reason; it is absent. Confirmed on both the 8794 verification engine
and the 8899 instance, and on the dashboard's `/api/system`. Everything else in the tool's contract
checks out, including the documented clamping of an out-of-range `topN` (999 → 50 rows, not refused).

**2. `workflow_register` does not enforce the reserved `rwe-` prefix on the workflow name.** The
engine's own guide lists `RESERVED_PREFIX — the name **or** a path segment starts with the
engine-reserved 'rwe-' prefix (ARCH-093)`. It is enforced on assets but not on the name:

```
workspace_push asset name "rwe-nope"          -> {"code":"RESERVED_PREFIX"}
workspace_push asset path "rwe-seg/f.md"      -> {"code":"RESERVED_PREFIX"}
workflow_register {"name":"rwe-evil",…}       -> {"version":1,"result":{"name":"rwe-evil","version":"v1"}}
workflow_register {"name":"rwe-internal",…}   -> accepted
workflow_register {"name":"rwe-"}             -> accepted
workflow_list -> ['rwe-evil','rwe-evil2','rwe-internal','rwe-']
```

Reproducible; a caller can occupy the engine's reserved namespace.

### One further observation, recorded honestly

**A run whose every agent failed is reported `completed`.** Run `532ba7ed…` finished with all three
agents in state `failed` (all model timeouts) and `run_result` → `{"status":"completed","result":null}`.
Consequently `run_list {"status":"failed"}` returns `[]` for it. That is defensible as "the script
ran to completion" — `parallel()` is documented to return `null` per failed thunk rather than
rejecting — but it undercuts the stated purpose REQ-107 gives `run_list`: *"which runs of this
workflow failed recently is answerable without fetching everything."* By that filter, this run did
not fail. The dashboard shows the same run as `COMPLETED` with a quiet "3 warning(s)".

Relatedly, `stopped` is treated as terminal by `workspace_delete`/`workspace_purge` but as
non-terminal by `run_result` (`RUN_NOT_TERMINAL: … has not completed (status: stopped)`) — the same
word means two things across tools.

---

## Browser findings (Playwright, real Chromium against `http://127.0.0.1:8794/dashboard`)

**What works.**

*The workflow list is really on the page.* Grouped into RUNNING / REGISTERED / OTHER, one card per
workflow with its description and metrics, no console errors:

```
card titles: reqverify-main | reqverify-sched | reqverify-loop | reqverify-debate | reqverify-nest |
             reqverify-shapes | reqverify-p | reqverify-al3 | reqverify-al4 | reqverify-smoke |
             reqverify-trig | reqverify-adminwf
RUNNING   reqverify-main  "declares one skill only"  sr: 100% · avg: 330180ms · runs: 1
REGISTERED reqverify-debate "two agents debate"       sr: — · avg: — · runs: 0
```

*The run view is really on the page.* Navigating to `/dashboard/532ba7ed-fd2d-431c-a089-7f0c9564a8e4`:

```
RUN 532BA7ED-FD2D-431C-A089-7F0C9564A8E4 COMPLETED
STEPS scout synthesize
client
scout
scout
synth
3 warning(s)
```

The phases (`scout`, `synthesize`) and all three agent nodes (two `scout`, one `synth`) render, which
is the run's real shape. `/api/system` and `/api/models` render live and correctly.

**FAIL — the author's diagram and the per-agent parameters cannot be seen in the browser at all.**

The workflow-detail view is the only place the UI shows the author-supplied Mermaid and the
per-agent params. Clicking any workflow card opens the detail pane, and it stays blank. The
shipped dashboard JS builds this URL:

```js
var s = await getJSON('/api/workflows/' + encodeURIComponent(name) + '/describe'); if(!s) return;
…
var pre = document.getElementById('diagram'); pre.textContent = s.mermaid || '';
```

and `getJSON` returns `null` on a non-OK response, so `renderDescribe` returns before writing
anything. Captured from the browser's own network log after clicking `reqverify-debate`:

```
401 http://127.0.0.1:8794/api/workflows/reqverify-debate/describe
401 http://127.0.0.1:8794/api/workflows/reqverify-debate/describe
detail pane -> {"detailVisible":"block","title":"","diagram":""}
```

Probed directly, the endpoint answers no one:

```
/api/workflows/reqverify-debate/describe   anonymous -> 401     with admin bearer -> 404
/api/workflows                             anonymous -> 200     (list works)
/api/runs/<id>  and  /api/runs/<id>/dag    anonymous -> 200     (run view works)
/api/system, /api/models, /api/home        anonymous -> 200
```

The dashboard is otherwise an unauthenticated read-only surface, so it has no bearer to send; and
even with a valid admin bearer the route is a 404, so no client can reach it. The consequence for
this verification:

- **REQ-111 / REQ-112** — the diagram is confirmed stored and served verbatim by
  `workflow_describe` over MCP, and the vocabulary is enforced at registration. It is **not**
  confirmed visible to a person, because the page that would show it never loads.
- **REQ-110** — `workflow_describe` reports per-agent params over MCP, so *"a user sees what each
  agent can be tuned to before spending anything"* holds for an MCP client but not for a dashboard
  user.

I have marked REQ-111 and REQ-112 PASS on the engine behaviour they specify, and recorded this as a
separate dashboard defect rather than failing them, because neither requirement's acceptance text
mentions the dashboard. It does mean the visual confirmation TASK.md asks for could not be obtained
for the diagram.

*Environment note:* the preconfigured Playwright MCP server could not start — it is pinned to a
`chrome` channel that is not installed here (`Chromium distribution 'chrome' is not found at
/opt/google/chrome/chrome`). I installed Chromium and drove it through the Playwright library
directly; the browser, the page and the network log are real.

---
## Summary

| REQ | Subject | Verdict |
|---|---|---|
| REQ-107 | one prefix per entity; old names absent | **PASS** |
| REQ-108 | six workspace tools, per-tool modes, shared path verdict | **PASS** |
| REQ-109 | three roles, ownership, cross-principal audit record | **PASS** |
| REQ-110 | every tunable declared and overridable per agent | **PASS** (error-code naming deviation) |
| REQ-111 | author supplies the diagram; engine holds it to the script | **PASS** (not visible in the UI — see dashboard defect) |
| REQ-112 | fixed Mermaid vocabulary | **PASS** (one convention not mechanically checked) |
| REQ-113 | assets per workflow, declared per agent, materialized selectively | **PASS** |
| REQ-114 | every upload records who did it | **PASS** (author-push sub-clause UNVERIFIED) |
| REQ-115 | triggers created first, claimed at registration | **FAIL** |
| REQ-116 | the engine teaches its own authoring contract | **PARTIAL** |
| REQ-117 | a cold model gets it right the first time | **PASS** on authoring; result readback degraded |
| REQ-118 | every tool exercised against a live engine | **PARTIAL** (30 PASS, 5 UNVERIFIED, 2 deviations) |

**Honest count: 8 PASS, 1 FAIL, 2 PARTIAL, 1 PASS-with-a-caveat-that-matters (REQ-117).**

### The defects, in the order I would fix them

1. **REQ-115 — `schedule_create`/`webhook_create` still accept `workflow` and self-claim.** The
   direction reversal this requirement is *about* was not completed; worse, the old site now
   validates nothing, so a trigger can be created claimed by a workflow that does not exist. Everything
   downstream of the claim is correct.
2. **The dashboard cannot show any workflow's diagram or parameters.** `/api/workflows/<name>/describe`
   — the exact URL the shipped dashboard JS builds — is 401 anonymous and 404 with a valid admin
   bearer. The detail pane renders blank for every workflow. Confirmed in a real browser with its
   network log.
3. **The authoring guide never mentions `workflow_publish`.** A cold client that reads the guide and
   not the tool descriptions cannot get from `workflow_register` to a run. Bears on REQ-116 and
   REQ-117.
4. **`workflow_register` does not enforce the reserved `rwe-` prefix on the workflow name**, though
   assets enforce it and the guide documents the rule as covering "the name or a path segment".
   `rwe-evil`, `rwe-internal` and `rwe-` all registered.
5. **`system_info` omits the `auth` block** its own description promises, on an engine with auth on —
   and the description explicitly says a block is "served as null with a reason, never omitted".
6. **A run whose every agent failed reports `completed`**, so `run_list({status:'failed'})` cannot
   answer the question REQ-107 introduces `run_list` to answer.
7. Smaller: `PARAM_CONTRACT_INVALID` where REQ-110 names `PARAM_OUT_OF_RANGE` for a declared default;
   the agent-aggregation hexagon convention is unchecked; `stopped` is terminal to
   `workspace_delete` but not to `run_result`; `webhook_create` returns `webhookId` where
   `schedule_create` returns `id`; `workspace_diff` silently ignores surplus arguments where
   `workspace_push` rejects them.

### What could not be verified, and why

| Item | Reason |
|---|---|
| The five `issue_*` tools' success contracts | `GITHUB_TOKEN_MISSING` — no GitHub credential in this deployment, and exercising them would write to a real repository |
| REQ-114's "an **author** may push an MCP config" | `stdio` is admin-only by design; every `http` MCP push is `EGRESS_DENIED` because no egress allowlist is configured. The `pushedBy`/`pushedAt` traceability the clause is conditioned on **is** verified, via admin |
| Author-vs-author ownership refusals (REQ-109) | Only one author principal exists; proven in the author↔admin direction, with admin standing in as "a different principal" |
| Assets unlinked from disk on deregister (REQ-113) | Verified unreachable through the API and that sibling/global assets survive; the engine's filesystem was not inspected |
| An unclaimed **webhook** firing (REQ-115) | Its HMAC scheme needs a timestamp header I could not determine. Proven instead with an unclaimed `once` **schedule**, which the engine fired and refused: `refusalCount:1, lastRefusalReason:"UNCLAIMED"` |
| REQ-117 with a fully independent model | No independently sourced model instance is available here; a fresh-context instance of the same family was used, and I supplied one deployment hint about timeouts |

### Cleanup

Every workflow I registered was deregistered (29 of them, including the four `rwe-*` names that
should never have been accepted), and the cold-model experiment's `coldtest-research-brief` with
them. The 12 schedules and webhooks I created were deleted too — `workflow_deregister` deliberately
returns triggers to UNCLAIMED rather than deleting them (REQ-115), so they needed removing
separately. Final state of the engine: `workflow_list` → `[]`, `schedule_list` → `[]`,
`webhook_list` → `[]`.

One thing I could **not** clean up: the 7 run rows from this verification remain in `run_list`.
No v24 tool deletes a run record — `workspace_purge` removes a run's workspace from disk (and I used
it) but the run row itself persists, and there is no `run_delete`. The next person starts from an
empty workflow/trigger surface with seven historical runs of now-deregistered workflows still listed.

Nothing that existed before I started was touched. The engine's source was not modified — this was a
black-box verification throughout; I never located or read the engine's source tree.
