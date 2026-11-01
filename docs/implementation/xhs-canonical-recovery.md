# 用正式链接补全已有小红书收藏

对应 #41 工单；独立基线 main `4066ca5e15d01add221d554369e3a62da2da712c`。没有基于或合并 Draft #40，其诊断功能不包含在本 PR。没有操作 Tokyo、生产配置、真实 Store/Media 或 EE 两张收藏。

## 两阶段行为与来源身份

Inspect 中仅 XHS failed/partial 物件显示「用正式链接补全这张纸」，Incoming 和正常照片展示不变。

1. POST `/api/pocket/items/:id/xhs-canonical/preview`，只接收 canonicalUrl。通过实际 XhsAdapter 有界解析；无 Store/Media 写入、图片下载或接收事件。预览返回选中原 UUID/标题、来源标题、遮蔽 noteId、预计图片数量及随机 ticket，不返回正式 URL 或查询串。用户必须对照「请确认是同一篇笔记」。未知短链与正式地址是否语义上同一篇，系统无法自动证明，不能仅凭标题自动绑定。
2. POST `.../confirm`，只接收 ticket；用户明确点击后，向选定 UUID 的 Store 事务回填真实正文与下载图片。POST `.../cancel` 撤销尚未确认的预览。
3. 原 short URL 保留在 sourceData.originalUrl，原分享文字保留在 sourceData.sharedText。保留 EE 手工标题、备注、标签、分组、状态、回复、非 XHS 附件、已读状态和历史 activity；receivedCount/lastReceivedAt 不因补全改变，只记录 source_refreshed。
4. 两个未知短链仍是两个原物件。若 noteId 已属于另一 live 物件，预览或 Store 实际提交均返回 409，并给已鉴权 Owner 显示候选物件的标题/ID；不静默合并、覆盖、删除或生成第三个物件。选定物件已知身份不同或解析/跳转到另一 noteId 时也拒绝。

## URL、令牌与权限

- 仅 HTTPS、精确 www.xiaohongshu.com、标准 HTTPS 端口、无 userinfo/fragment；仅 explore/<24位十六进制ID> 与 discovery/item/<ID>。不接受短链、任意主机、编码路径、重复 query 键或注入参数。输入上限 8192 字符；查询参数只允许 xsec_token、xsec_source，其他追踪参数需先移除。该补全路径和后续正式地址重试还在每次请求前禁止 HTTPS 降级；旧抓取路径的默认协议行为不变。没有增加 adapter 的来源/CDN 白名单，也没有代理、Cookie 注入或登录绕过。
- 新输入正式 URL 及其查询令牌只在请求/短期预览内存中存在。ticket 为 32 字节随机能力凭证，放在 JSON body，绝不放客户端 URL、history 或 localStorage。前端不把包含正式链接的 mutation variables 放入 React Query；预览成功/取消/确认后清空输入。响应 no-store；错误采用固定安全文本/代码，损坏 JSON 也不反射输入令牌。
- API 继承现有 Owner Bearer/Drawer 会话/本机信任鉴权，并额外拒绝跨 Origin 请求。ticket 绑定实际通过鉴权的凭据哈希（已验证 Bearer 或具体会话 Cookie），不能用相同无效 Authorization 头把两个不同浏览器会话混成同一 owner。票据另绑定 UUID、URL hash 和包含 updatedAt/全部公开物件状态的版本 hash。
- 预览 TTL 2 分钟（单调时钟），最多 32 个 intent/完成标记，最多 8 个并行解析。同 owner/item/URL 的并行预览合并；相同 ticket 的并发确认共享任务，不重复下载；不同 ticket 对同物件同时确认返回 busy。失败 ticket 不重新取得写入资格，重启后失效。取消/过期/关闭服务清理引用和定时器。
- 确认本身最多约 30 秒且不超过预览剩余寿命，沿用 createMcpFileOperation 的取消/最终发布保护；忽略取消的迟到 Promise 不能发布。
- 确认后的 CDN 下载在 Store 单写者队列外完成，先写入独立临时 spool；进入队列前和最终发布时使用同一套 exact version、原 URL、存活/稳定来源身份与跨物件冲突校验。下载期间其他物件可正常写入；选中物件编辑或产生新身份冲突会拒绝最终发布并清理临时文件。Store 队列内仅进行本地附件落盘和原子 Store 发布，不等待 CDN。
- 成功后只保留有界内存完成标记；重复确认从当前 Store 读取回执，不重新下载，也不覆盖后来编辑；原物件后来删除则不能通过旧回执复活。
- 随机 ticket + owner auth 是应用能力授权与两阶段意图约束，不是密码学意义上的真人点击证明；没有声称模型绝对无法调用已授权 Owner API。

