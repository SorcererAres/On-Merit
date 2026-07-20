// 节点0 · 简历画廊（Figma 814:469 1:1）：标题区 + 筛选 chips（全部/草稿/已完成）+ 排序 +
// 284×256 卡片网格（新建卡 / 简历卡=缩略图 161 + 标题 + 相对时间 + 最新诊断评分）。
// 「草稿/已完成」由是否有诊断报告派生（latest_score）；评分只是最近一次报告的留档展示，
// 不做任何跨卡对比/趋势（诚实口径）。缩略图沿用虚拟化：可见才挂 iframe，按 id:version 缓存。
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getJSON, postJSON, delJSON } from "@/lib/api";
import { resumeToDoc } from "@/lib/resumeDoc";
import { DEFAULT_LAYOUT, type LayoutSettings } from "@/lib/templates";
import { cn } from "@/lib/cn";
import { toast } from "sonner";
import { confirmDialog } from "@/components/confirm";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import filePlusUrl from "@/assets/file-plus.svg";
import chevronDownUrl from "@/assets/chevron-down.svg";
import type { ResumeRecord } from "@/store/useStore";
import { Copy, Trash2 } from "lucide-react";

interface ResumeMeta {
  id: string; title: string; role: string; version: number;
  updated_at: string; latest_score: number | null;
}
type Filter = "all" | "draft" | "done";
type Sort = "updated" | "score";

/** 相对时间：「3小时前更新」式（>30 天退化为日期） */
function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "刚刚更新";
  if (m < 60) return `${m}分钟前更新`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前更新`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}天前更新`;
  return `${new Date(iso).toLocaleDateString()} 更新`;
}

// 缩略图：虚拟化（进入视口附近才挂 iframe，离屏卸载）；渲染结果按 id:version 缓存；
// 加载经 in-flight 去重（防快速进出并发重拉）。
const _thumbCache = new Map<string, string>();
const _thumbInflight = new Map<string, Promise<string>>();
const RESUME_PAGE_WIDTH = 794;
const THUMB_STYLE_ID = "dashboard-thumbnail-overrides";
function loadThumb(id: string, cacheKey: string): Promise<string> {
  const cached = _thumbCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);
  let p = _thumbInflight.get(cacheKey);
  if (!p) {
    p = getJSON<ResumeRecord>(`/api/resumes/${id}`).then((rec) => {
      const layout = { ...DEFAULT_LAYOUT, ...(rec.layout_settings || {}) } as LayoutSettings;
      const d = resumeToDoc(rec.data, layout);
      for (const k of _thumbCache.keys()) { if (k.startsWith(`${id}:`)) _thumbCache.delete(k); }
      _thumbCache.set(cacheKey, d);
      return d;
    }).finally(() => { _thumbInflight.delete(cacheKey); });
    _thumbInflight.set(cacheKey, p);
  }
  return p;
}

function Thumb({ id, version }: { id: string; version: number }) {
  const cacheKey = `${id}:${version}`;
  const boxRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [visible, setVisible] = useState(false);
  const [doc, setDoc] = useState<string | null>(_thumbCache.get(cacheKey) ?? null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver((es) => setVisible(es[0].isIntersecting), { rootMargin: "50%" });
    io.observe(box);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || doc) return;
    let alive = true;
    loadThumb(id, cacheKey).then((d) => { if (alive) setDoc(d); }).catch(() => { /* 忽略缩略图失败 */ });
    return () => { alive = false; };
  }, [visible, doc, cacheKey, id]);

  const fit = () => {
    const iframe = iframeRef.current;
    const idoc = iframe?.contentDocument;
    if (!iframe || !idoc?.documentElement) return;

    // 缩略图内层本身就是 Figma 的白色纸张：去掉预览器自带的画布边距与页阴影，
    // 再按可用宽度缩放 A4，避免出现「卡片套卡片」和二次横向缩进。
    idoc.documentElement.style.setProperty("--fit", String(iframe.clientWidth / RESUME_PAGE_WIDTH));
    if (!idoc.getElementById(THUMB_STYLE_ID)) {
      const style = idoc.createElement("style");
      style.id = THUMB_STYLE_ID;
      style.textContent = `
        html, body {
          background: transparent !important;
          overflow: hidden !important;            /* 缩略图禁止滚动，避免右侧出现滚动条 */
          scrollbar-width: none !important;       /* Firefox 隐藏滚动条 */
        }
        ::-webkit-scrollbar { display: none !important; } /* WebKit 隐藏滚动条 */
        .canvas {
          align-items: flex-start !important;
          gap: 0 !important;
          min-height: 0 !important;
          padding: 0 !important;
        }
        .page { box-shadow: none !important; }
      `;
      idoc.head.appendChild(style);
    }
  };
  return (
    <div ref={boxRef} className="h-resume-thumbnail overflow-hidden bg-gallery-preview pt-8 opacity-90">
      <div className="relative mx-8 h-gallery-preview-document overflow-hidden rounded-tl-lg rounded-tr-md bg-gallery-card
        after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-10
        after:bg-gradient-to-t after:from-gallery-card after:to-transparent">
        {visible && doc && <iframe ref={iframeRef} title="" aria-hidden tabIndex={-1} sandbox="allow-same-origin"
          srcDoc={doc} onLoad={fit} className="pointer-events-none h-thumb-document w-full border-0" />}
      </div>
    </div>
  );
}

