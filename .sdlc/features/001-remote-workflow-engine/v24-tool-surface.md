# v24 tool surface — REQ-118

rows: 35/35

- issue_report: unverified — args={"title":"fixture issue","reproSteps":"call issue_report","analysis":"REQ-118 surface probe"} observed="UNVERIFIED(no GitHub token)"
- issue_get: unverified — args={"number":1} observed="UNVERIFIED(no GitHub token)"
- issue_list: unverified — args={} observed="UNVERIFIED(no GitHub token)"
- issue_get_comments: unverified — args={"number":1} observed="UNVERIFIED(no GitHub token)"
- issue_comment_post: unverified — args={"number":1,"body":"hi"} observed="UNVERIFIED(no GitHub token)"
- workflow_register: pass — args={"name":"demo","script":"export const meta = {\n  description: 'Greet the caller in one sentence',\n  params: { agents: { greet: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },\n};\nreturn await agent('greet', { prompt: 'Say hello' });","mermaid":"graph TD;\ngreet([\"greet\"])"} observed={"runId":"","status":"completed","version":2,"result":{"name":"demo","version":"v2"}}
- workflow_publish: pass — args={"name":"demo","version":"v1","channel":"release"} observed={"runId":"","status":"completed","result":{"channel":"release","version":"v1","from":"v1"}}
- workflow_describe: pass — args={"name":"demo"} observed={"runId":"","status":"completed","result":{"name":"demo","version":"v1","resolvedBy":"default-release","channels":{"release":"v1","beta":null},"versions":["v1","v2"],"description":"Greet the caller in
- workflow_source: pass — args={"name":"demo"} observed={"runId":"","status":"completed","owner":null,"params":{"agents":{"greet":{"model":{"type":"string","default":"default"},"effort":{"type":"enum","enum":["low","medium","high"],"default":"low"},"timeou
- workflow_list: pass — args={} observed={"runId":"","status":"completed","result":[{"name":"demo","owner":null,"versions":["v1","v2"],"channels":{"release":"v1","beta":null},"runnable":true},{"name":"demo-quick","owner":null,"versions":["v1
- workflow_authoring_guide: pass — args={} observed={"runId":"","status":"completed","result":{"text":"# Authoring a workflow script\n\nThis engine has no bundled guidance skill — the tool schemas returned by `tools/list` are the only documentation a c
- run_start: pass — args={"name":"demo"} observed={"runId":"142d8a3b-1b28-44f4-9f6c-8069ce94106b","status":"running","result":{"runId":"142d8a3b-1b28-44f4-9f6c-8069ce94106b"}}
- run_status: pass — args={"runId":"7a31cd85-a141-4cd4-a402-2978569d713d"} observed={"runId":"7a31cd85-a141-4cd4-a402-2978569d713d","status":"completed","result":{"runId":"7a31cd85-a141-4cd4-a402-2978569d713d","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"7a31cd85-a141-4cd4-a402-2978569d713d"} observed={"runId":"7a31cd85-a141-4cd4-a402-2978569d713d","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"cb1b77f2-98a3-4c4f-8a0d-4d96b1d2281c"} observed={"runId":"cb1b77f2-98a3-4c4f-8a0d-4d96b1d2281c","status":"suspended"}
- run_resume: pass — args={"runId":"9b246e7a-e1c5-4c34-800e-b9f2e1058b4f"} observed={"runId":"9b246e7a-e1c5-4c34-800e-b9f2e1058b4f","status":"running"}
- run_stop: pass — args={"runId":"353139f4-2a47-44e9-b69e-c97cd4a2d0fe"} observed={"runId":"353139f4-2a47-44e9-b69e-c97cd4a2d0fe","status":"stopped"}
- run_agent_log: pass — args={"runId":"75743e1b-a418-44e6-88e2-550e634b0cb9","label":"greet"} observed={"runId":"75743e1b-a418-44e6-88e2-550e634b0cb9","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"142d8a3b-1b28-44f4-9f6c-8069ce94106b","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-05T02:41:41.783Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"7a31cd85-a141-4cd4-a402-2978569d713d","path":"output.txt"} observed={"runId":"7a31cd85-a141-4cd4-a402-2978569d713d","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"7a31cd85-a141-4cd4-a402-2978569d713d"} observed={"runId":"7a31cd85-a141-4cd4-a402-2978569d713d","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"7a31cd85-a141-4cd4-a402-2978569d713d","paths":["output.txt"]} observed={"runId":"7a31cd85-a141-4cd4-a402-2978569d713d","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"cron":"* * * * *"} observed={"result":{"kind":"cron","id":"90dcddcc-0d4a-48ba-b701-c16e1affc12e","claimedBy":null,"cron":"* * * * *","enabled":true}}
- schedule_list: pass — args={} observed={"result":[{"id":"db7212bb-2fd4-4ae9-9ed7-bb344922055a","kind":"cron","workflow":"demo","claimedBy":"demo","enabled":true,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"i
- schedule_delete: pass — args={"id":"60209343-c3ee-4915-8814-749db4e72910"} observed={}
- schedule_setEnabled: pass — args={"id":"db7212bb-2fd4-4ae9-9ed7-bb344922055a","enabled":false} observed={}
- webhook_create: pass — args={} observed={"result":{"webhookId":"58a48008-0b48-4106-8c9e-51fcde54fa2a","url":"http://127.0.0.1:45487/hooks/58a48008-0b48-4106-8c9e-51fcde54fa2a","secret":"e8b6012c709e46b82f6391cc43dc68b896de72d1edc444b59a93e2
- webhook_list: pass — args={} observed={"result":[{"id":"8e9842bc-b62e-43fc-b9c9-379e1d96201e","workflow":"demo","createdBy":null,"enabled":true,"secretFingerprint":"44fb6d24f161bbfe","refusalCount":0},{"id":"58a48008-0b48-4106-8c9e-51fcde
- webhook_delete: pass — args={"id":"8e9842bc-b62e-43fc-b9c9-379e1d96201e"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[0.75,0.72,0.68],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":85
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":["db7212bb-2fd4-4ae9-9ed7-bb344922055a"],"result":{"name":"demo","removed":true,"releasedTriggers":["db7212bb-2fd4-4ae9
- workspace_purge: pass — args={"runId":"7a31cd85-a141-4cd4-a402-2978569d713d"} observed={"runId":"7a31cd85-a141-4cd4-a402-2978569d713d","status":"completed","result":{"purged":true}}
