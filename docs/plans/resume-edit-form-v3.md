# 方案:编辑简历表单 v3(参考稿五图分析)

> 目标:左栏「编辑简历」从纯文本输入升级为参考稿形态——分节手风琴 + 条目卡 CRUD +
> 迷你富文本(B/I/列表 + 字数上限)+ **字段级 AI 润色/AI 生成**。
> 底座不变:编辑实时写 store → 中栏预览/autosave/undo 既有管线;诚实口径贯穿(见 §五)。

## 一 参考稿逐图分析

**图1 基础信息 + 教育经历(实例)**
- 头像上传位(占位框 + 「上传头像 ✎」)。
- 必填带红星:姓名* / 性别*(下拉)/ 生日*(年月选择,含红框错误态「请选择出生年月」)。
- 选填:电话 / 微信 / 邮箱 / 籍贯(城市下拉)/ **自定义标签**(输入后回车添加 chip)。
- 教育条目:条目头(学校名 + 🗑 删除)→ 学校 / 学历(下拉)/ **学制**(全日制/非全日制,下拉)/
  专业 / 时间(开始月-结束月,年月选择器)→ **富文本**(工具栏 B I U | • 1. + AI润色 + AI生成;
  计数 115/1000)。内容含加粗强调。

**图2 教育空条目 + 新增 + 工作经历**
- 空条目占位文案齐备;绿色「⊕ 新增教育经历」。
- 工作经历字段:公司名称 / 工作时间(开始-结束月)/ 岗位名称 / 富文本(319/1000),
  内容形态:加粗小标题 + 加粗导语的 bullet;「⊕ 新增工作经历」。

**图3、4 项目经历(两个实例)**
- 字段:项目名称 / 担任角色 / 项目时间 / 富文本(STAR 结构,行动与成果用二级列表);
  每条可删,「⊕ 新增项目经历」。

**图5 个人优势 + 掌握技能**
- 两节均为**纯富文本**(无结构化子字段),各带 AI润色/AI生成,1000 字上限。
- 掌握技能形态:分组小标题 + bullet,关键词加粗。

**交互模式盘点**:分节可收起 · 条目卡(头部删除)· ⊕ 新增 · 必填校验(红框+错误文案)
· 年月选择器 · tag 输入 · 富文本工具栏 + 字数计数 · 字段级 AI 双按钮。

## 二 信息架构与字段清单

节顺序:基础信息 → 教育经历(多条)→ 工作经历(多条)→ 项目经历(多条)→ 个人优势 → 掌握技能。

### 基础信息(basics)
| 字段 | 控件 | 必填 | 校验/说明 | 存储 |
|---|---|---|---|---|
| 姓名 | Input | **是** | 非空 | basics.name |
| 性别 | Select(男/女/不填) | 选填(§六决策2) | 枚举 male/female | basics.gender(新) |
| 生日 | 年月控件(见 §四.4) | 选填 | YYYY-MM,不晚于当前 | basics.birthMonth(新) |
| 电话 | Input | 联系方式至少一项 | 宽校验(数字/+/-/空格) | basics.phone |
| 微信 | Input | 〃 | 非空即可 | basics.wechat(新) |
| 邮箱 | Input | 〃 | email 格式 | basics.email |
| 籍贯 | Input(自由输入,城市联想后置) | 否 | ≤20 字 | basics.hometown(新) |
| 个人站/作品集 | Input | 否 | **现有字段保留,防功能回归**(参考稿无此项,渲染照旧) | basics.url |
| 自定义标签 | tag 输入(回车添加/可删,上限 8) | 否 | 单枚 ≤12 字 | basics.tags: string[](新) |

头像:**不在本方案范围**(涉及文件上传/存储/裁剪/生命周期,另立方案;ats/classic 模板本也不渲染)。

