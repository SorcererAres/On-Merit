# 前端技术方案（核心链路）· v2

> 配套 [ARCHITECTURE.md](ARCHITECTURE.md) / [PRODUCT.md](PRODUCT.md)。范围：核心链路（导入→核对→匹配→改写→评分→导出）。
> **定位（诚实）**：本阶段目标 = **单用户本地演示级**跑通核心功能，非邀请制试点级。部署/账号/支付/合规后置。
> v2 吸收一轮前端跨模型复核（Codex）。标注 **【本地必做】**（核心链路正确性）/ **【试点补】**（上线前才做）。

## 〇、四个必须先解决的问题（Codex 复核，scaffold 前定清）

1. **慢任务语义**：LLM 调用几十秒。**本地** = 后端重活用 `def`（Starlette 走线程池，不堵事件循环）+ 三层超时；前端按钮叫 **「停止等待」**（`AbortController` 只断浏览器等待，**不终止服务端推理**，别谎称"取消任务"）。**试点** = 换 ARCHITECTURE 的 `202 + jobId + 轮询 + cancel`，前端不另造协议。
2. **状态版本绑定**：每次 match/improve/evaluate/render 请求绑定 `resumeRevision + resumeHash + jdHash + requestId`；响应不匹配当前版本则**丢弃**；简历/JD 一变，**下游 matchReport/changes/evaluation/render 全失效**；同动作 single-flight + 禁重复提交。
3. **diff 安全写回**：patch = `{op, path, old, value}`；`/apply` 先校验 `old` 再写，写后跑 `validate_resume`，返回逐项 `{id,status,error}`；**diff 待处理期间禁止结构重排**（增删/排序经历会让 `work[0]` 指向另一条）。长期给条目加不导出的稳定内部 ID。
4. **Vite 产物 ↔ FastAPI 静态**：`vite.config` 设 `base:"/static/"` + `build.outDir:"../static"`（或 FastAPI 也挂 `/assets`）；哈希资源长缓存、`index.html` 不缓存；加构建后启动冒烟。

## 一、技术栈（已锁定）

| 层 | 选型 | 说明 |
|----|------|------|
| 框架 | **Vite + React 18 + TypeScript** | SPA，无 SSR/SEO 需求，迭代快 |
| 组件库 | **shadcn/ui**（Radix primitives + Tailwind） | 组件代码入库自持，改成 Geist 美学；Radix 保可访问性 |
| 样式 | **Tailwind CSS** + CSS 变量（Geist tokens） | App 与导出简历同一套设计语言，支持 Light/Dark |
| 数据请求 | **TanStack Query v5** | 统一管慢 LLM 调用的 loading/error/retry/cancel/缓存 |
| 全局状态 | **Zustand** | 向导流程状态（resume/jd/changes/step） |
| 表单/校验 | **React Hook Form + Zod** | 简历编辑器、JD 输入 |
| 通知 | **Sonner**（shadcn 集成）| 成功/错误 toast |
| 图标 | **lucide-react** | 配 shadcn |
| 路由 | 单页向导，暂不引 router（后续多页再加 React Router） | |

## 二、设计系统（Geist tokens → Tailwind / shadcn 主题）

> **已切换为 Vercel Geist**（替代早期的 Kami 暖色衬线方案）。App 与导出简历统一用 Geist，支持 Light / Dark 双主题。参考：`/design.md`（Light）、`/design.dark.md`（Dark）。

token 基础设施已落地（**本地必做**，scaffold 时直接复用）：

