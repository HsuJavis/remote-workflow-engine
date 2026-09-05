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
- run_start: pass — args={"name":"demo"} observed={"runId":"e3c5da8c-0d92-435d-b6b5-d854b2838cdc","status":"running","result":{"runId":"e3c5da8c-0d92-435d-b6b5-d854b2838cdc"}}
- run_status: pass — args={"runId":"2f00eef8-42d2-4d94-a4d3-ca253bbdbfc2"} observed={"runId":"2f00eef8-42d2-4d94-a4d3-ca253bbdbfc2","status":"completed","result":{"runId":"2f00eef8-42d2-4d94-a4d3-ca253bbdbfc2","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"2f00eef8-42d2-4d94-a4d3-ca253bbdbfc2"} observed={"runId":"2f00eef8-42d2-4d94-a4d3-ca253bbdbfc2","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"bbc85b70-99ae-40ad-876d-0b1c5793a915"} observed={"runId":"bbc85b70-99ae-40ad-876d-0b1c5793a915","status":"suspended"}
- run_resume: pass — args={"runId":"c12e6242-a397-493e-b34a-8eda0b7a4869"} observed={"runId":"c12e6242-a397-493e-b34a-8eda0b7a4869","status":"running"}
- run_stop: pass — args={"runId":"79a91658-5a24-40cc-a5d2-fc571f30de3e"} observed={"runId":"79a91658-5a24-40cc-a5d2-fc571f30de3e","status":"stopped"}
- run_agent_log: pass — args={"runId":"48bd659f-d5d2-41e7-979f-7b7a3ab34a17","label":"greet"} observed={"runId":"48bd659f-d5d2-41e7-979f-7b7a3ab34a17","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"e3c5da8c-0d92-435d-b6b5-d854b2838cdc","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-05T00:18:42.472Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"2f00eef8-42d2-4d94-a4d3-ca253bbdbfc2","path":"output.txt"} observed={"runId":"2f00eef8-42d2-4d94-a4d3-ca253bbdbfc2","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"2f00eef8-42d2-4d94-a4d3-ca253bbdbfc2"} observed={"runId":"2f00eef8-42d2-4d94-a4d3-ca253bbdbfc2","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"2f00eef8-42d2-4d94-a4d3-ca253bbdbfc2","paths":["output.txt"]} observed={"runId":"2f00eef8-42d2-4d94-a4d3-ca253bbdbfc2","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"cron":"* * * * *"} observed={"result":{"kind":"cron","id":"3a495ec7-fb1c-4035-8395-f7464767303d","claimedBy":null,"cron":"* * * * *","enabled":true}}
- schedule_list: pass — args={} observed={"result":[{"id":"b05aaaa4-a1c0-4157-9fe6-f5bce373d023","kind":"cron","workflow":"demo","claimedBy":"demo","enabled":true,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"i
- schedule_delete: pass — args={"id":"a16ed5a5-0fc9-42e1-8bf2-aa7726c26395"} observed={}
- schedule_setEnabled: pass — args={"id":"b05aaaa4-a1c0-4157-9fe6-f5bce373d023","enabled":false} observed={}
- webhook_create: pass — args={} observed={"result":{"webhookId":"f6706d84-7891-4e56-a39e-99ecbfee1528","url":"http://127.0.0.1:40193/hooks/f6706d84-7891-4e56-a39e-99ecbfee1528","secret":"a7c2b2a80875036fa329b47aa645a571f4ffc07d20c8d22ab23718
- webhook_list: pass — args={} observed={"result":[{"id":"56468668-4b69-4bee-b9b9-561b4f2341e5","workflow":"demo","createdBy":null,"enabled":true,"secretFingerprint":"90502ca9bf705e0a","refusalCount":0},{"id":"f6706d84-7891-4e56-a39e-99ecbf
- webhook_delete: pass — args={"id":"56468668-4b69-4bee-b9b9-561b4f2341e5"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[1.14,0.94,0.89],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":97
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":["b05aaaa4-a1c0-4157-9fe6-f5bce373d023"],"result":{"name":"demo","removed":true,"releasedTriggers":["b05aaaa4-a1c0-4157
- workspace_purge: pass — args={"runId":"2f00eef8-42d2-4d94-a4d3-ca253bbdbfc2"} observed={"runId":"2f00eef8-42d2-4d94-a4d3-ca253bbdbfc2","status":"completed","result":{"purged":true}}
