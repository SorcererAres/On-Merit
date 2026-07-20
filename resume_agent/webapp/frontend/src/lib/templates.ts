// 排版模板与样式令牌 → 生成 A4 文档 CSS。
// 结构(BASE)共用；每套模板一层皮肤(SKINS)；样式参数(fontScale/lineHeight/themeColor)注入 CSS 变量。
// templateId/themeColor 白名单与后端 _check_layout 对齐（防注入）。

export interface LayoutSettings {
  templateId: string;
  fontScale: number;
  lineHeight: number;
  moduleSpacing: number;
  pageMode: "auto" | "single";
  themeColor: string;   // 调色板枚举或 #RRGGBB
}

export const DEFAULT_LAYOUT: LayoutSettings = {
  templateId: "classic", fontScale: 1.0, lineHeight: 1.5,
  moduleSpacing: 22, pageMode: "auto", themeColor: "ink",
};

// defaultTheme：选中该模板时顺带设的主题色（可再手动改）；layout 预留双栏引擎（阶段 3）。
export const TEMPLATES: { id: string; name: string; hint: string; defaultTheme?: string; layout?: "single" | "two-col" }[] = [
  { id: "classic", name: "标准", hint: "中性 · 分节线" },
  { id: "cyan", name: "青蓝", hint: "青色节标题 · 左标条", defaultTheme: "teal" },
  { id: "teal", name: "湛青", hint: "顶部色带 · 居中头部", defaultTheme: "teal" },
  { id: "aside", name: "简约", hint: "左侧栏 · 浅底", defaultTheme: "teal", layout: "two-col" },
  { id: "champion", name: "冠军蓝", hint: "深蓝整栏侧边", defaultTheme: "royal", layout: "two-col" },
  { id: "crimson", name: "典藏红", hint: "左侧栏 · 红点线", defaultTheme: "rose", layout: "two-col" },
  { id: "modern", name: "现代", hint: "强调色 · 左边条" },
  { id: "minimal", name: "极简", hint: "留白 · 无线" },
  { id: "ats", name: "ATS", hint: "朴素 · 易解析" },
];

/** 该模板是否双栏（左侧栏 + 右主栏）。双栏走 resumeDoc 的分列渲染 + 跳过分页。 */
export function isTwoCol(templateId: string): boolean {
  return TEMPLATES.find((t) => t.id === templateId)?.layout === "two-col";
}

export const THEME_COLORS: { id: string; hex: string }[] = [
  { id: "ink", hex: "#1a1a1a" }, { id: "teal", hex: "#0d9488" }, { id: "royal", hex: "#1d4ed8" },
  { id: "rose", hex: "#e11d48" }, { id: "forest", hex: "#15803d" },
];

const HEX = /^#[0-9a-fA-F]{6}$/;
const themeHex = (c: string) => THEME_COLORS.find((t) => t.id === c)?.hex ?? (HEX.test(c) ? c : "#1a1a1a");

