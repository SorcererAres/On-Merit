// JSON Resume -> Markdown 源文（thenextcv 式：可自由编辑的 markdown 即导出源）。
// 头部用一小段语义化 HTML（cv-head）保证排版稳定，其余全部走 markdown。
import type { Resume, Work, Skill, Education, Project } from "@/types";

type Lang = "zh" | "en";
const T = {
  zh: { summary: "概要", metrics: "亮点数据", exp: "工作经历", proj: "项目经历",
        skills: "技能", edu: "教育经历", certs: "证书", present: "至今",
        metric: "指标", value: "数值" },
  en: { summary: "Summary", metrics: "Highlights", exp: "Experience", proj: "Projects",
        skills: "Skills", edu: "Education", certs: "Certificates", present: "Present",
        metric: "Metric", value: "Value" },
} as const;

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clean = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

function daterange(start?: string, end?: string, present = "至今"): string {
  const a = clean(start), b = clean(end);
  if (!a && !b) return "";
  return `${a}${a || b ? " – " : ""}${b || present}`;
}

function header(r: Resume): string {
  const b = r.basics || {};
  const role = clean((b.meta as any)?.role) || clean((r.meta as any)?.role);
  const city = clean(b.location?.city);
  const contact = [clean(b.email), clean(b.phone), city, clean(b.url)].filter(Boolean).join("  ·  ");
  const lines = [`<header class="cv-head">`, `  <h1>${esc(clean(b.name) || "姓名")}</h1>`];
  if (role) lines.push(`  <p class="cv-tagline">${esc(role)}</p>`);
  if (contact) lines.push(`  <p class="cv-contact">${esc(contact)}</p>`);
  lines.push(`</header>`);
  return lines.join("\n");
}

function section(title: string, body: string): string {
  return body.trim() ? `## ${title}\n\n${body.trim()}` : "";
}

function workBlock(w: Work, t: (typeof T)[Lang]): string {
  const title = [clean(w.position), clean(w.name)].filter(Boolean).join("  ·  ");
  const dr = daterange(w.startDate, w.endDate, t.present);
  const head = dr ? `**${title}**  —  *${dr}*` : `**${title}**`;
  const lines = [head];
  if (clean(w.summary)) lines.push("", clean(w.summary));
  const hs = (w.highlights || []).map(clean).filter(Boolean);
  if (hs.length) lines.push("", ...hs.map((h) => `- ${h}`));
  return lines.join("\n");
}

function projBlock(p: Project): string {
  const title = clean(p.name) || "项目";
  const lines = [`**${title}**`];
  if (clean(p.description)) lines.push("", clean(p.description));
  const tech = (p.technologies || []).map(clean).filter(Boolean);
  if (tech.length) lines.push("", `技术：${tech.join("、")}`);
  return lines.join("\n");
}

function skillsBlock(skills: Skill[]): string {
  return skills
    .map((s) => {
      const kw = (s.keywords || []).map(clean).filter(Boolean).join("、");
      const name = clean(s.name);
      if (!name && !kw) return "";
      return `- **${name || "技能"}**${kw ? `：${kw}` : ""}`;
    })
    .filter(Boolean)
    .join("\n");
}

function eduBlock(e: Education): string {
  const left = [clean(e.institution)].filter(Boolean).join("");
  const right = [clean(e.studyType), clean(e.area)].filter(Boolean).join(" · ");
  const dr = daterange(e.startDate, e.endDate, "");
  const parts = [left && `**${left}**`, right, dr && `*${dr}*`].filter(Boolean);
  return `- ${parts.join("  —  ")}`;
}

function metricsTable(r: Resume, t: (typeof T)[Lang]): string {
  const metrics = ((r.meta as any)?.metrics || []) as { value?: string; unit?: string; label?: string }[];
  const rows = metrics
    .map((m) => {
      const v = [clean(m.value), clean(m.unit)].filter(Boolean).join(" ");
      const l = clean(m.label);
      return v || l ? `| ${l || "—"} | ${v || "—"} |` : "";
    })
    .filter(Boolean);
  if (!rows.length) return "";
  return [`| ${t.metric} | ${t.value} |`, `| --- | --- |`, ...rows].join("\n");
}

export function resumeToMarkdown(resume: Resume, lang: Lang = "zh"): string {
  const t = T[lang];
  const out: string[] = [header(resume)];

  out.push(section(t.summary, clean(resume.basics?.summary)));
  out.push(section(t.metrics, metricsTable(resume, t)));
  out.push(section(t.exp, (resume.work || []).map((w) => workBlock(w, t)).join("\n\n")));
  out.push(section(t.proj, (resume.projects || []).map(projBlock).join("\n\n")));
  out.push(section(t.skills, skillsBlock(resume.skills || [])));
  out.push(section(t.edu, (resume.education || []).map(eduBlock).join("\n")));

  const certs = (resume.certificates || []) as { name?: string; issuer?: string }[];
  const certBody = certs
    .map((c) => {
      const n = clean(c.name), i = clean(c.issuer);
      return n || i ? `- ${n}${i ? `  —  ${i}` : ""}` : "";
    })
    .filter(Boolean)
    .join("\n");
  out.push(section(t.certs, certBody));

  // 块间统一空行连接：保证 </header> 后有空行（否则 marked 把首个 ## 并进 HTML 块）
  return out.filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
