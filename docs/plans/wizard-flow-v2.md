# 方案：四节点向导流程（v2）

> 主流程从「常驻三栏画布编辑器」改为「线性步骤向导」：**画廊 → 诊断 → 优化 → 导出**，闭环回画廊。
> **取代** `frontend-wysiwyg-editor.md` 的编辑器形态；`multi-resume-persistence.md` 的持久化/并发/保存契约仍有效。
> **底座保留复用**：持久化后端、autosave（单飞/合并待存/savePoint/409/loadSeq）、路由/SPA fallback、引擎端点、A4 渲染、diff 采纳、DeepSeek/OCR/岗位检测。
> 经 codex 复核修订（见文末〈复核记录〉）。

## 〇 已定决策
1. **线性向导取代常驻画布**：顶部全局步骤条「1 诊断 · 2 优化 · 3 导出」；各阶段是专注界面。
2. **分数与反馈保持诚实（硬约束，按 codex 收紧）**：
   - **不展示任何自评「提升」**：不做「匹配度飙升至 92」，**也不做覆盖指数/评分的 X→Y 前后对比作为「提升证明」或触发上升动画**——这仍是项目已删除的循环自证。
   - 优化阶段的正向反馈只陈述**可计数的操作**：「已采纳 N 处按『仅重述』规则生成的修改，请逐条核实；仍有 M 项事实缺口需真实补充」（有 JD 时 M 即 must-have 缺口，无 JD 时为 rubric 事实缺口）。不称「基于你真实经历的重述」（超出校验能力）。
   - **复评可选、且仅作独立新诊断**：用户可再跑一次诊断看当前基线，但**不与旧分并列成「涨了多少」**，界面标「模型启发式评估、非面试率、含波动」。
   - 改写只重述简历已有事实，**不做「补充 N 个关键词」**这类暗示加原文没有的内容；缺失硬要求标「需真实补充」（不替编）。守住 grounding/patch/不自评/非面试率。见 [[resume-agent-scope-exclusions]]。

## 一 文档外壳与向导状态机（新增，最先做——修 codex #1/#7）
- **常驻文档外壳 `/editor/:id`**：**只在此层** `loadRecord` 一次 + 挂 `useAutoSave(id)` + 409 冲突处理 + 离开守卫。步骤切换是**外壳内部 state** `step: 'diagnose'|'optimize'|'export'`，**不重载记录、不 +loadSeq、不 +hydrationKey、不卸载 autosave**（否则清空 diagnosis/improve、并取消待触发的防抖保存）。
- **step 放 URL 查询参数**（`/editor/:id?step=optimize`）以支持刷新/深链回到同一步；非法/缺省 → `diagnose`。
- **导航守卫排除切步（修 codex r2#1）**：`useBlocker` 只拦「离开当前 `/editor/:id`」的导航；**同 pathname、仅 `?step` 变化不拦**（否则 dirty 时每次切步都弹确认）。判据：`nextLocation.pathname === currentLocation.pathname` 则放行。
- **退役 `/preview/:id`（修 codex r2#1）**：不再保留第二套 load/autosave 外壳；旧链接 302/客户端重定向到 `/editor/:id?step=export`。排版就是外壳内的 export 步，共用同一份 loadRecord/autosave。
- **进入子状态**：空白新建 → 诊断的「上传」子态；已有内容简历 → 诊断的「核对/报告」子态（跳过上传，可再导入覆盖）；刷新/深链 → URL 的 step，数据从持久化载入。
- diagnosis/improve/afterScore 是外壳级 store 状态，跨步骤保留；resume 一变即按既有失效规则清空。

## 二 节点 0 · 简历画廊
- 时段问候语。巨型虚线卡「➕ 新建 / 导入」排首位。推拉过渡动画（CSS transform，尊重 `prefers-reduced-motion`）。
- **缩略图（修 codex 建议2）**：列表 API 不返 `data`，**不为每卡无界建 iframe**。方案：卡片**懒加载**（IntersectionObserver）时逐个 `GET /api/resumes/{id}` 取 data → 渲一张小 A4 快照，结果**缓存**；或后续加专门缩略图契约。首屏只渲可见卡。
- 复用 `/api/resumes` 列表/新建/复制/删除。

