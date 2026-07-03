// Markdown 正文 + 头部结构化数据 → 完整 HTML 文档（A4 纸）。CSS 由模板 + 样式参数生成。
// 安全（见 resume-edit-form-v3.md §3.4）：头部由本模块转义插值拼 HTML（可信路径）；
// 正文经 marked 渲染，renderer.html 吞掉一切原始 HTML token（用户内容零 HTML 通路）；
// 转义在渲染输出层各发生一次，存储/编辑层保存字面文本（不预转义，防双重编码）。
import { marked, Renderer } from "marked";
import { buildDocCss, DEFAULT_LAYOUT, type LayoutSettings } from "./templates";
import { resumeHeaderData, resumeBodyMd, type HeaderData } from "./resumeToMarkdown";
import type { Resume } from "@/types";

// 用户正文渲染器：原始 HTML（块级与内联）一律吞掉——旧数据/导入/AI 返回里的
// <script>/<img onerror>/<style> 等都不进 DOM。marked 对文本节点自带转义。
const bodyRenderer = new Renderer();
bodyRenderer.html = () => "";
marked.setOptions({ gfm: true, breaks: false });

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function headerHtml(h: HeaderData): string {
  const lines = [`<header class="cv-head">`, `  <h1>${esc(h.name)}</h1>`];
  if (h.tagline) lines.push(`  <p class="cv-tagline">${esc(h.tagline)}</p>`);
  if (h.subline) lines.push(`  <p class="cv-subline">${esc(h.subline)}</p>`);
  if (h.contacts.length) lines.push(`  <p class="cv-contact">${esc(h.contacts.join("  ·  "))}</p>`);
  if (h.tags.length) lines.push(`  <p class="cv-tags">${h.tags.map((x) => `#${esc(x)}`).join("  ")}</p>`);
  lines.push(`</header>`);
  return lines.join("\n");
}

/** 头部数据 + 正文 md → A4 HTML 文档。 */
export function markdownToDoc(bodyMd: string, header: HeaderData, layout: LayoutSettings = DEFAULT_LAYOUT): string {
  const body = marked.parse(bodyMd, { async: false, renderer: bodyRenderer }) as string;
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(header.name)}</title><style>${buildDocCss(layout)}</style></head>
<body><div class="canvas"><article class="page">${headerHtml(header)}${body}</article></div></body></html>`;
}

/** 便捷入口：从 Resume 直接渲染（预览/缩略图统一走它，头部隐私跟随模板）。 */
export function resumeToDoc(resume: Resume, layout: LayoutSettings = DEFAULT_LAYOUT): string {
  const header = resumeHeaderData(resume, { privacyMinimal: layout.templateId === "ats" });
  return markdownToDoc(resumeBodyMd(resume, "zh"), header, layout);
}
