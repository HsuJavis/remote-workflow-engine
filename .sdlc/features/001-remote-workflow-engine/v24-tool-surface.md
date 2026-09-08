# v24 tool surface — REQ-118

rows: 35/35

- issue_report: unverified — args={"title":"fixture issue","reproSteps":"call issue_report","analysis":"REQ-118 surface probe"} observed="UNVERIFIED(no GitHub token)"
- issue_get: unverified — args={"number":1} observed="UNVERIFIED(no GitHub token)"
- issue_list: unverified — args={} observed="UNVERIFIED(no GitHub token)"
- issue_get_comments: unverified — args={"number":1} observed="UNVERIFIED(no GitHub token)"
- issue_comment_post: unverified — args={"number":1,"body":"hi"} observed="UNVERIFIED(no GitHub token)"
- workflow_register: pass — args={"name":"demo","script":"export const meta = {\n  description: 'Greet the caller in one sentence',\n  params: { agents: { greet: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },\n};\nphase('Greet');\nreturn await agent('greet', { prompt: 'Say hello' });","mermaid":"graph LR\nsubgraph \"Greet\"\ngreet([\"greet\"])\nend"} observed={"runId":"","status":"completed","version":2,"result":{"name":"demo","version":"v2"}}
- workflow_publish: pass — args={"name":"demo","version":"v1","channel":"release"} observed={"runId":"","status":"completed","result":{"channel":"release","version":"v1","from":"v1"}}
- workflow_describe: pass — args={"name":"demo"} observed={"runId":"","status":"completed","result":{"name":"demo","version":"v1","resolvedBy":"default-release","channels":{"release":"v1","beta":null},"versions":["v1","v2"],"description":"Greet the caller in
- workflow_source: pass — args={"name":"demo"} observed={"runId":"","status":"completed","owner":null,"params":{"agents":{"greet":{"model":{"type":"string","default":"default"},"effort":{"type":"enum","enum":["low","medium","high"],"default":"low"},"timeou
- workflow_list: pass — args={} observed={"runId":"","status":"completed","result":[{"name":"demo","owner":null,"versions":["v1","v2"],"channels":{"release":"v1","beta":null},"runnable":true},{"name":"demo-quick","owner":null,"versions":["v1
- workflow_authoring_guide: pass — args={} observed={"runId":"","status":"completed","result":{"text":"# Authoring a workflow script\n\nThis engine has no bundled guidance skill — the tool schemas returned by `tools/list` are the only documentation a c
- run_start: pass — args={"name":"demo"} observed={"runId":"a48d8f05-b9b0-4189-9ac4-5577c5753598","status":"running","result":{"runId":"a48d8f05-b9b0-4189-9ac4-5577c5753598"}}
- run_status: pass — args={"runId":"eded2988-e30b-4459-bd9c-3bb01e21ec03"} observed={"runId":"eded2988-e30b-4459-bd9c-3bb01e21ec03","status":"completed","result":{"runId":"eded2988-e30b-4459-bd9c-3bb01e21ec03","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"eded2988-e30b-4459-bd9c-3bb01e21ec03"} observed={"runId":"eded2988-e30b-4459-bd9c-3bb01e21ec03","status":"completed","result":"ok","meta":{"usage":{"tokens":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"costUSD":0,"unpricedCalls":0,"unmapped
- run_suspend: pass — args={"runId":"488b3ea6-e114-48ed-9412-e0cc2a4d33d5"} observed={"runId":"488b3ea6-e114-48ed-9412-e0cc2a4d33d5","status":"suspended"}
- run_resume: pass — args={"runId":"b2d46d5e-8923-4147-81d7-5cfba99b0a80"} observed={"runId":"b2d46d5e-8923-4147-81d7-5cfba99b0a80","status":"running"}
- run_stop: pass — args={"runId":"91df9570-5b62-438b-af90-e05f6dcd5399"} observed={"runId":"91df9570-5b62-438b-af90-e05f6dcd5399","status":"stopped"}
- run_agent_log: pass — args={"runId":"09d14f00-1351-47cf-be56-adc553fdf58e","label":"greet"} observed={"runId":"09d14f00-1351-47cf-be56-adc553fdf58e","status":"running","harness":{"model":"stall","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","effo
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"a48d8f05-b9b0-4189-9ac4-5577c5753598","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-08T19:16:10.321Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"eded2988-e30b-4459-bd9c-3bb01e21ec03","path":"output.txt"} observed={"runId":"eded2988-e30b-4459-bd9c-3bb01e21ec03","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"eded2988-e30b-4459-bd9c-3bb01e21ec03"} observed={"runId":"eded2988-e30b-4459-bd9c-3bb01e21ec03","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"eded2988-e30b-4459-bd9c-3bb01e21ec03","paths":["output.txt"]} observed={"runId":"eded2988-e30b-4459-bd9c-3bb01e21ec03","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"cron":"* * * * *"} observed={"result":{"kind":"cron","id":"e26da072-904d-41a6-911b-eb17292170b6","claimedBy":null,"cron":"* * * * *","enabled":true}}
- schedule_list: pass — args={} observed={"result":[{"id":"959bc03c-f7b0-40e2-86fb-e7126092804b","kind":"cron","claimedBy":"demo","enabled":true,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"id":"9cbb2454-e4ef-
- schedule_delete: pass — args={"id":"9cbb2454-e4ef-4a3a-b246-f9a9a67efbb1"} observed={}
- schedule_setEnabled: pass — args={"id":"959bc03c-f7b0-40e2-86fb-e7126092804b","enabled":false} observed={}
- webhook_create: pass — args={} observed={"result":{"webhookId":"978b68a8-697c-4058-a581-3cdba8c5f7ef","url":"http://127.0.0.1:36999/hooks/978b68a8-697c-4058-a581-3cdba8c5f7ef","secret":"c8697609503b2f9e973403a4d770e38c8fee6db36dc2b49bbb09a0
- webhook_list: pass — args={} observed={"result":[{"id":"38ae6ddd-c17c-46a3-a34b-2559257a1d45","workflow":"demo","createdBy":null,"enabled":true,"secretFingerprint":"d4ea899c267e2ab9","refusalCount":0},{"id":"978b68a8-697c-4058-a581-3cdba8
- webhook_delete: pass — args={"id":"38ae6ddd-c17c-46a3-a34b-2559257a1d45"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[1.65,1.3,1.08],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":742
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":["959bc03c-f7b0-40e2-86fb-e7126092804b","38ae6ddd-c17c-46a3-a34b-2559257a1d45"],"result":{"name":"demo","removed":true,
- workspace_purge: pass — args={"runId":"eded2988-e30b-4459-bd9c-3bb01e21ec03"} observed={"runId":"eded2988-e30b-4459-bd9c-3bb01e21ec03","status":"completed","result":{"purged":true}}
