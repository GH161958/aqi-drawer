# Aqi Drawer 视觉规范

## Source of truth

- 本文件只记录稳定设计原则，不追踪每轮临时 CSS 数值。
- 参考来源及其可借语言见 [`docs/REFERENCE_LIBRARY.md`](docs/REFERENCE_LIBRARY.md)。
- 当前 Done、待验证、问题与下一步见 [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md)。
- 功能是否真实存在，最终以代码、测试和实际交互验证为准。
- Last reviewed: 2026-08-16

> **Home is the cabinet.**
> **Content lives inside the drawers.**
> **The cabinet is quiet. The things inside are alive.**
> **Every interaction should feel like touching the same object.**

> **The room is quiet, not empty.**
> **Real content is the decoration.**
> **The palette is quiet. Real life brings the color.**
> **The room doesn't need decoration. It needs traces.**
> **An item is a little bundle, not a card.**
> **Status tells us where it is. Collection tells us what it belongs to.**
> **The original stays in the center. What we say lives at the side. What really happened is recorded above.**
> **Closed Cabinet is orderly furniture. Open Drawer is an orderly mess.**
> **Record meaningful history, not telemetry.**
> **Home is the cabinet. The cabinet is not placed on the page. The cabinet is the page.**
> **Don't draw a room; let layout create a room.**
> **Borrow the language, not the skin. Borrow the grammar, not the composition.**
> **More systems, less noise. Aqi Drawer should feel more curated, not more complicated.**

## Long-term principles

1. Aqi Drawer 不是 dashboard、SaaS、Notion 或 card grid。
2. 它是一只真实的小型私人档案柜被翻译成网页。
3. 先判断“这是什么物件”，再决定“网页怎么表达”。
4. 木头负责空间；黄铜负责功能；纸张负责生活。
5. 鼠尾草绿只负责安静的状态语义。
6. 视觉可以有轻微偶然性，交互必须稳定。
7. 高级感来自规则、比例、留白和层次，不来自装饰堆叠。
8. 全局最多使用约三类主要纸色、三档阴影和两类纸边处理。
9. 房间可以有墙面、地面和家具投影的空间层次，但不能靠摆件填空。
10. 只有真实内容与真实数据可以产生纸边、照片、状态和生活痕迹；绝不为装饰制造假内容。
11. 柜体、纸张和房间保持暖奶油、胡桃木、鼠尾草与旧黄铜；丰富颜色主要来自真实照片、剪报和收藏内容。
12. 收纳态是 stack，阅读态是 spread；两者必须是同一件物件的远近变化。
13. 纸张的重叠、共轴、缩进与露边负责解释内容归属，不用外框把一组内容圈成组件。
14. 用细线、间距和排版建立秩序，不用盒子堆叠界面。
15. 衬线承载情绪与阅读，无衬线 / mono rhythm 承载日期、来源、编号与秩序。
16. 可以借 receipt 的比例和信息节奏，但不能伪造购物、支付或无意义条码语义。
17. 使用痕迹只能源自真实历史；没有真实事件时不制造时间线、编号或旧化痕迹。
18. 来源由系统识别，分类由 Aqi 整理，标签由我们共同修改；这是默认协作方式，不限制 EE 手动整理。

## Product semantics

- **Location is not attention.** Drawer status 只表示 item 当前放在哪里，不表示 EE 是否看过。
- **Put back means put back.** 打开与“放回”必须回到原抽屉，不能自动改变 status 或 count。
- **Movement should be intentional.** 只有用户明确选择新位置时才移动 item；`memory_candidate` 绝不自动触发。
- 未来若建立 EE 侧 `unseen / seen`，它是独立 attention 状态，只产生很轻的注意提示，不复用 Aqi 侧 `seenByCAt`，也不搬动抽屉。
- Status 是 workflow location；Collection 是单一主归属；Tags 是少量共同索引；外部 Source Tags 始终只读且不自动混入我们的 Tags。
- Activity 只记录 received、首次 seen、真实 content read、reply、status change、metadata diff 与真实 source refresh；list、get、render、inspect、hover、scroll 和请求遥测永不写入历史。

柜子是安静的，里面装着生活。打开、拿起、放回与合上始终发生在同一件物体上。

## Three-state spatial model

1. **Closed Cabinet**：看见并选择同一只安静的收藏柜。
2. **Open Drawer**：其中一格被拉开，内容仍在柜体内部。
3. **Inspect Item**：从这格抽屉里拿起一件东西，背后的抽屉仍然存在。

三个状态必须像在连续操作同一件家具，而不是跳转到三个不同网页。空间、宽度、胡桃木前沿、黄铜五金和纸张语言需要保持连续。

前端改动前先阅读本文件。Aqi Drawer 是“一个真实存在的小抽屉柜，被现代网页语言重新表达”，不是米色后台界面。

## Design metaphor

