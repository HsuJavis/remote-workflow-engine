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
- run_start: pass — args={"name":"demo"} observed={"runId":"c880b36a-8822-4123-a901-2554472f28a6","status":"running","result":{"runId":"c880b36a-8822-4123-a901-2554472f28a6"}}
- run_status: pass — args={"runId":"16eed9a8-0a00-439b-932e-30ec32bb41ad"} observed={"runId":"16eed9a8-0a00-439b-932e-30ec32bb41ad","status":"completed","result":{"runId":"16eed9a8-0a00-439b-932e-30ec32bb41ad","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"16eed9a8-0a00-439b-932e-30ec32bb41ad"} observed={"runId":"16eed9a8-0a00-439b-932e-30ec32bb41ad","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"da766634-75f6-4d13-af7d-391b7f076120"} observed={"runId":"da766634-75f6-4d13-af7d-391b7f076120","status":"suspended"}
- run_resume: pass — args={"runId":"3b2ef9c0-4a43-486c-ac1c-95decc24a182"} observed={"runId":"3b2ef9c0-4a43-486c-ac1c-95decc24a182","status":"running"}
- run_stop: pass — args={"runId":"56ce800f-73cc-4310-abcf-0e4626088af1"} observed={"runId":"56ce800f-73cc-4310-abcf-0e4626088af1","status":"stopped"}
- run_agent_log: pass — args={"runId":"954bbdcf-c86e-4e4f-b46c-169decb6582a","label":"greet"} observed={"runId":"954bbdcf-c86e-4e4f-b46c-169decb6582a","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"c880b36a-8822-4123-a901-2554472f28a6","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-04T10:24:27.916Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"16eed9a8-0a00-439b-932e-30ec32bb41ad","path":"output.txt"} observed={"runId":"16eed9a8-0a00-439b-932e-30ec32bb41ad","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"16eed9a8-0a00-439b-932e-30ec32bb41ad"} observed={"runId":"16eed9a8-0a00-439b-932e-30ec32bb41ad","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"16eed9a8-0a00-439b-932e-30ec32bb41ad","paths":["output.txt"]} observed={"runId":"16eed9a8-0a00-439b-932e-30ec32bb41ad","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"workflow":"demo","cron":"* * * * *"} observed={"result":{"kind":"cron","id":"afc021b3-82de-4b6f-97c3-a64683ba9fdf","workflow":"demo","claimedBy":"demo","cron":"* * * * *","enabled":false}}
- schedule_list: pass — args={} observed={"result":[{"id":"496b8118-2a90-448b-a0af-294b83bf3f71","kind":"cron","workflow":"demo","claimedBy":"demo","enabled":false,"nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"id":"8148036b-a678-
- schedule_delete: pass — args={"id":"8148036b-a678-4279-a7fd-0938930d4fa6"} observed={}
- schedule_setEnabled: pass — args={"id":"496b8118-2a90-448b-a0af-294b83bf3f71","enabled":false} observed={}
- webhook_create: pass — args={"workflow":"demo"} observed={"result":{"webhookId":"3482b1bc-7752-45f7-814f-409682d81d97","url":"http://127.0.0.1:40115/hooks/3482b1bc-7752-45f7-814f-409682d81d97","secret":"690b7172ff04a072e9e0502f42109af1dbf05b8eca8512f16a72dd
- webhook_list: pass — args={} observed={"result":[{"id":"38e6176e-97ca-402a-a780-2b1b932452d8","workflow":"demo","enabled":true,"secretFingerprint":"ad1333d1a0a6d65d","refusalCount":0},{"id":"3482b1bc-7752-45f7-814f-409682d81d97","workflow
- webhook_delete: pass — args={"id":"38e6176e-97ca-402a-a780-2b1b932452d8"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[2.18,1.79,1.41],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":10
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":[],"result":{"name":"demo","removed":true,"releasedTriggers":[]}}
- workspace_purge: pass — args={"runId":"16eed9a8-0a00-439b-932e-30ec32bb41ad"} observed={"runId":"16eed9a8-0a00-439b-932e-30ec32bb41ad","status":"completed","result":{"purged":true}}
