# Resume Agent 设计方案

把根目录两个开源项目组合成一个「生成 × 评估」闭环的简历 agent。

- **hiring-agent**（HackerRank）：评估端。PDF -> JSON Resume -> 评分 + 证据 + 改进建议。
- **Kami**（tw93）：生成端。结构化内容 -> 印刷级 PDF。
- **公共契约**：两者都围绕 **JSON Resume schema**，无需自定义中间格式。

核心思路：把招聘方的**评分标准**反过来当作求职者的**优化目标函数**，得到一个会自我迭代的简历 agent。

---

## 一、整体架构

```
                    ┌─────────────────────────────────┐
                    │   单一事实源: resume.json        │
                    │   (JSON Resume schema)           │
                    └─────────────────────────────────┘
                       ▲                         │
        ┌──────────────┘                         ▼
   ① INGEST                              ④ RENDER
   原始简历 PDF/文本                      Kami resume.html
   hiring-agent/pdf.py + github.py        kami_adapter.py -> WeasyPrint
   -> JSONResume                                │
        ▲                                       ▼
        │              ┌──────────────┐    交付物 resume.pdf
   ③ IMPROVE  ◀────────│ ② EVALUATE   │◀──────（回灌评估）
   improver.py         │ evaluator.py │
   按评分短板「事实约束改写」 │ 评分+证据+建议 │
        │              └──────────────┘
        └────────── loop until score ≥ 阈值 或 收敛 ──────────┘
```

## 二、四阶段 -> 模块映射

| 阶段 | 复用 / 新建 | 模块 | 产出 |
|------|------------|------|------|
| ① INGEST | 复用 hiring-agent | `pymupdf_rag.py` `pdf.py` `github.py` | 原始 PDF -> `JSONResume`（+ GitHub 信号） |
| ② EVALUATE | 复用 hiring-agent | `evaluator.py` + `resume_evaluation_criteria.jinja` | `EvaluationData`：四类分 + bonus/deductions + 改进建议 |
| ③ IMPROVE | **新建** | `resume_agent/improver.py` | 针对低分项「事实约束改写」后的新 `resume.json` |
| ④ RENDER | **新建胶水** + 复用 Kami | `resume_agent/kami_adapter.py` + `Kami/assets/templates/resume.html` | 印刷级 HTML / PDF |
| 编排 | **新建** | `resume_agent/resume_agent.py` | 闭环 + 分数轨迹报告 |

## 三、评分体系（来自 hiring-agent，作为优化目标）

| 类别 | 满分 | 关键规则 |
|------|------|----------|
| open_source | 35 | 个人 repo 不算开源贡献；必须是对**他人项目**的贡献 |
| self_projects | 30 | 教程级项目（todo/计算器/天气）低分；无链接扣 30–50% |
| production | 25 | 实习/生产经验；创始人/早期工程师加分 |
| technical_skills | 10 | 技术广度与问题解决 |
| bonus / deductions | +20 / 上限 | GSoC +5、portfolio +2 等；总分上限 120 |

**公平性约束（直接继承）**：评分**绝不依赖**姓名、性别、学校、GPA、城市等，只看技术能力与项目影响力。优化目标本身就是去偏见的。

---

## 四、字段对照表（JSON Resume ↔ Kami resume.html）

这是连接两库的核心契约。Kami 模板用 `{{中文描述}}` 自由占位符（给 agent 理解后填写，非唯一键），所以适配层不机械替换，而是**复用 Kami 的 `<head>`+`<style>`，按 CSS class 程序化拼装 `<body>`**。

