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
- run_start: pass — args={"name":"demo"} observed={"runId":"6676c9a5-06e3-42cf-bb6f-8e3a792e329c","status":"running","result":{"runId":"6676c9a5-06e3-42cf-bb6f-8e3a792e329c"}}
- run_status: pass — args={"runId":"0c1a4c5e-b2b7-473b-bff6-8793c2579fe3"} observed={"runId":"0c1a4c5e-b2b7-473b-bff6-8793c2579fe3","status":"completed","result":{"runId":"0c1a4c5e-b2b7-473b-bff6-8793c2579fe3","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"0c1a4c5e-b2b7-473b-bff6-8793c2579fe3"} observed={"runId":"0c1a4c5e-b2b7-473b-bff6-8793c2579fe3","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"496844c9-265f-4cff-9c12-7a83bb4b7c60"} observed={"runId":"496844c9-265f-4cff-9c12-7a83bb4b7c60","status":"suspended"}
- run_resume: pass — args={"runId":"ab775ba9-0b1a-441c-9358-df9aef2faf69"} observed={"runId":"ab775ba9-0b1a-441c-9358-df9aef2faf69","status":"running"}
- run_stop: pass — args={"runId":"9339437e-bc2e-487a-9d2b-6d66b41eca1f"} observed={"runId":"9339437e-bc2e-487a-9d2b-6d66b41eca1f","status":"stopped"}
- run_agent_log: pass — args={"runId":"c9b66cc9-2562-41fb-9ec3-0d11623a0e58","label":"greet"} observed={"runId":"c9b66cc9-2562-41fb-9ec3-0d11623a0e58","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"6676c9a5-06e3-42cf-bb6f-8e3a792e329c","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-04T13:15:35.386Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"0c1a4c5e-b2b7-473b-bff6-8793c2579fe3","path":"output.txt"} observed={"runId":"0c1a4c5e-b2b7-473b-bff6-8793c2579fe3","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"0c1a4c5e-b2b7-473b-bff6-8793c2579fe3"} observed={"runId":"0c1a4c5e-b2b7-473b-bff6-8793c2579fe3","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"0c1a4c5e-b2b7-473b-bff6-8793c2579fe3","paths":["output.txt"]} observed={"runId":"0c1a4c5e-b2b7-473b-bff6-8793c2579fe3","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"workflow":"demo","cron":"* * * * *"} observed={"result":{"kind":"cron","id":"8e2f6624-84bd-48c9-acc6-53d6ecd1943c","workflow":"demo","claimedBy":"demo","cron":"* * * * *","enabled":true}}
- schedule_list: pass — args={} observed={"result":[{"id":"e6bced1d-0810-4f5e-ae57-ded947208de2","kind":"cron","workflow":"demo","claimedBy":"demo","enabled":true,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"i
- schedule_delete: pass — args={"id":"bc1b0395-9ca6-4482-91c6-125862bcc764"} observed={}
- schedule_setEnabled: pass — args={"id":"e6bced1d-0810-4f5e-ae57-ded947208de2","enabled":false} observed={}
- webhook_create: pass — args={"workflow":"demo"} observed={"result":{"webhookId":"5b1f341e-baa8-4c79-8c40-a973974e2989","url":"http://127.0.0.1:33379/hooks/5b1f341e-baa8-4c79-8c40-a973974e2989","secret":"a4555d6652022bb01b091795d36da1a17d152cad589b73f34b5a95
- webhook_list: pass — args={} observed={"result":[{"id":"18d8ebcb-de21-40a0-80e6-b35b697287d5","workflow":"demo","createdBy":null,"enabled":true,"secretFingerprint":"301097f98aac64f1","refusalCount":0},{"id":"5b1f341e-baa8-4c79-8c40-a97397
- webhook_delete: pass — args={"id":"18d8ebcb-de21-40a0-80e6-b35b697287d5"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[0.79,1.15,1.33],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":10
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":[],"result":{"name":"demo","removed":true,"releasedTriggers":[]}}
- workspace_purge: pass — args={"runId":"0c1a4c5e-b2b7-473b-bff6-8793c2579fe3"} observed={"runId":"0c1a4c5e-b2b7-473b-bff6-8793c2579fe3","status":"completed","result":{"purged":true}}
