import { cn } from "@/lib/cn";
import { useStore } from "@/store/useStore";
const STEPS = ["导入", "核对", "岗位匹配", "强化改写", "评分", "导出"];
export function Stepper() {
  const { step, maxStep, goStep } = useStore();
  return (
    <nav aria-label="步骤">
      <ol className="flex flex-wrap gap-2">
        {STEPS.map((label, i) => {
          const n = i + 1, active = n === step, done = n < maxStep, enabled = n <= maxStep;
          return (
            <li key={n}>
              <button disabled={!enabled} aria-current={active ? "step" : undefined}
                onClick={() => enabled && goStep(n)}
                className={cn("rounded-full border px-3.5 py-1.5 text-button-14 transition",
                  active ? "bg-primary text-primary-foreground border-primary"
                    : done ? "border-primary text-primary bg-background"
                      : "border-border text-muted-foreground bg-background",
                  !enabled && "opacity-40 cursor-not-allowed")}>
                {n} {label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
