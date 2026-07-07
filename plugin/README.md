# 客戶端 plugin 已移至獨立 repo

Remote Workflow Engine 的 Claude Code 客戶端 plugin(MCP 連線 + 指導 skill,
原 REQ-010 / ARCH-013 / TASK-022 的交付物)已拆分為獨立發佈物:

**https://github.com/HsuJavis/remote-workflow-plugin**

安裝(user scope):
```
/plugin marketplace add HsuJavis/remote-workflow-plugin
/plugin install remote-workflow@remote-workflow-plugin
```

拆分原因:引擎(伺服器端程式)與客戶端 plugin 是不同的發佈物與生命週期,分開維護。