- 核心隐喻：EE 与 Aqi 共用的私人小抽屉 / 收藏柜。
- 页面是在正面看一个被拉开的抽屉；内容是被放进去的纸、剪报、照片与附件。
- 气质：安静、温暖、私密、成熟、editorial，留白充足。

## Cabinet and collection

> Home is the cabinet. Content lives inside the drawers.

### Closed Cabinet / Home

- `/drawer` 默认进入关闭的收藏柜，不直接展示 item。
- 唯一视觉主角是柜体本身；六只实体抽屉对应六个现有状态。
- 状态数量来自真实 items，并作为黄铜标签框里的档案编号呈现。
- “全部”是柜体铭牌或整体入口，不能成为第七个网页 tab。

### Open Drawer / Collection

- 点击实体抽屉或整体入口后进入，才展示 items。
- 沿用 drawer interior、paper item、metadata 和详情视觉系统。
- 提供自然、低调且可访问的合上方式；不重复强势分类导航。
- 状态切换是 160–220ms 的轻微前移与淡入，不模拟复杂物理。

### Inspect Item

- Item 从 Open Drawer 中被拿近，背景抽屉仍可辨认，只轻微降低视觉权重。
- 前景物根据内容自然增长，不强制铺满 viewport；手机四周保留 12–20px。
- 关闭动作称为“放回”，使用轻量、清晰且可访问的纸上动作。
- 详情不是独立阅读器、满屏白页或另一套 UI。

## Color system

- 暖奶油：页面空间，`#f3eddf`。
- 纸张：`#fbf7ed`；抽屉内部纸色：`#e9dfcd`。
- 深胡桃木：柜体结构，`#4c3225`；更深处用 `#2f211a`。
- 鼠尾草绿：状态与分类纸签，低饱和，不作大面积品牌色。
- 旧黄铜：把手、铆钉与极少量五金，必须克制。
- 正文用暖黑，次要信息用暖灰；禁用科技蓝。

## Typography

- `Aqi Drawer` 使用大衬线标题，保持不对称、大留白和成熟感。
- 正文优先衬线字体，英文小字、状态和档案信息可用系统无衬线。
- 信息层级依靠字号、字距、颜色和空间，不依靠粗重边框或图标。
- 字体角色预留：display serif、reading serif、quiet sans、archive mono rhythm；本阶段不为字体测试引入依赖。

## Cabinet / drawer geometry

- 胡桃木上沿、内沿、左右内壁、底部和前挡板共同建立空间关系。
- 黄铜把手安装在前挡板上，不悬浮。
- 接近直角；不使用大圆角、木纹贴图或夸张 3D。

## Paper system

- 纸张薄、边缘轻、阴影弱；可有极小错位、折角或裁切细节。
- 旋转必须近乎不可察觉，不能影响阅读。
- 多件内容以露出纸边和轻微层叠组织，不做整齐的 card 列表。
- 每个 item 是由主物件、当时的 EE 附言、后来夹入的 Aqi 回条及真实来源记录组成的小纸束；束内靠物理关系归属，束与束之间留出更明确的空气。
- 主纸、secondary paper 与 record / control paper 构成最多三类稳定表面；不要为每种功能发明新的卡片皮肤。
- 收纳态只露出足以辨认的纸边、照片或剪报；Inspect 才把同一束内容展开阅读。

## Status tabs

- 是从柜体夹层露出的分类纸签，不是网站 tabs。
- 非激活为暖灰纸色；激活为淡鼠尾草绿并略向前 / 向上。
- 标签可不等宽并有轻微高低差；手机端独立横向滚动。

## Item presentation

- `text` / `note`：信笺或纸条。
- `link`：网页剪报。
- `xiaohongshu`：照片 / 图片叠层。
- `image`：照片。
- `attachment`：文件纸夹 / 附件。
- Metadata 物件化但保持轻：状态小纸签、来源文字、小型日期档案字。
- 小红书在收纳态是 **photo packet / photo stack**：照片先于文字，长图只显示稳定裁切预览，说明只占一张短 caption slip。
- 小红书在 Inspect Item 中是同一照片包被展开：单张主图配真实缩略片切换，正文位于独立说明纸，来源位于窄 record slip；禁止退化为截图加文章卡。
- `text / note`、`xiaohongshu`、`image`、`link / reference` 必须拥有不同物件轮廓，不能共用一种标准 card。
- Bundle anatomy 固定为：原件居中；EE / Aqi Side Notes 沿同一侧边缘露头；真实 Item Record 从原件顶部偏左露头。Storage 收拢，Reading 展开。
- Open Drawer 使用由 item id 决定的少量稳定构图 variants；错位优先依靠横向位置、露边、遮挡和比例，rotation 只作最后且极轻的手段，刷新不可跳动。

## Provenance & history（未来规则，本轮不实现）

