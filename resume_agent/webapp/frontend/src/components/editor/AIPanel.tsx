// 右栏 · AI 面板：诊断（评分+JD覆盖）/ 改写（diff 逐条采纳）。
// 面板互相独立、无硬顺序（端点各自自评/自匹配）；resume 一变结果即清空（失效=清空）。
import { useEffect, useState } from "react";
import { postJSON, getJSON } from "@/lib/api";
import { useTask } from "@/lib/useTask";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { Textarea, Select, Label } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { TaskStatus } from "@/components/TaskStatus";
import { ScoreCard } from "@/components/ScoreCard";
import { MatchReportView } from "@/components/MatchReportView";
import type { EvalResult, MatchReport, Change, ApplyResult, Patch, Role } from "@/types";
import { cn } from "@/lib/cn";
import { Wand2, ArrowRight } from "lucide-react";
import { toast } from "sonner";

type Tab = "diagnose" | "improve";
interface GenResult { changes: Change[]; notes: string[]; supplements: string[] }

export function AIPanel() {
  const {
    resume, jd, role, diagnosis, improve, afterScore,
    setJD, setRole, setDiagnosis, setImprove, applyResume, setAfterScore,
  } = useStore();
  const [tab, setTab] = useState<Tab>("diagnose");
  const [roles, setRoles] = useState<Role[]>([]);
  const [accepted, setAccepted] = useState<Record<number, boolean>>({});
  useEffect(() => { getJSON<{ roles: Role[] }>("/api/roles").then((d) => setRoles(d.roles)).catch(() => {}); }, []);

  const hasJD = jd.trim().length > 0;

  // —— 岗位自动检测（有 JD 以 JD 为准）——
  const detect = useTask((signal) =>
    postJSON<{ role: string; label: string }>("/api/detect-role",
      jd.trim() ? { jd } : { resume: resume ?? undefined, jd: "" }, signal));
  const runDetect = async () => { const r = await detect.run(); if (r) setRole(r.role); };

  // —— 诊断：评分 +（有 JD）覆盖度 ——
  const analyze = useTask(async (signal) => {
    const evalResult = await postJSON<EvalResult>("/api/evaluate", { resume, role }, signal);
    const match = jd.trim() ? await postJSON<MatchReport>("/api/match", { resume, jd }, signal) : null;
    return { evalResult, match };
  });
  const runAnalyze = async () => { const r = await analyze.run(); if (r) setDiagnosis(r); };

  // —— 改写：有 JD 走 JD 强化 / 无 JD 走 rubric 自动改 ——
  const gen = useTask(async (signal): Promise<GenResult> => {
    if (hasJD) {
      const r = await postJSON<{ changes: Change[]; notes: string[]; must_supplements: string[] }>(
        "/api/improve", { resume, jd }, signal);
      return { changes: r.changes, notes: r.notes, supplements: r.must_supplements };
    }
    const r = await postJSON<{ changes: Change[]; notes: string[]; gaps: string[] }>(
      "/api/auto-improve", { resume, role }, signal);
    return { changes: r.changes, notes: r.notes, supplements: r.gaps };
  });
  const runGen = async () => {
    const r = await gen.run();
    if (r) { setImprove(r.changes, r.notes, r.supplements); setAccepted({}); }  // 默认不勾，逐条确认
  };

  const apply = useTask(async (signal, patches: Patch[]) => {
    const applied = await postJSON<ApplyResult>("/api/apply", { resume, patches }, signal);
    if (!applied.committed) return { applied, after: null as EvalResult | null };
    const after = await postJSON<EvalResult>("/api/evaluate", { resume: applied.resume, role }, signal);
    return { applied, after };
  });
  const changes = improve?.changes ?? [];
  const chosen = changes.filter((_, i) => accepted[i]).length;
  const runApply = async () => {
    const patches: Patch[] = changes.filter((_, i) => accepted[i])
      .map((c) => ({ op: "replace", path: c.path, old: c.old, value: c.new }));
    if (!patches.length) return toast.error("请先勾选要采纳的改动");
    const r = await apply.run(patches);
    if (!r) return;
    if (!r.applied.committed) return toast.error("改动会让简历结构不合法，已回退");
    applyResume(r.applied.resume);
    if (r.after) setAfterScore(r.after.score, r.after.max);
    const n = r.applied.results.filter((x) => x.status === "applied").length;
    toast.success(`已采纳 ${n} 条（已自动保存）`);
  };

  const before = diagnosis?.evalResult.score;
  const tabCls = (t: Tab) => cn(
    "flex-1 border-b-2 px-3 py-2 text-button-14 transition",
    tab === t ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 border-b border-border">
        <button className={tabCls("diagnose")} onClick={() => setTab("diagnose")}>诊断</button>
        <button className={tabCls("improve")} onClick={() => setTab("improve")}>改写</button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "diagnose" && (
          <div>
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
        )}

        {tab === "improve" && (
          <div>
            <p className="text-copy-13 text-muted-foreground">
              {hasJD ? "针对 JD 强化「证据弱」项（不编造）；缺失的硬性要求只提示「需真实补充」。"
                : "按岗位体检弱项重述已有事实（不编造）。填 JD 可改为针对性强化。"}
              <br />本次改写基于自身评估，与诊断分数可能有出入；改动默认不勾选，请逐条核对。
            </p>
            <Button className="mt-2 w-full" disabled={gen.loading || !resume} onClick={runGen}>
              {improve ? "重新生成建议" : "生成修改建议"}
            </Button>
            <TaskStatus loading={gen.loading} elapsed={gen.elapsed} stop={gen.stop} error={gen.error} />

            {!improve && !gen.loading && (
              <p className="mt-3 text-copy-13 text-muted-foreground">简历变更后旧建议会自动失效（清空），防止把基于旧版的改动写进新版。</p>
            )}
            {improve && !gen.loading && (
              <div className="mt-3">
                {changes.length === 0 && <p className="text-copy-14 text-muted-foreground">没有可自动强化的项。</p>}
                {changes.length > 0 && (
                  <div className="mb-2 flex items-center gap-3">
                    <label className="flex items-center gap-2 text-label-13">
                      <input type="checkbox" className="h-4 w-4 accent-primary" aria-label="全选"
                        checked={chosen === changes.length && changes.length > 0}
                        onChange={(e) => setAccepted(e.target.checked
                          ? Object.fromEntries(changes.map((_, i) => [i, true])) : {})} />
                      全选
                    </label>
                    <span className="text-label-12 text-muted-foreground">已选 {chosen}/{changes.length}</span>
                  </div>
                )}
                {changes.map((c, i) => (
                  <div key={i} className="mb-3 rounded-lg border border-border bg-card p-3">
                    <div className="text-label-12 text-muted-foreground font-mono mb-1">{c.path}</div>
                    {c.old && <del className="block text-copy-13 text-muted-foreground">{c.old}</del>}
                    <ins className="block no-underline text-copy-13 text-green-900 mt-1">{c.new}</ins>
                    <label className="mt-2 flex items-center gap-2 text-label-13">
                      <input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`采纳第 ${i + 1} 条`}
                        checked={accepted[i] ?? false}
                        onChange={(e) => setAccepted({ ...accepted, [i]: e.target.checked })} />
                      采纳这条
                    </label>
                  </div>
                ))}
                {(improve.supplements?.length ?? 0) > 0 && (
                  <Alert tone="red" className="mt-2"><b>需真实补充</b>（改写无法替代）：
                    <ul className="mt-1 list-disc pl-5">{improve.supplements.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  </Alert>
                )}
                {changes.length > 0 && (
                  <>
                    <Button className="mt-2 w-full" disabled={apply.loading} onClick={runApply}>采纳选中的 {chosen} 条</Button>
                    <TaskStatus loading={apply.loading} elapsed={apply.elapsed} stop={apply.stop} error={apply.error} />
                  </>
                )}
              </div>
            )}

            {afterScore && (
              <div className="mt-4 rounded-lg border border-border bg-card p-3">
                <div className="text-label-13 text-muted-foreground mb-1">采纳后复评</div>
                <div className="flex items-center gap-3">
                  <span className="text-heading-24 text-muted-foreground">{before ?? "—"}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  <span className="text-heading-24 text-primary">{afterScore.score}</span>
                  <span className="text-copy-13 text-muted-foreground">/ {afterScore.max}</span>
                </div>
                <p className="text-label-12 text-muted-foreground mt-1">同一模型复评，含波动，仅供参考。</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
