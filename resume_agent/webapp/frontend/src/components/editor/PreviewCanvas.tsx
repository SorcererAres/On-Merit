// 中栏 · 预览画布：标题栏（预览/原件 tab + AI 润色）+ A4 实时渲染（resumeDoc + --fit 自适应）。
// data/layout 一变即 150ms 防抖重渲；空白简历 → 居中导入 CTA（诚实口径：只重述不编造）。
// printApi：把 iframe 打印函数上抛给顶栏「下载」。
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { resumeToDoc } from "@/lib/resumeDoc";
import { SourcePanel } from "./SourcePanel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { FileText, FileUp, PanelTop, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import type { Resume } from "@/types";
import { AiBusyPill } from "./AiBusyPill";
import { useAiBusyStore } from "@/lib/aiBusy";
import {
  createCanvasInlineEditor, INLINE_BASIC_FIELDS,
  type CanvasInlineSession, type CanvasInlineTarget, type InlineBasicField,
} from "./canvasInlineEditor";

// ---- A4 屏幕分页器 ----
// 由父页面直接操作 iframe 文档（不开 allow-scripts，避免给用户内容开脚本面）：
// 在原始单页布局中差分测量各内容块高度，按 A4 可用高分组重建多张 .page。
// 规则：列表按 li 拆分（跨页克隆列表容器）、标题不落页尾、超高单元独占一页（overflow:hidden 截断）。
// 打印不走此分页：print CSS 将多页摊平为连续流，由浏览器按 @page 原生分页（导出以此为准）。
const A4_HEIGHT = 1123;                    // A4 @96dpi px 高（与 .page min-height 一致）
function paginate(idoc: Document) {
  const canvas = idoc.querySelector(".canvas");
  const first = idoc.querySelector<HTMLElement>(".page");
  const win = idoc.defaultView;
  // 双栏（.two-col）不分页：其子元素是 aside/main 两列，分页会把两列切散；单页纵向增长
  if (!canvas || !first || !win || idoc.querySelectorAll(".page").length > 1
      || first.classList.contains("two-col") || first.classList.contains("single-page")) return;
  const cs = win.getComputedStyle(first);
  const cap = A4_HEIGHT - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if (!(cap > 0)) return;

  // 展平为可分配单元：.page 直接子元素；ul/ol 拆成 li（记录容器模板以便跨页克隆）
  interface Unit { el: HTMLElement; listTpl?: HTMLElement; moduleTpl?: HTMLElement }
  const units: Unit[] = [];
  for (const child of Array.from(first.children) as HTMLElement[]) {
    if (child.matches("[data-resume-module-section]")) {
      for (const moduleChild of Array.from(child.children) as HTMLElement[]) units.push({ el: moduleChild, moduleTpl: child });
    } else if ((child.tagName === "UL" || child.tagName === "OL") && child.children.length > 1) {
      for (const li of Array.from(child.children) as HTMLElement[]) units.push({ el: li, listTpl: child });
    } else units.push({ el: child });
  }
  if (units.length < 2) return;

  // 差分测量（含 margin/collapse）：单元高 = 下一单元 top − 本单元 top；末尾用自身 bottom
  const tops = units.map((u) => u.el.getBoundingClientRect().top);
  const heights = units.map((u, i) =>
    i < units.length - 1 ? tops[i + 1] - tops[i] : u.el.getBoundingClientRect().bottom - tops[i]);

  // 分组装页
  // keep-with-next：H1-3，以及「以 <strong> 开头的段落」（resumeToMarkdown 的职位/学校标题行格式）
  // ——这类单元不许孤悬页尾，与后文一起挪入下页。
  const keepWithNext = (el: HTMLElement) =>
    /^H[123]$/.test(el.tagName) ||
    (el.tagName === "P" && el.firstElementChild?.tagName === "STRONG");
  const pages: Unit[][] = [[]];
  let used = 0;
  units.forEach((u, i) => {
    const cur = pages[pages.length - 1];
    if (cur.length && used + heights[i] > cap) { pages.push([u]); used = heights[i]; return; }
    cur.push(u); used += heights[i];
  });
  for (let p = 0; p < pages.length; p++) {
    const pg = pages[p];
    while (pg.length > 1 && keepWithNext(pg[pg.length - 1].el)) {
      const moved = pg.pop()!;
      if (!pages[p + 1]) pages.push([]);
      pages[p + 1].unshift(moved);
    }
  }
  if (pages.filter((p) => p.length).length < 2) return;   // 实际单页则不动

  // 重建 DOM：单元为「移动」而非克隆（原 first 最后整体移除）
  const frag = idoc.createDocumentFragment();
  for (const pgUnits of pages) {
    if (!pgUnits.length) continue;
    const pg = first.cloneNode(false) as HTMLElement;
    let curList: HTMLElement | null = null;
    let curTpl: HTMLElement | null = null;
    let curModule: HTMLElement | null = null;
    let curModuleTpl: HTMLElement | null = null;
    for (const u of pgUnits) {
      if (u.moduleTpl) {
        curList = null; curTpl = null;
        if (!curModule || curModuleTpl !== u.moduleTpl) {
          curModule = u.moduleTpl.cloneNode(false) as HTMLElement;
          curModuleTpl = u.moduleTpl;
          pg.appendChild(curModule);
        }
        curModule.appendChild(u.el);
      } else if (u.listTpl) {
        curModule = null; curModuleTpl = null;
        if (!curList || curTpl !== u.listTpl) {
          curList = u.listTpl.cloneNode(false) as HTMLElement;
          curTpl = u.listTpl;
          pg.appendChild(curList);
        }
        curList.appendChild(u.el);
      } else { curList = null; curTpl = null; curModule = null; curModuleTpl = null; pg.appendChild(u.el); }
    }
    frag.appendChild(pg);
  }
  first.remove();
  canvas.appendChild(frag);
}

const ZOOM_MIN = 0.5, ZOOM_MAX = 2, ZOOM_STEP = 0.25;

