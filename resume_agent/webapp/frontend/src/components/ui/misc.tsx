import { cn } from "@/lib/cn";
export const Badge = ({ tone = "gray", className, ...p }:
  React.HTMLAttributes<HTMLSpanElement> & { tone?: "gray" | "green" | "amber" | "red" | "blue" }) => {
  // 文本用 900 档（9–10 档才满足 12px 文本 AA 对比度；700 是实色填充档，非可访问文本档）
  const t = {
    gray: "bg-gray-100 text-gray-900", green: "bg-green-100 text-green-900",
    amber: "bg-amber-100 text-amber-900", red: "bg-red-100 text-red-900", blue: "bg-blue-100 text-blue-900",
  }[tone];
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-label-12", t, className)} {...p} />;
};
export const Progress = ({ value, label, name }: { value: number; label?: string; name?: string }) => {
  const v = Math.max(0, Math.min(100, value)); // clamp 一次，视觉宽度与 aria 读数保持一致
  return (
    // name → 可访问名称（aria-valuetext 不能替代 name）；label → 数值播报
    <div role="progressbar" aria-label={name ?? label} aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}
      aria-valuetext={label ?? `${v}%`} className="h-2 rounded-full bg-gray-200 overflow-hidden">
      <div className="h-full bg-primary transition-[width]" style={{ width: `${v}%` }} />
    </div>
  );
};
export const Alert = ({ tone = "amber", className, ...p }:
  React.HTMLAttributes<HTMLDivElement> & { tone?: "amber" | "red" | "blue" | "green" }) => {
  // 边框用 400 档（Geist 边框档从 400 起；300 是 active 背景档）
  const t = {
    amber: "bg-amber-100 border-amber-400 text-amber-900",
    red: "bg-red-100 border-red-400 text-red-900",
    blue: "bg-blue-100 border-blue-400 text-blue-900",
    green: "bg-green-100 border-green-400 text-green-900",
  }[tone];
  return <div className={cn("rounded-lg border px-4 py-3 text-copy-14", t, className)} {...p} />;
};
export const Spinner = ({ className }: { className?: string }) => (
  <div className={cn("h-5 w-5 rounded-full border-2 border-gray-300 border-t-primary animate-spin", className)} />
);
