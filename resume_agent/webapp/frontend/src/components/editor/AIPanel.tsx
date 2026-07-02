// 右栏 · 诊断面板：评分（雷达+维度）+（有 JD）覆盖度。resume 一变结果即清空（失效=清空）。
// 注：改写/采纳已迁至 OptimizeView（节点2）；本面板不含任何 X→Y 自评提升口径。
import { useEffect, useState } from "react";
import { postJSON, getJSON } from "@/lib/api";
import { useTask } from "@/lib/useTask";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { Textarea, Select, Label } from "@/components/ui/input";
import { TaskStatus } from "@/components/TaskStatus";
import { ScoreCard } from "@/components/ScoreCard";
import { MatchReportView } from "@/components/MatchReportView";
import type { EvalResult, MatchReport, Role } from "@/types";
import { Wand2 } from "lucide-react";
import { toast } from "sonner";

// only 保留形参以固化「仅诊断」语义（调用处传 only="diagnose"）。
export function AIPanel({ only: _only = "diagnose" }: { only?: "diagnose" }) {
  const { resume, jd, role, diagnosis, setJD, setRole, setDiagnosis } = useStore();
  const [roles, setRoles] = useState<Role[]>([]);
  useEffect(() => { getJSON<{ roles: Role[] }>("/api/roles").then((d) => setRoles(d.roles)).catch(() => {}); }, []);

  // 语境戳：异步结果只在「同一简历、未重载、期间无编辑」时写回，过期一律丢弃并提示。
  const stamp = () => {
    const s = useStore.getState();
    return { id: s.resumeId, load: s.loadSeq, seq: s.editSeq };
  };
  const fresh = (st: { id: string | null; load: number; seq: number }) => {
    const s = useStore.getState();
    return s.resumeId === st.id && s.loadSeq === st.load && s.editSeq === st.seq;
  };

  // —— 岗位自动检测（有 JD 以 JD 为准）——
  const detect = useTask((signal) =>
    postJSON<{ role: string; label: string }>("/api/detect-role",
      jd.trim() ? { jd } : { resume: resume ?? undefined, jd: "" }, signal));
  const runDetect = async () => {
    const st = stamp();
    const r = await detect.run();
    if (r && fresh(st)) setRole(r.role);   // 期间用户改过岗位/内容或重载 → 不覆盖
  };

  // —— 诊断：评分 +（有 JD）覆盖度 ——
  const analyze = useTask(async (signal) => {
    const evalResult = await postJSON<EvalResult>("/api/evaluate", { resume, role }, signal);
    const match = jd.trim() ? await postJSON<MatchReport>("/api/match", { resume, jd }, signal) : null;
    return { evalResult, match };
  });
  const runAnalyze = async () => {
    const st = stamp();
    const r = await analyze.run();
    if (!r) return;
    if (fresh(st)) setDiagnosis(r);
    else toast.message("诊断期间简历有变更，结果已失效，请重新诊断");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center border-b border-border px-4 text-xs font-medium uppercase tracking-widest text-muted-foreground">
        诊断报告
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mb-2 flex items-end gap-2">
          <div className="flex-1"><Label htmlFor="ai-role">评分岗位</Label>
            <Select id="ai-role" className="w-full" value={role} disabled={detect.loading}
              onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </Select></div>
          <Button variant="ghost" disabled={detect.loading} onClick={runDetect}
            title="有 JD 以 JD 为准，否则按简历"><Wand2 className="h-4 w-4" /></Button>
        </div>
        <Label htmlFor="ai-jd">目标 JD（选填 · 填了会算覆盖度）</Label>
        <Textarea id="ai-jd" rows={4} aria-label="目标岗位 JD" placeholder="粘贴目标职位 JD（可留空）…"
          value={jd} onChange={(e) => setJD(e.target.value)} />
        <Button className="mt-2 w-full" disabled={analyze.loading || !resume} onClick={runAnalyze}>
          {diagnosis ? "重新诊断" : "开始诊断"}
        </Button>
        <TaskStatus loading={analyze.loading} elapsed={analyze.elapsed} stop={analyze.stop} error={analyze.error} />

        {!diagnosis && !analyze.loading && (
          <p className="mt-3 text-copy-13 text-muted-foreground">简历变更后旧诊断会自动失效，请重新运行。评分为模型启发式意见，非面试率。</p>
        )}
        {diagnosis && !analyze.loading && (
          <div className="mt-4">
            <ScoreCard data={diagnosis.evalResult} />
            {diagnosis.match && (
              <div className="mt-3 border-t border-border pt-2">
                <div className="text-label-13 text-muted-foreground">对目标 JD 的覆盖度</div>
                <MatchReportView report={diagnosis.match} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
