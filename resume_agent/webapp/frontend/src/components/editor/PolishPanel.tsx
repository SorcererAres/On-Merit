// 右栏 · AI 润色面板（原 OptimizeView 迁入 360px 竖排）：生成建议 → 上下对照 → 逐条采纳。
// 诚实口径（wizard-flow-v2 §〇.2/§四）：只报「已采纳 N 处（按仅重述规则生成，请逐条核实）/
// 仍缺 M 项需真实补充」，无 X→Y 涨分、无上升动画。异步结果按 id+loadSeq+editSeq 语境戳丢弃过期。
import { useState } from "react";
import { postJSON } from "@/lib/api";
import { useTask } from "@/lib/useTask";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert } from "@/components/ui/misc";
import { TaskStatus } from "@/components/TaskStatus";
import type { Change, ApplyResult, Patch } from "@/types";
import { toast } from "sonner";

interface GenResult { changes: Change[]; notes: string[]; supplements: string[] }
const KIND = { modified: "改写", added: "新增", removed: "删除" } as const;

export function PolishPanel() {
  const { resume, jd, role, improve, setImprove, applyResume } = useStore();
  const [accepted, setAccepted] = useState<Record<number, boolean>>({});
  const hasJD = jd.trim().length > 0;

  const stamp = () => { const s = useStore.getState(); return { id: s.resumeId, load: s.loadSeq, seq: s.editSeq }; };
  const fresh = (st: { id: string | null; load: number; seq: number }) => {
    const s = useStore.getState();
    return s.resumeId === st.id && s.loadSeq === st.load && s.editSeq === st.seq;
  };

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
    const st = stamp();
    const r = await gen.run();
    if (!r) return;
    if (fresh(st)) { setImprove(r.changes, r.notes, r.supplements); setAccepted({}); }
    else toast.message("生成期间简历有变更，建议已失效，请重新生成");
  };

  const apply = useTask((signal, patches: Patch[]) =>
    postJSON<ApplyResult>("/api/apply", { resume, patches }, signal));
  const changes = improve?.changes ?? [];
  const supplements = improve?.supplements ?? [];
  const chosen = changes.filter((_, i) => accepted[i]).length;

  const runApply = async () => {
    const patches: Patch[] = changes.filter((_, i) => accepted[i])
      .map((c) => ({ op: "replace", path: c.path, old: c.old, value: c.new }));
    if (!patches.length) return toast.error("请先勾选要采纳的改动");
    const st = stamp();
    const r = await apply.run(patches);
    if (!r) return;
    if (!fresh(st)) return toast.message("采纳期间简历有变更，本次结果已丢弃，请重新生成建议");
    if (!r.committed) return toast.error("改动会让简历结构不合法，已回退");
    applyResume(r.resume);
    const n = r.results.filter((x) => x.status === "applied").length;
    // 诚实反馈：只报采纳数 + 剩余事实缺口，不报涨分
    toast.success(`已采纳 ${n} 处（按「仅重述」规则生成，请逐条核实）`
      + (supplements.length ? `；仍有 ${supplements.length} 项事实缺口需真实补充` : ""));
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3.5">
      <p className="text-copy-13 text-muted-foreground">
        {hasJD ? "针对 JD 强化「证据弱」项；缺失的硬要求只提示「需真实补充」。"
          : "按岗位体检弱项重述已有事实。填 JD 可改为针对性强化。"}
        改写按「仅重述已有事实」规则生成，<b>请逐条核实</b>；改动默认不勾选。
      </p>

      <Button disabled={gen.loading || !resume} onClick={runGen} className="mt-3 w-full">
        {improve ? "重新生成建议" : "生成修改建议"}
      </Button>
      <TaskStatus loading={gen.loading} elapsed={gen.elapsed} stop={gen.stop} error={gen.error} />

      {!improve && !gen.loading && (
        <p className="mt-3 text-copy-13 text-muted-foreground">简历变更后旧建议会自动失效（清空），防止把基于旧版的改动写进新版。</p>
      )}

      {improve && !gen.loading && (
        <div className="mt-3">
          {changes.length === 0 && (
            <p className="text-copy-14 text-muted-foreground">没有可自动强化的项（可能都已达标，或需真实补充）。</p>
          )}
          {changes.length > 0 && (
            <div className="mb-2 flex items-center gap-3">
              <label className="flex items-center gap-2 text-label-13">
                <Checkbox aria-label="全选"
                  checked={chosen === changes.length && changes.length > 0}
                  onCheckedChange={(checked) => setAccepted(checked === true
                    ? Object.fromEntries(changes.map((_, i) => [i, true])) : {})} />
                全选
              </label>
              <span className="text-label-12 text-muted-foreground">已选 {chosen}/{changes.length}</span>
            </div>
          )}
          {changes.map((c, i) => (
            <div key={i} className="mb-2.5 rounded-md border border-border bg-card p-3">
              <div className="mb-1 font-mono text-label-12 text-muted-foreground">{KIND[c.kind] ?? c.kind} · {c.path}</div>
              {c.old && <del className="block text-copy-13 text-muted-foreground">{c.old}</del>}
              <ins className="mt-1 block text-copy-13 text-green-900 no-underline">{c.new}</ins>
              <label className="mt-2 flex items-center gap-2 text-label-13">
                <Checkbox aria-label={`采纳第 ${i + 1} 条`}
                  checked={accepted[i] ?? false}
                  onCheckedChange={(checked) => setAccepted({ ...accepted, [i]: checked === true })} />
                采纳这条
              </label>
            </div>
          ))}

          {supplements.length > 0 && (
            <Alert tone="red" className="mt-2"><b>需真实补充</b>（改写无法替代）：
              <ul className="mt-1 list-disc pl-5">{supplements.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </Alert>
          )}
          {changes.length > 0 && (
            <>
              <Button className="mt-2 w-full" disabled={apply.loading} onClick={runApply}>
                采纳选中的 {chosen} 条
              </Button>
              <TaskStatus loading={apply.loading} elapsed={apply.elapsed} stop={apply.stop} error={apply.error} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
