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
- run_start: pass — args={"name":"demo"} observed={"runId":"46d1f06f-1d3b-4fe7-85bb-cd2903bef1ac","status":"running","result":{"runId":"46d1f06f-1d3b-4fe7-85bb-cd2903bef1ac"}}
- run_status: pass — args={"runId":"6c400a2d-87d3-4ccb-bca0-34f5538e962b"} observed={"runId":"6c400a2d-87d3-4ccb-bca0-34f5538e962b","status":"completed","result":{"runId":"6c400a2d-87d3-4ccb-bca0-34f5538e962b","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"6c400a2d-87d3-4ccb-bca0-34f5538e962b"} observed={"runId":"6c400a2d-87d3-4ccb-bca0-34f5538e962b","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"20dce0de-9ae0-45ed-9a71-438c7bc40ebd"} observed={"runId":"20dce0de-9ae0-45ed-9a71-438c7bc40ebd","status":"suspended"}
- run_resume: pass — args={"runId":"ceb1876b-6e8c-4da9-957e-ec7f947720eb"} observed={"runId":"ceb1876b-6e8c-4da9-957e-ec7f947720eb","status":"running"}
- run_stop: pass — args={"runId":"5052ad77-f2bd-4a56-ae1c-cbfa5030bc88"} observed={"runId":"5052ad77-f2bd-4a56-ae1c-cbfa5030bc88","status":"stopped"}
- run_agent_log: pass — args={"runId":"a9e2f635-255f-43f0-bf1d-9731f2d09152","label":"greet"} observed={"runId":"a9e2f635-255f-43f0-bf1d-9731f2d09152","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"46d1f06f-1d3b-4fe7-85bb-cd2903bef1ac","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-05T04:27:24.060Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"6c400a2d-87d3-4ccb-bca0-34f5538e962b","path":"output.txt"} observed={"runId":"6c400a2d-87d3-4ccb-bca0-34f5538e962b","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"6c400a2d-87d3-4ccb-bca0-34f5538e962b"} observed={"runId":"6c400a2d-87d3-4ccb-bca0-34f5538e962b","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"6c400a2d-87d3-4ccb-bca0-34f5538e962b","paths":["output.txt"]} observed={"runId":"6c400a2d-87d3-4ccb-bca0-34f5538e962b","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"cron":"* * * * *"} observed={"result":{"kind":"cron","id":"90d0e4b7-b3ca-4ae8-b42c-b33bc38765f9","claimedBy":null,"cron":"* * * * *","enabled":true}}
- schedule_list: pass — args={} observed={"result":[{"id":"833b04e4-02c9-46bd-a32d-339e9d6e3909","kind":"cron","claimedBy":"demo","enabled":true,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"id":"7a34a40e-ac6c-
- schedule_delete: pass — args={"id":"7a34a40e-ac6c-462a-b5a4-add259f8f6b6"} observed={}
- schedule_setEnabled: pass — args={"id":"833b04e4-02c9-46bd-a32d-339e9d6e3909","enabled":false} observed={}
- webhook_create: pass — args={} observed={"result":{"webhookId":"e5c4502e-22d6-44b7-a5bd-6e9bf7456041","url":"http://127.0.0.1:44653/hooks/e5c4502e-22d6-44b7-a5bd-6e9bf7456041","secret":"3ca02f4fbfc6b627e05d182e701fb2deab8c34e3463d1b0f47728f
- webhook_list: pass — args={} observed={"result":[{"id":"509809a1-993e-48f7-8a6f-7f5f34a3d439","workflow":"demo","createdBy":null,"enabled":true,"secretFingerprint":"7cdab9909c27d09e","refusalCount":0},{"id":"e5c4502e-22d6-44b7-a5bd-6e9bf7
- webhook_delete: pass — args={"id":"509809a1-993e-48f7-8a6f-7f5f34a3d439"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[1.21,0.92,1.29],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":95
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":["833b04e4-02c9-46bd-a32d-339e9d6e3909","509809a1-993e-48f7-8a6f-7f5f34a3d439"],"result":{"name":"demo","removed":true,
- workspace_purge: pass — args={"runId":"6c400a2d-87d3-4ccb-bca0-34f5538e962b"} observed={"runId":"6c400a2d-87d3-4ccb-bca0-34f5538e962b","status":"completed","result":{"purged":true}}
