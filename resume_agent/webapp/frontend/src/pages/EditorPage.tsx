// 编辑器页 /editor/:id：载入记录 → 三阶段流；自动保存（单飞+合并待存+savePoint）+
// 409 冲突三态处理 + useBlocker 导航守卫 + hydrationKey 重挂。
import { useEffect } from "react";
import { useNavigate, useParams, useBlocker } from "react-router-dom";
import { getJSON } from "@/lib/api";
import { useAutoSave } from "@/lib/useAutoSave";
import { useStore } from "@/store/useStore";
import type { ResumeRecord } from "@/store/useStore";
import { Stepper } from "@/components/Stepper";
import { PhaseDiagnose } from "@/phases/PhaseDiagnose";
import { PhaseModify } from "@/phases/PhaseModify";
import { PhaseLayout } from "@/phases/PhaseLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { toast } from "sonner";
import { ArrowLeft, Check, Save } from "lucide-react";

const PANELS = [PhaseDiagnose, PhaseModify, PhaseLayout];

export function EditorPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const {
    phase, title, resumeId, version, dirty, conflict, hydrationKey,
    loadRecord, setTitle,
  } = useStore();
  const { saving, saveNow } = useAutoSave(id);

  // 载入
  useEffect(() => {
    let alive = true;
    getJSON<ResumeRecord>(`/api/resumes/${id}`)
      .then((rec) => { if (alive) loadRecord(rec); })
      .catch((e) => { toast.error(e.message || "简历不存在"); nav("/"); });
    return () => { alive = false; };
  }, [id]);

  // 关页/刷新前若脏 → 原生确认（useBlocker 不覆盖硬刷新）
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (useStore.getState().dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  // 应用内导航守卫（返回列表/切换简历）：脏则保存后离开或取消
  const blocker = useBlocker(dirty && !conflict);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    (async () => {
      if (window.confirm("有未保存的修改。确定=保存后离开；取消=留在本页。")) {
        await saveNow();
        blocker.proceed();
      } else blocker.reset();
    })();
  }, [blocker.state]);

  // 409：重新加载（丢弃本地）/ 用我的覆盖（取最新 version 后重存）
  const reload = async () => {
    const rec = await getJSON<ResumeRecord>(`/api/resumes/${id}`);
    loadRecord(rec); toast.message("已加载最新版本");
  };
  const overrideMine = async () => {
    const latest = await getJSON<ResumeRecord>(`/api/resumes/${id}`);
    useStore.setState({ version: latest.version, conflict: false });
    await saveNow(); toast.success("已用你的版本覆盖");
  };

  if (resumeId !== id) return <div className="px-6 py-8 text-copy-14 text-muted-foreground">加载中…</div>;

  const status = conflict ? "冲突" : saving ? "保存中…" : dirty ? "未保存" : "已保存";
  const Panel = PANELS[phase - 1];
  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background px-5 py-3">
        <Button variant="ghost" aria-label="返回列表" onClick={() => nav("/")}><ArrowLeft className="h-4 w-4" /></Button>
        <Input aria-label="简历名称" value={title} onChange={(e) => setTitle(e.target.value)}
          className="max-w-xs" placeholder="未命名简历" />
        <span className={cn("text-label-12 whitespace-nowrap",
          conflict ? "text-destructive" : dirty || saving ? "text-muted-foreground" : "text-green-900")}>
          {!dirty && !saving && !conflict && <Check className="inline h-3.5 w-3.5" />} {status} · v{version}
        </span>
        <Button className="ml-auto" variant="secondary" disabled={saving || !dirty || conflict} onClick={saveNow}>
          <Save className="h-4 w-4" /> 保存
        </Button>
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

      <div className="sticky top-[57px] z-10 border-b border-border bg-background px-5 py-3">
        <Stepper />
      </div>
      {/* hydrationKey 仅载入/回滚变：切换简历时干净重挂，不随保存 version 变 */}
      <main key={hydrationKey} className={cn("mx-auto px-5 py-7 pb-24", phase === 3 ? "max-w-6xl" : "max-w-3xl")}>
        <Panel />
      </main>
    </div>
  );
}
