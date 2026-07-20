// JSON Resume → { 头部结构化数据, 正文 Markdown }（编辑表单 v3，见 docs/plans/resume-edit-form-v3.md §3.3/§3.4）。
// 信任分离：头部数据（姓名/次行/联系/标签）不进 md，由 markdownToDoc 在模板层转义插值拼 HTML；
// 正文只产用户内容 md（marked 渲染时 renderer.html 吞原始 HTML）。单次转义边界在渲染输出层。
import type {
  Resume, Work, Skill, Education, Project, VolunteerEntry, OrgEntry,
  CampusEntry, ThesisEntry, CompetitionEntry, CustomSection,
} from "@/types";

type Lang = "zh" | "en";
const T = {
  zh: { summary: "概要", metrics: "亮点数据", exp: "工作经历", intern: "实习经历",
        proj: "项目经历", org: "学生会 / 社团经历", volunteer: "志愿者活动",
        campus: "校园大使", thesis: "毕业设计 / 论文", comp: "学术竞赛",
        awards: "所获荣誉", skills: "技能", edu: "教育经历", certs: "证书",
        intent: "求职意向", present: "至今", metric: "指标", value: "数值" },
  en: { summary: "Summary", metrics: "Highlights", exp: "Experience", intern: "Internships",
        proj: "Projects", org: "Organizations", volunteer: "Volunteering",
        campus: "Campus Ambassador", thesis: "Thesis", comp: "Competitions",
        awards: "Honors & Awards", skills: "Skills", edu: "Education", certs: "Certificates",
        intent: "Job Intent", present: "Present", metric: "Metric", value: "Value" },
} as const;

const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();
// 富文本字段：仅去首尾空白，保留内部换行（列表结构靠换行）
const mdField = (s: unknown) => String(s ?? "").replace(/^\s+|\s+$/g, "");
const nonEmpty = (s: unknown) => mdField(s).length > 0;

function daterange(start?: string, end?: string, present = "至今"): string {
  const a = clean(start), b = clean(end);
  if (!a && !b) return "";
  return `${a}${a || b ? " – " : ""}${b || present}`;
}
function genderLabel(g?: string): string {
  return g === "male" ? "男" : g === "female" ? "女" : "";
}

// ---- 头部结构化数据（不含 HTML；markdownToDoc 转义插值）----
export interface HeaderData {
  name: string;
  tagline: string;             // 职业方向（meta.role），保留既有行为
  subline: string;             // 性别 · 生日 · 籍贯（privacyMinimal 时空）
  contacts: string[];          // 电话/邮箱/微信/城市/url（privacyMinimal 仅邮箱/电话/url）
  tags: string[];              // #标签（privacyMinimal 时空）
  photo: string;               // 头像 data URL（privacyMinimal/ats 时空——利于机器解析）
  // 预览画布内联编辑的字段边界。纯文本字段仍保留，供导出/旧调用方使用；
  // fieldParts 只负责让 resumeDoc 输出可定位 span，不改变任何可见文案。
  sublineParts?: { field: string; label: string; value: string }[];
  contactParts?: { field: string; label: string; value: string }[];
}
export function resumeHeaderData(resume: Resume, opts: { privacyMinimal?: boolean } = {}): HeaderData {
  const b = resume.basics || {};
  const priv = !!opts.privacyMinimal;
  const role = clean((b.meta as any)?.role) || clean((resume.meta as any)?.role);
  const birth = clean(b.birthMonth).replace(/-/g, ".");
  const sublineParts = priv ? [] : [
    { field: "gender", label: "性别", value: genderLabel(b.gender) },
    { field: "birthMonth", label: "生日", value: birth },
    { field: "hometown", label: "籍贯", value: clean(b.hometown) },
  ].filter((x) => !!x.value);
  const subParts = sublineParts.map((x) => x.value);
  // 联系顺序沿用既有（邮箱·电话·…），保证旧数据视觉等价；ats 隐私最小化去微信/城市/标签
  const contacts = (priv
    ? [clean(b.email), clean(b.phone), clean(b.url)]
    : [clean(b.email), clean(b.phone), clean(b.wechat), clean(b.location?.city), clean(b.url)]
  ).filter(Boolean);
  const contactParts = priv
    ? [
        { field: "email", label: "邮箱", value: clean(b.email) },
        { field: "phone", label: "电话", value: clean(b.phone) },
        { field: "url", label: "个人主页", value: clean(b.url) },
      ]
    : [
        { field: "email", label: "邮箱", value: clean(b.email) },
        { field: "phone", label: "电话", value: clean(b.phone) },
        { field: "wechat", label: "微信", value: clean(b.wechat) },
        { field: "city", label: "所在城市", value: clean(b.location?.city) },
        { field: "url", label: "个人主页", value: clean(b.url) },
      ];
  const tags = priv ? [] : (b.tags || []).map(clean).filter(Boolean);
  const photo = priv ? "" : clean(b.photo);   // ats/隐私最小化不放照片（利于机器解析）
  return {
    name: clean(b.name) || "姓名", tagline: role, subline: subParts.join("  ·  "), contacts, tags, photo,
    sublineParts, contactParts: contactParts.filter((x) => !!x.value),
  };
}

