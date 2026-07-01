import { useEffect, useState } from "react";
import { postJSON, getJSON } from "@/lib/api";
import { useTask } from "@/lib/useTask";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { Progress, Alert } from "@/components/ui/misc";
import { Label } from "@/components/ui/input";
import { TaskStatus } from "@/components/TaskStatus";
import type { EvalResult, Role } from "@/types";

export function StepScore() {
  const { resume, evalResult, setEval } = useStore();
  const [roles, setRoles] = useState<Role[]>([]);
  const [role, setRole] = useState("designer");
  useEffect(() => { getJSON<{ roles: Role[] }>("/api/roles").then((d) => setRoles(d.roles)).catch(() => {}); }, []);

  const task = useTask((signal, r: string) => postJSON<EvalResult>("/api/evaluate", { resume, role: r }, signal));
  const submit = async () => { const d = await task.run(role); if (d) setEval(d); };
  const d = evalResult?.data;

  return (
    <section>
      <h2 className="text-heading-24 mb-1">按岗位评分</h2>
      <div className="flex items-end gap-3 mb-3">
        <div><Label>岗位维度</Label>
          <select value={role} onChange={(e) => setRole(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-copy-14 min-h-[40px]">
            {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </select>
        </div>
        <Button disabled={task.loading} onClick={submit}>评分</Button>
      </div>
      <TaskStatus loading={task.loading} elapsed={task.elapsed} stop={task.stop} error={task.error} />

      {d && !task.loading && (
        <div className="mt-4">
          <div className="flex items-baseline gap-4">
            <span className="text-heading-40 text-primary">{d.score}</span>
            <span className="text-copy-13 text-muted-foreground">/ {d.max} · {d.role_label}<br />模型启发式意见，非面试率</span>
          </div>
          <div className="mt-4 space-y-3">
            {Object.entries(d.evaluation.scores).map(([k, c]) => (
              <div key={k}>
                <div className="flex justify-between text-copy-14"><span>{k}</span><span>{c.score}/{c.max}</span></div>
                <div className="my-1"><Progress value={(100 * c.score) / c.max} /></div>
                <div className="text-label-12 text-muted-foreground">{c.evidence}</div>
              </div>
            ))}
          </div>
          {d.gaps?.length > 0 && <Alert tone="amber" className="mt-4"><b>需真实补充</b>
            <ul className="mt-1 list-disc pl-5">{d.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></Alert>}
          {d.evaluation.key_strengths?.length > 0 && <Alert tone="green" className="mt-3"><b>核心优势</b>
            <ul className="mt-1 list-disc pl-5">{d.evaluation.key_strengths.map((g, i) => <li key={i}>{g}</li>)}</ul></Alert>}
        </div>
      )}
    </section>
  );
}