## 三 节点 1 · 诊断
- **状态1 上传**：Dropzone（PDF/图片/粘贴）+ 解析骨架屏扫描动效；复用 `/api/ingest`（含 OCR）。
- **原件来源（修 codex #2 / r2#2）**：ingest 无简历 id/version，**不能自行落库**。正确机制：`/api/ingest` **只在响应里多返一个 `source_text`**（抽取/OCR 后的纯文本）；前端 `setImported` **原子写入 `resume + sourceText` 到 store**；随后由既有**带 version 的 autosave PUT** 把 `source_text` 一并落库（`_UPDATABLE_FIELDS` 增该字段，见 §六）。`ResumeRecord`/`loadRecord`/autosave fields 均补 `source_text`。**原始 PDF 二进制不存**（体积/隐私）——「左原件」= 文本层原文，界面如实说明。
- **状态2 左右核对**：左 `source_text` 原文（只读）/ 右分节表单（复用 SectionEditor，实时防抖写 store）。
- **联动高亮（修 codex #3；再修 r3#3——放弃 LCS/模糊，取诚实精确匹配）**：点右侧某段 → 在左侧原文定位并滚动高亮。**刻意不做最长公共子串/模糊匹配**——那会产生可能误导的近似高亮，与反编造/不误导立场冲突；宁可不高亮。实际规则：**空白归一化**（连续空白折单空格、去首尾，保留下标回映）后做**精确唯一子串**匹配，**最小长度阈值**（≥8 字）、**命中唯一**才高亮、**歧义/多命中/未命中/无文本层则不高亮**；仅容忍换行/多空格差异，标点或改写后文本不高亮。UI 标「原文定位」。`source_text` 为空（无文本层且 OCR 失败）→ 左栏只读降级、无联动。**不做 PDF 坐标级 bbox（列 v2）。**
- **状态3 JD 与诊断报告**：底部粘 JD（选填）→ 岗位自动检测 + `/api/evaluate` +（有 JD）`/api/match`。
  - **能力雷达图（修 codex 建议1）**：**按 `/api/evaluate` 实际返回的维度动态绘制**（rubric 各岗位维度不同，不写死 impact/craft/process/scope），维度用人类可读标签，整体标「**模型启发式评分**、非面试率」。总分 X/满分。
  - 有 JD：**证据覆盖指数 X%**（覆盖/弱/缺 + must 风险），标「覆盖指数≠面试率」。
  - 雷达图：手写 SVG，不引重依赖。「进入优化」→ step=optimize。

## 四 节点 2 · 优化（Diff 审阅）
- **双栏 Diff**：左原文 / 右 AI 改写（有 JD→`/api/improve`、无 JD→`/api/auto-improve`）。
- **逐条采纳 / 一键全采纳** → `/api/apply`（old 值校验兜底）。默认不勾，逐条确认。
- **悬停提示（修 codex #6 / r2#3，命名与话术都收紧）**：`Change` 只有 `kind/path/old/new`，端点无逐项 AI 依据 → **不叫「AI 解释」**；悬停只显示**改动类型 + 字段路径 + 话术「按『仅重述已有事实』规则生成，请逐条核实」**。**不宣称「未新增内容」**——确定性校验能挡路径/结构/凭空数字，但**挡不住文本里新增技术/客户/定性夸大**（软性拔高），故要求用户逐条核实。逐项事实依据校验列后续。
- **正向反馈（诚实，按 §〇.2）**：采纳后气泡——「已采纳 N 处按『仅重述』规则生成的修改，请逐条核实；仍有 M 项事实缺口需真实补充」，**无 X→Y 分数对比、无上升动画**。想看当前水平 → 回诊断跑一次独立评估（不与旧分并列）。
- 「去排版导出」→ step=export。

## 五 节点 3 · 排版与导出（三栏排版台）
- **左 模板库**：v1 **3–4 套**（经典/现代/极简/ATS），每套一套 resumeDoc CSS 变体；点选中央秒级重排。50 套列后续。
- **中 A4 画布**：复用 resumeDoc，`--fit` 自适应。
- **右 样式控制器（边界收紧，修 codex r2#4）**：字号/行距/主题色滑块 → 注入 resumeDoc 的 CSS 变量。**前后端都 clamp/reject**：`templateId ∈ 白名单枚举`；`fontScale ∈ [0.85,1.25]`、`lineHeight ∈ [1.2,2.0]`（越界夹取）；`themeColor` 只接受**预设调色板枚举**或**严格 `#RRGGBB` 正则**（拒任意字符串，杜绝 CSS 注入面）。非法值后端 400、前端夹取，保证版式不崩且无注入。
- **多端预览**：桌面/手机边框切换（容器尺寸）。
- **导出**：PDF（打印/存 PDF）；成功动效 → 返回画廊，闭环。

## 六 排版持久化契约（修 codex #4——不能塞进 export_md）
- **数据模型新增两列**（走迁移框架，见 persistence 方案 §二迁移约定）：
  - `source_text TEXT NULL`（节点1 原文层）。
  - `layout_settings TEXT NULL`（JSON：`{templateId, fontScale, lineHeight, themeColor}`）。
