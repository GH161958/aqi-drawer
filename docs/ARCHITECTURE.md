# Architecture

```text
iPhone / Share
      ↓
     Drop
      ↓
Source Adapter
      ↓
Pocket Store
      ↓
MCP / Drawer frontend
```

- Drop 统一接收伊伊主动分享的文字、链接和附件。
- 普通来源使用 generic reader 做安全、有界、按需的内容读取。
- 小红书使用专用 XHS adapter，解析深度内容并把全部图片保存到现有 persistent media storage。
- Pocket Store 是唯一正式数据源，负责身份、附件、状态、seen/unseen 与回复。
- MCP 保留 `pocket_*` 兼容工具名，对外提供读取、讨论和 reviewed-memory 边界。
- XHS item 通过 `provider + noteId` 长期去重；重复分享刷新来源数据并保留 Drawer 状态与回复。
