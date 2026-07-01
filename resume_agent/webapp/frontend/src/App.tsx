import { useState } from "react";
import { useStore } from "@/store/useStore";
import { Stepper } from "@/components/Stepper";
import { StepImport } from "@/steps/StepImport";
import { StepReview } from "@/steps/StepReview";
import { StepMatch } from "@/steps/StepMatch";
import { StepImprove } from "@/steps/StepImprove";
import { StepScore } from "@/steps/StepScore";
import { StepExport } from "@/steps/StepExport";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";

const PANELS = [StepImport, StepReview, StepMatch, StepImprove, StepScore, StepExport];

export default function App() {
  const step = useStore((s) => s.step);
  const [dark, setDark] = useState(false);
  const toggle = () => { const d = !dark; setDark(d); document.documentElement.classList.toggle("dark", d); };
  const Panel = PANELS[step - 1];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-baseline gap-4 flex-wrap border-b border-border px-6 md:px-8 py-5">
        <div className="text-heading-20 text-primary">简历优化 <span className="text-label-13 text-muted-foreground font-normal">Resume Agent</span></div>
        <div className="text-copy-14 text-muted-foreground">针对具体岗位，诚信地把你的真实经历讲到位</div>
        <Button variant="ghost" className="ml-auto" aria-label="切换主题" onClick={toggle}>
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </header>
      <div className="sticky top-0 z-10 bg-background border-b border-border px-6 md:px-8 py-3.5">
        <Stepper />
      </div>
      <main className="mx-auto max-w-3xl px-5 py-7 pb-24">
        <Panel />
      </main>
    </div>
  );
}
