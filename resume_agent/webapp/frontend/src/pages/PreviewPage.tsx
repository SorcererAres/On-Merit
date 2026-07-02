// 预览/导出页 /preview/:id：载入记录 → 整页导出编辑器（复用 StepExport）。
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getJSON } from "@/lib/api";
import { useStore } from "@/store/useStore";
import type { ResumeRecord } from "@/store/useStore";
import { StepExport } from "@/steps/StepExport";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

export function PreviewPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const { resumeId, loadRecord } = useStore();

  useEffect(() => {
    let alive = true;
    getJSON<ResumeRecord>(`/api/resumes/${id}`)
      .then((rec) => { if (alive) loadRecord(rec); })
      .catch((e) => { toast.error(e.message || "简历不存在"); nav("/"); });
    return () => { alive = false; };
  }, [id]);

  if (resumeId !== id) return <div className="px-6 py-8 text-copy-14 text-muted-foreground">加载中…</div>;

  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background px-5 py-3">
        <Button variant="ghost" aria-label="返回" onClick={() => nav(`/editor/${id}`)}>
          <ArrowLeft className="h-4 w-4" /> 回编辑
        </Button>
        <span className="text-heading-20">预览 / 导出</span>
      </div>
      <main className="mx-auto max-w-6xl px-5 py-7 pb-24"><StepExport /></main>
    </div>
  );
}
