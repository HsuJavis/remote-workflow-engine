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
- run_start: pass — args={"name":"demo"} observed={"runId":"dfc9d8d3-6614-4e55-b0bb-d61c5aebacde","status":"running","result":{"runId":"dfc9d8d3-6614-4e55-b0bb-d61c5aebacde"}}
- run_status: pass — args={"runId":"f567b6fb-945b-4589-bd2e-d40b0eda1a6a"} observed={"runId":"f567b6fb-945b-4589-bd2e-d40b0eda1a6a","status":"completed","result":{"runId":"f567b6fb-945b-4589-bd2e-d40b0eda1a6a","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"f567b6fb-945b-4589-bd2e-d40b0eda1a6a"} observed={"runId":"f567b6fb-945b-4589-bd2e-d40b0eda1a6a","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"75894209-9e7f-40fc-8ed2-33c456c36257"} observed={"runId":"75894209-9e7f-40fc-8ed2-33c456c36257","status":"suspended"}
- run_resume: pass — args={"runId":"dcbb42e9-dee0-4ae8-9ef3-a5208c754b1f"} observed={"runId":"dcbb42e9-dee0-4ae8-9ef3-a5208c754b1f","status":"running"}
- run_stop: pass — args={"runId":"b7c29bd0-8433-45df-92dc-7ee1da42a12f"} observed={"runId":"b7c29bd0-8433-45df-92dc-7ee1da42a12f","status":"stopped"}
- run_agent_log: pass — args={"runId":"2f3efd27-b59c-4aad-b93f-f4f2b1d941e9","label":"greet"} observed={"runId":"2f3efd27-b59c-4aad-b93f-f4f2b1d941e9","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"dfc9d8d3-6614-4e55-b0bb-d61c5aebacde","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-04T10:15:44.538Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"f567b6fb-945b-4589-bd2e-d40b0eda1a6a","path":"output.txt"} observed={"runId":"f567b6fb-945b-4589-bd2e-d40b0eda1a6a","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"f567b6fb-945b-4589-bd2e-d40b0eda1a6a"} observed={"runId":"f567b6fb-945b-4589-bd2e-d40b0eda1a6a","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"f567b6fb-945b-4589-bd2e-d40b0eda1a6a","paths":["output.txt"]} observed={"runId":"f567b6fb-945b-4589-bd2e-d40b0eda1a6a","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"workflow":"demo","cron":"* * * * *"} observed={"result":{"kind":"cron","id":"6bf964a5-b625-42f3-b794-951015be9bcb","workflow":"demo","claimedBy":"demo","cron":"* * * * *","enabled":false}}
- schedule_list: pass — args={} observed={"result":[{"id":"b191d5c8-0a17-468f-9df7-97d052efc400","kind":"cron","workflow":"demo","claimedBy":"demo","enabled":false,"nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"id":"2fb50a19-5a1f-
- schedule_delete: pass — args={"id":"2fb50a19-5a1f-4f08-894e-851dc6cb9053"} observed={}
- schedule_setEnabled: pass — args={"id":"b191d5c8-0a17-468f-9df7-97d052efc400","enabled":false} observed={}
- webhook_create: pass — args={"workflow":"demo"} observed={"result":{"webhookId":"4a9f9884-aa6c-4bd7-9289-0fa45deae729","url":"http://127.0.0.1:37039/hooks/4a9f9884-aa6c-4bd7-9289-0fa45deae729","secret":"bf4f0132b721dc54fed43acd214097b0dc5c30afc0a8b77c7fb8e0
- webhook_list: pass — args={} observed={"result":[{"id":"cd4eba0a-7c98-4f24-aeca-948b40e99d80","workflow":"demo","enabled":true,"secretFingerprint":"f92d17ed6e608490","refusalCount":0},{"id":"4a9f9884-aa6c-4bd7-9289-0fa45deae729","workflow
- webhook_delete: pass — args={"id":"cd4eba0a-7c98-4f24-aeca-948b40e99d80"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[1.01,1.11,1.1],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":105
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":[],"result":{"name":"demo","removed":true,"releasedTriggers":[]}}
- workspace_purge: pass — args={"runId":"f567b6fb-945b-4589-bd2e-d40b0eda1a6a"} observed={"runId":"f567b6fb-945b-4589-bd2e-d40b0eda1a6a","status":"completed","result":{"purged":true}}