### 教育经历(education[],多条,可删可增)
| 字段 | 控件 | 必填 | 说明 | 存储 |
|---|---|---|---|---|
| 学校 | Input | 条目内必填 | — | institution |
| 学历 | Select(博士/硕士/本科/大专/其他) | 条目内必填 | 旧值不在枚举 → 追加「(原值)」选项保留 | studyType |
| 学制 | Select(全日制/非全日制/不填) | 否 | — | studyMode(新) |
| 专业 | Input | 否 | — | area |
| 时间 | 年月 ×2(§四.4) | 否 | start ≤ end;end 可「至今」 | startDate/endDate |
| 描述 | **富文本** ≤1000 | 否 | 课程/成绩/论文/奖项 | description(新,md) |

### 工作经历(work[],多条)
| 字段 | 控件 | 必填 | 说明 | 存储 |
|---|---|---|---|---|
| 公司名称 | Input | 条目内必填 | — | name |
| 工作时间 | 年月 ×2 | 否 | end 支持「至今」 | startDate/endDate |
| 岗位名称 | Input | 否 | — | position |
| 描述 | **富文本** ≤1000 | 否 | 加粗导语 bullet 形态 | description(新,md) |

### 项目经历(projects[],多条)
| 字段 | 控件 | 必填 | 说明 | 存储 |
|---|---|---|---|---|
| 项目名称 | Input | 条目内必填 | — | name |
| 担任角色 | Input | 否 | — | role(新) |
| 项目时间 | 年月 ×2 | 否 | — | startDate/endDate(新) |
| 描述 | **富文本** ≤1000 | 否 | STAR 模板形态 | description(md 化) |
| 链接 | Input | 否 | 现有字段保留 | url |

### 个人优势 / 掌握技能
| 节 | 控件 | 存储 |
|---|---|---|
| 个人优势 | 富文本 ≤1000 | basics.summary(md 化) |
| 掌握技能 | 富文本 ≤1000 | skills_md(新,顶层);旧 skills[] 只读兼容 |

### 扩展模块系统(「添加模块」,参考稿二批四图)

**参考稿分析**:表单末尾常驻「添加模块」面板(两列卡片网格,模块名 + ⊕);点击即把该
模块加入表单;**已添加的模块从面板消失**(二批图4:添加过求职意向/学生会/荣誉/证书后,
面板只剩 6 张卡),**自定义模块例外——可多实例,永驻面板**(图4 中仍在)。
添加后的模块形态(图2/3):求职意向=岗位 tag 输入+城市;学生会/社团=名称/角色/时间×2/
富文本;荣誉、证书=空态仅「⊕ 新增 XX」;自定义模块=标题(5/10 计数)+富文本。

**机制(零 schema 迁移)**:模块数据直接存于 resume JSON。
- 「添加」=初始化该字段(空数组/空对象)、写入顺序表并滚动聚焦。
- **顺序持久化**:顶层 `modules_order: string[]`(已启用扩展模块 key 的有序表;
  自定义模块条目以 `custom:<id>` 入序)。缺失时(旧数据)按「存在即启用」+默认顺序推导。
- 「已添加」判定=字段存在;**复用现有字段的模块(volunteer/certificates/awards)在旧数据
  非空时自动视为已添加**(显示节、面板卡隐藏),避免两套数据并存。
- 「移除」=扩展模块节标题右侧 🗑(confirm「移除将删除该模块内容」):普通模块删字段
  +移出 order;**自定义模块按条目 id 删该实例**(数组空则删字段)。固定六节不可移除。

**模块清单与字段**(带 † 者参考稿未展开字段,为本方案定义):

