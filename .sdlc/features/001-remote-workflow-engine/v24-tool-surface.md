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
- run_start: pass — args={"name":"demo"} observed={"runId":"8ada7478-5c56-4b67-b270-8753994a8460","status":"running","result":{"runId":"8ada7478-5c56-4b67-b270-8753994a8460"}}
- run_status: pass — args={"runId":"564f8e12-13b9-4540-80ae-3e3f7ac0f14b"} observed={"runId":"564f8e12-13b9-4540-80ae-3e3f7ac0f14b","status":"completed","result":{"runId":"564f8e12-13b9-4540-80ae-3e3f7ac0f14b","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"564f8e12-13b9-4540-80ae-3e3f7ac0f14b"} observed={"runId":"564f8e12-13b9-4540-80ae-3e3f7ac0f14b","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"bbd57713-2108-48cc-9fee-608c47b13fb6"} observed={"runId":"bbd57713-2108-48cc-9fee-608c47b13fb6","status":"suspended"}
- run_resume: pass — args={"runId":"a920bdce-44c2-47ae-8784-986e8cef5a7f"} observed={"runId":"a920bdce-44c2-47ae-8784-986e8cef5a7f","status":"running"}
- run_stop: pass — args={"runId":"a80269e5-aa29-4e34-97da-a033194fb678"} observed={"runId":"a80269e5-aa29-4e34-97da-a033194fb678","status":"stopped"}
- run_agent_log: pass — args={"runId":"55d03815-2b20-4046-a815-bbe77ae569b5","label":"greet"} observed={"runId":"55d03815-2b20-4046-a815-bbe77ae569b5","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"8ada7478-5c56-4b67-b270-8753994a8460","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-04T15:04:13.672Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"564f8e12-13b9-4540-80ae-3e3f7ac0f14b","path":"output.txt"} observed={"runId":"564f8e12-13b9-4540-80ae-3e3f7ac0f14b","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"564f8e12-13b9-4540-80ae-3e3f7ac0f14b"} observed={"runId":"564f8e12-13b9-4540-80ae-3e3f7ac0f14b","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"564f8e12-13b9-4540-80ae-3e3f7ac0f14b","paths":["output.txt"]} observed={"runId":"564f8e12-13b9-4540-80ae-3e3f7ac0f14b","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"cron":"* * * * *"} observed={"result":{"kind":"cron","id":"87318a44-3ebf-4929-b6c4-5557373b3b4f","claimedBy":null,"cron":"* * * * *","enabled":true}}
- schedule_list: pass — args={} observed={"result":[{"id":"373fe9d6-8699-4c81-bb55-87f14edfe308","kind":"cron","workflow":"demo","claimedBy":"demo","enabled":true,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"i
- schedule_delete: pass — args={"id":"b9d016f2-5937-43a2-b2ee-5bfb4bdf0f31"} observed={}
- schedule_setEnabled: pass — args={"id":"373fe9d6-8699-4c81-bb55-87f14edfe308","enabled":false} observed={}
- webhook_create: pass — args={} observed={"result":{"webhookId":"143f78c9-3aa9-4163-815d-6862a78b7557","url":"http://127.0.0.1:34565/hooks/143f78c9-3aa9-4163-815d-6862a78b7557","secret":"8857d4302dc2cfde5b0f25e39138ac7df3b54e7cb289b603c85f8d
- webhook_list: pass — args={} observed={"result":[{"id":"b9a879b5-68fb-4a3e-8d58-ce693079a0bf","workflow":"demo","createdBy":null,"enabled":true,"secretFingerprint":"781375c3b28d6b34","refusalCount":0},{"id":"143f78c9-3aa9-4163-815d-6862a7
- webhook_delete: pass — args={"id":"b9a879b5-68fb-4a3e-8d58-ce693079a0bf"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[1.14,0.84,0.88],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":99
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":["373fe9d6-8699-4c81-bb55-87f14edfe308"],"result":{"name":"demo","removed":true,"releasedTriggers":["373fe9d6-8699-4c81
- workspace_purge: pass — args={"runId":"564f8e12-13b9-4540-80ae-3e3f7ac0f14b"} observed={"runId":"564f8e12-13b9-4540-80ae-3e3f7ac0f14b","status":"completed","result":{"purged":true}}