| JSON Resume 字段 | Kami section / CSS class | 适配层处理 | 备注 |
|------------------|--------------------------|-----------|------|
| `basics.name` | `.header .name` | 直填 | 同时替换 `<title>`/`<meta author>` |
| *(无 `label`)* | `.contact .role`（岗位定位） | **降级**：取 `work[0].position`，或 `--role` 覆盖 | hiring-agent 的 `Basics` 无 label 字段 |
| `basics.email` `phone` `url` | `.contact .email/.phone/.site` | 有则渲染，`·` 分隔 | |
| `basics.profiles[]` | `.contact .profile`（链接） | `network` 作锚文本 | |
| `basics.location.city` | `.contact .loc` | 只取 city | 公平性：不渲染 address/region |
| `basics.summary` | `个人简介 .summary` | 直填 | |
| `work[]` | `工作经历 .project` 块 | `name`->proj-name，`position`->proj-kind，日期->proj-role，`summary`->「职责」行，`highlights[]`->「成果」行 | Kami 原 3 行（角色/动作/结果）放宽为职责+成果 |
| `projects[]` | `开源项目 .os-grid .os-item` | `name`+`url`->链接，`description`+`technologies`->描述，正则抽 `★N`/`stars` | 抽不到星标则不显示 |
| `skills[]` | `核心能力 .skill-row` | `name`->skill-label，`level`+`keywords`->skill-body | |
| `awards[]` | `荣誉奖项 .convictions .conv-card` | `title`+`awarder`+`date`+`summary` | 复用 Kami conviction 卡片样式 |
| `education[]` | `教育背景 .edu-row` | `institution`->school，`studyType/area/score`->major，日期->date | |
| `volunteer[]` | （暂未映射） | P1 折入工作经历 | |
| `certificates/publications/languages` | （暂未映射） | P1 按需加 section | |
| **Kami 独有**：metrics / AI 判断与行动 / 对外影响力 | — | **P0 跳过**（无 JSON Resume 来源） | P2 可由 LLM 从 work/projects 派生 |

**渲染策略**：有数据才渲染对应 section，无数据则**省略**（不留空占位符）。

---

## 五、闭环编排（`resume_agent.py` 伪代码）

```python
resume = ingest(pdf_path_or_questionnaire)        # hiring-agent
history = []
for round in range(MAX_ROUNDS):                   # 默认 3 轮
    evaluation = evaluate(resume)                 # hiring-agent
    history.append(evaluation.total_score)
    if evaluation.total_score >= TARGET or converged(history):
        break
    resume = improve(resume, evaluation)          # improver.py：事实约束改写
render(resume, lang="zh")                          # kami_adapter.py -> PDF
report(history, evaluation)                        # 分数轨迹 + 最终证据
```

**收敛保护**：连续两轮提升 `< δ` 则停，避免 LLM 反复抖动文案。

## 六、红线：事实诚信

IMPROVE 阶段**只允许「重述、结构化、量化已有事实」，不允许编造经历**：

- 允许：改文风、对齐 STAR、突出**原文已出现**的关键数字、让描述更紧凑
- 禁止：虚构开源贡献、伪造工作经历、夸大 GitHub 数据、补充原文未写出的技术
- 靠「事实层」拿分的项（如真实开源 PR），agent 只能在报告里标为「**需真实补充**」并提示用户，不自动改写。

**诚实说明（反造假的边界）**：当前反造假是**启发式安全网，不是密码学保证**。它能可靠拦下
*露骨的结构造假*（新增公司 / 工作 / 机构 / 奖项条目、原文没有的阿拉伯数字 default 回退），
但**拦不住更隐蔽的编造**：中文数字（「百万用户」）、复用电话/日期里的旧数字、在 summary/
highlight 文本里塞进新机构或新职位。要做到真正严密，需要重构为「模型只返回受限 patch +
JSON Schema 校验 + 稳定 ID 匹配」（见 P6）。当前阶段靠**三层防护**把风险降到可接受：
1. 强约束 prompt；2. 确定性校验（结构造假 + 新数字默认 error 回退）；3. diff 全摊给人工复核。

## 七、实施路径

