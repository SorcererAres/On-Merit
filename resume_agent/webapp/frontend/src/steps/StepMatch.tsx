import { postJSON } from "@/lib/api";
import { useTask } from "@/lib/useTask";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { TaskStatus } from "@/components/TaskStatus";
import { MatchReportView } from "@/components/MatchReportView";
import type { MatchReport } from "@/types";

export function StepMatch() {
  const { resume, jd, setJD, match, setMatch, unlock } = useStore();
  const task = useTask((signal, jdText: string) =>
    postJSON<MatchReport>("/api/match", { resume, jd: jdText }, signal));

  const submit = async () => {
    if (!jd.trim()) return;
    const r = await task.run(jd);
    if (r) { setMatch(r); unlock(4); unlock(5); }
  };

  return (
    <section>
      <h2 className="text-heading-24 mb-1">粘贴目标岗位 JD</h2>
      <p className="text-copy-14 text-muted-foreground mb-4">对着具体职位算覆盖度：哪里够、哪里弱、哪里缺。</p>
      <Textarea rows={9} placeholder="粘贴目标职位的招聘要求（JD）…" value={jd} onChange={(e) => setJD(e.target.value)} />
      <Button className="mt-3" disabled={task.loading} onClick={submit}>看看匹配度</Button>
      <TaskStatus loading={task.loading} elapsed={task.elapsed} stop={task.stop} error={task.error} />
      {match && !task.loading && <MatchReportView report={match.report} />}
    </section>
  );
}
