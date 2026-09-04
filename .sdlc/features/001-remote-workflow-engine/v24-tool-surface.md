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
- run_start: pass — args={"name":"demo"} observed={"runId":"cce6f839-0e0a-4086-b323-46168deb377c","status":"running","result":{"runId":"cce6f839-0e0a-4086-b323-46168deb377c"}}
- run_status: pass — args={"runId":"f2ff124f-d097-43b1-8489-4c785efecb32"} observed={"runId":"f2ff124f-d097-43b1-8489-4c785efecb32","status":"completed","result":{"runId":"f2ff124f-d097-43b1-8489-4c785efecb32","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"f2ff124f-d097-43b1-8489-4c785efecb32"} observed={"runId":"f2ff124f-d097-43b1-8489-4c785efecb32","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"8af0ab93-ba80-4a67-bf85-c12c19a2252f"} observed={"runId":"8af0ab93-ba80-4a67-bf85-c12c19a2252f","status":"suspended"}
- run_resume: pass — args={"runId":"4b1359e5-6b09-44de-9058-6064f2e62764"} observed={"runId":"4b1359e5-6b09-44de-9058-6064f2e62764","status":"running"}
- run_stop: pass — args={"runId":"7a2f447d-322a-4f39-aa75-12e1679ae614"} observed={"runId":"7a2f447d-322a-4f39-aa75-12e1679ae614","status":"stopped"}
- run_agent_log: pass — args={"runId":"7681da64-4522-4d89-bd88-3ef93c7160bc","label":"greet"} observed={"runId":"7681da64-4522-4d89-bd88-3ef93c7160bc","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"cce6f839-0e0a-4086-b323-46168deb377c","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-04T11:46:26.872Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"f2ff124f-d097-43b1-8489-4c785efecb32","path":"output.txt"} observed={"runId":"f2ff124f-d097-43b1-8489-4c785efecb32","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"f2ff124f-d097-43b1-8489-4c785efecb32"} observed={"runId":"f2ff124f-d097-43b1-8489-4c785efecb32","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"f2ff124f-d097-43b1-8489-4c785efecb32","paths":["output.txt"]} observed={"runId":"f2ff124f-d097-43b1-8489-4c785efecb32","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"workflow":"demo","cron":"* * * * *"} observed={"result":{"kind":"cron","id":"c21ded62-b888-4380-a87d-8d6f85058d37","workflow":"demo","claimedBy":"demo","cron":"* * * * *","enabled":false}}
- schedule_list: pass — args={} observed={"result":[{"id":"2ceb90ea-e73c-455f-80fe-8c2709717958","kind":"cron","workflow":"demo","claimedBy":"demo","enabled":false,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"
- schedule_delete: pass — args={"id":"463dfccb-b6ff-4242-bd0c-c1ac182f5e5f"} observed={}
- schedule_setEnabled: pass — args={"id":"2ceb90ea-e73c-455f-80fe-8c2709717958","enabled":false} observed={}
- webhook_create: pass — args={"workflow":"demo"} observed={"result":{"webhookId":"f1f798e6-7e25-4c89-93e4-6c410d3837ce","url":"http://127.0.0.1:42985/hooks/f1f798e6-7e25-4c89-93e4-6c410d3837ce","secret":"ee285a402e030629ebaf283177dc0b5beb5cbed29a9fef45cdc076
- webhook_list: pass — args={} observed={"result":[{"id":"704bffac-a955-4b10-9883-e239949437d0","workflow":"demo","enabled":true,"secretFingerprint":"79dc13e1102f42e6","refusalCount":0},{"id":"f1f798e6-7e25-4c89-93e4-6c410d3837ce","workflow
- webhook_delete: pass — args={"id":"704bffac-a955-4b10-9883-e239949437d0"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[1.31,1.66,1.58],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":10
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":[],"result":{"name":"demo","removed":true,"releasedTriggers":[]}}
- workspace_purge: pass — args={"runId":"f2ff124f-d097-43b1-8489-4c785efecb32"} observed={"runId":"f2ff124f-d097-43b1-8489-4c785efecb32","status":"completed","result":{"purged":true}}