| 模块 | 实例 | 字段 | 存储 |
|---|---|---|---|
| 求职意向 | 单 | 求职岗位(tag 输入,回车添加,≤5 枚 ≤20 字)、求职城市(自由输入 ≤20 字) | job_intent{ positions[], city }(新) |
| 实习经历 | 多 | 公司/时间×2/岗位/富文本 ≤1000 | internships[](新,同 work 形) |
| 学生会/社团经历 | 多 | 社团名称*/担任角色/参与时间×2/富文本 ≤1000 | organizations[]{ name, role, startDate, endDate, description }(新) |
| 所获荣誉 † | 多 | 荣誉名称*/颁发方/获得时间/一句话说明 ≤100 | **awards[](复用现有 title/awarder/date/summary,不另设 honors——否则旧 awards 与新荣誉两套数据、双渲染节)** |
| 志愿者活动 | 多 | 组织*/角色/时间×2/富文本 ≤1000 | **volunteer[](现有契约 organization/position/summary/highlights,新增 description;新旧优先级同 work)** |
| 校园大使 † | 多 | 主办方·品牌*/时间×2/富文本 ≤1000 | campus[]{ name, startDate, endDate, description }(新) |
| 毕业设计/毕业论文 † | 多 | 课题名*/时间/富文本 ≤1000 | thesis[]{ title, date, description }(新) |
| 学术竞赛 † | 多 | 竞赛名称*/所获奖项/时间/富文本 ≤1000 | competitions[]{ name, award, date, description }(新) |
| 资格证书 | 多 | 证书名称*/取得时间 | certificates[](沿用现有字段,kami 已渲染) |
| 自定义模块 | **多** | 模块标题* ≤10/富文本 ≤1000 | custom_sections[]{ id, title, content }(新) |

**下游规则**(并入 §3.2/§3.3 同框架):
- 评分/匹配语料:经历类模块(实习/社团/志愿者/校园大使/毕设/竞赛/荣誉/证书)内容
  剥标记拼入;**job_intent 整体不拼**——意向不是能力证据,拼入会让「想做 X」被引用为
  「具备 X 经验」虚增评分/覆盖(positions 仅作 detect-role 辅助提示与渲染);
  **custom_sections 不拼**——标题与内容全自由,用户可造「个人信息」节重新传入
  年龄/性别/地域,与 tags 同属 §3.2.1 公平性边界。
- editable_paths(全局改写)与字段级「AI润色」:**仅开放剥空白后 ≥10 字的 md 字段**——
  空/近空字段交给改写模型等于开凭空生成入口(空白被"润色"成具体经历,绕过红线);
  空字段仅「AI生成」(模板/提取)可用,「AI润色」禁用。
- `/api/polish-field` 与 `/api/generate-field` 的 kind 枚举扩展:`internship`(同 work
  的 STAR)、`activity`(社团/志愿者/校园大使共用:背景/职责/行动/成果)、`thesis`
  (课题背景/方法/结论/成果)、`competition`(赛事/任务/方案/名次)、`custom`
  (通用段落骨架)。荣誉/证书为单行字段,不挂 AI 按钮。entry_context=该条目结构化字段。
- 渲染顺序:求职意向紧随头部 → 固定节(教育/工作/实习/项目)→ 其余扩展模块按
  modules_order → 自定义模块 → 个人优势/技能;行格式类推(名称 · 角色 — 起止;
  荣誉/证书 = 名称 — 时间 · 说明)。
- 校验(_check_new_fields 扩展):**后端只管形状/类型/长度/枚举,不管必填**——星号必填
  由 validateResumeForm 前端提示(与核心节同语义;后端管必填会让新增空条目在填写期间
  无法 autosave)。**新引入数组** ≤20 条;**volunteer/certificates/awards 维持现有 200
  上限不变**(改小会让超限旧记录保存 400,重蹈超长旧字段覆辙);job_intent.positions ≤5。
- **modules_order 校验与规范化**:后端校验其为字符串数组、每项为已知模块 key 或
  `custom:<id>` 格式、无重复项,`custom:<id>` 必须引用 custom_sections 中存在且唯一的
  id(custom_sections 各条 id 也须唯一),违者 400。前端载入时规范化:字段存在但缺序 →
  按默认顺序追加;order 含未知/失引项 → 剔除;规范化结果随下次保存写回。
- ats 模板:扩展模块正常渲染(不属隐私字段);求职城市在 ats 下保留(投递用途正当,
  区别于籍贯)。

### 富文本子集(全部描述字段统一)
- 语法:**加粗**、*斜体*、无序/有序列表(最多两级)。**砍掉下划线 U**(§六决策1)。
- 存储为受限 Markdown;编辑器所见即所得,序列化仅覆盖上述子集;粘贴一律纯文本化。
  **转义边界唯一在渲染输出层**(§3.4):存储层保存用户字面文本(`<>&` 原样),
  序列化/导入**不做**预转义——否则渲染层再转义会产生 `&amp;amp;` 双重编码。
