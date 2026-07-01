import { cn } from "@/lib/cn";
import { useStore } from "@/store/useStore";

const PHASES = [
  { n: 1, label: "诊断", hint: "上传 · 识别 · 评估" },
  { n: 2, label: "修改", hint: "改写 · 复评" },
  { n: 3, label: "排版", hint: "排版 · 导出" },
];

export function Stepper() {
  const { phase, maxPhase, goPhase } = useStore();
  return (
    <nav aria-label="阶段">
      <ol className="flex flex-wrap gap-2">
        {PHASES.map(({ n, label, hint }) => {
          const active = n === phase, done = n < maxPhase, enabled = n <= maxPhase;
          return (
            <li key={n}>
              <button disabled={!enabled} aria-current={active ? "step" : undefined}
                onClick={() => enabled && goPhase(n)}
                className={cn(
                  "flex items-baseline gap-2 rounded-full border px-4 py-1.5 text-button-14 transition",
                  active ? "bg-primary text-primary-foreground border-primary"
                    : done ? "border-primary text-primary bg-background"
                      : "border-border text-muted-foreground bg-background",
                  !enabled && "opacity-40 cursor-not-allowed")}>
                <span>{n} · {label}</span>
                <span className={cn("text-label-12 font-normal hidden sm:inline",
                  active ? "text-primary-foreground/80" : "text-muted-foreground")}>{hint}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
