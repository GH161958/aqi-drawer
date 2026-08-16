# Aqi Drawer Project Status

Last reviewed: 2026-08-17

## CURRENT FOCUS

### Mobile usability and note loop

Production 已验证 browser login、iPhone Shortcut、Tags 与 Collection 刷新持久化。本轮完成移动端 paper scroll、EE Note 手动 CRUD、Aqi reply 持久化收起，以及 item-level「移出分类」文案。

## VERIFIED DONE

### Backend foundation

- Pocket / Drawer 的 Store、REST、MCP 基础可工作
- attachments foundation
- XHS parser / `sourceData` foundation
- replies
- `read-content`
- status workflow

### Workflow Status

- 六个位置已建立：刚放进来、今晚看看、聊过了、晚点再看、想留住、收好了
- Viewing != moving；open/read 不自动移动到 discussed
- `memory_candidate` 是显式动作
- Put Back 不自动改变 status

### Home Cabinet

- mobile cabinet 已成为手机端第一视觉主体，家具感基本成立
- **FREEZE MAJOR CABINET REDESIGN**：后续只做必要的小幅 refinement

### Content foundations

- 真实 `item.note` 可显示
- 真实 replies 可显示
- Generic Link `read-content` 已接入并与 XHS renderer 分离
- XHS 已有独立 `sourceData` / images foundation
- 本地 `design-fonts/` candidate folder 已建立并被 gitignore

### Browser API and organization chain

- 前端 Pocket 请求统一生成 same-origin `/api/pocket/...`，并有静态回归测试禁止 production bundle 指向 localhost
- production browser 使用独立 Drawer secret 换取签名 HttpOnly、SameSite session cookie；Bridge token 不进入前端
- Cookie 写请求要求同源 Origin；未经授权的远程 browser 被拒绝
- 既有 Bridge Bearer 与 MCP 保护保持独立
- Collection / Tags 已通过 REST 保存、重新 GET 持久化与 MCP 一致性测试；`Ombre` 与测试 Collection 均通过

### Verified production

- Railway `/drawer` browser login 可用
- iPhone Share Sheet Shortcut `/drop/<secret>` 可用
- Tags 保存后刷新仍存在
- Collection 保存后刷新仍存在

### Completed in final pass

- Closed Cabinet 在 mobile viewport 内固定，不产生无意义页面拖动；Inspect 锁住背景
- 长 Record / EE Note / Aqi Note 使用前景纸内部滚动，sticky「放回」始终可达
- EE Note 可在 Drawer 内新增、编辑、明确移除并持久化
- Aqi reply 可持久化收起；正常 Side Note stack 不再渲染，既有 Activity 保留
- Collection item-level 清除动作改称「移出分类」，nullable Collection 语义不变

## IMPLEMENTED / NEEDS VERIFICATION

### Production / Railway rollout

- Railway Volume 已挂载；仍需在今后部署后持续观察 item/media 持久化

### Activity Ledger

Living Record UI 已出现，仍需确认真实事件：

- `received`
- `seen_by_aqi`
- `content_read`
- `reply_added`
- `status_changed`
- `metadata_changed`
- list/get/render 不制造 history

### XHS Photo Packet

已有独立 renderer 与基础照片包结构；storage / Inspect 视觉仍需真实数据验收与继续细化。

### Core-loop features not included in this pass

- Drawer SELF DROP 尚未实现
- EE Note MCP 编辑未加入；本轮只完成 Drawer browser 手动 CRUD

## CURRENT PROBLEMS

### Side Tabs

- 当前长文案容易换行且像 UI explanation
- 已决定最终只显示 `EE` / `Aqi`，并保持 nowrap

### Side Note Expanded State

- 仍需确认展开纸不会显得像独立 rectangular card
- 目标：同侧 tab、主纸宽度约 70–85%、不透明纸面、中文行长自然、属于原件、参与正常 layout flow、一次只展开一种

### Record Expanded State

- 仍需进一步摆脱 metadata/settings panel 感
- 目标：窄长、不透明暖纸、receipt/library-card 比例、从原件后方抽出、sage 仅作小面积语义

### Filing

- 当前视觉方案判定失败：提示语、透明大表面和 2×3 controls 仍有 dashboard 感
- 下一版改为不透明窄纸：收起显示 `FILING · 当前位置`；展开为单列 `FILING SLIP` 六行索引
- 不显示六个按钮盒；选择后收回

## NEXT

1. **Aqi Triage / 整理一下**：对 Inbox / recent items 显式整理；高置信规则可应用，模糊项留在 Inbox；修改必须可见、可解释、可逆
2. **Workflow status automation**：六个 status 成为真实操作位置；仅 meaningful triage/workflow event 可移动，查看绝不移动
3. **Stale auto-archive**：长期无活动 item 只自动归档、不硬删；排除 `memory_candidate` 与显式保留项
4. **Safe dev fixtures**：建立不进入 production 的可清理 fixture，用于 EE Note、Aqi Note、Record、Filing 与 source states
5. **SELF DROP**：网页内 photo/file/URL/text/optional note；复用现有 multipart attachment model
6. **Deferred visual work**：Expanded Paper States、Open Drawer orderly mess、XHS Photo Packet、font integration

## DEFERRED

- Delete / Recover
- Recent Drop
- Full History Page
- Embedding Search / Vector Search
- Server-side AI classification
- Giant taxonomy manager
- New frontend composer
- Full production font integration
- iPhone direct image sharing（由另一条工作线处理）
- 大型 Activity Ledger 扩展
- infinite/freeform canvas

## DECISION LOG

### 2026-08-16

- EE/Aqi Side tabs 最终只显示名字，避免换行。
- Expanded paper surfaces 必须 opaque，并参与当前 bundle 的正常文档流。
- Filing 弃用透明 2×3 control panel，改为窄长单列 filing slip。
- Spatial 加入参考库；只借 object differentiation、organic stacks、invisible controls，不复制 canvas UI。
- Cabinet mobile major composition 暂时冻结。
- Fonts 暂停 production integration，等待 paper geometry 稳定。
- Done 必须有代码、测试、截图或真实交互证据；“计划做”不能进入 VERIFIED DONE。

### 2026-08-17

- Browser Drawer 使用独立 server-verified HttpOnly session；Bridge token 永不进入 public JS、HTML、localStorage 或 URL。
- Pocket 前端请求只使用 same-origin `/api/pocket/...`。
- Collection / Tags 现有位置与结构冻结；本轮只恢复真实保存链。
- Railway production 与 Volume 仍须 EE 实机验收，不能由本地自动化代替。
- Production 已由 EE 验证 browser login、mobile Shortcut、Tags 与 Collection persistence。
- 六个 status 的未来操作语义固定：Inbox=未整理；Tonight=近期注意；Discussed=已有实质讨论；Deferred=明确推迟；Memory candidate=显式记忆候选；Archived=不再活跃。
- 自动过期只允许 archive，不允许 hard-delete；查看 item 不构成 workflow movement。
- 后续测试采用安全、可清理且不进入 production 的 fixture，不再依赖永久假内容。

## Maintenance

每轮施工完成、开始下一轮前更新本文件。保持简洁，不复制完整开发历史；真正影响后续工作的决定才进入 Decision Log。
