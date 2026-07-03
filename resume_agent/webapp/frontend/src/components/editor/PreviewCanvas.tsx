// 中栏 · 预览画布：标题栏（预览/原件 tab + AI 润色）+ A4 实时渲染（resumeDoc + --fit 自适应）。
// data/layout 一变即 150ms 防抖重渲；空白简历 → 居中导入 CTA（诚实口径：只重述不编造）。
// printApi：把 iframe 打印函数上抛给顶栏「下载」。
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { resumeToMarkdown } from "@/lib/resumeToMarkdown";
import { markdownToDoc } from "@/lib/resumeDoc";
import { SourcePanel } from "./SourcePanel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { Eye, FileText, FileUp, Sparkles, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import type { Resume } from "@/types";

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
  if (!canvas || !first || !win || idoc.querySelectorAll(".page").length > 1) return;
  const cs = win.getComputedStyle(first);
  const cap = A4_HEIGHT - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if (!(cap > 0)) return;

  // 展平为可分配单元：.page 直接子元素；ul/ol 拆成 li（记录容器模板以便跨页克隆）
  interface Unit { el: HTMLElement; listTpl?: HTMLElement }
  const units: Unit[] = [];
  for (const child of Array.from(first.children) as HTMLElement[]) {
    if ((child.tagName === "UL" || child.tagName === "OL") && child.children.length > 1) {
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
    for (const u of pgUnits) {
      if (u.listTpl) {
        if (!curList || curTpl !== u.listTpl) {
          curList = u.listTpl.cloneNode(false) as HTMLElement;
          curTpl = u.listTpl;
          pg.appendChild(curList);
        }
        curList.appendChild(u.el);
      } else { curList = null; curTpl = null; pg.appendChild(u.el); }
    }
    frag.appendChild(pg);
  }
  first.remove();
  canvas.appendChild(frag);
}

const ZOOM_MIN = 0.5, ZOOM_MAX = 2, ZOOM_STEP = 0.25;

// 空白：basics 无实质字段且各段落均无含实值条目（沿用诊断视图的判定）
function hasVal(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.some(hasVal);
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).some(hasVal);
  return true;
}
export function isBlankResume(r: Resume | null): boolean {
  if (!r) return true;
  const b = r.basics || {};
  const basicsHas = [b.name, b.email, b.phone, b.summary, b.url].some((x) => !!x?.trim?.());
  return !basicsHas && !hasVal(r.work) && !hasVal(r.projects) && !hasVal(r.education) && !hasVal(r.skills);
}