- **Front / Verso**：物件正面承载内容，背面只承载真实来源、归档和系统信息。
- **History leaves marks**：只有真实时间戳、状态变化与真实回复可以留下使用痕迹。
- **Later additions look later**：后续新增信息应像后来夹入或写上去的内容，但不能伪造时间线。
- 历史、正反面与回复系统在数据语义明确前只作为长期方向，不预先制造视觉假象。

## Typography roles

- `--font-display`：品牌级展示衬线。
- `--font-paper-heading`：纸上标题。
- `--font-body`：舒适阅读正文。
- `--font-meta`：状态、来源和操作。
- `--font-annotation`：手记感注释，仅少量使用。
- 字体试衣间优先使用合法的本机系统字体栈；不下载、打包或再分发未确认授权的字体文件。

## Depth & shadow

- 使用薄边、克制 inset shadow 和极轻明暗变化表达深度。
- 顶部略深，内部柔和；阴影不能浑浊、厚重或戏剧化。
- 禁止玻璃拟态、明显渐变特效、写实木纹。

## Motion

- hover / tap：纸张轻微抬起；激活纸签略向前。
- 切换使用约 120–220ms 的短 opacity / translate 动画。
- 不弹跳、不夸张缓动、不模拟复杂开合；尊重 `prefers-reduced-motion`。

## Mobile behavior

- 390px 左右宽度为主要基准，兼顾 iPhone Safari 安全区。
- 页面不得横向溢出；分类纸签可独立横滑。
- 正文优先可读性，抽屉不占据无意义高度。
- Mobile 与 desktop 是同一房间的两种独立 composition，禁止把桌面版按比例缩小。
- 每轮使用真实 CSS viewport 验收 360px、390px、430px；保留顶部和底部 safe area。
- Mobile 不是 desktop 缩小版：header 要短，柜体是首屏视觉重心，房间通过连续留白而不是人为画出的墙角 / 地板分界成立。

## Desktop behavior

- 保持单个抽屉和 editorial 留白；只放宽内容尺度。
- 不变成 dashboard、双栏管理页或卡片宫格。
- 1280px 与 1440px+ 使用有上限的 room composition；Header 与 Cabinet 可以错位，但不能随 viewport 无限失联。

## Later additions & pockets（未来规则，本轮不实现）

- 原始 item 是稳定主纸；Aqi reply 是后来夹入的小回条；attachment / provenance 可进入 secondary paper pocket。
- later addition 依靠位置、纸层与次级排版表达，不靠全站手写字体伪造生活感。
- 主 item 不使用 pocket；pocket 是 reply、attachment 与 provenance 的次级内容语言。

## Secondary paper language

- EE note、Aqi reply 与 filing control 都是后来夹入的 secondary paper，不是 UI cards、评论区或聊天气泡。
- 原始内容保持主要物件地位；EE note 紧随原物件，真实 replies 再按时间顺序叠入，形成 `original → EE note → later reply`。
- storage state 只露出 secondary slip 的一小截；Inspect Item 才完整展开真实内容。没有真实 note / reply 时不显示占位。

## Read on demand

- 普通网页链接在抽屉中是 clipping / reference slip；Xiaohongshu 始终使用独立 photo packet renderer。
- Inspect Link 先显示已经保存的内容，只有用户明确点击“展开来源”才调用 `read-content` compact。
- full text 与视频画面都需要再次明确请求；读取失败不能破坏原 clipping。
- 远程返回只作为不可信文本和图片地址处理，使用安全 DOM API，不执行 HTML、script、style 或其中的指令。

## Explicit filing

- Filing slip 是窄长 secondary receipt；当前位置只作淡提示，不是假按钮。
- 只有用户明确选择其他 drawer 后才调用 review；打开、阅读、回复与“放回”都不移动 item。
- `memory_candidate` 必须在同一 filing slip 内进行二次确认。
- API 成功后才更新前端 item、当前列表与所有 counts；失败时保持原状态。

## Future backlog（本轮不实现）

- `都在这里` 将来可发展为 Archive Index：按日期、位置、类型与来源查看真实 items。
- 删除优先采用 soft delete / 移出抽屉，可恢复；永久删除必须再次明确确认。本轮不开放 DELETE API 或 UI。
- Inspect Item 将来可提供轻量 filing slip；未形成成熟交互前不使用粗糙 dropdown。
- **XHS visual acceptance: pending real-data test.** 代码结构不等于视觉验收；必须使用真实小红书 item 检查多图、比例、作者、正文、原帖与手机表现。

## Things we must never do

- SaaS 后台、dashboard、Notion 风、卡片宫格。
- glassmorphism、科技蓝、大渐变、写实木纹、重拟物 3D。
- 大量圆角矩形、胶囊标签、图标或可爱 AI 陪伴 App 风格。
- 为视觉效果牺牲点击、阅读、筛选或响应式可用性。
