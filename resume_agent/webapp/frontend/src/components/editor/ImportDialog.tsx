// 导入弹窗：PDF/图片（自动 OCR）/粘贴文本 → 结构化 → 灌入当前简历（覆盖需确认）。
import { useState } from "react";
import { postForm, postJSON } from "@/lib/api";
import { useTask } from "@/lib/useTask";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskStatus } from "@/components/TaskStatus";
import type { Resume, Warning } from "@/types";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { confirmDialog } from "@/components/confirm";
import { cn } from "@/lib/cn";

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { resume, jd, setImported, setRole } = useStore();
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [over, setOver] = useState(false);

  const ingest = useTask((signal) => {
    const fd = new FormData();
    if (file) fd.append("file", file); else fd.append("text", text);
    return postForm<{ resume: Resume; warnings: Warning[]; usedOcr: boolean; source_text: string }>("/api/ingest", fd, signal);
  });

  const submit = async () => {
    if (!file && !text.trim()) return;
    const hasContent = (resume?.work?.length || resume?.basics?.name);
    if (hasContent && !(await confirmDialog({
      title: "导入将覆盖当前内容", description: "自动保存前会先快照旧版，可回滚。继续？",
      confirmText: "继续导入",
    }))) return;
    // 语境戳（id+loadSeq+editSeq）：切换/重载丢弃在途结果；同简历期间有编辑则再确认覆盖
    const s0 = useStore.getState();
    const start = { id: s0.resumeId, load: s0.loadSeq, seq: s0.editSeq };
    const r = await ingest.run();
    if (!r) return;
    const s1 = useStore.getState();
    if (s1.resumeId !== start.id || s1.loadSeq !== start.load) return;  // 语境已换，不写
    if (s1.editSeq !== start.seq
        && !(await confirmDialog({
          title: "简历在解析期间有改动", description: "导入会覆盖这些改动。继续？",
          confirmText: "仍然导入",
        }))) return;
    setImported(r.resume, r.warnings, r.usedOcr, r.source_text ?? null);
    toast.success(r.usedOcr ? "已识别（OCR），请重点核对" : "已导入");
    onClose();
    // 岗位检测异步回填：绑定「导入完成后」的完整戳——期间用户改过任何东西（含手动选岗位）都不回填
    const s2 = useStore.getState();
    const after = { id: s2.resumeId, load: s2.loadSeq, seq: s2.editSeq };
    postJSON<{ role: string }>("/api/detect-role",
      jd.trim() ? { jd } : { resume: r.resume, jd: "" })
      .then((d) => {
        const s3 = useStore.getState();
        if (s3.resumeId === after.id && s3.loadSeq === after.load && s3.editSeq === after.seq) setRole(d.role);
      })
      .catch(() => {});
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-2xl p-5">
        <DialogTitle className="pr-12">导入简历</DialogTitle>
        <DialogDescription className="text-copy-13">支持 PDF、扫描件/图片（自动 OCR），或直接粘贴文本。</DialogDescription>
        <div className="grid items-center gap-3 md:grid-cols-import">
          <label
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
            className={cn("flex min-h-dropzone cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed p-4 text-center focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
              over ? "border-primary text-primary" : "border-border text-muted-foreground")}>
            <Input type="file" accept="application/pdf,image/*" aria-label="选择简历 PDF 或图片" className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Upload className="h-6 w-6" />
            <span className="text-copy-14">{file ? file.name : "点击选择 PDF / 图片（或拖入）"}</span>
          </label>
          <div className="text-center text-muted-foreground text-copy-14">或</div>
          <Textarea rows={5} aria-label="粘贴简历文本" placeholder="粘贴简历文本…" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        {ingest.loading && (
          <div className="mt-3 space-y-2" aria-hidden>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        )}
        <Button className="mt-3" disabled={ingest.loading} onClick={submit}>解析并导入</Button>
        <TaskStatus loading={ingest.loading} elapsed={ingest.elapsed} stop={ingest.stop} error={ingest.error} />
      </DialogContent>
    </Dialog>
  );
}
