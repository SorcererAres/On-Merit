// 节点0 · 简历画廊（Figma 814:469 1:1）：标题区 + 筛选 chips（全部/草稿/已完成）+ 排序 +
// 284×256 卡片网格（新建卡 / 简历卡=缩略图 161 + 标题 + 相对时间 + 最新诊断评分）。
// 「草稿/已完成」由是否有诊断报告派生（latest_score）；评分只是最近一次报告的留档展示，
// 不做任何跨卡对比/趋势（诚实口径）。缩略图沿用虚拟化：可见才挂 iframe，按 id:version 缓存。
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getJSON, postJSON, delJSON } from "@/lib/api";
import { resumeToMarkdown } from "@/lib/resumeToMarkdown";
import { markdownToDoc } from "@/lib/resumeDoc";
import { DEFAULT_LAYOUT, type LayoutSettings } from "@/lib/templates";
import { cn } from "@/lib/cn";
import { toast } from "sonner";
import type { ResumeRecord } from "@/store/useStore";
import { FilePlus2, Copy, Trash2, ChevronDown } from "lucide-react";

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

// 缩略图：虚拟化（可见含 300px 边距才挂 iframe，离屏卸载）；渲染结果按 id:version 缓存；
// 加载经 in-flight 去重（防快速进出并发重拉）。
const _thumbCache = new Map<string, string>();
const _thumbInflight = new Map<string, Promise<string>>();
function loadThumb(id: string, cacheKey: string): Promise<string> {
  const cached = _thumbCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);
  let p = _thumbInflight.get(cacheKey);
  if (!p) {
    p = getJSON<ResumeRecord>(`/api/resumes/${id}`).then((rec) => {
      const layout = { ...DEFAULT_LAYOUT, ...(rec.layout_settings || {}) } as LayoutSettings;
      const d = markdownToDoc(resumeToMarkdown(rec.data, "zh"), rec.title, layout);
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
    const io = new IntersectionObserver((es) => setVisible(es[0].isIntersecting), { rootMargin: "300px" });
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
    const idoc = iframeRef.current?.contentDocument;
    if (idoc?.documentElement) idoc.documentElement.style.setProperty("--fit", "0.34");
  };
  return (
    <div ref={boxRef} className="h-[161px] overflow-hidden bg-[#f5f5f4]">
      {visible && doc && <iframe ref={iframeRef} title="" aria-hidden tabIndex={-1} sandbox="allow-same-origin"
        srcDoc={doc} onLoad={fit} className="pointer-events-none h-[560px] w-full border-0" />}
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
    if (!window.confirm(`确定永久删除「${title}」？此操作会一并清除其历史版本，且不可撤销。`)) return;
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
    <div className="anim-in mx-auto max-w-[1200px] px-5 py-6 xl:px-0">
      <h1 className="text-[20px] leading-[30px] font-semibold text-foreground">我的简历</h1>
      <p className="mt-[5px] text-[14px] leading-5 text-muted-foreground">准备好迎接下一个闪光机会了吗？</p>

      {/* 筛选 + 排序 */}
      <div className="mt-6 flex items-center">
        <div className="flex items-center gap-4">
          {CHIPS.map((c) => (
            <button key={c.key} aria-pressed={filter === c.key} onClick={() => setFilter(c.key)}
              className={cn("h-7 rounded-full px-3.5 text-[12px] leading-4",
                filter === c.key
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-background text-foreground hover:bg-accent/40")}>
              {c.label}
            </button>
          ))}
        </div>
        <button onClick={() => setSort(sort === "updated" ? "score" : "updated")}
          className="ml-auto flex h-7 items-center gap-1 rounded-full border border-border px-3 text-[12px] leading-4 text-muted-foreground hover:text-foreground">
          排序：{sort === "updated" ? "按最后更新" : "按评分"}
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      {/* 卡片网格：284×256，gap 21 */}
      <div className="mt-4 grid grid-cols-1 gap-[21px] sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
        {/* 新建/导入卡 */}
        <button disabled={busy} onClick={create}
          className="flex h-[256px] flex-col items-center justify-center rounded-2xl bg-muted text-center transition hover:bg-accent/60 disabled:opacity-50">
          <FilePlus2 className="h-10 w-10 text-muted-foreground" strokeWidth={1.5} />
          <div className="mt-4 text-[16px] leading-6 font-medium text-foreground">新建/导入简历</div>
          <div className="mt-2 text-[12px] leading-[17px] text-muted-foreground">支持 PDF/Word/ 图片</div>
        </button>

        {list !== null && shown.map((r) => (
          <div key={r.id}
            className="group relative h-[256px] overflow-hidden rounded-2xl border border-border bg-card">
            <button className="block w-full text-left" onClick={() => nav(`/editor/${r.id}`)}
              aria-label={`打开 ${r.title}`}>
              <Thumb id={r.id} version={r.version} />
              <div className="px-4 pt-4">
                <div className="truncate text-[16px] leading-6 font-medium text-foreground">
                  {r.title || "未命名简历"}
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-[12px] leading-[17px] text-muted-foreground">{relTime(r.updated_at)}</span>
                  {r.latest_score != null && (
                    <span className="text-[12px] leading-[17px]" style={{ color: "var(--green-700)" }}>
                      评分: {Math.round(r.latest_score)}
                    </span>
                  )}
                </div>
              </div>
            </button>
            {/* 悬停操作（稿未画，功能保留为浮层） */}
            <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
              <button aria-label="复制" onClick={(e) => { e.stopPropagation(); duplicate(r.id); }}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-card hover:text-foreground">
                <Copy className="h-3.5 w-3.5" />
              </button>
              <button aria-label="删除" onClick={(e) => { e.stopPropagation(); remove(r.id, r.title); }}
                className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-card hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {list === null && <p className="mt-4 text-copy-14 text-muted-foreground">加载中…</p>}
      {list !== null && shown.length === 0 && (
        <p className="mt-4 text-copy-14 text-muted-foreground">
          {filter === "all" ? "还没有简历，点「新建/导入简历」开始。"
            : filter === "done" ? "还没有已完成的简历（运行过诊断即视为完成）。" : "没有草稿。"}
        </p>
      )}
    </div>
  );
}
