// 排版模板与样式令牌 → 生成 A4 文档 CSS。
// 结构(BASE)共用；每套模板一层皮肤(SKINS)；样式参数(fontScale/lineHeight/themeColor)注入 CSS 变量。
// templateId/themeColor 白名单与后端 _check_layout 对齐（防注入）。

export interface LayoutSettings {
  templateId: string;
  fontScale: number;
  lineHeight: number;
  themeColor: string;   // 调色板枚举或 #RRGGBB
}

export const DEFAULT_LAYOUT: LayoutSettings = {
  templateId: "classic", fontScale: 1.0, lineHeight: 1.5, themeColor: "ink",
};

export const TEMPLATES: { id: string; name: string; hint: string }[] = [
  { id: "classic", name: "经典", hint: "中性 · 分节线" },
  { id: "modern", name: "现代", hint: "强调色 · 左边条" },
  { id: "minimal", name: "极简", hint: "留白 · 无线" },
  { id: "ats", name: "ATS", hint: "朴素 · 易解析" },
];

export const THEME_COLORS: { id: string; hex: string }[] = [
  { id: "ink", hex: "#1a1a1a" }, { id: "teal", hex: "#0d9488" }, { id: "royal", hex: "#1d4ed8" },
  { id: "rose", hex: "#e11d48" }, { id: "forest", hex: "#15803d" },
];

const HEX = /^#[0-9a-fA-F]{6}$/;
const themeHex = (c: string) => THEME_COLORS.find((t) => t.id === c)?.hex ?? (HEX.test(c) ? c : "#1a1a1a");

const BASE = `
:root{ --muted:#6b7280; --line:#e5e7eb; --canvas:#f5f5f4; --paper:#fff; --accent:#1a1a1a; --fs:1; --lh:1.5; }
*{box-sizing:border-box;} html,body{margin:0;padding:0;}
body{ background:var(--canvas); color:#1a1a1a; -webkit-font-smoothing:antialiased;
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif; }
/* 纵向多页画布（预览由外层分页器把内容切成多张 A4 .page）；单页时视觉与旧版一致 */
.canvas{display:flex;flex-direction:column;align-items:center;gap:24px;padding:24px;min-height:100vh;}
.page{ background:var(--paper); width:794px; min-height:1123px; padding:56px 64px;
  box-shadow:0 2px 12px rgba(0,0,0,.16); position:relative; zoom:var(--fit,1);
  overflow:hidden; /* 屏幕分页后单元超高时不压下页；打印媒体重置为 visible */
  font-size:calc(14px * var(--fs)); line-height:var(--lh); }
.cv-head{margin-bottom:20px;}
.cv-head h1{font-size:calc(30px * var(--fs));font-weight:700;line-height:1.15;margin:0;letter-spacing:-.01em;}
.cv-tagline{margin:6px 0 0;font-size:calc(15px * var(--fs));font-weight:500;}
.cv-subline{margin:6px 0 0;font-size:calc(12.5px * var(--fs));color:var(--muted);}
.cv-contact{margin:8px 0 0;font-size:calc(12.5px * var(--fs));color:var(--muted);}
.cv-tags{margin:8px 0 0;font-size:calc(12px * var(--fs));color:var(--accent);}
.page h2{font-size:calc(15px * var(--fs));font-weight:700;margin:22px 0 12px;padding-bottom:6px;
  border-bottom:1px solid var(--line);}
.page h3{font-size:calc(14px * var(--fs));font-weight:700;margin:14px 0 4px;}
.page p{margin:0 0 8px;}
.page strong{font-weight:700;}
.page em{color:var(--muted);font-style:italic;}
.page a{color:var(--accent);text-decoration:underline;text-underline-offset:2px;}
.page hr{border:none;border-top:1px solid var(--line);margin:18px 0;}
.page ul,.page ol{margin:6px 0 10px;padding-left:20px;}
.page li{margin:3px 0;} .page li::marker{color:var(--muted);}
.page table{width:100%;border-collapse:collapse;margin:8px 0 12px;font-size:calc(13.5px * var(--fs));}
.page th,.page td{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);vertical-align:top;}
.page th{font-weight:700;color:var(--muted);font-size:calc(12px * var(--fs));text-transform:uppercase;letter-spacing:.04em;}
.page blockquote{margin:10px 0;padding:4px 14px;border-left:3px solid var(--accent);color:var(--muted);}
.page > *:first-child{margin-top:0;}
@media print{ :root{--fit:1 !important;} body{background:#fff;} .canvas{padding:0;display:block;gap:0;}
  /* 屏幕分页的多张 .page 在打印时摊平为连续流，由浏览器按 @page 原生分页（导出以此为准） */
  .page{zoom:1;width:auto;min-height:auto;box-shadow:none;padding:0;overflow:visible;} .page h2{break-after:avoid;}
  .page li,.page tr{break-inside:avoid;} a{color:var(--ink,#1a1a1a);} }
@page{size:A4;margin:16mm 14mm;}
`;

const SKINS: Record<string, string> = {
  classic: ``,
  modern: `
    .cv-head h1{color:var(--accent);}
    .page h2{color:var(--accent);border-bottom:none;padding:0 0 0 10px;border-left:3px solid var(--accent);}
    .page{padding:52px 60px;}`,
  minimal: `
    .cv-head h1{font-weight:600;}
    .page h2{border-bottom:none;text-transform:uppercase;letter-spacing:.14em;color:var(--muted);
      font-size:calc(11.5px * var(--fs));margin:24px 0 10px;}
    .page{padding:64px 72px;}
    .page a{text-decoration:none;color:var(--accent);}`,
  ats: `
    .page{font-family:Arial,Helvetica,"PingFang SC","Microsoft YaHei",sans-serif;padding:48px 56px;}
    .cv-head h1{font-size:calc(24px * var(--fs));}
    .page h2{border-bottom:1px solid #333;color:#000;text-transform:uppercase;letter-spacing:.02em;
      font-size:calc(13px * var(--fs));}
    .page a{color:#000;}`,
};

export function buildDocCss(layout: LayoutSettings): string {
  const tid = SKINS[layout.templateId] !== undefined ? layout.templateId : "classic";
  const fs = Math.max(0.85, Math.min(1.25, layout.fontScale || 1));
  const lh = Math.max(1.2, Math.min(2.0, layout.lineHeight || 1.5));
  const vars = `:root{ --accent:${themeHex(layout.themeColor)}; --fs:${fs}; --lh:${lh}; }`;
  return BASE + SKINS[tid] + vars;
}
