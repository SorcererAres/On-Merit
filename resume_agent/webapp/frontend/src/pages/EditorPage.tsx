// 文档外壳 + 向导状态机（W0，见 docs/plans/wizard-flow-v2.md §一）。
// 外壳唯一负责 loadRecord/useAutoSave(id)/409/离开守卫；step 为内部状态，同步 URL ?step=，
// 切步不重载/不+loadSeq/不+hydrationKey/不卸载 autosave；useBlocker 排除同 pathname 仅切步。
// W0 各步先复用现有组件（诊断/优化=三栏，AIPanel 锁 tab；导出=StepExport），富界面留 W2–W5。
import { useEffect, useState } from "react";
import { useNavigate, useParams, useBlocker, useSearchParams } from "react-router-dom";
import { getJSON, postJSON } from "@/lib/api";
import { useAutoSave } from "@/lib/useAutoSave";
import { useStore } from "@/store/useStore";
import type { ResumeRecord } from "@/store/useStore";
import { SectionEditor } from "@/components/editor/SectionEditor";
import { LivePreview } from "@/components/editor/LivePreview";
import { AIPanel } from "@/components/editor/AIPanel";
import { ImportDialog } from "@/components/editor/ImportDialog";
import { StepExport } from "@/steps/StepExport";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { toast } from "sonner";
import { ArrowLeft, Check, FileUp, History, Save, X } from "lucide-react";

type Step = "diagnose" | "optimize" | "export";
type MobileTab = "edit" | "preview" | "ai";
interface RevisionMeta { id: string; note: string; created_at: string }

const STEPS: { key: Step; label: string; hint: string }[] = [
  { key: "diagnose", label: "1 诊断", hint: "核对 · 评估" },
  { key: "optimize", label: "2 优化", hint: "改写 · 采纳" },
  { key: "export", label: "3 导出", hint: "排版 · 导出" },
];