// 只注入编辑器里的 iframe；缩略图与导出 HTML 不携带这些交互皮肤。
// 用背景/outline/box-shadow，不改变字段盒模型，避免 hover/选中造成简历排版跳动。
const INLINE_EDIT_CSS = `
:root{--inline-edit:rgb(74,130,88);--inline-edit-line:rgba(74,130,88,.38);--inline-edit-bg:rgba(112,181,128,.16);--inline-edit-ink:rgb(39,39,42);--inline-edit-muted:rgb(161,161,170);}
/* 编辑器画布接管滚动：iframe 宽高随内容同步、滚动全在外层 wrap——内嵌文档自身永不出滚动条
   （否则缩放高度同步的瞬时差会冒出第二根滚动条）；.canvas 的 min-height:100vh 在编辑器里归零，
   消除「iframe 高度 ↔ 文档 vh」的自指棘轮，applyZoom 才能直接量高、不必先压 0 再量（那会闪帧） */
html,body{overflow:hidden;}
.canvas{min-height:0;}
body.on-merit-inline-edit [data-resume-section="basics"]{outline:1px dashed transparent;outline-offset:8px;border-radius:6px;}
body.on-merit-inline-edit [data-resume-module-section]{outline:1px dashed transparent;outline-offset:8px;border-radius:6px;}
body.on-merit-inline-edit [data-resume-field],body.on-merit-inline-edit [data-resume-subfield],body.on-merit-inline-edit [data-resume-entry]{cursor:pointer;transition:background-color 150ms ease,box-shadow 150ms ease,outline-color 150ms ease;}
body.on-merit-inline-edit [data-resume-field]{border-radius:4px;}
body.on-merit-inline-edit [data-resume-entry]{border-radius:4px;}
body.on-merit-inline-edit [data-resume-field]:focus-visible,body.on-merit-inline-edit [data-resume-entry]:focus-visible{outline:1px solid currentColor;outline-offset:3px;}
body.on-merit-inline-edit [data-resume-field].is-inline-selected{background:var(--inline-edit-bg);box-shadow:0 0 0 3px var(--inline-edit-bg);}
body.on-merit-inline-edit [data-resume-section="basics"]:has(.is-inline-selected){outline-color:var(--inline-edit-line);}
body.on-merit-inline-edit [data-resume-module-section]:has(.is-canvas-editing){outline-color:var(--inline-edit-line);}
body.on-merit-inline-edit .is-canvas-editing{cursor:text!important;background:transparent!important;box-shadow:none!important;}
.canvas-inline-basic{display:inline-block;min-width:7em;max-width:100%;height:1.55em;margin:-.2em 0;padding:.1em .35em;border:1px solid var(--inline-edit);border-radius:4px;background:var(--paper);color:inherit;font:inherit;line-height:1.25;vertical-align:baseline;outline:none;box-shadow:0 0 0 3px rgba(112,181,128,.14);}
.canvas-inline-basic.is-name{min-width:5em;height:1.35em;padding:.02em .2em;font:inherit;font-weight:inherit;}
.canvas-inline-rich{position:relative;margin-top:4px;}
.canvas-inline-toolbar{position:fixed;z-index:4;display:flex;max-width:calc(100vw - 20px);min-height:44px;align-items:center;overflow-x:auto;border:1px solid var(--line);border-radius:10px;background:rgba(255,255,255,.98);box-shadow:0 8px 24px rgba(35,48,38,.14);visibility:hidden;}
.canvas-inline-tool{box-sizing:border-box;display:inline-flex;min-width:44px;min-height:44px;align-items:center;justify-content:center;padding:0 11px;border:0;background:transparent;color:var(--muted);font:inherit;font-size:14px;font-weight:600;white-space:nowrap;cursor:pointer;}
.canvas-inline-tool:hover,.canvas-inline-tool:focus-visible{background:rgba(112,181,128,.12);color:rgb(26,26,26);outline:none;}
.canvas-inline-content{box-sizing:border-box;display:block;width:100%;min-height:96px;padding:8px;border:1px solid rgba(74,130,88,.48);border-radius:5px;background:var(--paper);color:inherit;font:inherit;line-height:inherit;cursor:text;outline:none;}
.canvas-inline-content:focus{border-color:var(--inline-edit);box-shadow:0 0 0 2px rgba(112,181,128,.1);}
.canvas-inline-subfield{display:inline-block;min-width:20px;padding:1px 4px;border:1px solid var(--inline-edit);border-radius:4px;background:var(--paper);color:inherit;font:inherit;outline:none;box-shadow:0 0 0 3px rgba(112,181,128,.14);}
body.on-merit-inline-edit .is-canvas-editing.canvas-inline-subfield{background:var(--paper)!important;box-shadow:0 0 0 3px rgba(112,181,128,.14)!important;}
.canvas-month-panel{position:fixed;z-index:4;width:276px;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--paper);box-shadow:0 8px 24px rgba(35,48,38,.14);}
.canvas-month-header{display:grid;grid-template-columns:44px 1fr 44px;align-items:center;text-align:center;}
.canvas-month-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:4px;}
.canvas-month-option{font-weight:400;}
.canvas-month-option.is-selected{border-radius:5px;background:rgb(26,26,26);color:var(--paper);}
@media (hover:hover) and (pointer:fine){
  body.on-merit-inline-edit [data-resume-section="basics"]:hover{outline-color:var(--inline-edit-line);}
  body.on-merit-inline-edit [data-resume-module-section]:hover{outline-color:var(--inline-edit-line);}
  body.on-merit-inline-edit [data-resume-field]:hover{background:var(--inline-edit-bg);box-shadow:0 0 0 3px var(--inline-edit-bg);}
  body.on-merit-inline-edit [data-resume-entry]:hover{background:rgba(112,181,128,.08);}
}
@media (prefers-reduced-motion:reduce){body.on-merit-inline-edit [data-resume-field],body.on-merit-inline-edit [data-resume-subfield],body.on-merit-inline-edit [data-resume-entry]{transition:none;}}
@media (max-width:520px){.canvas-inline-basic,.canvas-inline-content{font-size:16px}.canvas-inline-tool{padding:0 9px}}
.canvas-module-toolbar{position:fixed;z-index:5;display:flex;min-height:48px;align-items:center;padding:0 8px;border:1px solid rgba(229,231,235,.9);border-radius:10px;background:rgba(255,255,255,.98);box-shadow:0 8px 24px rgba(35,48,38,.14);visibility:hidden;white-space:nowrap;}
.canvas-module-action{box-sizing:border-box;display:inline-flex;min-height:44px;align-items:center;gap:7px;padding:0 12px;border:0;background:transparent;color:var(--inline-edit-ink);font:inherit;font-size:14px;cursor:pointer;}
.canvas-module-action:hover,.canvas-module-action:focus-visible{background:rgba(112,181,128,.12);color:var(--inline-edit-ink);outline:none;}
.canvas-module-action:disabled{color:var(--inline-edit-muted);cursor:not-allowed;background:transparent;}
.canvas-module-icon{display:block;width:18px;height:18px;flex:0 0 auto;}
.canvas-module-separator{width:1px;height:26px;margin:0 2px;background:var(--line);}
body.on-merit-inline-edit [data-resume-module-section].is-module-selected{outline-color:var(--inline-edit-line);}
body.on-merit-inline-edit [data-resume-entry].is-entry-actions-selected{background:rgba(112,181,128,.08)!important;box-shadow:0 0 0 4px rgba(112,181,128,.08)!important;}
@media print{html,body{overflow:visible;}.canvas-inline-toolbar,.canvas-module-toolbar,.canvas-inline-basic{display:none!important}body.on-merit-inline-edit [data-resume-section],body.on-merit-inline-edit [data-resume-module-section],body.on-merit-inline-edit [data-resume-field],body.on-merit-inline-edit [data-resume-entry]{outline:none!important;box-shadow:none!important;background:transparent!important;}}
`;

