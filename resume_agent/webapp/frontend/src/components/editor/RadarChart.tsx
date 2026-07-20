// 能力雷达图（手写 SVG，动态维度）。dims 为各维度得分率 0..1；<3 维不画（雷达至少 3 轴）。
// 展示的是「模型启发式评分」的 per-dim 真实得分，非编造的单一匹配分。
interface Dim { label: string; ratio: number }

/** 长标签拆成两行，避免挤出 viewBox；短标签原样。 */
function labelLines(label: string): string[] {
  const t = label.trim();
  if (t.length <= 5) return [t];
  if (t.length <= 8) return [t.slice(0, Math.ceil(t.length / 2)), t.slice(Math.ceil(t.length / 2))];
  // 更长：两行各最多 5 字，超出省略
  return [t.slice(0, 5), t.slice(5, 10) + (t.length > 10 ? "…" : "")];
}

export function RadarChart({ dims, size = 260 }: { dims: Dim[]; size?: number }) {
  if (dims.length < 3) return null;
  // 边距留给标签（左右轴尤其需要宽；锚向图心后字在内侧，仍需空隙防贴边）
  const pad = 62;
  const cx = size / 2, cy = size / 2, R = size / 2 - pad;
  const n = dims.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;  // 从正上方顺时针
  const pt = (i: number, r: number) => [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];

  const rings = [0.25, 0.5, 0.75, 1];
  const ringPath = (frac: number) =>
    dims.map((_, i) => { const [x, y] = pt(i, R * frac); return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`; }).join(" ") + " Z";
  const dataPath = dims.map((d, i) => {
    const [x, y] = pt(i, R * Math.max(0.02, Math.min(1, d.ratio)));
    return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ") + " Z";

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" height="auto"
      role="img" aria-label="能力雷达图" className="mx-auto mt-2 block max-w-chart-radar">
      {rings.map((f, k) => (
        <path key={k} d={ringPath(f)} fill="none" stroke="var(--border)" strokeWidth="1" opacity={0.7} />
      ))}
      {dims.map((_, i) => { const [x, y] = pt(i, R); return (
        <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--border)" strokeWidth="1" opacity={0.7} />
      ); })}
      <path d={dataPath} fill="var(--amber-300)" fillOpacity={0.72} stroke="var(--amber-700)" strokeWidth="1.5" />
      {dims.map((d, i) => {
        const [x, y] = pt(i, R * Math.max(0.02, Math.min(1, d.ratio)));
        return <circle key={i} cx={x} cy={y} r="2.5" fill="var(--amber-700)" />;
      })}
      {dims.map((d, i) => {
        const a = angle(i);
        const cos = Math.cos(a), sin = Math.sin(a);
        // 左右锚向图心一侧：左 start（字往右画）、右 end（字往左画），避免伸出 viewBox
        const anchor: "start" | "middle" | "end" =
          cos > 0.35 ? "end" : cos < -0.35 ? "start" : "middle";
        const [x, y] = pt(i, R + 14);
        const dy = sin < -0.35 ? -2 : sin > 0.35 ? 4 : 0;
        const lines = labelLines(d.label);
        return (
          <text key={i} x={x} y={y + dy} textAnchor={anchor} dominantBaseline="middle"
            fontSize="11" fill="var(--muted-foreground)">
            {lines.map((line, li) => (
              <tspan key={li} x={x} dy={li === 0 ? 0 : 13}>{line}</tspan>
            ))}
          </text>
        );
      })}
    </svg>
  );
}