- 字数按**纯文本**字符计,上限 1000;后端对 md 源码长度另设 4000 上限(冗余防滥)。

## 三 数据模型、下游接入与兼容

### 3.1 新字段与后端校验(事实更正:validate_resume 现为结构性校验,并非字段白名单)
- 新字段:basics.gender/birthMonth/wechat/hometown/tags、education.studyMode/description、
  work.description、projects.role/startDate/endDate、顶层 skills_md。全部可空,老数据零迁移。
- 后端新增 `check_resume(data) = validate_resume(data) + _check_new_fields(data)` 作为
  **统一入口**,替换所有直接调用 validate_resume 的端点(持久化 create/update **以及**
  evaluate/match/improve/apply/render/validate)——只挂持久化会让非法新字段从其他入口进入。
- `_check_new_fields` 规则:gender ∈ {male,female};birthMonth 匹配 `^\d{4}-(0[1-9]|1[0-2])$`
  (月份 01–12)且不晚于当前;tags 为 str 数组、≤8 枚、每枚 ≤12 字;hometown ≤20 字;
  studyMode ∈ {full_time,part_time};日期字段 str ≤20(宽,兼容「至今」/旧自由文本;
  仅当值匹配年月格式时校验月份合法,自由文本放行);**仅新增字段**(description/skills_md/
  role 等)设 20000 宽上限——**不对既有字段(summary/projects.description)新增长度限制**,
  否则超长旧记录任何无关字段的自动保存都会 400,与零迁移冲突。1000 字为前端编辑约束。
  日期 start ≤ end 由前端 validateResumeForm 负责(双方均为年月格式时比较;后端不强制,
  因旧自由文本无法统一比较)。非法 → 400 BAD_RESUME,不落脏。
  测试:每条规则一个 400 用例 + 合法全字段 roundtrip + 超长旧 summary 记录保存不 400。

### 3.2 下游接入点清单(事实更正:引擎/渲染不会"自然可读",需逐点接入)
**统一读取优先级(所有下游同一规则,防重复评分与无效改写)**:
`work[i].description 存在 → 该条目只读 description,忽略 summary/highlights;不存在 → 回退旧字段`;
`skills_md 存在 → 只读 skills_md,忽略 skills[]`。适用于 resume_to_text、rubrics 证据、
jd_match、渲染(前端与 kami)、以及 **patcher.editable_paths(动态)**:有 description 的
条目只开放 `description` 路径(不再开放 summary/highlights——改了也不会被渲染,属无效改写);
无 description 才开放旧路径。测试:同一条目新旧字段并存时,评分文本/渲染输出/可改写路径
均只含新字段内容。

E1 必须逐一改造并带测试,缺一即为旧字段盲区:
1. `evaluate.resume_to_text`(评分喂文本):拼入 work/education 的 description(md 剥标记后的
   纯文本)与 skills_md;**gender/birthMonth/hometown/tags 一律不拼**——前三者是引擎既有
   公平性边界(年龄/性别/地域不参与评分),tags 为自由文本,若拼入等于给用户开了
   绕过该边界的后门(填「95后」「女性」即穿透)。tags 仅用于渲染展示。
2. `rubrics` 证据抽取(`_impact_texts` 等读 highlights/summary 处):增读 description 纯文本。
3. `jd_match` 简历文本化路径:同上拼入新字段。
4. `improver/patcher.editable_paths`:允许 `work[i].description`、`projects[i].description`、
   `education[i].description`、`basics.summary`、`skills_md` 作为可改写路径;
   **`_clean_patch_text` 按路径区分**:md 字段仅 trim 首尾、保留换行(现逻辑折叠换行会
   毁列表结构);非 md 字段维持现折叠。测试:md 字段润色后列表行数不变。