| 阶段 | 状态 | 内容 |
|------|------|------|
| **P0** | ✅ 已完成 | `kami_adapter.py`：JSON Resume -> Kami HTML/PDF，确定性、无需 LLM |
| **P1** | ✅ 已完成 | `improver.py`：事实约束改写 + 确定性反造假校验 + 事实层缺口报告（5 项离线测试通过） |
| **P2** | ✅ 已完成 | `resume_agent.py`：评估-改写-渲染闭环 + 收敛逻辑 + 保留最高分 + 分数轨迹报告（4 项离线测试通过） |
| **P3a** | ✅ 已完成 | `resume_diff.py`：改写 diff 高亮，逐字段展示每轮改了什么、新增内容标注核对（4 项离线测试通过，已接入报告） |
| **P3b** | ✅ 已完成 | `brand.py`（brand.md 兜底接入）+ `questionnaire.py`（从零引导问卷）+ 真机冒烟（Ollama gemma4，7 项离线测试通过） |
| **P4** | ✅ 已完成 | 适配层扩展 volunteer/certificates + 确定性 metrics 派生 + improver 可配置严格度 `strict_highlights`（5 项离线测试通过） |
| **P5a** | ✅ 已完成 | 补全 publications/languages 映射（JSON Resume 主要字段全覆盖）+ `resume_agent/README.md` 独立上手文档 |
| **评审修复** | ✅ 已完成 | 按 Codex 跨模型评审修真 bug：brand 接入、`safe_url` 防注入、新数字默认回退、best gaps 一致、根类型守卫、chat 异常处理；并诚实下修过度声明（30 项离线测试通过） |
| **P5b** | ✅ 已完成 | 通用递归 diff（全字段，`resume_diff.diff_json`）+ 多语言文案表（en/ko 正文真正本地化，`kami_adapter.LABELS`） |
| **P6** | ✅ 已完成 | patch-only 反造假架构（`patcher.py`）：模型只返回受限 patch，结构字段无路径可改，**结构造假物理不可能**；编排器 `--mode patch` 可选 |
| **第二轮评审修复** | ✅ 已完成 | 按 Codex 复核修 patch 模式三个真漏洞（None 字段绕过白名单、`work[00]` 索引别名、非 dict 补丁崩溃）+ 补丁文本净化 + 畸形输入容错 + 通用 diff 改用 MISSING 哨兵/类型感知 + diff 报告防伪造（48 项测试通过） |
| **P7a** | ✅ 已完成 | 输入形状校验 `validate.py`：管线入口（`run` / `render_html`）对畸形 JSON Resume fail-fast，可读报错，替代各处零散兜底（57 项测试通过） |
| **P7c** | ✅ 已完成 | 可插拔评分 rubric（`rubrics.py` + `evaluate.py`）：评估不再写死「软件工程实习生」。内置 ENGINEER / DESIGNER 两套维度，岗位专属事实缺口（设计师看作品集/量化，而非开源）。`--role designer` 真机验证（67 项测试通过） |
| **第三轮评审修复** | ✅ 已完成 | 按 Codex 复核：validate 修自身被非 list 击穿 + 补 url/network 字符串校验；evaluate 增**按 rubric 严格校验**（类别键/分数范围/上限/evidence，篡改 max 强制回服务端值）+ **公平性主动删除姓名/院校/城市** + prompt 注入加固（简历标记不可信数据）+ 校验失败重试抗 LLM 抖动（73 项测试通过） |
| **自包含化** | ✅ 已完成 | 收编成单一项目：Kami 简历模板 vendor 进 `assets/templates/`（字体走 CDN 回退）、`llm.py` 自带 Ollama/Gemini provider、所有岗位（含 engineer）走自研 rubric 评估器。切断对两个上游 clone 的运行时依赖；clone 已归档为根目录 `Kami.tar.gz` / `hiring-agent.tar.gz`（不入库）。删除 clone 后 78 项测试 + 渲染 + 真机闭环（designer 103/120）全部正常 |
| **P7b** | 待做（投机性/低 ROI） | LLM 派生 Kami 叙事 section、metrics label 质量、列表稳定 ID 匹配 diff |

> **刻意舍弃**：Codex 建议的「按字段 Counter 数字校验」未采纳——它会把「在新位置复用一个真实
> 数字」误判为造假，引入假阳性回归，得不偿失。当前 set 差集 +「需真实补充」提示 + diff 复核
> 的组合在精度/召回上更平衡。

---

## 八、当前进度（P0 + P1 + P2 已交付）

```
resume_agent/
├── kami_adapter.py        # P0 渲染：JSON Resume -> Kami HTML/PDF（确定性，无需 LLM）
├── improver.py            # P1 改写：整份重写 + 反造假校验 + 缺口报告
├── patcher.py             # P6 改写：patch-only，结构造假物理不可能
├── resume_agent.py        # P2 编排：评估-改写-渲染闭环 + 收敛 + 报告（--mode rewrite/patch）
├── resume_diff.py         # P3a/P5b 通用递归 diff：全字段展示每轮改动
├── validate.py            # P7a 输入形状校验：入口 fail-fast
├── rubrics.py             # P7c 可插拔评分维度（engineer/designer/pm/data/marketing）
├── evaluate.py            # P7c 角色无关 LLM 评估器（resume->文本->按 rubric 评分）
├── llm.py                 # 自包含 LLM provider（Ollama/Gemini -> chat_fn）
├── assets/templates/      # vendor 的 Kami 简历模板（zh/en/ko），渲染自包含
├── brand.py               # P3b brand.md 兜底接入（解析 + 仅填缺失字段 + 派生 role/lang）
├── questionnaire.py       # P3b 从零引导问卷 -> JSON Resume（纯构建器 + 可注入交互）
├── smoke_real.py          # P3b 真机冒烟脚本（Ollama 真实模型跑闭环）
├── sample_resume.json     # 验证用样例
├── test_improver.py       # P1 离线测试（5 项，全过）
├── test_resume_agent.py   # P2 离线测试（4 项，全过）
├── test_resume_diff.py    # P3a 离线测试（4 项，全过）
├── test_p3b.py            # P3b 离线测试（8 项）
├── test_p4.py             # P4/P5b 离线测试（9 项，含 XSS / i18n）
├── test_patcher.py        # P6 离线测试（含「结构造假物理不可能」）
├── test_validate.py       # P7a 离线测试（入口 fail-fast）
└── test_rubrics.py        # P7c 离线测试（设计师维度 / 缺口 / 评估器）
```

