# v24 tool surface — REQ-118

rows: 35/35

- issue_report: unverified — args={"title":"x","body":"y"} observed="UNVERIFIED(no GitHub token)"
- issue_get: unverified — args={"number":1} observed="UNVERIFIED(no GitHub token)"
- issue_list: unverified — args={} observed="UNVERIFIED(no GitHub token)"
- issue_get_comments: unverified — args={"number":1} observed="UNVERIFIED(no GitHub token)"
- issue_comment_post: unverified — args={"number":1,"body":"hi"} observed="UNVERIFIED(no GitHub token)"
- workflow_register: fail — args={"name":"demo","script":"workflow(async () => {})","mermaid":"graph TD;\nA-->B;"} observed={"runId":"","status":"failed","code":"MERMAID_INVALID","error":{"code":"MERMAID_INVALID","message":"MERMAID_INVALID: UNDECLARED_NODE (line 2)"}}
- workflow_publish: fail — args={"name":"demo","version":"v1"} observed={"runId":"","status":"failed","code":"CatalogNotFoundError","error":{"code":"CatalogNotFoundError","message":"Workflow not found in catalog: demo"}}
- workflow_describe: fail — args={"name":"demo"} observed={"runId":"","status":"failed","code":"WORKFLOW_NOT_FOUND","error":{"code":"WORKFLOW_NOT_FOUND","message":"Unknown workflow: demo"}}
- workflow_source: fail — args={"name":"demo"} observed={"runId":"","status":"failed","code":"WORKFLOW_NOT_FOUND","error":{"code":"WORKFLOW_NOT_FOUND","message":"Unknown workflow: demo"}}
- workflow_list: pass — args={} observed={"runId":"","status":"completed","result":[]}
- workflow_authoring_guide: pass — args={} observed={"runId":"","status":"completed","result":{"text":"Authoring rules: declare every agent() call with a LITERAL string label; declare params.agents.<label> for each label found in the script (model/effo
- run_start: fail — args={"name":"demo"} observed={"runId":"","status":"failed","error":{"code":"UNKNOWN_WORKFLOW","message":"Unknown workflow: demo","field":"name"}}
- run_status: fail — args={"runId":"r1"} observed={"runId":"r1","status":"failed","error":{"code":"RUN_NOT_FOUND","message":"Run not found: r1"}}
- run_result: fail — args={"runId":"r1"} observed={"runId":"r1","status":"failed","error":{"code":"RUN_NOT_FOUND","message":"Run not found: r1"}}
- run_suspend: fail — args={"runId":"r1"} observed={"runId":"r1","status":"failed","error":{"code":"RUN_NOT_FOUND","message":"Run not found: r1"}}
- run_resume: fail — args={"runId":"r1"} observed={"runId":"r1","status":"failed","error":{"code":"RUN_NOT_FOUND","message":"Run not found: r1"}}
- run_stop: fail — args={"runId":"r1"} observed={"runId":"r1","status":"failed","error":{"code":"RUN_NOT_FOUND","message":"Run not found: r1"}}
- run_agent_log: fail — args={"runId":"r1","label":"main"} observed={"runId":"r1","status":"failed","error":{"code":"RUN_NOT_FOUND","message":"Run not found: r1"},"harness":null,"events":[],"hasMore":false}
- run_list: pass — args={} observed={"runId":"","status":"completed","result":[]}
- workspace_diff: pass — args={"manifest":[]} observed={"runId":"","status":"completed","result":{"missing":[]}}
- workspace_push: fail — args={"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","contentB64":"AAAA"} observed={"runId":"","status":"failed","code":"BLOB_HASH_MISMATCH","error":{"code":"BLOB_HASH_MISMATCH","message":"declared sha256 aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa != computed 7
- workspace_pull: fail — args={"runId":"r1","path":"output.txt"} observed={"runId":"r1","status":"failed","error":{"code":"RUN_NOT_FOUND","message":"Run not found: r1"}}
- workspace_list: fail — args={"runId":"r1"} observed={"runId":"r1","status":"failed","error":{"code":"RUN_NOT_FOUND","message":"Run not found: r1"}}
- workspace_delete: fail — args={"runId":"r1","paths":["a.txt"]} observed={"runId":"r1","status":"failed","code":"RUN_NOT_FOUND","error":{"code":"RUN_NOT_FOUND","message":"Run not found: r1"}}
- schedule_create: fail — args={"workflow":"demo","cron":"* * * * *"} observed={"error":{"code":"WORKFLOW_NOT_FOUND","message":"Unknown workflow: demo","field":"workflow"}}
- schedule_list: pass — args={} observed={"result":[]}
- schedule_delete: fail — args={"id":"s1"} observed={"error":{"code":"SCHEDULE_NOT_FOUND","message":"Unknown schedule: s1"}}
- schedule_setEnabled: fail — args={"id":"s1","enabled":false} observed={"error":{"code":"SCHEDULE_NOT_FOUND","message":"Unknown schedule: s1"}}
- webhook_create: fail — args={"workflow":"demo"} observed={"error":{"code":"WORKFLOW_NOT_FOUND","message":"Unknown workflow: demo"}}
- webhook_list: pass — args={} observed={"result":[]}
- webhook_delete: pass — args={"id":"w1"} observed={"result":{"deleted":false}}
- models_list: pass — args={} observed={"result":[{"provider":"anthropic","model":"claude-opus-4-8","description":"Claude Opus 4.8 — most capable Opus-tier model","modalities":{"in":["text","image"],"out":["text"]},"contextWindow":1000000,
- system_info: pass — args={} observed={"status":"ok","result":{"cpu":{"cores":16,"loadAvg":[1.92,1.56,1.34],"utilizationPct":null,"utilizationDegraded":{"reason":"awaiting-second-sample"}},"memory":{"totalBytes":32513794048,"usedBytes":10
- workflow_deregister: pass — args={"name":"demo"} observed={"runId":"","status":"completed","name":"demo","removed":false,"releasedTriggers":[],"result":{"name":"demo","removed":false,"releasedTriggers":[]}}
- workspace_purge: fail — args={"runId":"r1"} observed={"runId":"r1","status":"failed","error":{"code":"RUN_NOT_FOUND","message":"Run not found: r1"}}
