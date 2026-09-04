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
- run_start: pass — args={"name":"demo"} observed={"runId":"63a4dad1-3af3-49de-a2b6-3631229dd6e5","status":"running","result":{"runId":"63a4dad1-3af3-49de-a2b6-3631229dd6e5"}}
- run_status: pass — args={"runId":"9d93deae-e240-4623-bac8-f38df28bdc58"} observed={"runId":"9d93deae-e240-4623-bac8-f38df28bdc58","status":"completed","result":{"runId":"9d93deae-e240-4623-bac8-f38df28bdc58","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"9d93deae-e240-4623-bac8-f38df28bdc58"} observed={"runId":"9d93deae-e240-4623-bac8-f38df28bdc58","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"5ccc325f-e301-4b95-82b2-b146d4f78738"} observed={"runId":"5ccc325f-e301-4b95-82b2-b146d4f78738","status":"suspended"}
- run_resume: pass — args={"runId":"988f5750-265f-435f-a2bc-86b51ab1eabc"} observed={"runId":"988f5750-265f-435f-a2bc-86b51ab1eabc","status":"running"}
- run_stop: pass — args={"runId":"074b9c4f-3dcb-4ce2-b5b3-647450da657a"} observed={"runId":"074b9c4f-3dcb-4ce2-b5b3-647450da657a","status":"stopped"}
- run_agent_log: pass — args={"runId":"87287506-79f4-43fa-a664-4575c3d6018a","label":"greet"} observed={"runId":"87287506-79f4-43fa-a664-4575c3d6018a","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"63a4dad1-3af3-49de-a2b6-3631229dd6e5","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-04T12:30:42.954Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"9d93deae-e240-4623-bac8-f38df28bdc58","path":"output.txt"} observed={"runId":"9d93deae-e240-4623-bac8-f38df28bdc58","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"9d93deae-e240-4623-bac8-f38df28bdc58"} observed={"runId":"9d93deae-e240-4623-bac8-f38df28bdc58","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"9d93deae-e240-4623-bac8-f38df28bdc58","paths":["output.txt"]} observed={"runId":"9d93deae-e240-4623-bac8-f38df28bdc58","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"workflow":"demo","cron":"* * * * *"} observed={"result":{"kind":"cron","id":"d0a81767-0e16-4f8b-8f5d-85217b838732","workflow":"demo","claimedBy":"demo","cron":"* * * * *","enabled":true}}
- schedule_list: pass — args={} observed={"result":[{"id":"46a26002-a586-42c0-8ac8-d8e6bddf4340","kind":"cron","workflow":"demo","claimedBy":"demo","enabled":true,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"i
- schedule_delete: pass — args={"id":"580bf542-1228-478a-bf24-3890cfd28425"} observed={}
- schedule_setEnabled: pass — args={"id":"46a26002-a586-42c0-8ac8-d8e6bddf4340","enabled":false} observed={}
- webhook_create: pass — args={"workflow":"demo"} observed={"result":{"webhookId":"dbceab61-bafe-44e9-8813-cbd69a2d2b91","url":"http://127.0.0.1:43115/hooks/dbceab61-bafe-44e9-8813-cbd69a2d2b91","secret":"8ee599ab96cfadbc4f23ac557ac8ebac4fb6b7eac8a38cded36a24
- webhook_list: pass — args={} observed={"result":[{"id":"98cca539-02ee-438c-bca3-2d2c62887df6","workflow":"demo","createdBy":null,"enabled":true,"secretFingerprint":"ba0fc6b8a315d9f1","refusalCount":0},{"id":"dbceab61-bafe-44e9-8813-cbd69a
- webhook_delete: pass — args={"id":"98cca539-02ee-438c-bca3-2d2c62887df6"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[1.98,1.55,1.32],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":10
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":[],"result":{"name":"demo","removed":true,"releasedTriggers":[]}}
- workspace_purge: pass — args={"runId":"9d93deae-e240-4623-bac8-f38df28bdc58"} observed={"runId":"9d93deae-e240-4623-bac8-f38df28bdc58","status":"completed","result":{"purged":true}}