测试总计 **75 项**全过（improver 6 / resume_agent 5 / resume_diff 8 / p3b 8 / p4 10 / patcher 12 / validate 11 / rubrics 15）。

### 可插拔 rubric（P7c）

hiring-agent 原评分写死给「软件工程实习生」，对设计师等岗位无意义（会因没 GitHub 给低分、
还建议「补开源」）。P7c 把评分抽象为 rubric：

- `rubrics.py`：每个岗位声明维度（含满分与打分档）、加减分、岗位专属事实缺口检查。内置五套：
  **ENGINEER**（开源/项目/生产/技术）、**DESIGNER**（商业影响/设计功底/流程/广度）、
  **PM**（商业影响/产品感/落地/战略）、**DATA**（技术/业务影响/严谨性/沟通）、
  **MARKETING**（增长转化/渠道/创意/数据驱动）。每套 4 维、满分均 100，+20 bonus = 120，
  `total_score` 与报告 `/120` 全通用；模块 import 时 `_self_check` 校验满分一致与 key 唯一。
  缺口检查共用 `_quant_gap`（量化成果）/`_portfolio_gap`（作品集），按岗位组合。
- `evaluate.py`：角色无关评估器（自带 resume->文本、按 rubric 生成 criteria prompt、解析），
  不依赖 hiring-agent 写死评估器。
- 缺口报告随岗位切换：设计师看「作品集链接 / 量化成果」，工程师看「开源贡献」。
- CLI：`--role {engineer,designer,pm,data,marketing}`。真机验证（gemma4）：同一份设计师简历，
  designer rubric 评 105/120、pm rubric 评 102/120，各自优势与缺口贴合岗位
  且优势全是设计相关、缺口正确指向作品集链接；engineer rubric 则会给出无意义的低分。
- **评估可信度（诚实说明）**：`validate_evaluation` 做了 schema 级加固（类别键必须匹配、分数
  夹到 [0,max]、上限以服务端 rubric 为准不信任模型、evidence 非空、协议错误重试后仍失败则抛），
  公平性字段（姓名/院校/城市）在进模型前就删除。但分数本质仍是**模型的启发式意见**：evidence
  未做「原文摘录回验」，模型可能给偏高分。可作排序/自评参考，**不应作为自动淘汰的唯一依据**。

### P4 增强细节

- **可配置严格度**：`improve(..., strict_highlights=True)` / CLI `--strict-highlights`
  把「净新增成果要点」也判为造假并回退。默认 False（净新增交 diff 标注、人工核对），
  对应真机冒烟里观察到的「模型自行加 bullet」场景，可按需收紧。
- **适配层扩展**：新增 `volunteer`（志愿经历）、`certificates`（证书）section 渲染，
  JSON Resume 主要字段覆盖更全。
- **确定性 metrics 派生**：`derive_metrics` 从 summary / highlights / 项目描述里抽取
  「数字 + 单位」量化项（如 5万 / 60% / 22分），填 Kami 头部数字标签带；强信号
  （>=3 个）才渲染，弱信号省略。label 用「数字所在小句去掉数字」启发式，够用但不完美
  （高质量 label 需 LLM，列入 P5）。

### 真机冒烟结果（Ollama `gemma4:latest`，2 轮）

实跑 `smoke_real.py`，完整闭环在真实模型上验证通过：

- **分数真实提升**：第 1 轮 70 -> 真实改写 -> 第 2 轮 **84 / 120**（+14），逼近目标 85。
- **改写是真改写**：gemma4 把职责 STAR 化、补量化措辞、润色项目描述，diff 逐条可见。
- **反造假在真实输出上生效**：模型自行新增了一条 highlight，diff 准确标注
  `[增]（新增，请核对是否属实）`，交人工核对——印证分层防护：
  - 硬性结构造假（新公司 / 新经历 / 新机构 / 凭空数字）-> improver **拦死并回退**；
  - 软性新增（一条 bullet 的措辞）-> diff **浮出标注**，不静默放行。
