import { Progress, Alert } from "./ui/misc";
import { RadarChart } from "./editor/RadarChart";
import type { EvalResult } from "@/types";

// 评估报告卡：分数 + 能力雷达 + 各维度条 + 核心优势 + 需真实补充。诊断基线与修改后复评共用。
export function ScoreCard({ data, compact = false }: { data: EvalResult; compact?: boolean }) {
  const labelOf = (k: string) => data.dim_labels?.[k] || k;   // 机器键 → 人类可读标签
  const dims = Object.entries(data.evaluation.scores)
    .map(([k, c]) => ({ label: labelOf(k), ratio: c.max ? c.score / c.max : 0 }));
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