| 文件 | 作用 |
|------|------|
| `frontend/src/styles/tokens.css` | **纯 token**：Light 在 `:root`、Dark 在 `.dark`；强调色带 `@media (color-gamut: p3)` 的 oklch 广色域升级；shadcn 语义别名在 `:root` 与 `.dark` **各声明一次**（保证 `.dark` 挂 body 也联动）；含 body 基础样式、`outline` 聚焦环（+2px offset，不与 box-shadow 竞争）+ `forced-colors` 兜底、`prefers-reduced-motion` |
| `frontend/src/styles/globals.css` | **样式入口**（`main.tsx` import 它）：`@import tokens.css` + `@tailwind base/components/utilities`。shadcn CLI 的目标 CSS 也是它 |
| `frontend/tailwind.config.ts` | 把 CSS 变量映射进 Tailwind theme：color scale、排版尺度（`text-heading-*` / `text-copy-*` / `text-label-*` / `text-button-*`；`-mono` 变体**只设字号/行高，需搭配 `font-mono` 才用等宽字体**，如 `text-copy-14-mono font-mono`）、4px 间距、圆角、阴影（`shadow-card/popover/modal/focus`）、断点、动效 |
| `frontend/components.json` | shadcn 配置，`cssVariables: true`，`css` 指向 `globals.css` |
| `frontend/tokens-preview.html` | 零构建预览页，浏览器打开即可切 Light/Dark 目测色板/排版/组件/**语义层** |

要点：

```
主题切换：给 <html>（或 body）加/去 .dark 类，颜色全走 var(--…) 不重编译
表面：--background-100 主表面(卡片/页面)；--background-200 仅细微分隔，勿当通用填充
文本：--gray-1000 主文本 / --gray-900 次要 / --gray-700 禁用
状态色：green=成功/通过，blue=链接/信息/聚焦，amber=警告，red=错误（勿仅用颜色表状态，配图标/文字）
圆角：6px 控件 / 12px 菜单弹窗 / 16px 全屏；一个视图内不混圆角与直角
聚焦：:focus-visible 用 outline+outline-offset 画环（2px 间隙 + blue-700/dark blue-900），不走
      box-shadow 故不被 .shadow-* 覆盖；forced-colors 下 outline 切系统 Highlight 色
交互态：Geist 用色阶步进（100→200→300）而非透明度；Tailwind 完整色值不支持 `/90` 修饰符，
        落 shadcn 组件后把默认皮肤的 `bg-*/90` 换成对应 hover 色阶（如 hover:bg-accent）
```

shadcn 语义色（`background/foreground/card/popover/primary/secondary/muted/accent/destructive/border/input/ring`）已在 tokens.css 里映射到 Geist token，`tailwind.config.ts` 对应 `colors.*`；组件默认皮肤按此消费，`components.json` 里 `cssVariables: true`。

## 三、目录结构

```
resume_agent/webapp/
├── app.py                  # 后端（已存在，沿用）
├── static/                 # ← 废弃刚才的 vanilla 壳，改为 Vite 构建产物
└── frontend/               # ← 新建 Vite 项目
    ├── index.html
    ├── src/
    │   ├── main.tsx / App.tsx
    │   ├── lib/            # api client、query hooks、utils、cn
    │   ├── store/         # zustand（resume/jd/step/changes）
    │   ├── types/        # JSONResume、MatchReport、Evaluation 等 TS 类型
    │   ├── components/ui/ # shadcn 组件（入库）
    │   ├── components/    # 业务组件（见第五节映射）
    │   └── steps/        # 六个步骤页
    ├── tailwind.config.ts / components.json
    └── vite.config.ts     # dev 代理 /api → 127.0.0.1:8000
```

## 四、核心流程与屏幕规格（六步向导）

统一：顶部 **Stepper**（可点已完成步）；慢调用走 TanStack mutation + 全屏/局部 loading + 可取消；空/错态明确。

1. **导入** — Dropzone(PDF 拖拽/选择) + Textarea(粘贴)；`POST /api/ingest`。载入后进 2。
2. **核对与纠错** — 结构化**可视化编辑器**（basics/经历/项目/技能/教育，增删条目），**grounding 告警**置顶高亮；「原始 JSON」Collapsible 兜底。改动直接进 store。
3. **岗位匹配** — JD Textarea → `POST /api/match` → **覆盖指数(Progress)** + 已覆盖/弱/缺失(Badge) + 逐条证据 + **硬性风险**卡 + 反造假告警。
4. **强化改写** — `POST /api/improve` → **diff 列表**（每条 old/new + Checkbox 接受）+ 「需真实补充」卡 → 选中 `POST /api/apply` 写回 store。
5. **评分** — 岗位 Select（5 rubric）→ `POST /api/evaluate` → 总分 + 维度条 + 证据 + 缺口 + 优势。标注「模型启发式意见，非面试率」。
6. **导出** — 语言 Select → `POST /api/render` → iframe 预览 Geist 排版 → 浏览器打印成 PDF。

