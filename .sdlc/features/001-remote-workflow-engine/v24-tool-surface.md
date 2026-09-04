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
- run_start: pass — args={"name":"demo"} observed={"runId":"ad67f9d3-2912-437e-bf7f-db686cac2bda","status":"running","result":{"runId":"ad67f9d3-2912-437e-bf7f-db686cac2bda"}}
- run_status: pass — args={"runId":"2dd0262e-553f-4234-b087-6312c1782d33"} observed={"runId":"2dd0262e-553f-4234-b087-6312c1782d33","status":"completed","result":{"runId":"2dd0262e-553f-4234-b087-6312c1782d33","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"2dd0262e-553f-4234-b087-6312c1782d33"} observed={"runId":"2dd0262e-553f-4234-b087-6312c1782d33","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"6ddefcf5-139c-47e4-9eed-e0614ec9f32f"} observed={"runId":"6ddefcf5-139c-47e4-9eed-e0614ec9f32f","status":"suspended"}
- run_resume: pass — args={"runId":"f1a423d0-2b0c-429b-96db-168959b2ced0"} observed={"runId":"f1a423d0-2b0c-429b-96db-168959b2ced0","status":"running"}
- run_stop: pass — args={"runId":"41b8d1e5-2b87-4c58-a3a1-2dddd1f84eb1"} observed={"runId":"41b8d1e5-2b87-4c58-a3a1-2dddd1f84eb1","status":"stopped"}
- run_agent_log: pass — args={"runId":"36b370df-ff9d-4089-8f8e-ecbfffac0b30","label":"greet"} observed={"runId":"36b370df-ff9d-4089-8f8e-ecbfffac0b30","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"ad67f9d3-2912-437e-bf7f-db686cac2bda","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-04T10:44:29.726Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"2dd0262e-553f-4234-b087-6312c1782d33","path":"output.txt"} observed={"runId":"2dd0262e-553f-4234-b087-6312c1782d33","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"2dd0262e-553f-4234-b087-6312c1782d33"} observed={"runId":"2dd0262e-553f-4234-b087-6312c1782d33","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"2dd0262e-553f-4234-b087-6312c1782d33","paths":["output.txt"]} observed={"runId":"2dd0262e-553f-4234-b087-6312c1782d33","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"workflow":"demo","cron":"* * * * *"} observed={"result":{"kind":"cron","id":"9978bb7e-130e-4b89-b6c9-94364de76910","workflow":"demo","claimedBy":"demo","cron":"* * * * *","enabled":false}}
- schedule_list: pass — args={} observed={"result":[{"id":"fa6739db-5fc3-4980-9014-7e6cad3b7933","kind":"cron","workflow":"demo","claimedBy":"demo","enabled":false,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"
- schedule_delete: pass — args={"id":"3d26e695-6d6d-4473-a1b3-1973683327d6"} observed={}
- schedule_setEnabled: pass — args={"id":"fa6739db-5fc3-4980-9014-7e6cad3b7933","enabled":false} observed={}
- webhook_create: pass — args={"workflow":"demo"} observed={"result":{"webhookId":"96ff2a4c-a179-452e-839c-68d297726083","url":"http://127.0.0.1:35935/hooks/96ff2a4c-a179-452e-839c-68d297726083","secret":"8536b96d1def6985da915c65945cf38d05b84deef2f5ba5b91daf8
- webhook_list: pass — args={} observed={"result":[{"id":"95130dd3-5bd2-4963-9386-7daa6236d2fa","workflow":"demo","enabled":true,"secretFingerprint":"e0d6dc0a7e5a5e3b","refusalCount":0},{"id":"96ff2a4c-a179-452e-839c-68d297726083","workflow
- webhook_delete: pass — args={"id":"95130dd3-5bd2-4963-9386-7daa6236d2fa"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[0.62,0.79,1.16],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":10
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":[],"result":{"name":"demo","removed":true,"releasedTriggers":[]}}
- workspace_purge: pass — args={"runId":"2dd0262e-553f-4234-b087-6312c1782d33"} observed={"runId":"2dd0262e-553f-4234-b087-6312c1782d33","status":"completed","result":{"purged":true}}
