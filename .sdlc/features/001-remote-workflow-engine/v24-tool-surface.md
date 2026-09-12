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
- run_start: pass — args={"name":"demo"} observed={"runId":"31d80e36-907f-4713-a6e3-f32b42e9feb7","status":"running","result":{"runId":"31d80e36-907f-4713-a6e3-f32b42e9feb7"}}
- run_status: pass — args={"runId":"0a178aa9-2b10-402f-b148-7155e409ecd0"} observed={"runId":"0a178aa9-2b10-402f-b148-7155e409ecd0","status":"completed","result":{"runId":"0a178aa9-2b10-402f-b148-7155e409ecd0","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"0a178aa9-2b10-402f-b148-7155e409ecd0"} observed={"runId":"0a178aa9-2b10-402f-b148-7155e409ecd0","status":"completed","result":"ok","meta":{"usage":{"tokens":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"costUSD":0,"unpricedCalls":0,"unmapped
- run_suspend: pass — args={"runId":"79ee91d4-b46c-4996-bd46-38b744457cb0"} observed={"runId":"79ee91d4-b46c-4996-bd46-38b744457cb0","status":"suspended"}
- run_resume: pass — args={"runId":"1579efab-b25e-405e-8940-ce7bf53bbd16"} observed={"runId":"1579efab-b25e-405e-8940-ce7bf53bbd16","status":"running"}
- run_stop: pass — args={"runId":"55dd49e4-265e-4518-bffd-c961f4736a6e"} observed={"runId":"55dd49e4-265e-4518-bffd-c961f4736a6e","status":"stopped"}
- run_agent_log: pass — args={"runId":"830bf919-bc9f-4f08-bbc1-bc7117d0000a","label":"greet"} observed={"runId":"830bf919-bc9f-4f08-bbc1-bc7117d0000a","status":"running","harness":{"model":"stall","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","effo
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"31d80e36-907f-4713-a6e3-f32b42e9feb7","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-12T07:14:03.817Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"0a178aa9-2b10-402f-b148-7155e409ecd0","path":"output.txt"} observed={"runId":"0a178aa9-2b10-402f-b148-7155e409ecd0","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"0a178aa9-2b10-402f-b148-7155e409ecd0"} observed={"runId":"0a178aa9-2b10-402f-b148-7155e409ecd0","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"0a178aa9-2b10-402f-b148-7155e409ecd0","paths":["output.txt"]} observed={"runId":"0a178aa9-2b10-402f-b148-7155e409ecd0","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"cron":"* * * * *"} observed={"result":{"kind":"cron","id":"a74b2ff8-1ced-4514-a79a-0f406575654c","claimedBy":null,"cron":"* * * * *","enabled":true}}
- schedule_list: pass — args={} observed={"result":[{"id":"c7e57a87-fe29-4f64-8b52-3a0ee27cf22a","kind":"cron","claimedBy":"demo","enabled":true,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"id":"cf493df1-57dc-
- schedule_delete: pass — args={"id":"cf493df1-57dc-48ed-bff9-f25f7731cc38"} observed={}
- schedule_setEnabled: pass — args={"id":"c7e57a87-fe29-4f64-8b52-3a0ee27cf22a","enabled":false} observed={}
- webhook_create: pass — args={} observed={"result":{"webhookId":"1afa1b31-17dd-4dc4-92db-52d547fa0e96","url":"http://127.0.0.1:43513/hooks/1afa1b31-17dd-4dc4-92db-52d547fa0e96","secret":"8ee68fb315aac3198e779f7aa766001e1fa28c84759f3272234d5b
- webhook_list: pass — args={} observed={"result":[{"id":"e731e798-df34-4ae9-9d48-15d463cc35e0","workflow":"demo","createdBy":null,"enabled":true,"secretFingerprint":"7d2ade50d15f0efa","refusalCount":0},{"id":"1afa1b31-17dd-4dc4-92db-52d547
- webhook_delete: pass — args={"id":"e731e798-df34-4ae9-9d48-15d463cc35e0"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-fable-5","description":"Claude Fable 5 — most capable, long-horizon agentic tier","modalities":{"in":["text","image"],"out":["text"]},"contextWindow"
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[0.33,0.74,0.83],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":80
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":["c7e57a87-fe29-4f64-8b52-3a0ee27cf22a","e731e798-df34-4ae9-9d48-15d463cc35e0"],"result":{"name":"demo","removed":true,
- workspace_purge: pass — args={"runId":"0a178aa9-2b10-402f-b148-7155e409ecd0"} observed={"runId":"0a178aa9-2b10-402f-b148-7155e409ecd0","status":"completed","result":{"purged":true}}
