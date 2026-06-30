# Resume Agent

「生成 × 评估」闭环的简历 agent（**自包含单一项目**，运行时不依赖外部 clone）：

```
问卷/PDF -> JSON Resume -> 评分 -> 事实约束改写 -> 再评分 -> Kami 风格渲染 PDF
                            ▲__________________________|
                              loop until 达标 / 收敛
```

核心理念：把招聘方的评分标准反过来当作求职者的优化目标，**全程不造假**——改写只重述已有事实，
靠真实材料才能拿的分（如作品集/开源）只提示「需真实补充」。

> 起源：把 [Kami](https://github.com/tw93/Kami)（排版）与
> [hiring-agent](https://github.com/interviewstreet/hiring-agent)（评分）组合而来；现已把所需部分
> （Kami 模板 vendor 进 `assets/`、评分用自研可插拔 rubric、LLM provider 见 `llm.py`）收进本项目，
> 两个上游 clone 已归档为根目录 `*.tar.gz`，运行时不再需要。
>
> **自包含范围**：代码与模板自包含。**字体不打包**（TsangerJinKai02 等商用受限），模板 @font-face
> 走 jsDelivr CDN——联网渲染得到 Kami 衬线；离线则回退系统字体（版式在、字形换成系统默认）。

完整设计见上级目录 [`../DESIGN.md`](../DESIGN.md)。

## 模块

| 文件 | 职责 |
|------|------|
| `kami_adapter.py` | JSON Resume -> Kami HTML/PDF（确定性，无需 LLM）。覆盖 basics/work/volunteer/projects/skills/certificates/publications/awards/languages/education + 头部 metrics 派生 |
| `improver.py` | 改写模式 A：整份重写 + 确定性反造假校验 + 缺口报告。可配 `strict_highlights/strict_numbers` |
| `patcher.py` | 改写模式 B（P6）：模型只返回受限 patch，结构字段无路径可改，**结构造假物理不可能** |
| `resume_diff.py` | 通用递归 diff：全字段展示每轮改动，新增内容标注「请核对」 |
| `validate.py` | 输入形状校验：管线入口对畸形 JSON Resume fail-fast |
| `rubrics.py` | 可插拔评分维度：engineer / designer / pm / data / marketing（每岗位 4 维、满分 100） |
| `evaluate.py` | 角色无关 LLM 评估器：按 rubric 评分 + 严格校验 + 公平性脱敏 |
| `ingest.py` | PDF 简历 -> JSON Resume（PyMuPDF 抽文本 + LLM 结构化 + 校验），补全闭环入口 |
| `llm.py` | 自包含 LLM provider：Ollama / Gemini -> 统一 chat_fn |
| `assets/templates/` | vendor 进来的 Kami 简历模板（zh/en/ko），渲染自包含 |
| `resume_agent.py` | 闭环编排：评估-改写-渲染 + 收敛 + 保留最高分 + 报告 |
| `brand.py` | `~/.config/kami/brand.md` 兜底接入（仅填缺失字段） |
| `questionnaire.py` | 从零引导问卷 -> JSON Resume |
| `smoke_real.py` | 真机冒烟（接 Ollama 真实模型） |

## 快速上手

### 1. 仅渲染（无需 LLM）

```bash
python3 kami_adapter.py sample_resume.json -o out.html         # HTML 始终可用
python3 kami_adapter.py sample_resume.json -o out.pdf          # PDF 需 pip install weasyprint
python3 kami_adapter.py resume.json --lang en --role "AI Engineer" -o out.html
```

### 2. 准备 JSON Resume（三选一）

```bash
python3 ingest.py resume.pdf -o resume.json --model gemma4:latest  # 从 PDF 自动结构化（需 pymupdf）
python3 questionnaire.py -o resume.json                            # 从零交互问答
# 或直接手写 resume.json（JSON Resume 格式）
```

### 3. 完整闭环（需 LLM）

依赖（评估路径）：`pip install ollama pydantic Jinja2 python-dotenv`，并装好 Ollama 或配 Gemini。

```bash
# 默认模型 gemma3:4b（llm.py）；本机已有别的模型用 --model 覆盖，或设 OLLAMA_MODEL
python3 resume_agent.py resume.json -o out.pdf --target 85 --max-rounds 3
python3 resume_agent.py resume.json --role designer          # 评分岗位：engineer(默认)/designer/pm/data/marketing
python3 resume_agent.py resume.json --mode patch             # P6：结构造假物理不可能（更严）
python3 resume_agent.py resume.json --strict-highlights      # rewrite 模式收紧净新增要点
python3 resume_agent.py resume.json --allow-new-numbers      # 放宽：新数字仅 warn
```

### 4. 真机冒烟

```bash
python3 smoke_real.py --model gemma4:latest --rounds 2
```

## 测试

```bash
for t in test_improver test_resume_agent test_resume_diff test_p3b test_p4 test_patcher test_validate test_rubrics test_llm test_ingest; do python3 $t.py; done
```

全部为离线测试（注入假 LLM），共 91 项，无需真实模型即可验证逻辑。

## 红线：事实诚信（两种模式）

- **`--mode rewrite`（默认）三层防护**：① 强约束 prompt；② 确定性校验（新公司/新经历/新条目、
  原文没有的数字 -> 拦死回退，数字默认 error）；③ 通用递归 diff 摊给人工复核。
  *边界*：启发式安全网，拦不住中文数字「百万」、复用旧数字、文本塞新机构等隐蔽编造。
- **`--mode patch`（P6）结构保证**：模型只能改枚举出的现有字符串字段（精确白名单），结构字段
  （公司/日期/URL/**数组长度**）没有 patch 路径 -> 结构造假**物理不可能**。但这保证的是**结构
  完整性，不是事实真实性**：可编辑文本内部仍可能复用别处数字、编年份、编非数字事实，最终靠人看 diff。

## 字段映射 & 已知限制

- JSON Resume -> Kami 字段对照表见 `../DESIGN.md` 第四节。
- **多语言**：section 标题与「至今/职责/成果」按 zh/en/ko 文案表本地化（P5b）。但**简历内容本身**
  （用户写的中文正文）不翻译，仅模板文案本地化。
- **diff** 已是通用递归全字段，公司/日期/URL/技术栈改动都会摊出。
- Kami 叙事 section（影响力/AI 判断）暂不自动生成；metrics label 启发式，高质量需 LLM（P7）。
