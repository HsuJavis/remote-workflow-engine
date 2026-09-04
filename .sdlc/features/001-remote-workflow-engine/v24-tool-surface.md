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
- run_start: pass — args={"name":"demo"} observed={"runId":"07942c53-61fd-46e5-b643-0dd9e385a6ca","status":"running","result":{"runId":"07942c53-61fd-46e5-b643-0dd9e385a6ca"}}
- run_status: pass — args={"runId":"9f8a1024-1f44-48d7-8ec4-547faaf85150"} observed={"runId":"9f8a1024-1f44-48d7-8ec4-547faaf85150","status":"completed","result":{"runId":"9f8a1024-1f44-48d7-8ec4-547faaf85150","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"9f8a1024-1f44-48d7-8ec4-547faaf85150"} observed={"runId":"9f8a1024-1f44-48d7-8ec4-547faaf85150","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"ce73c34f-0c47-4994-85b9-8916548cea92"} observed={"runId":"ce73c34f-0c47-4994-85b9-8916548cea92","status":"suspended"}
- run_resume: pass — args={"runId":"d53f4c38-2ec3-494a-aa4f-8a8c0f29a516"} observed={"runId":"d53f4c38-2ec3-494a-aa4f-8a8c0f29a516","status":"running"}
- run_stop: pass — args={"runId":"d4846ea9-c211-4e2f-af23-8533f25c6367"} observed={"runId":"d4846ea9-c211-4e2f-af23-8533f25c6367","status":"stopped"}
- run_agent_log: pass — args={"runId":"cf9e03d2-4329-45ce-87f5-ea3a18c89a2d","label":"greet"} observed={"runId":"cf9e03d2-4329-45ce-87f5-ea3a18c89a2d","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"07942c53-61fd-46e5-b643-0dd9e385a6ca","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-04T13:08:38.172Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"9f8a1024-1f44-48d7-8ec4-547faaf85150","path":"output.txt"} observed={"runId":"9f8a1024-1f44-48d7-8ec4-547faaf85150","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"9f8a1024-1f44-48d7-8ec4-547faaf85150"} observed={"runId":"9f8a1024-1f44-48d7-8ec4-547faaf85150","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"9f8a1024-1f44-48d7-8ec4-547faaf85150","paths":["output.txt"]} observed={"runId":"9f8a1024-1f44-48d7-8ec4-547faaf85150","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"workflow":"demo","cron":"* * * * *"} observed={"result":{"kind":"cron","id":"a2fe6873-18f9-434c-a4ef-464db3cf46d2","workflow":"demo","claimedBy":"demo","cron":"* * * * *","enabled":true}}
- schedule_list: pass — args={} observed={"result":[{"id":"6046d53f-2aa2-4dd2-a08e-67cbe7aa2810","kind":"cron","workflow":"demo","claimedBy":"demo","enabled":true,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"i
- schedule_delete: pass — args={"id":"7b943539-283d-41f8-8b44-37e2fef35408"} observed={}
- schedule_setEnabled: pass — args={"id":"6046d53f-2aa2-4dd2-a08e-67cbe7aa2810","enabled":false} observed={}
- webhook_create: pass — args={"workflow":"demo"} observed={"result":{"webhookId":"09659c79-776c-496b-83d5-7d47b61b0b9e","url":"http://127.0.0.1:35385/hooks/09659c79-776c-496b-83d5-7d47b61b0b9e","secret":"56cf8570760472f435efd7d8d99bfee15d47c651ef64d4d01a1a6f
- webhook_list: pass — args={} observed={"result":[{"id":"8b711303-3297-44df-94dd-0b462cb3d805","workflow":"demo","createdBy":null,"enabled":true,"secretFingerprint":"6e3bbaf8ffe3fe7f","refusalCount":0},{"id":"09659c79-776c-496b-83d5-7d47b6
- webhook_delete: pass — args={"id":"8b711303-3297-44df-94dd-0b462cb3d805"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[1.14,0.85,1.28],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":10
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":[],"result":{"name":"demo","removed":true,"releasedTriggers":[]}}
- workspace_purge: pass — args={"runId":"9f8a1024-1f44-48d7-8ec4-547faaf85150"} observed={"runId":"9f8a1024-1f44-48d7-8ec4-547faaf85150","status":"completed","result":{"purged":true}}