// ---- 正文块 ----
function section(title: string, body: string): string {
  return body.trim() ? `## ${title}\n\n${body.trim()}` : "";
}
function entryHead(title: string, dr: string): string {
  return dr ? `**${title}**  —  *${dr}*` : `**${title}**`;
}
// 经历型条目：标题行 + 描述（description 优先，回退 summary+highlights）
function expBlock(title: string, dr: string, description?: string,
                  summary?: string, highlights?: string[]): string {
  const lines = [entryHead(title, dr)];
  if (nonEmpty(description)) { lines.push("", mdField(description)); return lines.join("\n"); }
  if (clean(summary)) lines.push("", clean(summary));
  const hs = (highlights || []).map(clean).filter(Boolean);
  if (hs.length) lines.push("", ...hs.map((h) => `- ${h}`));
  return lines.join("\n");
}

function workBlock(w: Work, present: string): string {
  const title = [clean(w.position), clean(w.name)].filter(Boolean).join("  ·  ") || "经历";
  return expBlock(title, daterange(w.startDate, w.endDate, present), w.description, w.summary, w.highlights);
}
function orgBlock(o: OrgEntry, present: string): string {
  const title = [clean(o.name), clean(o.role)].filter(Boolean).join("  ·  ") || "经历";
  return expBlock(title, daterange(o.startDate, o.endDate, present), o.description);
}
function volunteerBlock(v: VolunteerEntry, present: string): string {
  const title = [clean(v.organization), clean(v.position)].filter(Boolean).join("  ·  ") || "经历";
  return expBlock(title, daterange(v.startDate, v.endDate, present), v.description, v.summary, v.highlights);
}
function campusBlock(c: CampusEntry, present: string): string {
  return expBlock(clean(c.name) || "校园大使", daterange(c.startDate, c.endDate, present), c.description);
}
function thesisBlock(t: ThesisEntry): string {
  return expBlock(clean(t.title) || "毕业设计", clean(t.date), t.description);
}
function compBlock(c: CompetitionEntry): string {
  const title = [clean(c.name), clean(c.award)].filter(Boolean).join("  ·  ") || "竞赛";
  return expBlock(title, clean(c.date), c.description);
}
function projBlock(p: Project, present: string): string {
  const title = [clean(p.name), clean(p.role)].filter(Boolean).join("  ·  ") || "项目";
  const dr = daterange(p.startDate, p.endDate, present);
  if (nonEmpty(p.description)) return `${entryHead(title, dr)}\n\n${mdField(p.description)}`;
  const tech = (p.technologies || []).map(clean).filter(Boolean);
  const lines = [entryHead(title, dr)];
  if (tech.length) lines.push("", `技术：${tech.join("、")}`);
  return lines.join("\n");
}
function skillsBlock(skills: Skill[]): string {
  return skills.map((s) => {
    const kw = (s.keywords || []).map(clean).filter(Boolean).join("、");
    const name = clean(s.name);
    if (!name && !kw) return "";
    return `- **${name || "技能"}**${kw ? `：${kw}` : ""}`;
  }).filter(Boolean).join("\n");
}
function eduBlock(e: Education): string {
  const mode = e.studyMode === "full_time" ? "全日制" : e.studyMode === "part_time" ? "非全日制" : "";
  const right = [clean(e.studyType), mode, clean(e.area)].filter(Boolean).join(" · ");
  const dr = daterange(e.startDate, e.endDate, "");
  const parts = [clean(e.institution) && `**${clean(e.institution)}**`, right, dr && `*${dr}*`].filter(Boolean);
  const head = `- ${parts.join("  —  ")}`;
  return nonEmpty(e.description) ? `${head}\n\n${mdField(e.description)}` : head;
}
function metricsTable(resume: Resume, t: (typeof T)[Lang]): string {
  const metrics = ((resume.meta as any)?.metrics || []) as { value?: string; unit?: string; label?: string }[];
  const rows = metrics.map((m) => {
    const v = [clean(m.value), clean(m.unit)].filter(Boolean).join(" ");
    const l = clean(m.label);
    return v || l ? `| ${l || "—"} | ${v || "—"} |` : "";
  }).filter(Boolean);
  if (!rows.length) return "";
  return [`| ${t.metric} | ${t.value} |`, `| --- | --- |`, ...rows].join("\n");
}
// ---- 正文分节（带可编辑条目边界）----
// resumeDoc 按 block 输出 data-resume-entry，使 iframe 能把点击准确映射回结构化数据条目；
// resumeBodySections 仍把它们拼回旧 Markdown 契约，供纯文本/旧调用方复用。
export interface ResumeBodyEditBlock {
  id: string;
  label: string;
  md: string;
  // 画布编辑时保留 headMd 的正式排版，只把 bodyMd 替换成原位正文编辑器。
  headMd?: string;
  bodyMd?: string;
  static?: {
    primary: ResumeBodyEditField;
    details?: ResumeBodyEditField[];
    start?: ResumeBodyEditField;
    end?: ResumeBodyEditField;
    date?: ResumeBodyEditField;
  };
}
export interface ResumeBodyEditField {
  key: string;
  label: string;
  value: string;
  kind?: "text" | "month" | "csv";
}
export interface ResumeBodyEditSection {
  key: string;
  title: string;
  blocks: ResumeBodyEditBlock[];
  joiner?: string;
}

