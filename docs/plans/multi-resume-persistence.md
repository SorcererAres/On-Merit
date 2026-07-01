# 方案：多简历管理 + 持久化

> 把当前「单会话、内存态」的三阶段流水线，升级为「文档对象型」应用：多份简历可保存、列表管理、版本回滚。
> 参考竞品 JadeAI 的 `dashboard → editor/[id]` + 双库 + revisions 结构（见 COMPETITIVE-JadeAI.md），用我们的 Python/FastAPI 栈自建。

## 〇 已定决策
- **双适配 DB**：仓库抽象 + SQLite / Postgres 两实现。**SQLite 为默认且可测**，Postgres 结构就绪、按 env 启用。
- **版本快照可回滚**：`revisions` 表，改写/保存前快照旧版，可回滚。
- **仪表盘首页**：列表卡片 → 打开进三阶段。
- **身份**：本地单用户、无账号；DB 预留可空 `user_id`。**注意**：`user_id` 只是**降低**将来多租户改造成本，**不等于零返工**——真多租户时所有仓库方法仍需带租户上下文 + 访问约束；本方案不提前实现，只不挖坑。
- **保存时机**：关键变更（导入 / 核对提交 / 应用改写 / 排版编辑）+ 手动「保存」；不逐键自动保存。

## 一 数据模型
```
resumes(
  id TEXT PK,               -- uuid
  user_id TEXT NULL,        -- 预留多租户，现阶段恒 NULL
  title TEXT NOT NULL,      -- 简历名（默认 basics.name + 岗位；空则「未命名简历」）
  role TEXT NOT NULL,       -- rubric key（写入前校验 ∈ RUBRICS，默认 'engineer'）
  jd TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL,       -- JSON Resume（json.dumps；新建空白默认 {"basics":{}}）
  export_md TEXT NULL,      -- 排版阶段用户编辑过的 Markdown（见 §四）；NULL=从 data 派生
  version INTEGER NOT NULL DEFAULT 1,  -- 乐观并发：每次 update +1
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)
revisions(                  -- 一条 revision = 一份「完整文档」快照（避免回滚后 title/jd 与内容分裂）
  id TEXT PK,
  resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
  data TEXT NOT NULL,       -- 快照的 JSON Resume
  export_md TEXT NULL,      -- 同期 export_md 快照
  title TEXT NOT NULL, role TEXT NOT NULL, jd TEXT NOT NULL,  -- 同期元数据快照
  note TEXT NOT NULL,       -- 触发说明（如「应用改写前」「回滚前」）
  created_at TEXT NOT NULL
)
-- 索引：resumes(updated_at)；revisions(resume_id, created_at)
```
- 每简历 revisions 限最近 `MAX_REVISIONS`（常量，=20）；超出删最旧。
- `data`/`export_md` 存 JSON/文本，两库通用。

