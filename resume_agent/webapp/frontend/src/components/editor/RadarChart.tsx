// 能力雷达图（手写 SVG，动态维度）。dims 为各维度得分率 0..1；<3 维不画（雷达至少 3 轴）。
// 展示的是「模型启发式评分」的 per-dim 真实得分，非编造的单一匹配分。
interface Dim { label: string; ratio: number }

export function RadarChart({ dims, size = 200 }: { dims: Dim[]; size?: number }) {
  if (dims.length < 3) return null;
  const cx = size / 2, cy = size / 2, R = size / 2 - 34;
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
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="能力雷达图" className="mx-auto block">
      {rings.map((f, k) => (
        <path key={k} d={ringPath(f)} fill="none" stroke="var(--border)" strokeWidth="1" opacity={0.7} />
      ))}
      {dims.map((_, i) => { const [x, y] = pt(i, R); return (
        <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--border)" strokeWidth="1" opacity={0.7} />
      ); })}
      <path d={dataPath} fill="var(--primary)" fillOpacity={0.14} stroke="var(--primary)" strokeWidth="1.5" />
      {dims.map((d, i) => {
        const [x, y] = pt(i, R * Math.max(0.02, Math.min(1, d.ratio)));
        return <circle key={i} cx={x} cy={y} r="2.5" fill="var(--primary)" />;
      })}
      {dims.map((d, i) => {
        const [x, y] = pt(i, R + 16);
        return (
          <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
            fontSize="11" fill="var(--muted-foreground)">
            {d.label.length > 6 ? d.label.slice(0, 6) : d.label}
          </text>
        );
      })}
    </svg>
  );
}
