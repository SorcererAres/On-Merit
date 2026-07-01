import { cn } from "@/lib/cn";
export const Badge = ({ tone = "gray", className, ...p }:
  React.HTMLAttributes<HTMLSpanElement> & { tone?: "gray" | "green" | "amber" | "red" | "blue" }) => {
  const t = {
    gray: "bg-gray-100 text-gray-900", green: "bg-green-100 text-green-700",
    amber: "bg-amber-100 text-amber-700", red: "bg-red-100 text-red-700", blue: "bg-blue-100 text-blue-700",
  }[tone];
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-label-12", t, className)} {...p} />;
};
export const Progress = ({ value, label }: { value: number; label?: string }) => (
  <div role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}
    aria-valuetext={label ?? `${value}%`} className="h-2 rounded-full bg-gray-200 overflow-hidden">
    <div className="h-full bg-primary transition-all" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
  </div>
);
export const Alert = ({ tone = "amber", className, ...p }:
  React.HTMLAttributes<HTMLDivElement> & { tone?: "amber" | "red" | "blue" | "green" }) => {
  const t = {
    amber: "bg-amber-100 border-amber-300 text-amber-900",
    red: "bg-red-100 border-red-300 text-red-900",
    blue: "bg-blue-100 border-blue-300 text-blue-900",
    green: "bg-green-100 border-green-300 text-green-900",
  }[tone];
  return <div className={cn("rounded-lg border px-4 py-3 text-copy-14", t, className)} {...p} />;
};
export const Spinner = ({ className }: { className?: string }) => (
  <div className={cn("h-5 w-5 rounded-full border-2 border-gray-300 border-t-primary animate-spin", className)} />
);
