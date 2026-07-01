// 阶段二 · 修改：二选一（有 JD 走 JD 强化 / 无 JD 走 rubric 自动改）→ 逐条确认 → 应用 → 复评。
import { useState } from "react";
import { postJSON } from "@/lib/api";
import { useTask } from "@/lib/useTask";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";
import { TaskStatus } from "@/components/TaskStatus";
import type { Change, ApplyResult, Patch, EvalResult } from "@/types";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";

// 两种改写端点的统一返回
interface GenResult { changes: Change[]; notes: string[]; supplements: string[] }

export function PhaseModify() {
  const {
    resume, jd, role, diagnosis, improve, afterScore,
    setImprove, applyResume, setAfterScore, unlock, goPhase,
  } = useStore();
  const [accepted, setAccepted] = useState<Record<number, boolean>>({});
  const hasJD = jd.trim().length > 0;

  if (!diagnosis) {
    return (
      <section>
        <Alert tone="amber">请先在「诊断」阶段完成分析，再来修改。</Alert>
        <Button className="mt-3" variant="secondary" onClick={() => goPhase(1)}>← 回到诊断</Button>
      </section>
    );
  }

  // —— 生成改写建议（二选一）——
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
    if (r) { setImprove(r.changes, r.notes, r.supplements); setAccepted({}); }  // 默认全不勾，逐条确认
  };

  // —— 应用选中 + 自动复评 ——
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
    if (r.after) { setAfterScore(r.after.score, r.after.max); unlock(3); }
    const n = r.applied.results.filter((x) => x.status === "applied").length;
    const stale = r.applied.results.filter((x) => x.status === "stale").length;
    toast.success(`已应用 ${n} 条` + (stale ? `，${stale} 条因原值变化跳过` : ""));
    setImprove([], improve?.notes ?? [], improve?.supplements ?? []);
  };

  const before = diagnosis.evalResult.score;

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-heading-24 mb-1">{hasJD ? "针对 JD 强化" : "按弱项自动修改"}（不编造）</h2>
        <p className="text-copy-14 text-muted-foreground">
          {hasJD
            ? "只强化「证据弱」项的表述；缺失的硬性要求提示「需真实补充」，不替你编。"
            : "按诊断的薄弱维度重述已有事实（STAR、突出已有数字），结构造假物理不可能。"}
          <br />改动<b>默认不勾选</b>，请逐条核对后再采纳。
        </p>
        <Button className="mt-3" disabled={gen.loading} onClick={runGen}>
          {improve ? "重新生成建议" : "生成修改建议"}
        </Button>
        <TaskStatus loading={gen.loading} elapsed={gen.elapsed} stop={gen.stop} error={gen.error} />
      </div>

      {improve && !gen.loading && (
        <div>
          {changes.length === 0 && <p className="text-copy-14 text-muted-foreground">没有可自动强化的项（可能都已达标，或需真实补充）。</p>}

          {changes.length > 0 && (
            <div className="mb-2 flex items-center gap-3">
              <label className="flex items-center gap-2 text-label-13">
                <input type="checkbox" className="h-4 w-4 accent-primary" aria-label="全选/全不选"
                  checked={chosen === changes.length && changes.length > 0}
                  onChange={(e) => setAccepted(e.target.checked
                    ? Object.fromEntries(changes.map((_, i) => [i, true])) : {})} />
                全选
              </label>
              <span className="text-label-12 text-muted-foreground">已选 {chosen}/{changes.length}</span>
            </div>
          )}

          {changes.map((c, i) => (
            <div key={i} className="mb-3 rounded-xl border border-border bg-card p-4">
              <div className="text-label-12 text-muted-foreground font-mono mb-1.5">{c.path}</div>
              {c.old && <del className="block text-copy-14 text-muted-foreground">{c.old}</del>}
              <ins className="block no-underline text-copy-14 text-green-900 mt-1">{c.new}</ins>
              <label className="mt-2 flex items-center gap-2 text-label-13">
                <input type="checkbox" className="h-4 w-4 accent-primary" aria-label={`采纳第 ${i + 1} 条改动`}
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
              <Button className="mt-3" disabled={apply.loading} onClick={runApply}>应用选中的 {chosen} 条</Button>
              <TaskStatus loading={apply.loading} elapsed={apply.elapsed} stop={apply.stop} error={apply.error} />
            </>
          )}
        </div>
      )}

      {/* —— 修改后复评：前后对比 —— */}
      {afterScore && (
        <Card>
          <h3 className="text-heading-20 mb-2">修改后复评</h3>
          <div className="flex items-center gap-4">
            <div className="text-center"><div className="text-label-12 text-muted-foreground">修改前</div>
              <div className="text-heading-24 text-muted-foreground">{before}</div></div>
            <ArrowRight className="h-5 w-5 text-muted-foreground" />
            <div className="text-center"><div className="text-label-12 text-muted-foreground">修改后</div>
              <div className="text-heading-40 text-primary">{afterScore.score}</div></div>
            <div className="text-copy-13 text-muted-foreground">
              / {afterScore.max}
              {afterScore.score !== before && (
                <span className={afterScore.score > before ? "text-green-900" : "text-destructive"}>
                  （{afterScore.score > before ? "+" : ""}{Math.round((afterScore.score - before) * 10) / 10}）
                </span>
              )}
            </div>
          </div>
          <p className="text-label-12 text-muted-foreground mt-2">同一模型复评，含波动，仅供参考；真正是否更好请看改动本身。</p>
          <Button className="mt-4" onClick={() => goPhase(3)}>去排版导出 <ArrowRight className="h-4 w-4" /></Button>
        </Card>
      )}
    </section>
  );
}
