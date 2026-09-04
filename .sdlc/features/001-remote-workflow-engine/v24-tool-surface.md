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
- run_start: pass — args={"name":"demo"} observed={"runId":"3dfdaa76-8647-4f66-b466-45c66a0f61a0","status":"running","result":{"runId":"3dfdaa76-8647-4f66-b466-45c66a0f61a0"}}
- run_status: pass — args={"runId":"26cf4096-ce30-44fa-a83e-f097d4ea0b94"} observed={"runId":"26cf4096-ce30-44fa-a83e-f097d4ea0b94","status":"completed","result":{"runId":"26cf4096-ce30-44fa-a83e-f097d4ea0b94","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"26cf4096-ce30-44fa-a83e-f097d4ea0b94"} observed={"runId":"26cf4096-ce30-44fa-a83e-f097d4ea0b94","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"387ca935-512c-4567-bd46-a139764dedd8"} observed={"runId":"387ca935-512c-4567-bd46-a139764dedd8","status":"suspended"}
- run_resume: pass — args={"runId":"cf44f347-dd34-47b1-8de7-50341baf63d8"} observed={"runId":"cf44f347-dd34-47b1-8de7-50341baf63d8","status":"running"}
- run_stop: pass — args={"runId":"6d91e336-45ce-4a95-912b-47f8ae0f56f7"} observed={"runId":"6d91e336-45ce-4a95-912b-47f8ae0f56f7","status":"stopped"}
- run_agent_log: pass — args={"runId":"8df767ba-0b8b-4a37-864b-6e95fe898d7f","label":"greet"} observed={"runId":"8df767ba-0b8b-4a37-864b-6e95fe898d7f","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"3dfdaa76-8647-4f66-b466-45c66a0f61a0","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-04T11:12:50.690Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"26cf4096-ce30-44fa-a83e-f097d4ea0b94","path":"output.txt"} observed={"runId":"26cf4096-ce30-44fa-a83e-f097d4ea0b94","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"26cf4096-ce30-44fa-a83e-f097d4ea0b94"} observed={"runId":"26cf4096-ce30-44fa-a83e-f097d4ea0b94","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"26cf4096-ce30-44fa-a83e-f097d4ea0b94","paths":["output.txt"]} observed={"runId":"26cf4096-ce30-44fa-a83e-f097d4ea0b94","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"workflow":"demo","cron":"* * * * *"} observed={"result":{"kind":"cron","id":"9394c388-f1ba-47be-838d-861adaf84a0e","workflow":"demo","claimedBy":"demo","cron":"* * * * *","enabled":false}}
- schedule_list: pass — args={} observed={"result":[{"id":"a891f3a3-afb7-41cd-944a-3065096097b7","kind":"cron","workflow":"demo","claimedBy":"demo","enabled":false,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"
- schedule_delete: pass — args={"id":"4b16328f-976c-4e31-8d0e-5d490d895f9b"} observed={}
- schedule_setEnabled: pass — args={"id":"a891f3a3-afb7-41cd-944a-3065096097b7","enabled":false} observed={}
- webhook_create: pass — args={"workflow":"demo"} observed={"result":{"webhookId":"91e2191c-a13f-44b1-a5e6-d14045169201","url":"http://127.0.0.1:38527/hooks/91e2191c-a13f-44b1-a5e6-d14045169201","secret":"e9dc7fc65cbb9b83b24e5a46d96c335edfedab6bc901b7dc6be6ac
- webhook_list: pass — args={} observed={"result":[{"id":"157b6818-b146-4c4c-bd1e-92f1e9ebd1f7","workflow":"demo","enabled":true,"secretFingerprint":"71e334324b08e9f7","refusalCount":0},{"id":"91e2191c-a13f-44b1-a5e6-d14045169201","workflow
- webhook_delete: pass — args={"id":"157b6818-b146-4c4c-bd1e-92f1e9ebd1f7"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[2.07,2.01,1.51],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":10
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":[],"result":{"name":"demo","removed":true,"releasedTriggers":[]}}
- workspace_purge: pass — args={"runId":"26cf4096-ce30-44fa-a83e-f097d4ea0b94"} observed={"runId":"26cf4096-ce30-44fa-a83e-f097d4ea0b94","status":"completed","result":{"purged":true}}
