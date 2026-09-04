# v24 tool surface — REQ-118

rows: 35/35

- issue_report: unverified — args={"title":"x","body":"y"} observed="UNVERIFIED(no GitHub token)"
- issue_get: unverified — args={"number":1} observed="UNVERIFIED(no GitHub token)"
- issue_list: unverified — args={} observed="UNVERIFIED(no GitHub token)"
- issue_get_comments: unverified — args={"number":1} observed="UNVERIFIED(no GitHub token)"
- issue_comment_post: unverified — args={"number":1,"body":"hi"} observed="UNVERIFIED(no GitHub token)"
- workflow_register: pass — args={"name":"demo","script":"export const meta = {\n  description: 'Greet the caller in one sentence',\n  params: { agents: { greet: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },\n};\nreturn await agent('greet', { prompt: 'Say hello' });","mermaid":"graph TD;\ngreet([\"greet\"])"} observed={"runId":"","status":"completed","version":2,"result":{"name":"demo","version":"v2"}}
- workflow_publish: pass — args={"name":"demo","version":"v1"} observed={"runId":"","status":"completed","result":{"version":"v1","from":null}}
- workflow_describe: pass — args={"name":"demo"} observed={"runId":"","status":"completed","result":{"name":"demo","version":"v1","resolvedBy":"default-release","channels":{"release":"v1","beta":"v1"},"versions":["v1","v2"],"description":"Greet the caller in
- workflow_source: pass — args={"name":"demo"} observed={"runId":"","status":"completed","owner":null,"params":{"agents":{"greet":{"model":{"type":"string","default":"default"},"effort":{"type":"enum","enum":["low","medium","high"],"default":"low"},"timeou
- workflow_list: pass — args={} observed={"runId":"","status":"completed","result":[{"name":"demo","owner":null,"versions":["v1","v2"],"channels":{"release":"v1","beta":"v1"},"runnable":true},{"name":"demo-quick","owner":null,"versions":["v1
- workflow_authoring_guide: pass — args={} observed={"runId":"","status":"completed","result":{"text":"Authoring rules: declare every agent() call with a LITERAL string label; declare params.agents.<label> for each label found in the script (model/effo
- run_start: pass — args={"name":"demo"} observed={"runId":"93884fff-d79f-4ec8-a982-3591f3244ec2","status":"running","result":{"runId":"93884fff-d79f-4ec8-a982-3591f3244ec2"}}
- run_status: pass — args={"runId":"d49c14a3-acec-4ca1-b6de-1ff36f222fca"} observed={"runId":"d49c14a3-acec-4ca1-b6de-1ff36f222fca","status":"completed","result":{"runId":"d49c14a3-acec-4ca1-b6de-1ff36f222fca","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"d49c14a3-acec-4ca1-b6de-1ff36f222fca"} observed={"runId":"d49c14a3-acec-4ca1-b6de-1ff36f222fca","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"e1b3a7ad-1b21-49a6-99bf-43684637f3b7"} observed={"runId":"e1b3a7ad-1b21-49a6-99bf-43684637f3b7","status":"suspended"}
- run_resume: pass — args={"runId":"4b225bc6-fe56-4593-af90-5ea2f821f165"} observed={"runId":"4b225bc6-fe56-4593-af90-5ea2f821f165","status":"running"}
- run_stop: pass — args={"runId":"5aacd227-3cce-4a36-98cf-2bea231e83b7"} observed={"runId":"5aacd227-3cce-4a36-98cf-2bea231e83b7","status":"stopped"}
- run_agent_log: pass — args={"runId":"79e121fe-6e78-4ca7-92ce-8d4a9cf76263","label":"greet"} observed={"runId":"79e121fe-6e78-4ca7-92ce-8d4a9cf76263","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"93884fff-d79f-4ec8-a982-3591f3244ec2","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-04T10:21:19.369Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"d49c14a3-acec-4ca1-b6de-1ff36f222fca","path":"output.txt"} observed={"runId":"d49c14a3-acec-4ca1-b6de-1ff36f222fca","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"d49c14a3-acec-4ca1-b6de-1ff36f222fca"} observed={"runId":"d49c14a3-acec-4ca1-b6de-1ff36f222fca","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"d49c14a3-acec-4ca1-b6de-1ff36f222fca","paths":["output.txt"]} observed={"runId":"d49c14a3-acec-4ca1-b6de-1ff36f222fca","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"workflow":"demo","cron":"* * * * *"} observed={"result":{"kind":"cron","id":"319bb6e3-6a60-474a-8cf5-cea16600fb65","workflow":"demo","claimedBy":"demo","cron":"* * * * *","enabled":false}}
- schedule_list: pass — args={} observed={"result":[{"id":"1418d68d-2e49-4a3a-8490-59b77a2b4d3d","kind":"cron","workflow":"demo","claimedBy":"demo","enabled":false,"nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"id":"5a9a5323-8857-
- schedule_delete: pass — args={"id":"5a9a5323-8857-490d-acd6-41708c76f215"} observed={}
- schedule_setEnabled: pass — args={"id":"1418d68d-2e49-4a3a-8490-59b77a2b4d3d","enabled":false} observed={}
- webhook_create: pass — args={"workflow":"demo"} observed={"result":{"webhookId":"cef1fe68-52d8-4be2-ab78-ca3e856ee89d","url":"http://127.0.0.1:44203/hooks/cef1fe68-52d8-4be2-ab78-ca3e856ee89d","secret":"ae5a0655675f0dd2ee46589cdf003191167a21095221d15d6bc3ef
- webhook_list: pass — args={} observed={"result":[{"id":"6a15628e-e191-4f2b-9b4f-7fb9d7506790","workflow":"demo","enabled":true,"secretFingerprint":"67201ed38694efb7","refusalCount":0},{"id":"cef1fe68-52d8-4be2-ab78-ca3e856ee89d","workflow
- webhook_delete: pass — args={"id":"6a15628e-e191-4f2b-9b4f-7fb9d7506790"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[1.87,1.52,1.26],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":14
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":[],"result":{"name":"demo","removed":true,"releasedTriggers":[]}}
- workspace_purge: pass — args={"runId":"d49c14a3-acec-4ca1-b6de-1ff36f222fca"} observed={"runId":"d49c14a3-acec-4ca1-b6de-1ff36f222fca","status":"completed","result":{"purged":true}}
