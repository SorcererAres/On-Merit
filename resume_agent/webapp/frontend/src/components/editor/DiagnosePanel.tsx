// 右栏 · 诊断面板（两级页，见 plan diagnose-report-two-level）：
//   一级「诊断台」= 岗位 select + 目标 JD + 诊断按钮 + 最新报告入口；二级「报告页」= 固定头 + 独立滚动评分。
// 报告过期不销毁：编辑简历/改 JD/换岗位后报告保留，靠语境戳（contentSeq/jd/role）推导过期挂黄条。
// 逻辑沿用原 AIPanel：异步结果按 id+loadSeq+editSeq 语境戳丢弃过期；无任何 X→Y 自评提升口径。
import { useEffect, useState } from "react";
import { postJSON, getJSON } from "@/lib/api";
import { useTask } from "@/lib/useTask";
import { useStore } from "@/store/useStore";
import { TaskStatus } from "@/components/TaskStatus";
import { ScoreCard } from "@/components/ScoreCard";
import { MatchReportView } from "@/components/MatchReportView";
import { Alert } from "@/components/ui/misc";
import type { EvalResult, MatchReport, Role } from "@/types";
import { Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Wand2, ArrowLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";

const fmtTime = (at: number) =>
  new Date(at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

export function DiagnosePanel({ onBeforeRun }: { onBeforeRun?: () => boolean | Promise<boolean> } = {}) {
  const { resume, jd, role, diagnosis, contentSeq, setJD, setRole, setDiagnosis } = useStore();
  const [roles, setRoles] = useState<Role[]>([]);
  // 一级/二级页导航（仅组件内部态；切 tab / 切简历时组件卸载重挂，自然回到 console）
  const [view, setView] = useState<"console" | "report">("console");
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
    if (r && fresh(st) && r.role !== useStore.getState().role) setRole(r.role);
  };

  const analyze = useTask(async (signal) => {
    const [evalResult, match] = await Promise.all([
      postJSON<EvalResult>("/api/evaluate", { resume, role }, signal),
      jd.trim() ? postJSON<MatchReport>("/api/match", { resume, jd }, signal) : Promise.resolve(null),
    ]);
    return { evalResult, match };
  });
  const runAnalyze = async () => {
    if (onBeforeRun && !(await onBeforeRun())) return; // 有待完善项时，由用户明确选择补全或继续
    const st = stamp();
    const r = await analyze.run();
    if (!r) return;
    if (fresh(st)) {
      // 语境戳：报告的真实输入（内容版本 + JD + role）+ 生成时刻，供过期推导与「生成时间」显示
      const s = useStore.getState();
      setDiagnosis({ report: r, stamp: { contentSeq: s.contentSeq, jd: s.jd, role: s.role, at: Date.now() } });
      setView("report");   // 诊断完成自动进入二级报告页
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

  // 过期推导态：报告的真实输入变了 ⇒ 挂黄条（不销毁报告）。jd/role 按值比较，内容看 contentSeq。
  const stale = !!diagnosis && (
    diagnosis.stamp.contentSeq !== contentSeq
    || diagnosis.stamp.jd !== jd
    || diagnosis.stamp.role !== role
  );
  const shortcutKey = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘↵" : "Ctrl+Enter";

  // ===== 二级 · 报告页（仅在有报告时可达）=====
  if (view === "report" && diagnosis) {
    const ev = diagnosis.report.evalResult;
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border pl-3 pr-3">
          <Button type="button" variant="ghost" aria-label="返回诊断台" onClick={() => setView("console")}
            className="h-11 rounded-sm px-2 text-copy-14 text-foreground">
            <ArrowLeft className="h-4 w-4" /> 返回
          </Button>
          <span className="text-copy-13 text-muted-foreground">生成于 {fmtTime(diagnosis.stamp.at)}</span>
          <Button variant="secondary" disabled={analyze.loading || !resume} onClick={runAnalyze}
            className="ml-auto px-3 text-copy-13">重新诊断</Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3">
          {stale && (
            <Alert tone="amber" className="mb-3">简历已变更，本报告基于旧内容——请重新诊断以获取最新评分。</Alert>
          )}
          <TaskStatus loading={analyze.loading} elapsed={analyze.elapsed} stop={analyze.stop} error={analyze.error} />
          <ScoreCard data={ev} />
          {diagnosis.report.match && (
            <div className="mt-3 border-t border-border pt-2">
              <div className="text-label-13 text-muted-foreground">对目标 JD 的覆盖度</div>
              <MatchReportView report={diagnosis.report.match} />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3.5">
      {/* 设计稿 843:268：select 全宽带 chevron；自动检测魔棒挪到 label 行右端（功能保留，不挤占 select） */}
      <div className="flex items-center justify-between">
        <label htmlFor="dg-role" className="text-copy-14 text-foreground">岗位</label>
        <Button type="button" variant="ghost" aria-label="自动检测岗位" title="有 JD 以 JD 为准，否则按简历"
          disabled={detect.loading} onClick={runDetect} className="w-11 px-0 text-muted-foreground hover:text-foreground">
          <Wand2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="mt-2">
        {/* shadcn Select（自绘弹层）；高度走 ui 标准 40px，圆角对齐面板控件 */}
        <Select value={role} onValueChange={setRole} disabled={detect.loading}>
          <SelectTrigger id="dg-role" aria-label="评分岗位" className="rounded-md">
            <SelectValue placeholder="请选择岗位" />
          </SelectTrigger>
          <SelectContent>
            {roles.map((r) => <SelectItem key={r.key} value={r.key}>{r.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <label htmlFor="dg-jd" className="mt-3.5 block text-copy-14 text-foreground">目标 JD</label>
      <Textarea id="dg-jd" rows={4} aria-label="目标岗位 JD" placeholder="粘贴目标职位JD（可留空）⋯"
        value={jd} onChange={(e) => setJD(e.target.value)}
        aria-keyshortcuts="Meta+Enter Control+Enter"
        onKeyDown={(e) => {
          if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter" || analyze.loading || !resume) return;
          e.preventDefault();
          void runAnalyze();
        }}
        className="mt-2 h-24 resize-none rounded-md py-3 text-copy-14" />

      <Button disabled={analyze.loading || !resume} onClick={runAnalyze}
        title={`运行诊断（${shortcutKey}）`} aria-keyshortcuts="Meta+Enter Control+Enter"
        className="mt-4 w-full rounded-sm">
        {diagnosis ? "重新诊断" : "诊断"}
      </Button>
      <TaskStatus loading={analyze.loading} elapsed={analyze.elapsed} stop={analyze.stop} error={analyze.error} />

      {!diagnosis && !analyze.loading && (
        <p className="mt-3 text-copy-13 text-muted-foreground">
          填了 JD 会同时计算覆盖度。简历变更后旧诊断自动失效；评分为模型启发式意见，非面试率。
        </p>
      )}
      {diagnosis && !analyze.loading && (
        // 最新报告入口：点击进二级报告页（过期时右侧标注）
        <Button type="button" variant="secondary" onClick={() => setView("report")}
          className="mt-4 h-auto w-full justify-start rounded-sm px-3 py-2.5 text-left active:scale-100">
          <span className="text-button-14 text-foreground">
            最新报告 {diagnosis.report.evalResult.score}/{diagnosis.report.evalResult.max}
          </span>
          <span className="text-copy-13 text-muted-foreground">· {fmtTime(diagnosis.stamp.at)}</span>
          {stale && <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-label-12 text-amber-900">已过期</span>}
          <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      )}
    </div>
  );
}
