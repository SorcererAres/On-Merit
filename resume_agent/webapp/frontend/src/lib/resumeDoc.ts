// Markdown -> 完整 HTML 文档（thenextcv 版式：暖灰画布上一张白色 A4 纸）。
// 自包含：内联全部 CSS + 打印规则；渲染进 sandbox iframe（无脚本）。强调色走中性黑。
import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: false });

// thenextcv 文档级 CSS：纸张隐喻 + 干净单栏文档排版 + 打印去画布/阴影。
const DOC_CSS = `
:root{
  --ink:#1a1a1a; --muted:#6b7280; --line:#e5e7eb; --canvas:#f5f5f4;
  --paper:#ffffff; --accent:#1a1a1a; /* 中性黑强调 */
}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{
  background:var(--canvas);
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  color:var(--ink); font-size:14px; line-height:1.5;
  -webkit-font-smoothing:antialiased;
}
.canvas{display:flex;justify-content:center;align-items:flex-start;padding:24px;min-height:100vh;}
/* 固定 A4 宽（794px≈210mm），用 zoom 等比缩放去适配预览栏宽（父组件按栏宽设 --fit）；
   打印时 --fit 强制还原 1，保证 PDF 保真。 */
.page{
  background:var(--paper); width:794px;
  min-height:1123px; padding:56px 64px;
  box-shadow:0 2px 12px rgba(0,0,0,.16); position:relative;
  zoom:var(--fit,1);
}
/* —— 头部 —— */
.cv-head{margin-bottom:20px;}
.cv-head h1{font-size:30px;font-weight:700;line-height:1.15;margin:0;letter-spacing:-.01em;}
.cv-tagline{margin:6px 0 0;font-size:15px;color:var(--ink);font-weight:500;}
.cv-contact{margin:8px 0 0;font-size:12.5px;color:var(--muted);}
/* —— 分节 —— */
.page h2{
  font-size:15px;font-weight:700;text-transform:none;
  margin:22px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--line);
  letter-spacing:.01em;
}
.page h3{font-size:14px;font-weight:700;margin:14px 0 4px;}
.page p{margin:0 0 8px;}
.page strong{font-weight:700;color:var(--ink);}
.page em{color:var(--muted);font-style:italic;}
.page a{color:var(--accent);text-decoration:underline;text-underline-offset:2px;}
.page hr{border:none;border-top:1px solid var(--line);margin:18px 0;}
/* —— 列表 —— */
.page ul,.page ol{margin:6px 0 10px;padding-left:20px;}
.page li{margin:3px 0;}
.page li::marker{color:var(--muted);}
/* —— 表格 —— */
.page table{width:100%;border-collapse:collapse;margin:8px 0 12px;font-size:13.5px;}
.page th,.page td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);vertical-align:top;}
.page th{font-weight:700;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em;}
/* —— 代码/引用 —— */
.page code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;background:#f3f4f6;padding:1px 5px;border-radius:3px;}
.page pre{background:#f6f7f9;border:1px solid var(--line);padding:12px 14px;border-radius:6px;overflow:auto;}
.page pre code{background:none;padding:0;}
.page blockquote{margin:10px 0;padding:4px 14px;border-left:3px solid var(--ink);color:var(--muted);}
.page > *:first-child{margin-top:0;}
/* —— 打印/PDF：去画布与阴影，纸张铺满 —— */
@media print{
  :root{--fit:1 !important;}
  body{background:#fff;}
  .canvas{padding:0;display:block;}
  .page{zoom:1;width:auto;min-height:auto;box-shadow:none;padding:0;}
  .page h2{break-after:avoid;}
  .page li,.page tr{break-inside:avoid;}
  a{color:var(--ink);}
}
@page{size:A4;margin:16mm 14mm;}
`;

export function markdownToDoc(md: string, title = "简历"): string {
  const body = marked.parse(md, { async: false }) as string;
  const safeTitle = title.replace(/[<>&]/g, "");
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title><style>${DOC_CSS}</style></head>
<body><div class="canvas"><article class="page">${body}</article></div></body></html>`;
}
