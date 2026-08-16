# Aqi Drawer Project Status

Last reviewed: 2026-08-17

## CURRENT FOCUS

### Core Item Loop — production rollout

P0 代码闭环已经完成：same-origin Drawer API、独立浏览器 session、现有 Collection / Tags 保存链。下一步先由 EE 配置 production Drawer secret、重新部署并完成 Railway 实机验收；通过后再继续 SELF DROP 与 EE Note。

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

## IMPLEMENTED / NEEDS VERIFICATION

### Production / Railway rollout

- 需要在 Railway 新增独立 `C_POCKET_DRAWER_SECRET` 并重新部署
- 需要在真实 production `/drawer` 完成登录、Collection / `Ombre` 保存与刷新验收
- 需要人工确认 Volume 仍挂载 `/app/data`，并执行重启后的 item/media 持久化验收

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

### Core-loop features not included in this P0 run

- Drawer SELF DROP 尚未实现
- EE Note 的 Drawer create/edit/clear、REST 与 MCP 编辑尚未实现

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

1. **Production rollout**：配置 `C_POCKET_DRAWER_SECRET`，部署新版静态资源，验收线上登录与 Collection / Tags 保存刷新
2. **Railway persistence**：确认 `/app/data` Volume；创建 text/image，重启或 redeploy 后再次确认 item 与 media
3. **SELF DROP**：网页内 photo/file/URL/text/optional note；复用现有 multipart attachment model
4. **EE Note loop**：Drawer create/edit/clear、REST、MCP 与刷新持久化

以上通过后再回到视觉施工：

5. **Expanded Paper States**：EE / Aqi / Record / Filing
6. **Open Drawer Orderly Mess** 与 source-specific objects
7. **Typography**：paper geometry 稳定后再测，不 production integrate

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

## Maintenance

每轮施工完成、开始下一轮前更新本文件。保持简洁，不复制完整开发历史；真正影响后续工作的决定才进入 Decision Log。