// 诊断对照卡（右栏报告页打开时注入）：各模块末尾挂「✦ 诊断建议」绿卡，可收起为「查看建议」胶囊。
// 只存在于编辑器 iframe（srcDoc 不变），缩略图/导出/打印均不带；配色沿用画布内联编辑的绿系。
const DIAGNOSIS_ADVICE_CSS = `
.cv-advice{margin-top:10px;}
.cv-advice-card{border-radius:8px;background:rgba(112,181,128,.13);padding:12px 14px 11px;}
.cv-advice-head{display:flex;align-items:center;gap:6px;}
.cv-advice-mark{color:rgb(74,130,88);font-size:13px;line-height:1;}
.cv-advice-title{color:rgb(74,130,88);font-size:12px;font-weight:600;letter-spacing:.02em;}
.cv-advice-fold{margin-left:auto;border:0;background:transparent;color:var(--muted);
  font:inherit;font-size:12px;line-height:1;padding:3px 4px;cursor:pointer;border-radius:4px;}
.cv-advice-fold:hover{color:var(--accent);background:rgba(112,181,128,.14);}
.cv-advice-list{margin:8px 0 0;padding:0;list-style:none;counter-reset:cvadvice;}
.cv-advice-list li{position:relative;margin-top:6px;padding-left:20px;
  font-size:calc(12.5px * var(--fs));line-height:1.7;color:var(--accent);counter-increment:cvadvice;}
.cv-advice-list li::before{content:counter(cvadvice) ".";position:absolute;left:2px;color:rgb(74,130,88);font-weight:600;}
.cv-advice-note{margin-top:10px;font-size:calc(11.5px * var(--fs));color:var(--muted);}
.cv-advice-toggle{display:flex;justify-content:flex-end;}
.cv-advice-open{border:1px solid rgba(74,130,88,.35);border-radius:999px;background:rgba(112,181,128,.10);
  color:rgb(74,130,88);font:inherit;font-size:12px;line-height:1;padding:5px 12px;cursor:pointer;white-space:nowrap;}
.cv-advice-open:hover{background:rgba(112,181,128,.18);}
@media print{.cv-advice{display:none!important}}
`;

type ModuleArrayConfig = { property: keyof Resume; addLabel: string; seed: Record<string, unknown> };
const MODULE_ARRAYS: Record<string, ModuleArrayConfig> = {
  exp: { property: "work", addLabel: "添加工作经历", seed: { name: "" } },
  intern: { property: "internships", addLabel: "添加实习经历", seed: { name: "" } },
  proj: { property: "projects", addLabel: "添加项目经历", seed: { name: "" } },
  org: { property: "organizations", addLabel: "添加社团经历", seed: { name: "" } },
  volunteer: { property: "volunteer", addLabel: "添加志愿经历", seed: { organization: "" } },
  campus: { property: "campus", addLabel: "添加校园经历", seed: { name: "" } },
  thesis: { property: "thesis", addLabel: "添加论文经历", seed: { title: "" } },
  comp: { property: "competitions", addLabel: "添加竞赛经历", seed: { name: "" } },
  awards: { property: "awards", addLabel: "添加荣誉", seed: { title: "" } },
  edu: { property: "education", addLabel: "添加教育经历", seed: { institution: "" } },
  certs: { property: "certificates", addLabel: "添加证书", seed: { name: "" } },
};

function removeResumeEntry(resume: Resume, key: string, entryId: string): Resume {
  const next = { ...resume };
  const arrayConfig = MODULE_ARRAYS[key];
  const match = entryId.match(/^([a-z_]+)\.(\d+)$/);
  if (arrayConfig && match?.[1] === arrayConfig.property) {
    const index = Number(match[2]);
    const items = next[arrayConfig.property];
    next[arrayConfig.property] = Array.isArray(items) ? items.filter((_, itemIndex) => itemIndex !== index) : [];
  } else if (key === "intent") {
    delete next.job_intent;
  } else if (key === "summary") {
    next.basics = { ...next.basics, summary: undefined };
  } else if (key === "metrics") {
    const meta = { ...(next.meta || {}) };
    delete meta.metrics;
    next.meta = meta;
  } else if (key === "skills") {
    delete next.skills;
    delete next.skills_md;
  } else if (key.startsWith("custom:")) {
    const index = Number(key.slice("custom:".length));
    next.custom_sections = (next.custom_sections || []).filter((_, itemIndex) => itemIndex !== index);
  }
  return next;
}

function movedInlineTarget(target: CanvasInlineTarget, oldEntryId: string, newEntryId: string): CanvasInlineTarget {
  if (target.kind === "subfield" && target.id.startsWith(`${oldEntryId}.`)) {
    return { ...target, id: `${newEntryId}${target.id.slice(oldEntryId.length)}` };
  }
  return { kind: "entry", id: newEntryId, label: target.label };
}

const isInlineBasicField = (value: string): value is InlineBasicField =>
  (INLINE_BASIC_FIELDS as readonly string[]).includes(value);

interface ModuleToolbarSession {
  remove: () => void;
  reposition: () => void;
}

// 空白：basics 无实质字段且各段落均无含实值条目（沿用诊断视图的判定）
function hasVal(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.some(hasVal);
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).some(hasVal);
  return true;
}
// 内容承载字段（固定节 + 扩展模块 + v3 新字段）任一有值即非空白——否则只有扩展模块内容的
// 简历会被误判空白、被导入 CTA 挡住预览。
const CONTENT_KEYS = [
  "work", "projects", "education", "skills", "skills_md", "job_intent", "internships",
  "organizations", "volunteer", "campus", "thesis", "competitions", "awards",
  "certificates", "custom_sections",
] as const;
export function isBlankResume(r: Resume | null): boolean {
  if (!r) return true;
  const b = r.basics || {};
  const basicsHas = [b.name, b.email, b.phone, b.summary, b.url, b.wechat, b.hometown]
    .some((x) => !!x?.trim?.()) || hasVal(b.tags);
  return !basicsHas && !CONTENT_KEYS.some((k) => hasVal((r as Record<string, unknown>)[k]));
}

