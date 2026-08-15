# XHS adapter specification

`~/aqi-xhs` 是已实测 reference implementation。稳定逻辑已迁入 `aqi-drawer` 的自包含 adapter，生产环境不 import 或依赖 reference 项目。

- 从完整分享文字中提取小红书链接；
- 支持 `xhslink.cn`；
- 读取并清洗 `window.__INITIAL_STATE__`；
- 提取完整正文；
- 抓取并本地保存全部图片；
- 提取公开首屏 comments 与 replies；
- 使用 `noteId` 作为长期来源身份；
- 重复分享刷新正文、评论与互动数据；
- 已完整保存的图片不重复下载；
- 缺失、损坏或此前失败的图片在后续分享时补抓。

## Drawer integration

- Drop 自动识别完整分享文字、短链与正式 note URL。
- 成功解析的数据写入现有 item 的 `sourceIdentity` 与 `sourceData`。
- `sourceIdentity` 使用 `xiaohongshu + noteId`，Pocket UUID 保持独立。
- 图片进入现有 `data/media` attachment system；完整文件复用，缺失、失败和新增图片增量抓取。
- `pocket_get` 暴露结构化来源数据与附件。
- `pocket_read_content` 优先读取持久化 XHS snapshot 和本地图片，不要求客户端访问 XHS CDN。
- 解析或单图下载失败会保存 partial/failed item，不阻断 Drop。

这里只抓公开页面携带的首屏 comments 及其已有 subComments，不声称覆盖全部评论。