## 五、组件映射（feature → shadcn / 业务组件）

| 功能 | 组件 |
|------|------|
| 步骤导航 | 自建 `Stepper`（基于 Button + 状态） |
| 上传 | 自建 `Dropzone`（input file + 拖拽）+ `Textarea` |
| 简历编辑器 | `Card` + RHF `Form/Input/Textarea` + 动态列表（highlights 增删）|
| 匹配报告 | `Progress`（覆盖指数）+ `Badge`（覆盖态）+ `Alert`（硬性风险/告警）|
| 改写 diff | `Card` + `Checkbox` + old/new 高亮 |
| 评分 | `Progress`（各维度）+ `Alert`（缺口/优势）|
| 导出预览 | `iframe` + `Button`（打印）+ `Select`（语言）|
| 全局 | `Sonner`（toast）+ 全屏 `Spinner` overlay（LLM 慢）+ `Collapsible`（原始 JSON）|

## 六、状态与数据流（三者职责单一所有权）

- **RHF**：当前编辑**草稿** + 字段错误；数组用 `useFieldArray`，React key 用 `field.id`（**非下标**）；校验(Zod)通过后**一次性**提交到 Zustand（不每次按键 `patchField`）。
- **Zustand**：`step/maxStep`、**已确认的 canonical resume**、`jd`、`revision`、纯客户端选择态；用**细粒度 selector**，不订阅整个 resume。
- **TanStack Query**：服务端结果与请求态，**query key 含 revision/jdHash**；不与 Zustand 重复存同一报告。
- mutation **默认不自动重试**；仅网络错/429/502/503 显式重试，**绝不重放格式错或业务 4xx**；错误**就地展示**，toast 仅补充；render/apply 这类快速确定性操作**不触发** LLM 全屏 loading。

## 七、API 契约（与 app.py 对齐；结构化错误/告警）

```
POST /api/ingest    FormData(file 或 text)              → { resume, warnings[] }
POST /api/validate  resume                              → { errors[] }
POST /api/match     { resume, jd }                      → MatchReport
POST /api/improve   { resume, jd }                      → { before, changes[], notes[], must_supplements[] }
POST /api/apply     { resume, baseRevision, patches:[{op,path,old,value}] } → { resume, results:[{path,status,error}] }
POST /api/evaluate  { resume, role(枚举) }              → { evaluation, score, max, gaps[], role_label }
POST /api/render    { resume, lang(枚举) }              → { html }
GET  /api/roles                                         → { roles:[{key,label}] }   ← 前端用 useQuery（非 mutation）
```

- 所有端点加 Pydantic `response_model`；**从 OpenAPI 生成 TS 类型**，Zod 做运行时解析（试点补 codegen；本地先手写 `src/types/`）。
- **统一错误结构**：`{ code, message, retryable, requestId, fieldErrors }`；区分 校验失败/超时/限流/服务端故障，**别一律 400**。
- **warnings 结构化**：`{ code, path, severity, message, sourceExcerpt }`（不是纯字符串）——否则第 2 步「字段纠错高亮」无法定位。
- 入口限额：文件大小/页数/MIME 嗅探、JD 长度、合法 `role/lang` 枚举。

## 七'、后端 app.py 需调整（配合上面契约）

- **重活路由改 `def`**（非 `async def`）让 Starlette 走线程池，不堵事件循环；加模型/接口/代理三层超时。
- `/apply` 改 `{op,path,old,value}` + **校验 old + 写后 `validate_resume` + 返回逐项结果**（现在是盲写。见 app.py::set_by_path / api_apply）。
- ingest 的 `warnings` 与各端点错误改**结构化**（对齐上面）。
- 加 `response_model` 与错误处理中间件（统一 code/requestId）。

## 八、导出（iframe 打印仅演示降级）

