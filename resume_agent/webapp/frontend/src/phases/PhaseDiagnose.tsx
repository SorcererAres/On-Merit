// 阶段一 · 诊断：上传/OCR → 核对 → 岗位(自动检测,可改)+JD选填 → 分析 → 诊断报告。
import { useEffect, useRef, useState } from "react";
import { postForm, postJSON, getJSON } from "@/lib/api";
import { useTask } from "@/lib/useTask";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { Textarea, Select, Label } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";
import { TaskStatus } from "@/components/TaskStatus";
import { ReviewEditor } from "@/components/ReviewEditor";
import { ScoreCard } from "@/components/ScoreCard";
import { MatchReportView } from "@/components/MatchReportView";
import type { Resume, Warning, EvalResult, MatchReport, Role } from "@/types";
import { Upload, Wand2, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export function PhaseDiagnose() {
  const {
    resume, warnings, usedOcr, jd, role, diagnosis,
    setImported, setJD, setRole, setDiagnosis, unlock, goPhase,
  } = useStore();

  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [over, setOver] = useState(false);
  const [roles, setRoles] = useState<Role[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { getJSON<{ roles: Role[] }>("/api/roles").then((d) => setRoles(d.roles)).catch(() => {}); }, []);

  // —— 导入 ——
  const ingest = useTask((signal) => {
    const fd = new FormData();
    if (file) fd.append("file", file); else fd.append("text", text);
    return postForm<{ resume: Resume; warnings: Warning[]; usedOcr: boolean }>("/api/ingest", fd, signal);
  });
  const runImport = async () => {
    if (!file && !text.trim()) return;
    const r = await ingest.run();
    if (r) {
      setImported(r.resume, r.warnings, r.usedOcr);
      detectRoleFrom(r.resume, "");   // 导入后按简历自动检测岗位
    }
  };

  // —— 岗位自动检测（有 JD 以 JD 为准）——
  const detect = useTask((signal, body: { resume?: Resume; jd: string }) =>
    postJSON<{ role: string; label: string }>("/api/detect-role", body, signal));
  const detectRoleFrom = async (rsm: Resume | null, jdText: string) => {
    const r = await detect.run(jdText.trim() ? { jd: jdText } : { resume: rsm ?? undefined, jd: "" });
    if (r) setRole(r.role);
  };

  // —— 分析：评分（+JD 覆盖度）——
  const analyze = useTask(async (signal) => {
    const evalResult = await postJSON<EvalResult>("/api/evaluate", { resume, role }, signal);
    const match = jd.trim()
      ? await postJSON<MatchReport>("/api/match", { resume, jd }, signal)
      : null;
    return { evalResult, match };
  });
  const runAnalyze = async () => {
    const r = await analyze.run();
    if (r) { setDiagnosis(r); unlock(2); }
  };

  return (
    <section className="space-y-6">
      {/* —— 导入 —— */}
      <div>
        <h2 className="text-heading-24 mb-1">上传简历</h2>
        <p className="text-copy-14 text-muted-foreground mb-4">支持 PDF、扫描件/图片（自动 OCR），或直接粘贴文本。</p>
        <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] items-center">
          <label
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
            className={`flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-4 text-center focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background ${over ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
            <input ref={inputRef} type="file" accept="application/pdf,image/*" aria-label="选择简历 PDF 或图片" className="sr-only"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Upload className="h-6 w-6" />
            <span className="text-copy-14">{file ? file.name : "点击选择 PDF / 图片（或拖入）"}</span>
          </label>
          <div className="text-center text-muted-foreground text-copy-14">或</div>
          <Textarea rows={6} aria-label="粘贴简历文本" placeholder="粘贴简历文本…" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <Button className="mt-3" disabled={ingest.loading} onClick={runImport}>
          {resume ? "重新导入" : "解析简历"}
        </Button>
        <TaskStatus loading={ingest.loading} elapsed={ingest.elapsed} stop={ingest.stop} error={ingest.error} />
      </div>

      {resume && (
        <>
          {usedOcr && <Alert tone="amber">本简历经图片 OCR 识别，个别文字可能有误，请在下方「核对」中重点检查。</Alert>}

          {/* —— 核对（可折叠）—— */}
          <details className="rounded-xl border border-border bg-card">
            <summary className="cursor-pointer px-4 py-3 text-button-14">
              核对与纠错（AI 结构化可能漏字/误读，建议展开核对{warnings.length ? ` · ${warnings.length} 条提示` : ""}）
            </summary>
            <div className="border-t border-border p-4"><ReviewEditor /></div>
          </details>

          {/* —— 岗位 + JD —— */}
          <Card>
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <Label htmlFor="role">评分岗位（自动检测，可改）</Label>
                <Select id="role" value={role} onChange={(e) => setRole(e.target.value)} disabled={detect.loading}>
                  {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </Select>
              </div>
              <Button variant="ghost" disabled={detect.loading}
                onClick={() => detectRoleFrom(resume, jd)} title="有 JD 以 JD 为准，否则按简历">
                <Wand2 className="h-4 w-4" />{detect.loading ? "检测中…" : "自动检测"}
              </Button>
            </div>
            <div className="mt-3">
              <Label htmlFor="jd">目标岗位 JD（选填 · 填了会额外算「覆盖度」）</Label>
              <Textarea id="jd" rows={5} aria-label="目标岗位 JD" placeholder="粘贴目标职位的招聘要求（可留空）…"
                value={jd} onChange={(e) => setJD(e.target.value)} />
            </div>
          </Card>

          {/* —— 分析 —— */}
          <div>
            <Button disabled={analyze.loading} onClick={runAnalyze}>
              {diagnosis ? "重新分析" : "开始分析"}
            </Button>
            <TaskStatus loading={analyze.loading} elapsed={analyze.elapsed} stop={analyze.stop} error={analyze.error} />
          </div>

          {/* —— 诊断报告 —— */}
          {diagnosis && !analyze.loading && (
            <Card>
              <h3 className="text-heading-20 mb-3">诊断报告</h3>
              <ScoreCard data={diagnosis.evalResult} />
              {diagnosis.match && (
                <div className="mt-2 border-t border-border pt-2">
                  <div className="text-label-13 text-muted-foreground mb-1">对目标 JD 的覆盖度</div>
                  <MatchReportView report={diagnosis.match} />
                </div>
              )}
              <div className="mt-5">
                <Button onClick={() => { goPhase(2); toast.message("进入修改阶段"); }}>
                  去修改 <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          )}
        </>
      )}
    </section>
  );
}
