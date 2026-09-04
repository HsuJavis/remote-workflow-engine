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
- run_start: pass — args={"name":"demo"} observed={"runId":"70a43aca-25a9-483b-ab74-48075387a9ac","status":"running","result":{"runId":"70a43aca-25a9-483b-ab74-48075387a9ac"}}
- run_status: pass — args={"runId":"1349f884-ec24-491f-a4da-ab9039e60606"} observed={"runId":"1349f884-ec24-491f-a4da-ab9039e60606","status":"completed","result":{"runId":"1349f884-ec24-491f-a4da-ab9039e60606","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"1349f884-ec24-491f-a4da-ab9039e60606"} observed={"runId":"1349f884-ec24-491f-a4da-ab9039e60606","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"e9c1c15e-9a27-482a-839f-88fc42645083"} observed={"runId":"e9c1c15e-9a27-482a-839f-88fc42645083","status":"suspended"}
- run_resume: pass — args={"runId":"aa99ed1a-36f5-4da7-a711-4855e64d9430"} observed={"runId":"aa99ed1a-36f5-4da7-a711-4855e64d9430","status":"running"}
- run_stop: pass — args={"runId":"77fd008e-5f4c-46e6-b560-076ed8a5230c"} observed={"runId":"77fd008e-5f4c-46e6-b560-076ed8a5230c","status":"stopped"}
- run_agent_log: pass — args={"runId":"9297d2a7-a2ca-4638-a2c7-14f10c62c021","label":"greet"} observed={"runId":"9297d2a7-a2ca-4638-a2c7-14f10c62c021","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"70a43aca-25a9-483b-ab74-48075387a9ac","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-04T22:47:21.652Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"1349f884-ec24-491f-a4da-ab9039e60606","path":"output.txt"} observed={"runId":"1349f884-ec24-491f-a4da-ab9039e60606","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"1349f884-ec24-491f-a4da-ab9039e60606"} observed={"runId":"1349f884-ec24-491f-a4da-ab9039e60606","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"1349f884-ec24-491f-a4da-ab9039e60606","paths":["output.txt"]} observed={"runId":"1349f884-ec24-491f-a4da-ab9039e60606","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"cron":"* * * * *"} observed={"result":{"kind":"cron","id":"f5bd4383-d9e3-4355-9b34-be4e02f86842","claimedBy":null,"cron":"* * * * *","enabled":true}}
- schedule_list: pass — args={} observed={"result":[{"id":"e5a56b3a-9590-4033-89c4-17e06878e2ed","kind":"cron","workflow":"demo","claimedBy":"demo","enabled":true,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"i
- schedule_delete: pass — args={"id":"ec25df0c-f508-4d21-b7d9-2f478a75ffbf"} observed={}
- schedule_setEnabled: pass — args={"id":"e5a56b3a-9590-4033-89c4-17e06878e2ed","enabled":false} observed={}
- webhook_create: pass — args={} observed={"result":{"webhookId":"7610750e-0e1e-4efd-93bd-0342c0c2203f","url":"http://127.0.0.1:38973/hooks/7610750e-0e1e-4efd-93bd-0342c0c2203f","secret":"95a9f69cf911cac3cccab94a7ca68187a775ab3fe57c651541b4a8
- webhook_list: pass — args={} observed={"result":[{"id":"09c83e39-bd0d-4247-81a2-db918fe177a8","workflow":"demo","createdBy":null,"enabled":true,"secretFingerprint":"443066401d2fcba0","refusalCount":0},{"id":"7610750e-0e1e-4efd-93bd-0342c0
- webhook_delete: pass — args={"id":"09c83e39-bd0d-4247-81a2-db918fe177a8"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[0.86,1.22,1.08],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":97
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":["e5a56b3a-9590-4033-89c4-17e06878e2ed"],"result":{"name":"demo","removed":true,"releasedTriggers":["e5a56b3a-9590-4033
- workspace_purge: pass — args={"runId":"1349f884-ec24-491f-a4da-ab9039e60606"} observed={"runId":"1349f884-ec24-491f-a4da-ab9039e60606","status":"completed","result":{"purged":true}}
