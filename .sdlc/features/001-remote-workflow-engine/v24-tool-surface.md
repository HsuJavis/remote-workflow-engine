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
- run_start: pass — args={"name":"demo"} observed={"runId":"7e31aee2-7730-466e-87ee-a641e1cf78a7","status":"running","result":{"runId":"7e31aee2-7730-466e-87ee-a641e1cf78a7"}}
- run_status: pass — args={"runId":"50702539-8ad4-4b07-b4cd-a8767651b75f"} observed={"runId":"50702539-8ad4-4b07-b4cd-a8767651b75f","status":"completed","result":{"runId":"50702539-8ad4-4b07-b4cd-a8767651b75f","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"50702539-8ad4-4b07-b4cd-a8767651b75f"} observed={"runId":"50702539-8ad4-4b07-b4cd-a8767651b75f","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"346c5b04-bb3a-45ef-b93c-4b17fe7f2055"} observed={"runId":"346c5b04-bb3a-45ef-b93c-4b17fe7f2055","status":"suspended"}
- run_resume: pass — args={"runId":"f6df9885-069c-4181-9570-0ae48f564e53"} observed={"runId":"f6df9885-069c-4181-9570-0ae48f564e53","status":"running"}
- run_stop: pass — args={"runId":"7545fa48-fa57-4e1e-89f3-333fd44ebde5"} observed={"runId":"7545fa48-fa57-4e1e-89f3-333fd44ebde5","status":"stopped"}
- run_agent_log: pass — args={"runId":"17c7ba94-6af3-4d0a-a8e2-0ea8c914b654","label":"greet"} observed={"runId":"17c7ba94-6af3-4d0a-a8e2-0ea8c914b654","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"7e31aee2-7730-466e-87ee-a641e1cf78a7","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-04T09:54:03.587Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"50702539-8ad4-4b07-b4cd-a8767651b75f","path":"output.txt"} observed={"runId":"50702539-8ad4-4b07-b4cd-a8767651b75f","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"50702539-8ad4-4b07-b4cd-a8767651b75f"} observed={"runId":"50702539-8ad4-4b07-b4cd-a8767651b75f","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"50702539-8ad4-4b07-b4cd-a8767651b75f","paths":["output.txt"]} observed={"runId":"50702539-8ad4-4b07-b4cd-a8767651b75f","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"workflow":"demo","cron":"* * * * *"} observed={"result":{"kind":"cron","id":"7ff66abb-ee1e-4b10-bb59-a974450a603c","workflow":"demo","claimedBy":"demo","cron":"* * * * *","enabled":false}}
- schedule_list: pass — args={} observed={"result":[{"id":"617c8904-5681-4734-98fc-6ca6acc7c646","kind":"cron","workflow":"demo","claimedBy":"demo","enabled":false,"nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"id":"9023f700-21c3-
- schedule_delete: pass — args={"id":"9023f700-21c3-43cc-b33b-7e726bce42d0"} observed={}
- schedule_setEnabled: pass — args={"id":"617c8904-5681-4734-98fc-6ca6acc7c646","enabled":false} observed={}
- webhook_create: pass — args={"workflow":"demo"} observed={"result":{"webhookId":"8fa7e1b3-ac2b-4684-bc97-528d6866b891","url":"http://127.0.0.1:38199/hooks/8fa7e1b3-ac2b-4684-bc97-528d6866b891","secret":"b1480cbdc50e72e4d52db8c8bfa6f6606f8d1c38470dbcfce230f9
- webhook_list: pass — args={} observed={"result":[{"id":"d5a525bf-09e2-4dd2-9ab2-8a9f80336bb6","workflow":"demo","enabled":true,"secretFingerprint":"05d0592e9a1f8194","refusalCount":0},{"id":"8fa7e1b3-ac2b-4684-bc97-528d6866b891","workflow
- webhook_delete: pass — args={"id":"d5a525bf-09e2-4dd2-9ab2-8a9f80336bb6"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[1.68,1.41,1.3],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":101
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":[],"result":{"name":"demo","removed":true,"releasedTriggers":[]}}
- workspace_purge: pass — args={"runId":"50702539-8ad4-4b07-b4cd-a8767651b75f"} observed={"runId":"50702539-8ad4-4b07-b4cd-a8767651b75f","status":"completed","result":{"purged":true}}
