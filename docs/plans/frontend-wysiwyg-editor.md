# 方案：前端重构为 WYSIWYG 编辑器 + 路由（v1 务实版）

> 把当前「向导单页」重构为「文档编辑器应用」：仪表盘 → 所见即所得编辑器（左编辑 / 右实时预览 / 右 AI 面板）→ 预览。与已复核的持久化方案交织落地。
> **强依赖** `docs/plans/multi-resume-persistence.md`：数据模型、仓库/API、事务与保存并发契约**以那份为准**，本方案不重复，只声明如何接入。

## 〇 已定决策
- **编辑器范式**：JadeAI 式所见即所得，但 **v1 务实版** = 左结构化分节编辑 + 右实时 A4 预览 + 右 AI 面板。
  **v1 明确不含**（各为后续独立大工程，避免预期错位）：拖拽排序、在渲染预览上直接内联点字编辑、50 套模板。v1 先给 **1–2 套模板**。
- **与持久化一起做**（正规 `/editor/:id` 需简历 id）。
- **引入 `react-router-dom`**（客户端路由）；后端加 SPA fallback 以支持深链刷新。

## 一 路由
| 路径 | 页面 |
|---|---|
| `/` | Dashboard（简历列表卡片；即持久化方案的 dashboard） |
| `/editor/:id` | 编辑器（所见即所得） |
| `/preview/:id` | 整页预览 / 导出（打印/PDF；分享留后续） |
| 未匹配 | 重定向 `/` |
- **后端 SPA fallback（必须，且实现策略写死）**：**不能**用 `@app.get("/{path:path}")` catch-all——它会把未命中的 `/api/xxx` 也接住返 HTML、吞掉 JSON 404 语义（GLM 复核指出的经典陷阱）。**采用中间件方案**：`call_next` 先跑正常路由；仅当响应为 **404 且路径不以 `/api`、`/assets`、`/static` 开头且是 GET/HEAD** 时，才改回 `index.html`（no-cache）。这样 `/api/未知` 仍返引擎既有 JSON 404、静态未命中仍 404，只有前端深链回退到 SPA。

## 二 编辑器架构 `/editor/:id`
- **顶栏**：标题（inline 可改）· 保存状态（dirty / saving / saved / 冲突）· 岗位 chip · 动作 `[评分][JD匹配][改写][导出]` · `历史版本` · `← 列表`。
- **三栏（响应式）**：
  - **左 · 分节编辑器**：复用 `ReviewEditor` 字段编辑逻辑，改为常驻、按 section 折叠；编辑**实时防抖写 store**（遵循持久化方案「编辑内容进 store、hydrationKey」契约）。
  - **中 · 实时 A4 预览**：复用 `resumeToMarkdown`/`resumeDoc`（自适应缩放已就绪）。**重渲加 ~150ms 防抖 + `requestAnimationFrame`**（与保存防抖解耦），避免多页简历逐键全量重排的可感知抖动。
  - **右 · AI 面板（可收起抽屉）**：tab `评分`(ScoreCard) / `JD覆盖`(MatchReportView) / `改写`(diff 逐条采纳，默认不勾 → `/api/apply`)。
- **窄屏**：三栏折叠为 `编辑 / 预览 / AI` 三 tab 切换（单列）。

## 三 三阶段 → 能力面板映射（流程解构为「随时可用」而非强制顺序）
| 现在（向导阶段） | 之后（编辑器内） |
|---|---|
| 诊断 | 右面板「评分」（岗位自动检测仍在；JD 填了含覆盖度） |
| 修改 | 右面板「改写」（有 JD→JD 强化 / 无 JD→rubric 自动改；diff 逐条采纳） |
| 排版 | 中间实时预览 + 顶栏「导出」（`/preview/:id` 或就地打印） |
| 核对 | 左侧常驻分节编辑器 |
- **面板互相独立、无硬顺序依赖（已核对端点）**：`/api/improve`（JD 路径）内部自行 `jd_match`，`/api/auto-improve`（无 JD 路径）内部自行 `evaluate` 再 patch——**都不消费前端「评分」面板的 diagnosis**，故去顺序化不破坏调用正确性，用户可不先诊断就直接改写。副作用仅是「评分面板显示的分」与「auto-improve 内部那次评分」是两次独立 LLM 调用、可能不同——在改写面板注明「本次改写基于自身评估，与评分面板可能有出入」，不做隐式绑定。
- 不再强制顺序；顶栏给一个**可选、非阻塞**的「诊断 → 改写 → 导出」引导 checklist（提示进度，不锁步）。
- **反编造差异点不弱化**：评分「非面试率」、JD「证据覆盖指数」、改写「grounding + 不自评 + 需真实补充」——原样保留在面板里，是本编辑器区别于 JadeAI 的核心。

