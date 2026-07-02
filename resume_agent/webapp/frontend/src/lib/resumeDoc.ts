// Markdown -> 完整 HTML 文档（A4 纸）。CSS 由模板 + 样式参数生成（见 templates.ts）。
// 自包含：内联全部 CSS + 打印规则；渲染进 sandbox iframe（无脚本）。
import { marked } from "marked";
import { buildDocCss, DEFAULT_LAYOUT, type LayoutSettings } from "./templates";

marked.setOptions({ gfm: true, breaks: false });


export function markdownToDoc(md: string, title = "简历", layout: LayoutSettings = DEFAULT_LAYOUT): string {
  const body = marked.parse(md, { async: false }) as string;
  const safeTitle = title.replace(/[<>&]/g, "");
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title><style>${buildDocCss(layout)}</style></head>
<body><div class="canvas"><article class="page">${body}</article></div></body></html>`;
}
