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
- run_start: pass — args={"name":"demo"} observed={"runId":"258e49cb-9b5d-47d7-b7eb-97214b137758","status":"running","result":{"runId":"258e49cb-9b5d-47d7-b7eb-97214b137758"}}
- run_status: pass — args={"runId":"75846f6e-a03d-4f63-8427-b510feb9cab4"} observed={"runId":"75846f6e-a03d-4f63-8427-b510feb9cab4","status":"completed","result":{"runId":"75846f6e-a03d-4f63-8427-b510feb9cab4","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"75846f6e-a03d-4f63-8427-b510feb9cab4"} observed={"runId":"75846f6e-a03d-4f63-8427-b510feb9cab4","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"97b6be8d-b45e-4da8-9074-4a78dfb970f6"} observed={"runId":"97b6be8d-b45e-4da8-9074-4a78dfb970f6","status":"suspended"}
- run_resume: pass — args={"runId":"533cf7c6-e5d1-488b-99cd-f331cbabdec6"} observed={"runId":"533cf7c6-e5d1-488b-99cd-f331cbabdec6","status":"running"}
- run_stop: pass — args={"runId":"6548abdf-46d5-4e0c-a539-883033cf0db7"} observed={"runId":"6548abdf-46d5-4e0c-a539-883033cf0db7","status":"stopped"}
- run_agent_log: pass — args={"runId":"5087ed1f-d470-4158-8a1f-60af02ebb349","label":"greet"} observed={"runId":"5087ed1f-d470-4158-8a1f-60af02ebb349","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"258e49cb-9b5d-47d7-b7eb-97214b137758","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-04T22:31:04.286Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"75846f6e-a03d-4f63-8427-b510feb9cab4","path":"output.txt"} observed={"runId":"75846f6e-a03d-4f63-8427-b510feb9cab4","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"75846f6e-a03d-4f63-8427-b510feb9cab4"} observed={"runId":"75846f6e-a03d-4f63-8427-b510feb9cab4","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"75846f6e-a03d-4f63-8427-b510feb9cab4","paths":["output.txt"]} observed={"runId":"75846f6e-a03d-4f63-8427-b510feb9cab4","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"cron":"* * * * *"} observed={"result":{"kind":"cron","id":"b609fa95-4f6f-44c1-96ff-b39cf615aeba","claimedBy":null,"cron":"* * * * *","enabled":true}}
- schedule_list: pass — args={} observed={"result":[{"id":"9ed48b74-2013-49d4-99f2-557ef034144d","kind":"cron","workflow":"demo","claimedBy":"demo","enabled":true,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"i
- schedule_delete: pass — args={"id":"13d52d00-fada-411a-9850-c88d0046415a"} observed={}
- schedule_setEnabled: pass — args={"id":"9ed48b74-2013-49d4-99f2-557ef034144d","enabled":false} observed={}
- webhook_create: pass — args={} observed={"result":{"webhookId":"5b31cf49-fc3b-4bfa-abfb-09e33542d77c","url":"http://127.0.0.1:43123/hooks/5b31cf49-fc3b-4bfa-abfb-09e33542d77c","secret":"8ae231f503ddbf00832f49a89a96f62a76e2725c7f2aa83fee0bd8
- webhook_list: pass — args={} observed={"result":[{"id":"1eca03c7-4b1e-429d-87aa-efbfc55c7575","workflow":"demo","createdBy":null,"enabled":true,"secretFingerprint":"26d3982fa6a93b2c","refusalCount":0},{"id":"5b31cf49-fc3b-4bfa-abfb-09e335
- webhook_delete: pass — args={"id":"1eca03c7-4b1e-429d-87aa-efbfc55c7575"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[0.73,0.65,0.56],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":96
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":["9ed48b74-2013-49d4-99f2-557ef034144d"],"result":{"name":"demo","removed":true,"releasedTriggers":["9ed48b74-2013-49d4
- workspace_purge: pass — args={"runId":"75846f6e-a03d-4f63-8427-b510feb9cab4"} observed={"runId":"75846f6e-a03d-4f63-8427-b510feb9cab4","status":"completed","result":{"purged":true}}