## 四 复用 / 改造清单
- **复用**：`resumeDoc`/`resumeToMarkdown`、`ReviewEditor`（字段编辑）、`ScoreCard`、`MatchReportView`、`lib/api`、`lib/useTask`、持久化方案的 store 契约与 `/api/resumes*`。
- **改造**：
  - `App.tsx`：从 `phase` 分支改为 `<RouterProvider>`（`/` `/editor/:id` `/preview/:id`）。
  - `Stepper` 退役（或降级为编辑器内的引导 checklist 组件）。
  - `phases/PhaseDiagnose|Modify|Layout` **拆解重组**：分节编辑 → 左栏；预览 → 中栏；评分/JD/改写 → 右面板 tab。逻辑基本平移，重排容器。
  - `store`：从「单会话 phase 模型」改为「绑定 `:id` 的编辑器 store」——字段与动作（resume/jd/role/diagnosis/improve/afterScore/dirty/version/hydrationKey + load/save/…）**全部采用持久化方案第四节契约**，不新造。

## 五 数据 / 状态一致性（全部遵循持久化方案，不重复定义）
- 打开 `/editor/:id` → `GET /api/resumes/{id}` → `loadResume`（原子重置全部编辑期状态）→ 编辑。
- 编辑实时写 store；**保存（单飞 + 合并待存 + 乐观并发 version）、export_md 失效、dirty/savePoint、hydrationKey 重挂、409 三选项**——一律按持久化方案 §四，本方案不改其语义。
- **AI 结果失效语义 = 清空（非留 stale）**：`resume` 一变即**清空** diagnosis/improve 面板结果（现有 store 已如此，迁移后保持），杜绝「基于旧版生成的建议被采纳」的静默损坏；**双保险**：即便残留，`/api/apply` 逐条校验 `old` 值、不符则跳过（stale），改坏物理上被挡。窄屏 tab 下切回「改写」若结果已清空，显式提示「已失效，请重新运行」，不展示过时内容。
- **跨简历导航守卫（新增，路由特有）**：同一路由模式下 `/editor/1 → /editor/2` React **不卸载组件**，`loadResume(id2)` 会原子覆盖 id1 的脏数据。故：① 编辑器组件 `key={id}` 强制卸载重建；② 用 `useBlocker`（离开 `/editor/:id`）+ `beforeunload`（关页/刷新）在 **dirty 时拦截 → 保存/放弃/取消** 三选项，与持久化方案的 dirty 确认统一。
- **岗位检测异步 → 回填是字段级 set**：检测回来只 `set(role)`、不整份覆盖，故不冲掉用户期间的其它编辑（last-write-wins 仅作用于 role 单字段）；回填后触发一次保存（持久化方案已含）。

## 六 分期（每期可独立验收）
1. **P1 持久化后端**（= 持久化方案的 P1：仓库 + SQLite + 事务/并发契约 + API + 单测，**已含 revisions/rollback API**，故 P5 版本历史无隐藏后端缺口）。
2. **P2 路由外壳 + Dashboard + 后端 SPA fallback**（react-router；`/` 列表可新建/打开/复制/删除）。
3. **P2.5 store 语义重构**（单独一期降风险）：`phase` 模型 → 绑定 `:id` 的文档 store（load/save/dirty/hydrationKey/乐观并发接入持久化契约）。**先于 UI 重组，独立可测**。
4. **P3 编辑器骨架（高风险期）**：三栏（左分节编辑 / 中实时预览）。因同时涉及布局重组 + P2.5 store 落地验证，标为**最高耦合期**，务必 preview 真机逐项验收后再进 P4。
5. **P4 AI 面板**：评分 / JD / 改写 三 tab 接入现有组件与端点（含面板独立性、失效清空、窄屏 stale 提示）。
6. **P5 `/preview/:id` + 导出 + 版本历史 UI**（回滚，用持久化方案的 revisions/rollback）。
7. **（后续独立迭代，不在本方案）** 拖拽排序、预览内联点字编辑、多模板体系。

## 七 风险
- **迄今最大一次前端重构**：three-phase 组件重组、引入 router、store 语义从 phase→文档绑定。靠分期各自验收降风险。
- **深链刷新**：必须后端 SPA fallback，否则 `/editor/:id` 刷新 404；且 fallback 不能吞 `/api`（未匹配 API 仍返 JSON 404）。
- **范围预期**：v1 是务实 WYSIWYG，非完整 JadeAI 画布；边界已在 §〇 写死。
- **验证**：无前端单测框架，按既有做法用 preview 真机验证（路由跳转、深链刷新、load/save、AI 面板、窄屏 tab 折叠）。

## 依赖
- `docs/plans/multi-resume-persistence.md`（已过跨模型复核）。二者合起来构成一次完整重构：持久化是底座，本方案是其上的编辑器/路由形态。

<!-- codex-peer-reviewed: 2026-07-01T10:00:12Z rounds=2 verdict=approved -->
<!-- 复核说明：codex 因用量上限不可用；改由 OpenCode 跨模型复核 —— R1 GLM-5.1 发现 4 major+5 advisory（SPA fallback 吞 /api 404、面板去顺序依赖、过时建议损坏、脏态路由守卫、预览抖动、P3 高耦合拆 P2.5、回填竞态等）全部修复；R2 deepseek-v4-pro 验证 → APPROVED、无新重大问题。 -->
