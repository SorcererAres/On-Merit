# Resume Agent — 项目约定

## 前端 UI 规范（强制）

**所有前端 UI 改动必须走既定规范，不得另起炉灶。** 目录：`resume_agent/webapp/frontend`。

### 技术栈基线（不得替换）
- **组件库**：shadcn/ui（`components.json` 已配置，`style: default`，`baseColor: gray`，`iconLibrary: lucide`）。
- **样式**：Tailwind CSS + Vercel Geist 设计 token。**禁止**引入其它 UI 库（Radix 直用、MUI、Antd、Chakra 等）或独立 CSS 框架。
- **图标**：统一用 `lucide-react`，不引入其它图标包。
- **Toast**：用 `sonner`。表单用 `react-hook-form` + `zod`（已装 `@hookform/resolvers`）。

### 硬性约定
1. **组件必须来自 shadcn/ui**：所有 UI 组件一律使用 shadcn/ui（按下面的选取顺序）。**禁止**手写自定义基础组件（自造 button/modal/dropdown/tabs/select 等），也不得从网上抄组件实现或引入其它组件库来替代。
2. **组件选取顺序**（严格按序）：
   1. 先复用项目已有组件：`src/components/ui/`（`button` / `card` / `input` / `misc`）与 `src/components/`。
   2. 项目里没有，就从 shadcn/ui 官方注册表引入：用 `shadcn` skill 或 `pnpm dlx shadcn@latest add <组件>`，落在 `src/components/ui/`。
   3. **shadcn/ui 没有合适的组件时——停下来告诉我**，说明「需要什么组件、shadcn 为何不覆盖、你的建议方案」，等我确认后再动手。**不要**擅自手写替代品或临时拼一个。
3. **颜色/间距/圆角只用 token**：一律走 Geist token（`src/styles/tokens.css`）与其上的 shadcn 语义别名（`--background` / `--primary` / `--border` / `--muted` …）。**禁止**在组件里写死十六进制色值或魔法像素。深浅色靠 `<html>` 上的 `.dark` 类联动。
4. **class 合并用 `cn`**：从 **`@/lib/cn`** 导入（注意：本项目不是默认的 `@/lib/utils`）。
5. **导入别名**：组件 `@/components/...`、UI `@/components/ui/...`、工具 `@/lib/...`（`@/*` → `src/*`）。

### ⚠️ 已知陷阱
- `components.json` 里 `aliases.utils` 是 `@/lib/utils`，但项目实际 `cn` 在 **`src/lib/cn.ts`**。用 `shadcn add` 生成的新组件会 `import { cn } from "@/lib/utils"` —— **务必改成 `@/lib/cn`**（或建立 re-export）。
- Geist token 提供 P3 广色域覆盖，改 token 时 `:root` 与 `.dark` 两处语义别名都要同步。

### 产品边界（与反编造立场相关）
- 不做「AI 一键生成整份简历」、不做「模拟面试报告」——这两项与项目反编造立场冲突，UI 上不要新增此类入口。

## 语言
- 文档、注释、commit message 用简体中文；代码本体保留原语言。
