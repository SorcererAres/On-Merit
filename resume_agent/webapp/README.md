# 简历优化网站（核心链路 · 本地演示）

> 定位：单用户本地演示级，跑通 导入→核对→匹配→改写→评分→导出。部署/账号/支付/合规后置。
> 技术方案见 `../../FRONTEND.md`；后端 API 见 `app.py`；引擎在 `resume_agent/`。

## 结构

```
webapp/
├── app.py          # FastAPI 后端（包引擎；结构化错误、安全 diff 写回、线程池慢路由）
├── static/         # 前端构建产物（vite build 生成，后端托管）
└── frontend/       # Vite + React + TS + shadcn/ui(手写) + Tailwind(Geist tokens)
    └── src/{lib,store,types,components,steps}
```

## 运行

**依赖**：后端需 `pip install fastapi uvicorn python-multipart httpx` + 引擎依赖（pydantic pymupdf jinja2 python-dotenv；本地兜底还需 ollama）。前端需 Node + pnpm。

**模型（推荐 DeepSeek，质量远强于本地 gemma4）**：复制 `.env.example` 为 `.env` 填 key，运行前
```bash
export LLM_PROVIDER=deepseek DEEPSEEK_API_KEY=sk-...   # 或用 .env
```
本地兜底：不设 `LLM_PROVIDER` 即走 Ollama（默认 `gemma4:latest`，需 `ollama serve`）。
通用 OpenAI 兼容（通义/GLM/OpenAI）见 `.env.example`。key 只入 env，不入库。

### 方式 A：一体（后端托管已构建前端）
```bash
cd frontend && pnpm install && pnpm build      # 产物进 ../static
cd .. && OLLAMA_MODEL=gemma4:latest uvicorn app:app --port 8000
# 打开 http://127.0.0.1:8000
```

### 方式 B：前后端分离（开发热更新）
```bash
# 终端1：后端
OLLAMA_MODEL=gemma4:latest uvicorn app:app --port 8000
# 终端2：前端（vite 代理 /api → 8000）
cd frontend && pnpm dev        # 打开 http://127.0.0.1:5173
```

## 已实现（本地必做）

- 六步向导；Geist Light/Dark 主题
- 慢任务 UX：页面内状态区 + 「已等待 Ns」+ 停止等待（诚实：只断浏览器等待）；单飞防重复提交
- 状态版本绑定：resume/JD 一变，下游 match/improve/eval 结果清空（防旧结果覆盖）
- 安全 diff 写回：patch 带 old，服务端校验 old + 写后 validate + 逐项结果 + 不合法回退
- 结构化错误信封 `{code,message,retryable,requestId}` + X-Request-Id

## 待补（试点补，见 FRONTEND.md）

- 202+jobId 异步队列（现同步/线程池）；RHF+useFieldArray 编辑器（现受控草稿）
- warnings 带 path 的字段级高亮；OpenAPI→TS codegen；字体自托管；隔离渲染服务出 PDF
- MSW/Playwright 测试；完整 a11y；账号/支付/合规
