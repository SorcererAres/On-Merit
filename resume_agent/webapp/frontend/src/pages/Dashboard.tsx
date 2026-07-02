// 节点0 · 简历画廊：时段问候 + 巨型新建卡 + 高保真缩略图卡（懒加载+缓存）。
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getJSON, postJSON, delJSON } from "@/lib/api";
import { resumeToMarkdown } from "@/lib/resumeToMarkdown";
import { markdownToDoc } from "@/lib/resumeDoc";
import { DEFAULT_LAYOUT, type LayoutSettings } from "@/lib/templates";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { toast } from "sonner";
import type { ResumeRecord } from "@/store/useStore";
import { FilePlus2, Copy, Trash2 } from "lucide-react";

interface ResumeMeta { id: string; title: string; role: string; version: number; updated_at: string }
interface Role { key: string; label: string }

function greeting(): string {
  const h = new Date().getHours();
  const t = h < 6 ? "夜深了" : h < 11 ? "早安" : h < 14 ? "午安" : h < 18 ? "下午好" : "晚上好";
  return `${t}，准备好迎接下一个闪光机会了吗？`;
}

// 缩略图：虚拟化——持续观察可见性，仅可见（含 300px 预取边距）时挂 iframe，离屏即卸载，
// 界住并发 iframe 数（不随滚动累积）。渲染结果按 id:version 缓存（编辑后失效），离屏回来直接命中不重拉。
const _thumbCache = new Map<string, string>();
const _thumbInflight = new Map<string, Promise<string>>();   // 同 cacheKey 请求去重（防快速进出并发重拉）

// 缓存优先 → in-flight 复用 → 拉取渲染；成功时淘汰同 id 旧版本。任一路径都最终写入 _thumbCache。
function loadThumb(id: string, cacheKey: string): Promise<string> {
  const cached = _thumbCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);
  let p = _thumbInflight.get(cacheKey);
  if (!p) {
    p = getJSON<ResumeRecord>(`/api/resumes/${id}`).then((rec) => {
      const layout = { ...DEFAULT_LAYOUT, ...(rec.layout_settings || {}) } as LayoutSettings;
      const d = markdownToDoc(resumeToMarkdown(rec.data, "zh"), rec.title, layout);
      for (const k of _thumbCache.keys()) { if (k.startsWith(`${id}:`)) _thumbCache.delete(k); }  // 淘汰同 id 旧版本
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

  // 可见性观察：全程 observe，进/出视口切 visible；离屏时卸载 iframe，回屏再挂。
  useEffect(() => {
    const box = boxRef.current;
    if (!box || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const io = new IntersectionObserver((es) => setVisible(es[0].isIntersecting), { rootMargin: "300px" });
    io.observe(box);
    return () => io.disconnect();
  }, []);

  // 可见时确保有 doc：先命中缓存（覆盖「上次请求已写缓存但组件已离屏未 setDoc」），否则经去重加载。
  useEffect(() => {
    if (!visible || doc) return;
    let alive = true;
    loadThumb(id, cacheKey).then((d) => { if (alive) setDoc(d); }).catch(() => { /* 忽略缩略图失败 */ });
    return () => { alive = false; };
  }, [visible, doc, cacheKey, id]);

  const fit = () => {
    const idoc = iframeRef.current?.contentDocument;
    if (idoc?.documentElement) idoc.documentElement.style.setProperty("--fit", "0.28");
  };
  return (
    <div ref={boxRef} className="h-[176px] overflow-hidden rounded-t-xl border-b border-border bg-[#f5f5f4]">
      {visible && doc && <iframe ref={iframeRef} title="" aria-hidden tabIndex={-1} sandbox="allow-same-origin"
        srcDoc={doc} onLoad={fit} className="pointer-events-none h-[560px] w-full border-0" />}
    </div>
  );
}

export function Dashboard() {
  const nav = useNavigate();
  const [list, setList] = useState<ResumeMeta[] | null>(null);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const refresh = () => getJSON<{ resumes: ResumeMeta[] }>("/api/resumes").then((d) => setList(d.resumes)).catch((e) => toast.error(e.message));
  useEffect(() => {
    refresh();
    getJSON<{ roles: Role[] }>("/api/roles").then((d) => setRoles(Object.fromEntries(d.roles.map((r) => [r.key, r.label])))).catch(() => {});
  }, []);

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

  return (
    <div className="anim-in mx-auto max-w-6xl px-5 py-8">
      <h1 className="text-heading-24">我的简历</h1>
      <p className="text-copy-14 text-muted-foreground mt-1">{greeting()}</p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* 巨型新建卡 */}
        <button disabled={busy} onClick={create}
          className="flex min-h-[240px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-muted-foreground transition hover:border-primary hover:text-primary disabled:opacity-50">
          <FilePlus2 className="h-7 w-7" />
          <span className="text-button-14">新建 / 导入简历</span>
        </button>

        {list?.map((r) => (
          <div key={r.id} className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card">
            <button className="text-left" onClick={() => nav(`/editor/${r.id}`)} aria-label={`打开 ${r.title}`}>
              <Thumb key={`${r.id}:${r.version}`} id={r.id} version={r.version} />
            </button>
            <div className="flex items-center gap-2 p-3">
              <button className="min-w-0 flex-1 text-left" onClick={() => nav(`/editor/${r.id}`)}>
                <div className="truncate text-button-14">{r.title || "未命名简历"}</div>
                <div className="mt-0.5 text-label-12 text-muted-foreground">
                  {roles[r.role] || r.role} · v{r.version} · {new Date(r.updated_at).toLocaleDateString()}
                </div>
              </button>
              <Button variant="ghost" aria-label="复制" onClick={() => duplicate(r.id)}><Copy className="h-4 w-4" /></Button>
              <Button variant="ghost" aria-label="删除" onClick={() => remove(r.id, r.title)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </div>
        ))}
      </div>

      {list === null && <p className="mt-4 text-copy-14 text-muted-foreground">加载中…</p>}
      {list?.length === 0 && <p className={cn("mt-4 text-copy-14 text-muted-foreground")}>还没有简历，点左上「新建」开始。</p>}
    </div>
  );
}