5. `kami_adapter` 渲染(/api/render,**Python 侧,没有 marked 也不引第三方 md 库**):
   自写 `md_lite_to_html()`(~40 行):仅解析本方案受限子集(加粗/斜体/两级列表/段落),
   文本节点一律 HTML 转义输出——受限子集手写解析可行、零依赖、零原始 HTML 通路。
   description/skills_md 有则经它渲染,无则走旧 summary/highlights/skills[]。
6. 前端 `resumeToMarkdown`:见 §3.3。

### 3.3 渲染映射(完整枚举)
- 头部:姓名;次行(有则渲染,`·` 相隔):性别(男/女)· 生日(YYYY.MM)· 籍贯;
  联系行:电话 · 邮箱 · 微信 · url;tags 行:`#标签` 空格相隔。
- **接口契约(配合 §3.4 信任分离,头部数据不走 md)**:现 resumeToMarkdown 拆为两个纯函数:
  `resumeHeaderData(resume, { privacyMinimal }) → { name, subline, contacts[], tags[] }` 与
  `resumeBodyMd(resume) → string`(仅用户内容 md);
  `markdownToDoc(bodyMd, headerData, layout)` 在模板层把 headerData **转义插值**拼头部 HTML;
  kami 侧 `md_lite` 同样接 headerData。`privacyMinimal = layout.templateId === "ats"`
  (仅渲染姓名+电话+邮箱+url)。
  调用点全部更新:PreviewCanvas 防抖重渲、printApi fresh 计算、onFrameLoad 对照、
  Dashboard 缩略图——**fresh 新鲜度比较逻辑不变**(比较对象仍是 markdownToDoc 的最终
  输出字符串,输入变为 bodyMd+headerData 不影响该机制)。
- 教育行:学校 — 学历(· 全日制/非全日制)· 专业 — 起止;description md 块直插。
- 工作行:岗位 · 公司 — 起止;description 有则 md 直插,无则旧 summary+highlights。
- 项目行:名称 · 角色 — 起止;description md 直插;url 照旧。
- 技能:skills_md 有则 md 直插;无则旧 skills[] 结构化渲染。

### 3.4 Markdown 渲染安全(事实更正:marked 默认放行原始 HTML,现无 sanitizer)
前提是**信任分离**——现状 resumeToMarkdown 会输出原始 HTML 头部块(`<header class="cv-head">`),
一刀切禁 html token 会连可信头部一起吞掉。E1 改为:
0. **系统模板与用户内容分离**:resumeToMarkdown 只产**用户内容 md**(不再内嵌原始 HTML);
   头部(姓名/次行/联系行/tags 行)由 markdownToDoc / md_lite 模板代码直接拼 HTML
   (可信路径,数据经转义插值)。§八 E1 验收「旧记录渲染 diff=0」相应改为
   「**内容与视觉等价**」(头部 DOM 结构允许微调,文本内容逐字段一致)。
1. **渲染层禁原始 HTML(仅用户内容)**:markdownToDoc 的 marked 配置 `renderer.html = () => ""`;
   kami 的 md_lite 天然无原始 HTML 通路。iframe 继续不开 allow-scripts(纵深)。
2. **转义边界唯一在渲染输出层**:存储/编辑/导入层保存用户字面文本(不预转义,防双重
   编码 `&amp;amp;`);marked 路径由 renderer.html 吞 html token + marked 自身文本转义,
   md_lite 与头部插值处各自转义一次——每条输出路径恰好一次转义。
测试:含 `<img onerror>`/`<style>` 的 description 渲染后无该元素;头部正常渲染;
`A & B < C` 存储原样、渲染显示原文且源码为正确单次实体;正常 md 功能不受损。

### 3.5 旧数据兼容(读时合成、写时升级,不批量迁移)
- **work**:编辑器打开时无 description → 由 summary+highlights 合成 md 初值(段落+列表);
  此后只写 description(summary/highlights 保留原值不再编辑;渲染优先 description)。
- **skills**:无 skills_md → 由 skills[] 合成 md 初值(`**name**:keywords` 列表);同上。
- **日期**:控件优先组件库 `MonthPicker`(年月网格,见 §四.4) + 「至今」勾选;**现值非 `YYYY-MM` 且非空
  (如「2023」「至今」「2018.10」)时该输入框回退为文本 Input**(旧值原样可见可改,
  不静默丢失);可解析变体(`2018.10`/`2018/10`)载入时规范化为 `2018-10`。
