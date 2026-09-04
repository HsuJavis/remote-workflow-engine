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
- run_start: pass — args={"name":"demo"} observed={"runId":"91df903e-4d80-4021-bc8d-4d7c310f6981","status":"running","result":{"runId":"91df903e-4d80-4021-bc8d-4d7c310f6981"}}
- run_status: pass — args={"runId":"5e1b6842-1c7f-44c4-aeb8-c28dd3fe4174"} observed={"runId":"5e1b6842-1c7f-44c4-aeb8-c28dd3fe4174","status":"completed","result":{"runId":"5e1b6842-1c7f-44c4-aeb8-c28dd3fe4174","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"5e1b6842-1c7f-44c4-aeb8-c28dd3fe4174"} observed={"runId":"5e1b6842-1c7f-44c4-aeb8-c28dd3fe4174","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"16c37d8e-1f14-4dde-949d-2e32bf97e4d0"} observed={"runId":"16c37d8e-1f14-4dde-949d-2e32bf97e4d0","status":"suspended"}
- run_resume: pass — args={"runId":"9762c33d-59b1-424f-bc26-c921ea4a6a46"} observed={"runId":"9762c33d-59b1-424f-bc26-c921ea4a6a46","status":"running"}
- run_stop: pass — args={"runId":"91cf8898-5148-44fe-982e-6553c02dbbc0"} observed={"runId":"91cf8898-5148-44fe-982e-6553c02dbbc0","status":"stopped"}
- run_agent_log: pass — args={"runId":"bb49cfd5-31cf-444f-834e-0b84151e69bd","label":"greet"} observed={"runId":"bb49cfd5-31cf-444f-834e-0b84151e69bd","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"91df903e-4d80-4021-bc8d-4d7c310f6981","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-04T10:56:54.710Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"5e1b6842-1c7f-44c4-aeb8-c28dd3fe4174","path":"output.txt"} observed={"runId":"5e1b6842-1c7f-44c4-aeb8-c28dd3fe4174","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"5e1b6842-1c7f-44c4-aeb8-c28dd3fe4174"} observed={"runId":"5e1b6842-1c7f-44c4-aeb8-c28dd3fe4174","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"5e1b6842-1c7f-44c4-aeb8-c28dd3fe4174","paths":["output.txt"]} observed={"runId":"5e1b6842-1c7f-44c4-aeb8-c28dd3fe4174","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"workflow":"demo","cron":"* * * * *"} observed={"result":{"kind":"cron","id":"bebe7e24-8853-423a-8f99-d5f463f3b4b7","workflow":"demo","claimedBy":"demo","cron":"* * * * *","enabled":false}}
- schedule_list: pass — args={} observed={"result":[{"id":"75f50824-38ed-45f9-8642-efb73ec88870","kind":"cron","workflow":"demo","claimedBy":"demo","enabled":false,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"
- schedule_delete: pass — args={"id":"7d838f51-0d1e-4c01-abe0-2bc736242784"} observed={}
- schedule_setEnabled: pass — args={"id":"75f50824-38ed-45f9-8642-efb73ec88870","enabled":false} observed={}
- webhook_create: pass — args={"workflow":"demo"} observed={"result":{"webhookId":"6744b5ea-4f57-4e74-93a3-496d3c6929dc","url":"http://127.0.0.1:33763/hooks/6744b5ea-4f57-4e74-93a3-496d3c6929dc","secret":"25819058d18f313787654ed9a96ff3a24bb8cfae229b151ca5f7f1
- webhook_list: pass — args={} observed={"result":[{"id":"ad332858-8b42-4117-a12f-2deb269fd531","workflow":"demo","enabled":true,"secretFingerprint":"fa7d21bbaa03b1a8","refusalCount":0},{"id":"6744b5ea-4f57-4e74-93a3-496d3c6929dc","workflow
- webhook_delete: pass — args={"id":"ad332858-8b42-4117-a12f-2deb269fd531"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[0.79,0.87,1.04],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":10
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":[],"result":{"name":"demo","removed":true,"releasedTriggers":[]}}
- workspace_purge: pass — args={"runId":"5e1b6842-1c7f-44c4-aeb8-c28dd3fe4174"} observed={"runId":"5e1b6842-1c7f-44c4-aeb8-c28dd3fe4174","status":"completed","result":{"purged":true}}
