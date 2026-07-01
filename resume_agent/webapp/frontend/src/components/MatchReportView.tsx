import { Progress, Badge, Alert } from "./ui/misc";
import type { MatchReport } from "@/types";

const TAG = { covered: ["已覆盖", "green"], partial: ["证据弱", "amber"], missing: ["缺失", "red"] } as const;

export function MatchReportView({ report }: { report: MatchReport }) {
  const s = report.summary;
  return (
    <div className="mt-6">
      <div className="flex items-baseline gap-4 flex-wrap">
        <span className="text-heading-40 text-primary">{s.coverage_pct}%</span>
        <div className="text-copy-13 text-muted-foreground">
          证据覆盖指数 · 共 {s.total} 条（已覆盖 {s.covered} · 弱 {s.partial} · 缺失 {s.missing}）<br />
          硬性要求 {s.must_covered}/{s.must_total} 已覆盖 · 覆盖指数≠面试率
        </div>
      </div>
      <div className="my-3"><Progress name="证据覆盖指数" value={s.coverage_pct} label={`覆盖指数 ${s.coverage_pct}%`} /></div>

      {s.must_risks?.length > 0 && (
        <Alert tone="red" className="my-3">
          <b>硬性风险</b>（must 缺失或证据弱，需重点处理）：
          <ul className="mt-1 list-disc pl-5">
            {s.must_risks.map((r, i) => <li key={i}>{r.coverage === "missing" ? "缺失，需真实补充" : "证据弱，需强化"}：{r.text}</li>)}
          </ul>
        </Alert>
      )}

      <div className="mt-4 divide-y divide-border">
        {report.requirements.map((req, i) => {
          const m = report.matches[i]; const [txt, tone] = TAG[m.coverage];
          return (
            <div key={i} className="py-2.5">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge tone={tone as any}>{txt}</Badge>
                <span className="text-copy-14">{req.text}</span>
                <span className="text-label-12 text-muted-foreground">· {req.importance === "must" ? "必需" : "加分"}</span>
              </div>
              {m.evidence && <div className="mt-1 border-l-2 border-border pl-2 text-copy-13 text-muted-foreground">证据：{m.evidence}</div>}
              {m.suggestion && m.coverage !== "covered" && <div className="mt-1 text-copy-13 text-primary">建议：{m.suggestion}</div>}
            </div>
          );
        })}
      </div>
      {report.warnings?.length > 0 && (
        <Alert tone="amber" className="mt-3"><b>反造假</b>
          <ul className="mt-1 list-disc pl-5">{report.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </Alert>
      )}
    </div>
  );
}
