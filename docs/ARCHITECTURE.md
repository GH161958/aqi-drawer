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
- 小红书未来使用专用 XHS adapter，解析深度内容并保存全部图片。
- Pocket Store 是唯一正式数据源，负责身份、附件、状态、seen/unseen 与回复。
- MCP 保留 `pocket_*` 兼容工具名，对外提供读取、讨论和 reviewed-memory 边界。
