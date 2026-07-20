import { Progress, Alert } from "./ui/misc";
import { RadarChart } from "./editor/RadarChart";
import type { EvalResult } from "@/types";

// 评估报告卡：分数 + 能力雷达 + 各维度条 + 核心优势 + 需真实补充。诊断基线与修改后复评共用。
// report=true：诊断报告页布局（大号分 + 雷达 + 维度图例 + 分组优化建议）。
export function ScoreCard({ data, compact = false, report = false }: {
  data: EvalResult;
  compact?: boolean;
  report?: boolean;
}) {
  const labelOf = (k: string) => data.dim_labels?.[k] || k;   // 机器键 → 人类可读标签
  const dims = Object.entries(data.evaluation.scores)
    .map(([k, c]) => ({ label: labelOf(k), ratio: c.max ? c.score / c.max : 0, score: c.score, max: c.max }));

  if (report) {
    return (
      <div>
        <div className="flex items-end gap-1">
          <span className="text-heading-40 text-foreground">{data.score}</span>
          <span className="pb-1 text-copy-14 text-muted-foreground">分</span>
        </div>
        <p className="mt-1 text-copy-13 text-muted-foreground">
          基于当前简历内容，按“{data.role_label}”岗位维度进行模型启发式评估。分数用于定位内容问题，不代表面试通过率。
        </p>

        <RadarChart dims={dims} />

        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {dims.map((dim) => (
            <div key={dim.label} className="flex min-w-0 items-center gap-2 text-label-12">
              <span className="size-2.5 shrink-0 rounded-sm border border-amber-600 bg-amber-300" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{dim.label}</span>
              <span className="shrink-0 text-foreground">{dim.score}/{dim.max}</span>
            </div>
          ))}
        </div>

        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-heading-14 text-foreground">优化建议</h3>

          {data.evaluation.areas_for_improvement?.length > 0 && (
            <section className="mt-3">
              <h4 className="text-button-14 text-foreground">重点优化项</h4>
              <ol className="mt-2 space-y-2.5">
                {data.evaluation.areas_for_improvement.map((item, index) => (
                  <li key={index} className="flex gap-2 text-copy-13 text-muted-foreground">
                    <span className="shrink-0 text-foreground">{index + 1}.</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {data.gaps?.length > 0 && (
            <section className="mt-4">
              <h4 className="text-button-14 text-foreground">进一步优化建议</h4>
              <ul className="mt-2 list-disc space-y-2 pl-4 text-copy-13 text-muted-foreground">
                {data.gaps.map((item, index) => <li key={index}>{item}</li>)}
              </ul>
            </section>
          )}

          {data.evaluation.key_strengths?.length > 0 && (
            <section className="mt-4">
              <h4 className="text-button-14 text-foreground">核心优势</h4>
              <ul className="mt-2 list-disc space-y-2 pl-4 text-copy-13 text-muted-foreground">
                {data.evaluation.key_strengths.map((item, index) => <li key={index}>{item}</li>)}
              </ul>
            </section>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline gap-4">
        <span className="text-heading-40 text-primary">{data.score}</span>
        <span className="text-copy-13 text-muted-foreground">
          / {data.max} · {data.role_label}<br />模型启发式评分，非面试率
        </span>
      </div>
      {!compact && <RadarChart dims={dims} />}
      <div className="mt-4 space-y-3">
        {Object.entries(data.evaluation.scores).map(([k, c]) => (
          <div key={k}>
            <div className="flex justify-between text-copy-14"><span>{labelOf(k)}</span><span>{c.score}/{c.max}</span></div>
            <div className="my-1"><Progress name={`${labelOf(k)} 得分`} value={(100 * c.score) / c.max} /></div>
            {!compact && <div className="text-label-12 text-muted-foreground">{c.evidence}</div>}
          </div>
        ))}
      </div>
      {!compact && data.gaps?.length > 0 && (
        <Alert tone="amber" className="mt-4"><b>需真实补充</b>
          <ul className="mt-1 list-disc pl-5">{data.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></Alert>
      )}
      {!compact && data.evaluation.key_strengths?.length > 0 && (
        <Alert tone="green" className="mt-3"><b>核心优势</b>
          <ul className="mt-1 list-disc pl-5">{data.evaluation.key_strengths.map((g, i) => <li key={i}>{g}</li>)}</ul></Alert>
      )}
    </div>
  );
}