## 持久化与部分失败

明确确认后仅持久化 query-free 的 sourceData.recoveryUrl，同时清理新技术 URL 字段中的 xsec_token/xsec_source。新输入查询串不进入 sourceUrl/canonicalUrl、技术图片 URL、Activity 或回执。保存的图片是真实下载、MIME/签名验证后的 bytes；已有完成图片复用，部分图片失败明确为 partial，并保留已成功原件。

既有空 body 的 retry-source 合约不变：有经确认的 recoveryUrl 时，走它的无令牌正式路径，不再返回受阻短域名；原始 provenance 不变。若上游要求过期/缺失的令牌，可重新粘贴新正式链接，再预览/确认。不会承诺无令牌地址永久可读，也不把 token 永久保存来维持重试。

隐私范围有限：处理新输入正式链接及指定技术 URL 参数，不扫描或改写用户明确填写的正文，也不宣称识别任意哈希/加密/未知别名；不自动清洗已存在的原始 provenance 或用户文字。

## 本地实际执行结果

运行时 Node v24.17.0、npm 11.13.0。

| 命令 | 退出码 / 结果 |
| --- | --- |
| npm ci --offline --ignore-scripts | 0，195 packages，无新增依赖 |
| node --test server/xhs-canonical-recovery.test.js | 0，33 PASS |
| npm run check | 0，262 PASS、0 FAIL、1 SKIP；smoke/XHS/Vault 集成通过 |
| npm run frontend:check | 0，lint + TypeScript + Vite build |
| npm run frontend:build | 0 |
| git diff --check / node --check tools/xhs-canonical-ui-e2e.mjs | 0 |
| tools/xhs-canonical-ui-e2e.mjs（375px Chromium） | 0，实际 UI 点击 PASS |

本机缺少 Poppler，1 项原件 PDF E2E 跳过；Docker CI 强制真实 PDF E2E 独立覆盖。没有使用未跑测试或 CI 代替本地回执。

33 项 canonical 定向测试（与 retry 合计 48 项）覆盖：严格 URL/query 校验、只读预览、错笔记取消、同 UUID/所有 EE 元数据/Activity/原件哈希、另一未知短链不变、Owner/Origin/两 Cookie 会话绑定、损坏请求脱敏、TTL、容量、重复/并发、已有/旧 canonical 元数据与提交时新增冲突、备注/标签/状态编辑、排队版本过期、删除不复活、迟到预览/下载、下载中 intent TTL 失效、text-only、token/解析失败、允许跳转后超时、禁止 HTTP 降级、图片 MIME/签名、CDN 部分失败、重新确认/正式地址重试复用完成图片。

375×812 Chromium：在 UI 粘贴完整合成短链分享并保存为 failed；打开该 UUID，粘贴另一篇合成正式链接（含合成 xsec_token）→解析预览→取消（无写入/下载）；再预览正确笔记→明确确认→回到实际附件照片堆；再对另一未知短链尝试同 noteId，显示冲突及候选，另一物件完全不变。原单图案例保留两个原物件，不生成第三个；新增另一个独立的合成十八图物件，第一次明确确认保存 16 张、失败 2 张，界面显示 ready/failed/total；点击重新读取来源只再取缺失 2 张，最终同一 UUID 共 18 张。三个合成物件没有互相覆盖或合并，receivedCount 不变，输入令牌未落盘。独立读取 PNG 的 SHA-256：161b3987c8b8e30146206669f050167fdec1c6210c934fdb41b76bec97ce2139，与原 fixture 一致。

截图只有合成内容，浏览器和回环服务已关闭，临时 Store 已删除。不是物理 iPhone Safari 验收。

## 真实网络的独立边界

额外在本机对一条公开样本执行实际 adapter + 两阶段 service + 空临时 Store：解析后明确确认，1 张实际 CDN 图片下载并保存，独立读取与下载原 bytes 的哈希一致，sameItemId=true、1 Item、complete、新输入 token 未持久化；最终代码预览至确认全程约 3544ms。实际笔记、URL、noteId、token、图片均未打印或提交，临时 Store/Media 已删除，没有截图真实笔记。

这是真实公开 CDN 的本地 E2E，不是 EE 两张收藏的恢复，也不是证明 Tokyo 已能下载所述笔记的全部 18 张图片。Tokyo 端 CDN 连通性及真实物件实际补全仍需 EE/阿栖单独授权验收；本 PR 不声称修好了短域名出站。

