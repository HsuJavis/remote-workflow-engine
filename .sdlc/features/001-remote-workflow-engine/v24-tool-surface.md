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
- run_start: pass — args={"name":"demo"} observed={"runId":"5cfb9f43-c415-4175-b86f-9ea7313b032b","status":"running","result":{"runId":"5cfb9f43-c415-4175-b86f-9ea7313b032b"}}
- run_status: pass — args={"runId":"e2cedab4-ee63-4c33-afc3-44ee1ef42e76"} observed={"runId":"e2cedab4-ee63-4c33-afc3-44ee1ef42e76","status":"completed","result":{"runId":"e2cedab4-ee63-4c33-afc3-44ee1ef42e76","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"e2cedab4-ee63-4c33-afc3-44ee1ef42e76"} observed={"runId":"e2cedab4-ee63-4c33-afc3-44ee1ef42e76","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"03557c22-338c-4ede-adfb-e2595e257217"} observed={"runId":"03557c22-338c-4ede-adfb-e2595e257217","status":"suspended"}
- run_resume: pass — args={"runId":"564feb1b-0e75-4f9e-91ec-f5bf4b486370"} observed={"runId":"564feb1b-0e75-4f9e-91ec-f5bf4b486370","status":"running"}
- run_stop: pass — args={"runId":"b967172a-17b4-4e01-9251-56b9bbe719c5"} observed={"runId":"b967172a-17b4-4e01-9251-56b9bbe719c5","status":"stopped"}
- run_agent_log: pass — args={"runId":"79cbece3-1461-4494-a047-dfc008cd2f6d","label":"greet"} observed={"runId":"79cbece3-1461-4494-a047-dfc008cd2f6d","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"5cfb9f43-c415-4175-b86f-9ea7313b032b","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-08T08:14:23.426Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"e2cedab4-ee63-4c33-afc3-44ee1ef42e76","path":"output.txt"} observed={"runId":"e2cedab4-ee63-4c33-afc3-44ee1ef42e76","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"e2cedab4-ee63-4c33-afc3-44ee1ef42e76"} observed={"runId":"e2cedab4-ee63-4c33-afc3-44ee1ef42e76","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"e2cedab4-ee63-4c33-afc3-44ee1ef42e76","paths":["output.txt"]} observed={"runId":"e2cedab4-ee63-4c33-afc3-44ee1ef42e76","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"cron":"* * * * *"} observed={"result":{"kind":"cron","id":"fcd325e5-5900-4adf-a376-48454cd7a9a3","claimedBy":null,"cron":"* * * * *","enabled":true}}
- schedule_list: pass — args={} observed={"result":[{"id":"d6d2836d-5761-41b4-87ca-e798332a4737","kind":"cron","claimedBy":"demo","enabled":true,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"id":"b51b416d-4aec-
- schedule_delete: pass — args={"id":"b51b416d-4aec-4daa-b30c-a2a3865ca164"} observed={}
- schedule_setEnabled: pass — args={"id":"d6d2836d-5761-41b4-87ca-e798332a4737","enabled":false} observed={}
- webhook_create: pass — args={} observed={"result":{"webhookId":"e2abe225-d687-491a-9df1-4094d4cb9095","url":"http://127.0.0.1:39163/hooks/e2abe225-d687-491a-9df1-4094d4cb9095","secret":"e16d615eae8230f56a48e4afdbe1fa8ab2684ee51bb633d288eec8
- webhook_list: pass — args={} observed={"result":[{"id":"dd078704-ac37-4f97-a11b-756ce724ee52","workflow":"demo","createdBy":null,"enabled":true,"secretFingerprint":"c12f443f2202fd45","refusalCount":0},{"id":"e2abe225-d687-491a-9df1-4094d4
- webhook_delete: pass — args={"id":"dd078704-ac37-4f97-a11b-756ce724ee52"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[2.52,1.76,0.98],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":93
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":["d6d2836d-5761-41b4-87ca-e798332a4737","dd078704-ac37-4f97-a11b-756ce724ee52"],"result":{"name":"demo","removed":true,
- workspace_purge: pass — args={"runId":"e2cedab4-ee63-4c33-afc3-44ee1ef42e76"} observed={"runId":"e2cedab4-ee63-4c33-afc3-44ee1ef42e76","status":"completed","result":{"purged":true}}
