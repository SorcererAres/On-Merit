import { Progress, Alert } from "./ui/misc";
import { RadarChart } from "./editor/RadarChart";
import type { EvalResult } from "@/types";

// 模块 key → 中文名（与后端 _SECTION_DEFS 对齐）
const SECTION_LABELS: Record<string, string> = {
  summary: "个人简介",
  exp: "工作经历",
  intern: "实习经历",
  proj: "项目经历",
  org: "学生会/社团",
  volunteer: "志愿经历",
  campus: "校园大使",
  thesis: "毕业设计/论文",
  comp: "学术竞赛",
  awards: "所获荣誉",
  skills: "核心能力",
  edu: "教育经历",
  certs: "证书",
};

function generateSummary(dims: { label: string; score: number; max: number }[], totalScore: number, max: number) {
  const ratio = totalScore / max;
  // 找出最高分和最低分维度
  const sorted = [...dims].sort((a, b) => (b.score / b.max) - (a.score / a.max));
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  
  let base = "";
  if (ratio >= 0.9) base = "整体表现优秀，各方面均衡发展";
  else if (ratio >= 0.8) base = "整体表现良好，但部分维度仍有提升空间";
  else if (ratio >= 0.7) base = "整体表现中等，建议重点优化短板维度";
  else if (ratio >= 0.6) base = "整体表现一般，多项维度需要改进";
  else base = "整体表现较弱，建议全面优化";
  
  if (top && bottom) {
    return `${base}；「${top.label}」表现最佳（${top.score}/${top.max}），「${bottom.label}」为当前最薄弱环节（${bottom.score}/${bottom.max}），建议优先补强。`;
  }
  return base;
}

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
    const summaryText = generateSummary(dims, data.score, data.max);
    return (
      <div>
        {/* 分数 */}
        <div className="flex items-end gap-1">
          <span className="text-heading-40 text-foreground">{data.score}</span>
          <span className="pb-1 text-copy-14 text-muted-foreground">分</span>
        </div>
        {/* 总结 */}
        <p className="mt-1 text-copy-13 text-muted-foreground">{summaryText}</p>
        {/* 免责声明 */}
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

        {/* 优化概述 */}
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-heading-14 text-foreground">优化概述</h3>

          {data.evaluation.key_strengths?.length > 0 && (
            <section className="mt-3">
              <h4 className="text-button-14 text-foreground">核心优势</h4>
              <ol className="mt-2 space-y-2.5">
                {data.evaluation.key_strengths.map((item, index) => (
                  <li key={index} className="flex gap-2 text-copy-13 text-muted-foreground">
                    <span className="shrink-0 text-foreground">{index + 1}.</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {data.evaluation.areas_for_improvement?.length > 0 && (
            <section className="mt-4">
              <h4 className="text-button-14 text-foreground">进一步优化建议</h4>
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
              <h4 className="text-button-14 text-foreground">事实缺口</h4>
              <ul className="mt-2 list-disc space-y-2 pl-4 text-copy-13 text-muted-foreground">
                {data.gaps.map((item, index) => <li key={index}>{item}</li>)}
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
