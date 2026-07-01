import { useRef, useState } from "react";
import { postForm } from "@/lib/api";
import { useTask } from "@/lib/useTask";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { TaskStatus } from "@/components/TaskStatus";
import type { Resume, Warning } from "@/types";
import { Upload } from "lucide-react";

export function StepImport() {
  const { setResume, unlock, goStep } = useStore();
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const task = useTask((signal) => {
    const fd = new FormData();
    if (file) fd.append("file", file);
    else fd.append("text", text);
    return postForm<{ resume: Resume; warnings: Warning[] }>("/api/ingest", fd, signal);
  });

  const submit = async () => {
    if (!file && !text.trim()) return;
    const r = await task.run();
    if (r) { setResume(r.resume, r.warnings); unlock(2); goStep(2); }
  };

  return (
    <section>
      <h2 className="text-heading-24 mb-1">导入简历</h2>
      <p className="text-copy-14 text-muted-foreground mb-6">上传 PDF，或粘贴简历文本。结构化由本地模型完成，可能要几十秒。</p>
      <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] items-center">
        <label
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
          className={`flex min-h-[150px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-center ${over ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
          <input ref={inputRef} type="file" accept="application/pdf" hidden
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <Upload className="h-6 w-6" />
          <span className="text-copy-14">{file ? file.name : "点击选择 PDF（或拖入）"}</span>
        </label>
        <div className="text-center text-muted-foreground text-copy-14">或</div>
        <Textarea rows={7} placeholder="粘贴简历文本…" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <Button className="mt-4" disabled={task.loading} onClick={submit}>结构化</Button>
      <TaskStatus loading={task.loading} elapsed={task.elapsed} stop={task.stop} error={task.error} />
    </section>
  );
}
