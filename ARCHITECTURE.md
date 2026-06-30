# 技术架构（MVP 邀请制试点）

> 配套 [PRODUCT.md](PRODUCT.md)（产品）与 [DESIGN.md](DESIGN.md)（引擎工程）。
> 原则：试点阶段**够安全（PII）、够正确（异步 + 复用反造假引擎）**，不过早上重型基础设施。
> 已有 `resume_agent/` 引擎作为库直接复用，新增的只是它外面的 Web/服务/存储/合规层。

## 一、总体架构

```
                          浏览器 (Next.js SPA)
                       上传 / 纠错 / 看匹配 / 审 diff / 下载
                                  │ HTTPS（仅国内节点，ICP 备案）
              ┌───────────────────▼────────────────────┐
              │            FastAPI 应用（单体）          │
              │  Auth(手机验证码) · REST API · 限流/鉴权  │
              │  写 jobs 表（不引 Celery/Redis：DB 任务队列）│
              └───────┬───────────────────────┬─────────┘
                      │ 入队                    │ 读结果
              ┌───────▼────────┐        ┌──────▼──────┐
              │  Worker 进程    │        │  PostgreSQL  │
              │  轮询 jobs 表   │◀──────▶│ users/resumes│
              │  跑 resume_agent│        │ jobs/matches │
              │   引擎（库调用）│        │ payments/audit│
              │  ├ ingest       │        │（敏感字段加密）│
              │  ├ jd_match     │        └──────────────┘
              │  ├ improve      │
              │  ├ render(Chromium→PDF)        ┌──────────────┐
              │  └ LLM 客户端 ──┼──────────────▶│ 托管 LLM API │
              └───────┬─────────┘  通义/智谱     └──────────────┘
                      │ 文件读写
              ┌───────▼────────┐
              │ 对象存储(OSS)   │ 上传 PDF(短存) · 渲染 PDF(签名URL)
              └────────────────┘
```

**为什么单体 + DB 任务队列**：试点并发低、要快上线、要少运维面。`jobs` 表 + Worker 轮询足够；
扩容时再换 Celery/Redis 或托管队列、把 render 拆独立服务（见第九节）。

## 二、复用 vs 新建

| 复用（`resume_agent/`，零改动核心） | 新建（Web/服务层） |
|-----------------------------------|-------------------|
| `ingest` PDF→JSON + grounding 核验 | FastAPI API + 鉴权/限流 |
| `jd_match` JD↔证据映射 + 反造假 | 异步 jobs 表 + Worker 运行器 |
| `evaluate`/`rubrics` 按岗位评分 | `llm.py` 加**通义/智谱 provider** |
| `improver`/`patcher` 事实约束改写 | 渲染服务（Chromium PDF）|
| `resume_diff` 逐字段 diff | 账号 / 支付 / 存储 / PII 加密 |
| `kami_adapter` 渲染 HTML | 合规：同意、删除闭环、审计、AI 标识 |
| `validate` 形状校验 | 运营后台 + 成本/质量埋点 |

## 三、主流程（异步 + 进度）

```
上传PDF/粘贴 ─POST /resumes─▶ 建 job(ingest) ─▶ 返回 job_id
   前端轮询 GET /jobs/{id} ◀─ Worker: ingest → JSON + grounding 告警
   ─▶ 解析预览 + 低置信字段确认/纠错  PATCH /resumes/{id}
粘贴 JD ─POST /resumes/{id}/match─▶ job(jd_match) ─▶ 覆盖度+证据+硬缺口
一键强化 ─POST .../improve {jd}─▶ job(improve) ─▶ 逐条 diff（patch，未编造）
   用户逐条接受/拒绝  POST .../accept {接受的patch}
导出 ─POST .../render─▶ job(render) ─▶ Chromium 出 PDF → OSS 签名URL（付费去水印）
```

每个 job 落 token 数 / 各阶段耗时 / 失败原因，用于成本与质量核算。

## 四、数据模型（核心表）

| 表 | 关键字段 | PII/保留 |
|----|---------|---------|
| `users` | id, phone_hash(不存明文), created_at | 手机号仅存哈希 |
| `resumes` | id, user_id, **json_enc(敏感字段加密)**, source, created_at, **delete_at** | 默认 7 天自动删；硬删接口 |
| `jobs` | id, user_id, type(ingest/match/improve/render), status, progress, input_ref, result_ref, error, **tokens_in/out**, ms | 结果含 PII 同样加密 |
| `jd_matches` | id, resume_id, jd_hash, report_json, created_at | JD 不长存明文，存哈希+报告 |
| `payments` | id, user_id, sku(单次/求职包), amount, status, channel | — |
| `audit_log` | id, user_id, action(read/export/delete), at, ip | PII 访问/删除全留痕 |
| `files`(OSS) | 上传原件(短存 24h)、渲染 PDF(签名URL，限时) | 上传件尽早删 |

## 五、API（关键端点）

