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
- run_start: pass — args={"name":"demo"} observed={"runId":"24b4627f-ee14-4e40-af32-37056bed8c4c","status":"running","result":{"runId":"24b4627f-ee14-4e40-af32-37056bed8c4c"}}
- run_status: pass — args={"runId":"403b935a-ce00-4b90-8694-bd2706ea3d56"} observed={"runId":"403b935a-ce00-4b90-8694-bd2706ea3d56","status":"completed","result":{"runId":"403b935a-ce00-4b90-8694-bd2706ea3d56","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"403b935a-ce00-4b90-8694-bd2706ea3d56"} observed={"runId":"403b935a-ce00-4b90-8694-bd2706ea3d56","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"f2bf4944-b193-42f8-b4d6-0950c0bfef56"} observed={"runId":"f2bf4944-b193-42f8-b4d6-0950c0bfef56","status":"suspended"}
- run_resume: pass — args={"runId":"931b2356-5691-4c00-b9ef-55cc8b5a86f5"} observed={"runId":"931b2356-5691-4c00-b9ef-55cc8b5a86f5","status":"running"}
- run_stop: pass — args={"runId":"36190f0d-fd84-4f41-b301-2b3e41bf94b3"} observed={"runId":"36190f0d-fd84-4f41-b301-2b3e41bf94b3","status":"stopped"}
- run_agent_log: pass — args={"runId":"65b37c52-9a5a-4a67-b37b-837c29e34a3b","label":"greet"} observed={"runId":"65b37c52-9a5a-4a67-b37b-837c29e34a3b","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"24b4627f-ee14-4e40-af32-37056bed8c4c","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-04T10:17:52.774Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"403b935a-ce00-4b90-8694-bd2706ea3d56","path":"output.txt"} observed={"runId":"403b935a-ce00-4b90-8694-bd2706ea3d56","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"403b935a-ce00-4b90-8694-bd2706ea3d56"} observed={"runId":"403b935a-ce00-4b90-8694-bd2706ea3d56","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"403b935a-ce00-4b90-8694-bd2706ea3d56","paths":["output.txt"]} observed={"runId":"403b935a-ce00-4b90-8694-bd2706ea3d56","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"workflow":"demo","cron":"* * * * *"} observed={"result":{"kind":"cron","id":"bded7d54-a432-47cf-b73b-42d90cba9440","workflow":"demo","claimedBy":"demo","cron":"* * * * *","enabled":false}}
- schedule_list: pass — args={} observed={"result":[{"id":"96d02c98-59e0-478a-97a1-e21a27453769","kind":"cron","workflow":"demo","claimedBy":"demo","enabled":false,"nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"id":"e472a256-814b-
- schedule_delete: pass — args={"id":"e472a256-814b-4e10-ae83-3619a6e7d6c4"} observed={}
- schedule_setEnabled: pass — args={"id":"96d02c98-59e0-478a-97a1-e21a27453769","enabled":false} observed={}
- webhook_create: pass — args={"workflow":"demo"} observed={"result":{"webhookId":"edfa8e0a-0581-426d-9949-40998241d123","url":"http://127.0.0.1:36931/hooks/edfa8e0a-0581-426d-9949-40998241d123","secret":"576ad6ba75757075a373f6c574e45b4cfb0ade8b72bbf3b84c9ac8
- webhook_list: pass — args={} observed={"result":[{"id":"ec82bc10-3859-40e1-938a-d98abef18a60","workflow":"demo","enabled":true,"secretFingerprint":"3e5d4676cafd30d9","refusalCount":0},{"id":"edfa8e0a-0581-426d-9949-40998241d123","workflow
- webhook_delete: pass — args={"id":"ec82bc10-3859-40e1-938a-d98abef18a60"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[1.27,1.07,1.08],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":10
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":[],"result":{"name":"demo","removed":true,"releasedTriggers":[]}}
- workspace_purge: pass — args={"runId":"403b935a-ce00-4b90-8694-bd2706ea3d56"} observed={"runId":"403b935a-ce00-4b90-8694-bd2706ea3d56","status":"completed","result":{"purged":true}}