## 二 仓库抽象（新目录 `resume_agent/webapp/db/`）
- `repo.py`：`ResumeRepo` 协议。方法及**事务/并发契约**：
  - `list() / get(id) / delete(id) / duplicate(id) / list_revisions(id)` —— 单语句。
  - `create(title, role, jd, data, export_md=None) -> record`。
  - `update(id, patch: {title?/role?/jd?/data?/export_md?}, expected_version) -> record`：
    **单写事务内**（SQLite `BEGIN IMMEDIATE` / PG `FOR UPDATE`，与 rollback 同锁策略，省去「快照→版本冲突→回滚快照」的无效路径）：「若 data 或 export_md 变化 → 先写一条**完整**快照（data/export_md/title/role/jd）→ UPDATE（**版本谓词落在其上** `WHERE id=? AND version=?`，rowcount=0→`Conflict`/409）→ 裁剪超限 revisions」。
    **export_md 后端安全网**：本次若改了 `data`（与旧值不同），后端**强制 `export_md:=NULL`**（无视 patch 里可能残留的旧 md），杜绝前端 bug 导致 md 与 data 分叉；纯排版保存（data 不变、只改 export_md）不受影响。
  - `rollback(id, revision_id, expected_version) -> record`：**单写事务内**（SQLite `BEGIN IMMEDIATE` / PG `SELECT … FOR UPDATE` 取写锁）：取当前行（不存在→`NotFound`）与该 revision（不属于该 resume→`NotFound`）→ 先写一条 note=回滚前的**当前**版快照 → 覆盖 UPDATE **把版本谓词落在其上**：`UPDATE resumes SET data=<rev.data>, export_md=<rev.export_md>, title=<rev.title>, role=<rev.role>, jd=<rev.jd>, version=version+1 WHERE id=? AND version=?`（**全量恢复文档**，避免 title/jd 与内容分裂），**rowcount=0 则抛 `Conflict`/409**（无「先校验再覆盖」的 TOCTOU；并发失败时整事务回滚、连同刚写的快照一并撤销）→ **裁剪超限 revisions**（回滚也新增快照，同受 `MAX_REVISIONS`）。
  - 同理 `update` 的乐观并发也由**版本谓词落在 UPDATE + rowcount** 保证（非前置 SELECT 校验）；快照写在同一事务内、UPDATE 失败则一并回滚。
  - 不存在的 id → 抛 `NotFound`（API 转 404）。
- **连接模型（关键，避免跨线程/事务串扰）**：`get_repo()` 单例只持有**配置**，不持有共享连接。**每次操作打开自己的连接**（context manager，用完即关）：
  - SQLite：`sqlite3.connect(path)` 后每连接设 `PRAGMA foreign_keys=ON; journal_mode=WAL; busy_timeout=5000`；`row_factory=sqlite3.Row`。（每操作连接天然规避「SQLite 连接不能跨线程」——同步路由在线程池，连接不复用。）
  - Postgres：`psycopg` 连接池（`psycopg_pool`），每操作借还；事务用 `with conn.transaction()`。未装 psycopg / 未配 `DATABASE_URL` → 构造时抛清晰错误。
  - SQL 两库仅占位符 `?`↔`%s` 差异，抽到基类，子类只声明占位符与连接获取。
- `factory.py`：读 `DB_BACKEND=sqlite|postgres`（默认 sqlite）、`RESUME_DB`（默认 **`Path(app.py).parent/'data'/'resumes.db'`，并 `mkdir(parents=True, exist_ok=True)`**，不依赖启动 cwd）、`DATABASE_URL`。首连自动建表（内置 `schema_version` 表）。**迁移路径**：`CREATE TABLE IF NOT EXISTS` 只建初表、加列要靠迁移函数——预先约定 `migrate_vN_to_vN+1(conn)` 签名与顺序执行框架（v1 不阻塞，但先定框架，避免下次加字段被迫线上手动 ALTER）。

## 三 API（`webapp/app.py` 增；沿用 `ApiError` 信封、同步路由走 `run_in_threadpool`）
| 方法 | 路由 | 说明 |
|---|---|---|
| GET | `/api/resumes` | 列表（**只返元数据**：id/title/role/version/updated_at，不返 data） |
| POST | `/api/resumes` | 新建 `{title?, role?, jd?, data?, export_md?}`；缺省 title=「未命名简历」、role='engineer'、data={"basics":{}}；写前 `validate_resume(data)`（**须先确认 validate_resume 接受最小空结构 `{"basics":{}}`**；若不接受，则空白新建跳过校验、仅后续 data 变更时校验） |
| GET | `/api/resumes/{id}` | 完整记录（含 data/export_md/version）；不存在 → 404 |
| PUT | `/api/resumes/{id}` | 更新，**body 必带 `version`**（乐观并发）；data 变化则 `validate_resume`；版本不符 → **409**；不存在 → 404 |
| DELETE | `/api/resumes/{id}` | 删除（级联删 revisions）；前端需二次确认（见 §四） |
| POST | `/api/resumes/{id}/duplicate` | 复制为新记录（version 重置为 1，不复制 revisions） |
| GET | `/api/resumes/{id}/revisions` | 版本列表（id/note/created_at） |
| POST | `/api/resumes/{id}/rollback` | `{revisionId, version}`；版本不符 → 409；revision 不属于该 resume / 缺失 → 404 |
- 所有写入：`role` 非法（∉ RUBRICS）→ 400；`data` 非法（`validate_resume` 报错）→ 400，不落库脏数据。

