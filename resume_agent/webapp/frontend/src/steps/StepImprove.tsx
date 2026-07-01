import { useState } from "react";
import { postJSON } from "@/lib/api";
import { useTask } from "@/lib/useTask";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { TaskStatus } from "@/components/TaskStatus";
import type { ImproveResult, ApplyResult, Patch } from "@/types";
import { toast } from "sonner";

export function StepImprove() {
  const { resume, jd, improve, setImprove, setResume, warnings } = useStore();
  const [accepted, setAccepted] = useState<Record<number, boolean>>({});

  const gen = useTask((signal) =>
    postJSON<ImproveResult>("/api/improve", { resume, jd }, signal));
  const apply = useTask((signal, patches: Patch[]) =>
    postJSON<ApplyResult>("/api/apply", { resume, patches }, signal));

  const changes = improve?.changes ?? [];

  const runGen = async () => {
    if (!jd.trim()) return toast.error("请先在第 3 步匹配 JD");
    const r = await gen.run();
    if (r) {
      setImprove(r.changes, r.notes, r.must_supplements);
      setAccepted(Object.fromEntries(r.changes.map((_, i) => [i, true])));
    }
  };

  const runApply = async () => {
    const patches: Patch[] = changes.filter((_, i) => accepted[i])
      .map((c) => ({ op: "replace", path: c.path, old: c.old, value: c.new }));
    if (!patches.length) return toast.error("没有选中的改动");
    const r = await apply.run(patches);
    if (r) {
      if (!r.committed) return toast.error("改动会让简历结构不合法，已回退");
      setResume(r.resume, warnings);
      const applied = r.results.filter((x) => x.status === "applied").length;
      const stale = r.results.filter((x) => x.status === "stale").length;
      toast.success(`已应用 ${applied} 条` + (stale ? `，${stale} 条因原值变化跳过` : ""));
      setImprove([], improve?.notes ?? [], improve?.supplements ?? []);
    }
  };

  return (
    <section>
      <h2 className="text-heading-24 mb-1">针对岗位强化（不编造）</h2>
      <p className="text-copy-14 text-muted-foreground mb-4">只强化「证据弱」项的表述；缺失的硬性要求提示「需真实补充」，不替你编。逐条勾选接受。</p>
      <Button disabled={gen.loading} onClick={runGen}>生成强化建议</Button>
      <TaskStatus loading={gen.loading} elapsed={gen.elapsed} stop={gen.stop} error={gen.error} />

      {improve && !gen.loading && (
        <div className="mt-4">
          {changes.length === 0 && <p className="text-copy-14 text-muted-foreground">没有可强化的「证据弱」项。</p>}
          {changes.map((c, i) => (
            <div key={i} className="mb-3 rounded-xl border border-border bg-card p-4">
              <div className="text-label-12 text-muted-foreground font-mono mb-1.5">{c.path}</div>
              {c.old && <del className="block text-copy-14 text-destructive/70">{c.old}</del>}
              <ins className="block no-underline text-copy-14 text-green-700 mt-1">{c.new}</ins>
              <label className="mt-2 flex items-center gap-2 text-label-13">
                <input type="checkbox" className="h-4 w-4" checked={accepted[i] ?? false}
                  onChange={(e) => setAccepted({ ...accepted, [i]: e.target.checked })} />
                接受这条
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
              <Button className="mt-3" disabled={apply.loading} onClick={runApply}>应用选中的改动</Button>
              <TaskStatus loading={apply.loading} elapsed={apply.elapsed} stop={apply.stop} error={apply.error} />
            </>
          )}
        </div>
      )}
    </section>
  );
}
