// 编辑器页 /editor/:id：三栏画布（左分节编辑 / 中实时 A4 预览 / 右 AI 面板）。
// 自动保存（单飞+合并待存+savePoint）+ 409 冲突三态 + useBlocker 导航守卫（含冲突态）
// + hydrationKey 重挂 + 版本历史/回滚。
import { useEffect, useState } from "react";
import { useNavigate, useParams, useBlocker } from "react-router-dom";
import { getJSON, postJSON } from "@/lib/api";
import { useAutoSave } from "@/lib/useAutoSave";
import { useStore } from "@/store/useStore";
import type { ResumeRecord } from "@/store/useStore";
import { SectionEditor } from "@/components/editor/SectionEditor";
import { LivePreview } from "@/components/editor/LivePreview";
import { AIPanel } from "@/components/editor/AIPanel";
import { ImportDialog } from "@/components/editor/ImportDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { toast } from "sonner";
import { ArrowLeft, Check, FileUp, History, Printer, Save, X } from "lucide-react";

type MobileTab = "edit" | "preview" | "ai";
interface RevisionMeta { id: string; note: string; created_at: string }

export function EditorPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const {
    title, resumeId, version, dirty, conflict, hydrationKey,
    loadRecord, setTitle,
  } = useStore();
  const { saving, saveNow } = useAutoSave(id);
  const [importOpen, setImportOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [revisions, setRevisions] = useState<RevisionMeta[] | null>(null);
  const [mtab, setMtab] = useState<MobileTab>("edit");

  useEffect(() => {
    let alive = true;
    getJSON<ResumeRecord>(`/api/resumes/${id}`)
      .then((rec) => { if (alive) loadRecord(rec); })
      .catch((e) => { toast.error(e.message || "简历不存在"); nav("/"); });
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (useStore.getState().dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  // 导航守卫：普通脏态 → 保存后离开（保存失败不放行）；冲突态 → 确认丢弃才离开
  const blocker = useBlocker(dirty || conflict);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    (async () => {
      if (useStore.getState().conflict) {
        if (window.confirm("存在未解决的版本冲突，离开将丢弃你的本地改动。确定离开？")) blocker.proceed();
        else blocker.reset();
        return;
      }
      if (window.confirm("有未保存的修改。确定=保存后离开；取消=留在本页。")) {
        const ok = await saveNow();
        if (ok) blocker.proceed();
        else { toast.error("保存未成功，已留在本页"); blocker.reset(); }
      } else blocker.reset();
    })();
  }, [blocker.state]);

  const reload = async () => {
    const rec = await getJSON<ResumeRecord>(`/api/resumes/${id}`);
    loadRecord(rec); toast.message("已加载最新版本");
  };
  const overrideMine = async () => {
    const latest = await getJSON<ResumeRecord>(`/api/resumes/${id}`);
    useStore.setState({ version: latest.version, conflict: false });
    const ok = await saveNow();
    if (ok) toast.success("已用你的版本覆盖");
    else toast.error("覆盖保存失败，请重试");
  };

  // —— 版本历史 ——
  const openHistory = async () => {
    setHistOpen(true); setRevisions(null);
    try {
      const d = await getJSON<{ revisions: RevisionMeta[] }>(`/api/resumes/${id}/revisions`);
      setRevisions(d.revisions);
    } catch (e) { toast.error((e as Error).message); setHistOpen(false); }
  };
  const rollback = async (revisionId: string) => {
    if (!window.confirm("回滚到该版本？当前内容会先自动快照，可再回滚回来。")) return;
    // 本地有未保存修改：先存净再回滚（否则服务端「回滚前快照」缺这部分，loadRecord 会静默丢弃）
    if (useStore.getState().dirty) {
      const ok = await saveNow();
      if (!ok) return toast.error("本地修改保存失败，已取消回滚（请先解决保存问题）");
    }
    try {
      const s = useStore.getState();
      const rec = await postJSON<ResumeRecord>(`/api/resumes/${id}/rollback`,
        { revisionId, version: s.version });
      loadRecord(rec); setHistOpen(false); toast.success("已回滚");
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === "VERSION_CONFLICT") toast.error("这份简历已在别处被修改，请先处理冲突后再回滚");
      else toast.error(err.message || "回滚失败");
    }
  };

  if (resumeId !== id) return <div className="px-6 py-8 text-copy-14 text-muted-foreground">加载中…</div>;

  const status = conflict ? "冲突" : saving ? "保存中…" : dirty ? "未保存" : "已保存";
  const mtabCls = (t: MobileTab) => cn(
    "flex-1 rounded-md px-3 py-1.5 text-button-14",
    mtab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground");

  return (
    <div className="flex h-[calc(100vh-65px)] min-h-0 flex-col">
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-4 py-2.5">
        <Button variant="ghost" aria-label="返回列表" onClick={() => nav("/")}><ArrowLeft className="h-4 w-4" /></Button>
        <Input aria-label="简历名称" value={title} onChange={(e) => setTitle(e.target.value)}
          className="max-w-[240px]" placeholder="未命名简历" />
        <span className={cn("text-label-12 whitespace-nowrap",
          conflict ? "text-destructive" : dirty || saving ? "text-muted-foreground" : "text-green-900")}>
          {!dirty && !saving && !conflict && <Check className="inline h-3.5 w-3.5" />} {status} · v{version}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={() => setImportOpen(true)}><FileUp className="h-4 w-4" /> 导入</Button>
          <Button variant="ghost" onClick={openHistory} aria-label="历史版本"><History className="h-4 w-4" /> 历史</Button>
          <Button variant="secondary" onClick={() => nav(`/preview/${id}`)}><Printer className="h-4 w-4" /> 排版导出</Button>
          <Button variant="secondary" disabled={saving || !dirty || conflict} onClick={() => void saveNow()}>
            <Save className="h-4 w-4" /> 保存
          </Button>
        </div>
      </div>

      {conflict && (
        <Alert tone="red" className="mx-4 mt-3 shrink-0">
          <b>这份简历已在别处被修改</b>，你的自动保存被拒。请选择：
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" onClick={reload}>重新加载（丢弃本地改动）</Button>
            <Button variant="danger" onClick={overrideMine}>用我的覆盖</Button>
          </div>
        </Alert>
      )}

      {/* 窄屏 tab 切换 */}
      <div className="flex shrink-0 gap-1 border-b border-border p-2 lg:hidden">
        <button className={mtabCls("edit")} onClick={() => setMtab("edit")}>编辑</button>
        <button className={mtabCls("preview")} onClick={() => setMtab("preview")}>预览</button>
        <button className={mtabCls("ai")} onClick={() => setMtab("ai")}>AI</button>
      </div>

      {/* 三栏（hydrationKey：载入/回滚/导入/采纳改写时重挂编辑列，干净取新初值） */}
      <div className="flex min-h-0 flex-1">
        <div key={hydrationKey}
          className={cn("min-h-0 overflow-y-auto border-r border-border",
            "w-full lg:w-[400px] lg:shrink-0", mtab !== "edit" && "hidden lg:block")}>
          <SectionEditor />
        </div>
        <div className={cn("min-h-0 flex-1", mtab !== "preview" && "hidden lg:block")}>
          <LivePreview />
        </div>
        <div className={cn("min-h-0 border-l border-border",
          "w-full lg:w-[380px] lg:shrink-0", mtab !== "ai" && "hidden lg:block")}>
          <AIPanel />
        </div>
      </div>

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />

      {/* 版本历史 */}
      {histOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setHistOpen(false); }}>
          <div className="w-full max-w-lg rounded-xl border border-border bg-background p-5 shadow-lg">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-heading-20">历史版本</h3>
              <Button variant="ghost" aria-label="关闭" onClick={() => setHistOpen(false)}><X className="h-4 w-4" /></Button>
            </div>
            {revisions === null && <p className="text-copy-14 text-muted-foreground">加载中…</p>}
            {revisions?.length === 0 && <p className="text-copy-14 text-muted-foreground">还没有历史版本（内容变更时自动快照）。</p>}
            <div className="max-h-[50vh] overflow-y-auto">
              {revisions?.map((r) => (
                <div key={r.id} className="flex items-center gap-3 border-b border-border py-2.5">
                  <div className="flex-1">
                    <div className="text-copy-14">{r.note}</div>
                    <div className="text-label-12 text-muted-foreground">{new Date(r.created_at).toLocaleString()}</div>
                  </div>
                  <Button variant="secondary" onClick={() => rollback(r.id)}>回滚到此版</Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