- **仓库/API 白名单 + 校验**：`_UPDATABLE_FIELDS` 增 `source_text`、`layout_settings`（均 nullable）。PUT 对 `layout_settings` **强校验**：`templateId ∈ 白名单枚举`、`fontScale/lineHeight` 数值边界（越界 400 或夹取）、`themeColor` 调色板枚举或 `#RRGGBB` 正则；非法 → 400，不落脏。
- **revisions**：快照/回滚/duplicate 一并带上这两列（完整文档快照，回滚不分裂）。
- **前端保存序**：`layout_settings` 用**独立 `layoutSeq`**——回写仅在期间未再改样式时采用服务端值；**内容（data）变更绝不清空 `layout_settings`**（样式与内容正交）。
- **`source_text` 写入路径（修 r2#2）**：不由 ingest 端点落库；`setImported` 把 ingest 返回的 `source_text` 写进 store，随既有带 version 的 autosave PUT 持久化。用户不编辑，不参与失效逻辑。
- **`export_md` 退役（v2 决策，取代 persistence 方案 §四对应条款）**：向导 v2 的节点3 用**模板库 + 样式控制器**（`layout_settings`）取代自由 Markdown 编辑，排版完全由 `data + layout_settings` 派生，不再有可编辑的 MD 覆盖层。因此**前端不再读写 `export_md`**（store/autosave 均移除该字段），也不再有「data 变更失效 export_md」的逻辑。**后端 `export_md` 列与安全网保留**，仅用于兼容历史数据（旧记录里的手工 MD 不再在 UI 呈现——v2 无自由 MD 编辑入口，属预期）。若未来需恢复自由排版，另立方案。

## 七 反编造保留（贯穿）
改写 patch/grounded、缺失标「需真实补充」、评分标「非面试率」、**全程无自评提升**。庆祝只包装可核验事实（采纳数/剩余缺口）。

## 八 分期（修 codex #7，每期独立可交付）
1. **W0 文档外壳 + 向导状态机**（§一）：`/editor/:id` 常驻，step 内部化 + URL 同步；复用现有能力先跑通「诊断→优化→导出」闭环（无新视觉件、无 DB 改动）。**先落地、可独立验收**。
2. **W1 后端契约**：迁移加 `source_text`/`layout_settings` + 仓库/API 白名单（含 layout_settings 强校验）+ revisions/duplicate 覆盖 + 单测。`/api/ingest` 端点**增返** `source_text`（响应字段）。**持久化接线（setImported→autosave 落库）在 W2**——W1 纯后端、可独立验收。
3. **W2 节点1**：上传骨架屏 + 左原文/右表单核对（原文定位）+ 诊断报告（动态雷达 + 覆盖指数，诚实无提升）。依赖 W1 的 source_text。
4. **W3 节点2**：Diff 页 + 悬停改动类型提示 + 逐条/一键采纳 + 诚实反馈（采纳数/缺口，无 X→Y）。
5. **W4 节点3**：模板库（3–4 套）+ 样式控制器 + 多端预览 + 导出闭环 + `layout_settings` 持久化（依赖 W1）。
6. **W5 节点0 + 打磨**：画廊缩略图（懒加载+缓存）+ 问候 + 推拉动画（尊重 reduced-motion）。
7. （后续）PDF 坐标级联动、50 套模板、逐项改写 rationale 端点。

## 九 风险 / 范围边界
- **诚实优先于爽**：无自评提升是硬约束，宁可少一个「涨分」动效也不自证（codex 复核确认）。
- 原件 = 文本层，非像素 PDF；联动是空白容忍的精确原文定位（不做模糊，宁缺毋误导）；模板 v1 限 3–4 套——均如实标注，不过度承诺。
- 反转已复核的画布：底座与 DB 契约不动（除 §六两列）、只换外壳与阶段界面；每期 preview 真机验收。

<!-- codex-peer-reviewed: 2026-07-02T06:16:24Z rounds=4 verdict=approved -->
<!-- 复核记录：codex 4 轮至 APPROVED。R1 7 项(状态契约不完整/原件无来源/联动误导/排版设置无契约/诚实分数仍自证/Diff无逐项依据/分期非独立)；R2 4 项(切步误触守卫/ingest不能自持久化/防伪超范围宣称/样式无边界=注入面)；R3 2 项(W1措辞矛盾/反馈超校验能力)；R4 通过。核心收紧：取消一切自评X→Y提升与上升动画；改写话术降为「按仅重述规则生成请逐条核实」；原件=文本层近似定位；样式 clamp/reject 防注入；layout_settings 独立持久化契约。 -->
