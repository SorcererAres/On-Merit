// 预览/导出页 /preview/:id：载入记录 → 排版编辑器（左 MD / 右 A4）。
// 排版 Markdown 编辑写入 store.exportMd，由 useAutoSave 持久化；离开守卫同编辑器。
import { useEffect } from "react";
import { useNavigate, useParams, useBlocker } from "react-router-dom";
import { getJSON } from "@/lib/api";
import { useAutoSave } from "@/lib/useAutoSave";
import { useStore } from "@/store/useStore";
import type { ResumeRecord } from "@/store/useStore";
import { StepExport } from "@/steps/StepExport";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { toast } from "sonner";
import { ArrowLeft, Check } from "lucide-react";

export function PreviewPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const { resumeId, version, dirty, conflict, hydrationKey, loadRecord } = useStore();
  const { saving, saveNow } = useAutoSave(id);

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

  const blocker = useBlocker(dirty || conflict);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    (async () => {
      if (useStore.getState().conflict) {
        if (window.confirm("存在未解决的版本冲突，离开将丢弃你的本地改动。确定离开？")) blocker.proceed();
        else blocker.reset();
        return;
      }
      const ok = await saveNow();
      if (ok) blocker.proceed();
      else { toast.error("保存未成功，已留在本页"); blocker.reset(); }
    })();
  }, [blocker.state]);

  if (resumeId !== id) return <div className="px-6 py-8 text-copy-14 text-muted-foreground">加载中…</div>;

  const reload = async () => {
    const rec = await getJSON<ResumeRecord>(`/api/resumes/${id}`);
    loadRecord(rec); toast.message("已加载最新版本");
  };
  const overrideMine = async () => {
    const latest = await getJSON<ResumeRecord>(`/api/resumes/${id}`);
    useStore.setState({ version: latest.version, conflict: false });
    const ok = await saveNow();
    if (ok) toast.success("已用你的版本覆盖"); else toast.error("覆盖保存失败，请重试");
  };

  const status = conflict ? "冲突" : saving ? "保存中…" : dirty ? "未保存" : "已保存";
  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background px-5 py-3">
        <Button variant="ghost" aria-label="返回" onClick={() => nav(`/editor/${id}`)}>
          <ArrowLeft className="h-4 w-4" /> 回编辑
        </Button>
        <span className="text-heading-20">排版 / 导出</span>
        <span className={cn("text-label-12 whitespace-nowrap",
          conflict ? "text-destructive" : dirty || saving ? "text-muted-foreground" : "text-green-900")}>
          {!dirty && !saving && !conflict && <Check className="inline h-3.5 w-3.5" />} {status} · v{version}
        </span>
      </div>
      {conflict && (
        <Alert tone="red" className="mx-5 mt-3">
          <b>这份简历已在别处被修改</b>，你的自动保存被拒。请选择：
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" onClick={reload}>重新加载（丢弃本地改动）</Button>
            <Button variant="danger" onClick={overrideMine}>用我的覆盖</Button>
          </div>
        </Alert>
      )}
      <main key={hydrationKey} className="mx-auto max-w-6xl px-5 py-7 pb-24"><StepExport /></main>
    </div>
  );
}
