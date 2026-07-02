// 节点1 · 诊断视图：左原件(source_text 只读，无则占位降级) | 中核对(SectionEditor) | 右诊断(AIPanel)。
// 空白简历 → 上传子态：居中引导导入（见 wizard-flow-v2 §一）。窄屏折叠为 tab。
import { useState } from "react";
import { useStore } from "@/store/useStore";
import { SourcePanel } from "./SourcePanel";
import { SectionEditor } from "./SectionEditor";
import { AIPanel } from "./AIPanel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { FileUp } from "lucide-react";
import type { Resume } from "@/types";

type Tab = "source" | "review" | "diagnose";

// 空白：无姓名且无任何工作/项目/教育/技能——尚未录入实质内容。
function isBlank(r: Resume | null): boolean {
  if (!r) return true;
  const b = r.basics?.name?.trim();
  return !b && !r.work?.length && !r.projects?.length && !r.education?.length && !r.skills?.length;
}

export function DiagnoseView({ onImport }: { onImport: () => void }) {
  const resume = useStore((s) => s.resume);
  const hydrationKey = useStore((s) => s.hydrationKey);
  const [tab, setTab] = useState<Tab>("review");

  const tabCls = (t: Tab) => cn("flex-1 rounded-md px-3 py-1.5 text-button-14",
    tab === t ? "bg-primary text-primary-foreground" : "text-muted-foreground");

  // 上传子态：空白简历引导导入
  if (isBlank(resume)) {
    return (
      <div className="anim-in flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-border text-muted-foreground">
          <FileUp className="h-7 w-7" />
        </div>
        <div>
          <div className="text-heading-20">先导入你的简历</div>
          <p className="mt-1 max-w-sm text-copy-14 text-muted-foreground">
            上传 PDF / 图片（自动 OCR）或粘贴文本。我们只重述你已写下的经历，不编造事实。
          </p>
        </div>
        <Button onClick={onImport}><FileUp className="h-4 w-4" /> 导入简历</Button>
      </div>
    );
  }

  return (
    <>
      <div className="flex shrink-0 gap-1 border-b border-border p-2 lg:hidden">
        <button className={tabCls("source")} onClick={() => setTab("source")}>原件</button>
        <button className={tabCls("review")} onClick={() => setTab("review")}>核对</button>
        <button className={tabCls("diagnose")} onClick={() => setTab("diagnose")}>诊断</button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className={cn("min-h-0 border-r border-border w-full lg:w-[34%] lg:shrink-0",
          tab !== "source" && "hidden lg:block")}>
          <SourcePanel />
        </div>
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
