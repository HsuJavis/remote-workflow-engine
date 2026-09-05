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
- run_start: pass — args={"name":"demo"} observed={"runId":"16a2c824-ece0-4ac9-8aac-0faa9ed09de3","status":"running","result":{"runId":"16a2c824-ece0-4ac9-8aac-0faa9ed09de3"}}
- run_status: pass — args={"runId":"4587f585-3f83-43f6-aab5-5ab310970ea4"} observed={"runId":"4587f585-3f83-43f6-aab5-5ab310970ea4","status":"completed","result":{"runId":"4587f585-3f83-43f6-aab5-5ab310970ea4","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"4587f585-3f83-43f6-aab5-5ab310970ea4"} observed={"runId":"4587f585-3f83-43f6-aab5-5ab310970ea4","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"767555fb-abe5-4acd-abf0-91c580b02835"} observed={"runId":"767555fb-abe5-4acd-abf0-91c580b02835","status":"suspended"}
- run_resume: pass — args={"runId":"0fd906c8-8163-48f6-abbb-70daab43b912"} observed={"runId":"0fd906c8-8163-48f6-abbb-70daab43b912","status":"running"}
- run_stop: pass — args={"runId":"5220387b-f11c-4142-9a20-5ba59f5d2555"} observed={"runId":"5220387b-f11c-4142-9a20-5ba59f5d2555","status":"stopped"}
- run_agent_log: pass — args={"runId":"dbbf0b6f-0070-44ea-b576-0d99ca15667f","label":"greet"} observed={"runId":"dbbf0b6f-0070-44ea-b576-0d99ca15667f","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"16a2c824-ece0-4ac9-8aac-0faa9ed09de3","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-05T04:43:50.099Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"4587f585-3f83-43f6-aab5-5ab310970ea4","path":"output.txt"} observed={"runId":"4587f585-3f83-43f6-aab5-5ab310970ea4","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"4587f585-3f83-43f6-aab5-5ab310970ea4"} observed={"runId":"4587f585-3f83-43f6-aab5-5ab310970ea4","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"4587f585-3f83-43f6-aab5-5ab310970ea4","paths":["output.txt"]} observed={"runId":"4587f585-3f83-43f6-aab5-5ab310970ea4","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"cron":"* * * * *"} observed={"result":{"kind":"cron","id":"f8797206-7852-4dc9-9fc5-801edf4b6608","claimedBy":null,"cron":"* * * * *","enabled":true}}
- schedule_list: pass — args={} observed={"result":[{"id":"b32cec00-e6a6-4e28-a236-8292bc7d8b20","kind":"cron","claimedBy":"demo","enabled":true,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"id":"de7fcdbb-ab00-
- schedule_delete: pass — args={"id":"de7fcdbb-ab00-46a7-adef-4d5e986260f8"} observed={}
- schedule_setEnabled: pass — args={"id":"b32cec00-e6a6-4e28-a236-8292bc7d8b20","enabled":false} observed={}
- webhook_create: pass — args={} observed={"result":{"webhookId":"f64079ad-d1d3-4e04-b7a1-e6f18df67b1f","url":"http://127.0.0.1:38759/hooks/f64079ad-d1d3-4e04-b7a1-e6f18df67b1f","secret":"d8eae6d183e27331640f55f75bff5844c45fe4f71d024799c1cf01
- webhook_list: pass — args={} observed={"result":[{"id":"aadbc206-f9d3-4ef9-acae-5f3a02619822","workflow":"demo","createdBy":null,"enabled":true,"secretFingerprint":"ca38c3af3776ecb1","refusalCount":0},{"id":"f64079ad-d1d3-4e04-b7a1-e6f18d
- webhook_delete: pass — args={"id":"aadbc206-f9d3-4ef9-acae-5f3a02619822"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[1.72,1.4,1.27],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":985
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":["b32cec00-e6a6-4e28-a236-8292bc7d8b20","aadbc206-f9d3-4ef9-acae-5f3a02619822"],"result":{"name":"demo","removed":true,
- workspace_purge: pass — args={"runId":"4587f585-3f83-43f6-aab5-5ab310970ea4"} observed={"runId":"4587f585-3f83-43f6-aab5-5ab310970ea4","status":"completed","result":{"purged":true}}
