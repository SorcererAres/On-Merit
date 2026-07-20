// 画布 AI 进行中胶囊（Figma 1026:647）：渐变星标 + 文案 + 停止按钮。
import aiSparklesUrl from "@/assets/ai-sparkles.svg";
import { Button } from "@/components/ui/button";
import { AI_BUSY_LABEL, type AiBusyKind } from "@/lib/aiBusy";

export function AiBusyPill({ kind, onStop }: { kind: AiBusyKind; onStop: () => void }) {
  const label = AI_BUSY_LABEL[kind];
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="ai-busy-pill anim-in flex h-11 items-center gap-2 rounded-full border px-2"
    >
      <span className="relative size-6 shrink-0 overflow-hidden" aria-hidden>
        <img src={aiSparklesUrl} alt="" width={24} height={24} className="size-full" />
      </span>
      <span className="whitespace-nowrap text-copy-14 leading-6">{label}</span>
      <Button
        type="button"
        variant="ghost"
        aria-label="停止等待"
        title="停止等待"
        onClick={onStop}
        className="ai-busy-stop size-6 min-h-6 shrink-0 rounded-full p-0 active:scale-100"
      >
        <span className="ai-busy-stop-mark block size-2" aria-hidden />
      </Button>
    </div>
  );
}
