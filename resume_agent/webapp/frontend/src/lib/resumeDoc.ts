// Markdown 正文 + 头部结构化数据 → 完整 HTML 文档（A4 纸）。CSS 由模板 + 样式参数生成。
// 安全（见 resume-edit-form-v3.md §3.4）：头部由本模块转义插值拼 HTML（可信路径）；
// 正文经 marked 渲染，renderer.html 吞掉一切原始 HTML token（用户内容零 HTML 通路）；
// 转义在渲染输出层各发生一次，存储/编辑层保存字面文本（不预转义，防双重编码）。
import { marked, Renderer } from "marked";
import { buildDocCss, isTwoCol, DEFAULT_LAYOUT, type LayoutSettings } from "./templates";
import {
  resumeHeaderData, resumeBodyEditSections,
  type HeaderData, type ResumeBodyEditSection,
} from "./resumeToMarkdown";
import type { Resume } from "@/types";

// 用户正文渲染器：原始 HTML（块级与内联）一律吞掉——旧数据/导入/AI 返回里的
// <script>/<img onerror>/<style> 等都不进 DOM。marked 对文本节点自带转义。
const bodyRenderer = new Renderer();
bodyRenderer.html = () => "";
marked.setOptions({ gfm: true, breaks: false });

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 头像仅允许内联 data:image（png/jpeg/webp），杜绝 javascript:/外链等通路进 DOM（与后端 _PHOTO_RE 一致）
const PHOTO_OK = /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$/;

function headerHtml(h: HeaderData): string {
  const field = (key: string, label: string, value: string) =>
    `<span class="cv-field" data-resume-field="${esc(key)}" data-resume-label="${esc(label)}">${esc(value)}</span>`;
  const fieldLine = (parts: { field: string; label: string; value: string }[]) =>
    parts.map((x) => field(x.field, x.label, x.value)).join(`<span class="cv-field-separator" aria-hidden="true">  ·  </span>`);
  const main = [`  <div class="cv-head-main">`,
    `    <h1 data-resume-field="name" data-resume-label="姓名">${esc(h.name)}</h1>`];
  if (h.tagline) main.push(`    <p class="cv-tagline">${esc(h.tagline)}</p>`);
  if (h.subline) main.push(`    <p class="cv-subline">${h.sublineParts?.length ? fieldLine(h.sublineParts) : esc(h.subline)}</p>`);
  if (h.contacts.length) main.push(`    <p class="cv-contact">${h.contactParts?.length ? fieldLine(h.contactParts) : esc(h.contacts.join("  ·  "))}</p>`);
  if (h.tags.length) main.push(`    <p class="cv-tags">${h.tags.map((x) => `#${esc(x)}`).join("  ")}</p>`);
  main.push(`  </div>`);
  const photo = h.photo && PHOTO_OK.test(h.photo)
    ? `  <img class="cv-photo" src="${esc(h.photo)}" alt="${esc(h.name)}" />` : "";
  return [`<header class="cv-head" data-resume-section="basics">`, ...main, photo, `</header>`].filter(Boolean).join("\n");
}

const mdToHtml = (md: string) => marked.parse(md, { async: false, renderer: bodyRenderer }) as string;

// 每个模块标题和条目分别保留 DOM 边界；可见内容仍全部经 marked 的安全 renderer 输出。
// data-* 只携带本地数据路径，不携带用户文本，供父页面把点击映射回 Zustand 文档。
function editSectionHtml(section: ResumeBodyEditSection): string {
  const heading = `<h2 data-resume-module="${esc(section.key)}">${esc(section.title)}</h2>`;
  const blocks = section.blocks.map((block) => {
    const split = block.headMd !== undefined || block.bodyMd !== undefined;
    const editableField = (field: NonNullable<typeof block.static>["primary"], className = "") =>
      `<span class="cv-static-field ${className}" data-resume-subfield="${esc(`${block.id}.${field.key}`)}" data-resume-field-kind="${esc(field.kind || "text")}" data-resume-label="${esc(field.label)}">${esc(field.value)}</span>`;
    const structuredHead = block.static ? (() => {
      const dates = block.static.start?.value || block.static.end?.value
        ? `<span class="cv-entry-dates">${block.static.start ? editableField(block.static.start) : ""}<span aria-hidden="true"> – </span>${block.static.end ? editableField(block.static.end) : ""}</span>`
        : block.static.date?.value ? `<span class="cv-entry-dates">${editableField(block.static.date)}</span>` : "";
      const details = (block.static.details || []).map((field, index) =>
        `${index ? `<span class="cv-field-separator" aria-hidden="true"> · </span>` : ""}${editableField(field)}`).join("");
      return `<div class="cv-entry-row">${editableField(block.static.primary, "cv-entry-primary")}${dates}</div>`
        + (details ? `<div class="cv-entry-details">${details}</div>` : "");
    })() : "";
    const head = structuredHead || (split ? mdToHtml(block.headMd || "") : "");
    const body = split ? mdToHtml(block.bodyMd || "") : mdToHtml(block.md);
    return `<div class="cv-entry" data-resume-entry="${esc(block.id)}" data-resume-label="${esc(block.label)}">`
      + `${head ? `<div class="cv-entry-static">${head}</div>` : ""}`
      + `<div class="cv-entry-body" data-resume-entry-body>${body}</div></div>`;
  }).join("\n");
  return `<section class="cv-module" data-resume-module-section="${esc(section.key)}">${heading}\n${blocks}</section>`;
}

// 双栏侧栏承载的节（key 见 resumeToMarkdown.resumeBodySections）：求职意向 / 技能 / 证书；
// 头部（照片/姓名/联系）也进侧栏。其余（概要/经历/项目/教育/自定义…）进主栏。
const SIDE_KEYS = new Set(["intent", "skills", "certs"]);

function docShell(title: string, layout: LayoutSettings, inner: string): string {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${buildDocCss(layout)}</style></head>
<body><div class="canvas">${inner}</div></body></html>`;
}

const pageClass = (layout: LayoutSettings, extra = "") =>
  ["page", extra, layout.pageMode === "single" ? "single-page" : ""].filter(Boolean).join(" ");

/** 头部数据 + 正文 md → A4 HTML 文档（单栏）。 */
export function markdownToDoc(bodyMd: string, header: HeaderData, layout: LayoutSettings = DEFAULT_LAYOUT): string {
  return docShell(header.name, layout,
    `<article class="${pageClass(layout)}">${headerHtml(header)}${mdToHtml(bodyMd)}</article>`);
}

/** 便捷入口：从 Resume 直接渲染（预览/缩略图/导出统一走它，头部隐私跟随模板）。 */
export function resumeToDoc(resume: Resume, layout: LayoutSettings = DEFAULT_LAYOUT): string {
  const header = resumeHeaderData(resume, { privacyMinimal: layout.templateId === "ats" });
  const secs = resumeBodyEditSections(resume, "zh");
  if (isTwoCol(layout.templateId)) {
    const sideHtml = secs.filter((s) => SIDE_KEYS.has(s.key)).map(editSectionHtml).join("\n");
    const mainHtml = secs.filter((s) => !SIDE_KEYS.has(s.key)).map(editSectionHtml).join("\n");
    const inner = `<article class="${pageClass(layout, "two-col")}">`
      + `<aside class="col-side">${headerHtml(header)}${sideHtml}</aside>`
      + `<main class="col-main">${mainHtml}</main></article>`;
    return docShell(header.name, layout, inner);
  }
  return docShell(header.name, layout,
    `<article class="${pageClass(layout)}">${headerHtml(header)}${secs.map(editSectionHtml).join("\n")}</article>`);
}