export function resumeBodyEditSections(resume: Resume, lang: Lang = "zh"): ResumeBodyEditSection[] {
  const t = T[lang];
  const p = t.present;
  const out: ResumeBodyEditSection[] = [];
  const push = (key: string, title: string, blocks: ResumeBodyEditBlock[], joiner = "\n\n") => {
    const visible = blocks.filter((block) => block.md.trim());
    if (visible.length) out.push({ key, title, blocks: visible, joiner });
  };
  const editable = (id: string, label: string, md: string, splitHead = false): ResumeBodyEditBlock => {
    if (!splitHead) return { id, label, md, headMd: "", bodyMd: md };
    const boundary = md.indexOf("\n\n");
    return boundary < 0
      ? { id, label, md, headMd: md, bodyMd: "" }
      : { id, label, md, headMd: md.slice(0, boundary), bodyMd: md.slice(boundary + 2) };
  };
  const entries = <X,>(arr: X[] | undefined, prefix: string, labelOf: (x: X, i: number) => string,
                       render: (x: X) => string,
                       staticOf?: (x: X) => ResumeBodyEditBlock["static"]): ResumeBodyEditBlock[] =>
    (arr || []).map((item, i) => ({
      ...editable(`${prefix}.${i}`, labelOf(item, i), render(item), true),
      static: staticOf?.(item),
    }));
  const field = (key: string, label: string, value: unknown, kind: ResumeBodyEditField["kind"] = "text"): ResumeBodyEditField =>
    ({ key, label, value: clean(value), kind });
  const rangeStatic = (primary: ResumeBodyEditField, details: ResumeBodyEditField[], start?: string, end?: string) => ({
    primary, details: details.filter((item) => !!item.value),
    start: field("startDate", "开始时间", start, "month"), end: field("endDate", "结束时间", end, "month"),
  });

  const ji = resume.job_intent;
  if (ji) {
    const pos = (ji.positions || []).map(clean).filter(Boolean).join("、");
    const body = [pos && `意向岗位：${pos}`, clean(ji.city) && `意向城市：${clean(ji.city)}`].filter(Boolean).join("\n\n");
    push("intent", t.intent, [editable("job_intent", t.intent, body)]);
  }
  push("summary", t.summary, [editable("basics.summary", t.summary, mdField(resume.basics?.summary))]);
  push("metrics", t.metrics, [editable("metrics", t.metrics, metricsTable(resume, t))]);
  const workStatic = (w: Work) => rangeStatic(field("name", "公司名称", w.name || "经历"), [field("position", "岗位名称", w.position)], w.startDate, w.endDate);
  push("exp", t.exp, entries(resume.work, "work", (w) => clean(w.name) || clean(w.position) || t.exp, (w) => workBlock(w, p), workStatic));
  push("intern", t.intern, entries(resume.internships, "internships", (w) => clean(w.name) || clean(w.position) || t.intern, (w) => workBlock(w, p), workStatic));
  push("proj", t.proj, entries(resume.projects, "projects", (x) => clean(x.name) || t.proj, (x) => projBlock(x, p), (x) =>
    rangeStatic(field("name", "项目名称", x.name || "项目"), [field("role", "担任角色", x.role), field("technologies", "项目技术", (x.technologies || []).join("、"), "csv")], x.startDate, x.endDate)));
  push("org", t.org, entries(resume.organizations, "organizations", (o) => clean(o.name) || t.org, (o) => orgBlock(o, p), (o) =>
    rangeStatic(field("name", "社团名称", o.name || "经历"), [field("role", "担任角色", o.role)], o.startDate, o.endDate)));
  push("volunteer", t.volunteer, entries(resume.volunteer, "volunteer", (v) => clean(v.organization) || t.volunteer, (v) => volunteerBlock(v, p), (v) =>
    rangeStatic(field("organization", "组织", v.organization || "志愿经历"), [field("position", "担任角色", v.position)], v.startDate, v.endDate)));
  push("campus", t.campus, entries(resume.campus, "campus", (c) => clean(c.name) || t.campus, (c) => campusBlock(c, p), (c) =>
    rangeStatic(field("name", "主办方", c.name || "校园大使"), [], c.startDate, c.endDate)));
  push("thesis", t.thesis, entries(resume.thesis, "thesis", (x) => clean(x.title) || t.thesis, thesisBlock, (x) =>
    ({ primary: field("title", "课题名", x.title || "毕业设计"), date: field("date", "时间", x.date, "month") })));
  push("comp", t.comp, entries(resume.competitions, "competitions", (x) => clean(x.name) || t.comp, compBlock, (x) =>
    ({ primary: field("name", "竞赛名称", x.name || "竞赛"), details: [field("award", "所获奖项", x.award)].filter((item) => !!item.value), date: field("date", "时间", x.date, "month") })));
  push("awards", t.awards, (resume.awards || []).map((award, index) => {
    const meta = [clean(award.awarder), clean(award.date)].filter(Boolean).join("  ·  ");
    const head = `- ${clean(award.title) || "荣誉"}${meta ? `  —  ${meta}` : ""}`;
    const body = clean(award.summary) || clean(award.note);
    return { id: `awards.${index}`, label: clean(award.title) || t.awards,
      md: body ? `${head}\n  ${body}` : head, headMd: head, bodyMd: body,
      static: { primary: field("title", "荣誉名称", award.title || "荣誉"), details: [field("awarder", "颁发方", award.awarder)].filter((item) => !!item.value), date: field("date", "获得时间", award.date, "month") } };
  }));
  // 技能：skills_md 优先，回退结构化 skills[]
  const skillMd = nonEmpty(resume.skills_md) ? mdField(resume.skills_md) : skillsBlock(resume.skills || []);
  push("skills", t.skills, [editable("skills", t.skills, skillMd)]);
  push("edu", t.edu, entries(resume.education, "education", (x) => clean(x.institution) || t.edu, eduBlock, (x) =>
    rangeStatic(field("institution", "学校", x.institution || "学校"), [field("area", "专业", x.area), field("studyType", "学历", x.studyType),
      field("studyMode", "学制", x.studyMode === "full_time" ? "全日制" : x.studyMode === "part_time" ? "非全日制" : "")], x.startDate, x.endDate)), "\n");

  const certs = (resume.certificates || []) as { name?: string; issuer?: string; summary?: string; note?: string }[];
  push("certs", t.certs, certs.map((c, index) => ({ id: `certificates.${index}`, label: clean(c.name) || t.certs, md: (() => {
    const name = clean(c.name), issuer = clean(c.issuer);
    const head = name || issuer ? `- ${name}${issuer ? `  —  ${issuer}` : ""}` : "";
    const body = clean(c.summary) || clean(c.note);
    return body ? `${head}\n  ${body}` : head;
  })(), headMd: (() => {
    const name = clean(c.name), issuer = clean(c.issuer);
    return name || issuer ? `- ${name}${issuer ? `  —  ${issuer}` : ""}` : "";
  })(), bodyMd: clean(c.summary) || clean(c.note), static: {
    primary: field("name", "证书名称", c.name || "证书"), details: [field("issuer", "颁发方", c.issuer)].filter((item) => !!item.value),
  } })), "\n");

  // 自定义模块：各自标题 + 内容
  for (const [i, cs] of ((resume.custom_sections || []) as CustomSection[]).entries()) {
    if (nonEmpty(cs.content) || clean(cs.title)) push(`custom:${i}`, clean(cs.title) || "自定义模块",
      [editable(`custom_sections.${i}`, clean(cs.title) || "自定义模块", mdField(cs.content))]);
  }

  // 画布模块操作条会写入 modules_order。只对当前可见模块排序：
  // 旧数据/新增模块未出现在顺序表时，仍按默认顺序稳定追加；已删除模块的陈旧 key 自动忽略。
  const preferred = Array.isArray(resume.modules_order) ? resume.modules_order : [];
  if (!preferred.length) return out;
  const rank = new Map(preferred.map((key, index) => [key, index]));
  return out
    .map((item, index) => ({ item, index, rank: rank.get(item.key) }))
    .sort((a, b) => {
      if (a.rank === undefined && b.rank === undefined) return a.index - b.index;
      if (a.rank === undefined) return 1;
      if (b.rank === undefined) return -1;
      return a.rank - b.rank;
    })
    .map(({ item }) => item);
}

// key 用于双栏引擎把各节分到侧栏/主栏（见 resumeDoc.ts SIDE_KEYS）。空节自动跳过。
export function resumeBodySections(resume: Resume, lang: Lang = "zh"): { key: string; md: string }[] {
  return resumeBodyEditSections(resume, lang).map((s) => ({
    key: s.key,
    md: section(s.title, s.blocks.map((block) => block.md).join(s.joiner ?? "\n\n")),
  }));
}

// ---- 正文 md（单栏：各节顺序 join；仅用户内容，无原始 HTML）----
export function resumeBodyMd(resume: Resume, lang: Lang = "zh"): string {
  return resumeBodySections(resume, lang).map((s) => s.md)
    .join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
