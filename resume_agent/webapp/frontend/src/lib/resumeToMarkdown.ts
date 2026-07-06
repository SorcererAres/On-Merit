// JSON Resume → { 头部结构化数据, 正文 Markdown }（编辑表单 v3，见 docs/plans/resume-edit-form-v3.md §3.3/§3.4）。
// 信任分离：头部数据（姓名/次行/联系/标签）不进 md，由 markdownToDoc 在模板层转义插值拼 HTML；
// 正文只产用户内容 md（marked 渲染时 renderer.html 吞原始 HTML）。单次转义边界在渲染输出层。
import type {
  Resume, Work, Skill, Education, Project, VolunteerEntry, OrgEntry,
  CampusEntry, ThesisEntry, CompetitionEntry, AwardEntry, CustomSection,
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
}
export function resumeHeaderData(resume: Resume, opts: { privacyMinimal?: boolean } = {}): HeaderData {
  const b = resume.basics || {};
  const priv = !!opts.privacyMinimal;
  const role = clean((b.meta as any)?.role) || clean((resume.meta as any)?.role);
  const birth = clean(b.birthMonth).replace(/-/g, ".");
  const subParts = priv ? [] : [genderLabel(b.gender), birth, clean(b.hometown)].filter(Boolean);
  // 联系顺序沿用既有（邮箱·电话·…），保证旧数据视觉等价；ats 隐私最小化去微信/城市/标签
  const contacts = (priv
    ? [clean(b.email), clean(b.phone), clean(b.url)]
    : [clean(b.email), clean(b.phone), clean(b.wechat), clean(b.location?.city), clean(b.url)]
  ).filter(Boolean);
  const tags = priv ? [] : (b.tags || []).map(clean).filter(Boolean);
  const photo = priv ? "" : clean(b.photo);   // ats/隐私最小化不放照片（利于机器解析）
  return { name: clean(b.name) || "姓名", tagline: role, subline: subParts.join("  ·  "), contacts, tags, photo };
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
function awardBlock(a: AwardEntry): string {
  const meta = [clean(a.awarder), clean(a.date)].filter(Boolean).join("  ·  ");
  const note = clean(a.summary) || clean(a.note);
  const head = `- ${clean(a.title) || "荣誉"}${meta ? `  —  ${meta}` : ""}`;
  return note ? `${head}\n  ${note}` : head;
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
function joinBlocks<X>(arr: X[] | undefined, fn: (x: X) => string): string {
  return (arr || []).map(fn).filter((s) => s.trim()).join("\n\n");
}

// ---- 正文分节（带 key，供单栏 join / 双栏路由复用）----
// key 用于双栏引擎把各节分到侧栏/主栏（见 resumeDoc.ts SIDE_KEYS）。空节自动跳过。
export function resumeBodySections(resume: Resume, lang: Lang = "zh"): { key: string; md: string }[] {
  const t = T[lang];
  const p = t.present;
  const out: { key: string; md: string }[] = [];
  const push = (key: string, md: string) => { if (md && md.trim()) out.push({ key, md }); };

  const ji = resume.job_intent;
  if (ji) {
    const pos = (ji.positions || []).map(clean).filter(Boolean).join("、");
    const body = [pos && `意向岗位：${pos}`, clean(ji.city) && `意向城市：${clean(ji.city)}`].filter(Boolean).join("\n\n");
    push("intent", section(t.intent, body));
  }
  push("summary", section(t.summary, mdField(resume.basics?.summary)));
  push("metrics", section(t.metrics, metricsTable(resume, t)));
  push("exp", section(t.exp, joinBlocks(resume.work, (w) => workBlock(w, p))));
  push("intern", section(t.intern, joinBlocks(resume.internships, (w) => workBlock(w, p))));
  push("proj", section(t.proj, joinBlocks(resume.projects, (x) => projBlock(x, p))));
  push("org", section(t.org, joinBlocks(resume.organizations, (o) => orgBlock(o, p))));
  push("volunteer", section(t.volunteer, joinBlocks(resume.volunteer, (v) => volunteerBlock(v, p))));
  push("campus", section(t.campus, joinBlocks(resume.campus, (c) => campusBlock(c, p))));
  push("thesis", section(t.thesis, joinBlocks(resume.thesis, thesisBlock)));
  push("comp", section(t.comp, joinBlocks(resume.competitions, compBlock)));
  push("awards", section(t.awards, joinBlocks(resume.awards, awardBlock)));
  // 技能：skills_md 优先，回退结构化 skills[]
  push("skills", section(t.skills, nonEmpty(resume.skills_md) ? mdField(resume.skills_md) : skillsBlock(resume.skills || [])));
  push("edu", section(t.edu, (resume.education || []).map(eduBlock).join("\n")));

  const certs = (resume.certificates || []) as { name?: string; issuer?: string }[];
  push("certs", section(t.certs, certs.map((c) => {
    const n = clean(c.name), i = clean(c.issuer);
    return n || i ? `- ${n}${i ? `  —  ${i}` : ""}` : "";
  }).filter(Boolean).join("\n")));

  // 自定义模块：各自标题 + 内容
  for (const cs of (resume.custom_sections || []) as CustomSection[]) {
    if (nonEmpty(cs.content) || clean(cs.title)) push("custom", section(clean(cs.title) || "自定义模块", mdField(cs.content)));
  }

  return out;
}

// ---- 正文 md（单栏：各节顺序 join；仅用户内容，无原始 HTML）----
export function resumeBodyMd(resume: Resume, lang: Lang = "zh"): string {
  return resumeBodySections(resume, lang).map((s) => s.md)
    .join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
