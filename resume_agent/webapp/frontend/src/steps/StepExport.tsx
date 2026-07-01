import { useRef, useState } from "react";
import { postJSON } from "@/lib/api";
import { useTask } from "@/lib/useTask";
import { useStore } from "@/store/useStore";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { TaskStatus } from "@/components/TaskStatus";

export function StepExport() {
  const { resume } = useStore();
  const [lang, setLang] = useState("zh");
  const [html, setHtml] = useState("");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const task = useTask((signal, l: string) =>
    postJSON<{ html: string }>("/api/render", { resume, lang: l }, signal));
  const render = async () => { const d = await task.run(lang); if (d) setHtml(d.html); };

  const print = () => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    // 等字体就绪再打印（避免字形未加载）
    const doc = iframeRef.current!.contentDocument;
    const go = () => win.print();
    if (doc && (doc as any).fonts?.ready) (doc as any).fonts.ready.then(go).catch(go);
    else go();
  };

  return (
    <section>
      <h2 className="text-heading-24 mb-1">导出</h2>
      <div className="flex items-end gap-3 mb-3">
        <div><Label>模板语言（只切模板文案，不翻译正文）</Label>
          <select value={lang} onChange={(e) => setLang(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-copy-14 min-h-[40px]">
            <option value="zh">中文</option><option value="en">English</option>
          </select></div>
        <Button disabled={task.loading} onClick={render}>生成排版</Button>
        {html && <Button variant="secondary" onClick={print}>打印 / 存为 PDF</Button>}
      </div>
      <TaskStatus loading={task.loading} elapsed={task.elapsed} stop={task.stop} error={task.error} />
      {html && (
        <iframe ref={iframeRef} title="简历预览" sandbox="allow-same-origin allow-modals"
          srcDoc={html} className="mt-4 w-full h-[80vh] rounded-lg border border-border bg-white" />
      )}
    </section>
  );
}
