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
- run_start: pass — args={"name":"demo"} observed={"runId":"98c929ac-dc6e-4261-b72b-533fb5473cdf","status":"running","result":{"runId":"98c929ac-dc6e-4261-b72b-533fb5473cdf"}}
- run_status: pass — args={"runId":"f7f8a8e7-1774-454d-894b-ee7241282d37"} observed={"runId":"f7f8a8e7-1774-454d-894b-ee7241282d37","status":"completed","result":{"runId":"f7f8a8e7-1774-454d-894b-ee7241282d37","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"f7f8a8e7-1774-454d-894b-ee7241282d37"} observed={"runId":"f7f8a8e7-1774-454d-894b-ee7241282d37","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"7ed30a8a-07a1-443c-8d17-4ff4dea4c441"} observed={"runId":"7ed30a8a-07a1-443c-8d17-4ff4dea4c441","status":"suspended"}
- run_resume: pass — args={"runId":"2c3485c3-e782-4320-8b77-29a0be10ecee"} observed={"runId":"2c3485c3-e782-4320-8b77-29a0be10ecee","status":"running"}
- run_stop: pass — args={"runId":"85e37eae-5b3d-49c3-ac93-4031d785ff33"} observed={"runId":"85e37eae-5b3d-49c3-ac93-4031d785ff33","status":"stopped"}
- run_agent_log: pass — args={"runId":"2df0a759-0d5c-4eae-a02a-e2c64fc2d398","label":"greet"} observed={"runId":"2df0a759-0d5c-4eae-a02a-e2c64fc2d398","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"98c929ac-dc6e-4261-b72b-533fb5473cdf","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-04T14:52:24.768Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"f7f8a8e7-1774-454d-894b-ee7241282d37","path":"output.txt"} observed={"runId":"f7f8a8e7-1774-454d-894b-ee7241282d37","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"f7f8a8e7-1774-454d-894b-ee7241282d37"} observed={"runId":"f7f8a8e7-1774-454d-894b-ee7241282d37","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"f7f8a8e7-1774-454d-894b-ee7241282d37","paths":["output.txt"]} observed={"runId":"f7f8a8e7-1774-454d-894b-ee7241282d37","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"cron":"* * * * *"} observed={"result":{"kind":"cron","id":"a3f27cf3-b840-40fb-91a2-ef7122c3a7a8","claimedBy":null,"cron":"* * * * *","enabled":true}}
- schedule_list: pass — args={} observed={"result":[{"id":"945c3554-a2ed-49f0-bdd3-66e14fd92fd0","kind":"cron","workflow":"demo","claimedBy":"demo","enabled":true,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"i
- schedule_delete: pass — args={"id":"c9c8d0da-9777-4dfd-9cca-f88f2675e760"} observed={}
- schedule_setEnabled: pass — args={"id":"945c3554-a2ed-49f0-bdd3-66e14fd92fd0","enabled":false} observed={}
- webhook_create: pass — args={} observed={"result":{"webhookId":"8a06c51c-d183-4e7e-9dfb-d3ad5c87b379","url":"http://127.0.0.1:33357/hooks/8a06c51c-d183-4e7e-9dfb-d3ad5c87b379","secret":"ef334a68f7ab8ac8e4e2446b7fe4014e36657406dfa7b3f0a46f9b
- webhook_list: pass — args={} observed={"result":[{"id":"9b0340b0-c0fe-4755-b09a-cadb25f13223","workflow":"demo","createdBy":null,"enabled":true,"secretFingerprint":"44777d5199c4213d","refusalCount":0},{"id":"8a06c51c-d183-4e7e-9dfb-d3ad5c
- webhook_delete: pass — args={"id":"9b0340b0-c0fe-4755-b09a-cadb25f13223"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[1.11,1.24,1],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":96723
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":["945c3554-a2ed-49f0-bdd3-66e14fd92fd0"],"result":{"name":"demo","removed":true,"releasedTriggers":["945c3554-a2ed-49f0
- workspace_purge: pass — args={"runId":"f7f8a8e7-1774-454d-894b-ee7241282d37"} observed={"runId":"f7f8a8e7-1774-454d-894b-ee7241282d37","status":"completed","result":{"purged":true}}
