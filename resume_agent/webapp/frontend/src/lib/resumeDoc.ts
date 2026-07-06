// Markdown 正文 + 头部结构化数据 → 完整 HTML 文档（A4 纸）。CSS 由模板 + 样式参数生成。
// 安全（见 resume-edit-form-v3.md §3.4）：头部由本模块转义插值拼 HTML（可信路径）；
// 正文经 marked 渲染，renderer.html 吞掉一切原始 HTML token（用户内容零 HTML 通路）；
// 转义在渲染输出层各发生一次，存储/编辑层保存字面文本（不预转义，防双重编码）。
import { marked, Renderer } from "marked";
import { buildDocCss, isTwoCol, DEFAULT_LAYOUT, type LayoutSettings } from "./templates";
import { resumeHeaderData, resumeBodyMd, resumeBodySections, type HeaderData } from "./resumeToMarkdown";
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
  const main = [`  <div class="cv-head-main">`, `    <h1>${esc(h.name)}</h1>`];
  if (h.tagline) main.push(`    <p class="cv-tagline">${esc(h.tagline)}</p>`);
  if (h.subline) main.push(`    <p class="cv-subline">${esc(h.subline)}</p>`);
  if (h.contacts.length) main.push(`    <p class="cv-contact">${esc(h.contacts.join("  ·  "))}</p>`);
  if (h.tags.length) main.push(`    <p class="cv-tags">${h.tags.map((x) => `#${esc(x)}`).join("  ")}</p>`);
  main.push(`  </div>`);
  const photo = h.photo && PHOTO_OK.test(h.photo)
    ? `  <img class="cv-photo" src="${esc(h.photo)}" alt="${esc(h.name)}" />` : "";
  return [`<header class="cv-head">`, ...main, photo, `</header>`].filter(Boolean).join("\n");
}

const mdToHtml = (md: string) => marked.parse(md, { async: false, renderer: bodyRenderer }) as string;

// 双栏侧栏承载的节（key 见 resumeToMarkdown.resumeBodySections）：求职意向 / 技能 / 证书；
// 头部（照片/姓名/联系）也进侧栏。其余（概要/经历/项目/教育/自定义…）进主栏。
const SIDE_KEYS = new Set(["intent", "skills", "certs"]);

function docShell(title: string, layout: LayoutSettings, inner: string): string {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${buildDocCss(layout)}</style></head>
<body><div class="canvas">${inner}</div></body></html>`;
}

/** 头部数据 + 正文 md → A4 HTML 文档（单栏）。 */
export function markdownToDoc(bodyMd: string, header: HeaderData, layout: LayoutSettings = DEFAULT_LAYOUT): string {
  return docShell(header.name, layout, `<article class="page">${headerHtml(header)}${mdToHtml(bodyMd)}</article>`);
}

/** 便捷入口：从 Resume 直接渲染（预览/缩略图/导出统一走它，头部隐私跟随模板）。 */
export function resumeToDoc(resume: Resume, layout: LayoutSettings = DEFAULT_LAYOUT): string {
  const header = resumeHeaderData(resume, { privacyMinimal: layout.templateId === "ats" });
  if (isTwoCol(layout.templateId)) {
    const secs = resumeBodySections(resume, "zh");
    const sideMd = secs.filter((s) => SIDE_KEYS.has(s.key)).map((s) => s.md).join("\n\n");
    const mainMd = secs.filter((s) => !SIDE_KEYS.has(s.key)).map((s) => s.md).join("\n\n");
    const inner = `<article class="page two-col">`
      + `<aside class="col-side">${headerHtml(header)}${mdToHtml(sideMd)}</aside>`
      + `<main class="col-main">${mdToHtml(mainMd)}</main></article>`;
    return docShell(header.name, layout, inner);
  }
  return markdownToDoc(resumeBodyMd(resume, "zh"), header, layout);
}