- **studyType**:旧值不在枚举 → Select 动态追加「旧值」选项,不丢不改。
- 测试:含上述各形态旧数据的记录打开→不丢值;渲染回归(旧记录渲染输出与升级前一致)。

## 四 操作方案(交互规范)

1. **分节手风琴**:六节默认全开,节标题右侧 ^ 收起,收起态只显标题。
2. **条目卡 CRUD**:条目头显主字段摘要 + 🗑(confirm);底部「⊕ 新增 XX」;新条目默认
   展开、聚焦首字段;**条目用编辑期稳定 id(创建时生成,不用数组下标作 key)**,
   删除中间条目不错位。排序拖拽列二期。
3. **必填校验(共享纯函数)**:`lib/validateResumeForm.ts` 导出
   `validateResumeForm(resume): { path, sectionKey, msg }[]`(姓名非空、联系方式至少一项、
   条目内必填项、**日期顺序 start ≤ end——仅当两端均为年月格式时比较**)。
   表单失焦渲染红框+红文案;**EditorPage 在「诊断」与「下载」动作前调用同一函数**,
   有错则顶栏下黄条列缺项、点击滚动到对应节(store.resume 即唯一真相,
   无需新增跨组件状态)。校验不阻断 autosave(草稿照存)。
4. **年月控件**:组件库 `MonthPicker`(`components/ui/month-picker.tsx`)——shadcn `Popover`
   (Radix primitive,入库 `components/ui/popover.tsx`)+ shadcn 风格「年份步进 + 12 宫格月份」
   网格;触发器为无边框字段单元(显示「YYYY年MM月」,空态占位),存储恒 `YYYY-MM`。
   结束月「至今」勾选(存字面「至今」,渲染照旧);旧值不可解析时**该控件内部**回退文本 Input
   (§3.5,不静默丢值)。无障碍:方向键在 12 格间移焦、`aria-pressed`/`aria-label`、聚焦环;
   选中即回填并关弹层。**简历为年月粒度,不引 `react-day-picker`(日粒度,用不上则为死依赖);
   仅新增 `@radix-ui/react-popover` 一个依赖。**
   ~~原生 `<input type="month">`~~:E2a 曾用,因原生 picker 指示器被样式藏掉、装饰图标
   `pointer-events-none` 不可点而无法唤起,已废弃,改用上述组件库方案。
5. **标签输入**:回车/逗号添加 chip,退格删末枚,上限 8。
6. **富文本工具栏**:B / I / •列表 / 1.列表 + 「AI润色」「AI生成」绿色胶囊;右下角字数 N/1000。
7. **联动保留**:字段聚焦 → setLinkQuery;编辑实时写 store(clone+bump),
   预览/autosave/undo 管线零改动。
8. **添加模块面板**:表单末尾常驻「添加模块」标题 + 两列卡片网格(模块名 + ⊕);
   点击 → 初始化字段 + 新节滚动入视野并聚焦首控件;已添加模块的卡片隐藏
   (自定义模块永驻,可多实例);扩展模块节标题右侧 🗑 移除(confirm,删字段连内容)。

### 4.8 字段级 AI 润色(新端点)
- `POST /api/polish-field { text, kind, jd? }` → `{ md, new_terms: string[] }`;
  kind 枚举(与 generate-field 同一集合):`work|project|edu|summary|skills|internship|activity|thesis|competition|custom`。
  **text 剥空白后 <10 字 → 400**(前端按钮同步禁用,防空字段被"润色"成凭空经历)。
- 服务端约束(**如实声明能力边界,不称"同一套 grounding"**):
  a) prompt 硬约束「仅重述,禁新增事实」;b) 确定性校验:输出中出现输入没有的**数字**
  → 拒绝重试/失败;长度膨胀 >1.5× → 拒绝;c) **新词提示(尽力而为,不宣称完备)**:
  分词对比,输出中新出现的英文 token/连续 2+ 字中文词列入 `new_terms`。