- iframe 用 `srcDoc` + `title` + 严格 `sandbox` + CSP；**不把 HTML 插进主页面**。
- 等 `iframe.onload` 且 `document.fonts.ready` 再 `contentWindow.print()`；处理 Safari/移动端失败。
- **字体**：模板现回退 jsDelivr，与 ARCHITECTURE「字体自托管、渲染禁网」冲突 → **【试点补】自托管 + 确认商用授权**；本地演示可暂用 CDN 但标注。
- 稳定 PDF 应由**隔离渲染服务**产出（浏览器打印控不住字体/页眉/分页）——【试点补】。
- 文案：「**模板语言**」而非「导出语言」（只切模板文案，不翻译简历正文）。

## 九、无障碍与响应式（不能只靠 Radix 默认）

Stepper 用 `nav>ol` + `aria-current="step"`、未来步 disabled；loading `role="status"`/`aria-live`；Progress 带 `aria-valuetext`；diff 用语义 `del/ins`（**状态不只靠颜色**）；Checkbox 用 `fieldset/legend`、整行可点；触控 ≥44px、移动输入 ≥16px；diff 窄屏改上下排列；A4 预览可缩放/全屏；支持 `prefers-reduced-motion`；动态增删后维护焦点。

## 十、编辑器交互（第 2 步）

`useFieldArray` + `field.id` key；增删经历/highlight 后处理焦点；删除给确认或可撤销；日期区间/URL/邮箱/必填做 Zod 跨字段校验；原始 JSON 仅在 解析+Zod+`/validate` 全过后 `reset()`，失败保留原版并**定位行号**；离开有未提交改动的步骤提示；**PII 不默认写 localStorage**（简历敏感）；浏览器后退/刷新恢复行为明确。

## 十一、测试门槛（【试点补】，本地先冒烟）

Vitest/RTL + **MSW**：慢请求/超时/取消/重复点击、两请求乱序返回、编辑后旧报告失效、动态数组增删后 diff 不写错、原始 JSON 非法。Playwright：iframe 字体加载与打印、axe 可访问性、移动视口。

## 十二、落地顺序（scaffold）

1. Vite+TS 初始化 + **锁定 Tailwind/shadcn 主版本**（v4 无 `tailwind.config.ts`、v3 有——按所选版本定；本仓库 token 基础设施按 v3 的 `tailwind.config.ts` 形态落，若选 v4 需迁到 `@theme`）+ shadcn init（`cssVariables: true`，主题直接接已落地的 `src/styles/tokens.css` + `tailwind.config.ts` 的 Geist 语义色，做对比度验收）+ 装 query/zustand/rhf/zod/sonner/lucide
2. **先调后端 app.py**（第七'节：def 路由 + /apply 校验 + 结构化错误/告警 + response_model）
3. `types/`（手写）+ `lib/api`（fetch + AbortController + 版本绑定 + 丢弃 stale）+ `store`（细粒度 selector）
4. 布局外壳（Stepper a11y + **页面内任务状态区**（非全屏遮罩，显示"已等待 Ns" + 停止等待）+ Sonner）
5. 步骤 1/2（导入 + `useFieldArray` 编辑器 + 结构化告警高亮）→ 打通 ingest
6. 步骤 3/4（匹配 + diff **安全写回**逐条接受）
7. 步骤 5/6（评分 + 导出 iframe sandbox/字体就绪）
8. 联调 gemma4 真机 + 空/错/慢/乱序/重复提交 态打磨；本地冒烟
9. `vite build`（`base:/static/`、`outDir:../static`）→ app.py 托管 + 构建后冒烟

> **字体**：Geist 全程无衬线——**Geist Sans** 承载 UI 与正文，**Geist Mono** 承载数据/代码/需对齐的数字（简历预览同样用 Geist Sans，不再保留 Kami 衬线）。字体家族已在 `tokens.css` 的 `--font-sans` / `--font-mono` 定义。
8. `vite build` 产物给 app.py 托管（或 dev 用 vite 代理）

> 后端 `app.py` 已就绪；本方案定稿后按第九节 scaffold，先不写生产队列/账号/支付。
