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
- run_start: pass — args={"name":"demo"} observed={"runId":"bdfce551-9968-40ba-85e2-b76bb4dd8102","status":"running","result":{"runId":"bdfce551-9968-40ba-85e2-b76bb4dd8102"}}
- run_status: pass — args={"runId":"71819059-63ce-4ec0-b79b-7793ddceefda"} observed={"runId":"71819059-63ce-4ec0-b79b-7793ddceefda","status":"completed","result":{"runId":"71819059-63ce-4ec0-b79b-7793ddceefda","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"71819059-63ce-4ec0-b79b-7793ddceefda"} observed={"runId":"71819059-63ce-4ec0-b79b-7793ddceefda","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"84920d7b-7683-4429-baa6-f46f84f58c2b"} observed={"runId":"84920d7b-7683-4429-baa6-f46f84f58c2b","status":"suspended"}
- run_resume: pass — args={"runId":"a6beaa7b-fc25-4d6a-915d-c0a46f4b5e9d"} observed={"runId":"a6beaa7b-fc25-4d6a-915d-c0a46f4b5e9d","status":"running"}
- run_stop: pass — args={"runId":"55c06a60-88f8-4c4c-8e87-b2ddf2118a69"} observed={"runId":"55c06a60-88f8-4c4c-8e87-b2ddf2118a69","status":"stopped"}
- run_agent_log: pass — args={"runId":"fad316b4-ef29-4921-a160-1f9149132209","label":"greet"} observed={"runId":"fad316b4-ef29-4921-a160-1f9149132209","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"bdfce551-9968-40ba-85e2-b76bb4dd8102","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-04T14:44:50.281Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"71819059-63ce-4ec0-b79b-7793ddceefda","path":"output.txt"} observed={"runId":"71819059-63ce-4ec0-b79b-7793ddceefda","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"71819059-63ce-4ec0-b79b-7793ddceefda"} observed={"runId":"71819059-63ce-4ec0-b79b-7793ddceefda","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"71819059-63ce-4ec0-b79b-7793ddceefda","paths":["output.txt"]} observed={"runId":"71819059-63ce-4ec0-b79b-7793ddceefda","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"cron":"* * * * *"} observed={"result":{"kind":"cron","id":"82489dc3-355c-43a6-b741-9f98b6781d00","claimedBy":null,"cron":"* * * * *","enabled":true}}
- schedule_list: pass — args={} observed={"result":[{"id":"8b94d633-de7b-45b1-b6c5-ea8731d6a176","kind":"cron","workflow":"demo","claimedBy":"demo","enabled":true,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"i
- schedule_delete: pass — args={"id":"e4166b63-ba2a-47cf-90fe-ebaca43973d8"} observed={}
- schedule_setEnabled: pass — args={"id":"8b94d633-de7b-45b1-b6c5-ea8731d6a176","enabled":false} observed={}
- webhook_create: pass — args={} observed={"result":{"webhookId":"adb93e11-d038-434a-ab5e-932014f1a7cd","url":"http://127.0.0.1:42483/hooks/adb93e11-d038-434a-ab5e-932014f1a7cd","secret":"7bb5b386088e36a92fed248a7f1bc6738e33123b5634c8a7dc00b4
- webhook_list: pass — args={} observed={"result":[{"id":"ec73ea30-df99-4761-85b2-2f80eb338866","workflow":"demo","createdBy":null,"enabled":true,"secretFingerprint":"e91cb792e1080434","refusalCount":0},{"id":"adb93e11-d038-434a-ab5e-932014
- webhook_delete: pass — args={"id":"ec73ea30-df99-4761-85b2-2f80eb338866"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[0.64,0.56,0.63],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":96
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":["8b94d633-de7b-45b1-b6c5-ea8731d6a176"],"result":{"name":"demo","removed":true,"releasedTriggers":["8b94d633-de7b-45b1
- workspace_purge: pass — args={"runId":"71819059-63ce-4ec0-b79b-7793ddceefda"} observed={"runId":"71819059-63ce-4ec0-b79b-7793ddceefda","status":"completed","result":{"purged":true}}
