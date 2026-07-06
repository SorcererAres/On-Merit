// 右栏 · 诊断面板（设计稿布局）：岗位 select + 目标 JD + 诊断按钮 → 评分报告（雷达/维度/覆盖度）。
// 逻辑沿用原 AIPanel：异步结果按 id+loadSeq+editSeq 语境戳丢弃过期；无任何 X→Y 自评提升口径。
import { useEffect, useState } from "react";
import { postJSON, getJSON } from "@/lib/api";
import { useTask } from "@/lib/useTask";
import { useStore } from "@/store/useStore";
import { TaskStatus } from "@/components/TaskStatus";
import { ScoreCard } from "@/components/ScoreCard";
import { MatchReportView } from "@/components/MatchReportView";
import type { EvalResult, MatchReport, Role } from "@/types";
import { Select, Textarea } from "@/components/ui/input";
import { Wand2, ChevronDown } from "lucide-react";
import { toast } from "sonner";

export function DiagnosePanel({ onBeforeRun }: { onBeforeRun?: () => void } = {}) {
  const { resume, jd, role, diagnosis, setJD, setRole, setDiagnosis } = useStore();
  const [roles, setRoles] = useState<Role[]>([]);
  useEffect(() => { getJSON<{ roles: Role[] }>("/api/roles").then((d) => setRoles(d.roles)).catch(() => {}); }, []);

  const stamp = () => { const s = useStore.getState(); return { id: s.resumeId, load: s.loadSeq, seq: s.editSeq }; };
  const fresh = (st: { id: string | null; load: number; seq: number }) => {
    const s = useStore.getState();
    return s.resumeId === st.id && s.loadSeq === st.load && s.editSeq === st.seq;
  };

  const detect = useTask((signal) =>
    postJSON<{ role: string; label: string }>("/api/detect-role",
      jd.trim() ? { jd } : { resume: resume ?? undefined, jd: "" }, signal));
  const runDetect = async () => {
    const st = stamp();
    const r = await detect.run();
    if (r && fresh(st)) setRole(r.role);
  };

  const analyze = useTask(async (signal) => {
    const evalResult = await postJSON<EvalResult>("/api/evaluate", { resume, role }, signal);
    const match = jd.trim() ? await postJSON<MatchReport>("/api/match", { resume, jd }, signal) : null;
    return { evalResult, match };
  });
  const runAnalyze = async () => {
    onBeforeRun?.();                 // 诊断前完整性提示（不阻断，仅亮黄条 §4.3）
    const st = stamp();
    const r = await analyze.run();
    if (!r) return;
    if (fresh(st)) {
      setDiagnosis(r);
      // 存档一条只读报告快照（历史回顾用；失败不打扰——记录缺一条无碍诊断本身）
      if (st.id) {
        postJSON(`/api/resumes/${st.id}/reports`, {
          role: useStore.getState().role,
          role_label: r.evalResult.role_label,
          score: r.evalResult.score, max: r.evalResult.max,
          has_jd: !!r.match,
          report: r,
        }).catch(() => {});
      }
    } else toast.message("诊断期间简历有变更，结果已失效，请重新诊断");
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3.5">
      {/* 设计稿 843:268：select 全宽带 chevron；自动检测魔棒挪到 label 行右端（功能保留，不挤占 select） */}
      <div className="flex items-center justify-between">
        <label htmlFor="dg-role" className="text-[14px] leading-[17px] text-foreground">岗位</label>
        <button aria-label="自动检测岗位" title="有 JD 以 JD 为准，否则按简历" disabled={detect.loading}
          onClick={runDetect}
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-50">
          <Wand2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="relative mt-2">
        {/* ui/Select（自带焦点环）；设计稿尺寸 h-9 / rounded-[8px] 用 className 覆盖 */}
        <Select id="dg-role" aria-label="评分岗位" value={role} disabled={detect.loading}
          onChange={(e) => setRole(e.target.value)}
          className="h-9 min-h-0 w-full appearance-none rounded-[8px] py-0 pl-3 pr-9 text-[14px]">
          {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </Select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>

      <label htmlFor="dg-jd" className="mt-3.5 block text-[14px] leading-[17px] text-foreground">目标 JD</label>
      <Textarea id="dg-jd" rows={4} aria-label="目标岗位 JD" placeholder="粘贴目标职位JD（可留空）⋯"
        value={jd} onChange={(e) => setJD(e.target.value)}
        className="mt-2 h-24 resize-none rounded-[8px] py-3 text-[14px] leading-[1.5]" />

      <button disabled={analyze.loading || !resume} onClick={runAnalyze}
        className="mt-4 h-9 w-full rounded-[8px] bg-primary text-[14px] text-primary-foreground disabled:opacity-50">
        {diagnosis ? "重新诊断" : "诊断"}
      </button>
      <TaskStatus loading={analyze.loading} elapsed={analyze.elapsed} stop={analyze.stop} error={analyze.error} />

      {!diagnosis && !analyze.loading && (
        <p className="mt-3 text-copy-13 text-muted-foreground">
          填了 JD 会同时计算覆盖度。简历变更后旧诊断自动失效；评分为模型启发式意见，非面试率。
        </p>
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
  );
}