- 单轮评估约 55s，2 轮（2 评估 + 1 改写）约 109s。

依赖（评估路径）：`ollama pydantic Jinja2 python-dotenv`；模型用 `--model` 覆盖
（hiring-agent 默认 `gemma3:4b` 未拉取时，任意未知模型名默认路由到 Ollama）。

### 已知限制（诚实清单）

- **patch 模式保证的是「结构完整性」，不是「事实真实性」**（Codex 复核后的精确表述）：
  - `--mode patch`（P6）**能保证**：模型只能改**枚举出的、值为字符串的**现有文本字段
    （精确白名单成员校验，非正则匹配）；公司名/日期/URL/机构/**数组长度**都无路径可改，
    净新增条目、改结构字段、伪造 bullet 数量**物理不可能**；补丁文本去控制字符/折行，
    防单条 highlight 伪装成多条。
  - patch 模式**仍不能保证**：可编辑文本*内部*的事实真实。数字校验是启发式——能拦「原文
    完全没有的数字」，但拦不住「把别处已有的数字搬过来」「复制同一数字」「编造年份」，
    更管不住编造的技术名/客户/职责等非数字事实。最终事实关靠人看 diff + 「需真实补充」提示。
  - `--mode rewrite`（默认）：整份重写 + 启发式校验，灵活但更弱（结构造假靠事后检测而非
    路径禁止）。要最强结构保证用 `--mode patch`。
- diff 已是**通用递归全字段**（P5b）：公司名 / 日期 / URL / 技术栈改动都会摊出。
- 多语言：section 标题与「至今/职责/成果」等已按 zh/en/ko 文案表本地化（P5b）。注意
  **简历内容本身**（用户写的中文 work.summary 等）不会被翻译，只有模板文案本地化。
- metrics label 用启发式（数字所在小句去数字），高质量 label 需 LLM（P7）。

**用法**：

```bash
# 仅渲染：JSON Resume -> HTML（始终可用）/ PDF（需 pip install weasyprint）
python3 resume_agent/kami_adapter.py resume_agent/sample_resume.json -o out.html
python3 resume_agent/kami_adapter.py resume.json --lang en --role "AI Engineer" -o out.html

# 完整闭环：评估 -> 改写 -> 再评估 -> 渲染（需 hiring-agent 配好 Ollama/Gemini）
python3 resume_agent/resume_agent.py resume.json -o out.pdf --target 85 --max-rounds 3

# 跑测试
python3 resume_agent/test_improver.py
python3 resume_agent/test_resume_agent.py
```

**已验证**：

- **P0**：从 `sample_resume.json` 生成含六个 section 的完整 HTML，复用 Kami 全套 CSS，body 内 0 个残留占位符，`role` 正确从 `work[0].position` 派生；无 WeasyPrint 时自动降级 HTML。
- **P1**：合法改写被接受；虚构公司/新增条目被**拦截并回退**；凭空数字标 warn（年份豁免）；开源事实缺口正确识别。
- **P2**：离线闭环分数 51 -> 58 -> 65 逐轮提升，始终保留最高分版本；虚构改写被拒时分数与简历不受污染；报告含分数轨迹 + 需真实补充提示 + 核心优势。

### 设计要点：为什么改写相对安全（及其边界）

改写经过**三道闸**：强约束 prompt + **确定性反造假校验**（比对前后，发现新公司/新项目/
新增条目/原文没有的数字就拒绝并回退，数字默认 error，可用 `--allow-new-numbers` 降级）+
**diff 全摊**给人工复核。这能拦住露骨的结构造假，但**不是密码学级保证**——隐蔽编造
（中文数字、复用旧数字、文本里塞新机构）仍可能漏网，最终防线是人工看 diff。靠真实材料才能
拿的分（如开源贡献）只提示「需真实补充」，绝不自动编造。彻底严密见 P6 的 patch-only 重构。

### 经 Codex 跨模型评审修复（本轮）

用 Codex（gpt-5.5）做了一次独立评审，已修：brand.py 死代码（接进 CLI）、`href` 未限制
scheme（加 `safe_url` 白名单挡 `javascript:`/`data:`）、新数字默认 error 回退、best 版本与
报告 gaps 不一致、`_parse_resume` 根类型守卫、`chat_fn` 异常结构化处理、prompt 删除「补充
隐含技术栈」。并诚实下修了过度声明（见下「已知限制」）。

> 说明：Kami 中文正文字体 TsangerJinKai02 仅限个人使用，商用需向 tsanger.cn 申请授权。