export function Dashboard() {
  const nav = useNavigate();
  const [list, setList] = useState<ResumeMeta[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("updated");
  const [busy, setBusy] = useState(false);

  const refresh = () => getJSON<{ resumes: ResumeMeta[] }>("/api/resumes")
    .then((d) => setList(d.resumes)).catch((e) => toast.error(e.message));
  useEffect(() => { refresh(); }, []);

  const create = async () => {
    setBusy(true);
    try { const rec = await postJSON<ResumeRecord>("/api/resumes", { title: "未命名简历" }); nav(`/editor/${rec.id}`); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const duplicate = async (id: string) => {
    try { await postJSON(`/api/resumes/${id}/duplicate`, {}); toast.success("已复制"); _thumbCache.clear(); refresh(); }
    catch (e) { toast.error((e as Error).message); }
  };
  const remove = async (id: string, title: string) => {
    if (!(await confirmDialog({
      title: `永久删除「${title}」？`, description: "会一并清除其历史版本，且不可撤销。",
      confirmText: "删除", destructive: true,
    }))) return;
    try { await delJSON(`/api/resumes/${id}`); toast.success("已删除"); _thumbCache.clear(); refresh(); }
    catch (e) { toast.error((e as Error).message); }
  };

  // 筛选：草稿=尚无诊断报告，已完成=有报告；排序：最后更新（后端序）/ 评分（无分垫底）
  const shown = (list ?? [])
    .filter((r) => filter === "all" ? true : filter === "done" ? r.latest_score != null : r.latest_score == null)
    .sort((a, b) => sort === "score"
      ? (b.latest_score ?? -1) - (a.latest_score ?? -1)
      : 0);   // updated：保持后端 updated_at DESC 原序

  const CHIPS: { key: Filter; label: string }[] = [
    { key: "all", label: "全部" }, { key: "draft", label: "草稿" }, { key: "done", label: "已完成" },
  ];

  return (
    <main className="anim-in mx-auto max-w-content px-5 py-6 xl:px-0">
      <h1 className="text-heading-20 text-gallery-foreground">我的简历</h1>
      <p className="mt-gallery-copy-gap text-copy-14 text-gray-900">准备好迎接下一个闪光机会了吗？</p>

      {/* 筛选 + 排序 */}
      <div className="mt-6 flex items-center">
        <div className="flex items-center gap-4">
          {CHIPS.map((c) => (
            <Button key={c.key} type="button" variant="ghost"
              aria-pressed={filter === c.key} onClick={() => setFilter(c.key)}
              className={cn("relative h-7 min-h-7 rounded-full px-3.5 py-1.5 after:absolute after:-inset-y-2 after:inset-x-0",
                filter === c.key
                  ? "bg-gallery-active text-gallery-active-foreground hover:bg-gallery-active"
                  : "border border-gallery-border bg-transparent text-gallery-control hover:bg-gallery-surface")}>
              <span className="text-label-12">{c.label}</span>
            </Button>
          ))}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost"
              className="relative ml-auto h-7 min-h-7 gap-1 rounded-full border border-gallery-border bg-transparent py-1.5 pl-3 pr-2 text-gallery-control after:absolute after:-inset-y-2 after:inset-x-0 hover:bg-gallery-surface hover:text-gallery-foreground data-[state=open]:bg-gallery-surface">
              <span className="text-label-12">排序：{sort === "updated" ? "按最后更新" : "按评分"}</span>
              <img src={chevronDownUrl} alt="" className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="border-gallery-border bg-gallery-card text-gallery-foreground">
            <DropdownMenuRadioGroup value={sort} onValueChange={(value) => setSort(value as Sort)}>
              <DropdownMenuRadioItem value="updated" className="min-h-11">
                <span className="text-copy-14">按最后更新</span>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="score" className="min-h-11">
                <span className="text-copy-14">按评分</span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 卡片网格：284×256，gap 21 */}
      <div className="mt-4 grid grid-cols-1 gap-gallery-gap sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-gallery">
        {/* 新建/导入卡 */}
        <Button type="button" variant="ghost" disabled={busy} onClick={create}
          className="h-64 flex-col !rounded-gallery border border-gallery-card bg-gallery-surface text-center hover:bg-gallery-surface">
          <img src={filePlusUrl} alt="" className="h-14 w-14" />
          <div className="mt-4 text-heading-16 text-gallery-foreground">新建/导入简历</div>
          <div className="mt-2 text-label-12 text-gallery-muted">支持 PDF/Word/ 图片</div>
        </Button>

        {list !== null && shown.map((r) => (
          <Card key={r.id}
            className="resume-card group relative isolate h-64 overflow-hidden !rounded-gallery border-0 bg-gallery-card p-0 ring-1 ring-inset ring-gallery-card">
            <Button type="button" variant="ghost"
              className="h-full min-h-0 w-full flex-col items-stretch justify-start whitespace-normal rounded-none bg-transparent p-0 text-left hover:bg-transparent active:scale-100 focus-visible:ring-inset focus-visible:ring-offset-0"
              onClick={() => nav(`/editor/${r.id}`)}
              aria-label={`打开 ${r.title}`}>
              <Thumb id={r.id} version={r.version} />
              <div className="px-4 pt-4">
                <div className="truncate text-heading-16 text-gallery-foreground">
                  {r.title || "未命名简历"}
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-label-12 text-gallery-muted">{relTime(r.updated_at)}</span>
                  {r.latest_score != null && (
                    <span className="text-label-12 text-green-900">
                      评分: {Math.round(r.latest_score)}
                    </span>
                  )}
                </div>
              </div>
            </Button>
            {/* 桌面端悬停/聚焦显示；触屏端常显。44px 点击区内使用 32px 视觉按钮，避免遮挡缩略图。 */}
            <div className="resume-card-actions absolute right-1 top-1 z-10 flex">
              <Button type="button" variant="ghost" aria-label="复制"
                onClick={(e) => { e.stopPropagation(); duplicate(r.id); }}
                className="group/action h-11 w-11 rounded-full bg-transparent p-0 text-muted-foreground hover:bg-transparent hover:text-foreground">
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background shadow-card transition-colors duration-state ease group-hover/action:bg-accent group-focus-visible/action:bg-accent">
                  <Copy className="h-4 w-4" />
                </span>
              </Button>
              <Button type="button" variant="ghost" aria-label="删除"
                onClick={(e) => { e.stopPropagation(); remove(r.id, r.title); }}
                className="group/action h-11 w-11 rounded-full bg-transparent p-0 text-muted-foreground hover:bg-transparent hover:text-destructive">
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background shadow-card transition-colors duration-state ease group-hover/action:bg-accent group-focus-visible/action:bg-accent">
                  <Trash2 className="h-4 w-4" />
                </span>
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {list === null && <p className="mt-4 text-copy-14 text-gallery-control">加载中…</p>}
      {list !== null && shown.length === 0 && (
        <p className="mt-4 text-copy-14 text-gallery-control">
          {filter === "all" ? "还没有简历，点「新建/导入简历」开始。"
            : filter === "done" ? "还没有已完成的简历（运行过诊断即视为完成）。" : "没有草稿。"}
        </p>
      )}
    </main>
  );
}