## 复跑、自查与发布边界

本地 UI 工具需先以 `--base=/drawer-next/` 构建 frontend，将 dist 复制到未跟踪的 react-dist，再配置本机 XHS_PLAYWRIGHT_MODULE 和可选 XHS_BROWSER_EXECUTABLE，执行 `node tools/xhs-canonical-ui-e2e.mjs`。该工具只调用本机 fixture 服务、阻断浏览器外网请求，自动清理 Store，保留合成截图和 receipt。

差异自查重点：实际 Owner 凭据绑定、token 技术字段清理、缓存/定时器生命周期、Store 队列内版本/身份检查、下载取消和完成回执、无第三物件、#40 未被包含。没有更改 Incoming、Keep Controller/MCP 合约、长期文件保存架构或 Tokyo。

仅提交独立 Draft Code PR，不 merge/deploy。若将来获准发布，可回退本轮代码；不要回滚生产数据卷或自动合并/删除已有两张物件。历史重复物件整理和东京生产补全均是独立授权事项。


## #42 review follow-up：有界多图下载

历史事实：30 张、80 MiB 限制来自原始 XHS 实现（`6efefb8`），本轮没有把历史限制改成 18。过去 Railway 的五图成功不能证明 30 图可靠，正式地址解析到 18 个 URL 也不证明 Tokyo 已取得 18 张原件。

- 新增 `server/xhs-image-stage.js`：确认后才下载；全进程最多 **3 个正在工作的图片 loader**，不同恢复任务共享上限。单图最多 6 秒，下载阶段最多 24 秒，并在真实 30 秒授权预算中为发布预留至少约 1 秒（解析慢的 retry 会缩短下载阶段）。原 createMcpFileOperation 30 秒及 ticket 剩余寿命仍是最终写入上界。客户端等待 35 秒以留回执传输余量；断线不等于确定未保存，界面要求重新打开原物件核对。
- 最多 30 张；每张不超过 15 MiB，实际新下载总量不超过 80 MiB。检查 HTTPS/CDN 主机、MIME 与原件签名，再写独立临时磁盘 spool，不把全部图片 Buffer 留在内存。并发任务也不能各自额外启动三十张。忽略取消的注入 loader 保留并发名额直至真实结束，迟到结果不能写文件或重新取得授权；超时后保守停止继续排队，剩余图片如实标失败。
- 单图 HTTP/校验失败、单图或阶段超时，在总授权仍有效时发布已验证子集，标记 partial 与真实计数。全局授权先到期、selected version 改变、身份冲突或最终发布异常则不发布，清理 spool 与未引用附件。已被原子发布接受的文件不因之后 timeout 被删除。
- 后续重试仅访问已批准的 query-free canonical，复用本地完整、哈希一致的现存图片，只取缺失图片。保留原附件和 EE 元数据，不能伪装 complete。修正历史物件缺 originalUrl 时的 fallback，使用选中物件存储的原分享链接，不采用新输入带 token 的解析 URL。
- 375px 变化：此前仅泛称部分图片失败，现在直接显示“已保存 16 / 失败 2 / 共 18 张”；成功原件继续可见。确认连接中断时不再错误承诺原收藏未改变。

新增确定性证据（不是网络性能承诺）：1 / 18 / 30 张分别约 **7 / 37 / 76 ms**，峰值 loader **1 / 3 / 3**；独立读取每份原始附件，30th 存在。80 MiB 测试实际保存 5×15 MiB + 5 MiB，拒绝额外 1 MiB 和单张 16 MiB。慢图期间无关物件编辑无需等待 CDN；200ms 单图期限案例保留 16/18，随后只取缺失两张。另覆盖阶段期限、发布函数失败清理、下载期间编辑/新冲突、全局授权过期、并行任务共享三路、Owner 隔离与完成重放。

最终本地 `npm run check`：262 PASS / 0 FAIL / 1 SKIP，退出 0；`npm run frontend:check`（含 build）、`--base=/drawer-next/` UI build、375px 点击工具、git diff --check 与脚本 node --check 均退出 0。本机 SKIP 仍是缺 Poppler 的原件 PDF E2E，必须由新 SHA 的 Docker 两端口强制 E2E 补验。合成截图与 receipt 留在仓库外；临时 Store/浏览器/回环服务已清理。

本次仍不证明 Tokyo 的真实 18 图 CDN 全量下载能力；没有对真实 18 图执行生产写入。保持 #42 与 #40 Draft 独立，不 merge/deploy，不碰真实两张收藏。等待 EE 与阿栖验收。
