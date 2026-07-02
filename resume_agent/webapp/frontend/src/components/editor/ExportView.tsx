// 节点3 · 排版导出台：左模板库 / 中 A4 实时画布 / 右样式控制器 + 多端预览 + 导出。
// A4 由 resumeDoc(data→md→doc, layout) 渲染；样式参数写 store.layoutSettings（随 autosave 持久化）。
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@/store/useStore";
import { resumeToMarkdown } from "@/lib/resumeToMarkdown";
import { markdownToDoc } from "@/lib/resumeDoc";
import { TEMPLATES, THEME_COLORS } from "@/lib/templates";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { Printer, Monitor, Smartphone } from "lucide-react";

export function ExportView() {
  const resume = useStore((s) => s.resume);
  const layout = useStore((s) => s.layoutSettings);
  const setLayout = useStore((s) => s.setLayout);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [doc, setDoc] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const name = useMemo(() => resume?.basics?.name || "简历", [resume]);

  // data + layout → 防抖重渲
  useEffect(() => {
    const id = window.setTimeout(() => {
      setDoc(resume ? markdownToDoc(resumeToMarkdown(resume, "zh"), name, layout) : "");
    }, 150);
    return () => window.clearTimeout(id);
  }, [resume, name, layout]);

  const fit = () => {
    const idoc = iframeRef.current?.contentDocument;
    const wrap = wrapRef.current;
    if (!idoc?.documentElement || !wrap) return;
    const scale = Math.max(0.3, Math.min(1, (wrap.clientWidth - 32) / 794));
    idoc.documentElement.style.setProperty("--fit", String(scale));
  };
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit); ro.observe(wrap);
    return () => ro.disconnect();
  }, [device]);

  const print = () => {
    const win = iframeRef.current?.contentWindow;
    const idoc = iframeRef.current?.contentDocument;
    if (!win) return;
    const go = () => win.print();
    if (idoc && (idoc as any).fonts?.ready) (idoc as any).fonts.ready.then(go).catch(go);
    else go();
  };

  return (
    <div className="flex min-h-0 flex-1">
      {/* 左：模板库 */}
      <div className="min-h-0 w-[180px] shrink-0 overflow-y-auto border-r border-border p-3">
        <div className="mb-2 text-label-12 text-muted-foreground">模板</div>
        <div className="space-y-2">
          {TEMPLATES.map((t) => (
            <button key={t.id} onClick={() => setLayout({ templateId: t.id })}
              className={cn("w-full rounded-lg border p-2.5 text-left transition",
                layout.templateId === t.id ? "border-primary ring-1 ring-primary" : "border-border hover:border-muted-foreground")}>
              <div className="text-button-14">{t.name}</div>
              <div className="text-label-12 text-muted-foreground">{t.hint}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 中：A4 画布 */}
      <div ref={wrapRef} className={cn("min-h-0 flex-1 overflow-auto bg-[#f5f5f4]", device === "mobile" && "flex justify-center")}>
        <div className={device === "mobile" ? "w-[390px] shrink-0" : "w-full"}>
          <iframe ref={iframeRef} title="排版预览" sandbox="allow-same-origin allow-modals"
            srcDoc={doc} onLoad={fit} className="h-full min-h-[70vh] w-full border-0 bg-transparent" />
        </div>
      </div>

      {/* 右：样式控制器 */}
      <div className="min-h-0 w-[260px] shrink-0 overflow-y-auto border-l border-border p-4">
        <div className="mb-3 flex gap-2">
          <Button variant={device === "desktop" ? "primary" : "secondary"} className="flex-1"
            onClick={() => setDevice("desktop")}><Monitor className="h-4 w-4" /> 桌面</Button>
          <Button variant={device === "mobile" ? "primary" : "secondary"} className="flex-1"
            onClick={() => setDevice("mobile")}><Smartphone className="h-4 w-4" /> 手机</Button>
        </div>

        <Label>主题色</Label>
        <div className="mb-4 mt-1 flex gap-2">
          {THEME_COLORS.map((c) => (
            <button key={c.id} aria-label={`主题色 ${c.id}`} onClick={() => setLayout({ themeColor: c.id })}
              className={cn("h-7 w-7 rounded-full border-2", layout.themeColor === c.id ? "border-foreground" : "border-transparent")}
              style={{ background: c.hex }} />
          ))}
        </div>

        <Label htmlFor="fs">字号 · {(layout.fontScale).toFixed(2)}×</Label>
        <input id="fs" type="range" min={0.85} max={1.25} step={0.05} value={layout.fontScale}
          onChange={(e) => setLayout({ fontScale: parseFloat(e.target.value) })} className="mb-4 mt-1 w-full accent-primary" />

        <Label htmlFor="lh">行距 · {(layout.lineHeight).toFixed(2)}</Label>
        <input id="lh" type="range" min={1.2} max={2.0} step={0.05} value={layout.lineHeight}
          onChange={(e) => setLayout({ lineHeight: parseFloat(e.target.value) })} className="mb-5 mt-1 w-full accent-primary" />

        <Button className="w-full" disabled={!doc} onClick={print}><Printer className="h-4 w-4" /> 导出 PDF</Button>
        <p className="mt-2 text-label-12 text-muted-foreground">在打印对话框选「另存为 PDF」。样式随简历自动保存。</p>
      </div>
    </div>
  );
}
