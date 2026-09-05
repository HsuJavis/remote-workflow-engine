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
- run_start: pass — args={"name":"demo"} observed={"runId":"a140c442-4460-4b04-8c03-c7943794dd83","status":"running","result":{"runId":"a140c442-4460-4b04-8c03-c7943794dd83"}}
- run_status: pass — args={"runId":"54e4eb3a-2b33-47a6-99a4-3cdc796bd4de"} observed={"runId":"54e4eb3a-2b33-47a6-99a4-3cdc796bd4de","status":"completed","result":{"runId":"54e4eb3a-2b33-47a6-99a4-3cdc796bd4de","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"54e4eb3a-2b33-47a6-99a4-3cdc796bd4de"} observed={"runId":"54e4eb3a-2b33-47a6-99a4-3cdc796bd4de","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"55e37bd2-81ec-4c6c-8112-322a71a12e19"} observed={"runId":"55e37bd2-81ec-4c6c-8112-322a71a12e19","status":"suspended"}
- run_resume: pass — args={"runId":"8a6070d6-dc0e-474f-8653-c4bc4416fd12"} observed={"runId":"8a6070d6-dc0e-474f-8653-c4bc4416fd12","status":"running"}
- run_stop: pass — args={"runId":"ed7b34d0-ee22-4064-9217-86446967d179"} observed={"runId":"ed7b34d0-ee22-4064-9217-86446967d179","status":"stopped"}
- run_agent_log: pass — args={"runId":"0fad0579-af6d-4f40-80ee-aee9d279dc37","label":"greet"} observed={"runId":"0fad0579-af6d-4f40-80ee-aee9d279dc37","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"a140c442-4460-4b04-8c03-c7943794dd83","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-05T13:24:24.532Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"54e4eb3a-2b33-47a6-99a4-3cdc796bd4de","path":"output.txt"} observed={"runId":"54e4eb3a-2b33-47a6-99a4-3cdc796bd4de","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"54e4eb3a-2b33-47a6-99a4-3cdc796bd4de"} observed={"runId":"54e4eb3a-2b33-47a6-99a4-3cdc796bd4de","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"54e4eb3a-2b33-47a6-99a4-3cdc796bd4de","paths":["output.txt"]} observed={"runId":"54e4eb3a-2b33-47a6-99a4-3cdc796bd4de","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"cron":"* * * * *"} observed={"result":{"kind":"cron","id":"e573b4ff-77f9-4ba3-b394-6c75c5f5dfc6","claimedBy":null,"cron":"* * * * *","enabled":true}}
- schedule_list: pass — args={} observed={"result":[{"id":"25847714-b741-4960-9e1a-56bc547c0ae9","kind":"cron","claimedBy":"demo","enabled":true,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"id":"6eae6462-ddb1-
- schedule_delete: pass — args={"id":"6eae6462-ddb1-4b5b-bd4f-ded43519bcdc"} observed={}
- schedule_setEnabled: pass — args={"id":"25847714-b741-4960-9e1a-56bc547c0ae9","enabled":false} observed={}
- webhook_create: pass — args={} observed={"result":{"webhookId":"97232b1b-682e-4e17-bbca-6c770872f03f","url":"http://127.0.0.1:42777/hooks/97232b1b-682e-4e17-bbca-6c770872f03f","secret":"9d0eba28c7487e741912f6cfdf1d53aacdc435abf9fa550a8c00a7
- webhook_list: pass — args={} observed={"result":[{"id":"73830a17-b187-4e36-adbf-62ccb945369b","workflow":"demo","createdBy":null,"enabled":true,"secretFingerprint":"747c70dd842e5297","refusalCount":0},{"id":"97232b1b-682e-4e17-bbca-6c7708
- webhook_delete: pass — args={"id":"73830a17-b187-4e36-adbf-62ccb945369b"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[1.17,1.19,0.8],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":972
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":["25847714-b741-4960-9e1a-56bc547c0ae9","73830a17-b187-4e36-adbf-62ccb945369b"],"result":{"name":"demo","removed":true,
- workspace_purge: pass — args={"runId":"54e4eb3a-2b33-47a6-99a4-3cdc796bd4de"} observed={"runId":"54e4eb3a-2b33-47a6-99a4-3cdc796bd4de","status":"completed","result":{"purged":true}}
