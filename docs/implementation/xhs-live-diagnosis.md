# XHS 真实网络诊断与本地 E2E（2026-11-01）

对应 #39 工单。从 main `4066ca5e15d01add221d554369e3a62da2da712c` 创建独立代码分支。没有操作 Tokyo、真实 Store/Media、两张现有收藏或生产配置。

## 本轮代码修复

确认的代码缺陷：适配器在完整重定向链返回之前才赋值 response。若已收到允许来源的 canonical 跳转、但下一个请求超时，原实现会丢失已批准目标地址及失败阶段，导致无法利用已解析 noteId 保留身份，也无法区分首跳、跳转、正文与解析失败。

最小修复：跟踪每次已通过原白名单检查的请求目标，错误保留最后批准地址、固定 stage 和 redirectCount；只向 API 暴露固定 stage，收藏 fallback 记录 errorStage。实际 API 回归证明：两个不同短别名若已明确跳向相同 noteId，即使后续超时也不会新建第二个物件。两个完全未解析的别名仍保留两个原件，不按标题合并；解析后发现两个现存身份冲突仍返回 409。

没有延长超时、改写域名、增加代理/Cookies/下载器、扩展白名单或改动 Store 发布机制。不能据此宣称东京出口问题已解决。

详情补充诚实说明：不同短链接未必能确认同一篇；无法读取时可以使用现有「打开来源」与「补充附件」手动保存自己提供的原图，没有新增隐式下载或假图片。

## 诊断工具

`tools/xhs-connection-diagnostic.mjs` 使用现有 XHS 适配器，另记录有界 DNS 与 TCP/TLS 探测，以及逐跳 HTTP headers/body 时长。仅允许原 XHS 来源和 CDN；只输出 host、status、阶段、耗时、跳转次数、安全错误分类、noteId 是否存在，不输出 URL/path/query、具体 noteId、HTML、Cookie 或图片。诊断不写 Store/Media。

```sh
# 在本机安全设置变量；不要把真实值写入仓库、脚本或共享终端日志。
node tools/xhs-connection-diagnostic.mjs
# 如允许首张图片只读探测，再设置 XHS_DIAG_IMAGES=true。
```

需要 `XHS_DIAG_URL`。无输入退出 2，解析/连接失败退出 1，完整允许范围成功退出 0。网络失败时会用固定 XHS 公共根站做连通性对照；对照也失败则为 environment_inconclusive，而非宣称小红书停机。

## 已执行的真实网络基线

- 本机公共根站：xhslink.cn DNS/TLS/HTTP 正常，307；主站 DNS/TLS/HTTP 正常，302。Node 与 curl 均有出站能力。
- 合成未知短链接：302 → 主站 200 → 正文完成，随后 XHS_PARSE_CHANGED；这是实际网络执行，不是 Mock，也不是有效真实笔记。
- 近几日公开引用的真实样本 A：DNS 172ms、TCP/TLS 167ms、短链接 302 309ms、主站 200 236ms、正文 34ms；931ms 完成解析，noteIdPresent=true；首图 CDN 200（headers 546ms/body 36ms）。CLI exit 0。无登录独立 Chromium 也返回 200，约 2554ms，存在笔记路径和 initial state。
- 另一真实公开样本 B：DNS/TLS、302→200、正文均完成，解析为 XHS_PARSE_CHANGED；HTTP 200 本身不等于成功提取。
- EE 本轮明确授权提供的新鲜链接：DNS 194ms、TCP/TLS 232ms、短链 302 234ms、主站 200 227ms、正文 153ms；1053ms 内解析成功，首图 CDN 200（70ms/3ms），CLI exit 0。无登录 Chromium 200，2042ms，笔记路径及 initial state 均存在。没有截图或持久化真实内容。
- 未修改 main 适配器的同链接对照也成功（解析 578ms，首图成功）：本机没有复现东京的超时，因此不能把本轮补充诊断宣称为已根治东京连接故障。链接本身在本轮本机测试时有效，可排除“此时该链接已全局失效”的说法，不能排除生产出口、时段或访问策略差异。
- 真实来源只临时经环境变量输入，代码与测试 fixture 没有实际 share URL 或笔记内容。未保存真实图片；首图只在内存校验。

## 本地执行回执

运行时 Node v24.17.0。npm ci --offline --ignore-scripts exit 0；最新 main 基线 npm run check exit 0。

- 相关定向测试：22 PASS、0 FAIL（新增 5 项诊断/API + 2 项别名/图片超时；原 15 项恢复测试保留）。覆盖首请求/跳转后/正文/图片超时、缺少 initial state、输出脱敏、阻断网络不确定性、两个失败短别名、后续恢复/409、无幽灵 Media、非 XHS 和既有成功内容回归。
- npm run check：exit 0，236 PASS、0 FAIL、1 SKIP；另 smoke/XHS/Vault 脚本通过。SKIP 为本机无 Poppler，Docker CI 强制 PDF E2E 单独验证。
- npm run frontend:check：exit 0；npm run frontend:build：exit 0；git diff --check、两个工具 node --check 通过。
- `tools/xhs-local-ui-e2e.mjs`：375×812 Chromium 实际点击 PASS。空临时 Store → 粘贴完整中文分享 → 保存失败 → 看到 XHS 待补全及原链接 → 打开详情点击重试 → 显示超时错误 → 再次点击恢复 → 返回真实 fixture 附件照片堆。同 ID、1 Item、1 附件、receivedCount=1、parse 3 次，独立读取附件字节与原 fixture 完全相同。SHA-256：70e1267bb1c69d0fd822aa771a36ac1e3409b326a44475bdd8a6d38074b3786b。
- UI 截图仅含合成内容，未提交个人截图。浏览器、回环服务已关闭，临时 Store 已删除。

本地 UI 复跑：先 `npm run build --workspace=frontend -- --base=/drawer-next/`，将 frontend/dist 复制到未跟踪的 react-dist；通过 XHS_PLAYWRIGHT_MODULE（本机 Playwright 模块）和可选 XHS_BROWSER_EXECUTABLE 指定独立浏览器，执行 `node tools/xhs-local-ui-e2e.mjs`。工具自动创建并清理临时 Store，只保留合成截图和脱敏 receipt。

## 审查与发布边界

已自查差异中的跳转 allowlist 校验顺序、错误脱敏、目标身份保留、CLI 有界性、无真实 URL 提交、UI 手动附件路径及无生产副作用。没有进行开放式架构改造。

公开样本成功不能证明 Tokyo 出口正常，也不能证明每一条新鲜笔记都可读。若需要定位生产出站问题，应由 EE 另行授权在同一出站环境运行脱敏诊断；不得直接修改环境、扩大网络访问或绕过访问限制。

本 PR 仅 Draft。禁止自动合并/发布。后续代码回滚可回到本轮基线；不回滚生产数据卷、不删除或合并两张真实收藏。物理 iPhone Safari 验收仍独立于本机 Chromium。
