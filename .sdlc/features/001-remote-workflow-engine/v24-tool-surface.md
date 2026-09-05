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
- run_start: pass — args={"name":"demo"} observed={"runId":"76a3ccaf-6be3-4b2e-9f21-307d66f504fc","status":"running","result":{"runId":"76a3ccaf-6be3-4b2e-9f21-307d66f504fc"}}
- run_status: pass — args={"runId":"da165976-1334-424a-a9f3-fdad55b823ce"} observed={"runId":"da165976-1334-424a-a9f3-fdad55b823ce","status":"completed","result":{"runId":"da165976-1334-424a-a9f3-fdad55b823ce","status":"completed","scriptVersion":"v1","phases":[],"agents":[],"workflo
- run_result: pass — args={"runId":"da165976-1334-424a-a9f3-fdad55b823ce"} observed={"runId":"da165976-1334-424a-a9f3-fdad55b823ce","status":"completed","result":"ok"}
- run_suspend: pass — args={"runId":"03b5b953-4010-4301-ab44-83b2acabfc01"} observed={"runId":"03b5b953-4010-4301-ab44-83b2acabfc01","status":"suspended"}
- run_resume: pass — args={"runId":"5bbef43b-0165-41a7-a8ff-e908c22b3dc3"} observed={"runId":"5bbef43b-0165-41a7-a8ff-e908c22b3dc3","status":"running"}
- run_stop: pass — args={"runId":"3d7f6d7c-9497-40a1-8dad-78e64366c264"} observed={"runId":"3d7f6d7c-9497-40a1-8dad-78e64366c264","status":"stopped"}
- run_agent_log: pass — args={"runId":"f6f2c7dd-aa9d-45b4-9d4e-cbb9e4d36557","label":"greet"} observed={"runId":"f6f2c7dd-aa9d-45b4-9d4e-cbb9e4d36557","status":"running","harness":{"model":"default","provider":"ollama","prompt":"Say hello","tools":[],"skills":[],"mcpServers":[],"surfaceType":"none","ef
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[{"runId":"76a3ccaf-6be3-4b2e-9f21-307d66f504fc","name":"demo","status":"running","scriptVersion":"v1","createdAt":"2026-09-05T04:38:18.637Z","startedBy":{"ty
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: pass — args={"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","contentB64":"AAAA"} observed={"runId":"","status":"completed","result":{"sha256":"709e80c88487a2411e1ee4dfb9f22a861492d20c4765150c0c794abd70f8147c","accepted":true}}
- workspace_pull: pass — args={"runId":"da165976-1334-424a-a9f3-fdad55b823ce","path":"output.txt"} observed={"runId":"da165976-1334-424a-a9f3-fdad55b823ce","status":"completed","result":{"path":"output.txt","size":20,"offset":0,"length":20,"eof":true,"base64":"aGVsbG8gZnJvbSB0aGUgc2VlZAo="}}
- workspace_list: pass — args={"runId":"da165976-1334-424a-a9f3-fdad55b823ce"} observed={"runId":"da165976-1334-424a-a9f3-fdad55b823ce","status":"completed","result":[{"path":"output.txt","size":20,"sha256":"fa6c80668a51c6185a4fd55871ec209e37a570a1bae039ded4e8c2995b358d4a"}]}
- workspace_delete: pass — args={"runId":"da165976-1334-424a-a9f3-fdad55b823ce","paths":["output.txt"]} observed={"runId":"da165976-1334-424a-a9f3-fdad55b823ce","status":"completed","result":{"deleted":["output.txt"],"missing":[],"rejected":[]}}
- schedule_create: pass — args={"cron":"* * * * *"} observed={"result":{"kind":"cron","id":"553c7e23-0889-4005-83f5-78cb8cb6d452","claimedBy":null,"cron":"* * * * *","enabled":true}}
- schedule_list: pass — args={} observed={"result":[{"id":"fbde5ae2-f875-46c9-a4b7-0315f870b73c","kind":"cron","claimedBy":"demo","enabled":true,"cron":"0 0 1 1 *","nextFire":"2027-01-01T00:00:00.000Z","refusalCount":0},{"id":"16daf4cd-b69e-
- schedule_delete: pass — args={"id":"16daf4cd-b69e-47b5-8678-886266e55e68"} observed={}
- schedule_setEnabled: pass — args={"id":"fbde5ae2-f875-46c9-a4b7-0315f870b73c","enabled":false} observed={}
- webhook_create: pass — args={} observed={"result":{"webhookId":"f0197208-d749-4c44-afad-e25d109f2828","url":"http://127.0.0.1:43597/hooks/f0197208-d749-4c44-afad-e25d109f2828","secret":"30aa796f35830538b0760024a024793b185eccec5287f063774efd
- webhook_list: pass — args={} observed={"result":[{"id":"80fff896-d850-4b98-9775-5be71feeaccb","workflow":"demo","createdBy":null,"enabled":true,"secretFingerprint":"16006d9b0b05a95c","refusalCount":0},{"id":"f0197208-d749-4c44-afad-e25d10
- webhook_delete: pass — args={"id":"80fff896-d850-4b98-9775-5be71feeaccb"} observed={"result":{"deleted":true}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[0.76,0.82,1.11],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":95
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":true,"releasedTriggers":["fbde5ae2-f875-46c9-a4b7-0315f870b73c","80fff896-d850-4b98-9775-5be71feeaccb"],"result":{"name":"demo","removed":true,
- workspace_purge: pass — args={"runId":"da165976-1334-424a-a9f3-fdad55b823ce"} observed={"runId":"da165976-1334-424a-a9f3-fdad55b823ce","status":"completed","result":{"purged":true}}