const BASE = `
:root{ --muted:#6b7280; --line:#e5e7eb; --canvas:#edeef2; --paper:#fff; --accent:#1a1a1a; --fs:1; --lh:1.5; --module-gap:22px; }
/* --canvas 与 tokens.css 的 --resume-canvas 同值（Figma 1004:1018）：iframe 内外灰底无缝拼接 */
*{box-sizing:border-box;} html,body{margin:0;padding:0;}
body{ background:var(--canvas); color:#1a1a1a; -webkit-font-smoothing:antialiased;
  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif; }
/* 纵向多页画布（预览由外层分页器把内容切成多张 A4 .page）；单页时视觉与旧版一致 */
.canvas{display:flex;flex-direction:column;align-items:center;gap:26px;padding:26px 24px;min-height:100vh;}
.page{ background:var(--paper); width:794px; min-height:1123px; padding:56px 64px;
  border-radius:12px; position:relative; zoom:var(--fit,1);
  overflow:hidden; /* 屏幕分页后单元超高时不压下页；打印媒体重置为 visible */
  font-size:calc(14px * var(--fs)); line-height:var(--lh); }
.cv-head{margin-bottom:20px;display:flex;align-items:flex-start;justify-content:space-between;gap:20px;}
.cv-head-main{min-width:0;flex:1;}
.cv-photo{flex:0 0 auto;width:calc(84px * var(--fs));height:calc(84px * var(--fs));object-fit:cover;border-radius:8px;background:var(--line);}
.cv-head h1{font-size:calc(30px * var(--fs));font-weight:700;line-height:1.15;margin:0;letter-spacing:-.01em;}
.cv-tagline{margin:6px 0 0;font-size:calc(15px * var(--fs));font-weight:500;}
.cv-subline{margin:6px 0 0;font-size:calc(12.5px * var(--fs));color:var(--muted);}
.cv-contact{margin:8px 0 0;font-size:calc(12.5px * var(--fs));color:var(--muted);}
.cv-tags{margin:8px 0 0;font-size:calc(12px * var(--fs));color:var(--accent);}
.page h2{font-size:calc(15px * var(--fs));font-weight:700;margin:var(--module-gap) 0 12px;padding-bottom:6px;
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
.cv-entry-row{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin:0 0 5px;}
.cv-entry-primary{font-weight:700;}
.cv-entry-dates{flex:0 0 auto;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap;}
.cv-entry-details{margin:0 0 8px;color:inherit;}
.cv-static-field{display:inline;}
.page > *:first-child{margin-top:0;}
.page.single-page{height:1123px;min-height:1123px;max-height:1123px;overflow:hidden;}
@media print{ :root{--fit:1 !important;} body{background:#fff;} .canvas{padding:0;display:block;gap:0;}
  /* 屏幕分页的多张 .page 在打印时摊平为连续流，由浏览器按 @page 原生分页（导出以此为准） */
  .page{zoom:1;width:auto;min-height:auto;border-radius:0;padding:0;overflow:visible;} .page h2{break-after:avoid;}
  .page.single-page{height:265mm;min-height:265mm;max-height:265mm;overflow:hidden;}
  .page li,.page tr{break-inside:avoid;} a{color:var(--ink,#1a1a1a);} }
@page{size:A4;margin:16mm 14mm;}
`;

// 双栏骨架：.page.two-col = 左 .col-side + 右 .col-main（各自内边距，侧栏底色拉满页高）。
// 双栏不参与分页（见 PreviewCanvas），单页超高时纵向增长不裁切。
const TWO_COL_BASE = `
.page.two-col{display:flex;gap:0;padding:0;overflow:visible;height:auto;align-items:stretch;}
/* 双栏 .page overflow:visible（内容超高纵向增长），圆角靠侧栏自身收边；主栏透明，右侧圆角由 .page 本体呈现 */
.two-col .col-side{flex:0 0 33%;padding:40px 26px;background:var(--side-bg,#f6f7f7);border-radius:12px 0 0 12px;}
.two-col .col-main{flex:1 1 auto;min-width:0;padding:44px 40px;}
.two-col .cv-head{display:block;margin:0 0 20px;text-align:left;}
.two-col .cv-head h1{font-size:calc(23px * var(--fs));}
.two-col .cv-photo{display:block;width:calc(96px * var(--fs));height:calc(96px * var(--fs));border-radius:10px;margin:0 0 14px;}
.two-col .col-side h2{margin:var(--module-gap) 0 8px;font-size:calc(13px * var(--fs));border-bottom:none;
  padding-bottom:0;letter-spacing:.06em;color:var(--accent);}
.two-col .col-side > *:first-child{margin-top:0;}
.two-col .col-side ul{padding-left:16px;} .two-col .col-side p{font-size:calc(13px * var(--fs));}
.two-col .col-main h2:first-of-type{margin-top:0;}
.page.two-col.single-page{height:1123px;min-height:1123px;max-height:1123px;overflow:hidden;}
/* 基础打印规则把 .page min-height 归 auto；双栏需恢复满页高，否则内容短时侧栏底色只到内容底、页面下半留白 */
@media print{ .page.two-col{overflow:visible;min-height:100vh;} .page.two-col.single-page{height:265mm;min-height:265mm;max-height:265mm;overflow:hidden;}
  .two-col .col-side{-webkit-print-color-adjust:exact;print-color-adjust:exact;border-radius:0;} }
`;