export function PreviewCanvas({ device, showPolish, onPolish, onImport, printApi }: {
  device: "desktop" | "mobile";
  showPolish: boolean;              // 仅诊断模式显示「AI 润色」
  onPolish: () => void;
  onImport: () => void;
  printApi: (fn: () => void) => void;   // 上抛打印函数（顶栏「下载」/样式面板「导出 PDF」共用）
}) {
  const resume = useStore((s) => s.resume);
  const layout = useStore((s) => s.layoutSettings);
  const sourceText = useStore((s) => s.sourceText);
  const [tab, setTab] = useState<"preview" | "source">("preview");
  const [doc, setDoc] = useState("");
  const [docKey, setDocKey] = useState(0);  // 内容变化即重挂 iframe：加载标记随实例失效，杜绝「同实例新导航」误判
  const [zoom, setZoom] = useState<"fit" | number>("fit");   // 'fit'=适应宽度；数值=手动缩放（0.5–2）
  const autoFitRef = useRef(1);              // 最近一次「适应宽度」计算值（手动步进的起点）
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const docRef = useRef(doc); docRef.current = doc;
  const tabRef = useRef(tab); tabRef.current = tab;
  const loadedDocRef = useRef("");          // 最近一次 iframe load 完成时对应的 doc（打印新鲜度判据）
  const loadedFrameRef = useRef<HTMLIFrameElement | null>(null);  // 该 load 所属实例——重挂后旧值失效
  const pendingPrint = useRef<string | null>(null);   // 待打印的目标 doc；null=无 pending
  const name = useMemo(() => resume?.basics?.name || "简历", [resume]);
  const blank = isBlankResume(resume);

  // 排版模式（showPolish=false）不提供原件对照：强制收回预览，避免样式调整不可见、导出落空
  useEffect(() => { if (!showPolish && tab === "source") setTab("preview"); }, [showPolish, tab]);

  // data + layout → 防抖重渲；内容真变才导航（setDoc+bump key 重挂），空白时顺带取消待打印
  useEffect(() => {
    const id = window.setTimeout(() => {
      const next = resume && !blank ? markdownToDoc(resumeToMarkdown(resume, "zh"), name, layout) : "";
      if (!next) pendingPrint.current = null;
      if (next !== docRef.current) { setDoc(next); setDocKey((k) => k + 1); }
    }, 150);
    return () => window.clearTimeout(id);
  }, [resume, name, layout, blank]);

  // 缩放：'fit' 按 iframe 实际容器宽自适应（手机=390px 内层，桌面=工作区宽）；数值=手动倍率。
  // 设定后把 iframe 高度同步为文档内容高：滚动全交给外层画布（单一连续灰底、单一滚动条）。
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const applyZoom = () => {
    const iframe = iframeRef.current;
    const idoc = iframe?.contentDocument;
    const inner = innerRef.current;
    if (!iframe || !idoc?.documentElement || !inner) return;
    autoFitRef.current = Math.max(0.3, Math.min(1, (inner.clientWidth - 32) / 794));
    const z = zoomRef.current;
    const scale = z === "fit" ? autoFitRef.current : z;
    idoc.documentElement.style.setProperty("--fit", String(scale));
    // 先压 0 再量：doc 内 .canvas{min-height:100vh} 以 iframe 高为 vh 基准，
    // 不压会自指棘轮（内容变矮时 scrollHeight 被旧 vh 撑住回不去）。同帧读写无闪烁。
    iframe.style.height = "0px";
    iframe.style.height = `${idoc.documentElement.scrollHeight}px`;
  };
  useEffect(() => {
    const t = window.setTimeout(applyZoom, 0);   // 布局提交后主动应用（device/tab/zoom 切换即刻生效）
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return () => window.clearTimeout(t);
    const ro = new ResizeObserver(applyZoom); ro.observe(wrap);   // 窗口/面板拖拽兜底
    if (innerRef.current) ro.observe(innerRef.current);
    return () => { window.clearTimeout(t); ro.disconnect(); };
  }, [device, tab, blank, zoom]);
  const clampZoom = (v: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v));
  const stepZoom = (dir: 1 | -1) => setZoom((z) => {
    const base = z === "fit" ? autoFitRef.current : z;
    return clampZoom(Math.round((base + dir * ZOOM_STEP) / ZOOM_STEP) * ZOOM_STEP);
  });

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
      const s = useStore.getState();
      if (isBlankResume(s.resume)) { toast.error("简历还是空的，请先导入或填写内容"); return; }
      const fresh = markdownToDoc(resumeToMarkdown(s.resume!, "zh"),
        s.resume!.basics?.name || "简历", s.layoutSettings);
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
    if (idoc) { try { paginate(idoc); } catch { /* 分页失败退回单长页，不阻断预览 */ } }
    applyZoom();
    if (pendingPrint.current === null) return;
    // 消费前对照 store 最新：加载的若非最新版则继续刷新，绝不打印过期内容
    const s = useStore.getState();
    const cur = s.resume && !isBlankResume(s.resume)
      ? markdownToDoc(resumeToMarkdown(s.resume, "zh"), s.resume.basics?.name || "简历", s.layoutSettings) : "";
    if (!cur) { pendingPrint.current = null; return; }          // 已变空白：取消打印
    if (docRef.current === cur) { pendingPrint.current = null; printNow(); }
    else { pendingPrint.current = cur; setDoc(cur); setDocKey((k) => k + 1); }
  };

  const tabCls = (t: "preview" | "source") => cn(
    "flex h-6 items-center gap-1 rounded-[6px] px-1.5 text-[12px] leading-6",
    tab === t ? "text-foreground" : "text-muted-foreground hover:text-foreground");

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      {/* 标题栏 */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-background pl-4 pr-4">
        <div className="flex items-center gap-1">
          <button className={tabCls("preview")} onClick={() => setTab("preview")} aria-pressed={tab === "preview"}>
            <Eye className="h-4 w-4" /> 预览
          </button>
          {sourceText && showPolish && (   /* 原件对照仅诊断模式提供；排版模式隐藏（配合上方强制收回） */
            <button className={tabCls("source")} onClick={() => setTab("source")} aria-pressed={tab === "source"}>
              <FileText className="h-4 w-4" /> 原件
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* 缩放：− / 倍率（点击回「适应」）/ +；仅预览 tab 有意义 */}
          {tab === "preview" && !blank && (
            <div className="flex items-center gap-0.5">
              <button aria-label="缩小" onClick={() => stepZoom(-1)}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground">
                <ZoomOut className="h-4 w-4" />
              </button>
              <button aria-label="缩放倍率（点击恢复适应宽度）" title="点击恢复适应宽度"
                onClick={() => setZoom("fit")}
                className="min-w-[44px] rounded px-1 text-center text-[12px] leading-6 text-muted-foreground hover:text-foreground">
                {zoom === "fit" ? "适应" : `${Math.round(zoom * 100)}%`}
              </button>
              <button aria-label="放大" onClick={() => stepZoom(1)}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground">
                <ZoomIn className="h-4 w-4" />
              </button>
            </div>
          )}
          {showPolish && (
            <button onClick={onPolish}
              className="flex h-7 items-center gap-1 rounded-full border border-border px-[11px] text-[13px] leading-6 text-foreground hover:bg-accent/40">
              <Sparkles className="h-3.5 w-3.5" /> AI 润色
            </button>
          )}
        </div>
      </div>

      {/* 画布 */}
      {tab === "source" && sourceText ? (
        <div className="min-h-0 flex-1 bg-background"><SourcePanel /></div>
      ) : blank ? (
        <div className="anim-in flex min-h-0 flex-1 flex-col items-center justify-center gap-4 bg-[#f5f5f4] p-8 text-center">
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
        // 画布底色与 doc 内部 --canvas(#f5f5f4) 取齐，iframe 高=内容高后两层灰无缝衔接
        <div ref={wrapRef} className={cn("min-h-0 flex-1 overflow-auto bg-[#f5f5f4]", device === "mobile" && "flex justify-center")}>
          <div ref={innerRef} className={device === "mobile" ? "w-[390px] shrink-0" : "w-full"}>
            <iframe key={docKey} ref={iframeRef} title="简历预览" sandbox="allow-same-origin allow-modals"
              srcDoc={doc} onLoad={onFrameLoad} className="block w-full border-0 bg-transparent" />
          </div>
        </div>
      )}
    </main>
  );
}