## 四 前端
- `store` 新增 `view: 'dashboard'|'editor'`、`resumeId`、`version`、`title`、`dirty`。
- **原子载入/清空动作** `loadResume(record)` / `newResume()`：**一次性重置全部编辑期状态**（resume/jd/role/title/resumeId/version + phase=1/maxPhase=1 + diagnosis/improve/afterScore/warnings/usedOcr 全清），避免上一份简历状态泄漏（错误诊断、误解锁后续阶段）。`closeToDashboard()` 同样清空。
- **Dashboard 组件**：拉 `/api/resumes` → 卡片（标题/岗位/更新时间 + 打开/复制/删除/新建空白）。**删除需二次确认弹窗**（一键永久删除+级联清历史，必须挡一道；软删除列为可选后续，不在本期）。
- **打开**：`GET /{id}` → `loadResume` → `view='editor'` 进诊断；顶栏显示标题 + 「← 简历列表」。
- **编辑内容统一进 store + Hydration key**：`ReviewEditor`、`StepExport` 的编辑**实时（防抖）写入 store，store 为唯一真相源**——消除「与 store 分叉的本地草稿」（否则「keystroke 设 dirty 但手动保存拿不到草稿」与「commit 才设 dirty 但带未提交草稿离开不触发确认」二者必居其一）。载入/回滚时 store 被原子替换，编辑组件按一个**独立 `hydrationKey`（计数器）**重挂、干净地从新 store 取初值——`hydrationKey` **仅在 `loadResume`/`newResume`/回滚成功时 +1，绝不随数据库 `version` 变**（否则每次成功保存哪怕只改标题都会重挂、打断正在输入）。副作用：核对阶段实时改 `data` 会即时把 `diagnosis` 标记过期——可接受（简历变了评分本就作废）。
- **保存（单飞 + 合并待存 + 乐观并发）**：
  - **不是简单单飞丢弃**：同一时刻只允许一个 PUT 在途；期间发生的新变更置 `pendingDirty`，**当前请求完成后若仍 dirty 则再存一次**（trailing save），保证连续操作不丢。（现有 `useTask` 会直接忽略在途二次调用，故这层 in-flight+pending 需在保存逻辑里另建。）
  - PUT 带当前 `version`；成功后用返回的新 version 更新 store。**新简历首次保存走 POST，且 POST 也进同一单飞/合并队列**——拿到 id 前后续保存合并等待、得 id 后转 PUT，避免创建期间重复触发生成两条简历。
  - **岗位检测异步**：导入后 role 由异步检测回填，须在回填后再保存，不能用旧 role 抢先保存。
  - **409 不静默覆盖**：保留本地未存修改，弹冲突提示，让用户选 ① 重新加载（丢弃本地）② 以我的覆盖（拉最新 version 后重存）③ 继续编辑。
