# v24 tool surface — REQ-118

rows: 35/35

- issue_report: unverified — args={"title":"fixture issue","reproSteps":"call issue_report","analysis":"REQ-118 surface probe"} observed="UNVERIFIED(no GitHub token)"
- issue_get: unverified — args={"number":1} observed="UNVERIFIED(no GitHub token)"
- issue_list: unverified — args={} observed="UNVERIFIED(no GitHub token)"
- issue_get_comments: unverified — args={"number":1} observed="UNVERIFIED(no GitHub token)"
- issue_comment_post: unverified — args={"number":1,"body":"hi"} observed="UNVERIFIED(no GitHub token)"
- workflow_register: pass — args={"name":"demo","script":"export const meta = {\n  description: 'Greet the caller in one sentence',\n  params: { agents: { greet: { model: { type: 'string', default: 'default' }, effort: { type: 'enum', enum: ['low','medium','high'], default: 'low' }, timeoutMs: { type: 'number', default: 60000 } } } },\n};\nphase('Greet');\nreturn await agent('greet', { prompt: 'Say hello' });","mermaid":"graph LR\nsubgraph \"Greet\"\ngreet([\"greet\"])\nend"} observed={"runId":"","status":"completed","version":2,"result":{"name":"demo","version":"v2"}}
- workflow_publish: pass — args={"name":"demo","version":"v1","channel":"release"} observed={"runId":"","status":"completed","result":{"channel":"release","version":"v1","from":"v1"}}
- workflow_describe: pass — args={"name":"demo"} observed={"runId":"","status":"completed","result":{"name":"demo","version":"v1","resolvedBy":"default-release","channels":{"release":"v1","beta":null},"versions":["v1","v2"],"description":"Greet the caller in
- workflow_source: pass — args={"name":"demo"} observed={"runId":"","status":"completed","owner":null,"params":{"agents":{"greet":{"model":{"type":"string","default":"default"},"effort":{"type":"enum","enum":["low","medium","high"],"default":"low"},"timeou
- workflow_list: pass — args={} observed={"runId":"","status":"completed","result":[{"name":"demo","owner":null,"versions":["v1","v2"],"channels":{"release":"v1","beta":null},"runnable":true},{"name":"demo-quick","owner":null,"versions":["v1
- workflow_authoring_guide: pass — args={} observed={"runId":"","status":"completed","result":{"text":"# Authoring a workflow script\n\nThis engine has no bundled guidance skill — the tool schemas returned by `tools/list` are the only documentation a c
- run_start: pass — args={"name":"demo"} observed={"runId":"5a8d6d73-3a33-4578-88fd-dd305dca2bcb","status":"running","result":{"runId":"5a8d6d73-3a33-4578-88fd-dd305dca2bcb"}}
- run_status: pass — args={"runId":"27710f35-588d-4f07-ad5f-db0b9b17225a"} observed={"runId":"27710f35-588d-4f07-ad5f-db0b9b17225a","status":"completed","result":{"runId":"27710f35-588d-4f07-ad5f-db0b9b17225a","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"27710f35-588d-4f07-ad5f-db0b9b17225a"} observed={"runId":"27710f35-588d-4f07-ad5f-db0b9b17225a","status":"completed","result":"ok","meta":{"usage":{"tokens":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"costUSD":0,"unpricedCalls":0,"unmapped
- run_suspend: pass — args={"runId":"aff5d513-6def-4585-b17b-8e12fef90ba4"} observed={"runId":"aff5d513-6def-4585-b17b-8e12fef90ba4","status":"suspended"}
- run_resume: pass — args={"runId":"0cc2be87-91ba-4a83-b499-aceefbf95e60"} observed={"runId":"0cc2be87-91ba-4a83-b499-aceefbf95e60","status":"running"}
- run_stop: pass — args={"runId":"4f9964ef-02de-4784-a94b-874214fce7d4"} observed={"runId":"4f9964ef-02de-4784-a94b-874214fce7d4","status":"stopped"}
- run_agent_log: pass — args={"runId":"af3a994b-ef8a-4aba-8870-6e4a53c34d7c","label":"greet"} observed={"runId":"af3a994b-ef8a-4aba-8870-6e4a53c34d7c","status":"running","harness":{"model":"stall","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","effo
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"5a8d6d73-3a33-4578-88fd-dd305dca2bcb","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-08T16:41:57.994Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"27710f35-588d-4f07-ad5f-db0b9b17225a","path":"output.txt"} observed={"runId":"27710f35-588d-4f07-ad5f-db0b9b17225a","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"27710f35-588d-4f07-ad5f-db0b9b17225a"} observed={"runId":"27710f35-588d-4f07-ad5f-db0b9b17225a","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"27710f35-588d-4f07-ad5f-db0b9b17225a","paths":["output.txt"]} observed={"runId":"27710f35-588d-4f07-ad5f-db0b9b17225a","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"cron":"* * * * *"} observed={"result":{"kind":"cron","id":"bb79f501-3f3e-4201-8266-75f691ac8921","claimedBy":null,"cron":"* * * * *","enabled":true}}
- schedule_list: pass — args={} observed={"result":[{"id":"151c3b9e-fa88-465a-adf6-a1a95ecd8ee1","kind":"cron","claimedBy":"demo","enabled":true,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"id":"b47e0aa3-9cd4-
- schedule_delete: pass — args={"id":"b47e0aa3-9cd4-49b9-a925-8d06fd8ca73e"} observed={}
- schedule_setEnabled: pass — args={"id":"151c3b9e-fa88-465a-adf6-a1a95ecd8ee1","enabled":false} observed={}
- webhook_create: pass — args={} observed={"result":{"webhookId":"43391b27-0cf3-4894-9a3f-2eb2aba61aae","url":"http://127.0.0.1:40461/hooks/43391b27-0cf3-4894-9a3f-2eb2aba61aae","secret":"1ae096d6f05e3746294f52099fb8860a9bfe374ffdcf94a6ad3184
- webhook_list: pass — args={} observed={"result":[{"id":"9394a6a0-f91d-475a-9821-2c4c02e79984","workflow":"demo","createdBy":null,"enabled":true,"secretFingerprint":"cb3e11f647995952","refusalCount":0},{"id":"43391b27-0cf3-4894-9a3f-2eb2ab
- webhook_delete: pass — args={"id":"9394a6a0-f91d-475a-9821-2c4c02e79984"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[1.32,2.05,2],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":94349
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":["151c3b9e-fa88-465a-adf6-a1a95ecd8ee1","9394a6a0-f91d-475a-9821-2c4c02e79984"],"result":{"name":"demo","removed":true,
- workspace_purge: pass — args={"runId":"27710f35-588d-4f07-ad5f-db0b9b17225a"} observed={"runId":"27710f35-588d-4f07-ad5f-db0b9b17225a","status":"completed","result":{"purged":true}}
