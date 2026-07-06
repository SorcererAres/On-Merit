# 诊断台与诊断报告解耦——右栏二级页方案（v3 最小版）

> 目标：右栏「诊断」tab 内，把「诊断控制台」与「当前报告」拆为一级/二级两个页面，
> 并让报告在简历编辑后「过期不销毁」。历史报告（顶栏「诊断记录」弹窗）不在本次范围，一字不动。

## 一 背景与现状（grounded）

- `DiagnosePanel.tsx`：岗位 select + JD textarea + 诊断按钮 + 报告（ScoreCard + MatchReportView）
  全部堆在同一滚动列；报告排在控制台之后，`{diagnosis && !analyze.loading}` 使诊断进行中旧报告整块消失。
- `useStore.ts:97-99`：`editResume` / `setJD` / `setRole` 三个 action 都直接 `diagnosis: null`——
  用户对照报告「需真实补充」修改简历时，第一次键入报告即被销毁（核心痛点）。
- 每次诊断已 POST 存档 `/api/resumes/:id/reports`；顶栏「诊断记录」（`EditorPage.openReports`）
  提供历史查看，**本方案不动它**。

## 二 目标形态

```
一级 · 诊断台                    二级 · 当前报告
┌──────────────────┐           ┌──────────────────┐
│ 岗位 [select▾]      │           │ ← 返回   [重新诊断]  │ ← 固定头
│ 目标 JD [textarea]  │  诊断完成  │ ⚠ 简历已变更（仅过期时）│
│ [ 诊断 ]            │  ────→   │ 3/120 · 14:02      │
│                    │           │ 雷达 / 维度分        │
│ 最新报告 3/120·14:02→│ ←返回可再进│ 需补充/优势/JD覆盖度  │ ← 独立滚动
└──────────────────┘           └──────────────────┘
```

- **一级（诊断台）**：岗位 / JD / 诊断按钮维持现状布局；唯一新增——存在当前报告时，
  按钮下方一行入口「最新报告 {score}/120 · {time} →」，点击进二级。
- **二级（报告页）**：头部 `shrink-0` 固定（← 返回 + 重新诊断按钮 + 生成时间）；
  正文 `overflow-y-auto` 全高独立滚动（ScoreCard + 需真实补充 + JD 覆盖度）。
- **流转**：点「诊断」→ 完成后自动推进二级展示新报告；「重新诊断」用一级当前配置重跑，
  完成后原地刷新二级内容。诊断失败留在原页，错误就地展示（沿用 TaskStatus）。

## 三 状态设计：过期不销毁

- `diagnosis` 由裸报告改为 `{ report, stamp: { contentSeq, jd, role, at } }`。
  - `report`：原 `Diagnosis`（`{ evalResult, match }`）。
  - `stamp.jd` / `stamp.role`：生成时的 JD 原文与 role，**按值比较**（jd 直接字符串相等，无需 hash 库）。
  - `stamp.at`：`Date.now()` 时间戳，供二级页「生成时间」显示（**修正：原 stamp 无时间字段，报告头「生成时间」将无数据源**）。
  - `stamp.contentSeq`：**简历内容版本号**，见下。

- **过期判据 = 报告的真实输入变了**：`/api/evaluate` 吃 `resume+role`，`/api/match` 吃 `resume+jd`。
  故 stale ⇔ `简历内容变` ∨ `jd 变` ∨ `role 变`。jd/role 已在 stamp 里按值捕获，直接比较即可。
  简历内容维度**不能复用 `editSeq`**——`setLayout` 也会 `editSeq+1`（见 §八代码），
  会把「仅调排版/模板」误判为报告过期（分数实际不受排版影响）。
  **方案**：store 新增 `contentSeq`，仅在**简历内容变更**时自增（`editResume`/`setImported`/
  `applyResume`/`restoreSnapshot`），`setLayout`/`setTitle` **不动它**；stamp 存 `contentSeq`，
  过期比较用它。（`editSeq` 保留原职责：autosave/undo 语境戳，不参与过期判定。）

- **stale 为推导态**：`当前 { contentSeq, jd, role }` 与 `stamp` 任一不等 ⇒ 过期。不新增显式布尔。
- 过期时二级页顶部黄条：「简历已变更，本报告基于旧内容 · 重新诊断」；分数区不降级不遮挡，
  仅黄条提示（诚实口径：绝不让旧分被误读为现状，也不做新旧对比/涨分展示——wizard-flow §〇 约束）。
- 诊断进行中：旧报告保留可读（去掉 `!analyze.loading` 隐藏条件），TaskStatus 显示进度。

### 3.1 `diagnosis: null` 六处逐条决策（避免「删三留两」机械执行）

现状全部置 `diagnosis: null` 的位置（完整清单）及本方案处理：

