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
- run_start: pass — args={"name":"demo"} observed={"runId":"72881421-9200-46ae-b5be-a52dadf616c7","status":"running","result":{"runId":"72881421-9200-46ae-b5be-a52dadf616c7"}}
- run_status: pass — args={"runId":"333a39fc-2441-4c10-93ce-c4ef0846378f"} observed={"runId":"333a39fc-2441-4c10-93ce-c4ef0846378f","status":"completed","result":{"runId":"333a39fc-2441-4c10-93ce-c4ef0846378f","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"333a39fc-2441-4c10-93ce-c4ef0846378f"} observed={"runId":"333a39fc-2441-4c10-93ce-c4ef0846378f","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"27128ef0-121a-491e-a88e-58b424a72f9f"} observed={"runId":"27128ef0-121a-491e-a88e-58b424a72f9f","status":"suspended"}
- run_resume: pass — args={"runId":"9c495da6-3df7-47a9-b644-3133be25d097"} observed={"runId":"9c495da6-3df7-47a9-b644-3133be25d097","status":"running"}
- run_stop: pass — args={"runId":"eb24cb1e-1db6-46c9-915e-dca23965e665"} observed={"runId":"eb24cb1e-1db6-46c9-915e-dca23965e665","status":"stopped"}
- run_agent_log: pass — args={"runId":"8ac3b3b1-d8e9-4981-bd5b-c4097d97f4e6","label":"greet"} observed={"runId":"8ac3b3b1-d8e9-4981-bd5b-c4097d97f4e6","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"72881421-9200-46ae-b5be-a52dadf616c7","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-04T12:57:40.629Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"333a39fc-2441-4c10-93ce-c4ef0846378f","path":"output.txt"} observed={"runId":"333a39fc-2441-4c10-93ce-c4ef0846378f","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"333a39fc-2441-4c10-93ce-c4ef0846378f"} observed={"runId":"333a39fc-2441-4c10-93ce-c4ef0846378f","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"333a39fc-2441-4c10-93ce-c4ef0846378f","paths":["output.txt"]} observed={"runId":"333a39fc-2441-4c10-93ce-c4ef0846378f","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"workflow":"demo","cron":"* * * * *"} observed={"result":{"kind":"cron","id":"cc318fec-870f-47e5-856f-6b90262f5cb3","workflow":"demo","claimedBy":"demo","cron":"* * * * *","enabled":true}}
- schedule_list: pass — args={} observed={"result":[{"id":"00ec12eb-3a6d-4c85-99f4-d8a80031ffa4","kind":"cron","workflow":"demo","claimedBy":"demo","enabled":true,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"i
- schedule_delete: pass — args={"id":"991b45ea-727d-45a6-a366-0d497202926b"} observed={}
- schedule_setEnabled: pass — args={"id":"00ec12eb-3a6d-4c85-99f4-d8a80031ffa4","enabled":false} observed={}
- webhook_create: pass — args={"workflow":"demo"} observed={"result":{"webhookId":"baaf5839-2d8e-4825-9bdf-00959dac7443","url":"http://127.0.0.1:37121/hooks/baaf5839-2d8e-4825-9bdf-00959dac7443","secret":"8e9b7859ac9c58642b6374947691b83e01531060cfd93ecdd48417
- webhook_list: pass — args={} observed={"result":[{"id":"da799279-d908-4e6a-a4b5-670b3b101a27","workflow":"demo","createdBy":null,"enabled":true,"secretFingerprint":"fcd37e38aeda7369","refusalCount":0},{"id":"baaf5839-2d8e-4825-9bdf-00959d
- webhook_delete: pass — args={"id":"da799279-d908-4e6a-a4b5-670b3b101a27"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[1.72,1.8,1.79],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":106
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":[],"result":{"name":"demo","removed":true,"releasedTriggers":[]}}
- workspace_purge: pass — args={"runId":"333a39fc-2441-4c10-93ce-c4ef0846378f"} observed={"runId":"333a39fc-2441-4c10-93ce-c4ef0846378f","status":"completed","result":{"purged":true}}