- **`dirty` 生命周期（用 savePoint 精确清）**：任何编辑期变更置 `dirty`；保存**发起时记录一个 `savePoint`（store 快照/序列号）**，成功回来后**比对当前 store 与 savePoint：一致才清 `dirty`，不一致说明在途期间又改了 → 保持 `dirty` 并触发 trailing save**（避免「保存成功瞬间清 dirty 却丢在途新编辑」）；保存失败/409 保持 `dirty`；`closeToDashboard`/`newResume`/打开另一份 时若 `dirty` → **二次确认丢弃**，不直接清空。
- **排版 Markdown 持久化 + 失效**：`StepExport` 编辑写入 `export_md` 随保存持久化；「从简历重生成」清空 `export_md`（回派生）；**canonical `data` 因「新变更」而改（导入/核对/改写）即清空 `export_md`**，避免排版停留在旧内容；**回滚除外**——回滚同时恢复历史 `data` 与其配套 `export_md`（二者本就匹配，不能清）；**失效以后端为准**：data 变更时服务端置 `export_md=NULL`，前端据保存**返回**更新、**不预清**，保存失败/400 不动本地 `export_md`（避免丢值）；`export_md` 纳入 `loadResume`/`newResume` 的载入与清空契约；打开时 `export_md` 非空则加载、否则从 data 生成。
- **版本历史**：编辑器顶栏「历史版本」→ `GET revisions` 列表 + 回滚（`POST rollback`，带 `version`）；回滚后用返回记录 `loadResume` 刷新（bump `hydrationKey` 触发重挂）。

## 五 测试
- **仓库层离线单测**（SQLite 临时文件）：CRUD、duplicate（不带 revisions、version 归 1）、update 触发快照、revisions 限量裁剪、外键级联删除、rollback 正确覆盖 + 回滚前快照、**回滚也裁剪 revisions（反复回滚不无限增长）**、**跨 resume 的 revisionId 被拒（NotFound）**、**乐观并发：过期 version 的 update 与 rollback 均抛 Conflict**、**事务原子性：注入 update 中途失败不留半个快照**（用可控异常验证回滚）。
- **API 冒烟/边界**：建→改（触发快照）→列→回滚全链路；非法 role→400、非法 data→400、缺失 id→404、版本冲突→409、rollback 跨简历→404。
- **Postgres 适配**：同一套仓库契约测试参数化跑在 PG 上（需 `DATABASE_URL` 指向测试库，CI/本地有 PG 时执行；无则跳过并打印 SKIP，不静默假绿）。
- **前端**：无单测框架，按既有做法用 preview 真机验证——载入两份简历确认状态不泄漏、回滚后编辑器内容刷新、**保存期间连续改动不丢（合并待存生效）**、**仅改标题/JD 后 ReviewEditor 未提交草稿不被重挂丢弃**、**data 变更后 export_md 失效**、409 冲突弹窗三选项、`dirty` 时离开有二次确认、排版编辑重开仍在。

## 六 分期（每期可独立验收）
- **P1 后端**：仓库抽象 + SQLite + 事务/并发契约 + API（含 404/409/校验）+ 仓库单测 + API 冒烟。
- **P2 前端**：Dashboard + 原子 loadResume/newResume + 编辑内容进 store + 单飞/合并乐观保存（含 POST）+ 子组件按 `hydrationKey` 重挂。
- **P3 版本历史 UI + 回滚 + 删除确认 + 排版 export_md 持久化**。
- **P4 Postgres 适配**：连接池 + 参数化契约测试（需 PG 环境）。

## 七 影响面 / 风险
- **现有三阶段流不变**，只在外面套「列表 + 持久化」；内存 store 仍是编辑期状态，落库是其快照。
- **并发**：单用户 + WAL 处理 DB 锁；**乱序保存靠客户端单飞 + version 乐观并发挡**（不是 WAL 能解决的）。
- **数据文件**：默认 `webapp/data/resumes.db`（相对 app.py 解析、自动建目录），`webapp/data/` 加进 `.gitignore`。
- **反编造立场无影响**：持久化只存/取用户真实简历（含其排版 Markdown），不引入任何生成。

<!-- codex-peer-reviewed: 2026-07-01T09:16:32Z rounds=4 verdict=approved -->
<!-- 复核说明：codex 复核 3 轮、发现并修复 21 项（事务/连接模型/乐观并发/状态泄漏/草稿丢失/TOCTOU 等）；第 4 轮因 codex 触发用量上限，改由 OpenCode/GLM-5.1 跨模型验证 → APPROVED，其 7 项 advisory 已折入。 -->