export function EditorPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const stepParam = sp.get("step");
  const step: Step = stepParam === "optimize" || stepParam === "export" ? stepParam : "diagnose";
  const setStep = (s: Step) => setSp({ step: s }, { replace: true });

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

  // 导航守卫：仅拦「离开当前 /editor/:id」（同 pathname 仅切 ?step 不拦）
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    (dirty || conflict) && currentLocation.pathname !== nextLocation.pathname);
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
    if (ok) toast.success("已用你的版本覆盖"); else toast.error("覆盖保存失败，请重试");
  };

  const openHistory = async () => {
    setHistOpen(true); setRevisions(null);
    try { setRevisions((await getJSON<{ revisions: RevisionMeta[] }>(`/api/resumes/${id}/revisions`)).revisions); }
    catch (e) { toast.error((e as Error).message); setHistOpen(false); }
  };
  const rollback = async (revisionId: string) => {
    if (!window.confirm("回滚到该版本？当前内容会先自动快照，可再回滚回来。")) return;
    if (useStore.getState().dirty) {
      const ok = await saveNow();
      if (!ok) return toast.error("本地修改保存失败，已取消回滚");
    }
    try {
      const rec = await postJSON<ResumeRecord>(`/api/resumes/${id}/rollback`,
        { revisionId, version: useStore.getState().version });
      loadRecord(rec); setHistOpen(false); toast.success("已回滚");
    } catch (e) {
      const err = e as { code?: string; message?: string };
      toast.error(err.code === "VERSION_CONFLICT" ? "已在别处被修改，请先处理冲突" : (err.message || "回滚失败"));
    }
  };

  if (resumeId !== id) return <div className="px-6 py-8 text-copy-14 text-muted-foreground">加载中…</div>;

  const status = conflict ? "冲突" : saving ? "保存中…" : dirty ? "未保存" : "已保存";
  const mtabCls = (t: MobileTab) => cn("flex-1 rounded-md px-3 py-1.5 text-button-14",
    mtab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground");

  // 诊断/优化：三栏（AIPanel 锁定对应 tab）；导出：StepExport
  const ThreeCol = ({ aiOnly }: { aiOnly: "diagnose" | "improve" }) => (
    <>
      <div className="flex shrink-0 gap-1 border-b border-border p-2 lg:hidden">
        <button className={mtabCls("edit")} onClick={() => setMtab("edit")}>编辑</button>
        <button className={mtabCls("preview")} onClick={() => setMtab("preview")}>预览</button>
        <button className={mtabCls("ai")} onClick={() => setMtab("ai")}>{aiOnly === "diagnose" ? "诊断" : "改写"}</button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div key={hydrationKey} className={cn("min-h-0 overflow-y-auto border-r border-border",
          "w-full lg:w-[380px] lg:shrink-0", mtab !== "edit" && "hidden lg:block")}>
          <SectionEditor />
        </div>
        <div className={cn("min-h-0 flex-1", mtab !== "preview" && "hidden lg:block")}><LivePreview /></div>
        <div className={cn("min-h-0 border-l border-border", "w-full lg:w-[400px] lg:shrink-0",
          mtab !== "ai" && "hidden lg:block")}>
          <AIPanel only={aiOnly} />
        </div>
      </div>
    </>
  );

  return (
    <div className="flex h-[calc(100vh-65px)] min-h-0 flex-col">
      {/* 顶栏 */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background px-4 py-2.5">
        <Button variant="ghost" aria-label="返回列表" onClick={() => nav("/")}><ArrowLeft className="h-4 w-4" /></Button>
        <Input aria-label="简历名称" value={title} onChange={(e) => setTitle(e.target.value)}
          className="max-w-[220px]" placeholder="未命名简历" />
        <span className={cn("text-label-12 whitespace-nowrap",
          conflict ? "text-destructive" : dirty || saving ? "text-muted-foreground" : "text-green-900")}>
          {!dirty && !saving && !conflict && <Check className="inline h-3.5 w-3.5" />} {status} · v{version}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={() => setImportOpen(true)}><FileUp className="h-4 w-4" /> 导入</Button>
          <Button variant="ghost" onClick={openHistory} aria-label="历史版本"><History className="h-4 w-4" /> 历史</Button>
          <Button variant="secondary" disabled={saving || !dirty || conflict} onClick={() => void saveNow()}>
            <Save className="h-4 w-4" /> 保存
          </Button>
        </div>
      </div>

      {/* 全局步骤条 */}
      <nav aria-label="步骤" className="flex shrink-0 gap-2 border-b border-border bg-background px-4 py-2.5">
        {STEPS.map((s) => {
          const active = s.key === step;
          return (
            <button key={s.key} aria-current={active ? "step" : undefined} onClick={() => setStep(s.key)}
              className={cn("flex items-baseline gap-2 rounded-full border px-4 py-1.5 text-button-14 transition",
                active ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground bg-background hover:text-foreground")}>
              <span>{s.label}</span>
              <span className={cn("text-label-12 font-normal hidden sm:inline",
                active ? "text-primary-foreground/80" : "text-muted-foreground")}>{s.hint}</span>
            </button>
          );
        })}
      </nav>

      {conflict && (
        <Alert tone="red" className="mx-4 mt-3 shrink-0">
          <b>这份简历已在别处被修改</b>，你的自动保存被拒。请选择：
          <div className="mt-2 flex gap-2">
            <Button variant="secondary" onClick={reload}>重新加载（丢弃本地改动）</Button>
            <Button variant="danger" onClick={overrideMine}>用我的覆盖</Button>
          </div>
        </Alert>
      )}

      {/* 步骤内容 */}
      {step === "diagnose" && <ThreeCol aiOnly="diagnose" />}
      {step === "optimize" && <ThreeCol aiOnly="improve" />}
      {step === "export" && (
        <div key={hydrationKey} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-5 py-6"><StepExport /></div>
        </div>
      )}

      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />

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