const SKINS: Record<string, string> = {
  classic: ``,
  // 青蓝：节标题用强调色 + 左侧小标条 + 同色下划线（对齐图「青蓝」）
  cyan: `
    .cv-head h1{color:var(--accent);}
    .page h2{color:var(--accent);border-bottom:2px solid var(--accent);padding-bottom:5px;display:flex;align-items:center;gap:8px;}
    .page h2::before{content:"";flex:0 0 auto;width:4px;height:calc(15px * var(--fs));background:var(--accent);border-radius:1px;}
    .page a{color:var(--accent);}`,
  // 湛青：全宽顶部色带（出血到页边）+ 居中头部（照片圆形置顶），正文单栏（对齐图「湛青」）
  teal: `
    .cv-head{margin:-56px -64px 24px;padding:34px 64px 26px;background:var(--accent);color:#fff;
      flex-direction:column;align-items:center;text-align:center;}
    .cv-head .cv-photo{order:-1;width:calc(76px * var(--fs));height:calc(76px * var(--fs));
      border-radius:50%;border:3px solid rgba(255,255,255,.7);margin-bottom:8px;}
    .cv-head h1{color:#fff;}
    .cv-head .cv-tagline,.cv-head .cv-subline,.cv-head .cv-contact,.cv-head .cv-tags{color:rgba(255,255,255,.88);}
    .page h2{color:var(--accent);border-bottom:1px solid var(--line);}
    @media print{ .cv-head{margin:0 0 20px;padding:24px;-webkit-print-color-adjust:exact;print-color-adjust:exact;} }`,
  modern: `
    .cv-head h1{color:var(--accent);}
    .page h2{color:var(--accent);border-bottom:none;padding:0 0 0 10px;border-left:3px solid var(--accent);}
    .page{padding:52px 60px;}`,
  minimal: `
    .cv-head h1{font-weight:600;}
    .page h2{border-bottom:none;text-transform:uppercase;letter-spacing:.14em;color:var(--muted);
      font-size:calc(11.5px * var(--fs));margin:var(--module-gap) 0 10px;}
    .page{padding:64px 72px;}
    .page a{text-decoration:none;color:var(--accent);}`,
  ats: `
    .page{font-family:Arial,Helvetica,"PingFang SC","Microsoft YaHei",sans-serif;padding:48px 56px;}
    .cv-head h1{font-size:calc(24px * var(--fs));}
    .page h2{border-bottom:1px solid #333;color:#000;text-transform:uppercase;letter-spacing:.02em;
      font-size:calc(13px * var(--fs));}
    .page a{color:#000;}`,

  // 简约（双栏）：浅灰侧栏 + 强调色节标题带小圆点（对齐图「简约」）
  aside: TWO_COL_BASE + `
    :root{--side-bg:#f5f6f6;}
    .two-col .col-main h2{border-bottom:none;color:var(--accent);display:flex;align-items:center;gap:8px;}
    .two-col .col-main h2::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--accent);}
    .two-col .col-side .cv-contact,.two-col .col-side .cv-subline{color:#374151;}`,

  // 冠军蓝（双栏）：深色整栏侧边（白字）+ 右主栏大标题（对齐图「冠军蓝」）
  champion: TWO_COL_BASE + `
    :root{--side-bg:var(--accent);}
    .two-col .col-side{color:#fff;}
    .two-col .col-side h1,.two-col .col-side h2{color:#fff;}
    .two-col .col-side .cv-tagline,.two-col .col-side .cv-subline,.two-col .col-side .cv-contact,.two-col .col-side .cv-tags{color:rgba(255,255,255,.85);}
    .two-col .col-side h2{border-bottom:1px solid rgba(255,255,255,.35);padding-bottom:4px;}
    .two-col .col-side a{color:#fff;}
    .two-col .col-side li::marker{color:rgba(255,255,255,.6);}
    .two-col .col-main h2{color:var(--accent);}`,

  // 典藏红（双栏）：浅侧栏 + 红强调 + 主栏节标题红点线（对齐图「典藏红」）
  crimson: TWO_COL_BASE + `
    :root{--side-bg:#faf6f6;}
    .two-col .col-main h2{border-bottom:1px dashed var(--accent);color:var(--accent);}
    .two-col .col-side h2{color:var(--accent);}
    .two-col .cv-head h1{color:var(--accent);}`,
};

export function buildDocCss(layout: LayoutSettings): string {
  const tid = SKINS[layout.templateId] !== undefined ? layout.templateId : "classic";
  const fs = Math.max(0.85, Math.min(1.25, layout.fontScale || 1));
  const lh = Math.max(1.2, Math.min(2.0, layout.lineHeight || 1.5));
  const moduleSpacing = Math.max(12, Math.min(36, layout.moduleSpacing || 22));
  const vars = `:root{ --accent:${themeHex(layout.themeColor)}; --fs:${fs}; --lh:${lh}; --module-gap:${moduleSpacing}px; }`;
  return BASE + SKINS[tid] + vars;
}