- 前端:原文/润色后上下对照;`new_terms` 高亮并提示「这些表述是新出现的,请核实是否
  属实」;「采纳/放弃」,绝不自动替换。话术:「按仅重述规则生成,请核实」。
- **采纳竞态(语境戳)**:发起时记 `{resumeId, loadSeq, entryId(条目稳定 id,§四.2),
  fieldValue}`;采纳时按 **entryId 定位条目**(不用数组下标——请求期间删除条目会使
  下标移位、写错另一条),条目不存在或四者任一变 → 拒绝写入并提示「字段已变化,
  请重新润色」。基础信息/个人优势/技能等单例字段 entryId 取固定字段名。

### 4.9 字段级 AI 生成(契约,红线处理见 §五)
- `POST /api/generate-field { kind, source_text?, entry_context }`(entry_context=该条目已填
  的结构化字段:公司/岗位/时间/项目名/角色/学校/专业)→
  `{ mode: "extract"|"template", md }`。
- **extract(有 source_text)**:抽取原件中与本节相关内容整理为 md;**逐句双门槛出处校验**
  (0.6 相似度适合「证据判断」但不足以支撑「有出处地写入简历」——六成重合可掺四成编造):
  每句须同时满足 a) 与 source_text 的 bigram 重合 **≥0.8** 或为原件精确子串;
  b) **无新增内容**——句中不得出现原件没有的数字、英文 token 或连续 2+ 字中文新词
  (与 4.8 new_terms 同一检测,此处不是提示而是丢弃)。不达标句服务端丢弃;
  全部丢弃 → 400「原件中未找到相关内容」。宁可提取不出,不掺半句假。
- **template(无 source_text)**:按 kind 返回**纯骨架**(占位符不含任何具体事实):
  work/project/internship=STAR(背景/任务/行动/成果);edu=主修课程/成绩排名/论文/奖项;
  summary=专业定位/核心证据/求职意向;skills=分组小标题+条目占位;
  activity(社团/志愿者/校园大使)=背景/职责/行动/成果;thesis=课题背景/方法/结论/成果;
  competition=赛事/任务/方案/名次;custom=通用段落骨架。
- 前端同 4.8 对照采纳 + 语境戳;首次点击一次性说明:「生成的是结构模板/原件提取,
  不会替你编造经历」。

## 五 诚实口径(硬约束,沿用项目立场)

- 「AI生成」**绝不**根据岗位名/公司名虚构经历——[[resume-agent-scope-exclusions]] 的直接
  推论。extract/template 是允许的全部形态。
- 能力边界如实陈述:确定性校验挡得住结构变更与凭空数字,挡不住文本性新实体——
  所以有 `new_terms` 提示 + 「请核实」话术,不宣称「保证不编造」。
- 无任何字段级「涨分」暗示。

## 六 两项与参考稿的有意偏离(产品决策)

1. **下划线 U 不做**:md 无原生支持、ATS 解析差、避免引入内联 HTML。
2. **性别/生日改为选填**(参考稿必填):非必要个人信息不强制;ats 模板不渲染(§3.3)。
   如确认贴国内投递习惯改必填,validateResumeForm 一行可改。

## 七 富文本编辑器设计(E3,自研不引库)

- **真相源**:DOM 为编辑期唯一真相;`onInput` 防抖 300ms 序列化 md → store;
  store→DOM 仅在挂载与 hydrationKey 重挂(undo/采纳/导入走重挂)——与 SectionEditor
  本地草稿模式同基调,无双写冲突。
- **写入原子性**:序列化落 store 走**按条目 id + 字段的原子 patch**(基于最新
  store.resume 克隆仅更新该字段),不整份文档覆盖——多个编辑器的延迟写回互不相扰。
- **同步 flush 契约(消除 300ms 丢失窗口)**:a) 编辑器 `blur` 时立即同步序列化落 store;
  b) 编辑器挂载时向全局注册 `flush()`(卸载注销);EditorPage 在 **保存/下载/诊断/润色/
  切模式/收起左栏** 动作前调用 `flushAllEditors()`——这些动作读到的必是最新内容;
  c) 编辑器卸载时先 flush 再销毁。
