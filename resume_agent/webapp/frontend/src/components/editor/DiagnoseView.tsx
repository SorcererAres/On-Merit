// 节点1 · 诊断视图：左原件(source_text) | 中核对(SectionEditor) | 右诊断报告(AIPanel diagnose)。
// 无 source_text → 2 栏（核对 | 诊断）。窄屏折叠为 tab。
import { useState } from "react";
import { useStore } from "@/store/useStore";
import { SourcePanel } from "./SourcePanel";
import { SectionEditor } from "./SectionEditor";
import { AIPanel } from "./AIPanel";
import { cn } from "@/lib/cn";

type Tab = "source" | "review" | "diagnose";

export function DiagnoseView() {
  const sourceText = useStore((s) => s.sourceText);
  const hydrationKey = useStore((s) => s.hydrationKey);
  const hasSource = !!sourceText;
  const [tab, setTab] = useState<Tab>("review");

  const tabCls = (t: Tab) => cn("flex-1 rounded-md px-3 py-1.5 text-button-14",
    tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground");

  return (
    <>
      <div className="flex shrink-0 gap-1 border-b border-border p-2 lg:hidden">
        {hasSource && <button className={tabCls("source")} onClick={() => setTab("source")}>原件</button>}
        <button className={tabCls("review")} onClick={() => setTab("review")}>核对</button>
        <button className={tabCls("diagnose")} onClick={() => setTab("diagnose")}>诊断</button>
      </div>
      <div className="flex min-h-0 flex-1">
        {hasSource && (
          <div className={cn("min-h-0 border-r border-border w-full lg:w-[34%] lg:shrink-0",
            tab !== "source" && "hidden lg:block")}>
            <SourcePanel />
          </div>
        )}
        <div key={hydrationKey} className={cn("min-h-0 flex-1 overflow-y-auto border-r border-border",
          tab !== "review" && "hidden lg:block")}>
          <SectionEditor />
        </div>
        <div className={cn("min-h-0 w-full lg:w-[400px] lg:shrink-0", tab !== "diagnose" && "hidden lg:block")}>
          <AIPanel only="diagnose" />
        </div>
      </div>
    </>
  );
}