export function PreviewCanvas({ device, showPolish, onImport, printApi, leftAccessory, rightAccessory }: {
  device: "desktop" | "mobile";
  showPolish: boolean;              // 诊断模式提供原件对照 tab
  onImport: () => void;
  printApi: (fn: () => void) => void;   // 上抛打印函数（顶栏「下载」/样式面板「导出 PDF」共用）
  // 标题栏两端插槽（侧栏折叠时放「展开」按钮；内嵌进栏内，避免悬浮遮挡 tab 图标）
  leftAccessory?: React.ReactNode;
  rightAccessory?: React.ReactNode;
}) {
  const resume = useStore((s) => s.resume);
  const layout = useStore((s) => s.layoutSettings);
  const sourceText = useStore((s) => s.sourceText);
  const aiBusy = useAiBusyStore((s) => s.current);
  // 诊断对照：报告页打开且「对照诊改」开关开启时取报告里的模块级建议（section_advice 引用稳定，不引发多余重渲）
  const diagAdvice = useStore((s) =>
    s.diagnosisReportOpen && s.diagnosisOverlayOn && s.diagnosis
      ? s.diagnosis.report.evalResult.evaluation.section_advice ?? null : null);
  const diagStale = useStore((s) => !!s.diagnosis && (
    s.diagnosis.stamp.contentSeq !== s.contentSeq || s.diagnosis.stamp.jd !== s.jd || s.diagnosis.stamp.role !== s.role));
  const [tab, setTab] = useState<"preview" | "source">("preview");
  const [doc, setDoc] = useState("");
  const [docKey, setDocKey] = useState(0);  // 内容变化即重挂 iframe：加载标记随实例失效，杜绝「同实例新导航」误判
  const [zoom, setZoom] = useState<"fit" | number>("fit");   // 'fit'=适应宽度；数值=手动缩放（0.5–2）
  const inlineSessionRef = useRef<CanvasInlineSession | null>(null);
  const moduleToolbarRef = useRef<ModuleToolbarSession | null>(null);
  const pendingInlineTargetRef = useRef<CanvasInlineTarget | null>(null);
  const frameResizeRef = useRef<() => void>(() => undefined);
  const autoFitRef = useRef(1);              // 最近一次「适应宽度」计算值（手动步进的起点）
  const wrapRef = useRef<HTMLDivElement>(null);
  const zoneRef = useRef<HTMLDivElement>(null);   // 画布整区（灰底 + 悬浮控件）：⌘+滚轮缩放的命中范围
  const innerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const docRef = useRef(doc); docRef.current = doc;
  const tabRef = useRef(tab); tabRef.current = tab;
  const loadedDocRef = useRef("");          // 最近一次 iframe load 完成时对应的 doc（打印新鲜度判据）
  const loadedFrameRef = useRef<HTMLIFrameElement | null>(null);  // 该 load 所属实例——重挂后旧值失效
  const pendingPrint = useRef<string | null>(null);   // 待打印的目标 doc；null=无 pending
  const blank = isBlankResume(resume);

  const installInlineEditing = useCallback((idoc: Document) => {
    let toolbarHideTimer: number | undefined;
    const cancelToolbarHide = () => {
      if (toolbarHideTimer !== undefined) window.clearTimeout(toolbarHideTimer);
      toolbarHideTimer = undefined;
    };
    const hideToolbarIfIdle = () => {
      cancelToolbarHide();
      if (inlineSessionRef.current) return;
      moduleToolbarRef.current?.remove();
      moduleToolbarRef.current = null;
    };
    const scheduleToolbarHide = () => {
      if (inlineSessionRef.current) return;
      cancelToolbarHide();
      toolbarHideTimer = window.setTimeout(hideToolbarIfIdle, 140);
    };
    moduleToolbarRef.current?.remove();
    moduleToolbarRef.current = null;
    if (!idoc.head.querySelector("#on-merit-inline-edit-style")) {
      const style = idoc.createElement("style");
      style.id = "on-merit-inline-edit-style";
      style.textContent = INLINE_EDIT_CSS;
      idoc.head.appendChild(style);
    }
    idoc.body.classList.add("on-merit-inline-edit");
    idoc.querySelectorAll<HTMLElement>("[data-resume-field], [data-resume-subfield], [data-resume-entry]").forEach((node) => {
      const label = node.dataset.resumeLabel || "简历字段";
      node.tabIndex = 0;
      node.setAttribute("role", "button");
      node.setAttribute("aria-label", `编辑${label}`);
      node.title = `点击编辑${label}`;
    });
    const showModuleToolbar = (module: HTMLElement, anchor: HTMLElement, target: CanvasInlineTarget) => {
      cancelToolbarHide();
      moduleToolbarRef.current?.remove();
      const key = module.dataset.resumeModuleSection || "";
      const entryId = anchor.dataset.resumeEntry || "";
      if (!key || !entryId) return;
      const title = anchor.dataset.resumeLabel || target.label;
      const toolbar = idoc.createElement("div");
      toolbar.className = "canvas-module-toolbar";
      toolbar.setAttribute("role", "toolbar");
      toolbar.setAttribute("aria-label", `${title}条目操作`);

      const separator = () => {
        const node = idoc.createElement("span");
        node.className = "canvas-module-separator";
        node.setAttribute("aria-hidden", "true");
        return node;
      };
      const actionIcon = (kind: "add" | "delete" | "up" | "down") => {
        const svg = idoc.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.classList.add("canvas-module-icon");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "none");
        svg.setAttribute("stroke", "currentColor");
        svg.setAttribute("stroke-width", "2");
        svg.setAttribute("stroke-linecap", "round");
        svg.setAttribute("stroke-linejoin", "round");
        svg.setAttribute("aria-hidden", "true");
        const path = (d: string) => {
          const node = idoc.createElementNS("http://www.w3.org/2000/svg", "path");
          node.setAttribute("d", d);
          svg.appendChild(node);
        };
        if (kind === "add") {
          const circle = idoc.createElementNS("http://www.w3.org/2000/svg", "circle");
          circle.setAttribute("cx", "12"); circle.setAttribute("cy", "12"); circle.setAttribute("r", "9");
          svg.appendChild(circle); path("M12 8v8M8 12h8");
        } else if (kind === "delete") {
          path("M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v5M14 11v5");
        } else if (kind === "up") path("m6 15 6-6 6 6");
        else path("m6 9 6 6 6-6");
        return svg;
      };
      const action = (icon: "add" | "delete" | "up" | "down", label: string, handler: () => void, disabled = false) => {
        const button = idoc.createElement("button");
        button.type = "button";
        button.className = "canvas-module-action";
        button.disabled = disabled;
        button.setAttribute("aria-label", label);
        const labelNode = idoc.createElement("span");
        labelNode.textContent = label;
        button.append(actionIcon(icon), labelNode);
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!button.disabled) handler();
        });
        return button;
      };
      const commitDraft = () => inlineSessionRef.current?.commit();
      const arrayConfig = MODULE_ARRAYS[key];
      const entryMatch = entryId.match(/^([a-z_]+)\.(\d+)$/);
      const entryIndex = entryMatch && entryMatch[1] === arrayConfig?.property ? Number(entryMatch[2]) : -1;
      const currentItems = arrayConfig ? useStore.getState().resume?.[arrayConfig.property] : undefined;
      const entryCount = Array.isArray(currentItems) ? currentItems.length : 0;

      if (arrayConfig) {
        toolbar.append(action("add", arrayConfig.addLabel, () => {
          commitDraft();
          const state = useStore.getState();
          if (!state.resume) return;
          const previous = state.resume[arrayConfig.property];
          const items = Array.isArray(previous) ? previous : [];
          const nextIndex = items.length;
          pendingInlineTargetRef.current = {
            kind: "entry", id: `${String(arrayConfig.property)}.${nextIndex}`, label: arrayConfig.addLabel.replace(/^添加/, ""),
          };
          state.editResumeFromPreview({
            ...state.resume,
            [arrayConfig.property]: [...items, { ...arrayConfig.seed }],
          });
        }));
        toolbar.append(separator());
      }
      toolbar.append(action("delete", "删除", () => {
        const view = idoc.defaultView;
        if (view && !view.confirm(`确定删除“${title}”吗？`)) return;
        commitDraft();
        const state = useStore.getState();
        if (state.resume) state.editResumeFromPreview(removeResumeEntry(state.resume, key, entryId));
      }));
      if (arrayConfig) {
        toolbar.append(separator());
        toolbar.append(action("up", "上移", () => {
          commitDraft();
          const state = useStore.getState();
          if (!state.resume) return;
          const previous = state.resume[arrayConfig.property];
          if (!Array.isArray(previous) || entryIndex <= 0 || entryIndex >= previous.length) return;
          const items = [...previous];
          [items[entryIndex - 1], items[entryIndex]] = [items[entryIndex], items[entryIndex - 1]];
          pendingInlineTargetRef.current = movedInlineTarget(target, entryId, `${String(arrayConfig.property)}.${entryIndex - 1}`);
          state.editResumeFromPreview({ ...state.resume, [arrayConfig.property]: items });
        }, entryIndex <= 0));
        toolbar.append(separator());
        toolbar.append(action("down", "下移", () => {
          commitDraft();
          const state = useStore.getState();
          if (!state.resume) return;
          const previous = state.resume[arrayConfig.property];
          if (!Array.isArray(previous) || entryIndex < 0 || entryIndex >= previous.length - 1) return;
          const items = [...previous];
          [items[entryIndex], items[entryIndex + 1]] = [items[entryIndex + 1], items[entryIndex]];
          pendingInlineTargetRef.current = movedInlineTarget(target, entryId, `${String(arrayConfig.property)}.${entryIndex + 1}`);
          state.editResumeFromPreview({ ...state.resume, [arrayConfig.property]: items });
        }, entryIndex < 0 || entryIndex >= entryCount - 1));
      }

      idoc.body.appendChild(toolbar);
      module.classList.add("is-module-selected");
      anchor.classList.add("is-entry-actions-selected");
      const reposition = () => {
        if (!toolbar.isConnected || !anchor.isConnected) return;
        const anchorRect = anchor.getBoundingClientRect();
        const toolbarRect = toolbar.getBoundingClientRect();
        const viewportWidth = idoc.documentElement.clientWidth;
        const left = Math.max(10, Math.min(viewportWidth - toolbarRect.width - 10, anchorRect.right - toolbarRect.width));
        toolbar.style.left = `${left}px`;
        toolbar.style.top = `${anchorRect.bottom + 6}px`;
        toolbar.style.visibility = "visible";
      };
      const session: ModuleToolbarSession = {
        reposition,
        remove: () => {
          module.classList.remove("is-module-selected");
          anchor.classList.remove("is-entry-actions-selected");
          toolbar.remove();
        },
      };
      moduleToolbarRef.current = session;
      toolbar.addEventListener("mouseenter", cancelToolbarHide);
      toolbar.addEventListener("mouseleave", scheduleToolbarHide);
      toolbar.addEventListener("focusin", cancelToolbarHide);
      toolbar.addEventListener("focusout", scheduleToolbarHide);
      window.requestAnimationFrame(reposition);
    };
    // 小模块操作采用 hover/focus 触发；浮条与条目之间留有 6px 间隙，短暂延迟避免鼠标跨越间隙时闪退。
    idoc.querySelectorAll<HTMLElement>("[data-resume-entry]").forEach((entry) => {
      const showEntryActions = () => {
        if (inlineSessionRef.current) return;
        const module = entry.closest<HTMLElement>("[data-resume-module-section]");
        const entryId = entry.dataset.resumeEntry || "";
        if (!module || !entryId) return;
        showModuleToolbar(module, entry, {
          kind: "entry", id: entryId, label: entry.dataset.resumeLabel || "简历条目",
        });
      };
      entry.addEventListener("mouseenter", showEntryActions);
      entry.addEventListener("mouseleave", scheduleToolbarHide);
      entry.addEventListener("focusin", () => showEntryActions());
      entry.addEventListener("focusout", scheduleToolbarHide);
    });
    const openEditor = (node: HTMLElement, target: CanvasInlineTarget, pointer?: { x: number; y: number }) => {
      const module = node.closest<HTMLElement>("[data-resume-module-section]");
      const entry = node.closest<HTMLElement>("[data-resume-entry]");
      if (module && entry) showModuleToolbar(module, entry, target);
      else { moduleToolbarRef.current?.remove(); moduleToolbarRef.current = null; }
      inlineSessionRef.current = createCanvasInlineEditor({
        doc: idoc, node, target, pointer,
        onFinish: () => {
          inlineSessionRef.current = null;
          moduleToolbarRef.current?.remove();
          moduleToolbarRef.current = null;
        },
        onResize: () => window.requestAnimationFrame(() => {
          frameResizeRef.current();
          moduleToolbarRef.current?.reposition();
        }),
      });
    };
    const activate = (event: Event) => {
      const node = (event.target as Element | null)?.closest<HTMLElement>("[data-resume-field], [data-resume-subfield], [data-resume-entry]");
      const field = node?.dataset.resumeField || "";
      const subfield = node?.dataset.resumeSubfield || "";
      const entry = node?.dataset.resumeEntry || "";
      let target: CanvasInlineTarget | null = null;
      if (node && isInlineBasicField(field)) target = { kind: "field", id: field, label: node.dataset.resumeLabel || "基础信息" };
      else if (node && subfield) target = { kind: "subfield", id: subfield, label: node.dataset.resumeLabel || "条目信息",
        valueKind: (node.dataset.resumeFieldKind as "text" | "month" | "csv") || "text" };
      else if (node && entry) target = { kind: "entry", id: entry, label: node.dataset.resumeLabel || "简历模块" };
      const active = inlineSessionRef.current;
      if (!target || !node) { active?.commit(); return; }
      if (active?.node === node) return;
      event.preventDefault();
      event.stopPropagation();
      const mouseEvent = event as MouseEvent;
      const pointer = Number.isFinite(mouseEvent.clientX) && Number.isFinite(mouseEvent.clientY)
        ? { x: mouseEvent.clientX, y: mouseEvent.clientY } : undefined;
      if (active) {
        const changed = active.commit();
        if (changed) pendingInlineTargetRef.current = target;
        else openEditor(node, target, pointer);
        return;
      }
      openEditor(node, target, pointer);
    };
    idoc.addEventListener("click", activate);
    idoc.addEventListener("keydown", (event) => {
      if (!inlineSessionRef.current && (event.key === "Enter" || event.key === " ")) activate(event);
    });
    const pending = pendingInlineTargetRef.current;
    if (pending) {
      pendingInlineTargetRef.current = null;
      const selector = pending.kind === "field" ? `[data-resume-field="${pending.id}"]`
        : pending.kind === "subfield" ? `[data-resume-subfield="${pending.id}"]` : `[data-resume-entry="${pending.id}"]`;
      const node = idoc.querySelector<HTMLElement>(selector);
      if (node) openEditor(node, pending);
    }
  }, []);

  // ---- 诊断对照卡 ----
  // 报告页打开时，把 section_advice 按模块注入 iframe（挂在各模块末尾，与内容就地对照）；
  // 收起态记在 ref：内容重渲/重挂后保留用户的收起选择。DOM 全部即时构建，不进 srcDoc。
  const diagAdviceRef = useRef(diagAdvice); diagAdviceRef.current = diagAdvice;
  const diagStaleRef = useRef(diagStale); diagStaleRef.current = diagStale;
  const adviceFoldedRef = useRef<Set<string>>(new Set());
  const syncAdviceCards = useCallback(() => {
    const idoc = iframeRef.current?.contentDocument;
    if (!idoc?.body) return;
    if (!idoc.head.querySelector("#on-merit-advice-style")) {
      const style = idoc.createElement("style");
      style.id = "on-merit-advice-style";
      style.textContent = DIAGNOSIS_ADVICE_CSS;
      idoc.head.appendChild(style);
    }
    idoc.querySelectorAll(".cv-advice").forEach((node) => node.remove());
    const advice = diagAdviceRef.current;
    if (advice) {
      // 分页后同一模块可能跨页拆成多段：卡挂在最后一段末尾（即模块内容结束处）
      const hosts = new Map<string, HTMLElement>();
      idoc.querySelectorAll<HTMLElement>("[data-resume-module-section]").forEach((el) => {
        const key = el.dataset.resumeModuleSection;
        if (key) hosts.set(key, el);
      });
      for (const [key, items] of Object.entries(advice)) {
        const host = items?.length ? hosts.get(key) : undefined;
        if (!host) continue;
        const wrap = idoc.createElement("div");
        wrap.className = "cv-advice";
        const render = () => {
          wrap.textContent = "";
          if (adviceFoldedRef.current.has(key)) {
            const row = idoc.createElement("div");
            row.className = "cv-advice-toggle";
            const open = idoc.createElement("button");
            open.type = "button";
            open.className = "cv-advice-open";
            open.setAttribute("aria-expanded", "false");
            open.textContent = "查看建议 ⌄";
            open.addEventListener("click", (event) => {
              event.stopPropagation();
              adviceFoldedRef.current.delete(key);
              render();
              frameResizeRef.current();
            });
            row.appendChild(open);
            wrap.appendChild(row);
            return;
          }
          const card = idoc.createElement("div");
          card.className = "cv-advice-card";
          card.setAttribute("role", "note");
          card.setAttribute("aria-label", "诊断建议");
          const head = idoc.createElement("div");
          head.className = "cv-advice-head";
          const mark = idoc.createElement("span");
          mark.className = "cv-advice-mark";
          mark.setAttribute("aria-hidden", "true");
          mark.textContent = "✦";
          const title = idoc.createElement("span");
          title.className = "cv-advice-title";
          title.textContent = "诊断建议";
          const fold = idoc.createElement("button");
          fold.type = "button";
          fold.className = "cv-advice-fold";
          fold.setAttribute("aria-expanded", "true");
          fold.textContent = "收起 ⌃";
          fold.addEventListener("click", (event) => {
            event.stopPropagation();
            adviceFoldedRef.current.add(key);
            render();
            frameResizeRef.current();
          });
          head.append(mark, title, fold);
          const list = idoc.createElement("ol");
          list.className = "cv-advice-list";
          for (const text of items) {
            const li = idoc.createElement("li");
            li.textContent = text;
            list.appendChild(li);
          }
          const note = idoc.createElement("p");
          note.className = "cv-advice-note";
          note.textContent = diagStaleRef.current
            ? "注意：报告基于旧内容，建议可能已过时；请只补充真实信息，不要编造。"
            : "注意：建议仅供参考，请只补充真实信息，不要编造。";
          card.append(head, list, note);
          wrap.appendChild(card);
        };
        render();
        host.appendChild(wrap);
      }
    }
    frameResizeRef.current();
  }, []);
  // 报告开/关、换报告、过期态变化 → 重同步；iframe 重挂时由 onFrameLoad 兜底再注入
  useEffect(() => { syncAdviceCards(); }, [diagAdvice, diagStale, syncAdviceCards]);

  // iframe 外的任意点击都视为离开画布编辑区，并提交当前改动。
  useEffect(() => {
    const commitOutside = () => inlineSessionRef.current?.commit();
    document.addEventListener("pointerdown", commitOutside, true);
    return () => document.removeEventListener("pointerdown", commitOutside, true);
  }, []);

  // 排版模式（showPolish=false）不提供原件对照：强制收回预览，避免样式调整不可见、导出落空
  useEffect(() => { if (!showPolish && tab === "source") setTab("preview"); }, [showPolish, tab]);

  // data + layout → 防抖重渲；内容真变才导航（setDoc+bump key 重挂），空白时顺带取消待打印
  useEffect(() => {
    const id = window.setTimeout(() => {
      const next = resume && !blank ? resumeToDoc(resume, layout) : "";
      if (!next) pendingPrint.current = null;
      if (next !== docRef.current) { setDoc(next); setDocKey((k) => k + 1); }
    }, 150);
    return () => window.clearTimeout(id);
  }, [resume, layout, blank]);

  // 缩放：'fit' 按 iframe 实际容器宽自适应（手机=390px 内层，桌面=工作区宽）；数值=手动倍率。
  // 设定后把 iframe 高度同步为文档内容高：滚动全交给外层画布（单一连续灰底、单一滚动条）。
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const applyZoom = () => {
    const iframe = iframeRef.current;
    const idoc = iframe?.contentDocument;
    const inner = innerRef.current;
    if (!iframe || !idoc?.documentElement || !inner) return;
    // 布局中途（面板/iframe 刚挂载）宽度可能量到 0：跳过本次并下一帧重试——
    // 若照算会把 autoFit 污染成下限 0.3，且 RO 只观察 wrap、未必再触发纠正。
    if (!(inner.clientWidth > 0)) { requestAnimationFrame(() => frameResizeRef.current()); return; }
    autoFitRef.current = Math.max(0.3, Math.min(1, (inner.clientWidth - 32) / 794));
    const z = zoomRef.current;
    const scale = z === "fit" ? autoFitRef.current : z;
    idoc.documentElement.style.setProperty("--fit", String(scale));
    // 内容真正超出容器宽时才把 iframe 撑到内容宽：横向滚动交给外层 wrap（与纵向同一套）；
    // 内嵌文档 html,body 已注入 overflow:hidden，自身永不出滚动条。
    // 判据必须用「未夹取」的适应比：autoFit 上限夹取到 1，宽画布上 1.x 倍虽放得下也会误判，
    // iframe 被设成比容器窄的定宽 → 块级左对齐，纸张整体跑到左边；
    // 另不直接比 contentW>容器宽，是给 fit 公式允许的 16px 出血留余量（否则「适应」态平白出横滚）。
    const fitCap = (inner.clientWidth - 32) / 794;
    const contentW = Math.ceil(794 * scale) + 48;   // 48 = .canvas 左右 padding 24×2
    iframe.style.width = scale > fitCap ? `${contentW}px` : "";
    // .canvas 的 min-height:100vh 已在编辑器注入 CSS 中归零：scrollHeight 即纯内容高，
    // 无自指棘轮，直接量——旧做法「先压 0 再量」每个缩放刻度都会闪一帧。
    iframe.style.height = `${idoc.documentElement.scrollHeight}px`;
  };
  frameResizeRef.current = applyZoom;
  // 布局提交后应用（device/tab/zoom 切换即刻生效）；滚轮路径已同帧应用，这里是幂等兜底
  useEffect(() => {
    const t = window.setTimeout(applyZoom, 0);
    return () => window.clearTimeout(t);
  }, [device, tab, blank, zoom]);
  // 容器尺寸变化（窗口/面板拖拽）兜底。只观察 wrap：它的尺寸与内容无关——若把 inner/iframe
  // 也纳入观察，缩放引起的内容尺寸变化会回触观察器，每个滚轮刻度多跑数次 applyZoom（缩放发抖）。
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => frameResizeRef.current());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [tab, blank]);
  const clampZoom = (v: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v));
  const stepZoom = (dir: 1 | -1) => setZoom((z) => {
    const base = z === "fit" ? autoFitRef.current : z;
    return clampZoom(Math.round((base + dir * ZOOM_STEP) / ZOOM_STEP) * ZOOM_STEP);
  });
  // ⌘（mac）/ Ctrl（win，兼触控板捏合）+ 滚轮 → 连续缩放。指数映射：步幅与当前倍率成比例，
  // 大小倍率下手感一致；deltaMode=1（行滚动）折算为像素。
  // 丝滑关键：不走「setState → effect → setTimeout」的 React 管线（每刻度慢两拍以上），
  // 滚轮事件里同帧完成「算倍率 → 应用尺寸 → 光标锚定修正滚动」；state 只驱动倍率标签。
  const wheelZoom = useCallback((e: WheelEvent) => {
    if (!e.metaKey && !e.ctrlKey) return;
    e.preventDefault();
    const wrap = wrapRef.current;
    if (!wrap) return;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const old = zoomRef.current === "fit" ? autoFitRef.current : zoomRef.current;
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, old * Math.exp(-dy * 0.0022)));
    if (next !== old) {
      // 光标锚定：缩放前后光标下的内容点保持不动。iframe 内事件的 clientX/Y 以其视口为
      // 原点（iframe 不缩放不滚动，像素与父页 1:1），加 iframe 偏移即折算回父视口坐标。
      const rect = wrap.getBoundingClientRect();
      const frame = e.view !== window ? iframeRef.current?.getBoundingClientRect() : null;
      const cx = (frame ? frame.left : 0) + e.clientX - rect.left;
      const cy = (frame ? frame.top : 0) + e.clientY - rect.top;
      const k = next / old;
      zoomRef.current = next;      // 先写 ref：applyZoom 同帧读到新倍率
      frameResizeRef.current();    // 应用 --fit + iframe 宽高同步
      wrap.scrollLeft = k * (wrap.scrollLeft + cx) - cx;
      wrap.scrollTop = k * (wrap.scrollTop + cy) - cy;
    }
    setZoom(next);
  }, []);
  // 编辑器全域兜底（window 捕获阶段）：Chrome/Edge 的「⌘/Ctrl+滚轮」是浏览器整页缩放，
  // 光标落在左右面板/顶栏/空白态等无监听区域时会把整个界面放大——因此只要按着修饰键滚动
  // 就一律 preventDefault；仅当光标位于画布区（zoneRef）且在预览 tab 时才真正缩放画布。
  // iframe 内的滚轮属于内嵌文档、到不了父 window，由 onFrameLoad 里挂的 idoc 监听处理。
  useEffect(() => {
    const guard = (e: WheelEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      const zone = zoneRef.current;
      if (tabRef.current === "preview" && zone && e.target instanceof Node && zone.contains(e.target)) wheelZoom(e);
    };
    window.addEventListener("wheel", guard, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", guard, true);
  }, [wheelZoom]);

  const printNow = () => {
    const win = iframeRef.current?.contentWindow;
    const idoc = iframeRef.current?.contentDocument;
    if (!win) return;
    const go = () => win.print();
    if (idoc && (idoc as any).fonts?.ready) (idoc as any).fonts.ready.then(go).catch(go);
    else go();
  };
  // 打印（顶栏「下载」与样式面板「导出 PDF」都走这里）：
  // 空白 → 提示；仅当「目标内容已完成 iframe load」（fresh === loadedDocRef）才直接打印；
  // 其余（防抖窗口内容未渲/正在加载/原件 tab 需重挂）一律 pendingPrint + onLoad 后打印。
  useEffect(() => {
    printApi(() => {
      inlineSessionRef.current?.commit();
      const s = useStore.getState();
      if (isBlankResume(s.resume)) { toast.error("简历还是空的，请先导入或填写内容"); return; }
      const fresh = resumeToDoc(s.resume!, s.layoutSettings);
      const needsRemount = tabRef.current === "source";
      // 直接打印仅当：无需重挂 + 目标内容已完成 load + 且是「当前这只 iframe」完成的
      //（内容一变就换 key 重挂 → 旧实例的加载标记天然失效，无「同实例新导航」窗口）
      const ready = !needsRemount && fresh === loadedDocRef.current
        && loadedFrameRef.current !== null && loadedFrameRef.current === iframeRef.current;
      if (ready) { printNow(); return; }
      pendingPrint.current = fresh;
      if (needsRemount) setTab("preview");
      if (fresh !== docRef.current) { setDoc(fresh); setDocKey((k) => k + 1); }
      // fresh === doc 时为在途 load（未完成），等 onFrameLoad 消费 pending
    });
  }, [printApi]);
  const onFrameLoad = () => {
    loadedDocRef.current = docRef.current;  // 该 load 对应当前已提交的 srcDoc（key 保证一实例一文档）
    loadedFrameRef.current = iframeRef.current;
    // 先分页（zoom=1 的原始布局下测量最准），再应用缩放与高度同步
    const idoc = iframeRef.current?.contentDocument;
    if (idoc) {
      try { paginate(idoc); } catch { /* 分页失败退回单长页，不阻断预览 */ }
      installInlineEditing(idoc);
      syncAdviceCards();   // 重挂后的新文档补挂诊断对照卡（分页之后注入，不参与分页测量）
      // iframe 随内容变化整体重挂（docKey），文档销毁即弃监听，无需清理
      idoc.addEventListener("wheel", wheelZoom, { passive: false });
    }
    applyZoom();
    if (pendingPrint.current === null) return;
    // 消费前对照 store 最新：加载的若非最新版则继续刷新，绝不打印过期内容
    const s = useStore.getState();
    const cur = s.resume && !isBlankResume(s.resume) ? resumeToDoc(s.resume, s.layoutSettings) : "";
    if (!cur) { pendingPrint.current = null; return; }          // 已变空白：取消打印
    if (docRef.current === cur) { pendingPrint.current = null; printNow(); }
    else { pendingPrint.current = cur; setDoc(cur); setDocKey((k) => k + 1); }
  };

  // 标题栏 tab 胶囊（Figma 标题Bar 1013:574）：28px 高、8px 圆角、图标 24 盒 + 12px 文字，激活项浅灰底
  const tabCls = (t: "preview" | "source") => cn(
    "h-7 min-h-7 shrink-0 !gap-0 rounded-header py-0 pl-1 pr-2 text-label-12 text-muted-foreground",
    "hover:bg-muted active:scale-100", tab === t && "bg-muted");

  // min-h-0：画布外层容器不再自带 overflow，需在 main 上切断内容高度向上传播；
  // h-full：直接挂在 ResizablePanel（非 flex 容器）下时 flex-1 不生效，需显式撑满面板高度
  return (
    <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {/* 标题栏 */}
      <div className={cn("flex h-11 shrink-0 items-center border-b border-border bg-background pr-4",
        leftAccessory ? "pl-2" : "pl-4")}>
        <div className="flex items-center gap-2">
          {leftAccessory}
          <Button type="button" variant="ghost" className={tabCls("preview")}
            onClick={() => setTab("preview")} aria-pressed={tab === "preview"}>
            <span className="flex h-6 w-6 items-center justify-center text-foreground"><PanelTop className="h-4 w-4" /></span>预览
          </Button>
          {sourceText && showPolish && (   /* 原件对照仅诊断模式提供；排版模式隐藏（配合上方强制收回） */
            <Button type="button" variant="ghost" className={tabCls("source")}
              onClick={() => setTab("source")} aria-pressed={tab === "source"}>
              <span className="flex h-6 w-6 items-center justify-center text-foreground"><FileText className="h-4 w-4" /></span>原件
            </Button>
          )}
        </div>
        {rightAccessory && <div className="ml-auto flex items-center">{rightAccessory}</div>}
      </div>

      {/* 画布 */}
      {tab === "source" && sourceText ? (
        <div className="min-h-0 flex-1 bg-background"><SourcePanel /></div>
      ) : blank ? (
        <div className="anim-in flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-background-200 p-8 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-border text-muted-foreground">
            <FileUp className="h-7 w-7" />
          </div>
          <div>
            <div className="text-heading-20">先导入你的简历</div>
            <p className="mt-1 max-w-sm text-copy-14 text-muted-foreground">
              上传 PDF / 图片（自动 OCR）或粘贴文本。我们只重述你已写下的经历，不编造事实。
            </p>
          </div>
          <Button onClick={onImport}><FileUp className="h-4 w-4" /> 导入简历</Button>
        </div>
      ) : (
        // 画布（Figma 1004:1018）：灰底 + 白色圆角 A4。外层 bg-resume-canvas 与 iframe 模板
        // 的 --canvas 同值，短页时内外灰底无缝拼接；缩放控件悬浮于滚动区之上（不随内容滚动）。
        <div ref={zoneRef} className="relative isolate min-h-0 flex-1">
          <div ref={wrapRef} className={cn("h-full overflow-auto bg-resume-canvas", device === "mobile" && "flex justify-center")}>
            <div ref={innerRef} className={cn(
              "flex min-h-full flex-col justify-center",
              device === "mobile" ? "w-resume-mobile max-w-full shrink-0" : "w-full",
            )}>
              <iframe key={docKey} ref={iframeRef} title="简历预览" sandbox="allow-same-origin allow-modals"
                srcDoc={doc} onLoad={onFrameLoad} className="block w-full border-0 bg-transparent" />
            </div>
          </div>
          {/* 悬浮缩放控件（Figma 1004:981）：− / 倍率（点击回「适应」）/ + */}
          <div className="absolute bottom-3.5 left-3.5 flex items-center rounded-control border-[0.5px] border-canvas-control-border bg-canvas-control shadow-canvas-control">
            <Button type="button" variant="ghost" aria-label="缩小预览" onClick={() => stepZoom(-1)}
              className="h-8 min-h-8 w-8 rounded-control px-0 text-canvas-control-foreground hover:bg-canvas-control-hover">
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost"
              aria-label={`当前缩放${zoom === "fit" ? "适应宽度" : `${Math.round(zoom * 100)}%`}，点击恢复适应宽度`}
              title="恢复适应宽度" onClick={() => setZoom("fit")}
              className="h-8 min-h-8 min-w-8 rounded-control px-1 text-label-12 text-canvas-control-foreground hover:bg-canvas-control-hover active:scale-100">
              {zoom === "fit" ? "适应" : `${Math.round(zoom * 100)}%`}
            </Button>
            <Button type="button" variant="ghost" aria-label="放大预览" onClick={() => stepZoom(1)}
              className="h-8 min-h-8 w-8 rounded-control px-0 text-canvas-control-foreground hover:bg-canvas-control-hover">
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
          {/* AI 润色/编辑进行中胶囊（Figma 1026:647）：画布底中，可停止等待 */}
          {aiBusy && (
            <div className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center">
              <div className="pointer-events-auto">
                <AiBusyPill kind={aiBusy.kind} onStop={aiBusy.stop} />
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