- **IME**:compositionstart→compositionend 期间不序列化。
- **撤销两层并存**(与现状一致):编辑器内 ⌘Z = 浏览器原生 contentEditable 撤销;
  文档级快照栈(600ms 分组)照旧,经 hydrationKey 重挂恢复。
- **列表**:仅两级;serialize 遇未知/更深结构 → 该块退化为纯文本行(不丢字)。
- **上限**:`beforeinput` 拦截超限输入;粘贴截断到剩余额度。
- **粘贴**:`paste` 事件取 `text/plain`,按行插入。
- **降级开关**:若 E3 联调发现 contentEditable 风险超预算,同接口退化为
  「Textarea + md 语法 + 工具栏插标记」(序列化器复用),预览由中栏承担。
- 单测:序列化/反序列化 roundtrip(加粗/斜体/两级列表/转义字符)、粘贴纯文本化、上限截断。

## 八 分期与验收

- **E1 数据模型与下游**:§3.1 统一校验入口 + §3.2 六个接入点 + §3.3 渲染映射 +
  §3.4 信任分离与渲染安全 + §3.5 兼容合成。验收:新字段 400 用例(含超长旧 summary
  保存不 400、非法月份 2020-99 被拒);md 字段润色列表结构保留且非 md 路径行为不变;
  `<img onerror>` 不进 DOM 且头部正常;旧记录渲染**内容与视觉等价**(文本逐字段一致);
  ats 模板隐私字段不出现;resume_to_text 含 description/skills_md 且**不含
  gender/birthMonth/hometown/tags**;非持久化端点(evaluate 等)对非法新字段同样 400。
- **E2 表单重构**:分节手风琴 + 条目 CRUD(稳定 id)+ validateResumeForm(失焦红框 +
  日期顺序 + 诊断/下载前黄条)+ 年月/至今/回退控件 + 标签输入 + **扩展模块系统**
  (添加模块面板/去重隐藏/自定义多实例/移除)(描述字段暂用 Textarea)。
  验收:增删改各节条目→预览/autosave/undo 正确;旧日期形态可见可改;黄条点击滚动到位;
  删除中间条目后其余条目内容/焦点不错位;添加模块后面板卡片消失、移除后恢复;
  自定义模块可加两个;**渲染断言**:job_intent(含城市)与 custom_sections 正常渲染;
  **语料断言**:评分/匹配文本含经历类模块内容、且完全不含 job_intent 与 custom_sections。
- **E3 迷你富文本**:§七。验收:§七单测 + 真机中文 IME 输入/粘贴/超限;
  **flush 契约**:编辑后 300ms 内立即点下载/诊断/切模式,读到的是最新内容;
  两个编辑器交替快速编辑互不覆盖。
- **E4 字段级 AI 润色**:/api/polish-field + 对照采纳 UI + 语境戳(含 entryId)。
  验收:数字新增被拒;new_terms 高亮;字段变更/条目删除后采纳被拒;列表结构保留;
  **<10 字请求 400 且前端按钮禁用**;十类 kind 各返回有效结果。
- **E5 AI 生成**:/api/generate-field(extract 双门槛 / template **十类 kind 骨架集**,见 §4.9)。
  验收:bigram<0.8 或含新词/新数字的句子被丢弃;全丢返回 400 提示;
  无 source 返回对应 kind 骨架;骨架不含事实性内容。

每期照惯例:构建 + 真机验证 + codex 复核 + 提交。

## 九 风险

- 富文本序列化边界——E3 单测覆盖;失败退化纯文本不丢字;另有 Textarea 降级开关。
- marked 渲染继续保持 iframe 无 allow-scripts,叠加 §3.4 双层防线。
- 旧数据兼容靠「读时合成、写时升级」,不批量迁移,可回滚。
- `_clean_patch_text` 按路径分流是全局润色共用逻辑的行为变更——E1 单测覆盖非 md 路径
  行为不变。


<!-- codex-peer-reviewed: 2026-07-03T05:42:35Z rounds=8 verdict=approved -->
