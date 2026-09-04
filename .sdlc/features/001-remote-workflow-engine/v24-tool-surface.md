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
- run_start: pass — args={"name":"demo"} observed={"runId":"7504ce3c-c3cf-40eb-9567-74750a9b65d2","status":"running","result":{"runId":"7504ce3c-c3cf-40eb-9567-74750a9b65d2"}}
- run_status: pass — args={"runId":"311cd19f-1f40-4f42-80fb-0f0f39d037ec"} observed={"runId":"311cd19f-1f40-4f42-80fb-0f0f39d037ec","status":"completed","result":{"runId":"311cd19f-1f40-4f42-80fb-0f0f39d037ec","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"311cd19f-1f40-4f42-80fb-0f0f39d037ec"} observed={"runId":"311cd19f-1f40-4f42-80fb-0f0f39d037ec","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"eb82fe0d-6b99-4b1c-8f2f-eade7a1bd1f8"} observed={"runId":"eb82fe0d-6b99-4b1c-8f2f-eade7a1bd1f8","status":"suspended"}
- run_resume: pass — args={"runId":"d4a73c61-2226-44c7-8dd3-ea90df240e6d"} observed={"runId":"d4a73c61-2226-44c7-8dd3-ea90df240e6d","status":"running"}
- run_stop: pass — args={"runId":"07a9dca3-51f7-49f5-af43-40b166dad636"} observed={"runId":"07a9dca3-51f7-49f5-af43-40b166dad636","status":"stopped"}
- run_agent_log: pass — args={"runId":"dece30b1-84d3-4af1-85ab-87012a18b449","label":"greet"} observed={"runId":"dece30b1-84d3-4af1-85ab-87012a18b449","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"7504ce3c-c3cf-40eb-9567-74750a9b65d2","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-04T11:51:02.644Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"311cd19f-1f40-4f42-80fb-0f0f39d037ec","path":"output.txt"} observed={"runId":"311cd19f-1f40-4f42-80fb-0f0f39d037ec","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"311cd19f-1f40-4f42-80fb-0f0f39d037ec"} observed={"runId":"311cd19f-1f40-4f42-80fb-0f0f39d037ec","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"311cd19f-1f40-4f42-80fb-0f0f39d037ec","paths":["output.txt"]} observed={"runId":"311cd19f-1f40-4f42-80fb-0f0f39d037ec","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"workflow":"demo","cron":"* * * * *"} observed={"result":{"kind":"cron","id":"f946261f-88f5-4046-8ae2-7aabbb203910","workflow":"demo","claimedBy":"demo","cron":"* * * * *","enabled":false}}
- schedule_list: pass — args={} observed={"result":[{"id":"b6698047-f2ad-4843-8b14-dfc31d9d83bb","kind":"cron","workflow":"demo","claimedBy":"demo","enabled":false,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"
- schedule_delete: pass — args={"id":"98add725-6aca-4df8-b273-5adae69b9df3"} observed={}
- schedule_setEnabled: pass — args={"id":"b6698047-f2ad-4843-8b14-dfc31d9d83bb","enabled":false} observed={}
- webhook_create: pass — args={"workflow":"demo"} observed={"result":{"webhookId":"62897fb4-f4cc-4ee2-8442-aa5cb45f3ac8","url":"http://127.0.0.1:39401/hooks/62897fb4-f4cc-4ee2-8442-aa5cb45f3ac8","secret":"ac12d5dbe7599f47b8dae132a16e0059bee7579cafa4d60ef568ef
- webhook_list: pass — args={} observed={"result":[{"id":"40970426-6519-438b-9749-4701c8bebaeb","workflow":"demo","enabled":true,"secretFingerprint":"a2b388373067940f","refusalCount":0},{"id":"62897fb4-f4cc-4ee2-8442-aa5cb45f3ac8","workflow
- webhook_delete: pass — args={"id":"40970426-6519-438b-9749-4701c8bebaeb"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[2.81,2.04,1.73],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":10
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":[],"result":{"name":"demo","removed":true,"releasedTriggers":[]}}
- workspace_purge: pass — args={"runId":"311cd19f-1f40-4f42-80fb-0f0f39d037ec"} observed={"runId":"311cd19f-1f40-4f42-80fb-0f0f39d037ec","status":"completed","result":{"purged":true}}
