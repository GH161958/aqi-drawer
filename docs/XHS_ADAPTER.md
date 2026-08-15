# XHS adapter specification

`~/aqi-xhs` 已实测通过以下行为；它是 reference implementation，本文件暂不迁移代码：

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

正式实现必须进入 Aqi Drawer 的 Store 与附件体系，不建立第二套 Inbox。