| 位置 | 语义 | 处理 |
|---|---|---|
| 初始 state | 无报告 | 保留 `null` |
| `editResume` | 改简历内容 | **删** `null`：保留报告 + `contentSeq+1` → 推导过期 |
| `setJD` | 改 JD | **删** `null`：保留报告 → `stamp.jd` 不等 → 过期 |
| `setRole` | 改岗位 | **删** `null`：保留报告 → `stamp.role` 不等 → 过期 |
| `replaceDoc`（`setImported`/`applyResume`） | 导入 / 采纳改写覆盖全文 | **删** `null`：属内容变更，保留 + `contentSeq+1` → 过期（旧报告仍可对照参考） |
| `restoreSnapshot`（undo/redo） | 回到历史内容态 | **删** `null`：内容变更，保留 + `contentSeq+1` → 过期 |
| `loadRecord`（切换/载入另一份简历） | 换简历 | **保留** `null`：跨简历报告无意义 |

即：仅 `loadRecord` 保留清空；其余五处删除 `null`（内容类四处随带 `contentSeq+1`，`setJD`/`setRole` 靠按值比较）。

### 3.2 读方连锁（结构变更的下游适配）

`diagnosis` 从裸 `Diagnosis` 变为 `{ report, stamp }` 后，所有读 `diagnosis.evalResult` / `diagnosis.match`
的位置须改为 `diagnosis.report.evalResult` / `diagnosis.report.match`。已知读方：`DiagnosePanel`
（`<ScoreCard data={diagnosis.evalResult}>` 与 `<MatchReportView report={diagnosis.match}>`）。
`setDiagnosis` 签名同步改为接收 `{ report, stamp }`（或在 `runAnalyze` 内组装 stamp 后传入）。
实施前 grep `diagnosis.evalResult|diagnosis.match|diagnosis\.` 确认无遗漏读点。

## 四 导航状态

- `DiagnosePanel` 内部 `useState<"console" | "report">`，不进全局 store、不进路由
  （右栏是编辑器内嵌面板，无 URL 语义；切 tab / 切简历自然重置为 console）。
- 自动推进：`runAnalyze` 成功回调里 `setView("report")`。

## 五 范围外（明确不做）

- 顶栏「诊断记录」弹窗与 reports API：不动。
- 报告持久化回填（刷新恢复）：不做，`diagnosis` 仍是会话内存态。
- AI 润色 tab、改写流：不动。

## 六 实施步骤

1. **P1 导航骨架**：DiagnosePanel 拆 `ConsoleView` / `ReportView` 两个内部组件 + view state；
   报告渲染迁入 ReportView（固定头 + 独立滚动）；完成自动进二级；一级加「最新报告 →」入口行。
2. **P2 过期语境戳**：store ① 新增 `contentSeq`（仅内容变更自增，`setLayout`/`setTitle` 不动）；
   ② 改 `diagnosis` 形态为 `{ report, stamp:{ contentSeq, jd, role, at } }`；③ 按 §3.1 表逐条处理
   六处 `diagnosis: null`（仅 `loadRecord` 保留，其余五处删，内容类四处随带 `contentSeq+1`）；
   ④ `runAnalyze` 组装 stamp（`at=Date.now()`）；⑤ 按 §3.2 改读方 `diagnosis.report.*`；
   ⑥ ReportView 顶部过期黄条（`当前 {contentSeq,jd,role}≠stamp` 推导）。jd/role 按值比较，不引 hash 库。

## 七 验收

- 诊断完成自动进入二级页；返回一级后经入口行可再进；报告区独立滚动、重跑按钮常驻可见。
- 编辑任意字段 / 改 JD / 换岗位后：报告仍在，黄条出现；重新诊断后黄条消失。
- **仅调排版/模板（`setLayout`）或改标题后：报告不弹黄条**（分数不受排版影响，`contentSeq` 未变）。
- 报告头「生成时间」正确显示（`stamp.at`）。
- 导入 / 采纳改写 / undo 后：旧报告保留可对照，黄条出现（内容已变）。
- 诊断进行中旧报告可读；失败不丢当前报告。
- 切换简历后报告清空（不跨简历残留）。
- 顶栏「诊断记录」行为与改前完全一致；grep `diagnosis.evalResult|diagnosis.match` 无漏改读点。

<!-- review-model: mydp/deepseek-v4-pro（默认 GLM-5.2 与会话续接均超时，改用已鉴权的 DeepSeek-V4-Pro 单轮内嵌代码评审）；四条 advisory 已并入：contentSeq / stamp.at / 六处 null 决策表 / 读方连锁 -->
<!-- opencode-peer-reviewed: 2026-07-06T06:04:22Z rounds=1 verdict=approved -->
