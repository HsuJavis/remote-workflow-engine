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
- run_start: pass — args={"name":"demo"} observed={"runId":"18436785-1e7d-413e-97c1-629323832ace","status":"running","result":{"runId":"18436785-1e7d-413e-97c1-629323832ace"}}
- run_status: pass — args={"runId":"5eb69218-2c0f-46a0-9724-bf2fbd41dbea"} observed={"runId":"5eb69218-2c0f-46a0-9724-bf2fbd41dbea","status":"completed","result":{"runId":"5eb69218-2c0f-46a0-9724-bf2fbd41dbea","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"5eb69218-2c0f-46a0-9724-bf2fbd41dbea"} observed={"runId":"5eb69218-2c0f-46a0-9724-bf2fbd41dbea","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"50fcf51a-1dc1-487c-bd11-e7905d90ab62"} observed={"runId":"50fcf51a-1dc1-487c-bd11-e7905d90ab62","status":"suspended"}
- run_resume: pass — args={"runId":"dd0cf0ec-2a15-4f42-95ef-19224bd36121"} observed={"runId":"dd0cf0ec-2a15-4f42-95ef-19224bd36121","status":"running"}
- run_stop: pass — args={"runId":"c55c4811-4da4-4fd0-a4e8-c9fdcb462ae8"} observed={"runId":"c55c4811-4da4-4fd0-a4e8-c9fdcb462ae8","status":"stopped"}
- run_agent_log: pass — args={"runId":"27782ede-1086-47ef-a919-fd1a6517816b","label":"greet"} observed={"runId":"27782ede-1086-47ef-a919-fd1a6517816b","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"18436785-1e7d-413e-97c1-629323832ace","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-04T10:36:37.528Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"5eb69218-2c0f-46a0-9724-bf2fbd41dbea","path":"output.txt"} observed={"runId":"5eb69218-2c0f-46a0-9724-bf2fbd41dbea","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"5eb69218-2c0f-46a0-9724-bf2fbd41dbea"} observed={"runId":"5eb69218-2c0f-46a0-9724-bf2fbd41dbea","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"5eb69218-2c0f-46a0-9724-bf2fbd41dbea","paths":["output.txt"]} observed={"runId":"5eb69218-2c0f-46a0-9724-bf2fbd41dbea","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"workflow":"demo","cron":"* * * * *"} observed={"result":{"kind":"cron","id":"5467f1eb-781f-45e7-9882-c115b2909ed9","workflow":"demo","claimedBy":"demo","cron":"* * * * *","enabled":false}}
- schedule_list: pass — args={} observed={"result":[{"id":"c5812307-008a-4535-b185-f2b125647619","kind":"cron","workflow":"demo","claimedBy":"demo","enabled":false,"nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"id":"13495877-cd1c-
- schedule_delete: pass — args={"id":"13495877-cd1c-403b-a8ec-96a24f3bfec3"} observed={}
- schedule_setEnabled: pass — args={"id":"c5812307-008a-4535-b185-f2b125647619","enabled":false} observed={}
- webhook_create: pass — args={"workflow":"demo"} observed={"result":{"webhookId":"03ada07b-3a94-4827-8487-f623d8afae13","url":"http://127.0.0.1:44851/hooks/03ada07b-3a94-4827-8487-f623d8afae13","secret":"7df1dad106edfdf54648d9a83f7525bb81a2c930a01d828865b120
- webhook_list: pass — args={} observed={"result":[{"id":"198a288f-db38-4ae1-acd3-08d0176e48bc","workflow":"demo","enabled":true,"secretFingerprint":"4702234f85282caf","refusalCount":0},{"id":"03ada07b-3a94-4827-8487-f623d8afae13","workflow
- webhook_delete: pass — args={"id":"198a288f-db38-4ae1-acd3-08d0176e48bc"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[1.58,1.65,1.55],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":10
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":[],"result":{"name":"demo","removed":true,"releasedTriggers":[]}}
- workspace_purge: pass — args={"runId":"5eb69218-2c0f-46a0-9724-bf2fbd41dbea"} observed={"runId":"5eb69218-2c0f-46a0-9724-bf2fbd41dbea","status":"completed","result":{"purged":true}}
