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
- run_start: pass — args={"name":"demo"} observed={"runId":"a5aa8bff-70cd-4738-bc0a-9251ef8f723e","status":"running","result":{"runId":"a5aa8bff-70cd-4738-bc0a-9251ef8f723e"}}
- run_status: pass — args={"runId":"ad59b9fb-0dea-4185-9835-589ff6838943"} observed={"runId":"ad59b9fb-0dea-4185-9835-589ff6838943","status":"completed","result":{"runId":"ad59b9fb-0dea-4185-9835-589ff6838943","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"ad59b9fb-0dea-4185-9835-589ff6838943"} observed={"runId":"ad59b9fb-0dea-4185-9835-589ff6838943","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"5f2a1785-a93e-4330-86fd-be9a6594efbc"} observed={"runId":"5f2a1785-a93e-4330-86fd-be9a6594efbc","status":"suspended"}
- run_resume: pass — args={"runId":"2079cbe3-ae9b-4574-94ea-792037f0d929"} observed={"runId":"2079cbe3-ae9b-4574-94ea-792037f0d929","status":"running"}
- run_stop: pass — args={"runId":"34130108-e56d-4026-abd1-28f525510fc2"} observed={"runId":"34130108-e56d-4026-abd1-28f525510fc2","status":"stopped"}
- run_agent_log: pass — args={"runId":"5c7ee0e6-697a-4eb8-8071-004bd4096414","label":"greet"} observed={"runId":"5c7ee0e6-697a-4eb8-8071-004bd4096414","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"a5aa8bff-70cd-4738-bc0a-9251ef8f723e","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-04T10:32:10.608Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"ad59b9fb-0dea-4185-9835-589ff6838943","path":"output.txt"} observed={"runId":"ad59b9fb-0dea-4185-9835-589ff6838943","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"ad59b9fb-0dea-4185-9835-589ff6838943"} observed={"runId":"ad59b9fb-0dea-4185-9835-589ff6838943","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"ad59b9fb-0dea-4185-9835-589ff6838943","paths":["output.txt"]} observed={"runId":"ad59b9fb-0dea-4185-9835-589ff6838943","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"workflow":"demo","cron":"* * * * *"} observed={"result":{"kind":"cron","id":"db610abc-53f8-4069-978e-2da7191764d4","workflow":"demo","claimedBy":"demo","cron":"* * * * *","enabled":false}}
- schedule_list: pass — args={} observed={"result":[{"id":"446dbe71-287f-47f6-a9c7-4667f8fae5b3","kind":"cron","workflow":"demo","claimedBy":"demo","enabled":false,"nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"id":"4b961a92-e3b8-
- schedule_delete: pass — args={"id":"4b961a92-e3b8-4cc6-85c4-3ec288daa859"} observed={}
- schedule_setEnabled: pass — args={"id":"446dbe71-287f-47f6-a9c7-4667f8fae5b3","enabled":false} observed={}
- webhook_create: pass — args={"workflow":"demo"} observed={"result":{"webhookId":"e784318c-0731-47f5-b924-9fbe74c84926","url":"http://127.0.0.1:36785/hooks/e784318c-0731-47f5-b924-9fbe74c84926","secret":"b95b828f42cf6ca30cc9e81c6bc71b8030d18eede0661a1dbad39b
- webhook_list: pass — args={} observed={"result":[{"id":"41f4d0f1-77c2-470d-a8a3-886cec8be8ba","workflow":"demo","enabled":true,"secretFingerprint":"7943d69e14dabfd4","refusalCount":0},{"id":"e784318c-0731-47f5-b924-9fbe74c84926","workflow
- webhook_delete: pass — args={"id":"41f4d0f1-77c2-470d-a8a3-886cec8be8ba"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[1.83,1.62,1.5],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":107
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":[],"result":{"name":"demo","removed":true,"releasedTriggers":[]}}
- workspace_purge: pass — args={"runId":"ad59b9fb-0dea-4185-9835-589ff6838943"} observed={"runId":"ad59b9fb-0dea-4185-9835-589ff6838943","status":"completed","result":{"purged":true}}