```
POST  /auth/otp                 手机号 -> 发验证码
POST  /auth/verify              验证码 -> 会话
POST  /resumes                  上传 PDF / 粘贴文本 -> job(ingest)
GET   /jobs/{id}                轮询状态/进度/结果
PATCH /resumes/{id}             字段纠错（低置信确认）
POST  /resumes/{id}/match       {jd_text} -> job(jd_match)
POST  /resumes/{id}/improve     {jd_text} -> job(improve)，返回 diff
POST  /resumes/{id}/accept      {accepted_patches} -> 应用接受项
POST  /resumes/{id}/render      {lang,template} -> job(render) -> 签名PDF
DELETE /resumes/{id}            硬删除（+ 审计）
POST  /pay/checkout · /pay/callback
```

## 六、LLM 接入层（`llm.py` 扩展）

- 新增 **通义千问(DashScope)** 与 **智谱 GLM** provider，沿用现有 `make_chat_fn` 接口（一处接入，全引擎复用）。
- 统一加：超时、**有限重试**（只重试网络/限流，不重试 4xx/格式错）、**按 job 记 token 与耗时**。
- 选**支持「不用于训练」的企业接口**；密钥走密管，不入库不入日志。
- 评估/匹配用低温度（稳定结构化），改写可略高——分别配置。

## 七、渲染服务（PDF）

- `kami_adapter` 出 HTML → **容器内 headless Chromium** 打印 PDF。
- **字体内置进渲染镜像**（不依赖 CDN，渲染容器可**网络隔离**，杜绝 SSRF）。
- 渲染前对用户内容做 HTML 转义校验（引擎已 `safe_url` + `esc`）；Chromium 沙箱 + 资源限额。
- 输出落 OSS，返回**限时签名 URL**；免费档加水印，付费去水印。

## 八、安全与合规（落到架构）

- **PII**：`resumes.json` 敏感字段（姓名/电话/邮箱）**应用层加密**；评估端进模型前已脱敏（不送姓名/院校）。
- **上传安全**：大小/页数限额、文件类型校验、恶意文件扫描、**隔离解析**（解析进程不连内网）。
- **删除闭环**：硬删接口 + 默认 `delete_at` 自动清 + OSS 同步删 + 备份可删，全程 `audit_log`。
- **合规对接**（详见 PRODUCT.md 第五节）：上传前**单独同意**、隐私政策、**PIPIA 留档**、ICP 备案、
  生成式 AI 应用登记、**AI 生成内容标识**（界面 + 导出 PDF 加隐式/显式标识）。
- **鉴权**：会话级；`resumes/jobs` 按 user 隔离，防越权（IDOR）。

## 九、扩容路径（试点跑通后再做，别提前）

| 信号 | 动作 |
|------|------|
| 并发上升、job 积压 | DB 队列 → **Celery/Redis 或托管队列**；Worker 横向扩 |
| 渲染成瓶颈 | 渲染拆**独立服务** + Chromium 池自动伸缩 |
| LLM 成本/延迟敏感 | 加缓存（同简历同 JD 命中）、按档选模型、评估自建可能性 |
| 多区域/合规分级 | 数据分域、读写分离、对象存储多桶 |

## 十、可观测与成本核算

- 每 job 记：阶段耗时、token in/out、重试次数、失败类型、grounding 告警数。
- 成本看板：**每笔成功付费导出的全成本**（LLM + 渲染 + 短信 + 存储 + 人工兜底）与 CAC，而非单次 LLM 调用。
- 质量看板：grounding 告警率、字段纠错率、用户举报"改得不对"率、人工复核错误率（金标集）。

## 十一、技术选型小结

| 层 | 选型 | 备注 |
|----|------|------|
| 前端 | Next.js + Tailwind | 部署国内 CDN，ICP 备案 |
| 后端 | FastAPI（Python） | 与引擎同语言，库直接 import，零胶水 |
| 任务 | DB(jobs 表) + Worker 轮询 | 试点从简；扩容换队列 |
| 存储 | RDS PostgreSQL + OSS | 敏感字段加密、签名 URL、自动删 |
| LLM | 通义 qwen-plus / 智谱 GLM-4 | 企业接口、不训练、密管 |
| 渲染 | headless Chromium + 内置字体 | 网络隔离、限时签名 PDF |
| 部署 | 阿里云/腾讯云（ECS 或容器服务） | 单体起步 |
| 登录 | 手机号验证码 | 微信开放平台资质后置 |

## 十二、落地顺序（对应 PRODUCT.md 6 周节奏）

1. `llm.py` 接通义/智谱 + FastAPI 包 ingest/match/improve/render（本地跑通）
2. jobs 表 + Worker + 进度轮询；渲染容器（内置字体）出 PDF
3. 前端：上传→解析预览/纠错→JD 匹配页→改写 diff 页→导出
4. 账号 + 支付 + 删除闭环 + 审计 + AI 标识 + 埋点
5. 合规件齐（W0 已启动备案）→ 邀请 30–50 人试点
