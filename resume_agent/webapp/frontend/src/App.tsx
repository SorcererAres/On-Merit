import { useState } from "react";
import { useStore } from "@/store/useStore";
import { Stepper } from "@/components/Stepper";
import { PhaseDiagnose } from "@/phases/PhaseDiagnose";
import { PhaseModify } from "@/phases/PhaseModify";
import { PhaseLayout } from "@/phases/PhaseLayout";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";

const PANELS = [PhaseDiagnose, PhaseModify, PhaseLayout];

export default function App() {
  const phase = useStore((s) => s.phase);
  const [dark, setDark] = useState(false);
  const toggle = () => { const d = !dark; setDark(d); document.documentElement.classList.toggle("dark", d); };
  const Panel = PANELS[phase - 1];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-baseline gap-4 flex-wrap border-b border-border px-6 md:px-8 py-5">
        <div className="text-heading-20 text-primary">简历优化 <span className="text-label-13 text-muted-foreground font-normal">Resume Agent</span></div>
        <div className="text-copy-14 text-muted-foreground">诊断 → 修改 → 排版：诚信地把你的真实经历讲到位</div>
        <Button variant="ghost" className="ml-auto" aria-pressed={dark}
          aria-label={dark ? "切换到浅色主题" : "切换到深色主题"} onClick={toggle}>
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </header>
      <div className="sticky top-0 z-10 bg-background border-b border-border px-6 md:px-8 py-3.5">
        <Stepper />
      </div>
      {/* 排版阶段需要更宽（左编辑/右预览分栏）；诊断/修改是表单，窄一些更聚焦 */}
      <main className={cn("mx-auto px-5 py-7 pb-24", phase === 3 ? "max-w-6xl" : "max-w-3xl")}>
        <Panel />
      </main>
    </div>
  );
}
